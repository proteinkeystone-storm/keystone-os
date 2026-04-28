-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration : ajout table messages
-- ─────────────────────────────────────────────────────────────
-- À exécuter sur D1 existante :
--   wrangler d1 execute keystone-os --file=./src/db/migration_messages.sql --remote
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  target       TEXT NOT NULL DEFAULT 'all',
  title        TEXT,
  body         TEXT NOT NULL,
  level        TEXT DEFAULT 'info',
  cta_label    TEXT,
  cta_url      TEXT,
  expires_at   TEXT,
  revoked      INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now')),
  created_by   TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_tenant   ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_target   ON messages(target);
CREATE INDEX IF NOT EXISTS idx_messages_active   ON messages(revoked, expires_at);
