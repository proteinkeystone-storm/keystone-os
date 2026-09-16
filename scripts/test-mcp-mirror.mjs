/* ═══════════════════════════════════════════════════════════════
   Banc — Le Reflet chiffré par jeton (MCP sprint 5)
   ───────────────────────────────────────────────────────────────
   Vrais handlers (oauth.js, mcp-mirror.js, mcp.js) sur SQLite en mémoire,
   migrations 015 + 016 + 018 appliquées telles quelles. Le « navigateur »
   est simulé : il génère le secret au consentement, chiffre un reflet
   avec la même dérivation que app/mirror.js et le publie.
   Ce que ce banc PROUVE :
     1. Le secret naît côté navigateur, transite chiffré dans la demande,
        repart dans les jetons, est effacé de la demande ; la connexion
        est liée à la demande (request_id). Sans secret navigateur :
        aléa, connexion sans reflet.
     2. Publication : compte vérifié (404), pad inconnu, 64 Ko max, état.
     3. Lecture par /mcp SANS onglet : le reflet est servi, daté ; sans
        secret (JWT Keystone) → illisible, message vers Réglages ; pad non
        publié → « ouvre Keystone » ; session précise → pas de reflet.
     4. Périmé (> 7 j) → message daté, JAMAIS la donnée ; > 24 h →
        avertissement ; chiffré pour une autre connexion → illisible.
     5. Révocation → reflets effacés ; interrupteur coupé → effacés ;
        purge 90 j. Au repos : rien de lisible en base.
   Lancement : node scripts/test-mcp-mirror.mjs
   ═══════════════════════════════════════════════════════════════ */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { signJWT } from '../workers/src/lib/jwt.js';
import { handleMcp } from '../workers/src/routes/mcp.js';
import { handleOauthRegister, handleOauthAuthorize, handleOauthApprove, handleOauthToken, handleMcpConnectionsList, handleMcpConnectionRevoke, splitToken, ACCESS_PREFIX } from '../workers/src/routes/oauth.js';
import { handleMirrorList, handleMirrorPut, handleMirrorDelete, purgeMcpMirror, mirrorRead } from '../workers/src/routes/mcp-mirror.js';

let pass = 0, fail = 0;
const ok  = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko  = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));
const eq  = (a, e, l) => (JSON.stringify(a) === JSON.stringify(e) ? ok(l) : ko(l, `attendu ${JSON.stringify(e)}, reçu ${JSON.stringify(a)}`));

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
for (const m of ['015_mcp_oauth', '016_mcp_writes', '018_mcp_mirror']) DB._db.exec(readFileSync(new URL(`../workers/migrations/${m}.sql`, import.meta.url), 'utf8'));
DB._db.exec(`CREATE TABLE licences (key TEXT PRIMARY KEY, tenant_id TEXT DEFAULT 'default', owner TEXT, plan TEXT, is_active INTEGER DEFAULT 1, owned_assets TEXT, expires_at TEXT, lookup_hmac TEXT);
             CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor TEXT, target TEXT, tenant_id TEXT, details TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
             INSERT INTO licences (key, owner, plan, lookup_hmac) VALUES ('BANC-0000-0000-0001', 'Alice', 'MAX', 'sub-alice');
             INSERT INTO licences (key, owner, plan, lookup_hmac) VALUES ('BANC-0000-0000-0002', 'Bob', 'PRO', 'sub-bob');`);
const env = { KS_JWT_SECRET: 'jwt-secret-du-banc-32-octets-minimum-0123456789', KS_ENCRYPTION_KEY: 'cle-serveur-du-banc-0123456789', KS_ALLOWED_ORIGIN: 'https://front.test', DB };
const API = 'https://api.test';
const jwtAlice = await signJWT({ sub: 'sub-alice', plan: 'MAX', owner: 'Alice', email: 'alice@banc.test' }, env);
const jwtBob   = await signJWT({ sub: 'sub-bob', plan: 'PRO', owner: 'Bob', email: 'bob@banc.test' }, env);
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const req = (path, init = {}) => new Request(API + path, init);
const postJson = (path, body, headers = {}) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const postForm = (path, obj) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj).toString() });
const CB = 'https://claude.ai/api/mcp/auth_callback';
const client = await (await handleOauthRegister(postJson('/oauth/register', { client_name: 'Claude', redirect_uris: [CB], token_endpoint_auth_method: 'none' }), env)).json();

