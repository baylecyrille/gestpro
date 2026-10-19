// Bandeau « cette fiche existe peut-être déjà » sous les champs nom / téléphone / e-mail / SIRET d'un formulaire (B3).
import { e, cname } from './util.js';
import { findSimilar } from './clients.js';

export const simBoxHtml = () => '<div class="simbox full" id="simbox" hidden></div>';

const KIND = { client: 'client', supplier: 'fournisseur', moe: 'architecte / maître d\'œuvre' };
const readCand = f => { const v = n => (f.querySelector(`[name=${n}]`) || {}).value || ''; return { name: v('name'), phone: v('phone'), email: v('email'), siret: v('siret') }; };

/* Branche le bandeau sur le formulaire `f`. contacts = fiches existantes ; onUse(fiche) : l'utilisateur choisit la fiche existante.
   Retourne { matches() } : fiches proches de ce qui est saisi (pour confirmer avant d'enregistrer). */
export function bindSimilar(f, contacts, { kind = 'client', excludeId, onUse, useLabel = 'Ouvrir sa fiche', skip } = {}) {
  const box = f.querySelector('#simbox'); if (!box) return { matches: () => [] };
  const matches = () => (skip && skip() ? [] : findSimilar(contacts, readCand(f), { kind, excludeId }));
  const draw = () => {
    const l = matches().slice(0, 3);
    box.hidden = !l.length;
    box.innerHTML = l.length ? `<b>⚠ Ce ${KIND[kind] || 'contact'} existe peut-être déjà</b>${l.map(x => `<div class="sim"><span><b>${e(cname(x.c))}</b>${x.c.city ? ' · ' + e(x.c.city) : ''}${x.c.phone ? ' · ' + e(x.c.phone) : ''} <small class="muted">(${x.why.map(e).join(', ')})</small></span><button type="button" class="btn sm" data-use="${e(x.c.id)}">${e(useLabel)}</button></div>`).join('')}` : '';
  };
  ['name', 'phone', 'email', 'siret'].forEach(n => f.querySelector(`[name=${n}]`)?.addEventListener('input', draw));
  box.addEventListener('click', ev => { const b = ev.target.closest('[data-use]'); if (b && onUse) onUse(contacts.find(c => c.id === b.dataset.use)); });
  draw();
  return { matches, draw };
}

/* Phrase de confirmation avant de créer un doublon probable */
export function dupQuestion(list, kind = 'client') {
  const x = list[0];
  return `${list.length > 1 ? list.length + ' fiches ressemblent' : 'Une fiche ressemble'} à ce ${KIND[kind] || 'contact'} : « ${cname(x.c)} » (${x.why.join(', ')}).\n\nCréer quand même une nouvelle fiche ? (« Annuler » pour retourner au formulaire)`;
}
