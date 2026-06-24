// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template (Worker) · key-ring (Sonnette / interphone)
// ───────────────────────────────────────────────────────────────────
// Page hebergee « interphone » servie au scan d'un QR pose sur un portail /
// une porte / un accueil sans electricite. Le telephone du VISITEUR fournit
// pile + reseau + intelligence : la page compose des liens de contact direct
// (Appeler / SMS / WhatsApp / E-mail) que le visiteur declenche depuis SON
// telephone (fiable, dans son forfait, zero cout serveur).
//
// ORDRE 2 (cette version) = SKIN « interphone premium sombre » (ref Stephane).
// Titre + sous-titre, image haute (WebP) avec message en surimpression
// optionnel, cartes d'action (Appeler / SMS / WhatsApp / E-mail), bouton
// primaire « Sonner maintenant » = le Web Push de l'ORDRE 3 (rendu seulement
// si push_enabled ; masque par defaut tant que l'ORDRE 3 n'est pas cable ->
// pas de bouton mort). 100% statique, AUCUNE IA, renderHTML PUR (aucun push
// ici). Le « Sonner » + la boucle retour + les destinataires = ORDRE 3.
//
// Garde-fou cardinal : CONFORT, PAS SECURITE. Jamais positionnee urgence /
// secours — c'est ecrit noir sur blanc sur la page.
//
// Pendant frontend : app/sdqr-templates/key-ring.js.
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot } from './_shared.js';

// Glyphes blancs (pleins) pour les pastilles colorees des cartes + cloche
// pour le bouton « Sonner maintenant ».
const ICON = {
  phone:    '<svg viewBox="0 0 24 24" width="30" height="30" fill="#fff" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .7-.2 1l-2.3 2.2z"/></svg>',
  chat:     '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="8.5" cy="10" r="1.05" fill="#fff" stroke="none"/><circle cx="12" cy="10" r="1.05" fill="#fff" stroke="none"/><circle cx="15.5" cy="10" r="1.05" fill="#fff" stroke="none"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" width="29" height="29" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.4a8.6 8.6 0 0 0-7.4 13l-1 3.6 3.7-1a8.6 8.6 0 1 0 4.7-15.6z"/><path d="M9.5 8.3c-.15-.35-.3-.33-.44-.34h-.37c-.13 0-.34.05-.52.25s-.68.66-.68 1.6.7 1.86.8 2 1.36 2.18 3.36 2.96c1.66.66 2 .53 2.37.5.36-.04 1.16-.48 1.32-.94.16-.46.16-.85.11-.93-.05-.08-.18-.13-.38-.23s-1.2-.59-1.38-.66-.32-.1-.46.1-.52.66-.64.8-.24.15-.44.05-.85-.31-1.62-1-.84-1.2-1.12-1.4-.01-.31.09-.4z" fill="#fff" stroke="none"/></svg>',
  mail:     '<svg viewBox="0 0 24 24" width="29" height="29" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2.4"/><path d="m3 6.5 9 6 9-6"/></svg>',
  bell:     '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
};

