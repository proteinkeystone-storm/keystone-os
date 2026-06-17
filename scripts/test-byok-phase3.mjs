#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test BYOK Phase 3 (Smart Agent + coffre serveur 3b)

   - resolveEngineForTenant : flag gating + null paths + round-trip
     crypto RÉEL (encrypt → mock DB → decrypt) ;
   - structurel : keys.js (coffre user JWT), chat public câblé,
     embeddings bge-m3 intacts, front double-write.

   Usage : node scripts/test-byok-phase3.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { readFile }      from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveEngineForTenant } from '../workers/src/lib/llm-router.js';
import { encrypt }                from '../workers/src/lib/crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function ok(l)    { passed++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); }
function ko(l, e) { failed++; failures.push({ label: l, error: e }); console.log(`  \x1b[31m✗\x1b[0m ${l}\n    ${e}`); }
function eq(l, got, want) { (JSON.stringify(got) === JSON.stringify(want)) ? ok(`${l}`) : ko(l, `attendu ${JSON.stringify(want)}, reçu ${JSON.stringify(got)}`); }
async function src(rel) { return readFile(join(ROOT, rel), 'utf8'); }

// Mock D1 : renvoie pref/keyRow selon la table visée par la requête.
function mockDB({ pref = null, keyRow = null } = {}) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (/tenant_ai_prefs/.test(sql)) return pref;
          if (/tenant_api_keys/.test(sql)) return keyRow;
          return null;
        },
      };
    },
  };
}
const SECRET = 'test-secret-0123456789-abcdefghi-XYZ';

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 1 — Syntaxe\x1b[0m');
for (const f of ['workers/src/lib/llm-router.js', 'workers/src/routes/keys.js', 'workers/src/index.js', 'workers/src/routes/smart-agent.js', 'app/ui-renderer.js']) {
  try { execSync(`node --check ${JSON.stringify(join(ROOT, f))}`, { stdio: 'pipe' }); ok(`node --check ${f}`); }
  catch (e) { ko(`node --check ${f}`, (e.stderr?.toString() || e.message).split('\n')[0]); }
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 2 — resolveEngineForTenant (flag gating + null)\x1b[0m');
{
  const dbFull = mockDB({ pref: { active_engine: 'claude' }, keyRow: { ciphertext: 'x', iv: 'y' } });
  eq('flag OFF → null', await resolveEngineForTenant({ BYOK_ROUTING: 'off', KS_ENCRYPTION_KEY: SECRET, DB: dbFull }, 't1'), null);
  eq('pas de tenantId → null', await resolveEngineForTenant({ BYOK_ROUTING: 'on', KS_ENCRYPTION_KEY: SECRET, DB: dbFull }, null), null);
  eq('pas de KS_ENCRYPTION_KEY → null', await resolveEngineForTenant({ BYOK_ROUTING: 'on', DB: dbFull }, 't1'), null);
  eq('pas de pref moteur actif → null', await resolveEngineForTenant({ BYOK_ROUTING: 'on', KS_ENCRYPTION_KEY: SECRET, DB: mockDB({ pref: null }) }, 't1'), null);
  eq('pref mais pas de clé → null', await resolveEngineForTenant({ BYOK_ROUTING: 'on', KS_ENCRYPTION_KEY: SECRET, DB: mockDB({ pref: { active_engine: 'gpt' }, keyRow: null }) }, 't1'), null);
}

console.log('\n\x1b[1m▶ Suite 3 — resolveEngineForTenant : round-trip crypto RÉEL\x1b[0m');
{
  const REAL_KEY = 'sk-ant-api03-MA-VRAIE-CLE-secrète-1234567890';
  const { ciphertext, iv } = await encrypt(REAL_KEY, SECRET);
  const env = { BYOK_ROUTING: 'on', KS_ENCRYPTION_KEY: SECRET, DB: mockDB({ pref: { active_engine: 'claude' }, keyRow: { ciphertext, iv } }) };
  const r = await resolveEngineForTenant(env, 'tenant-proprio');
  eq('flag ON + pref + clé chiffrée → {engine, apiKey} déchiffrée', r, { engine: 'claude', apiKey: REAL_KEY });
  // Mauvaise clé de chiffrement → déchiffrement échoue → null (jamais casser)
  eq('mauvais secret → null (pas d’exception)', await resolveEngineForTenant({ ...env, KS_ENCRYPTION_KEY: 'mauvais-secret' }, 'tenant-proprio'), null);
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 4 — Coffre serveur (keys.js) : sécurité\x1b[0m');
{
  const s = await src('workers/src/routes/keys.js');
  (/requireJWT/.test(s) ? ok : (e)=>ko('keys: JWT requis', e))('keys.js exige requireJWT');
  (/claims\.sub/.test(s) ? ok : (e)=>ko('keys: tenant du JWT', e))('keys.js : tenant tiré du JWT (claims.sub), pas du client');
  (/encrypt\(/.test(s) ? ok : (e)=>ko('keys: chiffrement', e))('keys.js chiffre la clé (encrypt)');
  (!/return\s+json\([^)]*apiKey/.test(s) ? ok : (e)=>ko('keys: pas de fuite', e))('keys.js ne renvoie JAMAIS la clé en clair');
  (/CREATE TABLE IF NOT EXISTS tenant_api_keys/.test(s) && /CREATE TABLE IF NOT EXISTS tenant_ai_prefs/.test(s) ? ok : (e)=>ko('keys: schéma', e))('keys.js crée tenant_api_keys + tenant_ai_prefs (idempotent)');
}

console.log('\n\x1b[1m▶ Suite 5 — Chat public câblé + garde-fous flagship\x1b[0m');
{
  const sa = await src('workers/src/routes/smart-agent.js');
  (/resolveEngineForTenant\(env, tenant\)/.test(sa) ? ok : (e)=>ko('public chat byok', e))('chat public : resolveEngineForTenant(env, tenant)');
  (/fallbackOnError: true/.test(sa) ? ok : (e)=>ko('public fallback', e))('chat public : repli Mistral si clé proprio échoue (D4)');
  (/!useByok && await isEnforceEnabled\(env, ownerKey\)/.test(sa) ? ok : (e)=>ko('public credit skip', e))('chat public : crédit proprio skippé en BYOK (D3)');
  (/env\.AI\.run\(EMBED_MODEL/.test(sa) ? ok : (e)=>ko('embeddings', e))('embeddings bge-m3 INTACTS (D2)');
  const idx = await src('workers/src/index.js');
  (/handleSaveUserKey|handleListUserKeys/.test(idx) ? ok : (e)=>ko('index wiring', e))('index.js câble /api/keys');
}

console.log('\n\x1b[1m▶ Suite 6 — Front double-write\x1b[0m');
{
  const ui = await src('app/ui-renderer.js');
  (/_syncServerKey/.test(ui) ? ok : (e)=>ko('front sync', e))('ui-renderer : _syncServerKey (POST /api/keys)');
  (/_deleteServerKey/.test(ui) ? ok : (e)=>ko('front delete', e))('ui-renderer : _deleteServerKey (clé vidée → DELETE serveur)');
  (/_syncServerKey\(\{ activeEngine/.test(ui) ? ok : (e)=>ko('front active', e))('ui-renderer : sync du moteur actif au changement');
}

console.log(`\n\x1b[1m═══ Sommaire ═══\x1b[0m`);
console.log(`  \x1b[32m${passed} passed\x1b[0m  ·  \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  \x1b[31mÉchecs :\x1b[0m'); for (const f of failures) console.log(`   - ${f.label}: ${f.error}`); }
process.exit(failed > 0 ? 1 : 0);
