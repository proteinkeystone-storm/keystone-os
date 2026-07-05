/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Key Brand (Pad O-BRD-001) · KB-0 (socle)

   La charte graphique vivante : un mini-site interactif par marque,
   multi-chartes, ZÉRO IA (aucun env.AI, aucun consumeCredits — le
   worker ne fait que stocker et servir). Cadrage : KEY_BRAND_BRIEF.md.

   GET    /api/keybrand/health                 Public — santé du moteur
   GET    /api/keybrand/charts                 Bibliothèque du tenant
   POST   /api/keybrand/charts                 Créer (cap 30/tenant → 409)
   GET    /api/keybrand/charts/:id             Une charte + son brand-kit (draft)
   PUT    /api/keybrand/charts/:id             Autosave { name?, draft? }
   POST   /api/keybrand/charts/:id/duplicate   Dupliquer (cap 30 → 409)
   DELETE /api/keybrand/charts/:id             Supprimer (versions + assets en cascade)

   Auth : JWT obligatoire (sauf health). Tenant = identité authentifiée
   (claims.sub), JAMAIS un paramètre client — patron _tenantOf de
   keynapse.js. Schéma auto-appliqué au 1er appel.

   ISOLATION : tables kb_, routes /api/keybrand/. La page publique
   /b/:slug (KB-6) ne servira QUE published_json (jamais le draft).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, generateId, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

const KB_ENGINE_VERSION = 'KB-6';

const KB_MAX_CHARTS   = 30;        // plafond tranché (2026-07-03) — tous plans
const KB_MAX_NAME     = 80;
const KB_MAX_DRAFT    = 200_000;   // brand-kit JSON stringifié (garde-fou large ; les fichiers vivent dans R2, pas ici)

