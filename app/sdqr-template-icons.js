// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Icônes outline des templates Smart QR (V4.5)
// ───────────────────────────────────────────────────────────────────
// Pictogrammes SVG outline monochromes (style Lucide / Feather) pour
// les cards des templates dans le studio SDQR. Cohérence avec la
// charte Keystone : stroke 1.75, no fill, currentColor héritée.
//
// Avant V4.5 : les templates utilisaient des emojis colorés (🎰 🎫
// 🎁 ❓) qui cassaient l'harmonie visuelle du Dashboard et du K-Store.
// V4.5 (2026-05-26) : pictos outline harmonisés.
//
// Usage côté studio :
//   import { getTemplateIconSvg } from './sdqr-template-icons.js';
//   const svg = getTemplateIconSvg('machine-a-sous') || template.icon;
// ══════════════════════════════════════════════════════════════════

// Helper interne : génère un SVG outline avec les attributs Keystone
function _svg(paths, viewBox = '0 0 24 24') {
  return `<svg viewBox="${viewBox}" fill="none" stroke="currentColor"
                stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
                width="28" height="28" aria-hidden="true">${paths}</svg>`;
}

export const TEMPLATE_ICONS = {
  // Storytelling Brand : clapperboard / pellicule (film Lucide)
  'storytelling-brand': _svg(`
    <rect x="2" y="2" width="20" height="20" rx="2.18"/>
    <line x1="7"  y1="2"  x2="7"  y2="22"/>
    <line x1="17" y1="2"  x2="17" y2="22"/>
    <line x1="2"  y1="12" x2="22" y2="12"/>
    <line x1="2"  y1="7"  x2="7"  y2="7"/>
    <line x1="2"  y1="17" x2="7"  y2="17"/>
    <line x1="17" y1="17" x2="22" y2="17"/>
    <line x1="17" y1="7"  x2="22" y2="7"/>
  `),

  // Compte à rebours : sablier (hourglass Lucide)
  'countdown-produit': _svg(`
    <path d="M5 22h14"/>
    <path d="M5 2h14"/>
    <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/>
    <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>
  `),

  // Machine à sous : 3 cylindres verticaux dans un cadre (custom Keystone)
  'machine-a-sous': _svg(`
    <rect x="3" y="5" width="18" height="14" rx="2"/>
    <line x1="9"  y1="5" x2="9"  y2="19"/>
    <line x1="15" y1="5" x2="15" y2="19"/>
    <circle cx="6"  cy="12" r="1.2"/>
    <circle cx="12" cy="12" r="1.2"/>
    <circle cx="18" cy="12" r="1.2"/>
  `),

  // Carte à gratter : ticket avec encoches (ticket Lucide)
  'carte-a-gratter': _svg(`
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/>
    <path d="M13 5v2"/>
    <path d="M13 17v2"/>
    <path d="M13 11v2"/>
  `),

  // Carte de fidélité : carte + checks (3 tampons sur une carte)
  'carte-fidelite': _svg(`
    <rect x="3" y="6" width="18" height="13" rx="2"/>
    <circle cx="8"  cy="13" r="1.4"/>
    <circle cx="12" cy="13" r="1.4"/>
    <circle cx="16" cy="13" r="1.4"/>
    <line x1="6.6" y1="13" x2="7.4" y2="13.6"/>
    <line x1="7.4" y1="13.6" x2="9"  y2="12.2"/>
    <line x1="10.6" y1="13" x2="11.4" y2="13.6"/>
    <line x1="11.4" y1="13.6" x2="13" y2="12.2"/>
  `),

  // Boîte cadeau : boîte avec ruban (gift Lucide)
  'boite-cadeau': _svg(`
    <polyline points="20 12 20 22 4 22 4 12"/>
    <rect x="2" y="7" width="20" height="5"/>
    <line x1="12" y1="22" x2="12" y2="7"/>
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
  `),

  // Concierge immobilier (VEFA) : cloche de comptoir (concierge-bell Lucide)
  'concierge': _svg(`
    <path d="M3 20a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1Z"/>
    <path d="M20 16a8 8 0 1 0-16 0"/>
    <path d="M12 4v4"/>
    <path d="M10 4h4"/>
  `),

  // Réseaux sociaux : 3 nœuds reliés (share-2 Lucide)
  'reseaux-sociaux': _svg(`
    <circle cx="18" cy="5"  r="3"/>
    <circle cx="6"  cy="12" r="3"/>
    <circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="10.51" x2="15.42" y2="6.49"/>
    <line x1="8.59" y1="13.49" x2="15.42" y2="17.51"/>
  `),

  // Carte de visite : carte avec avatar (contact / id-card)
  'carte-visite': _svg(`
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <circle cx="8" cy="10" r="2.2"/>
    <path d="M4.5 16.5c0-1.9 1.6-3 3.5-3s3.5 1.1 3.5 3"/>
    <line x1="14.5" y1="9.5"  x2="19" y2="9.5"/>
    <line x1="14.5" y1="13.5" x2="19" y2="13.5"/>
  `),
};

/**
 * Retourne le fragment SVG outline pour un template id, ou null si
 * inconnu (laissant le caller fallback sur template.icon legacy).
 */
export function getTemplateIconSvg(id) {
  return TEMPLATE_ICONS[id] || null;
}
