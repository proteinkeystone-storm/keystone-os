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

   Repli WEB PUSH (ajout S4, décision Stéphane 17/09) : sans onglet en ligne
   (ou onglet muet : iPhone en arrière-plan), le Worker pousse une
   notification « Votre assistant a préparé … — ouvrir Keystone ? » sur
   les abonnements push déjà connus du compte (tables kn_push_subs et
   sentinel_push_subs, même tenant que les pads). Une ÉCRITURE reste
   déposée en bannette ET mise en file 10 min (mcp_jobs.inbox_id) : si
   l'utilisateur clique, l'onglet qui s'ouvre exécute l'ordre et marque
   la proposition appliquée ; sinon elle l'attend dans la bannette. Une
   LECTURE ne fait que notifier : Claude redemande, l'onglet répond.
   Plafond 30 notifications / compte / jour.
   Correctif 17/09 (test réel) : plus d'ordre en file. Une ouverture manuelle
   de Keystone appliquait la proposition sans clic. Désormais la notification
   porte l'id de la proposition (url ./app?mcp_apply=kbn_…) : SEUL le clic
   l'applique (app/bannette.js) ; sinon elle attend dans la bannette.
   Présence : le canal détecte la déconnexion (cancel) et retire l'onglet
   aussitôt ; POST /api/mcp/bridge/bye permet à l'onglet de se retirer
   lui-même (fermeture, iPhone mis en arrière-plan).

   Confidentialité (correctif 17/09, trouvé au test réel) : un ordre transporte
   des données du NAVIGATEUR (textes Ghost Writer, synthèses, brouillon Social).
   Elles ne restent PAS en base : arguments effacés dès la remise à l'onglet,
   résultat effacé dès sa lecture par le Worker (ou à l'expiration). Seuls
   l'état, l'outil et les dates subsistent, purgés à 1 jour.

   Garde-fous : l'onglet n'exécute que les actions de son catalogue
   (app/bridge-actions.js) et le dit (« hors catalogue ») ; un ordre est
   lié au sub ; un ordre d'un autre compte n'apparaît jamais sur le canal.
   ═══════════════════════════════════════════════════════════════ */
import { json, err, parseBody, getAllowedOrigin, generateToken } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { sendPush } from '../lib/webpush.js';
import { ipRateExceeded, ipRateBump } from '../lib/ip-throttle.js';

export const BRIDGE_ONLINE_S    = 40;       // « en ligne » = battement < 40 s
export const BRIDGE_WAIT_MS     = 25_000;   // long-poll du Worker (limite Claude 30 s / 60 s)
export const BRIDGE_POLL_MS     = 600;      // cadence de relecture du résultat
const STREAM_POLL_MS            = 2_000;    // cadence de relecture des ordres sur le canal
const STREAM_BEAT_MS            = 20_000;   // battement de présence
const STREAM_MAX_MS             = 4 * 60_000;
const JOB_TTL_S                 = 60;
const QUEUED_TTL_S              = 600;      // ordre gardé après une notification push
const PUSH_DAILY_CAP            = 30;
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')), dispatched_at TEXT, done_at TEXT, expires_at TEXT NOT NULL, inbox_id TEXT)`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_mcp_jobs_sub_status ON mcp_jobs(sub, status, expires_at)').run();
  try { await env.DB.prepare('ALTER TABLE mcp_jobs ADD COLUMN inbox_id TEXT').run(); } catch (_) { /* déjà là (migration 019) */ }
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
    if (row.status === 'done' || row.status === 'failed') {
      /* lu : le contenu quitte la base immédiatement */
      await forget(env, id);
      if (row.status === 'done') { let data = null; try { data = JSON.parse(row.result_json || 'null'); } catch (_) { data = null; } return { status: 'done', data, jobId: id }; }
      return { status: 'failed', error: row.error || 'échec dans l’onglet', jobId: id };
    }
  }
  /* trop tard : l'onglet ne doit plus l'exécuter (et ne pourra plus répondre) */
  await env.DB.prepare("UPDATE mcp_jobs SET status = 'expired', done_at = datetime('now'), args_json = '{}', result_json = NULL, error = NULL WHERE id = ? AND status IN ('pending', 'dispatched')").bind(id).run().catch(() => {});
  return { status: 'timeout', jobId: id };
}

/* Ordre mis en FILE sans attente (repli push) : exécuté par l'onglet qui
   s'ouvrira dans les 10 min ; inbox_id = la proposition de bannette jumelle,
   que l'onglet marquera appliquée après exécution. */
