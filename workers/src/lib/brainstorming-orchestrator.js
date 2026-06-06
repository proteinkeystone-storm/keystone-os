/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Brainstorming · Orchestrateur (Sprint 2)
   ─────────────────────────────────────────────────────────────────

   Décide quel agent doit parler ensuite dans la discussion.
   Sprint 2 : heuristiques déterministes (mention explicite > rotation
   adaptée au mode cognitif > fallback rotation).
   Sprint 3+ : intelligence accrue (mini-LLM décideur, pondérations
   apprises, pacing rhythm system).

   API exposée :
     pickNextAgent(history, mode, roster?) → string (agent_id)
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
// Sprint 7.2 — AGENT_TRIGGERS : déclencheurs sémantiques par agent
// ─────────────────────────────────────────────────────────────────
// Chaque agent intervient quand le dernier message contient des mots-clés
// liés à sa spécialité. Plus le score est élevé, plus l'agent est
// pertinent pour rebondir. strategic est exclu du scoring (il n'intervient
// qu'en ouverture ou après reset user).
//
// Mots-clés en minuscules, sans accents quand possible (matchage simple).
// On match aussi les variantes avec accents grâce à un includes() permissif.
// ─────────────────────────────────────────────────────────────────
export const AGENT_TRIGGERS = {
  creative: [
    'concept', 'idée', 'idee', 'rupture', 'audacieux', 'audace', 'visuel',
    'émotion', 'emotion', 'storytelling', 'créatif', 'creatif', 'angle créatif',
    'angle creatif', 'narratif', 'impactant', 'puissant', 'manifeste', 'symbole',
    'campagne', 'esthétique', 'esthetique', 'inspirant', 'mémorable', 'memorable',
  ],
  growth: [
    'acquisition', 'rétention', 'retention', 'viralité', 'viralite', 'canal',
    'kpi', 'conversion', 'roi', 'scale', 'growth', 'funnel', 'lead', 'leads',
    'traffic', 'trafic', 'channel', 'mécanisme viral', 'mecanisme viral',
    'levier', 'leviers', 'distribution', 'monétisation', 'monetisation',
    'pricing', 'paywall', 'onboarding', 'churn',
  ],
  consumer: [
    'audience', 'client', 'clients', 'utilisateur', 'utilisateurs', 'désir',
    'desir', 'frustration', 'comportement', 'motivation', 'persona', 'humain',
    'psychologie', 'besoin', 'besoins', 'émotionnel', 'emotionnel', 'attente',
    'attentes', 'cible', 'public', 'expérience', 'experience', 'usage', 'pain',
    'douleur', 'jobs-to-be-done', 'jtbd', 'insight',
  ],
  brand: [
    'identité', 'identite', 'marque', 'ton', 'perception', 'valeur', 'valeurs',
    'image', 'cohérence', 'coherence', 'long-terme', 'positionnement',
    'réputation', 'reputation', 'manifeste', 'signature', 'voix', 'voice',
    'tone of voice', 'archetype', 'archétype', 'premium', 'luxe', 'prestige',
    'haut de gamme',
  ],
  cultural: [
    'tendance', 'tendances', 'moment', 'culture', 'mouvement', 'tiktok',
    'reddit', 'twitter', 'instagram', 'linkedin', 'niche', 'communauté',
    'communaute', 'génération', 'generation', 'signal', 'signaux', 'viral',
    'buzz', 'mème', 'meme', 'gen z', 'millennials', 'sous-culture', 'micro-influenceur',
    'créateur', 'createur', 'influenceur',
  ],
  data: [
    'chiffre', 'chiffres', 'données', 'donnees', 'marché', 'marche', 'taille',
    'ordre de grandeur', 'estimation', 'cac', 'ltv', 'marge', 'stat',
    'pourcentage', 'b2b', 'b2c', 'métriques', 'metriques', 'mesurer', 'quantif',
    'roi', 'revenue', 'revenu', 'arr', 'mrr', 'tam', 'sam', 'som', 'segment',
    'volumes', 'volume', 'million', 'milliard', 'taux',
  ],
  devil: [
    'risque', 'risques', 'faiblesse', 'faiblesses', 'limite', 'limites',
    'concurrent', 'concurrence', 'concurrents', 'danger', 'doute', 'hypothèse',
    'hypothese', 'cliché', 'cliche', 'saturé', 'sature', 'fragile', 'incertain',
    'difficulté', 'difficulte', 'défi', 'defi', 'obstacle', 'biais', 'naïf',
    'naif', 'évident', 'evident', 'banal', 'générique', 'generique', 'safe',
    'consensus', 'mou', 'sans relief',
  ],
};

