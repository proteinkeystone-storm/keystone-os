/* ═══════════════════════════════════════════════════════════════
   Banc — Serveur MCP /mcp : protocole JSON-RPC, auth JWT, outils
   ───────────────────────────────────────────────────────────────
   Ce que ce banc PROUVE (sans réseau, vrai handler, routeur simulé) :
     1. Sans jeton valide → 401 + WWW-Authenticate resource_metadata.
     2. initialize négocie la version et annonce `tools`.
     3. notifications/initialized → 202 sans corps ; ping → {}.
     4. tools/list : tous les outils sont nommés keystone_*, schéma objet,
        description bornée, annotations lecture seule (sauf écritures).
     5. tools/call : requis manquant → isError ; outil inconnu → -32602 ;
        un outil réel met en forme la réponse du routeur ; une erreur de
        route devient un isError lisible, jamais une 500.
     6. Méthode inconnue → -32601 ; JSON illisible → -32700 ; lot traité.
     7. Le JWT du client est transmis TEL QUEL au routeur interne.
   Lancement : node scripts/test-mcp-protocol.mjs
   ═══════════════════════════════════════════════════════════════ */
import { signJWT }   from '../workers/src/lib/jwt.js';
import { handleMcp } from '../workers/src/routes/mcp.js';
import { MCP_TOOLS } from '../workers/src/lib/mcp-tools.js';

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));
const eq = (a, e, l) => (JSON.stringify(a) === JSON.stringify(e) ? ok(l) : ko(l, `attendu ${JSON.stringify(e)}, reçu ${JSON.stringify(a)}`));

/* ── Environnement simulé ── */
const dbCalls = [];
const env = {
  KS_JWT_SECRET: 'jwt-secret-du-banc-32-octets-minimum-0123456789',
  DB: { prepare: (sql) => ({ bind: (...b) => ({ run: async () => { dbCalls.push({ sql, b }); return {}; }, first: async () => null, all: async () => ({ results: [] }) }),
                             run: async () => { dbCalls.push({ sql }); return {}; }, first: async () => null, all: async () => ({ results: [] }) }) },
};
/* Routeur simulé : enregistre chaque appel interne, sert des réponses canoniques. */
const seen = [];
const canned = {
  '/api/qr': { qrs: [
    { id: 'q1', name: 'Vitrine', qr_type: 'url', mode: 'dynamic', status: 'active', scans_total: 42, target_url: 'https://ex.fr', created_at: '2026-09-01 10:00:00' },
    { id: 'q2', name: 'Menu', qr_type: 'url', mode: 'static', status: 'active', payload: { url: 'https://menu.fr' }, created_at: '2026-09-02 10:00:00' },
  ] },
  '/api/qr/q1/stats?period=30d': { totals: { total: 42, unique: 30, today: 2, week: 9 }, heatmap: [{ dow: 2, hour: 11, cnt: 7 }], byCountry: [{ country: 'FR', cnt: 40 }], byDevice: [{ device: 'mobile', cnt: 41 }], meta: { created_at: '2026-09-01 10:00:00' } },
  '/api/sentinel/sites': { sites: [{ id: 's1', label: 'Mon site', url: 'https://www.monsite.fr', platform: 'wix', last_checked_at: '2026-09-16 08:00:00', last_ok: 1, uptime24h: 100, last_ms: 320, last_score: 81 }], limit: 1 },
  '/api/catalog': { catalog: { version: '1.3', tools: [{ id: 'A-COM-001', padKey: 'A3', title: 'Smart Dynamic QR', subtitle: 'QR traçables', plan: 'STARTER' }, { id: 'O-IMM-001', title: 'Notices VEFA', replacedBy: 'O-IMM-010' }] } },
};
const dispatch = async (req) => {
  const u = new URL(req.url);
  const key = u.pathname + (u.search || '');
  seen.push({ method: req.method, key, authz: req.headers.get('Authorization') });
  if (key === '/api/boom') return new Response(JSON.stringify({ error: 'Cette application n\'est pas incluse dans votre licence.' }), { status: 403 });
  const body = canned[key];
  if (!body) return new Response(JSON.stringify({ error: `not found ${key}` }), { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const jwt = await signJWT({ sub: 'banc-sub', plan: 'PRO', owner: 'banc', email: 'b@banc.test' }, env);
const post = (body, token = jwt, headers = {}) => handleMcp(new Request('https://api.test/mcp', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}), env, dispatch);
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

console.log('\n▶ 1 · Auth');
{
  const r = await post(rpc('ping', {}), null);
  eq(r.status, 401, 'sans jeton → 401');
  yes(/resource_metadata="https:\/\/api\.test\/\.well-known\/oauth-protected-resource\/mcp"/.test(r.headers.get('WWW-Authenticate') || ''), 'WWW-Authenticate pointe la métadonnée de ressource', r.headers.get('WWW-Authenticate'));
  const bad = await post(rpc('ping', {}), jwt.slice(0, -4) + 'AAAA');
  eq(bad.status, 401, 'signature altérée → 401');
  const expired = await signJWT({ sub: 'x', plan: 'PRO' }, env, -10);
  eq((await post(rpc('ping', {}), expired)).status, 401, 'jeton expiré → 401');
  const other = await signJWT({ sub: 'x', plan: 'PRO' }, { KS_JWT_SECRET: 'autre-secret-00000000000000000000000000' });
  eq((await post(rpc('ping', {}), other)).status, 401, 'jeton signé par un autre secret → 401');
  const get = await handleMcp(new Request('https://api.test/mcp', { method: 'GET', headers: { Authorization: `Bearer ${jwt}` } }), env, dispatch);
  eq(get.status, 405, 'GET /mcp → 405 (sans état, POST seulement)');
}

console.log('\n▶ 2 · initialize');
{
  const r = await post(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'banc', version: '0' } }));
  eq(r.status, 200, 'initialize → 200');
  const j = await r.json();
  eq(j.result.protocolVersion, '2025-06-18', 'version demandée acceptée');
  yes(j.result.capabilities && j.result.capabilities.tools, 'capacité tools annoncée');
  eq(j.result.serverInfo.name, 'keystone-os', 'serverInfo.name');
  yes(typeof j.result.instructions === 'string' && j.result.instructions.length > 40, 'instructions présentes');
  const old = await (await post(rpc('initialize', { protocolVersion: '1999-01-01' }))).json();
  eq(old.result.protocolVersion, '2025-06-18', 'version inconnue → repli sur la plus récente');
}

