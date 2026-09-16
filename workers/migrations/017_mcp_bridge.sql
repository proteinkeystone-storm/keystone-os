-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 017 · MCP sprint 4 : le Pont
-- (HANDOFF_MCP_CLAUDE §4 sprint 4 · MCP_TOUS_LES_OUTILS_BRIEF §1)
--
-- L'onglet Keystone ouvert devient les mains de Claude : un outil qui
-- n'existe que dans le navigateur (localStorage, ouverture d'un pad,
-- pré-remplissage) n'est pas exécuté par le Worker mais DÉLÉGUÉ à
-- l'onglet du même compte, qui répond. Deux tables, sans tenant_id :
-- `sub` = lookup_hmac de la licence (= JWT.sub), comme partout.
--
--   mcp_bridge_presence — un battement par onglet connecté au canal
--                         GET /api/mcp/bridge/stream (toutes les 20 s).
--                         « En ligne » = vu il y a moins de 40 s.
--   mcp_jobs            — un ordre par appel d'outil navigateur :
--                         pending → dispatched (poussé sur le canal, UPDATE
--                         gardé : un seul onglet le reçoit) → done | failed
--                         (POST /api/mcp/bridge/jobs/:id/result, une seule
--                         réponse) | expired (le Worker a cessé d'attendre :
--                         ≤ 25 s, puis bannette si l'outil le permet).
--                         L'onglet n'exécute QUE les actions de son
--                         catalogue (app/bridge-actions.js), jamais du code.
--
-- Rétention : jobs et présences purgés après 1 jour (cron 0 3 * * *).
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote --file=./migrations/017_mcp_bridge.sql
-- (le Worker crée aussi ces tables à la volée : migration idempotente,
--  référence lisible)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mcp_bridge_presence (
  sub            TEXT NOT NULL,
  tab_id         TEXT NOT NULL,
  connected_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (sub, tab_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_bridge_presence_seen ON mcp_bridge_presence(sub, last_seen);

CREATE TABLE IF NOT EXISTS mcp_jobs (
  id             TEXT PRIMARY KEY,                     -- kjb_…
  sub            TEXT NOT NULL,
  tool           TEXT NOT NULL,                        -- outil MCP appelant
  action         TEXT NOT NULL,                        -- id d'action du catalogue navigateur (bs.list_sessions…)
  args_json      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',      -- pending | dispatched | done | failed | expired
  result_json    TEXT,
  error          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at  TEXT,
  done_at        TEXT,
  expires_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_jobs_sub_status ON mcp_jobs(sub, status, expires_at);
