// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · storytelling-brand (V4.1)
// ───────────────────────────────────────────────────────────────────
// Séquence motion graphics 3 actes qui s'enchaînent automatiquement et
// mettent la marque en scène, avec le titre + message du propriétaire en
// climax final.
//
// Timeline (autonome côté CSS) :
//   T+0      ouverture : logo qui scale-in + glow accent color
//   T+1.6s   slogan reveal (lettre par lettre via CSS animation-delay)
//   T+3.4s   visuel brand crossfade + accent color qui s'étend
//   T+5.2s   reveal du climax (titre + message saisis par le propriétaire)
//
// Le titre et le message sont saisis directement par le propriétaire dans
// le studio (champs smart_title / smart_message), rendus côté serveur.
// Plus aucun appel IA.
//
// Cf. BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md § "1. Storytelling Brand"
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot } from './_shared.js';

const TEMPLATE = {
  id:              'storytelling-brand',
  label:           'Storytelling Brand',
  tier_required:   'pro',

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    return errors;
  },

  renderHTML(qrData, scanCtx) {
    const d         = qrData?.template_data || {};
    const safeShort = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const nom       = escHtml((d.nom_marque || '').toString().slice(0, 60));
    const slogan    = escHtml((d.slogan || '').toString().slice(0, 120));
    const logoUrl   = safeUrl(d.logo_url);
    const visuelUrl = safeUrl(d.visuel_url);
    const accent    = safeColor(d.accent_color, '#7c8af9');
    const style     = ['Élégant', 'Dynamique', 'Minimaliste'].includes(d.style_motion)
      ? d.style_motion : 'Élégant';
    const styleSlug = { 'Élégant': 'elegant', 'Dynamique': 'dynamic', 'Minimaliste': 'minimal' }[style];
    // Climax saisi par le propriétaire (studio) — rendu directement, sans IA.
    const smartTitle   = escHtml((qrData?.smart_title   || '').toString().slice(0, 80));
    const smartMessage = escHtml((qrData?.smart_message || '').toString().slice(0, 400));

    // Slogan reveal lettre par lettre : on découpe et on applique un delay incrémental.
    // Limité à 120 caractères pour éviter une overflow d'éléments DOM.
    const sloganChars = slogan.split('').map((ch, i) => {
      const c = ch === ' ' ? '&nbsp;' : ch;
      return `<span class="sq-ch" style="animation-delay:${(1700 + i * 28)}ms">${c}</span>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nom || 'Keystone'} · Smart QR</title>
<style>
  :root {
    --bg: #07090d; --card: #0d1218; --bd: #1c2632;
    --tx: #f1f5f9; --mut: #94a3b8; --gold: #c9a96e;
    --acc: ${accent};
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--tx);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.02em; min-height: 100vh;
    overflow-x: hidden; overflow-y: hidden; }
  body { display: flex; align-items: center; justify-content: center;
    padding: 20px; min-height: 100vh; position: relative; }

  /* Halo accent color en arrière-plan — pulse lente continue */
  .sq-bg-halo {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(ellipse at center,
      ${accent}44 0%, ${accent}1a 32%, transparent 65%);
    opacity: 0; transform: scale(.6);
    animation: halo-grow 4s 1.6s cubic-bezier(.16,.84,.3,1) forwards,
               halo-pulse 7s 5.6s ease-in-out infinite;
  }
  @keyframes halo-grow {
    from { opacity: 0; transform: scale(.6); }
    to   { opacity: 1; transform: scale(1.1); }
  }
  @keyframes halo-pulse {
    0%, 100% { transform: scale(1.1); opacity: 1; }
    50%      { transform: scale(1.25); opacity: .7; }
  }

  /* Particules flottantes — montent doucement et se renouvellent */
  .sq-particles { position: fixed; inset: 0; pointer-events: none;
    z-index: 0; overflow: hidden; }
  .sq-particle {
    position: absolute; bottom: -20px;
    width: 6px; height: 6px; border-radius: 50%;
    background: radial-gradient(circle, ${accent}cc, ${accent}33);
    opacity: 0;
    animation: particle-up linear infinite;
    will-change: transform, opacity;
  }
  @keyframes particle-up {
    0%   { transform: translateY(0) scale(.4);
           opacity: 0; }
    15%  { opacity: .8; }
    85%  { opacity: .6; }
    100% { transform: translateY(-110vh) scale(1.1);
           opacity: 0; }
  }
  .sq-particle:nth-child(1) { left: 10%;  width: 5px; height: 5px;
    animation-duration: 13s; animation-delay: 0s; }
  .sq-particle:nth-child(2) { left: 22%;  width: 4px; height: 4px;
    animation-duration: 16s; animation-delay: 2s; }
  .sq-particle:nth-child(3) { left: 35%;  width: 7px; height: 7px;
    animation-duration: 11s; animation-delay: 4s; }
  .sq-particle:nth-child(4) { left: 50%;  width: 4px; height: 4px;
    animation-duration: 18s; animation-delay: 1s; }
  .sq-particle:nth-child(5) { left: 64%;  width: 6px; height: 6px;
    animation-duration: 14s; animation-delay: 6s; }
  .sq-particle:nth-child(6) { left: 78%;  width: 5px; height: 5px;
    animation-duration: 12s; animation-delay: 3s; }
  .sq-particle:nth-child(7) { left: 89%;  width: 7px; height: 7px;
    animation-duration: 15s; animation-delay: 5s; }

  .sq-card {
    position: relative; z-index: 1;
    max-width: 480px; width: 100%;
    background: linear-gradient(180deg, #0e141b 0%, var(--card) 100%);
    border: 1px solid var(--bd);
    border-radius: 24px;
    padding: 40px 28px 26px;
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
    margin-bottom: 26px; font-weight: 600; opacity: .85; }

  /* Acte 1 : Logo */
  .sq-logo-wrap {
    height: 96px; display: flex; align-items: center; justify-content: center;
    margin-bottom: 18px;
    animation: logo-in 1100ms cubic-bezier(.16,.84,.3,1);
  }
  @keyframes logo-in {
    0%   { opacity: 0; transform: scale(.72); filter: blur(8px); }
    60%  { opacity: 1; transform: scale(1.06); filter: blur(0); }
    100% { opacity: 1; transform: scale(1); filter: blur(0); }
  }
  .sq-logo-img { max-height: 96px; max-width: 200px;
    filter: drop-shadow(0 4px 16px ${accent}55); }
  .sq-logo-fallback {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 36px; font-weight: 700; letter-spacing: -.02em;
    color: var(--tx);
    background: linear-gradient(135deg, var(--tx), ${accent});
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* Acte 2 : Slogan reveal lettre par lettre */
  .sq-slogan {
    font-size: 15.5px; line-height: 1.55; color: var(--mut);
    margin: 8px auto 24px; max-width: 360px;
    min-height: 24px;
  }
  .sq-ch { display: inline-block; opacity: 0;
    animation: ch-in 380ms cubic-bezier(.16,.84,.3,1) forwards; }
  @keyframes ch-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Acte 3 : Visuel brand crossfade */
  .sq-visuel-wrap {
    margin: 22px -10px 22px;
    height: 168px; border-radius: 12px;
    overflow: hidden;
    background: linear-gradient(135deg, ${accent}22, ${accent}08);
    opacity: 0; transform: scale(.97);
    animation: visuel-in 900ms 3400ms cubic-bezier(.16,.84,.3,1) forwards;
  }
  @keyframes visuel-in {
    from { opacity: 0; transform: scale(.97); }
    to   { opacity: 1; transform: scale(1); }
  }
  .sq-visuel-img {
    width: 100%; height: 100%; object-fit: cover;
    display: block;
  }
  .sq-visuel-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: ${accent}; opacity: .35;
    font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
  }

  /* Slot climax — fade-in après la séquence motion */
  .sq-ia {
    margin-top: 18px;
    opacity: 0;
    animation: ia-in 600ms 5000ms cubic-bezier(.16,.84,.3,1) forwards;
  }
  @keyframes ia-in { from { opacity: 0; } to { opacity: 1; } }

  /* Climax : titre + message reveal */
  .sq-final { display: none; }
  .sq-final.is-shown { display: block;
    animation: final-in 600ms cubic-bezier(.16,.84,.3,1); }
  @keyframes final-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .sq-title {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 30px; font-weight: 700; margin: 4px 0 14px;
    letter-spacing: -.015em; line-height: 1.15;
    background: linear-gradient(135deg, var(--tx), ${accent});
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  #sq-phrase {
    color: var(--mut); font-size: 15.5px; line-height: 1.55;
    margin: 0 0 26px;
  }

  /* CTA Continuer */
  .sq-cta {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 14px 28px; border-radius: 12px; border: 0;
    background: var(--acc); color: #fff;
    font-size: 15px; font-weight: 600;
    text-decoration: none; cursor: pointer;
    box-shadow: 0 8px 24px ${accent}55;
    transition: transform .14s ease, box-shadow .14s ease;
  }
  .sq-cta:hover { transform: translateY(-1px);
    box-shadow: 0 12px 28px ${accent}66; }
  .sq-cta:active { transform: scale(.98); }

  .sq-foot { margin-top: 28px; color: #64748b; font-size: 11px; line-height: 1.5; }
  .sq-foot a { color: var(--mut); text-decoration: none; }

  /* Variations style_motion : différenciation visuelle marquée */
  body.is-dynamic .sq-card { animation-duration: 420ms; }
  body.is-dynamic .sq-logo-wrap { animation-duration: 800ms; }
  body.is-dynamic .sq-bg-halo { animation-duration: 3s, 4s; }
  body.is-dynamic .sq-particle { animation-duration: 8s; }
  body.is-dynamic .sq-title { letter-spacing: -.03em; }

  body.is-minimal .sq-card {
    animation-duration: 750ms;
    border-radius: 14px;
    box-shadow: 0 24px 56px rgba(0,0,0,.45);
  }
  body.is-minimal .sq-logo-wrap { animation-duration: 1400ms; }
  body.is-minimal .sq-particles { display: none; }
  body.is-minimal .sq-bg-halo { opacity: .5 !important; }
  body.is-minimal .sq-title {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-weight: 700; -webkit-text-fill-color: var(--tx);
    background: none;
  }
  body.is-minimal .sq-visuel-wrap { display: none; }

  [hidden] { display: none !important; }
</style>
</head>
<body class="is-${styleSlug}">
<div class="sq-bg-halo" aria-hidden="true"></div>
${styleSlug !== 'minimal' ? `<div class="sq-particles" aria-hidden="true">
  <span class="sq-particle"></span><span class="sq-particle"></span>
  <span class="sq-particle"></span><span class="sq-particle"></span>
  <span class="sq-particle"></span><span class="sq-particle"></span>
  <span class="sq-particle"></span>
</div>` : ''}
<div class="sq-card" role="status" aria-live="polite">
  <div class="sq-brand-cap">Keystone Smart QR</div>

  <div class="sq-logo-wrap">
    ${logoUrl
      ? `<img class="sq-logo-img" src="${logoUrl}" alt="${nom}" loading="eager">`
      : `<div class="sq-logo-fallback">${nom || 'Keystone'}</div>`}
  </div>

  ${slogan ? `<div class="sq-slogan">${sloganChars}</div>` : ''}

  <div class="sq-visuel-wrap">
    ${visuelUrl
      ? `<img class="sq-visuel-img" src="${visuelUrl}" alt="" loading="eager">`
      : `<div class="sq-visuel-placeholder">${nom || 'Storytelling'}</div>`}
  </div>

  <div class="sq-ia" id="sq-ia">
    <div class="sq-final" id="sq-final">
      ${smartTitle ? `<h1 class="sq-title">${smartTitle}</h1>` : ''}
      ${smartMessage ? `<p id="sq-phrase">${smartMessage}</p>` : ''}
      <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
        Continuer
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </a>
    </div>
  </div>

  ${renderKeystoneFoot()}
</div>

<script>
(() => {
  // Reveal du climax après la séquence motion (~5s : logo + slogan + visuel
  // + halo). On laisse le storytelling se dérouler entièrement avant de
  // montrer le titre/message + bouton Continuer. Contenu rendu côté serveur.
  const MIN_REVEAL_MS = 5200;
  setTimeout(() => {
    const final = document.getElementById('sq-final');
    if (final) final.classList.add('is-shown');
  }, MIN_REVEAL_MS);
})();
</script>
</body>
</html>`;
  },
};

export default TEMPLATE;
