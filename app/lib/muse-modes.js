/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Muse Modes Loader (Sprint Muse-Brainstorm-J1)
   ─────────────────────────────────────────────────────────────
   Charge le catalogue déclaratif des modes de brainstorming Muse
   depuis K_STORE_ASSETS/CATALOG/muse-modes-seed.json.

   Modes (6) : Naming, Punchline, Ambiance, Marketing, Objections,
   Mix-all. Chaque mode pilote l'étape 3 (brainstorm IA) avec son
   propre prompt_role + prompt_instruction + output_schema.

   Évolution prévue : migration vers une entity D1 'muse_modes'
   avec admin Fabrique pour CRUD. Pour la v1, JSON statique.
   ═══════════════════════════════════════════════════════════════ */

const MODES_URL = '/K_STORE_ASSETS/CATALOG/muse-modes-seed.json';

let _cache = null;
let _loading = null;

export async function loadModes() {
  if (_cache) return _cache;
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const res = await fetch(MODES_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      _cache = await res.json();
      return _cache;
    } catch (e) {
      console.warn('[MuseModes] échec chargement, fallback vide:', e.message);
      _cache = {
        modes: [], sliders: [], time_budgets: [],
        targets: [], inspirations: [], frameworks: [],
      };
      return _cache;
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

export async function getModes()        { return (await loadModes()).modes || []; }
export async function getMode(id)       { return (await getModes()).find(m => m.id === id) || null; }
export async function getSliders()      { return (await loadModes()).sliders || []; }
export async function getTimeBudgets()  { return (await loadModes()).time_budgets || []; }
export async function getTargets()      { return (await loadModes()).targets || []; }
export async function getInspirations() { return (await loadModes()).inspirations || []; }
export async function getFrameworks()   { return (await loadModes()).frameworks || []; }

// ── Calcul du score "Qualité du brief" (0-100) ────────────────
// Utilisé par la jauge live de la vue Calibrate pour donner un
// feedback visuel à l'utilisateur sur la complétude de son brief.
// Plus le score est élevé, plus le brainstorm sera précis.
export function computeBriefQualityScore(state) {
  const c = state.calibrate || {};
  let score = 0;

  // Programme (50 pts)
  if (c.program_name      && c.program_name.trim().length      > 1)  score += 20;
  if (c.program_location  && c.program_location.trim().length  > 1)  score += 10;
  if (c.program_description && c.program_description.trim().length > 10) score += 20;

  // Calibrage (30 pts)
  const targets      = Array.isArray(c.targets)      ? c.targets      : [];
  const inspirations = Array.isArray(c.inspirations) ? c.inspirations : [];
  if (targets.length      >= 1) score += 15;
  if (inspirations.length >= 1) score += 10;

  // Au moins 1 curseur déplacé hors centre (5)
  const sliderDefault = 50;
  const sliders = ['tonality', 'tone', 'format', 'boldness'];
  if (sliders.some(s => Math.abs((c[s] ?? sliderDefault) - sliderDefault) > 10)) {
    score += 5;
  }

  // Extra (15 pts)
  if (c.extra && c.extra.trim().length > 5) score += 15;

  return Math.min(100, score);
}

// ── Palier visuel selon le score ──────────────────────────────
export function getQualityTier(score) {
  if (score < 30)  return { label: 'Brouillon',    color: 'var(--ws-text-muted)' };
  if (score < 60)  return { label: 'Bonne base',   color: '#3b82f6' };
  if (score < 85)  return { label: 'Précis',       color: 'var(--gold)' };
  return                  { label: 'Excellent ✨', color: 'var(--green)' };
}

// ── Mots de stimulus aléatoire (Oblique Strategies-like) ──────
// Utilisé par le bouton "Surprends-moi" pour débloquer la
// créativité. Sera injecté dans le prompt LLM en J2.
const STIMULUS_WORDS = [
  'horizon', 'silence', 'patine', 'éclat', 'racines', 'frontière',
  'serment', 'tissage', 'rebond', 'écho', 'sillon', 'voilure',
  'cadence', 'crinière', 'orée', 'creuset', 'éclipse', 'fanal',
  'remous', 'verger', 'amplitude', 'reliure', 'crépuscule', 'belvédère',
  'estran', 'oriel', 'paradoxe', 'écaille', 'soufflerie', 'vermeil',
];

export function pickStimulusWord() {
  return STIMULUS_WORDS[Math.floor(Math.random() * STIMULUS_WORDS.length)];
}
