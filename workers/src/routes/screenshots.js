/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Screenshots v1.0
   Stockage d'images base64 en D1 pour les fiches Key-Store.

   POST   /api/admin/screenshot         Admin  — upload (retourne id)
   GET    /api/screenshot/:id           Public — sert l'image
   DELETE /api/admin/screenshot/:id     Admin  — supprime

   Auto-migration : la table `screenshots` est créée à la 1re requête.
   Pas besoin de wrangler d1 migrations apply.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin } from '../lib/auth.js';

const MAX_BASE64_LEN = 4 * 1024 * 1024;     // ~3 Mo d'image
const ALLOWED_MIMES  = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// ── Auto-migration idempotente ────────────────────────────────
let _schemaReady = false;
async function ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS screenshots (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL DEFAULT 'default',
      app_id      TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      mime        TEXT NOT NULL DEFAULT 'image/jpeg',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_screenshots_app
    ON screenshots(tenant_id, app_id)
  `).run();
  _schemaReady = true;
}

// ── POST /api/admin/screenshot ────────────────────────────────
// Body : { appId, mime, dataBase64, tenantId? }
//   dataBase64 : payload base64 brut (sans préfixe "data:image/...")
// Retour : { success, id, url }
export async function handleUploadScreenshot(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureSchema(env);

  const body = await parseBody(request);
  const { appId, mime = 'image/jpeg', dataBase64, tenantId = 'default' } = body;

  if (!appId || typeof appId !== 'string') {
    return err('Champ "appId" requis', 400, origin);
  }
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    return err('Champ "dataBase64" requis', 400, origin);
  }
  if (!ALLOWED_MIMES.includes(mime)) {
    return err(`MIME non autorisé (autorisés : ${ALLOWED_MIMES.join(', ')})`, 400, origin);
  }
  if (dataBase64.length > MAX_BASE64_LEN) {
    return err('Image trop volumineuse (max ~3 Mo)', 413, origin);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO screenshots (id, tenant_id, app_id, data_base64, mime)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, tenantId, appId, dataBase64, mime).run();

  return json({
    success: true,
    id,
    url: `/api/screenshot/${id}`,
  }, 200, origin);
}

// ── GET /api/screenshot/:id ───────────────────────────────────
// Public — sert l'image décodée avec cache long (id immuable).
export async function handleGetScreenshot(request, env, id) {
  await ensureSchema(env);

  if (!id || !/^[0-9a-f-]{8,}$/i.test(id)) {
    return new Response('Bad request', { status: 400 });
  }

  const row = await env.DB
    .prepare('SELECT mime, data_base64 FROM screenshots WHERE id = ?')
    .bind(id)
    .first();

  if (!row) return new Response('Not found', { status: 404 });

  // Décode base64 → bytes
  let bytes;
  try {
    bytes = Uint8Array.from(atob(row.data_base64), c => c.charCodeAt(0));
  } catch {
    return new Response('Corrupted image', { status: 500 });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type'  : row.mime || 'image/jpeg',
      'Content-Length': String(bytes.byteLength),
      // L'id est un UUID immuable → cache un an
      'Cache-Control' : 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── DELETE /api/admin/screenshot/:id ──────────────────────────
export async function handleDeleteScreenshot(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureSchema(env);

  if (!id) return err('Id requis', 400, origin);

  await env.DB.prepare('DELETE FROM screenshots WHERE id = ?').bind(id).run();
  return json({ success: true, id }, 200, origin);
}

// ── (Optionnel) Liste les screenshots d'une app ───────────────
export async function handleListScreenshotsByApp(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureSchema(env);

  const url      = new URL(request.url);
  const appId    = url.searchParams.get('appId');
  const tenantId = url.searchParams.get('tenantId') || 'default';

  if (!appId) return err('Param "appId" requis', 400, origin);

  const { results } = await env.DB
    .prepare(`
      SELECT id, mime, created_at
      FROM screenshots
      WHERE tenant_id = ? AND app_id = ?
      ORDER BY created_at ASC
    `)
    .bind(tenantId, appId)
    .all();

  return json({
    screenshots: results.map(r => ({
      id: r.id,
      mime: r.mime,
      url: `/api/screenshot/${r.id}`,
      createdAt: r.created_at,
    })),
  }, 200, origin);
}
