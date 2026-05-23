/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Ghost Writer Frontend v0.1 (Sprint GW-1 / MVP)
   ─────────────────────────────────────────────────────────────
   Service système transversal de réécriture textuelle.
   Hook global Cmd+Shift+G + selection listener + Modal 60/40.

   Status : ADDITIF, behind feature flag.
   Activation :
     - window.__KS_GHOSTWRITER__ = true              (dev, in-memory)
     - localStorage.setItem('ks_ghostwriter','1')    (persistant)

   Backend :
     - Mode 'mock' (défaut) → transformations clientes simples, instantané,
       pas de réseau. Permet de tester l'UX sans déployer le Worker.
     - Mode 'real' → POST /api/ghostwriter/rewrite (Gemma 4 via Workers AI).
       Nécessite ks_jwt en localStorage.
     - Mode 'auto' → essaie real, fallback mock si erreur.
     Choix via localStorage.setItem('ks_ghostwriter_mode', 'real' | 'auto' | 'mock').

   Quota :
     - V1 : hard-limit 10 calls/jour, tracké via localStorage (bucket
       day-based, reset 00:00 locale).
     - Phase 2 : migrer vers backend KV pour cross-device.

   Doctrine "Contenant / Contenu" :
     - Module standalone, aucun import des artefacts existants.
     - Réutilisable depuis n'importe quel pad (cf. BRIEF_GHOST_WRITER §6).
     - Quand Phase 5 Sprint B est livrée, les pads pourront déclarer
       `{ "ghostwriter": true }` dans leur JSON pour intégration native.
   ═══════════════════════════════════════════════════════════════ */

import { CF_API } from './pads-loader.js';

// ── Constants ─────────────────────────────────────────────────────
const FLAG_LS_KEY     = 'ks_ghostwriter';
const MODE_LS_KEY     = 'ks_ghostwriter_mode';   // 'mock' | 'real' | 'auto'
const QUOTA_LS_KEY    = 'ks_ghostwriter_quota';  // { date, count }
const QUOTA_PER_DAY   = 10;
const SHORTCUT_KEY    = 'g';
const MIN_TEXT_LENGTH = 5;
const MAX_TEXT_LENGTH = 5000;

// ── State (module-private) ────────────────────────────────────────
let _hookInitialized = false;
let _modalOpen       = false;
let _lastSelection   = null;   // { text, sourceEl: { el, start, end } | null }

// ── Feature flag ──────────────────────────────────────────────────

/**
 * Détecte si Ghost Writer doit être actif.
 * Activation : window.__KS_GHOSTWRITER__ = true OU localStorage.
 */
export function isGhostwriterEnabled() {
    if (typeof window === 'undefined') return false;
    if (window.__KS_GHOSTWRITER__ === true) return true;
    try { return localStorage.getItem(FLAG_LS_KEY) === '1'; }
    catch (_) { return false; }
}

/**
 * Mode courant. Défaut : 'mock' (pas de backend nécessaire).
 */
function _getMode() {
    try {
        const m = localStorage.getItem(MODE_LS_KEY);
        if (m === 'real' || m === 'auto' || m === 'mock') return m;
    } catch (_) {}
    return 'mock';
}

// ── Quota tracking (localStorage, day-bucketed) ───────────────────

function _today() { return new Date().toISOString().slice(0, 10); }

function _getQuotaState() {
    try {
        const raw = localStorage.getItem(QUOTA_LS_KEY);
        if (!raw) return { date: _today(), count: 0 };
        const parsed = JSON.parse(raw);
        if (parsed.date !== _today()) return { date: _today(), count: 0 };
        return parsed;
    } catch (_) { return { date: _today(), count: 0 }; }
}

function _bumpQuota() {
    const state = _getQuotaState();
    state.count += 1;
    try { localStorage.setItem(QUOTA_LS_KEY, JSON.stringify(state)); }
    catch (_) {}
}

function _quotaRemaining() {
    return Math.max(0, QUOTA_PER_DAY - _getQuotaState().count);
}

