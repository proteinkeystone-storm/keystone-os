// ─────────────────────────────────────────────────────────────────────────
// SCEAU S1 — tests d'intégration sur le VRAI code des handlers.
// Vraie SQLite en mémoire (node:sqlite) derrière un adaptateur D1 minimal +
// vrai client OPRF (@cloudflare/voprf-ts). Aucun mock du code métier.
//   node workers/test/sceau.test.mjs   (depuis la racine repo, ou `npm test` dans workers/)
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Oprf, VOPRFClient, Evaluation } from '@cloudflare/voprf-ts';
import { signJWT } from '../src/lib/jwt.js';
import {
  handleSceauInit, handleSceauEvalCreate, handleSceauSeal, handleSceauList,
  handleSceauDelete, handleSceauMeta, handleSceauEval, handleSceauBlob, handleSceauOpened, sweepExpiredSecrets,
  handleTokenCreate, handleTokenList, handleTokenPoint, handleTokenDelete,
  handleTokenMeta, handleTokenEval, handleTokenBlob, handleTokenOpened,
} from '../src/routes/sceau.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const SUITE = Oprf.Suite.P256_SHA256;
const enc = new TextEncoder(), decd = new TextDecoder();
const subtle = globalThis.crypto.subtle;
const b64e = (u8) => Buffer.from(u8).toString('base64');
const b64d = (s) => new Uint8Array(Buffer.from(s, 'base64'));

// ── Adaptateur D1 sur node:sqlite (interface .prepare().bind().first/all/run) ──
function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(__dir, '../migrations/008_sceau.sql'), 'utf8'));
  db.exec(readFileSync(join(__dir, '../migrations/009_sceau_tokens.sql'), 'utf8'));
  return {
    _db: db,
    prepare(sql) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async all()   { return { results: db.prepare(sql).all(...args) }; },
        async run()   { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
      };
    },
  };
}

