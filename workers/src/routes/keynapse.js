/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Keynapse (Pad O-Keyn-001) · KN-0 (Sprint 0)

   Espace personnel de connaissances : des bulles de notes sur un
   canevas infini, regroupées en zones colorées, reliées par des traits.

   GET    /api/keynapse/health            Public — santé du moteur
   GET    /api/keynapse/state             La carte du tenant { zones, bubbles, links }
   POST   /api/keynapse/bubbles           Créer une bulle
   PATCH  /api/keynapse/bubbles/:id       Modifier (titre, description, couleur, zone, x, y)
   DELETE /api/keynapse/bubbles/:id       Supprimer (+ todos/rappels/médias/liens liés)

   Auth : JWT obligatoire (sauf health). Tenant = identité authentifiée
   (claims.sub), JAMAIS un paramètre client (patron _tenantOf de
   smart-agent.js). Admin → 'default'. Schéma auto-appliqué au 1er appel
   (pattern ai-credits) ; source de vérité : db/migration_keynapse.sql.

   ISOLATION : aucune table ni route partagée avec Smart Agent ou Key Form.
   Préfixe tables kn_, préfixe routes /api/keynapse/.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, generateId, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

const KN_ENGINE_VERSION = 'KN-2';

const MAX_TITLE_LEN = 200;
const MAX_DESC_LEN  = 4000;
const MAX_BUBBLES   = 2000;   // garde-fou par tenant (pagination plus tard si besoin)

