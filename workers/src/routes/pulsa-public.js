/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pulsa Public (lecture formulaire par slug)
   Sprint Pulsa-3.1

   Route consultable SANS authentification : c'est la porte d'entrée
   pour les répondants qui arrivent sur keystone.app/f/{slug}.

   Sécurité :
     - Le slug est l'identifiant public — pas un id deviné.
     - On ne retourne QUE les formulaires en status 'published'.
     - On ne renvoie PAS la liste des destinataires email (PII).
     - On strip aussi le owner_sub et les métadonnées internes.

   Route :
     GET /api/pulsa/public/:slug   → config publique JSON (status 200)
                                     ou 404 si pas trouvé / pas publié
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin } from '../lib/auth.js';

let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  // Pareil que pulsa-forms.js — création idempotente si la table n'existe pas encore.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS pulsa_forms (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL DEFAULT 'default',
      owner_sub       TEXT NOT NULL,
      slug            TEXT,
      title           TEXT,
      status          TEXT NOT NULL DEFAULT 'draft',
      config_json     TEXT NOT NULL,
      recipients_json TEXT,
      ttl_days        INTEGER NOT NULL DEFAULT 90,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      published_at    TEXT
    )
  `).run().catch(() => {});
  _schemaReady = true;
}

/**
 * Strip les champs sensibles avant de servir publiquement la config.
 * Ne renvoie que ce dont le renderer mobile-first a besoin pour
 * afficher le formulaire au répondant.
 */
function _toPublicConfig(row) {
  let cfg = {};
  try { cfg = JSON.parse(row.config_json || '{}'); } catch {}
  const meta = cfg.meta || {};
  return {
    id: row.id,
    slug: row.slug,
    title: row.title || meta.title || '',
    meta: {
      title: meta.title || '',
      intro: meta.intro || '',
      logo_data_url: meta.logo_data_url || null,
      logo_url: meta.logo_url || null,
      brand_color: meta.brand_color || '#0a2741',
      brand_accent: meta.brand_accent || '#c9b48a',
      anonymous: meta.anonymous !== false,
    },
    sections: Array.isArray(cfg.sections) ? cfg.sections : [],
  };
}

/**
 * Lit le code d'accès configuré pour ce slug, sans rien révéler
 * d'autre. Utilisé par le handler pour décider 401 vs 200.
 */
function _getAccessCode(row) {
  let cfg = {};
  try { cfg = JSON.parse(row.config_json || '{}'); } catch {}
  return cfg.meta?.access_code?.trim() || null;
}

// ═══════════════════════════════════════════════════════════════
// GET /api/pulsa/public/:slug?code=XXXX
// Si access_code est défini, le code doit matcher exactement.
// Retourne 401 + { protected: true } si manquant ou incorrect,
// 200 + form complet si OK ou si aucun code n'est requis.
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaPublic(request, env, slug, url) {
  const origin = getAllowedOrigin(env, request);
  if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    return err('Slug invalide', 400, origin);
  }
  await _ensureSchema(env);

  const row = await env.DB.prepare(
    'SELECT * FROM pulsa_forms WHERE slug = ? AND status = ? LIMIT 1'
  ).bind(slug, 'published').first();
  if (!row) return err('Formulaire introuvable ou non publié', 404, origin);

  const expectedCode = _getAccessCode(row);
  if (expectedCode) {
    const providedCode = url?.searchParams?.get('code')?.trim() || '';
    if (!providedCode || providedCode !== expectedCode) {
      return json({
        ok: false,
        protected: true,
        message: providedCode ? 'Code incorrect' : 'Code requis',
        title: row.title || _toPublicConfig(row).meta?.title || '',
      }, 401, origin);
    }
  }

  return json({ ok: true, form: _toPublicConfig(row) }, 200, origin);
}
