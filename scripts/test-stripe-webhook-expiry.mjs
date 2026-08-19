#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Banc — Webhook Stripe × licence à DATE (essai 7 jours posé à la main)
   ─────────────────────────────────────────────────────────────
   Ce que ce banc PROUVE :
     1. Une licence créée depuis l'Admin avec une date d'expiration
        (démo 7 jours, testeur à durée limitée) qui finit par PAYER
        l'application n'est plus « expirée » : le webhook efface la
        date en agrandissant le sac. Avant ce correctif, la personne
        payait et restait dehors (403 « Licence expirée » à la
        connexion, au refresh et sur chaque appel d'API).
     2. Le chemin in-app (client_reference_id = identifiant de licence,
        même avec une AUTRE adresse e-mail chez Stripe) enrichit la même
        licence — et efface la date aussi.
     3. Un renouvellement d'abonnement (customer.subscription.updated,
        même price) efface lui aussi une échéance manuelle.
     4. Une licence née HORS Stripe qui paie reçoit son client Stripe :
        « Gérer mon abonnement » (portail = seul canal de résiliation)
        répondait 404 avant l'achat, il répond 200 après. Un client déjà
        connu n'est jamais remplacé ; un e-mail de facturation manquant
        est complété.

   Le VRAI handler tourne (signature Stripe vérifiée, D1 réel en mémoire
   via node:sqlite, API Stripe doublée par un fetch de banc).

   Lancement : node scripts/test-stripe-webhook-expiry.mjs
   ═══════════════════════════════════════════════════════════════ */

import { DatabaseSync }        from 'node:sqlite';
import { createHmac }          from 'node:crypto';
import { handleStripeWebhook } from '../workers/src/routes/stripe-webhook.js';
import { handleBillingPortal } from '../workers/src/routes/billing.js';
import { signJWT }             from '../workers/src/lib/jwt.js';

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const eq = (a, e, l) => {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  A === E ? ok(l) : ko(l, `attendu ${E}, reçu ${A}`);
};

// ── D1 en mémoire (adaptateur minimal sur node:sqlite) ──────────
function makeD1(db) {
  const wrap = (sql, args) => ({
    run:   async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    first: async (col) => { const row = db.prepare(sql).get(...args); if (row === undefined) return null; return col ? row[col] : row; },
    all:   async () => ({ success: true, results: db.prepare(sql).all(...args) }),
  });
  return {
    prepare: (sql) => ({ ...wrap(sql, []), bind: (...args) => wrap(sql, args) }),
    batch:   async (stmts) => Promise.all(stmts.map(s => s.run())),
  };
}

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE licences (
    key TEXT PRIMARY KEY, tenant_id TEXT DEFAULT 'default', owner TEXT, plan TEXT,
    is_active INTEGER DEFAULT 1, owned_assets TEXT, expires_at TEXT,
    customer_email TEXT, stripe_customer_id TEXT, stripe_subscription_id TEXT,
    lookup_hmac TEXT, key_hash TEXT, salt TEXT, devices_max INTEGER,
    enforce_ai_credits_v1 INTEGER DEFAULT 0, livemode INTEGER,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
  );
  CREATE TABLE stripe_events (
    id TEXT PRIMARY KEY, type TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'processed'
  );
