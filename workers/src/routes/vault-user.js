/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vault utilisateur sync (Sprint 4 + S4)
   ═══════════════════════════════════════════════════════════════
   Routes :
     GET  /api/vault/load     Auth: JWT → renvoie le blob chiffré
     POST /api/vault/save     Auth: JWT → upsert le blob chiffré
     GET  /api/vault/health   Auth: JWT → état du vault (S4.4)

   Sécurité :
   - Chiffrement AES-GCM serveur avec KS_ENCRYPTION_KEY
   - Index = sub du JWT (= lookup_hmac de la licence) → un user
     ne voit jamais le vault d'un autre.
   - Plafond 64 KB par blob (les clés API tiennent largement).
   - Le blob côté client est un JSON :
       { api: {anthropic,openai,...}, prefs: {name,photo,...} }

   Sprint S4 — Hardening per-(licence_key, email) :
   - Table PARALLÈLE `user_vaults_email` (PK composite (sub, email)).
     La table legacy `user_vaults` est strictement INTOUCHÉE → zéro
     risque de perte de données. SQLite ne supportant pas l'ajout
     d'une PK composite par ALTER, on duplique la structure.
   - Feature flag licences.enforce_vault_per_email_v2 (défaut 0)
     → flag=0 : lit/écrit dans `user_vaults` (legacy)
     → flag=1 : lit/écrit dans `user_vaults_email`, fallback en
       lecture sur `user_vaults` si la row scoped n'existe pas
       (= lazy-migration, le legacy n'est jamais écrasé).
   - Le flag est dormant par défaut. Aucune licence prod n'est
     impactée tant qu'on ne flagge pas explicitement.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { encrypt, decrypt }                       from '../lib/crypto.js';
import { requireJWT }                             from '../lib/jwt.js';
import { audit }                                  from '../lib/audit.js';

const MAX_BLOB_BYTES = 64 * 1024;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Normalise + valide l'email du JWT. Renvoie un email lowercase
// trim si valide, sinon null. Critique : signJWT pose parfois un
// `owner` legacy (nom libre, pas email) dans le claim `email` —
// on s'en protège en exigeant EMAIL_RE pour le scoping S4.
function _claimEmailIfValid(claims) {
  const raw = (claims?.email || '').toString().trim().toLowerCase();
  if (!raw) return null;
  if (!EMAIL_RE.test(raw)) return null;
  return raw;
}

// ── Auto-migration S4 (additive only) ──────────────────────────
// Pattern Keystone (cf. conventions_keystone) : ensureSchema*
// idempotent, appelé au 1er accès route, try/catch silent sur
// les ALTER/CREATE (peut déjà exister).
//
// Garde-fou critique : on NE touche PAS à la table `user_vaults`
// existante. La PK `sub` interdit toute coexistence de plusieurs
// blobs par licence, donc on crée une table parallèle.
let _schemaVaultV2Ready = false;
async function ensureSchemaVaultV2(env) {
  if (_schemaVaultV2Ready) return;
  // 1) Table parallèle pour scoping email (additif pur).
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS user_vaults_email (
        sub          TEXT NOT NULL,
        email        TEXT NOT NULL,
        ciphertext   TEXT NOT NULL,
        iv           TEXT NOT NULL,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        size_bytes   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (sub, email)
      )
    `).run();
  } catch (_) { /* table déjà créée, ok */ }
  try {
    await env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_user_vaults_email_updated ON user_vaults_email(updated_at)'
    ).run();
  } catch (_) { /* index déjà créé, ok */ }
  // 2) Flag licence enforce_vault_per_email_v2 (dormant par défaut).
  try {
    await env.DB.prepare(
      'ALTER TABLE licences ADD COLUMN enforce_vault_per_email_v2 INTEGER DEFAULT 0'
    ).run();
  } catch (_) { /* colonne déjà ajoutée, ok */ }
  _schemaVaultV2Ready = true;
}

// ── Helper interne : lit le flag enforce_vault_per_email_v2 ─────
// Si le claim JWT contient un sub mais pas d'email, on retombe sur
// le legacy quoi qu'il arrive (zéro risque de lookup vide).
async function _isVaultEmailScopingEnabled(env, sub) {
  try {
    const row = await env.DB
      .prepare(`
        SELECT enforce_vault_per_email_v2 AS flag
          FROM licences
         WHERE lookup_hmac = ?
         LIMIT 1
      `)
      .bind(sub)
      .first();
    return !!(row && row.flag === 1);
  } catch (_) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/vault/load
// ═══════════════════════════════════════════════════════════════
export async function handleVaultLoad(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!env.KS_ENCRYPTION_KEY) return err('Server: KS_ENCRYPTION_KEY manquant', 500, origin);

  const claims = await requireJWT(request, env);
  if (!claims) return err('JWT invalide ou expiré', 401, origin);

  await ensureSchemaVaultV2(env);

  // S4 — Lookup scoped via table user_vaults_email si flag activé +
  // email valide dans JWT. Fallback gracieux sur user_vaults legacy
  // pour la lazy-migration (le legacy n'est jamais écrasé).
  const email = _claimEmailIfValid(claims);
  const useEmailScope = email && await _isVaultEmailScopingEnabled(env, claims.sub);

  let row = null;
  let scope = 'legacy';
  if (useEmailScope) {
    row = await env.DB
      .prepare('SELECT ciphertext, iv, updated_at FROM user_vaults_email WHERE sub = ? AND email = ? LIMIT 1')
      .bind(claims.sub, email)
      .first();
    if (row) {
      scope = 'email';
    } else {
      // Lazy-migration : fallback sur la table legacy si pas de row scoped.
      row = await env.DB
        .prepare('SELECT ciphertext, iv, updated_at FROM user_vaults WHERE sub = ? LIMIT 1')
        .bind(claims.sub)
        .first();
      if (row) scope = 'legacy_fallback';
    }
  } else {
    row = await env.DB
      .prepare('SELECT ciphertext, iv, updated_at FROM user_vaults WHERE sub = ? LIMIT 1')
      .bind(claims.sub)
      .first();
  }

  // Pas encore de vault → renvoie un blob vide (le client repart sur localStorage)
  if (!row) return json({ vault: null, updatedAt: null, scope }, 200, origin);

  try {
    const plain = await decrypt(row.ciphertext, row.iv, env.KS_ENCRYPTION_KEY);
    return json({ vault: JSON.parse(plain), updatedAt: row.updated_at, scope }, 200, origin);
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

  await ensureSchemaVaultV2(env);

  const body = await parseBody(request);
  const vault = body?.vault;
  if (!vault || typeof vault !== 'object') return err('Vault invalide', 400, origin);

  const plain = JSON.stringify(vault);
  if (plain.length > MAX_BLOB_BYTES) {
    return err(`Vault trop gros (${plain.length} > ${MAX_BLOB_BYTES} bytes)`, 413, origin);
  }

  const { ciphertext, iv } = await encrypt(plain, env.KS_ENCRYPTION_KEY);

  // S4 — Mode scoping email :
  //   flag=1 + email valide → upsert sur user_vaults_email (sub, email).
  //   flag=0 OU email absent → comportement legacy strict sur user_vaults.
  // La table legacy user_vaults n'est JAMAIS écrite par la branche
  // scoped → zéro risque de perte de données pré-S4.
  // Try/catch défensif : si la branche S4 throw (D1 transient, etc.),
  // on retombe sur le legacy plutôt que d'empêcher le user de sauvegarder.
  const email = _claimEmailIfValid(claims);
  const useEmailScope = email && await _isVaultEmailScopingEnabled(env, claims.sub);

  let scope = 'legacy';
  try {
    if (useEmailScope) {
      await env.DB.prepare(`
        INSERT INTO user_vaults_email (sub, email, ciphertext, iv, updated_at, size_bytes)
        VALUES (?, ?, ?, ?, datetime('now'), ?)
        ON CONFLICT(sub, email) DO UPDATE SET
          ciphertext = excluded.ciphertext,
          iv         = excluded.iv,
          updated_at = excluded.updated_at,
          size_bytes = excluded.size_bytes
      `).bind(claims.sub, email, ciphertext, iv, plain.length).run();
      scope = 'email';
    } else {
      // Legacy strict — INSERT/UPDATE sur user_vaults (PK sub).
      await env.DB.prepare(`
        INSERT INTO user_vaults (sub, ciphertext, iv, updated_at, size_bytes)
        VALUES (?, ?, ?, datetime('now'), ?)
        ON CONFLICT(sub) DO UPDATE SET
          ciphertext = excluded.ciphertext,
          iv         = excluded.iv,
          updated_at = excluded.updated_at,
          size_bytes = excluded.size_bytes
      `).bind(claims.sub, ciphertext, iv, plain.length).run();
    }
  } catch (e) {
    console.warn('[vault save] S4 branch threw, falling back to legacy', e?.message);
    await env.DB.prepare(`
      INSERT INTO user_vaults (sub, ciphertext, iv, updated_at, size_bytes)
      VALUES (?, ?, ?, datetime('now'), ?)
      ON CONFLICT(sub) DO UPDATE SET
        ciphertext = excluded.ciphertext,
        iv         = excluded.iv,
        updated_at = excluded.updated_at,
        size_bytes = excluded.size_bytes
    `).bind(claims.sub, ciphertext, iv, plain.length).run();
    scope = 'legacy_fallback';
  }

  return json({ ok: true, savedAt: new Date().toISOString(), scope }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// DELETE /api/vault/delete  (UX-3.5 — droit à l'oubli RGPD)
// ───────────────────────────────────────────────────────────────
// Supprime DÉFINITIVEMENT le profil cloud de l'utilisateur courant
// (PREFS_KEYS : prénom, photo, brouillons, paramètres outils, etc.).
// La clé de licence et l'auth restent intacts — c'est seulement
// l'hydratation du profil qui est purgée.
//
// On purge depuis les DEUX tables (legacy `user_vaults` + S4
// `user_vaults_email`) pour le même `sub` afin de couvrir tous
// les scopes possibles (legacy seul, S4 seul, ou les deux).
//
// Idempotent : un 2e appel sur un vault déjà vide renvoie ok=true
// avec deleted=0. Pas d'erreur.
// ═══════════════════════════════════════════════════════════════
export async function handleVaultDelete(request, env) {
  const origin = getAllowedOrigin(env, request);

  const claims = await requireJWT(request, env);
  if (!claims) return err('JWT invalide ou expiré', 401, origin);

  await ensureSchemaVaultV2(env);

  let deletedLegacy = 0;
  let deletedEmail  = 0;

  // 1. Purge legacy table (PK = sub)
  try {
    const r = await env.DB
      .prepare('DELETE FROM user_vaults WHERE sub = ?')
      .bind(claims.sub)
      .run();
    deletedLegacy = r.meta?.changes || 0;
  } catch (e) {
    console.warn('[vault delete] legacy purge failed:', e?.message);
  }

  // 2. Purge S4 scoped table (PK = (sub, email)) — toutes les rows
  //    de ce sub, quel que soit l'email scope.
  try {
    const r = await env.DB
      .prepare('DELETE FROM user_vaults_email WHERE sub = ?')
      .bind(claims.sub)
      .run();
    deletedEmail = r.meta?.changes || 0;
  } catch (e) {
    // Table peut ne pas exister en env legacy — non bloquant.
    console.warn('[vault delete] email purge failed:', e?.message);
  }

  // Audit : login event critique pour RGPD (preuve d'effacement)
  await audit(env, {
    action:   'vault_delete',
    actor:    _claimEmailIfValid(claims) || claims.sub,
    target:   claims.sub,
    tenantId: null,
    details:  { deleted_legacy: deletedLegacy, deleted_email: deletedEmail },
    request,
  });

  return json({
    ok: true,
    deleted: deletedLegacy + deletedEmail,
    detail:  { legacy: deletedLegacy, email: deletedEmail },
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/vault/health  (Sprint S4.4)
// ───────────────────────────────────────────────────────────────
// Renvoie un état non-sensible du vault de l'utilisateur courant.
// JAMAIS le ciphertext ni l'iv. Seulement la métadata : existence,
// taille, last-update, scope effectif (legacy/email), version schéma.
// Permet au frontend de détecter une migration manquée ou un état
// incohérent au boot et d'alerter (log discret, pas blocage).
// ═══════════════════════════════════════════════════════════════
export async function handleVaultHealth(request, env) {
  const origin = getAllowedOrigin(env, request);

  const claims = await requireJWT(request, env);
  if (!claims) return err('JWT invalide ou expiré', 401, origin);

  await ensureSchemaVaultV2(env);

  const email = _claimEmailIfValid(claims);
  const flagActive = email && await _isVaultEmailScopingEnabled(env, claims.sub);

  // Lectures parallèles, toutes en SELECT only (zéro write side-effect).
  const [emailRow, legacyRow, emailCountRow] = await Promise.all([
    email
      ? env.DB
          .prepare('SELECT updated_at, size_bytes FROM user_vaults_email WHERE sub = ? AND email = ? LIMIT 1')
          .bind(claims.sub, email)
          .first()
          .catch(() => null)
      : Promise.resolve(null),
    env.DB
      .prepare('SELECT updated_at, size_bytes FROM user_vaults WHERE sub = ? LIMIT 1')
      .bind(claims.sub)
      .first(),
    env.DB
      .prepare('SELECT COUNT(*) AS n FROM user_vaults_email WHERE sub = ?')
      .bind(claims.sub)
      .first()
      .catch(() => ({ n: 0 })),
  ]);

  // Détermine le scope effectif que load utiliserait :
  let effectiveScope;
  if (flagActive && emailRow) effectiveScope = 'email';
  else if (flagActive && legacyRow) effectiveScope = 'legacy_fallback';
  else if (legacyRow) effectiveScope = 'legacy';
  else effectiveScope = 'none';

  return json({
    ok:            true,
    schema_version: 's4.1',
    has_vault:     !!(emailRow || legacyRow),
    email_rows_count: emailCountRow?.n || 0,
    effective_scope: effectiveScope,
    flag_enforce_email: !!flagActive,
    email_present_in_jwt: !!email,
    email_row: emailRow ? {
      updated_at: emailRow.updated_at,
      size_bytes: emailRow.size_bytes,
    } : null,
    legacy_row: legacyRow ? {
      updated_at: legacyRow.updated_at,
      size_bytes: legacyRow.size_bytes,
    } : null,
  }, 200, origin);
}
