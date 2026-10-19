// « Nouveau dossier » (M2) : client → chantier → devis en une seule suite d'écrans, avec détection des clients en double (B3).
import * as db from './db.js';
import { e, cname, F, modal, toast, go, addressAutocomplete } from './util.js';
import { findSimilar } from './clients.js';
import { simBoxHtml, bindSimilar, dupQuestion } from './clients-ui.js';
import { pickSiteColor } from './sites.js';

const addrOf = c => [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
const cLabel = c => cname(c) + (c.city ? ' — ' + c.city : '') + (c.zip ? ' (' + c.zip + ')' : '');

export async function dossierModal() {
  const [contacts, sites] = await Promise.all([db.all('contacts'), db.all('sites')]);
  const clients = contacts.filter(c => c.kind === 'client').sort((a, b) => cname(a).localeCompare(cname(b), 'fr'));
  modal('Nouveau dossier', `<p class="muted" style="margin-top:0">Le client, le chantier et le devis se créent d'un seul geste. Le devis s'ouvre ensuite en brouillon, rattaché au chantier.</p>
    <h4 style="margin:0 0 6px">1 · Client</h4>
    <div class="cols">
      <label class="f full"><span>Client existant</span><input type="search" id="dcs" placeholder="🔍 Rechercher un client (nom, ville, code postal)…" autocomplete="off" style="margin-bottom:6px"><select name="clientId"><option value="">➕ Nouveau client…</option>${clients.map(c => `<option value="${c.id}">${e(cLabel(c))}</option>`).join('')}</select></label>
      <div class="full" id="dnew"><div class="cols">${F('Nom / raison sociale', 'name', '', {})}${F('Contact (personne)', 'company', '')}${F('Téléphone', 'phone', '', { type: 'tel' })}${F('E-mail', 'email', '', { type: 'email' })}
        ${simBoxHtml()}${F('Adresse', 'address', '', { cls: 'full' })}${F('Code postal', 'zip', '')}${F('Ville', 'city', '')}</div></div>
    </div>
    <h4 style="margin:10px 0 6px">2 · Chantier</h4>
    <div class="cols">${F('Nom du chantier', 'siteName', '', { cls: 'full', ph: 'ex : Terrasse bois – Dupont (sinon : chantier + nom du client)' })}${F('Adresse des travaux', 'siteAddr', '', { type: 'textarea', rows: 2, cls: 'full' })}
      ${F('Début prévu', 'start', '', { type: 'date' })}${F('Fin prévue', 'end', '', { type: 'date' })}</div>
    <h4 style="margin:10px 0 6px">3 · Devis</h4>
    <label class="dpck"><input type="checkbox" name="mkquote" checked> Ouvrir aussitôt le devis (brouillon rattaché au chantier)</label>`,
  async o => {
    let client = clients.find(c => c.id === o.clientId);
    if (!client) {
      if (!String(o.name || '').trim()) { alert('Choisissez un client existant ou saisissez le nom du nouveau client.'); return false; }
      const strong = findSimilar(contacts, o, { kind: 'client' }).filter(x => x.strong);
      if (strong.length && !confirm(dupQuestion(strong, 'client'))) return false;
      client = await db.put('contacts', { kind: 'client', name: o.name.trim(), company: o.company, phone: o.phone, email: o.email, address: o.address, zip: o.zip, city: o.city });
    }
    const name = String(o.siteName || '').trim() || ('Chantier ' + (client.name || cname(client)));
    const site = await db.put('sites', { name, clientId: client.id, address: String(o.siteAddr || '').trim() || addrOf(client), start: o.start || '', end: o.end || '', status: 'new', note: '', color: pickSiteColor(sites) });
    toast('Dossier créé : ' + name);
    go(o.mkquote ? '#/doc/new/quote-' + site.id : '#/site/' + site.id);
  }, { submitLabel: 'Créer le dossier', onOpen: f => {
    const sel = f.querySelector('[name=clientId]'), box = f.querySelector('#dnew'), cs = f.querySelector('#dcs'), ad = f.querySelector('[name=siteAddr]');
    let auto = '';
    const sync = () => { box.hidden = !!sel.value; const c = clients.find(x => x.id === sel.value); if (c && (!ad.value || ad.value === auto)) ad.value = auto = addrOf(c); };
    sel.addEventListener('change', sync);
    cs.addEventListener('input', () => {
      const q = cs.value.toLowerCase().trim(), keep = sel.value;
      const rows = clients.filter(c => c.id === keep || !q || cLabel(c).toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q));
      sel.innerHTML = '<option value="">➕ Nouveau client…</option>' + rows.map(c => `<option value="${c.id}" ${c.id === keep ? 'selected' : ''}>${e(cLabel(c))}</option>`).join('');
      const m = rows.filter(c => c.id !== keep); if (q && m.length === 1 && !keep) { sel.value = m[0].id; sync(); }
    });
    bindSimilar(f, contacts, { kind: 'client', useLabel: 'Choisir ce client', skip: () => !!sel.value, onUse: ex => { if (![...sel.options].some(o => o.value === ex.id)) { cs.value = ''; cs.dispatchEvent(new Event('input')); } sel.value = ex.id; sync(); } });
    addressAutocomplete(f.querySelector('[name=address]'), it => { f.querySelector('[name=address]').value = it.street; f.querySelector('[name=zip]').value = it.zip; f.querySelector('[name=city]').value = it.city; });
    addressAutocomplete(ad, it => { ad.value = it.label; });
    sync();
  } });
}
