/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Grid Engine v1.0 (Sprint A)
   Features : Drag & Drop · Long Press · Rename · Hide/Restore
   Principes : ID_KSTORE immuable / USER_LABEL modifiable
   ═══════════════════════════════════════════════════════════════ */

const LS_ORDER       = 'ks_grid_order';
const LS_LABEL       = 'ks_label_';
const LS_HIDDEN      = 'ks_hidden_';
const LS_DEACTIVATED = 'ks_deactivated_';

// ── LocalStorage helpers ─────────────────────────────────────
export const getSavedOrder     = ()        => JSON.parse(localStorage.getItem(LS_ORDER) || 'null');
export const saveOrder         = ids       => localStorage.setItem(LS_ORDER, JSON.stringify(ids));
export const getUserLabel      = id        => localStorage.getItem(LS_LABEL + id) || null;
export const saveUserLabel     = (id, lbl) => lbl ? localStorage.setItem(LS_LABEL + id, lbl) : localStorage.removeItem(LS_LABEL + id);
export const isPadHidden       = id        => localStorage.getItem(LS_HIDDEN + id) === '1';
export const hidePad           = id        => localStorage.setItem(LS_HIDDEN + id, '1');
export const restorePad        = id        => localStorage.removeItem(LS_HIDDEN + id);
export const isPadDeactivated  = id        => localStorage.getItem(LS_DEACTIVATED + id) === '1';
export const deactivatePad     = id        => localStorage.setItem(LS_DEACTIVATED + id, '1');
export const reactivatePad     = id        => localStorage.removeItem(LS_DEACTIVATED + id);

// ── Init ─────────────────────────────────────────────────────
// `renderDashboard()` est rejoué à chaque changement (login, licence,
// pad masqué/restauré…) mais réutilise le MÊME nœud `#pads-container`.
// On ne branche donc les listeners qu'UNE seule fois pour éviter de les
// empiler — sinon un clic « ⋯ » déclenche le délégué N fois et la modale
// d'édition se rouvre/referme en boucle. Les callbacks, eux, sont
// rafraîchis à chaque appel via `_callbacks` (onPadChanged capture
// `ownedTools`, qui change d'un render à l'autre).
let _callbacks = { onOpen: null, onPadChanged: null, onDeactivate: null };

export function initGridEngine(container, onOpen, onPadChanged, onDeactivate) {
    _callbacks = { onOpen, onPadChanged, onDeactivate };
    if (container.dataset.gridEngineBound === '1') return;
    container.dataset.gridEngineBound = '1';
    _setupDragDrop(container);
    _setupClicks(container);
}

// ═══════════════════════════════════════════════════════════════
// DRAG & DROP — carte entière saisissable
// ─────────────────────────────────────────────────────────────
// pointerdown → on suit le pointeur ; au-delà de DRAG_THRESHOLD on
// bascule en drag (ghost qui suit le curseur, réorganisation leap-frog).
// Sous le seuil, c'est un simple tap → géré par le click delegate.
// Le bouton « ⋯ » (.pad-edit-trigger, coin haut-droit) est exclu : il
// ouvre la modale d'édition, il ne déclenche jamais de drag.
// ═══════════════════════════════════════════════════════════════
const DRAG_THRESHOLD = 10;   // px de mouvement franc → c'est un drag
let _dragJustHappened = false;

