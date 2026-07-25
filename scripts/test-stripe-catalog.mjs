/* ═══════════════════════════════════════════════════════════════
   Banc — Catalogue Stripe ↔ apps (Sprint P4)
   ─────────────────────────────────────────────────────────────
   Ce que ce banc PROUVE :
     1. Un price Stripe se traduit en UNE app, sans jamais deviner
        depuis le montant (cinq apps partagent 19 €).
     2. Les abonnements LEGACY (3 anciens plans) résolvent encore.
     3. Le sac d'apps grandit et rétrécit correctement — et un achat
        ne RESTREINT jamais un accès existant.
     4. L'inventaire à créer côté Stripe est complet et cohérent.

   Lancement : node scripts/test-stripe-catalog.mjs
   ═══════════════════════════════════════════════════════════════ */

import {
  resolveAppFromPrice, resolveLegacyPlanFromPrice, resolvePackConversations,
  addEntitlement, removeEntitlement, technicalPlanFor,
  lookupKeyForApp, isValidEntitlementId, stripeCatalogPlan, livemodeFlag,
  packConversationsForRefund,
} from '../workers/src/lib/stripe-catalog.js';
import { APP_TIER, TIER, OS_ENTITLEMENT } from '../workers/src/lib/pricing-grid.js';

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const eq = (a, e, l) => {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  A === E ? ok(l) : ko(l, `attendu ${E}, reçu ${A}`);
};
const truthy = (v, l) => (v ? ok(l) : ko(l, `attendu vrai, reçu ${JSON.stringify(v)}`));

console.log('\n\x1b[1m▶ Suite 1 — un price se traduit en UNE app\x1b[0m');
eq(resolveAppFromPrice({ metadata: { ks_app: 'O-AGT-001' } }), 'O-AGT-001', 'metadata du PRICE (voie recommandée)');
eq(resolveAppFromPrice({}, { metadata: { ks_app: 'A-COM-005' } }), 'A-COM-005', 'metadata du PRODUIT (mensuel + annuel sous un produit)');
eq(resolveAppFromPrice({ lookup_key: 'ks_app_o_dsk_001' }), 'O-DSK-001', 'convention de lookup_key');
eq(resolveAppFromPrice({ lookup_key: 'ks_app_o_dsk_001_annual' }), 'O-DSK-001', 'la variante annuelle ouvre le MÊME droit');
eq(resolveAppFromPrice({ lookup_key: 'ks_os' }), OS_ENTITLEMENT, 'ks_os → OS complet');
eq(resolveAppFromPrice({ lookup_key: 'ks_os_annual' }), OS_ENTITLEMENT, 'OS annuel → OS complet');
eq(resolveAppFromPrice({ metadata: { ks_app: 'o-agt-001' } }), 'O-AGT-001', 'tolérance de casse sur l\'id');
eq(resolveAppFromPrice({ metadata: { ks_app: 'O-AGT-001' }, lookup_key: 'ks_app_a_com_005' }), 'O-AGT-001',
   'la metadata du price prime sur le lookup_key');

console.log('\n\x1b[1m▶ Suite 2 — on ne DEVINE jamais (le piège du montant)\x1b[0m');
// Cinq apps à 19 €, cinq à 49 € : deviner ouvrirait la mauvaise app.
eq(resolveAppFromPrice({ unit_amount: 1900 }), null, '1 900 ct seul → aucune app (5 apps à ce prix)');
eq(resolveAppFromPrice({ unit_amount: 4900 }), null, '4 900 ct seul → aucune app');
eq(resolveAppFromPrice({ unit_amount: 12900 }), null, '12 900 ct seul → aucune app (même le prix de l\'OS)');
eq(resolveAppFromPrice({ metadata: { ks_app: 'PAS-UNE-APP' } }), null, 'id inconnu → refusé');
eq(resolveAppFromPrice({ lookup_key: 'ks_app_inexistante' }), null, 'lookup_key inconnu → refusé');
eq(resolveAppFromPrice(null), null, 'price absent → refusé');
truthy(!isValidEntitlementId('X-NOPE-001'), 'isValidEntitlementId rejette un id hors catalogue');
truthy(isValidEntitlementId('OS'), 'isValidEntitlementId accepte la sentinelle OS');

