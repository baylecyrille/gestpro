// Équipe (membres, habilitations) et planning : affectation de membres à des chantiers avec heures prévues / réalisées.
import * as db from './db.js';
import { compressImage, e, num, round2, dateFr, today, F, modal, toast, tabs, refresh, go, colorField, bindColors, $, $$ } from './util.js';
import * as auth from './auth.js';
import * as H from './hours.js';

export const CONTRACTS = ['CDI', 'CDD', 'CDD saisonnier', 'CDI de chantier / d\'opération', 'Intérim (mission)', 'Contrat d\'apprentissage', 'Contrat de professionnalisation', 'Stage', 'Gérant / mandataire social', 'Sous-traitant / indépendant', 'Autre'];
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

/* Heures d'un chantier, par membre : prévues (planning) et réalisées (saisies par jour + anciens totaux non remplacés, voir hours.js) */
export function siteHours(siteId, tasks, members, times = []) {
  const M = Object.fromEntries(members.map(m => [m.id, m]));
  const done = H.doneBySite(siteId, tasks, times);
  const by = {};
  const row = id => by[id] || (by[id] = { member: M[id], planned: 0, done: 0, cost: 0 });
  tasks.filter(t => t.siteId === siteId).forEach(t => { const r = row(t.memberId); r.planned = round2(r.planned + plannedHours(t)); });
  Object.keys(done).forEach(id => row(id));
  Object.entries(by).forEach(([id, r]) => { r.done = done[id] || 0; r.cost = round2(r.done * num(r.member?.rate)); });
  const rows = Object.values(by).filter(r => r.member);
  return { rows, planned: round2(rows.reduce((a, r) => a + r.planned, 0)), done: round2(rows.reduce((a, r) => a + r.done, 0)), cost: round2(rows.reduce((a, r) => a + r.cost, 0)) };
}

const initials = n => (n || '?').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();

