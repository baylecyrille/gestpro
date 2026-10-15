// Structure des devis / factures : blocs ordonnés (section, texte mis en forme, ligne produit, saut de page).
import { e, eur, num, F, modal, toast, COLOR_NAMES, $, $$ } from './util.js';
import { getS } from './defaults.js';
import * as db from './db.js';
import { UNITS, pickProduct, productModal, total as stockOf, CATS, CAT_NAMES, catIcon } from './stock.js';
import { RATES, fmtRate, rateOf, hasOwnRate, multiRate, lineHt, grossHt, lineDisc, remOf, isOpt, hasCost, lineMargin, refOn } from './vat.js';

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
export const plain = html => { const d = new DOMParser().parseFromString('<body>' + String(html || '').replace(/<br\s*\/?>|<\/(?:div|p|li)>/gi, ' ') + '</body>', 'text/html'); return (d.body.textContent || '').replace(/\s+/g, ' ').trim(); };
/* Désignation d'une ligne : `desig` reste toujours le texte brut (recherche, facture électronique, contrôles) ; `dhtml` garde la mise en forme, s'il y en a */
export const hasFmt = html => /<[a-z]/i.test(html);
export const desigHtml = b => {
  if (b.dhtml) { const h = sanitize(b.dhtml); if (plain(h) === String(b.desig ?? '').trim()) return h; } // mise en forme périmée (texte changé ailleurs) : ignorée
  return e(b.desig);
};

