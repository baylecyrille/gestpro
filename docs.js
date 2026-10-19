// Devis & factures : liste, éditeur, règlements/acomptes, transformation devis → facture, impression PDF.
import * as db from './db.js';
import { getS, logoSrc, seqOf, yearTok, lastNumber } from './defaults.js';
import * as efact from './efact.js';
import { docSums, depsOf, depositSplit, fmtRate, reducedRates, listRates, RATES, isOpt, docMargin, refOn } from './vat.js';
import { checkDoc, checkMentions } from './doccheck.js';
import { e, eur, num, round2, dateFr, today, cname, addressAutocomplete, filterBar, bindFilters, getPref, setPref, F, modal, closeModal, toast, tabs, refresh, go, downloadFile, $, $$ } from './util.js';
import { pickProduct, autoOut, UNITS } from './stock.js';
import * as sheets from './sheets.js';
import * as auth from './auth.js';
import * as lock from './lock.js';
import * as fl from './files.js';
import { defaultTpl, normTpl, canvasHtml, loadTplStore, saveTplStore, imagesOf, fitPaper, openLayoutEditor } from './layout.js';
import { ensureBlocks, pruneBlocks, copyBlocks, mountBlocks, lineStats, clearLineOpt, printRows, setStyles, richField, bindRichFields, readRich, richHtml } from './blocks.js';

const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const TYPE_RIGHT = { quote: 'quotes', invoice: 'invoices', credit: 'credits' };

