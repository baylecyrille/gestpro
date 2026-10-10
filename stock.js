// Stock : produits, code-barres, zones / emplacements, mouvements, import Excel/CSV.
import * as db from './db.js';
import { e, eur, num, dateFr, today, F, modal, closeModal, toast, scan, tabs, refresh, go, loadScript, readFileText, readFileBuf, compressImage, $, $$ } from './util.js';
import { markPhotosDirty } from './sheets.js';

export const total = p => Object.values(p.stock || {}).reduce((a, b) => a + b, 0);
export const locLabel = l => (l ? `${l.zone} › ${l.place}` : '—');
export const UNITS = ['u', 'm', 'm²', 'm³', 'ml', 'kg', 'L', 'lot', 'h', 'forfait'];
const TVAS = [['0', '0 %'], ['5.5', '5,5 %'], ['10', '10 %'], ['20', '20 %']];

export async function ensureDefaultLocation() {
  const l = await db.all('locations');
  if (!l.length) await db.put('locations', { id: 'loc-default', zone: 'Dépôt', place: 'Principal', note: '' });
}

function applyMove(p, m) {
  p.stock = p.stock || {};
  const add = (k, q) => { p.stock[k] = Math.round(((p.stock[k] || 0) + q) * 1000) / 1000; };
  if (m.type === 'in') add(m.to, m.qty);
  else if (m.type === 'out') add(m.from, -m.qty);
  else if (m.type === 'transfer') { add(m.from, -m.qty); add(m.to, m.qty); }
  else if (m.type === 'adjust') p.stock[m.to] = m.qty;
}

export async function recordMove(p, m) {
  m.productId = p.id; m.date = m.date || new Date().toISOString();
  applyMove(p, m);
  await db.put('products', p);
  await db.put('moves', m);
}

// Sortie automatique du stock pour les lignes d'une facture (emplacements les plus fournis d'abord)
export async function autoOut(lines, ref, siteId = '') {
  let n = 0;
  for (const ln of lines) {
    if (!ln.pid) continue;
    const p = await db.get('products', ln.pid);
    if (!p) continue;
    let need = num(ln.qty);
    const locs = Object.entries(p.stock || {}).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
    for (const [lid, q] of locs) {
      if (need <= 0) break;
      const take = Math.min(q, need);
      await recordMove(p, { type: 'out', from: lid, qty: take, note: `Facture ${ref}`, unit: num(p.buy), siteId });
      need -= take; n++;
    }
  }
  return n;
}

export async function renderStock(el, tab = 'products') {
  if (tab === 'scan') { await lookupScan(); tab = 'products'; }
  el.innerHTML = `<h2>Stock</h2>${tabs('#/stock', [['products', 'Produits'], ['locations', 'Emplacements'], ['moves', 'Mouvements']], tab)}<div id="tb"></div>`;
  const body = $('#tb', el);
  const [products, locs, contacts] = await Promise.all([db.all('products'), db.all('locations'), db.all('contacts')]);
  if (tab === 'locations') return locationsTab(body, products, locs);
  if (tab === 'moves') return movesTab(body, products, locs);
  const photos = Object.fromEntries((await db.all('photos')).filter(x => x.data).map(x => [x.id, x.data]));
  return productsTab(body, products, locs, contacts, photos);
}

