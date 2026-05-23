/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Ghost Writer Frontend v0.3 (Phase 2 — quota serveur)
   ─────────────────────────────────────────────────────────────
   Service système transversal de réécriture textuelle.
   Hook global Cmd+Shift+G + selection listener + Modal 60/40.

   Status : ADDITIF, behind feature flag.
   Activation :
     - window.__KS_GHOSTWRITER__ = true              (dev, in-memory)
     - localStorage.setItem('ks_ghostwriter','1')    (persistant)

   Backend :
     - POST /api/ghostwriter/rewrite → Gemma 4 sur Cloudflare Workers AI.
     - GET  /api/ghostwriter/quota   → état du quota pour la licence.
     - Nécessite ks_jwt en localStorage (licence active).
     - Nécessite `[ai] binding = "AI"` dans wrangler.toml côté Worker.
     - En cas d'erreur backend, l'UI affiche un message actionnable —
       PAS de fallback mock (qui serait trompeur).

   Quota (Phase 2 — 2026-05-23) :
     - SOT serveur (D1 ghostwriter_usage). Grille :
         DEMO=1 / STARTER=3 / PRO=10 / MAX=50 / ADMIN=illimité.
     - Cache module mis à jour à chaque /quota (modal open) et à
       chaque /rewrite réussi (la réponse renvoie le quota à jour).
     - Le serveur est juge ; le frontend affiche, pré-désactive
       le bouton si remaining=0, mais accepte sans broncher un
       429 si une race se produit cross-device.

   Doctrine "Contenant / Contenu" :
     - Module standalone, aucun import des artefacts existants.
     - Réutilisable depuis n'importe quel pad.
     - Pads pourront déclarer `{ "ghostwriter": true }` dans leur
       JSON pour intégration native (Phase 5 Sprint B).
   ═══════════════════════════════════════════════════════════════ */

import { CF_API } from './pads-loader.js';

// ── Constants ─────────────────────────────────────────────────────
const FLAG_LS_KEY     = 'ks_ghostwriter';
const SHORTCUT_KEY    = 'g';
const MIN_TEXT_LENGTH = 5;
const MAX_TEXT_LENGTH = 5000;

// ── State (module-private) ────────────────────────────────────────
let _hookInitialized = false;
let _modalOpen       = false;
let _lastSelection   = null;   // { text, sourceEl: { el, start, end } | null }

// ── Cache quota serveur ──────────────────────────────────────────
// Source de vérité = serveur. Ce cache n'est qu'une projection pour
// l'UI synchrone (les modals/workspaces appellent getQuotaRemaining()
// sans await). Rafraîchi par _fetchQuota() (au modal open) et par la
// réponse de _callReal() (après chaque rewrite réussi).
//
// max=null     → plan ADMIN (illimité)
// max=0        → plan inconnu côté serveur (jamais autorisé)
// fetchedAt=0  → jamais rafraîchi (l'UI affiche "—" plutôt que 0)
let _quotaCache = {
  plan      : null,
  used      : 0,
  max       : null,
  remaining : null,
  unlimited : false,
  fetchedAt : 0,
};

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

// ── Quota — projection du cache module ────────────────────────────

// Met à jour le cache à partir d'un objet quota serveur
// ({plan, used, max, remaining, unlimited}).
function _ingestQuota(q) {
    if (!q || typeof q !== 'object') return;
    _quotaCache = {
        plan      : q.plan      ?? null,
        used      : q.used      ?? 0,
        max       : q.max       ?? null,
        remaining : q.remaining ?? null,
        unlimited : !!q.unlimited,
        fetchedAt : Date.now(),
    };
}

// Décrémente le cache local (effet visuel immédiat). Le serveur reste
// SOT — si le cache local diverge, le prochain /quota ou /rewrite le
// resynchronise. Appelé en optimistic update + après /rewrite.
function _decrementCache() {
    if (_quotaCache.unlimited) return;
    if (typeof _quotaCache.remaining === 'number' && _quotaCache.remaining > 0) {
        _quotaCache.remaining -= 1;
        _quotaCache.used      += 1;
    }
}

// Fetch /api/ghostwriter/quota et met à jour le cache. Silencieux
// en cas d'erreur (réseau down → on garde l'ancien cache).
async function _fetchQuota() {
    const jwt = (() => { try { return localStorage.getItem('ks_jwt'); } catch (_) { return null; }})();
    if (!jwt) return null;
    try {
        const res = await fetch(`${CF_API}/api/ghostwriter/quota`, {
            headers: { 'Authorization': `Bearer ${jwt}` },
        });
        if (!res.ok) return null;
        const q = await res.json();
        _ingestQuota(q);
        return q;
    } catch (_) { return null; }
}

