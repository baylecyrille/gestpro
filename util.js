// Utilitaires partagés : format, formulaires, fenêtres modales, scanner de codes-barres.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const eur = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
export const num = v => parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const dateFr = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
export const today = () => new Date().toISOString().slice(0, 10);
export const refresh = () => window.dispatchEvent(new Event('hashchange'));
export const go = h => { if (location.hash === h) refresh(); else location.hash = h; };

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
}

export function tabs(base, items, cur) {
  return `<div class="tabs">${items.map(([k, l]) => `<a href="${base}/${k}" class="${k === cur ? 'on' : ''}">${l}</a>`).join('')}</div>`;
}

// Champ de formulaire
export function F(label, name, val = '', o = {}) {
  const t = o.type || 'text';
  let inp;
  if (t === 'select') {
    inp = `<select name="${name}">${o.options.map(([v, l]) => `<option value="${e(v)}" ${String(v) === String(val) ? 'selected' : ''}>${e(l)}</option>`).join('')}</select>`;
  } else if (t === 'textarea') {
    inp = `<textarea name="${name}" rows="${o.rows || 3}" ${o.ph ? `placeholder="${e(o.ph)}"` : ''}>${e(val)}</textarea>`;
  } else {
    inp = `<input name="${name}" type="${t}" value="${e(val)}" ${o.step ? `step="${o.step}"` : ''} ${o.req ? 'required' : ''} ${o.ph ? `placeholder="${e(o.ph)}"` : ''} ${o.extra || ''}>`;
  }
  return `<label class="f ${o.cls || ''}"><span>${label}</span>${inp}</label>`;
}

// Fenêtre modale générique
export function modal(title, body, onSubmit, o = {}) {
  const d = $('#modal');
  d.className = o.wide ? 'wide' : '';
  d.innerHTML = `<form method="dialog" class="mform">
    <header><h3>${e(title)}</h3><button type="button" class="x" data-close>✕</button></header>
    <div class="mbody">${body}</div>
    <footer>${o.del ? '<button type="button" class="btn danger" data-del>Supprimer</button>' : ''}<span class="sp"></span>
    <button type="button" class="btn ghost" data-close>${onSubmit ? 'Annuler' : 'Fermer'}</button>
    ${onSubmit ? `<button class="btn primary">${o.submitLabel || 'Enregistrer'}</button>` : ''}</footer></form>`;
  const f = d.querySelector('form');
  f.addEventListener('click', ev => {
    if (ev.target.closest('[data-close]')) d.close();
    if (ev.target.closest('[data-del]') && confirm('Supprimer définitivement ?')) { d.close(); o.del(); }
  });
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!onSubmit) return;
    try {
      const keep = await onSubmit(Object.fromEntries(new FormData(f)), f);
      if (keep !== false) d.close();
    } catch (err) { alert(err.message || err); }
  });
  if (o.onOpen) o.onOpen(f, d);
  if (!d.open) d.showModal();
  return d;
}
export const closeModal = () => { const d = $('#modal'); if (d.open) d.close(); };

export function loadScript(src) {
  return new Promise((res, rej) => {
    if ($(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Chargement impossible (hors ligne ?)'));
    document.head.append(s);
  });
}

export function downloadFile(name, content, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const readFileText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
export const readFileBuf = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(f); });
export const readFileUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

// Réduit une image (logo / photo) pour le stockage local
export function shrinkImage(file, max = 600) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/png'));
    };
    img.onerror = rej;
    readFileUrl(file).then(u => (img.src = u));
  });
}

// Scanner de codes-barres : caméra (BarcodeDetector ou ZXing) ou saisie / douchette USB
const ZX = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
export async function scan(onCode) {
  const ov = document.createElement('div');
  ov.className = 'scanner';
  ov.innerHTML = `<video playsinline muted></video><div class="frame"></div><p class="hint">Visez le code-barres</p>
    <div class="sbar"><input placeholder="ou saisir / douchette…" inputmode="text" autocomplete="off"><button class="btn primary" data-ok>OK</button><button class="btn" data-x>Fermer</button></div>`;
  document.body.append(ov);
  let stream, stopped = false, reader;
  const close = () => {
    stopped = true;
    stream?.getTracks().forEach(t => t.stop());
    try { reader?.reset(); } catch { /* ignore */ }
    ov.remove();
  };
  const done = c => { if (stopped) return; close(); onCode(String(c).trim()); };
  const inp = $('input', ov);
  $('[data-x]', ov).onclick = close;
  $('[data-ok]', ov).onclick = () => { if (inp.value.trim()) done(inp.value); };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter' && inp.value.trim()) done(inp.value); });
  const video = $('video', ov);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    await video.play();
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector();
      const loop = async () => {
        if (stopped) return;
        try { const r = await det.detect(video); if (r.length) return done(r[0].rawValue); } catch { /* ignore */ }
        setTimeout(loop, 180);
      };
      loop();
    } else {
      await loadScript(ZX);
      reader = new ZXing.BrowserMultiFormatReader();
      reader.decodeFromVideoElement(video, res => { if (res) done(res.getText()); });
    }
  } catch (err) {
    $('.hint', ov).textContent = 'Caméra indisponible : saisissez le code ou utilisez une douchette USB/Bluetooth.';
    inp.focus();
  }
}
