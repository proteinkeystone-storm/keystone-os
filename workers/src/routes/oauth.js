/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — OAuth 2.1 pour le serveur MCP (sprint 2)
   ───────────────────────────────────────────────────────────────
   Ce que ce module fait : permettre à claude.ai, Claude Desktop et
   Claude Code d'obtenir un jeton pour /mcp SANS que l'utilisateur ne
   colle quoi que ce soit — il s'identifie par magic link / code e-mail
   sur la page de consentement (connect.html), puis autorise.

   Le Worker est à la fois SERVEUR D'AUTORISATION et RESSOURCE :
     GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728
     GET  /.well-known/oauth-authorization-server[/mcp] RFC 8414
     POST /oauth/register     DCR (RFC 7591), clients publics ou à secret
     GET  /oauth/authorize    valide, mémorise la demande, → connect.html
     GET  /oauth/request      la page lit la demande (client, hôte, portées)
     GET  /oauth/preview      la page montre CE QUE Claude verra (JWT)
     POST /oauth/approve      consentement (JWT) → code → redirection
     POST /oauth/token        code + PKCE S256 → access (1 h) + refresh
                              (90 j, rotatif) ; refresh mort → invalid_grant
     POST /oauth/revoke       RFC 7009
     GET/DELETE /api/mcp/connections[/:id]   la tuile « Connecteur IA »

   Décisions (HANDOFF_MCP_CLAUDE §1 et §4 sprint 2) :
   · Jetons OPAQUES, hachés SHA-256 en base (jamais le jeton). Les deux
     jetons embarquent le SECRET DE CONNEXION (brief §3 étape 1) :
       ksa_<aléa>.<secret>  /  ksr_<aléa>.<secret>
     l'aléa est propre au jeton et tourne, le secret est stable pour la
     connexion ; la base ne garde que hash(aléa) et hash(secret).
     Révoquer détruit hash(secret) : tout jeton en circulation meurt.
   · Un refresh déjà tourné, représenté = réutilisation (RFC 9700) →
     invalid_grant ET révocation de la connexion entière.
   · Redirections acceptées : claude.ai / claude.com (callback MCP) et
     loopback localhost / 127.0.0.1 PORT IGNORÉ (Claude Code, RFC 8252).
   · Portées : keystone.read · keystone.write · offline_access. Sprint 2
     n'exige que keystone.read (tout est lecture) ; keystone.write est
     vérifié par les outils d'écriture au sprint 3.
   · Le tenant n'est JAMAIS un paramètre : /mcp rejoue les routes avec un
     JWT interne minté depuis la connexion (sub, plan relus en base).
   · Rien d'annoncé : aucune page publique ne pointe ici.
   ═══════════════════════════════════════════════════════════════ */
import { json, err, parseBody, getAllowedOrigin, generateId, generateToken } from '../lib/auth.js';
import { encrypt as kmsEncrypt, decrypt as kmsDecrypt } from '../lib/crypto.js';
import { requireJWT }                     from '../lib/jwt.js';
import { ipHashOf, ipRateExceeded, ipRateBump } from '../lib/ip-throttle.js';
import { audit }                          from '../lib/audit.js';

export const SCOPES          = ['keystone.read', 'keystone.write', 'offline_access'];
export const ACCESS_PREFIX   = 'ksa_';
export const REFRESH_PREFIX  = 'ksr_';
const ACCESS_TTL_S   = 60 * 60;             // 1 h
const REFRESH_TTL_S  = 90 * 24 * 60 * 60;   // 90 j glissants
const REQUEST_TTL_S  = 10 * 60;             // demande d'autorisation en attente de consentement
const CODE_TTL_S     = 10 * 60;             // code émis, à échanger
const CLIENT_NAME_MAX = 80;
const CAP_REGISTER_PER_IP_DAY  = 100;
const CAP_AUTHORIZE_PER_IP_DAY = 300;
const AUTH_METHODS   = new Set(['none', 'client_secret_post', 'client_secret_basic']);
/* Callbacks Claude (claude.ai / claude.com) — vérifiés le 16/09/2026,
   https://claude.com/docs/connectors/building/authentication */
const CLAUDE_CALLBACKS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
]);

/* ── Aides ── */
const nowIso   = () => new Date().toISOString();
const plusIso  = (s) => new Date(Date.now() + s * 1000).toISOString();
const b64u     = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const randB64u = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function pkceChallengeOf(verifier) {
  return b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}
function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const escHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Réponses OAuth (RFC 6749 §5.2) — jamais de cache, CORS ouvert : ces
   points d'entrée sont publics par nature (PKCE / hash protègent). */
function oauthJson(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'Pragma': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
      ...extra,
    },
  });
}
const oauthError = (error, description, status = 400) => oauthJson({ error, error_description: description }, status);

