// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · demande-rappel (V2 Immo)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'demande-rappel',
  label:           'Demande de rappel',
  description:     'Carte de visite numérique avec CTAs "M\'appeler" + "Demander un rappel". Phrase IA contextualise la dispo.',
  icon:            '☎',
  tier_required:   'pro',

  fields: [
    { id: 'nom_agent',         label: 'Nom de l\'agent', type: 'text', required: true, span: 'full',
      placeholder: 'Stéphane Benedetti' },
    { id: 'agence',            label: 'Agence',          type: 'text', span: 'full',
      placeholder: 'Protein Immobilier — Toulon' },
    { id: 'tel_agent',         label: 'Téléphone',       type: 'tel',
      placeholder: '+33 6 12 34 56 78' },
    { id: 'creneau_default',   label: 'Disponibilité affichée', type: 'text',
      placeholder: 'Lun-ven 9h-19h · Sam matin' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_agent?.trim()) errors.push('Le nom de l\'agent est obligatoire.');
    return errors;
  },

  summary(template_data) {
    return template_data?.nom_agent
      ? `Carte ${template_data.nom_agent}`
      : 'Demande de rappel — Smart QR';
  },
};

export default TEMPLATE;
