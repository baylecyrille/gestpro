// Point d'entrée : routeur, tableau de bord, contacts (clients / fournisseurs), réglages, sauvegarde.
import * as db from './db.js';
import { DEFAULTS, getS, logoSrc } from './defaults.js';
import { e, eur, num, dateFr, today, F, modal, toast, tabs, refresh, downloadFile, readFileText, compressImage, scan, savedCamera, resetCamera, $, $$ } from './util.js';
import { renderStock, ensureDefaultLocation, total } from './stock.js';
import { renderDocs, renderDoc, totals, paidOf, payState } from './docs.js';
import { renderFacebook } from './facebook.js';
import * as sheets from './sheets.js';

/* ---------- Fond d'écran (logo) ---------- */
export function applyWallpaper(S) {
  const r = document.documentElement.style;
  if (S.wallpaper === false) { r.setProperty('--logo', 'none'); return; }
  r.setProperty('--logo', `url("${logoSrc(S)}")`);
}

/* ---------- Contacts ---------- */
export function contactModal(c, kind, onSaved) {
  const isNew = !c; c = c || { kind };
  const body = `<div class="cols">${F('Nom / raison sociale', 'name', c.name, { req: true, cls: 'full' })}
    ${F('Contact (personne)', 'company', c.company, { cls: 'full' })}
    ${F('Adresse', 'address', c.address, { cls: 'full' })}${F('Code postal', 'zip', c.zip)}${F('Ville', 'city', c.city)}
    ${F('Téléphone', 'phone', c.phone, { type: 'tel' })}${F('E-mail', 'email', c.email, { type: 'email' })}
    ${F('SIRET', 'siret', c.siret, { cls: 'full' })}${F('Note', 'note', c.note, { type: 'textarea', rows: 2, cls: 'full' })}</div>`;
  modal(`${isNew ? 'Nouveau' : 'Fiche'} ${c.kind === 'supplier' ? 'fournisseur' : 'client'}`, body, async o => {
    Object.assign(c, o); const s = await db.put('contacts', c);
    if (onSaved) onSaved(s); else refresh();
  }, { del: isNew ? null : async () => {
    const docs = await db.all('documents');
    if (docs.some(d => d.clientId === c.id)) return alert('Ce client a des devis/factures : suppression impossible.');
    await db.del('contacts', c.id); refresh(); } });
}

async function renderContacts(el, tab = 'client') {
  const [contacts, docs, payments] = await Promise.all([db.all('contacts'), db.all('documents'), db.all('payments')]);
  el.innerHTML = `<h2>Contacts</h2>${tabs('#/contacts', [['client', 'Clients'], ['supplier', 'Fournisseurs']], tab)}
    <div class="row"><input class="search" id="q" type="search" placeholder="Rechercher…"><button class="btn primary" id="add">+ ${tab === 'client' ? 'Client' : 'Fournisseur'}</button></div><div id="list"></div>`;
  const list = contacts.filter(c => c.kind === tab).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const draw = () => {
    const q = $('#q', el).value.toLowerCase();
    $('#list', el).innerHTML = list.filter(c => !q || [c.name, c.company, c.city, c.phone, c.email].join(' ').toLowerCase().includes(q)).map(c => {
      let due = 0;
      if (tab === 'client') docs.filter(d => d.clientId === c.id && d.type === 'invoice' && d.status !== 'draft').forEach(d => (due += totals(d).ttc - paidOf(payments, d.id)));
      return `<div class="item" data-id="${c.id}"><div class="main"><div class="t">${e(c.name)}</div><div class="s">${[c.zip && c.city ? c.zip + ' ' + c.city : c.city, c.phone, c.email].filter(Boolean).map(e).join(' · ')}</div></div>
        <div class="r">${due > 0.005 ? `<span class="chip bad">dû ${eur(due)}</span>` : ''}${c.phone ? `<a class="btn sm" href="tel:${e(c.phone)}" onclick="event.stopPropagation()">📞</a>` : ''}</div></div>`;
    }).join('') || '<div class="empty">Aucune fiche.</div>';
  };
  draw(); $('#q', el).oninput = draw;
  $('#add', el).onclick = () => contactModal(null, tab);
  $('#list', el).onclick = ev => { const it = ev.target.closest('.item'); if (it && !ev.target.closest('a')) contactModal(list.find(c => c.id === it.dataset.id)); };
}