function _setupDragDrop(container) {
    container.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;                       // clic gauche / tap uniquement
        const card = e.target.closest('.pad-card');
        if (!card) return;
        // Jamais de drag : depuis le bouton d'édition, pendant un rename,
        // ni depuis un champ éditable.
        if (e.target.closest('.pad-edit-trigger')) return;
        if (card.classList.contains('pad-renaming')) return;
        if (e.target.closest('[contenteditable]')) return;

        const startX  = e.clientX;
        const startY  = e.clientY;
        const sRect   = card.getBoundingClientRect();
        const offsetX = startX - sRect.left;
        const offsetY = startY - sRect.top;
        const W       = sRect.width;
        const H       = sRect.height;

        let mode  = 'pending';   // 'pending' | 'drag'
        let ghost = null;

        // Bloque la sélection de texte native pendant le geste
        document.body.classList.add('ks-no-select');

        const onMove = ev => {
            const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);

            if (mode === 'pending') {
                if (dist < DRAG_THRESHOLD) return;
                mode = 'drag';
                document.body.classList.add('ks-dragging');
                card.classList.add('dragging');
                ghost = card.cloneNode(true);
                ghost.classList.remove('dragging', 'editing');
                ghost.classList.add('pad-card-ghost');
                ghost.style.cssText =
                    `position:fixed;top:0;left:0;width:${W}px;height:${H}px;` +
                    `pointer-events:none;z-index:10000;margin:0;will-change:transform;`;
                document.body.appendChild(ghost);
            }

            if (mode !== 'drag') return;
            ev.preventDefault();
            ghost.style.transform =
                `translate3d(${ev.clientX - offsetX}px, ${ev.clientY - offsetY}px, 0) scale(1.03)`;
            _dragReorder(container, card, ev);
        };

        const onUp = () => {
            window.removeEventListener('pointermove',   onMove);
            window.removeEventListener('pointerup',     onUp);
            window.removeEventListener('pointercancel', onUp);
            document.body.classList.remove('ks-no-select');

            if (mode === 'drag') {
                document.body.classList.remove('ks-dragging');
                card.classList.remove('dragging');
                ghost?.remove();
                ghost = null;
                container.querySelectorAll('.pad-card').forEach(c => {
                    c.style.transition = '';
                    c.style.transform  = '';
                });
                _persistOrder(container);
                // Empêche le clic d'ouverture qui suit immédiatement le drop
                _dragJustHappened = true;
                setTimeout(() => { _dragJustHappened = false; }, 80);
            }
            // mode 'pending' → simple tap → le click delegate ouvre l'outil
        };

        window.addEventListener('pointermove',   onMove);
        window.addEventListener('pointerup',     onUp);
        window.addEventListener('pointercancel', onUp);
    });

    // Sécurité : aucune drag native HTML5
    container.addEventListener('dragstart', e => e.preventDefault());
}

// Réorganisation pendant un drag : insère `src` à côté de la carte la
// plus proche du curseur (leap-frog), avec animation FLIP des voisines.
function _dragReorder(container, src, ev) {
    const cards = [...container.querySelectorAll('.pad-card')].filter(c => c !== src);
    if (!cards.length) return;

    let best = null, bestDist = Infinity;
    for (const c of cards) {
        const r  = c.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top  + r.height / 2;
        const d  = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        if (d < bestDist) { bestDist = d; best = c; }
    }
    if (!best) return;

    // Insertion before/after — gère les déplacements verticaux ET horizontaux.
    const r  = best.getBoundingClientRect();
    const cx = r.left + r.width  / 2;
    const cy = r.top  + r.height / 2;
    const verticalMove = Math.abs(ev.clientY - cy) > r.height / 2;
    const before = verticalMove ? (ev.clientY < cy) : (ev.clientX < cx);

    const willMove = before
        ? (best.previousElementSibling !== src)
        : (best.nextElementSibling     !== src);
    if (!willMove) return;

    // FLIP : capture les positions, fait le move, anime les deltas
    const before_ = new Map();
    for (const c of cards) before_.set(c, c.getBoundingClientRect());

    if (before) best.before(src); else best.after(src);

    for (const c of cards) {
        const o = before_.get(c);
        const n = c.getBoundingClientRect();
        const ddx = o.left - n.left;
        const ddy = o.top  - n.top;
        if (ddx === 0 && ddy === 0) continue;
        c.style.transition = 'none';
        c.style.transform  = `translate(${ddx}px, ${ddy}px)`;
        void c.offsetWidth;
        c.style.transition = 'transform .26s cubic-bezier(.25,.8,.25,1)';
        c.style.transform  = '';
    }
}

function _persistOrder(container) {
    const ids = [...container.querySelectorAll('.pad-card')].map(c => c.dataset.id);
    saveOrder(ids);
}

// ═══════════════════════════════════════════════════════════════
// MODE ÉDITION — modale centrée (Renommer / Masquer / Désactiver)
// ─────────────────────────────────────────────────────────────
// Déclenchée par un clic sur le bouton « ⋯ » (.pad-edit-trigger) en
// haut-droite de chaque Pad. Modale centrée + backdrop : on ferme via
// la croix « Fermer » ou en cliquant à côté (le backdrop). Net et fiable.
// ═══════════════════════════════════════════════════════════════

// ── Modale d'édition de pad ──────────────────────────────────
let _activeEditCard   = null;
let _editModalEls     = null;   // { backdrop, modal }
let _editModalOpenedAt = 0;     // garde anti double-événement à l'ouverture

const _EDIT_ICONS = {
    rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    hide:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>',
};

