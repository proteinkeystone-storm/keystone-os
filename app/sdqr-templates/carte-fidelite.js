// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · carte-fidelite (V4.4)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/carte-fidelite.js.
// L'état cumulatif (tampons cross-scan) est tenu côté Worker via D1.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'carte-fidelite',
  label:           'Carte de fidélité',
  description:     'Tampons cumulatifs scan après scan. Au Nᵉ tampon, récompense débloquée avec code à présenter en caisse.',
  icon:            '🎫',
  tier_required:   'pro',

  fields: [
    {
      id: 'nom_marque', type: 'text', label: 'Nom de la marque', required: true,
      placeholder: 'Ex: Café du Port', span: 'full',
    },
    {
      id: 'nom_recompense', type: 'text', label: 'Nom de la récompense', required: true,
      placeholder: 'Ex: Café offert', span: 'full',
    },
    {
      id: 'nb_tampons_total', type: 'number',
      label: 'Nombre de tampons à collecter (3 à 30)',
      default: 10,
    },
    {
      id: 'validite_jours', type: 'number',
      label: 'Validité du cycle (jours avant reset si non atteint)',
      default: 90,
    },
    {
      id: 'style_tampon', type: 'select',
      label: 'Style du tampon',
      default: 'encre',
      options: [
        { value: 'encre',  label: 'Tampon encré (✓)' },
        { value: 'etoile', label: 'Étoile (★)' },
        { value: 'coeur',  label: 'Cœur (♥)' },
        { value: 'logo',   label: 'Logo de la marque' },
      ],
    },
    {
      id: 'logo_url', type: 'image', label: 'Logo (recommandé pour style « Logo »)',
      span: 'full',
    },
    {
      id: 'accent_color', type: 'color', label: 'Couleur d\'accent',
      default: '#c9a96e',
    },
  ],

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    if (!d.nom_recompense || !String(d.nom_recompense).trim()) {
      errors.push('Le nom de la récompense est obligatoire.');
    }
    const n = Number(d.nb_tampons_total);
    if (!Number.isFinite(n) || n < 3 || n > 30) {
      errors.push('Le nombre de tampons doit être entre 3 et 30.');
    }
    return errors;
  },

  summary(template_data) {
    const d = template_data || {};
    const nom = (d.nom_marque || 'Marque').toString().trim();
    const rec = (d.nom_recompense || 'récompense').toString().trim();
    const n   = Number.isFinite(Number(d.nb_tampons_total)) ? Number(d.nb_tampons_total) : 10;
    return `Carte de fidélité « ${nom } » — ${rec} au ${n}ᵉ tampon`;
  },

  // Mini-preview animée : 5 cases dont 3 tamponnées, le 3ᵉ pulse en boucle.
  // CSS-only via .sq-mini-loyalty / @keyframes définis dans app/style.css.
  previewMini() {
    return `<div class="sq-mini-loyalty">
      <div class="sq-mini-loyalty-cell is-stamped">✓</div>
      <div class="sq-mini-loyalty-cell is-stamped">✓</div>
      <div class="sq-mini-loyalty-cell is-stamped sq-mini-loyalty-cell--pulse">✓</div>
      <div class="sq-mini-loyalty-cell"></div>
      <div class="sq-mini-loyalty-cell"></div>
    </div>`;
  },
};

export default TEMPLATE;
