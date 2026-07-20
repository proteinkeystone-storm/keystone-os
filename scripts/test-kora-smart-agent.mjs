#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test actions Kora × Smart Agent (sa.*, K-8 20/07/2026)

   Teste, SANS réseau ni JWT (fetch + localStorage/document mockés) :
     - sa.list_agents : façonnage (statut FR, mission en extrait, trous
       ouverts/semaine déjà attachés par le worker) ;
     - _saResolve via sa.gaps : plusieurs jumeaux sans référence → erreur
       qui LISTE, un seul jumeau se résout tout seul (comme Sentinel),
       match exact/partiel insensible aux accents, ambigu → candidats,
       introuvable → message honnête ;
     - sa.gaps : « récent » calculé sur les 7 derniers jours (vrai
       Date.now(), pas figé), plafond 10 ;
     - sa.kortex_overview : compteurs de statut (GROUP BY exact) + tally
       par type sur la page reçue, coffre vide → message ;
     - sa.public_usage : lien actif → usage restitué, publié sans lien
       actif → message, jumeau non publié → AUCUN appel réseau vers /links ;
     - gating MAX : le message d'erreur du worker (403) traverse tel quel.

   Usage : node scripts/test-kora-smart-agent.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else      { failed++; console.error(`  \x1b[31m✗\x1b[0m ${name}`); }
}

/* ── Mocks (module inerte : localStorage/document lus à l'exécution) ── */
globalThis.localStorage = { getItem: (k) => (k === 'ks_jwt' ? 'jwt-de-test' : null), setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };

/* dates SQLite-style (UTC, sans T/Z) relatives à MAINTENANT — un « récent »
   figé en dur se périmerait au premier test lancé plus de 7 j après l'écriture */
const sqlAgo = (days) => new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19).replace('T', ' ');

const AGENTS_FIXTURE = { agents: [
  { id: 'agent-1', name: 'Conseiller Keystone', status: 'published',
    config: { identity: { mission: 'Présenter Keystone aux visiteurs du site vitrine et répondre aux questions produit.' } },
    gaps_open: 3, gaps_week: 1 },
  { id: 'agent-2', name: 'Support Boutique', status: 'draft', config: {}, gaps_open: 0, gaps_week: 0 },
  { id: 'agent-3', name: 'Démo Retraite', status: 'published', config: {}, gaps_open: 0, gaps_week: 0 },
  { id: 'agent-4', name: 'Support Général', status: 'draft', config: {}, gaps_open: 0, gaps_week: 0 },
] };

const GAPS_A1 = { gaps: [
  { id: 'g1', question: 'Peut-on payer en plusieurs fois ?', hits: 5, agent_id: 'agent-1',
    first_asked_at: sqlAgo(40), last_asked_at: sqlAgo(2) },   // récent (< 7 j)
  { id: 'g2', question: 'Livrez-vous à l’étranger ?', hits: 2, agent_id: 'agent-1',
    first_asked_at: sqlAgo(90), last_asked_at: sqlAgo(30) },  // pas récent
] };

const KORTEX_A1 = {
  units: [
    { id: 'u1', type: 'fact', status: 'validated', title: 'Horaires' },
    { id: 'u2', type: 'fact', status: 'validated', title: 'Tarifs' },
    { id: 'u3', type: 'qa', status: 'draft', title: 'Paiement en plusieurs fois' },
  ],
  counts: { draft: 1, validated: 2, quarantine: 0, expired: 0, total: 3 },
};
const KORTEX_EMPTY = { units: [], counts: { draft: 0, validated: 0, quarantine: 0, expired: 0, total: 0 } };

const LINKS_A1 = { links: [
  { id: 'l1', slug: 'abc123', status: 'active', max_per_day: 500, expires_at: null,
    created_at: sqlAgo(10), revoked_at: null, usage_today: 4, usage_total: 128,
    url: 'https://keystone-os-api.example/api/smart-agent/p/abc123' },
] };
const LINKS_A3_REVOKED = { links: [
  { id: 'l2', slug: 'xyz789', status: 'revoked', max_per_day: 500, expires_at: null,
    created_at: sqlAgo(60), revoked_at: sqlAgo(5), usage_today: 0, usage_total: 52,
    url: 'https://keystone-os-api.example/api/smart-agent/p/xyz789' },
] };

