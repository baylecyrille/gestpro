// Chantiers : fiche centrale qui relie client, devis, factures, avoirs et règlements.
import * as db from './db.js';
import { e, eur, num, round2, dateFr, cname, today, F, addressAutocomplete, filterBar, bindFilters, modal, toast, tabs, refresh, go, colorField, bindColors, $, $$ } from './util.js';
import { totals, paidOf, invBadge } from './docs.js';
import { siteTeamHtml, assignModal } from './team.js';
import { siteMargin } from './finance.js';
import * as auth from './auth.js';

/* Compagnon / intervenant : seuls les chantiers où il est affecté */
const onlyMine = () => auth.can('planning') && !auth.can('planning.all');
const mySites = (tasks) => new Set(tasks.filter(t => t.memberId === auth.currentUser()?.id).map(t => t.siteId));

export const SS = { new: 'Nouveau', signed: 'Signé', progress: 'En cours', paid: 'Terminé', lost: 'Perdu' };
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

/* ---------- Jauges d'avancement : paiement, travaux (saisis), délai (début → fin prévue) ---------- */
export function siteGauges(site, st, money = true, now = today()) {
  if (site.status === 'lost') return [];
  const g = [], closed = site.status === 'paid', DAY = 864e5;
  const base = st.marcheTTC || st.factureTTC;
  if (money && base > 0.005) g.push({ k: 'pay', icon: '💶', label: 'Paiement', pct: Math.max(0, Math.min(100, Math.round(st.encaisse / base * 100))), cls: 'ok', txt: `${eur(st.encaisse)} encaissés sur ${eur(base)}` });
  const hasProg = site.progress !== '' && site.progress != null && !isNaN(parseFloat(site.progress));
  if (closed || hasProg) { const p = closed ? 100 : Math.max(0, Math.min(100, Math.round(num(site.progress)))); g.push({ k: 'work', icon: '🛠', label: 'Travaux', pct: p, cls: p >= 100 ? 'ok' : '', txt: `${p} % réalisés` }); }
  if (site.start && site.end && site.end > site.start) {
    const t0 = Date.parse(site.start), t1 = Date.parse(site.end), tn = Date.parse(now);
    const total = Math.round((t1 - t0) / DAY), el = Math.round((tn - t0) / DAY), late = !closed && tn > t1;
    const pct = Math.max(0, Math.min(100, Math.round(el / total * 100)));
    g.push({ k: 'time', icon: '⏱', label: 'Délai', pct: closed ? 100 : pct, cls: closed ? 'ok' : late ? 'bad' : pct >= 85 ? 'warn' : '', txt: closed ? 'chantier terminé' : late ? `fin prévue dépassée de ${Math.round((tn - t1) / DAY)} j` : el < 0 ? `démarre dans ${-el} j` : `jour ${el} sur ${total} (fin le ${dateFr(site.end)})` });
  }
  return g;
}
/* Petites jauges pour les listes / liens chantier */
export function gaugesHtml(list) {
  return list.length ? `<div class="gg">${list.map(g => `<span class="ggi" title="${e(g.label + ' : ' + g.txt)}">${g.icon}<i class="gbar"><b class="${g.cls}" style="width:${g.pct}%"></b></i><em>${g.pct} %</em></span>`).join('')}</div>` : '';
}
const gaugesBig = (list, edit, site) => `<div class="card gauges"><h3 style="margin-top:0">Avancement</h3>${list.map(g => `<div class="gline"><div class="gh"><span>${g.icon} ${e(g.label)}</span><b>${g.pct} %</b></div><div class="gbar big"><b class="${g.cls}" style="width:${g.pct}%"></b></div><div class="s muted">${e(g.txt)}</div></div>`).join('') || '<p class="muted" style="margin:0">Renseignez les dates (début et fin prévue) ou l\'avancement pour voir les jauges.</p>'}
  ${edit && site.status !== 'paid' ? `<label class="f" style="margin-top:8px"><span>🛠 Avancement des travaux : <b id="pv">${site.progress === '' || site.progress == null ? 'non renseigné' : Math.round(num(site.progress)) + ' %'}</b></span><input type="range" id="prog" min="0" max="100" step="5" value="${num(site.progress)}"></label>` : ''}</div>`;

