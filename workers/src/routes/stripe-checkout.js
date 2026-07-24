/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Ouverture d'un paiement (Sprint P5 · option B)
   ─────────────────────────────────────────────────────────────
   POST /api/stripe/checkout   { app: 'A-COM-005', interval: 'month'|'year' }
   → { url }  : l'adresse de la page de paiement Stripe.

   POURQUOI un endpoint plutôt que 24 liens de paiement
   ─────────────────────────────────────────────────────────────
   Un lien statique ne sait pas QUI clique. Or c'est précisément ce
   qu'il faut savoir : un client qui possède déjà Ghost Writer et
   achète desK ne doit PAS recevoir une deuxième clé — son sac
   d'applications doit s'agrandir (cf. P4).
   Ici, si l'acheteur est connecté, on transmet à Stripe :
     · `client_reference_id` = l'identifiant de sa licence,
     · son `customer` Stripe existant s'il en a un,
   et le webhook rattache l'achat à la bonne licence, sans deviner.

   Un visiteur SANS compte peut aussi acheter : on n'exige pas de
   connexion, le webhook créera alors la licence depuis son e-mail.

   Ce que cet endpoint ne fait PAS : encaisser. Il ouvre une page de
   paiement, rien de plus. Le débit et l'ouverture des droits passent
   par le webhook signé, seul juge de ce qui a été réellement payé.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT }                             from '../lib/jwt.js';
import { lookupKeyForApp, isValidEntitlementId }  from '../lib/stripe-catalog.js';

const SITE = 'https://protein-keystone.com';

async function _stripe(env, path, { method = 'GET', body } = {}) {
  const enc = (o, p = '') => Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const key = p ? `${p}[${k}]` : k;
      return (typeof v === 'object' && !Array.isArray(v))
        ? enc(v, key)
        : `${encodeURIComponent(key)}=${encodeURIComponent(v)}`;
    }).join('&');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.KS_STRIPE_SECRET}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: enc(body) } : {}),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out?.error?.message || `Stripe HTTP ${res.status}`);
  return out;
}

export async function handleStripeCheckout(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') return json({ ok: true }, 200, origin);
  if (!env.KS_STRIPE_SECRET) return err('Paiement indisponible (clé serveur manquante)', 500, origin);

  const body     = await parseBody(request);
  const appId    = String(body?.app || '').trim();
  const interval = String(body?.interval || 'month').trim().toLowerCase();

  if (!isValidEntitlementId(appId)) {
    return err('Application inconnue', 400, origin);
  }
  if (interval !== 'month' && interval !== 'year') {
    return err('Périodicité invalide (mensuel ou annuel)', 400, origin);
  }

  // 1) Le prix. On l'identifie par son `lookup_key` — jamais par son
  //    montant : cinq applications partagent 19 € (cf. stripe-catalog.js).
  const lookup = lookupKeyForApp(appId, { annual: interval === 'year' });
  let price;
  try {
    const r = await _stripe(env, `/prices?lookup_keys[]=${encodeURIComponent(lookup)}&active=true&limit=1`);
    price = r?.data?.[0];
  } catch (e) {
    console.error('[checkout] lecture du prix KO', lookup, e.message);
    return err('Paiement momentanément indisponible', 502, origin);
  }
  if (!price?.id) {
    console.error('[checkout] aucun prix actif pour', lookup, '— catalogue Stripe incomplet ?');
    return err("Ce tarif n'est pas encore ouvert à la vente", 409, origin);
  }

  // 2) L'acheteur est-il déjà client ? (facultatif : on vend aussi aux
  //    visiteurs — le webhook créera la licence depuis leur e-mail.)
  const claims = await requireJWT(request, env);
  let clientRef = null, customerId = null, customerEmail = null;
  if (claims?.sub) {
    clientRef = claims.sub;
    try {
      const row = await env.DB
        .prepare('SELECT stripe_customer_id, customer_email FROM licences WHERE lookup_hmac = ? LIMIT 1')
        .bind(claims.sub).first();
      customerId    = row?.stripe_customer_id || null;
      customerEmail = row?.customer_email || null;
    } catch (_) { /* non bloquant : on ouvre un paiement anonyme */ }
  }

  // 3) La page de paiement.
  const base = origin && /^https?:\/\//.test(origin) ? origin : SITE;
  const session = {
    mode: 'subscription',
    'line_items[0][price]':    price.id,
    'line_items[0][quantity]': 1,
    success_url: `${base}/app.html?achat=ok`,
    cancel_url:  `${base}/app.html?achat=annule`,
    allow_promotion_codes: 'true',
    // Rattachement : c'est CE champ qui évite la deuxième clé.
    ...(clientRef ? { client_reference_id: clientRef } : {}),
    // `customer` et `customer_email` s'excluent mutuellement côté Stripe.
    ...(customerId
      ? { customer: customerId }
      : (customerEmail ? { customer_email: customerEmail } : {})),
    // Trace lisible côté Stripe (utile en cas de réconciliation à la main).
    'metadata[ks_app]':   appId,
    'metadata[ks_cycle]': interval,
  };

  try {
    const out = await _stripe(env, '/checkout/sessions', { method: 'POST', body: session });
    return json({ url: out.url, app: appId, interval }, 200, origin);
  } catch (e) {
    console.error('[checkout] création de session KO', appId, interval, e.message);
    return err('Impossible d\'ouvrir le paiement', 502, origin);
  }
}
