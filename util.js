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

// Compression d'image : redimensionne puis réencode jusqu'à tenir sous `maxChars` (texte base64).
// mode « photo » : JPEG fond blanc (très léger) ; mode « logo » : WebP/PNG avec transparence.
async function loadBitmap(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* repli */ } }
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => rej(new Error('Image illisible'));
    img.src = url;
  });
}
export async function compressImage(file, { mode = 'photo', maxChars = 30000 } = {}) {
  if (mode === 'logo') {
    // logo : conservé tel quel s'il est assez léger (qualité d'origine) ; sinon redimensionné le moins possible (PNG sans perte, puis WebP)
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
    if (isSvg) { const u = await readFileUrl(file); if (u.length <= maxChars) return u; throw new Error('Ce logo SVG est trop lourd : utilisez un PNG ou un JPG.'); }
    const bmp0 = await loadBitmap(file);
    const w0 = bmp0.width || bmp0.naturalWidth, h0 = bmp0.height || bmp0.naturalHeight;
    if (/^image\/(png|jpeg|webp)$/.test(file.type) && file.size * 1.37 <= maxChars && Math.max(w0, h0) <= 1600) return readFileUrl(file);
    let best = '';
    for (const max of [1400, 1100, 900, 700, 520, 400, 300]) {
      const k = Math.min(1, max / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
      c.getContext('2d').drawImage(bmp0, 0, 0, c.width, c.height);
      const png = c.toDataURL('image/png'); if (png.length <= maxChars) return png;
      for (const q of [0.92, 0.85, 0.75]) { const w = c.toDataURL('image/webp', q); if (w.startsWith('data:image/webp') && w.length <= maxChars) return w; }
      best = png;
    }
    return best;
  }
  const bmp = await loadBitmap(file);
  const bw = bmp.width || bmp.naturalWidth, bh = bmp.height || bmp.naturalHeight;
  const sizes = [480, 400, 320, 260, 200, 160];
  let out = '';
  for (const max of sizes) {
    const k = Math.min(1, max / Math.max(bw, bh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bw * k)); c.height = Math.max(1, Math.round(bh * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.72, 0.6, 0.5, 0.4]) { out = c.toDataURL('image/jpeg', q); if (out.length <= maxChars) return out; }
  }
  return out; // le plus petit obtenu
}

// Scanner de codes-barres : caméra (BarcodeDetector ou ZXing) ou saisie / douchette USB.
// La caméra choisie est mémorisée sur l'appareil (utile quand le téléphone a plusieurs objectifs
// et que celui par défaut ne fait pas la mise au point).
const ZX = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const CAM_KEY = 'gp_camera', ZOOM_KEY = 'gp_zoom';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } };
export const savedCamera = () => lsGet(CAM_KEY);
export const resetCamera = () => { lsSet(CAM_KEY, ''); lsSet(ZOOM_KEY, ''); };

async function openStream(deviceId) {
  const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const video = deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: { ideal: 'environment' } };
  try { return await navigator.mediaDevices.getUserMedia({ video }); }
  catch (err) {
    if (deviceId) { lsSet(CAM_KEY, ''); return openStream(''); } // caméra mémorisée introuvable : retour à l'automatique
    throw err;
  }
}

