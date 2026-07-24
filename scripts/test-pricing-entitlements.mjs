/* ═══════════════════════════════════════════════════════════════
   Banc — Pricing & Entitlements (Sprint P1)
   ─────────────────────────────────────────────────────────────
   Ce que ce banc PROUVE (DoD de P1) :
     1. Une licence qui possède {Ghost Writer, desK} n'ouvre QUE ces
        deux apps.
     2. Les licences legacy (plan MAX, sac null) gardent EXACTEMENT
        le comportement d'aujourd'hui — flag OFF = zéro régression.
     3. La sentinelle 'OS' ouvre tout le catalogue.
     4. La grille couvre les 14 apps et reste cohérente.

   Lancement : node scripts/test-pricing-entitlements.mjs
   ═══════════════════════════════════════════════════════════════ */

import {
  TIER, TIERS, APP_TIER, OS_ENTITLEMENT, PUBLIC_SURFACE_APPS,
  PACKS, ANNUAL_MONTHS_BILLED, annualPrice,
  tierForApp, priceForApp, isFreeApp, freeAppIds, appsForTier,
  allPricedAppIds, includedConversations,
  resolveEntitlements, hasOsAccess, isPricingV2, hasPaidApp,
} from '../app/lib/pricing.js';

let pass = 0, fail = 0;
const ok  = (label) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); };
const ko  = (label, detail) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}\n      ${detail}`); };

function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  a === e ? ok(label) : ko(label, `attendu ${e}, reçu ${a}`);
}
function truthy(v, label) { v ? ok(label) : ko(label, `attendu truthy, reçu ${JSON.stringify(v)}`); }
function sameSet(actual, expected, label) {
  const a = [...(actual || [])].sort(), e = [...expected].sort();
  JSON.stringify(a) === JSON.stringify(e)
    ? ok(label)
    : ko(label, `attendu ${JSON.stringify(e)}, reçu ${JSON.stringify(a)}`);
}

console.log('\n\x1b[1m▶ Suite 1 — la grille est complète et cohérente\x1b[0m');
eq(allPricedAppIds().length, 14, '14 applications rangées');
eq(appsForTier(TIER.FREE).length, 3, 'Gratuit = 3 apps (Missive, booK, Keynapse)');
eq(appsForTier(TIER.ESSENTIEL).length, 5, 'Essentiel 19 € = 5 apps');
eq(appsForTier(TIER.PRO).length, 5, 'Pro 49 € = 5 apps');
eq(appsForTier(TIER.DEPLOIEMENT).length, 1, 'Déploiement 99 € = Smart Agent seul');
eq(priceForApp('A-COM-005'), 19, 'Ghost Writer = 19 €');
eq(priceForApp('O-DSK-001'), 49, 'desK = 49 € (Pro)');
eq(priceForApp('O-AGT-001'), 99, 'Smart Agent = 99 €');
eq(priceForApp('O-BOK-001'), 0, 'booK = gratuit');
eq(tierForApp('inconnue'), null, 'app inconnue → aucun palier');
truthy(isFreeApp('O-SEC-001'), 'Missive est gratuite');
sameSet(freeAppIds(), ['O-SEC-001', 'O-BOK-001', 'O-Keyn-001'], 'les 3 gratuites sont les bonnes');

// La mécanique Adobe : dès 3 apps Pro (147 €), prendre l'OS (129 €) devient
// le choix évident. C'est l'invariant qui fait vivre l'upsell — s'il casse,
// la grille perd son moteur.
truthy(TIERS[TIER.OS].price < 3 * TIERS[TIER.PRO].price, 'OS (129 €) < 3 apps Pro (147 €) → l\'OS s\'impose');
eq(TIERS[TIER.OS].price - TIERS[TIER.DEPLOIEMENT].price, 30, 'depuis Smart Agent, +30 € = tout l\'OS');
eq(annualPrice(TIERS[TIER.OS].price), 1290, 'annuel OS = 1 290 € (−2 mois)');
eq(ANNUAL_MONTHS_BILLED, 10, 'annuel facturé 10 mois');
eq(PACKS.map(p => p.price), [9, 39], 'les 2 packs restent à 9 € et 39 €');
sameSet(PUBLIC_SURFACE_APPS, ['O-AGT-001', 'A-COM-001'], 'surfaces publiques = Smart Agent + Smart QR');

console.log('\n\x1b[1m▶ Suite 2 — zéro régression sur le legacy (flag OFF)\x1b[0m');
eq(isPricingV2(), false, 'PRICING_V2 est OFF par défaut');
eq(resolveEntitlements({ isAdmin: true, ownedAssets: ['A-COM-005'] }), null, 'ADMIN ouvre tout');
eq(resolveEntitlements({ plan: 'MAX', ownedAssets: ['A-COM-005'] }), null, 'plan MAX (legacy) ouvre tout');
eq(resolveEntitlements({ plan: 'STARTER', ownedAssets: null }), null, 'sac null = sentinelle historique → tout');
eq(resolveEntitlements({ plan: 'PRO' }), null, 'sac absent → tout');
eq(resolveEntitlements({ plan: 'STARTER', ownedAssets: [] }), [], 'sac vide = révoqué, rien ouvert');
eq(
  resolveEntitlements({ plan: 'STARTER', ownedAssets: ['A-COM-005', 'O-DSK-001'] }),
  ['A-COM-005', 'O-DSK-001'],
  'flag OFF : le sac est renvoyé tel quel (aucune app ajoutée)',
);

console.log('\n\x1b[1m▶ Suite 3 — DoD : une licence n\'ouvre QUE ses apps\x1b[0m');
const sac = resolveEntitlements({ plan: 'STARTER', ownedAssets: ['A-COM-005', 'O-DSK-001'] });
const opens = id => sac === null || sac.includes(id);
truthy(opens('A-COM-005'), 'Ghost Writer (possédé) → ouvert');
truthy(opens('O-DSK-001'), 'desK (possédé) → ouvert');
truthy(!opens('O-AGT-001'), 'Smart Agent (non possédé) → fermé');
truthy(!opens('O-GEO-001'), 'Sentinel (non possédé) → fermé');
truthy(!hasOsAccess({ plan: 'STARTER', ownedAssets: ['A-COM-005'] }), 'une app ≠ accès OS');

console.log('\n\x1b[1m▶ Suite 4 — la sentinelle OS\x1b[0m');
eq(resolveEntitlements({ ownedAssets: [OS_ENTITLEMENT] }), null, 'sac ["OS"] → tout le catalogue');
truthy(hasOsAccess({ ownedAssets: [OS_ENTITLEMENT] }), 'hasOsAccess vrai sur la sentinelle');
eq(resolveEntitlements({ ownedAssets: ['OS', 'A-COM-005'] }), null, 'OS l\'emporte sur le reste du sac');
truthy(hasOsAccess({ plan: 'MAX' }), 'MAX legacy = équivalent OS');

console.log('\n\x1b[1m▶ Suite 5 — conversations incluses\x1b[0m');
eq(includedConversations(null), 3000, 'accès total → 3 000 conversations');
eq(includedConversations([OS_ENTITLEMENT]), 3000, 'sentinelle OS → 3 000');
eq(includedConversations([]), 0, 'rien possédé → 0');
eq(includedConversations(['A-COM-005']), 300, 'une app Essentiel → 300');
eq(includedConversations(['O-DSK-001']), 1000, 'une app Pro → 1 000');
eq(includedConversations(['A-COM-005', 'O-DSK-001']), 1300, 'pot commun = somme des enveloppes');
eq(includedConversations(['O-BOK-001']), 0, 'une app gratuite n\'apporte pas de conversations');
truthy(
  includedConversations(appsForTier(TIER.PRO)) <= TIERS[TIER.OS].conversations,
  'le pot commun ne dépasse jamais celui de l\'OS',
);

console.log('\n\x1b[1m▶ Suite 6 — flag PRICING_V2 ON (bascule P6)\x1b[0m');
// isPricingV2() lit localStorage, absent sous node → on le simule pour
// couvrir le chemin V2 SANS toucher au défaut (qui doit rester OFF).
const _store = { ks_pricing_v2: '1' };
globalThis.localStorage = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: k => { delete _store[k]; },
};
eq(isPricingV2(), true, 'le flag se lit bien depuis localStorage');
sameSet(
  resolveEntitlements({ plan: 'STARTER', ownedAssets: ['A-COM-005', 'O-DSK-001'] }),
  ['A-COM-005', 'O-DSK-001', 'O-SEC-001', 'O-BOK-001', 'O-Keyn-001'],
  'V2 : les 3 apps gratuites s\'ajoutent au sac',
);
eq(resolveEntitlements({ plan: 'MAX' }), null, 'V2 : MAX ouvre toujours tout');
eq(resolveEntitlements({ ownedAssets: [OS_ENTITLEMENT] }), null, 'V2 : la sentinelle OS ouvre tout');
sameSet(
  resolveEntitlements({ ownedAssets: [] }),
  freeAppIds(),
  'V2 : un sac vide ouvre quand même les gratuites (porte d\'entrée)',
);
eq(includedConversations(resolveEntitlements({ ownedAssets: ['A-COM-005'] })), 300,
   'V2 : les gratuites n\'augmentent pas l\'enveloppe de conversations');
_store.ks_pricing_v2 = '0';
eq(isPricingV2(), false, 'le flag se remet bien sur OFF');
delete globalThis.localStorage;

console.log('\n\x1b[1m▶ Suite 7 — anti-dérive front ↔ worker (Sprint P2)\x1b[0m');
// Le Worker ne peut pas importer app/lib/pricing.js (bundles séparés) : il en
// a un MIROIR. Ces tests sont le filet — toucher l'un sans l'autre casse ici.
const W = await import('../workers/src/lib/pricing-grid.js');
sameSet(Object.keys(W.APP_TIER), Object.keys(APP_TIER), 'même liste d\'apps des deux côtés');
{
  const drift = Object.keys(APP_TIER).filter(id => W.APP_TIER[id] !== APP_TIER[id]);
  eq(drift, [], 'chaque app est dans le même palier des deux côtés');
}
{
  const drift = Object.keys(TIERS).filter(t =>
    W.TIERS[t]?.price !== TIERS[t].price || W.TIERS[t]?.conversations !== TIERS[t].conversations);
  eq(drift, [], 'prix et conversations identiques pour chaque palier');
}
eq(W.OS_ENTITLEMENT, OS_ENTITLEMENT, 'même sentinelle OS');

console.log('\n\x1b[1m▶ Suite 8 — quota par sac d\'apps (worker)\x1b[0m');
eq(W.quotaForEntitlements({ plan: 'ADMIN' }), null, 'ADMIN = illimité');
eq(W.quotaForEntitlements({ plan: 'MAX' }), null, 'MAX legacy = illimité');
eq(W.quotaForEntitlements({ plan: 'STARTER', ownedAssets: null }), null, 'sac null = illimité (legacy)');
eq(W.quotaForEntitlements({ plan: 'STARTER', ownedAssets: ['OS'] }), 3000, 'sentinelle OS = 3 000');
eq(W.quotaForEntitlements({ plan: 'STARTER', ownedAssets: ['A-COM-005'] }), 300, 'une app Essentiel = 300');
eq(W.quotaForEntitlements({ plan: 'STARTER', ownedAssets: ['O-DSK-001'] }), 1000, 'une app Pro = 1 000');
eq(W.quotaForEntitlements({ plan: 'STARTER', ownedAssets: ['A-COM-005', 'O-DSK-001'] }), 1300, 'deux apps = pot commun');
eq(W.quotaForEntitlements({ plan: 'STARTER', ownedAssets: [] }), 0, 'sac vide = 0');
// Le flag worker se lit dans env, pas dans localStorage.
eq(W.isPricingV2({}), false, 'PRICING_V2 absent de env → OFF');
eq(W.isPricingV2({ PRICING_V2: '1' }), true, 'PRICING_V2=1 → ON');
eq(W.isPricingV2({ PRICING_V2: 'off' }), false, 'PRICING_V2=off → OFF');

console.log('\n\x1b[1m▶ Suite 9 — la voix consomme des conversations\x1b[0m');
const { costForAudioSeconds, COST, resolveQuota } = await import('../workers/src/lib/ai-credits.js');
eq(costForAudioSeconds(5), 1, '5 s d\'audio = 1 conversation (minimum)');
eq(costForAudioSeconds(59), 1, '59 s = 1');
eq(costForAudioSeconds(60), 1, '60 s = 1');
eq(costForAudioSeconds(61), 2, '61 s = 2 (minute entamée)');
eq(costForAudioSeconds(300), 5, '5 min = 5');
eq(costForAudioSeconds(0), 1, 'durée inconnue → 1, jamais gratuit par accident');
eq(costForAudioSeconds(NaN), 1, 'durée illisible → 1');
eq(COST.kora_stt, 1, 'kora_stt a un barème de repli');
eq(COST.keynapse_voice, 1, 'keynapse_voice a un barème de repli');
// resolveQuota : l'arbitre legacy ↔ per-app.
eq(resolveQuota({}, 'STARTER', ['A-COM-005']), 200, 'flag OFF → quota LEGACY du plan (200)');
eq(resolveQuota({ PRICING_V2: '1' }, 'STARTER', ['A-COM-005']), 300, 'flag ON → quota du SAC (300)');
eq(resolveQuota({ PRICING_V2: '1' }, 'ADMIN', []), null, 'flag ON → ADMIN reste illimité');

console.log('\n\x1b[1m▶ Suite 10 — « Gratuit, cœur seul » : la dictée exige une app payante\x1b[0m');
// Keynapse : cœur sans IA = gratuit ; la dictée (Whisper + Mistral) non.
// Une licence 100 % gratuite ne doit déclencher AUCUN coût.
for (const [label, fn] of [['front', hasPaidApp], ['worker', W.hasPaidApp]]) {
  truthy(!fn({ ownedAssets: ['O-Keyn-001'] }), `${label} : Keynapse seul → pas d'app payante`);
  truthy(!fn({ ownedAssets: freeAppIds() }), `${label} : que des gratuites → pas d'app payante`);
  truthy(!fn({ ownedAssets: [] }), `${label} : sac vide → pas d'app payante`);
  truthy(fn({ ownedAssets: ['O-Keyn-001', 'A-COM-005'] }), `${label} : une Essentiel suffit`);
  truthy(fn({ ownedAssets: ['O-DSK-001'] }), `${label} : une Pro suffit`);
  truthy(fn({ ownedAssets: [OS_ENTITLEMENT] }), `${label} : l'OS ouvre la dictée`);
  // Permissif sur le legacy : on ne retire jamais un accès existant.
  truthy(fn({ plan: 'MAX' }), `${label} : MAX legacy → autorisé`);
  truthy(fn({ plan: 'ADMIN', ownedAssets: [] }), `${label} : ADMIN → autorisé`);
  truthy(fn({ plan: 'STARTER', ownedAssets: null }), `${label} : sac null (legacy) → autorisé`);
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? `\x1b[31m${fail} ko\x1b[0m` : '0 ko'}\n`);
process.exit(fail ? 1 : 0);
