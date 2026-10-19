// Prévu contre réalisé d'un chantier (M3, M4, A7) et réservation du matériel par les devis signés (M9). Fonctions pures, sans écran ni base de données.
//   budget  = ce que les devis signés du chantier prévoient : heures (lignes de main d'œuvre en heures) et coûts (prix d'achat des lignes)
//   réel    = ce que le chantier a consommé : heures saisies, sorties de stock, charges, main d'œuvre (voir finance.siteMargin)
import { num } from './util.js';
import { r2, isOpt, hasCost, lineCost, lineHt } from './vat.js';
import { hasCompo, priceOf, OUV_CAT } from './ouvrage.js';

export const MO = 'Main d\'œuvre', SOUS = 'Sous-traitance';
/* Catégories qui ne se stockent pas : la main d'œuvre et la sous-traitance restent au catalogue pour les devis, mais n'ont ni stock ni seuil (B5) */
export const isService = p => !!p && (p.category === MO || p.category === SOUS);
/* Produit géré en stock : ni service, ni ouvrage */
export const isStocked = p => !!p && !isService(p) && p.category !== OUV_CAT;
const isHour = u => /^(h|hr|heure|heures)$/i.test(String(u || '').trim());
const get = (m, id) => (!m || !id ? undefined : m instanceof Map ? m.get(id) : m[id]);
const vals = m => (!m ? [] : m instanceof Map ? [...m.values()] : Object.values(m));
const OPEN = ['new', 'signed', 'progress'];

/* Coût horaire moyen de l'équipe active (pour chiffrer une ligne de main d'œuvre sans prix d'achat) */
export function avgRate(members) {
  const l = vals(members).filter(m => m && m.active !== false && num(m.rate) > 0);
  return l.length ? r2(l.reduce((a, m) => a + num(m.rate), 0) / l.length) : 0;
}

/* Devis qui engagent le chantier : acceptés ou déjà facturés */
export const signedQuotes = (siteId, docs) => (docs || []).filter(d => d.type === 'quote' && d.siteId === siteId && (d.status === 'accepted' || d.status === 'invoiced'));

/* Budget d'un chantier d'après ses devis signés.
   ctx = { products, members } (Map ou objet) ; S = réglages.
   Retourne { ok, quotes, hours, mat, mo, sub, total, ht, unknown, estimated }
   - hours : heures prévues (lignes de la catégorie « Main d'œuvre » en heures, et heures des ouvrages composés)
   - mat / mo / sub : coûts prévus (prix d'achat × quantité), main d'œuvre sans prix d'achat chiffrée au coût horaire moyen de l'équipe (estimated)
   - unknown : lignes facturées sans prix d'achat (coût prévu incomplet) ; ht : total HT des lignes retenues */
export function budgetOf(site, docs, ctx = {}, S = {}) {
  const qs = signedQuotes(site && site.id, docs), out = { ok: false, quotes: qs.map(q => q.number), hours: 0, mat: 0, mo: 0, sub: 0, total: 0, ht: 0, unknown: 0, estimated: 0 };
  const rate = avgRate(ctx.members);
  for (const q of qs) for (const l of (q.lines || [])) {
    if (isOpt(l)) continue;
    const qty = num(l.qty); if (!(qty > 0)) continue;
    const p = get(ctx.products, l.pid), ht = lineHt(l);
    if (p && hasCompo(p) && (l.cat === OUV_CAT || p.category === OUV_CAT)) { // ouvrage en une seule ligne : on lit sa composition
      const P = priceOf(p, ctx, S), k = hasCost(l) && P.cost > 0 ? lineCost(l) / (P.cost * qty) : 1; // le coût de la ligne (figé à la rédaction du devis) prime ; la composition ne sert qu'à le répartir
      for (const x of P.lines) {
        const c = r2(x.cost * qty * k);
        if (x.cat === MO) { out.mo += c; out.hours += x.unit === 'h' ? num(x.qty) * qty : 0; } else if (x.cat === SOUS) out.sub += c; else out.mat += c;
      }
      out.ht += ht; continue;
    }
    const cat = l.cat || (p && p.category) || 'Produit (fourniture)', hours = cat === MO && isHour(l.unit);
    if (hours) out.hours += qty;
    let c = 0;
    if (hasCost(l)) c = lineCost(l);
    else if (hours && rate > 0) { c = r2(qty * rate); out.estimated++; } else if (ht !== 0) out.unknown++;
    if (cat === MO) out.mo += c; else if (cat === SOUS) out.sub += c; else out.mat += c;
    out.ht += ht;
  }
  out.hours = r2(out.hours); out.mat = r2(out.mat); out.mo = r2(out.mo); out.sub = r2(out.sub); out.ht = r2(out.ht);
  out.total = r2(out.mat + out.mo + out.sub);
  out.ok = qs.length > 0 && (out.total > 0 || out.hours > 0);
  return out;
}