/* ── Schéma (à la volée, miroir de migrations/015_mcp_oauth.sql) ── */
let _ready = false;
export async function ensureOauthSchema(env) {
  if (_ready) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS oauth_clients (client_id TEXT PRIMARY KEY, client_name TEXT NOT NULL, redirect_uris TEXT NOT NULL,
       grant_types TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]', auth_method TEXT NOT NULL DEFAULT 'none',
       secret_hash TEXT, client_uri TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS oauth_codes (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, scope TEXT NOT NULL,
       state TEXT, code_challenge TEXT NOT NULL, code_challenge_method TEXT NOT NULL DEFAULT 'S256', resource TEXT,
       status TEXT NOT NULL DEFAULT 'pending', sub TEXT, licence_key TEXT, email TEXT, code_hash TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, consumed_at TEXT)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_codes_hash ON oauth_codes(code_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_codes(expires_at)`,
    `CREATE TABLE IF NOT EXISTS mcp_connections (id TEXT PRIMARY KEY, sub TEXT NOT NULL, licence_key TEXT NOT NULL, email TEXT, plan_at_consent TEXT,
       client_id TEXT NOT NULL, client_name TEXT NOT NULL, redirect_host TEXT, scope TEXT NOT NULL, secret_hash TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT, revoked_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_connections_sub ON mcp_connections(sub, revoked_at)`,
    `CREATE TABLE IF NOT EXISTS mcp_tokens (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, kind TEXT NOT NULL, token_hash TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, rotated_at TEXT)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tokens_hash ON mcp_tokens(token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_tokens_conn ON mcp_tokens(connection_id, kind)`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_tokens_expires ON mcp_tokens(expires_at)`,
  ];
  /* Sprint 5 (migration 018) — colonnes ajoutées, gardées (SQLite refuse un ALTER répété) */
  const alters = [
    'ALTER TABLE oauth_codes ADD COLUMN secret_enc TEXT', 'ALTER TABLE oauth_codes ADD COLUMN secret_iv TEXT',
    'ALTER TABLE mcp_connections ADD COLUMN request_id TEXT',
    `CREATE TABLE IF NOT EXISTS mcp_mirror (sub TEXT NOT NULL, connection_id TEXT NOT NULL, pad TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL,
       size_bytes INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (sub, connection_id, pad))`,
  ];
  try {
    for (const s of stmts) await env.DB.prepare(s).run();
    for (const a of alters) { try { await env.DB.prepare(a).run(); } catch (_) { /* déjà là */ } }
    _ready = true;
  }
  catch (e) { console.warn('[oauth] schema init failed:', e.message); }
}

/* ── URL de la page de consentement (front Vercel) ── */
function connectPageUrl(env) {
  if (env.KS_CONNECT_URL) return String(env.KS_CONNECT_URL).replace(/\/$/, '');
  const first = (env.KS_ALLOWED_ORIGIN || '*').split(',')[0].trim();
  const base  = first && first !== '*' ? first : 'https://protein-keystone.com';
  return `${base}/connect`;
}

/* ── Redirections acceptées ── */
function isLoopback(u) {
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
}
export function redirectUriAllowed(uri, env) {
  let u; try { u = new URL(uri); } catch (_) { return false; }
  if (u.hash) return false;
  if (CLAUDE_CALLBACKS.has(u.origin + u.pathname)) return true;
  if (isLoopback(u)) return true;
  const extra = String(env?.KS_OAUTH_EXTRA_REDIRECTS || '').split(',').map(s => s.trim()).filter(Boolean);
  return extra.some(x => uri === x || (x.endsWith('*') && uri.startsWith(x.slice(0, -1))));
}
/* Correspondance entre l'URI présentée et une URI enregistrée : exacte,
   sauf loopback où le PORT est ignoré (RFC 8252 §7.3 — Claude Code). */
function redirectMatches(presented, registered) {
  if (presented === registered) return true;
  let a, b; try { a = new URL(presented); b = new URL(registered); } catch (_) { return false; }
  return isLoopback(a) && isLoopback(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}
const hostOf = (uri) => { try { return new URL(uri).host; } catch (_) { return null; } };

/* ── Portées ── */
function grantScope(requested) {
  const asked = String(requested || '').split(/[\s+]+/).filter(Boolean);
  if (!asked.length) return SCOPES.join(' ');
  const kept = asked.filter(s => SCOPES.includes(s));
  /* Portées inconnues ignorées (un client peut en demander de génériques) :
     s'il ne reste rien de connu, on accorde le jeu complet — c'est ce que
     l'écran de consentement affiche, et le serveur reste seul juge. */
  return (kept.length ? kept : SCOPES).join(' ');
}

/* ═══════════════════════════════════════════════════════════════
   MÉTADONNÉES — .well-known
   ═══════════════════════════════════════════════════════════════ */
export function handleWellKnown(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const p = url.pathname.replace(/\/$/, '');
  const common = { 'Cache-Control': 'public, max-age=300' };
  if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp') {
    return oauthJson({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'Keystone OS',
      resource_documentation: 'https://protein-keystone.com',
    }, 200, common);
  }
  if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/oauth-authorization-server/mcp') {
    return oauthJson({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: SCOPES,
      service_documentation: 'https://protein-keystone.com',
      ui_locales_supported: ['fr-FR'],
    }, 200, common);
  }
  return oauthJson({ error: 'not_found' }, 404);
}

/* ═══════════════════════════════════════════════════════════════
   DCR — POST /oauth/register (RFC 7591)
   ═══════════════════════════════════════════════════════════════ */
export async function handleOauthRegister(request, env) {
  await ensureOauthSchema(env);
  const ip = await ipHashOf(request);
  try { if (await ipRateExceeded(env, 'oauth:register', ip, CAP_REGISTER_PER_IP_DAY)) return oauthError('invalid_client_metadata', 'Trop d’enregistrements depuis cette adresse aujourd’hui.', 429); } catch (_) {}

  let body; try { body = await request.json(); } catch (_) { return oauthError('invalid_client_metadata', 'Corps JSON attendu.'); }
  if (!body || typeof body !== 'object') return oauthError('invalid_client_metadata', 'Corps JSON attendu.');

  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10) return oauthError('invalid_redirect_uri', 'redirect_uris : entre 1 et 10 URI.');
  const bad = uris.find(u => !redirectUriAllowed(u, env));
  if (bad) return oauthError('invalid_redirect_uri', `URI de redirection non acceptée : ${bad}`);

  const grants = Array.isArray(body.grant_types) && body.grant_types.length ? body.grant_types.map(String) : ['authorization_code', 'refresh_token'];
  if (grants.some(g => !['authorization_code', 'refresh_token'].includes(g))) return oauthError('invalid_client_metadata', 'grant_types : authorization_code et refresh_token seulement.');
  const rts = Array.isArray(body.response_types) && body.response_types.length ? body.response_types.map(String) : ['code'];
  if (rts.some(r => r !== 'code')) return oauthError('invalid_client_metadata', 'response_types : code seulement.');
  const method = String(body.token_endpoint_auth_method || 'none');
  if (!AUTH_METHODS.has(method)) return oauthError('invalid_client_metadata', 'token_endpoint_auth_method non supportée.');

  const name = String(body.client_name || 'Client MCP').replace(/[ -]/g, ' ').trim().slice(0, CLIENT_NAME_MAX) || 'Client MCP';
  const clientUri = typeof body.client_uri === 'string' && /^https:\/\//.test(body.client_uri) ? body.client_uri.slice(0, 200) : null;
  const clientId = 'ksc_' + randB64u(24);
  let secret = null, secretHash = null;
  if (method !== 'none') { secret = randB64u(32); secretHash = await sha256Hex(secret); }

  await env.DB.prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris, grant_types, auth_method, secret_hash, client_uri) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(clientId, name, JSON.stringify(uris), JSON.stringify(grants), method, secretHash, clientUri).run();
  try { await ipRateBump(env, 'oauth:register', ip); } catch (_) {}

  const out = {
    client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name, redirect_uris: uris, grant_types: grants, response_types: ['code'],
    token_endpoint_auth_method: method, scope: SCOPES.join(' '),
  };
  if (secret) { out.client_secret = secret; out.client_secret_expires_at = 0; }
  if (clientUri) out.client_uri = clientUri;
  return oauthJson(out, 201);
}

