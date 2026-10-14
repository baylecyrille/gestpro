// Génération d'une facture PDF/A-3B portant le XML Factur-X (profil EN 16931).
// Tout est fait sur l'appareil : aucune donnée n'est envoyée à un service extérieur.
import { facturxXml, NOTES, OPS, mentions } from './efact.js';

const asset = n => new URL(n, import.meta.url).href;

let libs = null;
const loadScript = src => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Chargement impossible : ' + src)); document.head.appendChild(s); });
/* Charge pdf-lib, fontkit, polices et profil colorimétrique (une seule fois) */
export async function loadLibs() {
  if (libs) return libs;
  if (!globalThis.PDFLib) await loadScript(asset('./pdf-lib.min.js'));
  if (!globalThis.fontkit) await loadScript(asset('./fontkit.umd.min.js'));
  const get = async n => new Uint8Array(await (await fetch(asset(n))).arrayBuffer());
  const [reg, bold, icc] = await Promise.all([get('./LiberationSans-Regular.ttf'), get('./LiberationSans-Bold.ttf'), get('./srgb.icc')]);
  libs = { PDFLib: globalThis.PDFLib, fontkit: globalThis.fontkit, reg, bold, icc };
  return libs;
}

const clean = s => String(s ?? '').replace(/[  ]/g, ' ').replace(/[‘’]/g, "'").replace(/[^\n -ɏ–—“”•€…]/g, '').replace(/\r/g, '');
const money = v => { const n = Math.abs(v).toFixed(2), [i, d] = n.split('.'); return (v < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+$)/g, ' ') + ',' + d + ' €'; };
const qtyFmt = v => String(Math.round(v * 1000) / 1000).replace('.', ',');
const dFr = iso => (iso && /^\d{4}-\d\d-\d\d/.test(iso)) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
const xmlEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

function xmp(m, title, author, when) {
  const iso = when.toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(title)}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${xmlEsc(author)}</rdf:li></rdf:Seq></dc:creator></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>GestPro</pdf:Producer></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>GestPro</xmp:CreatorTool><xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate><xmp:MetadataDate>${iso}</xmp:MetadataDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"><pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>
