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

import { json, err, getAllowedOrigin, requireAdmin, generateId, generateToken } from '../lib/auth.js';
import { requireJWT }                                from '../lib/jwt.js';
import { ensureSchemaAuthV2 }                        from './licence-v2.js';

// ── Auto-migration Sprint S2.5 (enforcement devices_max) ────────
// Ajoute les colonnes/index nécessaires à l'enforcement effectif
// de licences.devices_max via enforceDeviceLimit(). Pattern try/catch
// sur les ALTER (SQLite n'a pas IF NOT EXISTS pour ADD COLUMN).
let _enforceSchemaReady = false;
async function _ensureSchemaEnforce(env) {
  if (_enforceSchemaReady) return;
  const safeAlter = async (sql) => {
    try { await env.DB.prepare(sql).run(); }
    catch (e) { /* colonne déjà existante : OK */ }
  };
  // Flag par licence — par défaut 0 (off), à activer par licence test :
  //   UPDATE licences SET enforce_devices_v2 = 1 WHERE key = '...'
  await safeAlter('ALTER TABLE licences ADD COLUMN enforce_devices_v2 INTEGER DEFAULT 0');
  // Fingerprint pour matcher un device existant lors de re-activations
  await safeAlter('ALTER TABLE devices ADD COLUMN fingerprint TEXT');
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_devices_fingerprint_v2 ON devices(licence_key, email, fingerprint)'
  ).run().catch(() => {});
  _enforceSchemaReady = true;
}

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

// ═══════════════════════════════════════════════════════════════
// enforceDeviceLimit — helper appelé par handleActivateV2 (S2.5)
// ───────────────────────────────────────────────────────────────
// Vérifie + enregistre un device pour le couple (licence, email).
//
// Algo :
//   1. Si licence.enforce_devices_v2 !== 1 → { mode: 'legacy_skip' } (caller
//      doit continuer son flow legacy fingerprint binding).
//   2. Plan ADMIN/DEMO → { mode: 'bypass' } (multi-device illimité).
//   3. Cherche un device existant pour (licence_key, email, fingerprint).
//      - Si trouvé → UPDATE last_seen + retourne { mode: 'reused', device }.
//      - Sinon → compte les devices actifs distincts (par fingerprint) pour
//        ce couple (licence, email) :
//        - Si count >= devices_max → 409 enrichi { mode: 'denied',
//          devicesMax, existingDevices, suggestion }.
//        - Sinon → INSERT new device row, retourne { mode: 'created', device }.
//
// Effets de bord :
//   - Crée/update une row dans devices (avec fingerprint, label auto,
//     token random unique).
//   - NE modifie PAS licences.device_fingerprint (laissé pour rétrocompat
//     du flow legacy ; handleActivateV2 le maintient explicitement
//     en parallèle si besoin).
//
// Retour :
//   { mode: 'legacy_skip' | 'bypass' | 'reused' | 'created' | 'denied',
//     device?: row,
//     devicesMax?: number,
//     existingDevices?: [...],
//     suggestion?: string }
//
// Cohérence avec countActiveDevices : on compte les fingerprints
// DISTINCTS pour ne pas compter 2 rows si le user a refait /activate
// sans avoir fait DELETE avant (cas malheureux : double création).
// ═══════════════════════════════════════════════════════════════
export async function enforceDeviceLimit(env, { licence, email, fingerprint } = {}) {
  if (!licence || !licence.key) {
    return { mode: 'legacy_skip', reason: 'no_licence' };
  }

  // Flag par licence — par défaut off
  if (licence.enforce_devices_v2 !== 1) {
    return { mode: 'legacy_skip', reason: 'flag_off' };
  }

  // Plans bypass binding (cohérent avec licence-public.js bypassBind)
  const planUp = (licence.plan || '').toUpperCase();
  if (planUp === 'ADMIN' || planUp === 'DEMO') {
    return { mode: 'bypass', reason: 'plan_bypass' };
  }

  const e = _normEmail(email);
  const fp = (fingerprint || '').toString().trim();
  if (!e) return { mode: 'legacy_skip', reason: 'no_email' };
  if (!fp || fp.length < 16) return { mode: 'legacy_skip', reason: 'no_fingerprint' };

  await _ensureSchemaEnforce(env);

  // 1. Cherche un device existant pour ce fingerprint
  const existing = await env.DB
    .prepare('SELECT * FROM devices WHERE licence_key = ? AND email = ? AND fingerprint = ? LIMIT 1')
    .bind(licence.key, e, fp)
    .first();

  if (existing) {
    // Réactivation depuis le même device → on rafraîchit last_seen, ré-approuve
    // (au cas où le device avait été soft-revoke entre temps).
    await env.DB
      .prepare("UPDATE devices SET is_approved = 1, last_seen = datetime('now') WHERE id = ?")
      .bind(existing.id)
      .run();
    return {
      mode:   'reused',
      device: { ..._rowToDevice(existing), is_approved: true },
    };
  }

  // 2. Nouveau device. Compte les fingerprints distincts actifs pour ce couple.
  const countRow = await env.DB
    .prepare(`
      SELECT COUNT(DISTINCT fingerprint) AS n
        FROM devices
       WHERE licence_key = ? AND email = ?
         AND is_approved = 1
         AND fingerprint IS NOT NULL
    `)
    .bind(licence.key, e)
    .first();
  const activeCount = countRow?.n || 0;

  const devicesMax = Number(licence.devices_max || 0) || null;

  if (devicesMax && activeCount >= devicesMax) {
    // Récupère la liste pour aider le user à choisir lequel révoquer
    const { results: deviceRows = [] } = await env.DB
      .prepare(`
        SELECT id, label, type, last_seen, created_at
          FROM devices
         WHERE licence_key = ? AND email = ?
           AND is_approved = 1
         ORDER BY last_seen DESC NULLS LAST, created_at DESC
         LIMIT 20
      `)
      .bind(licence.key, e)
      .all();

    return {
      mode:            'denied',
      devicesMax,
      activeCount,
      existingDevices: deviceRows.map(_rowToDevice),
      suggestion:      `Limite atteinte pour ${e} (${devicesMax} device${devicesMax > 1 ? 's' : ''} max). Révoquez un device existant via DELETE /api/licence/devices/:id puis ré-activez.`,
    };
  }

  // 3. INSERT nouveau device
  const id = generateId();
  const token = generateToken(32);
  const label = `Web ${new Date().toISOString().slice(0, 10)}`;
  await env.DB.prepare(`
    INSERT INTO devices (id, tenant_id, label, type, email, token, is_approved, licence_key, fingerprint, last_seen)
    VALUES (?, ?, ?, 'web', ?, ?, 1, ?, ?, datetime('now'))
  `).bind(
    id,
    licence.tenant_id || 'default',
    label,
    e,
    token,
    licence.key,
    fp,
  ).run();

  const inserted = await env.DB
    .prepare('SELECT * FROM devices WHERE id = ?')
    .bind(id)
    .first();

  return {
    mode:   'created',
    device: _rowToDevice(inserted),
  };
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
