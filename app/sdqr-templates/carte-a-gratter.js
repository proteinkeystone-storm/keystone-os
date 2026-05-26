// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · carte-a-gratter (V4.3)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/carte-a-gratter.js.
// L'aléatoire est figé serveur dès le load de la page interstitielle.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'carte-a-gratter',
  label:           'Carte à gratter',
  description:     'Carte métallique que le scanneur gratte au doigt. Reveal automatique à 60%. Très tactile.',
  icon:            '🎟️',
  tier_required:   'pro',

  fields: [
    {
      id: 'nom_marque', type: 'text', label: 'Nom de la marque', required: true,
      placeholder: 'Ex: Boulangerie Marius', span: 'full',
    },
    {
      id: 'texture_grattage', type: 'select',
      label: 'Texture de grattage',
      options: ['Or', 'Argent', 'Cuivre'],
      default: 'Or',
    },
    {
      id: 'taux_de_gain', type: 'number',
      label: 'Taux de gain (%, entre 0 et 100)',
      default: 20,
    },
    {
      id: 'lots_disponibles', type: 'number',
      label: 'Stock total de lots (vide = illimité)',
      placeholder: '50',
    },
    {
      id: 'message_gain', type: 'textarea',
      label: 'Message si gagné', required: true,
      placeholder: 'Bravo, un croissant offert avec ce QR !',
      span: 'full',
    },
    {
      id: 'message_perte', type: 'textarea',
      label: 'Message si perdu',
      placeholder: 'Pas de chance — reviens demain !',
      span: 'full',
    },
    {
      id: 'un_jeu_par_appareil', type: 'checkbox',
      label: 'Limiter à 1 grattage par appareil (recommandé — permet au gagnant de rescanner pour revoir son code)',
      default: true,
    },
    {
      id: 'logo_url', type: 'image', label: 'Logo (optionnel)',
      span: 'full',
    },
    {
      id: 'accent_color', type: 'color', label: 'Couleur d\'accent',
      default: '#c9a96e',
    },
  ],

  validate(template_data) {
    const errors = [];
    const d = template_data || {};
    if (!d.nom_marque || !String(d.nom_marque).trim()) {
      errors.push('Le nom de la marque est obligatoire.');
    }
    if (!d.message_gain || !String(d.message_gain).trim()) {
      errors.push('Le message en cas de gain est obligatoire.');
    }
    const taux = Number(d.taux_de_gain);
    if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
      errors.push('Le taux de gain doit être un nombre entre 0 et 100.');
    }
    return errors;
  },

  summary(template_data) {
    const d = template_data || {};
    const nom = (d.nom_marque || 'Marque').toString().trim();
    const taux = Number.isFinite(Number(d.taux_de_gain)) ? Number(d.taux_de_gain) : 20;
    const tx = d.texture_grattage || 'Or';
    return `Carte à gratter « ${nom} » — ${tx}, ${taux}% gain`;
  },

  // V4.3 — mini-preview : carte métal qui se gratte en boucle (un trait
  // de transparence qui balaye la surface, révélant un cœur dessous).
  previewMini() {
    return `<div class="sq-mini-scratch">
      <div class="sq-mini-scratch-hidden">✦</div>
      <div class="sq-mini-scratch-foil"></div>
      <div class="sq-mini-scratch-finger">👆</div>
    </div>`;
  },
};

export default TEMPLATE;
