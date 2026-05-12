/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Devices v1.0
   Accès tablette/mobile sans clé physique

   Flux d'activation :
   ① Collaborateur :  POST /api/device/register  → crée le device (pending)
   ② Admin :          POST /api/device/approve   → approuve + retourne token
   ③ Collaborateur :  POST /api/device/login     → entre le token → session

   Routes admin :
   GET  /api/admin/devices          → liste tous les devices
   POST /api/device/revoke          → révoque un device

   ═══════════════════════════════════════════════════════════════ */

import {
  json, err, requireAdmin, requireDevice,
  parseBody, generateToken, generateId, getAllowedOrigin,
} from '../lib/auth.js';

// ── POST /api/device/register ─────────────────────────────────
// Appelé depuis la tablette du collaborateur.
// Crée un device en attente, retourne l'ID pour le suivi.
export async function handleRegister(request, env) {
  const origin = getAllowedOrigin(env, request);
  const body   = await parseBody(request);
  const { email, label, type = 'tablet', tenantId = 'default' } = body;

  if (!email) return err('Champ "email" requis', 400, origin);
  if (!label) return err('Champ "label" requis (ex: "iPad Terrain — Jean")', 400, origin);

  // Vérifie si un device pending existe déjà pour cet email
  const existing = await env.DB
    .prepare('SELECT id, is_approved FROM devices WHERE email = ? AND tenant_id = ?')
    .bind(email.toLowerCase(), tenantId)
    .first();

  if (existing) {
    return json({
      status:     existing.is_approved ? 'approved' : 'pending',
      deviceId:   existing.id,
      message:    existing.is_approved
        ? 'Device déjà approuvé. Utilisez /api/device/login.'
        : 'Demande déjà en attente — contactez votre administrateur.',
    }, 200, origin);
  }

  const id    = generateId();
  const token = generateToken(32); // 64 chars hex — ne sera révélé qu'après approbation admin

  await env.DB.prepare(`
    INSERT INTO devices (id, tenant_id, label, type, email, token, is_approved)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).bind(id, tenantId, label, type, email.toLowerCase(), token).run();

  return json({
    status:   'pending',
    deviceId: id,
    message:  'Demande enregistrée. L\'administrateur doit approuver cet appareil.',
  }, 201, origin);
}

// ── POST /api/device/approve ──────────────────────────────────
// Admin uniquement. Approuve le device et retourne le token
// à transmettre au collaborateur (par email ou SMS).
export async function handleApprove(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const body = await parseBody(request);
  const { deviceId, approvedBy = 'admin' } = body;
  if (!deviceId) return err('Champ "deviceId" requis', 400, origin);

  const device = await env.DB
    .prepare('SELECT * FROM devices WHERE id = ?')
    .bind(deviceId)
    .first();

  if (!device)            return err('Device introuvable', 404, origin);
  if (device.is_approved) return err('Device déjà approuvé', 409, origin);

  await env.DB.prepare(`
    UPDATE devices
    SET is_approved = 1, approved_by = ?
    WHERE id = ?
  `).bind(approvedBy, deviceId).run();

  return json({
    success:     true,
    deviceId,
    token:       device.token,
    email:       device.email,
    label:       device.label,
    instruction: `Transmettez ce token au collaborateur pour qu'il l'entre dans l'application.`,
  }, 200, origin);
}

// ── POST /api/device/login ────────────────────────────────────
// Le collaborateur entre son token → obtient les assets de son tenant.
export async function handleLogin(request, env) {
  const origin = getAllowedOrigin(env, request);
  const body   = await parseBody(request);
  const token  = (body.token || '').trim();

  if (!token) return err('Token requis', 400, origin);

  const device = await env.DB
    .prepare('SELECT * FROM devices WHERE token = ? AND is_approved = 1')
    .bind(token)
    .first();

  if (!device) return err('Token invalide ou device non approuvé', 403, origin);

  // Met à jour last_seen
  await env.DB
    .prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?")
    .bind(device.id)
    .run();

  // Récupère une licence active pour ce tenant (première trouvée par défaut)
  // Sprint Sécu-1 / C4 — décision Q1c :
  // Discipline : le flow device (B2B terrain) ne doit PAS croiser les
  // licences Stripe (B2C payeurs solo, tenant='default'). Quand on
  // crée un device pour un client B2B (ex: Prométhée), on assigne
  // explicitement device.tenant_id = leur tenant dédié, jamais 'default'.
  // Sinon le device récupérerait la licence Stripe la plus récente
  // d'un payeur quelconque. À durcir : foreign key device.licence_id.
  const licence = await env.DB
    .prepare('SELECT * FROM licences WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1')
    .bind(device.tenant_id)
    .first();

  return json({
    authenticated: true,
    deviceId:      device.id,
    label:         device.label,
    email:         device.email,
    sessionToken:  device.token,
    plan:          licence?.plan        || 'STARTER',
    ownedAssets:   licence?.owned_assets ? JSON.parse(licence.owned_assets) : null,
  }, 200, origin);
}

// ── POST /api/device/revoke ───────────────────────────────────
export async function handleRevoke(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const { deviceId } = await parseBody(request);
  if (!deviceId) return err('Champ "deviceId" requis', 400, origin);

  const result = await env.DB
    .prepare('DELETE FROM devices WHERE id = ?')
    .bind(deviceId)
    .run();

  if (!result.meta.changes) return err('Device introuvable', 404, origin);

  return json({ success: true, deviceId }, 200, origin);
}

// ── GET /api/admin/devices ────────────────────────────────────
export async function handleList(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const url    = new URL(request.url);
  const filter = url.searchParams.get('approved'); // 'true' | 'false' | null

  let query = 'SELECT id, tenant_id, label, type, email, is_approved, approved_by, last_seen, created_at FROM devices';
  if (filter === 'true')  query += ' WHERE is_approved = 1';
  if (filter === 'false') query += ' WHERE is_approved = 0';
  query += ' ORDER BY created_at DESC';

  const { results } = await env.DB.prepare(query).all();

  const pending  = results.filter(d => !d.is_approved).length;
  const approved = results.filter(d =>  d.is_approved).length;

  return json({
    total: results.length,
    pending,
    approved,
    devices: results.map(d => ({
      id:         d.id,
      label:      d.label,
      type:       d.type,
      email:      d.email,
      approved:   d.is_approved === 1,
      approvedBy: d.approved_by,
      lastSeen:   d.last_seen,
      createdAt:  d.created_at,
    })),
  }, 200, origin);
}
