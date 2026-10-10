// Chantiers : fiche centrale qui relie client, devis, factures, avoirs et règlements.
import * as db from './db.js';
import { e, eur, num, round2, dateFr, today, F, modal, toast, tabs, refresh, go, colorField, bindColors, $, $$ } from './util.js';
import { totals, paidOf, invBadge } from './docs.js';
import { siteTeamHtml, assignModal } from './team.js';
import { siteMargin } from './finance.js';
import * as auth from './auth.js';

/* Compagnon / intervenant : seuls les chantiers où il est affecté */
const onlyMine = () => auth.can('planning') && !auth.can('planning.all');
const mySites = (tasks) => new Set(tasks.filter(t => t.memberId === auth.currentUser()?.id).map(t => t.siteId));

export const SS = { new: 'Nouveau', signed: 'Signé', progress: 'En cours', paid: 'Payé', lost: 'Perdu' };
export const SCOL = { new: '', signed: 'warn', progress: 'warn', paid: 'ok', lost: 'bad' };
const OPEN = ['new', 'signed', 'progress'];

/* Chiffres d'un chantier à partir de ses documents (devis acceptés/facturés, factures, avoirs, règlements) */
export function siteStats(siteId, docs, payments) {
  const mine = docs.filter(d => d.siteId === siteId);
  const quotes = mine.filter(d => d.type === 'quote');
  const signed = quotes.filter(d => d.status === 'accepted' || d.status === 'invoiced');
  const pending = quotes.filter(d => d.status === 'sent' || d.status === 'draft');
  const invoices = mine.filter(d => d.type === 'invoice' && d.status !== 'draft');
  const credits = mine.filter(d => d.type === 'credit' && d.status !== 'draft');
  const sum = (l, f) => round2(l.reduce((a, d) => a + totals(d)[f], 0));
  const marcheHT = sum(signed, 'ht'), marcheTTC = sum(signed, 'ttc');
  const factureHT = round2(sum(invoices, 'ht') - sum(credits, 'ht'));
  const factureTTC = round2(sum(invoices, 'ttc') - sum(credits, 'ttc'));
  const invIds = new Set(invoices.map(d => d.id)), crIds = new Set(credits.map(d => d.id));
  const cash = round2(payments.filter(p => invIds.has(p.docId) && p.method !== 'avoir').reduce((a, p) => a + num(p.amount), 0));
  const rembourse = round2(payments.filter(p => crIds.has(p.docId) && p.kind === 'remboursement').reduce((a, p) => a + num(p.amount), 0));
  const encaisse = round2(cash - rembourse);
  return {
    marcheHT, marcheTTC, factureHT, factureTTC, encaisse,
    enAttenteTTC: sum(pending.filter(q => q.status === 'sent'), 'ttc'),
    resteFacturer: Math.max(0, round2(marcheTTC - factureTTC)),
    resteAPayer: Math.max(0, round2(factureTTC - encaisse)),
    aRembourser: Math.max(0, round2(encaisse - factureTTC)),
    nbDevis: quotes.length, nbFactures: invoices.length, nbAvoirs: credits.length
  };
}

/* ---------- Liste ---------- */
export async function renderSites(el, tab = 'open') {
  const [sites0, contacts, docs, payments, tasks] = await Promise.all([db.all('sites'), db.all('contacts'), db.all('documents'), db.all('payments'), db.all('tasks')]);
  const mine = onlyMine() ? mySites(tasks) : null, money = auth.can('sites.money'), canEdit = auth.can('sites.edit');
  const sites = mine ? sites0.filter(s => mine.has(s.id)) : sites0;
  const C = Object.fromEntries(contacts.map(c => [c.id, c]));
  const list = sites.filter(s => tab === 'all' || (tab === 'open' ? OPEN.includes(s.status) : s.status === tab))
    .sort((a, b) => (b.start || b._u + '').localeCompare(a.start || a._u + ''));
  el.innerHTML = `<h2>Chantiers</h2>${tabs('#/sites', [['open', 'Ouverts'], ['paid', 'Payés'], ['lost', 'Perdus'], ['all', 'Tous']], tab)}
    <div class="row"><input class="search" id="q" type="search" placeholder="Rechercher (nom, client, adresse)…">${canEdit ? '<a class="btn primary" href="#/site/new">+ Chantier</a>' : ''}</div><div id="list"></div>`;
  const draw = () => {
    const q = $('#q', el).value.toLowerCase();
    const rows = list.filter(s => !q || [s.name, C[s.clientId]?.name, s.address].join(' ').toLowerCase().includes(q));
    $('#list', el).innerHTML = rows.map(s => {
      const st = siteStats(s.id, docs, payments);
      return `<a class="item" href="#/site/${s.id}" style="text-decoration:none;color:inherit"><span class="dot" style="background:${e(s.color || '#2f7ad6')}"></span><div class="main"><div class="t">${e(s.name)}</div>
        <div class="s">${e(C[s.clientId]?.name || 'Sans client')}${s.address ? ' · ' + e(s.address.split('\n')[0]) : ''}</div>
        <div class="s">${s.start ? dateFr(s.start) : ''}${s.end ? ' → ' + dateFr(s.end) : ''}</div></div>
        <div class="r"><span class="chip ${SCOL[s.status]}">${SS[s.status] || ''}</span>${money && st.marcheTTC ? `<div><b>${eur(st.marcheTTC)}</b></div>` : ''}${money && st.resteAPayer ? `<div class="s">reste ${eur(st.resteAPayer)}</div>` : ''}</div></a>`;
    }).join('') || `<div class="empty">Aucun chantier ici. Créez-en un pour y rattacher devis, factures et planning.</div>`;
  };
  draw(); $('#q', el).oninput = draw;
}

