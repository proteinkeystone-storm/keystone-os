/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pricing & Entitlements (Sprint P1)
   Layer 1 · SOURCE DE VÉRITÉ UNIQUE de la grille tarifaire.
   ─────────────────────────────────────────────────────────────
   POURQUOI ce module
   ─────────────────────────────────────────────────────────────
   Avant, le pricing était éparpillé et contradictoire :
     · `plan: STARTER|PRO|MAX` dans pads-data.js (paliers MORTS),
     · `price` / `lifetimePrice` édités à la main dans l'admin,
     · quotas de crédits câblés sur les anciens plans,
     · cartes de plans en dur dans ui-renderer.js.
   Résultat : un prix affiché pouvait ne correspondre à RIEN de ce
   qui était réellement prélevé.

   Ici : UNE grille, UN endroit. Tout le reste (Key Store, Landing,
   Admin, quotas, mapping Stripe) lit ce module.

   LE MODÈLE — « une app = un prix » (façon Adobe CC)
   ─────────────────────────────────────────────────────────────
   Gratuit · Essentiel 19 · Pro 49 · Déploiement 99 · OS complet 129.
   Le client achète UNE app, ou l'OS entier. Plus de « 3 apps au
   choix », plus de sièges, plus de lifetime (tué : il détruit le
   revenu récurrent, cf. HANDOFF_PRICING_REFONTE.md §1).

   L'ENTITLEMENT — un SAC d'apps, pas un palier
   ─────────────────────────────────────────────────────────────
   Une licence ne porte plus « un plan » mais l'ensemble des apps
   qu'elle possède, stocké dans `owned_assets` (déjà en base — le
   champ existait, on lui donne enfin son vrai rôle).
   L'OS complet = la sentinelle OS_ENTITLEMENT dans ce même tableau
   → AUCUN changement de schéma D1.

   ⚠ `plan` N'EST PAS SUPPRIMÉ : il reste le champ technique qui
   pilote `devices_max` (licence-v2.js) et les invitations membres.
   Il ne décide simplement plus QUELLES apps sont ouvertes.

   FEATURE FLAG — PRICING_V2 (défaut OFF)
   ─────────────────────────────────────────────────────────────
   Tant que le flag est OFF, la résolution d'accès reste celle
   d'aujourd'hui, à l'octet près. On ne bascule qu'en P6, une fois
   Stripe refait — car afficher « 19 € » pendant que Stripe prélève
   « 49 € » est interdit (cf. §8 du handoff).
   ═══════════════════════════════════════════════════════════════ */

// ── Feature flag ───────────────────────────────────────────────
// OFF par défaut. Override local pour tester sans rien déployer :
//   localStorage.setItem('ks_pricing_v2', '1')
const PRICING_V2_DEFAULT = false;
const LS_PRICING_V2      = 'ks_pricing_v2';

export function isPricingV2() {
    try {
        const raw = localStorage.getItem(LS_PRICING_V2);
        if (raw === '1' || raw === 'true')  return true;
        if (raw === '0' || raw === 'false') return false;
    } catch (_) { /* localStorage indisponible → défaut */ }
    return PRICING_V2_DEFAULT;
}

// ── Les paliers ────────────────────────────────────────────────
// `conversations` = enveloppe mensuelle INCLUSE (P2 s'y branchera).
// Volontairement généreuse : une conversation coûte ~0,1-0,3 centime
// (barème Cloudflare mesuré le 22/07/2026, cf. handoff §3). Le quota
// est un anti-abus, PAS un centre de coût.
export const TIER = {
    FREE:        'FREE',
    ESSENTIEL:   'ESSENTIEL',
    PRO:         'PRO',
    DEPLOIEMENT: 'DEPLOIEMENT',
    OS:          'OS',
};

export const TIERS = {
    [TIER.FREE]:        { id: TIER.FREE,        label: 'Gratuit',      price: 0,   conversations: 0 },
    [TIER.ESSENTIEL]:   { id: TIER.ESSENTIEL,   label: 'Essentiel',    price: 19,  conversations: 300 },
    [TIER.PRO]:         { id: TIER.PRO,         label: 'Pro',          price: 49,  conversations: 1000 },
    [TIER.DEPLOIEMENT]: { id: TIER.DEPLOIEMENT, label: 'Déploiement',  price: 99,  conversations: 1000 },
    [TIER.OS]:          { id: TIER.OS,          label: 'OS complet',   price: 129, conversations: 3000 },
};

