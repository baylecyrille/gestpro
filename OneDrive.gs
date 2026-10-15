/**
 * GestPro – stockage des photos et documents sur OneDrive (Microsoft 365, compte personnel / Famille).
 *
 * À ajouter dans le MÊME projet Apps Script que Code.gs : bouton « + » à côté de « Fichiers » › Script › nommez-le « OneDrive ».
 * 1) Remplacez MS_CLIENT_ID ci-dessous par l'« ID d'application (client) » de votre inscription GestPro (portail Microsoft, voir README).
 * 2) Dans Code.gs, fonction doPost, juste après la ligne  if (req.key !== SECRET) …  ajoutez la ligne :
 *      if (typeof filesOneDrive_ === 'function') { const fr = filesOneDrive_(req); if (fr) return out_(fr); }
 * 3) Choisissez la fonction « onedriveConnecter » › ▶ Exécuter (acceptez les autorisations Google : cochez TOUTES les cases),
 *    puis suivez les instructions affichées dans le journal d'exécution (code à saisir sur la page Microsoft).
 * 4) Choisissez « onedriveTerminer » › ▶ Exécuter. Puis Déployer › Gérer les déploiements › Modifier › Nouvelle version.
 *
 * Confidentialité : GestPro n'a accès qu'à son propre dossier (OneDrive › Applications › GestPro), jamais au reste de votre OneDrive.
 * Le jeton de connexion est gardé dans les propriétés de CE script (votre compte Google), nulle part ailleurs.
 * Les fichiers déjà envoyés dans Google Drive restent lisibles ; les nouveaux fichiers vont sur OneDrive.
 * Retour à Google Drive : exécutez « onedriveRevenirDrive ».
 */
const MS_CLIENT_ID = 'COLLEZ_ICI_ID_APPLICATION_CLIENT';

const MS_SCOPE = 'Files.ReadWrite.AppFolder offline_access';
const MS_AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/';
const MS_GRAPH = 'https://graph.microsoft.com/v1.0';
const OD_PREFIX = 'od:'; // les identifiants de fichiers OneDrive sont préfixés : ils ne se confondent pas avec ceux de Google Drive

function msId_() { const v = String(MS_CLIENT_ID || '').trim(); return /^COLLEZ/.test(v) ? '' : v; }

// ---- Connexion (une seule fois, depuis l'éditeur) ----
function onedriveConnecter() {
  if (!msId_()) throw new Error('Collez d\'abord l\'ID d\'application (MS_CLIENT_ID) en haut du fichier OneDrive.');
  const r = msPost_('devicecode', { client_id: msId_(), scope: MS_SCOPE });
  if (!r.device_code) throw new Error('Microsoft a refusé la demande : ' + (r.error_description || r.error || 'réponse vide'));
  PropertiesService.getScriptProperties().setProperty('MS_DEVICE', r.device_code);
  const txt = 'ÉTAPE 1 – Dans un navigateur, ouvrez ' + r.verification_uri + ' , saisissez le code  ' + r.user_code + '  et connectez-vous avec votre compte Microsoft (celui de Microsoft 365 Famille), puis acceptez l\'accès demandé (vous avez ' + Math.round((r.expires_in || 900) / 60) + ' minutes).\n' +
    'ÉTAPE 2 – Revenez ici, choisissez la fonction « onedriveTerminer » et cliquez ▶ Exécuter.';
  Logger.log(txt);
  return txt;
}

