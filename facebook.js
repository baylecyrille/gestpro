// Facebook : aide à la publication, calendrier éditorial, tableau de bord de la page pro.
import * as db from './db.js';
import { getS } from './defaults.js';
import { e, eur, num, dateFr, today, F, modal, closeModal, toast, tabs, refresh, shrinkImage, $, $$ } from './util.js';

const TEMPLATES = {
  'Réalisation': "✅ Chantier terminé !\n\n{{produit}} réalisé pour un client à {{lieu}}.\nFabrication et pose par nos soins, finitions soignées.\n\n📞 Un projet ? Contactez-nous pour un devis gratuit.",
  'Promotion': "🔥 Offre à saisir !\n\n{{produit}} à partir de {{prix}} HT.\nValable jusqu'au {{date}} dans la limite des stocks.\n\n📍 Passez nous voir ou appelez-nous.",
  'Nouveau produit': "🆕 Nouveauté en stock : {{produit}} !\n\nDisponible dès maintenant au prix de {{prix}} HT.\nN'hésitez pas à nous demander conseil.",
  'Horaires / congés': "📢 Information : nous serons fermés du {{date}} au {{date2}}.\nRéouverture le {{date3}}. Merci de votre compréhension !",
  'Conseil': "💡 Le conseil de l'artisan\n\n{{conseil}}\n\nDes questions ? Écrivez-nous en message privé.",
  'Avis client': "⭐ Merci à nos clients pour leur confiance !\n\n« {{avis}} »\n\nVotre satisfaction est notre meilleure publicité."
};

export async function renderFacebook(el, tab = 'post', arg) {
  el.innerHTML = `<h2>Facebook</h2>${tabs('#/facebook', [['post', 'Publier'], ['calendar', 'Calendrier'], ['stats', 'Tableau de bord'], ['connect', 'Connexion']], tab)}<div id="tb"></div>`;
  const body = $('#tb', el);
  const S = await getS();
  if (tab === 'calendar') return calendarTab(body);
  if (tab === 'stats') return statsTab(body, S);
  if (tab === 'connect') return connectTab(body, S);
  return postTab(body, S, arg);
}

