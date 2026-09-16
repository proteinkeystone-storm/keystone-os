/* ═══════════════════════════════════════════════════════════════
   Banc — Le Pont MCP (sprint 4) : canal SSE, ordres, présence, repli
   ───────────────────────────────────────────────────────────────
   Vrais handlers (routes/mcp-bridge.js, routes/mcp.js) sur SQLite en
   mémoire, migrations 016 + 017 appliquées telles quelles, cadences
   réduites. Un « onglet » est simulé en node : il lit le canal ou
   interroge la table, exécute une fausse action, répond par la route.
   Ce que ce banc PROUVE :
     1. Canal : hello (tab), présence posée, ordre d'Alice remis UNE fois
        (deux canaux ne le reçoivent pas tous les deux), ordre de Bob
        jamais vu, battement, bye en fin de cycle.
     2. Réponse : compte vérifié (404), une seule réponse (409), échec
        stocké, ordre expiré → 410.
     3. bridgeRun : done avec données ; failed ; timeout → expired.
     4. Outils MCP : sans onglet → lecture = erreur claire, écriture
        bannette = dépôt ; avec onglet → exécution en direct (en_direct,
        pas de dépôt) ; échec dans l'onglet → isError ; onglet muet →
        repli bannette avec mention ; keystone_bridge_status juste.
   Lancement : node scripts/test-mcp-bridge.mjs
   ═══════════════════════════════════════════════════════════════ */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { signJWT } from '../workers/src/lib/jwt.js';
import { handleMcp } from '../workers/src/routes/mcp.js';
import { handleBridgeStream, handleBridgeJobResult, handleBridgePresence, bridgeRun, bridgePresence, purgeMcpBridge } from '../workers/src/routes/mcp-bridge.js';
import { handleMcpInboxDeposit, handleMcpInboxList } from '../workers/src/routes/mcp-writes.js';

let pass = 0, fail = 0;
const ok  = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko  = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));
const eq  = (a, e, l) => (JSON.stringify(a) === JSON.stringify(e) ? ok(l) : ko(l, `attendu ${JSON.stringify(e)}, reçu ${JSON.stringify(a)}`));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
DB._db.exec(readFileSync(new URL('../workers/migrations/017_mcp_bridge.sql', import.meta.url), 'utf8'));
const env = { KS_JWT_SECRET: 'jwt-secret-du-banc-32-octets-minimum-0123456789', KS_ALLOWED_ORIGIN: 'https://front.test', DB, MCP_BRIDGE_WAIT_MS: '400' };
const API = 'https://api.test';
const jwtAlice = await signJWT({ sub: 'sub-alice', plan: 'MAX' }, env);
const jwtBob   = await signJWT({ sub: 'sub-bob', plan: 'PRO' }, env);
const req = (path, { method = 'GET', body, token, headers = {} } = {}) => new Request(API + path, { method,
  headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  body: body !== undefined ? JSON.stringify(body) : undefined });
const insertJob = (sub, action = 'bs.list_sessions', args = {}) => {
  const id = 'kjb_' + Math.random().toString(36).slice(2, 10);
  DB._db.prepare("INSERT INTO mcp_jobs (id, sub, tool, action, args_json, expires_at) VALUES (?, ?, 'banc', ?, ?, datetime('now', '+60 seconds'))").run(id, sub, action, JSON.stringify(args));
  return id;
};
const reply = (id, body, token = jwtAlice) => handleBridgeJobResult(req(`/api/mcp/bridge/jobs/${id}/result`, { method: 'POST', body, token }), env, id);
/* lit un canal jusqu'au bout → trames */
async function drain(res) {
  const frames = []; const dec = new TextDecoder(); let buf = '';
  const reader = res.body.getReader();
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { frames.push(buf.slice(0, i)); buf = buf.slice(i + 2); } }
  return frames.map(f => { const ev = (f.match(/^event: (.*)$/m) || [])[1] || (f.startsWith(':') ? 'comment' : 'message'); let data = null; try { data = JSON.parse((f.match(/^data: (.*)$/m) || [])[1]); } catch (_) { data = null; } return { ev, data }; });
}
const stream = (token = jwtAlice, headers = {}) => handleBridgeStream(req('/api/mcp/bridge/stream', { token, headers }), env, { pollMs: 40, beatMs: 120, maxMs: 500 });

