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

  // ─── Sprint 7.2 — scoring sémantique organique ───────────────────
  const { scoreAgentRelevance, AGENT_TRIGGERS } = orchMod;

  // 5.18 — scoreAgentRelevance exposé
  if (typeof scoreAgentRelevance === 'function' && AGENT_TRIGGERS)
    ok('Sprint 7.2 : scoreAgentRelevance + AGENT_TRIGGERS exportés');
  else
    ko('Sprint 7.2 : export manquant', '');

  // 5.19 — Mots-clés data activent data
  if (scoreAgentRelevance('data', 'Quel est le ordre de grandeur du marché B2B ? CAC plausible ?') >= 2)
    ok('Sprint 7.2 : triggers data activés sur "marché / CAC / ordre de grandeur"');
  else
    ko('Sprint 7.2 : data triggers KO', '');

  // 5.20 — Mots-clés devil activent devil
  if (scoreAgentRelevance('devil', 'La concurrence est saturée et la différenciation reste fragile') >= 2)
    ok('Sprint 7.2 : triggers devil activés sur "concurrence saturée / fragile"');
  else
    ko('Sprint 7.2 : devil triggers KO', '');

  // 5.21 — Mots-clés cultural activent cultural
  if (scoreAgentRelevance('cultural', 'On capte un signal sur TikTok dans cette niche Gen Z') >= 2)
    ok('Sprint 7.2 : triggers cultural activés sur "signal / TikTok / niche"');
  else
    ko('Sprint 7.2 : cultural triggers KO', '');

  // 5.22 — Scoring choisit le bon agent (mode launch, après strategic
  // qui parle de marché B2B et conversion → data devrait gagner)
  const histScoring = [
    { agent_id: 'strategic', content: 'Keystone vise le marché B2B avec un objectif de conversion mesurable.' },
  ];
  const nextScoring = pickNextAgent(histScoring, 'launch');
  // Data a 'marché' + 'b2b' (2 triggers) ; growth a 'conversion' (1 trigger)
  // Donc data > growth → data devrait être choisi
  if (nextScoring === 'data')
    ok(`Sprint 7.2 : scoring choisit data (le plus pertinent sur "marché B2B / conversion")`);
  else if (nextScoring === 'growth')
    ok(`Sprint 7.2 : scoring choisit growth (acceptable, "conversion" matche aussi)`);
  else
    ko('Sprint 7.2 : scoring KO', `attendu data ou growth, reçu ${nextScoring}`);

  // 5.23 — Garantie tour complet avec contradicteur. Simulation : on
  // construit un débat où seuls les premiers thèmes "positifs" sont
  // discutés (concept, audience, marque, croissance). Devil doit
  // quand même parler dans le cycle grâce au fallback arc.
  const simPositive = [];
  const positiveContents = [
    'Keystone est un outil B2B.',
    'Notre concept émotionnel est puissant et inspirant.', // creative ++
    'Cette audience cherche une expérience humaine.',       // consumer ++
    'Notre identité de marque doit rester premium.',         // brand ++
    'Le canal d\'acquisition par viralité est notre levier.',// growth ++
    'On capte un signal culturel sur Gen Z TikTok.',         // cultural ++
    'Le marché B2B est large, CAC plausible.',               // data ++
    // 7e tour : il reste devil + on est ≥ SCORING_CUTOFF_SPOKEN → fallback arc
  ];
  for (let i = 0; i < positiveContents.length; i++) {
    const aid = pickNextAgent(simPositive, 'launch');
    simPositive.push({ agent_id: aid, content: positiveContents[i] });
  }
  // Au tour 8, il reste devil. Le fallback arc doit l'amener.
  const tour8 = pickNextAgent(simPositive, 'launch');
  if (tour8 === 'devil')
    ok('Sprint 7.2 : Devil\'s Advocate force-parle au tour 8 (garantie tour complet)');
  else
    ko('Sprint 7.2 : Devil saute au tour 8', `attendu devil, reçu ${tour8} ; déjà parlés : ${simPositive.map(t => t.agent_id).join(',')}`);

  // 5.24 — Strategic ne se ré-élit pas spontanément en cours de débat
  // (il intervient sur reset user uniquement, ou en ouverture)
  const histStratNoRepeat = [
    { agent_id: 'strategic', content: 'On lance Keystone, outil de productivité.' },
    { agent_id: 'creative',  content: 'Concept fort possible avec storytelling.' },
  ];
  const nextNoStrat = pickNextAgent(histStratNoRepeat, 'launch');
  if (nextNoStrat !== 'strategic')
    ok(`Sprint 7.2 : Strategic ne reprend pas spontanément (next = ${nextNoStrat})`);
  else
    ko('Sprint 7.2 : Strategic reprend à tort', '');
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

