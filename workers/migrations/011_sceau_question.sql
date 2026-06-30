-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 011 · SCEAU mode question/réponse (Sprint S9)
-- 3e mode de déverrouillage : le créateur pose une QUESTION dont seul le
-- destinataire connaît la RÉPONSE. La réponse (normalisée) remplace la
-- passphrase dans l'OPRF → rien à transmettre si c'est un savoir partagé.
--
--   question : l'indice affiché AVANT déverrouillage (NON secret).
--              NULL = mode « code généré » classique (comportement actuel).
--
-- Reste 100 % E2E : la RÉPONSE n'est jamais envoyée (aveuglée par l'OPRF),
-- seule la question (l'indice) transite. La normalisation est IDENTIQUE
-- côté création (app/sceau.js) et lecture (sceau-page.js).
--
-- Application : wrangler d1 execute keystone-os --remote --file=./migrations/011_sceau_question.sql
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE sec_secrets ADD COLUMN question TEXT;
