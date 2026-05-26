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

// Limite Sprint 2 : 3 messages d'agents consécutifs sans intervention
// utilisateur, puis auto-pause pour éviter le burn de tokens.
const DEFAULT_MAX_AGENT_TURNS_WITHOUT_USER = 3;

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
// pickNextAgent — heuristiques Sprint 2
// ─────────────────────────────────────────────────────────────────
// Règles dans l'ordre :
//   1. Si history vide → Strategic Lead (ouvre toujours la discussion)
//   2. Si la dernière intervention est de 'user' → Strategic Lead (re-cadre)
//   3. Si le dernier message contient une mention explicite → cet agent
//   4. Sinon → rotation adaptée selon qui vient de parler
// ─────────────────────────────────────────────────────────────────
export function pickNextAgent(history, mode = 'exploration') {
  if (!Array.isArray(history) || history.length === 0) return 'strategic';

  const last = history[history.length - 1];

  // L'utilisateur vient d'intervenir → Strategic Lead reprend la coordination
  if (last.agent_id === 'user') return 'strategic';

  // Mention explicite ("Creative Director, ton angle ?")
  const mentioned = detectMentionInText(last.content);
  if (mentioned && mentioned !== last.agent_id) return mentioned;

  // Rotation adaptée — Sprint 2 : séquence fixée pour le mode "exploration"
  // qui suit un arc narratif éprouvé (cadrage → idée → challenge → humain →
  // culture → marché → cadrage).
  // Sprint 7 : chaque mode aura son propre arc (Launch privilégie growth+data,
  // Crisis privilégie devil+brand, etc.).
  const explorationArc = {
    strategic : 'creative',
    creative  : 'devil',
    devil     : 'consumer',
    consumer  : 'cultural',
    cultural  : 'growth',
    growth    : 'brand',
    brand     : 'data',
    data      : 'strategic',
    synth     : 'strategic',
  };
  return explorationArc[last.agent_id] || 'strategic';
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
