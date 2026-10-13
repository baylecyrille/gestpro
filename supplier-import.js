// Import d'une facture fournisseur PDF : lecture 100 % locale (pdf.js embarqué), contrôle par l'utilisateur, puis catalogue / stock / fournisseur.
import * as db from './db.js';
import { e, eur, num, F, modal, closeModal, toast, refresh, $, $$ } from './util.js';
import { parseSupplierInvoice, mapUnit } from './supplier-parse.js';
import { recordMove, locLabel, UNITS } from './stock.js';

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

export async function readPdf(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n), h = pg.getViewport({ scale: 1 }).height, tc = await pg.getTextContent();
    pages.push(tc.items.map(i => ({ x: i.transform[4], y: h - i.transform[5], w: i.width, s: i.str })));
  }
  return parseSupplierInvoice(pages);
}

const digits = s => String(s || '').replace(/\D/g, '');

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

export async function supplierImportModal() {
  const [products, locs] = await Promise.all([db.all('products'), db.all('locations')]);
  const body = `<p class="muted">Choisissez la facture d'un fournisseur au format PDF. Le fichier est lu <b>uniquement sur cet appareil</b> : il n'est ni envoyé, ni enregistré. Seules les lignes que vous validez sont ajoutées à votre catalogue.</p>
    <label class="f"><span>Facture fournisseur (PDF)</span><input type="file" id="spf" accept="application/pdf,.pdf"></label><div id="spres"></div>`;
  modal('Facture fournisseur (PDF)', body, async (o, f) => (f._go ? f._go() : false), {
    wide: true, submitLabel: 'Importer la sélection',
    onOpen: f => {
      f.querySelector('footer .btn.primary').hidden = true;
      $('#spf', f).onchange = async ev => {
        const file = ev.target.files[0]; if (!file) return;
        const out = $('#spres', f); out.innerHTML = '<p class="muted">Lecture du PDF…</p>';
        let r;
        try { r = await readPdf(file); } catch (err) { out.innerHTML = `<p class="bad">${e(err.message || err)}</p>`; return; }
        if (!r.items.length) { out.innerHTML = '<p class="bad">Aucune ligne de produit reconnue dans ce PDF (PDF scanné en image ou mise en page inhabituelle). Rien n\'a été importé.</p>'; return; }
        renderReview(f, out, r, products, locs);
      };
    }
  });
}

