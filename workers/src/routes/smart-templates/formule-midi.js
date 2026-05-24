// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · formule-midi (V3 Famille Restauration)
// ───────────────────────────────────────────────────────────────────
// QR pour formule du midi : affiche entrée/plat/dessert + prix +
// countdown jusqu'à la fin de service. Phrase IA pousse à venir vite.
// ══════════════════════════════════════════════════════════════════

function _esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const TEMPLATE = {
  id:              'formule-midi',
  label:           'Formule midi',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('nom_etablissement requis');
    if (!template_data?.formule_titre?.trim())     errors.push('formule_titre requis');
    if (!template_data?.prix?.trim())              errors.push('prix requis');
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const td = qrData?.template_data || {};
    const now    = new Date();
    const hourFr = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });
    const hourNum = now.getHours();
    const dayFr  = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS pour la formule midi d\'un restaurant.',
      'Tu génères UNE phrase courte (max 18 mots) qui invite à venir maintenant ou à réserver.',
      'Adapte le ton à l\'heure : avant 11h45 = invitation calme, 11h45-13h = urgence douce,',
      'après 14h = invitation pour demain.',
      '',
      'Règles strictes :',
      '- Une seule phrase, max 18 mots, française',
      '- Ton chaleureux, jamais agressif commercial',
      '- Pas de "Bonjour", pas de CTA explicite',
      '- Adapte selon l\'heure du scan',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
      '  - title = 2-4 mots (ex: "Encore une heure", "Demain midi", "Vite, dernier service")',
    ].join('\n');

    const moment = hourNum < 11 ? 'avant le service' : hourNum < 14 ? 'en plein service' : 'après le service';

    const user = [
      'Formule midi :',
      `- Établissement : ${td.nom_etablissement || '(à compléter)'}`,
      `- Formule : ${td.formule_titre || ''}`,
      `- Prix : ${td.prix || ''}`,
      td.composition  ? `- Composition : ${td.composition.slice(0, 400)}` : null,
      td.horaires     ? `- Horaires service : ${td.horaires}` : null,
      '',
      qrData?.metier_brief ? `Contexte du chef : ${qrData.metier_brief.slice(0, 400)}` : null,
      '',
      'Contexte du scan :',
      `- Jour : ${dayFr}`,
      `- Heure (Paris) : ${hourFr}h (${moment})`,
      '',
      'Génère le JSON {"phrase","title"} maintenant.',
    ].filter(Boolean).join('\n');

    return { system, user };
  },

  renderHTML(qrData, scanCtx) {
    const safeShort = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const td = qrData?.template_data || {};
    const nom         = _esc(td.nom_etablissement || 'Notre formule');
    const titre       = _esc(td.formule_titre || 'Formule midi');
    const prix        = _esc(td.prix || '');
    const composition = _esc(td.composition || '');
    const horaires    = _esc(td.horaires || '');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nom} · ${titre}</title>
<style>
  :root { --bg:#0a0e14; --card:#111720; --bd:#1f2a37; --tx:#f1f5f9; --mut:#94a3b8; --acc:#7c8af9; --gold:#c9a96e; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--tx);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.02em; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 18px; }
  .sq-card { max-width: 440px; width: 100%; background: var(--card);
    border: 1px solid var(--bd); border-radius: 18px; padding: 26px 24px 22px;
    text-align: center; box-shadow: 0 32px 64px rgba(0,0,0,.45);
    animation: zoom-in 420ms cubic-bezier(.16,.84,.3,1); }
  @keyframes zoom-in { from { opacity:0; transform: scale(.96) translateY(8px); } to { opacity:1; transform: scale(1) translateY(0); } }

  .sq-brand { font-size: 10.5px; letter-spacing: .22em; color: var(--gold);
    text-transform: uppercase; font-weight: 600; margin-bottom: 14px; }
  .sq-nom { font-size: 14px; color: var(--mut); margin: 0 0 6px;
    text-transform: uppercase; letter-spacing: .12em; }
  .sq-titre { font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 28px; font-weight: 700; margin: 0 0 8px;
    letter-spacing: -.02em; line-height: 1.15; }
  .sq-prix { font-size: 36px; font-weight: 700; color: var(--gold);
    margin: 6px 0 18px; letter-spacing: -.025em; }

  .sq-compo { padding: 14px 16px; border-radius: 10px;
    background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06);
    font-size: 13.5px; color: var(--tx); line-height: 1.55;
    white-space: pre-line; text-align: left; margin: 0 0 14px; }
  .sq-horaires { font-size: 12px; color: var(--mut); margin: 0 0 18px;
    letter-spacing: .04em; }
  .sq-horaires::before { content: "⏱"; margin-right: 6px; }

  .sq-ia { padding: 14px 16px; border-radius: 10px;
    background: linear-gradient(135deg, rgba(201,169,110,.08), rgba(124,138,249,.10));
    border: 1px solid rgba(201,169,110,.22); margin-bottom: 18px; text-align: left; }
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
  .sq-foot { margin-top: 14px; color: #64748b; font-size: 10.5px; line-height: 1.5; }
  .sq-foot a { color: var(--mut); text-decoration: none; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="sq-card" role="article">
  <div class="sq-brand">Keystone Smart QR · Formule midi</div>
  <p class="sq-nom">${nom}</p>
  <h1 class="sq-titre">${titre}</h1>
  <div class="sq-prix">${prix}</div>
  ${composition ? `<div class="sq-compo">${composition}</div>` : ''}
  ${horaires ? `<div class="sq-horaires">${horaires}</div>` : ''}

  <div class="sq-ia" id="sq-ia">
    <div id="sq-ia-loading" class="sq-ia-loading">
      <div class="sq-skel w90"></div>
      <div class="sq-skel w70"></div>
      <p class="sq-ia-hint">Le service vous prépare un mot…</p>
    </div>
    <div id="sq-ia-ready" hidden>
      <h2 class="sq-ia-title" id="sq-title"></h2>
      <p class="sq-ia-phrase" id="sq-phrase"></p>
    </div>
  </div>

  <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
    Réserver maintenant
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
