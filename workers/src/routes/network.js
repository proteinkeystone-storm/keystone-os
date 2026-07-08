/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes networK (Pad O-NET-001) · NK-2 (persistance)

   Réseau relationnel vivant (PAS un CRM). V1 100 % manuelle, ZÉRO IA.

   GET    /api/network/health              Public — santé du moteur
   GET    /api/network/bootstrap           { categories, contacts } du tenant (+ seed 1re fois)
   POST   /api/network/category            Créer une catégorie
   PATCH  /api/network/category/:id        Renommer / picto / position
   DELETE /api/network/category/:id        Supprimer (contacts orphelins → category_id null)
   POST   /api/network/contact             Créer un contact
   PATCH  /api/network/contact/:id         Modifier (partiel)
   DELETE /api/network/contact/:id         Supprimer (+ activité liée)

   L'activité (nk_activity) a sa table créée ici ; ses routes arrivent en NK-5.

   Auth : JWT obligatoire (sauf health). Tenant = identité authentifiée
   (claims.sub), JAMAIS un paramètre client. Admin → 'default'. Schéma
   auto-appliqué au 1er appel (patron keynapse.js). ISOLATION : préfixe
   tables nk_, préfixe routes /api/network/. Aucune table partagée.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, generateId, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

const NK_ENGINE_VERSION = 'NK-7';

const MAX_NAME_LEN   = 200;
const MAX_FIELD_LEN  = 200;
const MAX_ADDR_LEN   = 400;   // adresse (lieu) : peut tenir sur plusieurs lignes
const MAX_URL_LEN    = 400;   // site web / liens réseaux sociaux
const MAX_SOCIALS    = 20;
const MAX_PHOTO_LEN  = 300000; // photo manuelle = data URL base64 (~200px JPEG ≈ 20-30 Ko)
const MAX_NOTES_LEN  = 8000;
const MAX_CONTACTS   = 5000;   // garde-fou par tenant
const MAX_CATEGORIES = 100;
const KINDS = ['person', 'company', 'place', 'group'];

// Catégories par défaut, semées à la 1re ouverture (l'utilisateur les
// renomme/supprime librement — cf. NK-3). Pictos = registre ui-icons.js.
const DEFAULT_CATEGORIES = [
  { label: 'Clients',         icon: 'users' },
  { label: 'Fournisseurs',    icon: 'briefcase' },
  { label: 'Partenaires',     icon: 'handshake' },
  { label: 'Équipe',          icon: 'users' },
  { label: 'Presse & médias', icon: 'newspaper' },
  { label: 'Institutions',    icon: 'landmark' },
  { label: 'Divers',          icon: 'tag' },
];

