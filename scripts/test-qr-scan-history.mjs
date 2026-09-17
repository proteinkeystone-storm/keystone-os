/* ═══════════════════════════════════════════════════════════════
   Banc — SDQR · historique DURABLE des scans (17/09/2026)
   ───────────────────────────────────────────────────────────────
   Le défaut qu'il verrouille : la purge RGPD du journal brut (90 j)
   faisait BAISSER le compteur montré au client. Bel'Arti, sur une bâche
   de programme immobilier, affichait 320 scans pour 437 réels.

   Ce que ce banc PROUVE, avec le VRAI cron de purge :
     1. La consolidation ne prend que les jours RÉVOLUS (le jour courant
        reste servi par le brut) → aucun double comptage.
     2. Elle est idempotente et ne BAISSE jamais une valeur, même quand la
        purge a déjà rogné le brut du jour consolidé.
     3. Après une purge réelle, le total par QR NE BOUGE PAS — y compris
        pour un QR dont TOUT le brut est parti.
     4. Si la consolidation échoue, la purge n'a pas lieu (on garde le brut
        un jour de plus plutôt que de perdre l'historique).
     5. Fenêtres (7/30/90 j), courbe par jour, courbe par QR : justes.
     6. Effacement RGPD d'un tenant : ses compteurs partent aussi, ceux des
        autres restent.
   Lancement : node scripts/test-qr-scan-history.mjs
   ═══════════════════════════════════════════════════════════════ */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { consolidateScanDaily, scanTotals, scanByDay, scanSeriesByQr, deleteScanDailyForTenant } from '../workers/src/lib/qr-history.js';
import { handleScheduledPurge, handleListQr, handleQrOverview, handleStatsQr } from '../workers/src/routes/qr.js';
import { signJWT } from '../workers/src/lib/jwt.js';

let pass = 0, fail = 0;
const ok  = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko  = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));
const eq  = (a, e, l) => (JSON.stringify(a) === JSON.stringify(e) ? ok(l) : ko(l, `attendu ${JSON.stringify(e)}, reçu ${JSON.stringify(a)}`));

/* ── D1 simulée (SQLite en mémoire), avec batch() ─────────────────── */
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
  return { prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; }, _db: db };
}

const DB = makeD1();
DB._db.exec(`CREATE TABLE qr_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, short_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')), country TEXT,
  device_kind TEXT, os_kind TEXT, ua_hash TEXT);
CREATE TABLE qr_redirects (short_id TEXT PRIMARY KEY, tenant_id TEXT, target_url TEXT, status TEXT, qr_type TEXT, encoded_payload TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE system_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
INSERT INTO qr_redirects (short_id, tenant_id, target_url, status) VALUES
  ('BEL','promethee','https://ex.test/bel','active'),
  ('OLD','promethee','https://ex.test/old','active'),
  ('AUTRE','client-b','https://ex.test/autre','active');`);
DB._db.exec(readFileSync(new URL('../workers/migrations/020_qr_scan_daily.sql', import.meta.url), 'utf8'));

const env = { DB, SDQR_SCAN_RETENTION_DAYS: '90' };
const today = new Date().toISOString().slice(0, 10);
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const scan = (short, day, ua, h = '10') =>
  DB._db.prepare(`INSERT INTO qr_scans (short_id, ts, country, device_kind, os_kind, ua_hash) VALUES (?, ?, 'FR', 'mobile', 'ios', ?)`)
    .run(short, `${day} ${h}:00:00`, ua);

/* Bel'Arti : 3 scans il y a 100 j (au-delà de la rétention), 5 il y a 40 j,
   2 aujourd'hui. OLD : 4 scans il y a 120 j, plus rien. AUTRE : 2 il y a 10 j. */
for (const ua of ['a1', 'a2', 'a2']) scan('BEL', dayAgo(100), ua);
for (const ua of ['b1', 'b2', 'b3', 'b3', 'b3']) scan('BEL', dayAgo(40), ua);
for (const ua of ['c1', 'c2']) scan('BEL', today, ua);
for (const ua of ['d1', 'd1', 'd2', 'd3']) scan('OLD', dayAgo(120), ua);
for (const ua of ['e1', 'e2']) scan('AUTRE', dayAgo(10), ua);
const rawCount = () => DB._db.prepare('SELECT COUNT(*) AS n FROM qr_scans').get().n;

