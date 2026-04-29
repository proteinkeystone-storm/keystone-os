/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Inbox v1.0
   Messages Admin → Client (fetch + display + CTA + dismiss)
   ─────────────────────────────────────────────────────────────
   · Polling toutes les 5 min depuis le Worker CF
   · Cache local (ks_inbox_cache) pour mode offline
   · Dismiss persistant (ks_msg_dismissed_<id>)
   · Rotation automatique si plusieurs messages actifs (8s/msg)
   · Priorité P1 dans le DST (au-dessus du Coach P2)
   · CTA optionnel (label + URL) → bouton cliquable
   ═══════════════════════════════════════════════════════════════ */

import { setKeystoneStatus, dismissDSTMessage } from './dst.js';

// ── Config ────────────────────────────────────────────────────
const CF_WORKER     = 'https://keystone-os-api.keystone-os.workers.dev';
const IS_LOCAL      = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API_BASE      = IS_LOCAL ? '' : CF_WORKER;
const POLL_MS       = 5 * 60 * 1000;     // 5 min
const ROTATE_MS     = 8 * 1000;          // 8s par message si plusieurs
const ADMIN_PRIORITY = 1;                // P1 dans le DST

// ── État ──────────────────────────────────────────────────────
let _messages    = [];       // messages actifs non dismiss
let _rotateTimer = null;
let _pollTimer   = null;
let _idx         = 0;
let _ctaEl       = null;     // bouton CTA injecté à côté du DST

// ── Helpers ──────────────────────────────────────────────────
const _tenantId = () => localStorage.getItem('ks_tenant_id') || 'default';
const _licence  = () => localStorage.getItem('ks_licence')   || '';
const _isDismissed = id => localStorage.getItem('ks_msg_dismissed_' + id) === '1';
const _markDismissed = id => localStorage.setItem('ks_msg_dismissed_' + id, '1');

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════

export function initInbox() {
    _ensureCTAButton();
    _loadFromCache();
    _refresh();
    clearInterval(_pollTimer);
    _pollTimer = setInterval(_refresh, POLL_MS);
}

/**
 * Force un refresh manuel (utile après une action admin
 * ou quand on revient d'un autre onglet).
 */
export async function refreshInbox() { return _refresh(); }

// ═══════════════════════════════════════════════════════════════
// Fetch + cache
// ═══════════════════════════════════════════════════════════════
async function _refresh() {
    const url = `${API_BASE}/api/messages?tenantId=${encodeURIComponent(_tenantId())}` +
                (_licence() ? `&licence=${encodeURIComponent(_licence())}` : '');

    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const { messages = [] } = await res.json();
        _messages = messages.filter(m => !_isDismissed(m.id));
        _saveToCache(_messages);
        _renderActive();
    } catch (_) {
        // Silencieux : on garde le cache pour offline
    }
}

function _loadFromCache() {
    try {
        const raw = localStorage.getItem('ks_inbox_cache');
        if (!raw) return;
        const cached = JSON.parse(raw);
        _messages = (cached || []).filter(m => !_isDismissed(m.id));
        _renderActive();
    } catch (_) { /* cache corrompu, ignore */ }
}

function _saveToCache(msgs) {
    try {
        localStorage.setItem('ks_inbox_cache', JSON.stringify(msgs.slice(0, 20)));
    } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
// Rendu DST
// ═══════════════════════════════════════════════════════════════
function _renderActive() {
    clearInterval(_rotateTimer);
    _rotateTimer = null;

    if (_messages.length === 0) {
        // Plus aucun message actif → laisse le DST retourner aux priorités inférieures
        dismissDSTMessage(ADMIN_PRIORITY);
        _setCTA(null);
        return;
    }

    _idx = 0;
    _showCurrent();

    // Rotation si plusieurs messages
    if (_messages.length > 1) {
        _rotateTimer = setInterval(() => {
            _idx = (_idx + 1) % _messages.length;
            _showCurrent();
        }, ROTATE_MS);
    }
}

function _showCurrent() {
    const m = _messages[_idx];
    if (!m) return;
    const text = m.title ? `${m.title} — ${m.body}` : m.body;
    setKeystoneStatus(text, m.level || 'info', 0, ADMIN_PRIORITY);
    _setCTA(m);
}

// ═══════════════════════════════════════════════════════════════
// Bouton CTA + Dismiss
// ═══════════════════════════════════════════════════════════════
function _ensureCTAButton() {
    if (document.getElementById('ks-inbox-cta')) {
        _ctaEl = document.getElementById('ks-inbox-cta');
        return;
    }
    const dst = document.getElementById('hero-dst');
    if (!dst) return;

    _ctaEl = document.createElement('span');
    _ctaEl.id = 'ks-inbox-cta';
    _ctaEl.className = 'ks-inbox-cta';
    _ctaEl.style.display = 'none';
    _ctaEl.innerHTML = `
        <button class="ks-inbox-cta-btn"   type="button" data-action="cta"></button>
        <button class="ks-inbox-cta-close" type="button" data-action="dismiss" title="Marquer comme lu" aria-label="Marquer comme lu">×</button>
    `;
    dst.appendChild(_ctaEl);

    _ctaEl.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const m = _messages[_idx];
        if (!m) return;

        if (btn.dataset.action === 'cta' && m.cta_url) {
            // Lien externe → nouvel onglet ; ancre/route interne → même onglet
            if (/^https?:\/\//i.test(m.cta_url)) {
                window.open(m.cta_url, '_blank', 'noopener');
            } else {
                window.location.href = m.cta_url;
            }
        } else if (btn.dataset.action === 'dismiss') {
            _markDismissed(m.id);
            _messages = _messages.filter(x => x.id !== m.id);
            _saveToCache(_messages);
            _renderActive();
        }
    });
}

function _setCTA(m) {
    if (!_ctaEl) return;
    if (!m) { _ctaEl.style.display = 'none'; return; }

    const ctaBtn   = _ctaEl.querySelector('[data-action="cta"]');
    const closeBtn = _ctaEl.querySelector('[data-action="dismiss"]');

    if (m.cta_label && m.cta_url) {
        ctaBtn.textContent = m.cta_label;
        ctaBtn.style.display = 'inline-flex';
    } else {
        ctaBtn.style.display = 'none';
    }
    closeBtn.style.display = 'inline-flex';
    _ctaEl.style.display = 'inline-flex';
    _ctaEl.dataset.level = m.level || 'info';
}