const ADMIN = 'test-admin-secret';
const env = { DB: null, KS_ADMIN_SECRET: ADMIN, KS_ENCRYPTION_KEY: 'unit-test-encryption-key-32bytes!!', KS_JWT_SECRET: 'unit-test-jwt-secret', KS_ALLOWED_ORIGIN: '*' };
const auth = { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' };
const req = (method, body) => new Request('https://x.test/api', { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
const pubReq = (method, body) => new Request('https://x.test/s', { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

// ── Helpers crypto CÔTÉ CLIENT (E2E : le serveur ne fait jamais ça) ──
async function aesKeyFromOprf(output) {
  const ikm = await subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('sceau/v1'), info: enc.encode('aes-gcm-256') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// Appelle un handler d'eval (création=admin, lecture=public) avec le body {blinded}.
async function callEval(handler, shortId, blindedB64, asAdmin) {
  const headers = asAdmin ? auth : { 'Content-Type': 'application/json' };
  const r = new Request('https://x.test/eval', { method: 'POST', headers, body: JSON.stringify({ blinded: blindedB64 }) });
  return handler(r, env, shortId);
}

// ── Mini-framework ──
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✅', msg); } else { fail++; console.log('  ❌', msg); } }

// Crée + scelle un secret, renvoie {shortId, oprfPub}
async function createSealed(plaintext, passphrase, opts = {}) {
  const initRes = await handleSceauInit(req('POST', { label: opts.label }), env);
  const init = await initRes.json();
  const shortId = init.short_id, oprfPub = init.oprf_pub;
  // eval de création (NON comptée)
  const client = new VOPRFClient(SUITE, b64d(oprfPub));
  const [fin, ereq] = await client.blind([enc.encode(passphrase)]);
  const evRes = await callEval(handleSceauEvalCreate, shortId, b64e(ereq.serialize()), true);
  const ev = await evRes.json();
  const [output] = await client.finalize(fin, Evaluation.deserialize(SUITE, b64d(ev.evaluation)));
  const key = await aesKeyFromOprf(output);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  const sealRes = await handleSceauSeal(req('POST', { ciphertext: b64e(ct), iv: b64e(iv), max_attempts: opts.max ?? 3, expires_at: opts.expires_at, label: opts.label }), env, shortId);
  ok(sealRes.status === 200, `seal -> 200 (${shortId})`);
  return { shortId, oprfPub };
}

// Lecture : eval (compté) + blob + déchiffrement. Renvoie {ok, plaintext|null, evalStatus}
async function readSecret(shortId, oprfPub, passphrase) {
  const client = new VOPRFClient(SUITE, b64d(oprfPub));
  const [fin, ereq] = await client.blind([enc.encode(passphrase)]);
  // Ordre client réaliste : récupérer le blob (opaque, inoffensif) AVANT l'eval —
  // sinon en one-shot (max=1) l'eval tue la clé+statut et le blob suivant 410.
  const blobRes = await handleSceauBlob(pubReq('GET'), env, shortId);
  if (!blobRes.ok) return { ok: false, plaintext: null, blobStatus: blobRes.status };
  const blob = await blobRes.json();
  const evRes = await callEval(handleSceauEval, shortId, b64e(ereq.serialize()), false);
  if (!evRes.ok) return { ok: false, plaintext: null, evalStatus: evRes.status };
  const ev = await evRes.json();
  const [output] = await client.finalize(fin, Evaluation.deserialize(SUITE, b64d(ev.evaluation)));
  const key = await aesKeyFromOprf(output);
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, key, b64d(blob.ciphertext));
    return { ok: true, plaintext: decd.decode(pt), evalStatus: evRes.status };
  } catch { return { ok: false, plaintext: null, evalStatus: evRes.status, gcm: 'fail' }; }
}

// ════════════════════ SCÉNARIOS ════════════════════
const SECRET = 'Code coffre : 4815-1623-0842';
const PASS = 'cargo-tundra-violet-9';

console.log('\n=== SCEAU S1 — tests handlers (vrai code) ===\n');

console.log('A. Création serveur-aveugle + lecture bon code');
env.DB = makeD1();
{
  const { shortId, oprfPub } = await createSealed(SECRET, PASS, { label: 'Test A' });
  // Le serveur ne stocke jamais le clair :
  const rowRaw = env.DB._db.prepare('SELECT ciphertext, oprf_key_enc FROM sec_secrets WHERE short_id=?').get(shortId);
  ok(!String(rowRaw.ciphertext).includes('Code coffre'), 'le clair n’est PAS en base (E2E)');
  ok(!!rowRaw.oprf_key_enc, 'clé OPRF présente (chiffrée au repos)');
  const meta = await (await handleSceauMeta(pubReq('GET'), env, shortId)).json();
  ok(meta.status === 'scelle' && meta.attempts_left === 3, 'meta: scelle, 3 essais (création NON comptée)');
  const r = await readSecret(shortId, oprfPub, PASS);
  ok(r.ok && r.plaintext === SECRET, 'bon code -> déchiffre le secret exact');
}

console.log('\nB. 3 mauvais codes -> mort cryptographique');
env.DB = makeD1();
{
  const { shortId, oprfPub } = await createSealed(SECRET, PASS);
  const r1 = await readSecret(shortId, oprfPub, 'faux-1');
  ok(!r1.ok && r1.gcm === 'fail', 'essai 1 faux -> GCM rejette (serveur a quand même servi l’eval)');
  const r2 = await readSecret(shortId, oprfPub, 'faux-2');
  ok(!r2.ok, 'essai 2 faux -> refus');
  const r3 = await readSecret(shortId, oprfPub, 'faux-3');
  ok(!r3.ok, 'essai 3 faux -> refus');
  const meta = await handleSceauMeta(pubReq('GET'), env, shortId);
  ok(meta.status === 410, 'après 3 essais -> meta 410 (détruit)');
  // 4e eval -> 410, et clé détruite en base
  const ev4 = await callEval(handleSceauEval, shortId, 'AAAA', false);
  ok(ev4.status === 410, '4e eval -> 410');
  const rowRaw = env.DB._db.prepare('SELECT oprf_key_enc, status FROM sec_secrets WHERE short_id=?').get(shortId);
  ok(rowRaw.oprf_key_enc === null && rowRaw.status === 'detruit', 'clé OPRF NULL + status détruit');
}

console.log('\nC. Après la mort, même le BON code échoue (irrécupérable)');
env.DB = makeD1();
{
  const { shortId, oprfPub } = await createSealed(SECRET, PASS, { max: 3 });
  await readSecret(shortId, oprfPub, 'x1');
  await readSecret(shortId, oprfPub, 'x2');
  await readSecret(shortId, oprfPub, 'x3');
  const r = await readSecret(shortId, oprfPub, PASS); // bon code, mais clé morte
  ok(!r.ok && (r.blobStatus === 410 || r.evalStatus === 410), 'bon code après mort -> 410, indéchiffrable');
}

console.log('\nD. Burn manuel (DELETE)');
env.DB = makeD1();
{
  const { shortId } = await createSealed(SECRET, PASS);
  const del = await handleSceauDelete(req('DELETE'), env, shortId);
  ok(del.status === 200, 'DELETE -> 200');
  const meta = await handleSceauMeta(pubReq('GET'), env, shortId);
  ok(meta.status === 410, 'après burn -> meta 410');
  const rowRaw = env.DB._db.prepare('SELECT ciphertext, oprf_key_enc, status FROM sec_secrets WHERE short_id=?').get(shortId);
  ok(rowRaw.ciphertext === null && rowRaw.oprf_key_enc === null && rowRaw.status === 'detruit', 'chiffré + clé effacés, status détruit');
}

console.log('\nE. max_attempts=1 (one-shot strict)');
env.DB = makeD1();
{
  const { shortId, oprfPub } = await createSealed(SECRET, PASS, { max: 1 });
  const r = await readSecret(shortId, oprfPub, PASS);
  ok(r.ok && r.plaintext === SECRET, 'one-shot: bon code au 1er essai -> OK');
  const again = await handleSceauMeta(pubReq('GET'), env, shortId);
  ok(again.status === 410, 'one-shot: après 1 lecture -> mort');
}

console.log('\nF. Expiration + sweep cron');
env.DB = makeD1();
{
  const past = new Date(Date.now() - 1000).toISOString();
  // expires_at passé est refusé au seal (garde-fou) -> on force un secret vivant puis on triche la base pour simuler l’échéance.
  const { shortId } = await createSealed(SECRET, PASS);
  env.DB._db.prepare("UPDATE sec_secrets SET expires_at=? WHERE short_id=?").run(past, shortId);
  const meta = await handleSceauMeta(pubReq('GET'), env, shortId);
  ok(meta.status === 410, 'secret échu -> meta 410 (expiration paresseuse)');
  const swept = await sweepExpiredSecrets(env);
  ok(swept.expired >= 1, `sweep cron purge ${swept.expired} expiré(s)`);
  const rowRaw = env.DB._db.prepare('SELECT oprf_key_enc, status FROM sec_secrets WHERE short_id=?').get(shortId);
  ok(rowRaw.oprf_key_enc === null && rowRaw.status === 'expire', 'après sweep: clé effacée, status expire');
}

console.log('\nG. Cloisonnement tenant + auth');
env.DB = makeD1();
{
  const noauth = await handleSceauInit(new Request('https://x/i', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), env);
  ok(noauth.status === 401, 'init sans auth -> 401');
  const { shortId } = await createSealed(SECRET, PASS);
  // un autre tenant (faux admin -> ici on simule via JWT absent => null) ne peut pas lister le secret de 'default'
  const list = await (await handleSceauList(req('GET'), env)).json();
  ok(list.items.some(i => i.short_id === shortId), 'le tenant propriétaire voit son secret dans la liste');
  ok(list.items.every(i => !('ciphertext' in i) && !('oprf_key_enc' in i)), 'la liste n’expose AUCUN matériel sensible');
}

// Lecture via un JETON (résolution /s/t/:tid → secret courant)
async function readViaToken(tid, passphrase) {
  const meta = await handleTokenMeta(pubReq('GET'), env, tid);
  if (meta.status !== 200) return { ok: false, metaStatus: meta.status };
  const m = await meta.json();
  const client = new VOPRFClient(SUITE, b64d(m.oprf_pub));
  const [fin, ereq] = await client.blind([enc.encode(passphrase)]);
  const blobRes = await handleTokenBlob(pubReq('GET'), env, tid);
  if (!blobRes.ok) return { ok: false, blobStatus: blobRes.status };
  const blob = await blobRes.json();
  const r = new Request('https://x.test/eval', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blinded: b64e(ereq.serialize()) }) });
  const evRes = await handleTokenEval(r, env, tid);
  if (!evRes.ok) return { ok: false, evalStatus: evRes.status };
  const ev = await evRes.json();
  const [out] = await client.finalize(fin, Evaluation.deserialize(SUITE, b64d(ev.evaluation)));
  const key = await aesKeyFromOprf(out);
  try { const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, key, b64d(blob.ciphertext)); return { ok: true, plaintext: decd.decode(buf) }; }
  catch { return { ok: false, gcm: 'fail' }; }
}

