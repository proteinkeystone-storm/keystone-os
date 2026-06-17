/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Streaming LLM universel (BYOK)  ·  pendant de callLLM
   ─────────────────────────────────────────────────────────────
   `callLLM` (lib/llm-router.js) renvoie { text } d'un coup → inutilisable
   pour les surfaces qui STREAMENT en SSE token-par-token (débat live
   Brainstorming, concierge SDQR). Ce module est son PENDANT streaming :

     streamLLM(env, { engine, apiKey, model?, system?, messages,
                      max_tokens?, onChunk }) → Promise<fullText>

   · Fetch le vendor choisi en `stream:true`, parse le SSE SELON le vendor,
     appelle `onChunk(text)` pour chaque morceau (le caller fait son `send()`
     SSE custom), accumule et RENVOIE le texte complet.
   · Vendors couverts (mêmes endpoints/modèles que llm-router) :
       - Anthropic       : content_block_delta → delta.text
       - OpenAI-compat   : data: lines → choices[0].delta.content
                           (gpt / mistral / grok / perplexity / llama-Groq)
       - Gemini          : :streamGenerateContent?alt=sse
                           → candidates[0].content.parts[0].text
   · En cas d'échec vendor (HTTP non-OK, réseau, body absent) → `throw`
     une LLMError. Le CALLER décide du repli : retomber sur le streaming
     Mistral (env.AI.run) — ne JAMAIS casser le débat / le visiteur.

   PRINCIPE ADDITIF (cf. HANDOFF_BYOK_STREAMING.md) : ce module n'est appelé
   QUE derrière le flag BYOK_ROUTING (les callers gardent leur chemin Mistral
   inchangé). Généralisation de la graine `_streamAgentClaude`
   (brainstorming.js) à tous les vendors.

   ⚠ CONTRAT DE REPLI : si la requête a DÉJÀ émis des chunks (onChunk appelé)
   puis le stream se coupe, on RENVOIE le texte partiel SANS throw — sinon le
   caller re-streamerait depuis Mistral et DUPLIQUERAIT les chunks chez le
   client. On ne throw que sur un échec AVANT le 1er chunk (HTTP/réseau).
   ═══════════════════════════════════════════════════════════════ */

import { DEFAULT_MODELS, OPENAI_COMPAT_ENDPOINTS, LLMError, MAX_OUTPUT_TOKENS } from './llm-router.js';

// Engines vendor reconnus (mêmes que llm-router). Hors set → 400.
const VENDOR_ENGINES = new Set(Object.keys(DEFAULT_MODELS));

/* ═══════════════════════════════════════════════════════════════
   streamLLM — point d'entrée unique (streaming)
   ═══════════════════════════════════════════════════════════════ */
export async function streamLLM(env, opts = {}) {
  const { engine, apiKey, model, system, messages, max_tokens = 1024, onChunk } = opts;

  if (!engine || !VENDOR_ENGINES.has(engine)) {
    throw new LLMError(`Engine '${engine}' non supporté (stream)`, 400);
  }
  if (!apiKey || typeof apiKey !== 'string') {
    throw new LLMError('Clé API requise (stream)', 400);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new LLMError('Champ "messages" requis (tableau non vide)', 400);
  }

  const mdl = model || DEFAULT_MODELS[engine];
  const sys = typeof system === 'string' && system.trim() ? system : undefined;
  const cap = Math.min(Math.max(parseInt(max_tokens, 10) || 1024, 1), MAX_OUTPUT_TOKENS);
  const cb  = typeof onChunk === 'function' ? onChunk : () => {};

  if (engine === 'claude') {
    return _streamAnthropic({ apiKey, model: mdl, system: sys, messages, max_tokens: cap, onChunk: cb });
  }
  if (engine === 'gemini') {
    return _streamGemini({ apiKey, model: mdl, system: sys, messages, max_tokens: cap, onChunk: cb });
  }
  // gpt / mistral / grok / perplexity / llama → format OpenAI commun.
  return _streamOpenAICompat({
    engine, endpoint: OPENAI_COMPAT_ENDPOINTS[engine],
    apiKey, model: mdl, system: sys, messages, max_tokens: cap, onChunk: cb,
  });
}

