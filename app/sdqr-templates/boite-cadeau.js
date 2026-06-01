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

  // Mini-preview : boîte cadeau SVG aux couleurs de l'animation Lottie
  // (corps violet, ruban + nœud vert) qui flotte doucement. Plafonnée via
  // .sq-mini-gift (style.css) → ne s'étire plus quand la carte est sélectionnée.
  previewMini() {
    return `<div class="sq-mini-gift"><svg viewBox="0 0 120 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="gbx" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b3f86"/><stop offset="1" stop-color="#352a63"/></linearGradient>
        <linearGradient id="grb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93d654"/><stop offset="1" stop-color="#5fa12f"/></linearGradient>
      </defs>
      <rect x="27" y="55" width="66" height="56" rx="5" fill="url(#gbx)"/>
      <rect x="53" y="55" width="14" height="56" fill="url(#grb)"/>
      <rect x="19" y="43" width="82" height="17" rx="4" fill="#574a96"/>
      <rect x="53" y="43" width="14" height="17" fill="url(#grb)"/>
      <path d="M60 41 C 60 30 52 22 44 25 C 38 27 39 36 47 39 C 52 41 56 41 60 41 Z" fill="url(#grb)"/>
      <path d="M60 41 C 60 30 68 22 76 25 C 82 27 81 36 73 39 C 68 41 64 41 60 41 Z" fill="url(#grb)"/>
      <path d="M55 40 L51 51 L60 47 L69 51 L65 40 Z" fill="#5fa12f"/>
      <circle cx="60" cy="37" r="6" fill="#7cc23f"/>
    </svg></div>`;
  },
};

export default TEMPLATE;
