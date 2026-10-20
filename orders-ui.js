// Stock › Commandes : commandes fournisseurs (N5) — à commander, bon de commande imprimable, e-mail, réception liée à la commande.
import * as db from './db.js';
import { e, eur, num, dateFr, today, F, modal, closeModal, toast, refresh, $, $$ } from './util.js';
import { getS, logoSrc } from './defaults.js';
import { total, lineEditor, receptionModal } from './stock.js';
import { reservations, isStocked } from './plan.js';
import * as O from './orders.js';
import { alertBox, confirmBox } from './dialogs.js';

const qtyTxt = q => String(Math.round(num(q) * 1000) / 1000).replace('.', ',');
const chipOf = o => ({ draft: '', sent: 'warn', partial: 'warn', received: 'ok', cancelled: '' })[o.status] || '';

/* ---------- Bon de commande imprimable (feuille A4, pur : testable hors navigateur) ---------- */
export function orderHtml(o, { S = {}, supplier = {}, products = {}, site = null } = {}) {
  const P = id => (products instanceof Map ? products.get(id) : products[id]) || {};
  const rows = (o.lines || []).map(l => {
    const p = P(l.pid), pr = num(l.price);
    return `<tr><td>${e(p.ref || '')}</td><td>${e(p.name || 'Produit supprimé')}</td><td class="n">${qtyTxt(l.qty)}</td><td>${e(p.unit || 'u')}</td><td class="n">${pr > 0 ? eur(pr) : ''}</td><td class="n">${pr > 0 ? eur(O.lineTotal(l)) : ''}</td></tr>`;
  }).join('');
  const sup = [...new Set([supplier.name, supplier.company, supplier.address, [supplier.zip, supplier.city].filter(Boolean).join(' '), supplier.phone, supplier.email].filter(Boolean))].map(e).join('\n');
  const mine = [S.address, S.phone, S.email, S.siret ? 'SIRET ' + S.siret : ''].filter(Boolean).map(e).join('<br>');
  const tot = O.orderTotal(o);
  return `<div class="sheet bco"><div class="hd"><div class="co"><img src="${e(logoSrc(S))}" alt=""><div class="nm">${e(S.company || '')}</div><div class="small">${mine}</div></div>
    <div class="cl">${sup || '<i>Fournisseur à préciser</i>'}</div></div>
    <h1>Bon de commande n° ${e(o.number || '')}</h1>
    <div class="dt">${e(S.city ? S.city + ', le ' : 'Le ')}${dateFr(o.date)}</div>
    <table class="fx"><colgroup><col style="width:17%"><col><col style="width:9%"><col style="width:8%"><col style="width:13%"><col style="width:14%"></colgroup>
      <thead><tr><th style="text-align:left">Réf.</th><th style="text-align:left">Désignation</th><th class="n">Qté</th><th>Unité</th><th class="n">PU HT</th><th class="n">Total HT</th></tr></thead>
      <tbody>${rows}${tot > 0 ? `<tr class="t"><td colspan="5" class="n">Total HT</td><td class="n">${eur(tot)}</td></tr>` : ''}</tbody></table>
    <div class="pay">${o.expected ? `<p><b>Livraison souhaitée le ${dateFr(o.expected)}</b>${site ? ` – chantier ${e(site.name)}${site.address ? ' (' + e(site.address) + ')' : ''}` : ''}</p>` : site ? `<p><b>Livraison :</b> chantier ${e(site.name)}${site.address ? ' (' + e(site.address) + ')' : ''}</p>` : ''}
    ${o.note ? `<p style="white-space:pre-line">${e(o.note)}</p>` : ''}
    <p class="small">Prix d'achat HT. Merci de confirmer la disponibilité et le délai de livraison. Mentionner le numéro de commande sur le bon de livraison et la facture.</p></div></div>`;
}

