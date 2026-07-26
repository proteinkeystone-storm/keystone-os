/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes PADs v1.0
   Stockage des outils & artefacts en D1 (remplace fichiers JSON)

   GET  /api/pads                  Public pour 'default' UNIQUEMENT ;
                                   admin ou JWT du tenant sinon (M-9)
   POST /api/admin/pad             Admin   — créer ou mettre à jour
   DELETE /api/admin/pad           Admin   — supprimer
   GET  /api/admin/catalog         Admin   — récupérer le catalogue
   POST /api/admin/catalog         Admin   — sauvegarder le catalogue
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

// ── GET /api/pads ──────────────────────────────────────────────
// Retourne tous les PADs d'un tenant sous forme de tableau JSON.
// Utilisé par pads-loader.js côté dashboard.
// Audit sept. 2026 (M-9) : la lecture SANS authentification n'est permise
// que pour le tenant 'default' — c'est le seul que le front appelle sans
// jeton (pads-loader.js), et il ne contient que la configuration commune
// des outils. Tout autre tenant exige l'admin ou un JWT du tenant visé.
export async function handleListPads(request, env) {
  const origin   = getAllowedOrigin(env, request);
  const url      = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') || 'default';

  if (tenantId !== 'default' && !requireAdmin(request, env)) {
    const claims = await requireJWT(request, env);
    if (!claims || claims.sub !== tenantId) return err('Non autorisé', 401, origin);
  }

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

  // Audit sept. 2026 (F-5) : la clé primaire de `pads` est `id` SEUL — un
  // upsert sans garde permettait d'écraser le pad homonyme d'un AUTRE
  // tenant. Le WHERE sur le DO UPDATE ne met à jour que si le tenant
  // correspond ; sinon rien ne bouge (changes = 0) et on refuse en 409.
  const res = await env.DB.prepare(`
    INSERT INTO pads (id, tenant_id, data, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      data       = excluded.data,
      updated_at = datetime('now')
    WHERE pads.tenant_id = excluded.tenant_id
  `).bind(id, tenantId, dataJson).run();

  if (!res.meta.changes) {
    return err('Cet identifiant de pad appartient à un autre tenant', 409, origin);
  }

  return json({ success: true, id, updatedAt: new Date().toISOString() }, 200, origin);
}

// ── DELETE /api/admin/pad ──────────────────────────────────────
export async function handleDeletePad(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const { id, tenantId = 'default' } = await parseBody(request);
  if (!id) return err('Champ "id" requis', 400, origin);

  // Audit sept. 2026 (F-5) : suppression bornée au tenant visé — sans ce
  // filtre, supprimer par id pouvait emporter le pad d'un autre tenant.
  const result = await env.DB
    .prepare('DELETE FROM pads WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
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

// ── GET /api/catalog ──────────────────────────────────────────
// Public — sert le catalogue côté frontend (Key-Store). Pas d'auth.
// Cache court (60 s) car édité depuis l'admin.
export async function handleGetCatalogPublic(request, env) {
  const origin   = getAllowedOrigin(env, request);
  const url      = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') || 'default';

  const row = await env.DB
    .prepare('SELECT data FROM catalog WHERE tenant_id = ?')
    .bind(tenantId)
    .first();

  if (!row) return json({ catalog: null }, 200, origin);

  try {
    const data = JSON.parse(row.data);
    return new Response(JSON.stringify({ catalog: data }), {
      status: 200,
      headers: {
        'Content-Type'  : 'application/json',
        'Cache-Control' : 'public, max-age=60',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
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
