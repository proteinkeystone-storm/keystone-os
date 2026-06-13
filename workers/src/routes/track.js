/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Funnel landing (mesure d'audience souveraine)
   ─────────────────────────────────────────────────────────────
   POST /api/track          public — enregistre un événement de funnel
   GET  /api/admin/funnel   admin  — agrégats + taux de conversion

   Souverain & RGPD : zéro cookie, zéro donnée personnelle, zéro IP.
   Un identifiant de SESSION éphémère (sessionStorage côté client, non
   persistant) relie les étapes d'UNE visite pour calculer les taux —
   sans jamais identifier qui que ce soit. Mode « mesure d'audience
   exemptée de consentement » (pas de bandeau cookies).

   Minimisation : les événements bruts sont purgés après 90 jours
   (pruneTrackEvents, appelé par le cron quotidien).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin } from '../lib/auth.js';

// Étapes du funnel — liste blanche STRICTE (tout autre nom est ignoré).
const EVENTS = new Set(['view', 'demo', 'plan', 'lead', 'activate']);
const SESSION_ROW_CAP = 60;   // garde-fou anti-flood : max d'événements par session

let _trackSchemaReady = false;
async function ensureTrackSchema(env) {
  if (_trackSchemaReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS landing_events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        session TEXT NOT NULL,
        name    TEXT NOT NULL,
        plan    TEXT,
        day     TEXT NOT NULL,
        ts      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_landing_events_day ON landing_events(day, name)').run().catch(() => {});
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_landing_events_ts ON landing_events(ts)').run().catch(() => {});
  } catch (_) { /* déjà créé : OK */ }
  _trackSchemaReady = true;
}

// ── POST /api/track ───────────────────────────────────────────
export async function handleTrack(request, env) {
  const origin = getAllowedOrigin(env, request);
  await ensureTrackSchema(env);

  const b = await parseBody(request);
  const name = (typeof b?.e === 'string') ? b.e.trim().toLowerCase() : '';
  if (!EVENTS.has(name)) return json({ ok: true }, 200, origin);   // ignoré silencieusement (bot/bruit)

  // Session éphémère : alphanumérique, bornée. Pas de session → on ignore
  // (un vrai visiteur en a toujours une, posée par le helper de la landing).
  const session = (typeof b?.s === 'string') ? b.s.replace(/[^A-Za-z0-9]/g, '').slice(0, 32) : '';
  if (!session) return json({ ok: true }, 200, origin);

  // Plan (uniquement pertinent pour l'événement 'plan').
  const plan = (name === 'plan' && typeof b?.p === 'string')
    ? b.p.trim().toLowerCase().slice(0, 20) : null;

  // Anti-flood : on borne le nombre d'événements d'une même session.
  const n = await env.DB
    .prepare('SELECT COUNT(*) AS c FROM landing_events WHERE session = ?')
    .bind(session).first().catch(() => null);
  if ((n?.c ?? 0) >= SESSION_ROW_CAP) return json({ ok: true }, 200, origin);

  const day = new Date().toISOString().slice(0, 10);
  await env.DB
    .prepare('INSERT INTO landing_events (session, name, plan, day) VALUES (?, ?, ?, ?)')
    .bind(session, name, plan, day).run().catch(() => {});

  return json({ ok: true }, 200, origin);
}

// ── GET /api/admin/funnel (?days=30) ──────────────────────────
export async function handleFunnel(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureTrackSchema(env);

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 30, 1), 365);
  const since = `-${days} day`;

  // Funnel = nb de SESSIONS distinctes ayant atteint chaque étape (robuste
  // aux double-envois) + nb d'événements bruts, sur la fenêtre demandée.
  const rows = (await env.DB.prepare(`
    SELECT name,
           COUNT(*)               AS events,
           COUNT(DISTINCT session) AS sessions
    FROM landing_events
    WHERE ts >= datetime('now', ?)
    GROUP BY name
  `).bind(since).all().catch(() => ({ results: [] }))).results || [];

  const by = Object.fromEntries(rows.map(r => [r.name, { events: r.events, sessions: r.sessions }]));
  const get = k => (by[k]?.sessions ?? 0);
  const views = get('view');
  const pct = n => (views > 0 ? Math.round((n / views) * 1000) / 10 : null);   // 1 décimale

  // Répartition des clics par plan.
  const plans = (await env.DB.prepare(`
    SELECT plan, COUNT(*) AS clicks
    FROM landing_events
    WHERE name = 'plan' AND plan IS NOT NULL AND ts >= datetime('now', ?)
    GROUP BY plan ORDER BY clicks DESC
  `).bind(since).all().catch(() => ({ results: [] }))).results || [];

  return json({
    window_days: days,
    funnel: {
      visites:        { sessions: get('view'),     events: by.view?.events     ?? 0, pct: 100 },
      demo_essayee:   { sessions: get('demo'),     events: by.demo?.events     ?? 0, pct: pct(get('demo')) },
      plan_clique:    { sessions: get('plan'),     events: by.plan?.events     ?? 0, pct: pct(get('plan')) },
      email_laisse:   { sessions: get('lead'),     events: by.lead?.events     ?? 0, pct: pct(get('lead')) },
      activation:     { sessions: get('activate'), events: by.activate?.events ?? 0, pct: pct(get('activate')) },
    },
    plans_clics: plans,
  }, 200, origin);
}

// ── Purge >90j — appelée par le cron quotidien (minimisation RGPD) ──
export async function pruneTrackEvents(env) {
  try {
    const r = await env.DB
      .prepare("DELETE FROM landing_events WHERE ts < datetime('now', '-90 day')")
      .run();
    return { deleted: r?.meta?.changes ?? 0 };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}
