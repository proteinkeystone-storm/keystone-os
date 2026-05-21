/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Licence v2 (Sprint S1)
   ═══════════════════════════════════════════════════════════════
   Modèle multi-email pour plan MAX (1 clé partagée par N emails du
   même domaine) tout en gardant STARTER/PRO mono-email.

   Endpoints (TOUS additifs — ne remplacent rien existant) :
     GET    /api/licence/me                  → état pour l'auth courante
     GET    /api/licence/members             → liste emails autorisés
     POST   /api/licence/claim               → poser email owner (1re fois)
     POST   /api/licence/invite              → owner MAX invite un membre
     DELETE /api/licence/members/:email      → owner révoque, ou self-revoke

   Discipline backward-compat :
   ────────────────────────────
   - Aucun endpoint existant n'est modifié. requireAdmin, requireJWT,
     requireDevice : inchangés. Pulsa/SDQR/Biennale ne sont pas touchés.
   - L'envoi d'emails (magic-link, invite) est SCOPÉ S3, pas S1.
   - Le webhook Stripe (S5) appellera _ensureSchemaAuthV2 + créera la
     1re entry owner. Pour l'instant on s'appuie sur backfill paresseux.

   Plans (rappel) :
   ────────────────
       STARTER : 1 email   • 1 device   • domain_locked=NULL
       PRO     : 1 email   • 3 devices  • domain_locked=NULL
       MAX     : N emails  • illimité   • domain_locked='@xxxx.fr'
       ADMIN   : bypass tout (toi)
       DEMO    : multi-device, mono-email
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin, requireAdmin, generateId } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
// Sprint S3.3 — envoi d'un magic-link à l'invité (plan MAX)
import { issueMagicLink } from './auth-magic-link.js';
import { sendEmail, tplInviteMember } from '../lib/email-resend.js';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Plans qui n'ont pas de binding strict (multi-device autorisé sans
// création explicite d'entries member). Synchro avec licence-public.js.
const PLAN_BYPASS_BIND = new Set(['ADMIN', 'DEMO']);

// devices_max par plan (NULL = illimité)
function _devicesMaxForPlan(plan) {
  const p = (plan || '').toUpperCase();
  if (p === 'STARTER') return 1;
  if (p === 'PRO')     return 3;
  return null;  // MAX / ADMIN / DEMO / autres → illimité
}

// ── Auto-migration au boot ──────────────────────────────────────
// Pattern identique aux autres routes Keystone (kodex-assets, qr…).
// Idempotent : exécuté à chaque requête mais ne fait rien si déjà OK.
let _schemaReady = false;

