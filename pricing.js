// Prix d'achat moyen pondéré (A8) : chaque réception recalcule le prix d'achat de la fiche produit. Fonctions pures.
import { num } from './util.js';

const r4 = v => Math.round((v + Number.EPSILON) * 10000) / 10000;
/* Seuil à partir duquel une hausse de prix est signalée (en %) */
export const HIKE_PCT = 5;

/* Nouveau prix d'achat après une réception : moyenne pondérée du stock en place (valorisé au prix de la fiche) et de la quantité reçue.
   Sans stock positif, sans prix de fiche ou sans prix de réception : le prix reçu devient le prix de la fiche (réception à 0 € ou sans prix : la fiche est conservée). */
export function avgBuy(stockQty, oldBuy, qty, price) {
  const s = num(stockQty), o = num(oldBuy), q = num(qty), p = num(price);
  if (!(q > 0) || !(p > 0)) return o;
  if (!(s > 0) || !(o > 0)) return r4(p);
  return r4((s * o + q * p) / (s + q));
}

/* Écart (en %) entre le prix reçu et le prix d'achat actuel de la fiche ; 0 si l'un des deux manque */
export function deltaPct(oldBuy, price) {
  const o = num(oldBuy), p = num(price);
  return o > 0 && p > 0 ? Math.round((p - o) / o * 1000) / 10 : 0;
}
/* Hausse (ou baisse) à signaler : écart d'au moins `seuil` % */
export const isHike = (oldBuy, price, seuil = HIKE_PCT) => deltaPct(oldBuy, price) >= seuil;
export const isDrop = (oldBuy, price, seuil = HIKE_PCT) => deltaPct(oldBuy, price) <= -seuil;
export const fmtDelta = d => `${d > 0 ? '+' : ''}${String(d).replace('.', ',')} %`;
