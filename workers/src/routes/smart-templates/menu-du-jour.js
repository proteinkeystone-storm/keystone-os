// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · menu-du-jour (V3 Famille Restauration)
// ───────────────────────────────────────────────────────────────────
// QR à mettre sur la carte d'un resto / café (ou sur la porte). Affiche
// le menu du jour avec entrées/plats/desserts, et l'IA habille avec une
// phrase contextuelle ("Pour cette pluie d'octobre, le risotto cèpes
// est tout indiqué"). CTA "Réserver" / "Voir la carte complète".
// ══════════════════════════════════════════════════════════════════

function _esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Items menu : format texte libre, 1 ligne = 1 item, séparateur "—" entre
// nom et prix (ex: "Risotto cèpes — 22€"). Parse simple pour rendu.
function _parseItems(raw, max = 12) {
  if (!raw) return [];
  return String(raw).split('\n').map(l => l.trim()).filter(Boolean).slice(0, max).map(line => {
    const m = line.match(/^(.*?)\s*[—–-]\s*([\d,.\s€$£]+)\s*$/);
    if (m) return { label: m[1].trim(), price: m[2].trim() };
    return { label: line, price: '' };
  });
}

const TEMPLATE = {
  id:              'menu-du-jour',
  label:           'Menu du jour',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('nom_etablissement requis');
    if (!template_data?.plats?.trim())             errors.push('plats requis');
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const td = qrData?.template_data || {};
    const now    = new Date();
    const hourFr = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });
    const dayFr  = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    const month  = now.toLocaleString('fr-FR', { month: 'long',   timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS pour un restaurant/café qui affiche son menu du jour.',
      'Le client tient le menu (ou la carte) dans les mains. Tu génères UNE phrase courte (max 20 mots) qui',
      'oriente son choix selon le contexte (saison, météo plausible, moment, brief du chef).',
      '',
      'Règles strictes :',
      '- Une seule phrase, max 20 mots, française',
      '- Ton chaleureux et gourmand, comme un serveur qui glisse un conseil',
      '- Mentionne UN signal contextuel (moment, saison/mois, plat distinctif)',
      '- Pas de prix dans la phrase',
      '- Pas de "Bonjour", pas de CTA',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
      '  - phrase = conseil/coup de cœur (20 mots max)',
      '  - title  = 2-4 mots évocateurs (ex: "Coup de cœur du jour", "Tendance midi")',
    ].join('\n');

    const user = [
      'Établissement :',
      `- Nom : ${td.nom_etablissement || '(à compléter)'}`,
      td.specialite ? `- Spécialité : ${td.specialite}` : null,
      '',
      'Menu du jour :',
      `${(td.plats || '').slice(0, 800)}`,
      td.entrees   ? `\nEntrées :\n${td.entrees.slice(0, 400)}`   : '',
      td.desserts  ? `\nDesserts :\n${td.desserts.slice(0, 400)}` : '',
      '',
      qrData?.metier_brief ? `Contexte du chef : ${qrData.metier_brief.slice(0, 600)}` : null,
      '',
      'Contexte du scan :',
      `- Mois : ${month}`,
      `- Jour : ${dayFr}`,
      `- Heure (Paris) : ${hourFr}h`,
      `- Pays scanné : ${scanCtx?.country || '?'}`,
      '',
      'Génère le JSON {"phrase","title"} maintenant.',
    ].filter(Boolean).join('\n');

    return { system, user };
  },

  renderHTML(qrData, scanCtx) {
    const safeShort = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const td = qrData?.template_data || {};
    const nom        = _esc(td.nom_etablissement || 'Notre menu du jour');
    const specialite = _esc(td.specialite || '');
    const entrees    = _parseItems(td.entrees, 6);
    const plats      = _parseItems(td.plats, 8);
    const desserts   = _parseItems(td.desserts, 6);

    const renderSection = (label, items) => {
      if (!items.length) return '';
      return `
        <div class="sq-menu-section">
          <h3 class="sq-menu-section-title">${label}</h3>
          ${items.map(it => `
            <div class="sq-menu-item">
              <span class="sq-menu-item-label">${_esc(it.label)}</span>
              ${it.price ? `<span class="sq-menu-item-price">${_esc(it.price)}</span>` : ''}
            </div>
          `).join('')}
        </div>`;
    };

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nom} · Menu du jour</title>
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
  .sq-nom { font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 26px; font-weight: 700; text-align: center; margin: 0 0 4px;
    letter-spacing: -.02em; }
  .sq-specialite { font-size: 12px; color: var(--mut); text-align: center;
    margin: 0 0 22px; font-style: italic; }

  .sq-menu-section { margin-bottom: 18px; }
  .sq-menu-section:last-of-type { margin-bottom: 8px; }
  .sq-menu-section-title { font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase;
    color: var(--gold); font-weight: 600; margin: 0 0 10px;
    padding-bottom: 6px; border-bottom: 1px solid rgba(201,169,110,.20); }
  .sq-menu-item { display: flex; justify-content: space-between; gap: 12px;
    padding: 4px 0; font-size: 14px; line-height: 1.45; }
  .sq-menu-item-label { color: var(--tx); flex: 1; }
  .sq-menu-item-price { color: var(--gold); font-weight: 600; flex-shrink: 0; }

  .sq-ia { padding: 14px 16px; border-radius: 10px; margin: 18px 0;
    background: linear-gradient(135deg, rgba(201,169,110,.08), rgba(124,138,249,.10));
    border: 1px solid rgba(201,169,110,.22); }
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
  <div class="sq-brand">Keystone Smart QR · Menu du jour</div>
  <h1 class="sq-nom">${nom}</h1>
  ${specialite ? `<p class="sq-specialite">${specialite}</p>` : ''}

  ${renderSection('Entrées',  entrees)}
  ${renderSection('Plats',    plats)}
  ${renderSection('Desserts', desserts)}

  <div class="sq-ia" id="sq-ia">
    <div id="sq-ia-loading" class="sq-ia-loading">
      <div class="sq-skel w90"></div>
      <div class="sq-skel w70"></div>
      <p class="sq-ia-hint">Le chef vous prépare un conseil…</p>
    </div>
    <div id="sq-ia-ready" hidden>
      <h2 class="sq-ia-title" id="sq-title"></h2>
      <p class="sq-ia-phrase" id="sq-phrase"></p>
    </div>
  </div>

  <a class="sq-cta" id="sq-continue" href="/r/${safeShort}?direct=1">
    Réserver / Voir plus
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