/* ---------- Publier ---------- */
async function postTab(body, S, editId) {
  let post = editId ? await db.get('fbposts', editId) : null;
  post = post || { text: '', image: '', date: '', status: 'draft' };
  const products = (await db.all('products')).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const api = !!(S.fbId && S.fbToken);
  body.innerHTML = `<div class="card">
    <div class="row">${Object.keys(TEMPLATES).map(k => `<button class="btn sm" data-tpl="${e(k)}">${e(k)}</button>`).join('')}</div>
    <label class="f"><span>Texte de la publication <b id="cc" class="muted"></b></span><textarea id="txt" rows="9" placeholder="Rédigez ou choisissez un modèle…">${e(post.text)}</textarea></label>
    <div class="row"><select id="prod" style="flex:1"><option value="">Insérer un produit du stock…</option>${products.map(p => `<option value="${p.id}">${e(p.name)} – ${eur(p.sell)}</option>`).join('')}</select>
      <button class="btn sm" id="tags">+ Hashtags</button><button class="btn sm" id="emo">😊</button></div>
    <div id="emopanel" class="emo" hidden></div>
    <div class="row"><label class="btn"><input type="file" id="img" accept="image/*" hidden>📷 Photo</label><span id="imgname" class="muted">${post.image ? 'photo jointe' : ''}</span></div>
    <img id="prev" alt="" style="max-width:100%;max-height:240px;border-radius:10px;${post.image ? '' : 'display:none'}" src="${post.image || ''}">
    <label class="f" style="margin-top:8px"><span>Planifier un rappel (date de publication prévue)</span><input type="date" id="when" value="${e(post.date)}"></label>
    <div class="row"><button class="btn" id="copy">Copier</button><button class="btn" id="share">Partager…</button><button class="btn" id="open">Ouvrir Facebook</button>
      <button class="btn primary" id="api" ${api ? '' : 'disabled title="Configurez la connexion"'}>Publier sur la page</button></div>
    <div class="row"><button class="btn" id="saved">Enregistrer le brouillon</button><button class="btn" id="done">Marquer comme publié</button></div>
    <p class="muted">Astuce : « Partager… » envoie le texte et la photo vers l'appli Facebook du téléphone ; vous choisissez la Page et validez.</p></div>`;
  const txt = $('#txt', body);
  const cc = () => ($('#cc', body).textContent = `· ${txt.value.length} caractères`);
  cc(); txt.oninput = cc;
  $$('[data-tpl]', body).forEach(b => b.onclick = () => { txt.value = TEMPLATES[b.dataset.tpl]; cc(); });
  $('#prod', body).onchange = ev => {
    const p = products.find(x => x.id === ev.target.value); if (!p) return;
    txt.value = (txt.value || TEMPLATES['Nouveau produit']).replace(/\{\{produit\}\}/g, p.name).replace(/\{\{prix\}\}/g, eur(p.sell));
    if (!txt.value.includes(p.name)) txt.value += `\n${p.name} – ${eur(p.sell)} HT`;
    ev.target.value = ''; cc();
  };
  $('#tags', body).onclick = () => { txt.value = txt.value.trimEnd() + '\n\n' + S.hashtags; cc(); };
  const EMO = {
    'Atelier': ['🔨','🪚','🪵','🛠️','🔧','🪛','📐','📏','⚙️','🧰','🪜','🏗️','🚧','🧱','🪟','🚪','🛋️','🪑','🛏️','🌳'],
    'Maison': ['🏠','🏡','🏘️','🏢','🔑','🛁','🚿','🍳','🛋️','🪴','💡','🔥','❄️','☀️','🌿','🧹','🎨','🖌️','🪞','📦'],
    'Pub': ['✅','✔️','⭐','🌟','✨','🔥','💥','🎉','🎁','💯','👍','👏','🙌','💪','👌','❤️','😍','🤩','📣','📢'],
    'Contact': ['📞','📱','📧','💬','📍','🗺️','🕘','📅','🗓️','⏰','🌐','➡️','👉','👇','⬇️','🔗','📸','🎥','💰','🏷️'],
    'Visages': ['😀','😃','😄','😁','😊','🙂','😉','😎','🤝','🙏','🤗','😅','😂','🥰','😇','🤔','👷','👨‍🔧','👩‍🔧','🧑‍🎨']
  };
  const panel = $('#emopanel', body);
  let cat = Object.keys(EMO)[0];
  const drawEmo = () => {
    panel.innerHTML = `<div class="row" style="margin-bottom:6px">${Object.keys(EMO).map(k => `<button type="button" class="btn sm${k === cat ? ' primary' : ''}" data-cat="${k}">${k}</button>`).join('')}</div>
      <div class="emogrid">${EMO[cat].map(m => `<button type="button" data-e="${m}">${m}</button>`).join('')}</div>`;
  };
  panel.onclick = ev => {
    const c = ev.target.closest('[data-cat]'); if (c) { cat = c.dataset.cat; drawEmo(); return; }
    const m = ev.target.closest('[data-e]'); if (!m) return;
    const a = txt.selectionStart ?? txt.value.length, b = txt.selectionEnd ?? a;
    txt.value = txt.value.slice(0, a) + m.dataset.e + txt.value.slice(b);
    const pos = a + m.dataset.e.length; txt.focus(); txt.setSelectionRange(pos, pos); cc();
  };
  $('#emo', body).onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) drawEmo(); };
  let file = null;
  $('#img', body).onchange = async ev => {
    file = ev.target.files[0]; if (!file) return;
    post.image = await shrinkImage(file, 1400);
    $('#prev', body).src = post.image; $('#prev', body).style.display = ''; $('#imgname', body).textContent = file.name;
  };
  const warnLeft = () => /\{\{/.test(txt.value) && !confirm('Des champs {{…}} ne sont pas remplis. Continuer quand même ?');
  const imgFile = async () => post.image ? new File([await (await fetch(post.image)).blob()], 'photo.png', { type: 'image/png' }) : null;
  $('#copy', body).onclick = async () => { await navigator.clipboard.writeText(txt.value); toast('Texte copié'); };
  $('#open', body).onclick = async () => { try { await navigator.clipboard.writeText(txt.value); toast('Texte copié – collez-le dans Facebook'); } catch { /* ignore */ } window.open(S.fbPage || 'https://www.facebook.com/', '_blank'); };
  $('#share', body).onclick = async () => {
    if (warnLeft()) return;
    const f = await imgFile();
    const data = { text: txt.value, ...(f && navigator.canShare?.({ files: [f] }) ? { files: [f] } : {}) };
    if (navigator.share) { try { await navigator.share(data); } catch { /* annulé */ } }
    else { await navigator.clipboard.writeText(txt.value); toast('Partage indisponible : texte copié'); }
  };
  const persist = async status => {
    Object.assign(post, { text: txt.value, date: $('#when', body).value, status });
    await db.put('fbposts', post);
  };
  $('#saved', body).onclick = async () => { await persist(post.date ? 'scheduled' : 'draft'); toast('Brouillon enregistré'); };
  $('#done', body).onclick = async () => { await persist('published'); post.published = today(); await db.put('fbposts', post); toast('Marqué publié'); location.hash = '#/facebook/calendar'; };
  $('#api', body).onclick = async () => {
    if (!txt.value.trim()) return toast('Texte vide');
    if (warnLeft() || !confirm('Publier maintenant sur la page Facebook ?')) return;
    try {
      let r;
      if (post.image) {
        const fd = new FormData();
        fd.append('source', await imgFile()); fd.append('caption', txt.value); fd.append('access_token', S.fbToken);
        r = await fetch(`https://graph.facebook.com/v21.0/${S.fbId}/photos`, { method: 'POST', body: fd });
      } else {
        r = await fetch(`https://graph.facebook.com/v21.0/${S.fbId}/feed`, { method: 'POST', body: new URLSearchParams({ message: txt.value, access_token: S.fbToken }) });
      }
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      await persist('published'); post.published = today(); post.fbId = j.post_id || j.id; await db.put('fbposts', post);
      toast('Publié sur Facebook ✔'); location.hash = '#/facebook/calendar';
    } catch (err) { alert('Échec de la publication : ' + err.message); }
  };
}

/* ---------- Calendrier ---------- */
async function calendarTab(body) {
  const posts = (await db.all('fbposts')).sort((a, b) => (b.date || b.published || '').localeCompare(a.date || a.published || ''));
  const lbl = { draft: ['Brouillon', ''], scheduled: ['Planifié', 'warn'], published: ['Publié', 'ok'] };
  body.innerHTML = `<div class="row"><a class="btn primary" href="#/facebook/post">+ Nouvelle publication</a></div>` +
    (posts.map(p => {
      const late = p.status === 'scheduled' && p.date && p.date <= today();
      return `<div class="item" data-id="${p.id}"><div class="main"><div class="t">${e((p.text || '').slice(0, 70) || '(vide)')}</div>
        <div class="s">${p.status === 'published' ? 'Publié le ' + dateFr(p.published || p.date) : p.date ? 'Prévu le ' + dateFr(p.date) : 'Sans date'}</div></div>
        <span class="chip ${late ? 'bad' : lbl[p.status][1]}">${late ? 'À publier' : lbl[p.status][0]}</span></div>`;
    }).join('') || '<div class="empty">Aucune publication enregistrée.</div>');
  body.onclick = ev => {
    const it = ev.target.closest('.item'); if (!it) return;
    const p = posts.find(x => x.id === it.dataset.id);
    modal('Publication', `<p style="white-space:pre-wrap">${e(p.text)}</p>${p.image ? `<img src="${p.image}" alt="" style="max-width:100%;border-radius:10px">` : ''}`, null, {
      del: async () => { await db.del('fbposts', p.id); refresh(); },
      onOpen: f => {
        $('footer', f).insertAdjacentHTML('afterbegin', `<a class="btn" href="#/facebook/post/${p.id}">Modifier</a>`);
        $('footer a', f).onclick = closeModal;
      }
    });
  };
}

/* ---------- Tableau de bord ---------- */
async function statsTab(body, S) {
  const stats = (await db.all('fbstats')).sort((a, b) => a.date.localeCompare(b.date));
  const last = stats[stats.length - 1], prev = stats[stats.length - 2];
  const delta = k => (last && prev ? (last[k] - prev[k] >= 0 ? '+' : '') + (last[k] - prev[k]) : '');
  const posts = await db.all('fbposts');
  const month = today().slice(0, 7);
  const pubM = posts.filter(p => p.status === 'published' && (p.published || p.date || '').startsWith(month)).length;
  const page = S.fbPage || (S.fbId ? 'https://www.facebook.com/' + S.fbId : 'https://www.facebook.com/');
  const links = [['Accueil Meta Business Suite', 'https://business.facebook.com/latest/home'], ['Statistiques (Insights)', 'https://business.facebook.com/latest/insights/results'], ['Messages / boîte de réception', 'https://business.facebook.com/latest/inbox'], ['Planificateur de contenu', 'https://business.facebook.com/latest/content_calendar'], ['Ma page', page]];
  body.innerHTML = `<div class="grid">
    <div class="kpi"><small>Abonnés</small><b>${last ? last.followers : '—'}</b><small>${delta('followers')}</small></div>
    <div class="kpi"><small>Portée (30 j)</small><b>${last ? last.reach : '—'}</b><small>${delta('reach')}</small></div>
    <div class="kpi"><small>Interactions (30 j)</small><b>${last ? last.engage : '—'}</b><small>${delta('engage')}</small></div>
    <div class="kpi"><small>Publications ce mois</small><b>${pubM}</b></div></div>
    <div class="card" style="margin-top:10px"><h3 style="margin-top:0">Évolution des abonnés</h3>${chart(stats)}
    <div class="row"><button class="btn primary" id="addst">+ Relevé</button>${S.fbId && S.fbToken ? '<button class="btn" id="sync">Actualiser depuis Facebook</button>' : ''}</div></div>
    <div class="card"><h3 style="margin-top:0">Accès rapides</h3>${links.map(([l, u]) => `<div class="row"><a class="btn" target="_blank" rel="noopener" href="${u}">${l} ↗</a></div>`).join('')}</div>
    <p class="muted">Facebook ne fournit les statistiques détaillées que dans Meta Business Suite : relevez ici les chiffres chaque semaine pour suivre votre progression.</p>`;
  const entry = (v = {}) => modal('Relevé de statistiques', `<div class="cols">${F('Date', 'date', v.date || today(), { type: 'date' })}${F('Abonnés', 'followers', v.followers ?? last?.followers ?? '', { type: 'number', req: true })}${F('Portée', 'reach', v.reach ?? '', { type: 'number' })}${F('Interactions', 'engage', v.engage ?? '', { type: 'number' })}</div>`,
    async o => { await db.put('fbstats', { id: o.date, date: o.date, followers: num(o.followers), reach: num(o.reach), engage: num(o.engage) }); refresh(); });
  $('#addst', body).onclick = () => entry();
  $('#sync', body)?.addEventListener('click', async () => {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${S.fbId}?fields=followers_count,fan_count&access_token=${encodeURIComponent(S.fbToken)}`);
      const j = await r.json(); if (j.error) throw new Error(j.error.message);
      entry({ followers: j.followers_count ?? j.fan_count, reach: last?.reach, engage: last?.engage });
    } catch (err) { alert('Échec : ' + err.message); }
  });
}

function chart(stats) {
  if (stats.length < 2) return '<p class="muted">Ajoutez au moins deux relevés pour voir la courbe.</p>';
  const W = 600, H = 150, p = 24, vals = stats.map(s => s.followers);
  const min = Math.min(...vals), max = Math.max(...vals), rg = max - min || 1;
  const pts = stats.map((s, i) => [p + i * (W - 2 * p) / (stats.length - 1), H - p - (s.followers - min) / rg * (H - 2 * p)]);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Courbe des abonnés">
    <polyline fill="none" stroke="#1e5aa8" stroke-width="3" points="${pts.map(q => q.join(',')).join(' ')}"/>
    ${pts.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="4" fill="#1e5aa8"/>`).join('')}
    <text x="${p}" y="${H - 4}" font-size="11" fill="#6b7788">${dateFr(stats[0].date)}</text>
    <text x="${W - p}" y="${H - 4}" font-size="11" fill="#6b7788" text-anchor="end">${dateFr(stats[stats.length - 1].date)}</text>
    <text x="${p}" y="12" font-size="11" fill="#6b7788">${max}</text></svg>`;
}

/* ---------- Connexion ---------- */
function connectTab(body, S) {
  body.innerHTML = `<div class="card"><form id="cf">
    ${F('Adresse de la page Facebook', 'fbPage', S.fbPage, { ph: 'https://www.facebook.com/ma-page' })}
    ${F('Hashtags par défaut', 'hashtags', S.hashtags)}
    <h3>Publication directe (optionnel)</h3>
    <p class="muted">Sans cette étape, l'appli prépare le texte/photo et vous les envoyez via le bouton « Partager » ou en collant dans Facebook. Pour publier d'un clic, il faut un identifiant de Page et un jeton d'accès de page créés dans Meta for Developers (permissions pages_manage_posts, pages_read_engagement).</p>
    ${F('Identifiant de la Page', 'fbId', S.fbId)}
    ${F('Jeton d\'accès de la Page', 'fbToken', S.fbToken, { type: 'password' })}
    <p class="muted">⚠ Le jeton est stocké uniquement sur cet appareil, jamais dans le dépôt GitHub. Quiconque a accès à l'appareil déverrouillé peut l'utiliser : gardez-le facultatif et révoquez-le en cas de perte.</p>
    <button class="btn primary">Enregistrer</button></form></div>`;
  $('#cf', body).onsubmit = async ev => {
    ev.preventDefault();
    const o = Object.fromEntries(new FormData(ev.target));
    await db.saveSettings({ ...S, ...o }); toast('Enregistré'); refresh();
  };
}
