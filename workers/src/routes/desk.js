/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes desK (Pad O-DSK-001) · DK-3 (casier & relances)

   Chemin de fer vivant d'une revue (DESK_BRIEF.md). DK-1 = publications,
   membres/invitations, rubriques, numéros + jalons, cartes-pages,
   articles, échange de pages, pointage, bascule. DK-2 = marbre complet
   (rituel de bouclage, fraîcheur/péremption, historique inter-numéros)
   + MULTI-ARTICLES PAR PAGE (dk_page_slots, §2.4) + DÉPLACEMENT PAR
   INSERTION avec pages figées ancrées (§3.5) + OPÉRATIONS PAR LOT
   (sélection multiple, §3.5). DK-3 = CASIER R2 (§6 — transmission
   éphémère présignée navigateur→R2, quota doux, purge post-impression)
   + RELANCES Resend « brouillon proposé » (§5.4 — la rédactrice valide,
   annulation émergente au pointage) + retard moyen par contributeur
   (INTERNE, jamais un score). Le cœur reste ZÉRO IA.

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
   POST   /api/desk/page/:id/casier           Demander un dépôt (présigné R2 ou direct)
   POST   /api/desk/casier/:id/put            Dépôt direct streamé (repli sans clés S3)
   POST   /api/desk/casier/:id/complete       Valider un dépôt présigné (taille réelle)
   GET    /api/desk/casier/:id/url            Lien de téléchargement (présigné ou jeton)
   GET    /api/desk/casier/:id/dl?e&t         Téléchargement streamé (jeton HMAC court)
   DELETE /api/desk/casier/:id                Supprimer une pièce
   POST   /api/desk/publication/:id/contrib   Mémoriser l'e-mail d'un contributeur
   POST   /api/desk/article/:id/relance       Envoyer une relance (Resend) + historiser
   (DK-4, routes/desk-email.js) :
   email()                                     Handler e-mail CF (catch-all redaction-*@) → digestion 3 étages
   POST   /api/desk/email-inject               Injecter un e-mail à la main (admin — tests & secours)
   POST   /api/desk/inbox/:id/apply            Confirmer une entrée du bac (rattacher / créer au marbre)
   POST   /api/desk/inbox/:id/reject           Rejeter une entrée du bac (pièces purgées)

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
import { presignR2, r2PresignReady } from '../lib/r2-presign.js';

const DK_ENGINE_VERSION = 'DK-4';

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

// ── Casier (§6 — transmission éphémère, PAS un DAM) ─────────────
const FILE_MAX_BYTES   = 150 * 1024 * 1024;    // une photo HD de 40 Mo passe large
const QUOTA_ISSUE      = 2 * 1024 * 1024 * 1024; // quota doux PAR NUMÉRO (compteur visible)
const MAX_FILES_ISSUE  = 400;
const CASIER_GRACE_DAYS = 30;   // délai de grâce après « imprimé » avant purge (surclassable env)
const FILE_URL_TTL     = 600;   // liens upload/download : 10 min
// Types whitelistés (§13) : PDF, photos HD, textes — le casier transmet, il ne stocke pas.
const FILE_EXTS = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', csv: 'text/csv',
  zip: 'application/zip',
};

