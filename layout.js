// Mise en page visuelle des devis / factures / avoirs : page A4 virtuelle, blocs déplaçables et redimensionnables.
// Un modèle (tpl) = deux zones (en-tête, pied) de coordonnées en millimètres ; le tableau des lignes s'écoule entre les deux.
import * as db from './db.js';
import { e, toast, compressImage, $, $$ } from './util.js';
import { alertBox, confirmBox } from './dialogs.js';

export const MM = 96 / 25.4;           // pixels CSS par millimètre
export const PAGE_W = 186;             // largeur utile (A4 - 2 × 12 mm)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = v => Math.round(v * 10) / 10;
const n0 = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const T1 = { quote: 'q', invoice: 'i', credit: 'c' };

/* Blocs disponibles : clé → [libellé, zone par défaut (h = en-tête, f = pied), types concernés] */
export const BLOCKS = {
  logo: ['Logo', 'h', 'qic'], coName: ['Nom de l\'entreprise', 'h', 'qic'], coInfo: ['Coordonnées de l\'entreprise', 'h', 'qic'], certs: ['RGE / assurances', 'h', 'qic'],
  client: ['Bloc client', 'h', 'qic'], chantier: ['Réf. chantier', 'h', 'qic'], title: ['Titre du document', 'h', 'qic'], intro: ['Intitulé', 'h', 'qic'],
  dateLine: ['Ville / date', 'h', 'qic'], note: ['Remarque', 'h', 'qi'],
  methods: ['Moyens de paiement', 'f', 'q'], pay: ['Conditions de règlement', 'f', 'qi'], creditTxt: ['Mention de l\'avoir', 'f', 'c'],
  sigLeft: ['Signature', 'f', 'qic'], bank: ['Coordonnées bancaires', 'f', 'qi'],
  delay: ['Délai d\'exécution', 'f', 'q'], legal: ['Mentions légales (TVA, RCS, médiateur)', 'f', 'qic']
};
/* Clé de texte (zones) modifiable d'un bloc ; les autres blocs (logo, intitulé, remarque) viennent du document */
const ZK = { coName: 'coName', coInfo: 'coInfo', certs: 'certs', client: 'client', chantier: 'chantier', title: 'title', dateLine: 'dateLine', methods: 'methods', pay: 'payLbl', creditTxt: 'creditTxt', sigLeft: 'sigLeft', bank: 'bank', delay: 'delay', legal: 'legal' };
export const TBL_ZONES = [['thRef', 'Colonne Réf. (si activée)'], ['thDes', 'Colonne 1'], ['thQty', 'Colonne 2'], ['thUnit', 'Colonne 3'], ['thPu', 'Colonne 4'], ['thHt', 'Dernière colonne (prix HT)'], ['thTva', 'Colonne TVA (si plusieurs taux)'], ['lblGross', 'Libellé « total HT avant remise »'], ['lblDisc', 'Libellé « remise »'], ['lblHt', 'Libellé total HT'], ['lblTva', 'Libellé TVA'], ['lblTtc', 'Libellé total TTC'], ['lblOpt', 'Libellé « options non comprises »'], ['lblPaid', 'Libellé « déjà réglé »'], ['lblLeft', 'Libellé « reste à payer »']];
const TBL_LY = [['fs', 'Taille du texte (px)', 9, 18, 0.5, 12.5], ['pad', 'Hauteur des lignes (px)', 1, 16, 1, 5], ['cQty', 'Largeur Qté (%)', 4, 30, 1, ''], ['cUnit', 'Largeur Unité (%)', 4, 30, 1, ''], ['cPu', 'Largeur Prix unit. (%)', 6, 30, 1, ''], ['cHt', 'Largeur Prix H.T (%)', 6, 30, 1, '']];

