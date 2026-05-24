// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · carte-vins (V3 Resto)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'carte-vins',
  label:           'Carte des vins',
  description:     'Sélections vins / cocktails / spiritueux + IA sommelier qui propose un accord.',
  icon:            '🍷',
  tier_required:   'pro',

  fields: [
    { id: 'nom_etablissement', label: 'Nom de la maison', type: 'text', required: true, span: 'full',
      placeholder: 'La Cave des Trois Coups' },
    { id: 'type_carte',        label: 'Type de carte',    type: 'select',
      options: ['Carte des vins', 'Carte des cocktails', 'Spiritueux & digestifs', 'Bières artisanales'] },
    { id: 'selections',        label: 'Sélections (1 par ligne · "Nom — Origine — Prix")', type: 'textarea', required: true, span: 'full',
      placeholder: 'Bandol Tempier 2018 — Provence — 78€\nVin Jaune Macle 2015 — Jura — 95€\nNégroni signature — — 14€' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('Le nom de la maison est obligatoire.');
    if (!template_data?.selections?.trim())        errors.push('Au moins une sélection est obligatoire.');
    return errors;
  },

  summary(template_data) {
    return template_data?.nom_etablissement
      ? `Carte — ${template_data.nom_etablissement}`
      : 'Carte des vins — Smart QR';
  },
};

export default TEMPLATE;
