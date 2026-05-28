// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · carte-a-gratter (V4.3)
// ───────────────────────────────────────────────────────────────────
// Carte à gratter tactile. Le résultat est figé côté serveur (même
// endpoint que machine-a-sous : /api/smartqr/game-play) AVANT que
// l'utilisateur commence à gratter — on appelle le serveur dès l'arrivée
// sur la page. Le grattage est purement esthétique : à 60% gratté, on
// dévoile le message (gain ou perte) que le serveur a déjà décidé.
//
// Anti-triche : impossible de "tester" plusieurs résultats — c'est figé
// au premier load par device_hash, et si un_jeu_par_appareil = true,
// rejouer renvoie le même résultat.
//
// UX :
//   T+0     carte obfusquée pleine (couleur métal selon texture)
//   touch   trace de transparence au doigt (canvas destination-out)
//   60%     reveal automatique du dessous (gain/perte)
//   reveal  pétards si gagné + vibration + IA en bas
//
// Cf. BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md § "3. Carte à gratter"
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot, renderAiFetchScript, renderWinPngScript } from './_shared.js';

const TEMPLATE = {
  id:              'carte-a-gratter',
  label:           'Carte à gratter',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    const lots = Array.isArray(d.lots) ? d.lots.filter(l => l && String(l.label || '').trim()) : [];
    // Multi-lots (V4.7) ou message_gain unique (legacy) : au moins l'un des deux.
    if (lots.length === 0 && (!d.message_gain || !String(d.message_gain).trim())) {
      errors.push('Ajoute au moins un lot à gagner.');
    }
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const d        = qrData?.template_data || {};
    const nom      = (d.nom_marque || '').toString().slice(0, 60);
    const messageG = (d.message_gain || '').toString().slice(0, 200);
    const now      = new Date();
    const dayFr    = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    const hourFr   = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS. Le scanneur vient de gratter',
      'une carte à gratter marketing. Tu écris UNE phrase courte chaleureuse qui',
      'accompagne le résultat (générique car tu ne sais pas si gagné ou perdu).',
      '',
      'Règles strictes :',
      '- title : 3-5 mots chaleureux (ex: "Carte révélée", "À toi de voir")',
      '- phrase : 1 seule phrase max 18 mots, ton intime et tactile',
      '- Pas de CTA, pas d\'horaires inventés',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
    ].join('\n');

    const user = [
      `Marque : ${nom || '(sans nom)'}`,
      `Message gain configuré : ${messageG}`,
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
    const nomMarque = escHtml((d.nom_marque || '').toString().slice(0, 60));
    const logoUrl   = safeUrl(d.logo_url);
    const imgFond   = safeUrl(d.image_fond);
    const accent    = safeColor(d.accent_color, '#c9a96e');
    const texture   = ['Argent', 'Or', 'Cuivre'].includes(d.texture_grattage)
                      ? d.texture_grattage : 'Or';
    const texMap = {
      'Argent': { c1: '#cbd5e1', c2: '#94a3b8', c3: '#64748b', label: '#1e293b' },
      'Or':     { c1: '#fde68a', c2: '#c9a96e', c3: '#92400e', label: '#3a2206' },
      'Cuivre': { c1: '#fdba74', c2: '#c2410c', c3: '#7c2d12', label: '#3b1004' },
    };
    const tx = texMap[texture];
    // V4.6 — Fond de la zone révélée : image du client (sous le grattage)
    // + voile sombre pour garder le message Gagné/Perdu lisible quelle que
    // soit l'image. Sans image → dégradé sombre historique (rétrocompat
    // des cartes déjà créées en prod). imgFond passe par safeUrl() : data
    // URI base64 ou URL http(s) sans quote, donc sûr dans url('…').
    const revealBg = imgFond
      ? `linear-gradient(rgba(7,9,13,.66), rgba(7,9,13,.74)), url('${imgFond}') center / cover no-repeat`
      : `linear-gradient(135deg, #0e141b, #1a2331)`;

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nomMarque || 'Carte à gratter'} · Smart QR</title>
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
    user-select: none; -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior: contain;
    touch-action: pan-y; }
  body { display: flex; align-items: center; justify-content: center;
    padding: 20px; min-height: 100vh; position: relative; }

  .sq-bg {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(ellipse at center,
      ${accent}33 0%, ${accent}11 35%, transparent 70%);
  }
  body.is-win .sq-bg { background: radial-gradient(ellipse at center,
    ${accent}66 0%, ${accent}22 35%, transparent 75%); }

  .sq-card {
    position: relative; z-index: 1;
    max-width: 460px; width: 100%;
    background: linear-gradient(180deg, #0e141b 0%, var(--card) 100%);
    border: 1px solid var(--bd);
    border-radius: 24px;
    padding: 28px 22px 24px;
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

  .sq-head { margin-bottom: 18px; }
  .sq-logo { max-height: 48px; max-width: 140px;
    margin: 0 auto 8px; display: block;
    filter: drop-shadow(0 4px 12px ${accent}55); }
  .sq-marque {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 22px; font-weight: 700;
    letter-spacing: -.02em; margin: 0;
    color: ${accent};
  }

  /* Zone de grattage : 1 div parent en relatif, canvas par-dessus */
  .sq-scratch-wrap {
    position: relative;
    max-width: 320px; width: 100%; height: 220px;
    margin: 16px auto 20px;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 12px 28px rgba(0,0,0,.4),
                0 0 0 3px ${accent}55 inset;
    background: #0a0d12;
  }
  .sq-scratch-reveal {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 18px 22px;
    text-align: center;
    background: ${revealBg};
  }
  .sq-scratch-reveal-icon {
    font-size: 38px; margin-bottom: 6px;
  }
  .sq-scratch-reveal-title {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 26px; font-weight: 700;
    letter-spacing: -.015em; line-height: 1.1;
    margin: 0 0 8px;
    color: var(--tx);
  }
  body.is-win .sq-scratch-reveal-title {
    background: linear-gradient(135deg, var(--tx), ${accent}, var(--tx));
    background-size: 200% 100%;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: result-shine 4s ease-in-out infinite;
  }
  @keyframes result-shine {
    0%, 100% { background-position: 0% 50%; }
    50%      { background-position: 100% 50%; }
  }
  .sq-scratch-reveal-msg {
    font-size: 13px; line-height: 1.5;
    color: var(--mut); margin: 0;
  }
  /* V4.6 — Lisibilité texte sur image de fond : ombre portée + message plus
     clair, appliqués seulement quand une image est présente (.has-bg). */
  .sq-scratch-reveal.has-bg .sq-scratch-reveal-title { text-shadow: 0 2px 10px rgba(0,0,0,.9); }
  .sq-scratch-reveal.has-bg .sq-scratch-reveal-msg {
    color: #eef2f8; text-shadow: 0 1px 8px rgba(0,0,0,.95);
  }
  .sq-scratch-canvas {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    cursor: pointer;
    transition: opacity .42s ease;
    touch-action: none;
  }
  .sq-scratch-canvas.is-revealed {
    opacity: 0; pointer-events: none;
  }
  .sq-scratch-hint {
    position: absolute; bottom: 8px; left: 0; right: 0;
    text-align: center;
    font-size: 11px; color: ${tx.label};
    letter-spacing: .12em; text-transform: uppercase;
    font-weight: 700;
    opacity: .7;
    pointer-events: none;
    z-index: 2;
    animation: hint-pulse 1.8s ease-in-out infinite;
  }
  body.is-revealed .sq-scratch-hint { display: none; }
  @keyframes hint-pulse {
    0%, 100% { opacity: .55; transform: translateY(0); }
    50%      { opacity: .85; transform: translateY(-2px); }
  }

  .sq-replay-note {
    font-size: 11.5px; color: ${accent}; opacity: .8;
    margin-top: -8px; margin-bottom: 14px; font-style: italic;
  }

  /* Bloc "présenter en caisse" (gain uniquement) */
  .sq-win-actions {
    display: none;
    margin: 6px 0 12px;
    flex-direction: column; gap: 10px;
    align-items: stretch;
  }
  body.is-win .sq-win-actions { display: flex; }

  /* Encart code signé */
  .sq-win-code-box {
    margin: 0 0 4px;
    padding: 14px 16px 12px;
    background: linear-gradient(135deg,
      rgba(7,9,13,.65), rgba(${parseInt(accent.slice(1,3),16)},${parseInt(accent.slice(3,5),16)},${parseInt(accent.slice(5,7),16)},.06));
    border: 1.5px solid ${accent}55;
    border-radius: 12px;
    text-align: center;
  }
  .sq-win-code-lbl {
    font-size: 10px; letter-spacing: .22em;
    color: ${accent}; opacity: .9;
    text-transform: uppercase; font-weight: 700;
    margin: 0 0 6px;
  }
  .sq-win-code-val {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 24px; font-weight: 700;
    color: #fff;
    letter-spacing: .05em;
    display: block;
  }
  .sq-copy-btn, .sq-download-btn {
    appearance: none; border: 0; cursor: pointer;
    font-family: inherit; font-weight: 700; letter-spacing: .02em;
    padding: 13px 22px;
    border-radius: 10px;
    transition: transform .14s ease, box-shadow .18s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .sq-copy-btn {
    background: rgba(255,255,255,.06);
    color: var(--tx);
    font-size: 13.5px;
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
    color: #fff; font-size: 14.5px;
    box-shadow: 0 8px 20px ${accent}55;
  }
  .sq-download-btn:active { transform: scale(.96); }

  /* Confettis quand gagnant */
  .sq-confetti {
    position: fixed; inset: 0; pointer-events: none;
    overflow: hidden; opacity: 0; transition: opacity .3s ease;
    z-index: 5;
  }
  body.is-win .sq-confetti { opacity: 1; }
  .sq-confetti i {
    position: absolute; top: -20px;
    width: 8px; height: 12px; opacity: 0;
    animation: confetti-fall 4s ease-in infinite;
  }
  body:not(.is-win) .sq-confetti i { animation-play-state: paused; }
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

  /* IA */
  .sq-ia { margin-top: 12px; min-height: 50px; }
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

  /* CTA */
  .sq-cta-wrap { margin-top: 16px;
    opacity: 0; transition: opacity .42s ease;
    pointer-events: none; }
  .sq-cta-wrap.is-shown { opacity: 1; pointer-events: auto; }
  .sq-cta {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 10px 18px; border-radius: 8px;
    background: transparent; color: var(--mut);
    font-size: 12.5px; font-weight: 500;
    text-decoration: underline; text-decoration-color: rgba(148,163,184,.32);
    text-underline-offset: 3px;
    cursor: pointer;
    transition: color .14s ease, text-decoration-color .14s ease;
  }
  .sq-cta:hover { color: ${accent};
    text-decoration-color: ${accent}88; }
  body.is-lose .sq-cta {
    border: 1px solid ${accent}55; text-decoration: none;
    color: ${accent}; padding: 12px 24px; font-size: 13px;
    font-weight: 600;
  }
  body.is-lose .sq-cta:hover { background: ${accent}11; transform: translateY(-1px); }

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

  <div class="sq-scratch-wrap">
    <div class="sq-scratch-reveal${imgFond ? ' has-bg' : ''}" id="sq-reveal">
      <div class="sq-scratch-reveal-icon" id="sq-reveal-icon"></div>
      <h2 class="sq-scratch-reveal-title" id="sq-reveal-title"></h2>
      <p class="sq-scratch-reveal-msg" id="sq-reveal-msg"></p>
    </div>
    <canvas class="sq-scratch-canvas" id="sq-canvas"></canvas>
    <div class="sq-scratch-hint">Gratte ici 👆</div>
  </div>

  <p class="sq-replay-note" id="sq-replay-note" hidden>Tu as déjà joué — voici ton résultat précédent (rescannable à tout moment).</p>

  <div class="sq-win-actions">
    <div class="sq-win-code-box">
      <p class="sq-win-code-lbl">Ton code unique</p>
      <code class="sq-win-code-val" id="sq-win-code">—</code>
    </div>
    <button type="button" class="sq-download-btn" id="sq-download-btn">🎫 Télécharger mon bon (.png)</button>
    <button type="button" class="sq-copy-btn" id="sq-copy-btn">📋 Copier le code</button>
  </div>

  <!-- Slot IA conservé pour le contrat (test runner vérifie sa présence)
       mais reste hidden : la phrase IA n'apporte rien dans le contexte
       d'un gain marketing. Retiré 26/05. -->
  <div class="sq-ia" id="sq-ia" hidden aria-hidden="true">
    <div id="sq-ia-loading"></div>
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
  const SHORT  = ${JSON.stringify(safeShort)};
  const TX     = ${JSON.stringify(tx)};
  const REVEAL_THRESHOLD = 0.6; // 60% gratté → reveal auto

  const canvas = document.getElementById('sq-canvas');
  const wrap   = canvas.parentElement;
  const reveal = document.getElementById('sq-reveal');
  const revealIcon  = document.getElementById('sq-reveal-icon');
  const revealTitle = document.getElementById('sq-reveal-title');
  const revealMsg   = document.getElementById('sq-reveal-msg');
  const replayNote  = document.getElementById('sq-replay-note');
  const ctaWrap     = document.getElementById('sq-cta-wrap');

  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  // Init canvas — métal selon texture
  function initCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth, h = wrap.clientHeight;
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    // Fond métallique gradient
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0,   TX.c1);
    g.addColorStop(0.5, TX.c2);
    g.addColorStop(1,   TX.c3);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Bruit grain léger pour texture
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 280; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
    // Texte central "Gratter ici"
    ctx.fillStyle = TX.label;
    ctx.font = 'bold 12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.6;
    ctx.fillText('GRATTER LA SURFACE', w / 2, h / 2);
    ctx.globalAlpha = 1;
    // Mode "destination-out" pour effacer au tracé
    ctx.globalCompositeOperation = 'destination-out';
  }

  // Récupère le résultat serveur (1 seul appel, dès le load)
  let serverResult = null;
  fetch('/api/smartqr/game-play', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ short_id: SHORT }),
  }).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(data => { serverResult = data; })
    .catch(e => {
      console.warn('[carte-a-gratter] game-play failed:', e);
      serverResult = { result: 'lose',
        message: 'Le tirage n\\'a pas pu aboutir. Réessaie plus tard.' };
    });

  // Détection de scratch (touch + mouse)
  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let lastX = 0, lastY = 0;
  let revealed = false;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function start(e) {
    if (revealed) return;
    isDrawing = true;
    const { x, y } = getPos(e);
    lastX = x; lastY = y;
    drawAt(x, y, x, y);
    e.preventDefault();
  }
  function move(e) {
    if (!isDrawing || revealed) return;
    const { x, y } = getPos(e);
    drawAt(lastX, lastY, x, y);
    lastX = x; lastY = y;
    // Vibrate très court à chaque trace (perceptible mais pas saturant)
    vibrate(8);
    e.preventDefault();
  }
  function end() {
    if (!isDrawing) return;
    isDrawing = false;
    maybeRevealByCoverage();
  }

  function drawAt(x0, y0, x1, y1) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Calcule % gratté (échantillonnage rapide tous les N pixels)
  function maybeRevealByCoverage() {
    const w = canvas.width, h = canvas.height;
    const STEP = 8;
    let cleared = 0, total = 0;
    const img = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += STEP) {
      for (let x = 0; x < w; x += STEP) {
        total++;
        const i = (y * w + x) * 4 + 3; // alpha channel
        if (img[i] < 32) cleared++;
      }
    }
    const ratio = cleared / total;
    if (ratio >= REVEAL_THRESHOLD) doReveal();
  }

  // V4.3 UX (2026-05-26) — Code signé + clipboard + PNG téléchargeable
  let currentWinCode    = '';
  let currentWinMessage = '';
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
  const copyBtn     = document.getElementById('sq-copy-btn');
  const downloadBtn = document.getElementById('sq-download-btn');
  const winCodeEl   = document.getElementById('sq-win-code');
  copyBtn?.addEventListener('click', () => {
    if (!currentWinCode) return;
    copyToClipboard(currentWinCode).then(() => {
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
  downloadBtn?.addEventListener('click', () => {
    if (!currentWinCode || typeof window.downloadWinPng !== 'function') return;
    downloadBtn.disabled = true;
    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = '⏳ Génération…';
    window.downloadWinPng(currentWinCode, currentWinMessage).then(() => {
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

  function doReveal() {
    if (revealed) return;
    revealed = true;
    canvas.classList.add('is-revealed');
    document.body.classList.add('is-revealed');

    // Si le serveur n'a pas encore répondu, on attend un peu
    const showResult = () => {
      const data = serverResult || { result: 'lose', message: '…' };
      const isWin = data.result === 'win';
      document.body.classList.add(isWin ? 'is-win' : 'is-lose');
      revealIcon.textContent = isWin ? '🎉' : '🍀';
      revealTitle.textContent = isWin ? 'Gagné !' : 'Pas cette fois';
      revealMsg.textContent = data.message || '';
      currentWinCode    = (data.code_won || '').toString();
      currentWinMessage = (data.message_gain || data.message || '').toString();
      if (winCodeEl) winCodeEl.textContent = currentWinCode || '—';
      replayNote.hidden = !data.replay_blocked;
      ctaWrap.classList.add('is-shown');
      if (isWin) vibrate([90, 60, 90, 60, 140]);
    };
    if (serverResult) {
      showResult();
    } else {
      // Attente courte (max 3s) que le serveur réponde
      let waited = 0;
      const tick = setInterval(() => {
        waited += 100;
        if (serverResult || waited >= 3000) {
          clearInterval(tick);
          showResult();
        }
      }, 100);
    }
  }

  // Wire events
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove',  move,  { passive: false });
  canvas.addEventListener('touchend',   end);

  // Init après que le wrap a sa dimension réelle
  window.addEventListener('load', initCanvas);
  initCanvas();

  // (Le slot IA reste hidden — la phrase IA est désactivée pour les
  // templates jeux depuis le 26/05. Le scaffold est conservé pour
  // satisfaire le contrat du test runner.)
})();
</script>
${renderAiFetchScript(safeShort)}
${renderWinPngScript(nomMarque, logoUrl, accent, imgFond)}
</body>
</html>`;
  },
};

export default TEMPLATE;