/* ---------- Produits ---------- */
function productsTab(body, products, locs, contacts, photos = {}) {
  const L = Object.fromEntries(locs.map(l => [l.id, l]));
  products.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  body.innerHTML = `<div class="row">
    <input class="search" id="q" type="search" placeholder="Rechercher (nom, réf., code-barres…)">
    <button class="btn primary" id="scanb">▦ Scanner</button>
    <button class="btn" id="add">+ Produit</button>
    <button class="btn" id="imp">Importer</button></div>
    <div class="row"><button class="btn primary" id="recv">📦 Réception colis</button><button class="btn primary" id="sout">🏗 Sortie chantier</button></div>
    <label class="row"><input type="checkbox" id="low"> <span>Seulement stock bas / épuisé</span></label>
    <div id="list"></div>`;
  const list = $('#list', body);
  const draw = () => {
    const q = $('#q', body).value.toLowerCase().trim();
    const low = $('#low', body).checked;
    const rows = products.filter(p => {
      const t = total(p);
      if (low && !(t <= (p.min || 0))) return false;
      return !q || [p.name, p.ref, p.barcode, p.category].join(' ').toLowerCase().includes(q);
    });
    list.innerHTML = rows.length ? rows.map(p => {
      const t = total(p);
      const cls = t <= 0 ? 'bad' : t <= (p.min || 0) ? 'warn' : 'ok';
      const chips = Object.entries(p.stock || {}).filter(([, q]) => q).map(([k, q]) => `<span class="chip">${e(locLabel(L[k]))} : ${q}</span>`).join('');
      const th = photos[p.id] ? `<img class="pthumb" src="${photos[p.id]}" alt="">` : '<div class="pthumb ph">▦</div>';
      return `<div class="item" data-id="${p.id}">${th}<div class="main"><div class="t">${e(p.name)}</div>
        <div class="s">${[p.ref, p.barcode, p.category].filter(Boolean).map(e).join(' · ')}</div>${chips}</div>
        <div class="r"><span class="chip ${cls}">${t} ${e(p.unit || 'u')}</span><div class="s">${eur(p.sell)} HT</div></div></div>`;
    }).join('') : '<div class="empty">Aucun produit. Ajoutez-en un ou importez vos listes Excel.</div>';
  };
  draw();
  $('#q', body).oninput = draw; $('#low', body).onchange = draw;
  list.onclick = ev => { const it = ev.target.closest('.item'); if (it) productModal(products.find(p => p.id === it.dataset.id), locs, contacts, products); };
  $('#add', body).onclick = () => productModal(null, locs, contacts, products);
  $('#imp', body).onclick = () => importModal(products);
  $('#scanb', body).onclick = lookupScan;
  $('#recv', body).onclick = () => receptionModal(products, locs);
  $('#sout', body).onclick = () => siteOutModal(products, locs);
}