// ── Schéma auto-appliqué (idempotent, une fois par isolate) ─────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS kb_charts (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       slug TEXT NOT NULL,
       name TEXT NOT NULL DEFAULT 'Nouvelle marque',
       status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
       access TEXT NOT NULL DEFAULT 'unlisted' CHECK (access IN ('unlisted','code','public')),
       access_code_hash TEXT,
       draft_json TEXT NOT NULL DEFAULT '{}',
       published_json TEXT,
       version INTEGER NOT NULL DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_kb_charts_tenant ON kb_charts(tenant_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_charts_slug ON kb_charts(slug)`,
    // Versions publiées (changelog public, KB-6). snapshot_json = kit figé.
    `CREATE TABLE IF NOT EXISTS kb_versions (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       chart_id TEXT NOT NULL, version INTEGER NOT NULL,
       note TEXT, snapshot_json TEXT NOT NULL,
       published_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_kb_versions_chart ON kb_versions(tenant_id, chart_id)`,
    // Fichiers R2 (logos, exemples photo — KB-1+). Créée dès KB-0 pour que
    // la cascade de suppression soit correcte quel que soit l'ordre des deploys.
    `CREATE TABLE IF NOT EXISTS kb_assets (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       chart_id TEXT NOT NULL, r2_key TEXT NOT NULL,
       kind TEXT NOT NULL DEFAULT 'logo' CHECK (kind IN ('logo','image')),
       mime TEXT, size INTEGER NOT NULL DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_kb_assets_chart ON kb_assets(tenant_id, chart_id)`,
  ];
  for (const sql of stmts) { await env.DB.prepare(sql).run(); }
  // KB-1 — nom de fichier d'origine (téléchargements + kit .zip), ajouté a
  // posteriori. SQLite n'a pas ADD COLUMN IF NOT EXISTS → ALTER tolérant.
  try { await env.DB.prepare('ALTER TABLE kb_assets ADD COLUMN name TEXT').run(); } catch (_) { /* déjà présent */ }
  _schemaReady = true;
}

// ── Auth / tenant (patron keynapse.js / smart-agent.js) ─────────
function _tenantOf(request, env, claims) {
  if (requireAdmin(request, env)) return 'default';
  if (!claims) return null;
  if (claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN') return 'default';
  return claims.sub || null;
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
  return { claims, tenant };
}

// ── Helpers ─────────────────────────────────────────────────────
// Slug public non devinable (accès « lien non répertorié » = sécurité par URL).
// 14 caractères a-z/0-9 ≈ 72 bits d'entropie. Jamais réutilisé après suppression.
function _newSlug() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(14);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += abc[b % 36];
  return s;
}

function _cleanName(v) {
  const s = String(v ?? '').trim().slice(0, KB_MAX_NAME);
  return s || 'Nouvelle marque';
}

// Garde-fou du brand-kit (KB-0 : structure libre mais bornée — la validation
// fine de chaque section arrive avec son sprint). Le kit reste un objet JSON
// plafonné ; on force meta.name en cohérence avec la colonne name.
function _cleanKit(draft, name) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  const kit = draft;
  kit.meta = (kit.meta && typeof kit.meta === 'object' && !Array.isArray(kit.meta)) ? kit.meta : {};
  kit.meta.name = _cleanName(name || kit.meta.name);
  const s = JSON.stringify(kit);
  if (s.length > KB_MAX_DRAFT) return null;
  return s;
}

function _primaryHexOf(draftJson) {
  try {
    const kit = JSON.parse(draftJson || '{}');
    const pal = kit?.colors?.palette;
    if (!Array.isArray(pal) || !pal.length) return null;
    const prim = pal.find(c => c && c.role === 'primary') || pal[0];
    const hex = prim && typeof prim.hex === 'string' ? prim.hex : null;
    return hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null;
  } catch (_) { return null; }
}

const CHART_COLS = 'id, slug, name, status, access, version, created_at, updated_at';

async function _countCharts(env, tenant) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM kb_charts WHERE tenant_id = ?').bind(tenant).first();
  return (r && r.n) || 0;
}
async function _findChart(env, tenant, id) {
  return env.DB
    .prepare(`SELECT ${CHART_COLS}, draft_json, published_json FROM kb_charts WHERE id = ? AND tenant_id = ?`)
    .bind(id, tenant).first();
}
function _chartOut(row) {
  let draft = null;
  try { draft = JSON.parse(row.draft_json || '{}'); } catch (_) { draft = {}; }
  // dirty = le brouillon diffère de la dernière version publiée → il y a des
  // modifications non publiées (la page /b/ ne les montre pas encore).
  const dirty = row.status === 'published'
    ? (typeof row.published_json === 'string' ? row.published_json !== row.draft_json : true)
    : false;
  return {
    id: row.id, slug: row.slug, name: row.name, status: row.status,
    access: row.access, version: row.version,
    created_at: row.created_at, updated_at: row.updated_at,
    dirty, draft,
  };
}

// ── Health (public) ─────────────────────────────────────────────
export async function handleKeyBrandHealth(request, env) {
  const origin = getAllowedOrigin(env, request);
  let schema = 'ready';
  try { await _ensureSchema(env); } catch (_) { schema = 'error'; }
  return json({ ok: true, engine: KB_ENGINE_VERSION, schema }, 200, origin);
}

// ── Bibliothèque ────────────────────────────────────────────────
export async function handleKeyBrandList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  try {
    const rs = await env.DB
      .prepare(`SELECT ${CHART_COLS}, draft_json FROM kb_charts WHERE tenant_id = ? ORDER BY updated_at DESC`)
      .bind(gate.tenant).all();
    const items = (rs.results || []).map(r => ({
      id: r.id, slug: r.slug, name: r.name, status: r.status,
      version: r.version, updated_at: r.updated_at,
      primary_hex: _primaryHexOf(r.draft_json),
    }));
    return json({ items, max: KB_MAX_CHARTS }, 200, origin);
  } catch (e) { return err('Lecture impossible', 500, origin); }
}

export async function handleKeyBrandCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const body = await parseBody(request) || {};
  try {
    if (await _countCharts(env, gate.tenant) >= KB_MAX_CHARTS) {
      return err(`Limite atteinte : ${KB_MAX_CHARTS} chartes par compte`, 409, origin);
    }
    const id = generateId();
    const name = _cleanName(body.name);
    const kitJson = _cleanKit(body.draft || { meta: { name } }, name)
      || JSON.stringify({ meta: { name } });
    await env.DB
      .prepare(`INSERT INTO kb_charts (id, tenant_id, slug, name, draft_json) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, gate.tenant, _newSlug(), name, kitJson)
      .run();
    const row = await _findChart(env, gate.tenant, id);
    return json({ chart: _chartOut(row) }, 201, origin);
  } catch (e) { return err('Création impossible', 500, origin); }
}

