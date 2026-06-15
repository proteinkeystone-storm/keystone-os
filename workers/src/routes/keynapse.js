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
// Sprint 6 (voix) — mêmes briques IA que Smart Agent : crédit DORMANT par
// licence (flag enforce_ai_credits_v1) + garde-fou budget global + modèle.
import { isEnforceEnabled, consumeCredits, refundCredits } from '../lib/ai-credits.js';
import { budgetGuard } from '../lib/ai-budget.js';
import { KS_AI_MODEL } from '../lib/ai-model.js';

const KN_ENGINE_VERSION = 'KN-7';

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
       bubble_id TEXT NOT NULL, label TEXT, at TEXT NOT NULL, repeat TEXT, notified_at TEXT,
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
  // Sprint 7 — colonne `label` (rappels lisibles), ajoutée a posteriori.
  // SQLite n'a pas ADD COLUMN IF NOT EXISTS → ALTER tolérant (déjà-présent = OK).
  try { await env.DB.prepare('ALTER TABLE kn_reminders ADD COLUMN label TEXT').run(); } catch (_) { /* déjà présent */ }
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

  // Nettoyage R2 des médias de la bulle (avant de purger les fiches).
  if (env.HELP_MEDIA) {
    const mr = (await env.DB.prepare('SELECT r2_key FROM kn_media WHERE tenant_id = ? AND bubble_id = ? AND r2_key IS NOT NULL').bind(t, id).all()).results || [];
    for (const m of mr) { try { await env.HELP_MEDIA.delete(m.r2_key); } catch (_) {} }
  }

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
  const links = (await env.DB.prepare('SELECT id, from_bubble, to_bubble FROM kn_links WHERE tenant_id = ? AND (from_bubble = ? OR to_bubble = ?)').bind(t, id, id).all()).results || [];
  const media = (await env.DB.prepare(`SELECT ${MEDIA_COLS} FROM kn_media WHERE tenant_id = ? AND bubble_id = ? AND kind IN ('photo','drawing') ORDER BY created_at`).bind(t, id).all()).results || [];
  // Sprint 6 — mémos vocaux (kind='audio') : id + transcript pour la fiche.
  const audios = (await env.DB.prepare(`SELECT ${AUDIO_COLS} FROM kn_media WHERE tenant_id = ? AND bubble_id = ? AND kind = 'audio' ORDER BY created_at DESC`).bind(t, id).all()).results || [];
  // Sprint 7 — rappels de la bulle (triés par échéance).
  const reminders = (await env.DB.prepare(`SELECT ${REMINDER_COLS} FROM kn_reminders WHERE tenant_id = ? AND bubble_id = ? ORDER BY at`).bind(t, id).all()).results || [];
  return json({ ok: true, bubble, todos, notes, links, media, audios, reminders }, 200, origin);
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

// ════════════════════════════════════════════════════════════════
// Sprint 3 — zones (dossiers virtuels : cohésion + couleur partagée)
// L'appartenance d'une bulle à une zone passe par PATCH /bubbles/:id
// { zone_id }. Ici : CRUD des zones elles-mêmes.
// ════════════════════════════════════════════════════════════════
const ZONE_COLS = 'id, name, color, created_at, updated_at';