function onedriveTerminer() {
  const p = PropertiesService.getScriptProperties(), dc = p.getProperty('MS_DEVICE');
  if (!dc) throw new Error('Exécutez d\'abord « onedriveConnecter ».');
  const r = msPost_('token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: msId_(), device_code: dc });
  if (!r.refresh_token) {
    const txt = r.error === 'authorization_pending'
      ? 'La connexion Microsoft n\'est pas encore terminée : saisissez le code sur la page Microsoft, acceptez, puis relancez « onedriveTerminer ».'
      : 'Connexion refusée par Microsoft (' + (r.error_description || r.error || 'réponse vide') + '). Relancez « onedriveConnecter ».';
    Logger.log(txt);
    return txt;
  }
  p.setProperty('MS_REFRESH', r.refresh_token);
  p.setProperty('STORAGE', 'onedrive');
  p.deleteProperty('MS_DEVICE');
  CacheService.getScriptCache().remove('ms_at');
  const info = odInfo_();
  const txt = 'OneDrive connecté' + (info.account ? ' (' + info.account + ')' : '') + '. Dossier : ' + info.folder + '\nDernière étape : Déployer › Gérer les déploiements › Modifier › Nouvelle version.';
  Logger.log(txt);
  return txt;
}

function onedriveRevenirDrive() {
  const p = PropertiesService.getScriptProperties();
  p.deleteProperty('STORAGE'); p.deleteProperty('MS_REFRESH'); p.deleteProperty('MS_DEVICE');
  CacheService.getScriptCache().remove('ms_at');
  Logger.log('Les nouveaux fichiers repartent vers Google Drive. Les fichiers déjà sur OneDrive restent dans votre OneDrive mais ne seront plus lisibles depuis GestPro tant que OneDrive n\'est pas reconnecté.');
}

// ---- Appelé par doPost (voir l'en-tête) : renvoie la réponse, ou null pour laisser Code.gs (Google Drive) traiter la demande ----
function filesOneDrive_(req) {
  const isOd = function (id) { return String(id || '').indexOf(OD_PREFIX) === 0; };
  const on = PropertiesService.getScriptProperties().getProperty('STORAGE') === 'onedrive';
  if (req.action === 'fileInfo') return on ? odInfo_() : null;
  if (req.action === 'filePut') return on ? odPut_(req) : null;
  if (req.action === 'fileGet') return isOd(req.id) ? odGet_(req) : null;
  if (req.action === 'fileDel') return isOd(req.id) ? odDel_(req) : null;
  return null;
}

function odInfo_() {
  const f = odJson_(odFetch_('get', '/me/drive/special/approot')); // crée le dossier de l'application au besoin
  let account = '', free = null;
  try {
    const d = odJson_(odFetch_('get', '/me/drive'));
    account = (d.owner && d.owner.user && d.owner.user.displayName) || '';
    if (d.quota && d.quota.remaining != null) free = d.quota.remaining;
  } catch (x) { /* facultatif */ }
  return { ok: true, storage: 'onedrive', folder: f.webUrl || '', name: f.name || '', account: account, free: free };
}

function odPut_(req) {
  const segs = (req.path && req.path.length ? req.path : ['GestPro', 'Autres']).slice(1).map(odName_).filter(Boolean); // le 1er élément (« GestPro ») est le dossier de l'application lui-même
  const name = odName_(req.name) || 'Sans nom';
  const bytes = Utilities.base64Decode(req.b64);
  const url = '/me/drive/special/approot:/' + segs.concat(name).map(encodeURIComponent).join('/') + ':/content?@microsoft.graph.conflictBehavior=rename';
  const mime = req.mime || 'application/octet-stream';
  let r = odFetch_('put', url, { payload: bytes, contentType: mime });
  if (r.getResponseCode() === 404 || r.getResponseCode() === 409) { odEnsure_(segs); r = odFetch_('put', url, { payload: bytes, contentType: mime }); }
  const j = odJson_(r);
  return { ok: true, id: OD_PREFIX + j.id, name: j.name, size: j.size };
}

function odGet_(req) {
  const id = String(req.id).slice(OD_PREFIX.length);
  let r = odFetch_('get', '/me/drive/items/' + encodeURIComponent(id) + '/content');
  let code = r.getResponseCode();
  if (code >= 300 && code < 400) { // adresse de téléchargement temporaire : appelée sans l'en-tête d'autorisation
    const h = r.getAllHeaders(), loc = h.Location || h.location;
    r = UrlFetchApp.fetch(String(Array.isArray(loc) ? loc[0] : loc), { muteHttpExceptions: true });
    code = r.getResponseCode();
  }
  if (code !== 200) odJson_(r); // lève l'erreur
  const b = r.getBlob();
  return { ok: true, name: '', mime: '', b64: Utilities.base64Encode(b.getBytes()) }; // le type est celui enregistré par l'appli à l'envoi
}

function odDel_(req) {
  const r = odFetch_('delete', '/me/drive/items/' + encodeURIComponent(String(req.id).slice(OD_PREFIX.length))); // va dans la corbeille OneDrive
  const c = r.getResponseCode();
  if (c !== 204 && c !== 404) odJson_(r);
  return { ok: true };
}

// Crée, un niveau après l'autre, les dossiers manquants sous le dossier de l'application
function odEnsure_(segs) {
  const base = '/me/drive/special/approot';
  segs.forEach(function (n, i) {
    const kids = i === 0 ? base + '/children' : base + ':/' + segs.slice(0, i).map(encodeURIComponent).join('/') + ':/children';
    const r = odFetch_('post', kids, { payload: JSON.stringify({ name: n, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) });
    const c = r.getResponseCode();
    if (c !== 409 && (c < 200 || c >= 300)) odJson_(r); // 409 = existe déjà : normal
  });
}

// ---- Aides ----
// Nom accepté par OneDrive (pas de \ / : * ? " < > |, ni de point ou d'espace final)
function odName_(n) { return String(n || '').replace(/[\\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').replace(/^ +/, '').replace(/[. ]+$/, '').slice(0, 90); }

function msPost_(endpoint, form) {
  const r = UrlFetchApp.fetch(MS_AUTH + endpoint, { method: 'post', payload: form, muteHttpExceptions: true });
  try { return JSON.parse(r.getContentText() || '{}'); } catch (x) { return { error: 'réponse illisible (HTTP ' + r.getResponseCode() + ')' }; }
}

// Jeton d'accès (valable ~1 h, gardé en cache) renouvelé à partir du jeton de connexion (valable 90 jours, prolongé à chaque utilisation)
function msToken_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) { const c = cache.get('ms_at'); if (c) return c; }
  const props = PropertiesService.getScriptProperties(), rt = props.getProperty('MS_REFRESH');
  if (!rt) throw new Error('OneDrive n\'est pas connecté : dans l\'éditeur Apps Script, exécutez « onedriveConnecter » puis « onedriveTerminer ».');
  const j = msPost_('token', { client_id: msId_(), grant_type: 'refresh_token', refresh_token: rt, scope: MS_SCOPE });
  if (!j.access_token) throw new Error('OneDrive : Microsoft a refusé le renouvellement de la connexion (' + (j.error_description || j.error || 'réponse vide') + '). Dans l\'éditeur Apps Script, exécutez de nouveau « onedriveConnecter » puis « onedriveTerminer ».');
  if (j.refresh_token) props.setProperty('MS_REFRESH', j.refresh_token); // le jeton est remplacé à chaque renouvellement
  cache.put('ms_at', j.access_token, Math.max(60, Math.min(21000, (j.expires_in || 3600) - 300)));
  return j.access_token;
}

function odFetch_(method, url, opt) {
  opt = opt || {};
  let r;
  for (let i = 0; i < 2; i++) { // 2e essai avec un jeton neuf si Microsoft répond 401
    const p = { method: method, headers: { Authorization: 'Bearer ' + msToken_(i > 0) }, muteHttpExceptions: true, followRedirects: false };
    if (opt.payload !== undefined) { p.payload = opt.payload; p.contentType = opt.contentType || 'application/json'; }
    r = UrlFetchApp.fetch(url.charAt(0) === '/' ? MS_GRAPH + url : url, p);
    if (r.getResponseCode() !== 401) break;
  }
  return r;
}

function odJson_(r) {
  const code = r.getResponseCode();
  let j = {};
  try { j = JSON.parse(r.getContentText() || '{}'); } catch (x) { j = {}; }
  if (code < 200 || code >= 300) throw new Error('OneDrive (HTTP ' + code + ') : ' + ((j.error && (j.error.message || j.error.code)) || String(r.getContentText()).slice(0, 150)));
  return j;
}
