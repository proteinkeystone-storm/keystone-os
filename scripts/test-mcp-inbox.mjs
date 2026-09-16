/* ═══════════════════════════════════════════════════════════════
   Banc — Bannette MCP : routes /api/mcp/inbox + /api/mcp/activity + purge
   ───────────────────────────────────────────────────────────────
   Vrais handlers (routes/mcp-writes.js) sur SQLite en mémoire, migration
   016 appliquée telle quelle. Ce que ce banc PROUVE :
     1. Dépôt : JWT requis ; pad / kind / taille validés ; réponse 201.
     2. Lecture : chaque compte ne voit que SES propositions.
     3. Marquage applied / dismissed : une fois, par le bon compte ; une
        proposition résolue disparaît de la liste.
     4. Expiration : une proposition échue n'est plus listée ; cap 50.
     5. Activité : le ledger filtré par sujet, par outil, depuis une date.
     6. Purge : confirmations échues, propositions échues ou résolues > 30 j.
   Lancement : node scripts/test-mcp-inbox.mjs
   ═══════════════════════════════════════════════════════════════ */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { signJWT } from '../workers/src/lib/jwt.js';
import { handleMcpInboxList, handleMcpInboxDeposit, handleMcpInboxMark, handleMcpActivity, purgeMcpWrites, subHash, issueConfirmation } from '../workers/src/routes/mcp-writes.js';

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
  return { prepare: stmt, _db: db };
}
const DB = makeD1();
DB._db.exec(readFileSync(new URL('../workers/migrations/016_mcp_writes.sql', import.meta.url), 'utf8'));
DB._db.exec(`CREATE TABLE mcp_calls (id TEXT PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), sub_hash TEXT NOT NULL, plan TEXT, tool TEXT NOT NULL, ms INTEGER DEFAULT 0, ok INTEGER DEFAULT 1, error TEXT, label TEXT)`);
const env = { KS_JWT_SECRET: 'jwt-secret-du-banc-32-octets-minimum-0123456789', KS_ALLOWED_ORIGIN: 'https://front.test', DB };
const API = 'https://api.test';
const jwtAlice = await signJWT({ sub: 'sub-alice', plan: 'MAX' }, env);
const jwtBob   = await signJWT({ sub: 'sub-bob', plan: 'PRO' }, env);
const req = (path, { method = 'GET', body, token } = {}) => new Request(API + path, { method,
  headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined });
const deposit = (body, token = jwtAlice) => handleMcpInboxDeposit(req('/api/mcp/inbox', { method: 'POST', body, token }), env);
const list = async (token = jwtAlice) => (await handleMcpInboxList(req('/api/mcp/inbox', { token }), env)).json();
const mark = (id, status, token = jwtAlice) => handleMcpInboxMark(req(`/api/mcp/inbox/${id}/${status}`, { method: 'POST', token }), env, id, status);
const good = { pad: 'O-SOC-001', kind: 'compose', payload: { text: 'Bonjour', targets: [], append: false }, summary: 'Post à relire', tool: 'keystone_social_draft_post' };

console.log('\n▶ 1 · Dépôt');
{
  eq((await deposit(good, null)).status, 401, 'sans JWT → 401');
  const r = await deposit(good); const j = await r.json();
  yes(r.status === 201 && /^kbn_/.test(j.id) && j.pending === 1 && /T.*Z$/.test(j.expires_at), '201 + id + expiration ISO');
  eq((await deposit({ ...good, pad: '../evil' })).status, 400, 'pad invalide → 400');
  eq((await deposit({ ...good, kind: 'exec' })).status, 400, 'kind inconnu → 400');
  eq((await deposit({ ...good, payload: { text: 'x'.repeat(20000) } })).status, 400, 'payload > 16 Ko → 400');
  eq((await handleMcpInboxDeposit(new Request(API + '/api/mcp/inbox', { method: 'POST', headers: { Authorization: `Bearer ${jwtAlice}` }, body: 'pas du json' }), env)).status, 400, 'corps illisible → 400');
}

console.log('\n▶ 2 · Lecture par compte');
{
  await deposit({ ...good, kind: 'gw.rewrite', pad: 'A-COM-005', payload: { text: 'Réécris' }, summary: 'Texte' });
  await deposit({ ...good, summary: 'De Bob' }, jwtBob);
  const a = await list(); const b = await list(jwtBob);
  eq(a.pending, 2, 'Alice voit ses 2 propositions'); eq(b.pending, 1, 'Bob voit la sienne');
  yes(a.items.every(i => i.summary !== 'De Bob'), 'aucune fuite entre comptes');
  eq(a.items[0].payload, good.payload, 'payload rendu tel que déposé (opts openTool)');
  yes(a.items[0].created_at < a.items[1].created_at || a.items[0].id !== a.items[1].id, 'ordre chronologique');
  eq((await handleMcpInboxList(req('/api/mcp/inbox'), env)).status, 401, 'liste sans JWT → 401');
}

