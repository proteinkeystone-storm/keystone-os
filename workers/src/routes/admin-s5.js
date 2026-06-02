/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Admin enrichies (Sprint S5.3)
   ═══════════════════════════════════════════════════════════════
   Endpoints additifs côté admin pour piloter les feature flags
   (S2.5, S4) et exposer l'audit log aux outils admin (UI S5.4).

   Routes :
     GET  /api/admin/licences           → liste enrichie + stats
     POST /api/admin/licences/:key/flag → toggle d'un flag
     GET  /api/admin/audit              → audit log paginé
     POST /api/admin/expiration-reminders/run-now
                                        → trigger manuel du cron S5.2

   Backward compat stricte :
   - Aucun endpoint legacy modifié.
   - /api/licence/list (admin) reste actif côté licence.js.
   - Helper requireAdmin inchangé.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { audit }                                                 from '../lib/audit.js';
import { signJWT }                                                from '../lib/jwt.js';
import { blindIndex }                                             from '../lib/kdf.js';
import { handleExpirationReminders }                             from './expiration-reminders.js';

const EMAIL_RE_ADMIN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Whitelist stricte des flags togglables. Si un autre flag apparaît
// un jour, l'ajouter explicitement ici (= contrôle d'accès au schéma).
const TOGGLABLE_FLAGS = new Set([
  'enforce_devices_v2',           // S2.5
  'enforce_vault_per_email_v2',   // S4
  'enforce_ai_credits_v1',        // Chantier B — crédits IA (Sprint 1-2)
]);

// ── Auto-migration locale (hotfix 22/05) ─────────────────────────
// Garantit que les colonnes flag S2.5/S4 existent côté D1 avant le
// SELECT enrichi. Les helpers d'origine (_ensureSchemaEnforce dans
// devices-v2.js et ensureSchemaVaultV2 dans vault-user.js) ne sont
// déclenchés qu'au 1er call de leur route respective ; si personne
// n'a touché vault depuis S4 en prod, la colonne S4 manque encore
// et le SELECT throw → banner "Mode legacy" intempestif.
// Idempotent (try/catch silent), zéro risque même si déjà appliqué.
let _adminS5SchemaReady = false;
async function _ensureSchemaForAdminS5(env) {
  if (_adminS5SchemaReady) return;
  try {
    await env.DB.prepare('ALTER TABLE licences ADD COLUMN enforce_devices_v2 INTEGER DEFAULT 0').run();
  } catch (_) { /* colonne déjà ajoutée, ok */ }
  try {
    await env.DB.prepare('ALTER TABLE licences ADD COLUMN enforce_vault_per_email_v2 INTEGER DEFAULT 0').run();
  } catch (_) { /* colonne déjà ajoutée, ok */ }
  try {
    await env.DB.prepare('ALTER TABLE licences ADD COLUMN enforce_ai_credits_v1 INTEGER DEFAULT 0').run();
  } catch (_) { /* colonne déjà ajoutée, ok */ }
  _adminS5SchemaReady = true;
}

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/licences
// ───────────────────────────────────────────────────────────────
// Liste enrichie : colonnes legacy + stats (devices count, emails
// count, audit count, has_flags). Conçue pour alimenter l'UI admin
// enrichie (S5.4 demain).
//
// Query params optionnels :
//   ?active=true|false      — filtre is_active
//   ?plan=STARTER|PRO|MAX   — filtre par plan
//   ?limit=N                — pagination (default 200, max 500)
// ═══════════════════════════════════════════════════════════════
export async function handleListLicencesEnriched(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  await _ensureSchemaForAdminS5(env);

  const url    = new URL(request.url);
  const fActive = url.searchParams.get('active'); // 'true' | 'false' | null
  const fPlan   = (url.searchParams.get('plan') || '').toUpperCase().trim() || null;
  const limitRaw = parseInt(url.searchParams.get('limit') || '200', 10);
  const limit   = Math.min(Math.max(isNaN(limitRaw) ? 200 : limitRaw, 1), 500);

  const where = [];
  const binds = [];
  if (fActive === 'true')  where.push('is_active = 1');
  if (fActive === 'false') where.push('is_active = 0');
  if (fPlan) {
    where.push('UPPER(COALESCE(plan, \'\')) = ?');
    binds.push(fPlan);
  }

  let sql = `
    SELECT key, tenant_id, owner, plan, is_active, owned_assets, expires_at,
           created_at, updated_at, domain_locked, devices_max,
           enforce_devices_v2, enforce_vault_per_email_v2, enforce_ai_credits_v1
      FROM licences
  `;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ` ORDER BY created_at DESC LIMIT ${limit}`;

  const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
  const { results: rows = [] } = await stmt.all();

  // Stats par licence — exécution en parallèle pour rester rapide.
  // Toutes les sous-queries sont des COUNT(*) sur des index existants.
  const enriched = await Promise.all(rows.map(async (lic) => {
    const [devicesActive, emailsActive, auditCount] = await Promise.all([
      env.DB
        .prepare('SELECT COUNT(*) AS n FROM devices WHERE licence_key = ? AND is_approved = 1')
        .bind(lic.key)
        .first()
        .catch(() => ({ n: 0 })),
      env.DB
        .prepare("SELECT COUNT(*) AS n FROM licence_emails WHERE licence_key = ? AND status = 'active'")
        .bind(lic.key)
        .first()
        .catch(() => ({ n: 0 })),
      env.DB
        .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE target = ? AND ts > datetime('now', '-30 days')")
        .bind(lic.key)
        .first()
        .catch(() => ({ n: 0 })),
    ]);

    return {
      key:                 lic.key,
      tenant_id:           lic.tenant_id,
      owner:               lic.owner,
      plan:                lic.plan,
      is_active:           lic.is_active === 1,
      owned_assets:        lic.owned_assets ? safeJSON(lic.owned_assets) : null,
      expires_at:          lic.expires_at || null,
      created_at:          lic.created_at,
      updated_at:          lic.updated_at,
      domain_locked:       lic.domain_locked || null,
      devices_max:         lic.devices_max ?? null,
      flags: {
        enforce_devices_v2:         lic.enforce_devices_v2 === 1,
        enforce_vault_per_email_v2: lic.enforce_vault_per_email_v2 === 1,
        enforce_ai_credits_v1:      lic.enforce_ai_credits_v1 === 1,
      },
      stats: {
        devices_active:    devicesActive?.n || 0,
        emails_active:     emailsActive?.n || 0,
        audit_30d:         auditCount?.n   || 0,
      },
    };
  }));

  return json({
    total:   enriched.length,
    filters: { active: fActive, plan: fPlan, limit },
    licences: enriched,
  }, 200, origin);
}

function safeJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/licences/:key/flag
// ───────────────────────────────────────────────────────────────
// Body : { flag: 'enforce_devices_v2' | 'enforce_vault_per_email_v2',
//          value: 0 | 1 }
//
// Whitelist stricte des flags (cf. TOGGLABLE_FLAGS).
// Audit log de chaque toggle pour traçabilité (qui a flagged quand).
// ═══════════════════════════════════════════════════════════════
export async function handleToggleLicenceFlag(request, env, licenceKey) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  await _ensureSchemaForAdminS5(env);

  if (!licenceKey || typeof licenceKey !== 'string') {
    return err('Clé licence invalide', 400, origin);
  }
  const key = licenceKey.toUpperCase().trim();

  const body = await parseBody(request);
  const flag = (body.flag || '').toString().trim();
  const value = body.value === 1 || body.value === true || body.value === '1' ? 1 : 0;

  if (!TOGGLABLE_FLAGS.has(flag)) {
    return err(`Flag invalide. Whitelist : ${Array.from(TOGGLABLE_FLAGS).join(', ')}`, 400, origin);
  }

  // Vérifie l'existence de la licence
  const existing = await env.DB
    .prepare('SELECT key, plan, tenant_id, ' + flag + ' AS current_value FROM licences WHERE key = ? LIMIT 1')
    .bind(key)
    .first();
  if (!existing) return err('Licence introuvable', 404, origin);

  const previousValue = existing.current_value === 1 ? 1 : 0;
  if (previousValue === value) {
    return json({ ok: true, key, flag, value, noop: true }, 200, origin);
  }

  // UPDATE prudent — on n'utilise que le nom du flag whitelisté, pas
  // de string concat user input direct (= pas d'injection possible).
  await env.DB
    .prepare(`UPDATE licences SET ${flag} = ?, updated_at = datetime('now') WHERE key = ?`)
    .bind(value, key)
    .run();

  await audit(env, {
    action:   'licence_flag_toggle',
    target:   key,
    tenantId: existing.tenant_id || null,
    details:  { flag, previous: previousValue, value, plan: existing.plan },
    request,
  });

  return json({ ok: true, key, flag, previous: previousValue, value }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/audit
// ───────────────────────────────────────────────────────────────
// Liste paginée de l'audit log. Filtres optionnels.
//
// Query params :
//   ?action=licence_revoke    — filtre par action exact
//   ?target=KSTN-XXXX         — filtre par target exact
//   ?tenant=default           — filtre par tenant
//   ?since=2026-05-01         — date min (datetime ISO)
//   ?limit=N                  — default 100, max 500
// ═══════════════════════════════════════════════════════════════
export async function handleAuditList(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const url = new URL(request.url);
  const fAction = (url.searchParams.get('action') || '').trim() || null;
  const fTarget = (url.searchParams.get('target') || '').trim() || null;
  const fTenant = (url.searchParams.get('tenant') || '').trim() || null;
  const fSince  = (url.searchParams.get('since')  || '').trim() || null;
  const limitRaw = parseInt(url.searchParams.get('limit') || '100', 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 100 : limitRaw, 1), 500);

  const where = [];
  const binds = [];
  if (fAction) { where.push('action = ?');    binds.push(fAction); }
  if (fTarget) { where.push('target = ?');    binds.push(fTarget); }
  if (fTenant) { where.push('tenant_id = ?'); binds.push(fTenant); }
  if (fSince)  { where.push('ts >= ?');       binds.push(fSince); }

  let sql = 'SELECT id, ts, action, actor, target, tenant_id, details, ip FROM audit_logs';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ` ORDER BY ts DESC LIMIT ${limit}`;

  let rows = [];
  try {
    const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
    const res = await stmt.all();
    rows = res.results || [];
  } catch (e) {
    // Table peut-être absente (ensureSchema audit pas encore appelé)
    return json({ total: 0, filters: { action: fAction, target: fTarget, tenant: fTenant, since: fSince, limit }, entries: [] }, 200, origin);
  }

  const entries = rows.map(r => ({
    id:        r.id,
    ts:        r.ts,
    action:    r.action,
    actor:     r.actor || null,
    target:    r.target || null,
    tenant_id: r.tenant_id || null,
    details:   r.details ? safeJSON(r.details) : null,
    ip_known:  !!r.ip,
  }));

  return json({
    total:   entries.length,
    filters: { action: fAction, target: fTarget, tenant: fTenant, since: fSince, limit },
    entries,
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/issue-jwt  (Sprint S5.6 — Admin login unifié)
// ───────────────────────────────────────────────────────────────
// Émet un JWT utilisateur lié à la 1ère licence ADMIN active, pour
// que l'admin (déjà authentifié via ks_admin_token) puisse activer
// le Cloud Vault sync cross-device.
//
// Sans cet endpoint, le login /admin posait UNIQUEMENT ks_admin_token,
// jamais ks_jwt → cloud-vault.js retournait { hydrated: false, reason:
// 'no-jwt' } → aucune sync entre Mac/iPad/iPhone pour les admins.
//
// Sécurité :
//   - requireAdmin obligatoire (= il faut déjà avoir ks_admin_token)
//   - JWT lié à la VRAIE licence ADMIN en DB, pas à un sub forgé
//   - Backfill lookup_hmac sur les licences legacy (= migration douce)
//   - Audit log de chaque émission pour traçabilité
// ═══════════════════════════════════════════════════════════════
export async function handleAdminIssueJWT(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  if (!env.KS_JWT_SECRET)    return err('Server: KS_JWT_SECRET manquant',    500, origin);
  if (!env.KS_LOOKUP_PEPPER) return err('Server: KS_LOOKUP_PEPPER manquant', 500, origin);

  // Trouve la 1ère licence ADMIN active. On prend la plus ancienne pour
  // garder un sub stable dans le temps (= le même JWT après chaque login).
  const adminLicence = await env.DB
    .prepare(`
      SELECT * FROM licences
       WHERE UPPER(COALESCE(plan, '')) = 'ADMIN'
         AND is_active = 1
       ORDER BY created_at ASC
       LIMIT 1
    `)
    .first();
  if (!adminLicence) return err('Aucune licence ADMIN active trouvée', 404, origin);

  // Backfill lookup_hmac si manquant (licence legacy). Idempotent.
  let sub = adminLicence.lookup_hmac;
  if (!sub) {
    sub = await blindIndex(adminLicence.key, env.KS_LOOKUP_PEPPER);
    try {
      await env.DB
        .prepare('UPDATE licences SET lookup_hmac = ? WHERE key = ? AND lookup_hmac IS NULL')
        .bind(sub, adminLicence.key)
        .run();
    } catch (_) { /* best-effort, le JWT marche même si UPDATE échoue */ }
  }

  // Email du JWT : on prend owner s'il matche un email valide, sinon null.
  // Cohérent avec le claim S4 (cf. vault-user.js _claimEmailIfValid).
  const ownerLower = (adminLicence.owner || '').toString().trim().toLowerCase();
  const emailClaim = EMAIL_RE_ADMIN.test(ownerLower) ? ownerLower : null;

  const jwt = await signJWT({
    sub,
    plan:    'ADMIN',
    owner:   adminLicence.owner,
    email:   emailClaim,
    isAdmin: true,
    via:     'admin_login',
  }, env);

  await audit(env, {
    action:   'admin_jwt_issued',
    actor:    'admin',
    target:   adminLicence.key,
    tenantId: adminLicence.tenant_id || null,
    details:  { has_email: !!emailClaim, owner_was_legacy: !adminLicence.lookup_hmac },
    request,
  });

  return json({
    ok:    true,
    jwt,
    plan:  'ADMIN',
    owner: adminLicence.owner,
    email: emailClaim,
    licence_key: adminLicence.key,  // utile pour debug côté frontend
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/expiration-reminders/run-now
// ───────────────────────────────────────────────────────────────
// Déclenche manuellement le cron S5.2 sans attendre 3h UTC. Utile
// pour valider la sélection de licences (avec kill-switch off,
// renvoie un résumé sans envoyer). Côté kill-switch on, envoie
// vraiment les emails (idempotence garantie par licence_reminder_log).
// ═══════════════════════════════════════════════════════════════
export async function handleExpirationRemindersRunNow(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

  const summary = await handleExpirationReminders(env);

  await audit(env, {
    action:  'expiration_reminders_run_now',
    target:  'manual_trigger',
    details: summary,
    request,
  });

  return json({ ok: true, summary }, 200, origin);
}
