// Listes de choix modifiables (Réglages › Listes de choix) : unités, catégories de produits, modes de règlement, contrats, fonctions, types d'absence
// et listes de suggestions (habilitations, civilités, fonctions d'un maître d'œuvre).
// Module « feuille » : il n'importe rien, pour pouvoir être utilisé partout (et testé hors navigateur).
// Les tableaux exportés (UNITS, CATS, ROLES…) sont de vrais tableaux que l'on remplit EN PLACE (applyLists) : tous les écrans qui les importent
// voient donc les changements sans avoir à être réécrits. Les réglages stockent seulement les listes que l'utilisateur a modifiées (S.lists).
//
// Une valeur d'une liste : { v, label?, icon?, svc?, hidden?, lock? }
//   v      : ce qui est enregistré dans les fiches (le texte lui-même pour une liste de texte, un identifiant pour une liste « à identifiants »)
//   label  : libellé affiché (listes à identifiants : on peut le renommer librement, l'identifiant ne change pas)
//   hidden : masquée = plus proposée dans les menus, mais les fiches qui l'utilisent la gardent
//   lock   : protégée = programmée dans l'application (ne se renomme pas, ne se masque pas, ne se supprime pas)

export const LIST_DEFS = {
  cats: {
    title: 'Catégories de produits', kind: 'cat', stored: true,
    help: 'Classement des produits ; elles composent le menu « + Produit » des devis. Une catégorie « service » n\'a ni stock ni seuil d\'alerte.',
    defaults: [{ v: 'Produit (fourniture)', icon: '📦' }, { v: 'Matériel', icon: '🛠' }, { v: 'Main d\'œuvre', icon: '👷', svc: true, lock: true }, { v: 'Sous-traitance', icon: '🤝', svc: true, lock: true }, { v: 'Ouvrage', icon: '🧩', lock: true }]
  },
  units: {
    title: 'Unités', kind: 'text', stored: true,
    help: 'Fiche produit, lignes de devis et de factures, réceptions. « u », « h » et « forfait » sont utilisées par l\'application.',
    defaults: ['u', 'm', 'm²', 'm³', 'ml', 'kg', 'L', 'lot', 'h', 'forfait'].map(v => ({ v, ...(['u', 'h', 'forfait'].includes(v) ? { lock: true } : {}) }))
  },
  methods: {
    title: 'Modes de règlement', kind: 'id',
    help: 'Règlements des factures, « moyens de paiement acceptés » des devis, export comptable.',
    defaults: [['especes', 'Espèces'], ['cheque', 'Chèque'], ['cb', 'Carte bleue'], ['virement', 'Virement'], ['autre', 'Autre']].map(([v, label]) => ({ v, label }))
  },
  contracts: {
    title: 'Types de contrat de travail', kind: 'text', stored: true,
    help: 'Fiche d\'un membre de l\'équipe.',
    defaults: ['CDI', 'CDD', 'CDD saisonnier', 'CDI de chantier / d\'opération', 'Intérim (mission)', 'Contrat d\'apprentissage', 'Contrat de professionnalisation', 'Stage', 'Gérant / mandataire social', 'Sous-traitant / indépendant', 'Autre'].map(v => ({ v }))
  },
  roles: {
    title: 'Fonctions des membres', kind: 'id',
    help: 'Fiche d\'un membre, liste de l\'équipe, exports.',
    defaults: [['gerant', 'Gérant'], ['chef', 'Chef de chantier'], ['ouvrier', 'Ouvrier'], ['apprenti', 'Apprenti'], ['soustraitant', 'Sous-traitant'], ['autre', 'Autre']].map(([v, label]) => ({ v, label }))
  },
  absTypes: {
    title: 'Types d\'absence', kind: 'id',
    help: 'Saisie des heures, absences du planning, récapitulatif du comptable. « Autre absence » est utilisée par l\'application.',
    defaults: [['cp', 'Congé payé'], ['maladie', 'Maladie'], ['autre', 'Autre absence']].map(([v, label]) => ({ v, label, ...(v === 'autre' ? { lock: true } : {}) }))
  },
  activities: {
    title: 'Activités des heures', kind: 'id', fixed: true,
    help: 'Saisie des heures (Atelier, Chantier, Bureau…) : changez l\'ordre, renommez ou masquez. La première activité proposée est celle qui s\'affiche par défaut (chaque salarié peut avoir la sienne sur sa fiche). « Chantier » et « Congés / absence » sont utilisées par l\'application ; on ne peut pas en ajouter, car chaque activité a sa colonne dans le récapitulatif des heures.',
    defaults: [['atelier', 'Atelier'], ['site', 'Chantier'], ['bureau', 'Bureau'], ['trajet', 'Déplacement / approvisionnement'], ['absence', 'Congés / absence']].map(([v, label]) => ({ v, label, ...(v === 'site' || v === 'absence' ? { lock: true } : {}) }))
  },
  habs: {
    title: 'Habilitations (suggestions)', kind: 'text',
    help: 'Propositions faites en saisissant une habilitation sur la fiche d\'un membre ; la saisie reste libre.',
    defaults: ['SST (secouriste)', 'Travail en hauteur', 'Habilitation électrique', 'CACES nacelle', 'CACES chariot', 'Échafaudage (montage)', 'Amiante SS4', 'Permis B', 'Permis poids lourd'].map(v => ({ v }))
  },
  civs: {
    title: 'Civilités et formes (suggestions)', kind: 'text',
    help: 'Propositions faites sur la fiche d\'un contact ; la saisie reste libre.',
    defaults: ['Mr', 'Mme', 'Mlle', 'Mr et Mme', 'Mme et Mr', 'Mr et Mr', 'Mme et Mme', 'SARL', 'SAS', 'SASU', 'EURL', 'SCI', 'EARL', 'GAEC', 'SA', 'Association', 'Commune'].map(v => ({ v }))
  },
  moeFn: {
    title: 'Fonctions d\'un maître d\'œuvre (suggestions)', kind: 'text',
    help: 'Propositions faites sur la fiche d\'un architecte ou maître d\'œuvre ; la saisie reste libre.',
    defaults: ['Architecte', 'Maître d\'œuvre', 'Bureau d\'études', 'Économiste', 'Conducteur de travaux', 'Coordinateur SPS', 'Autre'].map(v => ({ v }))
  }
};
export const LIST_ORDER = ['cats', 'units', 'methods', 'contracts', 'roles', 'activities', 'absTypes', 'habs', 'civs', 'moeFn'];

