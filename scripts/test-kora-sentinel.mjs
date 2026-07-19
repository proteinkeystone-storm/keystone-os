#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test actions Kora × Sentinel (snt.*, 19/07/2026)

   Teste, SANS réseau ni JWT (fetch + localStorage mockés) :
     - snt.fleet : façonnage honnête (en_ligne null si jamais vérifié,
       score null si jamais audité + note, dates FR) ;
     - _sntResolve via snt.site_report : site unique auto-résolu,
       plusieurs sites sans référence → erreur qui LISTE, match partiel
       insensible aux accents, ambigu → candidats ;
     - snt.site_report : axes en français, findings triés par gravité
       et plafonnés (+ compteur du reste), GEO servi seulement si
       relevé réel, site jamais audité → message + audit:null ;
     - snt.run_audit : séquence check → audit → cockpit, évolution en
       points vs le score d'AVANT la relance, top 3 points.

   Usage : node scripts/test-kora-sentinel.mjs   ·   Exit 0 si OK.
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

/* ── Mocks (avant l'import du module : kora-actions lit localStorage
      à l'exécution des actions seulement — module inerte) ── */
globalThis.localStorage = { getItem: (k) => (k === 'ks_jwt' ? 'jwt-de-test' : null), setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };

const SITES_FIXTURE = {
  sites: [
    { id: 'site-a', url: 'https://protein-keystone.com', label: 'Keystone', platform: 'custom',
      last_ok: 1, last_status: 200, last_ms: 320, last_checked_at: '2026-07-19 08:00:00',
      consecutive_fails: 0, last_score: 72, last_scores: null, last_audit_at: '2026-07-18 09:30:00',
      uptime24h: 100, spark: [] },
    { id: 'site-b', url: 'https://www.epaulette-asso.fr', label: 'L’Épaulette', platform: 'wix',
      last_ok: null, last_status: null, last_ms: null, last_checked_at: null,
      consecutive_fails: 0, last_score: null, last_scores: null, last_audit_at: null,
      uptime24h: null, spark: [] },
  ],
  count: 2, limit: 3, plan: 'MAX', email_enabled: false, geo_enabled: true,
};

const COCKPIT_A = { cockpit: {
  site: { id: 'site-a', url: 'https://protein-keystone.com', label: 'Keystone', platform: 'custom',
          last_ok: 1, last_status: 200, last_ms: 320, last_checked_at: '2026-07-19 08:00:00', next_check_at: null },
  uptime30d: 99.6, uptimeTrend: 'up', series30d: [],
  audit: {
    score: 72,
    scores: { disponibilite: 100, performance: 55, seo: 70, securite: 80, accessibilite: 60, presence: 40, keywords: null },
    findings: [
      { axis: 'seo', sev: 'low',    key: 'title_long',   title: 'Balise title trop longue', detail: '78 caractères — visez 50-60.' },
      { axis: 'performance', sev: 'high', key: 'perf_lcp', title: 'Chargement lent (LCP 4.2 s)', detail: 'Cible : moins de 2,5 s — compressez images et scripts.' },
      { axis: 'securite', sev: 'medium', key: 'csp', title: 'CSP absente', detail: 'Ajoutez une Content-Security-Policy.' },
      { axis: 'seo', sev: 'high',   key: 'meta_missing', title: 'Méta description absente', detail: 'Le résumé Google est vide.' },
      { axis: 'accessibilite', sev: 'low', key: 'alt', title: 'Images sans alt', detail: '4 images sans texte alternatif.' },
      { axis: 'performance', sev: 'medium', key: 'perf_cls', title: 'La page saute (CLS 0.28)', detail: 'Réservez les dimensions des images.' },
      { axis: 'seo', sev: 'low',    key: 'h1', title: 'Deux H1', detail: 'Gardez un seul H1.' },
      { axis: 'presence', sev: 'low', key: 'gmb', title: 'Fiche établissement absente', detail: 'Créez la fiche Google.' },
    ],
    cwv: null, pages: null, created_at: '2026-07-18 09:30:00',
  },
  scoreHistory: [], scoreTrend: 4,
  ssl: { https: true, valid: true },
  geo: { enabled: true, configured: true, business_name: 'Keystone', city: 'Paris', activity: '',
         prompts: [], score: 58, results: null, run_at: '2026-07-17 10:00:00' },
  gsc: { available: true, connected: false, property: null, account_email: null, score: null, results: null, run_at: null },
  email_enabled: false,
} };

const COCKPIT_B = { cockpit: {
  site: { id: 'site-b', url: 'https://www.epaulette-asso.fr', label: 'L’Épaulette', platform: 'wix',
          last_ok: null, last_status: null, last_ms: null, last_checked_at: null, next_check_at: null },
  uptime30d: null, uptimeTrend: 'stable', series30d: [],
  audit: null, scoreHistory: [], scoreTrend: null,
  ssl: { https: true, valid: false },
  geo: { enabled: true, configured: false, business_name: 'L’Épaulette', city: '', activity: '', prompts: [], score: null, results: null, run_at: null },
  gsc: { available: true, connected: false, property: null, account_email: null, score: null, results: null, run_at: null },
  email_enabled: false,
} };

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  calls.push(`${method} ${u.replace(/^https:\/\/[^/]+/, '')}`);
  const body = (json) => ({ ok: true, status: 200, json: async () => json });
  if (u.endsWith('/api/sentinel/sites') && method === 'GET') return body(SITES_FIXTURE);
  if (u.includes('/sites/site-a/cockpit')) return body(COCKPIT_A);
  if (u.includes('/sites/site-b/cockpit')) return body(COCKPIT_B);
  if (u.includes('/sites/site-a/check') && method === 'POST') return body({ check: { ok: true, status: 200, ms: 290 } });
  if (u.includes('/sites/site-a/audit') && method === 'POST') return body({ audit: { score: 72 } });
  return { ok: false, status: 404, json: async () => ({ error: `route non mockée : ${method} ${u}` }) };
};

