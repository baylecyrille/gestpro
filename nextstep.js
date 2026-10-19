// Prochaine étape d'un chantier (M1) et liste « À faire aujourd'hui » du tableau de bord (M12).
// Réutilise des données déjà saisies (devis, factures, règlements, planning, stock, habilitations) : aucune saisie en plus. Fonctions pures.
import { totals, counts, paidOf } from './docs.js';
import { dueOf, remindList } from './reminders.js';
import { eur, num, round2, dateFr, today } from './util.js';

const OPEN = ['new', 'signed', 'progress'];
const PRIO = { 'late-invoice': 1, 'remind-quote': 1, quote: 2, 'send-quote': 2, deposit: 2, 'final-invoice': 2, finish: 3, plan: 4, collect: 5, 'wait-quote': 6, lost: 6 };

/* Étapes à faire sur un chantier ouvert, la plus utile en premier.
   ctx = { docs, payments, tasks, S, ref, st (siteStats du chantier), rem (remindList, sinon recalculée) }
   Chaque étape : { key, tone: 'bad'|'warn'|'ok'|'', text, label, href?, rel? (id du document à relancer), act? ('assign' | 'finish') } */
export function nextSteps(site, ctx = {}) {
  if (!site || !OPEN.includes(site.status)) return [];
  const { docs = [], payments = [], tasks = [], S = {}, ref = today(), st = {} } = ctx;
  const rem = ctx.rem || remindList(docs, payments, S, ref), remBy = new Map(rem.map(x => [x.doc.id, x]));
  const mine = docs.filter(d => d.siteId === site.id), quotes = mine.filter(d => d.type === 'quote');
  const signed = quotes.filter(d => ['accepted', 'invoiced'].includes(d.status));
  const out = [], push = (key, tone, text, label, more = {}) => out.push({ key, tone, text, label, ...more });
  const doc = d => '#/doc/' + d.id;

  if (!quotes.length) { push('quote', 'warn', 'Aucun devis sur ce chantier.', 'Créer le devis', { href: '#/doc/new/quote-' + site.id }); return out; }

  if (!signed.length) {
    const live = quotes.filter(q => q.status !== 'refused');
    if (!live.length) { push('lost', 'warn', `Le devis ${quotes[0].number || ''} a été refusé : l'adapter, ou passer le chantier en « Perdu ».`.replace('  ', ' '), 'Ouvrir le devis', { href: doc(quotes[0]) }); return out; }
    const sent = live.filter(q => q.status === 'sent'), draft = live.filter(q => q.status === 'draft');
    for (const q of sent) {
      const r = remBy.get(q.id);
      if (r) push('remind-quote', 'warn', `Devis ${q.number} envoyé il y a ${r.days} j, sans réponse.`, 'Relancer', { href: doc(q), rel: q.id });
      else push('wait-quote', '', `Devis ${q.number} envoyé le ${dateFr(String(q.date).slice(0, 10))} : en attente de la réponse du client.`, 'Ouvrir le devis', { href: doc(q) });
    }
    if (!sent.length && draft.length) push('send-quote', 'warn', `Le devis ${draft[0].number || ''} est encore en brouillon.`.replace('  ', ' '), 'Terminer et envoyer', { href: doc(draft[0]) });
    return out.sort((a, b) => PRIO[a.key] - PRIO[b.key]);
  }

  // marché signé : factures en retard, acompte, planning, solde, encaissement, fin
  const inv = mine.filter(d => d.type === 'invoice' && counts(d));
  const left = d => round2(totals(d).ttc - paidOf(payments, d.id));
  for (const d of inv) {
    const l = left(d); if (l <= 0.005 || d.status === 'dispute') continue;
    const due = dueOf(d, S), late = due && due < ref ? Math.round((Date.parse(ref) - Date.parse(due)) / 864e5) : 0, r = remBy.get(d.id);
    if (late > 0 && r) push('late-invoice', 'bad', `Facture ${d.number} en retard de ${late} j : reste ${eur(l)} à encaisser.`, 'Relancer', { href: doc(d), rel: d.id });
    else if (late > 0) push('late-invoice', 'warn', `Facture ${d.number} échue le ${dateFr(due)} : reste ${eur(l)} (déjà relancée récemment).`, 'Ouvrir la facture', { href: doc(d) });
    else push('collect', '', `Facture ${d.number} : reste ${eur(l)} à encaisser${due ? ' avant le ' + dateFr(due) : ''}.`, 'Ouvrir la facture', { href: doc(d) });
  }
  const sq = signed.find(q => q.status === 'accepted') || signed[0];
  if (!inv.length && num(st.encaisse) < 0.005 && num(st.marcheTTC) > 0) push('deposit', 'warn', `Marché signé de ${eur(st.marcheTTC)} TTC : rien n'est encore facturé.`, 'Facturer l\'acompte', { href: doc(sq) + '/deposit' });
  const hasProg = site.progress !== '' && site.progress != null && !isNaN(parseFloat(site.progress));
  if (num(st.resteFacturer) > 0.5 && hasProg && num(site.progress) >= 100) push('final-invoice', 'warn', `Travaux terminés : ${eur(st.resteFacturer)} TTC restent à facturer.`, 'Facturer le solde', { href: doc(sq) });
  if (!tasks.some(t => t.siteId === site.id)) push('plan', 'warn', 'Aucune équipe n\'est affectée à ce chantier.', 'Planifier', { href: '#/planning/week', act: 'assign' });
  if (inv.length && num(st.resteFacturer) <= 0.5 && num(st.resteAPayer) <= 0.005) push('finish', 'ok', 'Tout est facturé et encaissé : le chantier peut être terminé.', 'Terminer le chantier', { href: '#/site/' + site.id, act: 'finish' });
  return out.sort((a, b) => PRIO[a.key] - PRIO[b.key]);
}

