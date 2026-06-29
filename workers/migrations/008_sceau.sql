-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 008 · SCEAU (Sprint S1 — backend coffre)
-- Pad O-SEC-001 : transmission de secret usage-unique, scellée, E2E + OPRF.
--
-- Modèle de sécurité (cf. SCEAU_CRYPTO_SPEC.md, gelé en S0) :
--   - Le serveur est AVEUGLE : il ne stocke QUE du chiffré (E2E, AES-256-GCM
--     côté client) + la clé privée OPRF (chiffrée AU REPOS sous KS_ENCRYPTION_KEY).
--     Jamais le clair, jamais la passphrase, jamais la clé AES.
--   - La clé OPRF est DÉTRUITE (oprf_key_enc = NULL) au max_attempts-ème
--     échec OU au burn → plus aucun déchiffrement possible, jamais.
--
-- Pourquoi le chiffré INLINE en D1 (et pas R2) ?
--   - Un secret = un code / mot de passe / petit texte (quelques octets).
--   - Burn ATOMIQUE : détruire chiffré + clé OPRF = un seul UPDATE de ligne
--     (pas de risque d'incohérence D1↔R2). Pour un produit de sécurité, prime.
--   - R2 reste réservé aux secrets-FICHIERS (S7), avec ciphertext_ref alors.
--
-- Interrogeable par short_id SANS tenant (la lecture publique /s/<id> ne
-- connaît pas le tenant) → PRIMARY KEY (short_id), index O(1).
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote --file=./migrations/008_sceau.sql
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sec_secrets (
  short_id      TEXT PRIMARY KEY,            -- ce que porte l'objet NFC/QR : /s/<short_id>
  tenant_id     TEXT NOT NULL,              -- propriétaire (admin → 'default', sinon claims.sub)

  -- E2E : opaques au serveur (chiffrés côté client, AES-256-GCM)
  ciphertext    TEXT,                        -- base64 ; NULL tant que pas scellé ou après burn
  iv            TEXT,                        -- base64 (IV 12 o)

  -- Matériel OPRF (VOPRF P-256/SHA-256)
  oprf_pub      TEXT,                        -- base64 clé publique (servie au client pour la preuve DLEQ)
  oprf_key_enc  TEXT,                        -- base64 clé privée CHIFFRÉE au repos ; NULL = DÉTRUITE (mort crypto)
  oprf_key_iv   TEXT,                        -- base64 IV du chiffrement au repos

  -- Compteur = l'instrument du « 3 strikes » (évaluations OPRF de LECTURE)
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,

  status        TEXT NOT NULL DEFAULT 'init', -- init | scelle | lu | detruit | expire
  label         TEXT,                         -- nom non sensible donné par le créateur (optionnel)

  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  sealed_at     TEXT,
  expires_at    TEXT,                         -- ISO ; NULL = pas d'expiration
  read_at       TEXT,
  destroyed_at  TEXT
);

-- Liste par tenant (dashboard), récents d'abord.
CREATE INDEX IF NOT EXISTS idx_sec_tenant ON sec_secrets(tenant_id, created_at DESC);
-- Balayage cron des expirés.
CREATE INDEX IF NOT EXISTS idx_sec_expires ON sec_secrets(expires_at);
