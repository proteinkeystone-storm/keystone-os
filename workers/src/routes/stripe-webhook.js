/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Stripe Webhook (Sprint 5)
   ─────────────────────────────────────────────────────────────
   Endpoint : POST /api/stripe/webhook
   Reçoit les events Stripe pour automatiser :
     - checkout.session.completed       → 1ère souscription, génère + envoie clé
     - customer.subscription.deleted    → annulation, désactive la licence
     - customer.subscription.updated    → changement de plan (upgrade/downgrade)
     - invoice.payment_failed           → log + email rappel (optionnel)

   Mapping plan ← lookup_key Stripe (à créer dans Dashboard Stripe) :
     ks_starter → STARTER
     ks_pro     → PRO
     ks_max     → MAX
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin }      from '../lib/auth.js';
import { verifyStripeWebhook }              from '../lib/stripe.js';
import { generateLicenceKey }               from '../lib/keygen.js';
import { blindIndex, hashKey }              from '../lib/kdf.js';
import { sendEmail, tplWelcomeKey }         from '../lib/email-resend.js';
import { addPackCredits }                   from '../lib/ai-credits.js';

const PRICE_LOOKUP_TO_PLAN = {
  ks_starter: 'STARTER',
  ks_pro:     'PRO',
  ks_max:     'MAX',
};

// URL du tunnel d'activation côté front (domaine officiel)
const ACTIVATE_BASE = 'https://protein-keystone.com/?ks_key=';

// ───────────────────────────────────────────────────────────────
async function _alreadyProcessed(env, eventId) {
  const row = await env.DB
    .prepare('SELECT id FROM stripe_events WHERE id = ?')
    .bind(eventId)
    .first();
  return !!row;
}
async function _markProcessed(env, eventId, type) {
  try {
    await env.DB
      .prepare('INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)')
      .bind(eventId, type)
      .run();
  } catch (_) {}
}