/* ═══════════════════════════════════════════════════════════════
   Lecteur SSE générique : lit le body ligne par ligne, isole les
   lignes `data:`, JSON.parse, extrait le morceau via `extract(parsed)`,
   appelle onChunk + accumule. Respecte le CONTRAT DE REPLI :
     - res non-OK / body absent  → throw (rien d'émis).
     - coupure EN COURS de stream → renvoie le partiel déjà émis (pas de throw).
   ═══════════════════════════════════════════════════════════════ */
async function _consumeSSE(res, vendorLabel, extract, onChunk) {
  if (!res.ok || !res.body) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || j?.message || j?.detail || '';
    } catch { /* corps non-JSON */ }
    throw new LLMError(`${vendorLabel} [${res.status}] ${detail || res.statusText || 'stream error'}`, res.status, res.status);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let   buffer  = '';
  let   fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;       // on ignore `event:`, `:` keepalive…
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }  // ligne malformée
        const chunk = extract(parsed);
        if (chunk) { fullText += chunk; onChunk(chunk); }
      }
    }
  } catch (e) {
    // Coupure réseau en cours de stream : on garde ce qu'on a déjà émis
    // (le caller ne doit PAS re-streamer = duplication). Si rien encore
    // émis, on remonte l'échec pour autoriser le repli Mistral.
    if (fullText) return fullText;
    throw new LLMError(`${vendorLabel} stream interrompu : ${e?.message || 'inconnue'}`, 502);
  }
  return fullText;
}

/* ═══════════════════════════════════════════════════════════════
   Anthropic Messages API — stream:true
   Événements : { type:'content_block_delta', delta:{ type:'text_delta', text } }
   ═══════════════════════════════════════════════════════════════ */
async function _streamAnthropic({ apiKey, model, system, messages, max_tokens, onChunk }) {
  const payload = { model, messages, max_tokens, stream: true };
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
    throw new LLMError(`Proxy network error (Anthropic stream): ${e.message}`, 502);
  }
  return _consumeSSE(res, 'Anthropic', (p) => p?.delta?.text ?? '', onChunk);
}

/* ═══════════════════════════════════════════════════════════════
   OpenAI-Compatible Chat Completions — stream:true
   Sert gpt / mistral / grok / perplexity / llama(Groq).
   Chunks : { choices:[{ delta:{ content } }] }
   ═══════════════════════════════════════════════════════════════ */
async function _streamOpenAICompat({ engine, endpoint, apiKey, model, system, messages, max_tokens, onChunk }) {
  const oaiMessages = [];
  if (system) oaiMessages.push({ role: 'system', content: system });
  for (const m of messages) {
    oaiMessages.push({
      role   : m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    });
  }

  const payload = { model, messages: oaiMessages, max_tokens, stream: true };

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
    throw new LLMError(`Proxy network error (${engine} stream): ${e.message}`, 502);
  }
  return _consumeSSE(res, engine, (p) => p?.choices?.[0]?.delta?.content ?? '', onChunk);
}

/* ═══════════════════════════════════════════════════════════════
   Google Generative Language API (Gemini) — :streamGenerateContent?alt=sse
   Chunks SSE : { candidates:[{ content:{ parts:[{ text }] } }] }
   ═══════════════════════════════════════════════════════════════ */
async function _streamGemini({ apiKey, model, system, messages, max_tokens, onChunk }) {
  const contents = messages.map(m => ({
    role : m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  const payload = {
    contents,
    generationConfig: {
      maxOutputTokens: max_tokens,
      temperature    : 0.7,
      // 2.5+ : couper le "thinking" interne qui mange le budget de sortie.
      thinkingConfig : { thinkingBudget: 0 },
    },
  };
  if (system) payload.system_instruction = { parts: [{ text: system }] };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  let res;
  try {
    res = await fetch(url, {
      method : 'POST',
      headers: { 'content-type': 'application/json' },
      body   : JSON.stringify(payload),
    });
  } catch (e) {
    throw new LLMError(`Proxy network error (Gemini stream): ${e.message}`, 502);
  }
  return _consumeSSE(res, 'Gemini', (p) => p?.candidates?.[0]?.content?.parts?.[0]?.text ?? '', onChunk);
}
