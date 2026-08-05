#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — DK-7 · LE FILET DU FRONT (banc d'interface desK)

   Ce banc démarre le VRAI `app/desk.js` dans un vrai navigateur
   (Chrome headless piloté par puppeteer, déjà dépendance du dépôt),
   avec le vrai `app/desk.css` et le vrai `app/ghostwriter.js`. Rien
   n'est réimplémenté : le fichier livré est celui qu'on teste. Seul le
   worker est doublé — un serveur local calqué sur
   `workers/src/routes/desk.js` et `desk-email.js` (mêmes routes, mêmes
   formes de payload). Les bancs de `workers/test/` couvrent le worker ;
   ici on couvre les 3 200 lignes de front qui n'avaient AUCUN test.

   POURQUOI un navigateur et pas jsdom : le parcours 5 mesure un
   DÉPASSEMENT en pixels. jsdom n'a pas de moteur de mise en page —
   `getBoundingClientRect()` y rend des zéros, et le test passerait au
   vert sans rien prouver.

   ── Les sept défauts du 4 août 2026 et l'assertion qui les garde ──

   1. Bannette servie depuis un cache périmé — un pli arrivé après une
      première visite restait invisible, pastille à 1, liste vide
      (476bedc).                              → parcours 2, « pli arrivé
                                                 depuis visible » + « la
                                                 pastille dit la même
                                                 chose que la liste »
   2. Rubrique de la page redemandée à la création d'article
      (476bedc).                              → parcours 3, « rubrique
                                                 de la page pré-remplie »
   3. Le tri ouvrait le panneau de REPRISE au lieu de celui du tri —
      tout partait au marbre (14e0210).       → parcours 1, « panneau de
                                                 TRI (pas de reprise) »
   4. Le tri ne savait pas poser sur une page (14e0210).
                                              → parcours 1, « page
                                                 pré-sélectionnée » +
                                                 « posé sur la page »
   5. La pièce jointe restait au marbre quand l'article prenait sa page,
      et « au marbre » comptait des articles déjà placés (748b3c7).
                                              → parcours 1, « pièce dans
                                                 le casier de CETTE page »
                                                 + « marbre n'en parle
                                                 plus »
   6. Relecture Ghost Writer : pills de ton + 3 variantes, et
      « Reprendre ce texte » ne réécrivait rien (45e7573, 53e76c6).
                                              → parcours 4 (5 assertions)
   7. La question de confirmation s'ouvrait sous le pli (f539823).
                                              → parcours 5, dépassement
                                                 mesuré sur 5 confirmations

   Usage : node scripts/test-desk-ui.mjs      ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import http               from 'node:http';
import fs                 from 'node:fs';
import os                 from 'node:os';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath }  from 'node:url';
import puppeteer          from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
const echecs = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    failed++; echecs.push(name);
    console.error(`  \x1b[31m✗\x1b[0m ${name}${detail !== undefined ? `  \x1b[2m→ ${detail}\x1b[0m` : ''}`);
  }
}

/* ════════════════════════════════════════════════════════════════
   1 · LE MONDE DE BANC — état + routes calqués sur le worker.
   ════════════════════════════════════════════════════════════════ */

const SQL_NOW = (offsetMin = 0) =>
  new Date(Date.now() + offsetMin * 60000).toISOString().slice(0, 19).replace('T', ' ');

// La copie du contributeur, avec ses fautes — et ce que le moteur en rend.
// Deux constantes : le banc vérifie que le texte RELU remplace bien l'autre.
const COPIE_FAUTIVE = "Le stage de coésion s'est deroulé du 12 au 14 juin sur le camp de Canjuers. "
  + "Les cadres ont conduit les épreuves de nuit ; la cohésion en sort renforcé.";
const COPIE_RELUE = "Le stage de cohésion s'est déroulé du 12 au 14 juin sur le camp de Canjuers. "
  + "Les cadres ont conduit les épreuves de nuit ; la cohésion en sort renforcée.";

// Compteur JAMAIS remis à zéro, et suffixe distinct des ids du décor : deux
// lignes qui partagent un id se recouvrent en silence et le banc ment.
let _seq = 0;
const nouvelId = (p) => `${p}-neuf${++_seq}`;

function mondeNeuf() {
  const pages = [];
  // 16 pages : couverture figée, 4e de couv figée, le reste vide. Deux pages
  // portent déjà leur rubrique (pré-assignation DK-2) — c'est ce qui rend le
  // parcours 1 (page proposée) et le parcours 3 (rubrique héritée) réels.
  for (let n = 1; n <= 16; n++) {
    pages.push({
      id: `pg-${n}`, issue_id: 'iss-1', n,
      kind: n === 1 || n === 16 ? 'fixe' : 'vide',
      fixe_tag: n === 1 ? 'Couverture' : (n === 16 ? '4e de couv' : null),
      fixe_title: null, rub_id: null,
      updated_at: SQL_NOW(-600), updated_by: null,
    });
  }
  pages.find(p => p.n === 5).rub_id  = 'rub-actu';    // 1re page libre d'« Actualités »
  pages.find(p => p.n === 9).rub_id  = 'rub-actu';
  pages.find(p => p.n === 7).rub_id  = 'rub-unites';
  pages.find(p => p.n === 11).rub_id = 'rub-histoire';

  return {
    pub: {
      id: 'pub-1', name: "L'Épaulette", slug: 'l-epaulette', owner: true,
      cover_unnumbered: 1, first_folio: 0, created_at: SQL_NOW(-100000),
    },
    issue: {
      id: 'iss-1', pub_id: 'pub-1', num: '143', theme: 'Spécial cohésion',
      status: 'production',
      jalons: JSON.stringify({
        bouclage:  new Date(Date.now() + 12 * 86400e3).toISOString().slice(0, 10),
        maquette:  new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10),
        imprimeur: new Date(Date.now() + 28 * 86400e3).toISOString().slice(0, 10),
        parution:  new Date(Date.now() + 40 * 86400e3).toISOString().slice(0, 10),
      }),
      created_at: SQL_NOW(-40000),
    },
    rubriques: [
      { id: 'rub-actu',     name: 'Actualités',     color: '#c0392b', position: 0 },
      { id: 'rub-unites',   name: 'Vie des unités', color: '#2980b9', position: 1 },
      { id: 'rub-histoire', name: 'Histoire',       color: '#27ae60', position: 2 },
    ],
    pages,
    slots: [
      { id: 'sl-1', page_id: 'pg-3', position: 0, art_id: 'art-place', banc: '[]', created_at: SQL_NOW(-5000) },
    ],
    articles: [
      { id: 'art-place', title: 'Le mot du président', rub_id: 'rub-unites', contrib: 'Gal J. Rivière',
        status: 'relu', due: null, fresh: 'intemporel', perime: null, notes: '',
        histo: JSON.stringify(['Créé par Stéphane']), created_at: SQL_NOW(-5000), updated_at: SQL_NOW(-5000) },
      { id: 'art-copie', title: 'Le stage de cohésion', rub_id: 'rub-unites', contrib: 'Col. D. Mahieu',
        status: 'remis', due: new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10),
        fresh: 'intemporel', perime: null, notes: COPIE_FAUTIVE,
        histo: JSON.stringify([
          'Créé par Stéphane', 'Passé « attendu » par Stéphane', 'Copie reçue par e-mail',
          'Passé « remis » par Stéphane', 'Reversé au marbre du n° 142',
        ]),
        created_at: SQL_NOW(-4000), updated_at: SQL_NOW(-200) },
    ],
    // Huit pièces sur l'article au marbre : la fiche déborde franchement, ce
    // qui est la condition même du parcours 5 (une confirmation sous le pli).
    files: Array.from({ length: 8 }, (_, i) => ({
      id: `fi-${i + 1}`, issue_id: 'iss-1', page_id: '', art_id: 'art-copie',
      name: `planche-${i + 1}.jpg`, mime: 'image/jpeg', size: 240000 + i * 1000,
      status: 'ok', uploaded_by: 'Stéphane', created_at: SQL_NOW(-300 + i),
    })),
    contribs: [
      { id: 'ct-1', name: 'Col. D. Mahieu', email: 'd.mahieu@exemple.fr', n_remises: 3, total_delay: 4 },
    ],
    relances: [],
    // dk_inbox : TOUT le courrier, tous sorts confondus (la bannette).
    inbox: [
      { id: 'in-spontane', pub_id: 'pub-1',
        from_email: 'a.perrin@exemple.fr', from_name: 'Cne A. Perrin',
        orig_email: null, orig_name: null,
        subject: 'Photos de la remise de fourragère',
        body: "Bonjour, je vous envoie le compte rendu de la remise de fourragère du 3 juin, "
            + "avec une photo. Bien cordialement, Cne Perrin.",
        suggestion: JSON.stringify({ via: 'aucune' }),
        attachments: JSON.stringify([{ name: 'fourragere.jpg', mime: 'image/jpeg', size: 812345, r2_key: 'r2/fourragere' }]),
        status: 'pending', art_id: null, resolved_by: null, resolved_at: null,
        received_at: SQL_NOW(-90), lu_at: null },
      { id: 'in-avec-statut', pub_id: 'pub-1',
        from_email: 'l.berard@exemple.fr', from_name: 'Mme L. Bérard',
        orig_email: null, orig_name: null,
        subject: 'Chronique — les tambours de la Garde',
        body: "Voici ma chronique pour le prochain numéro.",
        suggestion: JSON.stringify({ via: 'aucune' }),
        attachments: '[]',
        status: 'pending', art_id: null, resolved_by: null, resolved_at: null,
        received_at: SQL_NOW(-70), lu_at: null },
      { id: 'in-classe', pub_id: 'pub-1',
        from_email: 'd.mahieu@exemple.fr', from_name: 'Col. D. Mahieu',
        orig_email: null, orig_name: null,
        subject: 'Ma copie — le stage de cohésion',
        body: COPIE_FAUTIVE,
        suggestion: '{}', attachments: '[]',
        status: 'done', art_id: 'art-copie', resolved_by: 'Stéphane',
        resolved_at: SQL_NOW(-200), received_at: SQL_NOW(-260), lu_at: SQL_NOW(-200) },
      // Du remplissage : la liste de la bannette doit déborder pour que le
      // parcours 5 y trouve une confirmation réellement sous le pli.
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `in-vieux-${i + 1}`, pub_id: 'pub-1',
        from_email: `contrib${i + 1}@exemple.fr`, from_name: `Contributeur ${i + 1}`,
        orig_email: null, orig_name: null,
        subject: `Ancienne contribution n° ${i + 1}`,
        body: 'Texte reçu.', suggestion: '{}', attachments: '[]',
        status: 'rejete', art_id: null, resolved_by: 'Stéphane',
        resolved_at: SQL_NOW(-1000 - i), received_at: SQL_NOW(-1100 - i), lu_at: SQL_NOW(-1000 - i),
      })),
    ],
  };
}

let DB = mondeNeuf();
// Journal des requêtes REÇUES : la preuve que le front les a bien émises.
let JOURNAL = [];
function journalise(method, path, body) { JOURNAL.push({ method, path, body }); }
const appels = (method, re) => JOURNAL.filter(a => a.method === method && re.test(a.path));