// ── Stripe API helper (REST) ──────────────────────────────────
async function _stripeGET(env, path) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${env.KS_STRIPE_SECRET}` },
  });
  if (!res.ok) throw new Error(`Stripe ${path}: HTTP ${res.status}`);
  return res.json();
}

// Centimes → plan. Fallback quand le price n'a pas de lookup_key (cas des
// Payment Links créés depuis le Dashboard Stripe, qui n'en posent pas).
// À GARDER SYNCHRO avec la grille publique (index.html #plans + KS_PLANS).
// 49 € → STARTER · 99 € → PRO · 249 € → MAX.
const PRICE_AMOUNT_TO_PLAN = { 4900: 'STARTER', 9900: 'PRO', 24900: 'MAX' };

// Récupère le plan d'une subscription : d'abord par lookup_key, sinon par montant.
async function _resolvePlanFromSubscription(env, subscriptionId) {
  const sub = await _stripeGET(env, `/subscriptions/${subscriptionId}`);
  const item = sub?.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;

  // 1) Voie normale : lookup_key du price (ks_starter / ks_pro / ks_max).
  const lookup = price.lookup_key
    || (await _stripeGET(env, `/prices/${price.id}`))?.lookup_key;
  if (lookup && PRICE_LOOKUP_TO_PLAN[lookup]) {
    return PRICE_LOOKUP_TO_PLAN[lookup];
  }

  // 2) Fallback par MONTANT (les nouveaux liens 49/99/249 n'ont pas de lookup_key).
  const amount = price.unit_amount;
  if (amount && PRICE_AMOUNT_TO_PLAN[amount]) {
    return PRICE_AMOUNT_TO_PLAN[amount];
  }

  console.error('[Stripe] plan non résolu (lookup_key + montant inconnus) sub', subscriptionId, 'amount=', amount);
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Event handlers
// ═══════════════════════════════════════════════════════════════

// ── Packs de crédits IA (Chantier B · Sprint 5) ────────────────
// Achat = paiement UNIQUE (mode 'payment'), pas un abonnement. On mappe
// le produit acheté → un nombre de crédits, puis on recharge le solde
// persistant de la licence du payeur (ai_credit_balance via addPackCredits).
// À GARDER SYNCHRO avec les produits Stripe "Pack N crédits".
//   9 € → 1000 crédits · 39 € → 5000 crédits.
const PACK_LOOKUP_TO_CREDITS = { ks_pack_1000: 1000, ks_pack_5000: 5000 };
const PACK_AMOUNT_TO_CREDITS = { 900: 1000, 3900: 5000 };

async function _handlePackPurchase(env, session) {
  const customerEmail = session.customer_details?.email || session.customer_email;
  const customerId    = session.customer;

  // 1) Combien de crédits ? lookup_key du line item (robuste), sinon montant.
  let credits = 0;
  try {
    const li     = await _stripeGET(env, `/checkout/sessions/${session.id}/line_items?limit=1`);
    const lookup = li?.data?.[0]?.price?.lookup_key;
    if (lookup && PACK_LOOKUP_TO_CREDITS[lookup]) credits = PACK_LOOKUP_TO_CREDITS[lookup];
  } catch (_) { /* fallback montant ci-dessous */ }
  if (!credits) {
    const amount = session.amount_total;
    if (amount && PACK_AMOUNT_TO_CREDITS[amount]) credits = PACK_AMOUNT_TO_CREDITS[amount];
  }
  if (!credits) {
    console.error('[Stripe pack] crédits non résolus (lookup_key + montant inconnus) session', session.id, 'amount=', session.amount_total);
    return;
  }

  // 2) Retrouver la licence du payeur : client_reference_id (si la boutique
  //    l'a passé), sinon stripe_customer_id, sinon customer_email.
  let lic = null;
  const ref = session.client_reference_id;
  if (ref) {
    lic = await env.DB
      .prepare('SELECT lookup_hmac FROM licences WHERE lookup_hmac = ? OR key = ? LIMIT 1')
      .bind(ref, ref).first();
  }
  if (!lic && customerId) {
    lic = await env.DB
      .prepare('SELECT lookup_hmac FROM licences WHERE stripe_customer_id = ? LIMIT 1')
      .bind(customerId).first();
  }
  if (!lic && customerEmail) {
    lic = await env.DB
      .prepare('SELECT lookup_hmac FROM licences WHERE customer_email = ? LIMIT 1')
      .bind(customerEmail).first();
  }
  if (!lic?.lookup_hmac) {
    console.error('[Stripe pack] licence introuvable pour', customerEmail || customerId, '— crédits NON attribués (à réconcilier à la main)');
    return;
  }

  // 3) Créditer. Idempotence assurée en amont par stripe_events (event id).
  await addPackCredits(env, lic.lookup_hmac, credits);
  console.log('[Stripe pack]', credits, 'crédits attribués à la licence', lic.lookup_hmac);
}

async function _handleCheckoutCompleted(env, event) {
  const session = event.data.object;
  // Chantier B Sprint 5 — pack de crédits = paiement UNIQUE (mode 'payment').
  if (session.mode === 'payment') {
    await _handlePackPurchase(env, session);
    return;
  }
  if (session.mode !== 'subscription') return; // autres modes : ignorés

  const customerEmail = session.customer_details?.email || session.customer_email;
  const customerId    = session.customer;
  const subId         = session.subscription;
  if (!customerEmail || !customerId || !subId) return;

  // Idempotence : si une licence existe déjà pour cette subscription, skip
  const existing = await env.DB
    .prepare('SELECT key FROM licences WHERE stripe_subscription_id = ?')
    .bind(subId)
    .first();
  if (existing) return;

  // Résoudre le plan via le lookup_key du price
  const plan = await _resolvePlanFromSubscription(env, subId);
  if (!plan) {
    console.error('[Stripe] lookup_key inconnu pour sub', subId);
    return;
  }

  // Génération de la clé + hash + blind index
  const key = generateLicenceKey();
  const lookupHmac = await blindIndex(key, env.KS_LOOKUP_PEPPER);
  const { hash, salt } = await hashKey(key);

  // Sprint Sécu-1 / C4 — décision Q1c :
  // Les licences Stripe (B2C, payeurs solo) atterrissent toutes dans
  // tenant_id='default'. L'isolation entre payeurs passe par JWT.sub
  // (= lookup_hmac), pas par tenant_id. Les clients B2B (type Prométhée)
  // ont leur propre tenant_id, créé manuellement via /api/licence/activate.
  // tenant_id est posé explicitement ici pour rendre l'intention lisible.
  await env.DB.prepare(`
    INSERT INTO licences (
      key, tenant_id, owner, plan, is_active, owned_assets, customer_email,
      stripe_customer_id, stripe_subscription_id,
      lookup_hmac, key_hash, salt, created_at
    ) VALUES (?, 'default', ?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    key,
    customerEmail.split('@')[0],
    plan,
    customerEmail,
    customerId,
    subId,
    lookupHmac,
    hash,
    salt,
  ).run();

  // Envoi email
  try {
    await sendEmail(env, {
      to:      customerEmail,
      bcc:     'protein.keystone@gmail.com',
      replyTo: 'protein.keystone@gmail.com',
      subject: `Votre clé Keystone OS — Plan ${plan}`,
      html:    tplWelcomeKey({
        ownerName:   customerEmail.split('@')[0],
        plan,
        key,
        activateUrl: ACTIVATE_BASE + encodeURIComponent(key),
      }),
    });
  } catch (e) {
    console.error('[Stripe] Resend KO :', e.message);
  }
}