/* Liste « À faire aujourd'hui » : relances, habilitations, chantiers en retard, chantiers à facturer, stock bas.
   o = { rem, lateSites, steps: [{ site, steps }], low, habs: [{ m, h, st }], C: { id → contact } }
   Retourne [{ key, tone, tag, title, sub, href, rel?, label?, prio }] triée par urgence. */
export function todoItems({ rem = [], lateSites = [], steps = [], low = [], habs = [], C = {}, ref = today() } = {}) {
  const out = [], cn = id => (C[id] && C[id].name) || '', day = iso => dateFr(String(iso).slice(0, 10));
  for (const x of rem) {
    const d = x.doc, who = cn(d.clientId);
    if (x.kind === 'invoice') out.push({ key: 'rem:' + d.id, tone: 'bad', tag: 'Facture en retard', title: `${d.number}${who ? ' · ' + who : ''}`, sub: `échue le ${day(x.due)} · ${x.days} j de retard · reste ${eur(x.left)}${x.n ? ` · relancée ${x.n} fois` : ' · jamais relancée'}${x.n >= 3 ? ' · mise en demeure à envisager' : ''}`, href: '#/doc/' + d.id, rel: d.id, label: '↻ Relancer', prio: 10 });
    else out.push({ key: 'rem:' + d.id, tone: 'warn', tag: 'Devis à relancer', title: `${d.number}${who ? ' · ' + who : ''}`, sub: `devis envoyé il y a ${x.days} j · ${eur(totals(d).ttc)} TTC${x.n ? ` · relancé ${x.n} fois` : ' · jamais relancé'}`, href: '#/doc/' + d.id, rel: d.id, label: '↻ Relancer', prio: 50 });
  }
  for (const x of habs) out.push({ key: 'hab:' + x.m.id + ':' + x.h.label, tone: x.st, tag: x.st === 'bad' ? 'Habilitation expirée' : 'Habilitation à renouveler', title: x.m.name, sub: `${x.h.label} · ${x.st === 'bad' ? 'expirée le ' : 'expire le '}${day(x.h.expiry)}`, href: '#/planning/team', prio: x.st === 'bad' ? 20 : 60 });
  for (const s of lateSites) out.push({ key: 'late:' + s.id, tone: 'bad', tag: 'Chantier en retard', title: s.name, sub: `${cn(s.clientId) ? cn(s.clientId) + ' · ' : ''}fin prévue le ${day(s.end)} · ${Math.max(1, Math.round((Date.parse(ref) - Date.parse(s.end)) / 864e5))} j de retard`, href: '#/site/' + s.id, prio: 30 });
  for (const { site, steps: l } of steps) {
    const s = l.find(x => ['final-invoice', 'deposit', 'finish', 'plan'].includes(x.key)); if (!s) continue;
    const tag = s.key === 'finish' ? 'Chantier à terminer' : s.key === 'plan' ? 'Chantier à planifier' : 'Chantier à facturer';
    out.push({ key: s.key + ':' + site.id, tone: s.tone, tag, title: site.name, sub: `${cn(site.clientId) ? cn(site.clientId) + ' · ' : ''}${s.text}`, href: s.key === 'plan' ? '#/site/' + site.id : s.href, label: s.label, prio: s.key === 'finish' ? 70 : s.key === 'plan' ? 80 : 40 });
  }
  if (low.length) out.push({ key: 'low', tone: 'warn', tag: 'Stock bas', title: `${low.length} article${low.length > 1 ? 's' : ''} à réapprovisionner`, sub: low.slice(0, 4).map(p => p.name).join(', ') + (low.length > 4 ? '…' : ''), href: '#/stock/products', prio: 55 });
  return out.map((x, i) => ({ ...x, i })).sort((a, b) => a.prio - b.prio || a.i - b.i).map(({ i, ...x }) => x);
}
