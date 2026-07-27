/* ═══════════════════════════════════════════════════════════════
   AUTH-6 — SSO OIDC : suite E2E contre `wrangler dev --local`
   avec un IdP FACTICE (Node, 127.0.0.1:8798) qui parle le vrai
   protocole : discovery, token endpoint, JWKS, id_token RS256.

   Prouve :
     (1) lookup : domaine inconnu → sso:false, connu → sso:true
     (2) start → 302 IdP avec state + nonce + PKCE S256 + login_hint
     (3) CHAÎNE COMPLÈTE : callback → magic-link → consume → JWT
     (4) state rejoué → refusé (usage unique)
     (5) nonce falsifié → idtoken_invalid
     (6) signature falsifiée (autre clé RSA) → idtoken_invalid
     (7) email d'un autre domaine → email_domain_mismatch
     (8) identité OK mais sans compte Keystone → no_account
     (9) admin : la liste ne fuit JAMAIS le client_secret
    (10) algorithmes faibles refusés : alg none, HS256
    (11) iss falsifié / aud d'un autre client / id_token expiré /
         email_verified:false / iat futur → refusés
    (12) audience multiple : sans azp → refusé ; azp correct → accepté
    (13) découverte : doc.issuer menteur, réponse en redirection,
         token_endpoint http non-loopback → tous refusés au /start
    (14) flood de /start même IP → rate_limited (borne D1)

   Lancer le worker AVANT :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --var KS_JWT_SECRET:bk-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:bk-admin --var KS_LOOKUP_PEPPER:bk-pepper \
       --var KS_ENCRYPTION_KEY:bk-encryption-key-32-chars-min!
   Puis :
     node test/test-auth-oidc.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const API     = process.env.BK_API || 'http://127.0.0.1:8799';
const ADMIN   = process.env.BK_ADMIN || 'bk-admin';
const IDP     = 'http://127.0.0.1:8798';
const DOMAIN  = 'bench-sso.ks';
const CLIENT  = 'ks-bench-client';
const LIC     = 'BENCH-SSO0-0001-0001';
const USER    = `sso-user@${DOMAIN}`;

// ── IdP factice ─────────────────────────────────────────────────
// Le « code » d'autorisation encode les instructions du scénario :
//   base64url(JSON { email, nonce, tamper })
// tamper: 'nonce' → id_token avec mauvais nonce ; 'sig' → signé par
// une AUTRE clé RSA (signature invalide).
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const evilKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'bench-1';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function makeIdToken({ email, nonce, tamper }) {
  const alg = tamper === 'alg-none' ? 'none' : tamper === 'alg-hs256' ? 'HS256' : 'RS256';
  const header  = b64u(JSON.stringify({ alg, typ: 'JWT', kid: KID }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({
    iss: tamper === 'iss' ? 'https://evil.example' : IDP,
    aud: tamper === 'aud' ? 'autre-client'
       : (tamper === 'aud-multi' || tamper === 'aud-multi-azp') ? [CLIENT, 'autre-client'] : CLIENT,
    ...(tamper === 'aud-multi-azp' ? { azp: CLIENT } : {}),
    exp: tamper === 'expired' ? now - 3600 : now + 600,
    iat: tamper === 'iat-future' ? now + 3600 : now,
    nonce: tamper === 'nonce' ? 'wrong-nonce' : nonce,
    email, email_verified: tamper === 'unverified' ? false : true,
  }));
  if (tamper === 'alg-none')  return `${header}.${payload}.`;
  if (tamper === 'alg-hs256') {
    const mac = crypto.createHmac('sha256', 'nimporte-quoi').update(`${header}.${payload}`).digest();
    return `${header}.${payload}.${b64u(mac)}`;
  }
  const signer = tamper === 'sig' ? evilKeys.privateKey : privateKey;
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), signer);
  return `${header}.${payload}.${b64u(sig)}`;
}

const idp = http.createServer((req, res) => {
  const send = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  // (13) IdP « menteur » : le doc se déclare au nom d'un AUTRE issuer.
  if (req.url.startsWith('/lying/.well-known/openid-configuration')) {
    return send({
      issuer: IDP, // ≠ IDP/lying configuré → doit être refusé
      authorization_endpoint: `${IDP}/authorize`,
      token_endpoint: `${IDP}/token`,
      jwks_uri: `${IDP}/jwks`,
    });
  }
  // (13) découverte servie via redirection → doit être refusée.
  if (req.url.startsWith('/redir/.well-known/openid-configuration')) {
    res.statusCode = 302;
    res.setHeader('Location', `${IDP}/.well-known/openid-configuration`);
    return res.end();
  }
  // (13) token_endpoint en http non-loopback → doit être refusé.
  if (req.url.startsWith('/httpep/.well-known/openid-configuration')) {
    return send({
      issuer: `${IDP}/httpep`,
      authorization_endpoint: `${IDP}/authorize`,
      token_endpoint: 'http://198.51.100.1/token',
      jwks_uri: `${IDP}/jwks`,
    });
  }
  if (req.url.startsWith('/.well-known/openid-configuration')) {
    return send({
      issuer: IDP,
      authorization_endpoint: `${IDP}/authorize`,
      token_endpoint: `${IDP}/token`,
      jwks_uri: `${IDP}/jwks`,
    });
  }
  if (req.url.startsWith('/jwks')) {
    const jwk = publicKey.export({ format: 'jwk' });
    return send({ keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] });
  }
  if (req.url.startsWith('/token')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const p = new URLSearchParams(body);
      if (!p.get('code_verifier') || !p.get('client_secret')) {
        res.statusCode = 400; return send({ error: 'invalid_request' });
      }
      const instr = JSON.parse(Buffer.from(p.get('code'), 'base64url').toString());
      return send({ id_token: makeIdToken(instr), access_token: 'at', token_type: 'Bearer' });
    });
    return;
  }
  res.statusCode = 404; res.end('not found');
});

// ── Helpers banc ────────────────────────────────────────────────
function d1(sql) {
  const tmp = 'test/.oidc-seed.tmp.sql';
  // BK_PERSIST : même dossier d'état que le worker lancé avec --persist-to
  // (campagne locale sur base jetable) ; la CI reste sur l'état par défaut.
  const persist = process.env.BK_PERSIST ? ` --persist-to "${process.env.BK_PERSIST}"` : '';
  writeFileSync(tmp, sql);
  try {
    execSync(`npx wrangler d1 execute keystone-os --local -c wrangler.dktest.toml${persist} --file="${tmp}" --json`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } finally { try { unlinkSync(tmp); } catch {} }
}
async function get(path, { redirect = 'manual', headers = {} } = {}) {
  const res = await fetch(API + path, { redirect, headers });
  return res;
}
const code = (instr) => Buffer.from(JSON.stringify(instr)).toString('base64url');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? String(extra).slice(0, 300) : ''); }
}

async function main() {
  await new Promise(r => idp.listen(8798, '127.0.0.1', r));
  console.log('AUTH-6 — SSO OIDC sur', API, '· IdP factice', IDP, '\n');

  // Seed licence + compte
  d1(`
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT);
    INSERT OR IGNORE INTO tenants (id, name) VALUES ('default', 'default');
    CREATE TABLE IF NOT EXISTS licences (
      key TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default', owner TEXT NOT NULL,
      plan TEXT DEFAULT 'STARTER', is_active INTEGER DEFAULT 1, owned_assets TEXT,
      expires_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS licence_emails (
      id TEXT PRIMARY KEY, licence_key TEXT NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner', status TEXT NOT NULL DEFAULT 'active',
      invited_by TEXT, invited_at TEXT NOT NULL DEFAULT (datetime('now')),
      activated_at TEXT, revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS oidc_states (
      state TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL,
      conn_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), ip_hash TEXT
    );
    DELETE FROM oidc_states;
    DELETE FROM licence_emails WHERE email LIKE '%@${DOMAIN}';
    INSERT OR REPLACE INTO licences (key, tenant_id, owner, plan, is_active) VALUES ('${LIC}', 'default', 'Bench SSO', 'PRO', 1);
    INSERT INTO licence_emails (id, licence_key, email, role, status, activated_at) VALUES ('le-sso', '${LIC}', '${USER}', 'owner', 'active', datetime('now'));
  `);

  // (9-pré) Enregistrer la connexion via l'API admin
  const create = await fetch(API + '/api/admin/sso-connections', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_domain: DOMAIN, issuer: IDP, client_id: CLIENT, client_secret: 'bench-sso-secret' }),
  });
  ok(create.status === 200, 'admin: création de la connexion SSO', create.status);
  const noAuth = await fetch(API + '/api/admin/sso-connections');
  ok(noAuth.status === 401, 'admin: sans Bearer → 401', noAuth.status);

  // (1) lookup
  const l1 = await (await get('/api/auth/sso/lookup?domain=inconnu.fr')).json();
  const l2 = await (await get(`/api/auth/sso/lookup?domain=${DOMAIN}`)).json();
  ok(l1.sso === false, 'lookup domaine inconnu → sso:false', JSON.stringify(l1));
  ok(l2.sso === true,  'lookup domaine configuré → sso:true', JSON.stringify(l2));

  // (2) start
  const start = await get(`/api/auth/oidc/start?domain=${DOMAIN}`);
  ok(start.status === 302, 'start → 302', start.status);
  const loc = new URL(start.headers.get('location'));
  const state = loc.searchParams.get('state');
  ok(loc.origin + loc.pathname === `${IDP}/authorize`, 'redirigé vers l\'IdP', loc.href);
  ok(!!state && state.length >= 64, 'state 32 bytes présent');
  ok(loc.searchParams.get('code_challenge_method') === 'S256', 'PKCE S256');
  ok(loc.searchParams.get('login_hint') === `@${DOMAIN}`, 'login_hint domaine');
  const nonce = loc.searchParams.get('nonce');

  // (3) CHAÎNE COMPLÈTE : callback → magic-link → consume → JWT
  const cb = await get(`/api/auth/oidc/callback?code=${code({ email: USER, nonce })}&state=${state}`);
  ok(cb.status === 302, 'callback heureux → 302', cb.status);
  const magicLoc = cb.headers.get('location') || '';
  const token = new URL(magicLoc).searchParams.get('token');
  ok(magicLoc.includes('/auth/magic?token='), 'redirigé vers la page Confirmer (magic-link)', magicLoc.slice(0, 80));
  const consume = await fetch(API + '/api/auth/consume-magic-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, fingerprint: 'fp-sso-bench' }),
  });
  const consumed = await consume.json();
  ok(consume.status === 200 && !!consumed.jwt, 'consume du token SSO → 200 + JWT', consume.status);
  // Un consume raté ne doit pas crasher la suite : les scénarios
  // suivants doivent quand même s'exécuter et compter leurs échecs.
  const payload = consumed.jwt
    ? JSON.parse(Buffer.from(consumed.jwt.split('.')[1], 'base64url').toString())
    : {};
  ok(payload.email === USER && payload.plan === 'PRO', 'JWT : bon email, bon plan', JSON.stringify({ email: payload.email, plan: payload.plan }));

  // (4) rejeu du state (déjà consommé par le callback heureux)
  const replay = await get(`/api/auth/oidc/callback?code=${code({ email: USER, nonce })}&state=${state}`);
  ok((replay.headers.get('location') || '').includes('sso_error=state_unknown'), 'state rejoué → refusé', replay.headers.get('location'));

  // Helper : nouveau state frais pour chaque scénario d'échec
  async function freshState() {
    const s = await get(`/api/auth/oidc/start?domain=${DOMAIN}`);
    const u = new URL(s.headers.get('location'));
    return { state: u.searchParams.get('state'), nonce: u.searchParams.get('nonce') };
  }

  // (5) nonce falsifié
  let f = await freshState();
  let r = await get(`/api/auth/oidc/callback?code=${code({ email: USER, nonce: f.nonce, tamper: 'nonce' })}&state=${f.state}`);
  ok((r.headers.get('location') || '').includes('sso_error=idtoken_invalid'), 'nonce falsifié → idtoken_invalid', r.headers.get('location'));

  // (6) signature d'une autre clé RSA
  f = await freshState();
  r = await get(`/api/auth/oidc/callback?code=${code({ email: USER, nonce: f.nonce, tamper: 'sig' })}&state=${f.state}`);
  ok((r.headers.get('location') || '').includes('sso_error=idtoken_invalid'), 'signature falsifiée → idtoken_invalid', r.headers.get('location'));

  // (7) email hors domaine de la connexion
  f = await freshState();
  r = await get(`/api/auth/oidc/callback?code=${code({ email: 'intrus@autre-boite.fr', nonce: f.nonce })}&state=${f.state}`);
  ok((r.headers.get('location') || '').includes('sso_error=email_domain_mismatch'), 'email hors domaine → refusé', r.headers.get('location'));

  // (8) identité vérifiée mais aucun compte Keystone
  f = await freshState();
  r = await get(`/api/auth/oidc/callback?code=${code({ email: `fantome@${DOMAIN}`, nonce: f.nonce })}&state=${f.state}`);
  ok((r.headers.get('location') || '').includes('sso_error=no_account'), 'sans compte Keystone → no_account', r.headers.get('location'));

  // (9) la liste admin ne fuit pas le secret
  const list = await (await fetch(API + '/api/admin/sso-connections', { headers: { Authorization: 'Bearer ' + ADMIN } })).json();
  const conn = (list.connections || []).find(c => c.email_domain === DOMAIN);
  ok(!!conn && !('secret_ct' in conn) && !('secret_iv' in conn) && !JSON.stringify(list).includes('bench-sso-secret'),
    'liste admin : aucun champ secret exposé', JSON.stringify(conn || {}));

  // (10)+(11)+(12) id_tokens hostiles — chaque variante DOIT mourir sur
  // idtoken_invalid, sauf aud-multi-azp qui est légitime.
  const hostile = [
    ['alg-none',   'alg none refusé'],
    ['alg-hs256',  'alg HS256 refusé'],
    ['iss',        'iss falsifié refusé'],
    ['aud',        'aud d\'un autre client refusée'],
    ['expired',    'id_token expiré refusé'],
    ['unverified', 'email_verified:false refusé'],
    ['aud-multi',  'audience multiple sans azp refusée'],
    ['iat-future', 'iat futur refusé'],
  ];
  for (const [tamper, label] of hostile) {
    f = await freshState();
    r = await get(`/api/auth/oidc/callback?code=${code({ email: USER, nonce: f.nonce, tamper })}&state=${f.state}`);
    ok((r.headers.get('location') || '').includes('sso_error=idtoken_invalid'), label, r.headers.get('location'));
  }
  // (12) audience multiple AVEC azp correct → chaîne heureuse
  f = await freshState();
  r = await get(`/api/auth/oidc/callback?code=${code({ email: USER, nonce: f.nonce, tamper: 'aud-multi-azp' })}&state=${f.state}`);
  ok((r.headers.get('location') || '').includes('/auth/magic?token='), 'audience multiple avec azp correct → acceptée', r.headers.get('location'));

  // (13) découvertes empoisonnées : la connexion se crée (l'admin ne
  // sonde pas l'IdP), mais le /start doit refuser idp_unreachable.
  const poisoned = [
    ['banc-lying.ks',  `${IDP}/lying`,  'doc.issuer menteur → start refusé'],
    ['banc-redir.ks',  `${IDP}/redir`,  'découverte en redirection → start refusé'],
    ['banc-httpep.ks', `${IDP}/httpep`, 'token_endpoint http non-loopback → start refusé'],
  ];
  for (const [dom, issuer, label] of poisoned) {
    const c = await fetch(API + '/api/admin/sso-connections', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_domain: dom, issuer, client_id: CLIENT, client_secret: 's' }),
    });
    ok(c.status === 200, `connexion ${dom} enregistrée`, c.status);
    const s = await get(`/api/auth/oidc/start?domain=${dom}`);
    ok((s.headers.get('location') || '').includes('sso_error=idp_unreachable'), label, s.headers.get('location'));
  }

  // (14) flood de /start : la limite par IP doit finir par tomber.
  // EN DERNIER — une fois déclenchée, l'IP du banc est grillée 10 min.
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) {
    const s = await get(`/api/auth/oidc/start?domain=${DOMAIN}`);
    limited = (s.headers.get('location') || '').includes('sso_error=rate_limited');
  }
  ok(limited, 'flood de /start même IP → rate_limited');

  console.log(`\n═══ ${pass} ✓ · ${fail} ✗ ═══`);
  idp.close();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); idp.close(); process.exit(1); });
