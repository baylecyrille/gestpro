// Fichiers (photos, PDF…) : envoyés dans le Google Drive ou le OneDrive de l'utilisateur via la passerelle Apps Script, dossier « GestPro ».
// L'appli ne garde que {id Drive / OneDrive (préfixe « od: »), nom, type, taille} dans la fiche ; le contenu est relu à la demande (et gardé en cache sur l'appareil).
import * as db from './db.js';
import { e, today, modal, toast, refresh, $, $$ } from './util.js';
import { scriptCall, scriptMode } from './sheets.js';
import * as auth from './auth.js';

export const available = () => scriptMode();
const CACHE = 'gp-files';
export const KINDS = { photos: ['Photos', 'Photos'], autres: ['Autres', 'Autres documents'], devis: ['Devis', 'Devis'], factures: ['Factures', 'Factures'], achats: ['Achats', 'Factures d\'achat'] };
const RESTRICTED = ['devis', 'factures', 'achats'];
/* Photos et documents de chantier : tous les membres ; devis, factures et achats : profils qui voient les montants */
export const canSee = a => !RESTRICTED.includes(a.kind) || auth.can('sites.money') || auth.can('quotes') || auth.can('invoices');

export const safe = s => String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Sans nom';
/* Dossier d'un chantier : fixé au premier envoi (un renommage ultérieur ne déplace rien) */
export function siteDir(site) {
  if (!site.driveDir) site.driveDir = safe(site.name) + ' (' + String(site.id || '').slice(0, 4) + ')';
  return site.driveDir;
}
export const sitePath = (site, kind) => ['GestPro', 'Chantiers', siteDir(site), KINDS[kind]?.[0] || 'Autres'];

const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Lecture du fichier impossible')); r.readAsDataURL(blob); });
const fromB64 = (b64, mime) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); };

/* Photo : réduite à photoPx (2560 par défaut) sur le grand côté, JPEG de bonne qualité */
export async function prepare(file, px = 2560) {
  if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, px / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    return out && out.size < file.size * 1.2 ? out : file;
  } catch { return file; }
}

async function cache() { try { return await caches.open(CACHE); } catch { return null; } }
const keyOf = id => new Request('/__gpfile/' + encodeURIComponent(id));

