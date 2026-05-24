// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · visite-virtuelle (V2 Immo)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'visite-virtuelle',
  label:           'Visite virtuelle',
  description:     'CTA "Lancer la visite" sur scan. Layout cinéma avec play button + phrase IA d\'invitation.',
  icon:            '▶',
  tier_required:   'pro',

  fields: [
    { id: 'titre_bien',   label: 'Titre du bien',  type: 'text', required: true, span: 'full',
      placeholder: 'Villa contemporaine · Sanary-sur-Mer' },
    { id: 'type_visite',  label: 'Type de visite', type: 'select',
      options: ['Visite 3D', 'Visite vidéo', 'Photos 360°', 'Drone aérien', 'Visite live'] },
    { id: 'agence',       label: 'Agence',         type: 'text',
      placeholder: 'Protein Immobilier — Toulon' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.titre_bien?.trim()) errors.push('Le titre du bien est obligatoire.');
    return errors;
  },

  summary(template_data) {
    return template_data?.titre_bien || 'Visite virtuelle — Smart QR';
  },
};

export default TEMPLATE;