export async function scan(onCode) {
  const ov = document.createElement('div');
  ov.className = 'scanner';
  ov.innerHTML = `<video playsinline muted></video><div class="frame"></div><p class="hint">Visez le code-barres</p>
    <div class="ctl"><select data-cam title="Caméra" hidden></select>
      <button class="btn sm" data-next hidden>⟳ Caméra suivante</button>
      <button class="btn sm" data-focus>◎ Point</button>
      <button class="btn sm" data-torch hidden>🔦</button>
      <input type="range" data-zoom hidden title="Zoom"></div>
    <div class="sbar"><input data-code placeholder="ou saisir / douchette…" inputmode="text" autocomplete="off"><button class="btn primary" data-ok>OK</button><button class="btn" data-x>Fermer</button></div>`;
  (document.querySelector('dialog[open]') || document.body).append(ov); // dans la fenêtre ouverte, sinon elle masquerait le scanner
  let stream, stopped = false, reader, caps = {}, torchOn = false, detectorStarted = false;
  const video = $('video', ov), hint = $('.hint', ov), sel = $('[data-cam]', ov);
  const stopStream = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const close = () => { stopped = true; stopStream(); try { reader?.reset(); } catch { /* ignore */ } ov.remove(); };
  const done = c => { if (stopped) return; close(); onCode(String(c).trim()); };
  const inp = $('[data-code]', ov);
  $('[data-x]', ov).onclick = close;
  $('[data-ok]', ov).onclick = () => { if (inp.value.trim()) done(inp.value); };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter' && inp.value.trim()) done(inp.value); });

  const focus = async () => {
    const t = stream?.getVideoTracks()[0]; if (!t) return;
    const modes = caps.focusMode || [];
    try {
      if (modes.includes('single-shot')) { await t.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }); setTimeout(() => modes.includes('continuous') && t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}), 1200); }
      else if (modes.includes('continuous')) await t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      else hint.textContent = 'Pas de réglage de mise au point : reculez de 10–20 cm ou changez de caméra (⟳).';
    } catch { /* ignore */ }
  };
  $('[data-focus]', ov).onclick = focus;
  video.onclick = focus;

  const startDecoding = async () => {
    if ('BarcodeDetector' in window) {
      if (detectorStarted) return; detectorStarted = true;
      let formats = FORMATS;
      try { const sup = await BarcodeDetector.getSupportedFormats?.(); if (sup) formats = FORMATS.filter(f => sup.includes(f)); } catch { /* ignore */ }
      const det = new BarcodeDetector(formats.length ? { formats } : undefined);
      const loop = async () => {
        if (stopped) return;
        try { if (video.readyState >= 2) { const r = await det.detect(video); if (r.length) return done(r[0].rawValue); } } catch { /* ignore */ }
        setTimeout(loop, 180);
      };
      loop();
    } else {
      await loadScript(ZX);
      try { reader?.reset(); } catch { /* ignore */ }
      reader = new ZXing.BrowserMultiFormatReader();
      reader.decodeFromVideoElement(video, res => { if (res) done(res.getText()); });
    }
  };

  const start = async deviceId => {
    stopStream(); torchOn = false;
    stream = await openStream(deviceId);
    if (stopped) { stopStream(); return; }
    video.srcObject = stream;
    await video.play();
    const track = stream.getVideoTracks()[0];
    caps = track.getCapabilities?.() || {};
    // mise au point continue + zoom mémorisé + lampe
    if ((caps.focusMode || []).includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    const z = $('[data-zoom]', ov);
    if (caps.zoom) {
      z.min = caps.zoom.min; z.max = caps.zoom.max; z.step = caps.zoom.step || 0.1;
      const want = parseFloat(lsGet(ZOOM_KEY)) || caps.zoom.min;
      z.value = Math.min(caps.zoom.max, Math.max(caps.zoom.min, want)); z.hidden = false;
      track.applyConstraints({ advanced: [{ zoom: +z.value }] }).catch(() => {});
      z.oninput = () => { lsSet(ZOOM_KEY, z.value); track.applyConstraints({ advanced: [{ zoom: +z.value }] }).catch(() => {}); };
    } else z.hidden = true;
    const tb = $('[data-torch]', ov);
    tb.hidden = !caps.torch;
    tb.onclick = () => { torchOn = !torchOn; track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {}); tb.classList.toggle('primary', torchOn); };
    // liste des caméras (les noms ne sont disponibles qu'après l'autorisation)
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const cur = track.getSettings?.().deviceId;
      sel.innerHTML = cams.map((d, i) => `<option value="${e(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${e(d.label || 'Caméra ' + (i + 1))}</option>`).join('');
      sel.hidden = cams.length < 2; $('[data-next]', ov).hidden = cams.length < 2;
    } catch { /* ignore */ }
    startDecoding();
  };

  const choose = async id => {
    lsSet(CAM_KEY, id); // préférence enregistrée
    try { await start(id); hint.textContent = 'Caméra enregistrée comme préférence'; } catch { hint.textContent = 'Cette caméra ne peut pas être ouverte.'; }
  };
  sel.onchange = () => choose(sel.value);
  $('[data-next]', ov).onclick = () => {
    const opts = [...sel.options]; if (opts.length < 2) return;
    sel.selectedIndex = (sel.selectedIndex + 1) % opts.length; choose(sel.value);
  };

  try { await start(lsGet(CAM_KEY)); }
  catch (err) {
    hint.textContent = 'Caméra indisponible : saisissez le code ou utilisez une douchette USB/Bluetooth.';
    inp.focus();
  }
}

