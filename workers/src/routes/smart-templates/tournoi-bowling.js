// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · tournoi-bowling (V3 Famille Loisirs)
// ───────────────────────────────────────────────────────────────────
// QR pour bowling/escape game/karting/etc. Affiche un tournoi en
// cours avec compteur de joueurs inscrits + jackpot + IA qui pousse
// à s'inscrire selon le contexte (places restantes, jour, heure).
//
// V3 : le compteur est statique (saisi par le proprio). V4 ajoutera
// le live data D1 (counter incrémenté à chaque inscription).
// ══════════════════════════════════════════════════════════════════

function _esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const TEMPLATE = {
  id:              'tournoi-bowling',
  label:           'Tournoi / compétition',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('nom_etablissement requis');
    if (!template_data?.nom_tournoi?.trim())       errors.push('nom_tournoi requis');
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const td = qrData?.template_data || {};
    const now    = new Date();
    const hourFr = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });
    const dayFr  = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS pour un tournoi/compétition de loisirs',
      '(bowling, billard, escape game, karting, paintball, etc.).',
      'Tu génères UNE phrase courte (max 20 mots) qui pousse à s\'inscrire ou à venir.',
      '',
      'Règles strictes :',
      '- Une seule phrase, max 20 mots, française',
      '- Ton enthousiaste mais pas sportif-bourrin, fun et accessible',
      '- Mentionne UN signal contextuel pertinent (places restantes, jour, jackpot)',
      '- Pas de "Bonjour", pas de CTA explicite',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
      '  - title = 2-4 mots punchy (ex: "Dernières places", "Jackpot en vue", "Ce soir !")',
    ].join('\n');

    const user = [
      'Tournoi :',
      `- Établissement : ${td.nom_etablissement || '(à compléter)'}`,
      `- Nom du tournoi : ${td.nom_tournoi || ''}`,
      td.activite          ? `- Activité : ${td.activite}` : null,
      td.jackpot           ? `- Récompense : ${td.jackpot}` : null,
      td.places_initiales  ? `- Places initiales : ${td.places_initiales}` : null,
      td.joueurs_inscrits  ? `- Joueurs déjà inscrits : ${td.joueurs_inscrits}` : null,
      td.date_finale       ? `- Date finale : ${td.date_finale}` : null,
      td.prix_inscription  ? `- Prix inscription : ${td.prix_inscription}` : null,
      '',
      qrData?.metier_brief ? `Contexte du lieu : ${qrData.metier_brief.slice(0, 400)}` : null,
      '',
      'Contexte du scan :',
      `- Jour : ${dayFr}`,
      `- Heure (Paris) : ${hourFr}h`,
      '',
      'Génère le JSON {"phrase","title"} maintenant.',
    ].filter(Boolean).join('\n');

    return { system, user };
  },

  renderHTML(qrData, scanCtx) {
    const safeShort = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const td = qrData?.template_data || {};
    const nom         = _esc(td.nom_etablissement || 'Bowling');
    const tournoi     = _esc(td.nom_tournoi || 'Tournoi');
    const activite    = _esc(td.activite || '');
    const jackpot     = _esc(td.jackpot || '');
    const placesInit  = parseInt(td.places_initiales) || 0;
    const inscrits    = parseInt(td.joueurs_inscrits) || 0;
    const restantes   = placesInit - inscrits;
    const dateFinale  = _esc(td.date_finale || '');
    const prix        = _esc(td.prix_inscription || '');
    const progress    = placesInit > 0 ? Math.min(100, Math.round((inscrits / placesInit) * 100)) : 0;

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${tournoi} · ${nom}</title>
<style>
  :root { --bg:#0a0e14; --card:#111720; --bd:#1f2a37; --tx:#f1f5f9; --mut:#94a3b8; --acc:#7c8af9; --gold:#c9a96e; --fire:#f97316; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--tx);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.02em; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 18px; }
  .sq-card { max-width: 460px; width: 100%; background: var(--card);
    border: 1px solid var(--bd); border-radius: 18px; padding: 26px 24px 22px;
    box-shadow: 0 32px 64px rgba(0,0,0,.45);
    animation: zoom-in 420ms cubic-bezier(.16,.84,.3,1); }
  @keyframes zoom-in { from { opacity:0; transform: scale(.96) translateY(8px); } to { opacity:1; transform: scale(1) translateY(0); } }

  .sq-brand { font-size: 10.5px; letter-spacing: .22em; color: var(--gold);
    text-transform: uppercase; font-weight: 600; margin-bottom: 14px; text-align: center; }

  .sq-trophy { width: 64px; height: 64px; margin: 0 auto 12px;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at center, rgba(249,115,22,.35), rgba(201,169,110,.20));
    border-radius: 50%; border: 1.5px solid rgba(249,115,22,.5);
    animation: pulse-glow 2.4s ease-in-out infinite; }
  .sq-trophy svg { width: 32px; height: 32px; color: var(--gold); }
  @keyframes pulse-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(249,115,22,.4); } 50% { box-shadow: 0 0 0 12px rgba(249,115,22,0); } }

  .sq-nom { font-size: 12px; color: var(--mut); text-align: center;
    margin: 0 0 4px; text-transform: uppercase; letter-spacing: .12em; }
  .sq-tournoi { font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 28px; font-weight: 700; text-align: center; margin: 0 0 6px;
    letter-spacing: -.02em; line-height: 1.15; }
  .sq-activite { font-size: 13px; color: var(--mut); text-align: center;
    margin: 0 0 18px; font-style: italic; }

  ${jackpot ? `
  .sq-jackpot { padding: 14px 16px; border-radius: 10px;
    background: linear-gradient(135deg, rgba(249,115,22,.12), rgba(201,169,110,.10));
    border: 1px solid rgba(249,115,22,.3); margin: 0 0 14px; text-align: center; }
  .sq-jackpot-lbl { font-size: 10px; letter-spacing: .15em; text-transform: uppercase;
    color: var(--mut); margin: 0 0 4px; }
  .sq-jackpot-val { font-size: 20px; font-weight: 700; color: var(--gold); }
  ` : ''}

  ${placesInit > 0 ? `
  .sq-progress-wrap { margin: 0 0 14px; }
  .sq-progress-info { display: flex; justify-content: space-between;
    font-size: 12px; color: var(--mut); margin: 0 0 6px; }
  .sq-progress-bar { height: 8px; border-radius: 999px;
    background: rgba(255,255,255,.06); overflow: hidden; }
  .sq-progress-fill { height: 100%; background: linear-gradient(90deg, var(--fire), var(--gold));
    transition: width .6s cubic-bezier(.16,.84,.3,1); }
  .sq-restantes { text-align: center; font-size: 12px; color: var(--fire);
    font-weight: 600; margin-top: 6px; letter-spacing: .04em; }
  ` : ''}

  .sq-info-row { display: flex; gap: 10px; margin: 0 0 18px; }
  .sq-info-chip { flex: 1; padding: 10px; border-radius: 8px;
    background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06);
    text-align: center; }
  .sq-info-chip-lbl { font-size: 9.5px; color: var(--mut); letter-spacing: .12em;
    text-transform: uppercase; margin: 0 0 4px; }
  .sq-info-chip-val { font-size: 14px; font-weight: 700; color: var(--tx); }

  .sq-ia { padding: 14px 16px; border-radius: 10px;
    background: linear-gradient(135deg, rgba(201,169,110,.08), rgba(124,138,249,.10));
    border: 1px solid rgba(201,169,110,.22); margin-bottom: 18px; }
  .sq-ia-loading .sq-skel { height: 12px; margin: 6px 0;
    border-radius: 4px; background: linear-gradient(90deg,
      rgba(148,163,184,.08), rgba(148,163,184,.22), rgba(148,163,184,.08));
    background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
  .sq-ia-loading .sq-skel.w90 { width: 90%; } .sq-ia-loading .sq-skel.w70 { width: 70%; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  .sq-ia-hint { font-size: 11px; color: var(--mut); opacity: .7;
    font-style: italic; margin-top: 8px; }
  .sq-ia-hint::before { content: "🎳"; margin-right: 5px;
    opacity: .8; font-style: normal; }
  .sq-ia-title { font-size: 13px; font-weight: 700; color: var(--gold);
    margin: 0 0 4px; opacity: 0; animation: fade-up .5s cubic-bezier(.16,.84,.3,1) both; }
  .sq-ia-phrase { font-size: 13.5px; color: var(--tx); line-height: 1.5; margin: 0;
    opacity: 0; animation: fade-up .5s cubic-bezier(.16,.84,.3,1) .08s both; }
  @keyframes fade-up { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  .sq-cta { display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 14px 24px; border-radius: 12px; border: 0;
    background: linear-gradient(135deg, var(--fire), var(--gold));
    color: #fff; font-size: 15px; font-weight: 700;
    text-decoration: none; cursor: pointer;
    box-shadow: 0 8px 24px rgba(249,115,22,.32);
    transition: transform .14s ease, box-shadow .14s ease;
    text-transform: uppercase; letter-spacing: .05em; }
  .sq-cta:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(249,115,22,.45); }
  .sq-cta:active { transform: scale(.98); }
  .sq-foot { margin-top: 14px; text-align: center; color: #64748b; font-size: 10.5px; line-height: 1.5; }
  .sq-foot a { color: var(--mut); text-decoration: none; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="sq-card" role="article">
  <div class="sq-brand">Keystone Smart QR</div>
  <div class="sq-trophy" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
  </div>
  <p class="sq-nom">${nom}</p>
  <h1 class="sq-tournoi">${tournoi}</h1>
  ${activite ? `<p class="sq-activite">${activite}</p>` : ''}

  ${jackpot ? `<div class="sq-jackpot">
    <div class="sq-jackpot-lbl">À gagner</div>
    <div class="sq-jackpot-val">${jackpot}</div>
  </div>` : ''}

  ${placesInit > 0 ? `<div class="sq-progress-wrap">
    <div class="sq-progress-info">
      <span>${inscrits} inscrits / ${placesInit}</span>
      <span>${progress}%</span>
    </div>
    <div class="sq-progress-bar"><div class="sq-progress-fill" style="width:${progress}%"></div></div>
    ${restantes > 0 ? `<div class="sq-restantes">Plus que ${restantes} place${restantes > 1 ? 's' : ''} !</div>` : ''}
  </div>` : ''}

  ${(dateFinale || prix) ? `<div class="sq-info-row">
    ${dateFinale ? `<div class="sq-info-chip"><div class="sq-info-chip-lbl">Finale</div><div class="sq-info-chip-val">${dateFinale}</div></div>` : ''}
    ${prix       ? `<div class="sq-info-chip"><div class="sq-info-chip-lbl">Inscription</div><div class="sq-info-chip-val">${prix}</div></div>` : ''}
  </div>` : ''}

  <div class="sq-ia" id="sq-ia">
    <div id="sq-ia-loading" class="sq-ia-loading">
      <div class="sq-skel w90"></div>
      <div class="sq-skel w70"></div>
      <p class="sq-ia-hint">La table prépare votre invitation…</p>
    </div>
    <div id="sq-ia-ready" hidden>
      <h2 class="sq-ia-title" id="sq-title"></h2>
      <p class="sq-ia-phrase" id="sq-phrase"></p>
    </div>
  </div>

  <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
    Je m'inscris
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
  </a>

  <p class="sq-foot">Contenu généré contextuellement par Keystone · <a href="/sdqr-privacy">Vie privée</a></p>
</div>
<script>
(async () => {
  try {
    const r = await fetch('/api/smartqr/generate-interstitial', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ short_id: '${safeShort}' }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    document.getElementById('sq-title').textContent  = data.title  || '';
    document.getElementById('sq-phrase').textContent = data.phrase || '';
    document.getElementById('sq-ia-loading').hidden = true;
    document.getElementById('sq-ia-ready').hidden = false;
  } catch (e) {
    console.warn('[smart-qr]', e);
    const ia = document.getElementById('sq-ia');
    if (ia) ia.style.display = 'none';
  }
})();
</script>
</body>
</html>`;
  },
};

export default TEMPLATE;
