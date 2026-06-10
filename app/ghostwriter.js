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
import { renderChainRail, bindChainRail, getChain, setChain, networkLabel } from './lib/content-chain.js';

// ── Constants ─────────────────────────────────────────────────────
const FLAG_LS_KEY     = 'ks_ghostwriter';
const SHORTCUT_KEY    = 'g';
const MIN_TEXT_LENGTH = 5;
const MAX_TEXT_LENGTH = 5000;

// ── State (module-private) ────────────────────────────────────────
let _hookInitialized = false;
let _modalOpen       = false;
let _lastSelection   = null;   // { text, sourceEl: { el, start, end } | null }
// Opts pré-réglés passés via openGhostwriter(text, opts) — utilisés
// au moment du generate. Réinitialisés à la fermeture du modal pour
// éviter que des opts d'un précédent open contaminent le prochain.
// L'utilisateur peut toujours surcharger le `tone` via les boutons UI.
let _presetOpts      = null;

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
        period    : q.period    ?? 'day',   // 'month' = crédits IA · 'day' = quota/jour legacy
        fetchedAt : Date.now(),
    };
}

// Message unique d'épuisement, adapté au système de la licence (crédits
// mensuels vs quota/jour legacy). Source de vérité pour le studio ET le
// modal — évite de re-hardcoder "/jour…demain" partout.
function _quotaExhaustedMessage() {
    const plan = _quotaCache.plan || 'cette licence';
    const max  = _quotaCache.max;
    if (_quotaCache.period === 'month') {
        return `Crédits IA épuisés ce mois (${max} sur le plan ${plan}). Ajoutez un pack de crédits dans les Réglages, ou patientez jusqu'au 1er du mois.`;
    }
    return `Quota journalier atteint (${max}/jour sur ${plan}). Passez à un plan supérieur ou réessayez demain.`;
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

    const reqInit = {
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
            // Mode « composer un post » (chaîne) : 1 post développé, ton réseau.
            composePost : opts?.composePost === true || undefined,
            network     : opts?.network || undefined,
        }),
    };

    // Re-tentative sur ÉCHEC RÉSEAU (« Load failed »/timeout : le fetch throw,
    // aucune réponse n'arrive) — 2 essais, le 2e après un court délai. On NE
    // retente PAS une réponse HTTP (4xx/5xx = le serveur a répondu, traitée
    // plus bas). Bénéficie au modal, au Studio ET aux pads inline (tous passent
    // par _callReal).
    let res;
    let netErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            res = await fetch(`${CF_API}/api/ghostwriter/rewrite`, reqInit);
            netErr = null;
            break;
        } catch (e) {
            netErr = e;
            if (attempt < 2) await new Promise(r => setTimeout(r, 900));
        }
    }
    if (netErr || !res) {
        const e = new Error('Le service de réécriture n\'a pas répondu (réseau ou délai dépassé). Réessaie dans un instant.');
        e.status = 0;
        throw e;
    }

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
        e.code   = errBody?.code  || null;   // ex: 'AI_BUDGET_EXHAUSTED'
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
.gw-source:focus { outline: 0; border-color: rgba(99,102,241,.4); background: rgba(255,255,255,.06); }
.gw-options { display: flex; gap: 8px; flex-wrap: wrap; }
.gw-option-btn {
    padding: 7px 14px; border-radius: 100px;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
    color: var(--text-muted, #aaa); font-size: 12px; font-weight: 500;
    cursor: pointer; transition: all .14s ease;
}
.gw-option-btn.gw-on {
    background: rgba(99,102,241,.18); border-color: rgba(99,102,241,.45);
    color: var(--text-primary, #fff);
}
.gw-option-btn:hover:not(.gw-on) { background: rgba(255,255,255,.07); color: #ddd; }
.gw-go {
    width: 100%; padding: 12px 20px;
    background: linear-gradient(135deg, var(--gold, #6366f1), var(--gold2, #818cf8));
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
.gw-mode-chip { background: rgba(99,102,241,.12); color: #818cf8; }
.gw-variants { display: flex; flex-direction: column; gap: 14px; }
/* Carousel (Phase 3) — 3 slides superposées, seule l'active visible.
   Hauteur fixe pour éviter le saut UI au changement de slide. */
.gw-carousel {
    position: relative;
    display: grid;
    grid-template-columns: 28px 1fr 28px;
    align-items: stretch;
    gap: 8px;
    min-height: 220px;
}
.gw-slides {
    position: relative;
    overflow: hidden;
    border-radius: 12px;
    background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.08);
}
.gw-slide {
    position: absolute; inset: 0;
    padding: 16px 18px;
    opacity: 0;
    transform: translateX(8px);
    transition: opacity .22s ease, transform .22s cubic-bezier(.16,1,.3,1);
    overflow-y: auto;
    pointer-events: none;
}
.gw-slide.is-active {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
}
.gw-nav {
    background: transparent;
    border: 1px solid rgba(255,255,255,.08);
    color: var(--text-muted, #aaa);
    border-radius: 8px;
    font-size: 20px; line-height: 1;
    cursor: pointer;
    transition: all .15s ease;
    align-self: stretch;
}
.gw-nav:hover { background: rgba(99,102,241,.14); border-color: rgba(99,102,241,.35); color: #fff; }
.gw-variant-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #818cf8; margin-bottom: 9px; font-weight: 600; }
.gw-variant-text { color: var(--text-primary, #f0f0f0); font-size: 13px; line-height: 1.65; white-space: pre-wrap; word-wrap: break-word; }
.gw-indicators { display: flex; justify-content: center; gap: 6px; margin-top: 4px; }
.gw-indicator {
    min-width: 28px; height: 28px;
    border-radius: 100px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    color: var(--text-muted, #888);
    font-size: 12px; font-weight: 600; cursor: pointer;
    transition: all .14s ease;
}
.gw-indicator.is-active {
    background: rgba(99,102,241,.18);
    border-color: rgba(99,102,241,.5);
    color: #fff;
}
.gw-indicator:hover:not(.is-active) { background: rgba(255,255,255,.07); color: #ddd; }
.gw-actions-row {
    display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap;
}
.gw-mini-btn {
    padding: 7px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    color: var(--text-primary, #ddd); transition: all .15s ease;
}
.gw-mini-btn:hover { background: rgba(99,102,241,.14); border-color: rgba(99,102,241,.35); color: #fff; }
.gw-mini-btn.gw-action-send { background: rgba(99,102,241,.18); border-color: rgba(99,102,241,.42); color: #c7d2fe; }
.gw-mini-btn.gw-action-send:hover { background: rgba(99,102,241,.30); border-color: rgba(99,102,241,.6); color: #fff; }
.gw-shortcut-hint { font-size: 11px; color: var(--text-muted, #888); margin-left: auto; }
.gw-empty { color: var(--text-muted, #888); font-size: 13px; text-align: center; padding: 40px 0; line-height: 1.6; }
/* ── Mode compose (chaîne) : 1 grand post + archive ── */
.gw-compose-wrap { display: flex; flex-direction: column; gap: 14px; }
.gw-compose-post {
    background: rgba(127,127,127,.06); border: 1px solid var(--bd, rgba(255,255,255,.08));
    border-radius: 12px; padding: 18px 20px; max-height: 72vh; overflow-y: auto;
}
.gw-compose-post .gw-variant-text { font-size: 14px; line-height: 1.7; }
.gw-archive { border-top: 1px solid var(--bd, rgba(255,255,255,.08)); padding-top: 14px; }
.gw-archive-head {
    font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--text-muted, #888); font-weight: 600; margin-bottom: 10px;
    display: flex; align-items: center; gap: 8px;
}
.gw-archive-count { background: var(--gold3, rgba(99,102,241,.14)); color: var(--gold2, #818cf8); border-radius: 100px; padding: 1px 8px; font-size: 10px; }
.gw-archive-list { display: flex; flex-direction: column; gap: 8px; }
.gw-archive-item { background: rgba(127,127,127,.06); border: 1px solid var(--bd, rgba(255,255,255,.07)); border-radius: 10px; padding: 10px 12px; }
.gw-archive-net { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .04em; color: var(--gold2, #818cf8); margin-bottom: 4px; text-transform: uppercase; }
.gw-archive-text { font-size: 12.5px; color: var(--text-muted, #aaa); line-height: 1.5; }
.gw-archive-acts { display: flex; gap: 6px; margin-top: 9px; }
.gw-archive-btn {
    padding: 5px 11px; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer;
    background: rgba(127,127,127,.12); border: 1px solid var(--bd, rgba(255,255,255,.1));
    color: var(--text-muted, #ccc); transition: all .14s ease;
}
.gw-archive-btn:hover { color: var(--text-primary, #fff); background: rgba(127,127,127,.2); }
.gw-arch-send { background: rgba(99,102,241,.16); border-color: rgba(99,102,241,.35); color: #c7d2fe; }
.gw-arch-send:hover { background: rgba(99,102,241,.28); color: #fff; }
.gw-spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,.3);
    border-top-color: white; border-radius: 50%;
    animation: gw-spin 0.8s linear infinite;
    display: inline-block;
}
@keyframes gw-spin { to { transform: rotate(360deg); } }

/* ── MODE CLAIR ── */
html.light-mode .gw-modal {
    border-color: rgba(0,0,0,.1);
    box-shadow: 0 24px 64px rgba(0,0,0,.22);
}
html.light-mode .gw-head { border-bottom-color: rgba(0,0,0,.08); }
html.light-mode .gw-title { color: #0f172a; }
html.light-mode .gw-subtitle { color: #64748b; }
html.light-mode .gw-close { color: #64748b; }
html.light-mode .gw-close:hover { color: #0f172a; background: rgba(0,0,0,.05); }
html.light-mode .gw-left { border-right-color: rgba(0,0,0,.08); }
html.light-mode .gw-label { color: #64748b; }
html.light-mode .gw-source {
    background: #fff; border-color: rgba(0,0,0,.14);
    color: #0f172a;
}
html.light-mode .gw-source::placeholder { color: rgba(0,0,0,.4); }
html.light-mode .gw-source:focus { border-color: rgba(79,70,229,.5); background: #fff; }
html.light-mode .gw-option-btn {
    background: rgba(0,0,0,.03); border-color: rgba(0,0,0,.1);
    color: #475569;
}
html.light-mode .gw-option-btn.gw-on {
    background: rgba(79,70,229,.12); border-color: rgba(79,70,229,.4);
    color: #0f172a;
}
html.light-mode .gw-option-btn:hover:not(.gw-on) { background: rgba(0,0,0,.06); color: #0f172a; }
html.light-mode .gw-status { color: #64748b; }
html.light-mode .gw-meta { color: #64748b; }
html.light-mode .gw-quota, html.light-mode .gw-mode-chip {
    background: rgba(0,0,0,.03); border-color: rgba(0,0,0,.1);
}
html.light-mode .gw-mode-chip { background: rgba(79,70,229,.1); color: #4f46e5; }
html.light-mode .gw-slides {
    background: rgba(0,0,0,.02); border-color: rgba(0,0,0,.1);
}
html.light-mode .gw-nav {
    border-color: rgba(0,0,0,.1);
    color: #475569;
}
html.light-mode .gw-nav:hover { background: rgba(79,70,229,.1); border-color: rgba(79,70,229,.35); color: #0f172a; }
html.light-mode .gw-variant-label { color: #4f46e5; }
html.light-mode .gw-variant-text { color: #0f172a; }
html.light-mode .gw-indicator {
    background: rgba(0,0,0,.03);
    border-color: rgba(0,0,0,.1);
    color: #64748b;
}
html.light-mode .gw-indicator.is-active {
    background: rgba(79,70,229,.12);
    border-color: rgba(79,70,229,.45);
    color: #0f172a;
}
html.light-mode .gw-indicator:hover:not(.is-active) { background: rgba(0,0,0,.06); color: #0f172a; }
html.light-mode .gw-actions-row { color: #64748b; }
html.light-mode .gw-mini-btn {
    background: rgba(0,0,0,.03); border-color: rgba(0,0,0,.1);
    color: #0f172a;
}
html.light-mode .gw-mini-btn:hover { background: rgba(79,70,229,.1); border-color: rgba(79,70,229,.35); color: #0f172a; }
html.light-mode .gw-shortcut-hint { color: #64748b; }
html.light-mode .gw-empty { color: #64748b; }
    `;

    const style = document.createElement('style');
    style.id = 'ks-gw-styles';
    style.textContent = css;
    document.head.appendChild(style);
}

// ── Modal builder ────────────────────────────────────────────────

function _buildModalHTML(initialText, presetOpts) {
    // Si un preset.tone matche un des chips, on pré-sélectionne ce chip
    // pour que l'utilisateur voie le ton choisi par défaut. Sinon "Auto"
    // reste actif et le preset complet (tone + autres opts) est appliqué
    // au generate via _presetOpts (cf. _handleGenerate).
    const presetTone = presetOpts?.tone || '';
    const isOn = (t) => (t === presetTone ? 'gw-on' : '');
    const autoOn = presetTone ? '' : 'gw-on';

    // Chip contextuel si on est en mode "pré-réglé depuis un pad" — donne
    // à l'utilisateur une indication visuelle qu'il n'est pas en modal
    // libre mais qu'un contexte d'invocation existe (ex: champ Atouts d'A2).
    const contextChip = presetOpts?.context
        ? `<span class="gw-mode-chip" title="Mode pré-réglé depuis le champ source">${_escapeHtml(presetOpts.context)}</span>`
        : '';

    // Rail de chaîne (étape ② Rédaction) si on est arrivé via le parcours
    // (le relais Brainstorming a posé l'état porté). Hors chaîne → '' →
    // l'en-tête montre le titre classique « Ghost Writer ».
    const railHTML = renderChainRail('write');
    // Mode CHAÎNE (arrivé via le parcours, réseau porté) = composer UN post
    // développé, ton calé sur le réseau → PAS de pills de ton, bouton « Composer
    // le post ». Hors chaîne = rewrite classique (3 variantes + pills de ton).
    const chainMode = !!railHTML;
    const srcLabel  = chainMode ? 'Angle à développer' : 'Texte source';
    const srcPlace  = chainMode ? 'Décrivez l\'angle ou l\'idée à transformer en post…' : 'Collez ou tapez votre texte ici…';
    const goLabel   = chainMode ? 'Composer le post' : 'Réécrire en 3 variantes';
    // Mode CHAÎNE : l'archive « Posts composés » vit dans le panneau GAUCHE
    // (sous la méta) → plus de place quand elle grossit ; la droite ne garde
    // que le post courant + ses actions. Hors chaîne : pas d'archive.
    const archiveSlot = chainMode ? '<div class="gw-archive" id="gw-archive"></div>' : '';
    const tonesHTML = chainMode ? '' : `
                    <div class="gw-label">Ton souhaité</div>
                    <div class="gw-options" id="gw-tones" data-selected="${_escapeHtml(presetTone)}">
                        <button class="gw-option-btn ${autoOn}" data-tone="">Auto</button>
                        <button class="gw-option-btn ${isOn('formel professionnel')}" data-tone="formel professionnel">Formel</button>
                        <button class="gw-option-btn ${isOn('chaleureux empathique')}" data-tone="chaleureux empathique">Chaleureux</button>
                        <button class="gw-option-btn ${isOn('concis direct')}" data-tone="concis direct">Concis</button>
                        <button class="gw-option-btn ${isOn('persuasif vendeur')}" data-tone="persuasif vendeur">Persuasif</button>
                    </div>`;

    return `
        <div class="gw-modal" role="dialog" aria-label="Ghost Writer" data-chain="${chainMode ? '1' : '0'}">
            <div class="gw-head">
                ${railHTML || `<div>
                    <h2 class="gw-title">Ghost Writer</h2>
                    <div class="gw-subtitle">Réécrivez votre texte — 3 variantes générées</div>
                </div>`}
                <button class="gw-close" id="gw-close-btn" aria-label="Fermer (Esc)">✕</button>
            </div>
            <div class="gw-body">
                <div class="gw-left">
                    <div class="gw-label">${srcLabel}</div>
                    <textarea id="gw-source" class="gw-source" placeholder="${srcPlace}">${_escapeHtml(initialText)}</textarea>
                    ${tonesHTML}
                    <button id="gw-go" class="gw-go">
                        <span>${goLabel}</span>
                    </button>
                    <div id="gw-status" class="gw-status"></div>
                    <div class="gw-meta">
                        <span class="gw-quota">${_quotaLabel()}</span>
                        <span class="gw-mode-chip">Mistral</span>
                        ${contextChip}
                    </div>
                    ${archiveSlot}
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

// Pad-Aware (Phase 3) — convertit un objet formContext en texte source
// compact pour Gemma 4. formContext est typé : { fieldId: {label, value} }
// (cf. ui-renderer._initGhostwriterButtons). On sort un format type
// "Label1 : valeur — Label2 : valeur" qui se prête bien à la réécriture.
function _composeSourceFromForm(formContext) {
    if (!formContext || typeof formContext !== 'object') return '';
    const parts = [];
    for (const [_, entry] of Object.entries(formContext)) {
        if (entry && entry.value) {
            parts.push(`${entry.label} : ${entry.value}`);
        }
    }
    return parts.join(' — ');
}

function _openModal(initialText, presetOpts) {
    if (_modalOpen) return;
    _modalOpen = true;
    _injectCSS();

    // Mémorise les opts pré-réglés pour _handleGenerate. Si null/absent,
    // comportement legacy (l'UI fournit le tone, le reste reste à null).
    _presetOpts = presetOpts && typeof presetOpts === 'object' ? { ...presetOpts } : null;

    // Pad-Aware (Phase 3) — si le champ source est vide MAIS qu'on a un
    // formContext rempli depuis le pad (autres champs du formulaire),
    // on construit un texte source minimal lisible que Gemma 4 va
    // ré-écrire en atouts vendeur. Format compact, factuel, sans bla-bla
    // — Gemma fait le polish.
    //   Ex: "Type: T2 — Ville: Marseille 8ème — Surface: 65m² — Prix: 245000€"
    //       → 3 variantes type "Spacieux T2 au cœur du 8ème arrondissement..."
    const textTrim = (initialText || '').trim();
    let effectiveText = textTrim;
    if (!textTrim && _presetOpts?.formContext) {
        effectiveText = _composeSourceFromForm(_presetOpts.formContext);
    }

    const overlay = document.createElement('div');
    overlay.className = 'gw-overlay';
    overlay.id = 'gw-overlay';
    overlay.innerHTML = _buildModalHTML(effectiveText, _presetOpts);
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
    if (!overlay) { _modalOpen = false; _presetOpts = null; return; }
    overlay.classList.remove('gw-on');
    setTimeout(() => {
        overlay.remove();
        _modalOpen  = false;
        _presetOpts = null;  // reset pour ne pas contaminer le prochain open
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

    // Rail de chaîne — « ‹ » = fermer le modal. Le débat Brainstorming reste
    // ouvert dessous (le modal s'ouvre par-dessus) → fermer = revenir à
    // l'étape ① sans rien perdre.
    bindChainRail(overlay, { onBack: _closeModal });

    // Mode CHAÎNE : rend l'archive « Posts composés » dans le panneau GAUCHE
    // dès l'ouverture → on voit les posts déjà composés avant même de composer
    // (l'archive reste à gauche, le post courant s'affichera à droite).
    if (overlay.querySelector('.gw-modal')?.dataset.chain === '1') {
        _renderComposeArchive(overlay.querySelector('#gw-archive'));
    }
}

async function _handleGenerate(overlay) {
    const source   = overlay.querySelector('#gw-source');
    const status   = overlay.querySelector('#gw-status');
    const variants = overlay.querySelector('#gw-variants');
    const goBtn    = overlay.querySelector('#gw-go');
    const chainMode = overlay.querySelector('.gw-modal')?.dataset.chain === '1';
    const tone     = overlay.querySelector('#gw-tones')?.dataset.selected || '';

    // Mode CHAÎNE : on COMPOSE un post développé, ton calé sur le réseau porté.
    // Hors chaîne : rewrite classique (preset du pad + ton choisi via les pills).
    // context / targetEl / replaceMode / formContext / include_fields / label
    // sont des contrôles UI, jamais envoyés au body — destructurés avant le spread.
    const {
        context: _ctx, targetEl: _t, replaceMode: _rm,
        formContext: _fc, include_fields: _if, label: _l,
        tone: presetTone,
        ...presetRest
    } = _presetOpts || {};
    const callOpts = chainMode
        ? { composePost: true, network: getChain()?.network || null }
        : { ...presetRest, tone: tone || presetTone || null };

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
        _setStatus(status, _quotaExhaustedMessage(), 'error');
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
        const result = await _callReal(text, callOpts);
        // Archive le post composé (chaîne) AVANT le rendu → l'archive l'inclut.
        if (chainMode && result.variants?.[0]?.text) {
            _addToComposeArchive({ text: result.variants[0].text, network: getChain()?.network || null });
        }
        _renderVariants(variants, result.variants);
        _setStatus(status, chainMode ? `✓ Post composé (modèle: ${result.model})` : `✓ ${result.variants.length} variantes (modèle: ${result.model})`, null);
        _refreshQuotaChip(overlay);  // resync depuis la réponse serveur
    } catch (e) {
        _setStatus(status, `✗ ${_friendlyError(e)}`, 'error');
        // Vrai quota GW dépassé (429 AVEC objet quota) : _callReal a déjà
        // resync le cache, on rafraîchit juste la pastille. Tout autre cas
        // — budget compte Cloudflare épuisé (429 sans quota), 5xx, réseau —
        // le backend a fait bump+revert donc le quota réel est inchangé : on
        // resync pour annuler notre décrément optimiste (sinon l'UI affiche
        // un quota faussement diminué).
        if (e?.status === 429 && e?.quota) {
            _refreshQuotaChip(overlay);
        } else {
            _fetchQuota().then(() => _refreshQuotaChip(overlay)).catch(() => {});
        }
    } finally {
        goBtn.disabled = false;
        goBtn.innerHTML = chainMode ? '<span>Composer le post</span>' : '<span>Réécrire en 3 variantes</span>';
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
    // Budget IA quotidien Cloudflare épuisé (code serveur AI_BUDGET_EXHAUSTED,
    // ou erreur brute 4006). C'est l'allocation gratuite du COMPTE (10 000
    // neurones/jour), partagée par TOUS les outils IA Keystone — PAS le quota
    // Ghost Writer de la licence. Se réinitialise à 00h UTC (~2h du matin FR).
    // Message explicite pour ne pas laisser croire à une limite personnelle.
    if (e?.code === 'AI_BUDGET_EXHAUSTED' || /\b4006\b|daily free allocation|neurons|workers paid/i.test(msg)) {
        return 'Limite IA quotidienne atteinte — ça repart vers 2h du matin (heure française).';
    }
    const isBackendKO = e?.status === 503 || /workers ai non configur/i.test(msg);
    if (isBackendKO) {
        return 'Backend IA indisponible. Voir HANDOFF_GHOSTWRITER_DEPLOY_AND_CLEANUP.md (Phase B).';
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

// Relais vers Social Manager : envoie la variante active dans le composer (bout aval
// de la chaîne de contenu, cf. [[content-chain-vision]]). Pattern maison de relais
// inter-pads (cf. vefa _sendToConcierge) : import du module cible + close + ouverture
// pré-remplie via composeInSocialManager. La publication reste gated côté worker.
async function _sendToSocialManager(text, networkOverride) {
    if (!text || !text.trim()) return;
    // Réseau porté par la chaîne (choisi en ① Brainstorming) → pré-coche la
    // cible en ③ Social Manager. networkOverride = renvoi depuis l'archive
    // (réseau du post archivé). Hors chaîne network=null → comportement legacy.
    const chain   = getChain();
    const network = networkOverride || chain?.network || null;
    if (chain) setChain({ step: 'publish' });   // avance l'étape, garde le réseau
    const payload = network ? { text, targets: [network] } : { text };
    try {
        const m = await import('./social-manager.js');
        _closeModal();
        m.composeInSocialManager?.(payload);
    } catch (err) {
        console.error('[Ghostwriter] sendToSocialManager', err);
    }
}

function _renderVariants(container, variants) {
    if (!container) return;
    if (!variants || variants.length === 0) {
        container.innerHTML = '<div class="gw-empty">Aucune variante générée</div>';
        return;
    }

    // Mode CHAÎNE (compose) = 1 post développé → vue dédiée (grande zone de lecture
    // + scroll, pas de carrousel/flèches/indicateur) + archive en dessous. Sinon
    // carrousel rewrite classique (inchangé).
    if (container.closest('.gw-modal')?.dataset.chain === '1') {
        _renderComposeResult(container, variants[0]);
        return;
    }

    // Carousel (Phase 3) — les 3 variantes sont superposées en absolute,
    // seule l'active est visible. Navigation : touches 1/2/3, flèches
    // ←/→, ou clic sur les indicateurs. Compact : pas de scroll vertical
    // même avec 3 longs textes — l'utilisateur peut comparer rapidement.
    const slidesHTML = variants.map((v, i) => `
        <article class="gw-slide${i === 0 ? ' is-active' : ''}" data-idx="${i}">
            <div class="gw-variant-label">${_escapeHtml(v.label || `Variante ${i + 1}`)}</div>
            <div class="gw-variant-text">${_escapeHtml(v.text)}</div>
        </article>
    `).join('');

    const indicatorsHTML = variants.map((_, i) => `
        <button class="gw-indicator${i === 0 ? ' is-active' : ''}"
                data-idx="${i}"
                aria-label="Voir variante ${i + 1} (touche ${i + 1})">${i + 1}</button>
    `).join('');

    container.innerHTML = `
        <div class="gw-carousel" data-active="0">
            <button class="gw-nav gw-nav-prev" data-dir="-1" aria-label="Variante précédente (flèche gauche)">‹</button>
            <div class="gw-slides">${slidesHTML}</div>
            <button class="gw-nav gw-nav-next" data-dir="1" aria-label="Variante suivante (flèche droite)">›</button>
        </div>
        <div class="gw-indicators">${indicatorsHTML}</div>
        <div class="gw-actions-row">
            <button class="gw-mini-btn gw-action-copy">Copier</button>
            <button class="gw-mini-btn gw-action-replace">Remplacer</button>
            <button class="gw-mini-btn gw-action-send" title="Ouvrir Social Manager avec cette variante">Envoyer vers Social Manager</button>
            <span class="gw-shortcut-hint">Naviguez avec ←/→ ou 1/2/3</span>
        </div>
    `;

    const carousel  = container.querySelector('.gw-carousel');
    const slides    = container.querySelectorAll('.gw-slide');
    const indicators = container.querySelectorAll('.gw-indicator');
    const copyBtn   = container.querySelector('.gw-action-copy');
    const replaceBtn = container.querySelector('.gw-action-replace');
    const sendBtn   = container.querySelector('.gw-action-send');

    function goTo(idx) {
        const n = variants.length;
        if (n === 0) return;
        // Wrap-around : -1 → n-1, n → 0
        idx = ((idx % n) + n) % n;
        carousel.dataset.active = idx;
        slides.forEach((el, i)     => el.classList.toggle('is-active', i === idx));
        indicators.forEach((el, i) => el.classList.toggle('is-active', i === idx));
    }
    function activeIdx() { return parseInt(carousel.dataset.active, 10) || 0; }

    // Indicateurs cliquables
    indicators.forEach(btn => {
        btn.addEventListener('click', () => goTo(parseInt(btn.dataset.idx, 10)));
    });
    // Flèches navigation
    container.querySelectorAll('.gw-nav').forEach(btn => {
        btn.addEventListener('click', () => goTo(activeIdx() + parseInt(btn.dataset.dir, 10)));
    });

    // Actions sur variante active
    copyBtn.addEventListener('click', () => {
        const text = variants[activeIdx()]?.text || '';
        navigator.clipboard?.writeText(text)?.then(() => {
            const orig = copyBtn.textContent;
            copyBtn.textContent = '✓ Copié';
            setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        });
    });
    replaceBtn.addEventListener('click', () => {
        _replaceSelection(variants[activeIdx()]?.text || '', replaceBtn);
    });
    sendBtn?.addEventListener('click', () => _sendToSocialManager(variants[activeIdx()]?.text || ''));

    // Raccourcis clavier 1/2/3 + flèches. Attaché au document mais
    // namespaced pour éviter de polluer entre 2 modals. Cleanup au
    // close via le check _modalOpen.
    const keyHandler = (ev) => {
        if (!_modalOpen) {
            document.removeEventListener('keydown', keyHandler);
            return;
        }
        // Ignore si user en train de taper dans le textarea source
        if (ev.target?.tagName === 'TEXTAREA' || ev.target?.tagName === 'INPUT') return;
        if (ev.key === 'ArrowLeft')  { ev.preventDefault(); goTo(activeIdx() - 1); }
        if (ev.key === 'ArrowRight') { ev.preventDefault(); goTo(activeIdx() + 1); }
        const num = parseInt(ev.key, 10);
        if (num >= 1 && num <= variants.length) {
            ev.preventDefault();
            goTo(num - 1);
        }
    };
    document.addEventListener('keydown', keyHandler);
}

// ── Mode compose (chaîne) : 1 post + archive locale ──────────────
const COMPOSE_ARCHIVE_KEY = 'ks_gw_compose_archive';
const COMPOSE_ARCHIVE_MAX = 30;

function _loadComposeArchive() {
    try { const a = JSON.parse(localStorage.getItem(COMPOSE_ARCHIVE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (_) { return []; }
}
function _saveComposeArchive(arr) {
    try { localStorage.setItem(COMPOSE_ARCHIVE_KEY, JSON.stringify(arr.slice(0, COMPOSE_ARCHIVE_MAX))); } catch (_) {}
}
function _addToComposeArchive({ text, network }) {
    const t = (text || '').trim();
    if (!t) return;
    const arr = _loadComposeArchive();
    if (arr[0] && arr[0].text === t) return;   // dédup : déjà en tête
    arr.unshift({ id: `c${Date.now()}`, text: t, network: network || null, ts: Date.now() });
    _saveComposeArchive(arr);
}
function _removeFromComposeArchive(id) {
    _saveComposeArchive(_loadComposeArchive().filter(x => x.id !== id));
}

// Rendu du résultat compose : 1 grand post (scroll) + actions + archive en dessous.
function _renderComposeResult(container, variant) {
    const post = variant?.text || '';
    container.innerHTML = `
        <div class="gw-compose-wrap">
            <article class="gw-compose-post"><div class="gw-variant-text">${_escapeHtml(post)}</div></article>
            <div class="gw-actions-row">
                <button class="gw-mini-btn gw-action-copy">Copier</button>
                <button class="gw-mini-btn gw-action-replace">Remplacer</button>
                <button class="gw-mini-btn gw-action-send" title="Ouvrir Social Manager avec ce post">Envoyer vers Social Manager</button>
            </div>
        </div>
    `;
    const copyBtn = container.querySelector('.gw-action-copy');
    copyBtn?.addEventListener('click', () => {
        navigator.clipboard?.writeText(post)?.then(() => { const o = copyBtn.textContent; copyBtn.textContent = '✓ Copié'; setTimeout(() => { copyBtn.textContent = o; }, 1500); });
    });
    container.querySelector('.gw-action-replace')?.addEventListener('click', (e) => _replaceSelection(post, e.currentTarget));
    container.querySelector('.gw-action-send')?.addEventListener('click', () => _sendToSocialManager(post));
    // Archive rendue dans le panneau GAUCHE (.gw-left > #gw-archive), pas ici —
    // la droite ne garde que le post courant. On la rafraîchit pour inclure le
    // post fraîchement composé (déjà ajouté à l'archive avant ce rendu).
    _renderComposeArchive(container.closest('.gw-modal')?.querySelector('#gw-archive'));
}

// Liste des posts composés (archive locale) : renvoyer vers Social Manager / supprimer.
function _renderComposeArchive(el) {
    if (!el) return;
    const arr = _loadComposeArchive();
    // Archive vide → masquer le conteneur : dans le panneau gauche, le
    // border-top/padding du .gw-archive laisserait sinon une ligne flottante
    // sous la méta avant tout compose. Réaffiché dès qu'il y a un post.
    if (!arr.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = `
        <div class="gw-archive-head">Posts composés <span class="gw-archive-count">${arr.length}</span></div>
        <div class="gw-archive-list">
            ${arr.map(item => `
                <div class="gw-archive-item" data-id="${item.id}">
                    ${item.network && networkLabel(item.network) ? `<span class="gw-archive-net">${_escapeHtml(networkLabel(item.network))}</span>` : ''}
                    <div class="gw-archive-text">${_escapeHtml(item.text.slice(0, 160))}${item.text.length > 160 ? '…' : ''}</div>
                    <div class="gw-archive-acts">
                        <button class="gw-archive-btn gw-arch-send" data-id="${item.id}">Renvoyer</button>
                        <button class="gw-archive-btn gw-arch-del" data-id="${item.id}">Supprimer</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    el.querySelectorAll('.gw-arch-send').forEach(b => b.addEventListener('click', () => {
        const item = _loadComposeArchive().find(x => x.id === b.dataset.id);
        if (item) _sendToSocialManager(item.text, item.network);
    }));
    el.querySelectorAll('.gw-arch-del').forEach(b => b.addEventListener('click', () => {
        _removeFromComposeArchive(b.dataset.id);
        _renderComposeArchive(el);
    }));
}

function _replaceSelection(newText, btn) {
    // Phase 3 — intégration native dans les pads.
    // Priorité 1 : preset.targetEl + replaceMode='full' (clic depuis le
    // bouton ✨ d'un champ pad) → remplace tout le contenu du champ.
    // Priorité 2 : _lastSelection.sourceEl (Cmd+Shift+G sur sélection)
    //              → remplace la sélection capturée, garde le reste.
    // Fallback   : clipboard si rien ne pointe vers une cible éditable.
    const presetTarget = _presetOpts?.targetEl;
    if (presetTarget && typeof presetTarget.value === 'string'
        && _presetOpts?.replaceMode === 'full') {
        presetTarget.value = newText;
        presetTarget.focus();
        presetTarget.selectionStart = presetTarget.selectionEnd = newText.length;
        presetTarget.dispatchEvent(new Event('input',  { bubbles: true }));
        presetTarget.dispatchEvent(new Event('change', { bubbles: true }));
        btn.textContent = '✓ Remplacé';
        setTimeout(_closeModal, 500);
        return;
    }

    // Pas de cible explicite → tente la sélection capturée (legacy)
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

    console.info('[Ghost Writer] Hook initialisé. Raccourci: Cmd/Ctrl+Shift+G. Backend: Mistral.');
}

/**
 * Ouvre le modal programmatiquement avec un texte préchargé et,
 * optionnellement, des opts pré-réglés depuis un pad.
 *
 * @param {string} initialText  Texte source à pré-remplir
 * @param {object} [presetOpts] Pré-réglages : {tone, intent, vouvoie,
 *                              mode, audience, action, lengthTarget,
 *                              context?}
 *                              `context` est purement visuel (chip dans
 *                              le modal), ne part pas dans le backend.
 *                              `tone` est pré-sélectionné dans le UI ;
 *                              l'utilisateur peut le changer.
 *
 * Respecte le flag (no-op si Ghost Writer désactivé).
 *
 * NB : pour usage Phase 3 (intégration native dans les pads), passer
 * les opts depuis le schéma JSON du champ : `f.ghostwriter`.
 */
export function openGhostwriter(initialText = '', presetOpts = null) {
    if (!isGhostwriterEnabled()) {
        console.warn('[Ghost Writer] Flag désactivé. Active : localStorage.setItem("ks_ghostwriter", "1")');
        return;
    }
    _openModal(initialText, presetOpts);
}

/**
 * Entrée « chaîne de contenu » — relais « Rédiger » du Brainstorming et retour
 * ← depuis Social Manager. Ouvre le modal SANS le garde-fou de flag (être DANS
 * la chaîne = entitled ; le quota serveur reste le vrai plafond) et SANS toucher
 * l'état porté (le réseau a déjà été posé par l'appelant). Sans ça, le relais
 * était silencieux quand `ks_ghostwriter` n'était pas activé dans la session.
 */
export function openGhostwriterChained(initialText = '') {
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
// Message d'épuisement adapté (crédits mensuels vs quota/jour). Cf studio.
export function getGhostwriterQuotaMessage() { return _quotaExhaustedMessage(); }

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