console.log('\nH. Jetons réutilisables (re-pointage)');
env.DB = makeD1();
{
  const tk = await (await handleTokenCreate(req('POST', { label: 'Badge bureau' }), env)).json();
  ok(!!tk.token_id, 'création jeton -> token_id');
  // jeton vide
  ok((await handleTokenMeta(pubReq('GET'), env, tk.token_id)).status === 404, 'jeton vide -> meta 404 (vide)');
  // charge un 1er secret
  const s1 = await createSealed('Secret v1 — alpha', PASS);
  const p1 = await (await handleTokenPoint(req('POST', { short_id: s1.shortId }), env, tk.token_id)).json();
  ok(p1.ok, 'pointage jeton -> secret v1');
  const list = await (await handleTokenList(req('GET'), env)).json();
  ok(list.items[0].state === 'actif' && list.items[0].attempts_left === 3, 'liste jeton -> actif, 3 essais');
  const rv1 = await readViaToken(tk.token_id, PASS);
  ok(rv1.ok && rv1.plaintext === 'Secret v1 — alpha', 'lecture via jeton (bon code) -> secret v1');
  // épuise le secret v1
  await readViaToken(tk.token_id, 'x1'); await readViaToken(tk.token_id, 'x2');
  ok((await handleTokenMeta(pubReq('GET'), env, tk.token_id)).status === 410, 'secret v1 épuisé -> jeton meta 410');
  // RECHARGE : même jeton, nouveau secret
  const s2 = await createSealed('Secret v2 — bravo', PASS);
  await handleTokenPoint(req('POST', { short_id: s2.shortId }), env, tk.token_id);
  const rv2 = await readViaToken(tk.token_id, PASS);
  ok(rv2.ok && rv2.plaintext === 'Secret v2 — bravo', 'après rechargement -> même jeton lit le secret v2 (réutilisable)');
  // suppression du jeton -> secret courant détruit
  const del = await handleTokenDelete(req('DELETE'), env, tk.token_id);
  ok(del.status === 200, 'suppression jeton -> 200');
  ok((await (await handleTokenList(req('GET'), env)).json()).items.length === 0, 'jeton retiré de la liste');
  const sec2 = env.DB._db.prepare('SELECT status FROM sec_secrets WHERE short_id=?').get(s2.shortId);
  ok(sec2.status === 'detruit', 'le secret courant du jeton supprimé est détruit');
}

