#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KEYSTONE OS — smoke-prod (OPS-3 · SEPT_PROD_SPRINTS)
// ───────────────────────────────────────────────────────────────
// Rejoue en ~30 s la batterie manuelle post-deploy, indépendamment
// de toute session Claude. Une ligne VERT/ROUGE par check ; exit
// code ≠ 0 si au moins un check est ROUGE.
//
//   Usage :
//     node scripts/smoke-prod.mjs [--sw v5.28.305-sa-uicolor] [options]
//     npm run smoke:prod -- --sw v5.28.305-sa-uicolor
//
//   Flux type :
//     git push (front → Vercel) && npm run smoke:prod
//     cd workers && wrangler deploy && cd .. && npm run smoke:prod
//
//   Options :
//     --sw <version>      Version SW attendue en prod (défaut : la
//                         constante VERSION du sw.js local, càd la
//                         version qu'on vient de déployer). Accepte
//                         « v5.28.305-… » ou « ks-os-v5.28.305-… ».
//     --worker <url>      Base worker (défaut : prod).
//     --landing <url>     Base landing (défaut : prod).
//     --timeout <ms>      Timeout par requête (défaut : 10000).
//     --snapshot          Écrit la baseline du gardien QR et sort.
//     --no-color          Sortie sans couleur ANSI.
//
//   Gardien QR (optionnel) : si la variable d'env KS_SMOKE_JWT est
//   présente (JWT d'un tenant de surveillance), le script lit
//   scans_total via /api/qr/overview et vérifie qu'il n'a jamais
//   DIMINUÉ vs la baseline (un deploy ne doit jamais effacer les
//   scans). Sans ce JWT → check SKIP (jaune), jamais ROUGE.
//   Baseline stockée dans scripts/.smoke-qr-baseline.json (gitignoré).
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Args ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
}
const hasFlag = (name) => argv.includes(name);

const WORKER  = (arg('--worker',  'https://keystone-os-api.keystone-os.workers.dev')).replace(/\/$/, '');
const LANDING = (arg('--landing', 'https://protein-keystone.com')).replace(/\/$/, '');
const TIMEOUT = parseInt(arg('--timeout', '10000'), 10);
const SNAPSHOT = hasFlag('--snapshot');
const BASELINE_FILE = join(__dirname, '.smoke-qr-baseline.json');

// Version SW attendue : --sw explicite, sinon la constante du sw.js local.
function localSwVersion() {
  try {
    const src = readFileSync(join(ROOT, 'sw.js'), 'utf8');
    const m = src.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  } catch { return null; }
}
// Normalise « v5.28.x » / « ks-os-v5.28.x » → même forme comparable.
const normSw = (v) => (v || '').replace(/^ks-os-/, '').replace(/^v/, '');
const EXPECTED_SW = arg('--sw', localSwVersion());

// ── Couleur ─────────────────────────────────────────────────────
const useColor = !hasFlag('--no-color') && !process.env.NO_COLOR && process.stdout.isTTY;
const c = (code, s) => useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
const green  = (s) => c('32', s);
const red    = (s) => c('31', s);
const yellow = (s) => c('33', s);
const dim    = (s) => c('2',  s);

// ── HTTP avec timeout ───────────────────────────────────────────
async function req(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, ...opts });
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    return { status: res.status, body, headers: res.headers };
  } catch (e) {
    return { status: 0, body: '', error: e.name === 'AbortError' ? `timeout ${TIMEOUT}ms` : e.message };
  } finally {
    clearTimeout(t);
  }
}

// ── Résultats ───────────────────────────────────────────────────
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok === 'skip' ? yellow('SKIP') : ok ? green('VERT') : red('ROUGE');
  console.log(`  ${tag}  ${name}${detail ? dim('  — ' + detail) : ''}`);
}