// Sprint 7.2 — Garantie tour de table complet : à partir de ce nombre
// d'agents qui ont déjà parlé dans le cycle, on bascule du scoring
// sémantique vers le fallback arc pour forcer les agents restants à
// passer (Devil's Advocate inclus, même si peu de mots-clés "négatifs"
// dans le débat).
const SCORING_CUTOFF_SPOKEN = 5;

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
// scoreAgentRelevance — Sprint 7.2
// ─────────────────────────────────────────────────────────────────
// Compte le nombre de triggers de l'agent présents dans le texte. Le
// match est case-insensitive et accent-insensitive léger (les triggers
// existent en double pour les formes accentuées). Score = nombre de
// triggers distincts trouvés.
// ─────────────────────────────────────────────────────────────────
export function scoreAgentRelevance(agentId, text) {
  const triggers = AGENT_TRIGGERS[agentId];
  if (!triggers || typeof text !== 'string') return 0;
  const lower = text.toLowerCase();
  let score = 0;
  const seen = new Set();
  for (const t of triggers) {
    // On considère un trigger comme "matché" si présent en sous-chaîne
    // entourée de séparateurs (évite "ron" match dans "Aaron")
    const idx = lower.indexOf(t);
    if (idx < 0) continue;
    const before = idx === 0 ? ' ' : lower[idx - 1];
    const after  = lower[idx + t.length] || ' ';
    if (/[\s,.;:!?'"()«»\-]/.test(before) && /[\s,.;:!?'"()«»\-]/.test(after)) {
      // Dédupliquer les triggers qui matchent la même portion de texte
      const key = `${idx}:${t.length}`;
      if (!seen.has(key)) { seen.add(key); score++; }
    }
  }
  return score;
}

// ─────────────────────────────────────────────────────────────────
// pickNextAgent — heuristiques Sprint 7.2 (boardroom organique)
// ─────────────────────────────────────────────────────────────────
// Logique :
//   1. Si history vide → Strategic Lead (ouvre)
//   2. Si dernière intervention = 'user' → Strategic Lead (re-cadre)
//   3. Si Strategic vient de parler ET cite un agent vierge → cet agent
//      (filet de sécurité, normalement Strategic ne nomme plus en
//      Sprint 7.2 — seulement en ouverture)
//   4. Si moins de SCORING_CUTOFF_SPOKEN agents ont parlé :
//      SCORING SÉMANTIQUE. Chaque agent non-parlé est scoré sur sa
//      pertinence par rapport au dernier message (via AGENT_TRIGGERS).
//      Le meilleur score gagne. Si plusieurs ex-aequo, on prend le 1er
//      dans l'ordre de l'arc.
//   5. Sinon (≥ SCORING_CUTOFF_SPOKEN agents ont parlé) OU aucun
//      candidat pertinent : FALLBACK ARC. On suit l'arc du mode avec
//      dédup, ce qui garantit que les agents restants (Devil inclus)
//      passent avant la fin du cycle.
// ─────────────────────────────────────────────────────────────────
export function pickNextAgent(history, mode = 'exploration', roster = null) {
  if (!Array.isArray(history) || history.length === 0) return 'strategic';

  // Sprint 7.12 — comité réduit : roster = liste d'ids d'agents de débat
  // autorisés. null/vide ⇒ comité complet (comportement historique, zéro
  // régression). strategic est toujours autorisé (obligatoire, ouvre/coordonne).
  const rosterSet = Array.isArray(roster) && roster.length ? new Set(roster) : null;
  const inRoster  = (id) => !rosterSet || id === 'strategic' || rosterSet.has(id);
  // Nombre d'agents de débat (hors synth) → pilote le seuil scoring→arc :
  // pour un petit comité, on bascule plus tôt sur l'arc pour garantir que
  // les derniers agents passent quand même.
  const debateCount = rosterSet ? [...rosterSet].filter(id => id !== 'synth').length : 8;
  const cutoff = rosterSet
    ? Math.min(SCORING_CUTOFF_SPOKEN, Math.max(1, debateCount - 2))
    : SCORING_CUTOFF_SPOKEN;

  const last = history[history.length - 1];

  // L'utilisateur vient d'intervenir → Strategic Lead reprend la coordination
  if (last.agent_id === 'user') return 'strategic';

  // Collecte des agents qui ont déjà parlé depuis le dernier reset user
  const spokenSinceReset = new Set();
  for (let i = history.length - 1; i >= 0; i--) {
    const a = history[i].agent_id;
    if (a === 'user') break;
    if (a && a !== 'synth') spokenSinceReset.add(a);
  }

  // Sprint 7.1.1 — Mention par Strategic Lead (filet de sécurité)
  if (last.agent_id === 'strategic') {
    const mentioned = detectMentionInText(last.content);
    if (mentioned && mentioned !== 'strategic' && inRoster(mentioned) && !spokenSinceReset.has(mentioned)) {
      return mentioned;
    }
  }

  // Sprint 7.2 — Scoring sémantique pour la phase d'exploration (5 premiers)
  // À partir de SCORING_CUTOFF_SPOKEN agents parlés, on garantit le tour
  // de table en suivant l'arc (Devil inclus).
  if (spokenSinceReset.size < cutoff) {
    const candidates = [];
    for (const agentId of Object.keys(AGENT_TRIGGERS)) {
      if (!inRoster(agentId)) continue;            // hors comité → ignoré
      if (spokenSinceReset.has(agentId)) continue;
      if (agentId === last.agent_id) continue;
      if (agentId === 'strategic') continue; // Strategic ne reprend pas spontanément
      const score = scoreAgentRelevance(agentId, last.content || '');
      if (score > 0) candidates.push({ agentId, score });
    }
    if (candidates.length > 0) {
      // Trier par score décroissant. Ex-aequo : ordre de l'arc du mode
      const arcForTiebreak = getArcForMode(mode);
      const arcOrder = Object.keys(arcForTiebreak);
      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return arcOrder.indexOf(a.agentId) - arcOrder.indexOf(b.agentId);
      });
      return candidates[0].agentId;
    }
  }

  // Fallback arc — dédup + filtre comité : garantit que tous les agents DU
  // COMITÉ passent (Devil inclus), en sautant ceux hors-roster. Borne à 10
  // pour traverser le cycle complet (8 entrées) même avec des sauts.
  const arc = getArcForMode(mode);
  let candidate = arc[last.agent_id] || 'strategic';
  for (let i = 0; i < 10; i++) {
    if (inRoster(candidate) && !spokenSinceReset.has(candidate)) return candidate;
    candidate = arc[candidate] || 'strategic';
  }
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
