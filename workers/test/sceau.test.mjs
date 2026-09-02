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
  handleSceauDelete, handleSceauEmail, handleSceauMeta, handleSceauEval, handleSceauBlob, handleSceauOpened, sweepExpiredSecrets,
  handleTokenCreate, handleTokenList, handleTokenPoint, handleTokenDelete,
  handleTokenMeta, handleTokenEval, handleTokenBlob, handleTokenOpened,
  handleSceauPledge, handleSceauUsageAdmin,
  handleSceauGuestOptions, handleSceauGuestInit, handleSceauGuestEvalCreate, handleSceauGuestSeal,
} from '../src/routes/sceau.js';

// Doit rester aligné sur SEC_PLEDGE_VERSION (src/routes/sceau.js). Une
// divergence ferait échouer la signature — c'est voulu : le contrôle porte
// sur la version du texte, pas sur la simple présence d'une acceptation.
const PLEDGE_VERSION = 'v1-2026-07';

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
  db.exec(readFileSync(join(__dir, '../migrations/010_sceau_blob.sql'), 'utf8'));
  db.exec(readFileSync(join(__dir, '../migrations/011_sceau_question.sql'), 'utf8'));
  db.exec(readFileSync(join(__dir, '../migrations/013_sceau_durcissement.sql'), 'utf8'));
  db.exec(readFileSync(join(__dir, '../migrations/014_sceau_usage.sql'), 'utf8'));
  // Fixture : le tenant 'default' (celui de l'auth admin utilisée par la
  // quasi-totalité des sections) a DÉJÀ signé l'engagement d'usage. Sans
  // ça, chaque section testerait la garde anti-abus au lieu de son propre
  // sujet. La section R, elle, efface cette ligne pour éprouver le refus.
  db.exec(`INSERT INTO sec_pledges (tenant_id, version) VALUES ('default', 'v1-2026-07')`);
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
// Mock R2 (env.HELP_MEDIA) en mémoire pour les chiffrés audio/fichier (S8).
function makeR2() {
  const m = new Map();
  return { _m: m,
    async put(k, v) { m.set(k, typeof v === 'string' ? v : Buffer.from(v).toString()); },
    async get(k) { return m.has(k) ? { text: async () => m.get(k) } : null; },
    async delete(k) { m.delete(k); } };
}
const env = { DB: null, HELP_MEDIA: null, KS_ADMIN_SECRET: ADMIN, KS_ENCRYPTION_KEY: 'unit-test-encryption-key-32bytes!!', KS_JWT_SECRET: 'unit-test-jwt-secret', KS_ALLOWED_ORIGIN: '*' };
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

// Engagement d'usage (juil. 2026) : depuis la garde anti-abus, /init refuse
// tant qu'il n'est pas signé. Les sections qui repartent d'une base neuve
// le resignent — c'est le parcours réel du pad, pas un contournement : la
// section R vérifie explicitement que le refus tombe SANS cette signature.
async function signPledge() {
  const r = await handleSceauPledge(req('POST', { accepted: true, version: PLEDGE_VERSION }), env);
  return r.status === 200;
}

// Crée + scelle un secret, renvoie {shortId, oprfPub}
async function createSealed(plaintext, passphrase, opts = {}) {
  let initRes = await handleSceauInit(req('POST', { label: opts.label }), env);
  if (initRes.status === 403) { await signPledge(); initRes = await handleSceauInit(req('POST', { label: opts.label }), env); }
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
  // Preuve de lecture (audit sept. 2026) — le vrai client la dépose au
  // scellage ; sans elle, plus personne ne peut effacer la missive.
  const receipt = await readReceiptFromOprf(output);
  const sealRes = await handleSceauSeal(req('POST', { ciphertext: b64e(ct), iv: b64e(iv), max_attempts: opts.max ?? 3, expires_at: opts.expires_at, label: opts.label, read_receipt: receipt }), env, shortId);
  ok(sealRes.status === 200, `seal -> 200 (${shortId})`);
  return { shortId, oprfPub, receipt };
}

// Doit rester IDENTIQUE à app/sceau.js (_readReceipt) et sceau-page.js.
async function readReceiptFromOprf(output) {
  const tag = enc.encode('sceau/receipt');
  const seed = new Uint8Array(output.length + tag.length);
  seed.set(output, 0); seed.set(tag, output.length);
  const h = await subtle.digest('SHA-256', seed);
  return b64e(new Uint8Array(h));
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
  // « Retirer » : un 2e DELETE sur une missive DÉJÀ morte supprime la ligne (résidu).
  const rm = await handleSceauDelete(req('DELETE'), env, shortId);
  const rmj = await rm.json();
  ok(rm.status === 200 && rmj.removed === true, 'Retirer (morte) -> removed:true');
  ok(!env.DB._db.prepare('SELECT 1 FROM sec_secrets WHERE short_id=?').get(shortId), 'ligne supprimée de la base');
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
  // Audit sept. 2026 — AVANT, /meta se contentait de répondre 410 en laissant
  // le chiffré et la clé en base jusqu'au cron de 3 h : un secret que
  // l'utilisateur croyait mort survivait ~24 h. MAINTENANT, le simple passage
  // l'efface. C'est la propriété qu'on verrouille ici.
  const afterMeta = env.DB._db.prepare('SELECT status, ciphertext, oprf_key_enc FROM sec_secrets WHERE short_id=?').get(shortId);
  ok(afterMeta.status === 'expire' && !afterMeta.ciphertext && !afterMeta.oprf_key_enc,
     'échu : /meta EFFACE au passage (plus d\'attente du cron)');
  const swept = await sweepExpiredSecrets(env);
  ok(swept.expired === 0, 'le cron ne trouve plus rien à expirer — la destruction a déjà eu lieu');

  // Le cron reste le filet pour un secret que PLUS PERSONNE ne consulte.
  const orphan = await createSealed('Orphelin', PASS);
  env.DB._db.prepare("UPDATE sec_secrets SET expires_at=? WHERE short_id=?").run(past, orphan.shortId);
  const swept2 = await sweepExpiredSecrets(env);
  ok(swept2.expired >= 1, `cron : filet toujours actif sur un secret jamais rouvert (${swept2.expired})`);
  const rowRaw = env.DB._db.prepare('SELECT oprf_key_enc, status FROM sec_secrets WHERE short_id=?').get(orphan.shortId);
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
  // Audit sept. 2026 — l'effacement n'est plus public : il exige la PREUVE
  // de lecture. On verrouille les trois cas, l'ordre compte (les refus
  // AVANT le succès, sinon la missive est déjà consommée).
  // Sans preuve fournie = preuve invalide -> 403. (Le 400 « preuve_absente »
  // ne vise que les missives scellées AVANT ce chantier, qui n'en ont pas.)
  const opNo = await handleSceauOpened(pubReq('POST'), env, s.shortId);
  ok(opNo.status === 403, 'POST /opened SANS preuve -> 403 (plus d\'effacement public)');
  const opBad = await handleSceauOpened(pubReq('POST', { receipt: b64e(new Uint8Array(32)) }), env, s.shortId);
  ok(opBad.status === 403, 'POST /opened avec une preuve FAUSSE -> 403');
  const rowAlive = env.DB._db.prepare('SELECT status, ciphertext FROM sec_secrets WHERE short_id=?').get(s.shortId);
  ok(rowAlive.status === 'scelle' && !!rowAlive.ciphertext, 'après 2 tentatives sans preuve : la missive est INTACTE');
  const op = await handleSceauOpened(pubReq('POST', { receipt: s.receipt }), env, s.shortId);
  ok(op.status === 200, 'POST /opened avec la BONNE preuve -> 200');
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
  await handleTokenOpened(pubReq('POST', { receipt: s3.receipt }), env, tk.token_id);
  const row3 = env.DB._db.prepare('SELECT status FROM sec_secrets WHERE short_id=?').get(s3.shortId);
  ok(row3.status === 'lu', 'accusé via jeton -> secret courant consommé');
}