export function productModal(p, locs, contacts, products, preset = {}) {
  const isNew = !p;
  p = p || { stock: {}, tva: 10, unit: 'u', ...preset };
  const L = Object.fromEntries(locs.map(l => [l.id, l]));
  const suppliers = [['', '—'], ...contacts.filter(c => c.kind === 'supplier').map(c => [c.id, c.name])];
  const stockHtml = isNew
    ? `<div class="cols">${F('Quantité initiale', 'initQty', '', { type: 'number', step: 'any' })}${F('Emplacement', 'initLoc', locs[0]?.id, { type: 'select', options: locs.map(l => [l.id, locLabel(l)]) })}</div>`
    : `<h3>Stock par emplacement</h3>${Object.entries(p.stock || {}).filter(([, q]) => q).map(([k, q]) => `<span class="chip">${e(locLabel(L[k]))} : <b>${q}</b></span>`).join('') || '<span class="muted">Aucun stock</span>'}
       <div class="row" style="margin-top:8px"><button type="button" class="btn sm" data-mv="in">+ Entrée</button><button type="button" class="btn sm" data-mv="out">− Sortie</button><button type="button" class="btn sm" data-mv="transfer">⇄ Transfert</button><button type="button" class="btn sm" data-mv="adjust">Inventaire</button></div>`;
  const body = `<div class="cols">
    ${F('Désignation', 'name', p.name, { req: true, cls: 'full' })}
    ${F('Référence', 'ref', p.ref)}
    <div><label class="f"><span>Code-barres</span><div style="display:flex;gap:6px"><input name="barcode" value="${e(p.barcode)}" inputmode="text"><button type="button" class="btn" data-scan>▦</button></div></label></div>
    ${F('Catégorie', 'category', p.category)}
    ${F('Unité', 'unit', p.unit || 'u', { type: 'select', options: UNITS.map(u => [u, u]) })}
    ${F('Prix d\'achat HT', 'buy', p.buy ?? '', { type: 'number', step: '0.01' })}
    ${F('Prix de vente HT', 'sell', p.sell ?? '', { type: 'number', step: '0.01' })}
    ${F('TVA', 'tva', p.tva ?? 10, { type: 'select', options: TVAS })}
    ${F('Seuil d\'alerte stock', 'min', p.min ?? '', { type: 'number', step: 'any' })}
    ${F('Fournisseur', 'supplierId', p.supplierId || '', { type: 'select', options: suppliers, cls: 'full' })}
    ${F('Note', 'note', p.note, { type: 'textarea', rows: 2, cls: 'full' })}
    <div class="full" style="margin-bottom:10px"><span class="muted" style="font-size:12px">Photo (compressée automatiquement)</span>
      <div class="row" style="margin-top:4px"><div id="pbox" class="pthumb big ph">▦</div>
        <label class="btn"><input type="file" id="pfile" accept="image/*" hidden>📷 Photo</label><button type="button" class="btn" id="pdel" hidden>Retirer</button></div>
      <small id="pinfo" class="muted"></small></div>
  </div>${stockHtml}`;
  let newPhoto; // undefined = inchangée, '' = retirée, texte = nouvelle photo
  modal(isNew ? 'Nouveau produit' : 'Produit', body, async o => {
    const dup = o.barcode && products.find(x => x.barcode === o.barcode && x.id !== p.id);
    if (dup) throw new Error(`Ce code-barres est déjà utilisé par « ${dup.name} ».`);
    Object.assign(p, { name: o.name.trim(), ref: o.ref, barcode: o.barcode.trim(), category: o.category, unit: o.unit, buy: num(o.buy), sell: num(o.sell), tva: num(o.tva), min: num(o.min), supplierId: o.supplierId, note: o.note });
    const saved = await db.put('products', p);
    if (newPhoto !== undefined) {
      const v = Date.now();
      await db.put('photos', { id: saved.id, data: newPhoto, v });
      saved.photoV = v; await db.put('products', saved); markPhotosDirty();
    }
    if (isNew && num(o.initQty) > 0) await recordMove(saved, { type: 'in', to: o.initLoc, qty: num(o.initQty), note: 'Stock initial' });
    refresh();
  }, {
    del: isNew ? null : async () => { await db.del('products', p.id); refresh(); },
    onOpen: f => {
      const showPhoto = data => {
        const box = $('#pbox', f);
        if (data) { box.className = 'pthumb big'; box.innerHTML = `<img src="${data}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`; }
        else { box.className = 'pthumb big ph'; box.textContent = '▦'; }
        $('#pdel', f).hidden = !data;
      };
      if (!isNew) db.get('photos', p.id).then(r => { if (r?.data && newPhoto === undefined) { showPhoto(r.data); $('#pinfo', f).textContent = `${Math.round(r.data.length * 0.75 / 1024)} Ko`; } });
      $('#pfile', f).onchange = async ev => {
        const file = ev.target.files[0]; if (!file) return;
        try {
          const data = await compressImage(file, { mode: 'photo', maxChars: 30000 });
          if (data.length > 45000) throw new Error('Photo trop détaillée : essayez une autre prise de vue.');
          newPhoto = data; showPhoto(data);
          $('#pinfo', f).textContent = `${Math.round(file.size / 1024)} Ko → ${Math.round(data.length * 0.75 / 1024)} Ko après compression`;
        } catch (err) { alert(err.message); }
      };
      $('#pdel', f).onclick = () => { newPhoto = ''; showPhoto(''); $('#pinfo', f).textContent = 'Photo retirée à l\'enregistrement'; };
      f.querySelector('[data-scan]').onclick = () => scan(c => { f.elements.barcode.value = c; });
      f.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { closeModal(); moveModal(products, locs, { product: p.id, type: b.dataset.mv }); });
    }
  });
}

/* ---------- Scan / recherche ---------- */
export function lookupScan() {
  return new Promise(async resolve => {
    const [products, locs, contacts] = await Promise.all([db.all('products'), db.all('locations'), db.all('contacts')]);
    scan(code => {
      const p = products.find(x => x.barcode === code || x.ref === code);
      if (p) productModal(p, locs, contacts, products);
      else if (confirm(`Code ${code} inconnu. Créer un produit ?`)) productModal(null, locs, contacts, products, { barcode: code });
      resolve();
    });
    setTimeout(resolve, 0);
  });
}