function _quotaRemaining() {
    if (_quotaCache.unlimited) return Infinity;
    return _quotaCache.remaining;  // peut être null si jamais fetched
}

function _quotaMax() {
    if (_quotaCache.unlimited) return Infinity;
    return _quotaCache.max;
}

function _quotaPlan() {
    return _quotaCache.plan;
}

// Affichage textuel court pour les chips UI. Tolérant aux états
// indéterminés (null/Infinity) pour éviter d'afficher "0/null".
function _quotaLabel() {
    if (_quotaCache.unlimited) return '∞ / jour (ADMIN)';
    if (_quotaCache.fetchedAt === 0) return '—/— appels';
    const r = _quotaCache.remaining;
    const m = _quotaCache.max;
    const p = _quotaCache.plan ? ` · ${_quotaCache.plan}` : '';
    return `${r}/${m} restants aujourd'hui${p}`;
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

// ── Backend call (Gemma 4 sur Cloudflare Workers AI) ──────────────

/**
 * Appel POST /api/ghostwriter/rewrite avec JWT.
 * Le Worker doit avoir le binding [ai] configuré dans wrangler.toml.
 * En cas d'erreur, throw — l'UI doit afficher un message actionnable
 * (notamment pour les 503 "Workers AI non configuré" → guide deploy).
 */
async function _callReal(text, opts) {
    const jwt = localStorage.getItem('ks_jwt');
    if (!jwt) {
        throw new Error('Aucun JWT en session — connectez-vous (Ghost Writer nécessite une licence active).');
    }

    const res = await fetch(`${CF_API}/api/ghostwriter/rewrite`, {
        method: 'POST',
        headers: {
            'Content-Type'  : 'application/json',
            'Authorization' : `Bearer ${jwt}`,
        },
        body: JSON.stringify({
            text,
            tone        : opts?.tone         || null,
            intent      : opts?.intent       || null,
            vouvoie     : opts?.vouvoie     ?? null,
            mode        : opts?.mode         || null,
            audience    : opts?.audience     || null,
            action      : opts?.action       || null,
            lengthTarget: opts?.lengthTarget || null,
        }),
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        let errBody = null;
        try {
            errBody = await res.json();
            msg = errBody.error || errBody.message || msg;
        } catch (_) {}
        // 429 = quota dépassé. Le backend renvoie {error, quota:{...}}
        // — on resync le cache pour que l'UI affiche le bon "0/max".
        if (res.status === 429 && errBody?.quota) {
            _ingestQuota(errBody.quota);
        }
        const e = new Error(msg);
        e.status = res.status;
        e.quota  = errBody?.quota || null;
        throw e;
    }

    // Réponse 200 — la Phase 2 enrichit le payload avec {quota:{...}}.
    // On l'ingère pour resync le cache (autoritatif côté serveur).
    const payload = await res.json();
    if (payload?.quota) _ingestQuota(payload.quota);
    return payload;
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
                        <span class="gw-quota">${_quotaLabel()}</span>
                        <span class="gw-mode-chip">Gemma 4</span>
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

    // Fetch quota frais en arrière-plan (cache initial ou périmé > 60s).
    // L'UI affiche "—/—" puis se met à jour quand la réponse arrive.
    const stale = Date.now() - _quotaCache.fetchedAt > 60_000;
    if (stale) {
        _fetchQuota().then(() => _refreshQuotaChip(overlay)).catch(() => {});
    }
}

// Met à jour le chip quota dans un modal déjà rendu.
function _refreshQuotaChip(overlay) {
    const el = overlay?.querySelector?.('.gw-quota');
    if (el) el.textContent = _quotaLabel();
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

    // Quota check (optimiste — le serveur reste juge ultime via 429).
    // remaining=null = quota jamais fetched → on laisse passer, le
    // serveur tranchera. remaining=0 = certain qu'on est à sec.
    if (_quotaRemaining() === 0) {
        const plan = _quotaPlan() || 'cette licence';
        _setStatus(status, `Quota journalier atteint (${_quotaMax()}/jour sur ${plan}). Passez à un plan supérieur ou réessayez demain.`, 'error');
        return;
    }

    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="gw-spinner"></span><span>Génération…</span>';
    _setStatus(status, '', null);

    // Optimistic update : décrémente le cache immédiatement pour que
    // l'utilisateur voie le quota baisser. Si le serveur renvoie un
    // quota différent dans la réponse, _ingestQuota le resync.
    _decrementCache();
    _refreshQuotaChip(overlay);

    try {
        const result = await _callReal(text, { tone: tone || null });
        _renderVariants(variants, result.variants);
        _setStatus(status, `✓ ${result.variants.length} variantes (modèle: ${result.model})`, null);
        _refreshQuotaChip(overlay);  // resync depuis la réponse serveur
    } catch (e) {
        _setStatus(status, `✗ ${_friendlyError(e)}`, 'error');
        // Sur 429 _callReal a déjà resync le cache. Sur autre erreur
        // (5xx, réseau), le backend a fait bump+revert donc le serveur
        // a rétabli l'état ; on resync pour annuler notre décrément
        // optimiste (sinon l'UI affiche un quota faussement diminué).
        if (e?.status === 429) {
            _refreshQuotaChip(overlay);
        } else {
            _fetchQuota().then(() => _refreshQuotaChip(overlay)).catch(() => {});
        }
    } finally {
        goBtn.disabled = false;
        goBtn.innerHTML = '<span>Réécrire en 3 variantes</span>';
    }
}

/**
 * Traduit une erreur backend en message actionnable. Le cas 503 /
 * "Workers AI non configuré" mérite un guide explicite plutôt qu'un
 * message brut, car il indique que le binding [ai] manque dans le
 * Worker (voir HANDOFF_GHOSTWRITER_DEPLOY_AND_CLEANUP.md Phase B).
 */
function _friendlyError(e) {
    const msg = String(e?.message || e || '');
    const isBackendKO = e?.status === 503 || /workers ai non configur/i.test(msg);
    if (isBackendKO) {
        return 'Backend Gemma 4 indisponible. Voir HANDOFF_GHOSTWRITER_DEPLOY_AND_CLEANUP.md (Phase B).';
    }
    // 429 → message déjà formaté par le backend (mentionne plan + reset UTC)
    if (e?.status === 429) return msg;
    return msg;
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

    console.info('[Ghost Writer] Hook initialisé. Raccourci: Cmd/Ctrl+Shift+G. Backend: Gemma 4.');
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
 * API publique pour le workspace artefact A-COM-005 et tout autre
 * consommateur. Appelle directement le backend Gemma 4 sur Workers AI.
 *
 * @param {string} text  Texte source à réécrire (5-5000 chars)
 * @param {object} opts  { tone?, intent?, vouvoie?, mode?, audience?, action?, lengthTarget? }
 * @returns {Promise<{variants:Array<{label,text}>, model, usage}>}
 */
export async function rewriteText(text, opts = {}) {
    return _callReal(text, opts);
}

/**
 * Traduit une erreur backend en message actionnable.
 * Exposé pour le workspace artefact (réutilisation).
 */
export function friendlyGhostwriterError(e) { return _friendlyError(e); }

/**
 * Quota restant aujourd'hui (projection cache serveur).
 * - Infinity si plan ADMIN
 * - null si jamais fetched (le caller doit afficher "—" plutôt que 0)
 * - number sinon
 */
export function getGhostwriterQuotaRemaining() { return _quotaRemaining(); }

/**
 * Quota maximum quotidien pour le plan courant (lecture cache serveur).
 * Variable selon plan : DEMO=1 / STARTER=3 / PRO=10 / MAX=50 / ADMIN=∞.
 * - Infinity si plan ADMIN
 * - null si jamais fetched
 */
export function getGhostwriterQuotaMax() { return _quotaMax(); }

/**
 * Plan courant ('DEMO' | 'STARTER' | 'PRO' | 'MAX' | 'ADMIN' | null).
 */
export function getGhostwriterPlan() { return _quotaPlan(); }

/**
 * Force un refresh du cache quota depuis le serveur.
 * À appeler depuis un workspace à l'ouverture pour avoir l'état frais.
 * Retourne le payload serveur ({plan, used, max, remaining, unlimited})
 * ou null si pas de JWT / erreur réseau.
 */
export async function refreshGhostwriterQuota() { return _fetchQuota(); }

/**
 * Décrémente optimistement le cache local (effet visuel immédiat).
 * Le serveur reste SOT — la prochaine réponse /rewrite ou /quota
 * resynchronise si divergence. Gardé exporté pour rétro-compat avec
 * le workspace artefact (ghostwriter-studio.js) qui l'appelle après
 * rewriteText() success.
 */
export function bumpGhostwriterQuota() { _decrementCache(); }

/**
 * Helpers exposés pour usage avancé / debug console.
 */
export const _ghostwriter_debug = {
    cache         : () => _quotaCache,
    quotaRemaining: _quotaRemaining,
    fetchQuota    : _fetchQuota,
    callReal      : _callReal,
};