// Mini-réplique de la décision d'alerte _buildAlert pour Sceau (interception).
function _buildAlertText(sen) {
  if (sen.intercepted24h > 0) return `${sen.intercepted24h} sceau détruit après plusieurs essais ratés — possible interception.`;
  return '';
}

console.log('\nJ. Gating serveur (M-6 : Missive est GRATUITE — tout JWT valide crée)');
env.DB = makeD1();
{
  const jwtReq = (plan) => async () => {
    const tok = await signJWT({ sub: 'user-' + plan, plan, isAdmin: false }, env);
    return new Request('https://x/api/sceau/init', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}' });
  };
  // L'engagement est par COMPTE : chacun de ces plans est un tenant distinct,
  // donc chacun signe pour lui. C'est ce qu'on veut vérifier ici : le gating
  // par plan, une fois l'engagement acquis.
  for (const plan of ['STARTER', 'PRO', 'MAX', 'BETA']) {
    env.DB._db.prepare('INSERT INTO sec_pledges (tenant_id, version) VALUES (?, ?)').run('user-' + plan, PLEDGE_VERSION);
  }
  // Nouveau contrat (audit sept. 2026 · M-6) : Missive est au palier FREE de
  // la grille — l'ancien 403 sur STARTER refusait des licences gratuites qui
  // portent O-SEC-001 dans leur sac. Toute identité authentifiée passe.
  ok((await handleSceauInit(await jwtReq('STARTER')(), env)).status === 201, 'init avec plan STARTER -> 201 (Missive gratuite)');
  ok((await handleSceauInit(await jwtReq('PRO')(), env)).status === 201, 'init avec plan PRO -> 201 (Missive gratuite)');
  ok((await handleSceauInit(await jwtReq('MAX')(), env)).status === 201, 'init avec plan MAX -> 201 (éligible)');
  ok((await handleSceauInit(await jwtReq('BETA')(), env)).status === 201, 'init avec plan BETA -> 201 (testeur)');
  ok((await handleSceauInit(req('POST', {}), env)).status === 201, 'init en admin (KS_ADMIN_SECRET) -> 201');
  // Lecture publique reste ouverte même sans formule (principe du sceau).
  const s = await createSealed(SECRET, PASS);
  const r = await readSecret(s.shortId, s.oprfPub, PASS);
  ok(r.ok, 'lecture publique ouverte (aucune formule requise)');
}

console.log('\nK. Missive audio (chiffré binaire en R2, S8)');
env.DB = makeD1(); env.HELP_MEDIA = makeR2();
{
  const init = await (await handleSceauInit(req('POST', { label: 'Vocal' }), env)).json();
  const client = new VOPRFClient(SUITE, b64d(init.oprf_pub));
  const [fin, ereq] = await client.blind([enc.encode(PASS)]);
  const ev = await (await callEval(handleSceauEvalCreate, init.short_id, b64e(ereq.serialize()), true)).json();
  const [out] = await client.finalize(fin, Evaluation.deserialize(SUITE, b64d(ev.evaluation)));
  const key = await aesKeyFromOprf(out);
  const audioBytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 256); // faux vocal
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, audioBytes));
  const seal = await handleSceauSeal(req('POST', { ciphertext: b64e(ct), iv: b64e(iv), kind: 'audio', mime: 'audio/mp4' }), env, init.short_id);
  const sj = await seal.json();
  ok(seal.status === 200 && sj.kind === 'audio', 'seal audio -> 200 kind=audio');
  const raw = env.DB._db.prepare('SELECT ciphertext, blob_key, kind, mime FROM sec_secrets WHERE short_id=?').get(init.short_id);
  ok(raw.ciphertext === null && raw.blob_key === 'sec/' + init.short_id && raw.kind === 'audio' && raw.mime === 'audio/mp4', 'chiffré en R2 (blob_key), pas inline');
  ok(env.HELP_MEDIA._m.has('sec/' + init.short_id), 'objet présent dans R2');
  const meta = await (await handleSceauMeta(pubReq('GET'), env, init.short_id)).json();
  ok(meta.kind === 'audio' && meta.mime === 'audio/mp4', 'meta -> kind/mime audio');
  // lecture : blob depuis R2 + déchiffrement -> octets exacts
  const cl = new VOPRFClient(SUITE, b64d(meta.oprf_pub));
  const [f2, r2e] = await cl.blind([enc.encode(PASS)]);
  const blob = await (await handleSceauBlob(pubReq('GET'), env, init.short_id)).json();
  const ev2 = await (await callEval(handleSceauEval, init.short_id, b64e(r2e.serialize()), false)).json();
  const [o2] = await cl.finalize(f2, Evaluation.deserialize(SUITE, b64d(ev2.evaluation)));
  const k2 = await aesKeyFromOprf(o2);
  const dec2 = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, k2, b64d(blob.ciphertext)));
  ok(blob.kind === 'audio' && dec2.length === 1000 && dec2[7] === 49, 'lecture R2 -> octets audio déchiffrés exacts');
  await handleSceauDelete(req('DELETE'), env, init.short_id);
  ok(!env.HELP_MEDIA._m.has('sec/' + init.short_id), 'burn -> objet R2 supprimé');
  // un texte court reste inline (pas de R2)
  const t = await createSealed('petit texte', PASS);
  const tr = env.DB._db.prepare('SELECT ciphertext, blob_key, kind FROM sec_secrets WHERE short_id=?').get(t.shortId);
  ok(tr.ciphertext && !tr.blob_key && tr.kind === 'text', 'texte court reste inline D1 (pas R2)');
}

