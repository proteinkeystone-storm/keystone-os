/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Sentinel (Pad O-GEO-001) · S0 → S2

   Centre de contrôle d'audit web AVEC suivi.
   · S0  : coquille — sites surveillés (CRUD) + détection de plateforme + gating.
   · S1  : battement de cœur — check de disponibilité, historisé, cron lissé.
   · S1.5: alertes web push (site hors ligne / rétabli). [SSL « jours restants »
           non lisible nativement par fetch sur Workers → documenté, non livré.]
   · S2  : audit on-page + score (SEO technique, sécurité, accessibilité) +
           findings priorisés ; disponibilité = axe S1.

   GET    /api/sentinel/health
   GET    /api/sentinel/sites                  Liste enrichie (cache + uptime + spark + score)
   POST   /api/sentinel/sites                  Ajouter (détection + 1er check)
   DELETE /api/sentinel/sites/:id              Retirer (+ historique + audits)
   POST   /api/sentinel/sites/:id/check        Vérifier maintenant
   GET    /api/sentinel/sites/:id/history      Derniers relevés (sparkline)
   POST   /api/sentinel/sites/:id/audit        Lancer un audit on-page
   GET    /api/sentinel/sites/:id/audit        Dernier audit (score + findings)
   POST   /api/sentinel/push/subscribe         Abonner aux alertes
   POST   /api/sentinel/push/unsubscribe       Se désabonner

   Auth : JWT (sauf health). Tenant = identité authentifiée. ISOLATION :
   préfixe sentinel_. Dépendances partagées : validateImportUrl (anti-SSRF),
   sendPush (webpush.js, déjà utilisé par Keynapse).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, generateId, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { sendEmail, emailConfigured } from '../lib/email-resend.js';
import { requireJWT, signJWT, verifyJWT } from '../lib/jwt.js';
// V2 — Search Console : refresh_token Google chiffré au repos (AES-256-GCM).
import { encrypt, decrypt } from '../lib/crypto.js';
import { validateImportUrl } from './smart-agent.js';
import { sendPush } from '../lib/webpush.js';
import puppeteer from '@cloudflare/puppeteer';
// S4.1 — clé en main augmenté : génération IA du texte (méta / FAQ AEO),
// métrée comme toutes les surfaces IA (cf MANIFESTE §10).
import { KS_AI_MODEL } from '../lib/ai-model.js';
import { budgetGuard, recordUsage } from '../lib/ai-budget.js';
import { isEnforceEnabled, consumeCredits, refundCredits } from '../lib/ai-credits.js';
// Analyse GEO pure (citation/rang/sentiment/score), partagée run auto + mode manuel.
import { sentiment as _sentiment, detectCitation as _detectCitation, geoScore as _geoScore, analyzeManual as _analyzeManualGeo, splitManualAnswer as _splitManualAnswer, topCitedDomains, presenceMatch } from '../lib/geo-analyze.js';
// S5 — GEO (visibilité IA) : clé du propriétaire via le coffre BYOK si dispo,
// sinon clés serveur GEMINI/PERPLEXITY/OPENAI (free tier Gemini = levier coût).
import { resolveEngineForTenant } from '../lib/llm-router.js';
import { analyzePage, detectPlatform, dedupeFixCode, smoothCwv, rawCwv, CWV_SMOOTH_N, SEC_HEADERS, globalScore as _globalScore, perfScore as _perfScore, sitemapLooksValid, aggregatePages, attachGains, AXIS_WEIGHTS } from '../lib/audit-page.js';

const SENTINEL_ENGINE_VERSION = 'S17.1';
// S8 — forme « compatible » conventionnelle (moins de blocages WAF). Mesuré :
// Wix sert le MÊME HTML (3,3 Mo) aux deux formes ; la version crawler allégée
// est réservée aux bots vérifiés (Googlebot…) qu'on n'usurpe pas. C'est donc
// MAX_HTML qui garantit l'analyse complète, pas l'UA.
const UA = 'Mozilla/5.0 (compatible; KeystoneSentinel/1.0; +https://protein-keystone.com)';
// S8 — cap de lecture HTML. L'ancien cap (500 Ko) coupait AVANT le <h1> des
// pages Wix Studio (2,2-3,4 Mo, H1 vers 2,3 Mo) → « Aucun H1 » émis à tort.
// 4 Mo couvre les tailles Wix observées ; res.text() a de toute façon déjà
// bufferisé le corps entier, le slice ne protège que l'analyse aval.
// Au-delà → flag `truncated` : preuve négative invalide (cf. audit-page.js).
const MAX_HTML = 4_000_000;
const MAX_LABEL_LEN = 120;
const CHECK_TIMEOUT_MS = 15000;
const SUB_TIMEOUT_MS = 8000;
const CHECK_INTERVAL = '+5 minutes';
const SWEEP_BATCH = 60;
const SPARK_POINTS = 20;
const HISTORY_LIMIT = 50;
const DOWN_THRESHOLD = 2;   // échecs consécutifs avant d'alerter (anti-flapping)

