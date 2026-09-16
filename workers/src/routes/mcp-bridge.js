/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — MCP sprint 4 : LE PONT (l'onglet exécute pour Claude)
   ───────────────────────────────────────────────────────────────
   Un outil MCP marqué exec:'browser' n'est pas exécuté ici : le Worker
   vérifie qu'un onglet Keystone du même compte est en ligne, écrit un
   ORDRE (mcp_jobs), le pousse sur le canal SSE de cet onglet, attend
   la réponse (≤ 25 s) et la rend à Claude. Sans onglet, ou sans
   réponse à temps : repli bannette (si l'outil le permet), sinon une
   erreur claire — jamais une donnée inventée.

   Canal : GET /api/mcp/bridge/stream — réponse text/event-stream tenue
   ouverte (fetch + Authorization côté onglet, pas EventSource : jamais
   de jeton dans l'URL). Sans Durable Object (décision §1) : le Worker
   n'a pas de bus entre deux requêtes, le canal INTERROGE D1 toutes les
   2 s pour les ordres en attente de ce sub (UPDATE gardé : un ordre
   n'est remis qu'à UN onglet), bat toutes les 20 s (présence), et se
   referme au bout de 4 min (l'onglet se reconnecte). Coût : ~1 lecture
   D1 / 2 s / onglet ouvert — acceptable tant que le connecteur est
   muet ; à revoir avec un DO si le nombre d'onglets grimpe.

   Réponse : POST /api/mcp/bridge/jobs/:id/result { ok, data | error } —
   une seule fois, par le bon compte. Présence : GET /api/mcp/bridge/presence.

   Garde-fous : l'onglet n'exécute que les actions de son catalogue
   (app/bridge-actions.js) et le dit (« hors catalogue ») ; un ordre est
   lié au sub ; un ordre d'un autre compte n'apparaît jamais sur le canal.
   ═══════════════════════════════════════════════════════════════ */
import { json, err, parseBody, getAllowedOrigin, generateToken } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

export const BRIDGE_ONLINE_S    = 40;       // « en ligne » = battement < 40 s
export const BRIDGE_WAIT_MS     = 25_000;   // long-poll du Worker (limite Claude 30 s / 60 s)
export const BRIDGE_POLL_MS     = 600;      // cadence de relecture du résultat
const STREAM_POLL_MS            = 2_000;    // cadence de relecture des ordres sur le canal
const STREAM_BEAT_MS            = 20_000;   // battement de présence
const STREAM_MAX_MS             = 4 * 60_000;
const JOB_TTL_S                 = 60;
const MAX_ARGS                  = 32 * 1024;
const MAX_RESULT                = 64 * 1024;

let _ready = false;
export async function ensureMcpBridgeSchema(env) {
  if (_ready) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_bridge_presence (sub TEXT NOT NULL, tab_id TEXT NOT NULL,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (sub, tab_id))`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_mcp_bridge_presence_seen ON mcp_bridge_presence(sub, last_seen)').run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_jobs (id TEXT PRIMARY KEY, sub TEXT NOT NULL, tool TEXT NOT NULL, action TEXT NOT NULL,
    args_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result_json TEXT, error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), dispatched_at TEXT, done_at TEXT, expires_at TEXT NOT NULL)`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_mcp_jobs_sub_status ON mcp_jobs(sub, status, expires_at)').run();
  _ready = true;
}
const iso = (v) => (typeof v === 'string' && !/[TZ]/.test(v)) ? v.replace(' ', 'T') + 'Z' : v;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ═══ PRÉSENCE ═══ */
export async function bridgePresence(env, sub) {
  await ensureMcpBridgeSchema(env);
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(last_seen) AS last FROM mcp_bridge_presence
                                    WHERE sub = ? AND last_seen > datetime('now', '-${BRIDGE_ONLINE_S} seconds')`).bind(sub).first();
  const n = (row && row.n) || 0;
  return { online: n > 0, tabs: n, last_seen: row && row.last ? iso(row.last) : null };
}
async function beat(env, sub, tabId) {
  await env.DB.prepare(`INSERT INTO mcp_bridge_presence (sub, tab_id) VALUES (?, ?)
                        ON CONFLICT(sub, tab_id) DO UPDATE SET last_seen = datetime('now')`).bind(sub, tabId).run().catch(() => {});
}

/* ═══ ORDRES ═══ */
/* Crée un ordre, attend sa réponse. → { status:'done', data } | { status:'failed', error }
   | { status:'timeout' } (l'ordre est marqué expired : l'onglet ne l'exécutera plus). */
export async function bridgeRun(env, { sub, tool, action, args, waitMs = BRIDGE_WAIT_MS, pollMs = BRIDGE_POLL_MS }) {
  await ensureMcpBridgeSchema(env);
  const argsJson = JSON.stringify(args ?? {});
  if (argsJson.length > MAX_ARGS) return { status: 'failed', error: 'arguments trop volumineux (32 Ko max)' };
  const id = 'kjb_' + generateToken(12);
  await env.DB.prepare(`INSERT INTO mcp_jobs (id, sub, tool, action, args_json, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+${JOB_TTL_S} seconds'))`)
    .bind(id, sub, String(tool || ''), String(action), argsJson).run();
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await sleep(pollMs);
    const row = await env.DB.prepare('SELECT status, result_json, error FROM mcp_jobs WHERE id = ?').bind(id).first();
    if (!row) return { status: 'failed', error: 'ordre perdu' };
    if (row.status === 'done') { let data = null; try { data = JSON.parse(row.result_json || 'null'); } catch (_) { data = null; } return { status: 'done', data, jobId: id }; }
    if (row.status === 'failed') return { status: 'failed', error: row.error || 'échec dans l’onglet', jobId: id };
  }
  /* trop tard : l'onglet ne doit plus l'exécuter (et ne pourra plus répondre) */
  await env.DB.prepare("UPDATE mcp_jobs SET status = 'expired', done_at = datetime('now') WHERE id = ? AND status IN ('pending', 'dispatched')").bind(id).run().catch(() => {});
  return { status: 'timeout', jobId: id };
}

/* Remise des ordres en attente à UN onglet (UPDATE gardé, anti-double). */
async function claimPending(env, sub, tabId) {
  const { results } = await env.DB.prepare(`SELECT id, tool, action, args_json, expires_at FROM mcp_jobs
                                            WHERE sub = ? AND status = 'pending' AND expires_at > datetime('now') ORDER BY created_at ASC LIMIT 5`).bind(sub).all();
  const out = [];
  for (const r of (results || [])) {
    const u = await env.DB.prepare("UPDATE mcp_jobs SET status = 'dispatched', dispatched_at = datetime('now') WHERE id = ? AND status = 'pending'").bind(r.id).run();
    if (u?.meta?.changes >= 1) {
      let args = {}; try { args = JSON.parse(r.args_json); } catch (_) { args = {}; }
      out.push({ id: r.id, tool: r.tool, action: r.action, args, expires_at: iso(r.expires_at), tab: tabId });
    }
  }
  return out;
}

/* ═══ ROUTES ═══ */
async function gate(request, env, origin) {
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return { error: err('Jeton Keystone requis', 401, origin) };
  return { claims };
}

/* GET /api/mcp/bridge/stream — le canal de l'onglet (SSE, fetch + Authorization). */
export async function handleBridgeStream(request, env, opts = {}) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  await ensureMcpBridgeSchema(env);
  const sub = g.claims.sub;
  const tabId = (request.headers.get('X-Bridge-Tab') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || ('tab_' + generateToken(6));
  const pollMs = opts.pollMs ?? STREAM_POLL_MS, beatMs = opts.beatMs ?? STREAM_BEAT_MS, maxMs = opts.maxMs ?? STREAM_MAX_MS;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const t0 = Date.now();
      let lastBeat = 0;
      try {
        await beat(env, sub, tabId); lastBeat = Date.now();
        send('hello', { tab: tabId, poll_ms: pollMs, beat_ms: beatMs, max_ms: maxMs });
        while (Date.now() - t0 < maxMs) {
          const jobs = await claimPending(env, sub, tabId);
          for (const j of jobs) send('job', j);
          if (Date.now() - lastBeat >= beatMs) { await beat(env, sub, tabId); lastBeat = Date.now(); controller.enqueue(enc.encode(': ping\n\n')); }
          await sleep(pollMs);
        }
        send('bye', { reason: 'cycle', reconnect_ms: 500 });
      } catch (_) { /* onglet parti : on s'arrête, la présence expirera d'elle-même */ }
      finally { try { controller.close(); } catch (_) { /* déjà fermé */ } }
    },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store', 'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'X-Bridge-Tab', 'X-Bridge-Tab': tabId,
  } });
}

