/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Liaison OAuth EN ATTENTE
   (Correctif sécurité #1 — CSRF de liaison de compte)
   ─────────────────────────────────────────────────────────────
   LE TROU FERMÉ ICI
   ─────────────────────────────────────────────────────────────
   Les callbacks OAuth (Facebook/Instagram/Threads/LinkedIn) rangeaient
   le jeton du réseau sous le tenant scellé dans le `state` — c'est-à-dire
   le tenant de CELUI QUI A LANCÉ le flux, pas de celui qui a réellement
   approuvé le consentement chez le réseau.

   Un attaquant pouvait donc démarrer une connexion (state = SON tenant),
   envoyer l'URL d'autorisation à une victime, et — si la victime
   approuvait le consentement avec SON compte — récupérer le jeton de la
   victime RANGÉ SOUS SON PROPRE tenant. Il publiait ensuite sur la page
   de la victime. C'est la CSRF de liaison de compte, et elle s'arme au
   moment où l'App Review Meta ouvre l'OAuth au grand public.

   LE PRINCIPE DU CORRECTIF
   ─────────────────────────────────────────────────────────────
   On DÉCOUPLE la liaison de l'approbation :

   1. Le callback ne range plus rien sous le tenant du `state`. Il chiffre
      le(s) jeton(s) et les met EN ATTENTE derrière un `claim_code` de
      256 bits, à usage unique et à courte durée de vie.
   2. Ce `claim_code` n'est livré QU'AU NAVIGATEUR QUI A APPROUVÉ le
      consentement (la page de retour du réseau) — jamais à l'initiateur.
   3. La finalisation passe par une route AUTHENTIFIÉE : le jeton se fixe
      alors sur le tenant de CELUI QUI CONFIRME (claims.sub), et le tenant
      d'origine du `state` est ignoré pour la propriété.

   Conséquence : même si l'attaquant a forgé le `state`, il n'obtient
   jamais le `claim_code` (il n'est pas dans le navigateur de la victime),
   donc il ne peut jamais finaliser la liaison à son profit. Une liaison
   non confirmée expire sans jamais devenir un compte exploitable.
   ═══════════════════════════════════════════════════════════════ */

import { encrypt } from '../crypto.js';
import { generateId } from '../auth.js';

const CLAIM_TTL_SEC = 10 * 60;   // 10 min — le temps de revenir dans l'app et confirmer.
const CLAIM_RE      = /^[0-9a-f]{64}$/;   // 32 octets hex — non devinable, non énumérable.

let _ready = false;
async function ensurePendingSchema(env) {
  if (_ready) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS social_pending_links (
      claim_code  TEXT PRIMARY KEY,
      payload     TEXT NOT NULL,          -- JSON : comptes prêts, jetons DÉJÀ chiffrés
      summary     TEXT,                   -- libellé lisible (affiché à la confirmation)
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL
    )
  `).run();
  _ready = true;
}

// 32 octets aléatoires en hex. Le secret que seul le navigateur ayant
// approuvé le consentement reçoit.
function _newClaimCode() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Met une liste de comptes EN ATTENTE et retourne le claim_code.
 * @param {object} env
 * @param {object} opts
 * @param {Array}  opts.accounts  descripteurs { platform, targetType, externalId,
 *                                displayName, token (EN CLAIR), scopes, expiresAt }
 * @param {string} [opts.summary] libellé lisible (« Facebook : Ma Page, @moninsta »)
 * @returns {Promise<{ claimCode: string }>}
 */
export async function stashPendingAccounts(env, { accounts, summary = '' }) {
  await ensurePendingSchema(env);
  if (!env.KS_ENCRYPTION_KEY) throw new Error('KS_ENCRYPTION_KEY non configurée');
  const list = Array.isArray(accounts) ? accounts.filter(a => a && a.platform && a.externalId) : [];
  if (!list.length) throw new Error('Aucun compte à mettre en attente');

  // Le jeton est chiffré ICI, comme dans social_accounts : la table d'attente
  // ne contient jamais de jeton en clair, même le temps de la confirmation.
  const payload = [];
  for (const a of list) {
    const enc = a.token ? await encrypt(a.token, env.KS_ENCRYPTION_KEY) : { ciphertext: null, iv: null };
    payload.push({
      platform:    a.platform,
      targetType:  a.targetType || 'profile',
      externalId:  String(a.externalId),
      displayName: a.displayName || a.platform,
      scopes:      a.scopes || '',
      expiresAt:   a.expiresAt || null,
      ct:          enc.ciphertext,
      iv:          enc.iv,
    });
  }

  // Ménage opportuniste : on ne laisse pas s'accumuler les liaisons
  // abandonnées (flux ouverts jamais confirmés).
  await env.DB.prepare("DELETE FROM social_pending_links WHERE expires_at < datetime('now')").run().catch(() => {});

  const claimCode = _newClaimCode();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_SEC * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO social_pending_links (claim_code, payload, summary, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(claimCode, JSON.stringify(payload), summary.slice(0, 200), expiresAt).run();

  return { claimCode };
}

/**
 * Consomme une liaison en attente et range les comptes sous le tenant
 * DE CELUI QUI CONFIRME. À usage unique (la ligne est supprimée à la
 * consommation, même si elle était expirée).
 *
 * @param {object} env
 * @param {object} opts
 * @param {string} opts.claimCode
 * @param {string} opts.tenant     tenant du confirmant (claims.sub) — la propriété
 * @returns {Promise<{ ok: boolean, linked?: string[], reason?: string }>}
 */
export async function confirmPendingLink(env, { claimCode, tenant }) {
  await ensurePendingSchema(env);
  const code = String(claimCode || '').trim().toLowerCase();
  if (!CLAIM_RE.test(code)) return { ok: false, reason: 'code_invalide' };
  if (!tenant)              return { ok: false, reason: 'tenant_absent' };

  // Consommation ATOMIQUE : le DELETE ... RETURNING garantit qu'un même
  // claim_code ne peut être honoré deux fois (deux onglets, un rejeu).
  const row = await env.DB
    .prepare('DELETE FROM social_pending_links WHERE claim_code = ? RETURNING payload, expires_at')
    .bind(code)
    .first();
  if (!row) return { ok: false, reason: 'introuvable' };
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expire' };

  let accounts;
  try { accounts = JSON.parse(row.payload); }
  catch { return { ok: false, reason: 'payload_illisible' }; }
  if (!Array.isArray(accounts) || !accounts.length) return { ok: false, reason: 'vide' };

  const linked = [];
  for (const a of accounts) {
    // Upsert par (tenant, platform, external_id) — miroir exact de storeAccount.
    const existing = await env.DB
      .prepare('SELECT id FROM social_accounts WHERE tenant_id = ? AND platform = ? AND external_id = ?')
      .bind(tenant, a.platform, a.externalId).first();
    if (existing) {
      await env.DB.prepare(`
        UPDATE social_accounts
        SET access_ciphertext=?, access_iv=?, display_name=?, scopes=?, expires_at=?, status='connected', updated_at=datetime('now')
        WHERE id=?
      `).bind(a.ct, a.iv, a.displayName, a.scopes, a.expiresAt || null, existing.id).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO social_accounts
          (id, tenant_id, platform, target_type, external_id, display_name, access_ciphertext, access_iv, scopes, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected')
      `).bind(generateId(), tenant, a.platform, a.targetType, a.externalId, a.displayName, a.ct, a.iv, a.scopes, a.expiresAt || null).run();
    }
    linked.push(a.displayName || a.externalId);
  }

  return { ok: true, linked };
}

