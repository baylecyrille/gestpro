// Import additif (fusion) d'un fichier GestPro : ajoute clients, chantiers, produits, devis, factures, règlements
// sans toucher aux données existantes. Tout reste sur cet appareil : le fichier est lu localement.
import * as db from './db.js';
import { ensureBlocks } from './blocks.js';

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\b(MR?|MME|MLLE|MONSIEUR|MADAME|ET)\b\.?/g, ' ').replace(/[^A-Z0-9]+/g, ' ').trim();

export async function planImport(data) {
  if (!data || data.app !== 'gestpro') throw new Error('Ce fichier n\'est pas un export GestPro.');
  const [contacts, products, docs] = await Promise.all([db.all('contacts'), db.all('products'), db.all('documents')]);
  const cKey = c => norm(c.name) + '|' + (c.zip || '');
  const have = new Map(contacts.filter(c => c.kind === 'client').map(c => [cKey(c), c.id]));
  const map = {};
  let newC = 0;
  for (const c of data.contacts || []) { const ex = have.get(cKey(c)); if (ex) map[c.id] = ex; else newC++; }
  const hasDoc = new Set(docs.map(d => d.type + '|' + d.number));
  const newD = (data.documents || []).filter(d => !hasDoc.has(d.type + '|' + d.number) || docs.some(x => x.id === d.id)).length;
  const pNames = new Set(products.map(p => (p.name || '').toLowerCase()));
  const newP = (data.products || []).filter(p => !pNames.has((p.name || '').toLowerCase())).length;
  return { contacts: newC, docs: newD, skippedDocs: (data.documents || []).length - newD, products: newP, sites: (data.sites || []).length, payments: (data.payments || []).length, map, hasDoc };
}

export async function runImport(data) {
  const plan = await planImport(data);
  const [docs] = await Promise.all([db.all('documents')]);
  const sameId = new Set(docs.map(d => d.id));
  const map = plan.map;
  const contacts = (data.contacts || []).filter(c => !map[c.id]);
  const keepDocs = (data.documents || []).filter(d => !plan.hasDoc.has(d.type + '|' + d.number) && !sameId.has(d.id));
  const keepIds = new Set(keepDocs.map(d => d.id));
  const pNames = new Set((await db.all('products')).map(p => (p.name || '').toLowerCase()));
  const products = (data.products || []).filter(p => !pNames.has((p.name || '').toLowerCase()));
  const prodDrop = new Set((data.products || []).filter(p => pNames.has((p.name || '').toLowerCase())).map(p => p.id));
  const siteIds = new Set((await db.all('sites')).map(s => s.id));
  const sites = (data.sites || []).filter(s => !siteIds.has(s.id)).map(s => ({ ...s, clientId: map[s.clientId] || s.clientId }));
  const out = keepDocs.map(d => {
    const o = { ...d, clientId: map[d.clientId] || d.clientId };
    o.blocks = (d.blocks || []).map(b => (b.pid && prodDrop.has(b.pid) ? { ...b, pid: '' } : b));
    ensureBlocks(o);
    o.lines.forEach(l => { if (l.pid && prodDrop.has(l.pid)) l.pid = ''; });
    return o;
  });
  const pays = (data.payments || []).filter(p => keepIds.has(p.docId));
  await db.putMany('contacts', contacts);
  await db.putMany('sites', sites);
  await db.putMany('products', products);
  await db.putMany('documents', out);
  await db.putMany('payments', pays);
  return { contacts: contacts.length, sites: sites.length, products: products.length, documents: out.length, payments: pays.length, skipped: (data.documents || []).length - out.length };
}

