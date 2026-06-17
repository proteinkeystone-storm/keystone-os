#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test BYOK streaming (Étape A : lib/llm-stream.js)

   Vérifie le PENDANT streaming de callLLM, fetch mocké :
     - parsing SSE par vendor (Anthropic / OpenAI-compat / Gemini)
       → fullText concaténé + onChunk appelé dans l'ordre ;
     - forme de la requête par vendor (URL/headers/body, stream:true) ;
     - chemin d'erreur (res non-OK → throw LLMError + status) ;
     - contrat de repli (coupure APRÈS 1er chunk → renvoie le partiel,
       PAS de throw → le caller ne re-streame pas = zéro duplication) ;
     - validations (engine inconnu, clé absente, messages vides) ;
     - gating front : byokRequestFields()/payload byok (structurel) ;
     - non-régression worker : legacy apiKey Devil + champ byok nesté.

   Usage : node scripts/test-byok-streaming.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { readFile }      from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { streamLLM }     from '../workers/src/lib/llm-stream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function ok(l)    { passed++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); }
function ko(l, e) { failed++; failures.push({ label: l, error: e }); console.log(`  \x1b[31m✗\x1b[0m ${l}\n    ${e}`); }
function eq(l, got, want) { (JSON.stringify(got) === JSON.stringify(want)) ? ok(l) : ko(l, `attendu ${JSON.stringify(want)}, reçu ${JSON.stringify(got)}`); }
function truthy(l, v) { v ? ok(l) : ko(l, `attendu truthy, reçu ${JSON.stringify(v)}`); }
async function src(rel) { return readFile(join(ROOT, rel), 'utf8'); }

// ── Mock fetch ─────────────────────────────────────────────────
const calls = [];
let __nextRes = null;
function enc(s) { return new TextEncoder().encode(s); }
function sseStream(str) {
  return new ReadableStream({ start(c) { c.enqueue(enc(str)); c.close(); } });
}
function sseStreamSplit(parts) {
  return new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc(p)); c.close(); } });
}
function sseStreamThenError(parts) {
  // Modèle `pull` : on LIVRE chaque part (le reader la lit + traite) PUIS on
  // coupe au pull suivant — fidèle à un vrai cut réseau (≠ start+error
  // synchrone qui, par spec Streams, VIDE la file et n'émet rien).
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < parts.length) c.enqueue(enc(parts[i++]));
      else c.error(new Error('network cut'));
    },
  });
}
function mockRes({ ok = true, status = 200, statusText = 'OK', stream = null, sse = '', json = null }) {
  return {
    ok, status, statusText,
    body: ok ? (stream || sseStream(sse)) : null,
    async json() { if (json !== null) return json; throw new Error('no json'); },
  };
}
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const r = __nextRes;
  __nextRes = null;
  if (!r) throw new Error('fetch appelé sans __nextRes armé');
  return r;
};
function arm(res) { __nextRes = res; }
function lastCall() { return calls[calls.length - 1]; }

