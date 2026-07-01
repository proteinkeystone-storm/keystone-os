/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Panneau Ω « Symboles » (GW-Symboles, 2026-07)

   Contenant PUR de la bibliothèque lib/symbols-data.js : panneau
   latéral avec recherche fr, catégories, récents + favoris, clic =
   INSERTION AU CURSEUR du champ cible (+ copie presse-papiers), et
   convertisseur « lettres stylées » avec avertissement accessibilité.

   API :
     symbolsButtonHTML()                    → bouton Ω (à poser près d'un éditeur)
     openSymbolsPanel({ getTarget })        → ouvre ; getTarget() = textarea/input cible
     closeSymbolsPanel()

   Un outil, pas un mode : disponible pendant qu'on écrit, quel que
   soit l'écran (Réécriture, Correction…). Aucune dépendance réseau.
   ═══════════════════════════════════════════════════════════════ */

import { icon } from './ui-icons.js';
import { SYMBOL_CATEGORIES, searchSymbols, normalizeQuery, STYLED_STYLES, styleText } from './symbols-data.js';

const RECENT_KEY = 'ks_symbols_recent';
const FAV_KEY    = 'ks_symbols_fav';
const MAX_RECENT = 24;

let _panel = null, _getTarget = null, _view = 'recent', _query = '';

function _load(key) { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function _save(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (_) {} }
function _pushRecent(c) { const r = [c, ..._load(RECENT_KEY).filter(x => x !== c)].slice(0, MAX_RECENT); _save(RECENT_KEY, r); }
function _toggleFav(c) {
  const f = _load(FAV_KEY);
  const i = f.indexOf(c);
  if (i >= 0) f.splice(i, 1); else f.unshift(c);
  _save(FAV_KEY, f);
}
function _isFav(c) { return _load(FAV_KEY).includes(c); }

// Nom d'un caractère (pour tooltips des récents/favoris).
let _nameIndex = null;
function _nameOf(c) {
  if (!_nameIndex) {
    _nameIndex = new Map();
    for (const cat of SYMBOL_CATEGORIES) for (const [ch, n] of cat.items) if (!_nameIndex.has(ch)) _nameIndex.set(ch, n);
  }
  return _nameIndex.get(c) || c;
}

export function symbolsButtonHTML() {
  _injectStyles();   // le bouton vit dans un render hôte AVANT toute ouverture : ses styles doivent déjà être là
  return `<button class="ksym-open" type="button" data-act="symbols" title="Bibliothèque de symboles" aria-label="Bibliothèque de symboles"><span class="ksym-omega">Ω</span> Symboles</button>`;
}

export function openSymbolsPanel({ getTarget } = {}) {
  if (_panel) { closeSymbolsPanel(); }
  _injectStyles();
  _getTarget = typeof getTarget === 'function' ? getTarget : null;
  _view = _load(FAV_KEY).length ? 'fav' : (_load(RECENT_KEY).length ? 'recent' : (SYMBOL_CATEGORIES[0].id));
  _query = '';
  _panel = document.createElement('aside');
  _panel.className = 'ksym-panel';
  _panel.setAttribute('role', 'dialog');
  _panel.setAttribute('aria-label', 'Bibliothèque de symboles');
  _panel.innerHTML = _panelHTML();
  document.body.appendChild(_panel);
  requestAnimationFrame(() => _panel && _panel.classList.add('is-on'));
  _panel.addEventListener('click', _onClick);
  _panel.addEventListener('input', _onInput);
  document.addEventListener('keydown', _onKey);
  _renderBody();
  const s = _panel.querySelector('.ksym-search input');
  if (s && matchMedia('(pointer: fine)').matches) s.focus();
}

export function closeSymbolsPanel() {
  if (!_panel) return;
  document.removeEventListener('keydown', _onKey);
  const p = _panel; _panel = null;
  p.classList.remove('is-on');
  setTimeout(() => p.remove(), 180);
}

function _onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeSymbolsPanel(); } }

