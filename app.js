// Point d'entrée : routeur, tableau de bord, contacts (clients / fournisseurs), réglages, sauvegarde.
import * as db from './db.js';
import { DEFAULTS, getS, logoSrc } from './defaults.js';
import { e, eur, num, dateFr, today, F, modal, toast, tabs, refresh, downloadFile, readFileText, compressImage, scan, savedCamera, resetCamera, cname, addressAutocomplete, filterBar, bindFilters, CIVS, splitCiv, bindColors, colorField, $, $$ } from './util.js';
import { renderStock, ensureDefaultLocation, total } from './stock.js';
import { renderDocs, renderDoc, totals, paidOf, payState, zoneDefs, counts } from './docs.js';
import { renderFacebook } from './facebook.js';
import { renderSites, renderSite, siteStats, siteGauges, gaugesHtml, SS } from './sites.js';
import { renderPlanning, covers, habState } from './team.js';
import { PERIODS, periodRange, summary, monthly, siteMargin, weekDays } from './finance.js';
import * as sheets from './sheets.js';
import * as auth from './auth.js';
import * as lock from './lock.js';
import { MAIL_DEFAULTS, MAIL_TOKENS, mailError } from './docmail.js';

/* ---------- Fond d'écran (logo) ---------- */
export function applyWallpaper(S) {
  const nm = (S.appName || '').trim() || 'GestPro';
  const bn = document.querySelector('.brand .bname'); if (bn) bn.textContent = nm;
  const bl = document.querySelector('.brand .blogo img'); if (bl) bl.src = logoSrc(S);
  document.title = nm + ' – Stock, devis, factures';
  const r = document.documentElement.style;
  if (S.wallpaper === false) { r.setProperty('--logo', 'none'); return; }
  r.setProperty('--logo', `url("${logoSrc(S)}")`);
}