// ── Une charte ──────────────────────────────────────────────────
export async function handleKeyBrandGet(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  try {
    const row = await _findChart(env, gate.tenant, id);
    if (!row) return err('Charte introuvable', 404, origin);
    return json({ chart: _chartOut(row) }, 200, origin);
  } catch (e) { return err('Lecture impossible', 500, origin); }
}

export async function handleKeyBrandUpdate(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const body = await parseBody(request);
  if (!body) return err('Corps JSON attendu', 400, origin);
  try {
    const row = await _findChart(env, gate.tenant, id);
    if (!row) return err('Charte introuvable', 404, origin);

    const name = body.name !== undefined ? _cleanName(body.name) : row.name;
    let kitJson = row.draft_json;
    if (body.draft !== undefined) {
      kitJson = _cleanKit(body.draft, name);
      if (kitJson === null) return err('Brand-kit invalide ou trop volumineux', 400, origin);
    } else if (body.name !== undefined) {
      // Renommage seul : garder meta.name aligné sur la colonne.
      kitJson = _cleanKit(JSON.parse(row.draft_json || '{}'), name) || row.draft_json;
    }
    await env.DB
      .prepare(`UPDATE kb_charts SET name = ?, draft_json = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`)
      .bind(name, kitJson, id, gate.tenant)
      .run();
    return json({ ok: true }, 200, origin);
  } catch (e) { return err('Enregistrement impossible', 500, origin); }
}

export async function handleKeyBrandDuplicate(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  try {
    const row = await _findChart(env, gate.tenant, id);
    if (!row) return err('Charte introuvable', 404, origin);
    if (await _countCharts(env, gate.tenant) >= KB_MAX_CHARTS) {
      return err(`Limite atteinte : ${KB_MAX_CHARTS} chartes par compte`, 409, origin);
    }
    const newId = generateId();
    const name = _cleanName(`${row.name} (copie)`);
    const kitJson = _cleanKit(JSON.parse(row.draft_json || '{}'), name) || JSON.stringify({ meta: { name } });
    // La copie repart en brouillon : ni version publiée, ni code d'accès.
    await env.DB
      .prepare(`INSERT INTO kb_charts (id, tenant_id, slug, name, draft_json) VALUES (?, ?, ?, ?, ?)`)
      .bind(newId, gate.tenant, _newSlug(), name, kitJson)
      .run();
    const created = await _findChart(env, gate.tenant, newId);
    return json({ chart: _chartOut(created) }, 201, origin);
  } catch (e) { return err('Duplication impossible', 500, origin); }
}

// ════════════════════════════════════════════════════════════════
// KB-1 — Fichiers (logos, exemples photo) : R2 HELP_MEDIA, clés
// kb/<tenant>/<chartId>/<assetId>.<ext> (UUID + extension whitelistée
// → anti-traversal par construction). Servi au PROPRIÉTAIRE uniquement
// (blob authentifié) ; l'accès public arrive avec la page /b/ (KB-6).
// ════════════════════════════════════════════════════════════════
const KB_ASSET_MAX_BYTES  = 4 * 1024 * 1024;      // 4 Mo / fichier
const KB_MAX_FILES_CHART  = 40;                    // fichiers / charte
const KB_MAX_TENANT_BYTES = 200 * 1024 * 1024;     // 200 Mo / compte
const KB_ASSET_KINDS = ['logo', 'image'];
// content-type → extension (les deux whitelistés ensemble).
const KB_MIME_EXT = {
  'image/svg+xml':   'svg',
  'image/png':       'png',
  'image/jpeg':      'jpg',
  'image/webp':      'webp',
  'application/pdf': 'pdf',
  // KB-8 — fond vidéo de la scène d'ouverture (boucle courte ≤ 4 Mo).
  // Stockée kind='image' (le CHECK D1 ne connaît que logo|image ; le mime fait foi).
  'video/mp4':       'mp4',
  'video/webm':      'webm',
};

