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
import { sentiment as _sentiment, detectCitation as _detectCitation, geoScore as _geoScore, analyzeManual as _analyzeManualGeo, splitManualAnswer as _splitManualAnswer } from '../lib/geo-analyze.js';
// S5 — GEO (visibilité IA) : clé du propriétaire via le coffre BYOK si dispo,
// sinon clés serveur GEMINI/PERPLEXITY/OPENAI (free tier Gemini = levier coût).
import { resolveEngineForTenant } from '../lib/llm-router.js';

const SENTINEL_ENGINE_VERSION = 'S7.3';
const UA = 'KeystoneSentinel/1.0 (+https://protein-keystone.com)';
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

// ── Sondes (fetch) ──────────────────────────────────────────────
function _classify(status) { return (status >= 200 && status < 400) ? 1 : 0; }

async function _probe(url) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS); const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const ms = Date.now() - t0; const status = res.status; const ok = _classify(status);
    let headerHint = '';
    for (const [k, v] of res.headers) { if (`${k}:${v}`.toLowerCase().includes('wix')) { headerHint = 'wix'; break; } }
    const html = (await res.text()).slice(0, 200000).toLowerCase();
    let platform = 'custom';
    if (headerHint === 'wix' || html.includes('static.wixstatic.com') || html.includes('wix.com') || html.includes('_wixcssstate') || html.includes('wixbisession')) platform = 'wix';
    else if (html.includes('/wp-content/') || html.includes('/wp-json') || html.includes('wp-includes') || html.includes('content="wordpress')) platform = 'wordpress';
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

