// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · evenement-special (V3 Resto)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'evenement-special',
  label:           'Événement spécial',
  description:     'Chef invité, soirée à thème, dégustation. Date, tarif, places restantes + IA "private invitation".',
  icon:            '✨',
  tier_required:   'pro',

  fields: [
    { id: 'nom_evenement',     label: 'Nom de l\'événement', type: 'text', required: true, span: 'full',
      placeholder: 'Soirée Truffe Noire & Vin Jaune' },
    { id: 'date_evenement',    label: 'Date',                type: 'text', required: true,
      placeholder: 'Vendredi 12 juin 2026' },
    { id: 'heure',             label: 'Heure',               type: 'text',
      placeholder: '20h00' },
    { id: 'theme',             label: 'Thème / pitch court', type: 'text', span: 'full',
      placeholder: 'Un menu 6 services en accord avec les vins jaunes du Jura' },
    { id: 'description',       label: 'Description',         type: 'textarea', span: 'full',
      placeholder: 'Chef invité Pierre Martin nous fait l\'honneur d\'une soirée 100% truffe en partenariat avec le domaine X.' },
    { id: 'prix',              label: 'Tarif par personne', type: 'text',
      placeholder: '85€ /pers' },
    { id: 'places_restantes',  label: 'Places restantes',   type: 'text',
      placeholder: '8' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_evenement?.trim()) errors.push('Le nom de l\'événement est obligatoire.');
    if (!template_data?.date_evenement?.trim()) errors.push('La date est obligatoire.');
    return errors;
  },

  summary(template_data) {
    return template_data?.nom_evenement
      ? template_data.nom_evenement
      : 'Événement spécial — Smart QR';
  },
};

export default TEMPLATE;