// Sanitizer SVG serveur — un SVG utilisateur est du code exécutable en
// puissance. Politique : REJET (pas de nettoyage silencieux) si le fichier
// contient un vecteur d'exécution ou une référence externe.
const KB_SVG_DANGERS = [
  /<\s*script/i,                       // scripts inline
  /\son[a-z]+\s*=/i,                   // attributs onload/onclick/…
  /javascript\s*:/i,                   // URI js
  /<\s*(foreignObject|iframe|embed|object)/i,
  /href\s*=\s*["']\s*(?:https?:)?\/\//i, // use/image externes (data: et #id restent permis)
];
function _svgIsSafe(text) {
  if (!text || text.length > KB_ASSET_MAX_BYTES) return false;
  return !KB_SVG_DANGERS.some(rx => rx.test(text));
}

function _cleanFilename(v, ext) {
  const base = String(v || 'fichier').split(/[/\\]/).pop()
    .replace(/\.[A-Za-z0-9]+$/, '')          // extension retirée (on impose la nôtre)
    .replace(/[^\wÀ-ſ .-]+/g, '')  // caractères sûrs (accents permis)
    .trim().slice(0, 80) || 'fichier';
  return `${base}.${ext}`;
}

// POST /charts/:id/assets?kind=logo|image&name=<nom>  (corps = octets)
export async function handleKeyBrandAssetUpload(request, env, chartId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  if (!env.HELP_MEDIA) return err('Stockage fichiers indisponible', 500, origin);

  const chart = await _findChart(env, t, chartId);
  if (!chart) return err('Charte introuvable', 404, origin);

  const q = new URL(request.url).searchParams;
  const kind = String(q.get('kind') || 'logo');
  if (!KB_ASSET_KINDS.includes(kind)) return err('Type de fichier invalide', 400, origin);

  const ct = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = KB_MIME_EXT[ct];
  if (!ext) return err('Format non pris en charge (SVG, PNG, JPG, WebP, PDF, MP4 ou WebM)', 415, origin);

  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0) return err('Fichier vide', 400, origin);
  if (buf.byteLength > KB_ASSET_MAX_BYTES) return err('Fichier trop lourd (max 4 Mo)', 413, origin);

  // Garde-fous volumétrie (plafonds techniques du brief §4).
  const nb = await env.DB.prepare('SELECT COUNT(*) AS n FROM kb_assets WHERE chart_id = ? AND tenant_id = ?').bind(chartId, t).first();
  if ((nb?.n || 0) >= KB_MAX_FILES_CHART) return err(`Limite atteinte : ${KB_MAX_FILES_CHART} fichiers par charte`, 409, origin);
  const vol = await env.DB.prepare('SELECT COALESCE(SUM(size),0) AS s FROM kb_assets WHERE tenant_id = ?').bind(t).first();
  if ((vol?.s || 0) + buf.byteLength > KB_MAX_TENANT_BYTES) return err('Espace de stockage du compte plein (200 Mo)', 409, origin);

  // SVG = texte potentiellement actif → contrôle strict avant stockage.
  if (ext === 'svg') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if (!_svgIsSafe(text)) return err('SVG refusé : il contient du code actif ou des références externes', 400, origin);
  }

  const id = generateId();
  const key = `kb/${t}/${chartId}/${id}.${ext}`;
  const name = _cleanFilename(q.get('name'), ext);
  await env.HELP_MEDIA.put(key, buf, { httpMetadata: { contentType: ct } });
  await env.DB
    .prepare('INSERT INTO kb_assets (id, tenant_id, chart_id, r2_key, kind, mime, size, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, t, chartId, key, kind, ct, buf.byteLength, name)
    .run();
  return json({ ok: true, asset: { id, kind, mime: ct, ext, size: buf.byteLength, name } }, 201, origin);
}

