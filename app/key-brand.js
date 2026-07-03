// ═══════════════════════════════════════════════════════════════
// KEY BRAND — Pad O-BRD-001 · KB-0 (socle & bibliothèque)
//
// La charte graphique qu'on manipule au lieu de la lire : un mini-site
// interactif par marque (5 onglets : Logo · Couleurs · Typographies ·
// Règles · Branding), multi-chartes (max 30/tenant), ZÉRO IA — tout le
// calcul est client-side. Cadrage : KEY_BRAND_BRIEF.md ; exécution :
// KEY_BRAND_SPRINTS.md. Backend : workers/src/routes/key-brand.js.
//
// KB-0 = bibliothèque de chartes (CRUD) + workspace à 5 onglets vides
// premium (spécimens fantômes) + autosave du brand-kit. Les onglets
// prennent vie sprint par sprint (KB-1 Logo … KB-5 Branding).
//
// ISOLATION : préfixe kb- (CSS/DOM) / kb_ (D1, localStorage),
// routes /api/keybrand/. Règle du musée : le chrome reste neutre,
// la seule couleur vive à l'écran = la couleur primaire de la charte
// ouverte (--kb-accent, posée dès qu'elle existe).
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';
import { exportLogoPng, buildZip, saveBlob, safeFilename, svgLooksSafe,
         hexToRgb, rgbToCmyk, contrastRatio, wcagVerdict, harmonies, simulateColorBlind } from './key-brand-tools.js';
import { GOOGLE_FONTS, FONT_CATEGORIES, fontMeta, weightsOf, ensureFontLoaded, fontSpecimenUrl, TYPE_SAMPLES } from './key-brand-fonts.js';

const WORKSPACE_META = { id: 'O-BRD-001', name: 'Key Brand' };
// Prod par défaut ; surchargé par window.__KS_API_BASE__ en dev local (cf. sceau.js).
const API_BASE = (typeof window !== 'undefined' && window.__KS_API_BASE__) || 'https://keystone-os-api.keystone-os.workers.dev';

// ── État du module ──────────────────────────────────────────────
let _root = null;
let _view = 'lib';          // 'lib' | 'chart'
let _tab = 'logo';          // 'logo' | 'colors' | 'type' | 'rules' | 'brand'
let _charts = [];           // liste bibliothèque
let _chart = null;          // charte ouverte { id, name, slug, status, version, draft }
let _loading = false;
let _error = null;
let _saveTimer = null;      // debounce autosave
let _saveState = 'idle';    // 'idle' | 'saving' | 'saved' | 'error'

// ── État onglet Logo (KB-1) ──
let _logoBg = 'checker';    // fond d'aperçu : 'checker' | 'light' | 'dark' | '#rrggbb'
let _dlPanel = null;        // variante dont le panneau téléchargement est ouvert
let _logoAdv = false;       // accordéon « Blocs avancés » ouvert
let _uploading = false;
const _blobUrls = new Map();     // assetId → objectURL (aperçus authentifiés)
const _blobFetches = new Map();  // assetId → Promise en cours (anti-doublon)

// Variantes de logo : libellés des usages canoniques (grammaire des chartes).
const LOGO_KINDS = [
  ['color',      'Couleur'],
  ['negative',   'Négatif (réserve)'],
  ['mono',       'Monochrome'],
  ['grayscale',  'Niveaux de gris'],
  ['simplified', 'Simplifiée (petits formats)'],
];
const KB_UPLOAD_MAX = 4 * 1024 * 1024; // miroir du cap serveur (4 Mo)
const EXT_MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };

// ── État onglet Couleurs (KB-2) ──
let _colorAdv = null;       // couleur dont le bloc avancé est ouvert
let _pairText = null;       // test de visibilité : 'c:<id>' | '#ffffff' | '#000000'
let _pairBg = null;
const COLOR_ROLES = [
  ['primary',   'Primaire'],
  ['secondary', 'Secondaire'],
  ['extra',     'Supplémentaire'],
  ['bg',        'Fond'],
  ['text',      'Texte'],
];
const HARMONY_LABELS = {
  complementaire: ['Complémentaire', 'la couleur opposée — contraste maximal'],
  analogues:      ['Analogues', 'les voisines — camaïeu naturel'],
  triade:         ['Triade', 'équilibre à trois — vivant mais stable'],
  nuances:        ['Nuances', 'la même, du clair au profond'],
  sourdine:       ['En sourdine', 'désaturées — fonds et aplats discrets'],
};

// ── État onglet Typographies (KB-3, session seulement) ──
let _typePicker = false;    // panneau « choisir une police » ouvert
let _typeSearch = '';
let _typeCat = 'all';
let _typeText = TYPE_SAMPLES[0];   // texte du spécimen, partagé entre cartes
let _typeSampleIdx = 0;
const _typePrefs = new Map();      // fontId → { weight, size } (non persisté)
const FONT_ROLES = [
  ['title',        'Titrage'],
  ['body',         'Texte courant'],
  ['office',       'Bureautique'],
  ['substitution', 'Substitution'],
];
const FONT_ROLE_HINTS = {
  title: 'titres, affiches, impact',
  body: 'paragraphes, brochures, web',
  office: 'Word, PowerPoint, e-mails',
  substitution: 'quand la vraie police n\'est pas installée',
};

// Les 5 onglets du mini-site. `soon` disparaît au fil des sprints.
const TABS = [
  { key: 'logo',   label: 'Logo',          icon: 'keybrand' },
  { key: 'colors', label: 'Couleurs',      icon: 'palette' },
  { key: 'type',   label: 'Typographies',  icon: 'type' },
  { key: 'rules',  label: 'Règles',        icon: 'shield-check' },
  { key: 'brand',  label: 'Branding',      icon: 'sparkles' },
];

// Squelette du brand-kit (géométrie variable : TOUT optionnel sauf meta.name).
// Référence complète : KEY_BRAND_SPRINTS.md §1.5.
function _emptyKit(name) {
  return {
    meta: { name: name || 'Nouvelle marque', baseline: '', credit: null },
    logo: { variants: [], protection: null, minSizes: null },
    colors: { palette: [], dark: null },
    typography: { fonts: [] },
    rules: { interdits: [], custom: [] },
    branding: { motion: 'none', symbolism: [], photo: null },
    settings: { footer: 'Réalisé par Protein Keystone Studio' },
  };
}

