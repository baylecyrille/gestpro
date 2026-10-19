// Ouvrages (N8) : panneau « Composition » de la fiche produit et fenêtre d'insertion dans un devis / une facture.
// Le calcul est dans ouvrage.js (fonctions pures).
import * as db from './db.js';
import { e, eur, num, modal, $, $$ } from './util.js';
import { getS } from './defaults.js';
import { OUV_CAT, hasCompo, priceOf, compoLines, snapshot, asLine, asDetail, coefOf, COEF } from './ouvrage.js';

const r2n = v => Math.round((v + Number.EPSILON) * 100) / 100;
const fmtN = v => String(Math.round(v * 100) / 100).replace('.', ',');
const pct = v => (Math.round(v * 10) / 10).toString().replace('.', ',') + ' %';
const maps = (products, members) => ({ products: new Map((products || []).map(p => [p.id, p])), members: new Map((members || []).map(m => [m.id, m])) });

/* ---------- Fiche produit : panneau « Composition » ---------- */
export const compoHtml = () => `<div id="ouv" class="full ouv" hidden>
  <h3>Composition <span class="muted" style="font-weight:400">(pour une unité de l'ouvrage)</span></h3>
  <div id="ouvl"></div>
  <div class="row ouvadd"><button type="button" class="btn sm" data-add="p">＋ Produit</button><button type="button" class="btn sm" data-add="l">＋ Main d'œuvre</button><button type="button" class="btn sm" data-add="f">＋ Autre coût</button></div>
  <div id="ouvq" class="ouvq" hidden><input class="search" id="ouvqi" type="search" placeholder="Rechercher un produit du catalogue…" autocomplete="off"><div id="ouvqr"></div></div>
  <div class="cols"><label class="f"><span>Prix de vente</span><select name="ouvMode" id="ouvmode"><option value="coef">Prix de revient × coefficient</option><option value="fixed">Prix fixé à la main</option></select></label>
    <label class="f" id="ouvcw"><span>Coefficient</span><input name="ouvCoef" id="ouvcoef" type="number" step="0.01" min="0" placeholder="1,30"></label></div>
  <div id="ouvs" class="ouvs" aria-live="polite"></div>
</div>`;

