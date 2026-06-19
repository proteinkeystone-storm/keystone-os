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
import { requireJWT } from '../lib/jwt.js';
import { validateImportUrl } from './smart-agent.js';
import { sendPush } from '../lib/webpush.js';
import puppeteer from '@cloudflare/puppeteer';
// S4.1 — clé en main augmenté : génération IA du texte (méta / FAQ AEO),
// métrée comme toutes les surfaces IA (cf MANIFESTE §10).
import { KS_AI_MODEL } from '../lib/ai-model.js';
import { budgetGuard, recordUsage } from '../lib/ai-budget.js';
import { isEnforceEnabled, consumeCredits, refundCredits } from '../lib/ai-credits.js';

const SENTINEL_ENGINE_VERSION = 'S4.1';
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
  ];
  for (const sql of stmts) { await env.DB.prepare(sql).run(); }
  for (const col of [
    "next_check_at TEXT", "last_checked_at TEXT", "last_ok INTEGER",
    "last_status INTEGER", "last_ms INTEGER", "consecutive_fails INTEGER NOT NULL DEFAULT 0",
    "last_score INTEGER", "last_scores TEXT", "last_audit_at TEXT",
  ]) {
    try { await env.DB.prepare(`ALTER TABLE sentinel_sites ADD COLUMN ${col}`).run(); } catch (_) { /* déjà présent */ }
  }
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

async function _audit(url) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  let html = '', headers = null, reachable = false;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    headers = res.headers; reachable = _classify(res.status) === 1;
    html = (await res.text()).slice(0, 500000);
  } catch (_) { /* injoignable → audit minimal */ } finally { clearTimeout(timer); }

  // robots.txt + sitemap (best effort)
  let robots = false, sitemap = false;
  try {
    const origin = new URL(url).origin;
    const rb = await _exists(`${origin}/robots.txt`, true); robots = rb.ok;
    if (rb.text && /sitemap:/i.test(rb.text)) sitemap = true;
    if (!sitemap) { const sm = await _exists(`${origin}/sitemap.xml`, false); sitemap = sm.ok; }
  } catch (_) {}

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
  if (sitemap) seo += 10; else add('seo', 'low', 'sitemap', 'Sitemap introuvable', 'Aide les moteurs à explorer toutes vos pages.');
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

  const scores = { seo, securite, accessibilite };
  return { reachable, scores, findings };
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
function _fixFor(key, ctx) {
  const url = ctx.url || '';
  let origin = url; try { origin = new URL(url).origin; } catch (_) {}
  const head = _headSteps(ctx.platform);
  switch (key) {
    case 'jsonld': return { steps: head, codeLabel: 'Données structurées (à compléter)', code:
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
  const axisLabel = { disponibilite: 'Disponibilité', performance: 'Performance', seo: 'SEO technique', securite: 'Sécurité', accessibilite: 'Accessibilité' };
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
  // email_enabled : le front n'affiche le bouton « Envoyer au webmaster » que si
  // l'envoi est réellement câblé (clé Resend présente) → pas d'UI morte avant l'activation.
  const emailEnabled = !!(env && env.RESEND_API_KEY);
  return json({ sites: rows, count: rows.length, limit: _siteLimit(g.plan), plan: g.plan, email_enabled: emailEnabled }, 200, origin);
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

  const a = await _audit(site.url);
  const dispo = await _uptime24(env, site.id);
  const cwv = await _measurePerf(env, site.url);
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

  await env.DB.prepare("INSERT INTO sentinel_audits (id, tenant_id, site_id, score, scores, findings) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(generateId(), g.tenant, site.id, global, scoresJson, findingsJson).run();
  await env.DB.prepare("UPDATE sentinel_sites SET last_score = ?, last_scores = ?, last_audit_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ?")
    .bind(global, scoresJson, site.id, g.tenant).run();

  return json({ audit: { score: global, scores, findings, cwv, reachable: a.reachable } }, 200, origin);
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
// Envoi via l'API Resend. Retour { ok, status, msg, id }. Ne lève jamais.
async function _sendViaResend(env, { from, fromName, to, subject, html, text, replyTo }) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const payload = { from: fromName ? `${fromName} <${from}>` : from, to: [to], subject, html, text };
    if (replyTo) payload.reply_to = replyTo;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
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

  // Envoi configuré ? (clé Resend présente). Sinon message clair, le PDF reste dispo.
  if (!env.RESEND_API_KEY) {
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
  const from = (env.SENTINEL_FROM_EMAIL && String(env.SENTINEL_FROM_EMAIL)) || 'sentinel@protein-keystone.com';
  const sent = await _sendViaResend(env, { from, fromName: 'Keystone Sentinel', to: email, subject, html, text, replyTo });
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
