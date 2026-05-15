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

    // Segments cliquables [[texte|action]] → événement `ks-dst-action`
    // (ex. le temps gagné ouvre la modale de détail par outil).
    const _fireAction = el =>
        document.dispatchEvent(new CustomEvent('ks-dst-action', { detail: el.dataset.dstAction }));
    _dstEl.addEventListener('click', e => {
        const a = e.target.closest('[data-dst-action]');
        if (a) _fireAction(a);
    });
    _dstEl.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const a = e.target.closest('[data-dst-action]');
        if (a) { e.preventDefault(); _fireAction(a); }
    });

    _render(false); // premier affichage — la machine à écrire se lance
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
    if (DEFAULT_MSG.content === content) return; // inchangé → pas de ré-animation
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
// RENDU & ANIMATION — texte « motion graphic »
// ─────────────────────────────────────────────────────────────
// Machine à écrire à vitesse variable : respiration sur la
// ponctuation, ralenti sur les mots forts, micro-variation
// organique, curseur clignotant, flash lumineux sur les segments
// stylés une fois écrits. Markup supporté dans TOUS les messages
// (défaut, Coach, Admin/Inbox) :
//   **gras**   *italique*   ==accent==   [[texte|action]]
// ═══════════════════════════════════════════════════════════════
let _typeToken = 0;   // invalide une animation en cours si un nouveau message arrive

const _prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

/** Découpe un message en segments stylés. Texte brut → 1 segment 'normal'. */
function _parseMarkup(raw) {
    const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|==([^=]+)==|\[\[([^\]|]+)\|([^\]]+)\]\]/g;
    const out = [];
    let last = 0, m;
    while ((m = re.exec(raw))) {
        if (m.index > last) out.push({ text: raw.slice(last, m.index), style: 'normal' });
        if      (m[1] != null) out.push({ text: m[1], style: 'bold'   });
        else if (m[2] != null) out.push({ text: m[2], style: 'italic' });
        else if (m[3] != null) out.push({ text: m[3], style: 'accent' });
        else if (m[4] != null) out.push({ text: m[4], style: 'action', action: m[5] });
        last = re.lastIndex;
    }
    if (last < raw.length) out.push({ text: raw.slice(last), style: 'normal' });
    return out.length ? out : [{ text: raw, style: 'normal' }];
}

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
    _dstEl.dataset.type = msg.type;

    if (slideIn) {
        _dstEl.classList.remove('dst-in');
        void _dstEl.offsetHeight; // force reflow
        _dstEl.classList.add('dst-in');
    }

    _typeMessage(_parseMarkup(msg.content));
}

/** Machine à écrire : remplit #dst-text caractère par caractère. */
function _typeMessage(segments) {
    const token = ++_typeToken;
    _textEl.innerHTML = '';
    _textEl.classList.add('dst-typing');

    // Un span (vide) par segment + un curseur clignotant
    const spans = segments.map(seg => {
        const tag = seg.style === 'bold' ? 'b' : seg.style === 'italic' ? 'i' : 'span';
        const el  = document.createElement(tag);
        el.className = 'dst-seg dst-seg--' + seg.style;
        if (seg.style === 'action') {
            el.dataset.dstAction = seg.action;
            el.setAttribute('role', 'button');
            el.tabIndex = 0;
        }
        _textEl.appendChild(el);
        return el;
    });
    const caret = document.createElement('span');
    caret.className = 'dst-caret';
    _textEl.appendChild(caret);

    const emphasized = s => s === 'accent' || s === 'action' || s === 'bold';

    // Préférence d'accessibilité : pas d'animation → tout afficher d'un coup
    if (_prefersReducedMotion()) {
        segments.forEach((seg, i) => {
            spans[i].textContent = seg.text;
            if (emphasized(seg.style)) spans[i].classList.add('dst-seg--done');
        });
        caret.remove();
        _textEl.classList.remove('dst-typing');
        return;
    }

    let si = 0, ci = 0;
    const step = () => {
        if (token !== _typeToken) return;          // un nouveau message a pris la main
        if (si >= segments.length) {               // terminé
            _textEl.classList.remove('dst-typing');
            setTimeout(() => { if (token === _typeToken) caret.remove(); }, 1600);
            return;
        }
        const seg = segments[si];
        const ch  = seg.text[ci];
        spans[si].textContent += ch;
        ci++;

        // Segment stylé entièrement écrit → flash « pop » lumineux
        if (ci >= seg.text.length) {
            if (emphasized(seg.style)) spans[si].classList.add('dst-seg--done');
            si++; ci = 0;
        }

        // Vitesse variable — c'est ce qui donne du « caractère » au texte
        let delay = emphasized(seg.style) ? 36 : 19;   // ralenti sur les mots forts
        if (ch === ' ')           delay = 24;
        if (',;:'.includes(ch))   delay = 210;          // courte respiration
        if ('.!?—…'.includes(ch)) delay = 440;          // ponctuation forte
        delay += Math.random() * 16 - 8;                // micro-variation organique

        setTimeout(step, Math.max(8, delay));
    };
    step();
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
