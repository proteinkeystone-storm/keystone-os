/* ═══════════════════════════════════════════════════════════════
   Banc — OAuth 2.1 du serveur MCP (sprint 2) : le flux de bout en bout
   ───────────────────────────────────────────────────────────────
   Sans réseau, sans wrangler : les VRAIS handlers (routes/oauth.js,
   routes/mcp.js) tournent sur une base SQLite en mémoire (node:sqlite)
   qui imite l'API D1 — la migration 015 est appliquée telle quelle,
   donc le fichier SQL est lui aussi éprouvé.

   Ce que ce banc PROUVE :
     1. DCR : client public accepté, URI de redirection étrangère refusée,
        loopback accepté, secret émis seulement si demandé.
     2. /authorize : client inconnu → page d'erreur (pas de redirection),
        PKCE absent → erreur RENVOYÉE au client, nominal → 302 vers
        connect.html avec un identifiant de demande.
     3. Consentement : /request lit la demande ; /preview exige un JWT ;
        /approve sans JWT → 401, refus → access_denied, accord → code.
     4. /token : mauvais verifier → invalid_grant ; bon → access + refresh ;
        code rejoué → invalid_grant (anti-course) ; client étranger refusé.
     5. /mcp accepte le jeton OAuth (initialize, tools/call) ET le JWT
        Keystone ; un jeton bidon → 401 + WWW-Authenticate invalid_token ;
        les routes internes reçoivent un JWT interne du bon sub.
     6. Refresh : rotation → nouveau couple, MÊME secret de connexion ;
        l'ancien refresh rejoué → invalid_grant ET connexion révoquée ;
        l'ancien access meurt à la rotation.
     7. Révocation depuis Réglages (DELETE /api/mcp/connections/:id) :
        listée avant, absente après, jeton → 401, autre sub → 404.
     8. Licence inactive → invalid_grant au refresh, 401 au /mcp.
     9. Purge : codes échus et jetons morts disparaissent.
   Lancement : node scripts/test-oauth-flow.mjs
   ═══════════════════════════════════════════════════════════════ */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { signJWT } from '../workers/src/lib/jwt.js';
import { handleMcp } from '../workers/src/routes/mcp.js';
import {
  handleWellKnown, handleOauthRegister, handleOauthAuthorize, handleOauthRequestInfo, handleOauthPreview,
  handleOauthApprove, handleOauthToken, handleOauthRevoke, handleMcpConnectionsList, handleMcpConnectionRevoke,
  purgeOauthArtifacts, resolveMcpAccessToken, ACCESS_PREFIX, REFRESH_PREFIX,
} from '../workers/src/routes/oauth.js';

let pass = 0, fail = 0;
const ok  = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko  = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));
const eq  = (a, e, l) => (JSON.stringify(a) === JSON.stringify(e) ? ok(l) : ko(l, `attendu ${JSON.stringify(e)}, reçu ${JSON.stringify(a)}`));

/* ── D1 imité par node:sqlite ── */
function makeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql) => {
    let args = [];
    const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
    const api = {
      bind(...b) { args = b.map(norm); return api; },
      async first(col) { const r = db.prepare(sql).get(...args) ?? null; return col && r ? r[col] : r; },
      async all()      { return { results: db.prepare(sql).all(...args), success: true, meta: {} }; },
      async run()      { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    };
    return api;
  };
  return { prepare: stmt, batch: async (list) => Promise.all(list.map(s => s.run())), _db: db };
}
const DB = makeD1();
DB._db.exec(readFileSync(new URL('../workers/migrations/015_mcp_oauth.sql', import.meta.url), 'utf8'));
DB._db.exec(`CREATE TABLE licences (key TEXT PRIMARY KEY, tenant_id TEXT DEFAULT 'default', owner TEXT, plan TEXT, is_active INTEGER DEFAULT 1,
             owned_assets TEXT, expires_at TEXT, lookup_hmac TEXT);
             CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor TEXT, target TEXT, tenant_id TEXT, details TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
             INSERT INTO licences (key, owner, plan, lookup_hmac) VALUES ('BANC-0000-0000-0001', 'Alice', 'MAX', 'sub-alice');
             INSERT INTO licences (key, owner, plan, lookup_hmac) VALUES ('BANC-0000-0000-0002', 'Bob', 'PRO', 'sub-bob');`);
