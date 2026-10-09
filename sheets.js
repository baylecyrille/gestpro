// Synchronisation avec Google Sheets (API Sheets v4, connexion OAuth « Google Identity Services »).
// Un classeur « GestPro – Données » contient un onglet par type de données : colonnes lisibles + colonnes
// techniques (id, maj, supprime, json). Fusion enregistrement par enregistrement : le plus récent gagne.
// Le cache local (IndexedDB) reste utilisable hors ligne ; la synchro reprend dès le retour du réseau.
import * as db from './db.js';
import { getS } from './defaults.js';
import { loadScript } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const GSI = 'https://accounts.google.com/gsi/client';
const K = { photo: 'gp_photo_pending', id: 'gp_sheet_id', tok: 'gp_gtoken', exp: 'gp_gexp', last: 'gp_lastsync', url: 'gp_script_url', skey: 'gp_script_key' };
const LOCAL_ONLY = ['fbToken', 'googleClientId']; // jamais envoyés dans le classeur
const PHOTO_TAB = 'Photos';
const PHOTO_MAX = 45000; // limite d'une cellule Google Sheets : 50 000 caractères
const META = ['id', 'maj', 'supprime', 'json'];
const TOMB_DAYS = 60;

const p2 = n => String(n).padStart(2, '0');
const fdate = u => { const d = new Date(u); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
const ttc = d => { const ht = (d.lines || []).reduce((a, l) => a + (+l.qty || 0) * (+l.pu || 0), 0); return Math.round(ht * (1 + (+d.tva || 0) / 100) * 100) / 100; };
const ht = d => Math.round((d.lines || []).reduce((a, l) => a + (+l.qty || 0) * (+l.pu || 0), 0) * 100) / 100;

export const TABS = [
  { store: 'products', name: 'Produits', cols: [['Référence', r => r.ref], ['Désignation', r => r.name], ['Code-barres', r => r.barcode], ['Catégorie', r => r.category], ['Unité', r => r.unit], ['Prix achat HT', r => r.buy], ['Prix vente HT', r => r.sell], ['TVA %', r => r.tva], ['Seuil alerte', r => r.min], ['Stock total', r => sum(r.stock)]] },
  { store: 'sites', name: 'Chantiers', cols: [['Nom', r => r.name], ['Client', (r, c) => c.contacts[r.clientId]?.name], ['Adresse', r => r.address], ['Statut', r => ({ new: 'Nouveau', signed: 'Signé', progress: 'En cours', paid: 'Payé', lost: 'Perdu' })[r.status] || r.status], ['Début', r => r.start], ['Fin', r => r.end], ['Note', r => r.note]] },
  { store: 'members', name: 'Equipe', cols: [['Nom', r => r.name], ['Fonction', r => ({ gerant: 'Gérant', chef: 'Chef de chantier', ouvrier: 'Ouvrier', apprenti: 'Apprenti', soustraitant: 'Sous-traitant', autre: 'Autre' })[r.role] || r.role], ['Téléphone', r => r.phone], ['E-mail', r => r.email], ['Coût horaire', r => r.rate], ['Habilitations', r => (r.habs || []).map(h => h.label + (h.expiry ? ' (' + h.expiry + ')' : '')).join(' ; ')], ['Actif', r => (r.active === false ? 'non' : 'oui')]] },
  { store: 'tasks', name: 'Planning', cols: [['Chantier', (r, c) => c.sites[r.siteId]?.name], ['Membre', (r, c) => c.members[r.memberId]?.name], ['Du', r => r.start], ['Au', r => r.end], ['Heures/jour', r => r.hours], ['Heures prévues', r => { let n = 0; for (let d = new Date(r.start + 'T12:00'); d <= new Date((r.end || r.start) + 'T12:00'); d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (r.weekend || (w && w < 6)) n++; } return n * (+r.hours || 0); }], ['Heures réalisées', r => r.done], ['Tâche', r => r.note]] },
  { store: 'locations', name: 'Emplacements', cols: [['Zone', r => r.zone], ['Lieu', r => r.place], ['Note', r => r.note]] },
  { store: 'contacts', name: 'Contacts', cols: [['Type', r => (r.kind === 'supplier' ? 'Fournisseur' : 'Client')], ['Nom', r => r.name], ['Contact', r => r.company], ['Adresse', r => r.address], ['CP', r => r.zip], ['Ville', r => r.city], ['Téléphone', r => r.phone], ['E-mail', r => r.email], ['SIRET', r => r.siret], ['Note', r => r.note]] },
  { store: 'documents', name: 'Devis_Factures', cols: [['Type', r => (r.type === 'quote' ? 'Devis' : 'Facture')], ['Numéro', r => r.number], ['Date', r => r.date], ['Client', (r, c) => c.contacts[r.clientId]?.name], ['Réf chantier', r => r.siteRef], ['Statut', r => ({ draft: 'Brouillon', sent: r.type === 'quote' ? 'Envoyé' : 'Envoyée', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé', pending: 'En attente', issued: 'En attente', paid: 'Réglée' })[r.status] || r.status], ['Total HT', r => ht(r)], ['TVA %', r => r.tva], ['Total TTC', r => ttc(r)]] },
  { store: 'payments', name: 'Reglements', cols: [['Date', r => r.date], ['Document', (r, c) => c.documents[r.docId]?.number], ['Client', (r, c) => c.contacts[c.documents[r.docId]?.clientId]?.name], ['Montant TTC', r => r.amount], ['Mode', r => ({ especes: 'Espèces', cheque: 'Chèque', cb: 'Carte bleue', virement: 'Virement', autre: 'Autre' })[r.method] || r.method], ['N° chèque', r => r.chequeNo], ['Banque', r => r.bank], ['Nature', r => (r.kind === 'acompte' ? 'Acompte' : 'Règlement')], ['Note', r => r.note]] },
  { store: 'moves', name: 'Mouvements_stock', cols: [['Date', r => (r.date || '').slice(0, 16).replace('T', ' ')], ['Produit', (r, c) => c.products[r.productId]?.name], ['Type', r => r.type], ['Quantité', r => r.qty], ['Note', r => r.note]] },
  { store: 'fbposts', name: 'Facebook_publications', cols: [['Date prévue', r => r.date], ['Statut', r => r.status], ['Texte', r => (r.text || '').slice(0, 300)]] },
  { store: 'fbstats', name: 'Facebook_stats', cols: [['Date', r => r.date], ['Abonnés', r => r.followers], ['Portée', r => r.reach], ['Interactions', r => r.engage]] },
  { store: 'settings', name: 'Reglages', cols: [['Entreprise', r => r.value?.company], ['SIRET', r => r.value?.siret], ['Prochain n° devis', r => r.value?.quoteNext], ['Prochain n° facture', r => r.value?.invNext]] }
];

const colL = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const width = t => t.cols.length + META.length;

/* ---------- état ---------- */
let status = { state: 'off', msg: '' };
const listeners = new Set();
let onPulled = () => {};
const setStatus = (state, msg = '') => { status = { state, msg }; listeners.forEach(f => f(status)); };
export const getStatus = () => status;
export const onStatus = f => { listeners.add(f); f(status); };
export const setOnPulled = f => { onPulled = f; };
export const sheetId = () => localStorage.getItem(K.id) || '';
export const scriptMode = () => !!(localStorage.getItem(K.url) && localStorage.getItem(K.skey));
export const configured = () => scriptMode() || !!sheetId();
export const scriptUrlValue = () => localStorage.getItem(K.url) || '';
export function setScript(url, key) {
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url)) throw new Error("L'URL doit être celle de l'application web Apps Script (https://script.google.com/macros/s/…/exec).");
  if (!key) throw new Error('Clé secrète manquante');
  localStorage.setItem(K.url, url); localStorage.setItem(K.skey, key);
}
export function clearScript() { localStorage.removeItem(K.url); localStorage.removeItem(K.skey); localStorage.removeItem(K.last); setStatus(configured() ? 'auth' : 'off'); }

// Appel de la passerelle Apps Script (texte brut : pas de pré-requête CORS)
async function scriptCall(payload) {
  let r;
  try {
    r = await fetch(localStorage.getItem(K.url), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: localStorage.getItem(K.skey), ...payload }) });
  } catch { throw Object.assign(new Error('Réseau indisponible ou URL Apps Script incorrecte'), { code: 'net' }); }
  let j;
  try { j = await r.json(); } catch { throw Object.assign(new Error("Réponse inattendue : le déploiement doit être accessible à « Tout le monde » (voir README)"), { code: 'api' }); }
  if (j.error) throw Object.assign(new Error(j.error), { code: 'api' });
  return j;
}

// Lecture / écriture des onglets, selon le mode (Apps Script ou API Sheets avec OAuth)
async function readTabs(interactive) {
  if (scriptMode()) { const j = await scriptCall({ action: 'read', tabs: TABS.map(t => t.name) }); return TABS.map(t => j.tabs[t.name] || []); }
  const ranges = TABS.map(t => `ranges=${encodeURIComponent(`'${t.name}'!A1:${colL(width(t))}`)}`).join('&');
  const res = await api(`/${sheetId()}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`, {}, interactive);
  return res.valueRanges.map(v => v.values || []);
}
async function writeTabs(data, interactive) {
  if (scriptMode()) { await scriptCall({ action: 'write', tabs: data.map(d => ({ name: d.name, values: d.values })) }); return; }
  const id = sheetId();
  await api(`/${id}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: data.map(d => d.range.replace('!A1', `!A:${colL(d.values[0].length)}`)) }) }, interactive);
  await api(`/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: data.map(d => ({ range: d.range, values: d.values })) }) }, interactive);
}
export const lastSync = () => +localStorage.getItem(K.last) || 0;
export const sheetUrl = () => (!scriptMode() && sheetId() ? `https://docs.google.com/spreadsheets/d/${sheetId()}` : '');

