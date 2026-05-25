// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · countdown-produit (V4.1)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/countdown-produit.js.
// Définit les fields propriétaire : produit, date de sortie, visuel.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'countdown-produit',
  label:           'Compte à rebours produit',
  description:     'Countdown J/H/M/S jusqu\'à une date précise. Idéal lancement, drop, sortie, ouverture, soldes flash.',
  icon:            '⏳',
  tier_required:   'pro',

  fields: [
    {
      id: 'nom_produit', type: 'text', label: 'Nom du produit / événement', required: true,
      placeholder: 'Ex: Drop Sneaker Edition Limitée', span: 'full',
    },
    {
      id: 'date_sortie', type: 'datetime-local', label: 'Date & heure de sortie', required: true,
      span: 'full',
    },
    {
      id: 'nom_marque', type: 'text', label: 'Nom de la marque',
      placeholder: 'Ex: Atelier Sud', span: 'full',
    },
    {
      id: 'teaser_text', type: 'textarea', label: 'Teaser (240 caractères max)',
      placeholder: 'Une phrase qui donne envie d\'attendre…', span: 'full',
    },
    {
      id: 'logo_url', type: 'url', label: 'URL du logo',
      placeholder: 'https://…', span: 'full',
    },
    {
      id: 'visuel_url', type: 'url', label: 'URL du visuel produit/teaser',
      placeholder: 'https://…', span: 'full',
    },
    {
      id: 'accent_color', type: 'color', label: 'Couleur d\'accent',
      default: '#7c8af9',
    },
    {
      id: 'compte_scans', type: 'checkbox', label: 'Afficher le nombre de scans en attente (futur)',
    },
  ],

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_produit || !String(d.nom_produit).trim()) {
      errors.push('Le nom du produit est obligatoire.');
    }
    if (!d.date_sortie) {
      errors.push('La date de sortie est obligatoire.');
    } else {
      const t = new Date(d.date_sortie).getTime();
      if (!Number.isFinite(t)) {
        errors.push('La date de sortie est invalide.');
      }
    }
    return errors;
  },

  summary(template_data) {
    const d = template_data || {};
    const nom = (d.nom_produit || 'Produit').toString().trim();
    if (!d.date_sortie) return `Countdown « ${nom} »`;
    const dt = new Date(d.date_sortie);
    if (!Number.isFinite(dt.getTime())) return `Countdown « ${nom} »`;
    const dateFr = dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    return `Countdown « ${nom} » — ${dateFr}`;
  },

  // V4.1-design : mini-preview animée. 4 cells J/H/M/S avec le dernier
  // qui ticke (anim tc-tick définie dans app/style.css).
  previewMini() {
    return `<div class="sq-mini-cd">
      <div class="sq-mini-cd-cell"><div class="sq-mini-cd-num">03</div><div class="sq-mini-cd-unit">J</div></div>
      <div class="sq-mini-cd-cell"><div class="sq-mini-cd-num">12</div><div class="sq-mini-cd-unit">H</div></div>
      <div class="sq-mini-cd-cell"><div class="sq-mini-cd-num">34</div><div class="sq-mini-cd-unit">M</div></div>
      <div class="sq-mini-cd-cell"><div class="sq-mini-cd-num">22</div><div class="sq-mini-cd-unit">S</div></div>
    </div>`;
  },
};

export default TEMPLATE;