export async function bridgeQueue(env, { sub, tool, action, args, inboxId = null }) {
  await ensureMcpBridgeSchema(env);
  const argsJson = JSON.stringify(args ?? {});
  if (argsJson.length > MAX_ARGS) return null;
  const id = 'kjb_' + generateToken(12);
  await env.DB.prepare(`INSERT INTO mcp_jobs (id, sub, tool, action, args_json, expires_at, inbox_id) VALUES (?, ?, ?, ?, ?, datetime('now', '+${QUEUED_TTL_S} seconds'), ?)`)
    .bind(id, sub, String(tool || ''), String(action), argsJson, inboxId ? String(inboxId) : null).run();
  return id;
}

/* Notification push de repli. tenant = règle des pads (admin → 'default').
   → { sent, devices } ; { sent:0, reason } sans VAPID / abonnement / au plafond. */
/* Charge utile d'une notification du Pont (pure, testée) : applyId = proposition
   de bannette que le CLIC doit appliquer. */
export function bridgePushPayload({ title, body, tag, applyId = null }) {
  const id = (typeof applyId === 'string' && /^kbn_[A-Za-z0-9_-]{8,40}$/.test(applyId)) ? applyId : null;
  return { kind: 'mcp-bridge', title: String(title || 'Votre assistant').slice(0, 80), body: String(body || '').slice(0, 160),
    tag: String(tag || 'mcp').slice(0, 40), url: id ? `./app?mcp_apply=${id}` : './app', ...(id ? { apply: id } : {}) };
}

export async function bridgeNotify(env, { sub, isAdmin, title, body, tag, applyId = null }) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return { sent: 0, devices: 0, reason: 'push non configuré' };
  let vapid;
  try { vapid = { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: 'mailto:' + (env.SDQR_DPO_EMAIL || 'contact@protein-keystone.com') }; }
  catch (_) { return { sent: 0, devices: 0, reason: 'push non configuré' }; }
  const tenant = isAdmin ? 'default' : sub;
  const subs = new Map();
  for (const table of ['kn_push_subs', 'sentinel_push_subs']) {
    try { for (const r of ((await env.DB.prepare(`SELECT endpoint, p256dh, auth FROM ${table} WHERE tenant_id = ?`).bind(tenant).all()).results || [])) subs.set(r.endpoint, { ...r, table }); }
    catch (_) { /* table absente */ }
  }
  if (!subs.size) return { sent: 0, devices: 0, reason: 'aucun appareil abonné aux notifications' };
  const sh = (await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(sub)))); const subHash = Array.from(new Uint8Array(sh)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  try { if (await ipRateExceeded(env, 'mcp:push', subHash, PUSH_DAILY_CAP)) return { sent: 0, devices: subs.size, reason: 'plafond de notifications du jour atteint' }; await ipRateBump(env, 'mcp:push', subHash); } catch (_) { /* fail-open */ }
  const payload = bridgePushPayload({ title, body, tag, applyId });
  let sent = 0;
  for (const s of subs.values()) {
    try {
      const code = await sendPush(s, payload, vapid);
      if (code >= 200 && code < 300) sent++;
      else if (code === 404 || code === 410) await env.DB.prepare(`DELETE FROM ${s.table} WHERE endpoint = ?`).bind(s.endpoint).run().catch(() => {});
    } catch (_) { /* un appareil sourd n'empêche pas les autres */ }
  }
  return { sent, devices: subs.size };
}

/* Efface le contenu d'un ordre traité (arguments, résultat, message d'erreur). */
async function forget(env, id) {
  await env.DB.prepare("UPDATE mcp_jobs SET args_json = '{}', result_json = NULL, error = NULL WHERE id = ?").bind(id).run().catch(() => {});
}

