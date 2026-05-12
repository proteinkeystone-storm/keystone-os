/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Audit Log (Sprint Sécu-4 / I3)
   ─────────────────────────────────────────────────────────────
   Trace les actions admin critiques pour RGPD accountability +
   investigation incident. Table auto-créée à la première écriture
   (pas de migration manuelle nécessaire).

   Convention :
     action   : verbe court — 'purge_tenant', 'licence_revoke', etc.
     actor    : qui a fait l'action — 'admin' par défaut, ou email
     target   : objet visé — tenantId, licence key, deviceId…
     details  : payload JSON (200-4000 chars), pour contexte
     ip       : cf-connecting-ip si dispo

   Lecture :
     SELECT * FROM audit_logs ORDER BY ts DESC LIMIT 100;
   Purge :
     DELETE FROM audit_logs WHERE ts < datetime('now', '-2 years');
   (rétention 2 ans pour accountability — à arbitrer)
   ═══════════════════════════════════════════════════════════════ */

let _schemaReady = false;

async function _ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          TEXT NOT NULL DEFAULT (datetime('now')),
      action      TEXT NOT NULL,
      actor       TEXT,
      target      TEXT,
      tenant_id   TEXT,
      details     TEXT,
      ip          TEXT
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts DESC)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, ts DESC)'
  ).run().catch(() => {});
  _schemaReady = true;
}

/**
 * Log une action admin. Best-effort : si l'INSERT échoue (D1 down,
 * etc.) on n'interrompt pas le flow business, on log juste en console.
 *
 * @param {object} env      Worker env (env.DB requis)
 * @param {object} entry    { action, actor?, target?, tenantId?, details?, request? }
 *                          request : si fourni, on extrait l'IP automatiquement
 */
export async function audit(env, entry) {
  try {
    await _ensureSchema(env);
    const { action, actor, target, tenantId, details, request } = entry;
    const ip = request?.headers?.get('cf-connecting-ip') || null;
    const detailsStr = details ? JSON.stringify(details).slice(0, 4096) : null;
    await env.DB.prepare(`
      INSERT INTO audit_logs (action, actor, target, tenant_id, details, ip)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      action,
      actor   || 'admin',
      target  || null,
      tenantId|| null,
      detailsStr,
      ip,
    ).run();
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
}