console.log('\nL. Missive fichier (en-tête nom chiffré + octets en R2, S9)');
env.DB = makeD1(); env.HELP_MEDIA = makeR2();
{
  // Pack/unpack symétriques de app/sceau.js + sceau-page.js (le nom vit DANS le chiffré).
  const packFile = (name, type, bytes) => {
    const meta = enc.encode(JSON.stringify({ name, type }));
    const out = new Uint8Array(4 + meta.length + bytes.length);
    new DataView(out.buffer).setUint32(0, meta.length, true);
    out.set(meta, 4); out.set(bytes, 4 + meta.length);
    return out;
  };
  const unpackFile = (buf) => {
    const u8 = new Uint8Array(buf);
    const n = new DataView(u8.buffer, u8.byteOffset, 4).getUint32(0, true);
    const meta = JSON.parse(decd.decode(u8.subarray(4, 4 + n)));
    return { name: meta.name, type: meta.type, bytes: u8.subarray(4 + n) };
  };

  const init = await (await handleSceauInit(req('POST', { label: 'Fichier' }), env)).json();
  const client = new VOPRFClient(SUITE, b64d(init.oprf_pub));
  const [fin, ereq] = await client.blind([enc.encode(PASS)]);
  const ev = await (await callEval(handleSceauEvalCreate, init.short_id, b64e(ereq.serialize()), true)).json();
  const [out] = await client.finalize(fin, Evaluation.deserialize(SUITE, b64d(ev.evaluation)));
  const key = await aesKeyFromOprf(out);

  const fileBytes = Uint8Array.from({ length: 2048 }, (_, i) => (i * 13) % 256); // faux PDF
  const payload = packFile('rapport secret.pdf', 'application/pdf', fileBytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, payload));
  const seal = await handleSceauSeal(req('POST', { ciphertext: b64e(ct), iv: b64e(iv), kind: 'file', mime: 'application/pdf' }), env, init.short_id);
  const sj = await seal.json();
  ok(seal.status === 200 && sj.kind === 'file', 'seal file -> 200 kind=file');
  const raw = env.DB._db.prepare('SELECT ciphertext, blob_key, kind, mime FROM sec_secrets WHERE short_id=?').get(init.short_id);
  ok(raw.ciphertext === null && raw.blob_key === 'sec/' + init.short_id && raw.kind === 'file' && raw.mime === 'application/pdf', 'fichier chiffré en R2, le nom n\'est PAS en clair en base');
  const metaCol = env.DB._db.prepare('SELECT * FROM sec_secrets WHERE short_id=?').get(init.short_id);
  ok(!Object.values(metaCol).some(v => typeof v === 'string' && v.includes('rapport secret')), 'aucune colonne ne contient le nom de fichier en clair');

  const meta = await (await handleSceauMeta(pubReq('GET'), env, init.short_id)).json();
  ok(meta.kind === 'file' && meta.mime === 'application/pdf', 'meta -> kind/mime file');
  // lecture : blob R2 + déchiffrement -> dépaquetage nom + octets exacts
  const cl = new VOPRFClient(SUITE, b64d(meta.oprf_pub));
  const [f2, r2e] = await cl.blind([enc.encode(PASS)]);
  const blob = await (await handleSceauBlob(pubReq('GET'), env, init.short_id)).json();
  const ev2 = await (await callEval(handleSceauEval, init.short_id, b64e(r2e.serialize()), false)).json();
  const [o2] = await cl.finalize(f2, Evaluation.deserialize(SUITE, b64d(ev2.evaluation)));
  const k2 = await aesKeyFromOprf(o2);
  const dec2 = await subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, k2, b64d(blob.ciphertext));
  const f = unpackFile(dec2);
  ok(f.name === 'rapport secret.pdf' && f.type === 'application/pdf', 'lecture -> nom + type récupérés depuis l\'en-tête chiffré');
  ok(f.bytes.length === 2048 && f.bytes[13] === ((13 * 13) % 256) && f.bytes[2047] === ((2047 * 13) % 256), 'lecture -> octets fichier exacts');
  await handleSceauDelete(req('DELETE'), env, init.short_id);
  ok(!env.HELP_MEDIA._m.has('sec/' + init.short_id), 'burn -> objet R2 fichier supprimé');
}

