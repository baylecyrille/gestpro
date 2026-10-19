// Ouvrages (N8) : une fiche du catalogue de catégorie « Ouvrage » peut avoir une composition
// (produits du catalogue, heures de main-d'œuvre d'un membre, autres coûts). Fonctions pures, sans écran ni base de données.
//   prix de revient = somme des composants (prix d'achat du catalogue, coût horaire du membre)
//   prix de vente   = prix de revient × coefficient (1,30 par défaut)  — ou prix fixé à la main
// Un ouvrage sans composition reste un produit ordinaire (aucun changement pour les fiches existantes).
import { num } from './util.js';
import { r2 } from './vat.js';

export const OUV_CAT = 'Ouvrage';
export const COEF = 1.3;
export const KINDS = [['p', 'Produit du catalogue'], ['l', 'Main d\'œuvre'], ['f', 'Autre coût']];
const CATS_BASE = ['Produit (fourniture)', 'Matériel', 'Main d\'œuvre', 'Sous-traitance'];
const r4 = v => Math.round((v + Number.EPSILON) * 10000) / 10000;
const get = (m, id) => (!m || !id ? undefined : m instanceof Map ? m.get(id) : m[id]);

export const isOuvrage = p => !!p && p.category === OUV_CAT;
/* Ouvrage composé : seul cas où le prix est calculé et où l'insertion propose « une ligne / détaillée » */
export const hasCompo = p => isOuvrage(p) && Array.isArray(p.compo) && p.compo.length > 0;
/* Coefficient du prix de vente : celui de l'ouvrage, sinon celui des Réglages, sinon 1,30 */
export const coefOf = (p, S) => (num(p && p.coef) > 0 ? num(p.coef) : num(S && S.ouvCoef) > 0 ? num(S.ouvCoef) : COEF);

/* Composants avec leur coût actuel. ctx = { products: Map|objet id → produit, members: Map|objet id → membre }.
   Le prix d'un produit et le coût horaire d'un membre sont relus à chaque calcul ; si le produit ou le membre n'existe plus, le dernier prix connu (c.uc) est gardé. */
export function compoLines(p, ctx = {}) {
  return (p.compo || []).map(c => {
    const qty = num(c.qty); let uc = num(c.uc), name = c.name || '', unit = c.unit || 'u', warn = '', cat = CATS_BASE[0], ref = '';
    if (c.k === 'p') {
      const q = get(ctx.products, c.pid);
      if (q) { uc = num(q.buy); name = q.name; unit = q.unit || unit; ref = q.ref || ''; if (CATS_BASE.includes(q.category)) cat = q.category; if (!(uc > 0)) warn = 'Prix d\'achat non renseigné sur la fiche du produit'; }
      else warn = 'Produit supprimé du catalogue : dernier prix connu';
    } else if (c.k === 'l') {
      cat = CATS_BASE[2]; unit = 'h'; name = c.name || 'Main d\'œuvre';
      if (c.mid) {
        const m = get(ctx.members, c.mid);
        if (m) { uc = num(m.rate); if (!(uc > 0)) warn = 'Coût horaire du membre non renseigné (fiche Équipe)'; }
        else warn = 'Membre supprimé : dernier coût horaire connu';
      } else uc = num(c.rate);
    } else { cat = CATS_BASE[3]; uc = num(c.cost); name = c.name || 'Autre coût'; }
    return { c, k: c.k, name, qty, unit, uc, cost: r2(qty * uc), cat, ref, warn };
  });
}

/* Prix d'un ouvrage : { lines, cost, coef, fixed, sell, margin, pct (marge / prix de vente), markup (prix de vente / revient), warns } */
export function priceOf(p, ctx = {}, S = {}) {
  const lines = compoLines(p, ctx), cost = r2(lines.reduce((a, x) => a + x.cost, 0)), coef = coefOf(p, S), fixed = p.priceMode === 'fixed';
  const sell = fixed ? r2(num(p.sell)) : r2(cost * coef), margin = r2(sell - cost);
  return { lines, cost, coef, fixed, sell, margin, pct: sell ? margin / sell * 100 : 0, markup: cost ? sell / cost : 0, warns: lines.filter(x => x.warn).length };
}

/* Instantané des coûts à enregistrer sur la fiche : composition épurée (dernier prix connu) + prix d'achat et de vente calculés */
export function snapshot(p, ctx = {}, S = {}) {
  const P = priceOf(p, ctx, S);
  const compo = (p.compo || []).map((c, i) => ({ ...c, uc: r4(P.lines[i].uc) }));
  return { compo, buy: P.cost, sell: P.sell };
}

/* Prix d'un composant → prix unitaire arrondi pour que quantité × prix donne exactement le montant voulu */
const puFor = (target, qty) => {
  if (!(qty > 0)) return 0;
  for (const dp of [2, 3, 4, 5, 6]) { const f = 10 ** dp, pu = Math.round(target / qty * f) / f; if (r2(qty * pu) === target) return pu; }
  return target / qty;
};

/* Ligne unique : l'ouvrage reste une seule ligne du document (la composition reste interne) */
export function asLine(p, qty, ctx = {}, S = {}, sell) {
  const P = priceOf(p, ctx, S);
  return { pid: p.id, cat: OUV_CAT, desig: p.name, qty: num(qty) || 1, unit: p.unit || 'u', pu: sell != null ? num(sell) : P.sell, pa: P.cost, ...(String(p.ref ?? '').trim() ? { ref: p.ref } : {}) };
}

/* Ouvrage détaillé : une section et une ligne par composant (quantités × quantité d'ouvrage).
   Le prix de vente de l'ouvrage est réparti au prorata du coût de chaque composant ; le total des lignes est exactement quantité × prix de vente.
   `sell` impose un prix de vente unitaire (détailler une ligne dont le prix a été modifié à la main).
   Retourne null si le prix de revient est nul (rien à répartir). */
export function asDetail(p, qty, ctx = {}, S = {}, sell) {
  const P = priceOf(p, ctx, S), q = num(qty) || 1, items = P.lines.filter(x => x.qty > 0);
  if (!(P.cost > 0) || !items.length) return null;
  const total = r2(q * (sell != null ? num(sell) : P.sell)), carrying = items.filter(x => x.cost > 0), last = carrying[carrying.length - 1];
  let rest = total;
  const target = new Map();
  for (const x of carrying) { if (x === last) continue; const t = r2(total * x.cost / P.cost); target.set(x, t); rest = r2(rest - t); }
  target.set(last, rest);
  const lines = items.map(x => {
    const lq = r4(x.qty * q), t = target.get(x) ?? 0;
    return { cat: x.cat, desig: x.name, qty: lq, unit: x.unit, pu: puFor(t, lq), pa: r4(x.uc), ...(x.ref ? { ref: x.ref } : {}) };
  });
  const fq = String(q).replace('.', ',');
  return { title: q === 1 ? p.name : `${p.name} (× ${fq})`, lines, total };
}