const QS = { draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé' };
const IS = { draft: 'Brouillon', pending: 'À payer', sent: 'Envoyée', partial: 'Réglée partiellement', paid: 'Réglée', overdue: 'En retard / impayée', dispute: 'En litige / suspendue', cancelled: 'Annulée' };
/* Facture à prendre en compte dans les chiffres (ni brouillon ni annulée) */
export const counts = d => d.status !== 'draft' && d.status !== 'cancelled';
/* Devis dont la date de validité est dépassée sans réponse du client (brouillon ou envoyé) */
export const quoteExpired = (d, ref = today()) => d.type === 'quote' && ['draft', 'sent'].includes(d.status) && !!d.validUntil && d.validUntil < ref;
/* État réel d'une facture : règlements + date limite (en retard = échéance dépassée et reste à payer) */
export function invState(doc, payments) {
  normStatus(doc);
  if (['draft', 'cancelled', 'dispute'].includes(doc.status)) return doc.status;
  const t = totals(doc).ttc, p = paidOf(payments, doc.id);
  if (doc.status === 'paid' || (t > 0 && p >= t - 0.005)) return 'paid';
  if (doc.dueDate && doc.dueDate < today()) return 'overdue';
  if (p > 0) return 'partial';
  return doc.status === 'sent' ? 'sent' : doc.status === 'overdue' ? 'overdue' : 'pending';
}
const normStatus = d => { if (d.type === 'invoice' && d.status === 'issued') d.status = 'pending'; return d; };
const CS = { draft: 'Brouillon', issued: 'Émis' };
const METHODS = [['especes', 'Espèces'], ['cheque', 'Chèque'], ['cb', 'Carte bleue'], ['virement', 'Virement'], ['autre', 'Autre'], ['avoir', 'Avoir (imputation)']];
const REAL_METHODS = METHODS.filter(m => m[0] !== 'avoir');
const TVAS = RATES;

/* Totaux d'un document : un taux de TVA par ligne (sinon celui du document), remises de ligne et sur le total, lignes en option exclues ;
   `rates` = ventilation par taux ; sur une facture finale, ht / tva / ttc sont nets des acomptes déjà facturés (`full` = total de l'opération, `depo` = acomptes) */
export function totals(doc) {
  return docSums(doc);
}

/* ---------- Acomptes ---------- */
/* Factures d'acompte encore valables d'un devis : ni brouillon ni annulées, et pas entièrement annulées par un avoir */
export function quoteDeposits(docs, qid) {
  return docs.filter(d => d.type === 'invoice' && d.deposit && d.deposit.q === qid && counts(d) && d.number)
    .filter(d => docs.filter(c => c.type === 'credit' && c.fromInvoice === d.id && c.status !== 'draft').reduce((a, c) => a + totals(c).ttc, 0) < totals(d).ttc - 0.005)
    .sort((a, b) => (a.date + a.number).localeCompare(b.date + b.number));
}
/* Ligne « acompte déjà facturé » reprise sur la facture finale (montants HT par taux de TVA) */
export const depEntry = inv => ({ id: inv.id, number: inv.number, date: inv.date, rates: totals(inv).rates.filter(x => x.ht !== 0).map(x => ({ rate: x.rate, ht: x.ht })) });
const depSig = d => d.rates.map(x => x.rate + ':' + x.ht).join(',');
/* Acomptes à déduire d'une facture finale d'après l'état actuel des factures d'acompte : { add, stale, changed } */
export function depsDiff(inv, docs) {
  const want = inv.fromQuote && !inv.deposit ? quoteDeposits(docs, inv.fromQuote).filter(d => d.id !== inv.id).map(depEntry) : [], have = depsOf(inv);
  const add = want.filter(w => !have.some(h => h.id === w.id)), stale = have.filter(h => !want.some(w => w.id === h.id));
  const changed = want.filter(w => { const h = have.find(x => x.id === w.id); return h && depSig(h) !== depSig(w); });
  return { want, add, stale, changed, ok: !add.length && !stale.length && !changed.length };
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
  const st = invState(doc, payments), p = paidOf(payments, doc.id);
  const cls = { draft: '', paid: 'ok', partial: 'warn', sent: 'warn', dispute: 'warn', overdue: 'bad', pending: 'bad', cancelled: '' }[st];
  const part = st === 'overdue' && p > 0.005 ? '<span class="chip warn">Partielle</span>' : '';
  const late = st === 'overdue' && doc.dueDate ? ` title="Échéance dépassée : ${dateFr(doc.dueDate)}"` : '';
  return `<span class="chip ${cls}"${late}${st === 'cancelled' ? ' style="text-decoration:line-through"' : ''}>${IS[st] || 'À payer'}</span>${part}`;
}
/* Met l'état de la facture en cohérence avec les règlements (réglée / plus réglée) */
async function syncInvStatus(docId) {
  const d = await db.get('documents', docId);
  if (!d || d.type !== 'invoice') return;
  normStatus(d);
  if (['draft', 'cancelled', 'dispute'].includes(d.status)) return; // états choisis à la main : jamais modifiés automatiquement
  const t = totals(d).ttc, p = paidOf(await db.all('payments'), docId), full = t > 0 && p >= t - 0.005;
  const ns = full ? 'paid' : p > 0.005 ? 'partial' : (d.status === 'paid' || d.status === 'partial') ? 'pending' : d.status;
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
  const mine = docs.filter(x => x.siteId === siteId && counts(x));
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
  const deposits = quoteDeposits(await db.all('documents'), q.id);
  const inv = await newDoc('invoice', { clientId: q.clientId, siteRef: q.siteRef, siteAddr: q.siteAddr, intro: q.intro, note: q.note, tva: q.tva, terms: q.terms, lines: JSON.parse(JSON.stringify(q.lines)).filter(l => !isOpt(l)), blocks: q.blocks ? copyBlocks(q.blocks).filter(b => b.type !== 'line' || !isOpt(b)) : undefined, ...(q.disc ? { disc: { ...q.disc } } : {}), siteId: q.siteId || '', fromQuote: q.id, fromQuoteNumber: q.number, status: 'pending', ...(deposits.length ? { deps: deposits.map(depEntry) } : {}) });
  ensureBlocks(inv); if (q.opts) inv.opts = { ...q.opts };
  inv.number = await nextNumber('invoice');
  await db.put('documents', inv);
  for (const p of (await db.all('payments')).filter(x => x.docId === q.id)) { p.docId = inv.id; p.fromQuote = q.id; await db.put('payments', p); }
  q.status = 'invoiced'; q.invoiceId = inv.id; await db.put('documents', q);
  await syncInvStatus(inv.id); await bumpSite(q);
  return inv;
}

/* Crée une facture d'acompte sur un devis : même numérotation que les factures, une ligne par taux de TVA (voir depositSplit).
   o = { mode, value, date, dueDate, accept, attach } */
async function makeDeposit(q, sp, o = {}) {
  const pct = o.mode === '%' ? ` de ${String(sp.pct).replace('.', ',')} %` : '';
  const label = `Acompte${pct} sur devis n° ${q.number} du ${dateFr(q.date)}`;
  const lines = sp.rates.map(x => ({ desig: label + (sp.rates.length > 1 ? ` (TVA ${fmtRate(x.rate)})` : ''), qty: 1, unit: 'forfait', pu: x.ht, tva: String(x.rate), pid: '' }));
  const blocks = [...lines.map(l => ({ type: 'line', ...l })), { type: 'text', html: `Acompte sur le devis n° ${e(q.number)} du ${e(dateFr(q.date))} (montant du devis : ${e(eur(sp.base))} TTC). Cet acompte sera déduit de la facture finale.` }];
  const inv = await newDoc('invoice', { clientId: q.clientId, siteRef: q.siteRef, siteAddr: q.siteAddr, intro: q.intro, note: '', tva: q.tva, terms: q.terms, lines, blocks, siteId: q.siteId || '', fromQuote: q.id, fromQuoteNumber: q.number, deposit: { q: q.id, mode: o.mode, value: num(o.value) }, status: 'pending', ...(o.date ? { date: o.date } : {}), ...(o.dueDate ? { dueDate: o.dueDate } : {}) });
  ensureBlocks(inv); if (q.opts) inv.opts = { ...q.opts };
  inv.number = await nextNumber('invoice');
  await db.put('documents', inv);
  if (o.attach) for (const p of (await db.all('payments')).filter(x => x.docId === q.id)) { p.docId = inv.id; p.fromQuote = q.id; await db.put('payments', p); }
  if (o.accept && !['accepted', 'invoiced'].includes(q.status)) { q.status = 'accepted'; await db.put('documents', q); }
  await syncInvStatus(inv.id); await bumpSite(q);
  return inv;
}

/* Un devis accepté/facturé fait passer son chantier de « Nouveau » à « Signé » */
async function bumpSite(d) {
  if (!d.siteId || d.type !== 'quote' || !['accepted', 'invoiced'].includes(d.status)) return;
  const st = await db.get('sites', d.siteId);
  if (st && st.status === 'new') { st.status = 'signed'; await db.put('sites', st); }
}

/* Numéro suivant d'une série. Le préfixe peut contenir {AAAA} : le compteur repart alors à 1 au changement d'année (voir defaults.js). */
async function nextNumber(type) {
  if (sheets.configured() && navigator.onLine) await sheets.sync().catch(() => {}); // récupère les compteurs des autres appareils
  const S = await getS();
  const q = seqOf(S, type, +today().slice(0, 4));
  S[q.key] = q.n + 1; if (yearTok(q.pre)) S[q.yk] = q.yr;
  await db.saveSettings(S);
  return q.number;
}

export async function newDoc(type, extra = {}) {
  const S = await getS();
  const due = type === 'invoice' ? addDays(today(), num(S.payDays ?? 30)) : '';
  return { type, number: '', date: today(), clientId: '', siteRef: '', siteAddr: '', intro: S.intro, note: S.note, tva: S.tva, terms: S.terms, lines: [], status: 'draft', validUntil: type === 'quote' ? addDays(today(), num(S.validity ?? 30)) : '', dueDate: due, siteId: '', ...extra };
}

/* ---------- Liste ---------- */
export async function renderDocs(el, tab = 'quote') {
  const allowed = ['quote', 'invoice', 'credit'].filter(t => auth.can(TYPE_RIGHT[t]));
  if (!allowed.includes(tab)) return go('#/docs/' + (allowed[0] || 'quote'));
  const [docs, contacts, payments] = await Promise.all([db.all('documents'), db.all('contacts'), db.all('payments')]);
  const LK = await lock.allLocks();
  const C = Object.fromEntries(contacts.map(c => [c.id, c]));
  const list = docs.filter(d => d.type === tab && auth.canDoc(d)).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
  const cl = [...new Set(list.map(d => d.clientId).filter(Boolean))].map(id => [id, cname(C[id]) || '?']).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const stOpts = tab === 'quote' ? Object.entries(QS) : tab === 'invoice' ? [['unpaid', 'À encaisser'], ['paid', 'Réglées'], ['partial', 'Réglées partiellement'], ['overdue', 'En retard / impayées'], ['dispute', 'En litige / suspendues'], ['cancelled', 'Annulées'], ['draft', 'Brouillons']] : Object.entries(CS);
  const FC = [{ id: 'sort', label: 'Trier par', def: 'dateD', options: [['dateD', 'Date (récent)'], ['dateA', 'Date (ancien)'], ['num', 'Numéro'], ['client', 'Client A→Z'], ['amtD', 'Montant ↓'], ['amtA', 'Montant ↑']] },
    { id: 'status', type: 'multi', label: 'Statuts (cliquez pour filtrer, plusieurs possibles)', options: stOpts }, { id: 'client', label: 'Client', options: [['', 'Tous'], ...cl] }, { id: 'from', type: 'date', label: 'Du' }, { id: 'to', type: 'date', label: 'Au' }];
  const SORTS = { dateD: (a, b) => (b.date + b.number).localeCompare(a.date + a.number), dateA: (a, b) => (a.date + a.number).localeCompare(b.date + b.number), num: (a, b) => String(a.number).localeCompare(String(b.number), 'fr', { numeric: true }),
    client: (a, b) => cname(C[a.clientId]).localeCompare(cname(C[b.clientId]), 'fr'), amtD: (a, b) => totals(b).ttc - totals(a).ttc, amtA: (a, b) => totals(a).ttc - totals(b).ttc };
  el.innerHTML = `<h2>Ventes</h2>${tabs('#/docs', [['quote', 'Devis'], ['invoice', 'Factures'], ['credit', 'Avoirs']].filter(t => allowed.includes(t[0])), tab)}
    <div class="row"><input class="search" id="q" type="search" placeholder="Rechercher (n°, client, chantier)…"><a class="btn primary" href="#/doc/new/${tab}">+ ${tab === 'quote' ? 'Devis' : tab === 'credit' ? 'Avoir' : 'Facture'}</a></div>${filterBar(FC)}<div id="invnote" class="invnote"></div><div id="list"></div>`;
  let getF;
  const okOne = (d, s) => !s || (tab === 'invoice' ? (s === 'unpaid' ? counts(d) && totals(d).ttc - paidOf(payments, d.id) > 0.005 : invState(d, payments) === s) : d.status === s);
  const okStatus = (d, arr) => !arr || !arr.length || arr.some(s => okOne(d, s));
  const draw = () => {
    const q = $('#q', el).value.toLowerCase(), F2 = getF ? getF() : {};
    const found = list.filter(d => (!q || [d.number, cname(C[d.clientId]), d.siteRef, d.siteAddr].join(' ').toLowerCase().includes(q)) && okStatus(d, F2.status) && (!F2.client || d.clientId === F2.client) && (!F2.from || (d.date || '') >= F2.from) && (!F2.to || (d.date || '') <= F2.to));
    /* Devis facturés : masqués par défaut (réglage mémorisé) ; une recherche ou le filtre de statut « Facturé » les fait réapparaître */
    const hideOn = tab === 'quote' && getPref('docs_hideinv', '1') !== '0', hide = hideOn && !q && !(F2.status || []).includes('invoiced');
    const shown = hide ? found.filter(d => d.status !== 'invoiced') : found, nh = found.length - shown.length;
    const rows = shown.sort(SORTS[F2.sort] || SORTS.dateD);
    const note = $('#invnote', el);
    if (tab === 'quote') note.innerHTML = nh ? `${nh} devis facturé${nh > 1 ? 's' : ''} masqué${nh > 1 ? 's' : ''} · <button type="button" class="lnk" data-hi="0">Voir tout</button>` : !hideOn && list.some(d => d.status === 'invoiced') ? '<button type="button" class="lnk" data-hi="1">Masquer les devis facturés</button>' : '';
    $('#list', el).innerHTML = rows.map(d => {
      const t = totals(d);
      let badge;
      if (d.type === 'invoice' || d.type === 'credit') badge = invBadge(d, payments);
      else badge = `<span class="chip ${d.status === 'accepted' || d.status === 'invoiced' ? 'ok' : d.status === 'refused' ? 'bad' : ''}">${QS[d.status] || ''}</span>${quoteExpired(d) ? `<span class="chip warn" title="Date de validité dépassée : ${dateFr(d.validUntil)}">Expiré</span>` : ''}`;
      return `<a class="item${lock.lockCls(LK, d.id)}" href="#/doc/${d.id}" style="text-decoration:none;color:inherit"><div class="main"><div class="t">${e(d.number || '(sans numéro)')} · ${e(cname(C[d.clientId]) || 'Sans client')}</div>
        <div class="s">${dateFr(d.date)}${d.deposit ? ' · <b>Acompte</b>' : ''}${depsOf(d).length ? ' · après acomptes' : ''}${d.siteRef ? ' · ' + e(d.siteRef) : ''}</div></div><div class="r"><b>${d.type === 'credit' ? '− ' : ''}${eur(t.ttc)}</b><div>${lock.lockTag(LK, d.id)}${badge}</div></div></a>`;
    }).join('') || `<div class="empty">${nh ? 'Aucun devis en cours.' : `Aucun ${tab === 'quote' ? 'devis' : tab === 'credit' ? 'avoir' : 'facture'} pour le moment.`}</div>`;
  };
  getF = bindFilters(el, 'docs_' + tab + '_', FC, draw);
  draw(); $('#q', el).oninput = draw;
  $('#invnote', el).onclick = ev => { const b = ev.target.closest('[data-hi]'); if (b) { setPref('docs_hideinv', b.dataset.hi); draw(); } };
}

/* ---------- Éditeur ---------- */
/* Champs repris quand on duplique un document (ni numéro, ni date, ni règlements, ni pièces jointes, ni lien avec un devis ou une facture) */
const COPY_KEYS = ['clientId', 'siteId', 'siteRef', 'siteAddr', 'intro', 'note', 'tva', 'terms', 'disc', 'tpl', 'zones', 'layout', 'opType', 'vatDebits', 'deliveryAddr', 'tvaRed', 'opts'];
export async function renderDoc(el, id, arg) {
  let cur, isNew = false, copyOf = null;
  if (id === 'new') {
    const cp = /^copy:(.+)$/.exec(String(arg || ''));
    if (cp) { // duplication d'un devis ou d'une facture
      const src = await db.get('documents', cp[1]);
      if (!src || src.type === 'credit') { el.innerHTML = '<div class="empty">Document à dupliquer introuvable.</div>'; return; }
      ensureBlocks(src);
      const keep = {}; for (const k of COPY_KEYS) if (src[k] !== undefined && src[k] !== null) keep[k] = JSON.parse(JSON.stringify(src[k]));
      cur = await newDoc(src.type, { ...keep, blocks: copyBlocks(src.blocks) }); if (cur.type === 'invoice') cur.status = 'pending';
      copyOf = src; isNew = true;
    } else {
      const [ty, sid] = String(arg || '').split('-'); // « quote-<id chantier> » : créé depuis la fiche chantier
      cur = await newDoc(ty === 'invoice' ? 'invoice' : ty === 'credit' ? 'credit' : 'quote'); if (cur.type === 'invoice') cur.status = 'pending'; if (cur.type === 'credit') { cur.status = 'issued'; cur.terms = ''; cur.intro = 'Avoir'; } isNew = true;
      const st = sid && await db.get('sites', sid);
      if (st) Object.assign(cur, { siteId: st.id, clientId: st.clientId, siteRef: st.name, siteAddr: st.address });
    }
  }
  else cur = await db.get('documents', id);
  if (!cur) { el.innerHTML = '<div class="empty">Document introuvable.</div>'; return; }
  normStatus(cur); ensureBlocks(cur);
  if (isNew && !cur.by) cur.by = auth.currentUser()?.id || '';
  if (!auth.canDoc(cur)) { el.innerHTML = '<div class="empty">Vous n\'avez pas accès à ce document.</div>'; return; }
  if (!isNew) { // verrou d'édition : un seul utilisateur à la fois sur ce document
    const lk = await lock.begin(cur.id, { prefix: '#/doc/' + cur.id });
    if (lk.blocked) {
      el.innerHTML = `<div class="row"><a class="btn ghost" href="#/docs/${cur.type}">← Retour</a></div><div class="card"><h3 style="margin-top:0">${e(lock.lockMsg(lk.blocked))}</h3><p class="muted">Ce document est grisé le temps de sa modification par cette personne. Réessayez dans un moment.</p>${lk.canForce ? '<button class="btn danger" id="lkforce">Ouvrir quand même</button>' : ''}</div>`;
      $('#lkforce', el)?.addEventListener('click', async () => { if (confirm('Risque d\'écraser ses modifications. Ouvrir quand même ?')) { await lock.begin(cur.id, { prefix: '#/doc/' + cur.id, force: true }); refresh(); } });
      return;
    }
  }
  const canPay = auth.can('invoices'), canInv = auth.can('invoices');
  const [contacts, S, allPay, sites, allDocs] = await Promise.all([db.all('contacts'), getS(), db.all('payments'), db.all('sites'), db.all('documents')]);
  sites.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  setStyles(S);
  const clients = contacts.filter(c => c.kind === 'client').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const isQ = cur.type === 'quote', isC = cur.type === 'credit';
  const DN = Object.fromEntries(allDocs.map(d => [d.id, d]));
  let payments = allPay.filter(p => p.docId === cur.id);
  const run = {}; el._docRun = run; // identifie cet affichage : les actions différées d'un document déjà quitté s'arrêtent
  let hdrOpen = isNew || !cur.clientId, sidefit = null, auxT = 0, optOpen = false;
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
  const sideWanted = () => lsGet('gp_sidepv') !== '0';
  const sideOn = () => sideWanted() && typeof matchMedia === 'function' && matchMedia('(min-width:1200px)').matches; // aperçu à côté : grands écrans uniquement

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

  const applySide = () => {
    if (el._docRun !== run || !$('#edwrap', el)) return;
    const on = sideOn();
    el.classList.toggle('wide', on); $('#edwrap', el).classList.toggle('split', on); $('#sidepv', el).hidden = !on;
    const sc = $('[data-side]', el); if (sc) sc.checked = sideWanted();
    sidefit = null; if (on) updAux();
  };
  /* Options de l'éditeur (bouton « Options », en haut à côté d'Éditeur) : ce qui se saisit et s'affiche sur les lignes.
     Choix propre au document (cur.opts), repris comme réglage par défaut des prochains documents sur cet appareil.
     Un choix qui cacherait des valeurs déjà comptées dans le total (taux de ligne, remises, lignes en option) demande une confirmation et remet ces valeurs à zéro :
     on ne cache jamais un montant qui compte. Les informations internes (prix d'achat, marge, stock, photo) ne sont jamais imprimées. */
  const OPTS = [
    ['tvaLine', 'TVA', 1, 'Choisir le taux de TVA ligne par ligne', 'Décoché : toutes les lignes ont le taux de TVA du document (champ de l\'en-tête).', 'qic'],
    ['remLine', 'Remises', 1, 'Remise en % sur chaque ligne', 'Décoché : le champ « Remise » disparaît des lignes.', 'qic'],
    ['remTot', 'Remises', 1, 'Remise sur le total du document', 'En % ou en € HT, répartie entre les taux de TVA.', 'qic'],
    ['ref', 'Lignes', 0, 'Référence du produit sur chaque ligne', 'Reprise de la fiche produit. Imprimée en première colonne (« Réf. ») dès qu\'une référence est renseignée.', 'qic'],
    ['optLine', 'Lignes', 1, 'Lignes en option (case « Option »)', 'Une option est imprimée sur le devis mais non comptée dans le total.', 'q'],
    ['secSub', 'Lignes', 1, 'Sous-total sur les nouvelles sections', 'Décoché : les sections ajoutées n\'affichent pas de sous-total (réglable section par section avec Σ).', 'qic'],
    ['margin', 'Informations internes · jamais imprimées', 0, 'Prix d\'achat et marge', 'P.A. HT par ligne (repris de la fiche produit), marge par ligne et marge totale du document.', 'qi'],
    ['stock', 'Informations internes · jamais imprimées', 0, 'Stock disponible', 'Sous chaque produit suivi en stock, avec une alerte si la quantité demandée dépasse le stock.', 'qi'],
    ['photo', 'Informations internes · jamais imprimées', 0, 'Photo du produit', 'Petite photo de la fiche produit à gauche de la ligne (non imprimée).', 'qic']
  ].filter(o => o[5].includes(cur.type[0]));
  const OPT_DEF = Object.fromEntries(OPTS.map(o => [o[0], o[2]]));
  const optHas = k => { const st = lineStats(cur); return k === 'tvaLine' ? st.own > 0 : k === 'remLine' ? st.rem > 0 : k === 'optLine' ? st.opt > 0 : k === 'remTot' ? !!(cur.disc && num(cur.disc.v) > 0) : false; };
  const optOn = k => optHas(k) || (cur.opts && k in cur.opts ? !!cur.opts[k] : getPref('ed_' + k, String(OPT_DEF[k] ?? (k === 'optLine' || k === 'secSub' ? 1 : 0))) !== '0');
  const optPanelHtml = () => {
    const groups = []; for (const o of OPTS) { let g = groups.find(x => x[0] === o[1]); if (!g) groups.push(g = [o[1], []]); g[1].push(o); }
    return groups.map(([g, os]) => `<div class="og"><b>${e(g)}</b>${os.map(([k, , , label, hint]) => `<label class="ck"><input type="checkbox" data-opt="${k}" ${optOn(k) ? 'checked' : ''}><span>${e(label)}<small>${e(hint)}</small></span></label>`).join('')}</div>`).join('')
      + `<div class="og sideog"><b>Affichage</b><label class="ck"><input type="checkbox" data-side ${sideWanted() ? 'checked' : ''}><span>Aperçu du document à côté de l'éditeur<small>Grands écrans uniquement.</small></span></label></div>
    <p class="muted foot">Ces choix valent pour ce document et sont proposés aux prochains documents sur cet appareil. Décocher une saisie déjà remplie la remet à zéro (confirmation demandée).</p>`;
  };
  const hdrSummary = () => [cname(curClient()) || 'Aucun client', cur.siteRef, cur.date ? dateFr(cur.date) : '', (isQ ? QS : isC ? CS : IS)[cur.status]].filter(Boolean).join(' · ');
  const discHtml = () => `<label class="f"><span>Remise sur le total</span><div class="dr"><input name="discV" type="number" step="any" min="0" inputmode="decimal" value="${cur.disc && num(cur.disc.v) > 0 ? cur.disc.v : ''}" placeholder="0"><select name="discT"><option value="%" ${cur.disc?.t === '€' ? '' : 'selected'}>%</option><option value="€" ${cur.disc?.t === '€' ? 'selected' : ''}>€ HT</option></select></div></label>`;
  const stickyHtml = t => `<div class="stickybar" id="sbar"><div class="sbt"><span>HT <b id="sbht">${eur(t.ht)}</b></span><span><span id="sbtl">${t.hasDep ? 'Net' : 'TTC'}</span> <b id="sbttc">${eur(t.ttc)}</b></span></div><span class="sp"></span><button type="button" class="btn sm warnbtn" id="sbchk" hidden></button><button type="button" class="btn primary" id="sbsave">Enregistrer</button></div>`;

  const draw = () => {
    const t = totals(cur); redKey = redRates().join('|'); sidefit = null;
    const split = sideOn();
    el.classList.toggle('wide', split);
    el.innerHTML = `<div class="row"><a class="btn ghost" href="#/docs/${cur.type}">← Retour</a>${cur.siteId && sites.some(x => x.id === cur.siteId) ? `<a class="btn ghost" href="#/site/${cur.siteId}">🏗 Chantier</a>` : ''}<span class="sp"></span>
      <span class="seg"><button type="button" class="btn sm on" id="vedit">✎ Éditeur</button><button type="button" class="btn sm" id="vprev">👁 Aperçu</button></span><button type="button" class="btn sm optbtn${optOpen ? ' on' : ''}" id="optbtn" aria-expanded="${optOpen}" title="Choisir ce qui se saisit et s'affiche sur les lignes : TVA, remises, référence, marge, stock, photo…">⚙ Options</button><button type="button" class="btn" id="vlayout">🎨 Mise en page</button>
      ${!isNew ? '<button class="btn" id="print">Imprimer / PDF</button>' : ''}<button class="btn primary" id="save">Enregistrer</button></div>
    <div class="optpanel" id="optpanel" ${optOpen ? '' : 'hidden'}>${optPanelHtml()}</div>
    <div id="pvwrap" hidden></div><div id="edwrap" class="${split ? 'split' : ''}"><div class="edmain">
    <h2>${isQ ? 'Devis' : isC ? 'Avoir' : cur.deposit ? 'Facture d\'acompte' : 'Facture'} ${e(cur.number || '(nouveau)')}</h2>${isC && cur.fromInvoice ? `<p class="muted" style="margin-top:-6px">sur la facture <a href="#/doc/${cur.fromInvoice}">${e(cur.fromInvoiceNumber || '')}</a></p>` : ''}${isQ && cur.status === 'invoiced' ? invoicedBannerHtml() : ''}${cur.deposit && cur.fromQuote ? `<p class="muted" style="margin-top:-6px">Acompte sur le devis ${DN[cur.fromQuote] ? `<a href="#/doc/${cur.fromQuote}">${e(cur.fromQuoteNumber || '')}</a>` : e(cur.fromQuoteNumber || '')} · sera déduit de la facture finale</p>` : ''}${copyOf ? `<p class="muted" style="margin-top:-6px">Copie du ${isQ ? 'devis' : 'de la facture'} <b>${e(copyOf.number || '')}</b> : vérifiez le client et les lignes, puis enregistrez.</p>` : ''}
    <details class="card hdr" id="hdr" ${hdrOpen ? 'open' : ''}><summary><b id="hdrsum">${e(hdrSummary())}</b><span class="sp"></span><span class="muted"><span class="hdrlbl">En-tête</span> <span class="hdrtog">▾</span></span></summary><div class="cols">
      <label class="f full"><span>Client</span><input type="search" id="csearch" placeholder="🔍 Rechercher un client (nom, ville, code postal)…" autocomplete="off" style="margin-bottom:6px"><div style="display:flex;gap:6px"><select name="clientId"><option value="">— choisir —</option>${clients.map(c => `<option value="${c.id}" ${c.id === cur.clientId ? 'selected' : ''}>${e(cname(c))}${c.city ? ' — ' + e(c.city) : ''}</option>`).join('')}</select><button type="button" class="btn" id="newc">+</button></div></label>
      <label class="f full"><span>Chantier</span><input type="search" id="ssearch" placeholder="🔍 Rechercher un chantier (nom, client, n° de devis ou de facture, adresse)…" autocomplete="off" style="margin-bottom:6px"><div style="display:flex;gap:6px"><select name="siteId"><option value="">— aucun —</option>${sites.map(x => `<option value="${x.id}" ${x.id === cur.siteId ? 'selected' : ''}>${e(siteLabel(x))}</option>`).join('')}</select><button type="button" class="btn" id="newsite" title="Créer un chantier pour ce document">+</button></div></label>${(() => { const st = sites.find(x => x.id === cur.siteId), m = st && contacts.find(c => c.id === st.moeId); return m ? `<div class="full muted" id="moeinfo" style="margin:-4px 0 6px">🏛 ${e(m.name)}${m.fonction ? ' (' + e(m.fonction) + ')' : ''}${m.phone ? ' · ' + e(m.phone) : ''}</div>` : ''; })()}
      ${F('Date', 'date', cur.date, { type: 'date' })}
      ${F(isQ ? 'N° de devis' : isC ? 'N° d\'avoir' : 'N° de facture', 'number', cur.number, { ph: 'automatique à l\'enregistrement' })}${isQ ? F('Valable jusqu\'au', 'validUntil', cur.validUntil, { type: 'date' }) : ''}
      ${F('Réf. chantier', 'siteRef', cur.siteRef, { cls: 'full' })}
      ${F('Adresse du chantier', 'siteAddr', cur.siteAddr, { type: 'textarea', rows: 2, cls: 'full' })}
      ${richField('Intitulé', 'intro', cur.intro)}
      ${richField(isC ? 'Motif de l\'avoir' : 'Remarque', 'note', cur.note, { rows: 3 })}
      ${!isQ ? `<details class="full" ${cur.opType || cur.vatDebits || cur.deliveryAddr ? 'open' : ''}><summary class="muted" style="cursor:pointer;margin:4px 0">Facture électronique : nature d'opération, TVA sur les débits, adresse de livraison</summary><div class="cols">${F('Nature de l\'opération', 'opType', cur.opType || '', { type: 'select', options: [['', 'Par défaut (Réglages)'], ['goods', 'Livraison de biens'], ['services', 'Prestation de services'], ['mixed', 'Biens et services']] })}${F('TVA sur les débits', 'vatDebits', cur.vatDebits ?? '', { type: 'select', options: [['', 'Par défaut (Réglages)'], ['1', 'Oui'], ['0', 'Non']] })}${F('Adresse de livraison si différente de celle du client', 'deliveryAddr', cur.deliveryAddr, { type: 'textarea', rows: 2, cls: 'full' })}</div></details>` : ''}
      ${!isQ && !isC ? F('Date limite de règlement', 'dueDate', cur.dueDate || '', { type: 'date' }) : ''}
      ${F('Statut', 'status', cur.status, { type: 'select', options: Object.entries(isQ ? Object.fromEntries(Object.entries(QS).filter(([k]) => k !== 'invoiced' || canInv || cur.status === 'invoiced')) : isC ? CS : IS) })}
      ${F('TVA par défaut du document', 'tva', cur.tva, { type: 'select', options: TVAS })}
    </div></details>
    <div class="card lines"><div id="blocks"></div>
      <div class="discrow" id="discrow">${optOn('remTot') ? discHtml() : ''}</div>
      <div id="depbox">${depBoxHtml()}</div>
      <div class="totals" id="totbox">${totalsHtml(t)}</div><div id="redhint">${redHintHtml()}</div></div>
    ${isC ? '' : F('Conditions de règlement', 'terms', cur.terms, { type: 'textarea', rows: 5 })}
    ${!isNew ? (isC ? creditUseHtml(t) : isQ && cur.status === 'invoiced' && !payments.length && invoicesOfQuote().length ? invoicedPayHtml() : canPay ? paymentsHtml(t, payments) : '') : `<p class="muted">Enregistrez le document pour gérer ${isC ? 'son utilisation' : 'les règlements'}.</p>`}
    ${!isNew && isQ ? depositsCardHtml() : ''}
    ${!isNew ? '<div id="dfiles"></div>' : ''}
    ${!isNew ? actionsHtml() : ''}${stickyHtml(t)}</div>
    <aside id="sidepv" ${split ? '' : 'hidden'}><div class="sph"><b>Aperçu</b><span class="sp"></span><button type="button" class="btn sm" id="sidefull" title="Aperçu plein écran, où l'on peut cliquer sur un texte pour le modifier">⤢ Plein écran</button></div><div class="pvpaper" id="sidepaper"><div class="pvin" id="sidein"></div></div></aside></div>`;
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
  /* Factures finales issues du devis courant */
  const invoicesOfQuote = () => allDocs.filter(d => d.type === 'invoice' && !d.deposit && (d.id === cur.invoiceId || d.fromQuote === cur.id)).sort((a, b) => (a.date + a.number).localeCompare(b.date + b.number));
  const invLinks = () => invoicesOfQuote().map(d => `<a href="#/doc/${d.id}">${e(d.number || '(brouillon)')}</a>`).join(', ');
  /* Devis facturé : les règlements s'enregistrent sur la facture, plus sur le devis */
  const invoicedPayHtml = () => `<div class="card" id="payredir"><h3 style="margin-top:0">Règlements &amp; acomptes</h3><p style="margin:0">Ce devis est facturé : enregistrez les règlements sur la facture ${invLinks()}.</p></div>`;
  /* Devis facturé : rappel que la facture ne suit plus les modifications du devis */
  const invoicedBannerHtml = () => {
    const links = invLinks();
    return `<div class="invbanner" id="invbanner"><b>Ce devis est facturé</b>${links ? ` (facture n° ${links})` : ''} : vos modifications ne changeront pas la facture. Pour repartir de ses lignes, utilisez « Dupliquer ».</div>`;
  };
  /* Devis : factures d'acompte déjà émises et reste à facturer */
  const depositsCardHtml = () => {
    const all = allDocs.filter(d => d.type === 'invoice' && d.deposit && d.deposit.q === cur.id).sort((a, b) => (a.date + a.number).localeCompare(b.date + b.number));
    if (!all.length) return '';
    const got = round2(quoteDeposits(allDocs, cur.id).reduce((a, d) => a + totals(d).ttc, 0)), tq = totals(cur);
    return `<div class="card"><h3 style="margin-top:0">Factures d'acompte</h3>
      ${all.map(d => `<a class="item" href="#/doc/${d.id}" style="text-decoration:none;color:inherit"><div class="main"><div class="t">${e(d.number || '(brouillon)')}</div><div class="s">${dateFr(d.date)}</div></div><div class="r"><b>${eur(totals(d).ttc)}</b><div>${invBadge(d, allPay)}</div></div></a>`).join('')}
      <p style="margin-bottom:0">Facturé en acompte <b>${eur(got)}</b> sur ${eur(tq.ttc)} TTC · reste <b>${eur(Math.max(0, round2(tq.ttc - got)))}</b> à facturer. Les acomptes sont déduits automatiquement de la facture finale.</p></div>`;
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
  /* Suppression : seuls un devis et un brouillon (jamais émis : sans numéro, ou resté au statut « Brouillon ») se suppriment ; une facture émise s'annule par un avoir (numérotation continue, voir l'audit A1).
     Un avoir émis ne se supprime que s'il est le tout dernier de sa série, sans remboursement ni envoi : son numéro est alors réutilisé. */
  const creditedTtc = isC ? 0 : round2(creditsOfInv.filter(c => c.status !== 'draft').reduce((a, c) => a + totals(c).ttc, 0));
  const fullyCredited = !isQ && !isC && !!cur.number && totals(cur).ttc > 0.005 && creditedTtc >= totals(cur).ttc - 0.005;
  const freeDelete = isQ || !cur.number || cur.status === 'draft';
  const creditLast = isC && !!cur.number && cur.number === lastNumber(S, 'credit', +today().slice(0, 4)) && !allPay.some(p => p.creditId === cur.id && p.kind === 'remboursement') && !(cur.mails || []).length;
  const canDelete = freeDelete || creditLast;
  const deleteHtml = () => {
    if (canDelete) return '<button class="btn danger" id="delete">Supprimer</button>';
    if (isC) return '';
    if (fullyCredited) return '<span class="chip">Annulée par un avoir</span>';
    if (cur.status === 'cancelled') return '<span class="chip">Annulée</span>';
    return creditedTtc > 0.005 ? '' : '<button class="btn danger" id="cancelinv" title="Crée aussitôt un avoir total qui annule cette facture et rouvre son devis">Annuler par un avoir</button>';
  };
  const lockedNote = () => canDelete ? '' : `<p class="muted" style="margin-bottom:0">${isC ? 'Un avoir émis ne se supprime plus (numérotation continue).' : 'Une facture émise ne se supprime pas (numérotation continue) : elle s\'annule par un avoir.'}</p>`;
  const actionsHtml = () => `<div class="card"><div class="row">
      ${isC ? (cur.fromInvoice && DN[cur.fromInvoice] ? `<a class="btn" href="#/doc/${cur.fromInvoice}">Voir la facture</a>` : '') : ''}${cur.deposit && cur.fromQuote && DN[cur.fromQuote] ? `<a class="btn" href="#/doc/${cur.fromQuote}">Voir le devis</a>` : ''}
      ${!isQ && !isC && cur.status !== 'draft' ? '<button class="btn" id="tocredit">Créer un avoir</button>' : ''}
      ${isQ ? `${canInv ? '<button class="btn primary" id="toinv">Transformer en facture</button>' : ''}${canInv && cur.status !== 'invoiced' ? '<button class="btn" id="todep" title="Crée une facture d\'acompte (en pourcentage ou en montant) à partir de ce devis">Facture d\'acompte</button>' : ''}${cur.status !== 'accepted' && cur.status !== 'invoiced' ? '<button class="btn" id="accept">Marquer accepté</button>' : ''}` : (isC ? '' : cur.stockOut ? '<span class="chip ok">Stock déjà déduit</span>' : '<button class="btn" id="stockout">Déduire du stock</button>')}
      ${!isC && cur.number ? '<button class="btn" id="dupbtn" title="Crée un nouveau brouillon à partir de ce document">⧉ Dupliquer</button>' : ''}
      ${cur.number ? '<button class="btn" id="mailbtn">✉ Envoyer par e-mail</button>' : ''}
      ${!isQ && cur.status !== 'draft' && cur.number ? '<button class="btn" id="efact">🧾 Facture électronique</button>' : ''}
      ${deleteHtml()}</div>${lockedNote()}${(cur.mails || []).length ? `<p class="muted" style="margin-bottom:0">✉ ${cur.mails.slice(-3).map(m => `Envoyé le ${dateFr(String(m.at).slice(0, 10))} à ${e(m.to)}`).join(' · ')}</p>` : ''}${creditsOfInv.length ? `<p class="muted" style="margin-bottom:0">Avoirs : ${creditsOfInv.map(c => `<a href="#/doc/${c.id}">${e(c.number || '(brouillon)')}</a>`).join(', ')}</p>` : ''}</div>`;

  /* Totaux de l'éditeur : remise sur le total, une ligne de TVA par taux présent, acomptes déjà facturés, options à part */
  /* Marge du document (information interne, jamais imprimée) */
  const pc = v => (Math.round(v * 10) / 10).toString().replace('.', ',');
  const marginBoxHtml = () => {
    const m = docMargin(cur);
    if (!m.n) return '<div class="margbox"><b>Marge</b><span class="muted">Saisissez le prix d\'achat des lignes pour la calculer (information interne).</span></div>';
    return `<div class="margbox"><div><span>Marge${m.miss ? ` <small class="muted">(${m.n} ligne${m.n > 1 ? 's' : ''} sur ${m.n + m.miss})</small>` : ''}</span><b class="${m.margin < 0 ? 'neg' : 'pos'}">${eur(m.margin)}</b></div>
      <div class="trate"><span>Sur le prix de vente</span><b>${pc(m.pct)} %</b></div>${m.coef ? `<div class="trate"><span>Coefficient (vente ÷ achat)</span><b>× ${(Math.round(m.coef * 100) / 100).toString().replace('.', ',')}</b></div>` : ''}
      <div class="trate"><span>Achats</span><b>${eur(m.cost)}</b></div><small class="muted">Information interne, jamais imprimée.</small></div>`;
  };
  const totalsHtml = t => `${t.disc ? `<div><span>Total HT avant remise</span><b>${eur(t.gross)}</b></div><div class="trate"><span>Remise${cur.disc && cur.disc.t !== '€' ? ' ' + fmtRate(Math.min(100, num(cur.disc.v))) : ''}</span><b>− ${eur(t.disc)}</b></div>` : ''}<div><span>Total HT</span><b id="tht">${eur(t.full.ht)}</b></div>${t.rates.map(r => `<div class="trate"><span>TVA ${fmtRate(r.rate)}${t.rates.length > 1 ? ` <small class="muted">sur ${eur(r.ht0)}</small>` : ''}</span><b>${eur(r.tva0)}</b></div>`).join('')}${t.hasDep ? `<div><span>Total TTC</span><b>${eur(t.full.ttc)}</b></div><div class="trate dep"><span>Acomptes déjà facturés</span><b>− ${eur(t.depo.ttc)}</b></div><div class="big"><span>Net à payer</span><span id="tttc">${eur(t.ttc)}</span></div>` : `<div class="big"><span>Total TTC</span><span id="tttc">${eur(t.ttc)}</span></div>`}${t.opt ? `<div class="optrow"><span>Options non comprises (HT)</span><b>${eur(t.opt)}</b></div>` : ''}${optOn('margin') ? marginBoxHtml() : ''}`;
  /* Acomptes déjà facturés (facture finale) : liste en lecture seule et mise à jour si les factures d'acompte ont changé depuis */
  const depBoxHtml = () => {
    const deps = depsOf(cur), df = !isQ && !isC && !cur.deposit ? depsDiff(cur, allDocs) : null;
    if (!deps.length && !(df && df.add.length)) return '';
    const num0 = d => `${DN[d.id] ? `<a href="#/doc/${d.id}">${e(d.number)}</a>` : e(d.number)}`;
    const amt = d => { const ht = round2(d.rates.reduce((a, x) => a + num(x.ht), 0)), tv = round2(d.rates.reduce((a, x) => a + round2(num(x.ht) * num(x.rate) / 100), 0)); return round2(ht + tv); };
    const msg = df && !df.ok ? [...df.add.map(d => `l'acompte ${num0(d)} (${eur(amt(d))} TTC) n'est pas déduit`), ...df.changed.map(d => `l'acompte ${num0(d)} a été modifié depuis`), ...df.stale.map(d => `l'acompte ${e(d.number)} n'existe plus ou est annulé`)] : [];
    return `<div class="depbox"><b>Acomptes déjà facturés</b>${deps.map(d => `<div class="dl"><span>Facture d'acompte ${num0(d)} du ${e(dateFr(d.date))}</span><b>− ${eur(amt(d))}</b></div>`).join('')}${msg.length ? `<div class="dwarn">⚠ ${msg.join(' · ')}. <button type="button" class="btn sm" id="depupd">Mettre à jour les acomptes</button></div>` : ''}</div>`;
  };
  /* Taux réduit : rappel de la mention que le client certifie (remplace l'ancienne attestation) */
  const redRates = () => (cur.type === 'credit' ? [] : reducedRates(cur.lines, cur.tva));
  const redHintHtml = () => {
    const r = redRates(); if (!r.length) return '';
    return `<div class="redbox"><b>TVA à taux réduit (${e(listRates(r))})</b> — l'attestation papier (Cerfa) n'existe plus : le client certifie les conditions par une mention sur le ${isQ ? 'devis (à signer « Bon pour accord »)' : 'document'}, imprimée automatiquement.
      <label class="f" style="margin-top:6px"><span>Mention du client</span><select name="tvaRed"><option value="" ${cur.tvaRed ? '' : 'selected'}>Imprimer la mention (conseillé)</option><option value="0" ${cur.tvaRed === '0' ? 'selected' : ''}>Ne pas l'imprimer sur ce document</option></select></label>
      <span class="muted">Texte modifiable dans « Mise en page – zones ». Conservez le devis, les factures et les photos des travaux 5 ans.</span></div>`;
  };
  let redKey = redRates().join('|');
  const refreshTotals = () => {
    const t = totals(cur);
    $('#totbox', el).innerHTML = totalsHtml(t);
    const sb = $('#sbht', el); if (sb) { sb.textContent = eur(t.ht); $('#sbttc', el).textContent = eur(t.ttc); $('#sbtl', el).textContent = t.hasDep ? 'Net' : 'TTC'; }
    const k = redRates().join('|');
    if (k !== redKey) { redKey = k; const sel = $('[name=tvaRed]', el); if (sel) cur.tvaRed = sel.value; $('#redhint', el).innerHTML = redHintHtml(); }
    schedAux();
  };
  /* Contrôles du document (avant enregistrement ou à la demande) */
  const runChecks = () => { const probe = JSON.parse(JSON.stringify(cur)); pruneBlocks(probe); return checkDoc(probe, { client: curClient(), others: allDocs }); };
  const checksHtml = list => list.map(r => `<div class="chk ${r.level}"><b>${r.level === 'err' ? '✖' : '⚠'}</b> ${e(r.msg)}</div>`).join('');
  const confirmChecks = list => new Promise(res => {
    let ok = false;
    const d = modal('Avant d\'enregistrer', `<p class="muted" style="margin-top:0">Quelques points à vérifier :</p>${checksHtml(list)}`, () => { ok = true; }, { submitLabel: 'Enregistrer quand même' });
    d.addEventListener('close', () => res(ok), { once: true });
  });
  /* Mises à jour différées (après une frappe) : pastille des contrôles et aperçu à côté */
  const schedAux = () => { clearTimeout(auxT); auxT = setTimeout(updAux, 350); };
  const updAux = async () => {
    if (el._docRun !== run || !$('#edwrap', el)) return;
    readHeader(); const hs = $('#hdrsum', el); if (hs) hs.textContent = hdrSummary();
    const probe = JSON.parse(JSON.stringify(cur)); pruneBlocks(probe);
    const res = checkDoc(probe, { client: curClient(), others: allDocs }), chip = $('#sbchk', el);
    if (chip) { chip.hidden = !res.length; chip.textContent = '⚠ ' + res.length; chip.title = res.map(r => r.msg).join('\n'); chip.classList.toggle('bad', res.some(r => r.level === 'err')); }
    if (sideOn() && $('#sidein', el)) {
      const html = await sheetHtml(probe);
      if (el._docRun !== run || !$('#sidein', el)) return;
      $('#sidein', el).innerHTML = html;
      if (sidefit) sidefit.apply(); else sidefit = fitPaper($('#sidepaper', el), $('#sidein', el));
    }
  };
  /* Remise sur le total */
  const readDisc = () => {
    const v = $('[name=discV]', el), tt = $('[name=discT]', el); if (!v || !tt) return;
    if (num(v.value) > 0) cur.disc = { t: tt.value === '€' ? '€' : '%', v: num(v.value) }; else delete cur.disc;
  };

  const readHeader = () => {
    $$('[name]', el).forEach(i => { if (i.name in cur || ['clientId', 'validUntil', 'number', 'siteId', 'dueDate', 'opType', 'vatDebits', 'deliveryAddr', 'tvaRed'].includes(i.name)) cur[i.name] = i.value; });
    Object.assign(cur, readRich(el));
    readZones(); readDisc();
    cur.tva = num(cur.tva);
  };

  /* Devis accepté sans chantier : propose de le créer (client, adresse et devis déjà remplis) */
  const status0 = cur.status;
  const offerSite = () => {
    if (!isQ || cur.siteId || !cur.clientId) return;
    const cl = curClient(), pre = { clientId: cur.clientId, name: cur.siteRef || cname(cl) || '', address: cur.siteAddr || [cl.address, [cl.zip, cl.city].filter(Boolean).join(' ')].filter(Boolean).join('\n'), quoteId: cur.id };
    modal('Créer le chantier ?', `<p style="margin-top:0">Le devis <b>${e(cur.number)}</b> est accepté mais n'est rattaché à aucun chantier.</p><p style="margin-bottom:0">Créer le chantier maintenant ? Le client, l'adresse et ce devis seront déjà remplis ; vous pourrez ajuster le nom et les dates.</p>`,
      () => { setTimeout(() => import('./sites.js').then(m => m.newSiteModal(pre, () => { toast('Chantier créé et rattaché au devis'); refresh(); })), 0); },
      { submitLabel: 'Créer le chantier' });
  };

  const save = async () => {
    readHeader();
    const res = runChecks(), errs = res.filter(r => r.level === 'err');
    if (errs.length) {
      toast(errs[0].msg); const h = $('#hdr', el); if (h && errs.some(r => r.code !== 'disc100')) { h.open = true; hdrOpen = true; }
      if (errs.length > 1) modal('À corriger avant d\'enregistrer', checksHtml(errs), null);
      return false;
    }
    const warns = res.filter(r => r.level === 'warn' && !(cur.ack || []).includes(r.code));
    if (warns.length) { if (!(await confirmChecks(warns))) return false; cur.ack = [...new Set([...(cur.ack || []), ...warns.map(r => r.code)])]; }
    if (!cur.number && (cur.type === 'quote' || cur.status !== 'draft')) cur.number = await nextNumber(cur.type);
    pruneBlocks(cur);
    if (optOn('ref') || cur.opts) cur.opts = { ...(cur.opts || {}), ref: optOn('ref') ? 1 : 0 }; // la colonne « Réf. » imprimée suit le document, pas l'appareil
    await db.put('documents', cur);
    if (!isQ && !isC) await syncInvStatus(cur.id);
    await bumpSite(cur);
    if (isNew) { toast('Enregistré'); location.hash = '#/doc/' + cur.id; } else { toast('Enregistré'); refresh(); }
    if (isQ && cur.status === 'accepted' && status0 !== 'accepted') offerSite();
    return true;
  };

  /* Créer une facture d'acompte à partir du devis courant */
  const depositModal = async () => {
    readHeader(); pruneBlocks(cur); await db.put('documents', cur);
    const prev = quoteDeposits(allDocs, cur.id), tq = totals(cur), prevTtc = round2(prev.reduce((a, d) => a + totals(d).ttc, 0)), left = round2(tq.ttc - prevTtc);
    if (tq.ttc <= 0) return toast('Ce devis n\'a pas de montant à facturer');
    if (left <= 0.02) return toast('Ce devis est déjà facturé en totalité en acomptes');
    const qPaid = paidOf(allPay, cur.id), canAcc = !['accepted', 'invoiced'].includes(cur.status);
    const leftHt = round2(tq.ht - prev.reduce((a, d) => a + totals(d).ht, 0));
    const tooBig = (mode, v, sp) => sp.ttc > left + 0.02 || (mode === 'ttc' && v > left + 0.02) || (mode === 'ht' && v > leftHt + 0.02) || (mode === '%' && v > 100); // le montant demandé ne doit pas être rabattu en silence
    modal('Facture d\'acompte',
      `<p class="muted" style="margin-top:0">Devis <b>${e(cur.number)}</b> : ${eur(tq.ttc)} TTC${prev.length ? ` · déjà facturé en acompte : ${eur(prevTtc)} (${prev.map(d => e(d.number)).join(', ')})` : ''} · reste à facturer en acompte : <b>${eur(left)}</b>.</p>
      <div class="cols"><label class="f"><span>Type d'acompte</span><select name="mode"><option value="%">Pourcentage du devis</option><option value="ttc">Montant TTC (€)</option><option value="ht">Montant HT (€)</option></select></label>
      <label class="f"><span id="dvl">Pourcentage (%)</span><input name="value" type="number" step="any" min="0" inputmode="decimal" value="30" required></label>
      ${F('Date de la facture', 'date', today(), { type: 'date' })}${F('À régler avant le', 'dueDate', addDays(today(), num(S.payDays ?? 30)), { type: 'date' })}</div>
      <div class="depprev" id="depprev"></div>
      ${canAcc ? '<label class="dpck"><input type="checkbox" name="accept" checked> Marquer le devis comme accepté</label>' : ''}
      ${qPaid > 0.005 ? `<label class="dpck"><input type="checkbox" name="attach" checked> Rattacher à cette facture les règlements déjà enregistrés sur le devis (${eur(qPaid)})</label>` : ''}
      <p class="muted" style="margin-bottom:0">Le montant est réparti entre les taux de TVA du devis. Cette facture suit la numérotation des factures ; elle sera déduite automatiquement de la facture finale.</p>`,
      async o => {
        const sp = depositSplit(cur.lines, cur.tva, cur.disc, o.mode, o.value);
        if (!(sp.ttc > 0)) { alert('Montant d\'acompte invalide.'); return false; }
        if (tooBig(o.mode, num(o.value), sp)) { alert(`L'acompte demandé dépasse le reste à facturer (${eur(left)} TTC).`); return false; }
        const inv = await makeDeposit(cur, sp, { mode: o.mode, value: o.value, date: o.date, dueDate: o.dueDate, accept: !!o.accept, attach: !!o.attach });
        toast(`Facture d'acompte ${inv.number} créée`); go('#/doc/' + inv.id);
      }, { submitLabel: 'Créer la facture d\'acompte', onOpen: f => {
        const sel = f.querySelector('[name=mode]'), inp = f.querySelector('[name=value]'), att = f.querySelector('[name=attach]'); let touched = false;
        const upd = () => {
          const mode = sel.value, sp = depositSplit(cur.lines, cur.tva, cur.disc, mode, inp.value), over = tooBig(mode, num(inp.value), sp), box = f.querySelector('#depprev');
          f.querySelector('#dvl').textContent = mode === '%' ? 'Pourcentage (%)' : mode === 'ttc' ? 'Montant TTC (€)' : 'Montant HT (€)';
          box.className = 'depprev' + (over || !(sp.ttc > 0) ? ' bad' : '');
          box.innerHTML = sp.ttc > 0 || over ? `<b>Acompte : ${eur(sp.ttc)} TTC</b> (${e(String(sp.pct).replace('.', ','))} % du devis)<br>${eur(sp.ht)} HT${sp.rates.map(x => ` · TVA ${fmtRate(x.rate)} : ${eur(x.tva)}`).join('')}<br>${over ? '<b>Dépasse le reste à facturer</b>' : `Reste à facturer ensuite : ${eur(Math.max(0, round2(left - sp.ttc)))} TTC`}` : 'Saisissez un pourcentage ou un montant.';
          if (att) { const tooBig = qPaid > sp.ttc + 0.02; att.disabled = tooBig; if (tooBig) att.checked = false; else if (!touched) att.checked = true; }
        };
        sel.onchange = () => { inp.value = sel.value === '%' ? 30 : round2((sel.value === 'ttc' ? tq.ttc : tq.ht) * 0.3); upd(); };
        inp.oninput = upd; if (att) att.onchange = () => { touched = true; };
        upd();
      } });
  };

  /* Créer un avoir à partir de la facture courante */
  const creditModal = () => modal('Créer un avoir',
    `<p class="muted">Avoir sur la facture <b>${e(cur.number)}</b> (${eur(totals(cur).ttc)} TTC).</p>
    ${F('Type', 'mode', 'total', { type: 'select', options: [['total', 'Avoir total (reprend toutes les lignes)'], ['partial', 'Avoir partiel (je saisis le montant)']] })}
    ${F('Motif', 'reason', '', { ph: 'ex : malfaçon, remise accordée, erreur de facturation…' })}`,
    async o => {
      const cr = await newDoc('credit', { clientId: cur.clientId, siteId: cur.siteId || '', siteRef: cur.siteRef, siteAddr: cur.siteAddr, tva: cur.tva, terms: '', intro: 'Avoir sur facture ' + cur.number, note: o.reason, status: 'issued', fromInvoice: cur.id, fromInvoiceNumber: cur.number,
        lines: o.mode === 'total' ? JSON.parse(JSON.stringify(cur.lines)) : [{ desig: 'Remise / geste commercial', qty: 1, unit: 'u', pu: 0 }], ...(o.mode === 'total' && cur.disc ? { disc: { ...cur.disc } } : {}), ...(o.mode === 'total' && depsOf(cur).length ? { deps: JSON.parse(JSON.stringify(cur.deps)) } : {}) });
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
    const hdr = $('#hdr', el);
    hdr.addEventListener('toggle', () => { hdrOpen = hdr.open; });
    hdr.addEventListener('change', () => { readHeader(); $('#hdrsum', el).textContent = hdrSummary(); });
    $('.edmain', el).addEventListener('input', schedAux);
    $('#discrow', el).addEventListener('input', () => { readDisc(); refreshTotals(); });
    $('#depbox', el).addEventListener('click', ev => { // facture finale : remet les acomptes déduits en accord avec les factures d'acompte
      if (!ev.target.closest('#depupd')) return;
      const df = depsDiff(cur, allDocs);
      if (df.want.length) cur.deps = JSON.parse(JSON.stringify(df.want)); else delete cur.deps;
      $('#depbox', el).innerHTML = depBoxHtml(); refreshTotals(); toast('Acomptes mis à jour – pensez à enregistrer');
    });
    $('#sbsave', el).onclick = save;
    $('#sbchk', el).onclick = () => { readHeader(); const r = runChecks(); modal('Points à vérifier', r.length ? checksHtml(r) : '<p>Aucun point à signaler.</p>', null); };
    $('[data-side]', el).onchange = ev => { lsSet('gp_sidepv', ev.target.checked ? '1' : '0'); applySide(); };
    $('#sidefull', el).onclick = () => showPv(true);
    let pvChanged = false;
    const renderPv = async () => {
      const c = JSON.parse(JSON.stringify(cur)); pruneBlocks(c);
      $('#pvin', el).innerHTML = await sheetHtml(c, { edit: true }); fp?.apply();
    };
    const commitZone = (k, val) => {
      const d = zoneDefs(cur, S, curClient()).find(x => x.k === k); if (!d) return;
      const z = { ...(cur.zones || {}) };
      if (val === d.v) delete z[k]; else z[k] = val;
      if (Object.keys(z).length) cur.zones = z; else delete cur.zones;
      pvChanged = true;
    };
    let fp = null;
    const showPv = async on => {
      if (on) {
        readHeader(); pvChanged = false;
        $('#pvwrap', el).innerHTML = `<p class="muted" style="margin:6px 0">Aperçu tel qu'il sera imprimé. <b>Cliquez sur un texte pour le modifier</b>, ou ouvrez la <button type="button" class="btn sm" id="vlayout2">🎨 mise en page visuelle</button> pour déplacer les blocs, redimensionner le logo, ajouter des images… (rien n'est enregistré avant « Enregistrer »).</p>
          <div class="pvpaper" id="pvpaper"><div class="pvin" id="pvin"></div></div>`;
        $('#vlayout2', el).onclick = openVisual;
        await renderPv();
        fp = fitPaper($('#pvpaper', el), $('#pvin', el));
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
      $('#pvwrap', el).hidden = !on; $('#edwrap', el).hidden = on; $('#optbtn', el).hidden = on; $('#optpanel', el).hidden = on || !optOpen;
      $('#vedit', el).classList.toggle('on', !on); $('#vprev', el).classList.toggle('on', on);
      if (on) { window.scrollTo?.(0, 0); fp?.apply(); }
    };
    const openVisual = async () => {
      readHeader();
      const store = await loadTplStore();
      const baseTpl = () => normTpl(store[cur.type], cur.type);
      await openLayoutEditor({
        title: 'Mise en page – ce document', type: cur.type,
        ws: { tpl: normTpl(cur.tpl || store[cur.type], cur.type), zones: { ...(cur.zones || {}) }, layout: { ...(cur.layout || {}) } },
        defaultOf: k => zoneDefs(cur, S, curClient()).find(d => d.k === k)?.v ?? '',
        base: () => ({ tpl: baseTpl(), zones: {}, layout: {} }),
        render: (ws, le) => { const c2 = JSON.parse(JSON.stringify(cur)); pruneBlocks(c2); Object.assign(c2, { tpl: ws.tpl, zones: ws.zones, layout: ws.layout }); return sheetHtml(c2, { layoutEdit: le }); },
        onSave: async ws => {
          cur.tpl = ws.tpl; if (Object.keys(ws.zones).length) cur.zones = ws.zones; else delete cur.zones;
          if (Object.keys(ws.layout).length) cur.layout = ws.layout; else delete cur.layout;
          pvChanged = true; toast('Mise en page appliquée à ce document – pensez à enregistrer');
          if (!$('#pvwrap', el).hidden) await renderPv(); else draw();
        }
      });
    };
    $('#vlayout', el).onclick = openVisual;
    $('#vprev', el).onclick = () => showPv(true); $('#vedit', el).onclick = () => showPv(false);
    addressAutocomplete($('[name=siteAddr]', el), it => { $('[name=siteAddr]', el).value = it.label; });
    const blk = mountBlocks($('#blocks', el), cur, { onChange: refreshTotals, readHeader, view: () => ({ tva: optOn('tvaLine'), rem: optOn('remLine'), ref: optOn('ref'), margin: optOn('margin'), stock: optOn('stock'), photo: optOn('photo'), opt: optOn('optLine'), sub: optOn('secSub') }) });
    $('[name=tva]', el).addEventListener('change', ev => { cur.tva = num(ev.target.value); blk.redraw(); refreshTotals(); }); // le taux par défaut suit aussi les lignes sans taux propre
    /* Bouton « Options » (en haut, à côté d'Éditeur) */
    $('#optbtn', el).onclick = () => { optOpen = !optOpen; $('#optpanel', el).hidden = !optOpen; $('#optbtn', el).classList.toggle('on', optOpen); $('#optbtn', el).setAttribute('aria-expanded', String(optOpen)); };
    $$('[data-opt]', el).forEach(c => { c.onchange = () => {
      const k = c.dataset.opt, on = c.checked; readHeader(); readDisc();
      if (!on) {
        const st = lineStats(cur), pl = n => (n > 1 ? 's' : ''), ask = m => confirm(m + ' Continuer ?');
        if (k === 'tvaLine' && st.diff && !ask(`${st.diff} ligne${pl(st.diff)} ${st.diff > 1 ? 'ont' : 'a'} un taux de TVA différent de celui du document (${fmtRate(num(cur.tva))}). ${st.diff > 1 ? 'Elles passeront' : 'Elle passera'} au taux du document.`)) { c.checked = true; return; }
        if (k === 'remLine' && st.rem && !ask(`${st.rem} ligne${pl(st.rem)} ${st.rem > 1 ? 'ont' : 'a'} une remise. ${st.rem > 1 ? 'Ces remises seront supprimées' : 'Cette remise sera supprimée'}.`)) { c.checked = true; return; }
        if (k === 'remTot' && optHas(k) && !ask('La remise sur le total sera supprimée.')) { c.checked = true; return; }
        if (k === 'optLine' && st.opt && !ask(`${st.opt} ligne${pl(st.opt)} ${st.opt > 1 ? 'sont' : 'est'} en option. ${st.opt > 1 ? 'Elles seront comptées' : 'Elle sera comptée'} dans le total.`)) { c.checked = true; return; }
        if (k === 'remTot') delete cur.disc; else clearLineOpt(cur, k);
      }
      cur.opts = { ...(cur.opts || {}), [k]: on ? 1 : 0 }; setPref('ed_' + k, on ? '1' : '0');
      blk.redraw(); blk.applyView(); $('#discrow', el).innerHTML = optOn('remTot') ? discHtml() : '';
      refreshTotals();
    }; });
    if ($('#dfiles', el)) {
      const mainKind = cur.type === 'quote' ? 'devis' : 'factures', st0 = () => sites.find(x => x.id === cur.siteId);
      fl.filesCard({ host: $('#dfiles', el), title: 'Pièces jointes', canEdit: true, px: S.photoPx || 2560, kinds: ['photos', mainKind, 'autres'],
        list: () => cur.files || [],
        path: k => { const st = st0(); return st ? fl.sitePath(st, k) : ['GestPro', k === 'photos' ? 'Photos' : k === 'autres' ? 'Autres' : cur.type === 'quote' ? 'Devis' : 'Factures', String((cur.date || today()).slice(0, 4))]; },
        add: async a => { if (!a.pending) delete a.path; const fresh = (await db.get('documents', cur.id)) || cur; fresh.files = [...(fresh.files || []), a]; await db.put('documents', fresh); cur.files = fresh.files; const st = st0(); if (st && st.driveDir) await db.put('sites', st); },
        remove: async a => { const fresh = (await db.get('documents', cur.id)) || cur; fresh.files = (fresh.files || []).filter(x => x.id !== a.id); await db.put('documents', fresh); cur.files = fresh.files; } });
    }
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
    updAux();
    if (isNew) return;
    /* Mentions légales manquantes : prévenir une fois par document, avant impression ou envoi */
    const mentionsOk = async () => {
      const miss = checkMentions(S, { client: curClient() }).filter(r => !(cur.ack || []).includes(r.code));
      if (!miss.length) return true;
      if (!confirm('Mentions légales manquantes sur ce document :\n\n' + miss.map(r => '• ' + r.msg).join('\n') + '\n\nContinuer quand même ?')) return false;
      cur.ack = [...new Set([...(cur.ack || []), ...miss.map(r => r.code)])]; return true;
    };
    $('#print', el).onclick = async () => { readHeader(); pruneBlocks(cur); if (!(await mentionsOk())) return; await db.put('documents', cur); printDoc(cur); };
    $('#dupbtn', el)?.addEventListener('click', async () => { readHeader(); pruneBlocks(cur); await db.put('documents', cur); go('#/doc/new/copy:' + cur.id); });
    $('#mailbtn', el)?.addEventListener('click', async () => {
      readHeader(); pruneBlocks(cur); if (!(await mentionsOk())) return; await db.put('documents', cur);
      (await import('./docmail.js')).mailModal({ doc: cur, S, client: curClient(), payments, DN, onSent: () => refresh() });
    });
    $('#efact', el)?.addEventListener('click', async () => {
      readHeader(); pruneBlocks(cur); await db.put('documents', cur);
      const cli = curClient(), orig = isC && cur.fromInvoice ? DN[cur.fromInvoice] : null;
      const o = { paid: isC ? 0 : paidOf(payments, cur.id), fromInvoiceNumber: orig?.number || cur.fromInvoiceNumber || '', fromInvoiceDate: orig?.date || '', vatNote: vatNoteOf(cur, S) };
      const res = efact.check(cur, S, cli, o), blocked = res.some(r => r.level === 'err');
      const ic = { err: '✖', warn: '⚠', info: 'ℹ', ok: '✔' }, col = { err: 'var(--bad,#c0392b)', warn: '#b7791f', info: '#2c6fb7', ok: '#2f855a' };
      modal('Facture électronique – ' + (cur.number || ''), `<p class="muted">Contrôle des mentions obligatoires avant dépôt sur une plateforme agréée (Fulll, par exemple). Le fichier est créé sur cet appareil, rien n'est envoyé.</p>
        ${res.map(r => `<div style="margin:4px 0;color:${col[r.level]}"><b>${ic[r.level]}</b> ${e(r.msg)}${r.fix ? ' <span class="muted">(' + e(r.fix) + ')</span>' : ''}</div>`).join('')}
        <div class="row" style="margin-top:12px"><button type="button" class="btn primary" id="fxpdf" ${blocked ? 'disabled' : ''}>Télécharger la facture Factur-X (PDF)</button><button type="button" class="btn" id="fxxml" ${blocked ? 'disabled' : ''}>XML seul</button></div>
        ${blocked ? '<p class="muted">Corrigez les points ✖ puis rouvrez cette fenêtre.</p>' : ''}`, null, {
        onOpen: f => {
          const mdl = efact.model(cur, S, cli, o), base = (cur.type === 'credit' ? 'avoir-' : 'facture-') + String(cur.number).replace(/[^\w.-]+/g, '_');
          $('#fxxml', f).onclick = () => downloadFile(base + '-facturx.xml', efact.facturxXml(mdl), 'text/xml');
          $('#fxpdf', f).onclick = async ev => {
            const b = ev.target; b.disabled = true; b.textContent = 'Création du PDF…';
            try {
              const pdf = await (await import('./docmail.js')).facturxBytes(cur, S, cli, o);
              downloadFile(base + '-facturx.pdf', pdf, 'application/pdf'); toast('Facture Factur-X créée');
            } catch (err) { alert('Création impossible : ' + (err.message || err)); }
            b.disabled = false; b.textContent = 'Télécharger la facture Factur-X (PDF)';
          };
        }
      });
    });
    const delBtn = $('#delete', el);
    if (delBtn) delBtn.onclick = async () => {
      if (!canDelete) return toast(isC ? 'Un avoir émis ne se supprime plus' : 'Une facture émise ne se supprime pas : annulez-la par un avoir'); // garde-fou (le bouton n'existe pas dans ce cas)
      const msg = creditLast
        ? `Supprimer l'avoir ${cur.number} ? Son numéro sera réutilisé, et ses déductions sur des factures seront annulées.`
        : 'Supprimer ce document et ses règlements ?';
      if (!confirm(msg)) return;
      if (isC) {
        for (const p of allPay.filter(x => x.creditId === cur.id)) { await db.del('payments', p.id); if (p.kind === 'avoir') await syncInvStatus(p.docId); }
        if (creditLast) { // le numéro redevient libre ; un avoir d'annulation remet la facture et le devis dans leur état d'avant
          const S2 = await getS(), q = seqOf(S2, 'credit', +today().slice(0, 4));
          if (cur.number === lastNumber(S2, 'credit', +today().slice(0, 4))) { S2[q.key] = q.n - 1; if (yearTok(q.pre)) S2[q.yk] = q.yr; await db.saveSettings(S2); }
          const rq = cur.reopens && await db.get('documents', cur.reopens.quote);
          if (rq && rq.status === 'accepted' && !rq.invoiceId) { rq.status = 'invoiced'; rq.invoiceId = cur.reopens.invoice; await db.put('documents', rq); }
        }
      } else for (const p of payments) await db.del('payments', p.id);
      await db.del('documents', cur.id); go('#/docs/' + cur.type);
    };
    /* Annuler une facture émise : avoir total créé en un clic, déduit de la facture, qui rouvre le devis d'origine */
    const cancelBtn = $('#cancelinv', el);
    if (cancelBtn) cancelBtn.onclick = async () => {
      const t0 = totals(cur), paid0 = paidOf(payments, cur.id), q0 = cur.fromQuote && !cur.deposit ? DN[cur.fromQuote] : null;
      const reopen = q0 && q0.status === 'invoiced' && !allDocs.some(d => d.id !== cur.id && d.type === 'invoice' && !d.deposit && d.fromQuote === q0.id && counts(d));
      if (!confirm(`Annuler la facture ${cur.number} (${eur(t0.ttc)} TTC) par un avoir total ?\n\nUn avoir est créé et numéroté tout de suite : c'est définitif.${reopen ? `\nLe devis ${q0.number} repasse en « Accepté » et pourra être refacturé.` : ''}${paid0 > 0.005 ? `\n${eur(paid0)} déjà encaissé : cette somme reste à rembourser au client ou à déduire de la prochaine facture.` : ''}${cur.stockOut ? '\nLa sortie de stock déjà faite pour cette facture n\'est pas annulée.' : ''}`)) return;
      cancelBtn.disabled = true;
      const cr = await newDoc('credit', { clientId: cur.clientId, siteId: cur.siteId || '', siteRef: cur.siteRef, siteAddr: cur.siteAddr, tva: cur.tva, terms: '', intro: 'Avoir sur facture ' + cur.number, note: 'Annulation de la facture ' + cur.number, status: 'issued', fromInvoice: cur.id, fromInvoiceNumber: cur.number,
        lines: JSON.parse(JSON.stringify(cur.lines)), ...(cur.blocks ? { blocks: copyBlocks(cur.blocks) } : {}), ...(cur.disc ? { disc: { ...cur.disc } } : {}), ...(depsOf(cur).length ? { deps: JSON.parse(JSON.stringify(cur.deps)) } : {}), ...(cur.opts ? { opts: { ...cur.opts } } : {}) });
      ensureBlocks(cr);
      if (reopen) cr.reopens = { quote: q0.id, invoice: cur.id };
      cr.number = await nextNumber('credit'); await db.put('documents', cr);
      const rest = Math.max(0, round2(t0.ttc - paid0)), ded = Math.min(totals(cr).ttc, rest); // la part non encaissée de la facture est soldée par l'avoir
      if (ded > 0.005) { await db.put('payments', { docId: cur.id, creditId: cr.id, amount: ded, date: today(), method: 'avoir', kind: 'avoir', note: 'Avoir ' + cr.number }); await syncInvStatus(cur.id); }
      if (reopen) { const q = await db.get('documents', q0.id); q.status = 'accepted'; delete q.invoiceId; await db.put('documents', q); }
      toast(`Facture annulée : avoir ${cr.number} créé`); go('#/doc/' + cr.id);
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
    if (canPay && $('#addpay', el)) {
      $('#addpay', el).onclick = () => payModal();
      $$('[data-m]', el).forEach(b => b.onclick = () => payModal(null, left || '', b.dataset.m));
      $$('[data-pct]', el).forEach(b => b.onclick = () => payModal(null, round2(t.ttc * +b.dataset.pct / 100)));
      $('#rest', el).onclick = () => payModal(null, Math.max(0, round2(t.ttc - paid)));
      $$('[data-pay]', el).forEach(n => n.onclick = () => { const p = payments.find(x => x.id === n.dataset.pay); if (p.creditId) go('#/doc/' + p.creditId); else payModal(p); });
    }
    if (isQ) {
      $('#todep', el)?.addEventListener('click', depositModal);
      $('#accept', el)?.addEventListener('click', async () => { readHeader(); cur.status = 'accepted'; await db.put('documents', cur); await bumpSite(cur); toast('Devis accepté'); refresh(); offerSite(); });
      if (canInv) $('#toinv', el).onclick = async () => {
        if (cur.status !== 'accepted' && !confirm('Ce devis n\'est pas marqué « accepté ». Créer la facture quand même ?')) return;
        readHeader();
        const nopt = (cur.lines || []).filter(isOpt).length;
        if (nopt && !confirm(`${nopt === 1 ? 'Une ligne est en option et ne sera pas reprise' : nopt + ' lignes sont en option et ne seront pas reprises'} dans la facture (décochez « Option » sur le devis pour celles que le client a acceptées). Créer la facture ?`)) return;
        const dps = quoteDeposits(allDocs, cur.id);
        if (dps.length && !confirm(`${dps.length === 1 ? 'La facture d\'acompte' : 'Les ' + dps.length + ' factures d\'acompte'} ${dps.map(d => d.number).join(', ')} (${eur(dps.reduce((a, d) => a + totals(d).ttc, 0))} TTC) ser${dps.length === 1 ? 'a' : 'ont'} déduite${dps.length === 1 ? '' : 's'} de la facture finale. Continuer ?`)) return;
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
  try { matchMedia('(min-width:1200px)').addEventListener('change', applySide); } catch { /* ancien navigateur */ }
  draw();
}

/* ---------- Impression ---------- */
/* ---------- Zones modifiables du document ----------
   Chaque zone imprimée a un texte par défaut (calculé depuis les Réglages / le client / le document).
   doc.zones ne contient que les zones modifiées à la main pour CE document.
   Balisage : **gras**  __souligné__ ; jetons : {numero} {date} {ville} {validite} {siteRef} {siteAddr} {company} {iban} {bic} */
export const ZONE_TOKENS = '{numero} {date} {ville} {validite} {siteRef} {siteAddr} {company} {iban} {bic} {taux}';
/* Mention remplaçant l'attestation de TVA réduite (loi de finances 2025) : le client certifie les conditions sur le devis ou la facture. */
export const TVA_RED_TXT = `**Attestation du client – TVA à taux réduit ({taux})**
Le client atteste que les travaux portent sur un local à usage d'habitation achevé depuis plus de deux ans, qu'ils ne concourent pas à la production d'un immeuble neuf (pas de construction nouvelle, de surélévation ni d'agrandissement de plus de 10 % de la surface de plancher), et que les travaux et équipements facturés à ce taux remplissent les conditions d'application du taux réduit de TVA. À défaut, le client est redevable du complément de TVA.`;
const oneLine = t => String(t || '').replace(/\s*\n\s*/g, ', ').trim();
/* Mentions légales imprimées en pied de page : n° de TVA, RCS / RM, médiateur de la consommation (seulement ce qui est renseigné dans Réglages) */
export function legalText(S) {
  const rcs = String(S.rcs || '').trim(), rm = String(S.rm || '').trim(), tva = String(S.tvaNum || '').trim();
  const l1 = [tva ? 'N° TVA intracommunautaire : ' + tva : '', rcs ? (/r\.?\s?c\.?\s?s/i.test(rcs) ? rcs : 'RCS ' + rcs) : '', rm ? (/\br\.?\s?m\b/i.test(rm) ? rm : 'RM ' + rm) : ''].filter(Boolean).join(' – ');
  const l2 = String(S.mediator || '').trim() ? 'Médiateur de la consommation : ' + oneLine(S.mediator) : '';
  return [l1, l2].filter(Boolean).join('\n');
}
export function zoneDefs(doc, S, c = {}, base = false) {
  const isQ = doc.type === 'quote', isC = doc.type === 'credit', ty = isQ ? 'q' : isC ? 'c' : 'i';
  const addr = [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  const T = isQ ? 'Devis' : isC ? 'Avoir' : 'Facture';
  const L = [
    ['coName', 'En-tête – nom de l\'entreprise', S.sub || S.company || '', 2, 'qic'],
    ['coInfo', 'En-tête – coordonnées de l\'entreprise', [S.owner ? '**' + S.owner + '**' : '', S.address, S.phone, S.legal, S.email, S.web, S.siret ? 'N°SIRET : ' + S.siret : ''].filter(Boolean).join('\n'), 7, 'qic'],
    ['certs', 'En-tête – RGE / assurances', [S.rge ? '**RGE** Numéro ' + S.rge : '', S.insurance ? 'Assurance Responsabilité Travaux ' + S.insurance : '', S.insurance ? 'Assurance Responsabilité Civile ' + S.insurance : ''].filter(Boolean).join('\n'), 3, 'qic'],
    ['client', 'Bloc client (destinataire)', [cname(c) || '', c.company ? [c.companyCiv, c.company].filter(Boolean).join(' ') : '', addr, !isQ && efact.sirenOf(c.siret).length === 9 ? 'SIREN : ' + efact.sirenOf(c.siret) : ''].filter(Boolean).join('\n'), 4, 'qic'],
    ['chantier', 'Bloc « Réf chantier »', '**__Réf chantier :__**\n{siteRef}\n**{siteAddr}**', 3, 'qic'],
    ['title', 'Titre du document', T + ' {numero}', 1, 'qic'],
    ['dateLine', 'Ligne ville / date', '**{ville}, le   {date}**', 1, 'qic'],
    ['validLine', isQ ? 'Validité du devis' : 'Date limite de règlement', isQ ? 'Valable jusqu\'au {validite}' : 'À régler avant le {validite}', 1, 'qi'],
    ['thRef', 'Tableau – colonne Réf. (si la référence est activée dans les Options)', 'Réf.', 1, 'qic'],
    ['thDes', 'Tableau – colonne 1', 'DESIGNATION', 1, 'qic'],
    ['thQty', 'Tableau – colonne 2', 'Qté', 1, 'qic'],
    ['thUnit', 'Tableau – colonne 3', 'Unité', 1, 'qic'],
    ['thPu', 'Tableau – colonne 4', 'Prix unit.', 1, 'qic'],
    ['thHt', 'Tableau – dernière colonne', 'Prix H.T', 1, 'qic'],
    ['thTva', 'Tableau – colonne TVA (si plusieurs taux)', 'TVA', 1, 'qic'],
    ['lblHt', 'Totaux – libellé HT', 'Total HT', 1, 'qic'],
    ['lblGross', 'Totaux – libellé HT avant remise', 'Total HT avant remise', 1, 'qic'],
    ['lblDisc', 'Totaux – libellé remise', 'Remise', 1, 'qic'],
    ['lblTva', 'Totaux – libellé TVA', 'TVA', 1, 'qic'],
    ['lblTtc', 'Totaux – libellé TTC', isC ? 'Total TTC de l\'avoir' : 'Total TTC', 1, 'qic'],
    ['lblDep', 'Totaux – acompte déjà facturé (suivi du n° et de la date de la facture d\'acompte)', 'Acompte déjà facturé – facture n°', 1, 'ic'],
    ['lblNet', 'Totaux – net à payer après acomptes', isC ? 'Net de l\'avoir après acomptes' : 'Net à payer après acomptes', 1, 'ic'],
    ['vatRed', 'Mention du client – TVA à taux réduit (travaux dans un logement)', TVA_RED_TXT, 6, 'qi'],
    ['lblOpt', 'Totaux – options non comprises', 'Options non comprises dans le total (HT)', 1, 'qi'],
    ['lblPaid', 'Totaux – déjà réglé', isC ? 'Déjà déduit / remboursé' : 'Déjà réglé', 1, 'ic'],
    ['lblLeft', 'Totaux – reste', isC ? 'Reste à votre crédit' : 'Reste à payer', 1, 'ic'],
    ['methods', 'Moyens de paiement acceptés', '**Moyens de paiement acceptés :** ' + REAL_METHODS.filter(m => m[0] !== 'autre').map(m => m[1]).join(', ') + '.', 2, 'q'],
    ['creditTxt', 'Mention de l\'avoir', '**Avoir** – à déduire de votre prochaine facture ou remboursé.', 2, 'c'],
    ['lblMotif', 'Libellé du motif', 'Motif :', 1, 'c'],
    ['payLbl', 'Titre du bloc règlement', '**Règlement**', 1, 'qi'],
    ['sigLeft', 'Signature (gauche)', isQ ? '**Bon pour accord – date et signature du client**' : '**Signature Entrepreneur**', 2, 'qic'],
    ['bank', 'Coordonnées bancaires (droite)', S.iban && !isC ? '**__Vous pouvez régler cette facture par virement__**\n**{company}**\n**IBAN** : {iban}\n**Code BIC** : {bic}' : '', 4, 'qi'],
    ['delay', 'Délai d\'exécution (devis)', S.delay ? '**Délai d\'exécution :** ' + oneLine(S.delay) : '', 1, 'q'],
    ['legal', 'Mentions légales (pied de page)', legalText(S), 2, 'qic'],
  ];
  const so = (!base && S.zones && S.zones[ty]) || {}; // réglages généraux (Réglages > Mise en page des documents)
  const dep = t => (doc.deposit && !/acompte/i.test(t) ? t.replace(/facture/i, m => m + ' d\'acompte') : t); // facture d'acompte : le titre le dit
  return L.filter(z => z[4].includes(ty)).map(([k, label, v, rows]) => { const val = k in so ? so[k] : v; return { k, label, v: k === 'title' ? dep(val) : val, rows }; });
}
/* Texte de la mention « TVA réduite » tel qu'imprimé (vide si elle n'a pas lieu d'être) */
export function vatNoteOf(doc, S) {
  if (doc.type === 'credit' || doc.tvaRed === '0') return '';
  const r = reducedRates(doc.lines, doc.tva); if (!r.length) return '';
  const ov = doc.zones || {}, txt = 'vatRed' in ov ? ov.vatRed : (zoneDefs(doc, S).find(x => x.k === 'vatRed')?.v ?? '');
  return String(txt).replace(/\{taux\}/g, listRates(r)).replace(/\*\*|__/g, '').trim();
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
function colgroup(LY, vat, ref) {
  const cols = [['cQty', 9], ['cUnit', 8], ['cPu', 14], ['cHt', 14]];
  if (!cols.some(([k]) => LY[k] != null)) return '';
  const col = ([k, dv]) => `<col style="width:${lyNum(LAYOUT.find(d => d[0] === k), LY[k] ?? dv) ?? dv}%">`;
  return '<colgroup>' + (ref ? '<col style="width:13%">' : '') + '<col>' + cols.slice(0, 3).map(col).join('') + (vat ? '<col style="width:9%">' : '') + col(cols[3]) + '</colgroup>';
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

export async function sheetHtml(doc, opts = {}) {
  const [S0, contacts, payments, store] = await Promise.all([getS(), db.all('contacts'), db.all('payments'), loadTplStore()]);
  const S = { ...S0, ...(opts.S || {}) };
  setStyles(S);
  const c = contacts.find(x => x.id === doc.clientId) || {};
  const t = totals(doc), paid = paidOf(payments, doc.id);
  const isQ = doc.type === 'quote', isC = doc.type === 'credit';
  const used = isC ? creditUsed(payments, doc.id) : paid;
  const defs = zoneDefs(doc, S, c), ov = doc.zones || {};
  const vars = { numero: doc.number || '', date: dateFr(doc.date), ville: S.city || '', validite: isQ ? (doc.validUntil ? dateFr(doc.validUntil) : '') : (doc.dueDate ? dateFr(doc.dueDate) : ''), siteRef: doc.siteRef || '', siteAddr: doc.siteAddr || '', company: S.company || '', iban: S.iban || '', bic: S.bic || '', taux: listRates(reducedRates(doc.lines, doc.tva).length ? reducedRates(doc.lines, doc.tva) : [10]) };
  const efMent = () => { const m = efact.mentions(doc, S); return m.length ? '<div class="small" style="margin-top:4px">' + m.map(x => e(x)).join('<br>') + '</div>' : ''; };
  const Zt = k => k in ov ? ov[k] : (defs.find(d => d.k === k)?.v ?? '');
  const LE = !!opts.layoutEdit, ED = !!opts.edit && !LE, LY = layoutOf(S, doc);
  const Z = k => { const h = zhtml(Zt(k), vars); return ED ? `<span class="zn" data-z="${k}" title="Cliquer pour modifier">${h || '<i class="zempty">(zone vide – cliquer)</i>'}</span>` : h; };
  const tpl = normTpl(doc.tpl || store[doc.type], doc.type);
  const imgs = await imagesOf(tpl);
  const pos = it => ({ center: 'center top', right: 'right top' }[(it.st || {}).al] || 'left top');
  const content = it => {
    switch (it.k) {
      case 'logo': return `<img src="${logoSrc(S)}" alt="" style="width:100%;height:100%;object-fit:contain;object-position:${pos(it)}">`;
      case 'image': return imgs[it.img] ? `<img src="${imgs[it.img]}" alt="" style="width:100%;height:100%;object-fit:contain;object-position:${pos(it)}">` : '<span class="zempty">(image)</span>';
      case 'text': return zhtml(it.t || '', vars);
      case 'title': return `<h1>${Z('title')}</h1>`;
      case 'intro': return `<b><u>${richHtml(doc.intro)}</u></b>`;
      case 'note': return isC ? '' : richHtml(doc.note);
      case 'dateLine': return `<span class="dl">${Z('dateLine')}</span>${((isQ && doc.validUntil) || (!isQ && !isC && doc.dueDate)) && (Zt('validLine') || ED) ? `<br><span class="small">${Z('validLine')}</span>` : ''}`;
      case 'pay': return `${Z('payLbl')}<br>${e(doc.terms).replace(/\n/g, '<br>')}${efMent()}`;
      case 'creditTxt': return `${Z('creditTxt')}${doc.note ? '<br>' + Z('lblMotif') + ' ' + richHtml(doc.note) : ''}${efMent()}`;
      default: return Z(it.k);
    }
  };
  const multi = t.rates.length > 1, rf = refOn(doc), NC = (multi ? 6 : 5) + (rf ? 1 : 0);
  /* Facture finale : acomptes déjà facturés (un par facture d'acompte), puis net à payer */
  const depRows = () => {
    if (!t.hasDep) return '';
    const rows = depsOf(doc).map(d => {
      const ht = round2(d.rates.reduce((a, x) => a + num(x.ht), 0)), tv = round2(d.rates.reduce((a, x) => a + round2(num(x.ht) * num(x.rate) / 100), 0));
      return `<tr class="depr"><td colspan="${NC - 1}">${Z('lblDep')} ${e(d.number)} du ${e(dateFr(d.date))} <span class="small">(${eur(ht)} HT + ${eur(tv)} TVA)</span></td><td class="n">− ${eur(round2(ht + tv))}</td></tr>`;
    }).join('');
    return `${rows}<tr class="t"><td colspan="${NC - 1}">${Z('lblNet')}</td><td class="n">${eur(t.ttc)}</td></tr>`;
  };
  const redOn = !isC && doc.tvaRed !== '0' && (LE || reducedRates(doc.lines, doc.tva).length > 0) && (ED || String(Zt('vatRed')).trim());
  const vatMent = redOn ? `<tr class="vatm"><td colspan="${NC}" class="small">${Z('vatRed')}</td></tr>` : '';
  return `<div class="sheet${ED ? ' pvedit' : ''}${LE ? ' lyedit' : ''}" style="${layoutStyle(LY)}">
    ${canvasHtml(tpl, 'h', content, LE)}
    <div class="tblwrap"><table class="${colgroup(LY, multi, rf) ? 'fx' : ''}">${colgroup(LY, multi, rf)}<thead><tr>${rf ? `<th>${Z('thRef')}</th>` : ''}<th>${Z('thDes')}</th><th>${Z('thQty')}</th><th>${Z('thUnit')}</th><th>${Z('thPu')}</th>${multi ? `<th>${Z('thTva')}</th>` : ''}<th>${Z('thHt')}</th></tr></thead><tbody>
    ${printRows(ensureBlocks(doc))}
    ${t.disc ? `<tr><td colspan="${NC - 1}">${Z('lblGross')}</td><td class="n">${eur(t.gross)}</td></tr><tr><td colspan="${NC - 1}">${Z('lblDisc')}${doc.disc && doc.disc.t !== '€' ? ' ' + e(fmtRate(Math.min(100, num(doc.disc.v)))) : ''}</td><td class="n">− ${eur(t.disc)}</td></tr>` : ''}
    <tr><td colspan="${NC - 1}">${Z('lblHt')}</td><td class="n">${eur(t.full.ht)}</td></tr>
    ${t.rates.map(r => `<tr><td colspan="${NC - 2}">${Z('lblTva')}${multi ? ` <span class="small">(sur ${eur(r.ht0)} HT)</span>` : ''}</td><td class="n">${fmtRate(r.rate)}</td><td class="n">${eur(r.tva0)}</td></tr>`).join('')}
    <tr class="t${t.hasDep ? ' pre' : ''}"><td colspan="${NC - 1}">${Z('lblTtc')}</td><td class="n">${eur(t.full.ttc)}</td></tr>
    ${depRows()}
    ${t.opt && !isC ? `<tr class="optt"><td colspan="${NC - 1}"><i>${Z('lblOpt')}</i></td><td class="n"><i>${eur(t.opt)}</i></td></tr>` : ''}
    ${used ? `<tr><td colspan="${NC - 1}">${Z('lblPaid')}</td><td class="n">− ${eur(used)}</td></tr><tr class="t"><td colspan="${NC - 1}">${Z('lblLeft')}</td><td class="n">${eur(Math.max(0, round2(t.ttc - used)))}</td></tr>` : ''}
    ${vatMent}
    </tbody></table></div>
    ${canvasHtml(tpl, 'f', content, LE)}</div>`;
}

/* Éditeur visuel : mode « modèle » (Réglages, pour tous les documents d'un type) ou mode « document » */
export async function editTemplate(type) {
  const T = { quote: 'q', invoice: 'i', credit: 'c' }[type], NAME = { quote: 'devis', invoice: 'factures', credit: 'avoirs' }[type];
  const [S, docs, store] = await Promise.all([getS(), db.all('documents'), loadTplStore()]);
  let sample = docs.filter(d => d.type === type).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  sample = sample ? JSON.parse(JSON.stringify(sample)) : { id: 'sample', type, number: 'EXEMPLE-001', date: today(), tva: 20, clientId: '', siteRef: 'Rénovation – Maison Dupont', siteAddr: '1 rue des Lilas\n87000 LIMOGES', intro: 'Fourniture et pose de menuiseries', note: '', terms: 'Paiement à 30 jours.', lines: [{ desig: 'Fenêtre PVC 2 vantaux', qty: 2, unit: 'u', pu: 420 }, { desig: 'Pose et finitions', qty: 1, unit: 'forfait', pu: 350 }] };
  delete sample.zones; delete sample.layout; delete sample.tpl;
  const base = () => ({ tpl: defaultTpl(type), zones: {}, layout: {} });
  await openLayoutEditor({
    title: 'Mise en page – ' + NAME, type,
    ws: { tpl: normTpl(store[type], type), zones: { ...((S.zones || {})[T] || {}) }, layout: { ...(S.layout || {}) } },
    defaultOf: k => zoneDefs({ type }, S, {}, true).find(d => d.k === k)?.v ?? '',
    base,
    render: (ws, le) => sheetHtml({ ...sample, tpl: ws.tpl }, { layoutEdit: le, S: { zones: { ...(S.zones || {}), [T]: ws.zones }, layout: ws.layout } }),
    onSave: async ws => {
      const zones = { ...(S.zones || {}) }; if (Object.keys(ws.zones).length) zones[T] = ws.zones; else delete zones[T];
      await db.saveSettings({ ...S, zones, layout: ws.layout });
      await saveTplStore({ ...store, [type]: ws.tpl });
      toast('Mise en page enregistrée'); refresh();
    }
  });
}

async function printDoc(doc) {
  $('#printarea').innerHTML = await sheetHtml(doc);
  await Promise.all([...$('#printarea').querySelectorAll('img')].map(i => (i.decode ? i.decode().catch(() => {}) : null)));
  setTimeout(() => window.print(), 60);
}
