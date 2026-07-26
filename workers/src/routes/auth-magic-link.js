/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Magic-link auth (Sprint S3, durci AUTH-1→4)
   ═══════════════════════════════════════════════════════════════
   Flow d'authentification sans saisie de clé. Le user demande un
   magic-link → reçoit un email avec un lien unique + un CODE à
   6 chiffres → confirme (bouton côté front, jamais d'auto-consume)
   → device activé + JWT émis.

   Endpoints :
     POST /api/auth/request-magic-link
       Body : { email, licence_key?, fingerprint?, purpose? }
       → 200 { ok: true } TOUJOURS (même email inconnu, même rate
         limit atteint) — réponse indistinguable, anti-énumération.

     POST /api/auth/consume-magic-link
       Body : { token, fingerprint }
       → 200 { jwt, plan, owner, expires_at }
       → 401 token invalide / expiré / déjà consommé
       → 403 fingerprint ne matche pas (anti vol de mail)

     POST /api/auth/consume-otp                    (AUTH-2)
       Body : { email, code, fingerprint }
       → 200 { jwt, … } — chemin cross-device : le fingerprint
         mismatch est AUDITÉ mais pas bloquant (c'est le chemin
         « demandé sur desktop, ouvert sur mobile »).
       → 401 code faux / expiré (générique)
       → 423 verrouillé après 5 tentatives

   Stockage :
     magic_links : id, token_hash, otp_hash, otp_attempts, email,
       licence_key, purpose, fingerprint, expires_at, consumed_at,
       created_at, ip_hash
     auth_request_log : TOUTES les demandes (email connu ou non) —
       le rate limit compte ICI, sinon seul un email existant peut
       atteindre le quota et l'endpoint devient un oracle.

   Sécurité — defense in depth :
     - Token clair (32 bytes hex) jamais stocké, juste son SHA-256
     - Code OTP 6 chiffres CSPRNG, hashé SHA-256(id:code:pepper),
       5 tentatives max par lien
     - Consommation ANTI-COURSE : UPDATE gardé (consumed_at IS NULL)
       + vérif meta.changes — le JWT n'est émis que si NOTRE update
       a gagné. Deux clics simultanés → un seul JWT.
     - Nouvelle demande → invalidation des liens précédents non
       consommés du même email+purpose (sauf invite, émis par un tiers)
     - Rate limit : 1/60s + 5/h par email, 20/h par IP — dépassement
       → même 200 silencieux que le nominal
     - Purge des expirés : cron 3h UTC + opportuniste

   Backward compat stricte :
     - Migrations additives (ALTER + CREATE IF NOT EXISTS)
     - Les liens émis avant le durcissement restent consommables
       (otp_hash NULL → seul le chemin lien marche, normal)
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin, generateId, generateToken } from '../lib/auth.js';
import { signJWT }              from '../lib/jwt.js';
import { blindIndex }           from '../lib/kdf.js';
import { sendEmail, tplMagicLink } from '../lib/email-resend.js';
import { audit }                from '../lib/audit.js';

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
const RL_EMAIL_COOLDOWN_S   = 60;   // 1 demande / 60 s par email
const OTP_MAX_ATTEMPTS      = 5;

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

  // AUTH-2 — colonnes OTP (additif, silencieux si déjà posées)
  await env.DB.prepare("ALTER TABLE magic_links ADD COLUMN otp_hash TEXT").run().catch(() => {});
  await env.DB.prepare("ALTER TABLE magic_links ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0").run().catch(() => {});

  // AUTH-4 — journal de TOUTES les demandes (anti-oracle)
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS auth_request_log (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      ip_hash    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_auth_req_email ON auth_request_log(email, created_at)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_auth_req_ip ON auth_request_log(ip_hash, created_at)'
  ).run().catch(() => {});

  _schemaReady = true;
}

// ── Helpers ─────────────────────────────────────────────────────
function _normEmail(v) {
  return (v || '').toString().trim().toLowerCase();
}

function _emailValid(v) {
  return typeof v === 'string' && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v);
}

