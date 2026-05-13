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
        brand_tones: [], core_values: [], channels: [], stages: [],
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
export async function getBrandTones()   { return (await loadModes()).brand_tones || []; }
export async function getCoreValues()   { return (await loadModes()).core_values || []; }
export async function getChannels()     { return (await loadModes()).channels || []; }
export async function getStages()       { return (await loadModes()).stages || []; }

// ── Calcul du score "Qualité du brief" (0-100) ────────────────
// Utilisé par la jauge live (sticky en haut) de la vue Calibrate pour
// donner un feedback visuel constant. Plus le score est élevé, plus le
// brainstorm IA produira des idées affûtées. Distribution :
//   · Programme    35 pts (nom 15 / lieu 5 / description 15)
//   · ADN          25 pts (ton 10 / valeur 10 / mots-clés in 5)
//   · Calibrage    25 pts (cibles 10 / inspirations 5 / sliders 5 / temps 5)
//   · Raffinements 15 pts (mots-clés out 5 / canal 5 / stade 5)
export function computeBriefQualityScore(state) {
  const c = state.calibrate || {};
  let score = 0;

  // ── Programme · 35 pts ─────────────────────────────────────
  if (c.program_name      && c.program_name.trim().length      > 1)  score += 15;
  if (c.program_location  && c.program_location.trim().length  > 1)  score += 5;
  if (c.program_description && c.program_description.trim().length > 10) score += 15;

  // ── ADN · 25 pts ───────────────────────────────────────────
  const brandTones  = Array.isArray(c.brand_tones)  ? c.brand_tones  : [];
  const keywordsIn  = Array.isArray(c.keywords_in)  ? c.keywords_in  : [];
  if (brandTones.length >= 1)  score += 10;
  if (c.core_value)            score += 10;
  if (keywordsIn.length >= 2)  score += 5;

  // ── Calibrage · 25 pts ─────────────────────────────────────
  const targets      = Array.isArray(c.targets)      ? c.targets      : [];
  const inspirations = Array.isArray(c.inspirations) ? c.inspirations : [];
  if (targets.length      >= 1) score += 10;
  if (inspirations.length >= 1) score += 5;
  const sliderDefault = 50;
  const sliders = ['tonality', 'tone', 'format', 'boldness'];
  if (sliders.some(s => Math.abs((c[s] ?? sliderDefault) - sliderDefault) > 10)) {
    score += 5;
  }
  if (c.time_budget && c.time_budget !== '10min') score += 5;

  // ── Raffinements · 15 pts ──────────────────────────────────
  const keywordsOut = Array.isArray(c.keywords_out) ? c.keywords_out : [];
  if (keywordsOut.length >= 1) score += 5;
  if (c.main_channel)          score += 5;
  if (c.stage)                 score += 5;

  return Math.min(100, score);
}

// ── Palier visuel selon le score ──────────────────────────────
export function getQualityTier(score) {
  if (score < 30)  return { label: 'Brouillon',    color: 'var(--ws-text-muted)' };
  if (score < 60)  return { label: 'Bonne base',   color: '#3b82f6' };
  if (score < 85)  return { label: 'Précis',       color: 'var(--gold)' };
  return                  { label: 'Excellent ✨', color: 'var(--green)' };
}

// ── Message d'encouragement contextuel selon l'état du brief ──
// Pousse l'utilisateur·trice à compléter ce qui manque le plus,
// sans culpabiliser. Affiché à droite de la jauge sticky.
export function getEncouragementMessage(state) {
  const c = state.calibrate || {};
  const missing = [];
  if (!c.program_name || c.program_name.trim().length < 2)            missing.push("le nom du programme");
  if (!c.program_description || c.program_description.trim().length < 10) missing.push("une description en 2-3 lignes");
  if (!c.core_value)                                                   missing.push("la valeur centrale");
  if (!(Array.isArray(c.brand_tones) && c.brand_tones.length))         missing.push("le ton de marque");
  if (!(Array.isArray(c.targets) && c.targets.length))                 missing.push("au moins une cible acheteur");

  if (missing.length === 0) {
    return { type: 'ready', text: "Brief excellent — le brainstorm va être affûté." };
  }
  if (missing.length <= 2) {
    return { type: 'almost', text: "Encore un effort : ajoutez " + missing.join(" et ") + "." };
  }
  return { type: 'start', text: "Démarrez en remplissant " + missing[0] + "." };
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
