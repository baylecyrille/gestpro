// Verrou d'édition « souple » : pendant qu'un élément (devis, chantier, membre…) est ouvert en modification,
// les autres utilisateurs le voient grisé et ne peuvent pas l'ouvrir. Le verrou est un petit enregistrement
// partagé par la synchronisation Google Sheets ; il expire seul (appareil éteint, application fermée).
import * as db from './db.js';
import * as sheets from './sheets.js';
import * as auth from './auth.js';

const TTL = 6 * 60e3, BEAT = 90e3;
const rid = id => 'lock_' + id;
const dev = () => { try { let d = localStorage.getItem('gp_dev'); if (!d) { d = db.uid(); localStorage.setItem('gp_dev', d); } return d; } catch { return 'dev'; } };
const live = v => v && v.dev !== dev() && Date.now() - v.at <= TTL;
const held = new Map(); // id → { stop, prefix }

export const lockMsg = h => `🔒 En cours de modification par ${h.name || 'un autre appareil'}${h.at ? ' (depuis ' + new Date(h.at).toTimeString().slice(0, 5) + ')' : ''}.`;
export async function holder(id) { const v = (await db.get('settings', rid(id)))?.value; return live(v) ? v : null; }
export async function allLocks() {
  const out = {};
  for (const r of await db.all('settings')) if (r.id?.startsWith('lock_') && live(r.value)) out[r.id.slice(5)] = r.value;
  return out;
}
export const lockCls = (L, id) => (L && L[id] ? ' locked' : '');
export const lockTag = (L, id) => (L && L[id] ? `<span class="chip lockchip">🔒 ${L[id].name || 'modifié ailleurs'}</span>` : '');

async function fresh() { // récupère les verrous des autres appareils avant de décider
  if (sheets.configured() && navigator.onLine) await Promise.race([sheets.sync().catch(() => {}), new Promise(r => setTimeout(r, 2500))]);
}
async function write(id) { await db.put('settings', { id: rid(id), value: { dev: dev(), name: auth.currentUser()?.name || '', at: Date.now() } }); }
const canForce = () => { try { return !auth.isActive() || auth.can('*') || auth.currentUser()?.access === 'admin'; } catch { return true; } };

/* Tente de prendre le verrou. { blocked: h } si un autre l'a ; { stop } sinon (à appeler à la fermeture). */
export async function begin(id, { prefix = '', force = false } = {}) {
  if (held.has(id)) return { stop: held.get(id).stop, again: true };
  await fresh();
  const h = await holder(id);
  if (h && !force) return { blocked: h, canForce: canForce() };
  await write(id);
  const timer = setInterval(() => write(id).catch(() => {}), BEAT);
  const stop = async () => { clearInterval(timer); held.delete(id); try { await db.del('settings', rid(id)); } catch { /* ignore */ } };
  held.set(id, { stop, prefix });
  return { stop };
}
/* Ouvre une fenêtre d'édition sous verrou : open() doit appeler modal() */
export async function withLock(id, open) {
  let r = await begin(id);
  if (r.blocked) {
    if (!r.canForce) { alert(lockMsg(r.blocked) + '\nRéessayez dans un moment.'); return; }
    if (!confirm(lockMsg(r.blocked) + '\n\nOuvrir quand même ? (risque d\'écraser ses modifications)')) return;
    r = await begin(id, { force: true });
  }
  open();
  const d = document.querySelector('#modal');
  if (d && !r.again) d.addEventListener('close', () => r.stop(), { once: true });
}
/* Libère les verrous de fiches (par préfixe de route) quand on quitte la page */
export function releaseOutside(hash) { for (const [id, v] of held) if (v.prefix && !hash.startsWith(v.prefix)) v.stop(); }
window.addEventListener('hashchange', () => releaseOutside(location.hash));
window.addEventListener('pagehide', () => { for (const [, v] of held) v.stop(); });
