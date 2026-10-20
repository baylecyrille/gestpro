// Fenêtres de l'application : avertissement, confirmation et saisie.
// Elles remplacent alert / confirm / prompt du navigateur, qui affichent « <site>.github.io indique… » : ici tout est dessiné par l'application.
//   alertBox(message)            → Promise<void>      (à ne pas attendre : l'avertissement s'affiche, le code continue)
//   confirmBox(message, opts)    → Promise<boolean>   (true = OK, false = Annuler ou Échap)
//   promptBox(message, défaut)   → Promise<string|null> (null = Annuler ou Échap)
// Les fenêtres s'affichent l'une après l'autre (jamais deux à la fois) et passent par-dessus une fenêtre déjà ouverte (formulaire, scanner…).
// Les messages sont du texte simple (les retours à la ligne sont conservés) : rien n'est interprété comme du HTML.
// globalThis.__gpNativeDialogs : crochet de test (les tests de l'application fournissent leurs propres alert / confirm / prompt).

const native = () => globalThis.__gpNativeDialogs === true;
let chain = Promise.resolve();

const appName = () => (document.querySelector('.brand .bname')?.textContent || '').trim() || 'GestPro';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Affiche une fenêtre à son tour et rend sa valeur de retour */
function show(kind, message, o = {}) {
  const run = () => new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'adlg ' + kind;
    d.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
    const ok = o.ok || 'OK', no = o.cancel || 'Annuler';
    d.innerHTML = `<form method="dialog" class="adlg-f">
      <header><b class="adlg-t">${esc(o.title || appName())}</b></header>
      <div class="adlg-m">${esc(message)}</div>
      ${kind === 'prompt' ? `<input class="adlg-i" type="text" value="${esc(o.value || '')}" autocomplete="off" aria-label="${esc(message).slice(0, 80)}">` : ''}
      <footer>${kind === 'alert' ? '' : `<button type="button" class="btn ghost" data-no>${esc(no)}</button>`}<button class="btn primary${o.danger ? ' dng' : ''}" data-ok>${esc(ok)}</button></footer></form>`;
    let result = kind === 'confirm' ? false : null;
    const f = d.querySelector('form'), input = d.querySelector('.adlg-i');
    f.addEventListener('submit', ev => { ev.preventDefault(); result = kind === 'prompt' ? input.value : true; d.close(); });
    d.querySelector('[data-no]')?.addEventListener('click', () => d.close());
    d.addEventListener('cancel', () => { result = kind === 'confirm' ? false : null; }); // Échap : comme « Annuler »
    d.addEventListener('close', () => { d.remove(); resolve(kind === 'alert' ? undefined : result); });
    document.body.appendChild(d);
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    if (input) { input.focus(); if (o.select !== false) input.select(); } else d.querySelector('[data-ok]').focus();
  });
  const p = chain.then(run, run);
  chain = p.then(() => {}, () => {});
  return p;
}

export function alertBox(message, o) {
  if (native()) { try { globalThis.alert(message); } catch { /* ignore */ } return Promise.resolve(); }
  return show('alert', message, o);
}
export function confirmBox(message, o) {
  if (native()) return Promise.resolve(!!globalThis.confirm(message));
  return show('confirm', message, o);
}
export function promptBox(message, value = '', o = {}) {
  if (native()) { const r = globalThis.prompt(message, value); return Promise.resolve(r === undefined ? null : r); }
  return show('prompt', message, { ...o, value });
}

/* Contrôle d'un formulaire par l'application (les formulaires ont l'attribut novalidate : le navigateur n'affiche plus sa propre bulle).
   Un champ marqué data-nocheck est laissé à son propre contrôle. Rend true si tout est valide ; sinon affiche une fenêtre de l'application qui nomme le champ en cause, puis place le curseur dessus. */
export function checkForm(form) {
  if (!form || form.checkValidity()) return true;
  const bad = [...form.elements].find(x => x.willValidate && !x.checkValidity() && !x.hasAttribute('data-nocheck')); // data-nocheck : le champ a son propre contrôle, avec un message plus précis
  if (!bad) return true;
  const lab = bad.closest('label')?.querySelector('span')?.textContent || bad.getAttribute('aria-label') || bad.placeholder || bad.name || 'ce champ';
  const name = lab.replace(/\s*\([^)]*\)\s*$/, '').trim() || 'ce champ', v = bad.validity;
  alertBox(v.valueMissing ? `Renseignez le champ « ${name} ».`
    : v.rangeUnderflow ? `« ${name} » : la valeur doit être au moins ${bad.min}.`
    : v.rangeOverflow ? `« ${name} » : la valeur doit être au plus ${bad.max}.`
    : `« ${name} » : la valeur saisie n'est pas valide.`).then(() => { try { bad.focus(); } catch { /* ignore */ } });
  return false;
}
