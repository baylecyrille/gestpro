// TVA : calcul des totaux d'un document, avec un taux par ligne (ou le taux par défaut du document).
// Fonctions pures, sans accès au navigateur : partagées par l'éditeur, l'impression, les exports et la facture électronique.
const num = v => parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
export const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;

export const RATES = [['0', '0 %'], ['5.5', '5,5 %'], ['10', '10 %'], ['20', '20 %']];
export const hasOwnRate = l => !!l && l.tva !== undefined && l.tva !== null && l.tva !== '';
/* Taux d'une ligne : le sien, sinon celui du document */
export const rateOf = (l, def) => (hasOwnRate(l) ? num(l.tva) : num(def));
export const lineHt = l => r2(num(l?.qty) * num(l?.pu));
export const fmtRate = r => String(r).replace('.', ',') + ' %';
/* Taux réduits ouvrant droit à la mention du client (travaux dans un logement) */
export const isReduced = r => r === 5.5 || r === 10;

/* Ventilation par taux (taux décroissant) : [{ rate, ht, tva }] — la TVA est calculée sur la base de chaque taux (EN 16931). */
export function byRate(lines, def, keepZero = false) {
  const m = new Map();
  for (const l of lines || []) { const r = rateOf(l, def); m.set(r, r2((m.get(r) || 0) + lineHt(l))); }
  if (!m.size) m.set(num(def), 0);
  let out = [...m].sort((a, b) => b[0] - a[0]).map(([rate, ht]) => ({ rate, ht, tva: r2(ht * rate / 100) }));
  if (!keepZero && out.length > 1) { const nz = out.filter(x => x.ht !== 0); out = nz.length ? nz : out.slice(0, 1); } // taux sans montant : masqué
  return out;
}
export function sums(lines, def) {
  const rates = byRate(lines, def);
  const ht = r2(rates.reduce((a, x) => a + x.ht, 0)), tva = r2(rates.reduce((a, x) => a + x.tva, 0));
  return { ht, tva, ttc: r2(ht + tva), rates };
}
/* Le document comporte-t-il au moins deux taux ? */
export const multiRate = (lines, def) => byRate(lines, def).length > 1;
/* Taux réduits présents (pour la mention du client) */
export const reducedRates = (lines, def) => byRate(lines, def).filter(x => isReduced(x.rate) && x.ht !== 0).map(x => x.rate).sort((a, b) => a - b);
export const listRates = rates => rates.map(fmtRate).join(' et ');
