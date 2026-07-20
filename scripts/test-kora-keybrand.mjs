#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test actions Kora × Key Brand (kb.*, K-10 20/07/2026)

   Teste, SANS réseau ni JWT (fetch + localStorage/document mockés) :
     - kb.list_charts : façonnage (statut FR, couleur principale, plafond
       et place restante), bibliothèque vide → message ;
     - _kbResolve via kb.chart_summary : plusieurs chartes sans référence
       → erreur qui LISTE, une seule se résout seule (comme Smart Agent/
       desK), match exact/partiel insensible aux accents, ambigu →
       candidats, introuvable → message honnête ;
     - kb.chart_summary : dérive les compteurs (couleurs/typos/logo/
       symbolique) depuis `draft` DÉJÀ PARSÉ par le worker (_chartOut
       fait le JSON.parse côté serveur — vérifié dans key-brand.js avant
       d'écrire ce test, contrairement au piège `jalons` de desK où le
       worker renvoyait du TEXT brut) ; charte publiée → lien /b/:slug +
       libellé d'accès FR ; charte non publiée → AUCUN lien, note honnête.
     - catalogue (caps + méta).

   Usage : node scripts/test-kora-keybrand.mjs   ·   Exit 0 si OK.
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

globalThis.localStorage = { getItem: (k) => (k === 'ks_jwt' ? 'jwt-de-test' : null), setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = {};

const sqlAgo = (days) => new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19).replace('T', ' ');

const CHARTS_FIXTURE = { items: [
  { id: 'c1', slug: 'ab12cd34ef56gh', name: 'Protein Studio', status: 'published',
    version: 3, updated_at: sqlAgo(2), primary_hex: '#C9A227' },
  { id: 'c2', slug: 'zz99yy88xx77ww', name: 'Le Mas des Bouteillans', status: 'draft',
    version: 1, updated_at: sqlAgo(20), primary_hex: null },
  { id: 'c3', slug: 'qq11rr22ss33tt', name: 'Protein Keystone', status: 'published',
    version: 5, updated_at: sqlAgo(1), primary_hex: '#2E7D32' },
], max: 30 };

// draft = objet DÉJÀ PARSÉ (le worker fait JSON.parse côté serveur, _chartOut).
const CHART_C1 = { chart: {
  id: 'c1', slug: 'ab12cd34ef56gh', name: 'Protein Studio', status: 'published', access: 'unlisted',
  version: 3, created_at: sqlAgo(100), updated_at: sqlAgo(2), dirty: false,
  draft: {
    meta: { name: 'Protein Studio', baseline: 'Le studio qui code pendant que vous dormez' },
    colors: { palette: [{ role: 'primary', hex: '#C9A227' }, { role: 'accent', hex: '#111' }] },
    typography: { fonts: [{ family: 'Inter' }] },
    logo: { variants: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }] },
    branding: { symbolism: ['clé', 'voûte', 'pierre angulaire', 'sobriété', 'artisanat', 'exigence'] },
  },
} };
const CHART_C2 = { chart: {
  id: 'c2', slug: 'zz99yy88xx77ww', name: 'Le Mas des Bouteillans', status: 'draft', access: 'unlisted',
  version: 1, created_at: sqlAgo(20), updated_at: sqlAgo(20), dirty: false,
  draft: { meta: {}, colors: {}, typography: {}, logo: {}, branding: {} },
} };
const CHART_C3_CODE = { chart: {
  id: 'c3', slug: 'qq11rr22ss33tt', name: 'Protein Keystone', status: 'published', access: 'code',
  version: 5, created_at: sqlAgo(50), updated_at: sqlAgo(1), dirty: true,
  draft: { meta: { baseline: null }, colors: { palette: [] }, typography: { fonts: [] }, logo: { variants: [] }, branding: {} },
} };

const calls = [];
const mainFetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  calls.push(`${method} ${u.replace(/^https:\/\/[^/]+/, '')}`);
  const body = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
  if (u.endsWith('/api/keybrand/charts') && method === 'GET') return body(CHARTS_FIXTURE);
  if (u.endsWith('/api/keybrand/charts/c1')) return body(CHART_C1);
  if (u.endsWith('/api/keybrand/charts/c2')) return body(CHART_C2);
  if (u.endsWith('/api/keybrand/charts/c3')) return body(CHART_C3_CODE);
  return { ok: false, status: 404, json: async () => ({ error: `route non mockée : ${method} ${u}` }) };
};
globalThis.fetch = mainFetch;

