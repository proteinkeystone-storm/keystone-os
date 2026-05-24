// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · evenement-special (V3 Restauration)
// ───────────────────────────────────────────────────────────────────
// QR pour événement spécial restaurant : chef invité, soirée à thème,
// dégustation, etc. Affiche thème + date + heure + prix éventuel + IA
// qui crée l'envie selon le contexte du scan.
// ══════════════════════════════════════════════════════════════════

function _esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const TEMPLATE = {
  id:              'evenement-special',
  label:           'Événement spécial',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_evenement?.trim()) errors.push('nom_evenement requis');
    if (!template_data?.date_evenement?.trim()) errors.push('date_evenement requis');
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const td = qrData?.template_data || {};
    const now    = new Date();
    const hourFr = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });
    const dayFr  = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS pour un événement spécial dans un restaurant.',
      'Tu génères UNE phrase courte (max 20 mots) qui crée l\'envie et l\'urgence sans agresser.',
      '',
      'Règles strictes :',
      '- Une seule phrase, max 20 mots, française',
      '- Ton chaleureux et "private invitation"',
      '- Mentionne UN signal pertinent (proximité de la date, jour, thème)',
      '- Pas de "Bonjour", pas de CTA explicite',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
      '  - title = 2-4 mots évocateurs (ex: "Encore 3 places", "Bientôt complet", "Exclusivité")',
    ].join('\n');

    const user = [
      'Événement :',
      `- Nom : ${td.nom_evenement || '(à compléter)'}`,
      `- Date : ${td.date_evenement || ''}`,
      td.heure        ? `- Heure : ${td.heure}` : null,
      td.theme        ? `- Thème : ${td.theme}` : null,
      td.prix         ? `- Prix : ${td.prix}` : null,
      td.description  ? `- Description : ${td.description.slice(0, 500)}` : null,
      td.places_restantes ? `- Places restantes : ${td.places_restantes}` : null,
      '',
      qrData?.metier_brief ? `Contexte du chef : ${qrData.metier_brief.slice(0, 500)}` : null,
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
    const nom         = _esc(td.nom_evenement || 'Soirée');
    const date        = _esc(td.date_evenement || '');
    const heure       = _esc(td.heure || '');
    const theme       = _esc(td.theme || '');
    const prix        = _esc(td.prix || '');
    const description = _esc(td.description || '');
    const places      = _esc(td.places_restantes || '');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nom} · Événement</title>
<style>
  :root { --bg:#0a0e14; --card:#111720; --bd:#1f2a37; --tx:#f1f5f9; --mut:#94a3b8; --acc:#7c8af9; --gold:#c9a96e; }
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

  .sq-event-tag { display: inline-block; padding: 4px 12px;
    background: linear-gradient(135deg, rgba(201,169,110,.18), rgba(124,138,249,.18));
    border: 1px solid rgba(201,169,110,.4); border-radius: 999px;
    font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--gold); font-weight: 600; margin: 0 0 10px; }
  .sq-tags-wrap { text-align: center; }

  .sq-nom { font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 28px; font-weight: 700; text-align: center; margin: 0 0 12px;
    letter-spacing: -.02em; line-height: 1.15; }
  .sq-date-row { display: flex; align-items: center; justify-content: center;
    gap: 14px; margin: 0 0 16px; flex-wrap: wrap; }
  .sq-date-chip { display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; background: rgba(124,138,249,.10);
    border: 1px solid rgba(124,138,249,.3); border-radius: 10px;
    font-size: 13.5px; color: var(--tx); }
  .sq-date-chip svg { width: 14px; height: 14px; color: var(--acc); }
  .sq-theme { font-size: 13px; color: var(--mut); text-align: center;
    font-style: italic; margin: 0 0 16px; }

  .sq-desc { padding: 14px 16px; border-radius: 10px;
    background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06);
    font-size: 13.5px; color: var(--tx); line-height: 1.55;
    margin: 0 0 14px; }

  .sq-meta-bar { display: flex; justify-content: space-between; gap: 10px;
    margin: 0 0 18px; }
  .sq-meta-chip { flex: 1; padding: 10px 12px; border-radius: 8px;
    background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06);
    text-align: center; }
  .sq-meta-chip-lbl { font-size: 9.5px; color: var(--mut); letter-spacing: .12em;
    text-transform: uppercase; margin: 0 0 4px; }
  .sq-meta-chip-val { font-size: 16px; font-weight: 700; color: var(--gold); }
  .sq-meta-chip.places .sq-meta-chip-val { color: #ef4444; }

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
  .sq-ia-hint::before { content: "✦"; color: var(--gold); margin-right: 5px;
    opacity: .8; font-style: normal; animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
  .sq-ia-title { font-size: 13px; font-weight: 700; color: var(--gold);
    margin: 0 0 4px; opacity: 0; animation: fade-up .5s cubic-bezier(.16,.84,.3,1) both; }
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
  <div class="sq-brand">Keystone Smart QR</div>
  <div class="sq-tags-wrap"><span class="sq-event-tag">Événement spécial</span></div>
  <h1 class="sq-nom">${nom}</h1>
  <div class="sq-date-row">
    <span class="sq-date-chip">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      ${date}
    </span>
    ${heure ? `<span class="sq-date-chip">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ${heure}
    </span>` : ''}
  </div>
  ${theme ? `<p class="sq-theme">${theme}</p>` : ''}
  ${description ? `<div class="sq-desc">${description}</div>` : ''}
  ${(prix || places) ? `<div class="sq-meta-bar">
    ${prix   ? `<div class="sq-meta-chip"><div class="sq-meta-chip-lbl">Tarif</div><div class="sq-meta-chip-val">${prix}</div></div>` : ''}
    ${places ? `<div class="sq-meta-chip places"><div class="sq-meta-chip-lbl">Places restantes</div><div class="sq-meta-chip-val">${places}</div></div>` : ''}
  </div>` : ''}

  <div class="sq-ia" id="sq-ia">
    <div id="sq-ia-loading" class="sq-ia-loading">
      <div class="sq-skel w90"></div>
      <div class="sq-skel w70"></div>
      <p class="sq-ia-hint">Votre invitation personnalisée arrive…</p>
    </div>
    <div id="sq-ia-ready" hidden>
      <h2 class="sq-ia-title" id="sq-title"></h2>
      <p class="sq-ia-phrase" id="sq-phrase"></p>
    </div>
  </div>

  <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
    Réserver ma place
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
