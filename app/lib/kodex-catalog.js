/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Catalog Loader (Sprint Kodex-2)
   ─────────────────────────────────────────────────────────────
   Charge le catalogue des standards techniques (imprimeurs, réseaux
   sociaux, presse) depuis K_STORE_ASSETS/CATALOG/.

   Évolution prévue : migration vers D1 entity 'standards' (tenant
   'shared') avec admin Fabrique pour CRUD. Pour la v1 du Sprint
   Kodex-2, on charge un fichier JSON statique (rapide, sans
   dépendance Worker).
   ═══════════════════════════════════════════════════════════════ */

const CATALOG_URL = '/K_STORE_ASSETS/CATALOG/kodex-standards-seed.json';
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
      _cache = { standards: [] };
      return _cache;
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

// ── Liste des vendors d'une catégorie (groupés) ───────────────
export async function getVendorsByCategory(category) {
  const data = await loadCatalog();
  const seen = new Set();
  const vendors = [];
  for (const s of data.standards) {
    if (s.category !== category) continue;
    if (seen.has(s.vendor)) continue;
    seen.add(s.vendor);
    vendors.push({
      vendor: s.vendor,
      count: data.standards.filter(x => x.category === category && x.vendor === s.vendor).length,
    });
  }
  return vendors;
}

// ── Liste des produits d'un vendor (filtrés par catégorie) ────
export async function getProductsByVendor(category, vendor) {
  const data = await loadCatalog();
  return data.standards.filter(s => s.category === category && s.vendor === vendor);
}

// ── Récupère une fiche standard par id ────────────────────────
export async function getStandard(id) {
  const data = await loadCatalog();
  return data.standards.find(s => s.id === id) || null;
}

// ── Helpers de formatage pour l'UI ────────────────────────────
export function formatDimensions(std) {
  const f = std.format_fini;
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
  if (!std.bleed_mm && std.bleed_mm !== 0) return null;
  return std.bleed_mm === 0 ? 'Aucun fond perdu' : `${std.bleed_mm} mm de fond perdu`;
}

export function formatDpi(std) {
  if (!std.dpi) return null;
  return `${std.dpi} DPI`;
}

// ── Catégorie display label ──────────────────────────────────
export const CATEGORY_LABELS = {
  print:  { label: 'Une impression',     icon: 'printer' },
  social: { label: 'Les réseaux sociaux', icon: 'globe' },
  press:  { label: 'Un magazine',         icon: 'book-open' },
  custom: { label: 'Un format à moi',     icon: 'custom' },
};

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
