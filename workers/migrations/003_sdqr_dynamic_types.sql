-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 003 · SDQR-2.5 dynamic for non-URL types
-- Étend qr_redirects pour servir vCard / iCal / Texte en dynamique.
--
-- Pourquoi 2 colonnes au lieu de joindre entities ?
--   /r/<id> est le HOT path (chaque scan). Une jointure entities
--   ralentirait le redirect. On dénormalise pour servir en 1 lookup
--   PRIMARY KEY. Les colonnes sont mises à jour à chaque PATCH du
--   payload côté frontend.
--
-- qr_type        : 'url' (legacy) | 'text' | 'vcard' | 'ical'
--                  (wifi n'est jamais dynamique côté UI — voir spec)
-- encoded_payload: string finale à servir au scan :
--                  - vcard → contenu .vcf
--                  - ical  → contenu .ics
--                  - text  → contenu texte brut (rendu dans HTML page)
--                  - url   → NULL (target_url fait office)
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote \
--     --file=./migrations/003_sdqr_dynamic_types.sql
-- ═══════════════════════════════════════════════════════════════

-- SQLite ne supporte pas ALTER TABLE ADD COLUMN avec NOT NULL DEFAULT
-- pour les colonnes ajoutées tardivement, mais DEFAULT '' est OK.
ALTER TABLE qr_redirects ADD COLUMN qr_type TEXT NOT NULL DEFAULT 'url';
ALTER TABLE qr_redirects ADD COLUMN encoded_payload TEXT;