`);

const HMAC_DEMO = 'hmac-demo-nathalie';
const YESTERDAY = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
function seedDemoLicence() {
  db.prepare('DELETE FROM licences').run();
  db.prepare(`INSERT INTO licences (key, owner, plan, is_active, owned_assets, expires_at, customer_email, lookup_hmac)
              VALUES (?, ?, 'PRO', 1, ?, ?, ?, ?)`)
    .run('DEMO-0000-0000-0001', 'Rédactrice (démo)', JSON.stringify(['O-DSK-001']), YESTERDAY, 'redactrice@example.test', HMAC_DEMO);
}
const licence = () => db.prepare('SELECT plan, is_active, owned_assets, expires_at, stripe_customer_id, customer_email FROM licences WHERE lookup_hmac = ?').get(HMAC_DEMO);
// Le même prédicat que le worker (licence-public / auth refresh / app-access).
const isExpired = (row) => !!(row.expires_at && new Date(row.expires_at) < new Date());

// ── API Stripe doublée ──────────────────────────────────────────
const stripeCalls = [];
const portalCustomers = [];              // `customer` reçu par billing_portal/sessions
globalThis.fetch = async (url, init = {}) => {
  stripeCalls.push(String(url));
  const m = String(url).match(/^https:\/\/api\.stripe\.com\/v1\/subscriptions\/(sub_[a-z0-9_]+)$/);
  if (m) {
    return new Response(JSON.stringify({
      id: m[1], status: 'active',
      items: { data: [{ price: { id: 'price_dsk', metadata: { ks_app: 'O-DSK-001' }, product: 'prod_dsk' } }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url) === 'https://api.stripe.com/v1/billing_portal/sessions' && init.method === 'POST') {
    portalCustomers.push(new URLSearchParams(String(init.body)).get('customer'));
    return new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/banc' }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`fetch inattendu dans le banc : ${url}`);
};

// ── Événement signé comme Stripe le ferait ──────────────────────
const env = {
  DB: makeD1(db),
  KS_STRIPE_WEBHOOK_SECRET: 'whsec_banc',
  KS_STRIPE_SECRET:         'sk_live_banc',
  KS_LOOKUP_PEPPER:         'pepper-banc',
  KS_JWT_SECRET:            'jwt-secret-du-banc-32-octets-minimum-0123456789',
  KS_ALLOWED_ORIGIN:        '*',
};

// « Gérer mon abonnement » tel que l'app l'appelle : JWT de la licence → portail.
async function portal() {
  const jwt = await signJWT({ sub: HMAC_DEMO, plan: 'PRO', owner: 'banc' }, env);
  const req = new Request('https://keystone-os-api.example/api/billing/portal', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` },
  });
  const res = await handleBillingPortal(req, env);
  return { status: res.status, json: await res.json().catch(() => null) };
}
let evtSeq = 0;
async function deliver(type, object, eventId = null) {
  const body = JSON.stringify({ id: eventId || `evt_banc_${++evtSeq}`, type, livemode: true, data: { object } });
  const ts   = Math.floor(Date.now() / 1000);
  const v1   = createHmac('sha256', env.KS_STRIPE_WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex');
  const req  = new Request('https://keystone-os-api.example/api/stripe/webhook', {
    method: 'POST', body, headers: { 'Stripe-Signature': `t=${ts},v1=${v1}` },
  });
  const res = await handleStripeWebhook(req, env);
  return { status: res.status, json: await res.json() };
}
const checkout = (over = {}) => ({
  id: 'cs_banc', mode: 'subscription', livemode: true,
  customer: 'cus_demo', subscription: 'sub_demo_1',
  customer_details: { email: 'redactrice@example.test' },
  ...over,
});

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — la démo expirée paie desK (même e-mail) → elle n\'est plus expirée\x1b[0m');
seedDemoLicence();
eq(isExpired(licence()), true, 'AVANT : la licence de démo est bien expirée (hier)');
eq(licence().stripe_customer_id, null, 'AVANT : née hors Stripe, aucun client Stripe');
eq((await portal()).status, 404, 'AVANT : « Gérer mon abonnement » → 404 (rien à gérer, normal)');
{
  const r = await deliver('checkout.session.completed', checkout());
  eq(r.status, 200, 'webhook → 200');
  const L = licence();
  eq(L.expires_at, null, 'APRÈS : expires_at effacé');
  eq(isExpired(L), false, 'APRÈS : le prédicat « expirée » du worker dit NON');
  eq(L.is_active, 1, 'la licence est active');
  eq(JSON.parse(L.owned_assets), ['O-DSK-001'], 'le sac = desK (pas de doublon, rien de retiré)');
  eq(L.plan, 'PRO', 'plan technique inchangé');
  eq(L.stripe_customer_id, 'cus_demo', 'APRÈS : le client Stripe est rattaché à la licence');
  eq(L.customer_email, 'redactrice@example.test', 'e-mail de facturation inchangé');
  const sub = db.prepare('SELECT app_id, status FROM licence_subscriptions WHERE subscription_id = ?').get('sub_demo_1');
  eq(sub, { app_id: 'O-DSK-001', status: 'active' }, 'l\'abonnement est rattaché à la licence (licence_subscriptions)');
  eq(db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 1, 'aucune deuxième clé créée');
  const p = await portal();
  eq(p.status, 200, 'APRÈS : « Gérer mon abonnement » → 200 (le portail s\'ouvre)');
  eq(p.json?.url, 'https://billing.stripe.com/p/session/banc', 'le portail rend son URL');
  eq(portalCustomers.at(-1), 'cus_demo', 'le portail est ouvert pour LE client de l\'achat');
}