// GET /file/:id[?dl=1] — sert le fichier au propriétaire (blob authentifié).
export async function handleKeyBrandFileServe(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const row = await env.DB.prepare('SELECT r2_key, mime, name FROM kb_assets WHERE id = ? AND tenant_id = ?').bind(id, gate.tenant).first();
  if (!row || !row.r2_key || !env.HELP_MEDIA) return err('Fichier introuvable', 404, origin);
  const obj = await env.HELP_MEDIA.get(row.r2_key);
  if (!obj) return err('Fichier introuvable', 404, origin);
  const dl = new URL(request.url).searchParams.get('dl') === '1';
  const headers = {
    'Content-Type': obj.httpMetadata?.contentType || row.mime || 'application/octet-stream',
    'Cache-Control': 'private, max-age=3600',
    'Access-Control-Allow-Origin': origin,
  };
  if (dl) headers['Content-Disposition'] = `attachment; filename="${(row.name || 'fichier').replace(/"/g, '')}"`;
  return new Response(obj.body, { status: 200, headers });
}

// DELETE /assets/:id — retire l'objet R2 + la ligne. Le retrait de la
// variante dans le brand-kit est fait par le front (son autosave).
export async function handleKeyBrandAssetDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const row = await env.DB.prepare('SELECT r2_key FROM kb_assets WHERE id = ? AND tenant_id = ?').bind(id, gate.tenant).first();
  if (row && row.r2_key && env.HELP_MEDIA) { try { await env.HELP_MEDIA.delete(row.r2_key); } catch (_) {} }
  await env.DB.prepare('DELETE FROM kb_assets WHERE id = ? AND tenant_id = ?').bind(id, gate.tenant).run();
  return json({ ok: true, deleted: id }, 200, origin);
}

// ════════════════════════════════════════════════════════════════
// KB-6 — Publication & accès public
//
// Brouillon ≠ publié : « Publier » fige draft_json → published_json
// (version++, note de changelog dans kb_versions). La page /b/:slug ne
// sert JAMAIS le brouillon. Accès : unlisted (défaut, lien non devinable)
// | code (hash SHA-256 salé par le slug) | public. Un fichier n'est servi
// en anonyme QUE s'il est référencé dans le snapshot publié.
// ════════════════════════════════════════════════════════════════
const KB_NOTE_MAX = 300;
const KB_CODE_MIN = 4, KB_CODE_MAX = 60;

async function _hashAccessCode(slug, code) {
  const data = new TextEncoder().encode(`kb:${slug}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// POST /charts/:id/publish  { note? }
export async function handleKeyBrandPublish(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const body = await parseBody(request) || {};
  try {
    const row = await _findChart(env, gate.tenant, id);
    if (!row) return err('Charte introuvable', 404, origin);
    const version = (row.version || 0) + 1;
    const note = String(body.note || '').trim().slice(0, KB_NOTE_MAX);
    await env.DB
      .prepare(`UPDATE kb_charts SET status = 'published', published_json = draft_json,
                version = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`)
      .bind(version, id, gate.tenant)
      .run();
    await env.DB
      .prepare('INSERT INTO kb_versions (id, tenant_id, chart_id, version, note, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(generateId(), gate.tenant, id, version, note || null, row.draft_json)
      .run();
    return json({ ok: true, version, slug: row.slug }, 200, origin);
  } catch (e) { return err('Publication impossible', 500, origin); }
}

// PUT /charts/:id/access  { access: 'unlisted'|'code'|'public', code? }
export async function handleKeyBrandAccess(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const body = await parseBody(request) || {};
  const access = String(body.access || '');
  if (!['unlisted', 'code', 'public'].includes(access)) return err('Accès invalide', 400, origin);
  try {
    const row = await _findChart(env, gate.tenant, id);
    if (!row) return err('Charte introuvable', 404, origin);
    let hash = null;
    if (access === 'code') {
      const code = String(body.code || '').trim();
      if (code.length < KB_CODE_MIN || code.length > KB_CODE_MAX) {
        return err(`Code d'accès : ${KB_CODE_MIN} à ${KB_CODE_MAX} caractères`, 400, origin);
      }
      hash = await _hashAccessCode(row.slug, code);
    }
    await env.DB
      .prepare(`UPDATE kb_charts SET access = ?, access_code_hash = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`)
      .bind(access, hash, id, gate.tenant)
      .run();
    return json({ ok: true, access }, 200, origin);
  } catch (e) { return err('Réglage impossible', 500, origin); }
}