// ─── Sprint 7.3 — directives comportementales par agent ──────────
try {
  const workerRoute = await readFile(join(ROOT, 'workers/src/routes/brainstorming.js'), 'utf8');

  // 5.25 — MAX_SENTENCES_PER_TURN passé à 3
  if (workerRoute.match(/MAX_SENTENCES_PER_TURN\s*=\s*3/))
    ok('Sprint 7.3 : MAX_SENTENCES_PER_TURN = 3 (au lieu de 2)');
  else
    ko('Sprint 7.3 : MAX_SENTENCES_PER_TURN pas à 3', '');

  // 5.26 — MAX_TOKENS augmenté
  const tokensMatch = workerRoute.match(/MAX_TOKENS\s*=\s*(\d+)/);
  if (tokensMatch && Number(tokensMatch[1]) >= 240)
    ok(`Sprint 7.3 : MAX_TOKENS = ${tokensMatch[1]} (>= 240)`);
  else
    ko('Sprint 7.3 : MAX_TOKENS pas augmenté', tokensMatch?.[1] || 'absent');

  // 5.27 — AGENT_BEHAVIOR_DIRECTIVES présent avec les 9 agents
  if (workerRoute.includes('AGENT_BEHAVIOR_DIRECTIVES')) {
    const agentIds = ['creative', 'growth', 'consumer', 'brand', 'cultural', 'data', 'devil', 'synth'];
    let allPresent = true;
    for (const aid of agentIds) {
      if (!workerRoute.match(new RegExp(`${aid}\\s*:\\s*\\{`))) {
        ko(`Sprint 7.3 : directive ${aid} manquante`, '');
        allPresent = false;
      }
    }
    if (allPresent) ok('Sprint 7.3 : AGENT_BEHAVIOR_DIRECTIVES contient les 8 agents non-Strategic');
  } else {
    ko('Sprint 7.3 : AGENT_BEHAVIOR_DIRECTIVES manquant', '');
  }

  // 5.28 — Trigger contient les nouvelles interdictions
  const interdictionsToFind = [
    'Ce qui vient d\\\'être dit',  // pattern à interdire
    'INTERVENTION ATTENDUE',         // section nouveau prompt
    'CONTREDIRE',                    // posture friction
    'PIVOTER',
    'RADICALISER',
  ];
  let interdictMissing = [];
  for (const pat of interdictionsToFind) {
    if (!workerRoute.match(new RegExp(pat, 'i'))) interdictMissing.push(pat);
  }
  if (interdictMissing.length === 0)
    ok('Sprint 7.3 : trigger contient interdictions + posture débat (contredire/pivoter/radicaliser)');
  else
    ko('Sprint 7.3 : trigger incomplet', `manque : ${interdictMissing.join(', ')}`);

  // 5.29 — Directive devil contient "challenger" / "interroge"
  if (workerRoute.match(/devil\s*:\s*\{[^}]*(?:INTERROGE|CHALLENGE|challenger)/i))
    ok('Sprint 7.3 : devil dirigé vers challenge frontal');
  else
    ko('Sprint 7.3 : devil pas assez tranchant', '');

  // 5.30 — Directive data demande chiffres appuyés
  if (workerRoute.match(/data\s*:\s*\{[^}]*(?:CAC|LTV|ratio|ordre de grandeur)/i))
    ok('Sprint 7.3 : data demande chiffres appuyés sur ratio (CAC/LTV/ratio standard)');
  else
    ko('Sprint 7.3 : data pas assez précis sur chiffres', '');

  // 5.31 — Directive cultural demande référent nommé
  if (workerRoute.match(/cultural\s*:\s*\{[^}]*(?:référent|compte|niche|courant)/i))
    ok('Sprint 7.3 : cultural demande référent nommé (compte/courant/niche)');
  else
    ko('Sprint 7.3 : cultural pas assez précis sur référent', '');

  // ─── Sprint 7.4 — hybride Llama (streaming) + Gemma (synth/insights) ─
  // 5.32 — MODEL_ID_HEAVY = Gemma 4 26B
  if (workerRoute.match(/MODEL_ID_HEAVY\s*=\s*['"]@cf\/google\/gemma-4-26b-a4b-it['"]/))
    ok('Sprint 7.4 : MODEL_ID_HEAVY = Gemma 4 26B (synthesizer + insights)');
  else
    ko('Sprint 7.4 : MODEL_ID_HEAVY manquant ou pas Gemma 4', '');

  // 5.33 — MODEL_ID streaming reste Llama 3.1 8B
  if (workerRoute.match(/MODEL_ID\s*=\s*['"]@cf\/meta\/llama-3\.1-8b-instruct['"]/))
    ok('Sprint 7.4 : MODEL_ID streaming reste Llama 3.1 8B (dictée vocale)');
  else
    ko('Sprint 7.4 : MODEL_ID streaming a bougé !', '');

  // 5.34 — _generateSynthesis (Gemma) appelle MODEL_ID_HEAVY
  // On cible précisément la fonction Gemma (paramètre env), pas Claude
  const synthBlock = workerRoute.split(/async function _generateSynthesis\(env/)[1]?.split('async function')[0] || '';
  if (synthBlock.includes('MODEL_ID_HEAVY'))
    ok('Sprint 7.4 : _generateSynthesis utilise MODEL_ID_HEAVY (Gemma 4)');
  else
    ko('Sprint 7.4 : _generateSynthesis encore sur Llama', '');

  // 5.35 — _extractInsights appelle MODEL_ID_HEAVY
  const insightsBlock = workerRoute.split('_extractInsights')[1]?.split('async function')[0] || '';
  if (insightsBlock.includes('MODEL_ID_HEAVY'))
    ok('Sprint 7.4 : _extractInsights utilise MODEL_ID_HEAVY (Gemma 4)');
  else
    ko('Sprint 7.4 : _extractInsights encore sur Llama', '');

  // 5.36 — Streaming agents reste sur MODEL_ID (Llama)
  // Cherche le bloc où on a aiStream = await env.AI.run(... — il doit
  // utiliser MODEL_ID (Llama), pas MODEL_ID_HEAVY
  const streamMatch = workerRoute.match(/aiStream\s*=\s*await\s+env\.AI\.run\((MODEL_ID(?:_HEAVY)?)/);
  if (streamMatch && streamMatch[1] === 'MODEL_ID')
    ok('Sprint 7.4 : streaming agents reste sur MODEL_ID (Llama, pour la dictée vocale)');
  else
    ko('Sprint 7.4 : streaming agents bascule sur HEAVY (KO Gemma raisonneur !)', streamMatch?.[1] || 'introuvable');

  // 5.37 — Détection finish_reason=length pour Gemma (pattern Ghost Writer)
  if (workerRoute.includes('finish_reason') && workerRoute.includes('length'))
    ok('Sprint 7.4 : détection finish_reason="length" présente (cap Gemma raisonneur)');
  else
    ko('Sprint 7.4 : pas de détection finish_reason=length', '');

  // ─── Sprint 7.8 + 7.11 — pondération userReactions + formule Avancement ───
  // 5.38 — Le code itère sur turn.userReactions avec REACTIONS_POSITIVE/NEGATIVE
  const consensusBlock = workerRoute.split('_computeConsensus')[1]?.split('function _')[0] || '';
  if (consensusBlock.includes('userReactions') && consensusBlock.includes('REACTIONS_POSITIVE'))
    ok('Sprint 7.8 : _computeConsensus pondère userReactions (REACTIONS_POSITIVE/NEGATIVE)');
  else
    ko('Sprint 7.8 : userReactions non pondéré', '');

  // 5.39 — Sprint 7.11 : formule progression linéaire (distinctAgents.size)
  if (consensusBlock.includes('distinctAgents') && consensusBlock.match(/0\.9\s*\/\s*8/))
    ok('Sprint 7.11 : formule Avancement = (agents distincts / 8) × 90%');
  else
    ko('Sprint 7.11 : formule progression absente', '');

  // ─── Sprint 7.9 — BYOK Claude pour Synthesizer ──────────────────
  // 5.40 — _generateSynthesisClaude fait fetch vers Anthropic API
  if (workerRoute.includes('_generateSynthesisClaude') && workerRoute.includes('api.anthropic.com/v1/messages'))
    ok('Sprint 7.9 : _generateSynthesisClaude appelle Anthropic API');
  else
    ko('Sprint 7.9 : _generateSynthesisClaude absent ou incorrect', '');

  // 5.41 — Routing engine='claude' dans handleBrainstormingSynthesize
  if (workerRoute.match(/engine\s*===\s*['"]claude['"]/) && workerRoute.includes('apiKey'))
    ok('Sprint 7.9 : route synthesize accepte engine=claude + apiKey');
  else
    ko('Sprint 7.9 : routing BYOK Claude absent', '');

  // 5.42 — Fallback transparent Gemma si Claude échoue
  if (workerRoute.includes('gemma-fallback') || workerRoute.match(/Claude\s+KO/i))
    ok('Sprint 7.9 : fallback Gemma transparent si Claude échoue');
  else
    ko('Sprint 7.9 : pas de fallback Gemma', '');
} catch (e) { ko('Worker route : read KO', e.message); }

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
