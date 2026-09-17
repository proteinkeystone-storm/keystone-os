/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — SDQR · historique durable des scans (2026-09-17)
   ───────────────────────────────────────────────────────────────
   POURQUOI. Le journal brut `qr_scans` s'efface à 90 jours (RGPD, cron
   quotidien). Le compteur montré au client baissait donc tout seul : le
   17/09/2026, Bel'Arti — un QR sur une bâche de programme immobilier —
   affichait 320 scans alors qu'il en a 437 depuis le 3 juin. Un chantier
   dure des années : le lancement de campagne ne doit pas s'évaporer.

   COMMENT. `qr_scan_daily` (migration 020) garde, par QR et par JOUR, le
   nombre de scans et d'empreintes distinctes. C'est un agrégat ANONYME
   (aucun pays, appareil, empreinte ni horodatage fin) : il se conserve
   sans limite, et la rétention du journal brut ne change pas.

   RÈGLES (tenues par le banc scripts/test-qr-scan-history.mjs) :
     1. On ne consolide que les jours RÉVOLUS (`day < date('now')`). À la
        lecture, le brut sert pour tout jour STRICTEMENT POSTÉRIEUR au
        dernier jour consolidé de ce QR — jamais de double comptage, et pas
        de trou entre minuit UTC et le passage du cron de 3 h (la veille
        n'est alors ni consolidée ni « aujourd'hui » : sans cette règle, le
        total du client plongeait trois heures par nuit).
     2. La consolidation ne BAISSE jamais une valeur (MAX) : un jour déjà
        rogné par la purge garde son vrai chiffre.
     3. Consolider PUIS purger, dans cet ordre, dans la même passe de cron.
     4. Les ventilations fines (pays, appareil, OS, heatmap) restent sur le
        brut : elles couvrent la fenêtre de rétention, et les écrans le
        disent. Seuls les TOTAUX et les COURBES par jour sont durables.

   Volumétrie : une ligne par QR et par jour actif. 14 QR × 3 ans ≈ 15 k
   lignes — négligeable devant le journal brut qu'elle remplace.
   ═══════════════════════════════════════════════════════════════ */

let _schemaReady = false;

/* Crée la table si la migration n'a pas (encore) tourné. Idempotent, et
   mémorisé pour ne pas payer deux DDL par requête. */
export async function ensureScanDailySchema(env) {
  if (_schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS qr_scan_daily (
      short_id   TEXT    NOT NULL,
      day        TEXT    NOT NULL,
      scans      INTEGER NOT NULL DEFAULT 0,
      uniques    INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (short_id, day)
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_qr_scan_daily_day ON qr_scan_daily(day)'),
  ]);
  _schemaReady = true;
}

/* `days` ne vient que de la liste blanche PERIOD_DAYS (7/30/90/null) mais
   on le borne ici aussi : cette valeur est interpolée dans le SQL. */
const dayWindow = (days) => {
  const n = parseInt(days, 10);
  return Number.isFinite(n) && n > 0 && n <= 36500 ? n : null;
};

/* ── Consolidation des jours révolus (appelée avant la purge) ──────
   Rend { lignes, jours } pour le journal du cron. */
export async function consolidateScanDaily(env) {
  await ensureScanDailySchema(env);
  const r = await env.DB.prepare(`
    INSERT INTO qr_scan_daily (short_id, day, scans, uniques, updated_at)
    SELECT short_id, date(ts) AS day, COUNT(*) AS scans,
           COUNT(DISTINCT ua_hash) AS uniques, datetime('now')
      FROM qr_scans
     WHERE date(ts) < date('now')
     GROUP BY short_id, date(ts)
    ON CONFLICT(short_id, day) DO UPDATE SET
      scans      = MAX(qr_scan_daily.scans,   excluded.scans),
      uniques    = MAX(qr_scan_daily.uniques, excluded.uniques),
      updated_at = excluded.updated_at
  `).run();
  const jours = await env.DB.prepare('SELECT COUNT(DISTINCT day) AS n FROM qr_scan_daily').first();
  return { lignes: r?.meta?.changes ?? 0, jours: jours?.n ?? 0 };
}

/* Frontière, par QR : le dernier jour DÉJÀ consolidé. Le journal brut ne
   compte que les jours d'après. Un QR jamais consolidé (ou une base neuve
   avant le premier cron) a pour frontière '0000-00-00' : tout son brut
   compte, exactement comme avant ce chantier. */
const BOUNDARY = `IFNULL((SELECT MAX(d.day) FROM qr_scan_daily d WHERE d.short_id = s.short_id), '0000-00-00')`;

/* ── Totaux par QR : compteur + brut non encore consolidé ─────────
   → Map short_id → { scans, uniques, lastDay }
   `days` = fenêtre en jours (null = toute la vie du QR).
   Note : la fenêtre est en JOURS pleins (`day >= date('now','-Nd')`), là
   où le brut utilisait des heures glissantes — l'écart se limite au jour
   le plus ancien de la fenêtre. */