/**
 * Origine du front à laquelle on a le DROIT de renvoyer le claim_code par
 * postMessage. Première entrée https concrète de KS_ALLOWED_ORIGIN. On ne
 * renvoie JAMAIS '*' : sans origine sûre, on n'émet pas de postMessage (la
 * page bascule alors sur le repli manuel). C'est le défaut prudent.
 */
export function frontOrigin(env) {
  const csv = (env.KS_ALLOWED_ORIGIN || '').trim();
  if (!csv || csv === '*') return null;
  const first = csv.split(',').map(s => s.trim()).find(s => /^https:\/\/[^*]/.test(s));
  return first || null;
}

// Échappement HTML minimal pour l'injection dans la page de retour.
function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Page HTML rendue au navigateur qui a approuvé le consentement. Elle
 * transmet le claim_code à l'app d'origine (postMessage vers l'origine
 * ÉPINGLÉE — jamais '*') puis invite à finaliser. Repli manuel si le
 * flux n'a pas d'ouvreur (popup bloqué → navigation plein écran).
 *
 * @param {object} opts
 * @param {?string} opts.frontOrigin  origine sûre du front (ou null)
 * @param {string}  opts.claimCode
 * @param {string}  opts.network       'Facebook', 'Threads', 'LinkedIn'…
 * @param {string}  opts.summary       comptes détectés (affichage)
 */
export function pendingCallbackPage({ frontOrigin: fo, claimCode, network = '', summary = '' }) {
  const safeNet = _esc(network);
  const safeSum = _esc(summary);
  // claimCode est [0-9a-f]{64} : sûr à interpoler tel quel dans le JS/HTML.
  const claimJson = JSON.stringify(claimCode);
  const originJson = JSON.stringify(fo || '');
  const fallbackHref = fo ? `${fo}/?social_claim=${claimCode}` : '';
  const fallbackBtn = fo
    ? `<a href="${_esc(fallbackHref)}" style="display:inline-block;margin-top:18px;padding:11px 20px;border-radius:12px;background:#c9b48a;color:#0b1020;font-weight:700;text-decoration:none">Finaliser dans Keystone</a>`
    : `<p style="opacity:.8;font-size:14px;margin-top:14px">Retournez dans le <strong>Social Manager</strong> et rechargez la page pour finaliser.</p>`;

  const html =
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;background:#0b1020;color:#e7e9ee;display:grid;place-items:center;min-height:100vh;margin:0">` +
    `<div style="text-align:center;max-width:480px;padding:28px;font-size:16px;line-height:1.6">` +
    `✅ <strong>${safeNet} autorisé</strong>${safeSum ? ` : ${safeSum}` : ''}<br><br>` +
    `<span id="ks-state">Finalisation de la connexion…</span>` +
    `${fallbackBtn}` +
    `</div>` +
    `<script>(function(){` +
    `var claim=${claimJson},origin=${originJson};` +
    `function done(msg){var el=document.getElementById('ks-state');if(el)el.textContent=msg;}` +
    // Canal principal : on remet le code à l'app d'origine (fenêtre ouvreuse),
    // vers l'ORIGINE ÉPINGLÉE uniquement. Si l'ouvreur n'est pas cette origine,
    // le navigateur ne délivre rien — le code ne fuit pas.
    `try{if(origin&&window.opener&&!window.opener.closed){` +
    `window.opener.postMessage({type:'ks-social-link',claim:claim},origin);` +
    `done('Connexion finalisée — vous pouvez fermer cet onglet.');` +
    `setTimeout(function(){try{window.close();}catch(e){}},1500);` +
    `}else{done('Cliquez sur « Finaliser dans Keystone » pour terminer.');}}` +
    `catch(e){done('Cliquez sur « Finaliser dans Keystone » pour terminer.');}` +
    `})();</script>` +
    `</body>`;

  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
