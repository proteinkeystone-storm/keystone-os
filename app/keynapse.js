// ═══════════════════════════════════════════════════════════════
// KEYNAPSE — Pad O-Keyn-001 · KN-7 (Sprint 7 : rappels & notifications)
//
// Constellation vivante (moteur lib/keynapse-engine.js) + fiche latérale
// (S2) + ZONES (S3) + liens (S4) + captures média (S5) + MÉMOS VOCAUX (S6)
// + RAPPELS (S7) : date/heure/répétition dans la fiche + notifications
// LOCALES (poller → notif OS via SW si supportée + bandeau in-app fiable
// partout, indicateur « à venir »). La couleur d'une bulle est héritée de
// sa zone ; zoom sémantique (loin = zones, près = détail) géré par le moteur.
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
const DEFAULT_COLOR = '#6366f1';
const KN_COLORS = ['#6366f1', '#a78bfa', '#22d3ee', '#14b8a6', '#22c55e', '#fcd34d', '#f97316', '#f472b6', '#e05c5c', '#94a3b8'];

const FIT_ICON    = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
const LAYERS_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
const LOCATE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>';
// Sélecteur d'animation (mal de mer) : ondes = animée ; ligne plate = figée.
const MOTION_ON_ICON  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2.5-4.5 5.5-4.5 8 0s5.5 4.5 8 0"/></svg>';
const MOTION_OFF_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/></svg>';

let _root = null;
let _state = { zones: [], bubbles: [], links: [] };
let _engine = null;
let _loading = false;
let _error = null;
let _panel = null;       // fiche : { id, detail, loading, error }
let _panelEl = null;
let _zonesEl = null;     // panneau Zones
let _recolorZone = null; // id de la zone dont on édite la couleur (palette inline)

