-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 010 · SCEAU chiffré volumineux (Sprint S8)
-- Missive vocale + fichiers : le chiffré d'un audio/fichier dépasse le cap
-- inline D1 (200 Ko) → on le stocke en R2. Le texte reste inline (atomique).
--
--   kind      : 'text' (défaut, inline D1) | 'audio' | 'file' (→ R2)
--   mime      : type du contenu déchiffré (ex. 'audio/mp4') pour le lecteur
--   blob_key  : clé R2 du chiffré quand stocké hors D1 (NULL = inline)
--
-- Le chiffré reste E2E (AES-256-GCM côté client) : R2 ne voit que des octets
-- chiffrés, opaques. La garantie « mort » reste la destruction de la clé OPRF
-- en D1 ; la suppression de l'objet R2 est un nettoyage best-effort.
--
-- Application : wrangler d1 execute keystone-os --remote --file=./migrations/010_sceau_blob.sql
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE sec_secrets ADD COLUMN kind     TEXT NOT NULL DEFAULT 'text';
ALTER TABLE sec_secrets ADD COLUMN mime     TEXT;
ALTER TABLE sec_secrets ADD COLUMN blob_key TEXT;
