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
import { getAgent, getAgentNamesForPrompt, normalizeDebateRoster } from '../lib/brainstorming-agents.js';
import { pickNextAgent, shouldAutoPause } from '../lib/brainstorming-orchestrator.js';
import { KS_AI_MODEL } from '../lib/ai-model.js';
import { budgetGuard, recordUsage, estimateTokens, isThrottled } from '../lib/ai-budget.js';
import { isEnforceEnabled, consumeCredits } from '../lib/ai-credits.js';
import { callLLM, byokRoutingEnabled } from '../lib/llm-router.js';
import { streamLLM } from '../lib/llm-stream.js';

// Sprint 2 fix v3 (26/05/2026 soir) — switch Llama 3.3 fp8-fast → Llama 3.1 8B.
// Pourquoi : Llama 3.3 70B en fp8-fast sortait un artefact alphabétique
// après son EOT token ("abdefghijklmnoprstuvxyz1234") — bug connu de la
// quantization fp8 sur cette taille. Llama 3.1 8B est plus stable, plus
// petit, plus rapide, et largement suffisant pour des répliques courtes
// 2 phrases. Multilingue FR natif.
// Sprint 7.4 — Architecture LLM hybride
// ──────────────────────────────────────────────────────────────────
//  Depuis le 2026-05-29, les DEUX usages tournent sur le même moteur
//  unique Keystone (Mistral Small 3.1, cf. lib/ai-model.js) :
//  MODEL_ID         → STREAMING multi-agent (8 tours). Mistral streame
//                     proprement, sans préambule de raisonnement — exit
//                     le piège Gemma 4 (raisonneur, bulles vides).
//  MODEL_ID_HEAVY   → ONE-SHOT : Synthesizer + insights (JSON riche).
//                     Même modèle ; on garde la constante distincte car
//                     l'usage diffère (latence/max_tokens), pas le moteur.
//  (Les agents premium Claude Sonnet/Haiku BYOK restent gérés à part.)
// ──────────────────────────────────────────────────────────────────
const MODEL_ID       = KS_AI_MODEL;
const MODEL_ID_HEAVY = KS_AI_MODEL;

// ── Agent premium sur Claude Haiku (BYOK, 2026-05-28) ─────────────
// Le Devil's Advocate est l'agent dont le caractère porte le plus le
// débat (friction, contradiction). Le moteur de base le rend parfois mou.
// Si l'utilisateur a posé sa clé Anthropic (Vault), CE seul agent passe
// sur Claude Haiku 4.5 en streaming → contradictions incisives et nuancées.
// Les 8 autres restent sur MODEL_ID (= Mistral Small 3.1 24B depuis le
// 2026-05-29, cf. lib/ai-model.js). Fallback transparent sur MODEL_ID si
// pas de clé Anthropic ou si Claude échoue.
const PREMIUM_AGENT_ID      = 'devil';
const BRAINSTORM_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

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
// Source fournie par l'utilisateur (chaîne de contenu) — bornée AVANT injection
// dans le débat : elle est répétée dans le prompt système de chaque agent, donc
// on la garde compacte (les 8 agents × tours). Le moteur étant Mistral/Cloudflare
// (gratuit, capé au compteur), c'est une limite de pertinence, pas de coût €.
const SOURCE_INJECT_MAX = 2500;
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

// Strip les artefacts de fin de génération (les modèles Workers AI
// continuent parfois d'émettre des tokens parasites après la vraie
// réponse). Deux signatures rencontrées, deux passes — volontairement
// AGNOSTIQUE du modèle (le moteur Keystone peut changer, cf. lib/ai-model.js) :
//   - lettres pures : suffixe de ≥ 6 lettres minuscules (ancien mix Llama 3.3 fp8).
//   - alphanumérique entrelacé : queue "base36" lettres+chiffres mêlés collée
//     à la ponctuation finale, ex. "Pulse".mpk0ef46zhyl (vu sur le moteur
//     actuel Mistral Small 3.1 24B).
const _ALPHA_GIBBERISH_RE = /[a-z]{6,}\d{0,6}[\s.,;:!?]*$/i;

