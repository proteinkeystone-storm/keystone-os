#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test SA-10.0 (chat en streaming SSE)

   Couvre les fonctions PURES du streaming Smart Agent, sans LLM live :
     - cleanForChannel : [GAP] masqué partout, [n] masqué en public,
       conservé en interne ;
     - makeStreamEmitter : aperçu nettoyé, anti-doublon, ET anti-fuite
       d'un marqueur FRAGMENTÉ sur plusieurs deltas (« [GA » → « P] »),
       reconstitution exacte après flush() ;
     - streamMistralReply : parsing du ReadableStream SSE de env.AI.run
       ({response:"…"}), onChunk dans l'ordre, fullText concaténé, lignes
       coupées entre deux reads, sentinelle [DONE] ignorée ;
     - syntaxe (node --check) du fichier modifié.

   Usage : node scripts/test-smart-agent-stream.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cleanForChannel, makeStreamEmitter, streamMistralReply }
  from '../workers/src/routes/smart-agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else      { failed++; console.error(`  \x1b[31m✗\x1b[0m ${name}`); }
}

// ── Helpers d'émetteur ─────────────────────────────────────────
// Joue une liste de deltas dans makeStreamEmitter, renvoie les pièces
// envoyées + l'état final (après flush).
function play(channel, deltas) {
  const pieces = [];
  const emit = makeStreamEmitter(channel, (t) => pieces.push(t));
  for (const d of deltas) emit.push(d);
  emit.flush();
  return { pieces, sent: emit.sent, raw: emit.raw, join: pieces.join('') };
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — cleanForChannel\x1b[0m');
check('[GAP] retiré (interne)', cleanForChannel('[GAP] Bonjour', 'internal') === ' Bonjour');
check('[GAP] retiré (public)',  cleanForChannel('[GAP] Bonjour', 'public')   === ' Bonjour');
check('[GAP] insensible casse/espaces', cleanForChannel('[ gap ] x', 'internal') === ' x');
check('citation [n] CONSERVÉE en interne', cleanForChannel('Voir [1] ici', 'internal') === 'Voir [1] ici');
check('citation [n] RETIRÉE en public',     cleanForChannel('Voir [1] ici', 'public')   === 'Voir  ici');
check('plusieurs [n] retirés (public)', cleanForChannel('a [1] b [12] c', 'public') === 'a  b  c');
check('crochet non-marqueur préservé', cleanForChannel('coût [environ] 10', 'public') === 'coût [environ] 10');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — makeStreamEmitter (anti-fuite + anti-doublon)\x1b[0m');

// 2a — [GAP] FRAGMENTÉ sur deux deltas ne doit JAMAIS fuiter « [GA ».
{
  const r = play('internal', ['Voici ', '[GA', 'P]', ' la rép', 'onse [1]', ' ok']);
  check('2a aucun fragment de [GAP] émis', !r.join.includes('[GA'));
  check('2a [GAP] absent du rendu final', !r.sent.includes('[GAP]'));
  check('2a citation [1] conservée (interne)', r.sent.includes('[1]'));
  check('2a zéro doublon (join === sent)', r.join === r.sent);
  check('2a rendu final = nettoyage canonique', r.sent === cleanForChannel(r.raw, 'internal'));
}

// 2b — citation [1] entière (public) : jamais affichée, même transitoirement.
{
  const r = play('public', ['Tarif ', '[1]', ' = 10 euros']);
  check('2b aucun [1] émis (public)', !r.join.includes('[1]'));
  check('2b rendu final sans citation', !r.sent.includes('[1]'));
  check('2b texte utile intact', r.sent === 'Tarif  = 10 euros');
  check('2b zéro doublon', r.join === r.sent);
}

// 2c — citation [12] FRAGMENTÉE caractère par caractère (public).
{
  const r = play('public', ['Voir ', '[', '1', '2', ']', ' fin']);
  check('2c aucun fragment « [1 » / « [12 » émis', !r.join.includes('[1'));
  check('2c rendu = "Voir  fin"', r.sent === 'Voir  fin');
}

// 2d — même fragmentation, canal INTERNE : la citation est reconstituée.
{
  const r = play('internal', ['Voir ', '[', '1', ']', ' fin']);
  check('2d citation reconstituée [1]', r.sent === 'Voir [1] fin');
  check('2d zéro doublon', r.join === r.sent);
}

// 2e — texte ordinaire sans marqueur : streaming fidèle, pas de perte.
{
  const r = play('public', ['Bonjour, ', 'comment ', 'puis-je aider', ' ?']);
  check('2e fidèle au texte', r.sent === 'Bonjour, comment puis-je aider ?');
  check('2e join === sent', r.join === r.sent);
}

// 2f — crochet ouvrant resté littéral en fin de flux : flush() l'émet.
{
  const r = play('internal', ['Liste ', '[à venir']);
  check('2f flush émet le crochet littéral final', r.sent === 'Liste [à venir');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — streamMistralReply (parse SSE Workers AI)\x1b[0m');

const enc = new TextEncoder();
function aiStream(chunks, { split = false, withDone = false } = {}) {
  let text = chunks.map(c => `data: ${JSON.stringify({ response: c })}\n\n`).join('');
  if (withDone) text += 'data: [DONE]\n\n';
  return new ReadableStream({
    start(c) {
      if (split) {
        const mid = Math.floor(text.length / 2);
        c.enqueue(enc.encode(text.slice(0, mid)));
        c.enqueue(enc.encode(text.slice(mid)));
      } else {
        c.enqueue(enc.encode(text));
      }
      c.close();
    },
  });
}
function fakeEnv(stream, sink) {
  return { AI: { run: async (model, opts) => { if (sink) sink(model, opts); return stream; } } };
}

// 3a — cas nominal : 3 chunks → fullText concaténé + onChunk ordonné.
{
  let seenOpts = null;
  const pieces = [];
  const full = await streamMistralReply(
    fakeEnv(aiStream(['Bon', 'jour', ' !']), (_m, o) => { seenOpts = o; }),
    { system: 'persona', messages: [{ role: 'user', content: 'hi' }], max_tokens: 50, onChunk: (t) => pieces.push(t) },
  );
  check('3a fullText concaténé', full === 'Bonjour !');
  check('3a onChunk ordonné', pieces.join('') === 'Bonjour !' && pieces.length === 3);
  check('3a stream:true demandé', seenOpts && seenOpts.stream === true);
  check('3a system replié en 1er message', seenOpts && seenOpts.messages[0].role === 'system');
}

// 3b — lignes coupées entre deux reads : le buffer recolle.
{
  const pieces = [];
  const full = await streamMistralReply(
    fakeEnv(aiStream(['Salut', ' tout', ' le', ' monde'], { split: true })),
    { messages: [{ role: 'user', content: 'x' }], max_tokens: 50, onChunk: (t) => pieces.push(t) },
  );
  check('3b texte complet malgré coupure', full === 'Salut tout le monde');
  check('3b chunks réassemblés', pieces.join('') === 'Salut tout le monde');
}

// 3c — sentinelle [DONE] ignorée (pas de crash, pas de chunk parasite).
{
  const pieces = [];
  const full = await streamMistralReply(
    fakeEnv(aiStream(['OK'], { withDone: true })),
    { messages: [{ role: 'user', content: 'x' }], max_tokens: 10, onChunk: (t) => pieces.push(t) },
  );
  check('3c [DONE] ignorée', full === 'OK' && pieces.length === 1);
}

// 3d — env.AI absent → throw clair (jamais un crash silencieux).
{
  let threw = false;
  try {
    await streamMistralReply({}, { messages: [{ role: 'user', content: 'x' }], max_tokens: 10 });
  } catch (_) { threw = true; }
  check('3d env.AI manquant → throw', threw);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — Syntaxe (node --check)\x1b[0m');
for (const f of ['workers/src/routes/smart-agent.js', 'workers/src/lib/llm-stream.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
