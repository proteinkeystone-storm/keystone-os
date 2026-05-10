-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 001 · Data Fabric (Sprint 1.1)
-- Layer 1 : couche données unifiée pour TOUS les artefacts.
--
-- Pattern : JSON-in-column.
--   Une seule table `entities` stocke toutes les entités de tous
--   les artefacts (programs, briefs, qr_codes, clauses…).
--   Avantage : ajouter une entité = nouveau `type` string, ZÉRO
--   migration. Si une entité a besoin de requêtes complexes plus
--   tard, on l'extrait dans sa propre table.
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote \
--     --file=./migrations/001_data_fabric.sql
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS entities (
  id          TEXT NOT NULL,                  -- UUID v4 (client-generated)
  tenant_id   TEXT NOT NULL DEFAULT 'default',-- isolation tenant
  type        TEXT NOT NULL,                  -- 'programs' | 'briefs' | …
  data        TEXT NOT NULL,                  -- payload JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT,                           -- soft delete (NULL = actif)
  PRIMARY KEY (tenant_id, type, id)
);

-- Index pour les requêtes courantes (list par type, sync delta)
CREATE INDEX IF NOT EXISTS idx_entities_type_tenant
  ON entities(tenant_id, type);

CREATE INDEX IF NOT EXISTS idx_entities_updated
  ON entities(tenant_id, type, updated_at DESC);

-- Index partiel pour exclure rapidement les supprimées
CREATE INDEX IF NOT EXISTS idx_entities_active
  ON entities(tenant_id, type, updated_at DESC)
  WHERE deleted_at IS NULL;
