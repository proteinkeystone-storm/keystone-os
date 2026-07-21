/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routeur LLM universel (BYOK)  ·  Phase 0 (socle)
   ─────────────────────────────────────────────────────────────
   Fonction unique `callLLM(env, opts)` qui décide, par appel :

     · clé + moteur valides  →  on route vers LE vendor choisi
                                 (Claude / Gemini / GPT / Mistral AI /
                                 Grok / Perplexity / Llama-Groq),
                                 avec la clé de l'utilisateur,
                                 → { ..., viaBYOK: true }  (HORS compteur).
     · sinon                 →  env.AI.run(KS_AI_MODEL) = Mistral sur
                                 mon Cloudflare,  → { ..., viaBYOK: false }
                                 (chemin par défaut INCHANGÉ, métré comme
                                 aujourd'hui par l'appelant).

   PRINCIPE ADDITIF (cf. HANDOFF_BYOK_MOTEUR_UNIVERSEL.md §1) :
   un appelant qui ne passe PAS de clé retombe byte-for-byte sur le
   comportement Mistral actuel. On n'enlève rien, on ajoute une branche.

   Sortie NORMALISÉE (un seul endroit qui uniformise les formats vendor) :
     { text, usage, model, stop_reason, engine, viaBYOK }

   Les helpers vendor (_proxyAnthropic / _proxyGemini /
   _proxyOpenAICompatible) sont EXTRAITS de routes/proxy-llm.js — même
   logique fetch/parse, mais ils RETOURNENT des données (et `throw`ent
   une LLMError en cas d'échec) au lieu de fabriquer une Response HTTP.
   C'est routes/proxy-llm.js qui ré-emballe en Response (sortie identique).

   ⚠ Tool-calling (sortie structurée Smart Agent) n'est PAS encore câblé
   ici : on l'ajoutera dans la phase qui en a besoin, pour ne pas
   embarquer de plomberie vendor non testée dans le socle.
   ═══════════════════════════════════════════════════════════════ */

import { KS_AI_MODEL } from './ai-model.js';
import { decrypt }     from './crypto.js';
import { recordUsage } from './ai-budget.js';

// Modèles par défaut (extensible — ne JAMAIS hardcoder côté frontend).
// L'appelant peut override via `opts.model`.
// NB : perplexity + llama restent supportés ICI (inertes) ; ils sont
// seulement masqués côté front en Phase 1 (cf. handoff D5).
export const DEFAULT_MODELS = {
  claude    : 'claude-sonnet-4-5-20250929',
  gemini    : 'gemini-2.5-flash',
  gpt       : 'gpt-4o-mini',
  mistral   : 'mistral-small-latest',
  grok      : 'grok-2-latest',
  perplexity: 'sonar',
  llama     : 'llama-3.3-70b-versatile',
};

// Mapping engine → base URL (APIs OpenAI-compatibles).
export const OPENAI_COMPAT_ENDPOINTS = {
  gpt       : 'https://api.openai.com/v1/chat/completions',
  mistral   : 'https://api.mistral.ai/v1/chat/completions',
  grok      : 'https://api.x.ai/v1/chat/completions',
  perplexity: 'https://api.perplexity.ai/chat/completions',
  llama     : 'https://api.groq.com/openai/v1/chat/completions',
};

// Engines vendor reconnus (clé requise). Hors de ce set + clé présente
// ⇒ 400 (préserve le message de proxy-llm). Sans clé ⇒ Mistral, peu
// importe l'engine.
const VENDOR_ENGINES = new Set(Object.keys(DEFAULT_MODELS));

// Caps de sécurité (déplacés depuis proxy-llm.js, désormais source unique).
export const MAX_MESSAGES_BYTES = 64 * 1024;   // 64 KB de messages JSON.stringified
export const MAX_OUTPUT_TOKENS  = 8192;         // borne haute sortie

// Erreur transportant le status HTTP à renvoyer (proxy-llm le mappe en err()).
export class LLMError extends Error {
  constructor(message, status = 502, vendorStatus = null) {
    super(message);
    this.name = 'LLMError';
    this.httpStatus = status;
    this.vendorStatus = vendorStatus;
  }
}

// ── Feature flag BYOK_ROUTING ──────────────────────────────────
// Drapeau de rollback (var d'env worker). INERTE en Phase 0 : callLLM
// route toujours selon la présence d'une clé (proxy-llm doit continuer
// de marcher). Les surfaces BYOK *nouvelles* (Phase 2/3) consulteront
// ce helper AVANT de transmettre une clé → l'éteindre = retour Mistral
// instantané sur ces surfaces, sans toucher proxy-llm.
export function byokRoutingEnabled(env) {
  const v = String(env?.BYOK_ROUTING ?? '').trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

// ── Coffre serveur per-tenant (D6 / Phase 3b) ──────────────────
// Résout le moteur + la clé du PROPRIÉTAIRE depuis le coffre serveur
// chiffré (tables tenant_ai_prefs + tenant_api_keys, alimentées par
// routes/keys.js). Pour les surfaces SANS front (chat public) : le
// visiteur anonyme n'a pas la clé → c'est celle du proprio, déchiffrée
// à l'instant de l'appel, JAMAIS loguée ni renvoyée au client.
// Renvoie { engine, apiKey } ou null (→ Mistral). Gardé par le flag :
// BYOK_ROUTING OFF ⇒ toujours null ⇒ chat public INCHANGÉ.
export async function resolveEngineForTenant(env, tenantId) {
  if (!byokRoutingEnabled(env) || !tenantId) return null;
  if (!env?.DB || !env?.KS_ENCRYPTION_KEY) return null;
  try {
    const pref = await env.DB
      .prepare('SELECT active_engine FROM tenant_ai_prefs WHERE tenant_id = ?')
      .bind(tenantId).first();
    const engine = pref?.active_engine;
    if (!engine) return null;
    const row = await env.DB
      .prepare('SELECT ciphertext, iv FROM tenant_api_keys WHERE tenant_id = ? AND engine = ?')
      .bind(tenantId, engine).first();
    if (!row?.ciphertext || !row?.iv) return null;
    const apiKey = await decrypt(row.ciphertext, row.iv, env.KS_ENCRYPTION_KEY);
    return apiKey ? { engine, apiKey } : null;
  } catch (_) {
    return null;   // table absente / déchiffrement KO / etc. → Mistral (jamais casser le public)
  }
}

/* ═══════════════════════════════════════════════════════════════
   callLLM — point d'entrée unique
   ═══════════════════════════════════════════════════════════════ */
export async function callLLM(env, opts = {}) {
  const {
    engine,
    apiKey,
    model,
    system,
    messages,
    max_tokens = 1024,
    // D4 : repli silencieux Mistral si le vendor échoue (surfaces
    // toujours-actives / publiques). Owner-triggered → laisser à false
    // pour remonter une erreur claire « clé X invalide ».
    fallbackOnError = false,
  } = opts;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new LLMError('Champ "messages" requis (tableau non vide)', 400);
  }

  const messagesJson = JSON.stringify(messages);
  if (messagesJson.length > MAX_MESSAGES_BYTES) {
    throw new LLMError(
      `Messages trop volumineux (max ${MAX_MESSAGES_BYTES} octets, recu ${messagesJson.length})`,
      413,
    );
  }

  const cappedMaxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || 1024, 1), MAX_OUTPUT_TOKENS);
  const sys = typeof system === 'string' && system.trim() ? system : undefined;

  // ── Branche BYOK : clé + moteur connu → vendor ───────────────
  if (apiKey && typeof apiKey === 'string' && engine) {
    if (!VENDOR_ENGINES.has(engine)) {
      throw new LLMError(`Engine '${engine}' pas encore supporté`, 400);
    }
    try {
      const out = await _routeVendor({
        engine,
        endpoint  : OPENAI_COMPAT_ENDPOINTS[engine],
        apiKey,
        model     : model || DEFAULT_MODELS[engine],
        system    : sys,
        messages,
        max_tokens: cappedMaxTokens,
      });
      return { ...out, viaBYOK: true };
    } catch (e) {
      if (fallbackOnError) {
        // Repli Mistral (métré) — ne jamais casser l'expérience publique.
        return await _runMistral(env, { system: sys, messages, max_tokens: cappedMaxTokens });
      }
      throw e;
    }
  }

  // ── Défaut : Mistral sur Workers AI — CHEMIN INCHANGÉ ────────
  return await _runMistral(env, { system: sys, messages, max_tokens: cappedMaxTokens });
}

