/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Dynamic Status Ticker (DST) v1.0
   Priority Queue · Slide-up animation · Esc dismiss
   ═══════════════════════════════════════════════════════════════
   Priorités :
     1 = ADMIN   — alertes système forcées
     2 = IA      — messages contextuels générés par le moteur
     3 = DÉFAUT  — message de bienvenue lié à la licence
   ─────────────────────────────────────────────────────────────── */

const DEFAULT_MSG = {
    priority: 3,
    content:  'Keystone OS — Prométhée Immobilier · Prêt',
    type:     'default',
    duration: 0,
};

// ── Priority queue (tableau trié par priorité croissante) ─────
let _queue   = [{ ...DEFAULT_MSG }];
let _current = null;
let _timer   = null;

// ── DOM refs ──────────────────────────────────────────────────
let _dstEl   = null;   // #hero-dst  (div.hero-sub dans le hero)
let _textEl  = null;   // #dst-text  (span.hero-dst-text)

export function initDST() {
    _dstEl  = document.getElementById('hero-dst');
    _textEl = document.getElementById('dst-text');
    if (!_dstEl || !_textEl) return;
    _render(false); // premier affichage sans animation
}

// ═══════════════════════════════════════════════════════════════
// API PUBLIQUE
// ═══════════════════════════════════════════════════════════════

/**
 * Pousse un nouveau message dans la pile.
 * @param {string} content  — Texte affiché
 * @param {'default'|'info'|'alert'} type — Style visuel
 * @param {number} duration — ms avant retour au message inférieur (0 = permanent)
 * @param {1|2|3} priority  — Niveau de priorité (1=admin, 2=IA, 3=défaut)
 */
export function setKeystoneStatus(content, type = 'default', duration = 0, priority = 2) {
    // Retirer l'éventuel ancien message de même priorité (sauf P3 qui est le socle)
    if (priority < 3) {
        _queue = _queue.filter(m => m.priority !== priority);
    }

    _queue.push({ priority, content, type, duration });
    _queue.sort((a, b) => a.priority - b.priority); // P1 en tête

    clearTimeout(_timer);
    _render(true);

    if (duration > 0) {
        _timer = setTimeout(() => {
            _queue = _queue.filter(m => m.priority >= 3 || m.content !== content);
            _current = null;
            _render(true);
        }, duration);
    }
}

/**
 * Dismiss les messages de priorité ≤ maxPriority.
 * Esc appelle dismissDSTMessage() → retire P1 et P2, retour au message de bienvenue.
 */
export function dismissDSTMessage(maxPriority = 2) {
    const hadHigh = _queue.some(m => m.priority <= maxPriority);
    if (!hadHigh) return false; // rien à dismiss

    _queue = _queue.filter(m => m.priority > maxPriority);
    if (_queue.length === 0) _queue = [{ ...DEFAULT_MSG }];
    clearTimeout(_timer);
    _current = null;
    _render(true);
    return true;
}

/**
 * Mise à jour observable du message par défaut (liaison Admin).
 * Appelé quand `current_status_msg` change (localStorage / événement).
 */
export function setDefaultStatus(content) {
    DEFAULT_MSG.content = content;
    // Mettre à jour le message P3 existant dans la queue
    const p3 = _queue.find(m => m.priority === 3);
    if (p3) p3.content = content;
    // Si P3 est actuellement affiché, le mettre à jour directement
    if (_current?.priority === 3) {
        _current = null;
        _render(true);
    }
}

// ═══════════════════════════════════════════════════════════════
// RENDU & ANIMATION
// ═══════════════════════════════════════════════════════════════
function _render(animate) {
    if (!_dstEl || !_textEl) return;

    const top = _queue[0];
    if (!top) return;
    if (!animate && _current?.content === top.content) return;

    if (animate && _current && _current.content !== top.content) {
        _animateChange(top);
    } else {
        _applyMsg(top, false);
    }
}

function _animateChange(msg) {
    _dstEl.classList.add('dst-leaving');
    setTimeout(() => {
        _dstEl.classList.remove('dst-leaving');
        _applyMsg(msg, true);
    }, 200);
}

function _applyMsg(msg, slideIn) {
    _current = msg;
    _textEl.textContent = msg.content;
    _dstEl.dataset.type = msg.type;

    if (slideIn) {
        _dstEl.classList.remove('dst-in');
        void _dstEl.offsetHeight; // force reflow
        _dstEl.classList.add('dst-in');
    }
}

// ═══════════════════════════════════════════════════════════════
// OBSERVABLE — localStorage `current_status_msg`
// Un Admin peut écrire dans cette clé pour mettre à jour le DST
// ═══════════════════════════════════════════════════════════════
export function initDSTAdminBridge() {
    // Écoute les changements de `current_status_msg` via storage event (multi-onglet)
    window.addEventListener('storage', e => {
        if (e.key === 'current_status_msg' && e.newValue) {
            setKeystoneStatus(e.newValue, 'info', 0, 1);
        }
    });

    // Vérification initiale
    const adminMsg = localStorage.getItem('current_status_msg');
    if (adminMsg) setKeystoneStatus(adminMsg, 'info', 0, 1);
}
