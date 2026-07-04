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
         hexToRgb, rgbToCmyk, contrastRatio, wcagVerdict, harmonies, simulateColorBlind, relLuminance,
         tonalScale, TONAL_STEPS, nightVariant, contrastRating, enhanceInk } from './key-brand-tools.js';
import { GOOGLE_FONTS, FONT_CATEGORIES, fontMeta, weightsOf, ensureFontLoaded, ensureFontItalic,
         fontSpecimenUrl, TYPE_SAMPLES, TITLE_SAMPLES, BODY_SAMPLES, loremTitle, loremParagraph } from './key-brand-fonts.js';

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
// Le fond d'aperçu est désormais PAR CARTE (v.bg : null = transparent/damier,
// ou '#rrggbb'), persisté sur la variante — chaque logo teste son propre fond.
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

// ── État onglet Couleurs (KB-2 · refonte) ──
let _colorAdv = null;       // couleur dont le bloc avancé est ouvert
let _colorPick = null;      // couleur vide dont le bloc de saisie hex est ouvert
const _colorMode = new Map(); // cid → 'day' | 'night' (mode d'affichage de la carte)
let _visText = null;        // test de visibilité : hex de la couleur de texte
let _visBg = null;          // test de visibilité : hex du fond
let _visBig = false;        // aperçu agrandi
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
let _typeTitle = TITLE_SAMPLES[0]; // texte de titre du spécimen, partagé entre cartes
let _typeBody = BODY_SAMPLES[0];   // texte de paragraphe du spécimen, partagé
let _typeSampleIdx = 0;
// fontId → 'title'|'body' : quel niveau la barre d'outils édite (session seule).
// Les réglages eux-mêmes vivent dans f.spec (PERSISTÉ dans la charte).
const _typeActive = new Map();
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

// ── Onglet Règles (KB-4) ──
// Les ~9 interdits canoniques des chartes professionnelles (relevés dans
// Data Terra / Cap Atlantique / UM / Nevers) — chacun est une simple
// transformation CSS appliquée au VRAI logo de la charte. La classe CSS
// .kb-forbid-<key> porte la maltraitance (key-brand.css).
const INTERDITS_DEFS = [
  ['distort', 'Ne pas déformer le logo'],
  ['tilt',    'Ne pas l\'incliner'],
  ['recolor', 'Ne pas changer ses couleurs'],
  ['invert',  'Ne pas l\'inverser en négatif'],
  ['shadow',  'Ne pas ajouter d\'ombre ni d\'effet'],
  ['outline', 'Ne pas l\'encadrer d\'un filet'],
  ['opacity', 'Ne pas baisser son opacité'],
  ['busybg',  'Ne pas le poser sur un fond chargé'],
  ['crowd',   'Ne pas envahir sa zone de protection'],
];
let _pickTarget = 'logo';   // destination du sélecteur de fichiers : 'logo' | { rule: id } | 'photo'

// ── Onglet Branding (KB-5) ──
// Motions d'intro préréglées — CSS pur, sobres, respectent
// prefers-reduced-motion. La clé = classe .kb-play-<key> (key-brand.css).
const MOTIONS = [
  ['none',    'Aucune',          'la marque, posée'],
  ['fade',    'Fondu',           'apparition en douceur'],
  ['rise',    'Lever',           'monte et se révèle'],
  ['zoom',    'Approche',        'arrive de loin, nette'],
  ['wipe',    'Rideau',          'balayage gauche → droite'],
  ['float',   'Flottement',      'entre puis respire'],
  ['iris',    'Iris',            's\'ouvre en cercle'],
  ['letters', 'Lettre à lettre', 'le nom s\'écrit'],
  ['blur',    'Mise au point',   'flou, puis net'],
];
// KB-8 — réglages de la scène d'ouverture (fond, mise en scène, encre, tempo).
const SCENE_BG_TYPES = [
  ['white',    'Blanc'],
  ['color',    'Couleur'],
  ['gradient', 'Dégradé'],
  ['image',    'Photo'],
  ['video',    'Vidéo'],
];
const SCENE_LAYOUTS = [
  ['center', 'Centré'],
  ['corner', 'Bas gauche'],
  ['split',  'Côte à côte'],
];
const SCENE_INKS = [
  ['auto',  'Auto'],
  ['light', 'Claire'],
  ['dark',  'Sombre'],
];
const SCENE_DURS = [          // multiplicateur de durée des motions (--kb-mo)
  ['fast',   'Vif',   0.6],
  ['normal', 'Posé',  1],
  ['slow',   'Ample', 1.8],
];
// KB-9 — planche d'ambiance : gabarits de collage (cellules photo/vidéo
// + médaillon rond imbriqué par cellule, positionné au clic).
const BOARD_TPLS = [
  ['duo',     'Duo',      ['a', 'b']],
  ['atelier', 'Atelier',  ['a', 'b', 'c']],   // 2 carrés + pleine largeur (la capture)
  ['galerie', 'Galerie',  ['a', 'b', 'c']],   // grande à gauche + 2 empilées
  ['mosaic',  'Mosaïque', ['a', 'b', 'c', 'd']],
  ['pano',    'Panorama', ['a']],
];
const KB_SYM_MAX = 8;       // annotations de symbolique max
const KB_PHOTO_MAX = 6;     // exemples photo max (cap brief)
// KB-11 — onglet Supports : mockups AUTO-COMPOSÉS en CSS avec la charte
// réelle (zéro IA, zéro image générée). L'œil masque un support.
const SUPPORT_DEFS = [
  ['web',    'Site web'],
  ['phone',  'Smartphone'],
  ['card',   'Carte de visite'],
  ['social', 'Réseaux sociaux'],
];
const KB_GALLERY_MAX = 8;   // photos de réalisations max
// KB-13 — identité de marque & ton de voix (audit référentiel Canva :
// « présentation » et « identité verbale » manquaient). Tout déclaratif.
const VOICE_REGS = [
  ['',                'Non défini'],
  ['vous-sobre',      'Vouvoiement, sobre'],
  ['vous-chaleureux', 'Vouvoiement, chaleureux'],
  ['tu-complice',     'Tutoiement, complice'],
  ['tu-direct',       'Tutoiement, direct'],
];
// KB-14 — iconographie (dernier écart du référentiel Canva) : style
// déclaré en trois axes + set d'exemples déposés (SVG/PNG, 12 max).
const ICON_STROKES = [['', '—'], ['outline', 'Filaire'], ['filled', 'Plein'], ['duotone', 'Bicolore']];
const ICON_CORNERS = [['', '—'], ['rounded', 'Arrondis'], ['sharp', 'Vifs']];
const ICON_WEIGHTS = [['', '—'], ['fine', 'Fin'], ['regular', 'Régulier'], ['bold', 'Épais']];
const KB_ICONS_MAX = 12;

// ── Publication (KB-6) ──
let _pubPanel = false;      // panneau « Partager » ouvert
let _pubBusy = false;
let _pubAccess = null;      // choix d'accès en cours d'édition dans le panneau
const ACCESS_OPTIONS = [
  ['unlisted', 'Lien non répertorié', 'seuls ceux qui ont le lien y accèdent (défaut)'],
  ['code',     'Protégé par un code', 'le lien + un code transmis à part'],
  ['public',   'Public',              'accessible à quiconque a le lien'],
];
function _publicUrl() { return _chart ? `${API_BASE}/b/${_chart.slug}` : ''; }

// Les 5 onglets du mini-site. `soon` disparaît au fil des sprints.
const TABS = [
  { key: 'logo',   label: 'Logo',          icon: 'keybrand' },
  { key: 'colors', label: 'Couleurs',      icon: 'palette' },
  { key: 'type',   label: 'Typographies',  icon: 'type' },
  { key: 'rules',  label: 'Règles',        icon: 'shield-check' },
  { key: 'brand',  label: 'Branding',      icon: 'sparkles' },
  { key: 'supports', label: 'Supports',    icon: 'monitor' },
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
  picker.accept = '.svg,.png,.jpg,.jpeg,.webp,.pdf,.mp4,.webm,image/svg+xml,image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/webm';
  picker.style.display = 'none';
  picker.dataset.slot = 'filepicker';
  _root.appendChild(picker);
  picker.addEventListener('change', () => { _onFilesPicked(picker.files); picker.value = ''; });

  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('input', _onInput);
  _root.addEventListener('change', _onChange);
  _root.addEventListener('focusout', _onBlur);
  _root.addEventListener('mousemove', _onMove);
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
  _dlPanel = null; _logoAdv = false;
  _colorAdv = null; _colorPick = null; _visText = null; _visBg = null; _visBig = false; _colorMode.clear();
  _typePicker = false; _typeSearch = ''; _typeCat = 'all'; _typeActive.clear();
  _pubPanel = false; _pubAccess = null;
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
// L'accent du CHROME doit rester lisible : une primaire marine sur le
// workspace sombre disparaissait (textes/filets accent illisibles). On
// glisse sur l'échelle tonale de la MÊME teinte jusqu'à ≥ 3:1 avec le
// fond réel — la couleur exacte de la marque reste montrée dans le canvas.
function _chromeAccent(hex) {
  let bg = '#12141c';
  try {
    const raw = getComputedStyle(_root.querySelector('.kb-main') || _root).backgroundColor;
    const m = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) bg = '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
  } catch (_) {}
  if ((contrastRatio(hex, bg) || 0) >= 3) return hex;
  const scale = tonalScale(hex) || {};
  const darkBg = relLuminance(hexToRgb(bg) || { r: 18, g: 20, b: 28 }) < 0.4;
  const steps = darkBg ? [400, 300, 200, 100] : [600, 700, 800, 900];
  for (const st of steps) {
    const c = scale[st];
    if (c && (contrastRatio(c, bg) || 0) >= 3) return c;
  }
  return (darkBg ? scale[100] : scale[900]) || hex;
}
function _applyAccent(hex) {
  if (!_root) return;
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const ui = _chromeAccent(hex);
    _root.style.setProperty('--kb-accent', ui);
    _root.style.setProperty('--kb-accent-ink', _inkOn(ui));   // encre lisible sur l'accent (clair→sombre)
  } else {
    _root.style.removeProperty('--kb-accent');
    _root.style.removeProperty('--kb-accent-ink');
  }
}
function _primaryHex(kit) {
  const p = kit && kit.colors && Array.isArray(kit.colors.palette) ? kit.colors.palette : [];
  const prim = p.find(c => c.role === 'primary') || p[0];
  return prim && prim.hex ? prim.hex : null;
}