const artById  = id => DB.articles.find(a => a.id === id) || null;
const pageById = id => DB.pages.find(p => p.id === id) || null;
const slotsOf  = pid => DB.slots.filter(s => s.page_id === pid);
const nonLus   = () => DB.inbox.filter(r => !r.lu_at).length;
const marquerLu = id => { const r = DB.inbox.find(x => x.id === id); if (r && !r.lu_at) r.lu_at = SQL_NOW(); };

const EXTS_OK = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', docx:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/* ── Routes /api/desk/* — mêmes chemins et mêmes formes que le worker ── */
function apiDesk(method, path, body) {
  journalise(method, path, body);
  let m;

  if (path === '/bootstrap') {
    // DK-10 : `me.email` voyage — c'est ce qui permet à l'écran d'accueil vide
    // de nommer l'adresse de connexion. DB.sansPub simule le cas de la
    // co-équipière dont l'invitation n'a pas pris (adresse qui ne correspond pas).
    return [200, { ok: true, me: { sub: 'ui-owner', name: 'Stéphane', email: 'ui@test.dk' },
      publications: DB.sansPub ? [] : [{ ...DB.pub, issues: [DB.issue] }] }];
  }

  if ((m = path.match(/^\/issue\/([^/]+)$/)) && method === 'GET') {
    return [200, {
      ok: true,
      issue: DB.issue,
      pages: DB.pages.slice().sort((a, b) => a.n - b.n),
      slots: DB.slots,
      articles: DB.articles,
      rubriques: DB.rubriques,
      files: DB.files,
      contribs: DB.contribs,
      relances: DB.relances,
      // ⚠ VOLONTAIRE — le bac est servi SANS `status` sur la 1re entrée.
      // C'est exactement le payload de production du 4 août : la colonne
      // manquait au SELECT. Le front doit ouvrir le panneau de TRI quand même
      // (il se fie à la vue, pas à un champ qui peut manquer). La 2e entrée
      // porte `status`, comme le worker d'aujourd'hui : les deux doivent
      // marcher. Le worker, lui, est gardé par workers/test/test-desk-dk4c.
      inbox: DB.inbox.filter(r => r.status === 'pending').map(r => {
        const base = {
          id: r.id, from_email: r.from_email, from_name: r.from_name,
          orig_email: r.orig_email, orig_name: r.orig_name,
          subject: r.subject, body: r.body, suggestion: r.suggestion,
          attachments: r.attachments, received_at: r.received_at,
          // DK-8 : le verdict d'authentification voyage avec le bac, sinon la
          // mention « expéditeur non authentifié » n'a rien à afficher.
          auth: r.auth ?? null, auth_detail: r.auth_detail ?? null,
        };
        return r.id === 'in-spontane' ? base : { ...base, status: r.status, lu_at: r.lu_at };
      }),
      courrier_non_lus: nonLus(),
      casier: 'direct',
      quota: { used: DB.files.reduce((n, f) => n + (f.size || 0), 0), max: 500 * 1048576 },
      mailer: true,
      email: { domain: 'depot.exemple.fr', slug: DB.pub.slug },
      now: new Date().toISOString(),
    }];
  }

  if ((m = path.match(/^\/issue\/([^/]+)$/)) && method === 'PATCH') {
    if (body.status) DB.issue.status = body.status;
    return [200, { ok: true, boucle: body.status === 'imprime' ? { published: 1, reversed: 0 } : null }];
  }

  if ((m = path.match(/^\/publication\/([^/]+)\/courrier$/)) && method === 'GET') {
    const courrier = DB.inbox.map(r => {
      const art = r.art_id ? artById(r.art_id) : null;
      let atts = []; try { atts = JSON.parse(r.attachments || '[]'); } catch (_) {}
      return {
        id: r.id, from_email: r.from_email, from_name: r.from_name,
        orig_email: r.orig_email, orig_name: r.orig_name,
        subject: r.subject, body: r.body, attachments: atts,
        status: r.status, received_at: r.received_at, lu: !!r.lu_at,
        resolved_by: r.resolved_by, resolved_at: r.resolved_at,
        art_id: r.art_id || null, art_title: art ? art.title : null,
        art_status: art ? art.status : null,
        art_perdu: !!(r.art_id && !art),
        auth: r.auth ?? null, auth_detail: r.auth_detail ?? null,
      };
    }).sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
    // DK-8 : les comptes par sort, sur TOUT le courrier — la liste est
    // plafonnée côté worker, donc l'alerte « mises de côté » les lit ici.
    const compte = {};
    for (const r of DB.inbox) compte[r.status] = (compte[r.status] || 0) + 1;
    return [200, { ok: true, courrier, non_lus: nonLus(), compte }];
  }

  if ((m = path.match(/^\/inbox\/([^/]+)\/lu$/)) && method === 'POST') {
    if (body && body.tout) DB.inbox.forEach(r => { if (!r.lu_at) r.lu_at = SQL_NOW(); });
    else marquerLu(m[1]);
    return [200, { ok: true, non_lus: nonLus() }];
  }

  if ((m = path.match(/^\/inbox\/([^/]+)\/apply$/)) && method === 'POST') {
    const row = DB.inbox.find(r => r.id === m[1]);
    if (!row) return [404, { error: 'Courrier introuvable' }];
    let artId = null;
    if (body.art_id) {
      if (!artById(body.art_id)) return [400, { error: 'Article inconnu dans cette publication' }];
      artId = body.art_id;
    } else if (body.create && body.create.title) {
      artId = nouvelId('art');
      const rub = DB.rubriques.find(r => r.id === body.create.rub_id);
      DB.articles.push({
        id: artId, title: String(body.create.title).trim(), rub_id: rub ? rub.id : null,
        contrib: (body.create.contrib || row.from_name || '').trim() || null,
        status: 'remis', due: null, fresh: 'intemporel', perime: null,
        notes: String(row.body || ''),
        histo: JSON.stringify([`Spontané reçu par e-mail de ${row.from_name} — créé au marbre par Stéphane`]),
        created_at: SQL_NOW(), updated_at: SQL_NOW(),
      });
      // Les pièces du courrier tombent AU MARBRE avec l'article (page_id '').
      let atts = []; try { atts = JSON.parse(row.attachments || '[]'); } catch (_) {}
      for (const a of atts) {
        DB.files.push({ id: nouvelId('fi'), issue_id: 'iss-1', page_id: '', art_id: artId,
          name: a.name, mime: a.mime, size: a.size, status: 'ok',
          uploaded_by: row.from_name, created_at: SQL_NOW() });
      }
    } else return [400, { error: 'Indiquez un article existant (art_id) ou un nouvel article (create)' }];
    row.status = 'done'; row.art_id = artId; row.resolved_by = 'Stéphane'; row.resolved_at = SQL_NOW();
    marquerLu(row.id);
    return [200, { ok: true, art_id: artId }];
  }

  if ((m = path.match(/^\/inbox\/([^/]+)\/reprendre$/)) && method === 'POST') {
    const row = DB.inbox.find(r => r.id === m[1]);
    if (!row) return [404, { error: 'Courrier introuvable' }];
    const artId = nouvelId('art');
    const rub = DB.rubriques.find(r => r.id === body.rub_id);
    DB.articles.push({ id: artId, title: String(body.title || '').trim(), rub_id: rub ? rub.id : null,
      contrib: (body.contrib || '').trim() || null, status: 'remis', due: null,
      fresh: 'intemporel', perime: null, notes: String(row.body || ''),
      histo: JSON.stringify(['Repris depuis la bannette par Stéphane']),
      created_at: SQL_NOW(), updated_at: SQL_NOW() });
    let atts = []; try { atts = JSON.parse(row.attachments || '[]'); } catch (_) {}
    for (const a of atts) {
      DB.files.push({ id: nouvelId('fi'), issue_id: 'iss-1', page_id: '', art_id: artId,
        name: a.name, mime: a.mime, size: a.size, status: 'ok',
        uploaded_by: row.from_name, created_at: SQL_NOW() });
    }
    row.status = 'done'; row.art_id = artId; row.resolved_by = 'Stéphane'; row.resolved_at = SQL_NOW();
    marquerLu(row.id);
    return [200, { ok: true, art_id: artId, pieces: atts.length }];
  }

  if ((m = path.match(/^\/inbox\/([^/]+)\/reject$/)) && method === 'POST') {
    const row = DB.inbox.find(r => r.id === m[1]);
    if (!row) return [404, { error: 'Courrier introuvable' }];
    row.status = 'rejete'; row.resolved_by = 'Stéphane'; row.resolved_at = SQL_NOW();
    marquerLu(row.id);
    return [200, { ok: true }];
  }

  if ((m = path.match(/^\/inbox\/([^/]+)$/)) && method === 'DELETE') {
    const i = DB.inbox.findIndex(r => r.id === m[1]);
    if (i < 0) return [404, { error: 'Courrier introuvable' }];
    const art = DB.inbox[i].art_id ? artById(DB.inbox[i].art_id) : null;
    DB.inbox.splice(i, 1);
    // L'ARTICLE n'est jamais touché — c'est la promesse de la bannette.
    return [200, { ok: true, article_conserve: art ? art.title : null }];
  }

  if ((m = path.match(/^\/page\/([^/]+)\/slot$/)) && method === 'POST') {
    const page = pageById(m[1]);
    if (!page) return [404, { error: 'Page introuvable' }];
    if (page.kind === 'fixe') return [400, { error: 'Page figée' }];
    const art = artById(body.art_id);
    if (!art) return [400, { error: 'Article inconnu dans cette publication' }];
    const existing = slotsOf(page.id);
    if (existing.some(s => s.art_id === art.id)) return [400, { error: 'Cet article est déjà sur cette page' }];
    const id = nouvelId('sl');
    DB.slots.push({ id, page_id: page.id, position: existing.length, art_id: art.id, banc: '[]', created_at: SQL_NOW() });
    page.kind = 'article'; page.updated_at = SQL_NOW(); page.updated_by = 'Stéphane';
    // Les pièces portées AU MARBRE suivent l'article sur sa page (748b3c7).
    DB.files.forEach(f => { if (f.art_id === art.id && (!f.page_id || f.page_id === '')) { f.page_id = page.id; f.issue_id = 'iss-1'; } });
    return [200, { ok: true, slot: { id, page_id: page.id, position: existing.length, art_id: art.id, banc: '[]' } }];
  }

  // Opération par lot — ici seul « spread » (étaler un article sur plusieurs
  // pages) est doublé : c'est celui qu'un parcours exerce. Mêmes garde-fous que
  // le worker (page figée / déjà porteuse de l'article → ignorée, comptée).
  if ((m = path.match(/^\/issue\/([^/]+)\/batch$/)) && method === 'POST') {
    if (body.op !== 'spread') return [400, { error: 'Opération inconnue' }];
    const art = artById(body.art_id);
    if (!art) return [400, { error: 'Article inconnu dans cette publication' }];
    let done = 0, skipped = 0;
    for (const n of [...new Set((body.ns || []).map(Number))].sort((a, b) => a - b)) {
      const page = DB.pages.find(p => p.n === n);
      if (!page || page.kind === 'fixe') { skipped++; continue; }
      const existing = slotsOf(page.id);
      if (existing.some(s => s.art_id === art.id)) { skipped++; continue; }
      DB.slots.push({ id: nouvelId('sl'), page_id: page.id, position: existing.length, art_id: art.id, banc: '[]', created_at: SQL_NOW() });
      page.kind = 'article'; page.updated_at = SQL_NOW(); page.updated_by = 'Stéphane';
      done++;
    }
    return [200, { ok: true, done, skipped }];
  }

  if ((m = path.match(/^\/page\/([^/]+)$/)) && method === 'PATCH') {
    const page = pageById(m[1]);
    if (!page) return [404, { error: 'Page introuvable' }];
    if ('rub_id' in body) page.rub_id = body.rub_id || null;
    if (body.kind) { page.kind = body.kind; page.fixe_tag = body.fixe_tag || page.fixe_tag; }
    return [200, { ok: true }];
  }

  if ((m = path.match(/^\/publication\/([^/]+)\/article$/)) && method === 'POST') {
    const title = String(body.title || '').trim();
    if (!title) return [400, { error: 'Titre requis' }];
    const rub = DB.rubriques.find(r => r.id === body.rub_id);
    const article = {
      id: nouvelId('art'), title, rub_id: rub ? rub.id : null,
      contrib: String(body.contrib || '').trim() || null,
      status: ['propose', 'attendu', 'remis', 'relu', 'maquette'].includes(body.status) ? body.status : 'propose',
      due: body.due || null, fresh: body.fresh === 'date' ? 'date' : 'intemporel',
      perime: body.perime || null, notes: '', histo: JSON.stringify(['Créé par Stéphane']),
      created_at: SQL_NOW(), updated_at: SQL_NOW(),
    };
    DB.articles.push(article);
    return [200, { ok: true, article }];
  }

  if ((m = path.match(/^\/article\/([^/]+)$/)) && method === 'PATCH') {
    const a = artById(m[1]);
    if (!a) return [404, { error: 'Article introuvable' }];
    for (const k of ['title', 'rub_id', 'contrib', 'status', 'due', 'fresh', 'perime', 'notes']) {
      if (k in body) a[k] = body[k];
    }
    if (body.histo_add) { const h = JSON.parse(a.histo || '[]'); h.unshift(body.histo_add); a.histo = JSON.stringify(h); }
    a.updated_at = SQL_NOW();
    // Le vrai worker RENVOIE l'article relu (le front s'en sert pour rafraîchir
    // sa fiche sans recharger tout le numéro). Sans ça, le double mentirait.
    return [200, { ok: true, article: { ...a } }];
  }

  if ((m = path.match(/^\/article\/([^/]+)$/)) && method === 'DELETE') {
    const i = DB.articles.findIndex(a => a.id === m[1]);
    if (i < 0) return [404, { error: 'Article introuvable' }];
    DB.articles.splice(i, 1);
    DB.slots = DB.slots.filter(s => s.art_id !== m[1]);
    return [200, { ok: true }];
  }

  if ((m = path.match(/^\/publication\/([^/]+)\/contrib$/)) && method === 'POST') {
    const name = String(body.name || '').trim(), email = String(body.email || '').trim().toLowerCase();
    if (!name || !email) return [400, { error: 'Nom et adresse requis' }];
    const ex = DB.contribs.find(c => c.name === name);
    if (ex) ex.email = email;
    else DB.contribs.push({ id: nouvelId('ct'), name, email, n_remises: 0, total_delay: 0 });
    return [200, { ok: true }];
  }

  if ((m = path.match(/^\/article\/([^/]+)\/casier$/)) && method === 'POST') {
    const a = artById(m[1]);
    if (!a) return [404, { error: 'Article introuvable' }];
    const ext = String(body.name || '').split('.').pop().toLowerCase();
    if (!EXTS_OK[ext]) return [400, { error: `Type de fichier non accepté (.${ext})` }];
    const size = parseInt(body.size, 10);
    if (!Number.isFinite(size) || size <= 0) return [400, { error: 'Taille du fichier requise' }];
    const id = nouvelId('fi');
    // Comme le worker : page_id '' — la pièce reste « au marbre avec l'article ».
    DB.files.push({ id, issue_id: body.issue_id || 'iss-1', page_id: '', art_id: a.id,
      name: String(body.name), mime: EXTS_OK[ext], size, status: 'pending',
      uploaded_by: 'Stéphane', created_at: SQL_NOW() });
    return [200, { ok: true, file: { id, page_id: '', art_id: a.id, name: body.name, size, status: 'pending' },
      upload: { mode: 'direct', path: `/casier/${id}/put` }, quota: { used: 0, max: 500 * 1048576 } }];
  }

  /* DK-10 · vider le casier d'un numéro imprimé, à la main. Le worker ne
     purge QUE les pièces réellement posées sur une page de ce numéro
     (page_id non vide) : celles qui dorment « au marbre » appartiennent à
     un article qui attend encore, pas au numéro qu'on vient d'imprimer.
     `simuler` rend le compte sans rien toucher. */
  if ((m = path.match(/^\/issue\/([^/]+)\/casier\/purge$/)) && method === 'POST') {
    if (DB.issue.status !== 'imprime') {
      return [400, { error: 'Seul un numéro « imprimé » peut être vidé — celui-ci est encore en fabrication' }];
    }
    const vivant = a => a && !['publie', 'abandonne'].includes(a.status);
    const reserve = id => DB.slots.some(sl => sl.art_id === id || (() => {
      try { return (JSON.parse(sl.banc || '[]') || []).includes(id); } catch (_) { return false; }
    })());
    const dans = DB.files.filter(f => f.issue_id === DB.issue.id && f.page_id !== '');
    const retenues = dans.filter(f => vivant(artById(f.art_id)) && reserve(f.art_id));
    const aPurger = dans.filter(f => !retenues.includes(f));
    const poids = aPurger.reduce((n, f) => n + (f.size || 0), 0);
    if (body && body.simuler === true) {
      return [200, { ok: true, simulation: true, num: DB.issue.num, pieces: aPurger.length, poids,
        noms: aPurger.map(f => f.name), conservees: retenues.length, noms_conservees: retenues.map(f => f.name) }];
    }
    DB.files = DB.files.filter(f => !aPurger.includes(f));
    return [200, { ok: true, num: DB.issue.num, pieces: aPurger.length, poids, conservees: retenues.length }];
  }

  if ((m = path.match(/^\/casier\/([^/]+)\/put$/)) && method === 'POST') {
    const f = DB.files.find(x => x.id === m[1]);
    if (!f) return [404, { error: 'Pièce introuvable' }];
    f.status = 'ok';
    return [200, { ok: true, file: { id: f.id, status: 'ok' } }];
  }

  if ((m = path.match(/^\/casier\/([^/]+)\/url$/)) && method === 'GET') {
    return [200, { ok: true, url: '/__dk7/telechargement-simule' }];
  }

  if ((m = path.match(/^\/casier\/([^/]+)$/)) && method === 'DELETE') {
    const i = DB.files.findIndex(f => f.id === m[1]);
    if (i < 0) return [404, { error: 'Pièce introuvable' }];
    DB.files.splice(i, 1);
    return [200, { ok: true }];
  }

  if ((m = path.match(/^\/publication\/([^/]+)\/team$/)) && method === 'GET') {
    return [200, { ok: true, members: [{ sub: 'ui-owner', name: 'Stéphane', email: 'ui@test.dk' }], invites: [] }];
  }

  return [404, { error: 'Route de banc inconnue : ' + method + ' ' + path }];
}

