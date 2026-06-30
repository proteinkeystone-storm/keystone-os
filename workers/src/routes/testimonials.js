/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Témoignages / avis clients (réservoir isolé)
   ─────────────────────────────────────────────────────────────
   POST /api/testimonials              public  — dépôt d'un avis (page /avis + in-app)
   GET  /api/testimonials/public       public  — avis PUBLIÉS (pour la landing)
   GET  /api/admin/testimonials        admin   — tous les avis (modération)
   POST /api/admin/testimonials/:id    admin   — { action: publish|reject|delete }

   Conçu ISOLÉ : ne touche NI app_ratings NI le moteur Key Form (prod-critique).
   Rien n'est public tant qu'un admin n'a pas publié un avis dont l'auteur a
   donné son consentement. L'email n'est JAMAIS renvoyé par l'endpoint public.
   Table auto-créée idempotent (même patron que routes/ratings.js).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin, generateId } from '../lib/auth.js';

let _schemaReady = false;
async function ensureSchema(env) {
  if (_schemaReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS testimonials (
        id              TEXT PRIMARY KEY,
        author_name     TEXT,
        author_role     TEXT,
        author_email    TEXT,
        rating          INTEGER,
        body            TEXT NOT NULL,
        source          TEXT NOT NULL DEFAULT 'avis-page',
        consent_publish INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'pending',
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        published_at    TEXT
      )
    `).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_testimonials_status ON testimonials(status, published_at DESC)').run().catch(() => {});
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_testimonials_created ON testimonials(created_at DESC)').run().catch(() => {});
  } catch (_) { /* déjà créée : OK */ }
  _schemaReady = true;
}

const clamp = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsPreflight(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ── POST /api/testimonials ────────────────────────────────────
// Public. Body : { name?, role?, email?, rating?, body|text, consent?, source?, website? }
// `website` = honeypot anti-bot (doit rester vide).
export async function handleTestimonialSubmit(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') return corsPreflight(origin);

  await ensureSchema(env);
  const b = await parseBody(request) || {};

  // Honeypot : un bot remplit souvent tous les champs.
  if (clamp(b.website, 200)) return json({ ok: true }, 200, origin); // on fait semblant

  const body = clamp(b.body ?? b.text, 2000);
  if (body.length < 10) return err('Avis trop court (10 caractères minimum).', 400, origin);

  const name  = clamp(b.author_name ?? b.name, 80);
  const role  = clamp(b.author_role ?? b.role, 80);
  const email = clamp(b.author_email ?? b.email, 160);
  if (email && !EMAIL_RE.test(email)) return err('E-mail invalide.', 400, origin);

  let rating = parseInt(b.rating, 10);
  if (!(rating >= 1 && rating <= 5)) rating = null;

  const consent = (b.consent_publish === true || b.consent === true || b.consent === 1 || b.consent === '1') ? 1 : 0;
  const source  = (clamp(b.source, 24) === 'in-app') ? 'in-app' : 'avis-page';
  const id = generateId();

  await env.DB.prepare(`
    INSERT INTO testimonials (id, author_name, author_role, author_email, rating, body, source, consent_publish, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).bind(id, name || null, role || null, email || null, rating, body, source, consent).run();

  return json({ ok: true, id }, 200, origin);
}

// ── GET /api/testimonials/public ──────────────────────────────
// Public. Uniquement les avis publiés ET consentis. Sans email.
export async function handleTestimonialsPublic(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') return corsPreflight(origin);
  await ensureSchema(env);

  const rows = (await env.DB.prepare(`
    SELECT id, author_name, author_role, rating, body, published_at
    FROM testimonials
    WHERE status = 'published' AND consent_publish = 1
    ORDER BY published_at DESC
    LIMIT 50
  `).all().catch(() => ({ results: [] }))).results || [];

  return json({ testimonials: rows, count: rows.length }, 200, origin);
}

// ── GET /api/admin/testimonials ───────────────────────────────
// Admin. Tout, pour la modération (email inclus).
export async function handleTestimonialsAdmin(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureSchema(env);

  const rows = (await env.DB.prepare(`
    SELECT id, author_name, author_role, author_email, rating, body, source,
           consent_publish, status, created_at, published_at
    FROM testimonials
    ORDER BY (status = 'pending') DESC, created_at DESC
    LIMIT 500
  `).all().catch(() => ({ results: [] }))).results || [];

  const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  return json({ testimonials: rows, counts }, 200, origin);
}

// ── POST /api/admin/testimonials/:id ──────────────────────────
// Admin. Body : { action: 'publish' | 'reject' | 'delete' }
export async function handleTestimonialModerate(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') return corsPreflight(origin);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureSchema(env);

  const safeId = clamp(id, 64);
  if (!safeId) return err('id manquant', 400, origin);
  const b = await parseBody(request) || {};
  const action = clamp(b.action, 16);

  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM testimonials WHERE id = ?').bind(safeId).run();
    return json({ ok: true, deleted: true }, 200, origin);
  }
  if (action === 'publish') {
    await env.DB.prepare(`UPDATE testimonials SET status = 'published', published_at = datetime('now') WHERE id = ?`).bind(safeId).run();
    return json({ ok: true, status: 'published' }, 200, origin);
  }
  if (action === 'reject') {
    await env.DB.prepare(`UPDATE testimonials SET status = 'rejected', published_at = NULL WHERE id = ?`).bind(safeId).run();
    return json({ ok: true, status: 'rejected' }, 200, origin);
  }
  return err('action invalide (publish|reject|delete)', 400, origin);
}