console.log('\n▶ 3 · notifications & ping');
{
  const r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  eq(r.status, 202, 'notifications/initialized → 202');
  eq(await r.text(), '', '… sans corps');
  const p = await (await post(rpc('ping', {}, 7))).json();
  eq(p, { jsonrpc: '2.0', id: 7, result: {} }, 'ping → {} avec le même id');
}

console.log('\n▶ 4 · tools/list');
{
  const j = await (await post(rpc('tools/list', {}))).json();
  const tools = j.result.tools;
  yes(Array.isArray(tools) && tools.length >= 25, `au moins 25 outils (${tools.length})`);
  eq(tools.length, MCP_TOOLS.filter(t => !t.gate).length, 'tools/list expose tout le registre');
  yes(tools.every(t => /^keystone_[a-z0-9_]+$/.test(t.name)), 'tous nommés keystone_[a-z0-9_]+');
  yes(new Set(tools.map(t => t.name)).size === tools.length, 'noms uniques');
  yes(tools.every(t => t.inputSchema && t.inputSchema.type === 'object'), 'inputSchema = objet partout');
  yes(tools.every(t => typeof t.description === 'string' && t.description.length >= 30 && t.description.length <= 400), 'descriptions entre 30 et 400 caractères');
  const byName = Object.fromEntries(MCP_TOOLS.map(t => [t.name, t]));
  yes(tools.every(t => t.annotations && t.annotations.readOnlyHint === !byName[t.name].write && t.annotations.destructiveHint === false), 'annotations : lecture seule sauf écritures (write), jamais destructif');
  yes(!tools.some(t => t.name === 'keystone_qr_create'), 'keystone_qr_create hors catalogue sans MCP_QR_CREATE=on');
  yes(tools.every(t => (t.inputSchema.required || []).every(r => t.inputSchema.properties && t.inputSchema.properties[r])), 'chaque requis est décrit dans properties');
}