// ── Selection tracking ────────────────────────────────────────────

/**
 * Listener selectionchange : capture la sélection courante + le champ
 * source (textarea / input) si applicable. Permet d'implémenter
 * "Remplacer la sélection" depuis le modal.
 */
function _trackSelection() {
    if (_modalOpen) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    if (!text || text.trim().length < MIN_TEXT_LENGTH) return;

    // Détecte le champ éditable contenant la sélection (input/textarea actif).
    let sourceEl = null;
    const ae = document.activeElement;
    if (
        ae &&
        (ae.tagName === 'TEXTAREA' ||
         (ae.tagName === 'INPUT' && (ae.type === 'text' || ae.type === '' || ae.type === 'search')))
    ) {
        if (ae.selectionStart !== ae.selectionEnd) {
            sourceEl = { el: ae, start: ae.selectionStart, end: ae.selectionEnd };
        }
    }

    _lastSelection = { text, sourceEl };
}

// ── Backend calls ─────────────────────────────────────────────────

/**
 * Mock backend : transformations clientes "best-effort" pour valider
 * l'UX sans déploiement Worker. Latence simulée 600ms.
 *
 * IMPORTANT — limitations du mock :
 * Le mock ne FAIT PAS de vraie réécriture sémantique. Il applique des
 * transformations syntaxiques basiques (capitalisation, splitting,
 * préfixes, troncature). Pour des reformulations IA réelles qui
 * respectent ton/action/intent/audience, basculer en mode 'real' ou
 * 'auto' (nécessite déploiement du Worker avec binding [ai]).
 *
 * Ce que le mock RESPECTE désormais (pour transparence) :
 * - `lengthTarget` : raccourcit / garde / développe vraiment
 * - `tone` : adapte les LABELS des 3 variantes pour refléter le ton
 * - `action` : 'improve' garde plus de structure d'origine
 *
 * Ce que le mock ne respecte PAS :
 * - `intent` (motiver, négocier…) — aucun effet
 * - `audience` (client, supérieur…) — aucun effet
 * - `mode` (email, marketing…) — aucun effet visible
 * - La sémantique en général : les 3 variantes RESTENT proches du
 *   texte source car le mock ne sait pas reformuler.
 */
