/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Médias (R2) v1.0
   (Sprint Social-1 — visuels)

   POST /api/social/media          Admin  — upload une image → R2, renvoie l'URL
   GET  /api/social/media/:file    Public — sert l'image (fetchée par FB/IG)

   Stockage : bucket R2 `HELP_MEDIA`, préfixe `social/`. L'URL de service
   est publique (non devinable : nom = UUID) → indispensable car Facebook
   et Instagram vont CHERCHER l'image à son URL pour la publier.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, generateId, getAllowedOrigin } from '../lib/auth.js';

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES   = 8 * 1024 * 1024;   // 8 Mo

// ── POST /api/social/media ────────────────────────────────────
// Body = binaire de l'image. Header Content-Type = type MIME.
export async function handleSocialMediaUpload(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  if (!env.HELP_MEDIA)             return err('Bucket R2 (HELP_MEDIA) indisponible', 500, origin);

  const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext  = EXT_BY_MIME[mime];
  if (!ext) return err(`Type non supporté (${mime || 'absent'}). Acceptés : ${Object.keys(EXT_BY_MIME).join(', ')}`, 415, origin);

  const buf = await request.arrayBuffer();
  if (!buf.byteLength)            return err('Corps vide', 400, origin);
  if (buf.byteLength > MAX_BYTES) return err('Image trop volumineuse (max 8 Mo)', 413, origin);

  const filename = `${generateId()}.${ext}`;
  await env.HELP_MEDIA.put(`social/${filename}`, buf, { httpMetadata: { contentType: mime } });

  const url = `${new URL(request.url).origin}/api/social/media/${filename}`;
  return json({ success: true, url, bytes: buf.byteLength }, 200, origin);
}

// ── GET /api/social/media/:file ───────────────────────────────
// Public — sert l'image depuis R2 (cache long, nom immuable).
export async function handleSocialMediaServe(request, env, filename) {
  if (!/^[0-9a-f-]{8,}\.(jpg|png|webp|gif)$/i.test(filename || '')) {
    return new Response('Bad request', { status: 400 });
  }
  const obj = await env.HELP_MEDIA.get(`social/${filename}`);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type',  obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  if (obj.size != null) headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
