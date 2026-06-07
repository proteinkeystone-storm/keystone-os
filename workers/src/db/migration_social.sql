-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Sprint Social-0 : socle de diffusion réseaux sociaux
-- Tables social_accounts + social_posts.
--
-- Auto-appliquée par le Worker à la 1re requête sociale via
-- lib/social/schema.js → ensureSocialSchema(). Ce fichier sert de
-- documentation / d'exécution manuelle optionnelle :
--   wrangler d1 execute keystone-os --file=./src/db/migration_social.sql
-- ═══════════════════════════════════════════════════════════════

-- ── Comptes sociaux connectés (OAuth) ─────────────────────────
-- Tokens chiffrés AES-256-GCM (lib/crypto.js), jamais en clair —
-- même garantie que api_keys_vault.
CREATE TABLE IF NOT EXISTS social_accounts (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  platform           TEXT NOT NULL,
  target_type        TEXT NOT NULL DEFAULT 'profile',
  external_id        TEXT,
  display_name       TEXT,
  access_ciphertext  TEXT,
  access_iv          TEXT,
  refresh_ciphertext TEXT,
  refresh_iv         TEXT,
  scopes             TEXT,
  expires_at         TEXT,
  status             TEXT NOT NULL DEFAULT 'connected',
  meta               TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_tenant
  ON social_accounts(tenant_id, platform);

-- ── Posts (canonique + diffusion + cycle de vie) ──────────────
CREATE TABLE IF NOT EXISTS social_posts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  source        TEXT,
  canonical     TEXT NOT NULL,
  targets       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  scheduled_at  TEXT,
  results       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_social_posts_tenant
  ON social_posts(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_social_posts_due
  ON social_posts(status, scheduled_at);