const str = v => String(v ?? '').trim();
const same = (a, b) => str(a).toLowerCase() === str(b).toLowerCase();

/* Liste complète (visibles et masquées) d'une clé : celle des réglages si elle est valable, sinon la liste d'origine ; les valeurs protégées y sont toujours */
export function fullList(key, stored) {
  const def = LIST_DEFS[key]; if (!def) return [];
  const isText = def.kind === 'text' || def.kind === 'cat';
  const out = [];
  for (const x of Array.isArray(stored) && stored.length ? stored : def.defaults) {
    const v = str(x && x.v); if (!v) continue;
    if (def.fixed && !def.defaults.some(d => d.v === v)) continue; // liste fermée : seules les valeurs prévues par l'application
    if (out.some(y => (isText ? same(y.v, v) : y.v === v))) continue;
    const o = { v };
    if (def.kind === 'id') o.label = str(x.label) || v;
    if (def.kind === 'cat') { o.icon = str(x.icon).slice(0, 4); o.svc = !!x.svc; }
    if (x.hidden) o.hidden = true;
    out.push(o);
  }
  for (const d of def.defaults) { // protégées (et, pour une liste fermée, toutes les valeurs prévues) : toujours présentes ; les protégées sont à leur forme d'origine, jamais masquées
    if (!d.lock && !(def.fixed && !out.some(y => y.v === d.v))) continue;
    const i = out.findIndex(y => (isText ? same(y.v, d.v) : y.v === d.v));
    const keep = { ...d };
    if (i < 0) out.push(keep);
    else out[i] = { ...keep, ...(def.kind === 'cat' ? { icon: out[i].icon || d.icon } : {}) };
  }
  return out;
}

/* La liste a-t-elle été modifiée par rapport à celle d'origine ? */
export const isCustom = (key, items) => JSON.stringify(normalForm(fullList(key, items))) !== JSON.stringify(normalForm(fullList(key, null)));
const normalForm = l => l.map(x => ({ v: x.v, label: x.label || '', icon: x.icon || '', svc: !!x.svc, hidden: !!x.hidden }));

/* Contrôle d'une liste modifiée avant enregistrement → { items } ou { error } */
export function checkList(key, items) {
  const def = LIST_DEFS[key]; if (!def) return { error: 'Liste inconnue.' };
  const isText = def.kind === 'text' || def.kind === 'cat';
  const out = [];
  for (const x of items || []) {
    const v = str(x.v);
    if (!v) return { error: `${def.title} : une valeur est vide.` };
    if (/[;|]/.test(v)) return { error: `${def.title} : « ${v} » contient un caractère interdit (; ou |).` };
    if (out.some(y => (isText ? same(y.v, v) : y.v === v))) return { error: `${def.title} : « ${v} » est en double.` };
    const o = { ...x, v };
    if (def.kind === 'id') { o.label = str(x.label); if (!o.label) return { error: `${def.title} : un libellé est vide.` }; if (out.some(y => same(y.label, o.label))) return { error: `${def.title} : le libellé « ${o.label} » est en double.` }; }
    out.push(o);
  }
  const full = fullList(key, out);
  if (!full.some(x => !x.hidden)) return { error: `${def.title} : au moins une valeur doit rester proposée.` };
  return { items: full };
}

