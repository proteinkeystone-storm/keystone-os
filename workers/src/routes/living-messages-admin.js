// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Living Layer V2 · CRUD admin Pilotables (2026-05-28)
// ───────────────────────────────────────────────────────────────────
// Routes admin pour gérer les messages "Pilotables" affichés en mode
// 📢 dans l'ordinateur de bord du dashboard.
//
//   GET    /api/admin/living-messages              Liste tous (admin)
//   POST   /api/admin/living-messages              Créer
//   PATCH  /api/admin/living-messages              Modifier (body.id)
//   DELETE /api/admin/living-messages              Supprimer (body.id)
//   POST   /api/admin/living-messages/archive      Archiver (body.id)
//
// Auth : requireAdmin (Bearer KS_ADMIN_SECRET).
// ══════════════════════════════════════════════════════════════════

import { json, err, parseBody, getAllowedOrigin, requireAdmin, generateId } from '../lib/auth.js';

// Auto-migration (idempotent, partagé avec board)
let _schemaReady = false;
async function ensureLivingSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS living_messages (
      id           TEXT PRIMARY KEY,
      text         TEXT NOT NULL,
      priority     INTEGER NOT NULL DEFAULT 50,
      start_at     TEXT NOT NULL,
      end_at       TEXT NOT NULL,
      audience     TEXT NOT NULL DEFAULT 'all',
      status       TEXT NOT NULL DEFAULT 'active',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      created_by   TEXT
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_living_messages_active ON living_messages(status, start_at, end_at, priority DESC)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_living_messages_created ON living_messages(created_at DESC)'
  ).run().catch(() => {});
  _schemaReady = true;
}

const ALLOWED_AUDIENCES = ['all', 'demo', 'starter', 'pro', 'max'];
const ALLOWED_STATUSES  = ['draft', 'active', 'archived'];

// ── GET /api/admin/living-messages ────────────────────────────────
export async function handleLivingListAdmin(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureLivingSchema(env);

  const { results } = await env.DB.prepare(`
    SELECT id, text, priority, start_at, end_at, audience, status,
           created_at, updated_at, created_by
    FROM living_messages
    ORDER BY created_at DESC
    LIMIT 200
  `).all();

  // Calcul du statut effectif (active vs expired vs scheduled)
  const now = new Date().toISOString();
  const messages = (results || []).map(m => {
    let effective = m.status;
    if (m.status === 'active') {
      if (m.end_at < now)        effective = 'expired';
      else if (m.start_at > now) effective = 'scheduled';
    }
    return { ...m, effective_status: effective };
  });

  return json({ messages, total: messages.length }, 200, origin);
}

// ── POST /api/admin/living-messages ───────────────────────────────
// Body : { text, priority?, start_at?, end_at, audience?, status?, created_by? }
export async function handleLivingCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureLivingSchema(env);

  const b = await parseBody(request);
  const text = (b.text || '').toString().trim();
  if (!text)          return err('Champ "text" requis', 400, origin);
  if (text.length > 120) return err('Message trop long (max 120 caractères)', 400, origin);

  const priority = Number.isFinite(+b.priority) ? Math.max(0, Math.min(100, +b.priority)) : 50;
  const audience = ALLOWED_AUDIENCES.includes((b.audience || '').toLowerCase())
    ? b.audience.toLowerCase()
    : 'all';
  const status   = ALLOWED_STATUSES.includes((b.status || '').toLowerCase())
    ? b.status.toLowerCase()
    : 'active';

  // start_at par défaut = maintenant (ISO).
  const startAt = b.start_at || new Date().toISOString();
  // end_at obligatoire.
  if (!b.end_at) return err('Champ "end_at" requis (ISO datetime)', 400, origin);
  const endAt = b.end_at;
  if (endAt <= startAt) return err('"end_at" doit être après "start_at"', 400, origin);

  const id        = generateId();
  const createdBy = (b.created_by || '').toString().slice(0, 100) || null;

  await env.DB.prepare(`
    INSERT INTO living_messages (id, text, priority, start_at, end_at, audience, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, text, priority, startAt, endAt, audience, status, createdBy).run();

  return json({ success: true, id }, 200, origin);
}

// ── PATCH /api/admin/living-messages ──────────────────────────────
export async function handleLivingUpdate(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureLivingSchema(env);

  const b = await parseBody(request);
  if (!b.id) return err('Champ "id" requis', 400, origin);

  const updates = [];
  const values  = [];

  if (b.text !== undefined) {
    const t = (b.text || '').toString().trim();
    if (!t)            return err('Champ "text" invalide', 400, origin);
    if (t.length > 120) return err('Message trop long (max 120 caractères)', 400, origin);
    updates.push('text = ?'); values.push(t);
  }
  if (b.priority !== undefined) {
    const p = Number.isFinite(+b.priority) ? Math.max(0, Math.min(100, +b.priority)) : null;
    if (p == null) return err('"priority" doit être 0-100', 400, origin);
    updates.push('priority = ?'); values.push(p);
  }
  if (b.start_at !== undefined) { updates.push('start_at = ?'); values.push(b.start_at); }
  if (b.end_at   !== undefined) { updates.push('end_at = ?');   values.push(b.end_at);   }
  if (b.audience !== undefined) {
    const aud = (b.audience || '').toLowerCase();
    if (!ALLOWED_AUDIENCES.includes(aud)) return err('"audience" invalide', 400, origin);
    updates.push('audience = ?'); values.push(aud);
  }
  if (b.status !== undefined) {
    const st = (b.status || '').toLowerCase();
    if (!ALLOWED_STATUSES.includes(st)) return err('"status" invalide', 400, origin);
    updates.push('status = ?'); values.push(st);
  }
  updates.push(`updated_at = datetime('now')`);

  if (updates.length === 1) return err('Aucun champ à modifier', 400, origin);

  values.push(b.id);
  const result = await env.DB
    .prepare(`UPDATE living_messages SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  if (!result.meta.changes) return err('Message introuvable', 404, origin);
  return json({ success: true, id: b.id }, 200, origin);
}

// ── DELETE /api/admin/living-messages ─────────────────────────────
export async function handleLivingDelete(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureLivingSchema(env);

  const { id } = await parseBody(request);
  if (!id) return err('Champ "id" requis', 400, origin);

  const result = await env.DB
    .prepare('DELETE FROM living_messages WHERE id = ?')
    .bind(id)
    .run();

  if (!result.meta.changes) return err('Message introuvable', 404, origin);
  return json({ success: true, id, deleted: true }, 200, origin);
}

// ── POST /api/admin/living-messages/archive ───────────────────────
export async function handleLivingArchive(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureLivingSchema(env);

  const { id } = await parseBody(request);
  if (!id) return err('Champ "id" requis', 400, origin);

  const result = await env.DB
    .prepare(`UPDATE living_messages SET status = 'archived', updated_at = datetime('now') WHERE id = ?`)
    .bind(id)
    .run();

  if (!result.meta.changes) return err('Message introuvable', 404, origin);
  return json({ success: true, id, archived: true }, 200, origin);
}
