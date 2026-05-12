/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — AES-GCM Crypto v1.0
   Chiffrement des clés API au repos (Privacy by Design)

   Algorithme : AES-256-GCM (Web Crypto API native Cloudflare Workers)
   - Clé dérivée depuis KS_ENCRYPTION_KEY via SHA-256
   - IV aléatoire 12 bytes stocké avec le ciphertext
   - Authentification intégrée (GCM = Galois/Counter Mode)
   ─────────────────────────────────────────────────────────────
   Sprint Sécu-3 / M9 — Procédure de rotation KS_ENCRYPTION_KEY :

   Quand rotater :
     - Suspicion de fuite (worker logs, dump CF, etc.)
     - Tous les 12-24 mois en routine
     - Avant le passage en commercialisation grand public

   Procédure (manuelle, ~30 min, sans downtime si rolling) :

     1. Générer une nouvelle KS_ENCRYPTION_KEY (32+ chars, csprng) :
          openssl rand -base64 48
        Stocker en safe (1Password, etc.) AVANT de toucher au Worker.

     2. Ajouter un secret KS_ENCRYPTION_KEY_NEXT (rolling) :
          wrangler secret put KS_ENCRYPTION_KEY_NEXT
        Ne pas remplacer KS_ENCRYPTION_KEY tout de suite.

     3. Adapter encrypt() pour utiliser KS_ENCRYPTION_KEY_NEXT si présente
        (les nouveaux blobs sont chiffrés avec la nouvelle clé).
        Adapter decrypt() pour essayer NEXT puis fallback sur l'ancienne
        (les anciens blobs continuent à se lire).
        Tag chaque ciphertext avec un préfixe de version : "v2:<b64>".

     4. Lancer un script de migration one-shot (admin endpoint dédié) :
        - SELECT all api_keys_vault + user_vaults
        - Pour chaque blob v1 : decrypt avec ancienne clé, re-encrypt
          avec nouvelle, UPDATE en DB avec préfixe v2
        - Monitoring : compter v1 restants jusqu'à 0

     5. Quand v1 = 0 partout :
          wrangler secret put KS_ENCRYPTION_KEY        (= la nouvelle valeur)
          wrangler secret delete KS_ENCRYPTION_KEY_NEXT
        Et retirer le code de fallback.

   Aujourd'hui (v1) : pas de versioning. Une rotation = downtime forcé
   (purge des api_keys_vault + user_vaults, les users doivent re-saisir
   leurs clés). Ce qui est acceptable pour la v1 si jamais nécessaire.
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
