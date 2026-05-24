// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · panneau-a-vendre (V2 Immo)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'panneau-a-vendre',
  label:           'Panneau À vendre',
  description:     'Fiche bien complète sur scan d\'un panneau "À vendre". Image, prix, surface, DPE, points forts + phrase IA.',
  icon:            '🏠',
  tier_required:   'pro',

  fields: [
    { id: 'titre_bien',   label: 'Titre du bien',       type: 'text',     required: true,  span: 'full',
      placeholder: 'Maison T5 vue mer · Le Mourillon' },
    { id: 'prix',         label: 'Prix',                type: 'text',     required: true,
      placeholder: '890 000 €' },
    { id: 'surface',      label: 'Surface · pièces',    type: 'text',
      placeholder: '180 m² · 4 ch · 2 sdb' },
    { id: 'dpe',          label: 'DPE',                 type: 'select',
      options: ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] },
    { id: 'points_forts', label: 'Points forts',        type: 'textarea', span: 'full',
      placeholder: '3-5 lignes courtes :\n• Vue mer panoramique\n• Garage 2 véhicules\n• Climatisation réversible' },
    { id: 'cover_url',    label: 'Photo principale (URL)', type: 'url',   span: 'full',
      placeholder: 'https://… (image hébergée — upload à venir en V3)' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.titre_bien?.trim()) errors.push('Le titre du bien est obligatoire.');
    if (!template_data?.prix?.trim())       errors.push('Le prix est obligatoire.');
    return errors;
  },

  summary(template_data) {
    return template_data?.titre_bien || 'Bien à vendre — Smart QR';
  },
};

export default TEMPLATE;