console.log('\n▶ 1 · Canal SSE');
{
  eq((await handleBridgeStream(req('/api/mcp/bridge/stream'), env, { pollMs: 40, beatMs: 120, maxMs: 300 })).status, 401, 'sans JWT → 401');
  const jA = insertJob('sub-alice', 'bs.list_sessions', { x: 1 });
  const jB = insertJob('sub-bob');
  const res = await stream(jwtAlice, { 'X-Bridge-Tab': 'tab_banc' });
  yes(res.status === 200 && /text\/event-stream/.test(res.headers.get('Content-Type')), '200 text/event-stream');
  eq(res.headers.get('X-Bridge-Tab'), 'tab_banc', 'identifiant d’onglet repris');
  const frames = await drain(res);
  const hello = frames.find(f => f.ev === 'hello');
  yes(hello && hello.data.tab === 'tab_banc', 'hello avec l’onglet');
  const jobs = frames.filter(f => f.ev === 'job');
  eq(jobs.map(j => j.data.id), [jA], 'l’ordre d’Alice est remis, celui de Bob jamais');
  eq(jobs[0].data.action, 'bs.list_sessions', '… avec son action'); eq(jobs[0].data.args, { x: 1 }, '… et ses arguments');
  yes(frames.some(f => f.ev === 'comment'), 'battement « : ping » émis');
  eq(frames[frames.length - 1].ev, 'bye', 'bye en fin de cycle');
  eq(DB._db.prepare('SELECT status FROM mcp_jobs WHERE id = ?').get(jA).status, 'dispatched', 'ordre marqué dispatched');
  const p = await bridgePresence(env, 'sub-alice');
  yes(p.online && p.tabs === 1, 'présence posée : Alice en ligne, 1 onglet');
  yes(!(await bridgePresence(env, 'sub-bob')).online, 'Bob hors ligne');
  const frames2 = await drain(await stream(jwtAlice, { 'X-Bridge-Tab': 'tab_banc2' }));
  eq(frames2.filter(f => f.ev === 'job').length, 0, 'un second canal ne reçoit pas l’ordre déjà remis');
  eq((await bridgePresence(env, 'sub-alice')).tabs, 2, 'deux onglets vus');
}

console.log('\n▶ 2 · Réponse d’un ordre');
{
  const id = insertJob('sub-alice');
  eq((await reply(id, { ok: true, data: { total: 2 } }, jwtBob)).status, 404, 'Bob ne peut pas répondre à l’ordre d’Alice');
  eq((await reply('kjb_nope', { ok: true })).status, 404, 'ordre inconnu → 404');
  const r1 = await reply(id, { ok: true, data: { total: 2 } });
  yes(r1.status === 200 && (await r1.json()).status === 'done', 'réponse acceptée → done');
  eq((await reply(id, { ok: true, data: {} })).status, 409, 'seconde réponse → 409');
  const row = DB._db.prepare('SELECT status, result_json FROM mcp_jobs WHERE id = ?').get(id);
  eq(JSON.parse(row.result_json), { total: 2 }, 'résultat stocké');
  const id2 = insertJob('sub-alice');
  const r2 = await reply(id2, { ok: false, error: 'Action hors catalogue : evil.run' });
  yes(r2.status === 200 && (await r2.json()).status === 'failed', 'échec (hors catalogue) → failed');
  eq(DB._db.prepare('SELECT error FROM mcp_jobs WHERE id = ?').get(id2).error, 'Action hors catalogue : evil.run', 'erreur conservée');
  const id3 = insertJob('sub-alice');
  DB._db.prepare("UPDATE mcp_jobs SET status = 'expired' WHERE id = ?").run(id3);
  eq((await reply(id3, { ok: true, data: {} })).status, 410, 'ordre expiré → 410 (trop tard)');
  const id4 = insertJob('sub-alice');
  eq((await reply(id4, { ok: true, data: { big: 'x'.repeat(70000) } })).status, 200, 'résultat trop gros accepté…');
  eq(DB._db.prepare('SELECT status FROM mcp_jobs WHERE id = ?').get(id4).status, 'failed', '… mais stocké comme échec (64 Ko max)');
}

