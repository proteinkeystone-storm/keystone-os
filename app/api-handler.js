/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — API Handler v2.0
   S-CORE-LOGIC-V1 : Aiguillage multi-moteurs
   Providers : Anthropic · OpenAI · Gemini · xAI · Perplexity · Mistral · Meta/Groq
   ═══════════════════════════════════════════════════════════════ */

// ── Appel générique format OpenAI ────────────────────────────
async function callOpenAIFormat(endpoint, model, prompt, apiKey) {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: 'Tu es un assistant expert en immobilier neuf et promotion immobilière. Réponds toujours en français.' },
                { role: 'user',   content: prompt },
            ],
            max_tokens: 2048,
            temperature: 0.7,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Erreur HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
}

// ── Configuration moteurs (S-CORE-LOGIC-V1) ─────────────────
const ENGINE_CONFIG = {

    'Claude': async (prompt, apiKey) => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 2048,
                system: 'Tu es un assistant expert en immobilier neuf et promotion immobilière. Réponds toujours en français.',
                messages: [{ role: 'user', content: prompt }],
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Erreur HTTP ${res.status}`);
        }
        const data = await res.json();
        return data.content[0].text;
    },

    'ChatGPT': (prompt, apiKey) =>
        callOpenAIFormat('https://api.openai.com/v1/chat/completions', 'gpt-4o', prompt, apiKey),

    'Gemini': async (prompt, apiKey) => {
        const model = 'gemini-1.5-pro';
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
                }),
            }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Erreur HTTP ${res.status}`);
        }
        const data = await res.json();
        return data.candidates[0].content.parts[0].text;
    },

    'Grok': (prompt, apiKey) =>
        callOpenAIFormat('https://api.x.ai/v1/chat/completions', 'grok-2-latest', prompt, apiKey),

    'Perplexity': (prompt, apiKey) =>
        callOpenAIFormat('https://api.perplexity.ai/chat/completions', 'sonar-pro', prompt, apiKey),

    'Mistral': (prompt, apiKey) =>
        callOpenAIFormat('https://api.mistral.ai/v1/chat/completions', 'mistral-large-latest', prompt, apiKey),

    'Llama': (prompt, apiKey) =>
        callOpenAIFormat('https://api.groq.com/openai/v1/chat/completions', 'llama-3.1-70b-versatile', prompt, apiKey),
};

// ── Export public ────────────────────────────────────────────
export const ApiHandler = {
    async callEngine(engineLabel, prompt, apiKey) {
        const fn = ENGINE_CONFIG[engineLabel];
        if (!fn) throw new Error(`Moteur "${engineLabel}" non reconnu par S-CORE-LOGIC-V1.`);
        return fn(prompt, apiKey);
    },

    getSupportedEngines() {
        return Object.keys(ENGINE_CONFIG);
    },
};
