// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · machine-a-sous (V4.3)
// ───────────────────────────────────────────────────────────────────
// Vrai jeu marketing : 3 cylindres tournent et s'arrêtent en cascade,
// le résultat (gain / perte) est DÉCIDÉ CÔTÉ SERVEUR via l'endpoint
// /api/smartqr/game-play. Le client n'a qu'à animer le résultat reçu.
//
// Anti-triche : impossible de gagner sans le serveur (qui tient le
// taux + le stock + l'anti-rejouage par device_hash).
//
// UX :
//   T+0     3 cylindres figés + bouton "Tirer" en gros
//   tap     bouton → fetch game-play + démarrage anim cylindres
//   ≈3.5s   les 3 cylindres se sont arrêtés sur les symboles serveur
//   reveal  message gain (+ confettis + vibrate) ou perte
//   ≈5.5s   phrase IA arrive en background (contextualise le résultat)
//
// Cf. BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md § "2. Machine à sous"
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot, renderAiFetchScript, renderWinPngScript } from './_shared.js';

const TEMPLATE = {
  id:              'machine-a-sous',
  label:           'Machine à sous',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    if (!d.message_gain || !String(d.message_gain).trim()) {
      errors.push('Le message en cas de gain est obligatoire.');
    }
    const taux = Number(d.taux_de_gain);
    if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
      errors.push('Le taux de gain doit être un nombre entre 0 et 100.');
    }
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const d         = qrData?.template_data || {};
    const nom       = (d.nom_marque || '').toString().slice(0, 60);
    const messageG  = (d.message_gain || '').toString().slice(0, 200);
    const messageP  = (d.message_perte || '').toString().slice(0, 200);
    const now       = new Date();
    const dayFr     = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    const hourFr    = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS. Le scanneur vient de jouer à une',
      'machine à sous marketing. Tu écris UNE phrase courte qui contextualise le',
      'résultat sans savoir si c\'est gain ou perte (réponse générique mais chaleureuse).',
      '',
      'Règles strictes :',
      '- title : 3-5 mots accrocheurs (ex: "Bravo joueur", "À ton tour")',
      '- phrase : 1 seule phrase max 18 mots, ton ludique, contextuelle (jour, heure)',
      '- Si le brief métier parle d\'un produit (café, glace, etc.), tu peux y faire',
      '  une allusion gourmande/positive sans rien promettre',
      '- Pas de CTA, pas d\'horaires inventés',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
    ].join('\n');

    const user = [
      `Marque : ${nom || '(sans nom)'}`,
      `Message gain configuré : ${messageG}`,
      messageP ? `Message perte configuré : ${messageP}` : null,
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
    const d          = qrData?.template_data || {};
    const safeShort  = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const nomMarque  = escHtml((d.nom_marque || '').toString().slice(0, 60));
    const logoUrl    = safeUrl(d.logo_url);
    const accent     = safeColor(d.accent_color, '#c9a96e');
    // Symboles : 5-10 emojis/chars, 1 par ligne. Fallback agréable.
    const symbolesRaw = (d.symboles_cylindre || '🍒\n🍋\n⭐\n🔔\n💎\n7️⃣').toString();
    const symboles = symbolesRaw.split('\n').map(s => escHtml(s.trim())).filter(Boolean).slice(0, 10);
    const symbolesFallback = symboles.length >= 3 ? symboles : ['🍒', '🍋', '⭐', '🔔', '💎'];

    // Strip qui tourne dans chaque cylindre = liste répétée pour anim infinie
    function strip(sList) {
      const repeat = [];
      for (let i = 0; i < 6; i++) repeat.push(...sList);
      return repeat.map(s => `<div class="sq-reel-cell">${s}</div>`).join('');
    }
    const stripHtml = strip(symbolesFallback);
    // Pour la version statique de départ (3 symboles aléatoires figés)
    const initialDisplay = symbolesFallback.slice(0, 3);

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nomMarque || 'Machine à sous'} · Smart QR</title>
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
  body.is-win .sq-bg { background: radial-gradient(ellipse at center,
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

  /* Wrapper machine + levier — flex centré */
  .sq-machine-wrap {
    display: flex; justify-content: center; align-items: stretch;
    gap: 8px;
    margin: 16px auto 22px;
    max-width: 380px;
  }

  /* Machine = 3 cylindres dans une frame dorée */
  .sq-machine {
    flex: 1;
    background: linear-gradient(180deg, #0a0d12 0%, #161e29 100%);
    border: 2px solid ${accent};
    border-radius: 14px;
    padding: 12px;
    max-width: 320px;
    box-shadow: 0 0 32px ${accent}55,
                0 0 0 4px rgba(255,255,255,.04) inset;
  }

  /* V4.3 UX 26/05 (transposé de la carte à gratter) — Levier tactile
     draggable au lieu du bouton 'Tirer'. Métaphore physique réelle de
     la machine à sous : la poignée descend avec le doigt, déclenche le
     tirage au seuil 70% (ou au release après seuil), spring-back animé. */
  .sq-lever-wrap {
    position: relative;
    width: 38px;
    align-self: stretch;
    user-select: none; -webkit-user-select: none;
    touch-action: none;
  }
  .sq-lever-track {
    position: absolute;
    left: 50%; top: 10px; bottom: 10px;
    width: 8px;
    transform: translateX(-50%);
    background: linear-gradient(180deg, #1a2331, #0a0d12, #1a2331);
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgba(255,255,255,.04) inset;
  }
  .sq-lever-track::before {
    content: ""; position: absolute;
    left: 50%; top: 0; bottom: 0;
    width: 2px; transform: translateX(-50%);
    background: linear-gradient(180deg, ${accent}55, ${accent}11);
    border-radius: 2px;
  }
  .sq-lever-handle {
    position: absolute;
    left: 50%; top: 0;
    width: 36px; height: 36px;
    transform: translate(-50%, 0);
    background: radial-gradient(circle at 35% 30%, #ef4444, #b91c1c 70%, #7f1d1d);
    border-radius: 50%;
    box-shadow:
      0 6px 14px rgba(127,29,29,.55),
      0 0 0 3px rgba(255,255,255,.06) inset,
      0 -2px 6px rgba(0,0,0,.3) inset;
    cursor: grab;
    transition: none;
  }
  .sq-lever-handle:active { cursor: grabbing; }
  .sq-lever-handle.is-springing {
    transition: transform 700ms cubic-bezier(.18,.89,.32,1.28);
  }
  .sq-lever-handle::after {
    content: "↓"; position: absolute;
    inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,.55);
    font-size: 18px; font-weight: 700;
    pointer-events: none;
    animation: lever-hint 2s ease-in-out infinite;
  }
  body.is-spinning .sq-lever-handle::after,
  body.is-win      .sq-lever-handle::after,
  body.is-lose     .sq-lever-handle::after { display: none; }
  @keyframes lever-hint {
    0%, 100% { opacity: .4; transform: translateY(0); }
    50%      { opacity: .9; transform: translateY(2px); }
  }
  .sq-lever-hint {
    margin-top: 8px;
    text-align: center;
    font-size: 11px;
    color: var(--mut);
    letter-spacing: .08em;
    text-transform: uppercase;
    opacity: .75;
    transition: opacity .2s;
  }
  body.is-spinning .sq-lever-hint,
  body.is-win      .sq-lever-hint,
  body.is-lose     .sq-lever-hint { opacity: 0; }
  .sq-reels {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .sq-reel {
    position: relative;
    height: 96px;
    background: linear-gradient(180deg, #0a0d12 0%, #1a2331 50%, #0a0d12 100%);
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,.06);
  }
  .sq-reel::before, .sq-reel::after {
    content: ""; position: absolute; left: 0; right: 0;
    height: 24px; z-index: 2; pointer-events: none;
  }
  .sq-reel::before { top: 0;    background: linear-gradient(180deg, #0a0d12, transparent); }
  .sq-reel::after  { bottom: 0; background: linear-gradient(0deg,   #0a0d12, transparent); }
  .sq-reel-strip {
    position: absolute; left: 0; right: 0; top: 0;
    transition: none;
  }
  .sq-reel-cell {
    height: 96px;
    display: flex; align-items: center; justify-content: center;
    font-size: 44px;
    line-height: 1;
  }
  /* Animation : strip glisse vers le bas en boucle pendant spinning */
  body.is-spinning .sq-reel-strip {
    animation: reel-spin 0.5s linear infinite;
  }
  @keyframes reel-spin {
    from { transform: translateY(0); }
    to   { transform: translateY(-${96 * 6}px); }
  }
  /* Easing élastique d'arrêt sur chaque reel */
  .sq-reel-strip.is-stopped {
    animation: none !important;
    transition: transform 600ms cubic-bezier(.18,.89,.32,1.28);
  }

  /* Le bouton .sq-action a été remplacé par le levier tactile
     (.sq-lever-wrap ci-dessus) le 26/05 — métaphore plus immersive
     alignée avec la mécanique physique réelle d'une machine à sous. */

  /* Résultat */
  .sq-result { margin-top: 22px; min-height: 60px; }
  .sq-result-title {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 28px; font-weight: 700;
    letter-spacing: -.015em; line-height: 1.15;
    margin: 0 0 8px;
  }
  .sq-result-msg {
    font-size: 15px; line-height: 1.55;
    color: var(--tx);
    margin: 0 0 6px;
  }
  body.is-lose .sq-result-msg { color: var(--mut); }
  body.is-win .sq-result-title {
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
  body.is-lose .sq-result-title { color: var(--mut); }

  /* Bloc "présenter en caisse" (gain uniquement) */
  .sq-win-actions {
    display: none;
    margin-top: 14px;
    flex-direction: column; gap: 10px;
    align-items: stretch;
  }
  body.is-win .sq-win-actions { display: flex; }

  /* Encart code signé (visible aussi côté commerçant) */
  .sq-win-code-box {
    margin: 14px 0 4px;
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
  /* V4.3 UX 26/05 — Bouton raccourci vers la page de vérif (commerçant
     peut vérifier le code en 1 tap depuis le téléphone du client) */
  .sq-verify-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    appearance: none;
    background: transparent;
    color: #86efac;
    border: 1px solid rgba(74,222,128,.4);
    font-family: inherit; font-size: 13px; font-weight: 600;
    padding: 11px 18px;
    border-radius: 10px;
    text-decoration: none;
    cursor: pointer;
    transition: background .14s ease, border-color .14s ease, transform .14s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .sq-verify-btn:hover { background: rgba(74,222,128,.08);
    border-color: rgba(74,222,128,.65); transform: translateY(-1px); }
  .sq-verify-btn:active { transform: scale(.97); }
  .sq-rescan-hint, .sq-verify-hint {
    font-size: 11.5px; color: var(--mut);
    line-height: 1.5; margin: 4px 0 0;
    padding: 9px 12px;
    background: rgba(124,138,249,.08);
    border-left: 2px solid ${accent}55;
    border-radius: 4px;
    text-align: left;
  }
  .sq-rescan-hint::before { content: "💡"; margin-right: 6px; }
  .sq-verify-hint { background: rgba(74,222,128,.06);
    border-left-color: rgba(74,222,128,.4); }
  .sq-verify-hint::before { content: "🔒"; margin-right: 6px; }

  .sq-replay-note {
    font-size: 11.5px; color: ${accent}; opacity: .8;
    margin-top: 6px; font-style: italic;
  }

  /* Confettis (visible uniquement si gagnant) */
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

  /* Slot IA */
  .sq-ia { margin-top: 18px; min-height: 50px;
    opacity: 0; animation: ia-in 600ms 4500ms ease-out forwards; }
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

  /* CTA Continuer (apparaît après le résultat) */
  .sq-cta-wrap { margin-top: 16px;
    opacity: 0; transition: opacity .42s ease;
    pointer-events: none; }
  .sq-cta-wrap.is-shown {
    opacity: 1; pointer-events: auto;
  }
  /* Pour les gagnants, le bouton Continuer devient un lien discret
     (pour ne pas attirer le clic avant qu'ils aient noté/copié leur code). */
  body.is-win .sq-cta-wrap { margin-top: 14px; }
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

  <div class="sq-machine-wrap">
    <div class="sq-machine">
      <div class="sq-reels">
        <div class="sq-reel"><div class="sq-reel-strip" id="reel-1">${stripHtml}</div></div>
        <div class="sq-reel"><div class="sq-reel-strip" id="reel-2">${stripHtml}</div></div>
        <div class="sq-reel"><div class="sq-reel-strip" id="reel-3">${stripHtml}</div></div>
      </div>
    </div>

    <div class="sq-lever-wrap" id="sq-lever-wrap">
      <div class="sq-lever-track" aria-hidden="true"></div>
      <button type="button" class="sq-lever-handle" id="sq-lever-handle"
              aria-label="Tirer le levier pour jouer"></button>
    </div>
  </div>
  <p class="sq-lever-hint" id="sq-lever-hint">Tire le levier ↓</p>

  <div class="sq-result" id="sq-result" hidden>
    <h2 class="sq-result-title" id="sq-result-title"></h2>
    <p class="sq-result-msg" id="sq-result-msg"></p>

    <div class="sq-win-actions">
      <div class="sq-win-code-box">
        <p class="sq-win-code-lbl">Ton code unique</p>
        <code class="sq-win-code-val" id="sq-win-code">—</code>
      </div>
      <button type="button" class="sq-download-btn" id="sq-download-btn">🎫 Télécharger mon bon (.png)</button>
      <button type="button" class="sq-copy-btn" id="sq-copy-btn">📋 Copier le code</button>
      <a class="sq-verify-btn" id="sq-verify-btn" href="#" target="_blank" rel="noopener">🔒 Vérifier ce code</a>
      <p class="sq-rescan-hint">Rescanne ce QR à tout moment pour revoir ton gain et le présenter en caisse.</p>
      <p class="sq-verify-hint">Code cryptographiquement signé. Le commerçant peut vérifier l'authenticité en 1 tap.</p>
    </div>

    <p class="sq-replay-note" id="sq-replay-note" hidden></p>
  </div>

  <!-- Slot IA conservé pour le contrat (test runner vérifie sa présence)
       mais reste hidden : la phrase IA n'apporte rien dans le contexte
       d'un gain marketing (le joueur ne lit que son code). Retiré 26/05. -->
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
  const SHORT = ${JSON.stringify(safeShort)};
  const SYMBOLS = ${JSON.stringify(symbolesFallback)};
  const CELL_PX = 96;

  const el = id => document.getElementById(id);
  const leverHandle = el('sq-lever-handle');
  const leverHint   = el('sq-lever-hint');
  const result = el('sq-result');
  const resultTitle = el('sq-result-title');
  const resultMsg = el('sq-result-msg');
  const replayNote = el('sq-replay-note');
  const copyBtn = el('sq-copy-btn');
  const downloadBtn = el('sq-download-btn');
  const verifyBtn = el('sq-verify-btn');
  const winCodeEl = el('sq-win-code');
  const ctaWrap = el('sq-cta-wrap');
  const reels = [el('reel-1'), el('reel-2'), el('reel-3')];

  // V4.3 UX (2026-05-26) — Copie le code de gain dans le presse-papiers,
  // pour que le gagnant puisse le coller dans Notes/Messages/etc. en
  // complément du rescan du QR.
  let currentWinCode = '';
  let currentWinMessage = '';
  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback ancien : execCommand
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

  // V4.3 UX — Bouton Télécharger le bon (PNG via canvas)
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

  let isPlaying = false;

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  // Cherche l'index d'un symbole dans la strip rendue (6 répétitions),
  // au-delà du milieu pour permettre la transition CSS smooth.
  function findSymbolPositionInStrip(symbol) {
    for (let i = 3 * SYMBOLS.length; i < 5 * SYMBOLS.length; i++) {
      if (SYMBOLS[i % SYMBOLS.length] === symbol) return i;
    }
    // Fallback : prend le premier
    return 3 * SYMBOLS.length;
  }

  function stopReelOn(reelEl, symbol, delayMs) {
    setTimeout(() => {
      const idx = findSymbolPositionInStrip(symbol);
      // On veut placer le symbole dans la cellule centrale (cell index 1
      // sur 3 visibles puisque le reel fait 96px et la strip 96px/cell)
      // En réalité chaque reel n'affiche qu'1 cellule à la fois, donc on
      // ramène la strip pour que la cellule idx soit en (0, 0).
      const targetY = -(idx * CELL_PX);
      reelEl.classList.add('is-stopped');
      reelEl.style.transform = 'translateY(' + targetY + 'px)';
      // Petit kick haptique discret
      vibrate(30);
    }, delayMs);
  }

  async function play() {
    if (isPlaying) return;
    isPlaying = true;

    // Reset visuel
    result.hidden = true;
    document.body.classList.remove('is-win', 'is-lose');
    reels.forEach(r => {
      r.classList.remove('is-stopped');
      r.style.transform = '';
    });
    document.body.classList.add('is-spinning');

    // Appel serveur (authoritative)
    let data = null;
    try {
      const r = await fetch('/api/smartqr/game-play', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_id: SHORT }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
    } catch (e) {
      // Fail-safe : on s'arrête immédiatement et on affiche une perte sans tracker
      data = { result: 'lose', symboles: SYMBOLS.slice(0, 3),
               message: 'Le tirage n\\'a pas abouti. Réessaie plus tard.' };
    }

    const trio = Array.isArray(data.symboles) && data.symboles.length === 3
                 ? data.symboles : SYMBOLS.slice(0, 3);
    // Garantit que les symboles existent bien dans notre strip (sinon fallback
    // au premier symbole connu pour ne pas casser l'anim).
    const safeTrio = trio.map(s => SYMBOLS.includes(s) ? s : SYMBOLS[0]);

    // Lance l'arrêt cascadé : reel 1 à 1.4s, reel 2 à 2.2s, reel 3 à 3.0s
    stopReelOn(reels[0], safeTrio[0], 1400);
    stopReelOn(reels[1], safeTrio[1], 2200);
    stopReelOn(reels[2], safeTrio[2], 3000);

    // Reveal final à T+3.6s (juste après le dernier reel)
    setTimeout(() => {
      document.body.classList.remove('is-spinning');
      const isWin = data.result === 'win';
      document.body.classList.add(isWin ? 'is-win' : 'is-lose');
      resultTitle.textContent = isWin ? '🎉 Gagné !' : 'Pas cette fois';
      resultMsg.textContent = data.message || '';
      // Pour les boutons Copier/Télécharger — code_won = signature crypto
      // unique (WIN-XXXX-XXXX), message_gain = texte commerçant à afficher.
      currentWinCode    = (data.code_won || '').toString();
      currentWinMessage = (data.message_gain || data.message || '').toString();
      if (winCodeEl) winCodeEl.textContent = currentWinCode || '—';
      if (verifyBtn && currentWinCode) {
        verifyBtn.href = location.origin + '/verify-win.html?code=' + encodeURIComponent(currentWinCode);
      }
      replayNote.hidden = !data.replay_blocked;
      if (data.replay_blocked) {
        replayNote.textContent = 'Tu as déjà joué — voici ton résultat précédent (rescannable à tout moment).';
      }
      result.hidden = false;
      if (isWin) vibrate([90, 60, 90, 60, 140]);
      // iaBlock reste hidden (retiré du flow UX 26/05 : la phrase IA
      // n'aide pas le joueur, le code et le bouton de téléchargement
      // sont les seuls éléments d'attention).
      ctaWrap.classList.add('is-shown');
    }, 3600);
  }

  // V4.3 UX 26/05 — Mécanique du levier draggable (transposée de la
  // logique tactile de carte-a-gratter). L'utilisateur attrape la
  // poignée et la tire vers le bas. Au seuil 70% (ou au release si
  // déjà passé), on déclenche play(). Toujours spring-back animé.
  const LEVER_MAX_TRAVEL = 120; // px max vers le bas
  const LEVER_TRIGGER    = 0.7; // 70% du travel = trigger
  let leverDragging = false;
  let leverStartY   = 0;
  let leverY        = 0;
  let leverTriggered = false;

  function leverGetY(e) {
    const t = e.touches ? e.touches[0] : e;
    return t.clientY;
  }
  function leverSetY(y, withTransition) {
    leverHandle.classList.toggle('is-springing', !!withTransition);
    leverHandle.style.transform = 'translate(-50%, ' + y + 'px)';
  }
  function leverStart(e) {
    if (isPlaying) return;
    leverDragging  = true;
    leverTriggered = false;
    leverStartY    = leverGetY(e);
    leverSetY(0, false);
    e.preventDefault();
  }
  function leverMove(e) {
    if (!leverDragging) return;
    const dy = leverGetY(e) - leverStartY;
    leverY = Math.max(0, Math.min(LEVER_MAX_TRAVEL, dy));
    leverSetY(leverY, false);
    // Trigger automatique dès qu'on dépasse le seuil pendant le drag
    if (!leverTriggered && leverY >= LEVER_MAX_TRAVEL * LEVER_TRIGGER) {
      leverTriggered = true;
      vibrate(50);
      play();
      // Spring-back immédiat même sans release
      leverEnd();
    }
    e.preventDefault();
  }
  function leverEnd() {
    if (!leverDragging) return;
    leverDragging = false;
    // Spring-back animé
    leverSetY(0, true);
    leverY = 0;
  }

  leverHandle.addEventListener('mousedown',  leverStart);
  window.addEventListener('mousemove',       leverMove);
  window.addEventListener('mouseup',         leverEnd);
  leverHandle.addEventListener('touchstart', leverStart, { passive: false });
  leverHandle.addEventListener('touchmove',  leverMove,  { passive: false });
  leverHandle.addEventListener('touchend',   leverEnd);
  leverHandle.addEventListener('touchcancel',leverEnd);
  // Accessibilité : clic simple = tire le levier (sans drag) →
  // pour utilisateurs souris pressés ou lecteurs d'écran qui activent
  // le bouton via Enter.
  leverHandle.addEventListener('click', (e) => {
    if (isPlaying) return;
    if (leverY > 0) return; // déjà déclenché par drag
    play();
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