/* ── Routes /api/ghostwriter/* ──────────────────────────────────── */
function apiGhostwriter(method, path, body) {
  journalise(method, path, body);
  if (path === '/quota') {
    return [200, { ok: true, plan: 'max', used: 0, max: null, remaining: null,
      unlimited: true, period: 'month', included: null, packs: 0 }];
  }
  if (path === '/rewrite' && method === 'POST') {
    // Le nombre de propositions obéit à ce que le FRONT demande : c'est ainsi
    // que le banc voit si desK a bien envoyé variants:1 (une seule copie
    // corrigée) ou s'il est retombé sur les 3 variantes historiques.
    const n = body && body.variants === 1 ? 1 : 3;
    const variants = n === 1
      ? [{ label: 'Texte relu', text: COPIE_RELUE }]
      : [1, 2, 3].map(i => ({ label: `Variante ${i}`, text: COPIE_RELUE + ` (v${i})` }));
    return [200, { ok: true, variants, model: 'mistral-de-banc',
      quota: { plan: 'max', used: 1, max: null, remaining: null, unlimited: true, period: 'month' } }];
  }
  return [404, { error: 'Route Ghost Writer de banc inconnue : ' + path }];
}

/* ── Le serveur : fichiers du dépôt + les deux API + le harnais ──── */
const HARNAIS = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/app/style.css">
<link rel="stylesheet" href="/app/workspace.css">
<link rel="stylesheet" href="/app/desk.css">
<title>DK-7 — banc du front desK</title>
</head><body>
<script>
  // ghostwriter.js porte l'URL de l'API EN DUR (CF_API). On ne touche pas au
  // fichier : on redirige seulement l'hôte vers le worker de banc. Aucune
  // logique n'est remplacée — desk.js et ghostwriter.js sont ceux du dépôt.
  (function () {
    var PROD = 'https://keystone-os-api.keystone-os.workers.dev';
    var brut = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      if (u.indexOf(PROD) === 0) return brut(location.origin + u.slice(PROD.length), init);
      return brut(input, init);
    };
  })();
  localStorage.clear();
  localStorage.setItem('dk_api', location.origin);
  localStorage.setItem('ks_jwt', 'jwt-de-banc-dk7');
</script>
<script type="module">
  const m = await import('/app/desk.js?t=' + Date.now());
  window.__DK7__ = m;
  m.openDesk({});
