/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Help Media v1.0 (Help-Overlay v2, Phase 2)
   Vidéos de démo des notices d'aide « ? », stockées sur R2.

   POST   /api/admin/help/media           Admin  — upload (champ file + appId + kind)
   GET    /api/help/:appId/media          Public — { video:{url,poster} } ou { video:null }
   GET    /api/help/:appId/media/video    Public — sert la vidéo (supporte Range)
   GET    /api/help/:appId/media/poster   Public — sert le poster
   DELETE /api/admin/help/media/:appId    Admin  — supprime vidéo + poster (R2 + D1)

   Le binaire vit sur R2 (binding HELP_MEDIA). Le mapping
   app_id → clé R2 vit en D1 (table help_videos). Auto-migration
   idempotente à la 1re requête (pas de wrangler d1 migrations apply).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, getAllowedOrigin } from '../lib/auth.js';

// Garde-fous. Cible réelle : < 10 Mo (cf. specs admin). Plafond large
// pour tolérer un clip non optimisé, sans exploser la mémoire du Worker.
const MAX_VIDEO_BYTES  = 60 * 1024 * 1024;   // 60 Mo
const MAX_POSTER_BYTES = 5  * 1024 * 1024;   // 5 Mo
const ALLOWED_VIDEO    = ['video/mp4', 'video/webm'];
const ALLOWED_POSTER   = ['image/jpeg', 'image/png', 'image/webp'];

// app_id : pas de slash ni de point (anti path-traversal sur la clé R2).
const APP_ID_RE = /^[A-Za-z0-9_-]{3,32}$/;
const EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// ── Auto-migration idempotente ────────────────────────────────
let _schemaReady = false;
async function ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS help_videos (
      app_id      TEXT PRIMARY KEY,
      video_key   TEXT,
      video_mime  TEXT,
      video_size  INTEGER,
      poster_key  TEXT,
      poster_mime TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  _schemaReady = true;
}

function _publicMedia(originBase, appId, row) {
  if (!row || !row.video_key) return { video: null };
  // Cache-buster basé sur updated_at : un remplacement de vidéo conserve
  // la même clé/URL de path, le ?v change donc le cache (serve = 24 h) est
  // invalidé proprement côté navigateur. La route ignore la query.
  const v = encodeURIComponent(row.updated_at || '');
  return {
    video: {
      url:    `${originBase}/api/help/${appId}/media/video?v=${v}`,
      poster: row.poster_key ? `${originBase}/api/help/${appId}/media/poster?v=${v}` : null,
    },
    updated_at: row.updated_at,
  };
}

