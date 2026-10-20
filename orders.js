// Commandes fournisseurs (N5) : bons de commande d'achat. Fonctions pures (testables hors navigateur).
// Une commande = { id, number 'BC-2026-001', date, expected (livraison souhaitée), supplierId, siteId (chantier à livrer, facultatif), status, note,
//   lines: [{ pid, qty, price (prix d'achat HT), recv (quantité déjà reçue) }], sentAt, recs: [{ date, bl, lines: [{ pid, qty, price }] }] }
// État : 'draft' (brouillon) → 'sent' (envoyée) → 'partial' (reçue en partie) → 'received' (reçue) ; 'cancelled' (annulée) à tout moment tant qu'elle n'est pas reçue.
import { num } from './util.js';
import { r2 } from './vat.js';
import { isStocked } from './plan.js';

export const STATUS = [['draft', 'Brouillon'], ['sent', 'Envoyée'], ['partial', 'Reçue en partie'], ['received', 'Reçue'], ['cancelled', 'Annulée']];
export const STATUS_LABEL = Object.fromEntries(STATUS);
export const PENDING = ['draft', 'sent', 'partial']; // commandes dont la marchandise est attendue (ou en préparation)

const pad3 = n => String(n).padStart(3, '0');
/* Prochain numéro : BC-aaaa-001, 002… (le plus grand numéro de l'année + 1, calculé sur les commandes existantes, y compris annulées) */
export function nextNumber(orders, date) {
  const y = String(date || '').slice(0, 4) || String(new Date().getFullYear()), pre = `BC-${y}-`;
  let max = 0;
  for (const o of orders || []) if (String(o.number || '').startsWith(pre)) max = Math.max(max, parseInt(String(o.number).slice(pre.length), 10) || 0);
  return pre + pad3(max + 1);
}

export const lineTotal = l => r2(num(l.qty) * num(l.price));
export const orderTotal = o => r2((o.lines || []).reduce((a, l) => a + lineTotal(l), 0));
export const pendingQty = l => Math.max(0, r2(num(l.qty) - num(l.recv)));
export const isPending = o => PENDING.includes(o.status);
/* Quantités attendues par produit (commandes en préparation, envoyées ou reçues en partie) : Map pid → quantité restant à recevoir */
export function onOrder(orders) {
  const m = new Map();
  for (const o of orders || []) if (isPending(o)) for (const l of o.lines || []) if (l.pid) { const q = pendingQty(l); if (q > 0) m.set(l.pid, r2((m.get(l.pid) || 0) + q)); }
  return m;
}
/* Commande envoyée dont la livraison souhaitée est dépassée */
export const isLate = (o, today) => (o.status === 'sent' || o.status === 'partial') && !!o.expected && o.expected < today && o.lines.some(l => pendingQty(l) > 0);

/* À commander : produits sous leur seuil d'alerte (même définition que l'écran Stock) ou dont le stock ne couvre pas le matériel réservé par les devis signés.
   Quantité proposée = de quoi couvrir le réservé et remonter au seuil, moins ce qui est déjà commandé. Modifiable ensuite.
   resv : Map pid → { reserved } (plan.reservations) ; totalOf : produit → stock total. */