/* ---------- authentification ---------- */
export async function connect(interactive = true) {
  const S = await getS();
  if (!S.googleClientId) throw Object.assign(new Error('Identifiant client Google manquant : renseignez-le dans Réglages › Google Sheets.'), { code: 'noclient' });
  await loadScript(GSI);
  return new Promise((res, rej) => {
    const timer = !interactive && setTimeout(() => rej(Object.assign(new Error('Reconnexion Google nécessaire'), { code: 'auth' })), 12000);
    const client = google.accounts.oauth2.initTokenClient({
      client_id: S.googleClientId, scope: SCOPE,
      callback: r => {
        clearTimeout(timer);
        if (r.error) return rej(Object.assign(new Error(r.error_description || r.error), { code: 'auth' }));
        localStorage.setItem(K.tok, r.access_token);
        localStorage.setItem(K.exp, String(Date.now() + (Number(r.expires_in) - 90) * 1000));
        res(r.access_token);
      },
      error_callback: er => { clearTimeout(timer); rej(Object.assign(new Error(er.type === 'popup_closed' ? 'Connexion annulée' : 'Connexion Google impossible'), { code: 'auth' })); }
    });
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

async function token(interactive) {
  const t = localStorage.getItem(K.tok), x = +localStorage.getItem(K.exp) || 0;
  if (t && Date.now() < x) return t;
  return connect(interactive);
}

export function disconnect(forget = false) {
  const t = localStorage.getItem(K.tok);
  if (t && window.google?.accounts?.oauth2) try { google.accounts.oauth2.revoke(t); } catch { /* ignore */ }
  localStorage.removeItem(K.tok); localStorage.removeItem(K.exp);
  if (forget) { localStorage.removeItem(K.id); localStorage.removeItem(K.last); }
  setStatus(configured() ? 'auth' : 'off');
}

async function api(path, opts = {}, interactive = false) {
  const t = await token(interactive);
  const r = await fetch(API + path, { ...opts, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) { localStorage.removeItem(K.exp); throw Object.assign(new Error('Session Google expirée'), { code: 'auth' }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || 'Erreur Google ' + r.status), { code: r.status === 403 ? 'forbidden' : 'api' });
  return j;
}

/* ---------- classeur ---------- */
export async function createSheet() {
  const j = await api('', {
    method: 'POST',
    body: JSON.stringify({ properties: { title: 'GestPro – Données', locale: 'fr_FR' }, sheets: [...TABS.map(t => t.name), PHOTO_TAB].map(n => ({ properties: { title: n, gridProperties: { frozenRowCount: 1 } } })) })
  }, true);
  localStorage.setItem(K.id, j.spreadsheetId);
  return j.spreadsheetId;
}

export async function useSheet(input) {
  const m = String(input).match(/\/d\/([\w-]+)/);
  const id = m ? m[1] : String(input).trim();
  if (!/^[\w-]{20,}$/.test(id)) throw new Error('Adresse ou identifiant de classeur invalide');
  localStorage.setItem(K.id, id);
  const info = await api(`/${id}?fields=sheets.properties.title`, {}, true);
  const have = new Set(info.sheets.map(s => s.properties.title));
  const missing = [...TABS.map(t => t.name), PHOTO_TAB].filter(n => !have.has(n));
  if (missing.length) await api(`/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: missing.map(n => ({ addSheet: { properties: { title: n, gridProperties: { frozenRowCount: 1 } } } })) }) }, true);
  return id;
}

/* ---------- synchronisation ---------- */
const clean = (store, rec) => {
  const { _u, _d, ...r } = rec;
  if (store === 'fbposts') delete r.image;
  if (store === 'settings') { r.value = { ...r.value }; LOCAL_ONLY.forEach(k => delete r.value[k]); if ((r.value.logo || '').length > 40000) delete r.value.logo; }
  return r;
};


export const markPhotosDirty = () => localStorage.setItem(K.photo, '1');

async function readOne(name, interactive) {
  if (scriptMode()) { const j = await scriptCall({ action: 'read', tabs: [name] }); return j.tabs[name] || []; }
  try {
    const j = await api(`/${sheetId()}/values/${encodeURIComponent(`'${name}'!A:D`)}?valueRenderOption=UNFORMATTED_VALUE`, {}, interactive);
    return j.values || [];
  } catch (err) {
    if (!/parse range|Unable to parse/i.test(err.message)) throw err;
    await api(`/${sheetId()}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: name, gridProperties: { frozenRowCount: 1 } } } }] }) }, interactive);
    return [];
  }
}