async function _callMock(text, opts = {}) {
    await new Promise(r => setTimeout(r, 600));

    const trimmed = text.trim();
    const ending  = /[.!?…]$/.test(trimmed) ? '' : '.';
    const tone    = opts.tone || '';
    const action  = opts.action || 'improve';
    const length  = opts.lengthTarget || '';

    // ── Helper longueur : applique le critère length au texte donné ──
    function applyLength(s) {
        if (length === 'shorter-50') {
            // Garde la moitié des phrases (arrondi sup)
            const sentences = s.split(/(?<=[.!?…])\s+/).filter(Boolean);
            const keep = Math.max(1, Math.ceil(sentences.length / 2));
            return sentences.slice(0, keep).join(' ');
        }
        if (length === 'longer') {
            // Ajoute une phrase générique de politesse en fin selon le contexte
            const tail = opts.mode === 'email' || opts.audience === 'client'
                ? ' N\'hésitez pas à revenir vers moi pour tout point à clarifier.'
                : opts.mode === 'marketing'
                    ? ' À découvrir sans attendre.'
                    : ' Pour aller plus loin, je reste disponible.';
            return s + tail;
        }
        return s;
    }

    // ── Helper labels : choisit 3 labels pertinents selon tone ─────
    function pickLabels() {
        const map = {
            'formel professionnel':  ['Très formel', 'Formel mesuré', 'Formel cordial'],
            'chaleureux empathique': ['Très chaleureux', 'Empathique', 'Bienveillant'],
            'concis direct':         ['Très concis', 'Synthétique', 'Direct'],
            'persuasif vendeur':     ['Très impactant', 'Persuasif mesuré', 'Engageant'],
            'humble respectueux':    ['Humble', 'Respectueux', 'Modeste'],
            'enthousiaste':          ['Très enthousiaste', 'Énergique', 'Positif'],
        };
        return map[tone] || ['Plus formel', 'Plus concis', 'Plus chaleureux'];
    }
    const labels = pickLabels();

    // ── 3 transformations syntaxiques basiques ─────────────────────
    // V1 — capitalisation + ponctuation propre
    let v1 = trimmed.charAt(0).toUpperCase()
        + trimmed.slice(1).replace(/!+/g, '.').replace(/\s+/g, ' ')
        + ending;

    // V2 — 2 premières phrases (concis intrinsèque), puis applique length
    let v2Base = trimmed.split(/[.!?]+/).map(s => s.trim()).filter(Boolean).slice(0, 2).join('. ');
    let v2 = (v2Base || trimmed) + (ending || '.');

    // V3 — préfixe selon ton
    const prefixByTone = {
        'chaleureux empathique': 'Avec plaisir : ',
        'persuasif vendeur':     'Vraiment : ',
        'humble respectueux':    'Si je peux me permettre : ',
        'enthousiaste':          'Excellente nouvelle : ',
    };
    const prefix = prefixByTone[tone] || '';
    let v3 = prefix
        ? prefix + trimmed.charAt(0).toLowerCase() + trimmed.slice(1) + ending
        : trimmed + ending;
    v3 = v3.replace(/\s+/g, ' ');

    // ── Applique le critère length à toutes les variantes ─────────
    v1 = applyLength(v1);
    v2 = applyLength(v2);
    v3 = applyLength(v3);

    // ── Action 'improve' vs 'rewrite' : marqueur dans le model ──
    const actionMarker = action === 'rewrite' ? '+rewrite' : '+improve';

    return {
        variants: [
            { label: labels[0], text: v1 },
            { label: labels[1], text: v2 },
            { label: labels[2], text: v3 },
        ],
        model: `mock-client${actionMarker}${length ? '+' + length : ''}`,
        usage: null,
    };
}

/**
 * Real backend : appel POST /api/ghostwriter/rewrite avec JWT.
 * Le Worker doit avoir le binding [ai] configuré dans wrangler.toml.
 */
async function _callReal(text, opts) {
    const jwt = localStorage.getItem('ks_jwt');
    if (!jwt) {
        throw new Error('Aucun JWT en session — connectez-vous (mode real nécessite une licence active).');
    }

    const res = await fetch(`${CF_API}/api/ghostwriter/rewrite`, {
        method: 'POST',
        headers: {
            'Content-Type'  : 'application/json',
            'Authorization' : `Bearer ${jwt}`,
        },
        body: JSON.stringify({
            text,
            tone   : opts?.tone    || null,
            intent : opts?.intent  || null,
            vouvoie: opts?.vouvoie ?? null,
        }),
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const errBody = await res.json();
            msg = errBody.error || errBody.message || msg;
        } catch (_) {}
        throw new Error(msg);
    }

    return await res.json();
}

/**
 * Routing par mode actif.
 */
async function _rewrite(text, opts) {
    const mode = _getMode();
    if (mode === 'mock') return _callMock(text, opts);
    if (mode === 'real') return _callReal(text, opts);
    // 'auto' : real avec fallback mock si erreur
    try { return await _callReal(text, opts); }
    catch (e) {
        console.warn('[ghostwriter] Real backend KO, fallback mock :', e.message);
        const result = await _callMock(text, opts);
        result.model = `mock-fallback (real KO: ${e.message})`;
        return result;
    }
}

// ── CSS (injecté une seule fois au premier open) ──────────────────

const CSS_INJECTED_FLAG = '__ks_gw_css_injected__';

