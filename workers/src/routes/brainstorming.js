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
// Sprint 7.4 — Architecture LLM hybride
// ──────────────────────────────────────────────────────────────────
//  MODEL_ID         (Llama 3.1 8B)  → STREAMING multi-agent (8 tours)
//                                      Streaming temps réel mot par mot
//                                      essentiel pour la dictée vocale.
//                                      Gemma 4 KO ici (raisonneur qui
//                                      brûle son budget dans `reasoning`,
//                                      bulles vides, finish_reason length).
//  MODEL_ID_HEAVY   (Gemma 4 26B)   → ONE-SHOT : Synthesizer + insights
//                                      Pas de streaming visible, on a
//                                      le droit d'avoir 3-5s de latence
//                                      pour une réponse JSON riche et
//                                      structurée. Pattern Ghost Writer.
// ──────────────────────────────────────────────────────────────────
const MODEL_ID       = '@cf/meta/llama-3.1-8b-instruct';
const MODEL_ID_HEAVY = '@cf/google/gemma-4-26b-a4b-it';

// Streaming agents — bump à 240 tokens (~190 mots) pour permettre 3
// phrases concrètes au lieu de 2 (Sprint 7.3).
const MAX_TOKENS  = 240;
// Synthesizer (Gemma 4 raisonneur) — 4096 minimum sinon finish_reason
// "length" et content vide (cf. Ghost Writer Phase 1 fix mai 2026).
const MAX_TOKENS_HEAVY_SYNTH    = 4096;
// Insights extraction (Gemma 4) — 4096 obligatoire car raisonneur :
// le bloc `reasoning` interne consomme 1500-3000 tokens avant de
// produire le `content` JSON. Vu en prod 27/05 : panel insights restait
// vide avec 2048 → bump à 4096 (même cap que Synthesizer Sprint 7.4).
const MAX_TOKENS_HEAVY_INSIGHTS = 4096;
const MIN_BRIEF   = 5;
const MAX_BRIEF   = 2000;
const MAX_HISTORY = 40;
// Sprint 7.1 — tour de table complet : 8 agents non-Synthesizer en un cycle
const DEFAULT_MAX_TURNS = 8;
// Sprint 7.3 — passé à 3 phrases pour permettre angle propre + élément
// concret (chiffre/référent/visuel) + implication, au lieu de simple
// validation + paraphrase comme en mai 2026.
const MAX_SENTENCES_PER_TURN = 3;

