// Base de données locale (IndexedDB) = cache hors ligne. Chaque enregistrement porte un horodatage `_u`
// et les suppressions laissent une « pierre tombale » `_d` afin que la synchronisation Google Sheets
// puisse fusionner plusieurs appareils (le plus récent gagne).
const DB_NAME = 'gestpro';
const VER = 1;
export const STORES = ['products', 'locations', 'contacts', 'documents', 'payments', 'moves', 'fbposts', 'fbstats', 'settings'];
let dbp;
let changeCb = () => {};
export const onChange = fn => { changeCb = fn; };

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && r.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

// Lecture brute (avec pierres tombales) – utilisée par la synchronisation
export const allRaw = s => tx(s, 'readonly', st => st.getAll());
export const putRaw = (s, o) => tx(s, 'readwrite', st => st.put(o));

export const all = s => allRaw(s).then(l => l.filter(o => !o._d));
export const get = (s, id) => tx(s, 'readonly', st => st.get(id)).then(o => (o && !o._d ? o : undefined));
export const put = (s, o) => {
  if (!o.id) o.id = uid();
  o._u = Date.now(); delete o._d;
  return tx(s, 'readwrite', st => st.put(o)).then(() => { changeCb(s); return o; });
};
export const del = (s, id) => tx(s, 'readwrite', st => st.put({ id, _d: 1, _u: Date.now() })).then(() => changeCb(s));

export async function putMany(s, list) {
  const db = await open();
  await new Promise((res, rej) => {
    const t = db.transaction(s, 'readwrite');
    const st = t.objectStore(s);
    list.forEach(o => { if (!o.id) o.id = uid(); o._u = Date.now(); delete o._d; st.put(o); });
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  changeCb(s);
  return list;
}

// Réglages : un enregistrement par clé
export async function getSettings(defaults) {
  const rec = await get('settings', 'main');
  return { ...defaults, ...(rec ? rec.value : {}) };
}
export const saveSettings = v => put('settings', { id: 'main', value: v });

export async function exportAll() {
  const out = { app: 'gestpro', version: 1, date: new Date().toISOString() };
  for (const s of STORES) out[s] = (await all(s)).map(({ _u, _d, ...r }) => r);
  return out;
}

// Restauration : remplace les données ; les éléments absents de la sauvegarde sont marqués supprimés
export async function importAll(data) {
  if (!data || data.app !== 'gestpro') throw new Error('Fichier de sauvegarde GestPro invalide');
  for (const s of STORES) {
    const keep = new Set((data[s] || []).map(o => o.id));
    for (const o of await all(s)) if (!keep.has(o.id)) await del(s, o.id);
    if (Array.isArray(data[s]) && data[s].length) await putMany(s, data[s]);
  }
}
