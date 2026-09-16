-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 016 · MCP sprint 3 : écritures + Bannette
-- (HANDOFF_MCP_CLAUDE §4 sprint 3 · MCP_TOUS_LES_OUTILS_BRIEF §2)
--
-- Deux tables, aucune ne porte de tenant_id : le tenant est tranché par
-- les routes que le MCP rappelle. `sub` = lookup_hmac de la licence
-- (= JWT.sub), comme partout.
--
--   mcp_confirmations — le pattern « aperçu → jeton → exécution » des
--                       écritures à confirmation (§3.3). Le jeton
--                       (kcf_…) n'est jamais stocké : SHA-256 seulement.
--                       Lié au compte (sub), à la connexion OAuth si
--                       elle existe, à l'outil ET aux arguments (hash
--                       canonique) : un aperçu confirmé ne peut exécuter
--                       que ce qui a été montré. TTL 5 min, usage unique
--                       (UPDATE gardé, anti-course).
--   mcp_inbox         — la Bannette : une proposition par écriture
--                       NAVIGATEUR (post Social, texte Ghost Writer,
--                       brainstorming, pré-remplissage d'un pad). Le
--                       Worker ne l'applique jamais : l'onglet Keystone
--                       la lit (GET /api/mcp/inbox), l'utilisateur
--                       l'ouvre (→ openTool(pad, opts)) ou l'ignore.
--                       `kind` = l'opts que openTool sait déjà recevoir.
--
-- Rétention : confirmations purgées 1 h après expiration ; propositions
-- expirées (30 j) ou résolues depuis 30 j purgées (cron 0 3 * * *).
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote --file=./migrations/016_mcp_writes.sql
-- (le Worker crée aussi ces tables à la volée : la migration est
--  idempotente et sert de référence lisible)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mcp_confirmations (
  id             TEXT PRIMARY KEY,
  token_hash     TEXT NOT NULL UNIQUE,                 -- SHA-256 du jeton kcf_…
  sub            TEXT NOT NULL,
  connection_id  TEXT,                                 -- NULL = JWT Keystone (Claude Code)
  tool           TEXT NOT NULL,
  args_hash      TEXT NOT NULL,                        -- SHA-256(outil + arguments canoniques, sans confirm_token)
  preview_json   TEXT,                                 -- l'aperçu montré (audit)
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT NOT NULL,
  used_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_confirmations_sub ON mcp_confirmations(sub, expires_at);

CREATE TABLE IF NOT EXISTS mcp_inbox (
  id               TEXT PRIMARY KEY,
  sub              TEXT NOT NULL,
  pad              TEXT NOT NULL,                      -- ID_KSTORE du pad cible (O-SOC-001…)
  kind             TEXT NOT NULL,                      -- compose | gw.rewrite | bs.session_seed | prefillData | createVcard
  payload_json     TEXT NOT NULL,                      -- l'opts, tel que openTool le recevra (≤ 16 Ko)
  summary          TEXT,                               -- une ligne lisible pour la bannette
  created_by_tool  TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',    -- pending | applied | dismissed
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at       TEXT NOT NULL,
  resolved_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_inbox_sub ON mcp_inbox(sub, status, expires_at);
