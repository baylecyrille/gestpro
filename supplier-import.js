// Import d'un document fournisseur PDF (facture, bon de livraison, bon de commande, devis…) : lecture 100 % locale (pdf.js embarqué), contrôle par l'utilisateur, puis catalogue / stock / fournisseur.
import * as db from './db.js';
import { e, eur, num, today, cname, F, modal, closeModal, toast, refresh, $, $$ } from './util.js';
import { parseSupplierInvoice, mapUnit } from './supplier-parse.js';
import { matchLayout, buildResult, detectDocType, DOC_TYPES, docType } from './supplier-layout.js';
import { openManual } from './supplier-manual.js';
import { recordMove, locLabel } from './stock.js';
import { unitOpts } from './lists.js';
import { isHike, deltaPct, fmtDelta } from './pricing.js';
import * as fl from './files.js';
import { parseEInvoice, pickXml, decodeXml } from './efact-in.js';
import { alertBox, confirmBox } from './dialogs.js';

let pdfReady = null;
function loadPdfJs() {
  if (pdfReady) return pdfReady;
  pdfReady = new Promise((res, rej) => {
    if (window.pdfjsLib) return res(window.pdfjsLib);
    const s = document.createElement('script');
    s.src = new URL('./pdf.min.js', import.meta.url).href;
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', import.meta.url).href; res(window.pdfjsLib); };
    s.onerror = () => { pdfReady = null; rej(new Error('Lecteur PDF indisponible (ouvrez l\'application une fois en ligne).')); };
    document.head.append(s);
  });
  return pdfReady;
}

/* Texte positionné de toutes les pages (+ le document, pour afficher la page à l'écran). Rien n'est envoyé nulle part. */
export async function loadPdf(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [], sizes = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 1 }), h = vp.height, tc = await pg.getTextContent();
    pages.push(tc.items.map(i => ({ x: i.transform[4], y: h - i.transform[5], w: i.width, h: i.height, s: i.str })));
    sizes.push({ w: vp.width, h });
  }
  return { doc, pages, sizes };
}
export async function readPdf(file) {
  const { pages } = await loadPdf(file);
  return parseSupplierInvoice(pages);
}

/* Mises en page mémorisées par fournisseur (positions des zones uniquement : jamais le contenu des factures) */
const LAY = 'suplay:';
export const savedLayouts = async () => (await db.all('settings')).filter(x => String(x.id).startsWith(LAY) && x.value).map(x => x.value);
const saveLayout = l => (l?.key ? db.put('settings', { id: LAY + l.key, value: l }) : null);
const forgetLayout = l => (l?.key ? db.del('settings', LAY + l.key) : null);

const digits = s => String(s || '').replace(/\D/g, '');

/* Mémoire des documents importés (M11) : fournisseur + type + numéro. Seuls ces trois repères (et la date et le total) sont retenus, jamais le contenu du document. */
const IMP = 'impdoc:';
const normName = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const impKeys = (S, DT, inv) => {
  const n = String(inv?.number || '').toUpperCase().replace(/\s+/g, ''); if (!n) return [];
  const t = DT?.key || 'autre', ks = [];
  if (digits(S?.siret)) ks.push(`${IMP}${digits(S.siret)}|${t}|${n}`);
  if (normName(S?.name)) ks.push(`${IMP}${normName(S.name)}|${t}|${n}`);
  return ks;
};
export async function findImported(S, DT, inv) {
  for (const k of impKeys(S, DT, inv)) { const r = await db.get('settings', k); if (r && r.value) return r.value; }
  return null;
}
async function rememberImported(S, DT, inv, total) {
  const k = impKeys(S, DT, inv)[0]; if (!k) return;
  await db.put('settings', { id: k, value: { sup: S?.name || '', type: DT?.key || '', number: inv.number, date: inv.iso(inv.date) || '', total: Math.round((total || 0) * 100) / 100, at: new Date().toISOString() } });
}
const dupText = (x, DT) => `Ce document semble déjà importé le ${new Date(x.at).toLocaleDateString('fr-FR')} (${(DT?.label || x.type || 'document').toLowerCase()} ${x.number}${x.sup ? ' – ' + x.sup : ''}${x.total ? ', ' + eur(x.total) + ' HT' : ''}). Un second import compterait deux fois les mêmes achats.`;