// ─────────────────────────────────────────────────────────────────
// Sprint 7.3 — AGENT_BEHAVIOR_DIRECTIVES
// ─────────────────────────────────────────────────────────────────
// Force chaque agent à un comportement CONCRET et DIFFÉRENCIÉ. Avant
// Sprint 7.3, les system prompts étaient trop abstraits ("sophistiqué,
// exigeant") → le LLM Llama 3.1 8B faisait du remix paraphrasé d'un
// agent à l'autre. Ici on impose un TYPE D'INTERVENTION précis par tour.
//
// Format : { angle: instruction positive, forbid: anti-pattern spécifique }
// ─────────────────────────────────────────────────────────────────
const AGENT_BEHAVIOR_DIRECTIVES = {
  creative: {
    angle: `Propose UNE idée créative IMAGÉE et NOMMABLE : un visuel précis (la scène, le cadre), une accroche en 5 mots, un nom de campagne, un symbole, un dispositif (ex. "un compteur visible des heures rendues à l'utilisateur"). Pas d'abstraction.`,
    forbid: `INTERDIT : "une campagne qui montre des gens", "des histoires personnelles", "des images émouvantes" — c'est creux. DONNE l'image exacte, la phrase d'accroche, ou le concept en un nom.`,
  },
  growth: {
    angle: `Donne UN levier d'acquisition PRÉCIS sous le format : canal NOMMÉ + mécanisme + KPI chiffré. Exemple : "LinkedIn Ads ciblage CSP+ B2B, CPL visé 35-60€, conversion essai gratuit 4-7%". Sois affirmatif et chiffré.`,
    forbid: `INTERDIT : "créer un canal d'acquisition sur TikTok" sans chiffres, "mécanisme viral pour partager des récompenses" générique, "nous devrions" au conditionnel.`,
  },
  consumer: {
    angle: `Révèle UN insight humain CONTRE-INTUITIF : une contradiction (ce qu'on dit ≠ ce qu'on fait), une frustration que personne ne formule, un comportement observable précis. Format : "ce qu'ils disent vouloir : X. Ce qu'ils font : Y. Donc : Z".`,
    forbid: `INTERDIT : "les gens veulent libérer du temps", "ils se sentent prisonniers" — c'est générique. Cite un comportement OBSERVABLE (clic, abandon, achat, refus).`,
  },
  brand: {
    angle: `IMPOSE UNE règle de cohérence OU REFUSE une proposition précédente qui dilue la marque. Ton AUTORITAIRE et tranchant. Exemple : "Refus du levier gamification — ça abîme le positionnement premium qu'on vise sur le segment décideurs."`,
    forbid: `INTERDIT : "notre identité est basée sur la libération du temps" descriptif. SOIS DIRECTIF. Si quelque chose est brand-toxique, dis-le sans nuance.`,
  },
  cultural: {
    angle: `Cite UN référent culturel précis (compte Twitter/TikTok/LinkedIn nommé, courant Substack, niche Discord, mème en cours, événement) + donne UN TIMING ("on est trop tôt", "fenêtre de 6 mois", "déjà saturé"). Format : "[Référent X] porte cette tension depuis [période] — c'est le moment / trop tard".`,
    forbid: `INTERDIT : "la tendance actuelle des routines", "les utilisateurs partagent" — c'est vague. Nomme un compte/courant/niche SPÉCIFIQUE et son TIMING.`,
  },
  data: {
    angle: `Donne UN ordre de grandeur chiffré APPUYÉ sur un ratio crédible (CAC/LTV, taux conversion SaaS B2B, marge brute, taille marché TAM/SAM/SOM). Si tu ne sais pas, pointe précisément QUELLE hypothèse à fort impact n'est pas vérifiée. Ton froid, neutre, presque cassant.`,
    forbid: `INTERDIT : "500 000 à 1 million d'euros" sortis du chapeau, "selon mes estimations" sans appui. APPUIE chaque chiffre sur un ratio standard du secteur, OU dis "hypothèse non vérifiée à fort impact : X".`,
  },
  devil: {
    angle: `INTERROGE l'argument LE PLUS FAIBLE qui vient d'être posé. Utilise : "Et si l'inverse ?", "Qu'est-ce qui prouve que [X] ?", "On a vu ce pattern 1000 fois, ça finit comment ?", "Cette idée ressemble à [marque concurrente qui a échoué] — pourquoi ce serait différent ?". TU EXISTES POUR CHALLENGER, pas pour valider.`,
    forbid: `INTERDIT : "la difficulté de valider" tiède, validation polie déguisée. ATTAQUE l'hypothèse la plus fragile FRONTALEMENT. Si tout te semble juste, dis "ce consensus est suspect — voici ce qu'on rate".`,
  },
  synth: {
    angle: `Synthèse mini en 2 phrases : (1) "Ce qui émerge clairement : ...", (2) "Ce qui reste à trancher : ...". Aucune opinion personnelle, tu condenses uniquement.`,
    forbid: `INTERDIT : ajouter un avis perso, faire un plan d'actions ici (réservé à la synthèse finale).`,
  },
};

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

// ─────────────────────────────────────────────────────────────────
// Sprint 4 — Consensus & Tension (heuristiques)
// ─────────────────────────────────────────────────────────────────
// Le consensus mesure l'alignement émergent entre les agents :
//   - +0.10 par réaction 💯 ou 🔥 (agent ou user)
//   - -0.08 par réaction 🤔 ou 👀
//   - -0.05 par tour du Devil's Advocate (par construction : challenge)
//   - +0.05 si Synthesizer intervient (par construction : il acte)
//
// La tension mesure l'intensité du désaccord (inverse partiel du consensus
// mais avec une dynamique différente : c'est l'agitation visible).
//
// Sprint 5+ : remplacer par mini-LLM sentiment qui lit le texte.
// Sprint 4 reste heuristique car déjà valuable pour le ressenti.
const REACTIONS_POSITIVE = new Set(['💯', '🔥']);
const REACTIONS_NEGATIVE = new Set(['🤔', '👀']);

