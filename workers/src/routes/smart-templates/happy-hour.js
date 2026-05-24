// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · happy-hour (V3 Famille Loisirs)
// ───────────────────────────────────────────────────────────────────
// QR pour Happy Hour bar/bowling/loisirs : tarifs réduits + plage
// horaire + IA qui pousse à venir vite si on est dedans, ou à revenir
// sinon. Utilise heure_debut/heure_fin pour adapter le ton.
// ══════════════════════════════════════════════════════════════════

function _esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const TEMPLATE = {
  id:              'happy-hour',
  label:           'Happy Hour',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('nom_etablissement requis');
    if (!template_data?.offres?.trim())            errors.push('offres requis');
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const td = qrData?.template_data || {};
    const now      = new Date();
    const hourFr   = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });
    const hourNum  = now.getHours();
    const dayFr    = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });

    // Détermine si on est dans la plage HH (parsing simple H:M)
    const parseH = (h) => {
      if (!h) return null;
      const m = String(h).match(/(\d{1,2})(?::(\d{2}))?/);
      return m ? parseInt(m[1]) + (m[2] ? parseInt(m[2]) / 60 : 0) : null;
    };
    const hStart = parseH(td.heure_debut);
    const hEnd   = parseH(td.heure_fin);
    let situation = 'inconnu';
    if (hStart !== null && hEnd !== null) {
      situation = (hourNum >= hStart && hourNum < hEnd) ? 'en cours' :
                  (hourNum < hStart)                    ? 'à venir' : 'passé';
    }

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS pour un Happy Hour bar/loisirs.',
      'Tu génères UNE phrase courte (max 18 mots) adaptée au moment du scan :',
      '- Si Happy Hour EN COURS : pousse à venir maintenant ("Encore X heures…")',
      '- Si À VENIR : annonce avec excitation ("Ça commence à 18h ce soir…")',
      '- Si PASSÉ : invite pour le lendemain/prochain ("Demain dès 18h…")',
      '',
      'Règles strictes :',
      '- Une seule phrase, max 18 mots, française',
      '- Ton détendu et complice, pas commercial',
      '- Adapte au moment du scan',
      '- Pas de "Bonjour", pas de CTA explicite',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
      '  - title = 2-4 mots (ex: "En ce moment", "Dans 2h", "Demain pareil")',
    ].join('\n');

    const user = [
      'Happy Hour :',
      `- Lieu : ${td.nom_etablissement || '(à compléter)'}`,
      td.heure_debut ? `- Début : ${td.heure_debut}` : null,
      td.heure_fin   ? `- Fin : ${td.heure_fin}`     : null,
      td.jours       ? `- Jours : ${td.jours}`       : null,
      '',
      'Offres :',
      `${(td.offres || '').slice(0, 600)}`,
      '',
      qrData?.metier_brief ? `Contexte du lieu : ${qrData.metier_brief.slice(0, 400)}` : null,
      '',
      'Contexte du scan :',
      `- Jour : ${dayFr}`,
      `- Heure (Paris) : ${hourFr}h`,
      `- Situation Happy Hour : ${situation}`,
      '',
      'Génère le JSON {"phrase","title"} maintenant.',
    ].filter(Boolean).join('\n');

    return { system, user };
  },

  renderHTML(qrData, scanCtx) {
    const safeShort = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const td = qrData?.template_data || {};
    const nom         = _esc(td.nom_etablissement || 'Le Bar');
    const debut       = _esc(td.heure_debut || '');
    const fin         = _esc(td.heure_fin || '');
    const jours       = _esc(td.jours || 'Tous les jours');
    const offres      = _esc(td.offres || '');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Happy Hour · ${nom}</title>
<style>
  :root { --bg:#0a0e14; --card:#111720; --bd:#1f2a37; --tx:#f1f5f9; --mut:#94a3b8; --acc:#7c8af9; --gold:#c9a96e; --neon:#22d3ee; }
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

  .sq-hh-badge { display: inline-block; padding: 5px 16px;
    background: linear-gradient(135deg, rgba(34,211,238,.20), rgba(124,138,249,.20));
    border: 1.5px solid rgba(34,211,238,.5); border-radius: 999px;
    font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
    color: var(--neon); font-weight: 700; margin: 0 0 12px;
    text-shadow: 0 0 12px rgba(34,211,238,.5); }

  .sq-nom { font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 24px; font-weight: 700; margin: 0 0 4px;
    letter-spacing: -.02em; }

  .sq-horaire { font-size: 32px; font-weight: 700; color: var(--neon);
    letter-spacing: -.02em; margin: 14px 0 4px;
    text-shadow: 0 0 16px rgba(34,211,238,.3); }
  .sq-jours { font-size: 12px; color: var(--mut); margin: 0 0 22px;
    letter-spacing: .04em; }

  .sq-offres { padding: 16px 18px; border-radius: 12px;
    background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06);
    text-align: left; font-size: 14px; color: var(--tx); line-height: 1.6;
    white-space: pre-line; margin: 0 0 18px; }
  .sq-offres-title { font-size: 10.5px; letter-spacing: .15em; text-transform: uppercase;
    color: var(--gold); font-weight: 600; margin: 0 0 8px; }

  .sq-ia { padding: 14px 16px; border-radius: 10px;
    background: linear-gradient(135deg, rgba(34,211,238,.08), rgba(201,169,110,.08));
    border: 1px solid rgba(34,211,238,.22); margin-bottom: 18px; text-align: left; }
  .sq-ia-loading .sq-skel { height: 12px; margin: 6px 0;
    border-radius: 4px; background: linear-gradient(90deg,
      rgba(148,163,184,.08), rgba(148,163,184,.22), rgba(148,163,184,.08));
    background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
  .sq-ia-loading .sq-skel.w90 { width: 90%; } .sq-ia-loading .sq-skel.w70 { width: 70%; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  .sq-ia-hint { font-size: 11px; color: var(--mut); opacity: .7;
    font-style: italic; margin-top: 8px; }
  .sq-ia-hint::before { content: "🍹"; margin-right: 5px;
    opacity: .8; font-style: normal; }
  .sq-ia-title { font-size: 13px; font-weight: 700; color: var(--neon);
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
  <div class="sq-brand">Keystone Smart QR</div>
  <span class="sq-hh-badge">Happy Hour</span>
  <h1 class="sq-nom">${nom}</h1>
  ${(debut && fin) ? `<div class="sq-horaire">${debut} → ${fin}</div>` : ''}
  ${jours ? `<div class="sq-jours">${jours}</div>` : ''}

  <div class="sq-offres">
    <div class="sq-offres-title">À l'ardoise</div>
    ${offres}
  </div>

  <div class="sq-ia" id="sq-ia">
    <div id="sq-ia-loading" class="sq-ia-loading">
      <div class="sq-skel w90"></div>
      <div class="sq-skel w70"></div>
      <p class="sq-ia-hint">On vous prépare un mot…</p>
    </div>
    <div id="sq-ia-ready" hidden>
      <h2 class="sq-ia-title" id="sq-title"></h2>
      <p class="sq-ia-phrase" id="sq-phrase"></p>
    </div>
  </div>

  <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
    Carte & infos
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
