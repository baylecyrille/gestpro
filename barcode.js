// Codes-barres (M10) : encodage EAN-13, EAN-8 et Code 128 en barres, sans bibliothèque ni réseau. Module pur (testable hors navigateur).
// Un code est une suite de « modules » : '1' = barre noire, '0' = blanc. Le dessin (SVG) et l'impression sont dans labels.js.

/* ---------- EAN-13 / EAN-8 ---------- */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = L.map(c => c.replace(/[01]/g, b => (b === '1' ? '0' : '1')));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export const isDigits = s => /^\d+$/.test(String(s || ''));
/* Chiffre de contrôle d'un EAN (7 chiffres → EAN-8, 12 → EAN-13) : les chiffres sont pondérés 3, 1, 3, 1… en partant de la droite */
export function eanCheckDigit(body) {
  const d = String(body).split('').map(Number);
  const sum = d.reduce((a, v, i) => a + v * ((d.length - i) % 2 === 1 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}
/* Un code de 8, 12 ou 13 chiffres est-il un EAN / UPC-A valide (chiffre de contrôle juste) ? */
export function eanValid(code) {
  const c = String(code || '');
  if (!isDigits(c) || ![8, 12, 13].includes(c.length)) return false;
  return eanCheckDigit(c.slice(0, -1)) === +c.slice(-1);
}

/* Code interne propre à l'atelier : EAN-13 commençant par 20 (plage réservée aux codes de magasin, jamais utilisée par un fabricant).
   Prend le numéro suivant le plus grand code interne déjà utilisé. */
export function internalCode(existing = []) {
  let max = 0;
  for (const c of existing) { const s = String(c || ''); if (s.length === 13 && s.startsWith('20') && eanValid(s)) max = Math.max(max, +s.slice(2, 12)); }
  const body = '20' + String(max + 1).padStart(10, '0');
  return body + eanCheckDigit(body);
}

function ean13Bits(c) {
  const par = PARITY[+c[0]];
  let b = '101';
  for (let i = 0; i < 6; i++) b += (par[i] === 'L' ? L : G)[+c[i + 1]];
  b += '01010';
  for (let i = 7; i < 13; i++) b += R[+c[i]];
  return b + '101';
}
function ean8Bits(c) {
  let b = '101';
  for (let i = 0; i < 4; i++) b += L[+c[i]];
  b += '01010';
  for (let i = 4; i < 8; i++) b += R[+c[i]];
  return b + '101';
}

/* ---------- Code 128 ---------- */
/* Largeurs (barre, blanc, barre, blanc, barre, blanc) des 106 symboles, valeurs 0 à 105 ; 103 / 104 / 105 = départ A / B / C */
const W128 = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232';
const P128 = W128.split(' ');
const STOP128 = '2331112';
const runs = w => w.split('').map((n, i) => (i % 2 === 0 ? '1' : '0').repeat(+n)).join('');

function code128(text) {
  const t = String(text);
  if (!/^[\x20-\x7e]+$/.test(t)) return null; // le jeu B couvre les caractères imprimables ASCII (pas les accents)
  const numeric = isDigits(t) && t.length >= 4 && t.length % 2 === 0; // chiffres seuls en nombre pair : jeu C (2 chiffres par symbole), plus court
  const start = numeric ? 105 : 104, vals = [];
  if (numeric) for (let i = 0; i < t.length; i += 2) vals.push(+t.slice(i, i + 2));
  else for (const ch of t) vals.push(ch.charCodeAt(0) - 32);
  const check = (start + vals.reduce((a, v, i) => a + v * (i + 1), 0)) % 103;
  return [start, ...vals, check].map(v => runs(P128[v])).join('') + runs(STOP128);
}

/* ---------- Encodage automatique ----------
   encode('3760123456786') → { type, text, human, bits, modules, quiet } ou { error }.
   13 chiffres valides → EAN-13 · 12 chiffres valides → UPC-A (écrit comme EAN-13 précédé d'un 0) · 8 chiffres valides → EAN-8 · tout autre texte → Code 128. */
export function encode(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return { error: 'Pas de code à dessiner.' };
  if (isDigits(t) && eanValid(t)) {
    if (t.length === 8) return { type: 'ean8', text: t, human: `${t.slice(0, 4)} ${t.slice(4)}`, bits: ean8Bits(t), quiet: 7 };
    const c = t.length === 12 ? '0' + t : t;
    return { type: 'ean13', text: t, human: `${c[0]} ${c.slice(1, 7)} ${c.slice(7)}`, bits: ean13Bits(c), quiet: 9 };
  }
  const bits = code128(t);
  if (!bits) return { error: 'Ce code contient des caractères (accents, symboles) que le code-barres ne sait pas écrire : modifiez-le ou créez un code interne.' };
  return { type: 'code128', text: t, human: t, bits, quiet: 10 };
}
export const modulesOf = enc => (enc && enc.bits ? enc.bits.length + 2 * enc.quiet : 0);

/* Dessin vectoriel : une barre = un rectangle d'une unité de haut. Redimensionné par le CSS (preserveAspectRatio="none"). */
export function svg(enc, { bar = '#000' } = {}) {
  if (!enc || !enc.bits) return '';
  let d = '', x = enc.quiet;
  const b = enc.bits;
  for (let i = 0; i < b.length;) {
    let j = i; while (j < b.length && b[j] === b[i]) j++;
    if (b[i] === '1') d += `M${x} 0h${j - i}v1h-${j - i}z`;
    x += j - i; i = j;
  }
  return `<svg class="bc" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modulesOf(enc)} 1" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Code-barres ${String(enc.text).replace(/[<>&"]/g, '')}"><path fill="${bar}" d="${d}"/></svg>`;
}