// ── Barème de sites par plan (gating serveur) ───────────────────
function _siteLimit(plan) {
  const p = String(plan || '').toUpperCase();
  if (p === 'ADMIN') return 9999;
  if (p === 'MAX' || p === 'BETA') return 5;
  if (p === 'PRO') return 3;
  if (p === 'STARTER') return 1;
  return 1;
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
    `CREATE TABLE IF NOT EXISTS sentinel_checks (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       site_id TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 0,
       status INTEGER, ms INTEGER, error TEXT,
       checked_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_sentinel_checks_site ON sentinel_checks(site_id, checked_at)`,
    // S1.5 — abonnements web push (par appareil/navigateur).
    `CREATE TABLE IF NOT EXISTS sentinel_push_subs (
       endpoint TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       p256dh TEXT NOT NULL, auth TEXT NOT NULL,
       created_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_sentinel_push_tenant ON sentinel_push_subs(tenant_id)`,
    // S2 — audits on-page (historique).
    `CREATE TABLE IF NOT EXISTS sentinel_audits (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       site_id TEXT NOT NULL, score INTEGER, scores TEXT, findings TEXT,
       created_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_sentinel_audits_site ON sentinel_audits(site_id, created_at)`,
    // S4.1 — journal d'envois d'e-mail (rate-limit léger par tenant/jour).
    `CREATE TABLE IF NOT EXISTS sentinel_email_log (
       tenant_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (tenant_id, day))`,
    // S5 — visibilité IA (GEO) : 1 config + dernier relevé par site.
    // next_geo_at (S5.1) = échéance de la mesure hebdo automatique (cron lissé).
    `CREATE TABLE IF NOT EXISTS sentinel_geo (
       site_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       business_name TEXT, city TEXT, activity TEXT, prompts TEXT,
       last_score INTEGER, last_results TEXT, last_run_at TEXT, next_geo_at TEXT,
       updated_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    // V2 — Google Search Console (axe « Mots-clés » : positions Google réelles).
    // OAuth par site : refresh_token chiffré (AES-GCM). last_* = dernier relevé.
    // Multi-sites par construction ; en mode « Test » Google seuls les comptes
    // testeurs peuvent autoriser (publier l'app OAuth ouvre aux clients, zéro code).
    `CREATE TABLE IF NOT EXISTS sentinel_gsc (
       site_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       property TEXT, account_email TEXT,
       refresh_ciphertext TEXT, refresh_iv TEXT,
       status TEXT NOT NULL DEFAULT 'disconnected',
       last_score INTEGER, last_results TEXT, last_run_at TEXT, next_gsc_at TEXT,
       updated_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
  ];
  for (const sql of stmts) { await env.DB.prepare(sql).run(); }
  for (const col of [
    "next_check_at TEXT", "last_checked_at TEXT", "last_ok INTEGER",
    "last_status INTEGER", "last_ms INTEGER", "consecutive_fails INTEGER NOT NULL DEFAULT 0",
    "last_score INTEGER", "last_scores TEXT", "last_audit_at TEXT",
  ]) {
    try { await env.DB.prepare(`ALTER TABLE sentinel_sites ADD COLUMN ${col}`).run(); } catch (_) { /* déjà présent */ }
  }
  // S5.1 — colonne ajoutée à la table sentinel_geo déjà créée en S5.0.
  try { await env.DB.prepare("ALTER TABLE sentinel_geo ADD COLUMN next_geo_at TEXT").run(); } catch (_) { /* déjà présent */ }
  // S7 — Core Web Vitals stockés avec l'audit (pour le KPI « Chargement » du cockpit).
  try { await env.DB.prepare("ALTER TABLE sentinel_audits ADD COLUMN cwv TEXT").run(); } catch (_) { /* déjà présent */ }
  // V2 — crawl multi-pages : liste des pages auditées + leur score (JSON).
  try { await env.DB.prepare("ALTER TABLE sentinel_audits ADD COLUMN pages TEXT").run(); } catch (_) { /* déjà présent */ }
  // S8 — clés de contrôles indéterminés (document tronqué → « non vérifiable »).
  try { await env.DB.prepare("ALTER TABLE sentinel_audits ADD COLUMN indeterminate TEXT").run(); } catch (_) { /* déjà présent */ }
  // S9 — en-têtes non applicables (plateforme managée), version du moteur, total de pages détectées.
  try { await env.DB.prepare("ALTER TABLE sentinel_audits ADD COLUMN not_applicable TEXT").run(); } catch (_) { /* déjà présent */ }
  try { await env.DB.prepare("ALTER TABLE sentinel_audits ADD COLUMN engine TEXT").run(); } catch (_) { /* déjà présent */ }
  try { await env.DB.prepare("ALTER TABLE sentinel_audits ADD COLUMN pages_total INTEGER").run(); } catch (_) { /* déjà présent */ }
  // S14.2 — historique GEO (lissage : médiane des derniers relevés, courbes futures).
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sentinel_geo_history (
    site_id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT 'default',
    run_at TEXT DEFAULT (datetime('now')), score INTEGER, engines INTEGER, prompts INTEGER)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sentinel_geo_hist ON sentinel_geo_history(site_id, run_at)").run();
  // S14.3 — présence dans les sources citées par les IA (JSON).
  try { await env.DB.prepare("ALTER TABLE sentinel_geo ADD COLUMN last_sources_check TEXT").run(); } catch (_) { /* déjà présent */ }
  // S12.2 — couverture du DERNIER score affiché sur la vignette (sample|full).
  try { await env.DB.prepare("ALTER TABLE sentinel_sites ADD COLUMN last_coverage TEXT").run(); } catch (_) { /* déjà présent */ }
  // S11 — couverture de l'audit : 'sample' (express, 5 pages) | 'full' (crawl complet).
  try { await env.DB.prepare("ALTER TABLE sentinel_audits ADD COLUMN coverage TEXT").run(); } catch (_) { /* déjà présent */ }
  // S15.2 — âge max du cache CDN observé pendant l'audit (transparence).
  try { await env.DB.prepare("ALTER TABLE sentinel_audits ADD COLUMN cache_age INTEGER").run(); } catch (_) { /* déjà présent */ }
  // S11 — crawl complet asynchrone : 1 job par site + file de pages (pattern sweepDue).
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sentinel_crawls (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default', site_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running', total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), finished_at TEXT)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sentinel_crawl_pages (
    crawl_id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT 'default', url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', result TEXT,
    PRIMARY KEY (crawl_id, url))`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sentinel_crawl_pages_status ON sentinel_crawl_pages(status, crawl_id)").run();
  // S14.1 — crédit sitemap propagé aux pages du crawl (comme l'express le fait).
  try { await env.DB.prepare("ALTER TABLE sentinel_crawls ADD COLUMN has_sitemap INTEGER").run(); } catch (_) { /* déjà présent */ }
  _schemaReady = true;
}

// ── Auth / tenant ───────────────────────────────────────────────
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
  try { await env.DB.prepare("INSERT OR IGNORE INTO tenants (id, name, plan) VALUES (?, ?, ?)").bind(id, 'Client Keystone', plan || 'STARTER').run(); }
  catch (_) { /* non bloquant */ }
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

// S17.1 — séparateur décimal FRANÇAIS dans les textes lus par le client.
// Le résumé « en clair » écrivait déjà « 3,4 s » quand le titre du finding et
// la carte KPI affichaient « 3.4 s » : trois écritures du même nombre sur une
// seule page de rapport. Les coordonnées SVG, elles, gardent le point.
const _fr1 = (n) => Number(n).toFixed(1).replace('.', ',');

// ── Sondes (fetch) ──────────────────────────────────────────────
function _classify(status) { return (status >= 200 && status < 400) ? 1 : 0; }

async function _probe(url) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS); const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const ms = Date.now() - t0; const status = res.status; const ok = _classify(status);
    const headers = {}; for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
    // S16.2 — détection sur signatures (lib, testée). L'ancienne sonde
    // cherchait « wix » dans TOUTES les valeurs d'en-tête : les jetons
    // aléatoires de Squarespace la faisaient mentir une fois sur ~500.
    const platform = detectPlatform(await res.text(), headers);
    return { ok, status, ms, error: ok ? null : `HTTP ${status}`, platform };
  } catch (e) {
    return { ok: 0, status: 0, ms: Date.now() - t0, error: (e && e.name === 'AbortError') ? 'Délai dépassé' : (e && e.message || 'Inaccessible'), platform: 'unknown' };
  } finally { clearTimeout(timer); }
}

async function _check(url) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS); const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const ms = Date.now() - t0; const status = res.status;
    try { await res.body?.cancel?.(); } catch (_) {}
    return { ok: _classify(status), status, ms, error: _classify(status) ? null : `HTTP ${status}` };
  } catch (e) {
    return { ok: 0, status: 0, ms: Date.now() - t0, error: (e && e.name === 'AbortError') ? 'Délai dépassé' : (e && e.message || 'Inaccessible') };
  } finally { clearTimeout(timer); }
}

// Enregistre un relevé + maj cache. Renvoie { transition: 'down'|'up'|null }.
async function _recordCheck(env, tenant, siteId, r) {
  const prev = await env.DB.prepare("SELECT last_ok, last_checked_at, consecutive_fails FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(siteId, tenant).first();
  await env.DB.prepare("INSERT INTO sentinel_checks (id, tenant_id, site_id, ok, status, ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(generateId(), tenant, siteId, r.ok, r.status || 0, r.ms || 0, r.error || null).run();
  await env.DB.prepare(
    `UPDATE sentinel_sites SET last_checked_at = datetime('now'), last_ok = ?, last_status = ?, last_ms = ?,
            consecutive_fails = CASE WHEN ? = 1 THEN 0 ELSE consecutive_fails + 1 END,
            next_check_at = datetime('now', '${CHECK_INTERVAL}'), updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?`
  ).bind(r.ok, r.status || 0, r.ms || 0, r.ok, siteId, tenant).run();

  const prevFails = (prev && prev.consecutive_fails) || 0;
  const newFails = r.ok ? 0 : prevFails + 1;
  let transition = null;
  if (!r.ok && newFails === DOWN_THRESHOLD) transition = 'down';
  else if (r.ok && prevFails >= DOWN_THRESHOLD) transition = 'up';
  return { transition };
}

// ── Alertes web push (S1.5) ─────────────────────────────────────
function _hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } }
// S15.1 — hôte complet (www conservé) et ré-hébergement d'une URL sur cet hôte.
function _fullHostOf(u) { try { return new URL(u).hostname; } catch (_) { return ''; } }
function _rehost(u, host) { try { const x = new URL(u); if (host && x.hostname.replace(/^www\./, '') === host.replace(/^www\./, '')) x.hostname = host; return x.href; } catch (_) { return u; } }
async function _alert(env, tenant, site, kind) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return;
  let vapid;
  try { vapid = { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: 'mailto:' + (env.SDQR_DPO_EMAIL || 'contact@protein-keystone.com') }; }
  catch (_) { return; }
  const subs = (await env.DB.prepare("SELECT endpoint, p256dh, auth FROM sentinel_push_subs WHERE tenant_id = ?").bind(tenant).all()).results || [];
  if (!subs.length) return;
  const name = site.label || _hostOf(site.url);
  const payload = kind === 'down'
    ? { kind: 'sentinel-alert', title: 'Site hors ligne', body: `${name} ne répond plus.`, siteId: site.id, url: './app' }
    : { kind: 'sentinel-alert', title: 'Site rétabli', body: `${name} est de nouveau en ligne.`, siteId: site.id, url: './app' };
  for (const s of subs) {
    try { const code = await sendPush(s, payload, vapid); if (code === 404 || code === 410) await env.DB.prepare("DELETE FROM sentinel_push_subs WHERE endpoint = ?").bind(s.endpoint).run(); }
    catch (_) {}
  }
}

// ── Audit on-page (S2 ; moteur pur extrait en S8 → lib/audit-page.js) ──
async function _exists(url, withText) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), SUB_TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const ok = r.status >= 200 && r.status < 400; let text = '';
    if (ok && withText) text = (await r.text()).slice(0, 20000); else { try { await r.body?.cancel?.(); } catch (_) {} }
    return { ok, text };
  } catch (_) { return { ok: false, text: '' }; } finally { clearTimeout(timer); }
}
function _between(html, re) { const m = html.match(re); return m ? (m[1] || '').trim() : ''; }

// opts.skipSite : audit ON-PAGE seul (pour les pages internes du crawl) —
// saute robots/sitemap + les findings « site-level » (sitemap, sous-domaine Wix),
// déjà émis une fois sur la page d'accueil. opts.sitemapKnown propage le crédit
// SEO « sitemap présent » aux pages internes sans re-vérifier.
async function _audit(url, opts = {}) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  let html = '', headers = null, reachable = false, truncated = false;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    headers = {}; for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
    reachable = _classify(res.status) === 1;
    // S15.1 — l'URL EFFECTIVE après redirections (apex → www…) : c'est elle
    // qui dit sur quel hôte le contenu vit vraiment.
    var effectiveUrl = res.url || url;
    // S15.2 — l'en-tête `age` dit depuis combien de temps le CDN sert cette
    // copie. Incident fondateur (04/08, Mas) : correctif appliqué à la
    // source, rapport « inchangé » — trois pages servies depuis un cache de
    // 15-40 min. Sans cette donnée, le client conclut que l'outil se trompe
    // ou que son correctif a échoué.
    var cacheAge = parseInt(headers['age'] || '0', 10) || 0;
    const raw = await res.text();                    // corps déjà bufferisé entier
    truncated = raw.length > MAX_HTML;               // S8 : on le SAIT, on le dit
    html = truncated ? raw.slice(0, MAX_HTML) : raw;
  } catch (_) { /* injoignable → traité ci-dessous, PAS d'audit du vide */ } finally { clearTimeout(timer); }

  // S8/C6 — injoignable : aucun score, aucun finding. L'ancien « audit
  // minimal » notait un site down comme un site sans balises (SEO 10,
  // findings partout) : indistinguable d'un vrai site vide.
  if (!reachable) {
    return { reachable: false, scores: { seo: null, securite: null, accessibilite: null, presence: null },
             findings: [], indeterminate: [], truncated: false, sitemap: false };
  }

  // robots.txt + sitemap (best effort) — contrôle « site-level », fait sur la home.
  let sitemap = false;
  if (opts.skipSite) {
    sitemap = !!opts.sitemapKnown;
  } else {
    try {
      const origin = new URL(url).origin;
      const rb = await _exists(`${origin}/robots.txt`, true);
      if (rb.text && /sitemap:/i.test(rb.text)) sitemap = true;
      // S10/C20 — un sitemap doit CONTENIR du sitemap (urlset/sitemapindex/loc),
      // pas juste répondre 200 (page d'erreur HTML, soft redirect…).
      if (!sitemap) { const sm = await _exists(`${origin}/sitemap.xml`, true); sitemap = sm.ok && sitemapLooksValid(sm.text); }
    } catch (_) {}
  }

  // S16.2 — la signature relevée sur CE document prime sur la valeur stockée
  // (mal détectée à la création, elle restait figée à vie et exemptait à tort
  // trois en-têtes de sécurité). Une ABSENCE de signature, elle, ne prouve
  // rien : on garde alors la valeur connue — même asymétrie de preuve qu'en S8.
  const detected = detectPlatform(html, headers);
  const platform = detected !== 'custom' ? detected : (opts.platform || 'custom');

  // Analyse pure (lib/audit-page.js) — testée sur fixtures réelles (S8).
  const a = analyzePage(html, { truncated, headers, skipSite: opts.skipSite, sitemap, url, platform });
  // S13.2 — coquille SPA : marqueur dédié dans les indéterminés (persiste,
  // le front l'affiche comme « site en rendu client », pas comme un défaut).
  if (a.spaShell && !a.indeterminate.includes('_spa')) a.indeterminate.unshift('_spa');
  // S16.2 — la plateforme est re-déduite du document DÉJÀ téléchargé (aucune
  // requête en plus). L'appelant s'en sert pour corriger la valeur stockée :
  // sans cela, une détection erronée à la création du site restait figée à vie.
  return { reachable, ...a, sitemap, detectedPlatform: detected, platform,
           effectiveUrl: typeof effectiveUrl !== 'undefined' ? effectiveUrl : url, cacheAge: typeof cacheAge !== 'undefined' ? cacheAge : 0 };
}

// ── V2 · Crawl multi-pages — découverte + agrégation ────────────
const MAX_AUDIT_PAGES = 5;   // home + 4 pages internes (coût borné)

function _pathOf(u) { try { const p = new URL(u).pathname; return p && p !== '/' ? p.replace(/\/$/, '') : '/'; } catch (_) { return u; } }

// Extrait les URLs de pages d'un sitemap (1 niveau d'index .xml toléré). Borné.
async function _sitemapLocs(smUrl, norm, depth, budget) {
  const out = [];
  try {
    const r = await _exists(smUrl, true);
    if (!r.ok || !r.text) return out;
    const locs = (r.text.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || []).map((m) => m.replace(/<\/?loc>/gi, '').trim());
    for (const loc of locs) {
      if (out.length >= budget) break;
      if (/\.xml(\?|$)/i.test(loc)) { if (depth > 0) out.push(...await _sitemapLocs(loc, norm, depth - 1, budget - out.length)); }
      else { const u2 = norm(loc); if (u2) out.push(u2); }
    }
  } catch (_) {}
  return out;
}

// Découvre jusqu'à `max` pages internes (hors home) : sitemap.xml puis liens de la home.
async function _discoverPages(url, max) {
  let origin = '', host = '';
  try { const u = new URL(url); origin = u.origin; host = u.hostname.replace(/^www\./, ''); } catch (_) { return []; }
  const ASSET = /\.(pdf|jpe?g|png|gif|svg|webp|ico|zip|mp4|mp3|css|js|json|xml)(\?|$)/i;
  const norm = (h) => {
    try { const x = new URL(h, origin); if (x.hostname.replace(/^www\./, '') !== host) return null; if (!/^https?:$/.test(x.protocol)) return null; x.hash = ''; x.search = ''; return x.href.replace(/\/$/, '') || x.href; } catch (_) { return null; }
  };
  const found = new Set();
  for (const u2 of await _sitemapLocs(`${origin}/sitemap.xml`, norm, 1, max * 3)) { if (!ASSET.test(u2)) found.add(u2); }
  if (found.size < max) {
    try {
      const r = await _exists(url, true);
      if (r.ok && r.text) {
        for (const h of (r.text.match(/href=["']([^"'#]+)["']/gi) || [])) {
          const u2 = norm(h.replace(/^href=["']/i, '').replace(/["']$/, ''));
          if (u2 && !ASSET.test(u2)) found.add(u2);
        }
      }
    } catch (_) {}
  }
  const homeNorm = norm(url);
  // Exclut la home et ses variantes (path « / », ex. www) → pas de doublon.
  const candidates = [...found].filter((u2) => u2 !== homeNorm && _pathOf(u2) !== '/');
  // S9 — sélection PRIORISÉE (l'ancien slice prenait les N premières, ordre
  // arbitraire : sur le Mas, /contact et /nos-offres n'étaient jamais vus) :
  //   1. pages « métier » (contact, offres, à-propos) — le NAP vit sur /contact ;
  //   2. diversité de gabarits : round-robin sur le 1er segment de chemin,
  //      plutôt que N pages du même template.
  const PRIORITY = /\/(contact|nous-contacter|contactez|nos-offres|offres|tarifs|prix|a-propos|apropos|about|qui-sommes-nous)(\/|$)/i;
  const prio = candidates.filter((u2) => PRIORITY.test(u2));
  const rest = candidates.filter((u2) => !PRIORITY.test(u2));
  const bySeg = new Map();
  for (const u2 of rest) {
    const seg = (_pathOf(u2).split('/')[1] || '').replace(/-(le|la|les|l)$/, '');
    if (!bySeg.has(seg)) bySeg.set(seg, []);
    bySeg.get(seg).push(u2);
  }
  const groups = [...bySeg.values()];
  const diverse = [];
  for (let i = 0; diverse.length < rest.length; i++) {
    let took = false;
    for (const g of groups) { if (g[i]) { diverse.push(g[i]); took = true; } }
    if (!took) break;
  }
  // total = pages internes détectées + la home (pour le « X sur N » du rapport)
  return { urls: [...prio, ...diverse].slice(0, max), total: candidates.length + 1 };
}

// Audite la home + N pages internes en parallèle, agrège scores + findings.
// S11 : l'agrégation vit dans lib/audit-page.js (aggregatePages) — partagée
// avec la finalisation du crawl complet.
async function _auditSite(url, platform) {
  const home = await _audit(url, { platform });
  // S15.1 — UN SEUL hôte pour tout l'audit : celui où la home vit réellement
  // (redirections suivies). Avant : home sur l'URL enregistrée (apex), pages
  // internes sur celles du sitemap (www) → deux couches de cache CDN
  // différentes dans le même rapport, incohérences possibles sans défaut réel.
  const canonHost = _fullHostOf(home.effectiveUrl || url);
  let extraUrls = [], pagesTotal = 1;
  try {
    const d = await _discoverPages(url, MAX_AUDIT_PAGES - 1);
    extraUrls = d.urls.map((u) => _rehost(u, canonHost));
    pagesTotal = d.total;
  } catch (_) {}
  // S16.2 — les pages internes héritent de la plateforme retenue pour la HOME
  // (signature fraîche), pas de la valeur stockée qui peut être erronée.
  const extras = (await Promise.all(extraUrls.map((u) =>
    _audit(u, { skipSite: true, sitemapKnown: home.sitemap, platform: home.platform }).then((r) => ({ url: u, ...r })).catch(() => null)
  ))).filter((p) => p && p.reachable);
  const pagesAudited = [{ url, ...home }].concat(extras).map((p) => ({ ...p, path: _pathOf(p.url) }));

  const agg = aggregatePages(pagesAudited);
  const pages = pagesAudited.map((p) => ({ path: p.path, score: _globalScore({ ...p.scores }) }));
  const cacheAgeMax = Math.max(0, ...pagesAudited.map((p) => p.cacheAge || 0));   // S15.2
  return { reachable: home.reachable, ...agg, pages, pageCount: pagesAudited.length, cacheAgeMax,
           platform: home.platform, detectedPlatform: home.detectedPlatform,
           pagesTotal: Math.max(pagesTotal, pagesAudited.length), geoHints: home.geoHints || null };
}

// ═══ S11 · Crawl complet asynchrone (pattern sweepDue) ═════════════════
// L'audit express (5 pages, synchrone) échantillonne ; le crawl audite TOUT
// (borné par plan) en tâche de fond : file D1, N pages par tick de cron,
// agrégation finale = un audit « coverage:full » dans l'historique.
const CRAWL_TICK_PAGES = 5;      // pages auditées par tick (1 min) — mémoire bornée (séquentiel)
function _crawlLimit(plan) {
  const p = String(plan || '').toUpperCase();
  if (p === 'ADMIN') return 100;
  if (p === 'MAX' || p === 'BETA') return 50;
  if (p === 'PRO') return 25;
  return 10;
}

// S15.1 — URL finale après redirections (sans télécharger le corps).
async function _resolveFinalUrl(url) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), SUB_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    try { await res.body?.cancel?.(); } catch (_) {}
    return res.url || url;
  } catch (_) { return url; } finally { clearTimeout(timer); }
}

// Découverte EXHAUSTIVE (sitemap prioritaire + liens de la home), bornée.
async function _discoverAllPages(url, max) {
  const d = await _discoverPages(url, max);
  return d;   // _discoverPages est déjà borné/normalisé ; max élevé = quasi-exhaustif sur sitemap
}

// POST /sites/:id/crawl — démarre un crawl complet (409 si déjà en cours).
export async function handleSiteCrawlStart(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label, platform FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);
  const running = await env.DB.prepare("SELECT id, done, total FROM sentinel_crawls WHERE site_id = ? AND tenant_id = ? AND status = 'running'").bind(id, g.tenant).first();
  if (running) return json({ crawl: { id: running.id, status: 'running', done: running.done, total: running.total } }, 200, origin);

  const limit = _crawlLimit(g.plan);
  // S15.1 — un crawl = UN hôte : celui où la home vit après redirections.
  // Avant : home en apex + pages internes en www (sitemap) → deux couches de
  // cache CDN dans le même rapport (incident du 04/08 : 1 page propre, 10
  // « fautives » alors que le correctif était partout à la source).
  const finalHome = await _resolveFinalUrl(site.url);
  const crawlHost = _fullHostOf(finalHome) || _fullHostOf(site.url);
  let urls = [finalHome];
  try {
    const d = await _discoverAllPages(site.url, Math.max(0, limit - 1));
    urls = [finalHome, ...d.urls.map((u) => _rehost(u, crawlHost))];
  } catch (_) {}
  // S14.1 — le contrôle sitemap est SITE-level : fait une fois ici, propagé
  // à chaque page du crawl (sitemapKnown). Sans ça, les pages internes
  // perdaient 10 pts SEO chacune EN SILENCE : le crawl complet du Mas
  // affichait SEO 90 vs 99 en express, inexpliqué — violation de la règle
  // S12 « tout point perdu a sa ligne », constatée sur les rapports réels.
  let hasSitemap = 0;
  try {
    const origin2 = new URL(site.url).origin;
    const rb = await _exists(`${origin2}/robots.txt`, true);
    if (rb.text && /sitemap:/i.test(rb.text)) hasSitemap = 1;
    if (!hasSitemap) { const sm = await _exists(`${origin2}/sitemap.xml`, true); hasSitemap = (sm.ok && sitemapLooksValid(sm.text)) ? 1 : 0; }
  } catch (_) {}
  const crawlId = generateId();
  await env.DB.prepare("INSERT INTO sentinel_crawls (id, tenant_id, site_id, status, total, done, has_sitemap) VALUES (?, ?, ?, 'running', ?, 0, ?)")
    .bind(crawlId, g.tenant, id, urls.length, hasSitemap).run();
  // Lot d'INSERT bornés (D1 batch) — la home est la 1re page de la file.
  const stmts = urls.map((u) => env.DB.prepare("INSERT OR IGNORE INTO sentinel_crawl_pages (crawl_id, tenant_id, url) VALUES (?, ?, ?)").bind(crawlId, g.tenant, u));
  await env.DB.batch(stmts);
  return json({ crawl: { id: crawlId, status: 'running', done: 0, total: urls.length,
    note: `Crawl lancé : ${urls.length} pages (plafond ${limit} sur votre plan). Progression ~${CRAWL_TICK_PAGES} pages/min.` } }, 200, origin);
}

// GET /sites/:id/crawl — état du dernier crawl (progression ou résultat).
export async function handleSiteCrawlStatus(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const own = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!own) return err('Site introuvable.', 404, origin);
  const c = await env.DB.prepare("SELECT id, status, total, done, created_at, finished_at FROM sentinel_crawls WHERE site_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 1").bind(id, g.tenant).first();
  return json({ crawl: c || null }, 200, origin);
}

// Sweep cron (1 min) — audite un lot de pages en attente, SÉQUENTIEL
// (1 document de ≤ 4 Mo en mémoire à la fois), puis finalise les crawls
// dont la file est vide. No-op à coût quasi nul quand rien n'est dû.
export async function sweepDueCrawls(env) {
  await _ensureSchema(env);
  const due = (await env.DB.prepare(
    `SELECT p.crawl_id, p.tenant_id, p.url, c.site_id, c.has_sitemap
       FROM sentinel_crawl_pages p JOIN sentinel_crawls c ON c.id = p.crawl_id
      WHERE p.status = 'pending' AND c.status = 'running'
      ORDER BY c.created_at ASC LIMIT ${CRAWL_TICK_PAGES}`
  ).all()).results || [];
  let audited = 0;
  for (const row of due) {
    let result = null;
    try {
      const site = await env.DB.prepare("SELECT url, platform FROM sentinel_sites WHERE id = ?").bind(row.site_id).first();
      const isHome = site && _pathOf(row.url) === _pathOf(site.url);
      const r = await _audit(row.url, { skipSite: !isHome, platform: site && site.platform, sitemapKnown: !!row.has_sitemap });   // S14.1
      result = { path: _pathOf(row.url), reachable: r.reachable, scores: r.scores, findings: r.findings,
                 indeterminate: r.indeterminate, notApplicable: r.notApplicable, truncated: r.truncated,
                 canonicalHrefHost: r.canonicalHrefHost || null, sitemap: r.sitemap, cacheAge: r.cacheAge || 0, geoHints: isHome ? r.geoHints : null };
    } catch (_) { /* page en échec → 'failed', le crawl continue */ }
    await env.DB.prepare("UPDATE sentinel_crawl_pages SET status = ?, result = ? WHERE crawl_id = ? AND url = ?")
      .bind(result && result.reachable ? 'done' : 'failed', result ? JSON.stringify(result) : null, row.crawl_id, row.url).run();
    await env.DB.prepare("UPDATE sentinel_crawls SET done = done + 1 WHERE id = ?").bind(row.crawl_id).run();
    audited++;
  }

  // Finalisation des crawls sans page en attente.
  const finishable = (await env.DB.prepare(
    `SELECT c.id, c.tenant_id, c.site_id FROM sentinel_crawls c
      WHERE c.status = 'running'
        AND NOT EXISTS (SELECT 1 FROM sentinel_crawl_pages p WHERE p.crawl_id = c.id AND p.status = 'pending')`
  ).all()).results || [];
  let finalized = 0;
  for (const c of finishable) {
    try { await _finalizeCrawl(env, c); finalized++; }
    catch (_) { await env.DB.prepare("UPDATE sentinel_crawls SET status = 'failed', finished_at = datetime('now') WHERE id = ?").bind(c.id).run().catch(() => {}); }
  }
  return { pages: audited, finalized };
}

// Agrège les pages du crawl → un audit « coverage:full » complet (mêmes
// champs que l'audit express : CWV home, dispo fenêtrée, version moteur).
async function _finalizeCrawl(env, c) {
  const rows = (await env.DB.prepare("SELECT url, status, result FROM sentinel_crawl_pages WHERE crawl_id = ?").bind(c.id).all()).results || [];
  const pagesAudited = rows.filter((r) => r.status === 'done' && r.result)
    .map((r) => { try { return JSON.parse(r.result); } catch (_) { return null; } })
    .filter((p) => p && p.reachable);
  const site = await env.DB.prepare("SELECT id, url, label, platform FROM sentinel_sites WHERE id = ?").bind(c.site_id).first();
  if (!site || !pagesAudited.length) {
    await env.DB.prepare("UPDATE sentinel_crawls SET status = 'failed', finished_at = datetime('now') WHERE id = ?").bind(c.id).run();
    return;
  }
  const agg = aggregatePages(pagesAudited);
  const pages = pagesAudited.map((p) => ({ path: p.path, score: _globalScore({ ...p.scores }) }));
  const cacheAgeMax = Math.max(0, ...pagesAudited.map((p) => p.cacheAge || 0));   // S15.2
  const up = await _uptimeWindow(env, site.id);
  const dispo = up.pct == null ? null : Math.round(up.pct);
  // S14.1 — la perf se mesure sur la home : si une mesure < 6 h existe
  // (l'audit express de tout à l'heure), on la RÉUTILISE au lieu de relancer
  // 3 chargements — deux médianes à 7 min d'écart donnaient perf 80 vs 64
  // sur la même page (variance gratuite entre express et complet).
  let cwv = await _lastCwv(env, site.id, "-6 hours");
  if (!cwv) {
    cwv = await _measurePerf(env, site.url);
    if (cwv) cwv = smoothCwv(cwv, await _prevCwvs(env, site.id));   // S17 — même lissage que l'express
  }
  if (!cwv) cwv = await _lastCwv(env, site.id);      // S12.3 — repli étiqueté (stale_from)
  const perf = _perfScore(cwv);
  const scores = { disponibilite: dispo, performance: perf, ...agg.scores };
  const findings = agg.findings.slice();
  if (cwv) {
    if (cwv.lcp >= 4000) findings.push({ axis: 'performance', sev: 'high', key: 'perf_lcp', title: `Chargement lent (LCP ${_fr1(cwv.lcp / 1000)} s)`, detail: 'Cible : moins de 2,5 s — compressez images et scripts.' });
    else if (cwv.lcp >= 2500) findings.push({ axis: 'performance', sev: 'medium', key: 'perf_lcp', title: `Chargement à améliorer (LCP ${_fr1(cwv.lcp / 1000)} s)`, detail: 'Cible : moins de 2,5 s.' });
    if (cwv.cls >= 0.25) findings.push({ axis: 'performance', sev: 'medium', key: 'perf_cls', title: `La page saute au chargement (CLS ${cwv.cls})`, detail: 'Réservez les dimensions des images, bannières et publicités.' });
    if (cwv.weightKb >= 3072) findings.push({ axis: 'performance', sev: 'low', key: 'perf_weight', title: `Page lourde (${_fr1(cwv.weightKb / 1024)} Mo)`, detail: 'Allégez images et scripts pour accélérer le mobile.' });
  }
  _cacheHint(findings, pagesAudited.length);        // S15.3
  _attachFixes(findings, { url: site.url, host: _hostOf(site.url), platform: site.platform });
  const global = _globalScore(scores);
  attachGains(findings, { scores, pageCount: pagesAudited.length, notApplicable: agg.notApplicable });   // S12.1
  await env.DB.prepare("INSERT INTO sentinel_audits (id, tenant_id, site_id, score, scores, findings, cwv, pages, indeterminate, not_applicable, engine, pages_total, coverage, cache_age) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'full', ?)")
    .bind(generateId(), c.tenant_id, site.id, global, JSON.stringify(scores), JSON.stringify(findings),
          cwv ? JSON.stringify(cwv) : null, JSON.stringify(pages), JSON.stringify(agg.indeterminate),
          JSON.stringify(agg.notApplicable), SENTINEL_ENGINE_VERSION, pagesAudited.length, cacheAgeMax || 0).run();
  await env.DB.prepare("UPDATE sentinel_sites SET last_score = ?, last_scores = ?, last_coverage = 'full', last_audit_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .bind(global, JSON.stringify(scores), site.id).run();
  await env.DB.prepare("UPDATE sentinel_crawls SET status = 'done', finished_at = datetime('now') WHERE id = ?").bind(c.id).run();
}

// Disponibilité (axe S1) — % de relevés OK sur 24 h.
async function _uptime24(env, siteId) {
  const up = await env.DB.prepare("SELECT AVG(ok) AS rate, COUNT(*) AS n FROM sentinel_checks WHERE site_id = ? AND checked_at >= datetime('now','-1 day')").bind(siteId).first();
  return (up && up.n) ? Math.round((up.rate || 0) * 100) : null;
}

// S9/C11-C12 — disponibilité FENÊTRÉE et honnête : « 99,9 % sur 30 jours »
// n'est affichable que si on a ~30 jours de relevés. Fenêtre réelle =
// min(30 j, âge de l'historique) ; couverture < 50 % des relevés attendus
// (1 check / 5 min) → « historique insuffisant » (null, axe n/a).
async function _uptimeWindow(env, siteId) {
  const row = await env.DB.prepare(
    `SELECT AVG(ok) AS rate, COUNT(*) AS n,
            CAST(julianday('now') - julianday(MIN(checked_at)) AS REAL) AS ageDays
       FROM sentinel_checks WHERE site_id = ? AND checked_at >= datetime('now','-30 day')`
  ).bind(siteId).first();
  if (!row || !row.n) return { pct: null, windowDays: 0, n: 0 };
  const windowDays = Math.max(1, Math.min(30, Math.ceil(row.ageDays || 1)));
  const expected = windowDays * 288;                        // 288 relevés/jour à 5 min
  if (row.n < expected * 0.5) return { pct: null, windowDays, n: row.n, insufficient: true };
  return { pct: Math.round((row.rate || 0) * 1000) / 10, windowDays, n: row.n };
}

// ── Handlers ────────────────────────────────────────────────────
// ── Générateur de correctifs clé en main (S4, déterministe) ─────
// Pour chaque finding (par clé), des étapes contextualisées à la plateforme
// + le code prêt à coller quand c'est pertinent. Zéro IA, zéro coût.
function _headSteps(platform) {
  if (platform === 'wordpress') return ['Installez l\'extension gratuite « WPCode » (Extensions › Ajouter, puis Activer).', 'Code Snippets › + Add Snippet › code HTML, emplacement « Site Wide Header ».', 'Collez le code ci-dessous, enregistrez et activez.'];
  if (platform === 'wix') return ['Dans Wix : Réglages › Code personnalisé (Custom Code) › + Ajouter.', 'Collez le code, placez-le dans le <head>, appliquez à « Toutes les pages ».', 'Enregistrez.'];
  return ['Collez le code ci-dessous dans la balise <head> de votre page (thème/gabarit).', 'Ou transmettez ce bloc à votre webmaster.'];
}
// ── Correctifs NATIFS Wix (V2 · intégration Wix) ────────────────
// Pour un site Wix, on guide via l'UI Wix réelle (tableau de bord / éditeur)
// plutôt que par injection de code <head> — c'est là qu'un utilisateur Wix
// agit vraiment. Renvoie null pour les clés non couvertes (→ switch générique,
// qui garde des branches Wix pour les en-têtes sécurité).
function _wixFix(key, ctx) {
  let origin = ctx.url || ''; try { origin = new URL(ctx.url).origin; } catch (_) {}
  switch (key) {
    case 'meta_length':
    case 'meta_missing': return { steps: [
      'Tableau de bord Wix › Marketing et SEO › « Outils SEO » (ou, dans l\'éditeur, ouvrez la page et cliquez l\'icône SEO).',
      'Section « Aperçu sur Google » › champ « Description » : rédigez 50 à 160 caractères qui donnent envie de cliquer.',
      'Enregistrez, puis Publiez le site.'] };
    case 'title_missing': case 'title_long': return { steps: [
      'Dans l\'éditeur Wix : ouvrez la page › panneau SEO de la page › « Titre SEO (balise title) ».',
      'Visez 50 à 60 caractères, format conseillé : [Activité] à [Ville] | [Nom].',
      'Enregistrez et publiez.'] };
    case 'og_title': case 'og_image': return { steps: [
      'Éditeur Wix › ouvrez la page › panneau SEO › onglet « Partage sur les réseaux sociaux ».',
      'Définissez le titre et surtout l\'IMAGE de partage (recommandé 1200 × 630 px).',
      'Enregistrez et publiez.'] };
    case 'img_alt': return { steps: [
      'Éditeur Wix : cliquez l\'image › icône « Réglages » › champ « Texte alternatif ».',
      'Décrivez l\'image en une courte phrase (utile pour Google Images et l\'accessibilité).',
      'Répétez pour chaque image signalée, puis publiez.'] };
    case 'lang': return { steps: [
      'Tableau de bord Wix › Réglages › « Langues du site » : assurez-vous que le français est la langue principale.',
      'Wix renseigne alors automatiquement lang="fr" ; republiez le site.'] };
    case 'h1': return { steps: [
      'Éditeur Wix : sélectionnez le titre principal de la page › dans la barre de texte, choisissez le style « Titre 1 ».',
      'Gardez UN seul Titre 1 par page ; passez les sous-titres en « Titre 2 / 3 ».',
      'Publiez.'] };
    // S16/C24 — Wix génère TOUT SEUL une fiche « Local Business » sur la page
    // d'accueil dès que « Infos de l'entreprise » contient un nom et une
    // adresse. Elle n'a pas d'@id : elle reste étrangère au bloc que vous avez
    // ajouté vous-même. Wix permet de la convertir en balisage personnalisé —
    // c'est là qu'on pose l'@id commun (ou qu'on l'exclut, si votre bloc est
    // plus riche : LodgingBusiness bat LocalBusiness pour un hébergement).
    case 'jsonld_entity_split': return { steps: [
      'Tableau de bord Wix › Marketing et SEO › « Réglages SEO » › choisissez le type de page « Page d\'accueil » › « Personnaliser les valeurs par défaut ».',
      'Ouvrez le balisage « Local Business » : « Aperçu du préréglage » puis « Convertir en balisage personnalisé » (c\'est ce qui rend le JSON-LD éditable).',
      `Dans le code, ajoutez la ligne "@id" avec EXACTEMENT la même valeur que dans votre propre bloc : "@id": "${origin || 'https://votre-domaine.fr'}/#business". Deux fiches qui partagent un @id sont fusionnées en une seule entité.`,
      'Variante plus radicale, si votre bloc maison est le plus complet : au même endroit, EXCLUEZ le balisage Local Business de la page d\'accueil — vous ne gardez qu\'une fiche, la vôtre.',
      'Enregistrez, puis PUBLIEZ (c\'est la publication qui purge le cache Wix).',
      'Contrôlez avec l\'outil de test des résultats enrichis de Google : une seule entité doit apparaître.'],
      codeLabel: 'La ligne à ajouter dans le balisage Wix', code:
`"@id": "${origin || 'https://votre-domaine.fr'}/#business"` };
    case 'canonical': return { steps: [
      'Wix gère les balises canoniques automatiquement — en général, rien à faire.',
      'Si vraiment nécessaire : éditeur › page › panneau SEO › « Avancé » › « Balise canonique ».'] };
    case 'viewport': return { steps: [
      'Les sites Wix sont responsives : la balise viewport est ajoutée automatiquement.',
      'Si elle est signalée absente, vérifiez qu\'un code personnalisé injecté dans le <head> ne la supprime pas.'] };
    case 'sitemap': return { steps: [
      `Wix génère et met à jour votre sitemap automatiquement : ${origin}/sitemap.xml — rien à créer.`,
      'Soumettez-le une seule fois dans Google Search Console › « Sitemaps ».'] };
    case 'jsonld': case 'nap_localbiz': case 'nap_address': case 'nap_phone': case 'nap_hours': return {
      steps: [
        'Tableau de bord Wix › Réglages › « Infos de l\'entreprise » : renseignez le nom, l\'adresse, le téléphone et les horaires.',
        'Wix publie alors automatiquement votre fiche et vos données structurées (LocalBusiness).',
        'Affichez aussi ces infos sur une page Contact (adresse complète, numéro en lien cliquable). Pour aller plus loin, le balisage ci-dessous peut être collé via Réglages › Code personnalisé (head).'],
      codeLabel: 'Données structurées LocalBusiness (optionnel — avancé)',
      code:
`<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": "${origin}/#business",
  "name": "Nom de votre établissement",
  "url": "${origin}",
  "telephone": "+33 1 23 45 67 89",
  "address": { "@type": "PostalAddress", "streetAddress": "12 rue Exemple", "addressLocality": "Ville", "postalCode": "00000", "addressCountry": "FR" },
  "openingHours": "Mo-Fr 09:00-18:00",
  "priceRange": "€€"
}
</script>` };
    case 'perf_lcp': return { steps: [
      'Wix sert déjà vos images en format optimisé (WebP) — le levier principal est ailleurs.',
      'Allégez la page d\'accueil : limitez les applications tierces, les vidéos d\'arrière-plan et les animations.',
      'Éditeur › « Optimiser le site » (Site Speed) : suivez les recommandations Wix.'] };
    case 'perf_cls': return { steps: [
      'Évitez les bannières/pop-ups qui apparaissent après le chargement et décalent la page.',
      'Éditeur Wix › « Optimiser le site » : appliquez les conseils de stabilité d\'affichage.'] };
    case 'perf_weight': return { steps: [
      'Réduisez le nombre d\'applications Wix (App Market) et de scripts tiers ajoutés à la page.',
      'Remplacez les vidéos d\'arrière-plan lourdes par une image ; limitez les polices personnalisées.'] };
  }
  return null;
}
function _fixFor(key, ctx, f) {
  const url = ctx.url || '';
  let origin = url; try { origin = new URL(url).origin; } catch (_) {}
  const head = _headSteps(ctx.platform);
  // Site Wix → privilégier le correctif natif Wix (sinon repli sur le générique).
  // S10/C19 — variante typée AVANT le dispatch plateforme : pour un
  // hébergement, le correctif « horaires » = checkinTime/checkoutTime.
  if (key === 'nap_hours' && f && f.entity === 'lodging') {
    return { steps: [
      'Pour un hébergement, Google et les IA attendent les heures d\'arrivée et de départ (checkinTime / checkoutTime), pas des horaires d\'ouverture.',
      'Ajoutez les deux champs ci-dessous à votre bloc JSON-LD existant (celui qui déclare votre LodgingBusiness).',
      ctx.platform === 'wix' ? 'Sur Wix : Réglages › Code personnalisé — modifiez le bloc de données structurées déjà en place.' : 'Le bloc se trouve dans le <head> de vos pages (ou via votre webmaster).'],
      codeLabel: 'Champs à ajouter au JSON-LD LodgingBusiness', code:
`"checkinTime": "16:00",
"checkoutTime": "10:00"` };
  }
  if (ctx.platform === 'wix') { const wf = _wixFix(key, ctx); if (wf) return wf; }
  switch (key) {
    // ── S10 — contrôles à valeur ──────────────────────────────────────────
    case 'jsonld_url_mismatch': return { steps: [
      'Ouvrez le bloc de données structurées (JSON-LD) de vos pages — sur Wix : Réglages › Code personnalisé, ou l\'embed HTML qui le contient.',
      `Remplacez la valeur du champ "url" (et "@id" le cas échéant) par l'adresse RÉELLE du site : ${ctx.url || 'votre domaine de production'}.`,
      'Bonnes pratiques : donnez le même "@id" (ex. ' + (ctx.url || 'https://votre-domaine.fr') + '#business) à tous les blocs décrivant votre établissement pour que les moteurs les fusionnent.',
      'IMPORTANT : cliquez « Publier » après la modification — c\'est la publication qui purge le cache Wix (sinon l\'ancienne version peut être servie jusqu\'à 24 h, à vous comme à Google).',
      'Vérifiez ensuite avec l\'outil de test des résultats enrichis de Google.'],
      codeLabel: 'Champs à corriger dans votre JSON-LD', code:
`"url": "${ctx.url || 'https://votre-domaine.fr'}",
"@id": "${ctx.url || 'https://votre-domaine.fr'}#business"` };
    case 'jsonld_entity_split': return { steps: [
      // S16.3 — le rapport Squarespace du 04/08 servait « Si votre site tourne
      // sous WordPress… » à un site qui n'est pas sous WordPress. Les étapes
      // parlent maintenant de la plateforme réellement détectée.
      'Repérez les DEUX blocs de données structurées qui décrivent votre établissement : le vôtre, et celui que votre plateforme (ou une extension SEO) ajoute automatiquement.',
      ...(ctx.platform === 'squarespace' ? ['Sur Squarespace, la fiche automatique est construite à partir de Réglages › « Business Information » : c\'est là que se corrigent nom, adresse et téléphone, et le bloc ajouté à la main doit s\'aligner dessus.']
        : ctx.platform === 'wordpress' ? ['Sur WordPress : quand deux extensions SEO (Yoast, Rank Math, un thème…) produisent chacune leur fiche, n\'en gardez qu\'une active — c\'est plus sain que de les aligner à la main.'] : []),
      `Donnez-leur le MÊME identifiant : ajoutez "@id": "${ctx.url ? (() => { try { return new URL(ctx.url).origin; } catch (_) { return 'https://votre-domaine.fr'; } })() : 'https://votre-domaine.fr'}/#business" dans CHACUN des deux blocs.`,
      'Alternative : supprimez le bloc en double et ne conservez que le plus complet.',
      'Republiez, puis vérifiez avec l\'outil de test des résultats enrichis de Google : une seule entité doit apparaître.'],
      codeLabel: 'L\'identifiant commun à poser dans les deux blocs', code:
`"@id": "${ctx.url ? (() => { try { return new URL(ctx.url).origin; } catch (_) { return 'https://votre-domaine.fr'; } })() : 'https://votre-domaine.fr'}/#business"` };
    case 'canonical_mismatch': return { steps: [
      'La balise canonical de la page pointe vers un AUTRE domaine : Google est invité à indexer ce domaine-là à votre place.',
      'Corrigez le href de <link rel="canonical"> pour qu\'il pointe vers la page elle-même, sur votre domaine.',
      'Sur plateforme (Wix/WordPress), le canonical est généré automatiquement : vérifiez le domaine connecté et les réglages SEO de la page.'],
      codeLabel: 'Canonical attendu', code: `<link rel="canonical" href="${ctx.url || 'https://votre-domaine.fr/cette-page'}">` };
    case 'canonical_inconsistent': return { steps: [
      'Certaines pages se déclarent en www, d\'autres sans : choisissez UNE forme et tenez-la partout.',
      'Vérifiez la redirection 301 de la forme non retenue vers la forme canonique (réglage domaine de votre hébergeur).',
      'Sur Wix : Réglages › Domaines — le domaine « principal » détermine la forme canonique générée.'] };
    case 'wix_subdomain': return { steps: [
      'Votre site est publié sur une adresse Wix gratuite (terminant par .wixsite.com) : Google la classe moins bien et elle inspire moins confiance.',
      'Tableau de bord Wix › Réglages › « Domaines » › « Connecter un domaine » : reliez un nom de domaine à votre marque (ex. votre-entreprise.fr).',
      'Un domaine personnalisé améliore le référencement, la crédibilité et le rendu lors des partages.'] };
    // S16.4 — le titre promettait « affichez un numéro cliquable » et la carte
    // ne livrait qu'un JSON-LD (constaté sur le rapport Squarespace du 04/08).
    // Le balisage satisfait le contrôle, mais ce n'est pas ce que lisent les
    // visiteurs : le geste visible passe donc en PREMIÈRE étape, le balisage
    // reste le complément structuré.
    case 'jsonld': case 'nap_localbiz': case 'nap_address': case 'nap_phone': case 'nap_hours':
      return { steps: [
        ...(key === 'nap_phone' ? ['Affichez d\'abord le numéro sur la page (en-tête ou pied de page), en lien cliquable : <a href="tel:+33612345678">06 12 34 56 78</a> — c\'est ce que voient vos visiteurs, et ce qu\'un mobile compose d\'un doigt.'] : []),
        ...(key === 'nap_address' ? ['Affichez d\'abord l\'adresse complète sur la page (pied de page ou page Contact) : rue, code postal, ville.'] : []),
        ...(key === 'nap_hours' ? ['Affichez d\'abord vos horaires sur la page — c\'est la première chose qu\'un client cherche.'] : []),
        ...head], codeLabel: 'Fiche établissement (LocalBusiness — nom, adresse, téléphone, horaires)', code:
`<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": "${origin}/#business",
  "name": "Nom de votre établissement",
  "url": "${origin}",
  "telephone": "+33 1 23 45 67 89",
  "address": { "@type": "PostalAddress", "streetAddress": "12 rue Exemple", "addressLocality": "Ville", "postalCode": "00000", "addressCountry": "FR" },
  "openingHours": "Mo-Fr 09:00-18:00",
  "priceRange": "€€"
}
</script>` };
    case 'meta_length':
    case 'meta_missing': return {
      steps: ctx.platform === 'wordpress' ? ['Avec Yoast SEO ou Rank Math : ouvrez la page › encart SEO › « Méta description ».', 'Collez le texte ci-dessous (personnalisez-le), enregistrez.']
           : ctx.platform === 'wix' ? ['Wix : ouvrez la page › Réglages SEO (SEO de base) › « Description ».', 'Collez le texte ci-dessous, enregistrez et publiez.']
           : ['Ajoutez cette balise dans le <head> de la page.'],
      codeLabel: 'Méta description (modèle à personnaliser)',
      code: `<meta name="description" content="[Votre activité] à [ville] — [bénéfice clé pour le client]. [Appel à l'action, ex. Réservez en ligne].">` };
    case 'title_missing': return { steps: head, codeLabel: 'Balise titre', code: `<title>[Votre activité] à [ville] | [Nom de l'établissement]</title>` };
    case 'viewport': return { steps: head, codeLabel: 'Balise viewport (mobile)', code: `<meta name="viewport" content="width=device-width, initial-scale=1">` };
    case 'canonical': return { steps: head, codeLabel: 'URL canonique', code: `<link rel="canonical" href="${url || origin}">` };
    case 'og_title': return { steps: head, codeLabel: 'Open Graph — titre', code: `<meta property="og:title" content="[Titre attractif de la page]">` };
    case 'og_image': return { steps: head, codeLabel: 'Open Graph — image', code: `<meta property="og:image" content="${origin}/votre-image-partage.jpg">` };
    case 'lang': return { steps: ['Modifiez la balise <html> d\'ouverture de votre page pour déclarer le français :'], codeLabel: 'Attribut de langue', code: `<html lang="fr">` };
    case 'sitemap': return {
      steps: ctx.platform === 'wordpress' ? ['Yoast/Rank Math génère le sitemap automatiquement (souvent /sitemap_index.xml).', 'Vérifiez qu\'il est déclaré dans robots.txt :']
           : ctx.platform === 'wix' ? ['Wix génère un sitemap par défaut à /sitemap.xml.', 'Vérifiez sa déclaration dans robots.txt :']
           : ['Générez un sitemap.xml et déclarez-le dans robots.txt :'],
      codeLabel: 'Ligne à ajouter dans robots.txt', code: `Sitemap: ${origin}/sitemap.xml` };
    case 'h1': return { steps: ['Assurez-vous d\'avoir UN seul titre principal (H1) par page — en général le titre principal défini dans l\'éditeur.', 'Les autres titres doivent être en H2/H3 (sous-titres).'] };
    case 'img_alt': return { steps: ['Pour chaque image, renseignez le « texte alternatif » (alt) qui décrit l\'image.', ctx.platform === 'wordpress' ? 'WordPress : Médias › sélectionnez l\'image › champ « Texte alternatif ».' : ctx.platform === 'wix' ? 'Wix : clic sur l\'image › Paramètres › « Texte alternatif ».' : 'Ajoutez l\'attribut alt="description" sur chaque <img>.'] };
    case 'perf_lcp': return { steps: ['Compressez l\'image principale (format WebP/AVIF) et donnez-lui une taille adaptée.', 'Activez le cache et différez les scripts non essentiels (chat, analytics).'] };
    case 'perf_cls': return { steps: ['Donnez une largeur/hauteur fixe aux images, bannières et publicités pour éviter les sauts.', 'Réservez l\'espace des contenus chargés après coup.'] };
    case 'perf_weight': return { steps: ['Compressez les images (WebP/AVIF), limitez les polices web et les scripts tiers.'] };
    default:
      if (key && key.indexOf('sec_') === 0) {
        const label = key.slice(4);
        const lines = { HSTS: 'Strict-Transport-Security: max-age=31536000; includeSubDomains', CSP: "Content-Security-Policy: default-src 'self'", 'X-Frame-Options': 'X-Frame-Options: SAMEORIGIN', 'X-Content-Type-Options': 'X-Content-Type-Options: nosniff', 'Referrer-Policy': 'Referrer-Policy: strict-origin-when-cross-origin' };
        return {
          steps: ['Cet en-tête se règle côté serveur/hébergeur (pas dans le HTML).', ctx.platform === 'wordpress' ? 'WordPress : une extension comme « HTTP Headers » permet de l\'ajouter sans code.' : ctx.platform === 'wix' ? 'Wix gère une partie de ces en-têtes (HSTS souvent déjà actif) ; sinon non réglable sans serveur dédié.' : 'Ajoutez cet en-tête dans la config de votre serveur ou de votre CDN.', 'En-tête à transmettre à votre hébergeur/webmaster :'],
          codeLabel: `En-tête ${label}`, code: lines[label] || `${label}: ...` };
      }
      return null;
  }
}
function _attachFixes(findings, ctx) {
  for (const f of findings) { try { f.fix = _fixFor(f.key, ctx, f); } catch (_) { f.fix = null; } }
  return dedupeFixCode(findings);
}