/* Branche le panneau sur la fiche produit ouverte (f = formulaire). Retourne { read() } pour l'enregistrement. */
export async function bindCompo(f, p, products) {
  const [members, S] = await Promise.all([db.all('members'), getS()]);
  const mem = members.filter(m => m.active !== false || (p.compo || []).some(c => c.mid === m.id)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
  const ctx = maps(products, members);
  let compo = (p.compo || []).map(c => ({ ...c, id: c.id || db.uid() }));
  const panel = $('#ouv', f), rows = $('#ouvl', f), sumEl = $('#ouvs', f), modeSel = $('#ouvmode', f), coefInp = $('#ouvcoef', f), q = $('#ouvq', f), qi = $('#ouvqi', f), qr = $('#ouvqr', f);
  const cat = f.elements.category, sell = f.elements.sell, buy = f.elements.buy;
  modeSel.value = p.priceMode === 'fixed' ? 'fixed' : 'coef';
  coefInp.value = num(p.coef) > 0 ? p.coef : '';
  coefInp.placeholder = fmtN(coefOf({}, S));
  const cur = () => ({ ...p, category: OUV_CAT, compo, priceMode: modeSel.value, coef: coefInp.value, sell: sell.value });
  const hide = (name, on) => { const el = f.elements[name]; const lab = el && el.closest('label'); if (lab) lab.hidden = on; };
  const rowHtml = (c, L) => {
    const x = L[0], cost = `<span class="oc">${eur(x.cost)}</span><button type="button" class="btn sm" data-rm title="Retirer ce composant">✕</button>`;
    const warn = x.warn ? `<div class="ow">⚠ ${e(x.warn)}</div>` : '';
    if (c.k === 'p') return `<div class="orow" data-id="${e(c.id)}"><div class="on"><b>${e(x.name || 'Produit')}</b></div><input type="number" step="any" min="0" data-f="qty" value="${e(c.qty ?? '')}" aria-label="Quantité"><span class="ou">${e(x.unit)} × ${eur(x.uc)}</span>${cost}${warn}</div>`;
    if (c.k === 'l') return `<div class="orow" data-id="${e(c.id)}"><input data-f="name" value="${e(c.name ?? '')}" placeholder="Main d'œuvre atelier" aria-label="Libellé"><select data-f="mid" aria-label="Membre de l'équipe"><option value="">Taux saisi à la main</option>${mem.map(m => `<option value="${e(m.id)}" ${c.mid === m.id ? 'selected' : ''}>${e(m.name)}${num(m.rate) > 0 ? ' (' + fmtN(num(m.rate)) + ' €/h)' : ' (coût non renseigné)'}</option>`).join('')}</select>
      <input type="number" step="any" min="0" data-f="qty" value="${e(c.qty ?? '')}" aria-label="Heures"><span class="ou">h ×</span>${c.mid ? `<span class="ou">${eur(x.uc)}/h</span>` : `<input type="number" step="0.01" min="0" data-f="rate" value="${e(c.rate ?? '')}" aria-label="Coût horaire" placeholder="€/h" style="width:84px">`}${cost}${warn}</div>`;
    return `<div class="orow" data-id="${e(c.id)}"><input data-f="name" value="${e(c.name ?? '')}" placeholder="Sous-traitance, fourniture, forfait…" aria-label="Libellé"><input type="number" step="any" min="0" data-f="qty" value="${e(c.qty ?? '')}" aria-label="Quantité"><input data-f="unit" value="${e(c.unit ?? 'forfait')}" aria-label="Unité" style="width:70px"><span class="ou">×</span><input type="number" step="0.01" min="0" data-f="cost" value="${e(c.cost ?? '')}" aria-label="Coût unitaire HT" placeholder="€ HT" style="width:90px">${cost}</div>`;
  };
  const drawRows = () => {
    const L = compoLines(cur(), ctx);
    rows.innerHTML = compo.length ? compo.map((c, i) => rowHtml(c, [L[i]])).join('') : '<p class="muted" style="margin:4px 0">Aucun composant : l\'ouvrage reste un produit à prix fixe. Ajoutez des produits, des heures de main-d\'œuvre ou d\'autres coûts pour calculer son prix de revient.</p>';
  };
  const calc = () => {
    const comp = compo.length > 0, fixed = modeSel.value === 'fixed' || !comp;
    const P = priceOf(cur(), ctx, S);
    $('#ouvcw', f).hidden = fixed; modeSel.disabled = !comp;
    if (!fixed) { sell.value = P.sell ? String(P.sell) : '0'; }
    sell.readOnly = !fixed; sell.title = fixed ? '' : 'Calculé : prix de revient × coefficient';
    buy.value = P.cost ? String(P.cost) : '';
    const margin = r2n(num(sell.value) - P.cost), mk = P.cost ? num(sell.value) / P.cost : 0;
    sumEl.innerHTML = comp
      ? `Prix de revient <b>${eur(P.cost)}</b> · ${fixed ? `prix fixé <b>${eur(num(sell.value))}</b> (coefficient ×${fmtN(mk)})` : `coefficient ×${fmtN(P.coef)} → prix de vente <b>${eur(P.sell)}</b> HT`} · marge <b class="${margin < 0 ? 'neg' : 'pos'}">${eur(margin)}</b>${num(sell.value) ? ' (' + pct(margin / num(sell.value) * 100) + ' du prix de vente)' : ''}${P.warns ? `<div class="ow">⚠ ${P.warns} composant(s) sans prix : le prix de revient est incomplet.</div>` : ''}`
      : '';
  };
  const show = () => {
    const on = cat.value === OUV_CAT;
    panel.hidden = !on;
    for (const n of ['buy', 'min', 'supplierId', 'tvaBuy', 'kind']) hide(n, on);
    const svc = cat.value === 'Main d\'œuvre' || cat.value === 'Sous-traitance'; // services : ni stock ni seuil d'alerte (B5)
    hide('min', on || svc);
    const stk = $('#stkbox', f); if (stk) stk.hidden = on || svc;
    if (on) { drawRows(); calc(); }
  };
  cat.addEventListener('change', show);
  rows.addEventListener('input', ev => {
    const el = ev.target.closest('[data-f]'), row = ev.target.closest('.orow'); if (!el || !row) return;
    const c = compo.find(x => x.id === row.dataset.id); if (!c) return;
    c[el.dataset.f] = el.value;
    // met à jour le coût de la ligne sans redessiner (le champ garde le focus)
    const L = compoLines(cur(), ctx), i = compo.indexOf(c); row.querySelector('.oc').textContent = eur(L[i].cost); calc();
  });
  rows.addEventListener('change', ev => {
    if (!ev.target.matches('[data-f=mid]')) return;
    const row = ev.target.closest('.orow'), c = row && compo.find(x => x.id === row.dataset.id); if (c) c.mid = ev.target.value;
    drawRows(); calc();
  });
  rows.addEventListener('click', ev => {
    const rm = ev.target.closest('[data-rm]'); if (!rm) return;
    const row = rm.closest('.orow'); compo = compo.filter(x => x.id !== row.dataset.id); drawRows(); calc();
  });
  // Entrée dans un champ du panneau : pas d'enregistrement de la fiche
  panel.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.tagName !== 'BUTTON') ev.preventDefault(); });
  modeSel.addEventListener('change', calc);
  coefInp.addEventListener('input', calc);
  sell.addEventListener('input', calc);
  // recherche d'un produit du catalogue (pas d'autre fenêtre : la fiche reste ouverte)
  const norm = t => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const drawQ = () => {
    const toks = norm(qi.value).split(/\s+/).filter(Boolean), used = new Set(compo.filter(c => c.k === 'p').map(c => c.pid));
    const rs = (products || []).filter(x => x.id !== p.id && x.category !== OUV_CAT && x.name && (!toks.length || toks.every(t => norm([x.name, x.ref].join(' ')).includes(t)))).sort((a, b) => a.name.localeCompare(b.name, 'fr')).slice(0, 15);
    qr.innerHTML = rs.length ? rs.map(x => `<button type="button" class="sgi" data-pid="${e(x.id)}"><span class="n">${e(x.name)}${used.has(x.id) ? ' <small>(déjà dans la liste)</small>' : ''}</span><small>${e(x.ref || '')}</small><b>${num(x.buy) > 0 ? eur(x.buy) + ' / ' + e(x.unit || 'u') : 'prix d\'achat ?'}</b></button>`).join('') : '<div class="empty">Aucun produit ne correspond.</div>';
  };
  qi.addEventListener('input', drawQ);
  qr.addEventListener('click', ev => {
    const b = ev.target.closest('[data-pid]'); if (!b) return;
    const x = ctx.products.get(b.dataset.pid); if (!x) return;
    compo.push({ id: db.uid(), k: 'p', pid: x.id, qty: 1, unit: x.unit || 'u', uc: num(x.buy) });
    q.hidden = true; qi.value = ''; drawRows(); calc();
    const last = rows.querySelector('.orow:last-child [data-f=qty]'); if (last) { last.focus(); last.select?.(); }
  });
  $$('[data-add]', f).forEach(b => b.onclick = () => {
    const k = b.dataset.add;
    if (k === 'p') { q.hidden = !q.hidden; if (!q.hidden) { drawQ(); qi.focus(); } return; }
    q.hidden = true;
    compo.push(k === 'l' ? { id: db.uid(), k: 'l', name: 'Main d\'œuvre atelier', mid: '', qty: 1, rate: '' } : { id: db.uid(), k: 'f', name: '', qty: 1, unit: 'forfait', cost: '' });
    drawRows(); calc();
    const el = rows.querySelector('.orow:last-child [data-f=name]'); if (el) el.focus();
  });
  show();
  return {
    /* Valeurs à enregistrer sur la fiche (composition épurée + prix d'achat et de vente calculés) */
    read() {
      const clean = compo.filter(c => (c.k === 'p' ? c.pid : c.k === 'l' ? num(c.qty) > 0 : (String(c.name || '').trim() || num(c.cost) > 0))).map(c => {
        const o = { id: c.id, k: c.k, qty: num(c.qty) };
        if (c.k === 'p') { o.pid = c.pid; o.unit = c.unit || ''; }
        else if (c.k === 'l') { o.name = String(c.name || '').trim() || 'Main d\'œuvre'; if (c.mid) o.mid = c.mid; else o.rate = num(c.rate); }
        else { o.name = String(c.name || '').trim() || 'Autre coût'; o.unit = String(c.unit || '').trim() || 'forfait'; o.cost = num(c.cost); }
        if (c.uc !== undefined) o.uc = c.uc;
        return o;
      });
      const fixed = modeSel.value === 'fixed' || !clean.length;
      const base = { ...p, category: OUV_CAT, compo: clean, priceMode: fixed ? 'fixed' : 'coef', ...(num(coefInp.value) > 0 && !fixed ? { coef: num(coefInp.value) } : {}), sell: num(sell.value) };
      if (!num(coefInp.value) || fixed) delete base.coef;
      const snap = snapshot(base, ctx, S);
      return { compo: snap.compo, priceMode: base.priceMode, coef: base.coef, buy: snap.buy, sell: fixed ? num(sell.value) : snap.sell };
    }
  };
}
/* ---------- Devis / facture : insertion d'un ouvrage ---------- */
/* Ouvre la fenêtre « Ajouter l'ouvrage » : quantité et présentation (une ligne, ou détaillée).
   o = { qty, mode ('line' | 'detail'), sell (prix de vente imposé, pour détailler une ligne existante), title }.
   onPick({ mode, qty, line | detail }) reçoit les lignes à insérer. */