function _stripAlphaGibberish(text) {
  if (!text) return text;
  // Heuristique commune : la vraie phrase se termine par de la ponctuation.
  // Le parasite colle DIRECT derrière ce séparateur final, sans espace. On
  // ne touche donc qu'un token collé en toute fin de texte, jamais le corps.

  // Passe 1 — ancien bug Llama 3.3 fp8 : ≥ 6 lettres pures (+ digits).
  let out = text.replace(/([\s.!?;:,"'’»)\]])([a-z]{6,}\d{0,6})\s*$/i, '$1');

  // Passe 2 — queue alphanumérique entrelacée (vue sur Mistral Small 3.1 24B) :
  // token minuscule ≥ 10 chars mélangeant lettres ET chiffres. Un vrai mot
  // français ne contient jamais
  // de chiffre → exiger les deux classes rend le faux positif quasi nul
  // (années, "Web3", codes à tirets… restent intacts). Sensible à la casse :
  // les noms propres "Title-Cased" ont une majuscule et ne matchent pas.
  out = out.replace(/([\s.!?;:,"'’»)\]])([a-z0-9]{10,})\s*$/, (m, sep, blob) =>
    (/[a-z]/.test(blob) && /\d/.test(blob)) ? sep : m
  );

  return out.trim();
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
function _computeConsensus(history, rosterN = 8) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  const distinctAgents = new Set();
  let reactionsScore = 0;
  for (const turn of history) {
    if (!turn || !turn.agent_id) continue;
    if (turn.agent_id === 'user') continue;
    if (turn.agent_id !== 'synth') distinctAgents.add(turn.agent_id);
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
  // Sprint 7.12 — un tour de table COMPLET = 100% (rester bloqué à 90% prêtait
  // à confusion). progressScore atteint 1.0 quand tous les agents du comité ont
  // parlé. Les réactions ne sont qu'une nuance PENDANT la montée : une fois le
  // tour bouclé, on affiche 100% net.
  // rosterN = nb d'agents de débat du comité actif (8 par défaut / legacy).
  const N = Math.max(1, rosterN || 8);
  const progressScore = Math.min(distinctAgents.size, N) / N;
  if (progressScore >= 1) return 1;
  const reactionsAdjusted = Math.max(-0.1, Math.min(0.1, reactionsScore));
  return Math.max(0, Math.min(1, progressScore + reactionsAdjusted));
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
const SYNTHESIZER_PROMPT = `Tu es Synthesizer, l'agent de conclusion du brainstorming AI Keystone.

Ta mission : transformer le débat en une conclusion qui RÉPOND DIRECTEMENT à la demande du brief. Une synthèse qui ne répond pas à la question posée est un échec.

Tu parles EN DERNIER, une fois que toute l'équipe s'est exprimée : exploite la matière de TOUS les agents (pas seulement les derniers messages). Récupère chaque candidat, chaque angle, chaque objection valable qui a émergé.

ÉTAPE 1 — IDENTIFIE LE TYPE DE DEMANDE
- Si le brief demande un LIVRABLE GÉNÉRATIF (trouver un NOM, un slogan, une accroche, un baseline, une liste d'IDÉES, des options à départager…) → tu produis une IDÉATION RICHE ET ORGANISÉE (champ "ideation"). C'est la PRIORITÉ ABSOLUE. Ne te réfugie JAMAIS dans la stratégie abstraite.
- Sinon (réflexion stratégique ouverte, diagnostic, cadrage) → "ideation": null.

ÉTAPE 2 — SI IDÉATION : TRANCHE (refonte 2026-07 — une synthèse qui liste tout sans choisir est un échec)
- CHOISIS 1 à 3 candidats retenus MAXIMUM (le "top"). Pour chacun, une rationale de 15-25 mots qui dit (a) pourquoi il BAT les autres et (b) à QUI on le doit — nomme l'agent ou le croisement d'agents (ex. "l'insight de Consumer Insight croisé au levier de Growth Hacker").
- Puis EXACTEMENT 2 groupes, pas plus :
  · {"direction": "Réserve", "items": [5 à 8 candidats solides mais battus, les meilleurs restants]}
  · {"direction": "Écartés", "items": [3 à 5 entrées au format "Candidat — pourquoi il perd, en 5-10 mots"]}
- INTERDIT : plus de 3 retenus, inventaire exhaustif, direction sans perdant nommé. Tu es un directeur de création qui DÉCIDE, pas un greffier qui compile.

CONTRAINTES DE FORMAT STRICTES
- Sortie JSON STRICT, AUCUN texte avant ou après.
- Schema EXACT :
  {
    "ideation": {
      "groups": [
        { "direction": "<thème, 2-4 mots>", "items": ["<vrai candidat 1>", "<vrai candidat 2>", "...6 à 10 par groupe..."] }
      ],
      "top": [
        { "label": "<le meilleur candidat>", "rationale": "<pourquoi il gagne, 6-12 mots>" }
      ]
    },
    "positioning": "<1 phrase de 15-25 mots résumant l'angle retenu>",
    "opportunities": ["<10-15 mots>", "<10-15 mots>", "<10-15 mots>"],
    "risks": ["<10-15 mots>", "<10-15 mots>"],
    "next_actions": [
      { "action": "<8-12 mots, verbe d'action>", "deadline": "YYYY-MM-DD" },
      { "action": "<...>", "deadline": "YYYY-MM-DD" },
      { "action": "<...>", "deadline": "YYYY-MM-DD" }
    ]
  }
- "ideation" : rempli SI le brief appelle un livrable génératif, sinon null.
  Chaque "item" et "label" doit être DIRECTEMENT UTILISABLE — un VRAI nom ("Keystone Nexus", "Cortex", "Pulse OS"…), JAMAIS une description abstraite ("un nom évoquant la performance").
  top de 1 à 3 (LE choix), 2 groups exactement (Réserve, Écartés).
- "positioning" = LE VERDICT en une phrase assumée ("On part sur X parce que Y") — jamais un résumé neutre.
- Brief NON génératif (ideation: null) : "positioning" = LA recommandation TRANCHÉE (un parti pris, pas un panorama), "opportunities" = les 3 raisons qui la portent (créditées aux agents), "risks" = les 2 garde-fous à poser.
- 3 opportunities, 2 risks, 3 next_actions (toujours, ils contextualisent la décision).
- Deadlines RÉALISTES : entre J+7 et J+90 par rapport à aujourd'hui.
- Pas de jargon corporate, pas de "synergie", pas de "leverage".
- Ton EXÉCUTIF (note pour direction, pas pour étudiant).`;

// Sprint 7.9 — Sanitization soft d'une synthèse parsée (Claude ou Gemma)
// 2026-05-28 — idéation riche organisée (groups par direction + top), façon
// directeur de création. Rétrocompat avec l'ancien format plat "proposals".
function _normalizeIdeation(parsed) {
  const src = parsed.ideation;
  // Format riche {groups, top}
  if (src && typeof src === 'object') {
    const groups = Array.isArray(src.groups)
      ? src.groups.slice(0, 6).map(g => ({
          direction: typeof g?.direction === 'string' ? g.direction : '',
          items: Array.isArray(g?.items)
            ? g.items.map(it => (typeof it === 'string' ? it : (it?.label || ''))).filter(Boolean).slice(0, 12)
            : [],
        })).filter(g => g.direction && g.items.length)
      : [];
    const top = Array.isArray(src.top)
      ? src.top.slice(0, 12).map(p => ({
          label:     typeof p?.label === 'string' ? p.label : (typeof p === 'string' ? p : ''),
          rationale: typeof p?.rationale === 'string' ? p.rationale : '',
        })).filter(p => p.label)
      : [];
    if (groups.length || top.length) return { groups, top };
  }
  // Rétrocompat : ancien champ plat "proposals" → top
  if (Array.isArray(parsed.proposals) && parsed.proposals.length) {
    const top = parsed.proposals.slice(0, 12).map(p => ({
      label:     typeof p?.label === 'string' ? p.label : (typeof p === 'string' ? p : ''),
      rationale: typeof p?.rationale === 'string' ? p.rationale : '',
    })).filter(p => p.label);
    if (top.length) return { groups: [], top };
  }
  return null;
}

function _normalizeSynthesis(parsed) {
  return {
    ideation:      _normalizeIdeation(parsed),
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
        // 4000 : l'idéation riche (30-50 candidats organisés + top + contexte)
        // demande plus de sortie qu'une synthèse stratégique simple.
        max_tokens: 4000,
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
  // Bridage budget IA (admin) : synthèse Workers AI en pause. Le Claude
  // BYOK (appelé en amont dans le handler) reste possible, lui.
  if (await isThrottled(env)) {
    return { error: 'Bridage IA actif — synthèse en pause (réactivable depuis l’admin).' };
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
    await recordUsage(env, 'brainstorming', {
      usage : res?.usage,
      inText: SYNTHESIZER_PROMPT + brief + dialogue,
      outText: raw,
    });
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

// BYOK généralisé (Phase 2) : synthèse sur le moteur choisi par le client via
// callLLM (n'importe quel vendor). Même prompt + même parsing que les 2 voies
// existantes ; HORS compteur (pas de recordUsage). Le repli (→ _generateSynthesis
// Mistral) est géré par l'appelant.
async function _generateSynthesisVendor(env, engine, apiKey, brief, history, todayIso) {
  const dialogue = history
    .filter(t => t?.agent_id && t.agent_id !== 'user' && t.content)
    .map(t => `[${getAgent(t.agent_id)?.name || t.agent_id}] ${t.content}`)
    .join('\n\n');
  if (!dialogue || dialogue.length < 50) {
    return { error: 'Discussion trop courte pour une synthèse (au moins 2 tours requis)' };
  }
  const userMsg = `DATE DU JOUR : ${todayIso}\n\nBRIEF INITIAL : ${brief}\n\nDIALOGUE INTÉGRAL DU BRAINSTORMING :\n${dialogue}\n\nProduis le JSON Plan d'actions strict, sans préambule.`;

  let out;
  try {
    out = await callLLM(env, {
      engine, apiKey,
      system    : SYNTHESIZER_PROMPT,
      messages  : [{ role: 'user', content: userMsg }],
      max_tokens: 4000,
      fallbackOnError: false,
    });
  } catch (e) {
    return { error: `${engine} KO : ${e?.message || e}` };
  }

  const raw = (out.text || '').trim();
  if (!raw) return { error: `Réponse ${engine} vide` };

  let parsed;
  try {
    const m = raw.match(/\{[\s\S]*"positioning"[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch (e) { /* fallback */ }
  if (!parsed) return { error: `Synthèse ${engine} non parsable`, raw: raw.slice(0, 500) };
  return _normalizeSynthesis(parsed);
}

// Mode « Idées de Posts » — synthèse du débat en 5 idées de posts (angle +
// accroche) pour le réseau cible. Réutilise POST_IDEAS_PROMPT + parsePostIdeas
// (définis plus bas), avec le DÉBAT comme contexte au lieu d'un simple sujet.
async function _generatePostIdeasSynthesis(env, brief, history, network) {
  if (!env.AI || typeof env.AI.run !== 'function') return { error: 'Workers AI non disponible' };
  if (await isThrottled(env)) return { error: 'Bridage IA actif — synthèse en pause.' };
  const dialogue = history
    .filter(t => t?.agent_id && t.agent_id !== 'user' && t.content)
    .map(t => `[${getAgent(t.agent_id)?.name || t.agent_id}] ${t.content}`)
    .join('\n\n');
  if (!dialogue || dialogue.length < 50) return { error: 'Débat trop court pour en tirer des idées (au moins 2 tours).' };
  const netDesc = POST_IDEAS_NETWORKS[network] || network || 'le réseau social visé';
  try {
    const res = await env.AI.run(MODEL_ID_HEAVY, {
      messages: [
        { role: 'system', content: POST_IDEAS_PROMPT },
        { role: 'user',   content: `RÉSEAU : ${netDesc}\n\nBRIEF : ${brief}\n\nDÉBAT DE L'ÉQUIPE :\n${dialogue}\n\nSynthétise ce débat en 5 idées de posts au format JSON strict.` },
      ],
      max_tokens: MAX_TOKENS_HEAVY_SYNTH,
      stream:     false,
    });
    const raw = (res?.response
      || res?.result?.response
      || res?.choices?.[0]?.message?.content
      || res?.output?.[0]?.content?.[0]?.text
      || '').trim();
    await recordUsage(env, 'brainstorming', { usage: res?.usage, inText: POST_IDEAS_PROMPT + brief + dialogue, outText: raw });
    const ideas = parsePostIdeas(raw);
    if (!ideas.length) return { error: 'Aucune idée exploitable — relance la synthèse.', raw: raw.slice(0, 200) };
    return { ideas };
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

  const { brief, history = [], engine, apiKey, mode = 'exploration', target_network = null } = body;
  if (typeof brief !== 'string' || brief.trim().length < MIN_BRIEF) {
    return err(`brief requis (${MIN_BRIEF} caractères min)`, 400, origin);
  }
  if (!Array.isArray(history) || history.length < 2) {
    return err('history requis (au moins 2 tours)', 400, origin);
  }

  // BYOK (D1/D3) : flag + moteur + clé → synthèse sur le moteur du client,
  // HORS compteur Keystone (pas de débit crédit). Sinon → chemin existant.
  const useByok = byokRoutingEnabled(env) && !!engine && typeof apiKey === 'string' && apiKey.length > 10;

  // ── Crédits IA — débit (Chantier B · Sprint 3) : 1 crédit pour la
  // synthèse finale. DORMANT (flag enforce_ai_credits_v1 par licence).
  // Skippé en BYOK (le client paie son fournisseur).
  if (!useByok && await isEnforceEnabled(env, claims.sub)) {
    const credit = await consumeCredits(env, { bucketKey: claims.sub, plan: claims.plan, tool: 'brainstorming' });
    if (!credit.ok && credit.blocked) {
      return json({
        error: 'Crédits IA épuisés ce mois. Rachetez un pack ou attendez le 1er du mois (reset).',
        code : 'AI_CREDITS_EXHAUSTED',
        quota: credit.payload,
      }, 429, origin);
    }
  }

  // Mode « Idées de Posts » : la synthèse n'est pas un plan d'actions mais
  // 5 idées de posts (angle + accroche) TIRÉES du débat, pour le réseau cible.
  if (mode === 'post-ideas') {
    const out = await _generatePostIdeasSynthesis(env, brief, history, target_network);
    if (out.error) return json({ error: out.error, raw: out.raw }, 422, origin);
    return json({ ideas: out.ideas, network: target_network, generated_at: new Date().toISOString() }, 200, origin);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  // Sprint 7.9 — Routage BYOK Claude. Si engine='claude' + apiKey fourni,
  // on appelle Claude Sonnet via Anthropic API directe (synthèse premium).
  // Sinon fallback Gemma 4 26B (Sprint 7.4) qui reste excellent.
  let synthesis;
  let engineUsed = 'mistral';
  if (useByok) {
    // Flag ON : synthèse sur N'IMPORTE QUEL moteur du client via callLLM.
    synthesis = await _generateSynthesisVendor(env, engine, apiKey, brief, history, todayIso);
    engineUsed = engine;
    if (synthesis.error) {   // repli transparent Mistral
      const vErr = synthesis.error;
      synthesis = await _generateSynthesis(env, brief, history, todayIso);
      engineUsed = 'mistral-fallback';
      if (synthesis.error) {
        return json({ error: `${engine} KO (${vErr}) + Mistral KO (${synthesis.error})`, raw: synthesis.raw }, 422, origin);
      }
    }
  } else if (engine === 'claude' && typeof apiKey === 'string' && apiKey.length > 10) {
    // Flag OFF : chemin Claude existant INCHANGÉ (Sprint 7.9).
    synthesis = await _generateSynthesisClaude(apiKey, brief, history, todayIso);
    engineUsed = 'claude';
    // En cas d'échec Claude (clé invalide, quota...), fallback transparent sur Mistral
    if (synthesis.error) {
      const claudeErr = synthesis.error;
      synthesis = await _generateSynthesis(env, brief, history, todayIso);
      engineUsed = 'mistral-fallback';
      if (synthesis.error) {
        return json({ error: `Claude KO (${claudeErr}) + Mistral KO (${synthesis.error})`, raw: synthesis.raw }, 422, origin);
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

// ═══ Idées de posts par réseau (one-shot — chaîne de contenu) ═══════
// Génère 5 ANGLES de posts adaptés à un réseau, à partir d'un sujet. Reste au
// stade de l'IDÉE (angle + accroche) : la rédaction finale est le rôle de Ghost
// Writer (séparation des rôles). 1 appel LLM (Mistral one-shot), 1 crédit IA
// (tool 'brainstorming', portefeuille unifié ; flag enforce dormant).
const POST_IDEAS_NETWORKS = {
  facebook:  'Facebook (posts conversationnels, communauté, ton accessible)',
  instagram: 'Instagram (visuel, accroche forte, hashtags, ton inspirant)',
  linkedin:  'LinkedIn (professionnel, expertise, preuve, ton posé)',
  threads:   'Threads (court, spontané, conversationnel, ≤ 500 caractères)',
  telegram:  'Telegram (canal, annonces directes, ton informatif)',
};
const POST_IDEAS_PROMPT =
  "Tu es un stratège de contenu social. À partir d'un SUJET et d'un RÉSEAU, propose 5 idées de posts DISTINCTES, adaptées aux codes du réseau. " +
  "Chaque idée = un ANGLE court (3 à 8 mots) + une ACCROCHE d'une phrase (l'amorce, PAS le post complet). " +
  "Reste au stade de l'IDÉE : ne rédige jamais le post final (un autre outil s'en charge). " +
  'Réponds UNIQUEMENT en JSON strict, sans aucun texte autour : {"ideas":[{"angle":"...","hook":"..."}]} — exactement 5 entrées, en français.';

// Parse défensif d'une réponse LLM → liste d'idées { angle, hook }. Tolère le
// texte autour du JSON ; fallback ligne-à-ligne si le JSON est cassé.
export function parsePostIdeas(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  try {
    const m = raw.match(/\{[\s\S]*"ideas"[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed.ideas)) {
        const out = parsed.ideas
          .map(it => ({ angle: clean(it?.angle), hook: clean(it?.hook) }))
          .filter(it => it.angle || it.hook)
          .slice(0, 5);
        if (out.length) return out;
      }
    }
  } catch (_) { /* fallback ci-dessous */ }
  const lines = raw.split(/\n+/)
    .map(s => s.replace(/^[\s\d.\-•*"']+|["'\s]+$/g, '').trim())
    .filter(s => s.length > 6 && s.length < 200);
  return lines.slice(0, 5).map(s => ({ angle: clean(s), hook: '' }));
}

async function _generatePostIdeas(env, topic, network) {
  if (!env.AI || typeof env.AI.run !== 'function') return { error: 'Moteur IA indisponible' };
  const netDesc = POST_IDEAS_NETWORKS[network] || network;
  try {
    const res = await env.AI.run(MODEL_ID_HEAVY, {
      messages: [
        { role: 'system', content: POST_IDEAS_PROMPT },
        { role: 'user',   content: `SUJET : ${topic}\nRÉSEAU : ${netDesc}\n\nDonne 5 idées au format JSON strict.` },
      ],
      max_tokens: MAX_TOKENS_HEAVY_SYNTH,
      stream:     false,
    });
    const raw = (res?.response
      || res?.result?.response
      || res?.choices?.[0]?.message?.content
      || res?.output?.[0]?.content?.[0]?.text
      || '').trim();
    await recordUsage(env, 'brainstorming', { usage: res?.usage, inText: POST_IDEAS_PROMPT + topic + netDesc, outText: raw });
    const ideas = parsePostIdeas(raw);
    if (!ideas.length) return { error: 'Aucune idée exploitable générée', raw: raw.slice(0, 200) };
    return { ideas };
  } catch (e) {
    return { error: e?.message || 'Échec de génération' };
  }
}

// POST /api/brainstorming/post-ideas — body { topic, network }. Auth JWT + 1 crédit.
export async function handleBrainstormingPostIdeas(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    } });
  }
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') return err('Body JSON requis', 400, origin);
  const topic   = typeof body.topic   === 'string' ? body.topic.trim()   : '';
  const network = typeof body.network === 'string' ? body.network.trim() : '';
  if (topic.length < MIN_BRIEF) return err(`topic requis (${MIN_BRIEF} caractères min)`, 400, origin);
  if (!POST_IDEAS_NETWORKS[network]) return err('network invalide', 400, origin);

  // Crédit IA (dormant tant que enforce_ai_credits_v1=0). Réutilise 'brainstorming'.
  if (await isEnforceEnabled(env, claims.sub)) {
    const credit = await consumeCredits(env, { bucketKey: claims.sub, plan: claims.plan, tool: 'brainstorming' });
    if (!credit.ok && credit.blocked) {
      return json({ error: 'Crédits IA épuisés ce mois.', code: 'AI_CREDITS_EXHAUSTED', quota: credit.payload }, 429, origin);
    }
  }

  const result = await _generatePostIdeas(env, topic.slice(0, MAX_BRIEF), network);
  if (result.error) return json({ error: result.error, raw: result.raw }, 422, origin);
  return json({ ideas: result.ideas, network, generated_at: new Date().toISOString() }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════════
// SÉLECTEUR DE COMITÉ PAR IA — mode « Auto » (juin 2026)
// ───────────────────────────────────────────────────────────────────
// Le mode Auto ne suit plus une table figée par mode cognitif : une passe
// IA légère (one-shot, ~120 tokens) lit le BRIEF et choisit les agents de
// débat les PLUS adaptés à CE sujet. Repli si l'IA est indisponible /
// bridée / illisible : comité complet (« les 9 » = 8 débatteurs ; le
// Synthesizer s'ajoute hors-débat côté front).
// ═══════════════════════════════════════════════════════════════════

// Repli « les 9 » : comité de débat complet (8 agents non-Synthesizer).
const FULL_DEBATE_ROSTER = ['strategic', 'creative', 'devil', 'consumer', 'cultural', 'growth', 'brand', 'data'];

const ROSTER_PICK_PROMPT = `Tu es le chef de cabinet d'un boardroom marketing de 8 agents IA spécialisés. À partir d'un BRIEF, tu choisis QUELS agents doivent débattre — uniquement ceux dont l'expertise est réellement pertinente pour CE sujet précis.

LES 8 AGENTS (id — expertise) :
- strategic — Coordinateur stratégique : cadre et ouvre le débat (TOUJOURS inclus d'office).
- creative — Concepts forts, angles créatifs, rupture, storytelling, identité visuelle.
- growth — Acquisition, viralité, canaux, conversion, KPI, leviers de croissance.
- consumer — Psychologie de l'audience, désirs cachés, motivations, jobs-to-be-done.
- brand — Cohérence de marque, ton, perception et image long-terme, premium.
- cultural — Tendances, signaux culturels, timing, niches, sous-cultures, communautés.
- data — Chiffres, ordres de grandeur, taille de marché, faisabilité, hypothèses à vérifier.
- devil — Contradicteur : challenge les hypothèses faibles, les clichés, le consensus mou.

RÈGLES STRICTES
- Choisis 4 à 5 agents au total (strategic compte dedans, déjà inclus). 6 UNIQUEMENT si le brief est réellement multi-facettes — un comité resserré débat mieux et coûte moins.
- Inclus TOUJOURS au moins une voix critique : devil OU data.
- Choisis pour la complémentarité des angles utiles au brief, jamais pour le nombre. Un sujet ciblé mérite un petit comité affûté.
- N'inclus jamais d'agent hors de la liste ci-dessus.
- Réponds UNIQUEMENT par un JSON strict, sans aucun texte autour : {"agents":["strategic","..."]}`;

// Parse défensif de la réponse LLM du sélecteur → liste d'ids d'agents de débat
// valides. strategic forcé / synth exclus en aval par normalizeDebateRoster.
export function parseRosterPick(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const VALID = new Set(FULL_DEBATE_ROSTER);
  // Tentative 1 — JSON strict { "agents": [...] }
  try {
    const m = raw.match(/\{[\s\S]*"agents"[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed.agents)) {
        const ids = parsed.agents
          .map(x => String(x || '').trim().toLowerCase())
          .filter(id => VALID.has(id));
        if (ids.length) return [...new Set(ids)];
      }
    }
  } catch (_) { /* repli ci-dessous */ }
  // Tentative 2 — repérage des ids en clair (ordre d'apparition, dédup)
  const found = [];
  const seen = new Set();
  for (const tok of raw.toLowerCase().match(/[a-z]+/g) || []) {
    if (VALID.has(tok) && !seen.has(tok)) { seen.add(tok); found.push(tok); }
  }
  return found;
}

async function _pickRosterAI(env, { brief, cognitiveMode, byokEngine, byokKey, byokActive }) {
  const fallback = (source) => ({ roster: FULL_DEBATE_ROSTER.slice(), source });
  if (!env.AI || typeof env.AI.run !== 'function') return fallback('no-ai');
  // Bridage budget IA : on ne dépense pas une passe de sélection si l'IA est throttlée.
  if (await isThrottled(env)) return fallback('throttled');

  let out;
  try {
    out = await callLLM(env, {
      engine: byokActive ? byokEngine : undefined,
      apiKey: byokActive ? byokKey : undefined,
      system: ROSTER_PICK_PROMPT,
      messages: [{ role: 'user', content: `BRIEF :\n"""\n${brief}\n"""\n\nMODE DE RÉFLEXION : ${cognitiveMode}\n\nDonne le JSON du comité, rien d'autre.` }],
      max_tokens: 120,
      fallbackOnError: true,   // ne jamais casser le démarrage de la séance
    });
  } catch (_) {
    return fallback('error');
  }

  const raw = (out?.text || '').trim();
  await recordUsage(env, 'brainstorming', { usage: out?.usage, inText: ROSTER_PICK_PROMPT + brief, outText: raw });

  const picked = parseRosterPick(raw);
  if (!picked.length) return fallback('unparsable');

  // Normalise (strategic forcé, synth/auto/invalides retirés, dédup) + garde-fous.
  let roster = normalizeDebateRoster(picked);
  if (!roster.some(id => id === 'devil' || id === 'data')) roster.push('devil');  // ≥ 1 voix d'opposition
  if (roster.length < 3) return fallback('too-few');                              // plancher débat
  if (roster.length > 8) roster = roster.slice(0, 8);
  return { roster, source: out?.viaBYOK ? 'ai-byok' : 'ai' };
}

// POST /api/brainstorming/pick-roster — body { brief, cognitive_mode, byok? }. Auth JWT.
// Mode « Auto » : l'IA compose le comité de débat selon le sujet. Aucun crédit
// consommé ici (la séance agent-respond gère déjà le métrage) — on enregistre
// seulement l'usage budget. Repli garanti : comité complet (les 9).
export async function handleBrainstormingPickRoster(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    } });
  }
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') return err('Body JSON requis', 400, origin);
  const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
  const cognitiveMode = typeof body.cognitive_mode === 'string' ? body.cognitive_mode : 'exploration';
  if (brief.length < MIN_BRIEF) return err(`brief requis (${MIN_BRIEF} caractères min)`, 400, origin);
  if (brief.length > MAX_BRIEF) return err(`brief trop long (${MAX_BRIEF} max)`, 400, origin);

  // BYOK universel — la passe de sélection suit le moteur ACTIF + sa clé (cohérent
  // avec « ma clé pilote tout »). Flag OFF / pas de clé ⇒ Mistral Workers AI.
  const byok = body.byok;
  const byokEngine = (byok && typeof byok.engine === 'string') ? byok.engine : null;
  const byokKey    = (byok && typeof byok.apiKey === 'string' && byok.apiKey.length > 10) ? byok.apiKey : null;
  const byokActive = byokRoutingEnabled(env) && !!byokEngine && !!byokKey;

  const { roster, source } = await _pickRosterAI(env, {
    brief: brief.slice(0, MAX_BRIEF), cognitiveMode, byokEngine, byokKey, byokActive,
  });
  return json({ agents: roster, source, generated_at: new Date().toISOString() }, 200, origin);
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
  // Bridage budget IA : insights = bonus non-critique → on n'en dépense pas.
  if (await isThrottled(env)) return [];
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
      await recordUsage(env, 'brainstorming', {
        usage : res?.usage,
        inText: INSIGHTS_PROMPT + brief + dialogue,
        outText: raw,
      });
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
    await recordUsage(env, 'brainstorming', {
      usage : res?.usage,
      inText: INSIGHTS_PROMPT + brief + dialogue,
      outText: raw,
    });
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

// ── Détection d'un brief d'IDÉATION (2026-05-28) ──────────────────
// Quand l'utilisateur demande un LIVRABLE génératif (nom, slogan, idées…),
// le débat doit PRODUIRE des candidats concrets et converger vers les
// meilleurs — pas théoriser. On adapte alors les triggers des agents.
const _IDEATION_RE = /\b(nom|noms|nommer|appeler|baptiser|rebaptiser|renommer|slogan|baseline|accroche|tagline|signature|punchline|id[ée]e|id[ée]es|trouve[rz]?|propose[rz]?|sugg[èe]re|sugg[ée]rer|brainstorm|liste de|des options|des pistes|titres?)\b/i;
function _isIdeationBrief(brief) {
  return _IDEATION_RE.test(String(brief || ''));
}

// ─────────────────────────────────────────────────────────────────
// Agent premium — Claude Haiku (BYOK, 2026-05-28)
// ─────────────────────────────────────────────────────────────────
// Couche d'incarnation ajoutée au system prompt du Devil's Advocate
// UNIQUEMENT quand il tourne sur Claude Haiku. Exploite la finesse du
// modèle pour un caractère vraiment tranché (Llama garde son prompt court,
// sinon il se perd). Les contraintes de format restent celles du préambule.
function _enrichDevilPromptForClaude(basePrompt) {
  return `${basePrompt}

INCARNATION RENFORCÉE (tu es joué par un modèle premium — exploite-le)
- Tu es l'esprit critique le plus aiguisé de la table : un mélange de Christopher Hitchens et d'un associé de cabinet qui a vu mille pitchs mourir.
- Frappe le maillon FAIBLE, jamais l'accessoire : vise l'hypothèse cachée sur laquelle tout repose, celle que personne n'ose nommer.
- Sois CHIRURGICAL, pas grincheux : une objection précise et fondée vaut dix sarcasmes. Nomme le risque concret (le coût, le délai, le contre-exemple réel, le biais).
- Quand tu démontes, OUVRE une faille exploitable : "ça casse SI X — donc prouvez X d'abord". Tu fais avancer en résistant, pas en bloquant.
- Une formule qui marque > un paragraphe tiède. Reste sous 3 phrases, mais qu'elles laissent une trace.`;
}

// Streaming d'un tour d'agent via l'API Anthropic (Claude Haiku).
// Renvoie le texte complet, ou null en cas d'échec (clé invalide, réseau,
// quota, réponse vide) → le caller bascule alors sur Llama.
// Le format SSE Anthropic (content_block_delta → delta.text) est re-streamé
// au client dans le MÊME format custom que Llama (events {type:'chunk'}).
async function _streamAgentClaude(apiKey, systemPrompt, userContent, send, agentId) {
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
        model:      BRAINSTORM_CLAUDE_MODEL,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userContent }],
        max_tokens: MAX_TOKENS,
        stream:     true,
      }),
    });
  } catch (e) {
    return null;
  }
  if (!res.ok || !res.body) return null;

  const reader  = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let   buffer  = '';
  let   fullText = '';

  // try/catch global : une coupure réseau en cours de stream ne doit
  // jamais casser la session — on renvoie ce qu'on a (ou null → Llama).
  try {
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
          // Anthropic stream : { type:'content_block_delta', delta:{ type:'text_delta', text:'...' } }
          const chunk = parsed?.delta?.text ?? '';
          if (chunk) {
            fullText += chunk;
            send({ type: 'chunk', agent_id: agentId, text: chunk });
          }
        } catch (e) { /* ignore malformed line */ }
      }
    }
  } catch (e) {
    // Stream interrompu : si on a déjà du texte, on le garde (pas de
    // fallback Llama qui dupliquerait les chunks déjà envoyés au client).
    return fullText || null;
  }
  return fullText || null;
}

// Assemble le contexte conversationnel (3 derniers tours) + l'instruction
// du tour en UN message user pour Claude (Anthropic exige system séparé +
// alternance stricte — un message user unique est le plus robuste).
function _buildClaudeUserContent(recent, triggerContent) {
  const ctx = (recent || [])
    .filter(t => t && t.content)
    .map(t => t.agent_id === 'user'
      ? `[Brief / décideur] ${String(t.content)}`
      : `[${getAgent(t.agent_id)?.name || t.agent_id}] ${String(t.content)}`)
    .join('\n');
  return ctx
    ? `CONTEXTE RÉCENT DE LA TABLE :\n${ctx}\n\n${triggerContent}`
    : triggerContent;
}

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
    active_agents,                   // Sprint 7.12 — comité de débat choisi (sélecteur d'agents)
    apiKey,                          // BYOK Claude (LEGACY) — agent premium Devil's Advocate, flag-OFF
    byok,                            // BYOK universel (nesté) — { engine, apiKey } du moteur ACTIF
    target_network = null,           // Mode « Idées de Posts » — réseau social cible
    source,                          // Chaîne de contenu — { text, ref } source fournie par l'utilisateur
  } = body;
  const claudeKey = (typeof apiKey === 'string' && apiKey.length > 10) ? apiKey : null;

  // ── BYOK universel (chantier streaming) ─────────────────────────
  // Le champ `byok` (nesté, ≠ apiKey legacy) porte le moteur ACTIF + sa clé
  // (front : byokRequestFields()). On le distingue du `apiKey` legacy pour
  // GARANTIR le byte-identique flag-OFF : on ne touche jamais au chemin
  // Devil-on-Claude historique. byokActive ⇒ TOUS les agents streament
  // depuis le vendor du client (D-S2), HORS compteur (D-S3).
  const byokEngine = (byok && typeof byok.engine === 'string') ? byok.engine : null;
  const byokKey    = (byok && typeof byok.apiKey === 'string' && byok.apiKey.length > 10) ? byok.apiKey : null;
  const byokActive = byokRoutingEnabled(env) && !!byokEngine && !!byokKey;

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

  // Sprint 7.12 — comité réduit (sélecteur d'agents). active_agents = ids du
  // comité de débat choisi côté frontend. On normalise (strategic forcé, synth
  // exclu, ids invalides filtrés). null ⇒ comité complet (legacy, zéro régression).
  // tableCap ne dépasse jamais la taille du comité, sinon la boucle re-pioche
  // strategic en boucle une fois le tour de table épuisé.
  const debateRoster = Array.isArray(active_agents) && active_agents.length
    ? normalizeDebateRoster(active_agents)
    : null;
  const rosterN  = debateRoster ? debateRoster.length : 8;
  const tableCap = debateRoster ? Math.min(turnsCap, rosterN) : turnsCap;

  // Mode « Idées de Posts » : on injecte le RÉSEAU CIBLE dans le brief vu par les
  // agents (sans toucher le brief affiché/historisé côté front). null sinon.
  const POST_NET_LABELS = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', threads: 'Threads', telegram: 'Telegram' };
  const _netCible = (cognitive_mode === 'post-ideas' && POST_NET_LABELS[target_network]) ? POST_NET_LABELS[target_network] : null;
  const _briefBase = _netCible
    ? `${brief}\n\n[RÉSEAU CIBLE : ${_netCible} — toutes les idées de posts doivent être pensées pour ce réseau.]`
    : brief;
  // Chaîne de contenu — DOSSIER SOURCE : matière apportée par l'utilisateur (lien
  // web extrait, texte collé, fichier .md/.txt/.csv). Injectée bornée pour que le
  // débat s'appuie sur des FAITS au lieu de broder. Absente ⇒ comportement inchangé.
  const _srcText = (source && typeof source.text === 'string') ? source.text.trim().slice(0, SOURCE_INJECT_MAX) : '';
  const effectiveBrief = _srcText
    ? `${_briefBase}\n\nDOSSIER SOURCE (matière fournie par l'utilisateur — appuie-toi dessus pour des angles FACTUELS et précis ; ne le recopie pas mot pour mot) :\n"""\n${_srcText}\n"""`
    : _briefBase;

  if (!env.AI || typeof env.AI.run !== 'function') {
    return err('Workers AI non disponible (binding [ai] manquant)', 503, origin);
  }

  // Bridage budget IA (admin) : le débat multi-agent (8 agents Workers AI)
  // est de loin le plus gros poste de neurones → c'est le vrai levier du
  // plafond. On coupe net ici avant d'ouvrir le stream.
  // BYOK : si le client streame depuis SON vendor (byokActive), aucun
  // neurone Workers AI n'est consommé → on NE bride PAS sur MON budget
  // (et on ne décompte pas ses crédits). D-S3, patron P2/P3.
  if (!byokActive) {
    const _throttled = await budgetGuard(env, origin);
    if (_throttled) return _throttled;
  }

  // ── Crédits IA — débit du portefeuille de la licence connectée ───
  // (Chantier B · Sprint 3). 1 crédit par tour de table (cet appel,
  // même en mode 'auto' multi-agents). DORMANT : ne s'active que si la
  // licence porte enforce_ai_credits_v1=1 ; sinon legacy/illimité.
  // Skippé si byokActive (le client paie son vendor, hors compteur).
  if (!byokActive && await isEnforceEnabled(env, claims.sub)) {
    const credit = await consumeCredits(env, { bucketKey: claims.sub, plan: claims.plan, tool: 'brainstorming' });
    if (!credit.ok && credit.blocked) {
      return json({
        error: 'Crédits IA épuisés ce mois. Rachetez un pack ou attendez le 1er du mois (reset).',
        code : 'AI_CREDITS_EXHAUSTED',
        quota: credit.payload,
      }, 429, origin);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Stream custom multi-agent
  // ─────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const isAuto  = agent_id === 'auto';
  // Mode idéation : le débat doit produire des candidats concrets et
  // converger vers les meilleurs (travail d'équipe), pas théoriser.
  const ideation = _isIdeationBrief(brief);

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
      // Refonte 2026-07 — clôture anticipée : 2 tours consécutifs redondants
      // (Jaccard mots porteurs ≥ .55 avec un tour déjà joué) = la table n'apporte
      // plus rien → on passe direct à la synthèse, les appels restants sont
      // économisés. Anti-gaspillage, jamais déclenché par UN seul doublon.
      let redundantStreak = 0;
      const _tokSet = (s) => new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
        .match(/[a-z0-9]{4,}/g) || []);
      const _isRedundant = (txt) => {
        const a = _tokSet(txt);
        if (a.size < 6) return false;
        for (const t of localHistory) {
          if (!t || t.agent_id === 'user' || !t.content) continue;
          const b = _tokSet(t.content);
          if (!b.size) continue;
          let inter = 0;
          for (const w of a) if (b.has(w)) inter++;
          if (inter / (a.size + b.size - inter) >= 0.55) return true;
        }
        return false;
      };
      // Compteur budget IA : on accumule les tokens des tours Workers AI
      // sur toute la session puis on écrit UNE fois en fin de stream (évite
      // une écriture D1 dans la boucle chaude qui ralentirait le live).
      let sessionInTok  = 0;
      let sessionOutTok = 0;

      try {
        while (true) {
          // Déterminer l'agent qui va parler maintenant
          let currentAgentId;
          if (isAuto) {
            currentAgentId = pickNextAgent(localHistory, cognitive_mode, debateRoster);
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

          const agentList    = getAgentNamesForPrompt(currentAgentId, debateRoster);
          const systemPrompt = agent.systemPrompt(cognitive_mode, effectiveBrief, agentList, previousTurn, previousAgent);

          const messages = [{ role: 'system', content: systemPrompt }];
          // Refonte 2026-07 (retour Stéphane « chacun parle dans son coin ») :
          // l'agent voit TOUT le tour de table en cours (8×3 phrases ≈ 700
          // mots, tenable), plus seulement les 3 derniers tours — le 7e
          // intervenant ne découvrait jamais les 3 premiers, impossible de
          // construire ensemble.
          const recent = localHistory.slice(-12);
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
          // Refonte 2026-07 — REBOND FORCÉ SUR CONTENU CITÉ : la vague
          // invitation « tu peux interpeller » était ignorée par Mistral
          // (même leçon que la directive de langue souple du Smart Agent :
          // deviner + IMPOSER, jamais suggérer). On met la citation exacte
          // du tour précédent SOUS LES YEUX de l'agent avec obligation d'y
          // répondre en phrase 1.
          const rebound = (previousTurn && previousAgent)
            ? `RÉAGIS D'ABORD À CECI — ${previousAgent.name} vient de dire : « ${String(previousTurn.content).slice(0, 220)} »\nTa PHRASE 1 le PROLONGE ou le CONTREDIT en nommant ${previousAgent.name} (jamais de validation polie). Ensuite seulement, ton angle.\n\n`
            : '';
          let triggerContent;
          if (ideation) {
            // ── MODE IDÉATION : l'équipe PRODUIT des candidats et converge ──
            if (isFirstTurn) {
              triggerContent = `Demande d'IDÉATION. Tu OUVRES l'atelier. MAX 3 phrases :
- Phrase 1 : cadre 3-4 DIRECTIONS créatives à explorer (ex. premium/exécutif, AI-native, luxe tech, control center).
- Phrases 2-3 : LANCE immédiatement 3 candidats concrets et NOMMÉS (de vraies propositions, pas des descriptions).
- INTERDIT : théoriser sur ce que le livrable "devrait évoquer", citer un agent, "Bonjour".`;
            } else if (isStrategic) {
              triggerContent = `IDÉATION en cours. Tu RECADRES pour faire converger. MAX 3 phrases :
- Phrase 1 : pointe les 1-2 directions les plus prometteuses parmi les candidats déjà sur la table (nomme l'agent dont la piste tient le mieux).
- Phrase 2 : écarte la piste la plus faible (dis pourquoi en 4 mots).
- Phrase 3 : relance 2 NOUVEAUX candidats nommés dans la meilleure direction.
- INTERDIT : validation polie, théorie abstraite.`;
            } else {
              triggerContent = `${rebound}Demande d'IDÉATION. Tu interviens comme ${agent.name} (${agent.role}). MAX 3 phrases :
- Puis propose 3 CANDIDATS concrets et NOMMÉS vus depuis TON prisme de ${agent.role} (ton angle colore le STYLE des propositions).
- INTERDIT ABSOLU : théoriser sur ce que le nom "devrait" être, valider poliment, paraphraser. DONNE DE VRAIS NOMS, directement utilisables.`;
            }
          } else if (isFirstTurn) {
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
            triggerContent = `${rebound}Tu interviens comme ${agent.name} (${agent.role}). CONTRAINTES ABSOLUES :

MAX 3 PHRASES (90 mots TOTAL). Pas de salutation, pas de résumé, pas de liste à puces.

INTERVENTION ATTENDUE — TON RÔLE PRÉCIS CE TOUR
${directive.angle}
${directive.forbid ? '\n' + directive.forbid : ''}

INTERDICTIONS DE FORMULATION (le post-process serveur tronque ou rejette sinon)
- JAMAIS commencer par "Ce qui vient d'être dit", "Cela me fait penser", "Cela me rappelle", "Je propose de", "Nous devrions", "Nous pourrions". Démarre par TON ANGLE concret OU par l'interpellation directe de l'agent précédent.
- JAMAIS valider poliment ("X a raison", "Je rejoins Y", "Comme Z l'a dit"). Si tu cites un agent, c'est pour le CONTREDIRE ou PROLONGER, jamais pour l'approuver.
- JAMAIS paraphraser le précédent — apporte UN ÉLÉMENT QUI N'A PAS ÉTÉ DIT.

INTERACTION (c'est un débat vivant, pas des monologues)
- Tu PEUX et tu DOIS interpeller les autres agents par leur nom pour rebondir/contredire ("Non, l'angle de tel agent ignore…", "Là où tel autre s'arrête, je pousse…").

POSTURE
- Tu peux CONTREDIRE ("Pas d'accord, l'angle X ignore Y").
- Tu peux PIVOTER ("Le vrai sujet n'est pas X mais Y").
- Tu peux RADICALISER ("Pousser plus loin : Z").
- Tu DOIS apporter du CONCRET : un chiffre, un référent nommé, un visuel précis, une hypothèse falsifiable.`;
          }
          messages.push({ role: 'user', content: triggerContent });

          let fullText  = '';
          let streamed  = false;

          // ── BYOK universel : moteur ACTIF du client pour TOUS les agents ──
          // (flag ON + clé). Le débat entier streame depuis le vendor choisi
          // (Anthropic / OpenAI-compat / Gemini), HORS compteur. Le Devil
          // garde sa persona enrichie quel que soit le vendor. Repli Workers
          // AI ci-dessous SI le vendor échoue AVANT le 1er chunk ; s'il a déjà
          // émis puis coupe, streamLLM renvoie le partiel (pas de double).
          if (byokActive) {
            const effSystem = (currentAgentId === PREMIUM_AGENT_ID)
              ? _enrichDevilPromptForClaude(systemPrompt)
              : systemPrompt;
            const byokUser = _buildClaudeUserContent(recent, triggerContent);
            try {
              const byokText = await streamLLM(env, {
                engine    : byokEngine,
                apiKey    : byokKey,
                system    : effSystem,
                messages  : [{ role: 'user', content: byokUser }],
                max_tokens: MAX_TOKENS,
                onChunk   : (t) => send({ type: 'chunk', agent_id: currentAgentId, text: t }),
              });
              if (byokText) { fullText = byokText; streamed = true; }
            } catch (e) {
              // Échec AVANT le 1er chunk → repli Workers AI ci-dessous (rien
              // d'émis). On ne notifie pas le client : bascule transparente.
            }
          }

          // ── Agent premium : Devil's Advocate sur Claude Haiku (LEGACY) ──
          // Chemin historique (flag OFF), INCHANGÉ : si une clé Anthropic est
          // posée (apiKey legacy) ET tour du Devil, on streame via Claude
          // Haiku (caractère affûté). Échec → fallback Llama. BYPASSÉ quand
          // byokActive (le moteur actif gère déjà ce tour).
          if (!streamed && !byokActive && currentAgentId === PREMIUM_AGENT_ID && claudeKey) {
            const enrichedSystem = _enrichDevilPromptForClaude(systemPrompt);
            const claudeUser     = _buildClaudeUserContent(recent, triggerContent);
            const claudeText     = await _streamAgentClaude(claudeKey, enrichedSystem, claudeUser, send, currentAgentId);
            if (claudeText) {
              fullText = claudeText;
              streamed = true;
            }
            // claudeText null → fallback Llama ci-dessous (transparent)
          }

          // ── Inférence Llama (par défaut + fallback agent premium) ──
          if (!streamed) {
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
          }

          // Compteur budget IA : on n'accumule QUE la voie Workers AI
          // (le Devil's Advocate via Claude BYOK est facturé ailleurs).
          if (!streamed) {
            sessionInTok  += estimateTokens(JSON.stringify(messages));
            sessionOutTok += estimateTokens(fullText);
          }

          // Post-process : strip alphabet gibberish + cap 2 phrases
          let cleanedText = _stripAlphaGibberish(fullText);
          cleanedText = _capSentences(cleanedText, MAX_SENTENCES_PER_TURN);

          // Fin de message — envoie le texte propre comme full_text
          // (le frontend appendera le delta si différence avec ce que
          // les chunks ont accumulé)
          send({ type: 'agent_end', agent_id: currentAgentId, full_text: cleanedText });

          // Clôture anticipée — testée AVANT le push (comparaison aux tours déjà joués)
          redundantStreak = _isRedundant(cleanedText) ? redundantStreak + 1 : 0;

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
            consensus: _computeConsensus(localHistory, rosterN),
            tension:   _computeTension(localHistory),
            turns_done: turnsDone,
            turns_total: tableCap,
          });

          // Conditions d'arrêt
          if (!isAuto) {
            completeReason = 'single';
            break;
          }
          if (turnsDone >= tableCap) {
            completeReason = 'max_turns';
            break;
          }
          if (redundantStreak >= 2 && turnsDone >= 3) {
            completeReason = 'converged';   // la table tourne en rond → synthèse directe, appels économisés
            break;
          }
          if (shouldAutoPause(localHistory, { maxAgentTurns: tableCap })) {
            completeReason = 'auto_pause';
            break;
          }
        }

        // Refonte 2026-07 — tour de table ACCOMPLI pour le comité CHOISI
        // (fix du bug « la synthèse ne se fait plus seule » : le front
        // comparait à 8 en dur alors que le comité Auto fait 4-6).
        const roundComplete = completeReason === 'converged'
          || ((completeReason === 'max_turns' || completeReason === 'auto_pause') && turnsDone >= tableCap);

        // Sprint 4 — Extraction des insights émergents en background.
        // Sprint 7.11 — DOIT être envoyé AVANT l'event 'complete' : le
        // frontend exit sa boucle SSE dès qu'il reçoit 'complete', donc
        // tout event envoyé après est ignoré côté client.
        // Refonte 2026-07 (économie) : quand le tour est COMPLET, la synthèse
        // (déclenchée auto par le front) refait ce travail en mieux → on
        // économise cet appel lourd. Les insights ne servent que les pauses
        // intermédiaires, où aucune synthèse ne suit.
        if (turnsDone >= 2 && !roundComplete) {
          try {
            const insights = await _extractInsights(env, brief, localHistory);
            if (insights.length > 0) {
              send({ type: 'insights_update', items: insights });
            }
          } catch (e) { /* silencieux : extraction non-critique */ }
        }

        // Compteur budget IA : 1 écriture par session (best-effort).
        if (sessionInTok > 0 || sessionOutTok > 0) {
          await recordUsage(env, 'brainstorming', { inTokens: sessionInTok, outTokens: sessionOutTok });
        }

        send({ type: 'complete', reason: completeReason, turns: turnsDone, roster_n: rosterN, round_complete: roundComplete });
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
