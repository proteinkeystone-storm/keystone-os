#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Tests unitaires du routeur LLM (BYOK Phase 0)
   lib/llm-router.js · callLLM + helpers vendor + flag

   Valide, en isolé (fetch + env.AI.run mockés, ZÉRO réseau) :
     - routage par moteur (claude / gemini / gpt / grok / mistral / …)
     - normalisation de format (anthropic/gemini/openai/workers-ai)
     - chemin par défaut Mistral quand pas de clé (viaBYOK=false)
     - viaBYOK=true sur vendor (→ permet de skipper le métrage)
     - caps (taille messages → 413, max_tokens)
     - erreurs vendor (status remonté) + repli Mistral (fallbackOnError)
     - parsing du flag BYOK_ROUTING
     - proxy-llm.js délègue bien à callLLM (refactor)

   Usage   : node scripts/test-llm-router.mjs
   Exit    : 0 si tout passe, 1 sinon.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { readFile }      from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  callLLM, byokRoutingEnabled, LLMError,
  DEFAULT_MODELS, OPENAI_COMPAT_ENDPOINTS,
  MAX_MESSAGES_BYTES, MAX_OUTPUT_TOKENS,
} from '../workers/src/lib/llm-router.js';
import { KS_AI_MODEL } from '../workers/src/lib/ai-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function ok(l)      { passed++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); }
function ko(l, e)   { failed++; failures.push({ label: l, error: e }); console.log(`  \x1b[31m✗\x1b[0m ${l}\n    ${e}`); }
function eq(l, got, want) {
  if (got === want) ok(`${l} (= ${JSON.stringify(got)})`);
  else              ko(l, `attendu ${JSON.stringify(want)}, reçu ${JSON.stringify(got)}`);
}
function truthy(l, v) { if (v) ok(l); else ko(l, `falsy : ${JSON.stringify(v)}`); }

// ── Plomberie de mock ──────────────────────────────────────────
const ORIG_FETCH = globalThis.fetch;
let lastReq = null;
function stubFetch(makeResponse) {
  globalThis.fetch = async (url, init) => {
    lastReq = { url, init, headers: init?.headers || {}, body: init?.body ? JSON.parse(init.body) : null };
    return makeResponse(url, init);
  };
}
function resp(data, { ok: okay = true, status = 200, statusText = 'OK' } = {}) {
  return { ok: okay, status, statusText, json: async () => data };
}
function restoreFetch() { globalThis.fetch = ORIG_FETCH; lastReq = null; }

let lastAI = null;
function envWithAI(out) {
  return { AI: { run: async (model, body) => { lastAI = { model, body }; return out; } } };
}