export async function ouvrageInsertModal(p, o = {}, onPick) {
  const [products, members, S] = await Promise.all([db.all('products'), db.all('members'), getS()]);
  const ctx = maps(products, members), P0 = priceOf(p, ctx, S), canDetail = P0.cost > 0;
  const mode0 = o.mode === 'detail' && canDetail ? 'detail' : 'line';
  const body = `<p class="muted" style="margin-top:0">Ouvrage composé : ${P0.lines.length} composant(s). Prix de revient et prix de vente sont calculés d'après le catalogue et le coût horaire des membres.</p>
    <div class="cols"><label class="f"><span>Quantité (${e(p.unit || 'u')})</span><input name="qty" type="number" step="any" min="0" value="${e(o.qty ?? 1)}" required></label><div></div></div>
    <fieldset class="ouvmode"><legend>Présentation sur le document</legend>
      <label><input type="radio" name="mode" value="line" ${mode0 === 'line' ? 'checked' : ''}><span><b>Une seule ligne</b> — le client voit l'ouvrage et son prix ; la composition reste interne</span></label>
      <label><input type="radio" name="mode" value="detail" ${mode0 === 'detail' ? 'checked' : ''} ${canDetail ? '' : 'disabled'}><span><b>Détaillée</b> — une section avec une ligne par composant (matière, main-d'œuvre…), au même total${canDetail ? '' : ' <small class="muted">(indisponible : prix de revient nul)</small>'}</span></label></fieldset>
    <div id="ouvres" class="ouvs" aria-live="polite"></div>`;
  modal(o.title || `Ajouter l'ouvrage « ${p.name} »`, body, form => {
    const qty = num(form.qty) || 1, mode = form.mode === 'detail' && canDetail ? 'detail' : 'line';
    const res = mode === 'detail' ? { mode, qty, detail: asDetail(p, qty, ctx, S, o.sell) } : { mode, qty, line: asLine(p, qty, ctx, S, o.sell) };
    if (mode === 'detail' && !res.detail) throw new Error('Impossible de détailler cet ouvrage : son prix de revient est nul.');
    onPick(res);
  }, {
    submitLabel: 'Ajouter',
    onOpen: f => {
      const upd = () => {
        const qty = num(f.elements.qty.value) || 0, sell = o.sell !== undefined && o.sell !== null ? num(o.sell) : P0.sell, tot = Math.round(qty * sell * 100) / 100, margin = Math.round((tot - qty * P0.cost) * 100) / 100;
        $('#ouvres', f).innerHTML = `Prix de revient <b>${eur(P0.cost)}</b> · prix de vente <b>${eur(sell)}</b> HT l'unité${P0.fixed || o.sell != null ? '' : ` <span class="muted">(coefficient ×${fmtN(P0.coef)})</span>`}<br>Total <b>${eur(tot)}</b> HT · marge <b class="${margin < 0 ? 'neg' : 'pos'}">${eur(margin)}</b>${tot ? ' (' + pct(margin / tot * 100) + ')' : ''}${P0.warns ? `<div class="ow">⚠ ${P0.warns} composant(s) sans prix : le prix de revient est incomplet (voir la fiche de l'ouvrage).</div>` : ''}`;
      };
      f.elements.qty.addEventListener('input', upd); upd();
      f.elements.qty.focus(); f.elements.qty.select?.();
    }
  });
}

export { hasCompo, COEF };
