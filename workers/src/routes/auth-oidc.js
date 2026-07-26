/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — SSO entreprise OIDC (AUTH-6)
   ═══════════════════════════════════════════════════════════════
   Relying Party OpenID Connect générique (Microsoft Entra ID,
   Google Workspace, tout IdP conforme). ZÉRO dépendance : découverte
   .well-known, PKCE S256, vérification RS256 via WebCrypto.

   PRINCIPE CLÉ : le SSO n'émet PAS de JWT directement. Un login
   OIDC réussi débouche sur un magic-link à usage unique
   (issueMagicLink) → redirection vers /auth/magic?token=… → la page
   « Confirmer ma connexion » → consume → JWT. On réutilise TOUTE la
   plomberie durcie AUTH-1→4 (usage unique, anti-course, audit),
   aucun jeton de session ne transite dans une URL.

   Endpoints :
     GET  /api/auth/sso/lookup?domain=entreprise.fr   Public
       → { sso: true|false } — le front sait s'il doit proposer SSO.
     GET  /api/auth/oidc/start?domain=entreprise.fr   Public
       → 302 vers l'IdP (ou redirect front avec sso_error).
     GET  /api/auth/oidc/callback?code&state          Public (retour IdP)
       → 302 vers /auth/magic?token=… (ou ?sso_error=…).
     GET/POST/DELETE /api/admin/sso-connections       Admin (Bearer)
       → CRUD des connexions ; le client_secret est chiffré
         AES-256-GCM (KS_ENCRYPTION_KEY), jamais renvoyé en clair.

   Multi-tenant Entra : UNE app registration Microsoft suffit pour
   tous les clients ; on crée UNE connexion par client avec l'issuer
   de SON tenant (https://login.microsoftonline.com/<tenant>/v2.0)
   → le check `iss` strict reste valable. Google Workspace :
   issuer = https://accounts.google.com pour tout le monde, le
   cloisonnement se fait par email_domain.

   Sécurité :
     - state 32 bytes usage unique (DELETE gardé, anti-rejeu)
     - nonce vérifié dans l'id_token
     - PKCE S256 (verifier jamais exposé)
     - signature RS256 vérifiée contre le JWKS de l'IdP (par kid)
     - iss / aud / exp / email_verified contrôlés
     - l'email DOIT appartenir au domaine de la connexion (un IdP
       compromis ne peut pas se faire passer pour un autre client)
     - l'email doit correspondre à un compte Keystone actif — le SSO
       AUTHENTIFIE, il ne provisionne pas.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin, generateId, generateToken, requireAdmin } from '../lib/auth.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { issueMagicLink } from './auth-magic-link.js';

const STATE_TTL_MIN = 10;

// ── Auto-migration ──────────────────────────────────────────────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sso_connections (
      id           TEXT PRIMARY KEY,
      email_domain TEXT NOT NULL UNIQUE,
      licence_key  TEXT,
      issuer       TEXT NOT NULL,
      client_id    TEXT NOT NULL,
      secret_ct    TEXT NOT NULL,
      secret_iv    TEXT NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run().catch(() => {});
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS oidc_states (
      state      TEXT PRIMARY KEY,
      nonce      TEXT NOT NULL,
      verifier   TEXT NOT NULL,
      conn_id    TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run().catch(() => {});
  _schemaReady = true;
}

