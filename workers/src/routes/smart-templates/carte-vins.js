// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · carte-vins (V3 Famille Restauration)
// ───────────────────────────────────────────────────────────────────
// QR à mettre sur la carte des vins/cocktails. Affiche les sélections
// du sommelier/bartender + IA propose des accords mets-vins basés sur
// le contexte (mois, météo plausible, brief du sommelier).
// ══════════════════════════════════════════════════════════════════

function _esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function _parseSelections(raw, max = 10) {
  if (!raw) return [];
  return String(raw).split('\n').map(l => l.trim()).filter(Boolean).slice(0, max).map(line => {
    // Format : "Nom — Région — Prix" ou "Nom — Prix" ou "Nom"
    const parts = line.split(/\s*[—–-]\s*/);
    if (parts.length >= 3) return { name: parts[0], origin: parts[1], price: parts.slice(2).join(' — ') };
    if (parts.length === 2) return { name: parts[0], origin: '', price: parts[1] };
    return { name: line, origin: '', price: '' };
  });
}

const TEMPLATE = {
  id:              'carte-vins',
  label:           'Carte des vins',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('nom_etablissement requis');
    if (!template_data?.selections?.trim())        errors.push('selections requis');
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const td = qrData?.template_data || {};
    const now    = new Date();
    const hourFr = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });
    const dayFr  = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    const month  = now.toLocaleString('fr-FR', { month: 'long',   timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS pour la carte des vins/cocktails d\'un restaurant.',
      'Le client consulte la carte. Tu génères UNE phrase courte (max 20 mots) qui suggère un accord',
      'mets-vin ou un coup de cœur de saison.',
      '',
      'Règles strictes :',
      '- Une seule phrase, max 20 mots, française',
      '- Ton sommelier discret et passionné, jamais snob',
      '- Mentionne UN signal contextuel (saison/mois, jour, plat typique de la maison)',
      '- Ne mens pas sur les vins (utilise UNIQUEMENT ceux listés)',
      '- Pas de "Bonjour", pas de CTA',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
      '  - title = 2-4 mots (ex: "Accord du jour", "Coup de cœur", "Saison")',
    ].join('\n');

    const user = [
      'Maison :',
      `- ${td.nom_etablissement || '(à compléter)'}`,
      td.type_carte ? `- Type de carte : ${td.type_carte}` : null,
      '',
      'Sélections proposées :',
      `${(td.selections || '').slice(0, 1200)}`,
      '',
      qrData?.metier_brief ? `Contexte du sommelier : ${qrData.metier_brief.slice(0, 600)}` : null,
      '',
      'Contexte du scan :',
      `- Mois : ${month}`,
      `- Jour : ${dayFr}`,
      `- Heure (Paris) : ${hourFr}h`,
      '',
      'Génère le JSON {"phrase","title"} maintenant.',
    ].filter(Boolean).join('\n');

    return { system, user };
  },

  renderHTML(qrData, scanCtx) {
    const safeShort  = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const td = qrData?.template_data || {};
    const nom        = _esc(td.nom_etablissement || 'Notre carte');
    const type       = _esc(td.type_carte || 'Carte des vins');
    const items      = _parseSelections(td.selections, 10);

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nom} · ${type}</title>
<style>
  :root { --bg:#0a0e14; --card:#111720; --bd:#1f2a37; --tx:#f1f5f9; --mut:#94a3b8; --acc:#7c8af9; --gold:#c9a96e; --wine:#a8334e; }
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
  .sq-type { font-size: 11px; letter-spacing: .15em; text-transform: uppercase;
    color: var(--mut); text-align: center; margin: 0 0 4px; }
  .sq-nom { font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 26px; font-weight: 700; text-align: center; margin: 0 0 20px;
    letter-spacing: -.02em; }

  .sq-list { border-top: 1px solid rgba(201,169,110,.20);
    padding-top: 4px; margin-bottom: 14px; }
  .sq-item { padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.04); }
  .sq-item:last-child { border-bottom: 0; }
  .sq-item-top { display: flex; justify-content: space-between; gap: 12px;
    font-size: 14px; }
  .sq-item-name { color: var(--tx); font-weight: 500; flex: 1; }
  .sq-item-price { color: var(--gold); font-weight: 600; flex-shrink: 0; }
  .sq-item-origin { font-size: 11.5px; color: var(--mut); margin-top: 2px;
    font-style: italic; }

  .sq-ia { padding: 14px 16px; border-radius: 10px; margin: 18px 0;
    background: linear-gradient(135deg, rgba(168,51,78,.10), rgba(201,169,110,.08));
    border: 1px solid rgba(168,51,78,.22); }
  .sq-ia-loading .sq-skel { height: 12px; margin: 6px 0;
    border-radius: 4px; background: linear-gradient(90deg,
      rgba(148,163,184,.08), rgba(148,163,184,.22), rgba(148,163,184,.08));
    background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
  .sq-ia-loading .sq-skel.w90 { width: 90%; } .sq-ia-loading .sq-skel.w70 { width: 70%; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  .sq-ia-hint { font-size: 11px; color: var(--mut); opacity: .7;
    font-style: italic; margin-top: 8px; }
  .sq-ia-hint::before { content: "🍷"; margin-right: 5px;
    opacity: .8; font-style: normal; }
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
  <p class="sq-type">${type}</p>
  <h1 class="sq-nom">${nom}</h1>

  <div class="sq-list">
    ${items.map(it => `
      <div class="sq-item">
        <div class="sq-item-top">
          <span class="sq-item-name">${_esc(it.name)}</span>
          ${it.price ? `<span class="sq-item-price">${_esc(it.price)}</span>` : ''}
        </div>
        ${it.origin ? `<div class="sq-item-origin">${_esc(it.origin)}</div>` : ''}
      </div>
    `).join('')}
  </div>

  <div class="sq-ia" id="sq-ia">
    <div id="sq-ia-loading" class="sq-ia-loading">
      <div class="sq-skel w90"></div>
      <div class="sq-skel w70"></div>
      <p class="sq-ia-hint">Notre sommelier vous suggère…</p>
    </div>
    <div id="sq-ia-ready" hidden>
      <h2 class="sq-ia-title" id="sq-title"></h2>
      <p class="sq-ia-phrase" id="sq-phrase"></p>
    </div>
  </div>

  <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
    Réserver / Carte complète
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
