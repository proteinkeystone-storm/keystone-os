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
//     ai_max_tokens   : number                              // budget Gemma 4
//
//     validate(template_data: object) : string[]            // erreurs vides = OK
//
//     buildAiPrompt(qrData, scanCtx) : {system, user}       // → Workers AI
//       qrData = { metier_brief, name, qr_type, mode, template_id, template_data, ... }
//       scanCtx = { country, device, os, ua, target_url, qr_type, encoded_payload }
//
//     renderHTML(qrData, scanCtx) : string                  // HTML interstitiel
//       Renvoie une page HTML complète, mobile-first, Apple Premium.
//       Le slot dynamique (phrase IA) est rempli en JS inline via fetch
//       /api/smartqr/generate-interstitial.
//
//     fetchLiveData?(env, short_id) : Promise<object>       // optionnel (tombola etc.)
//   }
// ══════════════════════════════════════════════════════════════════

import phraseSimple    from './phrase-simple.js';
// V2 — Famille Immobilier (3 templates)
import panneauAVendre  from './panneau-a-vendre.js';
import visiteVirtuelle from './visite-virtuelle.js';
import demandeRappel   from './demande-rappel.js';

const TEMPLATES = {
  [phraseSimple.id]:    phraseSimple,
  [panneauAVendre.id]:  panneauAVendre,
  [visiteVirtuelle.id]: visiteVirtuelle,
  [demandeRappel.id]:   demandeRappel,
};

/**
 * Retourne le template correspondant à l'id, ou phrase-simple par
 * défaut (compat backward : les Smart QR créés avant V2 n'ont pas
 * de template_id, ils basculent automatiquement sur phrase-simple).
 */
export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES['phrase-simple'];
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
