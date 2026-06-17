/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Notes des apps (étoiles) → agrégat Admin
   ─────────────────────────────────────────────────────────────
   POST /api/ratings        utilisateur (JWT) — pose/maj/retire sa note
   GET  /api/admin/ratings  admin            — agrégats par app (anonymes)

   Décisions (2026-06-17) : ÉTOILES SEULES (pas de commentaire) +
   affichage ANONYME / AGRÉGÉ. On stocke quand même tenant_id (= claims.sub,
   l'identifiant de licence) UNIQUEMENT pour la déduplication : 1 note par
   (utilisateur, app), sinon un même utilisateur fausserait la moyenne en
   notant 50 fois. Cet identifiant n'est JAMAIS renvoyé par l'endpoint admin
   (qui ne sort que des agrégats). RGPD : aucune donnée perso, aucun texte.

   Table auto-créée idempotent (même patron que routes/leads.js, keys.js).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

// app_id = id NOMEN-K d'un outil (ex. A-COM-001, O-Keyn-001, O-AGT-001).
const APP_ID_RE = /^[A-Za-z0-9_-]{2,48}$/;

let _ratingsSchemaReady = false;
async function ensureRatingsSchema(env) {
  if (_ratingsSchemaReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS app_ratings (
        tenant_id  TEXT NOT NULL,
        app_id     TEXT NOT NULL,
        value      INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (tenant_id, app_id)
      )
    `).run();
    await env.DB
      .prepare('CREATE INDEX IF NOT EXISTS idx_app_ratings_app ON app_ratings(app_id)')
      .run().catch(() => {});
  } catch (_) { /* déjà créée : OK */ }
  _ratingsSchemaReady = true;
}

// ── POST /api/ratings ─────────────────────────────────────────
// Body : { app_id, value }  ·  value 1-5 = note, 0/absent = retirer.
export async function handleRatingSubmit(request, env) {
  const origin = getAllowedOrigin(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Auth obligatoire : seul un utilisateur connecté note. Le tenant vient du
  // JWT (claims.sub), JAMAIS du client → impossible de noter pour autrui.
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return err('Authentification requise', 401, origin);

  await ensureRatingsSchema(env);

  const b = await parseBody(request);
  const appId = (typeof b?.app_id === 'string') ? b.app_id.trim() : '';
  if (!APP_ID_RE.test(appId)) return err('app_id invalide', 400, origin);

  const value  = parseInt(b?.value, 10) || 0;
  const tenant = claims.sub;

  // value 0 → l'utilisateur retire sa note.
  if (value === 0) {
    await env.DB
      .prepare('DELETE FROM app_ratings WHERE tenant_id = ? AND app_id = ?')
      .bind(tenant, appId).run().catch(() => {});
    return json({ ok: true, cleared: true }, 200, origin);
  }
  if (value < 1 || value > 5) return err('value doit être 1-5 (ou 0 pour retirer)', 400, origin);

  // Upsert : 1 note par (utilisateur, app). Re-noter écrase l'ancienne.
  await env.DB.prepare(`
    INSERT INTO app_ratings (tenant_id, app_id, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, app_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(tenant, appId, value).run().catch(() => {});

  return json({ ok: true }, 200, origin);
}

// ── GET /api/admin/ratings ────────────────────────────────────
// Agrégats par app, ANONYMES (aucun tenant_id renvoyé). Tri : moyenne la
// plus basse d'abord → les mécontentements remontent en tête.
export async function handleRatingsAdmin(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  await ensureRatingsSchema(env);

  const rows = (await env.DB.prepare(`
    SELECT app_id,
           COUNT(*)                                 AS n,
           ROUND(AVG(value), 2)                     AS avg,
           SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS s1,
           SUM(CASE WHEN value = 2 THEN 1 ELSE 0 END) AS s2,
           SUM(CASE WHEN value = 3 THEN 1 ELSE 0 END) AS s3,
           SUM(CASE WHEN value = 4 THEN 1 ELSE 0 END) AS s4,
           SUM(CASE WHEN value = 5 THEN 1 ELSE 0 END) AS s5,
           MAX(updated_at)                          AS last_at
    FROM app_ratings
    GROUP BY app_id
  `).all().catch(() => ({ results: [] }))).results || [];

  // Moyennes basses en tête (mécontentements à traiter en priorité).
  rows.sort((a, b) => (a.avg ?? 5) - (b.avg ?? 5));
  const totalVotes = rows.reduce((s, r) => s + (r.n || 0), 0);

  return json({ apps: rows, total_votes: totalVotes }, 200, origin);
}
