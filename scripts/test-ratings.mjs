#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test « Notes des apps → Admin » (ratings)

   - handleRatingsAdmin : 401 sans token admin · agrégat trié (moyennes
     basses en tête) + total avec token ;
   - handleRatingSubmit : OPTIONS → 204 · sans JWT → 401 ;
   - structurel : routes câblées (index.js), front POST (rating-widget),
     vue admin (renderSatisfaction + TAB_RENDERERS + onglet admin.html).

   Usage : node scripts/test-ratings.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { readFile }      from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handleRatingsAdmin, handleRatingSubmit } from '../workers/src/routes/ratings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function ok(l)    { passed++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); }
function ko(l, e) { failed++; failures.push({ label: l, error: e }); console.log(`  \x1b[31m✗\x1b[0m ${l}\n    ${e}`); }
function eq(l, got, want) { (JSON.stringify(got) === JSON.stringify(want)) ? ok(l) : ko(l, `attendu ${JSON.stringify(want)}, reçu ${JSON.stringify(got)}`); }
function truthy(l, v) { v ? ok(l) : ko(l, `attendu truthy, reçu ${JSON.stringify(v)}`); }
async function src(rel) { return readFile(join(ROOT, rel), 'utf8'); }

// Mock D1 : prepare→{ bind, run, all }. all() renvoie les rows fournis.
function mockDB(rows = []) {
  return {
    prepare() {
      return { bind() { return this; }, async run() { return {}; }, async all() { return { results: rows }; }, async first() { return null; } };
    },
  };
}
const ENV = { KS_ADMIN_SECRET: 'adm-secret', KS_ALLOWED_ORIGIN: 'https://protein-keystone.com' };
const req = (method, headers = {}) => new Request('https://protein-keystone.com/api/x', { method, headers });

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 1 — Syntaxe (node --check)\x1b[0m');
for (const f of [
  'workers/src/routes/ratings.js', 'workers/src/index.js',
  'app/lib/rating-widget.js', 'app/admin.js',
]) {
  try { execSync(`node --check ${JSON.stringify(join(ROOT, f))}`, { stdio: 'pipe' }); ok(`node --check ${f}`); }
  catch (e) { ko(`node --check ${f}`, (e.stderr?.toString() || e.message).split('\n')[0]); }
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 2 — GET /api/admin/ratings (auth + agrégat)\x1b[0m');
{
  // Sans token admin → 401.
  const r401 = await handleRatingsAdmin(req('GET'), { ...ENV, DB: mockDB([]) });
  eq('401 sans token admin', r401.status, 401);

  // Avec token admin → 200 + agrégat trié (moyenne basse d'abord) + total.
  const rows = [
    { app_id: 'B-HAPPY', n: 2, avg: 4.5, s1: 0, s2: 0, s3: 0, s4: 1, s5: 1, last_at: '2026-06-17' },
    { app_id: 'A-ANGRY', n: 3, avg: 2.0, s1: 1, s2: 1, s3: 1, s4: 0, s5: 0, last_at: '2026-06-17' },
  ];
  const res = await handleRatingsAdmin(req('GET', { Authorization: 'Bearer adm-secret' }), { ...ENV, DB: mockDB(rows) });
  eq('200 avec token admin', res.status, 200);
  const body = await res.json();
  eq('total_votes = 5', body.total_votes, 5);
  eq('tri : moyenne basse (mécontentements) en tête', body.apps.map(a => a.app_id), ['A-ANGRY', 'B-HAPPY']);
  truthy('agrégat anonyme (aucun tenant_id renvoyé)', !JSON.stringify(body).includes('tenant'));
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 3 — POST /api/ratings (auth gating)\x1b[0m');
{
  const opt = await handleRatingSubmit(req('OPTIONS'), { ...ENV, DB: mockDB() });
  eq('OPTIONS → 204 (préflight CORS)', opt.status, 204);

  // POST sans JWT → 401 (requireJWT renvoie null sans token valide).
  let status401 = null;
  try { const r = await handleRatingSubmit(req('POST'), { ...ENV, DB: mockDB() }); status401 = r.status; }
  catch (e) { status401 = 'throw:' + e.message; }
  eq('POST sans JWT → 401', status401, 401);
}

// ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m▶ Suite 4 — Câblage (structurel)\x1b[0m');
{
  const idx = await src('workers/src/index.js');
  truthy('index importe les handlers ratings', /handleRatingSubmit, handleRatingsAdmin.*ratings\.js/.test(idx));
  truthy('route POST /api/ratings câblée', /'\/api\/ratings'[\s\S]{0,80}handleRatingSubmit/.test(idx));
  truthy('route GET /api/admin/ratings câblée', /'\/api\/admin\/ratings'[\s\S]{0,80}handleRatingsAdmin/.test(idx));

  const rw = await src('app/lib/rating-widget.js');
  truthy('rating-widget POST /api/ratings', /\/api\/ratings/.test(rw) && /_pushRating/.test(rw));
  truthy('rating-widget : fire-and-forget (keepalive + catch)', /keepalive/.test(rw) && /\.catch\(\(\)\s*=>\s*\{\}\)/.test(rw));
  truthy('rating-widget : pas de remontée sans JWT', /if \(!jwt\) return/.test(rw));

  const adm = await src('app/admin.js');
  truthy('admin : renderSatisfaction défini', /async function renderSatisfaction\(panel\)/.test(adm));
  truthy('admin : satisfaction dans TAB_RENDERERS', /satisfaction:\s*renderSatisfaction/.test(adm));
  truthy('admin : appelle /api/admin/ratings', /api\('\/api\/admin\/ratings'\)/.test(adm));

  const html = await src('admin.html');
  truthy('admin.html : bouton onglet Satisfaction', /data-tab="satisfaction"/.test(html));
  truthy('admin.html : panneau tab-satisfaction', /id="tab-satisfaction"/.test(html));
}

// ─────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'─'.repeat(54)}`);
if (failed === 0) {
  console.log(`\x1b[1m\x1b[32m✓ ${passed}/${total} tests OK\x1b[0m\n`);
  process.exit(0);
} else {
  console.log(`\x1b[1m\x1b[31m✗ ${failed}/${total} tests en échec\x1b[0m`);
  for (const f of failures) console.log(`  · ${f.label} — ${f.error}`);
  console.log('');
  process.exit(1);
}
