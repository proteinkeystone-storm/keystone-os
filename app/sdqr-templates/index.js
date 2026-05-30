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

import storytellingBrand from './storytelling-brand.js';
import countdownProduit  from './countdown-produit.js';
import machineASous     from './machine-a-sous.js';
import carteAGratter    from './carte-a-gratter.js';
import carteFidelite   from './carte-fidelite.js';
import boiteCadeau     from './boite-cadeau.js';
import concierge       from './concierge.js';
// V4 (brief BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md) :
// V4.1 livré 2026-05-26 (storytelling-brand + countdown-produit).
// V4.3 livré 2026-05-26 (machine-a-sous + carte-a-gratter).
// V4.4 livré 2026-05-26 (carte-fidelite) — état cumulatif serveur.
// V4.2 livré 2026-05-26 (boite-cadeau).
// 2026-05-30 : IA retirée (titre + message saisis en direct) ; templates
// phrase-simple et quiz-orientation supprimés.
// Concierge VEFA (brief BRIEF_CONCIERGE_VEFA.md) : éditeur nesté dédié
// au Sprint 4 (programme + configs répéteur + branding couleurs/logo).

const TEMPLATES = {
  [storytellingBrand.id]: storytellingBrand,
  [countdownProduit.id]:  countdownProduit,
  [machineASous.id]:      machineASous,
  [carteAGratter.id]:     carteAGratter,
  [carteFidelite.id]:     carteFidelite,
  [boiteCadeau.id]:       boiteCadeau,
  [concierge.id]:         concierge,
};

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES['storytelling-brand'];
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
