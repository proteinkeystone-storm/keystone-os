/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vault v1.1
   Coffre-fort des préférences · Encodage Base64 · USB-Ready
   ─────────────────────────────────────────────────────────────
   Sauvegarde automatique via File System Access API.
   Fallback : téléchargement classique si API non supportée.
   ═══════════════════════════════════════════════════════════════ */

const VAULT = {
    api: {
        anthropic:  '',
        openai:     '',
        gemini:     '',
        xai:        '',
        perplexity: '',
        mistral:    '',
        meta:       '',
    },
    prefs: {
        engine:      '',
        name:        '',
        photo:       '',
        onboarded:   '',
        lockStyle:   '',
        lockEnabled: '',
        lockDelay:   '',
        ownedAssets: '', // JSON array base64 — IDs des artefacts achetés
        licenceKey:  '', // Clé d'activation client base64
    },
    licence: { key: '', plan: '', owner: '' },
};

const PREFS_MAP = {
    engine:      'ks_active_engine',
    name:        'ks_user_name',
    photo:       'ks_user_photo',
    onboarded:   'ks_onboarded',
    lockStyle:   'ks_lock_style',
    lockEnabled: 'ks_lock_enabled',
    lockDelay:   'ks_lock_delay',
    ownedAssets: 'ks_owned_assets', // ['art-01', 'O-IMM-001', ...]
    licenceKey:  'ks_licence_key',  // clé d'activation
};

const LS_PREFIX      = 'ks_api_';
const LS_FILE_LINKED = 'ks_vault_linked'; // 'true' si un handle a été accordé cette session

// Handle File System Access (non persistable entre sessions — reset à chaque reload)
let _fileHandle = null;
let _autoTimer  = null;

// ═══════════════════════════════════════════════════════════════
// CHARGEMENT — appelé en premier dans main.js
// ═══════════════════════════════════════════════════════════════
export function loadVault() {
    // La clé USB est la SEULE source de vérité.
    // Toute valeur non-vide dans vault.js écrase SYSTÉMATIQUEMENT le localStorage.
    Object.entries(VAULT.api).forEach(([id, encoded]) => {
        if (!encoded) return;
        try { localStorage.setItem(LS_PREFIX + id, atob(encoded)); } catch (e) {}
    });

    Object.entries(VAULT.prefs).forEach(([key, value]) => {
        if (!value) return;
        const lsKey = PREFS_MAP[key];
        if (!lsKey) return;
        const _rawKey = (key === 'photo' || key === 'ownedAssets');
        try { localStorage.setItem(lsKey, _rawKey ? value : atob(value)); } catch (e) {}
    });
}

// ── Détection vault vide → redirection Onboarding (Sprint 5.2) ──
export function isVaultEmpty() {
    const hasAnyApi = Object.values(VAULT.api).some(v => v !== '');
    const hasName   = VAULT.prefs.name !== '';
    return !hasAnyApi && !hasName;
}

// ═══════════════════════════════════════════════════════════════
// GÉNÉRATION DU CONTENU vault.js
// ═══════════════════════════════════════════════════════════════
function _buildVaultSource() {
    const _b64 = (v) => { try { return v ? btoa(v) : ''; } catch (e) { return ''; } };

    const api = {};
    ['anthropic','openai','gemini','xai','perplexity','mistral','meta'].forEach(id => {
        api[id] = _b64(localStorage.getItem(LS_PREFIX + id) || '');
    });

    const prefs = {};
    Object.entries(PREFS_MAP).forEach(([key, lsKey]) => {
        const raw = localStorage.getItem(lsKey) || '';
        prefs[key] = key === 'photo' ? raw : _b64(raw);
    });

    const savedOrder    = localStorage.getItem('ks_pad_order') || '';
    const ownedAssets   = localStorage.getItem('ks_owned_assets') || '';
    const lifetimePurch = localStorage.getItem('ks_lifetime_purchases') || '';
    const hiddenPads = {};
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('ks_pad_hidden_') || k.startsWith('ks_pad_label_'))
            hiddenPads[k] = _b64(localStorage.getItem(k));
    });

    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');

    return `/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vault v1.1  ·  Généré le : ${ts}
   Fichier auto-généré — ne pas modifier manuellement.
   ═══════════════════════════════════════════════════════════════ */

const VAULT = {
    api: ${JSON.stringify(api, null, 8)},
    prefs: ${JSON.stringify(prefs, null, 8)},
    licence: { key:'', plan:'', owner:'' },
    ownership: {
        owned:    ${JSON.stringify(ownedAssets)},
        lifetime: ${JSON.stringify(lifetimePurch)},
    },
};

const PREFS_MAP = {
    engine:'ks_active_engine', name:'ks_user_name', photo:'ks_user_photo',
    onboarded:'ks_onboarded', lockStyle:'ks_lock_style',
    lockEnabled:'ks_lock_enabled', lockDelay:'ks_lock_delay',
};

const LS_PREFIX = 'ks_api_';
let _fileHandle = null;
let _autoTimer  = null;

export function loadVault() {
    Object.entries(VAULT.api).forEach(([id, encoded]) => {
        if (!encoded) return;
        try { if (!localStorage.getItem(LS_PREFIX + id)) localStorage.setItem(LS_PREFIX + id, atob(encoded)); } catch(e) {}
    });
    Object.entries(VAULT.prefs).forEach(([key, value]) => {
        if (!value) return;
        const lsKey = PREFS_MAP[key];
        if (!lsKey || localStorage.getItem(lsKey)) return;
        try { localStorage.setItem(lsKey, key === 'photo' ? value : atob(value)); } catch(e) {}
    });
    ${savedOrder ? `try { if (!localStorage.getItem('ks_pad_order')) localStorage.setItem('ks_pad_order', ${JSON.stringify(savedOrder)}); } catch(e) {}` : ''}
    if (VAULT.ownership?.owned    && !localStorage.getItem('ks_owned_assets'))    { try { localStorage.setItem('ks_owned_assets', VAULT.ownership.owned); } catch(e) {} }
    if (VAULT.ownership?.lifetime && !localStorage.getItem('ks_lifetime_purchases')) { try { localStorage.setItem('ks_lifetime_purchases', VAULT.ownership.lifetime); } catch(e) {} }
    ${Object.entries(hiddenPads).map(([k, v]) =>
        `try { if (!localStorage.getItem(${JSON.stringify(k)})) localStorage.setItem(${JSON.stringify(k)}, atob(${JSON.stringify(v)})); } catch(e) {}`
    ).join('\n    ')}
}

export async function linkVaultFile() { return false; }
export function scheduleAutoSave() {}
export function exportVault() {}
`;
}

