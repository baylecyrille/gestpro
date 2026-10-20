// Réglages › « Listes de choix » et « Seuils et délais » : écrans de gestion des listes (lists.js) et des seuils (limits.js).
import * as db from './db.js';
import { e, toast, $, $$ } from './util.js';
import { getS } from './defaults.js';
import { LIST_DEFS, LIST_ORDER, fullList, checkList, isCustom, applyLists } from './lists.js';
import { LIM_FIELDS, LIM_DEFAULTS, checkLimits, applyLimits } from './limits.js';
import { alertBox, confirmBox } from './dialogs.js';

const lineArr = d => (Array.isArray(d.blocks) ? d.blocks : Array.isArray(d.lines) ? d.lines : []);
const inc = (m, k) => { if (k !== undefined && k !== null && k !== '') m.set(k, (m.get(k) || 0) + 1); };

/* Combien de fiches utilisent chaque valeur : une valeur utilisée ne se renomme pas (les anciens documents gardent leur texte) et ne se supprime pas, elle se masque. */
export async function usageOf() {
  const [products, docs, pays, members, times] = await Promise.all([db.all('products'), db.all('documents'), db.all('payments'), db.all('members'), db.all('times')]);
  const U = { units: new Map(), cats: new Map(), methods: new Map(), contracts: new Map(), roles: new Map(), absTypes: new Map() };
  for (const p of products) { inc(U.units, p.unit); inc(U.cats, p.category); for (const c of p.compo || []) inc(U.units, c.unit); }
  for (const d of docs) for (const l of lineArr(d)) { if (l && l.type !== 'section' && l.type !== 'text') { inc(U.units, l.unit); inc(U.cats, l.cat); } }
  for (const p of pays) inc(U.methods, p.method);
  for (const m of members) { inc(U.contracts, m.contract); inc(U.roles, m.role); }
  for (const t of times) if (t.kind === 'absence') inc(U.absTypes, t.absType);
  return U;
}

const rid = () => 'x' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5);

