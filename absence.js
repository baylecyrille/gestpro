// Absences posées dans le planning (M7) : congés, maladie… sur une période, pour un membre.
// Fonctions pures (testables hors navigateur). Une absence est une série de saisies d'heures « kind: absence » (magasin « times »), une par jour,
// reliées par un même identifiant de série « grp » : elles comptent donc comme toutes les absences (compteur, récapitulatif du comptable, clôture du mois).
import { dayHoursOf, round2, addDay, isWeekend, isClosedDate, ABS_LABEL, absLabel, workedOf, absenceOf, dayTimes } from './hours.js';

export const MAX_DAYS = 366; // durée maximale d'une absence, en jours de calendrier (une année)
const spanOf = (start, end) => Math.round((Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10)) - Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10))) / 86400000) + 1;
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/* Jours d'une période (samedi et dimanche seulement si demandé) */
export function absDays(start, end, weekend = false) {
  const out = [];
  if (!start || !end || end < start) return out;
  // le plafond d'itérations protège l'écran d'une date de fin absurde ; planAbsence refuse avant toute période de plus d'un an
  for (let d = start, i = 0; d <= end && i < MAX_DAYS + 7; d = addDay(d, 1), i++) if (weekend || !isWeekend(d)) out.push(d);
  return out;
}

/* Durée posée chaque jour : 'full' = la journée type du membre (35 h/sem → 7 h), 'half' = la moitié, 'custom' = la durée saisie */
export function absHours(member, part, custom) {
  const day = dayHoursOf(member);
  if (part === 'half') return round2(day / 2);
  if (part === 'custom') return round2(num(custom));
  return day;
}
/* Réciproque : quelle « part » correspond à ces heures pour ce membre ? */
export function partOf(member, hours) {
  const h = round2(num(hours)), day = dayHoursOf(member);
  return h === day ? 'full' : h === round2(day / 2) ? 'half' : 'custom';
}

/* Saisies d'absence d'un membre un jour donné */
export const absOn = (times, memberId, date) => dayTimes(times, memberId, date).filter(x => x.kind === 'absence');
/* Jours d'une liste où ce membre est en absence → [{ date, label }] */
export function absentDays(times, memberId, days) {
  const out = [];
  for (const d of days || []) { const a = absOn(times, memberId, d)[0]; if (a) out.push({ date: d, label: absLabel(a.absType) }); }
  return out;
}

/* Série d'absence (toutes les saisies portant le même grp), triée par date */
export const groupOf = (times, grp) => (grp ? (times || []).filter(x => x.kind === 'absence' && x.grp === grp).sort((a, b) => a.date.localeCompare(b.date)) : []);

/* Prépare l'enregistrement d'une absence (création ou modification d'une série).
   o : { member, start, end, weekend, absType, part, custom, note, grp, keepHours, times, closed, by }
   → { error } ou { grp, rows (à enregistrer), remove (ids à supprimer), skipped: [{ date, why }], days (nombre de jours posés) } */
export function planAbsence(o) {
  const m = o.member;
  if (!m) return { error: 'Choisissez au moins un membre.' };
  if (!o.start || !o.end) return { error: 'Indiquez les dates de début et de fin.' };
  if (o.end < o.start) return { error: 'La date de fin est avant la date de début.' };
  if (!ABS_LABEL[o.absType]) return { error: 'Choisissez le type d\'absence.' };
  if (spanOf(o.start, o.end) > MAX_DAYS) return { error: `Une absence ne peut pas dépasser ${MAX_DAYS} jours : découpez-la en plusieurs périodes.` };
  const all = absDays(o.start, o.end, !!o.weekend);
  if (all.length > MAX_DAYS) return { error: `Une absence ne peut pas dépasser ${MAX_DAYS} jours : découpez-la en plusieurs périodes.` };
  if (!all.length) return { error: 'Aucun jour ouvré dans cette période (cochez « samedi et dimanche » si besoin).' };
  const h = absHours(m, o.part, o.custom);
  if (!(h > 0) || h > 24) return { error: 'Indiquez une durée par jour comprise entre quelques minutes et 24 h.' };
  const grp = o.grp || 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const mine = (o.times || []).filter(x => x.memberId === m.id);
  const own = new Set(mine.filter(x => x.kind === 'absence' && x.grp === grp).map(x => x.id));
  const rows = [], skipped = [], keepDays = new Set();
  for (const d of all) {
    if (isClosedDate(o.closed, d)) { skipped.push({ date: d, why: 'mois clôturé' }); continue; }
    const ex = mine.filter(x => x.date === d);
    const mineHere = ex.filter(x => own.has(x.id));
    const others = ex.filter(x => !own.has(x.id));
    if (workedOf(others) > 0) { skipped.push({ date: d, why: 'heures déjà saisies' }); continue; }
    if (absenceOf(others) > 0) { skipped.push({ date: d, why: 'déjà en absence' }); continue; }
    const first = mineHere[0];
    keepDays.add(d);
    rows.push({ ...(first || {}), ...(first ? { id: first.id } : {}), memberId: m.id, date: d, kind: 'absence', siteId: '', hours: o.keepHours && first ? first.hours : h, note: String(o.note || '').trim().slice(0, 120), absType: o.absType, grp, by: o.by || '' });
  }
  /* jours de la série qui ne sont plus dans la période : supprimés (sauf mois clôturé, qui ne bouge plus) ; doublons d'un même jour : supprimés */
  const remove = [];
  const used = new Set(rows.map(r => r.id).filter(Boolean));
  for (const x of mine) if (own.has(x.id) && !used.has(x.id) && !isClosedDate(o.closed, x.date)) remove.push(x.id);
  return { grp, rows, remove, skipped, days: rows.length };
}

/* Texte court des jours ignorés : « 3 jours ignorés : 2 (heures déjà saisies), 1 (mois clôturé) » */
export function skippedText(skipped, dateFr) {
  if (!skipped || !skipped.length) return '';
  const by = {}; skipped.forEach(s => (by[s.why] ||= []).push(s.date));
  return Object.entries(by).map(([why, ds]) => `${ds.length} jour${ds.length > 1 ? 's' : ''} ignoré${ds.length > 1 ? 's' : ''} (${why}) : ${ds.slice(0, 6).map(dateFr || (x => x)).join(', ')}${ds.length > 6 ? '…' : ''}`).join('\n');
}

/* Fiche d'une série (pour la rouvrir dans le formulaire) */
export function describeGroup(times, grp, member) {
  const rows = groupOf(times, grp);
  if (!rows.length) return null;
  const f = rows[0], l = rows[rows.length - 1];
  return { grp, memberId: f.memberId, start: f.date, end: l.date, weekend: rows.some(r => isWeekend(r.date)), absType: f.absType || '', note: f.note || '', count: rows.length, hours: f.hours, part: member ? partOf(member, f.hours) : 'custom', closed: false };
}
