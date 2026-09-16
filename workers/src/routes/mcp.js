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

   Écritures (sprint 3) : outils write:true → portée keystone.write ;
   confirm:true → aperçu + confirm_token (5 min) puis exécution unique
   (routes/mcp-writes.js) ; Bannette pour ce qui vit dans le navigateur.

   Pont (sprint 4) : outils exec:'browser' → ctx.bridge(action, args) :
   l'onglet Keystone ouvert exécute l'action de son catalogue
   (app/bridge-actions.js) et répond (routes/mcp-bridge.js) ; sans
   onglet ou sans réponse à temps → repli (bannette) ou erreur claire.

   Reflet (sprint 5) : sans onglet, un outil navigateur en lecture peut
   se rabattre sur le reflet chiffré publié par l'onglet (routes/
   mcp-mirror.js) — la clé est dérivée du SECRET porté par le jeton OAuth
   de l'appel, en mémoire seulement ; un JWT Keystone n'en a pas.

   Moteur générique (sprint 6) : les pads-formulaires de app/pads-data.js
   sont exposés sans code par pad — outils keystone_form_* (lib/mcp-forms.js)
   et RESSOURCES MCP keystone://pad/<id>/prompt (resources/list, /read,
   /templates/list) : la recette du pad, servie à Claude qui génère lui-même.

   Métrage : aucun crédit consommé (le raisonnement tourne chez Claude).
   Ledger `mcp_calls` (sujet, outil, durée, ok) pour l'observabilité, et
   plafond quotidien par sujet (fail-open, comme les surfaces publiques).
   ═══════════════════════════════════════════════════════════════ */
import { requireJWT, signJWT }                from '../lib/jwt.js';
import { mcpTool, mcpToolList }               from '../lib/mcp-tools.js';
import { ipRateExceeded, ipRateBump }          from '../lib/ip-throttle.js';
import { resolveMcpAccessToken, ACCESS_PREFIX } from './oauth.js';
import { issueConfirmation, consumeConfirmation, subHash, CONFIRM_TTL_S } from './mcp-writes.js';
import { bridgePresence, bridgeRun } from './mcp-bridge.js';
import { mirrorRead } from './mcp-mirror.js';
import { bagAllows } from '../lib/app-access.js';
import { formResources, padIdFromUri, resolveFormPad, formPromptMarkdown } from '../lib/mcp-forms.js';

const INTERNAL_JWT_TTL_S = 300;   // JWT interne minté pour un appel OAuth : le temps d'une requête

export const MCP_SERVER_NAME    = 'keystone-os';
export const MCP_SERVER_VERSION = '1.0.0';
const PROTOCOLS  = ['2025-06-18', '2025-03-26', '2024-11-05'];   // acceptés, du plus récent au plus ancien
const DAILY_CAP  = 2000;      // appels d'outils / sujet / jour (fail-open)
const MAX_BODY   = 64 * 1024; // un appel d'outil ne porte que des arguments courts
const INSTRUCTIONS =
  "Keystone OS : les outils keystone_* lisent et écrivent dans les données métier du compte connecté (QR codes, sites surveillés, notes, jumeaux Smart Agent, revues desK, réseaux sociaux, formulaires, chartes, contacts). " +
  "Commence par keystone_os_catalog pour connaître les applications du compte, ou keystone_livinglayer_board pour « quoi de neuf ». " +
  "Les noms (QR, site, note, jumeau, revue, contact…) se cherchent par correspondance exacte puis partielle, accents ignorés ; en cas d'ambiguïté l'outil liste les candidats. " +
  "Écritures sûres (note Keynapse, site et audit Sentinel, contact et interaction networK, revue desK) : directes. " +
  "Écritures à confirmation (fiche de savoir Smart Agent, charte Key Brand) : le premier appel rend un aperçu et un confirm_token — montre l'aperçu à l'utilisateur, puis rappelle le même outil avec les mêmes arguments plus confirm_token (valable 5 min, usage unique). " +
  "Navigateur : certains outils (séances Brainstorming, bibliothèque Ghost Writer, composer Social, ouverture d'un pad) s'exécutent dans l'onglet Keystone de l'utilisateur s'il est ouvert (keystone_bridge_status le dit) ; sinon les écritures sont déposées dans la bannette, que l'utilisateur applique à l'ouverture de Keystone, et les lectures demandent d'ouvrir Keystone ; rien n'est publié. " +
  "Formulaires : keystone_form_list liste les pads-formulaires (Notices VEFA, Annonces…), keystone_form_prompt (ou la ressource keystone://pad/<id>/prompt) donne la recette et les champs — génère toi-même avec cette recette, puis keystone_form_fill ouvre le formulaire pré-rempli dans Keystone (validation stricte des champs). " +
  "Aucun outil ne supprime, ne publie, ne modifie un QR existant, ni ne touche licence, facturation ou Key Form. Dates en ISO 8601 UTC.";

