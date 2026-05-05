/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vault v2.0 · Cloud-only (Sprint 5+)
   ─────────────────────────────────────────────────────────────
   Anciennement : sauvegarde sur clé USB via File System Access API.
   Désormais    : sauvegarde uniquement via Cloud Vault chiffré (D1
                  AES-256-GCM, sync cross-device — voir cloud-vault.js).

   - loadVault()         : compat ascendante (VAULT historiques)
   - scheduleAutoSave()  : déclencheur debounce de la sync cloud
   ═══════════════════════════════════════════════════════════════ */

// ─── VAULT historique (vide par défaut) ────────────────────────
// Conservé pour compatibilité avec les anciens fichiers vault.js
// déposés manuellement dans le dossier /app/. Ne pas peupler à la
// main : utiliser le panneau Settings + Cloud Vault (cross-device).
const VAULT = {
    api:     { anthropic:'', openai:'', gemini:'', xai:'', perplexity:'', mistral:'', meta:'' },
    prefs:   { engine:'', name:'', photo:'', onboarded:'', lockStyle:'',
               lockEnabled:'', lockDelay:'', ownedAssets:'', licenceKey:'' },
    licence: { key:'', plan:'', owner:'' },
};

const PREFS_MAP = {
    engine:      'ks_active_engine',
    name:        'ks_user_name',
    photo:       'ks_user_photo',
    onboarded:   'ks_onboarded',
    lockStyle:   'ks_lock_style',
    lockEnabled: 'ks_lock_enabled',
    lockDelay:   'ks_lock_delay',
    ownedAssets: 'ks_owned_assets',
    licenceKey:  'ks_licence_key',
};

const LS_PREFIX = 'ks_api_';

let _autoTimer = null;

// ═══════════════════════════════════════════════════════════════
// CHARGEMENT — appelé en premier dans main.js
// Hydrate localStorage depuis l'objet VAULT historique (compat).
// Si VAULT est vide (cas standard cloud-only), c'est un no-op.
// ═══════════════════════════════════════════════════════════════
export function loadVault() {
    Object.entries(VAULT.api).forEach(([id, encoded]) => {
        if (!encoded) return;
        try { localStorage.setItem(LS_PREFIX + id, atob(encoded)); } catch (_) {}
    });

    Object.entries(VAULT.prefs).forEach(([key, value]) => {
        if (!value) return;
        const lsKey = PREFS_MAP[key];
        if (!lsKey) return;
        const _rawKey = (key === 'photo' || key === 'ownedAssets');
        try { localStorage.setItem(lsKey, _rawKey ? value : atob(value)); } catch (_) {}
    });
}

// ═══════════════════════════════════════════════════════════════
// AUTO-SAVE — déclenché à chaque modification (Settings, ratings, etc.)
// Debounce 1.5s, push vers Cloud Vault chiffré (D1 cross-device).
// ═══════════════════════════════════════════════════════════════
export function scheduleAutoSave() {
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(async () => {
        try {
            const { saveToCloud, isCloudReady } = await import('./cloud-vault.js');
            if (isCloudReady()) saveToCloud();
        } catch (_) { /* offline ou cloud-vault.js absent → silencieux */ }
    }, 1500);
}