// Sélecteur de produit (recherche + scan) utilisé par les devis/factures
export async function pickProduct(cb) {
  const products = (await db.all('products')).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const photos = Object.fromEntries((await db.all('photos')).filter(x => x.data).map(x => [x.id, x.data]));
  const body = `<div class="row"><input class="search" id="pq" type="search" placeholder="Rechercher un produit…"><button type="button" class="btn" id="ps">▦</button></div><div id="pl"></div>`;
  modal('Ajouter un produit', body, null, {
    onOpen: f => {
      const draw = () => {
        const q = $('#pq', f).value.toLowerCase();
        const rows = products.filter(p => !q || [p.name, p.ref, p.barcode].join(' ').toLowerCase().includes(q)).slice(0, 60);
        $('#pl', f).innerHTML = rows.map(p => `<div class="item" data-id="${p.id}">${photos[p.id] ? `<img class="pthumb" src="${photos[p.id]}" alt="">` : '<div class="pthumb ph">▦</div>'}<div class="main"><div class="t">${e(p.name)}</div><div class="s">${e(p.ref || '')} · stock ${total(p)} ${e(p.unit)}</div></div><div class="r">${eur(p.sell)}</div></div>`).join('') || '<div class="empty">Aucun résultat</div>';
      };
      draw();
      $('#pq', f).oninput = draw;
      $('#pl', f).onclick = ev => { const it = ev.target.closest('.item'); if (it) { closeModal(); cb(products.find(p => p.id === it.dataset.id)); } };
      $('#ps', f).onclick = () => scan(c => { const p = products.find(x => x.barcode === c || x.ref === c); if (p) { closeModal(); cb(p); } else toast('Code inconnu'); });
    }
  });
}

