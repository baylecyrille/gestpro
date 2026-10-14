// PDF d'un devis / d'une facture / d'un avoir avec la mise en page imprimée (modèle, zones, logo, couleurs).
// Tout est fait sur l'appareil : le document est dessiné (html2canvas) puis découpé en pages A4 (pdf-lib).
import { loadScript } from './util.js';

const asset = n => new URL(n, import.meta.url).href;
const MM = 96 / 25.4;                       // pixels CSS par millimètre
const PAGE = { w: 210, h: 297, top: 12, bottom: 14, left: 12 }; // identique à @page de l'impression

async function libs() {
  if (!globalThis.html2canvas) await loadScript(asset('./html2canvas.min.js'));
  if (!globalThis.PDFLib) await loadScript(asset('./pdf-lib.min.js'));
  if (!globalThis.html2canvas || !globalThis.PDFLib) throw new Error('Bibliothèques PDF indisponibles (hors ligne ?)');
}

/* Découpe en pages. atoms : éléments dans l'ordre du document, { k: 'blk'|'thead'|'row'|'break', top, bottom } (pixels CSS).
   Renvoie des pages { rep: l'en-tête du tableau est répété, segs: [{ y0, y1 }] }. Pure : testable hors navigateur. */
export function paginate(atoms, Hp, thH = 0) {
  const pages = []; let page = null, used = 0, prev = null, started = false;
  const fresh = () => { page = { rep: started && thH > 0, segs: [] }; pages.push(page); used = page.rep ? thH : 0; prev = null; };
  fresh();
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (a.k === 'break') { if (page.segs.length) fresh(); continue; }
    let y0 = prev == null ? a.top : prev;
    let h = a.bottom - y0;
    const nx = a.k === 'thead' && atoms[i + 1] ? atoms[i + 1].bottom - atoms[i + 1].top : 0; // l'en-tête du tableau ne reste jamais seul en bas de page
    if (h + nx > Hp - used && page.segs.length) { fresh(); y0 = a.top; h = a.bottom - y0; }
    while (h > Hp - used + 0.5) { // élément plus haut qu'une page : coupé
      const take = Math.max(20, Hp - used);
      page.segs.push({ y0, y1: y0 + take }); y0 += take; h -= take; fresh();
    }
    page.segs.push({ y0, y1: a.bottom }); used += h; prev = a.bottom;
    if (a.k === 'thead') started = true;
  }
  return pages.filter(p => p.segs.length);
}

/* html : feuille produite par sheetHtml(). Renvoie les octets du PDF. */
export async function renderPdf(html, { title = 'Document', author = 'GestPro', scale = 2 } = {}) {
  await libs();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:210mm;background:#fff;pointer-events:none';
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    const sheet = host.querySelector('.sheet');
    await Promise.all([...host.querySelectorAll('img')].map(i => (i.decode ? i.decode().catch(() => {}) : null)));
    if (document.fonts?.ready) await document.fonts.ready;
    const W = sheet.offsetWidth, r0 = sheet.getBoundingClientRect(), rel = el => { const r = el.getBoundingClientRect(); return { top: r.top - r0.top, bottom: r.bottom - r0.top }; };
    const atoms = [], thead = sheet.querySelector('thead tr');
    for (const el of sheet.querySelectorAll('.cv.head, thead tr, tbody tr, .cv.foot')) {
      const k = el.matches('thead tr') ? 'thead' : el.matches('tr.pbk') ? 'break' : el.matches('tbody tr') ? 'row' : 'blk';
      atoms.push({ k, ...rel(el) });
    }
    const Hp = (PAGE.h - PAGE.top - PAGE.bottom) * MM;
    const thH = thead ? rel(thead).bottom - rel(thead).top : 0;
    const pages = paginate(atoms, Hp, thH), th = atoms.find(a => a.k === 'thead');
    // résolution : 2× par défaut, réduite si le document est long (limites mémoire des téléphones)
    const total = Math.max(sheet.offsetHeight, 1);
    const s = Math.min(scale, Math.sqrt(14e6 / (W * total)));
    const big = await globalThis.html2canvas(sheet, { scale: s, backgroundColor: '#ffffff', useCORS: true, logging: false, onclone: (d, el) => { const h = el.closest('div[style*="-12000px"]'); if (h) h.style.left = '0'; } });
    const k = big.width / W;
    const { PDFDocument } = globalThis.PDFLib;
    const pdf = await PDFDocument.create();
    pdf.setTitle(title); pdf.setAuthor(author); pdf.setProducer('GestPro'); pdf.setCreator('GestPro');
    for (const pg of pages) {
      const cv = document.createElement('canvas'); cv.width = Math.round(PAGE.w * MM * k); cv.height = Math.round(PAGE.h * MM * k);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      const ox = PAGE.left * MM * k; let oy = PAGE.top * MM * k;
      const draw = (y0, y1) => { const sh = (y1 - y0) * k; if (sh < 1) return; ctx.drawImage(big, 0, y0 * k, big.width, sh, ox, oy, big.width, sh); oy += sh; };
      if (pg.rep && th) draw(th.top, th.bottom);
      for (const sg of pg.segs) draw(sg.y0, sg.y1);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.86));
      cv.width = cv.height = 0;
      if (!blob) throw new Error('Création de l\'image impossible');
      const img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const page = pdf.addPage([595.28, 841.89]);
      page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    big.width = big.height = 0;
    return await pdf.save();
  } finally { host.remove(); }
}
