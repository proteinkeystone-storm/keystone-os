// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · demande-rappel (V2 Famille Immobilier)
// ───────────────────────────────────────────────────────────────────
// Pour les QR sur cartes de visite, signatures email, panneaux d'agence,
// pubs presse. Affiche immédiatement le nom de l'agent + agence, propose
// 2 CTAs côte à côte :
//   • "M'appeler" → tel:NUMÉRO direct (si tel_agent défini)
//   • "Demander un rappel" → /r/SHORT?direct=1 (cible = form Pulsa,
//     mailto, formulaire site agence, etc.)
// Phrase IA contextualise la disponibilité ("Je vous rappelle d'ici 2h
// en ce mardi matin").
// ══════════════════════════════════════════════════════════════════

function _esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function _safeTel(s) {
  return String(s || '').replace(/[^0-9+]/g, '').slice(0, 20);
}

const TEMPLATE = {
  id:              'demande-rappel',
  label:           'Demande de rappel',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_agent?.trim()) errors.push('nom_agent requis');
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const td = qrData?.template_data || {};
    const now      = new Date();
    const hourFr   = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });
    const dayFr    = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS pour une carte de visite immobilière.',
      'Le scanneur veut entrer en contact avec un agent. Tu génères UNE phrase courte (max 18 mots) qui',
      'rassure sur la disponibilité de l\'agent ET personnalise le moment (jour/heure).',
      '',
      'Règles strictes :',
      '- Une seule phrase, max 18 mots, française',
      '- Parle à la première personne du singulier ("je", "mon") au nom de l\'agent',
      '- Mentionne le moment du scan (jour, heure, plage d\'horaires)',
      '- Ne fais pas de promesse impossible (pas de "je rappelle en 5 minutes" la nuit)',
      '- Pas de "Bonjour", pas de CTA',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
      '  - phrase = la phrase d\'engagement (18 mots max)',
      '  - title  = 2-4 mots (ex: "Disponible", "Je vous écoute", "À votre service")',
    ].join('\n');

    const user = [
      'Agent :',
      `- Nom : ${td.nom_agent || '(à compléter)'}`,
      td.agence           ? `- Agence : ${td.agence}` : null,
      td.creneau_default  ? `- Disponibilité affichée : ${td.creneau_default}` : null,
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
    const nom    = _esc(td.nom_agent || 'Votre agent');
    const agence = _esc(td.agence || '');
    const creneau= _esc(td.creneau_default || '');
    const tel    = _safeTel(td.tel_agent);
    const initiales = nom.split(/\s+/).map(w => w.charAt(0).toUpperCase()).join('').slice(0, 2);

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nom} · Keystone Smart QR</title>
<style>
  :root { --bg:#0a0e14; --card:#111720; --bd:#1f2a37; --tx:#f1f5f9; --mut:#94a3b8; --acc:#7c8af9; --gold:#c9a96e; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--tx);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.02em; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 18px; }
  .sq-card { max-width: 440px; width: 100%; background: var(--card);
    border: 1px solid var(--bd); border-radius: 18px; padding: 28px 24px 22px;
    text-align: center; box-shadow: 0 32px 64px rgba(0,0,0,.45);
    animation: zoom-in 420ms cubic-bezier(.16,.84,.3,1); }
  @keyframes zoom-in { from { opacity:0; transform: scale(.96) translateY(8px); } to { opacity:1; transform: scale(1) translateY(0); } }

  .sq-brand { font-size: 10.5px; letter-spacing: .22em; color: var(--gold);
    text-transform: uppercase; font-weight: 600; margin-bottom: 18px; }

  .sq-avatar { width: 76px; height: 76px; margin: 0 auto 14px;
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 700; color: var(--gold);
    background: linear-gradient(135deg, rgba(201,169,110,.18), rgba(124,138,249,.18));
    border: 1.5px solid rgba(201,169,110,.4);
    letter-spacing: -.02em; }

  .sq-nom { font-size: 22px; font-weight: 700; letter-spacing: -.025em;
    margin: 0 0 4px; line-height: 1.2; }
  .sq-agence { font-size: 12.5px; color: var(--mut); margin: 0 0 4px; }
  .sq-creneau { font-size: 11.5px; color: var(--mut); opacity: .8;
    margin: 0 0 22px; }
  .sq-creneau::before { content: "● "; color: #4ade80; font-size: 9px;
    vertical-align: 2px; }

  .sq-ia { padding: 14px 16px; border-radius: 10px;
    background: linear-gradient(135deg, rgba(201,169,110,.08), rgba(124,138,249,.10));
    border: 1px solid rgba(201,169,110,.22); margin-bottom: 22px;
    transition: opacity .42s ease; text-align: left; }
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

  .sq-ctas { display: grid; gap: 10px; }
  .sq-ctas.dual { grid-template-columns: 1fr 1fr; }
  .sq-cta { display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 14px 18px; border-radius: 12px; border: 0;
    font-size: 14.5px; font-weight: 600; text-decoration: none; cursor: pointer;
    transition: transform .14s ease, box-shadow .14s ease; }
  .sq-cta-primary { background: var(--acc); color: #fff;
    box-shadow: 0 8px 24px rgba(124,138,249,.32); }
  .sq-cta-primary:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(124,138,249,.4); }
  .sq-cta-secondary { background: rgba(255,255,255,.04); color: var(--tx);
    border: 1px solid rgba(255,255,255,.10); }
  .sq-cta-secondary:hover { background: rgba(255,255,255,.06); transform: translateY(-1px); }
  .sq-cta:active { transform: scale(.98); }

  .sq-foot { margin-top: 18px; color: #64748b; font-size: 10.5px; line-height: 1.5; }
  .sq-foot a { color: var(--mut); text-decoration: none; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="sq-card" role="article">
  <div class="sq-brand">Keystone Smart QR</div>
  <div class="sq-avatar" aria-hidden="true">${initiales}</div>
  <h1 class="sq-nom">${nom}</h1>
  ${agence  ? `<p class="sq-agence">${agence}</p>` : ''}
  ${creneau ? `<p class="sq-creneau">${creneau}</p>` : ''}

  <div class="sq-ia" id="sq-ia">
    <div id="sq-ia-loading" class="sq-ia-loading">
      <div class="sq-skel w90"></div>
      <div class="sq-skel w70"></div>
      <p class="sq-ia-hint">L'IA personnalise mon message…</p>
    </div>
    <div id="sq-ia-ready" hidden>
      <h2 class="sq-ia-title" id="sq-title"></h2>
      <p class="sq-ia-phrase" id="sq-phrase"></p>
    </div>
  </div>

  <div class="sq-ctas ${tel ? 'dual' : ''}">
    ${tel ? `<a class="sq-cta sq-cta-primary" href="tel:${tel}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      M'appeler
    </a>` : ''}
    <a class="sq-cta ${tel ? 'sq-cta-secondary' : 'sq-cta-primary'}" href="/r/${safeShort}?direct=1">
      ${tel ? 'Demander un rappel' : 'Me contacter'}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>
  </div>

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
