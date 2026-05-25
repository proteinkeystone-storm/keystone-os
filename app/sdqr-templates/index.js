// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Templates Registry (Frontend SDQR)
// ───────────────────────────────────────────────────────────────────
// Registry symétrique au registry Worker (workers/src/routes/smart-templates/).
// Chaque template définit :
//   - métadonnées (id, label, description, icon, tier_required)
//   - fields[]  → schéma déclaratif consommé par master-renderer.renderField()
//   - validate(template_data) → erreurs vides = OK
//   - previewHTML(template_data) → preview live (optionnel, futur)
//
// Pour ajouter un nouveau template côté Frontend :
//   1. Créer ./<id>.js avec un export default
//   2. L'ajouter au map TEMPLATES ci-dessous
//   3. Créer le pendant côté Worker (workers/src/routes/smart-templates/<id>.js)
// ══════════════════════════════════════════════════════════════════

import phraseSimple from './phrase-simple.js';
// V4 (à venir, brief BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md) :
// 7 templates d'expérience d'attente interactive (storytelling brand,
// machine à sous, carte à gratter, compte à rebours, quiz, fidélité,
// boîte cadeau). Les anciens templates V2+V3 ont été supprimés le
// 24/05 car ils faisaient doublon avec le site web des entreprises.

const TEMPLATES = {
  [phraseSimple.id]: phraseSimple,
};

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES['phrase-simple'];
}

export function listTemplates() {
  return Object.values(TEMPLATES);
}

export function isKnownTemplate(id) {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, id);
}

// Plan minimum requis pour utiliser un template (pour gating UI).
// Mappé sur les plans Keystone : starter < pro < max.
// Pricing géré ailleurs (cf. parking_lot.md) — ici on déclare juste les tiers.
const TIER_ORDER = { starter: 1, pro: 2, max: 3, admin: 99 };

export function canUseTemplate(templateId, userPlan) {
  const t = getTemplate(templateId);
  if (!t) return false;
  const required = TIER_ORDER[t.tier_required] || 1;
  const user     = TIER_ORDER[(userPlan || '').toLowerCase()] || 0;
  return user >= required;
}
