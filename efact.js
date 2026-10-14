// Facturation électronique (réforme France 2026-2027) : mentions obligatoires, contrôle avant envoi, XML Factur-X (profil EN 16931).
// Fonctions pures (sans accès au navigateur) : testables hors ligne.
import { rateOf, sums, reducedRates, isOpt, grossHt, lineDisc, lineHt, remOf, depsOf, depTva } from './vat.js';
const num = v => parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const xe = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const OPS = { goods: 'Livraison de biens', services: 'Prestation de services', mixed: 'Livraison de biens et prestation de services' };
export const digits = s => String(s || '').replace(/\D/g, '');
export const sirenOf = s => digits(s).slice(0, 9);
export const tvaKey = siren => String((12 + 3 * (parseInt(siren, 10) % 97)) % 97).padStart(2, '0');
/* N° de TVA intracommunautaire : saisi dans Réglages, sinon calculé d'après le SIREN (France) */
export const tvaIntra = S => {
  const t = String(S.tvaNum || '').replace(/\s/g, '').toUpperCase();
  if (t) return t;
  const si = sirenOf(S.siret);
  return si.length === 9 ? 'FR' + tvaKey(si) + si : '';
};
export const opOf = (doc, S) => (OPS[doc.opType] ? doc.opType : OPS[S.opType] ? S.opType : 'mixed');
export const vatDebitsOf = (doc, S) => (doc.vatDebits === true || doc.vatDebits === '1' ? true : doc.vatDebits === false || doc.vatDebits === '0' ? false : !!S.vatDebits);

/* Mentions à imprimer sur les factures et avoirs */
export function mentions(doc, S) {
  if (doc.type === 'quote') return [];
  const out = [`Nature de l'opération : ${OPS[opOf(doc, S)].toLowerCase()}`];
  if (String(doc.deliveryAddr || '').trim()) out.push('Adresse de livraison : ' + String(doc.deliveryAddr).trim().replace(/\s*\n\s*/g, ', '));
  if (vatDebitsOf(doc, S)) out.push('TVA acquittée sur les débits');
  return out;
}

export const NOTES = {
  PMD: 'Taux des pénalités de retard : trois fois le taux d\'intérêt légal, exigibles sans rappel à compter de la date d\'échéance.',
  PMT: 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € (article D.441-5 du Code de commerce).',
  AAB: 'Escompte pour paiement anticipé : néant.'
};

const UNIT = { u: 'C62', m: 'MTR', ml: 'MTR', 'm²': 'MTK', 'm³': 'MTQ', kg: 'KGM', L: 'LTR', lot: 'C62', h: 'HUR', forfait: 'C62' };
const cname = c => [c?.civ, c?.name].filter(Boolean).join(' ').trim() || c?.company || '';