console.log('\n▶ 1 · Consolidation : jours révolus seulement, jamais de double compte');
{
  const r = await consolidateScanDaily(env);
  yes(r.lignes >= 4, `consolidé (${r.lignes} ligne(s), ${r.jours} jour(s))`);
  const rows = DB._db.prepare('SELECT short_id, day, scans, uniques FROM qr_scan_daily ORDER BY short_id, day').all();
  eq(rows.filter(x => x.day === today).length, 0, 'le jour courant n’entre PAS dans le compteur');
  const bel100 = rows.find(x => x.short_id === 'BEL' && x.day === dayAgo(100));
  eq([bel100.scans, bel100.uniques], [3, 2], 'BEL il y a 100 j : 3 scans, 2 visiteurs distincts');
  const bel40 = rows.find(x => x.short_id === 'BEL' && x.day === dayAgo(40));
  eq([bel40.scans, bel40.uniques], [5, 3], 'BEL il y a 40 j : 5 scans, 3 visiteurs distincts');

  const t = await scanTotals(env, ['BEL', 'OLD', 'AUTRE']);
  eq(t.get('BEL').scans, 10, 'total BEL = 8 (compteur) + 2 (brut du jour) = 10');
  eq(t.get('BEL').lastDay, today, 'dernier jour actif = aujourd’hui');
  eq(t.get('OLD').scans, 4, 'total OLD = 4');
  eq(t.get('AUTRE').scans, 2, 'total AUTRE = 2 (isolation par short_id)');

  const again = await consolidateScanDaily(env);
  const rows2 = DB._db.prepare('SELECT short_id, day, scans, uniques FROM qr_scan_daily ORDER BY short_id, day').all();
  eq(rows2, rows, 'deuxième passe : rien ne change (idempotent)');
  yes(again.lignes >= 0, 'deuxième passe sans erreur');
}

console.log('\n▶ 1 bis · La nuit, entre minuit UTC et le cron de 3 h');
{
  /* La veille n'est pas encore consolidée : elle n'est ni dans le compteur,
     ni « aujourd'hui ». Sans la frontière par QR, le total plongeait. */
  for (const ua of ['n1', 'n2', 'n3']) scan('BEL', dayAgo(1), ua);
  const t = await scanTotals(env, ['BEL']);
  eq(t.get('BEL').scans, 13, 'veille non consolidée comptée quand même : 8 + 3 (hier) + 2 (aujourd’hui)');
  eq(t.get('BEL').lastDay, today, 'dernier jour actif toujours juste');
  const s = await scanByDay(env, ['BEL']);
  eq(s.filter(r => r.day === dayAgo(1)).length, 1, 'la veille n’apparaît qu’une fois dans la courbe');
  await consolidateScanDaily(env);
  const t2 = await scanTotals(env, ['BEL']);
  eq(t2.get('BEL').scans, 13, 'après consolidation de la veille : toujours 13, pas 16 (aucun double compte)');
}

console.log('\n▶ 2 · Fenêtres, courbes');
{
  const t90 = await scanTotals(env, ['BEL'], 90);
  eq(t90.get('BEL').scans, 10, '90 jours : 5 (J-40) + 3 (hier) + 2 (aujourd’hui) = 10 — les 3 de J-100 sont hors fenêtre');
  const t30 = await scanTotals(env, ['BEL'], 30);
  eq(t30.get('BEL').scans, 5, '30 jours : 3 (hier) + 2 (aujourd’hui)');
  const série = await scanByDay(env, ['BEL']);
  eq(série.map(r => r.day), [dayAgo(100), dayAgo(40), dayAgo(1), today], 'courbe par jour : quatre points, dans l’ordre');
  eq(série.filter(r => r.day === today).length, 1, 'aujourd’hui n’apparaît qu’UNE fois');
  eq(série.find(r => r.day === today).cnt, 2, '… avec les 2 scans du jour');
  const parQr = await scanSeriesByQr(env, ['BEL', 'OLD']);
  eq(parQr.get('OLD').map(r => r.cnt), [4], 'courbe de OLD : son seul jour actif, même hors rétention');
}