${[['DocumentFileName', 'name of the embedded XML invoice file'], ['DocumentType', 'INVOICE'], ['Version', 'The actual version of the Factur-X XML schema'], ['ConformanceLevel', 'The conformance level of the embedded Factur-X data']].map(([n, d]) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${n}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${d}</pdfaProperty:description></rdf:li>`).join('\n')}
</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
}

/* m : modèle d'efact.model(); doc/S : pour les mentions ; opts.logo : { bytes, type:'png'|'jpg' } */
export async function buildFacturX(m, doc, S, opts = {}) {
  const L = opts.libs || await loadLibs();
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFDict, rgb } = L.PDFLib;
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(L.fontkit);
  const F = await pdf.embedFont(L.reg, { subset: true }), B = await pdf.embedFont(L.bold, { subset: true });
  const W = 595.28, H = 841.89, MX = 40, CW = W - 2 * MX;
  const BLUE = rgb(0.118, 0.353, 0.659), GREY = rgb(0.4, 0.4, 0.4), BG = rgb(0.86, 0.91, 0.97), LINE = rgb(0.8, 0.8, 0.8), BLACK = rgb(0, 0, 0);
  const now = opts.now || new Date();
  const kind = m.isCredit ? 'Avoir' : m.deposit ? 'Facture d\'acompte' : 'Facture';
  const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
  const title = `${kind} ${m.number}`;
  const pages = [];
  let pg, y;
  const newPage = () => { pg = pdf.addPage([W, H]); pages.push(pg); y = H - 40; return pg; };
  const wid = (t, f, s) => f.widthOfTextAtSize(t, s);
  const wrap = (txt, f, s, maxW) => {
    const out = [];
    for (const para of clean(txt).split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        let word = w;
        while (wid(word, f, s) > maxW) { let k = word.length; while (k > 1 && wid(word.slice(0, k), f, s) > maxW) k--; if (line) { out.push(line); line = ''; } out.push(word.slice(0, k)); word = word.slice(k); }
        const t = line ? line + ' ' + word : word;
        if (wid(t, f, s) <= maxW) line = t; else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  };
  const text = (t, x, yy, f = F, s = 9, c = BLACK) => pg.drawText(clean(t), { x, y: yy, font: f, size: s, color: c });
  const right = (t, xr, yy, f = F, s = 9, c = BLACK) => { t = clean(t); pg.drawText(t, { x: xr - wid(t, f, s), y: yy, font: f, size: s, color: c }); };
  const para = (t, x, w, f = F, s = 9, c = BLACK, lh = s * 1.3) => { for (const ln of wrap(t, f, s, w)) { if (y < 70) newPage(); text(ln, x, y, f, s, c); y -= lh; } };

  newPage();
  // --- En-tête : logo + émetteur (gauche), client (droite)
  let top = y, lx = MX, ly = y;
  if (opts.logo && opts.logo.bytes) {
    try {
      const im = opts.logo.type === 'jpg' ? await pdf.embedJpg(opts.logo.bytes) : await pdf.embedPng(opts.logo.bytes);
      const k = Math.min(150 / im.width, 60 / im.height); const w = im.width * k, h = im.height * k;
      pg.drawImage(im, { x: MX, y: ly - h, width: w, height: h }); ly -= h + 6;
    } catch (_) { /* logo ignoré */ }
  }
  y = ly;
  const sc = m.seller;
  text(sc.name, MX, y, B, 11, BLUE); y -= 13;
  const coLines = [sc.addr.line1, sc.addr.line2, [sc.addr.zip, sc.addr.city].filter(Boolean).join(' '), sc.phone, sc.email, sc.siret ? 'SIRET : ' + sc.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4') : '', sc.vat ? 'TVA : ' + sc.vat : ''].filter(Boolean);
  for (const l of coLines) { for (const w of wrap(l, F, 8.5, 230)) { text(w, MX, y, F, 8.5); y -= 11; } }
  const yEnd = y;
  // client
  const bx = W - MX - 230; y = top;
  const cl = [m.buyer.name, m.buyer.addr.line1, m.buyer.addr.line2, [m.buyer.addr.zip, m.buyer.addr.city].filter(Boolean).join(' '), m.buyer.siren.length === 9 ? 'SIREN : ' + m.buyer.siren : ''].filter(Boolean);
  const boxH = 18 + cl.length * 12;
  pg.drawRectangle({ x: bx, y: y - boxH + 6, width: 230, height: boxH, borderColor: LINE, borderWidth: 0.8 });
  let cy = y - 8; text('Destinataire', bx + 8, cy - 2, F, 7.5, GREY); cy -= 14;
  cl.forEach((l, i) => { text(l, bx + 8, cy, i === 0 ? B : F, 9.5); cy -= 12; });
  y = Math.min(yEnd, top - boxH) - 22;

  // --- Titre
  text(title, MX, y, B, 18, BLUE);
  right(`Date : ${dFr(m.date)}`, W - MX, y + 2, F, 10); y -= 15;
  if (m.isCredit && m.fromInvoiceNumber) { text(`Sur la facture ${m.fromInvoiceNumber}`, MX, y, F, 9, GREY); }
  if (!m.isCredit && m.due) right(`À régler avant le ${dFr(m.due)}`, W - MX, y, B, 9.5);
  y -= 14;
  if (m.siteRef || doc.siteAddr) {
    para('Réf. chantier : ' + [m.siteRef, String(doc.siteAddr || '').replace(/\s*\n\s*/g, ', ')].filter(Boolean).join(' – '), MX, CW, F, 9);
  }
  const ment = mentions(doc, S);
  if (ment.length) para(ment.join('\n'), MX, CW, F, 9, GREY);
  if (doc.intro) para(String(doc.intro).replace(/<[^>]+>/g, ' '), MX, CW, B, 10);
  y -= 6;

  // --- Tableau
  const multi = m.taxes.length > 1, RB = multi ? 200 : 150; // largeur du bloc de droite (prix, TVA, total)
  const cols = { q: MX + CW - RB - 60 - 55, u: MX + CW - RB - 60, p: MX + CW - RB, t: MX + CW };
  const head = () => {
    if (y < 110) newPage();
    pg.drawRectangle({ x: MX, y: y - 5, width: CW, height: 17, color: BLUE });
    const wh = rgb(1, 1, 1);
    text('DÉSIGNATION', MX + 5, y, B, 8.5, wh); right('Qté', cols.q + 38, y, B, 8.5, wh); text('Unité', cols.u + 6, y, B, 8.5, wh); right('Prix unit. HT', cols.p + 78, y, B, 8.5, wh); if (multi) right('TVA', cols.p + 78 + 52, y, B, 8.5, wh); right('Total HT', cols.t - 5, y, B, 8.5, wh);
    y -= 20;
  };
  head();
  const dw = cols.q - MX - 60;
  for (const l of m.lines) {
    const ls = wrap(l.name, F, 9, dw);
    const rk = l.allow ? `Remise ${String(l.rem).replace('.', ',')} % : ${money(-l.allow)}` : '';
    const h = ls.length * 11.5 + (rk ? 10 : 0) + 5;
    if (y - h < 80) { newPage(); head(); }
    ls.forEach((ln, i) => text(ln, MX + 5, y - i * 11.5, F, 9));
    if (rk) text(rk, MX + 5, y - ls.length * 11.5 + 2, F, 7.5, GREY);
    right(qtyFmt(l.qty), cols.q + 38, y, F, 9); text(clean(l.unit), cols.u + 6, y, F, 9); right(money(l.pu), cols.p + 78, y, F, 9); if (multi) right(String(l.rate).replace('.', ',') + ' %', cols.p + 78 + 52, y, F, 9); right(money(l.total), cols.t - 5, y, F, 9);
    y -= h; pg.drawLine({ start: { x: MX, y: y + 7 }, end: { x: MX + CW, y: y + 7 }, thickness: 0.4, color: LINE });
  }
  // --- Totaux
  if (y < 150) newPage();
  y -= 6;
  const TW = m.prior.length ? 250 : 200, tx = W - MX - TW; // bloc des totaux plus large quand des acomptes sont listés
  const trow = (a, b, bold, bg) => {
    if (bg) pg.drawRectangle({ x: tx, y: y - 5, width: TW, height: 17, color: BG });
    const f = bold ? B : F; let sz = bold ? 10.5 : 9.5; const room = TW - 12 - wid(clean(b), f, sz) - 10;
    while (sz > 7 && wid(clean(a), f, sz) > room) sz -= 0.5; // le libellé se réduit plutôt que de recouvrir le montant
    text(a, tx + 6, y, f, sz); right(b, W - MX - 6, y, f, bold ? 10.5 : 9.5); y -= 18;
  };
  if (m.allowTotal) { trow('Total HT avant remise', money(m.lineTotal)); trow('Remise' + (m.discPct ? ' ' + String(m.discPct).replace('.', ',') + ' %' : ''), money(-m.allowTotal)); }
  trow('Total HT', money(m.ht)); m.taxes.forEach(x => trow(`TVA ${String(x.rate).replace('.', ',')} %${multi ? ' (sur ' + money(x.basis) + ')' : ''}`, money(x.amount))); trow('Total TTC', money(m.ttc), true, true);
  const depTtc = r2(m.prior.reduce((a, p) => a + p.ttc, 0)), paidOnly = r2(m.prepaid - depTtc);
  if (m.prior.length) { m.prior.forEach(p => trow(`Acompte facturé n° ${p.number}`, money(-p.ttc))); trow(m.isCredit ? 'Net de l\'avoir après acomptes' : 'Net à payer après acomptes', money(r2(m.ttc - depTtc)), true, paidOnly <= 0.004); }
  if (paidOnly > 0.004) { trow(m.isCredit ? 'Déjà déduit / remboursé' : 'Déjà réglé', money(-paidOnly)); trow(m.isCredit ? 'Reste à votre crédit' : 'Reste à payer', money(m.due_amount), true); }
  y -= 8;
  if (m.prior.length) { if (y < 100) newPage(); para('Factures d\'acompte déduites : ' + m.prior.map(p => `n° ${p.number} du ${dFr(p.date)}`).join(', ') + '.', MX, CW, F, 8.5, GREY); y -= 3; }

  // --- Règlement et mentions légales
  if (!m.isCredit && m.terms) { if (y < 120) newPage(); text('Règlement', MX, y, B, 9.5); y -= 12; para(m.terms, MX, CW, F, 8.5); y -= 4; }
  if (m.vatNote) { if (y < 120) newPage(); para(m.vatNote, MX, CW, F, 8, BLACK); y -= 3; }
  if (m.notes) { para(m.notes, MX, CW, F, 8.5); y -= 3; }
  if (!m.isCredit && m.iban) { para(`Virement : IBAN ${m.iban.replace(/(.{4})/g, '$1 ').trim()}${m.bic ? ' – BIC ' + m.bic : ''}`, MX, CW, B, 8.5); y -= 3; }
  if (!m.isCredit) para(`${NOTES.PMD} ${NOTES.PMT} ${NOTES.AAB}`, MX, CW, F, 7.5, GREY);

  // --- Pied de page
  const foot = [sc.name, sc.siret ? 'SIRET ' + sc.siret : '', sc.vat ? 'TVA ' + sc.vat : '', S.legal || ''].filter(Boolean).join(' – ');
  pages.forEach((p, i) => {
    pg = p;
    p.drawLine({ start: { x: MX, y: 42 }, end: { x: W - MX, y: 42 }, thickness: 0.4, color: LINE });
    const f = wrap(foot, F, 7, CW - 60)[0] || '';
    text(f, MX, 31, F, 7, GREY); right(`Page ${i + 1}/${pages.length}`, W - MX, 31, F, 7, GREY);
  });

  // --- PDF/A-3B + pièce jointe Factur-X
  const xml = opts.xml || facturxXml(m);
  const xmlBytes = new TextEncoder().encode(xml);
  const ctx = pdf.context, cat = pdf.catalog;
  const author = sc.name || 'GestPro';
  pdf.setTitle(title); pdf.setAuthor(author); pdf.setProducer('GestPro'); pdf.setCreator('GestPro'); pdf.setCreationDate(now); pdf.setModificationDate(now);
  await pdf.attach(xmlBytes, 'factur-x.xml', { mimeType: 'text/xml', description: 'Factur-X (EN 16931)', creationDate: now, modificationDate: now, afRelationship: L.PDFLib.AFRelationship.Alternative });
  const meta = ctx.register(ctx.stream(new TextEncoder().encode(xmp(m, title, author, now)), { Type: 'Metadata', Subtype: 'XML' }));
  cat.set(PDFName.of('Metadata'), meta);
  const icc = ctx.register(ctx.stream(L.icc, { N: 3 }));
  const oi = ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: icc });
  cat.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(oi)]));
  cat.set(PDFName.of('Lang'), PDFString.of('fr-FR'));
  const id = new Uint8Array(16); (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(id) : id.forEach((_, i) => (id[i] = (Math.random() * 256) | 0));
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex(id)), PDFHexString.of(hex(id))]);
  return pdf.save({ useObjectStreams: false });
}