// Les photos vivent dans un onglet à part (id, maj, supprime, données) et ne sont lues / écrites que si nécessaire :
// - lecture : un produit annonce une photo plus récente (photoV) que celle de l'appareil
// - écriture : une photo a été ajoutée / modifiée / retirée sur cet appareil
async function syncPhotos(interactive) {
  const products = await db.all('products');
  const local = new Map((await db.allRaw('photos')).filter(o => !o._d).map(o => [o.id, o]));
  const lv = id => local.get(id)?.v || 0;
  const needPull = products.some(p => (p.photoV || 0) > lv(p.id));
  const pending = localStorage.getItem(K.photo) === '1';
  if (!needPull && !pending) return 0;

  const rows = await readOne(PHOTO_TAB, interactive);
  const remote = new Map();
  rows.slice(1).forEach(r => {
    const id = String(r[0] ?? ''); if (!id) return;
    remote.set(id, { id, v: Number(r[1]) || 0, data: r[2] ? '' : String(r[3] ?? '') });
  });
  let pulled = 0, rewrite = !rows.length || String(rows[0][0] ?? '') !== 'id';
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(id), m = remote.get(id);
    if (m && m.v > (l?.v || 0)) { await db.putRaw('photos', { id, data: m.data, v: m.v, _u: Date.now() }); local.set(id, { id, data: m.data, v: m.v }); pulled++; }
    else if (l && (l.v || 0) > (m?.v || 0)) rewrite = true;
  }
  if (rewrite) {
    const alive = new Set(products.map(p => p.id));
    const values = [['id', 'maj', 'supprime', 'json']];
    for (const [id, o] of local) {
      if (!alive.has(id)) continue;
      if (!o.data) { values.push([id, o.v || 0, 1, '']); continue; }
      if (o.data.length > PHOTO_MAX) continue; // trop lourde pour une cellule : reste locale
      values.push([id, o.v || 0, '', o.data]);
    }
    await writeTabs([{ name: PHOTO_TAB, range: `'${PHOTO_TAB}'!A1`, values }], interactive);
  }
  localStorage.removeItem(K.photo);
  return pulled;
}

