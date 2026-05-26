/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — AI War Room (Brainstorming V2) — Sprint 1
   Layer 2 · Backend des 9 agents stratégiques (Cloudflare Workers AI)
   ─────────────────────────────────────────────────────────────────

   Route exposée :
     POST /api/brainstorming/agent-respond
     Body : { agent_id, brief, cognitive_mode, history }
     Auth : JWT licence requise.
     Réponse : stream SSE de la réponse de l'agent.

   Sprint 1 : seul agent_id = "strategic" est actif. Les 8 autres
   retournent 501 (Not Implemented) — activation Sprint 2.

   LLM choisi : Gemma 4 26B A4B sur Cloudflare Workers AI (gratuit,
   ~10K neurones/jour). Sprint 2 ajoutera le routing BYOK Claude
   pour Strategic Lead + Synthesizer (qualité critique).

   max_tokens = 4096 obligatoire (Gemma 4 raisonneur — vu sur
   Ghost Writer + Living Layer, brûle son budget dans `reasoning`
   avant de produire `content`).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { getAgent, getAgentNamesForPrompt } from '../lib/brainstorming-agents.js';

const MODEL_ID    = '@cf/google/gemma-4-26b-a4b-it';
const MAX_TOKENS  = 4096;
const MIN_BRIEF   = 5;
const MAX_BRIEF   = 2000;
const MAX_HISTORY = 40;     // garde-fou : pas plus de 40 tours

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

  // ── Auth obligatoire (JWT licence) ──────────────────────────
  const claims = await requireJWT(request, env);
  if (!claims) {
    return err('Authentification requise', 401, origin);
  }

  // ── Parse body ──────────────────────────────────────────────
  const body = await parseBody(request);
  if (!body || typeof body !== 'object') {
    return err('Body JSON requis', 400, origin);
  }

  const {
    agent_id,
    brief,
    cognitive_mode = 'exploration',
    history = [],
  } = body;

  // ── Validation ──────────────────────────────────────────────
  if (!agent_id || typeof agent_id !== 'string') {
    return err('agent_id requis', 400, origin);
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

  // Sprint 1 : seul Strategic Lead supporté
  if (agent_id !== 'strategic') {
    return err(
      `Sprint 1 : seul l'agent "strategic" est actif (reçu : ${agent_id}). ` +
      `Sprint 2 ajoutera l'orchestration multi-agent.`,
      501, origin
    );
  }

  const agent = getAgent(agent_id);
  if (!agent) {
    return err(`Agent inconnu : ${agent_id}`, 400, origin);
  }

  // ── Workers AI disponible ? ─────────────────────────────────
  if (!env.AI || typeof env.AI.run !== 'function') {
    return err(
      'Workers AI non disponible. Vérifier wrangler.toml : [ai] binding = "AI".',
      503, origin
    );
  }

  // ── Construction des messages ───────────────────────────────
  const agentList    = getAgentNamesForPrompt(agent_id);
  const systemPrompt = agent.systemPrompt(cognitive_mode, brief, agentList);

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // Replay de l'historique (Sprint 1 : court généralement)
  for (const turn of history) {
    if (!turn || !turn.content) continue;
    messages.push({
      role:    turn.agent_id === 'user' ? 'user' : 'assistant',
      content: String(turn.content),
    });
  }

  // Trigger : on demande explicitement à l'agent d'intervenir maintenant.
  // Sprint 1 : si c'est le tout premier tour, on lui dit d'OUVRIR la
  // discussion ; sinon c'est une intervention en cours.
  const isFirstTurn = history.length === 0;
  messages.push({
    role:    'user',
    content: isFirstTurn
      ? `Le brief vient d'être posé. Ouvre la discussion stratégique en respectant strictement ton rôle de Strategic Lead.`
      : `Interviens maintenant en respectant strictement ton rôle de Strategic Lead. Tiens compte de ce qui vient d'être dit.`,
  });

  // ── Workers AI streaming ────────────────────────────────────
  let stream;
  try {
    stream = await env.AI.run(MODEL_ID, {
      messages,
      stream:     true,
      max_tokens: MAX_TOKENS,
    });
  } catch (e) {
    return err(`Erreur Workers AI : ${e?.message || e}`, 500, origin);
  }

  // Workers AI retourne déjà un ReadableStream au format SSE.
  // On le forwarde tel quel au client.
  return new Response(stream, {
    headers: {
      'Content-Type':                 'text/event-stream; charset=utf-8',
      'Cache-Control':                'no-cache',
      'Connection':                   'keep-alive',
      'Access-Control-Allow-Origin':  origin,
      'X-Brainstorming-Agent':        agent_id,
      'X-Brainstorming-Mode':         cognitive_mode,
    },
  });
}
