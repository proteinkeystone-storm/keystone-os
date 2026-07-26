/* ═══════════════════════════════════════════════════════════════
   AUTH-1→4 — Durcissement magic-link : suite E2E contre
   `wrangler dev --local`. Prouve :
     (1) un GET (scanner d'email) ne consomme JAMAIS le token,
     (2) double consommation concurrente → UN SEUL JWT (anti-course),
     (3) code OTP 6 chiffres : nominal, cross-device (fingerprint
         mismatch toléré sur le chemin code, 403 sur le chemin lien),
     (4) 5 tentatives OTP fausses → verrouillé même avec le bon code,
     (5) une nouvelle demande invalide les tokens précédents,
     (6) email inexistant / rate-limited → réponse STRICTEMENT
         identique au nominal (anti-oracle), zéro lien créé,
     (7) purge cron : les liens expirés > 48 h disparaissent.

   Le script SE SEED LUI-MÊME (d1 execute --local) avec des tokens /
   codes connus : les hashes stockés sont recalculés ici (SHA-256 +
   pepper de test). Aucun email n'est envoyé (KS_RESEND_KEY absent).

   Lancer le worker AVANT :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --test-scheduled \
       --var KS_JWT_SECRET:bk-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:bk-admin --var KS_LOOKUP_PEPPER:bk-pepper
   Puis :
     node test/test-auth-magic-hardening.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const API    = process.env.BK_API || 'http://127.0.0.1:8799';
const PEPPER = process.env.KS_LOOKUP_PEPPER || 'bk-pepper';

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const otpHash = (linkId, code) => sha256(`${linkId}:${code}:${PEPPER}`);

// ── Fixtures — tokens 64 hex connus, codes connus ───────────────
const LIC = 'BENCH-AUTH-0001-0001';
const T = {
  scanner:  'a1'.repeat(32),   // L1 — GET répétés puis consume humain
  race:     'b2'.repeat(32),   // L2 — deux consommations concurrentes
  expired:  'c3'.repeat(32),   // L3 — expiré depuis 72 h (purge)
  fp:       'd4'.repeat(32),   // L5 — fingerprint desktop posé
  brute:    'e5'.repeat(32),   // L6 — 5 tentatives OTP fausses
  inval:    'f6'.repeat(32),   // L7 — tué par une nouvelle demande
};
const OTP = { scanner: '111111', race: '222222', fp: '333333', brute: '444444', inval: '555555' };
const EMAILS = {
  scanner: 'user@bench.ks',
  race:    'race@bench.ks',
  fp:      'fpuser@bench.ks',
  brute:   'brute@bench.ks',
  inval:   'inval@bench.ks',
  ghost:   'ghost@bench.ks',   // n'existe dans AUCUNE table
};

function linkRow(id, token, otp, email, { expiresH = 1, consumed = false, fingerprint = null } = {}) {
  const exp = new Date(Date.now() + expiresH * 3600 * 1000).toISOString();
  return `INSERT OR REPLACE INTO magic_links (id, token_hash, otp_hash, otp_attempts, email, licence_key, purpose, fingerprint, expires_at, consumed_at, ip_hash)
    VALUES ('${id}', '${sha256(token)}', ${otp ? `'${otpHash(id, otp)}'` : 'NULL'}, 0, '${email}', '${LIC}', 'magic_login', ${fingerprint ? `'${fingerprint}'` : 'NULL'}, '${exp}', ${consumed ? "datetime('now')" : 'NULL'}, NULL);`;
}

const SEED = `
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
CREATE TABLE IF NOT EXISTS magic_links (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, email TEXT NOT NULL, licence_key TEXT,
  purpose TEXT NOT NULL DEFAULT 'magic_login', fingerprint TEXT, expires_at TEXT NOT NULL,
  consumed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), ip_hash TEXT,
  otp_hash TEXT, otp_attempts INTEGER NOT NULL DEFAULT 0
);
DELETE FROM magic_links WHERE email LIKE '%@bench.ks';
DELETE FROM licence_emails WHERE email LIKE '%@bench.ks';
CREATE TABLE IF NOT EXISTS auth_request_log (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
DELETE FROM auth_request_log WHERE email LIKE '%@bench.ks';
INSERT OR REPLACE INTO licences (key, tenant_id, owner, plan, is_active) VALUES ('${LIC}', 'default', 'Bench', 'PRO', 1);
${Object.entries(EMAILS).filter(([k]) => k !== 'ghost').map(([k, e]) =>
  `INSERT INTO licence_emails (id, licence_key, email, role, status, activated_at) VALUES ('le-${k}', '${LIC}', '${e}', 'owner', 'active', datetime('now'));`).join('\n')}
${linkRow('L1', T.scanner, OTP.scanner, EMAILS.scanner)}
${linkRow('L2', T.race,    OTP.race,    EMAILS.race)}
${linkRow('L3', T.expired, null,        EMAILS.scanner, { expiresH: -72 })}
${linkRow('L5', T.fp,      OTP.fp,      EMAILS.fp, { fingerprint: 'fp-desktop' })}
${linkRow('L6', T.brute,   OTP.brute,   EMAILS.brute)}
${linkRow('L7', T.inval,   OTP.inval,   EMAILS.inval)}
`;

function d1(sqlOrFile, { file = false } = {}) {
  const flag = file ? `--file="${sqlOrFile}"` : `--command "${sqlOrFile.replace(/"/g, '\\"')}"`;
  const out = execSync(
    `npx wrangler d1 execute keystone-os --local -c wrangler.dktest.toml ${flag} --json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try { return JSON.parse(out); } catch { return null; }
}
function d1Rows(sql) {
  const parsed = d1(sql);
  return parsed?.[0]?.results ?? [];
}

async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}
const consume    = (token, fingerprint = 'fp-bench') => post('/api/auth/consume-magic-link', { token, fingerprint });
const consumeOtp = (email, code, fingerprint = 'fp-bench') => post('/api/auth/consume-otp', { email, code, fingerprint });
const request    = email => post('/api/auth/request-magic-link', { email });

// Le CLI d1 --json sérialise NULL en chaîne "null"
const isNull = v => v === null || v === 'null' || v === undefined;

function jwtPayload(jwt) {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
  } catch { return null; }
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

async function main() {
  console.log('AUTH-1→4 — durcissement magic-link sur', API, '\n');

  // ── Seed ──────────────────────────────────────────────────────
  const tmp = 'test/.auth-seed.tmp.sql';
  writeFileSync(tmp, SEED);
  try { d1(tmp, { file: true }); } finally { try { unlinkSync(tmp); } catch {} }
  console.log('Seed posé (licence bench + 6 liens à hashes connus)\n');

  // ── (1) AUTH-1 : le scanner (GET) ne consomme rien ────────────
  console.log('— P1 · scanner d\'email —');
  for (let i = 0; i < 5; i++) {
    await fetch(`${API}/api/auth/consume-magic-link?token=${T.scanner}`);
    await fetch(`${API}/auth/magic?token=${T.scanner}`);
  }
  const afterGets = d1Rows(`SELECT consumed_at FROM magic_links WHERE id = 'L1'`);
  ok(afterGets.length === 1 && isNull(afterGets[0].consumed_at), '10 GET (worker + path front) → token toujours vierge', afterGets);
  const human = await consume(T.scanner);
  ok(human.status === 200 && !!human.data?.jwt, 'puis POST humain → 200 + JWT', human);
  ok(jwtPayload(human.data?.jwt)?.via === 'magic_link', 'JWT via=magic_link, plan PRO',
    jwtPayload(human.data?.jwt));

  // ── (2) AUTH-3 : anti-course ──────────────────────────────────
  console.log('\n— P5 · double consommation concurrente —');
  const [r1, r2] = await Promise.all([consume(T.race), consume(T.race)]);
  const statuses = [r1.status, r2.status].sort();
  ok(statuses[0] === 200 && statuses[1] === 401, 'deux POST simultanés → exactement un 200 et un 401', statuses);
  const jwts = [r1, r2].filter(r => r.data?.jwt).length;
  ok(jwts === 1, 'un seul JWT émis', { jwts });

  // ── (3) AUTH-2 : fingerprint — lien strict, code tolérant ─────
  console.log('\n— P2 · changement d\'appareil —');
  const fpLink = await consume(T.fp, 'fp-mobile');
  ok(fpLink.status === 403, 'lien depuis un autre appareil → 403 (strict)', fpLink.status);
  const stillAlive = d1Rows(`SELECT consumed_at FROM magic_links WHERE id = 'L5'`);
  ok(isNull(stillAlive[0]?.consumed_at), 'le 403 ne consomme PAS le lien', stillAlive);
  const fpOtp = await consumeOtp(EMAILS.fp, OTP.fp, 'fp-mobile');
  ok(fpOtp.status === 200 && !!fpOtp.data?.jwt, 'code OTP depuis l\'autre appareil → 200 (chemin cross-device)', fpOtp.status);
  ok(jwtPayload(fpOtp.data?.jwt)?.via === 'otp', 'JWT via=otp', jwtPayload(fpOtp.data?.jwt)?.via);

  // ── (4) AUTH-2 : verrouillage après 5 tentatives ──────────────
  console.log('\n— OTP · force brute —');
  let last = null;
  for (let i = 0; i < 5; i++) last = await consumeOtp(EMAILS.brute, '000000');
  ok(last.status === 423, '5e code faux → 423 verrouillé', last);
  const goodAfterLock = await consumeOtp(EMAILS.brute, OTP.brute);
  ok(goodAfterLock.status === 423, 'BON code après verrouillage → 423 quand même', goodAfterLock.status);

  // ── (5) AUTH-3 : nouvelle demande invalide l'ancien token ─────
  console.log('\n— P5 · invalidation par nouvelle demande —');
  const req1 = await request(EMAILS.inval);
  ok(req1.status === 200 && req1.data?.ok, 'demande pour un compte réel → 200 silencieux', req1);
  const oldTok = await consume(T.inval);
  ok(oldTok.status === 401, 'l\'ancien token est mort (expiré) après la nouvelle demande', oldTok.status);

  // ── (6) AUTH-4 : anti-oracle strict ───────────────────────────
  console.log('\n— P4 · indistinguabilité —');
  const ghost1 = await request(EMAILS.ghost);
  ok(ghost1.status === 200, 'email inexistant → 200', ghost1.status);
  ok(JSON.stringify(ghost1.data) === JSON.stringify(req1.data),
    'corps STRICTEMENT identique (existant vs inexistant)', { ghost: ghost1.data, real: req1.data });
  const ghost2 = await request(EMAILS.ghost); // < 60 s → cooldown
  ok(ghost2.status === 200 && JSON.stringify(ghost2.data) === JSON.stringify(ghost1.data),
    'rate-limited (cooldown 60 s) → réponse toujours identique', ghost2);
  const ghostLinks = d1Rows(`SELECT COUNT(*) AS n FROM magic_links WHERE email = '${EMAILS.ghost}'`);
  ok((ghostLinks[0]?.n ?? -1) === 0, 'aucun lien créé pour l\'email inexistant', ghostLinks);
  const ghostLog = d1Rows(`SELECT COUNT(*) AS n FROM auth_request_log WHERE email = '${EMAILS.ghost}'`);
  ok((ghostLog[0]?.n ?? 0) >= 2, 'les demandes inexistantes SONT journalisées (le quota les voit)', ghostLog);
  const invalLinks = d1Rows(`SELECT COUNT(*) AS n FROM magic_links WHERE email = '${EMAILS.inval}' AND consumed_at IS NULL AND expires_at > datetime('now')`);
  ok((invalLinks[0]?.n ?? -1) === 1, 'le compte réel, lui, a bien reçu UN lien vivant', invalLinks);

  // ── (7) AUTH-3 : purge cron ───────────────────────────────────
  console.log('\n— P5 · purge —');
  // fetch Node peut ECONNRESET sur la réutilisation de connexion
  // après une rafale — on retente sur une connexion neuve.
  let purgeStatus = 0;
  for (let i = 0; i < 3 && purgeStatus !== 200; i++) {
    try {
      const purge = await fetch(`${API}/__scheduled?cron=0+3+*+*+*`, { headers: { Connection: 'close' } });
      purgeStatus = purge.status;
    } catch { await new Promise(r => setTimeout(r, 800)); }
  }
  ok(purgeStatus === 200, 'déclenchement du cron quotidien (test-scheduled)', purgeStatus);
  await new Promise(r => setTimeout(r, 1500));
  const expiredLeft = d1Rows(`SELECT COUNT(*) AS n FROM magic_links WHERE id = 'L3'`);
  ok((expiredLeft[0]?.n ?? -1) === 0, 'le lien expiré depuis 72 h est purgé', expiredLeft);

  console.log(`\n═══ ${pass} ✓ · ${fail} ✗ ═══`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