// ── API ─────────────────────────────────────────────────────────
function _jwt() { return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || ''; }
async function _api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(`${API_BASE}/api/keynapse${path}`, {
      method: opts.method || 'GET',
      headers: { 'Authorization': `Bearer ${_jwt()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw (e && e.name === 'AbortError') ? new Error('Le serveur met trop de temps à répondre — réessayez.') : e;
  }
  clearTimeout(timer);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { const e = new Error(data.error || `Erreur ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// ── Zones : helpers ─────────────────────────────────────────────
function _zoneById(id) { return _state.zones.find((z) => z.id === id) || null; }
function _effColor(b) { const z = b.zone_id ? _zoneById(b.zone_id) : null; return z ? z.color : (b.color || DEFAULT_COLOR); }
function _engineBubbles() { return _state.bubbles.map((b) => ({ ...b, color: _effColor(b) })); }
function _pushEngine() { if (_engine) _engine.setData(_engineBubbles(), _state.links, _state.zones); }
function _nextZoneColor() {
  const used = new Set(_state.zones.map((z) => z.color));
  return KN_COLORS.find((c) => !used.has(c)) || KN_COLORS[_state.zones.length % KN_COLORS.length];
}

// ── Ouverture / fermeture ───────────────────────────────────────
export function openKeynapse(opts = {}) {
  if (_root) return;
  _buildShell();
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _onKey);
  _bindSWMessages();           // clic notif → ouvrir la bulle
  _startReminderPoll();        // notifications locales (S7)
  _load();
}
export function closeKeynapse() {
  if (!_root) return;
  _stopReminderPoll(); _unbindSWMessages();
  _closePanel(); _closeZonesPanel(); _teardownEngine();
  document.removeEventListener('keydown', _onKey);
  _root.remove(); _root = null;
  document.body.style.overflow = '';
}

// ── Coquille workspace ──────────────────────────────────────────
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
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour">${icon('chevron-left', 34)}</button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('keynapse', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        <button class="ws-iconbtn kyn-motion-btn" data-act="kyn-motion-toggle" aria-label="Activer ou figer l'animation des bulles"></button>
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main kyn-main" data-slot="main"><div class="kyn-canvas-wrap" data-slot="canvas"></div></main>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('change', _onChange);
  try { bindRatingButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindHelpButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindBurger(_root); } catch (_) {}
  _updateMotionBtn();
}

// ── Délégation ──────────────────────────────────────────────────
function _onClick(e) {
  _primeAudio();   // 1er geste → débloque la sonnerie des rappels
  if (e.target.classList && e.target.classList.contains('kyn-composer')) { _closeComposer(); return; }
  if (e.target.classList && e.target.classList.contains('kyn-lightbox')) { _closeLightbox(); return; }
  // Molette (heure du rappel) : clic sur un cran → on le centre.
  const wItem = e.target.closest('.kyn-wheel-item');
  if (wItem) {
    const w = wItem.closest('.kyn-wheel');
    if (w) w.scrollTo({ top: (Number(wItem.dataset.idx) || 0) * wItem.offsetHeight, behavior: 'smooth' });
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'close':         return closeKeynapse();
    case 'kyn-retry':     return _load();
    case 'kyn-compose':   return _openComposer();
    case 'kyn-cancel':    return _closeComposer();
    case 'kyn-create':    return _submitComposer();
    case 'kyn-zoom-in':   return _engine && _engine.zoomBy(1.25);
    case 'kyn-zoom-out':  return _engine && _engine.zoomBy(0.8);
    case 'kyn-fit':       return _engine && _engine.fitAll();
    case 'kyn-motion-toggle': return _toggleMotion();
    // Fiche
    case 'kyn-panel-close': return _closePanel();
    case 'kyn-color':       return _patchBubble({ color: el.dataset.color });
    case 'kyn-todo-toggle': return _toggleTodo(el.dataset.id);
    case 'kyn-todo-del':    return _delTodo(el.dataset.id);
    case 'kyn-todo-add':    return _addTodo();
    case 'kyn-note-add':    return _addNote();
    case 'kyn-note-del':    return _delNote(el.dataset.id);
    case 'kyn-bubble-del':  return _confirmDeleteBubble(el);
    case 'kyn-bubble-zone': return _assignZone(el.dataset.id || null);
    case 'kyn-link-add':    return _addLink();
    case 'kyn-link-del':    return _delLink(el.dataset.id);
    case 'kyn-link-go':     return _goLink(el.dataset.id);
    case 'kyn-photo-add':   return _pickPhoto();
    case 'kyn-draw-add':    return _openDraw();
    case 'kyn-media-open':  return _openLightbox(el.dataset.id);
    case 'kyn-media-del':   return _delMedia(el.dataset.id);
    case 'kyn-lightbox-close': return _closeLightbox();
    case 'kyn-lightbox-prev':  return _lightboxStep(-1);
    case 'kyn-lightbox-next':  return _lightboxStep(1);
    case 'kyn-draw-color':  return _drawSetColor(el.dataset.color);
    case 'kyn-draw-clear':  return _drawClear();
    case 'kyn-draw-cancel': return _closeDraw();
    case 'kyn-draw-save':   return _drawSave();
    // Mémos vocaux (Sprint 6)
    case 'kyn-voice-add':    return _openVoiceRecorder();
    case 'kyn-voice-stop':   return _stopVoiceRecorder(true);
    case 'kyn-voice-cancel': return _stopVoiceRecorder(false);
    case 'kyn-voice-del':    return _delVoice(el.dataset.id);
    case 'kyn-prop-add':     return _addProposals();
    case 'kyn-prop-skip':    return _skipProposals();
    case 'kyn-voice-dismiss': return _clearVoiceMsg();
    // Rappels (Sprint 7)
    case 'kyn-rem-add':      return _addReminder();
    case 'kyn-rem-del':      return _delReminder(el.dataset.id);
    case 'kyn-time-open':    if (_panel) { _panel.remOpen = true; _refreshBody(); } return;
    case 'kyn-time-ok':      return _confirmRemTime();
    case 'kyn-notif-enable': return _enableNotifs();
    case 'kyn-toast-open':   _openPanel(el.dataset.id); { const tw = el.closest('.kyn-toast'); if (tw) tw.remove(); } return;
    case 'kyn-toast-close':  { const tw = el.closest('.kyn-toast'); if (tw) tw.remove(); } return;
    // Zones
    case 'kyn-zones-open':  return _openZonesPanel();
    case 'kyn-zones-close': return _closeZonesPanel();
    case 'kyn-zone-create': return _createZone();
    case 'kyn-zone-fly':    return _flyToZone(el.dataset.id);
    case 'kyn-zone-del':    return _deleteZone(el.dataset.id);
    case 'kyn-zone-recolor': _recolorZone = (_recolorZone === el.dataset.id ? null : el.dataset.id); return _renderZonesPanel();
    case 'kyn-zone-setcolor': return _setZoneColor(el.dataset.id, el.dataset.color);
  }
}
function _onChange(e) {
  const t = e.target, f = t && t.dataset && t.dataset.field;
  if (!f) return;
  if (f === 'title' && _panel && _panel.detail) { const v = t.value.trim(); if (v) _patchBubble({ title: v }); }
  else if (f === 'desc' && _panel && _panel.detail) { _patchBubble({ description: t.value }); }
  else if (f === 'zonename' && t.dataset.id) { const v = t.value.trim(); if (v) _renameZone(t.dataset.id, v); }
  else if (f === 'rem-rep-edit' && t.dataset.id) { _patchReminder(t.dataset.id, { repeat: t.value }); }
}
function _onKey(e) {
  if (e.key === 'Enter' && e.target) {
    if (e.target.id === 'kyn-new-title') { e.preventDefault(); return _submitComposer(); }
    if (e.target.dataset && e.target.dataset.field === 'todo-add') { e.preventDefault(); return _addTodo(); }
    if (e.target.dataset && e.target.dataset.field === 'newzone') { e.preventDefault(); return _createZone(); }
  }
  if (_lightbox && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return _lightboxStep(e.key === 'ArrowLeft' ? -1 : 1); }
  if (e.key === 'Escape') {
    if (_rec) return _stopVoiceRecorder(false);
    if (_lightbox) return _closeLightbox();
    if (_draw) return _closeDraw();
    if (_root && _root.querySelector('.kyn-composer')) return _closeComposer();
    if (_panel) return _closePanel();
    if (_zonesEl) return _closeZonesPanel();
    closeKeynapse();
  }
}

// ── Chargement ──────────────────────────────────────────────────
async function _load() {
  _loading = true; _error = null; _render();
  try {
    const r = await _api('/state');
    _state = { zones: r.zones || [], bubbles: r.bubbles || [], links: r.links || [] };
  } catch (e) { _error = e.message || 'Chargement impossible.'; }
  finally { _loading = false; _render(); }
}

// ── Rendu canevas ───────────────────────────────────────────────
function _canvas() { return _root && _root.querySelector('[data-slot="canvas"]'); }
function _teardownEngine() { if (_engine) { _engine.destroy(); _engine = null; } }
function _render() {
  const c = _canvas(); if (!c) return;
  if (_loading) { _teardownEngine(); c.innerHTML = `<div class="kyn-state"><div class="kyn-spin"></div><p>Chargement de votre constellation…</p></div>`; return; }
  if (_error) { _teardownEngine(); c.innerHTML = `<div class="kyn-state"><p class="kyn-err">${_esc(_error)}</p><button class="kyn-btn" data-act="kyn-retry">Réessayer</button></div>`; return; }
  if (!_state.bubbles.length) { _teardownEngine(); c.innerHTML = _emptyHTML(); _focusComposer(); return; }
  const _freshEngine = !_engine;
  if (_freshEngine) {
    c.innerHTML = `
      <div class="kyn-stage" data-slot="stage"></div>
      <div class="kyn-toolbar">
        <button class="kyn-tool" data-act="kyn-zones-open" title="Zones" aria-label="Zones">${LAYERS_ICON}</button>
        <span class="kyn-tool-sep"></span>
        <button class="kyn-tool" data-act="kyn-zoom-out" title="Dézoomer" aria-label="Dézoomer">−</button>
        <button class="kyn-tool" data-act="kyn-fit" title="Tout voir" aria-label="Tout voir">${FIT_ICON}</button>
        <button class="kyn-tool" data-act="kyn-zoom-in" title="Zoomer" aria-label="Zoomer">+</button>
      </div>
      <button class="kyn-fab" data-act="kyn-compose" title="Nouvelle bulle" aria-label="Nouvelle bulle">${icon('plus', 24) || '+'}</button>`;
    const stage = c.querySelector('[data-slot="stage"]');
    _engine = createConstellation({ container: stage, onBubbleMoved: _persistMove, onBubbleClick: _onBubbleClick, motion: _motionOn() });
  }
  _pushEngine();
  // Au tout premier rendu, cadrer l'ensemble de la constellation. Sans ça, la vue
  // reste à l'origine (zoom 1, centrée sur 0,0) et toutes les bulles posées au-delà
  // du viewport tombent hors champ — d'où l'empilement au centre au démarrage.
  if (_freshEngine) _engine.fitAll();
}
async function _persistMove(id, x, y) {
  const b = _state.bubbles.find((bb) => bb.id === id);
  if (b) { b.x = x; b.y = y; }
  try { await _api(`/bubbles/${encodeURIComponent(id)}`, { method: 'PATCH', body: { x, y } }); } catch (_) {}
}

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

// ── Composer (nouvelle bulle) ───────────────────────────────────
function _openComposer() {
  const wrap = _canvas(); if (!wrap || wrap.querySelector('.kyn-composer')) return;
  const div = document.createElement('div'); div.className = 'kyn-composer';
  div.innerHTML = `
    <div class="kyn-composer-card">
      <h3>Nouvelle bulle</h3>
      <input id="kyn-new-title" class="kyn-input" type="text" maxlength="200" placeholder="Titre de la bulle" autocomplete="off" style="width:100%">
      <div class="kyn-composer-actions">
        <button class="kyn-btn" data-act="kyn-cancel">Annuler</button>
        <button class="kyn-btn kyn-btn--accent" data-act="kyn-create">Créer</button>
      </div>
    </div>`;
  wrap.appendChild(div); _focusComposer();
}
function _closeComposer() { const o = _root && _root.querySelector('.kyn-composer'); if (o) o.remove(); }
function _focusComposer() { setTimeout(() => { const i = _root && _root.querySelector('#kyn-new-title'); if (i) i.focus(); }, 40); }
async function _submitComposer() {
  const input = _root && _root.querySelector('#kyn-new-title'); if (!input) return;
  const title = input.value.trim(); if (!title) { input.focus(); return; }
  input.disabled = true;
  try { await _api('/bubbles', { method: 'POST', body: { title } }); _closeComposer(); await _load(); }
  catch (e) { _error = e.message || 'Création impossible.'; _render(); }
}

// ════════════════════════════════════════════════════════════════
// Fiche latérale (Sprint 2) + sélecteur de zone (Sprint 3)
// ════════════════════════════════════════════════════════════════
function _onBubbleClick(node) { if (node && node.id) _openPanel(node.id); }
async function _openPanel(id) {
  _panel = { id, detail: null, loading: true, error: null, voice: { busy: '', props: null, note: '', error: '' }, remTime: null, remOpen: false };
  _ensurePanelEl(); _renderPanel();
  try {
    const r = await _api(`/bubbles/${encodeURIComponent(id)}`);
    if (!_panel || _panel.id !== id) return;
    // Charge TOUTES les sections persistées (le worker renvoie aussi links/
    // media/audios — non hydratés jusqu'ici, d'où des liens/captures absents
    // en rouvrant une bulle ; corrigé au Sprint 6 pour recharger les mémos).
    _panel.detail = {
      bubble: r.bubble, todos: r.todos || [], notes: r.notes || [],
      links: r.links || [], media: r.media || [], audios: r.audios || [],
      reminders: r.reminders || [],
    };
    _panel.loading = false; _renderPanel();
  } catch (e) { if (_panel && _panel.id === id) { _panel.error = e.message || 'Chargement impossible.'; _panel.loading = false; _renderPanel(); } }
}
function _ensurePanelEl() {
  const wrap = _canvas(); if (!wrap) return;
  let el = wrap.querySelector('.kyn-panel');
  if (!el) { el = document.createElement('aside'); el.className = 'kyn-panel'; wrap.appendChild(el); }
  _panelEl = el;
}
function _closePanel() {
  _closeLightbox(); _closeDraw(); _teardownRec();
  for (const u of _mediaUrls.values()) { try { URL.revokeObjectURL(u); } catch (_) {} }
  _mediaUrls.clear();
  _panel = null;
  if (_panelEl) { _panelEl.remove(); _panelEl = null; }
}
function _renderPanel() {
  if (!_panelEl || !_panel) return;
  if (_panel.loading) { _panelEl.innerHTML = `<div class="kyn-state"><div class="kyn-spin"></div></div>`; return; }
  if (_panel.error) { _panelEl.innerHTML = `<div class="kyn-panel-head"><button class="kyn-panel-x" data-act="kyn-panel-close" aria-label="Fermer">×</button></div><div class="kyn-state"><p class="kyn-err">${_esc(_panel.error)}</p></div>`; return; }
  const b = _panel.detail.bubble;
  const accent = _effColor(b);
  const zoned = !!b.zone_id;
  _panelEl.style.setProperty('--kyn-accent', accent);
  const zoneChips = `
    <div class="kyn-zonepick">
      <button class="kyn-zchip ${!zoned ? 'is-on' : ''}" data-act="kyn-bubble-zone" data-id="">Aucune</button>
      ${_state.zones.map((z) => `<button class="kyn-zchip ${b.zone_id === z.id ? 'is-on' : ''}" data-act="kyn-bubble-zone" data-id="${z.id}"><span class="kyn-zchip-dot" style="background:${z.color}"></span>${_esc(z.name)}</button>`).join('')}
    </div>`;
  // Bulle rattachée à une zone : couleur héritée → aucun contrôle ici (note
  // retirée pour coller à la maquette). Bulle libre : pastilles de couleur.
  const colorBlock = zoned
    ? ''
    : `<div class="kyn-swatches">${KN_COLORS.map((c) => `<button class="kyn-swatch" data-act="kyn-color" data-color="${c}" style="background:${c}" aria-label="Couleur" aria-pressed="${c === accent}"></button>`).join('')}</div>`;
  _panelEl.innerHTML = `
    <div class="kyn-panel-head">
      <span class="kyn-panel-accent"></span>
      <button class="kyn-panel-x" data-act="kyn-panel-close" aria-label="Fermer">×</button>
      <div class="kyn-panel-id">
        <span class="kyn-panel-ico">${icon('keynapse', 18)}</span>
        <input class="kyn-panel-title" data-field="title" value="${_escAttr(b.title)}" maxlength="200" aria-label="Titre de la bulle">
      </div>
      <div class="kyn-panel-dates">Créé le ${_fmtDate(b.created_at)} · modifié le ${_fmtDate(b.updated_at)}</div>
      <p class="kyn-sec-h" style="margin-top:14px">Zone</p>
      ${zoneChips}
      ${colorBlock}
    </div>
    <div class="kyn-panel-body">${_panelBodyHTML()}</div>
    <div class="kyn-panel-foot"><button class="kyn-del-bubble" data-act="kyn-bubble-del">Supprimer cette bulle</button></div>`;
  _hydrateMedia();
  _calibrateRemWheels();
}
function _panelBodyHTML() {
  const d = _panel.detail;
  const todos = d.todos, done = todos.filter((t) => t.done).length;
  const pct = todos.length ? Math.round(done / todos.length * 100) : 0;
  return `
    <div class="kyn-sec kyn-sec--notes">
      <p class="kyn-sec-h">Notes libres</p>
      ${d.notes.map((n) => `
        <div class="kyn-note">
          <div style="flex:1;min-width:0"><div class="kyn-note-body">${_esc(n.body)}</div><div class="kyn-note-date">${_fmtDate(n.created_at)}</div></div>
          <button class="kyn-row-del" data-act="kyn-note-del" data-id="${n.id}" aria-label="Supprimer la note">×</button>
        </div>`).join('')}
      <div class="kyn-add">
        <textarea data-field="note-add" maxlength="4000" placeholder="Ajouter une note…"></textarea>
        <button class="kyn-add-btn" data-act="kyn-note-add" aria-label="Ajouter la note">+</button>
      </div>
    </div>
    ${_capturesSectionHTML()}
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
    ${_remindersSectionHTML()}
    ${_linksSectionHTML()}`;
}
// ── Liens (Sprint 4 : tisser + naviguer) ────────────────────────
function _linksSectionHTML() {
  const d = _panel.detail, id = _panel.id;
  const linked = (d.links || []).map((l) => {
    const otherId = l.from_bubble === id ? l.to_bubble : l.from_bubble;
    const b = _state.bubbles.find((x) => x.id === otherId);
    return b ? { linkId: l.id, id: otherId, title: b.title, color: _effColor(b) } : null;
  }).filter(Boolean);
  const linkedIds = new Set(linked.map((x) => x.id));
  const candidates = _state.bubbles.filter((b) => b.id !== id && !linkedIds.has(b.id));
  return `
    <div class="kyn-sec">
      <p class="kyn-sec-h">Liens${linked.length ? ` · ${linked.length}` : ''}</p>
      ${linked.map((x) => `
        <div class="kyn-linkrow">
          <button class="kyn-linkgo" data-act="kyn-link-go" data-id="${x.id}"><span class="kyn-zchip-dot" style="background:${_escAttr(x.color)}"></span>${_esc(x.title)}</button>
          <button class="kyn-row-del" data-act="kyn-link-del" data-id="${x.linkId}" aria-label="Retirer le lien">×</button>
        </div>`).join('')}
      ${candidates.length ? `
      <div class="kyn-add">
        <select data-field="link-target" class="kyn-link-select"><option value="" disabled selected>Relier à…</option>${candidates.map((b) => `<option value="${_escAttr(b.id)}">${_esc(b.title)}</option>`).join('')}</select>
        <button class="kyn-add-btn" data-act="kyn-link-add" aria-label="Tisser le lien">+</button>
      </div>` : (linked.length ? '' : `<p class="kyn-color-note">Crée d'autres bulles pour pouvoir les relier.</p>`)}
    </div>`;
}
async function _addLink() {
  const sel = _panelEl && _panelEl.querySelector('[data-field="link-target"]'); if (!sel) return;
  const to = sel.value; if (!to) return;
  try {
    const r = await _api(`/bubbles/${encodeURIComponent(_panel.id)}/links`, { method: 'POST', body: { to_bubble: to } });
    if (r.link) {
      if (!_state.links.some((l) => l.id === r.link.id)) _state.links.push(r.link);
      _panel.detail.links = _panel.detail.links || [];
      if (!_panel.detail.links.some((l) => l.id === r.link.id)) _panel.detail.links.push(r.link);
    }
    _refreshBody(); _pushEngine();
  } catch (_) {}
}
async function _delLink(linkId) {
  _state.links = _state.links.filter((l) => l.id !== linkId);
  if (_panel && _panel.detail) _panel.detail.links = (_panel.detail.links || []).filter((l) => l.id !== linkId);
  _refreshBody(); _pushEngine();
  try { await _api(`/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' }); } catch (_) {}
}
function _goLink(otherId) {
  if (_engine) _engine.revealBubble(otherId);
  _openPanel(otherId);
}

// ════════════════════════════════════════════════════════════════
// Sprint 5 — captures média (photo / croquis) + lightbox plein écran
// Images servies UNIQUEMENT au propriétaire (gate JWT) → on les récupère en
// blob authentifié (jamais en URL publique : ce sont des notes perso).
// ════════════════════════════════════════════════════════════════
const _mediaUrls = new Map();   // mediaId → objectURL (blob mis en cache)
let _lightbox = null;           // { ids:[…], i }
let _draw = null;               // modale de dessin

const PENCIL_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const IMAGE_ICON  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

function _capturesSectionHTML() {
  const media = _panel.detail.media || [];
  const audios = _panel.detail.audios || [];
  const n = media.length + audios.length;
  return `
    <div class="kyn-sec">
      <p class="kyn-sec-h">Captures${n ? ` · ${n}` : ''}</p>
      <div class="kyn-caps">
        ${media.map((m) => `
          <div class="kyn-cap">
            <button class="kyn-cap-btn" data-act="kyn-media-open" data-id="${m.id}" aria-label="Voir la capture en grand"><img data-media-id="${m.id}" alt=""></button>
            <button class="kyn-cap-del" data-act="kyn-media-del" data-id="${m.id}" aria-label="Supprimer la capture">×</button>
          </div>`).join('')}
        <button class="kyn-cap-add" data-act="kyn-photo-add" aria-label="Ajouter une photo">${IMAGE_ICON}<span>Photo</span></button>
        <button class="kyn-cap-add" data-act="kyn-draw-add" aria-label="Dessiner un croquis">${PENCIL_ICON}<span>Croquis</span></button>
        <button class="kyn-cap-add" data-act="kyn-voice-add" aria-label="Enregistrer une note vocale">${icon('mic', 15) || ''}<span>Vocal</span></button>
      </div>
      ${_audiosListHTML()}
      ${_voiceUIHTML()}
    </div>`;
}

// Liste des mémos vocaux : lecteur (blob authentifié) + transcript visible.
function _audiosListHTML() {
  const audios = _panel.detail.audios || [];
  if (!audios.length) return '';
  return `<div class="kyn-audios">${audios.map((a) => `
    <div class="kyn-audio">
      <div class="kyn-audio-head">
        <span class="kyn-audio-ico" aria-hidden="true">${icon('mic', 13) || ''}</span>
        <audio class="kyn-audio-player" data-audio-id="${_escAttr(a.id)}" controls preload="none"></audio>
        <button class="kyn-row-del kyn-audio-del" data-act="kyn-voice-del" data-id="${_escAttr(a.id)}" aria-label="Supprimer le mémo vocal">×</button>
      </div>
      ${a.transcript ? `<p class="kyn-audio-tr">${_esc(a.transcript)}</p>` : `<p class="kyn-audio-tr is-empty">Transcription indisponible.</p>`}
    </div>`).join('')}</div>`;
}

// État voix transitoire (occupé / propositions à valider / message) — vit sur
// _panel.voice, survit aux _refreshBody, jeté à la fermeture de la fiche.
function _voiceUIHTML() {
  const v = (_panel && _panel.voice) || {};
  let html = '';
  if (v.busy) html += `<div class="kyn-voicebusy"><span class="kyn-spin kyn-spin--sm"></span><span>${_esc(v.busy)}</span></div>`;
  const p = v.props;
  if (p && (p.tasks.length || p.reminders.length)) {
    const tasks = p.tasks.map((t, i) => `
      <label class="kyn-prop-row">
        <input type="checkbox" class="kyn-prop-check" data-prop="task" data-i="${i}"${t.on ? ' checked' : ''}>
        <span class="kyn-prop-lbl">${_esc(t.label)}</span>
      </label>`).join('');
    const reminders = p.reminders.map((r, i) => `
      <div class="kyn-prop-row kyn-prop-rem">
        <label class="kyn-prop-remmain">
          <input type="checkbox" class="kyn-prop-check" data-prop="rem" data-i="${i}"${r.on ? ' checked' : ''}>
          <span class="kyn-prop-lbl">${_esc(r.label || 'Rappel')}</span>
        </label>
        <input type="datetime-local" class="kyn-prop-at" data-i="${i}" value="${_escAttr(r.at || '')}" aria-label="Date et heure du rappel">
      </div>`).join('');
    html += `
      <div class="kyn-props">
        <p class="kyn-props-h">${icon('check', 13) || ''}<span>Détecté dans le mémo — à valider</span></p>
        ${p.tasks.length ? `<p class="kyn-props-sub">Tâches</p>${tasks}` : ''}
        ${p.reminders.length ? `<p class="kyn-props-sub">Rappels</p>${reminders}` : ''}
        <div class="kyn-props-foot">
          <button class="kyn-btn" data-act="kyn-prop-skip">Ignorer</button>
          <button class="kyn-btn kyn-btn--accent" data-act="kyn-prop-add">Ajouter</button>
        </div>
      </div>`;
  }
  if (v.error)     html += `<div class="kyn-voicemsg is-err"><span>${_esc(v.error)}</span><button class="kyn-voicemsg-x" data-act="kyn-voice-dismiss" aria-label="Fermer">×</button></div>`;
  else if (v.note) html += `<div class="kyn-voicemsg"><span>${_esc(v.note)}</span><button class="kyn-voicemsg-x" data-act="kyn-voice-dismiss" aria-label="Fermer">×</button></div>`;
  return html;
}

// Charge les médias du panneau en blob authentifié (images + lecteurs audio),
// une fois chacun. Réutilise le cache _mediaUrls (clé = id du média).
function _hydrateMedia() {
  if (!_panelEl) return;
  _panelEl.querySelectorAll('img[data-media-id]').forEach((img) => {
    if (img.dataset.loaded) return;
    img.dataset.loaded = '1';
    _loadMediaInto(img, img.getAttribute('data-media-id'));
  });
  _panelEl.querySelectorAll('audio[data-audio-id]').forEach((au) => {
    if (au.dataset.loaded) return;
    au.dataset.loaded = '1';
    _loadMediaInto(au, au.getAttribute('data-audio-id'));
  });
}
async function _loadMediaInto(img, id) {
  const cached = _mediaUrls.get(id);
  if (cached) { img.src = cached; return; }
  try {
    const res = await fetch(`${API_BASE}/api/keynapse/media/${encodeURIComponent(id)}`, { headers: { 'Authorization': `Bearer ${_jwt()}` } });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    _mediaUrls.set(id, url);
    img.src = url;
  } catch (_) {}
}

// Photo : input fichier → redimensionnement canvas → upload binaire.
function _pickPhoto() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try { await _uploadMedia(await _resizeImage(f, 1600, 0.85), 'photo'); } catch (_) {}
  });
  inp.click();
}
function _resizeImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const s = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob')), 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
async function _uploadMedia(blob, kind) {
  if (!_panel) return;
  try {
    const res = await fetch(`${API_BASE}/api/keynapse/bubbles/${encodeURIComponent(_panel.id)}/media?kind=${kind}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${_jwt()}`, 'Content-Type': blob.type || 'image/jpeg' },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.media) { _panel.detail.media = _panel.detail.media || []; _panel.detail.media.push(data.media); _refreshBody(); }
  } catch (_) {}
}
async function _delMedia(id) {
  _panel.detail.media = (_panel.detail.media || []).filter((m) => m.id !== id);
  const u = _mediaUrls.get(id); if (u) { URL.revokeObjectURL(u); _mediaUrls.delete(id); }
  _refreshBody();
  try { await _api(`/media/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
// Sprint 6 — mémos vocaux : MediaRecorder → upload authentifié →
// transcription Whisper + propositions IA (tâches/rappels) à valider.
// L'état transitoire (occupé / propositions / message) vit sur _panel.voice.
// ════════════════════════════════════════════════════════════════
let _rec = null;   // enregistrement en cours : { stream, mr, chunks, el, t0, timer, mime, send }

// Conteneur audio supporté (Chrome = webm/opus, Safari/iOS = mp4).
function _pickAudioMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg'];
  return cands.find((c) => { try { return MediaRecorder.isTypeSupported(c); } catch (_) { return false; } }) || '';
}
function _voiceMsg(msg, isErr) {
  if (!_panel || !_panel.voice) return;
  _panel.voice.error = isErr ? msg : '';
  _panel.voice.note  = isErr ? '' : msg;
  _panel.voice.busy  = '';
  _refreshBody();
}
function _clearVoiceMsg() {
  if (!_panel || !_panel.voice) return;
  _panel.voice.error = ''; _panel.voice.note = ''; _refreshBody();
}

async function _openVoiceRecorder() {
  if (!_panel || _rec) return;
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return _voiceMsg("L'enregistrement vocal n'est pas disponible sur cet appareil.", true);
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    return _voiceMsg((e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
      ? "Micro refusé. Autorisez l'accès au micro pour enregistrer un mémo."
      : "Micro indisponible sur cet appareil.", true);
  }
  if (!_panel) { try { stream.getTracks().forEach((x) => x.stop()); } catch (_) {} return; }
  const mime = _pickAudioMime();
  let mr;
  try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
  catch (_) {
    try { mr = new MediaRecorder(stream); }
    catch (_2) { stream.getTracks().forEach((x) => x.stop()); return _voiceMsg('Enregistrement impossible sur cet appareil.', true); }
  }
  const chunks = [];
  mr.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
  mr.addEventListener('stop', () => _onRecStop());
  _rec = { stream, mr, chunks, el: null, t0: Date.now(), timer: null, mime: mr.mimeType || mime || 'audio/webm', send: true };
  _clearVoiceMsg();
  _renderRecorder();
  try { mr.start(); } catch (_) { _teardownRec(); return _voiceMsg('Enregistrement impossible sur cet appareil.', true); }
  _rec.timer = setInterval(_updateRecTime, 200);
}
function _renderRecorder() {
  const wrap = _canvas() || _root; if (!wrap || !_rec) return;
  const el = document.createElement('div'); el.className = 'kyn-recmodal';
  el.innerHTML = `
    <div class="kyn-rec-card">
      <div class="kyn-rec-live"><span class="kyn-rec-dot"></span><span class="kyn-rec-state">Enregistrement…</span></div>
      <div class="kyn-rec-time" data-field="rec-time">0:00</div>
      <p class="kyn-rec-hint">Parlez, puis « Envoyer » — l'IA transcrit et propose des tâches/rappels.</p>
      <div class="kyn-rec-actions">
        <button class="kyn-btn" data-act="kyn-voice-cancel">Annuler</button>
        <button class="kyn-btn kyn-btn--accent" data-act="kyn-voice-stop">Envoyer</button>
      </div>
    </div>`;
  wrap.appendChild(el);
  _rec.el = el;
}
function _updateRecTime() {
  if (!_rec || !_rec.el) return;
  const s = Math.floor((Date.now() - _rec.t0) / 1000);
  const t = _rec.el.querySelector('[data-field="rec-time"]');
  if (t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (s >= 300) _stopVoiceRecorder(true);   // garde-fou 5 min (limite serveur 10 Mo)
}
function _stopVoiceRecorder(send) {
  if (!_rec) return;
  _rec.send = !!send;
  try { if (_rec.mr && _rec.mr.state !== 'inactive') _rec.mr.stop(); else _onRecStop(); }
  catch (_) { _onRecStop(); }
}
function _teardownRec() {
  if (!_rec) return;
  if (_rec.timer) clearInterval(_rec.timer);
  try { _rec.stream.getTracks().forEach((x) => x.stop()); } catch (_) {}
  if (_rec.el) _rec.el.remove();
  _rec = null;
}
async function _onRecStop() {
  const rec = _rec; if (!rec) return;
  const send = rec.send, dur = Date.now() - rec.t0;
  const blob = new Blob(rec.chunks, { type: rec.mime });
  _teardownRec();
  if (!send) return;                                  // annulé
  if (!blob.size || dur < 600) return _voiceMsg('Enregistrement trop court.', true);
  await _uploadVoice(blob);
}
async function _uploadVoice(blob) {
  if (!_panel || !_panel.voice) return;
  const bubbleId = _panel.id;
  _panel.voice.busy = 'Transcription et analyse…';
  _panel.voice.error = ''; _panel.voice.note = '';
  _refreshBody();
  let res, data;
  try {
    res = await fetch(`${API_BASE}/api/keynapse/bubbles/${encodeURIComponent(bubbleId)}/voice`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${_jwt()}`, 'Content-Type': blob.type || 'audio/webm' },
      body: blob,
    });
    data = await res.json().catch(() => ({}));
  } catch (_) {
    if (_panel && _panel.id === bubbleId) _voiceMsg('Le serveur met trop de temps à répondre — réessayez.', true);
    return;
  }
  if (!_panel || _panel.id !== bubbleId) return;
  _panel.voice.busy = '';
  if (!res.ok) return _voiceMsg(data && data.error ? data.error : "Échec de l'envoi du mémo vocal.", true);
  if (data.media) { _panel.detail.audios = _panel.detail.audios || []; _panel.detail.audios.unshift(data.media); }
  const tasks = (data.proposals && Array.isArray(data.proposals.tasks)) ? data.proposals.tasks : [];
  const rems  = (data.proposals && Array.isArray(data.proposals.reminders)) ? data.proposals.reminders : [];
  _panel.voice.props = (tasks.length || rems.length)
    ? { tasks: tasks.map((l) => ({ label: String(l), on: true })),
        reminders: rems.map((r) => ({ label: String(r.label || ''), at: _toLocalInput(r.at), on: true })) }
    : null;
  _panel.voice.note = data.note || '';
  _refreshBody();
}
// Relit l'état des cases/dates dans le DOM (source de vérité après rendu).
function _syncPropsFromDOM() {
  const v = _panel && _panel.voice; if (!v || !v.props || !_panelEl) return;
  _panelEl.querySelectorAll('.kyn-prop-check').forEach((c) => {
    const i = parseInt(c.dataset.i, 10);
    const arr = c.dataset.prop === 'rem' ? v.props.reminders : v.props.tasks;
    if (arr[i]) arr[i].on = c.checked;
  });
  _panelEl.querySelectorAll('.kyn-prop-at').forEach((inp) => {
    const i = parseInt(inp.dataset.i, 10);
    if (v.props.reminders[i]) v.props.reminders[i].at = inp.value;
  });
}
async function _addProposals() {
  const v = _panel && _panel.voice; if (!v || !v.props) return;
  _syncPropsFromDOM();
  const bubbleId = _panel.id;
  const tasks = v.props.tasks.filter((t) => t.on && t.label.trim());
  const rems  = v.props.reminders.filter((r) => r.on && r.at);
  v.props = null; v.busy = 'Ajout…'; _refreshBody();
  let nT = 0, nR = 0;
  for (const t of tasks) {
    try {
      const r = await _api(`/bubbles/${encodeURIComponent(bubbleId)}/todos`, { method: 'POST', body: { label: t.label.trim().slice(0, 500) } });
      if (r.todo && _panel && _panel.id === bubbleId) { _panel.detail.todos.push(r.todo); nT++; }
    } catch (_) {}
  }
  for (const r of rems) {
    const ms = Date.parse(r.at); if (Number.isNaN(ms)) continue;
    try {
      const res = await _api(`/bubbles/${encodeURIComponent(bubbleId)}/reminders`, { method: 'POST', body: { at: new Date(ms).toISOString(), label: (r.label || '').trim() } });
      if (res.reminder && _panel && _panel.id === bubbleId) { _panel.detail.reminders = _panel.detail.reminders || []; _panel.detail.reminders.push(res.reminder); }
      nR++;
    } catch (_) {}
  }
  if (!_panel || _panel.id !== bubbleId) return;
  _panel.voice.busy = '';
  _panel.voice.note = (nT || nR)
    ? `Ajouté : ${nT} tâche${nT > 1 ? 's' : ''}${nR ? ` · ${nR} rappel${nR > 1 ? 's' : ''}` : ''}.`
    : 'Rien à ajouter.';
  _refreshBody();
}
function _skipProposals() {
  if (!_panel || !_panel.voice) return;
  _panel.voice.props = null; _refreshBody();
}
async function _delVoice(id) {
  if (!_panel) return;
  _panel.detail.audios = (_panel.detail.audios || []).filter((a) => a.id !== id);
  const u = _mediaUrls.get(id); if (u) { URL.revokeObjectURL(u); _mediaUrls.delete(id); }
  _refreshBody();
  try { await _api(`/media/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
}
// ISO / chaîne parseable → valeur d'un <input type="datetime-local"> (heure LOCALE).
function _toLocalInput(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ════════════════════════════════════════════════════════════════
// Sprint 7 — rappels (date/heure/répétition) dans la fiche + indicateur
// « à venir », et notifications LOCALES : un poller (pad ouvert) repère les
// échéances → bandeau in-app (fiable partout) + notif OS via le SW si
// supportée (desktop / PWA installée ; sur iPhone Safari onglet = pas de
// Notification → on retombe sur le bandeau). Pas de push serveur (futur).
// ════════════════════════════════════════════════════════════════
function _remindersSectionHTML() {
  const rems = (_panel.detail.reminders || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const now = Date.now();
  const today = _toDateInput(new Date());
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins  = Array.from({ length: 60 }, (_, i) => i);     // minute par minute
  const tt = _remCurrentTime();
  const open = !!(_panel && _panel.remOpen);
  const p2 = (n) => String(n).padStart(2, '0');
  // Roulette scroll-snap (portée de Social Manager), DÉPLIÉE seulement pendant le
  // choix de l'heure ; repliée = puce compacte affichant l'heure choisie.
  const wheel = (kind, vals) => `
    <div class="kyn-wheel" data-wheel="${kind}">
      <div class="kyn-wheel-pad"></div>
      ${vals.map((v, i) => `<div class="kyn-wheel-item" data-wheel="${kind}" data-idx="${i}">${p2(v)}</div>`).join('')}
      <div class="kyn-wheel-pad"></div>
    </div>`;
  const timeUI = open
    ? `<div class="kyn-time-edit">
         <div class="kyn-wheel-wrap" aria-label="Heure du rappel">
           ${wheel('h', hours)}<div class="kyn-wheel-sep">:</div>${wheel('m', mins)}
           <div class="kyn-wheel-band" aria-hidden="true"></div>
         </div>
         <button type="button" class="kyn-time-ok" data-act="kyn-time-ok" aria-label="Valider l'heure">${icon('check', 16) || 'OK'}</button>
       </div>`
    : `<button type="button" class="kyn-time-chip" data-act="kyn-time-open" aria-label="Choisir l'heure">${icon('clock', 14) || ''}<span>${p2(tt.h)}:${p2(tt.m)}</span></button>`;
  return `
    <div class="kyn-sec">
      <p class="kyn-sec-h">Rappels${rems.length ? ` · ${rems.length}` : ''}</p>
      ${rems.map((r) => _reminderRowHTML(r, now)).join('')}
      <div class="kyn-rem-form">
        <input data-field="rem-date" type="date" class="kyn-rem-date" min="${today}" value="${today}" aria-label="Date du rappel">
        ${timeUI}
        <select data-field="rem-repeat" class="kyn-rem-rep" aria-label="Répétition">
          <option value="">Une fois</option>
          <option value="daily">Jour</option>
          <option value="weekly">Sem.</option>
          <option value="monthly">Mois</option>
        </select>
        <button class="kyn-add-btn" data-act="kyn-rem-add" aria-label="Ajouter le rappel">+</button>
      </div>
      ${_notifAffordanceHTML()}
    </div>`;
}
function _reminderRowHTML(r, now) {
  const st = _reminderState(r, now);
  // Le rappel porte le TITRE de la note (pas d'intitulé propre) ; on retombe sur
  // un éventuel ancien libellé, puis sur le titre fourni par la liste tenant-wide.
  const bubbleTitle = (_panel && _panel.detail && _panel.detail.bubble && _panel.detail.bubble.title) || r.bubble_title || 'Rappel';
  const lbl = _esc((r.label && r.label.trim()) ? r.label : bubbleTitle);
  return `
    <div class="kyn-rem ${st.cls}">
      <span class="kyn-rem-ico" aria-hidden="true">${icon('clock', 14) || ''}</span>
      <div class="kyn-rem-main">
        <div class="kyn-rem-lbl">${lbl}</div>
        <div class="kyn-rem-meta">${_esc(_fmtDateTime(r.at))}${st.tag ? ` · <span class="kyn-rem-tag">${st.tag}</span>` : ''}</div>
      </div>
      <select class="kyn-rem-rep" data-field="rem-rep-edit" data-id="${_escAttr(r.id)}" aria-label="Répétition du rappel">
        <option value=""${!r.repeat ? ' selected' : ''}>Une fois</option>
        <option value="daily"${r.repeat === 'daily' ? ' selected' : ''}>Jour</option>
        <option value="weekly"${r.repeat === 'weekly' ? ' selected' : ''}>Sem.</option>
        <option value="monthly"${r.repeat === 'monthly' ? ' selected' : ''}>Mois</option>
      </select>
      <button class="kyn-row-del" data-act="kyn-rem-del" data-id="${_escAttr(r.id)}" aria-label="Supprimer le rappel">×</button>
    </div>`;
}
function _reminderState(r, now) {
  const ms = Date.parse(r.at);
  if (Number.isNaN(ms)) return { cls: '', tag: '' };
  if (r.notified_at && !r.repeat) return { cls: 'is-done', tag: 'fait' };
  if (ms <= now) return { cls: 'is-due', tag: 'à faire' };
  if (ms - now < 86400000) return { cls: 'is-soon', tag: 'bientôt' };
  return { cls: '', tag: '' };
}
function _fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  try { return d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return '—'; }
}
function _notifSupported() { return typeof window !== 'undefined' && 'Notification' in window; }
function _notifAffordanceHTML() {
  if (!_notifSupported()) return '';
  const perm = Notification.permission;
  if (perm === 'granted') return '';
  if (perm === 'denied')  return `<p class="kyn-rem-hint">Notifications bloquées — les rappels restent signalés dans l'app.</p>`;
  return `<button class="kyn-rem-notif" data-act="kyn-notif-enable">${icon('bell', 14) || ''}<span>Activer les notifications</span></button>`;
}
// Web Push (Sprint 9) — clé publique VAPID (doit correspondre au worker).
const KN_VAPID_PUBLIC = 'BB0ytfuRYEoK1K6Y4SGGFbXhj6MbSTqsGnLG_gMypV_IVkGyWFiengfTRVyNJFUqmP8Vvg30v-9067t9X5HTlEc';
function _vapidKeyBytes() {
  const s = KN_VAPID_PUBLIC.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
// Abonne l'appareil au Web Push (rappels MÊME application fermée). Idempotent ;
// réutilise l'abonnement existant. ⚠ iOS : seulement si la PWA est installée.
async function _subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _vapidKeyBytes() });
    const j = sub.toJSON();
    if (j && j.keys) await _api('/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } });
  } catch (_) {}
}
async function _enableNotifs() {
  if (!_notifSupported()) return;
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') await _subscribePush();   // active aussi le push (app fermée)
  } catch (_) {}
  _refreshBody();
}
// Heure par défaut (now + 1 h) ; heure courante = choix mémorisé sinon défaut.
function _remDefaultTime() { const b = new Date(Date.now() + 3600000); return { h: b.getHours(), m: b.getMinutes() }; }
function _remCurrentTime() { return (_panel && _panel.remTime) ? _panel.remTime : _remDefaultTime(); }
// Valide la roulette : capture la sélection, replie l'affichage.
function _confirmRemTime() {
  if (!_panel) return;
  _panel.remTime = { h: Math.min(23, _knWheelIndex('h')), m: Math.min(59, _knWheelIndex('m')) };
  _panel.remOpen = false;
  _refreshBody();
}
async function _addReminder() {
  if (!_panel || !_panel.detail || !_panelEl) return;
  const dateEl = _panelEl.querySelector('[data-field="rem-date"]');
  if (!dateEl || !dateEl.value) { if (dateEl) dateEl.focus(); return; }
  if (_panel.remOpen) _panel.remTime = { h: Math.min(23, _knWheelIndex('h')), m: Math.min(59, _knWheelIndex('m')) };
  const tt = _remCurrentTime();
  const when = new Date(`${dateEl.value}T${String(tt.h).padStart(2, '0')}:${String(tt.m).padStart(2, '0')}`);   // date + heure locale → Date
  if (isNaN(when.getTime())) return;
  const repEl = _panelEl.querySelector('[data-field="rem-repeat"]');
  // Pas d'intitulé : le rappel reprend le titre de la note (worker : label null).
  const body = { at: when.toISOString(), label: '', repeat: repEl ? repEl.value : '' };
  try {
    const r = await _api(`/bubbles/${encodeURIComponent(_panel.id)}/reminders`, { method: 'POST', body });
    if (r.reminder) { _panel.detail.reminders = _panel.detail.reminders || []; _panel.detail.reminders.push(r.reminder); }
  } catch (_) {}
  _panel.remTime = null; _panel.remOpen = false;   // remet le formulaire au défaut
  _refreshBody();
}
// Index sélectionné d'une molette = position de scroll / hauteur d'un cran (patron SM).
function _knWheelIndex(kind) {
  const w = _panelEl && _panelEl.querySelector(`.kyn-wheel[data-wheel="${kind}"]`);
  const it = w && w.querySelector('.kyn-wheel-item');
  if (!w || !it) return 0;
  return Math.max(0, Math.round(w.scrollTop / it.offsetHeight));
}
function _toDateInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Cale les molettes sur l'heure courante (après peinture). No-op si repliée.
function _calibrateRemWheels() {
  if (!_panelEl) return;
  const wrap = _panelEl.querySelector('.kyn-wheel-wrap'); if (!wrap) return;
  const tt = _remCurrentTime();
  requestAnimationFrame(() => {
    const place = (kind, idx) => {
      const w = wrap.querySelector(`.kyn-wheel[data-wheel="${kind}"]`);
      const it = w && w.querySelector('.kyn-wheel-item');
      if (w && it) w.scrollTop = idx * it.offsetHeight;
    };
    place('h', tt.h);
    place('m', tt.m);
  });
}
async function _delReminder(id) {
  if (!_panel || !_panel.detail) return;
  _panel.detail.reminders = (_panel.detail.reminders || []).filter((r) => r.id !== id);
  _refreshBody();
  try { await _api(`/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
}
async function _patchReminder(id, patch) {
  if (!_panel || !_panel.detail) return;
  const rem = (_panel.detail.reminders || []).find((x) => x.id === id);
  if (rem) Object.assign(rem, patch);
  _refreshBody();
  try { const res = await _api(`/reminders/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }); if (res.reminder && rem) Object.assign(rem, res.reminder); } catch (_) {}
}

