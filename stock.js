// Stock : produits, code-barres, zones / emplacements, mouvements, import Excel/CSV.
import * as db from './db.js';
import { e, eur, num, dateFr, today, F, filterBar, bindFilters, modal, closeModal, toast, scan, tabs, refresh, go, loadScript, readFileText, readFileBuf, compressImage, $, $$ } from './util.js';
import { markPhotosDirty } from './sheets.js';
import { buyRate } from './vat.js';
import { getS } from './defaults.js';
import { OUV_CAT, hasCompo, priceOf } from './ouvrage.js';
import { compoHtml, bindCompo } from './ouvrage-ui.js';
import { avgBuy, deltaPct, isHike, fmtDelta } from './pricing.js';
import { isStocked, isService, reservations, shortages } from './plan.js';
import { labelsModal } from './labels.js';
import { internalCode } from './barcode.js';
import { UNITS, CATS, CAT_NAMES, catIcon, unitOpts, catOpts as catPick } from './lists.js';
import { LIM } from './limits.js';
import { alertBox, confirmBox } from './dialogs.js';
import { pickify } from './picker.js';

export const total = p => Object.values(p.stock || {}).reduce((a, b) => a + b, 0);
export const locLabel = l => (l ? `${l.zone} › ${l.place}` : '—');
const TVAS = [['0', '0 %'], ['5.5', '5,5 %'], ['10', '10 %'], ['20', '20 %']];
/* Unités et catégories de produits (fiche produit, menu « + Produit » des devis / factures) : listes modifiables dans Réglages › Listes de choix (lists.js) */
export { UNITS, CATS, CAT_NAMES, catIcon };

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
  if (m.type === 'in' && m.purchase && num(m.unit) > 0 && !m.keepBuy) { // A8 : chaque achat remet à jour le prix d'achat de la fiche (prix moyen pondéré du stock en place et de la quantité reçue)
    const nb = avgBuy(total(p), p.buy, m.qty, m.unit);
    if (nb !== num(p.buy)) { m.buyBefore = num(p.buy); m.buyAfter = nb; p.buy = nb; }
  }
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
  el.innerHTML = `<h2>Stock</h2>${tabs('#/stock', [['products', 'Produits'], ['orders', 'Commandes'], ['locations', 'Emplacements'], ['moves', 'Mouvements']], tab)}<div id="tb"></div>`;
  const body = $('#tb', el);
  const [products, locs, contacts] = await Promise.all([db.all('products'), db.all('locations'), db.all('contacts')]);
  if (tab === 'orders') return (await import('./orders-ui.js')).ordersTab(body, products, locs, contacts);
  if (tab === 'locations') return locationsTab(body, products, locs);
  if (tab === 'moves') return movesTab(body, products, locs);
  const photos = Object.fromEntries((await db.all('photos')).filter(x => x.data).map(x => [x.id, x.data]));
  const [members, S, docs, sites, moves] = await Promise.all([db.all('members'), getS(), db.all('documents'), db.all('sites'), db.all('moves')]);
  const PM = new Map(products.map(p => [p.id, p]));
  return productsTab(body, products, locs, contacts, photos, { products: PM, members: new Map(members.map(m => [m.id, m])) }, S, reservations(sites, docs, moves, PM));
}

