// Formulaire « Absence » du planning (M7) : poser des congés, une maladie… sur une période, pour un ou plusieurs membres.
import * as db from './db.js';
import { e, F, modal, toast, refresh, dateFr, today, $, $$ } from './util.js';
import * as H from './hours.js';
import { absOpts } from './lists.js';
import { planAbsence, absHours, absDays, describeGroup, groupOf, skippedText } from './absence.js';
import * as auth from './auth.js';

const fmtLong = d => dateFr(d);

/* grp : identifiant d'une série existante (modification) ou null (nouvelle) ; preset : { memberId, date } */
export async function absenceModal(grp, preset = {}) {
  const [members, times, closedRec] = await Promise.all([db.all('members'), db.all('times'), db.get('settings', 'hoursClosed')]);
  const closed = closedRec?.value || null, me = auth.currentUser();
  const cur = grp ? groupOf(times, grp) : [];
  const isNew = !cur.length;
  const member0 = isNew ? null : members.find(m => m.id === cur[0].memberId);
  if (!isNew && !member0) { toast('Ce membre n\'existe plus.'); return; }
  const info = isNew ? null : describeGroup(times, grp, member0);
  const act = members.filter(m => m.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (isNew && !act.length) { toast('Ajoutez d\'abord un membre'); return; }
  const v = isNew ? { start: preset.date || today(), end: preset.date || preset.start || today(), weekend: false, absType: '', note: '', part: 'full', hours: '' } : info;
  const defType = v.absType || (absOpts('')[0] || ['autre'])[0];
  const memberBox = isNew
    ? `<div class="full"><span class="muted" style="font-size:12px">Membres absents</span><div class="chk">${act.map(m => `<label><input type="checkbox" name="mem" value="${m.id}" ${m.id === preset.memberId ? 'checked' : ''}> <span class="dot" style="background:${e(m.color)}"></span> ${e(m.name)}</label>`).join('')}</div></div>`
    : `<p class="full" style="margin:0"><b>${e(member0.name)}</b></p>`;
  const lockedRows = cur.filter(x => H.isClosedDate(closed, x.date));
  const body = `<div class="cols">${memberBox}
    <label class="f full"><span>Type d'absence</span><select name="absType">${absOpts(v.absType).map(([k, n]) => `<option value="${e(k)}" ${k === defType ? 'selected' : ''}>${e(n)}</option>`).join('')}</select></label>
    ${F('Du', 'start', v.start, { type: 'date', req: true })}${F('Au (inclus)', 'end', v.end, { type: 'date', req: true })}
    <label class="f"><span>Durée par jour</span><select name="part"><option value="full" ${v.part === 'full' ? 'selected' : ''}>Journée entière (selon l'horaire de la personne)</option><option value="half" ${v.part === 'half' ? 'selected' : ''}>Demi-journée</option><option value="custom" ${v.part === 'custom' ? 'selected' : ''}>Durée précise…</option></select></label>
    <label class="f" id="cuswrap" ${v.part === 'custom' ? '' : 'hidden'}><span>Heures par jour (7,5 ou 7h30)</span><input name="custom" type="text" inputmode="decimal" autocomplete="off" value="${v.part === 'custom' && v.hours !== '' ? e(H.fmtH(v.hours)) : ''}" placeholder="ex : 3h30"></label>
    <label class="f full"><input type="checkbox" name="weekend" ${v.weekend ? 'checked' : ''}> Inclure samedi et dimanche</label>
    ${F('Précision (facultatif)', 'note', v.note, { cls: 'full', ph: 'ex : vacances d\'été, arrêt de travail…' })}
    <p class="muted full" id="abcalc" style="margin:0"></p>
    ${lockedRows.length ? `<p class="muted full" style="margin:0">⚠ ${lockedRows.length} jour(s) de cette série appartiennent à un mois clôturé : ils ne bougent plus.</p>` : ''}</div>`;
  modal(isNew ? 'Poser une absence' : 'Absence', body,
    async (o, f) => {
      const ids = isNew ? $$('[name=mem]:checked', f).map(i => i.value) : [member0.id];
      if (!ids.length) { alert('Cochez au moins un membre.'); return false; }
      const custom = o.part === 'custom' ? H.parseHM(o.custom) : null;
      if (o.part === 'custom' && !(custom > 0)) { alert('Durée illisible : écrivez par exemple 3,5 ou 3h30.'); return false; }
      const same = !isNew && o.part === info.part && (o.part !== 'custom' || H.round2(custom) === H.round2(info.hours));
      const plans = [];
      for (const id of ids) {
        const m = members.find(x => x.id === id);
        const p = planAbsence({ member: m, start: o.start, end: o.end, weekend: !!o.weekend, absType: o.absType, part: o.part, custom, note: o.note, grp: isNew ? '' : grp, keepHours: same, times, closed, by: me?.id || '' });
        if (p.error) { alert((ids.length > 1 ? m.name + ' : ' : '') + p.error); return false; }
        plans.push({ m, p });
      }
      if (!plans.some(x => x.p.days)) { alert(`Rien à enregistrer :\n${skippedText(plans.flatMap(x => x.p.skipped), fmtLong)}`); return false; }
      let n = 0;
      for (const { p } of plans) {
        for (const id of p.remove) await db.del('times', id);
        for (const r of p.rows) await db.put('times', r);
        n += p.days;
      }
      const skipped = plans.flatMap(x => x.p.skipped.map(s => ({ ...s, who: x.m.name })));
      toast(`Absence enregistrée · ${n} jour${n > 1 ? 's' : ''}`);
      if (skipped.length) alert(skippedText(skipped, fmtLong) + '\n\nCes jours n\'ont pas été modifiés (corrigez-les depuis la case du jour si besoin).');
      refresh();
    },
    {
      submitLabel: 'Enregistrer',
      del: isNew ? null : async () => {
        if (lockedRows.length) { alert('Cette absence porte sur un mois clôturé : elle ne peut pas être supprimée. Rouvrez le mois dans Planning › Heures si besoin.'); return; }
        for (const x of cur) await db.del('times', x.id);
        toast('Absence supprimée'); refresh();
      },
      onOpen: f => {
        const calc = () => {
          const m = isNew ? members.find(x => x.id === ($$('[name=mem]:checked', f)[0] || {}).value) : member0;
          const start = $('[name=start]', f).value, end = $('[name=end]', f).value, part = $('[name=part]', f).value;
          $('#cuswrap', f).hidden = part !== 'custom';
          const c = start && end && end >= start ? absDays(start, end, $('[name=weekend]', f).checked).length : 0;
          const h = m ? (part === 'custom' ? H.parseHM($('[name=custom]', f).value) || 0 : absHours(m, part)) : 0;
          $('#abcalc', f).textContent = c ? `${c} jour${c > 1 ? 's' : ''}${h ? ` · ${H.fmtHM(h)} par jour · ${H.fmtHM(H.round2(h * c))} d'absence au total` : ''}` : 'Aucun jour ouvré dans cette période.';
        };
        f.addEventListener('input', calc); f.addEventListener('change', calc); calc();
      }
    });
}
