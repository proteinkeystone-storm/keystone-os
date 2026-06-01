// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · boite-cadeau (V4.2)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/boite-cadeau.js.
// Pas d'état serveur — le code promo est fixe et identique pour tous
// les scanneurs (V4.3 a son code WIN unique par joueur, V4.2 non).
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'boite-cadeau',
  label:           'Boîte cadeau',
  description:     'Boîte 3D qui s\'ouvre au tap, paillettes dorées, reveal du code promo + ton message personnalisé.',
  icon:            '🎁',
  tier_required:   'pro',

  fields: [
    {
      id: 'nom_marque', type: 'text', label: 'Nom de la marque', required: true,
      placeholder: 'Ex: Boutique Solène', span: 'full',
    },
    {
      id: 'occasion', type: 'text',
      label: 'Occasion (affichée en sous-titre — anniversaire, Noël, Saint-Valentin…)',
      placeholder: 'Ex: Saint Valentin',
      span: 'full',
    },
    {
      id: 'code_promo', type: 'text', label: 'Code promo (à utiliser en caisse)', required: true,
      placeholder: 'Ex: SAINT-VAL-2026', span: 'full',
    },
    {
      id: 'valeur_offre', type: 'text', label: 'Valeur de l\'offre',
      placeholder: 'Ex: -25% sur tout', span: 'full',
    },
    {
      id: 'validite', type: 'text', label: 'Validité',
      placeholder: 'Ex: Valable jusqu\'au 14/02', span: 'full',
    },
    {
      id: 'couleur_boite', type: 'color', label: 'Couleur de la boîte',
      default: '#7c1d1d',
    },
    {
      id: 'couleur_ruban', type: 'color', label: 'Couleur du ruban',
      default: '#e11d48',
    },
    {
      id: 'logo_url', type: 'image', label: 'Logo (optionnel)',
      span: 'full',
    },
    {
      id: 'accent_color', type: 'color', label: 'Couleur d\'accent',
      default: '#e11d48',
    },
  ],

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    if (!d.code_promo || !String(d.code_promo).trim()) {
      errors.push('Le code promo est obligatoire.');
    }
    return errors;
  },

  summary(template_data) {
    const d = template_data || {};
    const nom = (d.nom_marque || 'Marque').toString().trim();
    const occ = (d.occasion   || '').toString().trim();
    return occ ? `Boîte cadeau « ${nom} » — ${occ}` : `Boîte cadeau « ${nom} »`;
  },

  // Mini-preview animée : boîte cadeau qui shake doucement, ruban + noeud
  previewMini() {
    return `<div class="sq-mini-gift">
      <div class="sq-mini-gift-box"></div>
      <div class="sq-mini-gift-ribbon-h"></div>
      <div class="sq-mini-gift-ribbon-v"></div>
      <div class="sq-mini-gift-knot"></div>
    </div>`;
  },
};

export default TEMPLATE;
