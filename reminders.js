// Relances de devis et de factures (N1) : quoi relancer et quand, historique d'un dossier.
// Fonctions pures (testables hors navigateur) ; le message et l'envoi sont dans docmail.js (relanceModal).
import { totals, counts, paidOf } from './docs.js';
import { num, round2, today } from './util.js';

/* Délais par défaut, réglables dans Réglages › E-mails */
export const REMIND = { quoteDays: 10, invDays: 3, every: 7, max: 3 };

export const RELANCE_DEFAULTS = {
  subject: 'Relance – {type} {numero} – {company}',
  quote: 'Bonjour,\n\nNous vous avons adressé {le} n° {numero}{chantier} le {date}, d\'un montant de {montant} TTC. Avez-vous pu l\'étudier ?\n\n{validite}\n\nNous restons à votre disposition pour en discuter ou l\'adapter à votre besoin.\n\nCordialement,\n{owner}\n{company}\n{phone}',
  invoice: 'Bonjour,\n\nSauf erreur de notre part, {le} n° {numero} du {date}{chantier}, d\'un montant de {montant} TTC{restant}, n\'est pas encore réglée{retard}.\n\nPourriez-vous procéder au règlement, ou nous indiquer la date prévue ?\n\n{penalites}Si le règlement a été effectué entre-temps, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{owner}\n{company}\n{phone}'
};
export const RELANCE_TOKENS = '{type} {le} {numero} {montant} {date} {chantier} {client} {validite} {restant} {retard} {penalites} {company} {owner} {phone}';

const day = iso => String(iso || '').slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(day(b) + 'T12:00:00Z') - Date.parse(day(a) + 'T12:00:00Z')) / 864e5);
const addDays = (iso, n) => { const d = new Date(day(iso) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const delaysOf = S => ({
  quoteDays: Math.max(1, num(S?.remindQuoteDays) || REMIND.quoteDays),
  invDays: S?.remindInvDays === 0 || S?.remindInvDays === '0' ? 0 : Math.max(0, num(S?.remindInvDays) || REMIND.invDays),
  every: Math.max(1, num(S?.remindEvery) || REMIND.every)
});

/* Historique d'un dossier : [{ at, to, via, by }] */
export const remindersOf = d => (Array.isArray(d && d.reminders) ? d.reminders : []);
export const lastRemind = d => { const l = remindersOf(d); return l.length ? day(l[l.length - 1].at) : ''; };
/* Dernier envoi du document par e-mail (sinon sa date) */
export const sentOn = d => { const m = (d.mails || []); return m.length ? day(m[m.length - 1].at) : day(d.date); };
/* Date limite de règlement : celle de la facture, sinon date + délai par défaut (30 jours) */
export const dueOf = (d, S) => day(d.dueDate) || (d.date ? addDays(d.date, num(S?.payDays ?? 30)) : '');
export const addReminder = (d, o = {}) => { d.reminders = [...remindersOf(d), { at: o.at || new Date().toISOString(), to: o.to || '', via: o.via || 'e-mail', by: o.by || '' }]; return d; };

/* Relances à faire aujourd'hui.
   Devis envoyé et sans réponse : relancé après `quoteDays` jours, puis tous les `every` jours, trois fois au plus.
   Facture non soldée (hors litige, hors avoir total) : relancée `invDays` jours après l'échéance, puis tous les `every` jours, sans limite (« mise en demeure à envisager » à partir de la 3e).
   Retourne [{ doc, kind, days, left, n, last, due, next }] : factures d'abord (les plus en retard en tête), puis devis (les plus anciens en tête). */
export function remindList(docs, payments, S = {}, ref = today()) {
  const { quoteDays, invDays, every } = delaysOf(S), out = [];
  const credited = {};
  for (const c of docs) if (c.type === 'credit' && c.status !== 'draft' && c.fromInvoice) credited[c.fromInvoice] = round2((credited[c.fromInvoice] || 0) + totals(c).ttc);
  for (const d of docs) {
    if (!d.number) continue;
    const n = remindersOf(d).length, last = lastRemind(d);
    if (d.type === 'quote' && d.status === 'sent') {
      if (n >= REMIND.max) continue;
      const base = last || sentOn(d); if (!base) continue;
      const age = daysBetween(sentOn(d), ref), wait = last ? every : quoteDays;
      if (daysBetween(base, ref) < wait) continue;
      out.push({ doc: d, kind: 'quote', days: age, left: totals(d).ttc, n, last, due: '' });
    } else if (d.type === 'invoice' && counts(d) && d.status !== 'dispute') {
      const t = totals(d).ttc, left = round2(t - paidOf(payments, d.id));
      if (!(t > 0) || left <= 0.005 || (credited[d.id] || 0) >= t - 0.005) continue;
      const due = dueOf(d, S); if (!due) continue;
      const late = daysBetween(due, ref); if (late < invDays) continue;
      if (last && daysBetween(last, ref) < every) continue;
      out.push({ doc: d, kind: 'invoice', days: late, left, n, last, due });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? b.days - a.days : a.kind === 'invoice' ? -1 : 1));
}
