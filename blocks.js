// Structure des devis / factures : blocs ordonnés (section, texte mis en forme, ligne produit, saut de page).
import { e, eur, num, F, modal, toast, COLOR_NAMES, $, $$ } from './util.js';
import { getS } from './defaults.js';
import * as db from './db.js';
import { UNITS, pickProduct } from './stock.js';

let SEQ = 0;
export const bid = () => 'b' + Date.now().toString(36) + (SEQ++).toString(36);

/* ---------- Nettoyage du HTML saisi (aucun script, aucun attribut dangereux) ---------- */
const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV', 'SPAN', 'FONT', 'UL', 'OL', 'LI', 'SUB', 'SUP']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE', 'SVG', 'MATH']);
const PROPS = new Set(['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'text-decoration-line']);
const SAFE_VAL = /^[#\w\s%.,()+-]+$/;
function cleanNode(src, dst, doc) {
  for (const n of [...src.childNodes]) {
    if (n.nodeType === 3) { dst.appendChild(doc.createTextNode(n.nodeValue)); continue; }
    if (n.nodeType !== 1 || DROP.has(n.tagName.toUpperCase())) continue;
    const tag = n.tagName.toUpperCase();
    if (!TAGS.has(tag)) { cleanNode(n, dst, doc); continue; }
    const out = doc.createElement(tag.toLowerCase());
    if (tag === 'FONT') {
      const c = n.getAttribute('color'); if (c && SAFE_VAL.test(c)) out.setAttribute('color', c);
      const s = n.getAttribute('size'); if (s && /^[1-7]$/.test(s)) out.setAttribute('size', s);
    }
    const st = n.getAttribute('style');
    if (st) {
      const keep = st.split(';').map(x => x.split(':')).filter(p => p.length === 2 && PROPS.has(p[0].trim().toLowerCase()) && SAFE_VAL.test(p[1].trim()) && !/expression|url\(/i.test(p[1]))
        .map(p => p[0].trim().toLowerCase() + ':' + p[1].trim());
      if (keep.length) out.setAttribute('style', keep.join(';'));
    }
    cleanNode(n, out, doc);
    dst.appendChild(out);
  }
}
export function sanitize(html) {
  const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
  const box = doc.createElement('div');
  cleanNode(doc.body, box, doc);
  return box.innerHTML;
}
export const plain = html => { const d = new DOMParser().parseFromString('<body>' + String(html || '').replace(/<br\s*\/?>/gi, ' ') + '</body>', 'text/html'); return (d.body.textContent || '').replace(/\s+/g, ' ').trim(); };

/* ---------- Modèle ---------- */
export const linesOf = bl => bl.filter(b => b.type === 'line');
/* S'assure que d.blocks existe (migration des anciennes lignes) et que d.lines en est le reflet. */
export function ensureBlocks(d) {
  if (!Array.isArray(d.blocks)) d.blocks = (d.lines || []).map(l => ({ id: bid(), type: 'line', pid: l.pid || '', desig: l.desig || '', qty: l.qty, unit: l.unit || 'u', pu: l.pu }));
  d.blocks.forEach(b => { if (!b.id) b.id = bid(); });
  d.lines = linesOf(d.blocks);
  return d;
}
export function syncLines(d) { d.lines = linesOf(d.blocks); }
export function pruneBlocks(d) {
  d.blocks = d.blocks.filter(b => b.type === 'line' ? (b.desig || num(b.pu)) : b.type === 'section' ? plain(b.title) : b.type === 'text' ? plain(b.html) : true);
  syncLines(d);
}
/* Sous-total d'une section : lignes situées entre cette section et la suivante */
export function sectionTotals(bl) {
  const out = {}; let cur = null;
  for (const b of bl) { if (b.type === 'section') { cur = b.id; out[cur] = 0; } else if (b.type === 'line' && cur) out[cur] += num(b.qty) * num(b.pu); }
  for (const k in out) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}
export const copyBlocks = bl => JSON.parse(JSON.stringify(bl || [])).map(b => ({ ...b, id: bid() }));

/* ---------- Rendu pour l'impression ---------- */
/* Couleurs par défaut (Réglages) de chaque type de ligne */
export const STY = { secColor: '#1e5aa8', secBg: '#dbe7f7', lineBg: '#ffffff', textBg: '#f6f7f9' };
export function setStyles(S) { STY.secColor = S.stSecColor || STY.secColor; STY.secBg = S.stSecBg || STY.secBg; STY.lineBg = S.stLineBg || '#ffffff'; STY.textBg = S.stTextBg || '#ffffff'; }
const LIGHT = ['#dbe7f7', '#fde8e8', '#e6f4ea', '#fff4cc', '#ece6f8', '#eeeeee', '#ffffff'];
const pal = (attr, cols, title) => `<details class="pal"><summary title="${title}">${attr === 'fc' ? 'A' : '▇'}</summary><div class="palbox">${cols.map(c => `<button type="button" class="sw" data-${attr}="${c}" style="background:${c}"></button>`).join('')}<label class="sw custom" title="Autre couleur"><input type="color" data-${attr}-x value="#c62f2f"><i>+</i></label></div></details>`;
const secStyle = b => [`color:${b.color || STY.secColor}`, `background:${b.bg === 'none' ? 'transparent' : b.bg || STY.secBg}`, b.bold !== false && 'font-weight:700', b.italic && 'font-style:italic', b.align && `text-align:${b.align}`].filter(Boolean).join(';');
export function printRows(d) {
  const st = sectionTotals(d.blocks);
  const subRow = sec => `<tr class="subt"><td colspan="4" style="text-align:right;font-style:italic">Sous-total ${e(sec.title)}</td><td class="n"><i>${eur(st[sec.id])}</i></td></tr>`;
  const out = []; let open = null;
  for (const b of d.blocks) {
    if (b.type === 'section') { if (open) out.push({ _sub: open }); open = b.sub ? b : null; }
    out.push(b);
  }
  if (open) out.push({ _sub: open });
  return out.map(b => {
    if (b._sub) return subRow(b._sub);
    const bgl = STY.lineBg && STY.lineBg.toLowerCase() !== '#ffffff' ? ` style="background:${e(STY.lineBg)}"` : '';
    const bgt = STY.textBg && STY.textBg.toLowerCase() !== '#ffffff' ? ` style="background:${e(STY.textBg)}"` : '';
    if (b.type === 'line') return `<tr${bgl}><td>${e(b.desig)}</td><td class="n">${num(b.qty)}</td><td>${e(b.unit)}</td><td class="n">${eur(num(b.pu))}</td><td class="n">${eur(num(b.qty) * num(b.pu))}</td></tr>`;
    if (b.type === 'section') return `<tr class="sec"><td colspan="5" style="${e(secStyle(b))}">${e(b.title)}</td></tr>`;
    if (b.type === 'text') return `<tr class="txt"><td colspan="5"${bgt}>${sanitize(b.html)}</td></tr>`;
    if (b.type === 'pagebreak') return '<tr class="pbk" style="page-break-after:always;break-after:page"><td colspan="5" style="border:0;padding:0;height:0"></td></tr>';
    return '';
  }).join('');
}

/* ---------- Modèles de texte (Réglages) ---------- */
export async function snippetsModal(onInsert) {
  const S = await getS();
  const list = (S.snippets || []).slice();
  const body = () => `<div id="snl">${list.map((s, i) => `<div class="item" data-i="${i}"><div class="main"><div class="t">${e(s.name)}</div><div class="s">${e(plain(s.html).slice(0, 110))}</div></div>
      <div class="r">${onInsert ? '<button type="button" class="btn sm primary" data-ins>Insérer</button>' : ''}<button type="button" class="btn sm" data-edit>✎</button><button type="button" class="btn sm danger" data-rm>✕</button></div></div>`).join('') || '<div class="empty">Aucun modèle de texte.</div>'}</div>
    <div class="row"><button type="button" class="btn" id="snnew">+ Nouveau modèle</button></div>`;
  const save = async () => { await db.saveSettings({ ...(await getS()), snippets: list }); };
  const edit = (idx) => {
    const s = idx == null ? { name: '', html: '' } : list[idx];
    modal(idx == null ? 'Nouveau modèle de texte' : 'Modèle de texte', `${F('Nom du modèle', 'name', s.name, { req: true })}<label class="f full"><span>Texte (mise en forme possible)</span><div class="rte-wrap">${toolbarHtml()}<div class="rte" contenteditable="true" id="snrte">${sanitize(s.html)}</div></div></label>`,
      async (o, f) => { s.name = o.name.trim(); s.html = sanitize(f.querySelector('#snrte').innerHTML); if (idx == null) list.push(s); await save(); setTimeout(open, 0); },
      { onOpen: f => bindToolbar(f, () => f.querySelector('#snrte')) });
  };
  const open = () => modal('Modèles de texte', body(), null, {
    wide: true, onOpen: f => {
      f.querySelector('#snnew').onclick = () => edit(null);
      f.querySelector('#snl').onclick = async ev => {
        const row = ev.target.closest('.item'); if (!row) return; const i = +row.dataset.i;
        if (ev.target.closest('[data-ins]')) { onInsert(list[i]); document.querySelector('#modal').close(); }
        else if (ev.target.closest('[data-edit]')) edit(i);
        else if (ev.target.closest('[data-rm]') && confirm('Supprimer ce modèle ?')) { list.splice(i, 1); await save(); open(); }
      };
    }
  });
  open();
}

/* ---------- Barre de mise en forme (traitement de texte) ---------- */
function toolbarHtml() {
  return `<div class="rtb">
    <button type="button" data-cmd="bold" title="Gras"><b>G</b></button><button type="button" data-cmd="italic" title="Italique"><i>I</i></button>
    <button type="button" data-cmd="underline" title="Souligné"><u>S</u></button><button type="button" data-cmd="strikeThrough" title="Barré"><s>B</s></button>
    ${pal('fc', COLOR_NAMES.map(c => c[0]).concat('#ffffff'), 'Couleur du texte')}${pal('hc', ['#fff2a8', ...LIGHT, ...COLOR_NAMES.map(c => c[0])], 'Surlignage')}
    <select data-size title="Taille"><option value="">Taille</option><option value="2">Petit</option><option value="3">Normal</option><option value="5">Grand</option><option value="6">Très grand</option></select>
    <button type="button" data-cmd="justifyLeft" title="Aligner à gauche">⟸</button><button type="button" data-cmd="justifyCenter" title="Centrer">≡</button><button type="button" data-cmd="justifyRight" title="Aligner à droite">⟹</button>
    <button type="button" data-cmd="insertUnorderedList" title="Liste à puces">•≡</button><button type="button" data-cmd="insertOrderedList" title="Liste numérotée">1.</button>
    <button type="button" data-cmd="removeFormat" title="Effacer la mise en forme">⌫</button>
  </div>`;
}
/* `target()` renvoie l'éditeur actif ; `after` est appelé après chaque commande. */
function bindToolbar(root, target, after = () => {}) {
  const tb = root.querySelector('.rtb'); if (!tb) return;
  const run = (cmd, val) => { const t = target(); if (!t) { toast('Cliquez d\'abord dans un texte'); return; } t.focus(); try { document.execCommand('styleWithCSS', false, true); } catch (_) {} document.execCommand(cmd, false, val); after(t); };
  tb.addEventListener('mousedown', ev => { if (!ev.target.closest('input,select')) ev.preventDefault(); }); // garde la sélection
  tb.addEventListener('click', ev => { const b = ev.target.closest('[data-cmd]'); if (b) run(b.dataset.cmd); });
  tb.addEventListener('click', ev => {
    const f = ev.target.closest('[data-fc]'), h = ev.target.closest('[data-hc]');
    if (f) run('foreColor', f.dataset.fc); if (h) run('hiliteColor', h.dataset.hc);
  });
  tb.addEventListener('input', ev => { const i = ev.target; if (i.matches('[data-fc-x]')) run('foreColor', i.value); if (i.matches('[data-hc-x]')) run('hiliteColor', i.value); });
  const sz = tb.querySelector('[data-size]'); sz.onchange = () => { if (sz.value) run('fontSize', sz.value); sz.value = ''; };
}

/* ---------- Éditeur de blocs ---------- */
export function mountBlocks(box, d, { onChange, readHeader }) {
  let active = null; // éditeur texte actif
  const updSub = () => { const st = sectionTotals(d.blocks); $$('[data-sub]', box).forEach(n => { const b = d.blocks.find(x => x.id === n.dataset.sub); n.textContent = b && b.sub ? 'Sous-total : ' + eur(st[b.id]) : ''; }); };
  const change = () => { syncLines(d); updSub(); onChange(); };
  box.innerHTML = `<div class="rte-wrap">${toolbarHtml()}</div><div id="blks"></div>
    <div class="row addbar"><button type="button" class="btn" id="addp">+ Produit</button><button type="button" class="btn" id="addl">+ Ligne libre</button>
      <button type="button" class="btn" id="adds">+ Section</button><button type="button" class="btn" id="addt">+ Texte</button><button type="button" class="btn" id="addm">Modèles de texte…</button><button type="button" class="btn" id="addb">+ Saut de page</button></div>`;
  bindToolbar(box, () => active, t => { const blk = d.blocks.find(x => x.id === t.closest('.blk')?.dataset.id); if (blk) { blk.html = sanitize(t.innerHTML); change(); } });
  const host = $('#blks', box);
  const idx = id => d.blocks.findIndex(b => b.id === id);
  const add = (b, at) => { b.id = bid(); at == null ? d.blocks.push(b) : d.blocks.splice(at, 0, b); draw(); change(); return b; };

  const inner = b => {
    if (b.type === 'line') return `<div class="ln"><div class="d"><input data-k="desig" value="${e(b.desig)}" placeholder="Désignation"></div>
      <input data-k="qty" type="number" step="any" inputmode="decimal" value="${b.qty}" placeholder="Qté">
      <select data-k="unit">${UNITS.map(u => `<option ${u === b.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <input data-k="pu" type="number" step="0.01" inputmode="decimal" value="${b.pu}" placeholder="P.U. HT"><div class="tot" data-t>${eur(num(b.qty) * num(b.pu))}</div></div>`;
    if (b.type === 'section') return `<div class="sec-ed"><input data-k="title" value="${e(b.title)}" placeholder="Titre de la section" style="${e(secStyle(b))}">
      <b class="subv" data-sub="${b.id}">${b.sub ? 'Sous-total : ' + eur(sectionTotals(d.blocks)[b.id]) : ''}</b>
      <span class="mini">${pal('sc', COLOR_NAMES.map(c => c[0]).concat('#ffffff'), 'Couleur du texte')}${pal('sb', LIGHT.concat(COLOR_NAMES.map(c => c[0])), 'Couleur de fond')}
      <button type="button" data-tg="sub" title="Afficher un sous-total à la fin de la section" class="${b.sub ? 'on' : ''}">Σ</button><button type="button" data-tg="nobg" title="Sans fond">∅</button><button type="button" data-tg="bold" title="Gras"><b>G</b></button><button type="button" data-tg="italic" title="Italique"><i>I</i></button>
      <button type="button" data-al="left">⟸</button><button type="button" data-al="center">≡</button></span></div>`;
    if (b.type === 'text') return `<div class="rte" contenteditable="true" data-ph="Texte libre (commentaire, précision, mention…)">${sanitize(b.html)}</div>`;
    return '<div class="pbk-ed">— Saut de page —</div>';
  };
  const LABEL = { line: 'Ligne', section: 'Section', text: 'Texte', pagebreak: 'Page' };
  const draw = () => {
    host.innerHTML = d.blocks.map(b => `<div class="blk blk-${b.type}" data-id="${b.id}" draggable="false"><div class="bh"><span class="grip" title="Glisser pour déplacer" data-grip>⋮⋮</span><span class="bt">${LABEL[b.type]}</span><span class="sp"></span>
      <button type="button" class="btn sm" data-up title="Monter">▲</button><button type="button" class="btn sm" data-dn title="Descendre">▼</button><button type="button" class="btn sm" data-dup title="Dupliquer">⧉</button>${b.type === 'text' ? '<button type="button" class="btn sm" data-tpl title="Enregistrer comme modèle">💾</button>' : ''}<button type="button" class="btn sm danger" data-rm title="Supprimer">✕</button></div>
      <div class="bb"${b.type === 'line' ? ` style="background:${e(STY.lineBg)}"` : b.type === 'text' ? ` style="background:${e(STY.textBg)}"` : ''}>${inner(b)}</div></div>`).join('') || '<div class="empty">Document vide : ajoutez un produit, une section ou un texte.</div>';
  };
  draw();

  host.addEventListener('input', ev => {
    const row = ev.target.closest('.blk'); if (!row) return; const b = d.blocks[idx(row.dataset.id)]; if (!b) return;
    if (ev.target.classList.contains('rte')) { b.html = sanitize(ev.target.innerHTML); change(); return; }
    if (ev.target.matches('[data-sc-x],[data-sb-x]')) { if (ev.target.hasAttribute('data-sc-x')) b.color = ev.target.value; else b.bg = ev.target.value; $('[data-k=title]', row).setAttribute('style', secStyle(b)); change(); return; }
    const k = ev.target.dataset.k; if (!k) return;
    b[k] = ev.target.value;
    if (b.type === 'line') $('[data-t]', row).textContent = eur(num(b.qty) * num(b.pu));
    if (b.type === 'section') { const inp = $('[data-k=title]', row); inp.setAttribute('style', secStyle(b)); }
    change();
  });
  host.addEventListener('focusin', ev => { if (ev.target.classList.contains('rte')) active = ev.target; });
  host.addEventListener('click', ev => {
    const row = ev.target.closest('.blk'); if (!row) return; const i = idx(row.dataset.id), b = d.blocks[i];
    const mv = (a, z) => { if (z < 0 || z >= d.blocks.length) return; [d.blocks[a], d.blocks[z]] = [d.blocks[z], d.blocks[a]]; draw(); change(); };
    if (ev.target.closest('[data-up]')) mv(i, i - 1);
    else if (ev.target.closest('[data-dn]')) mv(i, i + 1);
    else if (ev.target.closest('[data-dup]')) { const c = JSON.parse(JSON.stringify(b)); add(c, i + 1); }
    else if (ev.target.closest('[data-rm]')) { d.blocks.splice(i, 1); active = null; draw(); change(); }
    else if (ev.target.closest('[data-tpl]')) {
      const name = prompt('Nom du modèle de texte :'); if (!name) return;
      getS().then(async S => { await db.saveSettings({ ...S, snippets: [...(S.snippets || []), { name: name.trim(), html: sanitize(b.html) }] }); toast('Modèle enregistré'); });
    } else if (ev.target.closest('[data-tg]')) {
      const t = ev.target.closest('[data-tg]').dataset.tg;
      if (t === 'nobg') b.bg = 'none'; else if (t === 'sub') b.sub = !b.sub; else b[t] = t === 'bold' ? b.bold === false : !b[t];
      draw(); change();
    } else if (ev.target.closest('[data-sc],[data-sb]')) { const x = ev.target.closest('[data-sc],[data-sb]'); if (x.dataset.sc) b.color = x.dataset.sc; else b.bg = x.dataset.sb; draw(); change();
    } else if (ev.target.closest('[data-al]')) { b.align = ev.target.closest('[data-al]').dataset.al; draw(); change(); }
  });
  /* Glisser-déposer (poignée) */
  let dragId = null;
  host.addEventListener('pointerdown', ev => { const row = ev.target.closest('.blk'); if (row) row.draggable = !!ev.target.closest('[data-grip]'); });
  host.addEventListener('dragstart', ev => { const row = ev.target.closest('.blk'); if (!row) return; dragId = row.dataset.id; ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', dragId); } catch (_) {} row.classList.add('drag'); });
  host.addEventListener('dragend', () => { dragId = null; $$('.blk', host).forEach(r => { r.draggable = false; r.classList.remove('drag', 'over'); }); });
  host.addEventListener('dragover', ev => { if (dragId) { ev.preventDefault(); $$('.blk', host).forEach(r => r.classList.toggle('over', r === ev.target.closest('.blk'))); } });
  host.addEventListener('drop', ev => {
    const row = ev.target.closest('.blk'); if (!dragId || !row) return; ev.preventDefault();
    const from = idx(dragId), to = idx(row.dataset.id); if (from === to) return;
    const [m] = d.blocks.splice(from, 1); d.blocks.splice(to, 0, m); dragId = null; draw(); change();
  });

  $('#addl', box).onclick = () => add({ type: 'line', pid: '', desig: '', qty: 1, unit: 'u', pu: 0 });
  $('#addp', box).onclick = () => { readHeader(); pickProduct(p => add({ type: 'line', pid: p.id, desig: p.name, qty: 1, unit: p.unit || 'u', pu: p.sell || 0 }), { sale: true }); };
  $('#adds', box).onclick = () => add({ type: 'section', title: '', bold: true, sub: true });
  $('#addt', box).onclick = () => add({ type: 'text', html: '' });
  $('#addb', box).onclick = () => add({ type: 'pagebreak' });
  $('#addm', box).onclick = () => snippetsModal(s => add({ type: 'text', html: sanitize(s.html) }));
  return { redraw: draw };
}

/* ---------- Champs texte enrichi (intitulé, remarque…) ---------- */
export function richHtml(s) { // texte brut ancien (avec retours à la ligne) ou HTML déjà enrichi
  s = String(s || '');
  return /<\/?[a-z][\s\S]*>/i.test(s) ? sanitize(s) : e(s).replace(/\n/g, '<br>');
}
export function richField(label, key, value, { rows = 1 } = {}) {
  return `<div class="f full richf" data-rf="${key}"><span>${label}</span>
    <div class="rte-wrap">${toolbarHtml()}<button type="button" class="btn sm" data-rtpl>Modèles de texte…</button></div>
    <div class="rte" contenteditable="true" data-rich="${key}" style="min-height:${rows > 1 ? 80 : 42}px" data-ph="Texte (mise en forme possible)">${richHtml(value)}</div></div>`;
}
export function bindRichFields(root) {
  $$('.richf', root).forEach(box => {
    const rte = $('.rte', box);
    bindToolbar(box, () => rte);
    $('[data-rtpl]', box).onclick = () => snippetsModal(s => { rte.focus(); if (!document.execCommand('insertHTML', false, sanitize(s.html))) rte.innerHTML += sanitize(s.html); });
  });
}
export const readRich = root => { const o = {}; $$('[data-rich]', root).forEach(r => { o[r.dataset.rich] = sanitize(r.innerHTML); }); return o; };
