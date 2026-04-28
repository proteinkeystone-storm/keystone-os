/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes PADs v1.0
   Stockage des outils & artefacts en D1 (remplace fichiers JSON)

   GET  /api/pads                  Public  — liste les PADs d'un tenant
   POST /api/admin/pad             Admin   — créer ou mettre à jour
   DELETE /api/admin/pad           Admin   — supprimer
   GET  /api/admin/catalog         Admin   — récupérer le catalogue
   POST /api/admin/catalog         Admin   — sauvegarder le catalogue
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin } from '../lib/auth.js';

// ── GET /api/pads ──────────────────────────────────────────────
// Retourne tous les PADs d'un tenant sous forme de tableau JSON.
// Utilisé par pads-loader.js côté dashboard.
export async function handleListPads(request, env) {
  const origin   = getAllowedOrigin(env, request);
  const url      = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') || 'default';

  const { results } = await env.DB
    .prepare('SELECT id, data FROM pads WHERE tenant_id = ? ORDER BY updated_at DESC')
    .bind(tenantId)
    .all();

  const pads = results.map(row => {
    try { return JSON.parse(row.data); }
    catch { return null; }
  }).filter(Boolean);

  return json({ pads, total: pads.length }, 200, origin);
}

// ── POST /api/admin/pad ────────────────────────────────────────
// Upsert d'un PAD. Le corps = objet PAD complet (id requis).
export async function handleSavePad(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const body = await parseBody(request);
  const { id, tenantId = 'default' } = body;

  if (!id || typeof id !== 'string') return err('Champ "id" requis', 400, origin);

  const dataJson = JSON.stringify(body);

  await env.DB.prepare(`
    INSERT INTO pads (id, tenant_id, data, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      data       = excluded.data,
      updated_at = datetime('now')
  `).bind(id, tenantId, dataJson).run();

  return json({ success: true, id, updatedAt: new Date().toISOString() }, 200, origin);
}

// ── DELETE /api/admin/pad ──────────────────────────────────────
export async function handleDeletePad(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const { id } = await parseBody(request);
  if (!id) return err('Champ "id" requis', 400, origin);

  const result = await env.DB
    .prepare('DELETE FROM pads WHERE id = ?')
    .bind(id)
    .run();

  if (!result.meta.changes) return err('PAD introuvable', 404, origin);
  return json({ success: true, id }, 200, origin);
}

// ── GET /api/admin/catalog ─────────────────────────────────────
export async function handleGetCatalog(request, env) {
  const origin   = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const url      = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') || 'default';

  const row = await env.DB
    .prepare('SELECT data FROM catalog WHERE tenant_id = ?')
    .bind(tenantId)
    .first();

  if (!row) return json({ catalog: null }, 200, origin);

  try {
    return json({ catalog: JSON.parse(row.data) }, 200, origin);
  } catch {
    return err('Catalogue corrompu', 500, origin);
  }
}

// ── POST /api/admin/catalog ────────────────────────────────────
export async function handleSaveCatalog(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const body     = await parseBody(request);
  const tenantId = body.tenantId || 'default';
  const catalog  = body.catalog;

  if (!catalog) return err('Champ "catalog" requis', 400, origin);

  await env.DB.prepare(`
    INSERT INTO catalog (tenant_id, data, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET
      data       = excluded.data,
      updated_at = datetime('now')
  `).bind(tenantId, JSON.stringify(catalog)).run();

  return json({ success: true, updatedAt: new Date().toISOString() }, 200, origin);
}
