/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Serveur MCP (Model Context Protocol) · /mcp
   ───────────────────────────────────────────────────────────────
   Transport : Streamable HTTP SANS ÉTAT (JSON-RPC 2.0 sur POST, réponse
   JSON). Pas de session, pas de flux SSE, pas de Durable Object : chaque
   requête est complète en elle-même (spécification MCP 2025-06-18 ;
   la version 2026-07-28 rend ce cœur sans état officiel).

   Auth : `Authorization: Bearer <jeton>`, deux voies acceptées.
   · Sprint 2, voie normale : un jeton d'accès OAuth (`ksa_…`, routes/
     oauth.js) obtenu par consentement sur connect.html — claude.ai,
     Claude Desktop, Claude Code. Les routes internes sont rappelées
     avec un JWT interne court (5 min) minté depuis la connexion : plan
     et licence relus en base à chaque appel, tenant jamais recalculé.
   · Sprint 1, toujours valable : un JWT Keystone (scripts/mcp-connect).
   Sans jeton valide → 401 + `WWW-Authenticate: Bearer resource_metadata=…`
   (+ error="invalid_token" si un jeton était présent, pour que Claude
   rafraîchisse ou réautorise). Claude ne lit cet en-tête QUE sur un 401.

   Outils : lib/mcp-tools.js. Chaque outil appelle les routes existantes
   du Worker EN INTERNE (dispatch = le routeur lui-même, pas un fetch
   réseau) avec le JWT de l'utilisateur : licence, plan, tenant sont
   tranchés par la route, comme pour le pad. Zéro duplication de garde.

   Métrage : aucun crédit consommé (le raisonnement tourne chez Claude).
   Ledger `mcp_calls` (sujet, outil, durée, ok) pour l'observabilité, et
   plafond quotidien par sujet (fail-open, comme les surfaces publiques).
   ═══════════════════════════════════════════════════════════════ */
import { requireJWT, signJWT }                from '../lib/jwt.js';
import { mcpTool, mcpToolList }               from '../lib/mcp-tools.js';
import { ipRateExceeded, ipRateBump }          from '../lib/ip-throttle.js';
import { resolveMcpAccessToken, ACCESS_PREFIX } from './oauth.js';

const INTERNAL_JWT_TTL_S = 300;   // JWT interne minté pour un appel OAuth : le temps d'une requête

export const MCP_SERVER_NAME    = 'keystone-os';
export const MCP_SERVER_VERSION = '1.0.0';
const PROTOCOLS  = ['2025-06-18', '2025-03-26', '2024-11-05'];   // acceptés, du plus récent au plus ancien
const DAILY_CAP  = 2000;      // appels d'outils / sujet / jour (fail-open)
const MAX_BODY   = 64 * 1024; // un appel d'outil ne porte que des arguments courts
const INSTRUCTIONS =
  "Keystone OS : les outils keystone_* lisent les données métier du compte connecté (QR codes, sites surveillés, notes, jumeaux Smart Agent, revues desK, réseaux sociaux, formulaires, chartes, contacts). " +
  "Commence par keystone_os_catalog pour connaître les applications du compte, ou keystone_livinglayer_board pour « quoi de neuf ». " +
  "Les noms (QR, site, note, jumeau, revue, contact…) se cherchent par correspondance exacte puis partielle, accents ignorés ; en cas d'ambiguïté l'outil liste les candidats. " +
  "Dates en ISO 8601 UTC. Ces outils ne modifient rien.";

/* ── JSON-RPC helpers ── */
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError  = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } });
const E = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603 };