/* ---------- Listes de choix ---------- */
export async function mountLists(host) {
  const S = await getS(), U = await usageOf();
  const work = {};
  for (const k of LIST_ORDER) work[k] = fullList(k, (S.lists || {})[k]);
  const used = (k, it) => {
    const m = U[k]; if (!m) return 0;
    return (LIST_DEFS[k].kind === 'id' ? m.get(it.v) : [...m].filter(([v]) => String(v).toLowerCase() === it.v.toLowerCase()).reduce((a, [, n]) => a + n, 0)) || 0;
  };
  const rowHtml = (k, it, i) => {
    const def = LIST_DEFS[k], n = used(k, it), lock = !!(def.defaults.find(d => d.v === it.v) || {}).lock, kind = def.kind;
    const fixed = (kind !== 'id' && n > 0) || lock; // texte enregistré tel quel dans les fiches : on ne le renomme plus une fois utilisé
    const field = kind === 'id' ? 'label' : 'v';
    return `<div class="lr2${it.hidden ? ' hid' : ''}${lock ? ' lk' : ''}" data-i="${i}">
      <span class="lr2-mv"><button type="button" class="btn sm" data-up title="Monter" aria-label="Monter">↑</button><button type="button" class="btn sm" data-down title="Descendre" aria-label="Descendre">↓</button></span>
      ${kind === 'cat' ? `<input class="lr2-ic" data-f="icon" maxlength="4" value="${e(it.icon || '')}" aria-label="Icône" placeholder="🏷">` : ''}
      <input class="lr2-v" data-f="${field}" value="${e(kind === 'id' ? it.label : it.v)}" ${fixed ? 'readonly' : ''} aria-label="Libellé" placeholder="Nouvelle valeur" autocomplete="off">
      ${kind === 'cat' ? `<label class="lr2-o" title="Une catégorie « service » n'a ni stock ni seuil d'alerte"><input type="checkbox" data-f="svc" ${it.svc ? 'checked' : ''} ${lock ? 'disabled' : ''}> service</label>` : ''}
      <label class="lr2-o"><input type="checkbox" data-f="vis" ${it.hidden ? '' : 'checked'} ${lock ? 'disabled' : ''}> proposée</label>
      <span class="lr2-n muted">${lock ? 'utilisée par l\'application' : n ? `utilisée ${n} fois${kind === 'id' ? '' : ' : non renommable'}` : ''}</span>
      <button type="button" class="btn sm" data-del title="${lock ? 'Valeur protégée' : n ? 'Déjà utilisée : masquez-la plutôt que de la supprimer' : 'Supprimer'}" ${lock || n ? 'disabled' : ''} aria-label="Supprimer">🗑</button></div>`;
  };
  const secHtml = (k, open) => {
    const def = LIST_DEFS[k], items = work[k], hid = items.filter(x => x.hidden).length;
    return `<details class="lst" data-k="${k}" ${open ? 'open' : ''}><summary><b>${e(def.title)}</b> <small class="muted">${items.length - hid} proposée${items.length - hid > 1 ? 's' : ''}${hid ? ` · ${hid} masquée${hid > 1 ? 's' : ''}` : ''}${isCustom(k, items) ? ' · modifiée' : ''}</small></summary>
      <p class="muted" style="margin:4px 0 6px">${e(def.help)}</p>
      <div class="lrows">${items.map((it, i) => rowHtml(k, it, i)).join('')}</div>
      <div class="row" style="margin:6px 0 0"><button type="button" class="btn sm" data-add>＋ Ajouter</button><button type="button" class="btn sm" data-reset title="Revient à la liste fournie avec l'application">↺ Liste d'origine</button></div></details>`;
  };
  host.innerHTML = `<p class="muted" style="margin-top:0">Les listes déroulantes de l'application : unités, catégories de produits, modes de règlement, contrats, fonctions, types d'absence et listes de suggestions. <b>Masquer</b> une valeur la retire des menus sans toucher aux fiches qui l'utilisent ; une valeur déjà utilisée ne peut pas être supprimée, et un texte repris tel quel dans les fiches et les documents (unité, catégorie, contrat) ne peut plus être renommé : les documents déjà émis gardent leur texte. Les listes sont partagées entre vos appareils.</p>
    <div id="lsecs">${LIST_ORDER.map(k => secHtml(k, false)).join('')}</div>
    <div class="row zshow"><button type="button" class="btn primary" id="lsave" data-zsubmit>Enregistrer les listes</button><span class="muted" id="lmsg"></span></div>`;

  /* relit les lignes affichées d'une liste (saisies en cours comprises) */
  const read = k => {
    const sec = $(`details[data-k="${k}"]`, host), def = LIST_DEFS[k], out = [];
    $$('.lr2', sec).forEach(r => {
      const old = work[k][+r.dataset.i] || {}, it = { ...old };
      const val = $('[data-f=v],[data-f=label]', r).value;
      if (def.kind === 'id') it.label = val; else it.v = val;
      const ic = $('[data-f=icon]', r); if (ic) it.icon = ic.value;
      const sv = $('[data-f=svc]', r); if (sv) it.svc = sv.checked;
      const vs = $('[data-f=vis]', r); if (vs) { if (vs.checked) delete it.hidden; else it.hidden = true; }
      out.push(it);
    });
    return out;
  };
  const redraw = (k, open) => { const sec = $(`details[data-k="${k}"]`, host); sec.outerHTML = secHtml(k, open === undefined ? sec.open : open); };
  host.addEventListener('click', async ev => {
    const sec = ev.target.closest('details.lst'); if (!sec) return;
    const k = sec.dataset.k, def = LIST_DEFS[k], row = ev.target.closest('.lr2'), i = row ? +row.dataset.i : -1;
    const b = ev.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-add')) {
      work[k] = read(k);
      work[k].push(def.kind === 'id' ? { v: rid(), label: '' } : def.kind === 'cat' ? { v: '', icon: '🏷', svc: false } : { v: '' });
      redraw(k); const rows = $$('.lr2 .lr2-v', $(`details[data-k="${k}"]`, host)); rows[rows.length - 1]?.focus(); return;
    }
    if (b.hasAttribute('data-reset')) { if (!(await confirmBox(`Revenir à la liste d'origine « ${def.title} » ? Vos ajouts, renommages et masquages de cette liste seront perdus (les fiches déjà enregistrées ne changent pas).`))) return; work[k] = fullList(k, null); redraw(k); return; }
    if (i < 0) return;
    work[k] = read(k);
    if (b.hasAttribute('data-up') && i > 0) { [work[k][i - 1], work[k][i]] = [work[k][i], work[k][i - 1]]; redraw(k); }
    else if (b.hasAttribute('data-down') && i < work[k].length - 1) { [work[k][i + 1], work[k][i]] = [work[k][i], work[k][i + 1]]; redraw(k); }
    else if (b.hasAttribute('data-del') && !b.disabled) { work[k].splice(i, 1); redraw(k); }
  });
  host.addEventListener('change', ev => { const r = ev.target.closest('.lr2'); if (r && ev.target.matches('[data-f=vis]')) r.classList.toggle('hid', !ev.target.checked); });
  $('#lsave', host).onclick = async () => {
    const lists = {};
    for (const k of LIST_ORDER) {
      const items = read(k).filter(x => String(LIST_DEFS[k].kind === 'id' ? x.label : x.v).trim() !== ''); // les lignes laissées vides sont ignorées
      const r = checkList(k, items);
      if (r.error) { $(`details[data-k="${k}"]`, host).open = true; alertBox(r.error); return; }
      work[k] = r.items;
      if (isCustom(k, r.items)) lists[k] = r.items;
    }
    const cur = await getS();
    const next = { ...cur }; if (Object.keys(lists).length) next.lists = lists; else delete next.lists;
    await db.saveSettings(next); applyLists(next);
    $('#lmsg', host).textContent = 'Enregistré ✔'; toast('Listes de choix enregistrées');
    for (const k of LIST_ORDER) redraw(k);
    host.dispatchEvent(new Event('zsaved', { bubbles: true })); // la zone se reverrouille
  };
}

