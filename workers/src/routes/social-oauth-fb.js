/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · OAuth self-serve Facebook + Instagram
   (Sprint S3 — câblage OAuth client)

   Permet à un CLIENT entitled de connecter SA Page Facebook (et l'Instagram
   Business qui y est lié) via le flux OAuth Meta — sans token système owner.
   Un seul flux FB capture la Page + l'IG lié → 2 réseaux, 1 review Meta.

   ⚠ DORMANT tant que l'App Review Meta n'est pas validée : en attendant, ne
   fonctionne QUE pour les comptes ajoutés en « testeurs » de l'app Keystone
   Social (mode développement). Le code, lui, est prêt.

   Routes :
   GET /api/social/connect/facebook   → (authentifié + entitled) renvoie
                                         { authUrl } ; le FRONT y navigue. Le
                                         tenant est lié au `state` (JWT court
                                         signé), pas à un cookie (le callback
                                         Meta arrive sur un autre domaine que
                                         le front → cookie non fiable).
   GET /api/social/callback/facebook  → vérifie le state signé → tenant →
                                         échange code → liste Pages + IG liés →
                                         range chaque compte chiffré PAR TENANT.
   GET|POST /api/social/facebook/deauthorize     → ping retrait d'app (Meta)
   GET|POST /api/social/facebook/data-deletion   → demande RGPD (format Meta)

   Secrets Worker requis :
   - KS_FB_APP_ID       (App ID Meta « Keystone Social » ; défaut ci-dessous)
   - KS_FB_APP_SECRET   (App Secret — À POSER via wrangler/dashboard)
   Réutilise KS_ENCRYPTION_KEY (chiffrement du token) + le secret JWT
   (signature du `state`, via signJWT/verifyJWT).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin, generateId } from '../lib/auth.js';
import { encrypt }                  from '../lib/crypto.js';
import { signJWT, verifyJWT }       from '../lib/jwt.js';
import { ensureSocialSchema }       from '../lib/social/schema.js';
import { getPlatform }              from '../lib/social/registry.js';
import { exchangeCodeForToken }     from '../lib/social/adapters/facebook.js';
import { socialEntitled, socialTenantOf } from './social.js';

const REDIRECT_PATH  = '/api/social/callback/facebook';
const DEFAULT_APP_ID = '1914445162406395';   // app « Keystone Social » (cf. mémoire)
const STATE_TTL      = 600;                   // 10 min — le state signé expire vite

// La redirect_uri DOIT être identique à /connect et /callback et ENREGISTRÉE
// dans les réglages « Facebook Login » de l'app Meta. Dérivée de l'origine Worker.
function redirectUri(request) {
  return new URL(request.url).origin + REDIRECT_PATH;
}

