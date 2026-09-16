/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — MCP sprint 3 : confirmations d'écriture + Bannette
   ───────────────────────────────────────────────────────────────
   Deux mécanismes, une table chacun (migrations/016_mcp_writes.sql) :

   · CONFIRMATIONS (HANDOFF §3.3) — « aperçu → jeton → exécution ».
     Un outil marqué confirm:true, appelé SANS confirm_token, rend un
     aperçu et un jeton kcf_… (5 min). Rappelé AVEC ce jeton et les
     MÊMES arguments, il écrit, une seule fois. Le jeton est lié au
     compte (sub), à la connexion OAuth (si elle existe), à l'outil et
     au hash canonique des arguments : on n'exécute que ce qui a été
     montré. Jamais le jeton en base : SHA-256 seulement.

   · BANNETTE (brief §2) — les écritures NAVIGATEUR (composer Social,
     Ghost Writer, Brainstorming, pré-remplissage d'un pad) deviennent
     des PROPOSITIONS : le Worker les stocke, l'onglet Keystone les lit
     (GET /api/mcp/inbox) et l'utilisateur les applique d'un clic
     (openTool(pad, opts)) ou les ignore. `kind` = l'opts que openTool
     sait déjà recevoir. Le serveur n'applique jamais rien lui-même.

   · ACTIVITÉ (ajout S3, « bandeau d'activité ») — les écritures
     exécutées côté serveur (note, audit, contact…) n'ont pas d'anneau :
     l'onglet lit GET /api/mcp/activity (ledger mcp_calls, colonne
     label) et affiche un toast « Votre assistant a créé… ». Rien ne se
     passe à l'insu de l'utilisateur.

   Auth des routes : requireJWT — le JWT Keystone de l'onglet, OU le JWT
   interne 5 min minté par /mcp pour un appel OAuth (les outils
   keystone_*_draft_* déposent via ctx.call('/api/mcp/inbox')).
   ═══════════════════════════════════════════════════════════════ */
import { json, err, parseBody, getAllowedOrigin, generateId, generateToken } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

export const CONFIRM_PREFIX  = 'kcf_';
export const CONFIRM_TTL_S   = 300;          // 5 min, HANDOFF sprint 3
const INBOX_TTL_DAYS         = 30;
const INBOX_MAX_PENDING      = 50;           // par compte
const INBOX_MAX_PAYLOAD      = 16 * 1024;
const INBOX_KINDS            = new Set(['compose', 'gw.rewrite', 'bs.session_seed', 'prefillData', 'createVcard']);
const INBOX_STATUSES         = new Set(['applied', 'dismissed']);

/* ── Schéma (créé à la volée, miroir de la migration 016) ── */
let _ready = false;
export async function ensureMcpWritesSchema(env) {
  if (_ready) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_confirmations (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, sub TEXT NOT NULL, connection_id TEXT, tool TEXT NOT NULL,
    args_hash TEXT NOT NULL, preview_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, used_at TEXT)`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_mcp_confirmations_sub ON mcp_confirmations(sub, expires_at)').run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_inbox (
    id TEXT PRIMARY KEY, sub TEXT NOT NULL, pad TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, summary TEXT,
    created_by_tool TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL, resolved_at TEXT)`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_mcp_inbox_sub ON mcp_inbox(sub, status, expires_at)').run();
  _ready = true;
}

/* ── Aides ── */
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
/* Empreinte du sujet, la MÊME que le ledger mcp_calls (12 octets hex) :
   jamais le sub en clair dans une table d'observabilité. */
export async function subHash(sub) { return (await sha256Hex(sub)).slice(0, 24); }
const iso = (v) => (typeof v === 'string' && !/[TZ]/.test(v)) ? v.replace(' ', 'T') + 'Z' : v;
const inFuture = (d) => `datetime('now', '+${d} ${d === 1 ? 'day' : 'days'}')`;

/* Sérialisation canonique (clés triées, confirm_token exclu) → le hash ne
   dépend ni de l'ordre des clés ni du jeton lui-même. */
export function canonicalArgs(args) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { if (v[k] !== undefined) o[k] = walk(v[k]); return o; }, {});
    return v;
  };
  const { confirm_token, ...rest } = (args && typeof args === 'object') ? args : {};
  return JSON.stringify(walk(rest));
}
export async function argsHash(tool, args) { return sha256Hex(`${tool}\n${canonicalArgs(args)}`); }