// ── POST /api/admin/help/media ────────────────────────────────
// multipart/form-data : file (Blob), appId (string), kind ('video'|'poster')
export async function handleHelpMediaUpload(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  if (!env.HELP_MEDIA) return err('Stockage R2 (HELP_MEDIA) non configuré', 500, origin);
  await ensureSchema(env);

  let form;
  try { form = await request.formData(); }
  catch { return err('multipart/form-data attendu', 400, origin); }

  const appId = String(form.get('appId') || '').trim();
  const kind  = String(form.get('kind')  || 'video').trim();
  const file  = form.get('file');

  if (!APP_ID_RE.test(appId))            return err('appId invalide', 400, origin);
  if (kind !== 'video' && kind !== 'poster') return err('kind invalide (video|poster)', 400, origin);
  if (!file || typeof file === 'string') return err('Champ "file" requis', 400, origin);

  const isPoster = kind === 'poster';
  const mime     = file.type || '';
  const allowed  = isPoster ? ALLOWED_POSTER : ALLOWED_VIDEO;
  const maxBytes = isPoster ? MAX_POSTER_BYTES : MAX_VIDEO_BYTES;

  if (!allowed.includes(mime)) return err(`Type non autorisé (${allowed.join(', ')})`, 400, origin);
  if (file.size > maxBytes)    return err(`Fichier trop volumineux (max ${Math.round(maxBytes / 1048576)} Mo)`, 413, origin);

  const key = `help/${appId}/${kind}.${EXT[mime]}`;
  const buf = await file.arrayBuffer();
  await env.HELP_MEDIA.put(key, buf, { httpMetadata: { contentType: mime } });

  if (isPoster) {
    await env.DB.prepare(`
      INSERT INTO help_videos (app_id, poster_key, poster_mime, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(app_id) DO UPDATE SET
        poster_key = excluded.poster_key,
        poster_mime = excluded.poster_mime,
        updated_at = datetime('now')
    `).bind(appId, key, mime).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO help_videos (app_id, video_key, video_mime, video_size, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(app_id) DO UPDATE SET
        video_key = excluded.video_key,
        video_mime = excluded.video_mime,
        video_size = excluded.video_size,
        updated_at = datetime('now')
    `).bind(appId, key, mime, file.size).run();
  }

  const row = await env.DB.prepare('SELECT * FROM help_videos WHERE app_id = ?').bind(appId).first();
  return json({ success: true, appId, ..._publicMedia(new URL(request.url).origin, appId, row) }, 200, origin);
}

// ── GET /api/help/:appId/media ────────────────────────────────
// Public — l'overlay l'appelle pour savoir s'il existe une vidéo.
export async function handleHelpMediaInfo(request, env, appId) {
  await ensureSchema(env);
  if (!APP_ID_RE.test(appId)) return err('appId invalide', 400, '*');
  const row = await env.DB.prepare('SELECT * FROM help_videos WHERE app_id = ?').bind(appId).first();
  return new Response(JSON.stringify(_publicMedia(new URL(request.url).origin, appId, row)), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

// ── GET /api/help/:appId/media/(video|poster) ─────────────────
// Public — sert le binaire depuis R2, avec support des requêtes Range
// (indispensable pour le seek/scrub d'une <video>).
export async function handleHelpMediaServe(request, env, appId, kind) {
  if (!env.HELP_MEDIA) return new Response('R2 non configuré', { status: 500 });
  await ensureSchema(env);
  if (!APP_ID_RE.test(appId)) return new Response('Bad request', { status: 400 });

  const row = await env.DB.prepare('SELECT * FROM help_videos WHERE app_id = ?').bind(appId).first();
  if (!row) return new Response('Not found', { status: 404 });

  const isPoster = kind === 'poster';
  const key  = isPoster ? row.poster_key : row.video_key;
  const mime = (isPoster ? row.poster_mime : row.video_mime) || (isPoster ? 'image/jpeg' : 'video/mp4');
  if (!key) return new Response('Not found', { status: 404 });

  const rangeHeader = request.headers.get('range');

  // HEAD ou pas de Range → objet complet.
  if (!rangeHeader || request.method === 'HEAD') {
    const obj = await env.HELP_MEDIA.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('Content-Type', mime);
    headers.set('Content-Length', String(obj.size));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
  }

  // Range : "bytes=start-end" | "bytes=start-" | "bytes=-suffix"
  const head = await env.HELP_MEDIA.head(key);
  if (!head) return new Response('Not found', { status: 404 });
  const size = head.size;

  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  let start = m && m[1] !== '' ? parseInt(m[1], 10) : undefined;
  let end   = m && m[2] !== '' ? parseInt(m[2], 10) : undefined;
  if (start === undefined && end !== undefined) { start = Math.max(0, size - end); end = size - 1; }   // suffix
  else { if (start === undefined) start = 0; if (end === undefined) end = size - 1; }
  if (start > end || start >= size) {
    return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  end = Math.min(end, size - 1);
  const length = end - start + 1;

  const obj = await env.HELP_MEDIA.get(key, { range: { offset: start, length } });
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Type', mime);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(length));
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(obj.body, { status: 206, headers });
}

// ── DELETE /api/admin/help/media/:appId ───────────────────────
export async function handleHelpMediaDelete(request, env, appId) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  if (!env.HELP_MEDIA) return err('Stockage R2 (HELP_MEDIA) non configuré', 500, origin);
  await ensureSchema(env);
  if (!APP_ID_RE.test(appId)) return err('appId invalide', 400, origin);

  const row = await env.DB.prepare('SELECT * FROM help_videos WHERE app_id = ?').bind(appId).first();
  if (row) {
    if (row.video_key)  await env.HELP_MEDIA.delete(row.video_key);
    if (row.poster_key) await env.HELP_MEDIA.delete(row.poster_key);
    await env.DB.prepare('DELETE FROM help_videos WHERE app_id = ?').bind(appId).run();
  }
  return json({ success: true, appId }, 200, origin);
}
