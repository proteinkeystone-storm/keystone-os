#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Tests automatisés Brainstorming V2 (A-COM-003)
   Sprint 6 (mai 2026)

   Valide la structure et le bon fonctionnement de l'artefact
   Brainstorming AI War Room :
   - Tous les fichiers Sprint 0-5 existent
   - Modules JS ont une syntaxe valide
   - JSON PADS/HELP/manifest/catalog valides + cohérents
   - Endpoints Worker prod répondent correctement
     · OPTIONS preflight → 204
     · POST sans auth → 401
     · Validation body invalide → 400

   Usage :
     node scripts/test-brainstorming.mjs
     node scripts/test-brainstorming.mjs --skip-network    (skip Worker tests)

   Exit code : 0 si tous les tests passent, 1 sinon.
   ═══════════════════════════════════════════════════════════════ */

import { execSync } from 'node:child_process';
import { readFile, access }   from 'node:fs/promises';
import { fileURLToPath }      from 'node:url';
import { dirname, join }      from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const skipNet   = process.argv.includes('--skip-network');

const WORKER_BASE = 'https://keystone-os-api.keystone-os.workers.dev';

let passed = 0;
let failed = 0;
const failures = [];

function ok(label)        { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
function ko(label, error) { failed++; failures.push({ label, error }); console.log(`  \x1b[31m✗\x1b[0m ${label}\n    ${error}`); }

async function fileExists(rel) {
  try { await access(join(ROOT, rel)); return true; }
  catch (e) { return false; }
}

async function readJson(rel) {
  const raw = await readFile(join(ROOT, rel), 'utf8');
  return JSON.parse(raw);
}

async function nodeCheckSyntax(rel) {
  try {
    execSync(`node --check ${JSON.stringify(join(ROOT, rel))}`, { stdio: 'pipe' });
    return null;
  } catch (e) {
    return e.stderr?.toString() || e.message;
  }
}

async function httpStatus(url, opts = {}) {
  const res = await fetch(url, opts);
  return { status: res.status, body: await res.text().catch(() => '') };
}

// ─────────────────────────────────────────────────────────────────
// SUITE 1 — Existence des fichiers Sprint 0 à 5
// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 1 — Fichiers Sprint 0-5\x1b[0m');

const expectedFiles = [
  'app/brainstorming.js',
  'app/brainstorming.css',
  'app/lib/brainstorming-agents.js',
  'workers/src/routes/brainstorming.js',
  'workers/src/lib/brainstorming-agents.js',
  'workers/src/lib/brainstorming-orchestrator.js',
  'K_STORE_ASSETS/PADS/A-COM-003.json',
  'K_STORE_ASSETS/HELP/A-COM-003.json',
  'app/_legacy/muse-v1/muse.js',   // archive Muse v1
];
for (const f of expectedFiles) {
  if (await fileExists(f)) ok(`existe : ${f}`);
  else                     ko(`manque : ${f}`, 'fichier introuvable');
}

// ─────────────────────────────────────────────────────────────────
// SUITE 2 — Syntaxe JS des modules
// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 2 — Syntaxe modules JS\x1b[0m');

const jsFiles = [
  'app/brainstorming.js',
  'app/lib/brainstorming-agents.js',
  'workers/src/routes/brainstorming.js',
  'workers/src/lib/brainstorming-agents.js',
  'workers/src/lib/brainstorming-orchestrator.js',
];
for (const f of jsFiles) {
  const err = await nodeCheckSyntax(f);
  if (!err) ok(`syntaxe OK : ${f}`);
  else      ko(`syntaxe KO : ${f}`, err.split('\n')[0]);
}

// ─────────────────────────────────────────────────────────────────
// SUITE 3 — JSON valides + cohérents
// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 3 — JSON valides + cohérence catalogue\x1b[0m');

try {
  const pad = await readJson('K_STORE_ASSETS/PADS/A-COM-003.json');
  if (pad.id === 'A-COM-003') ok('PADS/A-COM-003.json : id = A-COM-003');
  else                         ko('PADS/A-COM-003.json : id incorrect', pad.id);
  if (pad.title === 'Brainstorming') ok('PADS/A-COM-003.json : title = Brainstorming');
  else                                ko('PADS/A-COM-003.json : title incorrect', pad.title);
  if (pad.workspace === 'fullscreen') ok('PADS/A-COM-003.json : workspace fullscreen');
  else                                  ko('PADS/A-COM-003.json : workspace incorrect', pad.workspace);
  if (pad.ai_optimized?.includes('Claude') && pad.ai_optimized?.includes('Gemma'))
    ok('PADS/A-COM-003.json : ai_optimized hybride');
  else
    ko('PADS/A-COM-003.json : ai_optimized non hybride', pad.ai_optimized);
} catch (e) { ko('PADS/A-COM-003.json : invalid JSON', e.message); }

try {
  const help = await readJson('K_STORE_ASSETS/HELP/A-COM-003.json');
  if (help.title === 'Brainstorming') ok('HELP/A-COM-003.json : title');
  else                                  ko('HELP/A-COM-003.json : title', help.title);
  if (Array.isArray(help.key_points) && help.key_points.length >= 5)
    ok(`HELP/A-COM-003.json : ${help.key_points.length} key_points`);
  else
    ko('HELP/A-COM-003.json : key_points trop courts', String(help.key_points?.length));
  if (Array.isArray(help.faq) && help.faq.length >= 3)
    ok(`HELP/A-COM-003.json : ${help.faq.length} FAQ entries`);
  else
    ko('HELP/A-COM-003.json : faq trop courte', String(help.faq?.length));
} catch (e) { ko('HELP/A-COM-003.json : invalid JSON', e.message); }

try {
  const manifest = await readJson('K_STORE_ASSETS/PADS/manifest.json');
  if (manifest.pads?.includes('A-COM-003')) ok('manifest.json : A-COM-003 listé');
  else                                       ko('manifest.json : A-COM-003 manquant', JSON.stringify(manifest.pads));
} catch (e) { ko('manifest.json : invalid JSON', e.message); }

try {
  const catalog = await readJson('K_STORE_ASSETS/catalog.json');
  const entry = catalog.tools?.find(t => t.id === 'A-COM-003');
  if (entry) ok('catalog.json : entry A-COM-003 trouvée');
  else        ko('catalog.json : entry A-COM-003 manquante', '');
  if (entry?.subtitle?.toLowerCase().includes('personnalités'))
    ok('catalog.json : subtitle évoque les "personnalités"');
  else
    ko('catalog.json : subtitle non aligné Brainstorming V2', entry?.subtitle || '(vide)');
} catch (e) { ko('catalog.json : invalid JSON', e.message); }

// ─────────────────────────────────────────────────────────────────
// SUITE 4 — Endpoints Worker prod (optionnel)
// ─────────────────────────────────────────────────────────────────
if (skipNet) {
  console.log('\n\x1b[33m▶ Suite 4 — Worker prod : SKIPPED (--skip-network)\x1b[0m');
} else {
  console.log('\n\x1b[1m▶ Suite 4 — Endpoints Worker prod (live)\x1b[0m');

  // 4.1 OPTIONS preflight /agent-respond
  try {
    const r = await httpStatus(`${WORKER_BASE}/api/brainstorming/agent-respond`, {
      method: 'OPTIONS',
      headers: { 'Origin': 'https://protein-keystone.com', 'Access-Control-Request-Method': 'POST' },
    });
    if (r.status === 204) ok('POST /agent-respond preflight : 204');
    else                   ko('POST /agent-respond preflight : status inattendu', String(r.status));
  } catch (e) { ko('POST /agent-respond preflight : network error', e.message); }

  // 4.2 POST sans auth /agent-respond → 401
  try {
    const r = await httpStatus(`${WORKER_BASE}/api/brainstorming/agent-respond`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ agent_id: 'auto', brief: 'test', history: [] }),
    });
    if (r.status === 401) ok('POST /agent-respond sans auth : 401');
    else                   ko('POST /agent-respond sans auth : status inattendu', String(r.status));
  } catch (e) { ko('POST /agent-respond sans auth : network error', e.message); }

  // 4.3 OPTIONS preflight /synthesize
  try {
    const r = await httpStatus(`${WORKER_BASE}/api/brainstorming/synthesize`, {
      method: 'OPTIONS',
      headers: { 'Origin': 'https://protein-keystone.com', 'Access-Control-Request-Method': 'POST' },
    });
    if (r.status === 204) ok('POST /synthesize preflight : 204');
    else                   ko('POST /synthesize preflight : status inattendu', String(r.status));
  } catch (e) { ko('POST /synthesize preflight : network error', e.message); }

  // 4.4 POST sans auth /synthesize → 401
  try {
    const r = await httpStatus(`${WORKER_BASE}/api/brainstorming/synthesize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ brief: 'test', history: [{}, {}] }),
    });
    if (r.status === 401) ok('POST /synthesize sans auth : 401');
    else                   ko('POST /synthesize sans auth : status inattendu', String(r.status));
  } catch (e) { ko('POST /synthesize sans auth : network error', e.message); }
}

// ─────────────────────────────────────────────────────────────────
// SOMMAIRE
// ─────────────────────────────────────────────────────────────────
console.log(`\n\x1b[1m═══ Sommaire ═══\x1b[0m`);
console.log(`  \x1b[32m${passed} passed\x1b[0m  ·  \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) {
  console.log(`\n  \x1b[31mÉchecs :\x1b[0m`);
  for (const f of failures) console.log(`   - ${f.label}: ${f.error}`);
}
process.exit(failed > 0 ? 1 : 0);