function reply(body, status = 200, extra = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

function unauthorized(request, detail) {
  const origin = new URL(request.url).origin;
  const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`];
  /* Un en-tête HTTP est en Latin-1 : accents repliés, guillemets et
     apostrophes typographiques retirés (le corps JSON garde le message intact). */
  if (detail) parts.push('error="invalid_token"', `error_description="${String(detail).normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '')}"`);
  return reply({ error: 'unauthorized', message: detail || 'Jeton requis (Authorization: Bearer <jeton OAuth ou JWT Keystone>).' }, 401, {
    'WWW-Authenticate': `Bearer ${parts.join(', ')}`,
  });
}

/* Identifie l'appelant : jeton OAuth (ksa_…) ou JWT Keystone.
   → { claims, authz } où authz est l'en-tête à rejouer sur les routes internes. */
async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token  = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: null };
  if (token.startsWith(ACCESS_PREFIX)) {
    const r = await resolveMcpAccessToken(env, token);
    if (!r.ok) return { error: r.description };
    const c = r.claims;
    const internal = await signJWT({ sub: c.sub, plan: c.plan, owner: c.owner, email: c.email, isAdmin: c.isAdmin, via: 'mcp-oauth' }, env, INTERNAL_JWT_TTL_S);
    return { claims: c, authz: `Bearer ${internal}` };
  }
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return { error: 'Jeton invalide ou expiré.' };
  return { claims, authz: header };
}

/* Empreinte du sujet pour le plafond quotidien (jamais le sub en clair en base). */
async function subHash(sub) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(sub)));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

let _ledgerReady = false;
async function ensureLedger(env) {
  if (_ledgerReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS mcp_calls (
        id         TEXT PRIMARY KEY,
        ts         TEXT NOT NULL DEFAULT (datetime('now')),
        sub_hash   TEXT NOT NULL,
        plan       TEXT,
        tool       TEXT NOT NULL,
        ms         INTEGER NOT NULL DEFAULT 0,
        ok         INTEGER NOT NULL DEFAULT 1,
        error      TEXT
      )`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_mcp_calls_ts ON mcp_calls(ts)').run();
    _ledgerReady = true;
  } catch (e) { console.warn('[mcp] ledger init failed:', e.message); }
}
async function ledger(env, row) {
  try {
    await ensureLedger(env);
    await env.DB.prepare('INSERT INTO mcp_calls (id, sub_hash, plan, tool, ms, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), row.subHash, row.plan || null, row.tool, row.ms | 0, row.ok ? 1 : 0, row.error ? String(row.error).slice(0, 300) : null)
      .run();
  } catch (e) { console.warn('[mcp] ledger write failed:', e.message); }
}

/* ── Le contexte d'exécution d'un outil ──
   call(path, {method, body, auth}) : appel INTERNE d'une route du Worker
   avec le JWT du client. Réponse JSON ; erreur → message serveur tel quel. */
function makeCtx(request, env, dispatch, claims, authz) {
  const base = new URL(request.url).origin;
  return {
    claims,
    call: async (path, { method = 'GET', body, auth = true } = {}) => {
      const headers = new Headers();
      if (auth) headers.set('Authorization', authz);
      if (body !== undefined) headers.set('Content-Type', 'application/json');
      const req = new Request(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      const res = await dispatch(req, env);
      let data = {};
      try { data = await res.json(); } catch (_) { /* corps vide */ }
      if (!res.ok) throw new Error((data && (data.error || data.message)) || `${path} → ${res.status}`);
      return data;
    },
  };
}

async function handleOne(msg, ctx, env, meta) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return rpcError(msg && msg.id, E.INVALID_REQUEST, 'Requête JSON-RPC invalide');
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const asked = String(params.protocolVersion || '');
      const protocolVersion = PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, title: 'Keystone OS', version: MCP_SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/roots/list_changed':
      return null;                                   // notification : rien à renvoyer
    case 'ping':
      return isNotification ? null : rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: mcpToolList() });
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments && typeof params.arguments === 'object') ? params.arguments : {};
      const tool = mcpTool(name);
      if (!tool) return rpcError(id, E.PARAMS, `Outil inconnu : ${name}`);
      /* Portée OAuth : sprint 2 = lectures, keystone.read requis. (Un JWT
         Keystone n'a pas de portée : voie complète, comme au sprint 1.) */
      if (Array.isArray(ctx.claims.scope) && !ctx.claims.scope.includes('keystone.read'))
        return rpcResult(id, { content: [{ type: 'text', text: 'Portée keystone.read absente de cette connexion : réautorisez Keystone depuis Claude.' }], isError: true });
      /* validation minimale des requis (le schéma complet est publié par tools/list) */
      for (const req of (tool.inputSchema.required || [])) {
        if (args[req] === undefined || args[req] === null || args[req] === '')
          return rpcResult(id, { content: [{ type: 'text', text: `Paramètre requis manquant : ${req}` }], isError: true });
      }
      const t0 = Date.now();
      try {
        const result = await tool.run(ctx, args);
        await ledger(env, { ...meta, tool: name, ms: Date.now() - t0, ok: true });
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false });
      } catch (e) {
        const message = (e && e.message) || String(e);
        await ledger(env, { ...meta, tool: name, ms: Date.now() - t0, ok: false, error: message });
        return rpcResult(id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return isNotification ? null : rpcError(id, E.METHOD, `Méthode inconnue : ${method}`);
  }
}

