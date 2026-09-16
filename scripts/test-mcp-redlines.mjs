/* ═══════════════════════════════════════════════════════════════
   Banc — Lignes rouges du serveur MCP (HANDOFF_MCP_CLAUDE §1)
   ───────────────────────────────────────────────────────────────
   Ce que ce banc PROUVE, statiquement ET dynamiquement :
     1. Aucun outil ne porte un verbe interdit (supprimer, publier,
        licence, facturation, admin, Sceau/Missive, redirection).
     2. Les routes DÉCLARÉES par chaque outil sont des GET, sauf le
        board Living Layer (POST de calcul, sans effet de bord).
     3. Aucune route déclarée ne touche /api/admin, /api/licence,
        /api/billing, /api/stripe, /api/sceau, /api/social/publish,
        /api/qr/…/redirect, ni une écriture Key Form.
     4. À l'EXÉCUTION (routeur simulé qui répond vide), chaque outil
        n'émet que les méthodes/routes qu'il déclare — la déclaration
        n'est pas décorative.
     5. Le tenant n'est jamais un paramètre : aucun outil n'accepte
        tenant / tenantId / sub / owner en entrée.
   Lancement : node scripts/test-mcp-redlines.mjs
   ═══════════════════════════════════════════════════════════════ */
import { MCP_TOOLS } from '../workers/src/lib/mcp-tools.js';
import { BRIDGE_ACTIONS } from '../app/bridge-actions.js';

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));

const FORBIDDEN_NAME = /(delete|remove|purge|publish|schedule|licen|billing|stripe|admin|sceau|missive|redirect|send|email_inject|revoke)/i;
const FORBIDDEN_PATH = /^\/api\/(admin|licence|billing|stripe|sceau|auth|device|keys|vault)|\/publish$|\/delete$|\/cancel$|\/retry$|\/redirect|\/email-inject|\/revoke/;
const ALLOWED_NON_GET = new Set(['POST /api/livinglayer/board', 'GET /api/mcp/inbox']);
/* Sprint 3 : un outil write:true peut émettre des POST — UNIQUEMENT ceux
   qu'il déclare, jamais PUT/PATCH/DELETE, jamais hors périmètre. Un outil
   bannette:true ne déclare que le dépôt. */
const WRITE_OK = (t, r) => t.write === true && r.method === 'POST';

console.log('\n▶ 1 · Noms');
yes(!MCP_TOOLS.some(t => FORBIDDEN_NAME.test(t.name)), 'aucun nom d’outil ne porte un verbe interdit',
  MCP_TOOLS.filter(t => FORBIDDEN_NAME.test(t.name)).map(t => t.name).join(', '));

console.log('\n▶ 2 · Routes déclarées');
for (const t of MCP_TOOLS) {
  yes(Array.isArray(t.routes) && (t.routes.length > 0 || t.exec === 'browser'), `${t.name} déclare ses routes${t.exec === 'browser' ? ' (aucune : délégué à l’onglet)' : ''}`);
  for (const r of t.routes) {
    const sig = `${r.method} ${r.path}`;
    yes(r.method === 'GET' || ALLOWED_NON_GET.has(sig) || WRITE_OK(t, r), `${t.name} · ${sig} est une lecture${t.write ? ' ou un POST déclaré' : ''}`, 'écriture non autorisée');
    yes(!/^(PUT|PATCH|DELETE)$/.test(r.method), `${t.name} · ${sig} n’est ni PUT, ni PATCH, ni DELETE`);
    if (t.bannette) yes(sig === 'POST /api/mcp/inbox' || r.method === 'GET', `${t.name} (bannette) ne déclare que des lectures et le dépôt`);
    yes(!FORBIDDEN_PATH.test(r.path), `${t.name} · ${sig} hors périmètre interdit`);
  }
}

console.log('\n▶ 2 bis · Écritures : contrat de forme');
for (const t of MCP_TOOLS.filter(x => x.write)) {
  const props = Object.keys((t.inputSchema && t.inputSchema.properties) || {});
  if (t.confirm) yes(props.includes('confirm_token'), `${t.name} (à confirmation) expose confirm_token`);
  else yes(!props.includes('confirm_token'), `${t.name} (directe) n’expose pas confirm_token`);
  yes(!/(update|edit|modify|patch|rename|move|publish)/i.test(t.name), `${t.name} est une création, pas une modification`);
}
yes(MCP_TOOLS.some(t => t.name === 'keystone_qr_create' && t.gate === 'MCP_QR_CREATE' && t.confirm), 'keystone_qr_create : gaté par MCP_QR_CREATE et à confirmation');