// ── API ─────────────────────────────────────────────────────────
function _jwt() { return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || ''; }
async function _api(path, opts = {}) {
  const res = await fetch(`${API_BASE}/api/keybrand${path}`, {
    method: opts.method || 'GET',
    headers: { 'Authorization': `Bearer ${_jwt()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  if (!res.ok) { const e = new Error((data && data.error) || `Erreur ${res.status}`); e.status = res.status; throw e; }
  return data;
}

function _esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Upload binaire (corps = octets, patron keynapse) — le nom d'origine passe
// en query pour les téléchargements et le kit .zip.
async function _apiUpload(chartId, file, kind = 'logo') {
  const mime = file.type || EXT_MIME[(file.name.split('.').pop() || '').toLowerCase()] || '';
  const res = await fetch(`${API_BASE}/api/keybrand/charts/${encodeURIComponent(chartId)}/assets?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${_jwt()}`, 'Content-Type': mime },
    body: file,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  if (!res.ok) { const e = new Error((data && data.error) || `Erreur ${res.status}`); e.status = res.status; throw e; }
  return data.asset;
}

// Blob authentifié d'un fichier (les <img> ne portent pas de JWT → objectURL).
async function _assetBlob(id) {
  const res = await fetch(`${API_BASE}/api/keybrand/file/${encodeURIComponent(id)}`, {
    headers: { 'Authorization': `Bearer ${_jwt()}` },
  });
  if (!res.ok) throw new Error(`Fichier indisponible (${res.status})`);
  return res.blob();
}
function _assetUrl(id) {
  if (_blobUrls.has(id)) return Promise.resolve(_blobUrls.get(id));
  if (!_blobFetches.has(id)) {
    _blobFetches.set(id, _assetBlob(id)
      .then(b => { const u = URL.createObjectURL(b); _blobUrls.set(id, u); return u; })
      .finally(() => _blobFetches.delete(id)));
  }
  return _blobFetches.get(id);
}
function _revokeBlobs() {
  for (const u of _blobUrls.values()) { try { URL.revokeObjectURL(u); } catch (_) {} }
  _blobUrls.clear();
}

// ── Cycle de vie ────────────────────────────────────────────────
export function openKeyBrand(opts = {}) {
  if (_root) return;
  _view = 'lib'; _chart = null; _tab = 'logo'; _saveState = 'idle';
  _buildShell();
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _onKey);
  _loadCharts();
}
export function closeKeyBrand() {
  if (!_root) return;
  _flushSave();
  document.removeEventListener('keydown', _onKey);
  clearTimeout(_saveTimer); _saveTimer = null;
  _revokeBlobs();
  _root.remove(); _root = null;
  document.body.style.overflow = '';
}
function _onKey(e) {
  if (e.key !== 'Escape') return;
  // Ne pas fermer si l'utilisateur édite un champ (il annule sa saisie).
  if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) { document.activeElement.blur(); return; }
  if (_view === 'chart') { _backToLib(); } else { closeKeyBrand(); }
}

function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app kb-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour">${icon('chevron-left', 34)}</button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('keybrand', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        <span class="kb-savestate" data-slot="savestate" aria-live="polite"></span>
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main kb-main" data-slot="main"></main>
    </div>
  `;
  // Sélecteur de fichiers masqué (dépôt de logos, KB-1).
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.accept = '.svg,.png,.jpg,.jpeg,.webp,.pdf,image/svg+xml,image/png,image/jpeg,image/webp,application/pdf';
  picker.style.display = 'none';
  picker.dataset.slot = 'filepicker';
  _root.appendChild(picker);
  picker.addEventListener('change', () => { _onFilesPicked(picker.files); picker.value = ''; });

  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('input', _onInput);
  _root.addEventListener('change', _onChange);
  _root.addEventListener('focusout', _onBlur);
  try { bindRatingButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindHelpButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindBurger(_root); } catch (_) {}
}

function _main() { return _root && _root.querySelector('[data-slot="main"]'); }

// ── Chargements ─────────────────────────────────────────────────
async function _loadCharts() {
  _loading = true; _error = null; _render();
  try { const d = await _api('/charts'); _charts = d.items || []; }
  catch (e) { _error = e.message; }
  _loading = false; _render();
}
async function _openChart(id) {
  _loading = true; _error = null; _view = 'chart'; _tab = 'logo'; _render();
  try {
    const d = await _api(`/charts/${encodeURIComponent(id)}`);
    _chart = d.chart;
    _chart.draft = _chart.draft || _emptyKit(_chart.name);
  } catch (e) { _error = e.message; _view = 'lib'; }
  _loading = false; _render();
}
function _backToLib() {
  _flushSave();
  _view = 'lib'; _chart = null; _error = null;
  _dlPanel = null; _logoAdv = false; _logoBg = 'checker';
  _colorAdv = null; _pairText = null; _pairBg = null;
  _typePicker = false; _typeSearch = ''; _typeCat = 'all'; _typePrefs.clear();
  _revokeBlobs();
  _applyAccent(null);
  _loadCharts();
}

// ── Autosave (debounce 900 ms + flush à la sortie) ──────────────
function _scheduleSave() {
  if (!_chart) return;
  _saveState = 'saving'; _renderSaveState();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flushSave, 900);
}
async function _flushSave() {
  clearTimeout(_saveTimer); _saveTimer = null;
  if (!_chart) return;
  const payload = { name: _chart.name, draft: _chart.draft };
  try {
    await _api(`/charts/${encodeURIComponent(_chart.id)}`, { method: 'PUT', body: payload });
    _saveState = 'saved';
  } catch (e) { _saveState = 'error'; }
  _renderSaveState();
}
function _renderSaveState() {
  const el = _root && _root.querySelector('[data-slot="savestate"]');
  if (!el) return;
  if (_view !== 'chart') { el.innerHTML = ''; return; }
  const map = {
    idle:   '',
    saving: `<span class="kb-save is-saving">Enregistrement…</span>`,
    saved:  `<span class="kb-save is-saved">${icon('check', 13)} Enregistré</span>`,
    error:  `<span class="kb-save is-error">${icon('alert-triangle', 13)} Hors ligne — réessai à la prochaine modification</span>`,
  };
  el.innerHTML = map[_saveState] || '';
}

// ── Règle du musée : l'app s'habille de la charte ouverte ───────
// Dès qu'une couleur primaire existe dans le kit, les micro-accents de
// l'UI la prennent. Sinon, accent neutre du workspace.
function _applyAccent(hex) {
  if (!_root) return;
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) _root.style.setProperty('--kb-accent', hex);
  else _root.style.removeProperty('--kb-accent');
}
function _primaryHex(kit) {
  const p = kit && kit.colors && Array.isArray(kit.colors.palette) ? kit.colors.palette : [];
  const prim = p.find(c => c.role === 'primary') || p[0];
  return prim && prim.hex ? prim.hex : null;
}

// ── Événements ──────────────────────────────────────────────────
function _onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || !_root.contains(btn)) return;
  const act = btn.dataset.act;
  const id = btn.closest('[data-id]')?.dataset.id;

  if (act === 'close')        { if (_view === 'chart') _backToLib(); else closeKeyBrand(); return; }
  if (act === 'reload')       { _loadCharts(); return; }
  if (act === 'create')       { _createChart(); return; }
  if (act === 'open' && id)   { _openChart(id); return; }
  if (act === 'dup' && id)    { _duplicateChart(id); return; }
  if (act === 'del' && id)    { _deleteChart(id); return; }
  if (act === 'back-lib')     { _backToLib(); return; }
  if (act.startsWith('tab-')) { _tab = act.slice(4); _dlPanel = null; _renderChart(); return; }
  if (act === 'soon')         { _toast('Cet atelier arrive au prochain sprint.'); return; }

  // ── Onglet Logo (KB-1) ──
  const vid = btn.closest('[data-vid]')?.dataset.vid;
  if (act === 'logo-add')  { _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'logo-zip')  { _downloadKit(); return; }
  if (act === 'logo-bg')   { _logoBg = btn.dataset.bg || 'checker'; _renderChart(); return; }
  if (act === 'logo-adv')  { _logoAdv = !_logoAdv; _renderChart(); return; }
  if (act === 'v-dl' && vid)      { _dlPanel = _dlPanel === vid ? null : vid; _renderChart(); return; }
  if (act === 'v-dl-orig' && vid) { _downloadOriginal(vid); return; }
  if (act === 'v-dl-png' && vid)  { _downloadPng(vid, btn); return; }
  if (act === 'v-del' && vid)     { _deleteVariant(vid); return; }

  // ── Onglet Couleurs (KB-2) ──
  const cid = btn.closest('[data-cid]')?.dataset.cid;
  if (act === 'color-add')        { _addColor(); return; }
  if (act === 'copy')             { _copy(btn.dataset.copy); return; }
  if (act === 'c-adv' && cid)     { _colorAdv = _colorAdv === cid ? null : cid; _renderChart(); return; }
  if (act === 'c-del' && cid)     { _deleteColor(cid); return; }
  if (act === 'harmony-add')      { _addColor(btn.dataset.hex, btn.dataset.name); return; }

  // ── Onglet Typographies (KB-3) ──
  const fid = btn.closest('[data-fid]')?.dataset.fid;
  if (act === 'font-picker')   { _typePicker = !_typePicker; _typeSearch = ''; _renderChart(); return; }
  if (act === 'font-cat')      { _typeCat = btn.dataset.cat || 'all'; _renderChart(); _focusTypeSearch(); return; }
  if (act === 'font-pick')     { _addFont(btn.dataset.family); return; }
  if (act === 'font-declare')  { _addDeclaredFont(); return; }
  if (act === 'type-gen')      { _typeSampleIdx = (_typeSampleIdx + 1) % TYPE_SAMPLES.length; _typeText = TYPE_SAMPLES[_typeSampleIdx]; _renderChart(); return; }
  if (act === 'f-del' && fid)  { _deleteFont(fid); return; }
}

