-- ═══════════════════════════════════════════════════════════════
-- KEYSTONE OS — Migration 014 · MISSIVE : engagement + journal d'usage
-- Pad O-SEC-001. Prévention de l'abus SANS toucher au modèle de sécurité.
--
-- Rappel du cadre : le serveur est AVEUGLE et le reste. Rien ici ne
-- regarde le CONTENU d'une missive — c'est impossible et ça doit le
-- rester. On ne compte que des ÉVÉNEMENTS D'ENVOI (combien, quand, depuis
-- combien d'appareils), ce qu'un hébergeur doit pouvoir constater.
--
-- Pourquoi un journal séparé, alors que sec_secrets porte déjà created_at ?
--   Parce que sweepExpiredSecrets() SUPPRIME les lignes mortes au bout de
--   ~24 h (RGPD, cf. sceau.js). Une missive lue hier n'existe plus. Sans
--   ce journal, l'admin ne voit que l'instantané du jour : impossible de
--   distinguer un usage normal d'une rafale sur une semaine.
--
-- Minimisation (Art. 5.1.c) — ce que ces tables NE contiennent PAS :
--   · aucun contenu, aucun chiffré, aucune passphrase, aucun IV ;
--   · aucun destinataire (ni e-mail, ni téléphone) ;
--   · aucune IP en clair, aucun User-Agent en clair : l'empreinte est un
--     SHA-256 tronqué de (UA + IP), non réversible, et c'est EXACTEMENT le
--     même calcul que celui qui plafonne déjà les routes publiques ;
--   · aucun lien entre une missive donnée et un appareil (agrégat par
--     compte, jamais par short_id).
-- Base légale : intérêt légitime (prévention de l'abus d'un service).
-- Rétention : 90 jours, purgée par le cron quotidien (0 3 * * *).
--
-- Commande d'application :
--   wrangler d1 execute keystone-os --remote --file=./migrations/014_sceau_usage.sql
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Engagement du créateur (friction morale, opposable) ─────
-- Une case cochée côté navigateur ne prouve rien et se contourne. Pour
-- qu'elle vaille quelque chose, l'acceptation est ENREGISTRÉE (qui, quand,
-- quelle version du texte) et le serveur REFUSE de créer une missive tant
-- qu'elle manque. `version` permet de refaire signer si le texte change.
CREATE TABLE IF NOT EXISTS sec_pledges (
  tenant_id   TEXT PRIMARY KEY,            -- lookup_hmac de la licence (= claims.sub)
  version     TEXT NOT NULL,               -- version du texte accepté
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  fp          TEXT                         -- empreinte de l'appareil de signature (hachée)
);

-- ── 2. Journal d'usage horaire (volume + rythme) ───────────────
-- Granularité HORAIRE et pas à la seconde : elle suffit à voir une rafale
-- ou un envoi nocturne régulier (signature de machine), et elle ne permet
-- pas de reconstituer l'activité fine d'une personne.
--   created = coquilles ouvertes (POST /init)
--   sealed  = missives réellement scellées (POST /seal) — le vrai volume
--   emailed = notifications envoyées depuis notre domaine (POST /email)
CREATE TABLE IF NOT EXISTS sec_usage_hourly (
  tenant_id TEXT NOT NULL,
  hour_utc  TEXT NOT NULL,                 -- 'YYYY-MM-DDTHH' (UTC)
  created   INTEGER NOT NULL DEFAULT 0,
  sealed    INTEGER NOT NULL DEFAULT 0,
  emailed   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, hour_utc)
);
-- Balayage de la fenêtre glissante (24 h / 7 j) et purge à 90 j.
CREATE INDEX IF NOT EXISTS idx_sec_usage_hour ON sec_usage_hourly(hour_utc);

-- ── 3. Appareils vus par compte (multi-compte) ─────────────────
-- Lue dans un sens : « ce compte envoie depuis combien d'appareils ». Lue
-- dans l'autre : « combien de comptes derrière le même appareil » — le
-- signal qui trahit la création de comptes en série. Empreinte PASSIVE
-- uniquement (en-têtes que le navigateur envoie de toute façon) : aucun
-- canvas, aucune police, aucune lecture du terminal — donc pas de
-- consentement ePrivacy à demander, et pas de traceur posé chez le client.
CREATE TABLE IF NOT EXISTS sec_usage_device (
  tenant_id TEXT NOT NULL,
  fp        TEXT NOT NULL,                 -- SHA-256(UA|IP) tronqué 16 hex
  first_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_at   TEXT NOT NULL DEFAULT (datetime('now')),
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, fp)
);
-- Requête inverse (combien de comptes par empreinte) + purge à 90 j.
CREATE INDEX IF NOT EXISTS idx_sec_device_fp   ON sec_usage_device(fp);
CREATE INDEX IF NOT EXISTS idx_sec_device_last ON sec_usage_device(last_at);
