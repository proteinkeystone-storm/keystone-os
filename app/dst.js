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

    _ensureRotation({ jumpTo: 0 });
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
 *
 * NB : depuis la rotation unifiée, la priorité contrôle l'ORDRE
 * dans le cycle (les P1 passent en premier), pas l'exclusion :
 * les P2/P3 conservent leur tour même si un P1 est épinglé.
 */
export function setKeystoneStatus(content, type = 'default', duration = 0, priority = 2) {
    // Retirer l'éventuel ancien message de même priorité (sauf P3 qui est le socle)
    if (priority < 3) {
        _queue = _queue.filter(m => m.priority !== priority);
    }

    _queue.push({ priority, content, type, duration });
    _queue.sort((a, b) => a.priority - b.priority); // P1 en tête

    clearTimeout(_timer);
    // Nouveau message haute priorité → on saute dessus dans la rotation
    _ensureRotation({ jumpTo: 0 });

    if (duration > 0) {
        _timer = setTimeout(() => {
            _queue = _queue.filter(m => m.priority >= 3 || m.content !== content);
            _ensureRotation();
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
    _ensureRotation({ jumpTo: 0 });
    return true;
}

/**
 * Mise à jour observable du message par défaut (liaison Admin).
 * Appelé quand `current_status_msg` change (localStorage / événement).
 */
export function setDefaultStatus(content) {
    if (DEFAULT_MSG.content === content) return; // inchangé → pas de ré-animation
    DEFAULT_MSG.content = content;
    const p3 = _queue.find(m => m.priority === 3);
    if (p3) p3.content = content;
    // Si pas de pool, le défaut entre dans la rotation : on rebuild.
    if (_defaultPool.length === 0) _ensureRotation();
}

/**
 * Définit le pool de messages d'accueil (rotation P3). Toutes les
 * entrées du pool prennent leur tour dans la rotation unifiée.
 */
let _defaultPool = [];

export function setDefaultStatusPool(messages) {
    const pool = (messages || []).filter(Boolean);
    if (!pool.length) return;
    if (pool.length === _defaultPool.length && pool.every((m, i) => m === _defaultPool[i])) return;
    _defaultPool = pool;
    _ensureRotation();
}

// ═══════════════════════════════════════════════════════════════
// ROTATION UNIFIÉE — TOUS les niveaux de priorité tournent ensemble
// ─────────────────────────────────────────────────────────────
// Modèle précédent (priorité stricte) : un message Admin (P1)
// permanent supprimait totalement le Coach (P2) et le défaut (P3).
// Conséquence : le « temps gagné » ne s'affichait jamais si l'admin
// avait épinglé un message.
//
// Nouveau modèle : la liste d'affichage = [P1*, P2*, ...P3 pool],
// la rotation cycle dessus toutes les DISPLAY_MS. Priorité = ORDRE
// (les P1 passent en premier de chaque cycle), pas EXCLUSION — tout
// le monde a son tour.
// ═══════════════════════════════════════════════════════════════
const DISPLAY_MS = 9000;
let _displayList   = [];
let _displayIdx    = 0;
let _rotationTimer = null;

function _buildDisplayList() {
    const high = _queue.filter(m => m.priority < 3);
    const pool = _defaultPool.length
        ? _defaultPool.map(content => ({
              priority: 3,
              content,
              type:     DEFAULT_MSG.type,
              duration: 0,
          }))
        : [{ ...DEFAULT_MSG }];
    return [...high, ...pool];
}

function _ensureRotation({ jumpTo = null } = {}) {
    _displayList = _buildDisplayList();
    if (jumpTo !== null) _displayIdx = jumpTo;
    if (_displayIdx >= _displayList.length) _displayIdx = 0;

    clearInterval(_rotationTimer);
    if (_displayList.length > 1) {
        _rotationTimer = setInterval(() => {
            _displayIdx = (_displayIdx + 1) % _displayList.length;
            _renderCursor(true);
        }, DISPLAY_MS);
    }
    _renderCursor(jumpTo !== null);
}

function _renderCursor(animate) {
    if (!_dstEl || !_textEl) return;
    const msg = _displayList[_displayIdx];
    if (!msg) return;
    if (_current?.content === msg.content && _current?.type === msg.type) return;
    if (animate && _current && _current.content !== msg.content) {
        _animateChange(msg);
    } else {
        _applyMsg(msg, animate);
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

const _emphasized = s => s === 'accent' || s === 'action' || s === 'bold';

/**
 * Rendu « motion graphic » : chaque caractère jaillit dans sa position
 * (ressort + rotation + flou qui se résorbe). Structure DOM :
 *   segment → mot (insécable) → caractère animé.
 * Les mots assurent un retour à la ligne propre ; les caractères
 * portent l'animation. Vitesse de révélation variable (respiration
 * sur la ponctuation, ralenti sur les mots forts).
 */
function _typeMessage(segments) {
    const token = ++_typeToken;
    _textEl.innerHTML = '';
    _textEl.classList.add('dst-typing');

    const charSpans = [];   // ordre de révélation : { el, strong, seg }

    segments.forEach(seg => {
        const tag = seg.style === 'bold' ? 'b' : seg.style === 'italic' ? 'i' : 'span';
        const segEl = document.createElement(tag);
        segEl.className = 'dst-seg dst-seg--' + seg.style;
        if (seg.style === 'action') {
            segEl.dataset.dstAction = seg.action;
            segEl.setAttribute('role', 'button');
            segEl.tabIndex = 0;
        }
        const strong = _emphasized(seg.style);

        // Découpe en mots + espaces (séparateurs conservés)
        seg.text.split(/(\s+)/).forEach(part => {
            if (part === '') return;
            if (/^\s+$/.test(part)) {           // espace → noeud texte (point de césure)
                segEl.appendChild(document.createTextNode(part));
                return;
            }
            const wordEl = document.createElement('span');
            wordEl.className = 'dst-word';      // insécable (white-space:nowrap en CSS)
            for (const ch of part) {
                const chEl = document.createElement('span');
                chEl.className = 'dst-ch' + (strong ? ' dst-ch--strong' : '');
                chEl.textContent = ch;
                chEl.style.visibility = 'hidden';   // réserve la place, pas de reflow
                wordEl.appendChild(chEl);
                charSpans.push({ el: chEl, strong, seg: segEl });
            }
            segEl.appendChild(wordEl);
        });
        _textEl.appendChild(segEl);
    });

    // Préférence d'accessibilité : pas d'animation → tout afficher d'un coup
    if (_prefersReducedMotion()) {
        charSpans.forEach(c => { c.el.style.visibility = ''; });
        _textEl.querySelectorAll('.dst-seg--accent,.dst-seg--action,.dst-seg--bold')
               .forEach(s => s.classList.add('dst-seg--done'));
        _textEl.classList.remove('dst-typing');
        return;
    }

    let i = 0;
    const step = () => {
        if (token !== _typeToken) return;          // un nouveau message a pris la main
        if (i >= charSpans.length) {               // terminé
            _textEl.classList.remove('dst-typing');
            return;
        }
        const { el, strong, seg } = charSpans[i];
        const ch = el.textContent;
        el.style.visibility = '';
        el.classList.add('dst-ch--in');

        // Dernier caractère d'un segment stylé → flash « pop » lumineux
        const next = charSpans[i + 1];
        if (strong && (!next || next.seg !== seg)) seg.classList.add('dst-seg--done');

        i++;

        // Vitesse variable — c'est ce qui donne du « caractère » au texte
        let delay = strong ? 44 : 24;                   // ralenti sur les mots forts
        if (',;:'.includes(ch))   delay = 230;          // courte respiration
        if ('.!?—…'.includes(ch)) delay = 470;          // ponctuation forte
        delay += Math.random() * 18 - 9;                // micro-variation organique

        setTimeout(step, Math.max(12, delay));
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