/* ---------- Produits ---------- */
function productsTab(body, products, locs, contacts, photos = {}, ouvCtx = {}, ouvS = {}, resv = new Map()) {
  const L = Object.fromEntries(locs.map(l => [l.id, l]));
  products.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const FC = [{ id: 'sort', label: 'Trier par', def: 'name', options: [['name', 'Nom A→Z'], ['stockA', 'Stock ↑ (le plus bas)'], ['stockD', 'Stock ↓'], ['cat', 'Catégorie'], ['priceD', 'Prix de vente ↓'], ['valueD', 'Valeur du stock ↓'], ['recent', 'Plus récents']] },
    { id: 'cat', label: 'Catégorie', options: [['', 'Toutes'], ...cats.map(c => [c, c])] }, { id: 'loc', label: 'Emplacement', options: [['', 'Tous'], ...locs.map(l => [l.id, locLabel(l)])] },
    { id: 'kind', label: 'Type', options: [['', 'Tous'], ['sale', 'Vendus'], ['internal', 'Usage interne']] }, { id: 'low', type: 'check', label: 'Stock bas / épuisé' }, { id: 'short', type: 'check', label: 'Matériel manquant (devis signés)' }];
  const shortIds = new Set(shortages(resv, ouvCtx.products || new Map(), total).map(x => x.p.id)); // M9 : stock inférieur à ce que les devis signés réservent
  const SORTS = { name: (a, b) => a.name.localeCompare(b.name, 'fr'), stockA: (a, b) => total(a) - total(b), stockD: (a, b) => total(b) - total(a), cat: (a, b) => (a.category || '~').localeCompare(b.category || '~', 'fr') || a.name.localeCompare(b.name, 'fr'),
    priceD: (a, b) => num(b.sell) - num(a.sell), valueD: (a, b) => total(b) * num(b.buy) - total(a) * num(a.buy), recent: (a, b) => (b._u || 0) - (a._u || 0) };
  let getF;
  body.innerHTML = `<div class="row">
    <input class="search" id="q" type="search" placeholder="Rechercher (nom, réf., code-barres…)">
    <button class="btn primary" id="scanb">▦ Scanner</button>
    <button class="btn" id="add">+ Produit</button>
    <button class="btn" id="imp">Importer</button>
    <button class="btn" id="clf" title="Ranger les produits existants dans les catégories des devis">🏷 Classer${toClassify(products) ? ` (${toClassify(products)})` : ''}</button>
    <button class="btn" id="lblb" title="Imprimer des étiquettes code-barres sur une planche d'étiquettes autocollantes">🖨 Étiquettes</button></div>
    <div class="row"><button class="btn primary" id="recv">📦 Réception colis</button><button class="btn primary" id="sout">🏗 Sortie chantier</button><button class="btn" id="spdf" title="Facture, bon de livraison, bon de commande, devis d'un fournisseur (PDF), ou facture électronique Factur-X / UBL">📄 Document fournisseur (PDF / Factur-X)</button></div>
    ${filterBar(FC)}
    <div id="list"></div>`;
  const list = $('#list', body);
  const draw = () => {
    const q = $('#q', body).value.toLowerCase().trim();
    const F2 = getF ? getF() : {};
    const rows = products.filter(p => {
      const t = total(p);
      if (F2.low && (!isStocked(p) || !(t <= (p.min || 0)))) return false;
      if (F2.short && !shortIds.has(p.id)) return false;
      if (F2.kind === 'internal' && p.kind !== 'internal') return false; if (F2.kind === 'sale' && p.kind === 'internal') return false;
      if (F2.cat && p.category !== F2.cat) return false; if (F2.loc && !(p.stock && p.stock[F2.loc] > 0)) return false;
      return !q || [p.name, p.ref, p.barcode, p.category].join(' ').toLowerCase().includes(q);
    }).sort(SORTS[F2.sort] || SORTS.name);
    list.innerHTML = rows.length ? rows.map(p => {
      const t = total(p);
      const cls = t <= 0 ? 'bad' : t <= (p.min || 0) ? 'warn' : 'ok';
      const chips = Object.entries(p.stock || {}).filter(([, q]) => q).map(([k, q]) => `<span class="chip">${e(locLabel(L[k]))} : ${q}</span>`).join('');
      const th = photos[p.id] ? `<img class="pthumb" src="${photos[p.id]}" alt="">` : '<div class="pthumb ph">▦</div>';
      const ouv = hasCompo(p) ? priceOf(p, ouvCtx, ouvS) : null; // ouvrage composé : prix recalculés d'après le catalogue et l'équipe
      const rs = resv.get(p.id), av = rs ? Math.round((t - rs.reserved) * 1000) / 1000 : 0, svc = isService(p); // service (main d'œuvre, sous-traitance) : ni stock ni « 0 h » (B5)
      return `<div class="item" data-id="${p.id}">${th}<div class="main"><div class="t">${e(p.name)}${p.kind === 'internal' ? ' <span class="chip">usage interne</span>' : ''}</div>
        <div class="s">${[p.ref, p.barcode, p.category].filter(Boolean).map(e).join(' · ')}${ouv ? ` · ${p.compo.length} composant(s) · revient ${eur(ouv.cost)}` : ''}</div>${ouv || svc ? '' : chips}${rs ? `<div class="s resv">réservé par les devis signés : <b>${rs.reserved} ${e(p.unit || 'u')}</b> (${rs.sites.slice(0, 3).map(x => e(x.name)).join(', ')}${rs.sites.length > 3 ? '…' : ''}) · disponible <b class="${av < 0 ? 'neg' : ''}">${av}</b></div>` : ''}</div>
        <div class="r">${p.category === OUV_CAT ? `<span class="chip">ouvrage${ouv && ouv.warns ? ' ⚠' : ''}</span>` : svc ? '<span class="chip">service</span>' : `<span class="chip ${cls}">${t} ${e(p.unit || 'u')}</span>${rs && av < 0 ? `<span class="chip bad" title="Le stock ne couvre pas ce que les devis signés réservent">manque ${Math.round(-av * 1000) / 1000}</span>` : ''}`}<div class="s">${p.kind === 'internal' ? 'non vendu' : eur(ouv ? ouv.sell : p.sell) + ' HT'}</div></div></div>`;
    }).join('') : '<div class="empty">Aucun produit. Ajoutez-en un ou importez vos listes Excel.</div>';
  };
  getF = bindFilters(body, 'stock_', FC, draw);
  draw();
  $('#q', body).oninput = draw;
  list.onclick = ev => { const it = ev.target.closest('.item'); if (it) import('./lock.js').then(L => L.withLock(it.dataset.id, () => productModal(products.find(p => p.id === it.dataset.id), locs, contacts, products))); };
  $('#add', body).onclick = () => productModal(null, locs, contacts, products);
  $('#imp', body).onclick = () => importModal(products);
  $('#clf', body).onclick = () => classifyModal(products);
  $('#lblb', body).onclick = () => labelsModal(products.filter(isStocked));
  $('#scanb', body).onclick = lookupScan;
  $('#recv', body).onclick = () => receptionModal(products, locs);
  $('#sout', body).onclick = () => siteOutModal(products, locs);
  $('#spdf', body).onclick = () => import('./supplier-import.js').then(m => m.supplierImportModal());
}