// ── Notifications locales : poller + déclenchement + accusé ──────
let _remPoll = null;             // id setInterval
const _remAcking = new Set();    // anti-doublon pendant l'aller-retour d'ack
function _startReminderPoll() {
  if (_remPoll) return;
  // Si les notifs sont déjà autorisées, on (re)confirme l'abonnement push au serveur.
  if (_notifSupported() && Notification.permission === 'granted') _subscribePush();
  _checkReminders();                                  // immédiat (rattrape l'échu)
  _remPoll = setInterval(_checkReminders, 30000);
}
function _stopReminderPoll() {
  if (_remPoll) { clearInterval(_remPoll); _remPoll = null; }
  _remAcking.clear();
}
async function _checkReminders() {
  if (!_root || !_jwt()) return;
  let data;
  try { data = await _api('/reminders'); } catch (_) { return; }
  const now = Date.now();
  const due = (data.reminders || []).filter((r) => {
    const ms = Date.parse(r.at);
    return !Number.isNaN(ms) && ms <= now && !r.notified_at && !_remAcking.has(r.id);
  });
  for (const r of due) {
    _remAcking.add(r.id);
    _fireReminder(r);
    _ackReminder(r.id).finally(() => _remAcking.delete(r.id));
  }
}
async function _ackReminder(id) {
  try {
    const res = await _api(`/reminders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { ack: true } });
    if (res.reminder && _panel && _panel.detail && Array.isArray(_panel.detail.reminders)) {
      const i = _panel.detail.reminders.findIndex((x) => x.id === id);
      if (i >= 0) { _panel.detail.reminders[i] = res.reminder; _refreshBody(); }
    }
  } catch (_) {}
}
// ── Sonnerie : carillon Web Audio (2 notes douces, aucun fichier) ──
// Amorcé au 1er clic dans le pad (geste utilisateur requis par l'autoplay) ;
// best-effort, jamais bloquant.
let _audioCtx = null;
function _primeAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_audioCtx) _audioCtx = new AC();
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
  } catch (_) {}
}
function _chime() {
  try {
    _primeAudio();
    const ctx = _audioCtx; if (!ctx) return;
    const t0 = ctx.currentTime;
    [784, 1047].forEach((freq, i) => {                 // sol5 → do6
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      const s = t0 + i * 0.16;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.18, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(s); o.stop(s + 0.55);
    });
  } catch (_) {}
}
function _fireReminder(r) {
  _chime();                // sonnerie
  _showInAppReminder(r);   // bandeau (fiable partout)
  if (_notifSupported() && Notification.permission === 'granted') {
    _osNotify('Rappel — Keynapse', (r.label && r.label.trim()) ? r.label : (r.bubble_title || 'Rappel'), r.bubble_id);
  }
}
async function _osNotify(title, body, bubbleId) {
  try {
    const reg = ('serviceWorker' in navigator) ? await navigator.serviceWorker.ready : null;
    if (reg && reg.showNotification) {
      await reg.showNotification(title, { body, tag: `kn-rem-${bubbleId || ''}`, data: { kind: 'keynapse-reminder', bubbleId } });
      return;
    }
  } catch (_) {}
  // Repli desktop sans SW : constructeur (échoue sur mobile → ignoré).
  try {
    const n = new Notification(title, { body });
    n.onclick = () => { try { window.focus(); } catch (_) {} if (bubbleId) _openPanel(bubbleId); n.close(); };
  } catch (_) {}
}
function _toastHost() {
  const wrap = _canvas() || _root; if (!wrap) return null;
  let host = wrap.querySelector('.kyn-toasts');
  if (!host) { host = document.createElement('div'); host.className = 'kyn-toasts'; wrap.appendChild(host); }
  return host;
}
function _showInAppReminder(r) {
  const host = _toastHost(); if (!host) return;
  const txt = (r.label && r.label.trim()) ? r.label : (r.bubble_title || 'Rappel');
  const el = document.createElement('div');
  el.className = 'kyn-toast';
  el.innerHTML = `
    <span class="kyn-toast-ico" aria-hidden="true">${icon('bell', 16) || ''}</span>
    <div class="kyn-toast-main"><div class="kyn-toast-t">Rappel</div><div class="kyn-toast-b">${_esc(txt)}</div></div>
    <button class="kyn-toast-go" data-act="kyn-toast-open" data-id="${_escAttr(r.bubble_id)}">Ouvrir</button>
    <button class="kyn-toast-x" data-act="kyn-toast-close" aria-label="Fermer">×</button>`;
  host.appendChild(el);
  setTimeout(() => { if (el.isConnected) el.remove(); }, 12000);
}

// ── Messages du SW (clic sur une notif → ouvrir la bulle) ───────
let _swMsgHandler = null;
function _bindSWMessages() {
  if (_swMsgHandler || !('serviceWorker' in navigator)) return;
  _swMsgHandler = (e) => {
    const d = e && e.data;
    if (d && d.type === 'keynapse-open-bubble' && d.bubbleId) { if (!_root) openKeynapse(); _openPanel(d.bubbleId); }
  };
  try { navigator.serviceWorker.addEventListener('message', _swMsgHandler); } catch (_) {}
}
function _unbindSWMessages() {
  if (_swMsgHandler && 'serviceWorker' in navigator) {
    try { navigator.serviceWorker.removeEventListener('message', _swMsgHandler); } catch (_) {}
  }
  _swMsgHandler = null;
}

// ── Lightbox plein écran (Niveau 3) ─────────────────────────────
function _openLightbox(id) {
  const media = _panel.detail.media || [];
  const i = media.findIndex((m) => m.id === id); if (i < 0) return;
  _lightbox = { ids: media.map((m) => m.id), i };
  _renderLightbox();
}
function _closeLightbox() { _lightbox = null; const o = _root && _root.querySelector('.kyn-lightbox'); if (o) o.remove(); }
function _lightboxStep(d) { if (!_lightbox) return; const n = _lightbox.ids.length; _lightbox.i = (_lightbox.i + d + n) % n; _renderLightbox(); }
function _renderLightbox() {
  if (!_lightbox) return;
  let el = _root && _root.querySelector('.kyn-lightbox');
  if (!el) { el = document.createElement('div'); el.className = 'kyn-lightbox'; (_canvas() || _root).appendChild(el); }
  const id = _lightbox.ids[_lightbox.i], multi = _lightbox.ids.length > 1;
  el.innerHTML = `
    <button class="kyn-lb-close" data-act="kyn-lightbox-close" aria-label="Fermer">×</button>
    ${multi ? '<button class="kyn-lb-nav kyn-lb-prev" data-act="kyn-lightbox-prev" aria-label="Précédent">‹</button>' : ''}
    <img class="kyn-lb-img" alt="">
    ${multi ? '<button class="kyn-lb-nav kyn-lb-next" data-act="kyn-lightbox-next" aria-label="Suivant">›</button>' : ''}
    ${multi ? `<div class="kyn-lb-count">${_lightbox.i + 1} / ${_lightbox.ids.length}</div>` : ''}`;
  const img = el.querySelector('.kyn-lb-img');
  const cached = _mediaUrls.get(id);
  if (cached) img.src = cached; else _loadMediaInto(img, id);
  // Swipe tactile (seuil 40px)
  let sx = null;
  el.addEventListener('touchstart', (e) => { sx = e.touches[0] ? e.touches[0].clientX : null; }, { passive: true });
  el.addEventListener('touchend', (e) => { if (sx == null) return; const dx = (e.changedTouches[0] ? e.changedTouches[0].clientX : sx) - sx; sx = null; if (Math.abs(dx) > 40) _lightboxStep(dx > 0 ? -1 : 1); }, { passive: true });
}

// ── Croquis : modale de dessin ──────────────────────────────────
function _openDraw() {
  const wrap = _canvas() || _root; if (!wrap || (_draw && _draw.el)) return;
  const el = document.createElement('div'); el.className = 'kyn-drawmodal';
  const colors = ['#f8fafc', '#6366f1', '#22c55e', '#fcd34d', '#f472b6', '#e05c5c'];
  el.innerHTML = `
    <div class="kyn-draw-card">
      <canvas class="kyn-draw-canvas" width="640" height="440"></canvas>
      <div class="kyn-draw-tools">
        <div class="kyn-draw-colors">${colors.map((c, i) => `<button class="kyn-draw-color${i === 0 ? ' is-on' : ''}" data-act="kyn-draw-color" data-color="${c}" style="background:${c}" aria-label="Couleur du trait"></button>`).join('')}</div>
        <button class="kyn-btn" data-act="kyn-draw-clear">Effacer</button>
        <span class="kyn-draw-spacer"></span>
        <button class="kyn-btn" data-act="kyn-draw-cancel">Annuler</button>
        <button class="kyn-btn kyn-btn--accent" data-act="kyn-draw-save">Ajouter</button>
      </div>
    </div>`;
  wrap.appendChild(el);
  const canvas = el.querySelector('.kyn-draw-canvas'), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#11151f'; ctx.fillRect(0, 0, canvas.width, canvas.height);   // fond (sinon PNG transparent)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#f8fafc';
  _draw = { el, canvas, ctx, drawing: false, lx: 0, ly: 0 };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (_) {} _draw.drawing = true; const p = pos(e); _draw.lx = p.x; _draw.ly = p.y; ctx.beginPath(); ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); });
  canvas.addEventListener('pointermove', (e) => { if (!_draw.drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(_draw.lx, _draw.ly); ctx.lineTo(p.x, p.y); ctx.stroke(); _draw.lx = p.x; _draw.ly = p.y; });
  const end = () => { if (_draw) _draw.drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
}
function _closeDraw() { if (_draw) { _draw.el.remove(); _draw = null; } }
function _drawSetColor(c) {
  if (!_draw) return;
  _draw.ctx.strokeStyle = c;
  _draw.el.querySelectorAll('.kyn-draw-color').forEach((b) => b.classList.toggle('is-on', b.dataset.color === c));
}
function _drawClear() { if (!_draw) return; const { ctx, canvas } = _draw; const s = ctx.strokeStyle; ctx.fillStyle = '#11151f'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = s; }
async function _drawSave() {
  if (!_draw) return;
  const canvas = _draw.canvas; _closeDraw();
  await new Promise((resolve) => canvas.toBlob(async (b) => { if (b) await _uploadMedia(b, 'drawing'); resolve(); }, 'image/png'));
}
function _refreshBody() {
  if (!_panelEl || !_panel || !_panel.detail) return;
  const body = _panelEl.querySelector('.kyn-panel-body'); if (body) body.innerHTML = _panelBodyHTML();
  // Le ré-injection d'innerHTML recrée les <img>/<audio> (src perdu) → ré-hydrate
  // depuis le cache blob (instantané si déjà chargé).
  _hydrateMedia();
  _calibrateRemWheels();   // recale les molettes (scrollTop perdu au ré-render)
}
async function _patchBubble(patch) {
  if (!_panel || !_panel.detail) return;
  const id = _panel.id;
  Object.assign(_panel.detail.bubble, patch);
  const sb = _state.bubbles.find((x) => x.id === id); if (sb) Object.assign(sb, patch);
  if ('color' in patch || typeof patch.title === 'string') _engine && _engine.updateNode(id, { ...patch, color: _effColor(_panel.detail.bubble) });
  if ('color' in patch && _panelEl) {
    const acc = _effColor(_panel.detail.bubble);
    _panelEl.style.setProperty('--kyn-accent', acc);
    _panelEl.querySelectorAll('.kyn-swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.color === acc)));
  }
  try { await _api(`/bubbles/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }); } catch (_) {}
}
// Affecter / retirer la bulle d'une zone (zone_id null = aucune).
async function _assignZone(zoneId) {
  if (!_panel || !_panel.detail) return;
  const id = _panel.id;
  _panel.detail.bubble.zone_id = zoneId || null;
  const sb = _state.bubbles.find((x) => x.id === id); if (sb) sb.zone_id = zoneId || null;
  _renderPanel();          // rafraîchit chips + bloc couleur + accent
  _pushEngine();           // recolore + recohésion
  try { await _api(`/bubbles/${encodeURIComponent(id)}`, { method: 'PATCH', body: { zone_id: zoneId || null } }); } catch (_) {}
}