// ── Schéma auto-appliqué (idempotent, une fois par isolate) ─────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS nk_categories (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       label TEXT NOT NULL, icon TEXT, position INTEGER NOT NULL DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_nk_categories_tenant ON nk_categories(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS nk_contacts (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       category_id TEXT, kind TEXT NOT NULL DEFAULT 'person',
       name TEXT NOT NULL, company TEXT, title TEXT, email TEXT, phone TEXT,
       phone2 TEXT, website TEXT, address TEXT, socials TEXT NOT NULL DEFAULT '[]',
       photo TEXT, birthday TEXT, birthday_remind INTEGER NOT NULL DEFAULT 0,
       roles TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]',
       notes TEXT NOT NULL DEFAULT '', photo_key TEXT, position INTEGER NOT NULL DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_nk_contacts_tenant ON nk_contacts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_nk_contacts_cat ON nk_contacts(tenant_id, category_id)`,
    `CREATE TABLE IF NOT EXISTS nk_activity (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       contact_id TEXT NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL,
       source TEXT NOT NULL DEFAULT 'manual',
       happened_at TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')),
       FOREIGN KEY (tenant_id) REFERENCES tenants(id))`,
    `CREATE INDEX IF NOT EXISTS idx_nk_activity_contact ON nk_activity(tenant_id, contact_id)`,
  ];
  for (const sql of stmts) { await env.DB.prepare(sql).run(); }

  // Migration additive : CREATE IF NOT EXISTS n'ajoute PAS de colonne à une
  // table déjà créée en prod → ALTER idempotent (patron social/schema.js).
  // 2ᵉ téléphone, site web, adresse (lieu), réseaux sociaux (JSON).
  const info = await env.DB.prepare('PRAGMA table_info(nk_contacts)').all();
  const have = new Set((info.results || []).map(c => c.name));
  if (!have.has('phone2'))  await env.DB.prepare(`ALTER TABLE nk_contacts ADD COLUMN phone2 TEXT`).run();
  if (!have.has('website')) await env.DB.prepare(`ALTER TABLE nk_contacts ADD COLUMN website TEXT`).run();
  if (!have.has('address')) await env.DB.prepare(`ALTER TABLE nk_contacts ADD COLUMN address TEXT`).run();
  if (!have.has('socials')) await env.DB.prepare(`ALTER TABLE nk_contacts ADD COLUMN socials TEXT NOT NULL DEFAULT '[]'`).run();
  if (!have.has('photo'))    await env.DB.prepare(`ALTER TABLE nk_contacts ADD COLUMN photo TEXT`).run();
  if (!have.has('birthday')) await env.DB.prepare(`ALTER TABLE nk_contacts ADD COLUMN birthday TEXT`).run();
  if (!have.has('birthday_remind')) await env.DB.prepare(`ALTER TABLE nk_contacts ADD COLUMN birthday_remind INTEGER NOT NULL DEFAULT 0`).run();

  _schemaReady = true;
}

// ── Auth / tenant (patron keynapse.js) ──────────────────────────
function _tenantOf(request, env, claims) {
  if (requireAdmin(request, env)) return 'default';
  if (!claims) return null;
  if (claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN') return 'default';
  return claims.sub || null;
}
async function _ensureTenant(env, id, plan) {
  if (!id || id === 'default') return;
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO tenants (id, name, plan) VALUES (?, ?, ?)")
      .bind(id, 'Client Keystone', plan || 'STARTER').run();
  } catch (_) { /* non bloquant */ }
}
async function _gate(request, env, origin) {
  const claims = await requireJWT(request, env);
  if (!claims && !requireAdmin(request, env)) return { error: err('Authentification requise', 401, origin) };
  const tenant = _tenantOf(request, env, claims);
  if (!tenant) return { error: err('Authentification requise', 401, origin) };
  await _ensureSchema(env);
  await _ensureTenant(env, tenant, claims && claims.plan);
  return { claims, tenant };
}

// ── Helpers ─────────────────────────────────────────────────────
const CAT_COLS     = 'id, label, icon, position, created_at';
const CONTACT_COLS = 'id, category_id, kind, name, company, title, email, phone, phone2, website, address, socials, photo, birthday, birthday_remind, roles, tags, notes, position, created_at, updated_at';
const ACT_COLS     = 'id, contact_id, type, label, source, happened_at, created_at';
const ACT_TYPES    = ['call', 'email', 'meeting', 'quote', 'doc', 'note', 'other'];
function _s(v, max) { return v == null ? null : String(v).slice(0, max); }
function _jsonArr(v) {                          // valide un tableau JSON, sinon '[]'
  if (Array.isArray(v)) { try { return JSON.stringify(v).slice(0, 4000); } catch (_) { return '[]'; } }
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? JSON.stringify(p).slice(0, 4000) : '[]'; } catch (_) { return '[]'; } }
  return '[]';
}
// Réseaux sociaux : JSON [{type, url}, …] assaini (type court, url plafonnée,
// entrées vides ignorées, plafond MAX_SOCIALS). Stocké en TEXT comme roles/tags.
// Photo manuelle : accepte UNIQUEMENT une data URL image (base64), plafonnée.
// '' = effacement explicite. Tout le reste (URL distante, non-image) → null (ignoré).
function _photo(v) {
  if (v == null) return null;
  const s = String(v);
  if (s === '') return '';
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s)) return null;
  return s.length > MAX_PHOTO_LEN ? null : s;
}
// Anniversaire : 'YYYY-MM-DD' (l'année peut être un simple repère). '' = effacement.
// Format invalide → null (ignoré). Le rappel annuel se fait sur le mois+jour.
function _birthday(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function _bool01(v) { return (v === 1 || v === '1' || v === true) ? 1 : 0; }   // rappel anniversaire (opt-in)
function _socials(v) {
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch (_) { arr = []; } }
  if (!Array.isArray(arr)) return '[]';
  const out = [];
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const url = _s(s.url, MAX_URL_LEN); if (!url) continue;
    out.push({ type: _s(s.type, 24) || 'other', url: url.trim() });
    if (out.length >= MAX_SOCIALS) break;
  }
  return JSON.stringify(out).slice(0, 4000);
}

// ── Health (public) ─────────────────────────────────────────────
export async function handleNetworkHealth(request, env) {
  const origin = getAllowedOrigin(env, request);
  let schema = 'ready';
  try { await _ensureSchema(env); } catch (_) { schema = 'error'; }
  return json({ ok: true, engine: NK_ENGINE_VERSION, schema }, 200, origin);
}

// ── Bootstrap : tout le réseau du tenant (+ seed la 1re fois) ────
export async function handleNetworkBootstrap(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  try {
    let categories = (await env.DB.prepare(
      `SELECT ${CAT_COLS} FROM nk_categories WHERE tenant_id = ? ORDER BY position, created_at`).bind(t).all()).results || [];

    // Seed unique : aucune catégorie ET aucun contact → poser le squelette.
    if (!categories.length) {
      const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM nk_contacts WHERE tenant_id = ?').bind(t).first())?.n || 0;
      if (!n) {
        for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
          const d = DEFAULT_CATEGORIES[i];
          await env.DB.prepare(
            `INSERT INTO nk_categories (id, tenant_id, label, icon, position) VALUES (?, ?, ?, ?, ?)`
          ).bind(generateId(), t, d.label, d.icon, i).run();
        }
        categories = (await env.DB.prepare(
          `SELECT ${CAT_COLS} FROM nk_categories WHERE tenant_id = ? ORDER BY position, created_at`).bind(t).all()).results || [];
      }
    }

    const contacts = (await env.DB.prepare(
      `SELECT ${CONTACT_COLS} FROM nk_contacts WHERE tenant_id = ? ORDER BY position, name`).bind(t).all()).results || [];

    const activity = (await env.DB.prepare(
      `SELECT ${ACT_COLS} FROM nk_activity WHERE tenant_id = ? ORDER BY happened_at DESC LIMIT 3000`).bind(t).all()).results || [];

    return json({ ok: true, engine: NK_ENGINE_VERSION, categories, contacts, activity }, 200, origin);
  } catch (e) {
    return err('Lecture impossible : ' + (e && e.message || 'erreur'), 500, origin);
  }
}

// ── Catégories ──────────────────────────────────────────────────
export async function handleCategoryCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const body = await parseBody(request);

  const label = String(body.label || '').trim();
  if (!label) return err('Nom requis', 400, origin);
  if (label.length > MAX_NAME_LEN) return err(`Nom trop long (max ${MAX_NAME_LEN})`, 400, origin);

  const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM nk_categories WHERE tenant_id = ?').bind(t).first())?.n || 0;
  if (count >= MAX_CATEGORIES) return err('Limite de catégories atteinte', 403, origin);

  const id = generateId();
  const icon = _s(body.icon, 40) || 'folder';
  const position = Number.isFinite(body.position) ? Number(body.position) : count;
  await env.DB.prepare(
    `INSERT INTO nk_categories (id, tenant_id, label, icon, position) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, t, label, icon, position).run();
  const category = await env.DB.prepare(`SELECT ${CAT_COLS} FROM nk_categories WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, category }, 200, origin);
}

export async function handleCategoryUpdate(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const existing = await env.DB.prepare('SELECT id FROM nk_categories WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (!existing) return err('Catégorie introuvable', 404, origin);

  const body = await parseBody(request);
  const sets = [], vals = [];
  if (typeof body.label === 'string') {
    const l = body.label.trim();
    if (!l) return err('Nom requis', 400, origin);
    if (l.length > MAX_NAME_LEN) return err(`Nom trop long (max ${MAX_NAME_LEN})`, 400, origin);
    sets.push('label = ?'); vals.push(l);
  }
  if (typeof body.icon === 'string') { sets.push('icon = ?'); vals.push(_s(body.icon, 40)); }
  if (Number.isFinite(body.position)) { sets.push('position = ?'); vals.push(Number(body.position)); }
  if (!sets.length) return err('Rien à modifier', 400, origin);

  vals.push(id, t);
  await env.DB.prepare(`UPDATE nk_categories SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  const category = await env.DB.prepare(`SELECT ${CAT_COLS} FROM nk_categories WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, category }, 200, origin);
}

export async function handleCategoryDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const existing = await env.DB.prepare('SELECT id FROM nk_categories WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (!existing) return err('Catégorie introuvable', 404, origin);
  // Contacts orphelins : category_id → NULL (jamais de suppression en cascade des contacts)
  await env.DB.prepare('UPDATE nk_contacts SET category_id = NULL WHERE category_id = ? AND tenant_id = ?').bind(id, t).run();
  await env.DB.prepare('DELETE FROM nk_categories WHERE id = ? AND tenant_id = ?').bind(id, t).run();
  return json({ ok: true, deleted: id }, 200, origin);
}

// ── Contacts ────────────────────────────────────────────────────
export async function handleContactCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const body = await parseBody(request);

  const name = String(body.name || '').trim();
  if (!name) return err('Nom requis', 400, origin);
  if (name.length > MAX_NAME_LEN) return err(`Nom trop long (max ${MAX_NAME_LEN})`, 400, origin);

  const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM nk_contacts WHERE tenant_id = ?').bind(t).first())?.n || 0;
  if (count >= MAX_CONTACTS) return err('Limite de contacts atteinte', 403, origin);

  // category_id : doit appartenir au tenant (sinon null)
  let categoryId = body.category_id ? String(body.category_id).slice(0, 64) : null;
  if (categoryId) {
    const c = await env.DB.prepare('SELECT id FROM nk_categories WHERE id = ? AND tenant_id = ?').bind(categoryId, t).first();
    if (!c) categoryId = null;
  }
  const kind = KINDS.includes(body.kind) ? body.kind : 'person';
  const id = generateId();
  await env.DB.prepare(
    `INSERT INTO nk_contacts (id, tenant_id, category_id, kind, name, company, title, email, phone, phone2, website, address, socials, photo, birthday, birthday_remind, roles, tags, notes, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, t, categoryId, kind, name,
    _s(body.company, MAX_FIELD_LEN), _s(body.title, MAX_FIELD_LEN),
    _s(body.email, MAX_FIELD_LEN), _s(body.phone, MAX_FIELD_LEN),
    _s(body.phone2, MAX_FIELD_LEN), _s(body.website, MAX_URL_LEN), _s(body.address, MAX_ADDR_LEN), _socials(body.socials),
    _photo(body.photo), _birthday(body.birthday), _bool01(body.birthday_remind),
    _jsonArr(body.roles), _jsonArr(body.tags), _s(body.notes, MAX_NOTES_LEN) || '',
    Number.isFinite(body.position) ? Number(body.position) : count).run();

  const contact = await env.DB.prepare(`SELECT ${CONTACT_COLS} FROM nk_contacts WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, contact }, 200, origin);
}

export async function handleContactUpdate(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const existing = await env.DB.prepare('SELECT id FROM nk_contacts WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (!existing) return err('Contact introuvable', 404, origin);

  const body = await parseBody(request);
  const sets = [], vals = [];
  if (typeof body.name === 'string') {
    const nm = body.name.trim();
    if (!nm) return err('Nom requis', 400, origin);
    if (nm.length > MAX_NAME_LEN) return err(`Nom trop long (max ${MAX_NAME_LEN})`, 400, origin);
    sets.push('name = ?'); vals.push(nm);
  }
  if ('category_id' in body) {
    let cid = body.category_id ? String(body.category_id).slice(0, 64) : null;
    if (cid) { const c = await env.DB.prepare('SELECT id FROM nk_categories WHERE id = ? AND tenant_id = ?').bind(cid, t).first(); if (!c) cid = null; }
    sets.push('category_id = ?'); vals.push(cid);
  }
  if (KINDS.includes(body.kind)) { sets.push('kind = ?'); vals.push(body.kind); }
  for (const f of ['company', 'title', 'email', 'phone', 'phone2']) {
    if (typeof body[f] === 'string') { sets.push(`${f} = ?`); vals.push(_s(body[f], MAX_FIELD_LEN)); }
  }
  if (typeof body.website === 'string') { sets.push('website = ?'); vals.push(_s(body.website, MAX_URL_LEN)); }
  if (typeof body.address === 'string') { sets.push('address = ?'); vals.push(_s(body.address, MAX_ADDR_LEN)); }
  if ('socials' in body) { sets.push('socials = ?'); vals.push(_socials(body.socials)); }
  if ('photo' in body) { const p = _photo(body.photo); if (p !== null) { sets.push('photo = ?'); vals.push(p); } }   // null = data invalide → on ignore
  if ('birthday' in body) { const b = _birthday(body.birthday); if (b !== null) { sets.push('birthday = ?'); vals.push(b); } }
  if ('birthday_remind' in body) { sets.push('birthday_remind = ?'); vals.push(_bool01(body.birthday_remind)); }
  if ('roles' in body) { sets.push('roles = ?'); vals.push(_jsonArr(body.roles)); }
  if ('tags'  in body) { sets.push('tags = ?');  vals.push(_jsonArr(body.tags)); }
  if (typeof body.notes === 'string') { sets.push('notes = ?'); vals.push(_s(body.notes, MAX_NOTES_LEN) || ''); }
  if (Number.isFinite(body.position)) { sets.push('position = ?'); vals.push(Number(body.position)); }
  if (!sets.length) return err('Rien à modifier', 400, origin);

  sets.push("updated_at = datetime('now')");
  vals.push(id, t);
  await env.DB.prepare(`UPDATE nk_contacts SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  const contact = await env.DB.prepare(`SELECT ${CONTACT_COLS} FROM nk_contacts WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, contact }, 200, origin);
}

export async function handleContactDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const existing = await env.DB.prepare('SELECT id FROM nk_contacts WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (!existing) return err('Contact introuvable', 404, origin);
  await env.DB.prepare('DELETE FROM nk_activity WHERE contact_id = ? AND tenant_id = ?').bind(id, t).run();
  await env.DB.prepare('DELETE FROM nk_contacts WHERE id = ? AND tenant_id = ?').bind(id, t).run();
  return json({ ok: true, deleted: id }, 200, origin);
}

// ── Journal d'activité (NK-5, manuel — source='manual') ─────────
export async function handleActivityList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const contact = new URL(request.url).searchParams.get('contact');
  try {
    const activity = contact
      ? (await env.DB.prepare(`SELECT ${ACT_COLS} FROM nk_activity WHERE tenant_id = ? AND contact_id = ? ORDER BY happened_at DESC`).bind(t, contact).all()).results || []
      : (await env.DB.prepare(`SELECT ${ACT_COLS} FROM nk_activity WHERE tenant_id = ? ORDER BY happened_at DESC LIMIT 3000`).bind(t).all()).results || [];
    return json({ ok: true, activity }, 200, origin);
  } catch (e) { return err('Lecture impossible : ' + (e && e.message || 'erreur'), 500, origin); }
}

export async function handleActivityCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const body = await parseBody(request);

  const contactId = body.contact_id ? String(body.contact_id).slice(0, 64) : null;
  if (!contactId) return err('Contact requis', 400, origin);
  const c = await env.DB.prepare('SELECT id FROM nk_contacts WHERE id = ? AND tenant_id = ?').bind(contactId, t).first();
  if (!c) return err('Contact introuvable', 404, origin);

  const label = String(body.label || '').trim();
  if (!label) return err('Libellé requis', 400, origin);
  const type = ACT_TYPES.includes(body.type) ? body.type : 'other';
  // happened_at : 'YYYY-MM-DD' accepté (validé), sinon maintenant.
  let happened = null;
  if (typeof body.happened_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(body.happened_at)) happened = body.happened_at.slice(0, 19);

  const id = generateId();
  await env.DB.prepare(
    `INSERT INTO nk_activity (id, tenant_id, contact_id, type, label, source, happened_at)
     VALUES (?, ?, ?, ?, ?, 'manual', COALESCE(?, datetime('now')))`
  ).bind(id, t, contactId, type, _s(label, MAX_FIELD_LEN), happened).run();

  const activity = await env.DB.prepare(`SELECT ${ACT_COLS} FROM nk_activity WHERE id = ? AND tenant_id = ?`).bind(id, t).first();
  return json({ ok: true, activity }, 200, origin);
}

export async function handleActivityDelete(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin);
  if (gate.error) return gate.error;
  const t = gate.tenant;
  const existing = await env.DB.prepare('SELECT id FROM nk_activity WHERE id = ? AND tenant_id = ?').bind(id, t).first();
  if (!existing) return err('Activité introuvable', 404, origin);
  await env.DB.prepare('DELETE FROM nk_activity WHERE id = ? AND tenant_id = ?').bind(id, t).run();
  return json({ ok: true, deleted: id }, 200, origin);
}
