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

    // 2. Sprint B Phase 2 — Enrichissement non-bloquant depuis JSON.
    //    Behind flag `ks_pads_from_json` (localStorage) ou
    //    `window.__KS_PADS_FROM_JSON__`. Désactivé par défaut.
    //    Quand actif, charge K_STORE_ASSETS/PADS/<NOMEN>.json pour
    //    chaque pad du manifest et merge par-dessus l'embedded JS.
    //    Si réseau / fichier indisponible → silencieux, embedded
    //    reste référence (offline-first préservé via fallback).
    _enrichFromJSON().catch(() => {});

    // 3. Enrichissement non-bloquant depuis D1 : merge engines.prompts
    //    (les prompts moteurs alternatifs ne sont pas dans pads-data.js).
    _enrichFromD1().catch(() => {});

    // 4. Catalogue Key-Store édité depuis l'admin (longDesc, screenshots…)
    _refreshCatalogFromD1().catch(() => {});

    return _padsCache;
}

// ── Feature flag JSON loader (Phase 2) ───────────────────────────
const _LS_PADS_FROM_JSON = 'ks_pads_from_json';

/**
 * Détecte si l'enrichissement depuis K_STORE_ASSETS/PADS/*.json doit
 * être appliqué. Activation :
 *   - window.__KS_PADS_FROM_JSON__ = true       (in-memory, dev)
 *   - localStorage.setItem('ks_pads_from_json','1')  (persistant)
 *
 * Par défaut : false → seul pads-data.js (embedded) est utilisé,
 * comportement strictement identique à avant Phase 2.
 */
export function isPadsFromJSONEnabled() {
    if (typeof window === 'undefined') return false;
    if (window.__KS_PADS_FROM_JSON__ === true) return true;
    try { return localStorage.getItem(_LS_PADS_FROM_JSON) === '1'; }
    catch (_) { return false; }
}

/**
 * Charge les schemas pads depuis K_STORE_ASSETS/PADS/*.json et les
 * merge par-dessus l'embedded JS de pads-data.js. Non-bloquant.
 *
 * Doctrine : embedded reste la source canonique synchrone (offline-
 * first garanti). JSON ne fait qu'enrichir / écraser quand le flag
 * est actif. Si fetch échoue (réseau coupé, 404…), on continue
 * silencieusement avec l'embedded.
 *
 * Préserve les champs uniquement présents dans l'embedded (ex: rien
 * de spécifique pour l'instant — JSON est cible canonique à terme).
 */
