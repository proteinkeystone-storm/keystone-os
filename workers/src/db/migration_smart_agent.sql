-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration Smart Agent / Kortex (écrite au Sprint SA-0,
-- appliquée au Sprint SA-1) :
--   wrangler d1 execute keystone-os --remote --file=./src/db/migration_smart_agent.sql
--
-- DOCTRINE (contenant/contenu) : le moteur est générique — AUCUNE
-- logique métier ici. Le savoir (contenu) vit dans kortex_units,
-- par tenant. Un « vendeur » et un « gardien de musée » = le même
-- schéma, seules les fiches diffèrent.
--
-- Conventions reprises de schema.sql / migration_social.sql :
--   TEXT PRIMARY KEY (UUID), tenant_id FK → tenants(id) (créé à la
--   volée via _ensureTenant côté route), datetime('now') en défaut,
--   CREATE ... IF NOT EXISTS partout (ré-exécutable sans danger).
-- ═══════════════════════════════════════════════════════════════

-- ── Kortex : collections — RETIRÉ (SA-4.4.4) ──────────────────
-- L'étage « collections » (kortex_collections + config.knowledge.collection_ids)
-- a été remplacé par les COFFRES découplés (vault_id, SA-4.4). Le CRUD et la
-- création de table ont été retirés du code applicatif. Une table physique
-- éventuellement déjà créée en base est laissée inerte (aucun DROP destructif).

-- ── Kortex : unités de savoir typées — L'ACTIF ────────────────
-- body      : JSON structuré selon le gabarit du type :
--   fact       { statement, context? }
--   procedure  { goal, steps[], warnings? }
--   qa         { question, answer }
--   case       { situation, action, result }
--   rule       { rule, rationale?, exceptions? }
--   objection  { objection, response, proof? }
--   definition { term, definition }
-- body_text : aplat textuel du body (titre inclus côté FTS) —
--   maintenu par le code à chaque écriture, sert au lexical FTS5.
-- status    : draft → validated (indexée/servie) ; quarantine =
--   retirée du service (péremption, conflit) ; expired = archivée.
-- review_at : date de revalidation (NULL = savoir intemporel) ;
--   le cron quotidien passera les fiches échues en quarantine (SA-6).
CREATE TABLE IF NOT EXISTS kortex_units (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  type          TEXT NOT NULL CHECK (type IN
                  ('fact','procedure','qa','case','rule','objection','definition')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  body_text     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                  ('draft','validated','quarantine','expired')),
  source_kind   TEXT DEFAULT 'manual',        -- manual|paste|interview|gap|import
  source_ref    TEXT,                          -- libellé/URL de la source d'origine
  lang          TEXT DEFAULT 'fr',
  review_at     TEXT,                          -- ISO date (NULL = intemporel)
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_kortex_units_tenant  ON kortex_units(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kortex_units_status  ON kortex_units(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_kortex_units_type    ON kortex_units(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_kortex_units_review  ON kortex_units(review_at);

-- ── Kortex : index lexical FTS5 (recherche hybride, SA-2) ─────
-- Table autonome maintenue par le code (insert à la validation,
-- delete en quarantaine/suppression). unit_id non indexé = clé de
-- jointure vers kortex_units. Le tenant est REVÉRIFIÉ à la jointure
-- (jamais de réponse servie sur la seule foi de la FTS).
CREATE VIRTUAL TABLE IF NOT EXISTS kortex_units_fts USING fts5(
  unit_id UNINDEXED,
  title,
  body_text
);

-- ── Smart Agent : les agents (config en couches) ──────────────
-- config : JSON des couches — identity { name, mission, tone, persona },
--   scope { refusals[], fallback_text }, knowledge { collection_ids[] },
--   context { qr_mappings }, runtime { threshold, max_units, model? }.
-- La couche runtime reste pilotée par la plateforme (plans/licence) ;
-- le reste appartient au tenant. Versionnée pour rollback (SA-4+).
CREATE TABLE IF NOT EXISTS sa_agents (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused')),
  config      TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_sa_agents_tenant ON sa_agents(tenant_id);

-- ── Smart Agent : sessions de dialogue ────────────────────────
-- channel : internal (client connecté, SA-3) | public (QR/lien, SA-5).
-- context : JSON injecté à l'entrée (SDQR : salle, produit, langue…) —
--   sert de filtre de récupération, jamais de source de vérité.
CREATE TABLE IF NOT EXISTS sa_sessions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  agent_id    TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'internal' CHECK (channel IN ('internal','public')),
  context     TEXT DEFAULT '{}',
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (agent_id)  REFERENCES sa_agents(id)
);
CREATE INDEX IF NOT EXISTS idx_sa_sessions_tenant ON sa_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sa_sessions_agent  ON sa_sessions(agent_id);

-- ── Smart Agent : messages ────────────────────────────────────
-- citations : JSON [{unit_id, title, score}] — la traçabilité de
-- l'ancrage (chaque affirmation métier cite sa fiche).
-- grounding : score de confiance de la récupération (calibrage du
-- seuil de repli « Je ne dispose pas de cette information »).
CREATE TABLE IF NOT EXISTS sa_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  role        TEXT NOT NULL CHECK (role IN ('user','agent')),
  content     TEXT NOT NULL,
  citations   TEXT,
  grounding   REAL,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sa_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_sa_messages_session ON sa_messages(session_id);

-- ── Smart Agent : les trous (acquisition gap-driven) ──────────
-- Chaque question sous le seuil de confiance est journalisée ici :
-- c'est la FILE DE TRAVAIL de l'expert (« Répondre » → crée une fiche
-- kortex pré-remplie → unit_id la relie). hits = récurrence (priorité).
CREATE TABLE IF NOT EXISTS sa_gaps (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL DEFAULT 'default',
  agent_id        TEXT,
  question        TEXT NOT NULL,
  question_norm   TEXT NOT NULL,               -- normalisée (dédoublonnage)
  hits            INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dismissed')),
  unit_id         TEXT,                         -- fiche créée en réponse
  first_asked_at  TEXT DEFAULT (datetime('now')),
  last_asked_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_sa_gaps_tenant ON sa_gaps(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sa_gaps_norm   ON sa_gaps(tenant_id, question_norm);
