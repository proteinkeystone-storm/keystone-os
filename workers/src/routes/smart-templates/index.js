// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Templates Registry (Worker side)
// ───────────────────────────────────────────────────────────────────
// Registry central des templates d'interstitiel Smart QR. Chaque
// template est un module qui implémente le contrat documenté ci-dessous.
//
// Pour ajouter un nouveau template :
//   1. Créer ./<id>.js avec un export default qui respecte le contrat
//   2. L'ajouter au map TEMPLATES ci-dessous
//
// Cohérent avec la doctrine "Zero Hard-Coding" du CLAUDE.md :
// le dispatcher (qr.js → handleSmartQrInterstitial) ne fait que
// router vers le bon template ; toute la logique métier est dans
// le template lui-même.
//
// Contrat d'un template (TypeScript-ish pour doc) :
//
//   {
//     id              : string                              // unique
//     label           : string                              // affiché studio
//     tier_required   : 'starter'|'pro'|'max'               // gating
//
//     validate(template_data: object) : string[]            // erreurs vides = OK
//
//     renderHTML(qrData, scanCtx) : string                  // HTML interstitiel
//       Renvoie une page HTML complète, mobile-first, Apple Premium.
//       qrData = { smart_title, smart_message, name, qr_type, mode, template_id, template_data, ... }
//       scanCtx = { country, device, os, ua, target_url, qr_type, encoded_payload }
//       Le titre + message sont saisis par le propriétaire et rendus en
//       statique côté serveur (plus d'IA depuis 2026-05-30).
//
//     fetchLiveData?(env, short_id) : Promise<object>       // optionnel (tombola etc.)
//   }
// ══════════════════════════════════════════════════════════════════

import storytellingBrand from './storytelling-brand.js';
import countdownProduit  from './countdown-produit.js';
import machineASous     from './machine-a-sous.js';
import carteAGratter    from './carte-a-gratter.js';
import carteFidelite   from './carte-fidelite.js';
import boiteCadeau     from './boite-cadeau.js';
import concierge       from './concierge.js';
// Pages hébergées « Contact » (2026-06-23) : link-hub réseaux + carte de visite.
import reseauxSociaux  from './reseaux-sociaux.js';
import carteVisite     from './carte-visite.js';
// V4 (brief BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md) :
// V4.1 livré 2026-05-26 (storytelling-brand + countdown-produit).
// V4.3 livré 2026-05-26 (machine-a-sous + carte-a-gratter) — vrais jeux
// avec aléatoire authoritative serveur via /api/smartqr/game-play.
// V4.4 livré 2026-05-26 (carte-fidelite) — état cumulatif cross-scan
// via /api/smartqr/loyalty-stamp + table D1 smartqr_loyalty_stamps.
// V4.2 livré 2026-05-26 (boite-cadeau).
// 2026-05-30 : IA retirée de tous les templates (titre + message saisis
// en direct par le propriétaire) ; templates phrase-simple et
// quiz-orientation supprimés.
// Concierge VEFA (brief BRIEF_CONCIERGE_VEFA.md) : 1er template à CHAT
// LIVE (endpoint /api/smartqr/concierge, Sprint 2). L'IA y regagne sa
// place car l'entrée (question libre du visiteur) exige du jugement —
// distinct des interstitiels figés ci-dessus.

const TEMPLATES = {
  [storytellingBrand.id]: storytellingBrand,
  [countdownProduit.id]:  countdownProduit,
  [machineASous.id]:      machineASous,
  [carteAGratter.id]:     carteAGratter,
  [carteFidelite.id]:     carteFidelite,
  [boiteCadeau.id]:       boiteCadeau,
  [concierge.id]:         concierge,
  [reseauxSociaux.id]:    reseauxSociaux,
  [carteVisite.id]:       carteVisite,
};

/**
 * Retourne le template correspondant à l'id, ou storytelling-brand par
 * défaut (compat backward : les Smart QR créés avant V2 — ou ceux qui
 * pointaient sur les templates supprimés phrase-simple/quiz-orientation —
 * basculent automatiquement sur storytelling-brand).
 */
export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES['storytelling-brand'];
}

/**
 * Liste tous les templates disponibles (utilisé pour validation côté
 * API : refuser un template_id inconnu à la création).
 */
export function listTemplates() {
  return Object.values(TEMPLATES);
}

/**
 * Vérifie qu'un id est connu. Si false, le caller décide quoi faire
 * (fallback ou rejet).
 */
export function isKnownTemplate(id) {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, id);
}