export async function handleZoneCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  const body = await parseBody(request);
  const name = String(body.name || '').trim();
  if (!name) return err('Nom de zone requis', 400, origin);
  if (name.length > 80) return err('Nom trop long (max 80)', 400, origin);
  const color = _sanitColor(body.color) || '#6366f1';
  const id = generateId();
  await env.DB.prepare('INSERT INTO kn_zones (id, tenant_id, name, color) VALUES (?, ?, ?, ?)').bind(id, t, name, color).run();
  const zone = await env.DB.prepare(`SELECT ${ZONE_COLS} FROM kn_zones WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, zone }, 200, origin);
}

export async function handleZoneUpdate(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  const existing = await env.DB.prepare('SELECT id FROM kn_zones WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (!existing) return err('Zone introuvable', 404, origin);
  const body = await parseBody(request);
  const sets = [], vals = [];
  if (typeof body.name === 'string') { const n = body.name.trim(); if (!n) return err('Nom requis', 400, origin); sets.push('name = ?'); vals.push(n.slice(0, 80)); }
  if ('color' in body) { const c = _sanitColor(body.color); if (!c) return err('Couleur invalide', 400, origin); sets.push('color = ?'); vals.push(c); }
  if (!sets.length) return err('Rien à modifier', 400, origin);
  sets.push("updated_at = datetime('now')");
  vals.push(id, t);
  await env.DB.prepare(`UPDATE kn_zones SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  const zone = await env.DB.prepare(`SELECT ${ZONE_COLS} FROM kn_zones WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, zone }, 200, origin);
}

// Supprimer une zone : ses bulles redeviennent libres (zone_id = NULL).
export async function handleZoneDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  await env.DB.batch([
    env.DB.prepare('UPDATE kn_bubbles SET zone_id = NULL WHERE tenant_id = ? AND zone_id = ?').bind(t, id),
    env.DB.prepare('DELETE FROM kn_zones WHERE id = ? AND tenant_id = ?').bind(id, t),
  ]);
  return json({ ok: true, deleted: id }, 200, origin);
}

// ════════════════════════════════════════════════════════════════
// Sprint 4 — liens entre bulles (« Tisser »)
// ════════════════════════════════════════════════════════════════
// POST /bubbles/:id/links { to_bubble } — relier deux bulles (paire
// dédupliquée, sans auto-lien). Idempotent si le lien existe déjà.
export async function handleLinkCreate(request, env, fromId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  if (!(await _ownsBubble(env, t, fromId))) return err('Bulle introuvable', 404, origin);
  const body = await parseBody(request);
  const to = String(body.to_bubble || '').trim();
  if (!to || to === fromId) return err('Bulle cible invalide', 400, origin);
  if (!(await _ownsBubble(env, t, to))) return err('Bulle cible introuvable', 404, origin);
  const existing = await env.DB.prepare(
    'SELECT id, from_bubble, to_bubble FROM kn_links WHERE tenant_id = ? AND ((from_bubble = ? AND to_bubble = ?) OR (from_bubble = ? AND to_bubble = ?))'
  ).bind(t, fromId, to, to, fromId).first();
  if (existing) return json({ ok: true, link: existing, existed: true }, 200, origin);
  const id = generateId();
  await env.DB.prepare('INSERT INTO kn_links (id, tenant_id, from_bubble, to_bubble) VALUES (?, ?, ?, ?)').bind(id, t, fromId, to).run();
  const link = await env.DB.prepare('SELECT id, from_bubble, to_bubble FROM kn_links WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  return json({ ok: true, link }, 200, origin);
}

// DELETE /links/:id
export async function handleLinkDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  await env.DB.prepare('DELETE FROM kn_links WHERE id = ? AND tenant_id = ?').bind(id, t).run();
  return json({ ok: true, deleted: id }, 200, origin);
}

// ════════════════════════════════════════════════════════════════
// Sprint 5 — captures média (photo / dessin) : R2 + service privé
// Stockées dans le bucket HELP_MEDIA, préfixe keynapse/<tenant>/<bubble>/.
// JAMAIS d'URL publique : servies uniquement au propriétaire (gate JWT) — le
// front les récupère en blob authentifié. (kind 'note' reste géré au Sprint 2.)
// ════════════════════════════════════════════════════════════════
const MEDIA_KINDS = ['photo', 'drawing'];
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;     // 8 Mo (redimensionnement côté front)
const MEDIA_COLS = 'id, bubble_id, kind, r2_key, created_at';

// POST /bubbles/:id/media?kind=photo|drawing  (corps = octets de l'image)
export async function handleMediaUpload(request, env, bubbleId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  if (!env.HELP_MEDIA) return err('Stockage média indisponible', 500, origin);
  if (!(await _ownsBubble(env, t, bubbleId))) return err('Bulle introuvable', 404, origin);
  const kind = String(new URL(request.url).searchParams.get('kind') || 'photo');
  if (!MEDIA_KINDS.includes(kind)) return err('Type de média invalide', 400, origin);
  const ct = request.headers.get('content-type') || '';
  if (!/^image\//i.test(ct)) return err('Image attendue', 400, origin);
  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0) return err('Fichier vide', 400, origin);
  if (buf.byteLength > MAX_MEDIA_BYTES) return err('Image trop lourde (max 8 Mo)', 413, origin);
  const id = generateId();
  const key = `keynapse/${t}/${bubbleId}/${id}`;
  await env.HELP_MEDIA.put(key, buf, { httpMetadata: { contentType: ct } });
  await env.DB.prepare('INSERT INTO kn_media (id, tenant_id, bubble_id, kind, r2_key) VALUES (?, ?, ?, ?, ?)').bind(id, t, bubbleId, kind, key).run();
  const media = await env.DB.prepare(`SELECT ${MEDIA_COLS} FROM kn_media WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, media }, 200, origin);
}

