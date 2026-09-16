-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 015 · MCP sprint 2 : OAuth 2.1 pour Claude
-- (HANDOFF_MCP_CLAUDE §4 sprint 2 · MCP_TOUS_LES_OUTILS_BRIEF §3 étape 1)
--
-- Quatre tables, toutes SANS donnée en clair qui vaille un jeton :
--   oauth_clients    — clients enregistrés par DCR (RFC 7591). Un
--                      client public n'a pas de secret ; quand un client
--                      en demande un, seul son SHA-256 est conservé.
--   oauth_codes      — une ligne par demande d'autorisation : créée à
--                      /oauth/authorize (état « pending », porte le défi
--                      PKCE), complétée au consentement (sub, hash du
--                      code), consommée UNE fois à /oauth/token (UPDATE
--                      gardé, anti-course, comme magic_links).
--   mcp_connections  — une ligne par consentement abouti : c'est ce que
--                      la tuile « Connecteur IA » liste et révoque. Porte
--                      le hash du SECRET DE CONNEXION (brief §3) : révoquer
--                      = détruire ce hash, les reflets futurs deviennent
--                      illisibles sans même être effacés.
--   mcp_tokens       — jetons d'accès (1 h) et de rafraîchissement
--                      (90 j, rotatifs) : hash SHA-256 seulement, jamais
--                      le jeton. Un refresh déjà tourné et représenté =
--                      réutilisation → toute la connexion est révoquée.
--
-- Isolation : `sub` = lookup_hmac de la licence (= JWT.sub), comme
-- partout. Aucune de ces tables ne porte de tenant_id : le tenant est
-- tranché par les routes que le MCP rappelle, jamais ici.
-- Minimisation : e-mail et plan sont conservés sur la connexion pour
-- que la tuile dise « autorisé avec tel compte » (le piège tenant du
-- 16/09) ; pas d'IP, pas de User-Agent.
-- Rétention : codes purgés 1 h après expiration, jetons expirés purgés,
-- connexions révoquées purgées à 30 j, clients DCR jamais utilisés
-- purgés à 30 j (cron 0 3 * * *).
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote --file=./migrations/015_mcp_oauth.sql
-- (le Worker crée aussi ces tables à la volée : la migration est
--  idempotente et sert de référence lisible)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id            TEXT PRIMARY KEY,
  client_name          TEXT NOT NULL,
  redirect_uris        TEXT NOT NULL,                      -- JSON [..]
  grant_types          TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  auth_method          TEXT NOT NULL DEFAULT 'none',       -- none | client_secret_post | client_secret_basic
  secret_hash          TEXT,                               -- SHA-256 du client_secret, sinon NULL
  client_uri           TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at         TEXT
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  id                   TEXT PRIMARY KEY,                   -- identifiant de la demande (capability, 32 octets)
  client_id            TEXT NOT NULL,
  redirect_uri         TEXT NOT NULL,
  scope                TEXT NOT NULL,
  state                TEXT,
  code_challenge       TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  resource             TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',    -- pending | issued | consumed | denied
  sub                  TEXT,                               -- posé au consentement
  licence_key          TEXT,
  email                TEXT,
  code_hash            TEXT,                               -- SHA-256 du code, posé au consentement
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at           TEXT NOT NULL,
  consumed_at          TEXT,
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_codes_hash    ON oauth_codes(code_hash);
CREATE INDEX        IF NOT EXISTS idx_oauth_codes_expires ON oauth_codes(expires_at);

CREATE TABLE IF NOT EXISTS mcp_connections (
  id                   TEXT PRIMARY KEY,
  sub                  TEXT NOT NULL,                      -- lookup_hmac de la licence (= JWT.sub)
  licence_key          TEXT NOT NULL,
  email                TEXT,
  plan_at_consent      TEXT,
  client_id            TEXT NOT NULL,
  client_name          TEXT NOT NULL,
  redirect_host        TEXT,
  scope                TEXT NOT NULL,
  secret_hash          TEXT,                               -- hash du secret de connexion (brief §3) ; NULL = révoquée
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at         TEXT,
  revoked_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_connections_sub ON mcp_connections(sub, revoked_at);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id                   TEXT PRIMARY KEY,
  connection_id        TEXT NOT NULL,
  kind                 TEXT NOT NULL,                      -- access | refresh
  token_hash           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at           TEXT NOT NULL,
  rotated_at           TEXT,                               -- refresh : date de rotation (représenté ensuite = réutilisation)
  FOREIGN KEY (connection_id) REFERENCES mcp_connections(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tokens_hash    ON mcp_tokens(token_hash);
CREATE INDEX        IF NOT EXISTS idx_mcp_tokens_conn    ON mcp_tokens(connection_id, kind);
CREATE INDEX        IF NOT EXISTS idx_mcp_tokens_expires ON mcp_tokens(expires_at);
