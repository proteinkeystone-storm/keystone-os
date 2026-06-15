// ═══════════════════════════════════════════════════════════════
// KEYNAPSE — Pad O-Keyn-001 · KN-2 (Sprint 2 : panneau de la fiche)
//
// Espace personnel de connaissances : des bulles de notes sur un
// canevas infini (moteur lib/keynapse-engine.js). Clic sur une bulle
// → panneau latéral droit (bottom-sheet sur mobile), teinté de la
// couleur de la bulle : identité (titre éditable + couleur + dates),
// Description, Actions (to-do + progression), Notes libres — sections
// remplies « dans le mémo », vides discrètes. Suppression de la bulle.
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

// Nuancier catégoriel Keystone (zones/bulles).
const KN_COLORS = ['#6366f1', '#a78bfa', '#22d3ee', '#14b8a6', '#22c55e', '#fcd34d', '#f97316', '#f472b6', '#e05c5c', '#94a3b8'];

const FIT_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

let _root = null;
let _state = { zones: [], bubbles: [], links: [] };
let _engine = null;
let _loading = false;
let _error = null;
let _panel = null;      // { id, detail:{bubble,todos,notes}, loading, error }
let _panelEl = null;

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
  _closePanel();
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
  _root.addEventListener('change', _onChange);
  try { bindRatingButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindHelpButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindBurger(_root); } catch (_) {}
}