console.log('\n▶ 3 · bridgeRun (attente du Worker)');
{
  /* onglet simulé : répond au premier ordre pending qu'il voit */
  const tab = (fn) => (async () => { for (let i = 0; i < 40; i++) { await sleep(20); const j = DB._db.prepare("SELECT id, action, args_json FROM mcp_jobs WHERE sub = 'sub-alice' AND status = 'pending' AND tool = 'run-banc'").get(); if (j) { await fn(j); return; } } })();
  let run = bridgeRun(env, { sub: 'sub-alice', tool: 'run-banc', action: 'gw.list_posts', args: { a: 1 }, waitMs: 1000, pollMs: 30 });
  await tab(async (j) => { eq(JSON.parse(j.args_json), { a: 1 }, 'l’onglet lit les arguments'); await reply(j.id, { ok: true, data: { total: 3 } }); });
  let r = await run;
  eq(r.status, 'done', 'done'); eq(r.data, { total: 3 }, '… avec les données');
  run = bridgeRun(env, { sub: 'sub-alice', tool: 'run-banc', action: 'gw.list_posts', args: {}, waitMs: 1000, pollMs: 30 });
  await tab(async (j) => reply(j.id, { ok: false, error: 'Le Ghost Writer est déjà ouvert' }));
  r = await run;
  yes(r.status === 'failed' && /déjà ouvert/.test(r.error), 'failed avec le message de l’onglet');
  r = await bridgeRun(env, { sub: 'sub-alice', tool: 'run-banc', action: 'gw.list_posts', args: {}, waitMs: 250, pollMs: 30 });
  eq(r.status, 'timeout', 'onglet muet → timeout');
  eq(DB._db.prepare('SELECT status FROM mcp_jobs WHERE id = ?').get(r.jobId).status, 'expired', '… ordre marqué expired');
  eq((await reply(r.jobId, { ok: true, data: {} })).status, 410, '… une réponse tardive est refusée');
}