/* Sélecteur de couleur : pastilles nommées + couleur personnalisée */
export const COLOR_NAMES = [['#2f7ad6', 'Bleu'], ['#0f9aa8', 'Turquoise'], ['#1b8a4b', 'Vert'], ['#8bc34a', 'Vert clair'], ['#f2c200', 'Jaune'], ['#c77700', 'Orange'], ['#c62f2f', 'Rouge'], ['#d6479b', 'Rose'], ['#7b4fd0', 'Violet'], ['#8d5a3b', 'Marron'], ['#555d6b', 'Gris'], ['#111827', 'Noir']];
export const colorName = c => (COLOR_NAMES.find(x => x[0].toLowerCase() === String(c).toLowerCase()) || [0, 'Personnalisée'])[1];
export function colorField(label, name, val, cls = '') {
  val = val || COLOR_NAMES[0][0];
  return `<div class="f ${cls} colorf"><span>${label} : <b data-cname>${e(colorName(val))}</b></span><input type="hidden" name="${name}" value="${e(val)}">
    <div class="swatches">${COLOR_NAMES.map(([c, n]) => `<button type="button" class="sw ${c.toLowerCase() === val.toLowerCase() ? 'on' : ''}" data-c="${c}" title="${n}" aria-label="${n}" style="background:${c}"></button>`).join('')}
    <label class="sw custom ${COLOR_NAMES.some(x => x[0].toLowerCase() === val.toLowerCase()) ? '' : 'on'}" title="Couleur personnalisée" style="${COLOR_NAMES.some(x => x[0].toLowerCase() === val.toLowerCase()) ? '' : 'background:' + e(val)}"><input type="color" value="${e(val)}" aria-label="Couleur personnalisée"><i>+</i></label></div></div>`;
}
export function bindColors(f) {
  $$('.colorf', f).forEach(box => {
    const hid = $('input[type=hidden]', box), pick = $('input[type=color]', box), custom = $('.custom', box);
    const set = (c, isCustom) => {
      hid.value = c; $('[data-cname]', box).textContent = colorName(c);
      $$('.sw', box).forEach(b => b.classList.remove('on'));
      if (isCustom) { custom.classList.add('on'); custom.style.background = c; } else $(`.sw[data-c="${c}"]`, box)?.classList.add('on');
    };
    box.addEventListener('click', ev => { const b = ev.target.closest('button.sw'); if (b) { set(b.dataset.c, false); pick.value = b.dataset.c; } });
    pick.addEventListener('input', () => set(pick.value, true));
  });
}

/* Nom complet d'un contact : civilité libre + nom */
export const cname = c => [c?.civ, c?.name].filter(Boolean).join(' ');
export const CIVS = ['Mr', 'Mme', 'Mlle', 'Mr et Mme', 'Mme et Mr', 'Mr et Mr', 'Mme et Mme', 'SARL', 'SAS', 'SASU', 'EURL', 'SCI', 'EARL', 'GAEC', 'SA', 'Association', 'Commune'];
const CIV_RE = /^((?:Mr|M\.?)\s*(?:et\s+)?Mme|Mme\s+(?:et\s+)?(?:Mr|M\.?)|Mr et Mr|Mme et Mme|Messieurs|Mesdames|Monsieur|Madame|Mlle|Mle|Melle|Mme|Mr|M|SARL|SASU|SAS|EURL|EARL|GAEC|SCI|SA)(?:\.\s*|\s+)(?=\S)/i;
/* Sépare « Mr DUPONT Jean » en { civ: 'Mr', name: 'DUPONT Jean' } */
export function splitCiv(name) { const m = String(name || '').trim().match(CIV_RE); return m ? { civ: m[1], name: String(name).trim().slice(m[0].length).trim() } : null; }

/* Saisie d'adresse assistée : Base Adresse Nationale (api-adresse.data.gouv.fr, gratuite, sans clé, adresses françaises).
   onPick({ label, street, zip, city }) est appelé au choix d'une suggestion. Silencieux si hors ligne. */
export function addressAutocomplete(input, onPick) {
  if (!input || input.dataset.ac) return; input.dataset.ac = '1';
  const host = input.parentElement; host.style.position = 'relative';
  const box = document.createElement('div'); box.className = 'ac'; box.hidden = true; host.appendChild(box);
  let timer, seq = 0, last = '';
  input.setAttribute('autocomplete', 'off');
  const hide = () => { box.hidden = true; box.innerHTML = ''; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.split('\n').join(' ').trim();
    if (q.length < 4 || q === last) { if (q.length < 4) hide(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const r = await fetch('https://api-adresse.data.gouv.fr/search/?limit=6&q=' + encodeURIComponent(q));
        if (!r.ok || my !== seq) return;
        const j = await r.json();
        const items = (j.features || []).map(f => ({ label: f.properties.label, street: f.properties.name, zip: f.properties.postcode, city: f.properties.city }));
        if (!items.length) return hide();
        box.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}">${e(it.label)}</button>`).join('');
        box.hidden = false; box._items = items;
      } catch { /* hors ligne : saisie libre */ }
    }, 300);
  });
  box.addEventListener('mousedown', ev => ev.preventDefault());
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const it = box._items[+b.dataset.i]; last = it.label; hide(); onPick(it);
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));
}

