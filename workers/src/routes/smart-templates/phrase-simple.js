// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · phrase-simple (V1 polish)
// ───────────────────────────────────────────────────────────────────
// Le template historique : 1 phrase IA courte + titre court, affichés
// dans une carte centrée Apple Premium. Bouton "Continuer" sous la
// phrase. Extrait de qr.js lors du refactor V1 (2026-05-24).
//
// V1 polish :
//   • Skeleton shimmer (vs spinner sec) pendant la génération
//   • Microcopy d'attente plus vivant ("L'IA personnalise votre accès…")
//   • Fallback final repensé ("Votre destination est prête.")
//   • Animation d'entrée plus douce (cubic-bezier(.16,.84,.3,1))
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'phrase-simple',
  label:           'Phrase simple',
  tier_required:   'starter',
  ai_max_tokens:   4096,

  validate(template_data) {
    // Aucun champ obligatoire — le brief métier est porté par
    // qrData.metier_brief (champ historique, partagé entre templates).
    return [];
  },

  buildAiPrompt(qrData, scanCtx) {
    const now      = new Date();
    const hourFr   = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });
    const dayFr    = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    const targetSnippet = (scanCtx?.target_url || qrData?.payload?.url || '')
      .toString().slice(0, 200);

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS. Quand un utilisateur scanne un QR Code,',
      'tu génères UNE phrase courte (max 18 mots) de contexte personnalisée AVANT la redirection.',
      '',
      'Règles strictes :',
      '- Une seule phrase, max 18 mots',
      '- Ton chaleureux, naturel, jamais commercial agressif',
      '- Mentionne au moins UN signal contextuel (heure, jour, pays, device, brief métier)',
      '- Ne mens jamais, ne donne pas d\'horaires/coordonnées que tu n\'as pas',
      '- Termine sans CTA — un bouton "Continuer" s\'affichera automatiquement',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
      '  - phrase = la phrase contextuelle',
      '  - title  = 3-5 mots punchy (ex: "Bienvenue !", "À 2 min de chez vous", "Bonsoir")',
    ].join('\n');

    const user = [
      `Type de QR : ${qrData?.qr_type || 'url'}`,
      `Nom du QR : ${qrData?.name || '(sans nom)'}`,
      targetSnippet ? `URL/cible : ${targetSnippet}` : null,
      qrData?.metier_brief ? `Brief métier du propriétaire : ${qrData.metier_brief.slice(0, 800)}` : null,
      '',
      'Contexte du scan en cours :',
      `- Jour : ${dayFr}`,
      `- Heure (Paris) : ${hourFr}h`,
      `- Pays scanné : ${scanCtx?.country || '?'}`,
      `- Device : ${scanCtx?.device || '?'}`,
      '',
      'Génère le JSON {"phrase","title"} maintenant.',
    ].filter(Boolean).join('\n');

    return { system, user };
  },

  renderHTML(qrData, scanCtx) {
    const safeShort = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const safeName  = (qrData?.name || '').toString().replace(/[<>&"']/g, '').slice(0, 80);

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Smart QR · ${safeName || 'Keystone'}</title>
<style>
  :root { --bg:#0a0e14; --card:#111720; --bd:#1f2a37; --tx:#f1f5f9; --mut:#94a3b8; --acc:#7c8af9; --gold:#c9a96e; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--tx);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.02em; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px; }
  .sq-card { max-width: 460px; width: 100%; background: var(--card);
    border: 1px solid var(--bd); border-radius: 18px; padding: 36px 28px 28px;
    text-align: center; box-shadow: 0 32px 64px rgba(0,0,0,.45);
    animation: zoom-in 420ms cubic-bezier(.16,.84,.3,1); }
  @keyframes zoom-in { from { opacity:0; transform: scale(.96) translateY(8px); } to { opacity:1; transform: scale(1) translateY(0); } }
  .sq-brand { font-size: 11px; letter-spacing: .22em; color: var(--gold);
    text-transform: uppercase; margin-bottom: 22px; font-weight: 600; }

  /* État loading — skeleton shimmer (V1 polish) */
  .sq-skeleton-title { height: 24px; width: 60%; margin: 8px auto 14px;
    border-radius: 6px; background: linear-gradient(90deg,
      rgba(124,138,249,.10) 0%, rgba(124,138,249,.28) 50%, rgba(124,138,249,.10) 100%);
    background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
  .sq-skeleton-line { height: 14px; margin: 8px auto;
    border-radius: 4px; background: linear-gradient(90deg,
      rgba(148,163,184,.08) 0%, rgba(148,163,184,.22) 50%, rgba(148,163,184,.08) 100%);
    background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
  .sq-skeleton-line.w90 { width: 90%; }
  .sq-skeleton-line.w70 { width: 70%; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  .sq-hint { margin-top: 18px; font-size: 12px; color: var(--mut);
    opacity: .7; letter-spacing: 0; font-style: italic; }
  .sq-hint::before { content: "✦"; color: var(--gold); margin-right: 6px;
    opacity: .8; font-style: normal; display: inline-block; animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }

  /* État ready — phrase IA */
  .sq-state { transition: opacity .42s ease; }
  .sq-title { font-size: 24px; font-weight: 700; margin: 0 0 14px;
    letter-spacing: -.025em; line-height: 1.15;
    animation: fade-up .5s cubic-bezier(.16,.84,.3,1); }
  .sq-phrase { color: var(--mut); font-size: 15.5px; line-height: 1.55;
    margin: 0 0 28px; animation: fade-up .5s cubic-bezier(.16,.84,.3,1) .08s both; }
  @keyframes fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .sq-cta { display: inline-flex; align-items: center; gap: 8px;
    padding: 14px 28px; border-radius: 12px; border: 0;
    background: var(--acc); color: #fff; font-size: 15px; font-weight: 600;
    text-decoration: none; cursor: pointer;
    box-shadow: 0 8px 24px rgba(124,138,249,.32);
    transition: transform .14s ease, box-shadow .14s ease;
    animation: fade-up .5s cubic-bezier(.16,.84,.3,1) .16s both; }
  .sq-cta:hover { transform: translateY(-1px);
    box-shadow: 0 12px 28px rgba(124,138,249,.4); }
  .sq-cta:active { transform: scale(.98); }
  .sq-foot { margin-top: 28px; color: #64748b; font-size: 11px; line-height: 1.5; }
  .sq-foot a { color: var(--mut); text-decoration: none; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="sq-card" role="status" aria-live="polite">
  <div class="sq-brand">Keystone Smart QR</div>

  <div id="sq-loading" class="sq-state">
    <div class="sq-skeleton-title" aria-hidden="true"></div>
    <div class="sq-skeleton-line w90" aria-hidden="true"></div>
    <div class="sq-skeleton-line w70" aria-hidden="true"></div>
    <p class="sq-hint">L'IA personnalise votre accès…</p>
  </div>

  <div id="sq-ready" class="sq-state" hidden>
    <h1 class="sq-title" id="sq-title"></h1>
    <p class="sq-phrase" id="sq-phrase"></p>
    <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
      Continuer
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>
  </div>

  <div id="sq-error" class="sq-state" hidden>
    <h1 class="sq-title">Votre destination est prête</h1>
    <p class="sq-phrase">Merci d'avoir scanné. Continuons.</p>
    <a class="sq-cta" href="/r/${safeShort}?direct=1">
      Continuer
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>
  </div>

  <p class="sq-foot">Contenu généré contextuellement par Keystone · <a href="/sdqr-privacy">Vie privée</a></p>
</div>
<script>
(async () => {
  const $ = id => document.getElementById(id);
  function show(name) {
    ['loading','ready','error'].forEach(s => $('sq-' + s).hidden = (s !== name));
  }
  try {
    const r = await fetch('/api/smartqr/generate-interstitial', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ short_id: '${safeShort}' }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    $('sq-title').textContent  = data.title  || 'Bienvenue';
    $('sq-phrase').textContent = data.phrase || '';
    show('ready');
  } catch (e) {
    console.warn('[smart-qr]', e);
    // Fail-safe : passe directement à l'écran "Continuer" sans IA
    show('error');
  }
})();
</script>
</body>
</html>`;
  },
};

export default TEMPLATE;