function _panelHTML() {
  const chips = [
    { id: 'fav',    label: '★ Favoris' },
    { id: 'recent', label: 'Récents' },
    ...SYMBOL_CATEGORIES.map(c => ({ id: c.id, label: c.label })),
    { id: 'styled', label: 'Lettres stylées' },
  ].map(c => `<button class="ksym-chip${c.id === _view ? ' is-active' : ''}" type="button" data-view="${c.id}">${c.label}</button>`).join('');
  return `
    <div class="ksym-head">
      <div class="ksym-title"><span class="ksym-omega">Ω</span> Symboles</div>
      <button class="ksym-x" type="button" data-close aria-label="Fermer">${icon('x', 18)}</button>
    </div>
    <div class="ksym-search">${icon('search', 15)}<input type="search" placeholder="Rechercher (flèche, coche, euro…)" aria-label="Rechercher un symbole"></div>
    <div class="ksym-chips">${chips}</div>
    <div class="ksym-body" data-slot="body"></div>
    <div class="ksym-foot">Un clic insère le symbole au curseur et le copie.</div>`;
}

function _grid(items, { favEditable = false } = {}) {
  if (!items.length) return '<div class="ksym-empty">Rien ici pour l\'instant.</div>';
  return `<div class="ksym-grid">${items.map(({ c, n }) => `
    <button class="ksym-cell" type="button" data-sym="${_escAttr(c)}" title="${_escAttr(n)}">
      <span class="ksym-glyph">${_esc(c)}</span>
      <span class="ksym-star${_isFav(c) ? ' is-fav' : ''}" data-fav="${_escAttr(c)}" title="${_isFav(c) ? 'Retirer des favoris' : 'Ajouter aux favoris'}" role="button" aria-label="Favori">★</span>
    </button>`).join('')}</div>`;
}

function _renderBody() {
  const body = _panel && _panel.querySelector('[data-slot="body"]');
  if (!body) return;
  _panel.querySelectorAll('.ksym-chip').forEach(ch => ch.classList.toggle('is-active', ch.dataset.view === _view && !_query));

  if (_query) {
    const found = searchSymbols(_query);
    body.innerHTML = found.length
      ? _grid(found)
      : '<div class="ksym-empty">Aucun symbole ne correspond. Essayez « flèche », « coche », « euro »…</div>';
    return;
  }
  if (_view === 'recent') { body.innerHTML = _grid(_load(RECENT_KEY).map(c => ({ c, n: _nameOf(c) }))); return; }
  if (_view === 'fav')    { body.innerHTML = _grid(_load(FAV_KEY).map(c => ({ c, n: _nameOf(c) })));    return; }
  if (_view === 'styled') { body.innerHTML = _styledHTML(); return; }
  const cat = SYMBOL_CATEGORIES.find(c => c.id === _view) || SYMBOL_CATEGORIES[0];
  body.innerHTML = `${cat.note ? `<div class="ksym-note">${icon('alert-triangle', 13)} ${_esc(cat.note)}</div>` : ''}${_grid(cat.items.map(([c, n]) => ({ c, n })))}`;
}

// ── Lettres stylées (convertisseur) ─────────────────────────────
function _styledHTML(input = '') {
  const rows = STYLED_STYLES.map(s => {
    const out = input ? styleText(input, s.id) : '';
    return `
      <div class="ksym-styled-row">
        <span class="ksym-styled-label">${_esc(s.label)}</span>
        <span class="ksym-styled-out" data-styled-out="${s.id}">${_esc(out || styleText('Exemple 123', s.id))}</span>
        <button class="ksym-mini" type="button" data-styled-copy="${s.id}"${input ? '' : ' disabled'}>Copier</button>
      </div>`;
  }).join('');
  return `
    <div class="ksym-styled">
      <input class="ksym-styled-in" type="text" maxlength="200" placeholder="Tapez votre texte à styler…" aria-label="Texte à styler" value="${_escAttr(input)}">
      ${rows}
      <div class="ksym-note">${icon('alert-triangle', 13)} À utiliser avec parcimonie : ces lettres sont épelées une à une par les lecteurs d'écran et mal lues par les moteurs de recherche et d'IA.</div>
    </div>`;
}

// ── Événements ──────────────────────────────────────────────────
function _onClick(e) {
  if (e.target.closest('[data-close]')) { closeSymbolsPanel(); return; }
  const chip = e.target.closest('.ksym-chip');
  if (chip) {
    _view = chip.dataset.view; _query = '';
    const s = _panel.querySelector('.ksym-search input'); if (s) s.value = '';
    _renderBody(); return;
  }
  const star = e.target.closest('[data-fav]');
  if (star) { e.stopPropagation(); _toggleFav(star.dataset.fav); _renderBody(); return; }
  const styledCopy = e.target.closest('[data-styled-copy]');
  if (styledCopy) {
    const out = _panel.querySelector(`[data-styled-out="${styledCopy.dataset.styledCopy}"]`);
    if (out) { _copy(out.textContent); _flash(styledCopy, 'Copié ✓'); }
    return;
  }
  const cell = e.target.closest('[data-sym]');
  if (cell) { _pick(cell.dataset.sym, cell); return; }
}

