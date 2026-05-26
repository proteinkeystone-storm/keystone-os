/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Brainstorming · Orchestrateur (Sprint 2)
   ─────────────────────────────────────────────────────────────────

   Décide quel agent doit parler ensuite dans la discussion.
   Sprint 2 : heuristiques déterministes (mention explicite > rotation
   adaptée au mode cognitif > fallback rotation).
   Sprint 3+ : intelligence accrue (mini-LLM décideur, pondérations
   apprises, pacing rhythm system).

   API exposée :
     pickNextAgent(history, mode)      → string (agent_id)
     shouldAutoPause(history, opts)    → boolean (true si on s'arrête)
     detectMentionInText(text)         → string | null

   Convention : history = [{agent_id, content, timestamp}].
   agent_id 'user' = intervention humaine, considérée comme un "reset"
   du compteur d'auto-pause.
   ═══════════════════════════════════════════════════════════════ */

import { AGENTS } from './brainstorming-agents.js';

// Sprint 7.1 — tour de table complet : 8 agents non-Synthesizer parlent
// dans un cycle (au lieu des 3 messages du Sprint 2). pickNextAgent
// dédupplique pour qu'aucun agent ne parle deux fois dans le cycle.
const DEFAULT_MAX_AGENT_TURNS_WITHOUT_USER = 8;

// ─────────────────────────────────────────────────────────────────
// detectMentionInText
// ─────────────────────────────────────────────────────────────────
// Cherche un nom d'agent mentionné dans le texte (case-insensitive).
// Retourne l'agent_id du premier match, ou null. Utilisé pour la
// passe de parole explicite : "Creative Director, ton angle ?".
// ─────────────────────────────────────────────────────────────────
export function detectMentionInText(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  // On ne match QUE le nom de l'agent (Creative Director, Devil's Advocate…)
  // pour éviter les faux positifs sur les rôles génériques.
  for (const a of AGENTS) {
    const name = a.name.toLowerCase();
    // Word boundary + nom exact pour limiter les collisions
    const idx = lower.indexOf(name);
    if (idx >= 0) {
      // Vérification soft : le mot doit être précédé/suivi d'un séparateur
      const before = idx === 0 ? ' ' : lower[idx - 1];
      const after  = lower[idx + name.length] || ' ';
      if (/[\s,.;:!?'"()«»]/.test(before) && /[\s,.;:!?'"()«»]/.test(after)) {
        return a.id;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// ARCS_BY_MODE — Sprint 7
// ─────────────────────────────────────────────────────────────────
// Chaque mode cognitif a son propre arc narratif. L'arc dicte qui parle
// après qui. La règle : les agents leaders (les plus pertinents pour ce
// mode) sont placés tôt dans la séquence, les agents périphériques en
// fin de cycle.
//
// Tous les arcs s'ouvrent par Strategic Lead (cadrage) et reviennent à
// Strategic Lead après Data (cycle de 8 agents). Synthesizer reste hors
// arc (invoqué sur déclencheur Sprint 5).
//
// Convention : ARCS_BY_MODE[mode][previousAgent] = nextAgent
// ─────────────────────────────────────────────────────────────────
export const ARCS_BY_MODE = {
  // Cadrage → idée → challenge → humain → culture → croissance → marque → marché
  // (séquence pré-Sprint 7, éprouvée mai 2026)
  exploration: {
    strategic : 'creative',
    creative  : 'devil',
    devil     : 'consumer',
    consumer  : 'cultural',
    cultural  : 'growth',
    growth    : 'brand',
    brand     : 'data',
    data      : 'strategic',
    synth     : 'strategic',
  },

  // Tempo serré, vitesse + impact mesurable. Growth + Data ouvrent fort,
  // Devil challenge le timing, Brand surveille la cohérence, Consumer +
  // Cultural en fin de cycle pour l'audience.
  launch: {
    strategic : 'growth',
    growth    : 'creative',
    creative  : 'data',
    data      : 'devil',
    devil     : 'brand',
    brand     : 'cultural',
    cultural  : 'consumer',
    consumer  : 'strategic',
    synth     : 'strategic',
  },

  // Identité, ton, perception long-terme. Brand + Consumer + Creative en
  // ouverture. Cultural pour le timing identitaire. Devil pour stresser
  // les contradictions de marque. Data + Growth en queue (non-prioritaires).
  branding: {
    strategic : 'brand',
    brand     : 'consumer',
    consumer  : 'creative',
    creative  : 'cultural',
    cultural  : 'devil',
    devil     : 'data',
    data      : 'growth',
    growth    : 'strategic',
    synth     : 'strategic',
  },

  // KPI-driven. Growth + Data + Consumer en tête (acquisition / mesure /
  // motivation). Devil challenge les ordres de grandeur. Brand garde
  // la cohérence long-terme malgré l'urgence d'acquisition.
  growth: {
    strategic : 'growth',
    growth    : 'data',
    data      : 'consumer',
    consumer  : 'devil',
    devil     : 'creative',
    creative  : 'cultural',
    cultural  : 'brand',
    brand     : 'strategic',
    synth     : 'strategic',
  },

  // Dense, rapide, décisions immédiates. Devil interroge tôt, Data
  // quantifie l'ampleur, Brand protège l'image, Consumer pour l'empathie
  // publique. Creative en fin (recadrage narratif post-urgence).
  crisis: {
    strategic : 'devil',
    devil     : 'data',
    data      : 'brand',
    brand     : 'consumer',
    consumer  : 'growth',
    growth    : 'cultural',
    cultural  : 'creative',
    creative  : 'strategic',
    synth     : 'strategic',
  },

  // Différenciation marché + audience cible. Consumer pour l'insight
  // humain, Cultural pour le timing culturel, Brand pour la cohérence,
  // Devil challenge les clichés, Data quantifie la taille de marché.
  positioning: {
    strategic : 'consumer',
    consumer  : 'cultural',
    cultural  : 'brand',
    brand     : 'devil',
    devil     : 'creative',
    creative  : 'data',
    data      : 'growth',
    growth    : 'strategic',
    synth     : 'strategic',
  },

  // Challenge du statu quo, pivots. Devil ouvre fort (interroger
  // l'existant), Cultural détecte les signaux de pivot, Creative propose
  // la rupture, Brand identifie ce qu'on garde, Consumer + Data en fin
  // (audience + risque).
  repositioning: {
    strategic : 'devil',
    devil     : 'cultural',
    cultural  : 'creative',
    creative  : 'brand',
    brand     : 'consumer',
    consumer  : 'data',
    data      : 'growth',
    growth    : 'strategic',
    synth     : 'strategic',
  },
};

// Helper exposé pour les tests : retourne l'arc d'un mode (ou exploration en fallback)
export function getArcForMode(mode) {
  return ARCS_BY_MODE[mode] || ARCS_BY_MODE.exploration;
}

// ─────────────────────────────────────────────────────────────────
// pickNextAgent — heuristiques Sprint 7.1.1 (round-table robuste)
// ─────────────────────────────────────────────────────────────────
// Règles dans l'ordre :
//   1. Si history vide → Strategic Lead (ouvre toujours la discussion)
//   2. Si la dernière intervention est de 'user' → Strategic Lead (re-cadre)
//   3. Si STRATEGIC LEAD vient de parler ET cite un agent vierge → cet agent
//      (la mention n'est honorée QUE si Strategic distribue la parole —
//      son rôle explicite. Les autres agents citent le précédent par
//      politesse forcée par le system prompt ; ce n'est PAS une passe de
//      parole et doit être ignoré, sinon ping-pong infini.)
//   4. Sinon → rotation selon l'arc du mode, avec déduplication :
//      si l'agent suivant dans l'arc a déjà parlé depuis la dernière
//      intervention user, on avance dans l'arc jusqu'à trouver un agent
//      qui n'a pas encore parlé. Garantit un tour de table complet
//      sans répétition.
// ─────────────────────────────────────────────────────────────────
export function pickNextAgent(history, mode = 'exploration') {
  if (!Array.isArray(history) || history.length === 0) return 'strategic';

  const last = history[history.length - 1];

  // L'utilisateur vient d'intervenir → Strategic Lead reprend la coordination
  if (last.agent_id === 'user') return 'strategic';

  // Sprint 7.1 — collecte des agents qui ont déjà parlé depuis le dernier
  // reset user (ou depuis le début si pas de reset). Synth n'est jamais
  // dans le pool de dédup (c'est un agent spécial déclenché manuellement).
  const spokenSinceReset = new Set();
  for (let i = history.length - 1; i >= 0; i--) {
    const a = history[i].agent_id;
    if (a === 'user') break;
    if (a && a !== 'synth') spokenSinceReset.add(a);
  }

  // Sprint 7.1.1 — Mention honorée UNIQUEMENT si Strategic Lead vient de
  // parler ET que l'agent mentionné n'a pas encore parlé dans le cycle.
  // Sinon, on suit strictement l'arc (les "citations rétroactives" type
  // "Strategic Lead a raison" sont du discours conversationnel, pas un
  // passage de parole).
  if (last.agent_id === 'strategic') {
    const mentioned = detectMentionInText(last.content);
    if (mentioned && mentioned !== 'strategic' && !spokenSinceReset.has(mentioned)) {
      return mentioned;
    }
  }

  // Rotation adaptée — Sprint 7 : chaque mode a son arc dédié
  // Sprint 7.1 — dédup : si le successeur naturel a déjà parlé, on avance
  // dans l'arc jusqu'à trouver un agent vierge. Max 9 sauts (1 par agent)
  // pour éviter toute boucle infinie.
  const arc = getArcForMode(mode);
  let candidate = arc[last.agent_id] || 'strategic';
  for (let i = 0; i < 9; i++) {
    if (!spokenSinceReset.has(candidate)) return candidate;
    candidate = arc[candidate] || 'strategic';
  }
  // Tous les agents ont déjà parlé → on retombe sur strategic (en pratique
  // shouldAutoPause aura déjà coupé avant ce point)
  return 'strategic';
}

// ─────────────────────────────────────────────────────────────────
// shouldAutoPause — quand s'arrêter de générer
// ─────────────────────────────────────────────────────────────────
// On compte le nombre de messages d'agents consécutifs depuis la
// dernière intervention utilisateur (ou le début). Si on dépasse
// le seuil, on arrête pour économiser des tokens et inviter le
// user à orienter la discussion.
// ─────────────────────────────────────────────────────────────────
export function shouldAutoPause(history, opts = {}) {
  const limit = opts.maxAgentTurns || DEFAULT_MAX_AGENT_TURNS_WITHOUT_USER;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].agent_id === 'user') break;
    count++;
    if (count >= limit) return true;
  }
  return count >= limit;
}

// ─────────────────────────────────────────────────────────────────
// shouldSummonSynthesizer — règle d'invitation du Synthesizer
// ─────────────────────────────────────────────────────────────────
// Sprint 2 : le Synthesizer n'apparaît PAS automatiquement (Sprint 5).
// Cette fonction reste pour le futur — pour l'instant elle retourne
// toujours false.
// ─────────────────────────────────────────────────────────────────
export function shouldSummonSynthesizer(history, opts = {}) {
  // Sprint 2 : pas d'invitation auto du Synthesizer.
  return false;
}
