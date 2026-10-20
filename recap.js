// Récapitulatif mensuel des heures (Planning › Heures) : feuille de pointage de toute l'équipe, modifiable jour par jour,
// répartition par chantier, et impression pour le comptable. Les calculs sont dans hours.js (monthRecap).
import { e, today, modal, F, toast, $, $$ } from './util.js';
import * as H from './hours.js';
import { getS } from './defaults.js';
import { LIM } from './limits.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const CAP = s => s.charAt(0).toUpperCase() + s.slice(1);
export const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return `${MOIS[mo - 1]} ${y}`; };
const dFr = d => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`; // indépendant du fuseau horaire
const dShort = d => `${d.slice(8)}/${d.slice(5, 7)}`;
const dowIdx = d => { const [y, m, dd] = d.split('-').map(Number); return (new Date(y, m - 1, dd).getDay() + 6) % 7; };
const dayName = d => `${JOURS[dowIdx(d)]} ${dShort(d)}`;
const hm = (v, short) => H.fmtHM(v, short); // « 7 h 30 » (court : « 7h30 », pour les cases étroites)
const atTxt = at => (at ? `${dFr(at.slice(0, 10))}${at.length > 10 ? ' à ' + at.slice(11, 16).replace(':', ' h ') : ''}` : '');
/* « congé payé 7 h · maladie 14 h » : détail des absences par type (le type vide = anciennes saisies sans précision) */
const absOrder = () => [...Object.keys(H.ABS_LABEL), '']; // types dans l'ordre de la liste (Réglages › Listes de choix), puis « non précisé »
export const absTxt = (byType, f = hm) => absOrder().filter(t => (byType || {})[t] > 0).map(t => `${(t ? H.ABS_LABEL[t] : 'Absence').toLowerCase()} ${f(byType[t])}`).join(' · ');
const sumOf = rows => {
  const T = { worked: 0, site: 0, atelier: 0, bureau: 0, trajet: 0, absence: 0, missing: 0, over: 0, short: 0, absByType: {} };
  rows.forEach(r => {
    T.worked = H.round2(T.worked + r.worked); T.site = H.round2(T.site + r.siteTotal); T.atelier = H.round2(T.atelier + r.atelier); T.bureau = H.round2(T.bureau + r.bureau); T.trajet = H.round2(T.trajet + r.trajet); T.absence = H.round2(T.absence + r.absence);
    T.missing += r.missing; T.over = H.round2(T.over + r.counter.over); T.short = H.round2(T.short + r.counter.short);
    Object.entries(r.absByType).forEach(([t, v]) => { T.absByType[t] = H.round2((T.absByType[t] || 0) + v); });
  });
  return T;
};
const KCOL = { atelier: '#8a94a6', bureau: '#3f9b8a', trajet: '#7b4fd0', absence: '#c77700' };

/* Texte d'une saisie : « Chantier Dupont 4 h — pose des fenêtres » */
export const lineTxt = (x, S) => `${x.kind === 'site' ? (S[x.siteId]?.name || 'Chantier supprimé') : x.kind === 'absence' && H.ABS_LABEL[x.absType] ? 'Absence · ' + H.ABS_LABEL[x.absType] : H.KIND_LABEL[x.kind]} ${hm(x.hours)}${x.note ? ' — ' + x.note : ''}`;
const dotColor = (x, S) => (x.kind === 'site' ? S[x.siteId]?.color || '#2f7ad6' : KCOL[x.kind]);

/* Ce qu'il faut afficher pour un jour dans une liste : ordre des lignes, jours vides, week-ends sans saisie masqués */
const showDay = d => !d.weekend || d.lines.length > 0;

/* Texte d'une semaine du compteur : « 3 h 30 au-delà de 35 h » · « il manque 2 h » */
const weekNote = (cw, base, f = hm) => (cw && cw.counted ? [cw.over ? `${f(cw.over)} au-delà de ${f(base)}` : '', cw.short ? `il manque ${f(cw.short)}` : ''].filter(Boolean).join(' · ') : '');

/* ======================= Écran ======================= */
let saved = null; // position de défilement conservée après la correction d'un jour (la page se recharge)

export function renderRecap(el, ctx) {
  const { head, month, members, sites, tasks, times, canEnter, openDay, closed = null, canClose = false, closeMonth, reopenMonth } = ctx;
  const S = Object.fromEntries(sites.map(s => [s.id, s]));
  const R = H.monthRecap({ month, members, sites, tasks, times, today: today() });
  const T = R.totals, prev = H.shiftMonth(month, -1), next = H.shiftMonth(month, 1), cur = today().slice(0, 7);
  const rowOf = id => R.rows.find(r => r.member.id === id);
  const lock = H.closedMonths(closed)[month] || null;

  /* feuille de pointage : un salarié par ligne, un jour par colonne */
  const cell = (r, d) => {
    const x = r.days[d], on = canEnter(r.member, d);
    const parts = [];
    if (x.worked) parts.push(`<b>${hm(x.worked, true)}</b>`);
    if (x.absence) parts.push(`<span class="rabs">abs ${hm(x.absence, true)}</span>`);
    const dots = x.lines.map(l => `<i style="background:${e(dotColor(l, S))}"></i>`).join('');
    const tip = x.lines.length ? x.lines.map(l => lineTxt(l, S)).join('\n') : x.missing ? 'Prévu au planning, heures non saisies' : '';
    return `<td data-m="${r.member.id}" data-d="${d}" class="${x.weekend ? 'we' : ''} ${x.missing ? 'miss' : ''} ${d === today() ? 'tdy' : ''} ${on ? 'ed' : ''}" ${tip ? `title="${e(tip)}"` : ''}>${parts.join('') || (x.missing ? '<span class="rq">?</span>' : '')}${dots ? `<span class="rdots">${dots}</span>` : ''}</td>`;
  };
  const matrix = R.rows.length ? `<div class="wscroll" id="rscroll"><table class="rtab"><thead><tr><th class="who"></th>${R.days.map(d => `<th class="${dowIdx(d) > 4 ? 'we' : ''} ${d === today() ? 'tdy' : ''}">${JOURS[dowIdx(d)][0]}<br>${+d.slice(8)}</th>`).join('')}<th class="tot">Total</th><th class="tot">Abs.</th></tr></thead><tbody>
      ${R.rows.map(r => `<tr><th class="who"><button type="button" class="rname" data-det="${r.member.id}">${e(r.member.name)}</button></th>${R.days.map(d => cell(r, d)).join('')}<td class="tot"><b>${hm(r.worked)}</b></td><td class="tot">${r.absence ? hm(r.absence) : ''}</td></tr>`).join('')}
      <tr class="gt"><th class="who">Total équipe</th>${R.days.map(d => { const w = H.round2(R.rows.reduce((a, r) => a + r.days[d].worked, 0)); return `<td class="${dowIdx(d) > 4 ? 'we' : ''}">${w ? hm(w, true) : ''}</td>`; }).join('')}<td class="tot"><b>${hm(T.worked)}</b></td><td class="tot">${T.absence ? hm(T.absence) : ''}</td></tr>
    </tbody></table></div>` : '<div class="empty">Aucun membre actif à afficher. <a href="#/planning/team">Ajouter l\'équipe</a></div>';

  /* légende : couleurs des chantiers du mois + activités */
  const legend = `<div class="rleg">${R.sites.map(s => `<span><i style="background:${e(s.color || '#2f7ad6')}"></i>${e(s.name)}</span>`).join('')}${['atelier', 'bureau', 'trajet', 'absence'].filter(k => R.kinds[k].total).map(k => `<span><i style="background:${KCOL[k]}"></i>${e(H.KIND_LABEL[k])}</span>`).join('')}</div>`;

  const sumRows = R.rows.map(r => `<tr><th class="who"><button type="button" class="rname" data-det="${r.member.id}">${e(r.member.name)}</button></th><td class="n">${hm(r.siteTotal)}</td><td class="n">${hm(r.atelier)}</td>${T.bureau ? `<td class="n">${hm(r.bureau)}</td>` : ''}<td class="n">${hm(r.trajet)}</td><td class="n"><b>${hm(r.worked)}</b></td><td class="n">${r.counter.over ? `<span class="chip warn" title="Heures travaillées au-delà de la base hebdomadaire">+${hm(r.counter.over)}</span>` : '<span class="muted">—</span>'}</td><td class="n" ${r.absence ? `title="${e(absTxt(r.absByType))}"` : ''}>${hm(r.absence)}</td><td class="n">${r.missing ? `<span class="chip warn" title="Jours prévus au planning sans heures saisies">${r.missing} j</span>` : '<span class="muted">—</span>'}</td></tr>`).join('');

  const share = R.sites.map(s => `<tr><td><i class="rdot" style="background:${e(s.color || '#2f7ad6')}"></i>${e(s.name)}</td><td class="n"><b>${hm(s.total)}</b></td><td class="rwho">${Object.entries(s.byMember).sort((a, b) => b[1] - a[1]).map(([id, v]) => `<span class="chip">${e(rowOf(id)?.member.name || '?')} ${hm(v)}</span>`).join('')}</td></tr>`).join('')
    + ['atelier', 'bureau', 'trajet', 'absence'].filter(k => R.kinds[k].total).map(k => `<tr class="rk"><td><i class="rdot" style="background:${KCOL[k]}"></i>${e(H.KIND_LABEL[k])}${k === 'absence' ? `<br><small>${e(absTxt(R.kinds.absence.byType))}</small>` : ''}</td><td class="n"><b>${hm(R.kinds[k].total)}</b></td><td class="rwho">${Object.entries(R.kinds[k].byMember).sort((a, b) => b[1] - a[1]).map(([id, v]) => `<span class="chip ${k === 'absence' ? 'warn' : ''}">${e(rowOf(id)?.member.name || '?')} ${hm(v)}</span>`).join('')}</td></tr>`).join('');

  /* compteur hebdomadaire : une colonne par semaine, comparée à la base du salarié (35 h par défaut) */
  const wk0 = R.rows[0] && R.rows[0].counter.weeks;
  const counterCell = (w) => {
    if (w.late) return `<td class="lateW" title="Semaine du ${dShort(w.monday)} au ${dShort(w.sunday)} : elle se termine le mois suivant, elle y sera comptée">→ mois suivant${w.worked ? `<small>${hm(w.worked, true)} déjà saisies</small>` : ''}</td>`;
    const bits = [];
    if (w.worked) bits.push(`<b>${hm(w.worked, true)}</b>`);
    if (w.absence) bits.push(`<span class="rabs">abs ${hm(w.absence, true)}</span>`);
    if (w.over) bits.push(`<span class="cx over">+${hm(w.over, true)}</span>`);
    if (w.short) bits.push(`<span class="cx short">−${hm(w.short, true)}</span>`);
    return `<td class="${w.early ? 'edgeW' : ''}" ${w.early ? `title="Semaine commencée le mois précédent (${dShort(w.monday)}) : comptée ici car elle se termine le ${dShort(w.sunday)}"` : ''}>${bits.join('') || '<span class="muted">—</span>'}</td>`;
  };
  const counter = R.rows.length && wk0 ? `<h3>Compteur hebdomadaire <small class="muted">(base ${hm(LIM.weekHours)} par semaine, réglable sur la fiche de chaque salarié)</small></h3>
    <div class="wscroll"><table class="rtab sum rctr"><thead><tr><th class="who"></th>${wk0.map(w => `<th>S${w.number}<br><small>${dShort(w.monday)}–${dShort(w.sunday)}</small></th>`).join('')}<th>Au-delà de la base</th><th>Il manque</th></tr></thead><tbody>
      ${R.rows.map(r => `<tr><th class="who">${e(r.member.name)}<br><small class="muted">base ${hm(r.counter.base)}</small></th>${r.counter.weeks.map(counterCell).join('')}<td class="n">${r.counter.over ? `<b class="ovr">+${hm(r.counter.over)}</b>` : '<span class="muted">—</span>'}</td><td class="n">${r.counter.short ? `<b class="shr">${hm(r.counter.short)}</b>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted">Une semaine (lundi → dimanche) est comptée dans le mois où elle se termine. Les absences ne sont pas des heures travaillées : elles évitent seulement d'afficher un « il manque ». Seules les heures saisies jour par jour sont comptées.</p>` : '';

  /* clôture du mois */
  const diff = lock ? H.snapDiff(lock.snap, R) : [];
  const logs = ((closed && closed.log) || []).filter(l => l.month === month).slice(-4).reverse();
  const lockBar = `<div class="rlock ${lock ? 'closed' : ''}">
      ${lock ? `<div><b>🔒 Mois clôturé</b> le ${e(atTxt(lock.at))}${lock.by ? ' par ' + e(lock.by) : ''}. Les heures de ce mois ne peuvent plus être saisies ni modifiées.</div>`
        : `<div><b>Mois ouvert.</b> Quand le récapitulatif est envoyé au comptable, clôturez le mois : plus personne ne pourra changer les heures après coup.</div>`}
      ${diff.length ? `<div class="rwarn">⚠ Des heures ont changé depuis la clôture : ${diff.map(d => `${e(rowOf(d.id)?.member.name || 'un salarié')} (${hm(d.before.worked)} → ${hm(d.after.worked)})`).join(' · ')}. Rouvrez le mois pour vérifier, puis clôturez-le de nouveau.</div>` : ''}
      ${canClose ? `<div class="row" style="margin:6px 0 0"><button class="btn sm ${lock ? '' : 'primary'}" id="${lock ? 'ropen' : 'rclose'}" ${R.rows.length || lock ? '' : 'disabled'}>${lock ? '🔓 Rouvrir le mois' : '🔒 Clôturer le mois'}</button></div>` : ''}
      ${logs.length ? `<details class="rlog"><summary>Historique des clôtures de ${e(monthLabel(month))}</summary>${logs.map(l => `<div>${e(atTxt(l.at))} — ${l.action === 'close' ? 'clôturé' : 'rouvert'}${l.by ? ' par ' + e(l.by) : ''}</div>`).join('')}</details>` : ''}
    </div>`;

  el.classList.add('wide'); // pleine largeur sur grand écran : 31 jours côte à côte
  el.innerHTML = `${head}
    <div class="row"><a class="btn" href="#/planning/hours/${prev}" aria-label="Mois précédent">‹</a><b style="flex:1;text-align:center">${e(CAP(monthLabel(month)))}${lock ? ' 🔒' : ''}</b><a class="btn" href="#/planning/hours/${next}" aria-label="Mois suivant">›</a>
      ${month !== cur ? `<a class="btn" href="#/planning/hours/${cur}">Ce mois</a>` : ''}<button class="btn primary" id="rprint" ${R.rows.length ? '' : 'disabled'}>🖨 Imprimer pour le comptable</button></div>
    ${lockBar}
    <div class="rcards"><div class="rc"><b>${hm(T.worked)}</b><span>travaillées</span><small>chantiers ${hm(T.site)} · atelier ${hm(T.atelier)}${T.bureau ? ` · bureau ${hm(T.bureau)}` : ''} · déplacements ${hm(T.trajet)}</small></div>
      <div class="rc"><b>${hm(T.absence)}</b><span>congés / absences</span>${T.absence ? `<small>${e(absTxt(T.absByType))}</small>` : ''}</div>
      <div class="rc ${T.over ? 'warn' : ''}"><b>${hm(T.over)}</b><span>au-delà de la base</span><small>${T.short ? `il manque ${hm(T.short)} ailleurs · ` : ''}base ${hm(LIM.weekHours)} / semaine</small></div>
      <div class="rc ${T.missing ? 'warn' : ''}"><b>${T.missing}</b><span>jour(s) à compléter</span><small>prévus au planning, sans heures</small></div></div>
    ${R.rows.length ? `<h3>Synthèse par salarié</h3><div class="wscroll"><table class="rtab sum"><thead><tr><th class="who"></th><th>Chantiers</th><th>Atelier</th>${T.bureau ? '<th>Bureau</th>' : ''}<th>Déplac.</th><th>Travaillé</th><th>Au-delà</th><th>Absences</th><th>À compléter</th></tr></thead><tbody>${sumRows}
      <tr class="gt"><th class="who">Total</th><td class="n">${hm(T.site)}</td><td class="n">${hm(T.atelier)}</td>${T.bureau ? `<td class="n">${hm(T.bureau)}</td>` : ''}<td class="n">${hm(T.trajet)}</td><td class="n"><b>${hm(T.worked)}</b></td><td class="n">${T.over ? '+' + hm(T.over) : ''}</td><td class="n">${hm(T.absence)}</td><td class="n">${T.missing ? T.missing + ' j' : ''}</td></tr></tbody></table></div>` : ''}
    ${counter}
    <h3>Feuille de pointage</h3>${matrix}${R.rows.length ? legend : ''}
    ${R.rows.length ? `<p class="muted">${lock ? 'Mois clôturé : les cases ne sont plus modifiables. ' : 'Touchez un jour pour voir ou corriger les heures (chantier, atelier, bureau, déplacement, congés / absence) ; '}touchez un nom pour le détail du mois. « ? » : jour prévu au planning sans heures saisies. Colonnes grisées : week-end.</p>` : ''}
    ${R.sites.length || T.atelier || T.bureau || T.trajet || T.absence ? `<h3>Où les heures ont été faites</h3><div class="wscroll"><table class="rtab sum"><thead><tr><th class="who" style="text-align:left">Chantier / activité</th><th>Heures</th><th style="text-align:left">Détail par salarié</th></tr></thead><tbody>${share}</tbody></table></div>` : '<p class="muted">Aucune heure saisie pour ce mois.</p>'}`;

  /* défilement conservé quand la page se recharge après une correction */
  const back = saved && saved.month === month ? saved : null; saved = null;
  if (back) { const sc = $('#rscroll', el); if (sc) sc.scrollLeft = back.x; window.requestAnimationFrame(() => window.scrollTo(0, back.y)); }
  const remember = () => { saved = { month, x: $('#rscroll', el)?.scrollLeft || 0, y: window.scrollY || 0 }; };
  const edit = (id, d) => {
    const m = rowOf(id)?.member;
    if (m && canEnter(m, d)) { remember(); openDay(m, d); }
    else if (m && lock) toast('Mois clôturé : rouvrez-le pour corriger les heures.');
  };
  $$('td[data-m]', el).forEach(td => td.onclick = () => edit(td.dataset.m, td.dataset.d));
  $$('[data-det]', el).forEach(b => b.onclick = () => memberDetail(R, rowOf(b.dataset.det), { S, canEnter, edit }));
  const pb = $('#rprint', el); if (pb) pb.onclick = () => printModal(R, { S, lock, canClose, closeMonth });
  const cb = $('#rclose', el); if (cb) cb.onclick = () => closeMonth(month, R);
  const ob = $('#ropen', el); if (ob) ob.onclick = () => reopenMonth(month);
}

/* Détail d'un salarié : jour par jour, avec sous-totaux par semaine ; un jour se corrige d'un clic */
function memberDetail(R, r, { S, canEnter, edit }) {
  const m = r.member;
  const rows = r.weeks.map(w => {
    const items = w.days.map(d => r.days[d]).filter(showDay).map(x => {
      const state = x.lines.length ? `<span class="chip ${x.worked ? 'ok' : 'warn'}">${[x.worked ? hm(x.worked) : '', x.absence ? 'abs ' + hm(x.absence) : ''].filter(Boolean).join(' · ')}</span>` : x.missing ? '<span class="chip bad">non saisi</span>' : '<span class="chip">—</span>';
      const txt = x.lines.length ? x.lines.map(l => e(lineTxt(l, S))).join('<br>') : x.planned.length ? 'Prévu : ' + x.planned.map(t => `${e(S[t.siteId]?.name || '')} ${hm(t.hours)}`).join(' · ') : 'Rien';
      return `<div class="item tday ${canEnter(m, x.date) ? '' : 'ro'}" data-d="${x.date}"><div class="main"><div class="t">${dayName(x.date)}</div><div class="s">${txt}</div></div><div class="r">${state}</div></div>`;
    }).join('');
    const note = weekNote(r.counter.weeks.find(c => c.monday === w.monday), r.counter.base);
    return `<div class="rwk">Semaine ${w.number} <span>${hm(w.worked)} travaillées${w.absence ? ' · abs ' + hm(w.absence) : ''}${note ? ' · <b>' + e(note) + '</b>' : ''}</span></div>${items}`;
  }).join('');
  const d = modal(`${m.name} · ${monthLabel(R.month)}`,
    `<p class="muted" style="margin-top:0"><b>${hm(r.worked)}</b> travaillées (chantiers ${hm(r.siteTotal)} · atelier ${hm(r.atelier)}${r.bureau ? ` · bureau ${hm(r.bureau)}` : ''} · déplacements ${hm(r.trajet)})${r.absence ? ` · <b>${hm(r.absence)}</b> d'absence (${e(absTxt(r.absByType))})` : ''}${r.counter.over ? ` · <b>${hm(r.counter.over)}</b> au-delà de ${hm(r.counter.base)} par semaine` : ''}${r.missing ? ` · <span style="color:var(--warn)">${r.missing} jour(s) à compléter</span>` : ''}</p>${rows}
    ${r.legacy ? `<p class="muted">Dont ${hm(r.legacy)} saisies à l'ancienne (total sur l'affectation, sans détail par jour).</p>` : ''}`, null, { wide: true });
  d.querySelector('.mbody').onclick = ev => { const n = ev.target.closest('.tday'); if (n && canEnter(m, n.dataset.d)) edit(m.id, n.dataset.d); };
}

/* ======================= Impression pour le comptable ======================= */
function printModal(R, { S, lock, canClose, closeMonth }) {
  modal('Imprimer le récapitulatif', `<p class="muted" style="margin-top:0">Document pour le comptable : ${e(monthLabel(R.month))}, heures travaillées et absences de chaque salarié.</p>
    ${F('Salarié', 'who', '', { type: 'select', options: [['', 'Toute l\'équipe'], ...R.rows.map(r => [r.member.id, r.member.name])] })}
    ${F('Écriture des heures', 'fmt', 'hm', { type: 'select', options: [['hm', 'Heures et minutes : 7 h 30'], ['dec', 'Décimal : 7,5']] })}
    <label class="f full"><span><input type="checkbox" name="counter" checked> Compteur hebdomadaire (heures au-delà de la base de la semaine)</span></label>
    <label class="f full"><span><input type="checkbox" name="sites" checked> Répartition par chantier (où les heures ont été faites)</span></label>
    <label class="f full"><span><input type="checkbox" name="detail" checked> Détail jour par jour de chaque salarié (une page par salarié)</span></label>
    ${canClose && !lock ? '<label class="f full"><span><input type="checkbox" name="lock"> Clôturer le mois après l\'impression (plus aucune heure ne pourra être modifiée sans le rouvrir)</span></label>' : ''}`,
    async (o) => {
      const S0 = await getS();
      const html = recapPrintHtml(R, { company: S0.company, S, who: o.who || '', sites: !!o.sites, detail: !!o.detail, counter: !!o.counter, fmt: o.fmt || 'hm', printedOn: today(), closedAt: lock ? lock.at : '' });
      $('#printarea').innerHTML = html;
      setTimeout(async () => { window.print(); if (o.lock && canClose && closeMonth) await closeMonth(R.month, R, { confirmed: true }); }, 60);
    }, { submitLabel: '🖨 Imprimer' });
}

/* HTML imprimable (feuille A4). Pur : testable hors navigateur.
   opts : { company, S, who, sites, detail, counter, fmt ('hm' = 7 h 30 · 'dec' = 7,5), printedOn, closedAt } */
export function recapPrintHtml(R, { company = '', S = {}, who = '', sites = true, detail = true, counter = true, fmt = 'hm', printedOn = '', closedAt = '' } = {}) {
  const f = fmt === 'dec' ? v => H.fmtH(v) : v => H.fmtHM(v); // dans les tableaux, décimal sans unité (les colonnes sont en heures)
  const fu = fmt === 'dec' ? v => H.fmtH(v) + ' h' : v => H.fmtHM(v); // dans une phrase : toujours avec l'unité
  const rows = who ? R.rows.filter(r => r.member.id === who) : R.rows;
  const T = sumOf(rows);
  const anyMissing = T.missing > 0, anyOver = T.over > 0;
  const dash = v => (v ? f(v) : '—');
  const absCols = (() => { const ids = H.ABS_TYPES.map(t => t[0]); for (const t of Object.keys(T.absByType || {})) if (t && !ids.includes(t)) ids.push(t); if (!ids.includes('autre')) ids.push('autre'); return ids; })(); // une colonne par type d'absence proposé (et par type masqué qui a servi ce mois-ci)
  const absHead = t => (t === 'autre' && H.ABS_LABEL.autre === 'Autre absence' ? 'Autres absences' : t === 'cp' && H.ABS_LABEL.cp === 'Congé payé' ? 'Congés payés' : H.ABS_LABEL[t] || t); // en-têtes d'origine tant que les libellés ne sont pas renommés
  const ab = (r, t) => (t === 'autre' ? H.round2((r.absByType.autre || 0) + (r.absByType[''] || 0)) : r.absByType[t] || 0);
  const summary = `<h2>Synthèse du mois</h2><table><thead><tr><th style="text-align:left">Salarié</th><th class="n">Chantiers</th><th class="n">Atelier</th>${T.bureau ? '<th class="n">Bureau</th>' : ''}<th class="n">Déplacements</th><th class="n">Total travaillé</th>${anyOver ? '<th class="n">Dont au-delà de la base</th>' : ''}${absCols.map(t => `<th class="n">${e(absHead(t))}</th>`).join('')}${anyMissing ? '<th class="n">Jours non saisis</th>' : ''}</tr></thead><tbody>
    ${rows.map(r => `<tr><td>${e(r.member.name)}</td><td class="n">${dash(r.siteTotal)}</td><td class="n">${dash(r.atelier)}</td>${T.bureau ? `<td class="n">${dash(r.bureau)}</td>` : ''}<td class="n">${dash(r.trajet)}</td><td class="n"><b>${f(r.worked)}</b></td>${anyOver ? `<td class="n">${dash(r.counter.over)}</td>` : ''}${absCols.map(t => `<td class="n">${dash(ab(r, t))}</td>`).join('')}${anyMissing ? `<td class="n">${r.missing || '—'}</td>` : ''}</tr>`).join('')}
    <tr class="t"><td>Total${who ? '' : ' équipe'}</td><td class="n">${dash(T.site)}</td><td class="n">${dash(T.atelier)}</td>${T.bureau ? `<td class="n">${dash(T.bureau)}</td>` : ''}<td class="n">${dash(T.trajet)}</td><td class="n">${f(T.worked)}</td>${anyOver ? `<td class="n">${dash(T.over)}</td>` : ''}${absCols.map(t => `<td class="n">${dash(rows.reduce((a, r) => a + ab(r, t), 0))}</td>`).join('')}${anyMissing ? `<td class="n">${T.missing}</td>` : ''}</tr></tbody></table>
    <p class="small">${fmt === 'dec' ? 'Heures en décimal (7,5 = 7 h 30).' : 'Heures et minutes (7 h 30 = 7,5 h).'} Heures travaillées = chantiers + atelier + bureau + déplacements / approvisionnement ; les congés et absences sont comptés à part.</p>`;

  /* compteur hebdomadaire : une ligne par salarié, une colonne par semaine (semaine comptée dans le mois où elle se termine) */
  const wk = rows[0] && rows[0].counter.weeks;
  const ctr = counter && wk ? `<h2>Compteur hebdomadaire</h2><table><thead><tr><th style="text-align:left">Salarié (base)</th>${wk.map(w => `<th class="n">S${w.number}<br><span class="small">${dShort(w.monday)}–${dShort(w.sunday)}</span></th>`).join('')}<th class="n">Au-delà de la base</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${e(r.member.name)} <span class="small">(${fu(r.counter.base)} / sem.)</span></td>${r.counter.weeks.map(w => w.late ? '<td class="n small">mois suiv.</td>' : `<td class="n">${w.worked || w.absence ? f(w.worked) + (w.over ? `<br><b>+${f(w.over)}</b>` : '') + (w.absence ? `<br><span class="small">abs ${f(w.absence)}</span>` : '') : '—'}</td>`).join('')}<td class="n"><b>${dash(r.counter.over)}</b></td></tr>`).join('')}</tbody></table>
    <p class="small">Une semaine (lundi → dimanche) est comptée dans le mois où elle se termine. « + » : heures travaillées au-delà de la base hebdomadaire du salarié ; les absences ne sont pas des heures travaillées. Seules les heures saisies jour par jour sont comptées.</p>` : '';

  /* où : par chantier (pour les salariés choisis) */
  const ids = new Set(rows.map(r => r.member.id));
  const nameOf = id => R.rows.find(r => r.member.id === id)?.member.name || '?';
  const share = list => Object.entries(list).filter(([id]) => ids.has(id)).sort((a, b) => b[1] - a[1]).map(([id, v]) => `${e(nameOf(id))} ${fu(v)}`).join(' · ');
  const tot = list => H.round2(Object.entries(list).filter(([id]) => ids.has(id)).reduce((a, [, v]) => a + v, 0));
  const place = sites ? (() => {
    const lines = R.sites.map(s => [s.name, tot(s.byMember), share(s.byMember), false]).concat(['atelier', 'bureau', 'trajet', 'absence'].map(k => [H.KIND_LABEL[k], tot(R.kinds[k].byMember || {}), share(R.kinds[k].byMember || {}), true])).filter(l => l[1] > 0);
    return lines.length ? `<h2>Répartition par chantier et activité</h2><table><thead><tr><th style="text-align:left">Chantier / activité</th><th class="n">Heures</th><th style="text-align:left">Détail par salarié</th></tr></thead><tbody>${lines.map(([n, t, d, k]) => `<tr${k ? ' class="opt"' : ''}><td>${e(n)}</td><td class="n"><b>${f(t)}</b></td><td class="small">${d}</td></tr>`).join('')}</tbody></table>` : '';
  })() : '';

  /* détail jour par jour : une page par salarié */
  const lineP = x => (x.kind === 'site' ? (S[x.siteId]?.name || 'Chantier supprimé') : x.kind === 'absence' && H.ABS_LABEL[x.absType] ? 'Absence · ' + H.ABS_LABEL[x.absType] : H.KIND_LABEL[x.kind]) + ' ' + fu(x.hours) + (x.note ? ' — ' + x.note : '');
  const det = detail ? rows.map(r => {
    const body = r.weeks.map(w => {
      const shown = w.days.map(d => r.days[d]).filter(x => showDay(x) && !(printedOn && x.date > printedOn && !x.lines.length)); // jours à venir sans saisie : omis (impression en cours de mois)
      if (!shown.length) return '';
      const days = shown.map(x => {
        const act = x.lines.length ? x.lines.map(l => e(lineP(l))).join('<br>') : x.missing ? '<i>non saisi (prévu au planning)</i>' : '<span class="small">—</span>';
        return `<tr><td style="white-space:nowrap">${dayName(x.date)}</td><td>${act}</td><td class="n">${x.worked ? f(x.worked) : ''}</td><td class="n">${x.absence ? f(x.absence) : ''}</td></tr>`;
      }).join('');
      const cw = r.counter.weeks.find(c => c.monday === w.monday), note = weekNote(cw, r.counter.base, fu);
      return `${days}<tr class="subt"><td colspan="2">Semaine ${w.number}${note ? ` — ${e(note)}` : ''}${cw && cw.counted && cw.early ? ` <span class="small">(semaine entière : ${fu(cw.worked)})</span>` : ''}</td><td class="n">${f(w.worked)}</td><td class="n">${w.absence ? f(w.absence) : ''}</td></tr>`;
    }).join('');
    return `<div class="pb"><h2>${e(r.member.name)} — ${e(monthLabel(R.month))}</h2><table><thead><tr><th style="text-align:left;width:22mm">Date</th><th style="text-align:left">Activité / chantier</th><th class="n" style="width:22mm">Travaillé${fmt === 'dec' ? ' (h)' : ''}</th><th class="n" style="width:22mm">Absence${fmt === 'dec' ? ' (h)' : ''}</th></tr></thead><tbody>${body}
      <tr class="t"><td colspan="2">Total du mois</td><td class="n">${f(r.worked)}</td><td class="n">${r.absence ? f(r.absence) : ''}</td></tr></tbody></table>
      <p class="small">Dont chantiers ${fu(r.siteTotal)} · atelier ${fu(r.atelier)}${r.bureau ? ` · bureau ${fu(r.bureau)}` : ''} · déplacements / approvisionnement ${fu(r.trajet)}${r.legacy ? ` (dont ${fu(r.legacy)} saisies à l'ancienne, sans détail par jour)` : ''}.${r.absence ? ` Absences : ${e(absTxt(r.absByType, fu))}.` : ''}${r.counter.over ? ` Au-delà de ${fu(r.counter.base)} par semaine : ${fu(r.counter.over)}.` : ''}${r.missing ? ` Jours prévus au planning sans heures saisies : ${r.missingDays.map(dShort).join(', ')}.` : ''}</p></div>`;
  }).join('') : '';

  return `<div class="sheet rcp"><div class="hd"><div class="co"><div class="nm">${e(company)}</div></div><div style="text-align:right"><h1 style="margin:0;text-align:right">Récapitulatif mensuel des heures</h1><div style="font-size:15px"><b>${e(CAP(monthLabel(R.month)))}</b></div>${printedOn ? `<div class="small">Édité le ${dFr(printedOn)}</div>` : ''}${closedAt ? `<div class="small">Mois clôturé le ${e(atTxt(closedAt))}</div>` : ''}</div></div>
    ${rows.length ? summary + ctr + place : '<p>Aucune donnée pour ce mois.</p>'}
    <div class="sig"><div>Établi par :<div class="sph"></div></div><div>Vérifié par le gérant (nom, date, signature) :<div class="sph"></div></div></div>
    ${det}</div>`;
}
