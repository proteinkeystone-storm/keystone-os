// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · boite-cadeau (V4.2)
// ───────────────────────────────────────────────────────────────────
// Boîte cadeau 3D : ruban + couvercle qui s'ouvre au tap, explosion de
// paillettes, reveal du code promo + titre/message personnalisés saisis
// par le commerçant (l'occasion s'affiche en sous-titre).
//
// Pas d'état serveur (anonyme). Le code promo est figé côté commerçant
// et identique pour tous les scanneurs (contrairement aux jeux V4.3 où
// chaque gain a son code signé unique).
//
// UX :
//   T+0      boîte fermée centrée, ruban en accent_color
//   user tap  vibrate + ruban s'évade + couvercle rotateX 3D
//   T+1s     paillettes explosion
//   T+1.4s   reveal code promo + valeur + validité
//   T+2.5s   titre + message du commerçant arrivent en fondu
//
// Cf. BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md § "7. Boîte cadeau"
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot } from './_shared.js';

const TEMPLATE = {
  id:              'boite-cadeau',
  label:           'Boîte cadeau',
  tier_required:   'pro',

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    if (!d.code_promo || !String(d.code_promo).trim()) {
      errors.push('Le code promo est obligatoire.');
    }
    return errors;
  },

  renderHTML(qrData, scanCtx) {
    const d           = qrData?.template_data || {};
    const safeShort   = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const nomMarque   = escHtml((d.nom_marque || '').toString().slice(0, 60));
    const logoUrl     = safeUrl(d.logo_url);
    const accent      = safeColor(d.accent_color, '#e11d48');
    const couleurBoite = safeColor(d.couleur_boite, '#7c1d1d');
    const couleurRuban = safeColor(d.couleur_ruban, accent);
    const codePromo   = escHtml((d.code_promo || 'CADEAU').toString().slice(0, 40));
    const valeurOffre = escHtml((d.valeur_offre || '').toString().slice(0, 80));
    const validite    = escHtml((d.validite || '').toString().slice(0, 100));
    const occasion    = escHtml((d.occasion || '').toString().slice(0, 60));

    // Titre + message saisis par le propriétaire (remplacent l'ancienne
    // phrase IA). Révélés en fondu à l'ouverture de la boîte.
    const smartTitle   = escHtml((qrData?.smart_title   || '').toString().slice(0, 80));
    const smartMessage = escHtml((qrData?.smart_message || '').toString().slice(0, 400));

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nomMarque || 'Boîte cadeau'} · Smart QR</title>
<style>
  :root {
    --bg: #07090d; --card: #0d1218; --bd: #1c2632;
    --tx: #f1f5f9; --mut: #94a3b8; --gold: #c9a96e;
    --acc: ${accent};
    --box: ${couleurBoite};
    --ribbon: ${couleurRuban};
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--tx);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.02em; min-height: 100vh; overflow-x: hidden;
    user-select: none; -webkit-user-select: none; }
  body { display: flex; align-items: center; justify-content: center;
    padding: 20px; min-height: 100vh; position: relative;
    -webkit-tap-highlight-color: transparent; }

  .sq-bg {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(ellipse at center,
      ${accent}33 0%, ${accent}11 35%, transparent 70%);
    animation: bg-pulse 4s ease-in-out infinite;
  }
  body.is-open .sq-bg {
    background: radial-gradient(ellipse at center,
      ${accent}66 0%, ${accent}22 35%, transparent 75%);
  }
  @keyframes bg-pulse {
    0%, 100% { opacity: .7; transform: scale(1); }
    50%      { opacity: 1;  transform: scale(1.06); }
  }

  .sq-card {
    position: relative; z-index: 1;
    max-width: 460px; width: 100%;
    background: linear-gradient(180deg, #0e141b 0%, var(--card) 100%);
    border: 1px solid var(--bd);
    border-radius: 24px;
    padding: 32px 22px 24px;
    text-align: center;
    box-shadow:
      0 32px 72px rgba(0,0,0,.55),
      0 0 0 1px ${accent}1a inset,
      0 1px 0 0 rgba(255,255,255,.04) inset;
    animation: card-in 600ms cubic-bezier(.16,.84,.3,1);
  }
  @keyframes card-in {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .sq-brand-cap { font-size: 10.5px; letter-spacing: .26em;
    color: var(--gold); text-transform: uppercase;
    margin-bottom: 14px; font-weight: 600; opacity: .85; }

  .sq-head { margin-bottom: 6px; }
  .sq-logo { max-height: 48px; max-width: 140px;
    margin: 0 auto 8px; display: block;
    filter: drop-shadow(0 4px 12px ${accent}55); }
  .sq-marque {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 22px; font-weight: 700;
    letter-spacing: -.02em; margin: 0;
    color: ${accent};
  }
  .sq-occasion {
    color: var(--mut); font-size: 12.5px;
    margin: 4px 0 6px;
    letter-spacing: .04em;
  }

  /* Stage 3D pour la boîte */
  .sq-gift-stage {
    perspective: 800px;
    height: 220px;
    margin: 14px auto 18px;
    position: relative;
    cursor: pointer;
  }
  .sq-gift {
    position: relative;
    width: 160px; height: 160px;
    margin: 30px auto 0;
    transform-style: preserve-3d;
    transition: transform .4s ease;
  }
  .sq-gift-stage:hover:not(.is-open) .sq-gift { transform: scale(1.04); }
  body:not(.is-open) .sq-gift {
    animation: gift-idle 2.6s ease-in-out infinite;
  }
  @keyframes gift-idle {
    0%, 100% { transform: translateY(0)    rotate(-1deg); }
    50%      { transform: translateY(-6px) rotate(1deg); }
  }

  /* Animation Lottie auto-hébergée (V4.7) — affichée si le moteur charge.
     Sinon la boîte CSS ci-dessous reste visible (filet de sécurité). */
  .sq-lottie { display: none; width: 210px; height: 210px; margin: 6px auto 0; }
  .sq-gift-stage.lottie-ready .sq-lottie { display: block; }
  .sq-gift-stage.lottie-ready .sq-gift-fallback { display: none; }
  body:not(.is-open) .sq-gift-stage.lottie-ready .sq-lottie {
    animation: gift-idle 2.8s ease-in-out infinite;
  }

  /* Base de la boîte */
  .sq-gift-base {
    position: absolute;
    inset: 30px 0 0 0;
    background:
      linear-gradient(180deg, ${couleurBoite}, ${couleurBoite}cc 70%, ${couleurBoite}88);
    border-radius: 6px;
    box-shadow:
      0 12px 28px rgba(0,0,0,.55),
      0 0 0 1px rgba(0,0,0,.25) inset,
      0 4px 12px rgba(255,255,255,.08) inset;
  }
  /* Couvercle de la boîte */
  .sq-gift-lid {
    position: absolute;
    top: 0; left: -6px; right: -6px;
    height: 42px;
    background:
      linear-gradient(180deg, ${couleurBoite}ee, ${couleurBoite}aa);
    border-radius: 6px;
    box-shadow:
      0 8px 22px rgba(0,0,0,.5),
      0 0 0 1px rgba(0,0,0,.25) inset,
      0 4px 12px rgba(255,255,255,.1) inset;
    transform-origin: bottom center;
    transition: transform .9s cubic-bezier(.6,-.3,.4,1.45);
    z-index: 3;
  }
  body.is-open .sq-gift-lid {
    transform: translateY(-50px) rotateX(-150deg);
  }
  /* Ruban vertical */
  .sq-gift-ribbon-v {
    position: absolute;
    top: 0; bottom: 0;
    left: 50%; width: 22px; margin-left: -11px;
    background: linear-gradient(180deg, ${couleurRuban}, ${couleurRuban}cc);
    box-shadow: 0 0 12px ${couleurRuban}55;
    z-index: 4;
    transition: opacity .6s ease, transform .6s ease;
  }
  body.is-open .sq-gift-ribbon-v {
    opacity: 0; transform: translateY(8px) scaleY(.8);
  }
  /* Ruban horizontal sur le couvercle */
  .sq-gift-ribbon-h {
    position: absolute;
    top: 39px; left: -6px; right: -6px; height: 16px;
    background: linear-gradient(180deg, ${couleurRuban}, ${couleurRuban}cc);
    box-shadow: 0 0 12px ${couleurRuban}55;
    z-index: 4;
    transition: opacity .6s ease, transform .6s ease;
  }
  body.is-open .sq-gift-ribbon-h {
    opacity: 0; transform: translateY(-6px) scaleX(.85);
  }
  /* Noeud central (cercle sur top de la lid) */
  .sq-gift-knot {
    position: absolute;
    top: 22px; left: 50%; width: 34px; height: 34px;
    margin-left: -17px;
    background: radial-gradient(circle at 35% 30%,
      ${couleurRuban}ff, ${couleurRuban}cc 60%, ${couleurRuban}88);
    border-radius: 50%;
    box-shadow:
      0 4px 12px rgba(0,0,0,.4),
      0 1px 0 rgba(255,255,255,.2) inset;
    z-index: 5;
    transition: opacity .5s ease, transform .5s ease;
  }
  body.is-open .sq-gift-knot {
    opacity: 0; transform: translate(-50%, -28px) scale(.5) rotate(60deg);
    left: 50%; margin-left: 0;
  }
  /* Petite étiquette "Tape pour ouvrir" */
  .sq-gift-hint {
    margin-top: 8px;
    text-align: center;
    font-size: 12px;
    color: ${accent};
    letter-spacing: .04em;
    animation: hint-pulse 2s ease-in-out infinite;
  }
  body.is-open .sq-gift-hint { display: none; }
  @keyframes hint-pulse {
    0%, 100% { opacity: .8; }
    50%      { opacity: 1; }
  }

  /* Paillettes / particules */
  .sq-sparkles {
    position: absolute; inset: 0;
    pointer-events: none;
    z-index: 2;
    opacity: 0;
  }
  body.is-open .sq-sparkles { opacity: 1; }
  .sq-sparkles span {
    position: absolute;
    width: 10px; height: 10px;
    top: 50%; left: 50%;
    border-radius: 50%;
    background: ${accent};
    opacity: 0;
    animation: sparkle-burst 1.2s ease-out forwards;
    animation-play-state: paused;
  }
  body.is-open .sq-sparkles span { animation-play-state: running; }
  @keyframes sparkle-burst {
    0%   { opacity: 1; transform: translate(0,0) scale(.4); }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1.4); }
  }

  /* Reveal block */
  .sq-reveal {
    margin-top: 18px;
    max-width: 380px; margin-left: auto; margin-right: auto;
    padding: 18px 16px 14px;
    background: linear-gradient(135deg,
      rgba(7,9,13,.65), rgba(${parseInt(accent.slice(1,3),16)},${parseInt(accent.slice(3,5),16)},${parseInt(accent.slice(5,7),16)},.08));
    border: 1.5px solid ${accent};
    border-radius: 14px;
    text-align: center;
    box-shadow: 0 8px 24px ${accent}33;
    opacity: 0;
    transform: translateY(8px) scale(.96);
    transition: opacity .5s ease 1s, transform .5s ease 1s;
  }
  body.is-open .sq-reveal {
    opacity: 1; transform: translateY(0) scale(1);
  }
  .sq-reveal-lbl {
    font-size: 11px; letter-spacing: .22em;
    color: ${accent};
    text-transform: uppercase; font-weight: 700;
    margin: 0 0 8px;
  }
  .sq-reveal-value {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 24px; font-weight: 700;
    margin: 0 0 8px;
    color: var(--tx);
  }
  .sq-reveal-code-box {
    margin: 8px 0;
    padding: 12px 14px;
    background: rgba(0,0,0,.35);
    border: 1px dashed ${accent}66;
    border-radius: 10px;
  }
  .sq-reveal-code-lbl {
    font-size: 10px; letter-spacing: .22em;
    color: ${accent}; opacity: .9;
    text-transform: uppercase; font-weight: 700;
    margin: 0 0 4px;
  }
  .sq-reveal-code-val {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 22px; font-weight: 700;
    color: #fff;
    letter-spacing: .05em;
    display: block;
  }
  .sq-reveal-validite {
    margin-top: 8px;
    font-size: 12px;
    color: var(--mut);
    font-style: italic;
  }
  .sq-copy-btn {
    appearance: none; border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.06);
    color: var(--tx); cursor: pointer;
    font-family: inherit; font-weight: 700; letter-spacing: .02em;
    font-size: 13px;
    padding: 11px 18px;
    margin-top: 10px;
    border-radius: 10px;
    transition: transform .14s ease, box-shadow .18s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .sq-copy-btn:active { transform: scale(.96); }
  .sq-copy-btn.is-copied {
    background: linear-gradient(135deg, #4ade80, #22c55e);
    color: #fff;
    box-shadow: 0 8px 20px rgba(74,222,128,.4);
    border-color: transparent;
  }

  /* Slot titre + message du propriétaire — révélé à l'ouverture */
  .sq-ia { margin-top: 18px;
    opacity: 0; transition: opacity .5s ease 2.2s; }
  body.is-open .sq-ia { opacity: 1; }
  .sq-ia-title { font-size: 14px; font-weight: 600;
    color: ${accent}; margin: 0 0 4px; letter-spacing: .02em; }
  .sq-ia-phrase { color: var(--mut); font-size: 13px;
    line-height: 1.5; margin: 0; font-style: italic; }

  /* CTA Continuer */
  .sq-cta-wrap { margin-top: 18px;
    opacity: 0; transition: opacity .5s ease 2.5s;
    pointer-events: none; }
  body.is-open .sq-cta-wrap { opacity: 1; pointer-events: auto; }
  .sq-cta {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 12px 24px; border-radius: 10px;
    background: linear-gradient(135deg, ${accent}, ${accent}cc);
    color: #fff; font-size: 14px; font-weight: 700;
    text-decoration: none; letter-spacing: .02em;
    box-shadow: 0 8px 20px ${accent}55;
  }
  .sq-cta:active { transform: scale(.97); }

  .sq-foot { margin-top: 22px; color: #64748b; font-size: 11px; line-height: 1.5; }
  .sq-foot a { color: var(--mut); text-decoration: none; }

  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="sq-bg" aria-hidden="true"></div>
<div class="sq-card" role="status" aria-live="polite">
  <div class="sq-brand-cap">Keystone Smart QR</div>

  <div class="sq-head">
    ${logoUrl ? `<img class="sq-logo" src="${logoUrl}" alt="${nomMarque}" loading="eager">` : ''}
    ${nomMarque ? `<h1 class="sq-marque">${nomMarque}</h1>` : ''}
  </div>
  ${occasion ? `<p class="sq-occasion">${occasion}</p>` : ''}

  <div class="sq-gift-stage" id="sq-gift-stage" role="button" tabindex="0" aria-label="Ouvrir la boîte cadeau">
    <div class="sq-lottie" id="sq-lottie" aria-hidden="true"></div>
    <div class="sq-gift-fallback" id="sq-gift-fallback">
      <div class="sq-sparkles" id="sq-sparkles" aria-hidden="true"></div>
      <div class="sq-gift">
        <div class="sq-gift-base"></div>
        <div class="sq-gift-lid"></div>
        <div class="sq-gift-ribbon-h"></div>
        <div class="sq-gift-ribbon-v"></div>
        <div class="sq-gift-knot"></div>
      </div>
    </div>
  </div>
  <p class="sq-gift-hint">Tape pour ouvrir ↑</p>

  <div class="sq-reveal" id="sq-reveal" aria-live="polite">
    ${valeurOffre ? `<p class="sq-reveal-lbl">Ton offre</p>
                     <p class="sq-reveal-value">${valeurOffre}</p>` : `<p class="sq-reveal-lbl">Ton cadeau</p>`}
    <div class="sq-reveal-code-box">
      <p class="sq-reveal-code-lbl">Code à utiliser</p>
      <code class="sq-reveal-code-val" id="sq-promo-code">${codePromo}</code>
    </div>
    <button type="button" class="sq-copy-btn" id="sq-copy-btn">📋 Copier le code</button>
    ${validite ? `<p class="sq-reveal-validite">${validite}</p>` : ''}
  </div>

  ${(smartTitle || smartMessage) ? `<div class="sq-ia" id="sq-ia">
    ${smartTitle ? `<p class="sq-ia-title">${smartTitle}</p>` : ''}
    ${smartMessage ? `<p class="sq-ia-phrase">${smartMessage}</p>` : ''}
  </div>` : ''}

  <div class="sq-cta-wrap" id="sq-cta-wrap">
    <a class="sq-cta" href="/r/${safeShort}?direct=1">
      Continuer
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>
  </div>

  ${renderKeystoneFoot()}
</div>

<script src="/sdqr-assets/lottie.min.js"></script>
<script>
(() => {
  const PROMO = ${JSON.stringify(codePromo)};
  const el = id => document.getElementById(id);
  const stage = el('sq-gift-stage');
  const sparkles = el('sq-sparkles');
  const copyBtn = el('sq-copy-btn');
  const mount = el('sq-lottie');

  function vibrate(p) {
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }

  // Lottie auto-hébergé (même origine). Si le moteur a chargé, on bascule
  // sur l'animation vectorielle ; sinon la boîte CSS reste (filet de sécurité).
  let anim = null;
  if (window.lottie && mount) {
    try {
      anim = lottie.loadAnimation({
        container: mount, renderer: 'svg', loop: false, autoplay: false,
        path: '/sdqr-assets/gift-box.json',
        rendererSettings: { progressiveLoad: false },
      });
      anim.addEventListener('DOMLoaded', () => {
        stage.classList.add('lottie-ready');
        try { anim.goToAndStop(0, true); } catch (e) {}
      });
      anim.addEventListener('data_failed', () => { anim = null; });
    } catch (e) { anim = null; }
  }

  // Construit les paillettes : 18 particules avec --dx/--dy aléatoires
  const PARTICLES = 18;
  for (let i = 0; i < PARTICLES; i++) {
    const s = document.createElement('span');
    const angle = (i / PARTICLES) * Math.PI * 2;
    const dist  = 60 + Math.random() * 80;
    const dx    = Math.cos(angle) * dist;
    const dy    = Math.sin(angle) * dist - 30; // bias vers le haut
    s.style.setProperty('--dx', dx + 'px');
    s.style.setProperty('--dy', dy + 'px');
    s.style.animationDelay = (Math.random() * 0.3) + 's';
    s.style.background = i % 3 === 0 ? '#fbbf24'
                      : i % 3 === 1 ? '#f472b6'
                      : '${accent}';
    sparkles.appendChild(s);
  }

  let opened = false;
  function openBox() {
    if (opened) return;
    opened = true;
    vibrate([60, 40, 90]);
    if (anim && stage.classList.contains('lottie-ready')) {
      try { anim.goToAndStop(0, true); anim.play(); } catch (e) {}
    }
    document.body.classList.add('is-open');
  }
  stage.addEventListener('click', openBox);
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBox(); }
  });

  // Copie du code promo
  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('execCommand failed'));
      } catch (e) { reject(e); }
    });
  }
  copyBtn?.addEventListener('click', () => {
    copyToClipboard(PROMO).then(() => {
      copyBtn.classList.add('is-copied');
      copyBtn.textContent = '✓ Code copié';
      vibrate(40);
      setTimeout(() => {
        copyBtn.classList.remove('is-copied');
        copyBtn.textContent = '📋 Copier le code';
      }, 2400);
    }).catch(() => {
      copyBtn.textContent = '⚠ Copie impossible';
      setTimeout(() => copyBtn.textContent = '📋 Copier le code', 2400);
    });
  });
})();
</script>
</body>
</html>`;
  },
};

export default TEMPLATE;