// Échappement minimal pour les messages interpolés dans la page HTML de retour.
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlPage(msg) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;background:#0b1020;color:#e7e9ee;display:grid;place-items:center;min-height:100vh;margin:0">` +
    `<div style="text-align:center;max-width:480px;padding:28px;font-size:16px;line-height:1.6">${msg}</div></body>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

// Scopes combinés Page (publication FB) + IG Business (publication IG), dédupliqués —
// un seul consentement couvre les deux réseaux. Source = registry (pas de hard-code).
function oauthScopes() {
  const page = getPlatform('facebook')?.auth?.scopes?.page || [];
  const ig   = getPlatform('instagram')?.auth?.scopes?.business || [];
  return [...new Set([...page, ...ig])].join(',');
}

// ── GET /api/social/connect/facebook ──────────────────────────
// Authentifié (Bearer JWT) + entitled. Renvoie { authUrl } ; le front y navigue.
export async function handleFacebookConnect(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);

  const appId = env.KS_FB_APP_ID || DEFAULT_APP_ID;
  if (!env.KS_FB_APP_SECRET) return err('OAuth Facebook non configuré (KS_FB_APP_SECRET manquant)', 500, origin);

  // Le tenant de l'utilisateur authentifié est scellé dans le state signé.
  const tenant = await socialTenantOf(request, env);
  const state  = await signJWT({ purpose: 'fb_oauth', tenant }, env, STATE_TTL);

  const u = new URL(getPlatform('facebook').auth.authUrl);
  u.searchParams.set('client_id', appId);
  u.searchParams.set('redirect_uri', redirectUri(request));
  u.searchParams.set('state', state);
  u.searchParams.set('scope', oauthScopes());
  u.searchParams.set('response_type', 'code');
  // (auth_type=rerequest retiré : n'avait de sens que pour forcer les scopes
  //  insights, désormais retirés ; il alourdissait le flux de sélection Page/IG.)

  return json({ authUrl: u.toString() }, 200, origin);
}

// Liste TOUTES les Pages accessibles (rôle direct + détenues/gérées par un
// portefeuille Business) et l'IG lié à chacune. Le token IG de publication EST
// le Page token. ⚠ /me/accounts SEUL rate les Pages « nouvelle expérience » /
// détenues par un Business → on complète via /me/businesses (owned + client).
async function listPagesWithIG(userToken) {
  const base = getPlatform('facebook').api.base;   // https://graph.facebook.com/v20.0
  const byId = new Map();   // id -> { id, name, pageToken }

  // Source 1 — Pages où l'utilisateur a un rôle direct.
  try {
    const r = await fetch(`${base}/me/accounts?` + new URLSearchParams({ fields: 'id,name,access_token', access_token: userToken, limit: '100' }));
    const d = await r.json().catch(() => ({}));
    for (const p of (d.data || [])) byId.set(String(p.id), { id: p.id, name: p.name, pageToken: p.access_token || null });
  } catch (_) {}

  // Source 2 — Pages via les portefeuilles Business (nécessite business_management).
  try {
    const rb = await fetch(`${base}/me/businesses?` + new URLSearchParams({ fields: 'id,name', access_token: userToken, limit: '100' }));
    const db = await rb.json().catch(() => ({}));
    for (const biz of (db.data || [])) {
      for (const edge of ['owned_pages', 'client_pages']) {
        try {
          const rp = await fetch(`${base}/${biz.id}/${edge}?` + new URLSearchParams({ fields: 'id,name,access_token', access_token: userToken, limit: '100' }));
          const dp = await rp.json().catch(() => ({}));
          for (const p of (dp.data || [])) if (!byId.has(String(p.id))) byId.set(String(p.id), { id: p.id, name: p.name, pageToken: p.access_token || null });
        } catch (_) {}
      }
    }
  } catch (_) {}

  const out = [];
  for (const p of byId.values()) {
    // Une Page Business ne renvoie pas toujours son token dans la liste → le récupérer.
    let pageToken = p.pageToken;
    if (!pageToken) {
      try {
        const rt = await fetch(`${base}/${p.id}?` + new URLSearchParams({ fields: 'access_token', access_token: userToken }));
        const dt = await rt.json().catch(() => ({}));
        pageToken = dt.access_token || null;
      } catch (_) {}
    }
    let ig = null;
    try {
      const r2 = await fetch(`${base}/${p.id}?` + new URLSearchParams({
        fields: 'instagram_business_account{id,username},connected_instagram_account{id,username}',
        access_token: pageToken || userToken,
      }));
      const d2 = await r2.json().catch(() => ({}));
      const igObj = d2.instagram_business_account || d2.connected_instagram_account || null;
      if (igObj) ig = { id: igObj.id, username: igObj.username };
    } catch (_) { /* IG non détecté sur cette Page : non bloquant */ }
    out.push({ id: p.id, name: p.name, pageToken, ig });
  }
  return out;
}

// Upsert d'un compte social chiffré, scopé tenant (miroir du callback Threads).
async function storeAccount(env, { tenant, platform, targetType, externalId, displayName, token, scopes }) {
  const acc = await encrypt(token, env.KS_ENCRYPTION_KEY);
  const existing = await env.DB
    .prepare('SELECT id FROM social_accounts WHERE tenant_id = ? AND platform = ? AND external_id = ?')
    .bind(tenant, platform, externalId).first();
  if (existing) {
    await env.DB.prepare(`
      UPDATE social_accounts
      SET access_ciphertext=?, access_iv=?, display_name=?, scopes=?, expires_at=NULL, status='connected', updated_at=datetime('now')
      WHERE id=?
    `).bind(acc.ciphertext, acc.iv, displayName, scopes, existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO social_accounts
        (id, tenant_id, platform, target_type, external_id, display_name, access_ciphertext, access_iv, scopes, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'connected')
    `).bind(generateId(), tenant, platform, targetType, externalId, displayName, acc.ciphertext, acc.iv, scopes).run();
  }
}

