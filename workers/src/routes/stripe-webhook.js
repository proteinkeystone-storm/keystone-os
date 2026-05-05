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

const PRICE_LOOKUP_TO_PLAN = {
  ks_starter: 'STARTER',
  ks_pro:     'PRO',
  ks_max:     'MAX',
};

// URL du tunnel d'activation côté front (landing Vercel)
const ACTIVATE_BASE = 'https://keystone-os-inky.vercel.app/?ks_key=';

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

// Récupère le lookup_key du price d'une subscription
async function _resolvePlanFromSubscription(env, subscriptionId) {
  const sub = await _stripeGET(env, `/subscriptions/${subscriptionId}`);
  const item = sub?.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;

  // Soit le price.lookup_key est directement présent dans l'event,
  // soit on doit interroger /prices/{id} avec ?expand[]=...
  const lookup = price.lookup_key
    || (await _stripeGET(env, `/prices/${price.id}`))?.lookup_key;
  return PRICE_LOOKUP_TO_PLAN[lookup] || null;
}

// ═══════════════════════════════════════════════════════════════
// Event handlers
// ═══════════════════════════════════════════════════════════════

async function _handleCheckoutCompleted(env, event) {
  const session = event.data.object;
  if (session.mode !== 'subscription') return; // on n'auto-active que les abos

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

  await env.DB.prepare(`
    INSERT INTO licences (
      key, owner, plan, is_active, owned_assets, customer_email,
      stripe_customer_id, stripe_subscription_id,
      lookup_hmac, key_hash, salt, created_at
    ) VALUES (?, ?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, datetime('now'))
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