/* ---------- Liste ---------- */
export async function renderSites(el, tab = 'open') {
  const [sites0, contacts, docs, payments, tasks] = await Promise.all([db.all('sites'), db.all('contacts'), db.all('documents'), db.all('payments'), db.all('tasks')]);
  const mine = onlyMine() ? mySites(tasks) : null, money = auth.can('sites.money'), canEdit = auth.can('sites.edit');
  const sites = mine ? sites0.filter(s => mine.has(s.id)) : sites0;
  const C = Object.fromEntries(contacts.map(c => [c.id, c]));
  const cl = [...new Set(sites.map(s => s.clientId).filter(Boolean))].map(id => [id, C[id]?.name || '?']).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const FC = [{ id: 'sort', label: 'Trier par', def: 'recent', options: [['recent', 'Plus récents'], ['name', 'Nom A→Z'], ['client', 'Client A→Z'], ['start', 'Date de début'], ['end', 'Date de fin (proche)'], ['amount', 'Montant du marché'], ['due', 'Reste à payer']] },
    { id: 'client', label: 'Client', options: [['', 'Tous'], ...cl] }, { id: 'late', type: 'check', label: 'En retard' }, { id: 'due', type: 'check', label: 'Reste à payer' }];
  const list = sites.filter(s => tab === 'all' || (tab === 'open' ? OPEN.includes(s.status) : s.status === tab))
;
  el.innerHTML = `<h2>Chantiers</h2>${tabs('#/sites', [['open', 'Ouverts'], ['paid', 'Terminés'], ['lost', 'Perdus'], ['all', 'Tous']], tab)}
    <div class="row"><input class="search" id="q" type="search" placeholder="Rechercher (nom, client, adresse)…">${canEdit ? '<a class="btn primary" href="#/site/new">+ Chantier</a>' : ''}</div>
    ${filterBar(FC)}<div id="list"></div>`;
  const ST = Object.fromEntries(sites.map(s => [s.id, siteStats(s.id, docs, payments)]));
  const SORTS = { recent: (a, b) => (b._u || 0) - (a._u || 0), name: (a, b) => a.name.localeCompare(b.name, 'fr'), client: (a, b) => (C[a.clientId]?.name || '~').localeCompare(C[b.clientId]?.name || '~', 'fr'),
    start: (a, b) => (b.start || '').localeCompare(a.start || ''), end: (a, b) => (a.end || '9999').localeCompare(b.end || '9999'), amount: (a, b) => ST[b.id].marcheTTC - ST[a.id].marcheTTC, due: (a, b) => ST[b.id].resteAPayer - ST[a.id].resteAPayer };
  let getF;
  const draw = () => {
    const q = $('#q', el).value.toLowerCase(), F2 = getF ? getF() : {};
    const rows = list.filter(s => (!q || [s.name, C[s.clientId]?.name, s.address].join(' ').toLowerCase().includes(q)) && (!F2.client || s.clientId === F2.client) && (!F2.late || (OPEN.includes(s.status) && s.end && s.end < today())) && (!F2.due || ST[s.id].resteAPayer > 0.005))
      .sort(SORTS[F2.sort] || SORTS.recent);
    $('#list', el).innerHTML = rows.map(s => {
      const st = siteStats(s.id, docs, payments);
      return `<a class="item" href="#/site/${s.id}" style="text-decoration:none;color:inherit"><span class="dot" style="background:${e(s.color || '#2f7ad6')}"></span><div class="main"><div class="t">${e(s.name)}</div>
        <div class="s">${e(C[s.clientId]?.name || 'Sans client')}${s.address ? ' · ' + e(s.address.split('\n')[0]) : ''}</div>
        <div class="s">${s.start ? dateFr(s.start) : ''}${s.end ? ' → ' + dateFr(s.end) : ''}</div>${gaugesHtml(siteGauges(s, st, money))}</div>
        <div class="r"><span class="chip ${SCOL[s.status]}">${SS[s.status] || ''}</span>${money && st.marcheTTC ? `<div><b>${eur(st.marcheTTC)}</b></div>` : ''}${money && st.resteAPayer ? `<div class="s">reste ${eur(st.resteAPayer)}</div>` : ''}</div></a>`;
    }).join('') || `<div class="empty">Aucun chantier ici. Créez-en un pour y rattacher devis, factures et planning.</div>`;
  };
  getF = bindFilters(el, 'sites_', FC, draw);
  draw(); $('#q', el).oninput = draw;
}