// Sprint 7.11 — Renommé conceptuellement "Consensus" → "Avancement".
// L'ancienne formule (base 0.5, Devil -0.05, etc.) ne pouvait jamais
// atteindre 100% car Devil parle obligatoirement (garantie Sprint 7.2)
// et pénalisait mécaniquement le score. Stéphane remontait "Pourquoi
// on n'arrive jamais à 100% après la concertation ?".
//
// Nouvelle formule (progression du tour de table) :
//   - 0% à history vide
//   - +12.5% par AGENT DISTINCT non-Synth qui a parlé (max 90% à 8 agents)
//   - Synthesizer présent (si jamais dans l'history) : +10% bonus
//   - userReactions : ajustement final ±10% max
//
// Devil's Advocate compte comme contribution positive — son challenge
// fait avancer le débat, il n'est plus une pénalité.
function _computeConsensus(history) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  const distinctAgents = new Set();
  let synthSpoke = false;
  let reactionsScore = 0;
  for (const turn of history) {
    if (!turn || !turn.agent_id) continue;
    if (turn.agent_id === 'user') continue;
    if (turn.agent_id === 'synth') synthSpoke = true;
    else distinctAgents.add(turn.agent_id);
    // Sprint 7.8 — pondération userReactions
    if (Array.isArray(turn.userReactions) && turn.userReactions.length > 0) {
      let delta = 0;
      for (const emoji of turn.userReactions) {
        if (REACTIONS_POSITIVE.has(emoji)) delta += 0.04;
        else if (REACTIONS_NEGATIVE.has(emoji)) delta -= 0.03;
      }
      // Cap par tour ±0.08 (pour totaliser max ±10% sur l'ensemble du débat)
      reactionsScore += Math.max(-0.08, Math.min(0.08, delta));
    }
  }
  // 8 agents distincts × 12.5% = 90% (réservons 10% pour les réactions positives)
  const progressScore = Math.min(distinctAgents.size, 8) * (0.9 / 8);
  const synthBonus = synthSpoke ? 0.1 : 0;
  // Cap réactions ±10% sur le score global
  const reactionsAdjusted = Math.max(-0.1, Math.min(0.1, reactionsScore));
  return Math.max(0, Math.min(1, progressScore + synthBonus + reactionsAdjusted));
}

function _computeTension(history) {
  if (!Array.isArray(history) || history.length < 2) return 0;
  let tension = 0;
  const last3 = history.slice(-3);
  for (const t of last3) {
    if (t?.agent_id === 'devil') tension += 0.25;
    if (t?.agent_id === 'data')  tension += 0.10;  // rationnel = friction douce
  }
  return Math.max(0, Math.min(1, tension));
}

// ─────────────────────────────────────────────────────────────────
// Sprint 4 — Extraction des insights émergents (Llama 3.1 light call)
// ─────────────────────────────────────────────────────────────────
// Après le complete d'un cycle, on lance UN call LLM séparé qui condense
// la discussion en 2-3 insights courts (~10 mots chacun). Affichés
// dans la card "Points clés émergents" du right panel.
//
// Format de réponse attendu : JSON {"insights": ["...", "...", "..."]}.
// Le LLM tend à ne pas respecter le JSON strict — on prévoit un parser
// défensif qui regex-extrait des bullets si le JSON est mal formé.
const INSIGHTS_PROMPT = `Tu es un assistant d'extraction d'insights stratégiques.

À partir du dialogue ci-dessous (brainstorming entre personnalités IA spécialisées), identifie 2 à 3 POINTS CLÉS ÉMERGENTS — les insights stratégiques majeurs qui ressortent du débat.

CONTRAINTES STRICTES
- 2 ou 3 insights MAXIMUM.
- Chaque insight = 1 phrase de 8 à 14 mots.
- Pas de "il faut", pas de "on devrait" — formule comme des constats stratégiques.
- Pas de paraphrase d'un seul agent — capture ce qui ÉMERGE de l'échange.
- Sortie JSON STRICT : {"insights": ["...", "...", "..."]}
- AUCUN texte avant ou après le JSON.`;