/* ---------- Tableau de bord ---------- */
async function renderDashboard(el) {
  const [products, docs, payments, posts, contacts, S] = await Promise.all([db.all('products'), db.all('documents'), db.all('payments'), db.all('fbposts'), db.all('contacts'), getS()]);
  const month = today().slice(0, 7);
  const stockValue = products.reduce((a, p) => a + total(p) * (p.buy || 0), 0);
  const low = products.filter(p => total(p) <= (p.min || 0) && (p.min || 0) > 0 || total(p) < 0);
  const invoices = docs.filter(d => d.type === 'invoice' && d.status !== 'draft');
  const unpaid = invoices.reduce((a, d) => a + Math.max(0, totals(d).ttc - paidOf(payments, d.id)), 0);
  const caMonth = invoices.filter(d => d.date.startsWith(month)).reduce((a, d) => a + totals(d).ht, 0);
  const cashMonth = payments.filter(p => p.date.startsWith(month)).reduce((a, p) => a + num(p.amount), 0);
  const quotesPending = docs.filter(d => d.type === 'quote' && d.status === 'sent');
  const toPost = posts.filter(p => p.status === 'scheduled' && p.date && p.date <= today());
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
  el.innerHTML = `<h2>Bonjour 👋</h2>
    <div class="row"><a class="btn primary" href="#/stock/scan">▦ Scanner</a><a class="btn" href="#/doc/new/quote">+ Devis</a><a class="btn" href="#/doc/new/invoice">+ Facture</a><a class="btn" href="#/facebook/post">f Publier</a></div>
    <div class="grid">
      <a class="kpi" href="#/stock/products"><small>Produits</small><b>${products.length}</b><small>valeur stock ${eur(stockValue)}</small></a>
      <a class="kpi ${low.length ? 'warn' : ''}" href="#/stock/products"><small>Stock bas / épuisé</small><b>${low.length}</b></a>
      <a class="kpi ${quotesPending.length ? 'warn' : ''}" href="#/docs/quote"><small>Devis en attente</small><b>${quotesPending.length}</b><small>${eur(quotesPending.reduce((a, d) => a + totals(d).ttc, 0))} TTC</small></a>
      <a class="kpi ${unpaid > 0.005 ? 'bad' : 'ok'}" href="#/docs/invoice"><small>Reste à encaisser</small><b>${eur(unpaid)}</b></a>
      <div class="kpi"><small>CA facturé du mois (HT)</small><b>${eur(caMonth)}</b></div>
      <div class="kpi ok"><small>Encaissé ce mois</small><b>${eur(cashMonth)}</b></div>
      <a class="kpi ${toPost.length ? 'warn' : ''}" href="#/facebook/calendar"><small>Publications à faire</small><b>${toPost.length}</b></a></div>
    ${low.length ? `<h3>À réapprovisionner</h3>${low.slice(0, 6).map(p => `<div class="item" style="cursor:default"><div class="main"><div class="t">${e(p.name)}</div></div><span class="chip warn">${total(p)} / seuil ${p.min || 0}</span></div>`).join('')}` : ''}
    ${startCard}`;
  $('#hidestart', el)?.addEventListener('click', () => { localStorage.setItem('gp_hide_start', '1'); refresh(); });
}

/* ---------- Réglages ---------- */
let installEvt;
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installEvt = ev; });

