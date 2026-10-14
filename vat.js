// Montants d'un document : remise par ligne, lignes en option, remise sur le total, TVA par ligne (ou taux par défaut du document),
// acomptes déjà facturés (facture finale) et répartition d'un acompte par taux de TVA.
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
/* Répartit un montant entre des bases au prorata ; le reste d'arrondi va sur la base la plus importante (la somme est exacte au centime). */
export function allocate(total, bases) {
  const sum = r2(bases.reduce((a, b) => a + b, 0));
  const out = bases.map(b => (sum ? r2(total * b / sum) : 0));
  if (total && out.length) {
    const diff = r2(total - out.reduce((a, v) => a + v, 0));
    let k = 0; bases.forEach((b, i) => { if (Math.abs(b) > Math.abs(bases[k])) k = i; });
    out[k] = r2(out[k] + diff);
  }
  return out;
}

/* Acomptes déjà facturés : doc.deps = [{ id, number, date, rates: [{ rate, ht }] }] (montants HT positifs, un par taux de TVA) */
export const depsOf = doc => (Array.isArray(doc && doc.deps) ? doc.deps : []);
export const depTva = x => r2(num(x.ht) * num(x.rate) / 100);

/* Totaux : la remise sur le total est répartie au prorata de chaque taux de TVA (l'arrondi va sur le taux le plus chargé).
   Sur une facture finale, les acomptes déjà facturés (deps) sont déduits taux par taux : ht / tva / ttc = ce que CETTE facture réclame,
   ht0 / tva0 = total de l'opération avant acomptes, dep / tvaDep = acomptes déduits.
   rates[i] = { rate, gross (avant remise), disc (part de remise), ht0, tva0, dep, tvaDep, ht (base de TVA nette), tva (TVA nette) } */
export function sums(lines, def, disc, keepZero = false, deps = null) {
  const gm = new Map(), dm = new Map();
  for (const l of lines || []) { if (isOpt(l)) continue; const r = rateOf(l, def); gm.set(r, r2((gm.get(r) || 0) + lineHt(l))); }
  for (const d of deps || []) for (const x of d.rates || []) {
    const r = num(x.rate), h = r2(num(x.ht)), o = dm.get(r) || { ht: 0, tva: 0 };
    o.ht = r2(o.ht + h); o.tva = r2(o.tva + r2(h * r / 100)); dm.set(r, o); if (!gm.has(r)) gm.set(r, 0);
  }
  if (!gm.size) gm.set(num(def), 0);
  let g = [...gm].sort((a, b) => b[0] - a[0]).map(([rate, ht]) => ({ rate, ht }));
  if (!keepZero && g.length > 1) { const nz = g.filter(x => x.ht !== 0 || (dm.get(x.rate) || {}).ht); g = nz.length ? nz : g.slice(0, 1); }
  const gross = r2(g.reduce((a, x) => a + x.ht, 0));
  const D = discAmount(gross, disc);
  const alloc = allocate(D, g.map(x => x.ht));
  const rates = g.map((x, i) => {
    const ht0 = r2(x.ht - alloc[i]), tva0 = r2(ht0 * x.rate / 100), d = dm.get(x.rate) || { ht: 0, tva: 0 };
    return { rate: x.rate, gross: x.ht, disc: alloc[i], ht0, tva0, dep: d.ht, tvaDep: d.tva, ht: r2(ht0 - d.ht), tva: r2(tva0 - d.tva) };
  });
  const S = f => r2(rates.reduce((a, x) => a + x[f], 0));
  const ht = S('ht'), tva = S('tva');
  const full = { ht: S('ht0'), tva: S('tva0') }; full.ttc = r2(full.ht + full.tva);
  const depo = { ht: S('dep'), tva: S('tvaDep') }; depo.ttc = r2(depo.ht + depo.tva);
  const opt = r2((lines || []).filter(isOpt).reduce((a, l) => a + lineHt(l), 0));
  return { ht, tva, ttc: r2(ht + tva), rates, gross, disc: D, opt, full, depo, hasDep: depo.ttc !== 0 || depo.ht !== 0 };
}
/* Totaux d'un document (lignes, remise, acomptes déduits) */
export const docSums = (doc, keepZero = false) => sums((doc && doc.lines) || [], doc && doc.tva, doc && doc.disc, keepZero, depsOf(doc));

/* Répartition d'un acompte entre les taux de TVA du devis.
   mode « % » : pourcentage du devis (chaque taux en reçoit la même part) · « ht » : montant HT total · « ttc » : montant TTC total (au centime près).
   Retourne { rates: [{ rate, ht, tva }], ht, tva, ttc, base (TTC du devis), pct (part du devis, en %) } */
export function depositSplit(lines, def, disc, mode, value) {
  const s = sums(lines, def, disc), v = num(value);
  const bases = s.rates.map(x => x.ht), rates = s.rates.map(x => x.rate);
  const ttcOf = hs => r2(hs.reduce((a, h, i) => a + h + r2(h * rates[i] / 100), 0));
  let hs = bases.map(() => 0);
  if (v > 0 && s.ttc > 0) {
    if (mode === 'ht') hs = allocate(Math.min(v, s.ht), bases);
    else if (mode === 'ttc') {
      const target = r2(Math.min(v, s.ttc));
      hs = bases.map(b => r2(b * target / s.ttc));
      let k = 0; bases.forEach((b, i) => { if (b > bases[k]) k = i; });
      const first = r2(hs[k] + (target - ttcOf(hs)) / (1 + rates[k] / 100));
      let best = first, bd = Infinity;
      for (const dlt of [0, -0.01, 0.01, -0.02, 0.02]) { const c = r2(first + dlt), t = hs.slice(); t[k] = c; const d = Math.abs(ttcOf(t) - target); if (d < bd - 1e-9) { bd = d; best = c; } }
      hs[k] = Math.max(0, Math.min(best, bases[k]));
    } else hs = bases.map(b => r2(b * Math.min(v, 100) / 100));
  }
  const out = rates.map((rate, i) => ({ rate, ht: hs[i], tva: r2(hs[i] * rate / 100) })).filter(x => x.ht !== 0);
  const ht = r2(out.reduce((a, x) => a + x.ht, 0)), tva = r2(out.reduce((a, x) => a + x.tva, 0)), ttc = r2(ht + tva);
  return { rates: out, ht, tva, ttc, base: s.ttc, pct: s.ttc > 0 ? Math.round(ttc / s.ttc * 10000) / 100 : 0 };
}
/* Le document comporte-t-il au moins deux taux ? */
export const multiRate = (lines, def) => byRate(lines, def).length > 1;
/* Taux réduits présents (pour la mention du client) */
export const reducedRates = (lines, def) => byRate(lines, def).filter(x => isReduced(x.rate) && x.ht !== 0).map(x => x.rate).sort((a, b) => a - b);
export const listRates = rates => rates.map(fmtRate).join(' et ');
