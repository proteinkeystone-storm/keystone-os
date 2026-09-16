/* ═══════════════════════════════════════════════════════════════
   Banc — Métadonnées OAuth du serveur MCP, contre un Worker VIVANT
   ───────────────────────────────────────────────────────────────
   Ce que Claude lit avant même d'afficher l'écran de consentement :
     1. POST /mcp sans jeton → 401 + WWW-Authenticate resource_metadata
        qui pointe une URL QUI RÉPOND (RFC 9728, découverte).
     2. /.well-known/oauth-protected-resource[/mcp] : resource = …/mcp,
        authorization_servers = [le Worker], portées.
     3. /.well-known/oauth-authorization-server[/mcp] : issuer = origin,
        les trois endpoints sur cette origine, S256 seul, DCR annoncé,
        grant_types code + refresh, auth « none » pour un client public.
     4. Chaque document est du JSON, CORS ouvert, cache court ; OPTIONS
        préflight → 204 avec CORS ouvert (MCP Inspector navigateur).
     5. Latence : /register (DCR réel puis client jeté par la purge) et
        /token (échec propre) répondent en < 2 s — Claude coupe à 10 s.
     6. /oauth/authorize avec un client inconnu → page HTML 400 (pas de
        redirection aveugle) ; GET /oauth/token → 405.
   Lancement (Worker local d'abord, cf. .claude/launch.json « Worker dktest (8799) ») :
     node workers/test/test-oauth-metadata.mjs            # 127.0.0.1:8799
     node workers/test/test-oauth-metadata.mjs --base https://keystone-os-api.keystone-os.workers.dev
   ═══════════════════════════════════════════════════════════════ */
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = arg('--base', process.env.BK_API || 'http://127.0.0.1:8799').replace(/\/$/, '');

let pass = 0, fail = 0;
const ok  = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko  = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));
const eq  = (a, e, l) => (JSON.stringify(a) === JSON.stringify(e) ? ok(l) : ko(l, `attendu ${JSON.stringify(e)}, reçu ${JSON.stringify(a)}`));
const timed = async (fn) => { const t0 = Date.now(); const r = await fn(); return { r, ms: Date.now() - t0 }; };

console.log(`\nMétadonnées OAuth — ${BASE}`);
let origin;
try { origin = new URL(BASE).origin; } catch (_) { console.error('base invalide'); process.exit(2); }

console.log('\n▶ 1 · Découverte depuis /mcp');
let rmUrl;
{
  const r = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
  eq(r.status, 401, 'POST /mcp sans jeton → 401');
  const wa = r.headers.get('www-authenticate') || '';
  const m = wa.match(/resource_metadata="([^"]+)"/);
  yes(m, 'WWW-Authenticate porte resource_metadata', wa);
  rmUrl = m ? m[1] : `${origin}/.well-known/oauth-protected-resource/mcp`;
  yes(rmUrl.startsWith(origin + '/.well-known/oauth-protected-resource'), 'resource_metadata sur la même origine', rmUrl);
  const bad = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ksa_' + 'a'.repeat(43) + '.' + 'b'.repeat(43) }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
  eq(bad.status, 401, 'jeton OAuth inconnu → 401');
  yes(/error="invalid_token"/.test(bad.headers.get('www-authenticate') || ''), '… avec error="invalid_token" (Claude rafraîchit / réautorise)');
}

console.log('\n▶ 2 · Ressource protégée (RFC 9728)');
{
  for (const u of [rmUrl, `${origin}/.well-known/oauth-protected-resource`]) {
    const r = await fetch(u);
    eq(r.status, 200, `${u.replace(origin, '')} → 200`);
    yes(/application\/json/.test(r.headers.get('content-type') || ''), '… JSON');
    eq(r.headers.get('access-control-allow-origin'), '*', '… CORS ouvert');
    const j = await r.json();
    eq(j.resource, `${origin}/mcp`, '… resource = URL du serveur MCP');
    eq(j.authorization_servers, [origin], '… authorization_servers = le Worker');
    yes(Array.isArray(j.scopes_supported) && j.scopes_supported.includes('keystone.read'), '… scopes_supported');
    yes((j.bearer_methods_supported || []).includes('header'), '… bearer en en-tête');
  }
}

