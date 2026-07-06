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
// Source de vérité du modèle IA (cf. lib/ai-model.js) — on teste le
// CÂBLAGE des MODEL_ID sur KS_AI_MODEL plutôt qu'une chaîne figée.
import { KS_AI_MODEL }        from '../workers/src/lib/ai-model.js';

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

  // 5.1 — Les 8 modes existent (7 modes de débat + « Idées de Posts »)
  if (COGNITIVE_MODES?.length === 8) ok('COGNITIVE_MODES : 8 modes définis');
  else                                ko('COGNITIVE_MODES : nombre incorrect', String(COGNITIVE_MODES?.length));

  // 5.2 — Tous les modes attendus sont présents
  for (const mid of EXPECTED_MODES) {
    const m = COGNITIVE_MODES?.find(x => x.id === mid);
    if (m) ok(`COGNITIVE_MODES : ${mid} présent`);
    else    ko(`COGNITIVE_MODES : ${mid} absent`, '');
  }

  // 5.3 — Les 8 modes sont activés (enabled: true)
  const enabled = COGNITIVE_MODES?.filter(m => m.enabled);
  if (enabled?.length === 8) ok('COGNITIVE_MODES : 8 modes enabled:true');
  else                        ko('COGNITIVE_MODES : tous les modes ne sont pas enabled', `${enabled?.length}/8`);

  // 5.4 — Helper getEnabledCognitiveModes exporté et fonctionne
  if (typeof getEnabledCognitiveModes === 'function' && getEnabledCognitiveModes().length === 8)
    ok('getEnabledCognitiveModes() retourne 8 modes');
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

  // 5.6 — Les 8 colorVar sont uniques (pas de collision)
  const colorVars = COGNITIVE_MODES.map(m => m.colorVar);
  const uniqColorVars = new Set(colorVars);
  if (uniqColorVars.size === 8) ok('colorVars : 8 distincts');
  else                            ko('colorVars : collision détectée', `${uniqColorVars.size}/8 uniques`);
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

  // ─── Sprint 7.12 — comité réduit (sélecteur d'agents) ────────────
  const agentsLib = await import(`file://${join(ROOT, 'workers/src/lib/brainstorming-agents.js')}`);
  const { normalizeDebateRoster } = agentsLib;

  // 5.25 — Un agent hors-comité ne parle JAMAIS, même si le débat regorge
  // de ses triggers (growth exclu malgré "acquisition/viralité/funnel").
  const rosterNoGrowth = ['strategic', 'creative', 'data', 'devil'];
  const simRoster = [{ agent_id: 'strategic', content: 'Cadrage : parlons acquisition, viralité, canal, funnel, conversion.' }];
  let growthSpoke = false;
  for (let i = 0; i < 8; i++) {
    const aid = pickNextAgent(simRoster, 'launch', rosterNoGrowth);
    if (aid === 'growth') growthSpoke = true;
    simRoster.push({ agent_id: aid, content: 'acquisition viralité canal funnel conversion levier' });
  }
  const allInRoster = simRoster.slice(1).every(t => rosterNoGrowth.includes(t.agent_id));
  if (!growthSpoke && allInRoster)
    ok('Sprint 7.12 : un agent hors-comité ne parle jamais (growth exclu malgré ses triggers)');
  else
    ko('Sprint 7.12 : agent hors-comité a parlé', `growthSpoke=${growthSpoke}, agents=${simRoster.slice(1).map(t => t.agent_id).join(',')}`);

  // 5.26 — Petit comité (4 = 'crisis') : tour de table complet, tous parlent, sans doublon.
  const roster4 = ['strategic', 'devil', 'data', 'brand'];
  const sim4 = [{ agent_id: 'strategic', content: 'Crise : bad buzz, churn, concurrent agressif.' }];
  const spoke4 = new Set(['strategic']);
  for (let i = 0; i < 3; i++) {
    const aid = pickNextAgent(sim4, 'crisis', roster4);
    spoke4.add(aid);
    sim4.push({ agent_id: aid, content: 'risque danger chiffre marché identité marque premium' });
  }
  if (roster4.every(id => spoke4.has(id)) && spoke4.size === 4)
    ok('Sprint 7.12 : petit comité (4) — tour de table complet sans doublon');
  else
    ko('Sprint 7.12 : petit comité incomplet/doublon', `parlés : ${[...spoke4].join(',')}`);

  // 5.27 — roster null ⇒ comité complet (legacy, zéro régression)
  const legacyNext = pickNextAgent([{ agent_id: 'strategic', content: 'Idée audacieuse, concept de rupture.' }], 'exploration', null);
  if (typeof legacyNext === 'string' && legacyNext !== 'strategic' && legacyNext !== 'user')
    ok(`Sprint 7.12 : roster null ⇒ comité complet (next = ${legacyNext})`);
  else
    ko('Sprint 7.12 : fallback comité complet KO', `reçu ${legacyNext}`);

  // 5.28 — normalizeDebateRoster : strategic forcé, synth/auto/invalides retirés, dédup.
  const norm = normalizeDebateRoster(['data', 'synth', 'auto', 'data', 'xxx', 'devil']);
  const normOk = norm.includes('strategic') && !norm.includes('synth') && !norm.includes('auto')
    && !norm.includes('xxx') && norm.filter(x => x === 'data').length === 1;
  if (normOk)
    ok(`Sprint 7.12 : normalizeDebateRoster (strategic forcé, synth/auto/invalides exclus, dédup) → [${norm.join(',')}]`);
  else
    ko('Sprint 7.12 : normalizeDebateRoster incorrect', JSON.stringify(norm));
} catch (e) { ko('Worker orchestrator : import KO', e.message); }

