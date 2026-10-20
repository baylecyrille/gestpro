// Calculs financiers : période, CA, achats, TVA, courbe mensuelle, rentabilité d'un chantier.
import { num, round2, today } from './util.js';
import { doneBySite } from './hours.js';
import { totals, counts } from './docs.js';
import { buyRate } from './vat.js';
import { opOf, vatDebitsOf } from './efact.js';
import { addDays } from './team.js';

export const PERIODS = [['d30', '30 derniers jours'], ['m3', '3 derniers mois'], ['y1', '1 an (12 derniers mois)'], ['custom', 'Date à date…'], ['month', 'Ce mois'], ['quarter', 'Ce trimestre'], ['year', 'Cette année'], ['lastyear', 'Année dernière']];

/* Périodes d'une section de l'accueil (« À faire », « Factures à encaisser ») : « Toutes périodes » d'abord (rien n'est masqué), puis les mêmes périodes que les chiffres */
export const PERIODS_ALL = [['all', 'Toutes périodes'], ...PERIODS];

const shift = (iso, dd, dm, dy) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + dy); d.setUTCMonth(d.getUTCMonth() + dm); d.setUTCDate(d.getUTCDate() + dd); return d.toISOString().slice(0, 10); };
export function periodRange(key, ref = today(), custom = {}) {
  if (key === 'd30') return { from: shift(ref, -29, 0, 0), to: ref };
  if (key === 'm3') return { from: shift(ref, 1, -3, 0), to: ref };
  if (key === 'y1') return { from: shift(ref, 1, 0, -1), to: ref };
  if (key === 'custom') return { from: custom.from || '1900-01-01', to: custom.to || ref };
  const y = +ref.slice(0, 4), m = +ref.slice(5, 7), p = n => String(n).padStart(2, '0');
  if (key === 'quarter') { const q0 = Math.floor((m - 1) / 3) * 3 + 1; return { from: `${y}-${p(q0)}-01`, to: `${y}-${p(q0 + 2)}-31` }; }
  if (key === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (key === 'lastyear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  return { from: `${y}-${p(m)}-01`, to: `${y}-${p(m)}-31` };
}
export const inR = (d, r) => !!d && d.slice(0, 10) >= r.from && d.slice(0, 10) <= r.to;
export const sign = d => (d.type === 'credit' ? -1 : 1);

/* Valeur d'achat d'une réception de stock (HT, TVA) */
export function purchaseOf(mv, P) {
  const ht = round2(num(mv.qty) * num(mv.unit));
  const rate = mv.tva ?? buyRate(P[mv.productId]); // taux de la facture fournisseur si connu, sinon la TVA d'achat de la fiche produit (20 % par défaut)
  return { ht, tva: round2(ht * num(rate) / 100) };
}

/* Achats affectés directement à un chantier (importés d'une facture fournisseur) : mêmes calculs que les réceptions de stock */
const chargeBuys = (sites, P) => (sites || []).flatMap(st => (st.charges || []).filter(c => c.purchase).map(c => ({ date: c.date, ...purchaseOf({ qty: c.qty, unit: c.cost, tva: c.tva, productId: c.pid }, P) })));

/* TVA collectée de la période, mouvement par mouvement (A6).
   - TVA due à la FACTURE : option « TVA sur les débits » cochée, ou livraison de biens (date de la facture, avoirs en négatif) ;
   - TVA due à l'ENCAISSEMENT : prestations de services, travaux compris, quand l'option n'est pas cochée (date de chaque règlement, remboursements en négatif ;
     les imputations d'avoir ne sont pas de l'argent encaissé : elles sont ignorées).
   Sans réglages (S absent) : TVA à la date des factures, comme avant la maj59. Retourne [{ date, docId, number, type, basis, ht, tva, rates:[{ rate, ht, tva }] }]. */
/* La TVA de ce document est-elle comptée à la date de la facture (sinon : à l'encaissement) ? Un avoir suit le régime de la facture qu'il annule. */
export const vatOnInvoice = (d, D, S) => { const b = (d.type === 'credit' && D[d.fromInvoice]) || d; return !S || vatDebitsOf(b, S) || opOf(b, S) === 'goods'; };
export function vatEvents(range, docs, payments, S) {
  const D = Object.fromEntries(docs.map(d => [d.id, d])), legacy = !S, ev = [];
  const onInv = d => vatOnInvoice(d, D, S);
  for (const d of docs) {
    if ((d.type !== 'invoice' && d.type !== 'credit') || !counts(d) || !inR(d.date, range) || !onInv(d)) continue;
    const t = totals(d), k = sign(d);
    ev.push({ date: d.date, docId: d.id, number: d.number || '', type: d.type, basis: 'facture', ht: round2(k * t.ht), tva: round2(k * t.tva), rates: t.rates.map(x => ({ rate: x.rate, ht: round2(k * x.ht), tva: round2(k * x.tva) })) });
  }
  if (!legacy) {
    for (const p of payments) {
      if (p.method === 'avoir' || p.kind === 'avoir' || !inR(p.date, range)) continue;
      const d = D[p.docId]; if (!d || d.status === 'draft' || onInv(d)) continue;
      const t = totals(d); if (!(t.ttc > 0)) continue;
      const k = (p.kind === 'remboursement' ? -1 : 1) * num(p.amount) / t.ttc;
      ev.push({ date: p.date, docId: d.id, number: d.number || '', type: d.type, basis: 'encaissement', payId: p.id, ht: round2(t.ht * k), tva: round2(t.tva * k), rates: t.rates.map(x => ({ rate: x.rate, ht: round2(x.ht * k), tva: round2(x.tva * k) })) });
    }
  }
  return ev.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

export function summary(range, docs, payments, moves, products, sites = [], S = null) {
  const P = Object.fromEntries(products.map(p => [p.id, p]));
  const sales = docs.filter(d => (d.type === 'invoice' || d.type === 'credit') && d.status !== 'draft' && d.status !== 'cancelled' && inR(d.date, range));
  const ca = round2(sales.reduce((a, d) => a + sign(d) * totals(d).ht, 0));
  const tvaColl = round2(vatEvents(range, docs, payments, S || undefined).reduce((a, v) => a + v.tva, 0));
  const buys = [...moves.filter(m => m.purchase && inR(m.date, range)).map(m => purchaseOf(m, P)), ...chargeBuys(sites, P).filter(b => inR(b.date, range))];
  const achats = round2(buys.reduce((a, b) => a + b.ht, 0)), tvaDed = round2(buys.reduce((a, b) => a + b.tva, 0));
  const cash = round2(payments.filter(p => inR(p.date, range) && p.method !== 'avoir').reduce((a, p) => a + (p.kind === 'remboursement' ? -1 : 1) * num(p.amount), 0));
  return { ca, tvaColl, achats, tvaDed, tvaDue: round2(tvaColl - tvaDed), cash, nbFact: sales.filter(d => d.type === 'invoice').length };
}

/* 12 derniers mois : CA HT net et achats HT */
export function monthly(docs, moves, products, ref = today(), n = 12, sites = []) {
  const P = Object.fromEntries(products.map(p => [p.id, p]));
  const out = []; let y = +ref.slice(0, 4), m = +ref.slice(5, 7);
  for (let i = 0; i < n; i++) { out.unshift({ ym: `${y}-${String(m).padStart(2, '0')}`, ca: 0, achats: 0 }); if (--m === 0) { m = 12; y--; } }
  const at = Object.fromEntries(out.map(o => [o.ym, o]));
  docs.filter(d => (d.type === 'invoice' || d.type === 'credit') && d.status !== 'draft' && d.status !== 'cancelled').forEach(d => { const o = at[(d.date || '').slice(0, 7)]; if (o) o.ca = round2(o.ca + sign(d) * totals(d).ht); });
  moves.filter(m2 => m2.purchase).forEach(m2 => { const o = at[(m2.date || '').slice(0, 7)]; if (o) o.achats = round2(o.achats + purchaseOf(m2, P).ht); });
  chargeBuys(sites, P).forEach(b => { const o = at[(b.date || '').slice(0, 7)]; if (o) o.achats = round2(o.achats + b.ht); });
  return out;
}

/* Rentabilité d'un chantier : facturé (ou marché si rien n'est encore facturé) − matières sorties du stock − main-d'œuvre */
export function siteMargin(siteId, docs, moves, tasks, members, site, times = []) {
  const M = Object.fromEntries(members.map(m => [m.id, m]));
  const mine = docs.filter(d => d.siteId === siteId && d.status !== 'draft' && d.status !== 'cancelled');
  const fact = round2(mine.filter(d => d.type === 'invoice' || d.type === 'credit').reduce((a, d) => a + sign(d) * totals(d).ht, 0));
  const marche = round2(mine.filter(d => d.type === 'quote' && (d.status === 'accepted' || d.status === 'invoiced')).reduce((a, d) => a + totals(d).ht, 0) - mine.filter(d => d.type === 'credit' && d.nature === 'discount').reduce((a, d) => a + totals(d).ht, 0)); // les avoirs de remise font baisser le marché
  const matieres = round2(moves.filter(m => m.siteId === siteId && m.type === 'out').reduce((a, m) => a + num(m.qty) * num(m.unit), 0));
  const charges = round2(((site && site.charges) || []).reduce((a, c) => a + num(c.qty) * num(c.cost), 0));
  const done = doneBySite(siteId, tasks, times); // heures saisies par jour (tous chantiers confondus pour un même salarié) + anciens totaux
  const hours = round2(Object.values(done).reduce((a, h) => a + h, 0));
  const mo = round2(Object.entries(done).reduce((a, [id, h]) => a + h * num(M[id]?.rate), 0));
  const base = fact || marche, couts = round2(matieres + charges + mo), marge = round2(base - couts);
  return { fact, marche, base, previsionnel: !fact && !!marche, matieres, charges, mo, hours, couts, noCosts: couts === 0, partiel: fact > 0 && marche - fact > 0.5, marge, pct: base ? Math.round(marge / base * 100) : null };
}

export const weekDays = (from = today(), n = 7) => Array.from({ length: n }, (_, i) => addDays(from, i));
