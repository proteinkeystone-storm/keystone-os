/* ═══════════════════════════════════════════════════════════════
   SDQR — réinjection des scans BRUTS depuis un export (17/09/2026)
   ───────────────────────────────────────────────────────────────
   Le compteur journalier (qr_scan_daily) connaît tous les scans depuis le
   11/05/2026, mais le journal brut `qr_scans` avait été rogné par l'ancienne
   purge : le détail fin (pays, appareil, système, heatmap, export CSV) ne
   couvrait plus que la fenêtre restante. Comme plus rien ne s'efface
   (SDQR_SCAN_PURGE = "off"), on peut remettre les lignes manquantes.

   Sûreté : chaque ligne est réinsérée avec son `id` d'origine et un
   INSERT OR IGNORE — une ligne déjà présente est ignorée, jamais dupliquée,
   et rejouer le script ne change rien. Aucune suppression, aucun UPDATE.

   Usage :
     node scripts/qr-scans-restore.mjs                 # → _backups/qr-scans-restore.sql
     node scripts/qr-scans-restore.mjs --only=1Wm27YVH # un seul QR
   Puis, APRÈS relecture :
     cd workers && npx wrangler d1 execute keystone-os --remote --file=../_backups/qr-scans-restore.sql
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const h = process.argv.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const only = arg('only', null);
const out  = arg('out', join(ROOT, '_backups', 'qr-scans-restore.sql'));

const ROW = /^INSERT INTO "?qr_scans"?\s*\([^)]*\)\s*VALUES\s*\((\d+),'([^']*)','([^']*)',(?:'([^']*)'|NULL),(?:'([^']*)'|NULL),(?:'([^']*)'|NULL),(?:'([^']*)'|NULL)\)/;
const files = readdirSync(join(ROOT, '_backups')).filter(f => /^qr_scans.*\.sql$/.test(f)).sort();
if (!files.length) { console.error('Aucun export qr_scans-*.sql dans _backups/'); process.exit(1); }

const rows = new Map();
for (const f of files) {
  let n = 0;
  for (const line of readFileSync(join(ROOT, '_backups', f), 'utf8').split('\n')) {
    const m = line.match(ROW);
    if (!m) continue;
    const [, id, short, ts, pays, device, os, ua] = m;
    if (only && short !== only) continue;
    if (!rows.has(+id)) n++;
    rows.set(+id, { id: +id, short, ts, pays: pays ?? null, device: device ?? null, os: os ?? null, ua: ua ?? null });
  }
  console.log(`  ${f} : ${n} ligne(s) retenue(s)`);
}

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const lines = [
  '-- Réinjection des scans bruts (idempotente : INSERT OR IGNORE sur l’id d’origine).',
  `-- Généré le ${new Date().toISOString()} depuis : ${files.join(', ')}${only ? ` — QR ${only} seulement` : ''}`,
  '-- Aucune suppression, aucun UPDATE. Rejouable sans effet.',
];
for (const r of [...rows.values()].sort((a, b) => a.id - b.id)) {
  lines.push(`INSERT OR IGNORE INTO qr_scans (id, short_id, ts, country, device_kind, os_kind, ua_hash) VALUES (${r.id},${q(r.short)},${q(r.ts)},${q(r.pays)},${q(r.device)},${q(r.os)},${q(r.ua)});`);
}
writeFileSync(out, lines.join('\n') + '\n');

const parQr = new Map();
for (const r of rows.values()) parQr.set(r.short, (parQr.get(r.short) || 0) + 1);
console.log(`\n${rows.size} ligne(s) prêtes à être réinjectées (les déjà présentes seront ignorées).`);
for (const [s, n] of [...parQr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${s} : ${n}`);
console.log(`\nSQL écrit : ${out}`);
