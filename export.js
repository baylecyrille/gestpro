// Export pour le comptable (N2) : ventes, règlements, achats, TVA et heures d'une période, en fichiers CSV
// (séparateur « ; », virgule décimale, dates JJ/MM/AAAA, UTF-8 avec BOM : s'ouvrent directement dans Excel en français), seuls ou réunis dans un ZIP.
// Fonctions pures (testables hors navigateur) ; la fenêtre est en bas de fichier. Rien n'est envoyé : les fichiers sont créés sur l'appareil.
import * as db from './db.js';
import { getS } from './defaults.js';
import { totals } from './docs.js';
import { buyRate } from './vat.js';
import { opOf } from './efact.js';
import { purchaseOf, vatEvents, vatOnInvoice, inR, sign } from './finance.js';
import { KIND_LABEL, ABS_LABEL } from './hours.js';
import { e, num, round2, today, dateFr, cname, modal, toast, downloadFile, $ } from './util.js';

/* ---------- mise en forme ---------- */
export const frDate = iso => (iso && /^\d{4}-\d\d-\d\d/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export const money = n => (Math.abs(+n) < 0.005 || !Number.isFinite(+n) ? '0,00' : (Math.round(+n * 100) / 100).toFixed(2).replace('.', ','));
export const qty = n => String(Math.round((+n || 0) * 1000) / 1000).replace('.', ',');
export const hm = h => { const t = Math.round((+h || 0) * 60); return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')}`; };
const NUMLIKE = /^-?\d+(,\d+)?$/;
/* Cellule CSV : guillemets si besoin ; un texte qui commencerait par = + @ - serait pris pour une formule par le tableur : on le précède d'une apostrophe */
export function cell(v) {
  let s = String(v ?? '');
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !NUMLIKE.test(s))) s = "'" + s;
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = rows => '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';

/* ---------- ZIP sans compression (aucune bibliothèque) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
export function zipStore(files) { // files : [{ name, data: Uint8Array }]
  const enc = new TextEncoder(), u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const out = [], cen = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const head = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...name]);
    cen.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...name]));
    out.push(head, f.data); off += head.length + size;
  }
  const cdSize = cen.reduce((a, c) => a + c.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
  const all = new Uint8Array(off + cdSize + end.length); let p = 0;
  for (const part of [...out, ...cen, end]) { all.set(part, p); p += part.length; }
  return all;
}

/* ---------- périodes ---------- */
const shiftM = (iso, dm) => { const d = new Date(iso.slice(0, 7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + dm); return d.toISOString().slice(0, 7); };
export const EXPORT_PERIODS = [['month', 'Ce mois'], ['lastmonth', 'Mois dernier'], ['quarter', 'Ce trimestre'], ['lastquarter', 'Trimestre dernier'], ['year', 'Cette année'], ['lastyear', 'Année dernière'], ['custom', 'Date à date…']];
const ld = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // dernier jour du mois m (1-12)
export function exportRange(key, ref = today(), custom = {}) {
  const y = +ref.slice(0, 4), m = +ref.slice(5, 7), p = n => String(n).padStart(2, '0');
  const month = (yy, mm) => ({ from: `${yy}-${p(mm)}-01`, to: `${yy}-${p(mm)}-${p(ld(yy, mm))}` });
  const quarter = (yy, mm) => { const s0 = Math.floor((mm - 1) / 3) * 3 + 1; return { from: `${yy}-${p(s0)}-01`, to: `${yy}-${p(s0 + 2)}-${p(ld(yy, s0 + 2))}` }; };
  if (key === 'custom') return { from: custom.from || '1900-01-01', to: custom.to || ref };
  if (key === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (key === 'lastyear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  if (key === 'lastmonth') { const ym = shiftM(ref, -1); return month(+ym.slice(0, 4), +ym.slice(5, 7)); }
  if (key === 'quarter') return quarter(y, m);
  if (key === 'lastquarter') { const ym = shiftM(ref, -3); return quarter(+ym.slice(0, 4), +ym.slice(5, 7)); }
  return month(y, m);
}

const DOC_STATUS = { draft: 'Brouillon', pending: 'À payer', sent: 'Envoyée', partial: 'Réglée partiellement', paid: 'Réglée', overdue: 'En retard', dispute: 'En litige', cancelled: 'Annulée', issued: 'Émis' };
const METHOD = { especes: 'Espèces', cheque: 'Chèque', cb: 'Carte bleue', virement: 'Virement', autre: 'Autre', avoir: 'Avoir (imputation)' };
const NATURE = { acompte: 'Acompte', avoir: 'Imputation d\'avoir', remboursement: 'Remboursement' };
const OPNAME = { goods: 'Livraison de biens', services: 'Prestation de services', mixed: 'Biens et services' };
const MAIN_RATES = [20, 10, 5.5, 0];
const rl = r => String(r).replace('.', ',') + ' %';

/* Construit les fichiers de l'export. d = { docs, payments, moves, products, sites, contacts, members, times, S }.
   Retourne { files: [{ name, title, rows }], range, sum: { ca, tvaColl, tvaDed, tvaDue } } (rows[0] = en-têtes). */
export function buildExport(range, d) {
  const { docs = [], payments = [], moves = [], products = [], sites = [], contacts = [], members = [], times = [], S = {} } = d;
  const D = Object.fromEntries(docs.map(x => [x.id, x])), C = Object.fromEntries(contacts.map(x => [x.id, x])), P = Object.fromEntries(products.map(x => [x.id, x]));
  const ST = Object.fromEntries(sites.map(x => [x.id, x])), M = Object.fromEntries(members.map(x => [x.id, x]));
  const typeOf = x => (x.type === 'credit' ? 'Avoir' : x.type === 'quote' ? 'Devis' : x.deposit ? 'Facture d\'acompte' : 'Facture');
  const real = p => p.method !== 'avoir' && p.kind !== 'avoir';

  /* 1. Ventes : toute facture et tout avoir numéroté (hors brouillon) de la période, y compris annulés : la suite des numéros doit rester lisible */
  const sales = [['Date', 'Type', 'Numéro', 'Statut', 'Comptée dans le CA', 'Client', 'SIREN / SIRET du client', 'Adresse', 'Code postal', 'Ville', 'Chantier', 'Facture d\'origine', 'Échéance', 'Régime de TVA', 'Nature de l\'opération', 'Total HT', 'Total TVA', 'Total TTC', ...MAIN_RATES.flatMap(r => ['HT ' + rl(r), 'TVA ' + rl(r)]), 'HT autres taux', 'TVA autres taux', 'Encaissé TTC', 'Avoirs imputés TTC', 'Reste dû TTC', 'Date du dernier règlement']];
  docs.filter(x => (x.type === 'invoice' || x.type === 'credit') && x.number && x.status !== 'draft' && inR(x.date, range))
    .sort((a, b) => (a.date + a.number).localeCompare(b.date + b.number)).forEach(x => {
      const t = totals(x), k = sign(x), c = C[x.clientId] || {}, counted = x.status !== 'cancelled';
      const pays = payments.filter(p => p.docId === x.id && x.type === 'invoice');
      const cash = round2(pays.filter(real).reduce((a, p) => a + num(p.amount), 0)), imp = round2(pays.filter(p => !real(p)).reduce((a, p) => a + num(p.amount), 0));
      const rate = r => t.rates.find(y => y.rate === r) || { ht: 0, tva: 0 };
      const others = t.rates.filter(y => !MAIN_RATES.includes(y.rate));
      const last = pays.map(p => p.date).sort().pop() || '';
      sales.push([frDate(x.date), typeOf(x), x.number, DOC_STATUS[x.status] || x.status, counted ? 'oui' : 'non', cname(c) || c.company || '', c.siret || '', (c.address || '').replace(/\s*\n\s*/g, ', '), c.zip || '', c.city || '', x.siteRef || ST[x.siteId]?.name || '', x.type === 'credit' ? (x.fromInvoiceNumber || D[x.fromInvoice]?.number || '') : '', x.type === 'invoice' ? frDate(x.dueDate) : '',
        vatOnInvoice(x, D, S) ? 'À la facture' : 'À l\'encaissement', OPNAME[opOf(D[x.fromInvoice] && x.type === 'credit' ? D[x.fromInvoice] : x, S)] || '',
        money(k * t.ht), money(k * t.tva), money(k * t.ttc), ...MAIN_RATES.flatMap(r => [money(k * rate(r).ht), money(k * rate(r).tva)]), money(k * others.reduce((a, y) => a + y.ht, 0)), money(k * others.reduce((a, y) => a + y.tva, 0)),
        x.type === 'invoice' ? money(cash) : '', x.type === 'invoice' ? money(imp) : '', x.type === 'invoice' ? money(t.ttc - cash - imp) : '', x.type === 'invoice' ? frDate(last) : '']);
    });

  /* 2. Règlements : argent reçu ou rendu, imputations d'avoir signalées (non réelles) */
  const pay = [['Date', 'Document', 'Type du document', 'Client', 'Montant TTC', 'Mode', 'N° de chèque', 'Banque', 'Nature', 'Encaissement réel', 'Dont TVA', 'Dont HT', 'Note']];
  payments.filter(p => inR(p.date, range)).sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(p => {
    const x = D[p.docId] || {}, t = x.id ? totals(x) : { ttc: 0, tva: 0, ht: 0 }, sg = p.kind === 'remboursement' ? -1 : 1, amt = sg * num(p.amount);
    const k = t.ttc > 0 ? amt / t.ttc : 0;
    pay.push([frDate(p.date), x.number || '', x.id ? typeOf(x) : '', cname(C[x.clientId] || {}) || (C[x.clientId] || {}).company || '', money(amt), METHOD[p.method] || p.method || '', p.chequeNo || '', p.bank || '', NATURE[p.kind] || 'Règlement', real(p) ? 'oui' : 'non', real(p) ? money(t.tva * k) : '', real(p) ? money(t.ht * k) : '', p.note || '']);
  });

  /* 3. Achats : réceptions de stock et factures fournisseurs affectées à un chantier */
  const buys = [];
  moves.filter(m => m.purchase && inR(m.date, range)).forEach(m => {
    const p = P[m.productId] || {}, pu = purchaseOf(m, P), rate = m.tva ?? buyRate(p);
    buys.push({ date: (m.date || '').slice(0, 10), src: 'Réception de stock', sup: m.sup || C[p.supplierId]?.name || '', name: p.name || '', ref: p.ref || '', q: num(m.qty), unit: p.unit || '', pu: num(m.unit), ht: pu.ht, rate: num(rate), tva: pu.tva, site: '', note: m.note || '' });
  });
  sites.forEach(st => (st.charges || []).filter(c => c.purchase && inR(c.date, range)).forEach(c => {
    const p = P[c.pid] || {}, pu = purchaseOf({ qty: c.qty, unit: c.cost, tva: c.tva, productId: c.pid }, P), rate = c.tva ?? buyRate(p);
    buys.push({ date: (c.date || '').slice(0, 10), src: 'Charge de chantier', sup: c.sup || C[p.supplierId]?.name || '', name: c.label || p.name || '', ref: p.ref || '', q: num(c.qty), unit: c.unit || p.unit || '', pu: num(c.cost), ht: pu.ht, rate: num(rate), tva: pu.tva, site: st.name || '', note: c.note || '' });
  }));
  buys.sort((a, b) => a.date.localeCompare(b.date));
  const ach = [['Date', 'Source', 'Fournisseur', 'Désignation', 'Référence', 'Quantité', 'Unité', 'PU HT', 'Total HT', 'Taux de TVA', 'TVA déductible', 'Total TTC', 'Chantier', 'Pièce / note']];
  buys.forEach(b => ach.push([frDate(b.date), b.src, b.sup, b.name, b.ref, qty(b.q), b.unit, money(b.pu), money(b.ht), rl(b.rate), money(b.tva), money(b.ht + b.tva), b.site, b.note]));

  /* 4. TVA : collectée (à la facture ou à l'encaissement selon le cas) et déductible, une ligne par pièce et par taux */
  const ev = vatEvents(range, docs, payments, S);
  const tva = [['Date', 'Sens', 'Régime', 'Type de pièce', 'Pièce', 'Taux', 'Base HT', 'TVA']];
  const lines = [];
  ev.forEach(v => v.rates.filter(r => r.ht || r.tva).forEach(r => lines.push({ date: v.date, a: ['Collectée', v.basis === 'facture' ? 'À la facture' : 'À l\'encaissement', v.type === 'credit' ? 'Avoir' : 'Facture', v.number, r.rate, r.ht, r.tva] })));
  buys.forEach(b => lines.push({ date: b.date, a: ['Déductible', 'Sur achats', b.src, b.note || b.name, b.rate, b.ht, b.tva] }));
  lines.sort((x, y) => (x.date || '').localeCompare(y.date || '')).forEach(l => tva.push([frDate(l.date), l.a[0], l.a[1], l.a[2], l.a[3], rl(l.a[4]), money(l.a[5]), money(l.a[6])]));

  /* 5. Heures : pointages jour par jour (absences comprises) */
  const hrs = [['Date', 'Salarié', 'Fonction', 'Activité', 'Chantier', 'Heures', 'Heures (h min)', 'Note']];
  times.filter(t => inR(t.date, range)).sort((a, b) => (a.date + (M[a.memberId]?.name || '')).localeCompare(b.date + (M[b.memberId]?.name || ''))).forEach(t => {
    hrs.push([frDate(t.date), M[t.memberId]?.name || '', ({ gerant: 'Gérant', chef: 'Chef de chantier', ouvrier: 'Ouvrier', apprenti: 'Apprenti', soustraitant: 'Sous-traitant', autre: 'Autre' })[M[t.memberId]?.role] || '', (t.kind === 'absence' && ABS_LABEL[t.absType] ? KIND_LABEL.absence + ' – ' + ABS_LABEL[t.absType] : KIND_LABEL[t.kind]) || t.kind || '', t.kind === 'site' ? (ST[t.siteId]?.name || '') : '', money(num(t.hours)), hm(num(t.hours)), t.note || '']);
  });

  const colN = r => Math.max(0, r.length - 1);
  const sum = {
    ca: round2(docs.filter(x => (x.type === 'invoice' || x.type === 'credit') && x.status !== 'draft' && x.status !== 'cancelled' && inR(x.date, range)).reduce((a, x) => a + sign(x) * totals(x).ht, 0)),
    tvaColl: round2(ev.reduce((a, v) => a + v.tva, 0)), tvaDed: round2(buys.reduce((a, b) => a + b.tva, 0))
  };
  sum.tvaDue = round2(sum.tvaColl - sum.tvaDed);
  return {
    range, sum,
    files: [
      { name: 'ventes.csv', title: 'Ventes (factures et avoirs)', rows: sales, n: colN(sales) },
      { name: 'reglements.csv', title: 'Règlements', rows: pay, n: colN(pay) },
      { name: 'achats.csv', title: 'Achats', rows: ach, n: colN(ach) },
      { name: 'tva.csv', title: 'TVA (collectée et déductible)', rows: tva, n: colN(tva) },
      { name: 'heures.csv', title: 'Heures', rows: hrs, n: colN(hrs) }
    ]
  };
}

export function readme(ex, S = {}) {
  const r = ex.range, regime = S.vatDebits ? 'à la date des factures (option « TVA sur les débits »)' : 'à l\'encaissement des règlements pour les prestations de services et travaux, à la facture pour les livraisons de biens';
  return `Export GestPro pour le comptable – ${S.company || ''}
Période : du ${frDate(r.from)} au ${frDate(r.to)} – fichiers créés le ${frDate(today())}

Format : CSV, séparateur « ; », virgule décimale, dates JJ/MM/AAAA, UTF-8 (s'ouvre directement dans Excel en français).
Les avoirs et remboursements sont en négatif. Les montants de TVA et de HT d'un règlement sont calculés au prorata du document réglé.

${ex.files.map(f => `- ${f.name} : ${f.title} – ${f.n} ligne(s)`).join('\n')}

Totaux de la période (à contrôler avec votre propre calcul)
- Chiffre d'affaires HT (factures moins avoirs, hors annulées) : ${money(ex.sum.ca)} €
- TVA collectée : ${money(ex.sum.tvaColl)} € (${regime})
- TVA déductible sur achats : ${money(ex.sum.tvaDed)} €
- TVA à payer (ou crédit si négatif) : ${money(ex.sum.tvaDue)} €

Les factures annulées restent listées dans ventes.csv (colonne « Comptée dans le CA » = non) pour que la suite des numéros reste lisible.
La base de calcul de la TVA collectée est à valider avec votre cabinet.
`;
}

/* Fichiers prêts à télécharger : [{ name, data: Uint8Array }] */
export function exportFiles(ex, S) {
  const enc = new TextEncoder();
  return [...ex.files.map(f => ({ name: f.name, data: enc.encode(toCsv(f.rows)) })), { name: 'LISEZ-MOI.txt', data: enc.encode('﻿' + readme(ex, S).replace(/\n/g, '\r\n')) }];
}

/* ---------- fenêtre ---------- */
export async function exportModal() {
  const [docs, payments, moves, products, sites, contacts, members, times, S] = await Promise.all([db.all('documents'), db.all('payments'), db.all('moves'), db.all('products'), db.all('sites'), db.all('contacts'), db.all('members'), db.all('times'), getS()]);
  const data = { docs, payments, moves, products, sites, contacts, members, times, S };
  let key = 'lastmonth'; try { key = localStorage.getItem('gp_exp_period') || 'lastmonth'; } catch { /* ignore */ }
  if (!EXPORT_PERIODS.some(p => p[0] === key)) key = 'lastmonth';
  const html = `<p class="muted" style="margin-top:0">Fichiers CSV pour votre cabinet : ventes, règlements, achats, TVA et heures de la période. Ils sont créés sur cet appareil, rien n'est envoyé.</p>
    <label class="f"><span>Période</span><select id="xp">${EXPORT_PERIODS.map(([k, l]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="cols" id="xc" hidden><label class="f"><span>Du</span><input type="date" id="xf"></label><label class="f"><span>Au</span><input type="date" id="xt"></label></div>
    <p class="muted" id="xr" style="margin:6px 0"></p><div id="xl"></div>
    <div class="row" style="margin-top:10px"><button type="button" class="btn primary" id="xzip">⬇ Tout télécharger (ZIP)</button></div>
    <p class="muted" style="margin:6px 0 0">Le ZIP contient les cinq fichiers et un « LISEZ-MOI » avec les totaux de la période. Séparateur « ; », virgule décimale, dates JJ/MM/AAAA : s'ouvre directement dans Excel.</p>`;
  modal('Export pour le comptable', html, null, {
    wide: true,
    onOpen: f => {
      let ex = null;
      const draw = () => {
        const k = $('#xp', f).value; $('#xc', f).hidden = k !== 'custom';
        try { localStorage.setItem('gp_exp_period', k); } catch { /* ignore */ }
        const rg = exportRange(k, today(), { from: $('#xf', f).value, to: $('#xt', f).value });
        ex = buildExport(rg, data);
        $('#xr', f).textContent = `Du ${dateFr(rg.from)} au ${dateFr(rg.to)}`;
        $('#xl', f).innerHTML = ex.files.map((x, i) => `<div class="item" style="cursor:default"><div class="main"><div class="t">${e(x.title)}</div><div class="s">${x.n} ligne(s) · ${e(x.name)}</div></div><div class="r"><button type="button" class="btn sm" data-x="${i}" ${x.n ? '' : 'disabled'}>⬇ CSV</button></div></div>`).join('');
      };
      f.addEventListener('change', draw);
      draw();
      f.addEventListener('click', ev => {
        const b = ev.target.closest('[data-x]'); if (!b) return;
        const x = ex.files[+b.dataset.x]; downloadFile(x.name.replace('.csv', `-${ex.range.from.slice(0, 10)}_${ex.range.to.slice(0, 10)}.csv`), toCsv(x.rows), 'text/csv;charset=utf-8');
      });
      $('#xzip', f).onclick = () => {
        const z = zipStore(exportFiles(ex, S));
        downloadFile(`export-comptable-${ex.range.from.slice(0, 10)}_${ex.range.to.slice(0, 10)}.zip`, z, 'application/zip'); toast('Export téléchargé');
      };
    }
  });
}
