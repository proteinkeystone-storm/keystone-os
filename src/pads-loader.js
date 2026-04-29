/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pads Loader v1.0
   Master Renderer : charge les JSON de K_STORE_ASSETS/PADS/
   Fallback automatique vers pads-data.js si fetch indisponible
   ═══════════════════════════════════════════════════════════════ */

import { PADS_DATA } from './pads-data.js';

const PADS_BASE    = './K_STORE_ASSETS/PADS';
const CATALOG_TTL  = 5 * 60 * 1000; // 5 minutes

// ── Cloudflare Worker — source canonique en production ─────────
const CF_WORKER    = 'https://keystone-os-api.keystone-os.workers.dev';
const IS_LOCAL     = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const CF_API       = IS_LOCAL ? '' : CF_WORKER;

// Cache PADs (session)
let _padsCache = null;

// Cache Catalogue distant
let _catalogCache     = null;
let _catalogFetchedAt = 0;
let _remoteUrl        = null; // lu depuis manifest.json au premier loadPads()

// ── Chargement principal ────────────────────────────────────────
export async function loadPads() {
    if (_padsCache) return _padsCache;

    // 1. Worker CF (D1) — source prioritaire en production
    if (CF_API) {
        try {
            const res  = await fetch(`${CF_API}/api/pads?tenantId=default`, { cache: 'no-store' });
            if (res.ok) {
                const { pads = [] } = await res.json();
                if (pads.length > 0) {
                    _padsCache = _indexByPadKey(pads);
                    return _padsCache;
                }
            }
        } catch (_) { /* fallback → fichiers statiques */ }
    }

    // 2. Fichiers JSON statiques (source locale / USB / fallback)
    try {
        const manifest = await _fetchJSON(`${PADS_BASE}/manifest.json`);
        if (!manifest?.pads?.length) throw new Error('manifest vide');

        if (manifest.remoteUrl) _remoteUrl = manifest.remoteUrl;

        const results = await Promise.allSettled(
            manifest.pads.map(id => _fetchJSON(`${PADS_BASE}/${id}.json`))
        );

        const loaded = results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);

        if (loaded.length === 0) throw new Error('aucun pad chargé');

        _padsCache = _indexByPadKey(loaded);
        return _padsCache;

    } catch (_) {
        // 3. Fallback ultime — données embarquées dans pads-data.js
        _padsCache = PADS_DATA;
        return _padsCache;
    }
}

// ── Liste dynamique des outils (compatible format TOOLS) ────────
/**
 * Dérive le tableau TOOLS depuis le cache PAD.
 * Chaque PAD JSON devient une entrée { id, padKey, name, desc, icon, engine }.
 */
export function getToolList() {
    const cache = _padsCache || PADS_DATA;
    return Object.values(cache).map(pad => ({
        id:     pad.id,
        padKey: pad.padKey || pad.id,
        name:   pad.title    || pad.id,
        desc:   pad.subtitle || '',
        icon:   pad.icon     || 'zap',
        engine: pad.ai_optimized || 'Claude',
    }));
}

// ── Liste dynamique des artefacts (depuis catalog.json) ─────────
/**
 * Dérive le tableau ARTEFACTS depuis le catalogue chargé.
 * Filtre les entrées dont l'ID commence par 'A-'.
 */
export function getArtefactList() {
    if (!_catalogCache?.tools) return [];
    return _catalogCache.tools
        .filter(t => t.id.startsWith('A-'))
        .map(t => ({
            id:     t.id,
            name:   t.title    || t.id,
            desc:   t.subtitle || '',
            icon:   t.icon     || 'zap',
            engine: t.ai_optimized || 'Claude',
        }));
}

// ── Accès direct à un pad par padKey ou NOMEN-K id ─────────────
export function getPad(keyOrId) {
    const cache = _padsCache || PADS_DATA;
    // Cherche par padKey (ex: 'A1') en priorité
    if (cache[keyOrId]) return cache[keyOrId];
    // Sinon cherche par NOMEN-K id (ex: 'O-IMM-001')
    return Object.values(cache).find(p => p.id === keyOrId) || null;
}

// ═══════════════════════════════════════════════════════════════
// OWNERSHIP — Classification owned / suggested / frigo
// ═══════════════════════════════════════════════════════════════
const LS_OWNED    = 'ks_owned_assets';
const LS_LIFETIME = 'ks_lifetime_purchases';

/**
 * Retourne le tableau des IDs possédés via abonnement, ou null (= mode démo).
 * null   → vault vide / fresh install → mode démo, tous les pads sont actifs
 * []     → abonnement expiré / révoqué
 * [...]  → liste des IDs sous abonnement actif
 */
export function getOwnedIds() {
    const raw = localStorage.getItem(LS_OWNED);
    if (raw === null) return null; // mode démo
    try { return JSON.parse(raw); } catch { return null; }
}

/** Persiste la liste des IDs d'abonnement (appelé après activation licence). */
export function setOwnedIds(ids) {
    localStorage.setItem(LS_OWNED, JSON.stringify(Array.isArray(ids) ? ids : []));
}

/**
 * Retourne le tableau des IDs achetés à vie (jamais null — [] par défaut).
 * Ces IDs restent accessibles même si l'abonnement expire (Mode Frigo).
 */