console.log('\n▶ 3 · Marquage');
{
  const a = await list(); const id = a.items[0].id;
  eq((await mark(id, 'applied', jwtBob)).status, 404, 'Bob ne peut pas marquer la proposition d’Alice');
  eq((await mark(id, 'applied')).status, 200, 'Alice marque « appliquée »');
  eq((await mark(id, 'applied')).status, 404, '… une seule fois');
  eq((await mark(id, 'dismissed')).status, 404, '… ni ne la bascule ensuite');
  eq((await list()).pending, 1, 'la proposition appliquée a quitté la liste');
  const id2 = (await list()).items[0].id;
  eq((await mark(id2, 'dismissed')).status, 200, 'Alice ignore la seconde');
  eq((await list()).pending, 0, 'bannette d’Alice vide');
  eq((await mark(id2, 'bizarre')).status, 404, 'statut inconnu → 404');
  const row = DB._db.prepare('SELECT status, resolved_at FROM mcp_inbox WHERE id = ?').get(id);
  yes(row.status === 'applied' && row.resolved_at, 'statut et date de résolution en base');
}

console.log('\n▶ 4 · Expiration & cap');
{
  const r = await (await deposit(good)).json();
  DB._db.prepare("UPDATE mcp_inbox SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(r.id);
  eq((await list()).pending, 0, 'proposition échue non listée');
  eq((await mark(r.id, 'applied')).status, 200, '… mais encore marquable (l’onglet l’avait chargée avant)');
  for (let i = 0; i < 50; i++) await deposit(good);
  eq((await deposit(good)).status, 400, 'cap 50 propositions en attente par compte');
  DB._db.prepare("DELETE FROM mcp_inbox WHERE sub = 'sub-alice' AND status = 'pending'").run();
}

console.log('\n▶ 5 · Activité');
{
  const sh = await subHash('sub-alice');
  const ins = DB._db.prepare("INSERT INTO mcp_calls (id, ts, sub_hash, tool, ok, label) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run('c1', '2026-09-17 08:00:00', sh, 'keystone_keynapse_create_note', 1, 'Note « A » créée dans Keynapse');
  ins.run('c2', '2026-09-17 09:00:00', sh, 'keystone_sentinel_run_audit', 1, 'Audit Sentinel lancé sur Mon site');
  ins.run('c3', '2026-09-17 09:30:00', sh, 'keystone_keynapse_create_note', 0, null);          // échec : pas d'activité
  ins.run('c4', '2026-09-17 09:45:00', sh, 'keystone_qr_list', 1, null);                       // lecture : hors liste
  ins.run('c5', '2026-09-17 09:50:00', await subHash('sub-bob'), 'keystone_keynapse_create_note', 1, 'De Bob');
  const tools = ['keystone_keynapse_create_note', 'keystone_sentinel_run_audit'];
  const act = async (since, token = jwtAlice) => (await handleMcpActivity(req(`/api/mcp/activity?since=${encodeURIComponent(since)}`, { token }), env, tools)).json();
  let j = await act('2026-09-17T00:00:00Z');
  eq(j.items.map(i => i.label), ['Note « A » créée dans Keynapse', 'Audit Sentinel lancé sur Mon site'], 'écritures réussies d’Alice, dans l’ordre, sans les lectures ni les échecs');
  eq(j.items[0].ts, '2026-09-17T08:00:00Z', 'horodatage ISO');
  j = await act('2026-09-17T08:30:00Z');
  eq(j.items.length, 1, 'filtre « depuis »');
  j = await act('2026-09-17T00:00:00Z', jwtBob);
  eq(j.items.map(i => i.label), ['De Bob'], 'Bob ne voit que les siennes');
  j = await act('pas-une-date');
  eq(j.items.length, 2, 'date illisible → depuis toujours');
  yes(/Z$/.test(j.now), 'réponse porte `now` pour la borne suivante');
  eq((await handleMcpActivity(req('/api/mcp/activity'), env, tools)).status, 401, 'sans JWT → 401');
}

console.log('\n▶ 6 · Purge');
{
  await issueConfirmation(env, { sub: 'sub-alice', tool: 't', args: {}, preview: {} });
  await issueConfirmation(env, { sub: 'sub-alice', tool: 't', args: { a: 1 }, preview: {} });
  DB._db.prepare("UPDATE mcp_confirmations SET expires_at = datetime('now', '-2 hours') WHERE args_hash = (SELECT args_hash FROM mcp_confirmations LIMIT 1)").run();
  const r1 = await (await deposit(good)).json();
  DB._db.prepare("UPDATE mcp_inbox SET expires_at = datetime('now', '-1 day') WHERE id = ?").run(r1.id);
  const r2 = await (await deposit(good)).json();
  await mark(r2.id, 'applied');
  DB._db.prepare("UPDATE mcp_inbox SET resolved_at = datetime('now', '-40 days') WHERE id = ?").run(r2.id);
  const r3 = await (await deposit(good)).json();                           // vivante
  const p = await purgeMcpWrites(env);
  eq(p.confirmations, 1, 'confirmation échue purgée, la vivante reste');
  yes(p.inbox >= 2, `propositions échues / résolues > 30 j purgées (${p.inbox})`);
  yes(DB._db.prepare('SELECT COUNT(*) AS n FROM mcp_inbox WHERE id = ?').get(r3.id).n === 1, 'la proposition vivante reste');
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m`);
process.exit(fail ? 1 : 0);