// ── Événements ──────────────────────────────────────────────────
function _onClick(e) {
  // Symbolique du signe (KB-5) : un clic sur le logo pose une annotation.
  const symCanvas = e.target.closest('[data-slot="sym-canvas"]');
  if (symCanvas && !e.target.closest('[data-act]')) { _addSymbolAt(symCanvas, e); return; }

  // Planche d'ambiance (KB-9) : clic sur la photo d'une cellule → place le médaillon.
  const bdCell = e.target.closest('[data-slot="bd-cell"]');
  if (bdCell && !e.target.closest('[data-act]')) { _placeBoardMed(bdCell, e); return; }

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
  if (act === 'logo-add')  { _pickTarget = 'logo'; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'logo-zip')  { _downloadKit(); return; }
  if (act === 'v-bg-clear' && vid) { const v = _variantOf(vid); if (v) { v.bg = null; _scheduleSave(); _renderChart(); } return; }
  if (act === 'v-bg-preset' && vid) { const v = _variantOf(vid); if (v) { v.bg = btn.dataset.bg; _scheduleSave(); _renderChart(); } return; }
  if (act === 'logo-adv')  { _logoAdv = !_logoAdv; _renderChart(); return; }
  if (act === 'v-dl' && vid)      { _dlPanel = _dlPanel === vid ? null : vid; _renderChart(); return; }
  if (act === 'v-dl-orig' && vid) { _downloadOriginal(vid); return; }
  if (act === 'v-dl-png' && vid)  { _downloadPng(vid, btn); return; }
  if (act === 'v-del' && vid)     { _deleteVariant(vid); return; }

  // ── Onglet Couleurs (KB-2) ──
  const cid = btn.closest('[data-cid]')?.dataset.cid;
  if (act === 'color-add')          { _addColor(); return; }
  if (act === 'copy')               { _copy(btn.dataset.copy); return; }
  if (act === 'c-pick' && cid)      { _colorPick = cid; _renderChart(); _focusHexEntry(cid); return; }
  if (act === 'c-mode' && cid)      { _setColorMode(cid, btn.dataset.mode); return; }
  if (act === 'c-adv' && cid)       { _colorAdv = _colorAdv === cid ? null : cid; _renderChart(); return; }
  if (act === 'c-del' && cid)       { _deleteColor(cid); return; }
  if (act === 'c-night-auto' && cid){ const c = _colorOf(cid); if (c) { c.nightHex = null; _scheduleSave(); _renderChart(); } return; }
  if (act === 'harmony-add')        { _addColor(btn.dataset.hex, btn.dataset.name); return; }
  if (act === 'vis-enhance')        { _enhanceVis(); return; }
  if (act === 'vis-big')            { _visBig = !_visBig; _renderChart(); return; }

  // ── Publication (KB-6) ──
  if (act === 'pub-panel') { _pubPanel = !_pubPanel; _pubAccess = null; _renderChart(); return; }
  if (act === 'pub-go')    { _publish(); return; }
  if (act === 'pub-open')  { window.open(_publicUrl(), '_blank', 'noopener'); return; }

  // ── Onglet Branding (KB-5) ──
  if (act === 'brand-motion')  { _setMotion(btn.dataset.motion); return; }
  if (act === 'brand-replay')  { _replayMotion(); return; }
  // ── Scène d'ouverture (KB-8) ──
  if (act === 'scene-bgtype')  { _setSceneProp('bgType', btn.dataset.v); return; }
  if (act === 'scene-lay')     { _setSceneProp('layout', btn.dataset.v); return; }
  if (act === 'scene-ink')     { _setSceneProp('ink', btn.dataset.v); return; }
  if (act === 'scene-dur')     { _setSceneProp('dur', btn.dataset.v); return; }
  if (act === 'scene-c')       { _setSceneColor(btn.dataset.n, btn.dataset.hex); return; }
  if (act === 'scene-cnext')   { // pastille palette : remplit C1, puis C2 en dégradé
    const sc = _sceneOf();
    const ok = v => /^#[0-9a-fA-F]{6}$/.test(v || '');
    if (sc.bgType === 'gradient' && ok(sc.c1)) _setSceneColor('2', btn.dataset.hex);
    else _setSceneColor('1', btn.dataset.hex);
    return;
  }
  if (act === 'scene-media')     { _pickTarget = 'scene-media'; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'scene-media-del') { _deleteSceneMedia(); return; }
  if (act === 'sym-del')       { _deleteSymbol(parseInt(btn.dataset.idx, 10)); return; }
  if (act === 'ph-add')        { _pickTarget = 'photo'; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'ph-del')        { _deletePhoto(btn.dataset.aid); return; }
  // ── Planche d'ambiance (KB-9) ──
  const slot = btn.closest('[data-cell]')?.dataset.cell;
  if (act === 'board-tpl')            { const bd = _boardOf(); bd.template = btn.dataset.v; _scheduleSave(); _renderChart(); return; }
  if (act === 'bd-cell-add' && slot)  { _pickTarget = { bdCell: slot }; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'bd-cell-del' && slot)  { _deleteBoardCell(slot); return; }
  if (act === 'bd-med-add' && slot)   { _pickTarget = { bdMed: slot }; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'bd-med-del' && slot)   { _deleteBoardMed(slot); return; }
  // ── Onglet Supports (KB-11) ──
  if (act === 'sup-toggle')   { const s = _supportsOf(); s.enabled[btn.dataset.k] = !s.enabled[btn.dataset.k]; _scheduleSave(); _renderChart(); return; }
  if (act === 'sup-shot')     { _pickTarget = { supShot: btn.dataset.k }; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'sup-shot-del') { _deleteSupportShot(btn.dataset.k); return; }
  if (act === 'sup-gal-add')  { _pickTarget = 'sup-gallery'; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'sup-gal-del')  { _deleteGalleryItem(btn.dataset.aid); return; }
  // ── Ton de voix (KB-13) ──
  if (act === 'vo-reg')    { _identityOf().voice.reg = btn.dataset.v || ''; _scheduleSave(); _renderChart(); return; }
  // ── Iconographie (KB-14) ──
  if (act === 'ic-stroke')  { _iconsOf().stroke = btn.dataset.v || ''; _scheduleSave(); _renderChart(); return; }
  if (act === 'ic-corners') { _iconsOf().corners = btn.dataset.v || ''; _scheduleSave(); _renderChart(); return; }
  if (act === 'ic-weight')  { _iconsOf().weight = btn.dataset.v || ''; _scheduleSave(); _renderChart(); return; }
  if (act === 'ic-add')     { _pickTarget = 'icons'; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'ic-del')     { _deleteIcon(btn.dataset.aid); return; }
  // ── Symbolique v2 (KB-10) : calque de construction ──
  if (act === 'con-add')    { _pickTarget = 'construction'; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'con-del')    { _deleteConstruction(); return; }
  // ── Édition publiée (KB-12) ──
  if (act === 'pub-mode')  { _pubThemeOf().mode = btn.dataset.v === 'dark' ? 'dark' : 'light'; _scheduleSave(); _renderChart(); return; }
  if (act === 'pub-tint')  { _pubThemeOf().tint = btn.dataset.hex || null; _scheduleSave(); _renderChart(); return; }

  // ── Onglet Règles (KB-4) ──
  const rid = btn.closest('[data-rid]')?.dataset.rid;
  if (act === 'rule-toggle')     { _toggleInterdit(btn.dataset.key); return; }
  if (act === 'rule-custom-add') { _addCustomRule(); return; }
  if (act === 'rc-del' && rid)   { _deleteCustomRule(rid); return; }
  if (act === 'rc-kind' && rid)  { _toggleRuleKind(rid); return; }
  if (act === 'rc-img' && rid)   { _pickTarget = { rule: rid }; _root.querySelector('[data-slot="filepicker"]')?.click(); return; }
  if (act === 'goto-logo')       { _tab = 'logo'; _renderChart(); return; }

  // ── Onglet Typographies (KB-3) ──
  const fid = btn.closest('[data-fid]')?.dataset.fid;
  if (act === 'font-picker')   { _typePicker = !_typePicker; _typeSearch = ''; _renderChart(); return; }
  if (act === 'font-cat')      { _typeCat = btn.dataset.cat || 'all'; _renderChart(); _focusTypeSearch(); return; }
  if (act === 'font-pick')     { _addFont(btn.dataset.family); return; }
  if (act === 'font-declare')  { _addDeclaredFont(); return; }
  if (act === 'type-gen')      { _typeSampleIdx = (_typeSampleIdx + 1) % TITLE_SAMPLES.length; _typeTitle = TITLE_SAMPLES[_typeSampleIdx]; _typeBody = BODY_SAMPLES[_typeSampleIdx % BODY_SAMPLES.length]; _renderChart(); return; }
  if (act === 'type-lorem')    { _typeTitle = loremTitle(); _typeBody = loremParagraph(); _renderChart(); return; }
  if (act === 'ft-level' && fid) { _typeActive.set(fid, btn.dataset.level === 'body' ? 'body' : 'title'); _renderChart(); return; }
  if (act === 'ft-sz' && fid) {
    const f = _fontOf(fid); if (!f) return;
    const d = parseInt(btn.dataset.d, 10) || 0;
    const cur = _specOf(f)[_activeLevel(fid)].size;
    _editSpec(fid, { size: Math.max(10, Math.min(160, cur + d)) }); return;
  }
  if (act === 'ft-ital' && fid) {
    const f = _fontOf(fid); if (!f) return;
    const cur = _specOf(f)[_activeLevel(fid)].ital;
    if (f.source === 'google') ensureFontItalic(f.family, f.axis);
    _editSpec(fid, { ital: !cur }); return;
  }
  if (act === 'ft-align' && fid) { _editSpec(fid, { align: btn.dataset.a }); return; }
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
    logo.protection.ratio = Math.max(0.25, Math.min(2, parseFloat(el.value) || 0.5));
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
  // Fond d'aperçu par carte : saisie hex sans le # (préfixe visuel fixe).
  if (el.dataset.field === 'card-bg' && v) {
    const hex = el.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    if (el.value !== hex) el.value = hex;   // filtre les caractères non-hex à la volée
    v.bg = /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : (hex === '' ? null : v.bg);
    _scheduleSave();
    _applyCardBg(el.closest('.kb-logo-card'), v);
  }

  // ── Onglet Couleurs (KB-2) ──
  const c = _colorOf(el.closest('[data-cid]')?.dataset.cid);
  if (el.dataset.field === 'c-name' && c)    { c.name = el.value.slice(0, 40); _scheduleSave(); }
  if (el.dataset.field === 'c-pantone' && c) { c.pantone = el.value.slice(0, 30) || null; _scheduleSave(); }
  if (el.dataset.field === 'c-story' && c)   { c.story = el.value.slice(0, 160) || null; _scheduleSave(); }
  if (el.dataset.field === 'c-hex' && c) {
    // Pipette live : on rafraîchit la carte sans re-render (focus préservé) ;
    // le re-render complet (harmonies, contrastes, accent) vient au 'change'.
    const wasEmpty = !_visHexOk(c.hex);
    c.hex = el.value; _scheduleSave();
    if (wasEmpty) { _colorPick = null; }              // roue (secondaire) : rendu complet au 'change'
    else { _refreshColorCard(el.closest('.kb-color-card'), c); _refreshHarmony(); }
  }
  // Saisie alphanumérique du code (primaire) : dès 6 caractères hex → carte remplie.
  if (el.dataset.field === 'c-hexcode' && c) {
    const h = el.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
    if (el.value !== h) el.value = h;                 // filtre # et caractères non-hex à la volée
    if (h.length === 6) { c.hex = `#${h.toLowerCase()}`; _colorPick = null; _scheduleSave(); _renderChart(); }
  }
  if (el.dataset.field === 'c-night' && c)   { c.nightHex = el.value; _scheduleSave(); _refreshColorCard(el.closest('.kb-color-card'), c); }
  // Test de visibilité : hex libres (champ texte) ou pipette.
  if (el.dataset.field === 'vis-text' || el.dataset.field === 'vis-text-pick') { _visText = _visReadHex(el, _visText); _refreshVisLab(); }
  if (el.dataset.field === 'vis-bg'   || el.dataset.field === 'vis-bg-pick')   { _visBg   = _visReadHex(el, _visBg);   _refreshVisLab(); }

  // ── Onglet Typographies (KB-3) ──
  const f = _fontOf(el.closest('[data-fid]')?.dataset.fid);
  if (el.dataset.field === 'type-search') { _typeSearch = el.value; _refreshFontPickerList(); }
  if (el.dataset.field === 'type-title')  { _typeTitle = el.value; _refreshSpecimens(); }
  if (el.dataset.field === 'type-body')   { _typeBody = el.value; _refreshSpecimens(); }
  if (el.dataset.field === 'f-family' && f) {
    f.family = el.value.slice(0, 60); _scheduleSave();
    const card = el.closest('.kb-font-card');   // aperçu local live sans perdre le focus
    if (card) card.querySelectorAll('[data-slot="spec-title"],[data-slot="spec-body"]').forEach(s => { s.style.fontFamily = _famCss(f); });
  }
  if (el.dataset.field === 'f-buy' && f)    { f.buyUrl = el.value.slice(0, 200) || null; _scheduleSave(); }

  // ── Planche d'ambiance (KB-9) : titre + paragraphe, saisis en place ──
  if (el.dataset.field === 'bd-title') { _boardOf().title = el.value.slice(0, 80); _scheduleSave(); }
  if (el.dataset.field === 'bd-text')  { _boardOf().text = el.value.slice(0, 500); _scheduleSave(); }

  // ── Scène (KB-8) : saisie hex en ligne — commit à 6 caractères valides.
  if (el.dataset.field === 'scene-hex1' || el.dataset.field === 'scene-hex2') {
    const m = el.value.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (m) _setSceneColor(el.dataset.field.endsWith('2') ? '2' : '1', '#' + m[1]);
  }

  // ── Identité & ton de voix (KB-13) ──
  if (el.dataset.field === 'id-mission') { _identityOf().mission = el.value.slice(0, 160); _scheduleSave(); }
  if (el.dataset.field === 'id-story')   { _identityOf().story = el.value.slice(0, 600); _scheduleSave(); }
  if (el.dataset.field === 'id-value') {
    const i = parseInt(el.dataset.idx, 10);
    if (i >= 0 && i < 5) { _identityOf().values[i] = el.value.slice(0, 24); _scheduleSave(); }
  }
  if (el.dataset.field === 'vo-principle') {
    const i = parseInt(el.dataset.idx, 10);
    if (i >= 0 && i < 3) { _identityOf().voice.principles[i] = el.value.slice(0, 80); _scheduleSave(); }
  }
  if (el.dataset.field === 'vo-use')     { _identityOf().voice.use = el.value.slice(0, 160); _scheduleSave(); }
  if (el.dataset.field === 'vo-avoid')   { _identityOf().voice.avoid = el.value.slice(0, 160); _scheduleSave(); }
  if (el.dataset.field === 'vo-example') { _identityOf().voice.example = el.value.slice(0, 240); _scheduleSave(); }

  // ── Onglet Supports (KB-11) : domaine + carte de visite ──
  // Mise à jour chirurgicale du mockup (re-render = focus perdu en pleine frappe).
  if (el.dataset.field === 'sup-domain') {
    _supportsOf().domain = el.value.slice(0, 60); _scheduleSave();
    const url = _root.querySelector('[data-mk="url"]');
    if (url) url.textContent = _supportsOf().domain.trim() || _slugDomain(_brandKit().name);
  }
  if (el.dataset.field?.startsWith('sup-card-')) {
    const k = el.dataset.field.slice(9);   // name | role | tel | email
    if (['name', 'role', 'tel', 'email'].includes(k)) {
      _supportsOf().card[k] = el.value.slice(0, 80); _scheduleSave();
      const t = _root.querySelector(`[data-mk="card-${k}"]`);
      if (t) t.textContent = _supportsOf().card[k] || t.dataset.fallback || '';
    }
  }

  // ── Onglet Règles (KB-4) ──
  if (el.dataset.field === 'rc-label') {
    const rid = el.closest('[data-rid]')?.dataset.rid;
    const r = _chart && _rulesSection().custom.find(x => x.id === rid);
    if (r) { r.label = el.value.slice(0, 160); _scheduleSave(); }
  }

  // ── Onglet Branding (KB-5) ──
  if (el.dataset.field === 'sym-text' && _chart) {
    const s = _brandSection().symbolism[parseInt(el.dataset.idx, 10)];
    if (s) { s.text = el.value.slice(0, 120); _scheduleSave(); }
  }
  if (el.dataset.field === 'sym-title' && _chart) {
    const s = _brandSection().symbolism[parseInt(el.dataset.idx, 10)];
    if (s) { s.title = el.value.slice(0, 28); _scheduleSave(); }
  }
  // Iconographie (KB-14) : note libre.
  if (el.dataset.field === 'ic-note' && _chart) { _iconsOf().note = el.value.slice(0, 200); _scheduleSave(); }
  // Calque de construction (KB-10) : opacité live, sans re-render.
  if (el.dataset.field === 'con-op' && _chart) {
    const v = Math.min(1, Math.max(0.1, parseFloat(el.value) || 0.5));
    _constructionOf().opacity = v;
    const ov = _root.querySelector('[data-slot="con-overlay"]');
    if (ov) ov.style.opacity = v;
    _scheduleSave();
  }
  if (el.dataset.field === 'ph-word' && _chart) {
    const b = _brandSection();
    b.photo = b.photo || { words: [], exampleAssetIds: [] };
    b.photo.words[parseInt(el.dataset.idx, 10)] = el.value.slice(0, 30);
    _scheduleSave();
  }
}

