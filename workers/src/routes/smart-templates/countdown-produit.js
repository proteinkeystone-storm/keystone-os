// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · countdown-produit (V4.1)
// ───────────────────────────────────────────────────────────────────
// Countdown paramétrable jusqu'à une date précise (lancement, drop,
// sortie album, ouverture, soldes flash). Affichage 4 blocs J/H/M/S
// avec animation tick chaque seconde. Phrase IA d'anticipation arrive
// en parallèle (T+5s mini).
//
// Si la date est passée, le countdown affiche "C'est ouvert !" + CTA
// direct vers la cible — le QR continue de marcher sans modification.
//
// Cf. BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md § "4. Compte à rebours produit"
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, safeDate, renderKeystoneFoot, renderAiFetchScript } from './_shared.js';

const TEMPLATE = {
  id:              'countdown-produit',
  label:           'Compte à rebours produit',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_produit || !String(d.nom_produit).trim()) {
      errors.push('Le nom du produit est obligatoire.');
    }
    if (!d.date_sortie) {
      errors.push('La date de sortie est obligatoire.');
    } else if (!Number.isFinite(safeDate(d.date_sortie))) {
      errors.push('La date de sortie est invalide (format attendu : 2026-12-31T18:00).');
    }
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const d         = qrData?.template_data || {};
    const nomMarque = (d.nom_marque || '').toString().slice(0, 60);
    const nomProduit = (d.nom_produit || '').toString().slice(0, 80);
    const teaser    = (d.teaser_text || '').toString().slice(0, 240);
    const target    = safeDate(d.date_sortie);
    const now       = Date.now();
    const remMs     = Number.isFinite(target) ? Math.max(0, target - now) : 0;
    const remH      = Math.floor(remMs / 3_600_000);
    const remD      = Math.floor(remMs / 86_400_000);
    const isLive    = Number.isFinite(target) && now >= target;

    const remLabel = isLive
      ? 'déjà disponible (date passée)'
      : remD >= 2
        ? `${remD} jours restants`
        : remH >= 1
          ? `${remH} heures restantes`
          : 'moins d\'une heure restante';

    const nowDate   = new Date();
    const dayFr     = nowDate.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    const hourFr    = nowDate.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS. Le scanneur vient de voir un compte à rebours',
      'avant la sortie d\'un produit. Tu écris la phrase d\'anticipation qui accompagne le countdown.',
      '',
      'Règles strictes :',
      '- title : 3-5 mots, urgence ou anticipation (ex: "J-3", "Bientôt", "C\'est aujourd\'hui")',
      '- phrase : 1 seule phrase, max 18 mots, qui crée le désir sans surpromettre',
      '- Si la date est passée, célèbre l\'ouverture/disponibilité',
      '- Sinon, joue sur l\'attente, l\'imminence, le contexte',
      '- Pas de CTA explicite (un bouton est déjà affiché), pas d\'horaires inventés',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
    ].join('\n');

    const user = [
      `Marque : ${nomMarque || '(non précisée)'}`,
      `Produit : ${nomProduit || '(non précisé)'}`,
      teaser ? `Teaser propriétaire : ${teaser}` : null,
      `Statut : ${remLabel}`,
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
    const nomProduit = escHtml((d.nom_produit || '').toString().slice(0, 80));
    const teaser     = escHtml((d.teaser_text || '').toString().slice(0, 240));
    const logoUrl    = safeUrl(d.logo_url);
    const visuelUrl  = safeUrl(d.visuel_url);
    const accent     = safeColor(d.accent_color, '#7c8af9');
    const targetMs   = safeDate(d.date_sortie);
    // ISO sûre pour insertion JSON. Si invalide, fallback "ouvert".
    const targetIso  = Number.isFinite(targetMs)
      ? new Date(targetMs).toISOString()
      : '';
    const compteScans = d.compte_scans === true || d.compte_scans === 'true';

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nomProduit || 'Bientôt'} · Smart QR</title>
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

  /* Gradient animé en fond — pulse plus rapide à mesure qu'on approche */
  .sq-bg {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(ellipse at 50% 0%,
      ${accent}33 0%, ${accent}11 35%, transparent 70%);
    animation: bg-pulse 5s ease-in-out infinite;
  }
  body.is-soon  .sq-bg { animation-duration: 2.6s; }
  body.is-now   .sq-bg { animation-duration: 1.4s; }
  body.is-live  .sq-bg {
    background: radial-gradient(ellipse at center,
      ${accent}55 0%, ${accent}22 40%, transparent 75%);
    animation-duration: 3s;
  }
  @keyframes bg-pulse {
    0%, 100% { opacity: .6; transform: scale(1); }
    50%      { opacity: 1;  transform: scale(1.05); }
  }

  .sq-card {
    position: relative; z-index: 1;
    max-width: 480px; width: 100%;
    background: linear-gradient(180deg, #0e141b 0%, var(--card) 100%);
    border: 1px solid var(--bd);
    border-radius: 24px;
    padding: 36px 24px 26px;
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
    margin-bottom: 12px; font-weight: 600; opacity: .85; }

  /* Badge dynamique d'urgence — change selon le temps restant */
  .sq-urgency {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px 4px;
    margin: 0 auto 18px;
    background: rgba(124,138,249,.10);
    border: 1px solid ${accent}33;
    border-radius: 999px;
    font-size: 10.5px; letter-spacing: .14em;
    color: ${accent};
    text-transform: uppercase; font-weight: 700;
    transition: background .3s ease, border-color .3s ease, color .3s ease;
  }
  .sq-urgency::before {
    content: ""; display: inline-block;
    width: 6px; height: 6px; border-radius: 50%;
    background: ${accent};
    animation: urg-pulse 2s ease-in-out infinite;
  }
  @keyframes urg-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(1.4); opacity: .55; }
  }
  body.is-soon .sq-urgency {
    background: rgba(251,191,36,.10);
    border-color: rgba(251,191,36,.45);
    color: #fbbf24;
  }
  body.is-soon .sq-urgency::before { background: #fbbf24; }
  body.is-now .sq-urgency {
    background: rgba(248,113,113,.12);
    border-color: rgba(248,113,113,.55);
    color: #fca5a5;
  }
  body.is-now .sq-urgency::before { background: #f87171;
    animation-duration: .9s; }
  body.is-live .sq-urgency {
    background: linear-gradient(135deg, ${accent}33, rgba(74,222,128,.20));
    border-color: rgba(74,222,128,.55);
    color: #86efac;
  }
  body.is-live .sq-urgency::before { background: #4ade80;
    animation-duration: 1.4s; }

  /* Header : logo + marque + nom produit */
  .sq-head { margin-bottom: 22px; }
  .sq-logo {
    max-height: 56px; max-width: 160px;
    margin: 0 auto 12px; display: block;
    filter: drop-shadow(0 4px 12px ${accent}55);
  }
  .sq-marque {
    font-size: 11px; letter-spacing: .2em;
    color: var(--mut); text-transform: uppercase;
    margin: 0 0 8px;
  }
  .sq-produit {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 30px; font-weight: 700; letter-spacing: -.02em;
    margin: 0; line-height: 1.15;
    background: linear-gradient(135deg, var(--tx), ${accent});
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  /* Visuel produit */
  .sq-visuel {
    margin: 18px -8px 22px;
    height: 156px; border-radius: 12px;
    overflow: hidden;
    background: linear-gradient(135deg, ${accent}22, ${accent}08);
  }
  .sq-visuel img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .sq-visuel-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: ${accent}; opacity: .35;
    font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
  }

  /* Countdown 4 blocs */
  .sq-countdown {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 8px; margin: 16px 0 18px;
  }
  .sq-cd-cell {
    background: rgba(255,255,255,.03);
    border: 1px solid ${accent}33;
    border-radius: 10px;
    padding: 12px 6px 10px;
    transition: transform .14s ease, border-color .14s ease;
  }
  body.is-soon .sq-cd-cell { border-color: ${accent}55; }
  body.is-now  .sq-cd-cell { border-color: ${accent}88;
    animation: cell-pulse 1.2s ease-in-out infinite; }
  @keyframes cell-pulse {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.03); }
  }
  .sq-cd-num {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', Menlo, monospace;
    font-size: 28px; font-weight: 700; line-height: 1;
    color: var(--tx); letter-spacing: -.02em;
    font-variant-numeric: tabular-nums;
  }
  .sq-cd-unit {
    font-size: 9.5px; letter-spacing: .18em;
    color: var(--mut); text-transform: uppercase;
    margin-top: 6px;
  }
  /* Tick effet flip-clock simplifié : translation + scale + glow accent */
  .sq-cd-tick {
    animation: tick-flip 420ms cubic-bezier(.42,0,.18,1);
  }
  @keyframes tick-flip {
    0%   { transform: translateY(0)    scale(1);   filter: brightness(1); }
    35%  { transform: translateY(-12px) scale(1.12); filter: brightness(1.4); }
    70%  { transform: translateY(2px)  scale(.96);  filter: brightness(1); }
    100% { transform: translateY(0)    scale(1);   filter: brightness(1); }
  }

  /* Mode "Live" : countdown disparu, message d'ouverture grandiose */
  .sq-live-msg {
    margin: 24px 0 16px;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 38px; font-weight: 700;
    letter-spacing: -.015em; line-height: 1.1;
    background: linear-gradient(135deg, var(--tx), ${accent}, var(--tx));
    background-size: 200% 100%;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: live-in 700ms cubic-bezier(.16,.84,.3,1),
               live-shine 4s ease-in-out infinite;
  }
  @keyframes live-in {
    from { opacity: 0; transform: scale(.85); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes live-shine {
    0%, 100% { background-position: 0% 50%; }
    50%      { background-position: 100% 50%; }
  }

  /* Confettis CSS au passage en mode live */
  .sq-confetti {
    position: absolute; pointer-events: none;
    inset: 0; overflow: hidden;
    opacity: 0; transition: opacity .3s ease;
  }
  body.is-live .sq-confetti { opacity: 1; }
  .sq-confetti i {
    position: absolute; top: -20px;
    width: 8px; height: 12px;
    background: ${accent};
    opacity: 0;
    animation: confetti-fall 4s ease-in infinite;
  }
  body:not(.is-live) .sq-confetti i { animation-play-state: paused; }
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

  /* Teaser */
  .sq-teaser {
    font-size: 14px; line-height: 1.55;
    color: var(--mut);
    margin: 14px auto 6px; max-width: 380px;
  }

  /* Compte scans */
  .sq-scancount {
    font-size: 11px; color: ${accent};
    letter-spacing: .08em;
    margin: 8px 0 4px; opacity: .8;
  }

  /* Slot IA — skeleton puis reveal */
  .sq-ia { margin-top: 18px; min-height: 80px; }

  .sq-skeleton-title {
    height: 20px; width: 50%; margin: 4px auto 10px;
    border-radius: 5px;
    background: linear-gradient(90deg,
      ${accent}1a 0%, ${accent}40 50%, ${accent}1a 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s linear infinite;
  }
  .sq-skeleton-line {
    height: 12px; margin: 6px auto;
    border-radius: 4px;
    background: linear-gradient(90deg,
      rgba(148,163,184,.10) 0%, rgba(148,163,184,.26) 50%, rgba(148,163,184,.10) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s linear infinite;
  }
  .sq-skeleton-line.w80 { width: 80%; }
  .sq-skeleton-line.w60 { width: 60%; }
  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .sq-hint { margin-top: 14px; font-size: 12px; color: var(--mut);
    opacity: .65; font-style: italic; }
  .sq-hint::before { content: "✦"; color: var(--gold); margin-right: 6px;
    opacity: .85; font-style: normal; display: inline-block;
    animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }

  .sq-final { display: none; }
  .sq-final.is-shown { display: block;
    animation: final-in 500ms cubic-bezier(.16,.84,.3,1); }
  @keyframes final-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .sq-title {
    font-size: 22px; font-weight: 700; margin: 6px 0 10px;
    letter-spacing: -.025em; line-height: 1.18;
  }
  #sq-phrase {
    color: var(--mut); font-size: 14.5px; line-height: 1.55;
    margin: 0 0 22px;
  }

  /* CTA Continuer */
  .sq-cta-wrap { margin-top: 16px; }
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

  .sq-foot { margin-top: 26px; color: #64748b; font-size: 11px; line-height: 1.5; }
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

  <div class="sq-urgency" id="sq-urgency">Bientôt</div>

  <div class="sq-head">
    ${logoUrl ? `<img class="sq-logo" src="${logoUrl}" alt="${nomMarque}" loading="eager">` : ''}
    ${nomMarque ? `<p class="sq-marque">${nomMarque}</p>` : ''}
    <h1 class="sq-produit">${nomProduit || 'Bientôt disponible'}</h1>
  </div>

  <div class="sq-visuel">
    ${visuelUrl
      ? `<img src="${visuelUrl}" alt="" loading="eager">`
      : `<div class="sq-visuel-placeholder">${nomProduit || 'Coming soon'}</div>`}
  </div>

  <div id="sq-countdown-wrap" class="sq-countdown" aria-live="polite">
    <div class="sq-cd-cell"><div class="sq-cd-num" id="cd-d">--</div><div class="sq-cd-unit">Jours</div></div>
    <div class="sq-cd-cell"><div class="sq-cd-num" id="cd-h">--</div><div class="sq-cd-unit">Heures</div></div>
    <div class="sq-cd-cell"><div class="sq-cd-num" id="cd-m">--</div><div class="sq-cd-unit">Min</div></div>
    <div class="sq-cd-cell"><div class="sq-cd-num" id="cd-s">--</div><div class="sq-cd-unit">Sec</div></div>
  </div>
  <div id="sq-live-msg" class="sq-live-msg" hidden>C'est ouvert ✦</div>

  ${teaser ? `<p class="sq-teaser">${teaser}</p>` : ''}
  ${compteScans ? `<p class="sq-scancount" id="sq-scancount" hidden></p>` : ''}

  <div class="sq-ia" id="sq-ia">
    <div id="sq-loading">
      <div class="sq-skeleton-title" aria-hidden="true"></div>
      <div class="sq-skeleton-line w80" aria-hidden="true"></div>
      <div class="sq-skeleton-line w60" aria-hidden="true"></div>
      <p class="sq-hint">L'IA prépare votre annonce…</p>
    </div>
    <div class="sq-final" id="sq-final">
      <h2 class="sq-title" id="sq-title"></h2>
      <p id="sq-phrase"></p>
    </div>
  </div>

  <div class="sq-cta-wrap">
    <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
      Découvrir
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>
  </div>

  ${renderKeystoneFoot()}
</div>

${renderAiFetchScript(safeShort)}
<script>
(() => {
  const TARGET_ISO = ${JSON.stringify(targetIso)};
  const targetMs   = TARGET_ISO ? new Date(TARGET_ISO).getTime() : NaN;

  const el = id => document.getElementById(id);
  const wrap = el('sq-countdown-wrap');
  const live = el('sq-live-msg');
  const urg  = el('sq-urgency');
  const cdD = el('cd-d'), cdH = el('cd-h'), cdM = el('cd-m'), cdS = el('cd-s');

  function pad(n) { return String(Math.max(0, n)).padStart(2, '0'); }

  let isLive = false;

  function updateUrgencyBadge(remMs, days) {
    if (!urg) return;
    if (isLive) { urg.textContent = 'C\\'est ouvert ✦'; return; }
    if (remMs < 3600e3)  { urg.textContent = 'Dernière heure'; return; }
    if (remMs < 86400e3) { urg.textContent = 'Dernières heures'; return; }
    if (days === 1)      { urg.textContent = 'Demain'; return; }
    if (days <= 7)       { urg.textContent = 'J-' + days; return; }
    urg.textContent = 'Bientôt';
  }

  function tickValue(node, newVal) {
    if (!node) return;
    if (node.textContent === newVal) return;
    node.textContent = newVal;
    node.classList.remove('sq-cd-tick');
    void node.offsetWidth; // force reflow pour relancer l'anim
    node.classList.add('sq-cd-tick');
  }

  function applyUrgencyClass(remMs) {
    document.body.classList.remove('is-soon', 'is-now', 'is-live');
    if (isLive)              document.body.classList.add('is-live');
    else if (remMs < 3600e3) document.body.classList.add('is-now');
    else if (remMs < 86400e3) document.body.classList.add('is-soon');
  }

  function refresh() {
    if (!Number.isFinite(targetMs)) {
      if (wrap) wrap.hidden = true;
      if (live) live.hidden = false;
      isLive = true;
      applyUrgencyClass(0);
      updateUrgencyBadge(0, 0);
      return;
    }
    const remMs = targetMs - Date.now();
    if (remMs <= 0) {
      if (!isLive) {
        isLive = true;
        if (wrap) wrap.hidden = true;
        if (live) live.hidden = false;
        applyUrgencyClass(0);
        updateUrgencyBadge(0, 0);
      }
      return;
    }
    const totalSec = Math.floor(remMs / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    tickValue(cdD, pad(d));
    tickValue(cdH, pad(h));
    tickValue(cdM, pad(m));
    tickValue(cdS, pad(s));
    applyUrgencyClass(remMs);
    updateUrgencyBadge(remMs, d);
  }

  refresh();
  setInterval(refresh, 1000);

  // Reveal IA = max(T+5s, réponse IA). Le countdown reste l'élément
  // hero ; la phrase IA arrive en second plan d'anticipation.
  const MIN_REVEAL_MS = 5000;
  const t0 = Date.now();

  function reveal(detail) {
    const elapsed = Date.now() - t0;
    const wait    = Math.max(0, MIN_REVEAL_MS - elapsed);
    setTimeout(() => {
      const loading = document.getElementById('sq-loading');
      const final   = document.getElementById('sq-final');
      const title   = document.getElementById('sq-title');
      const phrase  = document.getElementById('sq-phrase');
      if (title)  title.textContent  = detail.title  || (isLive ? 'C\\'est parti' : 'Bientôt');
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
