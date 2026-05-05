-- ════════════════════════════════════════════════════════════════
-- Sprint 4 — Vault utilisateur synchronisé serveur
-- ════════════════════════════════════════════════════════════════
-- Stocke un blob chiffré (AES-GCM) par utilisateur, indexé par
-- le `sub` du JWT (= lookup_hmac de la licence). Ne contient JAMAIS
-- la clé en clair, jamais d'index re-identifiant.
--
-- Le blob lui-même contient (côté client après décryption) :
--   { api: { anthropic, openai, gemini, ... }, prefs: { name, photo, ... } }
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_vaults (
  sub          TEXT PRIMARY KEY,           -- = lookup_hmac de la licence
  ciphertext   TEXT NOT NULL,              -- base64(AES-GCM)
  iv           TEXT NOT NULL,              -- base64(12 bytes)
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  size_bytes   INTEGER NOT NULL DEFAULT 0  -- garde-fou anti-abuse
);

CREATE INDEX IF NOT EXISTS idx_user_vaults_updated ON user_vaults(updated_at);
