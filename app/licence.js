/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Licence Engine v1.0
   Validation · Activation · Hot Reload Dashboard
   ─────────────────────────────────────────────────────────────
   Flux :
     1. validateLicence(key)  → appelle /api/validate-licence
     2. activateLicence(key)  → persiste + dispatch 'ks-licence-activated'
     3. main.js écoute l'event → appelle renderDashboard() (hot reload)
   ─────────────────────────────────────────────────────────────
   Mode dégradé (file:// ou localhost) :
     Simulation locale basée sur le format de la clé.
   ═══════════════════════════════════════════════════════════════ */

import { setOwnedIds, getOwnedIds } from './pads-loader.js';

const LS_KEY   = 'ks_licence_key';
const LS_PLAN  = 'ks_licence_plan';
const LS_OWNER = 'ks_licence_owner';

// ── Worker Cloudflare — endpoint de validation ─────────────────
const CF_WORKER = 'https://keystone-os-api.keystone-os.workers.dev';
const API_URL   = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? '/api/licence/validate'          // dev local (wrangler dev sur :8787 proxifié)
  : `${CF_WORKER}/api/licence/validate`; // production Vercel → Worker CF

// ═══════════════════════════════════════════════════════════════
// VALIDATE — appelle la Vercel Function ou simulation locale
// ═══════════════════════════════════════════════════════════════
/**
 * Valide une clé de licence contre le backend.
 * @param {string} key — clé brute saisie par l'utilisateur
 * @returns {Promise<{valid:boolean, plan?:string, owner?:string, ownedAssets?:string[]|null, error?:string}>}
 */
export async function validateLicence(key) {
    const trimmed = (key || '').trim();
    if (!trimmed) return { valid: false, error: 'Aucune clé saisie' };

    // Mode dégradé : file:// ou pas de réseau → simulation locale
    const isDegraded = location.protocol === 'file:' || !navigator.onLine;
    if (isDegraded) return _simulateLocal(trimmed);

    try {
        const res = await fetch(API_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ key: trimmed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        // Réseau inaccessible → fallback simulation
        console.warn('[Licence] API inaccessible, fallback local :', err.message);
        return _simulateLocal(trimmed);
    }
}

// ═══════════════════════════════════════════════════════════════
// ACTIVATE — persiste + hot reload
// ═══════════════════════════════════════════════════════════════
/**
 * Active une licence : valide, persiste localement, déclenche le hot reload.
 * @param {string} key
 * @returns {Promise<{valid:boolean, plan:string, ownedAssets:string[]|null}>}
 * @throws {Error} si la clé est invalide
 */
export async function activateLicence(key) {
    const data = await validateLicence(key);

    if (!data.valid) {
        throw Object.assign(new Error(data.error || 'Licence invalide'), { data });
    }

    // ── Persistance locale ─────────────────────────────────────
    localStorage.setItem(LS_KEY, key.trim());
    if (data.plan)  localStorage.setItem(LS_PLAN,  data.plan);
    if (data.owner) localStorage.setItem(LS_OWNER, data.owner);

    // ownedAssets : null = Enterprise (tout accessible), [] = rien, [...] = liste
    setOwnedIds(data.ownedAssets ?? null);

    // [Mode démo supprimé le 2026-07-25.] On purge inconditionnellement
    // les marqueurs : un utilisateur qui en avait encore verrait sinon
    // des reliquats sans plus aucun code pour les consommer.
    ['ks_is_demo', 'ks_demo_started_at', 'ks_demo_last_switch', 'ks_demo_nudge_shown_at']
      .forEach(k => localStorage.removeItem(k));

    // ── Hot Reload — signal vers main.js + ui-renderer ─────────
    window.dispatchEvent(new CustomEvent('ks-licence-activated', {
        bubbles: false,
        detail: {
            plan:        data.plan,
            owner:       data.owner,
            ownedAssets: data.ownedAssets,
        },
    }));

    return data;
}

// ═══════════════════════════════════════════════════════════════
// STATUS — lecture de la licence courante
// ═══════════════════════════════════════════════════════════════
export function getLicenceStatus() {
    const key   = localStorage.getItem(LS_KEY)   || '';
    const plan  = localStorage.getItem(LS_PLAN)  || '';
    const owner = localStorage.getItem(LS_OWNER) || '';
    let ownedAssets = null;
    try { ownedAssets = JSON.parse(localStorage.getItem('ks_owned_assets')); } catch (_) {}
    return {
        key,
        plan,
        owner,
        ownedAssets,
        expiresAt: getLicenceExpiry(),
        active:    !!key,
        demoMode:  ownedAssets === null,
        toolCount: Array.isArray(ownedAssets) ? ownedAssets.length : '∞',
    };
}

// ── Échéance de la licence (licence « à date » : essai de 7 jours posé
// depuis l'Admin, testeur à durée limitée) ────────────────────────────
// Simple CACHE de ce que le serveur a dit au dernier démarrage
// (`/api/licence/me` → licence.expires_at), hors PREFS_KEYS : ce n'est
// pas une préférence, le Cloud Vault n'a pas à la synchroniser ni à la
// restaurer. null = pas d'échéance = rien à décompter.
const LS_EXPIRES = 'ks_licence_expires';
export function getLicenceExpiry() {
    try { return localStorage.getItem(LS_EXPIRES) || null; } catch (_) { return null; }
}
function _setLicenceExpiry(value) {
    try {
        if (value) localStorage.setItem(LS_EXPIRES, String(value));
        else       localStorage.removeItem(LS_EXPIRES);
    } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
// REVOKE — déconnexion / réinitialisation
// ═══════════════════════════════════════════════════════════════
export function revokeLicence() {
    [
        LS_KEY, LS_PLAN, LS_OWNER, 'ks_owned_assets', LS_EXPIRES,
        // Marqueurs de l'ancien mode démo — purgés tant qu'il peut en
        // rester chez des utilisateurs déjà installés.
        'ks_is_demo', 'ks_demo_started_at',
        'ks_demo_last_switch', 'ks_demo_nudge_shown_at',
    ].forEach(k => localStorage.removeItem(k));
    window.dispatchEvent(new CustomEvent('ks-licence-revoked'));
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION LOCALE (file:// / offline)
// ═══════════════════════════════════════════════════════════════
function _simulateLocal(key) {
    const upper = key.toUpperCase();

    // [Raccourci « DEMO-KEYS-TONE-2026 → tout débloqué » supprimé avec le
    //  mode démo le 2026-07-25. Il rendait `ownedAssets: null`, la
    //  sentinelle « accès TOTAL » — exactement le piège que la refonte
    //  pricing a passé sa journée à refermer.]

    // Format valide → plan Pro simulé
    // Sprint cleanup-1 (2026-05-22) : retiré les 6 IDs des outils abandonnés
    // (O-IMM-003, O-MKT-001/002, O-ANL-001, O-ADM-001) — ne reste que ce qui
    // est réellement livré (Annonces, VEFA Studio, artefacts COM).
    if (/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(upper)) {
        return {
            valid: true, plan: 'Pro (simulé)', owner: 'Développement local',
            ownedAssets: [
                'A-COM-001', 'A-COM-002', 'A-COM-003', 'A-COM-004',
            ],
        };
    }

    return { valid: false, error: 'Format invalide — attendu : XXXX-XXXX-XXXX-XXXX' };
}

// ═══════════════════════════════════════════════════════════════
// RESYNC — le serveur fait foi sur ce que la licence ouvre
// ─────────────────────────────────────────────────────────────
// La liste locale (`ks_owned_assets`) ne faisait que GROSSIR : chaque
// « Obtenir » y ajoutait une application, et rien ne la confrontait
// jamais au serveur. Conséquence observée en test réel : des outils
// obtenus avant un correctif restaient acquis pour toujours, et
// pouvaient même être réinstallés après suppression.
//
// On réaligne donc au démarrage sur le sac de la licence :
//   tableau → on écrit exactement ce tableau (ni plus, ni moins) ;
//   null    → accès total (legacy) : on retire la clé locale ;
//   échec   → on ne touche à RIEN (hors ligne ≠ perte de droits).
//
// ⚠️ Cela reste une barrière de CONFORT, pas une sécurité : la
// vérification vit dans le navigateur. Seul un contrôle côté serveur,
// route par route, empêchera vraiment d'ouvrir une app non acquise.
export async function syncOwnedAssetsFromServer() {
    let jwt = '';
    try { jwt = localStorage.getItem('ks_jwt') || ''; } catch (_) { return null; }
    if (!jwt) return null;

    const url = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? '/api/licence/me'
        : `${CF_WORKER}/api/licence/me`;

    let data;
    try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
        if (!res.ok) return null;                 // 401/500 → on ne dégrade rien
        data = await res.json();
    } catch (_) { return null; }                  // hors ligne → on garde l'existant

    // Échéance (licence à date) : on la mémorise telle que le serveur la
    // donne ; `null` explicite = plus d'échéance (un essai qui a payé, le
    // webhook a effacé la date) → on l'oublie. Champ ABSENT (worker
    // ancien) → on ne touche à rien.
    if (data?.licence && 'expires_at' in data.licence) {
        _setLicenceExpiry(data.licence.expires_at || null);
    }

    const bag = data?.licence?.owned_assets;
    if (Array.isArray(bag)) {
        setOwnedIds(bag);
        _reconcilierSelection();
        return bag;
    }
    if (bag === null) {
        setOwnedIds(null);                        // retire la clé = accès total
        _reconcilierSelection();
        return null;
    }
    return null;                                  // champ absent (worker ancien)
}

// ── La sélection d'onboarding doit suivre le sac ─────────────────
// `ks_user_selection` est le sous-ensemble d'outils choisi à l'accueil ;
// il FILTRE le tableau de bord, et le Cloud Vault le synchronise d'un
// appareil à l'autre. D'où ce piège : en activant une nouvelle licence,
// on hérite d'une sélection qui liste des applications qu'elle n'ouvre
// pas — l'intersection est vide, et le tableau de bord s'affiche VIDE
// alors que la licence fonctionne (il faut aller rechercher ses outils
// dans le Key-Store, ce qui n'a aucun sens).
//
// On élague donc la sélection sur ce qui est réellement possédé. Si
// plus rien ne subsiste, on la SUPPRIME : absente, elle veut dire
// « tout montrer », ce qui est le bon repli — mieux vaut un tableau de
// bord complet qu'un tableau de bord vide.
function _reconcilierSelection() {
    try {
        const raw = localStorage.getItem('ks_user_selection');
        if (!raw) return;
        const sel = JSON.parse(raw);
        if (!Array.isArray(sel) || !sel.length) return;

        const owned = getOwnedIds();
        if (owned === null) return;               // accès total : rien à élaguer

        const garde = sel.filter(id => owned.includes(id));
        if (garde.length === sel.length) return;  // déjà cohérent

        if (garde.length) localStorage.setItem('ks_user_selection', JSON.stringify(garde));
        else              localStorage.removeItem('ks_user_selection');
    } catch (_) { /* jamais bloquer le boot pour un filtre d'affichage */ }
}
