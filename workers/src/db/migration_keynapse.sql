-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration Keynapse (Pad O-Keyn-001 · KN-0)
--   wrangler d1 execute keystone-os --remote --file=./src/db/migration_keynapse.sql
--
-- Espace personnel de connaissances : des bulles de notes sur un
-- canevas infini, regroupées en zones colorées (dossiers virtuels
-- sans contour), reliées par des traits simples.
--
-- ISOLATION : aucune table partagée avec Smart Agent (sa_*, kortex_*)
-- ni Key Form (pulsa_*). Préfixe dédié kn_.
--
-- Conventions (reprises de migration_smart_agent.sql) :
--   TEXT PRIMARY KEY (UUID), tenant_id FK → tenants(id) (créé à la
--   volée via _ensureTenant côté route), datetime('now') en défaut,
--   CREATE ... IF NOT EXISTS partout. Le schéma est AUSSI auto-appliqué
--   au 1er appel côté route (pattern ai-credits / Smart Agent) : ce
--   fichier reste la source de vérité documentaire.
-- ═══════════════════════════════════════════════════════════════

-- ── Zones : dossiers virtuels (cohésion + couleur partagée) ─────
-- Pas de contour dessiné côté front : une zone se lit par la couleur
-- partagée de ses bulles + leur proximité (cohésion). Sprint 3.
CREATE TABLE IF NOT EXISTS kn_zones (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_kn_zones_tenant ON kn_zones(tenant_id);

-- ── Bulles : conteneurs de note (position persistée x/y) ────────
-- zone_id NULL = bulle libre (teinte neutre). color : surchargeable
-- par bulle (sinon héritée de la zone côté front).
CREATE TABLE IF NOT EXISTS kn_bubbles (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  zone_id     TEXT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT,
  icon        TEXT,
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_kn_bubbles_tenant ON kn_bubbles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kn_bubbles_zone   ON kn_bubbles(tenant_id, zone_id);

-- ── Liens : traits simples entre deux bulles (paire) ────────────
-- Pas d'épaisseur ni de nœuds (vs Trait d'union) : un lien = un trait.
CREATE TABLE IF NOT EXISTS kn_links (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  from_bubble TEXT NOT NULL,
  to_bubble   TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_kn_links_tenant ON kn_links(tenant_id);

-- ── To-do : actions d'une bulle (progression) ──────────────────
CREATE TABLE IF NOT EXISTS kn_todos (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  bubble_id   TEXT NOT NULL,
  label       TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_kn_todos_bubble ON kn_todos(tenant_id, bubble_id);

-- ── Rappels : date/heure/répétition + notification ─────────────
CREATE TABLE IF NOT EXISTS kn_reminders (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  bubble_id   TEXT NOT NULL,
  at          TEXT NOT NULL,
  repeat      TEXT,
  notified_at TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_kn_reminders_bubble ON kn_reminders(tenant_id, bubble_id);

-- ── Médias : photo / dessin / audio / note libre ───────────────
-- r2_key : objet R2 (préfixe keynapse/<tenant>/…, Sprint 5) ;
-- transcript : texte d'un audio (Whisper, Sprint 6) ; body : note
-- libre / légende.
CREATE TABLE IF NOT EXISTS kn_media (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  bubble_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('photo','drawing','audio','note')),
  r2_key      TEXT,
  transcript  TEXT,
  body        TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_kn_media_bubble ON kn_media(tenant_id, bubble_id);