console.log('\n\x1b[1m▶ Suite 3 — les abonnements LEGACY résolvent encore\x1b[0m');
eq(resolveLegacyPlanFromPrice({ lookup_key: 'ks_starter' }), 'STARTER', 'ks_starter');
eq(resolveLegacyPlanFromPrice({ lookup_key: 'ks_pro' }), 'PRO', 'ks_pro');
eq(resolveLegacyPlanFromPrice({ lookup_key: 'ks_max' }), 'MAX', 'ks_max');
eq(resolveLegacyPlanFromPrice({ unit_amount: 4900 }), 'STARTER', 'repli montant 49 € (Payment Link sans lookup_key)');
eq(resolveLegacyPlanFromPrice({ unit_amount: 9900 }), 'PRO', 'repli montant 99 €');
eq(resolveLegacyPlanFromPrice({ unit_amount: 24900 }), 'MAX', 'repli montant 249 €');
eq(resolveLegacyPlanFromPrice({ unit_amount: 1900 }), null, '19 € n\'est PAS un plan legacy');

console.log('\n\x1b[1m▶ Suite 4 — packs de conversations\x1b[0m');
eq(resolvePackConversations({ lookupKey: 'ks_pack_1000' }), 1000, 'pack 1 000 par lookup_key');
eq(resolvePackConversations({ amountTotal: 900 }), 1000, 'pack 9 € par montant (non ambigu)');
eq(resolvePackConversations({ amountTotal: 3900 }), 5000, 'pack 39 € par montant');
eq(resolvePackConversations({ amountTotal: 1234 }), 0, 'montant inconnu → 0, on n\'invente pas');

console.log('\n\x1b[1m▶ Suite 5 — le sac grandit et rétrécit\x1b[0m');
eq(addEntitlement([], 'A-COM-005'), ['A-COM-005'], 'première app');
eq(addEntitlement(['A-COM-005'], 'O-DSK-001'), ['A-COM-005', 'O-DSK-001'], 'deuxième app : le sac s\'agrandit');
eq(addEntitlement(['A-COM-005'], 'A-COM-005'), ['A-COM-005'], 'racheter la même app ne duplique pas');
eq(addEntitlement(['A-COM-005', 'O-DSK-001'], 'OS'), ['OS'], 'l\'OS absorbe les droits individuels');
eq(addEntitlement(['OS'], 'A-COM-005'), ['OS'], 'quand on a l\'OS, une app de plus ne change rien');
eq(removeEntitlement(['A-COM-005', 'O-DSK-001'], 'O-DSK-001'), ['A-COM-005'],
   'résilier desK laisse Ghost Writer — LE point critique');
eq(removeEntitlement(['A-COM-005'], 'A-COM-005'), [], 'dernière app retirée → sac vide (licence à fermer)');
eq(removeEntitlement(['A-COM-005'], 'O-GEO-001'), ['A-COM-005'], 'retirer une app non possédée ne casse rien');

console.log('\n\x1b[1m▶ Suite 6 — un achat ne RESTREINT jamais un accès\x1b[0m');
// null = sentinelle legacy « tout ouvert » (MAX/ADMIN). La transformer en
// liste ferait PERDRE des apps au client qui vient d'en acheter une.
eq(addEntitlement(null, 'A-COM-005'), null, 'sac null (accès total legacy) reste intact');
eq(addEntitlement(undefined, 'A-COM-005'), undefined, 'sac absent reste intact');
eq(addEntitlement([], 'PAS-UNE-APP'), [], 'id inconnu → sac inchangé');

console.log('\n\x1b[1m▶ Suite 7 — plan technique déduit du sac\x1b[0m');
// `plan` ne décide plus des apps (P1) mais pilote encore devices_max.
eq(technicalPlanFor(['OS']), 'MAX', 'OS → MAX (appareils illimités)');
eq(technicalPlanFor(['A-COM-005']), 'PRO', 'une app → PRO');
eq(technicalPlanFor([]), 'PRO', 'sac vide → PRO');