const MSG = [{ role: 'user', content: 'Bonjour' }];

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 1 — Syntaxe (node --check)\x1b[0m');
for (const f of ['workers/src/lib/llm-router.js', 'workers/src/routes/proxy-llm.js']) {
  try { execSync(`node --check ${JSON.stringify(join(ROOT, f))}`, { stdio: 'pipe' }); ok(`node --check ${f}`); }
  catch (e) { ko(`node --check ${f}`, (e.stderr?.toString() || e.message).split('\n')[0]); }
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 2 — Routage vendor + normalisation\x1b[0m');

// 2.1 — Claude (Anthropic) : URL, header, modèle défaut, system top-level
stubFetch(() => resp({
  content    : [{ type: 'text', text: 'Salut !' }],
  model      : 'claude-real',
  usage      : { input_tokens: 5, output_tokens: 3 },
  stop_reason: 'end_turn',
}));
{
  const r = await callLLM(envWithAI(), { engine: 'claude', apiKey: 'sk-ant', system: 'Sois bref', messages: MSG, max_tokens: 100 });
  eq('claude → URL Anthropic',      lastReq.url, 'https://api.anthropic.com/v1/messages');
  eq('claude → header x-api-key',   lastReq.headers['x-api-key'], 'sk-ant');
  eq('claude → modèle par défaut',  lastReq.body.model, DEFAULT_MODELS.claude);
  eq('claude → system top-level',   lastReq.body.system, 'Sois bref');
  eq('claude → texte normalisé',    r.text, 'Salut !');
  eq('claude → engine',             r.engine, 'claude');
  eq('claude → model renvoyé',      r.model, 'claude-real');
  truthy('claude → viaBYOK = true', r.viaBYOK === true);
}
restoreFetch();

// 2.2 — Gemini : clé en query param, normalisation candidates + usageMetadata
stubFetch(() => resp({
  candidates   : [{ content: { parts: [{ text: 'Bonjour Gemini' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 },
}));
{
  const r = await callLLM(envWithAI(), { engine: 'gemini', apiKey: 'AIza', messages: MSG });
  truthy('gemini → URL contient modèle + ?key=', lastReq.url.includes(DEFAULT_MODELS.gemini) && lastReq.url.includes('key=AIza'));
  eq('gemini → texte normalisé',  r.text, 'Bonjour Gemini');
  eq('gemini → usage input',      r.usage.input_tokens, 7);
  eq('gemini → usage output',     r.usage.output_tokens, 4);
  eq('gemini → engine',           r.engine, 'gemini');
  truthy('gemini → viaBYOK',      r.viaBYOK === true);
}
restoreFetch();

// 2.3 — GPT (OpenAI-compat) : endpoint, Bearer, system en role:system
stubFetch(() => resp({
  choices: [{ message: { content: 'GPT dit bonjour' }, finish_reason: 'stop' }],
  usage  : { prompt_tokens: 9, completion_tokens: 6 },
  model  : 'gpt-4o-mini',
}));
{
  const r = await callLLM(envWithAI(), { engine: 'gpt', apiKey: 'sk-oai', system: 'Sys', messages: MSG });
  eq('gpt → endpoint OpenAI',        lastReq.url, OPENAI_COMPAT_ENDPOINTS.gpt);
  eq('gpt → header Authorization',   lastReq.headers['Authorization'], 'Bearer sk-oai');
  truthy('gpt → system en role:system', lastReq.body.messages[0].role === 'system' && lastReq.body.messages[0].content === 'Sys');
  eq('gpt → texte normalisé',        r.text, 'GPT dit bonjour');
  eq('gpt → usage output',           r.usage.output_tokens, 6);
  truthy('gpt → viaBYOK',            r.viaBYOK === true);
}
restoreFetch();

// 2.4 — mistral / grok / perplexity / llama → bon endpoint OpenAI-compat
for (const eng of ['mistral', 'grok', 'perplexity', 'llama']) {
  stubFetch(() => resp({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: {} }));
  await callLLM(envWithAI(), { engine: eng, apiKey: 'k', messages: MSG });
  eq(`${eng} → endpoint mappé`, lastReq.url, OPENAI_COMPAT_ENDPOINTS[eng]);
  restoreFetch();
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 3 — Chemin par défaut Mistral (sans clé)\x1b[0m');

// 3.1 — Pas de clé → env.AI.run(KS_AI_MODEL), fetch JAMAIS appelé
{
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error('fetch ne doit PAS être appelé sans clé'); };
  const r = await callLLM(envWithAI({ response: 'Réponse Mistral' }), { messages: MSG, system: 'S', max_tokens: 50 });
  eq('Mistral → modèle KS_AI_MODEL',       lastAI.model, KS_AI_MODEL);
  truthy('Mistral → system injecté',       lastAI.body.messages[0].role === 'system');
  truthy('Mistral → fetch NON appelé',     fetchCalled === false);
  eq('Mistral → texte (out.response)',     r.text, 'Réponse Mistral');
  eq('Mistral → engine workers-ai',        r.engine, 'workers-ai');
  eq('Mistral → model = KS_AI_MODEL',      r.model, KS_AI_MODEL);
  truthy('Mistral → viaBYOK = false',      r.viaBYOK === false);
  restoreFetch();
}

// 3.2 — Normalisation usage Mistral (prompt/completion → input/output)
{
  const r = await callLLM(envWithAI({ response: 'r', usage: { prompt_tokens: 11, completion_tokens: 22 } }), { messages: MSG });
  eq('Mistral → usage.input_tokens',  r.usage.input_tokens, 11);
  eq('Mistral → usage.output_tokens', r.usage.output_tokens, 22);
}

// 3.3 — Binding AI absent → LLMError 502
{
  try { await callLLM({}, { messages: MSG }); ko('AI absent → throw', 'pas de throw'); }
  catch (e) { eq('AI absent → status 502', e.httpStatus, 502); }
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 4 — Erreurs & repli (D4)\x1b[0m');

// 4.1 — Clé + moteur inconnu → 400 « pas encore supporté »
{
  try { await callLLM(envWithAI(), { engine: 'bard', apiKey: 'k', messages: MSG }); ko('moteur inconnu → throw', 'pas de throw'); }
  catch (e) {
    truthy('moteur inconnu → LLMError', e instanceof LLMError);
    eq('moteur inconnu → status 400', e.httpStatus, 400);
    truthy('moteur inconnu → message', /pas encore supporté/.test(e.message));
  }
}

// 4.2 — Vendor renvoie 401 → LLMError httpStatus=401, message « Anthropic [401] »
stubFetch(() => resp({ error: { message: 'invalid x-api-key' } }, { ok: false, status: 401, statusText: 'Unauthorized' }));
{
  try { await callLLM(envWithAI(), { engine: 'claude', apiKey: 'bad', messages: MSG }); ko('vendor 401 → throw', 'pas de throw'); }
  catch (e) {
    eq('vendor 401 → httpStatus', e.httpStatus, 401);
    truthy('vendor 401 → message « Anthropic [401] »', /Anthropic \[401\]/.test(e.message));
  }
}
restoreFetch();

// 4.3 — fallbackOnError:true + vendor 500 → repli Mistral (viaBYOK=false, métré)
stubFetch(() => resp({ error: { message: 'boom' } }, { ok: false, status: 500, statusText: 'err' }));
{
  const r = await callLLM(envWithAI({ response: 'repli mistral' }), { engine: 'claude', apiKey: 'bad', messages: MSG, fallbackOnError: true });
  eq('fallback → texte Mistral',   r.text, 'repli mistral');
  eq('fallback → engine workers-ai', r.engine, 'workers-ai');
  truthy('fallback → viaBYOK=false (métré)', r.viaBYOK === false);
}
restoreFetch();

// 4.4 — Erreur réseau (fetch throw) → LLMError 502
{
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try { await callLLM(envWithAI(), { engine: 'claude', apiKey: 'k', messages: MSG }); ko('réseau KO → throw', 'pas de throw'); }
  catch (e) {
    eq('réseau KO → status 502', e.httpStatus, 502);
    truthy('réseau KO → message « Proxy network error »', /Proxy network error/.test(e.message));
  }
  restoreFetch();
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 5 — Caps (taille + tokens)\x1b[0m');

// 5.1 — Messages trop volumineux → 413 (avant tout routage)
{
  const big = [{ role: 'user', content: 'x'.repeat(MAX_MESSAGES_BYTES + 100) }];
  try { await callLLM(envWithAI(), { messages: big }); ko('oversize → throw', 'pas de throw'); }
  catch (e) {
    eq('oversize → status 413', e.httpStatus, 413);
    truthy('oversize → message « trop volumineux »', /trop volumineux/.test(e.message));
  }
}

// 5.2 — max_tokens capé à MAX_OUTPUT_TOKENS
stubFetch(() => resp({ content: [{ type: 'text', text: 'ok' }] }));
{
  await callLLM(envWithAI(), { engine: 'claude', apiKey: 'k', messages: MSG, max_tokens: 999999 });
  eq('max_tokens capé', lastReq.body.max_tokens, MAX_OUTPUT_TOKENS);
}
restoreFetch();

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 6 — Flag BYOK_ROUTING\x1b[0m');
eq("flag 'on' → true",    byokRoutingEnabled({ BYOK_ROUTING: 'on' }),   true);
eq("flag '1' → true",     byokRoutingEnabled({ BYOK_ROUTING: '1' }),    true);
eq("flag 'true' → true",  byokRoutingEnabled({ BYOK_ROUTING: 'TRUE' }), true);
eq("flag 'off' → false",  byokRoutingEnabled({ BYOK_ROUTING: 'off' }),  false);
eq('flag absent → false', byokRoutingEnabled({}),                       false);
eq('flag env null → false', byokRoutingEnabled(null),                   false);

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 7 — proxy-llm.js délègue à callLLM\x1b[0m');
try {
  const src = await readFile(join(ROOT, 'workers/src/routes/proxy-llm.js'), 'utf8');
  truthy('proxy-llm importe callLLM',                /import\s*\{\s*callLLM\s*\}/.test(src));
  truthy('proxy-llm ne redéfinit plus les helpers vendor', !/function _proxyAnthropic/.test(src) && !/function _proxyGemini/.test(src));
  truthy('proxy-llm appelle callLLM(env, …)',        /callLLM\(env/.test(src));
  truthy('proxy-llm garde l\'auth (401)',            /Authentification requise/.test(src));
  truthy('proxy-llm garde la validation apiKey',     /Champ "apiKey" requis/.test(src));
} catch (e) { ko('lecture proxy-llm.js', e.message); }

// ─────────────────────────────────────────────────────────────────
console.log(`\n\x1b[1m═══ Sommaire ═══\x1b[0m`);
console.log(`  \x1b[32m${passed} passed\x1b[0m  ·  \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) {
  console.log(`\n  \x1b[31mÉchecs :\x1b[0m`);
  for (const f of failures) console.log(`   - ${f.label}: ${f.error}`);
}
process.exit(failed > 0 ? 1 : 0);
