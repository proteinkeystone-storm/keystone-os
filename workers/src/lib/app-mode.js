/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Mode « clé en main » / BYOK par application publique
   (Sprint P7)
   ─────────────────────────────────────────────────────────────
   QUI PAIE L'IA, sur les deux applications qui répondent aux clients
   DU client (Smart Agent, Concierge de Smart QR). Cf. handoff §2.

   AVANT ce module, le mode n'était pas CHOISI, il était DEVINÉ :
   « le drapeau global BYOK_ROUTING est-il ON *et* ce tenant a-t-il
   déposé une clé dans le coffre ? ». Deux défauts — c'était global au
   tenant (une clé basculait aussi Sentinel), et rien ne le disait au
   client ni ne le lui faisait accepter.

   Ici, le mode devient une DÉCLARATION explicite, per-app, stockée.

   ── Les trois règles ────────────────────────────────────────────
   1. DÉFAUT = MANAGED (tranché 2026-07-25). Une app publique achetée
      fonctionne à la seconde où elle est publiée — un acheteur à 99 €
      ne découvre pas un agent muet. C'est le mur des conversations
      (`enforce_ai_credits_v1`) + le plafond P3 qui bornent le risque,
      PAS l'absence de service. Corollaire non négociable : le défaut
      MANAGED n'est sûr que si le mur est armé sur la licence.
   2. RÉVERSIBLE à tout moment depuis les réglages de l'app (tranché
      2026-07-25). Sans danger : le prix est le MÊME dans les deux
      modes (99 €), seul l'inclus diffère — rien à arbitrer.
   3. BYOK ne se déclare qu'avec une clé déjà déposée (cf. `canDeclare`).
      Sinon on fabriquerait l'état « BYOK sans clé » = surface publique
      muette, exactement ce que la règle 1 refuse.

   ── L'état DÉGRADÉ (le trou qu'on vient boucher) ────────────────
   Le chat public et le Concierge appellent le vendor avec
   `fallbackOnError: true` : si la clé du client meurt (expirée, quota
   vendor atteint, panne), le visiteur est resservi en silence sur MON
   Mistral. Or le débit de conversations avait déjà été sauté en amont
   (`if (!useByok) consumeCredits(...)`) → **le client était servi
   gratuitement, indéfiniment, sans que personne le voie.**

   Réponse : le repli sert le visiteur (on ne casse jamais le public),
   mais il marque la ligne DÉGRADÉE. Tant qu'elle l'est, la surface se
   comporte comme MANAGED — le mur et le compteur s'appliquent — et le
   propriétaire est prévenu. Le premier appel raté passe gratuit (on ne
   l'apprend qu'en appelant) ; pas les suivants.

   La sortie de dégradation est EXPLICITE (le client repose une clé et
   redéclare BYOK) : ré-essayer tout seul, c'est re-tomber dans la
   fuite à chaque appel.

   ⚠️ `MODE` / `PUBLIC_SURFACE_APPS` / `isPublicSurfaceApp()` sont le
   miroir de `app/lib/pricing.js` — `scripts/test-app-mode.mjs` compare
   les deux et casse `npm test` si l'un dérive.
   ═══════════════════════════════════════════════════════════════ */

import { resolveEngineForTenant } from './llm-router.js';
import { sendEmail }              from './email-resend.js';
import { OS_ENTITLEMENT }         from './pricing-grid.js';

/** Libellé client des deux apps concernées (pour l'e-mail de dégradation). */
export const APP_LABEL = {
  'O-AGT-001': 'Smart Agent',
  'A-COM-001': 'le Concierge de vos QR codes',
};

export const MODE = { MANAGED: 'MANAGED', BYOK: 'BYOK' };

/** Les seules apps concernées : celles dont le coût IA suit le trafic d'un TIERS. */
export const PUBLIC_SURFACE_APPS = [
  'O-AGT-001',   // Smart Agent
  'A-COM-001',   // Smart QR — le Concierge public
];

/** Tranché 2026-07-25 : l'app achetée marche tout de suite. */
export const DEFAULT_MODE = MODE.MANAGED;

export function isPublicSurfaceApp(id) {
  return PUBLIC_SURFACE_APPS.includes(id);
}

/* ═══════════════════════════════════════════════════════════════
   Décision PURE — aucune I/O, tout le banc tape ici
   ═══════════════════════════════════════════════════════════════ */

/**
 * Quel mode s'applique RÉELLEMENT à cet appel ?
 *
 * @param {?object} row  ligne `tenant_app_mode` (null si absente)
 * @param {string}  appId
 * @returns {{mode:string, declared:string, degraded:boolean, reason:string}}
 *   `mode`     — ce qui s'applique maintenant (l'arbitre du routage ET du débit)
 *   `declared` — ce que le client a demandé (peut différer si dégradé)
 */