/* le « navigateur » au consentement : secret généré ici, envoyé à /approve, gardé */
async function consent({ jwt = jwtAlice, browserSecret = b64u(randomBytes(32)) } = {}) {
  const verifier = b64u(randomBytes(48)); const challenge = b64u(createHash('sha256').update(verifier).digest());
  const az = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CB)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=s&scope=${encodeURIComponent('keystone.read keystone.write offline_access')}`), env);
  const reqId = new URL(az.headers.get('Location')).searchParams.get('req');
  const ap = await (await handleOauthApprove(postJson('/oauth/approve', { req: reqId, decision: 'allow', ...(browserSecret ? { mirror_secret: browserSecret } : {}) }, { Authorization: `Bearer ${jwt}` }), env)).json();
  const code = decodeURIComponent((String(ap.redirect_to).match(/code=([^&]+)/) || [])[1] || '');
  const tk = await (await handleOauthToken(postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CB, client_id: client.client_id }), env)).json();
  const conn = DB._db.prepare('SELECT id, request_id, secret_hash FROM mcp_connections WHERE request_id = ?').get(reqId) || null;
  return { reqId, ap, tk, conn, browserSecret };
}
/* le « navigateur » qui publie : même dérivation que app/mirror.js */
async function browserEncrypt(secret, pad, obj) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|keystone-mcp-mirror|${pad}`));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { ciphertext: Buffer.from(buf).toString('base64'), iv: Buffer.from(iv).toString('base64') };
}
const put = (connId, pad, body, jwt = jwtAlice) => handleMirrorPut(req(`/api/mcp/mirror/${connId}/${pad}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }), env, connId, pad);
const dispatch = async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
const call = async (name, args, token) => {
  const r = await handleMcp(new Request(`${API}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }) }), env, dispatch);
  return (await r.json()).result;
};
const SNAP = { _pad: 'brainstorming', _at: '2026-09-17T10:00:00Z',
  'bs.list_sessions': { total: 2, seances: [{ id: 's1', brief: 'Nom du programme', synthese: true }, { id: 's2', brief: 'Slogan', synthese: false }] },
  'bs.read_synthesis': { seance: { id: 's1', brief: 'Nom du programme' }, positionnement: 'Le quartier qui respire', opportunites: ['a'], risques: [], plan_actions: ['b'] },
  'bs.read_debate': { tours: [{ agent: 'Marie', texte: 'Je propose…' }] } };

console.log('\n▶ 1 · Le secret naît dans le navigateur');
const A = await consent();
{
  yes(A.ap.ok && A.ap.mirror === true && A.ap.request_id === A.reqId, '/approve : reflet accepté, demande identifiée');
  const parts = splitToken(A.tk.access_token, ACCESS_PREFIX);
  eq(parts.secret, A.browserSecret, 'le jeton d’accès porte le secret du navigateur');
  eq(splitToken(A.tk.refresh_token, 'ksr_').secret, A.browserSecret, '… le refresh aussi');
  yes(A.conn && A.conn.request_id === A.reqId, 'la connexion est liée à la demande (request_id)');
  const row = DB._db.prepare('SELECT secret_enc, secret_iv FROM oauth_codes WHERE id = ?').get(A.reqId);
  yes(row.secret_enc === null && row.secret_iv === null, 'copie transitoire du secret effacée à l’échange');
  yes(A.conn.secret_hash && A.conn.secret_hash.length === 64 && A.conn.secret_hash !== A.browserSecret, 'seul le hash du secret reste');
  const N = await consent({ browserSecret: null });
  yes(N.ap.mirror === false && splitToken(N.tk.access_token, ACCESS_PREFIX).secret.length >= 40, 'sans secret navigateur : aléa serveur, connexion sans reflet');
  const bad = await consent({ browserSecret: 'trop-court' });
  yes(bad.ap.mirror === false, 'secret mal formé ignoré');
}

