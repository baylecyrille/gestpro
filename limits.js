// Seuils et délais réglables (Réglages › Seuils et délais). Module « feuille » : il n'importe rien (utilisable partout, testable hors navigateur).
// LIM est un objet que l'on met à jour EN PLACE (applyLimits) : les modules qui l'importent lisent toujours la valeur en vigueur.
// Les réglages ne stockent que ce qui diffère de la valeur d'origine (S.limits).

/* [clé, libellé, valeur d'origine, minimum, maximum, pas, unité, aide] */
export const LIM_FIELDS = [
  ['weekHours', 'Base hebdomadaire des salariés', 35, 1, 60, 0.5, 'h / semaine', 'Compteur d\'heures. Chaque salarié peut avoir son propre horaire sur sa fiche (temps partiel…).'],
  ['dayAlert', 'Alerte « trop d\'heures dans la journée » (planning)', 8, 1, 24, 0.5, 'h / jour', 'Affectations d\'un même salarié dont le total dépasse ce nombre d\'heures un jour donné.'],
  ['hikePct', 'Hausse de prix d\'achat signalée à la réception', 5, 0.5, 100, 0.5, '%', 'Écart d\'au moins ce pourcentage avec le prix de la fiche produit.'],
  ['remindMax', 'Nombre de relances d\'un devis', 3, 1, 10, 1, 'relances', 'Au-delà, le devis n\'est plus proposé à la relance.'],
  ['pendingDays', 'Devis « en attente » (accueil)', 90, 7, 365, 1, 'jours', 'Devis envoyés depuis moins de ce nombre de jours, sans réponse.']
];
export const LIM_DEFAULTS = Object.fromEntries(LIM_FIELDS.map(f => [f[0], f[2]]));
export const LIM = { ...LIM_DEFAULTS };

const clean = (f, v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= f[3] && n <= f[4] ? n : null;
};
/* Contrôle d'une saisie (objet clé → valeur) → { limits } (seulement ce qui diffère de l'origine) ou { error } */
export function checkLimits(o) {
  const out = {};
  for (const f of LIM_FIELDS) {
    if (o[f[0]] === undefined || String(o[f[0]]).trim() === '') continue;
    const n = clean(f, o[f[0]]);
    if (n === null) return { error: `${f[1]} : indiquez un nombre entre ${String(f[3]).replace('.', ',')} et ${String(f[4]).replace('.', ',')}.` };
    if (n !== f[2]) out[f[0]] = n;
  }
  return { limits: out };
}
export function applyLimits(S) {
  const st = (S && S.limits) || {};
  for (const f of LIM_FIELDS) { const n = clean(f, st[f[0]]); LIM[f[0]] = n === null ? f[2] : n; }
}
