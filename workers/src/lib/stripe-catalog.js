/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Catalogue Stripe ↔ apps (Sprint P4)
   Layer 2 · Traduction « ce qui a été payé » → « ce qui est ouvert ».
   ─────────────────────────────────────────────────────────────
   POURQUOI ce module
   ─────────────────────────────────────────────────────────────
   Avant, un paiement donnait UN PLAN (STARTER/PRO/MAX), résolu par
   `lookup_key` avec repli sur le MONTANT (4900/9900/24900).

   Sous le modèle per-app, ce repli est MORT — et c'est le point qui
   change tout : cinq applications coûtent 19 €, cinq autres 49 €. Le
   montant ne peut plus dire LAQUELLE a été achetée. Deviner
   ouvrirait la mauvaise app ; on refuse donc de deviner.

   La résolution devient EXPLICITE, par ordre de fiabilité :
     1. `price.metadata.ks_app`      ← recommandé (posé à la main)
     2. `product.metadata.ks_app`    ← pratique : une valeur par produit
     3. convention de `lookup_key`   ← ks_app_o_agt_001 / ks_os
     4. rien → null, l'appelant journalise et n'accorde RIEN.

   Le repli par montant SURVIT pour les 3 anciens plans uniquement :
   un abonnement legacy encore vivant doit continuer de résoudre.

   VALEURS ATTENDUES de `ks_app`
   ─────────────────────────────────────────────────────────────
     · un id d'application du catalogue  → 'O-AGT-001', 'A-COM-005'…
     · 'OS'                              → l'OS complet (toutes les apps)
   Toute autre valeur est refusée (elle n'ouvrirait rien de connu).
   ═══════════════════════════════════════════════════════════════ */

import { APP_TIER, TIERS, TIER, OS_ENTITLEMENT } from './pricing-grid.js';

// ── Plans LEGACY (à conserver tant qu'un abonnement d'avant vit) ──
export const LEGACY_PRICE_LOOKUP_TO_PLAN = {
  ks_starter: 'STARTER',
  ks_pro:     'PRO',
  ks_max:     'MAX',
};
export const LEGACY_PRICE_AMOUNT_TO_PLAN = { 4900: 'STARTER', 9900: 'PRO', 24900: 'MAX' };

// ── Packs de conversations (paiement unique) ─────────────────────
export const PACK_LOOKUP_TO_CONVERSATIONS = { ks_pack_1000: 1000, ks_pack_5000: 5000 };
export const PACK_AMOUNT_TO_CONVERSATIONS = { 900: 1000, 3900: 5000 };

// ── Convention de lookup_key ─────────────────────────────────────
// 'O-AGT-001' → 'ks_app_o_agt_001' · l'OS → 'ks_os'.
// Suffixe '_annual' pour la facturation annuelle (même app, même droit).
export function lookupKeyForApp(appId, { annual = false } = {}) {
  const base = appId === OS_ENTITLEMENT
    ? 'ks_os'
    : `ks_app_${String(appId).toLowerCase().replace(/-/g, '_')}`;
  return annual ? `${base}_annual` : base;
}

function appFromLookupKey(lookup) {
  if (!lookup) return null;
  const k = String(lookup).trim().toLowerCase().replace(/_annual$/, '');
  if (k === 'ks_os') return OS_ENTITLEMENT;
  const m = k.match(/^ks_app_(.+)$/);
  if (!m) return null;
  // 'o_agt_001' → on retrouve l'id exact du catalogue (casse d'origine).
  const norm = m[1].replace(/_/g, '-');
  return Object.keys(APP_TIER).find(id => id.toLowerCase() === norm) || null;
}

/** Valeur de `ks_app` acceptable ? (id du catalogue ou sentinelle OS) */
export function isValidEntitlementId(v) {
  if (!v) return false;
  const s = String(v).trim();
  if (s.toUpperCase() === OS_ENTITLEMENT) return true;
  return Object.prototype.hasOwnProperty.call(APP_TIER, s);
}

function normalizeEntitlementId(v) {
  const s = String(v ?? '').trim();
  if (s.toUpperCase() === OS_ENTITLEMENT) return OS_ENTITLEMENT;
  if (Object.prototype.hasOwnProperty.call(APP_TIER, s)) return s;
  // tolérance de casse sur les ids ('o-agt-001' → 'O-AGT-001')
  return Object.keys(APP_TIER).find(id => id.toLowerCase() === s.toLowerCase()) || null;
}

/**
 * Quelle app ce `price` Stripe ouvre-t-il ?
 * @param {object} price   objet price Stripe (metadata, lookup_key…)
 * @param {object} product objet product Stripe (optionnel, pour sa metadata)
 * @returns {?string} id d'app · 'OS' · null si indéterminable
 *
 * JAMAIS de repli sur le montant ici : plusieurs apps partagent le même
 * prix, deviner ouvrirait la mauvaise.
 */
export function resolveAppFromPrice(price, product) {
  if (!price) return null;
  const fromPrice = normalizeEntitlementId(price?.metadata?.ks_app);
  if (fromPrice) return fromPrice;
  const fromProduct = normalizeEntitlementId(product?.metadata?.ks_app);
  if (fromProduct) return fromProduct;
  return appFromLookupKey(price?.lookup_key);
}

/** Plan legacy d'un price (lookup_key puis montant). null si inconnu. */
export function resolveLegacyPlanFromPrice(price) {
  if (!price) return null;
  const lookup = price.lookup_key;
  if (lookup && LEGACY_PRICE_LOOKUP_TO_PLAN[lookup]) return LEGACY_PRICE_LOOKUP_TO_PLAN[lookup];
  const amount = price.unit_amount;
  if (amount && LEGACY_PRICE_AMOUNT_TO_PLAN[amount]) return LEGACY_PRICE_AMOUNT_TO_PLAN[amount];
  return null;
}

/** Conversations d'un pack (lookup_key puis montant — non ambigu ici). */
export function resolvePackConversations({ lookupKey, amountTotal }) {
  if (lookupKey && PACK_LOOKUP_TO_CONVERSATIONS[lookupKey]) {
    return PACK_LOOKUP_TO_CONVERSATIONS[lookupKey];
  }
  if (amountTotal && PACK_AMOUNT_TO_CONVERSATIONS[amountTotal]) {
    return PACK_AMOUNT_TO_CONVERSATIONS[amountTotal];
  }
  return 0;
}

// ── Ajout / retrait d'un droit dans le sac ───────────────────────
// Le sac (`owned_assets`) est la source d'accès (cf. P1). Ces deux
// fonctions sont PURES : le webhook les applique, elles ne touchent
// à rien. `null` en entrée = sentinelle legacy « tout ouvert » — on
// ne la transforme JAMAIS en liste par un achat, sous peine de
// RESTREINDRE un accès existant (un client MAX qui achète une app
// perdrait tout le reste). On la laisse telle quelle.
export function addEntitlement(ownedAssets, appId) {
  const id = normalizeEntitlementId(appId);
  if (!id) return ownedAssets;
  if (ownedAssets === null || ownedAssets === undefined) return ownedAssets;
  if (!Array.isArray(ownedAssets)) return ownedAssets;
  if (id === OS_ENTITLEMENT) return [OS_ENTITLEMENT];   // l'OS absorbe le reste
  if (ownedAssets.includes(OS_ENTITLEMENT)) return ownedAssets;  // déjà tout
  return ownedAssets.includes(id) ? ownedAssets : [...ownedAssets, id];
}

export function removeEntitlement(ownedAssets, appId) {
  const id = normalizeEntitlementId(appId);
  if (!id) return ownedAssets;
  if (!Array.isArray(ownedAssets)) return ownedAssets;
  return ownedAssets.filter(x => x !== id);
}

// ── Plan technique déduit du sac ─────────────────────────────────
// `plan` ne décide plus des apps (cf. P1) mais reste utilisé pour
// devices_max et les invitations membres. On le tient cohérent :
// OS → 'MAX' (accès total, illimité en appareils), sinon 'PRO'.
export function technicalPlanFor(ownedAssets) {
  if (!Array.isArray(ownedAssets)) return 'PRO';
  return ownedAssets.includes(OS_ENTITLEMENT) ? 'MAX' : 'PRO';
}

// ── Inventaire à créer côté Stripe ───────────────────────────────
// Sert au script de vérification (scripts/stripe-catalog-plan.mjs) : il
// dit EXACTEMENT quels produits/prix doivent exister, avec leur
// lookup_key et leur metadata. Les apps gratuites n'ont pas de produit.
export function stripeCatalogPlan() {
  const rows = [];
  for (const [appId, tier] of Object.entries(APP_TIER)) {
    if (tier === TIER.FREE) continue;
    const price = TIERS[tier].price;
    rows.push({
      appId,
      tier,
      monthlyEur: price,
      annualEur:  price * 10,          // −2 mois (cf. ANNUAL_MONTHS_BILLED)
      lookupMonthly: lookupKeyForApp(appId),
      lookupAnnual:  lookupKeyForApp(appId, { annual: true }),
      metadata: { ks_app: appId },
    });
  }
  rows.push({
    appId: OS_ENTITLEMENT,
    tier:  TIER.OS,
    monthlyEur: TIERS[TIER.OS].price,
    annualEur:  TIERS[TIER.OS].price * 10,
    lookupMonthly: lookupKeyForApp(OS_ENTITLEMENT),
    lookupAnnual:  lookupKeyForApp(OS_ENTITLEMENT, { annual: true }),
    metadata: { ks_app: OS_ENTITLEMENT },
  });
  return rows;
}

/**
 * Provenance d'une licence : paiement RÉEL ou paiement de TEST ?
 *
 * Un endpoint webhook en mode test alimente le worker de production —
 * choix assumé (2026-07-25), sinon on ne pourrait plus éprouver la
 * chaîne d'achat complète avant l'ouverture commerciale. Contrepartie :
 * chaque essai de checkout fabrique une vraie licence dans la base
 * réelle, et il faut pouvoir la reconnaître PLUS TARD sans archéologie.
 *
 * Stripe pose `livemode` sur chaque événement. On le range à la
 * création, une bonne fois, ce qui réduit le ménage à :
 *     DELETE FROM licences WHERE livemode = 0
 *
 * ⚠️ Le DÉFAUT PENCHE VERS 1, volontairement. Seul un `livemode: false`
 * explicite de Stripe marque une licence comme jetable ; tout le reste
 * (champ absent, forme inattendue) est traité comme du réel. Se tromper
 * dans ce sens fait survivre une licence de test — se tromper dans
 * l'autre efface un client payant.
 *
 * Les licences ANTÉRIEURES à cette colonne restent à NULL, et `= 0` ne
 * les attrape pas : le ménage ne peut pas mordre sur l'existant.
 */
export function livemodeFlag(event) {
  return event?.livemode === false ? 0 : 1;
}

/**
 * Un remboursement Stripe reprend-il des conversations, et combien ?
 *
 * Ferme le trou constaté en réel le 25/07 : un pack remboursé restait
 * crédité — le client gardait ses 1 000 conversations ET ses 9 €.
 *
 * Deux garde-fous, volontairement stricts :
 * · REMBOURSEMENT TOTAL uniquement (`charge.refunded === true`). Un
 *   remboursement partiel est un geste commercial manuel de Stéphane —
 *   on ne devine pas combien de conversations il vaut, on journalise
 *   et on laisse l'admin trancher.
 * · Le montant doit être EXACTEMENT celui d'un pack (900/3900). Le
 *   remboursement d'un abonnement (1900/4900/9900/12900) ne touche
 *   JAMAIS aux conversations : les droits d'abonnement se retirent par
 *   la résiliation (customer.subscription.deleted), pas par ici.
 *
 * @returns {?number} conversations à reprendre, ou null = ne rien faire
 */
export function packConversationsForRefund(charge) {
  if (!charge || charge.refunded !== true) return null;
  return resolvePackConversations({ amountTotal: charge.amount }) || null;
}
