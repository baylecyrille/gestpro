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