/* ═══ CONFIRMATIONS ═══ */
export async function issueConfirmation(env, { sub, connectionId = null, tool, args, preview }) {
  await ensureMcpWritesSchema(env);
  const token = CONFIRM_PREFIX + generateToken(24);
  await env.DB.prepare(`INSERT INTO mcp_confirmations (id, token_hash, sub, connection_id, tool, args_hash, preview_json, expires_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+${CONFIRM_TTL_S} seconds'))`)
    .bind(generateId(), await sha256Hex(token), sub, connectionId, tool, await argsHash(tool, args), JSON.stringify(preview ?? null).slice(0, 8000)).run();
  return { token, expires_in: CONFIRM_TTL_S };
}

/* → { ok:true } ou { ok:false, reason } — un jeton d'un autre compte,
   d'un autre outil ou d'autres arguments n'est PAS consommé (il reste
   valable pour son vrai usage) ; un jeton correct est consommé une fois. */
export async function consumeConfirmation(env, { sub, connectionId = null, tool, args, token }) {
  await ensureMcpWritesSchema(env);
  const t = String(token || '');
  if (!t.startsWith(CONFIRM_PREFIX) || t.length < 20) return { ok: false, reason: 'jeton de confirmation mal formé' };
  const row = await env.DB.prepare('SELECT * FROM mcp_confirmations WHERE token_hash = ?').bind(await sha256Hex(t)).first();
  if (!row) return { ok: false, reason: 'jeton de confirmation inconnu' };
  if (row.sub !== sub) return { ok: false, reason: 'jeton émis pour un autre compte' };
  if (row.connection_id && connectionId && row.connection_id !== connectionId) return { ok: false, reason: 'jeton émis pour une autre connexion' };
  if (row.tool !== tool) return { ok: false, reason: `jeton émis pour un autre outil (${row.tool})` };
  if (row.args_hash !== await argsHash(tool, args)) return { ok: false, reason: 'les arguments ont changé depuis l’aperçu — redemande un aperçu' };
  if (row.used_at) return { ok: false, reason: 'jeton déjà utilisé — l’écriture a déjà eu lieu' };
  if (new Date(iso(row.expires_at)) < new Date()) return { ok: false, reason: 'aperçu périmé (5 min) — redemande un aperçu' };
  const r = await env.DB.prepare("UPDATE mcp_confirmations SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')").bind(row.id).run();
  if (!(r?.meta?.changes >= 1)) return { ok: false, reason: 'jeton déjà utilisé — l’écriture a déjà eu lieu' };
  return { ok: true };
}

/* ═══ BANNETTE ═══ */
export async function inboxDeposit(env, { sub, pad, kind, payload, summary, tool }) {
  await ensureMcpWritesSchema(env);
  if (!/^[A-Za-z]-[A-Za-z]+-\d{3}$/.test(String(pad || ''))) throw new Error('pad invalide');
  if (!INBOX_KINDS.has(kind)) throw new Error('kind inconnu');
  const payloadJson = JSON.stringify(payload ?? {});
  if (payloadJson.length > INBOX_MAX_PAYLOAD) throw new Error('proposition trop volumineuse (16 Ko max)');
  const pending = (await env.DB.prepare("SELECT COUNT(*) AS n FROM mcp_inbox WHERE sub = ? AND status = 'pending' AND expires_at > datetime('now')").bind(sub).first())?.n || 0;
  if (pending >= INBOX_MAX_PENDING) throw new Error(`bannette pleine (${INBOX_MAX_PENDING} propositions en attente) — ouvre Keystone pour les traiter`);
  const id = 'kbn_' + generateToken(12);
  await env.DB.prepare(`INSERT INTO mcp_inbox (id, sub, pad, kind, payload_json, summary, created_by_tool, expires_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ${inFuture(INBOX_TTL_DAYS)})`)
    .bind(id, sub, pad, kind, payloadJson, summary ? String(summary).slice(0, 200) : null, tool ? String(tool).slice(0, 80) : null).run();
  const row = await env.DB.prepare('SELECT expires_at FROM mcp_inbox WHERE id = ?').bind(id).first();
  return { id, expires_at: iso(row?.expires_at), pending: pending + 1 };
}
export async function inboxList(env, sub) {
  await ensureMcpWritesSchema(env);
  const { results } = await env.DB.prepare(`SELECT id, pad, kind, payload_json, summary, created_by_tool, created_at, expires_at
                                            FROM mcp_inbox WHERE sub = ? AND status = 'pending' AND expires_at > datetime('now')
                                            ORDER BY created_at ASC LIMIT ?`).bind(sub, INBOX_MAX_PENDING).all();
  return (results || []).map(r => {
    let payload = {}; try { payload = JSON.parse(r.payload_json); } catch (_) { /* illisible → vide */ }
    return { id: r.id, pad: r.pad, kind: r.kind, payload, summary: r.summary, tool: r.created_by_tool, created_at: iso(r.created_at), expires_at: iso(r.expires_at) };
  });
}
export async function inboxMark(env, sub, id, status) {
  await ensureMcpWritesSchema(env);
  if (!INBOX_STATUSES.has(status)) return 0;
  const r = await env.DB.prepare("UPDATE mcp_inbox SET status = ?, resolved_at = datetime('now') WHERE id = ? AND sub = ? AND status = 'pending'").bind(status, String(id || ''), sub).run();
  return r?.meta?.changes || 0;
}

