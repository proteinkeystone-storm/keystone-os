/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pads Loader v2.1
   Source de base : pads-data.js (embarqué, offline-first).
   Enrichissement : merge non-bloquant depuis D1 via Worker API
   pour récupérer les engines.prompts sauvegardés par l'admin.
   ═══════════════════════════════════════════════════════════════ */

import { PADS_DATA, CATALOG_DATA } from './pads-data.js';

export const CF_API = 'https://keystone-os-api.keystone-os.workers.dev';

let _padsCache    = null;
let _catalogCache = null;

// ── Initialisation synchrone à l'import ─────────────────────────
_padsCache    = PADS_DATA;
_catalogCache = CATALOG_DATA;

// ── Chargement principal ─────────────────────────────────────────
export async function loadPads() {
    // 1. Données embarquées disponibles immédiatement (offline-first).
    queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent('ks-catalog-loaded', { detail: _catalogCache }));
    });

    // 2. Enrichissement non-bloquant depuis D1 : merge engines.prompts
    //    (les prompts moteurs alternatifs ne sont pas dans pads-data.js).
    _enrichFromD1().catch(() => {});

    // 3. Catalogue Key-Store édité depuis l'admin (longDesc, screenshots…)
    _refreshCatalogFromD1().catch(() => {});

    return _padsCache;
}

async function _enrichFromD1() {
    const res = await fetch(`${CF_API}/api/pads?tenantId=default`);
    if (!res.ok) return;
    const { pads } = await res.json();
    if (!Array.isArray(pads)) return;
    pads.forEach(d1Pad => {
        if (!d1Pad?.id || !_padsCache[d1Pad.id]) return;
        // On ne merge que le champ engines (prompts moteurs) pour ne pas
        // écraser les métadonnées d'UI embarquées (plan, price, icon…).
        if (d1Pad.engines) _padsCache[d1Pad.id] = { ..._padsCache[d1Pad.id], engines: d1Pad.engines };
    });
}

// ── Récupère le catalogue Key-Store depuis D1 (route publique) ──
// Merge non-bloquant : si l'API échoue, on garde la version embarquée.
async function _refreshCatalogFromD1() {
    let res;
    try { res = await fetch(`${CF_API}/api/catalog?tenantId=default`); }
    catch { return; }
    if (!res.ok) return;

    let body;
    try { body = await res.json(); }
    catch { return; }

    const remote = body?.catalog;
    if (!remote || !Array.isArray(remote.tools)) return;

    // Merge tool-par-tool : D1 prioritaire mais embarqué = fallback.
    const byId = new Map();
    (_catalogCache?.tools || []).forEach(t => byId.set(t.id, t));
    remote.tools.forEach(t => {
        if (!t?.id) return;
        byId.set(t.id, { ...(byId.get(t.id) || {}), ...t });
    });

    _catalogCache = {
        ..._catalogCache,
        ...remote,
        tools: [...byId.values()],
        updatedAt: remote.updatedAt || _catalogCache?.updatedAt,
    };

    // Notifie l'UI (Key-Store ouvert) qu'il faut éventuellement re-rendre.
    window.dispatchEvent(new CustomEvent('ks-catalog-loaded', { detail: _catalogCache }));
}

// ── Liste dynamique des outils ──────────────────────────────────
export function getToolList() {
    return Object.values(_padsCache).map(pad => ({
        id:     pad.id,
        padKey: pad.padKey || pad.id,
        name:   pad.title || pad.id,
        desc:   pad.subtitle || '',
        icon:   pad.icon || 'zap',
        engine: pad.ai_optimized || 'Claude',
    }));
}

// ── Liste dynamique des artefacts (depuis CATALOG_DATA) ─────────
export function getArtefactList() {
    return _catalogCache.tools
        .filter(t => t.id.startsWith('A-'))
        .map(t => ({
            id:     t.id,
            name:   t.title || t.id,
            desc:   t.subtitle || '',
            icon:   t.icon || 'zap',
            engine: t.ai_optimized || 'Claude',
        }));
}

// ── Accès direct à un pad par padKey ou NOMEN-K id ──────────────
export function getPad(keyOrId) {
    if (_padsCache[keyOrId]) return _padsCache[keyOrId];
    return Object.values(_padsCache).find(p => p.id === keyOrId) || null;
}

// ═══════════════════════════════════════════════════════════════
// OWNERSHIP — Classification owned / suggested / frigo
// ═══════════════════════════════════════════════════════════════
const LS_OWNED    = 'ks_owned_assets';
const LS_LIFETIME = 'ks_lifetime_purchases';

/**
 * null   → mode démo (tous les outils visibles)
 * []     → abonnement révoqué
 * [...]  → liste des IDs sous abonnement
 */
export function getOwnedIds() {
    const raw = localStorage.getItem(LS_OWNED);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

export function setOwnedIds(ids) {
    localStorage.setItem(LS_OWNED, JSON.stringify(Array.isArray(ids) ? ids : []));
}

export function getLifetimeIds() {
    const raw = localStorage.getItem(LS_LIFETIME);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

export function setLifetimeIds(ids) {
    localStorage.setItem(LS_LIFETIME, JSON.stringify(Array.isArray(ids) ? ids : []));
}

export function addLifetimePurchase(id) {
    const current = getLifetimeIds();
    if (current.includes(id)) return;
    setLifetimeIds([...current, id]);
    window.dispatchEvent(new CustomEvent('ks-lifetime-activated', { detail: { id } }));
}

export function isFrigoMode() {
    const ownedIds    = getOwnedIds();
    const lifetimeIds = getLifetimeIds();
    return ownedIds !== null && ownedIds.length === 0 && lifetimeIds.length > 0;
}

export function classifyPads() {
    const all         = _padsCache;
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
// CATALOGUE — accès synchrone à la donnée embarquée
// ═══════════════════════════════════════════════════════════════
export async function fetchRemoteCatalog() {
    // Compat : fonction async conservée. Renvoie le catalogue embarqué.
    return _catalogCache;
}

export function getCatalog() { return _catalogCache; }

export function getCatalogEntry(id) {
    if (!_catalogCache?.tools) return null;
    return _catalogCache.tools.find(t => t.id === id) || null;
}