// ── Relances (§5.4 — restent dans le monde e-mail) ──────────────
const RELANCE_DAILY_LIMIT = 30;               // par publication et par jour
const MAX_MAIL_SUBJECT = 200;
const MAX_MAIL_BODY    = 6000;

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
    // DK-3 : casier — pièces éphémères en R2, métadonnées ici (§6). Une pièce
    // vit sur une carte-page ; art_id (optionnel) sert la rétention prolongée
    // d'un article reversé au marbre. status : pending (annoncée) | ok (reçue).
    `CREATE TABLE IF NOT EXISTS dk_files (
       id TEXT PRIMARY KEY, pub_id TEXT NOT NULL, issue_id TEXT NOT NULL,
       page_id TEXT NOT NULL, art_id TEXT,
       name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL DEFAULT 0,
       r2_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
       uploaded_by TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE INDEX IF NOT EXISTS idx_dk_files_issue ON dk_files(issue_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dk_files_page ON dk_files(page_id)`,
    // DK-3 : contributeurs (satellite §2) — e-mails connus + retard moyen
    // constaté, INTERNE (cale le calendrier de relance, jamais exposé en score).
    `CREATE TABLE IF NOT EXISTS dk_contribs (
       id TEXT PRIMARY KEY, pub_id TEXT NOT NULL, name TEXT NOT NULL,
       email TEXT, n_remises INTEGER NOT NULL DEFAULT 0,
       total_delay INTEGER NOT NULL DEFAULT 0,
       UNIQUE (pub_id, name))`,
    // DK-3 : journal des relances ENVOYÉES (la « relance prévue » est calculée,
    // pas stockée — l'annulation au pointage est émergente, §5.4).
    `CREATE TABLE IF NOT EXISTS dk_relances (
       id TEXT PRIMARY KEY, pub_id TEXT NOT NULL, art_id TEXT NOT NULL,
       email TEXT NOT NULL, subject TEXT, sent_by TEXT,
       sent_at TEXT DEFAULT (datetime('now')))`,
    `CREATE INDEX IF NOT EXISTS idx_dk_relances_art ON dk_relances(art_id)`,
    `CREATE TABLE IF NOT EXISTS dk_email_log (
       pub_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (pub_id, day))`,
    // DK-4 : bac « à trier » (§5.3) — chaque e-mail entrant non rattaché
    // automatiquement devient une entrée pending ; les rattachements
    // automatiques y laissent une trace (status 'auto'). Jamais contourné.
    `CREATE TABLE IF NOT EXISTS dk_inbox (
       id TEXT PRIMARY KEY, pub_id TEXT NOT NULL,
       from_email TEXT, from_name TEXT, subject TEXT, body TEXT,
       suggestion TEXT NOT NULL DEFAULT '{}',
       attachments TEXT NOT NULL DEFAULT '[]',
       status TEXT NOT NULL DEFAULT 'pending',
       resolved_by TEXT, resolved_at TEXT,
       received_at TEXT DEFAULT (datetime('now')))`,
    `CREATE INDEX IF NOT EXISTS idx_dk_inbox_pub ON dk_inbox(pub_id, status)`,
    // DK-4 : habitudes apprises SANS ML (§5.3) — « les mails de Dupont vont
    // en rubrique Histoire ». Règle déterministe posée à chaque confirmation.
    `CREATE TABLE IF NOT EXISTS dk_habits (
       pub_id TEXT NOT NULL, from_email TEXT NOT NULL, rub_id TEXT,
       updated_at TEXT DEFAULT (datetime('now')),
       PRIMARY KEY (pub_id, from_email))`,
  ];
  for (const sql of stmts) { await env.DB.prepare(sql).run(); }
  // DK-2 : rubrique pré-assignée au niveau de la page (monter un dossier sur
  // des pages encore vides). ALTER idempotent (échoue en silence si déjà là).
  try { await env.DB.prepare(`ALTER TABLE dk_pages ADD COLUMN rub_id TEXT`).run(); } catch (_) {}
  // DK-3 : horodatage du passage en « imprimé » — point de départ du délai de
  // grâce du casier (purge post-impression, §6).
  try { await env.DB.prepare(`ALTER TABLE dk_issues ADD COLUMN imprime_at TEXT`).run(); } catch (_) {}
  // Migration DK-1 → DK-2 : l'ancien art_id/banc de la page devient l'emplacement 0.
  await env.DB.prepare(
    `INSERT INTO dk_page_slots (id, page_id, pub_id, position, art_id, banc)
     SELECT lower(hex(randomblob(16))), p.id, p.pub_id, 0, p.art_id, COALESCE(p.banc, '[]')
     FROM dk_pages p
     WHERE p.art_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dk_page_slots s WHERE s.page_id = p.id)`).run();
  // Les colonnes héritées ne sont plus la source de vérité — on les vide.
  await env.DB.prepare(`UPDATE dk_pages SET art_id = NULL, banc = '[]' WHERE art_id IS NOT NULL`).run();
  // DK-4 : slug d'adresse de dépôt (§5.2) — redaction-<slug>@<domaine>.
  // L'adresse PORTE le tenant : le slug est unique. Backfill des pubs existantes.
  try { await env.DB.prepare(`ALTER TABLE dk_publications ADD COLUMN slug TEXT`).run(); } catch (_) {}
  await env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dk_pubs_slug ON dk_publications(slug)`).run();
  const noSlug = (await env.DB.prepare('SELECT id, name FROM dk_publications WHERE slug IS NULL').all()).results || [];
  for (const p of noSlug) {
    await env.DB.prepare('UPDATE dk_publications SET slug = ? WHERE id = ?').bind(await _freeSlug(env, p.name), p.id).run();
  }
  // Numérotation d'affichage (option par publication) : l'ordre PHYSIQUE des
  // pages (dk_pages.n) ne bouge JAMAIS ; ces deux réglages ne changent QUE le
  // folio affiché. cover_unnumbered = la 1re page est « Couverture » sans folio ;
  // first_folio = numéro de la page qui suit la couverture (0 pour L'Épaulette).
  try { await env.DB.prepare(`ALTER TABLE dk_publications ADD COLUMN cover_unnumbered INTEGER DEFAULT 0`).run(); } catch (_) {}
  try { await env.DB.prepare(`ALTER TABLE dk_publications ADD COLUMN first_folio INTEGER DEFAULT 1`).run(); } catch (_) {}
  _schemaReady = true;
}

// ── Slug d'adresse (DK-4, §5.2) : minuscules sans accent ────────
function _slugify(name) {
  const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s.length >= 2 ? s : 'revue';
}
async function _freeSlug(env, name) {
  const base = _slugify(name);
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const taken = await env.DB.prepare('SELECT id FROM dk_publications WHERE slug = ?').bind(slug).first();
    if (!taken) return slug;
    slug = `${base.slice(0, 36)}-${i}`;
  }
  return `${base.slice(0, 24)}-${generateId().slice(0, 8)}`;
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

const PUB_COLS   = 'id, name, owner_sub, slug, cover_unnumbered, first_folio, created_at';
const RUB_COLS   = 'id, name, color, position';
const ISSUE_COLS = 'id, pub_id, num, theme, status, jalons, created_at';
const PAGE_COLS  = 'id, issue_id, n, kind, fixe_tag, fixe_title, rub_id, updated_at, updated_by';
const SLOT_COLS  = 'id, page_id, position, art_id, banc';
const ART_COLS   = 'id, title, rub_id, contrib, status, due, fresh, perime, notes, histo, created_at, updated_at';
const FILE_COLS  = 'id, issue_id, page_id, art_id, name, mime, size, status, uploaded_by, created_at';

/* ── Partagé avec routes/desk-email.js (DK-4) ─────────────────────
   La digestion e-mail vit dans son propre module ; elle réutilise le
   schéma, les gates et les invariants du casier d'ICI (source unique). */
export async function ensureDeskSchema(env) { return _ensureSchema(env); }
export { memberGate as dkMemberGate, _histoPush as dkHistoPush, _s as dkS,
         _fileExt as dkFileExt, _fileName as dkFileName, _byName as dkByName };
export const DK_FILE_EXTS = FILE_EXTS;
export const DK_FILE_MAX = FILE_MAX_BYTES;
export const DK_MAX_NAME = MAX_NAME_LEN;
export const DK_MAX_TITLE = MAX_TITLE_LEN;
export const DK_MAX_NOTES = MAX_NOTES_LEN;
// Retard constaté → retard moyen interne du contributeur (jamais un score).
export async function dkContribStats(env, pubId, contrib, due) {
  if (!contrib) return;
  const delay = due ? Math.max(-30, Math.min(90, Math.round((Date.now() - new Date(due + 'T12:00:00').getTime()) / 86400000))) : 0;
  await env.DB.prepare(
    `INSERT INTO dk_contribs (id, pub_id, name, n_remises, total_delay) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (pub_id, name) DO UPDATE SET n_remises = n_remises + 1, total_delay = total_delay + ?`)
    .bind(generateId(), pubId, _s(contrib, MAX_NAME_LEN), due ? delay : 0, due ? delay : 0).run();
}

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
      out.push({ id: p.id, name: p.name, slug: p.slug || null, owner: p.owner_sub === u.sub,
        cover_unnumbered: !!p.cover_unnumbered, first_folio: Number.isFinite(p.first_folio) ? p.first_folio : 1, issues });
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
  const slug = await _freeSlug(env, name);
  await env.DB.prepare('INSERT INTO dk_publications (id, name, owner_sub, slug) VALUES (?, ?, ?, ?)').bind(id, name, u.sub, slug).run();
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
  const sets = [], vals = [];
  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name || name.length > MAX_NAME_LEN) return err('Nom invalide', 400, origin);
    sets.push('name = ?'); vals.push(name);
  }
  // DK-4 : slug de l'adresse de dépôt (redaction-<slug>@…), unique.
  if (body.slug !== undefined) {
    const slug = String(body.slug || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) return err('Adresse invalide — minuscules, chiffres et tirets (2 à 40 caractères)', 400, origin);
    const taken = await env.DB.prepare('SELECT id FROM dk_publications WHERE slug = ? AND id != ?').bind(slug, pubId).first();
    if (taken) return err('Cette adresse est déjà prise par une autre publication', 409, origin);
    sets.push('slug = ?'); vals.push(slug);
  }
  // Numérotation d'affichage (option §L'Épaulette) — ne touche PAS l'ordre physique.
  if (body.cover_unnumbered !== undefined) {
    sets.push('cover_unnumbered = ?'); vals.push(body.cover_unnumbered ? 1 : 0);
  }
  if (body.first_folio !== undefined) {
    const f = parseInt(body.first_folio, 10);
    if (!Number.isFinite(f) || f < -5 || f > 20) return err('Numéro de départ invalide (entre -5 et 20)', 400, origin);
    sets.push('first_folio = ?'); vals.push(f);
  }
  if (!sets.length) return err('Rien à modifier', 400, origin);
  vals.push(pubId);
  await env.DB.prepare(`UPDATE dk_publications SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return json({ ok: true }, 200, origin);
}

