/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Admin v1.0
   RGPD : export de données + purge tenant

   GET  /api/admin/export           → JSON de toutes les données
   POST /api/admin/purge-tenant     → supprime devices + révoque licences d'un tenant
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin } from '../lib/auth.js';

// ── GET /api/admin/export ─────────────────────────────────────
// Retourne toutes les licences + devices (RGPD portabilité Art.20)
export async function handleExport(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const [licencesRes, devicesRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM licences ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT id, tenant_id, label, type, email, is_approved, approved_by, last_seen, created_at FROM devices ORDER BY created_at DESC').all(),
  ]);

  return json({
    exportedAt: new Date().toISOString(),
    source:     'Keystone OS · Cloudflare D1 WEUR',
    licences:   licencesRes.results || [],
    devices:    devicesRes.results  || [],
  }, 200, origin);
}

// ── POST /api/admin/purge-tenant ──────────────────────────────
// Supprime tous les appareils et révoque toutes les licences d'un tenant.
// Action RGPD Art. 17 — droit à l'effacement.
export async function handlePurgeTenant(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const { tenantId } = await parseBody(request);
  if (!tenantId || typeof tenantId !== 'string') {
    return err('Champ "tenantId" requis', 400, origin);
  }

  // Vérifier que le tenant existe
  const tenant = await env.DB
    .prepare('SELECT id FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first();

  // On tolère si le tenant n'est pas dans la table tenants (données orphelines à purger quand même)

  // Supprimer les devices du tenant
  const delDevices = await env.DB
    .prepare('DELETE FROM devices WHERE tenant_id = ?')
    .bind(tenantId)
    .run();

  // Révoquer toutes les licences du tenant
  const revokeRes = await env.DB
    .prepare("UPDATE licences SET is_active = 0, updated_at = datetime('now') WHERE tenant_id = ?")
    .bind(tenantId)
    .run();

  return json({
    success:          true,
    tenantId,
    devicesDeleted:   delDevices.meta.changes  || 0,
    licencesRevoked:  revokeRes.meta.changes   || 0,
    purgedAt:         new Date().toISOString(),
  }, 200, origin);
}