// GET /media/:id — sert le média (photo / dessin / audio) au PROPRIÉTAIRE
// uniquement (blob authentifié). Le Content-Type vient des métadonnées R2
// posées à l'upload (audio/webm | audio/mp4 pour les mémos vocaux, Sprint 6).
export async function handleMediaServe(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  const row = await env.DB.prepare("SELECT r2_key FROM kn_media WHERE id = ? AND tenant_id = ? AND kind IN ('photo','drawing','audio')").bind(id, t).first();
  if (!row || !row.r2_key || !env.HELP_MEDIA) return err('Média introuvable', 404, origin);
  const obj = await env.HELP_MEDIA.get(row.r2_key);
  if (!obj) return err('Média introuvable', 404, origin);
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': origin,
    },
  });
}

// DELETE /media/:id — retire la fiche média + l'objet R2.
export async function handleMediaDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  const row = await env.DB.prepare('SELECT r2_key FROM kn_media WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (row && row.r2_key && env.HELP_MEDIA) { try { await env.HELP_MEDIA.delete(row.r2_key); } catch (_) {} }
  await env.DB.prepare('DELETE FROM kn_media WHERE id = ? AND tenant_id = ?').bind(id, t).run();
  return json({ ok: true, deleted: id }, 200, origin);
}

// ════════════════════════════════════════════════════════════════
// Sprint 6 — note vocale : R2 + transcription Whisper + extraction IA
// (tâches/rappels PROPOSÉS, validés par l'utilisateur côté front).
//
// COÛT IA RÉEL → tout appel est MÉTRÉ comme Smart Agent : crédit DORMANT
// (1 par appel, flag enforce_ai_credits_v1 ; sinon legacy/illimité) +
// garde-fou budget global (budgetGuard). Un mémo = jusqu'à 2 crédits
// (transcription + extraction), chacun remboursé si SON appel échoue.
//
// L'audio est TOUJOURS conservé en R2, même si l'IA échoue ou si les
// crédits sont épuisés : on ne perd jamais l'enregistrement.
// ════════════════════════════════════════════════════════════════
// Modèle Whisper « base » multilingue : entrée en TABLEAU D'OCTETS
// (cf. doc Cloudflare : `{ audio: [...new Uint8Array(buf)] }`), sortie
// `res.text`. Le français est pris en charge. NB : whisper-large-v3-turbo
// (meilleur FR via `language:'fr'`) attend du base64, pas des octets → voie
// d'amélioration possible si la qualité FR du modèle base est insuffisante.
const WHISPER_MODEL   = '@cf/openai/whisper';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;     // 10 Mo
const AUDIO_COLS      = 'id, bubble_id, transcript, created_at';
const REMINDER_COLS   = 'id, bubble_id, label, at, repeat, notified_at, created_at';

// ── Crédit DORMANT (patron _aiExtract de smart-agent.js) ─────────
// Consomme 1 crédit 'keynapse' si l'enforcement est actif pour la licence,
// sinon ne fait rien (legacy/illimité ; admin sans claims → ignoré).
// Retour : { blocked, payload } si quota épuisé, sinon { credit, sub }.
async function _knConsumeCredit(env, gate) {
  const sub = gate.claims?.sub;
  try {
    if (sub && await isEnforceEnabled(env, sub)) {
      const credit = await consumeCredits(env, { bucketKey: sub, plan: gate.claims.plan, tool: 'keynapse' });
      if (!credit.ok && credit.blocked) return { blocked: true, payload: credit.payload, sub };
      return { credit, sub };
    }
  } catch (_) { /* compteur indisponible → on ne facture pas, on laisse passer (legacy) */ }
  return { credit: null, sub };
}
async function _knRefundCredit(env, ticket) {
  if (ticket && ticket.credit?.ok && ticket.credit.cost > 0) {
    await refundCredits(env, { bucketKey: ticket.sub, tool: 'keynapse', cost: ticket.credit.cost, packsDrawn: ticket.credit.packsDrawn });
  }
}