export function suggest({ products = [], resv = new Map(), orders = [], totalOf }) {
  const pend = onOrder(orders), out = [];
  for (const p of products) {
    if (!isStocked(p)) continue;
    const stock = num(totalOf(p)), min = num(p.min), reserved = (resv.get(p.id) || {}).reserved || 0;
    const short = Math.max(0, r2(reserved - stock)), low = min > 0 && stock <= min;
    if (!short && !low) continue;
    let need = r2(Math.max(0, reserved + min - stock));
    if (!(need > 0)) need = min > 0 ? min : 1;
    const ordered = pend.get(p.id) || 0, qty = r2(need - ordered);
    out.push({ p, qty: qty > 0 ? qty : 0, need, ordered, stock, min, reserved, short, low, supplierId: p.supplierId || '' });
  }
  return out.sort((a, b) => String(a.p.name).localeCompare(String(b.p.name), 'fr'));
}
/* Regroupe des suggestions par fournisseur : [{ supplierId, items }] (les produits sans fournisseur à la fin) */
export function bySupplier(items, nameOf = x => x) {
  const m = new Map();
  for (const it of items) { const k = it.supplierId || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return [...m.entries()].map(([supplierId, list]) => ({ supplierId, items: list })).sort((a, b) => (a.supplierId === '') - (b.supplierId === '') || String(nameOf(a.supplierId)).localeCompare(String(nameOf(b.supplierId)), 'fr'));
}

/* Contrôle avant enregistrement → { lines (nettoyées), error } */
export function checkLines(lines) {
  const out = [];
  for (const l of lines || []) {
    if (!l.pid) continue;
    const qty = num(l.qty);
    if (!(qty > 0)) continue; // ligne sans quantité : ignorée
    const price = l.price === '' || l.price == null ? 0 : num(l.price);
    if (price < 0) return { lines: [], error: 'Un prix d\'achat est négatif.' };
    out.push({ pid: l.pid, qty: r2(qty), price: r2(price), recv: r2(num(l.recv)) });
  }
  return { lines: out, error: out.length ? '' : 'Ajoutez au moins un produit avec une quantité.' };
}

/* Réception d'une commande : ajoute les quantités reçues et recalcule l'état. items : [{ pid, qty, price }] ; opts : { date, bl } → nouvelle commande */
export function receive(order, items, { date = '', bl = '' } = {}) {
  const lines = order.lines.map(l => ({ ...l }));
  const got = [];
  for (const it of items || []) {
    let q = num(it.qty); if (!(q > 0)) continue;
    got.push({ pid: it.pid, qty: r2(q), price: num(it.price) });
    for (const l of lines) { // d'abord sur les lignes où il reste à recevoir, le surplus sur la dernière ligne du produit
      if (l.pid !== it.pid || q <= 0) continue;
      const take = Math.min(q, pendingQty(l)); l.recv = r2(num(l.recv) + take); q = r2(q - take);
    }
    if (q > 0) { const last = [...lines].reverse().find(l => l.pid === it.pid); if (last) last.recv = r2(num(last.recv) + q); }
  }
  const all = lines.every(l => pendingQty(l) <= 0), some = lines.some(l => num(l.recv) > 0);
  return { ...order, lines, status: all ? 'received' : some ? 'partial' : order.status, recs: [...(order.recs || []), { date, bl, lines: got }] };
}

/* Texte de la commande pour un e-mail (sans pièce jointe : rien n'est envoyé ailleurs que par la messagerie de la personne) */
export function mailText(o, { supplier = {}, products = {}, S = {}, site = null, dateFr = x => x, eur = x => String(x) } = {}) {
  const P = id => (products instanceof Map ? products.get(id) : products[id]) || {};
  const rows = o.lines.map(l => { const p = P(l.pid); return `- ${l.qty} ${p.unit || 'u'} · ${p.name || 'Produit'}${p.ref ? ' (réf. ' + p.ref + ')' : ''}${num(l.price) > 0 ? ' · ' + eur(num(l.price)) + ' HT' : ''}`; });
  const lines = [`Bonjour${supplier.company ? ' ' + supplier.company : ''},`, '', `Voici notre commande n° ${o.number} du ${dateFr(o.date)} :`, '', ...rows, ''];
  if (orderTotal(o) > 0) lines.push(`Total HT : ${eur(orderTotal(o))}`, '');
  if (o.expected) lines.push(`Livraison souhaitée le ${dateFr(o.expected)}${site ? ' – chantier ' + site.name + (site.address ? ' (' + site.address + ')' : '') : ''}.`);
  else if (site) lines.push(`Livraison : chantier ${site.name}${site.address ? ' (' + site.address + ')' : ''}.`);
  if (o.note) lines.push('', o.note);
  lines.push('', 'Merci de nous confirmer la disponibilité et le délai.', '', 'Cordialement,', S.owner || S.company || '');
  return { subject: `Commande ${o.number}${S.company ? ' – ' + S.company : ''}`, body: lines.join('\n') };
}
