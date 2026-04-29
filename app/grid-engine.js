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
let _editTriggered = false;

export function initGridEngine(container, onOpen, onPadChanged, onDeactivate) {
    _setupDragDrop(container);
    _setupEditMode(container, onPadChanged, onDeactivate);
    _setupClickDelegate(container, onOpen);
}

// ═══════════════════════════════════════════════════════════════
// DRAG & DROP — Ghost pattern, leap-frog distance-based
// ─────────────────────────────────────────────────────────────
//  · ghost (clone) suit le curseur en position:fixed
//  · src reste en DOM avec class .dragging (visuel : effacé)
//  · à chaque pointermove : on cherche la carte LA PLUS PROCHE du curseur
//    (distance euclidienne au centre) → permet le leap-frog multi-cran
//  · src est inséré before/after selon position X relative au centre
//  · pointerup → ghost retiré, ordre persisté
// ═══════════════════════════════════════════════════════════════
const DRAG_THRESHOLD = 5; // px avant d'activer le drag réel

function _setupDragDrop(container) {
    container.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;                          // clic gauche uniquement
        const handle = e.target.closest('.pad-drag-handle');
        if (!handle) return;
        const src = handle.closest('.pad-card');
        if (!src) return;

        e.preventDefault();
        e.stopPropagation();
        _cancelLongPress();
        src.classList.remove('pad-pressing');

        const startX  = e.clientX;
        const startY  = e.clientY;
        const sRect   = src.getBoundingClientRect();
        const offsetX = startX - sRect.left;
        const offsetY = startY - sRect.top;
        const W       = sRect.width;
        const H       = sRect.height;

        let active = false;
        let ghost  = null;

        try { handle.setPointerCapture(e.pointerId); } catch (_) {}

        const onMove = ev => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            if (!active) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                active = true;
                document.body.classList.add('ks-dragging');
                src.classList.add('dragging');

                // Ghost = clone visuel qui suit le curseur 1:1
                ghost = src.cloneNode(true);
                ghost.classList.remove('dragging', 'pad-pressing', 'editing');
                ghost.classList.add('pad-card-ghost');
                ghost.style.cssText =
                    `position:fixed;top:0;left:0;width:${W}px;height:${H}px;` +
                    `pointer-events:none;z-index:10000;margin:0;will-change:transform;`;
                document.body.appendChild(ghost);
            }

            // Position du ghost : suit le curseur sans aucune latence
            ghost.style.transform =
                `translate3d(${ev.clientX - offsetX}px, ${ev.clientY - offsetY}px, 0) scale(1.03)`;

            // Cible = carte LA PLUS PROCHE du curseur (autorise le leap-frog)
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

            // Insertion before/after — prend en compte X ET Y pour gérer
            // les déplacements verticaux (haut/bas) et horizontaux (gauche/droite).
            const r  = best.getBoundingClientRect();
            const cx = r.left + r.width  / 2;
            const cy = r.top  + r.height / 2;
            // Si la cible est sur une autre rangée que le curseur (différence Y > height/2),
            // on décide before/after sur Y. Sinon, on décide sur X.
            const verticalMove = Math.abs(ev.clientY - cy) > r.height / 2;
            const before = verticalMove
                ? (ev.clientY < cy)
                : (ev.clientX < cx);

            const willMove = before
                ? (best.previousElementSibling !== src)
                : (best.nextElementSibling     !== src);

            if (!willMove) return;

            // FLIP : capture les positions, fait le move, anime les deltas
            const movables = cards; // toutes les cartes sauf src
            const before_  = new Map();
            for (const c of movables) before_.set(c, c.getBoundingClientRect());

            if (before) best.before(src); else best.after(src);

            for (const c of movables) {
                const o = before_.get(c);
                const n = c.getBoundingClientRect();
                const dx = o.left - n.left;
                const dy = o.top  - n.top;
                if (dx === 0 && dy === 0) continue;
                c.style.transition = 'none';
                c.style.transform  = `translate(${dx}px, ${dy}px)`;
                // Force reflow puis enclenche la transition retour à 0
                void c.offsetWidth;
                c.style.transition = 'transform .26s cubic-bezier(.25,.8,.25,1)';
                c.style.transform  = '';
            }
        };

        const cleanup = () => {
            try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
            handle.removeEventListener('pointermove',   onMove);
            handle.removeEventListener('pointerup',     onUp);
            handle.removeEventListener('pointercancel', onUp);
            window.removeEventListener('pointerup',     onUp);
            window.removeEventListener('pointercancel', onUp);

            document.body.classList.remove('ks-dragging');
            src.classList.remove('dragging');
            ghost?.remove();
            ghost = null;
            // Nettoie les inline styles du FLIP sur les cartes
            container.querySelectorAll('.pad-card').forEach(c => {
                c.style.transition = '';
                c.style.transform  = '';
            });
            if (active) _persistOrder(container);
        };
        const onUp = () => cleanup();

        handle.addEventListener('pointermove',   onMove);
        handle.addEventListener('pointerup',     onUp);
        handle.addEventListener('pointercancel', onUp);
        window.addEventListener('pointerup',     onUp,     { once: true });
        window.addEventListener('pointercancel', onUp,     { once: true });
    });

    // Sécurité : aucune drag native HTML5
    container.addEventListener('dragstart', e => e.preventDefault());
}

