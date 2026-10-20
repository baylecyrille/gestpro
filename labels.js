// Étiquettes code-barres imprimables (M10) : planche A4 d'étiquettes autocollantes, depuis la fiche produit, la liste du stock ou une réception.
// Le dessin des codes est dans barcode.js ; les calculs de mise en page (planche, positions, pages) sont purs et testables.
import * as db from './db.js';
import { e, num, modal, toast, F, refresh, $ } from './util.js';
import * as BC from './barcode.js';

/* Planches courantes (A4, étiquettes rectangulaires). Dimensions en mm : w × h = étiquette, top / left = marges de la planche,
   gx / gy = espaces entre étiquettes. À vérifier par un essai sur papier ordinaire avant d'imprimer sur les étiquettes. */
export const SHEETS = [
  { id: 'l7160', name: '21 étiquettes · 63,5 × 38,1 mm (type Avery L7160)', cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.2, gx: 2.5, gy: 0 },
  { id: 'l7161', name: '18 étiquettes · 63,5 × 46,6 mm (type Avery L7161)', cols: 3, rows: 6, w: 63.5, h: 46.6, top: 8.7, left: 7.2, gx: 2.5, gy: 0 },
  { id: 'l7163', name: '14 étiquettes · 99,1 × 38,1 mm (type Avery L7163)', cols: 2, rows: 7, w: 99.1, h: 38.1, top: 15.15, left: 4.7, gx: 2.5, gy: 0 },
  { id: 'l7165', name: '8 étiquettes · 99,1 × 67,7 mm (type Avery L7165)', cols: 2, rows: 4, w: 99.1, h: 67.7, top: 13, left: 4.7, gx: 2.5, gy: 0 },
  { id: 'l4736', name: '48 étiquettes · 45,7 × 21,2 mm (type Avery L4736)', cols: 4, rows: 12, w: 45.7, h: 21.2, top: 21.4, left: 9.75, gx: 2.5, gy: 0 },
  { id: 'l7651', name: '65 étiquettes · 38,1 × 21,2 mm (type Avery L7651)', cols: 5, rows: 13, w: 38.1, h: 21.2, top: 10.7, left: 4.75, gx: 2.5, gy: 0 },
  { id: 'custom', name: 'Sur mesure (je saisis les dimensions de ma planche)', cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.2, gx: 2.5, gy: 0 }
];
export const PAGE = { w: 210, h: 297 };
export const MIN_MODULE_MM = 0.25; // en dessous, les barres sont trop fines pour la plupart des lecteurs

const r2 = v => Math.round(v * 100) / 100;
export const per = s => s.cols * s.rows;
/* Position (mm) de la n-ième étiquette d'une planche (0 = en haut à gauche, de gauche à droite puis de haut en bas) */
export const slot = (s, i) => ({ x: r2(s.left + (i % s.cols) * (s.w + s.gx)), y: r2(s.top + Math.floor(i / s.cols) * (s.h + s.gy)) });
/* La planche tient-elle sur une feuille A4 ? Renvoie un message d'erreur, ou '' */
export function sheetError(s) {
  const n = [s.cols, s.rows, s.w, s.h].map(Number);
  if (n.some(v => !(v > 0))) return 'Indiquez le nombre de colonnes et de lignes et la taille de l\'étiquette.';
  if (!Number.isInteger(+s.cols) || !Number.isInteger(+s.rows)) return 'Le nombre de colonnes et de lignes doit être un nombre entier.';
  if (s.left < 0 || s.top < 0 || s.gx < 0 || s.gy < 0) return 'Les marges et les espaces ne peuvent pas être négatifs.';
  if (s.left + s.cols * s.w + (s.cols - 1) * s.gx > PAGE.w + 0.01) return 'La planche dépasse la largeur d\'une feuille A4 (210 mm) : vérifiez les dimensions.';
  if (s.top + s.rows * s.h + (s.rows - 1) * s.gy > PAGE.h + 0.01) return 'La planche dépasse la hauteur d\'une feuille A4 (297 mm) : vérifiez les dimensions.';
  return '';
}
/* Répartit les étiquettes sur les planches. start = numéro (1…) de la première étiquette libre de la 1re planche (planche déjà entamée). */
export function paginate(items, s, start = 1) {
  const n = per(s), first = Math.max(0, Math.min(n - 1, (parseInt(start, 10) || 1) - 1)), pages = [];
  let page = null, pos = first;
  for (const it of items) {
    if (!page || pos >= n) { page = []; pages.push(page); pos = page === pages[0] ? first : 0; }
    page.push({ it, i: pos++ });
  }
  return pages;
}
/* Largeur d'un module (plus fine barre) en mm si le code tient dans la largeur utile de l'étiquette */
export const moduleMm = (s, enc) => (enc && enc.bits ? Math.round(((s.w - 3) / BC.modulesOf(enc)) * 100) / 100 : 0);