let syncing = false, pending = false, lastRun = 0, timer;
export const lastRunAt = () => lastRun;

export async function sync({ interactive = false } = {}) {
  if (!configured()) return { skipped: true };
  if (syncing) { pending = true; return { busy: true }; }
  syncing = true; lastRun = Date.now();
  setStatus('busy');
  let pulled = 0;
  try {
    const tabRows = await readTabs(interactive);
    const dirty = new Set();
    const cutoff = Date.now() - TOMB_DAYS * 864e5;

    for (let i = 0; i < TABS.length; i++) {
      const t = TABS[i], n = t.cols.length;
      const rows = tabRows[i];
      if (!rows.length || String(rows[0][n] ?? '') !== 'id') dirty.add(t.store); // en-têtes absents : à écrire
      const remote = new Map();
      rows.slice(1).forEach(r => {
        const rid = String(r[n] ?? ''); if (!rid) return;
        const u = Number(r[n + 1]) || 0;
        if (r[n + 2]) remote.set(rid, { id: rid, _u: u, _d: 1 });
        else { try { remote.set(rid, { ...JSON.parse(r[n + 3]), id: rid, _u: u }); } catch { /* ligne illisible ignorée */ } }
      });
      const local = new Map((await db.allRaw(t.store)).map(o => [o.id, o]));
      for (const rid of new Set([...local.keys(), ...remote.keys()])) {
        const l = local.get(rid), m = remote.get(rid);
        if (m && (!l || m._u > l._u)) {
          let rec = m;
          if (!m._d && t.store === 'fbposts' && l?.image) rec = { ...m, image: l.image };
          if (!m._d && t.store === 'settings') {
            const keep = {}; LOCAL_ONLY.forEach(k => { if (l?.value?.[k] !== undefined) keep[k] = l.value[k]; });
            if (m.value.logo === undefined && l?.value?.logo) keep.logo = l.value.logo;
            rec = { ...m, value: { ...m.value, ...keep } };
          }
          await db.putRaw(t.store, rec); pulled++;
        } else if (l && (!m || l._u > m._u)) dirty.add(t.store);
      }
    }

    if (dirty.size) {
      const ctx = { contacts: {}, documents: {}, products: {}, sites: {}, members: {} };
      for (const [k, s] of [['contacts', 'contacts'], ['documents', 'documents'], ['products', 'products'], ['sites', 'sites'], ['members', 'members']]) (await db.all(s)).forEach(o => (ctx[k][o.id] = o));
      const tabs = TABS.filter(t => dirty.has(t.store));
      const data = [];
      for (const t of tabs) {
        const all = (await db.allRaw(t.store)).filter(o => !(o._d && o._u < cutoff)).sort((a, b) => a._u - b._u);
        const values = [[...t.cols.map(c => c[0]), ...META]];
        for (const o of all) {
          if (o._d) { values.push([...t.cols.map(() => ''), o.id, o._u, 1, '']); continue; }
          const json = JSON.stringify(clean(t.store, o));
          if (json.length > 48000) throw new Error(`Enregistrement trop volumineux pour une cellule Google Sheets (${t.name}).`);
          values.push([...t.cols.map(c => { const v = c[1](o, ctx); return v === undefined || v === null ? '' : v; }), o.id, o._u, '', json]);
        }
        data.push({ name: t.name, range: `'${t.name}'!A1`, values });
      }
      await writeTabs(data, interactive);
    }
    pulled += await syncPhotos(interactive);
    localStorage.setItem(K.last, String(Date.now()));
    setStatus('ok');
    if (pulled) onPulled(pulled);
    return { pulled, pushed: [...dirty] };
  } catch (err) {
    setStatus(err.code === 'auth' || err.code === 'noclient' ? 'auth' : 'err', err.message);
    if (interactive) throw err;
    return { error: err.message };
  } finally {
    syncing = false;
    if (pending) { pending = false; schedule(1500); }
  }
}

// Synchro différée après chaque modification locale
export function schedule(delay = 4000) {
  if (!configured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { if (navigator.onLine) sync(); }, delay);
}

export function init() {
  db.onChange(() => schedule());
  window.addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastRun > 30000) sync(); });
  if (configured()) { setStatus('busy'); if (navigator.onLine) sync(); else setStatus('err', 'hors ligne'); }
}
