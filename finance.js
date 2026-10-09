// Calculs financiers : période, CA, achats, TVA, courbe mensuelle, rentabilité d'un chantier.
import { num, round2, today } from './util.js';
import { totals } from './docs.js';
import { addDays } from './team.js';

export const PERIODS = [['month', 'Ce mois'], ['quarter', 'Ce trimestre'], ['year', 'Cette année'], ['lastyear', 'Année dernière']];

export function periodRange(key, ref = today()) {
  const y = +ref.slice(0, 4), m = +ref.slice(5, 7), p = n => String(n).padStart(2, '0');
  if (key === 'quarter') { const q0 = Math.floor((m - 1) / 3) * 3 + 1; return { from: `${y}-${p(q0)}-01`, to: `${y}-${p(q0 + 2)}-31` }; }
  if (key === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (key === 'lastyear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  return { from: `${y}-${p(m)}-01`, to: `${y}-${p(m)}-31` };
}
const inR = (d, r) => !!d && d.slice(0, 10) >= r.from && d.slice(0, 10) <= r.to;
const sign = d => (d.type === 'credit' ? -1 : 1);

/* Valeur d'achat d'une réception de stock (HT, TVA) */
export function purchaseOf(mv, P) {
  const ht = round2(num(mv.qty) * num(mv.unit));
  const rate = P[mv.productId]?.tva ?? 20;
  return { ht, tva: round2(ht * num(rate) / 100) };
}

export function summary(range, docs, payments, moves, products) {
  const P = Object.fromEntries(products.map(p => [p.id, p]));
  const sales = docs.filter(d => (d.type === 'invoice' || d.type === 'credit') && d.status !== 'draft' && inR(d.date, range));
  const ca = round2(sales.reduce((a, d) => a + sign(d) * totals(d).ht, 0));
  const tvaColl = round2(sales.reduce((a, d) => a + sign(d) * totals(d).tva, 0));
  const buys = moves.filter(m => m.purchase && inR(m.date, range)).map(m => purchaseOf(m, P));
  const achats = round2(buys.reduce((a, b) => a + b.ht, 0)), tvaDed = round2(buys.reduce((a, b) => a + b.tva, 0));
  const cash = round2(payments.filter(p => inR(p.date, range) && p.method !== 'avoir').reduce((a, p) => a + (p.kind === 'remboursement' ? -1 : 1) * num(p.amount), 0));
  return { ca, tvaColl, achats, tvaDed, tvaDue: round2(tvaColl - tvaDed), cash, nbFact: sales.filter(d => d.type === 'invoice').length };
}

/* 12 derniers mois : CA HT net et achats HT */
export function monthly(docs, moves, products, ref = today(), n = 12) {
  const P = Object.fromEntries(products.map(p => [p.id, p]));
  const out = []; let y = +ref.slice(0, 4), m = +ref.slice(5, 7);
  for (let i = 0; i < n; i++) { out.unshift({ ym: `${y}-${String(m).padStart(2, '0')}`, ca: 0, achats: 0 }); if (--m === 0) { m = 12; y--; } }
  const at = Object.fromEntries(out.map(o => [o.ym, o]));
  docs.filter(d => (d.type === 'invoice' || d.type === 'credit') && d.status !== 'draft').forEach(d => { const o = at[(d.date || '').slice(0, 7)]; if (o) o.ca = round2(o.ca + sign(d) * totals(d).ht); });
  moves.filter(m2 => m2.purchase).forEach(m2 => { const o = at[(m2.date || '').slice(0, 7)]; if (o) o.achats = round2(o.achats + purchaseOf(m2, P).ht); });
  return out;
}

/* Rentabilité d'un chantier : facturé (ou marché si rien n'est encore facturé) − matières sorties du stock − main-d'œuvre */
export function siteMargin(siteId, docs, moves, tasks, members) {
  const M = Object.fromEntries(members.map(m => [m.id, m]));
  const mine = docs.filter(d => d.siteId === siteId && d.status !== 'draft');
  const fact = round2(mine.filter(d => d.type === 'invoice' || d.type === 'credit').reduce((a, d) => a + sign(d) * totals(d).ht, 0));
  const marche = round2(mine.filter(d => d.type === 'quote' && (d.status === 'accepted' || d.status === 'invoiced')).reduce((a, d) => a + totals(d).ht, 0));
  const matieres = round2(moves.filter(m => m.siteId === siteId && m.type === 'out').reduce((a, m) => a + num(m.qty) * num(m.unit), 0));
  const hours = round2(tasks.filter(t => t.siteId === siteId).reduce((a, t) => a + num(t.done), 0));
  const mo = round2(tasks.filter(t => t.siteId === siteId).reduce((a, t) => a + num(t.done) * num(M[t.memberId]?.rate), 0));
  const base = fact || marche, couts = round2(matieres + mo), marge = round2(base - couts);
  return { fact, marche, base, previsionnel: !fact && !!marche, matieres, mo, hours, couts, marge, pct: base ? Math.round(marge / base * 100) : null };
}

export const weekDays = (from = today(), n = 7) => Array.from({ length: n }, (_, i) => addDays(from, i));