// ── Schéma auto-appliqué (idempotent, une fois par isolate) ─────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS kn_zones (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6366f1',
       created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_kn_zones_tenant ON kn_zones(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS kn_bubbles (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       zone_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
       color TEXT, icon TEXT, x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_kn_bubbles_tenant ON kn_bubbles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_kn_bubbles_zone ON kn_bubbles(tenant_id, zone_id)`,
    `CREATE TABLE IF NOT EXISTS kn_links (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       from_bubble TEXT NOT NULL, to_bubble TEXT NOT NULL,
       created_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_kn_links_tenant ON kn_links(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS kn_todos (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       bubble_id TEXT NOT NULL, label TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
       position INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_kn_todos_bubble ON kn_todos(tenant_id, bubble_id)`,
    `CREATE TABLE IF NOT EXISTS kn_reminders (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       bubble_id TEXT NOT NULL, at TEXT NOT NULL, repeat TEXT, notified_at TEXT,
       created_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_kn_reminders_bubble ON kn_reminders(tenant_id, bubble_id)`,
    `CREATE TABLE IF NOT EXISTS kn_media (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       bubble_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('photo','drawing','audio','note')),
       r2_key TEXT, transcript TEXT, body TEXT, created_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_kn_media_bubble ON kn_media(tenant_id, bubble_id)`,
  ];
  for (const sql of stmts) { await env.DB.prepare(sql).run(); }
  _schemaReady = true;
}

// ── Auth / tenant (patron smart-agent.js) ───────────────────────
function _tenantOf(request, env, claims) {
  if (requireAdmin(request, env)) return 'default';
  if (!claims) return null;
  if (claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN') return 'default';
  return claims.sub || null;
}

// FK tenants(id) : le tenant peut ne pas exister avant sa 1re écriture.
async function _ensureTenant(env, id, plan) {
  if (!id || id === 'default') return;
  try {
    await env.DB
      .prepare("INSERT OR IGNORE INTO tenants (id, name, plan) VALUES (?, ?, ?)")
      .bind(id, 'Client Keystone', plan || 'STARTER')
      .run();
  } catch (_) { /* non bloquant */ }
}

// Gate commun : JWT (ou admin) + schéma + tenant. Pas de restriction de
// plan ici : le gating par licence se fait côté front (pad owned/suggested).
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
function _sanitColor(c) {
  if (typeof c !== 'string') return null;
  const v = c.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}
const BUBBLE_COLS = 'id, zone_id, title, description, color, icon, x, y, created_at, updated_at';

// ── Health (public) ─────────────────────────────────────────────
export async function handleKeynapseHealth(request, env) {
  const origin = getAllowedOrigin(env, request);
  let schema = 'ready';
  try { await _ensureSchema(env); } catch (_) { schema = 'error'; }
  return json({ ok: true, engine: KN_ENGINE_VERSION, schema }, 200, origin);
}

// ── État complet de la carte du tenant ──────────────────────────
export async function handleKeynapseState(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  try {
    const zones   = (await env.DB.prepare('SELECT id, name, color, created_at FROM kn_zones WHERE tenant_id = ? ORDER BY created_at').bind(t).all()).results || [];
    const bubbles = (await env.DB.prepare(`SELECT ${BUBBLE_COLS} FROM kn_bubbles WHERE tenant_id = ? ORDER BY created_at`).bind(t).all()).results || [];
    const links   = (await env.DB.prepare('SELECT id, from_bubble, to_bubble FROM kn_links WHERE tenant_id = ?').bind(t).all()).results || [];
    return json({ ok: true, engine: KN_ENGINE_VERSION, zones, bubbles, links }, 200, origin);
  } catch (e) {
    return err('Lecture impossible : ' + (e && e.message || 'erreur'), 500, origin);
  }
}

// ── Créer une bulle ─────────────────────────────────────────────
export async function handleBubbleCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const body = await parseBody(request);

  const title = String(body.title || '').trim();
  if (!title) return err('Titre requis', 400, origin);
  if (title.length > MAX_TITLE_LEN) return err(`Titre trop long (max ${MAX_TITLE_LEN})`, 400, origin);

  const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM kn_bubbles WHERE tenant_id = ?').bind(t).first())?.n || 0;
  if (count >= MAX_BUBBLES) return err('Limite de bulles atteinte', 403, origin);

  const id = generateId();
  const description = String(body.description || '').slice(0, MAX_DESC_LEN);
  const color   = _sanitColor(body.color);
  const iconKey = body.icon ? String(body.icon).slice(0, 40) : null;
  const zoneId  = body.zone_id ? String(body.zone_id).slice(0, 64) : null;
  const x = Number.isFinite(body.x) ? Number(body.x) : (Math.random() * 360 - 180);
  const y = Number.isFinite(body.y) ? Number(body.y) : (Math.random() * 360 - 180);

  await env.DB.prepare(
    `INSERT INTO kn_bubbles (id, tenant_id, zone_id, title, description, color, icon, x, y)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, t, zoneId, title, description, color, iconKey, x, y).run();

  const bubble = await env.DB.prepare(`SELECT ${BUBBLE_COLS} FROM kn_bubbles WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, bubble }, 200, origin);
}

// ── Modifier une bulle (partiel) ────────────────────────────────
export async function handleBubbleUpdate(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;

  const existing = await env.DB.prepare('SELECT id FROM kn_bubbles WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (!existing) return err('Bulle introuvable', 404, origin);

  const body = await parseBody(request);
  const sets = [], vals = [];
  if (typeof body.title === 'string') {
    const ti = body.title.trim();
    if (!ti) return err('Titre requis', 400, origin);
    if (ti.length > MAX_TITLE_LEN) return err(`Titre trop long (max ${MAX_TITLE_LEN})`, 400, origin);
    sets.push('title = ?'); vals.push(ti);
  }
  if (typeof body.description === 'string') { sets.push('description = ?'); vals.push(body.description.slice(0, MAX_DESC_LEN)); }
  if ('color'   in body) { sets.push('color = ?');   vals.push(_sanitColor(body.color)); }
  if ('icon'    in body) { sets.push('icon = ?');    vals.push(body.icon ? String(body.icon).slice(0, 40) : null); }
  if ('zone_id' in body) { sets.push('zone_id = ?'); vals.push(body.zone_id ? String(body.zone_id).slice(0, 64) : null); }
  if (Number.isFinite(body.x)) { sets.push('x = ?'); vals.push(Number(body.x)); }
  if (Number.isFinite(body.y)) { sets.push('y = ?'); vals.push(Number(body.y)); }
  if (!sets.length) return err('Rien à modifier', 400, origin);

  sets.push("updated_at = datetime('now')");
  vals.push(id, t);
  await env.DB.prepare(`UPDATE kn_bubbles SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();

  const bubble = await env.DB.prepare(`SELECT ${BUBBLE_COLS} FROM kn_bubbles WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, bubble }, 200, origin);
}

// ── Supprimer une bulle (+ cascade applicative) ─────────────────
export async function handleBubbleDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;

  const existing = await env.DB.prepare('SELECT id FROM kn_bubbles WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (!existing) return err('Bulle introuvable', 404, origin);

  // D1 sans ON DELETE CASCADE → nettoyage explicite des dépendances.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM kn_links     WHERE tenant_id = ? AND (from_bubble = ? OR to_bubble = ?)').bind(t, id, id),
    env.DB.prepare('DELETE FROM kn_todos     WHERE tenant_id = ? AND bubble_id = ?').bind(t, id),
    env.DB.prepare('DELETE FROM kn_reminders WHERE tenant_id = ? AND bubble_id = ?').bind(t, id),
    env.DB.prepare('DELETE FROM kn_media     WHERE tenant_id = ? AND bubble_id = ?').bind(t, id),
    env.DB.prepare('DELETE FROM kn_bubbles   WHERE id = ? AND tenant_id = ?').bind(id, t),
  ]);
  return json({ ok: true, deleted: id }, 200, origin);
}

// ════════════════════════════════════════════════════════════════
// Sprint 2 — contenu d'une bulle : détail + to-do + notes libres
// ════════════════════════════════════════════════════════════════
const TODO_COLS = 'id, bubble_id, label, done, position, created_at';
const NOTE_COLS = 'id, bubble_id, body, created_at';

async function _ownsBubble(env, tenant, bubbleId) {
  const r = await env.DB.prepare('SELECT id FROM kn_bubbles WHERE id = ? AND tenant_id = ?').bind(bubbleId, tenant).first();
  return !!r;
}

// GET /bubbles/:id — détail (bulle + tâches + notes)
export async function handleBubbleDetail(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  const bubble = await env.DB.prepare(`SELECT ${BUBBLE_COLS} FROM kn_bubbles WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  if (!bubble) return err('Bulle introuvable', 404, origin);
  const todos = (await env.DB.prepare(`SELECT ${TODO_COLS} FROM kn_todos WHERE tenant_id = ? AND bubble_id = ? ORDER BY position, created_at`).bind(t, id).all()).results || [];
  const notes = (await env.DB.prepare(`SELECT ${NOTE_COLS} FROM kn_media WHERE tenant_id = ? AND bubble_id = ? AND kind = 'note' ORDER BY created_at DESC`).bind(t, id).all()).results || [];
  return json({ ok: true, bubble, todos, notes }, 200, origin);
}

// POST /bubbles/:id/todos — ajouter une tâche
export async function handleTodoCreate(request, env, bubbleId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  if (!(await _ownsBubble(env, t, bubbleId))) return err('Bulle introuvable', 404, origin);
  const body = await parseBody(request);
  const label = String(body.label || '').trim();
  if (!label) return err('Texte de tâche requis', 400, origin);
  if (label.length > 500) return err('Tâche trop longue (max 500)', 400, origin);
  const id = generateId();
  const pos = (await env.DB.prepare('SELECT COALESCE(MAX(position),-1)+1 AS p FROM kn_todos WHERE tenant_id = ? AND bubble_id = ?').bind(t, bubbleId).first())?.p || 0;
  await env.DB.prepare('INSERT INTO kn_todos (id, tenant_id, bubble_id, label, done, position) VALUES (?, ?, ?, ?, 0, ?)').bind(id, t, bubbleId, label, pos).run();
  const todo = await env.DB.prepare(`SELECT ${TODO_COLS} FROM kn_todos WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, todo }, 200, origin);
}

// PATCH /todos/:id — cocher / renommer
export async function handleTodoUpdate(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  const existing = await env.DB.prepare('SELECT id FROM kn_todos WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (!existing) return err('Tâche introuvable', 404, origin);
  const body = await parseBody(request);
  const sets = [], vals = [];
  if ('done' in body) { sets.push('done = ?'); vals.push(body.done ? 1 : 0); }
  if (typeof body.label === 'string') { const l = body.label.trim(); if (!l) return err('Texte requis', 400, origin); sets.push('label = ?'); vals.push(l.slice(0, 500)); }
  if (!sets.length) return err('Rien à modifier', 400, origin);
  vals.push(id, t);
  await env.DB.prepare(`UPDATE kn_todos SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  const todo = await env.DB.prepare(`SELECT ${TODO_COLS} FROM kn_todos WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, todo }, 200, origin);
}

// DELETE /todos/:id
export async function handleTodoDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  await env.DB.prepare('DELETE FROM kn_todos WHERE id = ? AND tenant_id = ?').bind(id, t).run();
  return json({ ok: true, deleted: id }, 200, origin);
}

// POST /bubbles/:id/notes — ajouter une note libre (kn_media kind='note')
export async function handleNoteCreate(request, env, bubbleId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  if (!(await _ownsBubble(env, t, bubbleId))) return err('Bulle introuvable', 404, origin);
  const body = await parseBody(request);
  const text = String(body.body || '').trim();
  if (!text) return err('Note vide', 400, origin);
  if (text.length > 4000) return err('Note trop longue (max 4000)', 400, origin);
  const id = generateId();
  await env.DB.prepare("INSERT INTO kn_media (id, tenant_id, bubble_id, kind, body) VALUES (?, ?, ?, 'note', ?)").bind(id, t, bubbleId, text).run();
  const note = await env.DB.prepare(`SELECT ${NOTE_COLS} FROM kn_media WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, note }, 200, origin);
}

// DELETE /notes/:id
export async function handleNoteDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  await env.DB.prepare("DELETE FROM kn_media WHERE id = ? AND tenant_id = ? AND kind = 'note'").bind(id, t).run();
  return json({ ok: true, deleted: id }, 200, origin);
}