// ═══════════════════════════════════════════════════════════════
// LIER LA CLÉ USB — File System Access API
// L'utilisateur choisit vault.js une seule fois par session.
// Toutes les sauvegardes suivantes sont silencieuses.
// ═══════════════════════════════════════════════════════════════
export async function linkVaultFile() {
    if (!('showSaveFilePicker' in window)) return false; // API non supportée

    try {
        _fileHandle = await window.showSaveFilePicker({
            suggestedName: 'vault.js',
            types: [{ description: 'Vault Keystone', accept: { 'text/javascript': ['.js'] } }],
        });
        localStorage.setItem(LS_FILE_LINKED, 'true');
        _notifyStatus('linked');
        await _writeToHandle();
        return true;
    } catch (e) {
        // Annulé par l'utilisateur
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// ÉCRITURE SILENCIEUSE via le handle déjà accordé
// ═══════════════════════════════════════════════════════════════
async function _writeToHandle() {
    if (!_fileHandle) return false;
    try {
        const writable = await _fileHandle.createWritable();
        await writable.write(_buildVaultSource());
        await writable.close();
        _notifyStatus('saved');
        return true;
    } catch (e) {
        _fileHandle = null; // handle révoqué — retour au fallback
        localStorage.removeItem(LS_FILE_LINKED);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-SAVE — appelé après chaque modification de Settings
// Debounce 1.5s pour regrouper les changements rapides.
// ─────────────────────────────────────────────────────────────
// Sprint 4 — Persistance prioritaire = Cloud Vault chiffré (D1).
// Si le user a un JWT actif, on sync serveur (cross-device).
// Le fallback "download de vault.js" est désactivé : il polluait
// les Téléchargements à chaque keystroke et n'avait d'effet que si
// l'utilisateur replaçait manuellement le fichier dans /app/.
// La clé USB reste possible via File System Access API (linkVaultFile).
// ═══════════════════════════════════════════════════════════════
export function scheduleAutoSave() {
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(async () => {
        // 1) USB lié : on écrit le fichier vault.js (legacy power-user)
        if (_fileHandle) {
            await _writeToHandle();
        }
        // 2) Sync serveur (Cloud Vault) — silencieux, transparent.
        try {
            const { saveToCloud, isCloudReady } = await import('./cloud-vault.js');
            if (isCloudReady()) saveToCloud();
        } catch (_) {}
    }, 1500);
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK — téléchargement classique (si File System API absent)
// ═══════════════════════════════════════════════════════════════
function _downloadFallback() {
    const blob = new Blob([_buildVaultSource()], { type: 'text/javascript' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'vault.js' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// Export manuel explicite (bouton "Forcer la sauvegarde")
export function exportVault() {
    if (_fileHandle) {
        _writeToHandle();
    } else {
        _downloadFallback();
    }
}

// ═══════════════════════════════════════════════════════════════
// INDICATEUR — notifie l'UI de l'état de sauvegarde
// ═══════════════════════════════════════════════════════════════
function _notifyStatus(state) {
    window.dispatchEvent(new CustomEvent('ks-vault-status', { detail: { state } }));
}

export function isVaultLinked() {
    return !!_fileHandle;
}