console.log('\n▶ 3 · Serveur d’autorisation (RFC 8414)');
let meta;
{
  for (const u of [`${origin}/.well-known/oauth-authorization-server`, `${origin}/.well-known/oauth-authorization-server/mcp`]) {
    const r = await fetch(u);
    eq(r.status, 200, `${u.replace(origin, '')} → 200`);
    meta = await r.json();
    eq(meta.issuer, origin, '… issuer = origine');
    eq(meta.authorization_endpoint, `${origin}/oauth/authorize`, '… authorization_endpoint');
    eq(meta.token_endpoint, `${origin}/oauth/token`, '… token_endpoint');
    eq(meta.registration_endpoint, `${origin}/oauth/register`, '… registration_endpoint (DCR)');
    eq(meta.code_challenge_methods_supported, ['S256'], '… PKCE S256 seul');
    eq(meta.response_types_supported, ['code'], '… response_types = code');
    yes(meta.grant_types_supported.includes('authorization_code') && meta.grant_types_supported.includes('refresh_token'), '… grant_types code + refresh');
    yes(meta.token_endpoint_auth_methods_supported.includes('none'), '… client public accepté (auth none)');
    yes(['keystone.read', 'keystone.write', 'offline_access'].every(s => meta.scopes_supported.includes(s)), '… les trois portées');
  }
  const pre = await fetch(`${origin}/.well-known/oauth-authorization-server`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:6274', 'Access-Control-Request-Method': 'GET' } });
  eq(pre.status, 204, 'OPTIONS préflight → 204');
  eq(pre.headers.get('access-control-allow-origin'), '*', '… CORS ouvert (MCP Inspector)');
}

console.log('\n▶ 4 · Latence des endpoints (limite Claude : 10 s, exigence : < 2 s)');
{
  const reg = await timed(() => fetch(meta.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'banc-metadata', redirect_uris: ['http://localhost:1/cb'], token_endpoint_auth_method: 'none' }) }));
  eq(reg.r.status, 201, 'DCR réel → 201');
  yes(reg.ms < 2000, `/register en ${reg.ms} ms`);
  const c = await reg.r.json();
  yes(c.client_id && !c.client_secret, 'client public : id sans secret');
  const tok = await timed(() => fetch(meta.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: 'x'.repeat(43), code_verifier: 'y'.repeat(43), client_id: c.client_id, redirect_uri: 'http://localhost:1/cb' }).toString() }));
  eq(tok.r.status, 400, 'code inconnu → 400');
  eq((await tok.r.json()).error, 'invalid_grant', '… invalid_grant');
  eq(tok.r.headers.get('cache-control'), 'no-store', '… no-store');
  yes(tok.ms < 2000, `/token en ${tok.ms} ms`);
  const auth = await fetch(`${meta.authorization_endpoint}?client_id=${c.client_id}&redirect_uri=${encodeURIComponent('http://localhost:1/cb')}&response_type=code&code_challenge=${'z'.repeat(43)}&code_challenge_method=S256&state=banc`, { redirect: 'manual' });
  eq(auth.status, 302, '/authorize nominal → 302');
  const loc = auth.headers.get('location') || '';
  yes(/\/connect\?req=/.test(loc), '… vers la page de consentement', loc);
  const unknown = await fetch(`${meta.authorization_endpoint}?client_id=ksc_nope&redirect_uri=${encodeURIComponent('http://localhost:1/cb')}&response_type=code`, { redirect: 'manual' });
  eq(unknown.status, 400, 'client inconnu → 400 (pas de redirection aveugle)');
  yes(/text\/html/.test(unknown.headers.get('content-type') || ''), '… page HTML');
  eq((await fetch(meta.token_endpoint)).status, 405, 'GET /oauth/token → 405');
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m\n`);
process.exit(fail ? 1 : 0);