/* Remise des ordres en attente à UN onglet (UPDATE gardé, anti-double). */
async function claimPending(env, sub, tabId) {
  const { results } = await env.DB.prepare(`SELECT id, tool, action, args_json, expires_at, inbox_id FROM mcp_jobs
                                            WHERE sub = ? AND status = 'pending' AND expires_at > datetime('now') ORDER BY created_at ASC LIMIT 5`).bind(sub).all();
  const out = [];
  for (const r of (results || [])) {
    /* remis : les arguments partent avec l'ordre et quittent la base */
    const u = await env.DB.prepare("UPDATE mcp_jobs SET status = 'dispatched', dispatched_at = datetime('now'), args_json = '{}' WHERE id = ? AND status = 'pending'").bind(r.id).run();
    if (u?.meta?.changes >= 1) {
      let args = {}; try { args = JSON.parse(r.args_json); } catch (_) { args = {}; }
      out.push({ id: r.id, tool: r.tool, action: r.action, args, expires_at: iso(r.expires_at), tab: tabId, ...(r.inbox_id ? { inbox_id: r.inbox_id } : {}) });
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
  /* gone : le client s'est déconnecté (cancel) — on cesse de battre, de réclamer
     des ordres, et l'onglet quitte la présence tout de suite. */
  let gone = false;
  const leave = () => env.DB.prepare('DELETE FROM mcp_bridge_presence WHERE sub = ? AND tab_id = ?').bind(sub, tabId).run().catch(() => {});
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const t0 = Date.now();
      let lastBeat = 0;
      try {
        await beat(env, sub, tabId); lastBeat = Date.now();
        send('hello', { tab: tabId, poll_ms: pollMs, beat_ms: beatMs, max_ms: maxMs });
        while (!gone && Date.now() - t0 < maxMs) {
          /* ping d'abord : un canal fermé lève ici, AVANT de réclamer un ordre */
          if (Date.now() - lastBeat >= beatMs) { controller.enqueue(enc.encode(': ping\n\n')); await beat(env, sub, tabId); lastBeat = Date.now(); }
          if (gone) break;
          const jobs = await claimPending(env, sub, tabId);
          for (let i = 0; i < jobs.length; i++) {
            try { if (gone) throw new Error('gone'); send('job', jobs[i]); }
            catch (e) {
              /* remise impossible : les ordres réclamés repartent en attente pour un autre onglet */
              for (const j of jobs.slice(i)) await env.DB.prepare("UPDATE mcp_jobs SET status = 'pending', dispatched_at = NULL, args_json = ? WHERE id = ? AND status = 'dispatched'").bind(JSON.stringify(j.args ?? {}), j.id).run().catch(() => {});
              throw e;
            }
          }
          await sleep(pollMs);
        }
        if (!gone) send('bye', { reason: 'cycle', reconnect_ms: 500 });
      } catch (_) { gone = true; await leave(); }
      finally { try { controller.close(); } catch (_) { /* déjà fermé */ } }
    },
    cancel() { gone = true; return leave(); },
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
  const job = await env.DB.prepare('SELECT id, status, inbox_id FROM mcp_jobs WHERE id = ? AND sub = ?').bind(String(id || ''), g.claims.sub).first();
  if (!job) return err('Ordre introuvable', 404, origin);
  if (job.status === 'done' || job.status === 'failed') return err('Ordre déjà répondu', 409, origin);
  if (job.status === 'expired') return json({ ok: false, status: 'expired', message: 'Trop tard : le Worker n’attendait plus.' }, 410, origin);
  const ok = body.ok !== false;
  let resultJson = null, error = null;
  if (ok) { resultJson = JSON.stringify(body.data ?? null); if (resultJson.length > MAX_RESULT) { resultJson = null; error = 'résultat trop volumineux (64 Ko max)'; } }
  else error = String(body.error || 'échec dans l’onglet').slice(0, 500);
  /* ordre mis en file après une notification push : personne ne l'attend, on ne garde que l'état */
  if (job.inbox_id) resultJson = null;
  const u = await env.DB.prepare(`UPDATE mcp_jobs SET status = ?, result_json = ?, error = ?, done_at = datetime('now')
                                  WHERE id = ? AND status IN ('pending', 'dispatched')`).bind(error && ok ? 'failed' : (ok ? 'done' : 'failed'), resultJson, error, job.id).run();
  if (!(u?.meta?.changes >= 1)) return err('Ordre déjà répondu', 409, origin);
  return json({ ok: true, status: ok && !error ? 'done' : 'failed' }, 200, origin);
}

/* POST /api/mcp/bridge/bye { tab } — l'onglet se retire lui-même (fermeture, arrière-plan mobile). */
export async function handleBridgeBye(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  await ensureMcpBridgeSchema(env);
  const body = await parseBody(request);
  const tab = String((body && body.tab) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!tab) return err('tab requis', 400, origin);
  const r = await env.DB.prepare('DELETE FROM mcp_bridge_presence WHERE sub = ? AND tab_id = ?').bind(g.claims.sub, tab).run();
  return json({ ok: true, removed: r?.meta?.changes || 0 }, 200, origin);
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
    emptied:  await r("UPDATE mcp_jobs SET args_json = '{}', result_json = NULL, error = NULL WHERE expires_at < datetime('now') AND (args_json <> '{}' OR result_json IS NOT NULL OR error IS NOT NULL)"),
    jobs:     await r("DELETE FROM mcp_jobs WHERE created_at < datetime('now', '-1 day')"),
    presence: await r("DELETE FROM mcp_bridge_presence WHERE last_seen < datetime('now', '-1 day')"),
  };
}