export function getLifetimeIds() {
    const raw = localStorage.getItem(LS_LIFETIME);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

/** Persiste la liste des achats à vie. */
export function setLifetimeIds(ids) {
    localStorage.setItem(LS_LIFETIME, JSON.stringify(Array.isArray(ids) ? ids : []));
}

/**
 * Ajoute un ID à la liste permanente et déclenche un hot reload.
 * Idempotent : sans effet si l'ID est déjà dans la liste.
 */
export function addLifetimePurchase(id) {
    const current = getLifetimeIds();
    if (current.includes(id)) return;
    setLifetimeIds([...current, id]);
    window.dispatchEvent(new CustomEvent('ks-lifetime-activated', { detail: { id } }));
}

/**
 * Mode Frigo : abonnement expiré ou vide, mais des achats à vie existent.
 * L'utilisateur garde l'accès à ses outils permanents.
 */
export function isFrigoMode() {
    const ownedIds    = getOwnedIds();
    const lifetimeIds = getLifetimeIds();
    return ownedIds !== null && ownedIds.length === 0 && lifetimeIds.length > 0;
}

/**
 * Sépare les pads chargés en deux groupes :
 *   owned     → abonnement actif OU achat à vie (lifetime: true si définitif)
 *   suggested → dans le catalogue mais non possédés (locked)
 * + flag frigo pour l'UI
 * @returns {{ owned: Object, suggested: Object, frigo: boolean }}
 */
export function classifyPads() {
    const all         = _padsCache || PADS_DATA;
    const ownedIds    = getOwnedIds();
    const lifetimeIds = getLifetimeIds();

    // Mode démo : tout est dans owned
    if (ownedIds === null) return { owned: all, suggested: {}, frigo: false };

    const owned     = {};
    const suggested = {};

    Object.entries(all).forEach(([key, pad]) => {
        const inSubscription = ownedIds.includes(pad.id);
        const inLifetime     = lifetimeIds.includes(pad.id);

        if (inSubscription || inLifetime) {
            owned[key] = inLifetime ? { ...pad, lifetime: true } : pad;
        } else {
            suggested[key] = { ...pad, locked: true };
        }
    });

    const frigo = ownedIds.length === 0 && lifetimeIds.length > 0;
    return { owned, suggested, frigo };
}

// ═══════════════════════════════════════════════════════════════
// CATALOGUE DISTANT — SWR (Stale-While-Revalidate)
// ═══════════════════════════════════════════════════════════════

/**
 * Charge le catalogue distant avec stratégie SWR :
 * - Cache chaud (< 5 min) → retourne immédiatement
 * - Cache périmé → retourne le cache ET revalide en background
 * - Pas de cache → fetch bloquant
 * Fallback automatique vers /K_STORE_ASSETS/catalog.json (local Vercel)
 */
export async function fetchRemoteCatalog(url) {
    const targetUrl = url || _remoteUrl;
    const now       = Date.now();

    if (_catalogCache) {
        if (now - _catalogFetchedAt > CATALOG_TTL) {
            // Stale : on sert le cache et on revalide silencieusement
            _doFetchCatalog(targetUrl).catch(() => {});
        }
        return _catalogCache;
    }

    return _doFetchCatalog(targetUrl);
}

/** Retourne le catalogue complet (synchrone, null si pas encore chargé). */
export function getCatalog() { return _catalogCache; }

/** Retourne l'entrée catalogue d'un outil/artefact par NOMEN-K ID (synchrone). */
export function getCatalogEntry(id) {
    if (!_catalogCache?.tools) return null;
    return _catalogCache.tools.find(t => t.id === id) || null;
}

async function _doFetchCatalog(primaryUrl) {
    // Tente l'URL distante en premier, puis le catalogue local Vercel en fallback
    // Local d'abord (toujours synchronisé avec le déploiement), remote ensuite (SWR)
    const candidates = ['/K_STORE_ASSETS/catalog.json', primaryUrl].filter(Boolean);

    for (const url of candidates) {
        try {
            const data = await _fetchJSON(url);
            if (data?.tools?.length) {
                _catalogCache     = data;
                _catalogFetchedAt = Date.now();
                window.dispatchEvent(new CustomEvent('ks-catalog-loaded', { detail: data }));
                return data;
            }
        } catch { /* essai suivant */ }
    }

    return null;
}

// ── Helpers internes ────────────────────────────────────────────
async function _fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res.json();
}

function _indexByPadKey(pads) {
    const map = {};
    pads.forEach(pad => {
        const key = pad.padKey || pad.id;
        map[key] = {
            id:              pad.id,
            padKey:          pad.padKey          || pad.id,
            type:            pad.type            || 'tool',
            title:           pad.title           || '',
            subtitle:        pad.subtitle        || '',
            ai_optimized:    pad.ai_optimized    || 'Claude',
            icon:            pad.icon            || 'zap',
            notice:          pad.notice          || '',
            fields:          pad.fields          || [],
            system_prompt:   pad.system_prompt   || '',
            engines:         pad.engines         || null,
            artifact_config: pad.artifact_config || null,
        };
    });
    return map;
}
