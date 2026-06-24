// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template (Worker) · key-ring (Sonnette / interphone)
// ───────────────────────────────────────────────────────────────────
// Page hebergee « interphone » servie au scan d'un QR pose sur un portail /
// une porte / un accueil sans electricite. Le telephone du VISITEUR fournit
// pile + reseau + intelligence : la page compose des liens de contact direct
// (Appeler / SMS / WhatsApp / E-mail) que le visiteur declenche depuis SON
// telephone (fiable, dans son forfait, zero cout serveur).
//
// ORDRE 1 (cette version) = structure + logique, SKIN NEUTRE (pas le design
// final). 100% statique, AUCUNE IA, AUCUN push (renderHTML est PUR). La zone
// de statut est un emplacement neutre que l'ORDRE 3 (Web Push + boucle retour)
// animera. Le « Sonner discrètement » (push) arrive a l'ORDRE 3.
//
// Garde-fou cardinal : CONFORT, PAS SECURITE. Jamais positionnee urgence /
// secours — c'est ecrit noir sur blanc sur la page.
//
// Pendant frontend : app/sdqr-templates/key-ring.js.
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeColor, renderKeystoneFoot } from './_shared.js';

// Icones outline (style Lucide, currentColor) — alignees sur les encodeurs
// contact de app/sdqr-types.js (tel / sms / whatsapp / email) + une cloche
// pour la plaque-nom (metaphore interphone).
const ICON = {
  phone:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  sms:      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>',
  mail:     '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  bell:     '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
};