console.log('\n▶ 5 · tools/call');
{
  const miss = await (await post(rpc('tools/call', { name: 'keystone_qr_stats', arguments: {} }))).json();
  yes(miss.result && miss.result.isError === true && /name/.test(miss.result.content[0].text), 'requis manquant → isError lisible');
  const unk = await (await post(rpc('tools/call', { name: 'keystone_nope', arguments: {} }))).json();
  eq(unk.error && unk.error.code, -32602, 'outil inconnu → -32602');
  seen.length = 0;
  const list = await (await post(rpc('tools/call', { name: 'keystone_qr_list', arguments: {} }))).json();
  yes(list.result && list.result.isError === false, 'keystone_qr_list → succès');
  eq(list.result.structuredContent.total, 2, 'structuredContent.total = 2');
  eq(list.result.structuredContent.qrs[1].scans, null, 'QR statique : scans null (pas 0)');
  eq(list.result.structuredContent.qrs[0].cree_le, '2026-09-01T10:00:00Z', 'date SQLite → ISO UTC');
  yes(JSON.parse(list.result.content[0].text).total === 2, 'content[0].text = JSON du résultat');
  eq(seen.map(s => s.method + ' ' + s.key), ['GET /api/qr'], 'un seul appel interne, en GET');
  const stats = await (await post(rpc('tools/call', { name: 'keystone_qr_stats', arguments: { name: 'vitr' } }))).json();
  eq(stats.result.structuredContent.qr, 'Vitrine', 'résolution par nom partiel, accents ignorés');
  eq(stats.result.structuredContent.meilleur_creneau, { jour: 'mardi', heure_utc: 11, scans: 7 }, 'meilleur créneau depuis la heatmap');
  const amb = await (await post(rpc('tools/call', { name: 'keystone_qr_stats', arguments: { name: 'zzz' } }))).json();
  yes(amb.result.isError === true && /Aucun QR/.test(amb.result.content[0].text), 'QR introuvable → isError explicite');
  const cat = await (await post(rpc('tools/call', { name: 'keystone_os_catalog', arguments: {} }))).json();
  eq(cat.result.structuredContent.applications.map(p => p.id), ['A-COM-001'], 'catalogue : lit cat.tools et ignore les pads remplacés');
  eq(cat.result.structuredContent.plan, 'PRO', 'catalogue : plan du jeton');
  const sites = await (await post(rpc('tools/call', { name: 'keystone_sentinel_sites', arguments: {} }))).json();
  eq(sites.result.structuredContent.sites[0].nom, 'Mon site', 'Sentinel : flotte mise en forme');
  eq(sites.result.structuredContent.sites[0].en_ligne, true, 'Sentinel : en_ligne booléen');
  /* erreur de route (403 licence) → isError, jamais 500 */
  const tool = MCP_TOOLS.find(t => t.name === 'keystone_keynapse_reminders');
  const saved = tool.run;
  tool.run = async (ctx) => ctx.call('/api/boom');
  const boom = await post(rpc('tools/call', { name: 'keystone_keynapse_reminders', arguments: {} }));
  tool.run = saved;
  eq(boom.status, 200, 'erreur de route → HTTP 200 (JSON-RPC)');
  const bj = await boom.json();
  yes(bj.result.isError === true && /licence/.test(bj.result.content[0].text), 'message serveur restitué tel quel dans isError');
  yes(dbCalls.some(c => /INSERT INTO mcp_calls/.test(c.sql)), 'ledger mcp_calls alimenté');
}

console.log('\n▶ 6 · erreurs de protocole & lot');
{
  const m = await (await post(rpc('prompts/list', {}))).json();   // resources/* existe depuis le sprint 6
  eq(m.error && m.error.code, -32601, 'méthode inconnue → -32601');
  const p = await post('{not json');
  eq(p.status, 400, 'JSON illisible → 400');
  eq((await p.json()).error.code, -32700, '… code -32700');
  const batch = await (await post([rpc('ping', {}, 1), rpc('tools/list', {}, 2), { jsonrpc: '2.0', method: 'notifications/initialized' }])).json();
  yes(Array.isArray(batch) && batch.length === 2, 'lot : 2 réponses pour 2 requêtes + 1 notification');
  const bad = await (await post({ jsonrpc: '1.0', id: 3, method: 'ping' })).json();
  eq(bad.error && bad.error.code, -32600, 'jsonrpc ≠ 2.0 → -32600');
}

console.log('\n▶ 7 · le JWT du client traverse tel quel');
{
  seen.length = 0;
  await post(rpc('tools/call', { name: 'keystone_sentinel_sites', arguments: {} }));
  yes(seen.length === 1 && seen[0].authz === `Bearer ${jwt}`, 'appel interne porté par le JWT du client, inchangé');
  yes(!seen.some(s => s.method !== 'GET'), 'aucune écriture interne');
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m`);
process.exit(fail ? 1 : 0);