function _injectCSS() {
    if (window[CSS_INJECTED_FLAG]) return;
    window[CSS_INJECTED_FLAG] = true;

    const css = `
.gw-overlay {
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,.62);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    display: flex; align-items: flex-start; justify-content: center;
    padding-top: 5vh; padding-bottom: 5vh;
    opacity: 0; transition: opacity .22s ease;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif;
}
.gw-overlay.gw-on { opacity: 1; }
.gw-modal {
    width: min(1100px, 92vw); height: 90vh;
    background: var(--bg-secondary, #16161a);
    border-radius: 16px; border: 1px solid rgba(255,255,255,.1);
    box-shadow: 0 24px 64px rgba(0,0,0,.55);
    display: grid; grid-template-rows: auto 1fr;
    overflow: hidden;
    transform: translateY(8px); transition: transform .22s cubic-bezier(.16,1,.3,1);
}
.gw-overlay.gw-on .gw-modal { transform: translateY(0); }
.gw-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 24px; border-bottom: 1px solid rgba(255,255,255,.06);
    flex-shrink: 0;
}
.gw-title { font-size: 19px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-primary, #fff); margin: 0; }
.gw-subtitle { font-size: 12px; color: var(--text-muted, #888); margin-top: 3px; letter-spacing: .01em; }
.gw-close {
    background: transparent; border: 0; color: var(--text-muted, #888);
    cursor: pointer; font-size: 20px; padding: 4px 10px; border-radius: 6px;
    line-height: 1; transition: all .15s ease;
}
.gw-close:hover { color: var(--text-primary, #fff); background: rgba(255,255,255,.05); }
.gw-body { display: grid; grid-template-columns: 6fr 4fr; gap: 0; overflow: hidden; min-height: 0; }
.gw-left { padding: 20px 24px; border-right: 1px solid rgba(255,255,255,.06); overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.gw-right { padding: 20px 24px; overflow-y: auto; }
.gw-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted, #888); font-weight: 600; }
.gw-source {
    width: 100%; min-height: 160px; resize: vertical;
    padding: 14px; border-radius: 10px;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
    color: var(--text-primary, #fff); font-size: 14px; line-height: 1.55;
    font-family: inherit; box-sizing: border-box;
}
.gw-source:focus { outline: 0; border-color: rgba(120,160,255,.4); background: rgba(255,255,255,.06); }
.gw-options { display: flex; gap: 8px; flex-wrap: wrap; }
.gw-option-btn {
    padding: 7px 14px; border-radius: 100px;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
    color: var(--text-muted, #aaa); font-size: 12px; font-weight: 500;
    cursor: pointer; transition: all .14s ease;
}
.gw-option-btn.gw-on {
    background: rgba(120,160,255,.18); border-color: rgba(120,160,255,.45);
    color: var(--text-primary, #fff);
}
.gw-option-btn:hover:not(.gw-on) { background: rgba(255,255,255,.07); color: #ddd; }
.gw-go {
    width: 100%; padding: 12px 20px;
    background: linear-gradient(135deg, #6496ff, #8060ff);
    border: 0; border-radius: 10px; color: white;
    font-size: 14px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: transform .15s ease, opacity .15s ease;
}
.gw-go:disabled { opacity: .55; cursor: not-allowed; }
.gw-go:hover:not(:disabled) { transform: translateY(-1px); }
.gw-status { font-size: 12px; color: var(--text-muted, #888); min-height: 16px; }
.gw-status.gw-error { color: #e05c5c; }
.gw-meta { display: flex; gap: 8px; font-size: 11px; color: var(--text-muted, #888); flex-wrap: wrap; margin-top: 4px; }
.gw-quota, .gw-mode-chip { padding: 3px 10px; border-radius: 100px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.06); }
.gw-mode-chip { background: rgba(120,160,255,.12); color: #8aaeff; }
.gw-variants { display: flex; flex-direction: column; gap: 12px; }
.gw-variant {
    padding: 14px 16px; border-radius: 12px;
    background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
    transition: all .15s ease;
}
.gw-variant:hover { border-color: rgba(120,160,255,.3); background: rgba(255,255,255,.05); }
.gw-variant-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #8aaeff; margin-bottom: 9px; font-weight: 600; }
.gw-variant-text { color: var(--text-primary, #f0f0f0); font-size: 13px; line-height: 1.65; white-space: pre-wrap; word-wrap: break-word; }
.gw-variant-actions { margin-top: 12px; display: flex; gap: 6px; }
.gw-mini-btn {
    padding: 6px 12px; border-radius: 7px; font-size: 11px; font-weight: 500; cursor: pointer;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    color: var(--text-primary, #ddd); transition: all .15s ease;
}
.gw-mini-btn:hover { background: rgba(120,160,255,.14); border-color: rgba(120,160,255,.35); color: #fff; }
.gw-empty { color: var(--text-muted, #888); font-size: 13px; text-align: center; padding: 40px 0; line-height: 1.6; }
.gw-spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,.3);
    border-top-color: white; border-radius: 50%;
    animation: gw-spin 0.8s linear infinite;
    display: inline-block;
}
@keyframes gw-spin { to { transform: rotate(360deg); } }
    `;

    const style = document.createElement('style');
    style.id = 'ks-gw-styles';
    style.textContent = css;
    document.head.appendChild(style);
}

