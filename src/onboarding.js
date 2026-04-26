/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Onboarding Module v1.0
   First-launch tunnel · 5 slides Apple-style
   ═══════════════════════════════════════════════════════════════ */

const LS_ONBOARDED  = 'ks_onboarded';
const MAX_SELECT    = 8;

// ── State ─────────────────────────────────────────────────────
const _s = {
    catalog:    [],
    onComplete: null,
    selected:   new Set(),
    slide:      0,
    name:       '',
    photo:      '',
};

// ── DOM ───────────────────────────────────────────────────────
let _overlay = null;
let _stage   = null;
let _dots    = null;

// ─────────────────────────────────────────────────────────────
export function needsOnboarding() {
    return !localStorage.getItem(LS_ONBOARDED);
}

/**
 * @param {Array}    catalog    — [...TOOLS, ...ARTEFACTS] fourni par ui-renderer
 * @param {Function} onComplete — appelé après fermeture de l'onboarding
 */
export function initOnboarding(catalog, onComplete) {
    if (!needsOnboarding()) return;
    _s.catalog    = catalog;
    _s.onComplete = onComplete;
    _s.selected   = new Set();
    _s.slide      = 0;
    _s.name       = localStorage.getItem('ks_user_name') || '';
    _s.photo      = localStorage.getItem('ks_user_photo') || '';
    _buildOverlay();
    _goTo(0);
}

