-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration Sentinel (Pad O-GEO-001) · S0 + S1
--   wrangler d1 execute keystone-os --remote --file=./src/db/migration_sentinel.sql
--
-- Centre de contrôle d'audit web AVEC suivi.
--   S0 : sites surveillés (par tenant) + détection de plateforme.
--   S1 : battement de cœur — relevés de disponibilité + colonnes cache.
--
-- ISOLATION : préfixe dédié sentinel_. Le schéma est AUSSI auto-appliqué
-- au 1er appel côté route (pattern ai-credits / Keynapse), ALTER tolérant
-- pour les colonnes ajoutées en S1 : ce fichier reste la source de vérité.
-- ═══════════════════════════════════════════════════════════════

-- ── Sites surveillés (un par ligne, isolés par tenant) ──────────
-- platform : 'wix' | 'wordpress' | 'custom' | 'unknown' (détecté à l'ajout).
-- Colonnes cache (S1) : état courant sans agréger l'historique.
--   next_check_at      prochaine vérification due (file de balayage)
--   last_*             dernier relevé (état affiché instantanément)
--   consecutive_fails  échecs consécutifs (seuil d'alerte — S1.5)
CREATE TABLE IF NOT EXISTS sentinel_sites (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  url                TEXT NOT NULL,
  label              TEXT,
  platform           TEXT,
  next_check_at      TEXT,
  last_checked_at    TEXT,
  last_ok            INTEGER,
  last_status        INTEGER,
  last_ms            INTEGER,
  consecutive_fails  INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_sentinel_sites_tenant ON sentinel_sites(tenant_id);

-- ── Relevés de disponibilité (historique du battement de cœur) ──
-- ok : 1 = HTTP 2xx/3xx, 0 = échec/timeout. ms : temps de réponse (≈ TTFB).
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

-- ── Bases déjà créées en S0 (sentinel_sites sans les colonnes cache) ──
-- À appliquer UNE fois sur une base S0 existante (ignorer les erreurs
-- « duplicate column » si _ensureSchema les a déjà ajoutées au runtime) :
--   ALTER TABLE sentinel_sites ADD COLUMN next_check_at TEXT;
--   ALTER TABLE sentinel_sites ADD COLUMN last_checked_at TEXT;
--   ALTER TABLE sentinel_sites ADD COLUMN last_ok INTEGER;
--   ALTER TABLE sentinel_sites ADD COLUMN last_status INTEGER;
--   ALTER TABLE sentinel_sites ADD COLUMN last_ms INTEGER;
--   ALTER TABLE sentinel_sites ADD COLUMN consecutive_fails INTEGER NOT NULL DEFAULT 0;