// ─── Sprint 7.12 — comités recommandés par mode (lib frontend) ────
try {
  const fLib = await import(`file://${join(ROOT, 'app/lib/brainstorming-agents.js')}`);
  const { RECOMMENDED_ROSTER_BY_MODE, getRecommendedRoster, OPPOSITION_AGENTS, MIN_DEBATE_AGENTS } = fLib;
  let allGood = true;
  const details = [];
  for (const mid of EXPECTED_MODES) {
    const r = getRecommendedRoster(mid);
    const hasStrat  = r.includes('strategic');
    const hasOppo   = OPPOSITION_AGENTS.some(o => r.includes(o));
    const noSynth   = !r.includes('synth');
    const bigEnough = r.length >= MIN_DEBATE_AGENTS;
    if (!(hasStrat && hasOppo && noSynth && bigEnough)) { allGood = false; details.push(`${mid}:[${r.join(',')}]`); }
  }
  if (allGood && Object.keys(RECOMMENDED_ROSTER_BY_MODE).length === 8)
    ok('Sprint 7.12 : 8 comités recommandés (7 modes de débat : strategic + ≥1 opposition + ≥ plancher, sans synth ; + « Idées de Posts »)');
  else
    ko('Sprint 7.12 : comités recommandés invalides', details.join(' | '));
} catch (e) { ko('Sprint 7.12 : lib frontend comités — import KO', e.message); }