const { runKoraAction, KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — kb.list_charts (façonnage)\x1b[0m');
{
  const r = await runKoraAction('kb.list_charts', {});
  check('ok + 3 chartes, plafond 30', r.ok && r.data.total === 3 && r.data.plafond === 30);
  check('place restante calculée (30-3=27)', r.data.place_restante === 27);
  const c1 = r.data.chartes.find(c => c.nom === 'Protein Studio');
  const c2 = r.data.chartes.find(c => c.nom === 'Le Mas des Bouteillans');
  check('statut FR : published → « publiée »', c1.statut === 'publiée');
  check('statut FR : draft → « brouillon »', c2.statut === 'brouillon');
  check('couleur principale recopiée', c1.couleur_principale === '#C9A227');
  check('couleur principale null tolérée', c2.couleur_principale === null);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — bibliothèque vide → message\x1b[0m');
{
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/keybrand/charts')) return { ok: true, status: 200, json: async () => ({ items: [], max: 30 }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await runKoraAction('kb.list_charts', {});
  check('0 charte → message plutôt qu’une liste vide muette', r.ok && r.data.total === 0 && /Aucune charte/.test(r.data.message));
  globalThis.fetch = saved;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — résolution d’une charte (_kbResolve, via kb.chart_summary)\x1b[0m');
{
  const noRef = await runKoraAction('kb.chart_summary', {});
  check('3 chartes sans référence → erreur qui LISTE tout le monde',
    !noRef.ok && /Protein Studio/.test(noRef.error) && /Bouteillans/.test(noRef.error) && /Protein Keystone/.test(noRef.error));

  const exact = await runKoraAction('kb.chart_summary', { name: 'Protein Studio' });
  check('match exact', exact.ok && exact.data.charte === 'Protein Studio');

  const partial = await runKoraAction('kb.chart_summary', { name: 'bouteillans' });
  check('match partiel insensible aux accents/casse', partial.ok && partial.data.charte === 'Le Mas des Bouteillans');

  const ambig = await runKoraAction('kb.chart_summary', { name: 'protein' });
  check('ambigu (2 chartes « protein ») → erreur avec candidats',
    !ambig.ok && /Protein Studio/.test(ambig.error) && /Protein Keystone/.test(ambig.error));

  const none = await runKoraAction('kb.chart_summary', { name: 'zzz-inconnu' });
  check('introuvable → message honnête listant les chartes existantes', !none.ok && /Aucune charte/.test(none.error));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — une seule charte se résout seule (comme Smart Agent/desK)\x1b[0m');
{
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/keybrand/charts')) return { ok: true, status: 200, json: async () => ({ items: [CHARTS_FIXTURE.items[0]], max: 30 }) };
    if (u.endsWith('/api/keybrand/charts/c1')) return { ok: true, status: 200, json: async () => CHART_C1 };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await runKoraAction('kb.chart_summary', {});
  check('une seule charte → résolue SANS demander de précision', r.ok && r.data.charte === 'Protein Studio');
  globalThis.fetch = savedFetch;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — kb.chart_summary (façonnage, charte PUBLIÉE)\x1b[0m');
{
  const r = await runKoraAction('kb.chart_summary', { name: 'Protein Studio' });
  check('baseline recopiée', r.ok && r.data.baseline === 'Le studio qui code pendant que vous dormez');
  check('compteurs dérivés du draft (2 couleurs, 1 typo, 3 variantes logo)',
    r.data.couleurs === 2 && r.data.typographies === 1 && r.data.variantes_logo === 3);
  check('symbolique plafonnée à 5 (draft en a 6)', r.data.symbolique.length === 5);
  check('lien public = API_BASE + /b/ + slug', r.data.lien_public.endsWith('/b/ab12cd34ef56gh'));
  check('accès « unlisted » → libellé FR', r.data.acces === 'lien non répertorié');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — kb.chart_summary : charte NON publiée → AUCUN lien\x1b[0m');
{
  const r = await runKoraAction('kb.chart_summary', { name: 'Bouteillans' });
  check('brouillon vide → compteurs à 0, pas de crash', r.ok && r.data.couleurs === 0 && r.data.typographies === 0 && r.data.variantes_logo === 0);
  check('AUCUN lien public pour une charte non publiée', r.data.lien_public === undefined);
  check('note honnête à la place', /pas encore publiée/i.test(r.data.note || ''));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — kb.chart_summary : accès « code » → libellé distinct\x1b[0m');
{
  const r = await runKoraAction('kb.chart_summary', { name: 'Protein Keystone' });
  check('publiée + access=code → lien quand même donné', r.ok && r.data.lien_public.endsWith('/b/qq11rr22ss33tt'));
  check('libellé « protégé par code »', r.data.acces === 'protégé par code');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 8 — catalogue (caps + méta)\x1b[0m');
{
  /* seuil scopé au pad — jamais un total figé qui casserait au pad suivant */
  check('2 actions keybrand présentes', KORA_ACTIONS.filter(a => a.pad === 'keybrand').length === 2);
  check('toutes lectures (V1 = lectures simples, K-10)', KORA_ACTIONS.filter(a => a.pad === 'keybrand').every(a => a.mode === 'read'));
  check('toutes les desc ≤ 240 car.', KORA_ACTIONS.every(a => (a.desc || '').length <= 240));
  check('tous les desc de params ≤ 90 car.', KORA_ACTIONS.every(a => (a.params || []).every(p => (p.desc || '').length <= 90)));
  check('toute action keybrand déclare un target', KORA_ACTIONS.filter(a => a.pad === 'keybrand').every(a => !!a.target));
  check('KORA_PAD_META a une entrée keybrand (label+desc≤160)',
    KORA_PAD_META.some(p => p.pad === 'keybrand' && p.label && p.desc && p.desc.length <= 160));
  const open = KORA_ACTIONS.find(a => a.id === 'os.open_pad');
  check('os.open_pad mentionne keybrand', /keybrand/.test(open.desc) && /keybrand/.test(open.params[0].desc));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 9 — Syntaxe (node --check)\x1b[0m');
for (const f of ['app/kora-actions.js', 'workers/src/routes/kora.js', 'workers/src/routes/key-brand.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
