// Réglages protégés par zones : chaque carte est verrouillée (lecture seule) tant qu'on n'a pas touché « Modifier ».
// Une seule zone est modifiable à la fois ; « Enregistrer » enregistre la zone et la reverrouille, « Annuler » abandonne les saisies.
import { e, $, $$ } from './util.js';

const BTNS = '<button type="button" class="btn sm" data-zcancel>Annuler</button><button type="button" class="btn sm primary" data-zsave>Enregistrer</button>';

/* HTML d'une zone verrouillable.
   id : identifiant court (id="z-<id>") ; title : titre ; body : contenu (champs) ; o.tag : 'form' (défaut : la zone enregistre ses champs) ou 'div' (le contenu a son propre enregistrement) ;
   o.mini : petite zone au milieu d'une autre carte ; o.cardId : identifiant de l'élément si ce n'est pas z-<id> ; o.after : contenu qui reste utilisable verrouillé (boutons d'action, test) */
export function zoneHtml(id, title, body, o = {}) {
  const tag = o.tag || 'form';
  return `<${tag} class="card zone locked${o.mini ? ' zmini' : ''}" id="${o.cardId || 'z-' + id}" data-z="${id}" data-t="${e(title.replace(/<[^>]*>/g, ''))}" ${tag === 'form' ? 'novalidate' : ''}>
    <div class="zhead"><h3>${title}</h3><span class="sp"></span><span class="zlock muted">🔒 Verrouillé</span><button type="button" class="btn sm" data-zedit title="Déverrouiller cette zone pour la modifier">✎ Modifier</button><span class="zacts" hidden>${BTNS}</span></div>
    <fieldset class="zfs" disabled>${body}</fieldset>${o.after || ''}
    <div class="zfoot" hidden>${BTNS}</div></${tag}>`;
}

/* contenu d'une zone, valeur par valeur (saisies en cours comprises) : sert à savoir si quelque chose a changé depuis « Modifier » */
const snapOf = (z, extra) => JSON.stringify([
  $$('input, select, textarea', z).filter(i => i.type !== 'file').map(i => (i.type === 'checkbox' || i.type === 'radio' ? (i.checked ? 1 : 0) : i.value)),
  extra ? extra() : ''
]);

/* Branche les zones de la page.
   opts.rerender : redessine la page (« Annuler » et enregistrement des zones à champs) ; opts.extra : { <id de zone>: () => état supplémentaire à comparer (le logo, par exemple) } */
export function mountZones(root, opts = {}) {
  const extraOf = z => (opts.extra || {})[z.dataset.z];
  let cur = null; // { z, snap } : la zone en cours de modification
  const isDirty = c => !!c && snapOf(c.z, extraOf(c.z)) !== c.snap;

  const lock = z => {
    $('.zfs', z).disabled = true; z.classList.add('locked'); z.classList.remove('editing');
    $('[data-zedit]', z).hidden = false; $('.zlock', z).hidden = false;
    $('.zacts', z).hidden = true; $('.zfoot', z).hidden = true;
    if (cur && cur.z === z) cur = null;
  };
  const unlock = z => {
    $('.zfs', z).disabled = false; z.classList.remove('locked'); z.classList.add('editing');
    $('[data-zedit]', z).hidden = true; $('.zlock', z).hidden = true;
    $('.zacts', z).hidden = false; $('.zfoot', z).hidden = false;
    cur = { z, snap: snapOf(z, extraOf(z)) };
  };
  const title = z => z.dataset.t || 'cette zone';

  $$('.zone', root).forEach(z => {
    z.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b || !z.contains(b)) return;
      if (b.hasAttribute('data-zedit')) {
        if (cur && cur.z !== z) {
          if (isDirty(cur)) { alert(`Les modifications de « ${title(cur.z)} » ne sont pas enregistrées : enregistrez-les ou annulez-les avant de modifier une autre zone.`); return; }
          lock(cur.z);
        }
        unlock(z);
      } else if (b.hasAttribute('data-zcancel')) {
        if (isDirty(cur) && !confirm(`Abandonner les modifications de « ${title(z)} » ?`)) return;
        if (opts.rerender) opts.rerender(); else lock(z);
      } else if (b.hasAttribute('data-zsave')) {
        // zone à champs : on soumet le formulaire ; zone à enregistrement propre : on touche son bouton d'enregistrement
        if (z.tagName === 'FORM') z.requestSubmit(); else { const s = $('[data-zsubmit]', z); if (s) s.click(); }
      }
    });
    // une zone à enregistrement propre prévient quand c'est fait : on la reverrouille sans redessiner la page
    z.addEventListener('zsaved', () => lock(z));
  });
  return { lock, current: () => cur, dirty: () => isDirty(cur) };
}

/* Un enregistrement de zone à champs est possible seulement si la zone est déverrouillée (les champs verrouillés ne partent pas dans le formulaire) */
export const isEditing = z => !!z && z.classList.contains('editing');
/* Une zone est en cours de modification dans la page ? (la synchronisation ne doit pas redessiner la page sous les doigts) */
export const anyEditing = () => !!document.querySelector('.zone.editing');
