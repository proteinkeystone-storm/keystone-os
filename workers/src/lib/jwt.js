/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — JWT HS256 v1.0  (Sprint 2.1)
   ═══════════════════════════════════════════════════════════════
   Implémentation minimale RFC 7519 / RFC 7515 en WebCrypto natif,
   sans dépendance externe.

   - Algorithme : HS256 (HMAC-SHA256)
   - Secret : env.KS_JWT_SECRET (32+ bytes aléatoires)
   - Encoding : Base64URL (sans padding)
   - Validation : exp + iat + signature constant-time

   Usage :
     const jwt = await signJWT({ sub: '...', plan: 'PRO' }, env);
     const payload = await verifyJWT(jwt, env); // throws si invalide
   ═══════════════════════════════════════════════════════════════ */

const ALG    = { name: 'HMAC', hash: 'SHA-256' };
const HEADER = { alg: 'HS256', typ: 'JWT' };

// ── Base64URL helpers ────────────────────────────────────────
function _b64uEncode(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  return btoa(String.fromCharCode(...bytes))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
function _b64uDecode(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/')
    + '==='.slice((b64u.length + 3) % 4);
  return new TextDecoder().decode(
    Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  );
}

async function _hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALG,
    false,
    ['sign', 'verify'],
  );
}

/**
 * Signe un payload en JWT HS256. exp/iat ajoutés automatiquement
 * (sauf si déjà présents).
 *
 * @param {object} payload    — claims utilisateur
 * @param {object} env        — env Worker (KS_JWT_SECRET requis)
 * @param {number} ttlSeconds — durée de vie (défaut 30 jours)
 */
export async function signJWT(payload, env, ttlSeconds = 60 * 60 * 24 * 30) {
  if (!env.KS_JWT_SECRET) throw new Error('KS_JWT_SECRET manquant');

  const now = Math.floor(Date.now() / 1000);
  const finalPayload = {
    iat: now,
    exp: now + ttlSeconds,
    ...payload,
  };

  const headerB64  = _b64uEncode(JSON.stringify(HEADER));
  const payloadB64 = _b64uEncode(JSON.stringify(finalPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await _hmacKey(env.KS_JWT_SECRET);
  const sig = await crypto.subtle.sign(ALG, key, new TextEncoder().encode(signingInput));
  const sigB64 = _b64uEncode(sig);

  return `${signingInput}.${sigB64}`;
}

/**
 * Vérifie un JWT et retourne son payload si valide.
 * Lève une erreur si signature, exp ou format incorrects.
 */
export async function verifyJWT(token, env) {
  if (!env.KS_JWT_SECRET) throw new Error('KS_JWT_SECRET manquant');
  if (typeof token !== 'string') throw new Error('JWT invalide');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT mal formé');

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  // Vérification signature (constant-time via WebCrypto)
  const key = await _hmacKey(env.KS_JWT_SECRET);
  const sigBytes = Uint8Array.from(
    atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')
      + '==='.slice((sigB64.length + 3) % 4)),
    c => c.charCodeAt(0),
  );
  const ok = await crypto.subtle.verify(
    ALG, key, sigBytes, new TextEncoder().encode(signingInput),
  );
  if (!ok) throw new Error('JWT signature invalide');

  // Décodage payload
  const payload = JSON.parse(_b64uDecode(payloadB64));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('JWT expiré');
  if (payload.nbf && payload.nbf > now) throw new Error('JWT pas encore valide');

  return payload;
}

/**
 * Helper pour les routes protégées : extrait + vérifie le JWT
 * du header Authorization. Retourne null si absent ou invalide.
 */
export async function requireJWT(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token  = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try { return await verifyJWT(token, env); }
  catch { return null; }
}