/* ---------- Fiche chantier ---------- */
export async function renderSite(el, id) {
  const [contacts] = await Promise.all([db.all('contacts')]);
  const clients = contacts.filter(c => c.kind === 'client').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (id === 'new' && !auth.can('sites.edit')) return go('#/sites');
  if (id === 'new') { await renderSites(el, 'open'); return siteModal({ name: '', clientId: '', address: '', start: '', end: '', status: 'new', note: '', color: '#2f7ad6' }, clients, true); }
  const site = await db.get('sites', id);
  const money = auth.can('sites.money'), canEdit = auth.can('sites.edit'), canAssign = auth.can('planning.edit');
  if (site && onlyMine() && !mySites(await db.all('tasks')).has(site.id)) { el.innerHTML = '<div class="empty">Ce chantier ne figure pas dans votre planning.</div>'; return; }
  if (!site) { el.innerHTML = '<div class="empty">Chantier introuvable.</div>'; return; }
  const [docs, payments, tasks, members, moves] = await Promise.all([db.all('documents'), db.all('payments'), db.all('tasks'), db.all('members'), db.all('moves')]);
  const mg = siteMargin(site.id, docs, moves, tasks, members);
  const client = contacts.find(c => c.id === site.clientId);
  const st = siteStats(site.id, docs, payments);
  const mine = docs.filter(d => d.siteId === site.id).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
  const prods = await db.all('products');
  const outs = {};
  for (const m of moves) if (m.siteId === site.id && m.type === 'out') outs[m.productId] = (outs[m.productId] || 0) + num(m.qty);
  const matRows = Object.entries(outs).map(([pid, q]) => { const p = prods.find(x => x.id === pid); return `<div class="item"><div class="main"><div class="t">${e(p?.name || 'Produit supprimé')}</div></div><div class="r"><b>${q} ${e(p?.unit || '')}</b></div></div>`; });
  const matHtml = auth.can('stock') || money ? `<h3>Matériel sorti du stock</h3>${matRows.join('') || '<p class="muted">Aucune sortie pour ce chantier.</p>'}${auth.can('stock') ? '<a class="btn sm" href="#/stock/moves">🏗 Sortie / mouvements</a>' : ''}` : '';
  const row = d => {
    const t = totals(d);
    const badge = d.type === 'invoice' || d.type === 'credit' ? invBadge(d, payments) : `<span class="chip ${d.status === 'accepted' || d.status === 'invoiced' ? 'ok' : d.status === 'refused' ? 'bad' : ''}">${{ draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé' }[d.status] || ''}</span>`;
    return `<a class="item" href="#/doc/${d.id}" style="text-decoration:none;color:inherit"><div class="main"><div class="t">${e(d.number || '(sans numéro)')}</div><div class="s">${dateFr(d.date)}</div></div><div class="r"><b>${d.type === 'credit' ? '− ' : ''}${eur(t.ttc)}</b><div>${badge}</div></div></a>`;
  };
  const sect = (title, type, label) => `<h3>${title}</h3>${mine.filter(d => d.type === type).map(row).join('') || '<p class="muted">Aucun.</p>'}${label ? `<a class="btn sm" href="#/doc/new/${type}-${site.id}">+ ${label}</a>` : ''}`;
  el.innerHTML = `<div class="row"><a class="btn ghost" href="#/sites">← Chantiers</a><span class="sp"></span>${canEdit ? '<button class="btn" id="edit">Modifier</button>' : ''}</div>
    <h2><span class="dot" style="background:${e(site.color || '#2f7ad6')}"></span> ${e(site.name)}</h2>
    <div class="card"><div class="row" style="margin:0"><select id="stat" style="width:auto" ${canEdit ? '' : 'disabled'}>${Object.entries(SS).map(([k, l]) => `<option value="${k}" ${k === site.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted">${site.start ? dateFr(site.start) : 'dates non fixées'}${site.end ? ' → ' + dateFr(site.end) : ''}</span></div>
      <p style="margin:8px 0 0"><b>${e(client?.name || 'Sans client')}</b>${client?.phone ? ` · <a href="tel:${e(client.phone)}">${e(client.phone)}</a>` : ''}<br>${e(site.address || '').replace(/\n/g, '<br>')}</p>
      ${site.note ? `<p class="muted" style="white-space:pre-line">${e(site.note)}</p>` : ''}</div>
    ${money ? `<div class="grid">
      <div class="kpi"><small>Marché signé (TTC)</small><b>${eur(st.marcheTTC)}</b><small>${eur(st.marcheHT)} HT${st.enAttenteTTC ? ` · ${eur(st.enAttenteTTC)} en attente` : ''}</small></div>
      <div class="kpi"><small>Facturé (TTC)</small><b>${eur(st.factureTTC)}</b><small>reste à facturer ${eur(st.resteFacturer)}</small></div>
      <div class="kpi ok"><small>Encaissé</small><b>${eur(st.encaisse)}</b></div>
      <div class="kpi ${st.resteAPayer ? 'warn' : ''}"><small>Reste à payer</small><b>${eur(st.resteAPayer)}</b>${st.aRembourser ? `<small>à rembourser au client : ${eur(st.aRembourser)}</small>` : ''}</div>
    </div>
    ${sect('Devis', 'quote', 'Devis')}${sect('Factures', 'invoice', 'Facture')}${mine.some(d => d.type === 'credit') ? sect('Avoirs', 'credit', '') : ''}` : ''}
    ${siteTeamHtml(site.id, tasks, members, { edit: canAssign, money })}
    ${matHtml}
    ${money ? `<h3>Rentabilité</h3><div class="card"><div class="totals" style="margin:0;max-width:none">
      <div><span>${mg.previsionnel ? 'Marché signé HT (rien de facturé)' : 'Facturé HT (net des avoirs)'}</span><b>${eur(mg.base)}</b></div>
      <div><span>− Matières sorties du stock</span><b>${eur(mg.matieres)}</b></div>
      <div><span>− Main-d'œuvre (${mg.hours} h × coût horaire)</span><b>${eur(mg.mo)}</b></div>
      <div class="big"><span>Marge ${mg.previsionnel ? 'prévisionnelle' : ''}</span><span style="color:${mg.marge < 0 ? 'var(--bad)' : 'var(--ok)'}">${eur(mg.marge)}${mg.pct !== null ? ` (${mg.pct} %)` : ''}</span></div></div>
      <p class="muted" style="margin-bottom:0">Les matières viennent des sorties de stock rattachées à ce chantier (« Déduire du stock » depuis une facture, ou sortie manuelle avec chantier).</p></div>` : ''}
    ${canEdit ? '<div class="card" style="margin-top:14px"><button class="btn danger" id="del">Supprimer le chantier</button></div>' : ''}`;
  $('#stat', el).onchange = async ev => { site.status = ev.target.value; await db.put('sites', site); toast('Statut mis à jour'); refresh(); };
  if (canAssign) $('#assign', el).onclick = () => assignModal(null, { siteId: site.id });
  $$('[data-mem]', el).forEach(n => n.onclick = () => go('#/planning/week'));
  if (!canEdit) return;
  $('#edit', el).onclick = () => siteModal(site, clients, false);
  $('#del', el).onclick = async () => {
    if (!confirm('Supprimer ce chantier ? Les devis et factures sont conservés (ils perdent seulement le lien) ; le planning de ce chantier est supprimé.')) return;
    for (const d of mine) { d.siteId = ''; await db.put('documents', d); }
    for (const t of tasks.filter(x => x.siteId === site.id)) await db.del('tasks', t.id);
    await db.del('sites', site.id); go('#/sites');
  };
}

function siteModal(site, clients, isNew) {
  const COLORS = ['#2f7ad6', '#1b8a4b', '#c77700', '#c62f2f', '#7b4fd0', '#0f9aa8', '#555d6b'];
  modal(isNew ? 'Nouveau chantier' : 'Modifier le chantier',
    `<div class="cols">${F('Nom du chantier', 'name', site.name, { req: true, cls: 'full', ph: 'ex : Terrasse bois – Dupont' })}
    <label class="f full"><span>Client</span><select name="clientId"><option value="">— choisir —</option>${clients.map(c => `<option value="${c.id}" ${c.id === site.clientId ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select></label>
    ${F('Adresse des travaux', 'address', site.address, { type: 'textarea', rows: 2, cls: 'full' })}
    ${F('Début', 'start', site.start, { type: 'date' })}${F('Fin prévue', 'end', site.end, { type: 'date' })}
    ${F('Statut', 'status', site.status, { type: 'select', options: Object.entries(SS) })}
    ${colorField('Couleur (planning)', 'color', site.color)}
    ${F('Notes', 'note', site.note, { type: 'textarea', rows: 3, cls: 'full' })}</div>
    ${clients.length ? '' : '<p class="muted">Aucun client : créez-en un dans Contacts, ou directement depuis un devis.</p>'}`,
    async o => {
      if (isNew && !o.name.trim()) return false;
      Object.assign(site, o); const saved = await db.put('sites', site);
      toast('Chantier enregistré'); isNew ? go('#/site/' + saved.id) : refresh();
    });
  bindColors($('#modal'));
  if (isNew) $('#modal').addEventListener('close', () => { if (location.hash === '#/site/new') go('#/sites'); }, { once: true });
}