console.log('\n▶ 2 ter · Pont : chaque outil navigateur cible une action du catalogue de l’onglet');
for (const t of MCP_TOOLS.filter(x => x.exec === 'browser')) {
  const a = BRIDGE_ACTIONS.find(x => x.id === t.action);
  yes(!!a, `${t.name} → ${t.action} existe dans app/bridge-actions.js`);
  if (a) {
    yes(a.mode === 'read' ? !t.write : t.write === true, `${t.name} : mode ${a.mode} cohérent avec write:${!!t.write}`);
    yes(!t.routes.some(r => r.method !== 'GET' && !(r.method === 'POST' && r.path === '/api/mcp/inbox')), `${t.name} : aucune écriture serveur hors dépôt bannette`);
  }
  if (t.bannette) yes(['sm.compose_draft', 'gw.rewrite_text', 'bs.start_session', 'os.prefill_form'].includes(t.action), `${t.name} (bannette) : action d’écriture navigateur connue`);
}
yes(!BRIDGE_ACTIONS.some(a => /(delete|remove|purge|publish|schedule)/i.test(a.id)), 'le catalogue de l’onglet ne contient ni suppression ni publication');

console.log('\n▶ 3 · Pas de tenant en entrée');
for (const t of MCP_TOOLS) {
  const props = Object.keys((t.inputSchema && t.inputSchema.properties) || {});
  yes(!props.some(p => /tenant|sub$|owner|licen/i.test(p)), `${t.name} n’accepte aucun paramètre de tenant`, props.join(', '));
}

console.log('\n▶ 4 · À l’exécution, chaque outil n’émet que ce qu’il déclare');
const matches = (declared, actualPath) => {
  const re = new RegExp('^' + declared.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:id/g, '[^/?]+') + '(\\?.*)?$');
  return re.test(actualPath);
};
/* Routeur simulé : renvoie des structures VIDES mais typées pour que chaque
   outil traverse son chemin nominal (ou échoue proprement sur « aucun … »). */
const emptyFor = (path) => {
  if (path.startsWith('/api/qr')) return { qrs: [], totals: {}, byDay: [], leaderboard: [], watch: [] };
  if (path.startsWith('/api/sentinel')) return { sites: [], cockpit: { site: {}, audit: null } };
  if (path.startsWith('/api/keynapse')) return { zones: [], bubbles: [], reminders: [], bubble: {}, todos: [] };
  if (path.startsWith('/api/smart-agent')) return { agents: [], gaps: [], units: [], counts: { total: 0 }, links: [], results: [] };
  if (path.startsWith('/api/desk')) return { publications: [], articles: [], slots: [], pages: [], inbox: [] };
  if (path.startsWith('/api/social')) return { posts: [], accounts: [], platforms: [], insights: [] };
  if (path.startsWith('/api/pulsa')) return { forms: [], responses: [], count: 0 };
  if (path.startsWith('/api/keybrand')) return { items: [], max: 30, chart: { draft: {} } };
  if (path.startsWith('/api/network')) return { categories: [], contacts: [], activity: [] };
  if (path.startsWith('/api/livinglayer')) return { metrics: {} };
  if (path.startsWith('/api/mcp/inbox')) return { ok: true, id: 'kbn_x', expires_at: '2026-10-17T00:00:00Z', pending: 1, items: [] };
  if (path.startsWith('/api/ghostwriter')) return { used: 0, max: 0 };
  if (path.startsWith('/api/catalog')) return { catalog: { pads: [] } };
  return {};
};
for (const t of MCP_TOOLS) {
  const emitted = [];
  const ctx = {
    claims: { sub: 'x', plan: 'MAX' }, tool: t.name,
    call: async (path, { method = 'GET' } = {}) => { emitted.push({ method, path }); return emptyFor(path); },
    /* sprint 3 : sans confirm_token, ctx.confirm rend l'aperçu → l'outil s'arrête AVANT d'écrire */
    confirm: async () => ({ confirmation_requise: true }),
    quota: async () => {},
    /* sprint 4 : onglet absent → repli (bannette) ou erreur, jamais de route serveur */
    bridge: async (action, args, { fallback } = {}) => (fallback ? fallback('offline') : null),
  };
  const args = {};
  for (const r of (t.inputSchema.required || [])) args[r] = 'xx';
  try { await t.run(ctx, args); } catch (_) { /* « aucun … » attendu sur des données vides */ }
  const undeclared = emitted.filter(e => !t.routes.some(d => d.method === e.method && matches(d.path, e.path)));
  yes(undeclared.length === 0, `${t.name} n’émet que ses routes déclarées`, JSON.stringify(undeclared));
  if (t.write) {
    yes(!emitted.some(e => /^(PUT|PATCH|DELETE)$/.test(e.method)), `${t.name} n’émet ni PUT, ni PATCH, ni DELETE`);
    if (t.confirm) yes(!emitted.some(e => e.method === 'POST'), `${t.name} (à confirmation) n’écrit RIEN sans confirm_token`);
  } else {
    yes(!emitted.some(e => e.method !== 'GET' && !ALLOWED_NON_GET.has(`${e.method} ${e.path.split('?')[0]}`)), `${t.name} n’émet aucune écriture`);
  }
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m`);
process.exit(fail ? 1 : 0);
