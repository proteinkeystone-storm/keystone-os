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

// Sprint 2 fix v3 (26/05/2026 soir) — switch Llama 3.3 fp8-fast → Llama 3.1 8B.
// Pourquoi : Llama 3.3 70B en fp8-fast sortait un artefact alphabétique
// après son EOT token ("abdefghijklmnoprstuvxyz1234") — bug connu de la
// quantization fp8 sur cette taille. Llama 3.1 8B est plus stable, plus
// petit, plus rapide, et largement suffisant pour des répliques courtes
// 2 phrases. Multilingue FR natif.
const MODEL_ID    = '@cf/meta/llama-3.1-8b-instruct';
const MAX_TOKENS  = 180;     // ~150 mots max — force court et concis
const MIN_BRIEF   = 5;
const MAX_BRIEF   = 2000;
const MAX_HISTORY = 40;
const DEFAULT_MAX_TURNS = 3;
const MAX_SENTENCES_PER_TURN = 2;   // post-process : on coupe à 2 phrases max

// Strip les artefacts alphabétiques de fin (Llama 3.3 fp8 bug), au cas
// où le modèle continue de générer. Pattern : ≥ 6 lettres minuscules
// consécutives en fin de réponse, optionnellement suivies de digits.
const _ALPHA_GIBBERISH_RE = /[a-z]{6,}\d{0,6}[\s.,;:!?]*$/i;

function _stripAlphaGibberish(text) {
  if (!text) return text;
  // On retire d'éventuels suffixes d'alphabet, mais on protège les vrais
  // mots français (qui font rarement ≥ 6 lettres consécutives en fin de
  // phrase sans suivi de ponctuation ou espace AVANT le mot).
  // Heuristique : si on a une vraie phrase, le dernier mot est suivi de
  // ponctuation. L'alphabet bizarre n'a PAS d'espace avant — il colle
  // direct au dernier caractère du texte légitime. Donc on cherche le
  // pattern collé "[mot.] + alphabet".
  return text.replace(/([\s.!?;:,])([a-z]{6,}\d{0,6})\s*$/i, '$1').trim();
}

// Post-process : coupe à N phrases max (Llama ignore les contraintes
// de format dans le prompt — on les enforce ici).
function _capSentences(text, maxN = MAX_SENTENCES_PER_TURN) {
  if (!text) return text;
  // Split sur ponctuation forte suivie d'espace ou fin
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts || parts.length <= maxN) return text.trim();
  return parts.slice(0, maxN).join(' ').trim();
}

// ─────────────────────────────────────────────────────────────────
// Sprint 3 — Génération de réactions emoji entre agents
// ─────────────────────────────────────────────────────────────────
// À chaque tour, un agent a ~35% de chance de poser une réaction sur
// le message qui vient d'être prononcé. Donne le ressenti d'une vraie
// table où les gens hochent / lèvent un sourcil. Choix d'emoji pondéré
// selon la personnalité du réacteur.
//
// Sprint 3 : probabilité fixe + choix dans set fini.
// Sprint 4+ : pondération selon sentiment du message + état consensus.
const REACTION_PROBABILITY = 0.35;
const REACTION_PALETTE = {
  // Par défaut : tout le monde a accès aux 4
  default : ['💯', '🔥', '🤔', '👀'],
  // Surcharge par agent (personnalité)
  devil   : ['🤔', '👀', '🤔'],            // Devil's Advocate plus sceptique
  data    : ['🤔', '👀', '👀'],            // Data Analyst plus sceptique
  creative: ['🔥', '💯', '🔥'],            // Creative Director s'enthousiasme
  growth  : ['🔥', '💯'],                  // Growth Hacker valide les leviers
  synth   : ['💯', '💯'],                  // Synthesizer note l'accord
};

