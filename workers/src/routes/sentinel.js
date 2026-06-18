/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Sentinel (Pad O-GEO-001) · S0 + S1

   Centre de contrôle d'audit web AVEC suivi.
   · S0 : coquille — sites surveillés (CRUD) + détection de plateforme
          + gating du barème par plan.
   · S1 : BATTEMENT DE CŒUR — check léger de disponibilité (uptime /
          statut HTTP / temps de réponse), historisé, balayé par cron
          (file lissée), + cockpit live. (Alertes web push + SSL « jours
          restants » = S1.5, cf. SENTINEL_BRIEF §13.)

   GET    /api/sentinel/health              Public — santé du moteur
   GET    /api/sentinel/sites               Liste enrichie (cache + uptime + spark)
   POST   /api/sentinel/sites               Ajouter (détection + 1er check)
   DELETE /api/sentinel/sites/:id           Retirer (+ son historique)
   POST   /api/sentinel/sites/:id/check     Vérifier maintenant (on-demand)
   GET    /api/sentinel/sites/:id/history   Derniers relevés (sparkline)

   Auth : JWT obligatoire (sauf health). Tenant = identité authentifiée
   (claims.sub), JAMAIS un paramètre client. Admin → 'default'. Schéma
   auto-appliqué au 1er appel (pattern ai-credits / Keynapse) ; source de
   vérité : db/migration_sentinel.sql.

   GATING : barème de sites par plan (STARTER 1 · PRO 3 · MAX 5 · Admin
   illimité), appliqué CÔTÉ SERVEUR.

   ISOLATION : préfixe tables sentinel_, routes /api/sentinel/. Seule
   dépendance partagée = validateImportUrl (anti-SSRF audité).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, generateId, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { validateImportUrl } from './smart-agent.js';

const SENTINEL_ENGINE_VERSION = 'S1';
const MAX_LABEL_LEN = 120;
const CHECK_TIMEOUT_MS = 15000;   // borne d'un check
const CHECK_INTERVAL   = '+5 minutes';  // cadence du battement de fond
const SWEEP_BATCH      = 60;       // sites traités par tick de cron (lissage)
const SPARK_POINTS     = 20;       // points de la sparkline
const HISTORY_LIMIT    = 50;

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
    // S1 — relevés de disponibilité (historique)
    `CREATE TABLE IF NOT EXISTS sentinel_checks (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       site_id TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 0,
       status INTEGER, ms INTEGER, error TEXT,
       checked_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_sentinel_checks_site ON sentinel_checks(site_id, checked_at)`,
  ];
  for (const sql of stmts) { await env.DB.prepare(sql).run(); }
  // S1 — colonnes cache sur sentinel_sites (ADD COLUMN tolérant : SQLite n'a
  // pas IF NOT EXISTS → déjà-présent = OK). Évite d'agréger l'historique
  // pour afficher l'état courant.
  for (const col of [
    "next_check_at TEXT", "last_checked_at TEXT", "last_ok INTEGER",
    "last_status INTEGER", "last_ms INTEGER", "consecutive_fails INTEGER NOT NULL DEFAULT 0",
  ]) {
    try { await env.DB.prepare(`ALTER TABLE sentinel_sites ADD COLUMN ${col}`).run(); } catch (_) { /* déjà présent */ }
  }
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

// ── Sonde (un seul fetch) ───────────────────────────────────────
// _probe : lit le corps → sert AUSSI à détecter la plateforme (à l'ajout).
// _check : ne lit pas le corps → temps de réponse ≈ TTFB (battement régulier).
function _classify(status) { return (status >= 200 && status < 400) ? 1 : 0; }

async function _probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'KeystoneSentinel/1.0 (+https://protein-keystone.com)' }, signal: ctrl.signal });
    const ms = Date.now() - t0; const status = res.status; const ok = _classify(status);
    let headerHint = '';
    for (const [k, v] of res.headers) { if (`${k}:${v}`.toLowerCase().includes('wix')) { headerHint = 'wix'; break; } }
    const html = (await res.text()).slice(0, 200000).toLowerCase();
    let platform = 'custom';
    if (headerHint === 'wix' || html.includes('static.wixstatic.com') || html.includes('wix.com')
        || html.includes('_wixcssstate') || html.includes('wixbisession')) platform = 'wix';
    else if (html.includes('/wp-content/') || html.includes('/wp-json') || html.includes('wp-includes')
        || html.includes('content="wordpress')) platform = 'wordpress';
    return { ok, status, ms, error: ok ? null : `HTTP ${status}`, platform };
  } catch (e) {
    return { ok: 0, status: 0, ms: Date.now() - t0, error: (e && e.name === 'AbortError') ? 'Délai dépassé' : (e && e.message || 'Inaccessible'), platform: 'unknown' };
  } finally { clearTimeout(timer); }
}

async function _check(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'KeystoneSentinel/1.0 (+https://protein-keystone.com)' }, signal: ctrl.signal });
    const ms = Date.now() - t0; const status = res.status;
    try { await res.body?.cancel?.(); } catch (_) { /* libère sans lire le corps */ }
    return { ok: _classify(status), status, ms, error: _classify(status) ? null : `HTTP ${status}` };
  } catch (e) {
    return { ok: 0, status: 0, ms: Date.now() - t0, error: (e && e.name === 'AbortError') ? 'Délai dépassé' : (e && e.message || 'Inaccessible') };
  } finally { clearTimeout(timer); }
}