async function loadClient(env, clientId) {
  if (!clientId) return null;
  return env.DB.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').bind(String(clientId)).first();
}
/* Authentifie le client à /token et /revoke : secret (post ou basic) si
   le client en a un, simple client_id sinon (client public + PKCE). */
async function authenticateClient(request, env, form) {
  let clientId = form.get('client_id'), secret = form.get('client_secret');
  const basic = (request.headers.get('Authorization') || '').match(/^Basic\s+(.+)$/i);
  if (basic) {
    try {
      const [id, sec] = atob(basic[1]).split(':');
      clientId = decodeURIComponent(id || ''); secret = decodeURIComponent(sec || '');
    } catch (_) { return { error: 'invalid_client' }; }
  }
  const client = await loadClient(env, clientId);
  if (!client) return { error: 'invalid_client' };
  if (client.auth_method !== 'none') {
    if (!secret || !safeEq(await sha256Hex(secret), client.secret_hash || '')) return { error: 'invalid_client' };
  }
  return { client };
}

/* ═══════════════════════════════════════════════════════════════
   GET /oauth/authorize — valide, mémorise, envoie sur connect.html
   ═══════════════════════════════════════════════════════════════ */
function htmlError(title, detail, status = 400) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Keystone OS</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0e14;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.02em}
.c{max-width:440px;padding:40px 32px;border:1px solid #1f2a37;border-radius:16px;background:#111720;text-align:center}h1{font-size:20px;font-weight:900;margin:0 0 10px}p{color:#94a3b8;font-size:14px;line-height:1.55;margin:0}</style></head>
<body><div class="c"><h1>${escHtml(title)}</h1><p>${escHtml(detail)}</p></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function redirectWith(redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return new Response(null, { status: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } });
}