function _maybeGenerateReaction(reactorAgentId, previousTurn) {
  if (!previousTurn || previousTurn.agent_id === 'user') return null;
  if (previousTurn.agent_id === reactorAgentId) return null;
  if (Math.random() > REACTION_PROBABILITY) return null;
  const palette = REACTION_PALETTE[reactorAgentId] || REACTION_PALETTE.default;
  const emoji = palette[Math.floor(Math.random() * palette.length)];
  return { emoji, target_agent_id: previousTurn.agent_id };
}
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

          // Construction des messages pour le LLM
          // Trouver le dernier intervenant (hors user) pour forcer la réaction
          const previousTurn = [...localHistory].reverse().find(t => t && t.agent_id && t.agent_id !== 'user') || null;
          const previousAgent = previousTurn ? getAgent(previousTurn.agent_id) : null;

          // Sprint 3 — Réaction emoji éventuelle sur le message précédent
          // (envoyée AVANT agent_start pour que le frontend ait le temps
          // de l'afficher avant que la nouvelle bulle apparaisse)
          const reaction = _maybeGenerateReaction(currentAgentId, previousTurn);
          if (reaction) {
            send({
              type: 'agent_react',
              agent_id: currentAgentId,
              target_agent_id: reaction.target_agent_id,
              emoji: reaction.emoji,
            });
          }

          // Annonce le début du message de l'agent
          send({ type: 'agent_start', agent_id: currentAgentId });

          const agentList    = getAgentNamesForPrompt(currentAgentId);
          const systemPrompt = agent.systemPrompt(cognitive_mode, brief, agentList, previousTurn, previousAgent);

          const messages = [{ role: 'system', content: systemPrompt }];
          // On donne au LLM uniquement les 3 derniers tours (sinon il
          // se disperse) — la réaction au précédent est forcée via
          // le system prompt.
          const recent = localHistory.slice(-3);
          for (const turn of recent) {
            if (!turn || !turn.content) continue;
            messages.push({
              role:    turn.agent_id === 'user' ? 'user' : 'assistant',
              content: turn.agent_id === 'user'
                ? String(turn.content)
                : `[${getAgent(turn.agent_id)?.name || turn.agent_id}] ${String(turn.content)}`,
            });
          }

          // Trigger : on force la brièveté + la réaction explicite
          const isFirstTurn = localHistory.length === 0;
          messages.push({
            role:    'user',
            content: isFirstTurn
              ? `Le brief vient d'être posé. OUVRE la discussion en MAX 2 PHRASES COURTES. Cadre l'angle stratégique majeur et invite UN agent spécifique à réagir.`
              : `Tu interviens MAINTENANT comme ${agent.name}. CONTRAINTES STRICTES :\n- MAX 2 phrases courtes (60 mots TOTAL).\n- RÉAGIS d'abord à ce que ${previousAgent?.name || 'l\'intervenant précédent'} vient de dire (cite-le ou rebondis explicitement).\n- ENSUITE seulement, apporte ton angle propre depuis ton rôle.\n- PAS de salutation, PAS de résumé, PAS de liste à puces.`,
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
          // en format custom multi-agent.
          // Note formats : Llama 3.3 envoie {response:"..."} par chunk.
          // On garde un fallback large pour absorber d'autres formats
          // (au cas où Cloudflare change le wrapping selon le modèle).
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
                // Fallback agressif pour récupérer le texte quelle que
                // soit la structure (OpenAI-like, Anthropic-like, etc.)
                const chunk =
                  parsed.response                         ??  // Workers AI standard
                  parsed.text                             ??  // Anthropic legacy
                  parsed.choices?.[0]?.delta?.content     ??  // OpenAI
                  parsed.delta?.text                      ??  // Anthropic stream
                  parsed.p                                ??  // Workers AI compact
                  '';
                if (chunk) {
                  fullText += chunk;
                  send({ type: 'chunk', agent_id: currentAgentId, text: chunk });
                }
              } catch (e) { /* ignore malformed line */ }
            }
          }

          // Post-process : strip alphabet gibberish + cap 2 phrases
          let cleanedText = _stripAlphaGibberish(fullText);
          cleanedText = _capSentences(cleanedText, MAX_SENTENCES_PER_TURN);

          // Fin de message — envoie le texte propre comme full_text
          // (le frontend appendera le delta si différence avec ce que
          // les chunks ont accumulé)
          send({ type: 'agent_end', agent_id: currentAgentId, full_text: cleanedText });

          // Ajout à l'historique local pour le prochain tour
          localHistory.push({
            agent_id : currentAgentId,
            content  : cleanedText,
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
