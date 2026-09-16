/* ═══════════════════════════════════════════════════════════════
   Banc — Écritures MCP (sprint 3) : directes, à confirmation, bannette
   ───────────────────────────────────────────────────────────────
   Vrai handleMcp, vraies confirmations (routes/mcp-writes.js sur SQLite
   en mémoire, migrations 015 + 016 appliquées telles quelles), routeur
   interne simulé qui ENREGISTRE chaque appel (méthode, chemin, corps).
   Ce que ce banc PROUVE :
     1. tools/list : les écritures ne sont pas « lecture seule » ; le QR
        reste hors catalogue sans MCP_QR_CREATE=on.
     2. Écritures directes : chaque outil n'émet que le POST déclaré, avec
        le corps attendu ; doublons et entrées invalides refusés AVANT
        d'écrire ; `activite` consignée dans le ledger.
     3. Confirmation : sans confirm_token → aperçu + kcf_, AUCUN POST ;
        avec le jeton → un POST, une fois ; rejeu → refus ; arguments
        changés → refus ; autre compte → refus (sans brûler le jeton) ;
        autre outil → refus ; périmé → refus.
     4. Quota : 10 audits Sentinel par jour, le 11e est refusé.
     5. Bannette : le dépôt passe par le vrai handler (JWT de l'appel),
        la ligne porte le bon sub ; keystone_bannette_status la voit.
     6. Portée OAuth : un jeton keystone.read seul lit mais n'écrit pas ;
        un jeton read+write écrit.
   Lancement : node scripts/test-mcp-writes.mjs
   ═══════════════════════════════════════════════════════════════ */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { signJWT } from '../workers/src/lib/jwt.js';
import { handleMcp } from '../workers/src/routes/mcp.js';
import { MCP_TOOLS, mcpToolList } from '../workers/src/lib/mcp-tools.js';
import { handleMcpInboxDeposit, handleMcpInboxList } from '../workers/src/routes/mcp-writes.js';
import { handleOauthRegister, handleOauthAuthorize, handleOauthApprove, handleOauthToken } from '../workers/src/routes/oauth.js';

let pass = 0, fail = 0;
const ok  = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko  = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));
const eq  = (a, e, l) => (JSON.stringify(a) === JSON.stringify(e) ? ok(l) : ko(l, `attendu ${JSON.stringify(e)}, reçu ${JSON.stringify(a)}`));

/* ── D1 imité par node:sqlite ── */
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
  return { prepare: stmt, batch: async (list) => Promise.all(list.map(s => s.run())), _db: db };
}
const DB = makeD1();
DB._db.exec(readFileSync(new URL('../workers/migrations/015_mcp_oauth.sql', import.meta.url), 'utf8'));
DB._db.exec(readFileSync(new URL('../workers/migrations/016_mcp_writes.sql', import.meta.url), 'utf8'));
DB._db.exec(`CREATE TABLE licences (key TEXT PRIMARY KEY, tenant_id TEXT DEFAULT 'default', owner TEXT, plan TEXT, is_active INTEGER DEFAULT 1,
             owned_assets TEXT, expires_at TEXT, lookup_hmac TEXT);
             CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor TEXT, target TEXT, tenant_id TEXT, details TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
             INSERT INTO licences (key, owner, plan, lookup_hmac) VALUES ('BANC-0000-0000-0001', 'Alice', 'MAX', 'sub-alice');
             INSERT INTO licences (key, owner, plan, lookup_hmac) VALUES ('BANC-0000-0000-0002', 'Bob', 'PRO', 'sub-bob');`);
const env = { KS_JWT_SECRET: 'jwt-secret-du-banc-32-octets-minimum-0123456789', KS_ALLOWED_ORIGIN: 'https://front.test', DB };
const API = 'https://api.test';