export async function handleOauthAuthorize(request, env) {
  await ensureOauthSchema(env);
  const q = new URL(request.url).searchParams;
  const clientId = q.get('client_id'), redirectUri = q.get('redirect_uri');
  const client = await loadClient(env, clientId);
  if (!client) return htmlError('Client inconnu', 'Cette application n’est pas enregistrée auprès de Keystone OS. Réessayez l’ajout du connecteur depuis Claude.');
  let registered = []; try { registered = JSON.parse(client.redirect_uris || '[]'); } catch (_) {}
  if (!redirectUri || !registered.some(r => redirectMatches(redirectUri, r)) || !redirectUriAllowed(redirectUri, env))
    return htmlError('Redirection refusée', 'L’adresse de retour ne correspond pas à celle enregistrée par cette application.');

  /* À partir d'ici, la redirection est de confiance : les erreurs y retournent (RFC 6749 §4.1.2.1). */
  const state = q.get('state');
  if (q.get('response_type') !== 'code') return redirectWith(redirectUri, { error: 'unsupported_response_type', state });
  const challenge = q.get('code_challenge') || '';
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(challenge)) return redirectWith(redirectUri, { error: 'invalid_request', error_description: 'code_challenge (PKCE S256) requis', state });
  if ((q.get('code_challenge_method') || 'S256') !== 'S256') return redirectWith(redirectUri, { error: 'invalid_request', error_description: 'code_challenge_method=S256 requis', state });
  if (state && state.length > 2048) return redirectWith(redirectUri, { error: 'invalid_request', error_description: 'state trop long' });
  const scope = grantScope(q.get('scope'));
  const resource = q.get('resource');
  if (resource && resource.replace(/\/$/, '') !== `${new URL(request.url).origin}/mcp`)
    return redirectWith(redirectUri, { error: 'invalid_target', error_description: 'resource doit être l’URL du serveur MCP', state });

  const ip = await ipHashOf(request);
  try { if (await ipRateExceeded(env, 'oauth:authorize', ip, CAP_AUTHORIZE_PER_IP_DAY)) return redirectWith(redirectUri, { error: 'temporarily_unavailable', state }); await ipRateBump(env, 'oauth:authorize', ip); } catch (_) {}

  const id = randB64u(32);
  await env.DB.prepare(`INSERT INTO oauth_codes (id, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, resource, status, expires_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'S256', ?, 'pending', ?)`)
    .bind(id, client.client_id, redirectUri, scope, state || null, challenge, resource || null, plusIso(REQUEST_TTL_S)).run();
  await env.DB.prepare("UPDATE oauth_clients SET last_used_at = datetime('now') WHERE client_id = ?").bind(client.client_id).run().catch(() => {});

  return new Response(null, { status: 302, headers: { Location: `${connectPageUrl(env)}?req=${encodeURIComponent(id)}`, 'Cache-Control': 'no-store' } });
}

/* ── GET /oauth/request?req= — ce que la page de consentement affiche ── */
async function loadPendingRequest(env, id) {
  if (!id || typeof id !== 'string' || id.length > 64) return null;
  const row = await env.DB.prepare('SELECT c.*, k.client_name, k.client_uri FROM oauth_codes c JOIN oauth_clients k ON k.client_id = c.client_id WHERE c.id = ?').bind(id).first();
  if (!row || row.status !== 'pending') return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}
export async function handleOauthRequestInfo(request, env) {
  await ensureOauthSchema(env);
  const origin = getAllowedOrigin(env, request);
  const row = await loadPendingRequest(env, new URL(request.url).searchParams.get('req'));
  if (!row) return err('Demande introuvable ou expirée. Relancez la connexion depuis Claude.', 404, origin);
  return json({
    ok: true, client_name: row.client_name, client_uri: row.client_uri || null,
    redirect_host: hostOf(row.redirect_uri), scope: row.scope.split(' '), expires_at: row.expires_at,
  }, 200, origin);
}

/* ── GET /oauth/preview — « voici ce que Claude verra » (JWT Keystone) ──
   Rappelle quatre lectures EN INTERNE avec le JWT du navigateur : c'est le
   remède au piège tenant du 16/09 — l'utilisateur voit les volumes AVANT
   d'autoriser, et change de compte si ce n'est pas les siens. */
export async function handleOauthPreview(request, env, dispatch) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return err('Jeton Keystone requis', 401, origin);
  const authz = request.headers.get('Authorization');
  const base  = new URL(request.url).origin;
  const count = async (path, pick) => {
    try {
      const res = await dispatch(new Request(base + path, { headers: { Authorization: authz } }), env);
      if (!res.ok) return null;
      const d = await res.json(); const v = pick(d); return Array.isArray(v) ? v.length : null;
    } catch (_) { return null; }
  };
  const [qr, sites, agents, notes] = await Promise.all([
    count('/api/qr', d => d.qrs), count('/api/sentinel/sites', d => d.sites),
    count('/api/smart-agent/agents', d => d.agents), count('/api/keynapse/state', d => d.bubbles),
  ]);
  const admin = claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN';
  return json({
    ok: true, email: claims.email || null, owner: claims.owner || null, plan: claims.plan || null, admin,
    espace: admin ? 'default' : 'licence',
    apercu: { qr_codes: qr, sites_sentinel: sites, jumeaux_smart_agent: agents, notes_keynapse: notes },
  }, 200, origin);
}

