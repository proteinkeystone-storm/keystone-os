/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Data Fabric Client (Sprint 1.1)
   Layer 1 · API unifiée pour TOUS les artefacts.

   Promesse :
     - Aucun artefact ne fait de fetch() direct vers le Worker.
     - Tout passe par dataFabric.{read,list,write,delete,sync,upload}.
     - Offline-graceful : lecture cache local + queue de mutations.

   Stack :
     - Dexie.js (CDN, pas de bundler) pour IndexedDB
     - 2 stores IDB : entities (miroir D1) + syncQueue (mutations en attente)
     - Sync auto : à la reconnexion (event 'online') + au démarrage

   API publique :
     dataFabric.read(entity, id)       → objet ou null
     dataFabric.list(entity, query?)   → array
     dataFabric.write(entity, payload) → objet upserté
     dataFabric.delete(entity, id)     → { id, _deletedAt }
     dataFabric.upload(blob, meta)     → TODO (R2, sprint ultérieur)
     dataFabric.sync()                 → { flushed, pending }
     dataFabric.onSync(cb)             → unsubscribe()

   Debug console : `window.dataFabric` est exposé.
   ═══════════════════════════════════════════════════════════════ */

import Dexie from 'https://unpkg.com/dexie@4/dist/dexie.mjs';

// ── Config ─────────────────────────────────────────────────────
const API_BASE = 'https://keystone-os-api.keystone-os.workers.dev';
const DB_NAME  = 'keystone-data-fabric';

// Whitelist côté client (cohérente avec ALLOWED_ENTITIES côté Worker).
// Ajouter une entité ICI ET côté Worker à chaque évolution.
const ALLOWED_ENTITIES = new Set([
  'programs',
  'clauses',   // Sprint 1.2 — bibliothèque de clauses pour DocEngine
]);

// ── Schéma IndexedDB ───────────────────────────────────────────
// entities  : miroir local des objets serveur (cache + brouillons offline)
//   Clé primaire composite [type+id] pour isolation par entité.
//   `dirty=1` → mutation locale non encore synchronisée.
// syncQueue : file FIFO des mutations à pousser au cloud.
//   ++seq auto-incrémenté → ordre d'enqueue préservé.
const db = new Dexie(DB_NAME);
db.version(1).stores({
  entities  : '[type+id], type, updatedAt, deletedAt, dirty',
  syncQueue : '++seq, op, entity, id, createdAt',
});

const syncListeners = new Set();
let _syncing = false;

// ── Helpers internes ───────────────────────────────────────────
function _check(entity) {
  if (!ALLOWED_ENTITIES.has(entity)) {
    throw new Error(`Data Fabric : entité '${entity}' non autorisée (whitelist: ${[...ALLOWED_ENTITIES].join(', ')})`);
  }
}

function _jwt() {
  try { return localStorage.getItem('ks_jwt') || ''; }
  catch { return ''; }
}

function _authHeaders(extra = {}) {
  const jwt = _jwt();
  return { ...extra, ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) };
}

function _isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

// Notifie les listeners du résultat d'un sync (succès partiel inclus).
function _emitSync(stats) {
  syncListeners.forEach(cb => {
    try { cb(stats); } catch (e) { console.warn('[data-fabric] sync listener error', e); }
  });
}

