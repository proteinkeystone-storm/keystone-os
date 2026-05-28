-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 007 · Living Layer · Feedback loop
-- ─────────────────────────────────────────────────────────────
-- "Apprend ce qui t'intéresse." Compte par topic :
--   - impressions : nombre de fois où une phrase de ce topic a été
--     affichée (throttlé 5 min/topic côté client)
--   - engagements : nombre de fois où l'utilisateur a ouvert l'outil
--     correspondant peu après l'affichage (signal d'intérêt)
--
-- Le board ajuste alors le score de chaque candidat selon le ratio
-- engagement/impression du topic (pattern userReactions, Brainstorming
-- Sprint 7.8). Un topic ignoré apparaît moins, un topic engagé apparaît
-- plus. Borné ×0.6 à ×1.4, neutre sous 5 impressions.
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote \
--     --file=./migrations/007_living_feedback.sql
--
-- NB : routes/living-layer-board.js exécute aussi ce statement en
-- auto-migration (ensureFeedbackSchema, pattern Keystone).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS living_feedback (
  tenant_id   TEXT NOT NULL,                       -- claims.sub (hash licence)
  topic       TEXT NOT NULL,                        -- smartqr|pulsa|annonces|kodex|brainstorming|ghostwriter|ambiance
  impressions INTEGER NOT NULL DEFAULT 0,
  engagements INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, topic)
);
