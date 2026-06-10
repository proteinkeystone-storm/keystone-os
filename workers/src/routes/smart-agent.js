/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Smart Agent / Kortex (Sprint SA-1) v1.0

   Le pad O-AGT-001 fabrique des « jumeaux numériques de savoir-faire » :
   des agents qui répondent UNIQUEMENT depuis le coffre de savoir Kortex
   du tenant (fiches typées validées), avec citations et repli honnête
   (« Je ne dispose pas de cette information »).

   GET    /api/smart-agent/health                    Public — santé du moteur
   GET    /api/smart-agent/kortex/units              Liste + compteurs (filtres type/status/collection)
   POST   /api/smart-agent/kortex/units              Créer une fiche typée
   PATCH  /api/smart-agent/kortex/units/:id          Modifier (contenu, statut, métadonnées)
   DELETE /api/smart-agent/kortex/units/:id          Supprimer (+ purge FTS)
   GET    /api/smart-agent/kortex/collections        Liste des collections
   POST   /api/smart-agent/kortex/collections        Créer une collection
   PATCH  /api/smart-agent/kortex/collections/:id    Renommer
   DELETE /api/smart-agent/kortex/collections/:id    Supprimer (fiches → sans collection)
   POST   /api/smart-agent/kortex/extract            Coller-texte → fiches proposées
                                                     (KS_AI_MODEL, 1 crédit DORMANT)

   Auth : JWT obligatoire (sauf health). Accès réservé MAX/ADMIN/BETA
   pendant la beta (décision Stéphane 2026-06-10). Tenant = identité
   authentifiée (patron socialTenantOf, routes/social.js) — JAMAIS un
   paramètre client. Schéma auto-appliqué (pattern ai-credits) ; source
   de vérité documentaire : db/migration_smart_agent.sql.

   Doctrine : moteur générique, ZÉRO logique métier ici. Les 7 types de
   fiches et leurs gabarits sont le CONTRAT contenant/contenu — le
   contenu vit en base, par tenant.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, generateId, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { requireJWT }                              from '../lib/jwt.js';
import { KS_AI_MODEL }                             from '../lib/ai-model.js';
import { isEnforceEnabled, consumeCredits, refundCredits } from '../lib/ai-credits.js';

// Version du moteur — bumpée à chaque sprint livré (l'aside du pad l'affiche).
const SA_ENGINE_VERSION = 'SA-1';

// ── Gabarits des 7 types de fiches ─────────────────────────────
// fields : ordre de validation ET d'aplat body_text. required = champ
// obligatoire à la création. kind 'list' = tableau de chaînes (steps).
// Contrat partagé avec le front (FIELD_TEMPLATES de app/smart-agent.js)
// et le CHECK SQL de kortex_units.type.
const UNIT_TEMPLATES = {
  fact:       [{ k: 'statement', required: true }, { k: 'context' }],
  procedure:  [{ k: 'goal', required: true }, { k: 'steps', kind: 'list', required: true }, { k: 'warnings' }],
  qa:         [{ k: 'question', required: true }, { k: 'answer', required: true }],
  case:       [{ k: 'situation', required: true }, { k: 'action', required: true }, { k: 'result', required: true }],
  rule:       [{ k: 'rule', required: true }, { k: 'rationale' }, { k: 'exceptions' }],
  objection:  [{ k: 'objection', required: true }, { k: 'response', required: true }, { k: 'proof' }],
  definition: [{ k: 'term', required: true }, { k: 'definition', required: true }],
};
const UNIT_STATUSES = ['draft', 'validated', 'quarantine', 'expired'];
const MAX_FIELD_LEN = 4000;     // par champ — un coffre = des fiches, pas des romans
const MAX_TITLE_LEN = 200;
const MAX_UNITS_LIST = 500;     // garde-fou de liste (pagination au besoin, plus tard)

