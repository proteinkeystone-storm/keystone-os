/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Catalog Loader (v3 vendor-aware)
   ─────────────────────────────────────────────────────────────
   Charge le catalogue Kodex depuis
   K_STORE_ASSETS/CATALOG/kodex-vendors-seed.json (3 entités liées).

   Modèle (mai 2026) :
     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
     │  CATEGORIES  │    │   VENDORS    │    │   SUPPORTS   │
     │  (4 onglets) │    │  (4 niveaux) │    │ (universels) │
     └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
            │                   │                   │
            └───────► SPECS (vendor × support) ◄────┘
                     bleed, safe, dpi, notes précises

   Niveaux de vendor :
     - level 1 (Exaprint)         : 22 supports, specs riches FR/ES
     - level 2 (Vistaprint/Pixart): specs commerciales connues
     - level 3 (other)            : saisie libre, defaults catégorie

   API publique :
     loadCatalog()                            cache complet
     loadCategories() / getCategory(id)       catégories
     getCategoryDefaults(id)                  defaults techniques
     loadVendors() / getVendor(id)            vendors
     loadSupports() / getSupport(id)          supports universels
     getSupportsByCategory(catId)             filtre par tab
     getVendorsForSupport(supportId)          ↑ pills VENDOR de l'UI
     getSpec(vendorId, supportId)             jonction n×m
     specToStandard(spec, vendor, support, catDefaults)
                                              → objet standard pour _state

   Rétro-compat (briefs D1 et drafts localStorage) :
     loadPresets() / getPreset(id) / presetToStandard()
     Ces aliases reconstruisent l'ancien format à partir de SUPPORTS
     (presets ≡ supports avec champ category). Aucun changement DB requis.

   Sector unique « universal » : Kodex est volontairement non-segmenté
   (mai 2026). La structure `sector` reste utilisée pour décrire les
   champs du formulaire étape 2 (nom_projet, lieu, échéance, argumentaire…)
   sans préjuger du métier du user.
   ═══════════════════════════════════════════════════════════════ */

const CATALOG_URL = '/K_STORE_ASSETS/CATALOG/kodex-vendors-seed.json';
const SECTORS_URL = '/K_STORE_ASSETS/CATALOG/kodex-sectors-seed.json';

let _cache = null;
let _loading = null;