/* ---------- Modèle ---------- */
export const linesOf = bl => bl.filter(b => b.type === 'line');
/* S'assure que d.blocks existe (migration des anciennes lignes) et que d.lines en est le reflet. */
export function ensureBlocks(d) {
  if (!Array.isArray(d.blocks)) d.blocks = (d.lines || []).map(l => ({ id: bid(), type: 'line', pid: l.pid || '', desig: l.desig || '', qty: l.qty, unit: l.unit || 'u', pu: l.pu, ...(hasOwnRate(l) ? { tva: l.tva } : {}), ...(remOf(l) ? { rem: l.rem } : {}), ...(isOpt(l) ? { opt: true } : {}) }));
  d.blocks.forEach(b => { if (!b.id) b.id = bid(); });
  d.lines = linesOf(d.blocks);
  return d;
}
export function syncLines(d) { d.lines = linesOf(d.blocks); }
/* Ce que le document contient déjà : taux de TVA propres aux lignes (dont ceux qui diffèrent du taux du document) et remises de ligne */
export function lineStats(d) {
  const L = (d.blocks || []).filter(b => b.type === 'line');
  return { own: L.filter(b => hasOwnRate(b)).length, diff: L.filter(b => hasOwnRate(b) && num(b.tva) !== num(d.tva)).length, rem: L.filter(b => remOf(b) > 0).length, opt: L.filter(b => isOpt(b)).length };
}
/* 'tvaLine' : toutes les lignes reprennent le taux du document · 'remLine' : supprime les remises de ligne · 'optLine' : les lignes en option deviennent des lignes comptées */
export function clearLineOpt(d, k) {
  for (const b of d.blocks || []) if (b.type === 'line') { if (k === 'tvaLine') delete b.tva; else if (k === 'remLine') delete b.rem; else if (k === 'optLine') delete b.opt; }
  syncLines(d);
}
export function pruneBlocks(d) {
  d.blocks = d.blocks.filter(b => b.type === 'line' ? (b.desig || num(b.pu)) : b.type === 'section' ? plain(b.title) : b.type === 'text' ? plain(b.html) : true);
  syncLines(d);
}
/* Sous-total d'une section : lignes situées entre cette section et la suivante */
export function sectionTotals(bl) {
  const out = {}; let cur = null;
  for (const b of bl) { if (b.type === 'section') { cur = b.id; out[cur] = 0; } else if (b.type === 'sectionend') cur = null; else if (b.type === 'line' && cur && !isOpt(b)) out[cur] += lineHt(b); }
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
  const st = sectionTotals(d.blocks), vat = multiRate(d.lines || linesOf(d.blocks), d.tva), rf = refOn(d), NC = (vat ? 6 : 5) + (rf ? 1 : 0);
  const subRow = sec => `<tr class="subt"><td colspan="${NC - 1}" style="text-align:right;font-style:italic">Sous-total ${e(sec.title)}</td><td class="n"><i>${eur(st[sec.id])}</i></td></tr>`;
  const out = []; let open = null;
  for (const b of d.blocks) {
    if (b.type === 'section') { if (open) out.push({ _sub: open }); open = b.sub ? b : null; }
    if (b.type === 'sectionend') { if (open) out.push({ _sub: open }); open = null; continue; }
    out.push(b);
  }
  if (open) out.push({ _sub: open });
  return out.map(b => {
    if (b._sub) return subRow(b._sub);
    const bgl = STY.lineBg && STY.lineBg.toLowerCase() !== '#ffffff' ? ` style="background:${e(STY.lineBg)}"` : '';
    const bgt = STY.textBg && STY.textBg.toLowerCase() !== '#ffffff' ? ` style="background:${e(STY.textBg)}"` : '';
    if (b.type === 'line') {
      const opt = isOpt(b), rem = remOf(b), net = lineHt(b);
      const des = `${opt ? '<b>Option :</b> ' : ''}${desigHtml(b)}${rem ? `<div class="small">Remise ${e(fmtRate(rem))} : − ${eur(lineDisc(b))}</div>` : ''}`;
      return `<tr${opt ? ' class="opt"' : ''}${bgl}>${rf ? `<td class="ref">${e(b.ref ?? '')}</td>` : ''}<td>${des}</td><td class="n">${num(b.qty)}</td><td>${e(b.unit)}</td><td class="n">${eur(num(b.pu))}</td>${vat ? `<td class="n">${e(fmtRate(rateOf(b, d.tva)))}</td>` : ''}<td class="n">${opt ? `<i>${eur(net)}</i><div class="small">non compté</div>` : eur(net)}</td></tr>`;
    }
    if (b.type === 'section') return `<tr class="sec"><td colspan="${NC}" style="${e(secStyle(b))}">${e(b.title)}</td></tr>`;
    if (b.type === 'text') return `<tr class="txt"><td colspan="${NC}"${bgt}>${sanitize(b.html)}</td></tr>`;
    if (b.type === 'pagebreak') return `<tr class="pbk" style="page-break-after:always;break-after:page"><td colspan="${NC}" style="border:0;padding:0;height:0"></td></tr>`;
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
function toolbarHtml(br = false) {
  return `<div class="rtb">
    <button type="button" data-cmd="bold" title="Gras"><b>G</b></button><button type="button" data-cmd="italic" title="Italique"><i>I</i></button>
    <button type="button" data-cmd="underline" title="Souligné"><u>S</u></button><button type="button" data-cmd="strikeThrough" title="Barré"><s>B</s></button>
    ${pal('fc', COLOR_NAMES.map(c => c[0]).concat('#ffffff'), 'Couleur du texte')}${pal('hc', ['#fff2a8', ...LIGHT, ...COLOR_NAMES.map(c => c[0])], 'Surlignage')}
    <select data-size title="Taille"><option value="">Taille</option><option value="2">Petit</option><option value="3">Normal</option><option value="5">Grand</option><option value="6">Très grand</option></select>
    <button type="button" data-cmd="justifyLeft" title="Aligner à gauche">⟸</button><button type="button" data-cmd="justifyCenter" title="Centrer">≡</button><button type="button" data-cmd="justifyRight" title="Aligner à droite">⟹</button>
    <button type="button" data-cmd="insertUnorderedList" title="Liste à puces">•≡</button><button type="button" data-cmd="insertOrderedList" title="Liste numérotée">1.</button>
    ${br ? '<button type="button" data-cmd="insertLineBreak" title="Saut de ligne dans la désignation (Maj + Entrée)">↵</button>' : ''}<button type="button" data-cmd="removeFormat" title="Effacer la mise en forme">⌫</button>
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
    (f || h)?.closest('details')?.removeAttribute('open'); // la palette se referme une fois la couleur choisie
  });
  tb.addEventListener('input', ev => { const i = ev.target; if (i.matches('[data-fc-x]')) run('foreColor', i.value); if (i.matches('[data-hc-x]')) run('hiliteColor', i.value); });
  const sz = tb.querySelector('[data-size]'); sz.onchange = () => { if (sz.value) run('fontSize', sz.value); sz.value = ''; };
}

/* ---------- Éditeur de blocs ---------- */
export function mountBlocks(box, d, { onChange, readHeader, view }) {
  let active = null; // éditeur texte actif
  const updSub = () => { const st = sectionTotals(d.blocks); $$('[data-sub]', box).forEach(n => { const b = d.blocks.find(x => x.id === n.dataset.sub); n.textContent = b && b.sub ? 'Sous-total : ' + eur(st[b.id]) : ''; }); };
  const change = () => { syncLines(d); updSub(); onChange(); };
  const AB = (id, ico, label, title) => `<button type="button" class="ab" id="${id}" title="${e(title)}" aria-label="${e(label)}"><i>${ico}</i><span>${e(label)}</span></button>`;
  box.innerHTML = `<div id="blks"></div>
    <div class="abarbox"><div class="abar" role="toolbar" aria-label="Ajouter au document">
      <div class="abwrap"><button type="button" class="ab pri" id="addp" aria-haspopup="true" aria-expanded="false" aria-label="Produit" title="Ajouter un produit du catalogue : choisissez d'abord la catégorie"><i>📦</i><span>Produit</span><i class="car">▾</i></button>
        <div class="pmenu" id="pmenu" role="menu" hidden>${CATS.map(([c, ic]) => `<button type="button" role="menuitem" data-cat="${e(c)}"><i>${ic}</i>${e(c)}</button>`).join('')}<hr><button type="button" role="menuitem" data-cat="*"><i>🔎</i>Tout le catalogue / scanner…</button></div></div>
      ${AB('addl', '✏️', 'Ligne libre', 'Ligne libre : saisir une prestation à la main')}${AB('addpdf', '📄', 'PDF', 'Reprendre des lignes depuis une facture fournisseur (PDF)')}<span class="asep"></span>
      ${AB('adds', '📑', 'Section', 'Section : regroupe des lignes sous un titre')}${AB('adde', '⏹', 'Fin de section', 'Termine la section en cours : les lignes suivantes n\'en font plus partie')}<span class="asep"></span>
      ${AB('addt', '📝', 'Texte', 'Texte libre : commentaire, précision, mention…')}${AB('addm', '📋', 'Modèles', 'Modèles de texte…')}${AB('addb', '⏭', 'Saut de page', 'Saut de page : la suite s\'imprime sur une nouvelle page')}</div></div>`;
  const host = $('#blks', box);
  /* Options de saisie (bouton « Options » de l'éditeur) : masque le taux de TVA et/ou la remise de chaque ligne (view() → { tva, rem }) */
  const V = () => ({ tva: true, rem: true, ref: false, margin: false, stock: false, photo: false, opt: true, sub: true, ...((view && view()) || {}) });
  const applyView = () => { const v = V(); host.classList.toggle('nv', v.tva === false); host.classList.toggle('nr', v.rem === false); };
  /* Produits (stock, prix d'achat, référence) et photos : chargés à la demande, pour les informations internes de chaque ligne */
  const byId = new Map(), photos = new Map(), tracked = p => Object.keys(p.stock || {}).length > 0 || num(p.min) > 0;
  const money = v => eur(v);
  /* Reprend de la fiche produit la référence et le prix d'achat d'une ligne qui n'en a pas encore (instantané : un changement de fiche ne modifie pas un devis déjà établi) */
  const snapAll = () => {
    let ch = false;
    for (const b of d.blocks) {
      if (b.type !== 'line' || !b.pid) continue; const p = byId.get(b.pid); if (!p) continue;
      if (!String(b.ref ?? '').trim() && String(p.ref ?? '').trim()) { b.ref = p.ref; ch = true; }
      if (!hasCost(b) && num(p.buy) > 0) { b.pa = p.buy; ch = true; }
    }
    return ch;
  };
  const marginHtml = b => {
    if (!hasCost(b)) return '<span class="muted">Marge : saisissez le prix d\'achat</span>';
    const m = lineMargin(b);
    return `<span class="${m.margin < 0 ? 'neg' : 'pos'}">Marge ${money(m.margin)}${m.ht ? ' · ' + (Math.round(m.pct * 10) / 10).toString().replace('.', ',') + ' %' : ''}</span>`;
  };
  const paintMeta = () => {
    const v = V(); if (!(v.margin || v.stock || v.photo || v.ref)) return;
    const need = {}; if (v.stock) for (const b of d.blocks) if (b.type === 'line' && b.pid && !isOpt(b)) need[b.pid] = Math.round(((need[b.pid] || 0) + num(b.qty)) * 1000) / 1000;
    $$('.blk-line', host).forEach(row => {
      const b = d.blocks[idx(row.dataset.id)]; if (!b) return;
      for (const k of ['ref', 'pa']) { const inp = $(`[data-k=${k}]`, row); if (inp && document.activeElement !== inp && inp.value !== String(b[k] ?? '')) inp.value = b[k] ?? ''; } // valeurs reprises de la fiche produit
      const mg = $('[data-mg]', row); if (mg) mg.innerHTML = marginHtml(b);
      const p = b.pid ? byId.get(b.pid) : null, sk = $('[data-stk]', row);
      if (sk) {
        if (p && tracked(p)) { const st = stockOf(p), nd = need[b.pid] || 0, low = nd > st; sk.className = 'stk' + (low ? ' low' : ''); sk.textContent = low ? `⚠ Stock ${st} ${p.unit || 'u'} pour ${nd} demandé${nd > 1 ? 's' : ''}` : `Stock : ${st} ${p.unit || 'u'}`; }
        else { sk.className = 'stk'; sk.textContent = ''; }
      }
      const th = $('[data-th]', row); if (th) { const ph = b.pid ? photos.get(b.pid) : ''; th.innerHTML = ph ? `<img src="${e(ph)}" alt="">` : ''; }
      const mx = $('.mx', row); if (mx) mx.hidden = ![...mx.children].some(c => c.matches('label') || c.textContent.trim());
    });
  };
  const loadMeta = () => {
    const v = V(); if (!(v.margin || v.stock || v.photo || v.ref)) return;
    const ids = [...new Set(d.blocks.filter(b => b.type === 'line' && b.pid).map(b => b.pid))];
    Promise.all(ids.map(async id => {
      if (!byId.has(id)) { const p = await db.get('products', id); if (p) byId.set(id, p); }
      if (v.photo && !photos.has(id)) { const r = await db.get('photos', id); photos.set(id, (r && r.data) || ''); }
    })).then(() => { if (!box.isConnected) return; if (snapAll()) { change(); } paintMeta(); }).catch(() => {});
  };
  const idx = id => d.blocks.findIndex(b => b.id === id);
  const add = (b, at) => { b.id = bid(); at == null ? d.blocks.push(b) : d.blocks.splice(at, 0, b); draw(); change(); return b; };

  const vatOpts = b => `<option value="" ${hasOwnRate(b) ? '' : 'selected'}>déf. ${e(fmtRate(num(d.tva)))}</option>${RATES.map(([v, l]) => `<option value="${v}" ${hasOwnRate(b) && String(parseFloat(b.tva)) === v ? 'selected' : ''}>${l}</option>`).join('')}`;
  const isQuote = d.type === 'quote';
  /* Total de la ligne : montant brut barré si remise, mention « option » si non comptée */
  const totHtml = b => (isOpt(b) ? '<small class="muted optlbl">option<span class="lg">, non comptée</span></small> ' : '') + (remOf(b) ? `<s class="muted">${eur(grossHt(b))}</s> ` : '') + eur(lineHt(b));
  const inner = b => {
    if (b.type === 'line') { const v = V(); return `<div class="ln"><div class="d">${v.photo ? '<span class="lth" data-th></span>' : ''}${v.ref ? `<input data-k="ref" class="lref" autocomplete="off" value="${e(b.ref ?? '')}" placeholder="Réf." title="Référence du produit">` : ''}<div class="dz" data-k="desig" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Désignation" spellcheck="true" data-ph="${b.cat ? e('Rechercher : ' + b.cat + '…') : 'Désignation'}">${desigHtml(b)}</div></div>
      <input data-k="qty" type="number" step="any" inputmode="decimal" value="${b.qty}" placeholder="Qté">
      <select data-k="unit">${UNITS.map(u => `<option ${u === b.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <input data-k="pu" type="number" step="0.01" inputmode="decimal" value="${b.pu}" placeholder="P.U. HT">
      <select data-k="tva" class="vat${hasOwnRate(b) ? '' : ' inh'}" title="Taux de TVA de cette ligne">${vatOpts(b)}</select>
      <div class="ex"><label class="rem" title="Remise accordée sur cette ligne"><span>Remise</span><input data-k="rem" type="number" step="any" min="0" max="100" inputmode="decimal" value="${remOf(b) || ''}" placeholder="Rem."><span>%</span></label>
        ${(isQuote && v.opt) || isOpt(b) ? `<label class="optk" title="Ligne proposée en option : elle est imprimée sur le devis mais n'est pas comptée dans le total"><input type="checkbox" data-k="opt" ${isOpt(b) ? 'checked' : ''}><span>Option</span></label>` : '<span class="optk"></span>'}
        <div class="tot" data-t>${totHtml(b)}</div></div>
      ${v.margin || v.stock ? `<div class="mx">${v.margin ? `<label class="pa" title="Prix d'achat unitaire HT : information interne, jamais imprimée"><span>P.A. HT</span><input data-k="pa" type="number" step="0.01" inputmode="decimal" value="${e(b.pa ?? '')}" placeholder="0"></label><span class="mg" data-mg></span>` : ''}${v.stock ? '<span class="stk" data-stk></span>' : ''}</div>` : ''}</div>`; }
    if (b.type === 'section') return `<div class="sec-ed"><input data-k="title" value="${e(b.title)}" placeholder="Titre de la section" style="${e(secStyle(b))}">
      <b class="subv" data-sub="${b.id}">${b.sub ? 'Sous-total : ' + eur(sectionTotals(d.blocks)[b.id]) : ''}</b>
      <span class="mini">${pal('sc', COLOR_NAMES.map(c => c[0]).concat('#ffffff'), 'Couleur du texte')}${pal('sb', LIGHT.concat(COLOR_NAMES.map(c => c[0])), 'Couleur de fond')}
      <button type="button" data-tg="sub" title="Afficher un sous-total à la fin de la section" class="${b.sub ? 'on' : ''}">Σ</button><button type="button" data-tg="nobg" title="Sans fond">∅</button><button type="button" data-tg="bold" title="Gras"><b>G</b></button><button type="button" data-tg="italic" title="Italique"><i>I</i></button>
      <button type="button" data-al="left">⟸</button><button type="button" data-al="center">≡</button></span></div>`;
    if (b.type === 'text') return `<div class="rte" contenteditable="true" data-ph="Texte libre (commentaire, précision, mention…)">${sanitize(b.html)}</div>`;
    if (b.type === 'sectionend') { let sid = ''; for (const x of d.blocks) { if (x === b) break; if (x.type === 'section') sid = x.id; else if (x.type === 'sectionend') sid = ''; } return `<div class="pbk-ed">— Fin de la section${sid ? ' « ' + e(plain(d.blocks.find(x => x.id === sid).title)) + ' »' : ' (aucune section ouverte)'} — <b class="subv" data-sub="${sid}"></b></div>`; }
    return '<div class="pbk-ed">— Saut de page —</div>';
  };
  const LABEL = { line: 'Ligne', section: 'Section', text: 'Texte', pagebreak: 'Page', sectionend: 'Fin de section' };
  /* Mise en forme du texte : une barre sur une ligne, dépliable / repliable dans chaque bloc texte (bouton « Aa ») */
  const tbOpen = new Set();
  const richOf = row => $('.rte', row) || $('.dz', row); // zone mise en forme du bloc : texte libre, ou désignation d'une ligne
  /* Désignation d'une ligne : `desig` = texte brut (recherche, facture électronique, contrôles) ; `dhtml` = mise en forme, seulement s'il y en a */
  const dtext = el => (el.textContent || '').trim();
  const setDesig = (b, el) => {
    const html = sanitize(el.innerHTML).replace(/^(?:<br\s*\/?>)+|(?:<br\s*\/?>)+$/gi, '');
    b.desig = plain(html);
    if (!el.textContent) { if (el.innerHTML) el.innerHTML = ''; delete b.dhtml; } // plus rien : retire le <br> résiduel, le texte d'aide revient
    else if (hasFmt(html)) b.dhtml = html; else delete b.dhtml;
  };
  const openTb = (row, focus) => {
    const bb = $('.bb', row); if (!bb || $('.rtb', bb)) return;
    bb.insertAdjacentHTML('afterbegin', toolbarHtml(row.classList.contains('blk-line')));
    bindToolbar(row, () => richOf(row), t => { const blk = d.blocks[idx(row.dataset.id)]; if (!blk) return; if (blk.type === 'line') setDesig(blk, t); else blk.html = sanitize(t.innerHTML); change(); });
    $('[data-tb]', row)?.classList.add('on');
    if (focus) richOf(row)?.focus();
  };
  const closeTb = row => { $('.rtb', row)?.remove(); $('[data-tb]', row)?.classList.remove('on'); };
  let sg = null; // liste de suggestions ouverte dans une ligne classée par catégorie
  const draw = () => {
    sg = null; let open = false;
    host.innerHTML = d.blocks.map(b => { const ins = open && (b.type === 'line' || b.type === 'text'); if (b.type === 'section') open = true; if (b.type === 'sectionend') open = false; return `<div class="blk blk-${b.type}${ins ? ' insec' : ''}${b.type === 'line' && isOpt(b) ? ' optl' : ''}" data-id="${b.id}" draggable="false"><div class="bh"><span class="grip" title="Glisser pour déplacer" data-grip>⋮⋮</span><span class="bt">${b.type === 'line' && b.cat ? `${catIcon(b.cat)} ${e(b.cat)}` : LABEL[b.type]}</span><span class="sp"></span>
      <button type="button" class="btn sm" data-up title="Monter">▲</button><button type="button" class="btn sm" data-dn title="Descendre">▼</button><button type="button" class="btn sm" data-dup title="Dupliquer">⧉</button>${b.type === 'line' && b.pid ? '<button type="button" class="btn sm" data-prod title="Ouvrir / modifier la fiche produit">✎ Produit</button>' : ''}${b.type === 'line' || b.type === 'text' ? `<button type="button" class="btn sm" data-tb title="${b.type === 'line' ? 'Mise en forme de la désignation (gras, couleur, taille, liste, saut de ligne…)' : 'Mise en forme du texte (gras, couleur, taille…)'}" aria-label="Mise en forme du texte">Aa</button>` : ''}${b.type === 'text' ? '<button type="button" class="btn sm" data-tpl title="Enregistrer comme modèle">💾</button>' : ''}<button type="button" class="btn sm danger" data-rm title="Supprimer">✕</button></div>
      <div class="bb"${b.type === 'line' ? ` style="background:${e(STY.lineBg)}"` : b.type === 'text' ? ` style="background:${e(STY.textBg)}"` : ''}>${inner(b)}</div></div>`; }).join('') || '<div class="empty">Document vide : ajoutez un produit, une section ou un texte.</div>';
    tbOpen.forEach(id => { const r = host.querySelector(`.blk[data-id="${id}"]`); if (r) openTb(r); else tbOpen.delete(id); });
    updSub(); const snapped = snapAll(); paintMeta(); loadMeta(); if (snapped) change();
  };
  draw(); applyView();

  host.addEventListener('input', ev => {
    const row = ev.target.closest('.blk'); if (!row) return; const b = d.blocks[idx(row.dataset.id)]; if (!b) return;
    if (ev.target.classList.contains('rte')) { b.html = sanitize(ev.target.innerHTML); change(); return; }
    if (ev.target.matches('[data-sc-x],[data-sb-x]')) { if (ev.target.hasAttribute('data-sc-x')) b.color = ev.target.value; else b.bg = ev.target.value; $('[data-k=title]', row).setAttribute('style', secStyle(b)); change(); return; }
    const k = ev.target.dataset.k; if (!k) return;
    if (k === 'opt') { if (ev.target.checked) b.opt = true; else delete b.opt; row.classList.toggle('optl', isOpt(b)); }
    else if (k === 'rem') { if (num(ev.target.value) > 0) b.rem = ev.target.value; else delete b.rem; }
    else if (k === 'pa' || k === 'ref') { if (String(ev.target.value).trim() === '') delete b[k]; else b[k] = ev.target.value; }
    else if (k === 'desig') setDesig(b, ev.target);
    else b[k] = ev.target.value;
    if (k === 'tva') { if (b.tva === '') delete b.tva; ev.target.classList.toggle('inh', !hasOwnRate(b)); }
    if (b.type === 'line') $('[data-t]', row).innerHTML = totHtml(b);
    if (b.type === 'section') { const inp = $('[data-k=title]', row); inp.setAttribute('style', secStyle(b)); }
    change(); if (b.type === 'line') paintMeta();
  });
  host.addEventListener('focusin', ev => { if (ev.target.classList.contains('rte')) active = ev.target; });
  host.addEventListener('click', ev => {
    const row = ev.target.closest('.blk'); if (!row) return; const i = idx(row.dataset.id), b = d.blocks[i];
    const mv = (a, z) => { if (z < 0 || z >= d.blocks.length) return; [d.blocks[a], d.blocks[z]] = [d.blocks[z], d.blocks[a]]; draw(); change(); };
    if (ev.target.closest('[data-up]')) mv(i, i - 1);
    else if (ev.target.closest('[data-dn]')) mv(i, i + 1);
    else if (ev.target.closest('[data-dup]')) { const c = JSON.parse(JSON.stringify(b)); add(c, i + 1); }
    else if (ev.target.closest('[data-prod]')) {
      readHeader();
      Promise.all([db.get('products', b.pid), db.all('locations'), db.all('contacts'), db.all('products')]).then(([p, locs, ctc, prods]) => {
        if (!p) { alert('Ce produit n\'existe plus dans le catalogue.'); b.pid = ''; draw(); change(); return; }
        productModal(p, locs, ctc, prods, {}, saved => {
          if (!saved) { b.pid = ''; draw(); change(); return; }
          if (confirm('Reprendre sur cette ligne le nom, l\'unité et le prix de vente de la fiche produit ?')) { b.desig = saved.name; delete b.dhtml; b.unit = saved.unit || b.unit; b.pu = saved.sell || 0; }
          draw(); change(); toast('Produit enregistré');
        });
      });
    }
    else if (ev.target.closest('[data-tb]')) { if (tbOpen.has(b.id)) { tbOpen.delete(b.id); closeTb(row); } else { tbOpen.add(b.id); openTb(row, true); } }
    else if (ev.target.closest('[data-rm]')) { tbOpen.delete(b.id); d.blocks.splice(i, 1); active = null; draw(); change(); }
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
  /* Saisie rapide : liste des produits vendus (complétion de la désignation) et clavier */
  const byName = new Map();
  const autofill = (b, row) => {
    const p = byName.get(String(b.desig || '').trim().toLowerCase()); if (!p || (b.pid && b.pid !== p.id)) return;
    b.pid = p.id; byId.set(p.id, p);
    if (!num(b.pu)) { b.pu = p.sell || 0; $('[data-k=pu]', row).value = b.pu; }
    if (!String(b.ref ?? '').trim() && String(p.ref ?? '').trim()) { b.ref = p.ref; const ri = $('[data-k=ref]', row); if (ri) ri.value = b.ref; }
    if (!hasCost(b) && num(p.buy) > 0) { b.pa = p.buy; const pi = $('[data-k=pa]', row); if (pi) pi.value = b.pa; }
    if ((!b.unit || b.unit === 'u') && p.unit) { b.unit = p.unit; const u = $('[data-k=unit]', row); if (u) u.value = p.unit; }
    $('[data-t]', row).innerHTML = totHtml(b); change(); loadMeta(); paintMeta();
  };
  db.all('products').then(ps => {
    const all = ps.filter(p => p.kind !== 'internal' && p.name).sort((a, b) => a.name.localeCompare(b.name, 'fr')), sale = all.slice(0, 1500);
    catalog = all; if (sg) sgDraw(true);
    sale.forEach(p => byName.set(p.name.trim().toLowerCase(), p));
  }).catch(() => {});
  /* Désignation tapée à la main = nom exact d'un produit vendu : la ligne reprend sa fiche (seulement si le texte a changé) */
  host.addEventListener('focusout', ev => {
    const t = ev.target; if (!t.matches?.('[data-k=desig]') || t._v0 === t.textContent) return; t._v0 = t.textContent;
    const row = t.closest('.blk'), b = row && d.blocks[idx(row.dataset.id)]; if (b && b.type === 'line') autofill(b, row);
  });
  /* Recherche dans la ligne : produits de la catégorie choisie (« + Produit »), premières lettres d'abord */
  let catalog = null; // produits vendus, triés (chargés ci-dessous)
  const norm = t => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rankOf = (p, qt, q) => {
    if (!qt.length) return 3;
    const n = norm(p.name), words = n.split(/[^a-z0-9]+/).filter(Boolean);
    if (qt.every(t => words.some(w => w.startsWith(t)))) return n.startsWith(qt[0]) ? 0 : 1;
    return n.includes(q) || norm(p.ref).includes(q) || norm(p.barcode).includes(q) ? 2 : null;
  };
  const sgFind = (cat, text, all) => {
    const q = norm(text).trim(), qt = q.split(/\s+/).filter(Boolean);
    return (catalog || []).filter(p => all || p.category === cat).map(p => [rankOf(p, qt, q), p]).filter(x => x[0] !== null)
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, 'fr')).slice(0, 40).map(x => x[1]);
  };
  const sgClose = () => { if (sg) { sg.el.remove(); sg = null; } };
  const sgItem = (p, i) => `<button type="button" class="sgi${i === sg.on ? ' on' : ''}" data-pid="${p.id}"><span class="n">${e(p.name)}</span><small>${e(p.ref || '')}</small><b>${eur(p.sell || 0)}${p.unit ? ' / ' + e(p.unit) : ''}</b></button>`;
  const sgDraw = reset => {
    if (!sg) return;
    const row = sg.row, b = d.blocks[idx(row.dataset.id)], inp = $('[data-k=desig]', row);
    if (!b || !inp) return sgClose();
    const txt = dtext(inp);
    if (sg.free) { // ligne libre : propositions du catalogue pendant la frappe seulement, rien n'est présélectionné (Entrée passe au champ suivant)
      sg.items = catalog && txt ? sgFind(null, txt, true) : [];
      if (reset) sg.on = -1;
      sg.el.innerHTML = sg.items.length ? `<div class="sgh"><span>Catalogue</span></div>` + sg.items.map(sgItem).join('') : '';
      return;
    }
    const catNo = (catalog || []).filter(p => p.category === b.cat).length, all = sg.all || (!!catalog && !catNo);
    sg.items = catalog ? sgFind(b.cat, txt, all) : [];
    if (reset) sg.on = txt && sg.items.length ? 0 : -1;
    const head = `<div class="sgh"><span>${all ? (catNo ? 'Tout le catalogue' : `Aucun produit classé « ${e(b.cat)} » : tout le catalogue`) : `${catIcon(b.cat)} ${e(b.cat)} · ${catNo}`}</span>${catNo ? `<button type="button" data-sgall>${all ? 'Cette catégorie' : 'Tout le catalogue'}</button>` : ''}</div>`;
    const list = !catalog ? '<div class="sgn">Chargement…</div>' : sg.items.length
      ? sg.items.map(sgItem).join('')
      : `<div class="sgn">Aucun résultat${all ? '' : ' dans cette catégorie'}. Saisissez la désignation à la main${all || !catNo ? '' : ', ou cherchez dans tout le catalogue'}.</div>`;
    sg.el.innerHTML = head + list;
  };
  const sgOpen = row => {
    const b = row && d.blocks[idx(row.dataset.id)]; if (!b || b.type !== 'line') return;
    if (sg && sg.row === row) return sgDraw();
    sgClose();
    const el = document.createElement('div'); el.className = 'ac sg'; $('.d', row).appendChild(el);
    sg = { row, el, all: false, free: !b.cat, items: [], on: -1 };
    sgDraw(true);
  };
  /* Choix d'un produit dans la liste : reprend désignation, unité, prix, référence et prix d'achat de la fiche */
  const sgPick = pid => {
    if (!sg) return; const row = sg.row, b = d.blocks[idx(row.dataset.id)], p = (catalog || []).find(x => x.id === pid); if (!b || !p) return;
    const fresh = b.pid !== p.id, setv = (k, v) => { const el = $(`[data-k=${k}]`, row); if (el) { if (el.classList.contains('dz')) el.textContent = v; else el.value = v; } };
    b.pid = p.id; byId.set(p.id, p); b.desig = p.name; delete b.dhtml; setv('desig', p.name);
    if (fresh || !num(b.pu)) { b.pu = p.sell || 0; setv('pu', b.pu); }
    if (fresh) {
      if (p.unit) { b.unit = p.unit; setv('unit', p.unit); }
      if (String(p.ref ?? '').trim()) b.ref = p.ref; else delete b.ref; setv('ref', b.ref ?? '');
      if (num(p.buy) > 0) b.pa = p.buy; else delete b.pa; setv('pa', b.pa ?? '');
    }
    $('[data-t]', row).innerHTML = totHtml(b);
    sgClose(); change(); loadMeta(); paintMeta(); focusField(b.id, 'qty');
  };
  host.addEventListener('focusin', ev => {
    const t = ev.target;
    if (t.matches?.('[data-k=desig]')) {
      t._v0 = t.textContent; const row = t.closest('.blk'), b = d.blocks[idx(row.dataset.id)]; // à l'arrivée : liste des produits de la catégorie (ligne classée et vide) ; ligne libre : seulement en tapant
      if (b && b.cat && !dtext(t)) sgOpen(row); else if (!(sg && sg.row === row)) sgClose();
    }
    else if (!t.closest?.('.sg')) sgClose();
  });
  host.addEventListener('focusout', () => setTimeout(() => { if (sg && !host.contains(document.activeElement)) sgClose(); }, 150));
  host.addEventListener('input', ev => { if (ev.target.matches?.('[data-k=desig]')) { sgOpen(ev.target.closest('.blk')); sgDraw(true); } });
  host.addEventListener('mousedown', ev => { if (ev.target.closest('.sg')) ev.preventDefault(); }); // garde le focus dans le champ
  host.addEventListener('click', ev => {
    if (!sg || !ev.target.closest('.sg')) return;
    if (ev.target.closest('[data-sgall]')) { sg.all = !sg.all; sgDraw(true); return; }
    const it = ev.target.closest('[data-pid]'); if (it) sgPick(it.dataset.pid);
  });
  host.addEventListener('keydown', ev => {
    if (!sg || !ev.target.matches?.('[data-k=desig]')) return;
    const n = sg.items.length;
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && n) {
      ev.preventDefault(); const dn = ev.key === 'ArrowDown';
      sg.on = sg.on < 0 ? (dn ? 0 : n - 1) : (sg.on + (dn ? 1 : n - 1)) % n;
      $$('.sgi', sg.el).forEach((x, i) => { x.classList.toggle('on', i === sg.on); if (i === sg.on) x.scrollIntoView?.({ block: 'nearest' }); });
    } else if (ev.key === 'Enter' && sg.on >= 0 && sg.items[sg.on]) { ev.preventDefault(); ev.stopImmediatePropagation(); sgPick(sg.items[sg.on].id); }
    else if (ev.key === 'Escape') { ev.stopPropagation(); sgClose(); }
  });
  const fine = () => typeof matchMedia === 'function' && matchMedia('(pointer:fine)').matches;
  const focusField = (id, k) => {
    const el = host.querySelector(`.blk[data-id="${id}"] [data-k=${k}]`); if (!el) return;
    el.focus();
    if (el.classList.contains('dz')) { // champ mis en forme : tout sélectionné au clavier (comme un champ simple), sinon curseur à la fin
      try { const r = document.createRange(), sel = window.getSelection(); r.selectNodeContents(el); if (!fine()) r.collapse(false); sel.removeAllRanges(); sel.addRange(r); } catch (_) {}
    } else if (el.select && fine()) el.select();
  };
  host.addEventListener('focusin', ev => { if (ev.target.matches?.('.ln input[type=number]') && fine()) ev.target.select(); });
  /* Entrée : champ suivant ; à la fin de la ligne, ligne suivante (ou nouvelle ligne). Ctrl+Entrée : nouvelle ligne juste après.
     Dans la désignation : Maj + Entrée = saut de ligne ; Entrée dans une liste à puces garde son effet habituel. */
  const inList = () => { try { const n = window.getSelection().anchorNode; return !!(n && (n.nodeType === 1 ? n : n.parentElement)?.closest('li')); } catch (_) { return false; } };
  const enterNext = (inp, mod) => {
    const row = inp.closest('.blk'); if (!row) return;
    const i = idx(row.dataset.id), b = d.blocks[i], k = inp.dataset.k, nk = { desig: 'qty', qty: 'pu' }[k];
    if (nk && !mod) return focusField(row.dataset.id, nk);
    const nb = d.blocks[i + 1];
    if (nb && nb.type === 'line' && !mod) return focusField(nb.id, 'desig');
    const nl = add({ type: 'line', pid: '', desig: '', qty: 1, unit: 'u', pu: 0, ...(hasOwnRate(b) ? { tva: b.tva } : {}) }, i + 1);
    focusField(nl.id, 'desig');
  };
  host.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.altKey) return;
    const inp = ev.target, dz = inp.matches?.('.dz');
    if (ev.shiftKey) { if (dz) { ev.preventDefault(); document.execCommand?.('insertLineBreak'); } return; }
    if (!inp.matches?.('.ln input:not([type=checkbox]), .ln .dz') || (dz && inList())) return;
    ev.preventDefault(); enterNext(inp, ev.ctrlKey || ev.metaKey);
  });
  /* Claviers tactiles qui n'envoient pas la touche Entrée : même comportement */
  host.addEventListener('beforeinput', ev => {
    const t = ev.target; if (ev.inputType !== 'insertParagraph' || !t.matches?.('.dz') || inList()) return;
    ev.preventDefault();
    if (sg && sg.on >= 0 && sg.items[sg.on]) return sgPick(sg.items[sg.on].id);
    enterNext(t, false);
  });
  /* Collage dans la désignation : texte brut (pas de mise en page venue de Word ou d'un site) */
  host.addEventListener('paste', ev => {
    const t = ev.target; if (!t.matches?.('.dz')) return;
    ev.preventDefault();
    const txt = ((ev.clipboardData || window.clipboardData)?.getData('text/plain') || '').replace(/\r/g, '');
    txt.split('\n').forEach((part, i) => { if (i) document.execCommand?.('insertLineBreak'); if (part) document.execCommand?.('insertText', false, part); });
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
  /* « + Produit » : liste des catégories, puis une ligne dont la désignation cherche dans cette catégorie */
  const pmenu = $('#pmenu', box), pbtn = $('#addp', box);
  const menuClose = () => { pmenu.hidden = true; pbtn.setAttribute('aria-expanded', 'false'); };
  const menuOpen = () => {
    pmenu.hidden = false; pbtn.setAttribute('aria-expanded', 'true');
    const r = pbtn.getBoundingClientRect(); pmenu.classList.toggle('up', window.innerHeight - r.bottom < 300 && r.top > 280); // s'ouvre vers le haut s'il manque de la place dessous
  };
  pbtn.onclick = ev => { ev.stopPropagation(); if (pmenu.hidden) menuOpen(); else menuClose(); };
  pmenu.onclick = ev => {
    const it = ev.target.closest('[data-cat]'); if (!it) return; menuClose(); readHeader();
    const cat = it.dataset.cat;
    if (cat === '*') return pickProduct(p => { byId.set(p.id, p); add({ type: 'line', pid: p.id, ...(CAT_NAMES.includes(p.category) ? { cat: p.category } : {}), desig: p.name, qty: 1, unit: p.unit || 'u', pu: p.sell || 0, ...(String(p.ref ?? '').trim() ? { ref: p.ref } : {}), ...(num(p.buy) > 0 ? { pa: p.buy } : {}) }); }, { sale: true });
    const nl = add({ type: 'line', cat, pid: '', desig: '', qty: 1, unit: 'u', pu: 0 });
    focusField(nl.id, 'desig');
  };
  const outside = ev => { if (!box.isConnected) document.removeEventListener('click', outside); else if (!ev.target.closest?.('.abwrap')) menuClose(); };
  document.addEventListener('click', outside);
  box.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !pmenu.hidden) { menuClose(); pbtn.focus(); } });
  $('#addpdf', box).onclick = () => { readHeader(); import('./supplier-import.js').then(m => m.supplierImportModal({ onLines: ls => ls.forEach(l => add(l)) })); };
  $('#adds', box).onclick = () => add({ type: 'section', title: '', bold: true, sub: V().sub !== false });
  $('#adde', box).onclick = () => add({ type: 'sectionend' });
  $('#addt', box).onclick = () => add({ type: 'text', html: '' });
  $('#addb', box).onclick = () => add({ type: 'pagebreak' });
  $('#addm', box).onclick = () => snippetsModal(s => add({ type: 'text', html: sanitize(s.html) }));
  return { redraw: draw, applyView };
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
