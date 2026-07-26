/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Route publique d'activation v1.0  (Sprint 2)
   ═══════════════════════════════════════════════════════════════
   Endpoint : POST /api/licence/v2/activate
   Body     : { key, email, fingerprint }
   Réponses :
     200 → { jwt, plan, ownedAssets, owner, deviceBound: bool }
     401 → clé invalide ou révoquée
     409 → clé déjà utilisée sur un autre appareil
     429 → rate-limit (retry-after en secondes dans la réponse)

   Trois protections combinées :
   • Sprint 2.1 — clé jamais en clair en DB ; lookup via HMAC blind
                  index, vérif via PBKDF2-600k, JWT HS256 émis.
   • Sprint 2.2 — au premier succès, le device_fingerprint est lié
                  à la licence. Les activations suivantes doivent
                  matcher (sauf plan DEMO, multi-device autorisé).
   • Sprint 2.3 — rate limit par fingerprint avec backoff exponentiel
                  (2^attempts s, cap 1h, reset après succès).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { blindIndex, hashKey, verifyKey }         from '../lib/kdf.js';
import { signJWT }                                from '../lib/jwt.js';
// Sprint S2.5 — enforcement effectif de licences.devices_max
import { enforceDeviceLimit }                     from './devices-v2.js';

const MAX_BACKOFF_MS = 60 * 60 * 1000; // 1 heure
const HARD_LOCK_AFTER = 10;            // attentes avant lock 24h
const HARD_LOCK_MS    = 24 * 60 * 60 * 1000;

// ── Rate-limit : lecture + verdict avant traitement ─────────
async function _checkRateLimit(env, fp) {
  const row = await env.DB
    .prepare('SELECT * FROM activation_attempts WHERE fingerprint = ?')
    .bind(fp)
    .first();
  if (!row) return { allowed: true, attempts: 0 };
  const now = Date.now();
  if (row.blocked_until > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((row.blocked_until - now) / 1000),
      attempts: row.attempts,
    };
  }
  return { allowed: true, attempts: row.attempts };
}

async function _registerFailure(env, fp, currentAttempts) {
  const attempts = currentAttempts + 1;
  const now      = Date.now();
  const backoffMs = attempts >= HARD_LOCK_AFTER
    ? HARD_LOCK_MS
    : Math.min(Math.pow(2, attempts) * 1000, MAX_BACKOFF_MS);
  const blockedUntil = now + backoffMs;
  await env.DB.prepare(`
    INSERT INTO activation_attempts (fingerprint, attempts, last_attempt, blocked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      attempts      = ?,
      last_attempt  = ?,
      blocked_until = ?
  `).bind(fp, attempts, now, blockedUntil, attempts, now, blockedUntil).run();
  return Math.ceil(backoffMs / 1000);
}

async function _resetAttempts(env, fp) {
  await env.DB
    .prepare('DELETE FROM activation_attempts WHERE fingerprint = ?')
    .bind(fp)
    .run();
}