</script>
</body></html>`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function demarrerServeur() {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = decodeURIComponent(url.pathname);
    const repondJSON = ([status, data]) => {
      const b = JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) });
      res.end(b);
    };
    const lireCorps = () => new Promise(resolve => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        try { resolve(raw.length ? JSON.parse(raw.toString('utf8')) : {}); }
        catch (_) { resolve({}); }   // corps binaire (casier direct) : rien à lire
      });
    });

    if (p === '/__dk7-harnais.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(HARNAIS);
    }
    if (p.startsWith('/api/desk')) {
      return lireCorps().then(b => repondJSON(apiDesk(req.method, p.slice('/api/desk'.length) || '/', b)));
    }
    if (p.startsWith('/api/ghostwriter')) {
      return lireCorps().then(b => repondJSON(apiGhostwriter(req.method, p.slice('/api/ghostwriter'.length) || '/', b)));
    }
    if (p.startsWith('/api/')) {   // ratings, help… : sans effet sur le banc
      return repondJSON([200, { ok: true }]);
    }

    const cible = normalize(join(ROOT, p));
    if (!cible.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(cible, (e, data) => {
      if (e) { res.writeHead(404); return res.end('introuvable'); }
      res.writeHead(200, { 'Content-Type': MIME[extname(cible).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

/* ════════════════════════════════════════════════════════════════
   2 · OUTILS DE PILOTAGE
   ════════════════════════════════════════════════════════════════ */

const attendre = ms => new Promise(r => setTimeout(r, ms));

// Clic JS (pas de clic à la souris) : volontaire. `page.click()` fait défiler
// l'élément dans le champ de vision AVANT de cliquer — ce qui truquerait le
// parcours 5, dont tout l'objet est de mesurer où la confirmation s'ouvre
// quand le panneau n'a PAS été défilé.
const cliquer = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) throw new Error('élément absent : ' + s);
  el.click();
}, sel);

const choisir = (page, sel, valeur) => page.evaluate((s, v) => {
  const el = document.querySelector(s);
  if (!el) throw new Error('select absent : ' + s);
  el.value = v;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, sel, valeur);

const saisir = (page, sel, valeur) => page.evaluate((s, v) => {
  const el = document.querySelector(s);
  if (!el) throw new Error('champ absent : ' + s);
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, sel, valeur);

const existe   = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
const compter  = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
const texte    = (page, sel) => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const valeur   = (page, sel) => page.evaluate(s => (document.querySelector(s) || {}).value ?? null, sel);
const textesDe = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent.trim()), sel);

async function attend(page, fn, arg, quoi, timeout = 8000) {
  try { await page.waitForFunction(fn, { timeout, polling: 60 }, arg); return true; }
  catch (_) { throw new Error('délai dépassé en attendant : ' + quoi); }
}
// Attente côté banc (l'état du worker de banc vit dans CE processus). Ne
// lève pas : c'est l'assertion qui doit parler, pas un plantage.
async function attendCote(pred, timeout = 5000) {
  const fin = Date.now() + timeout;
  while (Date.now() < fin) { if (pred()) return true; await attendre(80); }
  return false;
}
const attendSel = (page, sel, quoi = null, timeout = 8000) =>
  attend(page, s => !!document.querySelector(s), sel, quoi || sel, timeout);
const attendAbsence = (page, sel, quoi = null, timeout = 8000) =>
  attend(page, s => !document.querySelector(s), sel, quoi || ('disparition de ' + sel), timeout);

/* Un parcours qui s'interrompt (élément jamais apparu, panneau qui ne s'ouvre
   pas) doit compter comme UN ÉCHEC et laisser tourner les suivants. Sans ça,
   un seul défaut masquerait tout ce qui vient après — exactement le travers
   que ce banc existe pour corriger. */
async function parcours(titre, fn) {
  console.log(`\n\x1b[1m▶ ${titre}\x1b[0m`);
  try { await fn(); }
  catch (e) { check(`${titre} — le parcours va jusqu'au bout`, false, String(e && e.message || e)); }
}

// Repart d'un monde neuf et recharge le pad : chaque parcours est indépendant.
async function ouvrirLePad(page, base) {
  DB = mondeNeuf();
  JOURNAL = [];
  await page.goto(base + '/__dk7-harnais.html', { waitUntil: 'domcontentloaded' });
  await attendSel(page, '.dk-frise .dk-pcard', 'le chemin de fer affiché');
  await attendre(120);
}

/* ════════════════════════════════════════════════════════════════
   3 · LE BANC
   ════════════════════════════════════════════════════════════════ */

const srv  = await demarrerServeur();
const BASE = `http://127.0.0.1:${srv.address().port}`;
const navigateur = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  // 640 px de haut : la hauteur d'un portable, celle où la confirmation du
  // 4 août tombait sous le pli. Un écran trop grand rendrait le parcours 5 muet.
  defaultViewport: { width: 1280, height: 640 },
});
const page = await navigateur.newPage();
const erreursPage = [];
page.on('pageerror', e => erreursPage.push(String(e && e.message || e)));
page.on('console', msg => { if (msg.type() === 'error') erreursPage.push('console: ' + msg.text()); });

