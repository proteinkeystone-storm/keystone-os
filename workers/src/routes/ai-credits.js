/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Crédits IA · endpoints HTTP (Chantier B · Sprint 1)
   ─────────────────────────────────────────────────────────────
   La logique vit dans lib/ai-credits.js (pure, testable, réutilisée
   par les routes IA en Sprint 2-3 et le webhook Stripe en Sprint 5).
   Ici : juste la couche HTTP.

   Route exposée (Sprint 1) :
     GET /api/ai-credits/quota
       Auth : JWT licence requise.
       Réponse 200 : { plan, month, unit:'crédits', includedQuota,
         used, packBalance, remaining, unlimited, breakdown, enforced }
       Lecture seule — aucun débit. Le frontend (Sprint 4) l'appelle
       pour afficher la jauge de crédits + la double jauge par outil.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT }                  from '../lib/jwt.js';
import {
  ensureAiCreditsSchema,
  readMonthUsed,
  readMonthBreakdown,
  readPackBalance,
  isEnforceEnabled,
  creditsPayload,
} from '../lib/ai-credits.js';

export async function handleAiCreditsQuota(request, env) {
  const origin = getAllowedOrigin(env, request);

  const claims = await requireJWT(request, env);
  if (!claims) {
    return err('Authentification requise (JWT licence)', 401, origin);
  }
  const bucketKey = claims.sub;   // lookup_hmac de la licence connectée
  if (!bucketKey) {
    return err('JWT incomplet (sub manquant) — re-login requis', 401, origin);
  }

  await ensureAiCreditsSchema(env);
  const used      = await readMonthUsed(env, bucketKey);
  const balance   = await readPackBalance(env, bucketKey);
  const breakdown = await readMonthBreakdown(env, bucketKey);
  const enforced  = await isEnforceEnabled(env, bucketKey);

  const payload = creditsPayload(claims.plan, used, balance, breakdown);
  // `enforced` : le flag dormant est-il actif sur cette licence ? Le
  // frontend s'en sert pour n'afficher la jauge/alarme que là où
  // l'enforcement est réellement branché (sinon : illimité, on masque).
  return json({ ...payload, enforced }, 200, origin);
}