const sizes = h => (h >= 60 ? { name: 12, hum: 10, lines: 3 } : h >= 36 ? { name: 9, hum: 8, lines: 2 } : { name: 6.5, hum: 6.5, lines: 1 });
const fmtPrice = v => `${(Math.round(v * 100) / 100).toFixed(2).replace('.', ',')} € TTC`;

/* HTML d'une étiquette. it = { name, ref, enc, price } (price : texte déjà formaté ou '') */
export function labelHtml(it, s, { x = 0, y = 0, contour = false } = {}) {
  const z = sizes(s.h);
  return `<div class="lbl${contour ? ' ctr' : ''}" style="left:${x}mm;top:${y}mm;width:${s.w}mm;height:${s.h}mm;--nf:${z.name}pt;--hf:${z.hum}pt;--nl:${z.lines}">
    <div class="ln">${e(it.name)}</div><div class="lb">${BC.svg(it.enc)}</div><div class="lh">${e(it.enc.human)}</div>
    ${it.ref || it.price ? `<div class="lr">${[it.ref && it.ref !== it.enc.text ? e(it.ref) : '', it.price ? `<b>${e(it.price)}</b>` : ''].filter(Boolean).join(' · ')}</div>` : ''}</div>`;
}
/* Document imprimable : une page A4 par planche, sans marge (le positionnement est au millimètre) */
export function labelsPrintHtml(items, s, { start = 1, contour = false } = {}) {
  const pages = paginate(items, s, start);
  return `<style>@media print{@page{size:A4;margin:0}}</style>${pages.map(p => `<div class="lblpage">${p.map(({ it, i }) => labelHtml(it, s, { ...slot(s, i), contour })).join('')}</div>`).join('')}`;
}

/* Étiquette d'un produit : { item, error } — code-barres de la fiche, sinon référence (si on peut la dessiner) */
export function itemOf(p, { price = false } = {}) {
  const code = String(p.barcode || '').trim(), enc = BC.encode(code);
  if (!code) return { error: 'pas de code-barres' };
  if (enc.error) return { error: enc.error };
  const ttc = num(p.sell) * (1 + num(p.tva ?? 20) / 100);
  return { item: { name: p.name || '', ref: p.ref || '', enc, price: price && num(p.sell) > 0 ? fmtPrice(ttc) : '' } };
}

/* ---------- Réglages mémorisés (confort : l'appli fonctionne sans) ---------- */
const KEY = 'gestpro.labels';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } };
const keep = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* navigation privée : on s'en passe */ } };

/* ---------- Fenêtre « Étiquettes » ----------
   products : tous les produits ; preset : [{ id, qty }] quantités de départ (fiche produit, réception) */