// Metadonnees par canal : titre, sous-titre HONNETE (pas de sur-promesse),
// glyphe et degrade de la pastille. tel: = audio seul ; la video vit sur
// la carte WhatsApp. L'ordre du tableau = l'ordre d'affichage des cartes.
const CHANNELS = [
  { k: 'tel',      t: 'Appeler',        s: 'Appel direct, depuis votre telephone.', ic: 'phone',    g1: '#2fd36b', g2: '#1eb257' },
  { k: 'sms',      t: 'Envoyer un SMS', s: 'Message pre-rempli, pret a envoyer.',    ic: 'chat',     g1: '#8a6bff', g2: '#6b4ef0' },
  { k: 'whatsapp', t: 'WhatsApp',       s: 'Message ou appel, audio et video.',      ic: 'whatsapp', g1: '#37d780', g2: '#1faa52' },
  { k: 'email',    t: 'E-mail',         s: 'Ecrivez-nous, on vous repond.',          ic: 'mail',     g1: '#5b8def', g2: '#3f6fd6' },
];

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
    const acc   = safeColor(d.accent_color, '#5b6cf5');
    const place = escHtml((d.place_name || 'Nom du lieu').toString().slice(0, 60));
    const sub   = escHtml((d.subtitle || 'Comment souhaitez-vous prévenir ?').toString().slice(0, 70));
    const msg   = (d.message || '').toString().slice(0, 280);
    const encMsg = encodeURIComponent(msg);
    const hero   = safeUrl(d.hero_url);
    const notice = escHtml((d.notice || '').toString().slice(0, 90));

    const phone = telDigits(d.phone);
    const wa    = waDigits(d.whatsapp);
    const email = mailOk(d.email);

    // Liens de contact — composes serveur, declenches sur le tel du visiteur.
    // sms: « ?&body= » couvre iOS (&body) ET Android (?body) en un seul href.
    const subj  = encodeURIComponent('Sonnette — ' + (d.place_name || '').toString().slice(0, 60).trim());
    const HREF = {
      tel:      phone ? 'tel:' + phone : '',
      sms:      phone ? 'sms:' + phone + (msg ? '?&body=' + encMsg : '') : '',
      whatsapp: wa    ? 'https://wa.me/' + wa + (msg ? '?text=' + encMsg : '') : '',
      email:    email ? 'mailto:' + email + (msg ? '?subject=' + subj + '&body=' + encMsg : '') : '',
    };

    // Cartes d'action : un canal n'apparait que s'il est renseigne.
    const cards = CHANNELS.filter(c => HREF[c.k]).map(c => {
      const blank = c.k === 'whatsapp' ? ' target="_blank" rel="noopener"' : '';
      return `<a class="card" href="${escHtml(HREF[c.k])}"${blank}>
          <span class="card-ic" style="background:linear-gradient(180deg,${c.g1},${c.g2});box-shadow:0 12px 26px ${c.g1}59">${ICON[c.ic]}</span>
          <span class="card-t">${c.t}</span>
          <span class="card-s">${c.s}</span>
        </a>`;
    }).join('');

    // Image haute (WebP/PNG/JPG) avec message en surimpression optionnel.
    // Sans image mais avec message -> bandeau de consigne autonome.
    let heroEl = '';
    if (hero) {
      heroEl = `<div class="hero"><img src="${hero}" alt="${notice}" referrerpolicy="no-referrer">${notice ? `<div class="hero-notice">${notice}</div>` : ''}</div>`;
    } else if (notice) {
      heroEl = `<div class="notice-solo">${notice}</div>`;
    }

    // « Sonner maintenant » (Web Push, ORDRE 3) : UN tap -> POST /ring -> push aux
    // appareils du proprio -> poll de l'etat (Sonnerie -> Reponse). Pas de form.
    const shortId = String(qrData?.short_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    const ringEl = `<div class="ring">
        <button class="sonner" type="button" id="ks-sonner"><span class="sonner-ic">${ICON.bell}</span><span id="ks-sonner-label">Sonner maintenant</span></button>
        <div class="ring-status" id="ks-status" hidden></div>
      </div>`;

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#070a11" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#eef1f6" media="(prefers-color-scheme: light)">
<title>${place} · Sonnette</title>
<style>
  :root { --acc:${acc}; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin:0; padding:0; min-height:100vh; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; letter-spacing:-0.01em;
    color:#eef1f7;
    background:radial-gradient(135% 95% at 50% -8%, #171f31 0%, #0b1019 46%, #070a11 100%);
    background-attachment:fixed; min-height:100vh;
    display:flex; flex-direction:column; align-items:center;
    padding: calc(34px + env(safe-area-inset-top,0px)) 20px calc(30px + env(safe-area-inset-bottom,0px)); }
  a { text-decoration:none; color:inherit; -webkit-tap-highlight-color:transparent; }
  .panel { width:100%; max-width:430px; }
  .title { margin:0; text-align:center; font-weight:900; letter-spacing:-0.03em; line-height:1.05;
    font-size:clamp(27px, 7.5vw, 37px); color:#fff; }
  .subtitle { margin:9px 0 0; text-align:center; font-size:16px; font-weight:500; color:#8b94a8; }
  /* Image haute + message en surimpression */
  .hero { position:relative; margin:24px 0 0; border-radius:22px; overflow:hidden; aspect-ratio:5/4;
    background:#10151f; border:1px solid rgba(255,255,255,.07); box-shadow:0 18px 40px rgba(0,0,0,.45); }
  .hero img { width:100%; height:100%; object-fit:cover; display:block; }
  .hero-notice { position:absolute; left:0; right:0; bottom:0; padding:18px 16px 14px;
    background:linear-gradient(transparent, rgba(4,7,12,.92)); color:#fff; font-size:15px; font-weight:600; }
  .notice-solo { margin:24px 0 0; padding:15px 16px; border-radius:16px;
    background:linear-gradient(180deg,#1b2130,#141923); border:1px solid rgba(255,255,255,.07);
    color:#fff; font-size:15px; font-weight:600; text-align:center; }
  /* Cartes d'action */
  .cards { margin:18px 0 0; display:grid; grid-template-columns:repeat(2,1fr); gap:13px; }
  .card { display:flex; flex-direction:column; align-items:center; text-align:center; padding:24px 16px 20px;
    border-radius:24px; background:linear-gradient(180deg,#1a2130,#121722); border:1px solid rgba(255,255,255,.07);
    box-shadow:0 10px 28px rgba(0,0,0,.32); transition:transform .12s ease; }
  .card:active { transform:translateY(1px) scale(.99); }
  .card:last-child:nth-child(odd) { grid-column:1 / -1; }
  .card-ic { width:78px; height:78px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-bottom:16px; }
  .card-t { font-size:clamp(15px, 4.2vw, 17px); font-weight:700; letter-spacing:-0.02em; color:#fff; white-space:nowrap; }
  .card-s { margin-top:5px; font-size:13px; line-height:1.4; color:#8b94a8; }
  /* Bouton primaire « Sonner maintenant » (push, ORDRE 3) — rectangle arrondi
     comme les cartes (PAS un pill). */
  .sonner { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; margin:16px 0 0;
    min-height:62px; border:0; border-radius:18px; cursor:pointer; color:#fff; font-family:inherit;
    font-size:17px; font-weight:800; letter-spacing:-0.01em;
    background:linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,0)), var(--acc);
    box-shadow:0 12px 30px rgba(0,0,0,.4), 0 6px 20px rgba(70,86,230,.4); }
  .sonner:active { transform:translateY(1px); }
  .sonner:disabled { opacity:.72; cursor:default; }
  .sonner-ic { display:flex; }
  /* Zone de statut de la sonnerie (ORDRE 3) */
  .ring { margin-top:16px; }
  .ring .sonner { margin-top:0; }
  .ring-status { margin-top:12px; border-radius:14px; padding:14px 16px; font-size:14px; line-height:1.4;
    background:linear-gradient(180deg,#161b27,#11151e); border:1px solid rgba(255,255,255,.08);
    color:#c7cede; text-align:center; }
  .ring-status.st-answered { background:linear-gradient(180deg,#13301f,#0f2618);
    border-color:rgba(64,220,140,.4); color:#d6ffe6; font-weight:700; font-size:16px; }
  /* Disclaimer : confort, pas securite (garde-fou cardinal) */
  .disclaimer { margin:16px 8px 0; text-align:center; font-size:11.5px; line-height:1.45; color:#626c84; }
  .sq-foot { margin:18px 0 0; text-align:center; font-size:11px; color:rgba(255,255,255,.4); }
  .sq-foot a { color:rgba(255,255,255,.6); }
  /* Mode clair auto (journee / appareil en clair) : meme structure, peau claire.
     Les pastilles colorees + le bouton accent restent vifs sur fond clair. */
  @media (prefers-color-scheme: light) {
    body { color:#1c2230; background:radial-gradient(135% 95% at 50% -8%, #ffffff 0%, #eef1f6 48%, #e4e9f1 100%); }
    .title { color:#0e1422; }
    .subtitle { color:#6b7488; }
    .hero { background:#e7ebf2; border-color:rgba(20,30,60,.08); box-shadow:0 14px 34px rgba(20,30,60,.14); }
    .notice-solo { background:#fff; border-color:rgba(20,30,60,.08); color:#1c2230; box-shadow:0 6px 16px rgba(20,30,60,.08); }
    .card { background:#fff; border-color:rgba(20,30,60,.08); box-shadow:0 8px 22px rgba(20,30,60,.10); }
    .card-t { color:#1c2230; }
    .card-s { color:#7a8396; }
    .disclaimer { color:#9aa3b2; }
    .sq-foot { color:#9aa7b8; }
    .sq-foot a { color:#6b7790; }
    .ring-status { background:#fff; border-color:rgba(20,30,60,.10); color:#52607a; box-shadow:0 6px 16px rgba(20,30,60,.07); }
    .ring-status.st-answered { background:#e7f9ef; border-color:rgba(34,180,110,.45); color:#11623a; }
  }
</style>
</head>
<body>
  <div class="panel">
    <h1 class="title">${place}</h1>
    <p class="subtitle">${sub}</p>
    ${heroEl}
    ${cards ? `<div class="cards">${cards}</div>` : ''}
    ${ringEl}
    <p class="disclaimer">Sonnette de confort &mdash; ce n'est pas un dispositif de sécurité ni de secours.</p>
    ${renderKeystoneFoot()}
  </div>
  <script>
  (function(){
    var SHORT = ${JSON.stringify(shortId)};
    var API = "https://keystone-os-api.keystone-os.workers.dev";
    var btn = document.getElementById("ks-sonner");
    var label = document.getElementById("ks-sonner-label");
    var statusEl = document.getElementById("ks-status");
    if (!btn || !SHORT) return;
    var poller = null;
    function setStatus(state, text){ statusEl.hidden=false; statusEl.className="ring-status st-"+state; statusEl.textContent=text; }
    function resetBtn(t){ btn.disabled=false; if(label) label.textContent=t||"Sonner maintenant"; }
    btn.addEventListener("click", function(){
      if(poller){ clearInterval(poller); poller=null; }
      btn.disabled=true; if(label) label.textContent="Sonnerie en cours…";
      setStatus("ringing","Sonnerie envoyée — on prévient l'occupant…");
      fetch(API+"/api/keyring/ring",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({short_id:SHORT})})
        .then(function(r){ return r.json().then(function(j){ return {s:r.status,j:j}; }, function(){ return {s:r.status,j:{}}; }); })
        .then(function(res){
          if(res.s===429){ setStatus("idle", (res.j&&res.j.error==="cooldown") ? "Vous venez de sonner, patientez un instant." : "Trop de sonneries pour aujourd'hui."); resetBtn(); return; }
          if(!res.j||!res.j.ok||!res.j.ring_id){ setStatus("idle","Sonnerie indisponible. Utilisez un moyen de contact ci-dessus."); resetBtn(); return; }
          setStatus("ringing","Sonnerie envoyée — en attente d'une réponse…");
          poll(res.j.ring_id);
        })
        .catch(function(){ setStatus("idle","Réseau indisponible. Utilisez un moyen de contact ci-dessus."); resetBtn(); });
    });
    function poll(id){
      var tries=0, MAX=40;
      poller=setInterval(function(){
        tries++;
        fetch(API+"/api/keyring/ring-status?id="+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(j){
          if(j&&j.status==="answered"&&j.response){ clearInterval(poller); poller=null; setStatus("answered","✓ "+j.response); resetBtn("Sonner à nouveau"); }
          else if(tries>=MAX){ clearInterval(poller); poller=null; setStatus("timeout","Pas de réponse pour l'instant. Vous pouvez appeler ou écrire ci-dessus."); resetBtn("Sonner à nouveau"); }
        }).catch(function(){ if(tries>=MAX){ clearInterval(poller); poller=null; setStatus("timeout","Pas de réponse pour l'instant."); resetBtn("Sonner à nouveau"); } });
      },3000);
    }
  })();
  </script>
</body>
</html>`;
  },
};

export default TEMPLATE;
