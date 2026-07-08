-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration networK (Pad O-NET-001 · NK-2)
--   wrangler d1 execute keystone-os --remote --file=./src/db/migration_network.sql
--
-- Réseau relationnel vivant (PAS un CRM). V1 100 % manuelle, ZÉRO IA.
-- « Vous » → catégories libres → contacts. Journal d'activité manuel
-- (source='manual') dont les routes arrivent en NK-5.
--
-- ISOLATION : aucune table partagée avec les autres pads. Préfixe nk_.
--
-- Conventions (reprises de migration_keynapse.sql) :
--   TEXT PRIMARY KEY (UUID stable), tenant_id FK → tenants(id) (créé à
--   la volée via _ensureTenant côté route), datetime('now') en défaut,
--   CREATE ... IF NOT EXISTS partout. Le schéma est AUSSI auto-appliqué
--   au 1er appel côté route (pattern keynapse) : ce fichier reste la
--   source de vérité documentaire.
-- ═══════════════════════════════════════════════════════════════

-- ── Catégories libres (Clients, Fournisseurs… — créées par l'utilisateur) ──
CREATE TABLE IF NOT EXISTS nk_categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  label TEXT NOT NULL,
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_nk_categories_tenant ON nk_categories(tenant_id);

-- ── Contacts (id UUID STABLE : clé de jointure future inter-pads) ──
CREATE TABLE IF NOT EXISTS nk_contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  category_id TEXT,                          -- nullable : orphelin si catégorie supprimée
  kind TEXT NOT NULL DEFAULT 'person',       -- person | company | place | group
  name TEXT NOT NULL,
  company TEXT, title TEXT, email TEXT, phone TEXT,
  phone2 TEXT,                               -- 2ᵉ téléphone
  website TEXT,                              -- URL de site
  address TEXT,                              -- adresse / lieu (map via lien maps)
  socials TEXT NOT NULL DEFAULT '[]',        -- JSON [{"type":"linkedin","url":"…"}, …]
  photo TEXT,                                -- photo manuelle = data URL image base64 (~200px)
                                             --   (auto : logo société via domaine, calculé côté client, non stocké)
  birthday TEXT,                             -- 'YYYY-MM-DD' (option) ; rappel annuel (mois+jour) dans le Living Layer
  roles TEXT NOT NULL DEFAULT '[]',          -- JSON ["Client", …]
  tags  TEXT NOT NULL DEFAULT '[]',          -- JSON ["Important", …]
  notes TEXT NOT NULL DEFAULT '',
  photo_key TEXT,                            -- R2 (upload photo = P2, optionnel)
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_nk_contacts_tenant ON nk_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nk_contacts_cat ON nk_contacts(tenant_id, category_id);

-- ── Migration additive (tables déjà en prod) : ADD COLUMN idempotent ──
-- SQLite n'a pas « ADD COLUMN IF NOT EXISTS » ; côté route, _ensureSchema
-- teste PRAGMA table_info avant d'ajouter. En SQL manuel, ignorer l'erreur
-- « duplicate column » si la colonne existe déjà.
--   ALTER TABLE nk_contacts ADD COLUMN phone2 TEXT;
--   ALTER TABLE nk_contacts ADD COLUMN website TEXT;
--   ALTER TABLE nk_contacts ADD COLUMN address TEXT;
--   ALTER TABLE nk_contacts ADD COLUMN socials TEXT NOT NULL DEFAULT '[]';
--   ALTER TABLE nk_contacts ADD COLUMN photo TEXT;
--   ALTER TABLE nk_contacts ADD COLUMN birthday TEXT;

-- ── Journal d'activité (manuel en V1 ; source prêt pour l'auto en couche 2) ──
CREATE TABLE IF NOT EXISTS nk_activity (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  contact_id TEXT NOT NULL,
  type TEXT NOT NULL,                        -- call | email | meeting | quote | doc | note | other
  label TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',     -- 'manual' en V1 ; padId quand l'auto arrivera
  happened_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_nk_activity_contact ON nk_activity(tenant_id, contact_id);
