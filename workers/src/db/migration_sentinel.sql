-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration Sentinel (Pad O-GEO-001 · S0)
--   wrangler d1 execute keystone-os --remote --file=./src/db/migration_sentinel.sql
--
-- Centre de contrôle d'audit web AVEC suivi. S0 = coquille : la liste
-- des sites surveillés par tenant + détection de plateforme + barème.
--
-- ISOLATION : préfixe dédié sentinel_. Le schéma est AUSSI auto-appliqué
-- au 1er appel côté route (pattern ai-credits / Keynapse) : ce fichier
-- reste la source de vérité documentaire.
-- ═══════════════════════════════════════════════════════════════

-- ── Sites surveillés (un par ligne, isolés par tenant) ──────────
-- platform : 'wix' | 'wordpress' | 'custom' | 'unknown' (détecté à l'ajout).
CREATE TABLE IF NOT EXISTS sentinel_sites (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  url         TEXT NOT NULL,
  label       TEXT,
  platform    TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_sentinel_sites_tenant ON sentinel_sites(tenant_id);