/* DELETE /publication/:id — supprimer une revue et TOUT son contenu
   (réservé au propriétaire). Confirmation par le nom exact côté client
   ET revérifiée serveur (garde-fou contre une suppression accidentelle).
   Cascade : pièces R2 du casier + du bac, puis toutes les tables dk_ de
   ce tenant. L'adresse de dépôt (slug) est libérée pour un futur usage. */
export async function handlePubDelete(request, env, pubId) {
  const origin = getAllowedOrigin(env, request);
  const u = await ownerGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const pub = await env.DB.prepare('SELECT id, name FROM dk_publications WHERE id = ?').bind(pubId).first();
  if (!pub) return err('Publication introuvable', 404, origin);
  const body = await parseBody(request);
  // Confirmation forte : le nom saisi doit correspondre exactement.
  if (String(body.confirm || '').trim() !== pub.name) {
    return err('Confirmation requise : saisissez le nom exact de la revue pour supprimer', 400, origin);
  }
  // Purge R2 d'abord (casier + pièces du bac non encore rangées).
  if (env.DK_CASIER) {
    const files = (await env.DB.prepare('SELECT r2_key FROM dk_files WHERE pub_id = ?').bind(pubId).all()).results || [];
    for (const f of files) { if (f.r2_key) await env.DK_CASIER.delete(f.r2_key).catch(() => {}); }
    const inbox = (await env.DB.prepare('SELECT attachments FROM dk_inbox WHERE pub_id = ?').bind(pubId).all()).results || [];
    for (const r of inbox) {
      let atts = []; try { atts = JSON.parse(r.attachments || '[]'); } catch (_) {}
      for (const a of atts) { if (a && a.r2_key) await env.DK_CASIER.delete(a.r2_key).catch(() => {}); }
    }
  }
  // Cascade D1 — toutes les tables métier portent pub_id (sauf dk_pages/slots
  // qui l'ont aussi). dk_publications en dernier.
  const tables = ['dk_files', 'dk_inbox', 'dk_habits', 'dk_email_log', 'dk_relances',
    'dk_contribs', 'dk_page_slots', 'dk_pages', 'dk_articles', 'dk_issues',
    'dk_rubriques', 'dk_invites', 'dk_members'];
  for (const t of tables) {
    await env.DB.prepare(`DELETE FROM ${t} WHERE pub_id = ?`).bind(pubId).run().catch(() => {});
  }
  await env.DB.prepare('DELETE FROM dk_publications WHERE id = ?').bind(pubId).run();
  return json({ ok: true, deleted: pub.name }, 200, origin);
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
    // DK-3 : pièces du casier du numéro, contributeurs (e-mails + retard moyen
    // interne) et relances envoyées — le front en déduit les relances À FAIRE.
    // Pièces du numéro + pièces « au marbre » (page_id = '' : rattachées à un
    // article de la publication, pas encore posées sur une page — DK-4).
    const files = (await env.DB.prepare(
      `SELECT ${FILE_COLS} FROM dk_files WHERE issue_id = ? OR (pub_id = ? AND page_id = '') ORDER BY created_at DESC`)
      .bind(issueId, pubId).all()).results || [];
    const contribs = (await env.DB.prepare('SELECT id, name, email, n_remises, total_delay FROM dk_contribs WHERE pub_id = ? ORDER BY name').bind(pubId).all()).results || [];
    const relances = (await env.DB.prepare('SELECT art_id, email, sent_by, sent_at FROM dk_relances WHERE pub_id = ? ORDER BY sent_at DESC LIMIT 300').bind(pubId).all()).results || [];
    const used = files.reduce((n, f) => n + (f.status !== 'dead' ? (f.size || 0) : 0), 0);
    const casier = !env.DK_CASIER ? 'off' : (r2PresignReady(env) ? 'presigned' : 'direct');
    // DK-4 : bac « à trier » (entrées en attente) + adresse de dépôt.
    const inbox = (await env.DB.prepare(
      `SELECT id, from_email, from_name, subject, body, suggestion, attachments, received_at
       FROM dk_inbox WHERE pub_id = ? AND status = 'pending' ORDER BY received_at DESC LIMIT 50`).bind(pubId).all()).results || [];
    const pubRow = await env.DB.prepare('SELECT slug FROM dk_publications WHERE id = ?').bind(pubId).first();
    return json({
      ok: true, issue, pages, slots, articles, rubriques, files, contribs, relances, inbox,
      casier, quota: { used, max: QUOTA_ISSUE },
      mailer: !!env.KS_RESEND_KEY,
      email: { domain: env.DK_EMAIL_DOMAIN || null, slug: (pubRow && pubRow.slug) || null },
      now: new Date().toISOString(),
    }, 200, origin);
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
    // Point de départ du délai de grâce du casier (purge §6).
    await env.DB.prepare(`UPDATE dk_issues SET imprime_at = datetime('now') WHERE id = ?`).bind(issueId).run();
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
  // Contenu + emplacements + pièces du casier suivent (page_id via pivot).
  await env.DB.batch([
    env.DB.prepare(`UPDATE dk_pages SET kind = ?, fixe_tag = ?, fixe_title = ?, rub_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .bind(pb.kind, pb.fixe_tag, pb.fixe_title, pb.rub_id, by, pa.id),
    env.DB.prepare(`UPDATE dk_pages SET kind = ?, fixe_tag = ?, fixe_title = ?, rub_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .bind(pa.kind, pa.fixe_tag, pa.fixe_title, pa.rub_id, by, pb.id),
    env.DB.prepare(`UPDATE dk_page_slots SET page_id = 'dk_pivot' WHERE page_id = ?`).bind(pa.id),
    env.DB.prepare(`UPDATE dk_page_slots SET page_id = ? WHERE page_id = ?`).bind(pa.id, pb.id),
    env.DB.prepare(`UPDATE dk_page_slots SET page_id = ? WHERE page_id = 'dk_pivot'`).bind(pb.id),
    env.DB.prepare(`UPDATE dk_files SET page_id = 'dk_pivot' WHERE page_id = ?`).bind(pa.id),
    env.DB.prepare(`UPDATE dk_files SET page_id = ? WHERE page_id = ?`).bind(pa.id, pb.id),
    env.DB.prepare(`UPDATE dk_files SET page_id = ? WHERE page_id = 'dk_pivot'`).bind(pb.id),
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
  // Les pièces du casier suivent leur carte comme les emplacements.
  const fileRows = (await env.DB.prepare(
    `SELECT f.id, f.page_id FROM dk_files f JOIN dk_pages p ON p.id = f.page_id WHERE p.issue_id = ?`).bind(issueId).all()).results || [];
  for (const f of fileRows) {
    const dst = remap.get(f.page_id);
    if (dst) stmts.push(env.DB.prepare('UPDATE dk_files SET page_id = ? WHERE id = ?').bind(dst, f.id));
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

/* Redimensionner un numéro : changer son NOMBRE DE PAGES en cours de route
   (une revue grossit ou maigrit). Règle : la DERNIÈRE page (4ᵉ de couverture)
   reste toujours en dernier — on ajoute / retire les pages JUSTE AVANT elle.
   - agrandir : on insère des pages vides avant la dernière ;
   - réduire  : on retire les pages juste avant la dernière, mais SEULEMENT si
     elles sont vides (aucun article/emplacement, aucune pièce au casier, pas
     figées). Sinon 409 avec la liste des pages qui bloquent — l'utilisateur
     les libère/déplace d'abord (rien de surprenant, aucun contenu déplacé).   */
export async function handleIssueResize(request, env, issueId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_issues', issueId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const issue = await env.DB.prepare('SELECT status FROM dk_issues WHERE id = ?').bind(issueId).first();
  if (!issue) return err('Numéro introuvable', 404, origin);
  if (issue.status === 'imprime') return err('Ce numéro est imprimé — son format est figé', 409, origin);

  const body = await parseBody(request);
  const target = parseInt(body.pages, 10);
  if (!Number.isFinite(target) || target < 4 || target > MAX_PAGES)
    return err(`Nombre de pages invalide (entre 4 et ${MAX_PAGES})`, 400, origin);

  const pages = (await env.DB.prepare(`SELECT ${PAGE_COLS} FROM dk_pages WHERE issue_id = ? ORDER BY n`).bind(issueId).all()).results || [];
  const N = pages.length;
  if (!N) return err('Numéro sans pages', 400, origin);
  if (target === N) return json({ ok: true, pages: N, added: 0, removed: 0 }, 200, origin);

  const last = pages[pages.length - 1];         // la 4ᵉ de couverture (ou la dernière page)
  const by = _byName(u);
  const stmts = [];

  if (target > N) {
    // AGRANDIR : la dernière page glisse en fin, on insère du vide avant elle.
    const delta = target - N;
    stmts.push(env.DB.prepare(`UPDATE dk_pages SET n = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).bind(target, by, last.id));
    for (let n = N; n <= target - 1; n++) {
      stmts.push(env.DB.prepare(
        `INSERT INTO dk_pages (id, issue_id, pub_id, n, kind, updated_by) VALUES (?, ?, ?, ?, 'vide', ?)`)
        .bind(generateId(), issueId, pubId, n, by));
    }
    await env.DB.batch(stmts);
    return json({ ok: true, pages: target, added: delta, removed: 0 }, 200, origin);
  }

  // RÉDUIRE : on retire les pages juste avant la dernière (n ∈ [target, N-1]).
  const doomed = pages.filter(p => p.n >= target && p.n <= N - 1);
  const ids = doomed.map(p => p.id);
  // Vérifs de sécurité : rien de vivant dans la zone retirée.
  const blockers = [];
  const slotRows = ids.length ? (await env.DB.prepare(
    `SELECT DISTINCT page_id FROM dk_page_slots WHERE page_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results || [] : [];
  const fileRows = ids.length ? (await env.DB.prepare(
    `SELECT DISTINCT page_id FROM dk_files WHERE page_id IN (${ids.map(() => '?').join(',')}) AND status != 'rejete'`).bind(...ids).all()).results || [] : [];
  const withSlots = new Set(slotRows.map(r => r.page_id));
  const withFiles = new Set(fileRows.map(r => r.page_id));
  for (const p of doomed) {
    if (p.kind === 'fixe') blockers.push({ n: p.n, why: p.fixe_tag || 'figée' });
    else if (withSlots.has(p.id)) blockers.push({ n: p.n, why: 'article' });
    else if (withFiles.has(p.id)) blockers.push({ n: p.n, why: 'pièce au casier' });
  }
  if (blockers.length)
    return err('Des pages à retirer ne sont pas vides : ' + blockers.map(b => 'p. ' + b.n + ' (' + b.why + ')').join(', ') + '. Libérez-les ou déplacez leur contenu d’abord.', 409, origin);

  for (const id of ids) stmts.push(env.DB.prepare('DELETE FROM dk_pages WHERE id = ?').bind(id));
  stmts.push(env.DB.prepare(`UPDATE dk_pages SET n = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).bind(target, by, last.id));
  await env.DB.batch(stmts);
  return json({ ok: true, pages: target, added: 0, removed: doomed.length }, 200, origin);
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
  let pointage = false;
  if (body.status !== undefined) {
    if (!ART_STATUS.includes(body.status)) return err('Statut inconnu', 400, origin);
    sets.push('status = ?'); vals.push(body.status);
    if (body.status === 'remis' && cur.status !== 'remis') { pointage = true; histo = _histoPush(histo, 'Copie pointée reçue par ' + by); }
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
  // DK-3 : au pointage, le retard constaté nourrit le retard moyen du
  // contributeur (INTERNE, §2 — cale le calendrier de relance, jamais un score).
  if (pointage) await dkContribStats(env, pubId, cur.contrib, cur.due);
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

/* ═══════════════════ DK-3 · Le casier (§6) ═══════════════════════
   Transmission ÉPHÉMÈRE, pas un DAM : les pièces passent, les archives
   vivent ailleurs (InDesign, PDF final, booK). Fichiers en R2 (binding
   DK_CASIER), métadonnées en D1. Deux modes d'upload :
   - presigned : le navigateur PUT directement sur R2 (URL SigV4) — le
     fichier ne transite jamais par le Worker. Actif si les secrets
     DK_R2_ACCOUNT_ID / DK_R2_ACCESS_KEY_ID / DK_R2_SECRET_ACCESS_KEY
     sont posés ET la CORS du bucket configurée.
   - direct : repli sans secrets — POST streamé à travers le Worker
     (body → R2 sans bufferiser). Fonctionne jour 1, zéro setup.        */

function _fileExt(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}
function _fileName(name) {
  // Nom d'affichage assaini (aussi utilisé en Content-Disposition).
  const base = String(name || 'piece').split(/[\\/]/).pop().replace(/[^A-Za-z0-9À-ÿ ._()-]/g, '').trim();
  return (base || 'piece').slice(0, 120);
}
async function _fileGate(request, env, origin, fileId) {
  const f = await env.DB.prepare(`SELECT ${FILE_COLS}, pub_id, r2_key FROM dk_files WHERE id = ?`).bind(fileId).first();
  if (!f) return { error: err('Pièce introuvable', 404, origin) };
  const u = await memberGate(request, env, origin, f.pub_id);
  if (u.error) return u;
  return { u, file: f };
}
async function _casierUsed(env, issueId) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS used FROM dk_files WHERE issue_id = ?`).bind(issueId).first();
  return { n: r?.n || 0, used: r?.used || 0 };
}
// Jeton HMAC court pour le téléchargement en mode direct (une URL <a href>
// ne porte pas de header Authorization) — signé KS_JWT_SECRET, TTL 10 min.
async function _dlToken(env, fileId, exp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.KS_JWT_SECRET || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`dkfile:${fileId}:${exp}`));
  return [...new Uint8Array(sig)].slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('');
}

// POST /page/:id/casier {name, size, art_id?} → annonce un dépôt.
export async function handleCasierRequest(request, env, pageId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_pages', pageId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  if (!env.DK_CASIER) return err('Casier non configuré sur ce serveur (bucket R2 absent)', 503, origin);
  const page = await env.DB.prepare(`SELECT ${PAGE_COLS} FROM dk_pages WHERE id = ?`).bind(pageId).first();
  if (!page) return err('Page introuvable', 404, origin);
  const body = await parseBody(request);

  const name = _fileName(body.name);
  const ext = _fileExt(body.name);
  if (!FILE_EXTS[ext]) return err(`Type de fichier non accepté (.${ext || '?'}) — le casier transmet PDF, photos et textes`, 400, origin);
  const size = parseInt(body.size, 10);
  if (!Number.isFinite(size) || size <= 0) return err('Taille du fichier requise', 400, origin);
  if (size > FILE_MAX_BYTES) return err(`Fichier trop lourd (max ${Math.round(FILE_MAX_BYTES / 1048576)} Mo)`, 413, origin);

  const { n, used } = await _casierUsed(env, page.issue_id);
  if (n >= MAX_FILES_ISSUE) return err('Limite de pièces atteinte sur ce numéro', 403, origin);
  if (used + size > QUOTA_ISSUE) {
    return err(`Quota du casier atteint pour ce numéro (${Math.round(used / 1048576)} Mo utilisés sur ${Math.round(QUOTA_ISSUE / 1048576)} Mo) — supprimez des pièces transmises`, 403, origin);
  }

  // Pièce rattachée à l'article titulaire de la page par défaut (rétention
  // prolongée si l'article est reversé au marbre, §6) — surclassable.
  let artId = null;
  if (body.art_id) {
    const a = await env.DB.prepare('SELECT id FROM dk_articles WHERE id = ? AND pub_id = ?').bind(body.art_id, pubId).first();
    if (a) artId = a.id;
  } else {
    const s0 = await env.DB.prepare('SELECT art_id FROM dk_page_slots WHERE page_id = ? ORDER BY position LIMIT 1').bind(pageId).first();
    if (s0 && s0.art_id) artId = s0.art_id;
  }

  const id = generateId();
  const key = `dk-casier/${pubId}/${page.issue_id}/${id}.${ext}`;
  await env.DB.prepare(
    `INSERT INTO dk_files (id, pub_id, issue_id, page_id, art_id, name, mime, size, r2_key, status, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .bind(id, pubId, page.issue_id, pageId, artId, name, FILE_EXTS[ext], size, key, _byName(u)).run();

  let upload;
  if (r2PresignReady(env)) {
    const url = await presignR2({
      accountId: env.DK_R2_ACCOUNT_ID, accessKeyId: env.DK_R2_ACCESS_KEY_ID,
      secretAccessKey: env.DK_R2_SECRET_ACCESS_KEY, bucket: env.DK_R2_BUCKET || 'keystone-desk-casier',
      key, method: 'PUT', expires: FILE_URL_TTL,
    });
    upload = { mode: 'presigned', url, content_type: FILE_EXTS[ext] };
  } else {
    upload = { mode: 'direct', path: `/casier/${id}/put` };
  }
  return json({ ok: true, file: { id, page_id: pageId, art_id: artId, name, size, status: 'pending' }, upload, quota: { used: used + size, max: QUOTA_ISSUE } }, 200, origin);
}

// POST /casier/:id/put — repli direct : le body est STREAMÉ vers R2.
export async function handleCasierPut(request, env, fileId) {
  const origin = getAllowedOrigin(env, request);
  const g = await _fileGate(request, env, origin, fileId);
  if (g.error) return g.error;
  const { file } = g;
  if (!env.DK_CASIER) return err('Casier non configuré', 503, origin);
  if (file.status !== 'pending') return err('Cette pièce a déjà été transmise', 400, origin);
  const declared = file.size || 0;
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len && len > FILE_MAX_BYTES) return err('Fichier trop lourd', 413, origin);
  const obj = await env.DK_CASIER.put(file.r2_key, request.body, {
    httpMetadata: { contentType: file.mime || 'application/octet-stream' },
  });
  const size = obj?.size ?? len ?? declared;
  if (size > FILE_MAX_BYTES) {
    await env.DK_CASIER.delete(file.r2_key).catch(() => {});
    await env.DB.prepare('DELETE FROM dk_files WHERE id = ?').bind(fileId).run();
    return err('Fichier trop lourd', 413, origin);
  }
  await env.DB.prepare(`UPDATE dk_files SET status = 'ok', size = ? WHERE id = ?`).bind(size, fileId).run();
  return json({ ok: true, file: { id: fileId, size, status: 'ok' } }, 200, origin);
}

// POST /casier/:id/complete — valide un dépôt présigné (l'objet doit exister).
export async function handleCasierComplete(request, env, fileId) {
  const origin = getAllowedOrigin(env, request);
  const g = await _fileGate(request, env, origin, fileId);
  if (g.error) return g.error;
  const { file } = g;
  if (!env.DK_CASIER) return err('Casier non configuré', 503, origin);
  if (file.status === 'ok') return json({ ok: true, file: { id: fileId, size: file.size, status: 'ok' } }, 200, origin);
  const head = await env.DK_CASIER.head(file.r2_key);
  if (!head) return err('Pièce non reçue par le stockage — réessayez l\'envoi', 409, origin);
  if (head.size > FILE_MAX_BYTES) {
    await env.DK_CASIER.delete(file.r2_key).catch(() => {});
    await env.DB.prepare('DELETE FROM dk_files WHERE id = ?').bind(fileId).run();
    return err('Fichier trop lourd', 413, origin);
  }
  await env.DB.prepare(`UPDATE dk_files SET status = 'ok', size = ? WHERE id = ?`).bind(head.size, fileId).run();
  return json({ ok: true, file: { id: fileId, size: head.size, status: 'ok' } }, 200, origin);
}

// GET /casier/:id/url — lien de téléchargement court (présigné R2 ou jeton).
export async function handleCasierUrl(request, env, fileId) {
  const origin = getAllowedOrigin(env, request);
  const g = await _fileGate(request, env, origin, fileId);
  if (g.error) return g.error;
  const { file } = g;
  if (file.status !== 'ok') return err('Pièce pas encore transmise', 409, origin);
  const disposition = `attachment; filename="${file.name.replace(/[^A-Za-z0-9._ -]/g, '_')}"`;
  if (r2PresignReady(env)) {
    const url = await presignR2({
      accountId: env.DK_R2_ACCOUNT_ID, accessKeyId: env.DK_R2_ACCESS_KEY_ID,
      secretAccessKey: env.DK_R2_SECRET_ACCESS_KEY, bucket: env.DK_R2_BUCKET || 'keystone-desk-casier',
      key: file.r2_key, method: 'GET', expires: FILE_URL_TTL, disposition,
    });
    return json({ ok: true, url }, 200, origin);
  }
  const exp = Math.floor(Date.now() / 1000) + FILE_URL_TTL;
  const t = await _dlToken(env, fileId, exp);
  return json({ ok: true, url: `${new URL(request.url).origin}/api/desk/casier/${fileId}/dl?e=${exp}&t=${t}` }, 200, origin);
}

// GET /casier/:id/dl?e&t — téléchargement streamé (jeton, pas de JWT :
// l'URL s'ouvre dans un onglet). Vérification HMAC + expiration.
export async function handleCasierDl(request, env, fileId) {
  const origin = getAllowedOrigin(env, request);
  if (!env.DK_CASIER) return err('Casier non configuré', 503, origin);
  const url = new URL(request.url);
  const exp = parseInt(url.searchParams.get('e') || '0', 10);
  const t = String(url.searchParams.get('t') || '');
  if (!exp || exp < Math.floor(Date.now() / 1000)) return err('Lien expiré — redemandez le téléchargement', 403, origin);
  const expected = await _dlToken(env, fileId, exp);
  if (t !== expected) return err('Lien invalide', 403, origin);
  const file = await env.DB.prepare(`SELECT name, mime, r2_key, status FROM dk_files WHERE id = ?`).bind(fileId).first();
  if (!file || file.status !== 'ok') return err('Pièce introuvable', 404, origin);
  const obj = await env.DK_CASIER.get(file.r2_key);
  if (!obj) return err('Pièce absente du stockage', 404, origin);
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': file.mime || 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Content-Disposition': `attachment; filename="${String(file.name).replace(/[^A-Za-z0-9._ -]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'Access-Control-Allow-Origin': origin,   // le lien s'ouvre en navigation ; le header sert un éventuel fetch
    },
  });
}

// DELETE /casier/:id — retire la pièce (objet R2 + métadonnées).
export async function handleCasierDelete(request, env, fileId) {
  const origin = getAllowedOrigin(env, request);
  const g = await _fileGate(request, env, origin, fileId);
  if (g.error) return g.error;
  if (env.DK_CASIER) await env.DK_CASIER.delete(g.file.r2_key).catch(() => {});
  await env.DB.prepare('DELETE FROM dk_files WHERE id = ?').bind(fileId).run();
  return json({ ok: true }, 200, origin);
}

/* Purge planifiée du casier (§6 — cron quotidien 3h) :
   - pièces des numéros « imprimé » depuis > CASIER_GRACE_DAYS jours,
     SAUF rétention prolongée : la pièce d'un article encore vivant ET
     réservé quelque part (emplacement ou banc d'un numéro non imprimé)
     survit tant que la réservation tient (§12, option recommandée) ;
   - dépôts « pending » abandonnés depuis > 24 h.                        */
export async function sweepDeskCasier(env) {
  await _ensureSchema(env);
  const grace = Math.max(0, parseInt(env.DK_CASIER_GRACE_DAYS ?? CASIER_GRACE_DAYS, 10) || 0);
  let purged = 0, retained = 0, stale = 0;

  // Filet legacy : un numéro imprimé sans horodatage démarre sa grâce ici.
  await env.DB.prepare(`UPDATE dk_issues SET imprime_at = datetime('now') WHERE status = 'imprime' AND imprime_at IS NULL`).run();

  const rows = (await env.DB.prepare(
    `SELECT f.id, f.r2_key, f.art_id FROM dk_files f
     JOIN dk_issues i ON i.id = f.issue_id
     WHERE i.status = 'imprime' AND i.imprime_at <= datetime('now', ?)`)
    .bind(`-${grace} days`).all()).results || [];

  for (const f of rows) {
    if (f.art_id) {
      // Rétention prolongée : article vivant + réservé dans un numéro non imprimé ?
      const alive = await env.DB.prepare(
        `SELECT a.id FROM dk_articles a WHERE a.id = ? AND a.status NOT IN ('publie', 'abandonne')`).bind(f.art_id).first();
      if (alive) {
        const slots = (await env.DB.prepare(
          `SELECT s.art_id, s.banc FROM dk_page_slots s
           JOIN dk_pages p ON p.id = s.page_id
           JOIN dk_issues i ON i.id = p.issue_id
           WHERE i.status != 'imprime' AND s.pub_id = (SELECT pub_id FROM dk_articles WHERE id = ?)`).bind(f.art_id).all()).results || [];
        const reserved = slots.some(s => {
          if (s.art_id === f.art_id) return true;
          try { const b = JSON.parse(s.banc || '[]'); return Array.isArray(b) && b.includes(f.art_id); } catch (_) { return false; }
        });
        if (reserved) { retained++; continue; }
      }
    }
    if (env.DK_CASIER) await env.DK_CASIER.delete(f.r2_key).catch(() => {});
    await env.DB.prepare('DELETE FROM dk_files WHERE id = ?').bind(f.id).run();
    purged++;
  }

  // Dépôts annoncés jamais aboutis (> 24 h) — nettoyage silencieux.
  const pend = (await env.DB.prepare(
    `SELECT id, r2_key FROM dk_files WHERE status = 'pending' AND created_at <= datetime('now', '-1 day')`).all()).results || [];
  for (const f of pend) {
    if (env.DK_CASIER) await env.DK_CASIER.delete(f.r2_key).catch(() => {});
    await env.DB.prepare('DELETE FROM dk_files WHERE id = ?').bind(f.id).run();
    stale++;
  }
  // DK-4 : entrées du bac jamais triées (> 90 j) — pièces R2 comprises.
  let inbox = 0;
  const oldRows = (await env.DB.prepare(
    `SELECT id, attachments FROM dk_inbox WHERE status = 'pending' AND received_at <= datetime('now', '-90 days')`).all()).results || [];
  for (const r of oldRows) {
    let atts = []; try { atts = JSON.parse(r.attachments || '[]'); } catch (_) {}
    for (const a of atts) { if (env.DK_CASIER && a.r2_key) await env.DK_CASIER.delete(a.r2_key).catch(() => {}); }
    await env.DB.prepare('DELETE FROM dk_inbox WHERE id = ?').bind(r.id).run();
    inbox++;
  }
  return { purged, retained, stale, inbox };
}

/* ═══════════════ DK-3 · Contributeurs & relances (§5.4) ══════════
   Les relances restent dans le monde e-mail : brouillon proposé côté
   front (gabarit déterministe, ZÉRO IA), la rédactrice ajuste puis
   envoie ici via Resend. La « relance prévue » n'est jamais stockée :
   elle se CALCULE (échéance + retard moyen), donc le pointage l'annule
   de lui-même. Seuls les envois sont journalisés (dk_relances).        */

// POST /publication/:id/contrib {name, email} — mémoriser un e-mail connu.
export async function handleContribUpsert(request, env, pubId) {
  const origin = getAllowedOrigin(env, request);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const body = await parseBody(request);
  const name = _s(String(body.name || '').trim(), MAX_NAME_LEN);
  if (!name) return err('Nom du contributeur requis', 400, origin);
  const email = String(body.email || '').toLowerCase().trim();
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)) return err('E-mail invalide', 400, origin);
  await env.DB.prepare(
    `INSERT INTO dk_contribs (id, pub_id, name, email) VALUES (?, ?, ?, ?)
     ON CONFLICT (pub_id, name) DO UPDATE SET email = excluded.email`)
    .bind(generateId(), pubId, name, email || null).run();
  const contrib = await env.DB.prepare('SELECT id, name, email, n_remises, total_delay FROM dk_contribs WHERE pub_id = ? AND name = ?').bind(pubId, name).first();
  return json({ ok: true, contrib }, 200, origin);
}

// POST /article/:id/relance {email, subject, body} — envoi Resend + journal.
export async function handleRelanceSend(request, env, artId) {
  const origin = getAllowedOrigin(env, request);
  const pubId = await pubOf(env, 'dk_articles', artId);
  const u = await memberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const art = await env.DB.prepare(`SELECT ${ART_COLS} FROM dk_articles WHERE id = ?`).bind(artId).first();
  if (!art) return err('Article introuvable', 404, origin);
  if (!['propose', 'attendu'].includes(art.status)) return err('Cet article n\'attend plus de copie — la relance n\'a plus d\'objet', 400, origin);
  if (!env.KS_RESEND_KEY) {
    return err('L\'envoi de relances n\'est pas encore activé sur ce serveur (clé d\'envoi absente). Utilisez « Via ma messagerie » en attendant.', 503, origin);
  }

  const body = await parseBody(request);
  const email = String(body.email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return err('E-mail du contributeur invalide', 400, origin);
  const subject = _s(String(body.subject || '').trim(), MAX_MAIL_SUBJECT);
  const text = String(body.body || '').slice(0, MAX_MAIL_BODY).trim();
  if (!subject || !text) return err('Objet et message requis', 400, origin);

  // Garde-fou : plafond d'envois par publication et par jour (pattern Sentinel).
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(`INSERT INTO dk_email_log (pub_id, day, count) VALUES (?, ?, 1)
    ON CONFLICT (pub_id, day) DO UPDATE SET count = count + 1`).bind(pubId, day).run();
  const used = await env.DB.prepare('SELECT count FROM dk_email_log WHERE pub_id = ? AND day = ?').bind(pubId, day).first();
  const revert = () => env.DB.prepare('UPDATE dk_email_log SET count = MAX(count - 1, 0) WHERE pub_id = ? AND day = ?').bind(pubId, day).run().catch(() => {});
  if (used && used.count > RELANCE_DAILY_LIMIT) {
    await revert();
    return err(`Limite de ${RELANCE_DAILY_LIMIT} relances par jour atteinte pour cette publication`, 429, origin);
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1c1c1e">${esc(text).replace(/\n/g, '<br>')}</div>`;
  const from = env.KS_RESEND_FROM ? String(env.KS_RESEND_FROM) : 'desK — la rédaction <desk@protein-keystone.com>';
  const payload = { from, to: [email], subject, html, text };
  if (u.email) payload.reply_to = u.email;   // les réponses reviennent à la rédactrice

  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
  let res, data = {};
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.KS_RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctrl.signal,
    });
    try { data = await res.json(); } catch (_) {}
  } catch (e) {
    await revert(); clearTimeout(timer);
    return err('Envoi impossible : ' + ((e && e.name === 'AbortError') ? 'délai dépassé' : 'réseau'), 502, origin);
  }
  clearTimeout(timer);
  if (!res.ok) {
    await revert();
    return err('Envoi refusé par le service : ' + String(data.message || data.name || `HTTP ${res.status}`), 502, origin);
  }

  const by = _byName(u);
  await env.DB.prepare('INSERT INTO dk_relances (id, pub_id, art_id, email, subject, sent_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(generateId(), pubId, artId, email, subject, by).run();
  await env.DB.prepare(`UPDATE dk_articles SET histo = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(_histoPush(art.histo, `Relance envoyée à ${email} par ${by}`), artId).run();
  // L'e-mail du contributeur est mémorisé au passage (satellite §2).
  if (art.contrib) {
    await env.DB.prepare(
      `INSERT INTO dk_contribs (id, pub_id, name, email) VALUES (?, ?, ?, ?)
       ON CONFLICT (pub_id, name) DO UPDATE SET email = excluded.email`)
      .bind(generateId(), pubId, _s(art.contrib, MAX_NAME_LEN), email).run();
  }
  return json({ ok: true, sent: { art_id: artId, email, sent_by: by } }, 200, origin);
}