export function decideMode(row, appId) {
  // Hors surface publique, la question ne se pose pas : l'IA est incluse
  // dans l'abonnement et le coût suit l'usage de l'abonné, pas d'un tiers.
  if (!isPublicSurfaceApp(appId)) {
    return { mode: MODE.MANAGED, declared: MODE.MANAGED, degraded: false, reason: 'not_public_surface' };
  }
  if (!row) {
    return { mode: DEFAULT_MODE, declared: DEFAULT_MODE, degraded: false, reason: 'default' };
  }
  const declared = String(row.mode || '').toUpperCase() === MODE.BYOK ? MODE.BYOK : MODE.MANAGED;
  if (declared === MODE.MANAGED) {
    return { mode: MODE.MANAGED, declared, degraded: false, reason: 'declared' };
  }
  // BYOK déclaré mais la clé a lâché → on RETOMBE en géré (donc compté).
  if (row.degraded_at) {
    return { mode: MODE.MANAGED, declared: MODE.BYOK, degraded: true, reason: 'degraded' };
  }
  return { mode: MODE.BYOK, declared: MODE.BYOK, degraded: false, reason: 'declared' };
}

/**
 * Ce sac d'apps exige-t-il que le mur des conversations soit armé ?
 *
 * Le pendant indispensable du défaut « clé en main » : une app à surface
 * publique part en mode géré, donc c'est MOI qui fournis l'IA, pour un
 * volume qui suit le trafic d'un TIERS. Sans `enforce_ai_credits_v1`,
 * ce défaut ne veut pas dire « 1 000 conversations puis recharge
 * plafonnée » — il veut dire illimité, gratuit, à ma charge.
 *
 * Appelé au PROVISIONNEMENT (webhook Stripe) : le drapeau n'était posé
 * qu'à la main dans l'admin, donc toute licence vendue naissait à 0.
 */
export function needsCreditWall(ownedAssets) {
  if (!Array.isArray(ownedAssets)) return false;
  // La sentinelle 'OS' ne LISTE pas les apps : elle les contient TOUTES,
  // donc les deux publiques. Un client OS à 129 € est justement celui qui
  // publiera un Smart Agent — l'oublier laisserait le plus gros client
  // sans plafond.
  if (ownedAssets.includes(OS_ENTITLEMENT)) return true;
  return ownedAssets.some(isPublicSurfaceApp);
}

/**
 * Le client a-t-il le droit de PASSER en BYOK ?
 * Règle 3 : une clé doit déjà exister pour le moteur actif — sinon on
 * fabrique une app publique muette.
 *
 * @param {string[]} enginesWithKey  moteurs ayant une clé au coffre
 * @param {?string}  activeEngine    moteur actif du tenant
 */
export function canDeclareByok(enginesWithKey, activeEngine) {
  const list = Array.isArray(enginesWithKey) ? enginesWithKey : [];
  if (!list.length)    return { ok: false, reason: 'no_key' };
  if (!activeEngine)   return { ok: false, reason: 'no_active_engine' };
  if (!list.includes(activeEngine)) return { ok: false, reason: 'active_engine_has_no_key' };
  return { ok: true, reason: 'ok' };
}

/* ═══════════════════════════════════════════════════════════════
   Couche D1 — schéma auto-créé (même patron que routes/keys.js :
   zéro migration, la table naît au premier appel)
   ═══════════════════════════════════════════════════════════════ */

let _schemaReady = false;