const env = { KS_JWT_SECRET: 'jwt-secret-du-banc-32-octets-minimum-0123456789', KS_ALLOWED_ORIGIN: 'https://front.test', DB };
const API = 'https://api.test';

/* ── Routeur interne simulé (ce que /mcp et /preview rappellent) ── */
const seen = [];
const dispatch = async (req) => {
  const u = new URL(req.url);
  const authz = req.headers.get('Authorization') || '';
  seen.push({ path: u.pathname, authz });
  const jwt = authz.replace(/^Bearer\s+/i, '');
  let claims = null; try { claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); } catch (_) {}
  const who = claims?.sub || '?';
  const canned = {
    '/api/qr': { qrs: who === 'sub-alice' ? [{ id: 'q1', name: 'Vitrine', scans_total: 3 }, { id: 'q2', name: 'Menu' }] : [] },
    '/api/sentinel/sites': { sites: [] }, '/api/smart-agent/agents': { agents: [{ id: 'a' }] }, '/api/keynapse/state': { bubbles: [{}, {}, {}] },
  };
  const body = canned[u.pathname];
  return new Response(JSON.stringify(body || { error: 'not found' }), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
};

/* ── Aides HTTP ── */
const req = (path, init = {}) => new Request(API + path, init);
const postForm = (path, obj, headers = {}) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(obj).toString() });
const postJson = (path, obj, headers = {}) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(obj) });
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const pkce = () => { const verifier = b64u(randomBytes(48)); return { verifier, challenge: b64u(createHash('sha256').update(verifier).digest()) }; };
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const mcp = (token, body) => handleMcp(req('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), env, dispatch);

const jwtAlice = await signJWT({ sub: 'sub-alice', plan: 'MAX', owner: 'Alice', email: 'alice@banc.test' }, env);
const jwtBob   = await signJWT({ sub: 'sub-bob',   plan: 'PRO', owner: 'Bob',   email: 'bob@banc.test' }, env);
const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';

console.log('\n▶ 0 · Métadonnées');
{
  const pr = await (await handleWellKnown(req('/.well-known/oauth-protected-resource/mcp'), env)).json();
  eq(pr.resource, `${API}/mcp`, 'resource = URL du serveur MCP');
  eq(pr.authorization_servers, [API], 'authorization_servers = le Worker lui-même');
  const as = await (await handleWellKnown(req('/.well-known/oauth-authorization-server'), env)).json();
  eq(as.code_challenge_methods_supported, ['S256'], 'PKCE S256 seul');
  yes(as.registration_endpoint === `${API}/oauth/register` && as.token_endpoint === `${API}/oauth/token` && as.authorization_endpoint === `${API}/oauth/authorize`, 'les trois endpoints annoncés');
  yes(as.scopes_supported.includes('keystone.read') && as.scopes_supported.includes('offline_access'), 'portées annoncées');
}

console.log('\n▶ 1 · Enregistrement dynamique (DCR)');
let client, clientSecretClient;
{
  const bad = await handleOauthRegister(postJson('/oauth/register', { client_name: 'Evil', redirect_uris: ['https://evil.example/cb'] }), env);
  eq(bad.status, 400, 'URI de redirection étrangère → 400');
  eq((await bad.json()).error, 'invalid_redirect_uri', '… invalid_redirect_uri');
  const r = await handleOauthRegister(postJson('/oauth/register', { client_name: 'Claude', redirect_uris: [CLAUDE_CB], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }), env);
  eq(r.status, 201, 'client public Claude → 201');
  client = await r.json();
  yes(client.client_id && client.client_id.startsWith('ksc_'), 'client_id émis');
  yes(client.client_secret === undefined, 'pas de secret pour un client public');
  eq(client.redirect_uris, [CLAUDE_CB], 'URI conservée');
  const loop = await handleOauthRegister(postJson('/oauth/register', { client_name: 'Claude Code', redirect_uris: ['http://localhost:54321/callback'], token_endpoint_auth_method: 'client_secret_post' }), env);
  eq(loop.status, 201, 'loopback localhost accepté (Claude Code)');
  clientSecretClient = await loop.json();
  yes(typeof clientSecretClient.client_secret === 'string' && clientSecretClient.client_secret.length > 30, 'secret émis quand demandé');
  const row = DB._db.prepare('SELECT secret_hash FROM oauth_clients WHERE client_id = ?').get(clientSecretClient.client_id);
  yes(row.secret_hash && row.secret_hash !== clientSecretClient.client_secret, 'secret stocké haché, jamais en clair');
  const long = await handleOauthRegister(postJson('/oauth/register', { client_name: 'x'.repeat(500), redirect_uris: [CLAUDE_CB] }), env);
  yes((await long.json()).client_name.length <= 80, 'nom de client borné');
}

console.log('\n▶ 2 · /oauth/authorize');
let reqId, state = 'st-' + randomBytes(6).toString('hex');
const { verifier, challenge } = pkce();
{
  const unknown = await handleOauthAuthorize(req(`/oauth/authorize?client_id=ksc_nope&redirect_uri=${encodeURIComponent(CLAUDE_CB)}&response_type=code`), env);
  eq(unknown.status, 400, 'client inconnu → page d’erreur, pas de redirection');
  yes(/text\/html/.test(unknown.headers.get('Content-Type')), '… en HTML');
  const wrongUri = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&response_type=code`), env);
  eq(wrongUri.status, 400, 'redirect_uri non enregistrée → page d’erreur');
  const noPkce = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CLAUDE_CB)}&response_type=code&state=${state}`), env);
  eq(noPkce.status, 302, 'sans PKCE → redirection…');
  const loc = new URL(noPkce.headers.get('Location'));
  eq(loc.searchParams.get('error'), 'invalid_request', '… avec error=invalid_request');
  eq(loc.searchParams.get('state'), state, '… et le state');
  const plain = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CLAUDE_CB)}&response_type=code&code_challenge=${challenge}&code_challenge_method=plain`), env);
  eq(new URL(plain.headers.get('Location')).searchParams.get('error'), 'invalid_request', 'code_challenge_method=plain refusé');
  const badRes = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CLAUDE_CB)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent('https://other.example/mcp')}`), env);
  eq(new URL(badRes.headers.get('Location')).searchParams.get('error'), 'invalid_target', 'resource étranger → invalid_target');
  const nominal = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CLAUDE_CB)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&scope=keystone.read%20keystone.write%20offline_access&resource=${encodeURIComponent(API + '/mcp')}`), env);
  eq(nominal.status, 302, 'nominal → 302');
  const to = new URL(nominal.headers.get('Location'));
  eq(to.origin + to.pathname, 'https://front.test/connect', '… vers la page de consentement du front');
  reqId = to.searchParams.get('req');
  yes(reqId && reqId.length >= 40, '… avec un identifiant de demande opaque');
}

console.log('\n▶ 3 · Consentement (connect.html ↔ Worker)');
let code;
{
  const info = await (await handleOauthRequestInfo(req(`/oauth/request?req=${reqId}`), env)).json();
  eq(info.client_name, 'Claude', '/request : nom du client');
  eq(info.redirect_host, 'claude.ai', '/request : hôte de retour affiché');
  eq(info.scope, ['keystone.read', 'keystone.write', 'offline_access'], '/request : portées');
  eq((await handleOauthRequestInfo(req('/oauth/request?req=nope'), env)).status, 404, '/request inconnu → 404');
  eq((await handleOauthPreview(req('/oauth/preview'), env, dispatch)).status, 401, '/preview sans JWT → 401');
  const pv = await (await handleOauthPreview(req('/oauth/preview', { headers: { Authorization: `Bearer ${jwtAlice}` } }), env, dispatch)).json();
  eq(pv.email, 'alice@banc.test', '/preview : e-mail du compte');
  eq(pv.plan, 'MAX', '/preview : plan');
  eq(pv.apercu.qr_codes, 2, '/preview : volume réel (2 QR pour Alice)');
  const pvBob = await (await handleOauthPreview(req('/oauth/preview', { headers: { Authorization: `Bearer ${jwtBob}` } }), env, dispatch)).json();
  eq(pvBob.apercu.qr_codes, 0, '/preview : Bob ne voit pas les QR d’Alice');
  eq((await handleOauthApprove(postJson('/oauth/approve', { req: reqId, decision: 'allow' }), env)).status, 401, '/approve sans JWT → 401');
  /* refus sur une demande jumelle */
  const { challenge: c2 } = pkce();
  const twin = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CLAUDE_CB)}&response_type=code&code_challenge=${c2}&code_challenge_method=S256&state=deny1`), env);
  const twinId = new URL(twin.headers.get('Location')).searchParams.get('req');
  const deny = await (await handleOauthApprove(postJson('/oauth/approve', { req: twinId, decision: 'deny' }, { Authorization: `Bearer ${jwtAlice}` }), env)).json();
  const du = new URL(deny.redirect_to);
  yes(du.searchParams.get('error') === 'access_denied' && du.searchParams.get('state') === 'deny1', 'refus → access_denied + state');
  eq((await handleOauthApprove(postJson('/oauth/approve', { req: twinId, decision: 'allow' }, { Authorization: `Bearer ${jwtAlice}` }), env)).status, 404, 'demande refusée non ré-approuvable');
  /* accord */
  const ap = await handleOauthApprove(postJson('/oauth/approve', { req: reqId, decision: 'allow' }, { Authorization: `Bearer ${jwtAlice}` }), env);
  eq(ap.status, 200, 'accord → 200');
  const au = new URL((await ap.json()).redirect_to);
  eq(au.origin + au.pathname, CLAUDE_CB, '… redirection vers le callback Claude');
  code = au.searchParams.get('code');
  yes(code && code.length >= 40, '… avec un code');
  eq(au.searchParams.get('state'), state, '… et le state');
  const row = DB._db.prepare('SELECT status, sub, code_hash FROM oauth_codes WHERE id = ?').get(reqId);
  yes(row.status === 'issued' && row.sub === 'sub-alice' && row.code_hash !== code, 'code haché, lié au sub');
  eq((await handleOauthApprove(postJson('/oauth/approve', { req: reqId, decision: 'allow' }, { Authorization: `Bearer ${jwtAlice}` }), env)).status, 404, 'accord rejoué → 404 (demande consommée)');
}

