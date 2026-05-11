/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Proxy LLM (Sprint P2.1)
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
     Réponse normalisée : { text, usage, model, stop_reason }

   Sprint P2.1 — Claude (Anthropic) uniquement. Sprint P2.2 ajoutera
   GPT-5, Gemini, Mistral, Grok, Perplexity, Llama.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';

// Modèles par défaut (extensible — ne JAMAIS hardcoder côté frontend).
// L'utilisateur peut override via `body.model`.
const DEFAULT_MODELS = {
  claude: 'claude-sonnet-4-5-20250929',
};

// Cap raisonnable pour éviter qu'un client n'envoie un payload géant
// au vendor en cas de bug. Anthropic accepte ~200k tokens, on cape bas
// au niveau du proxy pour la V1.
const MAX_MESSAGES_BYTES = 64 * 1024;   // 64 KB de messages JSON.stringified
const MAX_OUTPUT_TOKENS  = 8192;        // borne haute sortie

export async function handleProxyLLM(request, env) {
  const origin = getAllowedOrigin(env, request);

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') {
    return err('Body JSON requis', 400, origin);
  }

  const {
    engine,
    apiKey,
    model,
    system,
    messages,
    max_tokens = 1024,
  } = body;

  // Validation entrée
  if (!engine || typeof engine !== 'string') {
    return err('Champ "engine" requis', 400, origin);
  }
  if (!apiKey || typeof apiKey !== 'string') {
    return err('Champ "apiKey" requis (BYOK — pass la clé du vault)', 400, origin);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return err('Champ "messages" requis (tableau non vide)', 400, origin);
  }

  const messagesJson = JSON.stringify(messages);
  if (messagesJson.length > MAX_MESSAGES_BYTES) {
    return err(`Messages trop volumineux (max ${MAX_MESSAGES_BYTES} octets, recu ${messagesJson.length})`, 413, origin);
  }

  const cappedMaxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || 1024, 1), MAX_OUTPUT_TOKENS);

  // Routing par engine
  switch (engine) {
    case 'claude':
      return _proxyAnthropic({
        apiKey,
        model  : model || DEFAULT_MODELS.claude,
        system : typeof system === 'string' ? system : undefined,
        messages,
        max_tokens: cappedMaxTokens,
      }, origin);

    // Sprint P2.2 ajoutera gpt, gemini, mistral, grok, perplexity, llama
    default:
      return err(`Engine '${engine}' pas encore supporté (Sprint P2.2)`, 400, origin);
  }
}

// ── Anthropic Messages API ─────────────────────────────────────
// Doc : https://docs.anthropic.com/en/api/messages
// On utilise le format messages V1 (post Q3 2023). `system` est un champ
// top-level, pas un message role=system.
async function _proxyAnthropic({ apiKey, model, system, messages, max_tokens }, origin) {
  const payload = { model, messages, max_tokens };
  if (system) payload.system = system;

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key'        : apiKey,
        'anthropic-version': '2023-06-01',
        'content-type'     : 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return err(`Proxy network error: ${e.message}`, 502, origin);
  }

  let data;
  try { data = await res.json(); }
  catch { data = null; }

  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText || 'Anthropic error';
    return err(`Anthropic [${res.status}] ${msg}`, res.status, origin);
  }

  // Format normalisé : on extrait le texte de la première content-part de
  // type 'text'. (Anthropic peut renvoyer plusieurs parts en cas de
  // tool_use ; pour la V1 on prend juste le texte.)
  const textPart = (data?.content || []).find(p => p.type === 'text');
  return json({
    text       : textPart?.text || '',
    model      : data?.model || model,
    usage      : data?.usage || null,
    stop_reason: data?.stop_reason || null,
    engine     : 'claude',
  }, 200, origin);
}
