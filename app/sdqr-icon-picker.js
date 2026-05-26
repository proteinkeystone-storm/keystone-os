// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Bibliothèque de pictogrammes intégrée (V4.5)
// ───────────────────────────────────────────────────────────────────
// Picker d'emojis curés (~90 pictos par 6 catégories) pour les champs
// SDQR qui acceptent des emojis (Quiz d'orientation, Machine à sous,
// futurs templates). Modal Apple Premium léger, zéro dépendance.
//
// Usage :
//   import { openIconPicker } from './sdqr-icon-picker.js';
//   openIconPicker({
//     onPick: (emoji) => { /* insérer dans le champ */ },
//     anchorLabel: 'Choisir un picto pour cette réponse',
//   });
//
// Les emojis sont curés pour les cas d'usage Keystone (commerce de
// proximité, retail, animation marketing) — pas un picker Unicode
// complet (90 vs 3700). L'utilisateur peut toujours taper un emoji
// custom au clavier ou coller depuis ailleurs si le picker n'a pas
// celui qu'il veut.
// ══════════════════════════════════════════════════════════════════

export const ICON_CATEGORIES = [
  {
    id: 'personnes',
    label: 'Personnes',
    icons: ['👶', '🧒', '🧑', '👨', '👩', '👴', '👵', '🧓', '👼', '👯', '💑', '👨‍👩‍👧', '👨‍👨‍👧', '👩‍👩‍👧', '🤝', '👥'],
  },
  {
    id: 'cadeaux',
    label: 'Cadeaux & occasions',
    icons: ['🎁', '💝', '💐', '🌹', '🛍️', '🛒', '💍', '💎', '🏆', '🎀', '🎊', '🎉', '🥂', '🍾', '💖', '💕'],
  },
  {
    id: 'loisirs',
    label: 'Loisirs & passions',
    icons: ['🎮', '📚', '🎬', '🎵', '🎸', '🎨', '⚽', '🎯', '🏃', '🚴', '🏖️', '🎲', '🧩', '🎭', '📷', '🎤'],
  },
  {
    id: 'jeu',
    label: 'Jeu & chance',
    icons: ['🍒', '🍋', '🍇', '🍊', '🍓', '⭐', '🔔', '💎', '7️⃣', '🍀', '🎰', '🃏', '🪙', '💰', '👑', '🎁'],
  },
  {
    id: 'restauration',
    label: 'Restauration',
    icons: ['☕', '🍷', '🍰', '🥐', '🥖', '🍕', '🍣', '🍔', '🍜', '🥗', '🍩', '🍫', '🧁', '🍦', '🥃', '🍺'],
  },
  {
    id: 'emotions',
    label: 'Émotions & accents',
    icons: ['❤️', '💛', '💚', '💙', '💜', '🧡', '✨', '🌟', '🔥', '💯', '👍', '🙌', '😊', '🥰', '😍', '🤩'],
  },
];

let _modalEl = null;
let _activeCallback = null;
let _activeCategoryId = ICON_CATEGORIES[0].id;

function _renderCategoryTabs() {
  return ICON_CATEGORIES.map(cat => `
    <button type="button"
            class="sdqr-icon-cat${cat.id === _activeCategoryId ? ' is-active' : ''}"
            data-cat-id="${cat.id}">
      ${cat.label}
    </button>
  `).join('');
}

function _renderIconGrid() {
  const cat = ICON_CATEGORIES.find(c => c.id === _activeCategoryId) || ICON_CATEGORIES[0];
  return cat.icons.map(ic => `
    <button type="button" class="sdqr-icon-cell" data-icon="${ic}" aria-label="Choisir ${ic}">
      ${ic}
    </button>
  `).join('');
}

function _renderModalHTML(anchorLabel) {
  return `
    <div class="sdqr-icon-modal" role="dialog" aria-modal="true" aria-labelledby="sdqr-icon-title">
      <div class="sdqr-icon-backdrop" data-close></div>
      <div class="sdqr-icon-panel" role="document">
        <header class="sdqr-icon-head">
          <h2 id="sdqr-icon-title">${anchorLabel || 'Choisir un picto'}</h2>
          <button type="button" class="sdqr-icon-close" data-close aria-label="Fermer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </header>
        <nav class="sdqr-icon-cats" id="sdqr-icon-cats">${_renderCategoryTabs()}</nav>
        <div class="sdqr-icon-grid" id="sdqr-icon-grid">${_renderIconGrid()}</div>
        <p class="sdqr-icon-hint">Tu peux aussi taper ou coller un picto manuellement dans le champ.</p>
      </div>
    </div>
  `;
}

function _updateGrid() {
  const grid = _modalEl?.querySelector('#sdqr-icon-grid');
  const cats = _modalEl?.querySelector('#sdqr-icon-cats');
  if (grid) grid.innerHTML = _renderIconGrid();
  if (cats) cats.innerHTML = _renderCategoryTabs();
}

function _wireEvents() {
  if (!_modalEl) return;

  // Fermeture (backdrop, croix, ESC)
  _modalEl.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', closeIconPicker);
  });
  document.addEventListener('keydown', _onKey);

  // Tabs catégories
  _modalEl.querySelectorAll('.sdqr-icon-cat').forEach(btn => {
    btn.addEventListener('click', (e) => {
      _activeCategoryId = btn.getAttribute('data-cat-id') || ICON_CATEGORIES[0].id;
      _updateGrid();
    });
  });

  // Click sur emoji
  _modalEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.sdqr-icon-cell');
    if (!cell) return;
    const icon = cell.getAttribute('data-icon');
    if (icon && _activeCallback) {
      _activeCallback(icon);
    }
    closeIconPicker();
  });
}

function _onKey(e) {
  if (e.key === 'Escape') closeIconPicker();
}

export function openIconPicker({ onPick, anchorLabel } = {}) {
  if (_modalEl) closeIconPicker();
  _activeCallback = onPick;
  _activeCategoryId = ICON_CATEGORIES[0].id;

  const wrap = document.createElement('div');
  wrap.innerHTML = _renderModalHTML(anchorLabel);
  _modalEl = wrap.firstElementChild;
  document.body.appendChild(_modalEl);

  // Animation d'entrée (next tick)
  requestAnimationFrame(() => _modalEl?.classList.add('is-shown'));

  _wireEvents();
}

export function closeIconPicker() {
  if (!_modalEl) return;
  _modalEl.classList.remove('is-shown');
  const node = _modalEl;
  setTimeout(() => {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }, 200);
  document.removeEventListener('keydown', _onKey);
  _modalEl = null;
  _activeCallback = null;
}

/**
 * Insère un emoji à la position du curseur dans un input ou textarea.
 * Si l'élément n'a pas le focus, ajoute en fin. Déclenche l'événement
 * input pour notifier les listeners (master-renderer met à jour le store).
 */
export function insertIconAtCaret(el, icon) {
  if (!el || !icon) return;
  const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  if (!isInput) return;
  const start = el.selectionStart;
  const end   = el.selectionEnd;
  const val   = el.value || '';
  if (start != null && end != null) {
    el.value = val.slice(0, start) + icon + val.slice(end);
    const pos = start + icon.length;
    try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
  } else {
    el.value = val + icon;
  }
  el.focus();
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