// ── S4.1 · A) IA rédactionnel : génère le texte à la place du client ─────
// Pour les correctifs « texte » (méta description, FAQ AEO), un appel IA
// métré produit un VRAI contenu personnalisé (pas le gabarit déterministe).
// L'IA n'écrit que le CONTENU ; la STRUCTURE (balise meta, JSON-LD FAQPage)
// est assemblée ici, déterministe → toujours valide à coller.

// Extrait la 1re STRING non vide des formes de réponse Workers AI connues
// (motif _aiText de ghostwriter.js : Mistral expose un champ `response` non
// textuel → on filtre sur le type pour ne jamais renvoyer un objet).
function _aiText(aiResponse) {
  const candidates = [
    aiResponse?.choices?.[0]?.message?.content,
    aiResponse?.response,
    aiResponse?.result?.response,
    aiResponse?.output?.[0]?.content?.[0]?.text,
    aiResponse?.message?.content,
    aiResponse?.text,
    aiResponse?.completion,
  ];
  for (const c of candidates) { if (typeof c === 'string' && c.trim()) return c; }
  return '';
}

// Contexte réel de la page (titre, H1, méta existante, extrait de texte) pour
// ancrer la génération sur le site réel. Best-effort, borné.
async function _pageContext(url) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), SUB_TIMEOUT_MS);
  let html = '';
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    html = (await res.text()).slice(0, 200000);
  } catch (_) { /* injoignable → contexte minimal */ } finally { clearTimeout(timer); }
  const title = _between(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDesc = _between(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
                || _between(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const h1 = _between(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 1800);
  return { title, metaDesc, h1, text };
}

const PLAT_LABEL = { wix: 'Wix', wordpress: 'WordPress', custom: 'Sur-mesure', unknown: 'inconnue' };

function _suggestSystem(kind) {
  if (kind === 'faq') {
    return [
      'Tu es un expert SEO et AEO (optimisation pour les moteurs de réponse : ChatGPT, Perplexity, Google AI Overviews).',
      'À partir du contexte du site, rédige 4 questions que de VRAIS clients posent, avec une réponse courte (1 à 3 phrases), factuelle et utile, en français.',
      'N\'invente jamais de prix, d\'horaires ou de coordonnées précises : reste général si l\'info n\'est pas dans le contexte.',
      'FORMAT STRICT — réponds UNIQUEMENT par des blocs, séparés par une ligne contenant seulement « --- » :',
      'Q : la question',
      'R : la réponse',
      'Aucune numérotation, aucun markdown, aucune phrase d\'introduction ou de conclusion.',
    ].join('\n');
  }
  return [
    'Tu es un expert SEO. À partir du contexte du site, rédige UNE méta description en français.',
    'Contraintes : 130 à 155 caractères, attractive, qui donne envie de cliquer, intègre l\'activité et le lieu si on les connaît, et finit idéalement par une incitation à l\'action.',
    'N\'invente aucun chiffre ni coordonnée non présents dans le contexte.',
    'Réponds UNIQUEMENT par la méta description, sur une seule ligne, sans guillemets, sans préfixe, sans markdown.',
  ].join('\n');
}

function _suggestUser(kind, site, ctx) {
  const host = _hostOf(site.url);
  const lines = [
    `Site : ${host}`,
    `Plateforme : ${PLAT_LABEL[site.platform] || site.platform || 'inconnue'}`,
    ctx.title ? `Titre actuel de la page : ${ctx.title}` : '',
    ctx.h1 ? `Titre principal (H1) : ${ctx.h1}` : '',
    ctx.metaDesc ? `Méta description actuelle (à améliorer) : ${ctx.metaDesc}` : '',
    ctx.text ? `Extrait du contenu de la page :\n${ctx.text}` : '',
  ].filter(Boolean);
  lines.push('');
  lines.push(kind === 'faq'
    ? 'Rédige les questions/réponses les plus utiles pour les visiteurs et les IA, selon les règles ci-dessus.'
    : 'Rédige la méta description de la page d\'accueil, selon les règles ci-dessus.');
  return lines.join('\n');
}

// Méta description : nettoie la sortie, garde-fou de longueur, assemble la balise.
function _buildMeta(raw) {
  let t = String(raw || '').replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
  t = (t.split('\n').map((s) => s.trim()).filter(Boolean)[0]) || '';
  t = t.replace(/^(méta\s*description|description|meta)\s*[:\-–—]\s*/i, '').trim();
  t = t.replace(/^["'«»“”]+|["'«»“”]+$/g, '').trim();
  if (!t) return null;
  if (t.length > 165) t = t.slice(0, 162).replace(/\s+\S*$/, '') + '…';
  const code = `<meta name="description" content="${t.replace(/"/g, '&quot;')}">`;
  return { kind: 'meta', text: t, length: t.length, codeLabel: 'Méta description rédigée pour votre site', code };
}

// FAQ AEO : parse les paires Q/R (robuste aux séparateurs), assemble un JSON-LD
// FAQPage déterministe (donc toujours valide) + un texte lisible.
function _buildFaq(raw) {
  const s = String(raw || '').replace(/```[a-z]*/gi, '').replace(/\r/g, '').trim();
  const pairs = [];
  const re = /Q\s*\d*\s*[:.)\-–—]\s*([\s\S]*?)\n\s*R\s*\d*\s*[:.)\-–—]\s*([\s\S]*?)(?=\n\s*(?:-{3,}|Q\s*\d*\s*[:.)\-–—])|$)/gi;
  let m;
  while ((m = re.exec(s)) && pairs.length < 6) {
    const q = m[1].trim().replace(/\s+/g, ' ').replace(/^["'«»“”]+|["'«»“”]+$/g, '');
    const a = m[2].trim().replace(/\s+/g, ' ').replace(/^["'«»“”]+|["'«»“”]+$/g, '');
    if (q && a) pairs.push({ q, a });
  }
  if (!pairs.length) return null;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question', name: p.q,
      acceptedAnswer: { '@type': 'Answer', text: p.a },
    })),
  };
  const code = `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2)}\n</script>`;
  const text = pairs.map((p) => `Q : ${p.q}\nR : ${p.a}`).join('\n\n');
  return { kind: 'faq', pairs, text, codeLabel: 'FAQ structurée (Schema.org FAQPage — pour Google et les IA)', code };
}

// ── S4.1 · B) Envoi du rapport au webmaster (Cloudflare Email) ──────────
function _validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()) && String(e).length <= 254; }

// Construit le rapport e-mail (HTML + texte) depuis l'audit stocké.
function _reportEmail({ name, url, score, scores, findings, date, platform }) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sevLabel = { high: 'Priorité haute', medium: 'Priorité moyenne', low: 'À optimiser' };
  const axisLabel = { disponibilite: 'Disponibilité', performance: 'Performance', seo: 'SEO technique', securite: 'Sécurité (en-têtes)', accessibilite: 'Accessibilité de base', presence: 'Présence locale', geo: 'Visibilité IA (GEO)' };
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...(findings || [])].sort((a, b) => (order[a.sev] ?? 3) - (order[b.sev] ?? 3));
  const platTxt = PLAT_LABEL[platform] || platform || '';

  const axisRowsHtml = Object.keys(scores || {}).map((k) => {
    const v = scores[k];
    return `<tr><td style="padding:4px 0;color:#475569;font-size:14px">${esc(axisLabel[k] || k)}</td><td style="padding:4px 0;text-align:right;font-weight:600;font-size:14px">${v == null ? 'n/a' : v + ' / 100'}</td></tr>`;
  }).join('');

  const findHtml = sorted.map((f) => {
    const steps = (f.fix && f.fix.steps && f.fix.steps.length)
      ? `<ol style="margin:6px 0;padding-left:20px;color:#334155;font-size:13px">${f.fix.steps.map((st) => `<li style="margin:2px 0">${esc(st)}</li>`).join('')}</ol>` : '';
    const code = (f.fix && f.fix.code)
      ? `<div style="font-size:12px;color:#64748b;margin:6px 0 2px">${esc(f.fix.codeLabel || 'Code à coller')}</div><pre style="background:#f1f5f9;border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,monospace;color:#0f172a">${esc(f.fix.code)}</pre>` : '';
    return `<div style="border-top:1px solid #e2e8f0;padding:12px 0">
      <div style="font-size:14px;color:#0f172a"><strong>[${esc(sevLabel[f.sev] || '')}]</strong> ${esc(f.title)}</div>
      ${f.detail ? `<div style="color:#64748b;font-size:13px;margin:3px 0">${esc(f.detail)}</div>` : ''}${steps}${code}</div>`;
  }).join('') || '<p style="color:#16a34a;font-size:14px">Aucun problème détecté sur les axes audités. 👍</p>';

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f8fafc;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#0f172a">
    <div style="max-width:640px;margin:0 auto;padding:24px">
      <div style="font-size:13px;color:#6366f1;font-weight:700;letter-spacing:.03em">KEYSTONE SENTINEL</div>
      <h1 style="font-size:22px;margin:6px 0 2px">Rapport d'audit — ${esc(name)}</h1>
      <div style="color:#64748b;font-size:13px">${esc(url)}${platTxt ? ' · ' + esc(platTxt) : ''}</div>
      <div style="margin:18px 0;padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
        <div style="font-size:13px;color:#64748b">Score global</div>
        <div style="font-size:40px;font-weight:800;line-height:1.1">${score != null ? score : '—'}<span style="font-size:16px;color:#94a3b8"> / 100</span></div>
        <table style="width:100%;border-collapse:collapse;margin-top:10px">${axisRowsHtml}</table>
      </div>
      <h2 style="font-size:16px;margin:18px 0 4px">À corriger en priorité — solutions clé en main</h2>
      ${findHtml}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">Rapport généré automatiquement par Keystone Sentinel. Chaque correctif inclut les étapes et le code prêt à coller.</p>
    </div></body></html>`;

  const findText = sorted.map((f) => {
    const steps = (f.fix && f.fix.steps && f.fix.steps.length) ? '\n' + f.fix.steps.map((st, i) => `   ${i + 1}. ${st}`).join('\n') : '';
    const code = (f.fix && f.fix.code) ? `\n   [${f.fix.codeLabel || 'Code'}]\n${f.fix.code.split('\n').map((l) => '   ' + l).join('\n')}` : '';
    return `• [${sevLabel[f.sev] || ''}] ${f.title}${f.detail ? '\n   ' + f.detail : ''}${steps}${code}`;
  }).join('\n\n') || 'Aucun problème détecté sur les axes audités.';
  const axisText = Object.keys(scores || {}).map((k) => `- ${axisLabel[k] || k} : ${scores[k] == null ? 'n/a' : scores[k] + '/100'}`).join('\n');
  const text = `KEYSTONE SENTINEL — Rapport d'audit\n${name} (${url})${platTxt ? ' · ' + platTxt : ''}\n\nScore global : ${score != null ? score + '/100' : '—'}\n${axisText}\n\nÀ CORRIGER EN PRIORITÉ — solutions clé en main\n\n${findText}\n\n—\nRapport généré par Keystone Sentinel.`;

  return { subject: `Audit web de ${name} — score ${score != null ? score + '/100' : 'disponible'}`, html, text };
}

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
  const rows = (await env.DB.prepare(
    `SELECT id, url, label, platform, last_checked_at, last_ok, last_status, last_ms, consecutive_fails,
            last_score, last_scores, last_audit_at, last_coverage, created_at
       FROM sentinel_sites WHERE tenant_id = ? ORDER BY created_at ASC`
  ).bind(g.tenant).all()).results || [];
  for (const s of rows) {
    s.uptime24h = await _uptime24(env, s.id);
    const sp = (await env.DB.prepare(`SELECT ms, ok FROM sentinel_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT ${SPARK_POINTS}`).bind(s.id).all()).results || [];
    s.spark = sp.reverse().map(x => ({ ms: x.ms, ok: x.ok }));
    if (s.last_scores) { try { s.last_scores = JSON.parse(s.last_scores); } catch (_) { s.last_scores = null; } }
  }
  // email_enabled / geo_enabled : le front n'affiche ces surfaces que si elles
  // sont réellement câblées (clé Resend / clé Gemini) → pas d'UI morte avant activation.
  const emailEnabled = !!(env && emailConfigured(env));
  return json({ sites: rows, count: rows.length, limit: _siteLimit(g.plan), plan: g.plan, email_enabled: emailEnabled, geo_enabled: _geoEnabled(env) }, 200, origin);
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
  if (used >= limit) return json({ error: `Votre plan ${g.plan} permet de surveiller ${limit} site${limit > 1 ? 's' : ''}. Passez à un plan supérieur pour en ajouter.`, code: 'SENTINEL_SITE_LIMIT', limit, plan: g.plan }, 403, origin);
  const dup = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE tenant_id = ? AND url = ?").bind(g.tenant, v.url).first();
  if (dup) return err('Ce site est déjà surveillé.', 409, origin);

  const probe = await _probe(v.url);
  const id = generateId();
  await env.DB.prepare("INSERT INTO sentinel_sites (id, tenant_id, url, label, platform) VALUES (?, ?, ?, ?, ?)")
    .bind(id, g.tenant, v.url, label || null, probe.platform || 'unknown').run();
  await _recordCheck(env, g.tenant, id, probe);
  return json({ site: { id, url: v.url, label: label || null, platform: probe.platform || 'unknown', last_ok: probe.ok, last_status: probe.status, last_ms: probe.ms } }, 201, origin);
}

export async function handleSiteDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  await env.DB.prepare("DELETE FROM sentinel_checks WHERE site_id = ? AND tenant_id = ?").bind(id, g.tenant).run();
  await env.DB.prepare("DELETE FROM sentinel_audits WHERE site_id = ? AND tenant_id = ?").bind(id, g.tenant).run();
  await env.DB.prepare("DELETE FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).run();
  return json({ ok: true }, 200, origin);
}

export async function handleSiteCheck(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);
  const r = await _check(site.url);
  const { transition } = await _recordCheck(env, g.tenant, site.id, r);
  if (transition) await _alert(env, g.tenant, site, transition);
  return json({ check: { ok: r.ok, status: r.status, ms: r.ms, error: r.error } }, 200, origin);
}

export async function handleSiteHistory(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const own = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!own) return err('Site introuvable.', 404, origin);
  const rows = (await env.DB.prepare(`SELECT checked_at, ok, status, ms, error FROM sentinel_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT ${HISTORY_LIMIT}`).bind(id).all()).results || [];
  return json({ history: rows.reverse() }, 200, origin);
}

