// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · quiz-orientation (V4.2)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/quiz-orientation.js.
// Pas d'état serveur (anonyme et instantané) — le tag choisi est passé
// à l'IA via le context étendu de /api/smartqr/generate-interstitial.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'quiz-orientation',
  label:           'Quiz d\'orientation',
  description:     '1 question + 2 à 4 réponses iconiques. L\'IA recommande LE produit ou service pertinent selon la réponse.',
  icon:            '❓',
  tier_required:   'pro',

  fields: [
    {
      id: 'nom_marque', type: 'text', label: 'Nom de la marque', required: true,
      placeholder: 'Ex: Boutique Solène', span: 'full',
    },
    {
      id: 'question', type: 'text', label: 'Question posée', required: true,
      placeholder: 'Ex: Vous cherchez pour ?',
      span: 'full',
    },
    {
      id: 'reponses', type: 'textarea',
      label: 'Réponses (2 à 4 — format emoji|libellé|tag, 1 par ligne)',
      placeholder: '👶|Bébé|baby\n🧒|Enfant|kid\n🧑|Ado|teen\n👴|Senior|senior',
      default: '🛍️|Pour moi|self\n🎁|Pour offrir|gift',
      span: 'full',
    },
    {
      id: 'logo_url', type: 'image', label: 'Logo (optionnel)',
      span: 'full',
    },
    {
      id: 'accent_color', type: 'color', label: 'Couleur d\'accent',
      default: '#7c8af9',
    },
  ],

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    if (!d.question || !String(d.question).trim()) {
      errors.push('La question est obligatoire.');
    }
    const lines = (d.reponses || '').toString().split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length < 2) {
      errors.push('Au moins 2 réponses sont nécessaires (1 par ligne).');
    }
    if (lines.length > 4) {
      errors.push('Maximum 4 réponses pour rester lisible.');
    }
    return errors;
  },

  summary(template_data) {
    const d = template_data || {};
    const nom = (d.nom_marque || 'Marque').toString().trim();
    const q   = (d.question  || 'question').toString().trim().slice(0, 40);
    return `Quiz « ${nom} » — ${q}`;
  },

  // Mini-preview animée : 3 cards mini avec emoji qui pulse en cascade
  previewMini() {
    return `<div class="sq-mini-quiz">
      <div class="sq-mini-quiz-card sq-mini-quiz-card--a">👶</div>
      <div class="sq-mini-quiz-card sq-mini-quiz-card--b">🧒</div>
      <div class="sq-mini-quiz-card sq-mini-quiz-card--c">🧑</div>
    </div>`;
  },
};

export default TEMPLATE;
