// Clients : détection des doublons (B3) et encours par client (M6). Fonctions pures, sans écran ni base de données.
import { totals, counts, paidOf } from './docs.js';
import { dueOf } from './reminders.js';
import { round2, today } from './util.js';

/* ---------- Clés de comparaison ---------- */
const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/* Mots sans valeur pour reconnaître un nom : civilités, formes juridiques, liaisons */
const STOP = new Set(['m', 'mr', 'mme', 'mlle', 'mmes', 'messieurs', 'monsieur', 'madame', 'mademoiselle', 'et', 'de', 'du', 'des', 'la', 'le', 'les', 'sarl', 'sas', 'sasu', 'eurl', 'sci', 'sa', 'ste', 'societe', 'ets', 'entreprise']);
const tokens = s => strip(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(t => t && !STOP.has(t));
/* « Jean DUPONT », « Dupont Jean » et « M. et Mme Dupont Jean » donnent la même clé */
export const nameKey = s => tokens(s).sort().join(' ');
/* Téléphone : neuf derniers chiffres (« 06 12 34 56 78 », « +33 6 12 34 56 78 » et « 0033612345678 » se confondent) */
export const phoneKey = s => { const d = String(s ?? '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
export const mailKey = s => { const m = String(s ?? '').trim().toLowerCase(); return m.includes('@') ? m : ''; };
/* SIRET ou SIREN : les neuf premiers chiffres identifient l'entreprise */
export const sirenKey = s => { const d = String(s ?? '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(0, 9) : ''; };

function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/* Deux noms qui se ressemblent : l'un contient l'autre (« Dupont » / « Dupont Jean »), ou une faute de frappe (« Dupond » / « Dupont ») */
function close(a, b) {
  const ta = a.split(' '), tb = b.split(' '), [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (s.join('').length >= 4 && s.every(t => l.includes(t))) return true;
  const n = Math.max(a.length, b.length);
  return n >= 5 && lev(a, b) <= (n >= 10 ? 2 : 1);
}

/* Fiches qui ressemblent à `cand` ({ name, phone, email, siret }), de même nature (client, fournisseur…).
   Retourne [{ c, why: [motifs], strong }] : `strong` = même e-mail, téléphone, SIRET ou même nom (à confirmer avant de créer un doublon) ; sinon « nom proche » (simple information). */
export function findSimilar(contacts, cand, { kind, excludeId } = {}) {
  const k = nameKey(cand.name), ph = phoneKey(cand.phone), em = mailKey(cand.email), si = sirenKey(cand.siret), out = [];
  for (const c of contacts || []) {
    if (!c || c._d || c.id === excludeId || (kind && c.kind !== kind)) continue;
    const why = []; let strong = false;
    if (em && mailKey(c.email) === em) { why.push('même e-mail'); strong = true; }
    if (ph && phoneKey(c.phone) === ph) { why.push('même téléphone'); strong = true; }
    if (si && sirenKey(c.siret) === si) { why.push('même SIRET'); strong = true; }
    const ck = nameKey(c.name);
    if (k && ck) { if (k === ck) { why.push('même nom'); strong = true; } else if (close(k, ck)) why.push('nom proche'); }
    if (why.length) out.push({ c, why, strong });
  }
  return out.sort((a, b) => (b.strong - a.strong) || (b.why.length - a.why.length) || String(a.c.name).localeCompare(String(b.c.name), 'fr'));
}

/* ---------- Encours par client ---------- */
const OPEN = ['new', 'signed', 'progress'];
/* Pour chaque client : reste dû (factures émises non soldées), part échue, dernier devis, devis en attente, chantiers ouverts et en retard.
   Retourne { id client → { due, nDue, late, nLate, lateDays, lastQuote, nQuotes, pending, openSites, lateSites, hasUnpaid } } */
export function statsByClient(contacts, docs, payments, sites, S = {}, ref = today()) {
  const by = {}, grab = id => (by[id] ||= { docs: [], sites: [] });
  for (const d of docs) if (d.clientId) grab(d.clientId).docs.push(d);
  for (const s of sites) if (s.clientId) grab(s.clientId).sites.push(s);
  const out = {};
  for (const c of contacts) {
    const g = by[c.id] || { docs: [], sites: [] };
    let due = 0, nDue = 0, late = 0, nLate = 0, lateDays = 0;
    for (const d of g.docs) {
      if (d.type !== 'invoice' || !counts(d)) continue;
      const left = round2(totals(d).ttc - paidOf(payments, d.id));
      if (left <= 0.005) continue;
      due = round2(due + left); nDue++;
      const dd = dueOf(d, S);
      if (dd && dd < ref && d.status !== 'dispute') { late = round2(late + left); nLate++; lateDays = Math.max(lateDays, Math.round((Date.parse(ref) - Date.parse(dd)) / 864e5)); }
    }
    const quotes = g.docs.filter(d => d.type === 'quote' && d.number).sort((a, b) => ((b.date || '') + b.number).localeCompare((a.date || '') + a.number));
    const q = quotes[0];
    const open = g.sites.filter(s => OPEN.includes(s.status));
    out[c.id] = { due, nDue, late, nLate, lateDays, hasUnpaid: due > 0.005,
      lastQuote: q ? { id: q.id, number: q.number, date: q.date, status: q.status, ttc: totals(q).ttc } : null,
      nQuotes: quotes.length, pending: quotes.filter(x => x.status === 'sent').length,
      openSites: open.length, lateSites: open.filter(s => s.end && s.end < ref).length };
  }
  return out;
}