// ═══════════════════════════════════════════════════════════════
// POST /api/licence/v2/activate
// ═══════════════════════════════════════════════════════════════
export async function handleActivateV2(request, env) {
  const origin = getAllowedOrigin(env, request);

  if (!env.KS_LOOKUP_PEPPER) return err('Server: KS_LOOKUP_PEPPER manquant', 500, origin);
  if (!env.KS_JWT_SECRET)    return err('Server: KS_JWT_SECRET manquant',    500, origin);

  const body = await parseBody(request);
  const key  = (body.key || '').toUpperCase().trim();
  const fp   = (body.fingerprint || '').trim();
  const email = (body.email || '').trim().toLowerCase();

  if (!key)   return err('Clé requise', 400, origin);
  if (!fp || fp.length < 16) return err('Empreinte appareil invalide', 400, origin);

  // ── Étape 1 : rate limit sur fingerprint ─────────────────────
  const rl = await _checkRateLimit(env, fp);
  if (!rl.allowed) {
    return err(
      `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.`,
      429,
      origin,
    );
  }

  // ── Étape 2 : lookup blind index ─────────────────────────────
  const lookupHmac = await blindIndex(key, env.KS_LOOKUP_PEPPER);
  let licence = await env.DB
    .prepare('SELECT * FROM licences WHERE lookup_hmac = ? AND is_active = 1')
    .bind(lookupHmac)
    .first();

  // Compat legacy : si pas trouvé via hmac, regarde l'ancienne colonne
  // `key` en clair et migre à la volée vers le hash.
  if (!licence) {
    licence = await env.DB
      .prepare('SELECT * FROM licences WHERE key = ? AND is_active = 1')
      .bind(key)
      .first();
    if (licence) {
      // Migration paresseuse : on hashe maintenant et on stocke
      const { hash, salt } = await hashKey(key);
      await env.DB.prepare(`
        UPDATE licences
           SET lookup_hmac = ?, key_hash = ?, salt = ?
         WHERE key = ?
      `).bind(lookupHmac, hash, salt, key).run();
      licence.lookup_hmac = lookupHmac;
      licence.key_hash    = hash;
      licence.salt        = salt;
    }
  }

  if (!licence) {
    const retryAfterSec = await _registerFailure(env, fp, rl.attempts);
    return err(`Clé invalide. Prochain essai dans ${retryAfterSec}s.`, 401, origin);
  }

  // ── Étape 3 : vérification PBKDF2 (constant-time) ────────────
  if (licence.key_hash && licence.salt) {
    const ok = await verifyKey(key, licence.key_hash, licence.salt);
    if (!ok) {
      const retryAfterSec = await _registerFailure(env, fp, rl.attempts);
      return err(`Clé invalide. Prochain essai dans ${retryAfterSec}s.`, 401, origin);
    }
  }

  // ── Étape 4 : expiration ─────────────────────────────────────
  if (licence.expires_at && new Date(licence.expires_at) < new Date()) {
    return err('Licence expirée.', 403, origin);
  }

  // ── Étape 5 : First-Use device binding (Sprint 2.2 + S2.5) ─────
  // Plan ADMIN = bypass (l'admin doit accéder depuis tous ses appareils).
  // Plan BETA = binding normal (1 testeur = 1 appareil).
  // [Le bypass DEMO est parti avec le mode démo, le 2026-07-25.]
  const planUp    = (licence.plan || '').toUpperCase();
  const isAdmin   = planUp === 'ADMIN';
  // MAX = appareils ILLIMITÉS (cf. _devicesMaxForPlan licence-v2 = null +
  // description plan « appareils illimités »). Il ne doit JAMAIS être verrouillé
  // sur un seul appareil par le binding legacy. Sans ce bypass, une licence MAX
  // se faisait bloquer dès le 2ᵉ navigateur/appareil (« Cette clé est déjà
  // activée sur un autre appareil ») tant qu'enforce_devices_v2 reste dormant —
  // bug cross-device récurrent. ADMIN était déjà bypass.
  const isMax     = planUp === 'MAX';
  const bypassBind = isAdmin || isMax;
  let   deviceBound = false;
  let   enforcementResult = null;  // S2.5 — résultat de enforceDeviceLimit (debug)

  // ── S2.5 — Enforcement effectif via table devices ────────────
  // Activé UNIQUEMENT pour les licences avec enforce_devices_v2=1.
  // Pour toutes les autres (= toutes les licences existantes par
  // défaut) → comportement legacy (binding fingerprint sur licences).
  // Try/catch défensif : si l'enforcement échoue (bug Worker, DB
  // hors-service…), on retombe sur le legacy plutôt que de bloquer
  // l'utilisateur.
  try {
    enforcementResult = await enforceDeviceLimit(env, {
      licence,
      email,
      fingerprint: fp,
    });
  } catch (e) {
    console.warn('[activate v2] enforceDeviceLimit threw, falling back to legacy', e);
    enforcementResult = { mode: 'legacy_skip', reason: 'exception' };
  }

  if (enforcementResult?.mode === 'denied') {
    // Limite atteinte → 409 enrichi avec liste devices + suggestion
    return json({
      error:           enforcementResult.suggestion || 'Limite de devices atteinte pour cet email.',
      devices_max:     enforcementResult.devicesMax,
      active_count:    enforcementResult.activeCount,
      active_devices:  enforcementResult.existingDevices || [],
      action:          'DELETE /api/licence/devices/:id (revoke un device) puis ré-essayer /api/licence/v2/activate',
    }, 409, origin);
  }

  if (enforcementResult?.mode === 'created' || enforcementResult?.mode === 'reused') {
    deviceBound = (enforcementResult.mode === 'created');
  } else {
    // mode = 'legacy_skip' ou 'bypass' → on continue le code legacy
    // (cas par défaut tant qu'enforce_devices_v2 n'est pas activé).
    if (!bypassBind) {
      /* ── Binding legacy : il SUIT l'appareil, il ne l'enferme plus ──
         Jusqu'au 2026-07-25, une empreinte différente de celle en base
         renvoyait « Cette clé est déjà activée sur un autre appareil.
         Contactez le support. » Trois enfermements dans la même journée
         de test, sur le même Mac — parce que l'empreinte était dérivée
         de signaux volatils (résolution d'écran, canvas, userAgent).

         Ce mur ne protégeait pourtant presque rien : qui veut partager
         une clé vide son stockage local et repart avec une empreinte
         neuve. Il coûtait des utilisateurs enfermés et un message qui
         les envoie au support, pour une protection qu'on contourne en
         deux clics.

         Le vrai contrôle de partage existe et vit ailleurs : la table
         `devices` (enforce_devices_v2), qui compte les appareils, les
         borne par `devices_max` et offre une RÉVOCATION en self-service.
         Quand ce flag est posé, `enforceDeviceLimit` a déjà tranché
         plus haut et on ne passe pas ici.

         Donc : sans enforcement configuré, on ne fait plus semblant
         d'enforcer. Le dernier appareil activé devient l'appareil de
         référence. La clé reste secrète, l'accès reste tracé (audit +
         activated_at), et personne n'est enfermé dehors. */
      const premier = !licence.device_fingerprint;
      if (premier || licence.device_fingerprint !== fp) {
        await env.DB.prepare(`
          UPDATE licences
             SET device_fingerprint = ?, activated_at = datetime('now')
           WHERE lookup_hmac = ?
        `).bind(fp, lookupHmac).run();
        if (!premier) {
          console.log('[activate] empreinte réassociée pour', lookupHmac.slice(0, 8),
                      '— appareil de référence mis à jour (binding legacy non bloquant)');
        }
        licence.device_fingerprint = fp;
        deviceBound = premier;
      }
    }
  }

  // ── Étape 6 : reset rate limit + émission JWT ────────────────
  await _resetAttempts(env, fp);

  const jwt = await signJWT({
    sub:      lookupHmac,        // identifiant stable de la licence (pas la clé)
    plan:     licence.plan,
    owner:    licence.owner,
    email:    email || licence.owner,
    fp:       fp,                // lié à l'empreinte
    isAdmin,
  }, env);

  return json({
    jwt,
    plan:        licence.plan,
    owner:       licence.owner,
    ownedAssets: licence.owned_assets ? JSON.parse(licence.owned_assets) : null,
    expiresAt:   licence.expires_at,
    deviceBound,
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/licence/v2/me
// Vérifie un JWT et retourne le plan / claims associés.
// ═══════════════════════════════════════════════════════════════
import { requireJWT } from '../lib/jwt.js';

export async function handleMe(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('JWT invalide ou expiré', 401, origin);
  return json({
    plan:    claims.plan,
    owner:   claims.owner,
    expSec:  claims.exp - Math.floor(Date.now()/1000),
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/refresh
// Sprint Sécu-2 / H4 / Q2b — rolling refresh du JWT.
// Prend un JWT actuel valide, en émet un nouveau avec exp réinitialisé.
// Le frontend peut appeler ce endpoint régulièrement (ex: toutes les
// 24h) pour maintenir une session sans re-saisir la clé de licence.
// Si le JWT actuel est invalide ou expiré → 401, l'user doit re-login.
// ═══════════════════════════════════════════════════════════════
export async function handleRefresh(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('JWT invalide ou expiré — re-login requis', 401, origin);

  // ── Revalidation de la licence (audit sept. 2026 · E-1) ────────
  // Ce point d'entrée re-signait le jeton à partir des SEULS claims, sans
  // jamais consulter la base. Autrement dit : un client remboursé, un
  // membre d'équipe révoqué ou une licence expirée pouvait prolonger son
  // accès indéfiniment, un renouvellement après l'autre. C'était la
  // machine à blanchir un jeton mort — et elle annulait tout l'intérêt
  // d'une durée de vie courte.
  //
  // On relit donc l'état réel avant de re-signer. Fail-open assumé et
  // cohérent avec lib/app-access : si la base est muette, on ne coupe pas
  // une session en cours sur un incident d'infrastructure — mais on le dit.
  if (claims.sub) {
    let row;
    try {
      row = await env.DB
        .prepare('SELECT plan, is_active, expires_at FROM licences WHERE lookup_hmac = ? LIMIT 1')
        .bind(claims.sub).first();
    } catch (_) {
      console.warn('[auth/refresh] FAIL-OPEN : base injoignable, renouvellement accordé sans vérification');
      row = null;
    }
    if (row) {
      if (row.is_active === 0) {
        return err('Licence inactive — reconnexion requise', 403, origin);
      }
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return err('Licence expirée — reconnexion requise', 403, origin);
      }
      // Le plan a pu changer depuis l'émission (achat, résiliation d'une
      // app, passage à l'OS) : on renouvelle sur l'état COURANT, pas sur
      // celui figé dans l'ancien jeton.
      if (row.plan) claims.plan = row.plan;
    }
  }

  // On retire les claims de timing existants ; signJWT recalcule iat/exp.
  const { iat: _iat, exp: _exp, nbf: _nbf, ...payload } = claims;
  const jwt = await signJWT(payload, env);

  return json({
    jwt,
    expiresIn: 60 * 60 * 24 * 7,
    plan:      claims.plan,
    owner:     claims.owner,
  }, 200, origin);
}