console.log('\n▶ 4 · /oauth/token (authorization_code + PKCE)');
let tokens;
{
  const badV = await handleOauthToken(postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: b64u(randomBytes(48)), redirect_uri: CLAUDE_CB, client_id: client.client_id }), env);
  eq(badV.status, 400, 'mauvais code_verifier → 400');
  eq((await badV.json()).error, 'invalid_grant', '… invalid_grant');
  const foreign = await handleOauthToken(postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CLAUDE_CB, client_id: clientSecretClient.client_id, client_secret: clientSecretClient.client_secret }), env);
  eq((await foreign.json()).error, 'invalid_grant', 'code d’un autre client → invalid_grant');
  const noClient = await handleOauthToken(postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CLAUDE_CB, client_id: 'ksc_nope' }), env);
  eq(noClient.status, 401, 'client inconnu → 401 invalid_client');
  const r = await handleOauthToken(postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CLAUDE_CB, client_id: client.client_id, resource: API + '/mcp' }), env);
  eq(r.status, 200, 'bon verifier → 200');
  eq(r.headers.get('Cache-Control'), 'no-store', '… no-store');
  tokens = await r.json();
  yes(tokens.access_token?.startsWith(ACCESS_PREFIX) && tokens.refresh_token?.startsWith(REFRESH_PREFIX), 'access ksa_ et refresh ksr_');
  eq(tokens.token_type, 'Bearer', 'token_type Bearer');
  eq(tokens.expires_in, 3600, 'access : 1 h');
  eq(tokens.scope, 'keystone.read keystone.write offline_access', 'portées accordées');
  const replay = await handleOauthToken(postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CLAUDE_CB, client_id: client.client_id }), env);
  eq((await replay.json()).error, 'invalid_grant', 'code rejoué → invalid_grant');
  const n = DB._db.prepare('SELECT COUNT(*) AS n FROM mcp_tokens').get().n;
  eq(n, 2, 'exactement deux jetons en base (un accès, un refresh)');
  const stored = DB._db.prepare('SELECT token_hash FROM mcp_tokens').all().map(r => r.token_hash);
  yes(!stored.includes(tokens.access_token) && !stored.some(h => tokens.access_token.includes(h)), 'aucun jeton en clair en base');
  const conn = DB._db.prepare('SELECT * FROM mcp_connections').get();
  yes(conn.sub === 'sub-alice' && conn.client_name === 'Claude' && conn.secret_hash && !tokens.access_token.includes(conn.secret_hash), 'connexion créée : sub, client, secret haché');
  eq((await handleOauthToken(postForm('/oauth/token', { grant_type: 'password', client_id: client.client_id }), env)).status, 400, 'grant_type inconnu → 400');
}