try {

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 1 · Trier une contribution
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 1 — Tri d\'une contribution', async () => {
  await ouvrirLePad(page, BASE);

  check('le vrai app/desk.js a démarré (chemin de fer rendu)', await existe(page, '.dk-app .dk-frise'));
  check('le bandeau annonce les 2 contributions à trier',
    /2 contributions à rattacher/.test(await texte(page, '.dk-bacstrip')));

  await cliquer(page, '[data-act="bac"]');
  await attendSel(page, '.dk-insp [data-bac]', 'la liste du bac');

  // ── Défaut n° 3 : le panneau ouvert par « Trier ».
  await cliquer(page, '[data-bac="in-spontane"]');
  await attendSel(page, '.dk-insp [data-act="bacok"], .dk-insp [data-act="reprendre"]', 'un panneau de courrier');
  const panneauTri = await existe(page, '.dk-insp [data-act="bacok"]');
  check('« Trier » ouvre le panneau de TRI, même quand `status` manque au payload',
    panneauTri && !(await existe(page, '.dk-insp [data-act="reprendre"]')),
    panneauTri ? undefined : 'c\'est le panneau de REPRISE qui s\'est ouvert (tout partirait au marbre)');
  check('le panneau de tri propose « Où le poser »', await existe(page, '.dk-insp [data-k="bacpage"]'));

  // ── Défaut n° 4 : la rubrique choisie propose sa première page libre.
  await choisir(page, '.dk-insp [data-k="bacrub"]', 'rub-actu');
  await attendre(60);
  check('rubrique « Actualités » → 1re page libre de la rubrique pré-sélectionnée (page 5)',
    (await valeur(page, '.dk-insp [data-k="bacpage"]')) === 'pg-5',
    'valeur retenue : ' + await valeur(page, '.dk-insp [data-k="bacpage"]'));

  await choisir(page, '.dk-insp [data-k="bacrub"]', 'rub-unites');
  await attendre(60);
  check('changer de rubrique repropose la page correspondante (page 7)',
    (await valeur(page, '.dk-insp [data-k="bacpage"]')) === 'pg-7');

  // On repart sur « Actualités » / page 9 : un choix explicite, pas le défaut.
  await choisir(page, '.dk-insp [data-k="bacrub"]', 'rub-actu');
  await attendre(60);
  await choisir(page, '.dk-insp [data-k="bacpage"]', 'pg-9');
  await saisir(page, '.dk-insp [data-k="bactitle"]', 'La remise de fourragère');

  const avant = DB.articles.length;
  await cliquer(page, '.dk-insp [data-act="bacok"]');
  await attend(page, n => document.querySelectorAll('[data-bac]').length === n,
    1, 'le bac redescendu à 1 entrée');

  const cree = DB.articles.find(a => a.title === 'La remise de fourragère');
  check('la contribution a bien créé un article', DB.articles.length === avant + 1 && !!cree);
  check('la rubrique choisie est retenue', !!cree && cree.rub_id === 'rub-actu',
    cree ? 'rub_id = ' + cree.rub_id : undefined);

  // ── Défaut n° 3 (suite) : l'article se pose sur LA PAGE choisie.
  const poses = appels('POST', /^\/page\/pg-9\/slot$/);
  check('le front a réservé l\'article sur la page choisie (POST /page/pg-9/slot)',
    poses.length === 1 && poses[0].body.art_id === (cree && cree.id),
    poses.length + ' appel(s)');
  check('l\'article est titulaire de la page 9',
    DB.slots.some(s => s.page_id === 'pg-9' && s.art_id === (cree && cree.id)));

  // ── Défaut n° 5 : la pièce jointe suit l'article sur sa page.
  const piece = DB.files.find(f => f.name === 'fourragere.jpg');
  check('la pièce du courrier a bien été versée', !!piece);
  check('la pièce a suivi l\'article dans le casier de CETTE page',
    !!piece && piece.page_id === 'pg-9', piece ? 'page_id = « ' + piece.page_id + ' »' : undefined);

  // …et la fiche de la page le montre à l'écran.
  await cliquer(page, '.dk-insp [data-act="close"]');
  await attendre(150);
  await cliquer(page, '.dk-frise .dk-pcard[data-n="9"]');
  await attendSel(page, '.dk-insp .dk-sec', 'la fiche de la page 9');
  const nomsCasier = await textesDe(page, '.dk-insp .dk-file-name');
  check('le casier de la page 9 affiche « fourragere.jpg »',
    nomsCasier.includes('fourragere.jpg'), JSON.stringify(nomsCasier));

  // ── Défaut n° 5 (suite) : « au marbre » ne compte plus ce qui a sa page.
  await cliquer(page, '.dk-insp [data-act="close"]');
  await attendre(150);
  await cliquer(page, '[data-slot="view"] [data-v="marbre"]');
  await attendSel(page, '.dk-marbre-list', 'la vue marbre');
  const titresMarbre = await textesDe(page, '.dk-mrow-title');
  check('l\'article posé en page ne figure plus « au marbre »',
    !titresMarbre.some(t => t.includes('La remise de fourragère')), JSON.stringify(titresMarbre));
  check('le compteur de l\'onglet Marbre suit la même définition',
    !/Marbre \(0\)/.test(await texte(page, '[data-slot="view"] [data-v="marbre"]'))
      && titresMarbre.length === Number((await texte(page, '[data-slot="view"] [data-v="marbre"]')).match(/\((\d+)\)/)?.[1]),
    'onglet = ' + await texte(page, '[data-slot="view"] [data-v="marbre"]') + ' · lignes = ' + titresMarbre.length);
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 2 · La bannette
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 2 — Bannette', async () => {
  await ouvrirLePad(page, BASE);

  await cliquer(page, '[data-act="bannette"]');
  await attendSel(page, '.dk-insp [data-bac]', 'la bannette');
  const premiereVisite = await compter(page, '.dk-insp .dk-banc-item');
  check('la bannette montre tout le courrier reçu, quel qu\'en soit le sort',
    premiereVisite === DB.inbox.length, premiereVisite + ' lignes pour ' + DB.inbox.length + ' plis');

  // On referme, et un pli arrive PENDANT ce temps — le cas du 4 août.
  await cliquer(page, '.dk-insp [data-act="close"]');
  await attendre(200);
  DB.inbox.unshift({
    id: 'in-nouveau', pub_id: 'pub-1',
    from_email: 'r.dubois@exemple.fr', from_name: 'Lt R. Dubois',
    orig_email: null, orig_name: null,
    subject: 'Contribution arrivée pendant la session',
    body: 'Un texte envoyé après la première visite de la bannette.',
    suggestion: JSON.stringify({ via: 'aucune' }), attachments: '[]',
    status: 'pending', art_id: null, resolved_by: null, resolved_at: null,
    received_at: SQL_NOW(-1), lu_at: null,
  });

  // ── Défaut n° 1 : la liste doit être RELUE à chaque ouverture.
  await cliquer(page, '[data-act="bannette"]');
  await attendSel(page, '.dk-insp [data-bac]', 'la bannette rouverte');
  const sujets = await textesDe(page, '.dk-insp .dk-banc-title');
  check('un pli arrivé depuis la 1re visite est visible à la réouverture',
    sujets.some(s => s.includes('Contribution arrivée pendant la session')),
    'la bannette resservait un cache périmé — ' + sujets.length + ' lignes');

  // ── Défaut n° 1 (suite) : la pastille dit la même chose que la liste.
  const pastille = await texte(page, '[data-act="bannette"] .dk-mailbadge');
  const nonLusListe = await compter(page, '.dk-insp .dk-banc-nonlu');
  check('la pastille concorde avec le nombre de lignes « non lu » de la liste',
    Number(pastille) === nonLusListe && nonLusListe > 0,
    'pastille = ' + (pastille || '(aucune)') + ' · lignes non lues = ' + nonLusListe);

  // ── Effacer depuis la liste : la ligne part, l'article reste.
  const avantArticles = DB.articles.length;
  await cliquer(page, '.dk-insp [data-suppr="in-classe"]');
  await attendSel(page, '.dk-insp .dk-file-confirm [data-supproui]', 'la confirmation d\'effacement');
  check('l\'effacement prévient que l\'article, lui, est conservé',
    /est conservé/.test(await texte(page, '.dk-insp .dk-file-confirm-q')));
  await cliquer(page, '.dk-insp [data-supproui]');
  await attendAbsence(page, '[data-suppr="in-classe"]', 'la ligne effacée');

  check('la ligne a quitté la bannette', !DB.inbox.some(r => r.id === 'in-classe'));
  check('l\'article rattaché n\'a pas été touché',
    DB.articles.length === avantArticles && !!artById('art-copie'));
  const sujets2 = await textesDe(page, '.dk-insp .dk-banc-title');
  check('la liste affichée reflète l\'effacement sans recharger la page',
    !sujets2.some(s => s.includes('Ma copie — le stage de cohésion')));
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 3 · Création d'article
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 3 — Création d\'article', async () => {
  await ouvrirLePad(page, BASE);

  // La page 11 porte déjà « Histoire » (pré-assignation DK-2).
  await cliquer(page, '.dk-frise .dk-pcard[data-n="11"]');
  await attendSel(page, '.dk-insp [data-act="newarthere"]', 'la fiche de la page 11');
  await cliquer(page, '.dk-insp [data-act="newarthere"]');
  await attendSel(page, '.dk-insp [data-k="title"]', 'le formulaire d\'article');

  // ── Défaut n° 2 : la rubrique de la page ne se redemande pas.
  check('la rubrique de la page est pré-remplie (« Histoire »)',
    (await valeur(page, '.dk-insp [data-k="rub"]')) === 'rub-histoire',
    'valeur du menu : ' + await valeur(page, '.dk-insp [data-k="rub"]'));

  await saisir(page, '.dk-insp [data-k="title"]', 'Les tambours de la Garde');
  await saisir(page, '.dk-insp [data-k="contrib"]', 'Mme L. Bérard');
  await saisir(page, '.dk-insp [data-k="contribmail"]', 'l.berard@exemple.fr');

  // Une pièce mise en attente AVANT que l'article existe.
  const fichier = join(os.tmpdir(), `dk7-planche-${process.pid}.jpg`);
  fs.writeFileSync(fichier, Buffer.from('banc dk7 — contenu de pièce jointe'));
  const input = await page.$('.dk-insp [data-k="stageinput"]');
  check('le formulaire accepte des pièces dès la création', !!input);
  await input.uploadFile(fichier);
  await attend(page, () => /part à la création/.test(document.querySelector('[data-slot="stagelist"]')?.textContent || ''),
    null, 'la pièce en attente listée');

  await cliquer(page, '.dk-insp [data-act="saveart"]');
  await attend(page, t => (window.__DK7DBG = null, [...document.querySelectorAll('.dk-pc-title')].some(e => e.textContent.includes(t))),
    'Les tambours de la Garde', 'la carte de la page 11 portant le nouvel article');
  fs.unlinkSync(fichier);

  const art = DB.articles.find(a => a.title === 'Les tambours de la Garde');
  check('l\'article est créé avec la rubrique de la page', !!art && art.rub_id === 'rub-histoire');
  check('l\'article est réservé sur la page 11',
    DB.slots.some(s => s.page_id === 'pg-11' && s.art_id === (art && art.id)));

  // ── L'e-mail du contributeur est enregistré (c'est lui qui fera reconnaître
  //    la copie à son arrivée — sans ça, la promesse du formulaire est fausse).
  const c = DB.contribs.find(x => x.name === 'Mme L. Bérard');
  check('l\'e-mail du contributeur est enregistré', !!c && c.email === 'l.berard@exemple.fr',
    c ? c.email : 'aucun contributeur enregistré');
  check('le front a bien appelé POST /publication/pub-1/contrib',
    appels('POST', /^\/publication\/pub-1\/contrib$/).length === 1);

  // ── La pièce mise en attente est versée APRÈS la création.
  const piece = DB.files.find(f => f.art_id === (art && art.id));
  check('la pièce en attente a été versée après la création',
    !!piece && piece.status === 'ok', piece ? 'statut ' + piece.status : 'aucune pièce versée');
  const ordre = JOURNAL.map(a => a.method + ' ' + a.path);
  check('l\'ordre est respecté : article créé, puis pièce versée',
    ordre.indexOf('POST /publication/pub-1/article') < ordre.findIndex(x => /^POST \/article\/.+\/casier$/.test(x)));

  // …et elle s'affiche dans la fiche de l'article. La pièce jointe à la
  // création reste rattachée à l'ARTICLE (page_id vide, « au marbre avec
  // l'article ») : c'est sa fiche qui la montre, pas le casier de la page.
  await cliquer(page, '[data-slot="view"] [data-v="marbre"]');
  await attendSel(page, '.dk-marbre-head [data-k="statut"]', 'la vue marbre');
  await choisir(page, '.dk-marbre-head [data-k="statut"]', 'tous');
  await attendSel(page, `.dk-mrow[data-a="${art.id}"]`, 'la ligne de l\'article créé');
  await cliquer(page, `.dk-mrow[data-a="${art.id}"]`);
  await attendSel(page, '.dk-insp [data-act="write"]', 'la fiche de l\'article créé');
  const noms = await textesDe(page, '.dk-insp .dk-file-name');
  check('la pièce apparaît à l\'écran avec l\'article',
    noms.some(n => n.startsWith('dk7-planche')), JSON.stringify(noms));
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 4 · Relecture Ghost Writer
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 4 — Relecture', async () => {
  await ouvrirLePad(page, BASE);

  await cliquer(page, '[data-slot="view"] [data-v="marbre"]');
  await attendSel(page, '.dk-mrow[data-a="art-copie"]', 'la ligne de l\'article au marbre');
  await cliquer(page, '.dk-mrow[data-a="art-copie"]');
  await attendSel(page, '.dk-insp [data-act="gw"]', 'la passerelle Ghost Writer');

  await cliquer(page, '.dk-insp [data-act="gw"]');
  await attendSel(page, '#gw-overlay .gw-modal', 'le modal Ghost Writer');

  // ── Défaut n° 6 : mode relecture, pas mode réécriture.
  check('le modal s\'ouvre en RELECTURE : aucune pastille de ton à choisir',
    !(await existe(page, '#gw-tones')));
  check('le bouton dit « Corriger le texte », pas « Réécrire en 3 variantes »',
    /Corriger le texte/.test(await texte(page, '#gw-go')));
  check('le texte de l\'article est chargé dans le modal',
    (await valeur(page, '#gw-source')) === COPIE_FAUTIVE);

  /* DK-9 · ce que le modal PROMET doit être ce que le moteur FAIT.
     L'ancien sous-titre jurait que « les mots de l'auteur sont préservés » :
     mesuré sur trois vrais papiers de L'Épaulette, vrai 37 fois sur 38.
     Le libellé annonce désormais les deux choses qui ne peuvent pas mentir —
     la découpe en paragraphes (rendue par le code) et le fait que rien
     n'entre dans l'article sans passer surligné sous les yeux de la
     rédactrice. Et un sous-titre qui déborde de son en-tête ne se lit pas :
     on mesure, on ne regarde pas. */
  const sousTitre = await page.evaluate(() => {
    const el = document.querySelector('#gw-overlay .gw-subtitle');
    if (!el) return null;
    const tete = el.closest('.gw-head');
    const r = el.getBoundingClientRect(), h = tete.getBoundingClientRect();
    return { txt: el.textContent.trim(), hauteur: Math.round(r.height),
             deborde: Math.round(Math.max(0, r.right - h.right) + Math.max(0, r.bottom - h.bottom)) };
  });
  check('le modal ne promet plus que « les mots sont préservés » — mesuré faux',
    !!sousTitre && !/mots de l'auteur sont préservés/.test(sousTitre.txt), sousTitre && sousTitre.txt);
  check('il annonce ce qui est garanti : les paragraphes gardés, chaque correction surlignée',
    !!sousTitre && /paragraphes sont gardés/.test(sousTitre.txt) && /surlignée/.test(sousTitre.txt),
    sousTitre && sousTitre.txt);
  check('et il tient dans son en-tête (0 px de débordement)',
    !!sousTitre && sousTitre.deborde === 0 && sousTitre.hauteur > 0, JSON.stringify(sousTitre));

  await cliquer(page, '#gw-go');
  await attend(page, () => !!document.querySelector('.gw-relec-bar') || !!document.querySelector('.gw-indicator'),
    null, 'le résultat de la relecture');

  const envoi = appels('POST', /^\/rewrite$/)[0];
  check('la commande part en relecture (action improve · longueur keep · 1 seule copie)',
    !!envoi && envoi.body.action === 'improve' && envoi.body.lengthTarget === 'keep' && envoi.body.variants === 1,
    envoi ? JSON.stringify({ action: envoi.body.action, lengthTarget: envoi.body.lengthTarget, variants: envoi.body.variants }) : 'aucun appel');
  check('une SEULE version est rendue — ni carrousel, ni indicateurs « 1 2 3 »',
    (await existe(page, '.gw-relec-bar')) && (await compter(page, '.gw-indicator')) === 0,
    'indicateurs : ' + await compter(page, '.gw-indicator'));
  check('le comparatif montre ce qui a été corrigé',
    (await compter(page, '.gw-diff-add')) > 0 || (await compter(page, '.gw-diff-del')) > 0);

  /* DK-9 · la typographie ne noie plus les vraies corrections.
     Mesuré sur un vrai papier : 54 corrections surlignées, UNE SEULE
     touchait un mot — les 53 autres étaient la même apostrophe. Ici la
     copie fautive porte exactement les deux natures : « coésion » →
     « cohésion » et « renforcé » → « renforcée » touchent un mot ;
     « deroulé » → « déroulé » n'ajoute qu'un accent. */
  check('le compteur annonce les corrections SUR LES MOTS, pas le total brut',
    /2 corrections sur les mots/.test(await texte(page, '.gw-relec-vue[data-vue="diff"]')),
    await texte(page, '.gw-relec-vue[data-vue="diff"]'));
  check('la typographie est comptée à part, et repliée par défaut',
    /typographie \(1\)/.test(await texte(page, '.gw-relec-typo'))
      && (await compter(page, '.gw-diff-typo')) === 0,
    await texte(page, '.gw-relec-typo'));
  check('les deux corrections qui touchent un mot restent surlignées',
    (await compter(page, '.gw-diff-add:not(.gw-diff-typo)')) === 2,
    'surlignées : ' + await compter(page, '.gw-diff-add:not(.gw-diff-typo)'));

  // Replier ne PERD rien : l'accent est bien appliqué à l'écran, en clair,
  // et la faute d'origine a disparu — c'est le texte qui sera repris.
  const zoneTxt = await texte(page, '[data-slot="relec"]');
  check('un accent corrigé s\'affiche corrigé, sans surlignage ni doublon',
    zoneTxt.includes('déroulé') && !zoneTxt.includes('deroulé'), zoneTxt.slice(0, 90));
  check('mais une vraie faute montre encore le mot d\'origine barré',
    zoneTxt.includes('coésion') && zoneTxt.includes('cohésion'), zoneTxt.slice(0, 90));

  await cliquer(page, '[data-slot="typo"]');
  await attendSel(page, '.gw-diff-typo', 'la typographie dépliée');
  check('la case dépliée montre la typographie, en sourdine',
    (await compter(page, '.gw-diff-typo')) > 0
      && (await compter(page, '.gw-diff-add:not(.gw-diff-typo)')) === 2,
    'typo : ' + await compter(page, '.gw-diff-typo'));
  await cliquer(page, '[data-slot="typo"]');
  await attendAbsence(page, '.gw-diff-typo', 'la typographie repliée à nouveau');

  // ── Défaut n° 6 (suite) : « Reprendre ce texte » réécrit RÉELLEMENT `notes`.
  await cliquer(page, '.gw-action-replace');
  // On attend la reprise CÔTÉ SERVEUR. Si elle ne réécrit rien — le défaut du
  // 4 août, où le bouton retombait sur le presse-papiers —, c'est l'assertion
  // qui doit le dire, pas un plantage du banc sur un modal resté ouvert.
  await attendCote(() => appels('PATCH', /^\/article\/art-copie$/).some(a => 'notes' in (a.body || {})), 5000);

  const patch = appels('PATCH', /^\/article\/art-copie$/).filter(a => 'notes' in (a.body || {}));
  check('la reprise écrit le texte corrigé côté serveur (PATCH notes)',
    patch.length === 1 && patch[0].body.notes === COPIE_RELUE,
    patch.length + ' PATCH avec notes');
  check('l\'article porte désormais le texte relu', artById('art-copie').notes === COPIE_RELUE);

  // …et l'éditeur affiche le texte corrigé.
  await attendSel(page, '.dk-insp [data-act="write"]', 'la fiche article rouverte');
  await cliquer(page, '.dk-insp [data-act="write"]');
  await attendSel(page, '.dk-writer.on [data-k="wrbody"]', 'l\'éditeur d\'article');
  check('l\'éditeur affiche le texte corrigé', (await valeur(page, '[data-k="wrbody"]')) === COPIE_RELUE);
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 5 · Les confirmations restent dans le cadre
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 5 — Confirmations dans le cadre', async () => {
  // Mesure le dépassement d'une confirmation par rapport au cadre défilant
  // du panneau. Renvoie AUSSI le dépassement qu'on aurait sans le guetteur
  // (panneau non défilé) : si celui-là est nul, le scénario ne prouve rien et
  // le banc doit le dire au lieu de passer au vert pour rien.
  async function mesurer(page, selDeclencheur, selBoite) {
    await page.evaluate(() => { const b = document.querySelector('.dk-insp-body'); if (b) b.scrollTop = 0; });
    await attendre(60);
    await cliquer(page, selDeclencheur);
    await attendSel(page, selBoite, 'la confirmation ' + selBoite);
    // Laisser le défilement doux se terminer.
    await page.evaluate(() => new Promise(res => {
      const b = document.querySelector('.dk-insp-body');
      let dernier = -1, stable = 0;
      const t = setInterval(() => {
        const y = b ? b.scrollTop : 0;
        if (y === dernier) stable++; else { stable = 0; dernier = y; }
        if (stable >= 5) { clearInterval(t); res(); }
      }, 60);
      setTimeout(() => { clearInterval(t); res(); }, 3000);
    }));
    return page.evaluate(s => {
      const boite = document.querySelector(s);
      const cadre = document.querySelector('.dk-insp-body');
      const b = boite.getBoundingClientRect(), c = cadre.getBoundingClientRect();
      const dehors = Math.max(0, Math.round(b.bottom - c.bottom)) + Math.max(0, Math.round(c.top - b.top));
      const hautDansLeFlux = (b.top - c.top) + cadre.scrollTop;
      return {
        dehors,
        sansGuetteur: Math.round(hautDansLeFlux + b.height - cadre.clientHeight),
      };
    }, selBoite);
  }

  const verdict = (nom, r) => {
    check(`${nom} — la question est entièrement dans le cadre`, r.dehors === 0, r.dehors + ' px hors cadre');
    check(`${nom} — le scénario est réel (sans le guetteur, elle serait sous le pli)`,
      r.sansGuetteur > 0, 'dépassement sans défilement : ' + r.sansGuetteur + ' px');
  };

  await ouvrirLePad(page, BASE);
  await cliquer(page, '[data-slot="view"] [data-v="marbre"]');
  await attendSel(page, '.dk-mrow[data-a="art-copie"]', 'la ligne de l\'article');
  await cliquer(page, '.dk-mrow[data-a="art-copie"]');
  await attendSel(page, '.dk-insp [data-act="delart"]', 'la fiche article');

  verdict('supprimer un article', await mesurer(page, '.dk-insp [data-act="delart"]', '.dk-insp .dk-confirm'));
  await cliquer(page, '.dk-insp [data-act="delno"]');
  await attendAbsence(page, '.dk-insp .dk-confirm', 'la confirmation annulée');

  verdict('abandonner un article', await mesurer(page, '.dk-insp [data-act="abandon"]', '.dk-insp .dk-confirm'));
  await cliquer(page, '.dk-insp [data-act="abno"]');
  await attendAbsence(page, '.dk-insp .dk-confirm', 'la confirmation annulée');

  // Dernière pièce du casier : celle qui est le plus bas dans le panneau.
  const derniereP = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.dk-insp [data-delf]')].pop();
    return b ? b.dataset.delf : null;
  });
  check('la fiche article liste bien ses pièces', !!derniereP);
  verdict('supprimer une pièce du casier',
    await mesurer(page, `.dk-insp [data-delf="${derniereP}"]`, '.dk-insp .dk-file-confirm'));
  await cliquer(page, '.dk-insp [data-delno]');
  await attendSel(page, '.dk-insp [data-delf]', 'la fiche article restaurée');

  // Bannette : la dernière ligne de la liste.
  await cliquer(page, '.dk-insp [data-act="close"]');
  await attendre(180);
  await cliquer(page, '[data-act="bannette"]');
  await attendSel(page, '.dk-insp [data-suppr]', 'la bannette');
  const dernierC = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.dk-insp [data-suppr]')].pop();
    return b ? b.dataset.suppr : null;
  });
  verdict('effacer un courrier depuis la bannette',
    await mesurer(page, `.dk-insp [data-suppr="${dernierC}"]`, '.dk-insp .dk-file-confirm'));

  // Réglages : passer le numéro en « imprimé ».
  await cliquer(page, '[data-act="settings"]');
  await attendSel(page, '.dk-insp [data-k="istatus"]', 'les réglages');
  await page.evaluate(() => { document.querySelector('.dk-insp-body').scrollTop = 0; });
  await attendre(60);
  await choisir(page, '.dk-insp [data-k="istatus"]', 'imprime');
  await attendSel(page, '.dk-insp .dk-confirm', 'la confirmation du bouclage');
  await page.evaluate(() => new Promise(res => {
    const b = document.querySelector('.dk-insp-body');
    let dernier = -1, stable = 0;
    const t = setInterval(() => {
      const y = b ? b.scrollTop : 0;
      if (y === dernier) stable++; else { stable = 0; dernier = y; }
      if (stable >= 5) { clearInterval(t); res(); }
    }, 60);
    setTimeout(() => { clearInterval(t); res(); }, 3000);
  }));
  const rImp = await page.evaluate(() => {
    const boite = document.querySelector('.dk-insp .dk-confirm');
    const cadre = document.querySelector('.dk-insp-body');
    const b = boite.getBoundingClientRect(), c = cadre.getBoundingClientRect();
    return {
      dehors: Math.max(0, Math.round(b.bottom - c.bottom)) + Math.max(0, Math.round(c.top - b.top)),
      sansGuetteur: Math.round((b.top - c.top) + cadre.scrollTop + b.height - cadre.clientHeight),
    };
  });
  verdict('passer le numéro en « imprimé »', rImp);
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 6 · DK-8 — ce que la porte d'entrée doit DIRE à l'écran

   Le worker est gardé par workers/test/test-desk-dk8-porte.mjs (l'avalanche
   de 300, le SPF en échec). Ici on vérifie la seule moitié qu'un banc de
   worker ne peut pas voir : que la rédactrice, elle, l'apprenne — la
   mention « expéditeur non authentifié » sur le pli à trier, et le sort
   « mise de côté » sur celui que le bac débordant n'a pas pu accueillir.
   Un avertissement présent dans le HTML mais invisible ne compte pas :
   on mesure sa hauteur rendue.
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 6 — DK-8 · la porte d\'entrée', async () => {
  await ouvrirLePad(page, BASE);   // monde neuf…

  // … puis les deux plis que seul DK-8 sait produire, et on recharge le pad
  // SANS remettre le monde à zéro (ouvrirLePad le ferait).
  DB.inbox.unshift(
    { id: 'in-usurpe', pub_id: 'pub-1',
      from_email: 'd.mahieu@exemple.fr', from_name: 'Col. D. Mahieu',
      orig_email: null, orig_name: null,
      subject: 'Ma copie — le stage de cohésion (2)',
      body: 'Voici la copie promise.',
      suggestion: JSON.stringify({ kind: 'article', art_id: 'art-copie', via: 'expediteur' }),
      attachments: '[]',
      status: 'pending', art_id: null, resolved_by: null, resolved_at: null,
      received_at: SQL_NOW(-2), lu_at: null,
      auth: 'fail', auth_detail: 'spf=fail dkim=none dmarc=fail' },
    { id: 'in-decote', pub_id: 'pub-1',
      from_email: 's.royer@exemple.fr', from_name: 'Mme S. Royer',
      orig_email: null, orig_name: null,
      subject: 'Mon papier, désolée du retard',
      body: 'Je vous l\'envoie enfin.',
      suggestion: JSON.stringify({ via: 'aucune' }), attachments: '[]',
      status: 'differe', art_id: null, resolved_by: null, resolved_at: null,
      received_at: SQL_NOW(-1), lu_at: null, auth: null, auth_detail: null },
  );
  await page.goto(BASE + '/__dk7-harnais.html', { waitUntil: 'domcontentloaded' });
  await attendSel(page, '.dk-frise .dk-pcard', 'le pad rechargé avec les plis DK-8');
  await attendre(120);

  // ── Le bac « À trier » : la mention doit être LÀ, et VISIBLE.
  await cliquer(page, '[data-act="bac"]');
  await attendSel(page, '.dk-insp [data-bac="in-usurpe"]', 'le pli non authentifié dans le bac');
  check('le pli non authentifié est signalé dès la liste du bac',
    await existe(page, '.dk-insp [data-bac="in-usurpe"]')
      && /non authentifi/i.test(await texte(page, '.dk-insp .dk-banc-item .dk-bac-suspect')));

  await cliquer(page, '.dk-insp [data-bac="in-usurpe"]');
  await attendSel(page, '.dk-insp [data-act="bacok"]', 'le panneau de TRI du pli non authentifié');
  const alerte = await page.evaluate(() => {
    const el = document.querySelector('.dk-insp .dk-bac-alert');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { txt: el.textContent, h: Math.round(r.height), w: Math.round(r.width) };
  });
  check('le panneau de tri porte l\'avertissement d\'authentification', !!alerte, 'aucun .dk-bac-alert');
  check('l\'avertissement nomme les contrôles qui ont lâché',
    !!alerte && /SPF\/DKIM/.test(alerte.txt) && /usurp/i.test(alerte.txt), alerte && alerte.txt.slice(0, 120));
  check('il rapporte le détail constaté à l\'arrivée',
    !!alerte && /spf=fail/.test(alerte.txt), alerte && alerte.txt.slice(0, 160));
  check('et il est réellement VISIBLE (hauteur rendue > 0)',
    !!alerte && alerte.h > 0 && alerte.w > 0, JSON.stringify(alerte));
  // Le travail de la digestion n'est pas jeté pour autant : la cible reste
  // proposée, c'est l'humain qui tranche — c'est tout l'objet du garde-fou.
  check('la cible reste proposée à la rédactrice (on demande un humain, on ne perd rien)',
    /stage de coh/i.test(await texte(page, '.dk-insp .dk-bac-choice')));

  // ── La bannette : le pli mis de côté est visible, nommé, et triable.
  await cliquer(page, '[data-act="bannette"]');
  await attendSel(page, '.dk-insp [data-bac="in-decote"]', 'le pli mis de côté dans la bannette');
  check('la bannette dit qu\'une contribution a été mise de côté, et pourquoi',
    /mise de c/i.test(await texte(page, '.dk-insp .dk-bac-alert'))
      && /bac d[ée]bordait/i.test(await texte(page, '.dk-insp .dk-bac-alert')),
    await texte(page, '.dk-insp .dk-bac-alert'));
  const ligne = await page.evaluate(() => {
    const b = document.querySelector('[data-bac="in-decote"]');
    const item = b && b.closest('.dk-banc-item');
    return item ? { sort: (item.querySelector('.dk-bac-sort') || {}).textContent || '', bouton: b.textContent.trim() } : null;
  });
  check('sa ligne annonce « mise de côté », pas « écartée » ni « rattachée »',
    !!ligne && /mise de c/i.test(ligne.sort) && !/écart|rattach/i.test(ligne.sort), JSON.stringify(ligne));
  check('et son bouton propose de la TRIER — de côté n\'est pas un sort, c\'est une file',
    !!ligne && ligne.bouton === 'Trier', JSON.stringify(ligne));

  // Le piège du 4 août, rejoué : le pli mis de côté doit ouvrir le panneau de
  // TRI (qui sait rattacher et poser en page), pas celui de reprise.
  await cliquer(page, '.dk-insp [data-bac="in-decote"]');
  await attendSel(page, '.dk-insp [data-act="bacok"]', 'le panneau de tri du pli mis de côté');
  check('un pli mis de côté ouvre le panneau de TRI, pas celui de reprise',
    await existe(page, '.dk-insp [data-act="bacok"]') && !await existe(page, '.dk-insp [data-act="reprendre"]'));
  check('et il explique qu\'elle n\'a jamais été refusée à son auteur',
    /jamais été refusée/i.test(await texte(page, '.dk-insp')));
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 7 · DK-10 — la co-équipière dont l'invitation n'a pas pris

   Une invitation desK s'accepte par CORRESPONDANCE D'ADRESSE : au
   bootstrap, le worker cherche `dk_invites.email = claims.email`. Si la
   rédactrice en chef ouvre desK avec une licence dont l'adresse n'est
   pas celle qui a été invitée — une faute de frappe, une adresse
   personnelle au lieu de la professionnelle —, elle n'a AUCUNE
   publication. Et l'écran qu'elle reçoit alors est le même que celui
   d'un desK tout neuf : « Votre rédaction vous attend. Créez. »

   Elle créerait donc une SECONDE revue à côté de celle de l'équipe, y
   travaillerait, et personne ne verrait l'erreur avant longtemps. Le
   pire des ratés : celui qui ressemble à un succès. L'écran doit dire
   avec quelle adresse on est connecté.
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 7 — DK-10 · l\'invitation qui n\'a pas pris', async () => {
  await ouvrirLePad(page, BASE);
  DB.sansPub = true;                       // aucune publication pour cette adresse
  await page.goto(BASE + '/__dk7-harnais.html', { waitUntil: 'domcontentloaded' });
  await attendSel(page, '.dk-hero', 'l\'écran d\'accueil vide');

  check('sans publication, desK propose bien d\'en créer une',
    /Votre rédaction vous attend/.test(await texte(page, '.dk-hero h2')));
  const qui = await page.evaluate(() => {
    const el = document.querySelector('.dk-hero-qui');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { txt: el.textContent.replace(/\s+/g, ' ').trim(), h: Math.round(r.height) };
  });
  check('mais il NOMME l\'adresse de connexion — sans quoi l\'erreur est indétectable',
    !!qui && qui.txt.includes('ui@test.dk'), qui && qui.txt.slice(0, 120));
  check('et il prévient qu\'une revue créée ici serait une SECONDE revue',
    !!qui && /seconde/i.test(qui.txt) && /invit/i.test(qui.txt), qui && qui.txt.slice(0, 200));
  check('l\'avertissement est réellement visible (hauteur rendue > 0)',
    !!qui && qui.h > 0, JSON.stringify(qui));
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 8 · DK-10 — vider le casier, à la main et en connaissance

   Jusqu'au 2026-08-05, les pièces d'un numéro partaient toutes seules
   30 jours après son passage en « imprimé » : personne ne l'avait
   demandé, personne n'était prévenu, et les objets sont détruits pour
   de bon. Sur une revue dont le cycle chevauche le numéro suivant, un
   mois après l'impression est encore tôt — un erratum, un retirage, une
   photo à repiquer, et la pièce n'est plus là.

   Désormais rien ne part sans un clic. Et le clic doit être ÉCLAIRÉ :
   on demande d'abord au serveur ce qui partirait, on l'affiche en
   toutes lettres, et seulement ensuite on efface. Un « êtes-vous
   sûr ? » sans contenu ne protège de rien.
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 8 — DK-10 · vider le casier à la main', async () => {
  await ouvrirLePad(page, BASE);

  // Une pièce posée sur une PAGE du numéro (les 8 autres sont au marbre).
  const pageCible = DB.pages.find(p => p.n === 3);
  DB.files.push({ id: 'fi-page', issue_id: DB.issue.id, page_id: pageCible.id, art_id: null,
    name: 'gabarit-imprimeur.pdf', mime: 'application/pdf', size: 1600000,
    status: 'ok', uploaded_by: 'Stéphane', created_at: SQL_NOW(-40) });

  await cliquer(page, '[data-act="settings"]');
  await attendSel(page, '.dk-insp [data-k="istatus"]', 'les réglages');
  check('tant que le numéro est en fabrication, pas de bouton pour vider',
    !(await existe(page, '.dk-insp [data-act="purgecasier"]')));

  // On boucle le numéro.
  await choisir(page, '.dk-insp [data-k="istatus"]', 'imprime');
  await attendSel(page, '.dk-insp .dk-confirm', 'la confirmation du bouclage');
  await cliquer(page, '.dk-insp .dk-confirm .dk-btn.primary');
  await attendre(400);
  await cliquer(page, '[data-act="settings"]');
  await attendSel(page, '.dk-insp [data-act="purgecasier"]', 'le bouton de purge');
  check('une fois imprimé, desK propose de vider son casier',
    await existe(page, '.dk-insp [data-act="purgecasier"]'));

  // Premier temps : ce qui partirait, nommé — sans rien effacer.
  const avant = DB.files.length;
  await cliquer(page, '.dk-insp [data-act="purgecasier"]');
  await attendSel(page, '.dk-insp [data-act="purgeyes"]', 'l\'annonce de ce qui partirait');
  const annonce = await texte(page, '.dk-insp [data-slot="purgebox"]');
  check('l\'annonce NOMME le fichier qui va disparaître',
    annonce.includes('gabarit-imprimeur.pdf'), annonce.slice(0, 140));
  check('elle chiffre aussi le poids libéré', /1[,.]5|1[,.]6|Mo/.test(annonce), annonce.slice(0, 140));
  check('et elle dit que l\'effacement est définitif',
    /définitiv/i.test(annonce), annonce.slice(0, 200));
  check('rien n\'a encore été effacé à ce stade', DB.files.length === avant,
    `${avant} → ${DB.files.length}`);

  // On peut se raviser.
  await cliquer(page, '.dk-insp [data-act="purgeno"]');
  await attendAbsence(page, '[data-act="purgeyes"]', 'l\'annonce refermée');
  check('annuler ne touche à rien', DB.files.length === avant);

  // Second temps : pour de vrai.
  await cliquer(page, '.dk-insp [data-act="purgecasier"]');
  await attendSel(page, '.dk-insp [data-act="purgeyes"]', 'l\'annonce, à nouveau');
  await cliquer(page, '.dk-insp [data-act="purgeyes"]');
  await attendCote(() => !DB.files.some(f => f.id === 'fi-page'), 4000);
  check('la pièce posée en page a bien été effacée',
    !DB.files.some(f => f.id === 'fi-page'), DB.files.map(f => f.id).join(','));
  check('les pièces au marbre, elles, n\'ont pas bougé',
    DB.files.filter(f => f.page_id === '').length === 8,
    'restantes au marbre : ' + DB.files.filter(f => f.page_id === '').length);
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 9 · Le chemin de fer qui remontait tout seul (5 août 2026)

   Signalé par Stéphane : « au bout de quelques secondes sur le chemin
   de fer, saut vers le haut de la page ». _renderFer() remplace tout
   le contenu principal ; le conteneur QUI DÉFILE est donc détruit et
   recréé. _renderFrise() croyait sauvegarder la position en lisant
   f.scrollTop — mais il lisait le conteneur NEUF, qui vaut 0. Deux
   déclencheurs, tous deux invisibles : le premier chargement (cache
   rendu tout de suite, puis serveur) et le rafraîchissement d'équipe
   toutes les 45 s. On travaillait, la page remontait.

   Le parcours emprunte le MÊME chemin de code que le sondage
   (visibilitychange → _loadIssue(true) → _renderFer).
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 9 — le chemin de fer qui remontait tout seul', async () => {
  await ouvrirLePad(page, BASE);

  // Cartes au plus grand cran : sur 640 px de haut, la frise déborde à coup sûr.
  await page.evaluate(() => {
    const s = document.querySelector('[data-k="size"]');
    s.value = '3'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await attendre(200);
  const deborde = await page.evaluate(() => {
    const f = document.querySelector('.dk-frise');
    return f.scrollHeight - f.clientHeight;
  });
  check('la frise déborde vraiment (sans quoi le parcours ne prouverait rien)',
    deborde > 120, 'débordement mesuré : ' + deborde + ' px');

  await page.evaluate(() => { document.querySelector('.dk-frise').scrollTop = 200; });
  await attendre(100);
  check('on est bien descendu dans le chemin de fer',
    (await page.evaluate(() => document.querySelector('.dk-frise').scrollTop)) >= 190);

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await attendre(700);
  const apres = await page.evaluate(() => document.querySelector('.dk-frise').scrollTop);
  check('après un rafraîchissement d\'équipe, la frise est restée où on l\'avait laissée',
    apres >= 190, 'scrollTop après rafraîchissement : ' + apres);

  // Et le chemin de fer a bien été re-rendu (sinon on aurait juste prouvé
  // qu'il ne se passe rien du tout).
  check('le rafraîchissement a bien eu lieu (le numéro a été redemandé)',
    appels('GET', /^\/issue\/iss-1$/).length >= 2,
    'appels /issue : ' + appels('GET', /^\/issue\/iss-1$/).length);
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 10 · Poser un dossier sur plusieurs pages (5 août 2026)

   Demandé par Stéphane : « j'aimerais pouvoir placer un article sur
   une ou plusieurs pages ». C'était possible — mais seulement par un
   lasso sur la frise (Maj+clic) puis « Étaler un article » dans la
   barre de sélection. Le geste naturel est l'inverse : on est sur la
   page, on choisit l'article, on dit qu'il fait quatre pages.
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 10 — poser un dossier sur plusieurs pages', async () => {
  await ouvrirLePad(page, BASE);

  // Page n° 4 (folio 2) : libre, et onze pages libres la suivent.
  await cliquer(page, '.dk-frise .dk-pcard[data-n="4"]');
  await attendSel(page, '.dk-insp [data-act="reserve"]', 'la fiche d\'emplacement libre');

  check('la fiche demande sur combien de pages poser l\'article',
    await existe(page, '.dk-insp [data-k="span"]'));
  const options = await textesDe(page, '.dk-insp [data-k="span"] option');
  check('et elle NOMME les pages que le dossier occuperait',
    (options[2] || '') === '3 pages (p. 2–4)', options.slice(0, 4).join(' | '));

  await choisir(page, '.dk-insp [data-k="span"]', '3');
  await cliquer(page, '.dk-insp [data-act="reserve"]');
  await attendCote(() => DB.slots.filter(s => s.art_id === 'art-copie').length === 3, 5000);

  const pris = DB.slots.filter(s => s.art_id === 'art-copie').map(s => DB.pages.find(p => p.id === s.page_id).n).sort((a, b) => a - b);
  check('l\'article occupe les trois pages demandées', String(pris) === '4,5,6', 'pages : ' + pris.join(','));
  check('et pas une de plus', DB.slots.filter(s => s.art_id === 'art-copie').length === 3);

  // La frise le dit : les pages suivantes portent la mention « suite ».
  await attendSel(page, '.dk-frise .dk-pcard[data-n="6"] .dk-pc-rub', 'la carte de la 3e page');
  check('les pages suivantes sont marquées « suite » sur la frise',
    /suite/.test(await texte(page, '.dk-frise .dk-pcard[data-n="6"] .dk-pc-rub')),
    await texte(page, '.dk-frise .dk-pcard[data-n="6"] .dk-pc-rub'));

  // Prolonger depuis la fiche de l'article, sans lasso ni sélection multiple.
  await cliquer(page, '.dk-frise .dk-pcard[data-n="4"]');
  await attendSel(page, '.dk-insp [data-act="spread"]', 'le bouton d\'étalement');
  check('la fiche annonce que c\'est un dossier de 3 pages',
    /dossier de 3 pages/.test(await texte(page, '.dk-insp .dk-insp-rub')),
    await texte(page, '.dk-insp .dk-insp-rub'));

  await cliquer(page, '.dk-insp [data-act="spread"]');
  await attendSel(page, '.dk-insp [data-k="ext"]', 'le choix des pages à ajouter');
  const ext = await textesDe(page, '.dk-insp [data-k="ext"] option');
  check('l\'étalement repart APRÈS la dernière page du dossier',
    (ext[0] || '') === '1 page (p. 5)', ext.slice(0, 3).join(' | '));

  await choisir(page, '.dk-insp [data-k="ext"]', '2');
  await cliquer(page, '.dk-insp [data-act="extok"]');
  await attendCote(() => DB.slots.filter(s => s.art_id === 'art-copie').length === 5, 5000);
  const pris2 = DB.slots.filter(s => s.art_id === 'art-copie').map(s => DB.pages.find(p => p.id === s.page_id).n).sort((a, b) => a - b);
  check('le dossier court maintenant sur cinq pages consécutives',
    String(pris2) === '4,5,6,7,8', 'pages : ' + pris2.join(','));

  // Garde-fou : une page déjà occupée arrête la suite. La page 3 porte
  // « Le mot du président » — un dossier posé en 2 ne doit pas l'écraser.
  // Attendre que le front ait fini de se re-rendre (sinon le clic suivant est
  // écrasé par la réouverture de fiche qui suit le rechargement du numéro).
  await attend(page, () => /dossier de 5 pages/.test(document.querySelector('.dk-insp .dk-insp-rub')?.textContent || ''),
    null, 'la fiche remise à jour sur 5 pages');
  await cliquer(page, '.dk-frise .dk-pcard[data-n="2"]');
  await attendSel(page, '.dk-insp [data-act="newarthere"]', 'la fiche de la page 2');
  check('devant une page occupée, aucune longueur n\'est proposée',
    !(await existe(page, '.dk-insp [data-k="span"]')));
});

/* ─────────────────────────────────────────────────────────────────
   PARCOURS 11 · Rubrique sous la main, pages NOMMÉES (5 août 2026)

   Deux retours de Stéphane le même soir :
   · corriger la rubrique d'un article posé obligeait à rouvrir « Modifier
     la fiche » — alors que c'est la COULEUR de la carte dans le chemin de
     fer, le geste le plus courant du bouclage ;
   · réserver depuis le marbre passait par une grille de numéros nus. Sur
     un 64 pages, un damier de 64 cases où rien ne dit ce qu'il y a page
     53. La liste du tri du courrier, elle, nomme la page ET sa rubrique.
   ───────────────────────────────────────────────────────────────── */
await parcours('Parcours 11 — rubrique sous la main, pages nommées', async () => {
  await ouvrirLePad(page, BASE);

  // ── La rubrique se change depuis la fiche de la page, sans formulaire.
  await cliquer(page, '.dk-frise .dk-pcard[data-n="3"]');
  await attendSel(page, '.dk-insp [data-k="artrub"]', 'le sélecteur de rubrique');
  check('la fiche d\'un article posé porte son sélecteur de rubrique',
    await existe(page, '.dk-insp [data-k="artrub"]'));
  check('il montre la rubrique actuelle', (await valeur(page, '.dk-insp [data-k="artrub"]')) === 'rub-unites');

  await choisir(page, '.dk-insp [data-k="artrub"]', 'rub-histoire');
  await attendCote(() => DB.articles.find(a => a.id === 'art-place').rub_id === 'rub-histoire', 5000);
  check('changer la rubrique l\'écrit tout de suite',
    DB.articles.find(a => a.id === 'art-place').rub_id === 'rub-histoire',
    'rub_id : ' + DB.articles.find(a => a.id === 'art-place').rub_id);
  const envoi = appels('PATCH', /^\/article\/art-place$/).filter(x => 'rub_id' in (x.body || {}));
  check('un seul appel, et il ne porte QUE la rubrique',
    envoi.length === 1 && Object.keys(envoi[0].body).join() === 'rub_id',
    JSON.stringify(envoi.map(x => x.body)));
  await attend(page, () => /Histoire/.test(document.querySelector('.dk-frise .dk-pcard[data-n="3"] .dk-pc-rub')?.textContent || ''),
    null, 'la carte repeinte dans la frise');
  check('et la carte du chemin de fer change de rubrique sans recharger',
    /Histoire/.test(await texte(page, '.dk-frise .dk-pcard[data-n="3"] .dk-pc-rub')));

  // ── Réserver depuis le marbre : des pages nommées, plus une grille.
  await cliquer(page, '[data-slot="view"] [data-v="marbre"]');
  await attendSel(page, '.dk-mrow[data-a="art-copie"]', 'le marbre');
  await cliquer(page, '.dk-mrow[data-a="art-copie"]');
  await attendSel(page, '.dk-insp [data-k="mpage"]', 'le choix de page');

  check('la grille de numéros nus a disparu', !(await existe(page, '.dk-insp .dk-pagepick')));
  const opts = await textesDe(page, '.dk-insp [data-k="mpage"] option');
  check('chaque page est NOMMÉE avec sa rubrique en face',
    opts.includes('page 3 — Actualités'), opts.slice(0, 6).join(' | '));
  const groupes = await textesDe(page, '.dk-insp [data-k="mpage"] optgroup');
  check('les pages déjà occupées sont à part, et disent qui les occupe',
    (await page.evaluate(() => [...document.querySelectorAll('[data-k="mpage"] optgroup')]
      .find(g => /occupées/.test(g.label))?.textContent || '')).includes('Le mot du président'),
    groupes.length + ' groupes');

  check('rien n\'est réservable tant qu\'aucune page n\'est choisie',
    await page.evaluate(() => document.querySelector('[data-act="reservepage"]').disabled));

  // La page 9 (folio 7) porte la rubrique « Actualités » en pré-assignation.
  const cible = DB.pages.find(p => p.n === 9);
  await choisir(page, '.dk-insp [data-k="mpage"]', cible.id);
  check('choisir une page arme le bouton',
    !(await page.evaluate(() => document.querySelector('[data-act="reservepage"]').disabled)));
  await cliquer(page, '.dk-insp [data-act="reservepage"]');
  await attendCote(() => DB.slots.some(s => s.art_id === 'art-copie' && s.page_id === cible.id), 5000);
  check('l\'article est posé sur la page choisie',
    DB.slots.some(s => s.art_id === 'art-copie' && s.page_id === cible.id));
});

/* ─────────────────────────────────────────────────────────────────
   Hygiène : aucune erreur JS n'a été avalée en chemin.
   ───────────────────────────────────────────────────────────────── */
console.log('\n\x1b[1m▶ Hygiène\x1b[0m');
{
  const graves = erreursPage.filter(e => !/favicon|LOGOS|ERR_/.test(e));
  check('aucune erreur JavaScript pendant les onze parcours', graves.length === 0,
    graves.slice(0, 4).join(' | '));
}

} finally {
  await navigateur.close();
  srv.close();
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} vérifications — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
if (failed) console.error('\nÉchecs :\n  - ' + echecs.join('\n  - '));
process.exit(failed ? 1 : 0);