/* Envoie un fichier ; hors ligne, il est gardé sur l'appareil puis envoyé plus tard (att.pending) */
export async function upload(file, { path, kind = 'autres', name, px = 2560 }) {
  if (!available()) throw new Error('Connectez d\'abord le stockage des fichiers : Google Drive ou OneDrive, via le script Apps Script (Réglages › Google Sheets).');
  if (file.size > 25 * 1024 * 1024) throw new Error('Fichier trop volumineux (25 Mo maximum).');
  const blob = await prepare(file, px);
  const att = { id: db.uid(), name: name || file.name || 'fichier', mime: blob.type || file.type || 'application/octet-stream', size: blob.size, kind, date: today(), by: auth.currentUser()?.name || '', path };
  if (/^image\//.test(att.mime) && !/\.(jpe?g)$/i.test(att.name) && att.mime === 'image/jpeg') att.name = att.name.replace(/\.[^.]+$/, '') + '.jpg';
  const cc = await cache();
  if (cc) await cc.put(keyOf('local-' + att.id), new Response(blob, { headers: { 'Content-Type': att.mime } }));
  try {
    if (!navigator.onLine) throw new Error('hors ligne');
    const r = await scriptCall({ action: 'filePut', path, name: att.name, mime: att.mime, b64: await toB64(blob) });
    if (!r.id) throw Object.assign(new Error("Le script Apps Script n'a pas enregistré le fichier (réponse sans identifiant) : redéployez la dernière version de Code.gs (Déployer › Gérer les déploiements › Modifier › Nouvelle version) et vérifiez l'adresse dans Réglages › Google Sheets."), { code: 'api' });
    att.fid = r.id;
    if (cc) { await cc.put(keyOf(att.fid), new Response(blob, { headers: { 'Content-Type': att.mime } })); await cc.delete(keyOf('local-' + att.id)); }
  } catch (err) {
    if (err.code === 'api') throw err;       // erreur côté script (non autorisé, quota…) : on prévient
    att.pending = true;                       // réseau : réessai automatique plus tard
  }
  return att;
}

export async function blobOf(att) {
  const cc = await cache();
  const k = keyOf(att.fid || 'local-' + att.id);
  const hit = cc && await cc.match(k);
  if (hit) return hit.blob();
  if (!att.fid) throw new Error('Fichier en attente d\'envoi');
  const r = await scriptCall({ action: 'fileGet', id: att.fid });
  const b = fromB64(r.b64, r.mime || att.mime);
  if (cc) await cc.put(k, new Response(b, { headers: { 'Content-Type': b.type } }));
  return b;
}

export async function remove(att, { trash = true } = {}) {
  const cc = await cache();
  if (cc) { await cc.delete(keyOf(att.fid || 'local-' + att.id)); }
  if (trash && att.fid && available()) { try { await scriptCall({ action: 'fileDel', id: att.fid }); } catch { /* le fichier reste dans le Drive */ } }
}

/* Envois en attente (hors ligne, ou envoi qui n'avait pas abouti) : fiches chantier, documents, contacts.
   Une pièce sans identifiant Drive (fid) dont la copie est encore sur l'appareil est renvoyée. */
let flushing = false;
export async function flushPending() {
  if (flushing || !available() || !navigator.onLine) return 0;
  flushing = true;
  try { return await flushAll(); } finally { flushing = false; }
}
async function flushAll() {
  let n = 0;
  for (const store of ['sites', 'documents', 'contacts']) {
    for (const rec of await db.all(store)) {
      const ps = (rec.files || []).filter(a => !a.fid);
      if (!ps.length) continue;
      let changed = false;
      for (const a of ps) {
        try {
          const cc = await cache(), hit = cc && await cc.match(keyOf('local-' + a.id));
          if (!hit) continue;
          const b = await hit.blob();
          const r = await scriptCall({ action: 'filePut', path: a.path, name: a.name, mime: a.mime, b64: await toB64(b) });
          if (!r.id) continue;
          a.fid = r.id; delete a.pending; changed = true;
          await cc.put(keyOf(a.fid), new Response(b, { headers: { 'Content-Type': a.mime } })); await cc.delete(keyOf('local-' + a.id)); n++;
        } catch { /* réessai au prochain démarrage */ }
      }
      if (changed) await db.put(store, rec);
    }
  }
  return n;
}

/* ---------- Affichage / ajout ---------- */
const isImg = a => /^image\//.test(a.mime || '');
const ICON = a => (isImg(a) ? '🖼' : /pdf/.test(a.mime || '') ? '📄' : '📎');

async function openAtt(att) {
  let b;
  try { b = await blobOf(att); } catch (err) { return alert(err.message || err); }
  const url = URL.createObjectURL(b);
  if (isImg(att)) {
    modal(att.name, `<div style="text-align:center"><img src="${url}" alt="${e(att.name)}" style="max-width:100%;max-height:70vh"></div><p class="muted" style="text-align:center">${e(att.date || '')}${att.by ? ' · ' + e(att.by) : ''}</p>`, null, { wide: true });
  } else {
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = att.name; document.body.append(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

/* Carte « photos & fichiers » : o = { host, title, list(): att[], add(att), remove(att), path(kind), canEdit, kinds:[…], px } */
export function filesCard(o) {
  const host = o.host;
  const kinds = o.kinds || ['autres'];
  const draw = () => {
    const list = o.list().filter(canSee);
    host.innerHTML = `<h3>${e(o.title || 'Photos & fichiers')}</h3><div class="card">
      ${available() ? '' : '<p class="muted" style="margin-top:0">Pour enregistrer des fichiers (Google Drive ou OneDrive), connectez d\'abord le script Google (Réglages).</p>'}
      <div class="fgrid">${list.map(a => `<div class="fitem" data-a="${a.id}" title="${e(a.name)}">
        ${isImg(a) ? `<div class="fth" data-th="${a.id}">🖼</div>` : `<div class="fth">${ICON(a)}</div>`}
        <div class="fn">${e(a.name)}</div><div class="fs">${a.pending || !a.fid ? '⏳ en attente d\'envoi' : (KINDS[a.kind]?.[1] || '')}</div>
        ${o.canEdit ? `<button type="button" class="btn sm danger fx" data-rm="${a.id}">✕</button>` : ''}</div>`).join('') || '<p class="muted" style="margin:0">Aucun fichier.</p>'}</div>
      ${o.canEdit && available() ? `<div class="row" style="margin:8px 0 0">
        ${kinds.includes('photos') ? '<label class="btn sm">📷 Photo<input type="file" accept="image/*" capture="environment" multiple hidden data-up="photos"></label><label class="btn sm">🖼 Galerie<input type="file" accept="image/*" multiple hidden data-up="photos"></label>' : ''}
        <label class="btn sm">📎 Document<input type="file" multiple hidden data-up="doc"></label>
        ${kinds.filter(k => k !== 'photos').length > 1 ? `<select data-kind style="width:auto">${kinds.filter(k => k !== 'photos').map(k => `<option value="${k}">${e(KINDS[k][1])}</option>`).join('')}</select>` : ''}
        </div>` : ''}</div>`;
    // miniatures chargées à la demande (cache local)
    $$('[data-th]', host).forEach(async n => {
      const a = list.find(x => x.id === n.dataset.th); if (!a) return;
      try { const u = URL.createObjectURL(await blobOf(a)); n.innerHTML = `<img src="${u}" alt="">`; } catch { /* reste l'icône */ }
    });
  };
  host.onclick = ev => {
    const rm = ev.target.closest('[data-rm]');
    if (rm) { ev.stopPropagation(); const a = o.list().find(x => x.id === rm.dataset.rm); if (a && confirm(`Retirer « ${a.name} » ? Le fichier est mis à la corbeille (Drive ou OneDrive).`)) { remove(a, { trash: !a.shared }).then(() => o.remove(a)).then(draw); } return; }
    const it = ev.target.closest('.fitem'); if (it) { const a = o.list().find(x => x.id === it.dataset.a); if (a) openAtt(a); }
  };
  host.onchange = async ev => {
    const inp = ev.target.closest('[data-up]'); if (!inp || !inp.files.length) return;
    const kind = inp.dataset.up === 'photos' ? 'photos' : (host.querySelector('[data-kind]')?.value || kinds.find(k => k !== 'photos') || 'autres');
    const files = [...inp.files]; inp.value = '';
    toast(`Envoi de ${files.length} fichier(s)…`);
    let ok = 0;
    for (const f of files) {
      try { const att = await upload(f, { path: o.path(kind), kind, px: o.px }); await o.add(att); ok++; }
      catch (err) { alert(`${f.name} : ${err.message || err}`); }
    }
    if (ok) toast(`${ok} fichier(s) ajouté(s)`);
    draw();
  };
  draw();
  return { draw };
}