export function productModal(p, locs, contacts, products, preset = {}, onDone = null) {
  const isNew = !p;
  p = p || { stock: {}, tva: 10, tvaBuy: 20, unit: 'u', ...preset };
  const L = Object.fromEntries(locs.map(l => [l.id, l]));
  const suppliers = [['', '—'], ...contacts.filter(c => c.kind === 'supplier').map(c => [c.id, c.name])];
  const stockHtml = isNew
    ? `<div class="cols">${F('Quantité initiale', 'initQty', '', { type: 'number', step: 'any' })}${F('Emplacement', 'initLoc', locs[0]?.id, { type: 'select', options: locs.map(l => [l.id, locLabel(l)]) })}</div>`
    : `<h3>Stock par emplacement</h3>${Object.entries(p.stock || {}).filter(([, q]) => q).map(([k, q]) => `<span class="chip">${e(locLabel(L[k]))} : <b>${q}</b></span>`).join('') || '<span class="muted">Aucun stock</span>'}
       <div class="row" style="margin-top:8px"><button type="button" class="btn sm" data-mv="in">+ Entrée</button><button type="button" class="btn sm" data-mv="out">− Sortie</button><button type="button" class="btn sm" data-mv="transfer">⇄ Transfert</button><button type="button" class="btn sm" data-mv="adjust">Inventaire</button></div>`;
  const body = `<div class="cols">
    ${F('Désignation', 'name', p.name, { req: true, cls: 'full' })}
    ${F('Référence', 'ref', p.ref)}
    <div><label class="f"><span>Code-barres</span><div style="display:flex;gap:6px"><input name="barcode" value="${e(p.barcode)}" inputmode="text"><button type="button" class="btn" data-scan title="Scanner le code avec la caméra">▦</button></div></label></div>
    <div class="full row" style="margin:-2px 0 6px"><button type="button" class="btn sm" data-gen title="Crée un code interne (EAN-13 commençant par 20), à coller sur le produit">＋ Créer un code interne</button>${isNew ? '' : '<button type="button" class="btn sm" data-lbl title="Imprimer des étiquettes code-barres de ce produit">🖨 Étiquettes</button>'}</div>
    ${F('Catégorie', 'category', p.category || '', { type: 'select', options: [['', '— aucune —'], ...catPick(p.category || '')] })}
    ${F('Type d\'article', 'kind', p.kind || 'sale', { type: 'select', options: [['sale', 'Vendu aux clients'], ['internal', 'Usage interne (non vendu : encre, papier, consommables…)']], cls: 'full' })}
    ${F('Unité', 'unit', p.unit || 'u', { type: 'select', options: unitOpts(p.unit || 'u') })}
    ${F('Prix d\'achat HT', 'buy', p.buy ?? '', { type: 'number', step: '0.01' })}
    ${F('Prix de vente HT', 'sell', p.sell ?? '', { type: 'number', step: '0.01' })}
    ${F('TVA de vente', 'tva', p.tva ?? 10, { type: 'select', options: TVAS })}
    ${F('TVA d\'achat (déductible)', 'tvaBuy', buyRate(p), { type: 'select', options: TVAS })}
    ${F('Seuil d\'alerte stock', 'min', p.min ?? '', { type: 'number', step: 'any' })}
    ${F('Fournisseur', 'supplierId', p.supplierId || '', { type: 'select', options: suppliers, cls: 'full' })}
    ${F('Note', 'note', p.note, { type: 'textarea', rows: 2, cls: 'full' })}
    ${compoHtml()}
    <div class="full" style="margin-bottom:10px"><span class="muted" style="font-size:12px">Photo (compressée automatiquement)</span>
      <div class="row" style="margin-top:4px"><div id="pbox" class="pthumb big ph">▦</div>
        <label class="btn"><input type="file" id="pfile" accept="image/*" hidden>📷 Photo</label><button type="button" class="btn" id="pdel" hidden>Retirer</button></div>
      <small id="pinfo" class="muted"></small></div>
  </div><div id="stkbox">${stockHtml}</div>`;
  let compoReady = null; // panneau « Composition » (catégorie Ouvrage) : prêt une fois les membres chargés
  let newPhoto; // undefined = inchangée, '' = retirée, texte = nouvelle photo
  modal(isNew ? 'Nouveau produit' : 'Produit', body, async o => {
    const dup = o.barcode && products.find(x => x.barcode === o.barcode && x.id !== p.id);
    if (dup) throw new Error(`Ce code-barres est déjà utilisé par « ${dup.name} ».`);
    Object.assign(p, { name: o.name.trim(), ref: o.ref, barcode: o.barcode.trim(), category: o.category, kind: o.kind || 'sale', unit: o.unit, buy: num(o.buy), sell: num(o.sell), tva: num(o.tva), tvaBuy: num(o.tvaBuy ?? 20), min: num(o.min), supplierId: o.supplierId, note: o.note });
    if (o.category === OUV_CAT && compoReady) { // ouvrage : composition, prix de revient et prix de vente calculés ; jamais en stock
      const r = (await compoReady).read();
      Object.assign(p, { compo: r.compo, priceMode: r.priceMode, buy: r.buy, sell: r.sell, kind: 'sale', min: 0 });
      if (r.coef) p.coef = r.coef; else delete p.coef;
    }
    const saved = await db.put('products', p);
    if (newPhoto !== undefined) {
      const v = Date.now();
      await db.put('photos', { id: saved.id, data: newPhoto, v });
      saved.photoV = v; await db.put('products', saved); markPhotosDirty();
    }
    if (isNew && num(o.initQty) > 0) await recordMove(saved, { type: 'in', to: o.initLoc, qty: num(o.initQty), note: 'Stock initial' });
    if (onDone) onDone(saved); else refresh();
  }, {
    del: isNew ? null : async () => { if (total(p) !== 0 && !(await confirmBox(`Ce produit a encore ${total(p)} ${p.unit || ''} en stock. Le supprimer quand même ?`))) return; await db.del('products', p.id); if (onDone) onDone(null); else refresh(); },
    onOpen: f => {
      compoReady = bindCompo(f, p, products);
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
        } catch (err) { alertBox(err.message); }
      };
      $('#pdel', f).onclick = () => { newPhoto = ''; showPhoto(''); $('#pinfo', f).textContent = 'Photo retirée à l\'enregistrement'; };
      f.querySelector('[data-scan]').onclick = () => scan(c => { f.elements.barcode.value = c; });
      f.querySelector('[data-gen]').onclick = async () => {
        const cur = f.elements.barcode.value.trim();
        if (cur && !(await confirmBox(`Remplacer le code « ${cur} » par un nouveau code interne ?`))) return;
        f.elements.barcode.value = internalCode(products.filter(x => x.id !== p.id).map(x => x.barcode));
      };
      const lb = f.querySelector('[data-lbl]');
      if (lb) lb.onclick = () => {
        if (f.elements.barcode.value.trim() !== String(p.barcode || '').trim()) return alertBox('Le code-barres a été modifié : enregistrez d\'abord le produit, puis imprimez les étiquettes.');
        closeModal(); labelsModal(products.filter(isStocked), { preset: [{ id: p.id, qty: 1 }] });
      };
      f.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { closeModal(); moveModal(products, locs, { product: p.id, type: b.dataset.mv }); });
    }
  });
}

