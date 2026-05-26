// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · carte-fidelite (V4.4)
// ───────────────────────────────────────────────────────────────────
// Carte de fidélité tactile : chaque scan ajoute un tampon, récompense
// débloquée au Nᵉ. L'état (compteur cumulatif cross-scan, validité,
// reward unique) est tenu AUTHORITATIVE côté serveur via l'endpoint
// /api/smartqr/loyalty-stamp. Identification anonyme par device_hash.
//
// Anti-triche : impossible d'avancer le compteur sans le serveur. Le
// code de récompense est signé crypto (WIN-XXXX-XXXX) et vérifiable
// par le commerçant via /verify-win.html?code=…
//
// UX :
//   T+0      carte avec N emplacements + (N-1) tampons figés (état précédent)
//   T+200ms  appel POST /api/smartqr/loyalty-stamp
//   T+500ms  le Nᵉ tampon s'écrase avec squash & stretch + vibrate
//   T+1.2s   IA arrive : phrase d'encouragement contextualisée
//   reward   si stamps_count = nb_tampons_total → confettis + reveal code
//
// Cf. BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md § "6. Carte de fidélité"
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot, renderAiFetchScript, renderWinPngScript } from './_shared.js';

const TEMPLATE = {
  id:              'carte-fidelite',
  label:           'Carte de fidélité',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    if (!d.nom_recompense || !String(d.nom_recompense).trim()) {
      errors.push('Le nom de la récompense est obligatoire.');
    }
    const n = Number(d.nb_tampons_total);
    if (!Number.isFinite(n) || n < 3 || n > 30) {
      errors.push('Le nombre de tampons doit être entre 3 et 30.');
    }
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const d         = qrData?.template_data || {};
    const nom       = (d.nom_marque || '').toString().slice(0, 60);
    const recompense = (d.nom_recompense || '').toString().slice(0, 80);
    const total     = Math.max(3, Math.min(30, Number(d.nb_tampons_total) || 10));
    const now       = new Date();
    const dayFr     = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    const hourFr    = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS. Le scanneur vient d\'ajouter',
      'un tampon à sa carte de fidélité (programme de retours répétés). Tu écris',
      'UNE phrase courte chaleureuse qui encourage la prochaine visite — sans',
      'connaître l\'avancement exact (phrase générique applicable à tout stade).',
      '',
      'Règles strictes :',
      '- title : 3-5 mots chaleureux (ex: "Tampon ajouté", "À bientôt")',
      '- phrase : 1 seule phrase max 18 mots, ton fidèle et accueillant',
      '- Si le brief métier parle d\'un produit (café, croissant, etc.), tu peux y',
      '  faire une allusion gourmande/positive sans rien promettre',
      '- Pas de CTA, pas d\'horaires inventés, pas de chiffres précis',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
    ].join('\n');

    const user = [
      `Marque : ${nom || '(sans nom)'}`,
      `Récompense visée : ${recompense}`,
      `Objectif : ${total} tampons à collecter`,
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
    const d           = qrData?.template_data || {};
    const safeShort   = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const nomMarque   = escHtml((d.nom_marque || '').toString().slice(0, 60));
    const nomRecompense = escHtml((d.nom_recompense || 'Récompense').toString().slice(0, 80));
    const logoUrl     = safeUrl(d.logo_url);
    const accent      = safeColor(d.accent_color, '#c9a96e');
    const stampsTotalRaw = Number(d.nb_tampons_total);
    const stampsTotal = Number.isFinite(stampsTotalRaw) && stampsTotalRaw >= 3 && stampsTotalRaw <= 30
                      ? Math.floor(stampsTotalRaw) : 10;
    const styleTampon = ['encre', 'etoile', 'coeur', 'logo'].includes(d.style_tampon)
                      ? d.style_tampon : 'encre';

    // Glyph de tampon selon le style choisi. "logo" utilise logo_url
    // si dispo (sinon fallback étoile).
    let stampGlyph = '';
    if (styleTampon === 'etoile') stampGlyph = '★';
    else if (styleTampon === 'coeur') stampGlyph = '♥';
    else if (styleTampon === 'logo' && logoUrl) stampGlyph = `<img src="${logoUrl}" alt="" class="sq-stamp-logo">`;
    else if (styleTampon === 'logo') stampGlyph = '★'; // fallback
    else stampGlyph = '✓'; // encre

    // Grid responsive : si total ≤ 10 → 5 col, sinon → 6 col
    const gridCols = stampsTotal <= 10 ? 5 : 6;

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nomMarque || 'Carte de fidélité'} · Smart QR</title>
<style>
  :root {
    --bg: #07090d; --card: #0d1218; --bd: #1c2632;
    --tx: #f1f5f9; --mut: #94a3b8; --gold: #c9a96e;
    --acc: ${accent};
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
  body.is-reward .sq-bg { background: radial-gradient(ellipse at center,
    ${accent}66 0%, ${accent}22 35%, transparent 75%); }
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
  .sq-subtitle {
    color: var(--mut); font-size: 12.5px;
    margin: 4px 0 18px;
    letter-spacing: .04em;
  }

  /* Carte de fidélité = grid de cases tampons */
  .sq-loyalty-card {
    position: relative;
    background: linear-gradient(135deg, #0a0d12 0%, #161e29 50%, #0a0d12 100%);
    border: 1.5px solid ${accent}55;
    border-radius: 14px;
    padding: 18px 14px;
    margin: 0 auto 16px;
    max-width: 380px;
    box-shadow:
      0 8px 24px rgba(0,0,0,.4),
      0 0 0 1px ${accent}11 inset;
  }
  body.is-reward .sq-loyalty-card {
    border-color: ${accent};
    box-shadow:
      0 8px 32px ${accent}55,
      0 0 0 2px ${accent}33 inset;
  }
  .sq-loyalty-grid {
    display: grid;
    grid-template-columns: repeat(${gridCols}, 1fr);
    gap: 8px;
  }
  .sq-stamp-cell {
    aspect-ratio: 1;
    border-radius: 50%;
    background: rgba(255,255,255,.04);
    border: 1.5px dashed ${accent}44;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,.18);
    font-size: 18px;
    transition: all .3s ease;
    position: relative;
  }
  .sq-stamp-cell.is-stamped {
    background: radial-gradient(circle at 35% 30%, ${accent}cc, ${accent}88 60%, ${accent}55);
    border: 1.5px solid ${accent};
    color: #fff;
    font-weight: 700;
    text-shadow: 0 1px 2px rgba(0,0,0,.35);
    box-shadow:
      0 4px 10px ${accent}66,
      0 1px 0 0 rgba(255,255,255,.18) inset;
  }
  .sq-stamp-cell.is-stamped.is-new {
    animation: stamp-pop 700ms cubic-bezier(.18,.89,.32,1.28);
  }
  @keyframes stamp-pop {
    0%   { transform: scale(0) rotate(-25deg); opacity: 0; }
    35%  { transform: scale(1.45) rotate(8deg); opacity: 1; }
    55%  { transform: scale(.88) rotate(-3deg); }
    75%  { transform: scale(1.06) rotate(2deg); }
    100% { transform: scale(1)    rotate(0); }
  }
  .sq-stamp-logo { max-width: 60%; max-height: 60%;
    object-fit: contain; filter: brightness(0) invert(1); }

  .sq-loyalty-counter {
    margin-top: 12px;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 13px;
    letter-spacing: .12em;
    color: ${accent};
    font-weight: 700;
  }
  .sq-loyalty-progress {
    margin-top: 6px;
    height: 4px;
    background: rgba(255,255,255,.06);
    border-radius: 2px;
    overflow: hidden;
  }
  .sq-loyalty-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, ${accent}, ${accent}cc);
    border-radius: 2px;
    width: 0%;
    transition: width 800ms cubic-bezier(.18,.89,.32,1.28);
  }

  .sq-cycle-note {
    margin-top: 8px;
    font-size: 11px;
    color: var(--mut);
    font-style: italic;
    opacity: 0;
    transition: opacity .3s;
  }
  .sq-cycle-note.is-shown { opacity: 1; }

  /* Bloc de récompense (caché par défaut, révélé si reward_unlocked) */
  .sq-reward-block {
    display: none;
    margin: 18px auto 0;
    max-width: 380px;
    padding: 18px 16px 14px;
    background: linear-gradient(135deg,
      rgba(7,9,13,.65), rgba(${parseInt(accent.slice(1,3),16)},${parseInt(accent.slice(3,5),16)},${parseInt(accent.slice(5,7),16)},.08));
    border: 1.5px solid ${accent};
    border-radius: 14px;
    text-align: center;
    box-shadow: 0 8px 24px ${accent}33;
  }
  body.is-reward .sq-reward-block { display: block;
    animation: reward-in 800ms cubic-bezier(.18,.89,.32,1.28) 200ms backwards; }
  @keyframes reward-in {
    from { opacity: 0; transform: translateY(14px) scale(.95); }
    to   { opacity: 1; transform: translateY(0)    scale(1); }
  }
  .sq-reward-lbl {
    font-size: 11px; letter-spacing: .22em;
    color: ${accent};
    text-transform: uppercase; font-weight: 700;
    margin: 0 0 8px;
  }
  .sq-reward-name {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 26px; font-weight: 700;
    margin: 0 0 10px;
    background: linear-gradient(135deg, var(--tx), ${accent}, var(--tx));
    background-size: 200% 100%;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: reward-shine 4s ease-in-out infinite;
  }
  @keyframes reward-shine {
    0%, 100% { background-position: 0% 50%; }
    50%      { background-position: 100% 50%; }
  }
  .sq-reward-code-box {
    margin: 10px 0;
    padding: 12px 14px;
    background: rgba(0,0,0,.35);
    border: 1px dashed ${accent}66;
    border-radius: 10px;
  }
  .sq-reward-code-lbl {
    font-size: 10px; letter-spacing: .22em;
    color: ${accent}; opacity: .9;
    text-transform: uppercase; font-weight: 700;
    margin: 0 0 4px;
  }
  .sq-reward-code-val {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 22px; font-weight: 700;
    color: #fff;
    letter-spacing: .05em;
    display: block;
  }
  .sq-reward-actions {
    display: flex; flex-direction: column; gap: 8px;
    margin-top: 10px;
  }
  .sq-copy-btn, .sq-download-btn {
    appearance: none; border: 0; cursor: pointer;
    font-family: inherit; font-weight: 700; letter-spacing: .02em;
    padding: 12px 18px;
    border-radius: 10px;
    transition: transform .14s ease, box-shadow .18s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .sq-copy-btn {
    background: rgba(255,255,255,.06);
    color: var(--tx);
    font-size: 13px;
    border: 1px solid rgba(255,255,255,.12);
  }
  .sq-copy-btn:active { transform: scale(.96); }
  .sq-copy-btn.is-copied {
    background: linear-gradient(135deg, #4ade80, #22c55e);
    color: #fff;
    box-shadow: 0 8px 20px rgba(74,222,128,.4);
    border-color: transparent;
  }
  .sq-download-btn {
    background: linear-gradient(135deg, ${accent}, ${accent}cc);
    color: #fff; font-size: 14px;
    box-shadow: 0 8px 20px ${accent}55;
  }
  .sq-download-btn:active { transform: scale(.96); }

  /* Confettis (visible uniquement si reward débloqué) */
  .sq-confetti {
    position: fixed; inset: 0; pointer-events: none;
    overflow: hidden; opacity: 0; transition: opacity .3s ease;
    z-index: 5;
  }
  body.is-reward .sq-confetti { opacity: 1; }
  .sq-confetti i {
    position: absolute; top: -20px;
    width: 8px; height: 12px; opacity: 0;
    animation: confetti-fall 4s ease-in infinite;
  }
  body:not(.is-reward) .sq-confetti i { animation-play-state: paused; }
  @keyframes confetti-fall {
    0%   { transform: translateY(0)    rotate(0deg);   opacity: 0; }
    10%  { opacity: 1; }
    100% { transform: translateY(120vh) rotate(720deg); opacity: 0; }
  }
  .sq-confetti i:nth-child(1) { left: 8%;  background: #c9a96e;
    animation-duration: 4.2s; animation-delay: .1s; }
  .sq-confetti i:nth-child(2) { left: 22%; background: ${accent};
    animation-duration: 5.1s; animation-delay: .8s; width: 6px; }
  .sq-confetti i:nth-child(3) { left: 38%; background: #fbbf24;
    animation-duration: 3.6s; animation-delay: .3s; height: 10px; }
  .sq-confetti i:nth-child(4) { left: 50%; background: #4ade80;
    animation-duration: 4.8s; animation-delay: 1.2s; }
  .sq-confetti i:nth-child(5) { left: 62%; background: ${accent};
    animation-duration: 4.4s; animation-delay: .6s; width: 10px; }
  .sq-confetti i:nth-child(6) { left: 76%; background: #c9a96e;
    animation-duration: 3.9s; animation-delay: 1.4s; }
  .sq-confetti i:nth-child(7) { left: 88%; background: #f472b6;
    animation-duration: 5.3s; animation-delay: .9s; height: 14px; }

  /* Slot IA — visible cette fois (phrase d'encouragement utile) */
  .sq-ia { margin-top: 18px; min-height: 50px;
    opacity: 0; animation: ia-in 600ms 1200ms ease-out forwards; }
  @keyframes ia-in { from { opacity: 0; } to { opacity: 1; } }
  .sq-ia-title { font-size: 14px; font-weight: 600;
    color: ${accent}; margin: 0 0 4px; letter-spacing: .02em; }
  .sq-ia-phrase { color: var(--mut); font-size: 13px;
    line-height: 1.5; margin: 0; font-style: italic; }
  .sq-ia-skeleton {
    height: 12px; width: 70%; margin: 4px auto;
    border-radius: 4px;
    background: linear-gradient(90deg,
      ${accent}1a 0%, ${accent}33 50%, ${accent}1a 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s linear infinite;
  }
  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* CTA Continuer */
  .sq-cta-wrap { margin-top: 18px;
    opacity: 0; transition: opacity .42s ease;
    pointer-events: none; }
  .sq-cta-wrap.is-shown { opacity: 1; pointer-events: auto; }
  .sq-cta {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 11px 22px; border-radius: 10px;
    background: transparent; color: var(--mut);
    font-size: 13px; font-weight: 500;
    text-decoration: underline; text-decoration-color: rgba(148,163,184,.32);
    text-underline-offset: 3px;
    cursor: pointer;
    transition: color .14s ease, text-decoration-color .14s ease;
  }
  .sq-cta:hover { color: ${accent}; text-decoration-color: ${accent}88; }
  body.is-reward .sq-cta {
    border: 1px solid ${accent}55; text-decoration: none;
    color: ${accent}; padding: 12px 24px; font-size: 13.5px;
    font-weight: 600;
  }
  body.is-reward .sq-cta:hover { background: ${accent}11; transform: translateY(-1px); }

  .sq-foot { margin-top: 22px; color: #64748b; font-size: 11px; line-height: 1.5; }
  .sq-foot a { color: var(--mut); text-decoration: none; }

  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="sq-bg" aria-hidden="true"></div>
<div class="sq-confetti" aria-hidden="true">
  <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
</div>
<div class="sq-card" role="status" aria-live="polite">
  <div class="sq-brand-cap">Keystone Smart QR</div>

  <div class="sq-head">
    ${logoUrl ? `<img class="sq-logo" src="${logoUrl}" alt="${nomMarque}" loading="eager">` : ''}
    ${nomMarque ? `<h1 class="sq-marque">${nomMarque}</h1>` : ''}
  </div>
  <p class="sq-subtitle">Carte de fidélité · ${nomRecompense} au ${stampsTotal}ᵉ tampon</p>

  <div class="sq-loyalty-card">
    <div class="sq-loyalty-grid" id="sq-grid"></div>
    <div class="sq-loyalty-counter" id="sq-counter">0 / ${stampsTotal}</div>
    <div class="sq-loyalty-progress">
      <div class="sq-loyalty-progress-fill" id="sq-progress"></div>
    </div>
    <p class="sq-cycle-note" id="sq-cycle-note" aria-live="polite"></p>
  </div>

  <div class="sq-reward-block">
    <p class="sq-reward-lbl">🎁 Récompense débloquée</p>
    <h2 class="sq-reward-name">${nomRecompense}</h2>
    <div class="sq-reward-code-box">
      <p class="sq-reward-code-lbl">Code à présenter en caisse</p>
      <code class="sq-reward-code-val" id="sq-reward-code">—</code>
    </div>
    <div class="sq-reward-actions">
      <button type="button" class="sq-download-btn" id="sq-download-btn">🎫 Télécharger mon bon (.png)</button>
      <button type="button" class="sq-copy-btn" id="sq-copy-btn">📋 Copier le code</button>
    </div>
  </div>

  <div class="sq-ia" id="sq-ia">
    <div id="sq-ia-loading">
      <div class="sq-ia-skeleton"></div>
    </div>
    <div id="sq-ia-ready" hidden>
      <p class="sq-ia-title" id="sq-ia-title"></p>
      <p class="sq-ia-phrase" id="sq-ia-phrase"></p>
    </div>
  </div>

  <div class="sq-cta-wrap" id="sq-cta-wrap">
    <a class="sq-cta" href="/r/${safeShort}?direct=1">
      Continuer
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>
  </div>

  ${renderKeystoneFoot()}
</div>

<script>
(() => {
  const SHORT         = ${JSON.stringify(safeShort)};
  const STAMPS_TOTAL  = ${stampsTotal};
  const STAMP_GLYPH   = ${JSON.stringify(stampGlyph)};

  const el = id => document.getElementById(id);
  const grid       = el('sq-grid');
  const counter    = el('sq-counter');
  const progress   = el('sq-progress');
  const cycleNote  = el('sq-cycle-note');
  const rewardCode = el('sq-reward-code');
  const copyBtn    = el('sq-copy-btn');
  const downloadBtn= el('sq-download-btn');
  const ctaWrap    = el('sq-cta-wrap');

  let currentRewardCode = '';
  let currentRewardName = ${JSON.stringify(nomRecompense)};

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  // Build grid : N emplacements vides
  function buildEmptyGrid() {
    let html = '';
    for (let i = 0; i < STAMPS_TOTAL; i++) {
      html += '<div class="sq-stamp-cell" data-idx="' + i + '"></div>';
    }
    grid.innerHTML = html;
  }

  // Remplit les N premiers emplacements (sans anim), en marquant le
  // dernier comme "is-new" si on vient de l'ajouter (animation pop).
  function renderStamps(count, animateLast) {
    const cells = grid.querySelectorAll('.sq-stamp-cell');
    for (let i = 0; i < cells.length; i++) {
      cells[i].classList.remove('is-stamped', 'is-new');
      cells[i].innerHTML = '';
      if (i < count) {
        cells[i].classList.add('is-stamped');
        cells[i].innerHTML = STAMP_GLYPH;
        if (animateLast && i === count - 1) {
          // Force reflow puis ajoute la classe pour relancer l'anim
          void cells[i].offsetWidth;
          cells[i].classList.add('is-new');
        }
      }
    }
    counter.textContent = count + ' / ' + STAMPS_TOTAL;
    progress.style.width = Math.min(100, (count / STAMPS_TOTAL) * 100) + '%';
  }

  // Copie le code récompense
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
    if (!currentRewardCode) return;
    copyToClipboard(currentRewardCode).then(() => {
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
  // Bouton Télécharger PNG (utilise window.downloadWinPng du _shared)
  downloadBtn?.addEventListener('click', () => {
    if (!currentRewardCode || typeof window.downloadWinPng !== 'function') return;
    downloadBtn.disabled = true;
    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = '⏳ Génération…';
    window.downloadWinPng(currentRewardCode, currentRewardName).then(() => {
      downloadBtn.textContent = '✓ Bon téléchargé';
      vibrate(60);
      setTimeout(() => {
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = false;
      }, 2400);
    }).catch(() => {
      downloadBtn.textContent = '⚠ Erreur génération';
      setTimeout(() => {
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = false;
      }, 2400);
    });
  });

  // Initialisation : grid vide puis fetch + render
  buildEmptyGrid();

  (async () => {
    let data = null;
    try {
      const r = await fetch('/api/smartqr/loyalty-stamp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_id: SHORT }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
    } catch (e) {
      // Fail-safe : affiche 0 tampon, message d'erreur discret
      console.warn('[loyalty]', e);
      data = { stamps_count: 0, stamps_total: STAMPS_TOTAL, stamps_added: 0,
               reward_unlocked: false, reward_code: '', cycle_reset: false };
    }

    const count = Math.min(STAMPS_TOTAL, Number(data.stamps_count) || 0);
    const animateLast = Number(data.stamps_added) === 1;

    if (animateLast) {
      // Affiche d'abord N-1 tampons figés, puis ajoute le Nᵉ avec anim
      setTimeout(() => {
        renderStamps(count, true);
        vibrate([80, 40, 60]);
      }, 280);
    } else {
      // Pas d'anim (anti-spam ou déjà débloqué)
      setTimeout(() => renderStamps(count, false), 200);
    }

    if (data.cycle_reset) {
      cycleNote.textContent = 'Nouveau cycle démarré (la précédente carte avait expiré).';
      cycleNote.classList.add('is-shown');
    }

    if (data.reward_unlocked && data.reward_code) {
      currentRewardCode = String(data.reward_code);
      if (data.reward_name) currentRewardName = String(data.reward_name);
      rewardCode.textContent = currentRewardCode;
      // Reveal du bloc reward après l'anim du dernier tampon
      setTimeout(() => {
        document.body.classList.add('is-reward');
        vibrate([100, 60, 100, 60, 160]);
      }, animateLast ? 900 : 400);
    }

    // CTA visible après ≈ animation
    setTimeout(() => ctaWrap.classList.add('is-shown'), 1400);
  })();

  // Slot IA : hook l'event renderAiFetchScript pour révéler le texte
  document.addEventListener('sq:ai-ready', (e) => {
    const t = el('sq-ia-title'), p = el('sq-ia-phrase');
    const loading = el('sq-ia-loading'), ready = el('sq-ia-ready');
    if (t) t.textContent = e.detail.title || '';
    if (p) p.textContent = e.detail.phrase || '';
    if (loading) loading.hidden = true;
    if (ready) ready.hidden = false;
  });
  document.addEventListener('sq:ai-error', () => {
    const loading = el('sq-ia-loading');
    if (loading) loading.hidden = true;
  });
})();
</script>
${renderAiFetchScript(safeShort)}
${renderWinPngScript(nomMarque, logoUrl, accent)}
</body>
</html>`;
  },
};

export default TEMPLATE;