// Les <select> émettent 'change', pas 'input'.
function _onChange(e) {
  const el = e.target;
  if (!el.dataset) return;
  const v = _variantOf(el.closest('[data-vid]')?.dataset.vid);
  if (el.dataset.field === 'v-kind' && v) { v.kind = el.value; _scheduleSave(); }

  // ── Onglet Couleurs (KB-2) ──
  const c = _colorOf(el.closest('[data-cid]')?.dataset.cid);
  if ((el.dataset.field === 'c-hex' || el.dataset.field === 'c-night') && c) { _renderChart(); }
  if (el.dataset.field === 'c-role' && c) {
    if (el.value === 'primary') {
      // Une seule primaire : l'ancienne redevient secondaire.
      for (const other of _paletteOf()) if (other !== c && other.role === 'primary') other.role = 'secondary';
    }
    c.role = el.value; _scheduleSave(); _renderChart();
  }

  // ── Publication (KB-6) : bascule d'accès → montre/cache le champ code.
  if (el.dataset.field === 'pub-access') { _pubAccess = el.value; _renderChart(); }

  // ── Scène d'ouverture (KB-8) : roues chromatiques du fond.
  if (el.dataset.field === 'scene-cw1') { _setSceneColor('1', el.value); }
  if (el.dataset.field === 'scene-cw2') { _setSceneColor('2', el.value); }

  // ── Édition publiée (KB-12) : roue de la teinte.
  if (el.dataset.field === 'pub-tintwheel') {
    const m = String(el.value || '').match(/^#[0-9a-fA-F]{6}$/);
    if (m) { _pubThemeOf().tint = el.value.toLowerCase(); _scheduleSave(); _renderChart(); }
  }

  // ── Onglet Typographies (KB-3) ──
  const f = _fontOf(el.closest('[data-fid]')?.dataset.fid);
  if (el.dataset.field === 'f-role' && f)   { f.role = el.value; _scheduleSave(); _renderChart(); }
  if (el.dataset.field === 'ftw' && f) { _editSpec(f.id, { w: parseInt(el.value, 10) || 400 }); }
  if (el.dataset.field === 'fbl' && f) { _editSpec(f.id, { lh: parseFloat(el.value) || 1.5 }); }
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

// Trait guide des déclinaisons : suit le curseur sur la bande de teintes OU
// sur le dégradé ; revient au centre (500) quand on quitte la zone.
let _activeGuide = null;
function _onMove(e) {
  const zone = e.target.closest && e.target.closest('.kb-tone-band, .kb-tone-gradient');
  if (!zone) {
    if (_activeGuide) { _activeGuide.style.left = ''; _activeGuide = null; }
    return;
  }
  const scale = zone.closest('.kb-cc-scale');
  const plot  = scale && scale.querySelector('.kb-tone-plot');
  const guide = scale && scale.querySelector('.kb-tone-guide');
  if (!plot || !guide) return;
  const r = plot.getBoundingClientRect();
  guide.style.left = `${Math.max(0, Math.min(r.width, e.clientX - r.left))}px`;
  _activeGuide = guide;
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
      ? `<span class="kb-card-status"><span class="kb-livedot"></span>En ligne</span>`
      : `<span class="kb-card-status is-draft">Brouillon</span>`;
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

  const pubBadge = _chart.status === 'published'
    ? `<span class="kb-livedot" title="Version ${_chart.version} en ligne" aria-label="Version ${_chart.version} en ligne"></span>`
    : `<span class="kb-badge">Brouillon</span>`;

  main.innerHTML = `
    <div class="kb-chart">
      <div class="kb-chart-head">
        <div class="kb-chart-topline">
          <button class="kb-link-back" data-act="back-lib">${icon('chevron-left', 16)} Chartes</button>
          <div class="kb-pubbar">
            ${pubBadge}
            <button class="kb-btn ${_pubPanel ? '' : 'primary'}" data-act="pub-panel">${icon('share-2', 15)} Partager</button>
          </div>
        </div>
        <div class="kb-identity">
          <input class="kb-name-input" data-field="chart-name" value="${_esc(_chart.name)}" maxlength="80"
                 aria-label="Nom de la marque" spellcheck="false">
          <input class="kb-baseline-input" data-field="chart-baseline" value="${_esc(_chart.draft?.meta?.baseline || '')}"
                 maxlength="140" placeholder="Baseline (facultative) — ce que la marque promet, en une ligne"
                 aria-label="Baseline" spellcheck="false">
        </div>
      </div>
      ${_pubPanel ? _renderPubPanel() : ''}
      <nav class="kb-tabs" role="tablist">${tabs}</nav>
      <section class="kb-tabpane" role="tabpanel">${_renderTab(_tab)}</section>
    </div>`;

  if (_pubPanel && _chart.status === 'published') _renderPubQr();

  if (_tab === 'logo' || _tab === 'rules' || _tab === 'brand' || _tab === 'supports') _hydrateLogoImgs();
}

// Spécimens fantômes — l'état le plus important de l'app (brief §6) :
// une charte vide ressemble à une galerie avant vernissage, jamais à
// une base de données vide. Une invitation, une action, rien d'autre.
function _renderTab(key) {
  if (key === 'logo') return _renderLogoTab();

  if (key === 'colors') return _renderColorsTab();

  if (key === 'type') return _renderTypeTab();

  if (key === 'rules') return _renderRulesTab();

  if (key === 'supports') return _renderSupportsTab();

  return _renderBrandTab();
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

  const cards = variants.map(v => _renderVariantCard(v)).join('');

  const logo = _logoSection();
  const prot = logo.protection;
  const mins = logo.minSizes;
  const advFilled = !!(prot || (mins && (mins.printMm || mins.digitalPx)));

  return `
    <div class="kb-logo">
      <div class="kb-logo-toolbar">
        <p class="kb-hint">Saisissez un code couleur sous chaque logo pour tester sa lisibilité sur le fond voulu.</p>
        <div class="kb-logo-toolbar-acts">
          <button class="kb-btn" data-act="logo-zip" ${_uploading ? 'disabled' : ''}>${icon('download', 15)} Kit .zip</button>
          <button class="kb-addpill" data-act="logo-add" ${_uploading ? 'disabled' : ''} title="${_uploading ? 'Envoi…' : 'Ajouter un logo'}" aria-label="Ajouter un logo">${icon('plus', 18)}</button>
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

  const bgHex = (v.bg && /^#[0-9a-fA-F]{6}$/.test(v.bg)) ? v.bg.slice(1) : '';
  return `
    <article class="kb-logo-card" data-vid="${_esc(v.id)}">
      <div class="kb-logo-preview ${_cardBgClass(v)}" ${_cardBgStyle(v)}>${preview}</div>
      <div class="kb-bgfield">
        <span class="kb-bgfield-lbl">Fond d'aperçu</span>
        <div class="kb-bgfield-ctrls">
          <button class="kb-bgfield-ck ${bgHex ? '' : 'on'}" data-act="v-bg-clear" title="Fond transparent" aria-label="Fond transparent"></button>
          <button class="kb-bgfield-sw ${v.bg === '#ffffff' ? 'on' : ''}" data-act="v-bg-preset" data-bg="#ffffff" style="background:#fff" title="Fond blanc" aria-label="Fond blanc"></button>
          <button class="kb-bgfield-sw ${v.bg === '#0c0d10' ? 'on' : ''}" data-act="v-bg-preset" data-bg="#0c0d10" style="background:#0c0d10" title="Fond noir" aria-label="Fond noir"></button>
          <div class="kb-bgfield-hex">
            <span class="kb-bgfield-hash">#</span>
            <input class="kb-bgfield-input" data-field="card-bg" value="${_esc(bgHex)}" placeholder="ffffff" maxlength="6" spellcheck="false" autocapitalize="off" aria-label="Code couleur du fond">
          </div>
        </div>
      </div>
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
      <div class="kb-prot-viz">
        <div class="kb-prot-zone" data-slot="prot-zone" style="--kb-prot:${Math.round(prot.ratio * KB_PROT_LOGO_H)}px"><img data-asset="${_esc(first.assetId)}" alt="" draggable="false"></div>
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

// ── Fond d'aperçu PAR CARTE (v.bg : null = transparent/damier, ou '#rrggbb') ──
function _cardBgClass(v) { return (v.bg && /^#[0-9a-fA-F]{6}$/.test(v.bg)) ? 'is-custom' : 'is-checker'; }
function _cardBgStyle(v) { return (v.bg && /^#[0-9a-fA-F]{6}$/.test(v.bg)) ? `style="background:${_esc(v.bg)}"` : ''; }
// Applique le fond d'une carte en direct (sans re-render, focus préservé).
function _applyCardBg(card, v) {
  if (!card) return;
  const prev = card.querySelector('.kb-logo-preview');
  const ck = card.querySelector('.kb-bgfield-ck');
  const on = !!(v.bg && /^#[0-9a-fA-F]{6}$/.test(v.bg));
  if (prev) { prev.className = `kb-logo-preview ${on ? 'is-custom' : 'is-checker'}`; prev.style.background = on ? v.bg : ''; }
  if (ck) ck.classList.toggle('on', !on);
}
// Zone de protection : le repère visuel = marge autour du logo = ratio × sa
// hauteur. Le viz coupe (overflow) au besoin, logo toujours centré.
const KB_PROT_LOGO_H = 40;   // hauteur de référence du logo dans le viz (px)
function _refreshProtViz() {
  const logo = _logoSection();
  const r = logo.protection?.ratio ?? 0.5;
  const zone = _root?.querySelector('[data-slot="prot-zone"]');
  if (zone) zone.style.setProperty('--kb-prot', `${Math.round(r * KB_PROT_LOGO_H)}px`);
  const out = _root?.querySelector('[data-slot="prot-ratio-out"]');
  if (out) out.textContent = r;
}

// Aperçus : les <img> reçoivent leur objectURL authentifié après le rendu.
async function _hydrateLogoImgs() {
  if (!_root) return;
  const media = [..._root.querySelectorAll('img[data-asset],video[data-asset]')];
  for (const el of media) {
    try {
      el.src = await _assetUrl(el.dataset.asset);
      if (el.tagName === 'VIDEO') el.play().catch(() => {});   // autoplay muet (KB-8)
    }
    catch (_) { el.closest('.kb-logo-preview,.kb-prot-zone')?.classList.add('is-broken'); }
  }
}

// ── Dépôt de fichiers ──
async function _onFilesPicked(fileList) {
  if (!_chart || !fileList || !fileList.length) return;
  // Cible « vignette de règle custom » (KB-4) : un seul fichier image.
  if (_pickTarget && _pickTarget.rule) {
    const target = _pickTarget; _pickTarget = 'logo';
    await _onRuleImagePicked(fileList[0], target.rule);
    return;
  }
  // Cible « exemples de direction photo » (KB-5).
  if (_pickTarget === 'photo') {
    _pickTarget = 'logo';
    await _onPhotosPicked([...fileList]);
    return;
  }
  // Cible « fond de la scène d'ouverture » (KB-8) : une photo ou une vidéo.
  if (_pickTarget === 'scene-media') {
    _pickTarget = 'logo';
    await _onSceneMediaPicked(fileList[0]);
    return;
  }
  // Cibles « planche d'ambiance » (KB-9) : cellule (photo/vidéo) ou médaillon (photo).
  if (_pickTarget && _pickTarget.bdCell) {
    const target = _pickTarget; _pickTarget = 'logo';
    await _onBoardCellPicked(fileList[0], target.bdCell);
    return;
  }
  if (_pickTarget && _pickTarget.bdMed) {
    const target = _pickTarget; _pickTarget = 'logo';
    await _onBoardMedPicked(fileList[0], target.bdMed);
    return;
  }
  // Cibles « supports » (KB-11) : capture d'écran ou photos de réalisations.
  if (_pickTarget && _pickTarget.supShot) {
    const target = _pickTarget; _pickTarget = 'logo';
    await _onSupportShotPicked(fileList[0], target.supShot);
    return;
  }
  if (_pickTarget === 'sup-gallery') {
    _pickTarget = 'logo';
    await _onGalleryPicked([...fileList]);
    return;
  }
  // Cibles « iconographie » (KB-14) et « calque de construction » (KB-10).
  if (_pickTarget === 'icons') {
    _pickTarget = 'logo';
    await _onIconsPicked([...fileList]);
    return;
  }
  if (_pickTarget === 'construction') {
    _pickTarget = 'logo';
    await _onConstructionPicked(fileList[0]);
    return;
  }
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
    hex: (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) ? hex.toLowerCase() : null,   // vide → à remplir par l'utilisateur
    role: palette.some(x => x.role === 'primary') ? (palette.length >= 2 ? 'extra' : 'secondary') : 'primary',
    cmyk: null, pantone: null, story: null, nightHex: null,
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
  _colorMode.delete(cid);
  _scheduleSave(); _renderChart();
}

// Mode d'affichage d'une carte couleur (jour = teinte de base, nuit = teinte
// adaptée au fond sombre, calculée automatiquement sauf override utilisateur).
function _cardMode(cid) { return _colorMode.get(cid) === 'night' ? 'night' : 'day'; }
function _nightOf(c) {
  return (c.nightHex && /^#[0-9a-fA-F]{6}$/.test(c.nightHex)) ? c.nightHex : nightVariant(c.hex);
}
function _shownHex(c) { return _cardMode(c.id) === 'night' ? _nightOf(c) : c.hex; }
function _setColorMode(cid, mode) {
  if (!cid) return;
  _colorMode.set(cid, mode === 'night' ? 'night' : 'day');
  _renderChart();
}
function _focusHexEntry(cid) {
  const sel = (window.CSS && CSS.escape) ? CSS.escape(cid) : cid;
  const inp = _root && _root.querySelector(`.kb-color-card[data-cid="${sel}"] .kb-hexentry-input`);
  if (inp) inp.focus();
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
  const hasColor = palette.some(c => _visHexOk(c.hex));   // harmonies/contraste : dès qu'une couleur est remplie
  return `
    <div class="kb-colors">
      <div class="kb-colors-head">
        <button class="kb-addpill" data-act="color-add" title="Ajouter une couleur" aria-label="Ajouter une couleur">${icon('plus', 18)}</button>
      </div>
      <div class="kb-colors-grid">${cards}</div>
      ${hasColor ? _renderHarmonyStudio(palette) : ''}
      ${hasColor ? _renderContrastLab(palette) : ''}
    </div>`;
}

function _renderColorCard(c) {
  const rolesSel = COLOR_ROLES.map(([k, lbl]) => `<option value="${k}" ${c.role === k ? 'selected' : ''}>${lbl}</option>`).join('');
  const acts = `
    <div class="kb-color-acts">
      <button class="kb-iconbtn ${_colorAdv === c.id ? 'on' : ''}" data-act="c-adv" title="Histoire de la couleur">${icon('more-horizontal', 16)}</button>
      <button class="kb-iconbtn danger" data-act="c-del" title="Retirer">${icon('trash-2', 16)}</button>
    </div>`;

  // ── Carte VIDE : rien de pré-rempli, l'utilisateur saisit son code ──
  if (!_visHexOk(c.hex)) {
    const ghosts = TONAL_STEPS.map(() => '<span class="kb-tone is-ghost"></span>').join('');
    const nums = TONAL_STEPS.map(s => `<span class="kb-tone-num">${s}</span>`).join('');
    // Primaire = saisie du code hexadécimal (le client a déjà sa charte) ;
    // la roue chromatique n'est qu'un recours secondaire.
    const swatch = _colorPick === c.id ? `
      <div class="kb-swatch is-choose is-picking">
        <div class="kb-hexentry">
          <span class="kb-hexentry-hash">#</span>
          <input class="kb-hexentry-input" data-field="c-hexcode" value="" placeholder="3B5BDB" maxlength="7"
                 spellcheck="false" autocomplete="off" autocapitalize="characters" inputmode="text" aria-label="Code couleur hexadécimal">
          <label class="kb-hexentry-wheel" title="Sinon, choisir visuellement" aria-label="Choisir visuellement">
            ${icon('palette', 15)}<input type="color" class="kb-hexentry-pick" data-field="c-hex" value="#3b5bdb">
          </label>
        </div>
        <p class="kb-hexentry-hint">Tapez ou collez le code de votre charte — la roue reste dispo au besoin.</p>
      </div>` : `
      <button class="kb-swatch is-choose" data-act="c-pick" title="Saisir le code couleur">
        <span class="kb-swatch-hex">${icon('edit', 15)} Choisir la couleur</span>
      </button>`;
    return `
      <article class="kb-color-card is-empty" data-cid="${_esc(c.id)}">
        <div class="kb-cc-edit">
          ${swatch}
          <div class="kb-color-fields">
            <div class="kb-color-row">
              <input class="kb-field-input kb-v-label" data-field="c-name" value="${_esc(c.name || '')}" placeholder="Nom de la couleur" maxlength="40" spellcheck="false">
              <select class="kb-select kb-color-role" data-field="c-role" aria-label="Rôle">${rolesSel}</select>
            </div>
            <p class="kb-hint">Choisissez la couleur pour révéler ses codes et ses déclinaisons.</p>
          </div>
          ${acts}
        </div>
        <div class="kb-cc-scale is-ghost" aria-hidden="true">
          <div class="kb-tone-band">${ghosts}</div>
          <div class="kb-tone-nums">${nums}</div>
        </div>
      </article>`;
  }

  const mode  = _cardMode(c.id);
  const shown = _shownHex(c);
  const rgb   = hexToRgb(shown) || { r: 0, g: 0, b: 0 };
  const cmyk  = rgbToCmyk(rgb);                 // codes = teinte du mode affiché
  const cmykStr = `${cmyk.c} ${cmyk.m} ${cmyk.y} ${cmyk.k}`;
  const field = mode === 'night' ? 'c-night' : 'c-hex';  // le picker édite la teinte du mode courant

  const adv = _colorAdv === c.id ? `
    <div class="kb-color-adv">
      <label class="kb-field-label">L'histoire <input class="kb-field-input kb-inline" data-field="c-story" value="${_esc(c.story || '')}" placeholder="d'où vient cette couleur, en une ligne" maxlength="160"></label>
      ${mode === 'night'
        ? `<p class="kb-hint">Teinte nuit ${c.nightHex ? 'personnalisée' : 'calculée automatiquement'}.${c.nightHex ? ' <button class="kb-linkbtn" data-act="c-night-auto">Recalculer automatiquement</button>' : ' Utilisez la pipette pour l\'ajuster.'}</p>`
        : ''}
    </div>` : '';

  // ── Panneau gauche : édition + codes ──
  const editPanel = `
    <div class="kb-cc-edit">
      <button class="kb-swatch" data-act="copy" data-copy="${_esc(shown)}" style="background:${_esc(shown)};color:${_inkOn(shown)}" title="Copier ${_esc(shown)}">
        <span class="kb-swatch-hex">${_esc(shown)}</span>
        <label class="kb-swatch-pick" title="Modifier la couleur" aria-label="Modifier la couleur">
          ${icon('edit', 14)}<input type="color" data-field="${field}" value="${_esc(shown)}">
        </label>
      </button>
      <div class="kb-color-fields">
        <div class="kb-color-row">
          <input class="kb-field-input kb-v-label" data-field="c-name" value="${_esc(c.name || '')}" placeholder="Nom de la couleur" maxlength="40" spellcheck="false">
          <select class="kb-select kb-color-role" data-field="c-role" aria-label="Rôle">${rolesSel}</select>
          <div class="kb-daynight" role="group" aria-label="Teinte jour ou nuit">
            <button class="kb-dn ${mode === 'day' ? 'on' : ''}" data-act="c-mode" data-mode="day" title="Teinte jour (fond clair)" aria-pressed="${mode === 'day'}">${icon('sun', 15)}</button>
            <button class="kb-dn ${mode === 'night' ? 'on' : ''}" data-act="c-mode" data-mode="night" title="Teinte nuit (fond sombre), calculée automatiquement" aria-pressed="${mode === 'night'}">${icon('moon', 14)}</button>
          </div>
        </div>
        <div class="kb-color-codes">
          <button class="kb-code" data-act="copy" data-copy="${_esc(shown)}"><span>HEX</span> <strong>${_esc(shown)}</strong></button>
          <button class="kb-code" data-act="copy" data-copy="${rgb.r} ${rgb.g} ${rgb.b}"><span>RVB</span> <strong>${rgb.r} ${rgb.g} ${rgb.b}</strong></button>
          <button class="kb-code" data-act="copy" data-copy="${cmykStr}" title="Indicatif — sans profil ICC"><span>CMJN</span> <strong>${cmykStr}</strong></button>
        </div>
        <label class="kb-pantone"><span>Pantone</span><input class="kb-field-input kb-inline" data-field="c-pantone" value="${_esc(c.pantone || '')}" placeholder="ex. 2736 C" maxlength="30"></label>
        ${adv}
      </div>
      ${acts}
    </div>`;

  // ── Panneau droit : déclinaisons 100→900 (copie au clic) ──
  const scale = tonalScale(shown) || {};
  const band = TONAL_STEPS.map(step =>
    `<button class="kb-tone ${step === 500 ? 'is-base' : ''}" data-act="copy" data-copy="${_esc(scale[step])}" style="background:${_esc(scale[step])}" title="Copier ${_esc(scale[step])} (${step})" aria-label="Copier ${_esc(scale[step])} palier ${step}"></button>`).join('');
  const nums = TONAL_STEPS.map(step =>
    `<span class="kb-tone-num ${step === 500 ? 'is-base' : ''}">${step}</span>`).join('');
  // Barre de dégradé continue (mêmes teintes que la bande), 500 = milieu → ligne guide centrée.
  const gradStops = TONAL_STEPS.map((step, i) => `${scale[step]} ${(i / (TONAL_STEPS.length - 1) * 100).toFixed(2)}%`).join(', ');
  const scalePanel = `
    <div class="kb-cc-scale" aria-label="Déclinaisons de la couleur">
      <div class="kb-tone-band">${band}</div>
      <div class="kb-tone-nums">${nums}</div>
      <div class="kb-tone-plot">
        <span class="kb-tone-guide" aria-hidden="true"></span>
        <div class="kb-tone-gradient" style="background:linear-gradient(90deg, ${gradStops})" aria-hidden="true"></div>
      </div>
    </div>`;

  return `
    <article class="kb-color-card" data-cid="${_esc(c.id)}">
      ${editPanel}
      ${scalePanel}
    </article>`;
}

// Rafraîchissement live d'une carte pendant l'usage de la pipette (sans re-render).
function _refreshColorCard(card, c) {
  if (!card) return;
  const shown = _shownHex(c);
  const rgb = hexToRgb(shown); if (!rgb) return;
  const cmyk = rgbToCmyk(rgb);
  const sw = card.querySelector('.kb-swatch');
  if (sw) { sw.style.background = shown; sw.style.color = _inkOn(shown); sw.dataset.copy = shown; sw.title = `Copier ${shown}`; }
  const hexEl = card.querySelector('.kb-swatch-hex'); if (hexEl) hexEl.textContent = shown;
  const codes = card.querySelectorAll('.kb-code');
  const setCode = (btn, val) => { if (btn) { btn.dataset.copy = val; const s = btn.querySelector('strong'); if (s) s.textContent = val; } };
  setCode(codes[0], shown);
  setCode(codes[1], `${rgb.r} ${rgb.g} ${rgb.b}`);
  setCode(codes[2], `${cmyk.c} ${cmyk.m} ${cmyk.y} ${cmyk.k}`);
  const scale = tonalScale(shown) || {};
  const tones = card.querySelectorAll('.kb-tone');
  TONAL_STEPS.forEach((step, i) => {
    const t = tones[i]; if (!t) return;
    t.style.background = scale[step]; t.dataset.copy = scale[step]; t.title = `Copier ${scale[step]} (${step})`;
  });
  if (c.role === 'primary' && _cardMode(c.id) === 'day') _applyAccent(c.hex);
}

// ── Atelier des déclinaisons (proposées, jamais imposées) ──
function _renderHarmonyStudio(palette) {
  const base = palette.find(c => c.role === 'primary' && _visHexOk(c.hex)) || palette.find(c => _visHexOk(c.hex));
  if (!base) return '';
  const h = harmonies(base.hex);
  if (!h) return '';
  const inPalette = new Set(palette.map(c => (c.hex || '').toLowerCase()));
  // On saute « Nuances » : ce clair→profond fait doublon avec l'échelle
  // 100→900 déjà présente dans la carte. Ici, uniquement des couleurs ASSORTIES.
  const rows = Object.entries(h).filter(([key]) => key !== 'nuances').map(([key, hexes]) => {
    const [title, sub] = HARMONY_LABELS[key] || [key, ''];
    const chips = hexes.map(hex => {
      const taken = inPalette.has(hex.toLowerCase());
      return `
        <button class="kb-harmony-chip ${taken ? 'is-taken' : ''}" data-act="harmony-add"
                data-hex="${_esc(hex)}" data-name="${_esc(title)}"
                title="${taken ? 'Déjà dans la palette' : `Ajouter ${_esc(hex)} à la palette`}" ${taken ? 'disabled' : ''}>
          <span class="kb-harmony-sw" style="background:${_esc(hex)};color:${_inkOn(hex)}">${taken ? icon('check', 16) : icon('plus', 16)}</span>
          <span class="kb-harmony-hex">${_esc(hex)}</span>
        </button>`;
    }).join('');
    return `
      <div class="kb-harmony-row">
        <div class="kb-harmony-label"><strong>${title}</strong><span>${sub}</span></div>
        <div class="kb-harmony-chips">${chips}</div>
      </div>`;
  }).join('');
  return `
    <section class="kb-lab kb-harmonylab">
      <h3 class="kb-lab-title">Harmonies depuis « ${_esc(base.name || base.hex)} »</h3>
      <p class="kb-hint">Des couleurs assorties calculées par théorie des couleurs, recalculées à chaque changement — un clic les ajoute, rien n'est imposé.</p>
      ${rows}
    </section>`;
}

// ── Test de visibilité (contraste WCAG + daltonisme) ──────────────
function _visHexOk(h) { return /^#[0-9a-fA-F]{6}$/.test(h || ''); }
// Lit un hex depuis un champ (pipette = toujours valide ; texte = tolérant :
// on garde la valeur courante tant que la saisie n'est pas un hex complet).
function _visReadHex(el, current) {
  if (el.type === 'color') return el.value.toLowerCase();
  const h = el.value.trim().replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
  return h.length === 6 ? `#${h.toLowerCase()}` : current;
}

// Étoiles pleines/vides (0→5) ; taille réduite pour les sous-notes.
function _visStars(n, total = 5, size = 15) {
  let s = '';
  for (let i = 1; i <= total; i++) s += `<span class="kb-star ${i <= n ? 'on' : ''}">${icon(i <= n ? 'star-fill' : 'star', size)}</span>`;
  return s;
}

// Encart verdict (grande note + étoiles + sous-notes petit/grand texte).
function _visScoreHTML(ratio, rating) {
  const tone = rating.stars >= 3 ? 'good' : rating.stars >= 2 ? 'warn' : 'bad';
  return `
    <div class="kb-vis-score is-${tone}">
      <div class="kb-vis-score-top">
        <strong class="kb-vis-ratio">${ratio.toFixed(2)}</strong>
        <div class="kb-vis-verdict"><span class="kb-vis-label">${rating.label}</span><div class="kb-stars">${_visStars(rating.stars)}</div></div>
      </div>
      <div class="kb-vis-score-grid">
        <div class="kb-vis-sub"><span>Petit texte</span><div class="kb-stars sm">${_visStars(rating.small, 3, 13)}</div></div>
        <div class="kb-vis-sub"><span>Grand texte</span><div class="kb-stars sm">${_visStars(rating.large, 3, 13)}</div></div>
      </div>
    </div>`;
}

// Phrase d'explication + lien « Améliorer » quand le contraste est perfectible.
function _visNoteHTML(rating) {
  const msg = rating.small >= 2
    ? 'Bon contraste pour le texte courant et les grands titres.'
    : rating.large >= 2
      ? 'Contraste suffisant pour les grands titres seulement — à éviter en petit texte.'
      : 'Contraste insuffisant : ce couple de couleurs est difficile à lire.';
  const enhance = rating.stars < 3 ? ' <button class="kb-linkbtn" data-act="vis-enhance">Améliorer</button>' : '';
  return `${msg}${enhance}`;
}

// Bandeau daltonisme (différenciateur Key Brand — conservé sous l'encart).
function _visCbHTML(txt, bg) {
  return ['protanopia', 'deuteranopia', 'tritanopia'].map(type => {
    const st = simulateColorBlind(txt, type), sb = simulateColorBlind(bg, type);
    const lbl = { protanopia: 'Protanopie', deuteranopia: 'Deutéranopie', tritanopia: 'Tritanopie' }[type];
    const r = contrastRatio(st, sb) || 1;
    return `
      <figure class="kb-cb-sample" title="${lbl} — contraste ${r.toFixed(1)}:1">
        <div class="kb-cb-box" style="background:${sb};color:${st}">Aa</div>
        <figcaption>${lbl}</figcaption>
      </figure>`;
  }).join('');
}

// Aperçu vivant (fond = couleur de fond, texte = couleur de texte).
function _visPreviewHTML(txt, bg) {
  return `
    <button class="kb-vis-zoom" data-act="vis-big" title="${_visBig ? 'Réduire' : 'Agrandir'} l'aperçu" aria-label="Agrandir l'aperçu">${icon('maximize', 16)}</button>
    <h4 class="kb-vis-ptitle">Le mot juste</h4>
    <p class="kb-vis-ptext">La clarté doit toujours guider les choix de design : elle transforme la complexité en évidence.</p>`;
}

function _renderContrastLab(palette) {
  const primary = palette.find(c => c.role === 'primary' && _visHexOk(c.hex)) || palette.find(c => _visHexOk(c.hex));
  if (!primary) return '';
  if (!_visHexOk(_visText)) _visText = primary.hex;
  if (!_visHexOk(_visBg))   _visBg = '#ffffff';
  const txt = _visText, bg = _visBg;
  const ratio = contrastRatio(txt, bg) || 1;
  const rating = contrastRating(ratio);

  const hexField = (label, hex, fText, fPick) => `
    <label class="kb-vis-field">
      <span class="kb-vis-flabel">${label}</span>
      <div class="kb-hexinput">
        <input class="kb-field-input" data-field="${fText}" value="${_esc(hex)}" maxlength="7" spellcheck="false" autocapitalize="off" aria-label="${label}">
        <label class="kb-hexswatch" style="background:${_esc(hex)}" title="Choisir la couleur">
          <input type="color" data-field="${fPick}" value="${_esc(hex)}">
        </label>
      </div>
    </label>`;

  return `
    <section class="kb-lab kb-vislab ${_visBig ? 'is-big' : ''}">
      <h3 class="kb-lab-title">Test de visibilité</h3>
      <div class="kb-vis">
        <div class="kb-vis-controls">
          <div class="kb-vis-fields">
            ${hexField('Couleur du texte', txt, 'vis-text', 'vis-text-pick')}
            ${hexField('Couleur du fond',  bg,  'vis-bg',   'vis-bg-pick')}
          </div>
          <span class="kb-vis-clabel">Contraste</span>
          <div class="kb-vis-scorewrap">${_visScoreHTML(ratio, rating)}</div>
          <p class="kb-vis-note kb-hint">${_visNoteHTML(rating)}</p>
          <div class="kb-cb-row">${_visCbHTML(txt, bg)}</div>
        </div>
        <div class="kb-vis-preview" style="background:${_esc(bg)};color:${_esc(txt)}">${_visPreviewHTML(txt, bg)}</div>
      </div>
    </section>`;
}

// Rafraîchissement surgical du test de visibilité (préserve le focus des champs).
function _refreshVisLab() {
  const lab = _root && _root.querySelector('.kb-vislab');
  if (!lab) return;
  const txt = _visHexOk(_visText) ? _visText : '#000000';
  const bg  = _visHexOk(_visBg) ? _visBg : '#ffffff';
  const ratio = contrastRatio(txt, bg) || 1;
  const rating = contrastRating(ratio);
  // Pastilles à côté des champs + valeur du color-picker (pas le champ texte).
  const paint = (field, hex) => {
    const inp = lab.querySelector(`[data-field="${field}"]`);
    if (inp) { const sw = inp.closest('.kb-hexswatch'); if (sw) sw.style.background = hex; inp.value = hex; }
  };
  paint('vis-text-pick', txt); paint('vis-bg-pick', bg);
  const scorewrap = lab.querySelector('.kb-vis-scorewrap'); if (scorewrap) scorewrap.innerHTML = _visScoreHTML(ratio, rating);
  const note = lab.querySelector('.kb-vis-note'); if (note) note.innerHTML = _visNoteHTML(rating);
  const cb = lab.querySelector('.kb-cb-row'); if (cb) cb.innerHTML = _visCbHTML(txt, bg);
  const prev = lab.querySelector('.kb-vis-preview'); if (prev) { prev.style.background = bg; prev.style.color = txt; }
}

// Recalcule et remplace la section « Harmonies » en direct (pendant l'édition
// de la couleur, sans attendre le 'change' du sélecteur — préserve le focus).
function _refreshHarmony() {
  if (!_root) return;
  const sec = _root.querySelector('.kb-harmonylab');
  const html = _renderHarmonyStudio(_paletteOf());
  if (!sec || !html) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const fresh = tpl.content.firstElementChild;
  if (fresh) sec.replaceWith(fresh);
}

// Ajuste la couleur de texte pour atteindre AA sur le fond courant.
function _enhanceVis() {
  const better = enhanceInk(_visText, _visBg);
  if (better && better.toLowerCase() !== String(_visText).toLowerCase()) {
    _visText = better; _renderChart(); _toast('Couleur de texte ajustée');
  } else {
    _toast('Impossible d\'améliorer davantage');
  }
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

// Graisses disponibles pour une police (Google = axe réel ; déclarée = 400/700).
function _weightsFor(f) { return f.source === 'google' ? weightsOf(f.axis) : [400, 700]; }
// Réglages de spécimen PERSISTÉS dans la charte (f.spec), initialisés à des
// valeurs sûres selon les graisses réellement disponibles.
function _specOf(f) {
  if (!f.spec || typeof f.spec !== 'object' || !f.spec.title || !f.spec.body) {
    const ws = _weightsFor(f);
    const heavy = ws.includes(700) ? 700 : ws[ws.length - 1];
    const reg = ws.includes(400) ? 400 : ws[0];
    f.spec = {
      title: { w: heavy, size: 34, ital: false, lh: 1.15, align: 'left' },
      body:  { w: reg,   size: 17, ital: false, lh: 1.5,  align: 'left' },
    };
  }
  return f.spec;
}
function _activeLevel(fid) { return _typeActive.get(fid) === 'body' ? 'body' : 'title'; }
// Applique une modif au niveau actif d'une police puis persiste + re-render.
function _editSpec(fid, patch) {
  const f = _fontOf(fid); if (!f) return;
  const sp = _specOf(f);
  Object.assign(sp[_activeLevel(fid)], patch);
  _scheduleSave(); _renderChart();
}
// Pile font-family : Google chargée, ou déclarée (rendue si installée localement).
function _famCss(f) {
  return (f.family)
    ? `'${String(f.family).replace(/'/g, '')}', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
    : `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
}
const _WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black', 1000: 'Black' };
function _weightName(w) { return `${w} ${_WEIGHT_NAMES[w] || ''}`.trim(); }
function _alignLabel(a) { return { left: 'Gauche', center: 'Centré', right: 'Droite', justify: 'Justifié' }[a] || a; }

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
  _typeActive.delete(fid);
  _scheduleSave(); _renderChart();
}

function _renderTypeTab() {
  const fonts = _fontsOf();
  // Charger les familles présentes (idempotent) + les italiques si demandées.
  for (const f of fonts) {
    if (f.source !== 'google' || !f.family) continue;
    ensureFontLoaded(f.family, f.axis);
    const sp = _specOf(f);
    if (sp.title.ital || sp.body.ital) ensureFontItalic(f.family, f.axis);
  }

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
        <div class="kb-type-row">
          <input class="kb-field-input kb-type-title" data-field="type-title" value="${_esc(_typeTitle)}"
                 placeholder="Votre titre d'essai…" maxlength="120" aria-label="Titre d'essai" spellcheck="false">
          <div class="kb-type-row-acts">
            <button class="kb-btn kb-btn-sm kb-lorem-btn" data-act="type-lorem" title="Remplir avec du faux-texte (lorem ipsum)">Lorem</button>
            <button class="kb-iconbtn" data-act="type-gen" title="Autres phrases d'essai (français)">${icon('refresh', 15)}</button>
          </div>
        </div>
        <div class="kb-type-row">
          <textarea class="kb-field-input kb-type-para" data-field="type-body" rows="3"
                    placeholder="Votre paragraphe d'essai…" maxlength="700" aria-label="Paragraphe d'essai" spellcheck="false">${_esc(_typeBody)}</textarea>
          <button class="kb-addpill ${_typePicker ? 'is-on' : ''}" data-act="font-picker" title="Ajouter une police" aria-label="Ajouter une police">${icon('plus', 18)}</button>
        </div>
      </div>
      ${_typePicker ? _renderFontPicker() : ''}
      <div class="kb-type-list">${cards}</div>
    </div>`;
}

// Barre d'outils UNIQUE en haut de la carte : un sélecteur Titre/Paragraphe
// choisit le niveau édité ; graisse, italique, taille (−/px/+), interligne,
// alignement s'appliquent à ce niveau. Réglages persistés (f.spec).
function _specToolbar(f) {
  const sp = _specOf(f);
  const lvl = _activeLevel(f.id);
  const s = sp[lvl];
  const ws = _weightsFor(f);
  const wOpts = ws.map(x => `<option value="${x}" ${x === s.w ? 'selected' : ''}>${_weightName(x)}</option>`).join('');
  const lhOpts = [1, 1.15, 1.35, 1.5, 1.7, 2].map(v => `<option value="${v}" ${Math.abs(v - s.lh) < 0.001 ? 'selected' : ''}>${v.toFixed(2)}</option>`).join('');
  return `
    <div class="kb-spec-toolbar">
      <div class="kb-level-switch" role="group" aria-label="Niveau édité">
        <button class="kb-levelbtn ${lvl === 'title' ? 'on' : ''}" data-act="ft-level" data-level="title">Titre</button>
        <button class="kb-levelbtn ${lvl === 'body' ? 'on' : ''}" data-act="ft-level" data-level="body">Paragraphe</button>
      </div>
      <span class="kb-tbsep" aria-hidden="true"></span>
      <select class="kb-select kb-inline-sm kb-spec-w" data-field="ftw" title="Graisse" aria-label="Graisse">${wOpts}</select>
      <button class="kb-segbtn kb-ital ${s.ital ? 'on' : ''}" data-act="ft-ital" title="Italique" aria-label="Italique"><em>I</em></button>
      <span class="kb-stepper">
        <button class="kb-step" data-act="ft-sz" data-d="-1" title="Réduire" aria-label="Réduire">${icon('minus', 14)}</button>
        <span class="kb-step-val">${s.size} px</span>
        <button class="kb-step" data-act="ft-sz" data-d="1" title="Agrandir" aria-label="Agrandir">${icon('plus', 14)}</button>
      </span>
      <label class="kb-spec-lh" title="Interligne" aria-label="Interligne">${icon('line-height', 15)}
        <select class="kb-select kb-inline-sm" data-field="fbl">${lhOpts}</select>
      </label>
      <span class="kb-seg" role="group" aria-label="Alignement">
        ${['left', 'center', 'right', 'justify'].map(a =>
          `<button class="kb-segbtn ${s.align === a ? 'on' : ''}" data-act="ft-align" data-a="${a}" title="${_alignLabel(a)}" aria-label="${_alignLabel(a)}">${icon('align-' + a, 15)}</button>`).join('')}
      </span>
    </div>`;
}

function _renderFontCard(f) {
  const famCss = _famCss(f);
  const roleOpts = FONT_ROLES.map(([k, lbl]) => `<option value="${k}" ${f.role === k ? 'selected' : ''}>${lbl}</option>`).join('');

  const head = f.source === 'google' ? `
      <div class="kb-font-id">
        <strong class="kb-font-name" style="font-family:${famCss}">${_esc(f.family)}</strong>
        <span class="kb-font-src">Google Fonts — licence libre</span>
      </div>` : `
      <div class="kb-font-id kb-font-id-declared">
        <input class="kb-field-input kb-v-label" data-field="f-family" value="${_esc(f.family)}" placeholder="Nom exact de la police (ex. Söhne)" maxlength="60" spellcheck="false">
        <input class="kb-field-input" data-field="f-buy" value="${_esc(f.buyUrl || '')}" placeholder="Lien de téléchargement ou d'achat (https://…)" maxlength="200" spellcheck="false">
      </div>`;

  const dl = f.source === 'google'
    ? `<a class="kb-btn kb-btn-sm" href="${fontSpecimenUrl(f.family)}" target="_blank" rel="noopener noreferrer" title="Page officielle : téléchargement + licence">${icon('download', 14)} Télécharger</a>`
    : (f.buyUrl && /^https?:\/\//.test(f.buyUrl)
        ? `<a class="kb-btn kb-btn-sm" href="${_esc(f.buyUrl)}" target="_blank" rel="noopener noreferrer" title="Récupérer la police">${icon('download', 14)} Obtenir</a>` : '');

  const sp = _specOf(f);
  const lvl = _activeLevel(f.id);
  const tStyle = `font-family:${famCss};font-weight:${sp.title.w};font-size:${sp.title.size}px;font-style:${sp.title.ital ? 'italic' : 'normal'};line-height:${sp.title.lh};text-align:${sp.title.align}`;
  const bStyle = `font-family:${famCss};font-weight:${sp.body.w};font-size:${sp.body.size}px;font-style:${sp.body.ital ? 'italic' : 'normal'};line-height:${sp.body.lh};text-align:${sp.body.align}`;

  return `
    <article class="kb-font-card" data-fid="${_esc(f.id)}">
      <div class="kb-font-head">
        ${head}
        <div class="kb-font-head-acts">
          <label class="kb-font-rolepick" title="Usage prévu — repris sur la charte publiée">
            <span class="kb-font-rolelbl">Rôle</span>
            <select class="kb-select kb-font-role" data-field="f-role" aria-label="Rôle">${roleOpts}</select>
          </label>
          ${dl}
          <button class="kb-iconbtn danger" data-act="f-del" title="Retirer">${icon('trash-2', 16)}</button>
        </div>
      </div>
      <p class="kb-font-rolehint">${icon('info', 13)} ${_esc(FONT_ROLE_HINTS[f.role] || '')}</p>
      ${_specToolbar(f)}
      <div class="kb-spec-preview">
        <div class="kb-spec-text kb-spec-title ${lvl === 'title' ? 'is-active' : ''}" data-slot="spec-title" style="${tStyle}">${_esc(_typeTitle)}</div>
        <div class="kb-spec-text kb-spec-body ${lvl === 'body' ? 'is-active' : ''}" data-slot="spec-body" style="${bStyle}">${_esc(_typeBody)}</div>
      </div>
      ${f.source === 'declared' ? `<p class="kb-hint kb-spec-note">Aperçu réel si la police est installée sur cet appareil, sinon repli système. Le lien permet de la récupérer.</p>` : ''}
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
// Texte titre/paragraphe live sans re-render (les champs gardent le focus ;
// graisse/taille/italique passent par un re-render côté handlers).
function _refreshSpecimens() {
  if (!_root) return;
  _root.querySelectorAll('.kb-font-card').forEach(card => {
    const t = card.querySelector('[data-slot="spec-title"]');
    const b = card.querySelector('[data-slot="spec-body"]');
    if (t) t.textContent = _typeTitle;
    if (b) b.textContent = _typeBody;
  });
}

// ════════════════════════════════════════════════════════════════
// ONGLET RÈGLES (KB-4) — les interdits qui s'auto-génèrent
// ════════════════════════════════════════════════════════════════
function _rulesSection() {
  if (!_chart.draft.rules || typeof _chart.draft.rules !== 'object') {
    _chart.draft.rules = { interdits: [], custom: [] };
  }
  if (!Array.isArray(_chart.draft.rules.interdits)) _chart.draft.rules.interdits = [];
  if (!Array.isArray(_chart.draft.rules.custom)) _chart.draft.rules.custom = [];
  return _chart.draft.rules;
}
// Les toggles persistés : au premier passage avec un logo, tout est activé.
function _interditState() {
  const rules = _rulesSection();
  if (!rules.interdits.length) {
    rules.interdits = INTERDITS_DEFS.map(([key]) => ({ key, enabled: true }));
    _scheduleSave();
  }
  const map = new Map(rules.interdits.map(r => [r.key, r]));
  // Nouveaux interdits ajoutés dans une future version : activés par défaut.
  for (const [key] of INTERDITS_DEFS) {
    if (!map.has(key)) { const r = { key, enabled: true }; rules.interdits.push(r); map.set(key, r); }
  }
  return map;
}
function _toggleInterdit(key) {
  const map = _interditState();
  const r = map.get(key);
  if (!r) return;
  r.enabled = !r.enabled;
  _scheduleSave(); _renderChart();
}
function _addCustomRule() {
  _rulesSection().custom.push({
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    label: '', assetId: null, kind: 'bad',   // 'bad' = interdit (croix rouge) · 'good' = bon usage (vert)
  });
  _scheduleSave(); _renderChart();
  const inputs = _root.querySelectorAll('[data-field="rc-label"]');
  inputs[inputs.length - 1]?.focus();
}
// Bascule une règle custom entre interdit (croix rouge) et bon usage (vert, sans croix).
function _toggleRuleKind(rid) {
  const r = _rulesSection().custom.find(x => x.id === rid);
  if (!r) return;
  r.kind = (r.kind === 'good') ? 'bad' : 'good';
  _scheduleSave(); _renderChart();
}
function _deleteCustomRule(rid) {
  const rules = _rulesSection();
  const r = rules.custom.find(x => x.id === rid);
  if (r && r.assetId) { _api(`/assets/${encodeURIComponent(r.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
  rules.custom = rules.custom.filter(x => x.id !== rid);
  _scheduleSave(); _renderChart();
}
async function _onRuleImagePicked(file, rid) {
  const rules = _rulesSection();
  const r = rules.custom.find(x => x.id === rid);
  if (!r || !file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) { _toast('Image attendue (PNG, JPG, WebP ou SVG).'); return; }
  if (file.size > KB_UPLOAD_MAX) { _toast('Image trop lourde (max 4 Mo).'); return; }
  if (ext === 'svg' && !svgLooksSafe(await file.text())) { _toast('SVG refusé (code actif ou référence externe).'); return; }
  try {
    const asset = await _apiUpload(_chart.id, file, 'image');
    if (r.assetId) { _api(`/assets/${encodeURIComponent(r.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
    r.assetId = asset.id;
    _scheduleSave(); _renderChart();
  } catch (e) { _toast(e.message); }
}

function _renderRulesTab() {
  const logoVariant = _chart ? _logoSection().variants.find(v => v.ext !== 'pdf') : null;

  if (!logoVariant) return `
    <div class="kb-ghost">
      <div class="kb-ghost-rules" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
      <h3>Les règles à respecter</h3>
      <p>Dès que votre logo est déposé, les interdits classiques se génèrent tout seuls avec VOTRE logo — déformation, mauvaise couleur, fond chargé…</p>
      <button class="kb-btn primary" data-act="goto-logo">${icon('image', 16)} Déposer d'abord un logo</button>
    </div>`;

  const map = _interditState();
  const assetAttr = `data-asset="${_esc(logoVariant.assetId)}"`;

  // Carte de référence : le bon usage, en tête.
  const good = `
    <figure class="kb-forbid-card kb-forbid-good">
      <div class="kb-forbid-box"><img ${assetAttr} alt="" draggable="false"></div>
      <figcaption>${icon('check', 13)} Le bon usage</figcaption>
    </figure>`;

  const cards = INTERDITS_DEFS.map(([key, label]) => {
    const enabled = map.get(key)?.enabled !== false;
    return `
      <figure class="kb-forbid-card ${enabled ? '' : 'is-off'}">
        <div class="kb-forbid-box kb-forbid-${key}">
          <img ${assetAttr} alt="" draggable="false">
          ${key === 'crowd' ? '<span class="kb-crowd-a"></span><span class="kb-crowd-b"></span>' : ''}
          <span class="kb-forbid-slash" aria-hidden="true"></span>
        </div>
        <figcaption>${icon('x', 13)} ${label}</figcaption>
        <button class="kb-forbid-toggle" data-act="rule-toggle" data-key="${key}"
                title="${enabled ? 'Masquer cet interdit de la charte' : 'Réactiver cet interdit'}"
                aria-pressed="${enabled}">${icon(enabled ? 'eye' : 'eye-off', 15)}</button>
      </figure>`;
  }).join('');

  const custom = _rulesSection().custom.map(r => {
    const isGood = r.kind === 'good';
    const box = r.assetId
      ? `<button class="kb-forbid-box kb-rule-box" data-act="rc-img" title="Remplacer le visuel">
           <img data-asset="${_esc(r.assetId)}" alt="" draggable="false">
           ${isGood ? '' : '<span class="kb-forbid-slash" aria-hidden="true"></span>'}
         </button>`
      : `<button class="kb-forbid-box kb-rule-box is-empty" data-act="rc-img" title="Importer un visuel">
           ${icon('image', 20)}<span>Importer un visuel</span>
         </button>`;
    return `
      <figure class="kb-forbid-card kb-rule-card ${isGood ? 'kb-forbid-good' : ''}" data-rid="${_esc(r.id)}">
        ${box}
        <figcaption>${icon(isGood ? 'check' : 'x', 13)}
          <input class="kb-rule-cap" data-field="rc-label" value="${_esc(r.label || '')}"
                 placeholder="Décrire la règle…" maxlength="160" spellcheck="false">
        </figcaption>
        <div class="kb-rule-tools">
          <button data-act="rc-kind" aria-pressed="${isGood}"
                  title="${isGood ? 'Basculer en interdit (croix rouge)' : 'Basculer en bon usage (vert)'}">${icon('refresh', 15)}</button>
          <button class="danger" data-act="rc-del" title="Retirer la règle">${icon('trash-2', 15)}</button>
        </div>
      </figure>`;
  }).join('');

  return `
    <div class="kb-rules">
      <p class="kb-hint">Générés automatiquement avec votre logo — l'œil masque un interdit qui ne concerne pas votre marque.</p>
      <div class="kb-forbid-grid">${good}${cards}</div>
      <section class="kb-lab">
        <h3 class="kb-lab-title">Règles propres à la marque</h3>
        <p class="kb-hint">Importez un visuel : la croix rouge est posée par la carte. Basculez en « bon usage » (vert, sans croix) pour montrer l'exemple à suivre.</p>
        ${custom ? `<div class="kb-forbid-grid kb-rule-grid">${custom}</div>` : ''}
        <button class="kb-btn" data-act="rule-custom-add">${icon('plus', 15)} Ajouter une règle</button>
      </section>
    </div>`;
}

// ════════════════════════════════════════════════════════════════
// ONGLET BRANDING (KB-5) — la scène
// ════════════════════════════════════════════════════════════════
function _brandSection() {
  if (!_chart.draft.branding || typeof _chart.draft.branding !== 'object') {
    _chart.draft.branding = { motion: 'none', symbolism: [], photo: null };
  }
  const b = _chart.draft.branding;
  if (!Array.isArray(b.symbolism)) b.symbolism = [];
  return b;
}
function _titleFontCss() {
  // Synergie KB-3 : la scène s'écrit dans la typo Titrage de la charte.
  const f = _fontsOf().find(x => x.role === 'title' && x.source === 'google' && x.family);
  if (!f) return null;
  ensureFontLoaded(f.family, f.axis);
  return `'${f.family.replace(/'/g, '')}', sans-serif`;
}

// ── KB-8 : la scène d'ouverture (fond, mise en scène, encre, tempo) ──
function _sceneOf() {
  const b = _brandSection();
  if (!b.scene || typeof b.scene !== 'object') b.scene = {};
  const s = b.scene;
  if (!SCENE_BG_TYPES.some(([k]) => k === s.bgType))  s.bgType = 'white';
  if (!SCENE_LAYOUTS.some(([k]) => k === s.layout))   s.layout = 'center';
  if (!SCENE_INKS.some(([k]) => k === s.ink))         s.ink = 'auto';
  if (!SCENE_DURS.some(([k]) => k === s.dur))         s.dur = 'normal';
  return s;
}
// Encre lisible sur le fond choisi. Auto : luminance de la couleur (ou
// claire sur photo/vidéo, avec voile de lisibilité). Jamais de gris moyen.
function _sceneInk(s) {
  let mode = s.ink;
  if (mode === 'auto') {
    if (s.bgType === 'image' || s.bgType === 'video') mode = 'light';
    else if ((s.bgType === 'color' || s.bgType === 'gradient') && s.c1) {
      const rgb = hexToRgb(s.c1);
      mode = rgb && relLuminance(rgb) < 0.45 ? 'light' : 'dark';
    } else mode = 'dark';
  }
  return mode === 'light'
    ? { name: '#ffffff', base: 'rgba(255,255,255,.78)', scrim: (s.bgType === 'image' || s.bgType === 'video') }
    : { name: '#15171c', base: '#5b6170', scrim: false };
}
function _sceneBgCss(s) {
  if (s.bgType === 'color'    && s.c1)         return `background:${s.c1}`;
  if (s.bgType === 'gradient' && s.c1 && s.c2) return `background:linear-gradient(135deg,${s.c1},${s.c2})`;
  return '';   // blanc par défaut ; photo/vidéo = élément média
}
function _setSceneProp(prop, v) {
  const s = _sceneOf();
  s[prop] = v;
  _scheduleSave(); _renderChart();
}
function _setSceneColor(n, hex) {
  const m = String(hex || '').match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return;
  _sceneOf()[n === '2' ? 'c2' : 'c1'] = '#' + m[1].toLowerCase();
  _scheduleSave(); _renderChart();
}
async function _onSceneMediaPicked(file) {
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isVideo = ['mp4', 'webm'].includes(ext);
  if (!isVideo && !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) { _toast('Photo (PNG, JPG, WebP) ou vidéo (MP4, WebM) attendue.'); return; }
  if (file.size > KB_UPLOAD_MAX) { _toast(isVideo ? 'Vidéo trop lourde (max 4 Mo) — exportez une boucle courte compressée.' : 'Image trop lourde (max 4 Mo).'); return; }
  try {
    const asset = await _apiUpload(_chart.id, file, 'image');
    const s = _sceneOf();
    if (s.assetId) { _api(`/assets/${encodeURIComponent(s.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
    s.assetId = asset.id;
    s.bgType = isVideo ? 'video' : 'image';   // le fichier réel fait foi
    _scheduleSave(); _renderChart();
  } catch (e) { _toast(e.message); }
}
function _deleteSceneMedia() {
  const s = _sceneOf();
  if (s.assetId) { _api(`/assets/${encodeURIComponent(s.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
  s.assetId = null;
  s.bgType = 'white';
  _scheduleSave(); _renderChart();
}

// ── KB-9 : planche d'ambiance (collage gabarits + médaillons ronds) ──
function _boardOf() {
  const b = _brandSection();
  if (!b.board || typeof b.board !== 'object') b.board = {};
  const bd = b.board;
  if (!BOARD_TPLS.some(([k]) => k === bd.template)) bd.template = 'atelier';
  if (typeof bd.title !== 'string') bd.title = '';
  if (typeof bd.text !== 'string')  bd.text = '';
  if (!bd.cells || typeof bd.cells !== 'object') bd.cells = {};
  return bd;
}
function _boardSlots() { return BOARD_TPLS.find(([k]) => k === _boardOf().template)[2]; }
async function _onBoardCellPicked(file, slot) {
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isVideo = ['mp4', 'webm'].includes(ext);
  if (!isVideo && !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) { _toast('Photo (PNG, JPG, WebP) ou vidéo (MP4, WebM) attendue.'); return; }
  if (file.size > KB_UPLOAD_MAX) { _toast(isVideo ? 'Vidéo trop lourde (max 4 Mo) — boucle courte compressée.' : 'Image trop lourde (max 4 Mo).'); return; }
  try {
    const asset = await _apiUpload(_chart.id, file, 'image');
    const cells = _boardOf().cells;
    const prev = cells[slot];
    if (prev?.assetId) { _api(`/assets/${encodeURIComponent(prev.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
    cells[slot] = { assetId: asset.id, video: isVideo, med: prev?.med || null };
    _scheduleSave(); _renderChart();
  } catch (e) { _toast(e.message); }
}
async function _onBoardMedPicked(file, slot) {
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) { _toast('Photo attendue pour le médaillon (PNG, JPG, WebP).'); return; }
  if (file.size > KB_UPLOAD_MAX) { _toast('Image trop lourde (max 4 Mo).'); return; }
  const cell = _boardOf().cells[slot];
  if (!cell?.assetId) return;
  try {
    const asset = await _apiUpload(_chart.id, file, 'image');
    if (cell.med?.assetId) { _api(`/assets/${encodeURIComponent(cell.med.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
    cell.med = { assetId: asset.id, x: 0.5, y: 0.5 };
    _scheduleSave(); _renderChart();
    _toast('Cliquez sur l\'image pour placer le médaillon.');
  } catch (e) { _toast(e.message); }
}
function _deleteBoardCell(slot) {
  const cells = _boardOf().cells;
  const c = cells[slot];
  if (!c) return;
  if (c.assetId)      { _api(`/assets/${encodeURIComponent(c.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
  if (c.med?.assetId) { _api(`/assets/${encodeURIComponent(c.med.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
  delete cells[slot];
  _scheduleSave(); _renderChart();
}
function _deleteBoardMed(slot) {
  const c = _boardOf().cells[slot];
  if (!c?.med) return;
  if (c.med.assetId) { _api(`/assets/${encodeURIComponent(c.med.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
  c.med = null;
  _scheduleSave(); _renderChart();
}
// ── KB-13 : identité de marque & ton de voix ──
function _identityOf() {
  if (!_chart.draft.identity || typeof _chart.draft.identity !== 'object') _chart.draft.identity = {};
  const idn = _chart.draft.identity;
  if (typeof idn.mission !== 'string') idn.mission = '';
  if (typeof idn.story !== 'string')   idn.story = '';
  if (!Array.isArray(idn.values))      idn.values = [];
  if (!idn.voice || typeof idn.voice !== 'object') idn.voice = {};
  const v = idn.voice;
  if (!VOICE_REGS.some(([k]) => k === v.reg)) v.reg = '';
  if (!Array.isArray(v.principles)) v.principles = [];
  if (typeof v.use !== 'string')     v.use = '';
  if (typeof v.avoid !== 'string')   v.avoid = '';
  if (typeof v.example !== 'string') v.example = '';
  return idn;
}

// ── KB-14 : iconographie ──
function _iconsOf() {
  if (!_chart.draft.icons || typeof _chart.draft.icons !== 'object') _chart.draft.icons = {};
  const ic = _chart.draft.icons;
  if (!ICON_STROKES.some(([k]) => k === ic.stroke))  ic.stroke = '';
  if (!ICON_CORNERS.some(([k]) => k === ic.corners)) ic.corners = '';
  if (!ICON_WEIGHTS.some(([k]) => k === ic.weight))  ic.weight = '';
  if (typeof ic.note !== 'string') ic.note = '';
  if (!Array.isArray(ic.assetIds)) ic.assetIds = [];
  return ic;
}
async function _onIconsPicked(files) {
  const ic = _iconsOf();
  for (const f of files) {
    if (ic.assetIds.length >= KB_ICONS_MAX) { _toast(`Maximum ${KB_ICONS_MAX} pictos.`); break; }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['svg', 'png', 'webp'].includes(ext)) { _toast(`« ${f.name} » : SVG, PNG ou WebP attendu.`); continue; }
    if (f.size > KB_UPLOAD_MAX) { _toast(`« ${f.name} » : trop lourd (max 4 Mo).`); continue; }
    if (ext === 'svg' && !svgLooksSafe(await f.text())) { _toast(`« ${f.name} » : SVG refusé (code actif).`); continue; }
    try {
      const asset = await _apiUpload(_chart.id, f, 'image');
      ic.assetIds.push(asset.id);
    } catch (e) { _toast(e.message); }
  }
  _scheduleSave(); _renderChart();
}
function _deleteIcon(aid) {
  const ic = _iconsOf();
  ic.assetIds = ic.assetIds.filter(x => x !== aid);
  _api(`/assets/${encodeURIComponent(aid)}`, { method: 'DELETE' }).catch(() => {});
  _scheduleSave(); _renderChart();
}

// ── KB-10 : calque de construction du logo (symbolique v2) ──
function _constructionOf() {
  const b = _brandSection();
  if (!b.construction || typeof b.construction !== 'object') b.construction = { assetId: null, opacity: 0.5 };
  const c = b.construction;
  if (typeof c.opacity !== 'number' || !(c.opacity >= 0.1 && c.opacity <= 1)) c.opacity = 0.5;
  return c;
}
async function _onConstructionPicked(file) {
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['svg', 'png', 'webp', 'jpg', 'jpeg'].includes(ext)) { _toast('Image attendue (SVG, PNG, WebP, JPG).'); return; }
  if (file.size > KB_UPLOAD_MAX) { _toast('Image trop lourde (max 4 Mo).'); return; }
  if (ext === 'svg' && !svgLooksSafe(await file.text())) { _toast('SVG refusé (code actif ou référence externe).'); return; }
  try {
    const asset = await _apiUpload(_chart.id, file, 'image');
    const c = _constructionOf();
    if (c.assetId) { _api(`/assets/${encodeURIComponent(c.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
    c.assetId = asset.id;
    _scheduleSave(); _renderChart();
  } catch (e) { _toast(e.message); }
}
function _deleteConstruction() {
  const c = _constructionOf();
  if (c.assetId) { _api(`/assets/${encodeURIComponent(c.assetId)}`, { method: 'DELETE' }).catch(() => {}); }
  c.assetId = null;
  _scheduleSave(); _renderChart();
}

// ── KB-11 : supports de communication (mockups auto-composés) ──
function _supportsOf() {
  if (!_chart.draft.supports || typeof _chart.draft.supports !== 'object') _chart.draft.supports = {};
  const s = _chart.draft.supports;
  if (!s.enabled || typeof s.enabled !== 'object') s.enabled = {};
  for (const [k] of SUPPORT_DEFS) if (typeof s.enabled[k] !== 'boolean') s.enabled[k] = true;
  if (typeof s.domain !== 'string') s.domain = '';
  if (!s.card || typeof s.card !== 'object') s.card = { name: '', role: '', tel: '', email: '' };
  if (!Array.isArray(s.gallery)) s.gallery = [];
  return s;
}
// Le kit de marque tel qu'il existe — les mockups ne montrent que ça.
function _brandKit() {
  const meta = _chart.draft.meta || {};
  const palette = _paletteOf().filter(c => c.hex);
  const primary = (palette.find(c => c.role === 'primary') || palette[0])?.hex || null;
  const second  = palette.map(c => c.hex).find(h => h !== primary) || null;
  const logo = _logoSection().variants.find(v => v.ext !== 'pdf') || null;
  return { name: meta.name || _chart.name, baseline: meta.baseline || '',
           primary, second, logo, titleFont: _titleFontCss() };
}
// Encre lisible sur une couleur de marque : _inkOn (déjà défini, onglet Couleurs).
function _slugDomain(name) {
  const base = String(name || 'marque').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'marque';
  return base + '.fr';
}
async function _onSupportShotPicked(file, kind) {
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) { _toast('Capture d\'écran attendue (PNG, JPG, WebP).'); return; }
  if (file.size > KB_UPLOAD_MAX) { _toast('Image trop lourde (max 4 Mo).'); return; }
  try {
    const asset = await _apiUpload(_chart.id, file, 'image');
    const s = _supportsOf();
    const key = kind === 'phone' ? 'phoneShotId' : 'webShotId';
    if (s[key]) { _api(`/assets/${encodeURIComponent(s[key])}`, { method: 'DELETE' }).catch(() => {}); }
    s[key] = asset.id;
    _scheduleSave(); _renderChart();
  } catch (e) { _toast(e.message); }
}
function _deleteSupportShot(kind) {
  const s = _supportsOf();
  const key = kind === 'phone' ? 'phoneShotId' : 'webShotId';
  if (s[key]) { _api(`/assets/${encodeURIComponent(s[key])}`, { method: 'DELETE' }).catch(() => {}); }
  s[key] = null;
  _scheduleSave(); _renderChart();
}
async function _onGalleryPicked(files) {
  const s = _supportsOf();
  for (const f of files) {
    if (s.gallery.length >= KB_GALLERY_MAX) { _toast(`Maximum ${KB_GALLERY_MAX} réalisations.`); break; }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) { _toast(`« ${f.name} » : photo attendue.`); continue; }
    if (f.size > KB_UPLOAD_MAX) { _toast(`« ${f.name} » : trop lourde (max 4 Mo).`); continue; }
    try {
      const asset = await _apiUpload(_chart.id, f, 'image');
      s.gallery.push(asset.id);
    } catch (e) { _toast(e.message); }
  }
  _scheduleSave(); _renderChart();
}
function _deleteGalleryItem(aid) {
  const s = _supportsOf();
  s.gallery = s.gallery.filter(x => x !== aid);
  _api(`/assets/${encodeURIComponent(aid)}`, { method: 'DELETE' }).catch(() => {});
  _scheduleSave(); _renderChart();
}

// Clic sur la photo d'une cellule → repositionne son médaillon (fractions x/y).
function _placeBoardMed(cellEl, e) {
  const slot = cellEl.dataset.cell;
  const c = _boardOf().cells[slot];
  if (!c?.med) return;
  const rect = cellEl.getBoundingClientRect();
  c.med.x = +Math.min(0.94, Math.max(0.06, (e.clientX - rect.left) / rect.width)).toFixed(3);
  c.med.y = +Math.min(0.92, Math.max(0.08, (e.clientY - rect.top) / rect.height)).toFixed(3);
  _scheduleSave(); _renderChart();
}

function _setMotion(key) {
  if (!MOTIONS.some(([k]) => k === key)) return;
  _brandSection().motion = key;
  _scheduleSave(); _renderChart();
}
function _replayMotion() {
  const stage = _root?.querySelector('[data-slot="stage-inner"]');
  if (!stage) return;
  const cls = [...stage.classList].find(c => c.startsWith('kb-play-'));
  if (!cls) return;
  stage.classList.remove(cls);
  void stage.offsetWidth;   // reflow → l'animation repart
  stage.classList.add(cls);
}

// ── Symbolique du signe ──
function _addSymbolAt(canvas, e) {
  const b = _brandSection();
  if (b.symbolism.length >= KB_SYM_MAX) { _toast(`Maximum ${KB_SYM_MAX} annotations.`); return; }
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width));
  const y = Math.min(0.98, Math.max(0.02, (e.clientY - rect.top) / rect.height));
  b.symbolism.push({ x: +x.toFixed(3), y: +y.toFixed(3), title: '', text: '' });
  _scheduleSave(); _renderChart();
  const inputs = _root.querySelectorAll('[data-field="sym-text"]');
  inputs[inputs.length - 1]?.focus();
}
function _deleteSymbol(idx) {
  const b = _brandSection();
  if (idx >= 0 && idx < b.symbolism.length) {
    b.symbolism.splice(idx, 1);
    _scheduleSave(); _renderChart();
  }
}

// ── Direction photo ──
async function _onPhotosPicked(files) {
  const b = _brandSection();
  b.photo = b.photo || { words: [], exampleAssetIds: [] };
  if (!Array.isArray(b.photo.exampleAssetIds)) b.photo.exampleAssetIds = [];
  for (const f of files) {
    if (b.photo.exampleAssetIds.length >= KB_PHOTO_MAX) { _toast(`Maximum ${KB_PHOTO_MAX} exemples — la direction photo n'est pas une photothèque.`); break; }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) { _toast(`« ${f.name} » : photo attendue (JPG, PNG, WebP).`); continue; }
    if (f.size > KB_UPLOAD_MAX) { _toast(`« ${f.name} » : trop lourde (max 4 Mo).`); continue; }
    try {
      const asset = await _apiUpload(_chart.id, f, 'image');
      b.photo.exampleAssetIds.push(asset.id);
    } catch (e) { _toast(e.message); }
  }
  _scheduleSave(); _renderChart();
}
function _deletePhoto(aid) {
  const b = _brandSection();
  if (!b.photo) return;
  b.photo.exampleAssetIds = (b.photo.exampleAssetIds || []).filter(x => x !== aid);
  _api(`/assets/${encodeURIComponent(aid)}`, { method: 'DELETE' }).catch(() => {});
  const url = _blobUrls.get(aid);
  if (url) { try { URL.revokeObjectURL(url); } catch (_) {} _blobUrls.delete(aid); }
  _scheduleSave(); _renderChart();
}

function _renderBrandTab() {
  const b = _brandSection();
  const logoVariant = _logoSection().variants.find(v => v.ext !== 'pdf');
  const meta = _chart.draft.meta || {};
  const titleFont = _titleFontCss();

  // ── La scène : page de garde vivante (KB-8 : fond, mise en scène, encre, tempo) ──
  const s = _sceneOf();
  const ink = _sceneInk(s);
  const bgCss = _sceneBgCss(s);
  const hasMedia = (s.bgType === 'image' || s.bgType === 'video') && s.assetId;
  const mo = SCENE_DURS.find(([k]) => k === s.dur)?.[2] ?? 1;
  const brandName = meta.name || _chart.name;
  // Motion « lettre à lettre » : chaque caractère anime avec son délai,
  // MAIS regroupé par mot insécable (.kb-w) — sinon le navigateur coupe
  // les mots entre deux lettres et le nom « saute » de ligne en ligne.
  let _li = 0;
  const nameHtml = b.motion === 'letters'
    ? brandName.split(' ').filter(w => w.length).map(w =>
        `<span class="kb-w">${[...w].map(ch => `<span class="kb-l" style="--i:${_li++}">${_esc(ch)}</span>`).join('')}</span>`
      ).join(' ')
    : _esc(brandName);
  const inked = s.bgType !== 'white';   // fond custom → encre pilotée

  const mediaEl = !hasMedia ? '' : (s.bgType === 'video'
    ? `<video class="kb-stage-media" data-asset="${_esc(s.assetId)}" muted loop autoplay playsinline></video>`
    : `<img class="kb-stage-media" data-asset="${_esc(s.assetId)}" alt="" draggable="false">`);

  const stageInner = `
      <div class="kb-stage-inner kb-play-${_esc(b.motion || 'none')} kb-lay-${_esc(s.layout)}" data-slot="stage-inner" style="--kb-mo:${mo}">
        ${logoVariant ? `<img class="kb-stage-logo" data-asset="${_esc(logoVariant.assetId)}" alt="" draggable="false">` : ''}
        ${s.layout === 'split' && logoVariant ? `<span class="kb-stage-vr" ${inked ? `style="background:${ink.base}"` : ''}></span>` : ''}
        <div class="kb-stage-txt">
          <div class="kb-stage-name" style="${titleFont ? `font-family:${titleFont};` : ''}${inked ? `color:${ink.name}` : ''}">${nameHtml}</div>
          ${meta.baseline ? `<div class="kb-stage-baseline" ${inked ? `style="color:${ink.base}"` : ''}>${_esc(meta.baseline)}</div>` : ''}
        </div>
      </div>`;

  // Barre de réglages — chips plates, groupées par intention.
  const chips = (defs, cur, act) => defs.map(([k, lbl]) =>
    `<button class="kb-chip ${cur === k ? 'on' : ''}" data-act="${act}" data-v="${k}">${lbl}</button>`).join('');
  const palette = _paletteOf().filter(c => c.hex);

  // La zone de complétion s'ouvre EN LIGNE, à droite de la pill active
  // (retour Stéphane : pas de rangée en dessous). Hex d'abord, palette ensuite.
  const hexSlot = (n, val) => `
    <span class="kb-hexslot">
      <input class="kb-hexmini" data-field="scene-hex${n}" value="${_esc(val || '')}"
             placeholder="#0055aa" maxlength="7" spellcheck="false" aria-label="Couleur ${n} (hex)">
      <label class="kb-scenewheel" title="Roue chromatique">${icon('palette', 12)}
        <input type="color" data-field="scene-cw${n}" value="${_esc(val || '#ffffff')}"></label>
    </span>`;
  const fillZone = (() => {
    if (s.bgType === 'color' || s.bgType === 'gradient') {
      const sws = palette.map(c => `<button class="kb-scenesw ${(s.c1 === c.hex || (s.bgType === 'gradient' && s.c2 === c.hex)) ? 'on' : ''}"
        data-act="scene-cnext" data-hex="${_esc(c.hex)}" style="background:${_esc(c.hex)}" title="${_esc(c.name || c.hex)}"></button>`).join('');
      return `<span class="kb-scenefill">${hexSlot('1', s.c1)}${s.bgType === 'gradient' ? hexSlot('2', s.c2) : ''}${sws}</span>`;
    }
    if (s.bgType === 'image' || s.bgType === 'video') {
      return `<span class="kb-scenefill">
        <button class="kb-fillbtn" data-act="scene-media">${icon(s.bgType === 'video' ? 'film' : 'image', 14)} ${s.assetId ? 'Remplacer' : (s.bgType === 'video' ? 'Choisir une vidéo' : 'Choisir une photo')}</button>
        <span class="kb-scenehint">${s.bgType === 'video' ? '4 Mo max · muette, en boucle' : '4 Mo max'}</span>
        ${s.assetId ? `<button class="kb-iconbtn danger kb-filldel" data-act="scene-media-del" title="Retirer le média">${icon('trash-2', 14)}</button>` : ''}
      </span>`;
    }
    return '';
  })();
  const bgChips = SCENE_BG_TYPES.map(([k, lbl]) =>
    `<button class="kb-chip ${s.bgType === k ? 'on' : ''}" data-act="scene-bgtype" data-v="${k}">${lbl}</button>` +
    (s.bgType === k ? fillZone : '')).join('');

  const sceneBar = `
    <div class="kb-scenebar">
      <div class="kb-scenegrp"><span class="kb-scenelbl">Fond</span>${bgChips}</div>
      <div class="kb-scenegrp"><span class="kb-scenelbl">Mise en scène</span>${chips(SCENE_LAYOUTS, s.layout, 'scene-lay')}</div>
      <div class="kb-scenegrp"><span class="kb-scenelbl">Encre</span>${chips(SCENE_INKS, s.ink, 'scene-ink')}</div>
      <div class="kb-scenegrp"><span class="kb-scenelbl">Tempo</span>${chips(SCENE_DURS.map(([k, l]) => [k, l]), s.dur, 'scene-dur')}</div>
    </div>`;

  const motionCards = MOTIONS.map(([key, label, sub]) => `
    <button class="kb-motion ${b.motion === key ? 'on' : ''}" data-act="brand-motion" data-motion="${key}">
      <strong>${label}</strong><span>${sub}</span>
    </button>`).join('');

  const stage = `
    <div class="kb-stage ${hasMedia ? 'has-media' : ''}" ${bgCss ? `style="${bgCss}"` : ''}>
      ${mediaEl}
      ${hasMedia && ink.scrim ? '<span class="kb-stage-scrim" aria-hidden="true"></span>' : ''}
      ${stageInner}
      <button class="kb-iconbtn kb-stage-replay" data-act="brand-replay" title="Rejouer l'animation">${icon('refresh', 15)}</button>
    </div>
    ${sceneBar}
    <div class="kb-motions">${motionCards}</div>
    <p class="kb-hint">L'animation ouvre la charte publique — sobre, et coupée pour les visiteurs qui préfèrent réduire les mouvements.</p>`;

  // ── Symbolique du signe v2 (KB-10) : titre + récit par repère, calque ──
  const con = _constructionOf();
  const dots = b.symbolism.map((s, i) => `
    <span class="kb-sym-dot" style="left:${(s.x * 100).toFixed(1)}%;top:${(s.y * 100).toFixed(1)}%">${i + 1}</span>`).join('');
  const symList = b.symbolism.map((s, i) => `
    <div class="kb-sym-row">
      <span class="kb-sym-num">${i + 1}</span>
      <input class="kb-field-input kb-sym-title" data-field="sym-title" data-idx="${i}" value="${_esc(s.title || '')}"
             placeholder="Titre — ex. « Le cercle »" maxlength="28" spellcheck="false">
      <input class="kb-field-input" data-field="sym-text" data-idx="${i}" value="${_esc(s.text || '')}"
             placeholder="Ce que cette partie du signe raconte…" maxlength="120" spellcheck="false">
      <button class="kb-iconbtn danger" data-act="sym-del" data-idx="${i}" title="Retirer">${icon('trash-2', 15)}</button>
    </div>`).join('');
  const symbolique = logoVariant ? `
    <section class="kb-lab">
      <h3 class="kb-lab-title">La symbolique du signe</h3>
      <p class="kb-hint">Cliquez sur le logo pour poser un repère, puis nommez et racontez ce que cette partie représente. Sur la page publiée, chaque repère se visite d'un clic.</p>
      <div class="kb-sym-canvas" data-slot="sym-canvas" role="button" aria-label="Poser une annotation sur le logo">
        <img data-asset="${_esc(logoVariant.assetId)}" alt="" draggable="false">
        ${con.assetId ? `<img class="kb-con-overlay" data-slot="con-overlay" data-asset="${_esc(con.assetId)}" style="opacity:${con.opacity}" alt="" draggable="false">` : ''}
        ${dots}
      </div>
      <div class="kb-scenegrp kb-con-row">
        <span class="kb-scenelbl">Construction</span>
        <button class="kb-btn" data-act="con-add">${icon('image', 14)} ${con.assetId ? 'Remplacer la grille' : 'Déposer la grille de construction'}</button>
        ${con.assetId ? `
          <input type="range" class="kb-con-range" data-field="con-op" min="0.1" max="1" step="0.05" value="${con.opacity}" aria-label="Opacité du calque">
          <button class="kb-iconbtn danger" data-act="con-del" title="Retirer le calque">${icon('trash-2', 15)}</button>` : `
          <span class="kb-scenehint">le tracé régulateur du graphiste, en calque sur le logo</span>`}
      </div>
      ${symList}
    </section>` : '';

  // ── Iconographie (KB-14) ──
  const ic = _iconsOf();
  const icChips = (defs, cur, act) => defs.map(([k, lbl]) =>
    `<button class="kb-chip ${cur === k ? 'on' : ''}" data-act="${act}" data-v="${k}">${lbl}</button>`).join('');
  const icTiles = ic.assetIds.map(aid => `
    <figure class="kb-ic-tile">
      <img data-asset="${_esc(aid)}" alt="" draggable="false">
      <button class="kb-iconbtn danger" data-act="ic-del" data-aid="${_esc(aid)}" title="Retirer">${icon('trash-2', 13)}</button>
    </figure>`).join('');
  const iconoBlock = `
    <section class="kb-lab">
      <h3 class="kb-lab-title">Iconographie & pictogrammes</h3>
      <p class="kb-hint">Le style des pictos de la marque — déclaré en trois axes, illustré par vos exemples (${KB_ICONS_MAX} max).</p>
      <div class="kb-scenegrp"><span class="kb-scenelbl">Trait</span>${icChips(ICON_STROKES, ic.stroke, 'ic-stroke')}</div>
      <div class="kb-scenegrp"><span class="kb-scenelbl">Angles</span>${icChips(ICON_CORNERS, ic.corners, 'ic-corners')}</div>
      <div class="kb-scenegrp"><span class="kb-scenelbl">Graisse</span>${icChips(ICON_WEIGHTS, ic.weight, 'ic-weight')}</div>
      <input class="kb-field-input kb-ic-note" data-field="ic-note" value="${_esc(ic.note)}" maxlength="200"
             placeholder="Règle libre — ex. « toujours posés sur un rond de la couleur primaire »" spellcheck="false">
      <div class="kb-ic-grid">
        ${icTiles}
        ${ic.assetIds.length < KB_ICONS_MAX ? `<button class="kb-ic-add" data-act="ic-add" title="Ajouter des pictos (SVG, PNG)">${icon('plus', 16)}</button>` : ''}
      </div>
    </section>`;

  // ── Identité de marque & ton de voix (KB-13) ──
  const idn = _identityOf();
  const vo = idn.voice;
  const identityBlock = `
    <section class="kb-lab">
      <h3 class="kb-lab-title">L'identité de marque</h3>
      <p class="kb-hint">Ce que la marque est — la charte publiée s'ouvre là-dessus. Tout est facultatif : seul le rempli s'affiche.</p>
      <label class="kb-field-label">Mission
        <input class="kb-field-input" data-field="id-mission" value="${_esc(idn.mission)}" maxlength="160"
               placeholder="Ce que la marque fait, pour qui — en une phrase." spellcheck="false"></label>
      <label class="kb-field-label">Valeurs (5 max)</label>
      <div class="kb-id-values">${[0, 1, 2, 3, 4].map(i => `
        <input class="kb-field-input" data-field="id-value" data-idx="${i}" value="${_esc(idn.values[i] || '')}"
               maxlength="24" placeholder="${['ex. exigence', 'ex. proximité', 'ex. audace', '', ''][i] || ''}" spellcheck="false">`).join('')}</div>
      <label class="kb-field-label">L'histoire
        <textarea class="kb-field-input kb-id-story" data-field="id-story" maxlength="600" rows="3"
                  placeholder="D'où vient la marque, en quelques lignes." spellcheck="false">${_esc(idn.story)}</textarea></label>
    </section>
    <section class="kb-lab">
      <h3 class="kb-lab-title">Le ton de voix</h3>
      <p class="kb-hint">L'identité verbale — comment la marque parle, partout.</p>
      <div class="kb-scenegrp"><span class="kb-scenelbl">Registre</span>
        ${VOICE_REGS.map(([k, lbl]) => `<button class="kb-chip ${vo.reg === k ? 'on' : ''}" data-act="vo-reg" data-v="${k}">${lbl}</button>`).join('')}</div>
      <label class="kb-field-label">Trois principes d'écriture</label>
      <div class="kb-id-values kb-vo-principles">${[0, 1, 2].map(i => `
        <input class="kb-field-input" data-field="vo-principle" data-idx="${i}" value="${_esc(vo.principles[i] || '')}"
               maxlength="80" placeholder="${['ex. des phrases courtes', 'ex. concret avant tout', 'ex. jamais de jargon'][i]}" spellcheck="false">`).join('')}</div>
      <div class="kb-vo-cols">
        <label class="kb-field-label">Mots à privilégier
          <input class="kb-field-input" data-field="vo-use" value="${_esc(vo.use)}" maxlength="160" placeholder="ex. atelier, savoir-faire, sur-mesure" spellcheck="false"></label>
        <label class="kb-field-label">Mots à éviter
          <input class="kb-field-input" data-field="vo-avoid" value="${_esc(vo.avoid)}" maxlength="160" placeholder="ex. pas cher, leader, révolutionnaire" spellcheck="false"></label>
      </div>
      <label class="kb-field-label">Une phrase, à la manière de la marque
        <textarea class="kb-field-input" data-field="vo-example" maxlength="240" rows="2"
                  placeholder="ex. « On prend le temps de bien faire — votre projet mérite mieux qu'un gabarit. »" spellcheck="false">${_esc(vo.example)}</textarea></label>
    </section>`;

  // ── Planche d'ambiance (KB-9) + direction photo fusionnée ──
  const bd = _boardOf();
  const tplChips = BOARD_TPLS.map(([k, lbl]) =>
    `<button class="kb-chip ${bd.template === k ? 'on' : ''}" data-act="board-tpl" data-v="${k}">${lbl}</button>`).join('');
  const cellHtml = _boardSlots().map(sl => {
    const c = bd.cells[sl];
    if (!c?.assetId) return `
      <button class="kb-bd-cell is-empty" data-slot="bd-cell" data-cell="${sl}" data-act="bd-cell-add" title="Photo ou vidéo (4 Mo max)">
        ${icon('image', 20)}<span>Photo ou vidéo</span>
      </button>`;
    const media = c.video
      ? `<video data-asset="${_esc(c.assetId)}" muted loop autoplay playsinline></video>`
      : `<img data-asset="${_esc(c.assetId)}" alt="" draggable="false">`;
    const med = c.med?.assetId ? `
      <span class="kb-bd-med" style="left:${(c.med.x * 100).toFixed(1)}%;top:${(c.med.y * 100).toFixed(1)}%">
        <img data-asset="${_esc(c.med.assetId)}" alt="" draggable="false">
        <button class="kb-bd-med-del" data-act="bd-med-del" title="Retirer le médaillon">${icon('x', 12)}</button>
      </span>` : '';
    return `
      <div class="kb-bd-cell ${c.med ? 'has-med' : ''}" data-slot="bd-cell" data-cell="${sl}">
        ${media}${med}
        <span class="kb-bd-tools">
          ${c.med?.assetId ? '' : `<button data-act="bd-med-add" title="Imbriquer un médaillon rond">${icon('plus-circle', 15)}</button>`}
          <button data-act="bd-cell-add" title="Remplacer">${icon('refresh', 14)}</button>
          <button class="danger" data-act="bd-cell-del" title="Retirer">${icon('trash-2', 14)}</button>
        </span>
      </div>`;
  }).join('');

  const photo = b.photo || { words: [], exampleAssetIds: [] };
  const words = [0, 1, 2].map(i => `
    <input class="kb-field-input kb-ph-word" data-field="ph-word" data-idx="${i}" value="${_esc(photo.words?.[i] || '')}"
           placeholder="${['ex. lumineux', 'ex. authentique', 'ex. matières brutes'][i]}" maxlength="30" spellcheck="false">`).join('');
  const examples = (photo.exampleAssetIds || []).map(aid => `
    <figure class="kb-ph-item">
      <img data-asset="${_esc(aid)}" alt="" draggable="false">
      <button class="kb-iconbtn danger" data-act="ph-del" data-aid="${_esc(aid)}" title="Retirer">${icon('trash-2', 14)}</button>
    </figure>`).join('');

  const boardBlock = `
    <section class="kb-lab">
      <h3 class="kb-lab-title">Planche d'ambiance & direction photo</h3>
      <p class="kb-hint">Composez l'atmosphère : un gabarit, vos photos ou boucles vidéo, et un médaillon rond imbriqué par image (posé au clic). Le style en trois mots légende la planche.</p>
      <div class="kb-scenegrp kb-bd-tplrow"><span class="kb-scenelbl">Gabarit</span>${tplChips}</div>
      <div class="kb-board">
        <div class="kb-bd-txt">
          <input class="kb-bd-title" data-field="bd-title" value="${_esc(bd.title)}" maxlength="80"
                 placeholder="Textures et atmosphère" spellcheck="false" ${titleFont ? `style="font-family:${titleFont}"` : ''}>
          <textarea class="kb-bd-text" data-field="bd-text" maxlength="500" rows="6" spellcheck="false"
                    placeholder="Ce que les images doivent raconter — matières, lumière, émotions…">${_esc(bd.text)}</textarea>
          <div class="kb-ph-words">${words}</div>
        </div>
        <div class="kb-bd-grid tpl-${_esc(bd.template)}">${cellHtml}</div>
      </div>
      <div class="kb-bd-examples">
        <p class="kb-hint">Exemples en vrac (${KB_PHOTO_MAX} max — ce n'est pas une photothèque).</p>
        <div class="kb-ph-grid">
          ${examples}
          ${(photo.exampleAssetIds || []).length < KB_PHOTO_MAX ? `<button class="kb-ph-add" data-act="ph-add" title="Ajouter des exemples">${icon('plus', 18)}</button>` : ''}
        </div>
      </div>
    </section>`;

  return `<div class="kb-brand">${stage}${identityBlock}${boardBlock}${symbolique}${iconoBlock}</div>`;
}

// ════════════════════════════════════════════════════════════════
// ONGLET SUPPORTS (KB-11) — mockups auto-composés avec la charte
// ════════════════════════════════════════════════════════════════
function _renderSupportsTab() {
  const s = _supportsOf();
  const kit = _brandKit();
  const on = k => s.enabled[k] !== false;
  const tf = kit.titleFont ? `font-family:${kit.titleFont};` : '';
  const p = kit.primary;
  const btnBg = p || '#15171c', btnInk = _inkOn(btnBg);
  const heroBg = p ? (kit.second ? `background:linear-gradient(135deg,${p},${kit.second})` : `background:${p}`) : 'background:#eef0f4';
  const heroInk = p ? _inkOn(p) : '#15171c';
  const blockBg = p ? `background:color-mix(in srgb, ${p} 10%, #ffffff)` : 'background:#f1f3f6';
  const domain = s.domain.trim() || _slugDomain(kit.name);
  const logoImg = kit.logo ? `<img data-asset="${_esc(kit.logo.assetId)}" alt="" draggable="false">` : '';
  const wordmark = `<b style="${tf}">${_esc(kit.name)}</b>`;
  const eye = k => `
    <button class="kb-sup-eye" data-act="sup-toggle" data-k="${k}" aria-pressed="${on(k)}"
            title="${on(k) ? 'Masquer ce support de la charte' : 'Réactiver ce support'}">${icon(on(k) ? 'eye' : 'eye-off', 15)}</button>`;

  // ── Site web : cadre navigateur + hero composé ──
  const webPage = s.webShotId
    ? `<img class="mk-shot" data-asset="${_esc(s.webShotId)}" alt="" draggable="false">`
    : `<div class="mk-page">
        <div class="mk-nav">
          ${logoImg ? `<span class="mk-navlogo">${logoImg}</span>` : wordmark}
          <span class="mk-links"><i>Accueil</i><i>Offre</i><i>Contact</i></span>
          <span class="mk-btn" style="background:${btnBg};color:${btnInk}">Contact</span>
        </div>
        <div class="mk-hero" style="${heroBg}">
          <strong style="${tf}color:${heroInk}">${_esc(kit.baseline || kit.name)}</strong>
          <span class="mk-btn mk-cta" style="background:${heroInk === '#ffffff' ? 'rgba(255,255,255,.94)' : '#15171c'};color:${heroInk === '#ffffff' ? (p || '#15171c') : '#ffffff'}">Découvrir</span>
        </div>
        <div class="mk-blocks"><i style="${blockBg}"></i><i style="${blockBg}"></i><i style="${blockBg}"></i></div>
      </div>`;
  const web = `
    <section class="kb-sup ${on('web') ? '' : 'is-off'}">
      <div class="kb-sup-head">
        <h3 class="kb-lab-title">Site web</h3>
        <input class="kb-field-input kb-sup-domain" data-field="sup-domain" value="${_esc(s.domain)}"
               placeholder="${_esc(_slugDomain(kit.name))}" maxlength="60" spellcheck="false">
        <button class="kb-btn" data-act="sup-shot" data-k="web">${icon('image', 14)} ${s.webShotId ? 'Remplacer la capture' : 'Capture du vrai site'}</button>
        ${s.webShotId ? `<button class="kb-iconbtn danger" data-act="sup-shot-del" data-k="web" title="Revenir au mockup composé">${icon('trash-2', 15)}</button>` : ''}
        ${eye('web')}
      </div>
      <div class="mk-browser">
        <div class="mk-bar"><span class="mk-dots"><i></i><i></i><i></i></span>
          <span class="mk-url">${p ? `<i class="mk-fav" style="background:${p}"></i>` : ''}<span data-mk="url">${_esc(domain)}</span></span></div>
        ${webPage}
      </div>
    </section>`;

  // ── Smartphone ──
  const phoneScreen = s.phoneShotId
    ? `<img class="mk-shot" data-asset="${_esc(s.phoneShotId)}" alt="" draggable="false">`
    : `<div class="mk-mpage">
        <div class="mk-mnav">${logoImg ? `<span class="mk-navlogo">${logoImg}</span>` : wordmark}</div>
        <div class="mk-mhero" style="${heroBg}">
          <strong style="${tf}color:${heroInk}">${_esc(kit.name)}</strong>
          ${kit.baseline ? `<span style="color:${heroInk}">${_esc(kit.baseline)}</span>` : ''}
        </div>
        <div class="mk-mrows"><i style="${blockBg}"></i><i style="${blockBg}"></i></div>
        <span class="mk-btn mk-mcta" style="background:${btnBg};color:${btnInk}">Nous contacter</span>
      </div>`;
  const phone = `
    <section class="kb-sup ${on('phone') ? '' : 'is-off'}">
      <div class="kb-sup-head">
        <h3 class="kb-lab-title">Smartphone</h3>
        <button class="kb-btn" data-act="sup-shot" data-k="phone">${icon('image', 14)} ${s.phoneShotId ? 'Remplacer la capture' : 'Capture du vrai site'}</button>
        ${s.phoneShotId ? `<button class="kb-iconbtn danger" data-act="sup-shot-del" data-k="phone" title="Revenir au mockup composé">${icon('trash-2', 15)}</button>` : ''}
        ${eye('phone')}
      </div>
      <div class="mk-phone"><div class="mk-notch"></div><div class="mk-screen">${phoneScreen}</div></div>
    </section>`;

  // ── Carte de visite : recto (clair) + verso (couleur) ──
  const cardEmail = s.card.email || ('contact@' + domain);
  const card = `
    <section class="kb-sup ${on('card') ? '' : 'is-off'}">
      <div class="kb-sup-head"><h3 class="kb-lab-title">Carte de visite</h3>${eye('card')}</div>
      <div class="mk-bizrow">
        <div class="mk-biz mk-recto">
          ${logoImg ? `<span class="mk-bizlogo">${logoImg}</span>` : ''}
          <b style="${tf}">${_esc(kit.name)}</b>
          ${kit.baseline ? `<span>${_esc(kit.baseline)}</span>` : ''}
        </div>
        <div class="mk-biz mk-verso" style="background:${btnBg};color:${btnInk}">
          <b data-mk="card-name" data-fallback="${_esc(kit.name)}">${_esc(s.card.name || kit.name)}</b>
          <span data-mk="card-role">${_esc(s.card.role || 'Fonction')}</span>
          <span data-mk="card-tel">${_esc(s.card.tel || '01 23 45 67 89')}</span>
          <span data-mk="card-email" data-fallback="${_esc('contact@' + domain)}">${_esc(cardEmail)}</span>
        </div>
      </div>
      <div class="kb-sup-fields">
        <input class="kb-field-input" data-field="sup-card-name" value="${_esc(s.card.name)}" placeholder="Nom" maxlength="80" spellcheck="false">
        <input class="kb-field-input" data-field="sup-card-role" value="${_esc(s.card.role)}" placeholder="Fonction" maxlength="80" spellcheck="false">
        <input class="kb-field-input" data-field="sup-card-tel" value="${_esc(s.card.tel)}" placeholder="Téléphone" maxlength="80" spellcheck="false">
        <input class="kb-field-input" data-field="sup-card-email" value="${_esc(s.card.email)}" placeholder="E-mail" maxlength="80" spellcheck="false">
      </div>
    </section>`;

  // ── Réseaux sociaux : avatar rond + bannière ──
  const social = `
    <section class="kb-sup ${on('social') ? '' : 'is-off'}">
      <div class="kb-sup-head"><h3 class="kb-lab-title">Réseaux sociaux</h3>${eye('social')}</div>
      <div class="mk-socialrow">
        <div class="mk-avatar">${logoImg || `<b style="${tf}">${_esc(kit.name.charAt(0).toUpperCase())}</b>`}</div>
        <div class="mk-banner" style="${heroBg}">
          ${logoImg ? `<span class="mk-bannerlogo">${logoImg}</span>` : ''}
          <span style="${tf}color:${heroInk}">${_esc(kit.baseline || kit.name)}</span>
        </div>
      </div>
    </section>`;

  // ── Réalisations : photos de la marque en vrai ──
  const gal = s.gallery.map(aid => `
    <figure class="kb-ph-item">
      <img data-asset="${_esc(aid)}" alt="" draggable="false">
      <button class="kb-iconbtn danger" data-act="sup-gal-del" data-aid="${_esc(aid)}" title="Retirer">${icon('trash-2', 14)}</button>
    </figure>`).join('');
  const gallery = `
    <section class="kb-sup">
      <div class="kb-sup-head"><h3 class="kb-lab-title">Réalisations</h3></div>
      <p class="kb-hint">La marque en vrai — enseigne, packaging, véhicule, vitrine… (${KB_GALLERY_MAX} max).</p>
      <div class="kb-ph-grid">
        ${gal}
        ${s.gallery.length < KB_GALLERY_MAX ? `<button class="kb-ph-add" data-act="sup-gal-add" title="Ajouter des photos">${icon('plus', 18)}</button>` : ''}
      </div>
    </section>`;

  return `
    <div class="kb-supports">
      <p class="kb-hint">Ces mockups se composent tout seuls avec votre charte — logo, couleurs, typographies. Rien n'est généré : tout est calculé. L'œil masque un support de la page publiée.</p>
      ${web}${phone}${card}${social}${gallery}
    </div>`;
}

// ════════════════════════════════════════════════════════════════
// PUBLICATION (KB-6) — brouillon → page publique /b/:slug
// ════════════════════════════════════════════════════════════════
// KB-12 — thème de l'édition publiée : fond des planches + teinte des
// intercalaires (défaut = couleur primaire). Vit dans draft.settings.pub.
function _pubThemeOf() {
  if (!_chart.draft.settings || typeof _chart.draft.settings !== 'object') _chart.draft.settings = {};
  const st = _chart.draft.settings;
  if (!st.pub || typeof st.pub !== 'object') st.pub = {};
  if (!['light', 'dark'].includes(st.pub.mode)) st.pub.mode = 'light';
  if (st.pub.tint != null && !/^#[0-9a-fA-F]{6}$/.test(st.pub.tint)) st.pub.tint = null;
  return st.pub;
}

function _renderPubPanel() {
  const access = _pubAccess || _chart.access || 'unlisted';
  const isLive = _chart.status === 'published';
  const radios = ACCESS_OPTIONS.map(([k, lbl, sub]) => `
    <label class="kb-access ${access === k ? 'on' : ''}">
      <input type="radio" name="kb-access" data-field="pub-access" value="${k}" ${access === k ? 'checked' : ''}>
      <span class="kb-access-txt"><strong>${lbl}</strong><span>${sub}</span></span>
    </label>`).join('');

  const live = isLive ? `
    <div class="kb-pub-live">
      <div class="kb-pub-linkrow">
        <code class="kb-pub-link">${_esc(_publicUrl())}</code>
        <button class="kb-btn" data-act="copy" data-copy="${_esc(_publicUrl())}">${icon('copy', 14)} Copier</button>
        <button class="kb-btn" data-act="pub-open">${icon('external-link', 14)} Voir la page</button>
      </div>
      <div class="kb-pub-qr" data-slot="pub-qr" aria-label="QR code de la charte"></div>
      <p class="kb-hint">Le QR pointe toujours vers la dernière version — imprimez-le sans crainte.</p>
    </div>` : '';

  // KB-12 — mise en page de l'édition publiée.
  const theme = _pubThemeOf();
  const tpal = _paletteOf().filter(c => c.hex);
  const themeBlock = `
    <div class="kb-pub-theme">
      <h4>Mise en page de l'édition</h4>
      <div class="kb-scenegrp"><span class="kb-scenelbl">Planches</span>
        <button class="kb-chip ${theme.mode === 'light' ? 'on' : ''}" data-act="pub-mode" data-v="light">Claires</button>
        <button class="kb-chip ${theme.mode === 'dark' ? 'on' : ''}" data-act="pub-mode" data-v="dark">Sombres</button>
      </div>
      <div class="kb-scenegrp"><span class="kb-scenelbl">Teinte</span>
        <button class="kb-chip ${!theme.tint ? 'on' : ''}" data-act="pub-tint" data-hex="">Primaire</button>
        ${tpal.map(c => `<button class="kb-scenesw ${theme.tint === c.hex ? 'on' : ''}" data-act="pub-tint"
          data-hex="${_esc(c.hex)}" style="background:${_esc(c.hex)}" title="${_esc(c.name || c.hex)}"></button>`).join('')}
        <label class="kb-scenewheel" title="Autre couleur">${icon('palette', 13)}
          <input type="color" data-field="pub-tintwheel" value="${_esc(theme.tint || '#23252d')}"></label>
      </div>
      <p class="kb-hint">Couverture, sommaire et pages de chapitre prennent la teinte. Republiez pour appliquer.</p>
    </div>`;

  return `
    <div class="kb-pub-panel">
      <div class="kb-pub-cols">
        <div class="kb-pub-col">
          <h4>Qui peut voir la charte ?</h4>
          ${radios}
          ${access === 'code' ? `
          <label class="kb-field-label">Code d'accès
            <input class="kb-field-input kb-inline" data-slot="pub-code" type="text" maxlength="60"
                   placeholder="4 caractères minimum" spellcheck="false" autocomplete="off">
          </label>
          <p class="kb-hint">${isLive && _chart.access === 'code' ? 'Laissez vide pour conserver le code actuel.' : 'Transmettez-le par un autre canal que le lien.'}</p>` : ''}
          <p class="kb-hint">La page n'est jamais référencée par les moteurs de recherche.</p>
        </div>
        <div class="kb-pub-col">
          <h4>${isLive ? `Publier la version ${_chart.version + 1}` : 'Première publication'}</h4>
          <input class="kb-field-input" data-slot="pub-note" type="text" maxlength="300"
                 placeholder="Note de version (facultative) — ex. « Nouveau logo secondaire »" spellcheck="false">
          <button class="kb-btn primary kb-pub-go" data-act="pub-go" ${_pubBusy ? 'disabled' : ''}>
            ${icon('check', 15)} ${_pubBusy ? 'Publication…' : (isLive ? 'Publier la mise à jour' : 'Publier la charte')}
          </button>
          <p class="kb-hint">Le brouillon reste privé tant que vous ne publiez pas. Les visiteurs voient la dernière version publiée.</p>
        </div>
      </div>
      ${themeBlock}
      ${live}
    </div>`;
}

async function _publish() {
  if (!_chart || _pubBusy) return;
  const access = _pubAccess || _chart.access || 'unlisted';
  const codeEl = _root.querySelector('[data-slot="pub-code"]');
  const code = codeEl ? codeEl.value.trim() : '';
  const note = _root.querySelector('[data-slot="pub-note"]')?.value.trim() || '';
  if (access === 'code' && !code && !(_chart.status === 'published' && _chart.access === 'code')) {
    _toast('Choisissez un code d\'accès (4 caractères minimum).'); return;
  }
  if (access === 'code' && code && code.length < 4) { _toast('Code trop court (4 caractères minimum).'); return; }
  _pubBusy = true; _renderChart();
  try {
    await _flushSave();   // le snapshot publié = exactement ce qui est à l'écran
    if (access !== _chart.access || (access === 'code' && code)) {
      await _api(`/charts/${encodeURIComponent(_chart.id)}/access`, { method: 'PUT', body: { access, code: code || undefined } });
      _chart.access = access;
    }
    const d = await _api(`/charts/${encodeURIComponent(_chart.id)}/publish`, { method: 'POST', body: { note } });
    _chart.status = 'published'; _chart.version = d.version;
    _toast(`Version ${d.version} en ligne.`);
  } catch (e) { _toast(e.message); }
  _pubBusy = false; _pubAccess = null;
  _renderChart();
}

// QR : même moteur que Missive (qrcode-generator via esm.sh, autorisé CSP).
async function _renderPubQr() {
  const el = _root?.querySelector('[data-slot="pub-qr"]');
  if (!el || el.dataset.done) return;
  try {
    const mod = await import('https://esm.sh/qrcode-generator@1.4.4');
    const qrcode = mod.default || mod;
    const qr = qrcode(0, 'M'); qr.addData(_publicUrl()); qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    el.dataset.done = '1';
  } catch (_) { el.innerHTML = `<span class="kb-hint">QR indisponible — utilisez le lien.</span>`; }
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
