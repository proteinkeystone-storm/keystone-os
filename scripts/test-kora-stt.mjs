#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test endpoint STT Kora (K-14 mode vocal, V-1)

   Banc HEADLESS du cœur de transcription `_koraTranscribe` (worker),
   isolé de l'auth/CORS/budget avec un FAUX env.AI. Vérifie :
     - garde-fous d'entrée : moteur absent (503), Content-Type non
       audio (400), blob vide (400), blob trop lourd (413) ;
     - appel Whisper : entrée en TABLEAU D'OCTETS { audio:[...] }
       (indépendant du conteneur webm/opus ou mp4) ;
     - sortie : champ `text` OU `transcription`, TRIMÉ ; transcript
       vide toléré (200, text:'') ; panne moteur → 502.
     - Syntaxe (node --check) des modules du mode vocal.

   Ce qui N'EST PAS testable ici (device, machine de Stéphane) : la
   transcription Whisper réelle et la lecture Piper — cf. GATE.
   Usage : node scripts/test-kora-stt.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _koraTranscribe } from '../workers/src/routes/kora.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else      { failed++; console.error(`  \x1b[31m✗\x1b[0m ${name}`); }
}

// Faux moteur : renvoie ce qu'on lui dit, et MÉMORISE son argument d'appel
// (pour vérifier qu'on lui passe bien { audio: [octets] }).
function fakeEnv(result) {
  const calls = [];
  return {
    calls,
    env: { AI: { run: async (model, input) => { calls.push({ model, input }); if (result instanceof Error) throw result; return result; } } },
  };
}
const audioBuf = (n = 1000) => new ArrayBuffer(n);

console.log('\n\x1b[1m▶ Suite 1 — garde-fous d\'entrée\x1b[0m');
{
  const r = await _koraTranscribe({}, 'audio/webm', audioBuf());
  check('moteur IA absent → 503', r.status === 503);
}
{
  const { env } = fakeEnv({ text: 'x' });
  const r = await _koraTranscribe(env, 'application/json', audioBuf());
  check('Content-Type non audio → 400', r.status === 400 && !env.AI.run.__never);
}
{
  const { env } = fakeEnv({ text: 'x' });
  const r = await _koraTranscribe(env, '', audioBuf());
  check('Content-Type vide → 400', r.status === 400);
}
{
  const { env } = fakeEnv({ text: 'x' });
  const r = await _koraTranscribe(env, 'audio/webm', new ArrayBuffer(0));
  check('blob vide → 400', r.status === 400);
}
{
  const { env } = fakeEnv({ text: 'x' });
  // stub : byteLength au-delà du plafond (~5 Mo) sans allouer réellement
  const r = await _koraTranscribe(env, 'audio/mp4', { byteLength: 5 * 1024 * 1024 + 1 });
  check('blob trop lourd → 413', r.status === 413);
}

console.log('\n\x1b[1m▶ Suite 2 — appel Whisper (turbo : base64 + langue forcée)\x1b[0m');
{
  const { env, calls } = fakeEnv({ text: 'bonjour Kora' });
  const r = await _koraTranscribe(env, 'audio/webm;codecs=opus', audioBuf(4));
  check('webm/opus accepté → 200', r.status === 200 && r.text === 'bonjour Kora');
  check('audio en BASE64 (string, pas octets)', calls.length === 1 && typeof calls[0].input.audio === 'string');
  check('modèle = whisper-large-v3-turbo', calls[0].model === '@cf/openai/whisper-large-v3-turbo');
  check('language:"fr" FORCÉ (anti « transcrit en anglais »)', calls[0].input.language === 'fr');
  check('task:"transcribe" (jamais translate)', calls[0].input.task === 'transcribe');
}
{
  const { env, calls } = fakeEnv({ text: 'salut' });
  const r = await _koraTranscribe(env, 'audio/mp4', audioBuf(4));
  check('mp4 (Safari) accepté → 200', r.status === 200 && r.text === 'salut');
  check('mp4 : base64 + fr aussi', calls.length === 1 && typeof calls[0].input.audio === 'string' && calls[0].input.language === 'fr');
}

console.log('\n\x1b[1m▶ Suite 3 — façonnage de la sortie\x1b[0m');
{
  const { env } = fakeEnv({ text: '  du blanc autour  ' });
  const r = await _koraTranscribe(env, 'audio/webm', audioBuf());
  check('transcript TRIMÉ', r.status === 200 && r.text === 'du blanc autour');
}
{
  const { env } = fakeEnv({ text: '   ' });
  const r = await _koraTranscribe(env, 'audio/webm', audioBuf());
  check('transcript tout-blanc → 200 text vide (le front dira « rien entendu »)', r.status === 200 && r.text === '');
}
{
  const { env } = fakeEnv({ transcription: 'champ alternatif' });   // certains modèles renvoient `transcription`
  const r = await _koraTranscribe(env, 'audio/webm', audioBuf());
  check('champ `transcription` accepté', r.status === 200 && r.text === 'champ alternatif');
}
{
  const { env } = fakeEnv(new Error('Whisper HS'));
  const r = await _koraTranscribe(env, 'audio/webm', audioBuf());
  check('panne moteur → 502', r.status === 502 && !!r.error);
}

console.log('\n\x1b[1m▶ Suite 4 — Syntaxe des modules du mode vocal (node --check)\x1b[0m');
for (const f of ['app/kora-voice.js', 'app/kora-loop.js', 'app/kora.js', 'workers/src/routes/kora.js', 'workers/src/index.js']) {
  let ok = true;
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); }
  catch (_) { ok = false; }
  check(`${f} — syntaxe OK`, ok);
}

console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
