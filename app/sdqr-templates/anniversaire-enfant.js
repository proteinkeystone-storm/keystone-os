// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · anniversaire-enfant (V3 Loisirs)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'anniversaire-enfant',
  label:           'Anniversaire enfant',
  description:     'Package anniversaire clé en main avec inclus + créneaux + IA parent-friendly.',
  icon:            '🎂',
  tier_required:   'pro',

  fields: [
    { id: 'nom_etablissement', label: 'Nom du lieu',         type: 'text', required: true, span: 'full',
      placeholder: 'Bowling Strike · Toulon' },
    { id: 'activite_principale', label: 'Activité principale', type: 'text', span: 'full',
      placeholder: 'Pack Anniversaire Bowling + Goûter' },
    { id: 'age_min',           label: 'Âge minimum',         type: 'number',
      placeholder: '6' },
    { id: 'age_max',           label: 'Âge maximum',         type: 'number',
      placeholder: '12' },
    { id: 'prix_par_enfant',   label: 'Prix par enfant',     type: 'text', required: true,
      placeholder: '18 €' },
    { id: 'duree',             label: 'Durée totale',        type: 'text',
      placeholder: '2h' },
    { id: 'inclus',            label: 'Ce qui est inclus',   type: 'textarea', span: 'full',
      placeholder: '• 1 partie de bowling (chaussures fournies)\n• 1 boisson + 1 part de gâteau\n• Goodies enfants\n• Espace privatif réservé\n• Animation par notre équipe' },
    { id: 'creneaux_dispo',    label: 'Créneaux disponibles', type: 'text', span: 'full',
      placeholder: 'Mer/Sam/Dim 14h-16h ou 16h30-18h30' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('Le nom du lieu est obligatoire.');
    if (!template_data?.prix_par_enfant?.trim())   errors.push('Le prix par enfant est obligatoire.');
    return errors;
  },

  summary(template_data) {
    return template_data?.nom_etablissement
      ? `Anniversaire — ${template_data.nom_etablissement}`
      : 'Anniversaire — Smart QR';
  },
};

export default TEMPLATE;
