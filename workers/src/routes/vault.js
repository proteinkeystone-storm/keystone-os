/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Vault (Clés API) v1.0
   Stockage chiffré AES-256-GCM des clés API moteurs IA

   GET    /api/admin/keys            Admin — liste les providers (sans valeur)
   POST   /api/admin/keys            Admin — sauvegarder/mettre à jour une clé
   DELETE /api/admin/keys            Admin — supprimer une clé

   Les clés ENTRENT ici et n'en ressortent jamais : aucune route ne renvoie
   une valeur déchiffrée. Seul lib/llm-router.js la déchiffre, en mémoire,
   le temps d'appeler le fournisseur. (Audit sept. 2026 · E-3 — la route de
   relecture GET /api/admin/keys/:provider a été supprimée.)
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, generateId, getAllowedOrigin } from '../lib/auth.js';
import { encrypt } from '../lib/crypto.js';

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

// ── GET /api/admin/keys/:provider — SUPPRIMÉE (audit sept. 2026 · E-3) ──
// Elle déchiffrait une clé API tierce et la renvoyait EN CLAIR dans la
// réponse. C'était la seule route du worker à le faire, et donc le premier
// arrêt d'un accès admin volé : une requête, et l'attaquant repartait avec
// des clés dépensables ailleurs, hors de Keystone.
//
// Aucun appelant n'existait — ni dans le front, ni dans les scripts, ni dans
// les bancs — et le propriétaire ne récupère jamais ses clés depuis Keystone :
// il ne fait que les y déposer. Une porte sans usage ne se ferme pas, elle
// se mure.
//
// Les clés restent déchiffrées côté serveur au moment d'appeler le
// fournisseur (lib/llm-router.js) : c'est leur seul usage légitime, et il ne
// les expose à personne.
