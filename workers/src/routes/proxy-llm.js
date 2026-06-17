/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Proxy LLM (Sprint P2.3 · refactor BYOK Phase 0)
   Layer 2 · Bridge serveur vers les APIs LLM tierces.

   Pourquoi un proxy serveur ?
   ─────────────────────────────────────────────────────────────
   - **CORS** : Anthropic, OpenAI & co bloquent les appels browser
     directs (ou exigent des headers "dangerous-direct-browser-access").
     Un proxy serveur règle ça proprement.
   - **Uniformité** : un seul endpoint Keystone, payload normalisé en
     entrée et en sortie. Le frontend ne connaît pas les particularités
     de chaque vendor.
   - **BYOK** : la clé API utilisateur est passée à chaque call (jamais
     stockée côté Worker, jamais loggée). Le Worker la relaie au vendor
     puis l'oublie.

   Route exposée :
     POST /api/proxy/llm
     Body : { engine, apiKey, model, system, messages, max_tokens }
     Réponse normalisée : { text, usage, model, stop_reason, engine }

   ⚙️ Phase 0 (BYOK universel) : toute la logique de routage + les
   helpers vendor + les modèles par défaut + les caps vivent désormais
   dans lib/llm-router.js (`callLLM`). Cette route DÉLÈGUE — sa sortie
   HTTP est identique à l'historique (Brief Prod, Annonces immo, pads
   génériques ne bougent pas). callLLM, lui, est réutilisable côté
   serveur (features sans front présent) et sait retomber sur Mistral.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin, requireDevice } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { callLLM }    from '../lib/llm-router.js';

export async function handleProxyLLM(request, env) {
  const origin = getAllowedOrigin(env, request);

  // ── Sprint Sécu-1 / C1 ───────────────────────────────────────
  // Auth obligatoire : JWT licence (app web) OU device token (tablette).
  // BYOK ne suffit pas — on refuse les appels anonymes pour éviter que
  // le proxy Worker serve de relais anonyme aux LLM vendors.
  const claims = await requireJWT(request, env);
  const device = claims ? null : await requireDevice(request, env);
  if (!claims && !device) {
    return err('Authentification requise', 401, origin);
  }

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') {
    return err('Body JSON requis', 400, origin);
  }

  const { engine, apiKey, model, system, messages, max_tokens = 1024 } = body;

  // Validation entrée (contrat public de la route — préservé à l'identique).
  if (!engine || typeof engine !== 'string') {
    return err('Champ "engine" requis', 400, origin);
  }
  if (!apiKey || typeof apiKey !== 'string') {
    return err('Champ "apiKey" requis (BYOK — pass la clé du vault)', 400, origin);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return err('Champ "messages" requis (tableau non vide)', 400, origin);
  }

  // Délégation au routeur central. callLLM applique les caps (taille
  // messages → 413, max_tokens), route vers le vendor, et `throw`e une
  // LLMError (avec httpStatus) en cas d'échec — qu'on remappe en err().
  try {
    const out = await callLLM(env, { engine, apiKey, model, system, messages, max_tokens });
    return json({
      text       : out.text,
      model      : out.model,
      usage      : out.usage,
      stop_reason: out.stop_reason,
      engine     : out.engine,
    }, 200, origin);
  } catch (e) {
    return err(e?.message || 'Proxy LLM error', e?.httpStatus || 502, origin);
  }
}
