/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Lock Screen Engine v1.0
   Mesh gradients animés · Horloge Apple · Auto-veille configurable
   ═══════════════════════════════════════════════════════════════ */

const LS_LOCK_ENABLED = 'ks_lock_enabled';
const LS_LOCK_DELAY   = 'ks_lock_delay';    // ms  (0 = jamais)
const LS_LOCK_STYLE   = 'ks_lock_style';    // 'abyss' | 'golden-flow' | 'nebula' | 'obsidian'

let _overlay      = null;
let _clockTimer   = null;
let _idleTimer    = null;
let _isLocked     = false;
let _style        = 'abyss';

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
export function initLockScreen() {
    _buildOverlay();
    _bindCadenas();
    _applyAutoLockSettings();

    // Rafraîchir les paramètres si Settings les modifie
    window.addEventListener('ks-lock-settings-changed', _applyAutoLockSettings);

    // Esc — déverrouille en priorité absolue (capture phase = avant tout autre handler)
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && _isLocked) {
            e.stopImmediatePropagation();
            unlock();
        }
    }, { capture: true });
}

export function isLocked() { return _isLocked; }

// ═══════════════════════════════════════════════════════════════
// LOCK / UNLOCK
// ═══════════════════════════════════════════════════════════════
export function lock() {
    if (_isLocked) return;
    _isLocked = true;
    _style = localStorage.getItem(LS_LOCK_STYLE) || 'abyss';

    _overlay.dataset.style = _style;
    _overlay.classList.add('ls-visible');
    document.body.style.overflow = 'hidden';
    _startClock();
    _resetIdleTimer(); // réarme pendant l'écran actif pour info
}

export function unlock() {
    if (!_isLocked) return;
    _isLocked = false;
    _overlay.classList.add('ls-leaving');

    setTimeout(() => {
        _overlay.classList.remove('ls-visible', 'ls-leaving');
        document.body.style.overflow = '';
    }, 420);

    _stopClock();
    _resetIdleTimer(); // repart depuis zéro en mode actif
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUCTION DU DOM
// ═══════════════════════════════════════════════════════════════
function _buildOverlay() {
    _overlay = document.createElement('div');
    _overlay.id = 'ks-lockscreen';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-label', 'Écran de veille Keystone');

    _overlay.innerHTML = `
        <!-- Mesh gradient — 5 blobs animés indépendamment -->
        <div class="ls-mesh">
            <div class="ls-blob ls-blob-1"></div>
            <div class="ls-blob ls-blob-2"></div>
            <div class="ls-blob ls-blob-3"></div>
            <div class="ls-blob ls-blob-4"></div>
            <div class="ls-blob ls-blob-5"></div>
        </div>

        <!-- Vignette bords -->
        <div class="ls-vignette"></div>

        <!-- Contenu central -->
        <div class="ls-center">
            <!-- Horloge Apple Style -->
            <div class="ls-time" id="ls-time">--:--</div>
            <div class="ls-date" id="ls-date">—</div>

            <!-- Logo Keystone avec glow pulsé -->
            <div class="ls-logo-wrap">
                <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ls-logo" id="ls-logo">
            </div>

            <!-- Hint -->
            <div class="ls-hint">Cliquez ou appuyez sur <kbd>Esc</kbd> pour déverrouiller</div>
        </div>
    `;

    document.body.appendChild(_overlay);

    // Unlock au clic sur l'overlay (pas sur les éléments enfants spécifiques)
    _overlay.addEventListener('click', unlock);
}

// ═══════════════════════════════════════════════════════════════
// HORLOGE
// ═══════════════════════════════════════════════════════════════
function _startClock() {
    _updateClock();
    _clockTimer = setInterval(_updateClock, 1000);
}

function _stopClock() {
    clearInterval(_clockTimer);
    _clockTimer = null;
}

function _updateClock() {
    const now  = new Date();
    const timeEl = document.getElementById('ls-time');
    const dateEl = document.getElementById('ls-date');
    if (!timeEl || !dateEl) return;

    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    timeEl.textContent = `${hh}:${mm}`;

    dateEl.textContent = now.toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long'
    });
}

// ═══════════════════════════════════════════════════════════════
// CADENAS — clic sur #cc-lock-chip
// ═══════════════════════════════════════════════════════════════
function _bindCadenas() {
    const chip = document.getElementById('cc-lock-chip');
    if (!chip) return;

    // Rendre le cadenas cliquable
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', () => {
        if (_isLocked) unlock(); else lock();
    });

    // Mise à jour visuelle (cadenas ouvert / fermé)
    window.addEventListener('ks-lock-changed', () => {
        chip.classList.toggle('locked', _isLocked);
    });
}

// ═══════════════════════════════════════════════════════════════
// AUTO-VEILLE
// ═══════════════════════════════════════════════════════════════
function _applyAutoLockSettings() {
    const enabled = localStorage.getItem(LS_LOCK_ENABLED) !== 'false'; // défaut: true
    const delay   = parseInt(localStorage.getItem(LS_LOCK_DELAY) || '300000', 10); // défaut 5 min

    _stopIdleTimer();
    if (enabled && delay > 0) {
        _startIdleTimer(delay);
    }
}

function _startIdleTimer(delay) {
    _resetIdleTimer(delay);
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(ev => window.addEventListener(ev, () => _resetIdleTimer(delay), { passive: true }));
}

function _stopIdleTimer() {
    clearTimeout(_idleTimer);
    _idleTimer = null;
}

function _resetIdleTimer(delay) {
    clearTimeout(_idleTimer);
    if (!delay) return;
    _idleTimer = setTimeout(() => {
        if (!_isLocked) lock();
    }, delay);
}