// ── Composition des liens (memes schemas URI que les encodeurs SDQR) ──
// tel:  — garde chiffres + « + »  ·  wa.me — chiffres seuls.
function telDigits(v) { return String(v == null ? '' : v).replace(/[^\d+]/g, ''); }
function waDigits(v)  { return String(v == null ? '' : v).replace(/[^\d]/g, ''); }
function mailOk(v) {
  const e = String(v == null ? '' : v).trim();
  return (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/[<>"'\\]/.test(e)) ? e : '';
}

const TEMPLATE = {
  id:            'key-ring',
  label:         'Sonnette',
  description:   'Interphone par QR : le visiteur vous appelle, vous écrit (SMS, WhatsApp) ou vous envoie un e-mail depuis son téléphone. Idéal pour un portail ou un accès sans électricité.',
  tier_required: 'pro',
  noDestination: true,   // page terminale : pas de CTA « continuer » vers target_url

  validate(template_data) {
    const d = template_data || {};
    const errs = [];
    if (!(d.place_name && String(d.place_name).trim())) errs.push('Le nom du lieu est obligatoire.');
    const hasChannel = telDigits(d.phone) || waDigits(d.whatsapp) || mailOk(d.email);
    if (!hasChannel) errs.push('Renseignez au moins un moyen de contact (téléphone, WhatsApp ou e-mail).');
    return errs;
  },

  renderHTML(qrData, scanCtx) {
    const d     = qrData?.template_data || {};
    const acc   = safeColor(d.accent_color, '#7c8af9');
    const place = escHtml((d.place_name || 'Nom du lieu').toString().slice(0, 60));
    const sub   = escHtml((d.subtitle || '').toString().slice(0, 48));
    const msg   = (d.message || '').toString().slice(0, 280);
    const encMsg = encodeURIComponent(msg);

    const phone = telDigits(d.phone);
    const wa    = waDigits(d.whatsapp);
    const email = mailOk(d.email);

    // Liens de contact — composes serveur, declenches sur le tel du visiteur.
    // sms: « ?&body= » couvre iOS (&body) ET Android (?body) en un seul href.
    const telH  = phone ? 'tel:' + phone : '';
    const smsH  = phone ? 'sms:' + phone + (msg ? '?&body=' + encMsg : '') : '';
    const waH   = wa    ? 'https://wa.me/' + wa + (msg ? '?text=' + encMsg : '') : '';
    const subj  = encodeURIComponent('Sonnette — ' + (d.place_name || '').toString().slice(0, 60).trim());
    const mailH = email ? 'mailto:' + email + (msg ? '?subject=' + subj + '&body=' + encMsg : '') : '';

    // Canaux dans l'ordre canonique (un canal n'apparait que s'il est renseigne).
    const CH = [
      telH && { href: telH, ic: 'phone',    l: 'Appeler' },
      smsH && { href: smsH, ic: 'sms',      l: 'Envoyer un SMS' },
      waH  && { href: waH,  ic: 'whatsapp', l: 'WhatsApp', blank: true },
      mailH&& { href: mailH,ic: 'mail',     l: 'E-mail' },
    ].filter(Boolean);

    // Bouton principal = 1er canal disponible (Appeler en tete = le plus fiable).
    // L'« action primaire configurable » + le « Sonner (push) » arrivent a l'ORDRE 3.
    const primary = CH[0] || null;
    const rest    = CH.slice(1);

    const primaryBtn = primary
      ? `<a class="prim" href="${escHtml(primary.href)}"${primary.blank ? ' target="_blank" rel="noopener"' : ''}>
           <span class="prim-ic">${ICON[primary.ic]}</span><span class="prim-l">${primary.l}</span>
         </a>`
      : `<div class="prim prim-empty"><span class="prim-l">Aucun moyen de contact</span></div>`;

    const restBtns = rest.length
      ? `<div class="acts">${rest.map(a =>
          `<a class="act" href="${escHtml(a.href)}"${a.blank ? ' target="_blank" rel="noopener"' : ''}>
             <span class="act-ic">${ICON[a.ic]}</span><span class="act-l">${a.l}</span>
           </a>`).join('')}</div>`
      : '';

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${place} · Sonnette</title>
<style>
  :root { --acc:${acc}; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin:0; padding:0; min-height:100vh; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; letter-spacing:-0.01em;
    background:#eef1f5; color:#1c2230;
    min-height:100vh; display:flex; flex-direction:column; align-items:center;
    padding: calc(34px + env(safe-area-inset-top,0px)) 20px calc(28px + env(safe-area-inset-bottom,0px)); }
  a { text-decoration:none; color:inherit; -webkit-tap-highlight-color:transparent; }
  .panel { width:100%; max-width:430px; }
  /* Plaque-nom */
  .plaque { background:#fff; border-radius:22px; padding:26px 22px; text-align:center;
    box-shadow:0 2px 14px rgba(28,40,80,.07); }
  .plaque-ic { width:54px; height:54px; border-radius:16px; margin:0 auto 14px;
    display:flex; align-items:center; justify-content:center;
    background:#eff2f7; color:var(--acc); }
  .place { font-weight:800; letter-spacing:-0.02em; font-size:23px; line-height:1.15; }
  .sub { margin-top:5px; font-size:13px; font-weight:500; color:#8a93a5; }
  /* Bouton principal */
  .prim { display:flex; align-items:center; justify-content:center; gap:11px;
    margin-top:18px; min-height:64px; border-radius:18px; background:var(--acc); color:#fff;
    font-size:17px; font-weight:700; letter-spacing:-0.01em;
    box-shadow:0 6px 18px rgba(28,40,80,.18); }
  .prim:active { transform:translateY(1px); }
  .prim-empty { background:#dfe4ec; color:#8a93a5; box-shadow:none; }
  .prim-ic { display:flex; }
  /* Boutons secondaires */
  .acts { display:grid; grid-template-columns:repeat(auto-fit,minmax(0,1fr)); gap:10px; margin-top:10px; }
  .act { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
    min-height:64px; border-radius:15px; background:#fff; color:#2b3650;
    box-shadow:0 1px 7px rgba(28,40,80,.06); padding:8px 6px; }
  .act:active { transform:translateY(1px); }
  .act-ic { color:var(--acc); display:flex; }
  .act-l { font-size:12px; font-weight:600; }
  /* Zone de statut (neutre en ORDRE 1 ; animee a l'ORDRE 3) */
  .status { margin-top:18px; background:#fff; border-radius:15px; padding:13px 16px;
    display:flex; align-items:center; gap:10px; box-shadow:0 1px 7px rgba(28,40,80,.06); }
  .status .dot { width:9px; height:9px; border-radius:50%; background:#c2cad8; flex:0 0 auto; }
  .status .st-txt { font-size:12.5px; color:#6b7488; font-weight:500; }
  /* Disclaimer : confort, pas securite (garde-fou cardinal) */
  .note { margin:14px 4px 0; font-size:11px; line-height:1.45; color:#9aa3b2; text-align:center; }
  .sq-foot { margin:18px 0 0; font-size:11px; color:#9aa7b8; text-align:center; }
  .sq-foot a { color:#6b7790; }
</style>
</head>
<body>
  <div class="panel">
    <div class="plaque">
      <div class="plaque-ic">${ICON.bell}</div>
      <div class="place">${place}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>
    ${primaryBtn}
    ${restBtns}
    <div class="status">
      <span class="dot"></span>
      <span class="st-txt">Vous contactez l'occupant depuis votre téléphone.</span>
    </div>
    <p class="note">Sonnette de confort &mdash; ce n'est pas un dispositif de sécurité ni de secours.</p>
    ${renderKeystoneFoot()}
  </div>
</body>
</html>`;
  },
};

export default TEMPLATE;
