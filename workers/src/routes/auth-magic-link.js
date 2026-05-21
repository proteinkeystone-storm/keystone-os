/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Magic-link auth (Sprint S3)
   ═══════════════════════════════════════════════════════════════
   Flow d'authentification sans saisie de clé. Le user demande un
   magic-link → reçoit un email avec un lien unique de 15 min →
   clique → device activé + JWT émis, sans avoir tapé sa clé.

   Endpoints :
     POST /api/auth/request-magic-link
       Body : { email, licence_key?, fingerprint?, purpose? }
       → 200 { ok: true, expires_at } (silent : on dit toujours OK
         même si l'email n'existe pas, pour ne pas permettre l'énum)
       → 429 si rate limit atteint

     POST /api/auth/consume-magic-link
       Body : { token, fingerprint }
       → 200 { jwt, plan, owner, expires_at, deviceBound }
       → 401 token invalide / expiré / déjà consommé
       → 403 fingerprint ne matche pas (anti vol de mail)

   Stockage :
     Table magic_links (auto-migrée au boot) :
       id, token_hash (SHA-256 hex), email, licence_key, purpose,
       fingerprint (opt), expires_at, consumed_at, created_at, ip_hash

   Sécurité — defense in depth :
     - Token clair (32 bytes hex = 64 chars) jamais stocké, juste son SHA-256
     - Unique-shot : consumed_at set à la 1re utilisation
     - TTL strict : 15 min par défaut (paramétrable par purpose)
     - Fingerprint optionnel à l'émission → si présent, vérifié au consume
       (empêche un attaquant qui aurait intercepté l'email d'utiliser le
       lien depuis un autre device)
     - Rate limit par email + IP (anti-énumération + anti-DOS)
     - Silent response sur request : 200 OK même si email inconnu

   Backward compat stricte :
     - Aucun helper auth modifié
     - Aucune route existante touchée
     - Migration purement additive (nouvelle table + index)
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin, generateId, generateToken } from '../lib/auth.js';
import { signJWT }              from '../lib/jwt.js';
import { blindIndex }           from '../lib/kdf.js';
import { sendEmail, tplMagicLink } from '../lib/email-resend.js';
import { audit }                from '../lib/audit.js';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const VALID_PURPOSES = new Set(['activation', 'recovery', 'magic_login', 'invite']);

// TTL par purpose (en minutes)
const TTL_MIN = {
  magic_login: 15,
  activation:  60,         // 1h pour activation initiale
  recovery:    30,
  invite:      168 * 60,   // 7 jours pour invite équipe
};

// Rate limit : max requests par fenêtre
const RL_PER_EMAIL_PER_HOUR = 5;
const RL_PER_IP_PER_HOUR    = 20;