console.log('\nM. Missive question/réponse (E2E, la réponse remplace la passphrase, S9)');
env.DB = makeD1(); env.HELP_MEDIA = makeR2();
{
  // Normalisation IDENTIQUE à app/sceau.js et sceau-page.js.
  const normAnswer = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Scelle un secret en mode Q/R : l'entrée OPRF est la réponse normalisée.
  const sealQA = async (plaintext, answer, question) => {
    const init = await (await handleSceauInit(req('POST', {}), env)).json();
    const client = new VOPRFClient(SUITE, b64d(init.oprf_pub));
    const [fin, ereq] = await client.blind([enc.encode(normAnswer(answer))]);
    const ev = await (await callEval(handleSceauEvalCreate, init.short_id, b64e(ereq.serialize()), true)).json();
    const [out] = await client.finalize(fin, Evaluation.deserialize(SUITE, b64d(ev.evaluation)));
    const key = await aesKeyFromOprf(out);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
    await handleSceauSeal(req('POST', { ciphertext: b64e(ct), iv: b64e(iv), question, max_attempts: 3 }), env, init.short_id);
    return { shortId: init.short_id, oprfPub: init.oprf_pub };
  };

  const { shortId, oprfPub } = await sealQA('Le secret du Procope', 'Café Lumière', 'Notre lieu de rendez-vous ?');
  const raw = env.DB._db.prepare('SELECT question, ciphertext, blob_key FROM sec_secrets WHERE short_id=?').get(shortId);
  ok(raw.question === 'Notre lieu de rendez-vous ?', 'question (indice) stockée en clair');
  const full = env.DB._db.prepare('SELECT * FROM sec_secrets WHERE short_id=?').get(shortId);
  ok(!Object.values(full).some(v => typeof v === 'string' && normAnswer(v).includes('cafelumiere')), 'la RÉPONSE n\'est jamais en base (E2E)');
  const meta = await (await handleSceauMeta(pubReq('GET'), env, shortId)).json();
  ok(meta.question === 'Notre lieu de rendez-vous ?', 'meta -> renvoie la question');

  // Bonne réponse (normalisée) -> déchiffre.
  const good = await readSecret(shortId, oprfPub, normAnswer('Café Lumière'));
  ok(good.ok && good.plaintext === 'Le secret du Procope', 'bonne réponse -> déchiffre');

  // Normalisation : casse/accents/espaces/ponctuation ignorés sur une NOUVELLE missive.
  const q2 = await sealQA('msg', 'Café Lumière', 'Lieu ?');
  const variant = await readSecret(q2.shortId, q2.oprfPub, normAnswer('  cafe LUMIERE !! '));
  ok(variant.ok && variant.plaintext === 'msg', 'normalisation : « cafe LUMIERE !! » == « Café Lumière »');

  // Mauvaise réponse -> GCM rejette + l'essai est compté.
  const q3 = await sealQA('msg3', 'bonneReponse', 'Q ?');
  const bad = await readSecret(q3.shortId, q3.oprfPub, normAnswer('mauvaise'));
  ok(!bad.ok && bad.gcm === 'fail', 'mauvaise réponse -> GCM rejette');
  const m3 = await (await handleSceauMeta(pubReq('GET'), env, q3.shortId)).json();
  ok(m3.attempts_left === 2, 'mauvaise réponse -> essai compté (3 -> 2)');

  // Sans question : mode code classique inchangé (meta.question = null).
  const plain = await createSealed('classique', PASS);
  const mp = await (await handleSceauMeta(pubReq('GET'), env, plain.shortId)).json();
  ok(mp.question === null, 'mode code -> meta.question = null (rétrocompat)');
}

