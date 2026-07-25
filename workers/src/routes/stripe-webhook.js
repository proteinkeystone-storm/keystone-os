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
import { ensureAutoReloadSchema }           from '../lib/auto-reload.js';

import {
  resolveAppFromPrice, resolveLegacyPlanFromPrice, resolvePackConversations,
  addEntitlement, removeEntitlement, technicalPlanFor,
} from '../lib/stripe-catalog.js';

const PRICE_LOOKUP_TO_PLAN = {
  ks_starter: 'STARTER',
  ks_pro:     'PRO',
  ks_max:     'MAX',
};

// ── P4 · une licence, PLUSIEURS abonnements ─────────────────────
// Sous le modèle per-app, un même client peut s'abonner à Ghost Writer
// puis à desK : deux subscriptions Stripe, une seule licence. La colonne
// `licences.stripe_subscription_id` (unique) ne suffit plus — elle garde
// la PREMIÈRE pour compatibilité, et cette table porte la vérité :
// quel abonnement finance quelle app, sur quelle licence.
// Sans elle, une résiliation ne saurait pas QUELLE app retirer.
let _p4SchemaReady = false;
async function _ensureP4Schema(env) {
  if (_p4SchemaReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS licence_subscriptions (
        subscription_id TEXT PRIMARY KEY,
        lookup_hmac     TEXT NOT NULL,
        app_id          TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'active',
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  } catch (_) { /* déjà créée */ }
  try {
    await env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_lic_subs_hmac ON licence_subscriptions(lookup_hmac)'
    ).run();
  } catch (_) {}
  _p4SchemaReady = true;
}

// Lecture / écriture du sac d'apps d'une licence (JSON en base).
async function _readOwnedAssets(env, lookupHmac) {
  const row = await env.DB
    .prepare('SELECT owned_assets FROM licences WHERE lookup_hmac = ? LIMIT 1')
    .bind(lookupHmac).first();
  if (!row) return undefined;                    // licence absente
  if (!row.owned_assets) return null;            // sentinelle legacy « tout »
  try {
    const parsed = JSON.parse(row.owned_assets);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) { return null; }
}

async function _writeOwnedAssets(env, lookupHmac, bag) {
  await env.DB.prepare(
    "UPDATE licences SET plan = ?, owned_assets = ?, is_active = 1, updated_at = datetime('now') WHERE lookup_hmac = ?"
  ).bind(technicalPlanFor(bag), JSON.stringify(bag), lookupHmac).run();
}

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

/**
 * P4 — que finance cet abonnement ?
 * @returns {{app: ?string, plan: ?string}}
 *   app  : id d'app ou 'OS' (nouveau modèle per-app)
 *   plan : STARTER/PRO/MAX (abonnement LEGACY, price sans ks_app)
 * Les deux à null = price inconnu : on n'accorde RIEN et on journalise.
 * On ne devine JAMAIS depuis le montant côté app (cinq apps à 19 €).
 */
async function _resolveSubscriptionTarget(env, subscriptionId) {
  const sub   = await _stripeGET(env, `/subscriptions/${subscriptionId}`);
  const item  = sub?.items?.data?.[0];
  let   price = item?.price;
  if (!price) return { app: null, plan: null };

  // L'objet price imbriqué peut être partiel : on le recharge si les
  // deux voies de résolution (metadata + lookup_key) sont muettes.
  if (!price.metadata?.ks_app && !price.lookup_key) {
    try { price = await _stripeGET(env, `/prices/${price.id}`) || price; } catch (_) {}
  }

  // Metadata portée par le PRODUIT plutôt que le prix (cas courant :
  // une valeur pour le produit, deux prix mensuel/annuel dessous).
  let product = null;
  if (!price.metadata?.ks_app && price.product) {
    const pid = typeof price.product === 'string' ? price.product : price.product?.id;
    if (pid) { try { product = await _stripeGET(env, `/products/${pid}`); } catch (_) {} }
  }

  const app = resolveAppFromPrice(price, product);
  if (app) return { app, plan: null };

  const plan = resolveLegacyPlanFromPrice(price);
  if (plan) return { app: null, plan };

  console.error('[Stripe] price non résolu pour sub', subscriptionId,
                '— ni metadata ks_app, ni lookup_key connu, ni montant legacy.',
                'price=', price?.id, 'amount=', price?.unit_amount);
  return { app: null, plan: null };
}