// ── Modal builder ────────────────────────────────────────────────

function _buildModalHTML(initialText) {
    const remaining = _quotaRemaining();
    const mode = _getMode();
    return `
        <div class="gw-modal" role="dialog" aria-label="Ghost Writer">
            <div class="gw-head">
                <div>
                    <h2 class="gw-title">Ghost Writer</h2>
                    <div class="gw-subtitle">Réécrivez votre texte — 3 variantes générées</div>
                </div>
                <button class="gw-close" id="gw-close-btn" aria-label="Fermer (Esc)">✕</button>
            </div>
            <div class="gw-body">
                <div class="gw-left">
                    <div class="gw-label">Texte source</div>
                    <textarea id="gw-source" class="gw-source" placeholder="Collez ou tapez votre texte ici…">${_escapeHtml(initialText)}</textarea>
                    <div class="gw-label">Ton souhaité</div>
                    <div class="gw-options" id="gw-tones" data-selected="">
                        <button class="gw-option-btn gw-on" data-tone="">Auto</button>
                        <button class="gw-option-btn" data-tone="formel professionnel">Formel</button>
                        <button class="gw-option-btn" data-tone="chaleureux empathique">Chaleureux</button>
                        <button class="gw-option-btn" data-tone="concis direct">Concis</button>
                        <button class="gw-option-btn" data-tone="persuasif vendeur">Persuasif</button>
                    </div>
                    <button id="gw-go" class="gw-go">
                        <span>Réécrire en 3 variantes</span>
                    </button>
                    <div id="gw-status" class="gw-status"></div>
                    <div class="gw-meta">
                        <span class="gw-quota">${remaining}/${QUOTA_PER_DAY} appels restants aujourd'hui</span>
                        <span class="gw-mode-chip">Mode : ${mode}</span>
                    </div>
                </div>
                <div class="gw-right">
                    <div class="gw-label">Variantes proposées</div>
                    <div id="gw-variants" class="gw-variants">
                        <div class="gw-empty">Cliquez sur "Réécrire" pour obtenir 3 variantes.<br><span style="opacity:.6">Raccourci : Cmd+Shift+G</span></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function _escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Modal open / close / bindings ────────────────────────────────

function _openModal(initialText) {
    if (_modalOpen) return;
    _modalOpen = true;
    _injectCSS();

    const overlay = document.createElement('div');
    overlay.className = 'gw-overlay';
    overlay.id = 'gw-overlay';
    overlay.innerHTML = _buildModalHTML(initialText || '');
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('gw-on'));

    _bindModalEvents(overlay);

    // Focus le textarea après animation
    setTimeout(() => overlay.querySelector('#gw-source')?.focus(), 250);
}

function _closeModal() {
    if (!_modalOpen) return;
    const overlay = document.getElementById('gw-overlay');
    if (!overlay) { _modalOpen = false; return; }
    overlay.classList.remove('gw-on');
    setTimeout(() => {
        overlay.remove();
        _modalOpen = false;
    }, 200);
}

function _bindModalEvents(overlay) {
    // Close button
    overlay.querySelector('#gw-close-btn')?.addEventListener('click', _closeModal);

    // Click backdrop closes (mais pas click sur le modal)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _closeModal();
    });

    // Esc closes (cleanup listener à la fermeture)
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            _closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Tone selector (radio-like)
    const toneBtns = overlay.querySelectorAll('.gw-option-btn');
    toneBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toneBtns.forEach(b => b.classList.remove('gw-on'));
            btn.classList.add('gw-on');
            overlay.querySelector('#gw-tones').dataset.selected = btn.dataset.tone || '';
        });
    });

    // Generate
    overlay.querySelector('#gw-go')?.addEventListener('click', () => _handleGenerate(overlay));

    // Enter shortcut dans le textarea pour générer (Cmd/Ctrl+Enter)
    overlay.querySelector('#gw-source')?.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            _handleGenerate(overlay);
        }
    });
}

async function _handleGenerate(overlay) {
    const source   = overlay.querySelector('#gw-source');
    const status   = overlay.querySelector('#gw-status');
    const variants = overlay.querySelector('#gw-variants');
    const goBtn    = overlay.querySelector('#gw-go');
    const tone     = overlay.querySelector('#gw-tones').dataset.selected || '';

    const text = (source?.value || '').trim();
    if (text.length < MIN_TEXT_LENGTH) {
        _setStatus(status, `Texte trop court (min ${MIN_TEXT_LENGTH} caractères)`, 'error');
        return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
        _setStatus(status, `Texte trop long (max ${MAX_TEXT_LENGTH} caractères)`, 'error');
        return;
    }

    // Quota check
    if (_quotaRemaining() === 0) {
        _setStatus(status, `Quota journalier atteint (${QUOTA_PER_DAY}/jour). Réessayez demain.`, 'error');
        return;
    }

    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="gw-spinner"></span><span>Génération…</span>';
    _setStatus(status, '', null);

    try {
        const result = await _rewrite(text, { tone: tone || null });
        _bumpQuota();
        _renderVariants(variants, result.variants);
        _setStatus(status, `✓ ${result.variants.length} variantes (modèle: ${result.model})`, null);

        // Refresh quota chip
        const quotaEl = overlay.querySelector('.gw-quota');
        if (quotaEl) quotaEl.textContent = `${_quotaRemaining()}/${QUOTA_PER_DAY} appels restants aujourd'hui`;
    } catch (e) {
        _setStatus(status, `✗ ${e.message}`, 'error');
    } finally {
        goBtn.disabled = false;
        goBtn.innerHTML = '<span>Réécrire en 3 variantes</span>';
    }
}

