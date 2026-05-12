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
// Supprime toutes les données d'un tenant. Action RGPD Art. 17 —
// droit à l'effacement.
//
// Sprint Sécu-2 / H1 — purge étendue à toutes les tables tenant-scoped :
//   - devices, qr_redirects, qr_scans, screenshots, messages,
//     pads, catalog, api_keys_vault, entities, user_vaults
// Les licences sont anonymisées (UPDATE) plutôt que DELETE pour
// conserver la traçabilité financière Stripe (chargebacks, audits).
// stripe_events (idempotence globale) et activation_attempts
// (par fingerprint, pas tenant) ne sont pas touchés.
export async function handlePurgeTenant(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const { tenantId } = await parseBody(request);
  if (!tenantId || typeof tenantId !== 'string') {
    return err('Champ "tenantId" requis', 400, origin);
  }

  // Ordre des DELETE : on supprime d'abord les tables qui pointent
  // vers d'autres (qr_scans → qr_redirects, user_vaults → licences).
  const counts = {};

  // 1. qr_scans (via short_id link to qr_redirects)
  const r1 = await env.DB.prepare(
    'DELETE FROM qr_scans WHERE short_id IN (SELECT short_id FROM qr_redirects WHERE tenant_id = ?)'
  ).bind(tenantId).run();
  counts.qr_scans = r1.meta.changes || 0;

  // 2. qr_redirects
  const r2 = await env.DB.prepare('DELETE FROM qr_redirects WHERE tenant_id = ?').bind(tenantId).run();
  counts.qr_redirects = r2.meta.changes || 0;

  // 3. user_vaults (via sub link to licences.lookup_hmac)
  const r3 = await env.DB.prepare(
    'DELETE FROM user_vaults WHERE sub IN (SELECT lookup_hmac FROM licences WHERE tenant_id = ? AND lookup_hmac IS NOT NULL)'
  ).bind(tenantId).run();
  counts.user_vaults = r3.meta.changes || 0;

  // 4-10. Tables tenant-scoped directes
  for (const table of ['screenshots', 'messages', 'pads', 'catalog', 'api_keys_vault', 'entities', 'devices']) {
    try {
      const r = await env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId).run();
      counts[table] = r.meta.changes || 0;
    } catch (e) {
      // Table peut-être absente (auto-migration) — on tolère et on continue
      counts[table] = `error: ${e.message}`;
    }
  }

  // 11. Licences : anonymisation, pas DELETE (traçabilité financière)
  const rLic = await env.DB.prepare(
    "UPDATE licences SET is_active = 0, owner = 'REDACTED', customer_email = NULL, updated_at = datetime('now') WHERE tenant_id = ?"
  ).bind(tenantId).run();
  counts.licences_anonymized = rLic.meta.changes || 0;

  return json({
    success:   true,
    tenantId,
    counts,
    purgedAt:  new Date().toISOString(),
  }, 200, origin);
}