/* ---------- Scan / recherche ---------- */
export function lookupScan() {
  return new Promise(async resolve => {
    const [products, locs, contacts] = await Promise.all([db.all('products'), db.all('locations'), db.all('contacts')]);
    scan(async code => {
      const p = products.find(x => x.barcode === code || x.ref === code);
      if (p) productModal(p, locs, contacts, products);
      else if ((await confirmBox(`Code ${code} inconnu. Créer un produit ?`))) productModal(null, locs, contacts, products, { barcode: code });
      resolve();
    });
    setTimeout(resolve, 0);
  });
}

// Sélecteur de produit (recherche + scan) utilisé par les devis/factures
export async function pickProduct(cb, { sale = false } = {}) {
  const products = (await db.all('products')).filter(p => !sale || p.kind !== 'internal').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
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
  const popt = products.filter(p => isStocked(p) || p.id === preset.product).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(p => [p.id, `${p.name}${p.ref ? ' (' + p.ref + ')' : ''}`]);
  if (!popt.length) return alertBox('Créez d\'abord un produit.');
  const body = `<label class="f"><span>Produit</span><select name="productId"><option value="">— choisir un produit —</option>${popt.map(([v, l]) => `<option value="${v}" data-q="${e(products.find(x => x.id === v)?.barcode || '')}" ${v === preset.product ? 'selected' : ''}>${e(l)}</option>`).join('')}</select></label>
  ${F('Type', 'type', preset.type || 'in', { type: 'select', options: [['in', 'Entrée (réception)'], ['out', 'Sortie'], ['transfer', 'Transfert entre emplacements'], ['adjust', 'Inventaire (fixer la quantité)']] })}
  ${F('Quantité', 'qty', '', { type: 'number', step: 'any', req: true })}
  <div id="fromw">${F('Depuis', 'from', locs[0]?.id, { type: 'select', options: lopt })}</div>
  <div id="tow">${F('Vers', 'to', locs[0]?.id, { type: 'select', options: lopt })}</div>
  <div id="unitw">${F('Prix d\'achat unitaire HT (€) – pour les achats et la TVA déductible', 'unit', '', { type: 'number', step: '0.01' })}</div>
  <div id="sitew"><label class="f"><span>Chantier concerné (facultatif – pour la rentabilité)</span><select name="siteId"><option value="">— aucun —</option>${sites.map(s => `<option value="${s.id}">${e(s.name)}</option>`).join('')}</select></label></div>
  ${F('Note / n° bon de livraison', 'note', '')}`;
  modal('Mouvement de stock', body, async o => {
    const p = products.find(x => x.id === o.productId);
    if (!p) throw new Error('Choisissez un produit dans la liste.');
    const qty = num(o.qty);
    if (o.type !== 'adjust' && qty <= 0) throw new Error('Quantité invalide');
    if (o.type === 'transfer' && o.from === o.to) throw new Error('Emplacements identiques');
    if ((o.type === 'out' || o.type === 'transfer') && (p.stock?.[o.from] || 0) < qty) throw new Error(`Stock insuffisant à cet emplacement (${p.stock?.[o.from] || 0}).`);
    const mv = { type: o.type, qty, from: o.from, to: o.to, note: o.note };
    if (o.type === 'in') Object.assign(mv, { purchase: true, unit: o.unit === '' ? num(p.buy) : num(o.unit), tva: buyRate(p) }); // réception = achat, avec la TVA d'achat de la fiche
    if (o.type === 'out') Object.assign(mv, { unit: num(p.buy), siteId: o.siteId || '' });
    const before = num(p.buy);
    await recordMove(p, mv);
    toast('Mouvement enregistré' + (mv.type === 'in' && isHike(before, mv.unit) ? ` · hausse de prix : ${p.name} ${fmtDelta(deltaPct(before, mv.unit))}` : '')); refresh();
  }, {
    onOpen: f => {
      const upd = () => { const t = f.elements.type.value; $('#fromw', f).hidden = !(t === 'out' || t === 'transfer'); $('#tow', f).hidden = !(t === 'in' || t === 'transfer' || t === 'adjust'); $('#unitw', f).hidden = t !== 'in'; $('#sitew', f).hidden = t !== 'out'; };
      f.elements.type.onchange = upd; upd();
      pickify(f.elements.siteId, { placeholder: '🔍 Rechercher un chantier…' });
      pickify(f.elements.productId, { placeholder: '🔍 Nom, réf., code-barres…', addLabel: '▦ Scanner', addTitle: 'Scanner le code-barres du produit',
        onAdd: () => scan(c => { const p = products.find(x => x.barcode === c || x.ref === c); if (p) { f.elements.productId.value = p.id; f.elements.productId.dispatchEvent(new Event('change', { bubbles: true })); } else toast('Code inconnu'); }) });
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
        if (products.some(p => (p.stock?.[l.id] || 0) > 0)) return alertBox('Cet emplacement contient du stock : transférez-le d\'abord.');
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

/* ---------- Classement des produits existants en lot ---------- */
const ascii = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const toClassify = products => products.filter(p => !CAT_NAMES.includes(p.category)).length;

export function classifyModal(products) {
  const MAX = 300;
  const list = [...products].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const byId = new Map(list.map(p => [p.id, p]));
  const checked = new Set();
  let shown = [], last = null, changed = false;
  const catOpts = (cur, none = '— aucune —') => `<option value="">${none}</option>${catPick(cur).map(([c, l]) => `<option value="${e(c)}" ${cur === c ? 'selected' : ''}>${e(l)}</option>`).join('')}`;
  const body = `<p class="muted clf-intro">Rangez vos produits existants dans les catégories des devis. Filtrez ou cherchez, cochez les lignes, choisissez la catégorie puis <b>Classer</b> — ou changez la catégorie d'une ligne directement. Chaque changement est enregistré tout de suite, et <b>Annuler</b> revient en arrière.</p>
    <div class="clf-bar"><input class="search" id="cq" type="search" placeholder="Rechercher (nom, réf., ancienne catégorie…)"><select id="cf" aria-label="Afficher"></select></div>
    <div class="clf-act"><label class="clf-all"><input type="checkbox" id="call"> <span id="calll">Tout cocher</span></label><span class="muted" id="cn"></span><span class="sp"></span>
      <select id="ct" aria-label="Catégorie à appliquer">${catOpts('', 'Classer dans…')}</select>
      <button type="button" class="btn primary" id="cgo" disabled>Classer</button><button type="button" class="btn ghost" id="cundo" hidden>↩ Annuler</button></div>
    <div class="clf-list" id="cl" aria-live="polite"></div>`;
  modal('Classer les produits', body, null, {
    wide: true,
    onOpen: (f, d) => {
      const q = $('#cq', f), sel = $('#cf', f), box = $('#cl', f), all = $('#call', f), target = $('#ct', f), goBtn = $('#cgo', f), undo = $('#cundo', f);
      const count = fn => list.filter(fn).length;
      const legacy = () => [...new Set(list.map(p => p.category).filter(c => c && !CAT_NAMES.includes(c)))].sort((a, b) => a.localeCompare(b, 'fr'));
      const filterOpts = () => {
        const cur = sel.value || 'todo';
        sel.innerHTML = `<option value="todo">À classer (${count(p => !CAT_NAMES.includes(p.category))})</option><option value="all">Tous (${list.length})</option><option value="none">Sans catégorie (${count(p => !p.category)})</option>`
          + `<optgroup label="Catégories des devis">${CAT_NAMES.map(c => `<option value="c:${e(c)}">${catIcon(c) ? catIcon(c) + ' ' : ''}${e(c)} (${count(p => p.category === c)})</option>`).join('')}</optgroup>`
          + (legacy().length ? `<optgroup label="Anciennes catégories">${legacy().map(c => `<option value="c:${e(c)}">${e(c)} (${count(p => p.category === c)})</option>`).join('')}</optgroup>` : '');
        sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'todo';
      };
      const match = () => {
        const v = sel.value, toks = ascii(q.value).split(/\s+/).filter(Boolean);
        return list.filter(p => {
          if (v === 'todo' ? CAT_NAMES.includes(p.category) : v === 'none' ? p.category : v.startsWith('c:') ? p.category !== v.slice(2) : false) return false;
          if (!toks.length) return true;
          const h = ascii([p.name, p.ref, p.barcode, p.category].join(' '));
          return toks.every(t => h.includes(t));
        });
      };
      const rowHtml = p => `<div class="clf-r${CAT_NAMES.includes(p.category) ? ' done' : ''}" data-id="${e(p.id)}">
        <label class="clf-n"><input type="checkbox" class="ck" ${checked.has(p.id) ? 'checked' : ''}><span><b>${e(p.name)}</b><small>${[p.ref, p.kind === 'internal' ? 'usage interne' : (p.sell ? eur(p.sell) + ' HT' : '')].filter(Boolean).map(e).join(' · ')}</small></span></label>
        <select class="cs" aria-label="Catégorie de ${e(p.name)}">${catOpts(p.category || '')}</select></div>`;
      const status = () => {
        const n = checked.size;
        $('#cn', f).textContent = `${shown.length} affiché${shown.length > 1 ? 's' : ''} · ${n} coché${n > 1 ? 's' : ''}`;
        all.checked = shown.length > 0 && n === shown.length;
        $('#calll', f).textContent = shown.length ? `Tout cocher (${shown.length})` : 'Tout cocher';
        goBtn.disabled = !(n && target.value);
        goBtn.textContent = n ? `Classer (${n})` : 'Classer';
      };
      const draw = () => {
        shown = match();
        checked.clear();
        const note = shown.length > MAX ? `<div class="empty">${MAX} premiers sur ${shown.length} — affinez la recherche pour voir les autres (« Tout cocher » prend bien les ${shown.length}).</div>` : '';
        box.innerHTML = shown.length
          ? shown.slice(0, MAX).map(rowHtml).join('') + note
          : `<div class="empty">${sel.value === 'todo' && !q.value.trim() && list.length ? '🎉 Tous les produits sont classés.' : 'Aucun produit ne correspond.'}</div>`;
        status();
      };
      const recount = () => { filterOpts(); status(); };
      const paintRow = p => {
        const r = [...box.querySelectorAll('.clf-r')].find(x => x.dataset.id === p.id);
        if (!r) return;
        r.classList.toggle('done', CAT_NAMES.includes(p.category));
        r.querySelector('.cs').innerHTML = catOpts(p.category || '');
      };
      const apply = async (ids, cat) => {
        const ps = ids.map(id => byId.get(id)).filter(p => p && (p.category || '') !== cat);
        if (!ps.length) return 0;
        last = ps.map(p => [p.id, p.category || '']);
        ps.forEach(p => { if (cat) p.category = cat; else delete p.category; });
        await db.putMany('products', ps);
        changed = true;
        ps.forEach(paintRow);
        undo.hidden = false; undo.textContent = `↩ Annuler (${ps.length})`;
        return ps.length;
      };
      q.oninput = draw;
      sel.onchange = draw;
      target.onchange = status;
      all.onchange = () => {
        checked.clear();
        if (all.checked) shown.forEach(p => checked.add(p.id));
        box.querySelectorAll('.ck').forEach(c => { c.checked = all.checked; });
        status();
      };
      box.onchange = async ev => {
        const r = ev.target.closest('.clf-r'); if (!r) return;
        if (ev.target.matches('.ck')) {
          ev.target.checked ? checked.add(r.dataset.id) : checked.delete(r.dataset.id);
          return status();
        }
        if (ev.target.matches('.cs')) {
          const n = await apply([r.dataset.id], ev.target.value);
          if (n) { recount(); toast('Catégorie enregistrée'); }
        }
      };
      goBtn.onclick = async () => {
        const cat = target.value, ids = [...checked];
        if (!cat || !ids.length) return;
        const n = await apply(ids, cat);
        checked.clear();
        box.querySelectorAll('.ck').forEach(c => { c.checked = false; });
        recount();
        toast(n ? `${n} produit${n > 1 ? 's' : ''} classé${n > 1 ? 's' : ''} : ${cat}` : 'Déjà dans cette catégorie');
      };
      undo.onclick = async () => {
        if (!last) return;
        const back = last; last = null;
        const ps = back.map(([id, c]) => { const p = byId.get(id); if (c) p.category = c; else delete p.category; return p; });
        await db.putMany('products', ps);
        ps.forEach(paintRow);
        undo.hidden = true;
        recount();
        toast(`${ps.length} produit${ps.length > 1 ? 's' : ''} remis comme avant`);
      };
      d.addEventListener('close', () => { if (changed) refresh(); }, { once: true });
      filterOpts();
      draw();
      q.focus();
    },
  });
}

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
        } catch (err) { return alertBox(err.message); }
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
            const p = ex || { stock: {}, tva: 10, tvaBuy: 20, unit: 'u' };
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
export function lineEditor(f, products, lines, { price = false, hint = true } = {}) {
  const P = Object.fromEntries(products.map(p => [p.id, p]));
  const box = $('#ll', f);
  /* Réception : écart avec le prix d'achat de la fiche et prix moyen qui en résulte (A8) */
  const priceHint = l => {
    const p = P[l.pid]; if (!p || l.price === '' || l.price === undefined || !(num(l.price) > 0)) return '';
    const d = deltaPct(p.buy, l.price), nb = avgBuy(total(p), p.buy, num(l.qty), l.price);
    if (!d && nb === num(p.buy)) return '';
    return `${isHike(p.buy, l.price) ? '<b style="color:var(--warn)">⚠ hausse de ' + e(fmtDelta(d)) + '</b> · ' : d ? e(fmtDelta(d)) + ' · ' : ''}prix d'achat actuel ${eur(num(p.buy))} → prix moyen après réception <b>${eur(nb)}</b>`;
  };
  const draw = () => {
    box.innerHTML = lines.map((l, i) => `<div class="row ll" data-i="${i}" style="margin-bottom:6px">
      <select data-k="pid" style="flex:3;min-width:150px"><option value="">— produit —</option>${[...products].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(p => `<option value="${p.id}" ${p.id === l.pid ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select>
      <input data-k="qty" type="number" step="any" inputmode="decimal" value="${l.qty ?? ''}" placeholder="Qté" style="flex:1;min-width:70px">
      ${price ? `<input data-k="price" type="number" step="0.01" inputmode="decimal" value="${l.price ?? ''}" placeholder="Prix HT" style="flex:1;min-width:80px">` : ''}
      <button type="button" class="btn sm" data-rm>✕</button>
      ${l.pid && P[l.pid] ? `<small class="muted" style="flex-basis:100%">${e(P[l.pid].unit || 'u')} · en stock : ${total(P[l.pid])}${l.note ? ' · ' + e(l.note) : ''}</small>` : ''}${price && hint ? `<small class="hike" data-hk style="flex-basis:100%">${priceHint(l)}</small>` : ''}</div>`).join('') || '<p class="muted">Aucune ligne : scannez un produit ou ajoutez une ligne.</p>';
  };
  box.addEventListener('input', ev => {
    const r = ev.target.closest('.ll'); if (r && ev.target.dataset.k !== 'pid') lines[+r.dataset.i][ev.target.dataset.k] = ev.target.value;
    const h = r && r.querySelector('[data-hk]'); if (h) h.innerHTML = priceHint(lines[+r.dataset.i]);
  });
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

/* opts (réception d'une commande fournisseur) : { lines: [{ pid, qty, price }] préremplies, bl: texte du bon, title, onReceived(items, bl) appelé après le rangement en stock } */
export async function receptionModal(products, locs, opts = {}) {
  products = products.filter(isStocked); // la main d'œuvre, la sous-traitance et les ouvrages ne se stockent pas
  if (!products.length) return alertBox('Créez d\'abord des produits (ou importez-les).');
  const lines = (opts.lines || []).map(l => ({ ...l }));
  const lopt = locs.map(l => [l.id, locLabel(l)]);
  modal(opts.title || '📦 Réception de colis',
    `<div class="cols">${F('Fournisseur / n° de bon de livraison', 'bl', opts.bl || '', { cls: 'full', ph: 'ex : Point P – BL 45872' })}
    ${F('Ranger dans', 'to', locs[0]?.id, { type: 'select', options: lopt, cls: 'full' })}</div>
    <div class="row"><button type="button" class="btn primary" data-scanl>▦ Scanner un produit</button><button type="button" class="btn" data-addl>+ Ligne</button></div>
    <div id="ll"></div>
    <label class="f full"><span><input type="checkbox" name="labels"> Préparer des étiquettes code-barres pour les produits reçus (choix du nombre à l'étape suivante)</span></label>
    <p class="muted">Le prix d'achat est repris du produit ; modifiez-le s'il a changé (il sert aux achats et à la TVA déductible). À la validation, le prix d'achat de la fiche passe au <b>prix moyen</b> du stock en place et de la quantité reçue ; une hausse de ${String(LIM.hikePct).replace('.', ',')} % ou plus est signalée.</p>`,
    async o => {
      const ok = lines.filter(l => l.pid && num(l.qty) > 0);
      if (!ok.length) { alertBox('Ajoutez au moins une ligne avec une quantité.'); return false; }
      const hikes = [], got = [];
      for (const l of ok) {
        const p = products.find(x => x.id === l.pid), before = num(p.buy), price = l.price === '' || l.price === undefined ? before : num(l.price);
        await recordMove(p, { type: 'in', to: o.to, qty: num(l.qty), note: o.bl ? `Colis ${o.bl}` : 'Réception colis', purchase: true, tva: buyRate(p), unit: price });
        got.push({ pid: l.pid, qty: num(l.qty), price });
        if (isHike(before, price)) hikes.push(`${p.name} ${fmtDelta(deltaPct(before, price))}`);
      }
      if (opts.onReceived) await opts.onReceived(got, o.bl); // réception d'une commande fournisseur : met à jour la commande
      toast(`${ok.length} produit(s) reçu(s)${hikes.length ? ' · hausse de prix : ' + hikes.join(', ') : ''}`); refresh();
      if (o.labels) { labelsModal((await db.all('products')).filter(isStocked), { preset: ok.map(l => ({ id: l.pid, qty: 1 })) }); return false; } // la fenêtre des étiquettes remplace celle-ci
    }, { wide: true, submitLabel: 'Valider la réception', onOpen: f => lineEditor(f, products, lines, { price: true }) });
}

export async function siteOutModal(products, locs, preset = {}) {
  products = products.filter(isStocked);
  const sites = (await db.all('sites')).filter(s => !['paid', 'lost'].includes(s.status)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (!sites.length) { toast('Créez d\'abord un chantier'); return go('#/sites'); }
  if (!products.length) return alertBox('Aucun produit en stock.');
  const [docs, moves] = await Promise.all([db.all('documents'), db.all('moves')]);
  const lines = [];
  modal('🏗 Sortie pour un chantier',
    `<div class="cols"><label class="f full"><span>Chantier</span><select name="siteId"><option value="">— choisir un chantier —</option>${sites.map(s => `<option value="${s.id}" ${s.id === preset.siteId ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select></label>
    ${F('Note (facultatif)', 'note', '', { cls: 'full', ph: 'ex : pour la pose de la terrasse' })}</div>
    <div class="row"><button type="button" class="btn primary" data-scanl>▦ Scanner un produit</button><button type="button" class="btn" data-addl>+ Ligne</button><button type="button" class="btn" id="needs">Reprendre les besoins du devis</button></div>
    <div id="ll"></div>
    <p class="muted">La sortie est prélevée automatiquement sur les emplacements les mieux fournis.</p>`,
    async (o, f) => {
      if (!o.siteId) { alertBox('Choisissez le chantier dans la liste.'); return false; }
      const ok = lines.filter(l => l.pid && num(l.qty) > 0);
      if (!ok.length) { alertBox('Ajoutez au moins une ligne avec une quantité.'); return false; }
      const need = {}; ok.forEach(l => (need[l.pid] = (need[l.pid] || 0) + num(l.qty)));
      for (const [pid, q] of Object.entries(need)) {
        const p = products.find(x => x.id === pid);
        if (total(p) < q - 1e-9) { alertBox(`Stock insuffisant pour « ${p.name} » : ${total(p)} en stock, ${q} demandé(s).`); return false; }
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
        pickify(f.elements.siteId, { placeholder: '🔍 Rechercher un chantier…' });
        const ed = lineEditor(f, products, lines);
        // besoins = lignes (liées au stock) des devis acceptés / facturés du chantier, moins ce qui est déjà sorti
        $('#needs', f).onclick = () => {
          const sid = f.elements.siteId.value, want = {};
          docs.filter(d => d.type === 'quote' && d.siteId === sid && ['accepted', 'invoiced'].includes(d.status)).forEach(d => d.lines.forEach(l => { if (l.pid && !(l.opt === true || l.opt === 1 || l.opt === '1')) want[l.pid] = (want[l.pid] || 0) + num(l.qty); }));
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
