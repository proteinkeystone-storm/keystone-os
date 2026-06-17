/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Moteurs IA : SOURCE UNIQUE (BYOK Phase 1)
   ─────────────────────────────────────────────────────────────
   Avant ce module, le mapping moteur↔fournisseur était dupliqué dans
   ui-renderer.js (×4), api-handler.js, annonces-immo.js, codex.js (×4),
   vault.js, cloud-vault.js → dérive garantie. Désormais TOUT vient d'ici.

   Trois conventions distinctes cohabitent (à NE PAS confondre) :
     · id        → suffixe de la clé localStorage `ks_api_<id>` (= provider)
                   ⚠ Grok→'xai', Llama→'meta' (≠ label/engine)
     · engine    → paramètre `engine` envoyé au Worker /api/proxy/llm
                   (claude/gpt/gemini/grok/mistral/…) — aussi l'id PromptEngine
     · promptId  → clé de `pad.engines.prompts[…]` en D1 (historique)
                   ⚠ ChatGPT→'gpt4o' (le SEUL qui diffère de `engine`)

   Liste réduite à 5 (handoff D5) : Llama (Meta) + Perplexity sont
   `visible:false` → MASQUÉS côté front (sélecteur + champs clés + listes),
   mais GARDÉS dans la table : le Worker (proxy-llm/llm-router) supporte
   encore les 7, et une clé legacy `ks_api_meta`/`ks_api_perplexity`
   continue de se résoudre/synchroniser sans rien casser.
   ═══════════════════════════════════════════════════════════════ */

// Ordre = ordre d'affichage dans le sélecteur + les champs clés.
export const ENGINES = [
  {
    id: 'anthropic', name: 'Anthropic', label: 'Claude',
    engine: 'claude', promptId: 'claude', modelDefault: 'claude-sonnet-4-5-20250929',
    logo:      './RESOURCES/LOGOS/Logo%20Claude.png',
    logoLight: './RESOURCES/LOGOS/Logo%20Claude%20-%20fond%20clair.png',
    placeholder: 'sk-ant-api03-...',
    docUrl: 'https://console.anthropic.com/settings/keys',
    webUrl: 'https://claude.ai/new', host: 'claude.ai',
    visible: true, aliases: [],
  },
  {
    id: 'openai', name: 'OpenAI', label: 'ChatGPT',
    engine: 'gpt', promptId: 'gpt4o', modelDefault: 'gpt-4o-mini',
    logo:      './RESOURCES/LOGOS/Logo%20Chat%20GPT.png',
    logoLight: './RESOURCES/LOGOS/Logo%20Chat%20GPT%20-%20fond%20clair.png',
    placeholder: 'sk-proj-...',
    docUrl: 'https://platform.openai.com/api-keys',
    webUrl: 'https://chatgpt.com/', host: 'chatgpt.com',
    visible: true, aliases: ['GPT 5'],
  },
  {
    id: 'gemini', name: 'Google', label: 'Gemini',
    engine: 'gemini', promptId: 'gemini', modelDefault: 'gemini-2.5-flash',
    logo:      './RESOURCES/LOGOS/Logo%20Gemini.png',
    logoLight: './RESOURCES/LOGOS/Logo%20Gemini%20-%20fond%20clair.png',
    placeholder: 'AIza...',
    docUrl: 'https://aistudio.google.com/app/apikey',
    webUrl: 'https://gemini.google.com/app', host: 'gemini.google.com',
    visible: true, aliases: [],
  },
  {
    id: 'xai', name: 'xAI', label: 'Grok',
    engine: 'grok', promptId: 'grok', modelDefault: 'grok-2-latest',
    logo:      './RESOURCES/LOGOS/Logo%20Grok.png',
    logoLight: './RESOURCES/LOGOS/Logo%20Grok%20-%20fond%20clair.png',
    placeholder: 'xai-...',
    docUrl: 'https://console.x.ai/',
    webUrl: 'https://grok.com/', host: 'grok.com',
    visible: true, aliases: [],
  },
  {
    id: 'mistral', name: 'Mistral AI', label: 'Mistral',
    engine: 'mistral', promptId: 'mistral', modelDefault: 'mistral-small-latest',
    logo:      './RESOURCES/LOGOS/Logo%20Mistral%20AI.png',
    logoLight: './RESOURCES/LOGOS/Logo%20Mistral%20AI%20-%20fond%20clair.png',
    placeholder: 'mis-...',
    docUrl: 'https://console.mistral.ai/api-keys/',
    webUrl: 'https://chat.mistral.ai/chat', host: 'chat.mistral.ai',
    visible: true, aliases: [],
  },
  // ── Masqués côté front (handoff D5) — support Worker conservé ──
  {
    id: 'perplexity', name: 'Perplexity', label: 'Perplexity',
    engine: 'perplexity', promptId: 'perplexity', modelDefault: 'sonar',
    logo:      './RESOURCES/LOGOS/Logo%20Perplexity.png',
    logoLight: './RESOURCES/LOGOS/Logo%20Perplexity%20-%20fond%20clair.png',
    placeholder: 'pplx-...',
    docUrl: 'https://www.perplexity.ai/settings/api',
    webUrl: 'https://www.perplexity.ai/', host: 'perplexity.ai',
    visible: false, aliases: [],
  },
  {
    id: 'meta', name: 'Meta', label: 'Llama',
    engine: 'llama', promptId: 'llama', modelDefault: 'llama-3.3-70b-versatile',
    logo:      './RESOURCES/LOGOS/Logo%20Meta%20ai.png',
    logoLight: './RESOURCES/LOGOS/Logo%20Meta%20ai%20-%20fond%20clair.png',
    placeholder: 'gsk-...',
    docUrl: 'https://api.together.xyz/settings/api-keys',
    webUrl: 'https://www.meta.ai/', host: 'meta.ai',
    visible: false, aliases: [],
  },
];

