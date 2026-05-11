/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — API Handler v3.0 (Sprint B — refactor PromptEngine)
   S-CORE-LOGIC-V2 : thin wrapper sur le Worker proxy /api/proxy/llm

   Avant (v2) :
   ─────────────────────────────────────────────────────────────
   Chaque moteur avait sa propre fonction avec un fetch direct
   vers l'API du vendor. CORS bypass via headers spéciaux. Pas
   de retry, pas de fallback, pas de monitoring centralisé.

   Après (v3) :
   ─────────────────────────────────────────────────────────────
   Tous les appels LLM passent par le Worker Cloudflare
   /api/proxy/llm (même chemin que PromptEngine). Bénéfices :
   - Retry automatique sur 503 (Gemini sature, ça arrive)
   - Erreurs uniformisées (format JSON consistant côté Worker)
   - Un seul endroit où monitorer la consommation LLM
   - CORS géré une fois, plus de "dangerous-direct-browser-access"
   - Compatible BYOK : la clé du vault transite, jamais stockée

   API publique inchangée :
     ApiHandler.callEngine(engineLabel, prompt, apiKey) → text
     ApiHandler.getSupportedEngines()                   → [labels]
   ═══════════════════════════════════════════════════════════════ */

const API_BASE = 'https://keystone-os-api.keystone-os.workers.dev';

// Mapping label dashboard → engine id PromptEngine.
// Cohérent avec _ENGINE_LABEL_TO_PROMPT_ENGINE dans ui-renderer.js.
const ENGINE_LABEL_TO_ID = {
    'Claude'    : 'claude',
    'ChatGPT'   : 'gpt',
    'Gemini'    : 'gemini',
    'Grok'      : 'grok',
    'Perplexity': 'perplexity',
    'Mistral'   : 'mistral',
    'Llama'     : 'llama',
};

// JWT cookie pour authentification Worker (cf. cloud-vault.js)
function _jwt() {
    try { return localStorage.getItem('ks_jwt') || ''; }
    catch { return ''; }
}

// Appel proxy + retry 503 (3 tentatives, backoff 0s/1.5s/3.5s)
async function _proxyLLMCall({ engineId, prompt, apiKey, maxTokens = 2048 }) {
    const jwt = _jwt();
    const headers = { 'Content-Type': 'application/json' };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    const body = JSON.stringify({
        engine    : engineId,
        apiKey,
        // Pas de system message ici : le pad construit déjà son propre
        // prompt complet avec rôle + instructions + données. On envoie
        // le tout en USER message — comportement identique à l'ancien
        // api-handler v2.
        messages  : [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
    });

    const RETRY_DELAYS = [0, 1500, 3500];
    let lastErr = null;
    for (let i = 0; i < RETRY_DELAYS.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[i]));

        try {
            const res = await fetch(`${API_BASE}/api/proxy/llm`, {
                method: 'POST', headers, body,
            });
            const data = await res.json().catch(() => null);

            if (res.ok && data?.text) {
                return data.text;
            }

            // Erreur HTTP : on retry uniquement sur 503 / surcharge
            const errMsg = data?.error || `HTTP ${res.status}`;
            lastErr = new Error(errMsg);
            if (!/503|high demand|overload|unavailable|temporar/i.test(errMsg)) {
                throw lastErr;  // Erreur définitive (clé invalide, quota, etc.)
            }
            // Sinon : retry au prochain tour
        } catch (e) {
            // Erreur réseau / timeout : on retry une fois, sinon out
            lastErr = e;
            const msg = e?.message || '';
            if (!/503|high demand|overload|temporar|network|fetch/i.test(msg)) {
                throw e;
            }
        }
    }

    throw lastErr || new Error('Aucune réponse après retries');
}

// ── Export public — API inchangée pour compatibilité ─────────
export const ApiHandler = {
    /**
     * Appelle le moteur via le proxy Worker. Retry 503 automatique.
     *
     * @param {string} engineLabel  Label dashboard ("Claude", "Gemini", …)
     * @param {string} prompt       Prompt complet (rôle + données + instructions)
     * @param {string} apiKey       Clé API du vault user (BYOK)
     * @returns {Promise<string>}   Texte généré par le LLM
     */
    async callEngine(engineLabel, prompt, apiKey) {
        const engineId = ENGINE_LABEL_TO_ID[engineLabel];
        if (!engineId) {
            throw new Error(`Moteur "${engineLabel}" non reconnu (S-CORE-LOGIC-V2).`);
        }
        if (!apiKey) {
            throw new Error(`Clé API ${engineLabel} manquante — Réglages → Clés API.`);
        }
        return _proxyLLMCall({ engineId, prompt, apiKey });
    },

    getSupportedEngines() {
        return Object.keys(ENGINE_LABEL_TO_ID);
    },
};