/* ---------- Contacts ---------- */
/* Devis, chantiers, factures et avoirs rattachés à un client (dans sa fiche) */
async function fillRel(f, c) {
  const [docs, sites, pays] = await Promise.all([db.all('documents'), db.all('sites'), db.all('payments')]);
  const mine = docs.filter(d => d.clientId === c.id).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
  const doc = d => { const t = totals(d); return `<a class="item" href="#/doc/${d.id}"><div class="main"><div class="t">${e(d.number || '(sans numéro)')}</div><div class="s">${dateFr(d.date)}${d.siteRef ? ' · ' + e(d.siteRef) : ''}</div></div><div class="r"><b>${d.type === 'credit' ? '− ' : ''}${eur(t.ttc)}</b></div></a>`; };
  const blk = (title, list, fn) => `<h4>${title} (${list.length})</h4>${list.map(fn).join('') || '<p class="muted" style="margin:0">Aucun.</p>'}`;
  const sl = sites.filter(s => s.clientId === c.id).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const box = f.querySelector('#rel'); if (!box) return;
  box.innerHTML = `<div class="row" style="margin:0 0 6px"><button type="button" class="btn sm primary" id="relnewsite">+ Chantier pour ce client</button></div>` + blk('Chantiers', sl, s => `<a class="item" href="#/site/${s.id}"><div class="main"><div class="t">${e(s.name)}</div><div class="s">${e(SS[s.status] || '')}</div>${gaugesHtml(siteGauges(s, siteStats(s.id, docs, pays), auth.can('sites.money')))}</div></a>`)
    + blk('Devis', mine.filter(d => d.type === 'quote'), doc) + blk('Factures', mine.filter(d => d.type === 'invoice'), doc) + blk('Avoirs', mine.filter(d => d.type === 'credit'), doc);
  box.addEventListener('click', ev => { if (ev.target.closest('a')) document.querySelector('#modal').close(); });
  box.querySelector('#relnewsite').onclick = () => { document.querySelector('#modal').close(); import('./sites.js').then(m => m.newSiteModal({ clientId: c.id, name: cname(c), address: [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join('\n') })); };
}
export function contactModal(c, kind, onSaved) {
  const isNew = !c; c = c || { kind };
  const body = `<div class="cols"><label class="f"><span>Civilité / forme (libre)</span><input name="civ" value="${e(c.civ || '')}" list="civs" placeholder="Mr, Mme, Mr et Mme, SARL…" autocomplete="off"><datalist id="civs">${CIVS.map(x => `<option value="${e(x)}">`).join('')}</datalist></label>${F('Nom / raison sociale', 'name', c.name, { req: true })}
    <label class="f"><span>Civilité du contact</span><input name="companyCiv" value="${e(c.companyCiv || '')}" list="civs" autocomplete="off" placeholder="Mr, Mme…"></label>${F('Contact (personne)', 'company', c.company)}
    ${F('Adresse', 'address', c.address, { cls: 'full' })}${F('Code postal', 'zip', c.zip)}${F('Ville', 'city', c.city)}
    ${F('Téléphone', 'phone', c.phone, { type: 'tel' })}${F('E-mail', 'email', c.email, { type: 'email' })}
    ${c.kind === 'moe' ? `<label class="f"><span>Fonction</span><input name="fonction" value="${e(c.fonction || '')}" list="fonctions" placeholder="Architecte, maître d'œuvre…" autocomplete="off"><datalist id="fonctions">${['Architecte', 'Maître d\'œuvre', 'Bureau d\'études', 'Économiste', 'Conducteur de travaux', 'Coordinateur SPS', 'Autre'].map(x => `<option value="${x}">`).join('')}</datalist></label>` : ''}
    ${F('SIRET', 'siret', c.siret, { cls: 'full' })}${F('Note', 'note', c.note, { type: 'textarea', rows: 2, cls: 'full' })}</div>${!isNew && c.kind === 'client' ? '<div class="rel" id="rel"></div>' : ''}`;
  modal(`${isNew ? 'Nouveau' : 'Fiche'} ${c.kind === 'supplier' ? 'fournisseur' : c.kind === 'moe' ? 'architecte / maître d\'œuvre' : 'client'}`, body, async o => {
    Object.assign(c, o); const s = await db.put('contacts', c);
    if (onSaved) onSaved(s); else refresh();
  }, { onOpen: f => { addressAutocomplete(f.querySelector('[name=address]'), it => { f.querySelector('[name=address]').value = it.street; f.querySelector('[name=zip]').value = it.zip; f.querySelector('[name=city]').value = it.city; }); if (!isNew && c.kind === 'client') fillRel(f, c); }, del: isNew ? null : async () => {
    const [docs, sites] = await Promise.all([db.all('documents'), db.all('sites')]);
    if (docs.some(d => d.clientId === c.id)) return alert('Ce contact a des devis/factures : suppression impossible.');
    const used = sites.filter(x => x.clientId === c.id || x.moeId === c.id);
    if (used.length && c.kind === 'client') return alert(`Ce client a ${used.length} chantier(s) (${used.slice(0, 3).map(x => x.name).join(', ')}${used.length > 3 ? '…' : ''}) : supprimez-les ou changez leur client d'abord.`);
    if (used.length && !confirm(`Ce contact est rattaché à ${used.length} chantier(s). Le supprimer quand même (les chantiers perdent seulement ce lien) ?`)) return;
    await db.del('contacts', c.id); refresh(); } });
}

/* Équipe dans les contacts : mêmes fiches que « Équipe / planning » (une seule source) */
async function renderTeamContacts(el) {
  const { memberModal, ROLES } = await import('./team.js');
  const members = (await db.all('members')).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const R = Object.fromEntries(ROLES), edit = auth.can('team.edit') || auth.can('settings'), LK = await lock.allLocks();
  el.innerHTML = `<h2>Contacts</h2>${tabs('#/contacts', [['client', 'Clients'], ['supplier', 'Fournisseurs'], ['moe', 'Architectes / MOE'], ['team', 'Équipe']], 'team')}
    <div class="row"><input class="search" id="q" type="search" placeholder="Rechercher…">${edit ? '<button class="btn primary" id="add">+ Membre</button>' : ''}</div><div id="list"></div>`;
  const draw = () => {
    const q = $('#q', el).value.toLowerCase();
    $('#list', el).innerHTML = members.filter(m => !q || [m.name, m.first, m.phone, m.email, R[m.role]].join(' ').toLowerCase().includes(q)).map(m => `<div class="item${lock.lockCls(LK, m.id)}" data-id="${m.id}" ${m.active === false ? 'style="opacity:.55"' : ''}>${m.photo ? `<img class="av" style="width:38px;height:38px;margin:0" src="${e(m.photo)}" alt="">` : `<span class="avatar" style="background:${e(m.color || '#2f7ad6')}">${e((m.name || '?').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase())}</span>`}
      <div class="main"><div class="t">${e(m.name)} <small class="muted">${e(R[m.role] || '')}${m.active === false ? ' · inactif' : ''}</small></div><div class="s">${[m.phone, m.email].filter(Boolean).map(e).join(' · ')}</div></div>
      <div class="r">${lock.lockTag(LK, m.id)}${m.phone ? `<a class="btn sm" href="tel:${e(m.phone)}" onclick="event.stopPropagation()">📞</a>` : ''}</div></div>`).join('') || '<div class="empty">Aucun membre.</div>';
  };
  draw(); $('#q', el).oninput = draw;
  $('#add', el)?.addEventListener('click', () => memberModal());
  $('#list', el).onclick = ev => { const it = ev.target.closest('.item'); if (it && !ev.target.closest('a') && edit) lock.withLock(it.dataset.id, () => memberModal(members.find(m => m.id === it.dataset.id))); };
}

async function renderContacts(el, tab = 'client') {
  if (tab === 'team') return renderTeamContacts(el);
  const [contacts, docs, payments] = await Promise.all([db.all('contacts'), db.all('documents'), db.all('payments')]);
  const LK = await lock.allLocks();
  const dueOf = c => docs.filter(d => d.clientId === c.id && d.type === 'invoice' && counts(d)).reduce((a, d) => a + totals(d).ttc - paidOf(payments, d.id), 0);
  const DUE = Object.fromEntries(contacts.map(c => [c.id, tab === 'client' ? dueOf(c) : 0]));
  const NDOC = Object.fromEntries(contacts.map(c => [c.id, docs.filter(d => d.clientId === c.id).length]));
  const list = contacts.filter(c => c.kind === tab);
  const cities = [...new Set(list.map(c => c.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const FC = [{ id: 'sort', label: 'Trier par', def: 'name', options: [['name', 'Nom A→Z'], ['city', 'Ville'], ['zip', 'Code postal'], ['due', 'Solde dû ↓'], ['docs', 'Nombre de documents ↓'], ['recent', 'Plus récents']] },
    { id: 'city', label: 'Ville', options: [['', 'Toutes'], ...cities.map(c => [c, c])] }, { id: 'due', type: 'check', label: 'Solde dû' }, { id: 'phone', type: 'check', label: 'Avec téléphone' }, { id: 'nodoc', type: 'check', label: 'Sans document' }];
  const SORTS = { name: (a, b) => a.name.localeCompare(b.name, 'fr'), city: (a, b) => (a.city || '~').localeCompare(b.city || '~', 'fr') || a.name.localeCompare(b.name, 'fr'), zip: (a, b) => (a.zip || '~').localeCompare(b.zip || '~'),
    due: (a, b) => DUE[b.id] - DUE[a.id], docs: (a, b) => NDOC[b.id] - NDOC[a.id], recent: (a, b) => (b._u || 0) - (a._u || 0) };
  el.innerHTML = `<h2>Contacts</h2>${tabs('#/contacts', [['client', 'Clients'], ['supplier', 'Fournisseurs'], ['moe', 'Architectes / MOE'], ['team', 'Équipe']], tab)}
    <div class="row"><input class="search" id="q" type="search" placeholder="Rechercher…"><button class="btn primary" id="add">+ ${tab === 'client' ? 'Client' : tab === 'moe' ? 'Architecte / MOE' : 'Fournisseur'}</button></div>${filterBar(FC)}<div id="list"></div>`;
  let getF;
  const draw = () => {
    const q = $('#q', el).value.toLowerCase(), F2 = getF ? getF() : {};
    $('#list', el).innerHTML = list.filter(c => (!F2.city || c.city === F2.city) && (!F2.due || DUE[c.id] > 0.005) && (!F2.phone || c.phone) && (!F2.nodoc || !NDOC[c.id])).sort(SORTS[F2.sort] || SORTS.name).filter(c => !q || [c.civ, c.name, c.company, c.city, c.phone, c.email].join(' ').toLowerCase().includes(q)).map(c => {
      let due = 0;
      if (tab === 'client') docs.filter(d => d.clientId === c.id && d.type === 'invoice' && counts(d)).forEach(d => (due += totals(d).ttc - paidOf(payments, d.id)));
      return `<div class="item${lock.lockCls(LK, c.id)}" data-id="${c.id}"><div class="main"><div class="t">${e(cname(c))}</div><div class="s">${[c.zip && c.city ? c.zip + ' ' + c.city : c.city, c.phone, c.email].filter(Boolean).map(e).join(' · ')}</div></div>
        <div class="r">${lock.lockTag(LK, c.id)}${due > 0.005 ? `<span class="chip bad">dû ${eur(due)}</span>` : ''}${c.phone ? `<a class="btn sm" href="tel:${e(c.phone)}" onclick="event.stopPropagation()">📞</a>` : ''}</div></div>`;
    }).join('') || '<div class="empty">Aucune fiche.</div>';
  };
  getF = bindFilters(el, 'contacts_' + tab + '_', FC, draw);
  draw(); $('#q', el).oninput = draw;
  $('#add', el).onclick = () => contactModal(null, tab);
  $('#list', el).onclick = ev => { const it = ev.target.closest('.item'); if (it && !ev.target.closest('a')) lock.withLock(it.dataset.id, () => contactModal(list.find(c => c.id === it.dataset.id))); };
}

/* ---------- Tableau de bord ---------- */
async function renderDashboard(el) {
  const [products, docs, payments, posts, contacts, S, sites, members, tasks, moves] = await Promise.all([db.all('products'), db.all('documents'), db.all('payments'), db.all('fbposts'), db.all('contacts'), getS(), db.all('sites'), db.all('members'), db.all('tasks'), db.all('moves')]);
  let per = 'd30', pc = {}; try { per = localStorage.getItem('gp_period') || 'd30'; pc = { from: localStorage.getItem('gp_pfrom') || '', to: localStorage.getItem('gp_pto') || '' }; } catch { /* ignore */ }
  if (!PERIODS.some(p => p[0] === per)) per = 'd30';
  const range = periodRange(per, today(), pc);
  const sm = summary(range, docs, payments, moves, products, sites);
  const stockValue = products.reduce((a, p) => a + total(p) * (p.buy || 0), 0);
  const low = products.filter(p => total(p) <= (p.min || 0) && (p.min || 0) > 0 || total(p) < 0);
  const invoices = docs.filter(d => d.type === 'invoice' && counts(d));
  const unpaidList = invoices.map(d => ({ d, left: Math.max(0, totals(d).ttc - paidOf(payments, d.id)) })).filter(x => x.left > 0.005).sort((a, b) => a.d.date.localeCompare(b.d.date));
  const unpaid = unpaidList.reduce((a, x) => a + x.left, 0);
  const recent = new Date(Date.parse(today()) - 90 * 864e5).toISOString().slice(0, 10); // « en attente » = envoyés depuis moins de 90 jours
  const quotesPending = docs.filter(d => d.type === 'quote' && d.status === 'sent' && (d.date || '') >= recent);
  const toPost = posts.filter(p => p.status === 'scheduled' && p.date && p.date <= today());
  const C = Object.fromEntries(contacts.map(c => [c.id, c]));
  const SI = Object.fromEntries(sites.map(x => [x.id, x]));
  // « Pour démarrer » : disparaît tout seul quand toutes les étapes sont faites (ou via « Masquer »)
  const steps = [
    ['Compléter l\'entreprise (IBAN, BIC, logo) dans Réglages', !!S.iban, '#/settings'],
    ['Connecter Google Sheets (stockage des données)', sheets.configured(), '#/settings'],
    ['Ajouter ou importer vos produits', products.length > 0, '#/stock/products'],
    ['Ajouter un premier client', contacts.some(c => c.kind === 'client'), '#/contacts/client'],
    ['Créer un premier devis', docs.some(d => d.type === 'quote'), '#/doc/new/quote']
  ];
  const left = steps.filter(x => !x[1]).length;
  const startCard = left && localStorage.getItem('gp_hide_start') !== '1'
    ? `<div class="card start"><b>Pour démarrer</b> <span class="muted">· ${steps.length - left}/${steps.length} étapes faites</span>
        <div class="bar" style="margin:6px 0"><i style="width:${(steps.length - left) / steps.length * 100}%"></i></div>
        ${steps.map(([l, ok, h]) => `<div>${ok ? '✅' : '⬜'} ${ok ? `<s class="muted">${e(l)}</s>` : `<a href="${h}">${e(l)}</a>`}</div>`).join('')}
        <div class="row" style="margin:8px 0 0"><button class="btn sm" id="hidestart">Masquer</button></div></div>` : '';

  // courbe 12 mois (CA et achats HT) : repères de montant, mois lisibles, valeurs du mois en cours en légende
  const ser = monthly(docs, moves, products, today(), 12, sites);
  const rawMax = Math.max(1, ...ser.map(o => Math.max(o.ca, o.achats)));
  const step = 10 ** Math.floor(Math.log10(rawMax)), max = Math.ceil(rawMax / step) * step; // sommet « rond » de l'échelle
  const bw = 600 / ser.length, H = 130, X0 = 0;
  const MI = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
  const kfmt = v => (v >= 1000 ? (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k€' : Math.round(v) + ' €');
  const cur = ser[ser.length - 1];
  const chart = `<svg viewBox="0 0 600 ${H + 24}" style="width:100%;height:auto" role="img" aria-label="Chiffre d'affaires et achats sur 12 mois">
    ${[0.5, 1].map(f => `<line x1="${X0}" x2="600" y1="${H - H * f}" y2="${H - H * f}" stroke="var(--bd)" stroke-dasharray="3 4"/><text x="${X0 + 2}" y="${H - H * f - 4}" font-size="13" fill="var(--mut)">${kfmt(max * f)}</text>`).join('')}
    ${ser.map((o, i) => { const x = i * bw, h1 = Math.max(0, o.ca) / max * H, h2 = o.achats / max * H, last = i === ser.length - 1;
      return `<rect x="${x + 5}" y="${H - h1}" width="${bw / 2 - 6}" height="${h1}" rx="3" fill="var(--p)" opacity="${last ? 1 : .78}"><title>${o.ym} · CA ${eur(o.ca)}</title></rect><rect x="${x + bw / 2 + 1}" y="${H - h2}" width="${bw / 2 - 6}" height="${h2}" rx="3" fill="var(--warn)" opacity="${last ? 1 : .78}"><title>${o.ym} · achats ${eur(o.achats)}</title></rect>
      <text x="${x + bw / 2}" y="${H + 17}" font-size="14" text-anchor="middle" font-weight="${last ? 700 : 400}" fill="${last ? 'var(--tx)' : 'var(--mut)'}">${MI[+o.ym.slice(5) - 1]}</text>`; }).join('')}
    <line x1="${X0}" x2="600" y1="${H}" y2="${H}" stroke="var(--bd)"/></svg>
    <p class="cnote" style="margin:2px 0 0">${MI[+cur.ym.slice(5) - 1]}. en cours : CA <b>${eur(cur.ca)}</b> · achats <b>${eur(cur.achats)}</b></p>`;

  // chantiers ouverts avec marge
  const open = sites.filter(x => ['new', 'signed', 'progress'].includes(x.status)).sort((a, b) => (b._u || 0) - (a._u || 0)).slice(0, 8);
  const siteRows = open.map(x => { const g = siteMargin(x.id, docs, moves, tasks, members, x); const st = siteStats(x.id, docs, payments);
    return `<a class="item" href="#/site/${x.id}" style="text-decoration:none;color:inherit"><span class="dot" style="background:${e(x.color || '#2f7ad6')}"></span><div class="main"><div class="t">${e(x.name)}</div><div class="s">${e(C[x.clientId]?.name || '')} · ${SS[x.status]}${st.resteAPayer ? ' · reste à payer ' + eur(st.resteAPayer) : ''}</div>${gaugesHtml(siteGauges(x, st, auth.can('sites.money')))}</div>
      <div class="r"><b style="color:${g.marge < 0 ? 'var(--bad)' : 'var(--ok)'}">${g.base ? eur(g.marge) : '—'}</b><div class="s">${g.pct !== null ? g.pct + ' % de marge' : 'marge'}${g.previsionnel ? ' (prév.)' : ''}</div></div></a>`; }).join('');

  // chantiers en retard : date de fin dépassée et chantier encore ouvert
  const lateSites = sites.filter(x => ['new', 'signed', 'progress'].includes(x.status) && x.end && x.end < today()).sort((a, b) => a.end.localeCompare(b.end));
  const lateHtml = lateSites.length ? `<h3>Chantiers en retard</h3>${lateSites.slice(0, 8).map(x => `<a class="item" href="#/site/${x.id}" style="text-decoration:none;color:inherit"><span class="dot" style="background:${e(x.color || '#2f7ad6')}"></span><div class="main"><div class="t">${e(x.name)}</div><div class="s">${e(C[x.clientId]?.name || '')} · fin prévue le ${dateFr(x.end)}</div>${gaugesHtml(siteGauges(x, siteStats(x.id, docs, payments), auth.can('sites.money')))}</div><span class="chip bad">${Math.floor((Date.parse(today()) - Date.parse(x.end)) / 864e5)} j de retard</span></a>`).join('')}` : '';

  // planning des 7 prochains jours
  const days = weekDays(today());
  const JN = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const planRows = days.map(d => {
    const l = tasks.filter(t => covers(t, d) && SI[t.siteId] && members.some(m => m.id === t.memberId));
    if (!l.length) return '';
    const by = {}; l.forEach(t => (by[t.siteId] ||= []).push(members.find(m => m.id === t.memberId).name.split(' ')[0]));
    return `<div class="item" style="cursor:default"><div class="main"><div class="t">${JN[new Date(d + 'T12:00').getDay()]} ${dateFr(d).slice(0, 5)}${d === today() ? ' · aujourd\'hui' : ''}</div>
      <div class="s">${Object.entries(by).map(([sid, n]) => `<span class="dot" style="background:${e(SI[sid].color || '#2f7ad6')}"></span> ${e(SI[sid].name)} : ${e(n.join(', '))}`).join(' &nbsp; ')}</div></div></div>`; }).join('');

  // alertes : habilitations, factures en attente
  const habAlerts = [];
  members.filter(m => m.active !== false).forEach(m => (m.habs || []).forEach(h => { const st = habState(h); if (st) habAlerts.push({ m, h, st }); }));
  habAlerts.sort((a, b) => (a.h.expiry || '').localeCompare(b.h.expiry || ''));
  const lateDays = d => Math.floor((Date.parse(today()) - Date.parse(d)) / 864e5);

  const meU = auth.currentUser(), first = meU ? (meU.first || meU.name.split(' ')[0]) : '';
  el.innerHTML = `<h2>Bonjour${first ? ' ' + e(first) : ''} 👋</h2>
    <div class="row"><a class="btn primary" href="#/stock/scan">▦ Scanner</a><a class="btn" href="#/doc/new/quote">+ Devis</a><a class="btn" href="#/doc/new/invoice">+ Facture</a><a class="btn" href="#/site/new">+ Chantier</a><a class="btn" href="#/facebook/post">f Publier</a></div>
    <div class="row" style="margin-top:14px"><h3 style="margin:0;flex:1">Chiffres de la période</h3><select id="per" style="width:auto">${PERIODS.map(([k, l]) => `<option value="${k}" ${k === per ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${per === 'custom' ? `<div class="row"><label class="f" style="flex:1"><span>Du</span><input type="date" id="pfrom" value="${e(pc.from)}"></label><label class="f" style="flex:1"><span>Au</span><input type="date" id="pto" value="${e(pc.to)}"></label></div>` : `<p class="muted" style="margin:0">Du ${dateFr(range.from)} au ${dateFr(range.to)}</p>`}
    <div class="hero">
      <div class="kpi"><small>CA facturé HT (net d'avoirs)</small><b>${eur(sm.ca)}</b><small>${sm.nbFact} facture(s)</small></div>
      <div class="kpi ok"><small>Encaissé</small><b>${eur(sm.cash)}</b><small>sur la période</small></div>
      <a class="kpi ${unpaid > 0.005 ? 'bad' : 'ok'}" href="#/docs/invoice"><small>Reste à encaisser (toutes factures)</small><b>${eur(unpaid)}</b><small>${unpaidList.length} facture(s)</small></a></div>
    <div class="card"><b>Achats &amp; TVA</b>
      <div class="mini" style="margin-top:8px"><div><small>Achats HT (stock et chantiers)</small><b>${eur(sm.achats)}</b></div><div><small>TVA collectée</small><b>${eur(sm.tvaColl)}</b></div><div><small>TVA déductible</small><b>${eur(sm.tvaDed)}</b></div><div><small>${sm.tvaDue < 0 ? 'Crédit de TVA' : 'TVA due'}</small><b class="${sm.tvaDue > 0 ? 'warn' : 'ok'}">${eur(Math.abs(sm.tvaDue))}</b></div></div>
      <p class="cnote">TVA calculée sur les factures émises (et avoirs) et sur les achats : réceptions de stock et factures fournisseurs importées (taux de la facture, sinon celui du produit).</p></div>
    <div class="card"><b>12 derniers mois</b> <span class="muted" style="font-size:12px"><span style="color:var(--p)">■</span> CA HT &nbsp;<span style="color:var(--warn)">■</span> Achats HT</span>${chart}</div>
    ${open.length ? `<h3>Chantiers en cours &amp; marge</h3>${siteRows}<a class="btn sm" href="#/sites">Tous les chantiers</a>` : ''}
    <h3>Planning des 7 prochains jours</h3>${planRows || '<p class="muted">Rien de planifié.</p>'}<a class="btn sm" href="#/planning/week">Ouvrir le planning</a>
    ${habAlerts.length ? `<h3>Habilitations à renouveler</h3>${habAlerts.map(x => `<div class="item" style="cursor:default"><div class="main"><div class="t">${e(x.m.name)}</div><div class="s">${e(x.h.label)}</div></div><span class="chip ${x.st}">${x.st === 'bad' ? 'expirée le ' : 'expire le '}${dateFr(x.h.expiry)}</span></div>`).join('')}` : ''}
    ${unpaidList.length ? `<h3>Factures à encaisser</h3>${unpaidList.slice(0, 6).map(({ d, left }) => `<a class="item" href="#/doc/${d.id}" style="text-decoration:none;color:inherit"><div class="main"><div class="t">${e(d.number)} · ${e(C[d.clientId]?.name || '')}</div><div class="s">émise le ${dateFr(d.date)} · ${lateDays(d.date)} j</div></div><div class="r"><b>${eur(left)}</b></div></a>`).join('')}` : ''}
    ${low.length ? `<h3>À réapprovisionner</h3>${low.slice(0, 6).map(p => `<div class="item" style="cursor:default"><div class="main"><div class="t">${e(p.name)}</div></div><span class="chip warn">${total(p)} / seuil ${p.min || 0}</span></div>`).join('')}` : ''}
    ${lateHtml}
    ${startCard}
    <h3>En un coup d'œil</h3><div class="grid">
      <a class="kpi ${quotesPending.length ? 'warn' : ''}" href="#/docs/quote"><small>Devis en attente</small><b>${quotesPending.length}</b><small>${eur(quotesPending.reduce((a, d) => a + totals(d).ttc, 0))} TTC · 90 derniers jours</small></a>
      <a class="kpi" href="#/sites"><small>Chantiers ouverts</small><b>${sites.filter(x => ['new', 'signed', 'progress'].includes(x.status)).length}</b></a>
      <a class="kpi ${low.length ? 'warn' : ''}" href="#/stock/products"><small>Stock bas / épuisé</small><b>${low.length}</b><small>valeur stock ${eur(stockValue)}</small></a>
      <a class="kpi ${toPost.length ? 'warn' : ''}" href="#/facebook/calendar"><small>Publications à faire</small><b>${toPost.length}</b></a></div>`;
  const sv = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  $('#pfrom', el)?.addEventListener('change', ev => { sv('gp_pfrom', ev.target.value); refresh(); });
  $('#pto', el)?.addEventListener('change', ev => { sv('gp_pto', ev.target.value); refresh(); });
  $('#per', el).onchange = ev => { try { localStorage.setItem('gp_period', ev.target.value); } catch { /* ignore */ } refresh(); };
  $('#hidestart', el)?.addEventListener('click', () => { localStorage.setItem('gp_hide_start', '1'); refresh(); });
}

/* ---------- Réglages ---------- */
let installEvt;
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installEvt = ev; });

async function renderSettings(el) {
  const S = await getS();
  el.innerHTML = `<h2>Réglages</h2><form id="sf" class="card"><div class="cols">
    <h3 class="full">Entreprise (en-tête des documents)</h3>
    ${F('Nom de l\'application', 'appName', S.appName, { cls: 'full' })}
    ${F('Raison sociale', 'company', S.company)}${F('Dirigeant', 'owner', S.owner)}
    ${F('Activité (titre bleu)', 'sub', S.sub, { type: 'textarea', rows: 2, cls: 'full' })}
    ${F('Adresse', 'address', S.address, { type: 'textarea', rows: 2 })}${F('Ville (« Lussac, le … »)', 'city', S.city)}
    ${F('Téléphone', 'phone', S.phone)}${F('E-mail', 'email', S.email)}${F('Site web', 'web', S.web)}
    ${F('Forme juridique / capital', 'legal', S.legal)}${F('SIRET', 'siret', S.siret)}
    ${F('N° RGE', 'rge', S.rge)}${F('Assurance (n° contrat)', 'insurance', S.insurance)}
    ${F('IBAN', 'iban', S.iban)}${F('BIC', 'bic', S.bic)}
    ${F('N° TVA intracommunautaire (sinon calculé d\'après le SIRET)', 'tvaNum', S.tvaNum, { ph: 'FR70511277287' })}${F('Nature d\'opération par défaut (facture électronique)', 'opType', S.opType || 'mixed', { type: 'select', options: [['goods', 'Livraison de biens'], ['services', 'Prestation de services'], ['mixed', 'Biens et services (fourniture et pose)']] })}
    <label class="f full"><span><input type="checkbox" name="vatDebits" ${S.vatDebits ? 'checked' : ''}> Option pour le paiement de la TVA sur les débits (mention imprimée sur les factures)</span></label>
    <label class="f full"><span>Logo (PNG, JPG, WebP ou SVG – qualité conservée et partagé entre vos appareils ; sans choix, le logo de vos factures est utilisé)</span><input type="file" id="logo" accept="image/*"></label>
    <div class="full"><img id="logoprev" src="${logoSrc(S)}" alt="" style="max-height:70px;max-width:100%"> ${S.logo ? '<button type="button" class="btn sm" id="nologo">Revenir au logo par défaut</button>' : ''}</div>
    <label class="f full"><span><input type="checkbox" name="wallpaper" ${S.wallpaper !== false ? 'checked' : ''}> Afficher le logo en fond d'écran de l'application</span></label>
    <h3 class="full">Ventes (devis, factures, avoirs)</h3>
    ${F('Préfixe devis', 'quotePrefix', S.quotePrefix)}${F('Prochain n° de devis', 'quoteNext', S.quoteNext, { type: 'number' })}
    ${F('Préfixe facture', 'invPrefix', S.invPrefix)}${F('Prochain n° de facture', 'invNext', S.invNext, { type: 'number' })}
    ${F('Préfixe avoir', 'creditPrefix', S.creditPrefix)}${F('Prochain n° d\'avoir', 'creditNext', S.creditNext, { type: 'number' })}
    <label class="f full"><span><input type="checkbox" name="autoCloseSites" ${S.autoCloseSites !== false ? 'checked' : ''}> Terminer automatiquement un chantier quand tout est facturé et réglé</span></label>
    ${F('Délai de règlement par défaut (jours)', 'payDays', S.payDays ?? 30, { type: 'number' })}${F('Taille des photos envoyées au Drive', 'photoPx', S.photoPx || 2560, { type: 'select', options: [['1600', 'Standard (1600 px, léger)'], ['2560', 'Haute (2560 px, conseillé)'], ['3600', 'Très haute (3600 px)']] })}${F('Nombre de chiffres du compteur', 'pad', S.pad, { type: 'number' })}${F('TVA par défaut (%)', 'tva', S.tva, { type: 'select', options: [['0', '0 %'], ['5.5', '5,5 %'], ['10', '10 %'], ['20', '20 %']] })}
    ${F('Intitulé par défaut', 'intro', S.intro)}${F('Remarque par défaut', 'note', S.note)}
    ${F('Conditions de règlement par défaut', 'terms', S.terms, { type: 'textarea', rows: 6, cls: 'full' })}
    <h3 class="full">E-mails (envoi des devis, factures et avoirs)</h3>
    ${F('Objet par défaut', 'mailSubject', S.mailSubject || '', { cls: 'full', ph: MAIL_DEFAULTS.subject })}
    ${F('Message par défaut', 'mailBody', S.mailBody || '', { type: 'textarea', rows: 6, cls: 'full', ph: MAIL_DEFAULTS.body })}
    <p class="muted full">Laissez vide pour le texte conseillé (en gris). Jetons automatiques : <code>${e(MAIL_TOKENS)}</code>. L'envoi part de votre compte Google (script Apps Script) ; les réponses arrivent sur l'e-mail de l'entreprise ci-dessus.</p>
    <label class="f full"><span><input type="checkbox" name="mailBcc" ${S.mailBcc === false ? '' : 'checked'}> M'envoyer une copie cachée (Cci) de chaque e-mail envoyé</span></label>
    <div class="full row" style="margin:0"><button type="button" class="btn" id="mtest" ${sheets.scriptMode() ? '' : 'disabled'}>✉ Envoyer un e-mail de test à l'adresse de l'entreprise</button><span id="mtstat" class="muted"></span></div>
    <h3 class="full">Couleurs des lignes de devis / factures</h3>
    ${colorField('Section : texte', 'stSecColor', S.stSecColor, 'full')}${colorField('Section : fond', 'stSecBg', S.stSecBg, 'full')}
    ${colorField('Ligne produit : fond', 'stLineBg', S.stLineBg, 'full')}${colorField('Texte / commentaire : fond', 'stTextBg', S.stTextBg, 'full')}
    <p class="muted full">Ces couleurs s'appliquent par défaut ; chaque section ou texte peut ensuite avoir sa propre couleur.</p>
    <p class="muted full">Pour reprendre votre numérotation actuelle, mettez par exemple le préfixe « 026FAC87 » et le prochain numéro « 136 » avec 0 chiffre de remplissage.</p>
  </div><button class="btn primary">Enregistrer</button></form>
  <div class="card" id="zcard"><h3 style="margin-top:0">Mise en page des documents</h3>
    <p class="muted">Composez visuellement vos devis, factures et avoirs sur une page A4 : déplacez les blocs, agrandissez le logo, ajoutez des images ou des textes, modifiez tous les libellés. Le modèle s'applique à tous les documents du type choisi (un document peut ensuite faire exception depuis son aperçu).</p>
    <div class="row"><button type="button" class="btn primary" data-tpl="quote">🎨 Modifier les devis</button><button type="button" class="btn primary" data-tpl="invoice">🎨 Modifier les factures</button><button type="button" class="btn primary" data-tpl="credit">🎨 Modifier les avoirs</button></div></div>
  <div class="card"><h3 style="margin-top:0">Accès des membres</h3>
    <p>${auth.isActive() ? `Protection <b>active</b> : l'appli demande un nom et un code PIN. Connecté : <b>${e(auth.currentUser()?.name || '')}</b> (${e(auth.PROFILES[auth.currentUser()?.access]?.label || '')}).` : 'Protection <b>inactive</b> : tout le monde a tous les droits sur cet appareil.'}</p>
    <p class="muted">Donnez un profil et un code PIN à chaque membre dans <a href="#/planning/team">Planning › Équipe</a>. La protection démarre dès qu'un administrateur a un code PIN. C'est un verrouillage d'usage : il masque ce qui n'est pas autorisé, mais ne protège pas un accès direct à votre feuille Google Sheets.</p>
    ${auth.isActive() ? '<div class="row"><button class="btn" id="logout">Changer d\'utilisateur</button><button class="btn danger" id="noauth">Désactiver la protection</button></div>' : ''}</div>
  <div class="card"><h3 style="margin-top:0">Scanner de codes-barres</h3>
    <p class="muted">Si l'image est floue, ouvrez le scanner et changez de caméra (⟳ ou liste) : le choix est mémorisé sur cet appareil. Le bouton ◎ relance la mise au point, le curseur règle le zoom.</p>
    <p id="camstat"></p><div class="row"><button type="button" class="btn primary" id="camtest">Tester / choisir la caméra</button><button type="button" class="btn" id="camreset">Caméra automatique</button></div></div>
  <div class="card" id="gcard"><div class="row" style="margin:0 0 6px;align-items:center"><h3 style="margin:0">Google Sheets (stockage des données)</h3><span class="sp"></span>${sheets.configured() ? '<button type="button" class="btn sm" id="gsyncq" title="Synchroniser maintenant">↻</button>' : ''}<button type="button" class="btn sm" id="gedit">🔒 Modifier</button></div>
    <p class="muted">Toutes vos données sont enregistrées dans un classeur Google Sheets « GestPro – Données » de votre Drive (un onglet par type), et synchronisées entre vos appareils. Sans réseau, l'appli continue de fonctionner et se resynchronise ensuite.</p>
    <p id="gstat"></p>
    <fieldset id="gfs" disabled style="border:0;padding:0;margin:0;min-width:0;opacity:.75">
    <form id="gs"><b>Passerelle Apps Script (recommandé)</b>
      ${F('URL de l\'application web (se termine par /exec)', 'scriptUrl', sheets.scriptUrlValue(), { ph: 'https://script.google.com/macros/s/…/exec' })}
      ${F('Clé secrète (la même que dans Code.gs)', 'scriptKey', '', { type: 'password', ph: sheets.scriptMode() ? '•••• enregistrée sur cet appareil' : '' })}
      <div class="row"><button class="btn primary">Connecter et synchroniser</button>${sheets.scriptMode() ? '<button type="button" class="btn" id="gsync2">Synchroniser maintenant</button><button type="button" class="btn danger" id="gsoff">Déconnecter</button>' : ''}</div>
      <details><summary>Mise en place (3 min)</summary><ol class="steps">
        <li>Ouvrez le classeur Google Sheets, copiez son identifiant (adresse : <code>…/d/<b>ID</b>/edit</code>).</li>
        <li>Dans votre projet Apps Script, collez le contenu de <code>apps-script/Code.gs</code> (dépôt GitHub), remplacez <code>SHEET_ID</code> et <code>SECRET</code>.</li>
        <li><b>Déployer → Nouveau déploiement → Application Web</b> : exécuter en tant que <i>Moi</i>, accès <i>Tout le monde</i>. Autorisez l'accès à la feuille.</li>
        <li>Copiez l'URL <code>/exec</code> ci-dessus, saisissez la même clé secrète, puis « Connecter ».</li></ol></details></form>
    <details style="margin-top:10px"><summary>Mode avancé : connexion OAuth Google (sans Apps Script)</summary>
    <form id="gf">${F('Identifiant client OAuth Google', 'googleClientId', S.googleClientId, { ph: 'xxxx.apps.googleusercontent.com' })}<button class="btn">Enregistrer l'identifiant</button></form>
    <div class="row" style="margin-top:10px">
      ${sheets.scriptMode() ? '' : sheets.configured() ? `<button class="btn primary" id="gsync">Synchroniser maintenant</button><a class="btn" target="_blank" rel="noopener" href="${sheets.sheetUrl()}">Ouvrir dans Google Sheets ↗</a><button class="btn" id="gout">Se déconnecter</button><button class="btn danger" id="gforget">Dissocier ce classeur</button>`
        : `<button class="btn primary" id="gnew">Créer le classeur Google Sheets</button><button class="btn" id="gold">Utiliser un classeur existant…</button>`}
    </div>
    <details style="margin-top:8px"><summary>Comment obtenir l'identifiant client (5 min, une seule fois)</summary><ol class="steps">
      <li>Ouvrez <b>console.cloud.google.com</b> → nouveau projet « GestPro ».</li>
      <li><b>API et services → Bibliothèque</b> : activez « Google Sheets API ».</li>
      <li><b>Écran de consentement OAuth</b> : type « Externe », nom GestPro, ajoutez votre adresse Gmail comme <i>utilisateur test</i>.</li>
      <li><b>Identifiants → Créer → ID client OAuth → Application Web</b>. Origine JavaScript autorisée : <code>${e(location.origin)}</code></li>
      <li>Copiez l'ID client ici, enregistrez, puis « Créer le classeur ».</li></ol>
      <p class="muted">Sur un autre appareil : saisissez le même identifiant, « Utiliser un classeur existant » et collez l'adresse du classeur. Modifiez les données depuis l'appli (les colonnes lisibles du classeur sont un reflet ; les colonnes id/maj/json ne doivent pas être modifiées).</p></details></details></fieldset></div>
  <div class="card"><h3 style="margin-top:0">Modèles de texte</h3><p class="muted">Textes réutilisables (conditions, mentions, remarques) à insérer dans vos devis et factures.</p><div class="row"><button class="btn" id="snip">Gérer les modèles de texte…</button></div></div>
  <div class="card"><h3 style="margin-top:0">Importer des devis / factures</h3><p class="muted">Ajoute à vos données (sans rien remplacer) le contenu d'un fichier d'import GestPro : clients, chantiers, produits, devis, factures et règlements. Un fichier de correction des statuts (devis et chantiers importés) est aussi accepté : il ne modifie que le statut des devis et chantiers concernés. Le fichier est lu sur cet appareil uniquement.</p>
    <div class="row"><label class="btn"><input type="file" id="addimp" accept=".json" hidden>Choisir un fichier d'import…</label></div></div>
  <div class="card" id="fcard"><h3 style="margin-top:0">Photos &amp; fichiers (Drive)</h3>
    <p class="muted">Les photos et pièces jointes (chantiers, devis, factures, factures d'achat) sont envoyées dans votre Google Drive, dossier <b>GestPro</b> (<code>Chantiers/&lt;chantier&gt;/Photos, Devis, Factures, Achats, Autres</code> ; <code>Achats fournisseurs/&lt;année&gt;</code>). Elles sont relues par l'application selon les habilitations : photos et documents de chantier pour tous les membres, devis / factures / achats pour les profils qui voient les montants. Aucun compte Google n'est nécessaire pour les membres.</p>
    <p id="fstat" class="muted">${sheets.scriptMode() ? 'Connexion par script Apps Script : prêt.' : '⚠ Nécessite la connexion par script Apps Script (carte Google Sheets ci-dessus).'}</p>
    <div class="row"><button type="button" class="btn" id="ftest" ${sheets.scriptMode() ? '' : 'disabled'}>Tester le Drive</button><span class="muted">OneDrive (Microsoft 365) : prévu ensuite.</span></div></div>
  <div class="card"><h3 style="margin-top:0">Sauvegarde</h3><p class="muted">${sheets.configured() ? 'Vos données sont synchronisées automatiquement avec Google Sheets (« GestPro – Données ») après chaque modification, et disponibles sur vos autres appareils connectés au même classeur. Une copie en fichier reste utile comme sauvegarde supplémentaire.' : 'Google Sheets n\'est pas configuré : les données sont stockées uniquement sur cet appareil. Configurez la synchronisation ci-dessus, ou faites une sauvegarde régulière et transférez-la pour changer de téléphone/ordinateur.'}</p>
    <div class="row"><button class="btn" id="exp">Exporter (JSON)</button><label class="btn"><input type="file" id="imp" accept=".json" hidden>Restaurer…</label>${installEvt ? '<button class="btn primary" id="inst">Installer l\'application</button>' : ''}</div></div>`;
  const gstat = () => {
    const st = sheets.getStatus(), t = sheets.lastSync();
    const lbl = { off: 'Non configuré', busy: 'Synchronisation…', ok: 'Synchronisé', auth: 'Reconnexion Google nécessaire', err: 'Erreur' }[st.state];
    $('#gstat', el).innerHTML = `<b>${lbl}</b>${st.msg ? ' – ' + e(st.msg) : ''}${t ? ` · dernière synchro ${new Date(t).toLocaleString('fr-FR')}` : ''}`;
  };
  gstat();
  $('#ftest', el)?.addEventListener('click', async () => {
    const out = $('#fstat', el); out.textContent = 'Test en cours…';
    try { const r = await sheets.scriptCall({ action: 'fileInfo' }); out.innerHTML = `✔ Drive prêt : dossier <a href="${e(r.folder)}" target="_blank" rel="noopener">GestPro</a> (créé au besoin).`; }
    catch (err) { out.textContent = /Action inconnue/i.test(err.message) ? '✖ Le script Apps Script n\'est pas à jour : collez la dernière version de Code.gs, puis Déployer › Gérer les déploiements › Modifier › Nouvelle version, et acceptez l\'autorisation Drive.' : '✖ ' + err.message; }
  });
  $('#mtest', el)?.addEventListener('click', async () => {
    const out = $('#mtstat', el), to = ($('[name=email]', el).value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { out.textContent = '✖ Renseignez d\'abord l\'e-mail de l\'entreprise (et enregistrez).'; return; }
    out.textContent = 'Envoi en cours…';
    try {
      const r = await sheets.scriptCall({ action: 'mail', to, subject: 'Test GestPro', body: 'Ceci est un e-mail de test envoyé par GestPro : l\'envoi des devis et factures est opérationnel.', replyTo: to, fromName: $('[name=company]', el)?.value || '' });
      out.textContent = `✔ E-mail de test envoyé à ${to}${r.from ? ' depuis ' + r.from : ''}${r.left != null ? ` (${r.left} envois restants aujourd'hui)` : ''}.`;
    } catch (err) { out.textContent = '✖ ' + mailError(err).split('\n')[0]; }
  });
  $('#gedit', el).onclick = () => {
    const fs = $('#gfs', el), lockedNow = fs.disabled;
    if (lockedNow && !confirm('Modifier la connexion Google Sheets ? Une erreur ici peut interrompre la synchronisation de vos données.')) return;
    fs.disabled = !lockedNow; fs.style.opacity = lockedNow ? '1' : '.75'; $('#gedit', el).textContent = lockedNow ? '🔓 Verrouiller' : '🔒 Modifier';
  };
  $('#gsyncq', el)?.addEventListener('click', async () => { try { const r = await sheets.sync({ interactive: true }); toast(r?.pulled ? `${r.pulled} élément(s) reçus` : 'Synchronisé'); refresh(); } catch (err) { alert(err.message); } });
  $('#gf', el).onsubmit = async ev => { ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target)); await db.saveSettings({ ...(await getS()), googleClientId: o.googleClientId.trim() }); toast('Identifiant enregistré'); };
  const guard = fn => async () => { try { await fn(); } catch (err) { alert(err.message); } refresh(); };
  $('#gs', el).onsubmit = async ev => {
    ev.preventDefault();
    const o = Object.fromEntries(new FormData(ev.target));
    try {
      sheets.setScript(o.scriptUrl.trim(), o.scriptKey.trim() || localStorage.getItem('gp_script_key') || '');
      const r = await sheets.sync({ interactive: true });
      toast(r.pulled ? `${r.pulled} élément(s) reçus` : 'Synchronisé avec Google Sheets');
    } catch (err) { sheets.clearScript(); alert(err.message); }
    refresh();
  };
  $('#gsync2', el)?.addEventListener('click', async () => { try { const r = await sheets.sync({ interactive: true }); toast(r.pulled ? `${r.pulled} élément(s) reçus` : 'Synchronisé'); } catch (err) { alert(err.message); } refresh(); });
  $('#gsoff', el)?.addEventListener('click', () => { if (confirm('Déconnecter ? Les données locales sont conservées.')) { sheets.clearScript(); refresh(); } });
  $('#gnew', el)?.addEventListener('click', guard(async () => { await sheets.createSheet(); await sheets.sync({ interactive: true }); toast('Classeur créé et synchronisé'); }));
  $('#gold', el)?.addEventListener('click', guard(async () => { const v = prompt('Adresse (URL) ou identifiant du classeur Google Sheets :'); if (!v) return; await sheets.useSheet(v); await sheets.sync({ interactive: true }); toast('Classeur connecté'); }));
  $('#gsync', el)?.addEventListener('click', guard(async () => { const r = await sheets.sync({ interactive: true }); toast(r.pulled ? `${r.pulled} élément(s) reçus` : 'Synchronisé'); }));
  $('#gout', el)?.addEventListener('click', () => { sheets.disconnect(); refresh(); });
  $('#gforget', el)?.addEventListener('click', () => { if (confirm('Dissocier ce classeur ? Les données locales sont conservées.')) { sheets.disconnect(true); refresh(); } });
  const camInfo = () => ($('#camstat', el).textContent = savedCamera() ? 'Caméra enregistrée sur cet appareil.' : 'Caméra automatique (arrière par défaut).');
  camInfo();
  $('#camtest', el).onclick = () => scan(c => { toast('Code lu : ' + c); camInfo(); });
  $('#camreset', el).onclick = () => { resetCamera(); toast('Caméra automatique rétablie'); camInfo(); };
  bindColors($('#sf', el));
  let logo = S.logo;
  $('#logo', el).onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      logo = await compressImage(f, { mode: 'logo', maxChars: 250000 });
      if (logo.length > 260000) throw new Error('Logo trop lourd : utilisez une image plus petite.');
      $('#logoprev', el).src = logo;
      toast(`Logo prêt (${Math.round(logo.length * 0.75 / 1024)} Ko, qualité conservée) – enregistrez`);
    } catch (err) { logo = S.logo; alert(err.message); }
  };
  $('#nologo', el)?.addEventListener('click', () => { logo = ''; toast('Logo retiré – enregistrez'); });
  $('#sf', el).onsubmit = async ev => {
    ev.preventDefault();
    const o = Object.fromEntries(new FormData(ev.target));
    ['quoteNext', 'invNext', 'creditNext', 'pad', 'tva', 'payDays', 'photoPx'].forEach(k => (o[k] = num(o[k])));
    delete o.undefined;
    o.wallpaper = !!o.wallpaper; o.vatDebits = !!o.vatDebits; o.autoCloseSites = !!o.autoCloseSites; o.mailBcc = !!o.mailBcc;
    let logoV = S.logoV;
    if ((logo || '') !== (S.logo || '')) { // le logo vit dans sa propre feuille (onglet Photos) : il est synchronisé à part, sans limite de cellule
      logoV = Date.now(); await db.put('photos', { id: 'logo', data: logo || '', v: logoV }); sheets.markPhotosDirty();
    }
    await db.saveSettings({ ...S, ...o, logo, logoV }); applyWallpaper({ ...S, ...o, logo }); toast('Réglages enregistrés'); refresh();
  };
  $$('[data-tpl]', el).forEach(b => b.onclick = () => import('./docs.js').then(m => m.editTemplate(b.dataset.tpl)));
  $('#exp', el).onclick = async () => downloadFile(`gestpro-sauvegarde-${today()}.json`, JSON.stringify(await db.exportAll()));
  $('#imp', el).onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    if (!confirm('La restauration REMPLACE toutes les données actuelles. Continuer ?')) return;
    try { await db.importAll(JSON.parse(await readFileText(f))); toast('Données restaurées'); refresh(); } catch (err) { alert(err.message); }
  };
  $('#snip', el).onclick = () => import('./blocks.js').then(m => m.snippetsModal(null));
  $('#addimp', el).onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try {
      const imp = await import('./importer.js'); const data = JSON.parse(await readFileText(f));
      if (imp.isStatusFile(data)) { // fichier de correction des statuts de devis (et de chantiers) déjà importés
        const sp = await imp.planStatuts(data), nq = sp.changes.length, ns = sp.sites.changes.length;
        const lq = Object.entries(sp.to).map(([k, n]) => `${n} → ${imp.QSTAT[k]}`).join(', '), ls = Object.entries(sp.sites.to).map(([k, n]) => `${n} → ${imp.SSTAT[k]}`).join(', ');
        const keep = [sp.edited + sp.sites.kept ? `${sp.edited + sp.sites.kept} modifiés depuis l'import sont conservés` : '', sp.missing + sp.sites.missing ? `${sp.missing + sp.sites.missing} introuvables` : ''].filter(Boolean).join(', ');
        if (!nq && !ns) { alert(`Rien à modifier : ${sp.same + sp.sites.same} ont déjà le bon statut${keep ? `, ${keep}` : ''}.`); return; }
        const what = [nq ? `${nq} devis importés (${lq})` : '', ns ? `${ns} chantiers (${ls})` : ''].filter(Boolean).join(' et ');
        if (!confirm(`Corriger le statut de ${what} ?\n\n${sp.same + sp.sites.same} ont déjà le bon statut${keep ? `, ${keep}` : ''}. Aucun autre document n'est touché.`)) return;
        const sr = await imp.runStatuts(data); toast(`${[sr.changed ? `${sr.changed} devis` : '', sr.sites ? `${sr.sites} chantiers` : ''].filter(Boolean).join(' et ')} corrigés`); refresh(); return;
      }
      const p = await imp.planImport(data);
      if (!confirm(`Importer : ${p.contacts} nouveaux clients, ${p.sites} chantiers, ${p.products} produits, ${p.docs} documents (${p.skippedDocs} déjà présents ignorés) et ${p.payments} règlements ?\n\nVos données actuelles ne seront ni modifiées ni supprimées.`)) return;
      const r = await imp.runImport(data); toast(`Import terminé : ${r.documents} documents, ${r.contacts} clients`); refresh();
    } catch (err) { alert(err.message); }
  };
  $('#inst', el)?.addEventListener('click', () => installEvt.prompt());
  $('#logout', el)?.addEventListener('click', () => { auth.logout(); location.hash = '#/dashboard'; route(); });
  $('#noauth', el)?.addEventListener('click', async () => {
    if (!confirm('Désactiver les profils et codes PIN pour tous les membres ? Les fiches sont conservées.')) return;
    for (const m of await db.all('members')) { delete m.pinHash; m.access = ''; await db.put('members', m); }
    toast('Protection désactivée'); route();
  });
}

/* ---------- Routeur ---------- */
const routes = {
  dashboard: renderDashboard, sites: renderSites, site: renderSite, planning: renderPlanning, stock: renderStock, docs: renderDocs, doc: renderDoc,
  contacts: renderContacts, facebook: renderFacebook, settings: renderSettings
};

/* ---------- Accès : écran de connexion, menus selon le profil ---------- */
function showLogin() {
  const el = $('#view');
  const cands = auth.loginCandidates();
  const initials = n => n.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
  el.innerHTML = `<div class="card" style="max-width:420px;margin:30px auto"><h2 style="margin-top:0">Qui êtes-vous ?</h2>
    <div id="who">${cands.map(m => `<button class="item" data-id="${m.id}" style="width:100%;text-align:left;font:inherit"><span class="avatar" style="background:${e(m.color || '#2f7ad6')}">${e(initials(m.name))}</span><div class="main"><div class="t">${e(m.name)}</div><div class="s">${e(auth.PROFILES[m.access]?.label || '')}</div></div></button>`).join('')}</div>
    <form id="pinf" hidden><p><b id="pname"></b></p><label class="f"><span>Code PIN</span><input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" required></label>
      <div class="row"><button class="btn primary">Entrer</button><button type="button" class="btn ghost" id="back">Changer</button></div><p id="perr" class="muted" style="color:var(--bad)"></p></form>
    <p class="muted" style="margin-bottom:0"><a href="#" id="forgot">Code oublié ?</a></p></div>`;
  let sel = null;
  $('#who', el).onclick = ev => {
    const b = ev.target.closest('[data-id]'); if (!b) return;
    sel = b.dataset.id; $('#who', el).hidden = true; $('#pinf', el).hidden = false; $('#pname', el).textContent = cands.find(m => m.id === sel).name; $('#pin', el).focus();
  };
  $('#back', el).onclick = () => { $('#pinf', el).hidden = true; $('#who', el).hidden = false; $('#pin', el).value = ''; $('#perr', el).textContent = ''; };
  $('#pinf', el).onsubmit = async ev => {
    ev.preventDefault();
    if (await auth.login(sel, $('#pin', el).value.trim())) { location.hash = auth.home(); route(); }
    else { $('#perr', el).textContent = 'Code incorrect.'; $('#pin', el).value = ''; }
  };
  $('#forgot', el).onclick = async ev => {
    ev.preventDefault();
    if (prompt('Cela désactive TOUS les accès par profil et codes PIN (les fiches membres sont conservées). Tapez REINITIALISER pour confirmer :') !== 'REINITIALISER') return;
    for (const m of await db.all('members')) { delete m.pinHash; m.access = ''; await db.put('members', m); }
    toast('Accès réinitialisés'); route();
  };
}

/* Menu « Plus » (contacts, Facebook, réglages) */
function closeMore() { const m = $('#more'); if (m) m.hidden = true; $('#morebtn')?.setAttribute('aria-expanded', 'false'); }
$('#morebtn').addEventListener('click', ev => { ev.stopPropagation(); const m = $('#more'); m.hidden = !m.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!m.hidden)); });
document.addEventListener('click', ev => { if (!ev.target.closest('#more')) closeMore(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeMore(); });

/* Barre du bas : les 8 sections quand la largeur le permet, sinon 5 sections + menu « Plus » */
const NAV_EXTRA = ['contacts', 'facebook', 'settings'];
function layoutNav() {
  const nav = $('#nav'), more = $('#more'), btn = $('#morebtn'); if (!nav || !more || !btn) return;
  const all = [...nav.querySelectorAll('a'), ...more.querySelectorAll('a')];
  const extras = all.filter(a => NAV_EXTRA.includes(a.dataset.r)).sort((a, b) => NAV_EXTRA.indexOf(a.dataset.r) - NAV_EXTRA.indexOf(b.dataset.r));
  const base = all.filter(a => !NAV_EXTRA.includes(a.dataset.r) && !a.hidden).length, extra = extras.filter(a => !a.hidden).length;
  const wide = window.innerWidth >= (base + extra) * 68;
  if (wide) { extras.forEach(a => nav.insertBefore(a, btn)); btn.hidden = true; closeMore(); }
  else { extras.forEach(a => more.appendChild(a)); btn.hidden = extras.every(a => a.hidden); }
}
let navRaf = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(navRaf); navRaf = requestAnimationFrame(layoutNav); });

function applyAccess() {
  const ok = { dashboard: auth.can('dashboard'), sites: auth.can('sites'), planning: auth.can('planning'), stock: auth.can('stock'), docs: auth.can('quotes') || auth.can('invoices') || auth.can('credits'), contacts: auth.can('contacts'), facebook: auth.can('facebook'), settings: auth.can('settings') };
  $$('#nav a, #more a').forEach(a => (a.hidden = ok[a.dataset.r] === false));
  layoutNav(); closeMore();
  const u = $('#user'), me = auth.currentUser();
  u.hidden = !me;
  if (me) { const fn = me.first || me.name.split(' ')[0]; u.innerHTML = (me.photo ? `<img class="av" src="${e(me.photo)}" alt="">` : `<span class="av ini">${e(fn.slice(0, 1).toUpperCase())}</span>`) + e(fn); }
}
$('#user').onclick = () => { if (confirm('Changer d\'utilisateur ?')) { auth.logout(); route(); } };
$('#help').onclick = () => import('./help.js').then(m => m.openHelp()).catch(err => toast(err.message || 'Aide indisponible'));

/* Une seule fois : sort la civilité (Mr, Mme, SARL…) du champ « Nom » des fiches existantes */
async function migrateCiv() {
  // drapeau local (surtout pas dans les réglages : sur un appareil neuf, cela écraserait les réglages synchronisés)
  try { if (localStorage.getItem('gp_civmig')) return; } catch { return; }
  const S = await getS(); if (S.civMig) { localStorage.setItem('gp_civmig', '1'); return; }
  if (sheets.configured() && !(await db.all('contacts')).length) return; // attend la réception des données
  const list = (await db.all('contacts')).filter(c => c.civ === undefined && c.name);
  const upd = [];
  for (const c of list) { const s = splitCiv(c.name); if (s && s.name) upd.push({ ...c, civ: s.civ, name: s.name }); }
  if (upd.length) await db.putMany('contacts', upd);
  localStorage.setItem('gp_civmig', '1');
}

async function route() {
  await migrateCiv().catch(() => {});
  const { active, user } = await auth.load();
  document.body.classList.toggle('locked', active && !user);
  if (active && !user) { $('#user').hidden = true; return showLogin(); }
  applyAccess();
  const [, name = 'dashboard', a, b] = location.hash.split('/');
  const redirect = auth.guard(name, a);
  if (redirect) { location.hash = redirect; return; }
  const key = name === 'doc' ? 'docs' : name === 'site' ? 'sites' : name;
  $$('#nav a, #more a').forEach(x => x.classList.toggle('on', x.dataset.r === key));
  $('#morebtn').classList.toggle('on', $$('#more a.on').length > 0); closeMore();
  const el = $('#view'); el.classList.remove('wide');
  try { await (routes[name] || routes.dashboard)(el, a, b); }
  catch (err) { console.error(err); el.innerHTML = `<div class="card">Erreur : ${e(err.message)}</div>`; }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
const net = () => ($('#offline').hidden = navigator.onLine);
window.addEventListener('online', net); window.addEventListener('offline', net); net();

// Indicateur de synchronisation dans l'en-tête
const cloud = $('#cloud');
sheets.onStatus(st => {
  cloud.hidden = st.state === 'off';
  cloud.className = 'cloud ' + st.state;
  cloud.textContent = { busy: '☁ …', ok: '☁ ✓', auth: '☁ reconnecter', err: '☁ !' }[st.state] || '';
  cloud.title = st.msg || '';
});
cloud.onclick = () => sheets.sync({ interactive: true }).then(r => r?.pulled && toast(`${r.pulled} élément(s) reçus`)).catch(err => toast(err.message));
sheets.setOnPulled(() => {
  const editing = $('#modal').open || location.hash.startsWith('#/doc/') || location.hash.startsWith('#/site/') || $('.scanner') || $('#view :focus');
  if (!editing) refresh(); else toast('Nouvelles données reçues');
});

(async () => {
  await ensureDefaultLocation();
  getS().then(applyWallpaper);
  // Nouvel appareil : sans membres locaux, on récupère d'abord les profils (6 s max) pour ne pas afficher l'appli non protégée
  try {
    if (sheets.configured() && navigator.onLine && !(await db.all('members')).length) {
      $('#view').innerHTML = '<div class="card">Chargement…</div>';
      await Promise.race([sheets.sync().catch(() => {}), new Promise(r => setTimeout(r, 6000))]);
    }
  } catch { /* ignore */ }
  sheets.init();
  import('./files.js').then(m => { m.flushPending().catch(() => {}); window.addEventListener('online', () => m.flushPending().catch(() => {})); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
})();