/* ── Routeur interne simulé : enregistre, sert des réponses canoniques ── */
const seen = [];
const canned = (method, path, body) => {
  const k = `${method} ${path}`;
  const map = {
    'GET /api/keynapse/state': { zones: [{ id: 'z1', name: 'Chantiers' }, { id: 'z2', name: 'Perso' }], bubbles: [] },
    'POST /api/keynapse/bubbles': { bubble: { id: 'b1', title: body?.title, created_at: '2026-09-17 10:00:00' } },
    'POST /api/keynapse/bubbles/b1/reminders': { reminder: { at: '2026-09-20T09:00:00.000Z', label: body?.label ?? null } },
    'GET /api/sentinel/sites': { sites: [{ id: 's1', label: 'Mon site', url: 'https://www.monsite.fr' }] },
    'POST /api/sentinel/sites': { site: { id: 's9', url: body?.url, label: body?.label || null, platform: 'wix', last_ok: 1, last_ms: 210 } },
    'POST /api/sentinel/sites/s1/audit': { audit: { score: 81, scores: { seo: 80, securite: 60 }, pages: [1, 2, 3],
      findings: [{ axis: 'seo', sev: 'low', title: 'Titre court' }, { axis: 'securite', sev: 'high', title: 'HSTS absent', detail: 'Ajoutez Strict-Transport-Security.' }] } },
    'GET /api/network/bootstrap': { categories: [{ id: 'c1', label: 'Clients' }], contacts: [{ id: 'k1', name: 'Marie Dupont' }], activity: [] },
    'POST /api/network/contact': { contact: { id: 'k2', name: body?.name, kind: body?.kind, relance_at: body?.relance_at || null, relance_note: body?.relance_note || null } },
    'POST /api/network/activity': { activity: { id: 'a1', type: body?.type, label: body?.label, happened_at: '2026-09-17 10:00:00' } },
    'GET /api/desk/bootstrap': { publications: [{ id: 'p1', name: 'La Gazette' }] },
    'POST /api/desk/publication': { publication: { id: 'p2', name: body?.name } },
    'GET /api/smart-agent/agents': { agents: [{ id: 'ag1', name: 'Conseiller' }] },
    'POST /api/smart-agent/kortex/units': { unit: { id: 'u1', type: body?.type, title: body?.title, status: body?.status } },
    'GET /api/keybrand/charts': { items: [{ id: 'ch1', name: 'Existante' }], max: 30 },
    'POST /api/keybrand/charts': { chart: { id: 'ch2', name: body?.name } },
    'GET /api/qr': { qrs: [] },
    'POST /api/qr': { qr: { id: 'q9', name: body?.name, mode: body?.mode, target_url: body?.payload?.url, short_id: 'AbCdEfGh' } },
  };
  return map[k];
};
const dispatch = async (req) => {
  const u = new URL(req.url); const path = u.pathname; const method = req.method;
  let body = null; if (method === 'POST') { try { body = await req.clone().json(); } catch (_) { body = null; } }
  seen.push({ method, path, body, authz: req.headers.get('Authorization') });
  if (path === '/api/mcp/inbox' && method === 'POST') return handleMcpInboxDeposit(req, env);
  if (path === '/api/mcp/inbox' && method === 'GET')  return handleMcpInboxList(req, env);
  const r = canned(method, path, body);
  if (!r) return new Response(JSON.stringify({ error: `not found ${method} ${path}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const jwtAlice = await signJWT({ sub: 'sub-alice', plan: 'MAX', owner: 'Alice', email: 'alice@banc.test' }, env);
const jwtBob   = await signJWT({ sub: 'sub-bob', plan: 'PRO', owner: 'Bob', email: 'bob@banc.test' }, env);
const post = (body, token = jwtAlice, e = env) => handleMcp(new Request(`${API}/mcp`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), e, dispatch);
const call = async (name, args = {}, token = jwtAlice, e = env) => {
  const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token, e);
  const j = await r.json();
  return j.result || j.error;
};
const posts = (path) => seen.filter(s => s.method === 'POST' && s.path === path);
const reset = () => { seen.length = 0; };
const ledger = (tool) => DB._db.prepare('SELECT tool, ok, label FROM mcp_calls WHERE tool = ? ORDER BY ts DESC, rowid DESC LIMIT 1').get(tool);

console.log('\n▶ 1 · tools/list');
{
  const r = await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json();
  const tools = r.result.tools;
  const w = tools.filter(t => t.annotations.readOnlyHint === false);
  const expectedW = MCP_TOOLS.filter(t => t.write && !t.gate).length;
  yes(w.length === expectedW, `${w.length} outils d’écriture annoncés (readOnlyHint:false) = write hors gate (${expectedW})`);
  yes(tools.filter(t => t.annotations.readOnlyHint === true).length >= 32, 'les lectures restent lecture seule');
  yes(!tools.some(t => t.name === 'keystone_qr_create'), 'keystone_qr_create absent sans MCP_QR_CREATE');
  yes(mcpToolList({ MCP_QR_CREATE: 'on' }).some(t => t.name === 'keystone_qr_create'), '… présent avec MCP_QR_CREATE=on');
  const r2 = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).json();
  yes(/confirm_token/.test(r2.result.instructions) && /bannette/i.test(r2.result.instructions), 'instructions : confirmation et bannette expliquées');
}

console.log('\n▶ 2 · Écritures directes');
{
  reset();
  let r = await call('keystone_keynapse_create_note', { title: 'Réunion chantier', text: 'Compte rendu…', zone: 'chant', reminder_at: '2026-09-20T09:00:00Z', reminder_label: 'Relire' });
  yes(r.isError === false && r.structuredContent.fait === true, 'note Keynapse créée');
  eq(posts('/api/keynapse/bubbles')[0]?.body, { title: 'Réunion chantier', description: 'Compte rendu…', zone_id: 'z1' }, 'POST bubbles : titre, texte, zone résolue par nom partiel');
  eq(posts('/api/keynapse/bubbles/b1/reminders')[0]?.body, { at: '2026-09-20T09:00:00Z', label: 'Relire' }, 'POST reminders : rappel posé sur la nouvelle bulle');
  eq(r.structuredContent.zone, 'Chantiers', 'zone renvoyée'); eq(r.structuredContent.rappel.echeance, '2026-09-20T09:00:00.000Z', 'rappel renvoyé');
  eq(ledger('keystone_keynapse_create_note')?.label, 'Note « Réunion chantier » créée dans Keynapse', 'ledger : libellé d’activité consigné');
  reset();
  r = await call('keystone_keynapse_create_note', { title: 'X', zone: 'inexistante' });
  yes(r.isError && /Aucune? zone « inexistante »/.test(r.content[0].text) && posts('/api/keynapse/bubbles').length === 0, 'zone inconnue → refus AVANT d’écrire');

  reset();
  r = await call('keystone_sentinel_add_site', { url: 'monsite.fr' });
  yes(r.isError && posts('/api/sentinel/sites').length === 0, 'URL sans schéma → refus, rien d’écrit');
  r = await call('keystone_sentinel_add_site', { url: 'https://nouveau.fr', label: 'Nouveau', kind: 'online' });
  eq(posts('/api/sentinel/sites')[0]?.body, { url: 'https://nouveau.fr', label: 'Nouveau', kind: 'online' }, 'POST sites : url, label, nature');
  yes(r.structuredContent.fait && r.structuredContent.en_ligne === true, 'site ajouté, sonde relue');

  reset();
  r = await call('keystone_sentinel_run_audit', {});
  yes(r.isError === false && r.structuredContent.score === 81, 'audit lancé (site unique résolu seul), score rendu');
  eq(r.structuredContent.a_corriger[0].gravite, 'high', 'points à corriger triés par gravité');
  eq(r.structuredContent.pages_auditees, 3, 'pages auditées');
  eq(posts('/api/sentinel/sites/s1/audit').length, 1, 'un seul POST audit');

  reset();
  r = await call('keystone_network_add_contact', { name: 'marie dupont' });
  yes(r.isError && /existe déjà/.test(r.content[0].text) && posts('/api/network/contact').length === 0, 'contact en doublon (accents/casse ignorés) → refus sans écrire');
  r = await call('keystone_network_add_contact', { name: 'Paul Martin', kind: 'company', category: 'client', tags: ['vip'], relance_at: '2026-10-01', email: 'p@m.fr' });
  const cb = posts('/api/network/contact')[0]?.body;
  yes(cb && cb.category_id === 'c1' && cb.kind === 'company' && cb.email === 'p@m.fr' && cb.relance_at === '2026-10-01' && !('confirm_token' in cb), 'POST contact : catégorie résolue, champs relayés');
  eq(r.structuredContent.categorie, 'Clients', 'catégorie renvoyée');
  r = await call('keystone_network_log_activity', { contact: 'dupont', label: 'Appel de suivi', type: 'call' });
  eq(posts('/api/network/activity')[0]?.body, { contact_id: 'k1', label: 'Appel de suivi', type: 'call' }, 'POST activity : contact résolu par nom partiel');
  yes(r.structuredContent.fait && r.structuredContent.contact === 'Marie Dupont', 'interaction notée');
  r = await call('keystone_network_log_activity', { contact: 'inconnu', label: 'x' });
  yes(r.isError && /Aucun contact/.test(r.content[0].text), 'contact inconnu → refus lisible');

  reset();
  r = await call('keystone_desk_create_publication', { name: 'la gazette' });
  yes(r.isError && /existe déjà/.test(r.content[0].text), 'revue en doublon → refus');
  r = await call('keystone_desk_create_publication', { name: 'Le Bulletin' });
  eq(posts('/api/desk/publication')[0]?.body, { name: 'Le Bulletin' }, 'POST publication');
  yes(r.structuredContent.fait && r.structuredContent.id === 'p2', 'revue créée');
}

console.log('\n▶ 3 · Confirmation (aperçu → jeton → exécution unique)');
{
  reset();
  const args = { agent: 'conseil', type: 'qa', title: 'Horaires', body: { question: 'Horaires ?', answer: '9h-18h' } };
  let r = await call('keystone_smartagent_kortex_add_unit', args);
  const sc = r.structuredContent;
  yes(r.isError === false && sc.confirmation_requise === true && /^kcf_/.test(sc.confirm_token), 'sans jeton → aperçu + confirm_token');
  yes(sc.apercu.jumeau === 'Conseiller' && sc.apercu.statut === 'draft', 'aperçu : jumeau résolu, statut brouillon par défaut');
  eq(posts('/api/smart-agent/kortex/units').length, 0, 'AUCUN POST à l’aperçu');
  eq(ledger('keystone_smartagent_kortex_add_unit')?.label ?? null, null, 'ledger : pas d’activité pour un aperçu');
  const token = sc.confirm_token;

  r = await call('keystone_smartagent_kortex_add_unit', { ...args, title: 'Horaires (modifié)', confirm_token: token });
  yes(r.isError && /arguments ont changé/.test(r.content[0].text) && posts('/api/smart-agent/kortex/units').length === 0, 'arguments changés → refus, rien d’écrit');
  r = await call('keystone_smartagent_kortex_add_unit', { ...args, confirm_token: token }, jwtBob);
  yes(r.isError && /autre compte/.test(r.content[0].text), 'jeton d’un autre compte → refus');
  r = await call('keystone_keybrand_create_chart', { name: 'Marque', confirm_token: token });
  yes(r.isError && /autre outil/.test(r.content[0].text), 'jeton d’un autre outil → refus');
  r = await call('keystone_smartagent_kortex_add_unit', { ...args, confirm_token: 'kcf_inconnu_inconnu_inconnu' });
  yes(r.isError && /inconnu/.test(r.content[0].text), 'jeton inconnu → refus');

  r = await call('keystone_smartagent_kortex_add_unit', { body: args.body, title: args.title, type: 'qa', agent: 'conseil', confirm_token: token });
  yes(r.isError === false && r.structuredContent.fait === true, 'jeton valable, arguments identiques (ordre des clés différent) → exécuté');
  const ub = posts('/api/smart-agent/kortex/units')[0]?.body;
  yes(ub && ub.agent_id === 'ag1' && ub.type === 'qa' && ub.status === 'draft' && ub.source_ref === 'assistant (MCP)', 'POST units : agent, type, brouillon, provenance');
  eq(ledger('keystone_smartagent_kortex_add_unit')?.label, 'Fiche « Horaires » ajoutée au jumeau Conseiller', 'ledger : activité consignée à l’exécution');
  r = await call('keystone_smartagent_kortex_add_unit', { ...args, confirm_token: token });
  yes(r.isError && /déjà utilisé/.test(r.content[0].text) && posts('/api/smart-agent/kortex/units').length === 1, 'rejeu → refus, une seule écriture');

  r = await call('keystone_smartagent_kortex_add_unit', { ...args, type: 'poeme' });
  yes(r.isError && /Type inconnu/.test(r.content[0].text), 'type inconnu → refus avant aperçu');

  /* périmé */
  r = await call('keystone_keybrand_create_chart', { name: 'Marque', baseline: 'Bâtir juste' });
  const t2 = r.structuredContent.confirm_token;
  yes(/^kcf_/.test(t2) && r.structuredContent.apercu.place_restante === 29, 'charte : aperçu avec place restante');
  DB._db.prepare("UPDATE mcp_confirmations SET expires_at = datetime('now', '-1 minute')").run();
  r = await call('keystone_keybrand_create_chart', { name: 'Marque', baseline: 'Bâtir juste', confirm_token: t2 });
  yes(r.isError && /périmé/.test(r.content[0].text) && posts('/api/keybrand/charts').length === 0, 'aperçu périmé → refus, rien d’écrit');
  r = await call('keystone_keybrand_create_chart', { name: 'Marque', baseline: 'Bâtir juste' });
  r = await call('keystone_keybrand_create_chart', { name: 'Marque', baseline: 'Bâtir juste', confirm_token: r.structuredContent.confirm_token });
  eq(posts('/api/keybrand/charts')[0]?.body, { name: 'Marque', draft: { meta: { name: 'Marque', baseline: 'Bâtir juste' } } }, 'POST charts : nom + baseline');
  yes(r.structuredContent.fait && r.structuredContent.statut === 'brouillon', 'charte créée');
  r = await call('keystone_keybrand_create_chart', { name: 'existante' });
  yes(r.isError && /existe déjà/.test(r.content[0].text), 'charte en doublon → refus');

  /* QR : hors catalogue, puis gaté */
  reset();
  r = await call('keystone_qr_create', { name: 'Vitrine', url: 'https://ex.fr' });
  yes(r.code === -32602 && /inconnu/.test(r.message), 'keystone_qr_create : « outil inconnu » sans la variable');
  const envQr = { ...env, MCP_QR_CREATE: 'on' };
  r = await call('keystone_qr_create', { name: 'Vitrine', url: 'https://ex.fr' }, jwtAlice, envQr);
  yes(r.structuredContent?.confirmation_requise && posts('/api/qr').length === 0, 'avec la variable : aperçu, rien d’écrit');
  r = await call('keystone_qr_create', { name: 'Vitrine', url: 'https://ex.fr', confirm_token: r.structuredContent.confirm_token }, jwtAlice, envQr);
  eq(posts('/api/qr')[0]?.body, { name: 'Vitrine', type: 'url', mode: 'dynamic', payload: { url: 'https://ex.fr' }, tags: [] }, 'POST /api/qr : création URL dynamique');
  yes(r.structuredContent.fait && r.structuredContent.short_id === 'AbCdEfGh', 'QR créé');
}

console.log('\n▶ 4 · Quota d’audits');
{
  reset();
  let refused = null;
  for (let i = 0; i < 12; i++) { const r = await call('keystone_sentinel_run_audit', {}); if (r.isError) { refused = { i, text: r.content[0].text }; break; } }
  yes(refused && refused.i === 9 && /Plafond atteint : 10 audits/.test(refused.text), '11e audit du jour refusé (1 déjà fait en §2 + 9 ici = 10)', JSON.stringify(refused));
  eq(posts('/api/sentinel/sites/s1/audit').length, 9, '9 POST audit émis, pas plus');
}

console.log('\n▶ 5 · Bannette');
{
  reset();
  let r = await call('keystone_social_draft_post', { text: 'Portes ouvertes samedi !', networks: ['Facebook', 'x', 'threads'] });
  const sc = r.structuredContent;
  yes(r.isError === false && sc.depose === true && /^kbn_/.test(sc.id), 'post déposé dans la bannette');
  eq(sc.reseaux, ['facebook', 'threads'], 'réseaux filtrés/normalisés');
  const row = DB._db.prepare('SELECT sub, pad, kind, payload_json, summary, created_by_tool, status FROM mcp_inbox WHERE id = ?').get(sc.id);
  yes(row && row.sub === 'sub-alice' && row.pad === 'O-SOC-001' && row.kind === 'compose' && row.status === 'pending', 'ligne mcp_inbox : sub de l’appelant, pad, kind');
  eq(JSON.parse(row.payload_json), { text: 'Portes ouvertes samedi !', targets: ['facebook', 'threads'], append: false }, 'payload = opts.compose tel que openTool le recevra');
  eq(row.created_by_tool, 'keystone_social_draft_post', 'outil d’origine consigné');
  yes(posts('/api/mcp/inbox')[0]?.authz === `Bearer ${jwtAlice}`, 'dépôt fait avec le JWT de l’appel');
  r = await call('keystone_ghostwriter_prepare_text', { text: 'Bonjour, suite à notre échange…' });
  yes(r.structuredContent.depose && r.structuredContent.application === 'Ghost Writer', 'texte Ghost Writer déposé');
  r = await call('keystone_brainstorming_seed_session', { brief: 'Nom du prochain programme' });
  yes(r.structuredContent.depose && r.structuredContent.application === 'Brainstorming', 'brief Brainstorming déposé');
  r = await call('keystone_bannette_status', {});
  eq(r.structuredContent.en_attente, 3, 'keystone_bannette_status : 3 propositions en attente');
  eq(r.structuredContent.propositions[0].application, 'Social Manager', '… avec le nom lisible du pad');
  r = await call('keystone_bannette_status', {}, jwtBob);
  eq(r.structuredContent.en_attente, 0, 'Bob ne voit pas la bannette d’Alice');
  r = await call('keystone_social_draft_post', { text: '   ' });
  yes(r.isError, 'texte vide → refus');
}

console.log('\n▶ 6 · Portée OAuth : keystone.read seul n’écrit pas');
{
  const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const CB = 'https://claude.ai/api/mcp/auth_callback';
  const req = (path, init = {}) => new Request(API + path, init);
  const postJson = (path, body, headers = {}) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const postForm = (path, obj) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj).toString() });
  const client = await (await handleOauthRegister(postJson('/oauth/register', { client_name: 'Claude', redirect_uris: [CB], token_endpoint_auth_method: 'none' }), env)).json();
  const tokenFor = async (scope) => {
    const verifier = b64u(randomBytes(48)); const challenge = b64u(createHash('sha256').update(verifier).digest());
    const az = await handleOauthAuthorize(req(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(CB)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=s&scope=${encodeURIComponent(scope)}`), env);
    const reqId = new URL(az.headers.get('Location')).searchParams.get('req');
    const ap = await (await handleOauthApprove(postJson('/oauth/approve', { req: reqId, decision: 'allow' }, { Authorization: `Bearer ${jwtAlice}` }), env)).json();
    const code = decodeURIComponent((JSON.stringify(ap).match(/code=([^&"]+)/) || [])[1] || '');
    const t = await (await handleOauthToken(postForm('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CB, client_id: client.client_id }), env)).json();
    return t.access_token;
  };
  const ro = await tokenFor('keystone.read');
  const rw = await tokenFor('keystone.read keystone.write');
  yes(ro && rw, 'deux jetons OAuth émis (lecture seule, lecture+écriture)');
  reset();
  let r = await call('keystone_sentinel_sites', {}, ro);
  yes(r.isError === false && r.structuredContent.total === 1, 'lecture seule : lit');
  r = await call('keystone_keynapse_create_note', { title: 'Interdit' }, ro);
  yes(r.isError && /keystone\.write/.test(r.content[0].text) && posts('/api/keynapse/bubbles').length === 0, 'lecture seule : n’écrit pas, message de portée');
  r = await call('keystone_keynapse_create_note', { title: 'Permis' }, rw);
  yes(r.isError === false && r.structuredContent.fait, 'lecture+écriture : écrit');
  yes(/^Bearer eyJ/.test(posts('/api/keynapse/bubbles')[0]?.authz || ''), '… via le JWT interne (jamais le jeton OAuth relayé aux routes)');
  /* confirmation liée à la connexion OAuth */
  r = await call('keystone_keybrand_create_chart', { name: 'Liée' }, rw);
  const tk = r.structuredContent.confirm_token;
  r = await call('keystone_keybrand_create_chart', { name: 'Liée', confirm_token: tk }, jwtAlice);
  yes(r.isError === false && r.structuredContent.fait, 'jeton émis sous OAuth accepté par le même compte via JWT (connexion non contredite)');
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m`);
process.exit(fail ? 1 : 0);