console.log('\n▶ 2 · Publication');
{
  const enc = await browserEncrypt(A.browserSecret, 'brainstorming', SNAP);
  eq((await put(A.conn.id, 'brainstorming', enc, jwtBob)).status, 404, 'Bob ne publie pas sur la connexion d’Alice');
  eq((await put('kcn_nope', 'brainstorming', enc)).status, 404, 'connexion inconnue → 404');
  eq((await put(A.conn.id, 'evil', enc)).status, 400, 'pad inconnu → 400');
  eq((await put(A.conn.id, 'brainstorming', { ciphertext: 'pas du base64!!', iv: enc.iv })).status, 400, 'base64 invalide → 400');
  eq((await put(A.conn.id, 'brainstorming', { ciphertext: Buffer.alloc(70000).toString('base64'), iv: enc.iv })).status, 413, '> 64 Ko → 413');
  const r = await put(A.conn.id, 'brainstorming', enc);
  yes(r.status === 200 && (await r.json()).pad === 'brainstorming', 'reflet publié');
  const raw = DB._db.prepare('SELECT ciphertext FROM mcp_mirror WHERE connection_id = ?').get(A.conn.id).ciphertext;
  yes(!/Nom du programme|Slogan|quartier/.test(Buffer.from(raw, 'base64').toString('latin1')), 'au repos : rien de lisible en base');
  const l = await (await handleMirrorList(req('/api/mcp/mirror', { headers: { Authorization: `Bearer ${jwtAlice}` } }), env)).json();
  yes(l.items.length === 1 && l.items[0].pad === 'brainstorming' && /Z$/.test(l.items[0].updated_at), 'état : 1 reflet daté');
  const lc = await (await handleMcpConnectionsList(req('/api/mcp/connections', { headers: { Authorization: `Bearer ${jwtAlice}` } }), env)).json();
  const mine = lc.connections.find(c => c.id === A.conn.id);
  yes(mine.request_id === A.reqId && mine.mirror.length === 1 && mine.mirror[0].pad === 'brainstorming', 'tuile : request_id + reflets par connexion');
}

console.log('\n▶ 3 · Lecture par /mcp sans onglet');
{
  let r = await call('keystone_brainstorming_sessions', {}, A.tk.access_token);
  yes(r.isError === false && r.structuredContent.total === 2 && r.structuredContent.seances[1].brief === 'Slogan', 'séances servies depuis le reflet');
  yes(r.structuredContent.reflet && /Z$/.test(r.structuredContent.reflet.du) && !r.structuredContent.reflet.avertissement, '… datées, sans avertissement (frais)');
  r = await call('keystone_brainstorming_synthesis', {}, A.tk.access_token);
  yes(r.isError === false && r.structuredContent.positionnement === 'Le quartier qui respire', 'dernière synthèse servie');
  r = await call('keystone_brainstorming_synthesis', { session_id: 's2' }, A.tk.access_token);
  yes(r.isError && /Aucun onglet/.test(r.content[0].text), 'séance précise : pas de reflet (jamais une donnée approximative)');
  r = await call('keystone_ghostwriter_library', {}, A.tk.access_token);
  yes(r.isError && /Aucun onglet/.test(r.content[0].text) && /Visible par mon assistant/.test(r.content[0].text), 'pad non publié → ouvre Keystone + indication de l’interrupteur');
  r = await call('keystone_brainstorming_sessions', {}, jwtAlice);
  yes(r.isError && /Aucun onglet/.test(r.content[0].text), 'JWT Keystone (sans secret) : le reflet est illisible → erreur claire');
  eq(DB._db.prepare("SELECT COUNT(*) AS n FROM mcp_jobs").get().n, 0, 'aucun ordre créé sans onglet');
}

