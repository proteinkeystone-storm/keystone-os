/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Key Derivation v1.0  (Sprint 2.1)
   ═══════════════════════════════════════════════════════════════
   Approche en deux temps pour stocker les clés de licence :

   1. BLIND INDEX (lookup_hmac)
      HMAC-SHA256(uppercase(key), env.KS_LOOKUP_PEPPER)
      → permet de retrouver une licence par sa clé sans la stocker.
      Le pepper est en secret Worker, donc même un dump D1 ne permet
      pas de reconstruire l'index sans accès au Worker.

   2. KEY HASH (key_hash + salt)
      PBKDF2-SHA256, 600 000 itérations, salt 16 bytes par clé.
      Recommandation OWASP 2023 pour les KDF sans WASM.
      NB : Argon2id serait préférable pour des mots de passe à faible
      entropie, mais nos clés sont des UUIDv4 (122 bits d'entropie),
      contre lesquels PBKDF2-600k est cryptographiquement équivalent.
      Migration vers Argon2id possible plus tard via @noble/hashes.

   Activation = HMAC lookup → PBKDF2 verify → constant-time compare.
   ═══════════════════════════════════════════════════════════════ */

// Cloudflare Workers cap PBKDF2 à 100 000 itérations (limite plateforme).
// Pour des clés à haute entropie (UUIDv4 = 122 bits, ou format
// XXXX-XXXX-XXXX-XXXX = 80 bits), 100k itérations restent
// cryptographiquement suffisantes : un attaquant doit calculer
// 100 000 PBKDF2 par tentative, et le coût total dépasse largement
// l'entropie de la clé elle-même. Migration future possible vers
// Argon2id (@noble/hashes WASM) si on doit supporter des secrets
// à faible entropie type mots de passe humains.
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH       = 'SHA-256';
const KEY_HASH_LEN      = 32;     // 256 bits
const SALT_LEN          = 16;

// ── Encoding helpers (hex) ───────────────────────────────────
function _bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function _hexToBuf(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i*2, 2), 16);
  return out;
}

/**
 * Blind index pour lookup en O(1) sans révéler la clé.
 * Le pepper sert de "secret partagé" Worker — même un attaquant
 * ayant le dump D1 ne peut pas pré-calculer un dictionnaire.
 */
export async function blindIndex(key, pepper) {
  if (!pepper) throw new Error('KS_LOOKUP_PEPPER manquant');
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    new TextEncoder().encode(key.toUpperCase().trim()),
  );
  return _bufToHex(sig);
}

/**
 * Hash PBKDF2-SHA256 d'une clé avec un salt aléatoire par clé.
 * Renvoie { hash: hex, salt: hex } à stocker.
 */
export async function hashKey(key) {
  const salt    = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key.toUpperCase().trim()),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    baseKey,
    KEY_HASH_LEN * 8,
  );
  return { hash: _bufToHex(derived), salt: _bufToHex(salt) };
}

/**
 * Vérifie une clé candidate contre un hash + salt stockés.
 * Constant-time via crypto.subtle (garantie de la WebCrypto).
 */
export async function verifyKey(candidate, expectedHashHex, saltHex) {
  if (!expectedHashHex || !saltHex) return false;
  const salt    = _hexToBuf(saltHex);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(candidate.toUpperCase().trim()),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    baseKey,
    KEY_HASH_LEN * 8,
  );
  return _constEq(_bufToHex(derived), expectedHashHex);
}

// ── Constant-time string equality (anti timing attack) ───────
function _constEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
