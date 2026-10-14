// Envoi d'un devis / d'une facture / d'un avoir par e-mail, avec le PDF joint.
// Le PDF est créé sur l'appareil. L'envoi part de votre propre compte Google (script Apps Script) ou, sur téléphone, de votre messagerie via le menu de partage.
import * as db from './db.js';
import { logoSrc } from './defaults.js';
import { e, eur, dateFr, cname, modal, toast, downloadFile, $ } from './util.js';
import { scriptCall, scriptMode } from './sheets.js';
import * as efact from './efact.js';
import * as auth from './auth.js';
import { totals, sheetHtml, vatNoteOf } from './docs.js';

export const MAIL_DEFAULTS = {
  subject: '{type} {numero} – {company}',
  body: 'Bonjour,\n\nVeuillez trouver ci-joint {le} n° {numero}{chantier}, d\'un montant de {montant} TTC.\n\n{action}\n\nCordialement,\n{owner}\n{company}\n{phone}'
};
export const MAIL_TOKENS = '{type} {le} {numero} {montant} {date} {chantier} {client} {action} {company} {owner} {phone}';

const TYPE = { quote: ['Devis', 'le devis'], invoice: ['Facture', 'la facture'], credit: ['Avoir', 'l\'avoir'] };
export const ADDR = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
export const addrList = s => String(s || '').split(/[;,\s]+/).map(x => x.trim()).filter(Boolean);

/* Remplace les {jetons} ; les lignes vides en trop (jeton sans valeur) sont ramenées à une seule */
export function fillTpl(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] ?? '' : m)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function mailVars(doc, S, client = {}) {
  const [type, le] = doc.deposit && doc.type === 'invoice' ? ['Facture d\'acompte', 'la facture d\'acompte'] : (TYPE[doc.type] || TYPE.invoice), t = totals(doc);
  const action = doc.type === 'quote'
    ? 'Pour l\'accepter, merci de nous le retourner daté et signé avec la mention « Bon pour accord ».' + (doc.validUntil ? ` Il est valable jusqu'au ${dateFr(doc.validUntil)}.` : '')
    : doc.type === 'credit' ? 'Cet avoir sera déduit de votre prochaine facture ou remboursé.'
      : doc.dueDate ? `Règlement attendu avant le ${dateFr(doc.dueDate)}.` : '';
  return { type, le, numero: doc.number || '', montant: eur(t.ttc), date: dateFr(doc.date), chantier: doc.siteRef ? ` (${doc.siteRef})` : '', client: cname(client), action, company: S.company || '', owner: S.owner || '', phone: S.phone || '' };
}
export const pdfName = doc => `${(TYPE[doc.type] || TYPE.invoice)[0]}-${String(doc.number || 'sans-numero').replace(/[^\w.-]+/g, '_')}.pdf`;

export const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };

