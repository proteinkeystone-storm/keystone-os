/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Smart Agent / Kortex (Sprint SA-0) v0.1

   Le pad O-AGT-001 fabrique des « jumeaux numériques de savoir-faire » :
   des agents qui répondent UNIQUEMENT depuis le coffre de savoir Kortex
   du tenant (fiches typées validées), avec citations et repli honnête
   (« Je ne dispose pas de cette information »).

   GET /api/smart-agent/health   Public — santé du moteur (aucune donnée)

   Roadmap des routes (sprints suivants) :
     SA-1  CRUD Kortex (units/collections) + extraction coller-texte
     SA-2  /kortex/search — récupération hybride (Vectorize + FTS5)
     SA-3  /agents CRUD + /chat — dialogue ancré, citations, crédits
     SA-4  /gaps — file des questions sans réponse (gap-driven)
     SA-5  endpoints publics (QR/lien, quotas, cache sémantique)

   Doctrine : moteur générique, ZÉRO logique métier ici. Tenant =
   identité authentifiée (patron socialTenantOf, routes/social.js),
   jamais un paramètre client. Schéma : db/migration_smart_agent.sql
   (appliqué au SA-1).
   ═══════════════════════════════════════════════════════════════ */

import { json, getAllowedOrigin } from '../lib/auth.js';

// Version du moteur — bumpée à chaque sprint livré (l'aside du pad
// l'affiche : preuve de câblage bout-en-bout front → worker).
const SA_ENGINE_VERSION = 'SA-0';

// ── GET /api/smart-agent/health ────────────────────────────────
// Public et sans donnée : confirme uniquement que le moteur répond.
export async function handleSmartAgentHealth(request, env) {
  const origin = getAllowedOrigin(env, request);
  return json({
    ok:      true,
    service: 'smart-agent',
    version: SA_ENGINE_VERSION,
  }, 200, origin);
}