/* « 6 rue X\n87360 LUSSAC » → { line1, line2, zip, city } */
export function splitAddress(txt, zipHint, cityHint) {
  const rows = String(txt || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  let zip = zipHint || '', city = cityHint || '';
  const zi = rows.findIndex(r => /^\d{5}\s+\S+/.test(r));
  if (zi >= 0) { const m = rows[zi].match(/^(\d{5})\s+(.+)$/); zip = zip || m[1]; city = city || m[2]; rows.splice(zi, 1); }
  return { line1: rows[0] || '', line2: rows.slice(1).join(', '), zip, city };
}

/* Modèle unique de la facture (utilisé par le XML et le PDF) */
export function model(doc, S, client = {}, opts = {}) {
  const src = (doc.lines || []).filter(l => !isOpt(l) && (String(l.desig || '').trim() || num(l.pu)));
  const lines = src.map((l, i) => {
    const rate = rateOf(l, doc.tva);
    return { n: i + 1, name: String(l.desig || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'Article', qty: num(l.qty) || 0, unit: l.unit || 'u', unitCode: UNIT[l.unit] || 'C62', pu: Math.round(num(l.pu) * 10000) / 10000, gross: grossHt(l), rem: remOf(l), allow: lineDisc(l), total: lineHt(l), rate, cat: rate > 0 ? 'S' : 'Z' };
  });
  // Ventilation par taux (BG-23) : un groupe par taux utilisé, même à base nulle ; la remise sur le total est répartie par taux (BG-20)
  const deps = depsOf(doc), isC = doc.type === 'credit';
  const T = sums(src, doc.tva, doc.disc, true, deps);
  // Facture finale (et avoir qui la reprend) : montants de l'opération complète, les acomptes déjà facturés étant un « montant payé d'avance » (BT-113)
  // avec renvoi aux factures d'acompte (BG-3) : les lignes, la base de TVA et les totaux restent cohérents (règles BR-S-08, BR-CO-13).
  const full = T.hasDep;
  const taxes = T.rates.map(x => ({ rate: x.rate, cat: x.rate > 0 ? 'S' : 'Z', basis: full ? x.ht0 : x.ht, amount: full ? x.tva0 : x.tva, gross: x.gross, allow: x.disc }));
  const ht = full ? T.full.ht : T.ht, tva = full ? T.full.tva : T.tva, ttc = full ? T.full.ttc : T.ttc, lineTotal = T.gross, allowTotal = T.disc;
  const discPct = doc.disc && doc.disc.t !== '€' ? Math.min(100, num(doc.disc.v)) : 0;
  const prior = full ? deps.map(d => { const h = r2((d.rates || []).reduce((a, x) => a + num(x.ht), 0)), v = r2((d.rates || []).reduce((a, x) => a + depTva(x), 0)); return { number: d.number || '', date: d.date || '', ht: h, tva: v, ttc: r2(h + v) }; }) : [];
  const prepaid = r2((opts.paid || 0) + prior.reduce((a, p) => a + p.ttc, 0));
  const co = splitAddress(S.address); if (!co.city) co.city = S.city || '';
  const cl = splitAddress([client.address, [client.zip, client.city].filter(Boolean).join(' ')].filter(Boolean).join('\n'), client.zip, client.city);
  return {
    isCredit: isC, deposit: !isC && !!doc.deposit, prior, typeCode: isC ? '381' : doc.deposit ? '386' : '380', number: doc.number || '', date: doc.date || '', due: doc.dueDate || '', currency: 'EUR',
    lines, taxes, ht, tva, ttc, lineTotal, allowTotal, discPct, prepaid, due_amount: r2(ttc - prepaid), vatNote: String(opts.vatNote || '').trim(),
    seller: { name: S.company || '', siren: sirenOf(S.siret), siret: digits(S.siret), vat: tvaIntra(S), addr: co, email: S.email || '', phone: S.phone || '' },
    buyer: { name: cname(client) || 'Client', siren: sirenOf(client.siret), siret: digits(client.siret), addr: cl, email: client.email || '' },
    delivery: String(doc.deliveryAddr || '').trim() ? splitAddress(doc.deliveryAddr) : null,
    op: opOf(doc, S), vatDebits: vatDebitsOf(doc, S), iban: String(S.iban || '').replace(/\s/g, ''), bic: String(S.bic || '').replace(/\s/g, ''),
    terms: String(doc.terms || '').replace(/\s*\n\s*/g, ' ').trim(), ref: doc.number || '', fromInvoiceNumber: opts.fromInvoiceNumber || '', fromInvoiceDate: opts.fromInvoiceDate || '', notes: String(opts.note || '').trim(),
    siteRef: doc.siteRef || ''
  };
}

/* ---------- Contrôle avant envoi ---------- */
export function check(doc, S, client = {}, opts = {}) {
  const R = [], add = (level, msg, fix = '') => R.push({ level, msg, fix });
  const m = model(doc, S, client, opts);
  // Émetteur
  if (!S.company) add('err', 'Nom de l\'entreprise manquant', 'Réglages › Entreprise');
  if (!m.seller.addr.line1 || !m.seller.addr.zip || !m.seller.addr.city) add('err', 'Adresse de l\'entreprise incomplète (rue, code postal, ville)', 'Réglages › Entreprise');
  if (m.seller.siren.length !== 9) add('err', 'SIREN / SIRET de l\'entreprise manquant ou incorrect', 'Réglages › Entreprise');
  else if (!tvaIntra(S)) add('warn', 'N° de TVA intracommunautaire non renseigné');
  else if (!S.tvaNum) add('info', `N° de TVA calculé d'après le SIREN : ${tvaIntra(S)} (à vérifier, ou à saisir dans Réglages)`);
  // Facture
  if (!doc.number) add('err', 'Numéro de facture manquant (enregistrez la facture hors brouillon)');
  if (!doc.date) add('err', 'Date de facture manquante');
  if (doc.type === 'invoice' && !doc.dueDate) add('warn', 'Date limite de règlement non renseignée');
  if (!m.lines.length) add('err', 'Aucune ligne dans le document');
  m.lines.forEach(l => { if (!(l.qty > 0)) add('warn', `Ligne ${l.n} « ${l.name.slice(0, 30)} » : quantité nulle ou négative`); });
  if (m.taxes.some(x => x.rate === 0)) add('warn', 'TVA à 0 % sur certaines lignes : le motif d\'exonération ou l\'autoliquidation (sous-traitance) n\'est pas géré, le fichier est marqué « taux zéro »');
  if (m.taxes.length > 1) add('ok', 'Plusieurs taux de TVA : ' + m.taxes.map(x => String(x.rate).replace('.', ',') + ' %').join(', ') + ' (ventilés dans le fichier)');
  if (doc.type !== 'quote' && doc.type !== 'credit' && reducedRates(doc.lines, doc.tva).length) {
    if (m.vatNote) add('ok', 'Mention du client pour la TVA à taux réduit imprimée');
    else add('warn', 'Taux réduit utilisé sans la mention du client (attestation) : ajoutez-la sur la facture, ou assurez-vous qu\'elle figure sur le devis signé');
  }
  if ((doc.lines || []).some(isOpt)) add('info', 'Lignes en option : non comptées, absentes du fichier');
  if (m.allowTotal) add('ok', 'Remise sur le total ' + (m.taxes.length > 1 ? 'répartie entre les taux de TVA' : 'indiquée dans le fichier') + ' (' + m.allowTotal.toFixed(2).replace('.', ',') + ' € HT)');
  if (doc.type === 'credit' && !opts.fromInvoiceNumber) add('warn', 'Avoir sans facture d\'origine rattachée');
  if (m.deposit) add('info', 'Facture d\'acompte (type 386) : elle sera déduite de la facture finale, avec renvoi à ce numéro');
  if (m.prior.length) {
    add('ok', `Acomptes déjà facturés déduits : ${m.prior.map(p => p.number || '(sans n°)').join(', ')} (${m.prior.reduce((a, p) => a + p.ttc, 0).toFixed(2).replace('.', ',')} € TTC) – indiqués comme « montant payé d'avance » avec renvoi aux factures d'acompte`);
    if (m.prior.some(p => !p.number)) add('err', 'Une facture d\'acompte déduite n\'a pas de numéro');
    if (m.due_amount < -0.005) add('warn', 'Les acomptes dépassent le total de la facture : un avoir ou un remboursement est à prévoir');
  }
  // Client
  if (!client || !client.id) add('err', 'Client non renseigné');
  else {
    if (!cname(client)) add('err', 'Nom du client manquant');
    if (!m.buyer.addr.line1 || !m.buyer.addr.zip || !m.buyer.addr.city) add('err', 'Adresse du client incomplète (rue, code postal, ville)', 'Contacts › fiche client');
    if (m.buyer.siren.length === 9) add('ok', `Client professionnel (SIREN ${m.buyer.siren}) : facture électronique à transmettre via la plateforme agréée`);
    else add('info', 'Client sans SIREN : considéré comme un particulier. Pas de facture électronique à lui envoyer, mais la vente est à déclarer (« e-reporting ») via la plateforme à partir de septembre 2027');
  }
  // Mentions
  add('ok', 'Nature de l\'opération : ' + OPS[m.op].toLowerCase());
  if (doc.type !== 'quote' && !String(doc.deliveryAddr || '').trim() && !doc.siteAddr) add('info', 'Adresse de livraison / de chantier non renseignée (obligatoire si elle diffère de celle du client)');
  if (m.vatDebits) add('ok', 'Mention « TVA acquittée sur les débits » imprimée');
  if (!m.iban && doc.type === 'invoice') add('info', 'IBAN non renseigné : le virement n\'est pas indiqué (Réglages)');
  return R;
}

/* ---------- XML Factur-X, profil EN 16931 ---------- */
const d102 = iso => String(iso || '').replace(/-/g, '').slice(0, 8);
const amt = v => r2(v).toFixed(2);
const party = (p, withVat) => `<ram:Name>${xe(p.name)}</ram:Name>${p.siren.length === 9 ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${p.siren}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress><ram:PostcodeCode>${xe(p.addr.zip)}</ram:PostcodeCode><ram:LineOne>${xe(p.addr.line1 || '-')}</ram:LineOne>${p.addr.line2 ? `<ram:LineTwo>${xe(p.addr.line2)}</ram:LineTwo>` : ''}<ram:CityName>${xe(p.addr.city)}</ram:CityName><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>${p.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${xe(p.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}${withVat && p.vat ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xe(p.vat)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}`;

export function facturxXml(m) {
  const notes = [];
  notes.push(`Nature de l'opération : ${OPS[m.op].toLowerCase()}`);
  if (m.vatDebits) notes.push('TVA acquittée sur les débits');
  if (m.notes) notes.push(m.notes);
  const vatNote = m.vatNote ? m.vatNote.replace(/\s*\n\s*/g, ' ') : '';
  const note = (content, code) => `<ram:IncludedNote><ram:Content>${xe(content)}</ram:Content>${code ? `<ram:SubjectCode>${code}</ram:SubjectCode>` : ''}</ram:IncludedNote>`;
  const sellerEmail = m.seller.email;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${xe(m.number)}</ram:ID>
    <ram:TypeCode>${m.typeCode}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d102(m.date)}</udt:DateTimeString></ram:IssueDateTime>
    ${notes.map(n => note(n, 'AAI')).join('\n    ')}${vatNote ? `
    ${note(vatNote, 'REG')}` : ''}
    ${note(NOTES.PMD, 'PMD')}
    ${note(NOTES.PMT, 'PMT')}
    ${note(NOTES.AAB, 'AAB')}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${m.lines.map(l => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${l.n}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${xe(l.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${l.pu.toFixed(4).replace(/0{1,2}$/, '')}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${l.unitCode}">${l.qty}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${l.cat}</ram:CategoryCode><ram:RateApplicablePercent>${l.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>${l.allow ? `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:CalculationPercent>${l.rem}</ram:CalculationPercent><ram:BasisAmount>${amt(l.gross)}</ram:BasisAmount><ram:ActualAmount>${amt(l.allow)}</ram:ActualAmount><ram:ReasonCode>95</ram:ReasonCode><ram:Reason>Remise</ram:Reason></ram:SpecifiedTradeAllowanceCharge>` : ''}<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(l.total)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('\n')}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        ${party({ ...m.seller, email: sellerEmail }, true)}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        ${party({ ...m.buyer, vat: '' }, false)}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>${m.delivery ? `
      <ram:ShipToTradeParty><ram:Name>${xe(m.buyer.name)}</ram:Name><ram:PostalTradeAddress><ram:PostcodeCode>${xe(m.delivery.zip)}</ram:PostcodeCode><ram:LineOne>${xe(m.delivery.line1 || '-')}</ram:LineOne>${m.delivery.line2 ? `<ram:LineTwo>${xe(m.delivery.line2)}</ram:LineTwo>` : ''}<ram:CityName>${xe(m.delivery.city)}</ram:CityName><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress></ram:ShipToTradeParty>` : ''}
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${xe(m.number)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>${m.iban ? '58' : '1'}</ram:TypeCode>${m.iban ? `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${xe(m.iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${m.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${xe(m.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}` : ''}</ram:SpecifiedTradeSettlementPaymentMeans>
${m.taxes.map(x => `      <ram:ApplicableTradeTax><ram:CalculatedAmount>${amt(x.amount)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${amt(x.basis)}</ram:BasisAmount><ram:CategoryCode>${x.cat}</ram:CategoryCode><ram:RateApplicablePercent>${x.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`).join('\n')}${m.taxes.filter(x => x.allow).map(x => `
      <ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>${m.discPct && r2(x.gross * m.discPct / 100) === x.allow ? `<ram:CalculationPercent>${m.discPct}</ram:CalculationPercent><ram:BasisAmount>${amt(x.gross)}</ram:BasisAmount>` : ''}<ram:ActualAmount>${amt(x.allow)}</ram:ActualAmount><ram:ReasonCode>95</ram:ReasonCode><ram:Reason>Remise</ram:Reason><ram:CategoryTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${x.cat}</ram:CategoryCode><ram:RateApplicablePercent>${x.rate}</ram:RateApplicablePercent></ram:CategoryTradeTax></ram:SpecifiedTradeAllowanceCharge>`).join('')}
      ${m.terms || m.due ? `<ram:SpecifiedTradePaymentTerms>${m.terms ? `<ram:Description>${xe(m.terms.slice(0, 500))}</ram:Description>` : ''}${m.due ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${d102(m.due)}</udt:DateTimeString></ram:DueDateDateTime>` : ''}</ram:SpecifiedTradePaymentTerms>` : ''}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amt(m.lineTotal)}</ram:LineTotalAmount>${m.allowTotal ? `
        <ram:AllowanceTotalAmount>${amt(m.allowTotal)}</ram:AllowanceTotalAmount>` : ''}
        <ram:TaxBasisTotalAmount>${amt(m.ht)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${amt(m.tva)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amt(m.ttc)}</ram:GrandTotalAmount>${m.prepaid > 0 ? `
        <ram:TotalPrepaidAmount>${amt(m.prepaid)}</ram:TotalPrepaidAmount>` : ''}
        <ram:DuePayableAmount>${amt(m.due_amount)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>${m.isCredit && m.fromInvoiceNumber ? `
      <ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${xe(m.fromInvoiceNumber)}</ram:IssuerAssignedID>${m.fromInvoiceDate ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(m.fromInvoiceDate)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ''}</ram:InvoiceReferencedDocument>` : ''}${m.prior.map(p => `
      <ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${xe(p.number)}</ram:IssuerAssignedID>${p.date ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(p.date)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ''}</ram:InvoiceReferencedDocument>`).join('')}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
