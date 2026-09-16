/* ═══════════════════════════════════════════════════════════════
   Banc — Le Moteur générique (MCP sprint 6) : pads-formulaires → outils
   ───────────────────────────────────────────────────────────────
   Vrais handleMcp + lib/mcp-forms.js sur les VRAIS pads de app/pads-data.js,
   catalogue D1 simulé, licences en SQLite. Ce que ce banc PROUVE :
     1. Inventaire : un pad publié (D1) apparaît, un pad non publié /
        remplacé n'apparaît qu'à l'admin (drapeau) ; schéma dérivé de
        chaque pad ; licence respectée (sac owned_assets).
     2. Recette : system prompt avec {{champs}}, champs exacts, ressource
        MCP listée et lisible (resources/list, /read, /templates/list) ;
        URI inconnue → -32002 ; pad hors licence → refus.
     3. Remplissage : champ inconnu, requis manquant, option hors liste,
        nombre invalide → refus AVANT tout dépôt ; multiselect normalisé
        (tableau ou CSV) ; select insensible aux accents ; nombre « 75 »
        → 75 ; sans onglet → bannette kind prefillData avec les données
        propres ; avec onglet → ordre os.prefill_form.
   Lancement : node scripts/test-mcp-forms.mjs
   ═══════════════════════════════════════════════════════════════ */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { signJWT } from '../workers/src/lib/jwt.js';
import { handleMcp } from '../workers/src/routes/mcp.js';
import { handleMcpInboxDeposit, handleMcpInboxList } from '../workers/src/routes/mcp-writes.js';
import { handleBridgeJobResult } from '../workers/src/routes/mcp-bridge.js';
import { formSchema, validateFormData } from '../workers/src/lib/mcp-forms.js';
import { PADS_DATA } from '../app/pads-data.js';
import { BRIDGE_ACTIONS } from '../app/bridge-actions.js';

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
DB._db.exec(`CREATE TABLE licences (key TEXT PRIMARY KEY, tenant_id TEXT DEFAULT 'default', owner TEXT, plan TEXT, is_active INTEGER DEFAULT 1, owned_assets TEXT, expires_at TEXT, lookup_hmac TEXT);
             INSERT INTO licences (key, owner, plan, lookup_hmac, owned_assets) VALUES ('BANC-1', 'Alice', 'PRO', 'sub-alice', '["O-IMM-002","A-COM-001"]');
             INSERT INTO licences (key, owner, plan, lookup_hmac, owned_assets) VALUES ('BANC-2', 'Bob', 'STARTER', 'sub-bob', '["A-COM-001"]');`);
const env = { KS_JWT_SECRET: 'jwt-secret-du-banc-32-octets-minimum-0123456789', KS_ALLOWED_ORIGIN: 'https://front.test', DB, MCP_BRIDGE_WAIT_MS: '400' };
const API = 'https://api.test';
const jwtAlice = await signJWT({ sub: 'sub-alice', plan: 'PRO', owner: 'Alice' }, env);
const jwtBob   = await signJWT({ sub: 'sub-bob', plan: 'STARTER', owner: 'Bob' }, env);
const jwtAdmin = await signJWT({ sub: 'sub-admin', plan: 'ADMIN', owner: 'Stéphane', isAdmin: true }, env);