/* ═══════════════════════════════════════════════════════════════
   POST /oauth/approve — le consentement (JWT Keystone)
   { req, decision: 'allow' | 'deny' } → { redirect_to }
   ═══════════════════════════════════════════════════════════════ */
export async function handleOauthApprove(request, env) {
  await ensureOauthSchema(env);
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return err('Jeton Keystone requis', 401, origin);
  const body = await parseBody(request);
  const row = await loadPendingRequest(env, body.req);
  if (!row) return err('Demande introuvable ou expirée. Relancez la connexion depuis Claude.', 404, origin);

  if (body.decision !== 'allow') {
    await env.DB.prepare("UPDATE oauth_codes SET status = 'denied', consumed_at = datetime('now') WHERE id = ? AND status = 'pending'").bind(row.id).run();
    const u = new URL(row.redirect_uri); u.searchParams.set('error', 'access_denied'); if (row.state) u.searchParams.set('state', row.state);
    return json({ ok: true, redirect_to: u.toString() }, 200, origin);
  }

  /* Licence : la clé qui porte ce sub — même source que le magic link.
     Le JWT porte sub = lookup_hmac ; la clé est relue pour être
     conservée sur la connexion (relecture du plan à chaque jeton). */
  let licenceKey = null;
  try {
    const lic = await env.DB.prepare('SELECT key FROM licences WHERE lookup_hmac = ? LIMIT 1').bind(claims.sub).first();
    licenceKey = lic?.key || null;
  } catch (_) { /* schéma local sans lookup_hmac */ }
  if (!licenceKey) {
    const lic = await env.DB.prepare('SELECT key FROM licences WHERE LOWER(owner) = ? AND is_active = 1 LIMIT 1').bind(String(claims.email || '').toLowerCase()).first().catch(() => null);
    licenceKey = lic?.key || null;
  }
  if (!licenceKey) return err('Licence introuvable pour ce compte.', 404, origin);

  const code = randB64u(32);
  const codeHash = await sha256Hex(code);
  /* Sprint 5 — le SECRET DE CONNEXION vient du navigateur (connect.html le
     génère et le garde pour chiffrer les reflets). Il transite chiffré avec
     KS_ENCRYPTION_KEY dans la demande, le temps de l'échange du code
     (≤ 10 min, usage unique), puis est effacé : seul son hash restera. Sans
     secret navigateur (ancien client, clé serveur absente) → secret aléatoire
     à l'échange, connexion sans reflet. */
  let secretEnc = null, secretIv = null, mirror = false;
  const ms = typeof body.mirror_secret === 'string' ? body.mirror_secret : '';
  if (/^[A-Za-z0-9_-]{43,64}$/.test(ms) && env.KS_ENCRYPTION_KEY) {
    try { const e = await kmsEncrypt(ms, env.KS_ENCRYPTION_KEY); secretEnc = e.ciphertext; secretIv = e.iv; mirror = true; } catch (_) { /* pas de reflet */ }
  }
  const upd = await env.DB.prepare(`UPDATE oauth_codes SET status = 'issued', sub = ?, licence_key = ?, email = ?, code_hash = ?, expires_at = ?, secret_enc = ?, secret_iv = ?
                                    WHERE id = ? AND status = 'pending'`)
    .bind(claims.sub, licenceKey, claims.email || null, codeHash, plusIso(CODE_TTL_S), secretEnc, secretIv, row.id).run();
  if ((upd?.meta?.changes ?? 0) !== 1) return err('Demande déjà traitée.', 409, origin);

  await audit(env, { action: 'mcp_oauth_consent', actor: claims.email || claims.sub, target: row.client_id,
    details: { client_name: row.client_name, redirect_host: hostOf(row.redirect_uri), scope: row.scope, plan: claims.plan || null }, request }).catch(() => {});

  const u = new URL(row.redirect_uri); u.searchParams.set('code', code); if (row.state) u.searchParams.set('state', row.state);
  return json({ ok: true, redirect_to: u.toString(), request_id: row.id, mirror }, 200, origin);
}

/* ═══════════════════════════════════════════════════════════════
   POST /oauth/token — application/x-www-form-urlencoded
   ═══════════════════════════════════════════════════════════════ */
async function readForm(request) {
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (ct.includes('application/x-www-form-urlencoded')) return new URLSearchParams(await request.text());
  if (ct.includes('application/json')) {                      // tolérance : certains clients postent du JSON
    try { const j = await request.json(); const p = new URLSearchParams(); for (const [k, v] of Object.entries(j || {})) if (v != null) p.set(k, String(v)); return p; } catch (_) { return new URLSearchParams(); }
  }
  return new URLSearchParams(await request.text().catch(() => ''));
}

/* Les deux jetons ont la même forme : <préfixe><aléa>.<secret>. L'aléa est
   propre au jeton (hash en base, TTL) ; le secret est celui de la CONNEXION
   (brief §3) : il voyage avec les jetons, jamais en clair côté serveur, et
   survit aux rotations — le refresh le rapporte, le nouveau couple le reprend. */
