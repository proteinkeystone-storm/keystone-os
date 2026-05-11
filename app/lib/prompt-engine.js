/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — PromptEngine (Sprint P2.1 · Layer 2)
   Bridge unifié vers les LLM tiers, BYOK auto-résolu via vault.

   Promesse archi (cf. ARCHITECTURE.md §4) :
   - Bridge cross-modèle (Claude, GPT, Gemini, Mistral, Grok, Perplexity)
   - Recettes atomiques pré-définies (redact-section, summarize, …)
     avec prompt système figé, optimisé par modèle, sortie stricte
   - Pas de génération de HTML/CSS — uniquement du texte
   - Aucun artefact n'appelle un LLM en direct → tout passe par ici

   API publique :
     promptEngine.run({ task, context, engine, maxTokens?, model? })
     promptEngine.listEngines()
     promptEngine.listTasks()

   BYOK :
   - Les clés API sont stockées dans localStorage `ks_api_<provider>`
     (cf. vault.js / cloud-vault.js, sync cross-device chiffrée AES-GCM)
   - PromptEngine résout automatiquement la clé pour l'engine demandé
   - Aucune clé n'apparaît jamais dans un log ou un endpoint Keystone

   Sprint P2.1 = Claude seul. Sprint P2.2 ajoutera les autres.
   ═══════════════════════════════════════════════════════════════ */

const API_BASE = 'https://keystone-os-api.keystone-os.workers.dev';

// ── Registry des engines ───────────────────────────────────────
// Une entrée par moteur LLM supporté. Le mapping engineId ↔ provider
// est crucial pour résoudre la clé API dans le vault (`ks_api_<provider>`).
const ENGINES = {
  claude: {
    provider        : 'anthropic',
    defaultModel    : 'claude-sonnet-4-5-20250929',
    defaultMaxTokens: 1024,
    label           : 'Claude',
  },
  // Sprint P2.2 : gpt5, gemini, mistral, grok, perplexity, llama
};

// ── Registry des tâches atomiques ──────────────────────────────
// Chaque tâche déclare :
//   - label, description : pour les UI admin / catalog
//   - outputFormat : 'text' | 'json' — l'attendu côté consommateur
//   - systemPrompts : un prompt par engine (chacun optimisé pour le
//     style/format propre du modèle, pour stabilité cross-IA)
//   - buildUserMessage(context) → string : transforme le context utilisateur
//     en message user. Doit être déterministe et concis.
const TASKS = {
  'redact-section': {
    label       : 'Rédiger une section courte',
    description : 'Rédige un paragraphe court (150-200 mots) sur un sujet donné, ton sobre français professionnel.',
    outputFormat: 'text',
    systemPrompts: {
      claude: `Tu es un rédacteur professionnel français spécialisé en immobilier neuf et en documents contractuels.

Mission : rédige UN SEUL paragraphe court (entre 120 et 200 mots maximum) sur le sujet demandé par l'utilisateur.

Style imposé :
- Sobre, factuel, précis.
- Pas de superlatifs creux ("exceptionnel", "unique", "magnifique"…).
- Pas de marketing parle, pas d'envolée commerciale.
- Adapté à une notice descriptive contractuelle ou à un document signable.
- Vocabulaire technique correct mais accessible.

Format de sortie :
- Texte brut uniquement.
- AUCUNE balise HTML, AUCUN markdown, AUCUN titre.
- Pas de listes à puces ni de tableaux.
- Pas de salutation, pas de signature, pas de phrase d'intro type "Voici le paragraphe…".
- Tu réponds directement avec le paragraphe, point.`,
    },
    buildUserMessage(context) {
      const topic   = context.topic   || context.subject || '';
      const details = context.details || context.context || '';
      const lines = [`Sujet à rédiger : ${topic}`];
      if (details) lines.push(`Contexte complémentaire : ${details}`);
      return lines.join('\n\n');
    },
  },
};

// ── Helpers internes ───────────────────────────────────────────
function _getApiKey(engineId) {
  const eng = ENGINES[engineId];
  if (!eng) return '';
  try { return localStorage.getItem('ks_api_' + eng.provider) || ''; }
  catch { return ''; }
}

function _jwt() {
  try { return localStorage.getItem('ks_jwt') || ''; }
  catch { return ''; }
}

function _authHeaders() {
  const jwt = _jwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

// ── API publique ───────────────────────────────────────────────
export const promptEngine = {

  /** Liste les engines supportés + indique si la clé API est présente. */
  listEngines() {
    return Object.entries(ENGINES).map(([id, e]) => ({
      id,
      label   : e.label,
      provider: e.provider,
      hasApiKey: !!_getApiKey(id),
    }));
  },

  /** Liste les tâches atomiques et les engines qui les implémentent. */
  listTasks() {
    return Object.entries(TASKS).map(([id, t]) => ({
      id,
      label       : t.label,
      description : t.description,
      outputFormat: t.outputFormat,
      engines     : Object.keys(t.systemPrompts),
    }));
  },

  /**
   * Cœur du moteur. Exécute une tâche atomique sur l'engine choisi.
   *
   * @param {object}  opts
   * @param {string}  opts.task       — clé dans TASKS
   * @param {object}  opts.context    — données pour buildUserMessage(context)
   * @param {string}  opts.engine     — clé dans ENGINES (défaut: 'claude')
   * @param {number}  [opts.maxTokens]— override taille sortie
   * @param {string}  [opts.model]    — override modèle (sinon defaultModel)
   * @returns {Promise<{text: string, usage: object, model: string, meta: object}>}
   */
  async run({ task, context = {}, engine = 'claude', maxTokens = null, model = null }) {
    const taskDef = TASKS[task];
    if (!taskDef) throw new Error(`PromptEngine: tâche inconnue '${task}'`);

    const engineDef = ENGINES[engine];
    if (!engineDef) throw new Error(`PromptEngine: engine inconnu '${engine}'`);

    const systemPrompt = taskDef.systemPrompts[engine];
    if (!systemPrompt) {
      throw new Error(`PromptEngine: tâche '${task}' pas encore implémentée pour '${engine}' (ajouter le system prompt dans TASKS.${task}.systemPrompts.${engine})`);
    }

    const apiKey = _getApiKey(engine);
    if (!apiKey) {
      throw new Error(`PromptEngine: clé API ${engineDef.provider} introuvable dans le vault. Configure-la dans Réglages → Vault avant d'utiliser ${engineDef.label}.`);
    }

    const userMessage = typeof taskDef.buildUserMessage === 'function'
      ? taskDef.buildUserMessage(context)
      : JSON.stringify(context);

    const body = {
      engine,
      apiKey,
      model     : model || engineDef.defaultModel,
      system    : systemPrompt,
      messages  : [{ role: 'user', content: userMessage }],
      max_tokens: maxTokens || engineDef.defaultMaxTokens,
    };

    const res = await fetch(`${API_BASE}/api/proxy/llm`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body   : JSON.stringify(body),
    });

    let data = null;
    try { data = await res.json(); } catch { /* parse fail */ }

    if (!res.ok) {
      throw new Error(`PromptEngine: ${data?.error || `HTTP ${res.status}`}`);
    }

    return {
      text : data.text || '',
      usage: data.usage || null,
      model: data.model || engineDef.defaultModel,
      meta : { task, engine, outputFormat: taskDef.outputFormat },
    };
  },

  // Debug & introspection (à ne pas consommer depuis les artefacts).
  _debug: { ENGINES, TASKS, _getApiKey },
};

if (typeof window !== 'undefined') {
  window.promptEngine = promptEngine;
}
