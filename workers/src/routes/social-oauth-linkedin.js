/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · OAuth self-serve LinkedIn
   (Sprint Social-LinkedIn · Phase 1 — connexion)

   Permet à un CLIENT entitled de connecter LinkedIn via OAuth :
   - target=profile      → « Share on LinkedIn » (w_member_social) : SELF-SERVICE,
                           utilisable dès que l'app LinkedIn est créée.
   - target=organization → Page entreprise (w_organization_social, r_organization_social) :
                           nécessite la VALIDATION LinkedIn (Community Management API),
                           comme l'App Review Meta. Le code est prêt ; tant que LinkedIn
                           n'a pas approuvé, le scope n'est pas accordé → message clair.

   Calqué sur le flux Facebook (social-oauth-fb.js) : state JWT signé (tenant +
   target), échange code→token, identité, rangement chiffré PAR TENANT.

   Secrets Worker requis :
   - KS_LINKEDIN_CLIENT_ID      (Client ID de l'app LinkedIn — À POSER)
   - KS_LINKEDIN_CLIENT_SECRET  (Client Secret — À POSER)
   Réutilise KS_ENCRYPTION_KEY (chiffrement du token) + le secret JWT (state).

   La redirect_uri ('/api/social/callback/linkedin', dérivée de l'origine Worker)
   DOIT être enregistrée à l'identique dans les réglages OAuth de l'app LinkedIn.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin, generateId } from '../lib/auth.js';
import { encrypt }                  from '../lib/crypto.js';
import { signJWT, verifyJWT }       from '../lib/jwt.js';
import { ensureSocialSchema }       from '../lib/social/schema.js';
import { getPlatform }              from '../lib/social/registry.js';
import { buildAuthUrl, exchangeCodeForToken } from '../lib/social/adapters/linkedin.js';
import { socialEntitled, socialTenantOf } from './social.js';

const REDIRECT_PATH = '/api/social/callback/linkedin';
const STATE_TTL     = 600;   // 10 min — le state signé expire vite

function redirectUri(request) {
  return new URL(request.url).origin + REDIRECT_PATH;
}

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

// ── GET /api/social/connect/linkedin?target=profile|organization ──
// Authentifié + entitled. Renvoie { authUrl } ; le front y navigue.
export async function handleLinkedInConnect(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);

  const clientId = env.KS_LINKEDIN_CLIENT_ID;
  if (!clientId || !env.KS_LINKEDIN_CLIENT_SECRET) {
    return err('OAuth LinkedIn non configuré (KS_LINKEDIN_CLIENT_ID / KS_LINKEDIN_CLIENT_SECRET manquants)', 500, origin);
  }

  const target = new URL(request.url).searchParams.get('target') === 'organization' ? 'organization' : 'profile';
  const tenant = await socialTenantOf(request, env);
  const state  = await signJWT({ purpose: 'li_oauth', tenant, target }, env, STATE_TTL);
  const authUrl = buildAuthUrl({ clientId, redirectUri: redirectUri(request), state, target });

  return json({ authUrl, target }, 200, origin);
}

