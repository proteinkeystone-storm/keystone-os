/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Coffre serveur per-tenant des clés BYOK (Phase 3b)
   ─────────────────────────────────────────────────────────────
   Distinct de l'admin-only routes/vault.js (clés OPÉRATEUR). Ici =
   clés du PROPRIÉTAIRE, pour que ses surfaces SANS front (chat public
   Smart Agent) tournent sur SA clé. Réutilise le chiffrement AES-256-GCM
   existant (lib/crypto.js + secret KS_ENCRYPTION_KEY).

   Routes (JWT licence — le tenant vient du JWT, JAMAIS du body) :
     POST   /api/keys            { engine?, apiKey?, active_engine? } → upsert chiffré + moteur actif
     DELETE /api/keys/:engine    retire la clé serveur d'un moteur
     GET    /api/keys            moteurs ayant une clé + moteur actif (AUCUNE valeur)

   Sécurité : clé chiffrée au repos, déchiffrée UNIQUEMENT à l'instant
   de l'appel vendor (lib/llm-router.resolveEngineForTenant), jamais
   loguée, jamais renvoyée en clair. Aucune route ne lit la valeur.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { encrypt }    from '../lib/crypto.js';

// Moteurs reconnus (ids Worker, alignés sur app/lib/engines.js). Les 7
// restent acceptés (perplexity/llama masqués au front mais clés legacy OK).
const VALID_ENGINES = ['claude', 'gpt', 'gemini', 'grok', 'mistral', 'perplexity', 'llama'];

let _schemaReady = false;
async function ensureByokSchema(env) {
  if (_schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tenant_api_keys (
      tenant_id  TEXT NOT NULL,
      engine     TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv         TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, engine)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tenant_ai_prefs (
      tenant_id     TEXT PRIMARY KEY,
      active_engine TEXT,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
  ]);
  _schemaReady = true;
}

// Tenant tiré du JWT (jamais du client). Aligné sur smart-agent _tenantOf :
// admin → 'default', sinon le lookup_hmac stable de la licence (claims.sub).
function _tenantFromJWT(claims) {
  if (!claims) return null;
  if (claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN') return 'default';
  return claims.sub || null;
}

// ── POST /api/keys ─────────────────────────────────────────────
export async function handleSaveUserKey(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);
  const tenant = _tenantFromJWT(claims);
  if (!tenant) return err('Authentification requise', 401, origin);
  if (!env.KS_ENCRYPTION_KEY) return err('Chiffrement non configuré (KS_ENCRYPTION_KEY)', 500, origin);
  await ensureByokSchema(env);

  const b = await parseBody(request);
  const engine       = (typeof b?.engine === 'string') ? b.engine.trim() : '';
  const apiKey       = (typeof b?.apiKey === 'string') ? b.apiKey.trim() : '';
  const activeEngine = (typeof b?.active_engine === 'string') ? b.active_engine.trim() : '';

  // (a) Sauvegarde/MAJ d'une clé (optionnelle).
  if (apiKey) {
    if (!VALID_ENGINES.includes(engine)) return err(`Moteur invalide (${VALID_ENGINES.join(', ')})`, 400, origin);
    if (apiKey.length < 8 || apiKey.length > 400) return err('Clé API invalide (longueur)', 400, origin);
    const { ciphertext, iv } = await encrypt(apiKey, env.KS_ENCRYPTION_KEY);
    await env.DB.prepare(`
      INSERT INTO tenant_api_keys (tenant_id, engine, ciphertext, iv, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(tenant_id, engine) DO UPDATE
        SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = datetime('now')
    `).bind(tenant, engine, ciphertext, iv).run();
  }

  // (b) Persistance du moteur actif (optionnelle).
  if (activeEngine) {
    if (!VALID_ENGINES.includes(activeEngine)) return err('Moteur actif invalide', 400, origin);
    await env.DB.prepare(`
      INSERT INTO tenant_ai_prefs (tenant_id, active_engine, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(tenant_id) DO UPDATE
        SET active_engine = excluded.active_engine, updated_at = datetime('now')
    `).bind(tenant, activeEngine).run();
  }

  if (!apiKey && !activeEngine) {
    return err('Rien à enregistrer (engine+apiKey ou active_engine requis)', 400, origin);
  }
  return json({ ok: true }, 200, origin);
}

// ── DELETE /api/keys/:engine ───────────────────────────────────
export async function handleDeleteUserKey(request, env, engine) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);
  const tenant = _tenantFromJWT(claims);
  if (!tenant) return err('Authentification requise', 401, origin);
  await ensureByokSchema(env);
  if (!VALID_ENGINES.includes(engine)) return err('Moteur invalide', 400, origin);
  await env.DB.prepare('DELETE FROM tenant_api_keys WHERE tenant_id = ? AND engine = ?')
    .bind(tenant, engine).run();
  return json({ ok: true, engine }, 200, origin);
}

// ── GET /api/keys ──────────────────────────────────────────────
// Liste les moteurs ayant une clé serveur + le moteur actif. AUCUNE valeur.
export async function handleListUserKeys(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);
  const tenant = _tenantFromJWT(claims);
  if (!tenant) return err('Authentification requise', 401, origin);
  await ensureByokSchema(env);
  const { results } = await env.DB
    .prepare('SELECT engine FROM tenant_api_keys WHERE tenant_id = ?').bind(tenant).all();
  const pref = await env.DB
    .prepare('SELECT active_engine FROM tenant_ai_prefs WHERE tenant_id = ?').bind(tenant).first();
  return json({ engines: results.map(r => r.engine), active_engine: pref?.active_engine || null }, 200, origin);
}
