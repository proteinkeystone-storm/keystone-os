-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 009 · SCEAU jetons réutilisables (Sprint S4)
-- Pad O-SEC-001 — l'edge vs One-Time Secret jetable : un objet physique
-- (puce NFC / QR) rechargeable.
--
-- Principe (façon SDQR : pointeur stable ≠ contenu) :
--   - L'objet porte une URL STABLE /s/t/<token_id> (écrite UNE fois sur la puce).
--   - `current_short_id` pointe vers le secret ACTIF (table sec_secrets).
--   - « Recharger » = sceller un nouveau secret puis re-pointer le jeton,
--     SANS retoucher l'objet. Re-pointage = piloté serveur (dynamique).
--
-- Sécurité : chaque rechargement génère une NOUVELLE clé OPRF + une NOUVELLE
-- passphrase (cf. sec_secrets). Un ancien destinataire qui aurait gardé l'URL
-- ne peut pas lire le nouveau secret (sa passphrase ne dérive pas la nouvelle
-- clé). Limite assumée : tout possesseur physique de l'objet peut consommer des
-- essais sur le secret courant — c'est un objet qu'on contrôle.
--
-- Application : wrangler d1 execute keystone-os --remote --file=./migrations/009_sceau_tokens.sql
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sec_tokens (
  token_id         TEXT PRIMARY KEY,        -- ce que porte l'objet : /s/t/<token_id>
  tenant_id        TEXT NOT NULL,
  label            TEXT,
  current_short_id TEXT,                    -- secret actif (FK logique vers sec_secrets) ; NULL = jeton vide
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sec_tokens_tenant ON sec_tokens(tenant_id, created_at DESC);