// Upsert d'un compte social chiffré, scopé tenant (miroir du callback Facebook).
// LinkedIn : token ≈ 60 j → on renseigne expires_at pour le suivi de péremption.
async function storeAccount(env, { tenant, platform, targetType, externalId, displayName, token, scopes, expiresInSec }) {
  const acc = await encrypt(token, env.KS_ENCRYPTION_KEY);
  const expiresAt = expiresInSec ? new Date(Date.now() + expiresInSec * 1000).toISOString() : null;
  const existing = await env.DB
    .prepare('SELECT id FROM social_accounts WHERE tenant_id = ? AND platform = ? AND external_id = ?')
    .bind(tenant, platform, externalId).first();
  if (existing) {
    await env.DB.prepare(`
      UPDATE social_accounts
      SET access_ciphertext=?, access_iv=?, display_name=?, scopes=?, expires_at=?, status='connected', updated_at=datetime('now')
      WHERE id=?
    `).bind(acc.ciphertext, acc.iv, displayName, scopes, expiresAt, existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO social_accounts
        (id, tenant_id, platform, target_type, external_id, display_name, access_ciphertext, access_iv, scopes, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected')
    `).bind(generateId(), tenant, platform, targetType, externalId, displayName, acc.ciphertext, acc.iv, scopes, expiresAt).run();
  }
}

// Liste les Pages (organisations) que le membre ADMINISTRE. Nécessite le scope
// r_organization_social — non accordé tant que LinkedIn n'a pas validé l'app
// (Community Management API) → renvoie [] proprement (message « en attente »).
async function listAdminOrganizations(accessToken) {
  const cfg = getPlatform('linkedin');
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    [cfg.api.versionHeader]: cfg.api.version,
  };
  let res;
  try {
    res = await fetch('https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', { headers });
  } catch (_) { return []; }
  if (!res.ok) return [];   // scope non accordé (review pending) / aucune org
  const data = await res.json().catch(() => ({}));
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const orgs = [];
  for (const el of elements.slice(0, 10)) {
    const urn = el.organization;   // urn:li:organization:<id>
    if (!urn || typeof urn !== 'string') continue;
    let name = urn;
    try {
      const id = urn.split(':').pop();
      const oRes = await fetch(`https://api.linkedin.com/rest/organizations/${id}`, { headers });
      if (oRes.ok) { const o = await oRes.json(); name = o.localizedName || o.vanityName || o.name || urn; }
    } catch (_) { /* nom best-effort */ }
    orgs.push({ urn, name });
  }
  return orgs;
}

// ── GET /api/social/callback/linkedin?code=…&state=… ──────────
export async function handleLinkedInCallback(request, env) {
  const url      = new URL(request.url);
  const code     = url.searchParams.get('code');
  const state    = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (oauthErr) return htmlPage(`❌ Autorisation refusée : ${esc(oauthErr)}`);
  if (!code || !state) return htmlPage('❌ Paramètres manquants (code/state).');

  // 1) Vérif du state signé → tenant + target.
  let tenant, target;
  try {
    const claims = await verifyJWT(state, env);
    if (claims.purpose !== 'li_oauth' || !claims.tenant) throw new Error('purpose/tenant');
    tenant = claims.tenant;
    target = claims.target === 'organization' ? 'organization' : 'profile';
  } catch (_) {
    return htmlPage('❌ Sécurité : lien de connexion invalide ou expiré. Relance depuis le Social Manager.');
  }

  const clientId     = env.KS_LINKEDIN_CLIENT_ID;
  const clientSecret = env.KS_LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return htmlPage('❌ OAuth LinkedIn non configuré sur le Worker (secrets manquants).');
  if (!env.KS_ENCRYPTION_KEY)     return htmlPage('❌ KS_ENCRYPTION_KEY non configurée.');

  await ensureSocialSchema(env);

  try {
    // 2) code → token (+ identité profil via OpenID userinfo, faite par l'adapter)
    const tok = await exchangeCodeForToken({ code, clientId, clientSecret, redirectUri: redirectUri(request) });
    if (!tok.accessToken) throw new Error('token introuvable');
    const scopesStr = (getPlatform('linkedin').auth.scopes[target] || []).join(' ');

    // 3a) Page entreprise : ranger chaque organisation administrée.
    if (target === 'organization') {
      const orgs = await listAdminOrganizations(tok.accessToken);
      if (!orgs.length) {
        return htmlPage('ℹ️ Aucune <strong>Page LinkedIn</strong> administrée détectée — ou l\'accès « Pages » (Community Management API) n\'est pas encore <strong>validé par LinkedIn</strong>. Ton <strong>profil</strong>, lui, fonctionne dès maintenant.');
      }
      const labels = [];
      for (const o of orgs) {
        await storeAccount(env, {
          tenant, platform: 'linkedin', targetType: 'organization',
          externalId: o.urn, displayName: o.name || o.urn, token: tok.accessToken,
          scopes: scopesStr, expiresInSec: tok.expiresInSec,
        });
        labels.push(o.name || o.urn);
      }
      return htmlPage(`✅ <strong>Page(s) LinkedIn connectée(s)</strong> : ${esc(labels.join(', '))}<br><br>Ferme cet onglet et recharge le <strong>Social Manager</strong>.`);
    }

    // 3b) Profil membre : l'URN auteur vient de userinfo (résolu par l'adapter).
    if (!tok.externalId) throw new Error('identité LinkedIn introuvable (userinfo) — vérifie les scopes openid/profile.');
    await storeAccount(env, {
      tenant, platform: 'linkedin', targetType: 'profile',
      externalId: tok.externalId, displayName: tok.displayName || 'Profil LinkedIn',
      token: tok.accessToken, scopes: scopesStr, expiresInSec: tok.expiresInSec,
    });
    return htmlPage(`✅ <strong>LinkedIn connecté</strong> : ${esc(tok.displayName || 'ton profil')}<br><br>Ferme cet onglet et recharge le <strong>Social Manager</strong>.`);
  } catch (e) {
    return htmlPage(`❌ Échec de connexion LinkedIn : ${esc(e.message)}`);
  }
}