const I = (k, x, y, w, h, z) => ({ id: k, k, z, x, y, w, h });
const LEGAL = y => ({ ...I('legal', 0, y, 186, 12, 'f'), st: { fs: 10, al: 'center' } }); // mentions légales : petite police, centrées, en bas de page
export function defaultTpl(type) {
  const c = type === 'credit', q = type === 'quote';
  const head = [I('logo', 0, 0, 52, 24, 'h'), I('coName', 0, 26, 90, 12, 'h'), I('coInfo', 0, 39, 90, 38, 'h'), I('certs', 96, 0, 90, 12, 'h'), I('client', 96, 14, 90, 24, 'h'), I('chantier', 96, 44, 90, 22, 'h'),
    I('title', 0, 79, 186, 9, 'h'), I('intro', 0, 90, 112, 9, 'h'), I('dateLine', 114, 90, 72, 9, 'h')];
  if (!c) head.push(I('note', 0, 100, 186, 10, 'h'));
  const foot = c ? [I('creditTxt', 0, 0, 186, 14, 'f'), I('sigLeft', 0, 18, 90, 22, 'f'), LEGAL(44)]
    : q ? [I('methods', 0, 0, 186, 9, 'f'), I('pay', 0, 10, 186, 28, 'f'), I('delay', 0, 39, 186, 6, 'f'), I('sigLeft', 0, 48, 90, 22, 'f'), I('bank', 96, 48, 90, 20, 'f'), LEGAL(72)]
    : [I('pay', 0, 0, 186, 28, 'f'), I('sigLeft', 0, 32, 90, 22, 'f'), I('bank', 96, 32, 90, 20, 'f'), LEGAL(58)];
  return { v: 3, headH: 112, footH: c ? 56 : q ? 86 : 72, items: [...head, ...foot] };
}
export function normTpl(t, type) {
  const d = defaultTpl(type);
  if (!t || !Array.isArray(t.items)) return d;
  const items = t.items.filter(it => it && it.k && (it.z === 'h' || it.z === 'f')).map(it => ({ ...it, id: it.id || it.k, x: n0(it.x), y: n0(it.y), w: Math.max(3, n0(it.w) || 20), h: Math.max(3, n0(it.h) || 8) }));
  let footH = n0(t.footH) || d.footH;
  if ((t.v || 2) < 3) { // modèles enregistrés avant la v3 : ajoute, sous leur pied de page, le délai d'exécution (devis) et les mentions légales
    let y = footH;
    if (type === 'quote' && !items.some(i => i.k === 'delay')) { items.push(I('delay', 0, y, 186, 6, 'f')); y += 7; }
    if (!items.some(i => i.k === 'legal')) { items.push(LEGAL(y)); y += 13; }
    footH = y;
  }
  return { v: 3, headH: n0(t.headH) || d.headH, footH, items };
}
export async function loadTplStore() { return (await db.get('settings', 'tpl'))?.value || {}; }
export async function saveTplStore(v) { await db.put('settings', { id: 'tpl', value: v }); }
export async function imagesOf(tpl) {
  const out = {};
  for (const it of tpl.items) if (it.k === 'image' && it.img && !(it.img in out)) out[it.img] = (await db.get('photos', it.img))?.data || '';
  return out;
}

