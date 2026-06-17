#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test de PARITÉ de app/lib/engines.js (BYOK Phase 1)

   Le refactor « source unique » remplace ~11 mappings dupliqués par des
   helpers tirés de engines.js. Ce test encode les ANCIENS littéraux
   (copiés verbatim des fichiers d'origine) et prouve que engines.js les
   reproduit À L'IDENTIQUE pour les 7 labels (zéro dérive). Si un seul
   mapping diffère, ce test casse AVANT le déploiement.

   Usage : node scripts/test-engines.mjs   ·   Exit 0 si OK, 1 sinon.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ENGINES, VISIBLE_ENGINES, ENGINE_LABELS, PROVIDERS,
  engineRecord, providerForLabel, engineIdForLabel, promptIdForLabel,
  docUrlForLabel, webUrlForLabel,
} from '../app/lib/engines.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function ok(l)    { passed++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); }
function ko(l, e) { failed++; failures.push({ label: l, error: e }); console.log(`  \x1b[31m✗\x1b[0m ${l}\n    ${e}`); }
function eqMap(label, fn, expected) {
  const diffs = [];
  for (const [k, v] of Object.entries(expected)) {
    const got = fn(k);
    if (JSON.stringify(got) !== JSON.stringify(v)) diffs.push(`${k}: attendu ${JSON.stringify(v)}, reçu ${JSON.stringify(got)}`);
  }
  if (diffs.length === 0) ok(`${label} (${Object.keys(expected).length} labels)`);
  else                    ko(label, diffs.join(' · '));
}

// ── Littéraux ORIGINAUX (copiés verbatim des sources avant refactor) ──