/* A7 : marge estimée d'après le coût prévu quand aucun coût réel n'est encore saisi. base = facturé HT, sinon marché signé HT */
export function estimateMargin(base, budget) {
  if (!budget || !budget.ok || !(budget.total > 0)) return null;
  const marge = r2(base - budget.total);
  return { marge, pct: base ? Math.round(marge / base * 100) : null, partial: budget.unknown > 0 };
}

/* Prévu contre réalisé. real = { hours, matieres, charges, mo } (voir finance.siteMargin), progress = avancement saisi (0–100 ou '') ; assigned = heures affectées au planning.
   Retourne { hours: {planned, done, assigned, pct}, mat: {planned, real}, mo: {planned, real}, total: {planned, real, pct}, progress, flags: [{ key, tone, label, text }] } */
export function compare(budget, real, { progress = '', assigned = 0 } = {}) {
  const hasProg = progress !== '' && progress != null && !isNaN(parseFloat(progress)), prog = hasProg ? Math.max(0, Math.min(100, num(progress))) : null;
  const hp = budget.hours, hd = num(real.hours), matP = r2(budget.mat + budget.sub), matR = r2(num(real.matieres) + num(real.charges)), moP = budget.mo, moR = num(real.mo);
  const totP = budget.total, totR = r2(matR + moR);
  const hPct = hp > 0 ? Math.round(hd / hp * 100) : null, tPct = totP > 0 ? Math.round(totR / totP * 100) : null;
  const flags = [], fmtH = h => String(Math.round(h * 100) / 100).replace('.', ',') + ' h';
  if (hp > 0) {
    if (hd > hp + 0.005) flags.push({ key: 'hours-over', tone: 'bad', label: 'Heures dépassées', text: `Heures dépassées : ${fmtH(hd)} faites pour ${fmtH(hp)} prévues au devis.` });
    else if (hPct >= 85 && (prog === null || prog < hPct - 10)) flags.push({ key: 'hours-near', tone: 'warn', label: 'Heures presque épuisées', text: `${fmtH(hd)} faites sur ${fmtH(hp)} prévues (${hPct} %)${prog !== null ? ` alors que les travaux sont à ${Math.round(prog)} %` : ''} : il ne reste que ${fmtH(hp - hd)}.` });
    else if (prog !== null && prog >= 20 && hPct > prog + 15) flags.push({ key: 'hours-fast', tone: 'warn', label: 'Heures en avance sur les travaux', text: `Les heures avancent plus vite (${hPct} %) que les travaux (${Math.round(prog)} %).` });
    if (num(assigned) > hp + 0.005) flags.push({ key: 'plan-over', tone: 'warn', label: 'Planning au-delà du devis', text: `Le planning affecte ${fmtH(assigned)} pour ${fmtH(hp)} prévues au devis.` });
  }
  if (totP > 0) {
    if (totR > totP + 0.005) flags.push({ key: 'cost-over', tone: 'bad', label: 'Coûts supérieurs au prévu', text: `Coûts réels supérieurs au coût prévu : ${tPct} % consommé.` });
    else if (prog !== null && prog >= 20 && tPct > prog + 15) flags.push({ key: 'cost-fast', tone: 'warn', label: 'Coûts en avance sur les travaux', text: `Les coûts avancent plus vite (${tPct} % du prévu) que les travaux (${Math.round(prog)} %).` });
  }
  return { hours: { planned: hp, done: hd, assigned: num(assigned), pct: hPct }, mat: { planned: matP, real: matR }, mo: { planned: moP, real: moR }, total: { planned: totP, real: totR, pct: tPct }, progress: prog, flags };
}