function _onInput(e) {
  const el = e.target;
  if (!el.dataset) return;
  if (el.dataset.field === 'chart-name' && _chart) {
    _chart.name = el.value;
    if (_chart.draft && _chart.draft.meta) _chart.draft.meta.name = el.value;
    _scheduleSave();
  }
  if (el.dataset.field === 'chart-baseline' && _chart) {
    if (_chart.draft && _chart.draft.meta) _chart.draft.meta.baseline = el.value;
    _scheduleSave();
  }

  // ── Onglet Logo (KB-1) ──
  const v = _variantOf(el.closest('[data-vid]')?.dataset.vid);
  if (el.dataset.field === 'v-label' && v)  { v.label = el.value.slice(0, 60); _scheduleSave(); }
  if (el.dataset.field === 'v-usage' && v)  { v.usage = el.value.slice(0, 160); _scheduleSave(); }
  if (el.dataset.field === 'prot-ratio' && _chart) {
    const logo = _logoSection();
    logo.protection = logo.protection || { ratio: 0.5, basis: 'hauteur du logo' };
    logo.protection.ratio = Math.max(0.25, Math.min(3, parseFloat(el.value) || 0.5));
    _scheduleSave(); _refreshProtViz();
  }
  if (el.dataset.field === 'prot-basis' && _chart) {
    const logo = _logoSection();
    logo.protection = logo.protection || { ratio: 0.5, basis: '' };
    logo.protection.basis = el.value.slice(0, 80);
    _scheduleSave();
  }
  if ((el.dataset.field === 'min-print' || el.dataset.field === 'min-px') && _chart) {
    const logo = _logoSection();
    logo.minSizes = logo.minSizes || { printMm: null, digitalPx: null };
    const n = parseInt(el.value, 10);
    if (el.dataset.field === 'min-print') logo.minSizes.printMm = Number.isFinite(n) && n > 0 ? n : null;
    else logo.minSizes.digitalPx = Number.isFinite(n) && n > 0 ? n : null;
    _scheduleSave();
  }
  if (el.dataset.field === 'logo-bg-custom') { _logoBg = el.value; _refreshLogoBgs(); }

  // ── Onglet Couleurs (KB-2) ──
  const c = _colorOf(el.closest('[data-cid]')?.dataset.cid);
  if (el.dataset.field === 'c-name' && c)    { c.name = el.value.slice(0, 40); _scheduleSave(); }
  if (el.dataset.field === 'c-pantone' && c) { c.pantone = el.value.slice(0, 30) || null; _scheduleSave(); }
  if (el.dataset.field === 'c-story' && c)   { c.story = el.value.slice(0, 160) || null; _scheduleSave(); }
  if (el.dataset.field === 'c-hex' && c) {
    // Pipette live : on rafraîchit la carte sans re-render (focus préservé) ;
    // le re-render complet (harmonies, contrastes, accent) vient au 'change'.
    c.hex = el.value; _scheduleSave(); _refreshColorCard(el.closest('.kb-color-card'), c);
  }
  if (el.dataset.field === 'c-dark' && c)    { c.darkHex = el.value; _scheduleSave(); }

  // ── Onglet Typographies (KB-3) ──
  const f = _fontOf(el.closest('[data-fid]')?.dataset.fid);
  if (el.dataset.field === 'type-search') { _typeSearch = el.value; _refreshFontPickerList(); }
  if (el.dataset.field === 'type-text')   { _typeText = el.value; _refreshSpecimens(); }
  if (el.dataset.field === 'f-size' && f) {
    const p = _typePrefs.get(f.id) || {};
    p.size = parseInt(el.value, 10) || 32;
    _typePrefs.set(f.id, p);
    _refreshSpecimens();
  }
  if (el.dataset.field === 'f-family' && f) { f.family = el.value.slice(0, 60); _scheduleSave(); _refreshSpecimens(); }
  if (el.dataset.field === 'f-buy' && f)    { f.buyUrl = el.value.slice(0, 200) || null; _scheduleSave(); }
}

// Les <select> émettent 'change', pas 'input'.
function _onChange(e) {
  const el = e.target;
  if (!el.dataset) return;
  const v = _variantOf(el.closest('[data-vid]')?.dataset.vid);
  if (el.dataset.field === 'v-kind' && v) { v.kind = el.value; _scheduleSave(); }

  // ── Onglet Couleurs (KB-2) ──
  const c = _colorOf(el.closest('[data-cid]')?.dataset.cid);
  if (el.dataset.field === 'c-hex' && c) { _renderChart(); }
  if (el.dataset.field === 'c-role' && c) {
    if (el.value === 'primary') {
      // Une seule primaire : l'ancienne redevient secondaire.
      for (const other of _paletteOf()) if (other !== c && other.role === 'primary') other.role = 'secondary';
    }
    c.role = el.value; _scheduleSave(); _renderChart();
  }
  if (el.dataset.field === 'pair-text') { _pairText = el.value; _renderChart(); }
  if (el.dataset.field === 'pair-bg')   { _pairBg = el.value; _renderChart(); }

  // ── Onglet Typographies (KB-3) ──
  const f = _fontOf(el.closest('[data-fid]')?.dataset.fid);
  if (el.dataset.field === 'f-role' && f)   { f.role = el.value; _scheduleSave(); _renderChart(); }
  if (el.dataset.field === 'f-weight' && f) {
    const p = _typePrefs.get(f.id) || {};
    p.weight = parseInt(el.value, 10) || 400;
    _typePrefs.set(f.id, p);
    _refreshSpecimens();
  }
}
function _onBlur(e) {
  // Sécurise le nom : jamais vide après édition.
  const el = e.target;
  if (el.dataset && el.dataset.field === 'chart-name' && _chart && !el.value.trim()) {
    el.value = 'Nouvelle marque';
    _chart.name = el.value;
    if (_chart.draft && _chart.draft.meta) _chart.draft.meta.name = el.value;
    _scheduleSave();
  }
}