/* ---------- Fiche membre ---------- */
export function memberModal(m) {
  const isNew = !m; m = m || { name: '', role: 'ouvrier', phone: '', email: '', color: COLORS[0], rate: '', habs: [], active: true, note: '' };
  const habRow = h => `<div class="row hab" style="margin-bottom:6px"><input list="habl" data-h="label" value="${e(h.label || '')}" placeholder="Habilitation" style="flex:2;min-width:140px"><input type="date" data-h="expiry" value="${e(h.expiry || '')}" title="Date d'expiration" style="flex:1;min-width:130px"><button type="button" class="btn sm" data-rmh>✕</button></div>`;
  let photo = m.photo || '';
  const avatar = () => photo ? `<img class="av" style="width:56px;height:56px;margin:0" src="${e(photo)}" alt="">` : '<span class="av ini" style="width:56px;height:56px;font-size:22px;margin:0">?</span>';
  modal(isNew ? 'Nouveau membre' : 'Fiche membre',
    `<div class="cols"><div class="full row" style="margin:0"><span id="mav">${avatar()}</span><label class="btn"><input type="file" id="mphoto" accept="image/*" hidden>📷 Photo</label><button type="button" class="btn" id="mphdel">Retirer</button></div>
    ${F('Nom et prénom', 'name', m.name, { req: true, cls: 'full' })}${F('Prénom affiché (« Bonjour … »)', 'first', m.first || '', { cls: 'full', ph: 'ex : Michael' })}
    ${F('Fonction', 'role', m.role, { type: 'select', options: ROLES })}
    ${F('Type de contrat de travail', 'contract', m.contract || '', { type: 'select', options: [['', '— non renseigné —'], ...CONTRACTS.map(c => [c, c])] })}
    ${F('Date de naissance', 'birthDate', m.birthDate || '', { type: 'date' })}${F('Date d\'embauche', 'hireDate', m.hireDate || '', { type: 'date' })}
    ${F('Date de sortie', 'exitDate', m.exitDate || '', { type: 'date' })}<span></span>
    ${colorField('Couleur (planning)', 'color', m.color, 'full')}
    ${F('Téléphone', 'phone', m.phone, { type: 'tel' })}${F('E-mail', 'email', m.email, { type: 'email' })}
    ${F('Coût horaire HT (€/h) – coût pour l\'entreprise', 'rate', m.rate, { type: 'number', step: '0.01' })}
    ${F('Coût facturé HT (€/h) – prix de vente au client', 'billRate', m.billRate ?? '', { type: 'number', step: '0.01' })}
    ${F('Statut', 'active', m.active === false ? '0' : '1', { type: 'select', options: [['1', 'Actif'], ['0', 'Inactif']] })}
    ${F('Profil d\'accès à l\'appli', 'access', m.access || '', { type: 'select', options: auth.PROFILE_OPTIONS })}
    ${F(m.pinHash ? 'Nouveau code PIN (vide = inchangé)' : 'Code PIN (4 à 6 chiffres)', 'pin', '', { type: 'password', extra: 'inputmode="numeric" maxlength="6" autocomplete="new-password"' })}
    <p class="muted full" id="accdesc" style="margin-top:-4px"></p>
    <div class="full"><span class="muted" style="font-size:12px">Habilitations / certificats (avec date d'expiration)</span><div id="habs">${(m.habs || []).map(habRow).join('')}</div>
      <button type="button" class="btn sm" id="addh">+ Habilitation</button><datalist id="habl">${HABS.map(h => `<option value="${e(h)}">`).join('')}</datalist></div>
    ${F('Note', 'note', m.note, { type: 'textarea', rows: 2, cls: 'full' })}</div>`,
    async (o, f) => {
      const pin = (o.pin || '').trim(); delete o.pin;
      if (o.access && !m.pinHash && !pin) { alert('Définissez un code PIN pour donner un accès à ce membre.'); return false; }
      if (pin && !/^\d{4,6}$/.test(pin)) { alert('Le code PIN doit comporter 4 à 6 chiffres.'); return false; }
      m.id = m.id || db.uid();
      const others = (await db.all('members')).filter(x => x.id !== m.id);
      if (auth.isActive() && !others.some(x => x.access === 'admin' && x.pinHash && x.active !== false) && !(o.access === 'admin' && o.active !== '0')) { alert('Il doit rester au moins un administrateur actif avec un code PIN.'); return false; }
      const firstAdmin = !auth.isActive() && o.access === 'admin';
      if (o.access && pin) m.pinHash = await auth.hashPin(pin, m.id);
      if (!o.access) delete m.pinHash;
      const habs = $$('.hab', f).map(r => ({ label: $('[data-h=label]', r).value.trim(), expiry: $('[data-h=expiry]', r).value })).filter(h => h.label);
      Object.assign(m, o, { photo, habs, active: o.active !== '0', rate: o.rate === '' ? '' : num(o.rate), billRate: o.billRate === '' ? '' : num(o.billRate) });
      await db.put('members', m);
      if (firstAdmin && m.pinHash) auth.setUser(m.id); // active la protection sans verrouiller son auteur
      toast('Membre enregistré'); refresh();
    },
    {
      del: isNew ? null : async () => {
        if (auth.isActive() && m.access === 'admin' && !(await db.all('members')).some(x => x.id !== m.id && x.access === 'admin' && x.pinHash && x.active !== false)) { alert('Impossible : c\'est le seul administrateur.'); return; }
        const tasks = await db.all('tasks');
        if (tasks.some(t => t.memberId === m.id)) { m.active = false; await db.put('members', m); alert('Ce membre a des affectations : il est passé en « inactif » au lieu d\'être supprimé.'); }
        else await db.del('members', m.id);
        refresh();
      },
      onOpen: f => {
        bindColors(f);
        $('#mphoto', f).onchange = async ev => { const file = ev.target.files[0]; if (!file) return; try { photo = await compressImage(file, { mode: 'photo', maxChars: 6000 }); $('#mav', f).innerHTML = avatar(); } catch (err) { alert(err.message); } };
        $('#mphdel', f).onclick = () => { photo = ''; $('#mav', f).innerHTML = avatar(); };
        const ad = () => { const k = f.querySelector('[name=access]').value; $('#accdesc', f).textContent = k ? auth.PROFILES[k].desc : 'Ce membre n\'a pas d\'accès : il apparaît seulement dans le planning.'; };
        f.querySelector('[name=access]').onchange = ad; ad();
        $('#addh', f).onclick = () => { $('#habs', f).insertAdjacentHTML('beforeend', habRow({})); };
        f.addEventListener('click', ev => ev.target.closest('[data-rmh]')?.closest('.hab').remove());
      }
    });
}

