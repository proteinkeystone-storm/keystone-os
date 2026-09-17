/* ═══════════════════════════════════════════════════════════════
   Banc — Sonde MCP Apps (S7) : une interface DANS la conversation
   ───────────────────────────────────────────────────────────────
   Vrai handleMcp, D1 simulée, licence en SQLite. Ce que ce banc PROUVE :
     1. GATE : sans MCP_APPS='on', l'outil et la ressource n'existent pas
        (catalogue inchangé, resources/list inchangée, lecture refusée).
     2. OUTIL : lecture seule, une seule route en GET, `_meta.ui` sur LUI
        SEUL, chiffres justes, repli TEXTE lisible (un client sans
        l'extension reste servi), période validée, classement borné à 5.
     3. PAGE : autonome pour de vrai — aucun réseau (la CSP de l'hôte
        l'interdit), aucune URL externe hors « Ouvrir dans Keystone »,
        aucun innerHTML, et les messages du protocole UI présents.
   Le rendu visuel, lui, se vérifie avec le faux hôte de
   `_MOCKUPS/sonde-mcp-apps/` (hors dépôt) : iframe + poignée de main.
   Lancement : node scripts/test-mcp-apps.mjs
   ═══════════════════════════════════════════════════════════════ */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { signJWT } from '../workers/src/lib/jwt.js';
import { handleMcp } from '../workers/src/routes/mcp.js';
import { mcpToolList } from '../workers/src/lib/mcp-tools.js';
import { appsEnabled, appsResources, appsResourceRead, APPS_UI_URI, APPS_UI_MIME, APPS_APP_URL, QR_CARD_HTML } from '../workers/src/lib/mcp-apps.js';

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
DB._db.exec(readFileSync(new URL('../workers/migrations/015_mcp_oauth.sql', import.meta.url), 'utf8'));
DB._db.exec(readFileSync(new URL('../workers/migrations/016_mcp_writes.sql', import.meta.url), 'utf8'));
DB._db.exec(`CREATE TABLE licences (key TEXT PRIMARY KEY, tenant_id TEXT DEFAULT 'default', owner TEXT, plan TEXT, is_active INTEGER DEFAULT 1, owned_assets TEXT, expires_at TEXT, lookup_hmac TEXT);
             INSERT INTO licences (key, owner, plan, lookup_hmac, owned_assets) VALUES ('BANC-1', 'Alice', 'PRO', 'sub-alice', '["A-COM-001"]');`);

const envOff = { KS_JWT_SECRET: 'jwt-secret-du-banc-32-octets-minimum-0123456789', KS_ALLOWED_ORIGIN: 'https://front.test', DB };
const envOn  = { ...envOff, MCP_APPS: 'on' };
const API = 'https://api.test';
const jwt = await signJWT({ sub: 'sub-alice', plan: 'PRO', owner: 'Alice' }, envOff);
const today = new Date().toISOString().slice(0, 10);

