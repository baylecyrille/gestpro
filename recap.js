// Récapitulatif mensuel des heures (Planning › Heures) : feuille de pointage de toute l'équipe, modifiable jour par jour,
// répartition par chantier, et impression pour le comptable. Les calculs sont dans hours.js (monthRecap).
import { e, today, modal, F, $, $$ } from './util.js';
import * as H from './hours.js';
import { getS } from './defaults.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const CAP = s => s.charAt(0).toUpperCase() + s.slice(1);
export const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return `${MOIS[mo - 1]} ${y}`; };
const dFr = d => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`; // indépendant du fuseau horaire
const dShort = d => `${d.slice(8)}/${d.slice(5, 7)}`;
const dowIdx = d => { const [y, m, dd] = d.split('-').map(Number); return (new Date(y, m - 1, dd).getDay() + 6) % 7; };
const dayName = d => `${JOURS[dowIdx(d)]} ${dShort(d)}`;
const h = v => H.fmtH(v);
const KCOL = { atelier: '#8a94a6', trajet: '#7b4fd0', absence: '#c77700' };

/* Texte d'une saisie : « Chantier Dupont 4 h — pose des fenêtres » */
export const lineTxt = (x, S) => `${x.kind === 'site' ? (S[x.siteId]?.name || 'Chantier supprimé') : H.KIND_LABEL[x.kind]} ${h(x.hours)} h${x.note ? ' — ' + x.note : ''}`;
const dotColor = (x, S) => (x.kind === 'site' ? S[x.siteId]?.color || '#2f7ad6' : KCOL[x.kind]);

/* Ce qu'il faut afficher pour un jour dans une liste : ordre des lignes, jours vides, week-ends sans saisie masqués */
const showDay = d => !d.weekend || d.lines.length > 0;

/* ======================= Écran ======================= */
let saved = null; // position de défilement conservée après la correction d'un jour (la page se recharge)

export function renderRecap(el, ctx) {
  const { head, month, members, sites, tasks, times, canEnter, openDay } = ctx;
  const S = Object.fromEntries(sites.map(s => [s.id, s]));
  const R = H.monthRecap({ month, members, sites, tasks, times, today: today() });
  const T = R.totals, prev = H.shiftMonth(month, -1), next = H.shiftMonth(month, 1), cur = today().slice(0, 7);
  const rowOf = id => R.rows.find(r => r.member.id === id);

  /* feuille de pointage : un salarié par ligne, un jour par colonne */
  const cell = (r, d) => {
    const x = r.days[d], on = canEnter(r.member, d);
    const parts = [];
    if (x.worked) parts.push(`<b>${h(x.worked)}</b>`);
    if (x.absence) parts.push(`<span class="rabs">abs ${h(x.absence)}</span>`);
    const dots = x.lines.map(l => `<i style="background:${e(dotColor(l, S))}"></i>`).join('');
    const tip = x.lines.length ? x.lines.map(l => lineTxt(l, S)).join('\n') : x.missing ? 'Prévu au planning, heures non saisies' : '';
    return `<td data-m="${r.member.id}" data-d="${d}" class="${x.weekend ? 'we' : ''} ${x.missing ? 'miss' : ''} ${d === today() ? 'tdy' : ''} ${on ? 'ed' : ''}" ${tip ? `title="${e(tip)}"` : ''}>${parts.join('') || (x.missing ? '<span class="rq">?</span>' : '')}${dots ? `<span class="rdots">${dots}</span>` : ''}</td>`;
  };
  const matrix = R.rows.length ? `<div class="wscroll" id="rscroll"><table class="rtab"><thead><tr><th class="who"></th>${R.days.map(d => `<th class="${dowIdx(d) > 4 ? 'we' : ''} ${d === today() ? 'tdy' : ''}">${JOURS[dowIdx(d)][0]}<br>${+d.slice(8)}</th>`).join('')}<th class="tot">Total</th><th class="tot">Abs.</th></tr></thead><tbody>
      ${R.rows.map(r => `<tr><th class="who"><button type="button" class="rname" data-det="${r.member.id}">${e(r.member.name)}</button></th>${R.days.map(d => cell(r, d)).join('')}<td class="tot"><b>${h(r.worked)}</b></td><td class="tot">${r.absence ? h(r.absence) : ''}</td></tr>`).join('')}
      <tr class="gt"><th class="who">Total équipe</th>${R.days.map(d => { const w = H.round2(R.rows.reduce((a, r) => a + r.days[d].worked, 0)); return `<td class="${dowIdx(d) > 4 ? 'we' : ''}">${w ? h(w) : ''}</td>`; }).join('')}<td class="tot"><b>${h(T.worked)}</b></td><td class="tot">${T.absence ? h(T.absence) : ''}</td></tr>
    </tbody></table></div>` : '<div class="empty">Aucun membre actif à afficher. <a href="#/planning/team">Ajouter l\'équipe</a></div>';

  /* légende : couleurs des chantiers du mois + activités */
  const legend = `<div class="rleg">${R.sites.map(s => `<span><i style="background:${e(s.color || '#2f7ad6')}"></i>${e(s.name)}</span>`).join('')}${['atelier', 'trajet', 'absence'].filter(k => R.kinds[k].total).map(k => `<span><i style="background:${KCOL[k]}"></i>${e(H.KIND_LABEL[k])}</span>`).join('')}</div>`;

  const sumRows = R.rows.map(r => `<tr><th class="who"><button type="button" class="rname" data-det="${r.member.id}">${e(r.member.name)}</button></th><td class="n">${h(r.siteTotal)}</td><td class="n">${h(r.atelier)}</td><td class="n">${h(r.trajet)}</td><td class="n"><b>${h(r.worked)}</b></td><td class="n">${h(r.absence)}</td><td class="n">${r.missing ? `<span class="chip warn" title="Jours prévus au planning sans heures saisies">${r.missing} j</span>` : '<span class="muted">—</span>'}</td></tr>`).join('');

  const share = R.sites.map(s => `<tr><td><i class="rdot" style="background:${e(s.color || '#2f7ad6')}"></i>${e(s.name)}</td><td class="n"><b>${h(s.total)}</b></td><td class="rwho">${Object.entries(s.byMember).sort((a, b) => b[1] - a[1]).map(([id, v]) => `<span class="chip">${e(rowOf(id)?.member.name || '?')} ${h(v)} h</span>`).join('')}</td></tr>`).join('')
    + ['atelier', 'trajet', 'absence'].filter(k => R.kinds[k].total).map(k => `<tr class="rk"><td><i class="rdot" style="background:${KCOL[k]}"></i>${e(H.KIND_LABEL[k])}</td><td class="n"><b>${h(R.kinds[k].total)}</b></td><td class="rwho">${Object.entries(R.kinds[k].byMember).sort((a, b) => b[1] - a[1]).map(([id, v]) => `<span class="chip ${k === 'absence' ? 'warn' : ''}">${e(rowOf(id)?.member.name || '?')} ${h(v)} h</span>`).join('')}</td></tr>`).join('');

  el.classList.add('wide'); // pleine largeur sur grand écran : 31 jours côte à côte
  el.innerHTML = `${head}
    <div class="row"><a class="btn" href="#/planning/hours/${prev}" aria-label="Mois précédent">‹</a><b style="flex:1;text-align:center">${e(CAP(monthLabel(month)))}</b><a class="btn" href="#/planning/hours/${next}" aria-label="Mois suivant">›</a>
      ${month !== cur ? `<a class="btn" href="#/planning/hours/${cur}">Ce mois</a>` : ''}<button class="btn primary" id="rprint" ${R.rows.length ? '' : 'disabled'}>🖨 Imprimer pour le comptable</button></div>
    <div class="rcards"><div class="rc"><b>${h(T.worked)} h</b><span>travaillées</span><small>chantiers ${h(T.site)} · atelier ${h(T.atelier)} · déplacements ${h(T.trajet)}</small></div>
      <div class="rc"><b>${h(T.absence)} h</b><span>congés / absences</span></div>
      <div class="rc ${T.missing ? 'warn' : ''}"><b>${T.missing}</b><span>jour(s) à compléter</span><small>prévus au planning, sans heures</small></div></div>
    ${R.rows.length ? `<h3>Synthèse par salarié</h3><div class="wscroll"><table class="rtab sum"><thead><tr><th class="who"></th><th>Chantiers</th><th>Atelier</th><th>Déplac.</th><th>Travaillé</th><th>Absences</th><th>À compléter</th></tr></thead><tbody>${sumRows}
      <tr class="gt"><th class="who">Total</th><td class="n">${h(T.site)}</td><td class="n">${h(T.atelier)}</td><td class="n">${h(T.trajet)}</td><td class="n"><b>${h(T.worked)}</b></td><td class="n">${h(T.absence)}</td><td class="n">${T.missing ? T.missing + ' j' : ''}</td></tr></tbody></table></div>` : ''}
    <h3>Feuille de pointage</h3>${matrix}${R.rows.length ? legend : ''}
    ${R.rows.length ? `<p class="muted">Touchez un jour pour voir ou corriger les heures (chantier, atelier, déplacement, congés / absence) ; touchez un nom pour le détail du mois. « ? » : jour prévu au planning sans heures saisies. Colonnes grisées : week-end.</p>` : ''}
    ${R.sites.length || T.atelier || T.trajet || T.absence ? `<h3>Où les heures ont été faites</h3><div class="wscroll"><table class="rtab sum"><thead><tr><th class="who" style="text-align:left">Chantier / activité</th><th>Heures</th><th style="text-align:left">Détail par salarié</th></tr></thead><tbody>${share}</tbody></table></div>` : '<p class="muted">Aucune heure saisie pour ce mois.</p>'}`;

  /* défilement conservé quand la page se recharge après une correction */
  const back = saved && saved.month === month ? saved : null; saved = null;
  if (back) { const sc = $('#rscroll', el); if (sc) sc.scrollLeft = back.x; window.requestAnimationFrame(() => window.scrollTo(0, back.y)); }
  const remember = () => { saved = { month, x: $('#rscroll', el)?.scrollLeft || 0, y: window.scrollY || 0 }; };
  const edit = (id, d) => { const m = rowOf(id)?.member; if (m && canEnter(m, d)) { remember(); openDay(m, d); } };
  $$('td[data-m]', el).forEach(td => td.onclick = () => edit(td.dataset.m, td.dataset.d));
  $$('[data-det]', el).forEach(b => b.onclick = () => memberDetail(R, rowOf(b.dataset.det), { S, canEnter, edit }));
  const pb = $('#rprint', el); if (pb) pb.onclick = () => printModal(R, { S });
}

/* Détail d'un salarié : jour par jour, avec sous-totaux par semaine ; un jour se corrige d'un clic */
function memberDetail(R, r, { S, canEnter, edit }) {
  const m = r.member;
  const rows = r.weeks.map(w => {
    const items = w.days.map(d => r.days[d]).filter(showDay).map(x => {
      const state = x.lines.length ? `<span class="chip ${x.worked ? 'ok' : 'warn'}">${[x.worked ? h(x.worked) + ' h' : '', x.absence ? 'abs ' + h(x.absence) + ' h' : ''].filter(Boolean).join(' · ')}</span>` : x.missing ? '<span class="chip bad">non saisi</span>' : '<span class="chip">—</span>';
      const txt = x.lines.length ? x.lines.map(l => e(lineTxt(l, S))).join('<br>') : x.planned.length ? 'Prévu : ' + x.planned.map(t => `${e(S[t.siteId]?.name || '')} ${h(t.hours)} h`).join(' · ') : 'Rien';
      return `<div class="item tday ${canEnter(m, x.date) ? '' : 'ro'}" data-d="${x.date}"><div class="main"><div class="t">${dayName(x.date)}</div><div class="s">${txt}</div></div><div class="r">${state}</div></div>`;
    }).join('');
    return `<div class="rwk">Semaine ${w.number} <span>${h(w.worked)} h travaillées${w.absence ? ' · abs ' + h(w.absence) + ' h' : ''}</span></div>${items}`;
  }).join('');
  const d = modal(`${m.name} · ${monthLabel(R.month)}`,
    `<p class="muted" style="margin-top:0"><b>${h(r.worked)} h</b> travaillées (chantiers ${h(r.siteTotal)} · atelier ${h(r.atelier)} · déplacements ${h(r.trajet)})${r.absence ? ` · <b>${h(r.absence)} h</b> d'absence` : ''}${r.missing ? ` · <span style="color:var(--warn)">${r.missing} jour(s) à compléter</span>` : ''}</p>${rows}
    ${r.legacy ? `<p class="muted">Dont ${h(r.legacy)} h saisies à l'ancienne (total sur l'affectation, sans détail par jour).</p>` : ''}`, null, { wide: true });
  d.querySelector('.mbody').onclick = ev => { const n = ev.target.closest('.tday'); if (n && canEnter(m, n.dataset.d)) edit(m.id, n.dataset.d); };
}

/* ======================= Impression pour le comptable ======================= */
function printModal(R, { S }) {
  modal('Imprimer le récapitulatif', `<p class="muted" style="margin-top:0">Document pour le comptable : ${e(monthLabel(R.month))}, heures travaillées et absences de chaque salarié.</p>
    ${F('Salarié', 'who', '', { type: 'select', options: [['', 'Toute l\'équipe'], ...R.rows.map(r => [r.member.id, r.member.name])] })}
    <label class="f full"><span><input type="checkbox" name="sites" checked> Répartition par chantier (où les heures ont été faites)</span></label>
    <label class="f full"><span><input type="checkbox" name="detail" checked> Détail jour par jour de chaque salarié (une page par salarié)</span></label>`,
    async (o) => {
      const S0 = await getS();
      const html = recapPrintHtml(R, { company: S0.company, S, who: o.who || '', sites: !!o.sites, detail: !!o.detail, printedOn: today() });
      $('#printarea').innerHTML = html;
      setTimeout(() => window.print(), 60);
    }, { submitLabel: '🖨 Imprimer' });
}

/* HTML imprimable (feuille A4). Pur : testable hors navigateur. opts : { company, S, who, sites, detail, printedOn } */
export function recapPrintHtml(R, { company = '', S = {}, who = '', sites = true, detail = true, printedOn = '' } = {}) {
  const rows = who ? R.rows.filter(r => r.member.id === who) : R.rows;
  const T = who ? { worked: 0, site: 0, atelier: 0, trajet: 0, absence: 0, missing: 0 } : R.totals;
  if (who) rows.forEach(r => { T.worked = H.round2(T.worked + r.worked); T.site = H.round2(T.site + r.siteTotal); T.atelier = H.round2(T.atelier + r.atelier); T.trajet = H.round2(T.trajet + r.trajet); T.absence = H.round2(T.absence + r.absence); T.missing += r.missing; });
  const anyMissing = T.missing > 0;
  const dash = v => (v ? h(v) : '—');
  const summary = `<h2>Synthèse du mois</h2><table><thead><tr><th style="text-align:left">Salarié</th><th class="n">Chantiers</th><th class="n">Atelier</th><th class="n">Déplacements</th><th class="n">Total travaillé</th><th class="n">Congés / absences</th>${anyMissing ? '<th class="n">Jours non saisis</th>' : ''}</tr></thead><tbody>
    ${rows.map(r => `<tr><td>${e(r.member.name)}</td><td class="n">${dash(r.siteTotal)}</td><td class="n">${dash(r.atelier)}</td><td class="n">${dash(r.trajet)}</td><td class="n"><b>${h(r.worked)}</b></td><td class="n">${dash(r.absence)}</td>${anyMissing ? `<td class="n">${r.missing || '—'}</td>` : ''}</tr>`).join('')}
    <tr class="t"><td>Total${who ? '' : ' équipe'}</td><td class="n">${dash(T.site)}</td><td class="n">${dash(T.atelier)}</td><td class="n">${dash(T.trajet)}</td><td class="n">${h(T.worked)}</td><td class="n">${dash(T.absence)}</td>${anyMissing ? `<td class="n">${T.missing}</td>` : ''}</tr></tbody></table>
    <p class="small">Heures en décimal (7,5 = 7 h 30). Heures travaillées = chantiers + atelier + déplacements / approvisionnement ; les congés et absences sont comptés à part.</p>`;

  /* où : par chantier (pour les salariés choisis) */
  const ids = new Set(rows.map(r => r.member.id));
  const nameOf = id => R.rows.find(r => r.member.id === id)?.member.name || '?';
  const share = list => Object.entries(list).filter(([id]) => ids.has(id)).sort((a, b) => b[1] - a[1]).map(([id, v]) => `${e(nameOf(id))} ${h(v)} h`).join(' · ');
  const tot = list => H.round2(Object.entries(list).filter(([id]) => ids.has(id)).reduce((a, [, v]) => a + v, 0));
  const place = sites ? (() => {
    const lines = R.sites.map(s => [s.name, tot(s.byMember), share(s.byMember), false]).concat(['atelier', 'trajet', 'absence'].map(k => [H.KIND_LABEL[k], tot(R.kinds[k].byMember || {}), share(R.kinds[k].byMember || {}), true])).filter(l => l[1] > 0);
    return lines.length ? `<h2>Répartition par chantier et activité</h2><table><thead><tr><th style="text-align:left">Chantier / activité</th><th class="n">Heures</th><th style="text-align:left">Détail par salarié</th></tr></thead><tbody>${lines.map(([n, t, d, k]) => `<tr${k ? ' class="opt"' : ''}><td>${e(n)}</td><td class="n"><b>${h(t)}</b></td><td class="small">${d}</td></tr>`).join('')}</tbody></table>` : '';
  })() : '';

  /* détail jour par jour : une page par salarié */
  const det = detail ? rows.map(r => {
    const body = r.weeks.map(w => {
      const shown = w.days.map(d => r.days[d]).filter(x => showDay(x) && !(printedOn && x.date > printedOn && !x.lines.length)); // jours à venir sans saisie : omis (impression en cours de mois)
      if (!shown.length) return '';
      const days = shown.map(x => {
        const act = x.lines.length ? x.lines.map(l => e(lineTxt(l, S))).join('<br>') : x.missing ? '<i>non saisi (prévu au planning)</i>' : '<span class="small">—</span>';
        return `<tr><td style="white-space:nowrap">${dayName(x.date)}</td><td>${act}</td><td class="n">${x.worked ? h(x.worked) : ''}</td><td class="n">${x.absence ? h(x.absence) : ''}</td></tr>`;
      }).join('');
      return `${days}<tr class="subt"><td colspan="2">Semaine ${w.number}</td><td class="n">${h(w.worked)}</td><td class="n">${w.absence ? h(w.absence) : ''}</td></tr>`;
    }).join('');
    return `<div class="pb"><h2>${e(r.member.name)} — ${e(monthLabel(R.month))}</h2><table><thead><tr><th style="text-align:left;width:22mm">Date</th><th style="text-align:left">Activité / chantier</th><th class="n" style="width:20mm">Travaillé (h)</th><th class="n" style="width:20mm">Absence (h)</th></tr></thead><tbody>${body}
      <tr class="t"><td colspan="2">Total du mois</td><td class="n">${h(r.worked)}</td><td class="n">${r.absence ? h(r.absence) : ''}</td></tr></tbody></table>
      <p class="small">Dont chantiers ${h(r.siteTotal)} h · atelier ${h(r.atelier)} h · déplacements / approvisionnement ${h(r.trajet)} h${r.legacy ? ` (dont ${h(r.legacy)} h saisies à l'ancienne, sans détail par jour)` : ''}.${r.missing ? ` Jours prévus au planning sans heures saisies : ${r.missingDays.map(dShort).join(', ')}.` : ''}</p></div>`;
  }).join('') : '';

  return `<div class="sheet rcp"><div class="hd"><div class="co"><div class="nm">${e(company)}</div></div><div style="text-align:right"><h1 style="margin:0;text-align:right">Récapitulatif mensuel des heures</h1><div style="font-size:15px"><b>${e(CAP(monthLabel(R.month)))}</b></div>${printedOn ? `<div class="small">Édité le ${dFr(printedOn)}</div>` : ''}</div></div>
    ${rows.length ? summary + place : '<p>Aucune donnée pour ce mois.</p>'}
    <div class="sig"><div>Établi par :<div class="sph"></div></div><div>Vérifié par le gérant (nom, date, signature) :<div class="sph"></div></div></div>
    ${det}</div>`;
}