function _persistOrder(container) {
    const ids = [...container.querySelectorAll('.pad-card')].map(c => c.dataset.id);
    saveOrder(ids);
}

// ═══════════════════════════════════════════════════════════════
// EDIT MODE (Long Press 3s + Clic Droit)
// ═══════════════════════════════════════════════════════════════
let _longPressTimer = null;
let _lpStartX = 0;
let _lpStartY = 0;
const LP_THRESHOLD = 8; // px — déplacement max toléré avant d'annuler le long press

function _setupEditMode(container, onPadChanged, onDeactivate) {
    // Clic droit
    container.addEventListener('contextmenu', e => {
        const card = e.target.closest('.pad-card');
        if (!card) return;
        e.preventDefault();
        _triggerEditMode(card, onPadChanged, onDeactivate);
    });

    // Long press — pointer events (mobile + desktop)
    container.addEventListener('pointerdown', e => {
        if (e.button !== 0) return; // clic gauche uniquement
        const card = e.target.closest('.pad-card');
        if (!card || card.classList.contains('pad-renaming')) return; // pas pendant un rename

        // Ne pas démarrer le long-press depuis la poignée (réservée au drag)
        if (e.target.closest('.pad-drag-handle')) return;

        _editTriggered = false;
        _lpStartX = e.clientX;
        _lpStartY = e.clientY;
        // Feedback visuel dès le début de l'appui
        card.classList.add('pad-pressing');
        _longPressTimer = setTimeout(() => {
            navigator.vibrate?.(120);
            card.classList.remove('pad-pressing');
            _editTriggered = true;
            _triggerEditMode(card, onPadChanged, onDeactivate);
        }, 3000);
    });

    // Annuler si relâché avant 3s
    container.addEventListener('pointerup', e => {
        const card = e.target.closest('.pad-card');
        card?.classList.remove('pad-pressing');
        _cancelLongPress();
    });
    container.addEventListener('pointercancel', e => {
        const card = e.target.closest('.pad-card');
        card?.classList.remove('pad-pressing');
        _cancelLongPress();
    });

    // Annuler uniquement si déplacement significatif (évite les micro-tremblements)
    container.addEventListener('pointermove', e => {
        if (!_longPressTimer) return;
        const dx = Math.abs(e.clientX - _lpStartX);
        const dy = Math.abs(e.clientY - _lpStartY);
        if (dx > LP_THRESHOLD || dy > LP_THRESHOLD) {
            const card = e.target.closest('.pad-card');
            card?.classList.remove('pad-pressing');
            _cancelLongPress();
        }
    });

    // Dismiss edit bar au clic extérieur (capture phase)
    document.addEventListener('click', e => {
        if (!e.target.closest('.pad-card.editing') && !e.target.closest('.pad-edit-bar')) {
            _dismissEditBar();
        }
    }, true);
}

function _cancelLongPress() {
    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
}

// ── Barre d'édition FLOTTANTE (position: fixed · body) ───────
let _activeEditCard      = null;
let _floatBar            = null;
let _floatScrollHandler  = null;