/* Logo converti en PNG (le PDF/A n'accepte ni WebP ni SVG) */
export async function logoPng(S) {
  try {
    const img = new Image(); img.src = logoSrc(S); await img.decode();
    const w0 = img.naturalWidth || 600, h0 = img.naturalHeight || 200, k = Math.min(1, 900 / Math.max(w0, h0));
    const cv = document.createElement('canvas'); cv.width = Math.round(w0 * k); cv.height = Math.round(h0 * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' };
  } catch (_) { return null; }
}
/* Facture électronique Factur-X (PDF + XML EN 16931) */
export async function facturxBytes(doc, S, client, o) {
  const fx = await import('./facturx-pdf.js');
  return fx.buildFacturX(efact.model(doc, S, client, o), doc, S, { logo: await logoPng(S) });
}

/* Fenêtre d'envoi. ctx : { doc, S, client, payments, DN, onSent } */
export async function mailModal(ctx) {
  const { doc, S, client = {}, payments = [], DN = {} } = ctx;
  if (!doc.number) { alert('Ce document n\'a pas encore de numéro : enregistrez-le d\'abord (hors brouillon pour une facture).'); return; }
  const V = mailVars(doc, S, client);
  const subject = fillTpl(S.mailSubject || MAIL_DEFAULTS.subject, V), body = fillTpl(S.mailBody || MAIL_DEFAULTS.body, V);
  const isInv = doc.type !== 'quote';
  const orig = doc.type === 'credit' && doc.fromInvoice ? DN[doc.fromInvoice] : null;
  const o = { paid: doc.type === 'credit' ? 0 : payments.filter(p => p.docId === doc.id).reduce((a, p) => a + (+p.amount || 0), 0), fromInvoiceNumber: orig?.number || doc.fromInvoiceNumber || '', fromInvoiceDate: orig?.date || '', vatNote: vatNoteOf(doc, S) };
  const fxCheck = isInv ? efact.check(doc, S, client, o) : [];
  const fxOk = isInv && !fxCheck.some(r => r.level === 'err');
  const via = scriptMode();
  const html = `<p class="muted" style="margin-top:0">Le PDF est créé sur cet appareil avec votre mise en page.${via ? ' Le message part de votre compte Google ; les réponses arrivent sur ' + e(S.email || 'l\'e-mail de l\'entreprise (à renseigner dans Réglages)') + '.' : ' Sans script Google connecté, l\'envoi passe par votre messagerie (menu de partage sur téléphone).'}</p>
    <div class="cols">
      <label class="f"><span>À (plusieurs adresses : séparez-les par une virgule)</span><input name="to" type="text" inputmode="email" autocomplete="off" value="${e(client.email || '')}" placeholder="adresse e-mail du client"></label>
      <label class="f"><span>Copie (Cc)</span><input name="cc" type="text" inputmode="email" autocomplete="off" value=""></label>
      <label class="f full"><span>Objet</span><input name="subject" value="${e(subject)}"></label>
      <label class="f full"><span>Message</span><textarea name="body" rows="7">${e(body)}</textarea></label>
      ${isInv ? `<label class="f"><span>Pièce jointe</span><select name="fmt"><option value="pdf">PDF du document (mise en page GestPro)</option><option value="fx" ${fxOk ? '' : 'disabled'}>Factur-X : PDF + données de facture électronique${fxOk ? '' : ' (contrôle à corriger)'}</option></select></label>` : ''}
      ${via && S.email ? `<label class="f" style="justify-content:flex-end"><span><input type="checkbox" name="bcc" ${S.mailBcc === false ? '' : 'checked'}> M'envoyer une copie cachée (Cci)</span></label>` : ''}
    </div>
    <div class="row" style="margin-top:8px;align-items:center"><span id="mstat" class="muted" style="flex:1;min-width:180px">Préparation du PDF…</span><button type="button" class="btn sm" id="mshare">${typeof navigator !== 'undefined' && navigator.canShare ? 'Partager / messagerie' : 'Ouvrir ma messagerie'}</button><button type="button" class="btn sm" id="mdl">Télécharger le PDF</button></div>`;

  let job = null; // { fmt, p: Promise<Uint8Array> }
  const make = fmt => (fmt === 'fx' ? facturxBytes(doc, S, client, o) : sheetHtml(doc).then(h => import('./docpdf.js').then(m => m.renderPdf(h, { title: `${V.type} ${doc.number}`, author: S.company || 'GestPro' }))));
  const ensure = f => {
    const fmt = f.querySelector('[name=fmt]')?.value || 'pdf';
    if (!job || job.fmt !== fmt) {
      const st = $('#mstat', f); st.textContent = 'Préparation du PDF…';
      const p = make(fmt); job = { fmt, p };
      p.then(b => { if (job?.p === p) st.textContent = `✔ ${pdfName(doc).replace(/\.pdf$/, fmt === 'fx' ? '-facturx.pdf' : '.pdf')} prêt (${Math.max(1, Math.round(b.length / 1024))} Ko)`; }, err => { if (job?.p === p) st.textContent = '✖ ' + (err.message || err); });
    }
    return job.p;
  };
  const read = f => {
    const g = n => f.querySelector(`[name=${n}]`);
    return { to: addrList(g('to').value), cc: addrList(g('cc').value), subject: g('subject').value.trim(), body: g('body').value, bcc: !!g('bcc')?.checked, fmt: g('fmt')?.value || 'pdf' };
  };
  const fname = fmt => (fmt === 'fx' ? pdfName(doc).replace(/\.pdf$/, '-facturx.pdf') : pdfName(doc));

  modal(`Envoyer ${V.le} ${doc.number} par e-mail`, html, async (_, f) => {
    const m = read(f);
    if (!via) { f.querySelector('#mshare').click(); return false; }
    const bad = [...m.to, ...m.cc].find(a => !ADDR.test(a));
    if (!m.to.length) { alert('Indiquez l\'adresse e-mail du destinataire.'); return false; }
    if (bad) { alert('Adresse e-mail invalide : ' + bad); return false; }
    if (!m.subject) { alert('L\'objet est vide.'); return false; }
    const btn = f.querySelector('footer .btn.primary'), lbl = btn.textContent; btn.disabled = true; btn.textContent = 'Envoi…';
    try {
      const bytes = await ensure(f);
      const r = await scriptCall({ action: 'mail', to: m.to.join(','), cc: m.cc.join(','), bcc: m.bcc && S.email ? S.email : '', subject: m.subject, body: m.body, replyTo: S.email || '', fromName: S.company || '', files: [{ name: fname(m.fmt), mime: 'application/pdf', b64: toB64(bytes) }] });
      doc.mails = [...(doc.mails || []), { at: new Date().toISOString(), to: m.to.join(', '), by: auth.currentUser()?.name || '', fmt: m.fmt }];
      if (doc.type === 'quote' && doc.status === 'draft') doc.status = 'sent';
      else if (doc.type === 'invoice' && doc.status === 'pending') doc.status = 'sent';
      await db.put('documents', doc);
      toast(`E-mail envoyé à ${m.to.join(', ')}${r.left != null ? ` (${r.left} envois restants aujourd'hui)` : ''}`);
      ctx.onSent?.();
    } catch (err) {
      btn.disabled = false; btn.textContent = lbl;
      alert(mailError(err));
      return false;
    }
  }, {
    wide: true, submitLabel: via ? 'Envoyer' : 'Partager…',
    onOpen: f => {
      ensure(f).catch(() => {});
      f.querySelector('[name=fmt]')?.addEventListener('change', () => ensure(f).catch(() => {}));
      $('#mdl', f).onclick = async () => { try { const b = await ensure(f); downloadFile(fname(read(f).fmt), b, 'application/pdf'); } catch (err) { alert(err.message || err); } };
      $('#mshare', f).onclick = async () => {
        const m = read(f);
        try {
          const bytes = await ensure(f), name = fname(m.fmt);
          const file = new File([bytes], name, { type: 'application/pdf' });
          if (navigator.canShare?.({ files: [file] })) {
            try { await navigator.share({ files: [file], title: m.subject, text: m.body }); return; } catch (err) { if (err.name === 'AbortError') return; /* sinon : repli ci-dessous */ }
          }
          downloadFile(name, bytes, 'application/pdf');
          const q = [m.cc.length ? 'cc=' + encodeURIComponent(m.cc.join(',')) : '', 'subject=' + encodeURIComponent(m.subject), 'body=' + encodeURIComponent(m.body + '\n\n[Joignez le fichier « ' + name + ' » qui vient d\'être téléchargé]')].filter(Boolean).join('&');
          toast('PDF téléchargé : joignez-le au message');
          location.href = `mailto:${encodeURIComponent(m.to.join(','))}?${q}`;
        } catch (err) { alert(err.message || err); }
      };
    }
  });
}

/* Message d'erreur compréhensible pour l'utilisateur */
export function mailError(err) {
  const m = String(err?.message || err);
  if (/Action inconnue/i.test(m)) return 'Le script Apps Script n\'est pas à jour : collez la dernière version de Code.gs, puis Déployer › Gérer les déploiements › Modifier › Nouvelle version.';
  if (/autori|authori|permission|script\.send_mail|MailApp/i.test(m)) return 'L\'envoi d\'e-mails n\'est pas encore autorisé. Dans Apps Script, choisissez la fonction « autoriser » puis ▶ Exécuter, acceptez les autorisations, et redéployez une nouvelle version.\n\n(' + m + ')';
  return 'Envoi impossible : ' + m;
}
