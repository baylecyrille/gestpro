// Avoir partiel (B4) : quelles lignes et quelles quantités peut-on encore créditer sur une facture, montant libre réparti selon les taux de TVA,
// reste créditable, et montant d'un acompte net des avoirs. Calculs purs (pas d'accès aux données ni à l'écran) : testables hors navigateur.
import { docSums, sums, lineHt, isOpt, r2, allocate } from './vat.js';

const num = v => parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
const q6 = v => Math.round(v * 1e6) / 1e6; // quantités : on évite les 0,1 + 0,2 = 0,30000000000000004

/* Avoirs émis (hors brouillons) d'une facture */
export const creditsOf = (docs, invId) => (docs || []).filter(c => c.type === 'credit' && c.fromInvoice === invId && c.status !== 'draft');
export const creditedTtc = (docs, invId) => r2(creditsOf(docs, invId).reduce((a, c) => a + docSums(c).ttc, 0));
/* TTC encore créditable : ce que la facture réclame, moins les avoirs déjà émis */
export const remainingTtc = (inv, docs) => Math.max(0, r2(docSums(inv).ttc - creditedTtc(docs, inv.id)));

/* Lignes de la facture et quantités déjà créditées (un avoir « par lignes » garde le rang de la ligne d'origine dans `src`).
   [{ idx, line, qty, credited, left }] — lignes en option, vides ou de quantité nulle exclues. */
export function lineCapacity(inv, docs) {
  const used = new Map();
  for (const c of creditsOf(docs, inv.id)) for (const l of c.lines || []) { if (l.src !== undefined && l.src !== null && l.src !== '') used.set(+l.src, q6((used.get(+l.src) || 0) + num(l.qty))); }
  return (inv.lines || []).map((line, idx) => ({ idx, line, qty: num(line.qty), credited: used.get(idx) || 0, left: Math.max(0, q6(num(line.qty) - (used.get(idx) || 0))) }))
    .filter(x => !isOpt(x.line) && x.qty > 0 && (x.line.desig || num(x.line.pu)));
}

const clone = o => JSON.parse(JSON.stringify(o));

/* Avoir sur des lignes : picks = [{ idx, qty }] → { lines, disc, ht, ttc } ou { error }.
   Les lignes gardent leur prix, leur taux de TVA et leur remise ; la remise sur le total est reprise au même taux (en euros : au prorata des lignes créditées). */
export function linesCredit(inv, picks, docs) {
  const cap = lineCapacity(inv, docs), lines = [];
  for (const p of picks || []) {
    const q = q6(num(p.qty));
    if (!(q > 0)) continue;
    const c = cap.find(x => x.idx === p.idx);
    if (!c) return { error: 'Une des lignes choisies ne peut pas être créditée.' };
    if (q > c.left + 1e-9) return { error: `« ${c.line.desig || 'Ligne'} » : au plus ${String(c.left).replace('.', ',')} ${c.line.unit || ''} peuvent encore être crédités.` };
    const { id, ...rest } = clone(c.line); // eslint-disable-line no-unused-vars
    lines.push({ ...rest, type: 'line', qty: q, src: p.idx });
  }
  if (!lines.length) return { error: 'Choisissez au moins une ligne et une quantité.' };
  let disc;
  if (inv.disc && num(inv.disc.v) > 0) {
    if (inv.disc.t === '€') {
      const all = (inv.lines || []).filter(l => !isOpt(l)).reduce((a, l) => a + lineHt(l), 0), mine = lines.reduce((a, l) => a + lineHt(l), 0);
      const v = all > 0 ? r2(num(inv.disc.v) * mine / all) : 0;
      if (v > 0) disc = { ...inv.disc, v };
    } else disc = { ...inv.disc };
  }
  const t = sums(lines, inv.tva, disc);
  if (t.ttc > remainingTtc(inv, docs) + 0.005) return { error: `Cet avoir (${fmt(t.ttc)} TTC) dépasse ce qu'il reste à créditer sur la facture (${fmt(remainingTtc(inv, docs))} TTC).` };
  return { lines, disc, ht: t.ht, ttc: t.ttc };
}

/* HT qui donne exactement ce TTC au taux donné (arrondi de la TVA compris) */
export function htFromTtc(ttc, rate) {
  const want = r2(ttc), h0 = r2(want / (1 + num(rate) / 100));
  for (const d of [0, 0.01, -0.01, 0.02, -0.02]) { const h = r2(h0 + d); if (r2(h + r2(h * num(rate) / 100)) === want) return h; }
  return h0;
}

/* Répartit un TTC entre des taux de TVA, au centime près : la TVA de chaque taux est arrondie, il faut donc parfois décaler un HT d'un ou deux centimes
   pour que le total TTC tombe exactement sur le montant demandé. */
function fitTtc(a, rates) {
  const parts = allocate(a, rates.map(x => x.base * (1 + x.rate / 100))).map((v, i) => htFromTtc(v, rates[i].rate));
  const ttcOf = hts => r2(hts.reduce((s, h, i) => s + h + r2(h * rates[i].rate / 100), 0));
  if (ttcOf(parts) === a) return parts;
  let best = null, bestCost = Infinity;
  const walk = (i, cur, cost) => {
    if (cost >= bestCost) return;
    if (i === parts.length) { if (ttcOf(cur) === a) { best = cur.slice(); bestCost = cost; } return; }
    for (const d of [0, 0.01, -0.01, 0.02, -0.02, 0.03, -0.03]) { const h = r2(parts[i] + d); if (h < 0) continue; cur[i] = h; walk(i + 1, cur, cost + Math.abs(d)); }
  };
  walk(0, [], 0);
  return best || parts;
}

/* Avoir d'un montant libre (remise, geste commercial) : réparti entre les taux de TVA de la facture au prorata de leur poids.
   basis : 'ht' | 'ttc' · → { lines, ht, ttc } ou { error } */
export function amountCredit(inv, amount, basis, docs, label = 'Remise / geste commercial') {
  const a = r2(num(amount));
  if (!(a > 0)) return { error: 'Indiquez le montant de l\'avoir.' };
  const t = docSums(inv);
  let rates = t.rates.map(x => ({ rate: x.rate, base: Math.max(0, x.ht0 > 0 ? x.ht0 : x.ht) })).filter(x => x.base > 0);
  if (!rates.length) rates = [{ rate: num(inv.tva), base: 1 }];
  const parts = basis === 'ttc' ? fitTtc(a, rates) : allocate(a, rates.map(x => x.base));
  const lines = rates.map((x, i) => ({ desig: label, qty: 1, unit: 'u', pu: parts[i], tva: x.rate })).filter(l => l.pu !== 0);
  const s = sums(lines, inv.tva, null);
  if (s.ttc > remainingTtc(inv, docs) + 0.005) return { error: `Cet avoir (${fmt(s.ttc)} TTC) dépasse ce qu'il reste à créditer sur la facture (${fmt(remainingTtc(inv, docs))} TTC).` };
  return { lines, ht: s.ht, ttc: s.ttc };
}

/* Acompte net des avoirs : montants HT par taux de TVA, à déduire de la facture finale */
export function netRates(inv, docs) {
  const m = new Map();
  docSums(inv).rates.forEach(x => m.set(x.rate, x.ht));
  creditsOf(docs, inv.id).forEach(c => docSums(c).rates.forEach(x => m.set(x.rate, r2((m.get(x.rate) || 0) - x.ht))));
  return [...m].filter(([, ht]) => ht !== 0).map(([rate, ht]) => ({ rate, ht }));
}

const fmt = v => `${(Math.round(v * 100) / 100).toFixed(2).replace('.', ',')} €`;