// Requête EXACTE du capteur Living Layer _sensorSceau (miroir, pour valider la classification).
function sensorSceau(tenant) {
  return env.DB._db.prepare(
    `SELECT
       SUM(CASE WHEN read_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS opened7d,
       SUM(CASE WHEN status='detruit' AND read_at IS NULL AND attempts>=max_attempts
                     AND destroyed_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS intercepted24h,
       SUM(CASE WHEN status='scelle' THEN 1 ELSE 0 END) AS active
     FROM sec_secrets WHERE tenant_id = ?`
  ).get(tenant);
}

console.log('\nI. Accusé de lecture + capteur Living Layer (S5)');
env.DB = makeD1();
{
  // Lecture réussie puis accusé -> consommé (lu une fois) + read_at posé.
  const s = await createSealed(SECRET, PASS, { max: 3 });
  const r = await readSecret(s.shortId, s.oprfPub, PASS);
  ok(r.ok, 'lecture bon code OK avant accusé');
  const op = await handleSceauOpened(pubReq('POST'), env, s.shortId);
  ok(op.status === 200, 'POST /opened -> 200');
  const row = env.DB._db.prepare('SELECT status, read_at, ciphertext, oprf_key_enc FROM sec_secrets WHERE short_id=?').get(s.shortId);
  ok(row.status === 'lu' && row.read_at && !row.ciphertext && !row.oprf_key_enc, 'accusé -> status lu, read_at posé, matériel effacé (lu une fois)');
  ok((await handleSceauMeta(pubReq('GET'), env, s.shortId)).status === 410, 'après accusé -> meta 410 (consommé)');
  const sen1 = sensorSceau('default');
  ok(sen1.opened7d === 1 && sen1.intercepted24h === 0, 'capteur: 1 ouvert, 0 interception');

  // Secret tué par 3 mauvais essais SANS lecture -> interception.
  const bad = await createSealed('Autre', PASS, { max: 3 });
  await readSecret(bad.shortId, bad.oprfPub, 'z1');
  await readSecret(bad.shortId, bad.oprfPub, 'z2');
  await readSecret(bad.shortId, bad.oprfPub, 'z3');
  const sen2 = sensorSceau('default');
  ok(sen2.intercepted24h === 1, 'capteur: secret mort par 3 essais sans lecture -> interception=1');
  ok(_buildAlertText(sen2).includes('possible interception'), 'l’alerte Living Layer se déclenche (possible interception)');

  // Accusé via jeton -> consomme le secret courant.
  const tk = await (await handleTokenCreate(req('POST', { label: 'T' }), env)).json();
  const s3 = await createSealed('Via jeton', PASS);
  await handleTokenPoint(req('POST', { short_id: s3.shortId }), env, tk.token_id);
  await handleTokenOpened(pubReq('POST'), env, tk.token_id);
  const row3 = env.DB._db.prepare('SELECT status FROM sec_secrets WHERE short_id=?').get(s3.shortId);
  ok(row3.status === 'lu', 'accusé via jeton -> secret courant consommé');
}

