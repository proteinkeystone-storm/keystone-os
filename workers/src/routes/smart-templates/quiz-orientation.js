// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · quiz-orientation (V4.5 — routeur)
// ───────────────────────────────────────────────────────────────────
// Quiz éclair : 1 question + 2-4 réponses iconiques. Chaque réponse a
// SA PROPRE URL de destination. Au tap d'une card → redirection
// immédiate (zéro attente IA, vraie valeur ajoutée d'orientation).
//
// Pivot V4.5 (2026-05-26) : abandon de la phrase IA personnalisée
// qui ajoutait une attente sans valeur réelle. Le quiz devient ce
// qu'il aurait toujours dû être : un routeur intelligent vers la
// bonne page produit/service selon le profil du scanneur.
//
// UX :
//   T+0      question + 2-4 cards avec emoji + label
//   user tap  vibrate + zoom loupe + redirect immédiat vers la card.url
//
// Pas d'état serveur, pas d'IA, pas de cache, pas de slot d'attente.
//
// Cf. BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md § "5. Quiz" (pivot V4.5)
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot } from './_shared.js';

// Parse le textarea "reponses" en lignes structurées.
// Format V4.5 : emoji|label|url (1 ligne par réponse, 2-4 lignes).
// url DOIT être une URL HTTP(S) valide pour être conservée.
function parseReponses(raw) {
  if (!raw) return [];
  const lines = String(raw).split('\n').map(s => s.trim()).filter(Boolean);
  return lines.slice(0, 4).map(line => {
    const [emoji, label, url] = line.split('|').map(s => (s || '').trim());
    const safeU = safeUrl(url);
    return {
      emoji: emoji || '•',
      label: label || emoji || '?',
      url:   safeU || '',
    };
  });
}

const TEMPLATE = {
  id:              'quiz-orientation',
  label:           'Quiz d\'orientation',
  tier_required:   'pro',
  ai_max_tokens:   4096, // conservé pour le contrat, jamais utilisé en V4.5

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
      errors.push('Au moins 2 réponses sont nécessaires (format emoji|libellé|URL, 1 par ligne).');
    }
    if (reponses.length > 4) {
      errors.push('Maximum 4 réponses pour rester lisible.');
    }
    const reponsesRaw = String(d.reponses || '').split('\n').map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < reponsesRaw.length; i++) {
      const parts = reponsesRaw[i].split('|');
      const url   = (parts[2] || '').trim();
      if (!url) {
        errors.push(`Réponse ${i + 1} : URL de destination manquante (format emoji|libellé|URL).`);
      } else if (!safeUrl(url)) {
        errors.push(`Réponse ${i + 1} : URL invalide (doit commencer par http:// ou https://).`);
      }
    }
    return errors;
  },

  // buildAiPrompt conservé pour respecter le contrat des tests, mais le
  // template V4.5 n'utilise plus l'endpoint /api/smartqr/generate-interstitial.
  // La phrase IA générique n'apportait rien — le tap mène directement à
  // la bonne URL, c'est la vraie valeur.
  buildAiPrompt(qrData, scanCtx) {
    const system = [
      'Quiz routeur V4.5 — l\'IA n\'est pas utilisée par ce template.',
      'Ce prompt n\'est conservé que pour respecter le contrat des tests.',
      'Si tu réponds, fais-le en JSON STRICT : {"phrase":"...","title":"..."}',
    ].join('\n');
    const user = 'Pas d\'appel attendu — ce template route directement par URL.';
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
    // Fallback minimal si le commerçant n'a pas (encore) configuré ses
    // réponses — on évite de servir une page vide en redirigeant vers la
    // cible par défaut du QR.
    const defaultUrl = '/r/' + safeShort + '?direct=1';
    const safeReps  = reponses.length >= 2 ? reponses : [
      { emoji: '🛍️', label: 'Pour moi',    url: defaultUrl },
      { emoji: '🎁', label: 'Pour offrir', url: defaultUrl },
    ];

    const cardsHtml = safeReps.map((r, idx) => `
      <button type="button" class="sq-quiz-card" data-idx="${idx}"
              data-url="${escHtml(r.url || defaultUrl)}"
              data-label="${escHtml(r.label)}">
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
  .sq-quiz-cards.has-3 .sq-quiz-card:last-child { grid-column: span 2; }

  .sq-quiz-card {
    appearance: none;
    border: 1.5px solid ${accent}55;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(255,255,255,.03), rgba(255,255,255,.01));
    padding: 22px 12px;
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
    font-size: 42px; line-height: 1;
    filter: drop-shadow(0 4px 8px rgba(0,0,0,.3));
  }
  .sq-quiz-card-label {
    font-size: 14px; font-weight: 600;
    letter-spacing: -.01em;
    color: var(--tx);
  }

  /* Animation "loupe" sur la card choisie avant la redirection */
  .sq-quiz-card.is-chosen {
    animation: zoom-out 380ms cubic-bezier(.18,.89,.32,1.28) forwards;
    background: linear-gradient(135deg, ${accent}33, ${accent}11);
    border-color: ${accent};
    box-shadow: 0 12px 32px ${accent}66;
  }
  @keyframes zoom-out {
    0%   { transform: scale(1); }
    50%  { transform: scale(1.15); }
    100% { transform: scale(1.08); opacity: .9; }
  }
  body.is-redirecting .sq-quiz-card:not(.is-chosen) {
    opacity: .3; transform: scale(.94);
    transition: opacity .25s, transform .25s;
    pointer-events: none;
  }

  /* Slot IA conservé hidden pour le contrat des tests (le quiz routeur
     n'appelle PAS /api/smartqr/generate-interstitial — la phrase IA
     générique n'apportait aucune valeur ajoutée à l'orientation). */
  .sq-ia { display: none; }

  /* Lien "passer" discret pour ceux qui veulent éviter le quiz et aller
     directement à la cible originale du QR (target_url). */
  .sq-skip {
    display: inline-block; margin-top: 16px;
    font-size: 12px; color: var(--mut);
    text-decoration: underline; text-decoration-color: rgba(148,163,184,.32);
    text-underline-offset: 3px;
  }
  .sq-skip:hover { color: ${accent}; text-decoration-color: ${accent}88; }

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

  <!-- V4.5 — slot IA conservé pour le contrat tests, le quiz routeur
       n'appelle pas /api/smartqr/generate-interstitial (zéro attente). -->
  <div class="sq-ia" id="sq-ia" hidden aria-hidden="true"></div>

  <a class="sq-skip" href="/r/${safeShort}?direct=1">Passer cette étape →</a>

  ${renderKeystoneFoot()}
</div>

<script>
(() => {
  const cards = document.querySelectorAll('.sq-quiz-card');
  let answered = false;

  function vibrate(p) {
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }

  cards.forEach(card => {
    card.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      const url = card.getAttribute('data-url');
      card.classList.add('is-chosen');
      document.body.classList.add('is-redirecting');
      vibrate(50);
      // Petit délai (380ms = durée de l'anim zoom) pour que l'utilisateur
      // perçoive la sélection avant la redirection.
      setTimeout(() => {
        if (url) {
          window.location.href = url;
        }
      }, 420);
    });
  });
})();
</script>
</body>
</html>`;
  },
};

export default TEMPLATE;