// ── Performance réelle (S3 · Core Web Vitals via Browser Rendering) ──
// Best-effort : si le binding BROWSER est absent ou le navigateur échoue,
// renvoie null → l'axe perf passe en « n/a », le reste de l'audit tient.
async function _measurePerf(env, url) {
  if (!env || !env.BROWSER) return null;
  let browser = null;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    try { await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }); } catch (_) {}
    // S9/C14 — throttling type Lighthouse (Slow 4G + CPU ×4), best-effort.
    // Les CONDITIONS réelles de mesure sont étiquetées dans cwv.conditions.
    let throttled = false;
    try {
      const cdp = await page.createCDPSession();
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8,
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      throttled = true;
    } catch (_) { /* CDP indisponible → mesure non throttlée, étiquetée telle quelle */ }
    await page.evaluateOnNewDocument(() => {
      window.__cwv = { lcp: 0, cls: 0 };
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cwv.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!e.hadRecentInput) window.__cwv.cls += e.value; } }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
    });

    // S11.2 — MÉDIANE DE 3 CHARGEMENTS. Une mesure unique en headless
    // throttlé varie de ±1 s d'un run à l'autre (constaté en prod : LCP
    // 2,4 s puis 3,5 s à 8 min d'écart → global 94 → 84 sans que le site
    // change). PageSpeed/WebPageTest font pareil : plusieurs passes, médiane.
    const runs = [];
    for (let i = 0; i < 3; i++) {
      try {
        try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 }); }
        catch (_) { await page.goto(url, { waitUntil: 'load', timeout: 10000 }); }
        await new Promise((r) => setTimeout(r, 1200));   // stabilisation LCP/CLS
        const m = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0] || {};
          const fcpE = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
          const res = performance.getEntriesByType('resource');
          let weight = nav.transferSize || 0, count = 1;
          for (const r of res) { weight += (r.transferSize || 0); count++; }
          return {
            lcp: Math.round((window.__cwv && window.__cwv.lcp) || 0),
            cls: Math.round(((window.__cwv && window.__cwv.cls) || 0) * 1000) / 1000,
            fcp: Math.round(fcpE ? fcpE.startTime : 0),
            ttfb: Math.round(nav.responseStart || 0),
            weightKb: Math.round(weight / 1024),
            requests: count,
          };
        });
        if (m && m.lcp > 0) runs.push(m);
        else if (m) runs.push(m);                        // LCP absent (page atypique) : garder quand même
      } catch (_) { /* run raté → on continue avec les autres */ }
    }
    if (!runs.length) return null;
    const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const cwv = {
      lcp: med(runs.map((r) => r.lcp)), cls: med(runs.map((r) => r.cls)),
      fcp: med(runs.map((r) => r.fcp)), ttfb: med(runs.map((r) => r.ttfb)),
      weightKb: med(runs.map((r) => r.weightKb)), requests: med(runs.map((r) => r.requests)),
      runs: runs.length,                                  // traçabilité : sur combien de passes
      conditions: throttled ? 'mobile-4g-cpu4x' : 'datacenter-non-throttle',
    };
    return cwv;
  } catch (_) {
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}


// S15.3 — un finding issu d'un embed SITE-LEVEL présent sur une partie des
// pages seulement est la signature d'un cache CDN en cours de purge, pas
// d'un défaut partiel. On le dit, sinon le client refait un correctif déjà
// appliqué (vécu le 04/08 sur le Mas).
function _cacheHint(findings, pageCount) {
  for (const f of findings || []) {
    if (f.key === 'jsonld_url_mismatch' && f.pages && f.pages.length > 0 && f.pages.length < pageCount) {
      f.detail += ` — Présent sur ${f.pages.length} page(s) sur ${pageCount} : si vous venez d'appliquer le correctif, il s'agit probablement du cache de l'hébergeur. Republiez le site (purge le cache) puis relancez l'audit.`;
    }
  }
}

// S12.3 — derniere mesure CWV exploitable (≤ 7 j) : quand Browser Rendering
// est indisponible (quota, panne), on réutilise la mesure récente ÉTIQUETÉE
// plutôt que de laisser l'axe disparaître et le score global sauter de +10
// en silence (renormalisation) — la plainte « 94 puis 84 » à l'envers.
async function _lastCwv(env, siteId, interval = '-7 day') {
  const row = await env.DB.prepare(`SELECT cwv, created_at FROM sentinel_audits WHERE site_id = ? AND cwv IS NOT NULL AND created_at >= datetime('now','${interval}') ORDER BY created_at DESC LIMIT 1`).bind(siteId).first();
  if (!row || !row.cwv) return null;
  try { const c = JSON.parse(row.cwv); c.stale_from = row.created_at; return c; } catch (_) { return null; }
}

