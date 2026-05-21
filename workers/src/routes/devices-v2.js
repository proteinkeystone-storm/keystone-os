/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Devices v2 (Sprint S2)
   ═══════════════════════════════════════════════════════════════
   Endpoints CENTRÉS LICENCE/EMAIL — différents du device.js v1
   (qui est centré sur le flow B2B tablette terrain).

   Routes ADDITIVES, n'altèrent rien :
     GET    /api/licence/devices         → liste pour l'auth courante
     DELETE /api/licence/devices/:id     → soft revoke (is_approved=0)

   Helper exporté pour usage par d'autres modules (S2.5+, S3) :
     countActiveDevices(env, { licenceKey, email, tenantId })
       → nombre de devices actifs pour ce couple, fallback tenant si
         licence_key NULL (cas legacy pré-S1).

   Backward compat stricte :
   - Aucun helper auth touché (requireDevice / requireAdmin / requireJWT)
   - Le DELETE est un SOFT revoke (UPDATE is_approved=0), à ne PAS
     confondre avec le DELETE physique de POST /api/device/revoke v1
     (qui reste fonctionnel).
   - Une licence sans owner dans licence_emails est tolérée → admin
     uniquement.

   Sécurité — permissions :
     ┌─────────┬──────────────────────┬──────────────────────────┐
     │ Auth    │ GET devices          │ DELETE :id               │
     ├─────────┼──────────────────────┼──────────────────────────┤
     │ admin   │ tout (filtre ?key=…) │ tout                     │
     │ owner   │ toute sa licence     │ tous les devices/licence │
     │ member  │ ses propres devices  │ ses propres devices      │
     │ aucun   │ 401                  │ 401                      │
     └─────────┴──────────────────────┴──────────────────────────┘

   ⚠️ S2 ne modifie PAS handleActivateV2 (création de devices reste
   inchangée). L'enforcement effectif de licences.devices_max via
   countActiveDevices viendra dans un sprint séparé S2.5, après
   audit complet de licence-public.js (route critique pour Stripe).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { requireJWT }                                from '../lib/jwt.js';
import { ensureSchemaAuthV2 }                        from './licence-v2.js';

// ── Helpers communs ─────────────────────────────────────────────
function _normEmail(v) {
  return (v || '').toString().trim().toLowerCase();
}

// Résout l'auth courante en { isAdmin, email, licenceKey, licence }.
// Ne fait PAS de backfill — c'est licence-v2.js qui s'en charge via
// /api/licence/me. Ici, on lit l'état tel quel.
async function _resolveAuth(request, env) {
  if (requireAdmin(request, env)) {
    return { isAdmin: true, email: null, licenceKey: null, licence: null };
  }
  const claims = await requireJWT(request, env);
  if (!claims?.sub) return null;

  const licence = await env.DB
    .prepare('SELECT * FROM licences WHERE lookup_hmac = ?')
    .bind(claims.sub)
    .first();
  if (!licence) return null;

  return {
    isAdmin:    !!claims.isAdmin,
    email:      _normEmail(claims.email || licence.owner),
    licenceKey: licence.key,
    licence,
  };
}

// Détermine le role de l'auth courante sur sa licence courante.
// 'owner' | 'member' | null. Pas applicable pour admin pur.
async function _myRoleOnLicence(env, auth) {
  if (!auth || auth.isAdmin || !auth.licenceKey || !auth.email) return null;
  const row = await env.DB
    .prepare("SELECT role FROM licence_emails WHERE licence_key = ? AND email = ? AND status = 'active' LIMIT 1")
    .bind(auth.licenceKey, auth.email)
    .first();
  return row?.role || null;
}

// ═══════════════════════════════════════════════════════════════
// Helper exporté : countActiveDevices
// ───────────────────────────────────────────────────────────────
// Compte les devices actifs (is_approved=1) pour un couple
// (licence_key, email). Si licenceKey est manquant, fallback sur
// le couple (tenant_id, email) — utile pour les devices legacy
// créés avant la migration S1 (devices.licence_key = NULL).
// ═══════════════════════════════════════════════════════════════
export async function countActiveDevices(env, { licenceKey, email, tenantId } = {}) {
  const e = _normEmail(email);
  if (!e) return 0;

  // Cas nominal post-S1 : licence_key explicite
  if (licenceKey) {
    const row = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM devices WHERE licence_key = ? AND email = ? AND is_approved = 1')
      .bind(licenceKey, e)
      .first();
    const n = row?.n || 0;

    // Bonus rétrocompat : si 0 trouvés par licence_key, on cherche aussi
    // les devices legacy (licence_key NULL) avec même email + même tenant.
    // À S2.5 on les migrera ; pour l'instant on les compte.
    if (n === 0 && tenantId) {
      const legacy = await env.DB
        .prepare('SELECT COUNT(*) AS n FROM devices WHERE licence_key IS NULL AND email = ? AND tenant_id = ? AND is_approved = 1')
        .bind(e, tenantId)
        .first();
      return (legacy?.n || 0);
    }
    return n;
  }

  // Cas legacy pur : pas de licence_key → tenant + email
  if (tenantId) {
    const row = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM devices WHERE email = ? AND tenant_id = ? AND is_approved = 1')
      .bind(e, tenantId)
      .first();
    return row?.n || 0;
  }

  return 0;
}

