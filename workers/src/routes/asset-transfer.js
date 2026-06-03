/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Livrer un asset à un client (Sprint « Livrer » V1)
   ───────────────────────────────────────────────────────────────
   Réassigne la PROPRIÉTÉ d'un asset fabriqué par l'admin (Stéphane)
   vers le tenant d'une licence cliente, désignée par EMAIL.

   Périmètre V1 (décisions Stéphane 2026-06-03) :
   ────────────────────────────────────────────────
     • Transfert DESTRUCTIF (l'asset quitte le dashboard admin). Pas
       de gabarit-clone (« il part, sans option gabarit »).
     • Key Form : on PURGE les réponses déjà collectées au transfert
       (le frontend propose l'export CSV AVANT). Les réponses ne
       voyagent JAMAIS vers le client.
     • PAS de supervision/co-visibilité en V1 (reporté V1.5). Aucune
       colonne supervisor_tenant.

   Modèles de propriété (vérifiés cette session) :
   ────────────────────────────────────────────────
     • QR     : entities.tenant_id (PK COMPOSITE tenant_id,type,id)
                + qr_redirects.tenant_id (PK short_id).
                Les DEUX portent le tenant → réassignés ensemble.
                qr_scans est indexé par short_id → stats préservées.
     • KeyForm: pulsa_forms.owner_sub (= lookup_hmac). Les réponses
                (pulsa_responses) n'ont PAS de propriétaire propre :
                elles sont rattachées au form_id et l'accès passe par
                la propriété du formulaire → flipper owner_sub donne
                AUTOMATIQUEMENT les réponses au client. D'où la purge.

   Valeur de tenant cible = licences.lookup_hmac de la licence cliente
   (identique au claims.sub du JWT client → l'asset apparaît chez lui).

   Sécurité :
   ────────────
     • Gate FLEXIBLE : KS_ADMIN_SECRET (depuis /admin) OU claim JWT
       isAdmin (depuis /app, où l'admin n'a que ks_jwt — cf.
       conventions_keystone). Un non-admin → 403, quoi qu'il arrive.
     • Licence cible doit EXISTER + être ACTIVE.
     • Audit log systématique (action='asset_transfer').

   Route :  POST /api/admin/asset/transfer
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { blindIndex } from '../lib/kdf.js';
import { audit }      from '../lib/audit.js';

// Type d'asset → pad/outil correspondant (pour l'avertissement de
// réception : le client ne verra l'asset que si son plan inclut l'outil).
export const TOOL_BY_TYPE = {
  qr:      'A-COM-001',   // Smart Dynamic QR
  keyform: 'A-COM-004',   // Key Form
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ═══════════════════════════════════════════════════════════════
// LOGIQUE PURE (testable sans D1, sans réseau) — cf.
// scripts/test-asset-transfer.mjs, câblé dans `npm test`.
// ═══════════════════════════════════════════════════════════════

/**
 * Valide le body de la requête de transfert. Aucune I/O.
 * @returns {{ok:true, type, id, email, dryRun} | {ok:false, status, msg}}
 */
export function validateTransferInput(body) {
  const type = (body?.type || '').toString().trim().toLowerCase();
  if (type !== 'qr' && type !== 'keyform') {
    return { ok: false, status: 400, msg: 'type invalide (attendu : "qr" ou "keyform")' };
  }
  const id = (body?.id || '').toString().trim();
  if (!id) return { ok: false, status: 400, msg: 'id de l\'asset requis' };

  const email = (body?.target_email || '').toString().trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, status: 400, msg: 'email du client invalide' };
  }
  const dryRun = body?.dry_run === true || body?.dry_run === 1 || body?.dry_run === '1';
  return { ok: true, type, id, email, dryRun };
}

/**
 * Calcule les avertissements de réception, sans I/O.
 * - already_owned   : l'asset appartient déjà au tenant cible (no-op).
 * - plan_excludes_tool : owned_assets est une liste qui n'inclut PAS
 *   l'outil → le client ne verra pas l'asset (piège owned_assets).
 *   owned_assets = null ⇒ accès TOTAL (MAX/ADMIN/Stripe) ⇒ aucun warning.
 *
 * @param {object}   p
 * @param {?Array}   p.ownedAssets   — array d'IDs ou null
 * @param {string}   p.toolId        — pad id de l'outil (TOOL_BY_TYPE)
 * @param {?string}  p.currentTenant
 * @param {?string}  p.targetTenant
 * @returns {string[]}
 */
export function computeReceptionWarnings({ ownedAssets, toolId, currentTenant, targetTenant }) {
  const warnings = [];
  if (currentTenant && targetTenant && currentTenant === targetTenant) {
    warnings.push('already_owned');
  }
  if (Array.isArray(ownedAssets) && toolId && !ownedAssets.includes(toolId)) {
    warnings.push('plan_excludes_tool');
  }
  return warnings;
}

// ═══════════════════════════════════════════════════════════════
// Helpers DB (non purs)
// ═══════════════════════════════════════════════════════════════

// Gate admin flexible : secret admin OU claim JWT isAdmin.
// Retourne { ok, actor } — actor sert l'audit log.
async function _requireAdminFlexible(request, env) {
  if (requireAdmin(request, env)) return { ok: true, actor: 'admin' };
  const claims = await requireJWT(request, env).catch(() => null);
  if (claims?.isAdmin === true) {
    return { ok: true, actor: claims.email || claims.sub || 'admin-jwt' };
  }
  return { ok: false };
}

function _safeParseArray(s) {
  if (s == null) return null;          // null = accès total (sémantique owned_assets)
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

// Résout la licence cliente depuis un email.
// 1. Modèle v2 multi-email (licence_emails actif) — prioritaire.
// 2. Fallback legacy : licences.owner == email.
// Préfère une licence active, puis la plus récente.
async function _resolveLicenceByEmail(env, email) {
  const viaEmails = await env.DB.prepare(`
    SELECT l.* FROM licences l
      JOIN licence_emails le ON le.licence_key = l.key
     WHERE le.email = ? AND le.status = 'active'
     ORDER BY l.is_active DESC, l.created_at DESC
     LIMIT 1
  `).bind(email).first().catch(() => null);
  if (viaEmails) return viaEmails;

  return await env.DB.prepare(`
    SELECT * FROM licences
     WHERE LOWER(owner) = ?
     ORDER BY is_active DESC, created_at DESC
     LIMIT 1
  `).bind(email).first().catch(() => null);
}

// Garantit lookup_hmac sur la licence (backfill idempotent, comme
// handleAdminIssueJWT). Retourne le hmac ou null si pepper absent.
async function _ensureLookupHmac(env, licence) {
  if (licence.lookup_hmac) return licence.lookup_hmac;
  if (!env.KS_LOOKUP_PEPPER) return null;
  const sub = await blindIndex(licence.key, env.KS_LOOKUP_PEPPER);
  try {
    await env.DB
      .prepare('UPDATE licences SET lookup_hmac = ? WHERE key = ? AND lookup_hmac IS NULL')
      .bind(sub, licence.key)
      .run();
  } catch (_) { /* best-effort */ }
  return sub;
}

// Charge un QR (entity type='qr_codes') par son id, tous tenants
// confondus (l'admin transfère un asset qu'il possède). Retourne aussi
// le tenant courant + le short_id (pour qr_redirects).
async function _loadQr(env, id) {
  const row = await env.DB.prepare(
    `SELECT tenant_id, data FROM entities
      WHERE id = ? AND type = 'qr_codes' AND deleted_at IS NULL
      LIMIT 1`
  ).bind(id).first();
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch {}
  return {
    currentTenant: row.tenant_id,
    shortId: data.short_id || null,
    name: data.label || data.name || data.title || data.short_id || id,
  };
}

async function _loadKeyForm(env, id) {
  const row = await env.DB.prepare(
    'SELECT id, owner_sub, tenant_id, title, slug FROM pulsa_forms WHERE id = ? LIMIT 1'
  ).bind(id).first();
  if (!row) return null;
  const cnt = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM pulsa_responses WHERE form_id = ?')
    .bind(id).first().catch(() => ({ n: 0 }));
  return {
    currentTenant: row.owner_sub,
    name: row.title || row.slug || id,
    responseCount: cnt?.n || 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/asset/transfer
// ───────────────────────────────────────────────────────────────
// Body : { type:'qr'|'keyform', id, target_email, dry_run? }
//   dry_run=true → résout + valide + renvoie le récap (nom asset,
//   propriétaire cible, plan, avertissements, nb réponses à purger)
//   SANS rien muter. Sert la confirmation récapitulative côté UI.
// ═══════════════════════════════════════════════════════════════
export async function handleAssetTransfer(request, env) {
  const origin = getAllowedOrigin(env, request);

  // 1. Gate admin (secret OU JWT isAdmin). Non-admin → 403.
  const gate = await _requireAdminFlexible(request, env);
  if (!gate.ok) return err('Réservé à l\'administrateur', 403, origin);

  // 2. Validation du body (pure)
  const body = await parseBody(request);
  const v = validateTransferInput(body);
  if (!v.ok) return err(v.msg, v.status, origin);
  const { type, id, email, dryRun } = v;

  // 3. Résolution de la licence cliente par email
  const licence = await _resolveLicenceByEmail(env, email);
  if (!licence) {
    return err(`Aucune licence trouvée pour ${email}. Vérifie l'email ou crée d'abord la licence du client.`, 404, origin);
  }
  if (licence.is_active !== 1) {
    return err(`La licence de ${email} n'est pas active. Réactive-la avant de livrer.`, 409, origin);
  }
  const targetTenant = await _ensureLookupHmac(env, licence);
  if (!targetTenant) {
    return err('Serveur : impossible de résoudre le tenant cible (KS_LOOKUP_PEPPER manquant).', 500, origin);
  }

  // 4. Chargement de l'asset (selon type) + récap
  const toolId = TOOL_BY_TYPE[type];
  let assetInfo, currentTenant;
  if (type === 'qr') {
    assetInfo = await _loadQr(env, id);
    if (!assetInfo) return err('QR introuvable.', 404, origin);
    currentTenant = assetInfo.currentTenant;
  } else {
    assetInfo = await _loadKeyForm(env, id);
    if (!assetInfo) return err('Key Form introuvable.', 404, origin);
    currentTenant = assetInfo.currentTenant;
  }

  const warnings = computeReceptionWarnings({
    ownedAssets:  _safeParseArray(licence.owned_assets),
    toolId,
    currentTenant,
    targetTenant,
  });

  const target = {
    email,
    owner:       licence.owner || null,
    plan:        licence.plan || null,
    licence_key: licence.key,
  };
  const recap = {
    ok: true,
    asset: {
      type,
      id,
      name:      assetInfo.name,
      short_id:  type === 'qr' ? (assetInfo.shortId || null) : undefined,
      response_count: type === 'keyform' ? assetInfo.responseCount : undefined,
    },
    target,
    warnings,
  };

  // 5. dry_run → récap seul, AUCUNE mutation
  if (dryRun) {
    return json({ ...recap, dry_run: true }, 200, origin);
  }

  // 6. Garde-fou no-op : déjà chez ce client
  if (warnings.includes('already_owned')) {
    return err('Cet asset appartient déjà à ce client.', 409, origin);
  }

  // 7. Mutation atomique (D1 batch = transaction)
  let responsesPurged = 0;
  if (type === 'qr') {
    const stmts = [
      env.DB.prepare(
        `UPDATE entities SET tenant_id = ?, updated_at = datetime('now')
          WHERE tenant_id = ? AND type = 'qr_codes' AND id = ?`
      ).bind(targetTenant, currentTenant, id),
    ];
    // QR statique : pas de short_id, pas de ligne qr_redirects.
    if (assetInfo.shortId) {
      stmts.push(
        env.DB.prepare(
          `UPDATE qr_redirects SET tenant_id = ?, updated_at = datetime('now')
            WHERE short_id = ?`
        ).bind(targetTenant, assetInfo.shortId)
      );
    }
    await env.DB.batch(stmts);
  } else {
    responsesPurged = assetInfo.responseCount;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE pulsa_forms SET owner_sub = ?, tenant_id = ?, updated_at = datetime('now')
          WHERE id = ?`
      ).bind(targetTenant, targetTenant, id),
      // Purge des réponses : elles ne voyagent JAMAIS vers le client.
      env.DB.prepare('DELETE FROM pulsa_responses WHERE form_id = ?').bind(id),
    ]);
  }

  // 8. Audit
  await audit(env, {
    action:   'asset_transfer',
    actor:    gate.actor,
    target:   id,
    tenantId: targetTenant,
    details: {
      type,
      asset_name:       assetInfo.name,
      short_id:         type === 'qr' ? (assetInfo.shortId || null) : undefined,
      from_tenant:      currentTenant,
      to_tenant:        targetTenant,
      to_email:         email,
      to_licence_key:   licence.key,
      to_plan:          licence.plan || null,
      responses_purged: type === 'keyform' ? responsesPurged : undefined,
      warnings,
    },
    request,
  });

  return json({
    ok: true,
    transferred: true,
    asset: recap.asset,
    target,
    warnings,
    responses_purged: type === 'keyform' ? responsesPurged : undefined,
  }, 200, origin);
}
