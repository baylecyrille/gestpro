// Devis & factures : liste, éditeur, règlements/acomptes, transformation devis → facture, impression PDF.
import * as db from './db.js';
import { getS, logoSrc } from './defaults.js';
import { e, eur, num, round2, dateFr, today, F, modal, closeModal, toast, tabs, refresh, go, $, $$ } from './util.js';
import { pickProduct, autoOut, UNITS } from './stock.js';
import * as sheets from './sheets.js';

const QS = { draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé' };
const IS = { draft: 'Brouillon', pending: 'En attente', sent: 'Envoyée', paid: 'Réglée' };
const normStatus = d => { if (d.type === 'invoice' && d.status === 'issued') d.status = 'pending'; return d; };
const CS = { draft: 'Brouillon', issued: 'Émis' };
const METHODS = [['especes', 'Espèces'], ['cheque', 'Chèque'], ['cb', 'Carte bleue (terminal externe)'], ['virement', 'Virement'], ['autre', 'Autre'], ['avoir', 'Avoir (imputation)']];
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
}

/* Crée la facture d'un devis (une seule fois) et reprend les règlements déjà encaissés */
async function makeInvoice(q) {
  const inv = await newDoc('invoice', { clientId: q.clientId, siteRef: q.siteRef, siteAddr: q.siteAddr, intro: q.intro, note: q.note, tva: q.tva, terms: q.terms, lines: JSON.parse(JSON.stringify(q.lines)), siteId: q.siteId || '', fromQuote: q.id, fromQuoteNumber: q.number, status: 'pending' });
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
  const [docs, contacts, payments] = await Promise.all([db.all('documents'), db.all('contacts'), db.all('payments')]);
  const C = Object.fromEntries(contacts.map(c => [c.id, c]));
  const list = docs.filter(d => d.type === tab).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
  el.innerHTML = `<h2>Devis &amp; factures</h2>${tabs('#/docs', [['quote', 'Devis'], ['invoice', 'Factures'], ['credit', 'Avoirs']], tab)}
    <div class="row"><input class="search" id="q" type="search" placeholder="Rechercher (n°, client, chantier)…"><a class="btn primary" href="#/doc/new/${tab}">+ ${tab === 'quote' ? 'Devis' : tab === 'credit' ? 'Avoir' : 'Facture'}</a></div><div id="list"></div>`;
  const draw = () => {
    const q = $('#q', el).value.toLowerCase();
    const rows = list.filter(d => !q || [d.number, C[d.clientId]?.name, d.siteRef, d.siteAddr].join(' ').toLowerCase().includes(q));
    $('#list', el).innerHTML = rows.map(d => {
      const t = totals(d);
      let badge;
      if (d.type === 'invoice' || d.type === 'credit') badge = invBadge(d, payments);
      else badge = `<span class="chip ${d.status === 'accepted' || d.status === 'invoiced' ? 'ok' : d.status === 'refused' ? 'bad' : ''}">${QS[d.status] || ''}</span>`;
      return `<a class="item" href="#/doc/${d.id}" style="text-decoration:none;color:inherit"><div class="main"><div class="t">${e(d.number || '(sans numéro)')} · ${e(C[d.clientId]?.name || 'Sans client')}</div>
        <div class="s">${dateFr(d.date)}${d.siteRef ? ' · ' + e(d.siteRef) : ''}</div></div><div class="r"><b>${d.type === 'credit' ? '− ' : ''}${eur(t.ttc)}</b><div>${badge}</div></div></a>`;
    }).join('') || `<div class="empty">Aucun ${tab === 'quote' ? 'devis' : tab === 'credit' ? 'avoir' : 'facture'} pour le moment.</div>`;
  };
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
  normStatus(cur);
  const [contacts, S, allPay, sites, allDocs] = await Promise.all([db.all('contacts'), getS(), db.all('payments'), db.all('sites'), db.all('documents')]);
  sites.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const clients = contacts.filter(c => c.kind === 'client').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const isQ = cur.type === 'quote', isC = cur.type === 'credit';
  const DN = Object.fromEntries(allDocs.map(d => [d.id, d]));
  let payments = allPay.filter(p => p.docId === cur.id);

  const lineHtml = (l, i) => `<div class="ln" data-i="${i}">
    <div class="d"><input data-k="desig" value="${e(l.desig)}" placeholder="Désignation"></div>
    <input data-k="qty" type="number" step="any" inputmode="decimal" value="${l.qty}" placeholder="Qté">
    <select data-k="unit">${UNITS.map(u => `<option ${u === l.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
    <input data-k="pu" type="number" step="0.01" inputmode="decimal" value="${l.pu}" placeholder="P.U. HT">
    <button type="button" class="btn sm" data-rm>✕</button>
    <div class="tot" data-t>${eur(num(l.qty) * num(l.pu))}</div></div>`;

  const draw = () => {
    const t = totals(cur);
    el.innerHTML = `<div class="row"><a class="btn ghost" href="${cur.siteId && sites.some(x => x.id === cur.siteId) ? '#/site/' + cur.siteId : '#/docs/' + cur.type}">← Retour</a><span class="sp"></span>
      ${!isNew ? '<button class="btn" id="print">Imprimer / PDF</button>' : ''}<button class="btn primary" id="save">Enregistrer</button></div>
    <h2>${isQ ? 'Devis' : isC ? 'Avoir' : 'Facture'} ${e(cur.number || '(nouveau)')}</h2>${isC && cur.fromInvoice ? `<p class="muted" style="margin-top:-6px">sur la facture <a href="#/doc/${cur.fromInvoice}">${e(cur.fromInvoiceNumber || '')}</a></p>` : ''}
    <div class="card"><div class="cols">
      <label class="f full"><span>Client</span><div style="display:flex;gap:6px"><select name="clientId"><option value="">— choisir —</option>${clients.map(c => `<option value="${c.id}" ${c.id === cur.clientId ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select><button type="button" class="btn" id="newc">+</button></div></label>
      <label class="f full"><span>Chantier</span><select name="siteId"><option value="">— aucun —</option>${sites.map(x => `<option value="${x.id}" ${x.id === cur.siteId ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select></label>
      ${F('Date', 'date', cur.date, { type: 'date' })}
      ${isQ ? F('Valable jusqu\'au', 'validUntil', cur.validUntil, { type: 'date' }) : F(isC ? 'N° d\'avoir' : 'N° de facture', 'number', cur.number, { ph: 'automatique à l\'enregistrement' })}
      ${F('Réf. chantier', 'siteRef', cur.siteRef, { cls: 'full' })}
      ${F('Adresse du chantier', 'siteAddr', cur.siteAddr, { type: 'textarea', rows: 2, cls: 'full' })}
      ${F('Intitulé', 'intro', cur.intro, { cls: 'full' })}
      ${F(isC ? 'Motif de l\'avoir' : 'Remarque', 'note', cur.note, { cls: 'full' })}
      ${F('Statut', 'status', cur.status, { type: 'select', options: Object.entries(isQ ? QS : isC ? CS : IS) })}
      ${F('TVA', 'tva', cur.tva, { type: 'select', options: TVAS })}
    </div></div>
    <div class="card lines"><div class="ln h"><span>Désignation</span><span>Qté</span><span>Unité</span><span>P.U. HT</span><span></span></div>
      <div id="lines">${cur.lines.map(lineHtml).join('')}</div>
      <div class="row"><button type="button" class="btn" id="addp">+ Produit (stock / code-barres)</button><button type="button" class="btn" id="addl">+ Ligne libre</button></div>
      <div class="totals"><div><span>Total HT</span><b id="tht">${eur(t.ht)}</b></div><div><span>TVA ${cur.tva} %</span><b id="ttva">${eur(t.tva)}</b></div><div class="big"><span>Total TTC</span><span id="tttc">${eur(t.ttc)}</span></div></div></div>
    ${isC ? '' : F('Conditions de règlement', 'terms', cur.terms, { type: 'textarea', rows: 5 })}
    ${!isNew ? (isC ? creditUseHtml(t) : paymentsHtml(t, payments)) : `<p class="muted">Enregistrez le document pour gérer ${isC ? 'son utilisation' : 'les règlements'}.</p>`}
    ${!isNew ? actionsHtml() : ''}`;
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
      ${isQ ? `<button class="btn primary" id="toinv">Transformer en facture</button>${cur.status !== 'accepted' && cur.status !== 'invoiced' ? '<button class="btn" id="accept">Marquer accepté</button>' : ''}` : (isC ? '' : cur.stockOut ? '<span class="chip ok">Stock déjà déduit</span>' : '<button class="btn" id="stockout">Déduire du stock</button>')}
      <button class="btn danger" id="delete">Supprimer</button></div>${creditsOfInv.length ? `<p class="muted" style="margin-bottom:0">Avoirs : ${creditsOfInv.map(c => `<a href="#/doc/${c.id}">${e(c.number || '(brouillon)')}</a>`).join(', ')}</p>` : ''}</div>`;

  const refreshTotals = () => {
    const t = totals(cur);
    $('#tht', el).textContent = eur(t.ht); $('#ttva', el).textContent = eur(t.tva); $('#tttc', el).textContent = eur(t.ttc);
  };

  const readHeader = () => {
    $$('[name]', el).forEach(i => { if (i.name in cur || ['clientId', 'validUntil', 'number', 'siteId'].includes(i.name)) cur[i.name] = i.value; });
    cur.tva = num(cur.tva);
  };

  const save = async () => {
    readHeader();
    if (!cur.clientId) { toast('Choisissez un client'); return false; }
    if (!cur.number && (cur.type === 'quote' || cur.status !== 'draft')) cur.number = await nextNumber(cur.type);
    cur.lines = cur.lines.filter(l => l.desig || num(l.pu));
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
    const lines = $('#lines', el);
    lines.oninput = ev => {
      const row = ev.target.closest('.ln'); if (!row) return;
      const l = cur.lines[+row.dataset.i];
      l[ev.target.dataset.k] = ev.target.dataset.k === 'desig' || ev.target.dataset.k === 'unit' ? ev.target.value : ev.target.value;
      $('[data-t]', row).textContent = eur(num(l.qty) * num(l.pu));
      refreshTotals();
    };
    lines.onclick = ev => {
      const rm = ev.target.closest('[data-rm]'); if (!rm) return;
      readHeader(); cur.lines.splice(+rm.closest('.ln').dataset.i, 1); draw();
    };
    $('#addl', el).onclick = () => { readHeader(); cur.lines.push({ desig: '', qty: 1, unit: 'u', pu: 0 }); draw(); };
    $('#addp', el).onclick = () => { readHeader(); pickProduct(p => { cur.lines.push({ pid: p.id, desig: p.name, qty: 1, unit: p.unit || 'u', pu: p.sell || 0 }); draw(); }); };
    $('#newc', el).onclick = () => { readHeader(); import('./app.js').then(m => m.contactModal(null, 'client', c => { clients.push(c); cur.clientId = c.id; draw(); })); };
    $('[name=siteId]', el).onchange = () => {
      const prev = cur.siteId; readHeader(); const st = sites.find(x => x.id === cur.siteId);
      if (st) { if (!cur.clientId) cur.clientId = st.clientId || ''; if (!cur.siteRef || sites.find(x => x.id === prev)?.name === cur.siteRef) cur.siteRef = st.name; if (!cur.siteAddr) cur.siteAddr = st.address || ''; }
      draw();
    };
    $('#save', el).onclick = save;
    if (isNew) return;
    $('#print', el).onclick = async () => { readHeader(); await db.put('documents', cur); printDoc(cur); };
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
    $('#addpay', el).onclick = () => payModal();
    $$('[data-m]', el).forEach(b => b.onclick = () => payModal(null, left || '', b.dataset.m));
    $$('[data-pct]', el).forEach(b => b.onclick = () => payModal(null, round2(t.ttc * +b.dataset.pct / 100)));
    $('#rest', el).onclick = () => payModal(null, Math.max(0, round2(t.ttc - paid)));
    $$('[data-pay]', el).forEach(n => n.onclick = () => { const p = payments.find(x => x.id === n.dataset.pay); if (p.creditId) go('#/doc/' + p.creditId); else payModal(p); });
    if (isQ) {
      $('#accept', el)?.addEventListener('click', async () => { readHeader(); cur.status = 'accepted'; await db.put('documents', cur); await bumpSite(cur); toast('Devis accepté'); refresh(); });
      $('#toinv', el).onclick = async () => {
        if (cur.status !== 'accepted' && !confirm('Ce devis n\'est pas marqué « accepté ». Créer la facture quand même ?')) return;
        readHeader();
        if (cur.invoiceId && !confirm('Une facture existe déjà pour ce devis. En créer une autre ?')) return;
        const inv = await makeInvoice(cur);
        toast(`Facture ${inv.number} créée`); go('#/doc/' + inv.id);
      };
      if (cur.invoiceId) $('#toinv', el).insertAdjacentHTML('afterend', `<a class="btn" href="#/doc/${cur.invoiceId}">Voir la facture</a>`);
    } else {
      $('#stockout', el)?.addEventListener('click', async () => {
        if (!confirm('Déduire du stock les produits de cette facture ?')) return;
        const n = await autoOut(cur.lines, cur.number); cur.stockOut = true; await db.put('documents', cur);
        toast(n ? 'Stock mis à jour' : 'Aucune ligne liée au stock'); refresh();
      });
    }
  };
  draw();
}

/* ---------- Impression ---------- */
async function printDoc(doc) {
  const [S, contacts, payments] = await Promise.all([getS(), db.all('contacts'), db.all('payments')]);
  const c = contacts.find(x => x.id === doc.clientId) || {};
  const t = totals(doc), paid = paidOf(payments, doc.id);
  const isQ = doc.type === 'quote', isC = doc.type === 'credit';
  const used = isC ? creditUsed(payments, doc.id) : paid;
  const addr = [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  $('#printarea').innerHTML = `<div class="sheet">
    <div class="hd"><div class="co"><img src="${logoSrc(S)}" alt=""><div class="nm">${e(S.sub || S.company)}</div>
      <p><b>${e(S.owner)}</b><br>${e(S.address).replace(/\n/g, '<br>')}<br>${e(S.phone)}<br>${e(S.legal)}<br>${e(S.email)}<br>${e(S.web)}<br>N°SIRET : ${e(S.siret)}</p></div>
      <div><p class="small" style="margin-top:0">${S.rge ? `<b>RGE</b> Numéro ${e(S.rge)}<br>` : ''}${S.insurance ? `Assurance Responsabilité Travaux ${e(S.insurance)}<br>Assurance Responsabilité Civile ${e(S.insurance)}` : ''}</p>
      <div class="cl">${e(c.name || '')}${c.company ? '\n' + e(c.company) : ''}\n${e(addr)}</div>
      <p><u><b>Réf chantier :</b></u><br>${e(doc.siteRef || '')}<br><b>${e(doc.siteAddr || '').replace(/\n/g, '<br>')}</b></p></div></div>
    <h1>${isQ ? 'Devis' : isC ? 'Avoir' : 'Facture'} ${e(doc.number)}</h1>
    <div class="hd"><div><b><u>${e(doc.intro || '')}</u></b></div><div><b>${e(S.city || '')}, le &nbsp; ${dateFr(doc.date)}</b>${isQ && doc.validUntil ? `<br><span class="small">Valable jusqu'au ${dateFr(doc.validUntil)}</span>` : ''}</div></div>
    <p>${isC ? '' : e(doc.note || '')}</p>
    <table><thead><tr><th>DESIGNATION</th><th>Qté</th><th>Unité</th><th>Prix unit.</th><th>Prix H.T</th></tr></thead><tbody>
    ${doc.lines.map(l => `<tr><td>${e(l.desig)}</td><td class="n">${num(l.qty)}</td><td>${e(l.unit)}</td><td class="n">${eur(num(l.pu))}</td><td class="n">${eur(num(l.qty) * num(l.pu))}</td></tr>`).join('')}
    <tr><td colspan="4">Total HT</td><td class="n">${eur(t.ht)}</td></tr>
    <tr><td colspan="3">TVA</td><td class="n">${doc.tva.toString().replace('.', ',')} %</td><td class="n">${eur(t.tva)}</td></tr>
    <tr class="t"><td colspan="4">${isC ? 'Total TTC de l\'avoir' : 'Total TTC'}</td><td class="n">${eur(t.ttc)}</td></tr>
    ${used ? `<tr><td colspan="4">${isC ? 'Déjà déduit / remboursé' : 'Déjà réglé'}</td><td class="n">− ${eur(used)}</td></tr><tr class="t"><td colspan="4">${isC ? 'Reste à votre crédit' : 'Reste à payer'}</td><td class="n">${eur(Math.max(0, round2(t.ttc - used)))}</td></tr>` : ''}
    </tbody></table>
    ${isC ? `<div class="pay"><b>Avoir</b> – à déduire de votre prochaine facture ou remboursé.${doc.note ? '<br>Motif : ' + e(doc.note) : ''}</div>` : `<div class="pay"><b>Règlement</b><br>${e(doc.terms).replace(/\n/g, '<br>')}</div>`}
    <div class="sig"><div><b>${isQ ? 'Bon pour accord – date et signature du client' : 'Signature Entrepreneur'}</b><div style="height:60px"></div></div>
    <div>${S.iban && !isC ? `<b><u>Vous pouvez régler cette facture par virement</u></b><br><b>${e(S.company)}</b><br><b>IBAN</b> : ${e(S.iban)}<br><b>Code BIC</b> : ${e(S.bic)}` : ''}</div></div></div>`;
  await Promise.all([...$('#printarea').querySelectorAll('img')].map(i => (i.decode ? i.decode().catch(() => {}) : null)));
  setTimeout(() => window.print(), 60);
}
