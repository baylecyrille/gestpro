// Lecture d'une facture électronique reçue (N3) : XML Factur-X / ZUGFeRD (CII, profil EN 16931) ou UBL, seul ou joint à un PDF.
// 100 % local : le fichier n'est ni envoyé ni enregistré. Rend la même forme que parseSupplierInvoice (supplier-parse.js),
// pour passer par l'écran de contrôle habituel de l'import fournisseur. Fonctions testables hors navigateur (DOMParser passé en paramètre).
import { docType } from './supplier-layout.js';

const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const nb = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const digits = s => String(s || '').replace(/\D/g, '');

/* Unités UN/ECE → unités de l'application */
const UNECE = { C62: 'u', H87: 'u', EA: 'u', PCE: 'u', NAR: 'u', MTR: 'm', LM: 'ml', MTK: 'm²', MTQ: 'm³', KGM: 'kg', LTR: 'L', HUR: 'h', LS: 'forfait', SET: 'lot', XPK: 'lot', XBX: 'lot', XPP: 'u' };
export const unitOf = code => UNECE[String(code || '').toUpperCase()] || 'u';

/* Navigation par nom local (indifférent aux préfixes d'espace de noms) */
const kids = (n, name) => (n ? [...n.children].filter(c => c.localName === name) : []);
const kid = (n, name) => kids(n, name)[0] || null;
const at = (n, ...names) => names.reduce((a, nm) => (a ? kid(a, nm) : null), n);
const tx = n => (n && n.textContent ? n.textContent.trim() : '');
const txAt = (n, ...names) => tx(at(n, ...names));
/* Date CII (format 102 : aaaammjj) ou ISO → « jj/mm/aaaa » (forme utilisée par l'import PDF) */
const dmy = s => { const t = String(s || '').trim(); let m = t.match(/^(\d{4})(\d\d)(\d\d)$/) || t.match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

/* Décode des octets XML selon leur déclaration d'encodage (UTF-8 par défaut) */
export function decodeXml(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200)), enc = (head.match(/encoding=["']([\w-]+)["']/i) || [])[1] || 'utf-8';
  try { return new TextDecoder(enc).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

/* Parmi les pièces jointes d'un PDF (pdf.js getAttachments) : le XML de facture électronique, s'il y en a un */
export function pickXml(att) {
  const list = Object.values(att || {}).filter(a => a && a.content && /\.xml$/i.test(a.filename || ''));
  const pref = list.find(a => /factur-?x|zugferd|xrechnung|cii|invoice/i.test(a.filename)) || list[0];
  return pref ? decodeXml(pref.content) : '';
}

function party(p) {
  const S = {};
  if (!p) return S;
  S.name = txAt(p, 'Name') || txAt(p, 'PartyLegalEntity', 'RegistrationName') || txAt(p, 'PartyName', 'Name');
  const ids = [...kids(p, 'SpecifiedLegalOrganization').flatMap(o => kids(o, 'ID')), ...kids(p, 'PartyLegalEntity').flatMap(o => kids(o, 'CompanyID')), ...kids(p, 'PartyIdentification').flatMap(o => kids(o, 'ID'))].map(n => digits(tx(n))).filter(Boolean);
  S.siret = ids.find(x => x.length === 14) || ids.find(x => x.length === 9) || '';
  const tax = [...kids(p, 'SpecifiedTaxRegistration').flatMap(o => kids(o, 'ID')), ...kids(p, 'PartyTaxScheme').flatMap(o => kids(o, 'CompanyID'))].map(tx).find(v => /^[A-Z]{2}[\dA-Z]{8,13}$/i.test(v.replace(/\s/g, '')));
  S.tva = tax ? tax.replace(/\s/g, '').toUpperCase() : '';
  const ad = kid(p, 'PostalTradeAddress') || kid(p, 'PostalAddress');
  if (ad) {
    S.zip = txAt(ad, 'PostcodeCode') || txAt(ad, 'PostalZone'); S.city = txAt(ad, 'CityName');
    S.address = [txAt(ad, 'LineOne') || txAt(ad, 'StreetName'), txAt(ad, 'LineTwo') || txAt(ad, 'AdditionalStreetName'), txAt(ad, 'LineThree')].filter(Boolean).join(', ');
  }
  const ct = kid(p, 'DefinedTradeContact') || kid(p, 'Contact');
  S.contact = ct ? (txAt(ct, 'PersonName') || txAt(ct, 'Name')) : '';
  S.phone = ct ? (txAt(ct, 'TelephoneUniversalCommunication', 'CompleteNumber') || txAt(ct, 'Telephone')) : '';
  S.email = (ct && (txAt(ct, 'EmailURIUniversalCommunication', 'URIID') || txAt(ct, 'ElectronicMail'))) || kids(p, 'URIUniversalCommunication').map(n => txAt(n, 'URIID')).find(v => /@/.test(v)) || txAt(p, 'EndpointID') || '';
  if (!/@/.test(S.email)) S.email = '';
  return S;
}

function cii(root) {
  const doc = kid(root, 'ExchangedDocument'), trx = kid(root, 'SupplyChainTradeTransaction');
  if (!trx) return null;
  const head = kid(trx, 'ApplicableHeaderTradeAgreement'), set = kid(trx, 'ApplicableHeaderTradeSettlement');
  const items = kids(trx, 'IncludedSupplyChainTradeLineItem').map((li, i) => {
    const prod = kid(li, 'SpecifiedTradeProduct'), agr = kid(li, 'SpecifiedLineTradeAgreement'), del = kid(li, 'SpecifiedLineTradeDelivery'), st = kid(li, 'SpecifiedLineTradeSettlement');
    const q = at(del, 'BilledQuantity'), qty = nb(tx(q)), net = at(agr, 'NetPriceProductTradePrice'), basis = nb(txAt(net, 'BasisQuantity')) || 1;
    const amount = nb(txAt(st, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'));
    let price = nb(txAt(net, 'ChargeAmount')) / basis;
    if (!Number.isFinite(price)) price = Number.isFinite(amount) && qty ? amount / qty : 0;
    if (Number.isFinite(amount) && qty && Math.abs(qty * price - amount) > 0.02) price = r2(amount / qty * 10000) / 10000; // remise de ligne : prix net déduit du total de la ligne
    const tva = nb(txAt(st, 'ApplicableTradeTax', 'RateApplicablePercent'));
    const name = txAt(prod, 'Name') || txAt(prod, 'Description');
    return { n: i + 1, ref: txAt(prod, 'SellerAssignedID') || txAt(prod, 'GlobalID'), name, qty: Number.isFinite(qty) ? qty : 0, unit: q ? (q.getAttribute('unitCode') || '') : '', unitMapped: unitOf(q && q.getAttribute('unitCode')), price: r2(price * 10000) / 10000, amount: Number.isFinite(amount) ? amount : r2(price * (qty || 0)), tva: Number.isFinite(tva) ? tva : 20, cmd: '' };
  });
  const fees = kids(set, 'SpecifiedTradeAllowanceCharge').map(a => {
    const charge = /^true$/i.test(txAt(a, 'ChargeIndicator', 'Indicator')), amt = nb(txAt(a, 'ActualAmount'));
    return Number.isFinite(amt) ? { label: txAt(a, 'Reason') || (charge ? 'Frais' : 'Remise'), amount: charge ? amt : -amt } : null;
  }).filter(Boolean);
  const sum = at(set, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const terms = kids(set, 'SpecifiedTradePaymentTerms')[0];
  return {
    type: txAt(doc, 'TypeCode'), number: txAt(doc, 'ID'), date: txAt(doc, 'IssueDateTime', 'DateTimeString'), due: terms ? txAt(terms, 'DueDateDateTime', 'DateTimeString') : '', terms: terms ? txAt(terms, 'Description') : '',
    seller: party(at(head, 'SellerTradeParty')), cmd: txAt(head, 'BuyerOrderReferencedDocument', 'IssuerAssignedID'), items, fees,
    totals: { ht0: nb(txAt(sum, 'LineTotalAmount')), ht: nb(txAt(sum, 'TaxBasisTotalAmount')), tva: nb(txAt(sum, 'TaxTotalAmount')), ttc: nb(txAt(sum, 'GrandTotalAmount')) }
  };
}

function ubl(root) {
  const credit = root.localName === 'CreditNote';
  const items = kids(root, credit ? 'CreditNoteLine' : 'InvoiceLine').map((li, i) => {
    const q = kid(li, credit ? 'CreditedQuantity' : 'InvoicedQuantity'), qty = nb(tx(q)), item = kid(li, 'Item'), pr = kid(li, 'Price');
    const amount = nb(txAt(li, 'LineExtensionAmount')), basis = nb(txAt(pr, 'BaseQuantity')) || 1;
    let price = nb(txAt(pr, 'PriceAmount')) / basis;
    if (!Number.isFinite(price)) price = Number.isFinite(amount) && qty ? amount / qty : 0;
    if (Number.isFinite(amount) && qty && Math.abs(qty * price - amount) > 0.02) price = r2(amount / qty * 10000) / 10000;
    const tva = nb(txAt(item, 'ClassifiedTaxCategory', 'Percent'));
    return { n: i + 1, ref: txAt(item, 'SellersItemIdentification', 'ID'), name: txAt(item, 'Name') || txAt(item, 'Description'), qty: Number.isFinite(qty) ? qty : 0, unit: q ? (q.getAttribute('unitCode') || '') : '', unitMapped: unitOf(q && q.getAttribute('unitCode')), price: r2(price * 10000) / 10000, amount: Number.isFinite(amount) ? amount : r2(price * (qty || 0)), tva: Number.isFinite(tva) ? tva : 20, cmd: '' };
  });
  const fees = kids(root, 'AllowanceCharge').map(a => {
    const charge = /^true$/i.test(txAt(a, 'ChargeIndicator')), amt = nb(txAt(a, 'Amount'));
    return Number.isFinite(amt) ? { label: txAt(a, 'AllowanceChargeReason') || (charge ? 'Frais' : 'Remise'), amount: charge ? amt : -amt } : null;
  }).filter(Boolean);
  const mt = kid(root, 'LegalMonetaryTotal');
  return {
    type: credit ? '381' : txAt(root, 'InvoiceTypeCode'), number: txAt(root, 'ID'), date: txAt(root, 'IssueDate'), due: txAt(root, 'DueDate') || txAt(root, 'PaymentMeans', 'PaymentDueDate'), terms: txAt(root, 'PaymentTerms', 'Note'),
    seller: party(at(root, 'AccountingSupplierParty', 'Party')), cmd: txAt(root, 'OrderReference', 'ID'), items, fees,
    totals: { ht0: nb(txAt(mt, 'LineExtensionAmount')), ht: nb(txAt(mt, 'TaxExclusiveAmount')), tva: nb(txAt(root, 'TaxTotal', 'TaxAmount')), ttc: nb(txAt(mt, 'TaxInclusiveAmount')) }
  };
}

/* XML → résultat prêt pour l'écran de contrôle de l'import fournisseur, ou null si ce n'est pas une facture électronique reconnue */
export function parseEInvoice(xml, parser) {
  const P = parser || new DOMParser();
  let doc; try { doc = P.parseFromString(String(xml || '').replace(/^﻿/, ''), 'application/xml'); } catch { return null; }
  const root = doc && doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length) return null;
  let x = null;
  if (root.localName === 'CrossIndustryInvoice') x = cii(root);
  else if (root.localName === 'Invoice' || root.localName === 'CreditNote') x = ubl(root);
  if (!x || !x.items.length) return null;
  const isCredit = ['381', '261', '262', '296', '308', '396'].includes(String(x.type));
  const sum = r2(x.items.reduce((a, i) => a + (i.amount || 0), 0));
  x.items.forEach(i => { i.cmd = x.cmd || ''; });
  const t = x.totals;
  return {
    mode: 'factur-x', einvoice: true, docType: docType(isCredit ? 'avoir' : 'facture'),
    supplier: x.seller, invoice: { number: x.number, date: dmy(x.date), due: dmy(x.due), terms: x.terms, iso: d => (d ? d.split('/').reverse().join('-') : '') },
    items: x.items, fees: x.fees, totals: t, sum,
    sumOk: Number.isFinite(t.ht0) ? Math.abs(sum - t.ht0) < 0.05 : null
  };
}