function _openPadEditModal(card, onPadChanged, onDeactivate) {
    // Toggle : re-déclencher sur la même carte referme la modale
    if (_activeEditCard === card) { _closePadEditModal(); return; }
    _closePadEditModal();

    _activeEditCard = card;
    card.classList.add('editing');
    // Efface toute sélection de texte amorcée pendant l'appui
    try { window.getSelection()?.removeAllRanges(); } catch (_) {}

    const id       = card.dataset.id;
    const name     = card.querySelector('.pad-name')?.textContent?.trim() || id;
    const iconHtml = card.querySelector('.pad-icon')?.innerHTML || '';
    const _esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const backdrop = document.createElement('div');
    backdrop.className = 'pad-edit-backdrop';

    const modal = document.createElement('div');
    modal.className = 'pad-edit-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Modifier ' + name);
    modal.innerHTML = `
        <div class="pad-edit-modal-head">
            <div class="pad-edit-modal-ico">${iconHtml}</div>
            <div class="pad-edit-modal-name">${_esc(name)}</div>
        </div>
        <div class="pad-edit-modal-body" data-slot="body">
            <button class="pad-edit-action" data-action="rename">
                <span class="pad-edit-action-ico">${_EDIT_ICONS.rename}</span>
                <span class="pad-edit-action-txt"><strong>Renommer</strong><em>Changer le nom affiché</em></span>
            </button>
            <button class="pad-edit-action" data-action="hide">
                <span class="pad-edit-action-ico">${_EDIT_ICONS.hide}</span>
                <span class="pad-edit-action-txt"><strong>Masquer</strong><em>Le retirer de la vue (reste actif)</em></span>
            </button>
            <button class="pad-edit-action danger" data-action="delete">
                <span class="pad-edit-action-ico">${_EDIT_ICONS.delete}</span>
                <span class="pad-edit-action-txt"><strong>Désactiver</strong><em>Le renvoyer dans le Key-Store</em></span>
            </button>
        </div>
        <button class="pad-edit-modal-close" data-action="cancel">Fermer</button>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    _editModalEls = { backdrop, modal };
    _editModalOpenedAt = Date.now();
    requestAnimationFrame(() => {
        backdrop.classList.add('open');
        modal.classList.add('open');
    });

    // Le « clic de relâchement » qui suit un appui long retombe sur le
    // backdrop (qui couvre tout) : on l'ignore pendant 400 ms pour ne
    // pas refermer la modale aussitôt ouverte.
    backdrop.addEventListener('click', () => {
        if (Date.now() - _editModalOpenedAt < 400) return;
        _closePadEditModal();
    });

    modal.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.action;

        if (action === 'cancel') { _closePadEditModal(); return; }
        if (action === 'rename') { _closePadEditModal(); _startRename(card); return; }
        if (action === 'hide')   { _closePadEditModal(); _doHide(card, onPadChanged); return; }
        if (action === 'delete') {
            // Bascule la modale en confirmation (tout reste dans la modale)
            modal.querySelector('[data-slot="body"]').innerHTML = `
                <div class="pad-edit-confirm">
                    <p class="pad-edit-confirm-msg">Désactiver <strong>${_esc(name)}</strong> ?</p>
                    <p class="pad-edit-confirm-sub">L'outil retourne dans le catalogue Key-Store. Vous pourrez le réinstaller à tout moment.</p>
                    <div class="pad-edit-confirm-btns">
                        <button class="pad-edit-action pad-edit-action--ghost" data-action="cancel">Annuler</button>
                        <button class="pad-edit-action danger" data-action="confirm-delete">Désactiver</button>
                    </div>
                </div>`;
            return;
        }
        if (action === 'confirm-delete') {
            _closePadEditModal();
            _doDeactivate(card, onPadChanged, onDeactivate);
            return;
        }
    });
}

function _closePadEditModal() {
    if (_editModalEls) {
        const { backdrop, modal } = _editModalEls;
        backdrop.classList.remove('open');
        modal.classList.remove('open');
        setTimeout(() => { backdrop.remove(); modal.remove(); }, 200);
        _editModalEls = null;
    }
    _activeEditCard?.classList.remove('editing');
    _activeEditCard = null;
}

/** Expose publique — utilisée par le listener Esc global de ui-renderer */
export function dismissEditMode() { _closePadEditModal(); }

// ── Actions d'édition ────────────────────────────────────────
// Masquer : l'outil reste actif (quota occupé) mais disparaît de la vue.
function _doHide(card, onPadChanged) {
    hidePad(card.dataset.id);
    card.classList.add('pad-removing');
    setTimeout(() => {
        const grid = card.closest('.pads-grid');
        card.remove();
        if (grid) _persistOrder(grid);
        _refreshSectionCount();
        onPadChanged?.();
    }, 380);
}

// Désactiver : retire l'outil du Dashboard et le renvoie au Key-Store.
function _doDeactivate(card, onPadChanged, onDeactivate) {
    const id = card.dataset.id;
    deactivatePad(id);
    // Synchroniser ks_user_selection : libérer la place de quota
    try {
        const raw = localStorage.getItem('ks_user_selection');
        if (raw) {
            const sel = JSON.parse(raw).filter(x => x !== id);
            localStorage.setItem('ks_user_selection', JSON.stringify(sel));
        }
    } catch (_) {}
    card.classList.add('pad-removing');
    setTimeout(() => {
        const grid = card.closest('.pads-grid');
        card.remove();
        if (grid) _persistOrder(grid);
        _refreshSectionCount();
        onPadChanged?.();
        onDeactivate?.(id);
    }, 380);
}

// ── Rename ────────────────────────────────────────────────────
function _startRename(card) {
    const nameEl = card.querySelector('.pad-name');
    if (!nameEl) return;

    const id   = card.dataset.id;
    const orig = nameEl.textContent;

    // Marquer la carte EN COURS DE RENAME pour bloquer onOpen et le long press
    card.classList.add('pad-renaming');

    nameEl.setAttribute('contenteditable', 'plaintext-only');
    nameEl.classList.add('renaming');
    nameEl.focus();

    // Sélection du texte entier au départ
    try {
        const range = document.createRange();
        range.selectNodeContents(nameEl);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
    } catch (_) {}

    const _commit = () => {
        nameEl.removeAttribute('contenteditable');
        nameEl.classList.remove('renaming');
        card.classList.remove('pad-renaming'); // libérer la carte
        const newLabel = nameEl.textContent.trim();
        if (newLabel && newLabel !== orig) {
            saveUserLabel(id, newLabel);
        } else {
            nameEl.textContent = orig; // revert
        }
    };

    const _onKeydown = e => {
        if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); nameEl.blur(); }
        if (e.key === 'Escape') { nameEl.textContent = orig; nameEl.blur(); }
    };

    // Stopper la propagation des clics dans le champ — évite d'ouvrir le pad
    const _onPointerDown = e => e.stopPropagation();
    const _onClick       = e => e.stopPropagation();

    nameEl.addEventListener('pointerdown', _onPointerDown);
    nameEl.addEventListener('click',       _onClick);
    nameEl.addEventListener('keydown',     _onKeydown);
    nameEl.addEventListener('blur', () => {
        nameEl.removeEventListener('pointerdown', _onPointerDown);
        nameEl.removeEventListener('click',       _onClick);
        nameEl.removeEventListener('keydown',     _onKeydown);
        _commit();
    }, { once: true });
}

// ── Helpers ───────────────────────────────────────────────────
function _refreshSectionCount() {
    const count = document.querySelectorAll('#pads-container .pad-card').length;
    const countEl = document.querySelector('.pads-section .sec-count');
    if (countEl) countEl.textContent = count;
}

// ── Clics sur la grille ───────────────────────────────────────
// Un seul délégué : le bouton « ⋯ » ouvre la modale d'édition ; un clic
// ailleurs sur la carte ouvre l'outil. Le drag est géré séparément.
function _setupClicks(container) {
    container.addEventListener('click', e => {
        // 1) Bouton d'édition « ⋯ » → modale d'édition du Pad
        const trigger = e.target.closest('.pad-edit-trigger');
        if (trigger) {
            e.stopPropagation();
            const card = trigger.closest('.pad-card');
            if (card && !card.classList.contains('pad-renaming')) {
                _openPadEditModal(card, _callbacks.onPadChanged, _callbacks.onDeactivate);
            }
            return;
        }

        // 2) Clic ailleurs sur la carte → ouverture de l'outil
        if (_dragJustHappened) return;   // un drag vient de se terminer
        if (_editModalEls) return;       // une modale d'édition est ouverte
        const card = e.target.closest('.pad-card');
        if (!card) return;
        if (card.classList.contains('editing'))      return;
        if (card.classList.contains('pad-renaming')) return;
        _callbacks.onOpen(card.dataset.id);
    });
}
