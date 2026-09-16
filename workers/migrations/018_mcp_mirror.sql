-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 018 · MCP sprint 5 : le Reflet chiffré par jeton
-- (HANDOFF_MCP_CLAUDE §4 sprint 5 · MCP_TOUS_LES_OUTILS_BRIEF §3)
--
-- Claude lit Brainstorming, Ghost Writer et le composer Social SANS onglet
-- ouvert, sans que la base contienne rien de lisible au repos :
--   · le SECRET DE CONNEXION naît désormais DANS LE NAVIGATEUR au
--     consentement (connect.html), voyage jusqu'au Worker chiffré avec
--     KS_ENCRYPTION_KEY dans oauth_codes le temps de l'échange du code
--     (≤ 10 min, usage unique, puis effacé), et repart dans les jetons
--     remis à Claude (ksa_<aléa>.<secret>). Seul son hash reste.
--   · le navigateur (app/mirror.js) publie, pour chaque connexion dont il
--     connaît le secret et pour chaque pad autorisé par l'utilisateur, un
--     REFLET chiffré AES-GCM avec une clé dérivée de ce secret. 64 Ko max.
--   · à l'appel, le Worker dérive la clé DEPUIS LE JETON PRÉSENTÉ, déchiffre
--     en mémoire, répond, oublie. Révoquer la connexion efface ses reflets.
--
--   mcp_mirror — un reflet par (compte, connexion, pad).
--   oauth_codes.secret_enc / secret_iv — le secret chiffré, transitoire.
--   mcp_connections.request_id — lie la connexion à la demande de
--     consentement : c'est ainsi que le navigateur retrouve le secret
--     qu'il a généré (ks_mcp_mirror_secrets[request_id]).
--
-- ⚠ ALTER TABLE n'est pas idempotent en SQLite : appliquer UNE fois
--   (le Worker fait les mêmes ajouts à la volée, gardés).
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote --file=./migrations/018_mcp_mirror.sql
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mcp_mirror (
  sub             TEXT NOT NULL,
  connection_id   TEXT NOT NULL,
  pad             TEXT NOT NULL,                       -- brainstorming | ghostwriter | social
  ciphertext      TEXT NOT NULL,                       -- base64, AES-256-GCM
  iv              TEXT NOT NULL,                       -- base64, 12 octets
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (sub, connection_id, pad)
);
CREATE INDEX IF NOT EXISTS idx_mcp_mirror_conn ON mcp_mirror(connection_id);

ALTER TABLE oauth_codes     ADD COLUMN secret_enc TEXT;
ALTER TABLE oauth_codes     ADD COLUMN secret_iv  TEXT;
ALTER TABLE mcp_connections ADD COLUMN request_id TEXT;