/**
 * Point d'entrée. `dispatch(request, env)` = le routeur du Worker lui-même
 * (index.js le passe pour éviter un import circulaire).
 */
export async function handleMcp(request, env, dispatch) {
  const method = request.method;
  if (method === 'GET' || method === 'DELETE')
    return reply({ error: 'method_not_allowed', message: 'Serveur MCP sans état : POST uniquement.' }, 405, { 'Allow': 'POST' });
  if (method !== 'POST') return reply({ error: 'method_not_allowed' }, 405, { 'Allow': 'POST' });

  /* ── Auth : jeton OAuth (sprint 2) ou JWT Keystone (sprint 1) ── */
  const who = await authenticate(request, env);
  if (!who.claims) return unauthorized(request, who.error);
  const { claims, authz } = who;

  /* ── Corps JSON-RPC ── */
  const len = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (len > MAX_BODY) return reply(rpcError(null, E.INVALID_REQUEST, 'Corps trop volumineux'), 413);
  let payload;
  try { payload = await request.json(); }
  catch (_) { return reply(rpcError(null, E.PARSE, 'JSON illisible'), 400); }

  /* ── Plafond quotidien par sujet (fail-open) ── */
  const sh = await subHash(claims.sub);
  const isCall = Array.isArray(payload) ? payload.some(m => m && m.method === 'tools/call') : (payload && payload.method === 'tools/call');
  if (isCall) {
    try {
      if (await ipRateExceeded(env, 'mcp:tools', sh, DAILY_CAP))
        return reply(rpcError(payload.id ?? null, E.INTERNAL, 'Plafond quotidien d’appels atteint — revenez demain.'), 429);
      await ipRateBump(env, 'mcp:tools', sh);
    } catch (_) { /* fail-open */ }
  }

  const ctx  = makeCtx(request, env, dispatch, claims, authz);
  const meta = { subHash: sh, plan: claims.plan || null };
  const protoHeader = { 'MCP-Protocol-Version': PROTOCOLS.includes(request.headers.get('MCP-Protocol-Version')) ? request.headers.get('MCP-Protocol-Version') : PROTOCOLS[0] };

  if (Array.isArray(payload)) {
    if (!payload.length) return reply(rpcError(null, E.INVALID_REQUEST, 'Lot vide'), 400);
    const out = [];
    for (const m of payload) { const r = await handleOne(m, ctx, env, meta); if (r) out.push(r); }
    return out.length ? reply(out, 200, protoHeader) : reply(null, 202, protoHeader);
  }
  const r = await handleOne(payload, ctx, env, meta);
  return r ? reply(r, 200, protoHeader) : reply(null, 202, protoHeader);
}
