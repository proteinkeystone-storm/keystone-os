-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 005 · Living Layer V2 (Ordinateur de bord)
-- ─────────────────────────────────────────────────────────────
-- Table dédiée aux messages "Pilotables" (annonces, promos, alertes)
-- que Stéphane pousse depuis l'admin pour qu'ils prennent la main sur
-- la zone unique Living Layer du dashboard.
--
-- Différent de la table `messages` existante (DST = pop-ups dismissables) :
-- ici les living_messages sont des phrases COURTES rotatives dans le hero,
-- avec priorité + fenêtre temporelle + audience par plan.
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote \
--     --file=./migrations/005_living_layer.sql
--
-- NB : routes/living-layer-board.js exécute aussi ces statements en
-- auto-migration (ensureLivingSchema, pattern Keystone).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS living_messages (
  id           TEXT PRIMARY KEY,
  text         TEXT NOT NULL,                       -- max 120 chars (1 phrase)
  priority     INTEGER NOT NULL DEFAULT 50,         -- 0-100, 80+ = URGENT
  start_at     TEXT NOT NULL,                       -- ISO datetime, début de validité
  end_at       TEXT NOT NULL,                       -- ISO datetime, fin de validité
  audience     TEXT NOT NULL DEFAULT 'all',         -- 'all'|'demo'|'starter'|'pro'|'max'
  status       TEXT NOT NULL DEFAULT 'active',      -- 'draft'|'active'|'archived'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT                                  -- email/handle de l'admin auteur
);

-- Index pour la requête principale du board : messages actifs dans la
-- fenêtre temporelle, triés par priorité décroissante.
CREATE INDEX IF NOT EXISTS idx_living_messages_active
  ON living_messages(status, start_at, end_at, priority DESC);

-- Index pour la liste admin (tri par date de création décroissante).
CREATE INDEX IF NOT EXISTS idx_living_messages_created
  ON living_messages(created_at DESC);