/* ---- Tri & filtres mémorisés (par écran) ---- */
export const getPref = (k, d = '') => { try { const v = localStorage.getItem('gp_f_' + k); return v === null ? d : v; } catch { return d; } };
export const setPref = (k, v) => { try { localStorage.setItem('gp_f_' + k, v); } catch { /* ignore */ } };
export function filterBar(ctl) {
  return `<div class="fbar"><div class="frow"><button type="button" class="btn sm" data-ftoggle aria-expanded="false">⚙ Filtres &amp; tri<span class="fcount" hidden></span></button><span class="fsum"></span><button type="button" class="btn sm" data-fclear hidden>✕ Effacer</button></div><div class="row filt" hidden>${ctl.map(c => c.type === 'multi' ? `<div class="f multi" data-f="${c.id}"><span>${e(c.label)}</span><div class="tgs">${c.options.map(([v, l]) => `<button type="button" class="tg" data-v="${e(v)}" aria-pressed="false">${e(l)}</button>`).join('')}</div></div>`
    : c.type === 'check' ? `<label class="chk2"><input type="checkbox" data-f="${c.id}"> ${e(c.label)}</label>`
    : c.type === 'date' ? `<label class="f sm"><span>${e(c.label)}</span><input type="date" data-f="${c.id}"></label>`
    : `<label class="f sm"><span>${e(c.label)}</span><select data-f="${c.id}">${c.options.map(([v, l]) => `<option value="${e(v)}">${e(l)}</option>`).join('')}</select></label>`).join('')}<button type="button" class="btn sm" data-freset>Réinitialiser</button></div></div>`;
}
export function bindFilters(root, pre, ctl, onChange) {
  const node = c => root.querySelector(`[data-f="${c.id}"]`);
  const mget = c => [...node(c).querySelectorAll('.tg[aria-pressed=true]')].map(b => b.dataset.v);
  const get = () => Object.fromEntries(ctl.map(c => [c.id, c.type === 'multi' ? mget(c) : c.type === 'check' ? node(c).checked : node(c).value]));
  const apply = (c, v) => { const n = node(c); if (c.type === 'multi') { const on = String(v || '').split(',').filter(Boolean); n.querySelectorAll('.tg').forEach(b => b.setAttribute('aria-pressed', on.includes(b.dataset.v) ? 'true' : 'false')); } else if (c.type === 'check') n.checked = v === '1' || v === true; else { n.value = v; if (n.value !== v) n.value = c.def ?? ''; } };
  ctl.filter(c => c.type === 'multi').forEach(c => { apply(c, getPref(pre + c.id, '')); node(c).addEventListener('click', ev => { const b = ev.target.closest('.tg'); if (!b) return; b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); setPref(pre + c.id, mget(c).join(',')); onChange(get()); }); });
  ctl.filter(c => c.type !== 'multi').forEach(c => { apply(c, getPref(pre + c.id, c.type === 'check' ? '0' : (c.def ?? ''))); node(c).addEventListener('change', () => { setPref(pre + c.id, c.type === 'check' ? (node(c).checked ? '1' : '0') : node(c).value); onChange(get()); }); });
  const dflt = c => (c.def ?? c.options?.[0]?.[0] ?? '');
  const lbl = c => { // texte résumant un filtre actif
    const v = get()[c.id];
    if (c.type === 'multi') return v.map(x => c.options.find(o => o[0] === x)?.[1] || x).join(', ');
    if (c.type === 'check') return c.label;
    if (c.type === 'date') return `${c.label} ${v}`;
    return `${c.label} : ${c.options.find(o => String(o[0]) === String(v))?.[1] ?? v}`;
  };
  const active = () => ctl.filter(c => c.id !== 'sort' && (c.type === 'multi' ? get()[c.id].length : c.type === 'check' ? get()[c.id] : c.type === 'date' ? get()[c.id] : String(get()[c.id]) !== String(dflt(c))));
  const badge = () => {
    const a = active(), n = root.querySelector('.fcount'), sm = root.querySelector('.fsum'), cl = root.querySelector('[data-fclear]');
    n.hidden = !a.length; n.textContent = a.length; cl.hidden = !a.length; sm.textContent = a.length ? a.map(lbl).join(' · ') : '';
  };
  const filt = root.querySelector('.fbar .filt'), tg = root.querySelector('[data-ftoggle]');
  tg.onclick = () => { filt.hidden = !filt.hidden; tg.setAttribute('aria-expanded', String(!filt.hidden)); };
  const reset = () => { ctl.forEach(c => { const d = c.type === 'multi' ? '' : c.type === 'check' ? '0' : (c.def ?? ''); apply(c, d); setPref(pre + c.id, d); }); badge(); onChange(get()); };
  root.querySelector('[data-freset]').onclick = reset;
  root.querySelector('[data-fclear]').onclick = reset;
  root.querySelector('.fbar').addEventListener('click', badge); root.querySelector('.fbar').addEventListener('change', badge);
  badge();
  return get;
}
