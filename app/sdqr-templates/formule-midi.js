// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · formule-midi (V3 Resto)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'formule-midi',
  label:           'Formule midi',
  description:     'Formule entrée+plat+dessert avec prix + horaires service + IA qui adapte selon l\'heure.',
  icon:            '🕛',
  tier_required:   'pro',

  fields: [
    { id: 'nom_etablissement', label: 'Nom du restaurant', type: 'text', required: true, span: 'full',
      placeholder: 'Le Bistrot du Cours' },
    { id: 'formule_titre',     label: 'Nom de la formule',  type: 'text', required: true, span: 'full',
      placeholder: 'Formule Express' },
    { id: 'prix',              label: 'Prix de la formule', type: 'text', required: true,
      placeholder: '19,90 €' },
    { id: 'horaires',          label: 'Horaires service',   type: 'text',
      placeholder: 'Service midi 12h-14h30' },
    { id: 'composition',       label: 'Composition de la formule', type: 'textarea', span: 'full',
      placeholder: 'Entrée du jour\nPlat du jour (poisson ou viande)\nDessert au choix\n+ café offert' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('Le nom du restaurant est obligatoire.');
    if (!template_data?.formule_titre?.trim())     errors.push('Le nom de la formule est obligatoire.');
    if (!template_data?.prix?.trim())              errors.push('Le prix est obligatoire.');
    return errors;
  },

  summary(template_data) {
    return template_data?.formule_titre
      ? `${template_data.formule_titre} — ${template_data.nom_etablissement || ''}`
      : 'Formule midi — Smart QR';
  },
};

export default TEMPLATE;