// S17 — les N-1 mesures précédentes, en BRUT, pour lisser celle du jour.
// Fenêtre 30 j : au-delà, un vieux relevé ne dit plus rien du site actuel.
async function _prevCwvs(env, siteId, n = CWV_SMOOTH_N - 1) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT cwv FROM sentinel_audits WHERE site_id = ? AND cwv IS NOT NULL
         AND created_at >= datetime('now','-30 day') ORDER BY created_at DESC LIMIT ?`).bind(siteId, n).all();
    return (results || []).map((r) => { try { return rawCwv(JSON.parse(r.cwv)); } catch (_) { return null; } }).filter(Boolean);
  } catch (_) { return []; }
}

export async function handleSiteAudit(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label, platform, last_coverage, last_audit_at FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);

  const a = await _auditSite(site.url, site.platform);   // V2 — crawl : home + pages internes, agrégé (S9 : plateforme → scoping sécurité)

  // S8/C6 — site injoignable : pas de verdict. On ne stocke PAS d'audit
  // (une ligne à score null polluerait l'historique et les tendances) ;
  // la surveillance uptime (sentinel_checks) trace déjà l'indisponibilité.
  if (!a.reachable) {
    return err('Site injoignable au moment de l\'audit — aucun score attribué. Réessayez quand le site répond.', 503, origin);
  }

  // S16.2 — AUTO-RÉPARATION de la plateforme. Elle n'était déduite qu'UNE
  // fois, à la création du site : une détection erronée y restait à vie, avec
  // des conséquences réelles (en-têtes de sécurité exemptés à tort, correctifs
  // rédigés pour le mauvais éditeur). Chaque audit la re-déduit du document
  // déjà téléchargé — on ne corrige que sur SIGNATURE trouvée, jamais sur son
  // absence, et l'audit en cours a déjà utilisé la bonne valeur.
  if (a.detectedPlatform && a.detectedPlatform !== 'custom' && a.detectedPlatform !== site.platform) {
    try {
      await env.DB.prepare("UPDATE sentinel_sites SET platform = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(a.detectedPlatform, site.id).run();
      site.platform = a.detectedPlatform;
    } catch (_) { /* non bloquant : l'audit vaut mieux qu'une correction perdue */ }
  }

  // S9/C11-C12 — axe dispo : fenêtre réelle + garde de couverture.
  const up = await _uptimeWindow(env, site.id);
  const dispo = up.pct == null ? null : Math.round(up.pct);
  let cwv = await _measurePerf(env, site.url);   // perf (CWV) = home seule (coût borné)
  let scoreNote = null;
  if (!cwv) {                                       // S12.3 — repli étiqueté, jamais de saut silencieux
    cwv = await _lastCwv(env, site.id);
    if (cwv) scoreNote = 'cwv-reprise';
    else scoreNote = 'sans-axe-vitesse';
  } else {
    // S17 — lissage : médiane des CWV_SMOOTH_N derniers relevés. Un chargement
    // isolé varie assez pour déplacer le score de 4 à 6 points sur un site
    // inchangé (constaté le 04/08 sur les deux premiers sites tiers).
    cwv = smoothCwv(cwv, await _prevCwvs(env, site.id));
  }
  const perf = _perfScore(cwv);                     // S9/C9 : poids de page inclus
  const scores = { disponibilite: dispo, performance: perf, ...a.scores };   // null = axe « n/a »
  const findings = a.findings.slice();
  if (cwv) {
    if (cwv.lcp >= 4000) findings.push({ axis: 'performance', sev: 'high', key: 'perf_lcp', title: `Chargement lent (LCP ${_fr1(cwv.lcp / 1000)} s)`, detail: 'Cible : moins de 2,5 s — compressez images et scripts.' });
    else if (cwv.lcp >= 2500) findings.push({ axis: 'performance', sev: 'medium', key: 'perf_lcp', title: `Chargement à améliorer (LCP ${_fr1(cwv.lcp / 1000)} s)`, detail: 'Cible : moins de 2,5 s.' });
    if (cwv.cls >= 0.25) findings.push({ axis: 'performance', sev: 'medium', key: 'perf_cls', title: `La page saute au chargement (CLS ${cwv.cls})`, detail: 'Réservez les dimensions des images, bannières et publicités.' });
    if (cwv.weightKb >= 3072) findings.push({ axis: 'performance', sev: 'low', key: 'perf_weight', title: `Page lourde (${_fr1(cwv.weightKb / 1024)} Mo)`, detail: 'Allégez images et scripts pour accélérer le mobile.' });
  }
  _cacheHint(findings, a.pageCount);                // S15.3
  _attachFixes(findings, { url: site.url, host: _hostOf(site.url), platform: site.platform });
  const global = _globalScore(scores);              // S9/C7 : pondération fixe (lib)
  // S12.1 — gain RÉEL par finding (delta exact de barème, jamais une constante).
  attachGains(findings, { scores, pageCount: a.pageCount, notApplicable: a.notApplicable });
  const scoresJson = JSON.stringify(scores);
  const findingsJson = JSON.stringify(findings);
  const pagesJson = JSON.stringify(a.pages || []);
  const indetJson = JSON.stringify(a.indeterminate || []);
  const naJson = JSON.stringify(a.notApplicable || []);
  // S9/C23 — l'audit porte la version du moteur qui l'a produit : quand un
  // score bouge après une révision de méthode, l'historique doit le dire.
  await env.DB.prepare("INSERT INTO sentinel_audits (id, tenant_id, site_id, score, scores, findings, cwv, pages, indeterminate, not_applicable, engine, pages_total, coverage, cache_age) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sample', ?)")
    .bind(generateId(), g.tenant, site.id, global, scoresJson, findingsJson, cwv ? JSON.stringify(cwv) : null, pagesJson, indetJson, naJson, SENTINEL_ENGINE_VERSION, a.pagesTotal || null, a.cacheAgeMax || 0).run();
  // S12.2 — un audit express (échantillon) n'écrase PAS le score d'un crawl
  // complet récent (< 7 j) : sinon la vignette fait 84 → 94 en un clic sans
  // que le site change (constaté le soir même du S11). L'express reste dans
  // l'historique ; la vignette garde le chiffre au périmètre le plus vrai.
  const keepFull = site.last_coverage === 'full' && site.last_audit_at
    && (Date.now() - new Date(String(site.last_audit_at).replace(' ', 'T') + 'Z').getTime()) < 7 * 86400000;
  if (!keepFull) {
    await env.DB.prepare("UPDATE sentinel_sites SET last_score = ?, last_scores = ?, last_coverage = 'sample', last_audit_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ?")
      .bind(global, scoresJson, site.id, g.tenant).run();
  }

  // S10/C21 — pré-remplissage GEO depuis le JSON-LD du site (ville + activité),
  // UNIQUEMENT si la config est vide : on n'écrase jamais un choix utilisateur.
  const gh = a.geoHints;
  if (gh && (gh.city || gh.activity)) {
    try {
      const geoRow = await env.DB.prepare("SELECT city, activity FROM sentinel_geo WHERE site_id = ? AND tenant_id = ?").bind(site.id, g.tenant).first();
      if (!geoRow) {
        await env.DB.prepare("INSERT INTO sentinel_geo (site_id, tenant_id, business_name, city, activity, prompts, updated_at) VALUES (?, ?, ?, ?, ?, '[]', datetime('now'))")
          .bind(site.id, g.tenant, site.label || _hostOf(site.url), gh.city || '', gh.activity || '').run();
      } else if (!String(geoRow.city || '').trim() && !String(geoRow.activity || '').trim()) {
        await env.DB.prepare("UPDATE sentinel_geo SET city = ?, activity = ?, updated_at = datetime('now') WHERE site_id = ? AND tenant_id = ?")
          .bind(gh.city || '', gh.activity || '', site.id, g.tenant).run();
      }
    } catch (_) { /* best-effort — l'audit ne doit pas échouer sur le confort GEO */ }
  }

  return json({ audit: { score: global, scores, findings, cwv, pages: a.pages, pagesTotal: a.pagesTotal || null,
    reachable: a.reachable, indeterminate: a.indeterminate || [], notApplicable: a.notApplicable || [],
    truncated: !!a.truncated, engine: SENTINEL_ENGINE_VERSION, coverage: 'sample', cacheAgeMax: a.cacheAgeMax || 0,
    scoreNote, scoreKept: keepFull ? 'full-recent' : null,
    dispoWindow: { days: up.windowDays, n: up.n, insufficient: !!up.insufficient } } }, 200, origin);
}

export async function handleSiteAuditGet(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const own = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!own) return err('Site introuvable.', 404, origin);
  const row = await env.DB.prepare("SELECT score, scores, findings, created_at FROM sentinel_audits WHERE site_id = ? ORDER BY created_at DESC LIMIT 1").bind(id).first();
  if (!row) return json({ audit: null }, 200, origin);
  let scores = null, findings = []; try { scores = JSON.parse(row.scores); } catch (_) {} try { findings = JSON.parse(row.findings); } catch (_) {}
  return json({ audit: { score: row.score, scores, findings, created_at: row.created_at } }, 200, origin);
}

// ── S7 · GET /sites/:id/cockpit — données consolidées de la vue cockpit ──
// Lecture seule (aucun audit relancé, aucune IA) : KPI (dispo 30 j + tendance,
// LCP, SSL, score + tendance), série 30 j (courbe), dernier audit, historique
// des scores, GEO. Le « Relancer » reste POST /audit.
export async function handleSiteCockpit(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label, platform, last_ok, last_status, last_ms, last_checked_at, next_check_at FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);

  // S9/C11-C13 — disponibilité : fenêtre RÉELLE (« sur N j », pas « 30 j »
  // avec 2 jours d'historique) + garde de couverture ; tendance 7 j vs 7 j
  // uniquement si les DEUX fenêtres ont assez de relevés (sinon null — un
  // « stable » par défaut est une affirmation gratuite).
  const upW = await _uptimeWindow(env, id);
  const uptime30d = upW.pct;                                 // null si couverture < 50 %
  const uptimeWindowDays = upW.windowDays;
  const up7 = await env.DB.prepare("SELECT AVG(ok) rate, COUNT(*) n FROM sentinel_checks WHERE site_id = ? AND checked_at >= datetime('now','-7 day')").bind(id).first();
  const upPrev7 = await env.DB.prepare("SELECT AVG(ok) rate, COUNT(*) n FROM sentinel_checks WHERE site_id = ? AND checked_at < datetime('now','-7 day') AND checked_at >= datetime('now','-14 day')").bind(id).first();
  let uptimeTrend = null;
  const MIN_7D = 7 * 288 * 0.5;                              // 50 % de couverture par fenêtre
  if (up7 && upPrev7 && up7.rate != null && upPrev7.rate != null && up7.n >= MIN_7D && upPrev7.n >= MIN_7D) {
    const d = up7.rate - upPrev7.rate;
    uptimeTrend = d > 0.005 ? 'up' : (d < -0.005 ? 'down' : 'stable');
  }

  // Série 30 j (moyenne par jour) pour la courbe de temps de réponse.
  const seriesRows = (await env.DB.prepare("SELECT substr(checked_at,1,10) d, AVG(ms) ms, AVG(ok) up FROM sentinel_checks WHERE site_id = ? AND checked_at >= datetime('now','-30 day') GROUP BY d ORDER BY d").bind(id).all()).results || [];
  const series30d = seriesRows.map((r) => ({ d: r.d, ms: Math.round(r.ms || 0), up: r.up }));

  // Dernier audit + historique + tendance de score (vs ~7 j).
  const auditRow = await env.DB.prepare("SELECT score, scores, findings, cwv, pages, indeterminate, not_applicable, engine, pages_total, coverage, cache_age, created_at FROM sentinel_audits WHERE site_id = ? ORDER BY created_at DESC LIMIT 1").bind(id).first();
  let audit = null;
  if (auditRow) { let sc = null, fd = [], cw = null, pg = null, ind = [], na = []; try { sc = JSON.parse(auditRow.scores); } catch (_) {} try { fd = JSON.parse(auditRow.findings); } catch (_) {} try { cw = auditRow.cwv ? JSON.parse(auditRow.cwv) : null; } catch (_) {} try { pg = auditRow.pages ? JSON.parse(auditRow.pages) : null; } catch (_) {} try { ind = auditRow.indeterminate ? JSON.parse(auditRow.indeterminate) : []; } catch (_) {} try { na = auditRow.not_applicable ? JSON.parse(auditRow.not_applicable) : []; } catch (_) {} audit = { score: auditRow.score, scores: sc, findings: fd, cwv: cw, pages: pg, pagesTotal: auditRow.pages_total, indeterminate: ind, notApplicable: na, engine: auditRow.engine, coverage: auditRow.coverage || 'sample', cacheAgeMax: auditRow.cache_age || 0, created_at: auditRow.created_at }; }
  const histRows = (await env.DB.prepare("SELECT created_at, score, scores FROM sentinel_audits WHERE site_id = ? ORDER BY created_at DESC LIMIT 20").bind(id).all()).results || [];
  const scoreHistory = histRows.reverse().map((r) => { let sc = null; try { sc = r.scores ? JSON.parse(r.scores) : null; } catch (_) {} return { at: r.created_at, score: r.score, scores: sc }; });
  let scoreTrend = null;
  if (audit && audit.score != null) {
    // S12.2 — comparer à PÉRIMÈTRE ÉGAL : un 94 (échantillon) vs 84 (complet)
    // n'est pas une tendance, c'est deux mesures différentes.
    const prev = await env.DB.prepare("SELECT score FROM sentinel_audits WHERE site_id = ? AND created_at <= datetime('now','-7 day') AND COALESCE(coverage,'sample') = COALESCE(?, 'sample') ORDER BY created_at DESC LIMIT 1").bind(id, auditRow && auditRow.coverage).first();
    if (prev && prev.score != null) scoreTrend = audit.score - prev.score;
  }

  // SSL : on suit les redirections pour juger le schéma RÉEL (un site surveillé via
  // une URL http:// qui redirige vers https n'est PAS « non sécurisé »). Best-effort :
  // en cas d'échec, on retombe sur le schéma de l'URL enregistrée. Pas de J-XX (souverain).
  let https = false;
  try { https = new URL(site.url).protocol === 'https:'; } catch (_) {}
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), SUB_TIMEOUT_MS);
    try {
      const r = await fetch(site.url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
      try { await r.body?.cancel?.(); } catch (_) {}
      if (r && r.url) https = /^https:/i.test(r.url);
    } finally { clearTimeout(timer); }
  } catch (_) { /* garde le schéma de l'URL enregistrée */ }
  const ssl = { https, valid: !!(https && site.last_ok) };

  // GEO (config + dernier relevé).
  const geoRow = await _geoConfigRow(env, id, g.tenant);
  let geo = { enabled: _geoEnabled(env), configured: false, business_name: site.label || _hostOf(site.url), city: '', activity: '', prompts: _defaultGeoPrompts('', ''), score: null, results: null, run_at: null };
  if (geoRow) {
    let prompts = [], results = null, srcCheck = null; try { prompts = JSON.parse(geoRow.prompts || '[]'); } catch (_) {} try { results = geoRow.last_results ? JSON.parse(geoRow.last_results) : null; } catch (_) {} try { srcCheck = geoRow.last_sources_check ? JSON.parse(geoRow.last_sources_check) : null; } catch (_) {}
    // S14.2 — score lissé : médiane des 3 derniers relevés (les réponses IA
    // sont non-déterministes ; un relevé isolé ne fait pas une tendance).
    let scoreSmoothed = null, runsN = 0;
    try {
      const hist = (await env.DB.prepare("SELECT score FROM sentinel_geo_history WHERE site_id = ? ORDER BY run_at DESC LIMIT 3").bind(id).all()).results || [];
      const vals = hist.map((h) => h.score).filter((v) => typeof v === 'number').sort((a, b) => a - b);
      runsN = vals.length;
      if (vals.length) scoreSmoothed = vals[Math.floor(vals.length / 2)];
    } catch (_) {}
    geo = { enabled: _geoEnabled(env), configured: true, business_name: geoRow.business_name || (site.label || _hostOf(site.url)), city: geoRow.city || '', activity: geoRow.activity || '', prompts: prompts.length ? prompts : _defaultGeoPrompts(geoRow.activity || '', geoRow.city || ''), score: geoRow.last_score, scoreSmoothed, runsN, sourcesCheck: srcCheck, results, run_at: geoRow.last_run_at };
  }

  // V2 — Search Console (config + dernier relevé Mots-clés).
  const gscRow = await _gscConfigRow(env, id, g.tenant);
  let gsc = { available: _gscEnabled(env), connected: false, property: null, account_email: null, score: null, results: null, run_at: null };
  if (gscRow) {
    let gr = null; try { gr = gscRow.last_results ? JSON.parse(gscRow.last_results) : null; } catch (_) {}
    gsc = { available: _gscEnabled(env), connected: gscRow.status === 'connected', property: gscRow.property, account_email: gscRow.account_email, score: gscRow.last_score, results: gr, run_at: gscRow.last_run_at };
  }

  return json({ cockpit: {
    site: { id: site.id, url: site.url, label: site.label, platform: site.platform, last_ok: site.last_ok, last_status: site.last_status, last_ms: site.last_ms, last_checked_at: site.last_checked_at, next_check_at: site.next_check_at },
    uptime30d, uptimeWindowDays, uptimeTrend, series30d, audit, scoreHistory, scoreTrend, ssl, geo, gsc,
    email_enabled: !!(env && emailConfigured(env)),
  } }, 200, origin);
}

// ── S4.1 · A) POST /sites/:id/suggest { kind:'meta'|'faq' } — IA rédactionnel ──
// Génère le VRAI texte (méta description ou FAQ AEO) à partir du contenu réel
// du site. Métré comme toute surface IA : budgetGuard + consumeCredits (si
// enforcement actif) + recordUsage, refund si l'appel échoue après débit.
// Best-effort : IA indisponible → message clair, le gabarit déterministe (S4) reste.
export async function handleSiteSuggest(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label, platform FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);

  const body = await parseBody(request);
  const kind = (body && body.kind === 'faq') ? 'faq' : 'meta';

  if (!env.AI || typeof env.AI.run !== 'function') {
    return err('Génération IA indisponible sur ce serveur. Le modèle prêt-à-coller reste utilisable.', 503, origin);
  }

  // Bridage budget IA (admin) AVANT toute consommation.
  const _throttled = await budgetGuard(env, origin);
  if (_throttled) return _throttled;

  // Métrage crédits : bucket = lookup_hmac (claims.sub). ADMIN via header → claims
  // null → pas d'enforcement (illimité), cohérent avec le reste de l'écosystème.
  const lookupHmac = g.claims && g.claims.sub;
  const creditsEnforced = lookupHmac ? await isEnforceEnabled(env, lookupHmac) : false;
  let creditResult = null;
  if (creditsEnforced) {
    creditResult = await consumeCredits(env, { bucketKey: lookupHmac, plan: g.plan, tool: 'sentinel' });
    if (!creditResult.ok && creditResult.blocked) {
      return json({ error: 'Conversations épuisées ce mois. Ajoutez un pack de conversations ou attendez le 1er du mois.', code: 'AI_CREDITS_EXHAUSTED' }, 429, origin);
    }
  }

  let committed = false;
  try {
    const ctx = await _pageContext(site.url);
    const sys = _suggestSystem(kind);
    const usr = _suggestUser(kind, site, ctx);
    let aiResp = null;
    try {
      aiResp = await env.AI.run(KS_AI_MODEL, {
        messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
        max_tokens: kind === 'faq' ? 1200 : 320,
      });
    } catch (e) {
      const m = String(e?.message || e || '');
      if (/\b4006\b|daily free allocation|neurons|workers paid/i.test(m)) {
        return json({ error: 'Limite IA quotidienne atteinte — ça repart à 00h00 UTC.', code: 'AI_BUDGET_EXHAUSTED' }, 429, origin);
      }
      return err('Le service IA est momentanément indisponible. Réessayez, ou utilisez le modèle prêt-à-coller.', 502, origin);
    }
    const raw = _aiText(aiResp).trim();
    if (!raw) return err('Le modèle n\'a pas renvoyé de texte. Réessayez.', 502, origin);
    const suggestion = (kind === 'faq') ? _buildFaq(raw) : _buildMeta(raw);
    if (!suggestion) return err('Réponse IA inexploitable. Réessayez.', 502, origin);

    await recordUsage(env, 'sentinel', { usage: aiResp?.usage, inText: sys + usr, outText: raw });
    committed = true;
    return json({ suggestion }, 200, origin);
  } finally {
    if (!committed && creditsEnforced && creditResult && creditResult.ok) {
      await refundCredits(env, { bucketKey: lookupHmac, tool: 'sentinel', cost: creditResult.cost, packsDrawn: creditResult.packsDrawn }).catch(() => {});
    }
  }
}

// ── S4.1 · B) POST /sites/:id/send-report { email } — envoi au webmaster ──
// Construit le rapport depuis le dernier audit stocké et l'envoie via Resend
// (API REST, compatible DNS Vercel — décision 2026-06-19). Rate-limit léger
// par tenant/jour. Dégrade proprement si la clé d'envoi n'est pas configurée.
// Activation = secret RESEND_API_KEY + domaine vérifié chez Resend (DKIM Vercel).
const EMAIL_DAILY_LIMIT = 20;
async function _revertEmailLog(env, tenant, day) {
  await env.DB.prepare("UPDATE sentinel_email_log SET count = MAX(count - 1, 0) WHERE tenant_id = ? AND day = ?").bind(tenant, day).run().catch(() => {});
}
// Envoi via le dispatcher souverain de lib/email-resend.js (Scaleway TEM
// par défaut depuis le 26/07/2026). `from` = chaîne prête (« Nom <email> » —
// sur Scaleway seul le NOM d'affichage est conservé, l'adresse reste celle
// du domaine validé). Ne lève jamais.
async function _sendViaResend(env, { from, to, subject, html, text, replyTo }) {
  // Dispatcher souverain (Scaleway/Resend selon KS_EMAIL_PROVIDER) —
  // même contrat qu'avant : ne lève JAMAIS, retourne { ok, ... }.
  try {
    const out = await sendEmail(env, { to, subject, html, text, replyTo, from });
    return { ok: true, status: 200, id: out && out.id };
  } catch (e) {
    return { ok: false, status: 0, msg: (e && e.message) || 'réseau' };
  }
}
export async function handleSiteSendReport(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label, platform FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);

  const body = await parseBody(request);
  const email = String((body && body.email) || '').trim();
  if (!_validEmail(email)) return err('Adresse e-mail invalide.', 400, origin);
  const replyTo = _validEmail(body && body.replyTo) ? String(body.replyTo).trim() : null;

  // Envoi configuré ? (clé Resend présente — partagée avec Keystone). Sinon PDF.
  if (!emailConfigured(env)) {
    return err("L'envoi par e-mail n'est pas encore activé sur ce serveur. En attendant, exportez le rapport en PDF puis transmettez-le.", 503, origin);
  }

  // Dernier audit stocké (réutilise findings + fixes déjà calculés).
  const row = await env.DB.prepare("SELECT score, scores, findings, created_at FROM sentinel_audits WHERE site_id = ? ORDER BY created_at DESC LIMIT 1").bind(id).first();
  if (!row) return err('Aucun audit disponible. Lancez d\'abord un audit du site.', 409, origin);
  let scores = null, findings = []; try { scores = JSON.parse(row.scores); } catch (_) {} try { findings = JSON.parse(row.findings); } catch (_) {}

  // Rate-limit léger : pre-bump puis revert si dépassement ou échec d'envoi.
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(`INSERT INTO sentinel_email_log (tenant_id, day, count) VALUES (?, ?, 1) ON CONFLICT(tenant_id, day) DO UPDATE SET count = count + 1`).bind(g.tenant, day).run().catch(() => {});
  const usedRow = await env.DB.prepare("SELECT count FROM sentinel_email_log WHERE tenant_id = ? AND day = ?").bind(g.tenant, day).first();
  if (usedRow && usedRow.count > EMAIL_DAILY_LIMIT) {
    await _revertEmailLog(env, g.tenant, day);
    return json({ error: `Limite de ${EMAIL_DAILY_LIMIT} envois par jour atteinte. Réessayez demain.`, code: 'SENTINEL_EMAIL_LIMIT' }, 429, origin);
  }

  const name = site.label || _hostOf(site.url);
  const { subject, html, text } = _reportEmail({ name, url: site.url, score: row.score, scores, findings, date: row.created_at, platform: site.platform });
  // Expéditeur : on réutilise tel quel l'adresse vérifiée de Keystone (KS_RESEND_FROM,
  // déjà au format « Nom <email> ») ; sinon repli sur une adresse Sentinel.
  const from = env.KS_RESEND_FROM ? String(env.KS_RESEND_FROM)
    : `Keystone Sentinel <${env.SENTINEL_FROM_EMAIL || 'sentinel@protein-keystone.com'}>`;
  const sent = await _sendViaResend(env, { from, to: email, subject, html, text, replyTo });
  if (!sent.ok) {
    await _revertEmailLog(env, g.tenant, day);
    if (/domain|verif|not verified|\bdns\b/i.test(sent.msg)) {
      return err("Le domaine d'envoi n'est pas encore vérifié chez Resend. Terminez la vérification DNS, puis réessayez. (Le rapport reste exportable en PDF.)", 503, origin);
    }
    if (sent.status === 401 || sent.status === 403) {
      return err("Configuration d'envoi e-mail incomplète côté serveur. Réessayez plus tard.", 503, origin);
    }
    if (sent.status === 422) {
      return err('Cette adresse e-mail a été refusée par le service d\'envoi.', 422, origin);
    }
    return err('Envoi impossible pour le moment. Réessayez plus tard.', 502, origin);
  }
  return json({ ok: true, sent_to: email, id: sent.id || null }, 200, origin);
}

// ════════════════════════════════════════════════════════════════
// S5 · VISIBILITÉ IA (GEO) — le pilier killer
// ────────────────────────────────────────────────────────────────
// « Quand on demande à une IA le meilleur X dans ma ville, est-ce que
// je sors ? » On interroge un moteur IA AVEC recherche web (Gemini
// grounding = recherche Google réelle, indispensable pour une TPE locale)
// sur des prompts de prospect, puis on détecte la citation / le rang.
// Clé : celle du propriétaire (coffre BYOK) si Gemini, sinon clé serveur
// GEMINI_API_KEY (free tier = levier coût). Métré (1 crédit/run, clé serveur).
// ════════════════════════════════════════════════════════════════
const GEO_MODEL = 'gemini-2.5-flash';
const GEO_MAX_PROMPTS = 5;

// Moteurs GEO web-groundés (recherche web RÉELLE) : gemini = grounding Google,
// perplexity = sonar, gpt = Responses API web_search.
const GEO_ENGINES = ['gemini', 'perplexity', 'gpt'];
const GEO_ENGINE_LABEL = { gemini: 'Gemini', perplexity: 'Perplexity', gpt: 'ChatGPT' };
function _geoServerKey(env, engine) {
  if (!env) return null;
  if (engine === 'gemini') return env.GEMINI_API_KEY ? String(env.GEMINI_API_KEY) : null;
  if (engine === 'perplexity') return env.PERPLEXITY_API_KEY ? String(env.PERPLEXITY_API_KEY) : null;
  if (engine === 'gpt') return env.OPENAI_API_KEY ? String(env.OPENAI_API_KEY) : null;
  return null;
}
function _geoEnabled(env) { return !!(env && (env.GEMINI_API_KEY || env.PERPLEXITY_API_KEY || env.OPENAI_API_KEY)); }

// Moteurs interrogeables : pour chacun, clé du propriétaire (BYOK si moteur
// actif compatible, respecte le flag) sinon clé serveur. Dédupe par moteur.
async function _resolveGeoEngines(env, tenant) {
  let byok = null;
  try { byok = await resolveEngineForTenant(env, tenant); } catch (_) {}
  const out = [];
  for (const engine of GEO_ENGINES) {
    if (byok && byok.engine === engine && byok.apiKey) out.push({ engine, apiKey: byok.apiKey, source: 'byok' });
    else { const k = _geoServerKey(env, engine); if (k) out.push({ engine, apiKey: k, source: 'server' }); }
  }
  return out;
}

// Prompts par défaut façon « prospect » à partir de l'activité + la ville.
function _defaultGeoPrompts(activity, city) {
  const a = (String(activity || '').trim()) || 'établissement';
  const c = String(city || '').trim() ? ` à ${String(city).trim()}` : '';
  return [
    `Quel est le meilleur ${a}${c} ?`,
    `Peux-tu me recommander un bon ${a}${c} ?`,
    `Vers quel ${a} me tourner${c} ?`,
  ];
}
function _normalizePrompts(arr, activity, city) {
  let list = Array.isArray(arr) ? arr.map((s) => String(s || '').trim()).filter(Boolean) : [];
  // S11.1 — purge des fallbacks GÉNÉRIQUES persistés : l'ancien code (S5)
  // sauvegardait les prompts normalisés, donc « Quel est le meilleur
  // établissement ? » (sans lieu ni activité) s'est retrouvé en base comme
  // s'il était choisi par l'utilisateur — et gagnait ensuite sur la config
  // ville/activité fraîchement remplie. Ces textes sont les nôtres, jamais
  // une requête légitime : on les écarte, les défauts se régénèrent avec
  // le contexte actuel.
  const generic = new Set(_defaultGeoPrompts('', ''));
  list = list.filter((s) => !generic.has(s));
  list = list.map((s) => s.slice(0, 200)).slice(0, GEO_MAX_PROMPTS);
  return list.length ? list : _defaultGeoPrompts(activity, city);
}

// Requête Gemini AVEC grounding Google Search. Best-effort : { ok, text, sources }.
async function _geminiGrounded(apiKey, prompt) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEO_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] };
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
    let data = {}; try { data = await res.json(); } catch (_) {}
    if (!res.ok) return { ok: false, status: res.status, msg: String((data && data.error && data.error.message) || `HTTP ${res.status}`) };
    const cand = data && data.candidates && data.candidates[0];
    const text = (((cand && cand.content && cand.content.parts) || []).map((p) => (p && p.text) ? p.text : '').join(' ')).replace(/\s+/g, ' ').trim();
    const gm = (cand && cand.groundingMetadata) || {};
    const sources = ((gm.groundingChunks) || []).map((c) => ({ title: (c && c.web && c.web.title) || '', uri: (c && c.web && c.web.uri) || '' })).filter((s) => s.uri).slice(0, 8);
    return { ok: true, text, sources, queries: gm.webSearchQueries || [], usage: (data && data.usageMetadata) || null };
  } catch (e) {
    return { ok: false, status: 0, msg: (e && e.name === 'AbortError') ? 'délai dépassé' : ((e && e.message) || 'réseau') };
  } finally { clearTimeout(timer); }
}

// Perplexity (sonar) — web-grounded nativement (OpenAI-compat). Sources = citations/search_results.
async function _perplexityGrounded(apiKey, prompt) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: prompt }] }), signal: ctrl.signal,
    });
    let data = {}; try { data = await res.json(); } catch (_) {}
    if (!res.ok) return { ok: false, status: res.status, msg: String((data && data.error && (data.error.message || data.error)) || `HTTP ${res.status}`) };
    const text = String((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').replace(/\s+/g, ' ').trim();
    let sources = [];
    if (Array.isArray(data.search_results)) sources = data.search_results.map((s) => ({ title: s.title || '', uri: s.url || '' }));
    else if (Array.isArray(data.citations)) sources = data.citations.map((u) => ({ title: '', uri: String(u) }));
    return { ok: true, text, sources: sources.filter((s) => s.uri).slice(0, 8) };
  } catch (e) {
    return { ok: false, status: 0, msg: (e && e.name === 'AbortError') ? 'délai dépassé' : ((e && e.message) || 'réseau') };
  } finally { clearTimeout(timer); }
}

// ChatGPT — Responses API + outil web_search (voie pérenne ; gpt-4o-search-preview
// est déprécié 2026-07-23). Best-effort : si le format évolue, l'échec dégrade par-moteur.
async function _chatgptGrounded(apiKey, prompt) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 35000);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', tools: [{ type: 'web_search' }], input: prompt }), signal: ctrl.signal,
    });
    let data = {}; try { data = await res.json(); } catch (_) {}
    if (!res.ok) return { ok: false, status: res.status, msg: String((data && data.error && (data.error.message || data.error)) || `HTTP ${res.status}`) };
    let text = String(data.output_text || '');
    const sources = [];
    const items = Array.isArray(data.output) ? data.output : [];
    for (const it of items) {
      const parts = (it && Array.isArray(it.content)) ? it.content : [];
      for (const p of parts) {
        if (!data.output_text && p && typeof p.text === 'string') text += ' ' + p.text;
        const anns = (p && Array.isArray(p.annotations)) ? p.annotations : [];
        for (const a of anns) {
          const uc = (a && a.url_citation) ? a.url_citation : (a && a.type === 'url_citation' ? a : null);
          if (uc && uc.url) sources.push({ title: uc.title || '', uri: uc.url });
        }
      }
    }
    return { ok: true, text: text.replace(/\s+/g, ' ').trim(), sources: sources.filter((s) => s.uri).slice(0, 8) };
  } catch (e) {
    return { ok: false, status: 0, msg: (e && e.name === 'AbortError') ? 'délai dépassé' : ((e && e.message) || 'réseau') };
  } finally { clearTimeout(timer); }
}

function _engineGrounded(engine, apiKey, prompt) {
  if (engine === 'perplexity') return _perplexityGrounded(apiKey, prompt);
  if (engine === 'gpt') return _chatgptGrounded(apiKey, prompt);
  return _geminiGrounded(apiKey, prompt);
}

// _sentiment / _detectCitation / _geoScore (+ _cellScore, extractUrls, analyzeManual)
// vivent désormais dans ../lib/geo-analyze.js (pur, testable, partagé auto+manuel).

// Cœur d'un run GEO : interroge tous les moteurs × toutes les questions (en
// parallèle), détecte citation + sentiment, score, persiste, fixe next_geo_at.
// Métré : 1 crédit si une clé SERVEUR est utilisée (BYOK = hors compteur).
// Partagé par la route on-demand et le cron hebdo.
async function _executeGeoRun(env, { id, tenant, site, businessName, city, activity, prompts, plan, lookupHmac }) {
  // S9/C10 — refus de scorer un test VIDE : sans activité, ville ni requêtes
  // personnalisées, les prompts par défaut deviennent « Quel est le meilleur
  // établissement ? » sans lieu ni catégorie. Aucun établissement au monde
  // ne sort sur cette question — le 0/100 qui en découlait était une
  // affirmation (« vous êtes invisible dans les IA ») tirée d'un test nul.
  if (!String(city || '').trim() && !String(activity || '').trim()) {
    const defaults = new Set(_defaultGeoPrompts('', ''));
    if ((prompts || []).every((p) => defaults.has(p))) return { error: 'not-configured' };
  }
  const engines = await _resolveGeoEngines(env, tenant);
  if (!engines.length) return { error: 'no-key' };

  const usedServer = engines.some((e) => e.source === 'server');
  let creditsEnforced = false, creditResult = null;
  if (usedServer && lookupHmac) {
    creditsEnforced = await isEnforceEnabled(env, lookupHmac);
    if (creditsEnforced) {
      creditResult = await consumeCredits(env, { bucketKey: lookupHmac, plan, tool: 'sentinel' });
      if (!creditResult.ok && creditResult.blocked) return { blocked: true };
    }
  }

  const host = _hostOf(site.url);
  const tasks = [];
  for (const prompt of prompts) for (const e of engines) tasks.push({ prompt, engine: e.engine, apiKey: e.apiKey });
  const cells = await Promise.all(tasks.map(async (t) => {
    const r = await _engineGrounded(t.engine, t.apiKey, t.prompt);
    if (!r.ok) return { prompt: t.prompt, cell: { engine: t.engine, error: r.msg || 'échec', cited: false, sourced: false, rank: null } };
    const det = _detectCitation(r.text, r.sources, businessName, host);
    return { prompt: t.prompt, cell: { engine: t.engine, cited: det.cited, sourced: det.sourced, rank: det.rank, sentiment: det.cited ? _sentiment(r.text, businessName) : null, snippet: String(r.text || '').slice(0, 280), sources: (r.sources || []).slice(0, 4) } };
  }));
  const anyOk = cells.some((c) => !c.cell.error);
  if (!anyOk) {
    if (creditsEnforced && creditResult && creditResult.ok) {
      await refundCredits(env, { bucketKey: lookupHmac, tool: 'sentinel', cost: creditResult.cost, packsDrawn: creditResult.packsDrawn }).catch(() => {});
    }
    const firstErr = (cells[0] && cells[0].cell && cells[0].cell.error) || 'service indisponible';
    return { error: 'all-failed', detail: firstErr };
  }

  const byPrompt = new Map(prompts.map((p) => [p, []]));
  for (const c of cells) { (byPrompt.get(c.prompt) || []).push(c.cell); }
  const results = prompts.map((p) => ({ prompt: p, engines: byPrompt.get(p) || [] }));
  const score = _geoScore(results);

  // ── S14.3 · présence dans les SOURCES citées ─────────────────────────────
  // Les IA citent des pages-listes (annuaires, offices de tourisme) — pas les
  // sites d'établissements. Le levier n'est pas la FAQ du client : c'est
  // d'être DANS ces pages. On les fetch (top 4, parallèle, best-effort) et on
  // vérifie si l'établissement y figure. Reco concrète : « demandez votre
  // inscription à X, cité N fois par les IA ».
  let sourcesCheck = null;
  try {
    const top = topCitedDomains(results, 4);
    const checked = await Promise.all(top.map(async (s) => {
      try {
        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(s.uri, { redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
        const body = (await res.text()).slice(0, 500000);
        clearTimeout(tm);
        return { domain: s.domain, citations: s.citations, present: presenceMatch(body, businessName, host), checked: true };
      } catch (_) { return { domain: s.domain, citations: s.citations, present: null, checked: false }; }
    }));
    if (checked.length) sourcesCheck = checked;
  } catch (_) { /* best-effort : le run GEO n'échoue jamais sur ce confort */ }

  await env.DB.prepare("UPDATE sentinel_geo SET last_score = ?, last_results = ?, last_sources_check = ?, last_run_at = datetime('now'), next_geo_at = datetime('now', '+7 days'), updated_at = datetime('now') WHERE site_id = ? AND tenant_id = ?")
    .bind(score, JSON.stringify(results), sourcesCheck ? JSON.stringify(sourcesCheck) : null, id, tenant).run();
  // S14.2 — historique (lissage + tendance honnête à venir).
  await env.DB.prepare("INSERT INTO sentinel_geo_history (site_id, tenant_id, score, engines, prompts) VALUES (?, ?, ?, ?, ?)")
    .bind(id, tenant, score, engines.length, prompts.length).run().catch(() => {});

  return { score, results, engines: engines.map((e) => e.engine), sourcesCheck };
}

async function _geoConfigRow(env, id, tenant) {
  return env.DB.prepare("SELECT business_name, city, activity, prompts, last_score, last_results, last_sources_check, last_run_at FROM sentinel_geo WHERE site_id = ? AND tenant_id = ?").bind(id, tenant).first();
}

// GET /sites/:id/geo — config + dernier relevé.
export async function handleSiteGeoGet(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);
  const row = await _geoConfigRow(env, id, g.tenant);
  let prompts = [], results = null;
  if (row) { try { prompts = JSON.parse(row.prompts || '[]'); } catch (_) {} try { results = row.last_results ? JSON.parse(row.last_results) : null; } catch (_) {} }
  const activity = (row && row.activity) || '', city = (row && row.city) || '';
  return json({ geo: {
    enabled: _geoEnabled(env),
    configured: !!row,
    business_name: (row && row.business_name) || site.label || _hostOf(site.url),
    city, activity,
    prompts: (prompts && prompts.length) ? prompts : _defaultGeoPrompts(activity, city),
    score: row ? row.last_score : null,
    results, run_at: row ? row.last_run_at : null,
  } }, 200, origin);
}

// POST /sites/:id/geo — sauvegarde la config (sans lancer de mesure).
export async function handleSiteGeoSave(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);
  const b = await parseBody(request);
  const businessName = String((b && b.business_name) || '').trim().slice(0, 160);
  if (!businessName) return err('Le nom de l\'établissement est requis pour mesurer la visibilité.', 400, origin);
  const city = String((b && b.city) || '').trim().slice(0, 120);
  const activity = String((b && b.activity) || '').trim().slice(0, 120);
  const prompts = _normalizePrompts(b && b.prompts, activity, city);
  await env.DB.prepare(`
    INSERT INTO sentinel_geo (site_id, tenant_id, business_name, city, activity, prompts, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(site_id) DO UPDATE SET business_name=excluded.business_name, city=excluded.city, activity=excluded.activity, prompts=excluded.prompts, updated_at=datetime('now')
  `).bind(id, g.tenant, businessName, city, activity, JSON.stringify(prompts)).run();
  return json({ ok: true, geo: { business_name: businessName, city, activity, prompts } }, 200, origin);
}

// POST /sites/:id/geo/run — interroge les moteurs (Gemini/Perplexity/ChatGPT),
// détecte citation + sentiment, score. Métré. Parallélise les cellules.
export async function handleSiteGeoRun(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);

  // Config = body (le front sauvegarde + lance) sinon ligne existante.
  const b = await parseBody(request);
  const row = await _geoConfigRow(env, id, g.tenant);
  const businessName = String((b && b.business_name) || (row && row.business_name) || site.label || _hostOf(site.url)).trim().slice(0, 160);
  if (!businessName) return err('Le nom de l\'établissement est requis.', 400, origin);
  const city = String((b && b.city) || (row && row.city) || '').trim().slice(0, 120);
  const activity = String((b && b.activity) || (row && row.activity) || '').trim().slice(0, 120);
  let prompts;
  if (b && Array.isArray(b.prompts)) prompts = _normalizePrompts(b.prompts, activity, city);
  else { let saved = []; try { saved = JSON.parse((row && row.prompts) || '[]'); } catch (_) {} prompts = _normalizePrompts(saved, activity, city); }

  // Le run sauvegarde aussi la config (1 geste).
  await env.DB.prepare(`
    INSERT INTO sentinel_geo (site_id, tenant_id, business_name, city, activity, prompts, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(site_id) DO UPDATE SET business_name=excluded.business_name, city=excluded.city, activity=excluded.activity, prompts=excluded.prompts, updated_at=datetime('now')
  `).bind(id, g.tenant, businessName, city, activity, JSON.stringify(prompts)).run();

  const out = await _executeGeoRun(env, { id, tenant: g.tenant, site, businessName, city, activity, prompts, plan: g.plan, lookupHmac: g.claims && g.claims.sub });
  if (out.blocked) return json({ error: 'Conversations épuisées ce mois. Ajoutez un pack de conversations ou attendez le 1er du mois.', code: 'AI_CREDITS_EXHAUSTED' }, 429, origin);
  if (out.error === 'not-configured') return json({ error: 'Visibilité IA non configurée : renseignez l\'activité et la ville (ou vos propres requêtes). Un test générique donnerait un 0/100 sans signification — Sentinel refuse de publier ce chiffre.', code: 'GEO_NOT_CONFIGURED' }, 400, origin);
  if (out.error === 'no-key') return err("La mesure de visibilité IA n'est pas activée (aucune clé moteur configurée côté serveur). Le reste de l'audit fonctionne.", 503, origin);
  if (out.error) return err(`La mesure de visibilité IA a échoué (${out.detail || 'service indisponible'}). Réessayez plus tard.`, 502, origin);

  return json({ geo: { score: out.score, results: out.results, run_at: new Date().toISOString(), business_name: businessName, city, activity, prompts, engines: out.engines } }, 200, origin);
}

// POST /sites/:id/geo/manual — mode GRATUIT (copier-coller). L'utilisateur a
// interrogé lui-même une IA web (Gemini/Perplexity/ChatGPT…) et recolle les
// réponses ; on les analyse (cité ? rang ? sentiment ?) SANS aucune clé ni
// crédit, et on NE pose PAS next_geo_at (manuel = pas de mesure auto par le cron).
export async function handleSiteGeoManual(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);

  const b = await parseBody(request);
  const row = await _geoConfigRow(env, id, g.tenant);
  const businessName = String((b && b.business_name) || (row && row.business_name) || site.label || _hostOf(site.url)).trim().slice(0, 160);
  if (!businessName) return err("Le nom de l'établissement est requis.", 400, origin);
  const city = String((b && b.city) || (row && row.city) || '').trim().slice(0, 120);
  const activity = String((b && b.activity) || (row && row.activity) || '').trim().slice(0, 120);
  const engineRaw = String((b && b.engine) || 'autre').toLowerCase();
  const engine = ['gemini', 'perplexity', 'gpt'].includes(engineRaw) ? engineRaw : 'autre';

  // Prompts de référence (corps > config sauvegardée > défaut) pour mapper la découpe.
  let savedPrompts = []; try { savedPrompts = JSON.parse((row && row.prompts) || '[]'); } catch (_) {}
  const prompts = _normalizePrompts((b && Array.isArray(b.prompts)) ? b.prompts : savedPrompts, activity, city);

  // Mode « un seul bloc » : l'utilisateur recolle TOUTE la réponse de l'IA ; on la
  // découpe par question (### QUESTION N) — repli sur l'analyse globale sinon.
  const answer = String((b && b.answer) || '').slice(0, 20000);
  let entries;
  if (answer.trim()) {
    entries = _splitManualAnswer(answer, prompts) || [{ prompt: "Recommandations de l'IA", text: answer }];
  } else {
    // Rétro-compat : réponses fournies une par question.
    entries = (Array.isArray(b && b.entries) ? b.entries : [])
      .map((e) => ({ prompt: String((e && e.prompt) || '').trim().slice(0, 200), text: String((e && e.text) || '').slice(0, 8000) }))
      .filter((e) => e.prompt);
  }
  if (!entries.some((e) => (e.text || '').trim())) return err("Collez la réponse de l'IA à analyser.", 400, origin);
  // Sauvegarde la config (1 geste), comme le run auto.
  await env.DB.prepare(`
    INSERT INTO sentinel_geo (site_id, tenant_id, business_name, city, activity, prompts, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(site_id) DO UPDATE SET business_name=excluded.business_name, city=excluded.city, activity=excluded.activity, prompts=excluded.prompts, updated_at=datetime('now')
  `).bind(id, g.tenant, businessName, city, activity, JSON.stringify(prompts)).run();

  const host = _hostOf(site.url);
  const results = _analyzeManualGeo(entries, { engine, businessName, host });
  const score = _geoScore(results);
  // Relevé stocké SANS next_geo_at (le cron ne rejoue pas un run manuel).
  await env.DB.prepare("UPDATE sentinel_geo SET last_score = ?, last_results = ?, last_run_at = datetime('now'), updated_at = datetime('now') WHERE site_id = ? AND tenant_id = ?")
    .bind(score, JSON.stringify(results), id, g.tenant).run();

  return json({ geo: { score, results, run_at: new Date().toISOString(), business_name: businessName, city, activity, prompts, engines: [engine], mode: 'manual' } }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// V2 · GOOGLE SEARCH CONSOLE — axe « Mots-clés » (positions Google réelles)
//
// OAuth par site (scope webmasters.readonly, lecture seule). Le refresh_token
// est chiffré au repos (AES-GCM, réutilise KS_ENCRYPTION_KEY). Le code reste
// multi-sites : l'UI propose la connexion sur chaque site. En mode « Test »
// Google, seuls les comptes ajoutés en testeurs autorisent ; publier l'app
// OAuth ouvre la connexion aux clients sans aucune réécriture.
//
// Secrets Worker requis : KS_GSC_CLIENT_ID, KS_GSC_CLIENT_SECRET (+ l'URI de
// redirection enregistrée côté Google = origine Worker + GSC_REDIRECT_PATH).
// ═══════════════════════════════════════════════════════════════
const GSC_REDIRECT_PATH = '/api/sentinel/gsc/callback';
const GSC_SCOPE         = 'https://www.googleapis.com/auth/webmasters.readonly';
const GSC_STATE_TTL     = 600;     // 10 min — le state signé expire vite
const GSC_WINDOW_DAYS   = 28;      // fenêtre d'analyse
const GSC_LATENCY_DAYS  = 2;       // les données GSC ont ~2 j de retard
const GSC_ROW_LIMIT     = 25;      // top requêtes remontées

function _gscEnabled(env) {
  return !!(env && env.KS_GSC_CLIENT_ID && env.KS_GSC_CLIENT_SECRET && env.KS_ENCRYPTION_KEY);
}
function _gscRedirectUri(request) {
  return new URL(request.url).origin + GSC_REDIRECT_PATH;
}
function _gscConfigRow(env, id, tenant) {
  return env.DB.prepare("SELECT property, account_email, status, last_score, last_results, last_run_at FROM sentinel_gsc WHERE site_id = ? AND tenant_id = ?").bind(id, tenant).first();
}
function _gscDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}
function _escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Page de retour minimaliste (le callback Google arrive hors du front).
function _gscHtml(msg) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;background:#0b1020;color:#e7e9ee;display:grid;place-items:center;min-height:100vh;margin:0">` +
    `<div style="text-align:center;max-width:480px;padding:28px;font-size:16px;line-height:1.6">${msg}</div></body>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

// OAuth : échange du code → tokens (refresh_token inclus si access_type=offline+prompt=consent).
async function _gscExchangeCode(env, code, redirectUri) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.KS_GSC_CLIENT_ID, client_secret: env.KS_GSC_CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `token ${res.status}`);
  return data;
}
// OAuth : refresh_token → access_token frais (à chaque relevé).
async function _gscAccessToken(env, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.KS_GSC_CLIENT_ID, client_secret: env.KS_GSC_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `refresh ${res.status}`);
  return data.access_token;
}
async function _gscUserEmail(accessToken) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    const d = await r.json().catch(() => ({}));
    return d && d.email ? String(d.email).slice(0, 160) : '';
  } catch (_) { return ''; }
}
async function _gscListProperties(accessToken) {
  const r = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${accessToken}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d && d.error && d.error.message) || `sites ${r.status}`);
  return (d.siteEntry || []).map((s) => ({ siteUrl: s.siteUrl }));
}
// Choisit la meilleure propriété GSC pour l'URL du site : domaine (sc-domain:) > préfixe d'URL.
function _gscPickProperty(props, siteUrl) {
  let host = ''; try { host = new URL(siteUrl).host.replace(/^www\./, ''); } catch (_) {}
  if (!host) return null;
  const dom = props.find((p) => p.siteUrl === `sc-domain:${host}`);
  if (dom) return dom.siteUrl;
  const pref = props.find((p) => { try { return new URL(p.siteUrl).host.replace(/^www\./, '') === host; } catch (_) { return false; } });
  return pref ? pref.siteUrl : null;
}
async function _gscQuery(accessToken, property, body) {
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((d && d.error && d.error.message) || `query ${r.status}`); e.httpStatus = r.status; throw e; }
  return d.rows || [];
}
// Score « Mots-clés » 0-100 : position moyenne pondérée par les impressions.
// position 1 → 100 ; 10 → ~64 ; 20 → ~24 ; ≥26 → 0. Pas d'impression = 0 (invisible).
function _gscScore(rows) {
  let imp = 0, wpos = 0;
  for (const r of rows) { const i = r.impressions || 0; if (i > 0 && r.position) { imp += i; wpos += i * r.position; } }
  if (!imp) return 0;
  const avg = wpos / imp;
  return Math.max(0, Math.min(100, Math.round(100 - (avg - 1) * 4)));
}
// Relevé complet : access token frais → top requêtes + totaux → score → persiste.
async function _gscExecuteRun(env, { id, tenant, property, refreshToken }) {
  const accessToken = await _gscAccessToken(env, refreshToken);
  const startDate = _gscDate(GSC_WINDOW_DAYS + GSC_LATENCY_DAYS), endDate = _gscDate(GSC_LATENCY_DAYS);
  const rows = await _gscQuery(accessToken, property, { startDate, endDate, dimensions: ['query'], rowLimit: GSC_ROW_LIMIT });
  const queries = rows.map((r) => ({
    query: (r.keys && r.keys[0]) || '', clicks: r.clicks || 0, impressions: r.impressions || 0,
    ctr: Math.round((r.ctr || 0) * 1000) / 10, position: r.position ? Math.round(r.position * 10) / 10 : null,
  })).filter((q) => q.query);
  let totals = { clicks: 0, impressions: 0, position: null };
  try {
    const tr = await _gscQuery(accessToken, property, { startDate, endDate, dimensions: [], rowLimit: 1 });
    if (tr && tr[0]) totals = { clicks: tr[0].clicks || 0, impressions: tr[0].impressions || 0, position: tr[0].position ? Math.round(tr[0].position * 10) / 10 : null };
  } catch (_) { /* totaux best-effort */ }
  const score = _gscScore(rows);
  const results = { window: { startDate, endDate }, totals, queries };
  await env.DB.prepare("UPDATE sentinel_gsc SET last_score = ?, last_results = ?, last_run_at = datetime('now'), next_gsc_at = datetime('now','+7 days'), status='connected', updated_at = datetime('now') WHERE site_id = ? AND tenant_id = ?")
    .bind(score, JSON.stringify(results), id, tenant).run();
  return { score, results };
}

// GET /sites/:id/gsc/connect — démarre l'OAuth Google (renvoie { authUrl }).
export async function handleSiteGscConnect(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  if (!_gscEnabled(env)) return err("La connexion Search Console n'est pas activée côté serveur.", 503, origin);
  const site = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);
  const state = await signJWT({ purpose: 'gsc_oauth', tenant: g.tenant, site_id: id }, env, GSC_STATE_TTL);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', env.KS_GSC_CLIENT_ID);
  u.searchParams.set('redirect_uri', _gscRedirectUri(request));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GSC_SCOPE);
  u.searchParams.set('access_type', 'offline');     // → refresh_token
  u.searchParams.set('prompt', 'consent');          // force le refresh_token même au 2e passage
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  return json({ authUrl: u.toString() }, 200, origin);
}

// GET /api/sentinel/gsc/callback — Google redirige ici (public ; tenant+site scellés dans le state signé).
export async function handleGscCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oErr = url.searchParams.get('error');
  if (oErr) return _gscHtml(`❌ Autorisation refusée : ${_escHtml(oErr)}`);
  if (!code || !state) return _gscHtml('❌ Paramètres manquants (code/state).');
  let tenant, siteId;
  try {
    const claims = await verifyJWT(state, env);
    if (claims.purpose !== 'gsc_oauth' || !claims.tenant || !claims.site_id) throw new Error('state');
    tenant = claims.tenant; siteId = claims.site_id;
  } catch (_) {
    return _gscHtml('❌ Sécurité : lien de connexion invalide ou expiré. Relance depuis Sentinel.');
  }
  if (!_gscEnabled(env)) return _gscHtml('❌ Search Console non configuré sur le Worker.');
  await _ensureSchema(env);
  const site = await env.DB.prepare("SELECT id, url FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(siteId, tenant).first();
  if (!site) return _gscHtml('❌ Site introuvable pour ce compte.');
  try {
    const tok = await _gscExchangeCode(env, code, _gscRedirectUri(request));
    if (!tok.refresh_token) return _gscHtml("❌ Google n'a pas renvoyé de jeton de rafraîchissement. Révoque l'accès « Sentinel » dans ton compte Google (myaccount.google.com → Sécurité), puis reconnecte.");
    const props = await _gscListProperties(tok.access_token);
    const property = _gscPickProperty(props, site.url);
    if (!property) {
      const email = await _gscUserEmail(tok.access_token);
      const list = props.length
        ? `<br><br>Sites présents dans cette Search Console${email ? ` (${_escHtml(email)})` : ''} :<br><b>${props.map((p) => _escHtml(p.siteUrl)).join('<br>')}</b>`
        : `<br><br>Ce compte Google${email ? ` (${_escHtml(email)})` : ''} n'a <b>aucun site</b> dans Search Console.`;
      return _gscHtml(
        `❌ <strong>Aucune propriété ne correspond à ${_escHtml(site.url)}.</strong>${list}` +
        `<br><br><b>Que faire :</b><br>` +
        `1) Si votre site n'est pas dans la liste, ajoutez-le sur <a href="https://search.google.com/search-console" target="_blank">Google Search Console</a> (« Ajouter une propriété » › « Préfixe de l'URL »), puis vérifiez-le.<br>` +
        `2) Si la liste montre un autre compte que prévu, reconnectez-vous avec le <b>bon compte Google</b>.<br><br>` +
        `Ensuite, revenez dans Sentinel et cliquez à nouveau « Connecter Search Console ».`);
    }
    const email = await _gscUserEmail(tok.access_token);
    const enc = await encrypt(tok.refresh_token, env.KS_ENCRYPTION_KEY);
    await env.DB.prepare(`
      INSERT INTO sentinel_gsc (site_id, tenant_id, property, account_email, refresh_ciphertext, refresh_iv, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'connected', datetime('now'))
      ON CONFLICT(site_id) DO UPDATE SET property=excluded.property, account_email=excluded.account_email, refresh_ciphertext=excluded.refresh_ciphertext, refresh_iv=excluded.refresh_iv, status='connected', updated_at=datetime('now')
    `).bind(siteId, tenant, property, email, enc.ciphertext, enc.iv).run();
    try { await _gscExecuteRun(env, { id: siteId, tenant, property, refreshToken: tok.refresh_token }); } catch (_) { /* 1er relevé best-effort */ }
    return _gscHtml(`✅ <strong>Search Console connectée</strong> : ${_escHtml(property)}${email ? ` (${_escHtml(email)})` : ''}<br><br>Ferme cet onglet et recharge <strong>Sentinel</strong>.`);
  } catch (e) {
    return _gscHtml(`❌ Échec de connexion : ${_escHtml(e.message || 'erreur inconnue')}`);
  }
}