// Mappe un row DB vers la forme exposée par l'API.
function _rowToDevice(row) {
  if (!row) return null;
  return {
    id:           row.id,
    label:        row.label,
    type:         row.type,
    email:        row.email,
    licence_key:  row.licence_key || null,
    tenant_id:    row.tenant_id,
    is_approved:  row.is_approved === 1,
    approved_by:  row.approved_by || null,
    last_seen:    row.last_seen   || null,
    created_at:   row.created_at,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET /api/licence/devices
// ───────────────────────────────────────────────────────────────
// Liste les devices visibles par l'auth courante.
//
// Query params (optionnels) :
//   ?licence_key=KSTN-XXXX  (admin uniquement, pour cibler une licence)
//   ?email=foo@bar.com      (admin/owner pour filtrer, member ignoré)
//   ?include_inactive=1     (inclut is_approved=0)
//
// Visibilité :
//   - admin           → tout
//   - owner (licence) → tous les devices de sa licence
//   - member          → seulement ses propres devices
// ═══════════════════════════════════════════════════════════════
export async function handleListDevices(request, env) {
  const origin = getAllowedOrigin(env, request);
  await ensureSchemaAuthV2(env);

  const auth = await _resolveAuth(request, env);
  if (!auth) return err('Authentification requise', 401, origin);

  const url = new URL(request.url);
  const qLicenceKey  = url.searchParams.get('licence_key') || null;
  const qEmail       = _normEmail(url.searchParams.get('email') || '');
  const includeInactive = url.searchParams.get('include_inactive') === '1';

  // Détermine la portée
  let targetLicenceKey = null;
  let restrictToEmail  = null;

  if (auth.isAdmin) {
    targetLicenceKey = qLicenceKey;          // null = tout
    restrictToEmail  = qEmail || null;
  } else {
    targetLicenceKey = auth.licenceKey;      // toujours la licence du JWT
    const myRole = await _myRoleOnLicence(env, auth);
    if (myRole === 'owner') {
      // Owner voit tout sa licence ; peut filtrer par email
      restrictToEmail = qEmail || null;
    } else {
      // Member (ou pas encore claim) → vue limitée à soi
      restrictToEmail = auth.email;
    }
  }

  // Construit la requête dynamiquement (whitelist stricte des conditions)
  const where = [];
  const binds = [];

  if (targetLicenceKey) {
    // licence_key match OU (legacy : licence_key NULL et tenant_id match)
    // Note : on a besoin de tenant_id si on veut le fallback legacy.
    // Pour rester simple, on ne fait QUE licence_key ici. Les devices
    // legacy (licence_key NULL) sont exclus volontairement de la liste
    // licence-scoped — ils seront migrés en S2.5.
    where.push('licence_key = ?');
    binds.push(targetLicenceKey);
  }
  if (restrictToEmail) {
    where.push('email = ?');
    binds.push(restrictToEmail);
  }
  if (!includeInactive) {
    where.push('is_approved = 1');
  }

  let sql = 'SELECT id, tenant_id, label, type, email, licence_key, is_approved, approved_by, last_seen, created_at FROM devices';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT 200';

  const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
  const { results = [] } = await stmt.all();

  // Stats utiles côté UI (ex : "X / N devices utilisés")
  const devices_max_for_target = targetLicenceKey
    ? (await env.DB.prepare('SELECT devices_max FROM licences WHERE key = ? LIMIT 1').bind(targetLicenceKey).first())?.devices_max ?? null
    : null;

  return json({
    ok:           true,
    scope: {
      licence_key:        targetLicenceKey,
      restrict_to_email:  restrictToEmail,
      include_inactive:   includeInactive,
    },
    devices_max:  devices_max_for_target,
    count:        results.length,
    devices:      results.map(_rowToDevice),
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// DELETE /api/licence/devices/:id
// ───────────────────────────────────────────────────────────────
// Soft revoke : UPDATE devices SET is_approved=0.
// On NE supprime PAS la ligne (audit RGPD + possibilité de réactivation
// par admin sans demander au user de re-register).
//
// Permissions :
//   - admin  → tout
//   - owner  → tout device de sa licence
//   - member → uniquement ses propres devices (auth.email === device.email)
// ═══════════════════════════════════════════════════════════════
export async function handleRevokeDevice(request, env, deviceId) {
  const origin = getAllowedOrigin(env, request);
  await ensureSchemaAuthV2(env);

  const auth = await _resolveAuth(request, env);
  if (!auth) return err('Authentification requise', 401, origin);

  if (!deviceId || typeof deviceId !== 'string') {
    return err('ID device invalide', 400, origin);
  }

  const device = await env.DB
    .prepare('SELECT * FROM devices WHERE id = ?')
    .bind(deviceId)
    .first();
  if (!device) return err('Device introuvable', 404, origin);
  if (!device.is_approved) {
    return json({ ok: true, id: deviceId, status: 'already_revoked' }, 200, origin);
  }

  // Permission check
  let allowed = false;
  if (auth.isAdmin) {
    allowed = true;
  } else if (auth.licenceKey) {
    const sameLicence = device.licence_key === auth.licenceKey;
    const sameTenant  = !device.licence_key && device.tenant_id === auth.licence?.tenant_id; // legacy
    const isMyDevice  = _normEmail(device.email) === auth.email;

    if (isMyDevice) {
      // Member peut révoquer ses propres devices
      allowed = (sameLicence || sameTenant);
    } else {
      // Non-self → seul l'owner peut
      const myRole = await _myRoleOnLicence(env, auth);
      if (myRole === 'owner' && (sameLicence || sameTenant)) {
        allowed = true;
      }
    }
  }

  if (!allowed) {
    return err('Permission insuffisante.', 403, origin);
  }

  // Soft revoke
  await env.DB
    .prepare("UPDATE devices SET is_approved = 0, last_seen = datetime('now') WHERE id = ?")
    .bind(deviceId)
    .run();

  return json({
    ok:     true,
    id:     deviceId,
    status: 'revoked',
    soft:   true,
    note:   'Device désactivé (is_approved=0). Réactivation possible via /api/device/approve.',
  }, 200, origin);
}
