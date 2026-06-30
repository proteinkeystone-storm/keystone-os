-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — migration 012 : témoignages / avis clients
-- ─────────────────────────────────────────────────────────────
-- Réservoir d'avis ISOLÉ (aucun lien avec app_ratings ni Key Form).
-- Collecte via la page publique /avis + l'entonnoir in-app.
-- Rien n'est public tant qu'un admin n'a pas mis status='published'
-- ET que consent_publish = 1. RGPD : email jamais renvoyé au public.
--
-- Appliquer :
--   wrangler d1 execute keystone-os --remote --file=./migrations/012_testimonials.sql
-- (La route crée aussi la table en idempotent au 1er appel — ceci est la
--  source canonique du schéma.)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS testimonials (
  id              TEXT PRIMARY KEY,
  author_name     TEXT,                       -- prénom / nom affiché (optionnel)
  author_role     TEXT,                       -- métier / entreprise (optionnel)
  author_email    TEXT,                       -- privé, jamais renvoyé au public
  rating          INTEGER,                    -- 1-5 (optionnel)
  body            TEXT NOT NULL,              -- le texte de l'avis
  source          TEXT NOT NULL DEFAULT 'avis-page',  -- 'avis-page' | 'in-app'
  consent_publish INTEGER NOT NULL DEFAULT 0, -- 1 = l'auteur autorise la publication
  status          TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'published' | 'rejected'
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  published_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_testimonials_status  ON testimonials(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_testimonials_created ON testimonials(created_at DESC);