// ui-renderer ENGINE_TO_PROVIDER (label → id provider, suffixe ks_api_)
const OLD_PROVIDER = {
  'Claude': 'anthropic', 'ChatGPT': 'openai', 'Gemini': 'gemini',
  'Grok': 'xai', 'Perplexity': 'perplexity', 'Mistral': 'mistral', 'Llama': 'meta',
};
// api-handler / annonces / ui-renderer _ENGINE_LABEL_TO_PROMPT_ENGINE (label → engine Worker)
const OLD_ENGINE = {
  'Claude': 'claude', 'ChatGPT': 'gpt', 'Gemini': 'gemini', 'Grok': 'grok',
  'Perplexity': 'perplexity', 'Mistral': 'mistral', 'Llama': 'llama',
};
// ui-renderer ENGINE_LABEL_TO_ID (label → promptId D1 — ChatGPT diffère = gpt4o)
const OLD_PROMPT_ID = {
  'Claude': 'claude', 'ChatGPT': 'gpt4o', 'Gemini': 'gemini', 'Grok': 'grok',
  'Perplexity': 'perplexity', 'Mistral': 'mistral', 'Llama': 'llama',
};
// codex _findApiKeyForEngine (label → id provider, AVEC alias 'GPT 5')
const OLD_FIND_KEY = {
  'Claude': 'anthropic', 'ChatGPT': 'openai', 'GPT 5': 'openai', 'Gemini': 'gemini',
  'Mistral': 'mistral', 'Grok': 'xai', 'Perplexity': 'perplexity', 'Llama': 'meta',
};
// codex ENGINE_DOC_URL (avec 'GPT 5')
const OLD_DOC_URL = {
  'Claude': 'https://console.anthropic.com/settings/keys',
  'ChatGPT': 'https://platform.openai.com/api-keys',
  'GPT 5': 'https://platform.openai.com/api-keys',
  'Gemini': 'https://aistudio.google.com/app/apikey',
  'Mistral': 'https://console.mistral.ai/api-keys/',
  'Grok': 'https://console.x.ai/',
  'Perplexity': 'https://www.perplexity.ai/settings/api',
  'Llama': 'https://api.together.xyz/settings/api-keys',
};
// codex ENGINE_WEB_URL (avec 'GPT 5')
const OLD_WEB_URL = {
  'Claude': { url: 'https://claude.ai/new', host: 'claude.ai' },
  'ChatGPT': { url: 'https://chatgpt.com/', host: 'chatgpt.com' },
  'GPT 5': { url: 'https://chatgpt.com/', host: 'chatgpt.com' },
  'Gemini': { url: 'https://gemini.google.com/app', host: 'gemini.google.com' },
  'Mistral': { url: 'https://chat.mistral.ai/chat', host: 'chat.mistral.ai' },
  'Grok': { url: 'https://grok.com/', host: 'grok.com' },
  'Perplexity': { url: 'https://www.perplexity.ai/', host: 'perplexity.ai' },
  'Llama': { url: 'https://www.meta.ai/', host: 'meta.ai' },
};
// codex _listAvailableEngines / vault / cloud-vault
const OLD_LIST_LABELS = ['Claude', 'ChatGPT', 'Gemini', 'Mistral', 'Grok', 'Perplexity', 'Llama'];
const OLD_PROVIDERS    = ['anthropic', 'openai', 'gemini', 'xai', 'perplexity', 'mistral', 'meta'];
// ui-renderer API_PROVIDERS (records — champs UI)
const OLD_RECORDS = {
  anthropic:  { name: 'Anthropic',  label: 'Claude',     logo: './RESOURCES/LOGOS/Logo%20Claude.png',       logoLight: './RESOURCES/LOGOS/Logo%20Claude%20-%20fond%20clair.png',       placeholder: 'sk-ant-api03-...' },
  openai:     { name: 'OpenAI',     label: 'ChatGPT',    logo: './RESOURCES/LOGOS/Logo%20Chat%20GPT.png',   logoLight: './RESOURCES/LOGOS/Logo%20Chat%20GPT%20-%20fond%20clair.png',   placeholder: 'sk-proj-...' },
  gemini:     { name: 'Google',     label: 'Gemini',     logo: './RESOURCES/LOGOS/Logo%20Gemini.png',       logoLight: './RESOURCES/LOGOS/Logo%20Gemini%20-%20fond%20clair.png',       placeholder: 'AIza...' },
  xai:        { name: 'xAI',        label: 'Grok',       logo: './RESOURCES/LOGOS/Logo%20Grok.png',         logoLight: './RESOURCES/LOGOS/Logo%20Grok%20-%20fond%20clair.png',         placeholder: 'xai-...' },
  perplexity: { name: 'Perplexity', label: 'Perplexity', logo: './RESOURCES/LOGOS/Logo%20Perplexity.png',   logoLight: './RESOURCES/LOGOS/Logo%20Perplexity%20-%20fond%20clair.png',   placeholder: 'pplx-...' },
  mistral:    { name: 'Mistral AI', label: 'Mistral',    logo: './RESOURCES/LOGOS/Logo%20Mistral%20AI.png', logoLight: './RESOURCES/LOGOS/Logo%20Mistral%20AI%20-%20fond%20clair.png', placeholder: 'mis-...' },
  meta:       { name: 'Meta',       label: 'Llama',      logo: './RESOURCES/LOGOS/Logo%20Meta%20ai.png',    logoLight: './RESOURCES/LOGOS/Logo%20Meta%20ai%20-%20fond%20clair.png',    placeholder: 'gsk-...' },
};

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 1 — Syntaxe\x1b[0m');
try { execSync(`node --check ${JSON.stringify(join(ROOT, 'app/lib/engines.js'))}`, { stdio: 'pipe' }); ok('node --check app/lib/engines.js'); }
catch (e) { ko('node --check engines.js', (e.stderr?.toString() || e.message).split('\n')[0]); }

console.log('\n\x1b[1m▶ Suite 2 — Parité des mappings (7 labels, zéro dérive)\x1b[0m');
eqMap('label → provider (ks_api_)',        providerForLabel, OLD_PROVIDER);
eqMap('label → engine Worker',             engineIdForLabel, OLD_ENGINE);
eqMap('label → promptId D1 (ChatGPT=gpt4o)', promptIdForLabel, OLD_PROMPT_ID);
eqMap('label → provider AVEC alias GPT 5', providerForLabel, OLD_FIND_KEY);
eqMap('label → docUrl (AVEC GPT 5)',       docUrlForLabel,   OLD_DOC_URL);
eqMap('label → webUrl {url,host} (AVEC GPT 5)', webUrlForLabel, OLD_WEB_URL);

console.log('\n\x1b[1m▶ Suite 3 — Listes & records\x1b[0m');
{
  const labelsAll = ENGINES.map(e => e.label);
  if (JSON.stringify(labelsAll) === JSON.stringify(OLD_LIST_LABELS.slice().sort((a,b)=>OLD_LIST_LABELS.indexOf(a)-OLD_LIST_LABELS.indexOf(b)))
      || new Set(labelsAll).size === 7 && OLD_LIST_LABELS.every(l => labelsAll.includes(l)))
    ok('ENGINES couvre les 7 labels historiques');
  else ko('ENGINES labels', JSON.stringify(labelsAll));

  if (JSON.stringify(PROVIDERS.slice().sort()) === JSON.stringify(OLD_PROVIDERS.slice().sort()))
    ok('PROVIDERS = 7 ids historiques (vault/cloud-vault)');
  else ko('PROVIDERS', `attendu ${JSON.stringify(OLD_PROVIDERS)}, reçu ${JSON.stringify(PROVIDERS)}`);

  // Records : chaque entrée engines.js doit matcher l'ancien API_PROVIDERS
  const recDiffs = [];
  for (const [id, want] of Object.entries(OLD_RECORDS)) {
    const r = ENGINES.find(e => e.id === id);
    if (!r) { recDiffs.push(`${id} absent`); continue; }
    for (const f of ['name', 'label', 'logo', 'logoLight', 'placeholder']) {
      if (r[f] !== want[f]) recDiffs.push(`${id}.${f}: attendu ${want[f]}, reçu ${r[f]}`);
    }
  }
  if (recDiffs.length === 0) ok('records UI (id/name/label/logo/logoLight/placeholder) ×7 identiques');
  else ko('records UI', recDiffs.join(' · '));
}

console.log('\n\x1b[1m▶ Suite 4 — Réduction à 5 (Llama + Perplexity masqués)\x1b[0m');
{
  const wantVisible = ['Claude', 'ChatGPT', 'Gemini', 'Grok', 'Mistral'];
  if (JSON.stringify(ENGINE_LABELS) === JSON.stringify(wantVisible))
    ok(`VISIBLE = [${ENGINE_LABELS.join(', ')}]`);
  else ko('VISIBLE_ENGINES incorrect', `attendu ${JSON.stringify(wantVisible)}, reçu ${JSON.stringify(ENGINE_LABELS)}`);

  const hiddenOk = !engineRecord('Llama').visible && !engineRecord('Perplexity').visible;
  if (hiddenOk) ok('Llama + Perplexity : visible=false (support Worker conservé)');
  else ko('masquage Llama/Perplexity KO', '');

  // alias 'GPT 5' résout bien ChatGPT
  if (engineRecord('GPT 5')?.id === 'openai') ok("alias 'GPT 5' → record ChatGPT (openai)");
  else ko("alias 'GPT 5'", JSON.stringify(engineRecord('GPT 5')));
}

console.log(`\n\x1b[1m═══ Sommaire ═══\x1b[0m`);
console.log(`  \x1b[32m${passed} passed\x1b[0m  ·  \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  \x1b[31mÉchecs :\x1b[0m'); for (const f of failures) console.log(`   - ${f.label}: ${f.error}`); }
process.exit(failed > 0 ? 1 : 0);