console.log('\n▶ 5 · /mcp avec le jeton OAuth');
{
  seen.length = 0;
  const init = await mcp(tokens.access_token, rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'banc' } }));
  eq(init.status, 200, 'initialize avec jeton OAuth → 200');
  const call = await (await mcp(tokens.access_token, rpc('tools/call', { name: 'keystone_qr_list', arguments: {} }))).json();
  eq(call.result?.structuredContent?.total, 2, 'tools/call keystone_qr_list → les 2 QR d’Alice');
  const internal = seen.find(s => s.path === '/api/qr');
  yes(internal && internal.authz.startsWith('Bearer ey'), 'la route interne reçoit un JWT (pas le jeton OAuth)');
  const payload = JSON.parse(Buffer.from(internal.authz.split('.')[1], 'base64url').toString());
  yes(payload.sub === 'sub-alice' && payload.plan === 'MAX' && payload.via === 'mcp-oauth' && payload.exp - payload.iat <= 300, 'JWT interne : sub/plan de la connexion, via mcp-oauth, ≤ 5 min');
  const jwtCall = await (await mcp(jwtAlice, rpc('tools/call', { name: 'keystone_qr_list', arguments: {} }))).json();
  eq(jwtCall.result?.structuredContent?.total, 2, 'le JWT Keystone reste accepté (Claude Code sans OAuth)');
  const bogus = await mcp(ACCESS_PREFIX + 'x'.repeat(43) + '.' + 'y'.repeat(43), rpc('ping', {}));
  eq(bogus.status, 401, 'jeton OAuth bidon → 401');
  yes(/error="invalid_token"/.test(bogus.headers.get('WWW-Authenticate')) && /resource_metadata=/.test(bogus.headers.get('WWW-Authenticate')), '… WWW-Authenticate invalid_token + resource_metadata');
  const [rand] = tokens.access_token.slice(ACCESS_PREFIX.length).split('.');
  const wrongSecret = await mcp(`${ACCESS_PREFIX}${rand}.${'z'.repeat(43)}`, rpc('ping', {}));
  eq(wrongSecret.status, 401, 'bon aléa mais mauvais secret de connexion → 401');
  const res = await resolveMcpAccessToken(env, tokens.access_token);
  yes(res.ok && res.claims.scope.includes('keystone.read') && res.claims.connection_id, 'resolveMcpAccessToken : portées + connexion');
}