// GET /sites/:id/gsc — config + dernier relevé (jamais de secret renvoyé).
export async function handleSiteGscGet(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const row = await _gscConfigRow(env, id, g.tenant);
  let results = null; if (row && row.last_results) { try { results = JSON.parse(row.last_results); } catch (_) {} }
  return json({ gsc: {
    available: _gscEnabled(env),
    connected: !!(row && row.status === 'connected'),
    property: row ? row.property : null,
    account_email: row ? row.account_email : null,
    score: row ? row.last_score : null,
    results, run_at: row ? row.last_run_at : null,
  } }, 200, origin);
}

// POST /sites/:id/gsc/run — rafraîchit le relevé Search Console.
export async function handleSiteGscRun(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  if (!_gscEnabled(env)) return err("Search Console n'est pas activé côté serveur.", 503, origin);
  const site = await env.DB.prepare("SELECT id FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);
  const row = await env.DB.prepare("SELECT property, refresh_ciphertext, refresh_iv, status FROM sentinel_gsc WHERE site_id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!row || row.status !== 'connected' || !row.refresh_ciphertext) return err('Search Console non connectée pour ce site.', 409, origin);
  let refreshToken;
  try { refreshToken = await decrypt(row.refresh_ciphertext, row.refresh_iv, env.KS_ENCRYPTION_KEY); }
  catch (_) { return err('Jeton illisible — reconnecte Search Console.', 500, origin); }
  try {
    const out = await _gscExecuteRun(env, { id, tenant: g.tenant, property: row.property, refreshToken });
    return json({ gsc: { connected: true, property: row.property, score: out.score, results: out.results, run_at: new Date().toISOString() } }, 200, origin);
  } catch (e) {
    const m = String(e.message || '');
    if (e.httpStatus === 401 || e.httpStatus === 403 || /invalid_grant|unauthorized/i.test(m)) {
      await env.DB.prepare("UPDATE sentinel_gsc SET status='error', updated_at=datetime('now') WHERE site_id = ? AND tenant_id = ?").bind(id, g.tenant).run();
      return err("L'accès Google a expiré ou a été révoqué. Reconnecte Search Console.", 401, origin);
    }
    return err(`Lecture Search Console impossible (${m || 'service indisponible'}).`, 502, origin);
  }
}

// POST /sites/:id/gsc/disconnect — retire la connexion (efface le token chiffré).
export async function handleSiteGscDisconnect(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  await env.DB.prepare("DELETE FROM sentinel_gsc WHERE site_id = ? AND tenant_id = ?").bind(id, g.tenant).run();
  return json({ ok: true }, 200, origin);
}

// ── Web push : abonnement (S1.5, patron keynapse) ───────────────
export async function handlePushSubscribe(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin); if (g.error) return g.error;
  const b = await parseBody(request);
  const endpoint = String(b.endpoint || '').trim();
  const p256dh = String(b.p256dh || '').trim();
  const auth = String(b.auth || '').trim();
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 1024 || !p256dh || !auth) return err('Abonnement invalide', 400, origin);
  await env.DB.prepare(
    `INSERT INTO sentinel_push_subs (endpoint, tenant_id, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET tenant_id = excluded.tenant_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).bind(endpoint, g.tenant, p256dh, auth).run();
  return json({ ok: true }, 200, origin);
}
export async function handlePushUnsubscribe(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin); if (g.error) return g.error;
  const b = await parseBody(request);
  const endpoint = String(b.endpoint || '').trim();
  if (endpoint) await env.DB.prepare('DELETE FROM sentinel_push_subs WHERE endpoint = ? AND tenant_id = ?').bind(endpoint, g.tenant).run();
  return json({ ok: true }, 200, origin);
}

// ── Cron — battement de fond (file lissée) + alertes ────────────
export async function sweepDueChecks(env) {
  if (!env || !env.DB) return { skipped: 'no-db' };
  try { await _ensureSchema(env); } catch (_) { return { skipped: 'no-schema' }; }
  const due = (await env.DB.prepare(
    `SELECT id, tenant_id, url, label FROM sentinel_sites
      WHERE next_check_at IS NULL OR next_check_at <= datetime('now')
      ORDER BY (next_check_at IS NOT NULL), next_check_at ASC LIMIT ${SWEEP_BATCH}`
  ).all()).results || [];
  let checked = 0, alerts = 0;
  for (const s of due) {
    try {
      const r = await _check(s.url);
      const { transition } = await _recordCheck(env, s.tenant_id, s.id, r);
      checked++;
      if (transition) { await _alert(env, s.tenant_id, s, transition); alerts++; }
    } catch (_) {}
  }
  return { due: due.length, checked, alerts };
}

// ── Cron — mesure GEO hebdomadaire (file lissée, S5.1) ──────────
// Tourne sur le cron quotidien : ne traite que les sites GEO échus (next_geo_at
// posé au 1er run manuel → +7 j), petit lot. Idempotent. Métré sur le portefeuille
// du propriétaire (plan résolu via licences). Skip si aucune clé serveur (BYOK seul
// = on-demand). next_geo_at est reposé par _executeGeoRun (+7 j) ; échec → +1 j.
const GEO_SWEEP_BATCH = 15;
export async function sweepDueGeo(env) {
  if (!env || !env.DB) return { skipped: 'no-db' };
  if (!_geoEnabled(env)) return { skipped: 'no-geo-key' };
  try { await _ensureSchema(env); } catch (_) { return { skipped: 'no-schema' }; }
  const due = (await env.DB.prepare(
    `SELECT g.site_id AS id, g.tenant_id AS tenant, g.business_name AS business_name, g.city AS city,
            g.activity AS activity, g.prompts AS prompts, s.url AS url, s.label AS label, l.plan AS plan
       FROM sentinel_geo g
       JOIN sentinel_sites s ON s.id = g.site_id AND s.tenant_id = g.tenant_id
       LEFT JOIN licences l ON l.lookup_hmac = g.tenant_id
      WHERE g.business_name IS NOT NULL AND g.business_name <> ''
        AND g.next_geo_at IS NOT NULL AND g.next_geo_at <= datetime('now')
      ORDER BY g.next_geo_at ASC LIMIT ${GEO_SWEEP_BATCH}`
  ).all()).results || [];
  let ran = 0, failed = 0;
  for (const d of due) {
    try {
      let prompts = []; try { prompts = JSON.parse(d.prompts || '[]'); } catch (_) {}
      prompts = _normalizePrompts(prompts, d.activity, d.city);
      const out = await _executeGeoRun(env, {
        id: d.id, tenant: d.tenant, site: { url: d.url, label: d.label },
        businessName: d.business_name, city: d.city || '', activity: d.activity || '',
        prompts, plan: d.plan || null, lookupHmac: d.tenant,
      });
      if (out && out.score != null) { ran++; continue; }
      failed++;
      // S9/C10 — non configuré : on ARRÊTE le cron pour ce site (next_geo_at
      // NULL) au lieu de reboucler ; la prochaine sauvegarde de config le relancera.
      if (out && out.error === 'not-configured') {
        await env.DB.prepare("UPDATE sentinel_geo SET next_geo_at = NULL WHERE site_id = ? AND tenant_id = ?").bind(d.id, d.tenant).run().catch(() => {});
        continue;
      }
      // échec / bloqué → repousser d'1 j (évite de reboucler quotidiennement sur une clé KO).
      await env.DB.prepare("UPDATE sentinel_geo SET next_geo_at = datetime('now','+1 day') WHERE site_id = ? AND tenant_id = ?").bind(d.id, d.tenant).run().catch(() => {});
    } catch (_) { failed++; }
  }
  return { due: due.length, ran, failed };
}