export async function scanTotals(env, shortIds, days = null) {
  const out = new Map();
  if (!shortIds || !shortIds.length) return out;
  await ensureScanDailySchema(env);
  const ph = shortIds.map(() => '?').join(',');
  const n = dayWindow(days);
  const win = n ? `AND day >= date('now', '-${n} days')` : '';

  const past = await env.DB.prepare(`
    SELECT short_id, SUM(scans) AS scans, SUM(uniques) AS uniques, MAX(day) AS last_day
      FROM qr_scan_daily
     WHERE short_id IN (${ph}) ${win}
     GROUP BY short_id
  `).bind(...shortIds).all();
  for (const r of past.results || []) {
    out.set(r.short_id, { scans: r.scans || 0, uniques: r.uniques || 0, lastDay: r.last_day || null });
  }

  const frais = await env.DB.prepare(`
    SELECT s.short_id, COUNT(*) AS scans, COUNT(DISTINCT s.ua_hash) AS uniques, MAX(date(s.ts)) AS last_day
      FROM qr_scans s
     WHERE s.short_id IN (${ph}) AND date(s.ts) > ${BOUNDARY}
       ${n ? `AND date(s.ts) >= date('now', '-${n} days')` : ''}
     GROUP BY s.short_id
  `).bind(...shortIds).all();
  for (const r of frais.results || []) {
    const e = out.get(r.short_id) || { scans: 0, uniques: 0, lastDay: null };
    e.scans += r.scans || 0;
    e.uniques += r.uniques || 0;
    if (!e.lastDay || (r.last_day && r.last_day > e.lastDay)) e.lastDay = r.last_day || e.lastDay;
    out.set(r.short_id, e);
  }
  return out;
}

/* ── Courbe globale par jour (tous les QR passés en argument) ──────
   → [{ day, cnt }] croissant. Les deux sources sont fusionnées par jour :
   un même jour peut venir du compteur pour un QR et du brut pour un autre. */
export async function scanByDay(env, shortIds, days = null) {
  if (!shortIds || !shortIds.length) return [];
  await ensureScanDailySchema(env);
  const ph = shortIds.map(() => '?').join(',');
  const n = dayWindow(days);
  const win = n ? `AND day >= date('now', '-${n} days')` : '';
  const jours = new Map();
  const add = (day, cnt) => jours.set(day, (jours.get(day) || 0) + (cnt || 0));

  const past = await env.DB.prepare(`
    SELECT day, SUM(scans) AS cnt FROM qr_scan_daily
     WHERE short_id IN (${ph}) ${win}
     GROUP BY day
  `).bind(...shortIds).all();
  for (const r of past.results || []) add(r.day, r.cnt);

  const frais = await env.DB.prepare(`
    SELECT date(s.ts) AS day, COUNT(*) AS cnt FROM qr_scans s
     WHERE s.short_id IN (${ph}) AND date(s.ts) > ${BOUNDARY}
       ${n ? `AND date(s.ts) >= date('now', '-${n} days')` : ''}
     GROUP BY date(s.ts)
  `).bind(...shortIds).all();
  for (const r of frais.results || []) add(r.day, r.cnt);

  return [...jours.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, cnt]) => ({ day, cnt }));
}

/* ── Courbe par QR, toute l'histoire (sparkline des cartes) ────────
   → Map short_id → [{ day, cnt }] croissant. */
export async function scanSeriesByQr(env, shortIds) {
  const out = new Map();
  if (!shortIds || !shortIds.length) return out;
  await ensureScanDailySchema(env);
  const ph = shortIds.map(() => '?').join(',');
  const par = new Map();                       // short → Map(day → cnt)
  const add = (short, day, cnt) => {
    if (!par.has(short)) par.set(short, new Map());
    const m = par.get(short);
    m.set(day, (m.get(day) || 0) + (cnt || 0));
  };
  const past = await env.DB.prepare(`
    SELECT short_id, day, scans AS cnt FROM qr_scan_daily WHERE short_id IN (${ph})
  `).bind(...shortIds).all();
  for (const r of past.results || []) add(r.short_id, r.day, r.cnt);
  const frais = await env.DB.prepare(`
    SELECT s.short_id, date(s.ts) AS day, COUNT(*) AS cnt FROM qr_scans s
     WHERE s.short_id IN (${ph}) AND date(s.ts) > ${BOUNDARY}
     GROUP BY s.short_id, date(s.ts)
  `).bind(...shortIds).all();
  for (const r of frais.results || []) add(r.short_id, r.day, r.cnt);
  for (const [short, m] of par) {
    out.set(short, [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, cnt]) => ({ day, cnt })));
  }
  return out;
}

/* ── Effacement RGPD (suppression d'un tenant) ─────────────────────
   Les compteurs d'un tenant partent avec ses QR. */
export async function deleteScanDailyForTenant(env, tenantId) {
  await ensureScanDailySchema(env);
  const r = await env.DB.prepare(
    'DELETE FROM qr_scan_daily WHERE short_id IN (SELECT short_id FROM qr_redirects WHERE tenant_id = ?)'
  ).bind(tenantId).run();
  return r?.meta?.changes || 0;
}
