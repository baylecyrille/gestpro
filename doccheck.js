// Contrôles d'un devis / d'une facture / d'un avoir avant enregistrement.
// Fonction pure (aucun accès au navigateur ni à la base) : testable hors ligne.
//  - level « err »  : bloque l'enregistrement
//  - level « warn » : affiché avant l'enregistrement, qu'on peut accepter (mémorisé pour ne pas redemander à chaque fois)
import { docSums, isOpt, remOf, rateOf, reducedRates } from './vat.js';

const num = v => parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
const plain = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const eur = v => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const dayMs = 86400000;
const diffDays = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / dayMs);
const short = (s, n = 32) => { s = plain(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* doc : document avec ses lignes (déjà épuré), client : fiche du client, others : tous les documents, today : 'AAAA-MM-JJ' */
export function checkDoc(doc, { client = {}, others = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const R = [], add = (level, code, msg) => R.push({ level, code, msg });
  const isQ = doc.type === 'quote', isC = doc.type === 'credit';
  const lines = (doc.lines || []).filter(l => String(l.desig || '').trim() || num(l.pu));
  const counted = lines.filter(l => !isOpt(l));
  const t = docSums(doc);

  // --- Bloquant
  if (!doc.clientId) add('err', 'client', 'Choisissez un client');
  if (doc.number && others.some(d => d.id !== doc.id && d.type === doc.type && String(d.number) === String(doc.number)))
    add('err', 'dupnum', `Le numéro « ${doc.number} » est déjà utilisé par un autre document : changez-le ou laissez le champ vide pour une numérotation automatique.`);
  if (doc.disc && num(doc.disc.v) > 0 && doc.disc.t !== '€' && num(doc.disc.v) > 100) add('err', 'disc100', 'La remise sur le total dépasse 100 %.');

  // --- Lignes
  if (!counted.length) add('warn', 'nolines', lines.length ? 'Toutes les lignes sont en option : le total est à zéro.' : 'Le document ne contient aucune ligne.');
  else if (!isC && t.hasDep) { if (t.ttc < -0.005) add('warn', 'depover', `Les acomptes déjà facturés (${eur(t.depo.ttc)}) dépassent le total de la facture : le net est de ${eur(t.ttc)} (un avoir ou un remboursement est à prévoir).`); }
  else if (!isC && t.ttc <= 0) add('warn', 'total0', `Le total TTC est de ${eur(t.ttc)}.`);
  const noPrice = counted.filter(l => String(l.desig || '').trim() && !num(l.pu));
  if (noPrice.length) add('warn', 'noprice', `${noPrice.length === 1 ? 'Une ligne sans prix' : noPrice.length + ' lignes sans prix'} : « ${short(noPrice[0].desig)} »${noPrice.length > 1 ? ' …' : ''} (prix à 0 €).`);
  const noQty = counted.filter(l => num(l.pu) && !num(l.qty));
  if (noQty.length) add('warn', 'noqty', `Quantité à zéro sur ${noQty.length === 1 ? 'une ligne' : noQty.length + ' lignes'} : « ${short(noQty[0].desig || '(sans désignation)')} ».`);
  const noName = lines.filter(l => !String(l.desig || '').trim() && num(l.pu));
  if (noName.length) add('warn', 'noname', `${noName.length === 1 ? 'Une ligne a un prix' : noName.length + ' lignes ont un prix'} mais pas de désignation.`);
  const bigRem = lines.filter(l => remOf(l) >= 30);
  if (bigRem.length) add('warn', 'bigrem', `Remise de ${String(remOf(bigRem[0])).replace('.', ',')} % ou plus sur « ${short(bigRem[0].desig || '(sans désignation)')} » : vérifiez.`);
  if (doc.disc && doc.disc.t !== '€' && num(doc.disc.v) >= 30 && num(doc.disc.v) <= 100) add('warn', 'bigdisc', `Remise de ${String(num(doc.disc.v)).replace('.', ',')} % sur le total : vérifiez.`);
  if (doc.disc && doc.disc.t === '€' && num(doc.disc.v) > t.gross && t.gross > 0) add('warn', 'discover', `La remise (${eur(num(doc.disc.v))}) dépasse le total HT : elle est limitée à ${eur(t.gross)}.`);

  // --- Facture d'acompte : total des acomptes d'un devis ≤ montant du devis
  if (doc.deposit && doc.deposit.q) {
    const q = others.find(d => d.id === doc.deposit.q);
    if (q) {
      const qt = docSums(q).ttc, sib = others.filter(d => d.id !== doc.id && d.type === 'invoice' && d.deposit && d.deposit.q === q.id && d.status !== 'draft' && d.status !== 'cancelled');
      const total = sib.reduce((a, d) => a + docSums(d).ttc, 0) + t.ttc;
      if (total > qt + 0.02) add('warn', 'depexceed', `Les acomptes sur le devis ${q.number || ''} (${eur(total)} TTC) dépassent son montant (${eur(qt)} TTC).`);
    }
  }

  // --- Dates
  if (doc.date && diffDays(doc.date, today) > 30) add('warn', 'future', 'La date du document est dans plus de 30 jours.');
  if (isQ) {
    if (doc.validUntil && doc.date && doc.validUntil < doc.date) add('warn', 'validbefore', 'La validité du devis est antérieure à sa date.');
  } else if (!isC) {
    if (doc.dueDate && doc.date && doc.dueDate < doc.date) add('warn', 'duebefore', 'La date limite de règlement est antérieure à la date de la facture.');
  }

  // --- TVA
  if (!isQ && counted.some(l => rateOf(l, doc.tva) === 0)) add('warn', 'tva0', 'TVA à 0 % sur certaines lignes : vérifiez le motif (autoliquidation, exonération) et ajoutez la mention nécessaire.');
  if (!isC && doc.tvaRed === '0' && reducedRates(doc.lines, doc.tva).length) add('warn', 'redoff', 'Taux réduit utilisé alors que la mention du client est désactivée sur ce document.');

  // --- Client (facture / avoir : adresse nécessaire, notamment pour la facture électronique)
  if (!isQ && client && client.id && !(client.address && client.zip && client.city)) add('warn', 'addr', 'Adresse du client incomplète (rue, code postal, ville) : elle sera exigée sur la facture électronique.');

  return R;
}
