/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Brainstorming · Route SSE multi-agent (Sprint 2)
   ─────────────────────────────────────────────────────────────────

   Route exposée :
     POST /api/brainstorming/agent-respond
     Body : { agent_id, brief, cognitive_mode, history, max_turns? }
     Auth : JWT licence requise.
     Réponse : stream SSE format custom (cf. ci-dessous).

   agent_id supporté :
     - 'strategic' | 'creative' | 'growth' | 'consumer' | 'brand' |
       'cultural' | 'data' | 'devil' | 'synth' → 1 seul agent répond
     - 'auto' → orchestration : enchaîne plusieurs agents jusqu'à
       atteindre shouldAutoPause OU max_turns (défaut 3).

   Format SSE custom (multi-agent) :
     data: {"type":"agent_start","agent_id":"strategic"}
     data: {"type":"chunk","agent_id":"strategic","text":"…"}
     data: {"type":"chunk","agent_id":"strategic","text":"…"}
     data: {"type":"agent_end","agent_id":"strategic","full_text":"…"}
     data: {"type":"agent_start","agent_id":"creative"}
     …
     data: {"type":"complete","reason":"auto_pause" | "max_turns" | "single"}

   LLM : Gemma 4 26B A4B Workers AI pour tous les agents Sprint 2.
   Sprint 2.5/3 : BYOK Claude pour Strategic Lead + Synthesizer.

   max_tokens = 4096 (Gemma 4 raisonneur).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { getAgent, getAgentNamesForPrompt } from '../lib/brainstorming-agents.js';
import { pickNextAgent, shouldAutoPause } from '../lib/brainstorming-orchestrator.js';

const MODEL_ID    = '@cf/google/gemma-4-26b-a4b-it';
const MAX_TOKENS  = 4096;
const MIN_BRIEF   = 5;
const MAX_BRIEF   = 2000;
const MAX_HISTORY = 40;
const DEFAULT_MAX_TURNS = 3;
const SUPPORTED_AGENTS = new Set([
  'strategic', 'creative', 'growth', 'consumer', 'brand',
  'cultural', 'data', 'devil', 'synth', 'auto',
]);

// ─────────────────────────────────────────────────────────────────
// POST /api/brainstorming/agent-respond
// ─────────────────────────────────────────────────────────────────
export async function handleBrainstormingAgentRespond(request, env) {
  const origin = getAllowedOrigin(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Auth obligatoire
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);

  // Parse body
  const body = await parseBody(request);
  if (!body || typeof body !== 'object') {
    return err('Body JSON requis', 400, origin);
  }

  const {
    agent_id,
    brief,
    cognitive_mode = 'exploration',
    history        = [],
    max_turns      = DEFAULT_MAX_TURNS,
  } = body;

  // Validation
  if (!agent_id || !SUPPORTED_AGENTS.has(agent_id)) {
    return err(`agent_id invalide (reçu : ${agent_id})`, 400, origin);
  }
  if (typeof brief !== 'string' || brief.trim().length < MIN_BRIEF) {
    return err(`brief requis (${MIN_BRIEF} caractères min)`, 400, origin);
  }
  if (brief.length > MAX_BRIEF) {
    return err(`brief trop long (${MAX_BRIEF} max)`, 400, origin);
  }
  if (!Array.isArray(history) || history.length > MAX_HISTORY) {
    return err(`history invalide (max ${MAX_HISTORY} entrées)`, 400, origin);
  }
  const turnsCap = Math.max(1, Math.min(6, Number(max_turns) || DEFAULT_MAX_TURNS));

  if (!env.AI || typeof env.AI.run !== 'function') {
    return err('Workers AI non disponible (binding [ai] manquant)', 503, origin);
  }

  // ─────────────────────────────────────────────────────────────
  // Stream custom multi-agent
  // ─────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const isAuto  = agent_id === 'auto';

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch (e) { /* stream may be closed */ }
      };

      // Working copy de l'historique (on appendera au fur et à mesure)
      const localHistory = [...history];
      let turnsDone = 0;
      let completeReason = 'single';

      try {
        while (true) {
          // Déterminer l'agent qui va parler maintenant
          let currentAgentId;
          if (isAuto) {
            currentAgentId = pickNextAgent(localHistory, cognitive_mode);
          } else {
            // Mode "1 agent unique" — on s'arrête après ce tour
            currentAgentId = agent_id;
          }

          const agent = getAgent(currentAgentId);
          if (!agent) {
            send({ type: 'error', message: `Agent inconnu: ${currentAgentId}` });
            break;
          }

          // Annonce le début du message de l'agent
          send({ type: 'agent_start', agent_id: currentAgentId });

          // Construction des messages pour Gemma 4
          const agentList    = getAgentNamesForPrompt(currentAgentId);
          const systemPrompt = agent.systemPrompt(cognitive_mode, brief, agentList);

          const messages = [{ role: 'system', content: systemPrompt }];
          for (const turn of localHistory) {
            if (!turn || !turn.content) continue;
            messages.push({
              role:    turn.agent_id === 'user' ? 'user' : 'assistant',
              content: String(turn.content),
            });
          }

          // Trigger : on demande explicitement à l'agent d'intervenir
          const isFirstTurn = localHistory.length === 0;
          messages.push({
            role:    'user',
            content: isFirstTurn
              ? `Le brief vient d'être posé. Ouvre la discussion stratégique en respectant strictement ton rôle de ${agent.name}.`
              : `Interviens maintenant en respectant strictement ton rôle de ${agent.name}. Tiens compte de ce qui vient d'être dit.`,
          });

          // Lance l'inférence Workers AI en streaming
          let aiStream;
          try {
            aiStream = await env.AI.run(MODEL_ID, {
              messages,
              stream:     true,
              max_tokens: MAX_TOKENS,
            });
          } catch (e) {
            send({ type: 'error', agent_id: currentAgentId, message: `AI run failed: ${e?.message || e}` });
            break;
          }

          // Consomme le stream Workers AI ligne par ligne et re-stream
          // en format custom multi-agent
          const reader  = aiStream.getReader();
          const decoder = new TextDecoder('utf-8');
          let   buffer  = '';
          let   fullText = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const chunk = parsed.response ?? parsed.text ?? '';
                if (chunk) {
                  fullText += chunk;
                  send({ type: 'chunk', agent_id: currentAgentId, text: chunk });
                }
              } catch (e) { /* ignore malformed line */ }
            }
          }

          // Fin de message
          send({ type: 'agent_end', agent_id: currentAgentId, full_text: fullText });

          // Ajout à l'historique local pour le prochain tour
          localHistory.push({
            agent_id : currentAgentId,
            content  : fullText,
            timestamp: Date.now(),
          });
          turnsDone++;

          // Conditions d'arrêt
          if (!isAuto) {
            completeReason = 'single';
            break;
          }
          if (turnsDone >= turnsCap) {
            completeReason = 'max_turns';
            break;
          }
          if (shouldAutoPause(localHistory, { maxAgentTurns: turnsCap })) {
            completeReason = 'auto_pause';
            break;
          }
        }

        send({ type: 'complete', reason: completeReason, turns: turnsDone });
      } catch (e) {
        send({ type: 'error', message: `Stream error: ${e?.message || e}` });
      } finally {
        try { controller.close(); } catch (e) { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':                'text/event-stream; charset=utf-8',
      'Cache-Control':               'no-cache',
      'Connection':                  'keep-alive',
      'Access-Control-Allow-Origin': origin,
      'X-Brainstorming-Mode':        cognitive_mode,
      'X-Brainstorming-Agent':       agent_id,
    },
  });
}