// ─── Juin 2026 — Sélecteur de comité par IA (mode « Auto ») ───────
// Le mode Auto ne suit plus une table figée : l'IA choisit les agents les plus
// adaptés au sujet, avec repli « les 9 » (comité complet). On teste le parse pur
// + le câblage worker (endpoint, repli, garde-fous) + le câblage front.
try {
  const routeMod = await import(`file://${join(ROOT, 'workers/src/routes/brainstorming.js')}`);
  const { parseRosterPick } = routeMod;
  if (typeof parseRosterPick !== 'function') throw new Error('parseRosterPick non exporté');

  // JSON strict : ids valides gardés, synth + invalides + doublons retirés
  const p1 = parseRosterPick('{"agents":["creative","data","strategic","creative","synth","xxx"]}');
  if (JSON.stringify(p1) === JSON.stringify(['creative', 'data', 'strategic']))
    ok(`pick-roster : parse JSON (synth/invalides/doublons retirés) → [${p1.join(',')}]`);
  else
    ko('pick-roster : parse JSON incorrect', JSON.stringify(p1));

  // Texte libre : ids repérés dans l'ordre d'apparition
  const p2 = parseRosterPick('Pour ce sujet : creative, growth puis devil.');
  if (JSON.stringify(p2) === JSON.stringify(['creative', 'growth', 'devil']))
    ok('pick-roster : parse texte libre (ordre d\'apparition)');
  else
    ko('pick-roster : parse texte libre incorrect', JSON.stringify(p2));

  // Réponse inexploitable → [] (le helper bascule alors sur le repli complet)
  const p3 = parseRosterPick('désolé, je ne sais pas');
  if (Array.isArray(p3) && p3.length === 0)
    ok('pick-roster : réponse illisible → [] (repli côté helper)');
  else
    ko('pick-roster : devrait être vide', JSON.stringify(p3));

  // Robuste au non-string
  if (parseRosterPick(null).length === 0 && parseRosterPick(undefined).length === 0)
    ok('pick-roster : null/undefined → []');
  else
    ko('pick-roster : null/undefined non géré', '');
} catch (e) { ko('pick-roster : parseRosterPick — import/exec KO', e.message); }

try {
  const route = await readFile(join(ROOT, 'workers/src/routes/brainstorming.js'), 'utf8');
  const index = await readFile(join(ROOT, 'workers/src/index.js'), 'utf8');
  const front = await readFile(join(ROOT, 'app/brainstorming.js'), 'utf8');

  if (route.includes('export async function handleBrainstormingPickRoster'))
    ok('pick-roster : handler worker exporté');
  else ko('pick-roster : handler worker absent', '');

  if (index.includes("path === '/api/brainstorming/pick-roster'") && index.includes('handleBrainstormingPickRoster'))
    ok('pick-roster : route câblée dans index.js');
  else ko('pick-roster : route non câblée', '');

  // Repli « les 9 » = comité de débat complet (strategic … devil … data)
  if (/FULL_DEBATE_ROSTER\s*=\s*\[[^\]]*'strategic'[^\]]*'devil'[^\]]*'data'[^\]]*\]/.test(route))
    ok('pick-roster : repli comité complet (FULL_DEBATE_ROSTER) défini');
  else ko('pick-roster : FULL_DEBATE_ROSTER manquant/incomplet', '');

  // Garde-fous : ≥1 voix d'opposition + métrage budget (pas de crédit en plus)
  if (route.includes("roster.push('devil')")) ok('pick-roster : garantit une voix d\'opposition');
  else ko('pick-roster : garde-fou opposition absent', '');
  if (route.includes("recordUsage(env, 'brainstorming'")) ok('pick-roster : usage budget enregistré');
  else ko('pick-roster : recordUsage absent', '');

  // Front : passe IA déclenchée au lancement en Auto, JAMAIS en Manuel
  if (front.includes('async function _pickRosterAuto')) ok('pick-roster : helper front _pickRosterAuto');
  else ko('pick-roster : helper front absent', '');
  if (/_pickRosterAuto\(panel\)/.test(front) && front.includes("rosterMode !== 'manual'"))
    ok('pick-roster : front l\'appelle au lancement en Auto (jamais en Manuel)');
  else ko('pick-roster : front n\'appelle pas la passe correctement', '');
} catch (e) { ko('pick-roster : câblage — read KO', e.message); }