// ── Délégation des actions ──────────────────────────────────────
function _onClick(e) {
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
  // Panneau (Sprint 2)
  if (act === 'kyn-panel-close') { _closePanel(); return; }
  if (act === 'kyn-color')       { _patchBubble({ color: el.dataset.color }); return; }
  if (act === 'kyn-todo-toggle') { _toggleTodo(el.dataset.id); return; }
  if (act === 'kyn-todo-del')    { _delTodo(el.dataset.id); return; }
  if (act === 'kyn-todo-add')    { _addTodo(); return; }
  if (act === 'kyn-note-add')    { _addNote(); return; }
  if (act === 'kyn-note-del')    { _delNote(el.dataset.id); return; }
  if (act === 'kyn-bubble-del')  { _confirmDeleteBubble(el); return; }
}
function _onChange(e) {
  const f = e.target && e.target.dataset && e.target.dataset.field;
  if (!f || !_panel || !_panel.detail) return;
  if (f === 'title') { const v = e.target.value.trim(); if (v) _patchBubble({ title: v }); }
  else if (f === 'desc') { _patchBubble({ description: e.target.value }); }
}
function _onKey(e) {
  if (e.key === 'Enter' && e.target && e.target.id === 'kyn-new-title') { e.preventDefault(); _submitComposer(); return; }
  if (e.key === 'Enter' && e.target && e.target.dataset && e.target.dataset.field === 'todo-add') { e.preventDefault(); _addTodo(); return; }
  if (e.key === 'Escape') {
    if (_root && _root.querySelector('.kyn-composer')) { _closeComposer(); return; }
    if (_panel) { _closePanel(); return; }
    closeKeynapse();
  }
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

// ── Rendu du canevas ────────────────────────────────────────────
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

// Drag lâché → persiste la nouvelle position.
async function _persistMove(id, x, y) {
  const b = _state.bubbles.find((bb) => bb.id === id);
  if (b) { b.x = x; b.y = y; }
  try { await _api(`/bubbles/${encodeURIComponent(id)}`, { method: 'PATCH', body: { x, y } }); } catch (_) {}
}

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

// ════════════════════════════════════════════════════════════════
// Sprint 2 — panneau latéral de la fiche
// ════════════════════════════════════════════════════════════════
function _onBubbleClick(node) { if (node && node.id) _openPanel(node.id); }

async function _openPanel(id) {
  _panel = { id, detail: null, loading: true, error: null };
  _ensurePanelEl();
  _renderPanel();
  try {
    const r = await _api(`/bubbles/${encodeURIComponent(id)}`);
    if (!_panel || _panel.id !== id) return;          // fermé/changé entre-temps
    _panel.detail = { bubble: r.bubble, todos: r.todos || [], notes: r.notes || [] };
    _panel.loading = false;
    _renderPanel();
  } catch (e) {
    if (_panel && _panel.id === id) { _panel.error = e.message || 'Chargement impossible.'; _panel.loading = false; _renderPanel(); }
  }
}
function _ensurePanelEl() {
  const wrap = _canvas(); if (!wrap) return;
  let el = wrap.querySelector('.kyn-panel');
  if (!el) { el = document.createElement('aside'); el.className = 'kyn-panel'; wrap.appendChild(el); }
  _panelEl = el;
}
function _closePanel() {
  _panel = null;
  if (_panelEl) { _panelEl.remove(); _panelEl = null; }
}
function _renderPanel() {
  if (!_panelEl || !_panel) return;
  if (_panel.loading) { _panelEl.innerHTML = `<div class="kyn-state"><div class="kyn-spin"></div></div>`; return; }
  if (_panel.error) {
    _panelEl.innerHTML = `<div class="kyn-panel-head"><button class="kyn-panel-x" data-act="kyn-panel-close" aria-label="Fermer">×</button></div><div class="kyn-state"><p class="kyn-err">${_esc(_panel.error)}</p></div>`;
    return;
  }
  const b = _panel.detail.bubble;
  const accent = b.color || '#6366f1';
  _panelEl.style.setProperty('--kyn-accent', accent);
  _panelEl.innerHTML = `
    <div class="kyn-panel-head">
      <span class="kyn-panel-accent"></span>
      <button class="kyn-panel-x" data-act="kyn-panel-close" aria-label="Fermer">×</button>
      <div class="kyn-panel-id">
        <span class="kyn-panel-ico">${icon('keynapse', 18)}</span>
        <input class="kyn-panel-title" data-field="title" value="${_escAttr(b.title)}" maxlength="200" aria-label="Titre de la bulle">
      </div>
      <div class="kyn-panel-dates">Créé le ${_fmtDate(b.created_at)} · modifié le ${_fmtDate(b.updated_at)}</div>
      <div class="kyn-swatches">
        ${KN_COLORS.map((c) => `<button class="kyn-swatch" data-act="kyn-color" data-color="${c}" style="background:${c}" aria-label="Couleur" aria-pressed="${c === accent}"></button>`).join('')}
      </div>
    </div>
    <div class="kyn-panel-body">${_panelBodyHTML()}</div>
    <div class="kyn-panel-foot">
      <button class="kyn-del-bubble" data-act="kyn-bubble-del">Supprimer cette bulle</button>
    </div>`;
}
function _panelBodyHTML() {
  const d = _panel.detail;
  const todos = d.todos, done = todos.filter((t) => t.done).length;
  const pct = todos.length ? Math.round(done / todos.length * 100) : 0;
  return `
    <div class="kyn-sec">
      <p class="kyn-sec-h">Description</p>
      <textarea class="kyn-desc" data-field="desc" placeholder="Résumé du sujet…">${_esc(d.bubble.description || '')}</textarea>
    </div>
    <div class="kyn-sec">
      <p class="kyn-sec-h">Actions${todos.length ? ` · ${done}/${todos.length}` : ''}</p>
      ${todos.length ? `<div class="kyn-prog"><div class="kyn-prog-fill" style="width:${pct}%"></div></div>` : ''}
      ${todos.map((t) => `
        <div class="kyn-todo" data-done="${t.done ? 1 : 0}">
          <button class="kyn-check" data-act="kyn-todo-toggle" data-id="${t.id}" aria-checked="${!!t.done}" aria-label="Cocher la tâche">${t.done ? (icon('check', 12) || '✓') : ''}</button>
          <span class="kyn-todo-lbl">${_esc(t.label)}</span>
          <button class="kyn-row-del" data-act="kyn-todo-del" data-id="${t.id}" aria-label="Supprimer la tâche">×</button>
        </div>`).join('')}
      <div class="kyn-add">
        <input data-field="todo-add" type="text" maxlength="500" placeholder="Ajouter une tâche…" autocomplete="off">
        <button class="kyn-add-btn" data-act="kyn-todo-add" aria-label="Ajouter la tâche">+</button>
      </div>
    </div>
    <div class="kyn-sec">
      <p class="kyn-sec-h">Notes libres</p>
      ${d.notes.map((n) => `
        <div class="kyn-note">
          <div style="flex:1;min-width:0">
            <div class="kyn-note-body">${_esc(n.body)}</div>
            <div class="kyn-note-date">${_fmtDate(n.created_at)}</div>
          </div>
          <button class="kyn-row-del" data-act="kyn-note-del" data-id="${n.id}" aria-label="Supprimer la note">×</button>
        </div>`).join('')}
      <div class="kyn-add">
        <textarea data-field="note-add" rows="2" maxlength="4000" placeholder="Ajouter une note…"></textarea>
        <button class="kyn-add-btn" data-act="kyn-note-add" aria-label="Ajouter la note">+</button>
      </div>
    </div>`;
}
function _refreshBody() {
  if (!_panelEl || !_panel || !_panel.detail) return;
  const body = _panelEl.querySelector('.kyn-panel-body');
  if (body) body.innerHTML = _panelBodyHTML();
}

// PATCH bulle (titre/description/couleur) — optimiste + reflet sur la carte.
async function _patchBubble(patch) {
  if (!_panel || !_panel.detail) return;
  const id = _panel.id;
  Object.assign(_panel.detail.bubble, patch);
  const sb = _state.bubbles.find((x) => x.id === id); if (sb) Object.assign(sb, patch);
  if (patch.color || typeof patch.title === 'string') _engine && _engine.updateNode(id, patch);
  if (patch.color && _panelEl) {
    _panelEl.style.setProperty('--kyn-accent', patch.color);
    _panelEl.querySelectorAll('.kyn-swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.color === patch.color)));
  }
  try { await _api(`/bubbles/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }); } catch (_) {}
}

async function _addTodo() {
  const inp = _panelEl && _panelEl.querySelector('[data-field="todo-add"]');
  if (!inp) return;
  const label = inp.value.trim(); if (!label) return;
  inp.value = '';
  try {
    const r = await _api(`/bubbles/${encodeURIComponent(_panel.id)}/todos`, { method: 'POST', body: { label } });
    _panel.detail.todos.push(r.todo); _refreshBody();
    const ni = _panelEl.querySelector('[data-field="todo-add"]'); if (ni) ni.focus();
  } catch (_) {}
}
async function _toggleTodo(id) {
  const t = _panel.detail.todos.find((x) => x.id === id); if (!t) return;
  t.done = t.done ? 0 : 1; _refreshBody();
  try { await _api(`/todos/${encodeURIComponent(id)}`, { method: 'PATCH', body: { done: !!t.done } }); } catch (_) {}
}
async function _delTodo(id) {
  _panel.detail.todos = _panel.detail.todos.filter((x) => x.id !== id); _refreshBody();
  try { await _api(`/todos/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
}
async function _addNote() {
  const ta = _panelEl && _panelEl.querySelector('[data-field="note-add"]');
  if (!ta) return;
  const text = ta.value.trim(); if (!text) return;
  ta.value = '';
  try {
    const r = await _api(`/bubbles/${encodeURIComponent(_panel.id)}/notes`, { method: 'POST', body: { body: text } });
    _panel.detail.notes.unshift(r.note); _refreshBody();
  } catch (_) {}
}
async function _delNote(id) {
  _panel.detail.notes = _panel.detail.notes.filter((x) => x.id !== id); _refreshBody();
  try { await _api(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
}

function _confirmDeleteBubble(btn) {
  if (btn.dataset.confirm === '1') { _deleteBubble(); return; }
  btn.dataset.confirm = '1';
  btn.textContent = 'Confirmer la suppression ?';
  setTimeout(() => { if (btn && btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = 'Supprimer cette bulle'; } }, 4000);
}
async function _deleteBubble() {
  if (!_panel) return;
  const id = _panel.id;
  _closePanel();
  _state.bubbles = _state.bubbles.filter((b) => b.id !== id);
  _state.links = _state.links.filter((l) => l.from_bubble !== id && l.to_bubble !== id);
  if (!_state.bubbles.length) { _teardownEngine(); _render(); }
  else if (_engine) _engine.setData(_state.bubbles, _state.links);
  try { await _api(`/bubbles/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
}

// ── Utils ───────────────────────────────────────────────────────
function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _escAttr(s) { return _esc(s).replace(/"/g, '&quot;'); }
function _fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(String(iso).replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
  catch (_) { return '—'; }
}
