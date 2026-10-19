// Sauvegarde automatique hebdomadaire (N4) : une copie datée des données dans l'espace de stockage de l'entreprise
// (Google Drive ou OneDrive, via le script Apps Script déjà relié), dossier GestPro/Sauvegardes, les 8 dernières copies conservées.
// L'appli ne peut pas travailler en arrière-plan : la copie part à l'ouverture, une fois la synchronisation faite, quand la dernière a plus de 7 jours.
// Sont exclus de la copie : les photos des produits (elles restent dans le classeur) et les clés personnelles (jeton Facebook, identifiant Google).
import * as db from './db.js';
import { scriptCall, scriptMode } from './sheets.js';
import * as auth from './auth.js';
import { getS } from './defaults.js';
import { toB64 } from './docmail.js';
import { today, toast, downloadFile } from './util.js';

export const BACKUP = { days: 7, keep: 8, grace: 3, retryH: 6, maxBytes: 20 * 1024 * 1024, dir: ['GestPro', 'Sauvegardes'] };
const REC = 'backup', SECRETS = ['fbToken', 'googleClientId'];

export const getState = async () => (await db.get('settings', REC))?.value || {};
const setState = v => db.put('settings', { id: REC, value: v });

/* La prochaine copie est-elle due ? (dernière réussie il y a 7 jours ou plus ; après un échec, nouvel essai au bout de 6 h seulement) */
export function dueBackup(st, now = Date.now()) {
  const last = st && st.at ? Date.parse(st.at) : 0;
  if (now - last < BACKUP.days * 864e5) return false;
  if (st && st.errAt && now - Date.parse(st.errAt) < BACKUP.retryH * 36e5) return false;
  return true;
}
/* La sauvegarde est-elle en retard au point de mériter un rappel ? (aucune réussie, ou plus de 10 jours) */
export function overdueBackup(st, now = Date.now()) {
  const last = st && st.at ? Date.parse(st.at) : 0;
  return now - last > (BACKUP.days + BACKUP.grace) * 864e5;
}

/* Copie des données au format du bouton « Exporter » (restaurable avec « Restaurer… »), sans photos de produits ni clés personnelles */
export async function snapshot() {
  const d = await db.exportAll(['photos']);
  d.settings = (d.settings || []).map(r => (r.id === 'main' && r.value ? { ...r, value: Object.fromEntries(Object.entries(r.value).filter(([k]) => !SECRETS.includes(k))) } : r));
  d.auto = true;
  return JSON.stringify(d);
}

let running = false;
export const isRunning = () => running;
/* Envoie une copie maintenant. Retourne { ok, name, size } ; lève une erreur si l'envoi échoue (l'échec est mémorisé pour le rappel). */
export async function runBackup() {
  if (running) return { busy: true };
  if (!scriptMode()) throw new Error('Le stockage Drive / OneDrive n\'est pas relié : connectez d\'abord le script Apps Script (Réglages › Google Sheets).');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Hors ligne');
  running = true;
  const st = await getState();
  try {
    const bytes = new TextEncoder().encode(await snapshot());
    if (bytes.length > BACKUP.maxBytes) throw new Error(`La copie (${Math.round(bytes.length / 1048576)} Mo) dépasse la taille envoyable (${BACKUP.maxBytes / 1048576} Mo) : faites une sauvegarde manuelle (Exporter).`);
    const name = `gestpro-sauvegarde-${today()}.json`;
    const r = await scriptCall({ action: 'filePut', path: BACKUP.dir, name, mime: 'application/json', b64: toB64(bytes) });
    if (!r.id) throw new Error('Le script Apps Script n\'a pas enregistré le fichier (réponse sans identifiant) : redéployez la dernière version de Code.gs.');
    let list = (st.list || []).slice();
    for (const old of list.filter(x => x.name === name)) { try { await scriptCall({ action: 'fileDel', id: old.id }); } catch { /* reste dans le stockage */ } } // même jour : on remplace
    list = list.filter(x => x.name !== name); list.push({ id: r.id, name, date: today(), size: bytes.length });
    while (list.length > BACKUP.keep) { const old = list.shift(); try { await scriptCall({ action: 'fileDel', id: old.id }); } catch { /* ignore */ } }
    await setState({ at: new Date().toISOString(), list, by: auth.currentUser()?.name || '' });
    return { ok: true, name, size: bytes.length };
  } catch (err) {
    try { await setState({ ...st, errAt: new Date().toISOString(), error: String(err.message || err).slice(0, 200) }); } catch { /* ignore */ }
    throw err;
  } finally { running = false; }
}

/* Appelée après chaque synchronisation réussie : fait la copie si elle est due (administrateur, stockage relié, option non désactivée) */
export async function maybeBackup() {
  try {
    if (!scriptMode() || (typeof navigator !== 'undefined' && navigator.onLine === false) || running) return null;
    if ((await getS()).autoBackup === false || !auth.can('settings')) return null;
    if (!dueBackup(await getState())) return null;
    const r = await runBackup();
    if (r.ok) toast('Sauvegarde automatique faite : ' + r.name);
    return r;
  } catch { return null; }
}

/* Télécharge une copie du stockage (pour la restaurer ensuite avec « Restaurer… ») */
export async function downloadCopy(item) {
  const r = await scriptCall({ action: 'fileGet', id: item.id });
  const bin = atob(r.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  downloadFile(item.name, u, 'application/json');
}
