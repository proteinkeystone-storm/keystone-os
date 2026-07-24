/* ═══════════════════════════════════════════════════════════════
   Inventaire Stripe à créer (Sprint P4) — LECTURE SEULE
   ─────────────────────────────────────────────────────────────
   N'appelle PAS l'API Stripe et ne crée rien : il imprime ce qui doit
   exister côté Stripe pour que le webhook sache traduire un paiement
   en droit d'accès. À créer dans le Dashboard (mode TEST d'abord).

   Règle d'or : chaque produit DOIT porter la metadata `ks_app`.
   Sans elle, un paiement de 19 € est indéchiffrable — cinq
   applications partagent ce prix, et le webhook refuse de deviner.

   Lancement : node scripts/stripe-catalog-plan.mjs
   ═══════════════════════════════════════════════════════════════ */

import { stripeCatalogPlan } from '../workers/src/lib/stripe-catalog.js';
import { APP_TIER, TIER, TIERS } from '../workers/src/lib/pricing-grid.js';

const CATALOG_TITLES = {
  'A-COM-001': 'Smart Dynamic QR', 'A-COM-002': 'Brief Prod',   'A-COM-003': 'Brainstorming',
  'A-COM-004': 'Key Form',         'A-COM-005': 'Ghost Writer', 'O-SOC-001': 'Social Manager',
  'O-AGT-001': 'Smart Agent',      'O-GEO-001': 'Sentinel',     'O-BRD-001': 'Key Brand',
  'O-NET-001': 'networK',          'O-DSK-001': 'desK',         'OS': 'Keystone OS — accès complet',
};

const rows = stripeCatalogPlan();
const eur  = (n) => `${String(n).padStart(3)} €`;

console.log('\n\x1b[1mPRODUITS STRIPE À CRÉER\x1b[0m  (mode TEST d\'abord)\n');
console.log('  Chaque produit = 2 prix récurrents : mensuel + annuel (−2 mois).');
console.log('  Metadata OBLIGATOIRE sur le produit : ks_app = <valeur ci-dessous>\n');

const byTier = {};
for (const r of rows) (byTier[r.tier] ||= []).push(r);

for (const tier of [TIER.ESSENTIEL, TIER.PRO, TIER.DEPLOIEMENT, TIER.OS]) {
  const list = byTier[tier];
  if (!list?.length) continue;
  console.log(`\x1b[36m── ${TIERS[tier].label} ─────────────────────────────────\x1b[0m`);
  for (const r of list) {
    console.log(`  \x1b[1m${(CATALOG_TITLES[r.appId] || r.appId).padEnd(32)}\x1b[0m ks_app = ${r.appId}`);
    console.log(`     mensuel ${eur(r.monthlyEur)}/mois   lookup_key: ${r.lookupMonthly}`);
    console.log(`     annuel  ${eur(r.annualEur)}/an     lookup_key: ${r.lookupAnnual}`);
  }
  console.log('');
}

const gratuites = Object.entries(APP_TIER).filter(([, t]) => t === TIER.FREE).map(([id]) => id);
console.log('\x1b[36m── Aucun produit Stripe ────────────────────────────\x1b[0m');
console.log(`  Applications gratuites (rien à créer) : ${gratuites.join(', ')}\n`);

console.log('\x1b[36m── Packs de conversations (paiement unique) ────────\x1b[0m');
console.log('  Déjà en place, à RENOMMER « conversations » (le barème ne change pas) :');
console.log('     1 000 conversations —  9 €   lookup_key: ks_pack_1000');
console.log('     5 000 conversations — 39 €   lookup_key: ks_pack_5000\n');

console.log('\x1b[36m── Anciens plans ───────────────────────────────────\x1b[0m');
console.log('  START 49 / PRO 99 / MAX 249 : à ARCHIVER, jamais à supprimer.');
console.log('  Le webhook les résout encore (lookup_key ks_starter/ks_pro/ks_max,');
console.log('  ou repli par montant) pour ne pas casser un abonnement en cours.\n');

const totalProduits = rows.length;
console.log(`\x1b[1mTOTAL : ${totalProduits} produits, ${totalProduits * 2} prix.\x1b[0m\n`);