// Insère le relevé + met à jour le cache du site (état courant rapide).
async function _recordCheck(env, tenant, siteId, r) {
  await env.DB
    .prepare("INSERT INTO sentinel_checks (id, tenant_id, site_id, ok, status, ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(generateId(), tenant, siteId, r.ok, r.status || 0, r.ms || 0, r.error || null).run();
  await env.DB.prepare(
    `UPDATE sentinel_sites
        SET last_checked_at = datetime('now'), last_ok = ?, last_status = ?, last_ms = ?,
            consecutive_fails = CASE WHEN ? = 1 THEN 0 ELSE consecutive_fails + 1 END,
            next_check_at = datetime('now', '${CHECK_INTERVAL}'), updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?`
  ).bind(r.ok, r.status || 0, r.ms || 0, r.ok, siteId, tenant).run();
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
  const rows = (await env.DB
    .prepare(`SELECT id, url, label, platform, last_checked_at, last_ok, last_status, last_ms, consecutive_fails, created_at
                FROM sentinel_sites WHERE tenant_id = ? ORDER BY created_at ASC`)
    .bind(g.tenant).all()).results || [];
  for (const s of rows) {
    const up = await env.DB
      .prepare("SELECT AVG(ok) AS rate, COUNT(*) AS n FROM sentinel_checks WHERE site_id = ? AND checked_at >= datetime('now','-1 day')")
      .bind(s.id).first();
    s.uptime24h = (up && up.n) ? Math.round((up.rate || 0) * 1000) / 10 : null;
    const sp = (await env.DB
      .prepare(`SELECT ms, ok FROM sentinel_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT ${SPARK_POINTS}`)
      .bind(s.id).all()).results || [];
    s.spark = sp.reverse().map(x => ({ ms: x.ms, ok: x.ok }));
  }
  return json({ sites: rows, count: rows.length, limit: _siteLimit(g.plan), plan: g.plan }, 200, origin);
}

export async function handleSiteCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;

  const body = await parseBody(request);
  const v = validateImportUrl(body && body.url);
  if (!v.ok) return err(v.msg || 'Adresse invalide.', 400, origin);
  const label = (body && typeof body.label === 'string') ? body.label.trim().slice(0, MAX_LABEL_LEN) : '';

  const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM sentinel_sites WHERE tenant_id = ?").bind(g.tenant).first();
  const used = (cnt && cnt.n) || 0;
  const limit = _siteLimit(g.plan);
  if (used >= limit) {
    return json({
      error: `Votre plan ${g.plan} permet de surveiller ${limit} site${limit > 1 ? 's' : ''}. Passez à un plan supérieur pour en ajouter.`,
      code: 'SENTINEL_SITE_LIMIT', limit, plan: g.plan,
    }, 403, origin);
  }

  const dup = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE tenant_id = ? AND url = ?").bind(g.tenant, v.url).first();
  if (dup) return err('Ce site est déjà surveillé.', 409, origin);

  // Une seule sonde : détecte la plateforme ET sert de 1er battement.
  const probe = await _probe(v.url);
  const id = generateId();
  await env.DB
    .prepare("INSERT INTO sentinel_sites (id, tenant_id, url, label, platform) VALUES (?, ?, ?, ?, ?)")
    .bind(id, g.tenant, v.url, label || null, probe.platform || 'unknown').run();
  await _recordCheck(env, g.tenant, id, probe);

  return json({ site: { id, url: v.url, label: label || null, platform: probe.platform || 'unknown', last_ok: probe.ok, last_status: probe.status, last_ms: probe.ms } }, 201, origin);
}

export async function handleSiteDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  await env.DB.prepare("DELETE FROM sentinel_checks WHERE site_id = ? AND tenant_id = ?").bind(id, g.tenant).run();
  await env.DB.prepare("DELETE FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).run();
  return json({ ok: true }, 200, origin);
}

export async function handleSiteCheck(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);
  const r = await _check(site.url);
  await _recordCheck(env, g.tenant, site.id, r);
  return json({ check: { ok: r.ok, status: r.status, ms: r.ms, error: r.error } }, 200, origin);
}

export async function handleSiteHistory(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const own = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!own) return err('Site introuvable.', 404, origin);
  const rows = (await env.DB
    .prepare(`SELECT checked_at, ok, status, ms, error FROM sentinel_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT ${HISTORY_LIMIT}`)
    .bind(id).all()).results || [];
  return json({ history: rows.reverse() }, 200, origin);
}

// ── Cron — battement de fond (file lissée) ──────────────────────
// Branché sur '*/5 * * * *'. Idempotent : ne traite qu'un lot de sites
// échus par tick → charge étalée, jamais de pic de fetchs concurrents.
export async function sweepDueChecks(env) {
  if (!env || !env.DB) return { skipped: 'no-db' };
  try { await _ensureSchema(env); } catch (_) { return { skipped: 'no-schema' }; }
  const due = (await env.DB
    .prepare(`SELECT id, tenant_id, url FROM sentinel_sites
               WHERE next_check_at IS NULL OR next_check_at <= datetime('now')
               ORDER BY (next_check_at IS NOT NULL), next_check_at ASC LIMIT ${SWEEP_BATCH}`)
    .all()).results || [];
  let checked = 0;
  for (const s of due) {
    try { const r = await _check(s.url); await _recordCheck(env, s.tenant_id, s.id, r); checked++; }
    catch (_) { /* un site qui plante ne bloque pas le lot */ }
  }
  return { due: due.length, checked };
}