console.log('\nN. Missive code par email (mode serveur de confiance, S9-T3)');
env.DB = makeD1(); env.HELP_MEDIA = makeR2();
{
  const emailReq = (body) => new Request('https://keystone-os-api.keystone-os.workers.dev/api/sceau/x/email',
    { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const { shortId } = await createSealed('msg email', PASS, { label: 'OTP' });

  // Pas d'auth -> 401
  const noAuth = await handleSceauEmail(pubReq('POST', { to: 'a@b.co', code: 'X' }), env, shortId);
  ok(noAuth.status === 401, 'email sans auth -> 401');
  // Email invalide -> 400
  const badMail = await handleSceauEmail(emailReq({ to: 'pasunemail', code: 'X' }), env, shortId);
  ok(badMail.status === 400, 'email invalide -> 400');
  // Missive inexistante -> 404
  const noSec = await handleSceauEmail(emailReq({ to: 'a@b.co', code: 'X' }), env, 'zzzznope');
  ok(noSec.status === 404, 'missive inexistante -> 404');
  // Pas de clé Resend -> 503 (et AUCUN envoi)
  delete env.KS_RESEND_KEY;
  const noKey = await handleSceauEmail(emailReq({ to: 'a@b.co', code: PASS }), env, shortId);
  ok(noKey.status === 503, 'email non configuré -> 503');

  // Succès : stub fetch pour intercepter Resend, vérifier code + lien dans le corps.
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    captured = { url: String(url), body: JSON.parse(opts.body) };
    return new Response(JSON.stringify({ id: 'fake' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  env.KS_RESEND_KEY = 'fake-key';
  const sent = await handleSceauEmail(emailReq({ to: 'dest@exemple.com', code: PASS }), env, shortId);
  globalThis.fetch = realFetch; delete env.KS_RESEND_KEY;
  ok(sent.status === 200, 'envoi email -> 200');
  ok(captured && captured.url.includes('api.resend.com'), 'appel Resend émis');
  ok(captured && captured.body.to.includes('dest@exemple.com'), 'destinataire correct');
  ok(captured && captured.body.html.includes(PASS), 'le code est dans l\'email');
  ok(captured && !captured.body.html.includes('/s/' + shortId) && !/href=/.test(captured.body.html), 'le LIEN n\'est PAS dans l\'email (séparation 2 canaux : code seul)');
  // Le code N'EST PAS stocké en base
  const raw = env.DB._db.prepare('SELECT * FROM sec_secrets WHERE short_id=?').get(shortId);
  ok(!Object.values(raw).some(v => typeof v === 'string' && v.includes(PASS)), 'le code n\'est JAMAIS stocké en base');
}

// ══════════════════════════════════════════════════════════════
// O. La recette de clé est-elle la MÊME des deux côtés ? (audit sept. 2026)
// ──────────────────────────────────────────────────────────────
// LE risque de ce module : la fabrication de la clé est écrite DEUX FOIS —
// dans le pad (app/sceau.js) et dans la page de lecture
// (workers/src/routes/sceau-page.js). Si l'une dérive de l'autre, plus
// aucune missive ne s'ouvre, et RIEN dans les tests fonctionnels ne le voit
// (chacun teste son propre côté).
// On compare donc les constantes qui DOIVENT coïncider, dans les fichiers
// réels. Un futur changement d'un seul côté casse ici, immédiatement.
// ══════════════════════════════════════════════════════════════
console.log('\nO. Recette de clé identique pad ↔ page de lecture');
{
  const root = join(__dir, '../..');
  const pad    = readFileSync(join(root, 'app/sceau.js'), 'utf8');
  const reader = readFileSync(join(root, 'workers/src/routes/sceau-page.js'), 'utf8');

  const rounds = s => (s.match(/PBKDF2_ROUNDS\s*=\s*([0-9_]+)/) || [])[1]?.replace(/_/g, '');
  const salt   = s => (s.match(/PBKDF2_SALT\s*=\s*[_a-z]*enc\.encode\('([^']+)'\)/) || [])[1];
  const tag    = s => (s.match(/enc\.encode\('(sceau\/receipt)'\)/) || [])[1];

  ok(rounds(pad) && rounds(pad) === rounds(reader),
     `nombre de tours PBKDF2 identique (${rounds(pad)})`);
  ok(salt(pad) && salt(pad) === salt(reader),
     `sel PBKDF2 identique (« ${salt(pad)} »)`);
  ok(tag(pad) && tag(pad) === tag(reader),
     'étiquette de la preuve de lecture identique');
  // Les deux doivent aussi savoir traiter l'ancienne recette : une missive
  // scellée avant ce chantier (kdf_v = 1) doit rester lisible.
  ok(/sceau\/v1/.test(pad) && /sceau\/v1/.test(reader),
     'la recette historique (v1) reste gérée des deux côtés');
}

// ══════════════════════════════════════════════════════════════
// P. Recette LENTE (kdf_v = 2) de bout en bout
// ──────────────────────────────────────────────────────────────
// Le reste du banc scelle en v1 (recette historique). Sans cette suite,
// la recette v2 — celle que tous les NOUVEAUX secrets emploient — ne
// serait jamais réellement exercée : on saurait que les constantes
// coïncident, pas qu'elles produisent une missive lisible.
// ══════════════════════════════════════════════════════════════
console.log('\nP. Fabrication de clé lente (kdf_v=2) — chiffrer puis déchiffrer');
env.DB = makeD1();
{
  const PBKDF2_SALT = enc.encode('sceau/kdf/v2');
  const aesKeyV2 = async (output) => {
    const ikm = await subtle.importKey('raw', output, 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: PBKDF2_SALT, iterations: 600000 },
      ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  };

  // Scellage façon vrai client, mais en v2.
  const init = await (await handleSceauInit(req('POST', { label: 'v2' }), env)).json();
  const shortId = init.short_id;
  const client = new VOPRFClient(SUITE, b64d(init.oprf_pub));
  const [fin, ereq] = await client.blind([enc.encode(PASS)]);
  const ev = await (await callEval(handleSceauEvalCreate, shortId, b64e(ereq.serialize()), true)).json();
  const [output] = await client.finalize(fin, Evaluation.deserialize(SUITE, b64d(ev.evaluation)));
  const key = await aesKeyV2(output);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('Secret v2')));
  const sealRes = await handleSceauSeal(req('POST', {
    ciphertext: b64e(ct), iv: b64e(iv), kdf_v: 2, read_receipt: await readReceiptFromOprf(output),
  }), env, shortId);
  ok(sealRes.status === 200, 'seal en v2 -> 200');

  // La missive ANNONCE sa recette, sinon le lecteur applique la mauvaise.
  const meta = await (await handleSceauMeta(pubReq('GET'), env, shortId)).json();
  ok(meta.kdf_v === 2, '/meta annonce kdf_v = 2 (le lecteur saura quoi appliquer)');

  // Lecture façon vrai destinataire.
  const blob = await (await handleSceauBlob(pubReq('GET'), env, shortId)).json();
  const c2 = new VOPRFClient(SUITE, b64d(init.oprf_pub));
  const [fin2, ereq2] = await c2.blind([enc.encode(PASS)]);
  const ev2 = await (await callEval(handleSceauEval, shortId, b64e(ereq2.serialize()), false)).json();
  const [out2] = await c2.finalize(fin2, Evaluation.deserialize(SUITE, b64d(ev2.evaluation)));
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, await aesKeyV2(out2), b64d(blob.ciphertext));
  ok(decd.decode(pt) === 'Secret v2', 'lecture v2 -> le clair est restitué');

  // Et la mauvaise recette NE doit pas ouvrir (preuve que v2 est bien actif).
  let v1Ouvre = false;
  try {
    await subtle.decrypt({ name: 'AES-GCM', iv: b64d(blob.iv) }, await aesKeyFromOprf(out2), b64d(blob.ciphertext));
    v1Ouvre = true;
  } catch { /* attendu */ }
  ok(!v1Ouvre, 'la recette v1 n\'ouvre PAS une missive v2 (les deux sont bien distinctes)');
}

console.log('\nQ. Plafonds de débit (audit applicatif 27/07)');
env.DB = makeD1(); env.HELP_MEDIA = makeR2();
{
  // La table du compteur est créée UNE fois par le worker (drapeau au niveau
  // du module). Ici on remplace la base à chaque bloc : sans re-création, les
  // requêtes échouent, le fail-open laisse tout passer, et on mesurerait un
  // plafond absent alors qu'il est bien là. On la pose donc explicitement.
  const mkRate = () => env.DB._db.exec(`CREATE TABLE IF NOT EXISTS sec_public_usage (
    day TEXT NOT NULL, device_hash TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (day, device_hash))`);
  mkRate();
  // ── Q1. /s/:id/eval était la SEULE route publique sans plafond ────────
  // Or c'est celle qui CONSOMME les essais : un inconnu tenant le lien
  // détruisait la missive en 3 requêtes, avant lecture. Le plafond ne rend
  // pas la chose impossible (3 < 60) mais borne les dégâts — et c'est ce
  // que la spec promettait. Ce test garde la porte fermée.
  const { shortId } = await createSealed('msg', PASS, { label: 'plafond' });
  let evalLimited = false, evalPassed = 0;
  for (let i = 0; i < 80; i++) {
    const r = await callEval(handleSceauEval, shortId, 'AAAA', false);
    if (r.status === 429) { evalLimited = true; break; }
    evalPassed++;
  }
  ok(evalLimited, `/s/:id/eval est plafonné (429 apres ${evalPassed} appels)`);

  // Un lecteur légitime ne consomme que ~6 requêtes : le plafond ne doit
  // jamais tomber avant ses 3 essais. On vérifie l'ordre de grandeur.
  ok(evalPassed >= 10, 'le plafond laisse largement passer un lecteur légitime');

  // ── Q2. /api/sceau/:id/email : relais d'e-mails ───────────────────────
  // La route fait partir un message DEPUIS notre domaine vers une adresse
  // choisie par l'appelant. Sans plafond, un compte en fait un relais et
  // c'est la réputation d'expéditeur (donc la délivrabilité des liens de
  // connexion de TOUS les clients) qui trinque.
  env.DB = makeD1(); env.HELP_MEDIA = makeR2(); mkRate();
  const em = await createSealed('msg2', PASS, { label: 'mail' });
  const emailReq2 = (body) => new Request('https://x.test/api/sceau/x/email',
    { method: 'POST', headers: auth, body: JSON.stringify(body) });
  let mailLimited = false, mailPassed = 0;
  for (let i = 0; i < 40; i++) {
    const r = await handleSceauEmail(emailReq2({ to: `c${i}@exemple.fr`, code: 'X' }), env, em.shortId);
    if (r.status === 429) { mailLimited = true; break; }
    mailPassed++;
  }
  ok(mailLimited, `/api/sceau/:id/email est plafonné (429 apres ${mailPassed} envois)`);

  // Une adresse mal formée ne doit PAS consommer le quota du jour.
  env.DB = makeD1(); env.HELP_MEDIA = makeR2(); mkRate();
  const em2 = await createSealed('msg3', PASS, {});
  for (let i = 0; i < 30; i++) {
    await handleSceauEmail(emailReq2({ to: 'pasunemail', code: 'X' }), env, em2.shortId);
  }
  const apresFautes = await handleSceauEmail(emailReq2({ to: 'ok@exemple.fr', code: 'X' }), env, em2.shortId);
  ok(apresFautes.status !== 429, 'une faute de frappe sur l\'adresse ne brûle pas le quota');
}

// ──────────────────────────────────────────────────────────────
// R. Engagement d'usage du créateur (prévention de l'abus, juil. 2026)
// ──────────────────────────────────────────────────────────────
// Le serveur ne peut pas modérer un contenu qu'il ne voit pas. Ce qu'il
// PEUT faire, c'est refuser de créer tant que la personne n'a pas déclaré
// à quoi elle s'engage — et en garder la trace datée. Une case cochée
// seulement dans le navigateur ne vaudrait rien : ces tests vérifient que
// la garde vit CÔTÉ SERVEUR.
console.log('\nR. Engagement d’usage du créateur');
env.DB = makeD1(); env.HELP_MEDIA = makeR2();
{
  env.DB._db.exec('DELETE FROM sec_pledges');   // compte qui n'a jamais signé

  const refus = await handleSceauInit(req('POST', { label: 'sans engagement' }), env);
  const refusBody = await refus.json();
  ok(refus.status === 403, 'création REFUSÉE tant que l’engagement n’est pas signé');
  ok(refusBody.code === 'pledge_required', 'le refus porte un code exploitable par le pad (pledge_required)');
  ok(refusBody.pledge_version === PLEDGE_VERSION, 'le refus annonce la version du texte à faire signer');

  // Un client resté en cache sur un ancien texte ne doit pas pouvoir valider
  // le nouveau à l'insu de la personne : on exige la version AFFICHÉE.
  const vieux = await handleSceauPledge(req('POST', { accepted: true, version: 'v0-perime' }), env);
  ok(vieux.status === 409, 'une version d’engagement périmée est refusée (409)');
  const sansCase = await handleSceauPledge(req('POST', { accepted: false, version: PLEDGE_VERSION }), env);
  ok(sansCase.status === 400, 'refuser la case ne signe rien (400)');
  ok(env.DB._db.prepare('SELECT COUNT(*) c FROM sec_pledges').get().c === 0, 'aucun engagement enregistré après ces tentatives');

  const signe = await handleSceauPledge(req('POST', { accepted: true, version: PLEDGE_VERSION }), env);
  ok(signe.status === 200, 'engagement signé -> 200');
  const row = env.DB._db.prepare('SELECT * FROM sec_pledges').get();
  ok(row.tenant_id === 'default' && row.version === PLEDGE_VERSION, 'l’engagement est enregistré par compte ET par version');
  ok(!!row.accepted_at, 'l’engagement est daté (c’est ce qui le rend opposable)');

  const apres = await handleSceauInit(req('POST', { label: 'après engagement' }), env);
  ok(apres.status === 201, 'création autorisée une fois l’engagement signé');

  const liste = await (await handleSceauList(req('GET'), env)).json();
  ok(liste.pledge?.accepted === true, 'la liste annonce au pad que l’engagement est acquis');

  // Changement de texte = tout le monde resigne. On simule en écrivant une
  // version périmée : la garde doit se refermer.
  env.DB._db.prepare('UPDATE sec_pledges SET version = ?').run('v0-perime');
  const reRefus = await handleSceauInit(req('POST', {}), env);
  ok(reRefus.status === 403, 'changer la version du texte refait signer tout le monde');
}

// ──────────────────────────────────────────────────────────────
// S. Journal d'usage + écran admin (ce qu'on compte, et ce qu'on ne voit pas)
// ──────────────────────────────────────────────────────────────
console.log('\nS. Journal d’usage (agrégats) et écran admin');
env.DB = makeD1(); env.HELP_MEDIA = makeR2();
{
  const s1 = await createSealed('secret un', PASS, { label: 'j1' });
  await createSealed('secret deux', PASS, { label: 'j2' });

  const j = env.DB._db.prepare('SELECT * FROM sec_usage_hourly WHERE tenant_id = ?').all('default');
  ok(j.length === 1, 'le journal agrège par heure (une seule ligne pour deux envois rapprochés)');
  ok(j[0].sealed === 2 && j[0].created === 2, 'créations et scellements comptés séparément');
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(j[0].hour_utc), 'granularité HORAIRE (pas à la seconde)');

  const d = env.DB._db.prepare('SELECT * FROM sec_usage_device').all();
  ok(d.length === 1 && d[0].count === 2, 'l’appareil est compté une fois, avec son nombre d’envois');
  ok(/^[0-9a-f]{16}$/.test(d[0].fp), 'l’empreinte est un haché tronqué — ni IP ni User-Agent en clair');

  // Le journal ne doit RIEN savoir du contenu ni du destinataire. On balaie
  // toutes les valeurs stockées : aucune ne doit contenir le clair, le code,
  // ni une adresse e-mail. C'est le test qui protège la promesse du produit.
  // Envoi réel simulé (comme en section N) : le compteur `emailed` ne
  // s'incrémente qu'APRÈS un envoi réussi — un service d'e-mail en panne
  // ne doit pas gonfler les statistiques d'un compte.
  const realFetchS = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"id":"x"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  env.KS_RESEND_KEY = 'fake-key';
  await handleSceauEmail(new Request('https://x.test/api/sceau/x/email',
    { method: 'POST', headers: auth, body: JSON.stringify({ to: 'destinataire@exemple.fr', code: PASS }) }), env, s1.shortId);
  globalThis.fetch = realFetchS; delete env.KS_RESEND_KEY;
  const dump = JSON.stringify([
    env.DB._db.prepare('SELECT * FROM sec_usage_hourly').all(),
    env.DB._db.prepare('SELECT * FROM sec_usage_device').all(),
    env.DB._db.prepare('SELECT * FROM sec_pledges').all(),
  ]);
  ok(!dump.includes('destinataire@exemple.fr'), 'le journal ne contient AUCUN destinataire');
  ok(!dump.includes(PASS) && !dump.includes('secret un'), 'le journal ne contient ni code ni contenu');
  ok(env.DB._db.prepare('SELECT emailed FROM sec_usage_hourly').get().emailed === 1, 'les envois d’e-mail de code sont comptés');

  // ── Écran admin ─────────────────────────────────────────────
  const anon = await handleSceauUsageAdmin(new Request('https://x/api/admin/sceau/usage'), env);
  ok(anon.status === 401, 'l’écran d’usage est fermé sans secret admin');

  const adm = await (await handleSceauUsageAdmin(new Request('https://x/api/admin/sceau/usage', { headers: auth }), env)).json();
  const me = adm.rows.find(r => r.tenant_id === 'default');
  ok(!!me, 'l’écran liste le compte actif');
  ok(me.sealed_24h === 2 && me.sealed_7d === 2, 'volumes 24 h / 7 j corrects');
  ok(me.devices === 1, 'nombre d’appareils distincts');
  ok(Array.isArray(me.hours) && me.hours.length === 24, 'répartition horaire sur 24 cases');
  ok(me.pledge_accepted === true && !!me.pledge_at, 'l’état de l’engagement remonte à l’admin');
  ok(adm.meta.retention_days === 90, 'la rétention annoncée est portée par l’API');
  ok(typeof me.score === 'number' && Array.isArray(me.flags), 'chaque ligne porte un score ET ses raisons en clair');

  // Multi-compte : deux comptes derrière la même empreinte. C'est LE signal
  // qui trahit la création de comptes en série pour contourner un plafond.
  env.DB._db.prepare('INSERT INTO sec_usage_device (tenant_id, fp, count) VALUES (?, ?, 1)')
    .run('autre-compte', d[0].fp);
  env.DB._db.prepare('INSERT INTO sec_usage_hourly (tenant_id, hour_utc, created, sealed) VALUES (?, ?, 1, 1)')
    .run('autre-compte', new Date().toISOString().slice(0, 13));
  const adm2 = await (await handleSceauUsageAdmin(new Request('https://x/api/admin/sceau/usage', { headers: auth }), env)).json();
  const me2 = adm2.rows.find(r => r.tenant_id === 'default');
  ok(me2.shared_device_max === 2, 'un appareil partagé entre deux comptes est détecté');
  ok(me2.flags.some(f => f.includes('partagé')), 'et la raison est écrite en clair dans la ligne');

  // ── Rétention : 90 jours, tenus par le cron (pas seulement annoncés) ──
  const vieux = new Date(Date.now() - 100 * 86400_000);
  env.DB._db.prepare('INSERT INTO sec_usage_hourly (tenant_id, hour_utc, sealed) VALUES (?, ?, 5)')
    .run('vieux-compte', vieux.toISOString().slice(0, 13));
  env.DB._db.prepare('INSERT INTO sec_usage_device (tenant_id, fp, last_at, count) VALUES (?, ?, ?, 3)')
    .run('vieux-compte', 'ffffffffffffffff', vieux.toISOString().slice(0, 19).replace('T', ' '));
  const sweep = await sweepExpiredSecrets(env);
  ok(sweep.usagePurged === 1, 'le journal de plus de 90 jours est purgé par le cron');
  ok(sweep.devicesPurged === 1, 'les empreintes de plus de 90 jours aussi');
  ok(env.DB._db.prepare('SELECT COUNT(*) c FROM sec_usage_hourly WHERE tenant_id = ?').get('default').c === 1,
     'les lignes récentes survivent à la purge');
}

// ══════════════════════════════════════════════════════════════
// T. Voie invitée M.I.C.E. (chantier BAL) — dépôt anonyme bridé
// ══════════════════════════════════════════════════════════════
console.log('\nT. Voie invitée M.I.C.E. — dépôt anonyme bridé');
{
  env.DB = makeD1();
  // La table de débit naît paresseusement (_ensureSecRate) et son drapeau
  // module est déjà levé par les sections précédentes : sur base neuve, on
  // la crée à la main — sinon le fail-open avalerait le test de quota.
  env.DB._db.exec(`CREATE TABLE IF NOT EXISTS sec_public_usage (
    day TEXT NOT NULL, device_hash TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (day, device_hash))`);

  const MICE = 'https://micearchives.com';
  const gReq = (body, origin = MICE, ua = 'g-ua') => new Request('https://x.test/g', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), 'User-Agent': ua },
    body: JSON.stringify(body || {}),
  });

  // Origine : rien ne passe sans micearchives.com (ou une preview du projet)
  ok((await handleSceauGuestInit(gReq({ pledge: true }, null), env)).status === 403, 'init sans Origin -> 403');
  ok((await handleSceauGuestInit(gReq({ pledge: true }, 'https://evil.example'), env)).status === 403, 'init origine étrangère -> 403');
  ok(handleSceauGuestOptions(new Request('https://x/g', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status === 403, 'préflight origine étrangère -> 403');
  const pre = handleSceauGuestOptions(new Request('https://x/g', { method: 'OPTIONS', headers: { Origin: MICE } }));
  ok(pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === MICE, 'préflight M.I.C.E. -> 204 + ACAO exact');

  // Engagement d'usage signé À CHAQUE dépôt (pas de compte où le retenir)
  const noPledge = await handleSceauGuestInit(gReq({}), env);
  ok(noPledge.status === 403 && (await noPledge.json()).code === 'pledge_required', 'init sans engagement -> 403 pledge_required');

  // Previews Cloudflare Pages = SOUS-domaines de mice-site.pages.dev
  ok((await handleSceauGuestInit(gReq({ pledge: true }, 'https://abc123.mice-site.pages.dev', 'ua-preview'), env)).status === 201,
     'init depuis une preview *.mice-site.pages.dev -> 201');

  // Parcours complet : init → eval de création → seal → lecture publique
  const initRes = await handleSceauGuestInit(gReq({ pledge: true }, MICE, 'ua-flow'), env);
  ok(initRes.status === 201, 'init invité -> 201');
  const init = await initRes.json();
  const client = new VOPRFClient(SUITE, b64d(init.oprf_pub));
  const [fin, ereq] = await client.blind([enc.encode('code-invite-mice')]);
  const evRes = await handleSceauGuestEvalCreate(gReq({ blinded: b64e(ereq.serialize()) }, MICE, 'ua-flow'), env, init.short_id);
  ok(evRes.status === 200, 'eval de création invitée -> 200');
  const [output] = await client.finalize(fin, Evaluation.deserialize(SUITE, b64d((await evRes.json()).evaluation)));
  const key = await aesKeyFromOprf(output);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('RDV QUAI TROIS MINUIT')));

  ok((await handleSceauGuestSeal(gReq({ ciphertext: 'A'.repeat(16001), iv: b64e(iv) }, MICE, 'ua-flow'), env, init.short_id)).status === 413,
     'chiffré > 16 000 c. -> 413');
  const sealRes = await handleSceauGuestSeal(gReq({
    ciphertext: b64e(ct), iv: b64e(iv), kind: 'audio', mime: 'audio/webm', question: 'interdite ?',
    max_attempts: 9, expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
    read_receipt: await readReceiptFromOprf(output),
  }, MICE, 'ua-flow'), env, init.short_id);
  ok(sealRes.status === 200, 'seal invité -> 200');
  const sealed = await sealRes.json();
  ok(new Date(sealed.expires_at).getTime() <= Date.now() + 72 * 3600_000 + 1000, 'expiration RAMENÉE sous 72 h');
  const row = await env.DB.prepare('SELECT tenant_id, kind, mime, question, max_attempts FROM sec_secrets WHERE short_id = ?').bind(init.short_id).first();
  ok(row.tenant_id === 'mice-guest', 'cantonné au tenant mice-guest');
  ok(row.kind === 'text' && row.mime === null && row.question === null, 'kind forcé text — ni mime ni question');
  ok(row.max_attempts === 3, 'essais forcés à 3, quoi que demande le client');

  // La lecture est la lecture STANDARD /s/:id — rien de spécial pour l'invité
  const rd = await readSecret(init.short_id, init.oprf_pub, 'code-invite-mice');
  ok(rd.ok && rd.plaintext === 'RDV QUAI TROIS MINUIT', 'lecture publique -> clair exact');

  // Étanchéité : la voie invitée ne voit PAS les sceaux licenciés
  const own = await (await handleSceauInit(req('POST', {}), env)).json();
  ok((await handleSceauGuestEvalCreate(gReq({ blinded: 'AA' }, MICE, 'ua-flow'), env, own.short_id)).status === 404,
     'eval invitée sur un sceau licencié -> 404');

  // Quota de création : 5/jour/appareil, puis 429
  let last = null;
  for (let i = 0; i < 6; i++) last = await handleSceauGuestInit(gReq({ pledge: true }, MICE, 'ua-quota'), env);
  ok(last.status === 429 && (await last.json()).code === 'guest_quota', '6e dépôt du même appareil -> 429 guest_quota');
  ok((await handleSceauGuestInit(gReq({ pledge: true }, MICE, 'ua-quota-2'), env)).status === 201, 'un autre appareil passe encore');
}

console.log(`\n=== RÉSULTAT : ${pass} OK, ${fail} KO ===`);
process.exit(fail === 0 ? 0 : 1);