console.log('\n▶ 6 · Refresh rotatif');
let tokens2;
{
  const secretOf = (t) => t.split('.')[1];
  const r = await handleOauthToken(postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id }), env);
  eq(r.status, 200, 'refresh → 200');
  tokens2 = await r.json();
  yes(tokens2.access_token !== tokens.access_token && tokens2.refresh_token !== tokens.refresh_token, 'nouveau couple');
  eq(secretOf(tokens2.access_token), secretOf(tokens.access_token), 'le secret de connexion est STABLE à travers la rotation (brief §3)');
  eq((await mcp(tokens.access_token, rpc('ping', {}))).status, 401, 'l’ancien access meurt à la rotation');
  eq((await mcp(tokens2.access_token, rpc('ping', {}))).status, 200, 'le nouveau access sert');
  const foreign = await handleOauthToken(postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens2.refresh_token, client_id: clientSecretClient.client_id, client_secret: clientSecretClient.client_secret }), env);
  eq((await foreign.json()).error, 'invalid_grant', 'refresh présenté par un autre client → invalid_grant');
  const reuse = await handleOauthToken(postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id }), env);
  eq((await reuse.json()).error, 'invalid_grant', 'ancien refresh rejoué → invalid_grant');
  const conn = DB._db.prepare('SELECT revoked_at, secret_hash FROM mcp_connections').get();
  yes(conn.revoked_at && conn.secret_hash === null, '… et la connexion entière est révoquée (secret détruit)');
  eq((await mcp(tokens2.access_token, rpc('ping', {}))).status, 401, '… le nouveau access ne sert plus non plus');
  eq((await handleOauthToken(postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens2.refresh_token, client_id: client.client_id }), env)).status, 400, '… ni le nouveau refresh');
  const dead = await handleOauthToken(postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: REFRESH_PREFIX + 'a'.repeat(43) + '.' + 'b'.repeat(43), client_id: client.client_id }), env);
  eq((await dead.json()).error, 'invalid_grant', 'refresh inconnu → invalid_grant');
}