console.log('\n▶ 3 · Le vrai cron de purge : le total ne bouge pas');
{
  const avant = await scanTotals(env, ['BEL', 'OLD']);
  const brutAvant = rawCount();
  await handleScheduledPurge(env);
  const brutApres = rawCount();
  yes(brutApres < brutAvant, `purge effectuée : ${brutAvant} → ${brutApres} lignes brutes`);
  eq(DB._db.prepare(`SELECT COUNT(*) AS n FROM qr_scans WHERE ts < datetime('now','-90 days')`).get().n, 0, 'plus rien au-delà de 90 jours dans le brut');
  const apres = await scanTotals(env, ['BEL', 'OLD']);
  eq(apres.get('BEL').scans, avant.get('BEL').scans, 'total BEL INCHANGÉ après la purge (13)');
  eq(apres.get('OLD').scans, 4, 'total OLD INCHANGÉ (4) alors que son brut a entièrement disparu');
  const meta = JSON.parse(DB._db.prepare(`SELECT value FROM system_meta WHERE key = 'last_purge_at'`).get().value);
  yes(meta.status === 'ok' && meta.consolide && meta.consolide.jours >= 3, 'le cron journalise la consolidation avant la purge');

  await consolidateScanDaily(env);
  const t = await scanTotals(env, ['BEL', 'OLD']);
  eq(t.get('BEL').scans, 13, 'consolider APRÈS la purge ne baisse rien (MAX)');
  eq(t.get('OLD').scans, 4, '… idem pour un QR sans brut');
}

console.log('\n▶ 4 · Garde-fou : consolidation en échec → pas de purge');
{
  for (const ua of ['f1', 'f2']) scan('BEL', dayAgo(200), ua);      // du brut à purger
  const brutAvant = rawCount();
  const envCasse = {
    ...env,
    DB: {
      ...DB,
      prepare(sql) {
        if (/INSERT INTO qr_scan_daily/.test(sql)) {
          return { bind() { return this; }, async run() { throw new Error('D1 indisponible'); }, async first() { throw new Error('D1 indisponible'); }, async all() { throw new Error('D1 indisponible'); } };
        }
        return DB.prepare(sql);
      },
      batch: DB.batch.bind(DB),
    },
  };
  await handleScheduledPurge(envCasse);
  eq(rawCount(), brutAvant, 'consolidation impossible → AUCUNE ligne brute supprimée');
  const meta = JSON.parse(DB._db.prepare(`SELECT value FROM system_meta WHERE key = 'last_purge_at'`).get().value);
  yes(meta.status === 'failed' && /consolidation/.test(meta.error || ''), 'échec journalisé, cause nommée');
  await handleScheduledPurge(env);                                   // retour à la normale
  yes(rawCount() < brutAvant, 'la passe suivante consolide puis purge normalement');
  const t = await scanTotals(env, ['BEL']);
  eq(t.get('BEL').scans, 15, 'les 2 scans de J-200 sont comptés avant de disparaître (13 + 2)');
}

console.log('\n▶ 5 · Effacement RGPD d’un tenant');
{
  const n = await deleteScanDailyForTenant(env, 'promethee');
  yes(n >= 3, `compteurs du tenant supprimés (${n} ligne(s))`);
  const t = await scanTotals(env, ['BEL', 'OLD', 'AUTRE']);
  eq(t.get('BEL')?.scans ?? 0, 10, 'BEL : il ne reste que son brut encore présent (J-40, hier, aujourd’hui)');
  eq(t.get('OLD')?.scans ?? 0, 0, 'OLD : plus rien');
  eq(t.get('AUTRE').scans, 2, 'le tenant voisin garde son compteur');
}