// Collecteur onChunk
function collector() {
  const pieces = [];
  return { onChunk: (t) => pieces.push(t), pieces };
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 1 — Syntaxe (node --check)\x1b[0m');
for (const f of [
  'workers/src/lib/llm-stream.js',
  'workers/src/lib/llm-router.js',
  'workers/src/routes/brainstorming.js',
  'workers/src/routes/qr.js',
  'app/brainstorming.js',
  'app/lib/engines.js',
]) {
  try { execSync(`node --check ${JSON.stringify(join(ROOT, f))}`, { stdio: 'pipe' }); ok(`node --check ${f}`); }
  catch (e) { ko(`node --check ${f}`, (e.stderr?.toString() || e.message).split('\n')[0]); }
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 2 — Anthropic : parsing SSE + requête\x1b[0m');
{
  const sse =
    'event: message_start\ndata: {"type":"message_start"}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Bon"}}\n\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"jour"}}\n\n' +
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n' +
    'data: [DONE]\n\n';
  arm(mockRes({ sse }));
  const c = collector();
  const full = await streamLLM({}, {
    engine: 'claude', apiKey: 'sk-ant-xxxxxxxxxx',
    system: 'Tu es Devil.', messages: [{ role: 'user', content: 'Salut' }],
    max_tokens: 100, onChunk: c.onChunk,
  });
  eq('fullText concaténé', full, 'Bonjour');
  eq('onChunk pièces ordonnées', c.pieces, ['Bon', 'jour']);
  const call = lastCall();
  truthy('URL Anthropic', call.url === 'https://api.anthropic.com/v1/messages');
  eq('header x-api-key', call.init.headers['x-api-key'], 'sk-ant-xxxxxxxxxx');
  const body = JSON.parse(call.init.body);
  eq('body.stream=true', body.stream, true);
  eq('body.system passé', body.system, 'Tu es Devil.');
  eq('body.model défaut claude', body.model, 'claude-sonnet-4-5-20250929');
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 3 — OpenAI-compat (gpt) : parsing + requête\x1b[0m');
{
  const sse =
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    'data: [DONE]\n\n';
  arm(mockRes({ sse }));
  const c = collector();
  const full = await streamLLM({}, {
    engine: 'gpt', apiKey: 'sk-proj-yyyy',
    system: 'Sys', messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 50, onChunk: c.onChunk,
  });
  eq('fullText', full, 'Hello world');
  eq('pièces', c.pieces, ['Hello', ' world']);
  const call = lastCall();
  truthy('URL OpenAI', call.url === 'https://api.openai.com/v1/chat/completions');
  eq('Authorization Bearer', call.init.headers['Authorization'], 'Bearer sk-proj-yyyy');
  const body = JSON.parse(call.init.body);
  eq('body.stream=true', body.stream, true);
  eq('system prepend en 1er message', body.messages[0], { role: 'system', content: 'Sys' });
  eq('body.model défaut gpt', body.model, 'gpt-4o-mini');
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 4 — autres OpenAI-compat (mistral/grok) endpoints\x1b[0m');
{
  for (const [engine, host] of [['mistral', 'api.mistral.ai'], ['grok', 'api.x.ai'], ['llama', 'api.groq.com'], ['perplexity', 'api.perplexity.ai']]) {
    arm(mockRes({ sse: 'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' }));
    const c = collector();
    const full = await streamLLM({}, { engine, apiKey: 'k-1234567890', messages: [{ role: 'user', content: 'q' }], onChunk: c.onChunk });
    eq(`${engine} → fullText`, full, 'x');
    truthy(`${engine} endpoint = ${host}`, lastCall().url.includes(host));
  }
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 5 — Gemini : parsing + endpoint streamGenerateContent?alt=sse\x1b[0m');
{
  const sse =
    'data: {"candidates":[{"content":{"parts":[{"text":"Bon"}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"parts":[{"text":"soir"}]}}]}\n\n';
  arm(mockRes({ sse }));
  const c = collector();
  const full = await streamLLM({}, {
    engine: 'gemini', apiKey: 'AIza-zzz',
    system: 'Sys', messages: [{ role: 'user', content: 'Coucou' }, { role: 'assistant', content: 'Oui' }],
    onChunk: c.onChunk,
  });
  eq('fullText', full, 'Bonsoir');
  eq('pièces', c.pieces, ['Bon', 'soir']);
  const call = lastCall();
  truthy('URL contient :streamGenerateContent', call.url.includes(':streamGenerateContent'));
  truthy('URL contient alt=sse', call.url.includes('alt=sse'));
  truthy('URL contient key=', call.url.includes('key=AIza-zzz'));
  const body = JSON.parse(call.init.body);
  eq('system_instruction posée', body.system_instruction, { parts: [{ text: 'Sys' }] });
  eq('assistant → role model', body.contents[1].role, 'model');
  eq('thinkingBudget coupé', body.generationConfig.thinkingConfig.thinkingBudget, 0);
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 6 — robustesse buffer (lignes coupées entre 2 reads)\x1b[0m');
{
  arm(mockRes({ stream: sseStreamSplit([
    'data: {"choi', 'ces":[{"delta":{"content":"Bon"}}]}\n\nda',
    'ta: {"choices":[{"delta":{"content":"jour"}}]}\n\n',
  ]) }));
  const c = collector();
  const full = await streamLLM({}, { engine: 'gpt', apiKey: 'k-1234567890', messages: [{ role: 'user', content: 'q' }], onChunk: c.onChunk });
  eq('réassemblage lignes coupées', full, 'Bonjour');
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 7 — contrat de repli (coupure APRÈS 1er chunk)\x1b[0m');
{
  // Stream émet "Par" puis coupe réseau : streamLLM doit RENVOYER "Par"
  // (partiel) SANS throw → le caller ne re-streame pas (zéro duplication).
  arm(mockRes({ stream: sseStreamThenError(['data: {"choices":[{"delta":{"content":"Par"}}]}\n\n']) }));
  const c = collector();
  let threw = false, full = '';
  try { full = await streamLLM({}, { engine: 'gpt', apiKey: 'k-1234567890', messages: [{ role: 'user', content: 'q' }], onChunk: c.onChunk }); }
  catch { threw = true; }
  eq('pas de throw si déjà émis', threw, false);
  eq('renvoie le partiel', full, 'Par');
  eq('onChunk a reçu le partiel', c.pieces, ['Par']);
}
{
  // Coupure AVANT tout chunk → throw (autorise le repli Mistral propre).
  arm(mockRes({ stream: sseStreamThenError([]) }));
  let threw = false;
  try { await streamLLM({}, { engine: 'gpt', apiKey: 'k-1234567890', messages: [{ role: 'user', content: 'q' }], onChunk: () => {} }); }
  catch { threw = true; }
  eq('throw si coupure avant 1er chunk', threw, true);
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 8 — chemin erreur HTTP (res non-OK → throw + status)\x1b[0m');
{
  arm(mockRes({ ok: false, status: 401, json: { error: { message: 'invalid x-api-key' } } }));
  let err = null;
  try { await streamLLM({}, { engine: 'claude', apiKey: 'sk-bad', messages: [{ role: 'user', content: 'q' }], onChunk: () => {} }); }
  catch (e) { err = e; }
  truthy('throw sur 401', !!err);
  eq('httpStatus = 401', err?.httpStatus, 401);
  truthy('message porte le détail vendor', /invalid x-api-key/.test(err?.message || ''));
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 9 — validations (avant tout fetch)\x1b[0m');
{
  const before = calls.length;
  for (const [label, opts] of [
    ['engine inconnu', { engine: 'mystery', apiKey: 'k-1234567890', messages: [{ role: 'user', content: 'q' }] }],
    ['engine absent',  { apiKey: 'k-1234567890', messages: [{ role: 'user', content: 'q' }] }],
    ['clé absente',    { engine: 'gpt', messages: [{ role: 'user', content: 'q' }] }],
    ['messages vides', { engine: 'gpt', apiKey: 'k-1234567890', messages: [] }],
  ]) {
    let threw = false;
    try { await streamLLM({}, { ...opts, onChunk: () => {} }); } catch { threw = true; }
    eq(`throw : ${label}`, threw, true);
  }
  eq('aucun fetch déclenché par les validations', calls.length, before);
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 10 — câblage worker Brainstorming (structurel)\x1b[0m');
{
  const bs = await src('workers/src/routes/brainstorming.js');
  truthy('importe streamLLM', /import\s*\{[^}]*streamLLM[^}]*\}\s*from\s*'\.\.\/lib\/llm-stream\.js'/.test(bs));
  truthy('lit le champ byok (nesté)', /byokEngine\s*=|byok\.engine/.test(bs));
  truthy('byokActive gaté par byokRoutingEnabled', /byokActive\s*=\s*byokRoutingEnabled/.test(bs));
  truthy('legacy apiKey/claudeKey CONSERVÉ', /claudeKey/.test(bs));
  truthy('appelle streamLLM dans la boucle', /await\s+streamLLM\(/.test(bs));
  truthy('skip crédits si byokActive', /!byokActive/.test(bs));
  truthy('legacy Devil bypassé si byokActive', /!byokActive\s*&&\s*currentAgentId\s*===\s*PREMIUM_AGENT_ID/.test(bs));
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 11 — câblage worker Concierge SDQR (structurel)\x1b[0m');
{
  const qr = await src('workers/src/routes/qr.js');
  truthy('importe streamLLM', /import\s*\{[^}]*streamLLM[^}]*\}\s*from\s*'\.\.\/lib\/llm-stream\.js'/.test(qr));
  truthy('importe resolveEngineForTenant', /resolveEngineForTenant/.test(qr));
  truthy('résout le moteur du proprio (ownerKey)', /resolveEngineForTenant\(env,\s*ownerKey\)/.test(qr));
  truthy('appelle streamLLM (vendor)', /await\s+streamLLM\(/.test(qr));
  truthy('repli Mistral préservé (env.AI.run KS_AI_MODEL)', /env\.AI\.run\(KS_AI_MODEL/.test(qr));
  truthy('skip budget/crédits si byok', /if\s*\(\s*!byok\s*\)/.test(qr));
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 12 — câblage front Brainstorming (structurel)\x1b[0m');
{
  const fb = await src('app/brainstorming.js');
  truthy('payload débat porte byok: byokRequestFields()', /byok\s*:\s*byokRequestFields\(\)/.test(fb));
  truthy('legacy clé Claude (_getClaudeBYOKKey) conservée', /_getClaudeBYOKKey\(\)/.test(fb));
  truthy('apiKey legacy toujours envoyé', /payload\.apiKey\s*=\s*_claudeKey/.test(fb));
}

// ─────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'─'.repeat(54)}`);
if (failed === 0) {
  console.log(`\x1b[1m\x1b[32m✓ ${passed}/${total} tests OK\x1b[0m\n`);
  process.exit(0);
} else {
  console.log(`\x1b[1m\x1b[31m✗ ${failed}/${total} tests en échec\x1b[0m`);
  for (const f of failures) console.log(`  · ${f.label} — ${f.error}`);
  console.log('');
  process.exit(1);
}