console.log('\n▶ 4 · Outils MCP via le Pont');
{
  DB._db.prepare('DELETE FROM mcp_bridge_presence').run();
  const seen = [];
  const dispatch = async (rq) => {
    const u = new URL(rq.url); seen.push({ method: rq.method, path: u.pathname });
    if (u.pathname === '/api/mcp/bridge/presence') return handleBridgePresence(rq, env);
    if (u.pathname === '/api/mcp/inbox' && rq.method === 'POST') return handleMcpInboxDeposit(rq, env);
    if (u.pathname === '/api/mcp/inbox' && rq.method === 'GET')  return handleMcpInboxList(rq, env);
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };
  const call = async (name, args = {}) => {
    const r = await handleMcp(new Request(`${API}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtAlice}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), env, dispatch);
    return (await r.json()).result;
  };
  const inboxCount = () => DB._db.prepare("SELECT COUNT(*) AS n FROM mcp_inbox WHERE sub = 'sub-alice' AND status = 'pending'").get().n;
  /* onglet simulé branché sur la table (comme le canal le ferait) */
  let tabHandler = null;
  const tabLoop = (async () => { for (let i = 0; i < 400; i++) { await sleep(15); if (!tabHandler) continue; const j = DB._db.prepare("SELECT id, action, args_json FROM mcp_jobs WHERE sub = 'sub-alice' AND status = 'pending' AND tool LIKE 'keystone_%'").get(); if (j) { const h = tabHandler; tabHandler = null; await h(j); } } })();

  let r = await call('keystone_bridge_status');
  eq(r.structuredContent.onglet_ouvert, false, 'keystone_bridge_status : aucun onglet');
  r = await call('keystone_brainstorming_sessions');
  yes(r.isError && /Aucun onglet Keystone ouvert/.test(r.content[0].text), 'lecture navigateur sans onglet → erreur claire');
  eq(DB._db.prepare("SELECT COUNT(*) AS n FROM mcp_jobs WHERE tool = 'keystone_brainstorming_sessions'").get().n, 0, '… aucun ordre créé');
  r = await call('keystone_social_draft_post', { text: 'Hello', networks: ['facebook'] });
  yes(r.isError === false && r.structuredContent.depose === true && !r.structuredContent.en_direct, 'écriture bannette sans onglet → dépôt');
  eq(inboxCount(), 1, '… 1 proposition en attente');

  DB._db.prepare("INSERT INTO mcp_bridge_presence (sub, tab_id) VALUES ('sub-alice', 'tab_live')").run();
  r = await call('keystone_bridge_status');
  eq(r.structuredContent.onglet_ouvert, true, 'keystone_bridge_status : onglet en ligne');
  tabHandler = async (j) => { eq(j.action, 'bs.list_sessions', 'l’onglet reçoit l’action bs.list_sessions'); await reply(j.id, { ok: true, data: { total: 1, seances: [{ id: 's1', brief: 'Nom du programme' }] } }); };
  r = await call('keystone_brainstorming_sessions');
  yes(r.isError === false && r.structuredContent.total === 1 && r.structuredContent.seances[0].id === 's1', 'lecture navigateur avec onglet → données de l’onglet');
  tabHandler = async (j) => { eq(JSON.parse(j.args_json), { text: 'Hello live', networks: ['threads'], append: false }, 'l’onglet reçoit le brouillon (text, networks, append)'); await reply(j.id, { ok: true, data: { fait: true, outil_ouvert: 'Social Manager', texte: 'Hello live', reseaux: ['threads'] } }); };
  r = await call('keystone_social_draft_post', { text: 'Hello live', networks: ['threads'] });
  yes(r.isError === false && r.structuredContent.en_direct === true && r.structuredContent.outil_ouvert === 'Social Manager', 'écriture bannette avec onglet → en direct');
  eq(inboxCount(), 1, '… rien de nouveau en bannette');
  eq(DB._db.prepare("SELECT label FROM mcp_calls WHERE tool = 'keystone_social_draft_post' ORDER BY rowid DESC LIMIT 1").get().label, 'Post à relire : « Hello live »', 'ledger : activité consignée');
  tabHandler = async (j) => reply(j.id, { ok: false, error: 'Une séance de brainstorming est déjà ouverte' });
  r = await call('keystone_brainstorming_seed_session', { brief: 'Sujet' });
  yes(r.isError && /Dans l’onglet Keystone : Une séance/.test(r.content[0].text), 'échec dans l’onglet → isError avec son message');
  tabHandler = async (j) => reply(j.id, { ok: true, data: { fait: true, outil_ouvert: 'Smart Dynamic QR' } });
  r = await call('keystone_os_open_pad', { pad: 'qr' });
  yes(r.isError === false && r.structuredContent.fait && r.structuredContent.activite === 'Smart Dynamic QR ouvert à l’écran', 'ouverture d’un pad : fait + activité');
  tabHandler = null;   // onglet muet
  r = await call('keystone_ghostwriter_prepare_text', { text: 'Réécris-moi ça' });
  yes(r.isError === false && r.structuredContent.depose === true && /pas répondu à temps/.test(r.structuredContent.message), 'onglet muet → repli bannette, mention du délai');
  eq(inboxCount(), 2, '… 2 propositions en attente');
  r = await call('keystone_ghostwriter_library');
  yes(r.isError && /pas répondu à temps/.test(r.content[0].text), 'lecture navigateur, onglet muet → erreur claire');
  eq(DB._db.prepare("SELECT COUNT(*) AS n FROM mcp_jobs WHERE status = 'expired'").get().n >= 2, true, 'ordres muets expirés');
  r = await call('keystone_qr_prepare_url', { url: 'pas-une-url' });
  yes(r.isError && /Adresse complète/.test(r.content[0].text), 'validation avant délégation');
  tabHandler = null;
}

console.log('\n▶ 5 · Purge');
{
  DB._db.prepare("UPDATE mcp_jobs SET created_at = datetime('now', '-2 days')").run();
  DB._db.prepare("UPDATE mcp_bridge_presence SET last_seen = datetime('now', '-2 days') WHERE tab_id = 'tab_live'").run();
  const p = await purgeMcpBridge(env);
  yes(p.jobs >= 5 && p.presence === 1, `jobs (${p.jobs}) et présence (${p.presence}) purgés`);
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m`);
process.exit(fail ? 1 : 0);