// ═══════════════════════════════════════════════════════════════
// DOM SKELETON
// ═══════════════════════════════════════════════════════════════
function _buildOverlay() {
    _overlay = document.createElement('div');
    _overlay.id = 'ks-onboarding';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-label', 'Configuration initiale Keystone');
    _overlay.innerHTML = `
        <!-- Fond animé -->
        <div class="ob-bg">
            <div class="ob-blob ob-blob-1"></div>
            <div class="ob-blob ob-blob-2"></div>
            <div class="ob-blob ob-blob-3"></div>
        </div>
        <div class="ob-vignette"></div>

        <!-- Barre de progression en haut -->
        <div class="ob-progress" id="ob-progress">
            <div class="ob-progress-fill" id="ob-progress-fill"></div>
        </div>

        <!-- Zone de slides -->
        <div class="ob-stage" id="ob-stage"></div>

        <!-- Points de navigation -->
        <div class="ob-dots" id="ob-dots">
            ${[0,1,2,3,4].map(i => `<button class="ob-dot" data-i="${i}" aria-label="Étape ${i+1}"></button>`).join('')}
        </div>

        <!-- Lien d'accès direct (utilisateurs existants) -->
        <button class="ob-skip-all" id="ob-skip-all" title="Passer la configuration initiale">
            Accéder directement au Dashboard →
        </button>
    `;
    document.body.appendChild(_overlay);
    _stage = _overlay.querySelector('#ob-stage');
    _dots  = _overlay.querySelector('#ob-dots');

    // Clic sur les dots pour naviguer (slides déjà passés uniquement)
    _dots.addEventListener('click', e => {
        const dot = e.target.closest('.ob-dot');
        if (!dot) return;
        const i = parseInt(dot.dataset.i);
        if (i < _s.slide) _goTo(i, -1);
    });

    // Skip total — marque onboardé sans configurer
    _overlay.querySelector('#ob-skip-all').addEventListener('click', _complete);

    requestAnimationFrame(() => _overlay.classList.add('ob-visible'));
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════
function _goTo(index, dir = 1) {
    _s.slide = Math.max(0, Math.min(4, index));
    _updateChrome();

    const incoming = _renderSlide(_s.slide);
    incoming.classList.add(dir >= 0 ? 'ob-enter-right' : 'ob-enter-left');

    const current = _stage.querySelector('.ob-slide');
    if (current) {
        current.classList.add(dir >= 0 ? 'ob-exit-left' : 'ob-exit-right');
        setTimeout(() => current.remove(), 380);
    }

    _stage.appendChild(incoming);
    // Double RAF pour que la classe d'entrée soit appliquée après le premier paint
    requestAnimationFrame(() =>
        requestAnimationFrame(() =>
            incoming.classList.remove('ob-enter-right', 'ob-enter-left')
        )
    );

    // Focus auto sur le premier input si présent
    setTimeout(() => incoming.querySelector('input, button.ob-btn-next')?.focus?.(), 400);
}

function _next() { _goTo(_s.slide + 1, 1); }
function _prev() { _goTo(_s.slide - 1, -1); }

function _updateChrome() {
    // Dots
    _dots.querySelectorAll('.ob-dot').forEach((d, i) => {
        d.classList.toggle('ob-dot-active',  i === _s.slide);
        d.classList.toggle('ob-dot-passed',  i < _s.slide);
    });
    // Barre de progression
    const fill = document.getElementById('ob-progress-fill');
    if (fill) fill.style.width = `${((_s.slide) / 4) * 100}%`;
}

// ═══════════════════════════════════════════════════════════════
// SLIDES
// ═══════════════════════════════════════════════════════════════
function _renderSlide(index) {
    const el = document.createElement('div');
    el.className = 'ob-slide';
    const fns = [_fillIdentity, _fillAvatar, _fillTools, _fillGuide, _fillLaunch];
    fns[index]?.(el);
    return el;
}

// ── Slide 1 — Identité ────────────────────────────────────────
function _fillIdentity(el) {
    el.innerHTML = `
        <div class="ob-card">
            <div class="ob-icon-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" style="width:34px;height:34px">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                </svg>
            </div>
            <div class="ob-eyebrow">Étape 1 · Identité</div>
            <h1 class="ob-title">Bienvenue.</h1>
            <p class="ob-sub">Comment devons-nous vous appeler ?</p>
            <input class="ob-input" id="ob-name" type="text"
                placeholder="Votre prénom…" maxlength="40"
                autocomplete="given-name" value="${_s.name}">
            <div class="ob-actions">
                <button class="ob-btn-ghost" id="ob-skip-1">Passer</button>
                <button class="ob-btn-primary" id="ob-next-1">Continuer</button>
            </div>
        </div>
    `;
    const inp = el.querySelector('#ob-name');
    inp.addEventListener('input', e => { _s.name = e.target.value.trim(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') el.querySelector('#ob-next-1').click(); });
    el.querySelector('#ob-skip-1').addEventListener('click', _next);
    el.querySelector('#ob-next-1').addEventListener('click', () => {
        if (_s.name) localStorage.setItem('ks_user_name', _s.name);
        _next();
    });
}

// ── Slide 2 — Avatar ──────────────────────────────────────────
function _fillAvatar(el) {
    el.innerHTML = `
        <div class="ob-card">
            <div class="ob-eyebrow">Étape 2 · Apparence</div>
            <h1 class="ob-title">Votre identité visuelle.</h1>
            <p class="ob-sub">Ajoutez votre photo ou logo pour personnaliser votre pôle.</p>
            <div class="ob-avatar-zone">
                <div class="ob-avatar-circle" id="ob-avatar-preview">
                    ${_s.photo
                        ? `<img src="${_s.photo}" alt="Photo">`
                        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="width:38px;height:38px;opacity:.3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
                    }
                </div>
                <div class="ob-avatar-controls">
                    <label class="ob-btn-upload" for="ob-photo-file">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:13px;height:13px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Importer une image
                        <input type="file" id="ob-photo-file" accept="image/*" style="display:none">
                    </label>
                    <div class="ob-avatar-or">ou entrer une URL</div>
                    <input class="ob-input ob-input-sm" id="ob-photo-url" type="url"
                        placeholder="https://example.com/logo.jpg"
                        value="${_s.photo.startsWith('data:') ? '' : _s.photo}">
                </div>
            </div>
            <div class="ob-actions">
                <button class="ob-btn-ghost" id="ob-skip-2">Passer</button>
                <button class="ob-btn-primary" id="ob-next-2">Continuer</button>
            </div>
        </div>
    `;
    const preview = el.querySelector('#ob-avatar-preview');

    function _setPreview(src) {
        _s.photo = src;
        preview.innerHTML = src
            ? `<img src="${src}" alt="Photo">`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="width:38px;height:38px;opacity:.3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    }

    el.querySelector('#ob-photo-file').addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => _setPreview(ev.target.result);
        reader.readAsDataURL(file);
    });
    el.querySelector('#ob-photo-url').addEventListener('input', e => {
        const v = e.target.value.trim();
        if (v) _setPreview(v);
    });
    el.querySelector('#ob-skip-2').addEventListener('click', _next);
    el.querySelector('#ob-next-2').addEventListener('click', () => {
        if (_s.photo) localStorage.setItem('ks_user_photo', _s.photo);
        _next();
    });
}

// ── Slide 3 — Sélection outils ────────────────────────────────
function _fillTools(el) {
    const count = _s.selected.size;
    const atMax = count >= MAX_SELECT;

    const cards = _s.catalog.map(t => {
        const sel = _s.selected.has(t.id);
        const dis = atMax && !sel;
        const prefix = t.id.split('-')[0]; // O ou A
        return `<button
            class="ob-tool-card${sel ? ' ob-tool-selected' : ''}${dis ? ' ob-tool-dim' : ''}"
            data-id="${t.id}" ${dis ? 'aria-disabled="true"' : ''}>
            <div class="ob-tool-badge ob-badge-${prefix.toLowerCase()}">${prefix}</div>
            <div class="ob-tool-check">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="ob-tool-name">${t.name}</div>
            ${t.desc ? `<div class="ob-tool-desc">${t.desc}</div>` : ''}
        </button>`;
    }).join('');

    el.innerHTML = `
        <div class="ob-card ob-card-wide">
            <div class="ob-eyebrow">Étape 3 · Sélection</div>
            <h1 class="ob-title ob-title-md">Votre Boîte à outils.</h1>
            <p class="ob-sub">Sélectionnez jusqu'à <strong>${MAX_SELECT}</strong> outils pour démarrer immédiatement.</p>
            <div class="ob-counter-wrap">
                <div class="ob-counter-bar">
                    <div class="ob-counter-fill" id="ob-counter-fill" style="width:${(count/MAX_SELECT)*100}%"></div>
                </div>
                <div class="ob-counter-lbl"><span id="ob-sel-count">${count}</span>&thinsp;/&thinsp;${MAX_SELECT}</div>
            </div>
            <div class="ob-tools-grid" id="ob-tools-grid">${cards}</div>
            <div class="ob-actions">
                <button class="ob-btn-ghost" id="ob-back-3">← Retour</button>
                <button class="ob-btn-primary${count === 0 ? ' ob-btn-disabled' : ''}"
                    id="ob-next-3" ${count === 0 ? 'disabled' : ''}>Continuer</button>
            </div>
        </div>
    `;

    const grid     = el.querySelector('#ob-tools-grid');
    const countEl  = el.querySelector('#ob-sel-count');
    const fillEl   = el.querySelector('#ob-counter-fill');
    const nextBtn  = el.querySelector('#ob-next-3');

    function _refresh() {
        const n = _s.selected.size;
        countEl.textContent = n;
        fillEl.style.width  = `${(n / MAX_SELECT) * 100}%`;
        nextBtn.disabled    = n === 0;
        nextBtn.classList.toggle('ob-btn-disabled', n === 0);
        const maxed = n >= MAX_SELECT;
        grid.querySelectorAll('.ob-tool-card').forEach(c => {
            const id  = c.dataset.id;
            const sel = _s.selected.has(id);
            c.classList.toggle('ob-tool-selected', sel);
            c.classList.toggle('ob-tool-dim', maxed && !sel);
            c.setAttribute('aria-disabled', String(maxed && !sel));
        });
    }

    grid.addEventListener('click', e => {
        const card = e.target.closest('.ob-tool-card');
        if (!card || card.getAttribute('aria-disabled') === 'true') return;
        const id = card.dataset.id;
        if (_s.selected.has(id)) _s.selected.delete(id);
        else if (_s.selected.size < MAX_SELECT) _s.selected.add(id);
        _refresh();
    });

    el.querySelector('#ob-back-3').addEventListener('click', () => _goTo(1, -1));
    el.querySelector('#ob-next-3').addEventListener('click', () => {
        if (_s.selected.size > 0) _next();
    });
}

// ── Slide 4 — Guide rapide ────────────────────────────────────
function _fillGuide(el) {
    const TIPS = [
        {
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="width:22px;height:22px"><polyline points="5 9 2 12 5 15"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
            title: 'Réorganisez votre espace',
            desc:  'Maintenez un outil appuyé 3 secondes pour le déplacer, renommer ou masquer.',
        },
        {
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="width:22px;height:22px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
            title: 'Sécurisez votre pôle',
            desc:  'Cliquez sur le cadenas en haut à droite pour activer l\'écran de veille instantanément.',
        },
        {
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="width:22px;height:22px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
            title: 'Élargissez votre catalogue',
            desc:  'Ajoutez des outils et artefacts à tout moment depuis le bouton Key-Store du dashboard.',
        },
    ];

    el.innerHTML = `
        <div class="ob-card">
            <div class="ob-icon-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" style="width:34px;height:34px">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
            </div>
            <div class="ob-eyebrow">Étape 4 · Guide rapide</div>
            <h1 class="ob-title">Trois choses à savoir.</h1>
            <div class="ob-tips">
                ${TIPS.map((t, i) => `
                    <div class="ob-tip">
                        <div class="ob-tip-icon">${t.icon}</div>
                        <div class="ob-tip-body">
                            <div class="ob-tip-title">${t.title}</div>
                            <div class="ob-tip-desc">${t.desc}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="ob-actions">
                <button class="ob-btn-ghost" id="ob-back-4">← Retour</button>
                <button class="ob-btn-primary" id="ob-next-4">Presque prêt →</button>
            </div>
        </div>
    `;
    el.querySelector('#ob-back-4').addEventListener('click', () => _goTo(2, -1));
    el.querySelector('#ob-next-4').addEventListener('click', _next);
}

// ── Slide 5 — Lancement ───────────────────────────────────────
function _fillLaunch(el) {
    const name  = _s.name || localStorage.getItem('ks_user_name') || '';
    const nSel  = _s.selected.size;
    el.innerHTML = `
        <div class="ob-card ob-card-launch">
            <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ob-launch-logo">
            <h1 class="ob-title ob-title-launch">Votre pôle est prêt${name ? `,&thinsp;${name}` : ''}.</h1>
            <p class="ob-sub">
                ${nSel > 0
                    ? `${nSel} outil${nSel > 1 ? 's' : ''} configuré${nSel > 1 ? 's' : ''}. Vous pourrez en ajouter d'autres via le Key-Store.`
                    : `Tous les outils sont disponibles. Configurez votre espace à tout moment.`
                }
            </p>
            <button class="ob-btn-launch" id="ob-launch-btn">
                Activer mon intelligence immobilière
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            </button>
            <button class="ob-btn-ghost ob-back-launch" id="ob-back-5">← Modifier la sélection</button>
        </div>
    `;
    el.querySelector('#ob-back-5').addEventListener('click', () => _goTo(3, -1));
    el.querySelector('#ob-launch-btn').addEventListener('click', _complete);
}

// ═══════════════════════════════════════════════════════════════
// COMPLETION
// ═══════════════════════════════════════════════════════════════
function _complete() {
    // Appliquer la sélection : masquer les O-* non sélectionnés
    _s.catalog
        .filter(t => t.id.startsWith('O-'))
        .forEach(t => {
            if (_s.selected.has(t.id)) {
                localStorage.removeItem('ks_hidden_' + t.id);
            } else if (_s.selected.size > 0) {
                // Seulement masquer si l'user a fait une vraie sélection
                localStorage.setItem('ks_hidden_' + t.id, '1');
            }
        });

    // Sauvegarder le nom/photo si pas déjà fait
    if (_s.name)  localStorage.setItem('ks_user_name',  _s.name);
    if (_s.photo) localStorage.setItem('ks_user_photo', _s.photo);

    // Marquer comme onboardé
    localStorage.setItem(LS_ONBOARDED, '1');

    // Sortie animée
    _overlay.classList.add('ob-leaving');
    setTimeout(() => {
        _overlay.remove();
        _overlay = _stage = _dots = null;
        _s.onComplete?.();
    }, 520);
}