export function splitToken(token, prefix) {
  if (typeof token !== 'string' || !token.startsWith(prefix)) return null;
  const [rand, secret] = token.slice(prefix.length).split('.');
  return rand && secret ? { rand, secret } : null;
}
async function issueTokens(env, connection, secret) {
  const accessRand = randB64u(32), refreshRand = randB64u(32);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO mcp_tokens (id, connection_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(generateId(), connection.id, 'access', await sha256Hex(accessRand), plusIso(ACCESS_TTL_S)),
    env.DB.prepare('INSERT INTO mcp_tokens (id, connection_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(generateId(), connection.id, 'refresh', await sha256Hex(refreshRand), plusIso(REFRESH_TTL_S)),
  ]);
  return {
    access_token: `${ACCESS_PREFIX}${accessRand}.${secret}`, token_type: 'Bearer', expires_in: ACCESS_TTL_S,
    refresh_token: `${REFRESH_PREFIX}${refreshRand}.${secret}`, scope: connection.scope,
  };
}

async function revokeConnection(env, connectionId, why) {
  await env.DB.batch([
    env.DB.prepare("UPDATE mcp_connections SET revoked_at = datetime('now'), secret_hash = NULL WHERE id = ? AND revoked_at IS NULL").bind(connectionId),
    env.DB.prepare('DELETE FROM mcp_tokens WHERE connection_id = ?').bind(connectionId),
    env.DB.prepare('DELETE FROM mcp_mirror WHERE connection_id = ?').bind(connectionId),     // sprint 5 : reflets illisibles ET effacés
  ]);
  console.log('[oauth] connexion révoquée', connectionId, why || '');
}