// Dispatch vendor (clé déjà validée présente).
function _routeVendor({ engine, endpoint, apiKey, model, system, messages, max_tokens }) {
  if (engine === 'claude') return _proxyAnthropic({ apiKey, model, system, messages, max_tokens });
  if (engine === 'gemini') return _proxyGemini({ apiKey, model, system, messages, max_tokens });
  // gpt / mistral / grok / perplexity / llama → format OpenAI commun.
  return _proxyOpenAICompatible({ engine, endpoint, apiKey, model, system, messages, max_tokens });
}

/* ═══════════════════════════════════════════════════════════════
   Chemin par défaut : Mistral sur Workers AI (env.AI.run)
   Extraction texte multi-format alignée sur routes/ai-generate.js.
   ═══════════════════════════════════════════════════════════════ */
async function _runMistral(env, { system, messages, max_tokens }) {
  if (!env?.AI || typeof env.AI.run !== 'function') {
    throw new LLMError('Workers AI indisponible (binding env.AI manquant)', 502);
  }

  const aiMessages = [];
  if (system) aiMessages.push({ role: 'system', content: system });
  for (const m of messages) {
    aiMessages.push({
      role   : m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    });
  }

  let out;
  try {
    out = await env.AI.run(KS_AI_MODEL, { messages: aiMessages, max_tokens });
  } catch (e) {
    throw new LLMError(`Workers AI erreur : ${e?.message || 'inconnue'}`, 502);
  }

  const text = out?.response
    || out?.result?.response
    || out?.choices?.[0]?.message?.content
    || out?.output?.[0]?.content?.[0]?.text
    || out?.message?.content
    || out?.text
    || out?.completion
    || '';

  const usage = out?.usage
    ? { input_tokens: out.usage.prompt_tokens ?? null, output_tokens: out.usage.completion_tokens ?? null }
    : null;

  // Compteur budget IA — angle mort corrigé le 22/07/2026. Ce chemin est
  // le repli Workers AI du routeur (donc facturé par Cloudflare) et il
  // n'était compté nulle part. Les chemins VENDOR juste au-dessus, eux,
  // restent volontairement hors compteur : ils sont facturés par le
  // fournisseur du client (BYOK), pas en neurones.
  await recordUsage(env, 'llm-router', {
    usage  : out?.usage,
    inText : aiMessages.map(m => m.content || '').join('\n'),
    outText: text,
  });

  return {
    text,
    model      : KS_AI_MODEL,
    usage,
    stop_reason: out?.choices?.[0]?.finish_reason || null,
    engine     : 'workers-ai',
    viaBYOK    : false,
  };
}

