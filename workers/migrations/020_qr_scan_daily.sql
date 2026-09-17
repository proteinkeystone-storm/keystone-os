-- ═══════════════════════════════════════════════════════════════
-- SDQR — HISTORIQUE DURABLE DES SCANS (migration 020, 2026-09-17)
-- ───────────────────────────────────────────────────────────────
-- Constat du 17/09/2026 : le journal brut `qr_scans` s'efface à 90 jours
-- (RGPD, cron « 0 3 * * * »). Conséquence non voulue : le compteur affiché
-- au client BAISSE. Une bâche de programme immobilier vit des années —
-- perdre le lancement de campagne est inacceptable commercialement.
--
-- Solution : un compteur JOURNALIER par QR, strictement ANONYME.
--   · aucune donnée personnelle : ni pays, ni appareil, ni empreinte de
--     navigateur, ni horodatage fin — juste « ce QR, ce jour, N scans » ;
--   · donc conservable sans limite, sans changer la politique de
--     rétention du journal brut (90 jours, inchangée) ;
--   · alimenté par consolidation des jours RÉVOLUS avant chaque purge
--     (lib/qr-history.js), jamais à la baisse.
--
-- `uniques` = nombre d'empreintes de navigateur distinctes CE JOUR-LÀ.
-- Cumulé sur plusieurs jours, il surestime les visiteurs distincts (un
-- visiteur revenu compte deux fois) : les écrans le disent.
--
-- Pas de tenant_id ici : la table est jointe par short_id à qr_redirects
-- (qui porte le tenant). Un effacement RGPD de tenant supprime aussi ces
-- lignes (routes/admin.js).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS qr_scan_daily (
  short_id   TEXT    NOT NULL,
  day        TEXT    NOT NULL,                      -- 'YYYY-MM-DD' (UTC)
  scans      INTEGER NOT NULL DEFAULT 0,
  uniques    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (short_id, day)
);

CREATE INDEX IF NOT EXISTS idx_qr_scan_daily_day ON qr_scan_daily(day);
