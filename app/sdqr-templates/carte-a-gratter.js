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
      id: 'lots', type: 'lots',
      label: 'Lots à gagner (jusqu\'à 3)',
      span: 'full',
    },
    {
      id: 'message_perte', type: 'textarea',
      label: 'Message si perdu',
      placeholder: 'Merci d\'avoir tenté ta chance — à bientôt !',
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
      id: 'image_fond', type: 'image',
      label: 'Image révélée sous le grattage (optionnel)',
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
    const lots = Array.isArray(d.lots) ? d.lots.filter(l => l && String(l.label || '').trim()) : [];
    if (lots.length === 0) {
      errors.push('Ajoute au moins un lot à gagner (nom + % de chance).');
    } else {
      let sum = 0;
      for (const l of lots) {
        const p = Number(l.proba);
        if (!Number.isFinite(p) || p <= 0 || p > 100) {
          errors.push(`Le % de chance du lot « ${String(l.label).trim()} » doit être entre 1 et 100.`);
          return errors;
        }
        sum += p;
      }
      if (sum > 100) errors.push(`La somme des % de chance dépasse 100 % (${sum} %). Réduis-les.`);
    }
    return errors;
  },

  summary(template_data) {
    const d = template_data || {};
    const nom = (d.nom_marque || 'Marque').toString().trim();
    const lots = Array.isArray(d.lots) ? d.lots.filter(l => l && String(l.label || '').trim()) : [];
    const tx = d.texture_grattage || 'Or';
    const n = lots.length;
    return `Carte à gratter « ${nom} » — ${tx}, ${n} lot${n > 1 ? 's' : ''}`;
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