async function _enrichFromJSON() {
    if (!isPadsFromJSONEnabled()) return;

    // Manifest list : quels pads ont un JSON disponible
    let manifest;
    try {
        const res = await fetch('/K_STORE_ASSETS/PADS/manifest.json', { cache: 'no-cache' });
        if (!res.ok) return;
        manifest = await res.json();
    } catch (_) { return; }

    if (!Array.isArray(manifest?.pads)) return;

    // Reverse map : NOMEN-K id → padKey interne (pour retrouver la clé
    // dans _padsCache qui est indexé par padKey, pas par id).
    const idToKey = new Map();
    for (const [key, pad] of Object.entries(_padsCache)) {
        if (pad?.id) idToKey.set(pad.id, key);
    }

    // Fetch + merge en parallèle pour chaque pad listé dans le manifest.
    let mergedCount = 0;
    await Promise.all(manifest.pads.map(async (nomenId) => {
        const key = idToKey.get(nomenId);
        if (!key) return;   // pad pas dans embedded → skip
        try {
            const res = await fetch(`/K_STORE_ASSETS/PADS/${nomenId}.json`, { cache: 'no-cache' });
            if (!res.ok) return;
            const jsonPad = await res.json();
            // Merge : JSON wins. _enrichFromD1 (étape 3) appliquera
            // ensuite ses overrides sur engines.prompts.
            _padsCache[key] = { ..._padsCache[key], ...jsonPad };
            mergedCount++;
        } catch (_) {}
    }));

    if (mergedCount > 0) {
        // Notifie l'UI qu'elle peut re-render avec les schemas JSON.
        window.dispatchEvent(new CustomEvent('ks-pads-refreshed-from-json', {
            detail: { mergedCount },
        }));
    }
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

    // Merge tool-par-tool : D1 enrichit, embarqué = source de vérité.
    //
    // Sprint cleanup-1 (2026-05-22) : le merge ne crée PLUS d'entrées
    // remote-only. Avant, si D1 contenait un tool absent de CATALOG_DATA
    // (typique d'une DB obsolète qui retient les anciennes apps), il
    // était ajouté à _catalogCache.tools → réapparaissait dans le dashboard
    // et le K-Store même après suppression du code local. Désormais le
    // local est canonique sur la LISTE des tools ; D1 ne peut qu'enrichir
    // les métadonnées (engines, etc.) des tools déjà déclarés localement.
    //
    // EXCEPTION : on préserve les champs d'UI embarqués (icon, plan,
    // pricing, title, subtitle) pour ne pas se faire écraser par une
    // version D1 obsolète. Ajouté title/subtitle 2026-05-22 après le
    // rename "Sovereign Dynamic QR" → "Dynamic QR" : le code source
    // est désormais aussi canonique pour le wording UI des tools.
    const UI_FIELDS_LOCAL_FIRST = ['icon', 'plan', 'lifetimePrice', 'price', 'timeSaved', 'title', 'subtitle'];
    const byId = new Map();
    (_catalogCache?.tools || []).forEach(t => byId.set(t.id, t));
    remote.tools.forEach(t => {
        if (!t?.id) return;
        const existing = byId.get(t.id);
        if (!existing) return;   // Skip les tools remote absents du catalogue local
        const merged = { ...existing, ...t };
        // Restaure les champs UI depuis la version embarquée
        for (const f of UI_FIELDS_LOCAL_FIRST) {
            if (existing[f] != null) merged[f] = existing[f];
        }
        byId.set(t.id, merged);
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
// Les pads avec `replacedBy` sont conservés dans PADS_DATA (compat
// utilisateurs ayant déjà acheté / brouillons) mais filtrés du
// dashboard. Sprint VEFA-Studio-1 : A1 et A9 → O-IMM-010.
export function getToolList() {
    return Object.values(_padsCache)
        .filter(pad => !pad.replacedBy)
        .map(pad => ({
            id:     pad.id,
            padKey: pad.padKey || pad.id,
            name:   pad.title || pad.id,
            desc:   pad.subtitle || '',
            icon:   pad.icon || 'zap',
            engine: pad.ai_optimized || 'Claude',
        }));
}

// ── Liste dynamique des artefacts (depuis CATALOG_DATA) ─────────
// Un artefact = tool sans padKey (rendu via son fichier JS dédié,
// pas via le moteur de form générique de ui-renderer). Le préfixe
// d'ID (A-* ou O-*) n'est PAS un critère fiable — VEFA Studio est
// O-IMM-010 mais reste un artefact fullscreen.
export function getArtefactList() {
    return _catalogCache.tools
        .filter(t => t.padKey === null || t.padKey === undefined)
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
 * null   → tout owned (ADMIN, démo Enterprise, ou clé jamais activée)
 * []     → abonnement révoqué / aucun outil
 * [...]  → liste des IDs sous abonnement
 */
export function getOwnedIds() {
    const raw = localStorage.getItem(LS_OWNED);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

export function setOwnedIds(ids) {
    // Sprint S6 — fix critique : si null est passé, on RETIRE la clé
    // (sémantique "tout owned"). Avant : stockait '[]' = aucun outil owned →
    // dashboard vide pour les admins / Enterprise post-activation iPad.
    if (ids === null || ids === undefined) {
        localStorage.removeItem(LS_OWNED);
        return;
    }
    localStorage.setItem(LS_OWNED, JSON.stringify(Array.isArray(ids) ? ids : []));
}

// Sprint S6 — Helper bypass ADMIN strict.
// Si l'utilisateur a plan ADMIN (en localStorage OU dans son JWT), il a accès
// à TOUS les outils du catalogue, peu importe ce que dit owned_assets en DB.
// C'est la solution structurelle à la classe de bugs cross-device ADMIN où
// la DB renvoie owned_assets:null et le frontend ne sait pas le gérer.
export function isAdminUser() {
    const plan = (localStorage.getItem('ks_licence_plan') || '').toUpperCase();
    if (plan === 'ADMIN') return true;
    // Fallback : lire le JWT pour vérifier le claim isAdmin
    try {
        const jwt = localStorage.getItem('ks_jwt');
        if (!jwt) return false;
        const parts = jwt.split('.');
        if (parts.length !== 3) return false;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.isAdmin === true || (payload.plan || '').toUpperCase() === 'ADMIN';
    } catch (_) { return false; }
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