/* ── JSON-RPC helpers ── */
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError  = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } });
const E = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603, RESOURCE: -32002 };

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
    return { claims: c, authz: `Bearer ${internal}`, secret: r.secret || null };   // secret : clé des reflets, jamais stocké
  }
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return { error: 'Jeton invalide ou expiré.' };
  return { claims, authz: header };
}

/* Empreinte du sujet (plafond quotidien, ledger) : subHash() de mcp-writes.js,
   partagée avec /api/mcp/activity — jamais le sub en clair en base. */

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
    /* sprint 3 — libellé d'une écriture réussie (« Note « X » créée dans Keynapse »)
       pour le bandeau d'activité de l'onglet ; ledger antérieur = colonne ajoutée. */
    try { await env.DB.prepare('ALTER TABLE mcp_calls ADD COLUMN label TEXT').run(); } catch (_) { /* déjà là */ }
    _ledgerReady = true;
  } catch (e) { console.warn('[mcp] ledger init failed:', e.message); }
}
async function ledger(env, row) {
  try {
    await ensureLedger(env);
    await env.DB.prepare('INSERT INTO mcp_calls (id, sub_hash, plan, tool, ms, ok, error, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), row.subHash, row.plan || null, row.tool, row.ms | 0, row.ok ? 1 : 0, row.error ? String(row.error).slice(0, 300) : null, row.label ? String(row.label).slice(0, 200) : null)
      .run();
  } catch (e) { console.warn('[mcp] ledger write failed:', e.message); }
}

/* ── Le contexte d'exécution d'un outil ──
   call(path, {method, body, auth}) : appel INTERNE d'une route du Worker
   avec le JWT du client. Réponse JSON ; erreur → message serveur tel quel.
   Sprint 3 :
   · tool     : nom de l'outil en cours (posé par handleOne).
   · confirm(args, preview) : sans confirm_token → rend l'aperçu + jeton
     (à RETOURNER tel quel) ; avec un jeton valable → null (on exécute) ;
     jeton refusé → throw. Le jeton est lié au compte, à la connexion
     OAuth, à l'outil et aux arguments.
   · quota(scope, cap, quoi) : plafond quotidien par sujet (fail-open). */
function makeCtx(request, env, dispatch, claims, authz, sh, secret = null) {
  const base = new URL(request.url).origin;
  const QUOTA = Symbol('quota');
  const ctx = {
    claims, tool: null,
    /* Accès applicatif (sprint 6) : même règle que les routes des pads
       (lib/app-access.bagAllows) — ADMIN/MAX tout, sinon le sac de la licence.
       Base muette ou licence introuvable → on laisse passer (fail-open dit). */
    appAllowed: async (appId) => {
      if (claims.isAdmin || /^(ADMIN|MAX)$/.test(String(claims.plan || '').toUpperCase())) return true;
      try {
        const row = await env.DB.prepare('SELECT plan, owned_assets FROM licences WHERE lookup_hmac = ? LIMIT 1').bind(claims.sub).first();
        if (!row) return true;
        let bag = null; try { bag = row.owned_assets == null ? null : JSON.parse(row.owned_assets); } catch (_) { bag = null; }
        return bagAllows({ ownedAssets: bag, plan: row.plan, appId });
      } catch (_) { return true; }
    },
    /* Reflet (sprint 5) : lecture du reflet chiffré d'un pad avec la clé dérivée du
       jeton présenté. null si l'appel n'a pas de secret (JWT Keystone). */
    mirror: async (pad) => {
      if (!secret || !claims.connection_id) return { ok: false, reason: 'sans_secret' };
      return mirrorRead(env, { sub: claims.sub, connectionId: claims.connection_id, secret, pad });
    },
    confirm: async (args, preview) => {
      const token = args && args.confirm_token;
      if (token) {
        const r = await consumeConfirmation(env, { sub: claims.sub, connectionId: claims.connection_id || null, tool: ctx.tool, args, token });
        if (!r.ok) throw new Error(`Confirmation refusée : ${r.reason}.`);
        return null;
      }
      const apercu = typeof preview === 'function' ? await preview() : preview;
      const c = await issueConfirmation(env, { sub: claims.sub, connectionId: claims.connection_id || null, tool: ctx.tool, args, preview: apercu });
      return { confirmation_requise: true, apercu, confirm_token: c.token, expire_dans_s: CONFIRM_TTL_S,
        consigne: 'Rien n’a été écrit. Montre cet aperçu à l’utilisateur ; s’il confirme, rappelle le même outil avec les mêmes arguments plus confirm_token.' };
    },
    /* Pont : délègue à l'onglet. fallback(raison) — 'offline' | 'timeout' — rend
       la valeur de repli (bannette…) ; sans fallback → erreur claire. */
    bridge: async (action, args, { fallback = null, waitMs, mirror = null } = {}) => {
      /* mirror = [pad, cléDansLeReflet] : sans onglet (ou onglet muet), on sert
         le reflet chiffré s'il existe, daté — jamais une donnée inventée. */
      const viaMirror = async (why) => {
        if (!mirror) return null;
        const m = await ctx.mirror(mirror[0]);
        if (m.ok) {
          const d = m.data && m.data[mirror[1]];
          if (d === undefined) return null;
          const out = (d && typeof d === 'object' && !Array.isArray(d)) ? { ...d } : { valeur: d };
          out.reflet = { du: m.updated_at, source: 'reflet chiffré publié par Keystone (onglet fermé)', ...(m.avertissement ? { avertissement: m.avertissement } : {}) };
          if (why === 'timeout') out.reflet.note = 'L’onglet Keystone n’a pas répondu à temps : données du reflet.';
          return out;
        }
        if (m.reason === 'perime') throw new Error(`Reflet trop ancien (du ${m.updated_at}) : ouvre Keystone pour le rafraîchir — je ne sers pas une donnée périmée.`);
        if (m.reason === 'illisible') throw new Error('Reflet illisible avec ce jeton (connexion réautorisée depuis ?) : ouvre Keystone, le reflet sera republié.');
        return null;
      };
      const p = await bridgePresence(env, claims.sub);
      if (!p.online) {
        const m = await viaMirror('offline'); if (m) return m;
        if (fallback) return fallback('offline');
        throw new Error('Aucun onglet Keystone ouvert : cette donnée vit dans le navigateur, pas sur le serveur. Ouvre Keystone (protein-keystone.com/app) connecté, puis redemande' + (mirror ? ' — ou active « Visible par mon assistant » dans Réglages → Connecteur MCP pour un reflet lisible onglet fermé.' : '.'));
      }
      const r = await bridgeRun(env, { sub: claims.sub, tool: ctx.tool, action, args: args || {},
        waitMs: waitMs ?? (env.MCP_BRIDGE_WAIT_MS ? Math.max(200, parseInt(env.MCP_BRIDGE_WAIT_MS, 10) || 0) : undefined) });
      if (r.status === 'done') return r.data;
      if (r.status === 'failed') throw new Error(`Dans l’onglet Keystone : ${r.error}`);
      const m = await viaMirror('timeout'); if (m) return m;
      if (fallback) return fallback('timeout');
      throw new Error('L’onglet Keystone n’a pas répondu à temps (onglet en arrière-plan sur mobile, ou occupé). Mets Keystone au premier plan, puis redemande.');
    },
    quota: async (scope, cap, quoi = 'appels') => {
      let exceeded = false;
      try { exceeded = await ipRateExceeded(env, `mcp:${scope}`, sh, cap); if (!exceeded) await ipRateBump(env, `mcp:${scope}`, sh); }
      catch (_) { exceeded = false; }   // fail-open, comme les surfaces publiques
      if (exceeded) throw new Error(`Plafond atteint : ${cap} ${quoi} par jour via l’assistant — reprends demain ou passe par l’application.`);
    },
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
  return ctx;
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
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
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
      return rpcResult(id, { tools: mcpToolList(env) });
    /* ── Ressources (sprint 6) : la recette de chaque pad-formulaire accessible ── */
    case 'resources/list':
      try { return rpcResult(id, { resources: await formResources(ctx) }); }
      catch (e) { return rpcError(id, E.INTERNAL, (e && e.message) || 'ressources indisponibles'); }
    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [{ uriTemplate: 'keystone://pad/{padId}/prompt', name: 'pad/{padId}/prompt', title: 'Recette d’un pad-formulaire', mimeType: 'text/markdown',
        description: 'Recette (system prompt), champs et mode d’emploi d’un pad-formulaire Keystone — padId = ID_KSTORE (ex. O-IMM-002).' }] });
    case 'resources/read': {
      const uri = params && params.uri;
      const padId = padIdFromUri(uri);
      if (!padId) return rpcError(id, E.RESOURCE, `Ressource inconnue : ${uri}`, { uri });
      try {
        const pad = await resolveFormPad(ctx, padId);
        if (!pad.accessible) return rpcError(id, E.RESOURCE, `Ce formulaire n’est pas dans la licence : ${padId}`, { uri });
        return rpcResult(id, { contents: [{ uri: String(uri), mimeType: 'text/markdown', text: formPromptMarkdown(pad) }] });
      } catch (e) { return rpcError(id, E.RESOURCE, (e && e.message) || `Ressource inconnue : ${uri}`, { uri }); }
    }
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments && typeof params.arguments === 'object') ? params.arguments : {};
      const tool = mcpTool(name, env);
      if (!tool) return rpcError(id, E.PARAMS, `Outil inconnu : ${name}`);
      /* Portées OAuth : lecture = keystone.read, écriture = keystone.write.
         (Un JWT Keystone n'a pas de portée : voie complète, comme au sprint 1.) */
      if (Array.isArray(ctx.claims.scope)) {
        const need = tool.write ? 'keystone.write' : 'keystone.read';
        if (!ctx.claims.scope.includes(need))
          return rpcResult(id, { content: [{ type: 'text', text: `Portée ${need} absente de cette connexion : réautorisez Keystone depuis Claude.` }], isError: true });
      }
      /* validation minimale des requis (le schéma complet est publié par tools/list) */
      for (const req of (tool.inputSchema.required || [])) {
        if (args[req] === undefined || args[req] === null || args[req] === '')
          return rpcResult(id, { content: [{ type: 'text', text: `Paramètre requis manquant : ${req}` }], isError: true });
      }
      const t0 = Date.now();
      ctx.tool = name;
      try {
        const result = await tool.run(ctx, args);
        const label = (tool.write && result && !result.confirmation_requise && typeof result.activite === 'string') ? result.activite : null;
        await ledger(env, { ...meta, tool: name, ms: Date.now() - t0, ok: true, label });
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
  const { claims, authz, secret } = who;

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

  const ctx  = makeCtx(request, env, dispatch, claims, authz, sh, secret || null);
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