// ── Rangement des 14 apps ──────────────────────────────────────
// Gratuites : front-only ou zéro IA → coût ~nul, et surtout chacune
// produit un lien qui circule (flipbook, charte publique, missive)
// = acquisition virale. Ce sont les chevaux de Troie, pas des restes.
export const APP_TIER = {
    // ── Gratuit ────────────────────────────────────────────────
    'O-SEC-001':  TIER.FREE,          // Missive
    'O-BOK-001':  TIER.FREE,          // booK
    'O-Keyn-001': TIER.FREE,          // Keynapse   ⚠ cf. KEYNAPSE_VOICE_NOTE
    // ── Essentiel 19 € ─────────────────────────────────────────
    'A-COM-005':  TIER.ESSENTIEL,     // Ghost Writer   (porte anti-ChatGPT)
    'A-COM-003':  TIER.ESSENTIEL,     // Brainstorming  (porte anti-ChatGPT)
    'A-COM-004':  TIER.ESSENTIEL,     // Key Form
    'O-BRD-001':  TIER.ESSENTIEL,     // Key Brand
    'O-NET-001':  TIER.ESSENTIEL,     // networK
    // ── Pro 49 € ───────────────────────────────────────────────
    'A-COM-002':  TIER.PRO,           // Brief Prod
    'O-SOC-001':  TIER.PRO,           // Social Manager
    'O-GEO-001':  TIER.PRO,           // Sentinel
    'A-COM-001':  TIER.PRO,           // Smart Dynamic QR
    'O-DSK-001':  TIER.PRO,           // desK
    // ── Déploiement 99 € ───────────────────────────────────────
    'O-AGT-001':  TIER.DEPLOIEMENT,   // Smart Agent
};

// Keynapse : le CŒUR (bulles, zones, liens, captures, rappels) n'utilise
// aucune IA → gratuit sans réserve. Mais sa DICTÉE appelle Whisper (~46
// neurones/min) PUIS Mistral (extraction tâches/rappels) : 2 appels IA
// par mémo. TRANCHÉ le 2026-07-23 — « Gratuit, cœur seul : la dictée
// exige une app payante » → hasPaidApp() ci-dessous garde la porte, et
// une licence 100 % gratuite ne coûte alors strictement rien.
export const KEYNAPSE_VOICE_NOTE = 'O-Keyn-001';

/**
 * La licence possède-t-elle au moins UNE app payante ?
 * Clé des fonctions IA greffées sur une app gratuite (dictée Keynapse).
 * Permissif par défaut : legacy (sac null, MAX, ADMIN) → true, on ne
 * retire jamais un accès existant par surprise.
 * ⚠️ Jumeau de `hasPaidApp()` dans workers/src/lib/pricing-grid.js.
 */
export function hasPaidApp({ plan = '', ownedAssets = null } = {}) {
    const p = String(plan || '').toUpperCase();
    if (p === 'ADMIN' || p === 'MAX') return true;
    if (ownedAssets === null || ownedAssets === undefined) return true;
    if (!Array.isArray(ownedAssets)) return true;
    if (ownedAssets.includes(OS_ENTITLEMENT)) return true;
    return ownedAssets.some(id => APP_TIER[id] && APP_TIER[id] !== TIER.FREE);
}

// ── Sentinelle « OS complet » ──────────────────────────────────
// Rangée DANS owned_assets → zéro changement de schéma. Une licence
// dont le sac contient 'OS' ouvre tout le catalogue.
export const OS_ENTITLEMENT = 'OS';

// ── Apps à SURFACE PUBLIQUE ────────────────────────────────────
// Elles répondent aux clients DU client (chat, voix, QR) : leur coût
// IA scale avec le trafic d'un TIERS, pas avec l'usage de l'abonné.
// → deux modes au choix (cf. handoff §2) : « clé en main » (mode géré,
// conversations + recharge auto plafonnée) ou BYOK (clé du client,
// illimité, coût chez lui). Le mode géré n'est autorisé QU'AVEC les
// 3 garde-fous (plafond, prix > coût, voix comptée).
export const PUBLIC_SURFACE_APPS = [
    'O-AGT-001',   // Smart Agent
    'A-COM-001',   // Smart QR — le Concierge public
];

export const MODE = { MANAGED: 'MANAGED', BYOK: 'BYOK' };

export function isPublicSurfaceApp(id) {
    return PUBLIC_SURFACE_APPS.includes(id);
}

