#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test structurel BYOK Phase 2 (features sûres)

   Garde-fou : vérifie que le câblage BYOK flag-gated est bien présent
   dans les 4 handlers worker généralisés + les 3 callers front, que le
   greeting reste EXCLU (Mistral), et que tout compile (node --check).
   N'exécute aucun appel IA (statique). Le vrai test = flip du flag en prod.

   Usage : node scripts/test-byok-phase2.mjs   ·   Exit 0 si OK, 1 sinon.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { readFile }      from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function ok(l)    { passed++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); }
function ko(l, e) { failed++; failures.push({ label: l, error: e }); console.log(`  \x1b[31m✗\x1b[0m ${l}\n    ${e}`); }
async function src(rel) { return readFile(join(ROOT, rel), 'utf8'); }
function has(s, re, label) { (re.test(s) ? ok : (e) => ko(label, e))(label, `motif absent : ${re}`); }

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 1 — Syntaxe (node --check)\x1b[0m');
const ALL_FILES = [
  'workers/src/routes/ai-generate.js', 'workers/src/routes/ghostwriter.js',
  'workers/src/routes/brainstorming.js', 'workers/src/routes/living-layer-board.js',
  'workers/src/routes/living-layer.js', 'workers/src/lib/llm-router.js',
  'app/lib/engines.js', 'app/ui-renderer.js', 'app/ghostwriter.js', 'app/brainstorming.js',
];
for (const f of ALL_FILES) {
  try { execSync(`node --check ${JSON.stringify(join(ROOT, f))}`, { stdio: 'pipe' }); ok(`node --check ${f}`); }
  catch (e) { ko(`node --check ${f}`, (e.stderr?.toString() || e.message).split('\n')[0]); }
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 2 — Worker : 4 handlers branchés sur callLLM (flag-gated)\x1b[0m');
for (const f of ['ai-generate', 'ghostwriter', 'brainstorming', 'living-layer-board']) {
  const s = await src(`workers/src/routes/${f}.js`);
  has(s, /import\s*\{[^}]*\bcallLLM\b[^}]*\bbyokRoutingEnabled\b[^}]*\}\s*from\s*['"]\.\.\/lib\/llm-router\.js['"]/, `${f}: importe callLLM + byokRoutingEnabled`);
  has(s, /byokRoutingEnabled\(env\)/, `${f}: consulte le flag byokRoutingEnabled(env)`);
  has(s, /callLLM\(env/, `${f}: appelle callLLM(env, …)`);
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 3 — Skip métrage en BYOK\x1b[0m');
{
  const ag = await src('workers/src/routes/ai-generate.js');
  has(ag, /if\s*\(!useByok\)/, 'ai-generate : budget/quota gardé sous !useByok');
  has(ag, /!committed && !useByok/, 'ai-generate : revert quota seulement hors BYOK');
  const gw = await src('workers/src/routes/ghostwriter.js');
  has(gw, /if\s*\(!useByok\)\s*\{[\s\S]*consumeCredits/, 'ghostwriter : crédits/quota gardés sous !useByok');
  has(gw, /!committed && !useByok/, 'ghostwriter : refund/revert seulement hors BYOK');
  const bs = await src('workers/src/routes/brainstorming.js');
  has(bs, /if\s*\(!useByok\s*&&\s*await isEnforceEnabled/, 'brainstorming : débit crédit gardé sous !useByok');
  has(bs, /_generateSynthesisVendor/, 'brainstorming : helper _generateSynthesisVendor (callLLM)');
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 4 — living-layer GREETING reste exclu (Mistral)\x1b[0m');
{
  const greet = await src('workers/src/routes/living-layer.js');
  if (!/llm-router/.test(greet) && !/callLLM/.test(greet))
    ok('living-layer (greeting) n’importe PAS callLLM (reste sur env.AI.run / Mistral)');
  else
    ko('living-layer (greeting) ne devrait pas toucher au BYOK', 'callLLM/llm-router détecté');
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 5 — Front : callers envoient {engine, apiKey}\x1b[0m');
{
  const eng = await src('app/lib/engines.js');
  has(eng, /export function byokRequestFields\s*\(/, 'engines.js exporte byokRequestFields()');

  const uir = await src('app/ui-renderer.js');
  has(uir, /byokRequestFields/, 'ui-renderer (living-board) : utilise byokRequestFields');
  const gw = await src('app/ghostwriter.js');
  has(gw, /\.\.\.byokRequestFields\(\)/, 'ghostwriter front : spread byokRequestFields() dans le body');
  const bs = await src('app/brainstorming.js');
  has(bs, /\.\.\.byokRequestFields\(\)/, 'brainstorming front : spread byokRequestFields() (synthesize)');
  if (!/bodyPayload\.engine\s*=\s*'claude'/.test(bs))
    ok("brainstorming front : plus de engine='claude' en dur");
  else
    ko("brainstorming front : engine='claude' en dur encore présent", '');
}

// ─────────────────────────────────────────────────────────────────
console.log(`\n\x1b[1m═══ Sommaire ═══\x1b[0m`);
console.log(`  \x1b[32m${passed} passed\x1b[0m  ·  \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  \x1b[31mÉchecs :\x1b[0m'); for (const f of failures) console.log(`   - ${f.label}: ${f.error}`); }
process.exit(failed > 0 ? 1 : 0);