/* Crée ou complète la fiche fournisseur (sans jamais écraser une information déjà saisie) */
export async function upsertSupplier(S, inv) {
  if (!S?.name) return null;
  const all = await db.all('contacts');
  const sup = all.filter(c => c.kind === 'supplier');
  let c = (S.siret && sup.find(x => digits(x.siret) === S.siret)) || sup.find(x => (x.name || '').trim().toLowerCase() === S.name.trim().toLowerCase());
  const isNew = !c; c = c || { kind: 'supplier' };
  const fill = (k, v) => { if (v && !c[k]) c[k] = v; };
  fill('name', S.name); fill('company', S.contact); fill('address', S.address); fill('zip', S.zip); fill('city', S.city);
  fill('phone', S.phone); fill('email', S.email); fill('siret', S.siret);
  const extra = [S.tva && `TVA : ${S.tva}`, inv?.terms && `Paiement : ${inv.terms}`].filter(Boolean).join(' · ');
  if (extra && !(c.note || '').includes(extra)) c.note = [c.note, extra].filter(Boolean).join('\n');
  const saved = await db.put('contacts', c);
  return { contact: saved, isNew };
}

export async function supplierImportModal(opts = {}) {
  const [products, locs, sites, contacts] = await Promise.all([db.all('products'), db.all('locations'), db.all('sites'), db.all('contacts')]);
  const body = `<p class="muted">Choisissez un document de fournisseur au format PDF (facture, bon de livraison, bon de commande, devis…) ou le fichier XML d'une facture électronique (Factur-X, UBL). Un PDF Factur-X est lu directement dans ses données : lignes, taux de TVA et totaux exacts. Le fichier est lu <b>uniquement sur cet appareil</b> : il n'est ni envoyé, ni enregistré. ${opts.onLines ? 'Les lignes que vous validez sont ajoutées au document en cours.' : 'Seules les lignes que vous validez sont ajoutées à votre catalogue.'}</p>
    <label class="f"><span>Document fournisseur (PDF ou XML)</span><input type="file" id="spf" accept="application/pdf,.pdf,.xml,text/xml,application/xml"></label><div id="spres"></div>`;
  modal('Document fournisseur (PDF ou facture électronique)', body, async (o, f) => (f._go ? f._go() : false), {
    wide: true, submitLabel: 'Importer la sélection',
    onOpen: f => {
      f.querySelector('footer .btn.primary').hidden = true;
      $('#spf', f).onchange = async ev => {
        const file = ev.target.files[0]; if (!file) return;
        const out = $('#spres', f); out.innerHTML = '<p class="muted">Lecture du fichier…</p>';
        /* Facture électronique : XML seul (Factur-X / CII, UBL), ou PDF Factur-X dont le XML est joint */
        if (/\.xml$/i.test(file.name) || /xml/i.test(file.type || '')) {
          let x = null; try { x = parseEInvoice(decodeXml(new Uint8Array(await file.arrayBuffer()))); } catch { /* illisible */ }
          if (!x) { out.innerHTML = '<p class="bad">Ce fichier XML n\'est pas une facture électronique reconnue (Factur-X / CII ou UBL avec au moins une ligne).</p>'; return; }
          renderReview(f, out, x, products, locs, opts, sites, contacts, null, null); return;
        }
        let raw;
        try { raw = await loadPdf(file); } catch (err) { out.innerHTML = `<p class="bad">${e(err.message || err)}</p>`; return; }
        raw.docType = detectDocType(raw.pages, raw.sizes);
        const env = { f, out, products, locs, opts, sites, contacts, file, raw };
        try {
          const xml = pickXml(await raw.doc.getAttachments());
          const x = xml ? parseEInvoice(xml) : null;
          if (x) { renderReview(f, out, x, products, locs, opts, sites, contacts, file, { env, used: null }); return; }
        } catch { /* pas de données jointes : lecture du texte du PDF */ }
        /* 1) mise en page mémorisée pour ce fournisseur, 2) lecture automatique, 3) sinon lecture « à la main » */
        let r = null, used = null, note = '';
        try {
          const L = matchLayout(raw.pages, raw.sizes, await savedLayouts(), raw.docType);
          if (L) {
            const rr = buildResult(raw.pages, raw.sizes, { zones: L.zones, table: L.table, name: L.name });
            if (rr.items.length) { r = rr; used = L; r.docType = L.type || raw.docType; } else note = `La mise en page mémorisée pour « ${e(L.name)}${L.type ? ' — ' + e(L.type.label) : ''} » ne donne aucune ligne sur ce document : entourez à nouveau les zones.`;
          }
        } catch { /* mémoire illisible : on continue */ }
        if (!r) { const a = parseSupplierInvoice(raw.pages); if (a.items.length) { r = a; r.docType = raw.docType; } }
        if (r) renderReview(f, out, r, products, locs, opts, sites, contacts, file, { env, used });
        else startManual(env, null, note || `Les lignes de produit n'ont pas été reconnues automatiquement dans ce PDF${raw.docType ? ' (' + raw.docType.label.toLowerCase() + ')' : ''}. Indiquez où elles se trouvent : entourez les zones sur le document.`, !!note);
      };
    }
  });
}

