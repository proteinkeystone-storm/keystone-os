/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pads Loader v1.0
   Master Renderer : charge les JSON de K_STORE_ASSETS/PADS/
   Fallback automatique vers pads-data.js si fetch indisponible
   ═══════════════════════════════════════════════════════════════ */

import { PADS_DATA } from './pads-data.js';

const PADS_BASE    = './K_STORE_ASSETS/PADS';
const CATALOG_TTL  = 5 * 60 * 1000; // 5 minutes

// Cache PADs (session)
let _padsCache = null;

// Cache Catalogue distant
let _catalogCache     = null;
let _catalogFetchedAt = 0;
let _remoteUrl        = null; // lu depuis manifest.json au premier loadPads()

// ── Chargement principal ────────────────────────────────────────
export async function loadPads() {
    if (_padsCache) return _padsCache;

    try {
        // 1. Tente de charger depuis les JSON (source canonique USB)
        const manifest = await _fetchJSON(`${PADS_BASE}/manifest.json`);
        if (!manifest?.pads?.length) throw new Error('manifest vide');

        // Mémorise l'URL distante du catalogue si présente
        if (manifest.remoteUrl) _remoteUrl = manifest.remoteUrl;

        const results = await Promise.allSettled(
            manifest.pads.map(id => _fetchJSON(`${PADS_BASE}/${id}.json`))
        );

        const loaded = results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);

        if (loaded.length === 0) throw new Error('aucun pad chargé');

        // Convertir le tableau en map padKey → pad (compatible PADS_DATA)
        _padsCache = _indexByPadKey(loaded);
        return _padsCache;

    } catch (_) {
        // 2. Fallback silencieux — données embarquées dans pads-data.js
        _padsCache = PADS_DATA;
        return _padsCache;
    }
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
// OWNERSHIP — Classification owned / suggested
// ═══════════════════════════════════════════════════════════════
const LS_OWNED = 'ks_owned_assets';

/**
 * Retourne le tableau des IDs possédés, ou null (= mode démo, tout accessible).
 * null   → vault vide / fresh install → mode démo, tous les pads sont actifs
 * []     → licence vide → rien n'est accessible
 * [...]  → liste des IDs achetés
 */
export function getOwnedIds() {
    const raw = localStorage.getItem(LS_OWNED);
    if (raw === null) return null; // mode démo
    try { return JSON.parse(raw); } catch { return null; }
}

/** Persiste la liste des IDs possédés (appelé après activation licence). */
export function setOwnedIds(ids) {
    localStorage.setItem(LS_OWNED, JSON.stringify(Array.isArray(ids) ? ids : []));
}

/**
 * Sépare les pads chargés en deux groupes :
 *   owned     → affiché dans la grille principale (interactif)
 *   suggested → affiché dans la barre Key-Store (verrouillé)
 * @returns {{ owned: Object, suggested: Object }}
 */
export function classifyPads() {
    const all      = _padsCache || PADS_DATA;
    const ownedIds = getOwnedIds();

    // Mode démo : tout est dans owned, rien dans suggested
    if (ownedIds === null) return { owned: all, suggested: {} };

    const owned     = {};
    const suggested = {};
    Object.entries(all).forEach(([key, pad]) => {
        if (ownedIds.includes(pad.id)) {
            owned[key] = pad;
        } else {
            suggested[key] = { ...pad, locked: true };
        }
    });
    return { owned, suggested };
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
    const candidates = [primaryUrl, '/K_STORE_ASSETS/catalog.json'].filter(Boolean);

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
        // Normalise la structure pour être compatible avec PADS_DATA
        map[key] = {
            id:           pad.id,
            padKey:       pad.padKey || pad.id,
            title:        pad.title        || '',
            subtitle:     pad.subtitle     || '',
            ai_optimized: pad.ai_optimized || 'Claude',
            icon:         pad.icon         || 'zap',
            notice:       pad.notice       || '',
            fields:       pad.fields       || [],
            system_prompt:pad.system_prompt|| '',
        };
    });
    return map;
}
