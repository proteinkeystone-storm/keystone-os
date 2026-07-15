/* ═══════════════════════════════════════════════════════════════
   OPS-1 — Sauvegardes D1 hors-plateforme : backup + restore prouvés
   contre `wrangler dev --local` (R2 BACKUPS simulé par miniflare).

   Prouve le critère de done du sprint (« un backup qu'on n'a jamais
   restauré n'existe pas ») :
     1. seed d'un objet vital (entities/programs) à v=1,
     2. backup → NDJSON en R2,
     3. mutation de l'objet à v=2,
     4. restore de la table depuis le backup,
     5. l'objet est REVENU à v=1 en D1.  ← restore réellement écrit.
   + sécurité Sceau : le backup de sec_secrets ne contient JAMAIS de
     colonne cryptographique (ciphertext/iv/oprf_*).
   + garde-fous : endpoints admin refusent sans secret (401).

   Lancer le worker AVANT (R2 local + secrets de test) :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --test-scheduled \
       --var KS_JWT_SECRET:bk-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:bk-admin \
       --var KS_ENCRYPTION_KEY:bk-encryption-key-32-chars-minimum-000
   Puis :
     node test/test-backup-restore.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

const API    = process.env.BK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.BK_JWT_SECRET || 'bk-test-secret';
const ADMIN  = process.env.BK_ADMIN || 'bk-admin';

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}
// Tenant de test, formule MAX (entitle Sceau).
const TOK = jwt({ sub: 'bk-test-tenant', owner: 'BackupTest', email: 'bk@test', plan: 'MAX' });

const today = new Date().toISOString().slice(0, 10);

async function api(path, { method = 'GET', token, admin, body } = {}) {
  const headers = {};
  if (admin) headers.Authorization = 'Bearer ' + ADMIN;
  else if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

async function main() {
  console.log('OPS-1 — backup/restore sur', API, '\n');

  // ── Garde-fous : endpoints admin refusent sans secret ──────────
  ok((await api('/api/admin/backup/run', { method: 'POST' })).status === 401, 'backup/run sans admin → 401');
  ok((await api('/api/admin/backup/list')).status === 401, 'backup/list sans admin → 401');
  ok((await api('/api/admin/backup/restore', { method: 'POST', body: { date: today, table: 'entities', confirm: true } })).status === 401,
     'backup/restore sans admin → 401');

  // ── 1. Seed d'un objet vital (entities/programs) à v=1 ─────────
  const seed = await api('/api/data/programs', { method: 'POST', token: TOK, body: { name: 'BACKUP_TEST', v: 1 } });
  ok(seed.status === 200 && seed.data.id, 'seed programs v=1 → 200 + id', seed.data);
  const id = seed.data.id;

  // ── 2. Seed d'un secret Sceau (peuple oprf_key_enc — cible sécu) ─
  const seal = await api('/api/sceau/init', { method: 'POST', token: TOK, body: { label: 'bk-sec' } });
  const sceauSeeded = seal.status === 201 && seal.data.short_id;
  ok(sceauSeeded, 'seed sceau/init → 201 + short_id (sinon sécu testée en structurel)', seal.data);

  // ── 3. Backup ───────────────────────────────────────────────────
  const run = await api('/api/admin/backup/run', { method: 'POST', admin: true });
  ok(run.status === 200 && run.data.ok, 'backup/run → 200 ok', run.data);
  ok(run.data.date === today, 'backup daté aujourd\'hui', run.data.date);
  const entTable = (run.data.tables || []).find(t => t.table === 'entities');
  ok(entTable && entTable.rows >= 1, 'backup entities ≥ 1 ligne', entTable);

  // ── 4. L'objet est bien dans le NDJSON à v=1 ───────────────────
  const obj = await api(`/api/admin/backup/object?date=${today}&table=entities`, { admin: true });
  ok(obj.status === 200, 'backup/object entities → 200', obj.status);
  const lines = String(obj.text).split('\n').filter(Boolean).map(l => JSON.parse(l));
  const mine = lines.find(r => r.id === id);
  ok(mine && JSON.parse(mine.data).v === 1, 'NDJSON contient l\'objet à v=1', mine && mine.data);

  // ── 5. Sécurité Sceau : aucune colonne crypto dans le backup ───
  const CRYPTO = ['ciphertext', 'iv', 'oprf_pub', 'oprf_key_enc', 'oprf_key_iv'];
  const secObj = await api(`/api/admin/backup/object?date=${today}&table=sec_secrets`, { admin: true });
  if (secObj.status === 200) {
    const secLines = String(secObj.text).split('\n').filter(Boolean).map(l => JSON.parse(l));
    const leak = secLines.some(r => CRYPTO.some(c => c in r));
    ok(!leak, 'sec_secrets backup SANS colonne crypto (ciphertext/iv/oprf_*)', leak);
    if (sceauSeeded) {
      const hasMeta = secLines.some(r => 'short_id' in r && 'status' in r);
      ok(hasMeta, 'sec_secrets backup conserve les métadonnées (short_id/status)');
    }
  } else {
    ok(secObj.status === 404, 'sec_secrets vide (404) — pas de fuite possible', secObj.status);
  }

  // ── 6. Mutation à v=2, puis restore doit ramener v=1 ───────────
  const patch = await api(`/api/data/programs/${id}`, { method: 'PATCH', token: TOK, body: { v: 2 } });
  ok(patch.status === 200, 'PATCH programs v=2 → 200', patch.status);
  const afterPatch = await api(`/api/data/programs/${id}`, { token: TOK });
  ok(afterPatch.data.v === 2, 'lecture confirme v=2 avant restore', afterPatch.data.v);

  const restore = await api('/api/admin/backup/restore', { method: 'POST', admin: true, body: { date: today, table: 'entities', confirm: true } });
  ok(restore.status === 200 && restore.data.restored >= 1, 'restore entities → 200 + lignes', restore.data);

  const afterRestore = await api(`/api/data/programs/${id}`, { token: TOK });
  ok(afterRestore.data.v === 1, 'RESTORE PROUVÉ : l\'objet est revenu à v=1', afterRestore.data);

  // ── 7. Garde-fous restore : confirm requis + table hors liste ──
  ok((await api('/api/admin/backup/restore', { method: 'POST', admin: true, body: { date: today, table: 'entities' } })).status === 400,
     'restore sans confirm:true → 400');
  ok((await api('/api/admin/backup/restore', { method: 'POST', admin: true, body: { date: today, table: 'devices', confirm: true } })).status === 400,
     'restore table hors liste vitale → 400');

  // ── 8. list expose le manifeste du jour ────────────────────────
  const list = await api('/api/admin/backup/list', { admin: true });
  ok(list.status === 200 && (list.data.backups || []).some(b => b.date === today), 'backup/list expose le manifeste du jour', list.data);

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass · ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('Erreur fatale:', e); process.exit(2); });
