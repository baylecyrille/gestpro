// Signature du client sur tablette (N6) : cadre de signature tactile, nom du signataire, lieu de signature, déclaration.
import { e, eur, F, modal, cname, today, $ } from './util.js';
import { WHERE } from './retract.js';
import { docSums } from './vat.js';
import { isBlank, toPath } from './sign.js';

const nowIso = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${today()}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/* doc : le devis ; client : sa fiche ; onDone({ path, name, where, place, at }) est appelé à la validation (le devis est enregistré par l'appelant) */
export function signModal(doc, client, onDone) {
  const sums = docSums(doc), strokes = [];
  let live = null;
  modal('✍ Signature du devis ' + (doc.number || ''),
    `<p class="muted" style="margin-top:0">Faites signer le client <b>du doigt ou au stylet</b> dans le cadre. La signature reste dans l'application avec le devis ; elle n'est envoyée nulle part ailleurs.</p>
    <div class="cols"><p class="full" style="margin:0"><b>${e(doc.number || '')}</b> · ${e(cname(client) || 'client non renseigné')} · <b>${eur(sums.ttc)} TTC</b></p>
    ${F('Nom du signataire', 'signer', cname(client) || '', { cls: 'full', req: true })}
    ${F('Où le devis est-il signé ?', 'where', doc.signWhere || '', { type: 'select', options: [['', '— choisir —'], ...WHERE.filter(x => x[0])], cls: 'full' })}
    ${F('Lieu (ville ou adresse)', 'place', doc.signPlace || '', { cls: 'full' })}</div>
    <div class="sigpad"><canvas id="sigc" aria-label="Cadre de signature"></canvas><span class="sigline">Signature du client — « Bon pour accord »</span></div>
    <div class="row" style="margin:4px 0"><button type="button" class="btn sm" id="sigclr">Effacer</button><span class="sp"></span><span class="muted" id="sigmsg"></span></div>
    <label class="f full"><span><input type="checkbox" name="agree"> Le signataire déclare avoir pris connaissance du devis (travaux, prix, TVA, conditions) et le signe « Bon pour accord ».</span></label>`,
    async o => {
      if (isBlank(strokes)) { alert('Le client doit signer dans le cadre avant de valider.'); return false; }
      if (!String(o.signer || '').trim()) { alert('Indiquez le nom du signataire.'); return false; }
      if (!o.where) { alert('Indiquez où le devis est signé : cela détermine les délais de rétractation et de paiement.'); return false; }
      if (!o.agree) { alert('Cochez la déclaration du signataire.'); return false; }
      const path = toPath(strokes);
      await onDone({ path, name: o.signer, where: o.where, place: o.place || '', at: nowIso() });
    },
    {
      wide: true, submitLabel: 'Valider la signature',
      onOpen: f => {
        const cv = $('#sigc', f);
        let ctx = null;
        try { ctx = cv.getContext && cv.getContext('2d'); } catch { ctx = null; }
        const draw = () => {
          if (!ctx) return;
          const dpr = cv.width / Math.max(1, cv.clientWidth || cv.width);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10243f'; ctx.fillStyle = '#10243f';
          for (const s of strokes) {
            if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0][0], s[0][1], 1.5, 0, 6.283); ctx.fill(); continue; }
            ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]);
            for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]);
            ctx.stroke();
          }
        };
        const fit = () => { // la boîte n'a une taille qu'une fois affichée : on ajuste la résolution du cadre après l'ouverture
          const r = cv.getBoundingClientRect(), dpr = (window.devicePixelRatio || 1);
          if (!r.width) return;
          cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); draw();
        };
        setTimeout(fit, 30); window.addEventListener('resize', fit);
        const pos = ev => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
        const msg = () => { $('#sigmsg', f).textContent = isBlank(strokes) ? (strokes.length ? 'Trait trop court' : '') : 'Signature prise ✔'; };
        cv.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          try { cv.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
          live = [pos(ev)]; strokes.push(live); draw(); msg();
        });
        cv.addEventListener('pointermove', ev => {
          if (!live) return;
          ev.preventDefault();
          const list = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
          for (const c of (list.length ? list : [ev])) live.push(pos(c));
          draw(); msg();
        });
        const end = () => { live = null; msg(); };
        ['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, end));
        $('#sigclr', f).onclick = () => { strokes.length = 0; live = null; draw(); msg(); };
        $('#modal').addEventListener('close', () => window.removeEventListener('resize', fit), { once: true });
      }
    });
}