// Pur : parse la réponse IA en { tasks:[string], reminders:[{label, at}] }.
// Tolère un bloc ```json et du texte autour. Filtre/borne tout ; ne lève jamais.
function _parseVoicePlan(raw) {
  const empty = { tasks: [], reminders: [] };
  if (!raw || typeof raw !== 'string') return empty;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return empty;
  let obj;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch (_) { return empty; }
  if (!obj || typeof obj !== 'object') return empty;
  const tasks = Array.isArray(obj.tasks)
    ? obj.tasks.map((x) => String(x == null ? '' : x).trim()).filter(Boolean).slice(0, 8).map((l) => l.slice(0, 500))
    : [];
  const reminders = Array.isArray(obj.reminders)
    ? obj.reminders.map((r) => {
        if (!r || typeof r !== 'object') return null;
        const label = String(r.label == null ? '' : r.label).trim().slice(0, 200);
        let at = (typeof r.at === 'string') ? r.at.trim() : '';
        if (at && Number.isNaN(Date.parse(at))) at = '';   // ne garder qu'une date parseable
        if (!label && !at) return null;
        return { label, at };
      }).filter(Boolean).slice(0, 8)
    : [];
  return { tasks, reminders };
}

const VOICE_EXTRACT_PROMPT = `Tu es l'assistant de Keynapse. On te donne la transcription d'un mémo vocal en français. Tu en extrais UNIQUEMENT les tâches à faire et les rappels datés réellement exprimés.

RÈGLES STRICTES :
1. N'invente rien. N'extrais que ce qui est dit. Si le mémo ne contient aucune action ni échéance, renvoie des listes vides.
2. "tasks" : actions à faire, en français, à l'impératif court (max 12 mots). Sans date à l'intérieur.
3. "reminders" : UNIQUEMENT si une échéance (date et/ou heure) est mentionnée. "label" = de quoi il s'agit (court). "at" = date/heure absolue au format ISO 8601 local "AAAA-MM-JJTHH:MM", calculée depuis AUJOURD'HUI ci-dessous pour les expressions relatives ("demain", "lundi", "dans deux heures"). Si l'heure n'est pas précisée, mets 09:00.
4. Une même action ne peut pas être à la fois une tâche et un rappel : si elle a une échéance → rappel ; sinon → tâche.
5. Maximum 8 tâches et 8 rappels. Qualité avant quantité.
6. Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"tasks":["...","..."],"reminders":[{"label":"...","at":"2026-06-17T15:00"}]}`;

// Extraction tâches/rappels depuis le transcript (1 crédit, refund si rien
// d'exploitable ou si l'IA échoue). Best-effort : ne lève jamais, renvoie au
// pire des listes vides (l'audio + le transcript sont déjà rendus au client).
async function _extractVoicePlan(env, gate, transcript) {
  if (!env.AI || typeof env.AI.run !== 'function') return { tasks: [], reminders: [] };
  const ticket = await _knConsumeCredit(env, gate);
  if (ticket.blocked) return { tasks: [], reminders: [] };   // plus de crédits → pas de propositions
  const today = new Date().toISOString().slice(0, 16);
  try {
    const res = await env.AI.run(KS_AI_MODEL, {
      messages: [
        { role: 'system', content: `${VOICE_EXTRACT_PROMPT}\n\nAUJOURD'HUI : ${today}` },
        { role: 'user',   content: `TRANSCRIPTION :\n\n${transcript.slice(0, 6000)}` },
      ],
      max_tokens: 800,
      stream: false,
    });
    const raw = (res?.response ?? res?.choices?.[0]?.message?.content ?? '').trim();
    const plan = _parseVoicePlan(raw);
    if (!plan.tasks.length && !plan.reminders.length) await _knRefundCredit(env, ticket);
    return plan;
  } catch (_) {
    await _knRefundCredit(env, ticket);
    return { tasks: [], reminders: [] };
  }
}