/* Lecture « à la main » : le PDF s'affiche, l'utilisateur entoure les zones, puis on revient à l'écran de contrôle habituel */
function startManual(env, preset, note, noteBad = false) {
  const { f, out, products, locs, opts, sites, contacts, file, raw } = env;
  f.querySelector('footer .btn.primary').hidden = true;
  openManual(out, raw, {
    preset, note, noteBad, type: env.type !== undefined ? env.type : raw.docType, forgetLayout: preset ? forgetLayout : null, saveLayout,
    onDone: res => renderReview(f, out, res, products, locs, opts, sites, contacts, file, { env, used: null })
  });
}

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function renderReview(f, out, r, products, locs, opts = {}, sites = [], contacts = [], file = null, ctx = null) {
  const doc = !!opts.onLines;
  const S = r.supplier, inv = r.invoice;
  /* type du document (facture, bon de livraison, devis…) : sert aux libellés et aux avertissements */
  let DT = r.docType || null;
  const dtLabel = () => DT?.label || 'Facture';
  const notInvoice = () => ['devis', 'commande', 'avoir'].includes(DT?.key);
  const isBL = () => DT?.key === 'livraison';
  const BLINFO = 'Bon de livraison : les lignes sans prix prennent le dernier prix connu du catalogue (sinon saisissez-le). Comme une réception de colis, l\'entrée en stock est comptée dans vos achats : à l\'arrivée de la facture, mettez à jour le catalogue sans refaire l\'entrée en stock.';
  const WARN = { devis: 'Un devis n\'est pas un achat réalisé', commande: 'Un bon de commande n\'est pas un achat réalisé', avoir: 'Un avoir diminue vos achats' };
  const warnTxt = () => notInvoice() ? `${WARN[DT.key]} : n'affectez pas ses lignes à un chantier ni au stock (elles seraient comptées comme des achats). Vous pouvez en revanche mettre à jour le catalogue.` : '';
  const typeOpts = () => `${DOC_TYPES.map(t => `<option value="${t.key}" ${DT?.key === t.key ? 'selected' : ''}>${e(t.label)}</option>`).join('')}${DT && !DOC_TYPES.some(t => t.key === DT.key) ? `<option value="${e(DT.key)}" selected>${e(DT.label)}</option>` : ''}<option value="" ${DT ? '' : 'selected'}>Autre document</option>`;
  const findP = it => products.find(p => it.ref && p.ref && p.ref.toLowerCase() === it.ref.toLowerCase()) || products.find(p => p.name.toLowerCase() === it.name.toLowerCase());
  const C = Object.fromEntries(contacts.map(c => [c.id, c]));
  const siteLbl = s => `${s.name}${C[s.clientId] ? ' — ' + cname(C[s.clientId]) : ''}`;
  const sortedSites = [...sites].sort((a, b) => siteLbl(a).localeCompare(siteLbl(b), 'fr'));
  /* Destinations possibles d'une ligne : un chantier (charge pour la rentabilité) ou un emplacement de stock */
  const dests = [...sortedSites.map(s => ({ kind: 'site', id: s.id, label: 'Chantier : ' + siteLbl(s) })), ...[...locs].sort((a, b) => locLabel(a).localeCompare(locLabel(b), 'fr')).map(l => ({ kind: 'loc', id: l.id, label: 'Stock : ' + locLabel(l) }))];
  const byLabel = Object.fromEntries(dests.map(d => [norm(d.label), d]));
  const guess = it => {
    const k = norm(it.cmd); if (k.length < 3) return '';
    const hs = sites.filter(s => norm(s.name).includes(k) || norm(cname(C[s.clientId] || {})).includes(k));
    if (hs.length === 1) return dests.find(d => d.id === hs[0].id).label;
    const hl = locs.filter(l => norm(l.zone).includes(k) || norm(l.place).includes(k));
    return hl.length === 1 ? dests.find(d => d.id === hl[0].id).label : '';
  };
  const dlist = `<datalist id="spdl">${dests.map(d => `<option value="${e(d.label)}">`).join('')}</datalist>`;
  const known = ex => (ex && num(ex.buy) > 0 ? num(ex.buy) : 0);
  const rows = r.items.map((it, i) => {
    const ex = findP(it), fill = isBL() && !(it.price > 0) ? known(ex) : 0;
    return { ...it, i, ex, price: fill || it.price, pc: !!fill, on: isBL() ? true : it.price > 0, dest: doc || notInvoice() ? '' : guess(it) };
  });
  /* pastille d'état d'une ligne : produit existant / nouveau / lot, et pour un bon de livraison l'origine du prix */
  const chipOf = (x, price, pc) => x.ex ? `<span class="chip ok">existant${pc && price > 0 ? ' · prix du catalogue' : ''}</span>` : price > 0 ? '<span class="chip warn">nouveau</span>' : isBL() ? '<span class="chip warn">prix à saisir</span>' : '<span class="chip">lot</span>';
  const nbOn = () => $$('[data-on]:checked', out).length;
  const feeTot = r.fees.reduce((a, x) => a + x.amount, 0);
  out.innerHTML = `
    <div class="card" style="margin:8px 0"><b>${e(S.name || 'Fournisseur non reconnu')}</b><span id="sphead">${inv.number ? ` · ${e(dtLabel().toLowerCase())} ${e(inv.number)}` : ''}</span>${inv.date ? ` du ${e(inv.date)}` : ''}${inv.due ? ` · échéance ${e(inv.due)}` : ''}<br>
      <span class="muted">${[S.address, [S.zip, S.city].filter(Boolean).join(' '), S.phone, S.email, S.siret && 'SIRET ' + S.siret].filter(Boolean).map(e).join(' · ')}</span></div>
    <p class="muted" style="margin:4px 0"><label>Type de document : <select id="sptype" style="width:auto">${typeOpts()}</select></label></p><p class="bad" id="spwarn" style="margin:4px 0" ${notInvoice() ? '' : 'hidden'}>${e(warnTxt())}</p><p class="muted" id="spbl" style="margin:4px 0" ${isBL() && !doc ? '' : 'hidden'}>${e(BLINFO)}</p>
    ${ctx ? `<p class="muted" style="margin:4px 0">${ctx.used ? `Mise en page mémorisée pour « ${e(ctx.used.name)} » appliquée. ` : r.mode === 'manuel' ? 'Lignes lues d\'après les zones que vous avez entourées. ' : r.einvoice ? '✔ Lues dans les données de facture électronique jointes au PDF (taux de TVA et totaux exacts). ' : ''}<button type="button" class="btn sm" id="spman">✋ Lire à la main</button></p>` : r.einvoice ? '<p class="muted" style="margin:4px 0">✔ Lu dans le fichier XML de facture électronique (taux de TVA et totaux exacts).</p>' : ''}
    ${doc ? '' : '<p class="bad" id="spdup" style="margin:4px 0" hidden></p>'}
    <p class="${r.sumOk === false ? 'bad' : 'muted'}">${r.items.length} ligne(s) lue(s) — total ${eur(r.sum)} HT${r.sumOk === true ? ' ✔ identique au total de la facture' : r.sumOk === false ? ` ⚠ la facture indique ${eur(r.totals.ht0)} : vérifiez les lignes` : ' (total de la facture non trouvé : vérifiez)'}${r.mode === 'texte' ? ' · lecture approximative, contrôlez chaque ligne' : ''}.
    ${r.fees.length ? `<br>Frais de la facture (jamais ajoutés au catalogue) : ${r.fees.map(x => `${e(x.label)} ${eur(x.amount)}`).join(', ')} (total ${eur(feeTot)} HT).` : ''}
    ${isBL() ? (rows.some(x => !(x.price > 0)) ? '<br>Lignes sans prix connu : saisissez le prix d\'achat (ou laissez 0 : l\'entrée en stock se fera sans valeur).' : '') : rows.some(x => x.price === 0) ? '<br>Les lignes à 0 € (composants d\'un lot déjà facturé) sont décochées.' : ''}</p>
    <div style="overflow:auto;max-height:42vh"><table class="tbl" style="width:100%;font-size:13px"><thead><tr><th><input type="checkbox" id="spall" checked></th><th>Réf.</th><th>Désignation</th><th>Qté</th><th>Unité</th><th>PU achat HT</th>${doc ? '' : '<th>Chantier / emplacement</th>'}<th></th></tr></thead><tbody>
    ${rows.map(x => `<tr data-i="${x.i}" ${x.pc ? 'data-pc="1"' : ''} ${x.on ? '' : 'style="opacity:.55"'}><td><input type="checkbox" data-on ${x.on ? 'checked' : ''}></td>
      <td><input data-k="ref" value="${e(x.ref)}" style="width:84px"></td><td><input data-k="name" value="${e(x.name)}" style="min-width:210px;width:100%"></td>
      <td><input data-k="qty" type="number" step="any" value="${x.qty}" style="width:64px"></td>
      <td><select data-k="unit">${unitOpts(x.unitMapped).map(([u, l]) => `<option value="${e(u)}" ${u === x.unitMapped ? 'selected' : ''}>${e(l)}</option>`).join('')}</select></td>
      <td><input data-k="price" type="number" step="0.01" value="${x.price}" style="width:80px"></td>
      ${doc ? '' : `<td><input data-k="dest" list="spdl" value="${e(x.dest)}" placeholder="chantier ou emplacement…" autocomplete="off" style="width:190px">${x.cmd ? `<small class="muted" style="display:block">cmd : ${e(x.cmd)}</small>` : ''}</td>`}
      <td data-chip>${chipOf(x, x.price, x.pc)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="cols" style="margin-top:10px">
      <label class="f full"><span><input type="checkbox" id="spcat" ${doc ? '' : 'checked'}> ${doc ? 'Aussi créer / mettre à jour ces produits dans le catalogue' : 'Mettre à jour le catalogue (créer les nouveaux produits, actualiser le prix d\'achat des existants)'}</span></label>
      ${F(doc ? 'Marge sur le prix d\'achat (%) → prix de vente de la ligne (produit existant : son prix de vente)' : 'Marge sur les nouveaux produits (%) → prix de vente', 'spm', 30, { type: 'number', step: '1' })}
      ${doc ? '' : `<label class="f"><span><input type="checkbox" id="spstk" ${isBL() ? 'checked' : ''}> Enregistrer l'entrée en stock</span><select id="splc">${locs.map(l => `<option value="${l.id}">${e(locLabel(l))}</option>`).join('')}</select></label>`}
      ${doc ? '' : `<label class="f full"><span>Destination des lignes : tapez pour chercher un chantier (charge comptée dans sa rentabilité) ou un emplacement de stock. Vide = suit l'option « entrée en stock » ci-dessous. Proposé d'après le « N° commande » de la facture quand il correspond ; « Appliquer » le met sur toutes les lignes cochées.</span><span style="display:flex;gap:6px"><input id="spsite" list="spdl" placeholder="chantier ou emplacement…" autocomplete="off" style="flex:1"><button type="button" class="btn" id="spapply">Appliquer</button></span>${dlist}</label>
      ${r.fees.length ? `<label class="f full"><span><input type="checkbox" id="spfees" checked> Répartir les frais (${eur(feeTot)} : port…) sur les chantiers, au prorata des lignes</span></label>` : ''}`}
      ${!doc && fl.available() && file ? '<label class="f full"><span><input type="checkbox" id="spkeep" checked> Conserver le PDF dans le stockage Drive / OneDrive (GestPro/Achats fournisseurs, et dans le chantier si affecté)</span></label>' : ''}
      <label class="f full"><span><input type="checkbox" id="spsup" ${S.name && !doc ? 'checked' : ''} ${S.name ? '' : 'disabled'}> Ajouter / compléter le fournisseur « ${e(S.name || '—')} » dans les contacts</span></label>
    </div><p id="spcnt" class="muted"></p>`;
  /* M11 : ce document (fournisseur, type, numéro) a-t-il déjà été importé ? */
  let dupOf = null;
  const dupCheck = async () => {
    const p = $('#spdup', out); if (doc || !p) return;
    dupOf = await findImported(S, DT, inv).catch(() => null);
    p.hidden = !dupOf; p.textContent = dupOf ? '⚠ ' + dupText(dupOf, DT) : '';
  };
  dupCheck();
  const btn = f.querySelector('footer .btn.primary'); btn.hidden = false;
  const upd = () => { $('#spcnt', out).textContent = `${nbOn()} ligne(s) sélectionnée(s).`; btn.disabled = !nbOn() && !$('#spsup', out).checked; };
  out.onchange = ev => {
    if (ev.target.id === 'sptype') {
      DT = ev.target.value ? (docType(ev.target.value) || DT) : null;
      $('#sphead', out).textContent = inv.number ? ` · ${dtLabel().toLowerCase()} ${inv.number}` : '';
      dupCheck();
      const w = $('#spwarn', out); w.textContent = warnTxt(); w.hidden = !notInvoice();
      const bi = $('#spbl', out); if (bi) bi.hidden = !isBL() || doc;
      const stk0 = $('#spstk', out); if (stk0) stk0.checked = isBL();
      $$('tr[data-i]', out).forEach(tr => {
        const x = rows[+tr.dataset.i], pin = $('[data-k=price]', tr);
        if (isBL() && !(num(pin.value) > 0) && known(x.ex) > 0) { pin.value = known(x.ex); tr.dataset.pc = '1'; }
        if (isBL()) { const c = $('[data-on]', tr); c.checked = true; tr.style.opacity = ''; }
        $('[data-chip]', tr).innerHTML = chipOf(x, num(pin.value), !!tr.dataset.pc);
      });
      upd();
      return;
    }
    if (ev.target.id === 'spall') { $$('[data-on]', out).forEach(c => { c.checked = ev.target.checked; c.closest('tr').style.opacity = c.checked ? '' : '.55'; }); }
    if (ev.target.matches('[data-on]')) ev.target.closest('tr').style.opacity = ev.target.checked ? '' : '.55';
    upd();
  };
  const man = $('#spman', out);
  if (man) man.onclick = () => ctx.env.raw && (ctx.env.type = DT) !== undefined && startManual(ctx.env, ctx.used, ctx.used ? `Mise en page mémorisée pour « ${e(ctx.used.name)} » : modifiez les zones puis continuez.` : '');
  out.addEventListener('input', ev => {
    if (!ev.target.matches('[data-k=price]')) return;
    const tr = ev.target.closest('tr'), x = rows[+tr.dataset.i];
    if (known(x.ex) !== num(ev.target.value)) delete tr.dataset.pc; else if (known(x.ex) > 0 && isBL()) tr.dataset.pc = '1';
    $('[data-chip]', tr).innerHTML = chipOf(x, num(ev.target.value), !!tr.dataset.pc);
  });
  const ap = $('#spapply', out);
  if (ap) ap.onclick = () => $$('tr[data-i]', out).forEach(tr => { if ($('[data-on]', tr).checked) $('[data-k=dest]', tr).value = $('#spsite', out).value; });
  upd();
  f._go = async () => {
    if (!doc) { dupOf = await findImported(S, DT, inv).catch(() => null); if (dupOf && !(await confirmBox('⚠ ' + dupText(dupOf, DT) + '\n\nL\'importer quand même ?'))) return false; }
    const sel = $$('tr[data-i]', out).filter(tr => $('[data-on]', tr).checked).map(tr => {
      const g = k => $(`[data-k=${k}]`, tr).value;
      return { ref: g('ref').trim(), name: g('name').trim(), qty: num(g('qty')), unit: g('unit'), price: num(g('price')), tva: r.items[+tr.dataset.i]?.tva, dest: doc ? '' : g('dest').trim() };
    }).filter(x => x.name);
    for (const x of sel) {
      if (!x.dest) continue;
      const d = byLabel[norm(x.dest)] || dests.find(d => norm(d.label.replace(/^(Chantier|Stock) : /, '')) === norm(x.dest));
      if (!d) throw new Error(`Destination inconnue : « ${x.dest} » (ligne « ${x.name} »). Choisissez un chantier ou un emplacement de la liste, ou videz le champ.`);
      if (d.kind === 'site') x.site = d.id; else x.loc = d.id;
    }
    const cat = $('#spcat', out).checked, stk = !doc && $('#spstk', out).checked, sup = $('#spsup', out).checked, mg = num($('[name=spm]', out).value);
    const loc = doc ? '' : $('#splc', out).value;
    let created = 0, updated = 0, moved = 0, supMsg = ''; const hikes = []; // A8 : hausses de prix par rapport à la fiche produit
    let supplier = null;
    if (sup) { const u = await upsertSupplier(S, inv); if (u) { supplier = u.contact; supMsg = u.isNew ? 'fournisseur créé' : 'fournisseur complété'; } }
    const live = await db.all('products');
    for (const x of sel) { const q = live.find(q => x.ref && q.ref && q.ref.toLowerCase() === x.ref.toLowerCase()) || live.find(q => q.name.toLowerCase() === x.name.toLowerCase()); if (q) { x.pid = q.id; x.sell = q.sell; } }
    if (cat || stk || sel.some(x => x.loc)) {
      for (const x of sel) {
        const toStock = !x.site && (x.loc || stk);
        if (!cat && !toStock) continue;
        let p = live.find(q => x.ref && q.ref && q.ref.toLowerCase() === x.ref.toLowerCase()) || live.find(q => q.name.toLowerCase() === x.name.toLowerCase());
        const isNew = !p;
        if (p && isHike(num(p.buy), x.price)) hikes.push(`${p.name} ${fmtDelta(deltaPct(p.buy, x.price))}`);
        if (!p) {
          p = { stock: {}, tva: 10, tvaBuy: x.tva >= 0 ? x.tva : 20, kind: 'sale', name: x.name, ref: x.ref, unit: x.unit, buy: x.price, sell: Math.round(x.price * (1 + mg / 100) * 100) / 100 };
          if (supplier) p.supplierId = supplier.id;
        } else if (cat) {
          if (x.price > 0) p.buy = x.price;
          if (!p.ref && x.ref) p.ref = x.ref;
          if (supplier && !p.supplierId) p.supplierId = supplier.id;
        }
        const saved = await db.put('products', p);
        if (!live.includes(p)) live.push(saved);
        x.pid = saved.id; x.sell = saved.sell;
        isNew ? created++ : updated++;
        if (toStock && x.qty > 0 && (x.price > 0 || isBL())) { await recordMove(saved, { type: 'in', to: x.loc || loc, qty: x.qty, note: `${dtLabel()} ${inv.number || ''} ${S.name || ''}`.trim(), unit: x.price, purchase: true, sup: S.name || '', ...(x.tva >= 0 ? { tva: x.tva } : {}) }); moved++; }
      }
    }
    /* Chantiers : les achats affectés deviennent des charges du chantier (comptées dans la rentabilité) */
    let charged = 0;
    const bySite = {};
    sel.filter(x => x.site && x.qty > 0).forEach(x => (bySite[x.site] = bySite[x.site] || []).push(x));
    const totAll = sel.reduce((a, x) => a + x.qty * x.price, 0);
    for (const [sid, xs] of Object.entries(bySite)) {
      const st = await db.get('sites', sid); if (!st) continue;
      const date = inv.iso(inv.date) || today(), note = `${dtLabel()} ${inv.number || ''} ${S.name || ''}`.trim();
      const add = xs.map(x => ({ id: db.uid(), pid: x.pid || '', label: x.name, qty: x.qty, unit: x.unit, cost: x.price, date, note, purchase: true, sup: S.name || '', ...(x.tva >= 0 ? { tva: x.tva } : {}) }));
      const feeTotal = r.fees.reduce((a, y) => a + y.amount, 0);
      if (!doc && $('#spfees', out)?.checked && feeTotal && totAll > 0) {
        const share = Math.round(feeTotal * xs.reduce((a, x) => a + x.qty * x.price, 0) / totAll * 100) / 100;
        if (share) add.push({ id: db.uid(), pid: '', label: 'Frais de port / divers (quote-part)', qty: 1, unit: 'forfait', cost: share, date, note, purchase: true, sup: S.name || '', tva: 20 });
      }
      st.charges = [...(st.charges || []), ...add];
      await db.put('sites', st); charged += xs.length;
    }
    let kept = '';
    if (!doc && $('#spkeep', out)?.checked && file) {
      try {
        const yr = (inv.iso(inv.date) || today()).slice(0, 4), nm = `${fl.safe(S.name || 'Fournisseur')}_${DT && DT.key !== 'facture' ? fl.safe(DT.label) + '_' : ''}${fl.safe(inv.number || (DT?.key && DT.key !== 'facture' ? 'document' : 'facture'))}.pdf`;
        const att = await fl.upload(file, { path: ['GestPro', 'Achats fournisseurs', yr], kind: 'achats', name: nm });
        const targets = [];
        if (supplier) targets.push(['contacts', supplier]);
        if (att.fid) for (const sid of Object.keys(bySite)) { const st = await db.get('sites', sid); if (st) targets.push(['sites', st]); }
        att.shared = targets.length > 1;
        if (!att.pending) delete att.path;
        for (const [store, rec] of targets) { rec.files = [...(rec.files || []), { ...att }]; await db.put(store, rec); }
        kept = att.pending ? 'PDF en attente d\'envoi' : 'PDF conservé';
        if (!targets.length) kept += ' (non rattaché : cochez le fournisseur)';
      } catch (err) { alertBox('PDF non enregistré : ' + (err.message || err)); }
    }
    if (doc) {
      opts.onLines(sel.map(x => ({ type: 'line', pid: x.pid || '', desig: x.name, qty: x.qty || 1, unit: x.unit || 'u', pu: x.sell > 0 ? x.sell : Math.round(x.price * (1 + mg / 100) * 100) / 100 })));
      toast(`${sel.length} ligne(s) ajoutée(s) au document`); return;
    }
    if (inv.number && (cat || moved || charged || supplier)) { try { await rememberImported(S, DT, inv, sel.reduce((x, y) => x + y.qty * y.price, 0)); } catch { /* mémoire facultative */ } }
    toast([cat && `${created} produit(s) créé(s), ${updated} mis à jour`, moved && `${moved} entrée(s) en stock`, hikes.length && `hausse de prix : ${hikes.slice(0, 3).join(', ')}${hikes.length > 3 ? '…' : ''}`, charged && `${charged} ligne(s) affectée(s) à des chantiers`, kept, supMsg].filter(Boolean).join(' · ') || 'Terminé');
    refresh();
  };
}
