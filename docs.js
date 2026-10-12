// Devis & factures : liste, éditeur, règlements/acomptes, transformation devis → facture, impression PDF.
import * as db from './db.js';
import { getS, logoSrc } from './defaults.js';
import { e, eur, num, round2, dateFr, today, cname, addressAutocomplete, filterBar, bindFilters, F, modal, closeModal, toast, tabs, refresh, go, $, $$ } from './util.js';
import { pickProduct, autoOut, UNITS } from './stock.js';
import * as sheets from './sheets.js';
import * as auth from './auth.js';
import { ensureBlocks, pruneBlocks, copyBlocks, mountBlocks, printRows, setStyles, richField, bindRichFields, readRich, richHtml } from './blocks.js';

const TYPE_RIGHT = { quote: 'quotes', invoice: 'invoices', credit: 'credits' };

const QS = { draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé' };
const IS = { draft: 'Brouillon', pending: 'En attente', sent: 'Envoyée', paid: 'Réglée' };
const normStatus = d => { if (d.type === 'invoice' && d.status === 'issued') d.status = 'pending'; return d; };
const CS = { draft: 'Brouillon', issued: 'Émis' };
const METHODS = [['especes', 'Espèces'], ['cheque', 'Chèque'], ['cb', 'Carte bleue'], ['virement', 'Virement'], ['autre', 'Autre'], ['avoir', 'Avoir (imputation)']];
const REAL_METHODS = METHODS.filter(m => m[0] !== 'avoir');
const TVAS = [['0', '0 %'], ['5.5', '5,5 %'], ['10', '10 %'], ['20', '20 %']];

export function totals(doc) {
  const ht = round2((doc.lines || []).reduce((a, l) => a + num(l.qty) * num(l.pu), 0));
  const tva = round2(ht * num(doc.tva) / 100);
  return { ht, tva, ttc: round2(ht + tva) };
}
export const paidOf = (payments, docId) => round2(payments.filter(p => p.docId === docId).reduce((a, p) => a + num(p.amount), 0));
export function payState(doc, payments) {
  const t = totals(doc).ttc, p = paidOf(payments, doc.id);
  if (t > 0 && p >= t - 0.005) return ['Payée', 'ok'];
  if (p > 0) return ['Partielle', 'warn'];
  return ['À régler', 'bad'];
}

/* Pastille d'état d'une facture : état choisi + règlements encaissés */
export const creditUsed = (payments, id) => round2(payments.filter(p => p.creditId === id).reduce((a, p) => a + num(p.amount), 0));
export function invBadge(doc, payments) {
  normStatus(doc);
  if (doc.type === 'credit') {
    if (doc.status === 'draft') return '<span class="chip">Brouillon</span>';
    const t = totals(doc).ttc, u = creditUsed(payments, doc.id);
    if (t > 0 && u >= t - 0.005) return '<span class="chip ok">Soldé</span>';
    return `<span class="chip warn">${u > 0 ? 'Partiel' : 'À utiliser'}</span>`;
  }
  if (doc.status === 'draft') return '<span class="chip">Brouillon</span>';
  const t = totals(doc).ttc, p = paidOf(payments, doc.id);
  if (doc.status === 'paid' || (t > 0 && p >= t - 0.005)) return '<span class="chip ok">Réglée</span>';
  const part = p > 0 ? '<span class="chip warn">Partielle</span>' : '';
  return `<span class="chip ${doc.status === 'sent' ? 'warn' : 'bad'}">${IS[doc.status] || 'En attente'}</span>${part}`;
}
/* Met l'état de la facture en cohérence avec les règlements (réglée / plus réglée) */
async function syncInvStatus(docId) {
  const d = await db.get('documents', docId);
  if (!d || d.type !== 'invoice') return;
  normStatus(d);
  if (d.status === 'draft') return;
  const t = totals(d).ttc, full = t > 0 && paidOf(await db.all('payments'), docId) >= t - 0.005;
  const ns = full ? 'paid' : d.status === 'paid' ? 'sent' : d.status;
  if (ns !== d.status) { d.status = ns; await db.put('documents', d); }
  if (full) await autoCloseSite(d.siteId);
}

/* Chantier terminé automatiquement quand tout le marché est facturé et toutes les factures sont réglées */
async function autoCloseSite(siteId) {
  if (!siteId) return;
  const S = await getS(); if (S.autoCloseSites === false) return;
  const site = await db.get('sites', siteId);
  if (!site || !['new', 'signed', 'progress'].includes(site.status)) return;
  const [docs, pays] = await Promise.all([db.all('documents'), db.all('payments')]);
  const mine = docs.filter(x => x.siteId === siteId && x.status !== 'draft');
  const invs = mine.filter(x => x.type === 'invoice');
  if (!invs.length || invs.some(x => paidOf(pays, x.id) < totals(x).ttc - 0.005)) return;
  const market = mine.filter(x => x.type === 'quote' && ['accepted', 'invoiced'].includes(x.status)).reduce((a, x) => a + totals(x).ttc, 0);
  const billed = invs.reduce((a, x) => a + totals(x).ttc, 0) - mine.filter(x => x.type === 'credit').reduce((a, x) => a + totals(x).ttc, 0);
  if (market - billed > 0.5) return;
  site.status = 'paid'; if (!site.end) site.end = today();
  await db.put('sites', site); toast('Chantier terminé : tout est facturé et réglé');
}

/* Crée la facture d'un devis (une seule fois) et reprend les règlements déjà encaissés */
async function makeInvoice(q) {
  const inv = await newDoc('invoice', { clientId: q.clientId, siteRef: q.siteRef, siteAddr: q.siteAddr, intro: q.intro, note: q.note, tva: q.tva, terms: q.terms, lines: JSON.parse(JSON.stringify(q.lines)), blocks: q.blocks ? copyBlocks(q.blocks) : undefined, siteId: q.siteId || '', fromQuote: q.id, fromQuoteNumber: q.number, status: 'pending' });
  ensureBlocks(inv);
  inv.number = await nextNumber('invoice');
  await db.put('documents', inv);
  for (const p of (await db.all('payments')).filter(x => x.docId === q.id)) { p.docId = inv.id; p.fromQuote = q.id; await db.put('payments', p); }
  q.status = 'invoiced'; q.invoiceId = inv.id; await db.put('documents', q);
  await syncInvStatus(inv.id); await bumpSite(q);
  return inv;
}

/* Un devis accepté/facturé fait passer son chantier de « Nouveau » à « Signé » */
async function bumpSite(d) {
  if (!d.siteId || d.type !== 'quote' || !['accepted', 'invoiced'].includes(d.status)) return;
  const st = await db.get('sites', d.siteId);
  if (st && st.status === 'new') { st.status = 'signed'; await db.put('sites', st); }
}

async function nextNumber(type) {
  if (sheets.configured() && navigator.onLine) await sheets.sync().catch(() => {}); // récupère les compteurs des autres appareils
  const S = await getS();
  const [pre, key] = type === 'quote' ? [S.quotePrefix, 'quoteNext'] : type === 'credit' ? [S.creditPrefix || 'AV-2026-', 'creditNext'] : [S.invPrefix, 'invNext'];
  if (type === 'credit' && !S.creditNext) S.creditNext = 1;
  const n = pre + String(S[key]).padStart(S.pad, '0');
  S[key] = Number(S[key]) + 1;
  await db.saveSettings(S);
  return n;
}

export async function newDoc(type, extra = {}) {
  const S = await getS();
  return { type, number: '', date: today(), clientId: '', siteRef: '', siteAddr: '', intro: S.intro, note: S.note, tva: S.tva, terms: S.terms, lines: [], status: 'draft', validUntil: '', siteId: '', ...extra };
}

/* ---------- Liste ---------- */
export async function renderDocs(el, tab = 'quote') {
  const allowed = ['quote', 'invoice', 'credit'].filter(t => auth.can(TYPE_RIGHT[t]));
  if (!allowed.includes(tab)) return go('#/docs/' + (allowed[0] || 'quote'));
  const [docs, contacts, payments] = await Promise.all([db.all('documents'), db.all('contacts'), db.all('payments')]);
  const C = Object.fromEntries(contacts.map(c => [c.id, c]));
  const list = docs.filter(d => d.type === tab && auth.canDoc(d)).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
  const cl = [...new Set(list.map(d => d.clientId).filter(Boolean))].map(id => [id, cname(C[id]) || '?']).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const stOpts = tab === 'quote' ? [['', 'Tous'], ...Object.entries(QS)] : tab === 'invoice' ? [['', 'Toutes'], ['unpaid', 'À encaisser'], ['paid', 'Réglées'], ['draft', 'Brouillons']] : [['', 'Tous'], ...Object.entries(CS)];
  const FC = [{ id: 'sort', label: 'Trier par', def: 'dateD', options: [['dateD', 'Date (récent)'], ['dateA', 'Date (ancien)'], ['num', 'Numéro'], ['client', 'Client A→Z'], ['amtD', 'Montant ↓'], ['amtA', 'Montant ↑']] },
    { id: 'status', label: 'Statut', options: stOpts }, { id: 'client', label: 'Client', options: [['', 'Tous'], ...cl] }, { id: 'from', type: 'date', label: 'Du' }, { id: 'to', type: 'date', label: 'Au' }];
  const SORTS = { dateD: (a, b) => (b.date + b.number).localeCompare(a.date + a.number), dateA: (a, b) => (a.date + a.number).localeCompare(b.date + b.number), num: (a, b) => String(a.number).localeCompare(String(b.number), 'fr', { numeric: true }),
    client: (a, b) => cname(C[a.clientId]).localeCompare(cname(C[b.clientId]), 'fr'), amtD: (a, b) => totals(b).ttc - totals(a).ttc, amtA: (a, b) => totals(a).ttc - totals(b).ttc };
  el.innerHTML = `<h2>Devis &amp; factures</h2>${tabs('#/docs', [['quote', 'Devis'], ['invoice', 'Factures'], ['credit', 'Avoirs']].filter(t => allowed.includes(t[0])), tab)}
    <div class="row"><input class="search" id="q" type="search" placeholder="Rechercher (n°, client, chantier)…"><a class="btn primary" href="#/doc/new/${tab}">+ ${tab === 'quote' ? 'Devis' : tab === 'credit' ? 'Avoir' : 'Facture'}</a></div>${filterBar(FC)}<div id="list"></div>`;
  let getF;
  const okStatus = (d, s) => !s || (tab === 'invoice' && s === 'unpaid' ? d.status !== 'draft' && totals(d).ttc - paidOf(payments, d.id) > 0.005 : tab === 'invoice' && s === 'paid' ? d.status !== 'draft' && totals(d).ttc > 0 && totals(d).ttc - paidOf(payments, d.id) <= 0.005 : d.status === s);
  const draw = () => {
    const q = $('#q', el).value.toLowerCase(), F2 = getF ? getF() : {};
    const rows = list.filter(d => (!q || [d.number, cname(C[d.clientId]), d.siteRef, d.siteAddr].join(' ').toLowerCase().includes(q)) && okStatus(d, F2.status) && (!F2.client || d.clientId === F2.client) && (!F2.from || (d.date || '') >= F2.from) && (!F2.to || (d.date || '') <= F2.to)).sort(SORTS[F2.sort] || SORTS.dateD);
    $('#list', el).innerHTML = rows.map(d => {
      const t = totals(d);
      let badge;
      if (d.type === 'invoice' || d.type === 'credit') badge = invBadge(d, payments);
      else badge = `<span class="chip ${d.status === 'accepted' || d.status === 'invoiced' ? 'ok' : d.status === 'refused' ? 'bad' : ''}">${QS[d.status] || ''}</span>`;
      return `<a class="item" href="#/doc/${d.id}" style="text-decoration:none;color:inherit"><div class="main"><div class="t">${e(d.number || '(sans numéro)')} · ${e(cname(C[d.clientId]) || 'Sans client')}</div>
        <div class="s">${dateFr(d.date)}${d.siteRef ? ' · ' + e(d.siteRef) : ''}</div></div><div class="r"><b>${d.type === 'credit' ? '− ' : ''}${eur(t.ttc)}</b><div>${badge}</div></div></a>`;
    }).join('') || `<div class="empty">Aucun ${tab === 'quote' ? 'devis' : tab === 'credit' ? 'avoir' : 'facture'} pour le moment.</div>`;
  };
  getF = bindFilters(el, 'docs_' + tab + '_', FC, draw);
  draw(); $('#q', el).oninput = draw;
}

/* ---------- Éditeur ---------- */
export async function renderDoc(el, id, arg) {
  let cur, isNew = false;
  if (id === 'new') {
    const [ty, sid] = String(arg || '').split('-'); // « quote-<id chantier> » : créé depuis la fiche chantier
    cur = await newDoc(ty === 'invoice' ? 'invoice' : ty === 'credit' ? 'credit' : 'quote'); if (cur.type === 'invoice') cur.status = 'pending'; if (cur.type === 'credit') { cur.status = 'issued'; cur.terms = ''; cur.intro = 'Avoir'; } isNew = true;
    const st = sid && await db.get('sites', sid);
    if (st) Object.assign(cur, { siteId: st.id, clientId: st.clientId, siteRef: st.name, siteAddr: st.address });
  }
  else cur = await db.get('documents', id);
  if (!cur) { el.innerHTML = '<div class="empty">Document introuvable.</div>'; return; }
  normStatus(cur); ensureBlocks(cur);
  if (isNew && !cur.by) cur.by = auth.currentUser()?.id || '';
  if (!auth.canDoc(cur)) { el.innerHTML = '<div class="empty">Vous n\'avez pas accès à ce document.</div>'; return; }
  const canPay = auth.can('invoices'), canInv = auth.can('invoices');
  const [contacts, S, allPay, sites, allDocs] = await Promise.all([db.all('contacts'), getS(), db.all('payments'), db.all('sites'), db.all('documents')]);
  sites.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  setStyles(S);
  const clients = contacts.filter(c => c.kind === 'client').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const isQ = cur.type === 'quote', isC = cur.type === 'credit';
  const DN = Object.fromEntries(allDocs.map(d => [d.id, d]));
  let payments = allPay.filter(p => p.docId === cur.id);

  const siteLabel = x => {
    const nums = allDocs.filter(q => q.siteId === x.id && q.number).sort((a, b) => a.date.localeCompare(b.date)).map(q => q.number).slice(0, 3).join(', ');
    const cl = contacts.find(c => c.id === x.clientId);
    return x.name + (cl ? ' — ' + cname(cl) : '') + (nums ? ' · ' + nums : '');
  };
  const siteText = x => siteLabel(x) + ' ' + (x.address || '') + ' ' + allDocs.filter(q => q.siteId === x.id).map(q => q.number).join(' ');
  const curClient = () => contacts.find(x => x.id === cur.clientId) || {};
  const zonesHtml = () => {
    const defs = zoneDefs(cur, S, curClient()), ov = cur.zones || {}, n = Object.keys(ov).length;
    return `<details class="card zones" ${n ? 'open' : ''}><summary><b>Mise en page – modifier toutes les zones du document</b> <span class="muted">${n ? '(' + n + ' modifiée' + (n > 1 ? 's' : '') + ')' : ''}</span></summary>
      <p class="muted" style="margin:6px 0">Chaque zone imprimée est modifiable pour ce document. Gras : <code>**texte**</code> · souligné : <code>__texte__</code> · jetons automatiques : <code>${ZONE_TOKENS}</code>. Une zone vidée disparaît du document. Les zones non modifiées suivent <a href="#/settings">Réglages › Mise en page des documents</a>.</p>
      <div class="cols">${defs.map(d => { const v = d.k in ov ? ov[d.k] : d.v; return `<label class="f full zrow"><span>${e(d.label)} <button type="button" class="btn sm ghost" data-zr="${d.k}">↺ rétablir</button></span>${d.rows > 1 ? `<textarea name="z_${d.k}" data-zk="${d.k}" rows="${Math.min(d.rows, 6)}">${e(v)}</textarea>` : `<input name="z_${d.k}" data-zk="${d.k}" value="${e(v)}">`}</label>`; }).join('')}</div>
      <div class="row"><button type="button" class="btn" id="zreset">↺ Tout rétablir</button></div></details>`;
  };
  const readZones = () => {
    const defs = zoneDefs(cur, S, curClient()), z = { ...(cur.zones || {}) };
    $$('[data-zk]', el).forEach(i => {
      const k = i.dataset.zk, d = defs.find(x => x.k === k); if (!d) return;
      if (i.dataset.dirty || k in z) { if (i.value === d.v) delete z[k]; else z[k] = i.value; }
    });
    if (Object.keys(z).length) cur.zones = z; else delete cur.zones;
  };

  const draw = () => {
    const t = totals(cur);
    el.innerHTML = `<div class="row"><a class="btn ghost" href="${cur.siteId && sites.some(x => x.id === cur.siteId) ? '#/site/' + cur.siteId : '#/docs/' + cur.type}">← Retour</a><span class="sp"></span>
      <span class="seg"><button type="button" class="btn sm on" id="vedit">✎ Éditeur</button><button type="button" class="btn sm" id="vprev">👁 Aperçu</button></span>
      ${!isNew ? '<button class="btn" id="print">Imprimer / PDF</button>' : ''}<button class="btn primary" id="save">Enregistrer</button></div>
    <div id="pvwrap" hidden></div><div id="edwrap">
    <h2>${isQ ? 'Devis' : isC ? 'Avoir' : 'Facture'} ${e(cur.number || '(nouveau)')}</h2>${isC && cur.fromInvoice ? `<p class="muted" style="margin-top:-6px">sur la facture <a href="#/doc/${cur.fromInvoice}">${e(cur.fromInvoiceNumber || '')}</a></p>` : ''}
    <div class="card"><div class="cols">
      <label class="f full"><span>Client</span><input type="search" id="csearch" placeholder="🔍 Rechercher un client (nom, ville, code postal)…" autocomplete="off" style="margin-bottom:6px"><div style="display:flex;gap:6px"><select name="clientId"><option value="">— choisir —</option>${clients.map(c => `<option value="${c.id}" ${c.id === cur.clientId ? 'selected' : ''}>${e(cname(c))}${c.city ? ' — ' + e(c.city) : ''}</option>`).join('')}</select><button type="button" class="btn" id="newc">+</button></div></label>
      <label class="f full"><span>Chantier</span><input type="search" id="ssearch" placeholder="🔍 Rechercher un chantier (nom, client, n° de devis ou de facture, adresse)…" autocomplete="off" style="margin-bottom:6px"><div style="display:flex;gap:6px"><select name="siteId"><option value="">— aucun —</option>${sites.map(x => `<option value="${x.id}" ${x.id === cur.siteId ? 'selected' : ''}>${e(siteLabel(x))}</option>`).join('')}</select><button type="button" class="btn" id="newsite" title="Créer un chantier pour ce document">+</button></div></label>
      ${F('Date', 'date', cur.date, { type: 'date' })}
      ${F(isQ ? 'N° de devis' : isC ? 'N° d\'avoir' : 'N° de facture', 'number', cur.number, { ph: 'automatique à l\'enregistrement' })}${isQ ? F('Valable jusqu\'au', 'validUntil', cur.validUntil, { type: 'date' }) : ''}
      ${F('Réf. chantier', 'siteRef', cur.siteRef, { cls: 'full' })}
      ${F('Adresse du chantier', 'siteAddr', cur.siteAddr, { type: 'textarea', rows: 2, cls: 'full' })}
      ${richField('Intitulé', 'intro', cur.intro)}
      ${richField(isC ? 'Motif de l\'avoir' : 'Remarque', 'note', cur.note, { rows: 3 })}
      ${F('Statut', 'status', cur.status, { type: 'select', options: Object.entries(isQ ? Object.fromEntries(Object.entries(QS).filter(([k]) => k !== 'invoiced' || canInv || cur.status === 'invoiced')) : isC ? CS : IS) })}
      ${F('TVA', 'tva', cur.tva, { type: 'select', options: TVAS })}
    </div></div>
    <div class="card lines"><div id="blocks"></div>
      <div class="totals"><div><span>Total HT</span><b id="tht">${eur(t.ht)}</b></div><div><span>TVA ${cur.tva} %</span><b id="ttva">${eur(t.tva)}</b></div><div class="big"><span>Total TTC</span><span id="tttc">${eur(t.ttc)}</span></div></div></div>
    ${isC ? '' : F('Conditions de règlement', 'terms', cur.terms, { type: 'textarea', rows: 5 })}
    ${zonesHtml()}
    ${!isNew ? (isC ? creditUseHtml(t) : canPay ? paymentsHtml(t, payments) : '') : `<p class="muted">Enregistrez le document pour gérer ${isC ? 'son utilisation' : 'les règlements'}.</p>`}
    ${!isNew ? actionsHtml() : ''}</div>`;
    bind();
  };

  const paymentsHtml = (t, pays) => {
    const paid = round2(pays.reduce((a, p) => a + num(p.amount), 0));
    const left = round2(t.ttc - paid);
    return `<div class="card"><h3 style="margin-top:0">Règlements &amp; acomptes</h3>
      <div class="bar"><i style="width:${t.ttc ? Math.min(100, paid / t.ttc * 100) : 0}%"></i></div>
      <p>Encaissé <b>${eur(paid)}</b> sur ${eur(t.ttc)} · reste <b>${eur(left)}</b></p>
      ${pays.sort((a, b) => a.date.localeCompare(b.date)).map(p => `<div class="item" data-pay="${p.id}"><div class="main"><div class="t">${eur(p.amount)}</div><div class="s">${dateFr(p.date)} · ${e(METHODS.find(m => m[0] === p.method)?.[1] || '')}${p.chequeNo ? ' n° ' + e(p.chequeNo) : ''}${p.bank ? ' · ' + e(p.bank) : ''}${p.note ? ' · ' + e(p.note) : ''}</div></div><span class="chip">${e(p.creditId ? 'Avoir' : p.kind === 'acompte' ? 'Acompte' : 'Règlement')}</span></div>`).join('')}
      <div class="row"><span class="muted">Encaisser :</span><button class="btn primary" data-m="especes">💶 Espèces</button><button class="btn primary" data-m="cheque">🧾 Chèque</button><button class="btn primary" data-m="cb">💳 Carte bleue</button><button class="btn" id="addpay">Autre…</button></div>
      <div class="row"><button class="btn" data-pct="30">Acompte 30 %</button><button class="btn" data-pct="40">40 %</button><button class="btn" id="rest">Solde</button></div></div>`;
  };
  const creditUseHtml = t => {
    const uses = allPay.filter(p => p.creditId === cur.id).sort((a, b) => a.date.localeCompare(b.date));
    const used = round2(uses.reduce((a, p) => a + num(p.amount), 0)), left = round2(t.ttc - used);
    return `<div class="card"><h3 style="margin-top:0">Utilisation de l'avoir</h3>
      <div class="bar"><i style="width:${t.ttc ? Math.min(100, used / t.ttc * 100) : 0}%"></i></div>
      <p>Utilisé <b>${eur(used)}</b> sur ${eur(t.ttc)} · reste <b>${eur(Math.max(0, left))}</b> ${left <= 0.005 && t.ttc ? '<span class="chip ok">Soldé</span>' : ''}</p>
      ${uses.map(p => `<div class="item" data-use="${p.id}"><div class="main"><div class="t">${eur(p.amount)}</div><div class="s">${dateFr(p.date)} · ${p.kind === 'avoir' ? 'Déduit de la facture ' + e(DN[p.docId]?.number || '') : 'Remboursé – ' + e(METHODS.find(m => m[0] === p.method)?.[1] || '')}${p.chequeNo ? ' n° ' + e(p.chequeNo) : ''}${p.bank ? ' · ' + e(p.bank) : ''}${p.note && p.kind !== 'avoir' ? ' · ' + e(p.note) : ''}</div></div><span class="chip">${p.kind === 'avoir' ? 'Déduction' : 'Remboursement'}</span></div>`).join('')}
      <div class="row"><button class="btn primary" id="deduct">Déduire d'une facture</button><button class="btn primary" id="refund">Rembourser le client</button></div></div>`;
  };
  const creditsOfInv = allDocs.filter(d => d.type === 'credit' && d.fromInvoice === cur.id);
  const actionsHtml = () => `<div class="card"><div class="row">
      ${isC ? (cur.fromInvoice && DN[cur.fromInvoice] ? `<a class="btn" href="#/doc/${cur.fromInvoice}">Voir la facture</a>` : '') : ''}
      ${!isQ && !isC && cur.status !== 'draft' ? '<button class="btn" id="tocredit">Créer un avoir</button>' : ''}
      ${isQ ? `${canInv ? '<button class="btn primary" id="toinv">Transformer en facture</button>' : ''}${cur.status !== 'accepted' && cur.status !== 'invoiced' ? '<button class="btn" id="accept">Marquer accepté</button>' : ''}` : (isC ? '' : cur.stockOut ? '<span class="chip ok">Stock déjà déduit</span>' : '<button class="btn" id="stockout">Déduire du stock</button>')}
      <button class="btn danger" id="delete">Supprimer</button></div>${creditsOfInv.length ? `<p class="muted" style="margin-bottom:0">Avoirs : ${creditsOfInv.map(c => `<a href="#/doc/${c.id}">${e(c.number || '(brouillon)')}</a>`).join(', ')}</p>` : ''}</div>`;

  const refreshTotals = () => {
    const t = totals(cur);
    $('#tht', el).textContent = eur(t.ht); $('#ttva', el).textContent = eur(t.tva); $('#tttc', el).textContent = eur(t.ttc);
  };

  const readHeader = () => {
    $$('[name]', el).forEach(i => { if (i.name in cur || ['clientId', 'validUntil', 'number', 'siteId'].includes(i.name)) cur[i.name] = i.value; });
    Object.assign(cur, readRich(el));
    readZones();
    cur.tva = num(cur.tva);
  };

  const save = async () => {
    readHeader();
    if (!cur.clientId) { toast('Choisissez un client'); return false; }
    if (!cur.number && (cur.type === 'quote' || cur.status !== 'draft')) cur.number = await nextNumber(cur.type);
    pruneBlocks(cur);
    await db.put('documents', cur);
    if (isQ && cur.status === 'invoiced' && !cur.invoiceId) { // devis passé à « Facturé » : la facture est créée automatiquement
      if (cur.invoiceId = (await makeInvoice(cur)).id) { toast('Facture créée à partir du devis'); go('#/doc/' + cur.invoiceId); return true; }
    }
    if (!isQ && !isC) await syncInvStatus(cur.id);
    await bumpSite(cur);
    if (isNew) { toast('Enregistré'); location.hash = '#/doc/' + cur.id; } else { toast('Enregistré'); refresh(); }
    return true;
  };

  /* Créer un avoir à partir de la facture courante */
  const creditModal = () => modal('Créer un avoir',
    `<p class="muted">Avoir sur la facture <b>${e(cur.number)}</b> (${eur(totals(cur).ttc)} TTC).</p>
    ${F('Type', 'mode', 'total', { type: 'select', options: [['total', 'Avoir total (reprend toutes les lignes)'], ['partial', 'Avoir partiel (je saisis le montant)']] })}
    ${F('Motif', 'reason', '', { ph: 'ex : malfaçon, remise accordée, erreur de facturation…' })}`,
    async o => {
      const cr = await newDoc('credit', { clientId: cur.clientId, siteId: cur.siteId || '', siteRef: cur.siteRef, siteAddr: cur.siteAddr, tva: cur.tva, terms: '', intro: 'Avoir sur facture ' + cur.number, note: o.reason, status: 'issued', fromInvoice: cur.id, fromInvoiceNumber: cur.number,
        lines: o.mode === 'total' ? JSON.parse(JSON.stringify(cur.lines)) : [{ desig: 'Remise / geste commercial', qty: 1, unit: 'u', pu: 0 }] });
      cr.number = await nextNumber('credit'); await db.put('documents', cr);
      toast(`Avoir ${cr.number} créé`); go('#/doc/' + cr.id);
    }, { submitLabel: 'Créer l\'avoir' });

  /* Utilisation d'un avoir : déduction d'une facture ou remboursement du client */
  const bindCredit = t => {
    const used = creditUsed(allPay, cur.id), left = Math.max(0, round2(t.ttc - used));
    const delUse = async id => { const p = allPay.find(x => x.id === id); await db.del('payments', id); if (p.kind === 'avoir') await syncInvStatus(p.docId); refresh(); };
    $$('[data-use]', el).forEach(n => n.onclick = () => { if (confirm('Annuler cette utilisation de l\'avoir ?')) delUse(n.dataset.use); });
    $('#deduct', el).onclick = () => {
      if (cur.status === 'draft') return toast('Passez d\'abord l\'avoir en « Émis »');
      const restOf = d => round2(totals(d).ttc - paidOf(allPay, d.id));
      const invs = allDocs.filter(d => d.type === 'invoice' && d.clientId === cur.clientId && d.status !== 'draft' && restOf(d) > 0.005);
      if (!invs.length) return toast('Aucune facture de ce client à régler');
      if (left <= 0.005) return toast('Avoir déjà soldé');
      const first = invs.find(d => d.id === cur.fromInvoice) || invs[0];
      modal('Déduire d\'une facture',
        `<div class="cols"><label class="f full"><span>Facture</span><select name="docId">${invs.map(d => `<option value="${d.id}" ${d.id === first.id ? 'selected' : ''}>${e(d.number)} · reste ${eur(restOf(d))}</option>`).join('')}</select></label>
        ${F('Montant (€)', 'amount', Math.min(left, restOf(first)), { type: 'number', step: '0.01', req: true })}${F('Date', 'date', today(), { type: 'date' })}</div>`,
        async o => {
          const inv = DN[o.docId], amount = num(o.amount);
          if (amount <= 0 || amount > left + 0.005) { alert(`Montant invalide (reste ${eur(left)} sur l'avoir).`); return false; }
          if (amount > restOf(inv) + 0.005) { alert(`Ce montant dépasse le reste à payer de la facture (${eur(restOf(inv))}).`); return false; }
          await db.put('payments', { docId: inv.id, creditId: cur.id, amount, date: o.date, method: 'avoir', kind: 'avoir', note: 'Avoir ' + cur.number });
          await syncInvStatus(inv.id); toast('Avoir déduit de la facture'); refresh();
        }, { onOpen: f => { f.querySelector('[name=docId]').onchange = ev => { f.querySelector('[name=amount]').value = Math.min(left, restOf(DN[ev.target.value])); }; } });
    };
    $('#refund', el).onclick = () => {
      if (cur.status === 'draft') return toast('Passez d\'abord l\'avoir en « Émis »');
      if (left <= 0.005) return toast('Avoir déjà soldé');
      modal('Rembourser le client',
        `<div class="cols">${F('Montant remboursé (€)', 'amount', left, { type: 'number', step: '0.01', req: true })}${F('Date', 'date', today(), { type: 'date' })}
        ${F('Mode', 'method', 'virement', { type: 'select', options: REAL_METHODS })}<span></span>
        <div class="full chq" hidden><div class="cols">${F('N° du chèque', 'chequeNo', '', {})}${F('Banque', 'bank', '', {})}</div></div>
        ${F('Note', 'note', '', { cls: 'full' })}</div>`,
        async o => {
          const amount = num(o.amount);
          if (amount <= 0 || amount > left + 0.005) { alert(`Montant invalide (reste ${eur(left)} sur l'avoir).`); return false; }
          if (o.method !== 'cheque') { o.chequeNo = ''; o.bank = ''; }
          await db.put('payments', { ...o, docId: cur.id, creditId: cur.id, amount, kind: 'remboursement' });
          toast('Remboursement enregistré'); refresh();
        }, { submitLabel: 'Enregistrer', onOpen: f => { const m = f.querySelector('[name=method]'), c = f.querySelector('.chq'); m.onchange = () => { c.hidden = m.value !== 'cheque'; }; } });
    };
  };

  const bind = () => {
    bindRichFields(el);
    let pvChanged = false;
    const renderPv = async () => {
      const c = JSON.parse(JSON.stringify(cur)); pruneBlocks(c);
      $('#pvpaper', el).innerHTML = await sheetHtml(c, { edit: true });
    };
    const commitZone = (k, val) => {
      const d = zoneDefs(cur, S, curClient()).find(x => x.k === k); if (!d) return;
      const z = { ...(cur.zones || {}) };
      if (val === d.v) delete z[k]; else z[k] = val;
      if (Object.keys(z).length) cur.zones = z; else delete cur.zones;
      pvChanged = true;
    };
    const showPv = async on => {
      if (on) {
        readHeader(); pvChanged = false;
        $('#pvwrap', el).innerHTML = `<p class="muted" style="margin:6px 0">Aperçu tel qu'il sera imprimé. <b>Cliquez sur une zone pour modifier son texte</b> ; ajustez la disposition ci-dessous (rien n'est enregistré avant « Enregistrer »).</p>
          <details class="card pvtools"><summary><b>Ajuster la disposition</b> <span class="muted">(tailles, alignements, colonnes)</span></summary><div class="cols">${layoutFields(cur.layout || {}, layoutOf(S, null), 'data-lk')}</div><div class="row"><button type="button" class="btn" id="lyreset">↺ Rétablir les réglages généraux</button></div></details>
          <div class="pvpaper" id="pvpaper"></div>`;
        await renderPv();
        const onLy = async () => { const o = readLayout($('#pvwrap', el), 'data-lk'); if (Object.keys(o).length) cur.layout = o; else delete cur.layout; pvChanged = true; await renderPv(); };
        $$('[data-lk]', $('#pvwrap', el)).forEach(i => { i.addEventListener('input', onLy); i.addEventListener('change', onLy); });
        $('#lyreset', el).onclick = () => { $$('[data-lk]', $('#pvwrap', el)).forEach(i => { i.value = ''; }); onLy(); };
        $('#pvpaper', el).addEventListener('click', ev => {
          const zn = ev.target.closest('.zn'); if (!zn || zn.querySelector('textarea')) return;
          const k = zn.dataset.z, d = zoneDefs(cur, S, curClient()).find(x => x.k === k); if (!d) return;
          const val = cur.zones && k in cur.zones ? cur.zones[k] : d.v;
          zn.innerHTML = `<textarea class="zta" rows="${Math.max(1, Math.min(8, val.split('\n').length))}">${e(val)}</textarea>`;
          const ta = zn.querySelector('textarea'); ta.focus();
          let done = false; const end = async ok => { if (done) return; done = true; if (ok) commitZone(k, ta.value); await renderPv(); };
          ta.addEventListener('blur', () => end(true));
          ta.addEventListener('keydown', kev => { if (kev.key === 'Escape') end(false); });
        });
      } else if (pvChanged) { pvChanged = false; draw(); return; }
      $('#pvwrap', el).hidden = !on; $('#edwrap', el).hidden = on;
      $('#vedit', el).classList.toggle('on', !on); $('#vprev', el).classList.toggle('on', on);
      if (on) window.scrollTo?.(0, 0);
    };
    $('#vprev', el).onclick = () => showPv(true); $('#vedit', el).onclick = () => showPv(false);
    addressAutocomplete($('[name=siteAddr]', el), it => { $('[name=siteAddr]', el).value = it.label; });
    mountBlocks($('#blocks', el), cur, { onChange: refreshTotals, readHeader });
    $$('[data-zk]', el).forEach(i => i.addEventListener('input', () => { i.dataset.dirty = '1'; }));
    const zset = (k, v) => { const i = $(`[data-zk="${k}"]`, el); if (i) { i.value = v; delete i.dataset.dirty; } };
    $$('[data-zr]', el).forEach(b => b.onclick = () => { const d = zoneDefs(cur, S, curClient()).find(x => x.k === b.dataset.zr); if (cur.zones) delete cur.zones[b.dataset.zr]; if (d) zset(d.k, d.v); });
    $('#zreset', el).onclick = () => { delete cur.zones; zoneDefs(cur, S, curClient()).forEach(d => zset(d.k, d.v)); };
    $('[name=clientId]', el).addEventListener('change', () => { cur.clientId = $('[name=clientId]', el).value; const d = zoneDefs(cur, S, curClient()).find(x => x.k === 'client'), i = $('[data-zk=client]', el); if (d && i && !i.dataset.dirty && !(cur.zones && 'client' in cur.zones)) i.value = d.v; });
    $('#ssearch', el).oninput = ev => {
      const q = ev.target.value.toLowerCase().trim(), sel = $('[name=siteId]', el), keep = sel.value;
      const rows = sites.filter(x => x.id === keep || !q || siteText(x).toLowerCase().includes(q));
      sel.innerHTML = '<option value="">— aucun —</option>' + rows.map(x => `<option value="${x.id}" ${x.id === keep ? 'selected' : ''}>${e(siteLabel(x))}</option>`).join('');
      const m = rows.filter(x => x.id !== keep);
      if (q && !keep && m.length === 1) { sel.value = m[0].id; sel.dispatchEvent(new Event('change')); }
    };
    $('#newsite', el).onclick = () => {
      readHeader();
      import('./sites.js').then(m => m.newSiteModal({ clientId: cur.clientId, name: cur.siteRef || cname(curClient()) || '', address: cur.siteAddr || '' }, st => {
        sites.push(st); cur.siteId = st.id; if (!cur.siteRef) cur.siteRef = st.name; if (!cur.siteAddr) cur.siteAddr = st.address || ''; if (!cur.clientId) cur.clientId = st.clientId || ''; draw(); toast('Chantier créé et rattaché – pensez à enregistrer le document');
      }));
    };
    $('#csearch', el).oninput = ev => {
      const q = ev.target.value.toLowerCase().trim(), sel = $('[name=clientId]', el), keep = sel.value;
      const rows = clients.filter(c => c.id === keep || !q || [c.civ, c.name, c.company, c.city, c.zip].join(' ').toLowerCase().includes(q));
      sel.innerHTML = '<option value="">— choisir —</option>' + rows.map(c => `<option value="${c.id}" ${c.id === keep ? 'selected' : ''}>${e(cname(c))}${c.city ? ' — ' + e(c.city) : ''}</option>`).join('');
      const m = rows.filter(c => c.id !== keep);
      if (q && !keep && m.length === 1) sel.value = m[0].id;
      else if (q && m.length === 1 && rows.length === 2) sel.value = m[0].id;
    };
    $('#newc', el).onclick = () => { readHeader(); import('./app.js').then(m => m.contactModal(null, 'client', c => { clients.push(c); cur.clientId = c.id; draw(); })); };
    $('[name=siteId]', el).onchange = () => {
      const prev = cur.siteId; readHeader(); const st = sites.find(x => x.id === cur.siteId);
      if (st) { if (!cur.clientId) cur.clientId = st.clientId || ''; if (!cur.siteRef || sites.find(x => x.id === prev)?.name === cur.siteRef) cur.siteRef = st.name; if (!cur.siteAddr) cur.siteAddr = st.address || ''; }
      draw();
    };
    $('#save', el).onclick = save;
    if (isNew) return;
    $('#print', el).onclick = async () => { readHeader(); pruneBlocks(cur); await db.put('documents', cur); printDoc(cur); };
    $('#delete', el).onclick = async () => {
      if (!confirm('Supprimer ce document et ses règlements ?')) return;
      if (isC) { for (const p of allPay.filter(x => x.creditId === cur.id)) { await db.del('payments', p.id); if (p.kind === 'avoir') await syncInvStatus(p.docId); } }
      else for (const p of payments) await db.del('payments', p.id);
      await db.del('documents', cur.id); go('#/docs/' + cur.type);
    };
    const payModal = (p, amount = '', method = 'virement') => {
      const isNewP = !p; p = p || { docId: cur.id, date: today(), method, kind: amount !== '' && round2(amount) >= round2(totals(cur).ttc - paidOf(payments, cur.id)) - 0.005 ? 'solde' : 'acompte' };
      modal(isNewP ? 'Encaissement' : 'Règlement',
        `<div class="cols">${F('Montant TTC (€)', 'amount', p.amount ?? amount, { type: 'number', step: '0.01', req: true })}${F('Date', 'date', p.date, { type: 'date' })}
        ${F('Mode', 'method', p.method, { type: 'select', options: REAL_METHODS })}${F('Nature', 'kind', p.kind, { type: 'select', options: [['acompte', 'Acompte'], ['solde', 'Règlement / solde']] })}
        <div class="full chq" ${p.method === 'cheque' ? '' : 'hidden'}><div class="cols">${F('N° du chèque', 'chequeNo', p.chequeNo, {})}${F('Banque', 'bank', p.bank, {})}</div></div>
        ${F('Note (ticket CB, remarque…)', 'note', p.note, { cls: 'full' })}</div>`,
        async o => { if (o.method !== 'cheque') { o.chequeNo = ''; o.bank = ''; } Object.assign(p, o, { amount: num(o.amount) }); await db.put('payments', p); await syncInvStatus(cur.id); refresh(); },
        { del: isNewP ? null : async () => { await db.del('payments', p.id); await syncInvStatus(cur.id); refresh(); },
          onOpen: f => { const m = f.querySelector('[name=method]'), c = f.querySelector('.chq'); m.onchange = () => { c.hidden = m.value !== 'cheque'; }; } });
    };
    const t = totals(cur), paid = paidOf(payments, cur.id);
    const left = Math.max(0, round2(t.ttc - paid));
    if (isC) return bindCredit(t);
    $('#tocredit', el)?.addEventListener('click', () => creditModal());
    if (canPay) {
      $('#addpay', el).onclick = () => payModal();
      $$('[data-m]', el).forEach(b => b.onclick = () => payModal(null, left || '', b.dataset.m));
      $$('[data-pct]', el).forEach(b => b.onclick = () => payModal(null, round2(t.ttc * +b.dataset.pct / 100)));
      $('#rest', el).onclick = () => payModal(null, Math.max(0, round2(t.ttc - paid)));
      $$('[data-pay]', el).forEach(n => n.onclick = () => { const p = payments.find(x => x.id === n.dataset.pay); if (p.creditId) go('#/doc/' + p.creditId); else payModal(p); });
    }
    if (isQ) {
      $('#accept', el)?.addEventListener('click', async () => { readHeader(); cur.status = 'accepted'; await db.put('documents', cur); await bumpSite(cur); toast('Devis accepté'); refresh(); });
      if (canInv) $('#toinv', el).onclick = async () => {
        if (cur.status !== 'accepted' && !confirm('Ce devis n\'est pas marqué « accepté ». Créer la facture quand même ?')) return;
        readHeader();
        if (cur.invoiceId && !confirm('Une facture existe déjà pour ce devis. En créer une autre ?')) return;
        const inv = await makeInvoice(cur);
        toast(`Facture ${inv.number} créée`); go('#/doc/' + inv.id);
      };
      if (cur.invoiceId && canInv) $('#toinv', el).insertAdjacentHTML('afterend', `<a class="btn" href="#/doc/${cur.invoiceId}">Voir la facture</a>`);
    } else {
      $('#stockout', el)?.addEventListener('click', async () => {
        if (!confirm('Déduire du stock les produits de cette facture ?')) return;
        const n = await autoOut(cur.lines, cur.number, cur.siteId || ''); cur.stockOut = true; await db.put('documents', cur);
        toast(n ? 'Stock mis à jour' : 'Aucune ligne liée au stock'); refresh();
      });
    }
  };
  draw();
}

/* ---------- Impression ---------- */
/* ---------- Zones modifiables du document ----------
   Chaque zone imprimée a un texte par défaut (calculé depuis les Réglages / le client / le document).
   doc.zones ne contient que les zones modifiées à la main pour CE document.
   Balisage : **gras**  __souligné__ ; jetons : {numero} {date} {ville} {validite} {siteRef} {siteAddr} {company} {iban} {bic} */
export const ZONE_TOKENS = '{numero} {date} {ville} {validite} {siteRef} {siteAddr} {company} {iban} {bic}';
export function zoneDefs(doc, S, c = {}, base = false) {
  const isQ = doc.type === 'quote', isC = doc.type === 'credit', ty = isQ ? 'q' : isC ? 'c' : 'i';
  const addr = [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  const T = isQ ? 'Devis' : isC ? 'Avoir' : 'Facture';
  const L = [
    ['coName', 'En-tête – nom de l\'entreprise', S.sub || S.company || '', 2, 'qic'],
    ['coInfo', 'En-tête – coordonnées de l\'entreprise', [S.owner ? '**' + S.owner + '**' : '', S.address, S.phone, S.legal, S.email, S.web, S.siret ? 'N°SIRET : ' + S.siret : ''].filter(Boolean).join('\n'), 7, 'qic'],
    ['certs', 'En-tête – RGE / assurances', [S.rge ? '**RGE** Numéro ' + S.rge : '', S.insurance ? 'Assurance Responsabilité Travaux ' + S.insurance : '', S.insurance ? 'Assurance Responsabilité Civile ' + S.insurance : ''].filter(Boolean).join('\n'), 3, 'qic'],
    ['client', 'Bloc client (destinataire)', [cname(c) || '', c.company ? [c.companyCiv, c.company].filter(Boolean).join(' ') : '', addr].filter(Boolean).join('\n'), 4, 'qic'],
    ['chantier', 'Bloc « Réf chantier »', '**__Réf chantier :__**\n{siteRef}\n**{siteAddr}**', 3, 'qic'],
    ['title', 'Titre du document', T + ' {numero}', 1, 'qic'],
    ['dateLine', 'Ligne ville / date', '**{ville}, le   {date}**', 1, 'qic'],
    ['validLine', 'Validité du devis', 'Valable jusqu\'au {validite}', 1, 'q'],
    ['thDes', 'Tableau – colonne 1', 'DESIGNATION', 1, 'qic'],
    ['thQty', 'Tableau – colonne 2', 'Qté', 1, 'qic'],
    ['thUnit', 'Tableau – colonne 3', 'Unité', 1, 'qic'],
    ['thPu', 'Tableau – colonne 4', 'Prix unit.', 1, 'qic'],
    ['thHt', 'Tableau – colonne 5', 'Prix H.T', 1, 'qic'],
    ['lblHt', 'Totaux – libellé HT', 'Total HT', 1, 'qic'],
    ['lblTva', 'Totaux – libellé TVA', 'TVA', 1, 'qic'],
    ['lblTtc', 'Totaux – libellé TTC', isC ? 'Total TTC de l\'avoir' : 'Total TTC', 1, 'qic'],
    ['lblPaid', 'Totaux – déjà réglé', isC ? 'Déjà déduit / remboursé' : 'Déjà réglé', 1, 'ic'],
    ['lblLeft', 'Totaux – reste', isC ? 'Reste à votre crédit' : 'Reste à payer', 1, 'ic'],
    ['methods', 'Moyens de paiement acceptés', '**Moyens de paiement acceptés :** ' + REAL_METHODS.filter(m => m[0] !== 'autre').map(m => m[1]).join(', ') + '.', 2, 'q'],
    ['creditTxt', 'Mention de l\'avoir', '**Avoir** – à déduire de votre prochaine facture ou remboursé.', 2, 'c'],
    ['lblMotif', 'Libellé du motif', 'Motif :', 1, 'c'],
    ['payLbl', 'Titre du bloc règlement', '**Règlement**', 1, 'qi'],
    ['sigLeft', 'Signature (gauche)', isQ ? '**Bon pour accord – date et signature du client**' : '**Signature Entrepreneur**', 2, 'qic'],
    ['bank', 'Coordonnées bancaires (droite)', S.iban && !isC ? '**__Vous pouvez régler cette facture par virement__**\n**{company}**\n**IBAN** : {iban}\n**Code BIC** : {bic}' : '', 4, 'qi'],
  ];
  const so = (!base && S.zones && S.zones[ty]) || {}; // réglages généraux (Réglages > Mise en page des documents)
  return L.filter(z => z[4].includes(ty)).map(([k, label, v, rows]) => ({ k, label, v: k in so ? so[k] : v, rows }));
}
/* Disposition (tailles, alignements, colonnes) : valeurs vides = défaut. Réglages (S.layout) puis exception par document (doc.layout). */
export const LAYOUT = [
  ['fs', 'Taille du texte (px)', 'num', 9, 18, 12.5, 0.5],
  ['nmfs', 'Taille du nom de l\'entreprise (px)', 'num', 10, 30, 15, 1],
  ['clfs', 'Taille du bloc client (px)', 'num', 9, 24, 14, 1],
  ['h1', 'Taille du titre (px)', 'num', 12, 36, 19, 1],
  ['h1al', 'Alignement du titre', 'sel', [['', 'Gauche (défaut)'], ['center', 'Centré'], ['right', 'Droite']]],
  ['dateAl', 'Alignement de la date', 'sel', [['', 'Gauche (défaut)'], ['center', 'Centré'], ['right', 'Droite']]],
  ['logo', 'Hauteur du logo (px)', 'num', 20, 200, 90, 5],
  ['cQty', 'Largeur colonne Qté (%)', 'num', 4, 30, '', 1],
  ['cUnit', 'Largeur colonne Unité (%)', 'num', 4, 30, '', 1],
  ['cPu', 'Largeur colonne Prix unit. (%)', 'num', 6, 30, '', 1],
  ['cHt', 'Largeur colonne Prix H.T (%)', 'num', 6, 30, '', 1],
  ['pad', 'Hauteur des lignes du tableau (px)', 'num', 1, 16, 5, 1],
  ['sigH', 'Hauteur de l\'espace signature (px)', 'num', 20, 200, 60, 5],
];
const lyNum = (d, v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : Math.min(d[4], Math.max(d[3], n)); };
export function layoutOf(S, doc) { const o = { ...(S.layout || {}), ...(doc?.layout || {}) }; Object.keys(o).forEach(k => { if (o[k] === '' || o[k] == null) delete o[k]; }); return o; }
function layoutStyle(LY) {
  const css = { fs: '--fs', nmfs: '--nmfs', clfs: '--clfs', h1: '--h1', logo: '--logo', pad: '--pad', sigH: '--sigh' }, out = [];
  for (const d of LAYOUT) {
    if (!(d[0] in LY)) continue;
    if (d[2] === 'num' && css[d[0]]) { const n = lyNum(d, LY[d[0]]); if (n != null) out.push(css[d[0]] + ':' + n + 'px'); }
    else if (d[0] === 'h1al' && ['center', 'right'].includes(LY.h1al)) out.push('--h1al:' + LY.h1al);
    else if (d[0] === 'dateAl' && ['center', 'right'].includes(LY.dateAl)) out.push('--dateal:' + LY.dateAl);
  }
  return out.join(';');
}
function colgroup(LY) {
  const cols = [['cQty', 9], ['cUnit', 8], ['cPu', 14], ['cHt', 14]];
  if (!cols.some(([k]) => LY[k] != null)) return '';
  return '<colgroup><col>' + cols.map(([k, dv]) => `<col style="width:${lyNum(LAYOUT.find(d => d[0] === k), LY[k] ?? dv) ?? dv}%">`).join('') + '</colgroup>';
}
export function layoutFields(vals, base, attr) {
  return LAYOUT.map(d => d[2] === 'sel'
    ? `<label class="f"><span>${e(d[1])}</span><select ${attr}="${d[0]}">${d[3].map(([v, l]) => `<option value="${v}" ${(vals[d[0]] || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
    : `<label class="f"><span>${e(d[1])}</span><input type="number" ${attr}="${d[0]}" min="${d[3]}" max="${d[4]}" step="${d[6]}" value="${vals[d[0]] ?? ''}" placeholder="${base[d[0]] ?? (d[5] === '' ? 'auto' : d[5])}"></label>`).join('');
}
export function readLayout(root, attr) {
  const o = {}; root.querySelectorAll(`[${attr}]`).forEach(i => { if (i.value !== '') o[i.getAttribute(attr)] = i.value; }); return o;
}

function zhtml(txt, vars) {
  let h = e(txt || '');
  h = h.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>').replace(/__([\s\S]+?)__/g, '<u>$1</u>');
  h = h.replace(/\{(\w+)\}/g, (m, k) => k in vars ? e(vars[k] ?? '') : m);
  return h.replace(/\n/g, '<br>');
}

async function sheetHtml(doc, opts = {}) {
  const [S, contacts, payments] = await Promise.all([getS(), db.all('contacts'), db.all('payments')]);
  setStyles(S);
  const c = contacts.find(x => x.id === doc.clientId) || {};
  const t = totals(doc), paid = paidOf(payments, doc.id);
  const isQ = doc.type === 'quote', isC = doc.type === 'credit';
  const used = isC ? creditUsed(payments, doc.id) : paid;
  const defs = zoneDefs(doc, S, c), ov = doc.zones || {};
  const vars = { numero: doc.number || '', date: dateFr(doc.date), ville: S.city || '', validite: doc.validUntil ? dateFr(doc.validUntil) : '', siteRef: doc.siteRef || '', siteAddr: doc.siteAddr || '', company: S.company || '', iban: S.iban || '', bic: S.bic || '' };
  const Zt = k => k in ov ? ov[k] : (defs.find(d => d.k === k)?.v ?? '');
  const ED = !!opts.edit, LY = layoutOf(S, doc);
  const Z = k => { const h = zhtml(Zt(k), vars); return ED ? `<span class="zn" data-z="${k}" title="Cliquer pour modifier">${h || '<i class="zempty">(zone vide – cliquer)</i>'}</span>` : h; };
  return `<div class="sheet${ED ? ' pvedit' : ''}" style="${layoutStyle(LY)}">
    <div class="hd"><div class="co"><img src="${logoSrc(S)}" alt=""><div class="nm">${Z('coName')}</div>
      <p>${Z('coInfo')}</p></div>
      <div><p class="small" style="margin-top:0">${Z('certs')}</p>
      <div class="cl">${Z('client')}</div>
      <p>${Z('chantier')}</p></div></div>
    <h1>${Z('title')}</h1>
    <div class="hd"><div><b><u>${richHtml(doc.intro)}</u></b></div><div class="dt">${Z('dateLine')}${isQ && doc.validUntil && (Zt('validLine') || ED) ? `<br><span class="small">${Z('validLine')}</span>` : ''}</div></div>
    <div style="margin:6px 0">${isC ? '' : richHtml(doc.note)}</div>
    <table class="${colgroup(LY) ? 'fx' : ''}">${colgroup(LY)}<thead><tr><th>${Z('thDes')}</th><th>${Z('thQty')}</th><th>${Z('thUnit')}</th><th>${Z('thPu')}</th><th>${Z('thHt')}</th></tr></thead><tbody>
    ${printRows(ensureBlocks(doc))}
    <tr><td colspan="4">${Z('lblHt')}</td><td class="n">${eur(t.ht)}</td></tr>
    <tr><td colspan="3">${Z('lblTva')}</td><td class="n">${doc.tva.toString().replace('.', ',')} %</td><td class="n">${eur(t.tva)}</td></tr>
    <tr class="t"><td colspan="4">${Z('lblTtc')}</td><td class="n">${eur(t.ttc)}</td></tr>
    ${used ? `<tr><td colspan="4">${Z('lblPaid')}</td><td class="n">− ${eur(used)}</td></tr><tr class="t"><td colspan="4">${Z('lblLeft')}</td><td class="n">${eur(Math.max(0, round2(t.ttc - used)))}</td></tr>` : ''}
    </tbody></table>
    ${isQ && (Zt('methods') || ED) ? `<div class="pay">${Z('methods')}</div>` : ''}
    ${isC ? (Zt('creditTxt') || doc.note || ED ? `<div class="pay">${Z('creditTxt')}${doc.note ? '<br>' + Z('lblMotif') + ' ' + richHtml(doc.note) : ''}</div>` : '') : `<div class="pay">${Z('payLbl')}<br>${e(doc.terms).replace(/\n/g, '<br>')}</div>`}
    <div class="sig"><div>${Z('sigLeft')}<div class="sph"></div></div>
    <div>${Z('bank')}</div></div></div>`;
}

async function printDoc(doc) {
  $('#printarea').innerHTML = await sheetHtml(doc);
  await Promise.all([...$('#printarea').querySelectorAll('img')].map(i => (i.decode ? i.decode().catch(() => {}) : null)));
  setTimeout(() => window.print(), 60);
}