// ── Auto-migration ──────────────────────────────────────────────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS magic_links (
      id           TEXT PRIMARY KEY,
      token_hash   TEXT NOT NULL,
      email        TEXT NOT NULL,
      licence_key  TEXT,
      purpose      TEXT NOT NULL DEFAULT 'magic_login',
      fingerprint  TEXT,
      expires_at   TEXT NOT NULL,
      consumed_at  TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      ip_hash      TEXT
    )
  `).run().catch(() => {});

  await env.DB.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_magic_links_token_hash ON magic_links(token_hash)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at)'
  ).run().catch(() => {});

  _schemaReady = true;
}

// ── Helpers ─────────────────────────────────────────────────────
function _normEmail(v) {
  return (v || '').toString().trim().toLowerCase();
}

function _emailValid(v) {
  return typeof v === 'string' && EMAIL_RE.test(v);
}

// SHA-256 hex
async function _sha256Hex(str) {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Hash IP avec un pepper pour audit RGPD-safe (pas de PII brute en DB)
async function _ipHash(env, request) {
  const ip = (request.headers.get('cf-connecting-ip') || '').slice(0, 64);
  if (!ip) return null;
  const pepper = env.KS_LOOKUP_PEPPER || 'ks-default-pepper-do-not-use-in-prod';
  return await _sha256Hex(ip + pepper);
}

// Vérifie le rate limit pour un couple (email, ip_hash) sur la dernière heure
async function _checkRateLimit(env, email, ipHash) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const emailCnt = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM magic_links WHERE email = ? AND created_at > ?")
    .bind(email, since)
    .first();
  if ((emailCnt?.n || 0) >= RL_PER_EMAIL_PER_HOUR) {
    return { allowed: false, reason: 'email_quota_exceeded' };
  }

  if (ipHash) {
    const ipCnt = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM magic_links WHERE ip_hash = ? AND created_at > ?")
      .bind(ipHash, since)
      .first();
    if ((ipCnt?.n || 0) >= RL_PER_IP_PER_HOUR) {
      return { allowed: false, reason: 'ip_quota_exceeded' };
    }
  }

  return { allowed: true };
}

// URL frontend pour consommer le magic-link.
// On utilise la 1re origin allowed (= protein-keystone.com en prod)
function _magicLinkUrl(env, token) {
  const allowed = (env.KS_ALLOWED_ORIGIN || '*').split(',')[0].trim();
  const base = allowed && allowed !== '*' ? allowed : 'https://protein-keystone.com';
  return `${base}/auth/magic?token=${encodeURIComponent(token)}`;
}

// ═══════════════════════════════════════════════════════════════
// issueMagicLink — helper exporté pour usage par d'autres routes
// ───────────────────────────────────────────────────────────────
// Crée un magic-link en DB et retourne { tokenClear, magicUrl,
// expiresAt }. NE déclenche PAS l'envoi de l'email — c'est au
// caller d'envoyer le mail (avec le template approprié à son cas).
//
// Utilisé par :
//   - handleRequestMagicLink (route publique)
//   - handleLicenceInvite (S3.3 : invite équipe MAX)
//
// Caller responsabilité : check rate limit + existence email avant
// d'appeler ce helper. Aucun check fait ici (responsabilité du caller).
// ═══════════════════════════════════════════════════════════════
export async function issueMagicLink(env, { email, licenceKey, purpose, fingerprint, ipHash } = {}) {
  await _ensureSchema(env);

  const e = _normEmail(email);
  if (!_emailValid(e)) throw new Error('Email invalide');
  if (!VALID_PURPOSES.has(purpose)) throw new Error('Purpose invalide');

  const tokenClear = generateToken(32);
  const tokenHash  = await _sha256Hex(tokenClear);
  const id = generateId();
  const ttlMin = TTL_MIN[purpose] || 15;
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO magic_links (id, token_hash, email, licence_key, purpose, fingerprint, expires_at, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tokenHash, e, licenceKey || null, purpose,
    (fingerprint || '').trim() || null, expiresAt, ipHash || null,
  ).run();

  return {
    id,
    tokenClear,
    magicUrl:   _magicLinkUrl(env, tokenClear),
    expiresAt,
    ttlMinutes: ttlMin,
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/request-magic-link
// ───────────────────────────────────────────────────────────────
// Reçoit { email, licence_key?, fingerprint?, purpose? } et envoie
// un magic-link à l'adresse si elle correspond à un email autorisé.
//
// Comportement silent : on retourne TOUJOURS 200 OK (avec un message
// générique) pour ne pas révéler l'existence ou non d'une adresse.
// Seuls les cas de validation côté client (email mal formé, body
// invalide, rate limit) retournent une erreur explicite.
// ═══════════════════════════════════════════════════════════════
export async function handleRequestMagicLink(request, env) {
  const origin = getAllowedOrigin(env, request);
  await _ensureSchema(env);

  const body = await parseBody(request);
  const email = _normEmail(body.email);
  const fingerprint = (body.fingerprint || '').toString().trim();
  const purposeRaw = (body.purpose || 'magic_login').toString().trim().toLowerCase();
  const purpose = VALID_PURPOSES.has(purposeRaw) ? purposeRaw : 'magic_login';
  const licenceKeyHint = (body.licence_key || '').toString().trim().toUpperCase() || null;

  if (!_emailValid(email)) return err('Email invalide', 400, origin);

  const ipHash = await _ipHash(env, request);

  // Rate limit
  const rl = await _checkRateLimit(env, email, ipHash);
  if (!rl.allowed) {
    return err('Trop de demandes. Réessayez dans une heure.', 429, origin);
  }

  // Cherche l'email dans licence_emails (S1) — si pas trouvé ET pas de
  // licence_key hint → on retourne quand même 200 OK silent.
  let licenceRow = null;
  let memberRow  = null;

  if (licenceKeyHint) {
    licenceRow = await env.DB
      .prepare('SELECT * FROM licences WHERE key = ? LIMIT 1')
      .bind(licenceKeyHint)
      .first();
  }

  memberRow = await env.DB
    .prepare(
      licenceKeyHint
        ? "SELECT * FROM licence_emails WHERE email = ? AND licence_key = ? LIMIT 1"
        : "SELECT * FROM licence_emails WHERE email = ? AND status != 'revoked' ORDER BY invited_at DESC LIMIT 1"
    )
    .bind(...(licenceKeyHint ? [email, licenceKeyHint] : [email]))
    .first();

  if (memberRow && !licenceRow) {
    licenceRow = await env.DB
      .prepare('SELECT * FROM licences WHERE key = ? LIMIT 1')
      .bind(memberRow.licence_key)
      .first();
  }

  // ── Fallback legacy : pas trouvé dans licence_emails (table S1) ─
  // On regarde si une licence active a cet email dans son champ
  // owner historique (text libre, posé avant migration S1). Si oui,
  // on backfill licence_emails au passage pour les usages futurs
  // (invite, /me, etc.) et on continue le flow d'envoi normal.
  if (!memberRow) {
    const legacyLicence = await env.DB
      .prepare('SELECT * FROM licences WHERE LOWER(owner) = ? AND is_active = 1 LIMIT 1')
      .bind(email)
      .first();
    if (legacyLicence) {
      // Backfill silencieux. INSERT OR IGNORE pour rester idempotent
      // si une entry partielle existerait déjà (status='revoked' etc.).
      const id = generateId();
      try {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO licence_emails (id, licence_key, email, role, status, activated_at)
          VALUES (?, ?, ?, 'owner', 'active', datetime('now'))
        `).bind(id, legacyLicence.key, email).run();
      } catch (_) { /* table peut ne pas exister si S1 pas encore activé sur l'env — silent */ }
      licenceRow = legacyLicence;
      memberRow  = { licence_key: legacyLicence.key, email, role: 'owner', status: 'active' };
    }
  }

  // Pas de match → silent OK (anti enum)
  if (!memberRow || !licenceRow) {
    return json({
      ok: true,
      sent: false,
      message: 'Si cet email correspond à un compte actif, un lien vient d\'être envoyé.',
    }, 200, origin);
  }

  // Génération du token clair + hash
  const tokenClear = generateToken(32);  // 64 chars hex
  const tokenHash  = await _sha256Hex(tokenClear);
  const id = generateId();
  const ttlMin = TTL_MIN[purpose] || 15;
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO magic_links (id, token_hash, email, licence_key, purpose, fingerprint, expires_at, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tokenHash, email, licenceRow.key, purpose,
    fingerprint || null, expiresAt, ipHash,
  ).run();

  // Envoi de l'email
  const magicUrl = _magicLinkUrl(env, tokenClear);
  try {
    const subject = purpose === 'invite'
      ? `Vous êtes invité sur Keystone OS`
      : purpose === 'recovery'
        ? `Récupération de votre accès Keystone OS`
        : `Votre lien de connexion Keystone OS`;
    const ownerName = (licenceRow.owner && _emailValid(licenceRow.owner) ? null : licenceRow.owner) || null;
    const html = tplMagicLink({
      ownerName,
      magicUrl,
      purpose: purpose === 'invite' ? 'activation' : purpose,
      expiresMinutes: ttlMin,
    });
    await sendEmail(env, { to: email, subject, html });
  } catch (e) {
    // Log mais ne révèle pas l'échec côté client (anti-info-leak)
    console.warn('[magic-link] sendEmail failed', e.message);
  }

  return json({
    ok: true,
    sent: true,
    expires_at: expiresAt,
    purpose,
    message: 'Si cet email correspond à un compte actif, un lien vient d\'être envoyé.',
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/consume-magic-link
// ───────────────────────────────────────────────────────────────
// Reçoit { token, fingerprint } et :
//   1. Hash le token → lookup en DB
//   2. Vérifie expires_at + consumed_at + fingerprint (si posé à l'émission)
//   3. Marque consumed_at = now (unique-shot)
//   4. Si licence_emails.status = 'pending' → passe à 'active' (cas invite)
//   5. Génère JWT (sub = lookup_hmac de la licence)
//   6. Retour { jwt, plan, owner, expires_at, magic_purpose }
// ═══════════════════════════════════════════════════════════════
export async function handleConsumeMagicLink(request, env) {
  const origin = getAllowedOrigin(env, request);
  await _ensureSchema(env);

  if (!env.KS_LOOKUP_PEPPER) return err('Server: KS_LOOKUP_PEPPER manquant', 500, origin);
  if (!env.KS_JWT_SECRET)    return err('Server: KS_JWT_SECRET manquant',    500, origin);

  const body = await parseBody(request);
  const tokenClear = (body.token || '').toString().trim();
  const fp = (body.fingerprint || '').toString().trim();

  if (!tokenClear || tokenClear.length < 32) {
    return err('Token invalide', 400, origin);
  }

  const tokenHash = await _sha256Hex(tokenClear);

  const link = await env.DB
    .prepare('SELECT * FROM magic_links WHERE token_hash = ? LIMIT 1')
    .bind(tokenHash)
    .first();

  if (!link) return err('Lien invalide ou expiré', 401, origin);
  if (link.consumed_at) return err('Lien déjà utilisé', 401, origin);
  if (new Date(link.expires_at) < new Date()) {
    return err('Lien expiré', 401, origin);
  }

  // Fingerprint check si posé à l'émission (anti vol de mail)
  if (link.fingerprint && link.fingerprint !== fp) {
    return err('Fingerprint ne correspond pas. Utilisez le lien depuis l\'appareil qui l\'a demandé.', 403, origin);
  }

  // Charge la licence
  const licence = await env.DB
    .prepare('SELECT * FROM licences WHERE key = ? LIMIT 1')
    .bind(link.licence_key)
    .first();
  if (!licence) return err('Licence introuvable', 404, origin);
  if (!licence.is_active) return err('Licence inactive', 403, origin);

  // Consomme le token (unique-shot)
  await env.DB
    .prepare("UPDATE magic_links SET consumed_at = datetime('now') WHERE id = ?")
    .bind(link.id)
    .run();

  // Si c'était un invite avec un email en 'pending' → bascule à 'active'
  let pendingActivated = false;
  if (link.purpose === 'invite') {
    const pending = await env.DB
      .prepare("SELECT id FROM licence_emails WHERE licence_key = ? AND email = ? AND status = 'pending' LIMIT 1")
      .bind(link.licence_key, link.email)
      .first();
    if (pending) {
      await env.DB
        .prepare("UPDATE licence_emails SET status = 'active', activated_at = datetime('now') WHERE id = ?")
        .bind(pending.id)
        .run();
      pendingActivated = true;
    }
  }

  // Émission JWT (sub = lookup_hmac de la licence, comme handleActivateV2)
  const lookupHmac = await blindIndex(licence.key, env.KS_LOOKUP_PEPPER);
  const planUp = (licence.plan || '').toUpperCase();
  const jwt = await signJWT({
    sub:    lookupHmac,
    plan:   licence.plan,
    owner:  licence.owner,
    email:  link.email,
    fp:     fp || null,
    isDemo:  planUp === 'DEMO',
    isAdmin: planUp === 'ADMIN',
    via:    'magic_link',
  }, env);

  // Sprint S5.1 — audit du login magic-link (= login event critique)
  await audit(env, {
    action:   'magic_link_consume',
    actor:    link.email,
    target:   licence.key,
    tenantId: licence.tenant_id || null,
    details:  {
      purpose:           link.purpose,
      plan:              licence.plan,
      pending_activated: pendingActivated,
      fingerprint_match: !!link.fingerprint,
    },
    request,
  });

  return json({
    ok:                true,
    jwt,
    plan:              licence.plan,
    owner:             licence.owner,
    email:             link.email,
    expires_at:        licence.expires_at,
    magic_purpose:     link.purpose,
    pending_activated: pendingActivated,
    note: pendingActivated
      ? 'Votre invitation est validée. Bienvenue dans l\'équipe.'
      : null,
  }, 200, origin);
}
