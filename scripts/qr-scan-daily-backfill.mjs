/* ═══════════════════════════════════════════════════════════════
   SDQR — reconstitution de l'historique des scans (17/09/2026)
   ───────────────────────────────────────────────────────────────
   Le journal brut `qr_scans` s'efface à 90 jours. Les scans déjà partis
   vivent encore dans nos exports SQL (`_backups/qr_scans-prod-*.sql`) :
   ce script les relit, dédoublonne par `id` (clé AUTOINCREMENT, jamais
   réattribuée) et produit le SQL qui remplit le compteur journalier
   `qr_scan_daily` — sans jamais BAISSER une valeur déjà en base.

   Sources au 17/09/2026 :
     · qr_scans-prod-20260621-185627.sql — 529 lignes, 11/05 → 21/06
     · qr_scans-prod-2026-09-17.sql      — 475 lignes, 19/06 → 17/09
     Union : 996 scans distincts. Bel'Arti (1Wm27YVH) : 437.

   Le JOUR COURANT est volontairement exclu : il est servi depuis le
   journal brut (règle 1 de lib/qr-history.js — jamais de double compte).
   Le cron de la nuit le consolidera tout seul.

   Usage :
     node scripts/qr-scan-daily-backfill.mjs                 # → _backups/qr-scan-daily-backfill.sql
     node scripts/qr-scan-daily-backfill.mjs --skip-day=2026-09-17 --out=/tmp/x.sql
   Puis, APRÈS relecture :
     cd workers && npx wrangler d1 execute keystone-os --remote --file=../_backups/qr-scan-daily-backfill.sql
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const skipDay = arg('skip-day', new Date().toISOString().slice(0, 10));
const out     = arg('out', join(ROOT, '_backups', 'qr-scan-daily-backfill.sql'));

/* ── Lecture des exports SQL de qr_scans ──────────────────────────── */
const ROW = /^INSERT INTO "?qr_scans"?\s*\([^)]*\)\s*VALUES\s*\((\d+),'([^']*)','([^']*)',(?:'([^']*)'|NULL),(?:'([^']*)'|NULL),(?:'([^']*)'|NULL),(?:'([^']*)'|NULL)\)/;
const files = readdirSync(join(ROOT, '_backups'))
  .filter(f => /^qr_scans.*\.sql$/.test(f))
  .sort();
if (!files.length) { console.error('Aucun export qr_scans-*.sql dans _backups/'); process.exit(1); }

const rows = new Map();                       // id → { short, day, ua }
for (const f of files) {
  let n = 0, kept = 0;
  for (const line of readFileSync(join(ROOT, '_backups', f), 'utf8').split('\n')) {
    const m = line.match(ROW);
    if (!m) continue;
    n++;
    const [, id, short, ts, , , , ua] = m;
    const day = ts.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!rows.has(+id)) kept++;
    rows.set(+id, { short, day, ua: ua || '' });
  }
  console.log(`  ${f} : ${n} lignes lues, ${kept} nouvelles`);
}

/* ── Agrégation par (short_id, jour) ─────────────────────────────── */
const per = new Map();                        // short|day → { scans, uas:Set }
let ignoresJour = 0;
for (const r of rows.values()) {
  if (r.day >= skipDay) { ignoresJour++; continue; }   // jour courant (et futur) : servi par le brut
  const k = r.short + '|' + r.day;
  const e = per.get(k) || { short: r.short, day: r.day, scans: 0, uas: new Set() };
  e.scans++; if (r.ua) e.uas.add(r.ua);
  per.set(k, e);
}

const parQr = new Map();
for (const e of per.values()) parQr.set(e.short, (parQr.get(e.short) || 0) + e.scans);

/* ── SQL idempotent, jamais à la baisse ──────────────────────────── */
const esc = (s) => String(s).replace(/'/g, "''");
const lines = [
  '-- Reconstitution du compteur journalier des scans (qr_scan_daily).',
  `-- Généré le ${new Date().toISOString()} depuis : ${files.join(', ')}`,
  `-- Jour courant exclu : ${skipDay} (servi par le journal brut).`,
  '-- Idempotent : ON CONFLICT garde le MAXIMUM, jamais moins.',
  'CREATE TABLE IF NOT EXISTS qr_scan_daily (',
  '  short_id TEXT NOT NULL, day TEXT NOT NULL, scans INTEGER NOT NULL DEFAULT 0,',
  '  uniques INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')),',
  '  PRIMARY KEY (short_id, day));',
  'CREATE INDEX IF NOT EXISTS idx_qr_scan_daily_day ON qr_scan_daily(day);',
];
for (const e of [...per.values()].sort((a, b) => (a.day + a.short).localeCompare(b.day + b.short))) {
  lines.push(
    `INSERT INTO qr_scan_daily (short_id, day, scans, uniques, updated_at) VALUES ('${esc(e.short)}','${e.day}',${e.scans},${e.uas.size},datetime('now')) ` +
    `ON CONFLICT(short_id, day) DO UPDATE SET scans = MAX(qr_scan_daily.scans, excluded.scans), uniques = MAX(qr_scan_daily.uniques, excluded.uniques), updated_at = excluded.updated_at;`
  );
}
writeFileSync(out, lines.join('\n') + '\n');

/* ── Rapport ─────────────────────────────────────────────────────── */
console.log(`\n${rows.size} scans distincts · ${per.size} couples (QR, jour) · ${ignoresJour} scan(s) du jour courant ignoré(s)`);
console.log(`\nTotaux reconstitués (hors jour courant) :`);
for (const [short, n] of [...parQr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${short} : ${n}`);
}
console.log(`\nSQL écrit : ${out}`);
console.log(`À appliquer : cd workers && npx wrangler d1 execute keystone-os --remote --file=${out.replace(ROOT + '/', '../')}`);
