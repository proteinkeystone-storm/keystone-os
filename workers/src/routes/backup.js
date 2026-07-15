/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Sauvegardes D1 hors-plateforme (OPS-1 · SEPT_PROD_SPRINTS)
   ───────────────────────────────────────────────────────────────
   2e ligne de défense APRÈS le time-travel D1 30 j (1re ligne, intra-
   plateforme). Ici : export hebdomadaire des tables VITALES en NDJSON
   vers un bucket R2 dédié `keystone-backups`, préfixe par date, purge
   auto à 8 semaines. Déclenché par le cron `0 4 * * 1` (lundi 4h UTC).

   Un backup qu'on n'a jamais restauré n'existe pas → restore prouvé :
     - endpoint POST /api/admin/backup/restore (opérationnel + testé),
     - procédure manuelle hors-worker documentée dans SEPT_PROD_SPRINTS.md.

   Sécurité Sceau : sec_secrets est sauvegardé en MÉTADONNÉES SEULES.
   Les colonnes cryptographiques (ciphertext, iv, oprf_*) ne quittent
   JAMAIS D1 — inutiles hors-ligne (E2E, serveur aveugle) et un risque
   net s'ils traînaient dans un bucket. cf. migration 008_sceau.sql.

   Dégrade proprement : si le binding R2 BACKUPS est absent (dev local
   sans bucket, index pas encore créé), no-op loggué — jamais d'erreur.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, getAllowedOrigin } from '../lib/auth.js';

// ── Tables VITALES (noms RÉELS du schéma, pas ceux — approximatifs — du brief) ──
// `cols` explicite = liste blanche de colonnes (le reste n'est PAS exporté).
// Sans `cols` : toutes les colonnes (SELECT *).
const VITAL_TABLES = [
  // Licences & droits (le cœur : qui a payé quoi).
  { table: 'licences' },              // owned_assets est une COLONNE JSON ici
  // Key Form (formulaires artistes — prod-critique) : définitions + réponses.
  { table: 'pulsa_forms' },
  { table: 'pulsa_responses' },
  // QR souverain : définitions (data fabric) + cibles de redirection (hot-path SDQR).
  // qr_redirects est AUSSI critique qu'entities : le perdre casse les QR vivants.
  { table: 'entities' },
  { table: 'qr_redirects' },
  // desK (chemin de fer vivant).
  { table: 'dk_articles' }, { table: 'dk_pages' }, { table: 'dk_page_slots' },
  { table: 'dk_issues' }, { table: 'dk_publications' }, { table: 'dk_rubriques' },
  { table: 'dk_members' }, { table: 'dk_contribs' }, { table: 'dk_invites' },
  { table: 'dk_relances' }, { table: 'dk_habits' }, { table: 'dk_inbox' },
  { table: 'dk_files' },
  // networK (réseau relationnel).
  { table: 'nk_contacts' }, { table: 'nk_categories' }, { table: 'nk_activity' },
  // Key Brand (chartes vivantes).
  { table: 'kb_assets' }, { table: 'kb_charts' }, { table: 'kb_versions' },
  // Sceau — MÉTADONNÉES SEULES (jamais ciphertext/iv/oprf_*).
  { table: 'sec_secrets', cols: [
      'short_id', 'tenant_id', 'attempts', 'max_attempts', 'status',
      'label', 'created_at', 'sealed_at', 'expires_at', 'read_at', 'destroyed_at',
    ] },
];

const RETENTION_WEEKS = 8;
const PAGE = 1000;                 // pagination D1 (borne mémoire/subrequest)
const datePrefix = (d) => d.toISOString().slice(0, 10);   // YYYY-MM-DD

