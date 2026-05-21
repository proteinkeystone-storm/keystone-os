-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration Sprint S1 (Auth v2)
-- ═══════════════════════════════════════════════════════════════
-- DATE     : 2026-05-21
-- OBJECTIF : Support multi-email pour plan MAX (1 clé partagée par
--            les emails @meme-domaine.com). STARTER/PRO restent
--            mono-email avec devices_max = 1 / 3.
--
-- DISCIPLINE :
--   - Purement ADDITIF. Aucun DROP, RENAME ou ALTER destructif.
--   - Toutes les colonnes ajoutées sont NULLABLE → zéro downtime.
--   - Auto-migré au boot par ensureSchemaAuthV2() dans
--     workers/src/routes/licence-v2.js (pattern CREATE IF NOT EXISTS
--     + PRAGMA table_info pour les ALTER conditionnels).
--   - Backward compat : le code v1 (routes existantes) ignore ces
--     nouvelles colonnes/tables. Aucun appel à requireAdmin /
--     requireDevice / requireJWT n'est modifié en S1.
--
-- À EXÉCUTER (optionnel, normalement auto-migré) :
--   wrangler d1 execute keystone-os --remote --file=./src/db/migration_sprint_s1.sql
-- ═══════════════════════════════════════════════════════════════

-- ── 1. licences : domain_locked + devices_max (NULLABLE) ─────
-- domain_locked  : pour MAX uniquement, ex "@protein-studio.fr"
-- devices_max    : 1 (STARTER), 3 (PRO), NULL = illimité (MAX/ADMIN/DEMO)
ALTER TABLE licences ADD COLUMN domain_locked TEXT;
ALTER TABLE licences ADD COLUMN devices_max  INTEGER;

-- ── 2. devices : licence_key explicite (NULLABLE pour rétrocompat) ─
-- Avant : devices.tenant_id seul (un device pouvait potentiellement
-- pointer vers une licence non identifiée).
-- Après : devices.licence_key référence directement la licence
-- propriétaire. NULL = device legacy non encore migré (le code
-- runtime fait la résolution paresseuse).
ALTER TABLE devices ADD COLUMN licence_key TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_licence_key ON devices(licence_key);

-- ── 3. licence_emails : table de jointure 1-N (cœur du modèle v2) ─
-- Liste des emails autorisés sur une licence.
--   STARTER/PRO : 0 ou 1 entrée (validée à l'insert).
--   MAX         : N entrées, toutes du même domaine que domain_locked.
--
-- role :
--   - 'owner'   = l'email qui a activé la 1re fois (peut inviter).
--   - 'member'  = invité par l'owner (MAX uniquement).
--
-- status :
--   - 'active'  = email pleinement utilisable (peut activer un device).
--   - 'pending' = invité, magic-link envoyé, pas encore activé.
--   - 'revoked' = retiré par l'owner (devices associés deviennent
--                 inactifs, mais on garde l'historique pour audit).
CREATE TABLE IF NOT EXISTS licence_emails (
  id            TEXT PRIMARY KEY,                    -- UUID v4
  licence_key   TEXT NOT NULL,
  email         TEXT NOT NULL,                       -- lowercase, validé regex
  role          TEXT NOT NULL DEFAULT 'owner',       -- 'owner' | 'member'
  status        TEXT NOT NULL DEFAULT 'active',      -- 'active' | 'pending' | 'revoked'
  invited_by    TEXT,                                -- email du membre owner qui a invité (NULL si owner initial)
  invited_at    TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at  TEXT,
  revoked_at    TEXT,
  FOREIGN KEY (licence_key) REFERENCES licences(key)
);

-- Un email ne peut apparaître qu'une seule fois par licence
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_emails_unique
  ON licence_emails(licence_key, email);

CREATE INDEX IF NOT EXISTS idx_licence_emails_status
  ON licence_emails(status);

CREATE INDEX IF NOT EXISTS idx_licence_emails_email
  ON licence_emails(email);

-- ═══════════════════════════════════════════════════════════════
-- NOTES :
--
-- Backfill des licences existantes :
--   Au runtime, lorsqu'une route v2 (/api/licence/me, /claim, etc.)
--   est appelée pour une licence sans entry dans licence_emails, on
--   crée à la volée une entry 'owner' à partir de licences.owner
--   (si owner ressemble à un email). Sinon, le user passera par
--   /api/licence/claim pour poser son email avant tout.
--
-- Cohérence avec devices.email :
--   La col devices.email existe depuis schema.sql v1.0. On l'utilise
--   désormais comme clé de binding effective. licence_emails est la
--   source de vérité de qui est autorisé ; devices.email + devices.licence_key
--   est l'instance concrète d'un binding (cet email sur cet appareil).
--
-- Aucune mention de Stripe ici : c'est S5 (dashboard admin + audit).
-- ═══════════════════════════════════════════════════════════════
