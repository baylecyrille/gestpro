import * as db from './db.js';

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
  iban: '',
  bic: '',
  logo: '',
  wallpaper: true,
  tva: 10,
  intro: 'Fourniture et pose :',
  note: 'Suivant prise de cotes sur place.',
  terms: "30% à la signature devis\n30% au commencement des travaux\n40% à la réception chantier à régler au plus tard un mois après la date de facturation. En outre une indemnité forfaitaire de frais de recouvrement de 40 Euros sera ajoutée ainsi des pénalités de retard de 10% par mois\nPas d'escompte en cas de règlement anticipé.",
  quotePrefix: 'DEV-2026-', quoteNext: 1,
  invPrefix: 'FAC-2026-', invNext: 1, creditPrefix: 'AV-2026-', creditNext: 1, pad: 4,
  validity: 30,
  fbPage: '', fbId: '', fbToken: '',
  googleClientId: '',
  hashtags: '#menuiserie #bois #artisan #charpente'
};

export const getS = () => db.getSettings(DEFAULTS);

// Logo utilisé (personnalisé dans Réglages, sinon logo par défaut du dépôt)
export const logoSrc = S => S.logo || 'logo.png';