/* Correction des statuts de devis déjà importés.
   Fichier { app: 'gestpro', mode: 'statuts', statuts: { <id du devis>: 'invoiced' | 'accepted' | 'sent' | … } } : il ne contient que des identifiants et des statuts.
   Un fichier peut aussi porter « previous » (statuts d'une correction antérieure) : un devis dont le statut est encore celui que cette correction lui avait donné est de nouveau modifiable.
   Le même fichier peut porter « chantiers » : { <id du chantier>: 'new' | … } (voir plus bas).
   Garde-fous : seuls les devis importés encore « Facturé » (ou resté tel que la correction précédente l'a laissé), sans facture créée depuis dans l'appli, sont modifiés ; un statut changé à la main reste tel quel. */
export const QSTAT = { draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé' };
export const SSTAT = { new: 'Nouveau', signed: 'Signé', progress: 'En cours', paid: 'Terminé', lost: 'Perdu' };
export const isStatusFile = data => !!data && data.app === 'gestpro' && data.mode === 'statuts' && ['statuts', 'chantiers'].some(k => data[k] && typeof data[k] === 'object') && ['statuts', 'chantiers'].every(k => data[k] == null || typeof data[k] === 'object');
/* Chantiers : un chantier « Signé » dont tous les documents sont des devis importés encore « Envoyé » (aucune facture, aucun avoir, rien créé dans l'appli)
   est rétabli au statut du fichier (« Nouveau ») ; il est évalué avec les statuts de devis tels qu'ils seront après la correction du même fichier. */
export async function planStatuts(data) {
  if (!isStatusFile(data)) throw new Error('Ce fichier n\'est pas un fichier de correction des statuts GestPro.');
  const docs = await db.all('documents'), byId = new Map(docs.map(d => [d.id, d])), prev = data.previous && typeof data.previous === 'object' ? data.previous : {};
  const fromApp = new Set(docs.filter(d => d.type === 'invoice' && !d.deposit && d.fromQuote && !d.imported).map(d => d.fromQuote)); // facturé depuis l'import, dans l'appli
  const changes = [], to = {}; let same = 0, edited = 0, missing = 0;
  const eff = new Map(); // statut des devis une fois la correction appliquée
  for (const [id, st] of Object.entries(data.statuts || {})) {
    const q = byId.get(id);
    if (!q || q.type !== 'quote' || !QSTAT[st]) { missing++; continue; }
    if (q.status === st) { same++; continue; }
    if (!q.imported || (q.status !== 'invoiced' && q.status !== prev[id]) || q.invoiceId || fromApp.has(id)) { edited++; continue; }
    changes.push([q, st]); to[st] = (to[st] || 0) + 1; eff.set(id, st);
  }
  const sites = { changes: [], to: {}, same: 0, kept: 0, missing: 0, total: Object.keys(data.chantiers || {}).length };
  if (sites.total) {
    const all = new Map((await db.all('sites')).map(x => [x.id, x])), onSite = {};
    docs.forEach(d => { if (d.siteId) (onSite[d.siteId] ||= []).push(d); });
    for (const [id, st] of Object.entries(data.chantiers)) {
      const x = all.get(id);
      if (!x || !SSTAT[st]) { sites.missing++; continue; }
      if (x.status === st) { sites.same++; continue; }
      const ds = onSite[id] || [];
      if (x.status !== 'signed' || !ds.length || !ds.every(d => d.type === 'quote' && d.imported && (eff.get(d.id) || d.status) === 'sent')) { sites.kept++; continue; }
      sites.changes.push([x, st]); sites.to[st] = (sites.to[st] || 0) + 1;
    }
  }
  return { changes, to, same, edited, missing, total: Object.keys(data.statuts || {}).length, sites };
}
export async function runStatuts(data) {
  const plan = await planStatuts(data);
  const out = plan.changes.map(([q, st]) => ({ ...q, status: st })), outS = plan.sites.changes.map(([x, st]) => ({ ...x, status: st }));
  await db.putMany('documents', out);
  await db.putMany('sites', outS);
  return { changed: out.length, to: plan.to, kept: plan.edited, sites: outS.length, sitesTo: plan.sites.to, sitesKept: plan.sites.kept };
}
