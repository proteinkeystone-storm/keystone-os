/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Licences v1.0
   Cloudflare D1 — remplacement de l'Upstash Redis

   GET  /api/licence/list       → liste (admin)
   POST /api/licence/activate   → créer / mettre à jour
   POST /api/licence/revoke     → révoquer
   POST /api/licence/validate   → vérifier clé (login utilisateur)
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { blindIndex, hashKey } from '../lib/kdf.js';
import { audit } from '../lib/audit.js';

// ── GET /api/licence/list ─────────────────────────────────────
export async function handleList(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const url         = new URL(request.url);
  const activeFilter = url.searchParams.get('active'); // 'true' | 'false' | null

  let query  = 'SELECT * FROM licences';
  const binds = [];

  if (activeFilter === 'true')  { query += ' WHERE is_active = 1'; }
  if (activeFilter === 'false') { query += ' WHERE is_active = 0'; }
  query += ' ORDER BY created_at DESC';

  const { results } = await env.DB.prepare(query).bind(...binds).all();

  const licences = results.map(_rowToLicence);
  return json({ total: licences.length, licences }, 200, origin);
}

// ── POST /api/licence/activate ────────────────────────────────
export async function handleActivate(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const body = await parseBody(request);
  const { key, owner, plan = 'STARTER', ownedAssets, expiresAt, tenantId = 'default' } = body;

  if (!key || typeof key !== 'string')   return err('Champ "key" requis', 400, origin);
  if (!owner || typeof owner !== 'string') return err('Champ "owner" requis', 400, origin);

  // Valide le format XXXX-XXXX-XXXX-XXXX
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key)) {
    return err('Format de clé invalide (XXXX-XXXX-XXXX-XXXX)', 400, origin);
  }

  const assetsJson = ownedAssets ? JSON.stringify(ownedAssets) : null;

  // Sprint Sécu-3 / H7 / Q3b — hash + blind index obligatoires.
  // Cohérence avec le webhook Stripe et activate-v2 : toute licence
  // qui entre en DB a son lookup_hmac (HMAC-SHA256) et son key_hash
  // (PBKDF2-100k+salt). La col `key` en clair reste pour rétrocompat
  // jusqu'à migration one-shot (script à venir : UPDATE licences
  // SET key='*****' WHERE lookup_hmac IS NOT NULL).
  if (!env.KS_LOOKUP_PEPPER) return err('Server: KS_LOOKUP_PEPPER manquant', 500, origin);
  const upperKey   = key.toUpperCase();
  const lookupHmac = await blindIndex(upperKey, env.KS_LOOKUP_PEPPER);
  const { hash, salt } = await hashKey(upperKey);

  // INSERT OR REPLACE = créer ou mettre à jour
  await env.DB.prepare(`
    INSERT INTO licences (key, tenant_id, owner, plan, is_active, owned_assets, expires_at, lookup_hmac, key_hash, salt, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      owner        = excluded.owner,
      plan         = excluded.plan,
      is_active    = 1,
      owned_assets = excluded.owned_assets,
      expires_at   = excluded.expires_at,
      lookup_hmac  = excluded.lookup_hmac,
      key_hash     = excluded.key_hash,
      salt         = excluded.salt,
      updated_at   = datetime('now')
  `).bind(upperKey, tenantId, owner, plan, assetsJson, expiresAt || null, lookupHmac, hash, salt).run();

  const licence = await env.DB
    .prepare('SELECT * FROM licences WHERE key = ?')
    .bind(key.toUpperCase())
    .first();

  return json({ success: true, licence: _rowToLicence(licence) }, 200, origin);
}

// ── POST /api/licence/revoke ──────────────────────────────────
export async function handleRevoke(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const { key } = await parseBody(request);
  if (!key) return err('Champ "key" requis', 400, origin);

  const existing = await env.DB
    .prepare('SELECT key FROM licences WHERE key = ?')
    .bind(key.toUpperCase())
    .first();

  if (!existing) return err('Licence introuvable', 404, origin);

  await env.DB
    .prepare("UPDATE licences SET is_active = 0, updated_at = datetime('now') WHERE key = ?")
    .bind(key.toUpperCase())
    .run();

  // Sprint Sécu-4 / I3 — trace de la révocation pour audit RGPD
  await audit(env, {
    action:  'licence_revoke',
    target:  key.toUpperCase(),
    request,
  });

  return json({ success: true, key: key.toUpperCase() }, 200, origin);
}

// ── POST /api/licence/validate ────────────────────────────────
// Endpoint utilisateur — pas besoin du secret admin
// Vérifie la clé + retourne les assets autorisés
export async function handleValidate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const body   = await parseBody(request);
  const key    = (body.key || '').toUpperCase().trim();

  if (!key) return err('Clé requise', 400, origin);

  const licence = await env.DB
    .prepare('SELECT * FROM licences WHERE key = ? AND is_active = 1')
    .bind(key)
    .first();

  if (!licence) return err('Licence invalide ou révoquée', 403, origin);

  // Vérifie l'expiration
  if (licence.expires_at && new Date(licence.expires_at) < new Date()) {
    return err('Licence expirée', 403, origin);
  }

  return json({
    valid:       true,
    plan:        licence.plan,
    owner:       licence.owner,
    ownedAssets: licence.owned_assets ? JSON.parse(licence.owned_assets) : null,
    expiresAt:   licence.expires_at,
  }, 200, origin);
}

// ── Normalisation row → objet ─────────────────────────────────
function _rowToLicence(row) {
  if (!row) return null;
  return {
    key:         row.key,
    owner:       row.owner,
    plan:        row.plan,
    active:      row.is_active === 1,
    ownedAssets: row.owned_assets ? JSON.parse(row.owned_assets) : null,
    expiresAt:   row.expires_at  || null,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}
