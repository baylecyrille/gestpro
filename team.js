// Équipe (membres, habilitations) et planning : affectation de membres à des chantiers avec heures prévues / réalisées.
import * as db from './db.js';
import { e, num, round2, dateFr, today, F, modal, toast, tabs, refresh, go, $, $$ } from './util.js';

export const ROLES = [['gerant', 'Gérant'], ['chef', 'Chef de chantier'], ['ouvrier', 'Ouvrier'], ['apprenti', 'Apprenti'], ['soustraitant', 'Sous-traitant'], ['autre', 'Autre']];
const ROLE = Object.fromEntries(ROLES);
const HABS = ['SST (secouriste)', 'Travail en hauteur', 'Habilitation électrique', 'CACES nacelle', 'CACES chariot', 'Échafaudage (montage)', 'Amiante SS4', 'Permis B', 'Permis poids lourd'];
const COLORS = ['#2f7ad6', '#1b8a4b', '#c77700', '#c62f2f', '#7b4fd0', '#0f9aa8', '#d6479b', '#555d6b'];
const DAY_MAX = 8; // heures/jour au-delà desquelles un conflit est signalé

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const monday = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* L'affectation couvre-t-elle ce jour ? (week-ends exclus sauf option) */
export function covers(a, day) {
  if (!a.start || day < a.start || day > (a.end || a.start)) return false;
  const dow = parse(day).getDay();
  return a.weekend || (dow !== 0 && dow !== 6);
}
export function daysOf(a) {
  const out = []; if (!a.start) return out;
  for (let d = a.start; d <= (a.end || a.start); d = addDays(d, 1)) if (covers(a, d)) out.push(d);
  return out;
}
export const plannedHours = a => round2(daysOf(a).length * num(a.hours));

/* Habilitations : état d'une habilitation selon sa date d'expiration */
export function habState(h) {
  if (!h.expiry) return '';
  if (h.expiry < today()) return 'bad';
  return h.expiry < addDays(today(), 60) ? 'warn' : '';
}

/* Heures d'un chantier, par membre */
export function siteHours(siteId, tasks, members) {
  const M = Object.fromEntries(members.map(m => [m.id, m]));
  const by = {};
  tasks.filter(t => t.siteId === siteId).forEach(t => {
    const r = by[t.memberId] || (by[t.memberId] = { member: M[t.memberId], planned: 0, done: 0, cost: 0 });
    r.planned = round2(r.planned + plannedHours(t)); r.done = round2(r.done + num(t.done));
    r.cost = round2(r.cost + num(t.done) * num(M[t.memberId]?.rate));
  });
  const rows = Object.values(by).filter(r => r.member);
  return { rows, planned: round2(rows.reduce((a, r) => a + r.planned, 0)), done: round2(rows.reduce((a, r) => a + r.done, 0)), cost: round2(rows.reduce((a, r) => a + r.cost, 0)) };
}

const initials = n => (n || '?').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();

/* ---------- Fiche membre ---------- */
export function memberModal(m) {
  const isNew = !m; m = m || { name: '', role: 'ouvrier', phone: '', email: '', color: COLORS[0], rate: '', habs: [], active: true, note: '' };
  const habRow = h => `<div class="row hab" style="margin-bottom:6px"><input list="habl" data-h="label" value="${e(h.label || '')}" placeholder="Habilitation" style="flex:2;min-width:140px"><input type="date" data-h="expiry" value="${e(h.expiry || '')}" title="Date d'expiration" style="flex:1;min-width:130px"><button type="button" class="btn sm" data-rmh>✕</button></div>`;
  modal(isNew ? 'Nouveau membre' : 'Fiche membre',
    `<div class="cols">${F('Nom et prénom', 'name', m.name, { req: true, cls: 'full' })}
    ${F('Fonction', 'role', m.role, { type: 'select', options: ROLES })}
    <label class="f"><span>Couleur (planning)</span><select name="color">${COLORS.map(c => `<option value="${c}" ${c === m.color ? 'selected' : ''} style="color:${c}">● ${c}</option>`).join('')}</select></label>
    ${F('Téléphone', 'phone', m.phone, { type: 'tel' })}${F('E-mail', 'email', m.email, { type: 'email' })}
    ${F('Coût horaire (€/h) – facultatif', 'rate', m.rate, { type: 'number', step: '0.01' })}
    ${F('Statut', 'active', m.active === false ? '0' : '1', { type: 'select', options: [['1', 'Actif'], ['0', 'Inactif']] })}
    <div class="full"><span class="muted" style="font-size:12px">Habilitations / certificats (avec date d'expiration)</span><div id="habs">${(m.habs || []).map(habRow).join('')}</div>
      <button type="button" class="btn sm" id="addh">+ Habilitation</button><datalist id="habl">${HABS.map(h => `<option value="${e(h)}">`).join('')}</datalist></div>
    ${F('Note', 'note', m.note, { type: 'textarea', rows: 2, cls: 'full' })}</div>`,
    async (o, f) => {
      const habs = $$('.hab', f).map(r => ({ label: $('[data-h=label]', r).value.trim(), expiry: $('[data-h=expiry]', r).value })).filter(h => h.label);
      Object.assign(m, o, { habs, active: o.active !== '0', rate: o.rate === '' ? '' : num(o.rate) });
      await db.put('members', m); toast('Membre enregistré'); refresh();
    },
    {
      del: isNew ? null : async () => {
        const tasks = await db.all('tasks');
        if (tasks.some(t => t.memberId === m.id)) { m.active = false; await db.put('members', m); alert('Ce membre a des affectations : il est passé en « inactif » au lieu d\'être supprimé.'); }
        else await db.del('members', m.id);
        refresh();
      },
      onOpen: f => {
        $('#addh', f).onclick = () => { $('#habs', f).insertAdjacentHTML('beforeend', habRow({})); };
        f.addEventListener('click', ev => ev.target.closest('[data-rmh]')?.closest('.hab').remove());
      }
    });
}