// ─────────────────────────────────────────────────────────────────
// Sprint 5 — Synthesizer : Plan d'actions structuré
// ─────────────────────────────────────────────────────────────────
// Sur demande explicite du client (POST /api/brainstorming/synthesize),
// on génère un JSON complet avec positionnement, opportunités, risques,
// plan d'actions daté. Exporté en PDF côté frontend.
const SYNTHESIZER_PROMPT = `Tu es Synthesizer, l'agent de conclusion stratégique du brainstorming AI Keystone.

Ta mission UNIQUE est de transformer le débat ci-dessous en un PLAN D'ACTIONS structuré et exécutable.

CONTRAINTES DE FORMAT STRICTES
- Sortie JSON STRICT, AUCUN texte avant ou après.
- Schema EXACT :
  {
    "positioning": "<1 phrase de 15-25 mots résumant le positionnement émergent>",
    "opportunities": ["<10-15 mots>", "<10-15 mots>", "<10-15 mots>"],
    "risks": ["<10-15 mots>", "<10-15 mots>"],
    "next_actions": [
      { "action": "<8-12 mots, verbe d'action>", "deadline": "YYYY-MM-DD" },
      { "action": "<...>", "deadline": "YYYY-MM-DD" },
      { "action": "<...>", "deadline": "YYYY-MM-DD" }
    ]
  }
- 3 opportunities, 2 risks, 3 next_actions.
- Deadlines RÉALISTES : entre J+7 et J+90 par rapport à aujourd'hui.
- Pas de jargon corporate, pas de "synergie", pas de "leverage".
- Ton EXÉCUTIF (note pour direction marketing, pas pour étudiant).`;

// Sprint 7.9 — Sanitization soft d'une synthèse parsée (Claude ou Gemma)
function _normalizeSynthesis(parsed) {
  return {
    positioning:   typeof parsed.positioning === 'string' ? parsed.positioning : '',
    opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.slice(0, 4).map(String) : [],
    risks:         Array.isArray(parsed.risks)         ? parsed.risks.slice(0, 3).map(String)         : [],
    next_actions:  Array.isArray(parsed.next_actions)
      ? parsed.next_actions.slice(0, 4).map(a => ({
          action:   typeof a?.action === 'string' ? a.action : '',
          deadline: typeof a?.deadline === 'string' ? a.deadline : '',
        })).filter(a => a.action)
      : [],
  };
}