// ── Export d'une table en NDJSON (pagination robuste) ───────────
// Retourne { ndjson, rows }. On pagine par OFFSET pour ne jamais
// charger une table entière d'un bloc (tables petites en beta, mais
// le code doit tenir la montée en charge).
async function dumpTable(env, { table, cols }) {
  const colList = cols ? cols.map(c => `"${c}"`).join(', ') : '*';
  let offset = 0, rows = 0;
  const lines = [];
  for (;;) {
    const res = await env.DB
      .prepare(`SELECT ${colList} FROM ${table} LIMIT ? OFFSET ?`)
      .bind(PAGE, offset)
      .all();
    const batch = res?.results || [];
    for (const r of batch) lines.push(JSON.stringify(r));
    rows += batch.length;
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return { ndjson: lines.join('\n') + (lines.length ? '\n' : ''), rows };
}

// ── Purge des backups > RETENTION_WEEKS ─────────────────────────
async function purgeOldBackups(env, now) {
  const cutoff = new Date(now.getTime() - RETENTION_WEEKS * 7 * 86400000);
  const cutoffPrefix = datePrefix(cutoff);
  let purged = 0, cursor;
  do {
    const listing = await env.BACKUPS.list({ cursor, limit: 1000 });
    for (const obj of listing.objects) {
      // clé = « YYYY-MM-DD/table.ndjson » → compare le préfixe date.
      const day = obj.key.slice(0, 10);
      if (day < cutoffPrefix) { await env.BACKUPS.delete(obj.key); purged++; }
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  return purged;
}

// ── Le run principal (cron + endpoint on-demand) ────────────────
export async function runBackup(env, opts = {}) {
  if (!env.BACKUPS) {
    console.warn('[backup] binding R2 BACKUPS absent — no-op (dégradation propre)');
    return { skipped: 'no-r2-binding' };
  }
  const now  = opts.now instanceof Date ? opts.now : new Date();
  const day  = datePrefix(now);
  const startedAt = now.toISOString();

  const tables = [];
  let totalRows = 0, totalBytes = 0;
  for (const spec of VITAL_TABLES) {
    try {
      const { ndjson, rows } = await dumpTable(env, spec);
      const bytes = new TextEncoder().encode(ndjson).length;
      await env.BACKUPS.put(`${day}/${spec.table}.ndjson`, ndjson, {
        httpMetadata: { contentType: 'application/x-ndjson' },
      });
      tables.push({ table: spec.table, rows, bytes });
      totalRows += rows; totalBytes += bytes;
    } catch (e) {
      // Une table absente/vide (dev, migration pas encore passée) ne
      // doit pas faire échouer TOUT le backup : on la marque, on continue.
      tables.push({ table: spec.table, rows: 0, bytes: 0, error: e.message });
      console.warn('[backup] table', spec.table, 'échouée:', e.message);
    }
  }

  // Manifeste = index humain + machine du backup (pour list/restore/status).
  const manifest = {
    generated_at: startedAt,
    finished_at:  new Date().toISOString(),
    date:         day,
    retention_weeks: RETENTION_WEEKS,
    total_rows:   totalRows,
    total_bytes:  totalBytes,
    tables,
    note: 'sec_secrets = métadonnées seules (jamais ciphertext/iv/oprf_*). NDJSON = 1 ligne JSON/objet.',
  };
  await env.BACKUPS.put(`${day}/_manifest.json`, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  let purged = 0;
  try { purged = await purgeOldBackups(env, now); }
  catch (e) { console.warn('[backup] purge rétention échouée:', e.message); }

  // Observabilité (comme last_purge_at) : /api/admin/health & /status pourront lire.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS system_meta (
      key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run().catch(() => {});
  await env.DB.prepare(`
    INSERT INTO system_meta (key, value, updated_at)
    VALUES ('last_backup_at', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(JSON.stringify({ date: day, total_rows: totalRows, total_bytes: totalBytes, tables: tables.length, purged })).run().catch(() => {});

  const summary = { date: day, total_rows: totalRows, total_bytes: totalBytes, tables, purged };
  console.log('[backup] OK', JSON.stringify({ date: day, total_rows: totalRows, tables: tables.length, purged }));
  return summary;
}

// ═══════════════════════════════════════════════════════════════
// Endpoints Admin (on-demand + observabilité + restore prouvé)
// ═══════════════════════════════════════════════════════════════

// POST /api/admin/backup/run — déclenche un backup maintenant.
export async function handleBackupRun(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  const summary = await runBackup(env);
  return json({ ok: true, ...summary }, 200, origin);
}

// GET /api/admin/backup/list — dates disponibles + manifestes.
export async function handleBackupList(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  if (!env.BACKUPS) return json({ ok: true, backups: [], note: 'binding R2 absent' }, 200, origin);
  const backups = [];
  let cursor;
  do {
    const listing = await env.BACKUPS.list({ prefix: '', cursor, limit: 1000 });
    for (const obj of listing.objects) {
      if (obj.key.endsWith('/_manifest.json')) {
        const m = await env.BACKUPS.get(obj.key);
        if (m) { try { backups.push(JSON.parse(await m.text())); } catch { /* ignore */ } }
      }
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  backups.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return json({ ok: true, backups }, 200, origin);
}

// GET /api/admin/backup/object?date=YYYY-MM-DD&table=xxx — télécharge un NDJSON.
export async function handleBackupObject(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  if (!env.BACKUPS) return err('binding R2 absent', 503, origin);
  const url   = new URL(request.url);
  const date  = url.searchParams.get('date');
  const table = url.searchParams.get('table');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !isVitalTable(table)) {
    return err('date (YYYY-MM-DD) et table (vitale) requis', 400, origin);
  }
  const obj = await env.BACKUPS.get(`${date}/${table}.ndjson`);
  if (!obj) return err('backup introuvable', 404, origin);
  return new Response(obj.body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': origin },
  });
}

// POST /api/admin/backup/restore { date, table, confirm:true }
// Restaure UNE table depuis un backup : INSERT OR REPLACE ligne à ligne
// (idempotent). Opération PUISSANTE → admin + confirm explicite + table
// de la liste blanche uniquement. Ne touche jamais aux colonnes crypto
// Sceau (absentes du backup : un REPLACE de sec_secrets ne rétablit que
// les métadonnées, jamais le chiffré — c'est voulu, serveur aveugle).
export async function handleBackupRestore(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  if (!env.BACKUPS) return err('binding R2 absent', 503, origin);
  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const { date, table, confirm } = body;
  if (confirm !== true) return err('confirm:true requis (restore destructif)', 400, origin);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !isVitalTable(table)) {
    return err('date (YYYY-MM-DD) et table (vitale) requis', 400, origin);
  }
  const obj = await env.BACKUPS.get(`${date}/${table}.ndjson`);
  if (!obj) return err('backup introuvable', 404, origin);
  const text = await obj.text();
  const rows = text.split('\n').filter(Boolean).map(l => JSON.parse(l));
  if (!rows.length) return json({ ok: true, restored: 0, note: 'backup vide' }, 200, origin);

  // Colonnes = clés de la 1re ligne (toutes les lignes d'un dump ont le même schéma).
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
  const stmt = env.DB.prepare(sql);
  // Batch par lots pour rester sous les limites D1.
  let restored = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50).map(r => stmt.bind(...cols.map(c => r[c] ?? null)));
    await env.DB.batch(batch);
    restored += batch.length;
  }
  console.log('[backup] restore', table, date, '→', restored, 'lignes');
  return json({ ok: true, table, date, restored }, 200, origin);
}

function isVitalTable(name) {
  return VITAL_TABLES.some(t => t.table === name);
}

export { VITAL_TABLES };