// POST /bubbles/:id/voice — corps = octets audio (audio/webm | audio/mp4).
// Stocke en R2 → transcrit (Whisper) → propose tâches/rappels (Mistral).
// Retourne { media, transcript, proposals:{ tasks, reminders } }.
export async function handleVoiceUpload(request, env, bubbleId) {
  const origin = getAllowedOrigin(env, request);
  const braked = await budgetGuard(env, origin); if (braked) return braked;
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  if (!env.HELP_MEDIA) return err('Stockage média indisponible', 500, origin);
  if (!env.AI || typeof env.AI.run !== 'function') return err('Moteur IA indisponible', 503, origin);
  if (!(await _ownsBubble(env, t, bubbleId))) return err('Bulle introuvable', 404, origin);

  const ct = request.headers.get('content-type') || '';
  if (!/^audio\//i.test(ct)) return err('Audio attendu', 400, origin);
  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0) return err('Enregistrement vide', 400, origin);
  if (buf.byteLength > MAX_AUDIO_BYTES) return err('Enregistrement trop lourd (max 10 Mo)', 413, origin);

  // 1) Stocke l'audio en R2 (conservé quoi qu'il arrive ensuite).
  const id  = generateId();
  const key = `keynapse/${t}/${bubbleId}/${id}`;
  await env.HELP_MEDIA.put(key, buf, { httpMetadata: { contentType: ct } });

  // Renvoie la fiche audio (avec ou sans transcript) + d'éventuelles propositions.
  const _finish = async (transcript, proposals, extra) => {
    await env.DB.prepare(
      "INSERT INTO kn_media (id, tenant_id, bubble_id, kind, r2_key, transcript) VALUES (?, ?, ?, 'audio', ?, ?)"
    ).bind(id, t, bubbleId, key, transcript || null).run();
    const media = await env.DB.prepare(`SELECT ${AUDIO_COLS} FROM kn_media WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
    return json({ ok: true, media, transcript: transcript || '', proposals: proposals || { tasks: [], reminders: [] }, ...(extra || {}) }, 200, origin);
  };

  // 2) Transcription Whisper (1 crédit métré, refund si échec).
  const ticket = await _knConsumeCredit(env, gate);
  if (ticket.blocked) {
    return _finish('', null, { note: 'Crédits IA épuisés — l’audio est conservé, transcription indisponible.', code: 'AI_CREDITS_EXHAUSTED', quota: ticket.payload });
  }
  let transcript = '';
  try {
    const res = await env.AI.run(WHISPER_MODEL, { audio: [...new Uint8Array(buf)] });
    transcript = String(res?.text ?? res?.transcription ?? '').trim();
  } catch (_) {
    await _knRefundCredit(env, ticket);
    return _finish('', null, { note: 'Transcription indisponible pour le moment — l’audio est conservé.' });
  }
  if (!transcript) await _knRefundCredit(env, ticket);   // rien transcrit → on rend le crédit

  // 3) Extraction des actions proposées (best-effort, second crédit).
  let proposals = { tasks: [], reminders: [] };
  if (transcript.length >= 12) {
    proposals = await _extractVoicePlan(env, gate, transcript);
  }
  return _finish(transcript, proposals);
}

// POST /bubbles/:id/reminders — créer un rappel. Corps : { at, label?, repeat? }.
export async function handleReminderCreate(request, env, bubbleId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  if (!(await _ownsBubble(env, t, bubbleId))) return err('Bulle introuvable', 404, origin);
  const body = await parseBody(request);
  const rawAt = String(body.at || '').trim();
  const ms = Date.parse(rawAt);
  if (!rawAt || Number.isNaN(ms)) return err('Date/heure du rappel invalide', 400, origin);
  const at = new Date(ms).toISOString();
  const label = body.label != null ? (String(body.label).trim().slice(0, 200) || null) : null;
  const repeat = _sanitRepeat(body.repeat);
  const id = generateId();
  await env.DB.prepare('INSERT INTO kn_reminders (id, tenant_id, bubble_id, label, at, repeat) VALUES (?, ?, ?, ?, ?, ?)').bind(id, t, bubbleId, label, at, repeat).run();
  const reminder = await env.DB.prepare(`SELECT ${REMINDER_COLS} FROM kn_reminders WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, reminder }, 200, origin);
}