/* /api/qr/overview simulé — 7 QR au classement pour vérifier la coupe à 5 */
const OVERVIEW = {
  totals: { scans_total: 483, unique: 312, qr_total: 14, qr_active: 14, week: 37 },
  byDay: [{ day: '2026-01-01', cnt: 99 }, { day: today, cnt: 6 }],
  leaderboard: [
    { name: "Bel'Arti", scans: 320, trend: 'up' }, { name: 'Portail Marron', scans: 30, trend: 'flat' },
    { name: 'Six-Fours', scans: 23, trend: 'down' }, { name: 'M.I.C.E.', scans: 6, trend: 'flat' },
    { name: 'Golden Ticket', scans: 2, trend: 'flat' }, { name: 'le-chene', scans: 1, trend: 'flat' },
    { name: 'les-cypres', scans: 0, trend: 'flat' },
  ],
  watch: [{ name: 'les-cypres', note: 'aucun scan depuis 30 jours' }],
};
const seen = [];
const dispatch = async (rq) => {
  const u = new URL(rq.url); seen.push({ method: rq.method, path: u.pathname, q: u.search });
  if (u.pathname === '/api/qr/overview') return new Response(JSON.stringify(OVERVIEW), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
};
const rpc = async (method, params, env = envOn) => {
  const r = await handleMcp(new Request(`${API}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || {} }) }), env, dispatch);
  return r.json();
};
const call = async (args, env = envOn) => (await rpc('tools/call', { name: 'keystone_qr_card', arguments: args || {} }, env)).result;

console.log('\n▶ 1 · Le bouton d’annulation (gate MCP_APPS)');
{
  yes(appsEnabled({ MCP_APPS: 'on' }) && appsEnabled({ MCP_APPS: 'ON' }), 'MCP_APPS « on » / « ON » → sonde allumée');
  yes(!appsEnabled({}) && !appsEnabled({ MCP_APPS: 'true' }) && !appsEnabled({ MCP_APPS: 'off' }), 'absente, « true » ou « off » → éteinte (rien d’autre qu’« on »)');
  const off = mcpToolList(envOff), on = mcpToolList(envOn);
  yes(!off.some(t => t.name === 'keystone_qr_card'), 'éteinte : l’outil n’est pas au catalogue');
  eq(on.length, off.length + 1, 'allumée : exactement un outil de plus');
  eq(appsResources(envOff), [], 'éteinte : aucune ressource ajoutée');
  eq(appsResourceRead(APPS_UI_URI, envOff), null, 'éteinte : la page n’est pas servie');
  const r = await rpc('resources/read', { uri: APPS_UI_URI }, envOff);
  yes(r.error && r.error.code === -32002, 'éteinte : resources/read → ressource inconnue (-32002)');
  const c = await rpc('tools/call', { name: 'keystone_qr_card', arguments: {} }, envOff);
  yes(c.error && /Outil inconnu/.test(c.error.message) && c.result === undefined, 'éteinte : tools/call → erreur « outil inconnu », rien d’exécuté');
  eq(appsResourceRead('ui://keystone/autre-chose', envOn), null, 'allumée : une autre URI ui:// n’est pas servie');
}

console.log('\n▶ 2 · L’outil : lecture seule, `_meta` sur lui seul, repli texte');
{
  const tools = mcpToolList(envOn);
  const t = tools.find(x => x.name === 'keystone_qr_card');
  yes(t && t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false, 'annoncé en lecture seule, non destructif');
  eq(t._meta, { ui: { resourceUri: APPS_UI_URI, prefersBorder: true } }, '`_meta.ui.resourceUri` désigne la page');
  eq(tools.filter(x => x._meta).map(x => x.name), ['keystone_qr_card'], 'aucun autre outil ne porte `_meta`');
  yes(!t.inputSchema.required || t.inputSchema.required.length === 0, 'aucun paramètre obligatoire');

  seen.length = 0;
  const r = await call({});
  const d = r.structuredContent;
  yes(r.isError === false && d.vue === 'carte_qr', 'appel simple → vue carte_qr');
  eq([d.periode, d.scans, d.visiteurs_uniques, d.qr_total, d.qr_actifs, d.aujourdhui, d.cette_semaine],
     ['7d', 483, 312, 14, 14, 6, 37], 'chiffres justes (dont « aujourd’hui » pris sur la bonne journée)');
  eq(d.classement.length, 5, 'classement borné à 5');
  eq(d.classement[0], { nom: "Bel'Arti", scans: 320, tendance: 'en hausse' }, 'tendances traduites');
  eq(d.classement[2].tendance, 'en baisse', '… « down » → « en baisse »');
  eq(d.a_surveiller, ['les-cypres : aucun scan depuis 30 jours'], 'points à surveiller en une phrase');
  eq(d.ouvrir, APPS_APP_URL, 'adresse « Ouvrir dans Keystone » fournie');
  yes(!isNaN(Date.parse(d.mesure_le)), 'horodatage ISO de la mesure');
  eq(JSON.parse(r.content[0].text), d, 'repli TEXTE = le même JSON (client sans interface servi quand même)');
  eq(seen.map(s => s.method + ' ' + s.path), ['GET /api/qr/overview'], 'une seule requête interne, en GET');

  seen.length = 0;
  const bad = await call({ period: 'bidon' });
  eq(bad.structuredContent.periode, '7d', 'période inconnue → 7d');
  await call({ period: '30d' });
  yes(seen.some(s => s.q === '?period=30d'), 'période valide transmise telle quelle');
  yes(seen.every(s => s.method === 'GET'), 'toujours aucune écriture');
}

console.log('\n▶ 3 · La page : autonome, sans réseau, sans balisage injectable');
{
  const list = (await rpc('resources/list')).result.resources;
  const ui = list.find(x => x.uri === APPS_UI_URI);
  yes(ui && ui.mimeType === APPS_UI_MIME, `resources/list annonce la page en ${APPS_UI_MIME}`);
  yes(list.some(x => x.uri !== APPS_UI_URI) || list.length === 1, 'les recettes de pads restent listées à côté');

  const read = (await rpc('resources/read', { uri: APPS_UI_URI })).result;
  const c = read.contents[0];
  yes(c.mimeType === APPS_UI_MIME && c.text.startsWith('<!doctype html>'), 'resources/read rend la page HTML');
  yes(c._meta && c._meta.ui && c._meta.ui.prefersBorder === true, '`prefersBorder` demandé à l’hôte');
  yes(c.text === QR_CARD_HTML && c.text.length < 24576, `page < 24 Ko (${c.text.length} octets)`);

  const interdits = ['<script src', '<link', '@import', 'url(http', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'import(', 'innerHTML', 'document.write', 'eval('];
  eq(interdits.filter(x => QR_CARD_HTML.includes(x)), [], 'aucun réseau, aucun innerHTML, aucun eval (la CSP de l’hôte l’interdit)');
  const urls = [...new Set((QR_CARD_HTML.match(/https?:\/\/[^\s"'<>)]+/g) || []))];
  eq(urls, [APPS_APP_URL], 'une seule adresse citée : « Ouvrir dans Keystone »');
  const messages = ['ui/initialize', 'ui/notifications/initialized', 'ui/notifications/tool-input', 'ui/notifications/tool-result', 'ui/notifications/size-changed', 'ui/open-link', 'tools/call'];
  eq(messages.filter(m => !QR_CARD_HTML.includes(m)), [], 'tous les messages du protocole UI présents');
  yes(/e\.source !== parent/.test(QR_CARD_HTML), 'seuls les messages de l’hôte sont écoutés');
  yes(/textContent/.test(QR_CARD_HTML) && /createElement/.test(QR_CARD_HTML), 'DOM construit par createElement/textContent');
  yes(/data-theme/.test(QR_CARD_HTML) && /hostContext/.test(QR_CARD_HTML), 'thème clair/sombre suivi depuis l’hôte');
  yes(/-apple-system/.test(QR_CARD_HTML) && /letter-spacing:-\.02em/.test(QR_CARD_HTML) && /font-weight:900/.test(QR_CARD_HTML), 'charte Apple Premium : font-stack native, -.02em, 900 sur les titres');
  yes(/minmax\(118px,1fr\)/.test(QR_CARD_HTML), 'tuiles en grille fluide (lisible à 372 px, vérifié au faux hôte)');
}

console.log(`\n${pass + fail} vérifications — ${pass} \x1b[32mok\x1b[0m, ${fail} ${fail ? '\x1b[31mko\x1b[0m' : 'ko'}\n`);
process.exit(fail ? 1 : 0);