/* ---------- Mouvements ---------- */
export async function moveModal(products, locs, preset = {}) {
  const sites = (await db.all('sites')).filter(s => !['paid', 'lost'].includes(s.status)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const lopt = locs.map(l => [l.id, locLabel(l)]);
  const popt = products.sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(p => [p.id, `${p.name}${p.ref ? ' (' + p.ref + ')' : ''}`]);
  if (!popt.length) return alert('Créez d\'abord un produit.');
  const body = `<label class="f"><span>Produit</span><div style="display:flex;gap:6px"><select name="productId">${popt.map(([v, l]) => `<option value="${v}" ${v === preset.product ? 'selected' : ''}>${e(l)}</option>`).join('')}</select><button type="button" class="btn" data-scan>▦</button></div></label>
  ${F('Type', 'type', preset.type || 'in', { type: 'select', options: [['in', 'Entrée (réception)'], ['out', 'Sortie'], ['transfer', 'Transfert entre emplacements'], ['adjust', 'Inventaire (fixer la quantité)']] })}
  ${F('Quantité', 'qty', '', { type: 'number', step: 'any', req: true })}
  <div id="fromw">${F('Depuis', 'from', locs[0]?.id, { type: 'select', options: lopt })}</div>
  <div id="tow">${F('Vers', 'to', locs[0]?.id, { type: 'select', options: lopt })}</div>
  <div id="unitw">${F('Prix d\'achat unitaire HT (€) – pour les achats et la TVA déductible', 'unit', '', { type: 'number', step: '0.01' })}</div>
  <div id="sitew"><label class="f"><span>Chantier concerné (facultatif – pour la rentabilité)</span><select name="siteId"><option value="">— aucun —</option>${sites.map(s => `<option value="${s.id}">${e(s.name)}</option>`).join('')}</select></label></div>
  ${F('Note / n° bon de livraison', 'note', '')}`;
  modal('Mouvement de stock', body, async o => {
    const p = products.find(x => x.id === o.productId);
    const qty = num(o.qty);
    if (o.type !== 'adjust' && qty <= 0) throw new Error('Quantité invalide');
    if (o.type === 'transfer' && o.from === o.to) throw new Error('Emplacements identiques');
    if ((o.type === 'out' || o.type === 'transfer') && (p.stock?.[o.from] || 0) < qty) throw new Error(`Stock insuffisant à cet emplacement (${p.stock?.[o.from] || 0}).`);
    const mv = { type: o.type, qty, from: o.from, to: o.to, note: o.note };
    if (o.type === 'in') Object.assign(mv, { purchase: true, unit: o.unit === '' ? num(p.buy) : num(o.unit) }); // réception = achat
    if (o.type === 'out') Object.assign(mv, { unit: num(p.buy), siteId: o.siteId || '' });
    await recordMove(p, mv);
    toast('Mouvement enregistré'); refresh();
  }, {
    onOpen: f => {
      const upd = () => { const t = f.elements.type.value; $('#fromw', f).hidden = !(t === 'out' || t === 'transfer'); $('#tow', f).hidden = !(t === 'in' || t === 'transfer' || t === 'adjust'); $('#unitw', f).hidden = t !== 'in'; $('#sitew', f).hidden = t !== 'out'; };
      f.elements.type.onchange = upd; upd();
      $('[data-scan]', f).onclick = () => scan(c => { const p = products.find(x => x.barcode === c || x.ref === c); if (p) f.elements.productId.value = p.id; else toast('Code inconnu'); });
    }
  });
}

async function movesTab(body, products, locs) {
  const SN = Object.fromEntries((await db.all('sites')).map(x => [x.id, x.name]));
  const P = Object.fromEntries(products.map(p => [p.id, p]));
  const L = Object.fromEntries(locs.map(l => [l.id, l]));
  const moves = (await db.all('moves')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150);
  const lbl = { in: 'Entrée', out: 'Sortie', transfer: 'Transfert', adjust: 'Inventaire' };
  body.innerHTML = `<div class="row"><button class="btn primary" id="recv">📦 Réception colis</button><button class="btn primary" id="sout">🏗 Sortie chantier</button><button class="btn" id="nm">+ Mouvement</button></div>` +
    (moves.map(m => `<div class="item" style="cursor:default"><div class="main"><div class="t">${e(P[m.productId]?.name || '(produit supprimé)')}</div>
      <div class="s">${dateFr(m.date)} · ${lbl[m.type]} ${m.type === 'transfer' ? e(locLabel(L[m.from])) + ' → ' + e(locLabel(L[m.to])) : e(locLabel(L[m.to || m.from]))}${m.siteId && SN[m.siteId] ? ' · chantier ' + e(SN[m.siteId]) : ''}${m.note ? ' · ' + e(m.note) : ''}</div></div>
      <div class="r"><span class="chip ${m.type === 'out' ? 'warn' : 'ok'}">${m.type === 'out' ? '−' : m.type === 'in' ? '+' : ''}${m.qty}</span></div></div>`).join('') || '<div class="empty">Aucun mouvement.</div>');
  $('#nm', body).onclick = () => moveModal(products, locs);
  $('#recv', body).onclick = () => receptionModal(products, locs);
  $('#sout', body).onclick = () => siteOutModal(products, locs);
}

/* ---------- Emplacements ---------- */
function locationsTab(body, products, locs) {
  const zones = {};
  locs.forEach(l => (zones[l.zone] = zones[l.zone] || []).push(l));
  body.innerHTML = `<div class="row"><button class="btn primary" id="nl">+ Emplacement</button><span class="muted">Zone (ex. Atelier, Dépôt, Camion) › lieu précis (ex. Rack A, Étagère 3)</span></div>` +
    Object.keys(zones).sort().map(z => `<h3>${e(z)}</h3>` + zones[z].sort((a, b) => a.place.localeCompare(b.place, 'fr')).map(l => {
      const inside = products.filter(p => (p.stock?.[l.id] || 0) > 0);
      return `<div class="item" data-id="${l.id}"><div class="main"><div class="t">${e(l.place)}</div><div class="s">${e(l.note || '')}</div>${inside.slice(0, 6).map(p => `<span class="chip">${e(p.name)} : ${p.stock[l.id]}</span>`).join('')}${inside.length > 6 ? `<span class="muted"> +${inside.length - 6}</span>` : ''}</div><div class="r muted">${inside.length} réf.</div></div>`;
    }).join('')).join('') || '<div class="empty">Aucun emplacement.</div>';
  const edit = l => {
    const isNew = !l; l = l || {};
    modal(isNew ? 'Nouvel emplacement' : 'Emplacement', F('Zone', 'zone', l.zone, { req: true, ph: 'Atelier, Dépôt, Camion…' }) + F('Lieu précis', 'place', l.place, { req: true, ph: 'Rack A – étagère 2' }) + F('Note', 'note', l.note),
      async o => { Object.assign(l, o); await db.put('locations', l); refresh(); },
      { del: isNew ? null : async () => {
        if (products.some(p => (p.stock?.[l.id] || 0) > 0)) return alert('Cet emplacement contient du stock : transférez-le d\'abord.');
        await db.del('locations', l.id); refresh(); } });
  };
  $('#nl', body).onclick = () => edit();
  body.onclick = ev => { const it = ev.target.closest('.item'); if (it) edit(locs.find(l => l.id === it.dataset.id)); };
}

/* ---------- Import Excel / CSV ---------- */
function parseCSV(text) {
  const delim = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const FIELDS = [
  ['name', 'Désignation', /d[ée]signation|libell[ée]|produit|article|nom/i],
  ['ref', 'Référence', /r[ée]f/i],
  ['barcode', 'Code-barres', /code.?barre|ean|gtin/i],
  ['unit', 'Unité', /unit[ée]|^u$/i],
  ['sell', 'Prix de vente HT', /prix.*(unit|h\.?t|vente)|p\.?u/i],
  ['buy', 'Prix d\'achat HT', /achat/i],
  ['category', 'Catégorie', /cat[ée]gorie|famille/i],
  ['qty', 'Quantité en stock', /stock|quantit|qt[ée]/i]
];

export function importModal(products) {
  const body = `<p class="muted">Choisissez un fichier .csv ou .xlsx (par ex. une liste de vos factures Excel). Les désignations identiques sont fusionnées : le dernier prix rencontré est conservé. Aucune donnée n'est envoyée sur Internet (le lecteur Excel se charge une fois depuis un CDN).</p>
    <label class="f"><span>Fichier</span><input type="file" id="fi" accept=".csv,.txt,.xlsx,.xls,.xlsm"></label><div id="map"></div>`;
  modal('Importer des produits', body, null, {
    wide: true,
    onOpen: f => {
      let rows = [];
      $('#fi', f).onchange = async ev => {
        const file = ev.target.files[0]; if (!file) return;
        try {
          if (/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
            await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
            const wb = XLSX.read(await readFileBuf(file));
            rows = [];
            wb.SheetNames.forEach(n => rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })));
          } else rows = parseCSV(await readFileText(file));
        } catch (err) { return alert(err.message); }
        rows = rows.filter(r => r.some(c => String(c).trim() !== ''));
        const hi = Math.max(0, rows.slice(0, 40).findIndex(r => r.some(c => /d[ée]signation|libell|produit|article/i.test(String(c)))));
        const header = rows[hi].map(String);
        const opts = '<option value="-1">— ignorer —</option>' + header.map((h, i) => `<option value="${i}">${e(h || 'Colonne ' + (i + 1))}</option>`).join('');
        $('#map', f).innerHTML = `<h3>Correspondance des colonnes</h3><div class="cols">${FIELDS.map(([k, l, re]) => {
          const idx = header.findIndex(h => re.test(h));
          return `<label class="f"><span>${l}</span><select data-k="${k}">${opts.replace(`value="${idx}"`, `value="${idx}" selected`)}</select></label>`;
        }).join('')}</div><p id="cnt" class="muted"></p><button type="button" class="btn primary" id="go">Importer</button>`;
        const build = () => {
          const m = {}; $$('[data-k]', f).forEach(s => (m[s.dataset.k] = +s.value));
          const map = new Map();
          rows.slice(hi + 1).forEach(r => {
            const name = m.name >= 0 ? String(r[m.name]).trim() : '';
            if (!name || /^(total|tva|r[èe]glement|signature)/i.test(name)) return;
            const o = { name };
            ['ref', 'barcode', 'unit', 'category'].forEach(k => { if (m[k] >= 0) o[k] = String(r[m[k]]).trim(); });
            ['sell', 'buy', 'qty'].forEach(k => { if (m[k] >= 0) o[k] = num(r[m[k]]); });
            map.set(name.toLowerCase(), o);
          });
          return [...map.values()];
        };
        const upd = () => { $('#cnt', f).textContent = `${build().length} produit(s) distinct(s) détecté(s).`; };
        $$('[data-k]', f).forEach(s => (s.onchange = upd)); upd();
        $('#go', f).onclick = async () => {
          const list = build(); const locs = await db.all('locations'); let add = 0, upd2 = 0;
          for (const o of list) {
            const ex = products.find(p => p.name.toLowerCase() === o.name.toLowerCase());
            const p = ex || { stock: {}, tva: 10, unit: 'u' };
            Object.assign(p, { name: o.name }, o.ref && { ref: o.ref }, o.barcode && { barcode: o.barcode }, o.unit && { unit: o.unit }, o.category && { category: o.category }, o.sell && { sell: o.sell }, o.buy && { buy: o.buy });
            const saved = await db.put('products', p);
            if (o.qty > 0 && !ex) await recordMove(saved, { type: 'in', to: locs[0].id, qty: o.qty, note: 'Import' });
            ex ? upd2++ : add++;
          }
          closeModal(); toast(`${add} créé(s), ${upd2} mis à jour`); refresh();
        };
      };
    }
  });
}

