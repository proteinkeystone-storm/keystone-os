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

import { json, err, getAllowedOrigin, parseBody, generateId } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

// ── Whitelist : seules ces entités sont acceptées. ─────────────
// Étendre cette liste à chaque nouvelle entité (briefs, qr_codes,
// clauses, scans, programs_history…). Sécurité par défaut : deny.
const ALLOWED_ENTITIES = new Set([
  'programs',
]);

const MAX_PAYLOAD_BYTES = 256 * 1024;   // 256 KB par entité (cap raisonnable)
const MAX_LIST_LIMIT    = 500;

// ── Extraction tenant depuis JWT ───────────────────────────────
async function _tenantOf(request, env) {
  const payload = await requireJWT(request, env);
  if (payload?.sub) return payload.sub;
  // Fallback démo : pas de JWT → tenant 'default'.
  // Permet le mode démo public, à retirer si on durcit la sécurité.
  return 'default';
}

function _checkEntity(entity, origin) {
  if (!entity || !ALLOWED_ENTITIES.has(entity)) {
    return err(`Entité '${entity}' non autorisée`, 400, origin);
  }
  return null;
}

// Sérialise une row D1 vers le payload renvoyé au client.
// Convention : on renvoie le data JSON "à plat" + les méta préfixées _.
function _rowToObject(row) {
  let data;
  try { data = JSON.parse(row.data); }
  catch { data = {}; }
  return {
    ...data,
    id: row.id,
    _createdAt: row.created_at,
    _updatedAt: row.updated_at,
    _deletedAt: row.deleted_at || null,
  };
}

// ── GET /api/data/:entity ──────────────────────────────────────
// Liste les objets d'une entité pour le tenant courant.
// Query params :
//   ?since=<ISO>          → ne renvoie que les objets modifiés après
//   ?includeDeleted=1     → inclut les soft-deletes (pour la sync)
//   ?limit=<n>            → max MAX_LIST_LIMIT
export async function handleDataList(request, env, entity) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;
  const tenantId = await _tenantOf(request, env);

  const url   = new URL(request.url);
  const since = url.searchParams.get('since');
  const includeDeleted = url.searchParams.get('includeDeleted') === '1';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), MAX_LIST_LIMIT);

  let sql = 'SELECT id, data, created_at, updated_at, deleted_at FROM entities WHERE tenant_id=? AND type=?';
  const binds = [tenantId, entity];
  if (since) { sql += ' AND updated_at > ?'; binds.push(since); }
  if (!includeDeleted) sql += ' AND deleted_at IS NULL';
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  binds.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  const items = (results || []).map(_rowToObject);
  return json({ items, total: items.length }, 200, origin);
}

// ── GET /api/data/:entity/:id ──────────────────────────────────
export async function handleDataRead(request, env, entity, id) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;
  const tenantId = await _tenantOf(request, env);

  const row = await env.DB
    .prepare('SELECT id, data, created_at, updated_at, deleted_at FROM entities WHERE tenant_id=? AND type=? AND id=?')
    .bind(tenantId, entity, id)
    .first();

  if (!row || row.deleted_at) return err('Introuvable', 404, origin);
  return json(_rowToObject(row), 200, origin);
}

// ── POST /api/data/:entity ─────────────────────────────────────
// Upsert : si body.id existe, on remplace ; sinon on crée.
export async function handleDataWrite(request, env, entity) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;
  const tenantId = await _tenantOf(request, env);

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') return err('Body JSON requis', 400, origin);

  const id = (typeof body.id === 'string' && body.id.length > 0) ? body.id : generateId();

  // On retire les méta-champs avant de stocker pour ne pas les figer
  // dans le JSON (ils sont reconstruits par _rowToObject à la lecture).
  const { id: _ignoredId, _createdAt, _updatedAt, _deletedAt, ...payload } = body;
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
export async function handleDataPatch(request, env, entity, id) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;
  const tenantId = await _tenantOf(request, env);

  const patch = await parseBody(request);
  if (!patch || typeof patch !== 'object') return err('Body JSON requis', 400, origin);

  const row = await env.DB
    .prepare('SELECT data FROM entities WHERE tenant_id=? AND type=? AND id=? AND deleted_at IS NULL')
    .bind(tenantId, entity, id)
    .first();
  if (!row) return err('Introuvable', 404, origin);

  let current;
  try { current = JSON.parse(row.data); }
  catch { current = {}; }

  const { id: _i, _createdAt, _updatedAt, _deletedAt, ...patchClean } = patch;
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
export async function handleDataDelete(request, env, entity, id) {
  const origin = getAllowedOrigin(env, request);
  const bad = _checkEntity(entity, origin); if (bad) return bad;
  const tenantId = await _tenantOf(request, env);

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
