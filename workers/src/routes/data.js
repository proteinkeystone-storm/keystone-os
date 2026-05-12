/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Data Fabric Routes (Sprint 1.1)
   Layer 1 · CRUD générique sur la table entities.

   Routes exposées (toutes en /api/data/*) :
   ─────────────────────────────────────────────────────────────
   GET    /api/data/:entity              → liste (?since=ISO pour delta)
   GET    /api/data/:entity/:id          → lecture d'un objet
   POST   /api/data/:entity              → upsert (id auto si absent)
   PATCH  /api/data/:entity/:id          → merge partiel
   DELETE /api/data/:entity/:id          → soft delete

   Auth : JWT Bearer (lib/jwt.js → requireJWT).
     - Le tenantId est extrait du claim `sub` du JWT (= hash licence).
     - Fallback `tenantId = 'default'` si pas de JWT (mode démo/dev).
     - À durcir en prod : retirer le fallback et exiger un JWT.

   Sécurité : whitelist d'entités. Toute entité hors liste = 400.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin, parseBody, generateId, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

// ── Whitelist : seules ces entités sont acceptées. ─────────────
// Étendre cette liste à chaque nouvelle entité (briefs, qr_codes,
// clauses, scans, programs_history…). Sécurité par défaut : deny.
const ALLOWED_ENTITIES = new Set([
  'programs',
  'clauses',   // Sprint 1.2 — bibliothèque de clauses pour DocEngine
  // Sprint Kodex-1 — artefact A-COM-002
  'standards',     // fiches techniques imprimeurs/réseaux/presse (tenant=shared)
  'sectors',       // profils métier déclaratifs (tenant=shared)
  'codex_briefs',  // historique des briefs générés par user
]);

const MAX_PAYLOAD_BYTES = 256 * 1024;   // 256 KB par entité (cap raisonnable)
const MAX_LIST_LIMIT    = 500;
const SHARED_TENANT     = 'shared';     // Dette B — catalogue partagé en lecture

// ── Extraction tenant depuis JWT ───────────────────────────────
async function _tenantOf(request, env) {
  // Sprint Sécu-1 / C3 : plus de fallback 'default'. JWT obligatoire.
  // Les handlers checkent null et renvoient 401.
  const payload = await requireJWT(request, env);
  return payload?.sub || null;
}

// Pour les écritures : permet d'override vers 'shared' si admin.
// Body.tenant ou header X-Tenant-Override = 'shared' déclenche l'override.
// Toute autre valeur d'override est ignorée (sécurité).
async function _writeTenant(request, env, body) {
  const override = (body?.tenant || request.headers.get('X-Tenant-Override') || '').trim();
  if (override === SHARED_TENANT) {
    if (!requireAdmin(request, env)) return null;   // refus si pas admin
    return SHARED_TENANT;
  }
  return _tenantOf(request, env);
}

function _checkEntity(entity, origin) {
  if (!entity || !ALLOWED_ENTITIES.has(entity)) {
    return err(`Entité '${entity}' non autorisée`, 400, origin);
  }
  return null;
}

// Sérialise une row D1 vers le payload renvoyé au client.
// Convention : on renvoie le data JSON "à plat" + les méta préfixées _.
// On expose aussi _tenant pour que l'admin distingue local vs shared.
function _rowToObject(row) {
  let data;
  try { data = JSON.parse(row.data); }
  catch { data = {}; }
  return {
    ...data,
    id: row.id,
    _tenant: row.tenant_id || null,
    _createdAt: row.created_at,
    _updatedAt: row.updated_at,
    _deletedAt: row.deleted_at || null,
  };
}

// ── GET /api/data/:entity ──────────────────────────────────────
// Liste les objets d'une entité, UNION (tenant courant ∪ tenant 'shared').
// Si un même id existe dans les deux, le tenant courant gagne (override
// local sur le catalogue partagé).
// Query params :
//   ?since=<ISO>          → ne renvoie que les objets modifiés après
//   ?includeDeleted=1     → inclut les soft-deletes (pour la sync)
//   ?limit=<n>            → max MAX_LIST_LIMIT
//   ?tenant=shared        → admin : limite la liste au tenant shared
export async function handleDataList(request, env, entity) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;
  const tenantId = await _tenantOf(request, env);
  if (!tenantId) return err('JWT requis', 401, origin);

  const url   = new URL(request.url);
  const since = url.searchParams.get('since');
  const includeDeleted = url.searchParams.get('includeDeleted') === '1';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), MAX_LIST_LIMIT);
  const tenantFilter = url.searchParams.get('tenant');

  // Mode admin : filtrer uniquement sur 'shared' (pour gérer le catalogue)
  let sql, binds;
  if (tenantFilter === SHARED_TENANT && requireAdmin(request, env)) {
    sql = 'SELECT id, data, created_at, updated_at, deleted_at, tenant_id FROM entities WHERE tenant_id = ? AND type = ?';
    binds = [SHARED_TENANT, entity];
  } else {
    // Mode normal : union (tenant courant + shared)
    sql = `SELECT id, data, created_at, updated_at, deleted_at, tenant_id
           FROM entities
           WHERE type = ? AND (tenant_id = ? OR tenant_id = ?)`;
    binds = [entity, tenantId, SHARED_TENANT];
  }
  if (since) { sql += ' AND updated_at > ?'; binds.push(since); }
  if (!includeDeleted) sql += ' AND deleted_at IS NULL';
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  binds.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...binds).all();

  // Déduplication : si un même id existe en current ET shared, on garde
  // la version current (override local du catalogue partagé).
  const byId = new Map();
  for (const row of (results || [])) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
    } else if (existing.tenant_id === SHARED_TENANT && row.tenant_id !== SHARED_TENANT) {
      byId.set(row.id, row);
    }
  }

  const items = [...byId.values()].map(_rowToObject);
  return json({ items, total: items.length }, 200, origin);
}

// ── GET /api/data/:entity/:id ──────────────────────────────────
// Cherche d'abord dans le tenant courant, fallback sur 'shared'.
export async function handleDataRead(request, env, entity, id) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;
  const tenantId = await _tenantOf(request, env);
  if (!tenantId) return err('JWT requis', 401, origin);

  const row = await env.DB
    .prepare(`SELECT id, data, created_at, updated_at, deleted_at, tenant_id
              FROM entities
              WHERE type = ? AND id = ? AND (tenant_id = ? OR tenant_id = ?)
              ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END
              LIMIT 1`)
    .bind(entity, id, tenantId, SHARED_TENANT, tenantId)
    .first();

  if (!row || row.deleted_at) return err('Introuvable', 404, origin);
  return json(_rowToObject(row), 200, origin);
}

// ── POST /api/data/:entity ─────────────────────────────────────
// Upsert : si body.id existe, on remplace ; sinon on crée.
// Si body.tenant='shared' (ou header X-Tenant-Override: shared) ET admin
// authentifié → l'écriture cible le catalogue partagé.
export async function handleDataWrite(request, env, entity) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') return err('Body JSON requis', 400, origin);

  const tenantId = await _writeTenant(request, env, body);
  if (!tenantId) return err('Admin requis pour écrire dans le catalogue partagé', 401, origin);

  const id = (typeof body.id === 'string' && body.id.length > 0) ? body.id : generateId();

  // On retire les méta-champs ET le champ tenant (côté request) avant de
  // stocker pour ne pas les figer dans le JSON (ils sont reconstruits par
  // _rowToObject à la lecture).
  const { id: _ignoredId, tenant: _ignoredTenant, _tenant, _createdAt, _updatedAt, _deletedAt, ...payload } = body;
  const dataJson = JSON.stringify(payload);

  if (dataJson.length > MAX_PAYLOAD_BYTES) {
    return err(`Payload trop volumineux (max ${MAX_PAYLOAD_BYTES} octets)`, 413, origin);
  }

  const now = new Date().toISOString();

  // UPSERT atomique. On reset deleted_at (un POST sur un objet
  // soft-deleted le ressuscite — comportement choisi pour simplicité).
  await env.DB.prepare(`
    INSERT INTO entities (id, tenant_id, type, data, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT (tenant_id, type, id) DO UPDATE SET
      data       = excluded.data,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).bind(id, tenantId, entity, dataJson, now, now).run();

  return json({ id, _updatedAt: now, ...payload }, 200, origin);
}

// ── PATCH /api/data/:entity/:id ────────────────────────────────
// Merge superficiel (1 niveau). Pour des mises à jour profondes,
// le client lit + write en POST.
// Override admin shared : même règles que POST.
export async function handleDataPatch(request, env, entity, id) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;

  const patch = await parseBody(request);
  if (!patch || typeof patch !== 'object') return err('Body JSON requis', 400, origin);

  const tenantId = await _writeTenant(request, env, patch);
  if (!tenantId) return err('Admin requis pour modifier le catalogue partagé', 401, origin);

  const row = await env.DB
    .prepare('SELECT data FROM entities WHERE tenant_id=? AND type=? AND id=? AND deleted_at IS NULL')
    .bind(tenantId, entity, id)
    .first();
  if (!row) return err('Introuvable', 404, origin);

  let current;
  try { current = JSON.parse(row.data); }
  catch { current = {}; }

  const { id: _i, tenant: _t, _tenant, _createdAt, _updatedAt, _deletedAt, ...patchClean } = patch;
  const merged = { ...current, ...patchClean };
  const dataJson = JSON.stringify(merged);

  if (dataJson.length > MAX_PAYLOAD_BYTES) {
    return err(`Payload trop volumineux (max ${MAX_PAYLOAD_BYTES} octets)`, 413, origin);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE entities SET data=?, updated_at=? WHERE tenant_id=? AND type=? AND id=?'
  ).bind(dataJson, now, tenantId, entity, id).run();

  return json({ id, _updatedAt: now, ...merged }, 200, origin);
}

// ── DELETE /api/data/:entity/:id ───────────────────────────────
// Soft delete : on marque deleted_at, on garde la ligne pour la
// synchro delta cross-device.
// Override admin shared : header X-Tenant-Override: shared OU query
// ?tenant=shared (admin only).
export async function handleDataDelete(request, env, entity, id) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;

  // Pour DELETE on n'a pas de body, on lit le tenant override via query ou header.
  const url = new URL(request.url);
  const overrideQuery = url.searchParams.get('tenant');
  const fakeBody = overrideQuery === SHARED_TENANT ? { tenant: SHARED_TENANT } : null;
  const tenantId = await _writeTenant(request, env, fakeBody);
  if (!tenantId) return err('Admin requis pour supprimer dans le catalogue partagé', 401, origin);

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    'UPDATE entities SET deleted_at=?, updated_at=? WHERE tenant_id=? AND type=? AND id=? AND deleted_at IS NULL'
  ).bind(now, now, tenantId, entity, id).run();

  if (!result.meta.changes) return err('Introuvable', 404, origin);
  return json({ id, _deletedAt: now }, 200, origin);
}

// ── Dispatcher pour le router principal ────────────────────────
// Gère le pattern /api/data/:entity[/:id] avec extraction propre.
export async function handleDataDispatch(request, env, path, method, origin) {
  const segments = path.split('/').filter(Boolean); // ['api', 'data', entity, id?]
  const entity   = segments[2];
  const id       = segments[3];

  if (!entity) return err('Entité requise', 400, origin);

  if (id) {
    if (method === 'GET')    return handleDataRead(request, env, entity, id);
    if (method === 'PATCH')  return handleDataPatch(request, env, entity, id);
    if (method === 'DELETE') return handleDataDelete(request, env, entity, id);
  } else {
    if (method === 'GET')  return handleDataList(request, env, entity);
    if (method === 'POST') return handleDataWrite(request, env, entity);
  }
  return err('Méthode non supportée', 405, origin);
}
