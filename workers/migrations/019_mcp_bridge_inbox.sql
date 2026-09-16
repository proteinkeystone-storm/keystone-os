-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 019 · MCP sprint 4 bis : repli Web Push du Pont
-- Un ordre mis en file après une notification push porte l'id de la
-- proposition de bannette jumelle : l'onglet ouvert par le clic exécute
-- l'ordre puis marque la proposition appliquée (pas de doublon).
-- ⚠ ALTER TABLE non idempotent : appliquer UNE fois (le Worker fait le
--   même ajout à la volée, gardé).
--   wrangler d1 execute keystone-os --remote --file=./migrations/019_mcp_bridge_inbox.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE mcp_jobs ADD COLUMN inbox_id TEXT;
