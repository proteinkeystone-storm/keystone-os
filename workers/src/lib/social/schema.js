/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Schéma D1 v1.0
   (Sprint Social-0 — Socle d'extensibilité)

   Auto-migration idempotente — même pattern que routes/screenshots.js :
   les tables sont créées à la 1re requête sociale. Pas besoin de
   `wrangler d1 migrations apply`. Miroir SQL documentaire dans
   ../../db/migration_social.sql.

   Tables :
   - social_accounts : connexions OAuth par réseau (tokens chiffrés
     AES-256-GCM via lib/crypto.js — jamais en clair, comme api_keys_vault).
   - social_posts    : posts (canonique JSON + cibles + cycle de vie
     + résultat par plateforme).
   ═══════════════════════════════════════════════════════════════ */

let _ready = false;

export async function ensureSocialSchema(env) {
  if (_ready) return;

  // ── Comptes sociaux connectés (1 par plateforme+cible+tenant) ──
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS social_accounts (
      id                 TEXT PRIMARY KEY,
      tenant_id          TEXT NOT NULL DEFAULT 'default',
      platform           TEXT NOT NULL,                    -- 'linkedin' | 'facebook' | 'instagram' | …
      target_type        TEXT NOT NULL DEFAULT 'profile',  -- 'profile' | 'page' | 'organization' | 'business'
      external_id        TEXT,                             -- URN / id du compte ou de la page côté plateforme
      display_name       TEXT,                             -- libellé lisible ("Profil de Stéphane")
      access_ciphertext  TEXT,                             -- access token chiffré AES-GCM (base64)
      access_iv          TEXT,
      refresh_ciphertext TEXT,                             -- refresh token chiffré (NULL si non fourni)
      refresh_iv         TEXT,
      scopes             TEXT,                             -- CSV des scopes accordés
      expires_at         TEXT,                             -- ISO : expiration de l'access token
      status             TEXT NOT NULL DEFAULT 'connected',-- connected | expired | revoked | error
      meta               TEXT,                             -- JSON libre (spécifique plateforme — extensible)
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_social_accounts_tenant
    ON social_accounts(tenant_id, platform)
  `).run();

  // ── Posts (contenu canonique + diffusion) ──────────────────────
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL DEFAULT 'default',
      source        TEXT,                                  -- 'manual' | 'pad:O-IMM-002' | 'rule:<id>'
      canonical     TEXT NOT NULL,                         -- JSON du post canonique
      targets       TEXT NOT NULL,                         -- JSON : ['linkedin','facebook',…]
      status        TEXT NOT NULL DEFAULT 'draft',         -- draft|ready|scheduled|publishing|published|partial|failed|canceled
      scheduled_at  TEXT,                                  -- ISO : publication programmée (NULL = immédiat)
      results       TEXT,                                  -- JSON : [{platform,status,externalId,url,error}]
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_tenant
    ON social_posts(tenant_id, status)
  `).run();
  // Index dédié au futur balayage du cron (statut + échéance) — Sprint Social-3.
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_due
    ON social_posts(status, scheduled_at)
  `).run();

  // ── Migration additive : réessais automatiques (Sprint Social-4.2) ──
  // CREATE IF NOT EXISTS n'ajoute PAS de colonne à une table déjà créée en prod
  // → ALTER idempotent (on saute si la colonne existe déjà). attempts = nb d'essais,
  // next_attempt_at = quand le cron doit reprendre les réseaux ratés.
  const info = await env.DB.prepare(`PRAGMA table_info(social_posts)`).all();
  const have = new Set((info.results || []).map(c => c.name));
  if (!have.has('attempts')) {
    await env.DB.prepare(`ALTER TABLE social_posts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!have.has('next_attempt_at')) {
    await env.DB.prepare(`ALTER TABLE social_posts ADD COLUMN next_attempt_at TEXT`).run();
  }
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_social_posts_retry
    ON social_posts(status, next_attempt_at)
  `).run();

  _ready = true;
}
