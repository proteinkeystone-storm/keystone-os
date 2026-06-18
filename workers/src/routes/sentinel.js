/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Sentinel (Pad O-GEO-001) · S0 (Sprint 0)

   Centre de contrôle d'audit web AVEC suivi. S0 = coquille :
   gestion des sites surveillés (CRUD) + détection de plateforme +
   gating du barème par plan. Pas encore d'audit (S1+).

   GET    /api/sentinel/health          Public — santé du moteur
   GET    /api/sentinel/sites           Liste des sites du tenant (+ quota)
   POST   /api/sentinel/sites           Ajouter un site (détection plateforme, gating)
   DELETE /api/sentinel/sites/:id       Retirer un site

   Auth : JWT obligatoire (sauf health). Tenant = identité authentifiée
   (claims.sub), JAMAIS un paramètre client (patron _tenantOf). Admin →
   'default'. Schéma auto-appliqué au 1er appel (pattern ai-credits /
   Keynapse) ; source de vérité : db/migration_sentinel.sql.

   GATING : barème de sites par plan (STARTER 1 · PRO 3 · MAX 5 · Admin
   illimité), appliqué CÔTÉ SERVEUR (l'app consommera des ressources —
   on ne se repose pas sur le seul gating client).

   ISOLATION : préfixe tables sentinel_, préfixe routes /api/sentinel/.
   Seule dépendance partagée = validateImportUrl (garde anti-SSRF audité,
   déjà réutilisé par content-source.js).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, generateId, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { validateImportUrl } from './smart-agent.js';

const SENTINEL_ENGINE_VERSION = 'S0';
const MAX_LABEL_LEN = 120;

// ── Barème de sites par plan (gating serveur) ───────────────────
function _siteLimit(plan) {
  const p = String(plan || '').toUpperCase();
  if (p === 'ADMIN') return 9999;
  if (p === 'MAX')   return 5;
  if (p === 'BETA')  return 5;   // beta-testeurs : aussi généreux que MAX
  if (p === 'PRO')   return 3;
  if (p === 'STARTER') return 1;
  return 1;                       // défaut prudent (plan inconnu)
}

// ── Schéma auto-appliqué (idempotent, une fois par isolate) ─────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS sentinel_sites (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       url TEXT NOT NULL, label TEXT, platform TEXT,
       created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_sentinel_sites_tenant ON sentinel_sites(tenant_id)`,
  ];
  for (const sql of stmts) { await env.DB.prepare(sql).run(); }
  _schemaReady = true;
}

// ── Auth / tenant (patron smart-agent.js / keynapse.js) ─────────
function _tenantOf(request, env, claims) {
  if (requireAdmin(request, env)) return 'default';
  if (!claims) return null;
  if (claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN') return 'default';
  return claims.sub || null;
}
function _planOf(request, env, claims) {
  if (requireAdmin(request, env)) return 'ADMIN';
  if (!claims) return 'STARTER';
  if (claims.isAdmin === true) return 'ADMIN';
  return String(claims.plan || 'STARTER').toUpperCase();
}
async function _ensureTenant(env, id, plan) {
  if (!id || id === 'default') return;
  try {
    await env.DB
      .prepare("INSERT OR IGNORE INTO tenants (id, name, plan) VALUES (?, ?, ?)")
      .bind(id, 'Client Keystone', plan || 'STARTER')
      .run();
  } catch (_) { /* non bloquant */ }
}
async function _gate(request, env, origin) {
  const claims = await requireJWT(request, env);
  if (!claims && !requireAdmin(request, env)) return { error: err('Authentification requise', 401, origin) };
  const tenant = _tenantOf(request, env, claims);
  if (!tenant) return { error: err('Authentification requise', 401, origin) };
  await _ensureSchema(env);
  await _ensureTenant(env, tenant, claims && claims.plan);
  return { claims, tenant, plan: _planOf(request, env, claims) };
}

// ── Détection de plateforme (Wix / WordPress / sur-mesure) ──────
// Fetch borné (8 s) + signatures. NON bloquant : tout échec → 'unknown'.
async function _detectPlatform(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'KeystoneSentinel/1.0 (+https://protein-keystone.com)' },
      signal: ctrl.signal,
    });
    let headerHint = '';
    for (const [k, v] of res.headers) {
      if (`${k}:${v}`.toLowerCase().includes('wix')) { headerHint = 'wix'; break; }
    }
    const html = (await res.text()).slice(0, 200000).toLowerCase();
    if (headerHint === 'wix' || html.includes('static.wixstatic.com') || html.includes('wix.com')
        || html.includes('_wixcssstate') || html.includes('wixbisession')) return 'wix';
    if (html.includes('/wp-content/') || html.includes('/wp-json') || html.includes('wp-includes')
        || html.includes('content="wordpress')) return 'wordpress';
    return 'custom';
  } catch (_) {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

// ── Handlers ────────────────────────────────────────────────────
export async function handleSentinelHealth(request, env) {
  const origin = getAllowedOrigin(env, request);
  let schema = 'ok';
  try { await _ensureSchema(env); } catch (_) { schema = 'error'; }
  return json({ ok: true, engine: SENTINEL_ENGINE_VERSION, schema }, 200, origin);
}

export async function handleSitesList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const rows = await env.DB
    .prepare("SELECT id, url, label, platform, created_at FROM sentinel_sites WHERE tenant_id = ? ORDER BY created_at ASC")
    .bind(g.tenant).all();
  const sites = (rows && rows.results) || [];
  return json({ sites, count: sites.length, limit: _siteLimit(g.plan), plan: g.plan }, 200, origin);
}

export async function handleSiteCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;

  const body = await parseBody(request);
  const v = validateImportUrl(body && body.url);
  if (!v.ok) return err(v.msg || 'Adresse invalide.', 400, origin);
  const label = (body && typeof body.label === 'string') ? body.label.trim().slice(0, MAX_LABEL_LEN) : '';

  // Gating barème — compter AVANT d'insérer.
  const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM sentinel_sites WHERE tenant_id = ?").bind(g.tenant).first();
  const used = (cnt && cnt.n) || 0;
  const limit = _siteLimit(g.plan);
  if (used >= limit) {
    return json({
      error: `Votre plan ${g.plan} permet de surveiller ${limit} site${limit > 1 ? 's' : ''}. Passez à un plan supérieur pour en ajouter.`,
      code: 'SENTINEL_SITE_LIMIT', limit, plan: g.plan,
    }, 403, origin);
  }

  // Pas de doublon exact (même URL pour ce tenant).
  const dup = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE tenant_id = ? AND url = ?").bind(g.tenant, v.url).first();
  if (dup) return err('Ce site est déjà surveillé.', 409, origin);

  const platform = await _detectPlatform(v.url);
  const id = generateId();
  await env.DB
    .prepare("INSERT INTO sentinel_sites (id, tenant_id, url, label, platform) VALUES (?, ?, ?, ?, ?)")
    .bind(id, g.tenant, v.url, label || null, platform)
    .run();
  return json({ site: { id, url: v.url, label: label || null, platform } }, 201, origin);
}

export async function handleSiteDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  await env.DB.prepare("DELETE FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).run();
  return json({ ok: true }, 200, origin);
}
