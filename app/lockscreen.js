/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Lock Screen Engine v1.0
   Mesh gradients animés · Horloge Apple · Auto-veille configurable
   ═══════════════════════════════════════════════════════════════ */

import { OledProtection } from './oled-protection.js';
import { startHalftone, stopHalftone } from './screensaver-halftone.js';

const LS_LOCK_ENABLED = 'ks_lock_enabled';
const LS_LOCK_DELAY   = 'ks_lock_delay';    // ms  (0 = jamais)
const LS_LOCK_STYLE   = 'ks_lock_style';    // 'abyss' | 'golden-flow' | 'nebula' | 'obsidian' | 'halftone'

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
    // Appliquer à chaud les réglages OLED si l'écran de veille est affiché
    window.addEventListener('ks-lock-settings-changed', () => { if (_isLocked) OledProtection.applySettings(); });
    // Bouton « Lancer la maintenance maintenant » (depuis les Réglages)
    window.addEventListener('ks-oled-run-maintenance', runMaintenanceNow);
    // Bouton « Voir l'effet » — aperçu exagéré (depuis les Réglages)
    window.addEventListener('ks-oled-preview', previewOledNow);
    // Plein écran : Échap le quitte → on déverrouille dans la foulée
    document.addEventListener('fullscreenchange', _onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', _onFullscreenChange);

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
    // Scène halftone (canvas animé) — uniquement pour ce style
    if (_style === 'halftone') {
        const cv = document.getElementById('ls-halftone');
        if (cv) startHalftone(cv, { reduceMotion: localStorage.getItem('ks_reduce_motion') === '1' });
    }
    OledProtection.start(_overlay); // protection OLED (décalage + maintenance)
    _resetIdleTimer(); // réarme pendant l'écran actif pour info
}

export function unlock() {
    if (!_isLocked) return;
    _isLocked = false;
    stopHalftone();        // coupe le canvas animé (RAF) s'il tournait
    OledProtection.stop(); // stoppe décalage + maintenance immédiatement
    _exitFullscreen();     // quitte le plein écran si on y était
    _overlay.classList.add('ls-leaving');

    setTimeout(() => {
        _overlay.classList.remove('ls-visible', 'ls-leaving');
        document.body.style.overflow = '';
    }, 420);

    _stopClock();
    _resetIdleTimer(); // repart depuis zéro en mode actif
}

// ═══════════════════════════════════════════════════════════════
// MAINTENANCE OLED — lancement manuel
// ═══════════════════════════════════════════════════════════════
/** Affiche l'écran de veille (si besoin) puis lance la séquence de maintenance. */
export function runMaintenanceNow() {
    if (!_isLocked) lock();          // lock() est synchrone → _overlay prêt
    _enterFullscreen();              // déclenché par un clic → plein écran autorisé
    OledProtection.runMaintenance({ manual: true, force: true });
}

/** Affiche l'écran de veille (si besoin) puis joue l'aperçu exagéré ~10 s. */
export function previewOledNow() {
    if (!_isLocked) lock();
    _enterFullscreen();
    OledProtection.previewEffect();
}

// ═══════════════════════════════════════════════════════════════
// PLEIN ÉCRAN (Fullscreen API)
// ───────────────────────────────────────────────────────────────
// Couvre AUSSI le chrome du navigateur (onglets, barre d'outils) que
// l'overlay seul ne peut pas masquer. ⚠️ Le navigateur n'autorise le
// plein écran QUE depuis un geste utilisateur → OK sur les déclenchements
// manuels (cadenas / maintenance / aperçu), IMPOSSIBLE sur l'auto-veille.
// ═══════════════════════════════════════════════════════════════
function _enterFullscreen() {
    try {
        const el = _overlay || document.documentElement;
        if (document.fullscreenElement || document.webkitFullscreenElement) return;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!req) return;
        const p = req.call(el);
        if (p && p.catch) p.catch(() => {}); // refusé (pas de geste) → on ignore
    } catch (_) { /* no-op */ }
}

function _exitFullscreen() {
    try {
        if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;
        const ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (!ex) return;
        const p = ex.call(document);
        if (p && p.catch) p.catch(() => {});
    } catch (_) { /* no-op */ }
}

// Échap quitte d'abord le plein écran ; si on était verrouillé, on déverrouille
// dans la foulée (sinon il faudrait un 2e Échap).
function _onFullscreenChange() {
    if (!(document.fullscreenElement || document.webkitFullscreenElement) && _isLocked) {
        unlock();
    }
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

        <!-- Scène « Trame ondoyante » (halftone) — visible si data-style="halftone" -->
        <canvas class="ls-halftone" id="ls-halftone"></canvas>

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
        if (_isLocked) { unlock(); }
        else { lock(); _enterFullscreen(); } // clic = geste → plein écran OK
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