function _setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'gw-status' + (kind ? ` gw-${kind}` : '');
}

function _renderVariants(container, variants) {
    if (!container) return;
    if (!variants || variants.length === 0) {
        container.innerHTML = '<div class="gw-empty">Aucune variante générée</div>';
        return;
    }
    container.innerHTML = variants.map((v, i) => `
        <div class="gw-variant" data-idx="${i}">
            <div class="gw-variant-label">${_escapeHtml(v.label || `Variante ${i + 1}`)}</div>
            <div class="gw-variant-text">${_escapeHtml(v.text)}</div>
            <div class="gw-variant-actions">
                <button class="gw-mini-btn gw-mini-copy" data-idx="${i}">Copier</button>
                <button class="gw-mini-btn gw-mini-replace" data-idx="${i}">Remplacer</button>
            </div>
        </div>
    `).join('');

    // Bindings copy
    container.querySelectorAll('.gw-mini-copy').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            const text = variants[idx]?.text || '';
            navigator.clipboard?.writeText(text)?.then(() => {
                const orig = btn.textContent;
                btn.textContent = '✓ Copié';
                setTimeout(() => { btn.textContent = orig; }, 1500);
            });
        });
    });

    // Bindings replace
    container.querySelectorAll('.gw-mini-replace').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            _replaceSelection(variants[idx]?.text || '', btn);
        });
    });
}

