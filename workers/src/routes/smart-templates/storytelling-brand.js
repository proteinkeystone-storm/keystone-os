// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · storytelling-brand (V4.1)
// ───────────────────────────────────────────────────────────────────
// Séquence motion graphics 3 actes qui s'enchaînent automatiquement et
// mettent la marque en scène, avec la phrase IA en climax final.
//
// Timeline (autonome côté CSS — l'IA charge en parallèle) :
//   T+0      ouverture : logo qui scale-in + glow accent color
//   T+1.6s   slogan reveal (lettre par lettre via CSS animation-delay)
//   T+3.4s   visuel brand crossfade + accent color qui s'étend
//   T+5.0s   skeleton IA visible (shimmer)
//   T+ai     reveal phrase IA (déclenché par event sq:ai-ready)
//
// L'IA arrive généralement entre 5-15s. Si elle arrive avant T+5s
// la révélation est mise en attente jusqu'à la fin de la séquence.
// Si elle plante, fallback IA s'affiche après la séquence.
//
// Cf. BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md § "1. Storytelling Brand"
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot, renderAiFetchScript } from './_shared.js';

const TEMPLATE = {
  id:              'storytelling-brand',
  label:           'Storytelling Brand',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const d        = qrData?.template_data || {};
    const nom      = (d.nom_marque || '').toString().slice(0, 60);
    const slogan   = (d.slogan || '').toString().slice(0, 120);
    const style    = (d.style_motion || 'Élégant').toString();
    const now      = new Date();
    const dayFr    = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    const hourFr   = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS. Le scanneur vient de voir une séquence de storytelling brand',
      'présentant une marque. Tu écris LE climax final : une phrase courte qui clôt la séquence avec émotion.',
      '',
      'Règles strictes :',
      '- title : 3-5 mots, accroche émotionnelle (ex: "Bienvenue dans l\'univers", "À nous deux")',
      '- phrase : 1 seule phrase, max 18 mots, contextuelle (heure, jour, pays, brief métier)',
      '- Ton aligné sur le style de motion : Élégant=raffiné, Dynamique=énergique, Minimaliste=sobre',
      '- Pas de CTA, pas d\'horaires inventés, jamais commercial agressif',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
    ].join('\n');

    const user = [
      `Marque : ${nom || '(sans nom)'}`,
      slogan ? `Slogan affiché : ${slogan}` : null,
      `Style de motion : ${style}`,
      qrData?.metier_brief ? `Brief métier : ${qrData.metier_brief.slice(0, 600)}` : null,
      '',
      'Contexte du scan :',
      `- Jour : ${dayFr}`,
      `- Heure (Paris) : ${hourFr}h`,
      `- Pays : ${scanCtx?.country || '?'}`,
      `- Device : ${scanCtx?.device || '?'}`,
      '',
      'Génère le JSON {"phrase","title"} maintenant.',
    ].filter(Boolean).join('\n');

    return { system, user };
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
    overflow-x: hidden; }
  body { display: flex; align-items: center; justify-content: center;
    padding: 20px; min-height: 100vh; }

  /* Halo accent color en arrière-plan, s'étend doucement */
  .sq-bg-halo {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(ellipse at center,
      ${accent}33 0%, ${accent}11 30%, transparent 65%);
    opacity: 0; transform: scale(.7);
    animation: halo-grow 4s 2.4s cubic-bezier(.16,.84,.3,1) forwards;
  }
  @keyframes halo-grow {
    from { opacity: 0; transform: scale(.7); }
    to   { opacity: 1; transform: scale(1.1); }
  }

  .sq-card {
    position: relative; z-index: 1;
    max-width: 480px; width: 100%;
    background: var(--card);
    border: 1px solid var(--bd);
    border-radius: 20px;
    padding: 40px 28px 26px;
    text-align: center;
    box-shadow: 0 32px 72px rgba(0,0,0,.55);
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

  /* Slot IA — skeleton puis reveal */
  .sq-ia {
    margin-top: 18px;
    opacity: 0;
    animation: ia-in 600ms 5000ms cubic-bezier(.16,.84,.3,1) forwards;
  }
  @keyframes ia-in { from { opacity: 0; } to { opacity: 1; } }

  .sq-skeleton-title {
    height: 22px; width: 55%; margin: 4px auto 12px;
    border-radius: 6px;
    background: linear-gradient(90deg,
      ${accent}1a 0%, ${accent}40 50%, ${accent}1a 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s linear infinite;
  }
  .sq-skeleton-line {
    height: 13px; margin: 7px auto;
    border-radius: 4px;
    background: linear-gradient(90deg,
      rgba(148,163,184,.10) 0%, rgba(148,163,184,.26) 50%, rgba(148,163,184,.10) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s linear infinite;
  }
  .sq-skeleton-line.w85 { width: 85%; }
  .sq-skeleton-line.w65 { width: 65%; }
  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .sq-hint { margin-top: 16px; font-size: 12px; color: var(--mut);
    opacity: .65; letter-spacing: 0; font-style: italic; }
  .sq-hint::before { content: "✦"; color: var(--gold); margin-right: 6px;
    opacity: .85; font-style: normal; display: inline-block;
    animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }

  /* Climax : phrase IA reveal */
  .sq-final { display: none; }
  .sq-final.is-shown { display: block;
    animation: final-in 600ms cubic-bezier(.16,.84,.3,1); }
  @keyframes final-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .sq-title {
    font-size: 24px; font-weight: 700; margin: 4px 0 12px;
    letter-spacing: -.025em; line-height: 1.18;
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

  /* Variations style_motion : tweaks subtils sur les timings */
  body.is-dynamic .sq-card { animation-duration: 420ms; }
  body.is-dynamic .sq-logo-wrap { animation-duration: 800ms; }
  body.is-minimal .sq-card { animation-duration: 750ms; }
  body.is-minimal .sq-logo-wrap { animation-duration: 1400ms; }

  [hidden] { display: none !important; }
</style>
</head>
<body class="is-${styleSlug}">
<div class="sq-bg-halo" aria-hidden="true"></div>
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
    <div id="sq-loading">
      <div class="sq-skeleton-title" aria-hidden="true"></div>
      <div class="sq-skeleton-line w85" aria-hidden="true"></div>
      <div class="sq-skeleton-line w65" aria-hidden="true"></div>
      <p class="sq-hint">L'IA prépare votre accueil…</p>
    </div>
    <div class="sq-final" id="sq-final">
      <h1 class="sq-title" id="sq-title"></h1>
      <p id="sq-phrase"></p>
      <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
        Continuer
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </a>
    </div>
  </div>

  ${renderKeystoneFoot()}
</div>

${renderAiFetchScript(safeShort)}
<script>
(() => {
  // Reveal IA = max(fin-séquence-motion, réponse-IA). La séquence dure
  // ~5s (logo + slogan + visuel + halo) ; on ne révèle pas avant pour
  // laisser le storytelling se dérouler entièrement.
  const MIN_REVEAL_MS = 5200;
  const t0 = Date.now();

  function reveal(detail) {
    const elapsed = Date.now() - t0;
    const wait    = Math.max(0, MIN_REVEAL_MS - elapsed);
    setTimeout(() => {
      const loading = document.getElementById('sq-loading');
      const final   = document.getElementById('sq-final');
      const title   = document.getElementById('sq-title');
      const phrase  = document.getElementById('sq-phrase');
      if (title)  title.textContent  = detail.title  || 'Bienvenue';
      if (phrase) phrase.textContent = detail.phrase || '';
      if (loading) loading.hidden = true;
      if (final)   final.classList.add('is-shown');
    }, wait);
  }

  document.addEventListener('sq:ai-ready', (e) => reveal(e.detail));
  document.addEventListener('sq:ai-error', (e) => reveal(e.detail));
})();
</script>
</body>
</html>`;
  },
};

export default TEMPLATE;
