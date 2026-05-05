/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Cloud Vault Sync v1.0  (Sprint 4)
   ─────────────────────────────────────────────────────────────
   Synchronise localStorage ↔ Worker D1 chiffré (AES-GCM) :
   - À la connexion (JWT obtenu) → loadFromCloud() puis hydrate localStorage
   - À chaque save Settings → debounce 1.5s → saveToCloud()
   - Cross-device : ouvre l'app sur iPhone après avoir saisi tes clés
     sur Mac, elles arrivent automatiquement.
   ═══════════════════════════════════════════════════════════════ */

const API_BASE = 'https://keystone-os-api.keystone-os.workers.dev';

const PROVIDERS  = ['anthropic','openai','gemini','xai','perplexity','mistral','meta'];
const PREFS_KEYS = [
    'ks_active_engine','ks_user_name','ks_user_photo',
    'ks_lock_style','ks_lock_enabled','ks_lock_delay',
    'ks_pad_order',
];

let _saveTimer = null;
let _lastHydrationTs = 0;

function _jwt() { return localStorage.getItem('ks_jwt') || ''; }

// ── Capture l'état localStorage en blob ───────────────────────
function _snapshot() {
    const api = {};
    PROVIDERS.forEach(id => {
        const v = localStorage.getItem('ks_api_' + id);
        if (v) api[id] = v;
    });
    const prefs = {};
    PREFS_KEYS.forEach(k => {
        const v = localStorage.getItem(k);
        if (v != null) prefs[k] = v;
    });
    // Pad customisations (ks_pad_hidden_*, ks_pad_label_*)
    // Notations utilisateur (ks_rating_*) — sync cross-device
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('ks_pad_hidden_') ||
            k.startsWith('ks_pad_label_')  ||
            k.startsWith('ks_rating_')) {
            prefs[k] = localStorage.getItem(k);
        }
    });
    return { api, prefs, v: 1 };
}

// ── Réinjecte un blob distant dans localStorage ───────────────
function _hydrate(vault) {
    if (!vault || typeof vault !== 'object') return;
    const api   = vault.api   || {};
    const prefs = vault.prefs || {};
    Object.entries(api).forEach(([id, val]) => {
        if (val) localStorage.setItem('ks_api_' + id, val);
    });
    Object.entries(prefs).forEach(([k, val]) => {
        if (val != null) localStorage.setItem(k, val);
    });
    _lastHydrationTs = Date.now();
    window.dispatchEvent(new CustomEvent('ks-vault-hydrated'));
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════
export async function loadFromCloud() {
    const jwt = _jwt();
    if (!jwt) return { hydrated: false, reason: 'no-jwt' };
    try {
        const res = await fetch(`${API_BASE}/api/vault/load`, {
            headers: { 'Authorization': `Bearer ${jwt}` },
        });
        if (!res.ok) return { hydrated: false, reason: `http-${res.status}` };
        const data = await res.json();
        if (!data.vault) return { hydrated: false, reason: 'empty' };
        _hydrate(data.vault);
        return { hydrated: true, updatedAt: data.updatedAt };
    } catch (e) {
        console.warn('[CloudVault] load failed:', e.message);
        return { hydrated: false, reason: 'network' };
    }
}

export async function saveToCloud() {
    const jwt = _jwt();
    if (!jwt) return false;
    const vault = _snapshot();
    try {
        const res = await fetch(`${API_BASE}/api/vault/save`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({ vault }),
        });
        if (!res.ok) {
            console.warn('[CloudVault] save HTTP', res.status);
            return false;
        }
        window.dispatchEvent(new CustomEvent('ks-cloud-vault-saved'));
        return true;
    } catch (e) {
        console.warn('[CloudVault] save failed:', e.message);
        return false;
    }
}

export function scheduleCloudSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { saveToCloud(); }, 1500);
}

export function isCloudReady() { return !!_jwt(); }
