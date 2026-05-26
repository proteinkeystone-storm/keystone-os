// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · machine-a-sous (V4.3)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/machine-a-sous.js.
// L'aléatoire et le stock sont gérés authoritative côté Worker via
// l'endpoint /api/smartqr/game-play.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'machine-a-sous',
  label:           'Machine à sous',
  description:     '3 cylindres qui tournent et s\'arrêtent en cascade. Vrai gain ou perte selon le taux que tu paramètres.',
  icon:            '🎰',
  tier_required:   'pro',

  fields: [
    {
      id: 'nom_marque', type: 'text', label: 'Nom de la marque', required: true,
      placeholder: 'Ex: Café du Port', span: 'full',
    },
    {
      id: 'symboles_cylindre', type: 'textarea',
      label: 'Symboles des cylindres (5 à 10, 1 par ligne — emojis ou caractères)',
      placeholder: '🍒\n🍋\n⭐\n🔔\n💎\n7️⃣',
      default: '🍒\n🍋\n⭐\n🔔\n💎\n7️⃣',
      span: 'full',
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
      placeholder: 'Bravo ! Code GLACE50 valable jusqu\'au 31/08, à montrer en caisse.',
      span: 'full',
    },
    {
      id: 'message_perte', type: 'textarea',
      label: 'Message si perdu',
      placeholder: 'Pas de chance, retente demain !',
      span: 'full',
    },
    {
      id: 'un_jeu_par_appareil', type: 'checkbox',
      label: 'Limiter à 1 jeu par appareil (recommandé — permet au gagnant de rescanner pour revoir son code)',
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
    return `Machine à sous « ${nom} » — ${taux}% de gain`;
  },

  // V4.3 — mini-preview animée : 3 mini-cylindres qui tournent en boucle.
  // CSS-only via @keyframes définies dans app/style.css (.sq-mini-slot / tc-slot-roll).
  previewMini() {
    return `<div class="sq-mini-slot">
      <div class="sq-mini-slot-cell"><div class="sq-mini-slot-strip">🍒🍋⭐</div></div>
      <div class="sq-mini-slot-cell"><div class="sq-mini-slot-strip sq-mini-slot-strip--mid">🔔💎🍒</div></div>
      <div class="sq-mini-slot-cell"><div class="sq-mini-slot-strip sq-mini-slot-strip--slow">7️⃣⭐💎</div></div>
    </div>`;
  },
};

export default TEMPLATE;
