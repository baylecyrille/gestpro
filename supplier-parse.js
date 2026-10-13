// Lecture d'une facture fournisseur (PDF) : fonctions pures, testables hors navigateur.
// Entrée : pages = [[{x, y, w, s}, …], …] (texte positionné extrait par pdf.js, y vers le bas).
const nb = s => { const v = parseFloat(String(s).replace(/[\s  ]/g, '').replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
const isNum = s => /^-?\d[\d\s  ]*([.,]\d+)?$/.test(String(s).trim());
const r2 = v => Math.round(v * 100) / 100;

function toLines(pages) {
  const out = [];
  pages.forEach((items, pi) => {
    const its = items.filter(i => String(i.s).trim()).map(i => ({ ...i, s: String(i.s).trim() })).sort((a, b) => a.y - b.y || a.x - b.x);
    let cur = null;
    for (const it of its) {
      if (cur && Math.abs(it.y - cur.y) <= 3.5) { cur.t.push(it); cur.y = (cur.y + it.y) / 2; }
      else { cur = { page: pi, y: it.y, t: [it] }; out.push(cur); }
    }
  });
  out.forEach(l => { l.t.sort((a, b) => a.x - b.x); l.text = l.t.map(i => i.s).join(' '); });
  return out;
}

const UNIT_MAP = { 'unité': 'u', unite: 'u', 'unités': 'u', u: 'u', pce: 'u', pc: 'u', piece: 'u', 'pièce': 'u', m: 'm', ml: 'ml', 'm²': 'm²', m2: 'm²', 'm³': 'm³', m3: 'm³', kg: 'kg', l: 'L', lot: 'lot', h: 'h' };
export const mapUnit = s => UNIT_MAP[String(s || '').toLowerCase().trim()] || 'u';

const KEYWORD = /^(R[ée]f|N°\s*commande|Caract[ée]ristiques|Note|Quant|N°\s*BL|Livraison)/i;

export function parseSupplierInvoice(pages) {
  const lines = toLines(pages);
  const res = { supplier: {}, invoice: {}, items: [], fees: [], totals: {}, mode: 'colonnes' };

  /* ---- Articles (tableau à colonnes : n° | désignation | qté | unité | prix net | TVA % | montant) ---- */
  let cur = null, stop = false;
  for (const l of lines) {
    if (/^Remise\/Frais$/i.test(l.text) || /^Taxes$/i.test(l.text)) { stop = true; }
    if (stop) continue;
    const t = l.t;
    const pct = t.findIndex(i => /^\d+(?:[.,]\d+)?\s*%$/.test(i.s));
    const first = t[0];
    if (pct >= 3 && /^\d{1,4}$/.test(first.s) && first.x < 60 && isNum(t[pct - 1].s) && isNum(t[pct + 1]?.s ?? '')) {
      let ui = pct - 2, unit = '';
      if (!isNum(t[ui].s)) { unit = t[ui].s; ui--; }
      const qty = nb(t[ui].s), price = nb(t[pct - 1].s), amount = nb(t[pct + 1].s);
      const name = t.slice(1, ui).map(i => i.s).join(' ');
      if (name && Number.isFinite(qty)) {
        cur = { n: +first.s, name, qty, unit, unitMapped: mapUnit(unit), price, amount, tva: nb(t[pct].s), ref: '' };
        res.items.push(cur); continue;
      }
    }
    if (cur) {
      const left = t.filter(i => i.x < 200).map(i => i.s).join(' ');
      const m = left.match(/R[ée]f\.?\s*:?\s*(\S+)/i);
      if (m && !cur.ref) cur.ref = m[1];
      else if (left && !KEYWORD.test(left) && !/Page \d+\/\d+/i.test(l.text) && t[0].x < 100 && !cur.ref && l.t.length <= 2) cur.name += ' ' + left;
    }
  }

  /* ---- Repli : lignes « désignation qté PU total » dont qté × PU ≈ total ---- */
  if (!res.items.length) {
    res.mode = 'texte';
    const re = /^(?:(\S*\d\S*)\s+)?(.+?)\s+(\d+(?:[.,]\d+)?)\s+(?:([A-Za-zéèêûùô²³.]{1,8})\s+)?(\d[\d\s]*[.,]\d{2,4})\s+(?:\d+(?:[.,]\d+)?\s*%\s+)?(\d[\d\s]*[.,]\d{2})$/;
    for (const l of lines) {
      const m = l.text.match(re); if (!m) continue;
      const qty = nb(m[3]), price = nb(m[5]), amount = nb(m[6]);
      if (!(qty > 0) || !(price >= 0) || Math.abs(qty * price - amount) > Math.max(0.05, amount * 0.01)) continue;
      res.items.push({ n: res.items.length + 1, name: m[2], qty, unit: m[4] || '', unitMapped: mapUnit(m[4]), price, amount, tva: 20, ref: m[1] || '' });
    }
  }

  /* ---- Frais / remises ---- */
  const fi = lines.findIndex(l => /^Remise\/Frais$/i.test(l.text));
  if (fi >= 0) {
    for (let i = fi + 1; i < lines.length; i++) {
      const l = lines[i]; if (/^Taxes$/i.test(l.text)) break;
      if (/^(Frais|Remise)\b/i.test(l.t[0]?.s || '')) {
        const pc = l.t.findIndex(x => /%$/.test(x.s));
        const amt = pc >= 0 ? nb(l.t[pc + 1]?.s) : NaN;
        let label = ''; const nx = lines[i + 1];
        if (nx && !/^(Frais|Remise)\b/i.test(nx.t[0]?.s || '') && !/^Taxes$/i.test(nx.text)) label = nx.text;
        if (Number.isFinite(amt)) res.fees.push({ label: label || l.t[1]?.s || l.t[0].s, amount: /^Remise/i.test(l.t[0].s) ? -Math.abs(amt) : amt });
      }
    }
  }

  /* ---- Totaux ---- */
  const last = re => { const l = [...lines].reverse().find(x => x.t.some(i => re.test(i.s)) && isNum(x.t[x.t.length - 1].s)); return l ? nb(l.t[l.t.length - 1].s) : NaN; };
  res.totals = { ht0: last(/^Montant HT avant remises/i), ht: last(/^Montant total HT/i), tva: last(/^Montant TVA/i), ttc: last(/^Montant TTC/i) };
  res.sum = r2(res.items.reduce((a, i) => a + (i.amount || 0), 0));
  res.sumOk = Number.isFinite(res.totals.ht0) ? Math.abs(res.sum - res.totals.ht0) < 0.05 : null;

  /* ---- En-tête de facture ---- */
  const all = lines.map(l => l.text).join('\n');
  const inv = res.invoice;
  inv.number = (all.match(/Facture\s*(?:N°|n°|no|num[ée]ro)?\s*:?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i) || [])[1] || '';
  inv.date = (all.match(/\bDu\s+(\d\d\/\d\d\/\d{4})/) || all.match(/Date(?: de facture)?\s*:?\s*(\d\d\/\d\d\/\d{4})/i) || [])[1] || '';
  inv.due = (all.match(/Date d['’]échéance\s*:?\s*(\d\d\/\d\d\/\d{4})/i) || [])[1] || '';
  inv.terms = (all.match(/Condit\.?\s*paiement\s*:?\s*(.+)/i) || [])[1] || '';
  inv.iso = d => d ? d.split('/').reverse().join('-') : '';

  /* ---- Fournisseur : bloc en haut à gauche de la première page, avant « Donneur d'ordre » ---- */
  const p1 = lines.filter(l => l.page === 0);
  const endI = p1.findIndex(l => /Donneur d['’]ordre|Client|Destinataire/i.test(l.text) && l.t[0].x < 100);
  const maxX = Math.max(1, ...(pages[0] || []).map(i => i.x + (i.w || 0)));
  const block = p1.slice(0, endI > 0 ? endI : 18).map(l => l.t.filter(i => i.x < maxX * 0.5).map(i => i.s).join(' ')).filter(Boolean);
  const bi = block.findIndex(s => /^[A-ZÉÈÀ0-9][A-Za-zÀ-ÿ0-9 '&.\-]{2,}$/.test(s) && !/^(Facture|Date|Restant|Du )/i.test(s));
  const S = res.supplier;
  if (bi >= 0) {
    S.name = block[bi];
    const zi = block.findIndex((s, i) => i > bi && /^\d{5}\s+\S+/.test(s));
    if (zi > 0) { const m = block[zi].match(/^(\d{5})\s+(.+)$/); S.zip = m[1]; S.city = m[2]; S.address = block.slice(bi + 1, zi).join(', '); }
    const bt = block.join('\n');
    S.siret = ((bt.match(/SIRET\s*:?\s*([\d ]{14,17})/i) || [])[1] || '').replace(/\s/g, '');
    S.tva = (bt.match(/TVA\s*:?\s*([A-Z]{2}[\dA-Z]{8,13})/) || [])[1] || '';
    S.email = (bt.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [])[0] || '';
    S.phone = ((bt.match(/T[ée]l\.?\s*:?\s*(\+?[\d .]{9,18})/i) || [])[1] || '').trim();
    const cl = block.find(s => s.includes('@') && /\s-\s/.test(s));
    if (cl) S.contact = cl.split(/\s-\s/)[0].trim();
  }
  return res;
}
