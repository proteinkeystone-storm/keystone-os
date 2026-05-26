// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · quiz-orientation (V4.2)
// ───────────────────────────────────────────────────────────────────
// Quiz éclair : 1 question + 2-4 réponses iconiques. L'utilisateur
// tape sa réponse, l'IA reçoit le tag choisi via le `context` étendu
// de /api/smartqr/generate-interstitial, et recommande LE produit ou
// service le plus pertinent selon le brief métier + la réponse.
//
// Pas d'état serveur D1 (anonyme et instantané).
//
// UX :
//   T+0        question affichée + 2-4 cards réponses avec emoji
//   user tap   card sélectionnée → loupe + autres cards disparaissent
//   T+800ms    fetch /api/smartqr/generate-interstitial { context: { quiz_tag } }
//   T+2-4s    reveal phrase IA personnalisée + CTA Continuer
//
// Cf. BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md § "5. Quiz éclair d'orientation"
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot } from './_shared.js';

// Parse le textarea "reponses" en lignes structurées
// Format : emoji|label|tag (1 ligne par réponse, 2-4 lignes)
function parseReponses(raw) {
  if (!raw) return [];
  const lines = String(raw).split('\n').map(s => s.trim()).filter(Boolean);
  return lines.slice(0, 4).map(line => {
    const [emoji, label, tag] = line.split('|').map(s => (s || '').trim());
    return {
      emoji: emoji || '•',
      label: label || tag || emoji || '?',
      tag:   tag   || label || '?',
    };
  });
}