// Mini-réplique de la décision d'alerte _buildAlert pour Sceau (interception).
function _buildAlertText(sen) {
  if (sen.intercepted24h > 0) return `${sen.intercepted24h} sceau détruit après plusieurs essais ratés — possible interception.`;
  return '';
}

console.log('\nJ. Gating serveur (beta : création réservée MAX/ADMIN/BETA)');
env.DB = makeD1();
{
  const jwtReq = (plan) => async () => {
    const tok = await signJWT({ sub: 'user-' + plan, plan, isAdmin: false }, env);
    return new Request('https://x/api/sceau/init', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}' });
  };
  ok((await handleSceauInit(await jwtReq('STARTER')(), env)).status === 403, 'init avec plan STARTER -> 403 (non éligible)');
  ok((await handleSceauInit(await jwtReq('MAX')(), env)).status === 201, 'init avec plan MAX -> 201 (éligible)');
  ok((await handleSceauInit(await jwtReq('BETA')(), env)).status === 201, 'init avec plan BETA -> 201 (testeur)');
  ok((await handleSceauInit(req('POST', {}), env)).status === 201, 'init en admin (KS_ADMIN_SECRET) -> 201');
  // Lecture publique reste ouverte même sans formule (principe du sceau).
  const s = await createSealed(SECRET, PASS);
  const r = await readSecret(s.shortId, s.oprfPub, PASS);
  ok(r.ok, 'lecture publique ouverte (aucune formule requise)');
}

console.log(`\n=== RÉSULTAT : ${pass} OK, ${fail} KO ===`);
process.exit(fail === 0 ? 0 : 1);
