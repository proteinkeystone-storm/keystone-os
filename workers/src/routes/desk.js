/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes desK (Pad O-DSK-001) · DK-2 (marbre & bascule)

   Chemin de fer vivant d'une revue (DESK_BRIEF.md). DK-1 = publications,
   membres/invitations, rubriques, numéros + jalons, cartes-pages,
   articles, échange de pages, pointage, bascule. DK-2 = marbre complet
   (rituel de bouclage, fraîcheur/péremption, historique inter-numéros)
   + MULTI-ARTICLES PAR PAGE (dk_page_slots, §2.4) + DÉPLACEMENT PAR
   INSERTION avec pages figées ancrées (§3.5) + OPÉRATIONS PAR LOT
   (sélection multiple, §3.5). Le cœur reste ZÉRO IA.

   GET    /api/desk/health                    Public — santé du moteur
   GET    /api/desk/bootstrap                 { me, publications } (+ accepte les invites par e-mail)
   POST   /api/desk/publication               Créer une publication (+ rubriques par défaut)
   PATCH  /api/desk/publication/:id           Renommer (propriétaire)
   GET    /api/desk/publication/:id/team      Membres + invitations en attente
   POST   /api/desk/publication/:id/invite    Inviter par e-mail (propriétaire)
   DELETE /api/desk/publication/:id/member/:sub  Retirer un membre (propriétaire)
   POST   /api/desk/publication/:id/rubrique  Créer une rubrique
   PATCH  /api/desk/rubrique/:id              Renommer / couleur / position
   DELETE /api/desk/rubrique/:id              Supprimer (articles orphelins → rub null)
   POST   /api/desk/publication/:id/issue     Créer un numéro (pages générées)
   GET    /api/desk/issue/:id                 { issue, pages, articles } du numéro
   PATCH  /api/desk/issue/:id                 Thème / statut / jalons
   POST   /api/desk/issue/:id/swap            Échanger le contenu de deux pages
   POST   /api/desk/issue/:id/move            Déplacer 1..N pages par insertion (figées ancrées)
   POST   /api/desk/issue/:id/batch           Opération par lot sur une sélection de pages
   PATCH  /api/desk/page/:id                  Figer / libérer / rubrique de page
   POST   /api/desk/page/:id/slot             Ajouter un emplacement (article) sur la page
   PATCH  /api/desk/slot/:id                  Titulaire (bascule) / banc d'un emplacement
   DELETE /api/desk/slot/:id                  Retirer l'emplacement (l'article reste au marbre)
   POST   /api/desk/publication/:id/article   Créer un article
   PATCH  /api/desk/article/:id               Statut (pointage), remise, fraîcheur, contenu
   DELETE /api/desk/article/:id               Supprimer (retiré des emplacements/bancs)

   Le passage d'un numéro au statut « imprime » déclenche le RITUEL DE
   BOUCLAGE (§4) : titulaires → « publie » (histo), remplaçants non
   utilisés → reversés au marbre (histo du report), bancs vidés.

   ⚠ TENANT = LA PUBLICATION (pas la personne) : chaque table métier
   porte pub_id ; l'accès passe par dk_members (pub_id ↔ claims.sub).
   Le point de vigilance n° 1 du brief — le sub n'est JAMAIS le tenant.
   Auth : requireJWT partout (sauf health). ISOLATION : préfixe dk_.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, generateId, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

const DK_ENGINE_VERSION = 'DK-2';

const MAX_NAME_LEN   = 160;
const MAX_TITLE_LEN  = 240;
const MAX_NOTES_LEN  = 60000;   // la copie d'un article reste au marbre (texte léger)
const MAX_PUBS_OWNED = 10;      // garde-fou par propriétaire
const MAX_MEMBERS    = 20;
const MAX_RUBRIQUES  = 30;
const MAX_ISSUES     = 200;
const MAX_PAGES      = 400;     // par numéro
const MAX_ARTICLES   = 2000;    // par publication
const MAX_BANC       = 8;       // remplaçants par emplacement
const MAX_HISTO      = 40;      // entrées d'historique conservées par article
const MAX_SLOTS      = 12;      // emplacements (articles) par page — brèves, papier + encadré…
const MAX_BATCH_NS   = 120;     // pages par opération de lot

const ART_STATUS  = ['propose', 'attendu', 'remis', 'relu', 'maquette', 'publie', 'abandonne'];
const ISSUE_STATUS = ['preparation', 'production', 'boucle', 'imprime'];
const PAGE_KINDS  = ['article', 'vide', 'fixe'];

// Rubriques par défaut d'une publication neuve (liste fermée, éditable).
const DEFAULT_RUBRIQUES = [
  { name: 'Éditorial',   color: '#c9a227' },
  { name: 'Actualités',  color: '#4cc38a' },
  { name: 'Dossier',     color: '#6d8dd6' },
  { name: 'Histoire',    color: '#b3833b' },
  { name: 'Portrait',    color: '#a06cc9' },
  { name: 'Vie de l’association', color: '#5ab3c9' },
  { name: 'Culture',     color: '#c96c6c' },
  { name: 'Courrier',    color: '#c9986c' },
];

// Jalons types d'un numéro (dates fournies à la création).
const JALON_KEYS = ['bouclage', 'maquette', 'imprimeur', 'parution'];

