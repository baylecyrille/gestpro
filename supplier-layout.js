// Lecture « à la main » d'un document fournisseur (facture, bon de livraison, bon de commande, devis…) : fonctions pures (testables hors navigateur).
// Entrée : pages = [[{x, y, w, h, s}, …], …] (texte positionné par pdf.js, y vers le bas = ligne de base) et sizes = [{w, h}, …] (taille des pages en points).
// Une zone est un rectangle RELATIF {p, x0, y0, x1, y1} (valeurs de 0 à 1) : elle reste valable pour une autre facture du même fournisseur.
import { mapUnit } from './supplier-parse.js';

const nb = s => { const v = parseFloat(String(s ?? '').replace(/[\s  ]/g, '').replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
const r2 = v => Math.round(v * 100) / 100;
const r4 = v => Math.round(v * 10000) / 10000;
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const layoutKey = name => norm(name).replace(/ /g, '-').slice(0, 40);
export const isoDate = d => (d ? d.split('/').reverse().join('-') : '');

/* ---------- types de document ---------- */
export const DOC_TYPES = [
  { key: 'facture', label: 'Facture', re: /\b(?:facture|invoice)\b/ },
  { key: 'avoir', label: 'Avoir', re: /\bavoir\b|note de credit/ },
  { key: 'devis', label: 'Devis', re: /\bdevis\b|offre de prix|proposition commerciale/ },
  { key: 'commande', label: 'Bon de commande', re: /bon de commande|confirmation de commande|accuse de reception de commande|commande fournisseur/ },
  { key: 'livraison', label: 'Bon de livraison', re: /bon de livraison|bordereau de livraison|bon de reception|avis d expedition/ }
];
const TYPE_ORDER = ['avoir', 'livraison', 'commande', 'devis', 'facture']; // à taille égale, le premier gagne
export const docType = key => { const t = DOC_TYPES.find(x => x.key === key); return t ? { key: t.key, label: t.label } : null; };
/* Type de document d'après son titre : on cherche les mots-clés dans le haut de la 1re page, et c'est le plus GRAND texte qui l'emporte
   (une facture peut citer « bon de livraison n° … » en petit sans devenir un bon de livraison). Renvoie {key,label} ou null. */
export function detectDocType(pages, sizes) {
  const H = sizes?.[0]?.h || 842;
  let best = null;
  for (const i of pages?.[0] || []) {
    const t = norm(i.s); if (!t || i.y / H > 0.5) continue;
    for (const d of DOC_TYPES) {
      if (!d.re.test(t)) continue;
      const h = i.h || 8, pr = TYPE_ORDER.indexOf(d.key);
      if (!best || h > best.h + 0.5 || (Math.abs(h - best.h) <= 0.5 && pr < best.pr)) best = { key: d.key, h, pr };
    }
  }
  return best ? docType(best.key) : null;
}
/* Type saisi par l'utilisateur : une valeur de la liste, ou un nom libre (« Relevé », « Reprise »…) */
export function customType(label) {
  const l = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return l ? { key: 'x-' + layoutKey(l).slice(0, 24), label: l } : null;
}

const cx = i => i.x + (i.w || 0) / 2;
const cy = i => i.y - (i.h || 8) / 2; // y = ligne de base : le texte est au-dessus

/* ---------- zones ---------- */
export function itemsIn(pages, sizes, z) {
  if (!z) return [];
  const W = sizes[z.p]?.w || 1, H = sizes[z.p]?.h || 1;
  return (pages[z.p] || []).filter(i => String(i.s).trim() && cx(i) / W >= z.x0 && cx(i) / W <= z.x1 && cy(i) / H >= z.y0 && cy(i) / H <= z.y1);
}
/* Mot (ou groupe de caractères) sous un point : sert à « toucher un mot » au lieu d'entourer */
export function itemAt(pages, sizes, p, rx, ry, tol = 0.006) {
  const W = sizes[p]?.w || 1, H = sizes[p]?.h || 1;
  let best = null, bd = Infinity;
  for (const i of pages[p] || []) {
    if (!String(i.s).trim()) continue;
    const x0 = i.x / W - tol, x1 = (i.x + (i.w || 0)) / W + tol, y1 = i.y / H + tol, y0 = (i.y - (i.h || 8)) / H - tol;
    if (rx < x0 || rx > x1 || ry < y0 || ry > y1) continue;
    const d = Math.abs(rx - (x0 + x1) / 2) + Math.abs(ry - (y0 + y1) / 2);
    if (d < bd) { bd = d; best = i; }
  }
  return best ? { p, x0: r4(best.x / W), x1: r4((best.x + (best.w || 0)) / W), y0: r4((best.y - (best.h || 8)) / H), y1: r4(best.y / H) } : null;
}
export function rowsOf(items, tol = 3.5) {
  const its = items.filter(i => String(i.s).trim()).map(i => ({ ...i, s: String(i.s).trim() })).sort((a, b) => a.y - b.y || a.x - b.x);
  const out = []; let cur = null;
  for (const it of its) {
    if (cur && Math.abs(it.y - cur.y) <= tol) { cur.t.push(it); cur.y = (cur.y * (cur.t.length - 1) + it.y) / cur.t.length; }
    else { cur = { y: it.y, t: [it] }; out.push(cur); }
  }
  out.forEach(r => { r.t.sort((a, b) => a.x - b.x); r.text = r.t.map(i => i.s).join(' '); });
  return out;
}
export const zoneRows = (pages, sizes, z) => rowsOf(itemsIn(pages, sizes, z)).map(r => r.text);
export const zoneText = (pages, sizes, z, sep = ', ') => zoneRows(pages, sizes, z).join(sep);

/* ---------- valeurs ---------- */
const MONTHS = { janv: 1, janvier: 1, fevr: 2, fevrier: 2, mars: 3, avr: 4, avril: 4, mai: 5, juin: 6, juil: 7, juillet: 7, aout: 8, sept: 9, septembre: 9, oct: 10, octobre: 10, nov: 11, novembre: 11, dec: 12, decembre: 12 };
export function pickDate(t) {
  const s = String(t || '');
  let m = s.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4}|\d{2})\b/);
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3].length === 2 ? '20' + m[3] : m[3]}`;
  m = norm(s).match(/(\d{1,2})(?:er)? ([a-z]+) (\d{4})/);
  if (m && MONTHS[m[2]]) return `${m[1].padStart(2, '0')}/${String(MONTHS[m[2]]).padStart(2, '0')}/${m[3]}`;
  return '';
}
export function pickNumber(t) {
  const raw = String(t || '').trim();
  const toks = raw.split(/\s+/).map(x => x.replace(/^(?:n°|no[:.]|num[ée]ro[:.]?)(?=\S)/i, '').replace(/[:,;]+$/, ''))
    .filter(x => /\d/.test(x) && x.length >= 2 && !/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(x));
  return toks.length ? toks[toks.length - 1] : raw;
}

const SKIP_NAME = /^(facture|devis|bon de|commande|date|page|n°|client|destinataire|donneur|livraison|adresse de|tel|tél|t[ée]l[ée]phone|e-?mail|mail|siret|siren|tva|vat|www\.|http|fax|mobile)/i;
/* Bloc « fournisseur » (nom, adresse, code postal, ville, téléphone, e-mail, SIRET, TVA) */
export function supplierFromBlock(lines) {
  const L = lines.map(s => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const S = {}, bt = L.join('\n');
  const bi = L.findIndex(s => s.length >= 2 && !SKIP_NAME.test(s) && !/^\d{4,5}\s/.test(s) && !/@/.test(s) && !/^[\d\s.+()\-]+$/.test(s));
  if (bi >= 0) {
    S.name = L[bi];
    const zi = L.findIndex((s, i) => i > bi && /^(?:[A-Z]{1,2}[- ])?\d{4,5}\s+\S+/.test(s));
    if (zi > 0) {
      const m = L[zi].match(/^((?:[A-Z]{1,2}[- ])?\d{4,5})\s+(.+)$/);
      S.zip = m[1]; S.city = m[2];
      S.address = L.slice(bi + 1, zi).filter(s => !SKIP_NAME.test(s) && !/@/.test(s)).join(', ');
    } else S.address = L.slice(bi + 1).filter(s => !SKIP_NAME.test(s) && !/@/.test(s) && !/^[\d\s.+()\-]+$/.test(s)).slice(0, 2).join(', ');
  }
  S.siret = ((bt.match(/SIRET\s*:?\s*([\d ]{14,17})/i) || [])[1] || '').replace(/\s/g, '');
  S.tva = ((bt.match(/(?:TVA|VAT)[^\n:]*:?\s*([A-Z]{2}[\s\dA-Z]{9,15})/) || [])[1] || '').replace(/\s/g, '');
  S.email = (bt.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [])[0] || '';
  S.phone = ((bt.match(/T[ée]l(?:[ée]phone)?\.?\s*:?\s*(\+?[\d .]{9,18})/i) || [])[1] || '').trim();
  return S;
}

/* ---------- tableau ---------- */
export const COLS = ['ref', 'name', 'qty', 'unit', 'price', 'tva', 'amount'];
export const COL_LABEL = { ref: 'Référence', name: 'Désignation', qty: 'Quantité', unit: 'Unité', price: 'Prix unitaire HT', tva: 'TVA %', amount: 'Montant HT' };
const HDR = [
  ['ref', /(^r[ée]f|r[ée]f[ée]rence|^code|n°\s*art|^sku|^id\b)/i],
  ['amount', /(montant|total|valeur)/i],
  ['price', /(^p\.?\s?u\b|prix|tarif|^px)/i],
  ['qty', /(qt[ée]|quant|nombre|^nb\b)/i],
  ['unit', /^(unit[ée]s?|u\.?|un\.?)$/i],
  ['tva', /(tva|taxe|^%$)/i],
  ['name', /(d[ée]signation|libell[ée]|description|produit|intitul[ée]|article|prestation)/i]
];
const isNumTxt = s => /^-?\d[\d\s  ]*([.,]\d+)?\s*(€|eur)?$/i.test(String(s).trim());

/* Colonnes d'un tableau : on regroupe le texte par bandes verticales, puis on devine le champ de chaque bande
   (d'après l'en-tête, sinon d'après le contenu). Résultat : [{a, b, field, n, head}] en positions relatives. */
export function detectBands(pages, sizes, z) {
  const W = sizes[z.p]?.w || 1;
  const its = itemsIn(pages, sizes, z);
  if (!its.length) return [];
  const rows = rowsOf(its);
  const isProd = r => r.t.length >= 3 && r.t.some(i => isNumTxt(i.s));
  const first = rows.findIndex(isProd);
  const body = first >= 0 ? rows.filter((r, k) => k >= first && isProd(r)) : rows;
  const head = first > 0 ? rows.slice(0, first) : [];
  const iv = body.flatMap(r => r.t).map(i => [i.x / W, (i.x + (i.w || 0)) / W]).sort((a, b) => a[0] - b[0]);
  const gap = 5 / W, bands = []; let cur = null;
  for (const [a, b] of iv) {
    if (cur && a - cur.b <= gap) cur.b = Math.max(cur.b, b);
    else { cur = { a, b, field: '', n: 0, head: '', items: [] }; bands.push(cur); }
  }
  const at = i => { const c = cx(i) / W; return bands.find(b => c >= b.a - 2 / W && c <= b.b + 2 / W) || bands.reduce((m, b) => (Math.abs((b.a + b.b) / 2 - c) < Math.abs((m.a + m.b) / 2 - c) ? b : m)); };
  body.flatMap(r => r.t).forEach(i => { const b = at(i); b.n++; b.items.push(i.s); });
  head.flatMap(r => r.t).forEach(i => { const b = at(i); b.head += (b.head ? ' ' : '') + i.s; });
  /* 1) d'après l'en-tête */
  const used = new Set();
  bands.forEach(b => { const h = b.head.trim(); if (!h) return; const hit = HDR.find(([f, re]) => !used.has(f) && re.test(h)); if (hit) { b.field = hit[0]; used.add(hit[0]); } });
  /* 2) d'après le contenu, pour les bandes restantes */
  const free = bands.filter(b => !b.field);
  free.forEach(b => { b.num = b.items.length && b.items.filter(isNumTxt).length / b.items.length >= 0.7; b.pct = b.items.some(s => /%/.test(s)); b.len = b.items.reduce((a, s) => a + s.length, 0) / (b.items.length || 1); });
  const take = (b, f) => { if (b && !used.has(f)) { b.field = f; used.add(f); } };
  free.filter(b => b.pct && !b.field).forEach(b => take(b, 'tva'));
  const texts = free.filter(b => !b.field && !b.num), nums = free.filter(b => !b.field && b.num);
  const nameBand = used.has('name') ? null : texts.slice().sort((a, b) => b.len - a.len)[0];
  take(nameBand, 'name');
  const nm = bands.find(b => b.field === 'name');
  texts.filter(b => !b.field).forEach(b => {
    if (nm && b.a < nm.a && b.len <= 16) take(b, 'ref');
    else if (nm && b.a > nm.a && b.len <= 4) take(b, 'unit');
  });
  const nn = nums.filter(b => !b.field);
  if (nn.length >= 3) { take(nn[nn.length - 1], 'amount'); take(nn[nn.length - 2], 'price'); take(nn[0], 'qty'); }
  else if (nn.length === 2) { take(nn[0], 'qty'); take(nn[1], 'amount'); }
  else if (nn.length === 1) take(nn[0], 'amount');
  return bands.map(b => ({ a: r4(b.a), b: r4(b.b), field: b.field, n: b.n, head: b.head, ex: b.items[0] || '' }));
}

/* Insère une colonne dessinée à la main : elle recoupe les colonnes qu'elle chevauche */
export function insertBand(bands, nbnd) {
  const out = [];
  for (const b of bands) {
    if (b.b <= nbnd.a || b.a >= nbnd.b) { out.push(b); continue; }
    if (b.a < nbnd.a - 0.004) out.push({ ...b, b: nbnd.a });
    if (b.b > nbnd.b + 0.004) out.push({ ...b, a: nbnd.b });
  }
  out.push({ a: nbnd.a, b: nbnd.b, field: nbnd.field || '', n: nbnd.n || 0, head: '' });
  // un champ ne sert qu'une fois
  out.forEach(b => { if (b !== out[out.length - 1] && nbnd.field && b.field === nbnd.field) b.field = ''; });
  return out.sort((x, y) => x.a - y.a);
}
export function mergeNext(bands, k) {
  if (k < 0 || k >= bands.length - 1) return bands;
  const m = { ...bands[k], b: bands[k + 1].b, n: bands[k].n + bands[k + 1].n, field: bands[k].field || bands[k + 1].field };
  return [...bands.slice(0, k), m, ...bands.slice(k + 2)];
}

/* Tableau mémorisable : première ligne (haut de la zone), limites gauche / droite et coupures entre colonnes */
export function makeTable(z, bands) {
  const bs = [...bands].sort((a, b) => a.a - b.a);
  if (!bs.length) return null;
  const cuts = bs.slice(0, -1).map((b, k) => r4((b.b + bs[k + 1].a) / 2));
  return { p: z.p, y0: r4(z.y0), x0: r4(Math.max(0, bs[0].a - 0.03)), x1: r4(Math.min(1, bs[bs.length - 1].b + 0.03)), cuts, fields: bs.map(b => b.field || '') };
}
const bandOf = (cuts, rel) => { let k = 0; while (k < cuts.length && rel >= cuts[k]) k++; return k; };

const STOP = /^(total|montant\s+(?:total|ht|ttc|tva|net)|net\s+[àa]\s+payer|base\s+ht|tva\b|taxes?\b|remise\/frais|escompte|conditions?\s+de|mode\s+de\s+r[èe]glement|r[èe]glement|iban|bic|page\s+\d)/i;
const SKIP = /^(sous[- ]?total|report|total\s+page)/i;

/* Lit les lignes de produit : du haut du tableau jusqu'aux totaux (ou à la fin de la dernière page) */
export function readTable(pages, sizes, T) {
  const items = [];
  if (!T?.fields?.some(Boolean)) return items;
  let started = false, stopped = false, cur = null, lastY = 0, lastP = -1;
  for (let pi = T.p; pi < pages.length && !stopped; pi++) {
    const W = sizes[pi]?.w || 1, H = sizes[pi]?.h || 1, top = pi === T.p ? T.y0 : 0;
    const its = (pages[pi] || []).filter(i => { const rx = cx(i) / W; return cy(i) / H >= top - 0.002 && rx >= T.x0 && rx <= T.x1; });
    for (const row of rowsOf(its)) {
      const cells = {};
      for (const it of row.t) { const f = T.fields[bandOf(T.cuts, cx(it) / W)]; if (f) cells[f] = cells[f] ? cells[f] + ' ' + it.s : it.s; }
      if (started && STOP.test(row.text)) { stopped = true; break; }
      if (SKIP.test(row.text)) continue;
      const qty = nb(cells.qty), price = nb(cells.price), amount = nb(cells.amount);
      const hasNum = [qty, price, amount].some(Number.isFinite);
      const label = cells.name || cells.ref || '';
      if (label && hasNum) {
        const q = Number.isFinite(qty) ? qty : 1;
        const p = Number.isFinite(price) ? price : (Number.isFinite(amount) && q ? r2(amount / q) : 0);
        const tva = nb(cells.tva);
        cur = { n: items.length + 1, name: label, qty: q, unit: cells.unit || '', unitMapped: mapUnit(cells.unit), price: p, amount: Number.isFinite(amount) ? amount : r2(q * p), tva: Number.isFinite(tva) ? tva : 20, ref: cells.ref || '' };
        items.push(cur); started = true; lastY = row.y; lastP = pi; continue;
      }
      if (cur && !hasNum && label && pi === lastP && row.y - lastY <= 16) { // suite de la désignation sur la ligne d'en-dessous
        if (cells.name) cur.name += ' ' + cells.name;
        if (cells.ref && !cur.ref) cur.ref = cells.ref;
        lastY = row.y;
      }
    }
  }
  return items;
}

/* ---------- résultat complet (même forme que parseSupplierInvoice) ---------- */
export function buildResult(pages, sizes, spec, values = {}) {
  const Z = spec.zones || {};
  const txt = (id, sep) => (Z[id] ? zoneText(pages, sizes, Z[id], sep) : '');
  let S = {};
  if (Z['sup.block']) S = supplierFromBlock(zoneRows(pages, sizes, Z['sup.block']));
  if (Z['sup.name']) { const v = txt('sup.name', ' ').trim(); if (v) S.name = v; }
  if (Z['sup.address']) { const v = txt('sup.address').trim(); if (v) S.address = v; }
  if (Z['sup.zipcity']) { const m = txt('sup.zipcity', ' ').match(/(\d{4,5})\s+(.+)/); if (m) { S.zip = m[1]; S.city = m[2].trim(); } }
  if (Z['sup.phone']) { const v = (txt('sup.phone', ' ').match(/\+?[\d][\d .]{7,16}\d/) || [])[0]; if (v) S.phone = v.trim(); }
  if (Z['sup.email']) { const v = (txt('sup.email', ' ').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [])[0]; if (v) S.email = v; }
  if (Z['sup.siret']) { const v = txt('sup.siret', ' ').replace(/\D/g, ''); if (v.length >= 9) S.siret = v.slice(0, 14); }
  if (Z['sup.tva']) { const v = (txt('sup.tva', ' ').replace(/\s/g, '').match(/[A-Z]{2}[\dA-Z]{8,13}/) || [])[0]; if (v) S.tva = v; }
  for (const k of ['name', 'address', 'zip', 'city', 'phone', 'email', 'siret', 'tva']) if (values[k] !== undefined) S[k] = values[k];
  if (!S.name && spec.name) S.name = spec.name;
  const inv = { number: values.number !== undefined ? values.number : pickNumber(txt('inv.number', ' ')), date: values.date !== undefined ? values.date : pickDate(txt('inv.date', ' ')), due: values.due !== undefined ? values.due : pickDate(txt('inv.due', ' ')), terms: '', iso: isoDate };
  const items = spec.table ? readTable(pages, sizes, spec.table) : [];
  const sum = r2(items.reduce((a, i) => a + (i.amount || 0), 0));
  return { supplier: S, invoice: inv, items, fees: [], totals: {}, sum, sumOk: null, mode: 'manuel' };
}

/* ---------- mémoire par fournisseur ---------- */
export function makeLayout(spec, name, type) {
  const Z = spec.zones || {};
  const rect = Z['sup.name'] || Z['sup.block'] || null;
  const ty = type?.key ? { key: String(type.key), label: String(type.label || type.key) } : null;
  return {
    v: 2, name: String(name || '').trim(), key: layoutKey(name) + (ty ? '~' + ty.key : ''), type: ty,
    fp: { text: norm(name), rect: rect ? { p: rect.p, x0: r4(rect.x0), y0: r4(rect.y0), x1: r4(rect.x1), y1: r4(rect.y1) } : null },
    zones: Object.fromEntries(Object.entries(Z).map(([k, z]) => [k, { p: z.p, x0: r4(z.x0), y0: r4(z.y0), x1: r4(z.x1), y1: r4(z.y1) }])),
    table: spec.table || null
  };
}
/* Quelle mise en page mémorisée correspond à ce PDF ? Il faut le même fournisseur (son nom se retrouve dans la zone mémorisée, sinon dans le haut
   de la 1re page) ET le même type de document. Sans type reconnu dans le PDF, on ne choisit que s'il n'y a qu'une seule possibilité.
   Les anciennes mises en page sans type servent de repli. */
export function matchLayout(pages, sizes, layouts, type = null) {
  const top = norm(zoneText(pages, sizes, { p: 0, x0: 0, y0: 0, x1: 1, y1: 0.4 }, ' '));
  const pool = [];
  for (const L of layouts) {
    const t = L?.fp?.text; if (!t || t.length < 3 || !L.table) continue;
    const inRect = L.fp.rect ? norm(zoneText(pages, sizes, L.fp.rect, ' ')).includes(t) : false;
    const sc = inRect ? 2 : top.includes(t) ? 1 : 0;
    if (sc) pool.push({ L, sc, len: t.length });
  }
  let pick = type?.key ? pool.filter(x => x.L.type?.key === type.key) : [];
  if (!pick.length) pick = pool.filter(x => !x.L.type?.key);
  if (!pick.length && !type?.key) { const typed = pool.filter(x => x.L.type?.key); if (typed.length === 1) pick = typed; }
  let best = null;
  for (const x of pick) if (!best || x.sc > best.sc || (x.sc === best.sc && x.len > best.len)) best = x;
  return best ? best.L : null;
}
