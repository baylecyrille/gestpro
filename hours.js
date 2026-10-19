// Heures réalisées, saisies jour par jour (magasin « times », onglet Google Sheets « Pointages »).
// Fonctions pures (testables hors navigateur). Une saisie = { id, memberId, date: 'aaaa-mm-jj', kind, siteId, hours, note }.
// kind : 'site' (chantier, avec siteId : le chantier prévu OU un autre), 'atelier', 'trajet' (déplacement / approvisionnement), 'absence' (congés, absence).
// L'ancien total « Heures réalisées » d'une affectation (task.done) reste valable tant qu'aucune saisie par jour n'existe pour ce membre sur ce chantier pendant les dates de l'affectation.
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const round2 = v => Math.round(v * 100) / 100;

export const KINDS = [['site', 'Chantier'], ['atelier', 'Atelier'], ['trajet', 'Déplacement / approvisionnement'], ['absence', 'Congés / absence']];
export const KIND_LABEL = Object.fromEntries(KINDS);
export const WORKED = ['site', 'atelier', 'trajet']; // heures travaillées (l'absence se compte à part)
export const DAY_LIMIT = 24;

const inRange = (d, a, b) => !!d && !!a && d >= a && d <= (b || a);

/* Saisies d'un membre pour un jour */
export const dayTimes = (times, memberId, date) => (times || []).filter(x => x.memberId === memberId && x.date === date);
export const workedOf = list => round2((list || []).filter(x => WORKED.includes(x.kind)).reduce((a, x) => a + num(x.hours), 0));
export const absenceOf = list => round2((list || []).filter(x => x.kind === 'absence').reduce((a, x) => a + num(x.hours), 0));

/* Total saisi à l'ancienne sur une affectation : compté seulement s'il n'y a aucune saisie par jour correspondante */
export function legacyDone(t, times) {
  const d = num(t.done); if (d <= 0) return 0;
  return (times || []).some(x => x.kind === 'site' && x.memberId === t.memberId && x.siteId === t.siteId && inRange(x.date, t.start, t.end)) ? 0 : d;
}

/* Heures réalisées sur un chantier, par membre : { memberId: heures } (saisies par jour + anciens totaux non remplacés) */
export function doneBySite(siteId, tasks, times) {
  const by = {};
  const add = (id, h) => { if (h) by[id] = round2((by[id] || 0) + h); };
  (times || []).filter(x => x.kind === 'site' && x.siteId === siteId).forEach(x => add(x.memberId, num(x.hours)));
  (tasks || []).filter(t => t.siteId === siteId).forEach(t => add(t.memberId, legacyDone(t, times)));
  return by;
}

/* Heures travaillées d'un membre sur un mois 'aaaa-mm' (+ absences à part) */
export function monthOf(memberId, month, tasks, times) {
  const mine = (times || []).filter(x => x.memberId === memberId && (x.date || '').slice(0, 7) === month);
  let worked = workedOf(mine);
  (tasks || []).filter(t => t.memberId === memberId && (t.start || '').slice(0, 7) === month).forEach(t => { worked = round2(worked + legacyDone(t, times)); });
  return { worked, absence: absenceOf(mine) };
}

/* Heures travaillées d'un membre sur une liste de jours (affichage de la semaine) */
export const weekOf = (memberId, days, times) => workedOf((times || []).filter(x => x.memberId === memberId && days.includes(x.date)));

/* Contrôle d'une journée avant enregistrement. lines = [{kind, siteId, hours}] → { lines (nettoyées), error } */
export function checkDay(lines) {
  const out = [];
  for (const l of lines || []) {
    const h = round2(num(l.hours));
    if (!(h > 0)) continue; // ligne vide ou à 0 h : ignorée
    const kind = KIND_LABEL[l.kind] ? l.kind : 'site';
    if (kind === 'site' && !l.siteId) return { lines: [], error: 'Choisissez le chantier de chaque ligne « Chantier ».' };
    if (h > DAY_LIMIT) return { lines: [], error: `Une ligne ne peut pas dépasser ${DAY_LIMIT} h.` };
    out.push({ id: l.id || '', kind, siteId: kind === 'site' ? l.siteId : '', hours: h, note: String(l.note || '').trim().slice(0, 120) });
  }
  const tot = workedOf(out);
  if (tot > DAY_LIMIT) return { lines: [], error: `Plus de ${DAY_LIMIT} h travaillées dans la même journée : vérifiez les heures.` };
  return { lines: out, error: '' };
}
