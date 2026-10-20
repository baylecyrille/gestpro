// Chantiers : fiche centrale qui relie client, devis, factures, avoirs et règlements.
import * as db from './db.js';
import { e, eur, num, round2, dateFr, cname, today, F, addressAutocomplete, filterBar, bindFilters, modal, toast, tabs, refresh, go, colorField, bindColors, $, $$ } from './util.js';
import { totals, paidOf, invBadge } from './docs.js';
import { siteTeamHtml, assignModal, siteHours } from './team.js';
import { siteMargin } from './finance.js';
import { doneBySite, fmtHM } from './hours.js';
import * as auth from './auth.js';
import * as lock from './lock.js';
import * as fl from './files.js';
import { getS } from './defaults.js';
import { nextSteps } from './nextstep.js';
import { estimateMargin, siteCompare, siteNeeds, reservations, stockOf } from './plan.js';
import { alertBox, confirmBox, promptBox } from './dialogs.js';
import { pickify } from './picker.js';

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
  const invoices = mine.filter(d => d.type === 'invoice' && d.status !== 'draft' && d.status !== 'cancelled');
  const credits = mine.filter(d => d.type === 'credit' && d.status !== 'draft');
  const sum = (l, f) => round2(l.reduce((a, d) => a + totals(d)[f], 0));
  const cut = credits.filter(d => d.nature === 'discount'); // avoir de remise accordée : le marché baisse d'autant (un avoir de correction se refacture)
  const marcheHT = round2(sum(signed, 'ht') - sum(cut, 'ht')), marcheTTC = round2(sum(signed, 'ttc') - sum(cut, 'ttc'));
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
  const [sites0, contacts, docs, payments, tasks, members] = await Promise.all([db.all('sites'), db.all('contacts'), db.all('documents'), db.all('payments'), db.all('tasks'), db.all('members')]);
  const MB = Object.fromEntries(members.map(m => [m.id, m]));
  const initials = n => (n || '?').split(/\s+/).filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
  const crew = sid => { const seen = new Set(), out = []; tasks.filter(t => t.siteId === sid).sort((a, b) => (b.start || '').localeCompare(a.start || '')).forEach(t => { const m = MB[t.memberId]; if (m && m.active !== false && !seen.has(m.id)) { seen.add(m.id); out.push(m); } }); return out; };
  const avatars = sid => { const l = crew(sid); return l.length ? `<span class="avs">${l.slice(0, 6).map(m => `<span class="avatar xs" style="background:${e(m.color || '#2f7ad6')}" title="${e(m.name)}">${e(initials(m.name))}</span>`).join('')}${l.length > 6 ? `<span class="more">+${l.length - 6}</span>` : ''}</span>` : ''; };
  const mine = onlyMine() ? mySites(tasks) : null, money = auth.can('sites.money'), canEdit = auth.can('sites.edit'), LK = await lock.allLocks();
  const sites = mine ? sites0.filter(s => mine.has(s.id)) : sites0;
  const C = Object.fromEntries(contacts.map(c => [c.id, c]));
  const cl = [...new Set(sites.map(s => s.clientId).filter(Boolean))].map(id => [id, C[id]?.name || '?']).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const nbBy = {}; sites.forEach(s => { nbBy[s.status] = (nbBy[s.status] || 0) + 1; }); // effectif de chaque statut, tous onglets confondus
  const FC = [{ id: 'sort', label: 'Trier par', def: 'recent', options: [['recent', 'Plus récents'], ['name', 'Nom A→Z'], ['client', 'Client A→Z'], ['start', 'Date de début'], ['end', 'Date de fin (proche)'], ['amount', 'Montant du marché'], ['due', 'Reste à payer']] },
    { id: 'status', type: 'multi', label: 'Statuts (cliquez pour filtrer, plusieurs possibles)', options: Object.entries(SS).map(([k, l]) => [k, `${l} (${nbBy[k] || 0})`]) },
    { id: 'client', label: 'Client', options: [['', 'Tous'], ...cl] }, { id: 'late', type: 'check', label: 'En retard' }, { id: 'due', type: 'check', label: 'Reste à payer' }];
  const inTab = s => tab === 'all' || (tab === 'open' ? OPEN.includes(s.status) : s.status === tab); // un statut choisi dans le filtre passe avant l'onglet
  el.innerHTML = `<h2>Chantiers</h2>${tabs('#/sites', [['open', 'Ouverts'], ['paid', 'Terminés'], ['lost', 'Perdus'], ['all', 'Tous']], tab)}
    <div class="row"><input class="search" id="q" type="search" placeholder="Rechercher (nom, client, adresse)…">${canEdit ? '<a class="btn primary" href="#/site/new">+ Chantier</a>' : ''}</div>
    ${filterBar(FC)}<div id="list"></div>`;
  const ST = Object.fromEntries(sites.map(s => [s.id, siteStats(s.id, docs, payments)]));
  const SORTS = { recent: (a, b) => (b._u || 0) - (a._u || 0), name: (a, b) => a.name.localeCompare(b.name, 'fr'), client: (a, b) => (C[a.clientId]?.name || '~').localeCompare(C[b.clientId]?.name || '~', 'fr'),
    start: (a, b) => (b.start || '').localeCompare(a.start || ''), end: (a, b) => (a.end || '9999').localeCompare(b.end || '9999'), amount: (a, b) => ST[b.id].marcheTTC - ST[a.id].marcheTTC, due: (a, b) => ST[b.id].resteAPayer - ST[a.id].resteAPayer };
  let getF;
  const draw = () => {
    const q = $('#q', el).value.toLowerCase(), F2 = getF ? getF() : {};
    const rows = sites.filter(s => ((F2.status || []).length ? F2.status.includes(s.status) : inTab(s)) && (!q || [s.name, C[s.clientId]?.name, C[s.moeId]?.name, s.address].join(' ').toLowerCase().includes(q)) && (!F2.client || s.clientId === F2.client) && (!F2.late || (OPEN.includes(s.status) && s.end && s.end < today())) && (!F2.due || ST[s.id].resteAPayer > 0.005))
      .sort(SORTS[F2.sort] || SORTS.recent);
    const byStat = (F2.status || []).length && tab !== 'all';
    $('#list', el).innerHTML = (byStat ? `<p class="cnote">Statut choisi : tous les chantiers de ce statut sont affichés, quel que soit l'onglet.</p>` : '') + (rows.map(s => {
      const st = siteStats(s.id, docs, payments);
      return `<a class="item${lock.lockCls(LK, s.id)}" href="#/site/${s.id}" style="text-decoration:none;color:inherit"><span class="dot" style="background:${e(s.color || '#2f7ad6')}"></span><div class="main"><div class="t">${e(s.name)}</div>
        <div class="s">${e(C[s.clientId]?.name || 'Sans client')}${s.address ? ' · ' + e(s.address.split('\n')[0]) : ''}</div>
        <div class="s">${s.start ? dateFr(s.start) : ''}${s.end ? ' → ' + dateFr(s.end) : ''}${C[s.moeId] ? ' · ' + e(C[s.moeId].name) : ''}${(s.links || []).length ? ' · 🔗 ' + s.links.length : ''}${(s.files || []).filter(fl.canSee).length ? ' · 📎 ' + (s.files || []).filter(fl.canSee).length : ''}</div>${avatars(s.id)}${gaugesHtml(siteGauges(s, st, money))}</div>
        <div class="r">${lock.lockTag(LK, s.id)}<span class="chip ${SCOL[s.status]}">${SS[s.status] || ''}</span>${money && st.marcheTTC ? `<div><b>${eur(st.marcheTTC)}</b></div>` : ''}${money && st.resteAPayer ? `<div class="s">reste ${eur(st.resteAPayer)}</div>` : ''}</div></a>`;
    }).join('') || `<div class="empty">Aucun chantier ici. Créez-en un pour y rattacher devis, factures et planning.</div>`);
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
  const [docs, payments, tasks, members, moves, times] = await Promise.all([db.all('documents'), db.all('payments'), db.all('tasks'), db.all('members'), db.all('moves'), db.all('times')]);
  const mg = siteMargin(site.id, docs, moves, tasks, members, site, times);
  const client = contacts.find(c => c.id === site.clientId), moe = contacts.find(c => c.id === site.moeId);
  const st = siteStats(site.id, docs, payments);
  const mine = docs.filter(d => d.siteId === site.id).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
  const [prods, allSites, Sg] = await Promise.all([db.all('products'), db.all('sites'), getS()]);
  /* M1 : prochaine étape du dossier, déduite des devis, factures, règlements et du planning (réservé à ceux qui voient les montants) */
  const steps = money ? nextSteps(site, { docs, payments, tasks, S: Sg, st }) : [];
  /* M3 / M4 / A7 : budget tiré des devis signés (prix d'achat des lignes, lignes de main d'œuvre en heures) comparé au réel */
  const PM = new Map(prods.map(p => [p.id, p])), MM = new Map(members.map(m => [m.id, m])), tm = siteHours(site.id, tasks, members, times);
  const { budget: bud, cmp } = money ? siteCompare(site, docs, { products: PM, members: MM }, Sg, mg, tm.planned) : { budget: null, cmp: null };
  const estBase = mg.marche || mg.base, est = money && mg.noCosts ? estimateMargin(estBase, bud) : null; // le coût prévu couvre tout le marché : on le compare au marché signé, pas à un simple acompte facturé
  const fh = h => fmtHM(h), fq = n => String(Math.round(n * 100) / 100).replace('.', ',');
  const toneOf = pct => (pct === null || pct === undefined ? '' : pct > 100 ? 'bad' : pct >= 85 ? 'warn' : ''), pbar = (pct, tone) => `<div class="bar ${tone}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>`;
  const pcrHtml = !money || !bud ? '' : cmp ? `<h3>Prévu contre réalisé</h3><div class="card pcr" id="pcr">
      ${cmp.hours.planned > 0 ? `<div class="pcrr"><span>Heures</span><b>${fh(cmp.hours.done)} faites sur ${fh(cmp.hours.planned)} prévues${cmp.hours.pct !== null ? ` (${cmp.hours.pct} %)` : ''}</b></div>${pbar(cmp.hours.pct, toneOf(cmp.hours.pct))}` : ''}
      ${cmp.total.planned > 0 ? `<div class="pcrr"><span>Matières, sous-traitance, charges</span><b>${eur(cmp.mat.real)} <small>sur ${eur(cmp.mat.planned)} prévus</small></b></div>
      <div class="pcrr"><span>Main-d'œuvre</span><b>${eur(cmp.mo.real)} <small>sur ${eur(cmp.mo.planned)} prévus</small></b></div>
      <div class="pcrr tot"><span>Coût total</span><b>${eur(cmp.total.real)} <small>sur ${eur(cmp.total.planned)} prévus${cmp.total.pct !== null ? ` (${cmp.total.pct} %)` : ''}</small></b></div>${pbar(cmp.total.pct, toneOf(cmp.total.pct))}` : ''}
      ${cmp.progress !== null ? `<div class="pcrr"><span>Avancement des travaux</span><b>${Math.round(cmp.progress)} %</b></div>` : ''}
      ${cmp.flags.map(f => `<div class="pcrf ${f.tone}">⚠ ${e(f.text)}</div>`).join('')}
      <p class="muted" style="margin:8px 0 0">Prévu d'après le devis signé (${bud.quotes.map(e).join(', ')}) : prix d'achat des lignes et lignes de main d'œuvre en heures.${bud.unknown ? ` ${bud.unknown} ligne${bud.unknown > 1 ? 's' : ''} sans prix d'achat : le coût prévu est incomplet.` : ''}${bud.estimated ? ` Main d'œuvre de ${bud.estimated} ligne${bud.estimated > 1 ? 's' : ''} chiffrée au coût horaire moyen de l'équipe.` : ''} Réel : sorties de stock, charges non facturées, heures saisies × coût horaire.${tm.planned && cmp.hours.planned ? ` Planning : ${fh(tm.planned)} affectées.` : ''}</p></div>`
    : bud.quotes.length ? `<h3>Prévu contre réalisé</h3><div class="card" id="pcr"><p class="muted" style="margin:0">Le devis signé ne contient ni prix d'achat ni ligne de main d'œuvre en heures : renseignez le « prix d'achat » des lignes du devis (ou composez des ouvrages) pour comparer le prévu au réel.</p></div>` : '';
  const stepHtml = steps.length ? (() => {
    const m = steps[0], more = steps.slice(1, 4).map(x => e(x.label));
    const btn = m.rel ? `<button type="button" class="btn primary" data-rel="${e(m.rel)}">↻ ${e(m.label)}</button>`
      : m.act === 'assign' && canAssign ? `<button type="button" class="btn primary" id="nsassign">${e(m.label)}</button>`
      : m.act === 'finish' ? (canEdit ? `<button type="button" class="btn primary" id="nsfinish">✓ ${e(m.label)}</button>` : '')
      : `<a class="btn primary" href="${e(m.href)}">${e(m.label)}</a>`;
    return `<div class="card nextstep ${m.tone}" id="nextstep"><div class="nsl">Prochaine étape</div><div class="nsr"><b>${e(m.text)}</b>${btn}</div>${more.length ? `<div class="s muted" style="margin-top:4px">Ensuite : ${more.join(' · ')}</div>` : ''}</div>` ;
  })() : '';
  const outs = {};
  for (const m of moves) if (m.siteId === site.id && m.type === 'out') outs[m.productId] = (outs[m.productId] || 0) + num(m.qty);
  const matRows = Object.entries(outs).map(([pid, q]) => { const p = prods.find(x => x.id === pid); return `<div class="item"><div class="main"><div class="t">${e(p?.name || 'Produit supprimé')}</div></div><div class="r"><b>${q} ${e(p?.unit || '')}</b></div></div>`; });
  /* M9 : matériel que les devis signés réservent, avec le manque éventuel (stock − réservé par tous les chantiers ouverts) */
  const needs = OPEN.includes(site.status) ? siteNeeds(site.id, docs, moves, PM) : new Map(), resv = reservations(allSites, docs, moves, PM);
  const needRows = [...needs].map(([pid, n]) => { const p = PM.get(pid); if (!p) return ''; const r = resv.get(pid), avail = stockOf(p) - (r ? r.reserved : 0), short = n.left > 0 && avail < -1e-9 ? -avail : 0;
    return `<div class="item need"><div class="main"><div class="t">${e(p.name)}</div><div class="s">besoin ${fq(n.need)} · déjà sorti ${fq(n.out)} · reste à sortir ${fq(n.left)} ${e(p.unit || '')} · en stock ${fq(stockOf(p))}</div></div><div class="r">${short ? `<span class="chip bad" title="Stock ${fq(stockOf(p))}, réservé par les devis signés ${fq(r.reserved)} (tous chantiers ouverts)">manque ${fq(short)}</span>` : n.left > 0 ? '<span class="chip ok">couvert</span>' : '<span class="chip ok">sorti</span>'}</div></div>`; }).join('');
  const needHtml = (auth.can('stock') || money) && needRows ? `<h3>Matériel à prévoir <span class="muted" style="font-size:12px;font-weight:400">· d'après le devis signé</span></h3>${needRows}` : '';
  const matHtml = auth.can('stock') || money ? `${needHtml}<h3>Matériel sorti du stock</h3>${matRows.join('') || '<p class="muted">Aucune sortie pour ce chantier.</p>'}${auth.can('stock') ? '<a class="btn sm" href="#/stock/moves">🏗 Sortie / mouvements</a>' : ''}` : '';
  const row = d => {
    const t = totals(d);
    const badge = d.type === 'invoice' || d.type === 'credit' ? invBadge(d, payments) : `<span class="chip ${d.status === 'accepted' || d.status === 'invoiced' ? 'ok' : d.status === 'refused' ? 'bad' : ''}">${{ draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé' }[d.status] || ''}</span>`;
    return `<a class="item" href="#/doc/${d.id}" style="text-decoration:none;color:inherit"><div class="main"><div class="t">${e(d.number || '(sans numéro)')}</div><div class="s">${dateFr(d.date)}${d.deposit ? ' · <b>Acompte</b>' : ''}</div></div><div class="r"><b>${d.type === 'credit' ? '− ' : ''}${eur(t.ttc)}</b><div>${badge}</div></div></a>`;
  };
  const sect = (title, type, label) => `<h3>${title}</h3>${mine.filter(d => d.type === type).map(row).join('') || '<p class="muted">Aucun.</p>'}${label ? `<a class="btn sm" href="#/doc/new/${type}-${site.id}">+ ${label}</a>` : ''}`;
  el.innerHTML = `<div class="row"><a class="btn ghost" href="#/sites">← Chantiers</a><span class="sp"></span>${canEdit ? `<button class="btn ${site.status === 'paid' ? '' : 'primary'}" id="finish">${site.status === 'paid' || site.status === 'lost' ? '↺ Rouvrir le chantier' : '✓ Terminer le chantier'}</button><button class="btn" id="edit">Modifier</button>` : ''}</div>
    <h2><span class="dot" style="background:${e(site.color || '#2f7ad6')}"></span> ${e(site.name)}</h2>
    <div class="card"><div class="row" style="margin:0"><select id="stat" style="width:auto" ${canEdit ? '' : 'disabled'}>${Object.entries(SS).map(([k, l]) => `<option value="${k}" ${k === site.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted">${site.start ? dateFr(site.start) : 'dates non fixées'}${site.end ? ' → ' + dateFr(site.end) : ''}</span></div>
      <p style="margin:8px 0 0"><b>${e(client?.name || 'Sans client')}</b>${client?.phone ? ` · <a href="tel:${e(client.phone)}">${e(client.phone)}</a>` : ''}<br>${e(site.address || '').replace(/\n/g, '<br>')}</p>
      ${site.address ? `<div class="row" style="margin:8px 0 0"><button class="btn" id="mapbtn" type="button">🗺 Plan</button><a class="btn primary" id="itin" target="_blank" rel="noopener" href="${e(mapsDir(site.address))}">🧭 Itinéraire</a><button class="btn" id="svbtn" type="button">👁 Street View</button><button class="btn" id="shbtn" type="button">📤 Envoyer</button></div><div id="mapbox" hidden></div>` : `<p class="muted" style="margin:8px 0 0">📍 Ajoutez l'adresse du chantier (bouton « Modifier ») pour afficher le plan et lancer l'itinéraire.</p>`}
      ${moe ? `<p style="margin:6px 0 0">🏛 <b>${e(moe.name)}</b>${moe.fonction ? ` <small class="muted">${e(moe.fonction)}</small>` : ''}${moe.company ? ` · ${e(moe.company)}` : ''}${moe.phone ? ` · <a href="tel:${e(moe.phone)}">${e(moe.phone)}</a>` : ''}${moe.email ? ` · <a href="mailto:${e(moe.email)}">${e(moe.email)}</a>` : ''}</p>` : ''}
      ${site.note ? `<p class="muted" style="white-space:pre-line">${e(site.note)}</p>` : ''}</div>
    ${stepHtml}
    <div id="sfiles"></div>
    <h3>Liens</h3><div class="card" id="lnks">${(site.links || []).map((l, i) => `<div class="lnk"><span>🔗</span><a href="${e(l.url)}" target="_blank" rel="noopener noreferrer">${e(l.label || l.url)}</a>${canEdit ? `<button class="btn sm" data-lnkedit="${i}" type="button">✎</button><button class="btn sm danger" data-lnkrm="${i}" type="button">✕</button>` : ''}</div>`).join('') || '<p class="muted" style="margin:0">Aucun lien. Ajoutez le lien d\'un dossier de plans, de photos ou de documents (Google Drive, Dropbox, OneDrive…).</p>'}${canEdit ? '<button class="btn sm" id="lnkadd" type="button" style="margin-top:8px">+ Ajouter un lien</button>' : ''}</div>
    ${gaugesBig(siteGauges(site, st, money), canEdit, site)}
    ${money ? `<div class="grid">
      <div class="kpi"><small>Marché signé (TTC)</small><b>${eur(st.marcheTTC)}</b><small>${eur(st.marcheHT)} HT${st.enAttenteTTC ? ` · ${eur(st.enAttenteTTC)} en attente` : ''}</small></div>
      <div class="kpi"><small>Facturé (TTC)</small><b>${eur(st.factureTTC)}</b><small>reste à facturer ${eur(st.resteFacturer)}</small></div>
      <div class="kpi ok"><small>Encaissé</small><b>${eur(st.encaisse)}</b></div>
      <div class="kpi ${st.resteAPayer ? 'warn' : ''}"><small>Reste à payer</small><b>${eur(st.resteAPayer)}</b>${st.aRembourser ? `<small>à rembourser au client : ${eur(st.aRembourser)}</small>` : ''}</div>
    </div>
    ${sect('Devis', 'quote', 'Devis')}${sect('Factures', 'invoice', 'Facture')}${mine.some(d => d.type === 'credit') ? sect('Avoirs', 'credit', '') : ''}` : ''}
    ${pcrHtml}
    ${siteTeamHtml(site.id, tasks, members, { edit: canAssign, money, times })}
    ${matHtml}
    ${money ? `<h3>Charges non facturées</h3><div class="card">${(site.charges || []).map((c, i) => `<div class="item" data-ch="${i}"><div class="main"><div class="t">${e(c.label)}</div><div class="s">${dateFr(c.date)} · ${num(c.qty)} ${e(c.unit || '')} × ${eur(num(c.cost))}${c.note ? ' · ' + e(c.note) : ''}</div></div><div class="r"><b>${eur(num(c.qty) * num(c.cost))}</b> <button class="btn sm danger" data-chrm="${i}">✕</button></div></div>`).join('') || '<p class="muted" style="margin-top:0">Aucune charge. Ajoutez ici les produits utilisés sur ce chantier mais non facturés au client : ils réduisent la marge.</p>'}${canEdit || auth.can('stock') ? '<button class="btn sm" id="addch">+ Produit / charge</button>' : ''}</div>
    <h3>Rentabilité</h3><div class="card"><div class="totals" style="margin:0;max-width:none">
      <div><span>${est ? 'Marché signé HT' : mg.previsionnel ? 'Marché signé HT (rien de facturé)' : 'Facturé HT (net des avoirs)'}</span><b>${eur(est ? estBase : mg.base)}</b></div>
      ${mg.noCosts ? (est ? `<div><span>− Coût prévu d'après le devis</span><b>${eur(bud.total)}</b></div>
      <div class="big"><span>Marge prévue d'après le devis</span><span style="color:${est.marge < 0 ? 'var(--bad)' : 'var(--ok)'}">${eur(est.marge)}${est.pct !== null ? ` (${est.pct} %)` : ''}</span></div>`
        : `<div class="big"><span>Marge</span><span style="color:var(--warn)">coûts non saisis</span></div>`)
      : `<div><span>− Matières sorties du stock</span><b>${eur(mg.matieres)}</b></div>
      <div><span>− Charges non facturées</span><b>${eur(mg.charges)}</b></div>
      <div><span>− Main-d'œuvre (${fmtHM(mg.hours)} × coût horaire)</span><b>${eur(mg.mo)}</b></div>
      <div class="big"><span>Marge ${mg.previsionnel ? 'prévisionnelle' : ''}</span><span style="color:${mg.marge < 0 ? 'var(--bad)' : 'var(--ok)'}">${eur(mg.marge)}${mg.pct !== null ? ` (${mg.pct} %)` : ''}</span></div>`}</div>
      ${mg.partiel && !mg.noCosts ? `<p class="invbanner" id="partnote" style="margin:10px 0 0">Seule une partie du marché est facturée (${eur(mg.fact)} sur ${eur(mg.marche)} HT) : cette marge compare <b>tous les coûts déjà engagés</b> à cette part seulement.${bud && bud.ok && bud.total > 0 ? ` Marge prévue sur tout le marché, d'après le devis : <b>${eur(mg.marche - bud.total)}</b>${mg.marche ? ` (${Math.round((mg.marche - bud.total) / mg.marche * 100)} %)` : ''}.` : ''}</p>` : ''}
      <p class="muted" style="margin-bottom:0" id="rentnote">${mg.noCosts ? (est ? `Aucun coût réel n'est encore saisi (sortie de stock, charge, heures) : cette marge est une estimation tirée des prix d'achat du devis${est.partial ? ` — ${bud.unknown} ligne${bud.unknown > 1 ? 's' : ''} sans prix d'achat, la marge réelle sera plus basse` : ''}.` : 'Aucun coût n\'est saisi, la marge ne peut pas être calculée : saisissez des sorties de stock, des charges ou des heures, ou renseignez le prix d\'achat des lignes du devis.') : 'Les matières viennent des sorties de stock rattachées à ce chantier (« Déduire du stock » depuis une facture finale, ou sortie manuelle avec chantier).'}</p></div>` : ''}
    ${canEdit ? '<div class="card" style="margin-top:14px"><button class="btn danger" id="del">Supprimer le chantier</button></div>' : ''}`;
  $('#stat', el).onchange = async ev => { site.status = ev.target.value; await db.put('sites', site); toast('Statut mis à jour'); refresh(); };
  const addr1 = (site.address || '').replace(/\s*\n\s*/g, ', ');
  $('#mapbtn', el)?.addEventListener('click', () => {
    const box = $('#mapbox', el);
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = `<iframe title="Plan" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:260px;border:0;border-radius:10px;margin-top:8px" src="https://maps.google.com/maps?q=${encodeURIComponent(addr1)}&z=15&output=embed"></iframe><p class="muted" style="margin:4px 0 0">Plan Google Maps (zoom, vue satellite et petit bonhomme Street View dans la carte) · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr1)}">Ouvrir dans Google Maps</a></p>`; box.hidden = false;
  });
  $('#svbtn', el)?.addEventListener('click', async () => {
    let url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr1);
    try {
      const r = await fetch('https://api-adresse.data.gouv.fr/search/?limit=1&q=' + encodeURIComponent(addr1)), j = await r.json(), c = j.features?.[0]?.geometry?.coordinates;
      if (c) url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c[1]},${c[0]}`;
    } catch { /* repli : recherche Google Maps */ }
    window.open(url, '_blank', 'noopener');
  });
  $('#shbtn', el)?.addEventListener('click', async () => {
    const url = mapsDir(site.address), data = { title: site.name, text: `${site.name} – ${addr1}`, url };
    try { if (navigator.share) { await navigator.share(data); return; } } catch (err) { if (err && err.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${data.text}\n${url}`); toast('Adresse et lien d\'itinéraire copiés'); } catch { (await promptBox('Copiez ce lien :', url)); }
  });
  $('#prog', el)?.addEventListener('input', ev => { $('#pv', el).textContent = ev.target.value + ' %'; });
  $('#prog', el)?.addEventListener('change', async ev => { site.progress = +ev.target.value; await db.put('sites', site); refresh(); });
  if (canAssign) $('#assign', el).onclick = () => assignModal(null, { siteId: site.id });
  $('#nsassign', el)?.addEventListener('click', () => assignModal(null, { siteId: site.id }));
  $('#nsfinish', el)?.addEventListener('click', () => $('#finish', el)?.click());
  $$('#nextstep [data-rel]', el).forEach(b => b.addEventListener('click', () => import('./docmail.js').then(m => m.relanceModal(b.dataset.rel, () => refresh()))));
  $$('[data-mem]', el).forEach(n => n.onclick = () => go('#/planning/week'));
  $$('[data-chrm]', el).forEach(b => b.onclick = async () => { if (!(await confirmBox('Supprimer cette charge ?'))) return; site.charges.splice(+b.dataset.chrm, 1); await db.put('sites', site); refresh(); });
  $('#addch', el)?.addEventListener('click', () => chargeModal(site, prods));
  { const S0 = await getS(), rich = auth.can('sites.money');
    fl.filesCard({ host: $('#sfiles', el), title: 'Photos & fichiers', canEdit: canEdit || auth.can('sites'), px: S0.photoPx || 2560, kinds: rich ? ['photos', 'autres', 'devis', 'factures', 'achats'] : ['photos', 'autres'],
      list: () => site.files || [], path: k => fl.sitePath(site, k),
      add: async a => { if (!a.pending) delete a.path; site.files = [...(site.files || []), a]; await db.put('sites', site); },
      remove: async a => { site.files = (site.files || []).filter(x => x.id !== a.id); await db.put('sites', site); } }); }
  $('#lnkadd', el)?.addEventListener('click', () => linkModal(site, -1));
  $$('[data-lnkedit]', el).forEach(b => b.onclick = () => linkModal(site, +b.dataset.lnkedit));
  $$('[data-lnkrm]', el).forEach(b => b.onclick = async () => { if (!(await confirmBox('Retirer ce lien ?'))) return; site.links.splice(+b.dataset.lnkrm, 1); await db.put('sites', site); refresh(); });
  if (!canEdit) return;
  $('#edit', el).onclick = () => lock.withLock(site.id, () => siteModal(site, clients, false, { moes: contacts.filter(c => c.kind === 'moe') }));
  $('#finish', el).onclick = async () => {
    const closed = site.status === 'paid' || site.status === 'lost';
    if (!closed && st.resteAPayer > 0.005 && !(await confirmBox(`Il reste ${eur(st.resteAPayer)} à encaisser sur ce chantier. Le terminer quand même ?`))) return;
    site.status = closed ? (mine.some(d => d.type === 'invoice') ? 'progress' : 'signed') : 'paid';
    if (!closed && !site.end) site.end = today();
    await db.put('sites', site); toast(closed ? 'Chantier rouvert' : 'Chantier terminé'); refresh();
  };
  $('#del', el).onclick = async () => {
    /* Un chantier qui a déjà des documents, des achats, du matériel sorti ou des heures ne se supprime pas : on perdrait la trace des coûts et des factures (audit A5) */
    const hasHours = times.some(x => x.kind === 'site' && x.siteId === site.id) || Object.values(doneBySite(site.id, tasks, times)).some(h => h > 0);
    const used = [mine.length && `${mine.length} document${mine.length > 1 ? 's' : ''} (devis, factures, avoirs)`, (site.charges || []).length && `${site.charges.length} charge${site.charges.length > 1 ? 's' : ''} ou achat${site.charges.length > 1 ? 's' : ''}`,
      moves.some(m => m.siteId === site.id) && 'du matériel sorti du stock', hasHours && 'des heures saisies'].filter(Boolean);
    if (used.length) { alertBox(`Ce chantier ne peut pas être supprimé : il comporte ${used.join(', ')}.\n\nTerminez-le (« ✓ Terminer le chantier ») ou passez-le en « Perdu » via « Modifier » : il sort des chantiers en cours sans rien perdre.`); return; }
    if (!(await confirmBox('Supprimer ce chantier ? Les devis et factures sont conservés (ils perdent seulement le lien) ; le planning de ce chantier est supprimé.'))) return;
    for (const d of mine) { d.siteId = ''; await db.put('documents', d); }
    for (const t of tasks.filter(x => x.siteId === site.id)) await db.del('tasks', t.id);
    await db.del('sites', site.id); go('#/sites');
  };
}