/* ---------- Onglet « Commandes » ---------- */
export async function ordersTab(body, products, locs, contacts) {
  const [orders, docs, sites, moves, S] = await Promise.all([db.all('orders'), db.all('documents'), db.all('sites'), db.all('moves'), getS()]);
  const PM = new Map(products.map(p => [p.id, p]));
  const sup = Object.fromEntries(contacts.filter(c => c.kind === 'supplier').map(c => [c.id, c]));
  const SITE = Object.fromEntries(sites.map(s => [s.id, s]));
  const ctx = { products, PM, locs, sup, sites, SITE, S, orders };
  const sug = O.suggest({ products, resv: reservations(sites, docs, moves, PM), orders, totalOf: total });
  const toBuy = sug.filter(x => x.qty > 0), already = sug.filter(x => x.qty <= 0 && x.ordered > 0);
  const supName = id => (id ? (sup[id] ? sup[id].name : 'Fournisseur supprimé') : 'Sans fournisseur');
  const groups = O.bySupplier(toBuy, supName);
  const why = x => [x.low ? `stock ${qtyTxt(x.stock)} ≤ seuil ${qtyTxt(x.min)}` : '', x.short ? `manque ${qtyTxt(x.short)} pour les devis signés` : '', x.ordered ? `${qtyTxt(x.ordered)} déjà commandé` : ''].filter(Boolean).join(' · ');
  const FL = [['open', 'En cours'], ['all', 'Toutes'], ['received', 'Reçues'], ['cancelled', 'Annulées']];
  body.innerHTML = `<div class="row"><button class="btn primary" id="onew">+ Nouvelle commande</button><span class="sp"></span><select id="ofl" aria-label="Afficher">${FL.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
    <div class="card" id="osug"><h3 style="margin-top:0">À commander</h3>
      ${groups.length ? `<p class="muted" style="margin-top:0">Produits sous leur seuil d'alerte ou manquants pour les devis signés, déduction faite de ce qui est déjà commandé. Quantités modifiables dans la commande.</p>
        ${groups.map(g => `<div class="osg"><div class="row" style="margin:6px 0 2px"><b>${e(supName(g.supplierId))}</b><span class="sp"></span><button class="btn sm primary" data-mk="${e(g.supplierId)}">Créer la commande</button></div>
          ${g.items.map(x => `<div class="s osl">${e(x.p.name)} · <b>${qtyTxt(x.qty)} ${e(x.p.unit || 'u')}</b> <small class="muted">${e(why(x))}</small></div>`).join('')}</div>`).join('')}`
      : '<p class="muted" style="margin:0">Rien à commander : aucun produit n\'est sous son seuil d\'alerte ni manquant pour les devis signés.</p>'}
      ${already.length ? `<p class="muted" style="margin-bottom:0">Déjà commandés : ${already.map(x => e(x.p.name)).slice(0, 6).join(', ')}${already.length > 6 ? '…' : ''}.</p>` : ''}</div>
    <div id="olist"></div>`;
  const list = $('#olist', body), today_ = today();
  const draw = () => {
    const f = $('#ofl', body).value;
    const rows = orders.filter(o => f === 'all' || (f === 'open' ? O.isPending(o) : o.status === f)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number)));
    list.innerHTML = rows.length ? rows.map(o => {
      const tot = O.orderTotal(o), got = o.lines.filter(l => O.pendingQty(l) <= 0).length;
      return `<div class="item" data-oid="${o.id}"><div class="main"><div class="t">${e(o.number)} · ${e(supName(o.supplierId))}</div>
        <div class="s">${dateFr(o.date)} · ${o.lines.length} ligne${o.lines.length > 1 ? 's' : ''}${tot > 0 ? ' · ' + eur(tot) + ' HT' : ''}${o.expected ? ' · livraison souhaitée le ' + dateFr(o.expected) : ''}${o.siteId && SITE[o.siteId] ? ' · ' + e(SITE[o.siteId].name) : ''}${o.status === 'partial' ? ` · ${got}/${o.lines.length} ligne(s) reçue(s)` : ''}</div></div>
        <div class="r"><span class="chip ${chipOf(o)}">${e(O.STATUS_LABEL[o.status] || o.status)}</span>${O.isLate(o, today_) ? '<span class="chip bad">en retard</span>' : ''}</div></div>`;
    }).join('') : `<div class="empty">${f === 'open' ? 'Aucune commande en cours.' : 'Aucune commande.'}</div>`;
  };
  draw();
  $('#ofl', body).onchange = draw;
  list.onclick = ev => { const it = ev.target.closest('[data-oid]'); const o = it && orders.find(x => x.id === it.dataset.oid); if (o) orderModal(o, ctx); };
  $('#onew', body).onclick = () => orderModal(blank(ctx, '', []), ctx);
  $$('[data-mk]', body).forEach(b => b.onclick = () => {
    const g = groups.find(x => x.supplierId === b.dataset.mk); if (!g) return;
    orderModal(blank(ctx, g.supplierId, g.items.map(x => ({ pid: x.p.id, qty: x.qty, price: num(x.p.buy), recv: 0 }))), ctx);
  });
}

