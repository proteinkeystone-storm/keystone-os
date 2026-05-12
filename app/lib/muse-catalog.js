/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Muse Catalog Loader (Sprint Muse-1)
   ─────────────────────────────────────────────────────────────
   Charge le catalogue déclaratif des options Muse (supports,
   points de vue, lumières, saisons, végétations, figurations,
   styles, moteurs cibles) depuis K_STORE_ASSETS/CATALOG/.

   Évolution prévue : migration vers une entity 'muse_options'
   dans D1 avec admin Fabrique pour CRUD, sur le même pattern
   que kodex-catalog.js. Pour la v1, on charge un fichier JSON
   statique.
   ═══════════════════════════════════════════════════════════════ */

const OPTIONS_URL = '/K_STORE_ASSETS/CATALOG/muse-options-seed.json';

let _cache = null;
let _loading = null;

export async function loadOptions() {
  if (_cache) return _cache;
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const res = await fetch(OPTIONS_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      _cache = await res.json();
      return _cache;
    } catch (e) {
      console.warn('[MuseCatalog] échec chargement, fallback vide:', e.message);
      _cache = {
        supports: [], viewpoints: [], lights: [], seasons: [],
        vegetations: [], figurations: [], styles: [], target_engines: [],
      };
      return _cache;
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

// ── Helpers de sélection ──────────────────────────────────────
export async function getSupports()       { return (await loadOptions()).supports || []; }
export async function getViewpoints()     { return (await loadOptions()).viewpoints || []; }
export async function getLights()         { return (await loadOptions()).lights || []; }
export async function getSeasons()        { return (await loadOptions()).seasons || []; }
export async function getVegetations()    { return (await loadOptions()).vegetations || []; }
export async function getFigurations()    { return (await loadOptions()).figurations || []; }
export async function getStyles()         { return (await loadOptions()).styles || []; }
export async function getTargetEngines()  { return (await loadOptions()).target_engines || []; }

export async function getSupport(id)      { return (await getSupports()).find(s => s.id === id) || null; }
export async function getViewpoint(id)    { return (await getViewpoints()).find(v => v.id === id) || null; }
export async function getLight(id)        { return (await getLights()).find(l => l.id === id) || null; }
export async function getSeason(id)       { return (await getSeasons()).find(s => s.id === id) || null; }
export async function getVegetation(id)   { return (await getVegetations()).find(v => v.id === id) || null; }
export async function getFiguration(id)   { return (await getFigurations()).find(f => f.id === id) || null; }
export async function getStyle(id)        { return (await getStyles()).find(s => s.id === id) || null; }

// ── Cohérence ratio support ↔ orientation naturelle du cadrage ─
// Retourne null si OK, sinon un message d'alerte (utilisé par
// muse-prompt.js pour insérer une note de cohérence et par muse.js
// pour afficher un badge warning à l'écran).
export function checkRatioCoherence(supportRatio, viewpoint) {
  if (!supportRatio || !viewpoint) return null;
  const m = supportRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  const supportOrient = w > h ? 'horizontal' : (w < h ? 'vertical' : 'square');
  const vpOrient = viewpoint.natural_orientation || 'horizontal';
  if (supportOrient === 'square' || supportOrient === vpOrient) return null;
  return `Support ${supportRatio} (${supportOrient}) vs cadrage "${viewpoint.short}" (${vpOrient}). Le ratio --ar sera forcé sur le support pour éviter toute déformation.`;
}

// ── Le ratio Midjourney/Flux à pousser dans les prompts d'images ─
export function ratioToMjArg(ratio) {
  if (!ratio) return '';
  const m = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return '';
  return `--ar ${m[1]}:${m[2]}`;
}