// ── Audit on-page (S2) ──────────────────────────────────────────
const SEC_HEADERS = [
  ['strict-transport-security', 'HSTS'], ['content-security-policy', 'CSP'],
  ['x-frame-options', 'X-Frame-Options'], ['x-content-type-options', 'X-Content-Type-Options'],
  ['referrer-policy', 'Referrer-Policy'],
];
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
  let html = '', headers = null, reachable = false;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    headers = res.headers; reachable = _classify(res.status) === 1;
    html = (await res.text()).slice(0, 500000);
  } catch (_) { /* injoignable → audit minimal */ } finally { clearTimeout(timer); }

  // robots.txt + sitemap (best effort) — contrôle « site-level », fait sur la home.
  let robots = false, sitemap = false;
  if (opts.skipSite) {
    sitemap = !!opts.sitemapKnown;
  } else {
    try {
      const origin = new URL(url).origin;
      const rb = await _exists(`${origin}/robots.txt`, true); robots = rb.ok;
      if (rb.text && /sitemap:/i.test(rb.text)) sitemap = true;
      if (!sitemap) { const sm = await _exists(`${origin}/sitemap.xml`, false); sitemap = sm.ok; }
    } catch (_) {}
  }

  const lc = html.toLowerCase();
  const title = _between(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDesc = _between(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
                || _between(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const h1 = (lc.match(/<h1[\s>]/g) || []).length;
  const canonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
  const ogImage = /<meta[^>]+property=["']og:image["']/i.test(html);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const lang = /<html[^>]+lang=/i.test(html);
  const jsonld = /application\/ld\+json/i.test(html);
  const imgs = (lc.match(/<img\b/g) || []).length;
  const imgsAlt = (html.match(/<img\b[^>]*\balt=/gi) || []).length;
  const imgsMissing = Math.max(0, imgs - imgsAlt);
  const sec = {}; if (headers) for (const [h, label] of SEC_HEADERS) sec[label] = !!headers.get(h);

  // ── Présence locale (NAP) — signaux on-page, souverain (S6) ──
  const napPhone = /href=["']tel:/i.test(html) || /(?:\+33|0033)[\s.\-]?[1-9](?:[\s.\-]?\d{2}){4}/.test(html) || /\b0[1-9](?:[\s.\-]?\d{2}){4}\b/.test(html);
  const napAddress = /postaladdress/i.test(html) || /<address[\s>]/i.test(html)
    || (/\b(rue|avenue|boulevard|bd|impasse|chemin|place|all[ée]e|quai|cours)\b/i.test(lc) && /\b\d{5}\b/.test(html));
  const napLocalBiz = /localbusiness/i.test(html)
    || /"@type"\s*:\s*"(Restaurant|Store|Hotel|Bakery|CafeOrCoffeeShop|BarOrPub|ProfessionalService|MedicalBusiness|Dentist|Attorney|HairSalon|BeautySalon|AutoRepair|RealEstateAgent|Physician|FoodEstablishment)"/i.test(html);
  const napHours = /openinghours/i.test(html);

  const findings = [];
  const add = (axis, sev, key, title2, detail) => findings.push({ axis, sev, key, title: title2, detail });

  // ── SEO technique ──
  let seo = 0;
  if (title) { seo += (title.length >= 10 && title.length <= 70) ? 15 : 8; if (title.length > 70) add('seo', 'low', 'title_long', 'Balise title trop longue', `${title.length} caractères — visez 50-60.`); }
  else add('seo', 'high', 'title_missing', 'Balise <title> absente', 'Le titre est le premier signal SEO.');
  if (metaDesc) { seo += (metaDesc.length >= 50 && metaDesc.length <= 165) ? 15 : 8; }
  else add('seo', 'high', 'meta_missing', 'Méta description absente', 'Rédigez 50-160 caractères qui donnent envie de cliquer.');
  if (h1 === 1) seo += 15; else add('seo', 'medium', 'h1', h1 === 0 ? 'Aucun <h1>' : `${h1} balises <h1>`, 'Une page = un seul titre H1.');
  if (canonical) seo += 10; else add('seo', 'low', 'canonical', 'Balise canonical absente', 'Évite le contenu dupliqué aux yeux de Google.');
  if (viewport) seo += 10; else add('seo', 'high', 'viewport', 'Pas de balise viewport', 'Indispensable pour le mobile.');
  if (ogTitle) seo += 8; else add('seo', 'low', 'og_title', 'Open Graph titre absent', 'Améliore l\'aperçu lors des partages.');
  if (ogImage) seo += 7; else add('seo', 'low', 'og_image', 'Open Graph image absente', 'Une image d\'aperçu augmente les clics sur les réseaux.');
  if (jsonld) seo += 10; else add('seo', 'medium', 'jsonld', 'Données structurées (Schema.org) absentes', 'Sans elles, les IA et Google comprennent mal votre activité.');
  if (sitemap) seo += 10; else if (!opts.skipSite) add('seo', 'low', 'sitemap', 'Sitemap introuvable', 'Aide les moteurs à explorer toutes vos pages.');
  // Wix — sous-domaine gratuit (…wixsite.com) : pénalité SEO + crédibilité (détectable via l'URL ; site-level).
  let _host = ''; try { _host = new URL(url).hostname; } catch (_) {}
  if (!opts.skipSite && /\.wixsite\.com$/i.test(_host)) add('seo', 'high', 'wix_subdomain', 'Site sur une adresse Wix gratuite', 'L\'adresse se termine par .wixsite.com : un domaine personnalisé améliorerait nettement le référencement et la crédibilité.');
  seo = Math.min(100, seo);

  // ── Sécurité ──
  let securite = 0;
  for (const [, label] of SEC_HEADERS) {
    if (sec[label]) securite += 20;
    else add('securite', label === 'HSTS' || label === 'CSP' ? 'medium' : 'low', `sec_${label}`, `En-tête ${label} absent`, 'Renforce la protection des visiteurs.');
  }

  // ── Accessibilité ──
  let accessibilite = 0;
  if (lang) accessibilite += 35; else add('accessibilite', 'low', 'lang', 'Langue de la page non déclarée', 'Ajoutez lang="fr" sur <html>.');
  if (viewport) accessibilite += 25;
  if (imgs > 0) { accessibilite += Math.round(40 * imgsAlt / imgs); if (imgsMissing > 0) add('accessibilite', 'medium', 'img_alt', `${imgsMissing} image${imgsMissing > 1 ? 's' : ''} sans texte alternatif`, 'Le texte alt aide l\'accessibilité et le SEO images.'); }
  else accessibilite += 40;
  accessibilite = Math.min(100, accessibilite);

  // ── Présence locale (NAP + fiche établissement) ──
  let presence = 0;
  if (napPhone) presence += 30; else add('presence', 'low', 'nap_phone', 'Téléphone non détecté sur la page', 'Affichez un numéro cliquable (lien tel:) — clé pour les recherches locales et les IA.');
  if (napAddress) presence += 35; else add('presence', 'low', 'nap_address', 'Adresse postale non structurée', 'Affichez votre adresse complète, idéalement en données structurées (PostalAddress).');
  if (napLocalBiz) presence += 20; else add('presence', 'medium', 'nap_localbiz', 'Fiche établissement (LocalBusiness) absente', 'Décrivez votre établissement en Schema.org LocalBusiness : nom, adresse, téléphone, horaires.');
  if (napHours) presence += 15; else add('presence', 'low', 'nap_hours', 'Horaires d\'ouverture non déclarés', 'Publiez vos horaires (openingHours) — repris par Google et les assistants IA.');
  presence = Math.min(100, presence);

  const scores = { seo, securite, accessibilite, presence };
  return { reachable, scores, findings, sitemap };
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
  return [...found].filter((u2) => u2 !== homeNorm && _pathOf(u2) !== '/').slice(0, max);
}

// Audite la home + N pages internes en parallèle, agrège scores + findings.
async function _auditSite(url) {
  const home = await _audit(url);
  let extraUrls = [];
  try { extraUrls = await _discoverPages(url, MAX_AUDIT_PAGES - 1); } catch (_) {}
  const extras = (await Promise.all(extraUrls.map((u) =>
    _audit(u, { skipSite: true, sitemapKnown: home.sitemap }).then((r) => ({ url: u, ...r })).catch(() => null)
  ))).filter((p) => p && p.reachable);
  const pagesAudited = [{ url, ...home }].concat(extras);

  // Scores = moyenne par axe sur les pages atteintes.
  const scores = {};
  for (const ax of ['seo', 'securite', 'accessibilite', 'presence']) {
    const vals = pagesAudited.map((p) => p.scores && p.scores[ax]).filter((v) => typeof v === 'number');
    scores[ax] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  // Findings : site-level dédupliqués ; page-level taggés des pages concernées.
  const SITE_LEVEL = new Set(['sitemap', 'wix_subdomain', 'sec_HSTS', 'sec_CSP', 'sec_X-Frame-Options', 'sec_X-Content-Type-Options', 'sec_Referrer-Policy']);
  const byKey = new Map();
  for (const p of pagesAudited) {
    const path = _pathOf(p.url);
    for (const f of (p.findings || [])) {
      const ex = byKey.get(f.key);
      if (ex) { if (ex.pages) ex.pages.push(path); }
      else byKey.set(f.key, { axis: f.axis, sev: f.sev, key: f.key, title: f.title, detail: f.detail, pages: SITE_LEVEL.has(f.key) ? null : [path] });
    }
  }
  const findings = [...byKey.values()].map((f) => { if (f.pages) f.pages = [...new Set(f.pages)]; return f; });
  const pages = pagesAudited.map((p) => ({ path: _pathOf(p.url), score: _globalScore({ ...p.scores }) }));
  return { reachable: home.reachable, scores, findings, pages, pageCount: pagesAudited.length };
}

// Disponibilité (axe S1) — % de relevés OK sur 24 h.
async function _uptime24(env, siteId) {
  const up = await env.DB.prepare("SELECT AVG(ok) AS rate, COUNT(*) AS n FROM sentinel_checks WHERE site_id = ? AND checked_at >= datetime('now','-1 day')").bind(siteId).first();
  return (up && up.n) ? Math.round((up.rate || 0) * 100) : null;
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
function _fixFor(key, ctx) {
  const url = ctx.url || '';
  let origin = url; try { origin = new URL(url).origin; } catch (_) {}
  const head = _headSteps(ctx.platform);
  // Site Wix → privilégier le correctif natif Wix (sinon repli sur le générique).
  if (ctx.platform === 'wix') { const wf = _wixFix(key, ctx); if (wf) return wf; }
  switch (key) {
    case 'wix_subdomain': return { steps: [
      'Votre site est publié sur une adresse Wix gratuite (terminant par .wixsite.com) : Google la classe moins bien et elle inspire moins confiance.',
      'Tableau de bord Wix › Réglages › « Domaines » › « Connecter un domaine » : reliez un nom de domaine à votre marque (ex. votre-entreprise.fr).',
      'Un domaine personnalisé améliore le référencement, la crédibilité et le rendu lors des partages.'] };
    case 'jsonld': case 'nap_localbiz': case 'nap_address': case 'nap_phone': case 'nap_hours':
      return { steps: head, codeLabel: 'Fiche établissement (LocalBusiness — nom, adresse, téléphone, horaires)', code:
`<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Nom de votre établissement",
  "url": "${origin}",
  "telephone": "+33 1 23 45 67 89",
  "address": { "@type": "PostalAddress", "streetAddress": "12 rue Exemple", "addressLocality": "Ville", "postalCode": "00000", "addressCountry": "FR" },
  "openingHours": "Mo-Fr 09:00-18:00",
  "priceRange": "€€"
}
</script>` };
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
function _attachFixes(findings, ctx) { for (const f of findings) { try { f.fix = _fixFor(f.key, ctx); } catch (_) { f.fix = null; } } return findings; }

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
  const axisLabel = { disponibilite: 'Disponibilité', performance: 'Performance', seo: 'SEO technique', securite: 'Sécurité', accessibilite: 'Accessibilité', presence: 'Présence locale', geo: 'Visibilité IA (GEO)' };
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
            last_score, last_scores, last_audit_at, created_at
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
  const emailEnabled = !!(env && (env.KS_RESEND_KEY || env.RESEND_API_KEY));
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
function _threshScore(v, good, poor) {
  if (v == null) return null;
  if (v <= good) return 100;
  if (v >= poor) return 0;
  return Math.round(100 * (poor - v) / (poor - good));
}
function _perfScore(cwv) {
  if (!cwv) return null;
  const parts = [
    [_threshScore(cwv.lcp, 2500, 4000), 0.5],
    [_threshScore(cwv.cls, 0.1, 0.25), 0.3],
    [_threshScore(cwv.fcp, 1800, 3000), 0.2],
  ].filter((p) => p[0] != null);
  if (!parts.length) return null;
  const wsum = parts.reduce((a, p) => a + p[1], 0);
  return Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / wsum);
}
async function _measurePerf(env, url) {
  if (!env || !env.BROWSER) return null;
  let browser = null;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    try { await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }); } catch (_) {}
    await page.evaluateOnNewDocument(() => {
      window.__cwv = { lcp: 0, cls: 0 };
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cwv.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!e.hadRecentInput) window.__cwv.cls += e.value; } }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
    });
    await page.goto(url, { waitUntil: 'load', timeout: 25000 });
    await new Promise((r) => setTimeout(r, 2500));   // laisse LCP/CLS se stabiliser
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
    return m;
  } catch (_) {
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }
}

// Calcule le score global à partir des axes disponibles (audit + dispo S1).
function _globalScore(scores) {
  const vals = Object.values(scores).filter(v => typeof v === 'number');
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export async function handleSiteAudit(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await _gate(request, env, origin);
  if (g.error) return g.error;
  const site = await env.DB.prepare("SELECT id, url, label, platform FROM sentinel_sites WHERE id = ? AND tenant_id = ?").bind(id, g.tenant).first();
  if (!site) return err('Site introuvable.', 404, origin);

  const a = await _auditSite(site.url);   // V2 — crawl : home + pages internes, agrégé
  const dispo = await _uptime24(env, site.id);
  const cwv = await _measurePerf(env, site.url);   // perf (CWV) = home seule (coût borné)
  const perf = _perfScore(cwv);
  const scores = { disponibilite: dispo, performance: perf, ...a.scores };   // null = axe « n/a »
  const findings = a.findings.slice();
  if (cwv) {
    if (cwv.lcp >= 4000) findings.push({ axis: 'performance', sev: 'high', key: 'perf_lcp', title: `Chargement lent (LCP ${(cwv.lcp / 1000).toFixed(1)} s)`, detail: 'Cible : moins de 2,5 s — compressez images et scripts.' });
    else if (cwv.lcp >= 2500) findings.push({ axis: 'performance', sev: 'medium', key: 'perf_lcp', title: `Chargement à améliorer (LCP ${(cwv.lcp / 1000).toFixed(1)} s)`, detail: 'Cible : moins de 2,5 s.' });
    if (cwv.cls >= 0.25) findings.push({ axis: 'performance', sev: 'medium', key: 'perf_cls', title: `La page saute au chargement (CLS ${cwv.cls})`, detail: 'Réservez les dimensions des images, bannières et publicités.' });
    if (cwv.weightKb >= 3072) findings.push({ axis: 'performance', sev: 'low', key: 'perf_weight', title: `Page lourde (${(cwv.weightKb / 1024).toFixed(1)} Mo)`, detail: 'Allégez images et scripts pour accélérer le mobile.' });
  }
  _attachFixes(findings, { url: site.url, host: _hostOf(site.url), platform: site.platform });
  const global = _globalScore(scores);
  const scoresJson = JSON.stringify(scores);
  const findingsJson = JSON.stringify(findings);
  const pagesJson = JSON.stringify(a.pages || []);

  await env.DB.prepare("INSERT INTO sentinel_audits (id, tenant_id, site_id, score, scores, findings, cwv, pages) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(generateId(), g.tenant, site.id, global, scoresJson, findingsJson, cwv ? JSON.stringify(cwv) : null, pagesJson).run();
  await env.DB.prepare("UPDATE sentinel_sites SET last_score = ?, last_scores = ?, last_audit_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ?")
    .bind(global, scoresJson, site.id, g.tenant).run();

  return json({ audit: { score: global, scores, findings, cwv, pages: a.pages, reachable: a.reachable } }, 200, origin);
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

  // Disponibilité 30 j + tendance (7 j vs 7 j précédents)
  const up30 = await env.DB.prepare("SELECT AVG(ok) rate, COUNT(*) n FROM sentinel_checks WHERE site_id = ? AND checked_at >= datetime('now','-30 day')").bind(id).first();
  const uptime30d = (up30 && up30.n) ? Math.round((up30.rate || 0) * 1000) / 10 : null;
  const up7 = await env.DB.prepare("SELECT AVG(ok) rate FROM sentinel_checks WHERE site_id = ? AND checked_at >= datetime('now','-7 day')").bind(id).first();
  const upPrev7 = await env.DB.prepare("SELECT AVG(ok) rate FROM sentinel_checks WHERE site_id = ? AND checked_at < datetime('now','-7 day') AND checked_at >= datetime('now','-14 day')").bind(id).first();
  let uptimeTrend = 'stable';
  if (up7 && upPrev7 && up7.rate != null && upPrev7.rate != null) {
    const d = up7.rate - upPrev7.rate;
    uptimeTrend = d > 0.005 ? 'up' : (d < -0.005 ? 'down' : 'stable');
  }

  // Série 30 j (moyenne par jour) pour la courbe de temps de réponse.
  const seriesRows = (await env.DB.prepare("SELECT substr(checked_at,1,10) d, AVG(ms) ms, AVG(ok) up FROM sentinel_checks WHERE site_id = ? AND checked_at >= datetime('now','-30 day') GROUP BY d ORDER BY d").bind(id).all()).results || [];
  const series30d = seriesRows.map((r) => ({ d: r.d, ms: Math.round(r.ms || 0), up: r.up }));

  // Dernier audit + historique + tendance de score (vs ~7 j).
  const auditRow = await env.DB.prepare("SELECT score, scores, findings, cwv, pages, created_at FROM sentinel_audits WHERE site_id = ? ORDER BY created_at DESC LIMIT 1").bind(id).first();
  let audit = null;
  if (auditRow) { let sc = null, fd = [], cw = null, pg = null; try { sc = JSON.parse(auditRow.scores); } catch (_) {} try { fd = JSON.parse(auditRow.findings); } catch (_) {} try { cw = auditRow.cwv ? JSON.parse(auditRow.cwv) : null; } catch (_) {} try { pg = auditRow.pages ? JSON.parse(auditRow.pages) : null; } catch (_) {} audit = { score: auditRow.score, scores: sc, findings: fd, cwv: cw, pages: pg, created_at: auditRow.created_at }; }
  const histRows = (await env.DB.prepare("SELECT created_at, score, scores FROM sentinel_audits WHERE site_id = ? ORDER BY created_at DESC LIMIT 20").bind(id).all()).results || [];
  const scoreHistory = histRows.reverse().map((r) => { let sc = null; try { sc = r.scores ? JSON.parse(r.scores) : null; } catch (_) {} return { at: r.created_at, score: r.score, scores: sc }; });
  let scoreTrend = null;
  if (audit && audit.score != null) {
    const prev = await env.DB.prepare("SELECT score FROM sentinel_audits WHERE site_id = ? AND created_at <= datetime('now','-7 day') ORDER BY created_at DESC LIMIT 1").bind(id).first();
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
    let prompts = [], results = null; try { prompts = JSON.parse(geoRow.prompts || '[]'); } catch (_) {} try { results = geoRow.last_results ? JSON.parse(geoRow.last_results) : null; } catch (_) {}
    geo = { enabled: _geoEnabled(env), configured: true, business_name: geoRow.business_name || (site.label || _hostOf(site.url)), city: geoRow.city || '', activity: geoRow.activity || '', prompts: prompts.length ? prompts : _defaultGeoPrompts(geoRow.activity || '', geoRow.city || ''), score: geoRow.last_score, results, run_at: geoRow.last_run_at };
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
    uptime30d, uptimeTrend, series30d, audit, scoreHistory, scoreTrend, ssl, geo, gsc,
    email_enabled: !!(env && (env.KS_RESEND_KEY || env.RESEND_API_KEY)),
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
      return json({ error: `Crédits IA épuisés ce mois sur le plan ${g.plan}. Ajoutez un pack ou attendez le 1er du mois.`, code: 'AI_CREDITS_EXHAUSTED' }, 429, origin);
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
// Envoi via Resend. Réutilise la clé Resend EXISTANTE de Keystone (KS_RESEND_KEY,
// domaine déjà vérifié — sert aux e-mails de licence) ; repli sur RESEND_API_KEY
// dédié si un jour posé. `from` = chaîne prête (« Nom <email> »). Ne lève jamais.
async function _sendViaResend(env, { from, to, subject, html, text, replyTo }) {
  const key = env.KS_RESEND_KEY || env.RESEND_API_KEY;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const payload = { from, to: [to], subject, html, text };
    if (replyTo) payload.reply_to = replyTo;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctrl.signal,
    });
    let data = {}; try { data = await res.json(); } catch (_) {}
    if (!res.ok) return { ok: false, status: res.status, msg: String((data && (data.message || data.name)) || `HTTP ${res.status}`) };
    return { ok: true, status: res.status, id: data && data.id };
  } catch (e) {
    return { ok: false, status: 0, msg: (e && e.name === 'AbortError') ? 'délai dépassé' : ((e && e.message) || 'réseau') };
  } finally { clearTimeout(timer); }
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
  if (!(env.KS_RESEND_KEY || env.RESEND_API_KEY)) {
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

  await env.DB.prepare("UPDATE sentinel_geo SET last_score = ?, last_results = ?, last_run_at = datetime('now'), next_geo_at = datetime('now', '+7 days'), updated_at = datetime('now') WHERE site_id = ? AND tenant_id = ?")
    .bind(score, JSON.stringify(results), id, tenant).run();

  return { score, results, engines: engines.map((e) => e.engine) };
}

async function _geoConfigRow(env, id, tenant) {
  return env.DB.prepare("SELECT business_name, city, activity, prompts, last_score, last_results, last_run_at FROM sentinel_geo WHERE site_id = ? AND tenant_id = ?").bind(id, tenant).first();
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
  if (out.blocked) return json({ error: `Crédits IA épuisés ce mois sur le plan ${g.plan}. Ajoutez un pack ou attendez le 1er du mois.`, code: 'AI_CREDITS_EXHAUSTED' }, 429, origin);
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
    if (!property) return _gscHtml(`❌ Aucune propriété Search Console ne correspond à ${_escHtml(site.url)}. Vérifie que ce site est validé dans ta Search Console, avec le même compte Google.`);
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
      // échec / bloqué → repousser d'1 j (évite de reboucler quotidiennement sur une clé KO).
      await env.DB.prepare("UPDATE sentinel_geo SET next_geo_at = datetime('now','+1 day') WHERE site_id = ? AND tenant_id = ?").bind(d.id, d.tenant).run().catch(() => {});
    } catch (_) { failed++; }
  }
  return { due: due.length, ran, failed };
}