/* Budget et comparaison d'un chantier d'un seul appel : { budget, cmp } (cmp vaut null quand aucun devis signé ne donne de budget).
   mg = résultat de finance.siteMargin ; assigned = heures affectées au planning (team.siteHours().planned) */
export function siteCompare(site, docs, ctx, S, mg, assigned = 0) {
  const budget = budgetOf(site, docs, ctx, S);
  return { budget, cmp: budget.ok ? compare(budget, mg, { progress: site && site.progress, assigned }) : null };
}

/* ---------- M9 : réservation du matériel ---------- */
/* Stock total d'un produit, tous dépôts confondus */
export const stockOf = p => Object.values((p && p.stock) || {}).reduce((a, b) => a + num(b), 0);

/* Besoins d'un chantier : quantités des lignes « produit du stock » de ses devis acceptés (pas encore facturés), moins ce qui est déjà sorti pour ce chantier.
   Retourne Map pid → { need, out, left } */
export function siteNeeds(siteId, docs, moves, products) {
  const need = new Map();
  for (const d of docs || []) {
    if (d.type !== 'quote' || d.status !== 'accepted' || (d.siteId || '') !== (siteId || '')) continue;
    for (const l of d.lines || []) {
      if (!l.pid || isOpt(l)) continue;
      const p = get(products, l.pid); if (!isStocked(p) || hasCompo(p)) continue;
      const q = num(l.qty); if (q > 0) need.set(l.pid, r2((need.get(l.pid) || 0) + q));
    }
  }
  const res = new Map();
  for (const [pid, n] of need) {
    const out = siteId ? r2((moves || []).filter(m => m.type === 'out' && m.siteId === siteId && m.productId === pid).reduce((a, m) => a + num(m.qty), 0)) : 0;
    res.set(pid, { need: n, out, left: Math.max(0, r2(n - out)) });
  }
  return res;
}

/* Matériel réservé par les devis signés des chantiers ouverts (et des devis signés sans chantier), moins les sorties déjà faites.
   Retourne Map pid → { reserved, sites: [{ siteId, name, left }] } */
export function reservations(sites, docs, moves, products) {
  const S = Object.fromEntries((sites || []).map(s => [s.id, s])), ids = new Set();
  for (const d of docs || []) if (d.type === 'quote' && d.status === 'accepted') ids.add(d.siteId || '');
  const out = new Map();
  for (const id of ids) {
    if (id && !(S[id] && OPEN.includes(S[id].status))) continue; // chantier terminé, perdu ou supprimé : rien n'est réservé
    for (const [pid, n] of siteNeeds(id, docs, moves, products)) {
      if (!(n.left > 0)) continue;
      const r = out.get(pid) || { reserved: 0, sites: [] };
      r.reserved = r2(r.reserved + n.left); r.sites.push({ siteId: id, name: id ? S[id].name : 'Devis sans chantier', left: n.left });
      out.set(pid, r);
    }
  }
  return out;
}

/* Stock disponible = stock − réservé. Manques : produits dont le stock ne couvre pas ce qui est réservé.
   Retourne [{ p, stock, reserved, avail, short, sites }] triés par manque décroissant */
export function shortages(res, products, totalOf) {
  const out = [];
  for (const [pid, r] of res) {
    const p = get(products, pid); if (!p) continue;
    const stock = totalOf(p), avail = r2(stock - r.reserved);
    if (avail < -1e-9) out.push({ p, stock, reserved: r.reserved, avail, short: r2(-avail), sites: r.sites });
  }
  return out.sort((a, b) => b.short - a.short || String(a.p.name).localeCompare(String(b.p.name), 'fr'));
}
