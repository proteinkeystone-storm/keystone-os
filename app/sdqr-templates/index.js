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

import phraseSimple    from './phrase-simple.js';
// V2 — Famille Immobilier (3 templates)
import panneauAVendre  from './panneau-a-vendre.js';
import visiteVirtuelle from './visite-virtuelle.js';
import demandeRappel   from './demande-rappel.js';
// V3 — Famille Restauration (4 templates)
import menuDuJour       from './menu-du-jour.js';
import carteVins        from './carte-vins.js';
import formuleMidi      from './formule-midi.js';
import evenementSpecial from './evenement-special.js';
// V3 — Famille Loisirs/Bowling (3 templates)
import tournoiBowling      from './tournoi-bowling.js';
import anniversaireEnfant  from './anniversaire-enfant.js';
import happyHour           from './happy-hour.js';

const TEMPLATES = {
  [phraseSimple.id]:        phraseSimple,
  [panneauAVendre.id]:      panneauAVendre,
  [visiteVirtuelle.id]:     visiteVirtuelle,
  [demandeRappel.id]:       demandeRappel,
  [menuDuJour.id]:          menuDuJour,
  [carteVins.id]:           carteVins,
  [formuleMidi.id]:         formuleMidi,
  [evenementSpecial.id]:    evenementSpecial,
  [tournoiBowling.id]:      tournoiBowling,
  [anniversaireEnfant.id]:  anniversaireEnfant,
  [happyHour.id]:           happyHour,
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
