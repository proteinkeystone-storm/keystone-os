-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 006 · Living Layer · Mémoire des chiffres
-- ─────────────────────────────────────────────────────────────
-- Snapshot quotidien des métriques cumulées par propriétaire (tenant).
-- Permet à l'ordinateur de bord de calculer des TENDANCES réelles :
--   « +40 % de scans vs la semaine dernière »
--   « 12 nouveaux scans depuis hier »
--   « record du mois »
--
-- Pattern : 1 ligne par (tenant, jour). On stocke les CUMULS (totaux)
-- au format JSON. Les deltas se calculent par différence entre deux
-- snapshots (J vs J-1, J vs J-7). Snapshot écrit en "lazy" au premier
-- appel /board du jour (INSERT OR IGNORE, idempotent).
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote \
--     --file=./migrations/006_living_metrics.sql
--
-- NB : routes/living-layer-board.js exécute aussi ces statements en
-- auto-migration (ensureMetricsSchema, pattern Keystone).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS living_metrics_daily (
  tenant_id   TEXT NOT NULL,                       -- claims.sub (hash licence)
  day         TEXT NOT NULL,                        -- 'YYYY-MM-DD' UTC
  metrics     TEXT NOT NULL,                        -- JSON cumuls {scansTotal, pulsaResponsesTotal, codexBriefs, ...}
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, day)
);

-- Index pour lire l'historique récent d'un tenant (tendances).
CREATE INDEX IF NOT EXISTS idx_living_metrics_tenant_day
  ON living_metrics_daily(tenant_id, day DESC);