/* ---------- Valeurs actives : tableaux remplis en place ---------- */
const fill = (arr, vals) => { arr.length = 0; arr.push(...vals); return arr; };
const fillObj = (obj, entries) => { for (const k of Object.keys(obj)) delete obj[k]; for (const [k, v] of entries) obj[k] = v; return obj; };

export const UNITS = [];            // unités proposées
export const CATS = [];             // [nom, icône] des catégories proposées
export const CAT_NAMES = [];        // noms de toutes les catégories connues (proposées ou masquées)
export const CAT_ICON = {};         // nom → icône
export const SVC_CATS = [];         // catégories « service » (ni stock ni seuil) : main d'œuvre, sous-traitance et celles que vous avez cochées
export const METHODS = [];          // [identifiant, libellé] des modes de règlement proposés (sans « avoir »)
export const METHOD_LABEL = {};     // identifiant → libellé, y compris les modes masqués et « avoir (imputation) »
export const CONTRACTS = [];        // types de contrat proposés
export const ROLES = [];            // [identifiant, libellé] des fonctions proposées
export const ROLE_LABEL = {};       // identifiant → libellé, y compris les fonctions masquées
export const ABS_TYPES = [];        // [identifiant, libellé] des types d'absence proposés
export const ABS_LABEL = {};        // identifiant → libellé, y compris les types masqués
export const KINDS = [];            // [identifiant, libellé] des activités proposées pour la saisie des heures
export const KIND_LABEL = {};       // identifiant → libellé, y compris les activités masquées
export const HABS = [], CIVS = [], MOE_FN = [];

export function applyLists(S) {
  const st = (S && S.lists) || {}, L = k => fullList(k, st[k]), vis = l => l.filter(x => !x.hidden);
  fill(UNITS, vis(L('units')).map(x => x.v));
  const cats = L('cats');
  fill(CATS, vis(cats).map(x => [x.v, x.icon || '']));
  fill(CAT_NAMES, cats.map(x => x.v));
  fillObj(CAT_ICON, cats.map(x => [x.v, x.icon || '']));
  fill(SVC_CATS, cats.filter(x => x.svc).map(x => x.v));
  const me = L('methods');
  fill(METHODS, vis(me).map(x => [x.v, x.label]));
  fillObj(METHOD_LABEL, [...me.map(x => [x.v, x.label]), ['avoir', 'Avoir (imputation)']]);
  fill(CONTRACTS, vis(L('contracts')).map(x => x.v));
  const ro = L('roles');
  fill(ROLES, vis(ro).map(x => [x.v, x.label]));
  fillObj(ROLE_LABEL, ro.map(x => [x.v, x.label]));
  const ab = L('absTypes');
  fill(ABS_TYPES, vis(ab).map(x => [x.v, x.label]));
  fillObj(ABS_LABEL, ab.map(x => [x.v, x.label]));
  const ac = L('activities');
  fill(KINDS, vis(ac).map(x => [x.v, x.label]));
  fillObj(KIND_LABEL, ac.map(x => [x.v, x.label]));
  fill(HABS, vis(L('habs')).map(x => x.v)); fill(CIVS, vis(L('civs')).map(x => x.v)); fill(MOE_FN, vis(L('moeFn')).map(x => x.v));
}
applyLists({}); // valeurs d'origine tant que les réglages ne sont pas lus

/* ---------- Aides pour les menus : la valeur déjà enregistrée sur une fiche reste affichée même si elle n'est plus proposée ---------- */
export const isServiceCat = c => SVC_CATS.includes(c);
export const catIcon = c => CAT_ICON[c] || '';
const withCur = (opts, cur, label) => (cur && !opts.some(o => o[0] === cur) ? [...opts, [cur, label]] : opts);
export const unitOpts = cur => withCur(UNITS.map(u => [u, u]), cur, cur + ' (ancienne unité)');
export const catOpts = cur => withCur(CATS.map(([c, i]) => [c, `${i ? i + ' ' : ''}${c}`]), cur, cur + (CAT_NAMES.includes(cur) ? ' (masquée)' : ' (ancienne)'));
export const contractOpts = cur => withCur(CONTRACTS.map(c => [c, c]), cur, cur + ' (ancien type)');
export const roleOpts = cur => withCur(ROLES, cur && ROLE_LABEL[cur] ? cur : '', ROLE_LABEL[cur] ? ROLE_LABEL[cur] + ' (masquée)' : cur);
export const methodOpts = cur => withCur(METHODS, cur && METHOD_LABEL[cur] ? cur : '', METHOD_LABEL[cur] ? METHOD_LABEL[cur] + ' (masqué)' : cur);
export const kindOpts = cur => withCur(KINDS, cur && KIND_LABEL[cur] ? cur : '', KIND_LABEL[cur] ? KIND_LABEL[cur] + ' (masquée)' : cur);
export const absOpts = cur => withCur(ABS_TYPES, cur && ABS_LABEL[cur] ? cur : '', ABS_LABEL[cur] ? ABS_LABEL[cur] + ' (masqué)' : cur);