// ── Charge (ou retourne le cache) le catalogue complet ────────
export async function loadCatalog() {
  if (_cache) return _cache;
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const res = await fetch(CATALOG_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      _cache = data;
      return data;
    } catch (e) {
      console.warn('[KodexCatalog] échec chargement, fallback vide:', e.message);
      _cache = { categories: [], vendors: [], supports: [], specs: [] };
      return _cache;
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

// ═══════════════════════════════════════════════════════════════
// Categories
// ═══════════════════════════════════════════════════════════════
export async function loadCategories() {
  const data = await loadCatalog();
  return data.categories || [];
}

export async function getCategory(id) {
  const data = await loadCatalog();
  return (data.categories || []).find(c => c.id === id) || null;
}

export async function getCategoryDefaults(id) {
  const cat = await getCategory(id);
  return cat?.defaults || {};
}

// ═══════════════════════════════════════════════════════════════
// Vendors
// ═══════════════════════════════════════════════════════════════
export async function loadVendors() {
  const data = await loadCatalog();
  return data.vendors || [];
}

export async function getVendor(id) {
  const data = await loadCatalog();
  return (data.vendors || []).find(v => v.id === id) || null;
}

// Renvoie les vendors qui supportent un support donné (pour la rangée
// de pills VENDOR de l'UI). Le vendor "other" (level 3) est toujours
// inclus en dernier car il accepte tous les supports.
export async function getVendorsForSupport(supportId) {
  const data = await loadCatalog();
  const out = [];
  for (const v of data.vendors || []) {
    if (v.supports === '*') { out.push(v); continue; }
    if (Array.isArray(v.supports) && v.supports.includes(supportId)) out.push(v);
  }
  // Tri : par level ascendant (1 = plus riche) puis "other" toujours dernier
  out.sort((a, b) => {
    if (a.id === 'other') return 1;
    if (b.id === 'other') return -1;
    return (a.level || 99) - (b.level || 99);
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════
// Supports (universels — réunion des catalogues vendors)
// ═══════════════════════════════════════════════════════════════
export async function loadSupports() {
  const data = await loadCatalog();
  return data.supports || [];
}

export async function getSupport(id) {
  const data = await loadCatalog();
  return (data.supports || []).find(s => s.id === id) || null;
}

export async function getSupportsByCategory(categoryId) {
  const data = await loadCatalog();
  return (data.supports || []).filter(s => s.category === categoryId);
}

// ═══════════════════════════════════════════════════════════════
// Specs (jonction vendor × support)
// ═══════════════════════════════════════════════════════════════
export async function getSpec(vendorId, supportId) {
  if (!vendorId || !supportId) return null;
  const data = await loadCatalog();
  return (data.specs || []).find(
    s => s.vendor_id === vendorId && s.support_id === supportId
  ) || null;
}

// ═══════════════════════════════════════════════════════════════
// Hydratation du `standard` (objet placé dans _state.destination)
// ─────────────────────────────────────────────────────────────
// Priorité des sources, de la plus précise à la plus générique :
//   1. spec.bleed_mm / safe / dpi / notes        (couple vendor × support)
//   2. support.default_format                    (dims par défaut du support)
//   3. vendor.color_profile / export_format       (defaults vendor global)
//   4. catDefaults                                (fallback catégorie)
//
// Le résultat conserve la forme historique attendue par kodex-prompt.js,
// kodex-pdf.js et kodex-scale.js (clé `vendor` en string, `format_fini`
// en mm ou px). On ajoute `vendor_id` pour pouvoir re-hydrater proprement.
// ═══════════════════════════════════════════════════════════════
export function specToStandard(spec, vendor, support, catDefaults = {}) {
  const vendorLabel = vendor?.label || '';
  const v = vendor || {};
  const s = support || {};
  const sp = spec || {};

  return {
    id: support?.id || null,
    type_support: s.type_support || s.label || '',
    product_name: s.type_support || s.label || '',

    vendor: vendorLabel,
    vendor_id: vendor?.id || null,

    format_fini: s.default_format ? { ...s.default_format } : {},

    bleed_mm: (sp.bleed_mm != null)
      ? sp.bleed_mm
      : (catDefaults.bleed_mm ?? 0),

    safe_margin_mm: (sp.safe_margin_mm != null)
      ? sp.safe_margin_mm
      : (catDefaults.safe_margin_mm ?? 0),

    dpi: (sp.dpi != null)
      ? sp.dpi
      : (catDefaults.dpi ?? null),

    color_profile: v.color_profile || catDefaults.color_profile || '',
    export_format: v.export_format || catDefaults.export_format || '',

    material: '',
    // Note prioritaire : spec > support > vide
    notes: sp.notes || s.notes || '',
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers de formatage pour l'UI
// ═══════════════════════════════════════════════════════════════
export function formatDimensions(std) {
  // Accepte aussi bien un `standard` (format_fini) qu'un `support` brut (default_format)
  const f = std?.format_fini || std?.default_format;
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
  if (std.bleed_mm === 0) return 'Aucun fond perdu';
  return `${std.bleed_mm} mm de fond perdu`;
}

export function formatDpi(std) {
  if (!std?.dpi) return null;
  return `${std.dpi} DPI`;
}

// ═══════════════════════════════════════════════════════════════
// RÉTRO-COMPATIBILITÉ — anciennes APIs utilisées par les briefs D1
// ─────────────────────────────────────────────────────────────
// Aucun code applicatif récent ne devrait appeler ces fonctions ; elles
// existent uniquement pour ne pas casser les briefs sauvegardés en D1
// (champ preset_id) lors de leur ré-ouverture depuis la bibliothèque.
// ═══════════════════════════════════════════════════════════════
export async function loadPresets() {
  const data = await loadCatalog();
  // Reconstruit l'ancien format { categories, presets }
  return { categories: data.categories || [], presets: data.supports || [] };
}

export async function getPreset(id) {
  return getSupport(id);
}

// Le vieux presetToStandard prenait un preset (≡ support) + catDefaults.
// On le réimplémente comme un appel à specToStandard sans vendor (level 3).
export function presetToStandard(preset, catDefaults = {}) {
  return specToStandard(null, null, preset, catDefaults);
}

export async function getPresetsByCategory(categoryId) {
  return getSupportsByCategory(categoryId);
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
