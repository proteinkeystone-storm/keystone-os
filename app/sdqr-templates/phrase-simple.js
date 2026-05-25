// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · phrase-simple
// ───────────────────────────────────────────────────────────────────
// Template historique : 1 phrase IA + titre court. Le seul champ
// métier configurable est le brief — mais ce champ est partagé entre
// TOUS les futurs templates, donc on le déclare dans le shell SDQR
// (sdqr.js), pas dans le template. Ici fields[] = [] (purement IA).
//
// Le futur template "menu-du-jour" déclarera lui-même ses fields
// (items[], image cover_id, etc.) dans ce registry.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'phrase-simple',
  label:           'Phrase simple',
  description:     '1 phrase IA contextuelle + bouton "Continuer". Le minimum pour démarrer en Smart QR.',
  icon:            '✦',
  tier_required:   'starter',

  // fields[] : déclaratif, consommé par master-renderer.renderField()
  // Vide pour ce template : le brief métier est porté par le shell SDQR.
  fields: [],

  validate(template_data) {
    return [];
  },

  // Aperçu textuel pour la liste/sélecteur (sera étendu en preview HTML
  // visuelle dans une future itération).
  summary(template_data) {
    return 'Une phrase IA chaleureuse adaptée au scanneur, suivie d\'un bouton de redirection.';
  },

  // V4.1-design : mini-preview animée révélée quand la card est active.
  // Doit être pure CSS (aucun JS), s'auto-anime en boucle.
  previewMini() {
    return `<div class="sq-mini-phrase">Bonsoir, votre destination est prête</div>`;
  },
};

export default TEMPLATE;
