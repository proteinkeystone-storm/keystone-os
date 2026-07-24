/* ═══════════════════════════════════════════════════════════════
   Création du catalogue Stripe (Sprint P4)
   ─────────────────────────────────────────────────────────────
   Crée les produits + prix (mensuel & annuel) de la grille per-app,
   chacun porteur de la metadata `ks_app` — sans laquelle le webhook
   ne peut PAS savoir quelle application a été payée (cinq apps
   partagent 19 €, cf. lib/stripe-catalog.js).

   LA CLÉ NE TRANSITE PAR AUCUN FICHIER, AUCUN ARGUMENT
   ─────────────────────────────────────────────────────────────
   Elle est lue dans l'environnement, à l'exécution :

     STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-catalog-apply.mjs
     STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-catalog-apply.mjs --apply

   Elle n'est jamais journalisée, jamais écrite sur disque, jamais
   affichée (seul son préfixe l'est, pour confirmer le mode).

   TROIS GARDE-FOUS
   ─────────────────────────────────────────────────────────────
   1. SIMULATION PAR DÉFAUT — sans `--apply`, rien n'est créé : le
      script dit seulement ce qu'il ferait.
   2. IDEMPOTENT — un prix dont le `lookup_key` existe déjà est
      laissé tel quel. Relancer ne duplique jamais rien.
   3. MODE TEST IMPOSÉ — une clé `sk_live_` est REFUSÉE tant que
      `--live` n'est pas passé explicitement, en plus de `--apply`.

   Ce script ne SUPPRIME ni n'ARCHIVE jamais rien : les anciens plans
   (START/PRO/MAX) restent intacts, comme prévu (un abonnement en
   cours doit continuer de résoudre).
   ═══════════════════════════════════════════════════════════════ */

import { stripeCatalogPlan } from '../workers/src/lib/stripe-catalog.js';

const args    = process.argv.slice(2);
const APPLY   = args.includes('--apply');
const LIVE_OK = args.includes('--live');
const KEY     = process.env.STRIPE_SECRET_KEY || '';

const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const bold = s => c(1, s), red = s => c(31, s), green = s => c(32, s),
      yellow = s => c(33, s), cyan = s => c(36, s), dim = s => c(2, s);

if (!KEY) {
  console.error(`\n${red('Aucune clé.')} Fournissez-la par l'environnement :\n`);
  console.error('  STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-catalog-apply.mjs\n');
  console.error(dim('  (la clé n\'est ni écrite sur disque ni affichée)\n'));
  process.exit(1);
}
const IS_LIVE = KEY.startsWith('sk_live_');
// On refuse d'ÉCRIRE en production sans les deux options explicites — mais
// on autorise la SIMULATION, qui ne fait que lire. La bloquer était une
// erreur : c'est précisément ce qu'on veut inspecter avant d'écrire.
if (IS_LIVE && APPLY && !LIVE_OK) {
  console.error(`\n${red('Clé LIVE détectée.')} Écrire en production exige ${bold('--apply --live')},`);
  console.error(`les deux ensemble. Relancez sans ${bold('--apply')} pour une simulation.\n`);
  process.exit(1);
}

console.log(`\n${bold('CATALOGUE STRIPE — ' + (IS_LIVE ? red('MODE LIVE') : green('mode TEST')))}`);
console.log(dim(`clé ${KEY.slice(0, 8)}…  ·  ${APPLY ? bold('ÉCRITURE RÉELLE') : yellow('SIMULATION (ajoutez --apply pour créer)')}`));

// ── Appel Stripe (form-encoded, comme l'attend leur API) ─────────
function encode(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) parts.push(encode(v, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.filter(Boolean).join('&');
}
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: encode(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok) {
    // On n'imprime QUE le message d'erreur Stripe — jamais la requête,
    // qui porte l'en-tête d'autorisation.
    throw new Error(json?.error?.message || `HTTP ${res.status}`);
  }
  return json;
}

