// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · menu-du-jour (V3 Resto)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'menu-du-jour',
  label:           'Menu du jour',
  description:     'Carte du jour avec entrées / plats / desserts + IA qui suggère le coup de cœur.',
  icon:            '🍽',
  tier_required:   'pro',

  fields: [
    { id: 'nom_etablissement', label: 'Nom du restaurant', type: 'text', required: true, span: 'full',
      placeholder: 'Le Bistrot du Cours · Toulon' },
    { id: 'specialite',        label: 'Spécialité de la maison', type: 'text', span: 'full',
      placeholder: 'Cuisine méditerranéenne · poisson frais' },
    { id: 'entrees',           label: 'Entrées (1 par ligne · format "Nom — Prix")', type: 'textarea', span: 'full',
      placeholder: 'Tartare au couteau — 14€\nSoupe de poisson maison — 12€' },
    { id: 'plats',             label: 'Plats (1 par ligne · format "Nom — Prix")', type: 'textarea', required: true, span: 'full',
      placeholder: 'Risotto cèpes — 22€\nLoup grillé entier — 32€\nFilet de bœuf, jus court — 28€' },
    { id: 'desserts',          label: 'Desserts (1 par ligne · format "Nom — Prix")', type: 'textarea', span: 'full',
      placeholder: 'Tarte fine pommes — 9€\nFondant chocolat — 10€' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('Le nom du restaurant est obligatoire.');
    if (!template_data?.plats?.trim())             errors.push('Au moins un plat est obligatoire.');
    return errors;
  },

  summary(template_data) {
    return template_data?.nom_etablissement
      ? `Menu — ${template_data.nom_etablissement}`
      : 'Menu du jour — Smart QR';
  },
};

export default TEMPLATE;