// ── Vues dérivées ──────────────────────────────────────────────
export const VISIBLE_ENGINES = ENGINES.filter(e => e.visible);
// Labels visibles, dans l'ordre (pour les listes front : sélecteur, suggestions…).
export const ENGINE_LABELS   = VISIBLE_ENGINES.map(e => e.label);
// Tous les provider-ids (incl. legacy meta/perplexity) — pour la sync vault.
export const PROVIDERS       = ENGINES.map(e => e.id);

// Clés localStorage (source unique aussi).
export const LS_ENGINE = 'ks_active_engine';
export const LS_PREFIX = 'ks_api_';

// ── Résolution d'un record depuis un label (alias + insensible casse) ──
export function engineRecord(label) {
  if (!label) return undefined;
  const want = String(label).trim();
  return ENGINES.find(e => e.label === want)
      || ENGINES.find(e => (e.aliases || []).includes(want))
      || ENGINES.find(e => e.label.toLowerCase() === want.toLowerCase());
}

// label → provider id (suffixe ks_api_). Fallback : label en minuscules
// (reproduit `map[label] || label.toLowerCase()` des anciens mappings).
export function providerForLabel(label) {
  return engineRecord(label)?.id || String(label || '').toLowerCase();
}

// label → engine Worker (= id PromptEngine).
export function engineIdForLabel(label) {
  return engineRecord(label)?.engine || String(label || '').toLowerCase();
}

// label → promptId D1 (pad.engines.prompts) ; ChatGPT→'gpt4o'.
export function promptIdForLabel(label) {
  return engineRecord(label)?.promptId || String(label || '').toLowerCase();
}

export function docUrlForLabel(label) { return engineRecord(label)?.docUrl || null; }
export function webUrlForLabel(label) {
  const r = engineRecord(label);
  return r ? { url: r.webUrl, host: r.host } : null;
}

// ── Accès localStorage (lecture) ───────────────────────────────
// Moteur actif (défaut 'Claude' — comportement historique de tous les appelants).
export function getActiveEngine() {
  try { return localStorage.getItem(LS_ENGINE) || 'Claude'; }
  catch (_) { return 'Claude'; }
}

// Clé API du vault pour un moteur (par label). null si absente.
// Reproduit codex._findApiKeyForEngine.
export function apiKeyForEngine(label) {
  try { return localStorage.getItem(LS_PREFIX + providerForLabel(label)) || null; }
  catch (_) { return null; }
}

// Labels VISIBLES ayant une clé configurée (suggestions front « autre moteur »).
export function listEnginesWithKey() {
  return VISIBLE_ENGINES.filter(e => {
    try { return !!localStorage.getItem(LS_PREFIX + e.id); } catch (_) { return false; }
  }).map(e => e.label);
}

// Champs BYOK à joindre au body d'une requête IA worker : moteur ACTIF (id
// Worker) + sa clé. Renvoie {} si aucune clé → le worker retombe sur Mistral
// (le flag BYOK_ROUTING tranche côté serveur). À spreader : { ...byokRequestFields() }.
export function byokRequestFields() {
  const label = getActiveEngine();
  const key   = apiKeyForEngine(label);
  return key ? { engine: engineIdForLabel(label), apiKey: key } : {};
}
