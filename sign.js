// Signature manuscrite d'un devis sur tablette (N6) : tracé → dessin vectoriel (SVG) + empreinte SHA-256 du devis au moment de la signature.
// Fonctions pures (testables hors navigateur). Rien n'est envoyé nulle part : le tracé est dessiné et gardé dans l'application avec le devis.
// Il s'agit d'une signature électronique « simple » : elle matérialise l'accord du client, l'empreinte permet de voir si le devis a changé depuis, mais ce n'est
// pas une signature qualifiée au sens du règlement eIDAS (à confirmer avec votre conseil pour les marchés importants).
import { docSums } from './vat.js';

export const SIGN_VERSION = 1;
export const MIN_LENGTH = 40; // longueur de trait minimale (px) pour qu'une signature compte : évite qu'un simple contact avec l'écran vaille signature

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function strokeLength(strokes) {
  let n = 0;
  for (const s of strokes || []) for (let i = 1; i < s.length; i++) n += dist(s[i - 1], s[i]);
  return n;
}
export const isBlank = strokes => !(strokeLength(strokes) >= MIN_LENGTH);

const r1 = v => Math.round(v * 10) / 10;
/* Tracés [[ [x,y], … ], …] → { d (chemin SVG), vb [x, y, largeur, hauteur] (cadre serré autour du dessin), n (points) } ; null si rien n'est tracé.
   Les points trop proches sont fusionnés (minDist) : le chemin reste léger (quelques Ko) même pour une longue signature. */
export function toPath(strokes, { minDist = 1.5, maxPoints = 2500, margin = 6 } = {}) {
  let md = minDist, out;
  for (let tries = 0; tries < 8; tries++) {
    out = [];
    let n = 0;
    for (const s of strokes || []) {
      if (!s || !s.length) continue;
      const pts = [s[0]];
      for (let i = 1; i < s.length; i++) if (dist(s[i], pts[pts.length - 1]) >= md) pts.push(s[i]);
      if (pts.length > 1 && dist(s[s.length - 1], pts[pts.length - 1]) > 0.01) pts.push(s[s.length - 1]);
      out.push(pts); n += pts.length;
    }
    if (n <= maxPoints) break;
    md *= 1.6; // trop de points : on simplifie davantage
  }
  const all = out.flat();
  if (!all.length) return null;
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  const d = out.map(pts => (pts.length === 1 ? `M${r1(pts[0][0])} ${r1(pts[0][1])}l0.1 0` : 'M' + pts.map(p => `${r1(p[0])} ${r1(p[1])}`).join('L'))).join('');
  return { d, vb: [r1(x0 - margin), r1(y0 - margin), r1(Math.max(1, x1 - x0) + 2 * margin), r1(Math.max(1, y1 - y0) + 2 * margin)], n: all.length };
}

/* SVG de la signature pour la feuille imprimée. Le chemin est vérifié (seuls M, L, l, chiffres, points, tirets et espaces) : jamais de contenu libre dans la page. */
const SAFE_D = /^[MLl0-9.\s-]*$/;
export function signSvg(sg, { w = 320, h = 40, stroke = 1.5 } = {}) {
  if (!sg || typeof sg.svg !== 'string' || !SAFE_D.test(sg.svg) || !Array.isArray(sg.vb) || sg.vb.length !== 4 || sg.vb.some(v => !Number.isFinite(+v))) return '';
  const [x, y, bw, bh] = sg.vb.map(Number), k = Math.min(w / bw, h / bh), sw = Math.round(stroke / k * 10) / 10; // épaisseur d'environ 1,5 px à l'impression, quelle que soit la taille du tracé
  return `<svg class="sgs" viewBox="${x} ${y} ${bw} ${bh}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Signature du client"><path d="${sg.svg}" fill="none" stroke="#10243f" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* ---------- Empreinte du devis ---------- */
const stable = v => JSON.stringify(v);
/* Ce qui engage les deux parties : numéro, date, client, textes, conditions, lignes (désignation, quantité, unité, prix, TVA, option) et totaux. Pas le statut, les envois, ni la mise en page. */
export function fingerprint(doc) {
  const S = docSums(doc);
  const lines = (doc.lines || []).map(l => [String(l.desig ?? ''), +l.qty || 0, String(l.unit ?? ''), +l.pu || 0, String(l.tva ?? ''), l.opt ? 1 : 0]);
  return sha256(stable([SIGN_VERSION, doc.number || '', doc.date || '', doc.clientId || '', doc.intro || '', doc.note || '', doc.terms || '', doc.validUntil || '', doc.siteRef || '', doc.siteAddr || '', S.ht, S.ttc, lines]));
}

/* SHA-256 en JavaScript pur (disponible partout, y compris sans contexte sécurisé) → chaîne hexadécimale */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256(text) {
  const bytes = new TextEncoder().encode(String(text));
  const l = bytes.length, total = ((l + 9 + 63) >> 6) << 6, buf = new Uint8Array(total);
  buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((l * 8) / 4294967296)); dv.setUint32(total - 4, (l * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = rr(W[i - 15], 7) ^ rr(W[i - 15], 18) ^ (W[i - 15] >>> 3), b = rr(W[i - 2], 17) ^ rr(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + a + W[i - 7] + b) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0, t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/* Le devis a-t-il changé depuis sa signature ? */
export const changedSince = doc => !!(doc && doc.sign && doc.sign.hash && fingerprint(doc) !== doc.sign.hash);
/* Enregistrement de la signature à ranger dans le devis (doc.sign) */
export function makeSign(doc, { path, name, where, place = '', at, by = '' }) {
  return { v: SIGN_VERSION, svg: path.d, vb: path.vb, name: String(name || '').trim().slice(0, 80), where: where || '', place: String(place || '').trim().slice(0, 80), at, by, hash: fingerprint(doc) };
}