console.log('\n\x1b[1m▶ Suite 8 — inventaire à créer dans Stripe\x1b[0m');
const plan = stripeCatalogPlan();
const payantes = Object.entries(APP_TIER).filter(([, t]) => t !== TIER.FREE).length;
eq(plan.length, payantes + 1, `${payantes} apps payantes + l'OS = ${payantes + 1} produits`);
truthy(!plan.some(r => r.monthlyEur === 0), 'aucun produit à 0 € (les gratuites n\'en ont pas)');
truthy(plan.every(r => r.annualEur === r.monthlyEur * 10), 'annuel = 10 mois partout (−2 mois)');
truthy(new Set(plan.map(r => r.lookupMonthly)).size === plan.length, 'les lookup_key mensuels sont uniques');
truthy(new Set(plan.map(r => r.lookupAnnual)).size === plan.length, 'les lookup_key annuels sont uniques');
truthy(plan.every(r => r.metadata.ks_app === r.appId), 'chaque produit porte sa metadata ks_app');
// Boucle complète : ce qu'on demande de créer doit se re-résoudre.
const aller = plan.every(r => resolveAppFromPrice({ lookup_key: r.lookupMonthly }) === r.appId);
truthy(aller, 'chaque lookup_key généré se re-résout vers son app (aller-retour)');
const allerAnnuel = plan.every(r => resolveAppFromPrice({ lookup_key: r.lookupAnnual }) === r.appId);
truthy(allerAnnuel, 'idem pour les lookup_key annuels');
eq(lookupKeyForApp('O-AGT-001'), 'ks_app_o_agt_001', 'convention de nommage stable');
eq(lookupKeyForApp(OS_ENTITLEMENT, { annual: true }), 'ks_os_annual', 'convention OS annuel');

// ── Provenance live / test ──────────────────────────────────────
// Ce qui compte ici n'est pas « est-ce que ça marche » mais le SENS
// dans lequel on a le droit de se tromper : une erreur vers 1 fait
// survivre une licence de test (agaçant), une erreur vers 0 la rend
// éligible à `DELETE FROM licences WHERE livemode = 0` — donc efface
// un client payant. Tout ce qui n'est pas un `false` explicite de
// Stripe doit valoir 1.
eq(livemodeFlag({ livemode: true }),  1, 'paiement réel → 1');
eq(livemodeFlag({ livemode: false }), 0, 'paiement de test → 0 (le seul cas jetable)');
eq(livemodeFlag({}),                  1, 'champ absent → 1 (on ne jette pas dans le doute)');
eq(livemodeFlag(undefined),           1, 'événement absent → 1');
eq(livemodeFlag(null),                1, 'événement null → 1');
eq(livemodeFlag({ livemode: 'false' }), 1, 'chaîne "false" ≠ booléen false → 1');
eq(livemodeFlag({ livemode: 0 }),     1, 'zéro numérique ≠ booléen false → 1');

// ── Remboursement de pack (charge.refunded) ────────────────────
// Deux refus comptent plus que le cas nominal : un remboursement
// PARTIEL ne reprend rien (geste commercial manuel, l'admin tranche),
// et un montant d'ABONNEMENT ne touche jamais aux conversations (les
// droits d'abo se retirent par la résiliation, pas par ici).
eq(packConversationsForRefund({ refunded: true,  amount: 900 }),  1000, 'pack 9 € intégralement remboursé → reprendre 1000');
eq(packConversationsForRefund({ refunded: true,  amount: 3900 }), 5000, 'pack 39 € intégralement remboursé → reprendre 5000');
eq(packConversationsForRefund({ refunded: false, amount: 900 }),  null, 'remboursement PARTIEL → zéro reprise');
eq(packConversationsForRefund({ refunded: true,  amount: 1900 }), null, 'montant d\'abonnement (19 €) → jamais de reprise');
eq(packConversationsForRefund({ refunded: true,  amount: 9900 }), null, 'montant d\'abonnement (99 €) → jamais de reprise');
eq(packConversationsForRefund({ refunded: true,  amount: 12900 }), null, 'montant OS (129 €) → jamais de reprise');
eq(packConversationsForRefund(null),                              null, 'charge absente → rien, pas de crash');
eq(packConversationsForRefund({ amount: 900 }),                   null, 'refunded absent → prudence, zéro reprise');

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? `\x1b[31m${fail} ko\x1b[0m` : '0 ko'}\n`);
process.exit(fail ? 1 : 0);
