// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · happy-hour (V3 Loisirs)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'happy-hour',
  label:           'Happy Hour',
  description:     'Tarifs réduits + plage horaire + IA qui adapte le ton selon le moment du scan (en cours / à venir / passé).',
  icon:            '🍹',
  tier_required:   'pro',

  fields: [
    { id: 'nom_etablissement', label: 'Nom du lieu',          type: 'text', required: true, span: 'full',
      placeholder: 'Le Bar des Halles' },
    { id: 'heure_debut',       label: 'Heure de début',       type: 'text',
      placeholder: '18:00' },
    { id: 'heure_fin',         label: 'Heure de fin',         type: 'text',
      placeholder: '20:00' },
    { id: 'jours',             label: 'Jours d\'application',  type: 'text', span: 'full',
      placeholder: 'Lun-ven (sauf jours fériés)' },
    { id: 'offres',            label: 'Offres à l\'ardoise',   type: 'textarea', required: true, span: 'full',
      placeholder: '• Toutes pintes — 4 €\n• Cocktails maison — 7 € au lieu de 11 €\n• Planche apéro — 9 €' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('Le nom du lieu est obligatoire.');
    if (!template_data?.offres?.trim())            errors.push('Les offres sont obligatoires.');
    return errors;
  },

  summary(template_data) {
    return template_data?.nom_etablissement
      ? `Happy Hour — ${template_data.nom_etablissement}`
      : 'Happy Hour — Smart QR';
  },
};

export default TEMPLATE;
