-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 002 · SDQR (Sprint SDQR-1)
-- Tables dédiées à l'artefact Sovereign Dynamic QR.
--
-- Pourquoi pas du JSON-in-column ?
--   - `qr_redirects` doit être interrogeable par short_id sans tenant
--     (la requête publique GET /r/<id> ne connaît pas le tenant).
--     PRIMARY KEY (short_id) + index O(1).
--   - `qr_scans` est append-only haute fréquence (potentiellement des
--     milliers de lignes par QR) — table dédiée avec index temporel.
--
-- La métadonnée du QR (design SVG, payload, nom, tags) reste stockée
-- dans `entities` en type='qr_codes' (data fabric standard, synchro
-- Dexie offline-first comme tous les autres artefacts).
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote \
--     --file=./migrations/002_sdqr.sql
-- ═══════════════════════════════════════════════════════════════

-- ── Table de redirection (lookup public ultra-rapide) ──────────
-- Une ligne par QR dynamique. Mise à jour quand l'utilisateur change
-- la cible. Le Worker GET /r/<short_id> n'interroge QUE cette table.
CREATE TABLE IF NOT EXISTS qr_redirects (
  short_id    TEXT PRIMARY KEY,            -- nanoid(8), unique global
  qr_id       TEXT NOT NULL,               -- UUID du QR côté entities
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  target_url  TEXT NOT NULL,               -- URL de destination courante
  status      TEXT NOT NULL DEFAULT 'active',  -- active | archived
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_qr_redirects_tenant
  ON qr_redirects(tenant_id, status);

-- ── Table des scans (log append-only) ─────────────────────────
-- Aucune PII : pas d'IP brute, juste ua_hash (8 hex de sha-256(UA))
-- pour distinguer scans uniques sans tracer l'individu.
CREATE TABLE IF NOT EXISTS qr_scans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id    TEXT NOT NULL,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  country     TEXT,                        -- ex: 'FR' (depuis cf.country)
  device_kind TEXT,                        -- mobile | desktop | tablet | other
  os_kind     TEXT,                        -- ios | android | windows | macos | linux | other
  ua_hash     TEXT                         -- sha-256(UA) tronqué 8 hex
);

CREATE INDEX IF NOT EXISTS idx_qr_scans_short_ts
  ON qr_scans(short_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_qr_scans_short_country
  ON qr_scans(short_id, country);