/* Catalogue D1 simulé : Annonces Immo PUBLIÉ, les deux autres non */
const CATALOG = { catalog: { version: 'banc', tools: [
  { id: 'O-IMM-002', padKey: 'A2', title: 'Annonces Immo', subtitle: 'Annonces multi-portails', plan: 'STARTER', published: true, category: 'IMM' },
  { id: 'O-IMM-001', padKey: 'A1', title: 'Notices VEFA', plan: 'STARTER', published: false, replacedBy: 'O-IMM-010' },
  { id: 'A-COM-001', title: 'Smart Dynamic QR', plan: 'STARTER', published: true },
] } };
const seen = [];
const dispatch = async (rq) => {
  const u = new URL(rq.url); seen.push({ method: rq.method, path: u.pathname });
  if (u.pathname === '/api/catalog') return new Response(JSON.stringify(CATALOG), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/api/mcp/inbox' && rq.method === 'POST') return handleMcpInboxDeposit(rq, env);
  if (u.pathname === '/api/mcp/inbox' && rq.method === 'GET')  return handleMcpInboxList(rq, env);
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
};
const rpc = async (method, params, token = jwtAlice) => {
  const r = await handleMcp(new Request(`${API}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || {} }) }), env, dispatch);
  return r.json();
};
const call = async (name, args, token) => (await rpc('tools/call', { name, arguments: args || {} }, token)).result;
const A2 = PADS_DATA.A2;

console.log('\n▶ 1 · Inventaire et licence');
{
  let r = await call('keystone_form_list');
  eq(r.structuredContent.total, 1, 'Alice (PRO) : 1 formulaire publié');
  const f = r.structuredContent.formulaires[0];
  yes(f.id === 'O-IMM-002' && f.cle === 'A2' && f.accessible === true && f.champs === A2.fields.length && f.ressource === 'keystone://pad/O-IMM-002/prompt', 'Annonces Immo : id, clé, champs, accessible, ressource');
  eq(f.requis, A2.fields.filter(x => x.required).map(x => x.id), 'champs requis listés');
  r = await call('keystone_form_list', {}, jwtBob);
  yes(r.structuredContent.formulaires[0].accessible === false, 'Bob (sac sans O-IMM-002) : visible mais non accessible');
  r = await call('keystone_form_list', {}, jwtAdmin);
  yes(r.structuredContent.total === 3 && r.structuredContent.formulaires.some(x => x.publie === false && x.remplace_par === 'O-IMM-010'), 'admin : voit aussi les non publiés / remplacés, drapeaux posés');
  yes(seen.filter(s => s.path === '/api/catalog').length >= 3 && !seen.some(s => s.method !== 'GET' && s.path === '/api/catalog'), 'catalogue lu en GET, jamais écrit');
  const sch = formSchema(A2);
  yes(sch.type === 'object' && sch.additionalProperties === false && sch.properties.portails.type === 'array' && Array.isArray(sch.properties.portails.items.enum), 'schéma dérivé : multiselect → tableau d’options');
  yes(sch.properties[A2.fields.find(x => x.type === 'number').id].type === 'number', '… number → number');
  for (const [k, p] of Object.entries(PADS_DATA)) { const s = formSchema(p); yes(Object.keys(s.properties).length === p.fields.length && s.required.every(x => p.fields.find(f => f.id === x && f.required)), `schéma de ${k} (${p.id}) : ${p.fields.length} champs, requis exacts`); }
}

console.log('\n▶ 2 · Recette et ressources');
{
  let r = await call('keystone_form_prompt', { pad: 'annonces' });
  const sc = r.structuredContent;
  yes(r.isError === false && sc.id === 'O-IMM-002' && /\{\{\w+\}\}/.test(sc.recette), 'recette avec {{champs}}');
  eq(sc.champs.length, A2.fields.length, 'champs exacts'); yes(sc.champs.find(c => c.id === 'portails').options.length > 3, 'options du multiselect');
  r = await call('keystone_form_prompt', { pad: 'A2' }, jwtBob);
  yes(r.isError && /pas dans la licence/.test(r.content[0].text), 'Bob : recette refusée hors licence');
  r = await call('keystone_form_prompt', { pad: 'inexistant' });
  yes(r.isError && /Aucun formulaire « inexistant »/.test(r.content[0].text), 'formulaire inconnu → liste des disponibles');
  const init = (await rpc('initialize', { protocolVersion: '2025-06-18' })).result;
  yes(init.capabilities.resources && /keystone_form_list/.test(init.instructions), 'initialize : capacité resources + instructions');
  const list = (await rpc('resources/list')).result;
  eq(list.resources.map(x => x.uri), ['keystone://pad/O-IMM-002/prompt'], 'resources/list : la recette du pad accessible');
  eq((await rpc('resources/list', {}, jwtBob)).result.resources.length, 0, 'Bob : aucune ressource (hors licence)');
  const tpl = (await rpc('resources/templates/list')).result;
  yes(tpl.resourceTemplates[0].uriTemplate === 'keystone://pad/{padId}/prompt', 'gabarit d’URI annoncé');
  const read = (await rpc('resources/read', { uri: 'keystone://pad/O-IMM-002/prompt' })).result;
  yes(read.contents[0].mimeType === 'text/markdown' && /# Annonces Immo/.test(read.contents[0].text) && /\{\{/.test(read.contents[0].text) && /\| portails \|/.test(read.contents[0].text), 'resources/read : markdown avec recette et table des champs');
  const bad = await rpc('resources/read', { uri: 'keystone://pad/../etc/passwd' });
  eq(bad.error?.code, -32002, 'URI hors forme → -32002');
  eq((await rpc('resources/read', { uri: 'keystone://pad/O-IMM-001/prompt' })).error?.code, -32002, 'pad non publié (non admin) → -32002');
  eq((await rpc('resources/read', { uri: 'keystone://pad/O-IMM-002/prompt' }, jwtBob)).error?.code, -32002, 'hors licence → -32002');
  yes((await rpc('resources/read', { uri: 'keystone://pad/O-IMM-001/prompt' }, jwtAdmin)).result?.contents?.[0]?.text?.includes('Notices VEFA'), 'admin lit la recette d’un pad non publié');
}

console.log('\n▶ 3 · Remplissage');
{
  const inbox = () => DB._db.prepare("SELECT pad, kind, payload_json, summary FROM mcp_inbox WHERE sub = 'sub-alice' AND status = 'pending' ORDER BY rowid DESC LIMIT 1").get();
  const req = A2.fields.filter(f => f.required).map(f => f.id);
  const sel = A2.fields.find(f => f.type === 'select'), num = A2.fields.find(f => f.type === 'number'), txt = A2.fields.find(f => f.type === 'text');
  const good = {};
  for (const f of A2.fields) { if (!f.required) continue; good[f.id] = f.type === 'number' ? 75 : f.type === 'select' ? f.options[0] : f.type === 'multiselect' ? [f.options[0]] : 'Valeur'; }
  let r = await call('keystone_form_fill', { pad: 'A2', data: { ...good, inconnu: 'x' } });
  yes(r.isError && /champ inconnu : inconnu/.test(r.content[0].text), 'champ inconnu → refus');
  const missing = { ...good }; delete missing[req[0]];
  r = await call('keystone_form_fill', { pad: 'A2', data: missing });
  yes(r.isError && new RegExp(`requis manquant : ${req[0]}`).test(r.content[0].text), 'requis manquant → refus nommé');
  r = await call('keystone_form_fill', { pad: 'A2', data: { ...good, [sel.id]: 'Pas une option' } });
  yes(r.isError && /hors options/.test(r.content[0].text), 'select hors options → refus');
  r = await call('keystone_form_fill', { pad: 'A2', data: { ...good, [num.id]: 'abc' } });
  yes(r.isError && /nombre attendu/.test(r.content[0].text), 'nombre invalide → refus');
  eq(DB._db.prepare("SELECT COUNT(*) AS n FROM mcp_inbox").get().n, 0, 'aucun dépôt tant que la validation échoue');
  const v = validateFormData(A2, { ...good, [num.id]: '75', [sel.id]: sel.options[0].toUpperCase(), portails: 'SeLoger, leboncoin, Inconnu' });
  yes(!v.ok && v.errors.length === 1 && /Inconnu/.test(v.errors[0]), 'multiselect : une valeur inconnue suffit à refuser');
  const v2 = validateFormData(A2, { ...good, [num.id]: '75', [sel.id]: sel.options[0].toUpperCase(), portails: ['SeLoger', 'leboncoin', 'SeLoger'] });
  yes(v2.ok && v2.data[num.id] === 75 && v2.data[sel.id] === sel.options[0] && v2.data.portails === 'SeLoger, LeBonCoin', 'normalisation : nombre, select insensible à la casse, multiselect CSV dédoublonné');
  r = await call('keystone_form_fill', { pad: 'Annonces Immo', data: { ...good, [num.id]: '75', portails: 'SeLoger, LeBonCoin' } });
  yes(r.isError === false && r.structuredContent.depose === true && r.structuredContent.champs_valides >= req.length, 'sans onglet → déposé en bannette');
  const row = inbox();
  yes(row && row.pad === 'O-IMM-002' && row.kind === 'prefillData' && JSON.parse(row.payload_json)[num.id] === 75 && JSON.parse(row.payload_json).portails === 'SeLoger, LeBonCoin', 'bannette : kind prefillData, données propres = opts.prefillData');
  yes(/Annonces Immo à relire/.test(row.summary), 'résumé lisible');
  r = await call('keystone_form_fill', { pad: 'A2', data: good }, jwtBob);
  yes(r.isError && /pas dans la licence/.test(r.content[0].text), 'Bob : remplissage refusé hors licence');
  /* avec onglet : ordre os.prefill_form */
  DB._db.prepare("INSERT INTO mcp_bridge_presence (sub, tab_id) VALUES ('sub-alice', 'tab_banc')").run();
  const tab = (async () => { for (let i = 0; i < 40; i++) { await sleep(15); const j = DB._db.prepare("SELECT id, action, args_json FROM mcp_jobs WHERE sub = 'sub-alice' AND status = 'pending'").get(); if (j) { eq(j.action, 'os.prefill_form', 'l’onglet reçoit os.prefill_form'); yes(JSON.parse(j.args_json).padId === 'O-IMM-002' && JSON.parse(j.args_json).data[num.id] === 75, '… avec padId et données validées'); await handleBridgeJobResult(new Request(`${API}/api/mcp/bridge/jobs/${j.id}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtAlice}` }, body: JSON.stringify({ ok: true, data: { fait: true, outil_ouvert: 'O-IMM-002', champs_remplis: 7 } }) }), env, j.id); return; } } })();
  r = await call('keystone_form_fill', { pad: 'A2', data: { ...good, [num.id]: '75' } });
  await tab;
  yes(r.isError === false && r.structuredContent.en_direct === true && r.structuredContent.formulaire === 'Annonces Immo', 'avec onglet → formulaire ouvert en direct');
  const act = BRIDGE_ACTIONS.find(a => a.id === 'os.prefill_form');
  yes(act && act.mode === 'write' && act.target === '#tool-form', 'catalogue de l’onglet : os.prefill_form (write, cible #tool-form)');
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m`);
process.exit(fail ? 1 : 0);