/* ---------- Fiche chantier ---------- */
export async function renderSite(el, id) {
  const [contacts] = await Promise.all([db.all('contacts')]);
  const clients = contacts.filter(c => c.kind === 'client').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (id === 'new' && !auth.can('sites.edit')) return go('#/sites');
  if (id === 'new') { await renderSites(el, 'open'); return newSiteModal({}); }
  const site = await db.get('sites', id);
  const money = auth.can('sites.money'), canEdit = auth.can('sites.edit'), canAssign = auth.can('planning.edit');
  if (site && onlyMine() && !mySites(await db.all('tasks')).has(site.id)) { el.innerHTML = '<div class="empty">Ce chantier ne figure pas dans votre planning.</div>'; return; }
  if (!site) { el.innerHTML = '<div class="empty">Chantier introuvable.</div>'; return; }
  const [docs, payments, tasks, members, moves] = await Promise.all([db.all('documents'), db.all('payments'), db.all('tasks'), db.all('members'), db.all('moves')]);
  const mg = siteMargin(site.id, docs, moves, tasks, members, site);
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
  el.innerHTML = `<div class="row"><a class="btn ghost" href="#/sites">← Chantiers</a><span class="sp"></span>${canEdit ? `<button class="btn ${site.status === 'paid' ? '' : 'primary'}" id="finish">${site.status === 'paid' || site.status === 'lost' ? '↺ Rouvrir le chantier' : '✓ Terminer le chantier'}</button><button class="btn" id="edit">Modifier</button>` : ''}</div>
    <h2><span class="dot" style="background:${e(site.color || '#2f7ad6')}"></span> ${e(site.name)}</h2>
    <div class="card"><div class="row" style="margin:0"><select id="stat" style="width:auto" ${canEdit ? '' : 'disabled'}>${Object.entries(SS).map(([k, l]) => `<option value="${k}" ${k === site.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted">${site.start ? dateFr(site.start) : 'dates non fixées'}${site.end ? ' → ' + dateFr(site.end) : ''}</span></div>
      <p style="margin:8px 0 0"><b>${e(client?.name || 'Sans client')}</b>${client?.phone ? ` · <a href="tel:${e(client.phone)}">${e(client.phone)}</a>` : ''}<br>${e(site.address || '').replace(/\n/g, '<br>')}</p>
      ${site.address ? `<div class="row" style="margin:8px 0 0"><a class="btn primary" id="itin" target="_blank" rel="noopener" href="${e(mapsDir(site.address))}">🧭 Itinéraire</a><button class="btn" id="mapbtn" type="button">🗺 Plan</button><button class="btn" id="shbtn" type="button">📤 Envoyer</button></div><div id="mapbox" hidden></div>` : `<p class="muted" style="margin:8px 0 0">📍 Ajoutez l'adresse du chantier (bouton « Modifier ») pour afficher le plan et lancer l'itinéraire.</p>`}
      ${site.note ? `<p class="muted" style="white-space:pre-line">${e(site.note)}</p>` : ''}</div>
    ${gaugesBig(siteGauges(site, st, money), canEdit, site)}
    ${money ? `<div class="grid">
      <div class="kpi"><small>Marché signé (TTC)</small><b>${eur(st.marcheTTC)}</b><small>${eur(st.marcheHT)} HT${st.enAttenteTTC ? ` · ${eur(st.enAttenteTTC)} en attente` : ''}</small></div>
      <div class="kpi"><small>Facturé (TTC)</small><b>${eur(st.factureTTC)}</b><small>reste à facturer ${eur(st.resteFacturer)}</small></div>
      <div class="kpi ok"><small>Encaissé</small><b>${eur(st.encaisse)}</b></div>
      <div class="kpi ${st.resteAPayer ? 'warn' : ''}"><small>Reste à payer</small><b>${eur(st.resteAPayer)}</b>${st.aRembourser ? `<small>à rembourser au client : ${eur(st.aRembourser)}</small>` : ''}</div>
    </div>
    ${sect('Devis', 'quote', 'Devis')}${sect('Factures', 'invoice', 'Facture')}${mine.some(d => d.type === 'credit') ? sect('Avoirs', 'credit', '') : ''}` : ''}
    ${siteTeamHtml(site.id, tasks, members, { edit: canAssign, money })}
    ${matHtml}
    ${money ? `<h3>Charges non facturées</h3><div class="card">${(site.charges || []).map((c, i) => `<div class="item" data-ch="${i}"><div class="main"><div class="t">${e(c.label)}</div><div class="s">${dateFr(c.date)} · ${num(c.qty)} ${e(c.unit || '')} × ${eur(num(c.cost))}${c.note ? ' · ' + e(c.note) : ''}</div></div><div class="r"><b>${eur(num(c.qty) * num(c.cost))}</b> <button class="btn sm danger" data-chrm="${i}">✕</button></div></div>`).join('') || '<p class="muted" style="margin-top:0">Aucune charge. Ajoutez ici les produits utilisés sur ce chantier mais non facturés au client : ils réduisent la marge.</p>'}${canEdit || auth.can('stock') ? '<button class="btn sm" id="addch">+ Produit / charge</button>' : ''}</div>
    <h3>Rentabilité</h3><div class="card"><div class="totals" style="margin:0;max-width:none">
      <div><span>${mg.previsionnel ? 'Marché signé HT (rien de facturé)' : 'Facturé HT (net des avoirs)'}</span><b>${eur(mg.base)}</b></div>
      <div><span>− Matières sorties du stock</span><b>${eur(mg.matieres)}</b></div>
      <div><span>− Charges non facturées</span><b>${eur(mg.charges)}</b></div>
      <div><span>− Main-d'œuvre (${mg.hours} h × coût horaire)</span><b>${eur(mg.mo)}</b></div>
      <div class="big"><span>Marge ${mg.previsionnel ? 'prévisionnelle' : ''}</span><span style="color:${mg.marge < 0 ? 'var(--bad)' : 'var(--ok)'}">${eur(mg.marge)}${mg.pct !== null ? ` (${mg.pct} %)` : ''}</span></div></div>
      <p class="muted" style="margin-bottom:0">Les matières viennent des sorties de stock rattachées à ce chantier (« Déduire du stock » depuis une facture, ou sortie manuelle avec chantier).</p></div>` : ''}
    ${canEdit ? '<div class="card" style="margin-top:14px"><button class="btn danger" id="del">Supprimer le chantier</button></div>' : ''}`;
  $('#stat', el).onchange = async ev => { site.status = ev.target.value; await db.put('sites', site); toast('Statut mis à jour'); refresh(); };
  const addr1 = (site.address || '').replace(/\s*\n\s*/g, ', ');
  $('#mapbtn', el)?.addEventListener('click', () => {
    const box = $('#mapbox', el);
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = `<iframe title="Plan" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:260px;border:0;border-radius:10px;margin-top:8px" src="https://maps.google.com/maps?q=${encodeURIComponent(addr1)}&z=15&output=embed"></iframe><p class="muted" style="margin:4px 0 0">Plan affiché par Google Maps (connexion internet nécessaire).</p>`; box.hidden = false;
  });
  $('#shbtn', el)?.addEventListener('click', async () => {
    const url = mapsDir(site.address), data = { title: site.name, text: `${site.name} – ${addr1}`, url };
    try { if (navigator.share) { await navigator.share(data); return; } } catch (err) { if (err && err.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${data.text}\n${url}`); toast('Adresse et lien d\'itinéraire copiés'); } catch { prompt('Copiez ce lien :', url); }
  });
  $('#prog', el)?.addEventListener('input', ev => { $('#pv', el).textContent = ev.target.value + ' %'; });
  $('#prog', el)?.addEventListener('change', async ev => { site.progress = +ev.target.value; await db.put('sites', site); refresh(); });
  if (canAssign) $('#assign', el).onclick = () => assignModal(null, { siteId: site.id });
  $$('[data-mem]', el).forEach(n => n.onclick = () => go('#/planning/week'));
  $$('[data-chrm]', el).forEach(b => b.onclick = async () => { if (!confirm('Supprimer cette charge ?')) return; site.charges.splice(+b.dataset.chrm, 1); await db.put('sites', site); refresh(); });
  $('#addch', el)?.addEventListener('click', () => chargeModal(site, prods));
  if (!canEdit) return;
  $('#edit', el).onclick = () => siteModal(site, clients, false);
  $('#finish', el).onclick = async () => {
    const closed = site.status === 'paid' || site.status === 'lost';
    if (!closed && st.resteAPayer > 0.005 && !confirm(`Il reste ${eur(st.resteAPayer)} à encaisser sur ce chantier. Le terminer quand même ?`)) return;
    site.status = closed ? (mine.some(d => d.type === 'invoice') ? 'progress' : 'signed') : 'paid';
    if (!closed && !site.end) site.end = today();
    await db.put('sites', site); toast(closed ? 'Chantier rouvert' : 'Chantier terminé'); refresh();
  };
  $('#del', el).onclick = async () => {
    if (!confirm('Supprimer ce chantier ? Les devis et factures sont conservés (ils perdent seulement le lien) ; le planning de ce chantier est supprimé.')) return;
    for (const d of mine) { d.siteId = ''; await db.put('documents', d); }
    for (const t of tasks.filter(x => x.siteId === site.id)) await db.del('tasks', t.id);
    await db.del('sites', site.id); go('#/sites');
  };
}

export const mapsDir = addr => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(String(addr || '').replace(/\s*\n\s*/g, ', '));

/* Création d'un chantier : pre = valeurs préremplies (clientId, name, address, quoteId) ; onSaved(site) remplace la redirection */
export async function newSiteModal(pre = {}, onSaved) {
  const [contacts, docs] = await Promise.all([db.all('contacts'), db.all('documents')]);
  const clients = contacts.filter(c => c.kind === 'client').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const { quoteId, ...rest } = pre;
  siteModal({ name: '', clientId: '', address: '', start: '', end: '', status: 'new', note: '', color: '#2f7ad6', ...rest }, clients, true, { docs, contacts, quoteId, onSaved });
}

function siteModal(site, clients, isNew, opts = {}) {
  const COLORS = ['#2f7ad6', '#1b8a4b', '#c77700', '#c62f2f', '#7b4fd0', '#0f9aa8', '#555d6b'];
  const docs = opts.docs || [], CM = Object.fromEntries((opts.contacts || clients).map(c => [c.id, c])), SITES = {};
  const quotes = isNew ? docs.filter(d => d.type === 'quote').sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number)) : [];
  const qLabel = d => `${d.number || '(sans n°)'} — ${cname(CM[d.clientId]) || 'sans client'}${d.siteRef ? ' — ' + d.siteRef : ''} — ${eur(totals(d).ttc)}${d.siteId ? ' · déjà rattaché à un chantier' : ''}`;
  const cLabel = c => cname(c) + (c.city ? ' — ' + c.city : '') + (c.zip ? ' (' + c.zip + ')' : '');
  modal(isNew ? 'Nouveau chantier' : 'Modifier le chantier',
    `<div class="cols">${F('Nom du chantier', 'name', site.name, { req: true, cls: 'full', ph: 'ex : Terrasse bois – Dupont' })}
    ${quotes.length ? `<label class="f full"><span>Créer à partir d'un devis (facultatif)</span><input type="search" id="mqs" placeholder="🔍 N° de devis, client, référence…" autocomplete="off" style="margin-bottom:6px"><select name="quoteId"><option value="">— aucun —</option>${quotes.map(d => `<option value="${d.id}">${e(qLabel(d))}</option>`).join('')}</select></label>` : ''}
    <label class="f full"><span>Client</span><input type="search" id="mcs" placeholder="🔍 Rechercher un client (nom, ville, code postal)…" autocomplete="off" style="margin-bottom:6px"><select name="clientId"><option value="">— choisir —</option>${clients.map(c => `<option value="${c.id}" ${c.id === site.clientId ? 'selected' : ''}>${e(cLabel(c))}</option>`).join('')}</select></label>
    ${F('Adresse des travaux', 'address', site.address, { type: 'textarea', rows: 2, cls: 'full' })}
    ${F('Début', 'start', site.start, { type: 'date' })}${F('Fin prévue', 'end', site.end, { type: 'date' })}
    ${F('Statut', 'status', site.status, { type: 'select', options: Object.entries(SS) })}
    ${F('Avancement des travaux (%)', 'progress', site.progress ?? '', { type: 'number', step: '5', ph: 'non renseigné' })}
    ${colorField('Couleur (planning)', 'color', site.color)}
    ${F('Notes', 'note', site.note, { type: 'textarea', rows: 3, cls: 'full' })}</div>
    ${clients.length ? '' : '<p class="muted">Aucun client : créez-en un dans Contacts, ou directement depuis un devis.</p>'}`,
    async o => {
      if (isNew && !o.name.trim()) return false;
      const { quoteId, ...rest } = o;
      rest.progress = rest.progress === '' || rest.progress == null ? '' : Math.max(0, Math.min(100, num(rest.progress)));
      Object.assign(site, rest); const saved = await db.put('sites', site);
      if (quoteId) { // rattache le devis choisi (et les factures qui en sont issues) au nouveau chantier
        const q = docs.find(d => d.id === quoteId);
        if (q) for (const d of docs.filter(x => x.id === q.id || ((x.fromQuote === q.id || (q.number && x.fromQuoteNumber === q.number)) && !x.siteId))) { d.siteId = saved.id; if (!d.siteRef) d.siteRef = saved.name; await db.put('documents', d); }
      }
      toast('Chantier enregistré'); if (opts.onSaved) opts.onSaved(saved); else isNew ? go('#/site/' + saved.id) : refresh();
    }, { onOpen: f => {
      const sel = f.querySelector('[name=clientId]'), cs = f.querySelector('#mcs'), qs = f.querySelector('#mqs'), qsel = f.querySelector('[name=quoteId]');
      const filt = (inp, selEl, items, label) => inp.addEventListener('input', () => {
        const q = inp.value.toLowerCase().trim(), keep = selEl.value;
        const rows = items.filter(x => x.id === keep || !q || label(x).toLowerCase().includes(q) || (x.company || '').toLowerCase().includes(q));
        selEl.innerHTML = `<option value="">— ${selEl === sel ? 'choisir' : 'aucun'} —</option>` + rows.map(x => `<option value="${x.id}" ${x.id === keep ? 'selected' : ''}>${e(label(x))}</option>`).join('');
        const m = rows.filter(x => x.id !== keep); if (q && m.length === 1 && !keep) { selEl.value = m[0].id; selEl.dispatchEvent(new Event('change')); }
      });
      filt(cs, sel, clients, cLabel);
      if (qs) {
        filt(qs, qsel, quotes, qLabel);
        let auto = f.querySelector('[name=name]').value;
        qsel.addEventListener('change', () => {
          const d = quotes.find(x => x.id === qsel.value); if (!d) return;
          const nm = f.querySelector('[name=name]'), ad = f.querySelector('[name=address]');
          if (!nm.value || nm.value === auto) nm.value = auto = d.siteRef || cname(CM[d.clientId]) || '';
          if (d.clientId) { if (![...sel.options].some(o => o.value === d.clientId)) cs.value = ''; sel.value = d.clientId; }
          if (!ad.value && d.siteAddr) ad.value = d.siteAddr;
        });
        if (opts.quoteId) { qsel.value = opts.quoteId; qsel.dispatchEvent(new Event('change')); }
      }
    } });
  bindColors($('#modal'));
  addressAutocomplete($('#modal [name=address]'), it => { $('#modal [name=address]').value = it.label; });
  if (isNew && !opts.onSaved) $('#modal').addEventListener('close', () => { if (location.hash === '#/site/new') go('#/sites'); }, { once: true });
}

/* Produit ou frais rattaché au chantier mais non facturé : compté en charge dans la rentabilité */
function chargeModal(site, prods) {
  const sold = prods.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  modal('Charge non facturée', `<div class="cols">
    <label class="f full"><span>Produit (facultatif)</span><select name="pid"><option value="">— saisie libre —</option>${sold.map(p => `<option value="${p.id}">${e(p.name)}${p.kind === 'internal' ? ' (usage interne)' : ''}</option>`).join('')}</select></label>
    ${F('Désignation', 'label', '', { req: true, cls: 'full' })}
    ${F('Quantité', 'qty', 1, { type: 'number', step: 'any' })}${F('Unité', 'unit', 'u')}
    ${F('Coût unitaire HT (€)', 'cost', 0, { type: 'number', step: '0.01' })}${F('Date', 'date', today(), { type: 'date' })}
    <label class="f full" id="stk" hidden><span><input type="checkbox" name="stock"> Sortir aussi du stock (le produit est stocké)</span></label>
    ${F('Note', 'note', '', { cls: 'full' })}</div>`,
    async o => {
      const p = prods.find(x => x.id === o.pid);
      if (o.stock && p) {
        const { recordMove } = await import('./stock.js');
        const L = Object.entries(p.stock || {}).sort((a, b) => b[1] - a[1])[0];
        if (!L) throw new Error('Ce produit n\'a pas de stock.');
        await recordMove(p, { type: 'out', from: L[0], qty: num(o.qty), unit: num(o.cost), siteId: site.id, note: o.note || 'Charge chantier ' + o.label });
      } else {
        site.charges = [...(site.charges || []), { id: db.uid(), pid: o.pid || '', label: o.label.trim(), qty: num(o.qty), unit: o.unit, cost: num(o.cost), date: o.date, note: o.note }];
        await db.put('sites', site);
      }
      refresh();
    }, { onOpen: f => {
      const sel = f.querySelector('[name=pid]');
      sel.onchange = () => { const p = prods.find(x => x.id === sel.value); f.querySelector('#stk').hidden = !p; if (p) { f.querySelector('[name=label]').value = p.name; f.querySelector('[name=unit]').value = p.unit || 'u'; f.querySelector('[name=cost]').value = p.buy || 0; } };
    } });
}