/* ═══════════════════════════════════════════════════════════════
   Helpers vendor — EXTRAITS de routes/proxy-llm.js (logique identique,
   mais retournent des données / throw LLMError au lieu de Response).
   ═══════════════════════════════════════════════════════════════ */

// ── Anthropic Messages API ─────────────────────────────────────
// Doc : https://docs.anthropic.com/en/api/messages
async function _proxyAnthropic({ apiKey, model, system, messages, max_tokens }) {
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
    throw new LLMError(`Proxy network error: ${e.message}`, 502);
  }

  let data;
  try { data = await res.json(); }
  catch { data = null; }

  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText || 'Anthropic error';
    throw new LLMError(`Anthropic [${res.status}] ${msg}`, res.status, res.status);
  }

  // On extrait le texte de la première content-part de type 'text'.
  const textPart = (data?.content || []).find(p => p.type === 'text');
  return {
    text       : textPart?.text || '',
    model      : data?.model || model,
    usage      : data?.usage || null,
    stop_reason: data?.stop_reason || null,
    engine     : 'claude',
  };
}

// ── Google Generative Language API (Gemini) ────────────────────
// Doc : https://ai.google.dev/api/generate-content
async function _proxyGemini({ apiKey, model, system, messages, max_tokens }) {
  const contents = messages.map(m => ({
    role : m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  const payload = {
    contents,
    generationConfig: {
      maxOutputTokens: max_tokens,
      temperature    : 0.7,
      // Gemini 2.5+ : par défaut consomme des tokens en "thinking" interne,
      // ce qui tronque le budget de sortie. On désactive pour les tâches
      // courtes — réponse directe, plus de tokens utiles.
      thinkingConfig : { thinkingBudget: 0 },
    },
  };
  if (system) {
    payload.system_instruction = { parts: [{ text: system }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let res;
  try {
    res = await fetch(url, {
      method : 'POST',
      headers: { 'content-type': 'application/json' },
      body   : JSON.stringify(payload),
    });
  } catch (e) {
    throw new LLMError(`Proxy network error (Gemini): ${e.message}`, 502);
  }

  let data;
  try { data = await res.json(); }
  catch { data = null; }

  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || 'Gemini error';
    throw new LLMError(`Gemini [${res.status}] ${msg}`, res.status, res.status);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const meta = data?.usageMetadata || {};
  return {
    text,
    model      : model,
    usage      : {
      input_tokens : meta.promptTokenCount     || null,
      output_tokens: meta.candidatesTokenCount || null,
    },
    stop_reason: data?.candidates?.[0]?.finishReason || null,
    engine     : 'gemini',
  };
}

// ── OpenAI-Compatible Chat Completions ─────────────────────────
// Sert gpt / mistral / grok / perplexity / llama(Groq).
// Format request : { model, messages [system|user|assistant], max_tokens }
// Format response : { choices[].message.content, usage, model }
async function _proxyOpenAICompatible({ engine, endpoint, apiKey, model, system, messages, max_tokens }) {
  const oaiMessages = [];
  if (system) oaiMessages.push({ role: 'system', content: system });
  for (const m of messages) {
    oaiMessages.push({
      role   : m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    });
  }

  const payload = { model, messages: oaiMessages, max_tokens };

  let res;
  try {
    res = await fetch(endpoint, {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type' : 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new LLMError(`Proxy network error (${engine}): ${e.message}`, 502);
  }

  let data;
  try { data = await res.json(); }
  catch { data = null; }

  if (!res.ok) {
    const msg = data?.error?.message || data?.detail || res.statusText || `${engine} error`;
    throw new LLMError(`${engine} [${res.status}] ${msg}`, res.status, res.status);
  }

  const text  = data?.choices?.[0]?.message?.content || '';
  const usage = data?.usage || {};
  return {
    text,
    model      : data?.model || model,
    usage      : {
      input_tokens : usage.prompt_tokens     || null,
      output_tokens: usage.completion_tokens || null,
    },
    stop_reason: data?.choices?.[0]?.finish_reason || null,
    engine,
  };
}
