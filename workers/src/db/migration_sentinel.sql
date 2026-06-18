-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration Sentinel (Pad O-GEO-001) · S0 → S2
--   wrangler d1 execute keystone-os --remote --file=./src/db/migration_sentinel.sql
--
-- Centre de contrôle d'audit web AVEC suivi.
--   S0   : sites surveillés + détection de plateforme.
--   S1   : battement de cœur — relevés de disponibilité + colonnes cache.
--   S1.5 : alertes web push (abonnements par appareil).
--   S2   : audits on-page + score (colonnes cache last_score/last_scores).
--
-- ISOLATION : préfixe dédié sentinel_. Le schéma est AUSSI auto-appliqué
-- au 1er appel côté route (pattern ai-credits / Keynapse), ALTER tolérant
-- pour les colonnes : ce fichier reste la source de vérité.
-- ═══════════════════════════════════════════════════════════════

-- ── Sites surveillés (un par ligne, isolés par tenant) ──────────
CREATE TABLE IF NOT EXISTS sentinel_sites (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  url                TEXT NOT NULL,
  label              TEXT,
  platform           TEXT,                       -- 'wix'|'wordpress'|'custom'|'unknown'
  next_check_at      TEXT,                        -- file de balayage (cron)
  last_checked_at    TEXT,
  last_ok            INTEGER,
  last_status        INTEGER,
  last_ms            INTEGER,
  consecutive_fails  INTEGER NOT NULL DEFAULT 0,  -- seuil d'alerte
  last_score         INTEGER,                     -- S2 : dernier score global
  last_scores        TEXT,                        -- S2 : JSON sous-scores par axe
  last_audit_at      TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_sentinel_sites_tenant ON sentinel_sites(tenant_id);

-- ── Relevés de disponibilité (historique du battement de cœur) ──
CREATE TABLE IF NOT EXISTS sentinel_checks (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  site_id     TEXT NOT NULL,
  ok          INTEGER NOT NULL DEFAULT 0,
  status      INTEGER,
  ms          INTEGER,
  error       TEXT,
  checked_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_sentinel_checks_site ON sentinel_checks(site_id, checked_at);

-- ── S1.5 — abonnements web push (alertes) ──────────────────────
CREATE TABLE IF NOT EXISTS sentinel_push_subs (
  endpoint    TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_sentinel_push_tenant ON sentinel_push_subs(tenant_id);

-- ── S2 — audits on-page (historique score + findings) ──────────
CREATE TABLE IF NOT EXISTS sentinel_audits (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  site_id     TEXT NOT NULL,
  score       INTEGER,
  scores      TEXT,                                -- JSON { disponibilite, seo, securite, accessibilite }
  findings    TEXT,                                -- JSON [ { axis, sev, title, detail } ]
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_sentinel_audits_site ON sentinel_audits(site_id, created_at);

-- ── Base déjà créée avant S2 : colonnes cache ajoutées au runtime
-- par _ensureSchema (ALTER tolérant). À appliquer une fois si besoin
-- (ignorer « duplicate column ») :
--   ALTER TABLE sentinel_sites ADD COLUMN last_score INTEGER;
--   ALTER TABLE sentinel_sites ADD COLUMN last_scores TEXT;
--   ALTER TABLE sentinel_sites ADD COLUMN last_audit_at TEXT;