function section(title) { console.log('\n' + title); }

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log(`\nKEYSTONE smoke-prod  ${dim(new Date().toISOString())}`);
  console.log(dim(`  worker  : ${WORKER}`));
  console.log(dim(`  landing : ${LANDING}`));
  console.log(dim(`  sw attendu : ${EXPECTED_SW ? normSw(EXPECTED_SW) : '(inconnu)'}`));

  // Mode snapshot du gardien QR : écrit la baseline puis sort.
  if (SNAPSHOT) return snapshotQr();

  // ── 1. Landing + clean URLs ────────────────────────────────────
  section('Landing');
  for (const [label, path] of [['racine 200', '/'], ['/app 200', '/app']]) {
    const r = await req(LANDING + path);
    record(`Landing ${label}`, r.status === 200, r.error || `HTTP ${r.status}`);
  }

  // ── 2. Assets clés ─────────────────────────────────────────────
  section('Assets clés');
  const ASSETS = ['/sw.js', '/manifest.json', '/app/ui-renderer.js', '/app/pads-data.js'];
  for (const a of ASSETS) {
    const r = await req(LANDING + a);
    record(`Asset ${a}`, r.status === 200, r.error || `HTTP ${r.status}`);
  }

  // ── 3. Version SW servie == attendue ───────────────────────────
  section('Service Worker');
  {
    const r = await req(LANDING + '/sw.js');
    const m = r.body.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
    const served = m ? m[1] : null;
    if (!EXPECTED_SW) {
      record('SW version', 'skip', 'aucune version attendue (ni --sw ni sw.js local)');
    } else if (!served) {
      record('SW version', false, `VERSION introuvable dans le sw.js servi (HTTP ${r.status})`);
    } else {
      const ok = normSw(served) === normSw(EXPECTED_SW);
      record('SW version', ok, ok ? served : `servi ${served} ≠ attendu ${normSw(EXPECTED_SW)}`);
    }
  }

  // ── 4. Santés (200 + ok:true) ──────────────────────────────────
  section('Santés moteurs');
  const HEALTHS = ['keybrand', 'keynapse', 'network', 'desk', 'sentinel', 'smart-agent'];
  for (const h of HEALTHS) {
    const r = await req(`${WORKER}/api/${h}/health`);
    let ok = r.status === 200;
    let detail = r.error || `HTTP ${r.status}`;
    if (ok) {
      try { ok = JSON.parse(r.body).ok === true; detail = ok ? 'ok:true' : 'ok≠true'; }
      catch { ok = false; detail = 'réponse non-JSON'; }
    }
    record(`Santé /api/${h}/health`, ok, detail);
  }

  // ── 5. Routes gatées → 401 sans JWT ────────────────────────────
  section('Enforcement (401 sans JWT)');
  const GATED = [
    '/api/pulsa/forms',
    '/api/sceau/token',
    '/api/vault/health',
    '/api/admin/health',
  ];
  for (const g of GATED) {
    const r = await req(WORKER + g);
    record(`Gaté ${g} → 401`, r.status === 401, r.error || `HTTP ${r.status}`);
  }

  // ── 6. Routes PUBLIQUES par nature : jamais gatées par erreur ───
  //    (Key Form, SDQR scan, agent public). On n'exige pas un 200
  //    — juste : ni 401, ni 5xx. La route répond publiquement.
  section('Routes publiques (jamais 401/5xx)');
  const PUBLIC = [
    ['Key Form public',  '/api/pulsa/public/__smoke_nonexistent__'],
    ['SDQR scan /r/',    '/r/__smoke_nonexistent__'],
    ['Smart Agent public', '/api/smart-agent/health'],
  ];
  for (const [label, path] of PUBLIC) {
    const r = await req(WORKER + path);
    const ok = r.status !== 0 && r.status !== 401 && r.status < 500;
    record(`Public ${label}`, ok, r.error || `HTTP ${r.status}`);
  }

  // ── 7. Gardien QR (optionnel — KS_SMOKE_JWT) ───────────────────
  section('Gardien QR (scans_total)');
  await guardQr();

  // ── Synthèse ───────────────────────────────────────────────────
  const fails = results.filter(r => r.ok === false);
  const skips = results.filter(r => r.ok === 'skip');
  const pass  = results.filter(r => r.ok === true);
  console.log('\n' + '─'.repeat(60));
  const summary = `${pass.length} VERT · ${fails.length} ROUGE · ${skips.length} SKIP`;
  if (fails.length) {
    console.log(red(`✗ ÉCHEC — ${summary}`));
    console.log(red('  Rouges : ' + fails.map(f => f.name).join(', ')));
    process.exit(1);
  } else {
    console.log(green(`✓ OK — ${summary}`));
    process.exit(0);
  }
}

// ── Gardien QR : lecture + comparaison à la baseline ────────────
async function fetchScansTotal() {
  const jwt = process.env.KS_SMOKE_JWT;
  if (!jwt) return { skip: 'KS_SMOKE_JWT absent' };
  const r = await req(`${WORKER}/api/qr/overview`, { headers: { Authorization: `Bearer ${jwt}` } });
  if (r.status !== 200) return { error: `HTTP ${r.status}` };
  try {
    const total = JSON.parse(r.body)?.totals?.scans_total;
    if (typeof total !== 'number') return { error: 'scans_total absent' };
    return { total };
  } catch { return { error: 'réponse non-JSON' }; }
}

async function guardQr() {
  const res = await fetchScansTotal();
  if (res.skip)  return record('Gardien QR', 'skip', res.skip + ' (voir doc en tête de script)');
  if (res.error) return record('Gardien QR', false, res.error);

  let baseline = null;
  if (existsSync(BASELINE_FILE)) {
    try { baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).scans_total; } catch { /* ignore */ }
  }
  if (typeof baseline !== 'number') {
    // 1re exécution : on pose la baseline, pas de comparaison possible.
    writeFileSync(BASELINE_FILE, JSON.stringify({ scans_total: res.total, at: new Date().toISOString() }, null, 2));
    return record('Gardien QR', 'skip', `baseline posée (${res.total} scans) — comparé au prochain run`);
  }
  const ok = res.total >= baseline; // les scans ne font que croître ; une baisse = perte de données.
  // On met à jour la baseline vers le nouveau max si tout va bien.
  if (ok) writeFileSync(BASELINE_FILE, JSON.stringify({ scans_total: res.total, at: new Date().toISOString() }, null, 2));
  record('Gardien QR', ok, ok ? `${res.total} scans (≥ ${baseline})` : `RÉGRESSION ${res.total} < ${baseline} — scans effacés ?`);
}

async function snapshotQr() {
  const res = await fetchScansTotal();
  if (res.skip)  { console.log(yellow(`\nSnapshot impossible : ${res.skip}`)); process.exit(0); }
  if (res.error) { console.log(red(`\nSnapshot échoué : ${res.error}`)); process.exit(1); }
  writeFileSync(BASELINE_FILE, JSON.stringify({ scans_total: res.total, at: new Date().toISOString() }, null, 2));
  console.log(green(`\n✓ Baseline gardien QR posée : ${res.total} scans → ${BASELINE_FILE}`));
  process.exit(0);
}

main().catch(e => { console.error(red('\nErreur fatale smoke-prod : ' + (e?.stack || e))); process.exit(2); });
