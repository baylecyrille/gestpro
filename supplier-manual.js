// Lecture « à la main » d'une facture fournisseur PDF : on affiche la page, l'utilisateur entoure les zones
// (fournisseur, n° de facture, date, tableau des lignes), vérifie l'affectation des colonnes, puis passe à l'écran de contrôle habituel.
// Le PDF reste sur l'appareil. Seules les POSITIONS des zones peuvent être retenues (jamais le contenu de la facture).
import { e, eur, $, $$ } from './util.js';
import * as L from './supplier-layout.js';

const CHIPS = [
  ['sup.block', 'Fournisseur (nom + adresse)'], ['inv.number', 'N° de facture'], ['inv.date', 'Date'], ['inv.due', 'Échéance'], ['tbl', 'Tableau des lignes']
];
const MORE = [['sup.name', 'Nom'], ['sup.address', 'Adresse'], ['sup.zipcity', 'CP + ville'], ['sup.phone', 'Téléphone'], ['sup.email', 'E-mail'], ['sup.siret', 'SIRET'], ['sup.tva', 'N° TVA']];
const LABEL = Object.fromEntries([...CHIPS, ...MORE, ...L.COLS.map(c => ['col.' + c, 'Colonne ' + L.COL_LABEL[c].toLowerCase()])]);
/* quelles valeurs saisies à la main une nouvelle zone remplace-t-elle ? */
const ZKEYS = { 'sup.block': ['name', 'address', 'zip', 'city', 'phone', 'email', 'siret', 'tva'], 'sup.name': ['name'], 'sup.address': ['address'], 'sup.zipcity': ['zip', 'city'], 'sup.phone': ['phone'], 'sup.email': ['email'], 'sup.siret': ['siret'], 'sup.tva': ['tva'], 'inv.number': ['number'], 'inv.date': ['date'], 'inv.due': ['due'] };
const SUP = [['name', 'Nom'], ['address', 'Adresse'], ['zip', 'CP'], ['city', 'Ville'], ['phone', 'Téléphone'], ['email', 'E-mail'], ['siret', 'SIRET'], ['tva', 'N° TVA']];
const INV = [['number', 'N° de facture'], ['date', 'Date (jj/mm/aaaa)'], ['due', 'Échéance']];
const ZOOMS = [1, 1.5, 2, 3];

