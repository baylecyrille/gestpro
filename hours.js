// Heures réalisées, saisies jour par jour (magasin « times », onglet Google Sheets « Pointages »).
// Fonctions pures (testables hors navigateur). Une saisie = { id, memberId, date: 'aaaa-mm-jj', kind, siteId, hours, note }.
// kind : 'site' (chantier, avec siteId : le chantier prévu OU un autre), 'atelier', 'trajet' (déplacement / approvisionnement), 'absence' (congés, absence).
// L'ancien total « Heures réalisées » d'une affectation (task.done) reste valable tant qu'aucune saisie par jour n'existe pour ce membre sur ce chantier pendant les dates de l'affectation.
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
export const round2 = v => Math.round(v * 100) / 100;

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

/* ---------- Récapitulatif mensuel (tous les membres, jour par jour) ---------- */
const pad = n => String(n).padStart(2, '0');
const toD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const toS = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDay = (s, n) => { const d = toD(s); d.setDate(d.getDate() + n); return toS(d); };
export const mondayOf = s => addDay(s, -((toD(s).getDay() + 6) % 7));
export const isWeekend = s => [0, 6].includes(toD(s).getDay());
/* Numéro de semaine ISO (le jeudi de la semaine décide de l'année) */
export function isoWeek(s) {
  const th = toD(addDay(mondayOf(s), 3)), y = th.getFullYear();
  return Math.floor(Math.round((th - new Date(y, 0, 1)) / 864e5) / 7) + 1; // round : l'heure d'été fausse la division
}
export const monthDays = month => { const [y, m] = month.split('-').map(Number); return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${pad(i + 1)}`); };
export const shiftMonth = (month, n) => { const [y, m] = month.split('-').map(Number); return toS(new Date(y, m - 1 + n, 1)).slice(0, 7); };
/* L'affectation (planning) couvre-t-elle ce jour ? Week-ends exclus sauf option. */
export function covers(a, day) {
  if (!a.start || day < a.start || day > (a.end || a.start)) return false;
  return a.weekend || !isWeekend(day);
}
/* Heures au format français : 7,5 · 8 · 7,25 */
export const fmtH = h => { const v = round2(num(h)); return Number.isInteger(v) ? String(v) : String(v).replace('.', ','); };

/* monthRecap : pour le mois 'aaaa-mm', par membre (jour par jour, par activité, par chantier), par chantier, et totaux.
   today : date du jour 'aaaa-mm-jj' (seuls les jours déjà passés, prévus au planning et sans saisie, sont « à compléter »). */
export function monthRecap({ month, members = [], sites = [], tasks = [], times = [], today = '' }) {
  const days = monthDays(month);
  const S = Object.fromEntries(sites.map(s => [s.id, s]));
  const inMonth = (times || []).filter(x => (x.date || '').slice(0, 7) === month);
  const idx = {}; inMonth.forEach(x => (idx[`${x.memberId}|${x.date}`] ||= []).push(x));
  const sitesAgg = {}, kinds = { atelier: {}, trajet: {}, absence: {} };
  const addSite = (sid, mid, h) => { const r = sitesAgg[sid] ||= { siteId: sid, name: S[sid]?.name || 'Chantier supprimé', color: S[sid]?.color || '', total: 0, byMember: {} }; r.total = round2(r.total + h); r.byMember[mid] = round2((r.byMember[mid] || 0) + h); };
  const addKind = (k, mid, h) => { const r = kinds[k]; r.total = round2((r.total || 0) + h); (r.byMember ||= {})[mid] = round2((r.byMember[mid] || 0) + h); };
  const rows = [];
  for (const m of members) {
    const myTasks = (tasks || []).filter(t => t.memberId === m.id);
    const has = inMonth.some(x => x.memberId === m.id) || myTasks.some(t => (t.start || '').slice(0, 7) === month && legacyDone(t, times) > 0);
    if (m.active === false && !has) continue; // un membre devenu inactif reste listé s'il a des heures ce mois-là
    const row = { member: m, days: {}, site: {}, atelier: 0, trajet: 0, absence: 0, legacy: 0, worked: 0, missing: 0, missingDays: [] };
    const legacyCovered = new Set();
    myTasks.filter(t => (t.start || '').slice(0, 7) === month || days.some(d => covers(t, d))).forEach(t => {
      const ld = legacyDone(t, times); if (!ld) return;
      days.filter(d => covers(t, d)).forEach(d => legacyCovered.add(d));
      if ((t.start || '').slice(0, 7) === month) { row.site[t.siteId] = round2((row.site[t.siteId] || 0) + ld); row.legacy = round2(row.legacy + ld); addSite(t.siteId, m.id, ld); }
    });
    for (const d of days) {
      const lines = idx[`${m.id}|${d}`] || [];
      const planned = myTasks.filter(t => covers(t, d));
      const day = { date: d, lines, planned, worked: workedOf(lines), absence: absenceOf(lines), weekend: isWeekend(d) };
      day.missing = !!today && d < today && planned.length > 0 && !lines.length && !legacyCovered.has(d); // le jour en cours n'est pas « en retard » : on saisit en fin de journée
      if (day.missing) { row.missing++; row.missingDays.push(d); }
      for (const x of lines) {
        const h = num(x.hours);
        if (x.kind === 'site') { row.site[x.siteId] = round2((row.site[x.siteId] || 0) + h); addSite(x.siteId, m.id, h); }
        else if (x.kind === 'atelier' || x.kind === 'trajet' || x.kind === 'absence') { row[x.kind] = round2(row[x.kind] + h); addKind(x.kind, m.id, h); }
      }
      row.days[d] = day;
    }
    row.siteTotal = round2(Object.values(row.site).reduce((a, v) => a + v, 0));
    row.worked = round2(row.siteTotal + row.atelier + row.trajet);
    /* semaines du mois (lundi → dimanche, limitées au mois) pour les sous-totaux */
    row.weeks = [];
    for (const d of days) {
      const mon = mondayOf(d);
      let w = row.weeks[row.weeks.length - 1];
      if (!w || w.monday !== mon) row.weeks.push(w = { monday: mon, number: isoWeek(d), days: [], worked: 0, absence: 0 });
      w.days.push(d); w.worked = round2(w.worked + row.days[d].worked); w.absence = round2(w.absence + row.days[d].absence);
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.member.name.localeCompare(b.member.name, 'fr'));
  const sitesOut = Object.values(sitesAgg).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'fr'));
  const sum = f => round2(rows.reduce((a, r) => a + f(r), 0));
  return {
    month, days, rows, sites: sitesOut, kinds,
    totals: { worked: sum(r => r.worked), site: sum(r => r.siteTotal), atelier: sum(r => r.atelier), trajet: sum(r => r.trajet), absence: sum(r => r.absence), missing: sum(r => r.missing) }
  };
}