export async function ensureAppModeSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tenant_app_mode (
    tenant_id       TEXT NOT NULL,
    app_id          TEXT NOT NULL,
    mode            TEXT NOT NULL,
    degraded_at     TEXT,
    degraded_reason TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tenant_id, app_id)
  )`).run();
  _schemaReady = true;
}

/** Ligne brute, ou null. Ne crée jamais rien (absence = défaut MANAGED). */
export async function getAppModeRow(env, tenantId, appId) {
  if (!env?.DB || !tenantId || !appId) return null;
  try {
    await ensureAppModeSchema(env);
    return await env.DB
      .prepare('SELECT mode, degraded_at, degraded_reason, updated_at FROM tenant_app_mode WHERE tenant_id = ? AND app_id = ?')
      .bind(tenantId, appId).first() || null;
  } catch (_) {
    return null;   // table absente / D1 en panne → défaut MANAGED (fail-safe : je paie, je ne casse pas)
  }
}

/** Lecture résolue — le point d'entrée de tout le reste. */
export async function resolveModeForApp(env, tenantId, appId) {
  if (!isPublicSurfaceApp(appId)) return decideMode(null, appId);
  const row = await getAppModeRow(env, tenantId, appId);
  return decideMode(row, appId);
}

/** Écrit le mode déclaré. Repasser en BYOK efface la dégradation. */
export async function setAppMode(env, tenantId, appId, mode) {
  await ensureAppModeSchema(env);
  const m = String(mode).toUpperCase() === MODE.BYOK ? MODE.BYOK : MODE.MANAGED;
  await env.DB.prepare(`
    INSERT INTO tenant_app_mode (tenant_id, app_id, mode, degraded_at, degraded_reason, updated_at)
    VALUES (?, ?, ?, NULL, NULL, datetime('now'))
    ON CONFLICT(tenant_id, app_id) DO UPDATE
      SET mode = excluded.mode, degraded_at = NULL, degraded_reason = NULL, updated_at = datetime('now')
  `).bind(tenantId, appId, m).run();
  return m;
}

/**
 * Le vendor du client a lâché sur une surface publique : on bascule la
 * ligne en dégradé (⇒ les appels suivants sont comptés comme MANAGED).
 *
 * Best-effort et IDEMPOTENT : `WHERE degraded_at IS NULL` garantit que
 * l'horodatage est celui de la PREMIÈRE panne, et que dix visiteurs
 * simultanés ne déclenchent qu'un seul e-mail (le UPDATE ne renvoie de
 * ligne modifiée qu'une fois).
 *
 * @returns {boolean} true si c'est CE passage qui a dégradé (→ prévenir)
 */
export async function markDegraded(env, tenantId, appId, reason = 'vendor_error') {
  if (!env?.DB || !tenantId || !appId) return false;
  try {
    await ensureAppModeSchema(env);
    const res = await env.DB.prepare(`
      UPDATE tenant_app_mode
         SET degraded_at = datetime('now'), degraded_reason = ?, updated_at = datetime('now')
       WHERE tenant_id = ? AND app_id = ? AND mode = 'BYOK' AND degraded_at IS NULL
    `).bind(String(reason).slice(0, 120), tenantId, appId).run();
    return (res?.meta?.changes || 0) > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Dégrade ET prévient, en un geste — le seul appel que les surfaces
 * publiques ont à faire quand leur repli se déclenche.
 *
 * L'e-mail ne part QUE si c'est ce passage qui a dégradé la ligne :
 * dix visiteurs simultanés sur une clé morte = un seul message.
 */
export async function degradeAndWarn(env, tenantId, appId, reason = 'vendor_error') {
  const first = await markDegraded(env, tenantId, appId, reason);
  if (!first) return false;
  const label = APP_LABEL[appId] || 'votre application';
  try {
    const row = await env.DB
      .prepare('SELECT COALESCE(customer_email, owner) AS mail FROM licences WHERE lookup_hmac = ? LIMIT 1')
      .bind(tenantId).first();
    const to = row?.mail || '';
    if (!/@/.test(to)) return true;
    await sendEmail(env, {
      to, replyTo: 'protein.keystone@gmail.com',
      subject: 'Votre clé IA ne répond plus',
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#111">
        <p>Votre clé de moteur IA n'a pas répondu sur <strong>${label}</strong>.</p>
        <p>Vos visiteurs continuent d'être servis — l'application est repassée
        en <strong>mode clé en main</strong> pour ne rien interrompre. Les échanges
        sont donc décomptés de vos <strong>conversations incluses</strong> en attendant.</p>
        <p>Pour revenir sur votre propre clé : vérifiez-la dans Réglages → Moteur IA,
        puis repassez l'application sur « ma clé » dans ses réglages.</p></div>`,
    });
  } catch (e) {
    console.warn('[P7] e-mail dégradation KO :', e?.message);
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════
   Routage — l'arbitre unique des surfaces publiques
   ═══════════════════════════════════════════════════════════════ */

/**
 * Moteur + clé à utiliser pour CET appel, sur CETTE app.
 *
 * Remplace l'appel direct à `resolveEngineForTenant()` sur les deux
 * surfaces publiques. Renvoie `null` (⇒ Mistral sur mon Cloudflare, et
 * conversation débitée) dans TOUS les cas sauf un : le client a déclaré
 * BYOK, la ligne n'est pas dégradée, et une clé se déchiffre.
 *
 * ⚠️ `resolveEngineForTenant` reste gardé par le drapeau global
 * `BYOK_ROUTING` — qui est OFF en prod. Le mode est désormais l'arbitre
 * MÉTIER, le drapeau reste l'interrupteur de SECOURS : tant qu'il est
 * OFF, tout ce module est inerte et le chat public est inchangé.
 */
export async function resolveEngineForApp(env, tenantId, appId) {
  const decision = await resolveModeForApp(env, tenantId, appId);
  if (decision.mode !== MODE.BYOK) return null;
  return await resolveEngineForTenant(env, tenantId);
}