// ── Recharges & annuel ─────────────────────────────────────────
// Packs INCHANGÉS (9 €/39 €) : déjà « coût réel + petite marge ».
// Les baisser n'a aucun sens — le plancher n'est pas le coût IA
// (~0,1 ¢/conversation) mais la commission Stripe fixe (0,25 €).
export const PACKS = [
    { id: 'ks_pack_1000', conversations: 1000, price: 9 },
    { id: 'ks_pack_5000', conversations: 5000, price: 39 },
];

export const ANNUAL_MONTHS_BILLED = 10;          // −2 mois offerts
export const AUTO_RELOAD_DEFAULT_CAP_EUR = 20;   // plafond proposé par défaut

export function annualPrice(monthlyPrice) {
    return monthlyPrice * ANNUAL_MONTHS_BILLED;
}

// ── Helpers de lecture ─────────────────────────────────────────
export function tierForApp(id) {
    return APP_TIER[id] || null;
}

export function priceForApp(id) {
    const t = APP_TIER[id];
    return t ? TIERS[t].price : null;
}

export function isFreeApp(id) {
    return APP_TIER[id] === TIER.FREE;
}

export function freeAppIds() {
    return Object.keys(APP_TIER).filter(isFreeApp);
}

export function appsForTier(tierId) {
    return Object.keys(APP_TIER).filter(id => APP_TIER[id] === tierId);
}

export function allPricedAppIds() {
    return Object.keys(APP_TIER);
}

/** Conversations incluses pour un sac d'entitlements (null = OS/tout). */
export function includedConversations(ownedIds) {
    if (ownedIds === null) return TIERS[TIER.OS].conversations;
    if (!Array.isArray(ownedIds) || ownedIds.length === 0) return 0;
    if (ownedIds.includes(OS_ENTITLEMENT)) return TIERS[TIER.OS].conversations;
    // Pot commun : on additionne les enveloppes des apps possédées,
    // plafonné à celle de l'OS (sinon 5 apps > OS, incohérent).
    const sum = ownedIds.reduce((acc, id) => {
        const t = APP_TIER[id];
        return acc + (t ? TIERS[t].conversations : 0);
    }, 0);
    return Math.min(sum, TIERS[TIER.OS].conversations);
}

// ═══════════════════════════════════════════════════════════════
// RÉSOLUTION D'ACCÈS — le cœur de P1
// ═══════════════════════════════════════════════════════════════
/**
 * Résout ce qu'une licence ouvre réellement.
 *
 * @param {object} ctx
 *   @param {boolean} ctx.isAdmin      — bypass total (back-office)
 *   @param {string}  ctx.plan         — champ technique legacy (MAX = tout inclus)
 *   @param {?Array}  ctx.ownedAssets  — le SAC d'apps (null = sentinelle legacy)
 * @returns {?string[]} null = TOUT possédé · [] = rien · [...] = liste
 *
 * ORDRE DES RÈGLES (il compte) :
 *   1. ADMIN                      → tout
 *   2. plan MAX (legacy)          → tout      ← zéro régression
 *   3. ownedAssets null/absent    → tout      ← sentinelle historique
 *   4. sac contenant 'OS'         → tout      ← nouveau, opt-in
 *   5. sinon                      → le sac (+ apps gratuites si V2)
 *
 * Les règles 1-3 sont le comportement ACTUEL, à l'identique. La 4 ne
 * peut se déclencher que sur une donnée qui n'existe nulle part
 * aujourd'hui. Seule la 5 change quelque chose — et uniquement
 * derrière le flag.
 */
export function resolveEntitlements({ isAdmin = false, plan = '', ownedAssets = null } = {}) {
    if (isAdmin) return null;
    if (String(plan || '').toUpperCase() === 'MAX') return null;
    if (ownedAssets === null || ownedAssets === undefined) return null;
    if (!Array.isArray(ownedAssets)) return null;
    if (ownedAssets.includes(OS_ENTITLEMENT)) return null;

    // Sac explicite. En V2, les apps gratuites sont TOUJOURS ouvertes :
    // c'est la porte d'entrée du modèle (elles ne coûtent rien et font
    // l'acquisition). Gaté par le flag car ça élargit l'accès des
    // licences existantes — donc ce n'est pas neutre.
    if (!isPricingV2()) return ownedAssets;

    const out = new Set(ownedAssets);
    freeAppIds().forEach(id => out.add(id));
    return [...out];
}

/** La licence ouvre-t-elle tout le catalogue ? (OS, MAX legacy, admin) */
export function hasOsAccess({ isAdmin = false, plan = '', ownedAssets = null } = {}) {
    return resolveEntitlements({ isAdmin, plan, ownedAssets }) === null;
}
