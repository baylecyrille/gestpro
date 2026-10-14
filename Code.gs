/**
 * GestPro – passerelle Google Apps Script <-> Google Sheets.
 * 1) Remplacez SHEET_ID (identifiant dans l'adresse du classeur : docs.google.com/spreadsheets/d/<SHEET_ID>/edit)
 * 2) Remplacez SECRET par une longue phrase de passe (la même sera saisie dans l'appli)
 * 3) Déployer > Nouveau déploiement > Application Web
 *      Exécuter en tant que : Moi      Qui a accès : Tout le monde
 * 4) Copiez l'URL se terminant par /exec dans l'appli (Réglages > Google Sheets).
 * Après toute modification de ce code : Déployer > Gérer les déploiements > Modifier > Nouvelle version.
 */
const SHEET_ID = 'COLLEZ_ICI_L_ID_DU_CLASSEUR';
// Accepte l'identifiant seul OU l'adresse complète du classeur
function sheetId_() {
  const m = String(SHEET_ID).match(/\/d\/([\w-]+)/);
  return m ? m[1] : String(SHEET_ID).trim();
}

const SECRET = 'CHANGEZ-MOI-PHRASE-SECRETE-LONGUE';

function doGet() {
  return out_({ ok: true, app: 'GestPro' }); // simple test dans le navigateur
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const req = JSON.parse(e.postData.contents);
    if (req.key !== SECRET) return out_({ error: 'Clé secrète incorrecte' });
    // --- Fichiers (photos, PDF…) : stockés dans votre Drive, dossier « GestPro » uniquement ---
    if (req.action === 'fileInfo') return out_({ ok: true, folder: dir_(['GestPro']).getUrl() });
    if (req.action === 'filePut') {
      const blob = Utilities.newBlob(Utilities.base64Decode(req.b64), req.mime || 'application/octet-stream', clean_(req.name));
      const file = dir_(req.path || ['GestPro', 'Autres']).createFile(blob);
      return out_({ ok: true, id: file.getId(), name: file.getName(), size: file.getSize() });
    }
    if (req.action === 'fileGet') {
      const f = DriveApp.getFileById(String(req.id));
      if (!inRoot_(f)) return out_({ error: 'Fichier hors du dossier GestPro' });
      const b = f.getBlob();
      return out_({ ok: true, name: f.getName(), mime: b.getContentType(), b64: Utilities.base64Encode(b.getBytes()) });
    }
    if (req.action === 'fileDel') {
      const f = DriveApp.getFileById(String(req.id));
      if (!inRoot_(f)) return out_({ error: 'Fichier hors du dossier GestPro' });
      f.setTrashed(true);
      return out_({ ok: true });
    }
    const ss = SpreadsheetApp.openById(sheetId_());

    if (req.action === 'read') {
      const tabs = {};
      (req.tabs || []).forEach(function (name) {
        const sh = ss.getSheetByName(name);
        tabs[name] = sh && sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [];
      });
      return out_({ tabs: tabs });
    }

    if (req.action === 'write') {
      (req.tabs || []).forEach(function (t) {
        const sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
        const rows = t.values || [];
        const width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
        const data = rows.map(function (r) {
          const row = r.slice();
          while (row.length < width) row.push('');
          // neutralise l'interprétation « formule » des textes (les colonnes lisibles sont un simple reflet)
          return row.map(function (v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? ' ' + v : v; });
        });
        sh.clear();
        // colonnes techniques en texte brut : id (largeur-3) et json (dernière)
        sh.getRange(1, width - 3, data.length, 1).setNumberFormat('@');
        sh.getRange(1, width, data.length, 1).setNumberFormat('@');
        sh.getRange(1, 1, data.length, width).setValues(data);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, width).setFontWeight('bold');
      });
      SpreadsheetApp.flush();
      return out_({ ok: true });
    }
    return out_({ error: 'Action inconnue' });
  } catch (err) {
    return out_({ error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- Aides pour les fichiers ----
const ROOT_NAME = 'GestPro';
function clean_(n) { return String(n || '').replace(/[\\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Sans nom'; }
// Dossier GestPro/…/… (créé au besoin). Le premier élément est toujours « GestPro ».
function dir_(path) {
  let f = DriveApp.getRootFolder();
  [ROOT_NAME].concat((path || []).slice(1)).forEach(function (n, i) {
    n = i === 0 ? ROOT_NAME : clean_(n);
    const it = f.getFoldersByName(n);
    f = it.hasNext() ? it.next() : f.createFolder(n);
  });
  return f;
}
// Vrai si le fichier se trouve bien sous GestPro (la clé ne donne jamais accès au reste du Drive)
function inRoot_(file) {
  const rootId = DriveApp.getRootFolder().getId();
  let level = [file];
  for (let depth = 0; depth < 8 && level.length; depth++) {
    const next = [];
    for (let i = 0; i < level.length; i++) {
      const ps = level[i].getParents();
      while (ps.hasNext()) {
        const p = ps.next();
        if (p.getName() === ROOT_NAME) {
          const up = p.getParents();
          while (up.hasNext()) if (up.next().getId() === rootId) return true;
        }
        next.push(p);
      }
    }
    level = next;
  }
  return false;
}