console.log('\n▶ 6 · Les VRAIS écrans du pad (liste, vue d’ensemble, fiche)');
{
  /* Ce que le client voit vraiment : les trois routes, avant et après une
     purge. C'est l'assertion qui compte commercialement. */
  DB._db.exec(`CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY, tenant_id TEXT, type TEXT, data TEXT,
    deleted_at TEXT, updated_at TEXT DEFAULT (datetime('now')));
  DELETE FROM entities;
  INSERT INTO entities (id, tenant_id, type, data) VALUES
    ('e-bel','promethee','qr_codes','{"short_id":"BEL","name":"Bel Arti","mode":"dynamic","status":"active","qr_type":"url","folder":"Promethee"}'),
    ('e-old','promethee','qr_codes','{"short_id":"OLD","name":"Ancien","mode":"dynamic","status":"active","qr_type":"url","folder":"Promethee"}');`);
  DB._db.exec(`DELETE FROM qr_scan_daily; DELETE FROM qr_scans;`);
  for (const ua of ['a1', 'a2', 'a2']) scan('BEL', dayAgo(100), ua);   // partira à la purge
  for (const ua of ['b1', 'b2', 'b3']) scan('BEL', dayAgo(40), ua);
  for (const ua of ['c1', 'c2']) scan('BEL', today, ua);
  for (const ua of ['d1', 'd2']) scan('OLD', dayAgo(120), ua);         // partira aussi
  await consolidateScanDaily(env);

  const envApi = { ...env, KS_JWT_SECRET: 'secret-de-banc-32-octets-minimum-0123456789', KS_ALLOWED_ORIGIN: '*' };
  const jwt = await signJWT({ sub: 'promethee', plan: 'PRO', owner: 'Prométhée' }, envApi);
  const rq = (path) => new Request('https://api.test' + path, { headers: { Authorization: 'Bearer ' + jwt } });
  const lire = async (r) => (await r.json());

  const liste1 = await lire(await handleListQr(rq('/api/qr/list'), envApi));
  const bel1 = liste1.qrs.find(q => q.short_id === 'BEL');
  eq(bel1.scans_total, 8, 'liste : Bel Arti à 8 (3 + 3 + 2), tout son historique');
  yes(Array.isArray(bel1.scans_series) && bel1.scans_series.some(v => v > 0), 'liste : la courbe de la carte est remplie');

  const vue1 = await lire(await handleQrOverview(rq('/api/qr/overview?period=all'), envApi));
  eq(vue1.totals.scans_total, 10, 'vue d’ensemble « tout » : 8 + 2 = 10 scans du tenant');
  eq(vue1.leaderboard[0].scans, 8, '… classement mené par Bel Arti');
  const fiche1 = await lire(await handleStatsQr(rq('/api/qr/e-bel/stats?period=all'), envApi, 'e-bel'));
  eq(fiche1.totals.total, 8, 'fiche du QR « tout » : 8');
  eq(fiche1.byDay.length, 3, '… trois jours dans la courbe');

  await handleScheduledPurge(envApi);

  const liste2 = await lire(await handleListQr(rq('/api/qr/list'), envApi));
  eq(liste2.qrs.find(q => q.short_id === 'BEL').scans_total, 8, 'APRÈS LA PURGE — liste : toujours 8');
  const vue2 = await lire(await handleQrOverview(rq('/api/qr/overview?period=all'), envApi));
  eq(vue2.totals.scans_total, 10, 'APRÈS LA PURGE — vue d’ensemble : toujours 10');
  const fiche2 = await lire(await handleStatsQr(rq('/api/qr/e-bel/stats?period=all'), envApi, 'e-bel'));
  eq(fiche2.totals.total, 8, 'APRÈS LA PURGE — fiche : toujours 8');
  eq(fiche2.byDay.length, 3, '… et toujours trois jours de courbe');
  yes(fiche2.byCountry.length >= 0 && fiche2.heatmap.length >= 0, 'les ventilations fines répondent (fenêtre de rétention)');
  const vue3 = await lire(await handleQrOverview(rq('/api/qr/overview?period=7d'), envApi));
  eq(vue3.totals.scans_total, 2, 'fenêtre 7 jours : les 2 scans du jour');
}

console.log(`\n${pass + fail} vérifications — ${pass} \x1b[32mok\x1b[0m, ${fail} ${fail ? '\x1b[31mko\x1b[0m' : 'ko'}\n`);
process.exit(fail ? 1 : 0);