// ── Gate public commun : charte publiée + code éventuel ─────────
async function _publicGate(env, slug, code) {
  const row = await env.DB
    .prepare(`SELECT id, slug, name, status, access, access_code_hash, published_json, version, updated_at
              FROM kb_charts WHERE slug = ?`)
    .bind(String(slug || '')).first();
  if (!row || row.status !== 'published' || !row.published_json) return { status: 404 };
  if (row.access === 'code') {
    if (!code) return { status: 401 };
    const h = await _hashAccessCode(row.slug, String(code));
    if (h !== row.access_code_hash) return { status: 401 };
  }
  return { status: 200, row };
}

// GET /api/keybrand/public/:slug[?code=] — le snapshot publié (anonyme).
export async function handleKeyBrandPublicGet(request, env, slug) {
  const origin = getAllowedOrigin(env, request);
  const code = new URL(request.url).searchParams.get('code');
  try {
    const g = await _publicGate(env, slug, code);
    if (g.status === 404) return err('Charte introuvable', 404, origin);
    if (g.status === 401) return json({ error: 'Code requis', needCode: true }, 401, origin);
    const row = g.row;
    let kit = {};
    try { kit = JSON.parse(row.published_json); } catch (_) {}
    const versions = await env.DB
      .prepare('SELECT version, note, published_at FROM kb_versions WHERE chart_id = ? ORDER BY version DESC LIMIT 10')
      .bind(row.id).all();
    return json({
      name: row.name, version: row.version, updated_at: row.updated_at,
      access: row.access, kit, changelog: versions.results || [],
    }, 200, origin);
  } catch (e) { return err('Lecture impossible', 500, origin); }
}

// GET /api/keybrand/public/:slug/file/:assetId[?code=&dl=1] — fichier du
// snapshot publié UNIQUEMENT (un asset de brouillon ne fuit jamais).
export async function handleKeyBrandPublicFile(request, env, slug, assetId) {
  const origin = getAllowedOrigin(env, request);
  const q = new URL(request.url).searchParams;
  try {
    const g = await _publicGate(env, slug, q.get('code'));
    if (g.status !== 200) return err(g.status === 401 ? 'Code requis' : 'Fichier introuvable', g.status, origin);
    if (!g.row.published_json.includes(assetId)) return err('Fichier introuvable', 404, origin);
    const row = await env.DB
      .prepare('SELECT r2_key, mime, name FROM kb_assets WHERE id = ? AND chart_id = ?')
      .bind(assetId, g.row.id).first();
    if (!row || !row.r2_key || !env.HELP_MEDIA) return err('Fichier introuvable', 404, origin);
    const obj = await env.HELP_MEDIA.get(row.r2_key);
    if (!obj) return err('Fichier introuvable', 404, origin);
    const headers = {
      'Content-Type': obj.httpMetadata?.contentType || row.mime || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': origin,
    };
    if (q.get('dl') === '1') headers['Content-Disposition'] = `attachment; filename="${(row.name || 'fichier').replace(/"/g, '')}"`;
    return new Response(obj.body, { status: 200, headers });
  } catch (e) { return err('Lecture impossible', 500, origin); }
}

export async function handleKeyBrandDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  try {
    const row = await _findChart(env, gate.tenant, id);
    if (!row) return err('Charte introuvable', 404, origin);
    // Cascade : fichiers R2 d'abord (bucket HELP_MEDIA, clés kb/…), puis lignes.
    const assets = await env.DB
      .prepare('SELECT r2_key FROM kb_assets WHERE chart_id = ? AND tenant_id = ?')
      .bind(id, gate.tenant).all();
    for (const a of (assets.results || [])) {
      if (a.r2_key && env.HELP_MEDIA) { try { await env.HELP_MEDIA.delete(a.r2_key); } catch (_) {} }
    }
    await env.DB.prepare('DELETE FROM kb_assets   WHERE chart_id = ? AND tenant_id = ?').bind(id, gate.tenant).run();
    await env.DB.prepare('DELETE FROM kb_versions WHERE chart_id = ? AND tenant_id = ?').bind(id, gate.tenant).run();
    await env.DB.prepare('DELETE FROM kb_charts   WHERE id = ? AND tenant_id = ?').bind(id, gate.tenant).run();
    return json({ ok: true }, 200, origin);
  } catch (e) { return err('Suppression impossible', 500, origin); }
}
