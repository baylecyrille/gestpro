// Montants d'un document : remise par ligne, lignes en option, remise sur le total, TVA par ligne (ou taux par défaut du document).
// Fonctions pures, sans accès au navigateur : partagées par l'éditeur, l'impression, les exports et la facture électronique.
const num = v => parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
export const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;

export const RATES = [['0', '0 %'], ['5.5', '5,5 %'], ['10', '10 %'], ['20', '20 %']];
export const hasOwnRate = l => !!l && l.tva !== undefined && l.tva !== null && l.tva !== '';
/* Taux d'une ligne : le sien, sinon celui du document */
export const rateOf = (l, def) => (hasOwnRate(l) ? num(l.tva) : num(def));
/* Ligne « en option » : affichée sur le devis mais non comptée dans les totaux */
export const isOpt = l => !!l && (l.opt === true || l.opt === 1 || l.opt === '1');
/* Remise de ligne en % (0 à 100) */
export const remOf = l => { const r = num(l?.rem); return r > 0 ? Math.min(r, 100) : 0; };
export const grossHt = l => r2(num(l?.qty) * num(l?.pu));        // avant remise de ligne
export const lineDisc = l => r2(grossHt(l) * remOf(l) / 100);     // montant de la remise de ligne
export const lineHt = l => r2(grossHt(l) - lineDisc(l));          // total HT de la ligne
export const fmtRate = r => String(r).replace('.', ',') + ' %';
/* Taux réduits ouvrant droit à la mention du client (travaux dans un logement) */
export const isReduced = r => r === 5.5 || r === 10;

/* Ventilation par taux (taux décroissant) : [{ rate, ht, tva }] — lignes comptées uniquement, après remises de ligne.
   Un taux sans montant est masqué (sauf keepZero). */
export function byRate(lines, def, keepZero = false) {
  const m = new Map();
  for (const l of lines || []) { if (isOpt(l)) continue; const r = rateOf(l, def); m.set(r, r2((m.get(r) || 0) + lineHt(l))); }
  if (!m.size) m.set(num(def), 0);
  let out = [...m].sort((a, b) => b[0] - a[0]).map(([rate, ht]) => ({ rate, ht, tva: r2(ht * rate / 100) }));
  if (!keepZero && out.length > 1) { const nz = out.filter(x => x.ht !== 0); out = nz.length ? nz : out.slice(0, 1); }
  return out;
}

/* Remise sur le total : { t: '%' | '€', v } → montant HT (jamais plus que le total) */
export function discAmount(gross, disc) {
  const v = num(disc?.v);
  if (!(v > 0) || !(gross > 0)) return 0;
  return disc.t === '€' ? r2(Math.min(v, gross)) : r2(gross * Math.min(v, 100) / 100);
}
/* Totaux : la remise sur le total est répartie au prorata de chaque taux de TVA (l'arrondi va sur le taux le plus chargé).
   rates[i] = { rate, gross (avant remise), disc (part de remise), ht (base de TVA), tva } */
export function sums(lines, def, disc, keepZero = false) {
  const g = byRate(lines, def, keepZero);
  const gross = r2(g.reduce((a, x) => a + x.ht, 0));
  const D = discAmount(gross, disc);
  const alloc = g.map(x => (gross ? r2(D * x.ht / gross) : 0));
  if (D && g.length) {
    const diff = r2(D - alloc.reduce((a, v) => a + v, 0));
    let k = 0; g.forEach((x, i) => { if (Math.abs(x.ht) > Math.abs(g[k].ht)) k = i; });
    alloc[k] = r2(alloc[k] + diff);
  }
  const rates = g.map((x, i) => { const ht = r2(x.ht - alloc[i]); return { rate: x.rate, gross: x.ht, disc: alloc[i], ht, tva: r2(ht * x.rate / 100) }; });
  const ht = r2(rates.reduce((a, x) => a + x.ht, 0)), tva = r2(rates.reduce((a, x) => a + x.tva, 0));
  const opt = r2((lines || []).filter(isOpt).reduce((a, l) => a + lineHt(l), 0));
  return { ht, tva, ttc: r2(ht + tva), rates, gross, disc: D, opt };
}
/* Le document comporte-t-il au moins deux taux ? */
export const multiRate = (lines, def) => byRate(lines, def).length > 1;
/* Taux réduits présents (pour la mention du client) */
export const reducedRates = (lines, def) => byRate(lines, def).filter(x => isReduced(x.rate) && x.ht !== 0).map(x => x.rate).sort((a, b) => a - b);
export const listRates = rates => rates.map(fmtRate).join(' et ');