function _onInput(e) {
  if (e.target.matches('.ksym-search input')) { _query = e.target.value; _renderBody(); return; }
  if (e.target.matches('.ksym-styled-in')) {
    const v = e.target.value;
    STYLED_STYLES.forEach(s => {
      const out = _panel.querySelector(`[data-styled-out="${s.id}"]`);
      const btn = _panel.querySelector(`[data-styled-copy="${s.id}"]`);
      if (out) out.textContent = v ? styleText(v, s.id) : styleText('Exemple 123', s.id);
      if (btn) btn.disabled = !v;
    });
  }
}

// Clic sur un symbole : insertion au CURSEUR du champ cible + copie.
function _pick(c, cell) {
  _pushRecent(c);
  _copy(c);
  const t = _getTarget && _getTarget();
  if (t && typeof t.value === 'string' && typeof t.selectionStart === 'number') {
    const start = t.selectionStart, end = t.selectionEnd;
    t.value = t.value.slice(0, start) + c + t.value.slice(end);
    const pos = start + c.length;
    t.setSelectionRange(pos, pos);
    t.dispatchEvent(new Event('input', { bubbles: true }));   // sync état du pad hôte
    t.focus();
  }
  if (cell) {
    cell.classList.add('is-picked');
    setTimeout(() => cell && cell.classList.remove('is-picked'), 350);
  }
}

function _copy(text) {
  try { navigator.clipboard.writeText(text); } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    } catch (_) {}
  }
}

function _flash(btn, txt) {
  const old = btn.textContent;
  btn.textContent = txt;
  setTimeout(() => { btn.textContent = old; }, 900);
}