/**
 * Retrouve la licence d'un acheteur.
 * Ordre de fiabilité : `client_reference_id` (posé par notre propre page
 * de paiement, cf. routes/stripe-checkout.js) — c'est l'identifiant EXACT
 * de la licence, il ne se devine pas — puis le client Stripe, puis
 * l'e-mail. Sans le premier, un client qui paie avec une autre adresse
 * recevrait une seconde clé au lieu d'enrichir son sac.
 */
async function _findLicenceForCustomer(env, { clientRef, customerId, customerEmail }) {
  if (clientRef) {
    const r = await env.DB
      .prepare('SELECT lookup_hmac FROM licences WHERE lookup_hmac = ? OR key = ? LIMIT 1')
      .bind(clientRef, clientRef).first();
    if (r?.lookup_hmac) return r.lookup_hmac;
  }
  if (customerId) {
    const r = await env.DB
      .prepare('SELECT lookup_hmac FROM licences WHERE stripe_customer_id = ? LIMIT 1')
      .bind(customerId).first();
    if (r?.lookup_hmac) return r.lookup_hmac;
  }
  if (customerEmail) {
    const r = await env.DB
      .prepare('SELECT lookup_hmac FROM licences WHERE customer_email = ? LIMIT 1')
      .bind(customerEmail).first();
    if (r?.lookup_hmac) return r.lookup_hmac;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Event handlers
// ═══════════════════════════════════════════════════════════════

// ── Packs de conversations (Chantier B · Sprint 5, renommés en P2) ──
// Achat = paiement UNIQUE (mode 'payment'), pas un abonnement. Le barème
// vit maintenant dans lib/stripe-catalog.js (resolvePackConversations),
// aux côtés du reste du catalogue — un seul endroit à tenir à jour.
//   9 € → 1 000 conversations · 39 € → 5 000.

async function _handlePackPurchase(env, session) {
  const customerEmail = session.customer_details?.email || session.customer_email;
  const customerId    = session.customer;

  // 1) Combien de conversations ? lookup_key du line item, sinon montant.
  //    Ici le repli par montant reste SÛR : les deux packs ont des prix
  //    distincts (9 € / 39 €), aucune ambiguïté — contrairement aux apps.
  let lookup = null;
  try {
    const li = await _stripeGET(env, `/checkout/sessions/${session.id}/line_items?limit=1`);
    lookup   = li?.data?.[0]?.price?.lookup_key || null;
  } catch (_) { /* repli montant ci-dessous */ }
  const credits = resolvePackConversations({ lookupKey: lookup, amountTotal: session.amount_total });
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

/* ── P3 · fin de l'enregistrement de carte (mode:'setup') ─────────
   La session a créé un SetupIntent ; c'est lui qui porte le moyen de
   paiement à mémoriser. On le rattache à la licence, identifiée par
   `client_reference_id` (posé à l'ouverture de la session).

   ⚠️ Sans `payment_method` en base, `shouldReload()` refuse (verrou
   NO_CARD) : si cette étape échoue, la recharge reste inerte plutôt que
   de tenter un débit sans carte. On ne « répare » donc rien en urgence.

   On n'ACTIVE PAS la recharge ici. Enregistrer une carte n'est pas
   demander à être prélevé : le client garde la main sur l'interrupteur. */
async function _handleAutoReloadSetupCompleted(env, session) {
  const hmac = session.client_reference_id || session.metadata?.ks_licence;
  const si   = session.setup_intent;
  if (!hmac || !si) {
    console.error('[P3 setup] session incomplète', session.id, 'ref=', hmac, 'si=', si);
    return;
  }
  let pm = null, customer = session.customer || null;
  try {
    const intent = await _stripeGET(env, `/setup_intents/${encodeURIComponent(si)}`);
    pm = intent?.payment_method || null;
    customer = intent?.customer || customer;
  } catch (e) {
    console.error('[P3 setup] SetupIntent illisible :', e.message);
    return;
  }
  if (!pm) { console.error('[P3 setup] aucun moyen de paiement sur', si); return; }

  // Le webhook peut être le PREMIER à toucher cette table (si le client
  // n'a jamais ouvert ses réglages) : sans ça, l'INSERT lèverait.
  await ensureAutoReloadSchema(env);
  await env.DB.prepare(`
    INSERT INTO ai_auto_reload (lookup_hmac, stripe_customer, payment_method, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(lookup_hmac) DO UPDATE SET
      stripe_customer = ?, payment_method = ?,
      -- Une carte fraîche lève une pause « carte refusée » : le client
      -- vient précisément de corriger la cause.
      paused_at = CASE WHEN paused_reason IN ('payment_failed','authentication_required','no_payment_method')
                       THEN NULL ELSE paused_at END,
      paused_reason = CASE WHEN paused_reason IN ('payment_failed','authentication_required','no_payment_method')
                       THEN NULL ELSE paused_reason END,
      updated_at = datetime('now')
  `).bind(hmac, customer, pm, customer, pm).run();
  console.log('[P3 setup] carte enregistrée pour la licence', hmac);
}

async function _handleCheckoutCompleted(env, event) {
  const session = event.data.object;
  // Chantier B Sprint 5 — pack de crédits = paiement UNIQUE (mode 'payment').
  if (session.mode === 'payment') {
    await _handlePackPurchase(env, session);
    return;
  }
  // Sprint P3 — enregistrement de carte pour la recharge auto. Aucun
  // argent n'a bougé : la session `mode:'setup'` a seulement mémorisé un
  // moyen de paiement, qu'on rattache ici à la licence.
  if (session.mode === 'setup') {
    await _handleAutoReloadSetupCompleted(env, session);
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

  await _ensureP4Schema(env);
  const target = await _resolveSubscriptionTarget(env, subId);

  // ── P4 · achat d'UNE application (ou de l'OS) ──────────────────
  // Le chemin s'ouvre uniquement si le price porte `ks_app` : les
  // anciens prix n'en ont pas, ils passent donc par le legacy plus bas.
  // C'est le garde-fou : aucun abonnement existant ne change de nature.
  if (target.app) {
    const dup = await env.DB
      .prepare('SELECT subscription_id FROM licence_subscriptions WHERE subscription_id = ?')
      .bind(subId).first();
    if (dup) return;                                   // déjà traité

    // Le client a-t-il DÉJÀ une licence ? Alors on l'enrichit — on ne
    // lui envoie pas une deuxième clé : une personne, une licence, un
    // sac qui s'agrandit.
    const known = await _findLicenceForCustomer(env, {
      clientRef: session.client_reference_id,
      customerId,
      customerEmail,
    });
    if (known) {
      const bag = await _readOwnedAssets(env, known);
      // bag === null : sentinelle legacy « tout ouvert » (MAX/ADMIN) —
      // addEntitlement la laisse telle quelle, sinon l'achat RESTREINDRAIT
      // l'accès du client au lieu de l'étendre.
      const next = addEntitlement(bag === null ? null : (bag || []), target.app);
      if (next !== null) await _writeOwnedAssets(env, known, next);
      await env.DB.prepare(`
        INSERT OR REPLACE INTO licence_subscriptions (subscription_id, lookup_hmac, app_id, status, updated_at)
        VALUES (?, ?, ?, 'active', datetime('now'))
      `).bind(subId, known, target.app).run();
      console.log('[Stripe] app', target.app, 'ajoutée à la licence', known);
      return;
    }

    // Première commande de ce client → clé + licence, sac = cette app.
    const newKey  = generateLicenceKey();
    const newHmac = await blindIndex(newKey, env.KS_LOOKUP_PEPPER);
    const kh      = await hashKey(newKey);
    const bag     = [target.app];
    await env.DB.prepare(`
      INSERT INTO licences (
        key, tenant_id, owner, plan, is_active, owned_assets, customer_email,
        stripe_customer_id, stripe_subscription_id,
        lookup_hmac, key_hash, salt, created_at
      ) VALUES (?, 'default', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      newKey, customerEmail.split('@')[0], technicalPlanFor(bag), JSON.stringify(bag),
      customerEmail, customerId, subId, newHmac, kh.hash, kh.salt,
    ).run();
    await env.DB.prepare(`
      INSERT OR REPLACE INTO licence_subscriptions (subscription_id, lookup_hmac, app_id, status, updated_at)
      VALUES (?, ?, ?, 'active', datetime('now'))
    `).bind(subId, newHmac, target.app).run();

    try {
      await sendEmail(env, {
        to:      customerEmail,
        bcc:     'protein.keystone@gmail.com',
        replyTo: 'protein.keystone@gmail.com',
        subject: 'Votre clé Keystone OS',
        html:    tplWelcomeKey({
          ownerName:   customerEmail.split('@')[0],
          plan:        target.app === 'OS' ? 'OS complet' : target.app,
          key:         newKey,
          activateUrl: ACTIVATE_BASE + encodeURIComponent(newKey),
        }),
      });
    } catch (e) {
      console.error('[Stripe] Resend KO :', e.message);
    }
    return;
  }

  // ── Chemin LEGACY (3 anciens plans) — inchangé ─────────────────
  const plan = target.plan;
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

// P4 — retire l'app financée par cet abonnement. La licence n'est
// désactivée QUE si le sac se vide : résilier desK ne doit pas fermer
// Ghost Writer, que le client paie toujours.
// @returns {boolean} true si l'abonnement relevait du modèle per-app
async function _revokeAppSubscription(env, subscriptionId) {
  await _ensureP4Schema(env);
  const map = await env.DB
    .prepare('SELECT lookup_hmac, app_id FROM licence_subscriptions WHERE subscription_id = ? LIMIT 1')
    .bind(subscriptionId).first();
  if (!map) return false;

  const bag = await _readOwnedAssets(env, map.lookup_hmac);
  if (Array.isArray(bag)) {
    const next = removeEntitlement(bag, map.app_id);
    if (next.length === 0) {
      // Plus rien de payé → on ferme, comme avant.
      await env.DB.prepare(
        "UPDATE licences SET plan = ?, owned_assets = ?, is_active = 0, updated_at = datetime('now') WHERE lookup_hmac = ?"
      ).bind(technicalPlanFor(next), JSON.stringify(next), map.lookup_hmac).run();
    } else {
      await _writeOwnedAssets(env, map.lookup_hmac, next);
    }
  }
  await env.DB.prepare(
    "UPDATE licence_subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE subscription_id = ?"
  ).bind(subscriptionId).run();
  console.log('[Stripe] app', map.app_id, 'retirée de la licence', map.lookup_hmac);
  return true;
}

async function _handleSubscriptionDeleted(env, event) {
  const sub = event.data.object;
  if (await _revokeAppSubscription(env, sub.id)) return;
  // Legacy : un abonnement d'avant = toute la licence.
  await env.DB.prepare(`
    UPDATE licences SET is_active = 0
     WHERE stripe_subscription_id = ?
  `).bind(sub.id).run();
}

async function _handleSubscriptionUpdated(env, event) {
  const sub = event.data.object;
  await _ensureP4Schema(env);

  // Si Stripe marque l'abo canceled/unpaid → mêmes règles qu'une résiliation.
  if (sub.status === 'canceled' || sub.status === 'unpaid') {
    if (await _revokeAppSubscription(env, sub.id)) return;
    await env.DB.prepare(`
      UPDATE licences SET is_active = 0
       WHERE stripe_subscription_id = ?
    `).bind(sub.id).run();
    return;
  }

  // P4 — changement de price sur un abonnement per-app : c'est ainsi
  // qu'on passe d'« une app » à « l'OS complet » depuis le portail
  // Stripe (prorata natif). On échange l'ancien droit contre le neuf.
  const map = await env.DB
    .prepare('SELECT lookup_hmac, app_id FROM licence_subscriptions WHERE subscription_id = ? LIMIT 1')
    .bind(sub.id).first();
  if (map) {
    const { app } = await _resolveSubscriptionTarget(env, sub.id);
    if (app && app !== map.app_id) {
      const bag = await _readOwnedAssets(env, map.lookup_hmac);
      if (Array.isArray(bag)) {
        await _writeOwnedAssets(env, map.lookup_hmac, addEntitlement(removeEntitlement(bag, map.app_id), app));
      }
      await env.DB.prepare(
        "UPDATE licence_subscriptions SET app_id = ?, status = 'active', updated_at = datetime('now') WHERE subscription_id = ?"
      ).bind(app, sub.id).run();
      console.log('[Stripe] licence', map.lookup_hmac, ':', map.app_id, '→', app);
    } else {
      await env.DB.prepare(
        "UPDATE licence_subscriptions SET status = 'active', updated_at = datetime('now') WHERE subscription_id = ?"
      ).bind(sub.id).run();
      await env.DB.prepare(
        "UPDATE licences SET is_active = 1 WHERE lookup_hmac = ?"
      ).bind(map.lookup_hmac).run();
    }
    return;
  }

  // Legacy : changement de plan sur un abonnement d'avant.
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
