/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — AES-GCM Crypto v1.0
   Chiffrement des clés API au repos (Privacy by Design)

   Algorithme : AES-256-GCM (Web Crypto API native Cloudflare Workers)
   - Clé dérivée depuis KS_ENCRYPTION_KEY via SHA-256
   - IV aléatoire 12 bytes stocké avec le ciphertext
   - Authentification intégrée (GCM = Galois/Counter Mode)
   ═══════════════════════════════════════════════════════════════ */

const ALGO = { name: 'AES-GCM', length: 256 };

async function _deriveKey(secret) {
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey('raw', raw, ALGO, false, ['encrypt', 'decrypt']);
}

/**
 * Chiffre un texte avec AES-256-GCM.
 * @param {string} plaintext  — clé API en clair
 * @param {string} secret     — env.KS_ENCRYPTION_KEY
 * @returns {{ ciphertext: string, iv: string }} base64
 */
export async function encrypt(plaintext, secret) {
  const key     = await _deriveKey(secret);
  const iv      = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return {
    ciphertext: _toB64(new Uint8Array(buf)),
    iv:         _toB64(iv),
  };
}

/**
 * Déchiffre un ciphertext AES-256-GCM.
 * @param {string} ciphertextB64 — base64
 * @param {string} ivB64         — base64
 * @param {string} secret        — env.KS_ENCRYPTION_KEY
 * @returns {string} plaintext
 */
export async function decrypt(ciphertextB64, ivB64, secret) {
  const key        = await _deriveKey(secret);
  const ciphertext = _fromB64(ciphertextB64);
  const iv         = _fromB64(ivB64);

  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(buf);
}

// ── Helpers base64 ────────────────────────────────────────────
function _toB64(buf) {
  return btoa(String.fromCharCode(...buf));
}
function _fromB64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