// ── Contrôle préalable de la clé ─────────────────────────────────
// Un appel minuscule AVANT toute chose : si la clé est mauvaise, on le
// dit une fois, clairement, au lieu de laisser défiler 24 échecs.
try {
  await api('/prices?limit=1');
  console.log(dim('clé acceptée par Stripe ✓'));
} catch (e) {
  console.error(`\n${red('Stripe refuse cette clé.')} ${e.message}\n`);
  console.error('Reprenez la clé secrète de TEST ici :');
  console.error(bold('  https://dashboard.stripe.com/test/apikeys'));
  console.error(dim('  (elle commence par sk_test_ — cliquez « Révéler » pour la voir en entier)\n'));
  process.exit(1);
}

const TITLES = {
  'A-COM-001': 'Smart Dynamic QR', 'A-COM-002': 'Brief Prod',   'A-COM-003': 'Brainstorming',
  'A-COM-004': 'Key Form',         'A-COM-005': 'Ghost Writer', 'O-SOC-001': 'Social Manager',
  'O-AGT-001': 'Smart Agent',      'O-GEO-001': 'Sentinel',     'O-BRD-001': 'Key Brand',
  'O-NET-001': 'networK',          'O-DSK-001': 'desK',         'OS': 'Keystone OS — accès complet',
};

// Un prix porte-t-il déjà ce lookup_key ? (c'est notre clé d'idempotence)
async function priceByLookup(lookupKey) {
  const r = await api(`/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&limit=1&expand[]=data.product`);
  return r?.data?.[0] || null;
}

let crees = 0, existants = 0, echecs = 0;

for (const row of stripeCatalogPlan()) {
  const titre = TITLES[row.appId] || row.appId;
  console.log(`\n${cyan('──')} ${bold(titre)} ${dim(`(ks_app = ${row.appId})`)}`);

  const variantes = [
    { label: 'mensuel', lookup: row.lookupMonthly, euros: row.monthlyEur, interval: 'month' },
    { label: 'annuel ', lookup: row.lookupAnnual,  euros: row.annualEur,  interval: 'year'  },
  ];

  // Le produit n'est créé qu'une fois, à la première variante manquante.
  let productId = null;

  for (const v of variantes) {
    let existant = null;
    try { existant = await priceByLookup(v.lookup); }
    catch (e) { console.log(`   ${red('✗')} ${v.label} — lecture impossible : ${e.message}`); echecs++; continue; }

    if (existant) {
      existants++;
      productId = productId || (typeof existant.product === 'string' ? existant.product : existant.product?.id);
      console.log(`   ${dim('•')} ${v.label} ${dim(`déjà en place (${v.lookup})`)}`);
      continue;
    }

    if (!APPLY) {
      crees++;
      console.log(`   ${yellow('+')} ${v.label} ${v.euros} €/${v.interval === 'month' ? 'mois' : 'an'} ${dim(v.lookup)}`);
      continue;
    }

    try {
      if (!productId) {
        const prod = await api('/products', {
          method: 'POST',
          body: { name: titre, metadata: { ks_app: row.appId } },
        });
        productId = prod.id;
        console.log(`   ${green('✓')} produit créé ${dim(prod.id)}`);
      }
      const price = await api('/prices', {
        method: 'POST',
        body: {
          product: productId,
          currency: 'eur',
          unit_amount: v.euros * 100,
          recurring: { interval: v.interval },
          lookup_key: v.lookup,
          metadata: { ks_app: row.appId },
        },
      });
      crees++;
      console.log(`   ${green('✓')} ${v.label} ${v.euros} € ${dim(price.id + ' · ' + v.lookup)}`);
    } catch (e) {
      echecs++;
      console.log(`   ${red('✗')} ${v.label} — ${e.message}`);
    }
  }
}

console.log(`\n${bold('BILAN')}  ${APPLY ? green(`${crees} créés`) : yellow(`${crees} à créer`)} · ${existants} déjà en place${echecs ? ' · ' + red(`${echecs} en échec`) : ''}`);
if (!APPLY) console.log(dim('\nSimulation. Relancez avec --apply pour créer réellement.\n'));
else console.log(dim('\nLes anciens plans n\'ont pas été touchés : archivez-les à la main dans le Dashboard.\n'));
process.exit(echecs ? 1 : 0);