/* Un nouveau consentement complet pour la suite (révocation, licence, purge). */
async function fullConsent(jwt, who) {
  const { verifier, challenge } = pkce();
  const a = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CLAUDE_CB)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=${who}`), env);
  const id = new URL(a.headers.get('Location')).searchParams.get('req');
  const ap = await (await handleOauthApprove(postJson('/oauth/approve', { req: id, decision: 'allow' }, { Authorization: `Bearer ${jwt}` }), env)).json();
  const code = new URL(ap.redirect_to).searchParams.get('code');
  return (await handleOauthToken(postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CLAUDE_CB, client_id: client.client_id }), env)).json();
}

console.log('\n▶ 7 · Tuile « Connecteur IA » : liste et révocation');
{
  const ta = await fullConsent(jwtAlice, 'alice');
  const tb = await fullConsent(jwtBob, 'bob');
  eq((await handleMcpConnectionsList(req('/api/mcp/connections'), env)).status, 401, 'liste sans JWT → 401');
  const la = await (await handleMcpConnectionsList(req('/api/mcp/connections', { headers: { Authorization: `Bearer ${jwtAlice}` } }), env)).json();
  eq(la.connections.length, 1, 'Alice voit UNE connexion active (la révoquée n’apparaît pas)');
  yes(la.connections[0].client_name === 'Claude' && la.connections[0].redirect_host === 'claude.ai' && la.connections[0].email === 'alice@banc.test', '… client, hôte, e-mail du compte autorisé');
  eq(la.mcp_url, `${API}/mcp`, '… et l’URL du serveur à coller');
  const lb = await (await handleMcpConnectionsList(req('/api/mcp/connections', { headers: { Authorization: `Bearer ${jwtBob}` } }), env)).json();
  yes(lb.connections.length === 1 && lb.connections[0].id !== la.connections[0].id, 'Bob voit la sienne, pas celle d’Alice');
  eq((await handleMcpConnectionRevoke(req(`/api/mcp/connections/${la.connections[0].id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${jwtBob}` } }), env, la.connections[0].id)).status, 404, 'Bob ne peut pas révoquer la connexion d’Alice');
  eq((await mcp(ta.access_token, rpc('ping', {}))).status, 200, 'avant révocation : jeton d’Alice sert');
  eq((await handleMcpConnectionRevoke(req(`/api/mcp/connections/${la.connections[0].id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${jwtAlice}` } }), env, la.connections[0].id)).status, 200, 'Alice révoque depuis Réglages');
  eq((await mcp(ta.access_token, rpc('ping', {}))).status, 401, 'après révocation : 401 immédiat');
  eq((await handleOauthToken(postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: ta.refresh_token, client_id: client.client_id }), env)).status, 400, '… et le refresh est mort');
  const la2 = await (await handleMcpConnectionsList(req('/api/mcp/connections', { headers: { Authorization: `Bearer ${jwtAlice}` } }), env)).json();
  eq(la2.connections.length, 0, 'la liste d’Alice est vide');
  eq((await mcp(tb.access_token, rpc('ping', {}))).status, 200, 'la connexion de Bob n’est pas touchée');
  /* RFC 7009 */
  const rv = await handleOauthRevoke(postForm('/oauth/revoke', { token: tb.access_token, client_id: client.client_id }), env);
  eq(rv.status, 200, '/oauth/revoke → 200');
  eq((await mcp(tb.access_token, rpc('ping', {}))).status, 401, '… la connexion de Bob est révoquée par son client');
  eq((await handleOauthRevoke(postForm('/oauth/revoke', { token: 'nimportequoi', client_id: client.client_id }), env)).status, 200, 'jeton inconnu → 200 quand même (RFC 7009)');
}

console.log('\n▶ 8 · Licence morte');
{
  const t = await fullConsent(jwtBob, 'bob2');
  eq((await mcp(t.access_token, rpc('ping', {}))).status, 200, 'licence active : OK');
  DB._db.exec("UPDATE licences SET is_active = 0 WHERE key = 'BANC-0000-0000-0002'");
  eq((await mcp(t.access_token, rpc('ping', {}))).status, 401, 'licence désactivée : 401 au prochain appel (relue en base)');
  eq((await (await handleOauthToken(postForm('/oauth/token', { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.client_id }), env)).json()).error, 'invalid_grant', '… refresh → invalid_grant');
  DB._db.exec("UPDATE licences SET is_active = 1, expires_at = '2020-01-01' WHERE key = 'BANC-0000-0000-0002'");
  const { challenge } = pkce();
  const a = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CLAUDE_CB)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`), env);
  const id = new URL(a.headers.get('Location')).searchParams.get('req');
  const ap = await (await handleOauthApprove(postJson('/oauth/approve', { req: id, decision: 'allow' }, { Authorization: `Bearer ${jwtBob}` }), env)).json();
  const code = new URL(ap.redirect_to).searchParams.get('code');
  const ex = await (await handleOauthToken(postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: 'a'.repeat(43), redirect_uri: CLAUDE_CB, client_id: client.client_id }), env)).json();
  eq(ex.error, 'invalid_grant', 'licence expirée : pas de jeton à l’échange');
  DB._db.exec("UPDATE licences SET expires_at = NULL WHERE key = 'BANC-0000-0000-0002'");
}

console.log('\n▶ 9 · Purge');
{
  await fullConsent(jwtAlice, 'alice-purge');           // une connexion vivante, avec ses deux jetons
  eq(DB._db.prepare('SELECT COUNT(*) AS n FROM mcp_tokens').get().n, 2, 'deux jetons vivants avant la purge');
  DB._db.exec("UPDATE oauth_codes SET expires_at = '2000-01-01T00:00:00.000Z'");
  DB._db.exec("UPDATE mcp_tokens SET expires_at = '2000-01-01T00:00:00.000Z'");
  DB._db.exec("UPDATE mcp_connections SET revoked_at = '2000-01-01 00:00:00' WHERE revoked_at IS NOT NULL");
  const r = await purgeOauthArtifacts(env);
  yes(r.codes > 0 && r.tokens > 0 && r.connections > 0, `codes, jetons et connexions révoquées purgés (${JSON.stringify(r)})`);
  eq(DB._db.prepare('SELECT COUNT(*) AS n FROM oauth_codes').get().n, 0, 'plus aucun code');
  eq(DB._db.prepare('SELECT COUNT(*) AS n FROM mcp_tokens').get().n, 0, 'plus aucun jeton');
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m\n`);
process.exit(fail ? 1 : 0);
