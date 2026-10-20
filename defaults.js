import * as db from './db.js';
import { applyLists } from './lists.js';
import { applyLimits } from './limits.js';

// Valeurs par défaut des réglages (modifiables dans l'appli, stockées sur l'appareil).
// Identité reprise des exemples de factures ; IBAN/BIC volontairement vides (à saisir dans Réglages).
export const DEFAULTS = {
  company: 'SARL MARCHE BOIS',
  sub: 'MENUISERIE – AGENCEMENT\nSTRUCTURE BOIS',
  owner: 'Michael BAYLE',
  address: "N°6 L'expardelière\n87360 LUSSAC LES EGLISES",
  city: 'Lussac',
  phone: '05.55.60.69.14 – 06.82.10.79.59',
  email: 'contact@marche-bois-menuiserie.fr',
  web: 'http://www.marche-bois-menuiserie.fr/',
  siret: '511 277 287 00013',
  legal: 'EURL au capital de 75000 €',
  rge: '113877',
  insurance: 'AREAS 16063935Z',
  tvaNum: 'FR70511277287', rcs: '511 277 287 R.C.S.', rm: '', mediator: '', delay: '', opType: 'mixed', vatDebits: false,
  iban: '',
  bic: '',
  logo: '',
  wallpaper: true,
  tva: 10,
  intro: 'Fourniture et pose :',
  note: 'Suivant prise de cotes sur place.',
  terms: "30% à la signature devis\n30% au commencement des travaux\n40% à la réception chantier à régler au plus tard un mois après la date de facturation. En outre une indemnité forfaitaire de frais de recouvrement de 40 Euros sera ajoutée ainsi des pénalités de retard de 10% par an\nPas d'escompte en cas de règlement anticipé.",
  quotePrefix: 'DEV-{AAAA}-', quoteNext: 1,
  invPrefix: 'FAC-{AAAA}-', invNext: 1, creditPrefix: 'AV-{AAAA}-', creditNext: 1, pad: 4,
  validity: 30,
  appName: 'GestPro',
  autoCloseSites: true,
  payDays: 30,
  ouvCoef: 1.3,
  autoBackup: true,
  remindQuoteDays: 10, remindInvDays: 3, remindEvery: 7, relanceSubject: '', relanceQuote: '', relanceInvoice: '',
  photoPx: 2560,
  stSecColor: '#1e5aa8', stSecBg: '#dbe7f7', stLineBg: '#ffffff', stTextBg: '#f6f7f9',
  fbPage: '', fbId: '', fbToken: '',
  googleClientId: '',
  hashtags: '#menuiserie #bois #artisan #charpente'
};

/* ---------- Numérotation annuelle ----------
   Un préfixe peut contenir {AAAA} (année sur 4 chiffres) ou {AA} (2 chiffres) : le numéro repart à 1 le 1er janvier, sans rien changer dans les réglages.
   Un préfixe sans jeton garde un compteur continu. quoteYear / invYear / creditYear = année à laquelle appartient le compteur en cours. */
const SEQ = { quote: ['quotePrefix', 'quoteNext', 'quoteYear', 'DEV-{AAAA}-'], invoice: ['invPrefix', 'invNext', 'invYear', 'FAC-{AAAA}-'], credit: ['creditPrefix', 'creditNext', 'creditYear', 'AV-{AAAA}-'] };
export const yearTok = p => /\{AAAA\}|\{AA\}/.test(p || '');
export const fmtPrefix = (p, y) => String(p || '').replace(/\{AAAA\}/g, String(y)).replace(/\{AA\}/g, String(y).slice(-2));
/* Reprend les anciens préfixes « DEV-2026- » en « DEV-{AAAA}- » (année de l'an dernier ou de cette année seulement) et date les compteurs */
export function normNumbering(S, now = new Date().getFullYear()) {
  const o = { ...S };
  for (const [pk, , yk] of Object.values(SEQ)) {
    let p = String(o[pk] ?? '');
    if (p && !yearTok(p)) {
      const m = p.match(/(^|\D)(20\d\d)(?!\d)/); // pas de « lookbehind » : anciens navigateurs
      if (m && +m[2] >= now - 1 && +m[2] <= now) { o[pk] = p = p.replace(m[0], m[1] + '{AAAA}'); if (o[yk] == null) o[yk] = +m[2]; }
    }
    if (yearTok(p) && o[yk] == null) o[yk] = now;
  }
  return o;
}
/* Prochain numéro d'une série à la date `y` (année) : { number, n, yr, pre, key, yk } — sans rien écrire */
export function seqOf(S, type, y = new Date().getFullYear()) {
  const [pk, key, yk, dflt] = SEQ[type], pre = S[pk] || (type === 'credit' ? dflt : '');
  let n = Number(S[key]) || 1, yr = S[yk] ?? y;
  if (yearTok(pre) && y > yr) { n = 1; yr = y; }
  const pad = Math.max(0, Number(S.pad) || 0);
  return { pre, key, yk, n, yr, number: fmtPrefix(pre, yr) + String(n).padStart(pad, '0'), pad };
}
/* Numéro du dernier document émis d'une série (le dernier numéro attribué), ou '' s'il n'y en a pas encore */
export function lastNumber(S, type, y = new Date().getFullYear()) {
  const q = seqOf(S, type, y);
  return q.n > 1 ? fmtPrefix(q.pre, q.yr) + String(q.n - 1).padStart(q.pad, '0') : '';
}

/* Lit les réglages ; applique au passage les listes de choix et les seuils (Réglages › Listes de choix, Seuils et délais) pour tous les écrans */
export const getS = async () => { const S = normNumbering(await db.getSettings(DEFAULTS)); applyLists(S); applyLimits(S); return S; };

// Logo utilisé (personnalisé dans Réglages, sinon logo par défaut du dépôt)
export const logoSrc = S => S.logo || 'logo.png';
