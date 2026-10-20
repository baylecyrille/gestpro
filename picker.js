// Choix dans une longue liste (client, chantier, devis…) : une ligne de recherche, un bouton « Ajouter » à côté, puis la liste (10 lignes au plus).
// C'est la même présentation que les écrans de liste (Contacts, Chantiers, Stock) : on tape quelques lettres, on touche la ligne voulue.
//
// pickify(select, options) transforme un <select> existant SANS le remplacer : le <select> reste dans le formulaire (caché), garde son nom, sa valeur
// et ses événements « change » ; le reste du code n'a donc pas à changer. Il affiche :
//   [ 🔍 recherche ............ ][ + Ajouter ]
//   liste des 10 premiers résultats (la ligne choisie reste en tête, en bleu ; la toucher de nouveau la retire quand le choix est facultatif)
//   « + 25 autres : précisez la recherche »
// Les options du <select> fournissent les lignes : le texte de l'option = la ligne, data-q = mots de recherche en plus (ville, société, adresse…),
// data-sub = petite ligne grise sous le titre. L'option de valeur vide (« — aucun — ») n'est pas une ligne : c'est l'état « rien de choisi ».
//
// options : { placeholder, addLabel, addId, addTitle, onAdd(api), max = 10, compact }  (sans addLabel : pas de bouton « Ajouter » ; compact : quand un choix est fait et qu'on ne cherche pas, seule la ligne choisie est affichée — pour les pages denses comme l'en-tête d'un devis)
// Retourne { refresh, input, set(id), clear() }.
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function pickify(sel, o = {}) {
  const max = o.max || 10;
  const lab = sel.closest('label'), doc = sel.ownerDocument;
  const title = lab ? (lab.querySelector('span')?.textContent || '') : '';
  const box = doc.createElement('div');
  box.className = ((lab && lab.className) || 'f full') + ' pk';
  box.innerHTML = `${title ? `<span class="pk-t">${esc(title)}</span>` : ''}
    <div class="pk-bar"><input class="search pk-q" type="search" placeholder="${esc(o.placeholder || '🔍 Rechercher…')}" autocomplete="off" aria-label="${esc(title || 'Rechercher')}">${o.addLabel ? `<button type="button" class="btn primary pk-add" ${o.addId ? `id="${esc(o.addId)}"` : ''} ${o.addTitle ? `title="${esc(o.addTitle)}"` : ''}>${esc(o.addLabel)}</button>` : ''}</div>
    <div class="pk-list" role="listbox"></div><div class="pk-more muted"></div>`;
  if (lab) lab.replaceWith(box); else sel.before(box);
  box.append(sel); sel.hidden = true; sel.style.display = 'none'; // le <select> reste dans le formulaire : valeur et « change » inchangés
  const inp = box.querySelector('.pk-q'), list = box.querySelector('.pk-list'), more = box.querySelector('.pk-more');
  const optional = () => [...sel.options].some(op => op.value === '');
  const items = () => [...sel.options].filter(op => op.value !== '').map(op => ({ id: op.value, text: op.textContent, sub: op.dataset.sub || '', q: norm(op.textContent + ' ' + (op.dataset.q || '')) }));

  const rowsNow = () => {
    const words = norm(inp.value).split(' ').filter(Boolean), cur = sel.value, all = items();
    let rows = all.filter(x => words.every(w => x.q.includes(w)));
    const picked = all.find(x => x.id === cur);
    if (picked) rows = [picked, ...rows.filter(x => x.id !== cur)]; // la ligne choisie reste en tête, même si la recherche ne la trouve pas
    return { rows, cur, total: all.length };
  };
  const draw = () => {
    const { rows, cur } = rowsNow(), idle = o.compact && cur && !inp.value.trim(); // mode compact : un choix fait et pas de recherche en cours → seule la ligne choisie reste affichée
    const shown = idle ? rows.slice(0, 1) : rows.slice(0, max);
    list.innerHTML = shown.length
      ? shown.map(x => `<div class="item pk-row${x.id === cur ? ' on' : ''}" role="option" aria-selected="${x.id === cur}" tabindex="0" data-v="${esc(x.id)}"><div class="main"><div class="t">${esc(x.text)}</div>${x.sub ? `<div class="s">${esc(x.sub)}</div>` : ''}</div>${x.id === cur ? '<span class="pk-ok" title="Choisi">✓</span>' : ''}</div>`).join('')
      : `<div class="empty pk-empty">Aucun résultat${o.addLabel ? ` : touchez « ${esc(o.addLabel)} » pour en créer un` : ''}.</div>`;
    const left = rows.length - shown.length;
    more.textContent = idle ? 'Pour en choisir un autre : tapez dans la recherche.' : left > 0 ? `+ ${left} autre${left > 1 ? 's' : ''} : précisez la recherche` : '';
  };
  const choose = id => {
    const next = id === sel.value && optional() ? '' : id; // retoucher la ligne choisie retire le choix (seulement s'il est facultatif)
    sel.value = next;
    sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    draw();
  };
  list.addEventListener('click', ev => { const r = ev.target.closest('.pk-row'); if (r) choose(r.dataset.v); });
  list.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest('.pk-row')) { ev.preventDefault(); choose(ev.target.closest('.pk-row').dataset.v); } });
  inp.addEventListener('input', draw);
  inp.addEventListener('keydown', ev => { // Entrée : choisit la première ligne trouvée (au lieu d'envoyer le formulaire)
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const first = norm(inp.value) ? rowsNow().rows.find(x => x.id !== sel.value) : null;
    if (first) choose(first.id);
  });
  sel.addEventListener('change', draw);
  const MO = doc.defaultView && doc.defaultView.MutationObserver; if (MO) new MO(draw).observe(sel, { childList: true, subtree: true });
  const add = box.querySelector('.pk-add');
  const api = { refresh: draw, input: inp, box, set: id => { sel.value = id; draw(); }, clear: () => { inp.value = ''; draw(); } };
  if (add) add.addEventListener('click', () => { if (o.onAdd) o.onAdd(api); });
  draw();
  return api;
}
