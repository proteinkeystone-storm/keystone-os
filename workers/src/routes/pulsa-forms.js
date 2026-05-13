/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pulsa Forms (CRUD configurations)
   Sprint Pulsa-3.1

   Stocke les configurations de formulaires Pulsa (A-COM-004) en D1.
   Chaque entrée contient toute la config JSON (meta + sections +
   delivery + output) + champs dénormalisés utiles (slug, title,
   status, ttl_days) pour les listings et requêtes publiques.

   Routes :
     POST   /api/pulsa/forms           Upsert config (auth requise)
     GET    /api/pulsa/forms           Liste les formulaires de l'owner
     GET    /api/pulsa/forms/:id       Récupère une config (owner)
     PATCH  /api/pulsa/forms/:id       MAJ partielle (owner)
     DELETE /api/pulsa/forms/:id       Supprime (owner)

   Table auto-créée (CREATE IF NOT EXISTS) au premier accès.

   Auth : 3-tiers admin || JWT || device (pattern Kodex-assets).
   ═══════════════════════════════════════════════════════════════ */

import {
  json, err, parseBody, getAllowedOrigin,
  requireDevice, requireAdmin, generateId,
} from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

const VALID_STATUS = ['draft', 'published', 'archived'];

// ── Auth resolver (pattern Kodex) ─────────────────────────────
async function _resolveOwner(request, env) {
  if (requireAdmin(request, env)) {
    return { sub: 'admin', tenant: 'default', isAdmin: true };
  }
  const claims = await requireJWT(request, env);
  if (claims?.sub) {
    return { sub: claims.sub, tenant: claims.sub, isAdmin: false };
  }
  const device = await requireDevice(request, env);
  if (device?.tenant_id) {
    return { sub: 'device:' + device.id, tenant: device.tenant_id, isAdmin: false };
  }
  return null;
}

// ── Auto-migration ─────────────────────────────────────────────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
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
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_pulsa_forms_owner ON pulsa_forms(owner_sub, updated_at DESC)'
  ).run().catch(() => {});
  // Index sur slug pour la résolution publique. UNIQUE serait idéal mais
  // SQLite refuse d'ajouter UNIQUE à une table existante sans recréation ;
  // on assure l'unicité au moment de l'insert/update via SELECT préalable.
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_pulsa_forms_slug ON pulsa_forms(slug) WHERE slug IS NOT NULL'
  ).run().catch(() => {});
  _schemaReady = true;
}

// ── Helpers ────────────────────────────────────────────────────
function _isValidSlug(s) {
  return typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(s);
}

async function _isSlugTaken(env, slug, ignoreId = null) {
  if (!slug) return false;
  const row = await env.DB.prepare(
    'SELECT id FROM pulsa_forms WHERE slug = ? LIMIT 1'
  ).bind(slug).first();
  if (!row) return false;
  return row.id !== ignoreId;
}

function _rowToForm(row) {
  if (!row) return null;
  let config = {};
  try { config = JSON.parse(row.config_json || '{}'); } catch {}
  return {
    ...config,
    id: row.id,
    created_at: row.created_at ? new Date(row.created_at + 'Z').getTime() : null,
    updated_at: row.updated_at ? new Date(row.updated_at + 'Z').getTime() : null,
    published_at: row.published_at ? new Date(row.published_at + 'Z').getTime() : null,
    output: { ...(config.output || {}), status: row.status },
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/pulsa/forms  — upsert config
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaUpsert(request, env) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);

  const body = await parseBody(request);
  const form = body?.form;
  if (!form || typeof form !== 'object') {
    return err('Champ "form" requis (objet config)', 400, origin);
  }

  const id = form.id || generateId();
  const meta = form.meta || {};
  const slug = (meta.slug || '').trim().toLowerCase() || null;
  const title = (meta.title || '').trim() || null;
  const status = VALID_STATUS.includes(form.output?.status) ? form.output.status : 'draft';
  const ttlDays = Number.isInteger(meta.ttl_days) ? meta.ttl_days : 90;
  const recipients = Array.isArray(form.delivery?.recipients) ? form.delivery.recipients : [];

  // Si on publie, le slug est obligatoire et doit être valide + libre
  if (status === 'published') {
    if (!slug) return err('Slug requis pour publier le formulaire', 400, origin);
    if (!_isValidSlug(slug)) return err('Slug invalide (lettres minuscules, chiffres, tirets ; 1-64 caractères)', 400, origin);
    if (await _isSlugTaken(env, slug, id)) {
      return err(`Le slug « ${slug} » est déjà utilisé par un autre formulaire`, 409, origin);
    }
  } else if (slug && !_isValidSlug(slug)) {
    return err('Slug invalide (lettres minuscules, chiffres, tirets ; 1-64 caractères)', 400, origin);
  }

  // Vérifier l'existence pour discriminer INSERT/UPDATE et la propriété
  const existing = await env.DB.prepare(
    'SELECT id, owner_sub FROM pulsa_forms WHERE id = ? LIMIT 1'
  ).bind(id).first();
  if (existing && !owner.isAdmin && existing.owner_sub !== owner.sub) {
    return err('Vous n\'êtes pas propriétaire de ce formulaire', 403, origin);
  }

  const configJson = JSON.stringify({ ...form, id });
  const recipientsJson = JSON.stringify(recipients);
  const publishedAt = status === 'published' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;

  if (existing) {
    await env.DB.prepare(`
      UPDATE pulsa_forms
      SET slug = ?, title = ?, status = ?, config_json = ?, recipients_json = ?,
          ttl_days = ?, updated_at = datetime('now'),
          published_at = COALESCE(?, published_at)
      WHERE id = ?
    `).bind(slug, title, status, configJson, recipientsJson, ttlDays, publishedAt, id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO pulsa_forms (id, tenant_id, owner_sub, slug, title, status, config_json, recipients_json, ttl_days, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, owner.tenant, owner.sub, slug, title, status, configJson, recipientsJson, ttlDays, publishedAt).run();
  }

  const row = await env.DB.prepare('SELECT * FROM pulsa_forms WHERE id = ?').bind(id).first();
  return json({ ok: true, form: _rowToForm(row) }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/pulsa/forms  — liste owner
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);

  const sql = owner.isAdmin
    ? 'SELECT * FROM pulsa_forms ORDER BY updated_at DESC LIMIT 200'
    : 'SELECT * FROM pulsa_forms WHERE owner_sub = ? ORDER BY updated_at DESC LIMIT 200';
  const stmt = owner.isAdmin ? env.DB.prepare(sql) : env.DB.prepare(sql).bind(owner.sub);
  const { results = [] } = await stmt.all();
  return json({ ok: true, forms: results.map(_rowToForm) }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/pulsa/forms/:id  — récupère config
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaGet(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);

  const row = await env.DB.prepare('SELECT * FROM pulsa_forms WHERE id = ? LIMIT 1').bind(id).first();
  if (!row) return err('Formulaire introuvable', 404, origin);
  if (!owner.isAdmin && row.owner_sub !== owner.sub) {
    return err('Accès refusé', 403, origin);
  }
  return json({ ok: true, form: _rowToForm(row) }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// DELETE /api/pulsa/forms/:id
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);

  const row = await env.DB.prepare('SELECT id, owner_sub FROM pulsa_forms WHERE id = ?').bind(id).first();
  if (!row) return err('Formulaire introuvable', 404, origin);
  if (!owner.isAdmin && row.owner_sub !== owner.sub) {
    return err('Accès refusé', 403, origin);
  }
  await env.DB.prepare('DELETE FROM pulsa_forms WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, origin);
}