async function _addTodo() {
  const inp = _panelEl && _panelEl.querySelector('[data-field="todo-add"]'); if (!inp) return;
  const label = inp.value.trim(); if (!label) return; inp.value = '';
  try { const r = await _api(`/bubbles/${encodeURIComponent(_panel.id)}/todos`, { method: 'POST', body: { label } }); _panel.detail.todos.push(r.todo); _refreshBody(); const ni = _panelEl.querySelector('[data-field="todo-add"]'); if (ni) ni.focus(); } catch (_) {}
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
  const ta = _panelEl && _panelEl.querySelector('[data-field="note-add"]'); if (!ta) return;
  const text = ta.value.trim(); if (!text) return; ta.value = '';
  try { const r = await _api(`/bubbles/${encodeURIComponent(_panel.id)}/notes`, { method: 'POST', body: { body: text } }); _panel.detail.notes.unshift(r.note); _refreshBody(); } catch (_) {}
}
async function _delNote(id) {
  _panel.detail.notes = _panel.detail.notes.filter((x) => x.id !== id); _refreshBody();
  try { await _api(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
}
function _confirmDeleteBubble(btn) {
  if (btn.dataset.confirm === '1') return _deleteBubble();
  btn.dataset.confirm = '1'; btn.textContent = 'Confirmer la suppression ?';
  setTimeout(() => { if (btn && btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = 'Supprimer cette bulle'; } }, 4000);
}
async function _deleteBubble() {
  if (!_panel) return;
  const id = _panel.id; _closePanel();
  _state.bubbles = _state.bubbles.filter((b) => b.id !== id);
  _state.links = _state.links.filter((l) => l.from_bubble !== id && l.to_bubble !== id);
  if (!_state.bubbles.length) { _teardownEngine(); _render(); } else _pushEngine();
  try { await _api(`/bubbles/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
// Panneau Zones (Sprint 3)
// ════════════════════════════════════════════════════════════════
function _openZonesPanel() {
  const wrap = _canvas(); if (!wrap) return;
  if (!_zonesEl) { _zonesEl = document.createElement('aside'); _zonesEl.className = 'kyn-zones-panel'; wrap.appendChild(_zonesEl); }
  _renderZonesPanel();
}
function _closeZonesPanel() { _recolorZone = null; if (_zonesEl) { _zonesEl.remove(); _zonesEl = null; } }
function _zoneCount(id) { return _state.bubbles.filter((b) => b.zone_id === id).length; }
function _renderZonesPanel() {
  if (!_zonesEl) return;
  const rows = _state.zones.map((z) => `
    <div class="kyn-zrow">
      <button class="kyn-zdot" data-act="kyn-zone-recolor" data-id="${z.id}" style="background:${z.color}" aria-label="Changer la couleur"></button>
      <input class="kyn-zname" data-field="zonename" data-id="${z.id}" value="${_escAttr(z.name)}" maxlength="80" aria-label="Nom de la zone">
      <span class="kyn-zcount">${_zoneCount(z.id)}</span>
      <button class="kyn-zact" data-act="kyn-zone-fly" data-id="${z.id}" title="Aller à la zone" aria-label="Aller à la zone">${LOCATE_ICON}</button>
      <button class="kyn-zact kyn-zdel" data-act="kyn-zone-del" data-id="${z.id}" title="Supprimer la zone" aria-label="Supprimer la zone">×</button>
    </div>
    ${_recolorZone === z.id ? `<div class="kyn-zswatches">${KN_COLORS.map((c) => `<button class="kyn-swatch" data-act="kyn-zone-setcolor" data-id="${z.id}" data-color="${c}" style="background:${c}" aria-pressed="${c === z.color}" aria-label="Couleur"></button>`).join('')}</div>` : ''}
  `).join('');
  _zonesEl.innerHTML = `
    <div class="kyn-zhead">
      <span class="kyn-zhead-t">Zones</span>
      <button class="kyn-panel-x" data-act="kyn-zones-close" aria-label="Fermer">×</button>
    </div>
    <div class="kyn-zbody">
      ${_state.zones.length ? rows : `<p class="kyn-zempty">Aucune zone. Crée-en une pour regrouper tes bulles par couleur.</p>`}
      <div class="kyn-add kyn-zcreate">
        <input data-field="newzone" type="text" maxlength="80" placeholder="Nouvelle zone…" autocomplete="off">
        <button class="kyn-add-btn" data-act="kyn-zone-create" aria-label="Créer la zone">+</button>
      </div>
    </div>`;
}
async function _createZone() {
  const inp = _zonesEl && _zonesEl.querySelector('[data-field="newzone"]'); if (!inp) return;
  const name = inp.value.trim(); if (!name) return; inp.value = '';
  try {
    const r = await _api('/zones', { method: 'POST', body: { name, color: _nextZoneColor() } });
    _state.zones.push(r.zone); _renderZonesPanel(); _pushEngine();
  } catch (_) {}
}
async function _renameZone(id, name) {
  const z = _zoneById(id); if (!z) return; z.name = name;
  _pushEngine();
  try { await _api(`/zones/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }); } catch (_) {}
}
async function _setZoneColor(id, color) {
  const z = _zoneById(id); if (!z) return; z.color = color; _recolorZone = null;
  _renderZonesPanel(); _pushEngine();
  if (_panel && _panel.detail && _panel.detail.bubble.zone_id === id) _renderPanel();   // accent fiche
  try { await _api(`/zones/${encodeURIComponent(id)}`, { method: 'PATCH', body: { color } }); } catch (_) {}
}
function _flyToZone(id) {
  const ids = _state.bubbles.filter((b) => b.zone_id === id).map((b) => b.id);
  if (_engine && ids.length) _engine.focusBubbles(ids);
}
async function _deleteZone(id) {
  _state.zones = _state.zones.filter((z) => z.id !== id);
  _state.bubbles.forEach((b) => { if (b.zone_id === id) b.zone_id = null; });
  if (_recolorZone === id) _recolorZone = null;
  _renderZonesPanel(); _pushEngine();
  if (_panel && _panel.detail && _panel.detail.bubble.zone_id === id) { _panel.detail.bubble.zone_id = null; _renderPanel(); }
  try { await _api(`/zones/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
}

// ── Animation : sélecteur « mal de mer » (persisté localStorage) ─
// Défaut : suit le réglage système (prefers-reduced-motion) ; le choix manuel
// le surcharge et est mémorisé.
function _motionOn() {
  const p = localStorage.getItem('kn_motion');
  if (p === 'on') return true;
  if (p === 'off') return false;
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function _toggleMotion() {
  const on = !_motionOn();
  try { localStorage.setItem('kn_motion', on ? 'on' : 'off'); } catch (_) {}
  if (_engine) _engine.setMotion(on);
  _updateMotionBtn();
}
function _updateMotionBtn() {
  const btn = _root && _root.querySelector('.kyn-motion-btn');
  if (!btn) return;
  const on = _motionOn();
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('is-off', !on);
  btn.innerHTML = on ? MOTION_ON_ICON : MOTION_OFF_ICON;
  btn.title = on
    ? "Animation des bulles : activée — cliquez pour la figer (confort / mal de mer)"
    : "Animation des bulles : figée — cliquez pour la réactiver";
}

// ── Utils ───────────────────────────────────────────────────────
function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _escAttr(s) { return _esc(s).replace(/"/g, '&quot;'); }
function _fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(String(iso).replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); } catch (_) { return '—'; }
}