function renderReview(f, out, r, products, locs) {
  const S = r.supplier, inv = r.invoice;
  const findP = it => products.find(p => it.ref && p.ref && p.ref.toLowerCase() === it.ref.toLowerCase()) || products.find(p => p.name.toLowerCase() === it.name.toLowerCase());
  const rows = r.items.map((it, i) => ({ ...it, i, on: it.price > 0, ex: findP(it) }));
  const nbOn = () => $$('[data-on]:checked', out).length;
  const feeTot = r.fees.reduce((a, x) => a + x.amount, 0);
  out.innerHTML = `
    <div class="card" style="margin:8px 0"><b>${e(S.name || 'Fournisseur non reconnu')}</b>${inv.number ? ` · facture ${e(inv.number)}` : ''}${inv.date ? ` du ${e(inv.date)}` : ''}${inv.due ? ` · échéance ${e(inv.due)}` : ''}<br>
      <span class="muted">${[S.address, [S.zip, S.city].filter(Boolean).join(' '), S.phone, S.email, S.siret && 'SIRET ' + S.siret].filter(Boolean).map(e).join(' · ')}</span></div>
    <p class="${r.sumOk === false ? 'bad' : 'muted'}">${r.items.length} ligne(s) lue(s) — total ${eur(r.sum)} HT${r.sumOk === true ? ' ✔ identique au total de la facture' : r.sumOk === false ? ` ⚠ la facture indique ${eur(r.totals.ht0)} : vérifiez les lignes` : ' (total de la facture non trouvé : vérifiez)'}${r.mode === 'texte' ? ' · lecture approximative, contrôlez chaque ligne' : ''}.
    ${r.fees.length ? `<br>Frais non importés : ${r.fees.map(x => `${e(x.label)} ${eur(x.amount)}`).join(', ')} (total ${eur(feeTot)} HT).` : ''}
    ${rows.some(x => x.price === 0) ? '<br>Les lignes à 0 € (composants d\'un lot déjà facturé) sont décochées.' : ''}</p>
    <div style="overflow:auto;max-height:42vh"><table class="tbl" style="width:100%;font-size:13px"><thead><tr><th><input type="checkbox" id="spall" checked></th><th>Réf.</th><th>Désignation</th><th>Qté</th><th>Unité</th><th>PU achat HT</th><th></th></tr></thead><tbody>
    ${rows.map(x => `<tr data-i="${x.i}" ${x.on ? '' : 'style="opacity:.55"'}><td><input type="checkbox" data-on ${x.on ? 'checked' : ''}></td>
      <td><input data-k="ref" value="${e(x.ref)}" style="width:84px"></td><td><input data-k="name" value="${e(x.name)}" style="min-width:210px;width:100%"></td>
      <td><input data-k="qty" type="number" step="any" value="${x.qty}" style="width:64px"></td>
      <td><select data-k="unit">${UNITS.map(u => `<option ${u === x.unitMapped ? 'selected' : ''}>${u}</option>`).join('')}</select></td>
      <td><input data-k="price" type="number" step="0.01" value="${x.price}" style="width:80px"></td>
      <td>${x.ex ? '<span class="chip ok">existant</span>' : x.price === 0 ? '<span class="chip">lot</span>' : '<span class="chip warn">nouveau</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="cols" style="margin-top:10px">
      <label class="f full"><span><input type="checkbox" id="spcat" checked> Mettre à jour le catalogue (créer les nouveaux produits, actualiser le prix d'achat des existants)</span></label>
      ${F('Marge sur les nouveaux produits (%) → prix de vente', 'spm', 30, { type: 'number', step: '1' })}
      <label class="f"><span><input type="checkbox" id="spstk"> Enregistrer l'entrée en stock</span><select id="splc">${locs.map(l => `<option value="${l.id}">${e(locLabel(l))}</option>`).join('')}</select></label>
      <label class="f full"><span><input type="checkbox" id="spsup" ${S.name ? 'checked' : 'disabled'}> Ajouter / compléter le fournisseur « ${e(S.name || '—')} » dans les contacts</span></label>
    </div><p id="spcnt" class="muted"></p>`;
  const btn = f.querySelector('footer .btn.primary'); btn.hidden = false;
  const upd = () => { $('#spcnt', out).textContent = `${nbOn()} ligne(s) sélectionnée(s).`; btn.disabled = !nbOn() && !$('#spsup', out).checked; };
  out.onchange = ev => {
    if (ev.target.id === 'spall') { $$('[data-on]', out).forEach(c => { c.checked = ev.target.checked; c.closest('tr').style.opacity = c.checked ? '' : '.55'; }); }
    if (ev.target.matches('[data-on]')) ev.target.closest('tr').style.opacity = ev.target.checked ? '' : '.55';
    upd();
  };
  upd();
  f._go = async () => {
    const sel = $$('tr[data-i]', out).filter(tr => $('[data-on]', tr).checked).map(tr => {
      const g = k => $(`[data-k=${k}]`, tr).value;
      return { ref: g('ref').trim(), name: g('name').trim(), qty: num(g('qty')), unit: g('unit'), price: num(g('price')) };
    }).filter(x => x.name);
    const cat = $('#spcat', out).checked, stk = $('#spstk', out).checked, sup = $('#spsup', out).checked, mg = num($('[name=spm]', out).value);
    const loc = $('#splc', out).value;
    let created = 0, updated = 0, moved = 0, supMsg = '';
    let supplier = null;
    if (sup) { const u = await upsertSupplier(S, inv); if (u) { supplier = u.contact; supMsg = u.isNew ? 'fournisseur créé' : 'fournisseur complété'; } }
    if (cat || stk) {
      const live = await db.all('products');
      for (const x of sel) {
        let p = live.find(q => x.ref && q.ref && q.ref.toLowerCase() === x.ref.toLowerCase()) || live.find(q => q.name.toLowerCase() === x.name.toLowerCase());
        const isNew = !p;
        if (!p) {
          if (!cat) continue;
          p = { stock: {}, tva: 10, kind: 'sale', name: x.name, ref: x.ref, unit: x.unit, buy: x.price, sell: Math.round(x.price * (1 + mg / 100) * 100) / 100 };
          if (supplier) p.supplierId = supplier.id;
        } else if (cat) {
          if (x.price > 0) p.buy = x.price;
          if (!p.ref && x.ref) p.ref = x.ref;
          if (supplier && !p.supplierId) p.supplierId = supplier.id;
        }
        const saved = await db.put('products', p);
        if (!live.includes(p)) live.push(saved);
        isNew ? created++ : updated++;
        if (stk && x.qty > 0 && x.price > 0) { await recordMove(saved, { type: 'in', to: loc, qty: x.qty, note: `Facture ${inv.number || ''} ${S.name || ''}`.trim(), unit: x.price }); moved++; }
      }
    }
    toast([cat && `${created} produit(s) créé(s), ${updated} mis à jour`, stk && `${moved} entrée(s) en stock`, supMsg].filter(Boolean).join(' · ') || 'Terminé');
    refresh();
  };
}
