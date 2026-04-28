/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Vault (Clés API) v1.0
   Stockage chiffré AES-256-GCM des clés API moteurs IA

   GET    /api/admin/keys            Admin — liste les providers (sans valeur)
   POST   /api/admin/keys            Admin — sauvegarder/mettre à jour une clé
   DELETE /api/admin/keys            Admin — supprimer une clé
   GET    /api/keys/:provider        Admin — lire une clé déchiffrée (pour usage serveur)
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, generateId, getAllowedOrigin } from '../lib/auth.js';
import { encrypt, decrypt } from '../lib/crypto.js';

// Providers supportés
const VALID_PROVIDERS = ['anthropic', 'openai', 'google', 'mistral', 'perplexity', 'grok'];

// ── GET /api/admin/keys ────────────────────────────────────────
// Retourne la liste des providers configurés (pas les valeurs).
export async function handleListKeys(request, env) {
  const origin   = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const url      = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') || 'default';

  const { results } = await env.DB
    .prepare('SELECT id, provider, label, created_at FROM api_keys_vault WHERE tenant_id = ?')
    .bind(tenantId)
    .all();

  return json({
    keys: results.map(r => ({
      id:        r.id,
      provider:  r.provider,
      label:     r.label || r.provider,
      savedAt:   r.created_at,
    })),
    configured: results.map(r => r.provider),
  }, 200, origin);
}

// ── POST /api/admin/keys ───────────────────────────────────────
// Chiffre et stocke une clé API. Un seul enregistrement par provider/tenant.
export async function handleSaveKey(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const body = await parseBody(request);
  const { provider, apiKey, label, tenantId = 'default' } = body;

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return err(`Provider invalide. Valeurs : ${VALID_PROVIDERS.join(', ')}`, 400, origin);
  }
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 8) {
    return err('Clé API invalide (trop courte)', 400, origin);
  }
  if (!env.KS_ENCRYPTION_KEY) {
    return err('KS_ENCRYPTION_KEY non configurée', 500, origin);
  }

  // Chiffrement AES-256-GCM
  const { ciphertext, iv } = await encrypt(apiKey, env.KS_ENCRYPTION_KEY);

  // Upsert par provider + tenant_id
  const existing = await env.DB
    .prepare('SELECT id FROM api_keys_vault WHERE provider = ? AND tenant_id = ?')
    .bind(provider, tenantId)
    .first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE api_keys_vault
      SET ciphertext = ?, iv = ?, label = ?, created_at = datetime('now')
      WHERE id = ?
    `).bind(ciphertext, iv, label || provider, existing.id).run();
  } else {
    const id = generateId();
    await env.DB.prepare(`
      INSERT INTO api_keys_vault (id, tenant_id, provider, ciphertext, iv, label)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, tenantId, provider, ciphertext, iv, label || provider).run();
  }

  return json({ success: true, provider, savedAt: new Date().toISOString() }, 200, origin);
}

// ── DELETE /api/admin/keys ─────────────────────────────────────
export async function handleDeleteKey(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const { provider, tenantId = 'default' } = await parseBody(request);
  if (!provider) return err('Champ "provider" requis', 400, origin);

  const result = await env.DB
    .prepare('DELETE FROM api_keys_vault WHERE provider = ? AND tenant_id = ?')
    .bind(provider, tenantId)
    .run();

  if (!result.meta.changes) return err('Clé introuvable', 404, origin);
  return json({ success: true, provider }, 200, origin);
}

// ── GET /api/admin/keys/:provider ─────────────────────────────
// Déchiffre et retourne la valeur brute (usage serveur uniquement).
export async function handleGetKey(request, env, provider) {
  const origin   = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const url      = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') || 'default';

  const row = await env.DB
    .prepare('SELECT ciphertext, iv FROM api_keys_vault WHERE provider = ? AND tenant_id = ?')
    .bind(provider, tenantId)
    .first();

  if (!row) return err(`Clé "${provider}" non configurée`, 404, origin);

  try {
    const apiKey = await decrypt(row.ciphertext, row.iv, env.KS_ENCRYPTION_KEY);
    return json({ provider, apiKey }, 200, origin);
  } catch {
    return err('Déchiffrement échoué', 500, origin);
  }
}
