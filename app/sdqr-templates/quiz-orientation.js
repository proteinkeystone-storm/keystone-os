// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · quiz-orientation (V4.5)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/quiz-orientation.js.
// Pivot V4.5 (2026-05-26) : abandon de la phrase IA. Chaque réponse
// a sa propre URL de destination → routeur immédiat.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'quiz-orientation',
  label:           'Quiz d\'orientation',
  description:     'Routeur intelligent : 1 question + 2-4 réponses. Chaque tap redirige immédiatement vers la bonne page produit/service.',
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
      label: 'Réponses (2 à 4 — format emoji|libellé|URL de destination, 1 par ligne)',
      placeholder: '👶|Bébé|https://mamarque.fr/rayon-bebe\n🧒|Enfant|https://mamarque.fr/rayon-enfant\n🧑|Ado|https://mamarque.fr/rayon-ado',
      default: '🛍️|Pour moi|https://example.com/pour-moi\n🎁|Pour offrir|https://example.com/cadeaux',
      span: 'full',
      allowIcons: true,
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
    // Vérifie que chaque ligne a bien une URL (3ᵉ segment) http(s).
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split('|');
      const url = (parts[2] || '').trim();
      if (!url) {
        errors.push(`Réponse ${i + 1} : URL de destination manquante.`);
      } else if (!/^https?:\/\//i.test(url)) {
        errors.push(`Réponse ${i + 1} : URL doit commencer par http:// ou https://.`);
      }
    }
    return errors;
  },

  summary(template_data) {
    const d = template_data || {};
    const nom = (d.nom_marque || 'Marque').toString().trim();
    const q   = (d.question  || 'question').toString().trim().slice(0, 40);
    return `Quiz « ${nom} » — ${q}`;
  },

  previewMini() {
    return `<div class="sq-mini-quiz">
      <div class="sq-mini-quiz-card sq-mini-quiz-card--a">👶</div>
      <div class="sq-mini-quiz-card sq-mini-quiz-card--b">🧒</div>
      <div class="sq-mini-quiz-card sq-mini-quiz-card--c">🧑</div>
    </div>`;
  },
};

export default TEMPLATE;