async function _handleSubscriptionDeleted(env, event) {
  const sub = event.data.object;
  await env.DB.prepare(`
    UPDATE licences SET is_active = 0
     WHERE stripe_subscription_id = ?
  `).bind(sub.id).run();
}

async function _handleSubscriptionUpdated(env, event) {
  const sub = event.data.object;
  // Si Stripe marque l'abo cancel_at_period_end ou status canceled → désactive
  if (sub.status === 'canceled' || sub.status === 'unpaid') {
    await env.DB.prepare(`
      UPDATE licences SET is_active = 0
       WHERE stripe_subscription_id = ?
    `).bind(sub.id).run();
    return;
  }
  // Sinon, vérifier si le plan a changé (upgrade/downgrade)
  const newPlan = await _resolvePlanFromSubscription(env, sub.id);
  if (newPlan) {
    await env.DB.prepare(`
      UPDATE licences SET plan = ?, is_active = 1
       WHERE stripe_subscription_id = ?
    `).bind(newPlan, sub.id).run();
  }
}

// ═══════════════════════════════════════════════════════════════
// Handler exporté
// ═══════════════════════════════════════════════════════════════
export async function handleStripeWebhook(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!env.KS_STRIPE_WEBHOOK_SECRET) {
    return err('Server: KS_STRIPE_WEBHOOK_SECRET manquant', 500, origin);
  }
  if (!env.KS_STRIPE_SECRET) {
    return err('Server: KS_STRIPE_SECRET manquant', 500, origin);
  }

  const rawBody = await request.text();
  const sig     = request.headers.get('Stripe-Signature') || '';
  const event   = await verifyStripeWebhook(rawBody, sig, env.KS_STRIPE_WEBHOOK_SECRET);
  if (!event) return err('Signature invalide', 400, origin);

  // Idempotence
  if (await _alreadyProcessed(env, event.id)) {
    return json({ received: true, deduped: true }, 200, origin);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await _handleCheckoutCompleted(env, event);
        break;
      case 'customer.subscription.deleted':
        await _handleSubscriptionDeleted(env, event);
        break;
      case 'customer.subscription.updated':
        await _handleSubscriptionUpdated(env, event);
        break;
      default:
        // Pas d'erreur — Stripe envoie plein d'autres events qu'on ignore.
        break;
    }
    await _markProcessed(env, event.id, event.type);
    return json({ received: true }, 200, origin);
  } catch (e) {
    console.error('[Stripe webhook]', event.type, e);
    // Ne PAS marquer processed → Stripe va retry, c'est ce qu'on veut
    return err(`Handler error: ${e.message}`, 500, origin);
  }
}