/* ---------- Rendu d'une zone (utilisé par l'impression, l'aperçu et l'éditeur) ---------- */
function itemHtml(it, content) {
  const st = it.st || {}, css = [`left:${it.x}mm`, `top:${it.y}mm`, `width:${it.w}mm`, `height:${it.h}mm`];
  if (st.fs) css.push(`font-size:${n0(st.fs)}px`);
  if (st.b === 1) css.push('font-weight:700'); else if (st.b === 0) css.push('font-weight:400');
  if (st.i === 1) css.push('font-style:italic'); else if (st.i === 0) css.push('font-style:normal');
  if (st.u === 1) css.push('text-decoration:underline'); else if (st.u === 0) css.push('text-decoration:none');
  if (st.c && /^#[0-9a-f]{3,8}$/i.test(st.c)) css.push('color:' + st.c);
  if (st.bg && /^#[0-9a-f]{3,8}$/i.test(st.bg)) css.push('background:' + st.bg);
  if (['left', 'center', 'right'].includes(st.al)) css.push('text-align:' + st.al);
  return `<div class="li c-${e(it.k)}" data-id="${e(it.id)}" style="${css.join(';')}">${content(it)}</div>`;
}
export function canvasHtml(tpl, zone, content, layoutEdit) {
  const h = zone === 'h' ? tpl.headH : tpl.footH;
  return `<div class="cv ${zone === 'h' ? 'head' : 'foot'}" data-cv="${zone}" style="height:${h}mm">${tpl.items.filter(i => i.z === zone).map(i => itemHtml(i, content)).join('')}${layoutEdit ? `<div class="cvh" data-cvh="${zone}" title="Hauteur de la zone – faites glisser">↕ ${zone === 'h' ? 'fin de l\'en-tête' : 'fin du pied de page'}</div>` : ''}</div>`;
}

/* ---------- Mise à l'échelle d'une feuille A4 dans un écran étroit ---------- */
export function fitPaper(outer, inner, zoom = 1) {
  const apply = () => {
    const W = inner.offsetWidth || 0, avail = outer.clientWidth || 0;
    const k = W && avail ? Math.max(0.15, Math.min(3, avail / W * zoom)) : 1;
    inner.style.transformOrigin = '0 0'; inner.style.transform = k === 1 ? '' : `scale(${k})`;
    outer.style.height = inner.offsetHeight ? Math.round(inner.offsetHeight * k) + 'px' : '';
    return k;
  };
  let k = apply();
  const onResize = () => { if (!outer.isConnected) return window.removeEventListener('resize', onResize); k = apply(); };
  window.addEventListener('resize', onResize);
  return { apply: () => (k = apply()), get k() { return k; } };
}

/* ---------- Éditeur visuel plein écran ----------
   o = { title, type, ws:{tpl, zones, layout}, render(ws, true) → html de la feuille, defaultOf(zoneKey) → texte par défaut,
         base() → ws du modèle d'origine, onSave(ws) } */
export async function openLayoutEditor(o) {
  const ws = JSON.parse(JSON.stringify(o.ws));
  ws.tpl = normTpl(ws.tpl, o.type); ws.zones = ws.zones || {}; ws.layout = ws.layout || {};
  const ty = T1[o.type] || 'q';
  const start = JSON.stringify(ws);
  const undo = [], redo = [];
  let sel = null, snap = 1, zoom = 1, pend = 0, k = 1, menuOpen = false;

  const ov = document.createElement('div'); ov.id = 'lyed';
  ov.innerHTML = `<div class="lytop"><button type="button" class="btn sm" data-a="close">✕ Fermer</button><b class="lyt">${e(o.title)}</b><span class="sp"></span>
      <button type="button" class="btn sm" data-a="undo" title="Annuler">↶</button><button type="button" class="btn sm" data-a="redo" title="Rétablir">↷</button>
      <button type="button" class="btn sm" data-a="zout" title="Zoom −">−</button><button type="button" class="btn sm" data-a="zin" title="Zoom +">+</button>
      <button type="button" class="btn sm" data-a="add">＋ Ajouter ▾</button>
      <button type="button" class="btn sm" data-a="base" title="Revenir au modèle d'origine">↺ Modèle</button>
      <button type="button" class="btn sm primary" data-a="save">Enregistrer</button></div>
    <div class="lymenu" hidden></div>
    <div class="lybody"><div class="lystage"><div class="lyfit"><div class="lyin"><div class="lypage"></div></div></div></div><div class="lypanel"></div></div>
    <input type="file" accept="image/*" class="lyfile" hidden>`;
  document.body.appendChild(ov);
  document.body.classList.add('lyopen');
  const stage = $('.lystage', ov), fitEl = $('.lyfit', ov), inEl = $('.lyin', ov), page = $('.lypage', ov), panel = $('.lypanel', ov), menu = $('.lymenu', ov), fileIn = $('.lyfile', ov);

  const snapshot = () => JSON.stringify(ws);
  const restore = s => { const w = JSON.parse(s); ws.tpl = w.tpl; ws.zones = w.zones; ws.layout = w.layout; };
  const push = () => { undo.push(snapshot()); if (undo.length > 50) undo.shift(); redo.length = 0; };
  const touch = () => { if (!pend) { push(); pend = setTimeout(() => { pend = 0; }, 700); } };
  const item = id => ws.tpl.items.find(i => i.id === id);
  const tx = key => key in ws.zones ? ws.zones[key] : o.defaultOf(key);
  const setTx = (key, v) => { if (v === o.defaultOf(key)) delete ws.zones[key]; else ws.zones[key] = v; };
  const labelOf = it => it.k === 'text' ? 'Texte libre' : it.k === 'image' ? 'Image' : BLOCKS[it.k]?.[0] || it.k;

  const fit = () => {
    const W = inEl.offsetWidth || 0, avail = stage.clientWidth - 16;
    k = W && avail > 0 ? clamp(avail / W * zoom, 0.15, 3) : zoom;
    inEl.style.transformOrigin = '0 0'; inEl.style.transform = `scale(${k})`;
    fitEl.style.width = W ? Math.round(W * k) + 'px' : ''; fitEl.style.height = inEl.offsetHeight ? Math.round(inEl.offsetHeight * k) + 'px' : '';
  };
  const decorate = () => {
    $$('.sel', page).forEach(n => n.classList.remove('sel')); $$('.lirz', page).forEach(n => n.remove());
    if (sel === ':tbl') $('.tblwrap', page)?.classList.add('sel');
    else if (sel) { const n = $$('.li', page).find(x => x.dataset.id === sel); if (n) { n.classList.add('sel'); n.insertAdjacentHTML('beforeend', '<i class="lirz" title="Redimensionner"></i>'); } }
  };
  let rq = 0;
  const redraw = async () => {
    const my = ++rq; const html = await o.render(ws, true);
    if (my !== rq) return;
    page.innerHTML = html; decorate(); fit();
  };
  let rt = 0; const redrawSoon = () => { clearTimeout(rt); rt = setTimeout(redraw, 80); };

  /* ----- Panneau de propriétés ----- */
  const num = (p, v, extra = '') => `<label class="f"><span>${p[1]}</span><input type="number" data-p="${p[0]}" value="${v ?? ''}" ${extra}></label>`;
  const panelHtml = () => {
    if (sel === ':tbl') {
      return `<h4>Tableau des lignes</h4><p class="muted">Le tableau s'étend entre l'en-tête et le pied de page. Modifiez ici ses titres, libellés et dimensions.</p>
        <div class="cols">${TBL_ZONES.map(([kz, l]) => `<label class="f full"><span>${l}</span><input data-tz="${kz}" value="${e(tx(kz))}"></label>`).join('')}
        ${o.type !== 'credit' ? `<label class="f full"><span>Mention du client – TVA à taux réduit (imprimée sous les totaux quand un taux de 5,5 ou 10 % est utilisé ; vide = pas de mention)</span><textarea rows="7" data-tz="vatRed">${e(tx('vatRed'))}</textarea></label>` : ''}
        ${TBL_LY.map(([kl, l, mn, mx, st, df]) => `<label class="f"><span>${l}</span><input type="number" data-ly="${kl}" min="${mn}" max="${mx}" step="${st}" value="${ws.layout[kl] ?? ''}" placeholder="${df === '' ? 'auto' : df}"></label>`).join('')}</div>`;
    }
    const it = sel && item(sel);
    if (!it) {
      return `<h4>Page ${e(o.title.replace(/^Mise en page – /, ''))}</h4>
        <p class="muted" style="margin:0 0 8px">Touchez un bloc pour le sélectionner, glissez-le pour le déplacer, tirez son coin ◢ pour l'agrandir ou le réduire. Touchez le tableau pour modifier ses titres et colonnes.</p>
        <div class="cols"><label class="f"><span>Hauteur de l'en-tête (mm)</span><input type="number" data-pg="headH" value="${ws.tpl.headH}" min="20" max="250"></label>
        <label class="f"><span>Hauteur du pied de page (mm)</span><input type="number" data-pg="footH" value="${ws.tpl.footH}" min="10" max="250"></label>
        <label class="f"><span>Aimantation</span><select data-pg="snap"><option value="0" ${snap === 0 ? 'selected' : ''}>Libre</option><option value="0.5" ${snap === 0.5 ? 'selected' : ''}>0,5 mm</option><option value="1" ${snap === 1 ? 'selected' : ''}>1 mm</option><option value="5" ${snap === 5 ? 'selected' : ''}>5 mm</option></select></label></div>
        <p class="muted" style="margin-top:8px">Astuce : les flèches du clavier déplacent le bloc sélectionné (Maj = 5 mm).</p>`;
    }
    const st = it.st || {}, zk = ZK[it.k], isTxt = it.k === 'text', isImg = it.k === 'image' || it.k === 'logo';
    const tri = (key, lab, tt) => `<button type="button" class="btn sm ${st[key] === 1 ? 'on' : ''}" data-tri="${key}" title="${tt} (appuyez : forcer / retirer / défaut)">${st[key] === 0 ? '<s>' + lab + '</s>' : lab}</button>`;
    return `<h4>${e(labelOf(it))}</h4>
      ${zk ? `<label class="f full"><span>Texte</span><textarea data-tx rows="5">${e(tx(zk))}</textarea></label>
        <div class="row" style="margin:0 0 6px"><button type="button" class="btn sm" data-wrap="**">G sélection</button><button type="button" class="btn sm" data-wrap="__">S sélection</button><button type="button" class="btn sm" data-a="txreset">↺ Texte d'origine</button></div>
        <p class="muted" style="margin:0 0 8px">Jetons : {numero} {date} {ville} {validite} {siteRef} {siteAddr} {company} {iban} {bic}</p>` : ''}
      ${isTxt ? `<label class="f full"><span>Texte</span><textarea data-tx rows="5">${e(it.t || '')}</textarea></label><div class="row" style="margin:0 0 6px"><button type="button" class="btn sm" data-wrap="**">G sélection</button><button type="button" class="btn sm" data-wrap="__">S sélection</button></div>` : ''}
      ${it.k === 'intro' || it.k === 'note' ? '<p class="muted">Ce texte se modifie dans le document (champ « ' + (it.k === 'intro' ? 'Intitulé' : 'Remarque') + ' », avec mise en forme riche).</p>' : ''}
      ${it.k === 'logo' ? '<p class="muted">Le logo se change dans Réglages › Entreprise. Tirez le coin pour l\'agrandir.</p>' : ''}
      ${it.k === 'image' ? '<div class="row" style="margin:0 0 6px"><button type="button" class="btn sm" data-a="replimg">Remplacer l\'image</button></div>' : ''}
      ${isImg ? '' : `<div class="row lyfmt">${tri('b', '<b>G</b>', 'Gras')}${tri('i', '<i>I</i>', 'Italique')}${tri('u', '<u>S</u>', 'Souligné')}
        <label class="f inl"><span>Taille</span><input type="number" data-st="fs" value="${st.fs || ''}" placeholder="auto" min="6" max="60" step="0.5"></label>
        <label class="f inl"><span>Couleur</span><input type="color" data-st="c" value="${st.c || '#000000'}"></label>${st.c ? '<button type="button" class="btn sm" data-clr="c">✕</button>' : ''}</div>`}
      <div class="row lyfmt">${isImg ? '' : ['left', 'center', 'right'].map(a => `<button type="button" class="btn sm ${st.al === a ? 'on' : ''}" data-al="${a}">${{ left: '⬅', center: '↔', right: '➡' }[a]}</button>`).join('')}
        <label class="f inl"><span>Fond</span><input type="color" data-st="bg" value="${st.bg || '#ffffff'}"></label>${st.bg ? '<button type="button" class="btn sm" data-clr="bg">✕</button>' : ''}</div>
      <div class="cols lypos">${[['x', 'X (mm)'], ['y', 'Y (mm)'], ['w', 'Largeur'], ['h', 'Hauteur']].map(p => num(p, r1(it[p[0]]), 'step="0.5"')).join('')}</div>
      <div class="row">${isTxt || it.k === 'image' ? '<button type="button" class="btn sm" data-a="dup">⧉ Dupliquer</button>' : ''}<button type="button" class="btn sm" data-a="front">⤒ Devant</button><button type="button" class="btn sm" data-a="back">⤓ Derrière</button><button type="button" class="btn sm danger" data-a="del">🗑 Supprimer</button></div>`;
  };
  const showPanel = () => { panel.innerHTML = panelHtml(); };
  const select = id => { sel = id; decorate(); showPanel(); };

  /* ----- Glisser / redimensionner ----- */
  const snapv = v => snap ? Math.round(v / snap) * snap : v;
  const onDrag = (ev0, move, end) => {
    const before = snapshot(); let moved = false;
    const mv = ev => { moved = true; move((ev.clientX - ev0.clientX) / (k * MM), (ev.clientY - ev0.clientY) / (k * MM)); ev.preventDefault?.(); };
    const up = () => {
      document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
      if (moved && snapshot() !== before) { undo.push(before); redo.length = 0; end?.(); }
    };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  };
  const place = (it, el) => { el.style.left = it.x + 'mm'; el.style.top = it.y + 'mm'; el.style.width = it.w + 'mm'; el.style.height = it.h + 'mm'; };
  const zoneH = z => z === 'h' ? ws.tpl.headH : ws.tpl.footH;
  page.addEventListener('pointerdown', ev => {
    const cvh = ev.target.closest('.cvh'), rz = ev.target.closest('.lirz'), li = ev.target.closest('.li'), tb = ev.target.closest('.tblwrap');
    if (cvh) {
      const z = cvh.dataset.cvh, h0 = zoneH(z), key = z === 'h' ? 'headH' : 'footH', cv = cvh.parentElement;
      return onDrag(ev, (dx, dy) => { ws.tpl[key] = clamp(r1(snapv(h0 + dy)), 10, 260); cv.style.height = ws.tpl[key] + 'mm'; }, () => { if (!sel) showPanel(); });
    }
    if (li) {
      const it = item(li.dataset.id); if (!it) return;
      if (sel !== it.id) select(it.id);
      if (ev.target.closest('a,input,textarea')) return;
      const el = $$('.li', page).find(x => x.dataset.id === it.id);
      if (rz) {
        const w0 = it.w, h0 = it.h, ratio = w0 / h0, keep = it.k === 'logo' || it.k === 'image';
        return onDrag(ev, (dx, dy) => { it.w = clamp(r1(snapv(w0 + dx)), 3, PAGE_W - it.x); it.h = keep ? r1(it.w / ratio) : clamp(r1(snapv(h0 + dy)), 3, 260); place(it, el); }, showPanel);
      }
      const x0 = it.x, y0 = it.y;
      return onDrag(ev, (dx, dy) => { it.x = clamp(r1(snapv(x0 + dx)), 0, PAGE_W - 3); it.y = clamp(r1(snapv(y0 + dy)), 0, zoneH(it.z) - 3); place(it, el); }, showPanel);
    }
    select(tb ? ':tbl' : null);
  });

  /* ----- Panneau : saisies ----- */
  const wrapSel = (ta, mark) => {
    const a = ta.selectionStart, b = ta.selectionEnd; if (a === b) return;
    ta.value = ta.value.slice(0, a) + mark + ta.value.slice(a, b) + mark + ta.value.slice(b);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  panel.addEventListener('input', ev => {
    const t = ev.target, it = sel && sel !== ':tbl' ? item(sel) : null;
    if (t.dataset.tx !== undefined && it) { touch(); if (it.k === 'text') it.t = t.value; else setTx(ZK[it.k], t.value); redrawSoon(); }
    else if (t.dataset.tz) { touch(); setTx(t.dataset.tz, t.value); redrawSoon(); }
    else if (t.dataset.ly) { touch(); if (t.value === '') delete ws.layout[t.dataset.ly]; else ws.layout[t.dataset.ly] = t.value; redrawSoon(); }
    else if (t.dataset.pg) {
      if (t.dataset.pg === 'snap') { snap = parseFloat(t.value) || 0; return; }
      touch(); ws.tpl[t.dataset.pg] = clamp(n0(t.value) || 20, 5, 260); redrawSoon();
    } else if (it && t.dataset.p) { touch(); it[t.dataset.p] = Math.max(t.dataset.p === 'x' || t.dataset.p === 'y' ? 0 : 3, n0(t.value)); redrawSoon(); }
    else if (it && t.dataset.st) { touch(); it.st = it.st || {}; if (t.dataset.st === 'fs' && t.value === '') delete it.st.fs; else it.st[t.dataset.st] = t.dataset.st === 'fs' ? n0(t.value) : t.value; redrawSoon(); }
  });
  panel.addEventListener('change', ev => { if (ev.target.dataset.st === 'c' || ev.target.dataset.st === 'bg') showPanel(); });
  panel.addEventListener('click', async ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const it = sel && sel !== ':tbl' ? item(sel) : null;
    if (b.dataset.wrap) { const ta = $('[data-tx]', panel); if (ta) wrapSel(ta, b.dataset.wrap); return; }
    if (!it) return;
    if (b.dataset.tri) { push(); it.st = it.st || {}; const v = it.st[b.dataset.tri]; if (v === undefined) it.st[b.dataset.tri] = 1; else if (v === 1) it.st[b.dataset.tri] = 0; else delete it.st[b.dataset.tri]; showPanel(); redraw(); }
    else if (b.dataset.al) { push(); it.st = it.st || {}; if (it.st.al === b.dataset.al) delete it.st.al; else it.st.al = b.dataset.al; showPanel(); redraw(); }
    else if (b.dataset.clr) { push(); delete (it.st || {})[b.dataset.clr]; showPanel(); redraw(); }
    else act(b.dataset.a);
  });

  /* ----- Actions ----- */
  const addItem = async (k, z, extra = {}) => {
    push();
    const it = { id: k === 'text' || k === 'image' ? 'x' + db.uid() : k, k, z, x: 8, y: 8, w: 60, h: 14, ...extra };
    if (BLOCKS[k] && k !== 'text') { const d = defaultTpl(o.type).items.find(i => i.k === k); if (d) Object.assign(it, { x: d.x, y: d.y, w: d.w, h: d.h, z: d.z }); }
    ws.tpl.items.push(it); await redraw(); select(it.id);
  };
  const act = async a => {
    const it = sel && sel !== ':tbl' ? item(sel) : null;
    if (a === 'close') {
      if (snapshot() !== start && !(await confirmBox('Abandonner les modifications de mise en page ?'))) return;
      return close();
    }
    if (a === 'save') { await o.onSave(ws); close(); return; }
    if (a === 'undo' && undo.length) { redo.push(snapshot()); restore(undo.pop()); sel = null; await redraw(); showPanel(); }
    else if (a === 'redo' && redo.length) { undo.push(snapshot()); restore(redo.pop()); sel = null; await redraw(); showPanel(); }
    else if (a === 'zin') { zoom = Math.min(3, zoom * 1.25); fit(); }
    else if (a === 'zout') { zoom = Math.max(0.4, zoom / 1.25); fit(); }
    else if (a === 'base') { if (!(await confirmBox('Revenir à la mise en page d\'origine de ce modèle ? (vos modifications non enregistrées seront perdues)'))) return; push(); const b = JSON.parse(JSON.stringify(o.base())); ws.tpl = normTpl(b.tpl, o.type); ws.zones = b.zones || {}; ws.layout = b.layout || {}; sel = null; await redraw(); showPanel(); }
    else if (a === 'add') { menuOpen = !menuOpen; renderMenu(); }
    else if (a === 'txreset' && it && ZK[it.k]) { push(); delete ws.zones[ZK[it.k]]; showPanel(); redraw(); }
    else if (a === 'del' && it) { push(); ws.tpl.items = ws.tpl.items.filter(i => i !== it); sel = null; await redraw(); showPanel(); }
    else if (a === 'dup' && it) { push(); const c = JSON.parse(JSON.stringify(it)); c.id = 'x' + db.uid(); c.x = Math.min(PAGE_W - 5, c.x + 5); c.y += 5; ws.tpl.items.push(c); await redraw(); select(c.id); }
    else if (a === 'front' && it) { push(); ws.tpl.items = [...ws.tpl.items.filter(i => i !== it), it]; await redraw(); }
    else if (a === 'back' && it) { push(); ws.tpl.items = [it, ...ws.tpl.items.filter(i => i !== it)]; await redraw(); }
    else if (a === 'replimg' && it) { fileIn.dataset.mode = 'replace'; fileIn.click(); }
  };
  ov.querySelector('.lytop').addEventListener('click', ev => { const b = ev.target.closest('[data-a]'); if (b) act(b.dataset.a); });

  const renderMenu = () => {
    menu.hidden = !menuOpen; if (!menuOpen) return;
    const have = new Set(ws.tpl.items.map(i => i.k));
    const miss = Object.entries(BLOCKS).filter(([kk, v]) => v[2].includes(ty) && !have.has(kk));
    menu.innerHTML = `${miss.map(([kk, v]) => `<button type="button" class="btn sm" data-add="${kk}">＋ ${e(v[0])}</button>`).join('')}
      <button type="button" class="btn sm" data-add="text:h">＋ Texte libre (en-tête)</button><button type="button" class="btn sm" data-add="text:f">＋ Texte libre (pied)</button>
      <button type="button" class="btn sm" data-add="image:h">＋ Image (en-tête)</button><button type="button" class="btn sm" data-add="image:f">＋ Image (pied)</button>`;
  };
  menu.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-add]'); if (!b) return;
    const [kk, z] = b.dataset.add.split(':'); menuOpen = false; renderMenu();
    if (kk === 'text') await addItem('text', z, { t: 'Votre texte ici', w: 80, h: 12 });
    else if (kk === 'image') { fileIn.dataset.mode = 'add:' + z; fileIn.click(); }
    else await addItem(kk, BLOCKS[kk][1]);
  });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0], mode = fileIn.dataset.mode || ''; fileIn.value = ''; if (!f) return;
    try {
      const data = await compressImage(f, { mode: 'logo', maxChars: 150000 });
      const id = 'tpl' + db.uid(); await db.put('photos', { id, data, v: Date.now() });
      const ratio = await new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalHeight / (im.naturalWidth || 1)); im.onerror = () => res(0.75); im.src = data; });
      if (mode === 'replace') { const it = sel && item(sel); if (it) { push(); it.img = id; await redraw(); } }
      else await addItem('image', mode.split(':')[1] || 'h', { img: id, w: 40, h: r1(40 * (ratio || 0.75)) });
    } catch (err) { alertBox(err.message || err); }
  });

  const keyH = ev => {
    if (!ov.isConnected) return document.removeEventListener('keydown', keyH);
    if (/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName) || ev.target.closest?.('.adlg')) return; // saisie ou fenêtre d'avertissement ouverte : les touches ne touchent pas à la page
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); return act(ev.shiftKey ? 'redo' : 'undo'); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); return act('redo'); }
    const it = sel && sel !== ':tbl' ? item(sel) : null; if (!it) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); return act('del'); }
    const step = ev.shiftKey ? 5 : 0.5, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (d) { ev.preventDefault(); touch(); it.x = clamp(r1(it.x + d[0]), 0, PAGE_W - 3); it.y = clamp(r1(it.y + d[1]), 0, zoneH(it.z) - 3); const el = $$('.li', page).find(x => x.dataset.id === it.id); if (el) place(it, el); showPanel(); }
  };
  document.addEventListener('keydown', keyH);
  window.addEventListener('resize', fit);

  function close() { document.removeEventListener('keydown', keyH); window.removeEventListener('resize', fit); document.body.classList.remove('lyopen'); ov.remove(); }
  await redraw(); showPanel();
  return { close, ws, select };
}