// SHA-256 hex
async function _sha256Hex(str) {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Code OTP 6 chiffres, CSPRNG sans biais modulo (rejet au-delà du
// plus grand multiple de 1e6 représentable sur 32 bits)
function _genOtp() {
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= 4_294_000_000);
  return String(v % 1_000_000).padStart(6, '0');
}

// Hash OTP salé par l'id du lien + pepper serveur → un même code sur
// deux liens différents donne deux hashs différents (anti rainbow).
async function _otpHash(env, linkId, code) {
  const pepper = env.KS_LOOKUP_PEPPER || 'ks-default-pepper-do-not-use-in-prod';
  return await _sha256Hex(`${linkId}:${code}:${pepper}`);
}

// Hash IP avec un pepper pour audit RGPD-safe (pas de PII brute en DB)
async function _ipHash(env, request) {
  const ip = (request.headers.get('cf-connecting-ip') || '').slice(0, 64);
  if (!ip) return null;
  const pepper = env.KS_LOOKUP_PEPPER || 'ks-default-pepper-do-not-use-in-prod';
  return await _sha256Hex(ip + pepper);
}

// AUTH-4 — rate limit calculé sur auth_request_log (toutes les
// demandes, y compris emails inconnus) : plus d'oracle d'énumération.
async function _checkRateLimit(env, email, ipHash) {
  const cooldown = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM auth_request_log
              WHERE email = ? AND created_at > datetime('now', ?)`)
    .bind(email, `-${RL_EMAIL_COOLDOWN_S} seconds`)
    .first();
  if ((cooldown?.n || 0) >= 1) return { allowed: false, reason: 'cooldown' };

  const emailCnt = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM auth_request_log
              WHERE email = ? AND created_at > datetime('now', '-1 hour')`)
    .bind(email)
    .first();
  if ((emailCnt?.n || 0) >= RL_PER_EMAIL_PER_HOUR) {
    return { allowed: false, reason: 'email_quota_exceeded' };
  }

  if (ipHash) {
    const ipCnt = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM auth_request_log
                WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`)
      .bind(ipHash)
      .first();
    if ((ipCnt?.n || 0) >= RL_PER_IP_PER_HOUR) {
      return { allowed: false, reason: 'ip_quota_exceeded' };
    }
  }

  return { allowed: true };
}

// Journalise la demande (TOUJOURS, avant tout filtrage par existence)
async function _logRequest(env, email, ipHash) {
  await env.DB
    .prepare('INSERT INTO auth_request_log (id, email, ip_hash) VALUES (?, ?, ?)')
    .bind(generateId(), email, ipHash || null)
    .run()
    .catch(() => {});
}

// AUTH-3 — une nouvelle demande invalide les liens précédents non
// consommés du même email+purpose. Les invites (émises par un tiers,
// TTL 7 j) ne sont jamais invalidées par une demande de login.
async function _invalidatePrevious(env, email, purpose) {
  if (purpose === 'invite') return;
  await env.DB
    .prepare(`UPDATE magic_links SET expires_at = ?
              WHERE email = ? AND purpose = ? AND consumed_at IS NULL`)
    .bind(new Date(0).toISOString(), email, purpose)
    .run()
    .catch(() => {});
}

// AUTH-3 — purge : liens expirés depuis > 48 h, consommés > 48 h,
// journal de demandes > 24 h. Appelée par le cron 3 h UTC et en
// opportuniste (1 fois / ~50 requests).
export async function purgeExpiredMagicLinks(env) {
  await _ensureSchema(env);
  const cutoffIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const r1 = await env.DB.prepare('DELETE FROM magic_links WHERE expires_at < ?')
    .bind(cutoffIso).run().catch(() => null);
  // consumed_at est posé par datetime('now') → format 'YYYY-MM-DD HH:MM:SS'
  const r2 = await env.DB.prepare("DELETE FROM magic_links WHERE consumed_at IS NOT NULL AND consumed_at < datetime('now', '-48 hours')")
    .run().catch(() => null);
  const r3 = await env.DB.prepare("DELETE FROM auth_request_log WHERE created_at < datetime('now', '-24 hours')")
    .run().catch(() => null);
  return {
    expired:  r1?.meta?.changes ?? 0,
    consumed: r2?.meta?.changes ?? 0,
    log:      r3?.meta?.changes ?? 0,
  };
}

function _maybePurge(env) {
  // Opportuniste et non bloquant — 1 chance sur 50.
  if (Math.floor(Math.random() * 50) !== 0) return;
  purgeExpiredMagicLinks(env).catch(() => {});
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
// Crée un magic-link (+ code OTP) en DB et retourne { tokenClear,
// otpCode, magicUrl, expiresAt }. NE déclenche PAS l'envoi de
// l'email — c'est au caller d'envoyer le mail (avec le template
// approprié à son cas).
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

  await _invalidatePrevious(env, e, purpose);

  const tokenClear = generateToken(32);
  const tokenHash  = await _sha256Hex(tokenClear);
  const id = generateId();
  const otpCode = _genOtp();
  const otpHash = await _otpHash(env, id, otpCode);
  const ttlMin = TTL_MIN[purpose] || 15;
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO magic_links (id, token_hash, otp_hash, email, licence_key, purpose, fingerprint, expires_at, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tokenHash, otpHash, e, licenceKey || null, purpose,
    (fingerprint || '').trim() || null, expiresAt, ipHash || null,
  ).run();

  return {
    id,
    tokenClear,
    otpCode,
    magicUrl:   _magicLinkUrl(env, tokenClear),
    expiresAt,
    ttlMinutes: ttlMin,
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/request-magic-link
// ───────────────────────────────────────────────────────────────
// Reçoit { email, licence_key?, fingerprint?, purpose? } et envoie
// un magic-link + code OTP si l'adresse correspond à un compte.
//
// Comportement silent STRICT (AUTH-4) : 200 OK avec le MÊME corps
// que l'email existe ou non, ET que le rate limit soit atteint ou
// non. Seul un body invalide (email mal formé) renvoie une erreur.
// ═══════════════════════════════════════════════════════════════
const SILENT_OK = {
  ok: true,
  message: 'Si cet email correspond à un compte actif, un lien vient d\'être envoyé.',
};

export async function handleRequestMagicLink(request, env) {
  const origin = getAllowedOrigin(env, request);
  await _ensureSchema(env);
  _maybePurge(env);

  const body = await parseBody(request);
  const email = _normEmail(body.email);
  const fingerprint = (body.fingerprint || '').toString().trim();
  const purposeRaw = (body.purpose || 'magic_login').toString().trim().toLowerCase();
  const purpose = VALID_PURPOSES.has(purposeRaw) ? purposeRaw : 'magic_login';
  const licenceKeyHint = (body.licence_key || '').toString().trim().toUpperCase() || null;

  if (!_emailValid(email)) return err('Email invalide', 400, origin);

  const ipHash = await _ipHash(env, request);

  // Rate limit calculé sur auth_request_log (toutes les demandes,
  // emails connus ou non) PUIS journalisation de la demande courante.
  // Dépassement → même 200 silencieux que le nominal (anti-oracle).
  const rl = await _checkRateLimit(env, email, ipHash);
  await _logRequest(env, email, ipHash);
  if (!rl.allowed) {
    return json(SILENT_OK, 200, origin);
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

  // Pas de match → silent OK (anti enum), MÊME corps que le nominal
  if (!memberRow || !licenceRow) {
    return json(SILENT_OK, 200, origin);
  }

  // Génération lien + code (invalide les précédents du même purpose)
  const issued = await issueMagicLink(env, {
    email,
    licenceKey: licenceRow.key,
    purpose,
    fingerprint,
    ipHash,
  });

  // Envoi de l'email
  try {
    const subject = purpose === 'invite'
      ? `Vous êtes invité sur Keystone OS`
      : purpose === 'recovery'
        ? `Récupération de votre accès Keystone OS`
        : `Votre lien de connexion Keystone OS`;
    const ownerName = (licenceRow.owner && _emailValid(licenceRow.owner) ? null : licenceRow.owner) || null;
    const html = tplMagicLink({
      ownerName,
      magicUrl: issued.magicUrl,
      otpCode:  issued.otpCode,
      purpose: purpose === 'invite' ? 'activation' : purpose,
      expiresMinutes: issued.ttlMinutes,
    });
    await sendEmail(env, { to: email, subject, html });
  } catch (e) {
    // Log mais ne révèle pas l'échec côté client (anti-info-leak)
    console.warn('[magic-link] sendEmail failed', e.message);
  }

  return json(SILENT_OK, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// Consommation partagée (lien OU code) — AUTH-3 anti-course
// ───────────────────────────────────────────────────────────────
// L'UPDATE gardé (consumed_at IS NULL) est LE point de vérité :
// si meta.changes !== 1, quelqu'un d'autre a consommé entre notre
// lecture et notre écriture → pas de JWT.
// ═══════════════════════════════════════════════════════════════
async function _consumeAndIssueJwt(request, env, origin, link, { fp, via, fingerprintMatch }) {
  // Charge la licence AVANT de consommer : si elle est morte, le
  // lien reste utilisable pour un message d'erreur propre au support.
  const licence = await env.DB
    .prepare('SELECT * FROM licences WHERE key = ? LIMIT 1')
    .bind(link.licence_key)
    .first();
  if (!licence) return err('Licence introuvable', 404, origin);
  if (!licence.is_active) return err('Licence inactive', 403, origin);

  // Consomme le token — gardé, anti-course.
  const upd = await env.DB
    .prepare("UPDATE magic_links SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL")
    .bind(link.id)
    .run();
  if ((upd?.meta?.changes ?? 0) !== 1) {
    return err('Lien déjà utilisé', 401, origin);
  }

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
    isAdmin: planUp === 'ADMIN',
    via,
  }, env);

  // Sprint S5.1 — audit du login (= event critique)
  await audit(env, {
    action:   via === 'otp' ? 'otp_consume' : 'magic_link_consume',
    actor:    link.email,
    target:   licence.key,
    tenantId: licence.tenant_id || null,
    details:  {
      purpose:           link.purpose,
      plan:              licence.plan,
      pending_activated: pendingActivated,
      fingerprint_match: fingerprintMatch,
    },
    request,
  });

  return json({
    ok:                true,
    jwt,
    licence_key:       licence.key,
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

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/consume-magic-link
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

  // Fingerprint check si posé à l'émission (anti vol de mail).
  // Chemin LIEN : strict. Le repli cross-device, c'est le code OTP.
  if (link.fingerprint && link.fingerprint !== fp) {
    return err('Fingerprint ne correspond pas. Utilisez le lien depuis l\'appareil qui l\'a demandé, ou saisissez le code à 6 chiffres de l\'email.', 403, origin);
  }

  return _consumeAndIssueJwt(request, env, origin, link, {
    fp,
    via: 'magic_link',
    fingerprintMatch: !!link.fingerprint,
  });
}

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/consume-otp                              (AUTH-2)
// ───────────────────────────────────────────────────────────────
// { email, code, fingerprint } — le chemin cross-device : demandé
// sur desktop, saisi sur mobile. Erreurs volontairement génériques
// (pas de distinction « email inconnu » / « code faux »).
// ═══════════════════════════════════════════════════════════════
export async function handleConsumeOtp(request, env) {
  const origin = getAllowedOrigin(env, request);
  await _ensureSchema(env);

  if (!env.KS_LOOKUP_PEPPER) return err('Server: KS_LOOKUP_PEPPER manquant', 500, origin);
  if (!env.KS_JWT_SECRET)    return err('Server: KS_JWT_SECRET manquant',    500, origin);

  const body = await parseBody(request);
  const email = _normEmail(body.email);
  const code  = (body.code || '').toString().trim();
  const fp    = (body.fingerprint || '').toString().trim();

  if (!_emailValid(email) || !/^\d{6}$/.test(code)) {
    return err('Code invalide ou expiré', 401, origin);
  }

  // Dernier lien vivant pour cet email (avec code : otp_hash posé)
  const link = await env.DB
    .prepare(`SELECT * FROM magic_links
              WHERE email = ? AND consumed_at IS NULL AND otp_hash IS NOT NULL
              ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .bind(email)
    .first();

  if (!link) return err('Code invalide ou expiré', 401, origin);
  if (new Date(link.expires_at) < new Date()) {
    return err('Code invalide ou expiré', 401, origin);
  }
  if ((link.otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    return err('Trop de tentatives. Demandez un nouveau code.', 423, origin);
  }

  const expected = await _otpHash(env, link.id, code);
  if (expected !== link.otp_hash) {
    await env.DB
      .prepare('UPDATE magic_links SET otp_attempts = otp_attempts + 1 WHERE id = ?')
      .bind(link.id)
      .run()
      .catch(() => {});
    const left = OTP_MAX_ATTEMPTS - (link.otp_attempts || 0) - 1;
    return err(left <= 0
      ? 'Trop de tentatives. Demandez un nouveau code.'
      : 'Code invalide ou expiré', left <= 0 ? 423 : 401, origin);
  }

  // Fingerprint : sur le chemin OTP le mismatch est ATTENDU (c'est le
  // chemin cross-device) — on ne bloque pas, on audite.
  const fingerprintMatch = !link.fingerprint || link.fingerprint === fp;

  return _consumeAndIssueJwt(request, env, origin, link, {
    fp,
    via: 'otp',
    fingerprintMatch,
  });
}