const { runKoraAction, KORA_ACTIONS } = await import('../app/kora-actions.js');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — snt.fleet (façonnage honnête)\x1b[0m');
{
  const r = await runKoraAction('snt.fleet', {});
  check('ok + 2 sites', r.ok && r.data.total === 2);
  const [a, b] = r.data.sites;
  check('site vérifié → en_ligne true + dispo « 100 % »', a.en_ligne === true && a.disponibilite_24h === '100 %');
  check('score + date d’audit en français', a.score_audit === 72 && /2026|juillet/.test(String(a.audit_du)));
  check('site JAMAIS vérifié → en_ligne null (pas « hors ligne »)', b.en_ligne === null);
  check('site jamais audité → score null + note explicative', b.score_audit === null && /snt\.run_audit/.test(r.data.note || ''));
  check('hostname sans www comme nom de repli possible', typeof b.nom === 'string' && b.nom.length > 0);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — résolution d’un site (_sntResolve)\x1b[0m');
{
  const noRef = await runKoraAction('snt.site_report', {});
  check('2 sites sans référence → erreur qui LISTE les sites', !noRef.ok && /Keystone/.test(noRef.error) && /paulette/i.test(noRef.error));

  const partial = await runKoraAction('snt.site_report', { site: 'epaulette' });
  check('match partiel insensible aux accents (« epaulette » → L’Épaulette)', partial.ok && partial.data.site === 'L’Épaulette');

  const byHost = await runKoraAction('snt.site_report', { site: 'protein-keystone.com' });
  check('match par nom de domaine', byHost.ok && byHost.data.site === 'Keystone');

  const none = await runKoraAction('snt.site_report', { site: 'zzz-inconnu' });
  check('introuvable → erreur avec la liste des sites suivis', !none.ok && /Sites suivis/.test(none.error));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — snt.site_report (rapport complet)\x1b[0m');
{
  const r = await runKoraAction('snt.site_report', { site: 'Keystone' });
  const d = r.data;
  check('score global + évolution 7 j signée (« +4 pts »)', d.score_global === 72 && d.evolution_7j === '+4 pts');
  check('axes en FRANÇAIS, axe sans score absent (keywords null)',
    d.axes['SEO technique'] === 70 && d.axes['Présence locale'] === 40 && !('Mots-clés' in d.axes));
  check('findings triés gravité élevée d’abord', d.points_a_corriger[0].gravite === 'élevé' && d.points_a_corriger[1].gravite === 'élevé');
  check('findings plafonnés à 6 + compteur du reste', d.points_a_corriger.length === 6 && d.points_a_corriger_en_plus === 2);
  check('GEO servi (configuré + relevé réel)', d.visibilite_ia && d.visibilite_ia.score === 58);
  check('GSC non connecté → mots_cles_google ABSENT (pas de null tentant)', !('mots_cles_google' in d));
  check('dispo 30 j + tendance', d.disponibilite_30j === '99.6 %' && d.tendance_disponibilite === 'en hausse');

  const rb = await runKoraAction('snt.site_report', { site: 'epaulette' });
  check('site jamais audité → audit:null + message vers snt.run_audit', rb.ok && rb.data.audit === null && /snt\.run_audit/.test(rb.data.message));
  check('jamais vérifié → en_ligne null aussi dans le rapport', rb.data.en_ligne === null);
  /* jamais audité = early return AVANT le bloc GEO : le message domine,
     aucune surface annexe n'est servie (rien à broder pour le modèle) */
  check('jamais audité → AUCUNE surface GEO servie (early return)', !('visibilite_ia' in rb.data));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — snt.run_audit (séquence + évolution)\x1b[0m');
{
  calls.length = 0;
  const r = await runKoraAction('snt.run_audit', { site: 'Keystone' });
  const d = r.data;
  check('fait:true + en ligne (check frais)', r.ok && d.fait === true && d.en_ligne === true);
  check('séquence réelle : sites → check → audit → cockpit',
    calls[0].includes('GET /api/sentinel/sites') && calls[1].includes('POST') && calls[1].includes('/check')
    && calls[2].includes('POST') && calls[2].includes('/audit') && calls[3].includes('/cockpit'));
  /* même convention que evolution_semaine des QR : signe + seulement si > 0 */
  check('évolution vs score d’AVANT la relance (72 → 72 = « 0 pts »)', d.evolution === '0 pts');
  check('top 3 points à corriger, gravité élevée d’abord', d.points_a_corriger.length === 3 && d.points_a_corriger[0].gravite === 'élevé');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — catalogue (caps worker)\x1b[0m');
{
  check('31 actions au total (≤ MAX_ACTIONS=32, marge 1)', KORA_ACTIONS.length === 31);
  check('3 actions sentinel', KORA_ACTIONS.filter(a => a.pad === 'sentinel').length === 3);
  check('toutes les desc ≤ 240 car.', KORA_ACTIONS.every(a => (a.desc || '').length <= 240));
  check('tous les desc de params ≤ 90 car.', KORA_ACTIONS.every(a => (a.params || []).every(p => (p.desc || '').length <= 90)));
  const open = KORA_ACTIONS.find(a => a.id === 'os.open_pad');
  check('os.open_pad mentionne sentinel', /sentinel/.test(open.desc) && /sentinel/.test(open.params[0].desc));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — Syntaxe (node --check)\x1b[0m');
for (const f of ['app/kora-actions.js', 'workers/src/routes/kora.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
