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
// SUITE 5 — Sprint 7 cognitive modes (activation + arcs différenciés)
// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 5 — Sprint 7 cognitive modes\x1b[0m');

const EXPECTED_MODES = ['exploration', 'launch', 'branding', 'growth', 'crisis', 'positioning', 'repositioning'];

try {
  const frontendMod = await import(`file://${join(ROOT, 'app/lib/brainstorming-agents.js')}`);
  const { COGNITIVE_MODES, getCognitiveMode, getEnabledCognitiveModes } = frontendMod;

  // 5.1 — Les 7 modes existent
  if (COGNITIVE_MODES?.length === 7) ok('COGNITIVE_MODES : 7 modes définis');
  else                                ko('COGNITIVE_MODES : nombre incorrect', String(COGNITIVE_MODES?.length));

  // 5.2 — Tous les modes attendus sont présents
  for (const mid of EXPECTED_MODES) {
    const m = COGNITIVE_MODES?.find(x => x.id === mid);
    if (m) ok(`COGNITIVE_MODES : ${mid} présent`);
    else    ko(`COGNITIVE_MODES : ${mid} absent`, '');
  }

  // 5.3 — Les 7 modes sont activés (enabled: true)
  const enabled = COGNITIVE_MODES?.filter(m => m.enabled);
  if (enabled?.length === 7) ok('COGNITIVE_MODES : 7 modes enabled:true');
  else                        ko('COGNITIVE_MODES : tous les modes ne sont pas enabled', `${enabled?.length}/7`);

  // 5.4 — Helper getEnabledCognitiveModes exporté et fonctionne
  if (typeof getEnabledCognitiveModes === 'function' && getEnabledCognitiveModes().length === 7)
    ok('getEnabledCognitiveModes() retourne 7 modes');
  else
    ko('getEnabledCognitiveModes() KO', String(getEnabledCognitiveModes?.()?.length));

  // 5.5 — Chaque mode a color + colorVar + invite (champs Sprint 7)
  for (const mid of EXPECTED_MODES) {
    const m = getCognitiveMode(mid);
    if (m.color && m.colorVar && m.invite)
      ok(`mode ${mid} : color + colorVar + invite OK`);
    else
      ko(`mode ${mid} : champs Sprint 7 manquants`, JSON.stringify({ color: m.color, colorVar: m.colorVar, invite: !!m.invite }));
  }

  // 5.6 — Les 7 colorVar sont uniques (pas de collision)
  const colorVars = COGNITIVE_MODES.map(m => m.colorVar);
  const uniqColorVars = new Set(colorVars);
  if (uniqColorVars.size === 7) ok('colorVars : 7 distincts');
  else                            ko('colorVars : collision détectée', `${uniqColorVars.size}/7 uniques`);
} catch (e) { ko('Frontend agents.js : import KO', e.message); }

