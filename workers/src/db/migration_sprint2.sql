-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration Sprint 2 · Sécurité backend
-- ═══════════════════════════════════════════════════════════════
-- À exécuter UNE SEULE FOIS via :
--   wrangler d1 execute keystone-os --file=./src/db/migration_sprint2.sql
--
-- Effets :
--  - Ajoute hash + salt + blind index sur la table licences
--  - Ajoute device_fingerprint pour le binding First-Use
--  - Crée la table activation_attempts pour le rate limiting
-- ═══════════════════════════════════════════════════════════════

-- ── licences : nouveaux champs sécurité ────────────────────────
ALTER TABLE licences ADD COLUMN lookup_hmac        TEXT;
ALTER TABLE licences ADD COLUMN key_hash           TEXT;
ALTER TABLE licences ADD COLUMN salt               TEXT;
ALTER TABLE licences ADD COLUMN device_fingerprint TEXT;
ALTER TABLE licences ADD COLUMN activated_at       TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_licences_lookup ON licences(lookup_hmac);

-- ── Rate limiting (Sprint 2.3) ─────────────────────────────────
-- Une ligne par fingerprint/IP. La pénalité backoff est exponentielle :
--   blocked_until = now + 2^attempts secondes (cap 1h)
-- Reset à 0 après une activation réussie.
CREATE TABLE IF NOT EXISTS activation_attempts (
  fingerprint   TEXT PRIMARY KEY,           -- empreinte appareil OU IP
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt  INTEGER NOT NULL DEFAULT 0, -- unix epoch ms
  blocked_until INTEGER NOT NULL DEFAULT 0  -- unix epoch ms
);
CREATE INDEX IF NOT EXISTS idx_attempts_blocked ON activation_attempts(blocked_until);
