/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Grille tarifaire, côté Worker (Sprint P2)
   ─────────────────────────────────────────────────────────────
   ⚠️ MIROIR de `app/lib/pricing.js`. Le front et le Worker sont deux
   bundles séparés (le Worker n'importe jamais depuis app/), d'où cette
   copie. Elle DOIT rester synchrone avec l'original.

   Filet anti-dérive : `scripts/test-pricing-entitlements.mjs` importe
   les DEUX modules et compare paliers, prix et rangement des apps. Si
   quelqu'un touche l'un sans l'autre, `npm test` casse. Ne jamais
   éditer ce fichier sans éditer son jumeau (et inversement).

   Ce qui vit ICI et PAS dans le front : rien. Ce module est un sous-
   ensemble volontairement réduit — juste ce dont le compteur de
   conversations a besoin (quota par sac d'apps).
   ═══════════════════════════════════════════════════════════════ */

export const TIER = {
  FREE:        'FREE',
  ESSENTIEL:   'ESSENTIEL',
  PRO:         'PRO',
  DEPLOIEMENT: 'DEPLOIEMENT',
  OS:          'OS',
};

export const TIERS = {
  [TIER.FREE]:        { id: TIER.FREE,        label: 'Gratuit',     price: 0,   conversations: 0 },
  [TIER.ESSENTIEL]:   { id: TIER.ESSENTIEL,   label: 'Essentiel',   price: 19,  conversations: 300 },
  [TIER.PRO]:         { id: TIER.PRO,         label: 'Pro',         price: 49,  conversations: 1000 },
  [TIER.DEPLOIEMENT]: { id: TIER.DEPLOIEMENT, label: 'Déploiement', price: 99,  conversations: 1000 },
  [TIER.OS]:          { id: TIER.OS,          label: 'OS complet',  price: 129, conversations: 3000 },
};

export const APP_TIER = {
  'O-SEC-001':  TIER.FREE,          // Missive
  'O-BOK-001':  TIER.FREE,          // booK
  'O-Keyn-001': TIER.FREE,          // Keynapse
  'A-COM-005':  TIER.ESSENTIEL,     // Ghost Writer
  'A-COM-003':  TIER.ESSENTIEL,     // Brainstorming
  'A-COM-004':  TIER.ESSENTIEL,     // Key Form
  'O-BRD-001':  TIER.ESSENTIEL,     // Key Brand
  'O-NET-001':  TIER.ESSENTIEL,     // networK
  'A-COM-002':  TIER.PRO,           // Brief Prod
  'O-SOC-001':  TIER.PRO,           // Social Manager
  'O-GEO-001':  TIER.PRO,           // Sentinel
  'A-COM-001':  TIER.PRO,           // Smart Dynamic QR
  'O-DSK-001':  TIER.PRO,           // desK
  'O-AGT-001':  TIER.DEPLOIEMENT,   // Smart Agent
};

export const OS_ENTITLEMENT = 'OS';

// ── Feature flag côté Worker (pattern BYOK_ROUTING) ────────────
// Variable d'env `PRICING_V2`. Absente/vide ⇒ OFF ⇒ le compteur garde
// EXACTEMENT le comportement legacy (quota par plan).
export function isPricingV2(env) {
  const v = String(env?.PRICING_V2 ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** Conversations incluses pour un sac d'apps. null = accès total (OS). */
export function includedConversations(ownedIds) {
  if (ownedIds === null || ownedIds === undefined) return TIERS[TIER.OS].conversations;
  if (!Array.isArray(ownedIds) || ownedIds.length === 0) return 0;
  if (ownedIds.includes(OS_ENTITLEMENT)) return TIERS[TIER.OS].conversations;
  const sum = ownedIds.reduce((acc, id) => {
    const t = APP_TIER[id];
    return acc + (t ? TIERS[t].conversations : 0);
  }, 0);
  return Math.min(sum, TIERS[TIER.OS].conversations);
}

/**
 * La licence possède-t-elle au moins UNE app payante ?
 *
 * Sert de clé aux fonctions IA greffées sur une app GRATUITE — cas
 * Keynapse : le cœur (bulles, zones, liens, rappels) n'utilise aucune
 * IA et reste gratuit, mais la DICTÉE, elle, appelle Whisper + Mistral.
 * Décision Stéphane (2026-07-23) : « Gratuit, cœur seul — la dictée
 * exige une app payante. » Ainsi une licence 100 % gratuite ne coûte
 * strictement RIEN, ce qui est toute l'idée du palier gratuit.
 *
 * Permissif par défaut : tout ce qui est legacy (sac null, MAX, ADMIN)
 * renvoie true — on ne retire jamais un accès existant par surprise.
 */
export function hasPaidApp({ plan = '', ownedAssets = null } = {}) {
  const p = String(plan || '').toUpperCase();
  if (p === 'ADMIN' || p === 'MAX') return true;
  if (ownedAssets === null || ownedAssets === undefined) return true;
  if (!Array.isArray(ownedAssets)) return true;
  if (ownedAssets.includes(OS_ENTITLEMENT)) return true;
  return ownedAssets.some(id => APP_TIER[id] && APP_TIER[id] !== TIER.FREE);
}

/**
 * Quota mensuel d'une licence sous le modèle per-app.
 * @returns {?number} null = illimité (ADMIN / MAX legacy / sac null)
 */
export function quotaForEntitlements({ plan = '', ownedAssets = null } = {}) {
  const p = String(plan || '').toUpperCase();
  if (p === 'ADMIN') return null;                 // illimité, comme avant
  if (p === 'MAX')   return null;                 // legacy « tout inclus »
  if (ownedAssets === null || ownedAssets === undefined) return null;
  if (!Array.isArray(ownedAssets)) return null;
  if (ownedAssets.includes(OS_ENTITLEMENT)) return TIERS[TIER.OS].conversations;
  return includedConversations(ownedAssets);
}