/* POST /api/mcp/bridge/jobs/:id/result { ok:true, data } | { ok:false, error } — une seule réponse. */
export async function handleBridgeJobResult(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  await ensureMcpBridgeSchema(env);
  const body = await parseBody(request);
  if (!body || typeof body !== 'object') return err('Corps JSON attendu', 400, origin);
  const job = await env.DB.prepare('SELECT id, status FROM mcp_jobs WHERE id = ? AND sub = ?').bind(String(id || ''), g.claims.sub).first();
  if (!job) return err('Ordre introuvable', 404, origin);
  if (job.status === 'done' || job.status === 'failed') return err('Ordre déjà répondu', 409, origin);
  if (job.status === 'expired') return json({ ok: false, status: 'expired', message: 'Trop tard : le Worker n’attendait plus.' }, 410, origin);
  const ok = body.ok !== false;
  let resultJson = null, error = null;
  if (ok) { resultJson = JSON.stringify(body.data ?? null); if (resultJson.length > MAX_RESULT) { resultJson = null; error = 'résultat trop volumineux (64 Ko max)'; } }
  else error = String(body.error || 'échec dans l’onglet').slice(0, 500);
  const u = await env.DB.prepare(`UPDATE mcp_jobs SET status = ?, result_json = ?, error = ?, done_at = datetime('now')
                                  WHERE id = ? AND status IN ('pending', 'dispatched')`).bind(error && ok ? 'failed' : (ok ? 'done' : 'failed'), resultJson, error, job.id).run();
  if (!(u?.meta?.changes >= 1)) return err('Ordre déjà répondu', 409, origin);
  return json({ ok: true, status: ok && !error ? 'done' : 'failed' }, 200, origin);
}

/* GET /api/mcp/bridge/presence — l'onglet est-il là ? (tuile, outil keystone_bridge_status) */
export async function handleBridgePresence(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  const p = await bridgePresence(env, g.claims.sub);
  return json({ ok: true, ...p }, 200, origin);
}

/* ═══ PURGE (cron 0 3 * * *) ═══ */
export async function purgeMcpBridge(env) {
  await ensureMcpBridgeSchema(env);
  const r = async (sql) => { const x = await env.DB.prepare(sql).run().catch(() => null); return x?.meta?.changes ?? 0; };
  return {
    jobs:     await r("DELETE FROM mcp_jobs WHERE created_at < datetime('now', '-1 day')"),
    presence: await r("DELETE FROM mcp_bridge_presence WHERE last_seen < datetime('now', '-1 day')"),
  };
}