/* ---------- Affectation (membre(s) → chantier, dates, heures) ---------- */
export async function assignModal(t, preset = {}) {
  const [sites, members, tasks, allContacts, times] = await Promise.all([db.all('sites'), db.all('members'), db.all('tasks'), db.all('contacts'), db.all('times')]);
  const moes = allContacts.filter(c => c.kind === 'moe').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
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
    <p class="muted full" id="donehint" style="margin:-4px 0 6px;font-size:12px">Facultatif. Les salariés saisissent leurs heures jour par jour (onglet Semaine) : ces saisies priment sur ce total.</p>
    <label class="f full"><input type="checkbox" name="weekend" ${t.weekend ? 'checked' : ''}> Inclure samedi et dimanche</label>
    ${F('Tâche / note', 'note', t.note, { cls: 'full', ph: 'ex : pose ossature, finitions…' })}
    ${moes.length ? `<label class="f full"><span>Intervenant extérieur présent (architecte, maître d'œuvre…) — facultatif</span><select name="extId"><option value="">— aucun —</option>${moes.map(c => `<option value="${c.id}" ${c.id === t.extId ? 'selected' : ''}>${e(c.name)}${c.fonction ? ' (' + e(c.fonction) + ')' : ''}</option>`).join('')}</select></label>` : ''}
    <p class="muted full" id="calc"></p></div>`,
    async (o, f) => {
      if (o.end < o.start) { alert('La date de fin est avant la date de début.'); return false; }
      const base = { siteId: o.siteId, start: o.start, end: o.end, hours: num(o.hours), weekend: !!o.weekend, done: o.done === '' ? '' : num(o.done), note: o.note, extId: o.extId || '' };
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
        const dh = H.doneBySite(t.siteId, [], times)[t.memberId];
        if (!isNew && dh) $('#donehint', f).innerHTML = `⚠ Des heures saisies par jour existent pour ce membre sur ce chantier (<b>${dh} h</b>) : elles priment sur ce total.`;
      }
    });
}

/* jours où le total d'heures d'un membre dépasse la limite */
function conflicts(rec, others) {
  const mine = others.filter(x => x.memberId === rec.memberId);
  return daysOf(rec).filter(d => round2(num(rec.hours) + mine.filter(x => covers(x, d)).reduce((a, x) => a + num(x.hours), 0)) > DAY_MAX);
}

/* ---------- Saisie des heures d'une journée (salarié : ses propres jours ; gestionnaire : tous) ---------- */
const dayLabel = d => `${JOURS[(parse(d).getDay() + 6) % 7]} ${dateFr(d)}`;
export function timeModal(m, date, env) {
  const { sites, tasks, times, me } = env;
  const planned = tasks.filter(t => t.memberId === m.id && covers(t, date));
  const mine = H.dayTimes(times, m.id, date);
  const plannedIds = new Set(planned.map(t => t.siteId));
  const used = new Set(mine.map(x => x.siteId).filter(Boolean));
  const open = sites.filter(s => !['paid', 'lost'].includes(s.status) || plannedIds.has(s.id) || used.has(s.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  /* lignes de départ : les saisies existantes, sinon le planning du jour (heures prévues, à vérifier) */
  const seed = mine.length ? mine.map(x => ({ id: x.id, kind: x.kind, siteId: x.siteId, hours: x.hours, note: x.note }))
    : planned.map(t => ({ id: '', kind: 'site', siteId: t.siteId, hours: num(t.hours), note: '' }));
  if (!seed.length) seed.push({ id: '', kind: 'site', siteId: '', hours: '', note: '' });
  const siteOpts = sel => `<option value="">— choisir le chantier —</option>${plannedIds.size ? '<optgroup label="Prévus ce jour">' + open.filter(s => plannedIds.has(s.id)).map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${e(s.name)}</option>`).join('') + '</optgroup><optgroup label="Autres chantiers">' : ''}${open.filter(s => !plannedIds.has(s.id)).map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${e(s.name)}</option>`).join('')}${plannedIds.size ? '</optgroup>' : ''}`;
  const line = l => `<div class="tl" data-id="${e(l.id || '')}"><select data-f="kind" aria-label="Activité">${H.KINDS.map(([k, n]) => `<option value="${k}" ${k === l.kind ? 'selected' : ''}>${e(n)}</option>`).join('')}</select>
    <input data-f="hours" type="number" step="0.25" min="0" max="${H.DAY_LIMIT}" inputmode="decimal" value="${l.hours === '' ? '' : num(l.hours)}" placeholder="h" aria-label="Heures"><button type="button" class="btn sm" data-rm aria-label="Supprimer la ligne">✕</button>
    <select data-f="site" class="tl-w" aria-label="Chantier" ${l.kind === 'site' ? '' : 'hidden'}>${siteOpts(l.siteId)}</select>
    <input data-f="note" class="tl-w" maxlength="120" value="${e(l.note || '')}" placeholder="Travail effectué (facultatif)" autocomplete="off"></div>`;
  const who = me && me.id === m.id ? 'Mes heures' : `Heures de ${m.name}`;
  modal(`${who} · ${dayLabel(date)}`,
    `${planned.length ? `<p class="muted" style="margin-top:0">Prévu : ${planned.map(t => `<b>${e(sites.find(s => s.id === t.siteId)?.name || '')}</b> ${num(t.hours)} h`).join(' · ')}${mine.length ? '' : '. Heures préremplies d\'après le planning : changez-les si besoin.'}</p>` : '<p class="muted" style="margin-top:0">Rien de prévu ce jour : ajoutez ce que vous avez fait.</p>'}
    <div id="tls">${seed.map(line).join('')}</div>
    <button type="button" class="btn sm" id="tladd">＋ Ajouter une ligne (autre chantier, atelier…)</button>
    <p id="tltot" class="muted" style="margin-bottom:0"></p>`,
    async (o, f) => {
      const val = (r, k) => $(`[data-f=${k}]`, r).value;
      const chk = H.checkDay($$('.tl', f).map(r => ({ id: r.dataset.id, kind: val(r, 'kind'), siteId: val(r, 'site'), hours: val(r, 'hours'), note: val(r, 'note') })));
      if (chk.error) { alert(chk.error); return false; }
      const keep = new Set(chk.lines.map(l => l.id).filter(Boolean));
      for (const x of mine) if (!keep.has(x.id)) await db.del('times', x.id);
      for (const l of chk.lines) {
        const old = mine.find(x => x.id === l.id);
        await db.put('times', { ...(old || {}), ...(l.id ? { id: l.id } : {}), memberId: m.id, date, kind: l.kind, siteId: l.siteId, hours: l.hours, note: l.note, by: me?.id || '' });
      }
      toast(chk.lines.length ? 'Heures enregistrées' : 'Journée effacée'); refresh();
    },
    {
      submitLabel: 'Enregistrer',
      onOpen: f => {
        const tot = () => {
          const rows = $$('.tl', f).map(r => ({ kind: $('[data-f=kind]', r).value, hours: $('[data-f=hours]', r).value }));
          const w = H.workedOf(rows), a = H.absenceOf(rows);
          $('#tltot', f).innerHTML = `Total du jour : <b>${w} h</b> travaillées${a ? ` · ${a} h d'absence` : ''}`;
        };
        f.addEventListener('input', tot);
        f.addEventListener('change', ev => { const k = ev.target.closest('[data-f=kind]'); if (k) { $('[data-f=site]', k.closest('.tl')).hidden = k.value !== 'site'; } tot(); });
        f.addEventListener('click', ev => {
          if (ev.target.closest('#tladd')) { $('#tls', f).insertAdjacentHTML('beforeend', line({ id: '', kind: 'site', siteId: '', hours: '', note: '' })); tot(); }
          const rm = ev.target.closest('[data-rm]'); if (rm) { rm.closest('.tl').remove(); tot(); }
        });
        tot();
      }
    });
}

/* ---------- Page Planning (semaine / mois / équipe) ---------- */
export async function renderPlanning(el, tab = 'week', arg) {
  const [sites, members, tasks0, ctc, times0] = await Promise.all([db.all('sites'), db.all('members'), db.all('tasks'), db.all('contacts'), db.all('times')]);
  const S = Object.fromEntries(sites.map(s => [s.id, s]));
  const EXT = Object.fromEntries(ctc.filter(c => c.kind === 'moe').map(c => [c.id, c]));
  const seeAll = auth.can('planning.all'), edit = auth.can('planning.edit'), hoursOk = auth.can('planning.hours'), me = auth.currentUser();
  const tasks = seeAll ? tasks0 : tasks0.filter(t => t.memberId === me?.id); // un compagnon ne voit que son planning
  const times = seeAll ? times0 : times0.filter(t => t.memberId === me?.id);
  const canEnter = (m, d) => !!m && (edit || (hoursOk && !!me && m.id === me.id && d <= today())); // le salarié saisit ses propres jours (jusqu'à aujourd'hui), le gestionnaire ceux de tous
  const env = { sites, tasks: tasks0, times: times0, me };
  const TABS_ = [['week', 'Semaine'], ['month', 'Mois'], ...(auth.can('team') ? [['team', 'Équipe']] : [])];
  const head = `<h2>${seeAll ? 'Planning' : 'Mon planning'}</h2>${tabs('#/planning', TABS_, tab)}`;
  const chip = t => { const s = S[t.siteId]; return s ? `<button class="pchip" data-t="${t.id}" style="background:${e(s.color || '#2f7ad6')}" title="${e(s.name)}${EXT[t.extId] ? ' — avec ' + e(EXT[t.extId].name) : ''}">${e(s.name)}<small>${num(t.hours)} h${EXT[t.extId] ? ' · 🏛 ' + e(EXT[t.extId].name) : ''}</small></button>` : ''; };
  const act = members.filter(m => m.active !== false && (seeAll || m.id === me?.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  if (tab === 'team') {
    const soon = h => habState(h);
    el.innerHTML = `${head}<div class="row"><span class="muted">${act.length} membre(s) actif(s)</span><span class="sp"></span>${auth.can('team.edit') ? '<button class="btn primary" id="addm">+ Membre</button>' : ''}</div>
      ${members.sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name, 'fr')).map(m => {
        const mo = H.monthOf(m.id, today().slice(0, 7), tasks, times), done = mo.worked;
        return `<div class="item" data-m="${m.id}" ${m.active === false ? 'style="opacity:.55"' : ''}><span class="avatar" style="background:${e(m.color)}">${e(initials(m.name))}</span><div class="main"><div class="t">${e(m.name)} <small class="muted">${e(ROLE[m.role] || '')}${m.active === false ? ' · inactif' : ''}</small></div>
          <div class="s">${[m.phone, m.email, m.rate !== '' && m.rate != null ? 'coût ' + num(m.rate) + ' €/h HT' : '', m.billRate !== '' && m.billRate != null ? 'facturé ' + num(m.billRate) + ' €/h HT' : ''].filter(Boolean).map(e).join(' · ')}</div>
          <div>${(m.habs || []).map(h => `<span class="chip ${soon(h)}">${e(h.label)}${h.expiry ? ' · ' + dateFr(h.expiry) : ''}</span>`).join('')}</div></div>
          <div class="r"><div class="s">ce mois</div><b>${done} h</b>${mo.absence ? `<div class="s">absence ${mo.absence} h</div>` : ''}</div></div>`;
      }).join('') || '<div class="empty">Ajoutez les membres de l\'équipe (vous-même, ouvriers, apprentis, sous-traitants).</div>'}`;
    if (auth.can('team.edit')) {
      $('#addm', el).onclick = () => memberModal();
      $$('[data-m]', el).forEach(n => n.onclick = () => import('./lock.js').then(L => L.withLock(n.dataset.m, () => memberModal(members.find(m => m.id === n.dataset.m)))));
    }
    return;
  }

  if (tab === 'month') {
    const base = arg || today().slice(0, 7);
    const first = `${base}-01`, gridStart = monday(first);
    const [y, mo] = base.split('-').map(Number);
    const nextM = ymd(new Date(y, mo, 1)).slice(0, 7), prevM = ymd(new Date(y, mo - 2, 1)).slice(0, 7);
    const cells = [];
    for (let i = 0; i < 42; i++) { const d = addDays(gridStart, i); if (i >= 35 && d.slice(0, 7) !== base) break; cells.push(d); }
    el.innerHTML = `${head}<div class="row"><a class="btn" href="#/planning/month/${prevM}">‹</a><b style="flex:1;text-align:center;text-transform:capitalize">${MOIS[mo - 1]} ${y}</b><a class="btn" href="#/planning/month/${nextM}">›</a>${edit ? '<button class="btn primary" id="add">+ Affecter</button>' : ''}</div>
      <div class="mgrid">${JOURS.map(j => `<div class="mh">${j}</div>`).join('')}${cells.map(d => {
        const day = tasks.filter(t => covers(t, d) && members.find(m => m.id === t.memberId));
        const bySite = {}; day.forEach(t => (bySite[t.siteId] ||= []).push(t));
        return `<div class="mc ${d.slice(0, 7) !== base ? 'out' : ''} ${d === today() ? 'today' : ''}" data-d="${d}"><div class="dn">${+d.slice(8)}</div>${Object.entries(bySite).map(([sid, l]) => S[sid] ? `<div class="mchip" style="background:${e(S[sid].color || '#2f7ad6')}" title="${e(S[sid].name)}">${e(S[sid].name)} <small>${l.map(t => initials(members.find(m => m.id === t.memberId)?.name)).join(' ')}</small></div>` : '').join('')}</div>`;
      }).join('')}</div>`;
    if (edit) $('#add', el).onclick = () => assignModal(null);
    $$('[data-d]', el).forEach(c => c.onclick = () => go(`#/planning/week/${c.dataset.d}`));
    return;
  }

  // semaine : membres en lignes, jours en colonnes (gestionnaire) ou liste des jours (salarié)
  const w0 = monday(arg || today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(w0, i));
  const wn = Math.ceil(((parse(days[3]) - new Date(parse(days[3]).getFullYear(), 0, 1)) / 864e5 + 1) / 7);
  const nav = `<div class="row"><a class="btn" href="#/planning/week/${addDays(w0, -7)}">‹</a><b style="flex:1;text-align:center">Semaine ${wn} · ${dateFr(days[0])} – ${dateFr(days[6])}</b><a class="btn" href="#/planning/week/${addDays(w0, 7)}">›</a>
    <a class="btn" href="#/planning/week">Aujourd'hui</a>${edit ? '<button class="btn primary" id="add">+ Affecter</button>' : ''}</div>`;
  const plannedOf = (m, d) => tasks.filter(t => t.memberId === m.id && covers(t, d));
  /* pastille d'heures saisies d'un jour */
  const badge = (m, d) => {
    const l = H.dayTimes(times, m.id, d), w = H.workedOf(l), ab = H.absenceOf(l), ok = canEnter(m, d);
    const txt = [w ? `${w} h` : '', ab ? `abs. ${ab} h` : ''].filter(Boolean).join(' · ');
    if (!txt && !(ok && d <= today())) return '';
    return ok ? `<button type="button" class="tbadge ${txt ? 'on' : ''}" data-tm="${m.id}" data-td="${d}">${txt ? '⏱ ' + e(txt) : '⏱ saisir'}</button>` : `<span class="tbadge on">⏱ ${e(txt)}</span>`;
  };

  if (!seeAll) { // ----- salarié : sa semaine sous forme de liste, un jour par ligne
    const m = act[0];
    if (!m) { el.innerHTML = `${head}<div class="empty">Votre fiche n'est pas active dans l'équipe.</div>`; return; }
    const worked = H.weekOf(m.id, days, times), plan = round2(days.reduce((a, d) => a + plannedOf(m, d).reduce((x, t) => x + num(t.hours), 0), 0));
    const shown = days.filter((d, i) => i < 5 || plannedOf(m, d).length || H.dayTimes(times, m.id, d).length);
    el.innerHTML = `${head}${nav}
      <div class="card" style="margin:8px 0"><b>${worked} h</b> saisies cette semaine <span class="muted">· ${plan} h prévues</span></div>
      ${hoursOk ? '<button class="btn primary" id="today" style="width:100%;margin-bottom:8px">⏱ Saisir mes heures d\'aujourd\'hui</button>' : ''}
      ${shown.map((d, i) => {
        const pl = plannedOf(m, d), l = H.dayTimes(times, m.id, d), w = H.workedOf(l), ab = H.absenceOf(l);
        const state = l.length ? `<span class="chip ok">✔ ${[w ? w + ' h' : '', ab ? 'absence ' + ab + ' h' : ''].filter(Boolean).join(' · ')}</span>` : d <= today() ? (pl.length ? '<span class="chip warn">à saisir</span>' : '<span class="chip">—</span>') : '<span class="chip">à venir</span>';
        const lines = l.length ? l.map(x => `${x.kind === 'site' ? e(S[x.siteId]?.name || 'Chantier') : e(H.KIND_LABEL[x.kind])} ${num(x.hours)} h`).join(' · ') : pl.map(t => `${e(S[t.siteId]?.name || '')} ${num(t.hours)} h`).join(' · ');
        return `<div class="item tday ${d === today() ? 'today' : ''}" data-d="${d}"><div class="main"><div class="t">${dayLabel(d)}${d === today() ? ' <small class="muted">aujourd\'hui</small>' : ''}</div><div class="s">${lines || 'Rien de prévu'}</div></div><div class="r">${state}</div></div>`;
      }).join('')}
      <p class="muted">Touchez un jour pour saisir vos heures : chantier prévu, autre chantier, atelier, déplacement ou absence. Vous pouvez corriger un jour déjà saisi.</p>`;
    const open = d => (!hoursOk ? toast('Votre profil ne permet pas de saisir des heures.') : canEnter(m, d) ? timeModal(m, d, env) : toast('Vous pourrez saisir ce jour-là à partir de la date du jour.'));
    $$('.tday', el).forEach(n => n.onclick = () => open(n.dataset.d));
    const tb = $('#today', el); if (tb) tb.onclick = () => open(today());
    return;
  }

  el.innerHTML = `${head}${nav}
    ${act.length ? `<div class="wscroll"><table class="wtab"><thead><tr><th></th>${days.map((d, i) => `<th class="${d === today() ? 'today' : ''}">${JOURS[i]} ${+d.slice(8)}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${act.map(m => {
        let tot = 0;
        const tds = days.map(d => {
          const l = plannedOf(m, d); const h = round2(l.reduce((a, t) => a + num(t.hours), 0)); tot += h;
          return `<td data-m="${m.id}" data-d="${d}" class="${h > DAY_MAX ? 'over' : ''}">${l.map(chip).join('')}${h > DAY_MAX ? '<span title="Plus de ' + DAY_MAX + ' h ce jour">⚠</span>' : ''}${badge(m, d)}</td>`;
        }).join('');
        const wk = H.weekOf(m.id, days, times);
        return `<tr><th class="who"><span class="avatar sm" style="background:${e(m.color)}">${e(initials(m.name))}</span> ${e(m.name)}</th>${tds}<td class="tot"><b>${wk} h</b><small class="muted" style="display:block">/ ${round2(tot)} h prévues</small></td></tr>`;
      }).join('')}</tbody></table></div><p class="muted">${edit ? 'Touchez une case vide pour affecter, une pastille de chantier pour modifier l\'affectation, la pastille ⏱ pour saisir ou corriger les heures réellement faites ce jour-là.' : ''}</p>`
      : '<div class="empty">Aucun membre actif. <a href="#/planning/team">Ajouter l\'équipe</a></div>'}`;
  if (edit) $('#add', el).onclick = () => assignModal(null);
  $$('td[data-m]', el).forEach(td => td.onclick = ev => {
    const tm = ev.target.closest('[data-tm]');
    if (tm) { const m = members.find(x => x.id === tm.dataset.tm); if (m && canEnter(m, tm.dataset.td)) timeModal(m, tm.dataset.td, env); return; }
    const c = ev.target.closest('[data-t]');
    const t = c && tasks.find(x => x.id === c.dataset.t);
    if (t) { if (edit) assignModal(t); }
    else if (edit) assignModal(null, { memberId: td.dataset.m, date: td.dataset.d });
  });
}

/* ---------- Bloc « Équipe & heures » d'une fiche chantier ---------- */
export function siteTeamHtml(siteId, tasks, members, { edit = true, money = true, times = [] } = {}) {
  const h = siteHours(siteId, tasks, members, times);
  return `<h3>Équipe &amp; heures</h3>
    ${h.rows.map(r => `<div class="item" data-mem="${r.member.id}"><span class="avatar sm" style="background:${e(r.member.color)}">${e(initials(r.member.name))}</span><div class="main"><div class="t">${e(r.member.name)}</div><div class="s">${e(ROLE[r.member.role] || '')}</div></div>
      <div class="r"><div>${r.done} h <small class="muted">/ ${r.planned} h prévues</small></div></div></div>`).join('') || '<p class="muted">Personne n\'est encore affecté.</p>'}
    ${h.rows.length ? `<p class="muted">Total : <b>${h.done} h</b> réalisées sur ${h.planned} h prévues${h.cost && money ? ` · coût main-d'œuvre ${h.cost.toFixed(2).replace('.', ',')} €` : ''}</p>` : ''}
    ${edit ? '<button class="btn sm" id="assign">+ Affecter des membres</button> ' : ''}${auth.can('planning') ? '<a class="btn sm" href="#/planning/week">Voir le planning</a>' : ''}`;
}
