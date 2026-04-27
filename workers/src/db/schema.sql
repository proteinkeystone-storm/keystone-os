-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Cloudflare D1 · Schema v1.0
-- Localisation : weur (Western Europe) — Privacy by Design
--
-- Commande d'initialisation :
--   wrangler d1 execute keystone-os --file=./src/db/schema.sql
-- ═══════════════════════════════════════════════════════════════

-- ── Tenants (entreprises clientes) ───────────────────────────
-- Isolation stricte : chaque société a son propre espace.
-- La Société A ne peut jamais lire les données de la Société B.
CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,               -- UUID v4
  name       TEXT NOT NULL,
  domain     TEXT UNIQUE,                    -- email pro : @promoteurxyz.fr
  plan       TEXT DEFAULT 'STARTER',         -- STARTER | PRO | MAX
  is_active  INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tenant par défaut (opérateur interne — toi)
INSERT OR IGNORE INTO tenants (id, name, domain, plan)
VALUES ('default', 'Protein Studio', 'proteinstudio.fr', 'MAX');

-- ── Licences ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licences (
  key          TEXT PRIMARY KEY,             -- XXXX-XXXX-XXXX-XXXX
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  owner        TEXT NOT NULL,                -- nom ou email
  plan         TEXT DEFAULT 'STARTER',
  is_active    INTEGER DEFAULT 1,
  owned_assets TEXT,                         -- JSON : ["O-IMM-001", "A-ANL-001"]
  expires_at   TEXT,                         -- ISO date ou NULL = illimité
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_licences_tenant   ON licences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_licences_active   ON licences(is_active);

-- ── Devices (tablettes / mobiles sans clé physique) ──────────
-- Flux : register → admin approuve → token envoyé → login
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,              -- UUID v4
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  label       TEXT NOT NULL,                 -- "iPad Terrain — Jean Dupont"
  type        TEXT DEFAULT 'tablet',         -- tablet | mobile | desktop
  email       TEXT NOT NULL,                 -- email du collaborateur
  token       TEXT UNIQUE NOT NULL,          -- HMAC-SHA256, 32 bytes hex
  is_approved INTEGER DEFAULT 0,             -- 0 = pending | 1 = approved
  approved_by TEXT,                          -- email de l'admin
  last_seen   TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_devices_tenant   ON devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_devices_token    ON devices(token);
CREATE INDEX IF NOT EXISTS idx_devices_approved ON devices(is_approved);

-- ── API Keys Vault (chiffrées AES-GCM) ───────────────────────
-- Les clés API (OpenAI, Anthropic…) ne sont JAMAIS stockées en clair.
CREATE TABLE IF NOT EXISTS api_keys_vault (
  id         TEXT PRIMARY KEY,              -- UUID v4
  tenant_id  TEXT NOT NULL DEFAULT 'default',
  provider   TEXT NOT NULL,                 -- anthropic | openai | google | mistral
  ciphertext TEXT NOT NULL,                 -- AES-GCM, base64
  iv         TEXT NOT NULL,                 -- vecteur d'initialisation, base64
  label      TEXT,                          -- label libre
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_vault_tenant ON api_keys_vault(tenant_id);

-- ── PADs (outils & artefacts) ─────────────────────────────────
-- Remplace le stockage par fichiers JSON statiques.
-- L'admin panel écrit ici ; pads-loader.js lit ici en priorité.
CREATE TABLE IF NOT EXISTS pads (
  id         TEXT PRIMARY KEY,              -- NOMEN-K : O-IMM-001
  tenant_id  TEXT NOT NULL DEFAULT 'default',
  data       TEXT NOT NULL,                -- JSON complet du PAD
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_pads_tenant ON pads(tenant_id);

-- ── Catalogue ─────────────────────────────────────────────────
-- Un seul enregistrement par tenant (JSON blob du catalog.json).
CREATE TABLE IF NOT EXISTS catalog (
  tenant_id  TEXT PRIMARY KEY DEFAULT 'default',
  data       TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