/* ═══ ACTIVITÉ (ledger mcp_calls, écritures serveur réussies) ═══ */
export async function activitySince(env, sub, sinceIso, tools) {
  if (!Array.isArray(tools) || !tools.length) return [];
  const sh = await subHash(sub);
  const since = (typeof sinceIso === 'string' && !isNaN(Date.parse(sinceIso))) ? new Date(sinceIso).toISOString().replace('T', ' ').slice(0, 19) : '1970-01-01 00:00:00';
  const marks = tools.map(() => '?').join(',');
  try {
    const { results } = await env.DB.prepare(`SELECT ts, tool, label FROM mcp_calls WHERE sub_hash = ? AND ok = 1 AND ts > ? AND tool IN (${marks}) ORDER BY ts ASC LIMIT 20`)
      .bind(sh, since, ...tools).all();
    return (results || []).map(r => ({ ts: iso(r.ts), tool: r.tool, label: r.label || null }));
  } catch (_) { return []; }   // colonne label absente sur un ledger ancien : silence
}

/* ═══ PURGE (cron 0 3 * * *) ═══ */
export async function purgeMcpWrites(env) {
  await ensureMcpWritesSchema(env);
  const r = async (sql) => { const x = await env.DB.prepare(sql).run().catch(() => null); return x?.meta?.changes ?? 0; };
  return {
    confirmations: await r("DELETE FROM mcp_confirmations WHERE expires_at < datetime('now', '-1 hour')"),
    inbox:         await r("DELETE FROM mcp_inbox WHERE expires_at < datetime('now') OR (status <> 'pending' AND resolved_at < datetime('now', '-30 days'))"),
  };
}

/* ═══ ROUTES (JWT Keystone ou JWT interne /mcp) ═══ */
async function gate(request, env, origin) {
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return { error: err('Jeton Keystone requis', 401, origin) };
  return { claims };
}
/* GET /api/mcp/inbox — les propositions en attente du compte */
export async function handleMcpInboxList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  const items = await inboxList(env, g.claims.sub);
  return json({ ok: true, pending: items.length, items }, 200, origin);
}
/* POST /api/mcp/inbox { pad, kind, payload, summary?, tool? } — dépôt (outils MCP, via ctx.call) */
export async function handleMcpInboxDeposit(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  const body = await parseBody(request);
  if (!body || typeof body !== 'object') return err('Corps JSON attendu', 400, origin);
  try {
    const r = await inboxDeposit(env, { sub: g.claims.sub, pad: body.pad, kind: body.kind, payload: body.payload, summary: body.summary, tool: body.tool });
    return json({ ok: true, ...r }, 201, origin);
  } catch (e) { return err(e.message || 'Dépôt impossible', 400, origin); }
}
/* POST /api/mcp/inbox/:id/applied | /dismissed — l'onglet a appliqué / ignoré */
export async function handleMcpInboxMark(request, env, id, status) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  const n = await inboxMark(env, g.claims.sub, id, status);
  if (!n) return err('Proposition introuvable', 404, origin);
  return json({ ok: true, status }, 200, origin);
}
/* GET /api/mcp/activity?since=<ISO> — écritures serveur récentes (toast) ; `tools` = noms d'outils d'écriture serveur */
export async function handleMcpActivity(request, env, tools) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  const since = new URL(request.url).searchParams.get('since') || '';
  const items = await activitySince(env, g.claims.sub, since, tools);
  return json({ ok: true, items, now: new Date().toISOString() }, 200, origin);
}