const blank = (ctx, supplierId, lines) => ({ number: '', date: today(), expected: '', supplierId, siteId: '', status: 'draft', note: '', lines, recs: [] });

/* ---------- Fiche d'une commande ---------- */
export function orderModal(o, ctx) {
  const isNew = !o.id, editable = o.status === 'draft' || o.status === 'sent';
  const lines = o.lines.map(l => ({ ...l }));
  const usable = ctx.products.filter(p => isStocked(p) || lines.some(l => l.pid === p.id));
  const supOpts = [['', '— choisir le fournisseur —'], ...Object.values(ctx.sup).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(s => [s.id, s.name])];
  if (o.supplierId && !ctx.sup[o.supplierId]) supOpts.push([o.supplierId, 'Fournisseur supprimé']);
  const siteOpts = [['', '— aucun —'], ...ctx.sites.filter(s => !['paid', 'lost'].includes(s.status) || s.id === o.siteId).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(s => [s.id, s.name])];
  const PM = ctx.PM;
  const ro = `<table class="ordro"><thead><tr><th style="text-align:left">Produit</th><th class="n">Commandé</th><th class="n">Reçu</th><th class="n">PU HT</th></tr></thead><tbody>${o.lines.map(l => { const p = PM.get(l.pid) || {}; return `<tr><td>${e(p.name || 'Produit supprimé')}</td><td class="n">${qtyTxt(l.qty)} ${e(p.unit || 'u')}</td><td class="n">${qtyTxt(l.recv || 0)}</td><td class="n">${num(l.price) > 0 ? eur(num(l.price)) : ''}</td></tr>`; }).join('')}</tbody></table>`;
  const acts = ['<button type="button" class="btn sm" data-oact="print">🖨 Imprimer / PDF</button>', '<button type="button" class="btn sm" data-oact="mail" title="Ouvre votre messagerie avec le texte de la commande (rien n\'est envoyé par GestPro)">✉ E-mail</button>'];
  if (o.status === 'draft') acts.push('<button type="button" class="btn sm primary" data-oact="sent">✔ Marquer comme envoyée</button>');
  if (o.status === 'sent' || o.status === 'partial') acts.push('<button type="button" class="btn sm primary" data-oact="recv">📦 Réceptionner</button>');
  if (o.status === 'partial') acts.push('<button type="button" class="btn sm" data-oact="close" title="Le reste ne viendra pas : la commande est terminée">Solder la commande</button>');
  if ((o.status === 'draft' && !isNew) || o.status === 'sent') acts.push('<button type="button" class="btn sm" data-oact="cancel">Annuler la commande</button>');
  modal(isNew ? 'Nouvelle commande' : `Commande ${o.number}`,
    `<div class="cols">${F('Fournisseur', 'supplierId', o.supplierId, { type: 'select', options: supOpts })}${F('Date', 'date', o.date, { type: 'date', req: true })}
      ${F('Livraison souhaitée', 'expected', o.expected || '', { type: 'date' })}${F('Chantier à livrer (facultatif)', 'siteId', o.siteId || '', { type: 'select', options: siteOpts })}</div>
    <p style="margin:6px 0 4px"><span class="chip ${chipOf(o)}">${e(O.STATUS_LABEL[o.status])}</span>${O.isLate(o, today()) ? ' <span class="chip bad">en retard</span>' : ''}${o.sentAt ? ` <small class="muted">envoyée le ${dateFr(o.sentAt)}</small>` : ''}</p>
    ${editable ? `<div class="row"><button type="button" class="btn primary" data-scanl>▦ Scanner un produit</button><button type="button" class="btn" data-addl>+ Ligne</button></div><div id="ll"></div>` : ro}
    ${F('Note pour le fournisseur', 'note', o.note || '', { type: 'textarea', rows: 2, cls: 'full' })}
    <p id="ototal" style="margin:4px 0;font-weight:700"></p>
    ${(o.recs || []).length ? `<details><summary class="muted">Réceptions (${o.recs.length})</summary>${o.recs.map(r => `<div class="s">${dateFr(r.date)}${r.bl ? ' · ' + e(r.bl) : ''} : ${r.lines.map(l => `${qtyTxt(l.qty)} ${e((PM.get(l.pid) || {}).name || 'produit')}`).join(', ')}</div>`).join('')}</details>` : ''}
    <div class="row oacts" style="margin-top:8px">${acts.join('')}</div>`,
    async (v, f) => { const rec = await persist(v, f); if (!rec) return false; toast('Commande enregistrée'); refresh(); },
    {
      wide: true, submitLabel: 'Enregistrer',
      del: isNew || !(o.status === 'draft' || o.status === 'cancelled') ? null : async () => { await db.del('orders', o.id); toast('Commande supprimée'); refresh(); },
      onOpen: f => {
        const tot = () => { const t = O.orderTotal({ lines: editable ? lines : o.lines }); $('#ototal', f).textContent = t > 0 ? `Total HT : ${eur(t)}` : ''; };
        if (editable) { lineEditor(f, usable, lines, { price: true, hint: false }); f.addEventListener('input', tot); f.addEventListener('change', tot); }
        tot();
        f.addEventListener('click', async ev => {
          const b = ev.target.closest('[data-oact]'); if (!b) return;
          const act = b.dataset.oact, v = Object.fromEntries(new FormData(f));
          if (act === 'cancel' && !(await confirmBox(`Annuler la commande ${o.number || ''} ? Elle ne sera plus attendue.`))) return;
          if (act === 'close' && !(await confirmBox('Solder la commande ? Les quantités non reçues ne sont plus attendues.'))) return;
          const status = act === 'sent' ? 'sent' : act === 'cancel' ? 'cancelled' : act === 'close' ? 'received' : o.status;
          if (act === 'sent' && !v.supplierId) { alertBox('Choisissez d\'abord le fournisseur.'); return; }
          const rec = await persist(v, f, status, act === 'sent');
          if (!rec) return;
          closeModal(); refresh();
          if (act === 'print') printOrder(rec, ctx);
          else if (act === 'mail') mailOrder(rec, ctx);
          else if (act === 'recv') receiveOrder(rec, ctx);
          else toast(act === 'sent' ? 'Commande marquée comme envoyée' : act === 'cancel' ? 'Commande annulée' : 'Commande soldée');
        });
      }
    });

  /* enregistre les champs du formulaire (et les lignes) ; renvoie la commande enregistrée ou null (message affiché) */
  async function persist(v, f, status, markSent = false) {
    const chk = editable ? O.checkLines(lines) : { lines: o.lines, error: '' };
    if (chk.error) { alertBox(chk.error); return null; }
    if (!v.date) { alertBox('Indiquez la date de la commande.'); return null; }
    const date = v.date, cur = isNew ? null : await db.get('orders', o.id);
    const rec = { ...(cur || o), supplierId: v.supplierId || '', date, expected: v.expected || '', siteId: v.siteId || '', note: String(v.note || '').trim(), lines: chk.lines, status: status || o.status };
    if (markSent && !rec.sentAt) rec.sentAt = today();
    if (isNew || !rec.number) rec.number = O.nextNumber(await db.all('orders'), date);
    return db.put('orders', rec);
  }
}