try {
  const orchMod = await import(`file://${join(ROOT, 'workers/src/lib/brainstorming-orchestrator.js')}`);
  const { pickNextAgent, getArcForMode, ARCS_BY_MODE } = orchMod;

  // 5.7 — ARCS_BY_MODE exporté avec les 7 entrées
  if (ARCS_BY_MODE && Object.keys(ARCS_BY_MODE).length === 7)
    ok('ARCS_BY_MODE : 7 arcs définis');
  else
    ko('ARCS_BY_MODE : nombre incorrect', String(Object.keys(ARCS_BY_MODE || {}).length));

  // 5.8 — Chaque mode a un arc qui contient les 9 agents en clés
  const AGENT_IDS = ['strategic', 'creative', 'growth', 'consumer', 'brand', 'cultural', 'data', 'devil', 'synth'];
  for (const mid of EXPECTED_MODES) {
    const arc = getArcForMode(mid);
    const missing = AGENT_IDS.filter(a => !arc[a]);
    if (missing.length === 0) ok(`arc ${mid} : 9 agents mappés`);
    else                       ko(`arc ${mid} : agents manquants`, missing.join(','));
  }

  // 5.9 — Les arcs sont différenciés : on compare le successeur de 'strategic'
  // entre tous les modes. Au moins 3 modes doivent avoir un successeur DIFFÉRENT
  // de exploration (creative) — sinon l'arc n'est pas vraiment customisé.
  const stratNext = {};
  for (const mid of EXPECTED_MODES) {
    stratNext[mid] = getArcForMode(mid).strategic;
  }
  const uniqNext = new Set(Object.values(stratNext));
  if (uniqNext.size >= 4)
    ok(`arcs différenciés : ${uniqNext.size} successeurs distincts pour strategic`);
  else
    ko('arcs différenciés : trop similaires', JSON.stringify(stratNext));

  // 5.10 — pickNextAgent honore le mode passé en argument
  // (history avec un dernier message du strategic → next dépend du mode)
  const history = [{ agent_id: 'strategic', content: 'cadrage ok' }];
  const nextExpl = pickNextAgent(history, 'exploration');
  const nextCris = pickNextAgent(history, 'crisis');
  if (nextExpl !== nextCris)
    ok(`pickNextAgent honore le mode (exploration→${nextExpl}, crisis→${nextCris})`);
  else
    ko('pickNextAgent ignore le mode', `${nextExpl} === ${nextCris}`);

  // 5.11 — Mode inconnu → fallback exploration (pas d'erreur)
  const arcInvalid = getArcForMode('mode_inexistant');
  const arcExpl    = getArcForMode('exploration');
  if (arcInvalid.strategic === arcExpl.strategic) ok('mode inconnu → fallback exploration');
  else                                              ko('fallback exploration cassé', '');

  // ─── Sprint 7.1 — déduplication round-table ──────────────────────
  // 5.12 — Si l'agent suivant dans l'arc a déjà parlé, on saute
  const hist4 = [
    { agent_id: 'strategic', content: 'ouverture' },
    { agent_id: 'creative',  content: 'concept fort' },
    { agent_id: 'devil',     content: 'mais...' },
    { agent_id: 'consumer',  content: 'côté humain' },
  ];
  const next4 = pickNextAgent(hist4, 'exploration');
  // Successeur naturel de consumer = cultural (jamais parlé) → cultural
  if (next4 === 'cultural') ok('dedup : history 4 agents → cultural (successeur vierge)');
  else                       ko('dedup KO 4 agents', `attendu cultural, reçu ${next4}`);

  // 5.13 — Simulation d'un round-table complet 8 tours : aucun agent
  // ne doit être appelé 2 fois.
  const sim = [];
  const calls = new Set();
  let lastId = null;
  // 1er tour : history vide → strategic
  for (let i = 0; i < 8; i++) {
    const aid = pickNextAgent(sim, 'exploration');
    sim.push({ agent_id: aid, content: `tour ${i+1}` });
    if (calls.has(aid)) {
      ko(`round-table dedup : ${aid} appelé 2x au tour ${i+1}`, JSON.stringify([...calls]));
      lastId = 'DUP';
      break;
    }
    calls.add(aid);
    lastId = aid;
  }
  if (lastId !== 'DUP' && calls.size === 8) ok('round-table 8 tours : 8 agents distincts (zéro répétition)');

  // 5.14 — Intervention user au milieu reset la dédup (cycle redémarre)
  const histReset = [
    { agent_id: 'strategic', content: 'ouverture' },
    { agent_id: 'creative',  content: 'idée' },
    { agent_id: 'devil',     content: 'doute' },
    { agent_id: 'user',      content: 'recadre svp' },
    { agent_id: 'strategic', content: 'compris, on focus' },
  ];
  // Après le reset user, seul strategic a parlé dans le cycle courant
  // → successeur naturel de strategic = creative (en exploration)
  const nextReset = pickNextAgent(histReset, 'exploration');
  if (nextReset === 'creative') ok('dedup : user reset → cycle redémarre');
  else                           ko('dedup user reset KO', `attendu creative, reçu ${nextReset}`);

  // ─── Sprint 7.1.1 — fix bug ping-pong (mention parasite) ─────────
  // 5.15 — Si un agent NON-strategic cite "Strategic Lead" dans son texte
  // (citation polie forcée par le system prompt), pickNextAgent ne doit
  // PAS pivoter vers strategic. Il doit suivre l'arc.
  const histParasite = [
    { agent_id: 'strategic', content: 'Keystone est un outil. Creative Director, ton angle ?' },
    { agent_id: 'growth',    content: 'Je comprends où Strategic Lead veut en venir, mais...' },
  ];
  const nextParasite = pickNextAgent(histParasite, 'launch');
  // last=growth, strategic+growth déjà parlés. Arc launch growth→creative.
  // creative pas encore parlé → return creative. La citation parasite
  // "Strategic Lead" ne doit PAS faire repartir sur strategic.
  if (nextParasite === 'creative')
    ok('Sprint 7.1.1 : mention parasite (citation polie) ignorée → arc continue');
  else
    ko('Sprint 7.1.1 : ping-pong non corrigé', `attendu creative, reçu ${nextParasite}`);

  // 5.16 — Strategic Lead distribue la parole : mention HONORÉE
  const histDistribute = [
    { agent_id: 'strategic', content: 'On lance. Brand Guardian, à toi de poser le cadre.' },
  ];
  const nextDistribute = pickNextAgent(histDistribute, 'launch');
  // last=strategic, mention=brand, brand pas encore parlé → return brand
  // (override l'arc launch qui aurait dit growth)
  if (nextDistribute === 'brand')
    ok('Sprint 7.1.1 : Strategic distribue la parole → mention honored');
  else
    ko('Sprint 7.1.1 : distribution Strategic KO', `attendu brand, reçu ${nextDistribute}`);

  // 5.17 — Simulation réaliste round-table 8 tours avec mentions parasites
  // dans chaque message (comme en prod). Vérifie qu'on a bien 8 agents distincts.
  const simReal = [];
  const realCalls = new Set();
  let dupAt = null;
  // Mentions parasites typiques produites par les agents (politesse)
  const parasites = [
    '. Strategic Lead a raison.',
    '. Je rejoins Creative Director.',
    '. Comme l\'a dit Devil\'s Advocate, ...',
    '. Growth Hacker propose une approche pertinente.',
    '. Consumer Psychologist apporte une vraie clé.',
    '. Cultural Analyst pointe juste.',
    '. Brand Guardian a raison.',
    '. Data Analyst pose les bons ordres de grandeur.',
  ];
  for (let i = 0; i < 8; i++) {
    const aid = pickNextAgent(simReal, 'launch');
    simReal.push({ agent_id: aid, content: `Tour ${i+1}${parasites[i] || ''}` });
    if (realCalls.has(aid)) { dupAt = `${aid} au tour ${i+1}`; break; }
    realCalls.add(aid);
  }
  if (!dupAt && realCalls.size === 8)
    ok('Sprint 7.1.1 : round-table 8 tours avec mentions parasites → 8 agents distincts');
  else
    ko('Sprint 7.1.1 : ping-pong persiste avec mentions parasites', dupAt || `seulement ${realCalls.size} agents`);
} catch (e) { ko('Worker orchestrator : import KO', e.message); }

// 5.12 — Worker _modeDescription contient les 7 modes enrichis
try {
  const workerAgents = await readFile(join(ROOT, 'workers/src/lib/brainstorming-agents.js'), 'utf8');
  for (const mid of EXPECTED_MODES) {
    if (workerAgents.includes(`${mid}:`) && workerAgents.includes('INTERDIT'))
      ok(`worker _modeDescription : ${mid} présent + contient INTERDIT`);
    else if (!workerAgents.includes(`${mid}:`))
      ko(`worker _modeDescription : ${mid} absent`, '');
    else
      ok(`worker _modeDescription : ${mid} présent (sans INTERDIT)`);
  }
} catch (e) { ko('Worker agents.js : read KO', e.message); }

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
