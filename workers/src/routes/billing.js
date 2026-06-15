/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Portail de facturation Stripe v1.0
   POST /api/billing/portal
   ─────────────────────────────────────────────────────────────
   Ouvre une session du Customer Portal Stripe pour l'abonné
   authentifié (JWT). Le client y change de plan (upgrade/downgrade),
   met à jour son moyen de paiement, ou résilie — en self-service.

   Pourquoi c'est LA bonne voie pour le prorata :
   Le changement de plan via le portail modifie l'abonnement EXISTANT
   (il ne crée pas un 2ᵉ abo). Stripe calcule donc automatiquement le
   prorata (crédit du temps non consommé sur l'ancien plan + coût
   prorraté du nouveau) → pas de double facturation. L'event
   customer.subscription.updated met ensuite à jour le plan de la
   licence (déjà géré dans stripe-webhook.js).

   Pré-requis Dashboard Stripe (à faire une fois, hors code) :
   Settings → Billing → Customer portal → activer, autoriser le
   changement de plan entre Starter/Pro/Max, prorata activé.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

// Page de retour après le portail (le dashboard de l'app).
const PORTAL_RETURN_URL = 'https://protein-keystone.com/app';

export async function handleBillingPortal(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!env.KS_STRIPE_SECRET) return err('Server: KS_STRIPE_SECRET manquant', 500, origin);

  // Auth : JWT obligatoire (sub = lookup_hmac de la licence du payeur).
  const claims = await requireJWT(request, env);
  if (!claims?.sub) return err('JWT invalide ou expiré', 401, origin);

  // Retrouve le client Stripe rattaché à cette licence.
  const row = await env.DB
    .prepare('SELECT stripe_customer_id FROM licences WHERE lookup_hmac = ? LIMIT 1')
    .bind(claims.sub)
    .first();
  const customerId = row?.stripe_customer_id;
  if (!customerId) {
    // Licence sans client Stripe (B2B/admin/manuelle, ou activée hors Stripe).
    return err('Aucun abonnement Stripe rattaché à ce compte.', 404, origin);
  }

  // Crée la session du Customer Portal (API Stripe = form-encoded).
  let res;
  try {
    res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.KS_STRIPE_SECRET}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer:   customerId,
        return_url: PORTAL_RETURN_URL,
      }).toString(),
    });
  } catch (e) {
    return err('Stripe injoignable', 502, origin);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    console.error('[billing] portal session KO:', msg);
    // Cas le plus fréquent : portail pas encore configuré dans le Dashboard.
    return err('Portail de facturation indisponible (configuration Stripe requise).', 502, origin);
  }

  return json({ url: data.url }, 200, origin);
}
