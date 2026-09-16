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

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));

const FORBIDDEN_NAME = /(delete|remove|purge|publish|schedule|licen|billing|stripe|admin|sceau|missive|redirect|send|email_inject|revoke)/i;
const FORBIDDEN_PATH = /^\/api\/(admin|licence|billing|stripe|sceau|auth|device|keys|vault)|\/publish$|\/delete$|\/cancel$|\/retry$|\/redirect|\/email-inject|\/revoke/;
const ALLOWED_NON_GET = new Set(['POST /api/livinglayer/board']);

console.log('\n▶ 1 · Noms');
yes(!MCP_TOOLS.some(t => FORBIDDEN_NAME.test(t.name)), 'aucun nom d’outil ne porte un verbe interdit',
  MCP_TOOLS.filter(t => FORBIDDEN_NAME.test(t.name)).map(t => t.name).join(', '));

console.log('\n▶ 2 · Routes déclarées');
for (const t of MCP_TOOLS) {
  yes(Array.isArray(t.routes) && t.routes.length > 0, `${t.name} déclare ses routes`);
  for (const r of t.routes) {
    const sig = `${r.method} ${r.path}`;
    yes(r.method === 'GET' || ALLOWED_NON_GET.has(sig), `${t.name} · ${sig} est une lecture`, 'écriture non autorisée au sprint 1');
    yes(!FORBIDDEN_PATH.test(r.path), `${t.name} · ${sig} hors périmètre interdit`);
  }
}

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
  if (path.startsWith('/api/ghostwriter')) return { used: 0, max: 0 };
  if (path.startsWith('/api/catalog')) return { catalog: { pads: [] } };
  return {};
};
for (const t of MCP_TOOLS) {
  const emitted = [];
  const ctx = {
    claims: { sub: 'x', plan: 'MAX' },
    call: async (path, { method = 'GET' } = {}) => { emitted.push({ method, path }); return emptyFor(path); },
  };
  const args = {};
  for (const r of (t.inputSchema.required || [])) args[r] = 'xx';
  try { await t.run(ctx, args); } catch (_) { /* « aucun … » attendu sur des données vides */ }
  const undeclared = emitted.filter(e => !t.routes.some(d => d.method === e.method && matches(d.path, e.path)));
  yes(undeclared.length === 0, `${t.name} n’émet que ses routes déclarées`, JSON.stringify(undeclared));
  yes(!emitted.some(e => e.method !== 'GET' && !ALLOWED_NON_GET.has(`${e.method} ${e.path.split('?')[0]}`)), `${t.name} n’émet aucune écriture`);
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? '\x1b[31m' : ''}${fail} ko\x1b[0m`);
process.exit(fail ? 1 : 0);
