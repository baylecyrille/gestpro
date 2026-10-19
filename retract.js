// Contrat signé hors de l'atelier avec un particulier (M5) : délai de rétractation (14 jours) et délai avant tout paiement (7 jours).
// Affichage d'aide : l'application calcule les dates à partir de la date de signature saisie sur le devis, elle ne remplace pas un conseil juridique.
// Fonctions pures (testables hors navigateur).
import { today } from './util.js';

export const RETRACT_DAYS = 14, PAY_DAYS = 7;
/* Où le devis a été signé (champ `signWhere` du devis) */
export const WHERE = [['', 'Non renseigné'], ['shop', 'Dans nos locaux (atelier, magasin)'], ['off', 'Chez le client, sur le chantier ou hors de nos locaux'], ['remote', 'À distance (e-mail, téléphone, internet)']];

const iso = d => d.toISOString().slice(0, 10);
const add = (s, n) => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dow = s => new Date(String(s).slice(0, 10) + 'T12:00:00Z').getUTCDay();

/* Jours fériés français d'une année (fixes + Pâques, Ascension, Pentecôte) */
export function joursFeries(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  return new Set([`${y}-01-01`, add(easter, 1), `${y}-05-01`, `${y}-05-08`, add(easter, 39), add(easter, 50), `${y}-07-14`, `${y}-08-15`, `${y}-11-01`, `${y}-11-11`, `${y}-12-25`]);
}
/* Un délai qui expire un samedi, un dimanche ou un jour férié est prorogé jusqu'au premier jour ouvrable suivant */
export function nextWorkday(s) {
  let x = String(s).slice(0, 10);
  for (let n = 0; n < 10; n++) { if (dow(x) !== 0 && dow(x) !== 6 && !joursFeries(+x.slice(0, 4)).has(x)) return x; x = add(x, 1); }
  return x;
}

/* Un client est présumé particulier s'il n'a ni SIRET ni forme juridique de société dans sa fiche */
export function isConsumer(client) {
  if (!client) return true;
  if (String(client.siret || '').replace(/\D/g, '').length >= 9) return false;
  return !/^\s*(sarl|sas|sasu|eurl|sci|sa|snc|scop|scp|selarl|ste|soci[eé]t[eé]|ets|[eé]tablissements?|entreprise|association|mairie|commune|syndic|copropri[eé]t[eé])\b/i.test(String(client.civ || '') + ' ' + String(client.name || ''));
}

/* Situation d'un devis au regard de la vente hors établissement.
   Retourne null quand les règles ne s'appliquent pas (client professionnel, signature dans nos locaux, travaux urgents demandés par le client, signature non renseignée) ;
   sinon { kind: 'off'|'remote', unknown, signed, retractUntil, retractOpen, daysLeft, payFrom, payLocked } — `unknown` = lieu hors locaux sans date de signature. */
export function retractInfo(q, client, ref = today()) {
  if (!q || q.type !== 'quote') return null;
  const where = q.signWhere || '';
  if (where !== 'off' && where !== 'remote') return null;
  if (!isConsumer(client) || q.urgent === '1' || q.urgent === true) return null;
  const signed = String(q.signDate || '').slice(0, 10);
  if (!signed) return { kind: where, unknown: true, signed: '' };
  const retractUntil = nextWorkday(add(signed, RETRACT_DAYS)), payFrom = where === 'off' ? add(signed, PAY_DAYS + 1) : ''; // le jour de la signature ne compte pas : le délai de 7 jours expire à la fin du 7e jour
  const daysLeft = Math.round((Date.parse(retractUntil) - Date.parse(ref)) / 864e5);
  return { kind: where, unknown: false, signed, retractUntil, retractOpen: daysLeft >= 0, daysLeft, payFrom, payLocked: !!payFrom && ref < payFrom };
}
/* Un paiement daté de `date` est-il reçu trop tôt (avant la fin du délai de 7 jours d'un contrat hors établissement) ? */
export const earlyPayment = (info, date) => !!(info && !info.unknown && info.payFrom && String(date || '').slice(0, 10) < info.payFrom);