/* ---------- Seuils et délais ---------- */
export async function mountLimits(host) {
  const S = await getS(), st = S.limits || {};
  host.innerHTML = `<p class="muted" style="margin-top:0">Réglages de calcul utilisés dans tout l'application. Laissez la valeur d'origine si vous ne savez pas. Les délais légaux (rétractation de 14 jours, délai de 7 jours avant tout paiement) ne se changent pas.</p>
    <div class="cols">${LIM_FIELDS.map(f => `<label class="f"><span>${e(f[1])} <small class="muted">(origine : ${String(f[2]).replace('.', ',')} ${e(f[6])})</small></span><div style="display:flex;gap:6px;align-items:center"><input type="number" name="${f[0]}" min="${f[3]}" max="${f[4]}" step="${f[5]}" inputmode="decimal" value="${e(st[f[0]] ?? f[2])}" required style="flex:1"><span class="muted">${e(f[6])}</span></div><small class="muted">${e(f[7])}</small></label>`).join('')}</div>
    <div class="row zshow"><button type="button" class="btn primary" id="limsave" data-zsubmit>Enregistrer les seuils</button><button type="button" class="btn" id="limreset">Valeurs d'origine</button><span class="muted" id="limmsg"></span></div>`;
  const val = () => Object.fromEntries(LIM_FIELDS.map(f => [f[0], $(`[name=${f[0]}]`, host).value]));
  $('#limsave', host).onclick = async () => {
    const r = checkLimits(val()); if (r.error) { alertBox(r.error); return; }
    const cur = await getS(), next = { ...cur }; if (Object.keys(r.limits).length) next.limits = r.limits; else delete next.limits;
    await db.saveSettings(next); applyLimits(next);
    $('#limmsg', host).textContent = 'Enregistré ✔'; toast('Seuils et délais enregistrés');
    host.dispatchEvent(new Event('zsaved', { bubbles: true })); // la zone se reverrouille
  };
  $('#limreset', host).onclick = () => { LIM_FIELDS.forEach(f => { $(`[name=${f[0]}]`, host).value = LIM_DEFAULTS[f[0]]; }); $('#limmsg', host).textContent = 'Valeurs d\'origine remises : enregistrez pour confirmer.'; };
}