// ── Actions bibliothèque ────────────────────────────────────────
async function _createChart() {
  try {
    const d = await _api('/charts', { method: 'POST', body: { name: 'Nouvelle marque' } });
    await _openChart(d.chart.id);
    // Focus direct sur le nom : première action naturelle après création.
    const nameEl = _root.querySelector('[data-field="chart-name"]');
    if (nameEl) { nameEl.focus(); nameEl.select(); }
  } catch (e) {
    if (e.status === 409) _toast('Limite atteinte : 30 chartes par compte. Supprimez-en une pour continuer.');
    else _toast(e.message);
  }
}
async function _duplicateChart(id) {
  try { await _api(`/charts/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }); _loadCharts(); }
  catch (e) { _toast(e.status === 409 ? 'Limite atteinte : 30 chartes par compte.' : e.message); }
}
async function _deleteChart(id) {
  const c = _charts.find(x => x.id === id);
  const ok = window.confirm(`Supprimer la charte « ${c ? c.name : ''} » ?\nCette action est définitive (fichiers inclus).`);
  if (!ok) return;
  try { await _api(`/charts/${encodeURIComponent(id)}`, { method: 'DELETE' }); _loadCharts(); }
  catch (e) { _toast(e.message); }
}

// ── Rendu ───────────────────────────────────────────────────────
function _render() {
  const main = _main(); if (!main) return;
  _renderSaveState();
  if (_view === 'chart') return _renderChart();
  _renderLib(main);
}

// ··· Bibliothèque ················································
function _renderLib(main) {
  _applyAccent(null);
  if (_loading) { main.innerHTML = `<div class="kb-state">${icon('refresh', 28)}<p>Chargement…</p></div>`; return; }
  if (_error)   { main.innerHTML = `<div class="kb-state kb-state-err">${icon('alert-triangle', 28)}<p>${_esc(_error)}</p><button class="kb-btn" data-act="reload">Réessayer</button></div>`; return; }

  const cards = _charts.map(c => {
    const dot = c.primary_hex
      ? `<span class="kb-card-dot" style="background:${_esc(c.primary_hex)}"></span>`
      : `<span class="kb-card-dot kb-card-dot-ghost"></span>`;
    const status = c.status === 'published'
      ? `<span class="kb-badge is-live">Version ${c.version} en ligne</span>`
      : `<span class="kb-badge">Brouillon</span>`;
    return `
      <article class="kb-card" data-id="${_esc(c.id)}">
        <button class="kb-card-open" data-act="open" title="Ouvrir la charte">
          ${dot}
          <span class="kb-card-name">${_esc(c.name)}</span>
          <span class="kb-card-meta">${status}</span>
        </button>
        <div class="kb-card-acts">
          <button class="kb-iconbtn" data-act="dup" title="Dupliquer">${icon('copy', 16)}</button>
          <button class="kb-iconbtn danger" data-act="del" title="Supprimer">${icon('trash-2', 16)}</button>
        </div>
      </article>`;
  }).join('');

  const empty = `
    <div class="kb-lib-empty">
      <div class="kb-lib-empty-visual">
        <span class="kb-ghost-dot"></span><span class="kb-ghost-dot"></span><span class="kb-ghost-dot"></span>
      </div>
      <h2>Votre première charte vous attend</h2>
      <p>Logo, couleurs, typographies, règles d'usage : réunissez l'identité d'une marque dans un espace vivant, à partager d'un lien.</p>
      <button class="kb-btn primary" data-act="create">${icon('plus', 16)} Créer une charte</button>
    </div>`;

  main.innerHTML = `
    <div class="kb-lib">
      <div class="kb-head">
        <div>
          <h1>Chartes graphiques</h1>
          <p class="kb-sub">Une charte par marque — la vôtre, ou celles de vos clients.</p>
        </div>
        ${_charts.length ? `<button class="kb-btn primary" data-act="create">${icon('plus', 16)} Nouvelle charte</button>` : ''}
      </div>
      ${_charts.length ? `<div class="kb-grid">${cards}</div>` : empty}
      ${_charts.length >= 25 ? `<p class="kb-cap-note">${_charts.length}/30 chartes utilisées.</p>` : ''}
    </div>`;
}

// ··· Workspace charte (5 onglets) ································
function _renderChart() {
  const main = _main(); if (!main) return;
  if (_loading || !_chart) { main.innerHTML = `<div class="kb-state">${icon('refresh', 28)}<p>Chargement…</p></div>`; return; }

  _applyAccent(_primaryHex(_chart.draft));

  const tabs = TABS.map(t => `
    <button class="kb-tab ${_tab === t.key ? 'on' : ''}" data-act="tab-${t.key}" role="tab" aria-selected="${_tab === t.key}">
      ${icon(t.icon, 16)}<span>${t.label}</span>
    </button>`).join('');

  main.innerHTML = `
    <div class="kb-chart">
      <div class="kb-chart-head">
        <button class="kb-link-back" data-act="back-lib">${icon('chevron-left', 16)} Chartes</button>
        <div class="kb-identity">
          <input class="kb-name-input" data-field="chart-name" value="${_esc(_chart.name)}" maxlength="80"
                 aria-label="Nom de la marque" spellcheck="false">
          <input class="kb-baseline-input" data-field="chart-baseline" value="${_esc(_chart.draft?.meta?.baseline || '')}"
                 maxlength="140" placeholder="Baseline (facultative) — ce que la marque promet, en une ligne"
                 aria-label="Baseline" spellcheck="false">
        </div>
      </div>
      <nav class="kb-tabs" role="tablist">${tabs}</nav>
      <section class="kb-tabpane" role="tabpanel">${_renderTab(_tab)}</section>
    </div>`;

  if (_tab === 'logo') _hydrateLogoImgs();
}

// Spécimens fantômes — l'état le plus important de l'app (brief §6) :
// une charte vide ressemble à une galerie avant vernissage, jamais à
// une base de données vide. Une invitation, une action, rien d'autre.
function _renderTab(key) {
  if (key === 'logo') return _renderLogoTab();

  if (key === 'colors') return _renderColorsTab();

  if (key === 'type') return _renderTypeTab();

  if (key === 'rules') return `
    <div class="kb-ghost">
      <div class="kb-ghost-rules" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
      <h3>Les règles à respecter</h3>
      <p>Dès que votre logo est déposé, les interdits classiques se génèrent tout seuls avec VOTRE logo — déformation, mauvaise couleur, fond chargé…</p>
      <button class="kb-btn primary" data-act="soon">${icon('shield-check', 16)} Générer les interdits</button>
    </div>`;

  return `
    <div class="kb-ghost">
      <div class="kb-ghost-stage" aria-hidden="true">
        <span class="kb-ghost-dot big"></span>
      </div>
      <h3>La scène de la marque</h3>
      <p>Une présentation animée et sobre de votre logo, l'histoire du signe, et la direction photographique — la page de garde vivante de votre charte.</p>
      <button class="kb-btn primary" data-act="soon">${icon('sparkles', 16)} Mettre en scène</button>
    </div>`;
}

// ════════════════════════════════════════════════════════════════
// ONGLET LOGO (KB-1) — « tout ce qu'il faut, au format qu'on veut »
// ════════════════════════════════════════════════════════════════
function _logoSection() {
  if (!_chart.draft.logo || typeof _chart.draft.logo !== 'object') {
    _chart.draft.logo = { variants: [], protection: null, minSizes: null };
  }
  if (!Array.isArray(_chart.draft.logo.variants)) _chart.draft.logo.variants = [];
  return _chart.draft.logo;
}
function _variantOf(vid) {
  if (!vid || !_chart) return null;
  return _logoSection().variants.find(x => x.id === vid) || null;
}

function _renderLogoTab() {
  const variants = _chart ? _logoSection().variants : [];

  if (!variants.length) return `
    <div class="kb-ghost">
      <div class="kb-ghost-logo" aria-hidden="true">
        <div class="kb-ghost-drop">${icon('image', 30)}</div>
      </div>
      <h3>Le logo, dans tous ses états</h3>
      <p>Déposez vos fichiers : aperçus sur fonds clairs, sombres et colorés, zone de protection, et téléchargement au format et à la taille que votre interlocuteur demande.</p>
      <button class="kb-btn primary" data-act="logo-add">${icon('plus', 16)} Déposer un logo</button>
      <p class="kb-hint">SVG, PNG, JPG, WebP ou PDF — 4 Mo max par fichier. Le SVG donne les meilleurs exports.</p>
    </div>`;

  const palette = (_chart.draft.colors && Array.isArray(_chart.draft.colors.palette)) ? _chart.draft.colors.palette : [];
  const bgChips = [
    { key: 'checker', label: 'Transparent', cls: 'is-checker' },
    { key: 'light',   label: 'Clair',       cls: 'is-light' },
    { key: 'dark',    label: 'Sombre',      cls: 'is-dark' },
    ...palette.filter(c => c && /^#[0-9a-fA-F]{6}$/.test(c.hex || '')).slice(0, 6)
      .map(c => ({ key: c.hex, label: c.name || c.hex, cls: '', hex: c.hex })),
  ];
  const chips = bgChips.map(c => `
    <button class="kb-bgchip ${c.cls} ${_logoBg === c.key ? 'on' : ''}" data-act="logo-bg" data-bg="${_esc(c.key)}"
            title="${_esc(c.label)}" aria-label="Fond ${_esc(c.label)}" ${c.hex ? `style="background:${_esc(c.hex)}"` : ''}></button>`).join('');
  const customOn = _logoBg.startsWith('#') && !bgChips.some(c => c.key === _logoBg && !c.hex);

  const cards = variants.map(v => _renderVariantCard(v)).join('');

  const logo = _logoSection();
  const prot = logo.protection;
  const mins = logo.minSizes;
  const advFilled = !!(prot || (mins && (mins.printMm || mins.digitalPx)));

  return `
    <div class="kb-logo">
      <div class="kb-logo-toolbar">
        <div class="kb-bgchips" role="group" aria-label="Fond d'aperçu">
          ${chips}
          <label class="kb-bgchip kb-bgchip-custom ${customOn ? 'on' : ''}" title="Fond personnalisé">
            <input type="color" data-field="logo-bg-custom" value="${customOn ? _esc(_logoBg) : '#e8e4da'}" aria-label="Fond personnalisé">
          </label>
        </div>
        <div class="kb-logo-toolbar-acts">
          <button class="kb-btn" data-act="logo-zip" ${_uploading ? 'disabled' : ''}>${icon('download', 15)} Kit .zip</button>
          <button class="kb-btn primary" data-act="logo-add" ${_uploading ? 'disabled' : ''}>${icon('plus', 15)} ${_uploading ? 'Envoi…' : 'Ajouter'}</button>
        </div>
      </div>
      <div class="kb-logo-grid">${cards}</div>

      <div class="kb-adv">
        <button class="kb-adv-head" data-act="logo-adv" aria-expanded="${_logoAdv}">
          ${icon(_logoAdv ? 'chevron-down' : 'chevron-right', 16)}
          <span>Blocs avancés</span>
          <span class="kb-adv-sub">${advFilled ? 'zone de protection · tailles minimales' : 'zone de protection, tailles minimales — pour les chartes exigeantes'}</span>
        </button>
        ${_logoAdv ? _renderLogoAdvanced(logo, variants) : ''}
      </div>
    </div>`;
}

function _renderVariantCard(v) {
  const kindOpts = LOGO_KINDS.map(([k, lbl]) => `<option value="${k}" ${v.kind === k ? 'selected' : ''}>${lbl}</option>`).join('');
  const isPdf = v.ext === 'pdf';
  const preview = isPdf
    ? `<div class="kb-logo-doc">${icon('file-text', 26)}<span>PDF</span></div>`
    : `<img data-asset="${_esc(v.assetId)}" alt="${_esc(v.label || 'logo')}" draggable="false">`;

  const dl = _dlPanel === v.id ? `
    <div class="kb-dl-panel" data-vid="${_esc(v.id)}">
      <button class="kb-btn" data-act="v-dl-orig">${icon('download', 14)} Original (.${_esc(v.ext)})</button>
      ${isPdf ? '' : `
      <div class="kb-dl-png">
        <select class="kb-select" data-slot="dl-size" aria-label="Largeur en pixels">
          <option value="512">512 px</option>
          <option value="1024">1024 px</option>
          <option value="2000" selected>2000 px</option>
          <option value="4096">4096 px</option>
        </select>
        <select class="kb-select" data-slot="dl-bg" aria-label="Fond de l'export">
          <option value="">Fond transparent</option>
          <option value="#ffffff">Fond blanc</option>
          <option value="#0c0d10">Fond noir</option>
        </select>
        <button class="kb-btn primary" data-act="v-dl-png">${icon('download', 14)} PNG</button>
      </div>`}
    </div>` : '';

  return `
    <article class="kb-logo-card" data-vid="${_esc(v.id)}">
      <div class="kb-logo-preview ${_logoBgClass()}" ${_logoBgStyle()}>${preview}</div>
      <div class="kb-logo-fields">
        <input class="kb-field-input kb-v-label" data-field="v-label" value="${_esc(v.label || '')}" placeholder="Nom de la variante" maxlength="60" spellcheck="false">
        <select class="kb-select" data-field="v-kind" aria-label="Type de variante">${kindOpts}</select>
        <input class="kb-field-input kb-v-usage" data-field="v-usage" value="${_esc(v.usage || '')}" placeholder="Usage — ex. « Impressions monochromes, fond blanc »" maxlength="160" spellcheck="false">
      </div>
      <div class="kb-logo-card-acts">
        <button class="kb-iconbtn ${_dlPanel === v.id ? 'on' : ''}" data-act="v-dl" title="Télécharger">${icon('download', 16)}</button>
        <button class="kb-iconbtn danger" data-act="v-del" title="Supprimer la variante">${icon('trash-2', 16)}</button>
      </div>
      ${dl}
    </article>`;
}

function _renderLogoAdvanced(logo, variants) {
  const prot = logo.protection || { ratio: 0.5, basis: 'hauteur du logo' };
  const mins = logo.minSizes || { printMm: null, digitalPx: null };
  const first = variants.find(v => v.ext !== 'pdf');
  const viz = first ? `
    <div class="kb-prot-viz-wrap">
      <div class="kb-prot-viz" data-slot="prot-viz" style="--kb-prot:${(prot.ratio * 56).toFixed(0)}px">
        <div class="kb-prot-zone"><img data-asset="${_esc(first.assetId)}" alt="" draggable="false"></div>
      </div>
      <p class="kb-hint">La zone en pointillés doit rester vide autour du logo.</p>
    </div>` : '';
  return `
    <div class="kb-adv-body">
      <div class="kb-adv-col">
        <h4>Zone de protection</h4>
        <label class="kb-field-label">Marge = <strong data-slot="prot-ratio-out">${prot.ratio}</strong> × <input class="kb-field-input kb-inline" data-field="prot-basis" value="${_esc(prot.basis || '')}" placeholder="hauteur du logo" maxlength="80"></label>
        <input type="range" min="0.25" max="2" step="0.25" value="${prot.ratio}" data-field="prot-ratio" aria-label="Ratio de la zone de protection">
        ${viz}
      </div>
      <div class="kb-adv-col">
        <h4>Tailles minimales</h4>
        <label class="kb-field-label">Impression <input class="kb-field-input kb-num" data-field="min-print" type="number" min="1" max="500" value="${mins.printMm ?? ''}" placeholder="—"> mm de large</label>
        <label class="kb-field-label">Numérique <input class="kb-field-input kb-num" data-field="min-px" type="number" min="8" max="4000" value="${mins.digitalPx ?? ''}" placeholder="—"> px de large</label>
        <p class="kb-hint">En dessous, le logo n'est plus lisible : la charte publique l'affichera comme un engagement.</p>
      </div>
    </div>`;
}

// ── Fond d'aperçu (appliqué à toutes les cartes) ──
function _logoBgClass() {
  if (_logoBg === 'checker') return 'is-checker';
  if (_logoBg === 'light') return 'is-light';
  if (_logoBg === 'dark') return 'is-dark';
  return 'is-custom';
}
function _logoBgStyle() {
  return _logoBg.startsWith('#') ? `style="background:${_esc(_logoBg)}"` : '';
}
function _refreshLogoBgs() {
  if (!_root) return;
  _root.querySelectorAll('.kb-logo-preview').forEach(el => {
    el.className = `kb-logo-preview ${_logoBgClass()}`;
    el.style.background = _logoBg.startsWith('#') ? _logoBg : '';
  });
}
function _refreshProtViz() {
  const logo = _logoSection();
  const r = logo.protection?.ratio ?? 0.5;
  const viz = _root?.querySelector('[data-slot="prot-viz"]');
  if (viz) viz.style.setProperty('--kb-prot', `${(r * 56).toFixed(0)}px`);
  const out = _root?.querySelector('[data-slot="prot-ratio-out"]');
  if (out) out.textContent = r;
}

// Aperçus : les <img> reçoivent leur objectURL authentifié après le rendu.
async function _hydrateLogoImgs() {
  if (!_root) return;
  const imgs = [..._root.querySelectorAll('img[data-asset]')];
  for (const img of imgs) {
    try { img.src = await _assetUrl(img.dataset.asset); }
    catch (_) { img.closest('.kb-logo-preview,.kb-prot-zone')?.classList.add('is-broken'); }
  }
}

// ── Dépôt de fichiers ──
async function _onFilesPicked(fileList) {
  if (!_chart || !fileList || !fileList.length) return;
  const files = [...fileList];
  _uploading = true; _renderChart();
  let added = 0;
  for (const f of files) {
    try {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!EXT_MIME[ext]) { _toast(`« ${f.name} » : format non pris en charge.`); continue; }
      if (f.size > KB_UPLOAD_MAX) { _toast(`« ${f.name} » : trop lourd (max 4 Mo).`); continue; }
      if (ext === 'svg' && !svgLooksSafe(await f.text())) {
        _toast(`« ${f.name} » : SVG refusé (code actif ou référence externe).`); continue;
      }
      const asset = await _apiUpload(_chart.id, f, 'logo');
      const variants = _logoSection().variants;
      variants.push({
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
        label: f.name.replace(/\.[A-Za-z0-9]+$/, '').slice(0, 60),
        usage: '',
        kind: 'color',
        assetId: asset.id, ext: asset.ext, mime: asset.mime, name: asset.name,
      });
      added++;
    } catch (e) {
      _toast(e.status === 409 ? e.message : `« ${f.name} » : ${e.message}`);
    }
  }
  _uploading = false;
  if (added) _scheduleSave();
  _renderChart();
}

// ── Actions variante ──
async function _deleteVariant(vid) {
  const v = _variantOf(vid); if (!v) return;
  const ok = window.confirm(`Supprimer la variante « ${v.label || v.name} » ?\nLe fichier sera retiré définitivement.`);
  if (!ok) return;
  try { await _api(`/assets/${encodeURIComponent(v.assetId)}`, { method: 'DELETE' }); } catch (_) { /* déjà absent */ }
  const url = _blobUrls.get(v.assetId);
  if (url) { try { URL.revokeObjectURL(url); } catch (_) {} _blobUrls.delete(v.assetId); }
  const logo = _logoSection();
  logo.variants = logo.variants.filter(x => x.id !== vid);
  if (_dlPanel === vid) _dlPanel = null;
  _scheduleSave(); _renderChart();
}

async function _downloadOriginal(vid) {
  const v = _variantOf(vid); if (!v) return;
  try {
    const blob = await _assetBlob(v.assetId);
    saveBlob(blob, safeFilename(v.label || v.name, 'logo') + '.' + v.ext);
  } catch (e) { _toast(e.message); }
}

async function _downloadPng(vid, btn) {
  const v = _variantOf(vid); if (!v || v.ext === 'pdf') return;
  const panel = btn.closest('.kb-dl-panel');
  const width = parseInt(panel?.querySelector('[data-slot="dl-size"]')?.value, 10) || 2000;
  const bg = panel?.querySelector('[data-slot="dl-bg"]')?.value || null;
  try {
    btn.disabled = true;
    const blob = await _assetBlob(v.assetId);
    const png = await exportLogoPng(blob, v.mime, { width, bg });
    saveBlob(png, `${safeFilename(v.label || v.name, 'logo')}-${width}px.png`);
  } catch (e) { _toast(`Export impossible : ${e.message}`); }
  finally { btn.disabled = false; }
}

// ── Kit .zip (tous les originaux) ──
async function _downloadKit() {
  const variants = _logoSection().variants;
  if (!variants.length) return;
  _toast('Préparation du kit…');
  try {
    const dir = safeFilename(_chart.name, 'marque');
    const files = [];
    const seen = new Set();
    for (const v of variants) {
      const blob = await _assetBlob(v.assetId);
      let base = safeFilename(v.label || v.name, 'logo');
      let name = `${dir}/${base}.${v.ext}`;
      for (let i = 2; seen.has(name); i++) name = `${dir}/${base}-${i}.${v.ext}`;
      seen.add(name);
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    saveBlob(buildZip(files), `${dir} — kit logos.zip`);
  } catch (e) { _toast(`Kit impossible : ${e.message}`); }
}

// ════════════════════════════════════════════════════════════════
// ONGLET COULEURS (KB-2) — l'atelier
// ════════════════════════════════════════════════════════════════
function _colorsSection() {
  if (!_chart.draft.colors || typeof _chart.draft.colors !== 'object') {
    _chart.draft.colors = { palette: [], dark: null };
  }
  if (!Array.isArray(_chart.draft.colors.palette)) _chart.draft.colors.palette = [];
  return _chart.draft.colors;
}
function _paletteOf() { return _chart ? _colorsSection().palette : []; }
function _colorOf(cid) {
  if (!cid || !_chart) return null;
  return _paletteOf().find(x => x.id === cid) || null;
}
// Couleur d'encre lisible sur un fond donné (pour le HEX affiché sur le swatch).
function _inkOn(hex) {
  const r = contrastRatio(hex, '#ffffff');
  return (r !== null && r >= 3) ? '#ffffff' : '#111318';
}

function _addColor(hex, name) {
  const palette = _paletteOf();
  const c = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    name: (name || (palette.length === 0 ? 'Primaire' : `Couleur ${palette.length + 1}`)).slice(0, 40),
    hex: (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) ? hex.toLowerCase() : '#3b5bdb',
    role: palette.some(x => x.role === 'primary') ? (palette.length >= 2 ? 'extra' : 'secondary') : 'primary',
    cmyk: null, pantone: null, story: null, darkHex: null,
  };
  palette.push(c);
  _scheduleSave(); _renderChart();
}

function _deleteColor(cid) {
  const c = _colorOf(cid); if (!c) return;
  const ok = window.confirm(`Retirer « ${c.name || c.hex} » de la palette ?`);
  if (!ok) return;
  const colors = _colorsSection();
  colors.palette = colors.palette.filter(x => x.id !== cid);
  if (_colorAdv === cid) _colorAdv = null;
  if (_pairText === `c:${cid}`) _pairText = null;
  if (_pairBg === `c:${cid}`) _pairBg = null;
  _scheduleSave(); _renderChart();
}

async function _copy(text) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); _toast(`${text} copié`); }
  catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); _toast(`${text} copié`); } catch (e) { _toast('Copie impossible'); }
    ta.remove();
  }
}

function _renderColorsTab() {
  const palette = _paletteOf();

  if (!palette.length) return `
    <div class="kb-ghost">
      <div class="kb-ghost-swatches" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <h3>L'atelier des couleurs</h3>
      <p>Votre palette avec ses codes copiables en un clic, des déclinaisons harmonieuses, et le test de lisibilité des contrastes en direct.</p>
      <button class="kb-btn primary" data-act="color-add">${icon('plus', 16)} Ajouter une couleur</button>
      <p class="kb-hint">Commencez par la couleur principale de la marque — l'application s'habillera avec.</p>
    </div>`;

  const cards = palette.map(c => _renderColorCard(c)).join('');
  return `
    <div class="kb-colors">
      <div class="kb-colors-head">
        <p class="kb-hint">Cliquez une pastille pour copier son code. Les valeurs CMJN sont indicatives (sans profil ICC) — saisissez les vôtres dans le bloc avancé.</p>
        <button class="kb-btn primary" data-act="color-add">${icon('plus', 15)} Ajouter</button>
      </div>
      <div class="kb-colors-grid">${cards}</div>
      ${_renderHarmonyStudio(palette)}
      ${_renderContrastLab(palette)}
    </div>`;
}

function _renderColorCard(c) {
  const rgb = hexToRgb(c.hex) || { r: 0, g: 0, b: 0 };
  const cmyk = c.cmyk || rgbToCmyk(rgb);
  const cmykStr = `${cmyk.c} ${cmyk.m} ${cmyk.y} ${cmyk.k}`;
  const roles = COLOR_ROLES.map(([k, lbl]) => `<option value="${k}" ${c.role === k ? 'selected' : ''}>${lbl}</option>`).join('');
  const adv = _colorAdv === c.id ? `
    <div class="kb-color-adv">
      <label class="kb-field-label">Pantone <input class="kb-field-input kb-inline" data-field="c-pantone" value="${_esc(c.pantone || '')}" placeholder="ex. 2736 C" maxlength="30"></label>
      <label class="kb-field-label">Histoire <input class="kb-field-input kb-inline" data-field="c-story" value="${_esc(c.story || '')}" placeholder="d'où vient cette couleur, en une ligne" maxlength="160"></label>
      <label class="kb-field-label">Variante mode sombre
        <span class="kb-darkpick"><input type="color" data-field="c-dark" value="${_esc(c.darkHex || c.hex)}" aria-label="Variante sombre"></span>
        ${c.darkHex ? `<code>${_esc(c.darkHex)}</code>` : '<span class="kb-hint">— identique par défaut</span>'}
      </label>
    </div>` : '';

  return `
    <article class="kb-color-card" data-cid="${_esc(c.id)}">
      <button class="kb-swatch" data-act="copy" data-copy="${_esc(c.hex)}" style="background:${_esc(c.hex)};color:${_inkOn(c.hex)}" title="Copier ${_esc(c.hex)}">
        <span class="kb-swatch-hex">${_esc(c.hex)}</span>
        <label class="kb-swatch-pick" title="Modifier la couleur" aria-label="Modifier la couleur">
          ${icon('edit', 14)}<input type="color" data-field="c-hex" value="${_esc(c.hex)}">
        </label>
      </button>
      <div class="kb-color-fields">
        <div class="kb-color-row">
          <input class="kb-field-input kb-v-label" data-field="c-name" value="${_esc(c.name || '')}" placeholder="Nom de la couleur" maxlength="40" spellcheck="false">
          <select class="kb-select kb-color-role" data-field="c-role" aria-label="Rôle">${roles}</select>
        </div>
        <div class="kb-color-codes">
          <button class="kb-code" data-act="copy" data-copy="${_esc(c.hex)}">HEX <strong>${_esc(c.hex)}</strong></button>
          <button class="kb-code" data-act="copy" data-copy="${rgb.r}, ${rgb.g}, ${rgb.b}">RVB <strong>${rgb.r} ${rgb.g} ${rgb.b}</strong></button>
          <button class="kb-code" data-act="copy" data-copy="${cmykStr}" title="Indicatif — sans profil ICC">CMJN <strong>${cmykStr}</strong></button>
          ${c.pantone ? `<button class="kb-code" data-act="copy" data-copy="${_esc(c.pantone)}">PANTONE <strong>${_esc(c.pantone)}</strong></button>` : ''}
        </div>
        ${c.story ? `<p class="kb-color-story">${_esc(c.story)}</p>` : ''}
      </div>
      <div class="kb-color-acts">
        <button class="kb-iconbtn ${_colorAdv === c.id ? 'on' : ''}" data-act="c-adv" title="Bloc avancé (Pantone, histoire, mode sombre)">${icon('more-horizontal', 16)}</button>
        <button class="kb-iconbtn danger" data-act="c-del" title="Retirer">${icon('trash-2', 16)}</button>
      </div>
      ${adv}
    </article>`;
}

// Rafraîchissement live d'une carte pendant l'usage de la pipette (sans re-render).
function _refreshColorCard(card, c) {
  if (!card) return;
  const rgb = hexToRgb(c.hex); if (!rgb) return;
  const cmyk = c.cmyk || rgbToCmyk(rgb);
  const sw = card.querySelector('.kb-swatch');
  if (sw) { sw.style.background = c.hex; sw.style.color = _inkOn(c.hex); sw.dataset.copy = c.hex; }
  const hexEl = card.querySelector('.kb-swatch-hex'); if (hexEl) hexEl.textContent = c.hex;
  const codes = card.querySelectorAll('.kb-code strong');
  if (codes[0]) codes[0].textContent = c.hex;
  if (codes[1]) codes[1].textContent = `${rgb.r} ${rgb.g} ${rgb.b}`;
  if (codes[2]) codes[2].textContent = `${cmyk.c} ${cmyk.m} ${cmyk.y} ${cmyk.k}`;
  if (c.role === 'primary') _applyAccent(c.hex);
}

// ── Atelier des déclinaisons (proposées, jamais imposées) ──
function _renderHarmonyStudio(palette) {
  const base = palette.find(c => c.role === 'primary') || palette[0];
  const h = harmonies(base.hex);
  if (!h) return '';
  const inPalette = new Set(palette.map(c => c.hex.toLowerCase()));
  const rows = Object.entries(h).map(([key, hexes]) => {
    const [title, sub] = HARMONY_LABELS[key] || [key, ''];
    const chips = hexes.map(hex => {
      const taken = inPalette.has(hex.toLowerCase());
      return `
        <button class="kb-harmony-chip ${taken ? 'is-taken' : ''}" data-act="harmony-add"
                data-hex="${_esc(hex)}" data-name="${_esc(title)}"
                style="background:${_esc(hex)};color:${_inkOn(hex)}"
                title="${taken ? 'Déjà dans la palette' : `Ajouter ${_esc(hex)} à la palette`}" ${taken ? 'disabled' : ''}>
          ${taken ? icon('check', 14) : icon('plus', 14)}<span>${_esc(hex)}</span>
        </button>`;
    }).join('');
    return `
      <div class="kb-harmony-row">
        <div class="kb-harmony-label"><strong>${title}</strong><span>${sub}</span></div>
        <div class="kb-harmony-chips">${chips}</div>
      </div>`;
  }).join('');
  return `
    <section class="kb-lab">
      <h3 class="kb-lab-title">Déclinaisons depuis « ${_esc(base.name || base.hex)} »</h3>
      <p class="kb-hint">Des pistes calculées par théorie des couleurs — un clic les ajoute, rien n'est imposé.</p>
      ${rows}
    </section>`;
}

// ── Test de visibilité (WCAG + daltonisme) ──
function _pairOptions(palette, selected) {
  const opts = [
    ...palette.map(c => [`c:${c.id}`, c.name || c.hex]),
    ['#ffffff', 'Blanc'], ['#000000', 'Noir'],
  ];
  return opts.map(([v, lbl]) => `<option value="${_esc(v)}" ${selected === v ? 'selected' : ''}>${_esc(lbl)}</option>`).join('');
}
function _pairHex(v, palette) {
  if (!v) return null;
  if (v.startsWith('c:')) return _colorOf(v.slice(2))?.hex || null;
  return v;
}
function _renderContrastLab(palette) {
  const primary = palette.find(c => c.role === 'primary') || palette[0];
  if (_pairText === null || !_pairHex(_pairText, palette)) _pairText = `c:${primary.id}`;
  if (_pairBg === null || !_pairHex(_pairBg, palette)) _pairBg = '#ffffff';
  const txt = _pairHex(_pairText, palette), bg = _pairHex(_pairBg, palette);
  const ratio = contrastRatio(txt, bg) || 1;
  const v = wcagVerdict(ratio);
  const badge = (ok, lbl, hint) => `<span class="kb-wcag ${ok ? 'ok' : 'ko'}" title="${hint}">${ok ? icon('check', 12) : icon('x', 12)} ${lbl}</span>`;
  const sims = ['protanopia', 'deuteranopia', 'tritanopia'].map(type => {
    const st = simulateColorBlind(txt, type), sb = simulateColorBlind(bg, type);
    const lbl = { protanopia: 'Protanopie', deuteranopia: 'Deutéranopie', tritanopia: 'Tritanopie' }[type];
    const r = contrastRatio(st, sb) || 1;
    return `
      <figure class="kb-cb-sample" title="${lbl} — contraste ${r.toFixed(1)}:1">
        <div class="kb-cb-box" style="background:${sb};color:${st}">Aa</div>
        <figcaption>${lbl}</figcaption>
      </figure>`;
  }).join('');
  return `
    <section class="kb-lab">
      <h3 class="kb-lab-title">Test de visibilité</h3>
      <div class="kb-pair-row">
        <label class="kb-field-label">Texte <select class="kb-select kb-inline" data-field="pair-text">${_pairOptions(palette, _pairText)}</select></label>
        <label class="kb-field-label">sur fond <select class="kb-select kb-inline" data-field="pair-bg">${_pairOptions(palette, _pairBg)}</select></label>
      </div>
      <div class="kb-contrast-sample" style="background:${bg};color:${txt}">
        <span class="kb-contrast-aa">Aa</span>
        <span class="kb-contrast-text">Le vif renard brun saute par-dessus le chien paresseux.</span>
      </div>
      <div class="kb-contrast-verdict">
        <strong class="kb-ratio">${ratio.toFixed(2)} : 1</strong>
        ${badge(v.aaNormal, 'AA texte', '≥ 4,5:1 — texte courant')}
        ${badge(v.aaLarge, 'AA grands titres', '≥ 3:1 — texte ≥ 18,5 px gras ou 24 px')}
        ${badge(v.aaaNormal, 'AAA', '≥ 7:1 — confort maximal')}
      </div>
      <div class="kb-cb-row">${sims}</div>
      <p class="kb-hint">Simulation daltonisme indicative — environ 1 personne sur 12 est concernée.</p>
    </section>`;
}

// ════════════════════════════════════════════════════════════════
// ONGLET TYPOGRAPHIES (KB-3) — le testeur
// ════════════════════════════════════════════════════════════════
function _typeSection() {
  if (!_chart.draft.typography || typeof _chart.draft.typography !== 'object') {
    _chart.draft.typography = { fonts: [] };
  }
  if (!Array.isArray(_chart.draft.typography.fonts)) _chart.draft.typography.fonts = [];
  return _chart.draft.typography;
}
function _fontsOf() { return _chart ? _typeSection().fonts : []; }
function _fontOf(fid) {
  if (!fid || !_chart) return null;
  return _fontsOf().find(x => x.id === fid) || null;
}
function _newFontId() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); }
function _nextFontRole() {
  const taken = new Set(_fontsOf().map(f => f.role));
  for (const [role] of FONT_ROLES) if (!taken.has(role)) return role;
  return 'body';
}

function _addFont(family) {
  const meta = fontMeta(family);
  if (!meta) return;
  ensureFontLoaded(meta.f, meta.w);
  _typeSection().fonts.push({
    id: _newFontId(), role: _nextFontRole(), source: 'google',
    family: meta.f, axis: meta.w, buyUrl: null,
  });
  _typePicker = false; _typeSearch = '';
  _scheduleSave(); _renderChart();
}
function _addDeclaredFont() {
  _typeSection().fonts.push({
    id: _newFontId(), role: _nextFontRole(), source: 'declared',
    family: '', axis: null, buyUrl: null,
  });
  _typePicker = false;
  _scheduleSave(); _renderChart();
  _root.querySelector('.kb-font-card:last-of-type [data-field="f-family"]')?.focus();
}
function _deleteFont(fid) {
  const f = _fontOf(fid); if (!f) return;
  const ok = window.confirm(`Retirer « ${f.family || 'cette police'} » de la charte ?`);
  if (!ok) return;
  const t = _typeSection();
  t.fonts = t.fonts.filter(x => x.id !== fid);
  _typePrefs.delete(fid);
  _scheduleSave(); _renderChart();
}

function _renderTypeTab() {
  const fonts = _fontsOf();
  // Charger les familles présentes (idempotent — utile après réouverture).
  for (const f of fonts) if (f.source === 'google' && f.family) ensureFontLoaded(f.family, f.axis);

  if (!fonts.length && !_typePicker) return `
    <div class="kb-ghost">
      <div class="kb-ghost-type" aria-hidden="true">
        <span class="kb-ghost-aa">Aa</span>
        <span class="kb-ghost-line w70"></span>
        <span class="kb-ghost-line w50"></span>
      </div>
      <h3>Les typographies, à l'essai</h3>
      <p>Choisissez vos polices, testez-les avec votre propre texte, et offrez leur téléchargement à ceux qui composent pour vous.</p>
      <button class="kb-btn primary" data-act="font-picker">${icon('plus', 16)} Choisir une police</button>
      <p class="kb-hint">Bibliothèque Google Fonts (licences libres). Police payante ? Déclarez-la avec son lien d'achat.</p>
    </div>`;

  const cards = fonts.map(f => _renderFontCard(f)).join('');
  return `
    <div class="kb-type">
      <div class="kb-type-toolbar">
        <div class="kb-type-textrow">
          <input class="kb-field-input kb-type-text" data-field="type-text" value="${_esc(_typeText)}"
                 placeholder="Tapez votre texte d'essai ici…" maxlength="180" aria-label="Texte d'essai">
          <button class="kb-iconbtn" data-act="type-gen" title="Autre phrase d'essai">${icon('refresh', 15)}</button>
        </div>
        <button class="kb-btn primary" data-act="font-picker">${icon('plus', 15)} Ajouter</button>
      </div>
      ${_typePicker ? _renderFontPicker() : ''}
      <div class="kb-type-list">${cards}</div>
    </div>`;
}

function _renderFontCard(f) {
  const pref = _typePrefs.get(f.id) || {};
  const size = pref.size || 34;
  const weights = f.source === 'google' ? weightsOf(f.axis) : [400, 700];
  const weight = pref.weight && weights.includes(pref.weight) ? pref.weight
    : (weights.includes(700) ? 700 : weights[Math.floor(weights.length / 2)]);
  const roleOpts = FONT_ROLES.map(([k, lbl]) => `<option value="${k}" ${f.role === k ? 'selected' : ''}>${lbl}</option>`).join('');
  const wOpts = weights.map(w => `<option value="${w}" ${w === weight ? 'selected' : ''}>${w}</option>`).join('');
  const famCss = f.source === 'google'
    ? `'${f.family.replace(/'/g, '')}', sans-serif`
    : `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

  const head = f.source === 'google' ? `
      <div class="kb-font-id">
        <strong class="kb-font-name" style="font-family:${famCss}">${_esc(f.family)}</strong>
        <span class="kb-font-src">Google Fonts — licence libre</span>
      </div>` : `
      <div class="kb-font-id kb-font-id-declared">
        <input class="kb-field-input kb-v-label" data-field="f-family" value="${_esc(f.family)}" placeholder="Nom de la police (ex. Museo)" maxlength="60" spellcheck="false">
        <input class="kb-field-input" data-field="f-buy" value="${_esc(f.buyUrl || '')}" placeholder="Lien d'achat / licence (https://…)" maxlength="200" spellcheck="false">
      </div>`;

  const acts = f.source === 'google' ? `
      <a class="kb-btn kb-btn-sm" href="${fontSpecimenUrl(f.family)}" target="_blank" rel="noopener noreferrer" title="Page officielle : téléchargement + licence">${icon('download', 14)} Télécharger</a>` : `
      ${f.buyUrl && /^https?:\/\//.test(f.buyUrl) ? `<a class="kb-btn kb-btn-sm" href="${_esc(f.buyUrl)}" target="_blank" rel="noopener noreferrer">${icon('external-link', 14)} Acheter</a>` : ''}`;

  const specimen = f.source === 'google' ? `
      <div class="kb-specimen" data-slot="specimen" style="font-family:${famCss};font-weight:${weight};font-size:${size}px">${_esc(_typeText)}</div>` : `
      <div class="kb-specimen kb-specimen-declared" data-slot="specimen" style="font-size:${Math.min(size, 22)}px">${_esc(_typeText)}
        <span class="kb-hint">Aperçu indisponible — police non hébergée (déclarée pour mémoire, avec son lien).</span>
      </div>`;

  return `
    <article class="kb-font-card" data-fid="${_esc(f.id)}">
      <div class="kb-font-head">
        ${head}
        <div class="kb-font-head-acts">
          <select class="kb-select kb-font-role" data-field="f-role" title="${_esc(FONT_ROLE_HINTS[f.role] || '')}" aria-label="Rôle">${roleOpts}</select>
          ${acts}
          <button class="kb-iconbtn danger" data-act="f-del" title="Retirer">${icon('trash-2', 16)}</button>
        </div>
      </div>
      ${specimen}
      ${f.source === 'google' ? `
      <div class="kb-font-ctrls">
        <label class="kb-field-label">Graisse <select class="kb-select kb-inline-sm" data-field="f-weight">${wOpts}</select></label>
        <label class="kb-field-label kb-font-sizectl">Corps <input type="range" min="14" max="96" step="1" value="${size}" data-field="f-size" aria-label="Corps en pixels"> <span data-slot="size-out">${size} px</span></label>
      </div>` : ''}
    </article>`;
}

function _renderFontPicker() {
  const q = _typeSearch.trim().toLowerCase();
  const list = GOOGLE_FONTS
    .filter(x => _typeCat === 'all' || x.c === _typeCat)
    .filter(x => !q || x.f.toLowerCase().includes(q));
  const taken = new Set(_fontsOf().filter(f => f.source === 'google').map(f => f.family));
  const cats = FONT_CATEGORIES.map(([k, lbl]) =>
    `<button class="kb-cat ${_typeCat === k ? 'on' : ''}" data-act="font-cat" data-cat="${k}">${lbl}</button>`).join('');
  const items = list.map(x => `
    <button class="kb-font-item ${taken.has(x.f) ? 'is-taken' : ''}" data-act="font-pick" data-family="${_esc(x.f)}" ${taken.has(x.f) ? 'disabled' : ''}>
      <span>${_esc(x.f)}</span>${taken.has(x.f) ? icon('check', 13) : ''}
    </button>`).join('');
  return `
    <div class="kb-font-picker">
      <div class="kb-font-picker-head">
        <input class="kb-field-input" data-field="type-search" value="${_esc(_typeSearch)}" placeholder="Rechercher une police…" aria-label="Rechercher" spellcheck="false">
        <div class="kb-cats">${cats}</div>
      </div>
      <div class="kb-font-items" data-slot="font-items">${items || '<p class="kb-hint">Aucune police ne correspond.</p>'}</div>
      <button class="kb-font-declare" data-act="font-declare">${icon('plus', 14)} Ma police n'est pas là (payante / sur-mesure) — la déclarer avec son lien</button>
    </div>`;
}

function _focusTypeSearch() {
  const el = _root?.querySelector('[data-field="type-search"]');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
// Recherche live : ne re-render que la liste (le champ garde le focus).
function _refreshFontPickerList() {
  const box = _root?.querySelector('[data-slot="font-items"]');
  if (!box) return;
  const html = _renderFontPicker().match(/<div class="kb-font-items"[^>]*>([\s\S]*?)<\/div>/);
  if (html) box.innerHTML = html[1];
}
// Texte/graisse/corps live sans re-render (focus + curseurs préservés).
function _refreshSpecimens() {
  if (!_root) return;
  _root.querySelectorAll('.kb-font-card').forEach(card => {
    const f = _fontOf(card.dataset.fid);
    if (!f) return;
    const pref = _typePrefs.get(f.id) || {};
    const sp = card.querySelector('[data-slot="specimen"]');
    if (sp) {
      sp.childNodes[0].textContent = _typeText;
      if (f.source === 'google') {
        if (pref.weight) sp.style.fontWeight = pref.weight;
        if (pref.size) sp.style.fontSize = `${pref.size}px`;
        if (f.family) sp.style.fontFamily = `'${f.family.replace(/'/g, '')}', sans-serif`;
      }
    }
    const out = card.querySelector('[data-slot="size-out"]');
    if (out && pref.size) out.textContent = `${pref.size} px`;
  });
}

// ── Toast ───────────────────────────────────────────────────────
let _toastTimer = null;
function _toast(msg) {
  if (!_root) return;
  let t = _root.querySelector('.kb-toast');
  if (!t) { t = document.createElement('div'); t.className = 'kb-toast'; _root.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