export async function handleOauthToken(request, env) {
  await ensureOauthSchema(env);
  if (request.method !== 'POST') return oauthError('invalid_request', 'POST attendu', 405);
  const form = await readForm(request);
  const grant = form.get('grant_type');

  const auth = await authenticateClient(request, env, form);
  if (auth.error) return oauthJson({ error: 'invalid_client', error_description: 'Client inconnu ou secret invalide.' }, 401, { 'WWW-Authenticate': 'Basic realm="keystone-oauth"' });
  const client = auth.client;

  if (grant === 'authorization_code') {
    const code = form.get('code') || '', verifier = form.get('code_verifier') || '', redirectUri = form.get('redirect_uri') || '';
    if (!code || !verifier) return oauthError('invalid_request', 'code et code_verifier requis');
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return oauthError('invalid_grant', 'code_verifier invalide');
    const row = await env.DB.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').bind(await sha256Hex(code)).first();
    if (!row || row.status !== 'issued' || row.client_id !== client.client_id) return oauthError('invalid_grant', 'Code inconnu, déjà utilisé ou étranger à ce client.');
    if (new Date(row.expires_at) < new Date()) return oauthError('invalid_grant', 'Code expiré.');
    if (redirectUri && !redirectMatches(redirectUri, row.redirect_uri)) return oauthError('invalid_grant', 'redirect_uri différente de celle de la demande.');
    if (!safeEq(await pkceChallengeOf(verifier), row.code_challenge)) return oauthError('invalid_grant', 'PKCE : code_verifier ne correspond pas.');
    const resource = form.get('resource');
    if (resource && resource.replace(/\/$/, '') !== `${new URL(request.url).origin}/mcp`) return oauthError('invalid_target', 'resource doit être l’URL du serveur MCP');

    /* Consommation ANTI-COURSE : un seul échange gagne. */
    const upd = await env.DB.prepare("UPDATE oauth_codes SET status = 'consumed', consumed_at = datetime('now') WHERE id = ? AND status = 'issued'").bind(row.id).run();
    if ((upd?.meta?.changes ?? 0) !== 1) return oauthError('invalid_grant', 'Code déjà utilisé.');

    /* Licence toujours vivante ? (même règle que le magic link) */
    const lic = await env.DB.prepare('SELECT plan, is_active, expires_at FROM licences WHERE key = ?').bind(row.licence_key).first();
    if (!lic || !lic.is_active || (lic.expires_at && new Date(lic.expires_at) < new Date())) return oauthError('invalid_grant', 'Licence inactive ou expirée.');

    /* Le secret de connexion (brief §3 étape 1) : celui du navigateur s'il l'a
       fourni au consentement (sprint 5, reflets), sinon un aléa. Seul son hash
       reste en base ; la copie transitoire de la demande est effacée ici. */
    let secret = randB64u(32);
    if (row.secret_enc && row.secret_iv && env.KS_ENCRYPTION_KEY) {
      try { const s = await kmsDecrypt(row.secret_enc, row.secret_iv, env.KS_ENCRYPTION_KEY); if (/^[A-Za-z0-9_-]{43,64}$/.test(s)) secret = s; } catch (_) { /* aléa */ }
    }
    await env.DB.prepare('UPDATE oauth_codes SET secret_enc = NULL, secret_iv = NULL WHERE id = ?').bind(row.id).run().catch(() => {});
    const connection = {
      id: 'kcn_' + randB64u(12), sub: row.sub, licence_key: row.licence_key, email: row.email, plan_at_consent: lic.plan || null,
      client_id: client.client_id, client_name: client.client_name, redirect_host: hostOf(row.redirect_uri), scope: row.scope,
    };
    await env.DB.prepare(`INSERT INTO mcp_connections (id, sub, licence_key, email, plan_at_consent, client_id, client_name, redirect_host, scope, secret_hash, request_id)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(connection.id, connection.sub, connection.licence_key, connection.email, connection.plan_at_consent, connection.client_id,
            connection.client_name, connection.redirect_host, connection.scope, await sha256Hex(secret), row.id).run();
    return oauthJson(await issueTokens(env, connection, secret));
  }

  if (grant === 'refresh_token') {
    const parts = splitToken(form.get('refresh_token') || '', REFRESH_PREFIX);
    if (!parts) return oauthError('invalid_grant', 'refresh_token invalide.');
    const tok = await env.DB.prepare("SELECT * FROM mcp_tokens WHERE token_hash = ? AND kind = 'refresh'").bind(await sha256Hex(parts.rand)).first();
    if (!tok) return oauthError('invalid_grant', 'refresh_token inconnu ou révoqué.');
    if (tok.rotated_at) {                                       // réutilisation d'un refresh déjà tourné → famille révoquée
      await revokeConnection(env, tok.connection_id, 'refresh réutilisé');
      return oauthError('invalid_grant', 'refresh_token déjà utilisé : connexion révoquée, réautorisez depuis Claude.');
    }
    if (new Date(tok.expires_at) < new Date()) return oauthError('invalid_grant', 'refresh_token expiré.');
    const conn = await env.DB.prepare('SELECT * FROM mcp_connections WHERE id = ?').bind(tok.connection_id).first();
    if (!conn || conn.revoked_at || !conn.secret_hash) return oauthError('invalid_grant', 'Connexion révoquée.');
    if (!safeEq(await sha256Hex(parts.secret), conn.secret_hash)) return oauthError('invalid_grant', 'refresh_token invalide.');
    if (conn.client_id !== client.client_id) return oauthError('invalid_grant', 'refresh_token étranger à ce client.');
    const lic = await env.DB.prepare('SELECT is_active, expires_at FROM licences WHERE key = ?').bind(conn.licence_key).first();
    if (!lic || !lic.is_active || (lic.expires_at && new Date(lic.expires_at) < new Date())) { await revokeConnection(env, conn.id, 'licence morte'); return oauthError('invalid_grant', 'Licence inactive ou expirée.'); }

    /* Rotation gardée : l'ancien est marqué tourné UNE fois (anti-course), les accès
       vivants tombent, un nouveau couple sort avec le MÊME secret de connexion. */
    const upd = await env.DB.prepare("UPDATE mcp_tokens SET rotated_at = datetime('now') WHERE id = ? AND rotated_at IS NULL").bind(tok.id).run();
    if ((upd?.meta?.changes ?? 0) !== 1) { await revokeConnection(env, conn.id, 'course sur refresh'); return oauthError('invalid_grant', 'refresh_token déjà utilisé.'); }
    await env.DB.prepare("DELETE FROM mcp_tokens WHERE connection_id = ? AND kind = 'access'").bind(conn.id).run();
    return oauthJson(await issueTokens(env, conn, parts.secret));
  }

  return oauthError('unsupported_grant_type', 'grant_type : authorization_code ou refresh_token.');
}

/* ── POST /oauth/revoke (RFC 7009) — toujours 200, même jeton inconnu ── */
export async function handleOauthRevoke(request, env) {
  await ensureOauthSchema(env);
  const form = await readForm(request);
  const token = form.get('token') || '';
  const auth = await authenticateClient(request, env, form);
  if (auth.error) return oauthJson({ error: 'invalid_client' }, 401);
  const parts = splitToken(token, ACCESS_PREFIX) || splitToken(token, REFRESH_PREFIX);
  const tok = parts ? await env.DB.prepare('SELECT * FROM mcp_tokens WHERE token_hash = ?').bind(await sha256Hex(parts.rand)).first() : null;
  if (tok) {
    const conn = await env.DB.prepare('SELECT client_id FROM mcp_connections WHERE id = ?').bind(tok.connection_id).first();
    if (conn && conn.client_id === auth.client.client_id) await revokeConnection(env, tok.connection_id, 'revoke RFC 7009');
  }
  return oauthJson({ ok: true });
}

/* ═══════════════════════════════════════════════════════════════
   RÉSOLUTION D'UN JETON D'ACCÈS — appelée par /mcp
   → { ok:true, claims:{ sub, plan, owner, email, isAdmin, scope, via, connection_id } }
   → { ok:false, error:'invalid_token', description }
   ═══════════════════════════════════════════════════════════════ */
export async function resolveMcpAccessToken(env, token) {
  await ensureOauthSchema(env);
  const bad = (description) => ({ ok: false, error: 'invalid_token', description });
  const parts = splitToken(token, ACCESS_PREFIX);
  if (!parts) return bad('Jeton d’accès mal formé.');
  const { rand, secret } = parts;
  const tok = await env.DB.prepare("SELECT * FROM mcp_tokens WHERE token_hash = ? AND kind = 'access'").bind(await sha256Hex(rand)).first();
  if (!tok) return bad('Jeton d’accès inconnu ou révoqué.');
  if (new Date(tok.expires_at) < new Date()) return bad('Jeton d’accès expiré.');
  const conn = await env.DB.prepare('SELECT * FROM mcp_connections WHERE id = ?').bind(tok.connection_id).first();
  if (!conn || conn.revoked_at || !conn.secret_hash) return bad('Connexion révoquée.');
  if (!safeEq(await sha256Hex(secret), conn.secret_hash)) return bad('Secret de connexion invalide.');
  const lic = await env.DB.prepare('SELECT plan, owner, is_active, expires_at FROM licences WHERE key = ?').bind(conn.licence_key).first();
  if (!lic || !lic.is_active || (lic.expires_at && new Date(lic.expires_at) < new Date())) return bad('Licence inactive ou expirée.');
  env.DB.prepare("UPDATE mcp_connections SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-60 seconds'))")
    .bind(conn.id).run().catch(() => {});
  const planUp = String(lic.plan || '').toUpperCase();
  return { ok: true, connection: conn, secret, claims: {
    sub: conn.sub, plan: lic.plan, owner: lic.owner, email: conn.email || null, isAdmin: planUp === 'ADMIN',
    scope: conn.scope.split(' '), via: 'mcp-oauth', connection_id: conn.id,
  } };
}

/* ═══════════════════════════════════════════════════════════════
   TUILE « CONNECTEUR IA » — /api/mcp/connections (JWT Keystone)
   ═══════════════════════════════════════════════════════════════ */
export async function handleMcpConnectionsList(request, env) {
  await ensureOauthSchema(env);
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return err('Jeton Keystone requis', 401, origin);
  const { results } = await env.DB.prepare(`SELECT id, client_name, redirect_host, scope, email, plan_at_consent, created_at, last_used_at, request_id
                                            FROM mcp_connections WHERE sub = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50`).bind(claims.sub).all();
  /* sprint 5 : reflets publiés par connexion (pad, date) */
  const mirrors = {};
  try {
    const m = await env.DB.prepare('SELECT connection_id, pad, updated_at FROM mcp_mirror WHERE sub = ?').bind(claims.sub).all();
    for (const r of (m.results || [])) (mirrors[r.connection_id] = mirrors[r.connection_id] || []).push({ pad: r.pad, updated_at: r.updated_at });
  } catch (_) { /* table absente */ }
  return json({ ok: true, mcp_url: `${new URL(request.url).origin}/mcp`, connections: (results || []).map(r => ({
    id: r.id, client_name: r.client_name, redirect_host: r.redirect_host, scope: r.scope.split(' '), email: r.email, plan: r.plan_at_consent,
    created_at: r.created_at, last_used_at: r.last_used_at, request_id: r.request_id || null, mirror: mirrors[r.id] || [],
  })) }, 200, origin);
}
export async function handleMcpConnectionRevoke(request, env, id) {
  await ensureOauthSchema(env);
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return err('Jeton Keystone requis', 401, origin);
  const conn = await env.DB.prepare('SELECT id, client_name FROM mcp_connections WHERE id = ? AND sub = ? AND revoked_at IS NULL').bind(String(id || ''), claims.sub).first();
  if (!conn) return err('Connexion introuvable', 404, origin);
  await revokeConnection(env, conn.id, 'révoquée depuis Réglages');
  await audit(env, { action: 'mcp_oauth_revoke', actor: claims.email || claims.sub, target: conn.id, details: { client_name: conn.client_name }, request }).catch(() => {});
  return json({ ok: true }, 200, origin);
}

/* ── Purge (cron 0 3 * * *) ── */
export async function purgeOauthArtifacts(env) {
  await ensureOauthSchema(env);
  const r = async (sql) => { const x = await env.DB.prepare(sql).run().catch(() => null); return x?.meta?.changes ?? 0; };
  return {
    codes:       await r("DELETE FROM oauth_codes WHERE expires_at < datetime('now', '-1 hour')"),
    tokens:      await r("DELETE FROM mcp_tokens WHERE expires_at < datetime('now') OR (rotated_at IS NOT NULL AND rotated_at < datetime('now', '-1 day'))"),
    connections: await r("DELETE FROM mcp_connections WHERE revoked_at IS NOT NULL AND revoked_at < datetime('now', '-30 days')"),
    clients:     await r("DELETE FROM oauth_clients WHERE created_at < datetime('now', '-30 days') AND client_id NOT IN (SELECT client_id FROM mcp_connections) AND client_id NOT IN (SELECT client_id FROM oauth_codes)"),
  };
}