function _triggerEditMode(card, onPadChanged, onDeactivate) {
    _cancelLongPress();
    if (_activeEditCard === card) { _dismissEditBar(); return; } // toggle
    _dismissEditBar();

    card.classList.add('editing');
    _activeEditCard = card;
    _editTriggered  = true;

    // Barre flottante — attachée au body, jamais au card
    const bar = document.createElement('div');
    bar.className = 'pad-edit-bar';
    bar.innerHTML = `
        <button class="pad-edit-bar-btn" data-action="rename">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Renommer
        </button>
        <div class="pad-edit-bar-sep"></div>
        <button class="pad-edit-bar-btn" data-action="hide">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            Masquer
        </button>
        <div class="pad-edit-bar-sep"></div>
        <button class="pad-edit-bar-btn danger" data-action="delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
            Désactiver
        </button>
    `;

    document.body.appendChild(bar);
    _floatBar = bar;
    _positionFloatingBar(card, bar);

    // Repositionner lors du scroll/resize
    _floatScrollHandler = () => { if (_activeEditCard === card) _positionFloatingBar(card, bar); };
    window.addEventListener('scroll', _floatScrollHandler, { passive: true });
    window.addEventListener('resize', _floatScrollHandler, { passive: true });

    bar.querySelector('[data-action="rename"]').addEventListener('click', e => {
        e.stopPropagation();
        _dismissEditBar();
        _startRename(card);
    });

    // Masquer : l'outil reste actif (quota occupé) mais disparaît de la vue
    bar.querySelector('[data-action="hide"]').addEventListener('click', e => {
        e.stopPropagation();
        _dismissEditBar();
        hidePad(card.dataset.id);
        card.classList.add('pad-removing');
        setTimeout(() => {
            const grid = card.closest('.pads-grid');
            card.remove();
            if (grid) _persistOrder(grid);
            _refreshSectionCount();
            onPadChanged?.();
        }, 380);
    });

    bar.querySelector('[data-action="delete"]').addEventListener('click', e => {
        e.stopPropagation();
        _dismissEditBar();
        _confirmDeactivate(card, onPadChanged, onDeactivate);
    });

    // Reset flag après un court délai pour ne pas bloquer les clicks suivants
    setTimeout(() => { _editTriggered = false; }, 400);
}

function _positionFloatingBar(card, bar) {
    const rect = card.getBoundingClientRect();
    const barH = 38;
    let top = rect.bottom + 6;
    // Retourner au-dessus si trop près du bas de l'écran
    if (top + barH > window.innerHeight - 8) top = rect.top - barH - 6;
    bar.style.top   = top + 'px';
    bar.style.left  = rect.left + 'px';
    bar.style.width = rect.width + 'px';
}

function _dismissEditBar() {
    if (_floatBar) { _floatBar.remove(); _floatBar = null; }
    if (_floatScrollHandler) {
        window.removeEventListener('scroll', _floatScrollHandler);
        window.removeEventListener('resize', _floatScrollHandler);
        _floatScrollHandler = null;
    }
    _activeEditCard?.classList.remove('editing');
    _activeEditCard = null;
}

/** Expose publique — utilisée par le listener Esc global */
export function dismissEditMode() { _dismissEditBar(); }

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

// ── Désactiver (retire du dashboard + retourne dans KEY-STORE) ─
function _confirmDeactivate(card, onPadChanged, onDeactivate) {
    const id   = card.dataset.id;
    const name = card.querySelector('.pad-name')?.textContent || id;

    const overlay = document.createElement('div');
    overlay.className = 'pad-confirm-overlay';
    overlay.innerHTML = `
        <div class="pad-confirm-msg" style="font-size:11px;line-height:1.5;">Désactiver<br><strong>${name}</strong> ?<br><span style="font-size:9.5px;opacity:.6;font-weight:400">L'outil retourne dans le catalogue KEY-STORE.</span></div>
        <div class="pad-confirm-btns">
            <button class="pad-confirm-btn cancel">Annuler</button>
            <button class="pad-confirm-btn confirm">Désactiver</button>
        </div>
    `;

    card.appendChild(overlay);

    overlay.querySelector('.cancel').addEventListener('click', e => {
        e.stopPropagation();
        overlay.remove();
    });
    overlay.querySelector('.confirm').addEventListener('click', e => {
        e.stopPropagation();
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
    });
}

// ── Helpers ───────────────────────────────────────────────────
function _refreshSectionCount() {
    const count = document.querySelectorAll('#pads-container .pad-card').length;
    const countEl = document.querySelector('.pads-section .sec-count');
    if (countEl) countEl.textContent = count;
}

// ── Click delegate (évite conflit drag/longpress/click/rename) ─
function _setupClickDelegate(container, onOpen) {
    container.addEventListener('click', e => {
        if (_editTriggered) { _editTriggered = false; return; }
        const card = e.target.closest('.pad-card');
        if (!card) return;
        // Bloquer si : barre edit ouverte, overlay confirm, ou rename en cours
        if (card.classList.contains('editing'))      return;
        if (card.classList.contains('pad-renaming')) return;
        if (card.querySelector('.pad-confirm-overlay')) return;
        onOpen(card.dataset.id);
    });
}
