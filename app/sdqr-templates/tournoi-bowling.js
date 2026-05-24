// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · tournoi-bowling (V3 Loisirs)
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'tournoi-bowling',
  label:           'Tournoi / compétition',
  description:     'Tournoi loisirs (bowling/billard/escape/karting) avec compteur joueurs, jackpot + IA d\'urgence.',
  icon:            '🏆',
  tier_required:   'pro',

  fields: [
    { id: 'nom_etablissement', label: 'Nom du lieu',          type: 'text', required: true, span: 'full',
      placeholder: 'Bowling Strike · Toulon' },
    { id: 'nom_tournoi',       label: 'Nom du tournoi',        type: 'text', required: true, span: 'full',
      placeholder: 'Open du Printemps 2026' },
    { id: 'activite',          label: 'Activité',              type: 'select',
      options: ['Bowling', 'Billard', 'Karting', 'Escape Game', 'Laser Game', 'Paintball', 'Mini-golf', 'Fléchettes', 'Jeu vidéo'] },
    { id: 'jackpot',           label: 'Récompense / jackpot',  type: 'text',
      placeholder: '500 € + trophée' },
    { id: 'places_initiales',  label: 'Places initiales',      type: 'number',
      placeholder: '32' },
    { id: 'joueurs_inscrits',  label: 'Joueurs déjà inscrits', type: 'number',
      placeholder: '24' },
    { id: 'date_finale',       label: 'Date finale',           type: 'text',
      placeholder: 'Sam 15/06 · 20h' },
    { id: 'prix_inscription',  label: 'Prix inscription',      type: 'text',
      placeholder: '25 €' },
  ],

  validate(template_data) {
    const errors = [];
    if (!template_data?.nom_etablissement?.trim()) errors.push('Le nom du lieu est obligatoire.');
    if (!template_data?.nom_tournoi?.trim())       errors.push('Le nom du tournoi est obligatoire.');
    return errors;
  },

  summary(template_data) {
    return template_data?.nom_tournoi
      ? `${template_data.nom_tournoi} — ${template_data.nom_etablissement || ''}`
      : 'Tournoi — Smart QR';
  },
};

export default TEMPLATE;