async function renderSettings(el) {
  const S = await getS();
  el.innerHTML = `<h2>Réglages</h2><form id="sf" class="card"><div class="cols">
    <h3 class="full">Entreprise (en-tête des documents)</h3>
    ${F('Raison sociale', 'company', S.company)}${F('Dirigeant', 'owner', S.owner)}
    ${F('Activité (titre bleu)', 'sub', S.sub, { type: 'textarea', rows: 2, cls: 'full' })}
    ${F('Adresse', 'address', S.address, { type: 'textarea', rows: 2 })}${F('Ville (« Lussac, le … »)', 'city', S.city)}
    ${F('Téléphone', 'phone', S.phone)}${F('E-mail', 'email', S.email)}${F('Site web', 'web', S.web)}
    ${F('Forme juridique / capital', 'legal', S.legal)}${F('SIRET', 'siret', S.siret)}
    ${F('N° RGE', 'rge', S.rge)}${F('Assurance (n° contrat)', 'insurance', S.insurance)}
    ${F('IBAN', 'iban', S.iban)}${F('BIC', 'bic', S.bic)}
    <label class="f full"><span>Logo (image – compressé automatiquement ; sans choix, le logo de vos factures est utilisé)</span><input type="file" id="logo" accept="image/*"></label>
    <div class="full"><img src="${logoSrc(S)}" alt="" style="max-height:70px"> ${S.logo ? '<button type="button" class="btn sm" id="nologo">Revenir au logo par défaut</button>' : ''}</div>
    <label class="f full"><span><input type="checkbox" name="wallpaper" ${S.wallpaper !== false ? 'checked' : ''}> Afficher le logo en fond d'écran de l'application</span></label>
    <h3 class="full">Devis &amp; factures</h3>
    ${F('Préfixe devis', 'quotePrefix', S.quotePrefix)}${F('Prochain n° de devis', 'quoteNext', S.quoteNext, { type: 'number' })}
    ${F('Préfixe facture', 'invPrefix', S.invPrefix)}${F('Prochain n° de facture', 'invNext', S.invNext, { type: 'number' })}
    ${F('Nombre de chiffres du compteur', 'pad', S.pad, { type: 'number' })}${F('TVA par défaut (%)', 'tva', S.tva, { type: 'select', options: [['0', '0 %'], ['5.5', '5,5 %'], ['10', '10 %'], ['20', '20 %']] })}
    ${F('Intitulé par défaut', 'intro', S.intro)}${F('Remarque par défaut', 'note', S.note)}
    ${F('Conditions de règlement par défaut', 'terms', S.terms, { type: 'textarea', rows: 6, cls: 'full' })}
    <p class="muted full">Pour reprendre votre numérotation actuelle, mettez par exemple le préfixe « 026FAC87 » et le prochain numéro « 136 » avec 0 chiffre de remplissage.</p>
  </div><button class="btn primary">Enregistrer</button></form>
  <div class="card"><h3 style="margin-top:0">Scanner de codes-barres</h3>
    <p class="muted">Si l'image est floue, ouvrez le scanner et changez de caméra (⟳ ou liste) : le choix est mémorisé sur cet appareil. Le bouton ◎ relance la mise au point, le curseur règle le zoom.</p>
    <p id="camstat"></p><div class="row"><button type="button" class="btn primary" id="camtest">Tester / choisir la caméra</button><button type="button" class="btn" id="camreset">Caméra automatique</button></div></div>
  <div class="card" id="gcard"><h3 style="margin-top:0">Google Sheets (stockage des données)</h3>
    <p class="muted">Toutes vos données sont enregistrées dans un classeur Google Sheets « GestPro – Données » de votre Drive (un onglet par type), et synchronisées entre vos appareils. Sans réseau, l'appli continue de fonctionner et se resynchronise ensuite.</p>
    <p id="gstat"></p>
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
      <p class="muted">Sur un autre appareil : saisissez le même identifiant, « Utiliser un classeur existant » et collez l'adresse du classeur. Modifiez les données depuis l'appli (les colonnes lisibles du classeur sont un reflet ; les colonnes id/maj/json ne doivent pas être modifiées).</p></details></details></div>
  <div class="card"><h3 style="margin-top:0">Sauvegarde</h3><p class="muted">Les données sont stockées uniquement sur cet appareil. Faites une sauvegarde régulière et transférez-la pour changer de téléphone/ordinateur.</p>
    <div class="row"><button class="btn" id="exp">Exporter (JSON)</button><label class="btn"><input type="file" id="imp" accept=".json" hidden>Restaurer…</label>${installEvt ? '<button class="btn primary" id="inst">Installer l\'application</button>' : ''}</div></div>`;
  const gstat = () => {
    const st = sheets.getStatus(), t = sheets.lastSync();
    const lbl = { off: 'Non configuré', busy: 'Synchronisation…', ok: 'Synchronisé', auth: 'Reconnexion Google nécessaire', err: 'Erreur' }[st.state];
    $('#gstat', el).innerHTML = `<b>${lbl}</b>${st.msg ? ' – ' + e(st.msg) : ''}${t ? ` · dernière synchro ${new Date(t).toLocaleString('fr-FR')}` : ''}`;
  };
  gstat();
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
  let logo = S.logo;
  $('#logo', el).onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      logo = await compressImage(f, { mode: 'logo', maxChars: 30000 });
      if (logo.length > 40000) throw new Error('Logo trop détaillé : utilisez une image plus simple.');
      toast(`Logo compressé (${Math.round(logo.length * 0.75 / 1024)} Ko) – enregistrez`);
    } catch (err) { logo = S.logo; alert(err.message); }
  };
  $('#nologo', el)?.addEventListener('click', () => { logo = ''; toast('Logo retiré – enregistrez'); });
  $('#sf', el).onsubmit = async ev => {
    ev.preventDefault();
    const o = Object.fromEntries(new FormData(ev.target));
    ['quoteNext', 'invNext', 'pad', 'tva'].forEach(k => (o[k] = num(o[k])));
    delete o.undefined;
    o.wallpaper = !!o.wallpaper;
    await db.saveSettings({ ...S, ...o, logo }); applyWallpaper({ ...S, ...o, logo }); toast('Réglages enregistrés'); refresh();
  };
  $('#exp', el).onclick = async () => downloadFile(`gestpro-sauvegarde-${today()}.json`, JSON.stringify(await db.exportAll()));
  $('#imp', el).onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    if (!confirm('La restauration REMPLACE toutes les données actuelles. Continuer ?')) return;
    try { await db.importAll(JSON.parse(await readFileText(f))); toast('Données restaurées'); refresh(); } catch (err) { alert(err.message); }
  };
  $('#inst', el)?.addEventListener('click', () => installEvt.prompt());
}

/* ---------- Routeur ---------- */
const routes = {
  dashboard: renderDashboard, stock: renderStock, docs: renderDocs, doc: renderDoc,
  contacts: renderContacts, facebook: renderFacebook, settings: renderSettings
};

async function route() {
  const [, name = 'dashboard', a, b] = location.hash.split('/');
  const key = name === 'doc' ? 'docs' : name;
  $$('#nav a').forEach(x => x.classList.toggle('on', x.dataset.r === key));
  const el = $('#view');
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
  const editing = $('#modal').open || location.hash.startsWith('#/doc/') || $('.scanner') || $('#view :focus');
  if (!editing) refresh(); else toast('Nouvelles données reçues');
});

(async () => {
  await ensureDefaultLocation();
  getS().then(applyWallpaper);
  sheets.init();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
})();