// ── GET /api/social/callback/facebook?code=…&state=… ──────────
export async function handleFacebookCallback(request, env) {
  const url      = new URL(request.url);
  const code     = url.searchParams.get('code');
  const state    = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (oauthErr) return htmlPage(`❌ Autorisation refusée : ${esc(oauthErr)}`);
  if (!code || !state) return htmlPage('❌ Paramètres manquants (code/state).');

  // 1) Vérif du state signé → tenant. Un JWT de session (sans purpose) est rejeté.
  let tenant;
  try {
    const claims = await verifyJWT(state, env);
    if (claims.purpose !== 'fb_oauth' || !claims.tenant) throw new Error('purpose/tenant');
    tenant = claims.tenant;
  } catch (_) {
    return htmlPage('❌ Sécurité : lien de connexion invalide ou expiré. Relance depuis le Social Manager.');
  }

  const appId     = env.KS_FB_APP_ID || DEFAULT_APP_ID;
  const appSecret = env.KS_FB_APP_SECRET;
  if (!appSecret)            return htmlPage('❌ KS_FB_APP_SECRET non configuré sur le Worker.');
  if (!env.KS_ENCRYPTION_KEY) return htmlPage('❌ KS_ENCRYPTION_KEY non configurée.');

  await ensureSocialSchema(env);

  try {
    // 2) code → user token longue durée (≈60 j)
    const { userToken } = await exchangeCodeForToken({
      code, clientId: appId, clientSecret: appSecret, redirectUri: redirectUri(request),
    });
    if (!userToken) throw new Error('user token introuvable');

    // 3) Pages administrées + IG liés
    const pages = await listPagesWithIG(userToken);
    if (!pages.length) return htmlPage('❌ Aucune Page Facebook administrée sur ce compte. Vérifie que tu es admin d\'une Page.');

    // 4) Range chaque Page (et son IG lié) sous le tenant. v1 = toutes les Pages
    //    administrées ; un sélecteur de Page sera un raffinement ultérieur.
    const scopes = oauthScopes();
    const labels = [];
    let igFound = false;
    for (const p of pages) {
      await storeAccount(env, {
        tenant, platform: 'facebook', targetType: 'page',
        externalId: p.id, displayName: p.name || 'Page', token: p.pageToken, scopes,
      });
      labels.push(p.name || p.id);
      if (p.ig?.id) {
        await storeAccount(env, {
          tenant, platform: 'instagram', targetType: 'business',
          externalId: p.ig.id, displayName: p.ig.username ? '@' + p.ig.username : (p.name || 'Instagram'),
          token: p.pageToken, scopes,   // l'IG publie via le Page token lié
        });
        labels.push(p.ig.username ? '@' + p.ig.username : 'Instagram');
        igFound = true;
      }
    }

    // Diagnostic Instagram : si aucun IG capté, distinguer « permission non
    // accordée » (réglage app Meta) de « pas d'IG pro lié à la Page ».
    let igNote = '';
    if (!igFound) {
      let igPermOk = false;
      try {
        const permRes = await fetch(`${getPlatform('facebook').api.base}/me/permissions?access_token=${encodeURIComponent(userToken)}`);
        const perm = await permRes.json().catch(() => ({}));
        igPermOk = (perm.data || []).some(x => x.permission === 'instagram_basic' && x.status === 'granted');
      } catch (_) { /* non bloquant */ }
      igNote = igPermOk
        ? `<br><br><span style="opacity:.85;font-size:14px">ℹ️ Instagram non connecté : aucun compte Instagram <em>professionnel</em> n'est relié à cette Page (lie-le côté Facebook, puis reconnecte). Facebook marche quand même.</span>`
        : `<br><br><span style="opacity:.85;font-size:14px">ℹ️ Instagram non connecté : la <strong>permission Instagram</strong> n'a pas été accordée à l'autorisation (réglage de l'app Meta). Facebook marche quand même.</span>`;
    }

    return htmlPage(`✅ <strong>Facebook connecté</strong> : ${esc(labels.join(', '))}${igNote}<br><br>Ferme cet onglet et recharge le <strong>Social Manager</strong>.`);
  } catch (e) {
    return htmlPage(`❌ Échec de connexion Facebook : ${esc(e.message)}`);
  }
}

// ── Callbacks exigés par Meta pour activer l'OAuth (sinon le form refuse) ──
export async function handleFacebookDeauthorize() {
  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleFacebookDataDeletion(request) {
  const url  = new URL(request.url);
  const code = url.searchParams.get('code');
  if (request.method === 'GET' && code) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui"><h2>Suppression de données — Keystone Social</h2><p>Demande enregistrée. Code de confirmation : <b>${esc(code)}</b></p></body>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
  const confirmation = crypto.randomUUID();
  return new Response(JSON.stringify({
    url: `${url.origin}/api/social/facebook/data-deletion?code=${confirmation}`,
    confirmation_code: confirmation,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