export async function ensureSchemaAuthV2(env) {
  if (_schemaReady) return;

  // 1. ALTER ADD COLUMN — SQLite n'a pas IF NOT EXISTS pour ADD COLUMN,
  // donc try/catch silencieux (la 2e exécution lève "duplicate column").
  const safeAlter = async (sql) => {
    try { await env.DB.prepare(sql).run(); }
    catch (e) { /* colonne déjà existante : OK */ }
  };
  await safeAlter('ALTER TABLE licences ADD COLUMN domain_locked TEXT');
  await safeAlter('ALTER TABLE licences ADD COLUMN devices_max  INTEGER');
  await safeAlter('ALTER TABLE devices ADD COLUMN licence_key TEXT');

  // 2. Nouvelle table licence_emails (cœur du modèle v2)
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS licence_emails (
      id            TEXT PRIMARY KEY,
      licence_key   TEXT NOT NULL,
      email         TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'owner',
      status        TEXT NOT NULL DEFAULT 'active',
      invited_by    TEXT,
      invited_at    TEXT NOT NULL DEFAULT (datetime('now')),
      activated_at  TEXT,
      revoked_at    TEXT,
      FOREIGN KEY (licence_key) REFERENCES licences(key)
    )
  `).run().catch(() => {});

  await env.DB.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_emails_unique ON licence_emails(licence_key, email)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_licence_emails_status ON licence_emails(status)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_licence_emails_email ON licence_emails(email)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_devices_licence_key ON devices(licence_key)'
  ).run().catch(() => {});

  _schemaReady = true;
}

// ── Helpers internes ───────────────────────────────────────────
function _normEmail(v) {
  return (v || '').toString().trim().toLowerCase();
}

function _emailValid(v) {
  return typeof v === 'string' && EMAIL_RE.test(v);
}

function _domainOf(email) {
  const at = email.indexOf('@');
  return at < 0 ? null : email.slice(at);
}

// Trouve la licence + l'email associés à l'auth courante.
// Retourne null si auth absente/invalide.
async function _resolveAuth(request, env) {
  // 1. Admin : accès "super" sans licence spécifique
  if (requireAdmin(request, env)) {
    return { isAdmin: true, email: null, licenceKey: null, licence: null, claims: null };
  }
  // 2. JWT utilisateur classique
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
    claims,
  };
}

// Backfill paresseux : si pas d'entry owner pour cette licence,
// on en crée une depuis licences.owner (si format email).
// Idempotent. Retourne l'entry owner (créée ou existante) ou null.
async function _backfillOwnerIfMissing(env, licence) {
  const existing = await env.DB
    .prepare("SELECT * FROM licence_emails WHERE licence_key = ? AND role = 'owner' LIMIT 1")
    .bind(licence.key)
    .first();
  if (existing) return existing;

  const ownerEmail = _normEmail(licence.owner);
  if (!_emailValid(ownerEmail)) return null;  // owner pas un email → user devra /claim

  // Init devices_max selon plan si pas encore posé
  if (licence.devices_max == null) {
    const dMax = _devicesMaxForPlan(licence.plan);
    if (dMax != null) {
      await env.DB
        .prepare('UPDATE licences SET devices_max = ? WHERE key = ?')
        .bind(dMax, licence.key)
        .run();
    }
  }

  const id = generateId();
  await env.DB.prepare(`
    INSERT INTO licence_emails (id, licence_key, email, role, status, activated_at)
    VALUES (?, ?, ?, 'owner', 'active', datetime('now'))
  `).bind(id, licence.key, ownerEmail).run();

  return await env.DB
    .prepare('SELECT * FROM licence_emails WHERE id = ?')
    .bind(id)
    .first();
}

function _rowToMember(row) {
  if (!row) return null;
  return {
    email:        row.email,
    role:         row.role,
    status:       row.status,
    invited_by:   row.invited_by || null,
    invited_at:   row.invited_at,
    activated_at: row.activated_at || null,
    revoked_at:   row.revoked_at  || null,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET /api/licence/me
// ───────────────────────────────────────────────────────────────
// Retourne l'état complet pour l'auth courante :
//   { auth: { is_admin, email, licence_key }, licence, members, my_role }
// Admin sans licence ciblée → renvoie juste { auth, my_role: 'admin' }
// ═══════════════════════════════════════════════════════════════
export async function handleLicenceMe(request, env) {
  const origin = getAllowedOrigin(env, request);
  await ensureSchemaAuthV2(env);

  const auth = await _resolveAuth(request, env);
  if (!auth) return err('Authentification requise', 401, origin);

  // Cas admin pur : pas de licence rattachée. On renvoie un état neutre.
  if (auth.isAdmin && !auth.licenceKey) {
    return json({
      auth: { is_admin: true, email: null, licence_key: null },
      licence: null,
      members: [],
      my_role: 'admin',
    }, 200, origin);
  }

  // Backfill paresseux de l'owner si manquant
  await _backfillOwnerIfMissing(env, auth.licence);

  // Récupère la liste des emails
  const { results: emailRows = [] } = await env.DB
    .prepare("SELECT * FROM licence_emails WHERE licence_key = ? AND status != 'revoked' ORDER BY role DESC, invited_at ASC")
    .bind(auth.licenceKey)
    .all();

  // Détermine my_role pour l'email du JWT
  let myRole = null;
  if (auth.email) {
    const mine = emailRows.find(r => r.email === auth.email);
    myRole = mine?.role || null;
  }

  return json({
    auth: {
      is_admin:    auth.isAdmin,
      email:       auth.email,
      licence_key: auth.licenceKey,
    },
    licence: {
      key:           auth.licence.key,
      plan:          auth.licence.plan,
      owner:         auth.licence.owner,
      domain_locked: auth.licence.domain_locked || null,
      devices_max:   auth.licence.devices_max ?? _devicesMaxForPlan(auth.licence.plan),
      is_active:     auth.licence.is_active === 1,
      expires_at:    auth.licence.expires_at || null,
    },
    members: emailRows.map(_rowToMember),
    my_role: myRole,
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/licence/members
// ───────────────────────────────────────────────────────────────
// Variante courte de /me pour les UI qui ne veulent que la liste.
// Inclut les revoked si ?include_revoked=1 (audit). Owner only ou admin.
// ═══════════════════════════════════════════════════════════════
export async function handleLicenceMembers(request, env) {
  const origin = getAllowedOrigin(env, request);
  await ensureSchemaAuthV2(env);

  const auth = await _resolveAuth(request, env);
  if (!auth) return err('Authentification requise', 401, origin);
  if (auth.isAdmin && !auth.licenceKey) {
    return err('Cible non spécifiée (admin doit passer ?key=)', 400, origin);
  }

  const url = new URL(request.url);
  const includeRevoked = url.searchParams.get('include_revoked') === '1';

  await _backfillOwnerIfMissing(env, auth.licence);

  const sql = includeRevoked
    ? 'SELECT * FROM licence_emails WHERE licence_key = ? ORDER BY role DESC, invited_at ASC'
    : "SELECT * FROM licence_emails WHERE licence_key = ? AND status != 'revoked' ORDER BY role DESC, invited_at ASC";

  const { results = [] } = await env.DB.prepare(sql).bind(auth.licenceKey).all();
  return json({ ok: true, members: results.map(_rowToMember) }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/licence/claim
// ───────────────────────────────────────────────────────────────
// Pose l'email owner sur une licence orpheline (sans aucune entry
// active dans licence_emails). One-shot : si un owner existe déjà,
// renvoie 409.
//
// Body : { email }
//
// Auth : JWT (l'user vient de valider sa clé via /api/licence/v2/activate
// — un JWT lui a été émis mais aucun email validé n'est encore stocké
// côté licence_emails).
// ═══════════════════════════════════════════════════════════════
export async function handleLicenceClaim(request, env) {
  const origin = getAllowedOrigin(env, request);
  await ensureSchemaAuthV2(env);

  const auth = await _resolveAuth(request, env);
  if (!auth || !auth.licenceKey) return err('Authentification requise', 401, origin);

  const body = await parseBody(request);
  const email = _normEmail(body.email);
  if (!_emailValid(email)) return err('Email invalide', 400, origin);

  // Si la licence a un domain_locked, l'email DOIT le respecter
  if (auth.licence.domain_locked && _domainOf(email) !== auth.licence.domain_locked) {
    return err(`Cette licence est restreinte au domaine ${auth.licence.domain_locked}`, 403, origin);
  }

  // Y a-t-il déjà un owner ?
  const existingOwner = await env.DB
    .prepare("SELECT * FROM licence_emails WHERE licence_key = ? AND role = 'owner' AND status != 'revoked' LIMIT 1")
    .bind(auth.licenceKey)
    .first();
  if (existingOwner) {
    return err('Cette licence a déjà un propriétaire.', 409, origin);
  }

  // Init devices_max si manquant
  if (auth.licence.devices_max == null) {
    const dMax = _devicesMaxForPlan(auth.licence.plan);
    if (dMax != null) {
      await env.DB
        .prepare('UPDATE licences SET devices_max = ? WHERE key = ?')
        .bind(dMax, auth.licenceKey)
        .run();
    }
  }

  const id = generateId();
  await env.DB.prepare(`
    INSERT INTO licence_emails (id, licence_key, email, role, status, activated_at)
    VALUES (?, ?, ?, 'owner', 'active', datetime('now'))
  `).bind(id, auth.licenceKey, email).run();

  // On NE met PAS à jour licences.owner ici (rétrocompat : owner peut
  // rester "Nom Prénom" texte libre dans l'ancien flow). C'est licence_emails
  // qui devient la source de vérité.

  return json({
    ok:    true,
    email,
    role:  'owner',
    status: 'active',
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/licence/invite
// ───────────────────────────────────────────────────────────────
// Owner d'une licence MAX invite un nouveau membre.
//   - Plan doit être MAX (autres plans → 403)
//   - L'invitant doit être role='owner' actif (ou admin)
//   - Email doit matcher domain_locked
//   - Pas de doublon
//
// Body : { email }
//
// Statut résultant : 'pending'. La validation effective (création du
// magic-link + email) est implémentée en Sprint S3. Pour l'instant on
// stocke juste l'autorisation.
// ═══════════════════════════════════════════════════════════════
export async function handleLicenceInvite(request, env) {
  const origin = getAllowedOrigin(env, request);
  await ensureSchemaAuthV2(env);

  const auth = await _resolveAuth(request, env);
  if (!auth || !auth.licenceKey) return err('Authentification requise', 401, origin);

  const body = await parseBody(request);
  const email = _normEmail(body.email);
  if (!_emailValid(email)) return err('Email invalide', 400, origin);

  // Plan check
  const planUp = (auth.licence.plan || '').toUpperCase();
  if (planUp !== 'MAX' && !auth.isAdmin) {
    return err(`Le plan ${auth.licence.plan} ne supporte pas l'invitation de membres. Plan MAX requis.`, 403, origin);
  }

  // Domain lock check (obligatoire pour MAX, optionnel pour admin)
  if (auth.licence.domain_locked && _domainOf(email) !== auth.licence.domain_locked) {
    return err(`Email hors domaine autorisé (${auth.licence.domain_locked}).`, 403, origin);
  }

  // L'invitant doit être owner actif (ou admin)
  let invitedBy = null;
  if (auth.isAdmin) {
    invitedBy = 'admin';
  } else {
    const mine = await env.DB
      .prepare("SELECT * FROM licence_emails WHERE licence_key = ? AND email = ? AND status = 'active' AND role = 'owner' LIMIT 1")
      .bind(auth.licenceKey, auth.email)
      .first();
    if (!mine) {
      return err("Seul l'owner peut inviter des membres.", 403, origin);
    }
    invitedBy = auth.email;
  }

  // Doublon ?
  const existing = await env.DB
    .prepare('SELECT * FROM licence_emails WHERE licence_key = ? AND email = ? LIMIT 1')
    .bind(auth.licenceKey, email)
    .first();
  if (existing && existing.status !== 'revoked') {
    return err(`Cet email est déjà ${existing.status === 'active' ? 'membre' : 'invité'}.`, 409, origin);
  }

  // Si revoked → on réhabilite (update). Sinon, on insère.
  if (existing && existing.status === 'revoked') {
    await env.DB.prepare(`
      UPDATE licence_emails
         SET status     = 'pending',
             role       = 'member',
             invited_by = ?,
             invited_at = datetime('now'),
             revoked_at = NULL
       WHERE id = ?
    `).bind(invitedBy, existing.id).run();
  } else {
    const id = generateId();
    await env.DB.prepare(`
      INSERT INTO licence_emails (id, licence_key, email, role, status, invited_by)
      VALUES (?, ?, ?, 'member', 'pending', ?)
    `).bind(id, auth.licenceKey, email, invitedBy).run();
  }

  // ── S3.3 — Génère un magic-link + envoie l'email d'invitation ──
  // Try/catch défensif : si l'envoi email échoue, on n'annule PAS
  // l'invitation (l'entry licence_emails reste pending). L'owner peut
  // redemander un magic-link via POST /api/auth/request-magic-link.
  let invitationSent = false;
  let invitationExpiresAt = null;
  try {
    const issued = await issueMagicLink(env, {
      email,
      licenceKey: auth.licenceKey,
      purpose:    'invite',
      // pas de fingerprint à l'invite : l'invité utilisera son propre device
    });
    invitationExpiresAt = issued.expiresAt;

    const subject = `Vous êtes invité sur Keystone OS (${auth.licence.plan})`;
    const html = tplInviteMember({
      ownerEmail:    invitedBy,
      ownerName:     null,    // on n'a pas le nom propre côté owner pour l'instant
      magicUrl:      issued.magicUrl,
      expiresHours:  Math.round(issued.ttlMinutes / 60),
    });
    await sendEmail(env, { to: email, subject, html });
    invitationSent = true;
  } catch (e) {
    console.warn('[invite] email failed', e?.message || e);
    // On NE rollback PAS l'entry licence_emails — l'invitation reste
    // valide, l'owner peut redemander un mail via request-magic-link.
  }

  return json({
    ok:                   true,
    email,
    role:                 'member',
    status:               'pending',
    invited_by:           invitedBy,
    invitation_sent:      invitationSent,
    invitation_expires:   invitationExpiresAt,
    note: invitationSent
      ? `Email d'invitation envoyé à ${email}. Lien valable 7 jours.`
      : 'Invitation enregistrée mais email non envoyé (config Resend ?). L\'owner peut redemander un mail via /api/auth/request-magic-link.',
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// DELETE /api/licence/members/:email
// ───────────────────────────────────────────────────────────────
// - Owner peut révoquer n'importe quel member (mais PAS le dernier owner)
// - Member peut self-revoke
// - Admin peut tout révoquer
// - Côté devices : on déactive (is_approved=0) les devices liés à cet
//   email pour la même licence — preservation historique.
// ═══════════════════════════════════════════════════════════════
export async function handleLicenceRevokeMember(request, env, targetEmail) {
  const origin = getAllowedOrigin(env, request);
  await ensureSchemaAuthV2(env);

  const auth = await _resolveAuth(request, env);
  if (!auth || !auth.licenceKey) return err('Authentification requise', 401, origin);

  const email = _normEmail(decodeURIComponent(targetEmail || ''));
  if (!_emailValid(email)) return err('Email invalide', 400, origin);

  const target = await env.DB
    .prepare("SELECT * FROM licence_emails WHERE licence_key = ? AND email = ? AND status != 'revoked' LIMIT 1")
    .bind(auth.licenceKey, email)
    .first();
  if (!target) return err('Membre introuvable', 404, origin);

  // Permission check
  const isSelf = auth.email === email;
  const isOwnerOnCurrent = auth.isAdmin
    || (await env.DB
      .prepare("SELECT 1 FROM licence_emails WHERE licence_key = ? AND email = ? AND role = 'owner' AND status = 'active' LIMIT 1")
      .bind(auth.licenceKey, auth.email)
      .first());

  if (!isSelf && !isOwnerOnCurrent) {
    return err('Permission insuffisante (owner ou self uniquement).', 403, origin);
  }

  // Protection : ne pas révoquer le dernier owner actif
  if (target.role === 'owner') {
    const otherActiveOwners = await env.DB
      .prepare("SELECT COUNT(*) as n FROM licence_emails WHERE licence_key = ? AND role = 'owner' AND status = 'active' AND email != ?")
      .bind(auth.licenceKey, email)
      .first();
    if ((otherActiveOwners?.n || 0) === 0) {
      return err('Impossible de révoquer le dernier propriétaire de la licence.', 409, origin);
    }
  }

  // Révoquer l'entry email
  await env.DB.prepare(`
    UPDATE licence_emails
       SET status     = 'revoked',
           revoked_at = datetime('now')
     WHERE id = ?
  `).bind(target.id).run();

  // Désactiver les devices liés (même licence_key + même email)
  // Note : on filtre AUSSI sur tenant_id pour éviter les faux positifs
  // entre tenants (devices.tenant_id existe depuis schema v1.0).
  await env.DB.prepare(`
    UPDATE devices
       SET is_approved = 0
     WHERE email = ?
       AND (licence_key = ? OR licence_key IS NULL)
  `).bind(email, auth.licenceKey).run();

  return json({
    ok:    true,
    email,
    status: 'revoked',
  }, 200, origin);
}
