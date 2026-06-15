// ═══════════════════════════════════════════════════════════════
// KEYNAPSE — Pad O-Keyn-001 · KN-1 (Sprint 1 : la constellation vivante)
//
// Espace personnel de connaissances : des bulles de notes sur un
// canevas infini, qui respirent, qu'on déplace, reliées par des traits
// en périphérie. Le contrôleur monte la coquille workspace, charge
// l'état du tenant et délègue le rendu vivant au moteur maison
// (lib/keynapse-engine.js — zéro dépendance). Le panneau latéral de la
// fiche (clic sur une bulle) arrive au Sprint 2.
//
// ISOLATION : aucun code partagé avec Smart Agent / Key Form.
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';
import { createConstellation }                from './lib/keynapse-engine.js';

const WORKSPACE_META = { id: 'O-Keyn-001', name: 'Keynapse' };
const API_BASE = 'https://keystone-os-api.keystone-os.workers.dev';

const FIT_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

let _root = null;
let _state = { zones: [], bubbles: [], links: [] };
let _engine = null;
let _loading = false;
let _error = null;

// ── API (patron _api de smart-agent.js) ─────────────────────────
function _jwt() {
  return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || '';
}
async function _api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(`${API_BASE}/api/keynapse${path}`, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': `Bearer ${_jwt()}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw (e && e.name === 'AbortError')
      ? new Error('Le serveur met trop de temps à répondre — réessayez.')
      : e;
  }
  clearTimeout(timer);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { const e = new Error(data.error || `Erreur ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// ── Ouverture / fermeture ───────────────────────────────────────
export function openKeynapse(opts = {}) {
  if (_root) return;
  _buildShell();
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _onKey);
  _load();
}
export function closeKeynapse() {
  if (!_root) return;
  _teardownEngine();
  document.removeEventListener('keydown', _onKey);
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ── Coquille workspace (ws-*) ───────────────────────────────────
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app kyn-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('keynapse', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main kyn-main" data-slot="main">
        <div class="kyn-canvas-wrap" data-slot="canvas"></div>
      </main>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  try { bindRatingButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindHelpButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindBurger(_root); } catch (_) {}
}

// ── Délégation des actions ──────────────────────────────────────
function _onClick(e) {
  // Clic sur le fond du composer = fermeture (pas d'inline JS, CSP stricte).
  if (e.target.classList && e.target.classList.contains('kyn-composer')) { _closeComposer(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close')        { closeKeynapse(); return; }
  if (act === 'kyn-retry')    { _load(); return; }
  if (act === 'kyn-compose')  { _openComposer(); return; }
  if (act === 'kyn-cancel')   { _closeComposer(); return; }
  if (act === 'kyn-create')   { _submitComposer(); return; }
  if (act === 'kyn-zoom-in')  { _engine && _engine.zoomBy(1.25); return; }
  if (act === 'kyn-zoom-out') { _engine && _engine.zoomBy(0.8);  return; }
  if (act === 'kyn-fit')      { _engine && _engine.fitAll();     return; }
}
function _onKey(e) {
  if (e.key === 'Enter' && e.target && e.target.id === 'kyn-new-title') { e.preventDefault(); _submitComposer(); return; }
  if (e.key === 'Escape') { if (_root && _root.querySelector('.kyn-composer')) _closeComposer(); else closeKeynapse(); }
}

// ── Chargement de l'état ────────────────────────────────────────
async function _load() {
  _loading = true; _error = null; _render();
  try {
    const r = await _api('/state');
    _state = { zones: r.zones || [], bubbles: r.bubbles || [], links: r.links || [] };
  } catch (e) {
    _error = e.message || 'Chargement impossible.';
  } finally {
    _loading = false; _render();
  }
}

// ── Rendu ───────────────────────────────────────────────────────
function _canvas() { return _root && _root.querySelector('[data-slot="canvas"]'); }
function _teardownEngine() { if (_engine) { _engine.destroy(); _engine = null; } }

function _render() {
  const c = _canvas();
  if (!c) return;
  if (_loading) {
    _teardownEngine();
    c.innerHTML = `<div class="kyn-state"><div class="kyn-spin"></div><p>Chargement de votre constellation…</p></div>`;
    return;
  }
  if (_error) {
    _teardownEngine();
    c.innerHTML = `<div class="kyn-state"><p class="kyn-err">${_esc(_error)}</p><button class="kyn-btn" data-act="kyn-retry">Réessayer</button></div>`;
    return;
  }
  if (!_state.bubbles.length) {
    _teardownEngine();
    c.innerHTML = _emptyHTML();
    _focusComposer();
    return;
  }
  // Bulles présentes : on monte le moteur une seule fois, puis setData.
  if (!_engine) {
    c.innerHTML = `
      <div class="kyn-stage" data-slot="stage"></div>
      <div class="kyn-toolbar">
        <button class="kyn-tool" data-act="kyn-zoom-out" title="Dézoomer" aria-label="Dézoomer">−</button>
        <button class="kyn-tool" data-act="kyn-fit" title="Tout voir" aria-label="Tout voir">${FIT_ICON}</button>
        <button class="kyn-tool" data-act="kyn-zoom-in" title="Zoomer" aria-label="Zoomer">+</button>
      </div>
      <button class="kyn-fab" data-act="kyn-compose" title="Nouvelle bulle" aria-label="Nouvelle bulle">${icon('plus', 24) || '+'}</button>`;
    const stage = c.querySelector('[data-slot="stage"]');
    _engine = createConstellation({ container: stage, onBubbleMoved: _persistMove, onBubbleClick: _onBubbleClick });
  }
  _engine.setData(_state.bubbles, _state.links);
}

// Drag lâché → persiste la nouvelle position (fire-and-forget).
async function _persistMove(id, x, y) {
  // Reflète localement pour que les rechargements ultérieurs gardent la position.
  const b = _state.bubbles.find((bb) => bb.id === id);
  if (b) { b.x = x; b.y = y; }
  try { await _api(`/bubbles/${encodeURIComponent(id)}`, { method: 'PATCH', body: { x, y } }); }
  catch (_) { /* silencieux : la position est déjà visible ; on retentera au prochain drag */ }
}

// Clic (tap) sur une bulle → Sprint 2 : ouverture du panneau latéral.
function _onBubbleClick(/* node */) { /* Sprint 2 */ }

// ── État vide ───────────────────────────────────────────────────
function _emptyHTML() {
  return `
    <div class="kyn-state kyn-empty">
      <span class="kyn-empty-glow">${icon('keynapse', 40)}</span>
      <h2>Votre constellation est vide</h2>
      <p>Chaque idée devient une bulle. Posez la première — vous les relierez ensuite.</p>
      <div class="kyn-compose-row">
        <input id="kyn-new-title" class="kyn-input" type="text" maxlength="200" placeholder="Titre de la bulle (ex. Projet Cuisine)" autocomplete="off">
        <button class="kyn-btn kyn-btn--accent" data-act="kyn-create">Créer ma première bulle</button>
      </div>
    </div>`;
}

// ── Composer (overlay du bouton +) ──────────────────────────────
// Ajouté/retiré du DOM sans toucher au moteur (évite de le reconstruire).
function _openComposer() {
  const wrap = _canvas();
  if (!wrap || wrap.querySelector('.kyn-composer')) return;
  const div = document.createElement('div');
  div.className = 'kyn-composer';
  div.innerHTML = `
    <div class="kyn-composer-card">
      <h3>Nouvelle bulle</h3>
      <input id="kyn-new-title" class="kyn-input" type="text" maxlength="200" placeholder="Titre de la bulle" autocomplete="off" style="width:100%">
      <div class="kyn-composer-actions">
        <button class="kyn-btn" data-act="kyn-cancel">Annuler</button>
        <button class="kyn-btn kyn-btn--accent" data-act="kyn-create">Créer</button>
      </div>
    </div>`;
  wrap.appendChild(div);
  _focusComposer();
}
function _closeComposer() {
  const o = _root && _root.querySelector('.kyn-composer');
  if (o) o.remove();
}
function _focusComposer() {
  setTimeout(() => { const i = _root && _root.querySelector('#kyn-new-title'); if (i) i.focus(); }, 40);
}

async function _submitComposer() {
  const input = _root && _root.querySelector('#kyn-new-title');
  if (!input) return;
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  input.disabled = true;
  try {
    await _api('/bubbles', { method: 'POST', body: { title } });
    _closeComposer();
    await _load();
  } catch (e) {
    _error = e.message || 'Création impossible.';
    _render();
  }
}

// ── Utils ───────────────────────────────────────────────────────
function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