// ── Helpers ─────────────────────────────────────────────────────
function _normDomain(v) {
  return (v || '').toString().trim().toLowerCase().replace(/^@/, '');
}
function _domainValid(v) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v);
}
function _b64u(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function _b64uDecodeToBytes(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function _b64uDecodeJson(b64u) {
  return JSON.parse(new TextDecoder().decode(_b64uDecodeToBytes(b64u)));
}
async function _s256Challenge(verifier) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return _b64u(buf);
}

// Origine front (même logique que le magic-link)
function _frontBase(env) {
  const allowed = (env.KS_ALLOWED_ORIGIN || '*').split(',')[0].trim();
  return allowed && allowed !== '*' ? allowed : 'https://protein-keystone.com';
}
function _redirectFrontError(env, code) {
  return Response.redirect(`${_frontBase(env)}/auth/magic?sso_error=${encodeURIComponent(code)}`, 302);
}

// Découverte OIDC, cache mémoire par issuer (vie de l'isolate)
const _discoCache = new Map();
async function _discover(issuer) {
  const key = issuer.replace(/\/+$/, '');
  const hit = _discoCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.doc;
  const res = await fetch(`${key}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`discovery ${res.status}`);
  const doc = await res.json();
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error('discovery incomplète');
  }
  _discoCache.set(key, { doc, exp: Date.now() + 10 * 60 * 1000 });
  return doc;
}

// Vérification RS256 de l'id_token contre le JWKS de l'IdP
async function _verifyIdToken(idToken, { jwksUri, issuer, clientId, nonce }) {
  const parts = (idToken || '').split('.');
  if (parts.length !== 3) throw new Error('id_token malformé');
  const header  = _b64uDecodeJson(parts[0]);
  const payload = _b64uDecodeJson(parts[1]);

  if (header.alg !== 'RS256') throw new Error(`alg ${header.alg} refusé`);

  const jwksRes = await fetch(jwksUri);
  if (!jwksRes.ok) throw new Error(`jwks ${jwksRes.status}`);
  const jwks = await jwksRes.json();
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid && (k.use === 'sig' || !k.use));
  if (!jwk) throw new Error('kid inconnu du JWKS');

  const key = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key,
    _b64uDecodeToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error('signature invalide');

  const now = Math.floor(Date.now() / 1000);
  const issNorm = (v) => (v || '').replace(/\/+$/, '');
  if (issNorm(payload.iss) !== issNorm(issuer)) throw new Error('iss inattendu');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) throw new Error('aud inattendu');
  if (typeof payload.exp !== 'number' || payload.exp < now - 60) throw new Error('id_token expiré');
  if (payload.nonce !== nonce) throw new Error('nonce inattendu');
  if (payload.email_verified === false) throw new Error('email non vérifié chez l\'IdP');

  return payload;
}

async function _loadConnectionByDomain(env, domain) {
  return env.DB
    .prepare('SELECT * FROM sso_connections WHERE email_domain = ? AND enabled = 1 LIMIT 1')
    .bind(domain)
    .first();
}

// ═══════════════════════════════════════════════════════════════
// GET /api/auth/sso/lookup?domain=…
// ═══════════════════════════════════════════════════════════════
export async function handleSsoLookup(request, env) {
  const origin = getAllowedOrigin(env, request);
  await _ensureSchema(env);
  const domain = _normDomain(new URL(request.url).searchParams.get('domain'));
  if (!_domainValid(domain)) return json({ sso: false }, 200, origin);
  const conn = await _loadConnectionByDomain(env, domain);
  return json({ sso: !!conn }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/auth/oidc/start?domain=…
// ═══════════════════════════════════════════════════════════════
export async function handleOidcStart(request, env) {
  await _ensureSchema(env);
  const url = new URL(request.url);
  const domain = _normDomain(url.searchParams.get('domain'));
  if (!_domainValid(domain)) return _redirectFrontError(env, 'bad_domain');

  const conn = await _loadConnectionByDomain(env, domain);
  if (!conn) return _redirectFrontError(env, 'no_sso');

  let disco;
  try { disco = await _discover(conn.issuer); }
  catch (e) {
    console.warn('[oidc] discovery failed', conn.issuer, e.message);
    return _redirectFrontError(env, 'idp_unreachable');
  }

  // Purge opportuniste des états expirés (table petite, pas de cron dédié)
  await env.DB.prepare("DELETE FROM oidc_states WHERE expires_at < datetime('now')").run().catch(() => {});

  const state    = generateToken(32);
  const nonce    = generateToken(32);
  const verifier = generateToken(32);
  const expiresAt = new Date(Date.now() + STATE_TTL_MIN * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);

  await env.DB.prepare(
    'INSERT INTO oidc_states (state, nonce, verifier, conn_id, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(state, nonce, verifier, conn.id, expiresAt).run();

  const redirectUri = `${url.origin}/api/auth/oidc/callback`;
  const authUrl = new URL(disco.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', conn.client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('code_challenge', await _s256Challenge(verifier));
  authUrl.searchParams.set('code_challenge_method', 'S256');
  // Confort : pré-remplir le sélecteur de compte avec le domaine attendu
  authUrl.searchParams.set('login_hint', `@${domain}`);

  return Response.redirect(authUrl.toString(), 302);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/auth/oidc/callback?code&state
// ═══════════════════════════════════════════════════════════════
export async function handleOidcCallback(request, env) {
  await _ensureSchema(env);
  if (!env.KS_ENCRYPTION_KEY) return err('Server: KS_ENCRYPTION_KEY manquant', 500, '*');

  const url   = new URL(request.url);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error')) {
    console.warn('[oidc] IdP error:', url.searchParams.get('error'));
    return _redirectFrontError(env, 'idp_denied');
  }
  if (!code || !state) return _redirectFrontError(env, 'bad_callback');

  // État : usage unique STRICT — lecture puis DELETE gardé (anti-rejeu,
  // même garantie que consumed_at côté magic-link).
  const st = await env.DB
    .prepare('SELECT * FROM oidc_states WHERE state = ? LIMIT 1')
    .bind(state)
    .first();
  if (!st) return _redirectFrontError(env, 'state_unknown');
  const del = await env.DB.prepare('DELETE FROM oidc_states WHERE state = ?').bind(state).run();
  if ((del?.meta?.changes ?? 0) !== 1) return _redirectFrontError(env, 'state_replayed');
  if (new Date(st.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    return _redirectFrontError(env, 'state_expired');
  }

  const conn = await env.DB
    .prepare('SELECT * FROM sso_connections WHERE id = ? AND enabled = 1 LIMIT 1')
    .bind(st.conn_id)
    .first();
  if (!conn) return _redirectFrontError(env, 'conn_disabled');

  let disco;
  try { disco = await _discover(conn.issuer); }
  catch (_) { return _redirectFrontError(env, 'idp_unreachable'); }

  // Échange code → tokens
  let tokens;
  try {
    const clientSecret = await decrypt(conn.secret_ct, conn.secret_iv, env.KS_ENCRYPTION_KEY);
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  `${url.origin}/api/auth/oidc/callback`,
      client_id:     conn.client_id,
      client_secret: clientSecret,
      code_verifier: st.verifier,
    });
    const res = await fetch(disco.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`token ${res.status}: ${txt.slice(0, 150)}`);
    }
    tokens = await res.json();
  } catch (e) {
    console.warn('[oidc] token exchange failed', e.message);
    return _redirectFrontError(env, 'token_exchange');
  }

  // Vérification cryptographique de l'id_token
  let claims;
  try {
    claims = await _verifyIdToken(tokens.id_token, {
      jwksUri:  disco.jwks_uri,
      issuer:   conn.issuer,
      clientId: conn.client_id,
      nonce:    st.nonce,
    });
  } catch (e) {
    console.warn('[oidc] id_token verify failed', e.message);
    return _redirectFrontError(env, 'idtoken_invalid');
  }

  const email = (claims.email || '').toString().trim().toLowerCase();
  if (!email) return _redirectFrontError(env, 'no_email_claim');
  // Cloisonnement : l'email doit appartenir au domaine de LA connexion
  if (email.split('@')[1] !== conn.email_domain) {
    return _redirectFrontError(env, 'email_domain_mismatch');
  }

  // Le SSO authentifie, il ne provisionne pas : compte Keystone requis.
  let memberRow = await env.DB
    .prepare("SELECT * FROM licence_emails WHERE email = ? AND status != 'revoked' ORDER BY invited_at DESC LIMIT 1")
    .bind(email)
    .first();
  let licenceKey = memberRow?.licence_key || null;
  if (!licenceKey) {
    const legacy = await env.DB
      .prepare('SELECT key FROM licences WHERE LOWER(owner) = ? AND is_active = 1 LIMIT 1')
      .bind(email)
      .first();
    licenceKey = legacy?.key || null;
  }
  if (!licenceKey) return _redirectFrontError(env, 'no_account');

  // Passage de relais à la plomberie durcie : magic-link à usage
  // unique, consommé par le bouton « Confirmer ma connexion ».
  const issued = await issueMagicLink(env, {
    email,
    licenceKey,
    purpose: 'magic_login',
  });

  await audit(env, {
    action:  'oidc_login',
    actor:   email,
    target:  licenceKey,
    details: { issuer: conn.issuer, domain: conn.email_domain, via: 'sso' },
    request,
  });

  return Response.redirect(issued.magicUrl, 302);
}

// ═══════════════════════════════════════════════════════════════
// Admin — CRUD des connexions SSO (Bearer KS_ADMIN_SECRET)
// ═══════════════════════════════════════════════════════════════
export async function handleSsoConnectionsAdmin(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await _ensureSchema(env);

  if (request.method === 'GET') {
    const rows = await env.DB
      .prepare('SELECT id, email_domain, licence_key, issuer, client_id, enabled, created_at FROM sso_connections ORDER BY created_at DESC')
      .all();
    return json({ connections: rows.results || [] }, 200, origin);
  }

  if (request.method === 'POST') {
    if (!env.KS_ENCRYPTION_KEY) return err('Server: KS_ENCRYPTION_KEY manquant', 500, origin);
    const body = await parseBody(request);
    const domain   = _normDomain(body.email_domain);
    const issuer   = (body.issuer || '').toString().trim().replace(/\/+$/, '');
    const clientId = (body.client_id || '').toString().trim();
    const secret   = (body.client_secret || '').toString();
    const enabled  = body.enabled === false ? 0 : 1;
    const licenceKey = (body.licence_key || '').toString().trim().toUpperCase() || null;

    if (!_domainValid(domain))          return err('email_domain invalide', 400, origin);
    // https obligatoire — seule exception : loopback (banc de test local)
    if (!/^https:\/\//.test(issuer) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(issuer)) {
      return err('issuer doit être en https', 400, origin);
    }
    if (!clientId)                      return err('client_id requis', 400, origin);

    const existing = await env.DB
      .prepare('SELECT * FROM sso_connections WHERE email_domain = ? LIMIT 1')
      .bind(domain)
      .first();
    // Secret optionnel en update (on garde l'ancien) — requis en création
    if (!secret && !existing) return err('client_secret requis', 400, origin);

    let ct = existing?.secret_ct, iv = existing?.secret_iv;
    if (secret) {
      const enc = await encrypt(secret, env.KS_ENCRYPTION_KEY);
      ct = enc.ciphertext; iv = enc.iv;
    }

    const id = existing?.id || generateId();
    await env.DB.prepare(`
      INSERT INTO sso_connections (id, email_domain, licence_key, issuer, client_id, secret_ct, secret_iv, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email_domain) DO UPDATE SET
        licence_key = excluded.licence_key,
        issuer      = excluded.issuer,
        client_id   = excluded.client_id,
        secret_ct   = excluded.secret_ct,
        secret_iv   = excluded.secret_iv,
        enabled     = excluded.enabled
    `).bind(id, domain, licenceKey, issuer, clientId, ct, iv, enabled).run();

    return json({ ok: true, id, email_domain: domain, updated: !!existing }, 200, origin);
  }

  if (request.method === 'DELETE') {
    const body = await parseBody(request);
    const domain = _normDomain(body.email_domain);
    const r = await env.DB.prepare('DELETE FROM sso_connections WHERE email_domain = ?').bind(domain).run();
    return json({ ok: true, deleted: r?.meta?.changes ?? 0 }, 200, origin);
  }

  return err('Méthode non supportée', 405, origin);
}
