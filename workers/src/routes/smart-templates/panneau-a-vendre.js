// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · panneau-a-vendre (V2 Famille Immobilier)
// ───────────────────────────────────────────────────────────────────
// Pour les QR posés physiquement sur les panneaux "À VENDRE" devant
// les biens. Affiche immédiatement (T+0) une fiche bien complète
// (image, titre, prix, surface, points forts), puis l'IA enrichit
// avec une phrase contextuelle "Ce bien à 200m du port libéré il y
// a 2 semaines vous attend ce dimanche après-midi".
//
// Le CTA "Voir l'annonce complète" mène à la cible du QR (annonce
// SeLoger / annonce site agence / etc.).
// ══════════════════════════════════════════════════════════════════

function _esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const TEMPLATE = {
  id:              'panneau-a-vendre',
  label:           'Panneau À vendre',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    if (!template_data?.titre_bien?.trim()) errors.push('titre_bien requis');
    if (!template_data?.prix?.trim())       errors.push('prix requis');
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const td = qrData?.template_data || {};
    const now      = new Date();
    const hourFr   = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });
    const dayFr    = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS pour un panneau immobilier "À vendre".',
      'Le scanneur vient probablement de voir le bien physiquement (passant devant le panneau).',
      'Tu génères UNE phrase courte (max 20 mots) qui personnalise son arrivée AVANT qu\'il voie l\'annonce complète.',
      '',
      'Règles strictes :',
      '- Une seule phrase, max 20 mots, française',
      '- Ton chaleureux et confidentiel (comme un agent qui glisse une info à l\'oreille), jamais commercial agressif',
      '- Mentionne UN signal contextuel pertinent (moment de la journée, jour de la semaine, brief métier de l\'agent, caractéristique distinctive du bien)',
      '- Ne mens jamais sur le bien (ne pas inventer de caractéristiques)',
      '- Pas de "Bonjour", pas de CTA — un bouton "Voir l\'annonce" s\'affichera automatiquement',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
      '  - phrase = la phrase contextuelle (20 mots max)',
      '  - title  = 2-4 mots punchy (ex: "Coup de cœur", "Encore disponible", "À 5 min à pied")',
    ].join('\n');

    const user = [
      'Bien à vendre :',
      `- Titre : ${td.titre_bien || '(à compléter)'}`,
      `- Prix : ${td.prix || '(à compléter)'}`,
      td.surface       ? `- Surface : ${td.surface}`               : null,
      td.dpe           ? `- DPE : ${td.dpe}`                       : null,
      td.points_forts  ? `- Points forts : ${td.points_forts.slice(0, 600)}` : null,
      '',
      qrData?.metier_brief ? `Contexte de l\'agent : ${qrData.metier_brief.slice(0, 600)}` : null,
      '',
      'Contexte du scan :',
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
    const td = qrData?.template_data || {};
    const titre  = _esc(td.titre_bien || 'Bien à vendre');
    const prix   = _esc(td.prix || '');
    const surf   = _esc(td.surface || '');
    const dpe    = _esc(td.dpe || '');
    const pf     = _esc(td.points_forts || '');
    const cover  = _esc(td.cover_url || '');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${titre} · Keystone Smart QR</title>
<style>
  :root { --bg:#0a0e14; --card:#111720; --bd:#1f2a37; --tx:#f1f5f9; --mut:#94a3b8; --acc:#7c8af9; --gold:#c9a96e; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--tx);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.02em; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 18px; }
  .sq-card { max-width: 460px; width: 100%; background: var(--card);
    border: 1px solid var(--bd); border-radius: 18px; overflow: hidden;
    box-shadow: 0 32px 64px rgba(0,0,0,.45);
    animation: zoom-in 420ms cubic-bezier(.16,.84,.3,1); }
  @keyframes zoom-in { from { opacity:0; transform: scale(.96) translateY(8px); } to { opacity:1; transform: scale(1) translateY(0); } }

  .sq-brand-bar { padding: 14px 22px 0; font-size: 10.5px; letter-spacing: .22em;
    color: var(--gold); text-transform: uppercase; font-weight: 600; }

  .sq-cover { width: 100%; aspect-ratio: 16/10; background: #0f1620 center/cover no-repeat;
    margin-top: 12px; position: relative; }
  .sq-cover.empty { background: linear-gradient(135deg, rgba(124,138,249,.10), rgba(201,169,110,.10));
    display: flex; align-items: center; justify-content: center; color: var(--mut); font-size: 12px; }
  .sq-cover-overlay { position: absolute; inset: 0;
    background: linear-gradient(to bottom, transparent 50%, rgba(10,14,20,.5) 100%); }

  .sq-body { padding: 18px 22px 22px; }
  .sq-titre { font-size: 22px; font-weight: 700; letter-spacing: -.025em;
    margin: 0 0 6px; line-height: 1.2; }
  .sq-prix { font-size: 26px; font-weight: 700; color: var(--gold);
    letter-spacing: -.02em; margin: 0 0 14px; }
  .sq-meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
  .sq-chip { font-size: 11.5px; color: var(--mut); background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08); border-radius: 999px; padding: 4px 10px; }
  .sq-chip.dpe { color: var(--gold); border-color: rgba(201,169,110,.4); }
  .sq-pf { font-size: 13px; color: var(--mut); line-height: 1.55;
    margin: 0 0 18px; white-space: pre-line; }

  .sq-ia { padding: 14px 16px; border-radius: 10px;
    background: linear-gradient(135deg, rgba(201,169,110,.08), rgba(124,138,249,.10));
    border: 1px solid rgba(201,169,110,.22); margin-bottom: 18px;
    transition: opacity .42s ease; }
  .sq-ia-loading .sq-skel { height: 12px; margin: 6px 0;
    border-radius: 4px; background: linear-gradient(90deg,
      rgba(148,163,184,.08), rgba(148,163,184,.22), rgba(148,163,184,.08));
    background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
  .sq-ia-loading .sq-skel.w90 { width: 90%; } .sq-ia-loading .sq-skel.w70 { width: 70%; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  .sq-ia-hint { font-size: 11px; color: var(--mut); opacity: .7;
    font-style: italic; margin-top: 8px; }
  .sq-ia-hint::before { content: "✦"; color: var(--gold); margin-right: 5px;
    opacity: .8; font-style: normal; animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
  .sq-ia-title { font-size: 13px; font-weight: 700; color: var(--gold);
    letter-spacing: -.01em; margin: 0 0 4px; opacity: 0; animation: fade-up .5s cubic-bezier(.16,.84,.3,1) both; }
  .sq-ia-phrase { font-size: 13.5px; color: var(--tx); line-height: 1.5; margin: 0;
    opacity: 0; animation: fade-up .5s cubic-bezier(.16,.84,.3,1) .08s both; }
  @keyframes fade-up { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  .sq-cta { display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 14px 24px; border-radius: 12px; border: 0;
    background: var(--acc); color: #fff; font-size: 15px; font-weight: 600;
    text-decoration: none; cursor: pointer;
    box-shadow: 0 8px 24px rgba(124,138,249,.32);
    transition: transform .14s ease, box-shadow .14s ease; }
  .sq-cta:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(124,138,249,.4); }
  .sq-cta:active { transform: scale(.98); }

  .sq-foot { margin-top: 14px; text-align: center; color: #64748b; font-size: 10.5px; line-height: 1.5; }
  .sq-foot a { color: var(--mut); text-decoration: none; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="sq-card" role="article">
  <div class="sq-brand-bar">Keystone Smart QR</div>
  ${cover
    ? `<div class="sq-cover" style="background-image:url('${cover}')"><div class="sq-cover-overlay"></div></div>`
    : `<div class="sq-cover empty">Aperçu du bien</div>`
  }
  <div class="sq-body">
    <h1 class="sq-titre">${titre}</h1>
    ${prix ? `<div class="sq-prix">${prix}</div>` : ''}
    ${(surf || dpe) ? `<div class="sq-meta">
      ${surf ? `<span class="sq-chip">${surf}</span>` : ''}
      ${dpe  ? `<span class="sq-chip dpe">DPE ${dpe}</span>` : ''}
    </div>` : ''}
    ${pf ? `<p class="sq-pf">${pf}</p>` : ''}

    <div class="sq-ia" id="sq-ia">
      <div id="sq-ia-loading" class="sq-ia-loading">
        <div class="sq-skel w90"></div>
        <div class="sq-skel w70"></div>
        <p class="sq-ia-hint">L'IA personnalise votre arrivée…</p>
      </div>
      <div id="sq-ia-ready" hidden>
        <h2 class="sq-ia-title" id="sq-title"></h2>
        <p class="sq-ia-phrase" id="sq-phrase"></p>
      </div>
    </div>

    <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
      Voir l'annonce complète
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>

    <p class="sq-foot">Contenu généré contextuellement par Keystone · <a href="/sdqr-privacy">Vie privée</a></p>
  </div>
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
    // Fail-safe : masque le bloc IA — l'utilisateur a déjà le bien sous les yeux
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