function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _escAttr(s) { return _esc(s).replace(/"/g, '&quot;'); }

// ── Styles (injectés une fois) ──────────────────────────────────
const FLAG = '__ks_symbols_css__';
function _injectStyles() {
  if (window[FLAG]) return;
  window[FLAG] = true;
  const css = `
.ksym-open { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 100px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.10); color: var(--text-muted, #aab);
  font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all .15s ease; text-transform: none; letter-spacing: 0; }
.ksym-open:hover { background: rgba(120,160,255,.14); border-color: rgba(120,160,255,.4); color: var(--text-primary, #fff); }
.ksym-omega { font-size: 14px; font-weight: 700; line-height: 1; color: #9b8cff; }
html.light-mode .ksym-open { background: rgba(0,0,0,.04); border-color: rgba(0,0,0,.1); }

/* z-index 10002 : AU-DESSUS du workspace fullscreen (.ws-app = 9999), du
   Help-Overlay (10000) et de sa couche 10001 — piège documenté « popup
   body.appendChild caché derrière le workspace » (cf. mémoire sdqr). */
.ksym-panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 10002; width: min(400px, 100vw);
  display: flex; flex-direction: column; background: rgba(18,18,34,.97);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  border-left: 1px solid rgba(164,162,255,.18); box-shadow: -18px 0 50px rgba(0,0,0,.45);
  transform: translateX(102%); transition: transform .2s ease; color: #eceafe; }
.ksym-panel.is-on { transform: none; }
html.light-mode .ksym-panel { background: rgba(250,250,253,.98); color: #1c1c2e; border-left-color: rgba(0,0,0,.1); }

.ksym-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 10px; }
.ksym-title { font-size: 15px; font-weight: 800; letter-spacing: -.01em; display: flex; align-items: center; gap: 8px; }
.ksym-title .ksym-omega { font-size: 18px; }
.ksym-x { width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(255,255,255,.07);
  color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; }
html.light-mode .ksym-x { background: rgba(0,0,0,.06); }

.ksym-search { display: flex; align-items: center; gap: 8px; margin: 0 16px 10px; padding: 0 12px;
  border-radius: 11px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: #9b93c9; }
.ksym-search input { flex: 1; height: 40px; border: 0; outline: 0; background: transparent; color: inherit;
  font: inherit; font-size: 14px; color: var(--text-primary, #fff); }
html.light-mode .ksym-search { background: rgba(0,0,0,.04); border-color: rgba(0,0,0,.1); }
html.light-mode .ksym-search input { color: #1c1c2e; }

.ksym-chips { display: flex; gap: 6px; overflow-x: auto; padding: 2px 16px 10px; scrollbar-width: none; flex-shrink: 0; }
.ksym-chips::-webkit-scrollbar { display: none; }
.ksym-chip { flex-shrink: 0; padding: 7px 12px; border-radius: 100px; border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.04); color: var(--text-muted, #aab); font-size: 12px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all .13s ease; }
.ksym-chip.is-active { background: rgba(120,160,255,.2); border-color: rgba(120,160,255,.5); color: var(--text-primary, #fff); }
html.light-mode .ksym-chip { background: rgba(0,0,0,.04); border-color: rgba(0,0,0,.1); }

.ksym-body { flex: 1; overflow-y: auto; padding: 4px 16px 16px; }
.ksym-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); gap: 7px; }
.ksym-cell { position: relative; aspect-ratio: 1; border-radius: 11px; border: 1px solid rgba(255,255,255,.09);
  background: rgba(255,255,255,.04); color: var(--text-primary, #fff); cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: all .12s ease; }
.ksym-cell:hover { background: rgba(120,160,255,.16); border-color: rgba(120,160,255,.45); }
.ksym-cell.is-picked { background: rgba(102,220,160,.22); border-color: rgba(102,220,160,.6); }
.ksym-glyph { font-size: 21px; line-height: 1; }
.ksym-star { position: absolute; top: 1px; right: 3px; font-size: 11px; line-height: 1; color: rgba(255,255,255,.22);
  opacity: 0; transition: opacity .12s ease, color .12s ease; padding: 2px; }
.ksym-cell:hover .ksym-star { opacity: 1; }
.ksym-star.is-fav { opacity: 1; color: #e7c76a; }
html.light-mode .ksym-cell { background: rgba(0,0,0,.03); border-color: rgba(0,0,0,.09); color: #1c1c2e; }
html.light-mode .ksym-star { color: rgba(0,0,0,.2); }

.ksym-empty { padding: 34px 10px; text-align: center; font-size: 13px; color: var(--text-muted, #99a); line-height: 1.5; }
.ksym-note { display: flex; align-items: flex-start; gap: 7px; margin: 2px 0 10px; padding: 9px 11px; border-radius: 10px;
  background: rgba(231,199,106,.09); border: 1px solid rgba(231,199,106,.25); color: #d9c58a; font-size: 11.5px; line-height: 1.45; }
.ksym-foot { flex-shrink: 0; padding: 9px 16px calc(env(safe-area-inset-bottom, 0px) + 11px);
  border-top: 1px solid rgba(255,255,255,.08); font-size: 11px; color: var(--text-muted, #889); }
html.light-mode .ksym-foot { border-top-color: rgba(0,0,0,.08); }

.ksym-styled { display: flex; flex-direction: column; gap: 9px; }
.ksym-styled-in { height: 42px; border-radius: 11px; padding: 0 12px; border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.05); color: var(--text-primary, #fff); font: inherit; font-size: 14px; outline: 0; }
.ksym-styled-in:focus { border-color: rgba(120,160,255,.45); }
html.light-mode .ksym-styled-in { background: rgba(0,0,0,.04); border-color: rgba(0,0,0,.12); color: #1c1c2e; }
.ksym-styled-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px;
  background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.07); }
html.light-mode .ksym-styled-row { background: rgba(0,0,0,.03); border-color: rgba(0,0,0,.08); }
.ksym-styled-label { flex-shrink: 0; width: 88px; font-size: 11px; color: var(--text-muted, #99a); font-weight: 600; }
.ksym-styled-out { flex: 1; font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ksym-mini { flex-shrink: 0; padding: 5px 10px; border-radius: 100px; border: 1px solid rgba(255,255,255,.14);
  background: transparent; color: inherit; font-size: 11px; font-weight: 600; font-family: inherit; cursor: pointer; }
.ksym-mini:disabled { opacity: .4; cursor: default; }
.ksym-mini:hover:not(:disabled) { background: rgba(120,160,255,.16); border-color: rgba(120,160,255,.45); }
`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}
