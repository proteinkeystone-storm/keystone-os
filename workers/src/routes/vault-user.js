/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vault utilisateur sync (Sprint 4)
   ═══════════════════════════════════════════════════════════════
   Routes :
     GET  /api/vault/load   Auth: JWT → renvoie le blob chiffré
     POST /api/vault/save   Auth: JWT → upsert le blob chiffré

   Sécurité :
   - Chiffrement AES-GCM serveur avec KS_ENCRYPTION_KEY
   - Index = sub du JWT (= lookup_hmac de la licence) → un user
     ne voit jamais le vault d'un autre.
   - Plafond 64 KB par blob (les clés API tiennent largement).
   - Le blob côté client est un JSON :
       { api: {anthropic,openai,...}, prefs: {name,photo,...} }
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { encrypt, decrypt }                       from '../lib/crypto.js';
import { requireJWT }                             from '../lib/jwt.js';

const MAX_BLOB_BYTES = 64 * 1024;

// ═══════════════════════════════════════════════════════════════
// GET /api/vault/load
// ═══════════════════════════════════════════════════════════════
export async function handleVaultLoad(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!env.KS_ENCRYPTION_KEY) return err('Server: KS_ENCRYPTION_KEY manquant', 500, origin);

  const claims = await requireJWT(request, env);
  if (!claims) return err('JWT invalide ou expiré', 401, origin);

  const row = await env.DB
    .prepare('SELECT ciphertext, iv, updated_at FROM user_vaults WHERE sub = ?')
    .bind(claims.sub)
    .first();

  // Pas encore de vault → renvoie un blob vide (le client repart sur localStorage)
  if (!row) return json({ vault: null, updatedAt: null }, 200, origin);

  try {
    const plain = await decrypt(row.ciphertext, row.iv, env.KS_ENCRYPTION_KEY);
    return json({ vault: JSON.parse(plain), updatedAt: row.updated_at }, 200, origin);
  } catch (e) {
    return err('Vault corrompu ou clé incorrecte', 500, origin);
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/vault/save
// Body: { vault: { api: {...}, prefs: {...} } }
// ═══════════════════════════════════════════════════════════════
export async function handleVaultSave(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!env.KS_ENCRYPTION_KEY) return err('Server: KS_ENCRYPTION_KEY manquant', 500, origin);

  const claims = await requireJWT(request, env);
  if (!claims) return err('JWT invalide ou expiré', 401, origin);

  const body = await parseBody(request);
  const vault = body?.vault;
  if (!vault || typeof vault !== 'object') return err('Vault invalide', 400, origin);

  const plain = JSON.stringify(vault);
  if (plain.length > MAX_BLOB_BYTES) {
    return err(`Vault trop gros (${plain.length} > ${MAX_BLOB_BYTES} bytes)`, 413, origin);
  }

  const { ciphertext, iv } = await encrypt(plain, env.KS_ENCRYPTION_KEY);

  await env.DB.prepare(`
    INSERT INTO user_vaults (sub, ciphertext, iv, updated_at, size_bytes)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(sub) DO UPDATE SET
      ciphertext = excluded.ciphertext,
      iv         = excluded.iv,
      updated_at = excluded.updated_at,
      size_bytes = excluded.size_bytes
  `).bind(claims.sub, ciphertext, iv, plain.length).run();

  return json({ ok: true, savedAt: new Date().toISOString() }, 200, origin);
}