// ── Auto-migration idempotente (pattern Keystone, cf ai-credits.js).
//    Miroir exécutable de db/migration_smart_agent.sql. ────────────
let _schemaReady = false;
async function ensureSmartAgentSchema(env) {
  if (_schemaReady) return;
  const safe = async (sql) => {
    try { await env.DB.prepare(sql).run(); } catch (_) { /* déjà créé : OK */ }
  };
  await safe(`
    CREATE TABLE IF NOT EXISTS kortex_collections (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL DEFAULT 'default',
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);
  await safe('CREATE INDEX IF NOT EXISTS idx_kortex_coll_tenant ON kortex_collections(tenant_id)');
  await safe(`
    CREATE TABLE IF NOT EXISTS kortex_units (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL DEFAULT 'default',
      collection_id TEXT,
      type          TEXT NOT NULL CHECK (type IN
                      ('fact','procedure','qa','case','rule','objection','definition')),
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      body_text     TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                      ('draft','validated','quarantine','expired')),
      source_kind   TEXT DEFAULT 'manual',
      source_ref    TEXT,
      lang          TEXT DEFAULT 'fr',
      review_at     TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);
  await safe('CREATE INDEX IF NOT EXISTS idx_kortex_units_tenant  ON kortex_units(tenant_id)');
  await safe('CREATE INDEX IF NOT EXISTS idx_kortex_units_status  ON kortex_units(tenant_id, status)');
  await safe('CREATE INDEX IF NOT EXISTS idx_kortex_units_type    ON kortex_units(tenant_id, type)');
  await safe('CREATE INDEX IF NOT EXISTS idx_kortex_units_coll    ON kortex_units(collection_id)');
  await safe('CREATE INDEX IF NOT EXISTS idx_kortex_units_review  ON kortex_units(review_at)');
  await safe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS kortex_units_fts USING fts5(
      unit_id UNINDEXED,
      title,
      body_text
    )
  `);
  await safe(`
    CREATE TABLE IF NOT EXISTS sa_agents (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL DEFAULT 'default',
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused')),
      config      TEXT NOT NULL DEFAULT '{}',
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);
  await safe('CREATE INDEX IF NOT EXISTS idx_sa_agents_tenant ON sa_agents(tenant_id)');
  await safe(`
    CREATE TABLE IF NOT EXISTS sa_sessions (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL DEFAULT 'default',
      agent_id    TEXT NOT NULL,
      channel     TEXT NOT NULL DEFAULT 'internal' CHECK (channel IN ('internal','public')),
      context     TEXT DEFAULT '{}',
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
      FOREIGN KEY (agent_id)  REFERENCES sa_agents(id)
    )
  `);
  await safe('CREATE INDEX IF NOT EXISTS idx_sa_sessions_tenant ON sa_sessions(tenant_id)');
  await safe('CREATE INDEX IF NOT EXISTS idx_sa_sessions_agent  ON sa_sessions(agent_id)');
  await safe(`
    CREATE TABLE IF NOT EXISTS sa_messages (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      tenant_id   TEXT NOT NULL DEFAULT 'default',
      role        TEXT NOT NULL CHECK (role IN ('user','agent')),
      content     TEXT NOT NULL,
      citations   TEXT,
      grounding   REAL,
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sa_sessions(id)
    )
  `);
  await safe('CREATE INDEX IF NOT EXISTS idx_sa_messages_session ON sa_messages(session_id)');
  await safe(`
    CREATE TABLE IF NOT EXISTS sa_gaps (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL DEFAULT 'default',
      agent_id        TEXT,
      question        TEXT NOT NULL,
      question_norm   TEXT NOT NULL,
      hits            INTEGER NOT NULL DEFAULT 1,
      status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dismissed')),
      unit_id         TEXT,
      first_asked_at  TEXT DEFAULT (datetime('now')),
      last_asked_at   TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);
  await safe('CREATE INDEX IF NOT EXISTS idx_sa_gaps_tenant ON sa_gaps(tenant_id, status)');
  await safe('CREATE INDEX IF NOT EXISTS idx_sa_gaps_norm   ON sa_gaps(tenant_id, question_norm)');
  _schemaReady = true;
}

// ── Auth, entitlement & tenant ──────────────────────────────────
// Beta : Smart Agent réservé aux plans MAX/ADMIN (+ BETA, traité aussi
// généreusement que MAX par ai-credits — ne jamais brider un testeur).
function _entitled(claims) {
  if (!claims) return false;
  if (claims.isAdmin === true) return true;
  const p = String(claims.plan || '').toUpperCase();
  return p === 'MAX' || p === 'ADMIN' || p === 'BETA';
}

// Tenant = identité authentifiée, JAMAIS un paramètre client (même règle
// que socialTenantOf, routes/social.js). Admin → 'default'.
function _tenantOf(request, env, claims) {
  if (requireAdmin(request, env)) return 'default';
  if (!claims) return null;
  if (claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN') return 'default';
  return claims.sub || null;
}

// FK tenants(id) : le tenant d'un client n'existe pas avant sa 1re écriture
// (piège exposé par le 1er test client OAuth social). INSERT OR IGNORE.
async function _ensureTenant(env, id, plan) {
  if (!id || id === 'default') return;
  try {
    await env.DB
      .prepare("INSERT OR IGNORE INTO tenants (id, name, plan) VALUES (?, ?, ?)")
      .bind(id, 'Client Keystone', plan || 'MAX')
      .run();
  } catch (_) { /* non bloquant */ }
}

// Gate commun : JWT + entitlement + tenant. Retourne { claims, tenant }
// ou une Response d'erreur prête à renvoyer.
async function _gate(request, env, origin) {
  const claims = await requireJWT(request, env);
  if (!claims && !requireAdmin(request, env)) return { error: err('Authentification requise', 401, origin) };
  if (claims && !_entitled(claims) && !requireAdmin(request, env)) {
    return { error: err('Smart Agent est réservé au plan MAX pendant la beta.', 403, origin) };
  }
  const tenant = _tenantOf(request, env, claims);
  if (!tenant) return { error: err('Authentification requise', 401, origin) };
  return { claims, tenant };
}

// ── Validation d'une fiche ──────────────────────────────────────
// Retourne { ok:true, body, bodyText } (body nettoyé, champs inconnus
// écartés) ou { ok:false, msg }.
function validateUnit(type, title, rawBody) {
  const tpl = UNIT_TEMPLATES[type];
  if (!tpl) return { ok: false, msg: `Type de fiche inconnu : ${type}` };
  if (typeof title !== 'string' || !title.trim()) return { ok: false, msg: 'Titre requis' };
  if (title.length > MAX_TITLE_LEN) return { ok: false, msg: `Titre trop long (max ${MAX_TITLE_LEN})` };
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ok: false, msg: 'body requis (objet selon le gabarit du type)' };
  }
  const clean = {};
  const flat  = [];
  for (const f of tpl) {
    let v = rawBody[f.k];
    if (f.kind === 'list') {
      if (typeof v === 'string') v = v.split('\n');                  // tolérance : textarea 1 étape/ligne
      if (!Array.isArray(v)) v = [];
      v = v.map(s => String(s).trim()).filter(Boolean).slice(0, 40)
           .map(s => s.slice(0, MAX_FIELD_LEN));
      if (f.required && !v.length) return { ok: false, msg: `Champ requis : ${f.k}` };
      if (v.length) { clean[f.k] = v; flat.push(v.join(' · ')); }
    } else {
      v = (typeof v === 'string') ? v.trim() : '';
      if (f.required && !v) return { ok: false, msg: `Champ requis : ${f.k}` };
      if (v) { clean[f.k] = v.slice(0, MAX_FIELD_LEN); flat.push(clean[f.k]); }
    }
  }
  const bodyText = [title.trim(), ...flat].join('\n');
  return { ok: true, body: clean, bodyText };
}

// ── Synchronisation FTS5 (lexical, servira la recherche SA-2) ───
// Seules les fiches VALIDÉES sont indexées : une fiche en brouillon ou
// en quarantaine ne doit jamais pouvoir être servie par la recherche.
async function _ftsSync(env, unit) {
  await env.DB.prepare('DELETE FROM kortex_units_fts WHERE unit_id = ?').bind(unit.id).run();
  if (unit.status === 'validated') {
    await env.DB
      .prepare('INSERT INTO kortex_units_fts (unit_id, title, body_text) VALUES (?, ?, ?)')
      .bind(unit.id, unit.title, unit.body_text)
      .run();
  }
}

function _rowToUnit(r) {
  let body = {};
  try { body = JSON.parse(r.body); } catch (_) {}
  return {
    id: r.id, type: r.type, title: r.title, body,
    status: r.status, collection_id: r.collection_id,
    source_kind: r.source_kind, source_ref: r.source_ref,
    lang: r.lang, review_at: r.review_at,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET /api/smart-agent/health — public, sans donnée
// ═══════════════════════════════════════════════════════════════
export async function handleSmartAgentHealth(request, env) {
  const origin = getAllowedOrigin(env, request);
  return json({ ok: true, service: 'smart-agent', version: SA_ENGINE_VERSION }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/smart-agent/kortex/units — liste + compteurs
// ═══════════════════════════════════════════════════════════════
export async function handleKortexUnitsList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  await ensureSmartAgentSchema(env);

  const url    = new URL(request.url);
  const type   = url.searchParams.get('type');
  const status = url.searchParams.get('status');
  const coll   = url.searchParams.get('collection');

  let sql = 'SELECT * FROM kortex_units WHERE tenant_id = ?';
  const binds = [gate.tenant];
  if (type && UNIT_TEMPLATES[type])          { sql += ' AND type = ?';          binds.push(type); }
  if (status && UNIT_STATUSES.includes(status)) { sql += ' AND status = ?';     binds.push(status); }
  if (coll)                                  { sql += ' AND collection_id = ?'; binds.push(coll); }
  sql += ` ORDER BY updated_at DESC LIMIT ${MAX_UNITS_LIST}`;

  const { results } = await env.DB.prepare(sql).bind(...binds).all();

  // Compteurs globaux du tenant (pour les chips de filtre + l'aside).
  const { results: cRows } = await env.DB
    .prepare('SELECT status, COUNT(*) AS n FROM kortex_units WHERE tenant_id = ? GROUP BY status')
    .bind(gate.tenant)
    .all();
  const counts = { draft: 0, validated: 0, quarantine: 0, expired: 0, total: 0 };
  for (const r of cRows) { counts[r.status] = r.n; counts.total += r.n; }

  return json({ units: results.map(_rowToUnit), counts }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/smart-agent/kortex/units — créer une fiche
// ═══════════════════════════════════════════════════════════════
export async function handleKortexUnitCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  await ensureSmartAgentSchema(env);

  const b = await parseBody(request);
  if (!b) return err('Body JSON requis', 400, origin);

  const v = validateUnit(b.type, b.title, b.body);
  if (!v.ok) return err(v.msg, 400, origin);

  const status = (b.status === 'validated') ? 'validated' : 'draft';
  const sourceKind = ['manual', 'paste', 'interview', 'gap', 'import'].includes(b.source_kind)
    ? b.source_kind : 'manual';
  const reviewAt = (typeof b.review_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.review_at))
    ? b.review_at : null;

  await _ensureTenant(env, gate.tenant, gate.claims?.plan);

  const unit = {
    id: generateId(),
    tenant_id: gate.tenant,
    collection_id: (typeof b.collection_id === 'string' && b.collection_id) ? b.collection_id : null,
    type: b.type,
    title: b.title.trim(),
    body: JSON.stringify(v.body),
    body_text: v.bodyText,
    status,
    source_kind: sourceKind,
    source_ref: (typeof b.source_ref === 'string' && b.source_ref.trim()) ? b.source_ref.trim().slice(0, 300) : null,
    review_at: reviewAt,
  };

  await env.DB.prepare(`
    INSERT INTO kortex_units
      (id, tenant_id, collection_id, type, title, body, body_text, status, source_kind, source_ref, review_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    unit.id, unit.tenant_id, unit.collection_id, unit.type, unit.title,
    unit.body, unit.body_text, unit.status, unit.source_kind, unit.source_ref, unit.review_at,
  ).run();

  await _ftsSync(env, unit);

  const { results } = await env.DB
    .prepare('SELECT * FROM kortex_units WHERE id = ?').bind(unit.id).all();
  return json({ unit: _rowToUnit(results[0]) }, 201, origin);
}

// ═══════════════════════════════════════════════════════════════
// PATCH /api/smart-agent/kortex/units/:id — modifier
// ═══════════════════════════════════════════════════════════════
export async function handleKortexUnitUpdate(request, env, unitId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  await ensureSmartAgentSchema(env);

  const { results } = await env.DB
    .prepare('SELECT * FROM kortex_units WHERE id = ? AND tenant_id = ?')
    .bind(unitId, gate.tenant)
    .all();
  if (!results.length) return err('Fiche introuvable', 404, origin);
  const cur = results[0];

  const b = await parseBody(request);
  if (!b) return err('Body JSON requis', 400, origin);

  // Contenu : si title/body fournis, revalidation complète selon le type
  // (le type d'une fiche est immuable — recréer plutôt que muter).
  const nextTitle = (typeof b.title === 'string') ? b.title : cur.title;
  let nextBodyJson = cur.body;
  let nextBodyText = cur.body_text;
  if (b.body !== undefined || typeof b.title === 'string') {
    let rawBody = b.body;
    if (rawBody === undefined) { try { rawBody = JSON.parse(cur.body); } catch (_) { rawBody = {}; } }
    const v = validateUnit(cur.type, nextTitle, rawBody);
    if (!v.ok) return err(v.msg, 400, origin);
    nextBodyJson = JSON.stringify(v.body);
    nextBodyText = v.bodyText;
  }

  const nextStatus = UNIT_STATUSES.includes(b.status) ? b.status : cur.status;
  const nextColl   = (b.collection_id === null) ? null
    : (typeof b.collection_id === 'string' && b.collection_id) ? b.collection_id : cur.collection_id;
  const nextReview = (b.review_at === null) ? null
    : (typeof b.review_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.review_at)) ? b.review_at : cur.review_at;
  const nextSource = (b.source_ref === null) ? null
    : (typeof b.source_ref === 'string') ? b.source_ref.trim().slice(0, 300) : cur.source_ref;

  await env.DB.prepare(`
    UPDATE kortex_units
       SET title = ?, body = ?, body_text = ?, status = ?, collection_id = ?,
           review_at = ?, source_ref = ?, updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?
  `).bind(
    nextTitle.trim(), nextBodyJson, nextBodyText, nextStatus, nextColl,
    nextReview, nextSource, unitId, gate.tenant,
  ).run();

  await _ftsSync(env, { id: unitId, status: nextStatus, title: nextTitle.trim(), body_text: nextBodyText });

  const { results: after } = await env.DB
    .prepare('SELECT * FROM kortex_units WHERE id = ?').bind(unitId).all();
  return json({ unit: _rowToUnit(after[0]) }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// DELETE /api/smart-agent/kortex/units/:id
// ═══════════════════════════════════════════════════════════════
export async function handleKortexUnitDelete(request, env, unitId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  await ensureSmartAgentSchema(env);

  const res = await env.DB
    .prepare('DELETE FROM kortex_units WHERE id = ? AND tenant_id = ?')
    .bind(unitId, gate.tenant)
    .run();
  await env.DB.prepare('DELETE FROM kortex_units_fts WHERE unit_id = ?').bind(unitId).run();

  if (!res.meta?.changes) return err('Fiche introuvable', 404, origin);
  return json({ ok: true }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// Collections — CRUD minimal
// ═══════════════════════════════════════════════════════════════
export async function handleKortexCollectionsList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  await ensureSmartAgentSchema(env);

  const { results } = await env.DB.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM kortex_units u WHERE u.collection_id = c.id) AS unit_count
      FROM kortex_collections c
     WHERE c.tenant_id = ?
     ORDER BY c.name COLLATE NOCASE
  `).bind(gate.tenant).all();

  return json({ collections: results }, 200, origin);
}

export async function handleKortexCollectionCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  await ensureSmartAgentSchema(env);

  const b = await parseBody(request);
  const name = (typeof b?.name === 'string') ? b.name.trim().slice(0, 120) : '';
  if (!name) return err('Nom de collection requis', 400, origin);

  await _ensureTenant(env, gate.tenant, gate.claims?.plan);
  const id = generateId();
  await env.DB.prepare(`
    INSERT INTO kortex_collections (id, tenant_id, name, description)
    VALUES (?, ?, ?, ?)
  `).bind(id, gate.tenant, name, (typeof b?.description === 'string') ? b.description.trim().slice(0, 500) : null).run();

  return json({ collection: { id, name } }, 201, origin);
}

export async function handleKortexCollectionUpdate(request, env, collId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  await ensureSmartAgentSchema(env);

  const b = await parseBody(request);
  const name = (typeof b?.name === 'string') ? b.name.trim().slice(0, 120) : '';
  if (!name) return err('Nom de collection requis', 400, origin);

  const res = await env.DB.prepare(`
    UPDATE kortex_collections SET name = ?, updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?
  `).bind(name, collId, gate.tenant).run();
  if (!res.meta?.changes) return err('Collection introuvable', 404, origin);
  return json({ ok: true }, 200, origin);
}

export async function handleKortexCollectionDelete(request, env, collId) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  await ensureSmartAgentSchema(env);

  // Les fiches survivent à leur collection (jamais de suppression en cascade
  // du savoir) : elles repassent simplement « sans collection ».
  await env.DB.prepare('UPDATE kortex_units SET collection_id = NULL WHERE collection_id = ? AND tenant_id = ?')
    .bind(collId, gate.tenant).run();
  const res = await env.DB.prepare('DELETE FROM kortex_collections WHERE id = ? AND tenant_id = ?')
    .bind(collId, gate.tenant).run();
  if (!res.meta?.changes) return err('Collection introuvable', 404, origin);
  return json({ ok: true }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/smart-agent/kortex/extract — coller-texte → fiches proposées
// 1 crédit (DORMANT, flag enforce_ai_credits_v1 — patron Brainstorming).
// Les propositions ne sont PAS sauvegardées : le client les relit, les
// ajuste et les ajoute une à une (validation humaine = doctrine).
// ═══════════════════════════════════════════════════════════════
const EXTRACT_SYSTEM_PROMPT = `Tu es l'extracteur de connaissances de Keystone. On te donne un texte brut (notes, email, documentation, transcription). Tu en extrais des fiches de savoir typées, en français.

Types autorisés et gabarits (champs du "body") :
- "fact"       : { "statement": "...", "context": "..." (optionnel) }
- "procedure"  : { "goal": "...", "steps": ["étape 1", "étape 2", ...], "warnings": "..." (optionnel) }
- "qa"         : { "question": "...", "answer": "..." }
- "case"       : { "situation": "...", "action": "...", "result": "..." }
- "rule"       : { "rule": "...", "rationale": "..." (optionnel), "exceptions": "..." (optionnel) }
- "objection"  : { "objection": "...", "response": "...", "proof": "..." (optionnel) }
- "definition" : { "term": "...", "definition": "..." }

RÈGLES STRICTES :
1. N'extrais QUE ce qui est réellement dans le texte. Aucune invention, aucun enrichissement extérieur.
2. Chaque fiche est autonome et compréhensible seule.
3. "title" : court et descriptif (max 12 mots).
4. Maximum 12 fiches. Qualité avant quantité.
5. Si le texte contient des noms de personnes privées, remplace-les par leur rôle (« le client », « le visiteur »).
6. Réponds UNIQUEMENT avec un tableau JSON valide, sans texte autour :
[{"type":"...","title":"...","body":{...}}, ...]`;

export async function handleKortexExtract(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  await ensureSmartAgentSchema(env);

  const b = await parseBody(request);
  const text = (typeof b?.text === 'string') ? b.text.trim() : '';
  if (text.length < 30)    return err('Texte trop court (30 caractères minimum)', 400, origin);
  if (text.length > 20000) return err('Texte trop long (20 000 caractères maximum)', 400, origin);

  if (!env.AI || typeof env.AI.run !== 'function') {
    return err('Moteur IA indisponible', 503, origin);
  }

  // ── Crédits IA — débit 1 crédit (DORMANT, patron Brainstorming) ──
  let credit = null;
  const sub = gate.claims?.sub;
  if (sub && await isEnforceEnabled(env, sub)) {
    credit = await consumeCredits(env, { bucketKey: sub, plan: gate.claims.plan, tool: 'smartagent' });
    if (!credit.ok && credit.blocked) {
      return json({
        error: 'Crédits IA épuisés ce mois. Rachetez un pack ou attendez le 1er du mois (reset).',
        code : 'AI_CREDITS_EXHAUSTED',
        quota: credit.payload,
      }, 429, origin);
    }
  }

  try {
    const res = await env.AI.run(KS_AI_MODEL, {
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user',   content: `TEXTE À ANALYSER :\n\n${text}` },
      ],
      max_tokens: 3000,
      stream: false,
    });

    // Extraction multi-format (réponse Workers AI : .response ou choices)
    const raw = (res?.response
      ?? res?.choices?.[0]?.message?.content
      ?? '').trim();

    const proposals = _parseProposals(raw);
    if (!proposals.length) {
      // L'IA n'a rien extrait d'exploitable : on rembourse (best-effort).
      if (credit?.ok && credit.cost > 0) {
        await refundCredits(env, { bucketKey: sub, tool: 'smartagent', cost: credit.cost, packsDrawn: credit.packsDrawn });
      }
      return json({ proposals: [], note: 'Aucune fiche exploitable extraite de ce texte.' }, 200, origin);
    }

    return json({ proposals, model: KS_AI_MODEL, credits: credit?.payload || null }, 200, origin);
  } catch (e) {
    // Échec APRÈS débit → refund (patron Ghost Writer).
    if (credit?.ok && credit.cost > 0) {
      await refundCredits(env, { bucketKey: sub, tool: 'smartagent', cost: credit.cost, packsDrawn: credit.packsDrawn });
    }
    return err(`Extraction impossible : ${e.message || 'erreur IA'}`, 502, origin);
  }
}

// Parse tolérant : retire les fences ```json, isole le tableau, valide
// chaque proposition via validateUnit (les invalides sont écartées).
function _parseProposals(raw) {
  let s = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = s.indexOf('[');
  const end   = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  s = s.slice(start, end + 1);

  let arr;
  try { arr = JSON.parse(s); } catch (_) { return []; }
  if (!Array.isArray(arr)) return [];

  const out = [];
  for (const p of arr.slice(0, 12)) {
    if (!p || typeof p !== 'object') continue;
    const v = validateUnit(p.type, p.title, p.body);
    if (v.ok) out.push({ type: p.type, title: String(p.title).trim(), body: v.body });
  }
  return out;
}