/* ---------- Réception de colis et sorties pour un chantier ---------- */
/* Éditeur de lignes (produit + quantité [+ prix]) avec ajout par scan */
function lineEditor(f, products, lines, { price = false } = {}) {
  const P = Object.fromEntries(products.map(p => [p.id, p]));
  const box = $('#ll', f);
  const draw = () => {
    box.innerHTML = lines.map((l, i) => `<div class="row ll" data-i="${i}" style="margin-bottom:6px">
      <select data-k="pid" style="flex:3;min-width:150px"><option value="">— produit —</option>${[...products].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(p => `<option value="${p.id}" ${p.id === l.pid ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select>
      <input data-k="qty" type="number" step="any" inputmode="decimal" value="${l.qty ?? ''}" placeholder="Qté" style="flex:1;min-width:70px">
      ${price ? `<input data-k="price" type="number" step="0.01" inputmode="decimal" value="${l.price ?? ''}" placeholder="Prix HT" style="flex:1;min-width:80px">` : ''}
      <button type="button" class="btn sm" data-rm>✕</button>
      ${l.pid && P[l.pid] ? `<small class="muted" style="flex-basis:100%">${e(P[l.pid].unit || 'u')} · en stock : ${total(P[l.pid])}${l.note ? ' · ' + e(l.note) : ''}</small>` : ''}</div>`).join('') || '<p class="muted">Aucune ligne : scannez un produit ou ajoutez une ligne.</p>';
  };
  box.addEventListener('input', ev => { const r = ev.target.closest('.ll'); if (r && ev.target.dataset.k !== 'pid') lines[+r.dataset.i][ev.target.dataset.k] = ev.target.value; });
  box.addEventListener('change', ev => {
    const r = ev.target.closest('.ll'); if (!r || ev.target.dataset.k !== 'pid') return;
    const l = lines[+r.dataset.i]; l.pid = ev.target.value; if (price && P[l.pid]) l.price = P[l.pid].buy ?? ''; draw();
  });
  box.addEventListener('click', ev => { const b = ev.target.closest('[data-rm]'); if (b) { lines.splice(+b.closest('.ll').dataset.i, 1); draw(); } });
  const add = (p, qty = 1) => {
    const ex = lines.find(l => l.pid === p.id);
    if (ex) ex.qty = num(ex.qty) + qty; else lines.push({ pid: p.id, qty, price: price ? (p.buy ?? '') : undefined });
    draw();
  };
  $('[data-addl]', f).onclick = () => { lines.push({ pid: '', qty: '', price: price ? '' : undefined }); draw(); };
  $('[data-scanl]', f).onclick = () => scan(c => { const p = products.find(x => x.barcode === c || x.ref === c); if (p) { add(p); toast(`${p.name} ajouté`); } else toast('Code inconnu'); });
  draw();
  return { draw, add };
}

export async function receptionModal(products, locs) {
  if (!products.length) return alert('Créez d\'abord des produits (ou importez-les).');
  const lines = [];
  const lopt = locs.map(l => [l.id, locLabel(l)]);
  modal('📦 Réception de colis',
    `<div class="cols">${F('Fournisseur / n° de bon de livraison', 'bl', '', { cls: 'full', ph: 'ex : Point P – BL 45872' })}
    ${F('Ranger dans', 'to', locs[0]?.id, { type: 'select', options: lopt, cls: 'full' })}</div>
    <div class="row"><button type="button" class="btn primary" data-scanl>▦ Scanner un produit</button><button type="button" class="btn" data-addl>+ Ligne</button></div>
    <div id="ll"></div>
    <p class="muted">Le prix d'achat est repris du produit ; modifiez-le s'il a changé (il sert aux achats et à la TVA déductible).</p>`,
    async o => {
      const ok = lines.filter(l => l.pid && num(l.qty) > 0);
      if (!ok.length) { alert('Ajoutez au moins une ligne avec une quantité.'); return false; }
      for (const l of ok) {
        const p = products.find(x => x.id === l.pid);
        await recordMove(p, { type: 'in', to: o.to, qty: num(l.qty), note: o.bl ? `Colis ${o.bl}` : 'Réception colis', purchase: true, unit: l.price === '' || l.price === undefined ? num(p.buy) : num(l.price) });
      }
      toast(`${ok.length} produit(s) reçu(s)`); refresh();
    }, { wide: true, submitLabel: 'Valider la réception', onOpen: f => lineEditor(f, products, lines, { price: true }) });
}

export async function siteOutModal(products, locs, preset = {}) {
  const sites = (await db.all('sites')).filter(s => !['paid', 'lost'].includes(s.status)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (!sites.length) { toast('Créez d\'abord un chantier'); return go('#/sites'); }
  if (!products.length) return alert('Aucun produit en stock.');
  const [docs, moves] = await Promise.all([db.all('documents'), db.all('moves')]);
  const lines = [];
  modal('🏗 Sortie pour un chantier',
    `<div class="cols"><label class="f full"><span>Chantier</span><select name="siteId">${sites.map(s => `<option value="${s.id}" ${s.id === preset.siteId ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select></label>
    ${F('Note (facultatif)', 'note', '', { cls: 'full', ph: 'ex : pour la pose de la terrasse' })}</div>
    <div class="row"><button type="button" class="btn primary" data-scanl>▦ Scanner un produit</button><button type="button" class="btn" data-addl>+ Ligne</button><button type="button" class="btn" id="needs">Reprendre les besoins du devis</button></div>
    <div id="ll"></div>
    <p class="muted">La sortie est prélevée automatiquement sur les emplacements les mieux fournis.</p>`,
    async (o, f) => {
      const ok = lines.filter(l => l.pid && num(l.qty) > 0);
      if (!ok.length) { alert('Ajoutez au moins une ligne avec une quantité.'); return false; }
      const need = {}; ok.forEach(l => (need[l.pid] = (need[l.pid] || 0) + num(l.qty)));
      for (const [pid, q] of Object.entries(need)) {
        const p = products.find(x => x.id === pid);
        if (total(p) < q - 1e-9) { alert(`Stock insuffisant pour « ${p.name} » : ${total(p)} en stock, ${q} demandé(s).`); return false; }
      }
      const sname = sites.find(s => s.id === o.siteId)?.name || '';
      let n = 0;
      for (const l of ok) {
        const p = products.find(x => x.id === l.pid); let rest = num(l.qty);
        for (const [lid, q] of Object.entries(p.stock || {}).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1])) {
          if (rest <= 1e-9) break;
          const take = Math.min(q, rest);
          await recordMove(p, { type: 'out', from: lid, qty: take, unit: num(p.buy), siteId: o.siteId, note: o.note || `Chantier ${sname}` }); rest -= take; n++;
        }
      }
      toast(`${ok.length} produit(s) sorti(s) pour ${sname}`); refresh();
    }, {
      wide: true, submitLabel: 'Valider la sortie',
      onOpen: f => {
        const ed = lineEditor(f, products, lines);
        // besoins = lignes (liées au stock) des devis acceptés / facturés du chantier, moins ce qui est déjà sorti
        $('#needs', f).onclick = () => {
          const sid = f.elements.siteId.value, want = {};
          docs.filter(d => d.type === 'quote' && d.siteId === sid && ['accepted', 'invoiced'].includes(d.status)).forEach(d => d.lines.forEach(l => { if (l.pid) want[l.pid] = (want[l.pid] || 0) + num(l.qty); }));
          moves.filter(m => m.siteId === sid && m.type === 'out').forEach(m => { if (want[m.productId] !== undefined) want[m.productId] -= num(m.qty); });
          let n = 0;
          for (const [pid, q] of Object.entries(want)) {
            const p = products.find(x => x.id === pid);
            if (p && q > 1e-9 && !lines.some(l => l.pid === pid)) { lines.push({ pid, qty: q, note: 'selon devis' }); n++; }
          }
          ed.draw(); toast(n ? `${n} besoin(s) repris du devis` : 'Aucun besoin restant (ou devis sans produit du stock)');
        };
      }
    });
}
