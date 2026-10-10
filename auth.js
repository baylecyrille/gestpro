// Profils d'accès et codes PIN des membres. Verrouillage d'usage (pas de sécurité serveur) :
// il masque menus et actions non autorisés, mais ne protège pas un accès direct à la feuille Google Sheets.
import * as db from './db.js';

const KEY = 'gp_uid';

/* Droits par profil. '*' = tout. Droits : dashboard, sites, sites.edit, sites.money, planning, planning.all, planning.edit,
   planning.hours, team, team.edit, stock, quotes, invoices, credits, docs.own (devis limités aux siens), contacts, facebook, settings */
export const PROFILES = {
  admin: { label: 'Administrateur', desc: 'Tous les droits : réglages, équipe, connexion Google Sheets, chiffres.', can: '*' },
  manager: {
    label: 'Gestionnaire', desc: 'Gère devis, factures, avoirs, chantiers, contacts, stock et planning. Pas de tableau de bord ni de réglages.',
    can: ['sites', 'sites.edit', 'sites.money', 'planning', 'planning.all', 'planning.edit', 'team', 'stock', 'quotes', 'invoices', 'credits', 'contacts', 'facebook']
  },
  sales: { label: 'Commercial', desc: 'Voit et crée ses propres devis et les contacts. Consulte les chantiers (sans montants).', can: ['sites', 'quotes', 'docs.own', 'contacts'] },
  worker: { label: 'Compagnon / salarié', desc: 'Voit son planning et ses chantiers (sans montants), saisit ses heures, utilise le stock.', can: ['sites', 'planning', 'planning.hours', 'stock'] },
  contractor: { label: 'Intervenant', desc: 'Voit seulement son planning et les chantiers où il intervient (sans montants).', can: ['sites', 'planning'] }
};
export const PROFILE_OPTIONS = [['', 'Aucun accès (fiche seulement)'], ...Object.entries(PROFILES).map(([k, v]) => [k, v.label])];

let members = [], active = false, user = null;

export async function hashPin(pin, salt) {
  const txt = `gestpro:${salt}:${pin}`;
  try {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { // contexte sans WebCrypto : empreinte simple (secours)
    let h = 5381; for (const c of txt) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return 'x' + (h >>> 0).toString(16);
  }
}

/* Recharge l'état : la protection est active dès qu'un administrateur actif possède un code PIN */
export async function load() {
  members = await db.all('members');
  active = members.some(m => m.access === 'admin' && m.pinHash && m.active !== false);
  let id = ''; try { id = localStorage.getItem(KEY) || ''; } catch { /* ignore */ }
  user = active ? members.find(m => m.id === id && m.access && m.pinHash && m.active !== false) || null : null;
  return { active, user };
}
export const isActive = () => active;
export const currentUser = () => user;
export const loginCandidates = () => members.filter(m => m.access && m.pinHash && m.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
export const profileKey = () => (active ? user?.access || null : 'admin');
export function can(f) {
  const k = profileKey(); if (!k) return false;
  const c = PROFILES[k]?.can; return c === '*' || (Array.isArray(c) && c.includes(f));
}
export const setUser = id => { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } };
export const logout = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } user = null; };

export async function login(id, pin) {
  const m = members.find(x => x.id === id);
  if (!m || !m.pinHash) return false;
  if (await hashPin(String(pin), m.id) !== m.pinHash) return false;
  setUser(m.id); user = m; return true;
}

/* Page d'accueil selon le profil */
export function home() {
  for (const [f, h] of [['dashboard', '#/dashboard'], ['planning', '#/planning/week'], ['quotes', '#/docs/quote'], ['sites', '#/sites']]) if (can(f)) return h;
  return '#/sites';
}

/* Route autorisée ? Sinon renvoie la page d'accueil du profil. */
export function guard(name, a) {
  const ok = {
    dashboard: () => can('dashboard'), sites: () => can('sites'), site: () => can('sites'),
    planning: () => can('planning') && (a !== 'team' || can('team')),
    stock: () => can('stock'), contacts: () => can('contacts'), facebook: () => can('facebook'), settings: () => can('settings'),
    docs: () => can('quotes') || can('invoices') || can('credits'),
    doc: () => can('quotes') || can('invoices') || can('credits')
  }[name];
  const f = ok || (() => can('dashboard')); // page inconnue = accueil
  return f() ? null : home();
}

/* Document accessible ? (droit par type + devis limités aux siens pour un commercial) */
export function canDoc(d) {
  const f = { quote: 'quotes', invoice: 'invoices', credit: 'credits' }[d.type];
  if (!can(f)) return false;
  return !(d.type === 'quote' && can('docs.own') && active && d.by !== user?.id);
}