export function openManual(out, raw, o = {}) {
  const preset = o.preset || null;
  const st = { pg: 0, zi: 0, act: '', zones: preset ? { ...preset.zones } : {}, tbl: null, bands: [], values: {}, paint: 0 };
  if (preset?.table) {
    const T = preset.table, edges = [T.x0 > 0 ? T.x0 + 0.03 : 0, ...T.cuts, T.x1 < 1 ? T.x1 - 0.03 : 1];
    st.bands = T.fields.map((f, k) => ({ a: edges[k], b: edges[k + 1], field: f, n: 0, head: '', ex: '' }));
    st.tbl = { p: T.p, x0: edges[0], x1: edges[edges.length - 1], y0: T.y0, y1: 0.97 };
  }
  const spec = () => ({ zones: st.zones, table: st.tbl && st.bands.length ? L.makeTable(st.tbl, st.bands) : null, name: preset?.name });
  const result = () => L.buildResult(raw.pages, raw.sizes, spec(), st.values);

  out.innerHTML = `<div class="mn">
    ${o.note ? `<p class="${o.noteBad ? 'bad' : 'muted'}">${o.note}</p>` : ''}
    <div class="mn-top"><p class="muted" id="mnhelp"></p>
    <div class="mn-chips" id="mnchips"></div></div>
    <details class="mn-more"><summary>Zones précises du fournisseur (facultatif)</summary><div class="mn-chips" id="mnchips2"></div></details>
    <details class="mn-more" id="mncolsd"><summary>Dessiner une colonne à la main (si la détection est fausse)</summary><div class="mn-chips" id="mnchips3"></div></details>
    <div class="mn-bar"><button type="button" class="btn sm" data-pg="-1" aria-label="Page précédente">‹</button><span id="mnpg"></span><button type="button" class="btn sm" data-pg="1" aria-label="Page suivante">›</button><span class="sp"></span><button type="button" class="btn sm" data-zm="-1" aria-label="Réduire">−</button><button type="button" class="btn sm" data-zm="1" aria-label="Agrandir">＋</button></div>
    <div class="mn-wrap" id="mnwrap"><div class="mn-page" id="mnpage"><canvas id="mncv"></canvas><div class="mn-ov" id="mnov"></div></div></div>
    <div id="mnbands"></div>
    <h4 class="mn-h">Fournisseur</h4><div class="mn-fields" id="mnsup">${SUP.map(([k, l]) => `<label class="f"><span>${l}</span><input data-v="${k}" autocomplete="off"></label>`).join('')}</div>
    <h4 class="mn-h">Facture</h4><div class="mn-fields" id="mninv">${INV.map(([k, l]) => `<label class="f"><span>${l}</span><input data-v="${k}" autocomplete="off"></label>`).join('')}</div>
    <div id="mnprev"></div>
    <label class="f full"><span><input type="checkbox" id="mnmem" checked> <span id="mnmemt"></span></span></label>
    <div class="row"><button type="button" class="btn primary" id="mnok" disabled>Continuer vers le contrôle ›</button><button type="button" class="btn ghost" id="mnclr">Effacer les zones</button>${preset && o.forgetLayout ? '<button type="button" class="btn ghost" id="mnforget">Oublier la mise en page mémorisée</button>' : ''}</div></div>`;

  const wrap = $('#mnwrap', out), cv = $('#mncv', out), ov = $('#mnov', out);
  const chipHtml = list => list.map(([id, l]) => `<button type="button" class="mn-chip" data-act="${id}">${e(l)}</button>`).join('');
  $('#mnchips', out).innerHTML = chipHtml(CHIPS);
  $('#mnchips2', out).innerHTML = chipHtml(MORE);
  $('#mnchips3', out).innerHTML = chipHtml(L.COLS.map(c => ['col.' + c, L.COL_LABEL[c]]));

  /* ---- page affichée ---- */
  async function paint() {
    const my = ++st.paint;
    const page = await raw.doc.getPage(st.pg + 1);
    if (my !== st.paint) return;
    const base = page.getViewport({ scale: 1 });
    const avail = Math.max(260, (wrap.clientWidth || 640) - 6);
    const css = Math.min(2.2, avail / base.width) * ZOOMS[st.zi];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: css * dpr });
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const wpx = Math.round(vp.width / dpr) + 'px', hpx = Math.round(vp.height / dpr) + 'px';
    cv.style.width = ov.style.width = wpx; cv.style.height = ov.style.height = hpx;
    $('#mnpg', out).textContent = `Page ${st.pg + 1} / ${raw.pages.length}`;
    try { await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; } catch { /* rendu interrompu par un nouveau rendu */ }
    drawZones();
  }
  const pct = v => (v * 100).toFixed(2) + '%';
  function drawZones() {
    const h = [];
    for (const [id, z] of Object.entries(st.zones)) if (z.p === st.pg) h.push(`<div class="mn-z ${id.startsWith('sup.') ? 'sup' : 'inv'}${z.x0 > 0.45 ? ' lft' : ''}" style="left:${pct(z.x0)};top:${pct(z.y0)};width:${pct(z.x1 - z.x0)};height:${pct(z.y1 - z.y0)}"><span>${e(LABEL[id] || id)}</span></div>`);
    if (st.tbl && st.tbl.p === st.pg) {
      h.push(`<div class="mn-z tbl" style="left:${pct(st.tbl.x0)};top:${pct(st.tbl.y0)};width:${pct(st.tbl.x1 - st.tbl.x0)};height:${pct(st.tbl.y1 - st.tbl.y0)}"><span>Tableau</span></div>`);
      st.bands.forEach((b, k) => h.push(`<div class="mn-b ${b.field ? 'on' : ''}" style="left:${pct(b.a)};top:${pct(st.tbl.y0)};width:${pct(b.b - b.a)};height:${pct(st.tbl.y1 - st.tbl.y0)}"><span>${e(b.field ? L.COL_LABEL[b.field] : '?')}</span></div>`));
    }
    ov.innerHTML = h.join('');
  }

  /* ---- panneaux ---- */
  function renderChips() {
    $$('.mn-chip', out).forEach(b => {
      const id = b.dataset.act;
      const done = id === 'tbl' ? !!st.tbl : id.startsWith('col.') ? st.bands.some(x => x.field === id.slice(4)) : !!st.zones[id];
      b.classList.toggle('on', st.act === id); b.classList.toggle('ok', done && st.act !== id);
      if (id.startsWith('col.')) b.disabled = !st.tbl;
    });
    ov.classList.toggle('act', !!st.act);
    $('#mnhelp', out).innerHTML = st.act
      ? `<b>Entourez « ${e(LABEL[st.act])} »</b> sur le document : glissez un rectangle, ou touchez un mot. <button type="button" class="btn sm" id="mncancel">Annuler</button>`
      : (st.tbl ? 'Choisissez un autre champ à entourer, ou vérifiez ci-dessous l\'affectation des colonnes puis les lignes lues.' : '① Entourez le <b>tableau des lignes</b> (de la 1re ligne de produit à la dernière) · ② entourez le <b>fournisseur</b>, le <b>n° de facture</b> et la <b>date</b>. Faites défiler ou agrandissez (＋) la page <u>avant</u> de choisir un champ.');
    const c = $('#mncancel', out); if (c) c.onclick = () => { st.act = ''; refresh(); };
  }
  function renderBands() {
    const box = $('#mnbands', out);
    if (!st.bands.length) { box.innerHTML = st.tbl ? '<p class="bad">Aucune colonne détectée dans cette zone : entourez le tableau plus large, ou dessinez les colonnes à la main.</p>' : ''; return; }
    box.innerHTML = `<h4 class="mn-h">Colonnes du tableau</h4><div class="mn-bands">${st.bands.map((b, k) => `<div class="mn-band"><small class="muted">Colonne ${k + 1}${b.head || b.ex ? ' · ' + e((b.head || b.ex).slice(0, 26)) : ''}</small>
      <select data-bk="${k}"><option value="">— ignorer —</option>${L.COLS.map(c => `<option value="${c}" ${b.field === c ? 'selected' : ''}>${L.COL_LABEL[c]}</option>`).join('')}</select>
      ${k < st.bands.length - 1 ? `<button type="button" class="btn sm ghost" data-mg="${k}" title="Fusionner avec la colonne suivante">⇥</button>` : ''}</div>`).join('')}</div>`;
  }
  function renderFields(res) {
    $$('[data-v]', out).forEach(i => {
      if (document.activeElement === i) return;
      const k = i.dataset.v, v = SUP.some(x => x[0] === k) ? res.supplier[k] : res.invoice[k];
      i.value = v ?? '';
    });
  }
  function renderPrev(res) {
    const it = res.items;
    $('#mnprev', out).innerHTML = !st.tbl ? '' : it.length
      ? `<h4 class="mn-h">Lignes lues : ${it.length} — total ${eur(res.sum)} HT</h4><div class="mn-prev"><table class="tbl" style="width:100%;font-size:12.5px"><thead><tr><th>Réf.</th><th>Désignation</th><th>Qté</th><th>PU HT</th><th>Montant</th></tr></thead><tbody>${it.slice(0, 8).map(x => `<tr><td>${e(x.ref)}</td><td>${e(x.name)}</td><td>${x.qty}</td><td>${x.price}</td><td>${x.amount}</td></tr>`).join('')}${it.length > 8 ? `<tr><td colspan="5" class="muted">… et ${it.length - 8} autre(s) ligne(s)</td></tr>` : ''}</tbody></table></div>`
      : `<p class="bad">Aucune ligne lue pour l'instant : vérifiez que les colonnes <b>Désignation</b> et au moins une colonne de chiffres (<b>Quantité</b>, <b>Prix</b> ou <b>Montant</b>) sont bien affectées.</p>`;
    const nm = (res.supplier.name || '').trim(), mem = $('#mnmem', out);
    mem.disabled = !nm || !st.tbl;
    $('#mnmemt', out).innerHTML = nm ? `Retenir cette mise en page pour « ${e(nm)} » : les prochaines factures de ce fournisseur seront lues automatiquement (seules les positions des zones sont gardées)` : 'Renseignez le nom du fournisseur pour retenir la mise en page';
    $('#mnok', out).disabled = !it.length;
  }
  function refresh() { const res = result(); renderChips(); renderBands(); renderFields(res); renderPrev(res); drawZones(); }

  /* Sur téléphone, la page peut être sous la ligne de flottaison : on la fait remonter sous la barre des champs */
  function reveal() {
    const top = $('.mn-top', out), body = wrap.closest('.mbody');
    if (!body || !top) return;
    wrap.style.scrollMarginTop = (top.offsetHeight + 6) + 'px';
    const r = wrap.getBoundingClientRect(), b = body.getBoundingClientRect();
    if (r.top > b.bottom - 160 || r.top < b.top + top.offsetHeight) wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* ---- affectation d'une zone ---- */
  function assign(id, z) {
    if (id === 'tbl') { st.tbl = z; st.bands = L.detectBands(raw.pages, raw.sizes, z); }
    else if (id.startsWith('col.')) st.bands = L.insertBand(st.bands, { a: z.x0, b: z.x1, field: id.slice(4) });
    else { st.zones[id] = z; (ZKEYS[id] || []).forEach(k => delete st.values[k]); }
    st.act = ''; refresh();
  }

  /* ---- dessin sur la page (souris, doigt, stylet) ---- */
  let drag = null, box = null;
  ov.addEventListener('pointerdown', ev => {
    if (!st.act) return;
    ev.preventDefault(); ov.setPointerCapture?.(ev.pointerId);
    const r = ov.getBoundingClientRect();
    drag = { r, x: ev.clientX - r.left, y: ev.clientY - r.top, moved: false };
    box = document.createElement('div'); box.className = 'mn-z drag'; ov.append(box);
  });
  ov.addEventListener('pointermove', ev => {
    if (!drag) return;
    const x = ev.clientX - drag.r.left, y = ev.clientY - drag.r.top;
    if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 5) drag.moved = true;
    Object.assign(box.style, { left: Math.min(x, drag.x) + 'px', top: Math.min(y, drag.y) + 'px', width: Math.abs(x - drag.x) + 'px', height: Math.abs(y - drag.y) + 'px' });
  });
  const end = ev => {
    if (!drag) return;
    const d = drag; drag = null; box?.remove(); box = null;
    const x = ev.clientX - d.r.left, y = ev.clientY - d.r.top, W = d.r.width || 1, H = d.r.height || 1;
    const clamp = v => Math.max(0, Math.min(1, v));
    let z;
    if (d.moved) z = { p: st.pg, x0: clamp(Math.min(x, d.x) / W), y0: clamp(Math.min(y, d.y) / H), x1: clamp(Math.max(x, d.x) / W), y1: clamp(Math.max(y, d.y) / H) };
    else z = L.itemAt(raw.pages, raw.sizes, st.pg, clamp(d.x / W), clamp(d.y / H));
    if (!z) { $('#mnhelp', out).insertAdjacentHTML('beforeend', ' <span class="bad">Aucun texte à cet endroit : glissez un rectangle autour de la zone.</span>'); return; }
    assign(st.act, z);
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', ev => { drag = null; box?.remove(); box = null; });

  /* ---- boutons ---- */
  out.querySelector('.mn').addEventListener('click', ev => {
    const chip = ev.target.closest('.mn-chip'); if (chip && !chip.disabled) { st.act = st.act === chip.dataset.act ? '' : chip.dataset.act; renderChips(); if (st.act) reveal(); return; }
    const pg = ev.target.closest('[data-pg]'); if (pg) { st.pg = Math.max(0, Math.min(raw.pages.length - 1, st.pg + +pg.dataset.pg)); paint(); return; }
    const zm = ev.target.closest('[data-zm]'); if (zm) { st.zi = Math.max(0, Math.min(ZOOMS.length - 1, st.zi + +zm.dataset.zm)); paint(); return; }
    const mg = ev.target.closest('[data-mg]'); if (mg) { st.bands = L.mergeNext(st.bands, +mg.dataset.mg); refresh(); }
  });
  out.querySelector('.mn').addEventListener('change', ev => {
    const s = ev.target.closest('[data-bk]');
    if (s) { const k = +s.dataset.bk, f = s.value; if (f) st.bands.forEach((b, j) => { if (j !== k && b.field === f) b.field = ''; }); st.bands[k].field = f; refresh(); }
  });
  out.querySelector('.mn').addEventListener('input', ev => {
    const i = ev.target.closest('[data-v]'); if (!i) return;
    st.values[i.dataset.v] = i.value; const res = result(); renderPrev(res);
  });
  $('#mnclr', out).onclick = () => { st.zones = {}; st.tbl = null; st.bands = []; st.values = {}; st.act = ''; refresh(); };
  const fg = $('#mnforget', out);
  if (fg) fg.onclick = async () => { await o.forgetLayout(preset); fg.remove(); $('#mnhelp', out).insertAdjacentHTML('beforeend', ' <span class="muted">Mise en page oubliée.</span>'); };
  $('#mnok', out).onclick = async () => {
    const res = result(); if (!res.items.length) return;
    if ($('#mnmem', out).checked && !$('#mnmem', out).disabled && o.saveLayout) { try { await o.saveLayout(L.makeLayout(spec(), res.supplier.name)); } catch { /* mémoire facultative */ } }
    o.onDone(res);
  };

  refresh();
  paint();
  return { state: st, refresh, result };
}