// ─── Juin 2026 — Source de contenu (lien / texte / fichier .md) ──
// Mistral/Cloudflare ne navigue pas → le client APPORTE sa matière. On ancre le
// débat ET la rédaction dessus, gratuitement. On teste l'import du module worker
// (réutilise les briques Smart Agent) + le câblage complet worker/front.
try {
  const csMod = await import(`file://${join(ROOT, 'workers/src/routes/content-source.js')}`);
  if (typeof csMod.handleFetchSource === 'function')
    ok('source : handleFetchSource exporté (réutilise validateImportUrl/htmlToText/clampExtractText)');
  else
    ko('source : handleFetchSource absent', '');
} catch (e) { ko('source : content-source.js — import KO', e.message); }

try {
  const cs    = await readFile(join(ROOT, 'workers/src/routes/content-source.js'), 'utf8');
  const index = await readFile(join(ROOT, 'workers/src/index.js'), 'utf8');
  const wbs   = await readFile(join(ROOT, 'workers/src/routes/brainstorming.js'), 'utf8');
  const wgw   = await readFile(join(ROOT, 'workers/src/routes/ghostwriter.js'), 'utf8');
  const fbs   = await readFile(join(ROOT, 'app/brainstorming.js'), 'utf8');
  const fgw   = await readFile(join(ROOT, 'app/ghostwriter.js'), 'utf8');

  // Route web câblée + GRATUITE (extraction maison ; binaire/PDF refusé = anti-coût)
  if (index.includes("path === '/api/content/fetch-source'") && index.includes('handleFetchSource'))
    ok('source : route /api/content/fetch-source câblée');
  else ko('source : route non câblée', '');
  if (cs.includes('htmlToText') && /application\/pdf/.test(cs) && cs.includes('415'))
    ok('source : extraction gratuite (htmlToText) + binaire/PDF refusé (doctrine flat)');
  else ko('source : garde-fous fetch manquants', '');

  // Débat ancré (worker brainstorming) : champ source + DOSSIER SOURCE borné
  if (/source,\s*\/\//.test(wbs) && wbs.includes('DOSSIER SOURCE') && wbs.includes('SOURCE_INJECT_MAX'))
    ok('source : débat ancré (effectiveBrief + borne SOURCE_INJECT_MAX)');
  else ko('source : injection débat manquante', '');

  // Rédaction ancrée (worker ghostwriter) : champ source + _srcBlock (compose + rewrite)
  const gwHits = (wgw.match(/\$\{_srcBlock\}/g) || []).length;
  if (wgw.includes('source,') && gwHits >= 2)
    ok(`source : rédaction ancrée (_srcBlock injecté ${gwHits}× : compose-post + rewrite, BYOK + Mistral)`);
  else ko('source : injection rédaction manquante', `_srcBlock ×${gwHits}`);

  // Front brainstorming : contrôle (lien/texte/fichier) + .md accepté + payload
  if (fbs.includes('function _renderSourceControl') && fbs.includes('/api/content/fetch-source'))
    ok('source : contrôle front (lien / texte collé / fichier)');
  else ko('source : contrôle front absent', '');
  if (fbs.includes('.md,.markdown,.txt,.csv'))
    ok('source : fichiers .md / .txt / .csv acceptés (lus côté front, gratuit)');
  else ko('source : .md non accepté', '');
  if (/source\s*:\s*_currentSession\.source/.test(fbs))
    ok('source : transmise dans le payload du débat');
  else ko('source : absente du payload débat', '');

  // Transport vers Ghost Writer en ARGUMENT (hors rail, effacé hors post-ideas).
  // Depuis le fix « fuite aval » (2026-07-06), la source client garde la
  // PRIORITÉ et le DOSSIER MAISON du Gest fait repli (un angle nu ne suffit
  // pas pour rédiger).
  if (fbs.includes('openGhostwriterChained?.(text.trim(), source)')
      && /const source = _currentSession\?\.source\s*\n?\s*\|\|/.test(fbs)
      && fbs.includes('_currentSession?.gestDossier'))
    ok('source : portée à GW en argument — priorité client, repli dossier maison (Gest)');
  else ko('source : non transmise à GW (ou priorité client/repli dossier cassés)', '');
  if (fgw.includes('_chainedSource') && /openGhostwriterChained\(initialText\s*=\s*'',\s*source/.test(fgw) && /source\s*:\s*_chainedSource/.test(fgw))
    ok('source : Ghost Writer la reçoit + l\'injecte dans le body (_callReal), nettoyée à la fermeture');
  else ko('source : GW ne consomme pas la source', '');
} catch (e) { ko('source : câblage — read KO', e.message); }

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

  // ─── Sprint 7.4 → consolidation moteur unique (2026-05-29) ────────
  // L'ancien mix Llama 3.1 8B (streaming) + Gemma 4 26B (heavy) a été
  // remplacé par un MOTEUR UNIQUE défini dans lib/ai-model.js
  // (KS_AI_MODEL). Les deux RÔLES restent distincts via deux constantes
  // (MODEL_ID = streaming multi-agent ; MODEL_ID_HEAVY = one-shot
  // synth/insights), toutes deux câblées sur KS_AI_MODEL. On teste le
  // CÂBLAGE sur la source de vérité, pas une chaîne figée → reste vert
  // à chaque future migration de modèle.
  // 5.32 — MODEL_ID_HEAVY (one-shot synth/insights) câblé sur KS_AI_MODEL
  if (workerRoute.match(/MODEL_ID_HEAVY\s*=\s*KS_AI_MODEL/))
    ok(`Sprint 7.4 : MODEL_ID_HEAVY câblé sur KS_AI_MODEL (${KS_AI_MODEL})`);
  else
    ko('Sprint 7.4 : MODEL_ID_HEAVY non câblé sur KS_AI_MODEL (lib/ai-model.js)', '');

  // 5.33 — MODEL_ID (streaming multi-agent) câblé sur KS_AI_MODEL
  if (workerRoute.match(/MODEL_ID\s*=\s*KS_AI_MODEL/))
    ok(`Sprint 7.4 : MODEL_ID streaming câblé sur KS_AI_MODEL (${KS_AI_MODEL})`);
  else
    ko('Sprint 7.4 : MODEL_ID streaming non câblé sur KS_AI_MODEL (lib/ai-model.js)', '');

  // 5.34 — _generateSynthesis appelle MODEL_ID_HEAVY
  // On cible précisément la fonction synth (paramètre env), pas Claude
  const synthBlock = workerRoute.split(/async function _generateSynthesis\(env/)[1]?.split('async function')[0] || '';
  if (synthBlock.includes('MODEL_ID_HEAVY'))
    ok('Sprint 7.4 : _generateSynthesis utilise MODEL_ID_HEAVY (rôle heavy)');
  else
    ko('Sprint 7.4 : _generateSynthesis n\'utilise pas MODEL_ID_HEAVY', '');

  // 5.35 — _extractInsights appelle MODEL_ID_HEAVY
  const insightsBlock = workerRoute.split('_extractInsights')[1]?.split('async function')[0] || '';
  if (insightsBlock.includes('MODEL_ID_HEAVY'))
    ok('Sprint 7.4 : _extractInsights utilise MODEL_ID_HEAVY (rôle heavy)');
  else
    ko('Sprint 7.4 : _extractInsights n\'utilise pas MODEL_ID_HEAVY', '');

  // 5.36 — Streaming agents reste sur MODEL_ID (rôle streaming, pas heavy)
  // Cherche le bloc où on a aiStream = await env.AI.run(... — il doit
  // utiliser MODEL_ID, pas MODEL_ID_HEAVY
  const streamMatch = workerRoute.match(/aiStream\s*=\s*await\s+env\.AI\.run\((MODEL_ID(?:_HEAVY)?)/);
  if (streamMatch && streamMatch[1] === 'MODEL_ID')
    ok('Sprint 7.4 : streaming agents reste sur MODEL_ID (rôle streaming, dictée vocale)');
  else
    ko('Sprint 7.4 : streaming agents bascule sur HEAVY (KO !)', streamMatch?.[1] || 'introuvable');

  // 5.37 — Détection finish_reason=length (pattern Ghost Writer, cap raisonneur)
  if (workerRoute.includes('finish_reason') && workerRoute.includes('length'))
    ok('Sprint 7.4 : détection finish_reason="length" présente (cap raisonneur)');
  else
    ko('Sprint 7.4 : pas de détection finish_reason=length', '');

  // ─── Sprint 7.8 + 7.11 — pondération userReactions + formule Avancement ───
  // 5.38 — Le code itère sur turn.userReactions avec REACTIONS_POSITIVE/NEGATIVE
  const consensusBlock = workerRoute.split('_computeConsensus')[1]?.split('function _')[0] || '';
  if (consensusBlock.includes('userReactions') && consensusBlock.includes('REACTIONS_POSITIVE'))
    ok('Sprint 7.8 : _computeConsensus pondère userReactions (REACTIONS_POSITIVE/NEGATIVE)');
  else
    ko('Sprint 7.8 : userReactions non pondéré', '');

  // 5.39 — Sprint 7.12 : un tour de table complet = 100% (plus de réserve 90%).
  if (consensusBlock.includes('Math.min(distinctAgents.size, N) / N') && /progressScore\s*>=\s*1/.test(consensusBlock))
    ok('Sprint 7.12 : Avancement = 100% au tour de table complet (distinctAgents/N + court-circuit ≥1)');
  else
    ko('Sprint 7.12 : formule Avancement (100% au tour complet) absente', '');

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

  // ── Devil's Advocate sur Claude Haiku (BYOK, 2026-05-28) ────────
  // 5.43 — agent premium = devil
  if (workerRoute.match(/PREMIUM_AGENT_ID\s*=\s*['"]devil['"]/))
    ok("Devil-Haiku : PREMIUM_AGENT_ID = 'devil'");
  else
    ko("Devil-Haiku : PREMIUM_AGENT_ID absent ou != devil", '');

  // 5.44 — modèle Claude Haiku 4.5
  if (workerRoute.match(/BRAINSTORM_CLAUDE_MODEL\s*=\s*['"]claude-haiku-4-5/))
    ok('Devil-Haiku : BRAINSTORM_CLAUDE_MODEL = Claude Haiku 4.5');
  else
    ko('Devil-Haiku : modèle Haiku absent', '');

  // 5.45 — _streamAgentClaude streame via Anthropic API
  if (workerRoute.includes('_streamAgentClaude') && workerRoute.includes('api.anthropic.com/v1/messages'))
    ok('Devil-Haiku : _streamAgentClaude appelle Anthropic API en streaming');
  else
    ko('Devil-Haiku : _streamAgentClaude absent ou incorrect', '');

  // 5.46 — fallback Llama transparent (le bloc Llama reste conditionnel)
  if (workerRoute.includes('if (!streamed)'))
    ok('Devil-Haiku : fallback Llama transparent si Claude KO ou pas de clé');
  else
    ko('Devil-Haiku : pas de fallback Llama (if (!streamed))', '');

  // 5.47 — Les 8 autres agents restent sur le moteur Keystone standard
  // (MODEL_ID = KS_AI_MODEL) ; seul devil bascule en BYOK Claude Haiku.
  if (workerRoute.match(/MODEL_ID\s*=\s*KS_AI_MODEL/))
    ok(`Devil-Haiku : les 8 autres agents restent sur le moteur standard (MODEL_ID = KS_AI_MODEL = ${KS_AI_MODEL})`);
  else
    ko('Devil-Haiku : MODEL_ID non câblé sur KS_AI_MODEL (lib/ai-model.js)', '');
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
