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
import { addPackCredits, removePackCredits } from '../lib/ai-credits.js';
import { ensureAutoReloadSchema }           from '../lib/auto-reload.js';
import { needsCreditWall }                  from '../lib/app-mode.js';

import {
  resolveAppFromPrice, resolveLegacyPlanFromPrice, resolvePackConversations,
  addEntitlement, removeEntitlement, technicalPlanFor, livemodeFlag,
  packConversationsForRefund, modeMatchesLicence,
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
  // Provenance de la licence (cf. livemodeFlag) : 1 = paiement réel,
  // 0 = paiement de test, NULL = créée avant cette colonne. Pas de
  // DEFAULT : une valeur par défaut mettrait tout l'historique dans le
  // même sac que les paiements réels, ce qui est vrai mais muet — NULL
  // dit « on ne sait pas », et le ménage (`= 0`) ne peut pas s'y tromper.
  try {
    await env.DB.prepare('ALTER TABLE licences ADD COLUMN livemode INTEGER').run();
  } catch (_) { /* colonne déjà là */ }
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

/**
 * Écrit le sac d'apps — et arme au passage le mur des conversations
 * quand ce sac contient une app publique (P7, `needsCreditWall`).
 *
 * Une app à SURFACE PUBLIQUE (Smart Agent, Concierge de Smart QR) part
 * par défaut en mode « clé en main » : c'est MOI qui fournis l'IA, et
 * son volume suit le trafic d'un TIERS. Le seul garde-fou est alors le
 * plafond mensuel de conversations — s'il n'est pas armé, le défaut
 * « clé en main » ne veut pas dire « 1 000 conversations puis recharge
 * plafonnée », il veut dire **illimité, gratuit, à ma charge**.
 *
 * Or `enforce_ai_credits_v1` n'était posé QUE à la main dans l'admin :
 * toute licence vendue naissait à 0. On l'arme donc au provisionnement,
 * là où la décision est prise, plutôt que de compter sur un geste
 * manuel au bon moment.
 *
 * On ne l'abaisse JAMAIS (voir le CASE) : retirer un plafond en silence
 * serait la mauvaise moitié de la symétrie.
 */
async function _writeOwnedAssets(env, lookupHmac, bag) {
  await env.DB.prepare(`
    UPDATE licences
       SET plan = ?, owned_assets = ?, is_active = 1,
           enforce_ai_credits_v1 = CASE WHEN ? = 1 THEN 1 ELSE enforce_ai_credits_v1 END,
           updated_at = datetime('now')
     WHERE lookup_hmac = ?`
  ).bind(technicalPlanFor(bag), JSON.stringify(bag), needsCreditWall(bag) ? 1 : 0, lookupHmac).run();
}

// URL du tunnel d'activation côté front (domaine officiel)
const ACTIVATE_BASE = 'https://protein-keystone.com/?ks_key=';

// ── Idempotence (audit sept. 2026 · F-2) ───────────────────────
// L'ancien schéma « lire avant, marquer après » laissait passer deux
// livraisons SIMULTANÉES du même événement (les deux lisaient « absent »
// avant que l'une n'écrive) → double crédit possible. Ici on RÉSERVE
// l'événement d'abord : INSERT OR IGNORE, et seul l'appel dont
// meta.changes === 1 a le droit de traiter. L'autre livraison dédupe.
async function _claimEvent(env, eventId, type) {
  const res = await env.DB
    .prepare('INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)')
    .bind(eventId, type)
    .run();
  return res?.meta?.changes === 1;
}
// En cas d'échec du handler, on RELÂCHE la réservation : Stripe va
// retenter, et ce retry doit pouvoir re-réserver (sinon l'événement
// serait dédupé à tort et perdu).
async function _releaseEvent(env, eventId) {
  try {
    await env.DB
      .prepare('DELETE FROM stripe_events WHERE id = ?')
      .bind(eventId)
      .run();
  } catch (_) {}
}

// ── Stripe API helper (REST) ──────────────────────────────────
// `key` optionnelle : les handlers la choisissent selon l'univers de
// l'événement (un objet de test n'existe QUE derrière la clé de test).
async function _stripeGET(env, path, key = null) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${key || env.KS_STRIPE_SECRET}` },
  });
  if (!res.ok) throw new Error(`Stripe ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Clé API assortie à l'univers de l'événement. */
function _apiKeyFor(env, event) {
  return event?.livemode === false ? env.KS_STRIPE_SECRET_TEST : env.KS_STRIPE_SECRET;
}

// Centimes → plan. Fallback quand le price n'a pas de lookup_key (cas des
// Payment Links créés depuis le Dashboard Stripe, qui n'en posent pas).
// À GARDER SYNCHRO avec la grille publique (index.html #plans + KS_PLANS).
// 49 € → STARTER · 99 € → PRO · 249 € → MAX.
const PRICE_AMOUNT_TO_PLAN = { 4900: 'STARTER', 9900: 'PRO', 24900: 'MAX' };

// Récupère le plan d'une subscription : d'abord par lookup_key, sinon par montant.
async function _resolvePlanFromSubscription(env, subscriptionId, key = null) {
  const sub = await _stripeGET(env, `/subscriptions/${subscriptionId}`, key);
  const item = sub?.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;

  // 1) Voie normale : lookup_key du price (ks_starter / ks_pro / ks_max).
  const lookup = price.lookup_key
    || (await _stripeGET(env, `/prices/${price.id}`, key))?.lookup_key;
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
async function _resolveSubscriptionTarget(env, subscriptionId, key = null) {
  const sub   = await _stripeGET(env, `/subscriptions/${subscriptionId}`, key);
  const item  = sub?.items?.data?.[0];
  let   price = item?.price;
  if (!price) return { app: null, plan: null };

  // L'objet price imbriqué peut être partiel : on le recharge si les
  // deux voies de résolution (metadata + lookup_key) sont muettes.
  if (!price.metadata?.ks_app && !price.lookup_key) {
    try { price = await _stripeGET(env, `/prices/${price.id}`, key) || price; } catch (_) {}
  }

  // Metadata portée par le PRODUIT plutôt que le prix (cas courant :
  // une valeur pour le produit, deux prix mensuel/annuel dessous).
  let product = null;
  if (!price.metadata?.ks_app && price.product) {
    const pid = typeof price.product === 'string' ? price.product : price.product?.id;
    if (pid) { try { product = await _stripeGET(env, `/products/${pid}`, key); } catch (_) {} }
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
// `testMode` (quarantaine 26/07) : la résolution par e-mail est le chemin
// DANGEREUX — c'est lui qui permettrait à un checkout de test d'enrichir
// la licence réelle portant la même adresse. Le filtre est donc en SQL :
// un événement de test ne PEUT résoudre qu'une licence livemode = 0.
async function _findLicenceForCustomer(env, { clientRef, customerId, customerEmail, testMode = false }) {
  const modeSql = testMode ? 'livemode = 0' : '(livemode IS NULL OR livemode != 0)';
  if (clientRef) {
    const r = await env.DB
      .prepare(`SELECT lookup_hmac FROM licences WHERE (lookup_hmac = ? OR key = ?) AND ${modeSql} LIMIT 1`)
      .bind(clientRef, clientRef).first();
    if (r?.lookup_hmac) return r.lookup_hmac;
  }
  if (customerId) {
    const r = await env.DB
      .prepare(`SELECT lookup_hmac FROM licences WHERE stripe_customer_id = ? AND ${modeSql} LIMIT 1`)
      .bind(customerId).first();
    if (r?.lookup_hmac) return r.lookup_hmac;
  }
  if (customerEmail) {
    const r = await env.DB
      .prepare(`SELECT lookup_hmac FROM licences WHERE customer_email = ? AND ${modeSql} LIMIT 1`)
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
    const li = await _stripeGET(env, `/checkout/sessions/${session.id}/line_items?limit=1`, _apiKeyFor(env, session));
    lookup   = li?.data?.[0]?.price?.lookup_key || null;
  } catch (_) { /* repli montant ci-dessous */ }
  const credits = resolvePackConversations({ lookupKey: lookup, amountTotal: session.amount_total });
  if (!credits) {
    console.error('[Stripe pack] crédits non résolus (lookup_key + montant inconnus) session', session.id, 'amount=', session.amount_total);
    return;
  }

  // 2) Retrouver la licence du payeur : client_reference_id (si la boutique
  //    l'a passé), sinon stripe_customer_id, sinon customer_email.
  // Quarantaine (26/07) : même filtre d'univers que _findLicenceForCustomer —
  // un pack payé en carte de TEST ne créditera jamais une licence réelle.
  const modeSql = session.livemode === false ? 'livemode = 0' : '(livemode IS NULL OR livemode != 0)';
  let lic = null;
  const ref = session.client_reference_id;
  if (ref) {
    lic = await env.DB
      .prepare(`SELECT lookup_hmac FROM licences WHERE (lookup_hmac = ? OR key = ?) AND ${modeSql} LIMIT 1`)
      .bind(ref, ref).first();
  }
  if (!lic && customerId) {
    lic = await env.DB
      .prepare(`SELECT lookup_hmac FROM licences WHERE stripe_customer_id = ? AND ${modeSql} LIMIT 1`)
      .bind(customerId).first();
  }
  if (!lic && customerEmail) {
    lic = await env.DB
      .prepare(`SELECT lookup_hmac FROM licences WHERE customer_email = ? AND ${modeSql} LIMIT 1`)
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

/* ── Remboursement d'un pack (charge.refunded, 26/07) ─────────────
   Le trou constaté en réel le 25/07 : rembourser un pack depuis le
   dashboard Stripe ne reprenait RIEN — le client gardait ses 1 000
   conversations ET ses 9 €. Ce handler ferme la boucle.

   Résolution de la licence, dans le MÊME ordre que l'achat :
     1. journal des recharges AUTO (`ai_auto_reload_log`, payment_intent
        en PK) → la source EXACTE quand le débit venait du cron P3 ;
     2. sinon : montant → pack (900/3900, sans ambiguïté), et licence
        par stripe_customer_id puis par e-mail de facturation.

   Ce qu'on ne fait PAS, volontairement (cf. packConversationsForRefund) :
   remboursement partiel ou montant d'abonnement → zéro reprise, un log.
   Et la reprise est PLANCHÉE à ce qui reste au solde : déjà consommé
   n'est jamais repris sur les conversations incluses. */

async function _handleChargeRefunded(env, event) {
  const charge = event.data.object;

  // Recharge auto P3 ? Le journal donne la licence ET le nombre exact.
  let hmac = null, credits = null, source = 'pack';
  try {
    const row = await env.DB
      .prepare('SELECT lookup_hmac, conversations FROM ai_auto_reload_log WHERE payment_intent = ? LIMIT 1')
      .bind(charge.payment_intent || '').first();
    if (row?.lookup_hmac) {
      hmac    = row.lookup_hmac;
      credits = parseInt(row.conversations, 10) || null;
      source  = 'recharge-auto';
    }
  } catch (_) { /* table pas encore née → chemin pack ci-dessous */ }

  // Achat manuel de pack : total + montant exact d'un pack, sinon rien.
  if (!credits) {
    credits = packConversationsForRefund(charge);
    if (!credits) {
      console.log('[Stripe refund] ignoré (partiel ou montant hors packs) charge', charge.id, 'amount=', charge.amount, 'refunded=', charge.refunded);
      return;
    }
  }
  if (!hmac) {
    if (charge.customer) {
      const lic = await env.DB
        .prepare('SELECT lookup_hmac FROM licences WHERE stripe_customer_id = ? LIMIT 1')
        .bind(charge.customer).first();
      hmac = lic?.lookup_hmac || null;
    }
    const mail = charge.billing_details?.email || charge.receipt_email;
    if (!hmac && mail) {
      const lic = await env.DB
        .prepare('SELECT lookup_hmac FROM licences WHERE customer_email = ? LIMIT 1')
        .bind(mail).first();
      hmac = lic?.lookup_hmac || null;
    }
  }
  if (!hmac) {
    console.error('[Stripe refund] licence introuvable pour charge', charge.id, '— conversations NON reprises (à réconcilier à la main)');
    return;
  }

  // Quarantaine : la licence résolue doit appartenir au même univers que
  // l'événement (le chemin journal peut précéder le filtre SQL).
  try {
    const lm = await env.DB.prepare('SELECT livemode FROM licences WHERE lookup_hmac = ? LIMIT 1').bind(hmac).first();
    if (lm && !modeMatchesLicence(event, lm.livemode)) {
      console.error('[Stripe refund] univers discordant (event/licence) — reprise refusée', charge.id, hmac.slice(0, 8));
      return;
    }
  } catch (_) { /* colonne absente = tout est réel, la garde n'a pas d'objet */ }

  const repris = await removePackCredits(env, hmac, credits);
  console.log(`[Stripe refund] ${source} : ${repris}/${credits} conversations reprises sur ${hmac.slice(0, 8)}… (charge ${charge.id})`);
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
    const intent = await _stripeGET(env, `/setup_intents/${encodeURIComponent(si)}`, _apiKeyFor(env, session));
    pm = intent?.payment_method || null;
    customer = intent?.customer || customer;
  } catch (e) {
    console.error('[P3 setup] SetupIntent illisible :', e.message);
    return;
  }
  if (!pm) { console.error('[P3 setup] aucun moyen de paiement sur', si); return; }

  // Quarantaine : une carte de TEST ne se rattache qu'à une licence de
  // test — sinon le balayage tenterait un débit live sur un pm de test.
  try {
    const lm = await env.DB.prepare('SELECT livemode FROM licences WHERE lookup_hmac = ? LIMIT 1').bind(hmac).first();
    if (lm && !modeMatchesLicence(session, lm.livemode)) {
      console.error('[P3 setup] univers discordant (session/licence) — carte NON rattachée', session.id, hmac.slice(0, 8));
      return;
    }
  } catch (_) { /* colonne absente = tout est réel */ }
  // `livemode` tamponné sur la config : c'est LUI qui décidera de la clé
  // API du balayage (un débit de test ne part jamais sur la clé live).
  const cfgLive = session.livemode === false ? 0 : 1;

  // Le webhook peut être le PREMIER à toucher cette table (si le client
  // n'a jamais ouvert ses réglages) : sans ça, l'INSERT lèverait.
  await ensureAutoReloadSchema(env);
  await env.DB.prepare(`
    INSERT INTO ai_auto_reload (lookup_hmac, stripe_customer, payment_method, livemode, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(lookup_hmac) DO UPDATE SET
      stripe_customer = ?, payment_method = ?, livemode = ?,
      -- Une carte fraîche lève une pause « carte refusée » : le client
      -- vient précisément de corriger la cause.
      paused_at = CASE WHEN paused_reason IN ('payment_failed','authentication_required','no_payment_method')
                       THEN NULL ELSE paused_at END,
      paused_reason = CASE WHEN paused_reason IN ('payment_failed','authentication_required','no_payment_method')
                       THEN NULL ELSE paused_reason END,
      updated_at = datetime('now')
  `).bind(hmac, customer, pm, cfgLive, customer, pm, cfgLive).run();
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
  const target = await _resolveSubscriptionTarget(env, subId, _apiKeyFor(env, session));

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
      testMode: session.livemode === false,
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
        lookup_hmac, key_hash, salt, enforce_ai_credits_v1, livemode, created_at
      ) VALUES (?, 'default', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      newKey, customerEmail.split('@')[0], technicalPlanFor(bag), JSON.stringify(bag),
      customerEmail, customerId, subId, newHmac, kh.hash, kh.salt,
      needsCreditWall(bag) ? 1 : 0,   // P7 — app publique ⇒ mur armé dès la 1re seconde
      livemodeFlag(event),            // provenance : 0 = paiement de test, jetable
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
      lookup_hmac, key_hash, salt, livemode, created_at
    ) VALUES (?, 'default', ?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
    livemodeFlag(event),   // même provenance sur le chemin legacy
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
    const { app } = await _resolveSubscriptionTarget(env, sub.id, _apiKeyFor(env, sub));
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
  const newPlan = await _resolvePlanFromSubscription(env, sub.id, _apiKeyFor(env, sub));
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
  // Banc d'essai (26/07) : la signature est essayée avec le secret LIVE
  // d'abord, puis avec le secret TEST s'il est configuré. Un même worker
  // sert donc les deux univers — la quarantaine `modeMatchesLicence`
  // garantit qu'un événement de test ne touche que des licences de test.
  let event = await verifyStripeWebhook(rawBody, sig, env.KS_STRIPE_WEBHOOK_SECRET);
  if (!event && env.KS_STRIPE_WEBHOOK_SECRET_TEST) {
    event = await verifyStripeWebhook(rawBody, sig, env.KS_STRIPE_WEBHOOK_SECRET_TEST);
  }
  if (!event) return err('Signature invalide', 400, origin);

  // Un événement de test sans clé API de test : on ne peut RIEN résoudre
  // chez Stripe (subscriptions, line items…). On l'avale en 200 — le
  // laisser en erreur ferait retenter Stripe en boucle pour rien.
  if (event.livemode === false && !env.KS_STRIPE_SECRET_TEST) {
    console.log('[Stripe webhook] événement de test ignoré (KS_STRIPE_SECRET_TEST absent)', event.id);
    return json({ received: true, ignored: 'test_key_missing' }, 200, origin);
  }

  // Idempotence : réservation AVANT traitement (F-2). Si la ligne existe
  // déjà — traitement passé ou livraison jumelle en cours — on dédupe.
  if (!(await _claimEvent(env, event.id, event.type))) {
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
      case 'charge.refunded':
        await _handleChargeRefunded(env, event);
        break;
      default:
        // Pas d'erreur — Stripe envoie plein d'autres events qu'on ignore.
        break;
    }
    return json({ received: true }, 200, origin);
  } catch (e) {
    console.error('[Stripe webhook]', event.type, e);
    // Réservation relâchée → Stripe va retry et pourra re-réserver.
    await _releaseEvent(env, event.id);
    return err(`Handler error: ${e.message}`, 500, origin);
  }
}