function _replaceSelection(newText, btn) {
    // Si pas de cible (sélection hors champ éditable), fallback clipboard
    if (!_lastSelection?.sourceEl) {
        navigator.clipboard?.writeText(newText)?.then(() => {
            const orig = btn.textContent;
            btn.textContent = '✓ Copié (cible introuvable)';
            setTimeout(() => { btn.textContent = orig; }, 1800);
        });
        return;
    }

    const { el, start, end } = _lastSelection.sourceEl;
    if (!el || typeof el.value !== 'string') return;

    // Remplace la sélection capturée
    el.value = el.value.slice(0, start) + newText + el.value.slice(end);
    el.focus();
    el.selectionStart = el.selectionEnd = start + newText.length;

    // Dispatch events pour que les listeners (prompt preview etc.) réagissent
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    btn.textContent = '✓ Remplacé';
    setTimeout(_closeModal, 500);
}

// ── Hook clavier global ──────────────────────────────────────────

function _handleShortcut(ev) {
    if (!isGhostwriterEnabled()) return;
    const cmd = ev.metaKey || ev.ctrlKey;
    if (!cmd || !ev.shiftKey) return;
    if (ev.key.toLowerCase() !== SHORTCUT_KEY) return;

    ev.preventDefault();
    ev.stopPropagation();

    // Texte initial : la sélection courante (capturée par _trackSelection)
    // ou tente de relire la sélection live au moment du shortcut
    const initialText = _lastSelection?.text
        || (window.getSelection()?.toString() || '').trim();

    _openModal(initialText);
}

// ── API publique ─────────────────────────────────────────────────

/**
 * Initialise les hooks globaux (idempotent).
 * À appeler une fois au boot dans main.js.
 */
export function initGhostwriter() {
    if (_hookInitialized) return;
    _hookInitialized = true;
    if (typeof document === 'undefined') return;

    document.addEventListener('keydown', _handleShortcut);
    document.addEventListener('selectionchange', _trackSelection);

    console.info('[Ghost Writer] Hook initialisé. Raccourci: Cmd/Ctrl+Shift+G. Mode:', _getMode());
}

/**
 * Ouvre le modal programmatiquement, optionnellement avec un texte
 * préchargé. Respecte le flag (no-op si désactivé).
 */
export function openGhostwriter(initialText = '') {
    if (!isGhostwriterEnabled()) {
        console.warn('[Ghost Writer] Flag désactivé. Active : localStorage.setItem("ks_ghostwriter", "1")');
        return;
    }
    _openModal(initialText);
}

/**
 * Sprint GW-2 — API publique pour le workspace artefact A-COM-005.
 * Route la réécriture selon le mode configuré (mock/real/auto).
 * Idempotent : peut être appelé depuis le service système OU le workspace.
 *
 * @param {string} text  Texte source à réécrire (5-5000 chars)
 * @param {object} opts  { tone?, intent?, vouvoie?, mode?, audience?, action?, lengthTarget? }
 * @returns {Promise<{variants:Array<{label,text}>, model, usage}>}
 */
export async function rewriteText(text, opts = {}) {
    return _rewrite(text, opts);
}

/**
 * Mode courant ('mock' | 'real' | 'auto'). Expose pour affichage UI.
 */
export function getGhostwriterMode() { return _getMode(); }

/**
 * Quota restant aujourd'hui. Expose pour affichage UI.
 */
export function getGhostwriterQuotaRemaining() { return _quotaRemaining(); }

/**
 * Décrémente le quota après un appel réussi. À appeler explicitement
 * depuis le workspace (le service système ghostwriter.js le fait déjà
 * automatiquement dans _handleGenerate).
 */
export function bumpGhostwriterQuota() { _bumpQuota(); }

/**
 * Helpers exposés pour usage avancé / debug console.
 */
export const _ghostwriter_debug = {
    getMode      : _getMode,
    getQuota     : _getQuotaState,
    quotaRemaining: _quotaRemaining,
    callMock     : _callMock,
    callReal     : _callReal,
};
