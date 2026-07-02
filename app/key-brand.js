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
  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('input', _onInput);
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
  if (act.startsWith('tab-')) { _tab = act.slice(4); _renderChart(); return; }
  if (act === 'soon')         { _toast('Cet atelier arrive au prochain sprint.'); return; }
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
}

// Spécimens fantômes — l'état le plus important de l'app (brief §6) :
// une charte vide ressemble à une galerie avant vernissage, jamais à
// une base de données vide. Une invitation, une action, rien d'autre.
function _renderTab(key) {
  if (key === 'logo') return `
    <div class="kb-ghost">
      <div class="kb-ghost-logo" aria-hidden="true">
        <div class="kb-ghost-drop">${icon('image', 30)}</div>
      </div>
      <h3>Le logo, dans tous ses états</h3>
      <p>Déposez vos fichiers : aperçus sur fonds clairs, sombres et colorés, zone de protection, et téléchargement au format et à la taille que votre interlocuteur demande.</p>
      <button class="kb-btn primary" data-act="soon">${icon('plus', 16)} Déposer un logo</button>
    </div>`;

  if (key === 'colors') return `
    <div class="kb-ghost">
      <div class="kb-ghost-swatches" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <h3>L'atelier des couleurs</h3>
      <p>Votre palette avec ses codes copiables en un clic, des déclinaisons harmonieuses, et le test de lisibilité des contrastes en direct.</p>
      <button class="kb-btn primary" data-act="soon">${icon('plus', 16)} Ajouter une couleur</button>
    </div>`;

  if (key === 'type') return `
    <div class="kb-ghost">
      <div class="kb-ghost-type" aria-hidden="true">
        <span class="kb-ghost-aa">Aa</span>
        <span class="kb-ghost-line w70"></span>
        <span class="kb-ghost-line w50"></span>
      </div>
      <h3>Les typographies, à l'essai</h3>
      <p>Choisissez vos polices, testez-les avec votre propre texte, et offrez leur téléchargement à ceux qui composent pour vous.</p>
      <button class="kb-btn primary" data-act="soon">${icon('plus', 16)} Choisir une police</button>
    </div>`;

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
