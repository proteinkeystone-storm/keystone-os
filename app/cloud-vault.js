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
    // Sprint Kodex-3.3 : brouillons d'artefacts à workspace fullscreen
    'ks_kodex_draft',
    // Sync cross-device des brouillons Pulsa (mai 2026, demande user
    // Mac↔iPad). Le form publié reste indépendant côté Worker D1 — ces
    // 2 clés ne servent qu'à retrouver les brouillons en cours d'édition
    // sur tous les appareils du même JWT.
    'ks_pulsa_library',
    'ks_pulsa_current_form',
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

// ═══════════════════════════════════════════════════════════════
// Auto-sync — surveille toutes les écritures localStorage
// ═══════════════════════════════════════════════════════════════
// Bug pré-existant (corrigé mai 2026) : `scheduleCloudSave` n'était
// déclenchée QUE depuis vault.js (ajout/suppression de clé API). Toutes
// les autres clés du PREFS_KEYS (ks_kodex_draft, ks_pulsa_library,
// ks_active_engine, etc.) n'uploadaient JAMAIS — donc cross-device cassé
// pour 90% de la conf.
//
// Fix : on override Storage.prototype.setItem / removeItem au boot
// (via `installAutoSync()` appelée depuis main.js). Après chaque
// modification d'une clé surveillée, on déclenche scheduleCloudSave
// (debounce 1,5 s → un seul upload même pour 50 setItem en rafale).
//
// Le wrapper est idempotent (re-call ne ré-installe pas) et préserve
// la signature/behaviour native — tout code existant continue de
// fonctionner sans modification.

function _shouldSync(key) {
    if (!key || typeof key !== 'string') return false;
    if (PREFS_KEYS.includes(key)) return true;
    if (key.startsWith('ks_api_'))        return true;
    if (key.startsWith('ks_pad_hidden_')) return true;
    if (key.startsWith('ks_pad_label_'))  return true;
    if (key.startsWith('ks_rating_'))     return true;
    return false;
}

let _autoSyncInstalled = false;

export function installAutoSync() {
    if (_autoSyncInstalled) return;
    _autoSyncInstalled = true;

    const origSet = Storage.prototype.setItem;
    const origDel = Storage.prototype.removeItem;

    Storage.prototype.setItem = function(key, value) {
        origSet.call(this, key, value);
        // Ne surveille QUE localStorage (pas sessionStorage), et seulement
        // si l'utilisateur a un JWT (sinon pas de cloud accessible).
        if (this === localStorage && _shouldSync(key) && isCloudReady()) {
            scheduleCloudSave();
        }
    };

    Storage.prototype.removeItem = function(key) {
        origDel.call(this, key);
        if (this === localStorage && _shouldSync(key) && isCloudReady()) {
            scheduleCloudSave();
        }
    };
}

/**
 * Force un upload immédiat (sans debounce). À utiliser depuis la console
 * ou par un bouton « Synchroniser maintenant » du panneau Paramètres.
 */
export async function forceCloudSyncNow() {
    clearTimeout(_saveTimer);
    return saveToCloud();
}
