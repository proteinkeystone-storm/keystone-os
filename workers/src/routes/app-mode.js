/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes du sélecteur de mode (Sprint P7)
   ─────────────────────────────────────────────────────────────
   Qui fournit l'IA d'une application publique, déclaré par le
   propriétaire depuis les réglages de l'app. Cf. lib/app-mode.js pour
   la doctrine, handoff §2 pour la décision commerciale.

     GET  /api/app-mode?app=<id>   état d'une app publique
     POST /api/app-mode            { app, mode: 'MANAGED'|'BYOK' }

   Le tenant vient du JWT, JAMAIS du body (même règle que routes/keys.js
   — sinon n'importe qui déclarerait le mode de n'importe qui).

   Le GET sert aussi à peupler l'écran : il dit s'il existe une clé au
   coffre et sur quel moteur, pour que le front n'offre BYOK que quand
   il est réellement atteignable. AUCUNE valeur de clé n'en sort.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { byokRoutingEnabled } from '../lib/llm-router.js';
import {
  MODE, isPublicSurfaceApp, canDeclareByok,
  getAppModeRow, decideMode, setAppMode,
} from '../lib/app-mode.js';

/**
 * BYOK est-il RÉELLEMENT atteignable pour ce tenant ?
 *
 * Trois conditions, et le drapeau global compte autant que la clé :
 * `BYOK_ROUTING` est OFF en prod, donc `resolveEngineForTenant()` rend
 * null quoi qu'on déclare. Sans ce test, l'écran afficherait « vos
 * visiteurs sont servis sur votre clé » alors que tout part sur mon
 * Mistral — un mensonge sur qui paie. On n'offre donc l'option que
 * quand elle tient sa promesse ; le jour où le drapeau passe ON, elle
 * apparaît d'elle-même.
 */
function _byokReachable(env, vault) {
  if (!byokRoutingEnabled(env)) return { ok: false, reason: 'routing_disabled' };
  return canDeclareByok(vault.engines, vault.activeEngine);
}

// Aligné sur routes/keys.js et smart-agent `_tenantOf` : admin → 'default',
// sinon le lookup_hmac stable de la licence. Le coffre de clés est rangé
// sous la MÊME identité — les deux doivent rester d'accord.
function _tenantFromJWT(claims) {
  if (!claims) return null;
  if (claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN') return 'default';
  return claims.sub || null;
}

/** Moteurs ayant une clé + moteur actif (aucune valeur). */
async function _vaultState(env, tenant) {
  try {
    const { results } = await env.DB
      .prepare('SELECT engine FROM tenant_api_keys WHERE tenant_id = ?').bind(tenant).all();
    const pref = await env.DB
      .prepare('SELECT active_engine FROM tenant_ai_prefs WHERE tenant_id = ?').bind(tenant).first();
    return { engines: (results || []).map(r => r.engine), activeEngine: pref?.active_engine || null };
  } catch (_) {
    return { engines: [], activeEngine: null };   // tables pas encore nées
  }
}

// ── GET /api/app-mode?app=<id> ─────────────────────────────────
export async function handleGetAppMode(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);
  const tenant = _tenantFromJWT(claims);
  if (!tenant) return err('Authentification requise', 401, origin);

  const appId = new URL(request.url).searchParams.get('app') || '';
  if (!isPublicSurfaceApp(appId)) {
    return err('Application sans surface publique (le mode ne s\'y applique pas)', 400, origin);
  }

  const row      = await getAppModeRow(env, tenant, appId);
  const decision = decideMode(row, appId);
  const vault    = await _vaultState(env, tenant);
  const eligible = _byokReachable(env, vault);

  return json({
    app:             appId,
    mode:            decision.mode,        // ce qui s'applique
    declared:        decision.declared,    // ce qui a été demandé
    degraded:        decision.degraded,
    degraded_at:     row?.degraded_at     || null,
    degraded_reason: row?.degraded_reason || null,
    // De quoi peindre l'écran sans deviner :
    byok_available:  eligible.ok,
    byok_blocker:    eligible.ok ? null : eligible.reason,
    active_engine:   vault.activeEngine,
    engines_with_key: vault.engines,
  }, 200, origin);
}

// ── POST /api/app-mode ─────────────────────────────────────────
export async function handleSetAppMode(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);
  const tenant = _tenantFromJWT(claims);
  if (!tenant) return err('Authentification requise', 401, origin);

  const b     = await parseBody(request);
  const appId = (typeof b?.app === 'string') ? b.app.trim() : '';
  const mode  = (typeof b?.mode === 'string') ? b.mode.trim().toUpperCase() : '';

  if (!isPublicSurfaceApp(appId)) {
    return err('Application sans surface publique (le mode ne s\'y applique pas)', 400, origin);
  }
  if (mode !== MODE.MANAGED && mode !== MODE.BYOK) {
    return err('Mode invalide (MANAGED ou BYOK)', 400, origin);
  }

  // Règle 3 — pas de BYOK sans clé, sinon on fabrique une app muette.
  // Et pas de BYOK non plus quand le routage global est coupé, sinon on
  // enregistre une déclaration qui ne sera pas honorée.
  if (mode === MODE.BYOK) {
    const vault    = await _vaultState(env, tenant);
    const eligible = _byokReachable(env, vault);
    if (!eligible.ok) {
      const msg = eligible.reason === 'routing_disabled'
        ? 'Le branchement d\'un moteur personnel n\'est pas encore ouvert sur cette application.'
        : eligible.reason === 'no_key'
          ? 'Aucune clé enregistrée. Déposez d\'abord votre clé dans Réglages → Moteur IA.'
          : eligible.reason === 'no_active_engine'
            ? 'Aucun moteur actif. Choisissez votre moteur dans Réglages → Moteur IA.'
            : `Aucune clé pour le moteur actif (${vault.activeEngine}). Déposez-la, ou changez de moteur actif.`;
      return err(msg, 409, origin);
    }
  }

  const saved = await setAppMode(env, tenant, appId, mode);
  return json({ ok: true, app: appId, mode: saved, degraded: false }, 200, origin);
}