// ── API publique ───────────────────────────────────────────────
export const dataFabric = {

  /**
   * Lit un objet par id. Retourne d'abord la copie locale (instantanée),
   * puis rafraîchit en arrière-plan depuis le cloud.
   * Renvoie null si introuvable même côté serveur.
   */
  async read(entity, id) {
    _check(entity);
    const local = await db.entities.get([entity, id]);
    if (local && !local.deletedAt) {
      this._refreshOne(entity, id).catch(() => {});
      return local.data;
    }
    if (!_isOnline()) return null;
    try {
      const res = await fetch(`${API_BASE}/api/data/${entity}/${id}`, {
        headers: _authHeaders(),
      });
      if (!res.ok) return null;
      const remote = await res.json();
      await db.entities.put({
        type: entity,
        id,
        data: remote,
        updatedAt: remote._updatedAt || new Date().toISOString(),
        deletedAt: remote._deletedAt || null,
        dirty: 0,
      });
      return remote;
    } catch { return null; }
  },

  /**
   * Liste les objets d'une entité.
   * @param {object} query - { filter: (obj) => bool }
   */
  async list(entity, query = {}) {
    _check(entity);
    // Refresh non-bloquant en arrière-plan.
    this._refreshList(entity).catch(() => {});
    let rows = await db.entities.where('type').equals(entity).toArray();
    rows = rows.filter(r => !r.deletedAt);
    if (typeof query.filter === 'function') {
      rows = rows.filter(r => { try { return !!query.filter(r.data); } catch { return false; } });
    }
    rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return rows.map(r => r.data);
  },

  /**
   * Écrit (upsert) un objet. Disponible immédiatement en lecture locale,
   * synchronisé au cloud en arrière-plan.
   */
  async write(entity, payload) {
    _check(entity);
    if (!payload || typeof payload !== 'object') throw new Error('write: payload objet requis');

    const id  = (typeof payload.id === 'string' && payload.id) ? payload.id : crypto.randomUUID();
    const now = new Date().toISOString();
    const data = { ...payload, id, _updatedAt: now };

    await db.entities.put({
      type: entity,
      id,
      data,
      updatedAt: now,
      deletedAt: null,
      dirty: 1,
    });
    await db.syncQueue.add({
      op: 'write', entity, id, payload: data, createdAt: now,
    });
    this.sync().catch(() => {});
    return data;
  },

  /**
   * Soft delete. L'objet disparaît des list() locaux immédiatement,
   * la suppression côté serveur part en queue.
   */
  async delete(entity, id) {
    _check(entity);
    const now = new Date().toISOString();
    const local = await db.entities.get([entity, id]);
    if (local) {
      await db.entities.put({ ...local, deletedAt: now, updatedAt: now, dirty: 1 });
    }
    await db.syncQueue.add({
      op: 'delete', entity, id, payload: null, createdAt: now,
    });
    this.sync().catch(() => {});
    return { id, _deletedAt: now };
  },

  /**
   * Upload binaire (R2). PAS ENCORE IMPLÉMENTÉ.
   * Sera ajouté dans un sprint dédié assets, une fois R2 configuré
   * dans wrangler.toml (binding ASSETS_BUCKET).
   */
  async upload(blob, meta) {
    throw new Error('dataFabric.upload : R2 pas encore configuré (sprint ultérieur)');
  },

  /**
   * Pousse les mutations en attente vers le cloud.
   * - Idempotent : un appel concurrent est no-op.
   * - Hors-ligne : ne tente rien, retourne directement.
   * - Sur erreur réseau : s'arrête, l'event 'online' relancera.
   */
  async sync() {
    const pendingBefore = await db.syncQueue.count();
    if (!_isOnline() || _syncing) {
      return { flushed: 0, pending: pendingBefore };
    }
    _syncing = true;
    let flushed = 0;
    try {
      const items = await db.syncQueue.orderBy('seq').toArray();
      for (const item of items) {
        let res;
        try {
          if (item.op === 'write') {
            res = await fetch(`${API_BASE}/api/data/${item.entity}`, {
              method  : 'POST',
              headers : _authHeaders({ 'Content-Type': 'application/json' }),
              body    : JSON.stringify(item.payload),
            });
          } else if (item.op === 'delete') {
            res = await fetch(`${API_BASE}/api/data/${item.entity}/${item.id}`, {
              method  : 'DELETE',
              headers : _authHeaders(),
            });
          }

          if (res && (res.ok || (res.status === 404 && item.op === 'delete'))) {
            await db.syncQueue.delete(item.seq);
            // Marque la copie locale comme propre.
            const local = await db.entities.get([item.entity, item.id]);
            if (local) await db.entities.put({ ...local, dirty: 0 });
            flushed++;
          } else {
            // Erreur serveur ou validation : on n'insiste pas dans cette
            // passe pour ne pas inonder l'API. Le prochain online retentera.
            console.warn('[data-fabric] sync stopped on', item.op, item.entity, item.id, res?.status);
            break;
          }
        } catch (e) {
          // Coupure réseau en pleine sync : on s'arrête proprement.
          console.warn('[data-fabric] sync network error', e);
          break;
        }
      }
    } finally {
      _syncing = false;
    }
    const pending = await db.syncQueue.count();
    const stats = { flushed, pending };
    _emitSync(stats);
    return stats;
  },

  /**
   * S'abonne aux events de sync (succès partiel ou total).
   * @returns {Function} unsubscribe()
   */
  onSync(cb) {
    if (typeof cb !== 'function') return () => {};
    syncListeners.add(cb);
    return () => syncListeners.delete(cb);
  },

  // ── Méthodes internes (préfixées _) ──────────────────────────
  // Rafraîchit la liste complète d'une entité depuis le cloud.
  // Ne pas écraser les copies locales dirty (mutation non sync).
  async _refreshList(entity) {
    if (!_isOnline()) return;
    try {
      const res = await fetch(`${API_BASE}/api/data/${entity}?includeDeleted=1`, {
        headers: _authHeaders(),
      });
      if (!res.ok) return;
      const { items } = await res.json();
      if (!Array.isArray(items)) return;
      await db.transaction('rw', db.entities, async () => {
        for (const it of items) {
          const local = await db.entities.get([entity, it.id]);
          if (local?.dirty) continue;
          await db.entities.put({
            type: entity,
            id: it.id,
            data: it,
            updatedAt: it._updatedAt || new Date().toISOString(),
            deletedAt: it._deletedAt || null,
            dirty: 0,
          });
        }
      });
    } catch { /* offline ou erreur réseau, on retentera */ }
  },

  async _refreshOne(entity, id) {
    if (!_isOnline()) return;
    try {
      const res = await fetch(`${API_BASE}/api/data/${entity}/${id}`, {
        headers: _authHeaders(),
      });
      if (!res.ok) return;
      const remote = await res.json();
      const local = await db.entities.get([entity, id]);
      if (local?.dirty) return;
      await db.entities.put({
        type: entity,
        id,
        data: remote,
        updatedAt: remote._updatedAt || new Date().toISOString(),
        deletedAt: remote._deletedAt || null,
        dirty: 0,
      });
    } catch { /* idem */ }
  },

  // Exposé pour debug (à ne pas utiliser depuis les artefacts).
  _debug: { db, ALLOWED_ENTITIES, API_BASE },
};

// ── Bootstrap ──────────────────────────────────────────────────
// Reconnexion → flush automatique.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => dataFabric.sync().catch(() => {}));
  // Premier flush au chargement (cas où la page rouvre avec queue résiduelle).
  queueMicrotask(() => dataFabric.sync().catch(() => {}));
  // Exposition globale pour debug console & smoke tests.
  window.dataFabric = dataFabric;
}
