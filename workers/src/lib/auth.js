/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Auth & Response Helpers v1.0
   ═══════════════════════════════════════════════════════════════ */

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  // X-Tenant-Id ajouté Sprint SDQR-1 : header custom envoye par sdqr.js
  // pour identifier le tenant proprietaire des QR codes.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Id',
};

// ── Réponses JSON ─────────────────────────────────────────────
export function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      ...CORS_HEADERS,
    },
  });
}

export function err(message, status = 400, origin = '*') {
  return json({ error: message }, status, origin);
}

export function corsOk(origin = '*') {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS },
  });
}

// ── Vérification token Admin ──────────────────────────────────
export function requireAdmin(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token  = header.replace(/^Bearer\s+/i, '').trim();
  if (!env.KS_ADMIN_SECRET || token !== env.KS_ADMIN_SECRET) return false;
  return true;
}

// ── Vérification token Device ─────────────────────────────────
export async function requireDevice(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token  = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const device = await env.DB
    .prepare('SELECT * FROM devices WHERE token = ? AND is_approved = 1')
    .bind(token)
    .first();

  if (!device) return null;

  // Met à jour last_seen
  await env.DB
    .prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?")
    .bind(device.id)
    .run();

  return device;
}

// ── Génération token sécurisé ─────────────────────────────────
export function generateToken(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export function generateId() {
  return crypto.randomUUID();
}

// ── Parse body JSON avec fallback ────────────────────────────
export async function parseBody(request) {
  try { return await request.json(); }
  catch { return {}; }
}

// ── Origine autorisée (multi-origin via CSV) ─────────────────
// KS_ALLOWED_ORIGIN peut contenir une seule URL ou plusieurs séparées
// par virgule. Si l'origin de la requête figure dans la liste, on la
// renvoie ; sinon on fallback sur le premier élément (ou '*' si non défini).
// Permet de servir Vercel prod + localhost dev en parallèle.
export function getAllowedOrigin(env, request) {
  const config = (env.KS_ALLOWED_ORIGIN || '*').trim();
  if (config === '*') return '*';
  const allowed = config.split(',').map(s => s.trim()).filter(Boolean);
  const reqOrigin = request?.headers?.get('Origin') || '';
  if (reqOrigin && allowed.includes(reqOrigin)) return reqOrigin;
  return allowed[0] || '*';
}
