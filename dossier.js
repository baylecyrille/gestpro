// « Nouveau dossier » (M2) : client → chantier → devis en une seule suite d'écrans, avec détection des clients en double (B3).
import * as db from './db.js';
import { e, cname, F, modal, toast, go, addressAutocomplete } from './util.js';
import { findSimilar } from './clients.js';
import { simBoxHtml, bindSimilar, dupQuestion } from './clients-ui.js';
import { pickSiteColor } from './sites.js';
import { alertBox, confirmBox } from './dialogs.js';
import { pickify } from './picker.js';

const addrOf = c => [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
const cLabel = c => cname(c) + (c.city ? ' — ' + c.city : '') + (c.zip ? ' (' + c.zip + ')' : '');

export async function dossierModal() {
  const [contacts, sites] = await Promise.all([db.all('contacts'), db.all('sites')]);
  const clients = contacts.filter(c => c.kind === 'client').sort((a, b) => cname(a).localeCompare(cname(b), 'fr'));
  modal('Nouveau dossier', `<p class="muted" style="margin-top:0">Le client, le chantier et le devis se créent d'un seul geste. Le devis s'ouvre ensuite en brouillon, rattaché au chantier.</p>
    <h4 style="margin:0 0 6px">1 · Client</h4>
    <div class="cols">
      <label class="f full"><span>Client existant</span><select name="clientId"><option value="">— nouveau client —</option>${clients.map(c => `<option value="${c.id}" data-q="${e((c.company || '') + ' ' + (c.zip || ''))}">${e(cLabel(c))}</option>`).join('')}</select></label>
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
      if (!String(o.name || '').trim()) { alertBox('Choisissez un client existant ou saisissez le nom du nouveau client.'); return false; }
      const strong = findSimilar(contacts, o, { kind: 'client' }).filter(x => x.strong);
      if (strong.length && !(await confirmBox(dupQuestion(strong, 'client')))) return false;
      client = await db.put('contacts', { kind: 'client', name: o.name.trim(), company: o.company, phone: o.phone, email: o.email, address: o.address, zip: o.zip, city: o.city });
    }
    const name = String(o.siteName || '').trim() || ('Chantier ' + (client.name || cname(client)));
    const site = await db.put('sites', { name, clientId: client.id, address: String(o.siteAddr || '').trim() || addrOf(client), start: o.start || '', end: o.end || '', status: 'new', note: '', color: pickSiteColor(sites) });
    toast('Dossier créé : ' + name);
    go(o.mkquote ? '#/doc/new/quote-' + site.id : '#/site/' + site.id);
  }, { submitLabel: 'Créer le dossier', onOpen: f => {
    const sel = f.querySelector('[name=clientId]'), box = f.querySelector('#dnew'), ad = f.querySelector('[name=siteAddr]');
    let auto = '';
    const sync = () => { box.hidden = !!sel.value; const c = clients.find(x => x.id === sel.value); if (c && (!ad.value || ad.value === auto)) ad.value = auto = addrOf(c); };
    sel.addEventListener('change', sync);
    pickify(sel, { placeholder: '🔍 Nom, société, ville, code postal…', addLabel: '+ Client', addTitle: 'Créer un nouveau client pour ce dossier',
      onAdd: () => { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); f.querySelector('[name=name]').focus(); } }); // « + Client » : on retire le choix et on saisit le nouveau client
    bindSimilar(f, contacts, { kind: 'client', useLabel: 'Choisir ce client', skip: () => !!sel.value, onUse: ex => { sel.value = ex.id; sel.dispatchEvent(new Event('change', { bubbles: true })); } });
    addressAutocomplete(f.querySelector('[name=address]'), it => { f.querySelector('[name=address]').value = it.street; f.querySelector('[name=zip]').value = it.zip; f.querySelector('[name=city]').value = it.city; });
    addressAutocomplete(ad, it => { ad.value = it.label; });
    sync();
  } });
}
