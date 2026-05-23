-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 004 · Ghost Writer Phase 2 (quota serveur)
-- ─────────────────────────────────────────────────────────────
-- Quota Gemma 4 / Workers AI désormais comptabilisé par licence
-- côté serveur, jour glissant UTC. Avant : hard-limit 50/jour
-- en localStorage (contournable par vidage cache ou autre device).
--
-- Grille (cohérente avec licence-v2.js _devicesMaxForPlan) :
--   DEMO     →  1 appel/jour
--   STARTER  →  3 appels/jour
--   PRO      → 10 appels/jour
--   MAX      → 50 appels/jour
--   ADMIN    → illimité (count est trackée mais jamais bloquée)
--
-- Identifiant : lookup_hmac (claims.sub du JWT licence). Stable, ne
-- révèle pas la clé en clair. Aligné avec auth-magic-link / vault.
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote \
--     --file=./migrations/004_ghostwriter_quota.sql
--
-- NB : routes/ghostwriter.js exécute aussi ces statements en
-- auto-migration (ensureGhostwriterSchema, pattern Keystone).
-- Cette migration sert d'historique versionné + setup propre.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ghostwriter_usage (
  lookup_hmac  TEXT NOT NULL,
  day          TEXT NOT NULL,            -- 'YYYY-MM-DD' UTC
  count        INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (lookup_hmac, day)
);

-- Index secondaire pour purge éventuelle par jour ancien.
CREATE INDEX IF NOT EXISTS idx_ghostwriter_usage_day
  ON ghostwriter_usage(day);