/* ---------- Actions ---------- */
export function printOrder(o, ctx) {
  $('#printarea').innerHTML = orderHtml(o, { S: ctx.S, supplier: ctx.sup[o.supplierId] || {}, products: ctx.PM, site: ctx.SITE[o.siteId] || null });
  setTimeout(() => window.print(), 60);
}
export function mailOrder(o, ctx) {
  const supplier = ctx.sup[o.supplierId] || {};
  const m = O.mailText(o, { supplier, products: ctx.PM, S: ctx.S, site: ctx.SITE[o.siteId] || null, dateFr, eur });
  location.href = `mailto:${encodeURIComponent(supplier.email || '')}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
}
export async function receiveOrder(o, ctx) {
  const pend = o.lines.filter(l => O.pendingQty(l) > 0).map(l => ({ pid: l.pid, qty: O.pendingQty(l), price: l.price }));
  if (!pend.length) { toast('Tout est déjà reçu.'); return; }
  const sup = ctx.sup[o.supplierId];
  await receptionModal(ctx.products, ctx.locs, {
    lines: pend, bl: `${sup ? sup.name + ' – ' : ''}${o.number}`, title: `📦 Réception de la commande ${o.number}`,
    onReceived: async (items, bl) => { const cur = await db.get('orders', o.id); if (cur) await db.put('orders', O.receive(cur, items, { date: today(), bl })); }
  });
}