/* ---------- Affectation (membre(s) → chantier, dates, heures) ---------- */
export async function assignModal(t, preset = {}) {
  const [sites, members, tasks] = await Promise.all([db.all('sites'), db.all('members'), db.all('tasks')]);
  const isNew = !t; t = t || { siteId: preset.siteId || '', memberId: preset.memberId || '', start: preset.date || today(), end: preset.date || today(), hours: 7, weekend: false, done: '', note: '' };
  const act = members.filter(m => m.active !== false || m.id === t.memberId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const open = sites.filter(s => !['paid', 'lost'].includes(s.status) || s.id === t.siteId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (!open.length) { toast('Créez d\'abord un chantier'); return go('#/sites'); }
  if (!act.length) { toast('Ajoutez d\'abord un membre'); return go('#/planning/team'); }
  const memberBox = isNew
    ? `<div class="full"><span class="muted" style="font-size:12px">Membres affectés</span><div class="chk">${act.map(m => `<label><input type="checkbox" name="mem" value="${m.id}" ${m.id === t.memberId ? 'checked' : ''}> <span class="dot" style="background:${e(m.color)}"></span> ${e(m.name)} <small class="muted">${e(ROLE[m.role] || '')}</small></label>`).join('')}</div></div>`
    : `<label class="f full"><span>Membre</span><select name="memberId">${act.map(m => `<option value="${m.id}" ${m.id === t.memberId ? 'selected' : ''}>${e(m.name)}</option>`).join('')}</select></label>`;
  modal(isNew ? 'Affecter au chantier' : 'Affectation',
    `<div class="cols"><label class="f full"><span>Chantier</span><select name="siteId">${open.map(s => `<option value="${s.id}" ${s.id === t.siteId ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select></label>
    ${memberBox}
    ${F('Du', 'start', t.start, { type: 'date', req: true })}${F('Au', 'end', t.end || t.start, { type: 'date', req: true })}
    ${F('Heures prévues par jour', 'hours', t.hours, { type: 'number', step: '0.25', req: true })}
    ${F('Heures réalisées (total)', 'done', t.done, { type: 'number', step: '0.25' })}
    <label class="f full"><input type="checkbox" name="weekend" ${t.weekend ? 'checked' : ''}> Inclure samedi et dimanche</label>
    ${F('Tâche / note', 'note', t.note, { cls: 'full', ph: 'ex : pose ossature, finitions…' })}
    <p class="muted full" id="calc"></p></div>`,
    async (o, f) => {
      if (o.end < o.start) { alert('La date de fin est avant la date de début.'); return false; }
      const base = { siteId: o.siteId, start: o.start, end: o.end, hours: num(o.hours), weekend: !!o.weekend, done: o.done === '' ? '' : num(o.done), note: o.note };
      const ids = isNew ? $$('[name=mem]:checked', f).map(i => i.value) : [o.memberId];
      if (!ids.length) { alert('Cochez au moins un membre.'); return false; }
      const warn = [];
      for (const mid of ids) {
        const rec = isNew ? { ...base, memberId: mid } : Object.assign(t, base, { memberId: mid });
        const clash = conflicts(rec, tasks.filter(x => x.id !== rec.id));
        if (clash.length) warn.push(`${members.find(m => m.id === mid)?.name} : plus de ${DAY_MAX} h le ${dateFr(clash[0])}`);
        await db.put('tasks', rec);
      }
      toast(warn.length ? 'Enregistré – ⚠ ' + warn.join(' ; ') : 'Affectation enregistrée'); refresh();
    },
    {
      del: isNew ? null : async () => { await db.del('tasks', t.id); refresh(); },
      onOpen: f => {
        const calc = () => {
          const a = { start: $('[name=start]', f).value, end: $('[name=end]', f).value, hours: $('[name=hours]', f).value, weekend: $('[name=weekend]', f).checked };
          const n = daysOf(a).length; $('#calc', f).textContent = n ? `${n} jour(s) travaillé(s) · ${plannedHours(a)} h prévues par membre` : '';
        };
        f.addEventListener('input', calc); calc();
      }
    });
}

/* jours où le total d'heures d'un membre dépasse la limite */
function conflicts(rec, others) {
  const mine = others.filter(x => x.memberId === rec.memberId);
  return daysOf(rec).filter(d => round2(num(rec.hours) + mine.filter(x => covers(x, d)).reduce((a, x) => a + num(x.hours), 0)) > DAY_MAX);
}

/* ---------- Page Planning (semaine / mois / équipe) ---------- */
export async function renderPlanning(el, tab = 'week', arg) {
  const [sites, members, tasks] = await Promise.all([db.all('sites'), db.all('members'), db.all('tasks')]);
  const S = Object.fromEntries(sites.map(s => [s.id, s]));
  const head = `<h2>Planning</h2>${tabs('#/planning', [['week', 'Semaine'], ['month', 'Mois'], ['team', 'Équipe']], tab)}`;
  const chip = t => { const s = S[t.siteId]; return s ? `<button class="pchip" data-t="${t.id}" style="background:${e(s.color || '#2f7ad6')}" title="${e(s.name)}">${e(s.name)}<small>${num(t.hours)} h</small></button>` : ''; };
  const act = members.filter(m => m.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  if (tab === 'team') {
    const soon = h => habState(h);
    el.innerHTML = `${head}<div class="row"><span class="muted">${act.length} membre(s) actif(s)</span><span class="sp"></span><button class="btn primary" id="addm">+ Membre</button></div>
      ${members.sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name, 'fr')).map(m => {
        const done = round2(tasks.filter(t => t.memberId === m.id && (t.start || '').slice(0, 7) === today().slice(0, 7)).reduce((a, t) => a + num(t.done), 0));
        return `<div class="item" data-m="${m.id}" ${m.active === false ? 'style="opacity:.55"' : ''}><span class="avatar" style="background:${e(m.color)}">${e(initials(m.name))}</span><div class="main"><div class="t">${e(m.name)} <small class="muted">${e(ROLE[m.role] || '')}${m.active === false ? ' · inactif' : ''}</small></div>
          <div class="s">${[m.phone, m.email].filter(Boolean).map(e).join(' · ')}</div>
          <div>${(m.habs || []).map(h => `<span class="chip ${soon(h)}">${e(h.label)}${h.expiry ? ' · ' + dateFr(h.expiry) : ''}</span>`).join('')}</div></div>
          <div class="r"><div class="s">ce mois</div><b>${done} h</b></div></div>`;
      }).join('') || '<div class="empty">Ajoutez les membres de l\'équipe (vous-même, ouvriers, apprentis, sous-traitants).</div>'}`;
    $('#addm', el).onclick = () => memberModal();
    $$('[data-m]', el).forEach(n => n.onclick = () => memberModal(members.find(m => m.id === n.dataset.m)));
    return;
  }

  if (tab === 'month') {
    const base = arg || today().slice(0, 7);
    const first = `${base}-01`, gridStart = monday(first);
    const [y, mo] = base.split('-').map(Number);
    const nextM = ymd(new Date(y, mo, 1)).slice(0, 7), prevM = ymd(new Date(y, mo - 2, 1)).slice(0, 7);
    const cells = [];
    for (let i = 0; i < 42; i++) { const d = addDays(gridStart, i); if (i >= 35 && d.slice(0, 7) !== base) break; cells.push(d); }
    el.innerHTML = `${head}<div class="row"><a class="btn" href="#/planning/month/${prevM}">‹</a><b style="flex:1;text-align:center;text-transform:capitalize">${MOIS[mo - 1]} ${y}</b><a class="btn" href="#/planning/month/${nextM}">›</a><button class="btn primary" id="add">+ Affecter</button></div>
      <div class="mgrid">${JOURS.map(j => `<div class="mh">${j}</div>`).join('')}${cells.map(d => {
        const day = tasks.filter(t => covers(t, d) && members.find(m => m.id === t.memberId));
        const bySite = {}; day.forEach(t => (bySite[t.siteId] ||= []).push(t));
        return `<div class="mc ${d.slice(0, 7) !== base ? 'out' : ''} ${d === today() ? 'today' : ''}" data-d="${d}"><div class="dn">${+d.slice(8)}</div>${Object.entries(bySite).map(([sid, l]) => S[sid] ? `<div class="mchip" style="background:${e(S[sid].color || '#2f7ad6')}" title="${e(S[sid].name)}">${e(S[sid].name)} <small>${l.map(t => initials(members.find(m => m.id === t.memberId)?.name)).join(' ')}</small></div>` : '').join('')}</div>`;
      }).join('')}</div>`;
    $('#add', el).onclick = () => assignModal(null);
    $$('[data-d]', el).forEach(c => c.onclick = () => go(`#/planning/week/${c.dataset.d}`));
    return;
  }

  // semaine : membres en lignes, jours en colonnes
  const w0 = monday(arg || today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(w0, i));
  const wn = Math.ceil(((parse(days[3]) - new Date(parse(days[3]).getFullYear(), 0, 1)) / 864e5 + 1) / 7);
  el.innerHTML = `${head}<div class="row"><a class="btn" href="#/planning/week/${addDays(w0, -7)}">‹</a><b style="flex:1;text-align:center">Semaine ${wn} · ${dateFr(days[0])} – ${dateFr(days[6])}</b><a class="btn" href="#/planning/week/${addDays(w0, 7)}">›</a>
    <a class="btn" href="#/planning/week">Aujourd'hui</a><button class="btn primary" id="add">+ Affecter</button></div>
    ${act.length ? `<div class="wscroll"><table class="wtab"><thead><tr><th></th>${days.map((d, i) => `<th class="${d === today() ? 'today' : ''}">${JOURS[i]} ${+d.slice(8)}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${act.map(m => {
        let tot = 0;
        const tds = days.map(d => {
          const l = tasks.filter(t => t.memberId === m.id && covers(t, d)); const h = round2(l.reduce((a, t) => a + num(t.hours), 0)); tot += h;
          return `<td data-m="${m.id}" data-d="${d}" class="${h > DAY_MAX ? 'over' : ''}">${l.map(chip).join('')}${h > DAY_MAX ? '<span title="Plus de ' + DAY_MAX + ' h ce jour">⚠</span>' : ''}</td>`;
        }).join('');
        return `<tr><th class="who"><span class="avatar sm" style="background:${e(m.color)}">${e(initials(m.name))}</span> ${e(m.name)}</th>${tds}<td class="tot">${round2(tot)} h</td></tr>`;
      }).join('')}</tbody></table></div><p class="muted">Touchez une case vide pour affecter, une pastille pour modifier / saisir les heures réalisées.</p>`
      : '<div class="empty">Aucun membre actif. <a href="#/planning/team">Ajouter l\'équipe</a></div>'}`;
  $('#add', el).onclick = () => assignModal(null);
  $$('td[data-m]', el).forEach(td => td.onclick = ev => {
    const c = ev.target.closest('[data-t]');
    if (c) assignModal(tasks.find(t => t.id === c.dataset.t)); else assignModal(null, { memberId: td.dataset.m, date: td.dataset.d });
  });
}

/* ---------- Bloc « Équipe & heures » d'une fiche chantier ---------- */
export function siteTeamHtml(siteId, tasks, members) {
  const h = siteHours(siteId, tasks, members);
  return `<h3>Équipe &amp; heures</h3>
    ${h.rows.map(r => `<div class="item" data-mem="${r.member.id}"><span class="avatar sm" style="background:${e(r.member.color)}">${e(initials(r.member.name))}</span><div class="main"><div class="t">${e(r.member.name)}</div><div class="s">${e(ROLE[r.member.role] || '')}</div></div>
      <div class="r"><div>${r.done} h <small class="muted">/ ${r.planned} h prévues</small></div></div></div>`).join('') || '<p class="muted">Personne n\'est encore affecté.</p>'}
    ${h.rows.length ? `<p class="muted">Total : <b>${h.done} h</b> réalisées sur ${h.planned} h prévues${h.cost ? ` · coût main-d'œuvre ${h.cost.toFixed(2).replace('.', ',')} €` : ''}</p>` : ''}
    <button class="btn sm" id="assign">+ Affecter des membres</button> <a class="btn sm" href="#/planning/week">Voir le planning</a>`;
}