// ════════════════════════════════════════════════════════════════
// Sprint 7 — gestion des rappels + accusé de déclenchement (pour les
// notifications LOCALES côté front : poller → notif → ack). Pas de push
// serveur (futur). repeat ∈ { daily, weekly, monthly } ; ack reprogramme
// la prochaine occurrence (répétitif) ou marque notifié (ponctuel).
// ════════════════════════════════════════════════════════════════
const REPEAT_CYCLES = ['daily', 'weekly', 'monthly'];
function _sanitRepeat(r) {
  const v = String(r == null ? '' : r).trim().toLowerCase();
  return REPEAT_CYCLES.includes(v) ? v : null;
}
// Pur : prochaine occurrence STRICTEMENT après `nowMs` (UTC, comme le stockage).
// Avance par pas tant que l'échéance est passée (garde anti-boucle). null si ponctuel.
function _nextOccurrence(atISO, repeat, nowMs) {
  const cycle = _sanitRepeat(repeat);
  if (!cycle) return null;
  const d = new Date(atISO);
  if (Number.isNaN(d.getTime())) return null;
  let guard = 0;
  while (d.getTime() <= nowMs && guard < 4000) {
    if (cycle === 'daily')   d.setUTCDate(d.getUTCDate() + 1);
    else if (cycle === 'weekly')  d.setUTCDate(d.getUTCDate() + 7);
    else if (cycle === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
    guard++;
  }
  return d.toISOString();
}

// GET /reminders — tous les rappels du tenant (+ titre de la bulle), triés par
// échéance. Source du poller de notifications locales et de la vue « à venir ».
export async function handleRemindersList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  const reminders = (await env.DB.prepare(
    `SELECT r.id, r.bubble_id, r.label, r.at, r.repeat, r.notified_at, b.title AS bubble_title
       FROM kn_reminders r JOIN kn_bubbles b ON b.id = r.bubble_id AND b.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? ORDER BY r.at LIMIT 500`
  ).bind(t).all()).results || [];
  return json({ ok: true, reminders }, 200, origin);
}

// PATCH /reminders/:id — édition utilisateur { at?, label?, repeat? } OU accusé
// de déclenchement { ack:true } (le poller l'appelle après avoir notifié).
export async function handleReminderUpdate(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  const existing = await env.DB.prepare(`SELECT ${REMINDER_COLS} FROM kn_reminders WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  if (!existing) return err('Rappel introuvable', 404, origin);
  const body = await parseBody(request);

  if (body.ack === true) {
    const next = _nextOccurrence(existing.at, existing.repeat, Date.now());
    if (next) {
      await env.DB.prepare('UPDATE kn_reminders SET at = ?, notified_at = NULL WHERE id = ? AND tenant_id = ?').bind(next, id, t).run();
    } else {
      await env.DB.prepare("UPDATE kn_reminders SET notified_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(id, t).run();
    }
    const r = await env.DB.prepare(`SELECT ${REMINDER_COLS} FROM kn_reminders WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
    return json({ ok: true, reminder: r }, 200, origin);
  }

  const sets = [], vals = [];
  if ('at' in body) {
    const ms = Date.parse(String(body.at || '').trim());
    if (Number.isNaN(ms)) return err('Date/heure du rappel invalide', 400, origin);
    sets.push('at = ?'); vals.push(new Date(ms).toISOString());
    sets.push('notified_at = NULL');   // déplacer l'échéance ré-arme le rappel
  }
  if ('label'  in body) { sets.push('label = ?');  vals.push(body.label != null ? (String(body.label).trim().slice(0, 200) || null) : null); }
  if ('repeat' in body) { sets.push('repeat = ?'); vals.push(_sanitRepeat(body.repeat)); }
  if (!sets.length) return err('Rien à modifier', 400, origin);
  vals.push(id, t);
  await env.DB.prepare(`UPDATE kn_reminders SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  const r = await env.DB.prepare(`SELECT ${REMINDER_COLS} FROM kn_reminders WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, reminder: r }, 200, origin);
}

// DELETE /reminders/:id
export async function handleReminderDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const t = gate.tenant;
  await env.DB.prepare('DELETE FROM kn_reminders WHERE id = ? AND tenant_id = ?').bind(id, t).run();
  return json({ ok: true, deleted: id }, 200, origin);
}