// Sprint 7.9 — Synthèse via Claude (BYOK). Plus de profondeur stratégique
// que Gemma 4 pour le boardroom premium. Fetch direct Anthropic API.
// Pattern repris de proxy-llm.js (_proxyAnthropic).
async function _generateSynthesisClaude(apiKey, brief, history, todayIso) {
  const dialogue = history
    .filter(t => t?.agent_id && t.agent_id !== 'user' && t.content)
    .map(t => `[${getAgent(t.agent_id)?.name || t.agent_id}] ${t.content}`)
    .join('\n\n');
  if (!dialogue || dialogue.length < 50) {
    return { error: 'Discussion trop courte pour une synthèse (au moins 2 tours requis)' };
  }

  const userMsg = `DATE DU JOUR : ${todayIso}\n\nBRIEF INITIAL : ${brief}\n\nDIALOGUE INTÉGRAL DU BRAINSTORMING :\n${dialogue}\n\nProduis le JSON Plan d'actions strict, sans préambule.`;

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key'        : apiKey,
        'anthropic-version': '2023-06-01',
        'content-type'     : 'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5-20250929',
        system:     SYNTHESIZER_PROMPT,
        messages:   [{ role: 'user', content: userMsg }],
        max_tokens: 2000,
      }),
    });
  } catch (e) {
    return { error: `Claude API network error: ${e.message}` };
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || ''; } catch (_) {}
    return { error: `Claude API HTTP ${res.status}${detail ? ' — ' + detail : ''}` };
  }

  const data = await res.json();
  // Anthropic Messages API : { content: [{ type: 'text', text: '...' }] }
  const raw = (data?.content?.[0]?.text || '').trim();
  if (!raw) return { error: 'Réponse Claude vide' };

  let parsed;
  try {
    const m = raw.match(/\{[\s\S]*"positioning"[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch (e) { /* fallback */ }
  if (!parsed) {
    return { error: 'Synthèse Claude non parsable', raw: raw.slice(0, 500) };
  }
  return _normalizeSynthesis(parsed);
}

async function _generateSynthesis(env, brief, history, todayIso) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    return { error: 'Workers AI non disponible' };
  }
  const dialogue = history
    .filter(t => t?.agent_id && t.agent_id !== 'user' && t.content)
    .map(t => `[${getAgent(t.agent_id)?.name || t.agent_id}] ${t.content}`)
    .join('\n\n');
  if (!dialogue || dialogue.length < 50) {
    return { error: 'Discussion trop courte pour une synthèse (au moins 2 tours requis)' };
  }

  try {
    // Sprint 7.4 — Synthesizer bascule sur Gemma 4 26B (raisonneur, riche
    // pour la structuration JSON). max_tokens=4096 obligatoire sinon
    // finish_reason="length" et content vide.
    const res = await env.AI.run(MODEL_ID_HEAVY, {
      messages: [
        { role: 'system', content: SYNTHESIZER_PROMPT },
        { role: 'user',   content: `DATE DU JOUR : ${todayIso}\n\nBRIEF INITIAL : ${brief}\n\nDIALOGUE INTÉGRAL DU BRAINSTORMING :\n${dialogue}\n\nProduis le JSON Plan d'actions strict.` },
      ],
      max_tokens: MAX_TOKENS_HEAVY_SYNTH,
      stream:     false,
    });
    // Détection budget tokens épuisé en reasoning (cf. Ghost Writer)
    const choice0 = res?.choices?.[0];
    if (choice0?.finish_reason === 'length' && !choice0?.message?.content) {
      return { error: 'Gemma 4 a épuisé son budget tokens en mode raisonnement. Relancez la synthèse.' };
    }
    // Extraction multi-format (Gemma 4 peut renvoyer 4 wrappings)
    const raw = (res?.response
      || res?.result?.response
      || res?.choices?.[0]?.message?.content
      || res?.output?.[0]?.content?.[0]?.text
      || '').trim();
    // Parse JSON strict avec fallback regex
    let parsed;
    try {
      const m = raw.match(/\{[\s\S]*"positioning"[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch (e) { /* fallback below */ }
    if (!parsed) {
      return { error: 'Synthèse non parsable. Veuillez relancer.', raw: raw.slice(0, 500) };
    }
    return _normalizeSynthesis(parsed);
  } catch (e) {
    return { error: `Erreur génération : ${e?.message || e}` };
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /api/brainstorming/synthesize
// ─────────────────────────────────────────────────────────────────
export async function handleBrainstormingSynthesize(request, env) {
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

  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') return err('Body JSON requis', 400, origin);

  const { brief, history = [], engine, apiKey } = body;
  if (typeof brief !== 'string' || brief.trim().length < MIN_BRIEF) {
    return err(`brief requis (${MIN_BRIEF} caractères min)`, 400, origin);
  }
  if (!Array.isArray(history) || history.length < 2) {
    return err('history requis (au moins 2 tours)', 400, origin);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  // Sprint 7.9 — Routage BYOK Claude. Si engine='claude' + apiKey fourni,
  // on appelle Claude Sonnet via Anthropic API directe (synthèse premium).
  // Sinon fallback Gemma 4 26B (Sprint 7.4) qui reste excellent.
  let synthesis;
  let engineUsed = 'gemma';
  if (engine === 'claude' && typeof apiKey === 'string' && apiKey.length > 10) {
    synthesis = await _generateSynthesisClaude(apiKey, brief, history, todayIso);
    engineUsed = 'claude';
    // En cas d'échec Claude (clé invalide, quota...), fallback transparent sur Gemma
    if (synthesis.error) {
      const claudeErr = synthesis.error;
      synthesis = await _generateSynthesis(env, brief, history, todayIso);
      engineUsed = 'gemma-fallback';
      if (synthesis.error) {
        return json({ error: `Claude KO (${claudeErr}) + Gemma KO (${synthesis.error})`, raw: synthesis.raw }, 422, origin);
      }
    }
  } else {
    synthesis = await _generateSynthesis(env, brief, history, todayIso);
  }

  if (synthesis.error) {
    return json({ error: synthesis.error, raw: synthesis.raw }, 422, origin);
  }
  return json({ synthesis, generated_at: new Date().toISOString(), engine: engineUsed }, 200, origin);
}

// Sprint 7.12 — Parse défensif d'une réponse LLM en JSON insights
function _parseInsightsFromText(raw) {
  if (!raw) return [];
  // Tentative 1 : parse JSON strict
  try {
    const m = raw.match(/\{[\s\S]*"insights"[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed.insights)) {
        return parsed.insights.filter(s => typeof s === 'string' && s.length > 5).slice(0, 3);
      }
    }
  } catch (e) { /* fallback */ }
  // Tentative 2 : regex sur les bullets / lignes
  const lines = raw.split(/[\n•\-]+/)
    .map(s => s.replace(/^["'\s]+|["'\s,.]+$/g, '').trim())
    .filter(s => s.length > 10 && s.length < 140);
  return lines.slice(0, 3);
}

async function _extractInsights(env, brief, history) {
  if (!env.AI || typeof env.AI.run !== 'function') return [];
  // Sprint 7.12 — capture tout le tour de table (8 agents) au lieu des 6 derniers
  const dialogue = history
    .filter(t => t?.agent_id && t.agent_id !== 'user' && t.content)
    .slice(-9)
    .map(t => `[${getAgent(t.agent_id)?.name || t.agent_id}] ${t.content}`)
    .join('\n\n');
  if (!dialogue) return [];

  // Tentative 1 : Gemma 4 26B (richesse analytique max_tokens=4096)
  try {
    const res = await env.AI.run(MODEL_ID_HEAVY, {
      messages: [
        { role: 'system', content: INSIGHTS_PROMPT },
        { role: 'user',   content: `BRIEF : ${brief}\n\nDIALOGUE :\n${dialogue}\n\nExtrais 2-3 insights stratégiques au format JSON strict.` },
      ],
      max_tokens: MAX_TOKENS_HEAVY_INSIGHTS,
      stream:     false,
    });
    const choice0 = res?.choices?.[0];
    const gemmaLengthExhausted = choice0?.finish_reason === 'length' && !choice0?.message?.content;
    if (!gemmaLengthExhausted) {
      const raw = (res?.response
        || res?.result?.response
        || res?.choices?.[0]?.message?.content
        || res?.output?.[0]?.content?.[0]?.text
        || '').trim();
      const parsed = _parseInsightsFromText(raw);
      if (parsed.length > 0) return parsed;
    }
    // Si Gemma a renvoyé vide ou tronqué, on fallback sur Llama 8B
    try { console.log('[insights] Gemma KO ou vide, fallback Llama 8B'); } catch (_) {}
  } catch (e) {
    try { console.log('[insights] Gemma exception, fallback Llama:', e?.message || e); } catch (_) {}
  }

  // Tentative 2 : Llama 3.1 8B fallback (qualité moindre mais visible)
  try {
    const res = await env.AI.run(MODEL_ID, {
      messages: [
        { role: 'system', content: INSIGHTS_PROMPT },
        { role: 'user',   content: `BRIEF : ${brief}\n\nDIALOGUE :\n${dialogue}\n\nExtrais 2-3 insights stratégiques au format JSON strict.` },
      ],
      max_tokens: 400,
      stream:     false,
    });
    const raw = (res?.response
      || res?.result?.response
      || res?.choices?.[0]?.message?.content
      || '').trim();
    return _parseInsightsFromText(raw);
  } catch (e) {
    try { console.log('[insights] Llama fallback exception:', e?.message || e); } catch (_) {}
    return [];
  }
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
  // Sprint 7.1 — cap relevé à 10 pour permettre un tour de table complet (8) + marge
  const turnsCap = Math.max(1, Math.min(10, Number(max_turns) || DEFAULT_MAX_TURNS));

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

          // Sprint 7.3 — Différenciation forte par agent + interdiction des
          // amorces creuses + obligation de friction. Cf. AGENT_BEHAVIOR_DIRECTIVES.
          const isFirstTurn = localHistory.length === 0;
          const isStrategic = currentAgentId === 'strategic';
          let triggerContent;
          if (isFirstTurn) {
            triggerContent = `Le brief vient d'être posé. OUVRE la discussion en MAX 3 PHRASES.
- Phrase 1 : RE-FORMULE l'enjeu en gardant les TERMES CONCRETS du brief (produit, audience, objectif). Ne dérive pas vers de la généralité.
- Phrase 2 : Identifie UN angle stratégique non-évident à explorer en priorité.
- Phrase 3 : Pose UNE question stratégique précise qui appelle un type d'expertise (ex. "où se cache l'audience qui paierait DÈS LE PREMIER JOUR ?", "quel angle marque résiste à 5 ans ?").
- INTERDIT : citer un agent par son nom, généraliser le brief, "Bonjour", "Excellente question".`;
          } else if (isStrategic) {
            triggerContent = `Tu interviens comme Strategic Lead pour RE-CADRER après un échange. CONTRAINTES :
- MAX 3 phrases.
- Phrase 1 : POINTE LA TENSION qui émerge (ex. "Deux directions se dessinent : X vs Y").
- Phrase 2 : ARBITRE ou tranche : laquelle prioriser et pourquoi.
- Phrase 3 : Pose UNE question précise qui ouvre l'étape suivante.
- INTERDIT : citer un agent par son nom, "X a raison", validation polie, résumé creux.`;
          } else {
            const directive = AGENT_BEHAVIOR_DIRECTIVES[currentAgentId] || { angle: 'apporte ton angle propre', forbid: '' };
            triggerContent = `Tu interviens comme ${agent.name} (${agent.role}). CONTRAINTES ABSOLUES :

MAX 3 PHRASES (90 mots TOTAL). Pas de salutation, pas de résumé, pas de liste à puces.

INTERVENTION ATTENDUE — TON RÔLE PRÉCIS CE TOUR
${directive.angle}
${directive.forbid ? '\n' + directive.forbid : ''}

INTERDICTIONS DE FORMULATION (le post-process serveur tronque ou rejette sinon)
- JAMAIS commencer par "Ce qui vient d'être dit", "Cela me fait penser", "Cela me rappelle", "Je propose de", "Nous devrions", "Nous pourrions". Démarre par TON ANGLE concret.
- JAMAIS nommer un autre agent. Pas de "X a raison", pas de "Je rejoins Y", pas de "Comme Z l'a dit".
- JAMAIS valider poliment le précédent. Si tu es d'accord, ENRICHIS d'un élément neuf. Si tu n'es pas d'accord, CONTREDIS frontalement.
- JAMAIS paraphraser le précédent — apporte UN ÉLÉMENT QUI N'A PAS ÉTÉ DIT.

POSTURE
- Tu peux CONTREDIRE ("Pas d'accord, l'angle X ignore Y").
- Tu peux PIVOTER ("Le vrai sujet n'est pas X mais Y").
- Tu peux RADICALISER ("Pousser plus loin : Z").
- Tu DOIS apporter du CONCRET : un chiffre, un référent nommé, un visuel précis, une hypothèse falsifiable.`;
          }
          messages.push({ role: 'user', content: triggerContent });

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

          // Sprint 4 — Update des signaux (consensus + tension)
          send({
            type: 'signals_update',
            consensus: _computeConsensus(localHistory),
            tension:   _computeTension(localHistory),
            turns_done: turnsDone,
            turns_total: turnsCap,
          });

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

        // Sprint 4 — Extraction des insights émergents en background.
        // Sprint 7.11 — DOIT être envoyé AVANT l'event 'complete' : le
        // frontend exit sa boucle SSE dès qu'il reçoit 'complete', donc
        // tout event envoyé après est ignoré côté client.
        if (turnsDone >= 2) {
          try {
            const insights = await _extractInsights(env, brief, localHistory);
            if (insights.length > 0) {
              send({ type: 'insights_update', items: insights });
            }
          } catch (e) { /* silencieux : extraction non-critique */ }
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
