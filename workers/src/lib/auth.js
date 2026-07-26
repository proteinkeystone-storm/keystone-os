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

// ── Comparaison à temps constant ──────────────────────────────
// Évite qu'un attaquant déduise le secret octet par octet en mesurant
// le temps de réponse (une comparaison `!==` court-circuite au 1er octet
// différent). Même logique que _safeEq côté Stripe (lib/stripe.js).
function _safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Vérification token Admin ──────────────────────────────────
// Deux façons d'être admin, et une seule fonction pour les deux :
//
//   1. Le SECRET MAÎTRE en Bearer (voie historique, toujours valable —
//      c'est le passe de secours si tout le reste échoue).
//   2. Un JWT ADMIN, reconnu en amont par le routeur (index.js), qui pose
//      alors `_ksAdmin` sur l'objet requête.
//
// Pourquoi la promotion est-elle faite par le routeur, et pas ici ?
// Parce que vérifier un JWT est asynchrone, et que cette fonction est
// appelée de façon SYNCHRONE à 87 endroits, sous la forme
// `if (!requireAdmin(request, env)) return err(...)`. La rendre `async`
// obligerait à ajouter un `await` aux 87 appels — et un seul oubli
// transformerait le test en `if (!Promise)`, c'est-à-dire toujours faux :
// la route deviendrait ouverte à tous, en silence. Le routeur décide donc
// en amont, une fois, et dépose le verdict ici.
//
// `_ksAdmin` n'est PAS lisible depuis la requête entrante : c'est une
// propriété posée côté serveur sur l'objet Request, jamais un en-tête.
// Un client ne peut donc pas se l'attribuer.
export function requireAdmin(request, env) {
  if (request?._ksAdmin === true) return true;
  const header = request.headers.get('Authorization') || '';
  const token  = header.replace(/^Bearer\s+/i, '').trim();
  if (!env.KS_ADMIN_SECRET || !token) return false;
  return _safeEq(token, env.KS_ADMIN_SECRET);
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
  // Auto-whitelist des previews Vercel du projet keystone-os (team
  // storms-projects-01b49fbc). Évite de devoir ajouter manuellement
  // chaque URL de preview lors des sprints sur branche dédiée.
  // Pattern : https://keystone-<hash>-storms-projects-01b49fbc.vercel.app
  if (reqOrigin && /^https:\/\/keystone(-[\w-]+)?-storms-projects-01b49fbc\.vercel\.app$/.test(reqOrigin)) {
    return reqOrigin;
  }
  return allowed[0] || '*';
}
