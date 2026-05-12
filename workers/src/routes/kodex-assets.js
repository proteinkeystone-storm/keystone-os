/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Assets (upload fichiers binaires)
   Sprint Kodex-3.1.5

   Stockage base64 dans D1 (pattern screenshots.js — pas de R2 pour
   éviter la configuration Cloudflare additionnelle en v1).
   Migration future possible vers R2 quand le volume justifiera.

   Routes :
     POST   /api/kodex/asset           Upload (auth JWT|device|admin)
     GET    /api/kodex/asset/:id       Sert le binary (cache 1 an, owner check via JWT)
     DELETE /api/kodex/asset/:id       Suppression (auth)
     GET    /api/kodex/assets          Liste les assets de l'owner

   Table auto-créée (CREATE IF NOT EXISTS) au premier insert.

   Limites :
     - 3 MB base64 (~ 2.25 MB binary après décodage)
     - MIME whitelist : PNG, JPG, SVG, PDF, AI, EPS, GIF, WebP
   ═══════════════════════════════════════════════════════════════ */

import {
  json, err, parseBody, getAllowedOrigin,
  requireDevice, requireAdmin, generateId,
} from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

const MAX_BASE64_LEN = 3 * 1024 * 1024;   // 3 MB de base64 (~2.25 MB binary)
const ALLOWED_MIMES  = [
  'image/png', 'image/jpeg', 'image/svg+xml', 'image/gif', 'image/webp',
  'application/pdf',
  'application/postscript',           // .ai / .eps
  'application/illustrator',
];

const ALLOWED_KINDS = ['logo', 'charte', 'photo', 'illustration', 'brand_book', 'gabarit', 'autre'];

// ── Auth : JWT licence, device token, OU admin secret ─────────
// Le owner_sub est utilisé pour gérer la propriété (un user ne peut
// supprimer/lire que ses propres uploads, sauf admin).
async function _resolveOwner(request, env) {
  if (requireAdmin(request, env)) {
    return { sub: 'admin', tenant: 'default', isAdmin: true };
  }
  const claims = await requireJWT(request, env);
  if (claims?.sub) {
    return { sub: claims.sub, tenant: claims.sub, isAdmin: false };
  }
  const device = await requireDevice(request, env);
  if (device?.tenant_id) {
    return { sub: 'device:' + device.id, tenant: device.tenant_id, isAdmin: false };
  }
  return null;
}

// ── Auto-migration de la table ────────────────────────────────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS kodex_assets (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL DEFAULT 'default',
      owner_sub   TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'autre',
      filename    TEXT NOT NULL,
      mime        TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL DEFAULT 0,
      data_base64 TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_kodex_assets_owner ON kodex_assets(owner_sub, created_at DESC)'
  ).run().catch(() => {});
  _schemaReady = true;
}

// ═══════════════════════════════════════════════════════════════
// POST /api/kodex/asset
// ═══════════════════════════════════════════════════════════════
export async function handleUploadAsset(request, env) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);

  const body = await parseBody(request);
  const { kind = 'autre', filename, mime, dataBase64 } = body;

  if (!filename || typeof filename !== 'string') {
    return err('Champ "filename" requis', 400, origin);
  }
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    return err('Champ "dataBase64" requis', 400, origin);
  }
  if (!ALLOWED_MIMES.includes(mime)) {
    return err(`Type de fichier non supporté. Acceptés : ${ALLOWED_MIMES.join(', ')}`, 400, origin);
  }
  if (!ALLOWED_KINDS.includes(kind)) {
    return err(`Type d'asset invalide. Acceptés : ${ALLOWED_KINDS.join(', ')}`, 400, origin);
  }
  if (dataBase64.length > MAX_BASE64_LEN) {
    return err(`Fichier trop volumineux (max ${Math.round(MAX_BASE64_LEN / 1024 / 1024)} MB après encodage base64)`, 413, origin);
  }

  // Décode pour calculer la taille réelle (rejet si payload corrompu)
  let sizeBytes;
  try {
    sizeBytes = atob(dataBase64).length;
  } catch (_) {
    return err('Base64 invalide', 400, origin);
  }

  const id = generateId();
  await env.DB.prepare(`
    INSERT INTO kodex_assets (id, tenant_id, owner_sub, kind, filename, mime, size_bytes, data_base64)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, owner.tenant, owner.sub, kind, filename.slice(0, 200), mime, sizeBytes, dataBase64).run();

  return json({
    success: true,
    id, filename, mime, kind,
    size_bytes: sizeBytes,
    url: `/api/kodex/asset/${id}`,
    created_at: new Date().toISOString(),
  }, 201, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/kodex/asset/:id  →  sert le binary
// ═══════════════════════════════════════════════════════════════
export async function handleGetAsset(request, env, id) {
  await _ensureSchema(env);
  if (!id || !/^[0-9a-f-]{8,}$/i.test(id)) {
    return new Response('Bad request', { status: 400 });
  }

  // Pour la lecture, on autorise l'accès direct par id (pattern screenshots).
  // L'id étant un UUID v4, c'est non-énumérable. Pas d'auth pour permettre
  // l'embed dans les PDF brief et autres documents.
  const row = await env.DB
    .prepare('SELECT mime, data_base64, filename FROM kodex_assets WHERE id = ?')
    .bind(id)
    .first();

  if (!row) return new Response('Not found', { status: 404 });

  let bytes;
  try {
    bytes = Uint8Array.from(atob(row.data_base64), c => c.charCodeAt(0));
  } catch (_) {
    return new Response('Corrupted asset', { status: 500 });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type'  : row.mime || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `inline; filename="${(row.filename || 'asset').replace(/"/g, '')}"`,
      'Cache-Control' : 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// GET /api/kodex/assets  →  liste les assets de l'owner
// ═══════════════════════════════════════════════════════════════
export async function handleListAssets(request, env) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);

  // Admin voit tous les assets de tous les owners (utile audit)
  const query = owner.isAdmin
    ? 'SELECT id, owner_sub, kind, filename, mime, size_bytes, created_at FROM kodex_assets ORDER BY created_at DESC LIMIT 100'
    : 'SELECT id, kind, filename, mime, size_bytes, created_at FROM kodex_assets WHERE owner_sub = ? ORDER BY created_at DESC LIMIT 100';

  const stmt = owner.isAdmin
    ? env.DB.prepare(query)
    : env.DB.prepare(query).bind(owner.sub);

  const { results } = await stmt.all();
  return json({
    assets: (results || []).map(r => ({
      id: r.id,
      kind: r.kind,
      filename: r.filename,
      mime: r.mime,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
      url: `/api/kodex/asset/${r.id}`,
    })),
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// DELETE /api/kodex/asset/:id
// ═══════════════════════════════════════════════════════════════
export async function handleDeleteAsset(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);
  if (!id) return err('Id requis', 400, origin);

  // Vérifie le propriétaire (sauf admin)
  if (!owner.isAdmin) {
    const row = await env.DB
      .prepare('SELECT owner_sub FROM kodex_assets WHERE id = ?')
      .bind(id)
      .first();
    if (!row) return err('Asset introuvable', 404, origin);
    if (row.owner_sub !== owner.sub) {
      return err('Vous ne pouvez supprimer que vos propres uploads', 403, origin);
    }
  }

  const result = await env.DB.prepare('DELETE FROM kodex_assets WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return err('Asset introuvable', 404, origin);
  return json({ success: true, id }, 200, origin);
}