export const mapsDir = addr => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(String(addr || '').replace(/\s*\n\s*/g, ', '));

/* Couleur d'un nouveau chantier : au hasard parmi celles qu'aucun chantier en cours n'utilise (celles des chantiers terminés sont réutilisables) */
export const SITE_PALETTE = ['#2f7ad6', '#1b8a4b', '#c77700', '#c62f2f', '#7b4fd0', '#0f9aa8', '#555d6b', '#d6336c', '#2b8a3e', '#e67700', '#1971c2', '#9c36b5', '#0b7285', '#a61e4d', '#5c940d', '#e8590c', '#3b5bdb', '#862e9c', '#087f5b', '#b36b00', '#c2255c', '#364fc7', '#66a80f', '#c92a2a'];
export function pickSiteColor(sites, excludeId) {
  const used = new Set(sites.filter(s => s.id !== excludeId && OPEN.includes(s.status)).map(s => String(s.color || '').toLowerCase()));
  const free = SITE_PALETTE.filter(c => !used.has(c));
  const pool = free.length ? free : SITE_PALETTE;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* Création d'un chantier : pre = valeurs préremplies (clientId, name, address, quoteId) ; onSaved(site) remplace la redirection */
export async function newSiteModal(pre = {}, onSaved) {
  const [contacts, docs, allSites] = await Promise.all([db.all('contacts'), db.all('documents'), db.all('sites')]);
  const clients = contacts.filter(c => c.kind === 'client').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const { quoteId, ...rest } = pre;
  siteModal({ name: '', clientId: '', address: '', start: '', end: '', status: 'new', note: '', color: pickSiteColor(allSites), ...rest }, clients, true, { docs, contacts, quoteId, onSaved, moes: contacts.filter(c => c.kind === 'moe') });
}

function siteModal(site, clients, isNew, opts = {}) {
  const docs = opts.docs || [], CM = Object.fromEntries((opts.contacts || clients).map(c => [c.id, c])), SITES = {};
  const quotes = isNew ? docs.filter(d => d.type === 'quote').sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number)) : [];
  const qLabel = d => `${d.number || '(sans n°)'} — ${cname(CM[d.clientId]) || 'sans client'}${d.siteRef ? ' — ' + d.siteRef : ''} — ${eur(totals(d).ttc)}${d.siteId ? ' · déjà rattaché à un chantier' : ''}`;
  const cLabel = c => cname(c) + (c.city ? ' — ' + c.city : '') + (c.zip ? ' (' + c.zip + ')' : '');
  modal(isNew ? 'Nouveau chantier' : 'Modifier le chantier',
    `<div class="cols">${F('Nom du chantier', 'name', site.name, { req: true, cls: 'full', ph: 'ex : Terrasse bois – Dupont' })}
    ${quotes.length ? `<label class="f full"><span>Créer à partir d'un devis (facultatif)</span><select name="quoteId"><option value="">— aucun —</option>${quotes.map(d => `<option value="${d.id}">${e(qLabel(d))}</option>`).join('')}</select></label>` : ''}
    <label class="f full"><span>Client</span><select name="clientId"><option value="">— choisir —</option>${clients.map(c => `<option value="${c.id}" data-q="${e(c.company || '')}" ${c.id === site.clientId ? 'selected' : ''}>${e(cLabel(c))}</option>`).join('')}</select></label>
    <label class="f full"><span>Architecte / maître d'œuvre (facultatif — à créer dans Contacts)</span><select name="moeId"><option value="">— aucun —</option>${(opts.moes || []).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(c => `<option value="${c.id}" ${c.id === site.moeId ? 'selected' : ''}>${e(c.name)}${c.fonction ? ' (' + e(c.fonction) + ')' : ''}</option>`).join('')}</select></label>
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
      const sel = f.querySelector('[name=clientId]'), qsel = f.querySelector('[name=quoteId]');
      pickify(sel, { placeholder: '🔍 Rechercher un client (nom, ville, code postal)…' });
      if (qsel) {
        pickify(qsel, { placeholder: '🔍 N° de devis, client, référence…' });
        let auto = f.querySelector('[name=name]').value;
        qsel.addEventListener('change', () => {
          const d = quotes.find(x => x.id === qsel.value); if (!d) return;
          const nm = f.querySelector('[name=name]'), ad = f.querySelector('[name=address]');
          if (!nm.value || nm.value === auto) nm.value = auto = d.siteRef || cname(CM[d.clientId]) || '';
          if (d.clientId) { sel.value = d.clientId; sel.dispatchEvent(new Event('change', { bubbles: true })); }
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
      pickify(sel, { placeholder: '🔍 Rechercher un produit du catalogue…' });
      sel.onchange = () => { const p = prods.find(x => x.id === sel.value); f.querySelector('#stk').hidden = !p; if (p) { f.querySelector('[name=label]').value = p.name; f.querySelector('[name=unit]').value = p.unit || 'u'; f.querySelector('[name=cost]').value = p.buy || 0; } };
    } });
}

/* Lien vers un dossier de documents / photos (Drive, Dropbox…) : léger et synchronisé avec le chantier */
function linkModal(site, idx) {
  const l = idx >= 0 ? site.links[idx] : { label: '', url: '' };
  modal(idx >= 0 ? 'Modifier le lien' : 'Ajouter un lien', `<div class="cols">${F('Nom (ex : Plans, Photos avant travaux)', 'label', l.label, { cls: 'full' })}${F('Adresse du lien (https://…)', 'url', l.url, { req: true, cls: 'full', ph: 'https://…' })}</div>
    <p class="muted">Collez le lien de partage d'un dossier ou d'un fichier (Google Drive, Dropbox, OneDrive, site web…). Les fichiers eux-mêmes restent chez vous, seul le lien est enregistré.</p>`,
    async o => {
      let url = o.url.trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const rec = { id: l.id || db.uid(), label: o.label.trim() || url.replace(/^https?:\/\//, '').slice(0, 40), url };
      site.links = site.links || []; idx >= 0 ? (site.links[idx] = rec) : site.links.push(rec);
      await db.put('sites', site); refresh();
    });
}