const TEMPLATE = {
  id:              'quiz-orientation',
  label:           'Quiz d\'orientation',
  tier_required:   'pro',
  ai_max_tokens:   4096,

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    if (!d.question || !String(d.question).trim()) {
      errors.push('La question est obligatoire.');
    }
    const reponses = parseReponses(d.reponses);
    if (reponses.length < 2) {
      errors.push('Au moins 2 réponses sont nécessaires (format emoji|label|tag, 1 par ligne).');
    }
    if (reponses.length > 4) {
      errors.push('Maximum 4 réponses pour rester lisible.');
    }
    return errors;
  },

  buildAiPrompt(qrData, scanCtx) {
    const d         = qrData?.template_data || {};
    const nom       = (d.nom_marque || '').toString().slice(0, 60);
    const question  = (d.question || '').toString().slice(0, 200);
    const reponses  = parseReponses(d.reponses);
    const labels    = reponses.map(r => `${r.emoji} ${r.label} (tag: ${r.tag})`).join(', ');
    const userCtx   = scanCtx?.user_context || {};
    const quizTag   = (userCtx.quiz_tag || '').toString().slice(0, 40);
    const quizLabel = (userCtx.quiz_label || '').toString().slice(0, 80);
    const now       = new Date();
    const dayFr     = now.toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    const hourFr    = now.toLocaleString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' });

    const system = [
      'Tu es l\'assistant Smart QR de Keystone OS. Le scanneur vient de répondre',
      'à un quiz d\'orientation (1 question, 2-4 réponses possibles). Tu écris',
      'UNE phrase courte qui RECOMMANDE le produit ou service le plus pertinent',
      'parmi l\'offre de la marque, en fonction de la réponse choisie.',
      '',
      'Règles strictes :',
      '- title : 3-5 mots accrocheurs ("Notre conseil", "Ton match", "Voici")',
      '- phrase : 1 seule phrase max 22 mots, ton conseil incarné et personnel',
      '- Tu DOIS faire référence au choix de l\'utilisateur (sans le réciter mot pour mot)',
      '- Si tu cites un produit, base-toi sur le brief métier (ne pas inventer une SKU)',
      '- Sinon, recommande une catégorie/orientation générique cohérente',
      '- Pas de prix, pas d\'horaires inventés, pas de CTA texte (le CTA est le bouton)',
      '- Réponse en JSON STRICT : {"phrase":"...","title":"..."}',
    ].join('\n');

    const user = [
      `Marque : ${nom || '(sans nom)'}`,
      `Question posée : "${question}"`,
      `Choix de l'utilisateur : ${quizLabel || quizTag || '(non communiqué)'}`,
      quizTag ? `Tag interne du choix : ${quizTag}` : null,
      `Toutes les réponses possibles : ${labels || '(non communiquées)'}`,
      qrData?.metier_brief ? `Brief métier : ${qrData.metier_brief.slice(0, 700)}` : null,
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
    const d         = qrData?.template_data || {};
    const safeShort = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const nomMarque = escHtml((d.nom_marque || '').toString().slice(0, 60));
    const question  = escHtml((d.question || 'Vous cherchez pour ?').toString().slice(0, 200));
    const logoUrl   = safeUrl(d.logo_url);
    const accent    = safeColor(d.accent_color, '#7c8af9');
    const reponses  = parseReponses(d.reponses);
    // Si vide ou < 2, fallback à un quiz par défaut pour ne pas casser le rendu
    const safeReps  = reponses.length >= 2 ? reponses : [
      { emoji: '🛍️', label: 'Pour moi',     tag: 'self' },
      { emoji: '🎁', label: 'Pour offrir',  tag: 'gift' },
    ];

    const cardsHtml = safeReps.map((r, idx) => `
      <button type="button" class="sq-quiz-card" data-idx="${idx}"
              data-tag="${escHtml(r.tag)}" data-label="${escHtml(r.label)}">
        <span class="sq-quiz-card-emoji">${escHtml(r.emoji)}</span>
        <span class="sq-quiz-card-label">${escHtml(r.label)}</span>
      </button>
    `).join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${nomMarque || 'Quiz'} · Smart QR</title>
<style>
  :root {
    --bg: #07090d; --card: #0d1218; --bd: #1c2632;
    --tx: #f1f5f9; --mut: #94a3b8; --gold: #c9a96e;
    --acc: ${accent};
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--tx);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.02em; min-height: 100vh; overflow-x: hidden;
    user-select: none; -webkit-user-select: none; }
  body { display: flex; align-items: center; justify-content: center;
    padding: 20px; min-height: 100vh; position: relative;
    -webkit-tap-highlight-color: transparent; }

  .sq-bg {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(ellipse at center,
      ${accent}33 0%, ${accent}11 35%, transparent 70%);
    animation: bg-pulse 4s ease-in-out infinite;
  }
  @keyframes bg-pulse {
    0%, 100% { opacity: .7; transform: scale(1); }
    50%      { opacity: 1;  transform: scale(1.06); }
  }

  .sq-card {
    position: relative; z-index: 1;
    max-width: 460px; width: 100%;
    background: linear-gradient(180deg, #0e141b 0%, var(--card) 100%);
    border: 1px solid var(--bd);
    border-radius: 24px;
    padding: 32px 22px 24px;
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
    margin-bottom: 14px; font-weight: 600; opacity: .85; }

  .sq-head { margin-bottom: 14px; }
  .sq-logo { max-height: 48px; max-width: 140px;
    margin: 0 auto 8px; display: block;
    filter: drop-shadow(0 4px 12px ${accent}55); }
  .sq-marque {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 22px; font-weight: 700;
    letter-spacing: -.02em; margin: 0;
    color: ${accent};
  }

  /* Question */
  .sq-question {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 26px; font-weight: 700;
    line-height: 1.25;
    margin: 18px 0 22px;
    color: var(--tx);
  }

  /* Cards de réponses */
  .sq-quiz-cards {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    margin-bottom: 6px;
  }
  /* Si 3 réponses, 3ᵉ pleine largeur ; si 4, grid 2×2 */
  .sq-quiz-cards.has-3 .sq-quiz-card:last-child { grid-column: span 2; }

  .sq-quiz-card {
    appearance: none;
    border: 1.5px solid ${accent}55;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(255,255,255,.03), rgba(255,255,255,.01));
    padding: 18px 12px;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    cursor: pointer;
    transition: all .25s cubic-bezier(.18,.89,.32,1.28);
    -webkit-tap-highlight-color: transparent;
    color: var(--tx); font-family: inherit;
  }
  .sq-quiz-card:hover {
    border-color: ${accent};
    background: linear-gradient(135deg, ${accent}1a, ${accent}05);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px ${accent}33;
  }
  .sq-quiz-card:active {
    transform: scale(.97);
  }
  .sq-quiz-card-emoji {
    font-size: 38px; line-height: 1;
    filter: drop-shadow(0 4px 8px rgba(0,0,0,.3));
  }
  .sq-quiz-card-label {
    font-size: 14px; font-weight: 600;
    letter-spacing: -.01em;
    color: var(--tx);
  }

  /* Animation "loupe" : la card choisie zoom et les autres disparaissent */
  body.is-answered .sq-quiz-cards { gap: 0; pointer-events: none; }
  body.is-answered .sq-quiz-card:not(.is-chosen) {
    opacity: 0; transform: scale(.85);
    transition: opacity .35s ease, transform .35s ease;
    pointer-events: none;
  }
  .sq-quiz-card.is-chosen {
    animation: zoom-in 700ms cubic-bezier(.18,.89,.32,1.28) forwards;
    background: linear-gradient(135deg, ${accent}33, ${accent}11);
    border-color: ${accent};
    box-shadow: 0 12px 32px ${accent}66;
    grid-column: 1 / -1;
  }
  @keyframes zoom-in {
    0%   { transform: scale(1); }
    40%  { transform: scale(1.15); }
    70%  { transform: scale(1.08); }
    100% { transform: scale(1.1); }
  }
  .sq-quiz-card.is-chosen .sq-quiz-card-emoji {
    font-size: 56px;
    transition: font-size .5s ease;
  }

  /* Slot IA — apparaît après la réponse */
  .sq-ia {
    margin-top: 24px; min-height: 60px;
    opacity: 0; transition: opacity .42s ease;
  }
  body.is-answered .sq-ia { opacity: 1; }
  .sq-ia-title { font-size: 15px; font-weight: 600;
    color: ${accent}; margin: 0 0 6px; letter-spacing: .02em; }
  .sq-ia-phrase { color: var(--tx); font-size: 15px;
    line-height: 1.55; margin: 0; font-style: italic; }
  .sq-ia-skeleton {
    height: 12px; width: 70%; margin: 4px auto;
    border-radius: 4px;
    background: linear-gradient(90deg,
      ${accent}1a 0%, ${accent}33 50%, ${accent}1a 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s linear infinite;
  }
  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* CTA Continuer (apparaît après la phrase IA) */
  .sq-cta-wrap { margin-top: 20px;
    opacity: 0; transition: opacity .42s ease;
    pointer-events: none; }
  .sq-cta-wrap.is-shown { opacity: 1; pointer-events: auto; }
  .sq-cta {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 13px 26px; border-radius: 10px;
    background: linear-gradient(135deg, ${accent}, ${accent}cc);
    color: #fff; font-size: 14px; font-weight: 700;
    text-decoration: none; letter-spacing: .02em;
    box-shadow: 0 8px 20px ${accent}55;
    transition: transform .14s ease, box-shadow .18s ease;
  }
  .sq-cta:hover { transform: translateY(-1px);
    box-shadow: 0 12px 28px ${accent}77; }
  .sq-cta:active { transform: scale(.97); }

  .sq-foot { margin-top: 22px; color: #64748b; font-size: 11px; line-height: 1.5; }
  .sq-foot a { color: var(--mut); text-decoration: none; }

  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="sq-bg" aria-hidden="true"></div>
<div class="sq-card" role="status" aria-live="polite">
  <div class="sq-brand-cap">Keystone Smart QR</div>

  <div class="sq-head">
    ${logoUrl ? `<img class="sq-logo" src="${logoUrl}" alt="${nomMarque}" loading="eager">` : ''}
    ${nomMarque ? `<h1 class="sq-marque">${nomMarque}</h1>` : ''}
  </div>

  <h2 class="sq-question">${question}</h2>

  <div class="sq-quiz-cards${safeReps.length === 3 ? ' has-3' : ''}" id="sq-quiz-cards">
    ${cardsHtml}
  </div>

  <div class="sq-ia" id="sq-ia" hidden>
    <div id="sq-ia-loading">
      <div class="sq-ia-skeleton"></div>
      <div class="sq-ia-skeleton" style="width:55%; margin-top:8px;"></div>
    </div>
    <div id="sq-ia-ready" hidden>
      <p class="sq-ia-title" id="sq-ia-title"></p>
      <p class="sq-ia-phrase" id="sq-ia-phrase"></p>
    </div>
  </div>

  <div class="sq-cta-wrap" id="sq-cta-wrap">
    <a class="sq-cta" href="/r/${safeShort}?direct=1">
      Découvrir
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </a>
  </div>

  ${renderKeystoneFoot()}
</div>

<script>
(() => {
  const SHORT = ${JSON.stringify(safeShort)};
  const el = id => document.getElementById(id);
  const cards   = document.querySelectorAll('.sq-quiz-card');
  const iaBlock = el('sq-ia');
  const iaLoading = el('sq-ia-loading');
  const iaReady   = el('sq-ia-ready');
  const ctaWrap   = el('sq-cta-wrap');

  function vibrate(p) {
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }

  let answered = false;
  cards.forEach(card => {
    card.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      card.classList.add('is-chosen');
      document.body.classList.add('is-answered');
      iaBlock.hidden = false;
      vibrate(40);

      const tag   = card.getAttribute('data-tag')   || '';
      const label = card.getAttribute('data-label') || '';

      // Délai léger pour laisser le temps à l'animation de loupe
      setTimeout(async () => {
        let data = null;
        try {
          const r = await fetch('/api/smartqr/generate-interstitial', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              short_id: SHORT,
              context: { quiz_tag: tag, quiz_label: label },
            }),
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          data = await r.json();
        } catch (e) {
          // Fail-safe minimal
          data = { title: 'Notre conseil', phrase: 'Merci pour ton choix — découvre ce qui te correspond le mieux.' };
        }

        if (el('sq-ia-title'))  el('sq-ia-title').textContent  = (data && data.title)  || 'Notre conseil';
        if (el('sq-ia-phrase')) el('sq-ia-phrase').textContent = (data && data.phrase) || '';
        iaLoading.hidden = true;
        iaReady.hidden   = false;
        ctaWrap.classList.add('is-shown');
      }, 600);
    });
  });
})();
</script>
</body>
</html>`;
  },
};

export default TEMPLATE;
