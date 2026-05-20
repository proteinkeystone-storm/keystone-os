/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Catalog Loader (Sprint Kodex universel)
   ─────────────────────────────────────────────────────────────
   Charge le catalogue universel des presets depuis
   K_STORE_ASSETS/CATALOG/kodex-presets-seed.json.

   v2 (mai 2026) : refonte universelle. Plus de hiérarchie
   vendor → produit. L'utilisateur choisit une catégorie
   (print_paper, large_format, digital, press), clique un
   preset qui pré-remplit le formulaire universel, ou saisit
   directement ses valeurs (Sur-mesure).

   Chaque preset porte uniquement les données minimales :
     - category   (pour le filtre par onglet)
     - label      (titre affiché)
     - icon       (picto Keystone)
     - type_support (description courte du support)
     - format_fini (dimensions par défaut, optionnel)
     - bleed_mm_override / safe_margin_mm_override (optionnel)
     - notes      (texte additionnel)
     - is_custom  (true = card "Sur-mesure", dimensions vides)
     - is_dim_free (true = dimensions à saisir mais defaults catégorie)

   Les valeurs techniques de référence (CMJN, DPI, export…) viennent
   de la catégorie via `defaults`. Le preset peut overrider via
   *_override.
   ═══════════════════════════════════════════════════════════════ */

const PRESETS_URL = '/K_STORE_ASSETS/CATALOG/kodex-presets-seed.json';
const SECTORS_URL = '/K_STORE_ASSETS/CATALOG/kodex-sectors-seed.json';

let _cache = null;
let _loading = null;

// ── Charge (ou retourne le cache) le catalogue complet ────────
export async function loadPresets() {
  if (_cache) return _cache;
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const res = await fetch(PRESETS_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      _cache = data;
      return data;
    } catch (e) {
      console.warn('[KodexCatalog] échec chargement, fallback vide:', e.message);
      _cache = { categories: [], presets: [] };
      return _cache;
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

// ── Liste des catégories ─────────────────────────────────────
export async function loadCategories() {
  const data = await loadPresets();
  return data.categories || [];
}

// ── Catégorie par id ─────────────────────────────────────────
export async function getCategory(id) {
  const data = await loadPresets();
  return (data.categories || []).find(c => c.id === id) || null;
}

// ── Defaults techniques d'une catégorie ──────────────────────
export async function getCategoryDefaults(id) {
  const cat = await getCategory(id);
  return cat?.defaults || {};
}

// ── Liste des presets d'une catégorie ────────────────────────
export async function getPresetsByCategory(categoryId) {
  const data = await loadPresets();
  return (data.presets || []).filter(p => p.category === categoryId);
}

// ── Preset par id ────────────────────────────────────────────
export async function getPreset(id) {
  const data = await loadPresets();
  return (data.presets || []).find(p => p.id === id) || null;
}

/**
 * Fabrique l'objet `standard` (forme historique utilisée par
 * kodex-prompt.js / kodex-pdf.js / kodex-scale.js) à partir d'un
 * preset + des defaults de sa catégorie.
 *
 * Le résultat est l'objet placé dans `_state.destination.standard`.
 * Tous les champs sont ensuite modifiables par l'utilisateur.
 *
 * @param {object} preset   un preset issu du catalogue
 * @param {object} catDefaults defaults techniques de la catégorie
 * @returns {object} standard prêt à être placé dans _state
 */
export function presetToStandard(preset, catDefaults = {}) {
  const std = {
    id: preset.id,
    type_support: preset.type_support || preset.label || '',
    product_name: preset.type_support || preset.label || '',
    vendor: '',
    format_fini: preset.format_fini ? { ...preset.format_fini } : {},
    bleed_mm: (preset.bleed_mm_override != null)
      ? preset.bleed_mm_override
      : (catDefaults.bleed_mm ?? 0),
    safe_margin_mm: (preset.safe_margin_mm_override != null)
      ? preset.safe_margin_mm_override
      : (catDefaults.safe_margin_mm ?? 0),
    dpi: (preset.dpi_override != null)
      ? preset.dpi_override
      : (catDefaults.dpi ?? null),
    color_profile: preset.color_profile_override || catDefaults.color_profile || '',
    export_format: preset.export_format_override || catDefaults.export_format || '',
    material: '',
    notes: preset.notes || '',
  };
  return std;
}

// ── Helpers de formatage pour l'UI ────────────────────────────
export function formatDimensions(std) {
  const f = std?.format_fini;
  if (!f) return '—';
  if (f.width_mm && f.height_mm) {
    if (f.width_mm >= 1000 || f.height_mm >= 1000) {
      return `${(f.width_mm / 10).toFixed(0)} × ${(f.height_mm / 10).toFixed(0)} cm`;
    }
    return `${f.width_mm} × ${f.height_mm} mm`;
  }
  if (f.width_px && f.height_px) {
    return `${f.width_px} × ${f.height_px} px`;
  }
  return '—';
}

export function formatBleed(std) {
  if (std?.bleed_mm == null) return null;
  return std.bleed_mm === 0 ? 'Aucun fond perdu' : `${std.bleed_mm} mm de fond perdu`;
}

export function formatDpi(std) {
  if (!std?.dpi) return null;
  return `${std.dpi} DPI`;
}

// ═══════════════════════════════════════════════════════════════
// Profils métier (sectors) — pattern identique au catalogue
// ═══════════════════════════════════════════════════════════════
let _sectorsCache = null;
let _sectorsLoading = null;

export async function loadSectors() {
  if (_sectorsCache) return _sectorsCache;
  if (_sectorsLoading) return _sectorsLoading;
  _sectorsLoading = (async () => {
    try {
      const res = await fetch(SECTORS_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      _sectorsCache = data;
      return data;
    } catch (e) {
      console.warn('[KodexSectors] échec chargement, fallback vide:', e.message);
      _sectorsCache = { sectors: [] };
      return _sectorsCache;
    } finally {
      _sectorsLoading = null;
    }
  })();
  return _sectorsLoading;
}

export async function getSector(id) {
  const data = await loadSectors();
  return data.sectors.find(s => s.id === id) || null;
}

export async function getDefaultSector() {
  const data = await loadSectors();
  return data.sectors.find(s => s.is_default) || data.sectors[0] || null;
}

// Calcule la liste des mentions légales applicables selon les
// labels/dispositifs choisis dans content.fields.
export function computeLegalMentions(sector, fieldValues) {
  if (!sector) return [];
  const mentions = [];
  const lm = sector.legal_mentions || {};
  (lm.always || []).forEach(m => mentions.push(m));
  const byLabel = lm.by_label || {};
  const selectedLabels = fieldValues?.labels || [];
  const selectedArray = Array.isArray(selectedLabels) ? selectedLabels : [selectedLabels];
  for (const lab of selectedArray) {
    if (byLabel[lab]) mentions.push(byLabel[lab]);
  }
  return mentions;
}