const calls = [];
const mainFetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  calls.push(`${method} ${u.replace(/^https:\/\/[^/]+/, '')}`);
  const body = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
  if (u.endsWith('/api/smart-agent/agents') && method === 'GET') return body(AGENTS_FIXTURE);
  if (u.includes('/gaps?agent=agent-1')) return body(GAPS_A1);
  if (u.includes('/gaps?agent=agent-2') || u.includes('/gaps?agent=agent-3') || u.includes('/gaps?agent=agent-4')) return body({ gaps: [] });
  if (u.includes('/kortex/units?agent=agent-1')) return body(KORTEX_A1);
  if (u.includes('/kortex/units?agent=agent-2')) return body(KORTEX_EMPTY);
  if (u.includes('/agents/agent-1/links')) return body(LINKS_A1);
  if (u.includes('/agents/agent-3/links')) return body(LINKS_A3_REVOKED);
  return { ok: false, status: 404, json: async () => ({ error: `route non mockée : ${method} ${u}` }) };
};
globalThis.fetch = mainFetch;

const { runKoraAction, KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — sa.list_agents (façonnage)\x1b[0m');
{
  const r = await runKoraAction('sa.list_agents', {});
  check('ok + 4 jumeaux', r.ok && r.data.total === 4);
  const c = r.data.jumeaux.find(a => a.nom === 'Conseiller Keystone');
  const s = r.data.jumeaux.find(a => a.nom === 'Support Boutique');
  check('statut FR : published → « en ligne »', c.statut === 'en ligne');
  check('statut FR : draft → « brouillon »', s.statut === 'brouillon');
  check('mission en extrait quand présente', /Présenter Keystone/.test(c.mission || ''));
  check('mission null tolérée (pas de "undefined" affiché)', s.mission === null);
  check('trous ouverts/semaine déjà attachés par le worker', c.trous_ouverts === 3 && c.trous_semaine === 1);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — résolution d’un jumeau (_saResolve, via sa.gaps)\x1b[0m');
{
  const noRef = await runKoraAction('sa.gaps', {});
  check('4 jumeaux sans référence → erreur qui LISTE tout le monde',
    !noRef.ok && /Conseiller Keystone/.test(noRef.error) && /Support Général/.test(noRef.error));

  const exact = await runKoraAction('sa.gaps', { name: 'Conseiller Keystone' });
  check('match exact', exact.ok && exact.data.jumeau === 'Conseiller Keystone');

  const partial = await runKoraAction('sa.gaps', { name: 'demo retraite' });
  check('match partiel insensible aux accents/casse', partial.ok && partial.data.jumeau === 'Démo Retraite');

  const ambig = await runKoraAction('sa.gaps', { name: 'support' });
  check('ambigu (2 jumeaux « support ») → erreur avec candidats',
    !ambig.ok && /Support Boutique/.test(ambig.error) && /Support Général/.test(ambig.error));

  const none = await runKoraAction('sa.gaps', { name: 'zzz-inconnu' });
  check('introuvable → message honnête listant les jumeaux existants', !none.ok && /Aucun jumeau/.test(none.error));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — un seul jumeau se résout seul (comme Sentinel)\x1b[0m');
{
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/smart-agent/agents')) return { ok: true, status: 200, json: async () => ({ agents: [AGENTS_FIXTURE.agents[0]] }) };
    if (u.includes('/gaps?agent=agent-1')) return { ok: true, status: 200, json: async () => GAPS_A1 };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await runKoraAction('sa.gaps', {});
  check('un seul jumeau → résolu SANS demander de précision', r.ok && r.data.jumeau === 'Conseiller Keystone');
  globalThis.fetch = savedFetch;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — sa.gaps (façonnage)\x1b[0m');
{
  const r = await runKoraAction('sa.gaps', { name: 'Conseiller Keystone' });
  check('total 2, 1 récent (< 7 j)', r.ok && r.data.total === 2 && r.data.cette_semaine === 1);
  const g1 = r.data.trous.find(g => g.question === 'Peut-on payer en plusieurs fois ?');
  const g2 = r.data.trous.find(g => g.question === 'Livrez-vous à l’étranger ?');
  check('demandée = hits recopié', g1.demandee === 5 && g2.demandee === 2);
  check('récent/pas récent correctement départagés', g1.recente === true && g2.recente === false);
  check('date FR', /2026|202[0-9]/.test(String(g1.derniere_fois)));

  const empty = await runKoraAction('sa.gaps', { name: 'Démo Retraite' });
  check('aucun trou → message plutôt qu’une liste vide muette', empty.ok && empty.data.total === 0 && /Aucun trou/.test(empty.data.message));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — sa.kortex_overview\x1b[0m');
{
  const r = await runKoraAction('sa.kortex_overview', { name: 'Conseiller Keystone' });
  check('compteurs de statut (GROUP BY exact)', r.ok && r.data.total === 3 && r.data.validees === 2 && r.data.brouillon === 1);
  check('tally par type en français', r.data.par_type['fait'] === 2 && r.data.par_type['question-réponse'] === 1);

  const vide = await runKoraAction('sa.kortex_overview', { name: 'Support Boutique' });
  check('coffre vide → message (pas un 0 muet)', vide.ok && vide.data.total === 0 && /Coffre vide/.test(vide.data.message));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — sa.public_usage\x1b[0m');
{
  const pub = await runKoraAction('sa.public_usage', { name: 'Conseiller Keystone' });
  check('lien actif → usage restitué', pub.ok && pub.data.publie === true && pub.data.liens[0].questions_aujourdhui === 4 && pub.data.liens[0].questions_total === 128);

  const revoked = await runKoraAction('sa.public_usage', { name: 'Démo Retraite' });
  check('publié mais lien révoqué → aucun lien ACTIF → message', revoked.ok && revoked.data.publie === true && /aucun lien actif/i.test(revoked.data.message));

  calls.length = 0;
  const draft = await runKoraAction('sa.public_usage', { name: 'Support Boutique' });
  check('jumeau non publié → publie:false + message', draft.ok && draft.data.publie === false);
  check('non publié → AUCUN appel réseau vers /links (court-circuit avant fetch)', !calls.some(c => c.includes('/links')));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — gating MAX (le message worker traverse tel quel)\x1b[0m');
{
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'Smart Agent est réservé au plan MAX pendant la beta.' }) });
  const r = await runKoraAction('sa.list_agents', {});
  check('403 → message du worker restitué tel quel (pas un code générique)', !r.ok && r.error === 'Smart Agent est réservé au plan MAX pendant la beta.');
  globalThis.fetch = savedFetch;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 8 — catalogue (caps + méta)\x1b[0m');
{
  /* seuil, jamais un total figé — Sentinel/Keynapse l'ont déjà appris :
     un total exact casse à chaque futur pad (K-9+) */
  check('4 actions smartagent toujours présentes', KORA_ACTIONS.filter(a => a.pad === 'smartagent').length === 4);
  check('toutes les desc ≤ 240 car.', KORA_ACTIONS.every(a => (a.desc || '').length <= 240));
  check('tous les desc de params ≤ 90 car.', KORA_ACTIONS.every(a => (a.params || []).every(p => (p.desc || '').length <= 90)));
  check('KORA_PAD_META a une entrée smartagent (label+desc)', KORA_PAD_META.some(p => p.pad === 'smartagent' && p.label && p.desc));
  const open = KORA_ACTIONS.find(a => a.id === 'os.open_pad');
  check('os.open_pad mentionne smartagent', /smartagent/.test(open.desc) && /smartagent/.test(open.params[0].desc));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 9 — Syntaxe (node --check)\x1b[0m');
for (const f of ['app/kora-actions.js', 'workers/src/routes/kora.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
