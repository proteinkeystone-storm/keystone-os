// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · storytelling-brand (V4.1)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/storytelling-brand.js.
// Définit les fields propriétaire qui alimentent template_data lors
// de la création d'un Smart QR depuis le studio SDQR.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'storytelling-brand',
  label:           'Storytelling Brand',
  description:     'Séquence motion graphics 3 actes (logo, slogan, visuel). Idéal première rencontre avec une marque.',
  icon:            '🎬',
  tier_required:   'pro',

  fields: [
    {
      id: 'nom_marque', type: 'text', label: 'Nom de la marque', required: true,
      placeholder: 'Ex: Maison Lumière', span: 'full',
    },
    {
      id: 'slogan', type: 'text', label: 'Slogan (max 120 caractères)',
      placeholder: 'Ex: L\'art de bien recevoir', span: 'full',
    },
    {
      id: 'logo_url', type: 'image', label: 'Logo (PNG transparent ou SVG idéal)',
      span: 'full',
    },
    {
      id: 'visuel_url', type: 'image', label: 'Visuel brand (photo 16/9 idéale)',
      span: 'full',
    },
    {
      id: 'accent_color', type: 'color', label: 'Couleur d\'accent',
      default: '#7c8af9',
    },
    {
      id: 'style_motion', type: 'select', label: 'Style de motion',
      options: ['Élégant', 'Dynamique', 'Minimaliste'],
      default: 'Élégant',
    },
  ],

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    return errors;
  },

  summary(template_data) {
    const d = template_data || {};
    const nom = (d.nom_marque || 'Marque').toString().trim();
    const slogan = (d.slogan || '').toString().trim();
    return slogan
      ? `Storytelling « ${nom} » — ${slogan.slice(0, 60)}`
      : `Storytelling « ${nom} »`;
  },

  // V4.1-design : mini-preview animée. Logo qui scale-in + slogan
  // typewriter, en boucle. CSS-only via @keyframes définies dans
  // app/style.css (.sq-mini-story / tc-logo-in / tc-type / tc-caret).
  previewMini() {
    return `<div class="sq-mini-story">
      <div class="sq-mini-story-logo">M</div>
      <div class="sq-mini-story-slogan">L'art de bien recevoir</div>
    </div>`;
  },
};

export default TEMPLATE;