console.log('\n▶ 4 · Fraîcheur et clé');
{
  DB._db.prepare("UPDATE mcp_mirror SET updated_at = datetime('now', '-30 hours') WHERE connection_id = ?").run(A.conn.id);
  let r = await call('keystone_brainstorming_sessions', {}, A.tk.access_token);
  yes(r.isError === false && /plus de 30 h/.test(r.structuredContent.reflet.avertissement || ''), '> 24 h : données + avertissement daté');
  DB._db.prepare("UPDATE mcp_mirror SET updated_at = datetime('now', '-8 days') WHERE connection_id = ?").run(A.conn.id);
  r = await call('keystone_brainstorming_sessions', {}, A.tk.access_token);
  yes(r.isError && /Reflet trop ancien \(du 20/.test(r.content[0].text), '> 7 j : message daté, jamais la donnée');
  DB._db.prepare("UPDATE mcp_mirror SET updated_at = datetime('now') WHERE connection_id = ?").run(A.conn.id);
  const m = await mirrorRead(env, { sub: 'sub-alice', connectionId: A.conn.id, secret: 'mauvais-secret-' + 'x'.repeat(30), pad: 'brainstorming' });
  eq(m.ok === false && m.reason, 'illisible', 'mauvais secret → illisible');
  /* une seconde connexion (autre secret) ne lit pas un reflet chiffré pour la première */
  const B = await consent();
  const encWrongKey = await browserEncrypt(A.browserSecret, 'brainstorming', SNAP);
  await put(B.conn.id, 'brainstorming', encWrongKey);
  r = await call('keystone_brainstorming_sessions', {}, B.tk.access_token);
  yes(r.isError && /illisible/.test(r.content[0].text), 'reflet chiffré pour une autre connexion → illisible, invitation à republier');
  const encRight = await browserEncrypt(B.browserSecret, 'brainstorming', SNAP);
  await put(B.conn.id, 'brainstorming', encRight);
  r = await call('keystone_brainstorming_sessions', {}, B.tk.access_token);
  yes(r.isError === false && r.structuredContent.total === 2, '… republié avec le bon secret → lisible');
  const m2 = await mirrorRead(env, { sub: 'sub-alice', connectionId: A.conn.id, secret: null, pad: 'brainstorming' });
  eq(m2.reason, 'absent', 'sans secret : absent');
}

console.log('\n▶ 5 · Révocation, interrupteur, purge');
{
  eq(DB._db.prepare('SELECT COUNT(*) AS n FROM mcp_mirror').get().n, 2, 'deux reflets avant');
  eq((await handleMcpConnectionRevoke(req(`/api/mcp/connections/${A.conn.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${jwtAlice}` } }), env, A.conn.id)).status, 200, 'Alice révoque la première connexion');
  eq(DB._db.prepare('SELECT COUNT(*) AS n FROM mcp_mirror WHERE connection_id = ?').get(A.conn.id).n, 0, '… ses reflets sont effacés');
  const r = await call('keystone_brainstorming_sessions', {}, A.tk.access_token);
  yes(r === undefined || r.isError, '… son jeton ne lit plus rien');
  const d = await (await handleMirrorDelete(req('/api/mcp/mirror/brainstorming', { method: 'DELETE', headers: { Authorization: `Bearer ${jwtAlice}` } }), env, 'brainstorming')).json();
  eq(d.deleted, 1, 'interrupteur coupé → reflets du pad effacés (toutes connexions)');
  const B2 = await consent();
  await put(B2.conn.id, 'social', await browserEncrypt(B2.browserSecret, 'social', { 'sm.read_composer': { brouillon: false } }));
  DB._db.prepare("UPDATE mcp_mirror SET updated_at = datetime('now', '-100 days')").run();
  eq((await purgeMcpMirror(env)).mirror, 1, 'purge : reflet non rafraîchi depuis 90 j effacé');
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m`);
process.exit(fail ? 1 : 0);