console.log('\n\x1b[1m▶ Suite 2 — achat depuis l\'app (client_reference_id), AUTRE e-mail et AUTRE client chez Stripe\x1b[0m');
seedDemoLicence();
db.prepare('DELETE FROM licence_subscriptions').run();
// Cette licence connaît DÉJÀ un client Stripe : il ne doit jamais être remplacé.
db.prepare('UPDATE licences SET stripe_customer_id = ? WHERE lookup_hmac = ?').run('cus_demo', HMAC_DEMO);
eq(isExpired(licence()), true, 'AVANT : expirée');
{
  const r = await deliver('checkout.session.completed', checkout({
    id: 'cs_banc_2', subscription: 'sub_demo_2', client_reference_id: HMAC_DEMO,
    customer: 'cus_other', customer_details: { email: 'autre-adresse@example.test' },
  }));
  eq(r.status, 200, 'webhook → 200');
  const L = licence();
  eq(L.expires_at, null, 'APRÈS : expires_at effacé (la licence a été retrouvée par son identifiant)');
  eq(db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 1, 'toujours UNE licence — pas de 2e clé pour l\'autre adresse');
  eq(L.stripe_customer_id, 'cus_demo', 'le client Stripe déjà connu N\'est PAS remplacé (COALESCE)');
  eq(L.customer_email, 'redactrice@example.test', 'l\'e-mail de facturation déjà connu N\'est PAS remplacé');
}

console.log('\n\x1b[1m▶ Suite 3 — renouvellement (subscription.updated, même price) efface aussi une échéance manuelle\x1b[0m');
db.prepare('UPDATE licences SET expires_at = ? WHERE lookup_hmac = ?').run(YESTERDAY, HMAC_DEMO);
eq(isExpired(licence()), true, 'AVANT : une date passée a été (re)posée à la main');
{
  const r = await deliver('customer.subscription.updated', { id: 'sub_demo_2', status: 'active', livemode: true });
  eq(r.status, 200, 'webhook → 200');
  const L = licence();
  eq(L.expires_at, null, 'APRÈS : expires_at effacé');
  eq(L.is_active, 1, 'active');
}

console.log('\n\x1b[1m▶ Suite 4 — garde-fous inchangés\x1b[0m');
{
  // Résiliation : le sac se vide → licence fermée (comportement existant).
  const r = await deliver('customer.subscription.deleted', { id: 'sub_demo_2', status: 'canceled', livemode: true });
  eq(r.status, 200, 'webhook → 200');
  eq(licence().is_active, 0, 'résilier la seule app ferme la licence (comme avant)');
  // Une livraison REJOUÉE (même id d'événement) est dédupliquée : rien ne change.
  const before = licence();
  const first  = await deliver('checkout.session.completed', checkout({ id: 'cs_banc_3', subscription: 'sub_demo_3' }), 'evt_rejoue');
  eq(first.status, 200, 'première livraison → 200');
  const again  = await deliver('checkout.session.completed', checkout({ id: 'cs_banc_3', subscription: 'sub_demo_3' }), 'evt_rejoue');
  eq(again.json.deduped, true, 'la même livraison rejouée est dédupliquée (F-2)');
  eq(db.prepare('SELECT COUNT(*) AS n FROM licence_subscriptions WHERE subscription_id = ?').get('sub_demo_3').n, 1,
     'un seul rattachement malgré le rejeu');
  eq(before.is_active, 0, '(le rejeu part bien d\'une licence fermée par la résiliation…)');
  eq(licence().is_active, 1, '…et le nouvel achat la rouvre)');
  eq(stripeCalls.filter(u => !u.endsWith('/billing_portal/sessions'))
       .every(u => u.startsWith('https://api.stripe.com/v1/subscriptions/')), true,
     'hors portail, seule l\'API subscriptions a été consultée (pas d\'e-mail, pas de prices/products)');
}

console.log('\n\x1b[1m▶ Suite 5 — licence créée dans l\'Admin SANS e-mail, achat depuis l\'app\x1b[0m');
seedDemoLicence();
db.prepare('DELETE FROM licence_subscriptions').run();
db.prepare('UPDATE licences SET customer_email = NULL, expires_at = NULL WHERE lookup_hmac = ?').run(HMAC_DEMO);
eq(licence().customer_email, null, 'AVANT : pas d\'e-mail de facturation');
{
  const r = await deliver('checkout.session.completed', checkout({
    id: 'cs_banc_5', subscription: 'sub_demo_5', client_reference_id: HMAC_DEMO,
    customer: 'cus_cinq', customer_details: { email: 'facturation@example.test' },
  }));
  eq(r.status, 200, 'webhook → 200');
  const L = licence();
  eq(L.customer_email, 'facturation@example.test', 'APRÈS : l\'e-mail de facturation est complété depuis Stripe');
  eq(L.stripe_customer_id, 'cus_cinq', 'APRÈS : client Stripe rattaché');
  eq(db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, 1, 'toujours une seule licence');
}

// ── Résumé ─────────────────────────────────────────────────────
const total = pass + fail;
if (fail === 0) {
  console.log(`\n\x1b[32m\x1b[1m✓ ${pass}/${total} PASS\x1b[0m — webhook Stripe × licence à date (essai qui devient abonnement)\n`);
  process.exit(0);
} else {
  console.log(`\n\x1b[31m\x1b[1m✗ ${fail}/${total} FAIL\x1b[0m — webhook Stripe × licence à date\n`);
  process.exit(1);
}