// ── Schéma auto-appliqué (idempotent — patron network.js) ───────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS dk_publications (
       id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_sub TEXT NOT NULL,
       created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE INDEX IF NOT EXISTS idx_dk_pubs_owner ON dk_publications(owner_sub)`,
    `CREATE TABLE IF NOT EXISTS dk_members (
       pub_id TEXT NOT NULL, sub TEXT NOT NULL, name TEXT, email TEXT,
       joined_at TEXT DEFAULT (datetime('now')),
       PRIMARY KEY (pub_id, sub))`,
    `CREATE INDEX IF NOT EXISTS idx_dk_members_sub ON dk_members(sub)`,
    `CREATE TABLE IF NOT EXISTS dk_invites (
       pub_id TEXT NOT NULL, email TEXT NOT NULL, invited_by TEXT,
       created_at TEXT DEFAULT (datetime('now')),
       PRIMARY KEY (pub_id, email))`,
    `CREATE INDEX IF NOT EXISTS idx_dk_invites_email ON dk_invites(email)`,
    `CREATE TABLE IF NOT EXISTS dk_rubriques (
       id TEXT PRIMARY KEY, pub_id TEXT NOT NULL,
       name TEXT NOT NULL, color TEXT, position INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_dk_rubriques_pub ON dk_rubriques(pub_id)`,
    `CREATE TABLE IF NOT EXISTS dk_issues (
       id TEXT PRIMARY KEY, pub_id TEXT NOT NULL,
       num TEXT NOT NULL, theme TEXT, status TEXT NOT NULL DEFAULT 'preparation',
       jalons TEXT NOT NULL DEFAULT '{}',
       created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE INDEX IF NOT EXISTS idx_dk_issues_pub ON dk_issues(pub_id)`,
    `CREATE TABLE IF NOT EXISTS dk_pages (
       id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, pub_id TEXT NOT NULL,
       n INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'vide',
       fixe_tag TEXT, fixe_title TEXT, art_id TEXT,
       banc TEXT NOT NULL DEFAULT '[]',
       updated_at TEXT DEFAULT (datetime('now')), updated_by TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_dk_pages_issue ON dk_pages(issue_id, n)`,
    `CREATE TABLE IF NOT EXISTS dk_articles (
       id TEXT PRIMARY KEY, pub_id TEXT NOT NULL,
       title TEXT NOT NULL, rub_id TEXT, contrib TEXT,
       status TEXT NOT NULL DEFAULT 'propose',
       due TEXT, fresh TEXT NOT NULL DEFAULT 'intemporel', perime TEXT,
       notes TEXT NOT NULL DEFAULT '', histo TEXT NOT NULL DEFAULT '[]',
       created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE INDEX IF NOT EXISTS idx_dk_articles_pub ON dk_articles(pub_id)`,
    // DK-2 : emplacements ordonnés par page (§2.4) — une page peut porter
    // plusieurs articles de plusieurs contributeurs. Le banc vit par emplacement.
    `CREATE TABLE IF NOT EXISTS dk_page_slots (
       id TEXT PRIMARY KEY, page_id TEXT NOT NULL, pub_id TEXT NOT NULL,
       position INTEGER NOT NULL DEFAULT 0, art_id TEXT,
       banc TEXT NOT NULL DEFAULT '[]')`,
    `CREATE INDEX IF NOT EXISTS idx_dk_slots_page ON dk_page_slots(page_id, position)`,
  ];
  for (const sql of stmts) { await env.DB.prepare(sql).run(); }
  // DK-2 : rubrique pré-assignée au niveau de la page (monter un dossier sur
  // des pages encore vides). ALTER idempotent (échoue en silence si déjà là).
  try { await env.DB.prepare(`ALTER TABLE dk_pages ADD COLUMN rub_id TEXT`).run(); } catch (_) {}
  // Migration DK-1 → DK-2 : l'ancien art_id/banc de la page devient l'emplacement 0.
  await env.DB.prepare(
    `INSERT INTO dk_page_slots (id, page_id, pub_id, position, art_id, banc)
     SELECT lower(hex(randomblob(16))), p.id, p.pub_id, 0, p.art_id, COALESCE(p.banc, '[]')
     FROM dk_pages p
     WHERE p.art_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dk_page_slots s WHERE s.page_id = p.id)`).run();
  // Les colonnes héritées ne sont plus la source de vérité — on les vide.
  await env.DB.prepare(`UPDATE dk_pages SET art_id = NULL, banc = '[]' WHERE art_id IS NOT NULL`).run();
  _schemaReady = true;
}

/* ── Gates ────────────────────────────────────────────────────────
   userGate  : JWT valide → { sub, name, email }.
   memberGate: userGate + appartenance à la publication (dk_members).
   ownerGate : memberGate + propriétaire (administration de la pub).   */
async function userGate(request, env, origin) {
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return { error: err('Authentification requise', 401, origin) };
  await _ensureSchema(env);
  return {
    sub: claims.sub,
    name: _s(claims.owner, 80) || null,
    email: (claims.email || '').toLowerCase().trim() || null,
  };
}
async function memberGate(request, env, origin, pubId) {
  const u = await userGate(request, env, origin);
  if (u.error) return u;
  if (!pubId) return { error: err('Publication requise', 400, origin) };
  const m = await env.DB.prepare('SELECT pub_id FROM dk_members WHERE pub_id = ? AND sub = ?').bind(pubId, u.sub).first();
  if (!m) return { error: err('Accès refusé à cette publication', 403, origin) };
  return u;
}
async function ownerGate(request, env, origin, pubId) {
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u;
  const p = await env.DB.prepare('SELECT owner_sub FROM dk_publications WHERE id = ?').bind(pubId).first();
  if (!p || p.owner_sub !== u.sub) return { error: err('Réservé au propriétaire de la publication', 403, origin) };
  return u;
}
// Résout la publication d'un objet enfant (rubrique / issue / page / article).
async function pubOf(env, table, id) {
  const r = await env.DB.prepare(`SELECT pub_id FROM ${table} WHERE id = ?`).bind(id).first();
  return r ? r.pub_id : null;
}

// ── Helpers ─────────────────────────────────────────────────────
function _s(v, max) { return v == null ? null : String(v).slice(0, max); }
function _date(v) {                                   // 'YYYY-MM-DD' ou null
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function _jalons(v) {                                 // objet {bouclage, maquette, imprimeur, parution} de dates
  const out = {};
  const src = (v && typeof v === 'object') ? v : {};
  for (const k of JALON_KEYS) { const d = _date(src[k]); if (d) out[k] = d; }
  return JSON.stringify(out);
}
function _idArr(v, max) {                             // tableau d'ids assaini (banc)
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch (_) { arr = []; } }
  if (!Array.isArray(arr)) return '[]';
  return JSON.stringify(arr.filter(x => typeof x === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(x)).slice(0, max));
}
function _histoPush(histoJSON, line) {
  let h = [];
  try { h = JSON.parse(histoJSON || '[]'); } catch (_) { h = []; }
  if (!Array.isArray(h)) h = [];
  h.unshift(String(line).slice(0, 300));
  return JSON.stringify(h.slice(0, MAX_HISTO));
}
function _byName(u) { return u.name || (u.email ? u.email.split('@')[0] : 'un membre'); }

const PUB_COLS   = 'id, name, owner_sub, created_at';
const RUB_COLS   = 'id, name, color, position';
const ISSUE_COLS = 'id, pub_id, num, theme, status, jalons, created_at';
const PAGE_COLS  = 'id, issue_id, n, kind, fixe_tag, fixe_title, rub_id, updated_at, updated_by';
const SLOT_COLS  = 'id, page_id, position, art_id, banc';
const ART_COLS   = 'id, title, rub_id, contrib, status, due, fresh, perime, notes, histo, created_at, updated_at';

// ── Health (public) ─────────────────────────────────────────────
export async function handleDeskHealth(request, env) {
  const origin = getAllowedOrigin(env, request);
  let schema = 'ready';
  try { await _ensureSchema(env); } catch (_) { schema = 'error'; }
  return json({ ok: true, engine: DK_ENGINE_VERSION, schema }, 200, origin);
}

// ── Bootstrap : mes publications (+ acceptation des invitations) ─
export async function handleDeskBootstrap(request, env) {
  const origin = getAllowedOrigin(env, request);
  const u = await userGate(request, env, origin);
  if (u.error) return u.error;
  try {
    // Invitations en attente pour mon e-mail → adhésion automatique.
    if (u.email) {
      const invites = (await env.DB.prepare('SELECT pub_id FROM dk_invites WHERE email = ?').bind(u.email).all()).results || [];
      for (const inv of invites) {
        await env.DB.prepare('INSERT OR IGNORE INTO dk_members (pub_id, sub, name, email) VALUES (?, ?, ?, ?)')
          .bind(inv.pub_id, u.sub, u.name, u.email).run();
        await env.DB.prepare('DELETE FROM dk_invites WHERE pub_id = ? AND email = ?').bind(inv.pub_id, u.email).run();
      }
    }
    const pubs = (await env.DB.prepare(
      `SELECT p.${PUB_COLS.split(', ').join(', p.')} FROM dk_publications p
       JOIN dk_members m ON m.pub_id = p.id WHERE m.sub = ? ORDER BY p.created_at`).bind(u.sub).all()).results || [];
    const out = [];
    for (const p of pubs) {
      const issues = (await env.DB.prepare(
        `SELECT ${ISSUE_COLS} FROM dk_issues WHERE pub_id = ? ORDER BY created_at DESC LIMIT 40`).bind(p.id).all()).results || [];
      out.push({ id: p.id, name: p.name, owner: p.owner_sub === u.sub, issues });
    }
    return json({ ok: true, engine: DK_ENGINE_VERSION, me: { sub: u.sub, name: u.name }, publications: out }, 200, origin);
  } catch (e) {
    return err('Lecture impossible : ' + (e && e.message || 'erreur'), 500, origin);
  }
}

// ── Publications ────────────────────────────────────────────────
export async function handlePubCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const u = await userGate(request, env, origin);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const name = String(body.name || '').trim();
  if (!name) return err('Nom de la publication requis', 400, origin);
  if (name.length > MAX_NAME_LEN) return err(`Nom trop long (max ${MAX_NAME_LEN})`, 400, origin);
  const owned = (await env.DB.prepare('SELECT COUNT(*) AS n FROM dk_publications WHERE owner_sub = ?').bind(u.sub).first())?.n || 0;
  if (owned >= MAX_PUBS_OWNED) return err('Limite de publications atteinte', 403, origin);

  const id = generateId();
  await env.DB.prepare('INSERT INTO dk_publications (id, name, owner_sub) VALUES (?, ?, ?)').bind(id, name, u.sub).run();
  await env.DB.prepare('INSERT INTO dk_members (pub_id, sub, name, email) VALUES (?, ?, ?, ?)').bind(id, u.sub, u.name, u.email).run();
  for (let i = 0; i < DEFAULT_RUBRIQUES.length; i++) {
    const r = DEFAULT_RUBRIQUES[i];
    await env.DB.prepare('INSERT INTO dk_rubriques (id, pub_id, name, color, position) VALUES (?, ?, ?, ?, ?)')
      .bind(generateId(), id, r.name, r.color, i).run();
  }
  return json({ ok: true, publication: { id, name, owner: true, issues: [] } }, 200, origin);
}

export async function handlePubPatch(request, env, pubId) {
  const origin = getAllowedOrigin(env, request);
  const u = await ownerGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const name = String(body.name || '').trim();
  if (!name || name.length > MAX_NAME_LEN) return err('Nom invalide', 400, origin);
  await env.DB.prepare('UPDATE dk_publications SET name = ? WHERE id = ?').bind(name, pubId).run();
  return json({ ok: true }, 200, origin);
}

// ── Équipe ──────────────────────────────────────────────────────
export async function handleTeamList(request, env, pubId) {
  const origin = getAllowedOrigin(env, request);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const pub = await env.DB.prepare('SELECT owner_sub FROM dk_publications WHERE id = ?').bind(pubId).first();
  const members = (await env.DB.prepare('SELECT sub, name, email, joined_at FROM dk_members WHERE pub_id = ? ORDER BY joined_at').bind(pubId).all()).results || [];
  const invites = (await env.DB.prepare('SELECT email, created_at FROM dk_invites WHERE pub_id = ? ORDER BY created_at').bind(pubId).all()).results || [];
  return json({
    ok: true,
    members: members.map(m => ({ sub: m.sub, name: m.name, email: m.email, owner: m.sub === (pub && pub.owner_sub), me: m.sub === u.sub })),
    invites,
  }, 200, origin);
}

export async function handleTeamInvite(request, env, pubId) {
  const origin = getAllowedOrigin(env, request);
  const u = await ownerGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const email = String(body.email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return err('E-mail invalide', 400, origin);
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM dk_members WHERE pub_id = ?').bind(pubId).first())?.n || 0;
  if (n >= MAX_MEMBERS) return err('Limite de membres atteinte', 403, origin);
  await env.DB.prepare('INSERT OR IGNORE INTO dk_invites (pub_id, email, invited_by) VALUES (?, ?, ?)').bind(pubId, email, u.sub).run();
  return json({ ok: true, email }, 200, origin);
}

export async function handleTeamRemove(request, env, pubId, sub) {
  const origin = getAllowedOrigin(env, request);
  const u = await ownerGate(request, env, origin, pubId);
  if (u.error) return u.error;
  if (sub === u.sub) return err('Le propriétaire ne peut pas se retirer lui-même', 400, origin);
  await env.DB.prepare('DELETE FROM dk_members WHERE pub_id = ? AND sub = ?').bind(pubId, sub).run();
  // Retirer aussi une éventuelle invitation du même e-mail passé en second champ
  const email = String((await parseBody(request)).email || '').toLowerCase().trim();
  if (email) await env.DB.prepare('DELETE FROM dk_invites WHERE pub_id = ? AND email = ?').bind(pubId, email).run();
  return json({ ok: true }, 200, origin);
}

// ── Rubriques ───────────────────────────────────────────────────
export async function handleRubCreate(request, env, pubId) {
  const origin = getAllowedOrigin(env, request);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const name = String(body.name || '').trim();
  if (!name || name.length > MAX_NAME_LEN) return err('Nom invalide', 400, origin);
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM dk_rubriques WHERE pub_id = ?').bind(pubId).first())?.n || 0;
  if (n >= MAX_RUBRIQUES) return err('Limite de rubriques atteinte', 403, origin);
  const id = generateId();
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#8d93a8';
  await env.DB.prepare('INSERT INTO dk_rubriques (id, pub_id, name, color, position) VALUES (?, ?, ?, ?, ?)')
    .bind(id, pubId, name, color, Number.isFinite(body.position) ? Number(body.position) : n).run();
  return json({ ok: true, rubrique: { id, name, color, position: n } }, 200, origin);
}

export async function handleRubPatch(request, env, rubId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_rubriques', rubId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const sets = [], vals = [];
  if (body.name !== undefined) { const nm = String(body.name || '').trim(); if (!nm || nm.length > MAX_NAME_LEN) return err('Nom invalide', 400, origin); sets.push('name = ?'); vals.push(nm); }
  if (body.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.color)) { sets.push('color = ?'); vals.push(body.color); }
  if (body.position !== undefined && Number.isFinite(Number(body.position))) { sets.push('position = ?'); vals.push(Number(body.position)); }
  if (!sets.length) return err('Rien à modifier', 400, origin);
  vals.push(rubId);
  await env.DB.prepare(`UPDATE dk_rubriques SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return json({ ok: true }, 200, origin);
}

export async function handleRubDelete(request, env, rubId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_rubriques', rubId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  await env.DB.prepare('UPDATE dk_articles SET rub_id = NULL WHERE pub_id = ? AND rub_id = ?').bind(pubId, rubId).run();
  await env.DB.prepare('DELETE FROM dk_rubriques WHERE id = ?').bind(rubId).run();
  return json({ ok: true }, 200, origin);
}

// ── Numéros ─────────────────────────────────────────────────────
export async function handleIssueCreate(request, env, pubId) {
  const origin = getAllowedOrigin(env, request);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const num = String(body.num || '').trim();
  if (!num || num.length > 40) return err('Numéro requis (ex. « 143 »)', 400, origin);
  const pages = Math.min(MAX_PAGES, Math.max(4, parseInt(body.pages, 10) || 60));
  const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM dk_issues WHERE pub_id = ?').bind(pubId).first())?.n || 0;
  if (count >= MAX_ISSUES) return err('Limite de numéros atteinte', 403, origin);

  const id = generateId();
  await env.DB.prepare('INSERT INTO dk_issues (id, pub_id, num, theme, status, jalons) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, pubId, num, _s(body.theme, MAX_TITLE_LEN), 'preparation', _jalons(body.jalons)).run();

  // Génération des cartes-pages : 1 = couverture, N = 4ᵉ de couv (figées,
  // modifiables ensuite via PATCH page) ; le reste = emplacements vides.
  const by = _byName(u);
  const rows = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1) rows.push([generateId(), id, pubId, n, 'fixe', 'Couverture', null]);
    else if (n === pages) rows.push([generateId(), id, pubId, n, 'fixe', '4ᵉ de couverture', null]);
    else rows.push([generateId(), id, pubId, n, 'vide', null, null]);
  }
  // Insertion par lots (D1 : éviter 400 requêtes une à une)
  const CHUNK = 20;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map(r =>
      env.DB.prepare('INSERT INTO dk_pages (id, issue_id, pub_id, n, kind, fixe_tag, art_id, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(r[0], r[1], r[2], r[3], r[4], r[5], r[6], by));
    await env.DB.batch(batch);
  }
  const issue = await env.DB.prepare(`SELECT ${ISSUE_COLS} FROM dk_issues WHERE id = ?`).bind(id).first();
  return json({ ok: true, issue }, 200, origin);
}

export async function handleIssueGet(request, env, issueId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_issues', issueId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  try {
    const issue = await env.DB.prepare(`SELECT ${ISSUE_COLS} FROM dk_issues WHERE id = ?`).bind(issueId).first();
    const pages = (await env.DB.prepare(`SELECT ${PAGE_COLS} FROM dk_pages WHERE issue_id = ? ORDER BY n`).bind(issueId).all()).results || [];
    // Emplacements ordonnés des pages du numéro (multi-articles, DK-2 §2.4).
    const slots = (await env.DB.prepare(
      `SELECT s.${SLOT_COLS.split(', ').join(', s.')} FROM dk_page_slots s
       JOIN dk_pages p ON p.id = s.page_id WHERE p.issue_id = ? ORDER BY p.n, s.position`).bind(issueId).all()).results || [];
    // Tous les articles de la publication voyagent avec le numéro : c'est le
    // marbre (réservoir transversal) — la vue marbre du front filtre dedans.
    const articles = (await env.DB.prepare(`SELECT ${ART_COLS} FROM dk_articles WHERE pub_id = ? ORDER BY updated_at DESC LIMIT ${MAX_ARTICLES}`).bind(pubId).all()).results || [];
    const rubriques = (await env.DB.prepare(`SELECT ${RUB_COLS} FROM dk_rubriques WHERE pub_id = ? ORDER BY position`).bind(pubId).all()).results || [];
    return json({ ok: true, issue, pages, slots, articles, rubriques, now: new Date().toISOString() }, 200, origin);
  } catch (e) {
    return err('Lecture impossible : ' + (e && e.message || 'erreur'), 500, origin);
  }
}

export async function handleIssuePatch(request, env, issueId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_issues', issueId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const cur = await env.DB.prepare(`SELECT ${ISSUE_COLS} FROM dk_issues WHERE id = ?`).bind(issueId).first();
  if (!cur) return err('Numéro introuvable', 404, origin);
  const sets = [], vals = [];
  if (body.theme !== undefined) { sets.push('theme = ?'); vals.push(_s(String(body.theme).trim(), MAX_TITLE_LEN)); }
  if (body.status !== undefined) { if (!ISSUE_STATUS.includes(body.status)) return err('Statut inconnu', 400, origin); sets.push('status = ?'); vals.push(body.status); }
  if (body.jalons !== undefined) { sets.push('jalons = ?'); vals.push(_jalons(body.jalons)); }
  if (!sets.length) return err('Rien à modifier', 400, origin);
  vals.push(issueId);
  await env.DB.prepare(`UPDATE dk_issues SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  // Rituel de bouclage (§4) : au PASSAGE en « imprime » seulement.
  let boucle = null;
  if (body.status === 'imprime' && cur.status !== 'imprime') {
    boucle = await _bouclerIssue(env, cur, _byName(u));
  }
  return json({ ok: true, boucle }, 200, origin);
}

/* Rituel de bouclage (§4) — tri automatique au passage en « imprime » :
   les titulaires en page sont marqués publiés (avec la page), les articles
   restés au banc sont reversés au marbre avec la mention du report, et les
   bancs du numéro sont vidés. Sobre, explicable, historisé.               */
async function _bouclerIssue(env, issue, by) {
  const slots = (await env.DB.prepare(
    `SELECT s.art_id, s.banc, p.n FROM dk_page_slots s
     JOIN dk_pages p ON p.id = s.page_id WHERE p.issue_id = ? ORDER BY p.n, s.position`).bind(issue.id).all()).results || [];
  const titulaires = new Map();           // art_id → première page où il est titulaire
  const bancIds = new Set();
  for (const s of slots) {
    if (s.art_id && !titulaires.has(s.art_id)) titulaires.set(s.art_id, s.n);
    let b = []; try { b = JSON.parse(s.banc || '[]'); } catch (_) {}
    if (Array.isArray(b)) b.forEach(id => bancIds.add(id));
  }
  for (const id of titulaires.keys()) bancIds.delete(id);
  let published = 0, reversed = 0;
  for (const [artId, n] of titulaires) {
    const a = await env.DB.prepare('SELECT id, status, histo FROM dk_articles WHERE id = ?').bind(artId).first();
    if (!a || a.status === 'publie' || a.status === 'abandonne') continue;
    await env.DB.prepare(`UPDATE dk_articles SET status = 'publie', histo = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(_histoPush(a.histo, `Publié au n° ${issue.num} (p. ${n}) — bouclage par ${by}`), artId).run();
    published++;
  }
  for (const artId of bancIds) {
    const a = await env.DB.prepare('SELECT id, status, histo FROM dk_articles WHERE id = ?').bind(artId).first();
    if (!a || a.status === 'publie' || a.status === 'abandonne') continue;
    await env.DB.prepare(`UPDATE dk_articles SET histo = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(_histoPush(a.histo, `Reversé au marbre après le n° ${issue.num} (préparé au banc, non utilisé)`), artId).run();
    reversed++;
  }
  await env.DB.prepare(
    `UPDATE dk_page_slots SET banc = '[]'
     WHERE page_id IN (SELECT id FROM dk_pages WHERE issue_id = ?)`).bind(issue.id).run();
  return { published, reversed };
}

// Échange du CONTENU de deux pages (drop SUR une carte) — transactionnel.
export async function handleIssueSwap(request, env, issueId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_issues', issueId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const na = parseInt(body.a, 10), nb = parseInt(body.b, 10);
  if (!na || !nb || na === nb) return err('Pages invalides', 400, origin);
  const pa = await env.DB.prepare(`SELECT ${PAGE_COLS} FROM dk_pages WHERE issue_id = ? AND n = ?`).bind(issueId, na).first();
  const pb = await env.DB.prepare(`SELECT ${PAGE_COLS} FROM dk_pages WHERE issue_id = ? AND n = ?`).bind(issueId, nb).first();
  if (!pa || !pb) return err('Page introuvable', 404, origin);
  const by = _byName(u);
  // Contenu + emplacements suivent (page_id des slots échangés via pivot).
  await env.DB.batch([
    env.DB.prepare(`UPDATE dk_pages SET kind = ?, fixe_tag = ?, fixe_title = ?, rub_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .bind(pb.kind, pb.fixe_tag, pb.fixe_title, pb.rub_id, by, pa.id),
    env.DB.prepare(`UPDATE dk_pages SET kind = ?, fixe_tag = ?, fixe_title = ?, rub_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .bind(pa.kind, pa.fixe_tag, pa.fixe_title, pa.rub_id, by, pb.id),
    env.DB.prepare(`UPDATE dk_page_slots SET page_id = 'dk_pivot' WHERE page_id = ?`).bind(pa.id),
    env.DB.prepare(`UPDATE dk_page_slots SET page_id = ? WHERE page_id = ?`).bind(pa.id, pb.id),
    env.DB.prepare(`UPDATE dk_page_slots SET page_id = ? WHERE page_id = 'dk_pivot'`).bind(pb.id),
  ]);
  return json({ ok: true }, 200, origin);
}

/* Déplacement par INSERTION (§3.5 révisé) — le geste fréquent du métier :
   1..N pages glissent vers une position et TOUT LE CONTENU COULE, sauf les
   pages figées qui restent ANCRÉES à leur numéro (une pub vendue « page 30 »
   ne bouge pas) — le flux coule autour d'elles. `embark:true` = embarquer
   explicitement les figées de la sélection. `to` = insérer AVANT la page n
   (n = dernière + 1 pour la fin). Transactionnel, une seule trace.        */
export async function handleIssueMove(request, env, issueId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_issues', issueId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const to = parseInt(body.to, 10);
  const embark = !!body.embark;
  let from = Array.isArray(body.from) ? body.from.map(x => parseInt(x, 10)).filter(Number.isFinite) : [];
  if (!from.length || !Number.isFinite(to)) return err('Déplacement invalide', 400, origin);
  const pages = (await env.DB.prepare(`SELECT ${PAGE_COLS} FROM dk_pages WHERE issue_id = ? ORDER BY n`).bind(issueId).all()).results || [];
  const byN = new Map(pages.map(p => [p.n, p]));
  from = [...new Set(from)].sort((a, b) => a - b).filter(n => byN.has(n));
  if (!embark) from = from.filter(n => byN.get(n).kind !== 'fixe');
  if (!from.length) return err('Rien à déplacer — les pages figées restent ancrées à leur numéro', 400, origin);
  const fromSet = new Set(from);

  // Le contenu d'une page (tout sauf son numéro) coule ; les figées hors
  // sélection gardent leur numéro ; le bloc déplacé s'insère dans le flux.
  const contentOf = p => ({ kind: p.kind, fixe_tag: p.fixe_tag, fixe_title: p.fixe_title, rub_id: p.rub_id, srcId: p.id });
  const anchored = new Map(), moved = [], flow = [];
  for (const p of pages) {
    if (fromSet.has(p.n)) moved.push(contentOf(p));
    else if (p.kind === 'fixe') anchored.set(p.n, contentOf(p));
    else flow.push({ n: p.n, c: contentOf(p) });
  }
  let idx = 0;
  for (const f of flow) { if (f.n < to) idx++; }
  const newFlow = flow.map(f => f.c);
  newFlow.splice(idx, 0, ...moved);

  const by = _byName(u);
  const stmts = [];
  const remap = new Map();                 // page_id d'origine → page_id de destination
  let fi = 0;
  for (const p of pages) {
    const c = anchored.get(p.n) || newFlow[fi++];
    if (c.srcId === p.id) continue;
    remap.set(c.srcId, p.id);
    stmts.push(env.DB.prepare(
      `UPDATE dk_pages SET kind = ?, fixe_tag = ?, fixe_title = ?, rub_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .bind(c.kind, c.fixe_tag, c.fixe_title, c.rub_id, by, p.id));
  }
  if (!stmts.length) return json({ ok: true, moved: 0 }, 200, origin);
  // Les emplacements suivent leur contenu (mise à jour par id de slot : pas
  // de collision possible, tout part de l'état AVANT déplacement).
  const slotRows = (await env.DB.prepare(
    `SELECT s.id, s.page_id FROM dk_page_slots s JOIN dk_pages p ON p.id = s.page_id WHERE p.issue_id = ?`).bind(issueId).all()).results || [];
  for (const s of slotRows) {
    const dst = remap.get(s.page_id);
    if (dst) stmts.push(env.DB.prepare('UPDATE dk_page_slots SET page_id = ? WHERE id = ?').bind(dst, s.id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, moved: from.length }, 200, origin);
}

/* Opération PAR LOT sur une sélection de pages (§3.5) — un dossier de 10+
   pages ne se monte pas page par page. Un seul appel, une seule trace.
   op ∈ rubrique {rub_id} · contrib {contrib} · fixe {fixe_tag} · libere ·
   spread {art_id} (réserver le même article étalé — pages « suite »).     */
export async function handleIssueBatch(request, env, issueId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_issues', issueId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const op = String(body.op || '');
  let ns = Array.isArray(body.ns) ? body.ns.map(x => parseInt(x, 10)).filter(Number.isFinite) : [];
  ns = [...new Set(ns)].sort((a, b) => a - b).slice(0, MAX_BATCH_NS);
  if (!ns.length) return err('Aucune page sélectionnée', 400, origin);
  const all = (await env.DB.prepare(`SELECT ${PAGE_COLS} FROM dk_pages WHERE issue_id = ? ORDER BY n`).bind(issueId).all()).results || [];
  const byN = new Map(all.map(p => [p.n, p]));
  const pages = ns.map(n => byN.get(n)).filter(Boolean);
  if (!pages.length) return err('Pages introuvables', 400, origin);
  const ids = pages.map(p => p.id);
  const ph = ids.map(() => '?').join(', ');
  const slotRows = (await env.DB.prepare(
    `SELECT ${SLOT_COLS} FROM dk_page_slots WHERE page_id IN (${ph}) ORDER BY page_id, position`).bind(...ids).all()).results || [];
  const slotsByPage = new Map();
  for (const s of slotRows) { if (!slotsByPage.has(s.page_id)) slotsByPage.set(s.page_id, []); slotsByPage.get(s.page_id).push(s); }

  const by = _byName(u);
  const stmts = [];
  const touch = p => stmts.push(env.DB.prepare(
    `UPDATE dk_pages SET updated_at = datetime('now'), updated_by = ? WHERE id = ?`).bind(by, p.id));
  let done = 0, skipped = 0;

  if (op === 'rubrique') {
    let rubId = null;
    if (body.rub_id) {
      const r = await env.DB.prepare('SELECT id FROM dk_rubriques WHERE id = ? AND pub_id = ?').bind(body.rub_id, pubId).first();
      if (!r) return err('Rubrique inconnue', 400, origin);
      rubId = r.id;
    }
    // Rubrique de page (pré-assignation) + rubrique du titulaire s'il existe.
    const artIds = new Set();
    for (const p of pages) {
      stmts.push(env.DB.prepare(`UPDATE dk_pages SET rub_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).bind(rubId, by, p.id));
      const s0 = (slotsByPage.get(p.id) || [])[0];
      if (s0 && s0.art_id) artIds.add(s0.art_id);
      done++;
    }
    for (const id of artIds) stmts.push(env.DB.prepare(`UPDATE dk_articles SET rub_id = ?, updated_at = datetime('now') WHERE id = ? AND pub_id = ?`).bind(rubId, id, pubId));
  } else if (op === 'contrib') {
    const contrib = _s(String(body.contrib || '').trim(), MAX_NAME_LEN);
    const artIds = new Set();
    for (const p of pages) {
      const s0 = (slotsByPage.get(p.id) || [])[0];
      if (s0 && s0.art_id) { artIds.add(s0.art_id); touch(p); done++; } else skipped++;
    }
    if (!artIds.size) return err('Aucun article titulaire sur ces pages', 400, origin);
    for (const id of artIds) stmts.push(env.DB.prepare(`UPDATE dk_articles SET contrib = ?, updated_at = datetime('now') WHERE id = ? AND pub_id = ?`).bind(contrib, id, pubId));
  } else if (op === 'fixe') {
    const tag = _s(String(body.fixe_tag || 'Figée').trim(), 80) || 'Figée';
    for (const p of pages) {
      if ((slotsByPage.get(p.id) || []).length) { skipped++; continue; }   // une page qui porte des articles ne se fige pas par lot
      stmts.push(env.DB.prepare(`UPDATE dk_pages SET kind = 'fixe', fixe_tag = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).bind(tag, by, p.id));
      done++;
    }
  } else if (op === 'libere') {
    for (const p of pages) {
      if (p.kind !== 'fixe') { skipped++; continue; }
      stmts.push(env.DB.prepare(`UPDATE dk_pages SET kind = 'vide', fixe_tag = NULL, fixe_title = NULL, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).bind(by, p.id));
      done++;
    }
  } else if (op === 'spread') {
    const a = await env.DB.prepare('SELECT id FROM dk_articles WHERE id = ? AND pub_id = ?').bind(body.art_id || '', pubId).first();
    if (!a) return err('Article inconnu dans cette publication', 400, origin);
    for (const p of pages) {
      const sl = slotsByPage.get(p.id) || [];
      if (p.kind === 'fixe') { skipped++; continue; }
      if (sl.some(s => s.art_id === a.id)) { skipped++; continue; }
      if (sl.length >= MAX_SLOTS) { skipped++; continue; }
      stmts.push(env.DB.prepare(
        `INSERT INTO dk_page_slots (id, page_id, pub_id, position, art_id) VALUES (?, ?, ?, ?, ?)`)
        .bind(generateId(), p.id, pubId, sl.length, a.id));
      stmts.push(env.DB.prepare(`UPDATE dk_pages SET kind = 'article', updated_at = datetime('now'), updated_by = ? WHERE id = ?`).bind(by, p.id));
      done++;
    }
  } else {
    return err('Opération inconnue', 400, origin);
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, done, skipped }, 200, origin);
}

// ── Cartes-pages (figer / libérer / rubrique de page) ──────────
// Depuis DK-2, la réservation d'articles passe par les EMPLACEMENTS
// (/page/:id/slot, /slot/:id) — plus d'art_id/banc au niveau page.
export async function handlePagePatch(request, env, pageId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_pages', pageId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const sets = [], vals = [];
  if (body.kind !== undefined) {
    if (!PAGE_KINDS.includes(body.kind)) return err('Type de page inconnu', 400, origin);
    if (body.kind !== 'article') {
      const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM dk_page_slots WHERE page_id = ?').bind(pageId).first())?.n || 0;
      if (n) return err('Cette page porte encore des articles — retirez-les d’abord', 400, origin);
    }
    sets.push('kind = ?'); vals.push(body.kind);
  }
  if (body.fixe_tag !== undefined) { sets.push('fixe_tag = ?'); vals.push(_s(String(body.fixe_tag).trim(), 80)); }
  if (body.fixe_title !== undefined) { sets.push('fixe_title = ?'); vals.push(_s(String(body.fixe_title).trim(), MAX_TITLE_LEN)); }
  if (body.rub_id !== undefined) {
    let rubId = null;
    if (body.rub_id) {
      const r = await env.DB.prepare('SELECT id FROM dk_rubriques WHERE id = ? AND pub_id = ?').bind(body.rub_id, pubId).first();
      if (!r) return err('Rubrique inconnue', 400, origin);
      rubId = r.id;
    }
    sets.push('rub_id = ?'); vals.push(rubId);
  }
  if (!sets.length) return err('Rien à modifier', 400, origin);
  sets.push("updated_at = datetime('now')", 'updated_by = ?');
  vals.push(_byName(u), pageId);
  await env.DB.prepare(`UPDATE dk_pages SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return json({ ok: true }, 200, origin);
}

/* ── Emplacements (multi-articles par page, §2.4) ────────────────
   Chaque emplacement = un titulaire + son banc de remplaçants ordonné.
   La carte affiche l'article principal (position 0) + badge « n articles » ;
   la marge de la carte = min des marges de ses articles (côté front).     */
async function _slotGate(request, env, origin, slotId) {
  const s = await env.DB.prepare(`SELECT ${SLOT_COLS}, pub_id FROM dk_page_slots WHERE id = ?`).bind(slotId).first();
  if (!s) return { error: err('Emplacement introuvable', 404, origin) };
  const u = await memberGate(request, env, origin, s.pub_id);
  if (u.error) return u;
  return { u, slot: s };
}
function _touchPage(env, pageId, by) {
  return env.DB.prepare(`UPDATE dk_pages SET updated_at = datetime('now'), updated_by = ? WHERE id = ?`).bind(by, pageId);
}

export async function handleSlotCreate(request, env, pageId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_pages', pageId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const page = await env.DB.prepare(`SELECT ${PAGE_COLS} FROM dk_pages WHERE id = ?`).bind(pageId).first();
  if (!page) return err('Page introuvable', 404, origin);
  if (page.kind === 'fixe') return err('Page figée — libérez-la avant d’y réserver un article', 400, origin);
  const owns = await env.DB.prepare('SELECT id FROM dk_articles WHERE id = ? AND pub_id = ?').bind(body.art_id || '', pubId).first();
  if (!owns) return err('Article inconnu dans cette publication', 400, origin);
  const existing = (await env.DB.prepare(`SELECT ${SLOT_COLS} FROM dk_page_slots WHERE page_id = ? ORDER BY position`).bind(pageId).all()).results || [];
  if (existing.some(s => s.art_id === owns.id)) return err('Cet article est déjà sur cette page', 400, origin);
  if (existing.length >= MAX_SLOTS) return err('Limite d’articles atteinte sur cette page', 403, origin);
  const id = generateId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO dk_page_slots (id, page_id, pub_id, position, art_id) VALUES (?, ?, ?, ?, ?)')
      .bind(id, pageId, pubId, existing.length, owns.id),
    env.DB.prepare(`UPDATE dk_pages SET kind = 'article', updated_at = datetime('now'), updated_by = ? WHERE id = ?`).bind(_byName(u), pageId),
  ]);
  return json({ ok: true, slot: { id, page_id: pageId, position: existing.length, art_id: owns.id, banc: '[]' } }, 200, origin);
}

export async function handleSlotPatch(request, env, slotId) {
  const origin = getAllowedOrigin(env, request);
  const g = await _slotGate(request, env, origin, slotId);
  if (g.error) return g.error;
  const { u, slot } = g;
  const body = await parseBody(request);
  const sets = [], vals = [];
  if (body.art_id !== undefined) {
    const owns = await env.DB.prepare('SELECT id FROM dk_articles WHERE id = ? AND pub_id = ?').bind(body.art_id || '', slot.pub_id).first();
    if (!owns) return err('Article inconnu dans cette publication', 400, origin);
    const dup = await env.DB.prepare('SELECT id FROM dk_page_slots WHERE page_id = ? AND art_id = ? AND id != ?').bind(slot.page_id, owns.id, slotId).first();
    if (dup) return err('Cet article est déjà sur cette page', 400, origin);
    sets.push('art_id = ?'); vals.push(owns.id);
  }
  if (body.banc !== undefined) { sets.push('banc = ?'); vals.push(_idArr(body.banc, MAX_BANC)); }
  if (body.position !== undefined && Number.isFinite(Number(body.position))) { sets.push('position = ?'); vals.push(Number(body.position)); }
  if (!sets.length) return err('Rien à modifier', 400, origin);
  vals.push(slotId);
  await env.DB.batch([
    env.DB.prepare(`UPDATE dk_page_slots SET ${sets.join(', ')} WHERE id = ?`).bind(...vals),
    _touchPage(env, slot.page_id, _byName(u)),
  ]);
  return json({ ok: true }, 200, origin);
}

export async function handleSlotDelete(request, env, slotId) {
  const origin = getAllowedOrigin(env, request);
  const g = await _slotGate(request, env, origin, slotId);
  if (g.error) return g.error;
  const { u, slot } = g;
  await env.DB.prepare('DELETE FROM dk_page_slots WHERE id = ?').bind(slotId).run();
  // Retasser les positions ; une page sans emplacement redevient vide.
  const rest = (await env.DB.prepare(`SELECT id FROM dk_page_slots WHERE page_id = ? ORDER BY position`).bind(slot.page_id).all()).results || [];
  const stmts = rest.map((s, i) => env.DB.prepare('UPDATE dk_page_slots SET position = ? WHERE id = ?').bind(i, s.id));
  if (!rest.length) stmts.push(env.DB.prepare(`UPDATE dk_pages SET kind = 'vide', updated_at = datetime('now'), updated_by = ? WHERE id = ? AND kind = 'article'`).bind(_byName(u), slot.page_id));
  else stmts.push(_touchPage(env, slot.page_id, _byName(u)));
  await env.DB.batch(stmts);
  return json({ ok: true }, 200, origin);
}

// ── Articles (embryon du marbre — complété en DK-2) ────────────
export async function handleArtCreate(request, env, pubId) {
  const origin = getAllowedOrigin(env, request);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const title = String(body.title || '').trim();
  if (!title || title.length > MAX_TITLE_LEN) return err('Titre requis', 400, origin);
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM dk_articles WHERE pub_id = ?').bind(pubId).first())?.n || 0;
  if (n >= MAX_ARTICLES) return err('Limite d’articles atteinte', 403, origin);
  const status = ART_STATUS.includes(body.status) ? body.status : 'propose';
  let rubId = null;
  if (body.rub_id) {
    const r = await env.DB.prepare('SELECT id FROM dk_rubriques WHERE id = ? AND pub_id = ?').bind(body.rub_id, pubId).first();
    if (r) rubId = r.id;
  }
  const id = generateId();
  await env.DB.prepare(
    `INSERT INTO dk_articles (id, pub_id, title, rub_id, contrib, status, due, fresh, perime, histo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, pubId, title, rubId, _s(String(body.contrib || '').trim(), MAX_NAME_LEN), status,
      _date(body.due), body.fresh === 'date' ? 'date' : 'intemporel', _date(body.perime),
      JSON.stringify(['Créé par ' + _byName(u)])).run();
  const article = await env.DB.prepare(`SELECT ${ART_COLS} FROM dk_articles WHERE id = ?`).bind(id).first();
  return json({ ok: true, article }, 200, origin);
}

export async function handleArtPatch(request, env, artId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_articles', artId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const cur = await env.DB.prepare(`SELECT ${ART_COLS} FROM dk_articles WHERE id = ?`).bind(artId).first();
  if (!cur) return err('Article introuvable', 404, origin);
  const sets = [], vals = [];
  let histo = cur.histo;
  const by = _byName(u);
  if (body.title !== undefined) { const t = String(body.title).trim(); if (!t || t.length > MAX_TITLE_LEN) return err('Titre invalide', 400, origin); sets.push('title = ?'); vals.push(t); }
  if (body.contrib !== undefined) { sets.push('contrib = ?'); vals.push(_s(String(body.contrib).trim(), MAX_NAME_LEN)); }
  if (body.rub_id !== undefined) {
    let rubId = null;
    if (body.rub_id) { const r = await env.DB.prepare('SELECT id FROM dk_rubriques WHERE id = ? AND pub_id = ?').bind(body.rub_id, pubId).first(); if (!r) return err('Rubrique inconnue', 400, origin); rubId = r.id; }
    sets.push('rub_id = ?'); vals.push(rubId);
  }
  if (body.status !== undefined) {
    if (!ART_STATUS.includes(body.status)) return err('Statut inconnu', 400, origin);
    sets.push('status = ?'); vals.push(body.status);
    if (body.status === 'remis' && cur.status !== 'remis') histo = _histoPush(histo, 'Copie pointée reçue par ' + by);
    else if (body.status !== cur.status) histo = _histoPush(histo, 'Statut « ' + body.status + ' » par ' + by);
  }
  if (body.due !== undefined) {
    const d = _date(body.due);
    sets.push('due = ?'); vals.push(d);
    if (d && d !== cur.due) histo = _histoPush(histo, 'Remise recalée au ' + d + ' par ' + by);
  }
  if (body.fresh !== undefined) { sets.push('fresh = ?'); vals.push(body.fresh === 'date' ? 'date' : 'intemporel'); }
  if (body.perime !== undefined) { sets.push('perime = ?'); vals.push(_date(body.perime)); }
  if (body.notes !== undefined) { sets.push('notes = ?'); vals.push(String(body.notes).slice(0, MAX_NOTES_LEN)); }
  if (body.histo_add) histo = _histoPush(histo, String(body.histo_add).slice(0, 300));
  if (!sets.length && histo === cur.histo) return err('Rien à modifier', 400, origin);
  sets.push('histo = ?', "updated_at = datetime('now')");
  vals.push(histo, artId);
  await env.DB.prepare(`UPDATE dk_articles SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const article = await env.DB.prepare(`SELECT ${ART_COLS} FROM dk_articles WHERE id = ?`).bind(artId).first();
  return json({ ok: true, article }, 200, origin);
}

export async function handleArtDelete(request, env, artId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_articles', artId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const by = _byName(u);
  // Le retirer proprement des emplacements (titulaire) et des bancs.
  const slots = (await env.DB.prepare(`SELECT ${SLOT_COLS} FROM dk_page_slots WHERE pub_id = ?`).bind(pubId).all()).results || [];
  const touched = new Set();
  for (const s of slots) {
    let banc = []; try { banc = JSON.parse(s.banc || '[]'); } catch (_) {}
    if (!Array.isArray(banc)) banc = [];
    if (s.art_id === artId) {
      await env.DB.prepare('DELETE FROM dk_page_slots WHERE id = ?').bind(s.id).run();
      touched.add(s.page_id);
    } else if (banc.includes(artId)) {
      await env.DB.prepare('UPDATE dk_page_slots SET banc = ? WHERE id = ?')
        .bind(JSON.stringify(banc.filter(x => x !== artId)), s.id).run();
      touched.add(s.page_id);
    }
  }
  for (const pageId of touched) {
    const rest = (await env.DB.prepare('SELECT id FROM dk_page_slots WHERE page_id = ? ORDER BY position').bind(pageId).all()).results || [];
    for (let i = 0; i < rest.length; i++) await env.DB.prepare('UPDATE dk_page_slots SET position = ? WHERE id = ?').bind(i, rest[i].id).run();
    if (!rest.length) await env.DB.prepare(`UPDATE dk_pages SET kind = 'vide', updated_at = datetime('now'), updated_by = ? WHERE id = ? AND kind = 'article'`).bind(by, pageId).run();
    else await _touchPage(env, pageId, by).run();
  }
  await env.DB.prepare('DELETE FROM dk_articles WHERE id = ?').bind(artId).run();
  return json({ ok: true }, 200, origin);
}
