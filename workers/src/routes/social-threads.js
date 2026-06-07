/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · OAuth Threads (connect) v1.0
   (Sprint Social-4 — câblage du token Threads)

   Threads n'a PAS de token système permanent (≠ FB/IG). On passe par
   un flux OAuth one-time, stocké chiffré dans social_accounts :

   GET /api/social/connect/threads   → 302 vers l'autorisation Threads
   GET /api/social/callback/threads  → échange code → token longue durée
                                        (60 j) → range le compte 'threads'

   Secrets Worker requis :
   - KS_THREADS_APP_ID      (client_id de l'app Threads "Keystone Social")
   - KS_THREADS_APP_SECRET  (client_secret)
   Réutilise KS_ENCRYPTION_KEY (chiffrement AES-GCM du token).

   ⚠ Multi-tenant : la connexion range sous tenant 'default'. Quand on
   passera au self-service, lier le `state` au JWT/tenant du user.
   ═══════════════════════════════════════════════════════════════ */

import { generateId }          from '../lib/auth.js';
import { encrypt }             from '../lib/crypto.js';
import { ensureSocialSchema }  from '../lib/social/schema.js';
import { getPlatform }         from '../lib/social/registry.js';

const REDIRECT_PATH = '/api/social/callback/threads';

// La redirect_uri DOIT être identique à connect et callback, et enregistrée
// dans les réglages Threads de l'app. On la dérive de l'origine du Worker.
function redirectUri(request) {
  return new URL(request.url).origin + REDIRECT_PATH;
}

function htmlPage(msg) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;background:#0b1020;color:#e7e9ee;display:grid;place-items:center;min-height:100vh;margin:0">` +
    `<div style="text-align:center;max-width:480px;padding:28px;font-size:16px;line-height:1.6">${msg}</div></body>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

// ── GET /api/social/connect/threads ───────────────────────────
export async function handleThreadsConnect(request, env) {
  const clientId = env.KS_THREADS_APP_ID;
  if (!clientId) return htmlPage('❌ KS_THREADS_APP_ID non configuré sur le Worker.');

  const cfg    = getPlatform('threads');
  const state  = generateId();                       // anti-CSRF (cookie court)
  const scopes = cfg.auth.scopes.profile.join(',');

  const u = new URL(cfg.auth.authUrl);               // https://threads.net/oauth/authorize
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri(request));
  u.searchParams.set('scope', scopes);               // threads_basic,threads_content_publish
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': u.toString(),
      'Set-Cookie': `ks_th_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

// ── GET /api/social/callback/threads?code=…&state=… ───────────
export async function handleThreadsCallback(request, env) {
  const url   = new URL(request.url);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (oauthErr) return htmlPage(`❌ Autorisation refusée : ${oauthErr}`);
  if (!code)    return htmlPage('❌ Code d\'autorisation manquant.');

  // Vérif state (cookie posé par /connect)
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/ks_th_state=([^;]+)/);
  if (!m || m[1] !== state) return htmlPage('❌ Sécurité : "state" invalide. Relance la connexion depuis /connect/threads.');

  const clientId     = env.KS_THREADS_APP_ID;
  const clientSecret = env.KS_THREADS_APP_SECRET;
  if (!clientId || !clientSecret) return htmlPage('❌ Credentials Threads manquants (KS_THREADS_APP_ID / KS_THREADS_APP_SECRET).');
  if (!env.KS_ENCRYPTION_KEY)     return htmlPage('❌ KS_ENCRYPTION_KEY non configurée.');

  await ensureSocialSchema(env);

  try {
    // 1) code → token court (+ user_id)
    const form = new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      grant_type: 'authorization_code', redirect_uri: redirectUri(request), code,
    });
    const shortRes = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const short = await shortRes.json().catch(() => ({}));
    if (!shortRes.ok || !short.access_token) {
      throw new Error(`échange du code : ${short?.error_message || JSON.stringify(short).slice(0, 200)}`);
    }

    // 2) token court → token longue durée (~60 j)
    const longRes = await fetch('https://graph.threads.net/access_token?' + new URLSearchParams({
      grant_type: 'th_exchange_token', client_secret: clientSecret, access_token: short.access_token,
    }));
    const long = await longRes.json().catch(() => ({}));
    const accessToken = long.access_token || short.access_token;
    const expiresAt   = long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : null;

    // 3) profil (id + username)
    let userId = String(short.user_id || '');
    let username = '';
    try {
      const meRes = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`);
      const me = await meRes.json().catch(() => ({}));
      if (me.id) userId = String(me.id);
      username = me.username || '';
    } catch (_) { /* non bloquant */ }
    if (!userId) throw new Error('user_id Threads introuvable.');

    const displayName = username ? `@${username}` : 'Threads';
    const tenantId    = 'default';
    const scopes      = 'threads_basic,threads_content_publish';
    const acc         = await encrypt(accessToken, env.KS_ENCRYPTION_KEY);

    const existing = await env.DB
      .prepare('SELECT id FROM social_accounts WHERE tenant_id = ? AND platform = ? AND external_id = ?')
      .bind(tenantId, 'threads', userId).first();

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
        VALUES (?, ?, 'threads', 'profile', ?, ?, ?, ?, ?, ?, 'connected')
      `).bind(generateId(), tenantId, userId, displayName, acc.ciphertext, acc.iv, scopes, expiresAt).run();
    }

    return htmlPage(`✅ <strong>Threads connecté</strong> : ${displayName}<br><br>Tu peux fermer cet onglet et retourner au <strong>Social Manager</strong> (recharge la page).`);
  } catch (e) {
    return htmlPage(`❌ Échec de connexion Threads : ${e.message}`);
  }
}