export function labelsModal(products, { preset = [] } = {}) {
  const prefs = load();
  const qty = new Map(preset.map(x => [x.id, Math.max(0, Math.floor(num(x.qty)))]).filter(x => x[1] > 0));
  const byId = new Map(products.map(p => [p.id, p]));
  const sheetOpts = SHEETS.map(s => [s.id, s.name]);
  const cur = SHEETS.find(s => s.id === prefs.sheet) || SHEETS[0];
  const needNum = (name, label, v, step = 'any') => F(label, name, v, { type: 'number', step, extra: 'min="0"' });
  modal('🏷 Étiquettes code-barres',
    `<p class="muted" style="margin-top:0">Choisissez le nombre d'étiquettes de chaque produit, puis imprimez sur une planche d'étiquettes autocollantes A4. Les codes sont dessinés sur l'appareil : rien n'est envoyé nulle part.</p>
    <div class="cols">
      ${F('Planche d\'étiquettes', 'sheet', cur.id, { type: 'select', options: sheetOpts, cls: 'full' })}
      <div class="full cols" id="lcustom" hidden>
        ${needNum('cols', 'Colonnes', prefs.cols ?? cur.cols, '1')}${needNum('rows', 'Lignes', prefs.rows ?? cur.rows, '1')}
        ${needNum('w', 'Largeur d\'étiquette (mm)', prefs.w ?? cur.w)}${needNum('h', 'Hauteur d\'étiquette (mm)', prefs.h ?? cur.h)}
        ${needNum('top', 'Marge haute (mm)', prefs.top ?? cur.top)}${needNum('left', 'Marge gauche (mm)', prefs.left ?? cur.left)}
        ${needNum('gx', 'Espace entre colonnes (mm)', prefs.gx ?? cur.gx)}${needNum('gy', 'Espace entre lignes (mm)', prefs.gy ?? cur.gy)}
      </div>
      ${F('Commencer à l\'étiquette n°', 'start', 1, { type: 'number', step: '1', extra: 'min="1"' })}<span class="muted" style="align-self:end;font-size:12px;padding-bottom:10px">pour finir une planche déjà entamée</span>
    </div>
    <label class="f full"><span><input type="checkbox" name="gen" ${prefs.gen === false ? '' : 'checked'}> Donner un code interne (enregistré sur la fiche) aux produits qui n'ont pas de code-barres</span></label>
    <label class="f full"><span><input type="checkbox" name="price" ${prefs.price ? 'checked' : ''}> Afficher le prix de vente TTC sur l'étiquette</span></label>
    <label class="f full"><span><input type="checkbox" name="contour"> Tracer le contour des étiquettes (essai sur papier ordinaire, à superposer à la planche)</span></label>
    <h3 style="margin-bottom:4px">Produits</h3>
    <input id="lq" placeholder="Rechercher un produit, une référence, un code…" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:6px">
    <div id="llist" class="llist"></div>
    <p id="lsum" class="muted" style="margin-bottom:4px"></p><div id="lprev" class="lprev"></div>`,
    async o => {
      const sel = products.filter(p => (qty.get(p.id) || 0) > 0);
      if (!sel.length) { alert('Indiquez le nombre d\'étiquettes d\'au moins un produit.'); return false; }
      const s = sheetOf(o); const err = sheetError(s);
      if (err) { alert(err); return false; }
      const used = new Set(products.map(p => String(p.barcode || '').trim()).filter(Boolean));
      const skipped = [], made = [], items = [];
      for (const p of sel) {
        let q = Math.min(999, qty.get(p.id));
        let r = itemOf(p, { price: !!o.price });
        if (r.error === 'pas de code-barres' && o.gen) {
          const code = BC.internalCode([...used]); used.add(code);
          made.push({ p, code });
          r = itemOf({ ...p, barcode: code }, { price: !!o.price });
        }
        if (r.error) { skipped.push(`${p.name} (${r.error === 'pas de code-barres' ? 'pas de code-barres' : r.error})`); continue; }
        for (let i = 0; i < q; i++) items.push(r.item);
      }
      if (skipped.length && !confirm(`${skipped.length} produit(s) ne seront pas imprimés :\n${skipped.slice(0, 6).join('\n')}${skipped.length > 6 ? '\n…' : ''}\n\nImprimer les autres ?`)) return false;
      if (!items.length) { alert('Aucune étiquette à imprimer.'); return false; }
      for (const { p, code } of made) await db.put('products', { ...p, barcode: code });
      keep({ sheet: s.id, ...(s.id === 'custom' ? { cols: s.cols, rows: s.rows, w: s.w, h: s.h, top: s.top, left: s.left, gx: s.gx, gy: s.gy } : {}), gen: !!o.gen, price: !!o.price });
      $('#printarea').innerHTML = labelsPrintHtml(items, s, { start: o.start, contour: !!o.contour });
      setTimeout(() => window.print(), 60);
      if (made.length) { toast(`${made.length} code(s) interne(s) créé(s) sur les fiches`); refresh(); }
    }, {
      wide: true, submitLabel: '🖨 Imprimer',
      onOpen: f => {
        const list = $('#llist', f);
        const sheetNow = () => { const o = Object.fromEntries(new FormData(f)); return sheetOf(o); };
        const sum = () => {
          const sel = products.filter(p => (qty.get(p.id) || 0) > 0), s = sheetNow();
          const total = sel.reduce((a, p) => a + Math.min(999, qty.get(p.id)), 0), n = per(s) || 1;
          const first = Math.max(1, parseInt(f.elements.start.value, 10) || 1);
          const pages = total ? Math.ceil((total + first - 1) / n) : 0;
          const warn = [];
          let prev = '';
          for (const p of sel) {
            const code = String(p.barcode || '').trim();
            if (!code) continue;
            const enc = BC.encode(code);
            if (enc.error) warn.push(`${e(p.name)} : code illisible pour un code-barres`);
            else if (moduleMm(s, enc) && moduleMm(s, enc) < MIN_MODULE_MM) warn.push(`${e(p.name)} : code trop long pour cette étiquette (barres de ${String(moduleMm(s, enc)).replace('.', ',')} mm, risque de lecture difficile)`);
          }
          $('#lsum', f).innerHTML = total ? `<b>${total}</b> étiquette(s) sur <b>${pages}</b> planche(s)${sel.some(p => !String(p.barcode || '').trim()) ? ' · les produits sans code recevront un code interne si la case est cochée' : ''}.${warn.length ? `<br><span style="color:var(--warn)">⚠ ${warn.join('<br>⚠ ')}</span>` : ''}` : 'Aucune étiquette choisie.';
          const first1 = sel.map(p => itemOf(p.barcode ? p : { ...p, barcode: BC.internalCode(products.map(x => x.barcode)) }, { price: f.elements.price.checked })).find(r => r.item);
          if (first1 && !sheetError(s)) prev = `<div class="lblpage prev" style="width:${s.w}mm;height:${s.h}mm">${labelHtml(first1.item, s, { x: 0, y: 0, contour: true })}</div>`;
          $('#lprev', f).innerHTML = prev ? `<small class="muted">Aperçu d'une étiquette (taille réelle)</small>${prev}` : '';
        };
        const draw = () => {
          const q = $('#lq', f).value.toLowerCase().trim();
          const hit = p => !q || [p.name, p.ref, p.barcode, p.category].join(' ').toLowerCase().includes(q);
          const chosen = products.filter(p => (qty.get(p.id) || 0) > 0 && hit(p));
          const rest = products.filter(p => !(qty.get(p.id) > 0) && hit(p)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
          const shown = [...chosen.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr')), ...rest.slice(0, q ? 80 : 40)];
          list.innerHTML = shown.map(p => `<div class="lrow" data-id="${e(p.id)}"><span class="lt">${e(p.name)}<small class="muted">${[p.ref, p.barcode || 'sans code-barres'].filter(Boolean).map(e).join(' · ')}</small></span><input type="number" min="0" max="999" step="1" inputmode="numeric" data-q value="${qty.get(p.id) || ''}" placeholder="0" aria-label="Nombre d'étiquettes"></div>`).join('')
            + (rest.length > (q ? 80 : 40) ? `<p class="muted" style="margin:6px 0">… ${rest.length - (q ? 80 : 40)} autre(s) produit(s) : utilisez la recherche.</p>` : '') || '<p class="muted">Aucun produit.</p>';
        };
        const showCustom = () => { $('#lcustom', f).hidden = f.elements.sheet.value !== 'custom'; };
        list.addEventListener('input', ev => {
          const i = ev.target.closest('[data-q]'); if (!i) return;
          const n = Math.max(0, Math.floor(num(i.value)));
          if (n) qty.set(i.closest('.lrow').dataset.id, n); else qty.delete(i.closest('.lrow').dataset.id);
          sum();
        });
        $('#lq', f).addEventListener('input', draw);
        f.addEventListener('change', ev => { if (ev.target.name === 'sheet') { const s = SHEETS.find(x => x.id === ev.target.value); if (s && s.id !== 'custom') ['cols', 'rows', 'w', 'h', 'top', 'left', 'gx', 'gy'].forEach(k => { f.elements[k].value = s[k]; }); showCustom(); } sum(); });
        f.addEventListener('input', ev => { if (ev.target.closest('#lcustom') || ev.target.name === 'start') sum(); });
        draw(); showCustom(); sum();
      }
    });
}
function sheetOf(o) {
  const base = SHEETS.find(s => s.id === o.sheet) || SHEETS[0];
  if (base.id !== 'custom') return base;
  const g = (k, d) => (o[k] === '' || o[k] === undefined ? d : num(o[k]));
  return { id: 'custom', name: base.name, cols: g('cols', 0), rows: g('rows', 0), w: g('w', 0), h: g('h', 0), top: g('top', 0), left: g('left', 0), gx: g('gx', 0), gy: g('gy', 0) };
}
export { sheetOf };
