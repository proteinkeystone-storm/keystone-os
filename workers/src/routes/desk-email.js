/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — desK · DK-4 : l'adresse de dépôt & la digestion
   (DESK_BRIEF §5.2-5.3 — les contributeurs restent dans l'e-mail)

   Une adresse PAR publication : <slug>@<DK_EMAIL_DOMAIN> — le domaine
   porte déjà « redaction » (redaction-pks.com), donc l'avant-@ = le
   slug seul (ex. l-epaulette@redaction-pks.com). Cloudflare Email
   Routing (catch-all *@) route vers le handler email() du worker →
   parse MIME (postal-mime) → digestion.

   LA DIGESTION — 3 étages, du sûr vers l'incertain :
   1. RAPPROCHEMENT DÉTERMINISTE (gratuit, ~80 % du flux) :
      expéditeur = contributeur connu qui doit UN article → pointage
      automatique (« copie reçue »), pièces jointes → casier de la
      page, corps du mail → notes de l'article. Trace status 'auto'.
   2. SUGGESTION (le reste) : titres attendus vs objet/noms de
      fichiers (recoupement lexical, gratuit) ; habitudes apprises
      (dk_habits, déterministe) ; sinon IA légère via callLLM —
      rubrique choisie dans la LISTE FERMÉE de la publication.
   3. BAC « À TRIER » (jamais contourné) : tout doute → entrée
      pending, suggestion pré-cochée, confirmation humaine 1 clic.
      AUCUN rangement douteux et silencieux. Chaque confirmation
      apprend : e-mail du contributeur (dk_contribs) ou règle
      « mails de X → rubrique Y » (dk_habits).

   Spontanés (papier non prévu) → entrent AU MARBRE à la confirmation.
   Le pointage auto annule la relance calculée de lui-même (DK-3).

   ⚠ TENANT = LA PUBLICATION, porté par l'ADRESSE (le slug). Aucune
   donnée d'un autre tenant n'est jamais consultée.
   ═══════════════════════════════════════════════════════════════ */

import PostalMime from 'postal-mime';
import { json, err, parseBody, generateId, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { callLLM } from '../lib/llm-router.js';
import { recordUsage } from '../lib/ai-budget.js';
import { ensureDeskSchema, dkMemberGate, dkHistoPush, dkS, dkFileExt, dkFileName,
         dkByName, dkContribStats, DK_FILE_EXTS, DK_FILE_MAX, DK_MAX_NAME,
         DK_MAX_TITLE, DK_MAX_NOTES } from './desk.js';

const MAX_BODY_KEEP   = 20000;   // corps conservé dans le bac / versé aux notes
const MAX_ATTACHMENTS = 10;      // pièces jointes traitées par e-mail
const MAX_INBOX_PENDING = 200;   // garde-fou par publication
const FUZZY_MIN_SCORE = 0.6;     // recoupement lexical minimal titre ↔ objet/fichiers

/* ═══════════════ Le handler e-mail Cloudflare ═══════════════════
   Branché dans index.js : `async email(message, env, ctx)`. Adresse
   inconnue ou message illisible → rejet SMTP poli (l'expéditeur est
   prévenu, rien ne se perd en silence).                             */
export async function handleDeskEmail(message, env, ctx) {
  let mail;
  try {
    const parsed = await PostalMime.parse(message.raw);
    mail = {
      to: String(message.to || '').toLowerCase(),
      fromEmail: String(parsed.from?.address || message.from || '').toLowerCase().trim(),
      fromName: parsed.from?.name || null,
      subject: parsed.subject || '',
      text: parsed.text || _htmlToText(parsed.html || ''),
      attachments: (parsed.attachments || []).slice(0, MAX_ATTACHMENTS).map(a => ({
        name: a.filename || 'piece', mime: a.mimeType || '', content: new Uint8Array(a.content),
      })),
    };
  } catch (_) {
    try { message.setReject('Message illisible'); } catch (_) {}
    return;
  }
  const r = await digestEmail(env, mail).catch(e => ({ ok: false, reason: e && e.message }));
  if (!r.ok) { try { message.setReject(r.reason === 'adresse' ? 'Adresse de dépôt inconnue' : 'Dépôt refusé'); } catch (_) {} }
}

function _htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/* ═══════════════ La digestion (cœur, testable à sec) ════════════ */
export async function digestEmail(env, mail) {
  await ensureDeskSchema(env);

  // L'adresse porte le tenant : <slug>@… → publication (le domaine
  // porte déjà « redaction »). Sous-adressage toléré (slug+detail@).
  const m = /^([a-z0-9-]+)(?:\+[^@]*)?@/.exec(String(mail.to || '').toLowerCase());
  if (!m) return { ok: false, reason: 'adresse' };
  const pub = await env.DB.prepare('SELECT id, name FROM dk_publications WHERE slug = ?').bind(m[1]).first();
  if (!pub) return { ok: false, reason: 'adresse' };
  const pubId = pub.id;

  const pending = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM dk_inbox WHERE pub_id = ? AND status = 'pending'`).bind(pubId).first())?.n || 0;
  if (pending >= MAX_INBOX_PENDING) return { ok: false, reason: 'bac plein' };

  const fromEmail = String(mail.fromEmail || '').toLowerCase().trim();
  const subject = dkS(String(mail.subject || '').trim(), 300) || '';
  const body = String(mail.text || '').slice(0, MAX_BODY_KEEP);
  const inboxId = generateId();

  // Pièces jointes → R2 sous le préfixe du bac (whitelist DK-3, cap taille).
  // Elles ne deviennent des pièces du CASIER qu'au rattachement.
  const atts = [];
  for (const a of (mail.attachments || []).slice(0, MAX_ATTACHMENTS)) {
    const ext = dkFileExt(a.name);
    if (!DK_FILE_EXTS[ext] || !env.DK_CASIER) continue;
    const bytes = a.content;
    if (!bytes || !bytes.length || bytes.length > DK_FILE_MAX) continue;
    const key = `dk-casier/${pubId}/inbox/${inboxId}/${generateId()}.${ext}`;
    try {
      await env.DK_CASIER.put(key, bytes, { httpMetadata: { contentType: DK_FILE_EXTS[ext] } });
      atts.push({ name: dkFileName(a.name), mime: DK_FILE_EXTS[ext], size: bytes.length, r2_key: key });
    } catch (_) {}
  }

  // Candidats = articles dont la copie est encore attendue.
  const candidates = (await env.DB.prepare(
    `SELECT id, title, rub_id, contrib, due, notes FROM dk_articles
     WHERE pub_id = ? AND status IN ('propose', 'attendu') ORDER BY updated_at DESC LIMIT 200`).bind(pubId).all()).results || [];

  /* ── Étage 1 · rapprochement déterministe ──────────────────────
     Expéditeur connu (dk_contribs.email) → SES articles attendus.
     Un seul → direct ; plusieurs → départage lexical franc.        */
  let suggestion = null;
  if (fromEmail) {
    const names = ((await env.DB.prepare('SELECT name FROM dk_contribs WHERE pub_id = ? AND email = ?').bind(pubId, fromEmail).all()).results || [])
      .map(r => (r.name || '').toLowerCase());
    if (names.length) {
      const mine = candidates.filter(a => names.includes((a.contrib || '').toLowerCase()));
      let pick = mine.length === 1 ? mine[0] : null;
      if (!pick && mine.length > 1) pick = _fuzzyPick(mine, subject, atts);
      if (pick) {
        // Article ciblé sans ambiguïté. Posé sur une page → rattachement AUTO.
        const slot = await env.DB.prepare(
          `SELECT s.page_id, p.issue_id, p.n FROM dk_page_slots s JOIN dk_pages p ON p.id = s.page_id
           WHERE s.art_id = ? ORDER BY p.n LIMIT 1`).bind(pick.id).first();
        if (slot) {
          await _rattacher(env, { pubId, art: pick, pageId: slot.page_id, issueId: slot.issue_id, pageN: slot.n, atts, body, fromEmail, fromName: mail.fromName, by: 'digestion' });
          await env.DB.prepare(
            `INSERT INTO dk_inbox (id, pub_id, from_email, from_name, subject, body, suggestion, attachments, status, resolved_by, resolved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto', 'digestion', datetime('now'))`)
            .bind(inboxId, pubId, fromEmail, dkS(mail.fromName, DK_MAX_NAME), subject, body.slice(0, 2000),
              JSON.stringify({ kind: 'article', art_id: pick.id, via: 'expediteur', page_n: slot.n }), JSON.stringify(atts)).run();
          return { ok: true, mode: 'auto', inboxId, art_id: pick.id };
        }
        // Pas encore en page → bac, suggestion franche pré-cochée.
        suggestion = { kind: 'article', art_id: pick.id, via: 'expediteur' };
      } else if (mine.length > 1) {
        suggestion = { kind: 'article', art_id: mine[0].id, via: 'expediteur-ambigu', candidates: mine.slice(0, 8).map(a => a.id) };
      }
    }
  }

  /* ── Étage 2 · suggestion (lexical → habitudes → IA légère) ──── */
  if (!suggestion) {
    const pick = _fuzzyPick(candidates, subject, atts);
    if (pick) suggestion = { kind: 'article', art_id: pick.id, via: 'titre' };
  }
  if (!suggestion) {
    const habit = fromEmail ? await env.DB.prepare('SELECT rub_id FROM dk_habits WHERE pub_id = ? AND from_email = ?').bind(pubId, fromEmail).first() : null;
    if (habit && habit.rub_id) suggestion = { kind: 'spontane', rub_id: habit.rub_id, via: 'habitude' };
  }
  if (!suggestion) {
    const rubId = await _suggestRubriqueIA(env, pubId, pub.name, subject, body);
    suggestion = { kind: 'spontane', rub_id: rubId || null, via: rubId ? 'ia' : 'aucune' };
  }

  /* ── Étage 3 · le bac (jamais contourné) ──────────────────────── */
  await env.DB.prepare(
    `INSERT INTO dk_inbox (id, pub_id, from_email, from_name, subject, body, suggestion, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(inboxId, pubId, fromEmail || null, dkS(mail.fromName, DK_MAX_NAME), subject, body,
      JSON.stringify(suggestion), JSON.stringify(atts)).run();
  return { ok: true, mode: 'bac', inboxId, suggestion };
}

/* Recoupement lexical titres ↔ objet + noms de fichiers : un SEUL
   gagnant franc (score ≥ seuil et nettement devant le 2ᵉ), sinon null.
   Sobre et explicable — pas de ML.                                    */
function _tokens(s) {
  return new Set(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(w => w.length >= 4));
}
function _fuzzyPick(arts, subject, atts) {
  const hay = _tokens(subject + ' ' + (atts || []).map(a => a.name).join(' '));
  if (!hay.size) return null;
  const scored = arts.map(a => {
    const t = _tokens(a.title);
    if (!t.size) return { a, score: 0 };
    let hit = 0;
    for (const w of t) if (hay.has(w)) hit++;
    return { a, score: hit / t.size };
  }).sort((x, y) => y.score - x.score);
  const best = scored[0], second = scored[1];
  if (!best || best.score < FUZZY_MIN_SCORE) return null;
  if (second && second.score >= best.score * 0.8) return null;   // ambigu → bac sans pari
  return best.a;
}

/* Suggestion IA (étage 2, marge du système — cœur ZÉRO IA intact) :
   rubrique choisie dans la LISTE FERMÉE via callLLM (moteur inclus
   Mistral par défaut, JAMAIS env.AI.run figé). Neurones journalisés
   (recordUsage). Coupable par DK_EMAIL_IA=off. Échec → pas de
   suggestion, le bac reste la vérité. (Crédits client : offert en
   beta — consumeCredits à câbler au gating de la mise en boutique.)  */
async function _suggestRubriqueIA(env, pubId, pubName, subject, body) {
  if (String(env.DK_EMAIL_IA || 'on') === 'off') return null;
  if (!subject && (!body || body.length < 40)) return null;
  const rubs = (await env.DB.prepare('SELECT id, name FROM dk_rubriques WHERE pub_id = ? ORDER BY position').bind(pubId).all()).results || [];
  if (rubs.length < 2) return null;
  const sys = `Tu classes une contribution reçue par e-mail pour la revue « ${pubName} » dans UNE rubrique. Réponds UNIQUEMENT par le nom exact d'une rubrique de la liste, sans rien d'autre. Si aucune ne convient, réponds « ? ».`;
  const usr = `Rubriques : ${rubs.map(r => r.name).join(' · ')}\n\nObjet : ${subject || '(sans objet)'}\n\nDébut du texte :\n${String(body || '').slice(0, 900)}`;
  try {
    const out = await callLLM(env, { system: sys, messages: [{ role: 'user', content: usr }], max_tokens: 30 });
    await recordUsage(env, 'desk', { usage: out.usage, inText: sys + usr, outText: out.text || '' }).catch(() => {});
    const ans = String(out.text || '').trim().toLowerCase().replace(/^["«\s]+|["»\s.]+$/g, '');
    const hit = rubs.find(r => r.name.toLowerCase() === ans) ||
                rubs.find(r => ans && ans.length > 3 && r.name.toLowerCase().includes(ans));
    return hit ? hit.id : null;
  } catch (_) { return null; }
}

/* Rattachement effectif d'une contribution à un article : pointage
   « copie reçue » + pièces vers le casier + corps vers les notes si
   elles sont vides. Utilisé par l'étage 1 (auto) et par le bac.       */
async function _rattacher(env, { pubId, art, pageId, issueId, pageN, atts, body, fromEmail, fromName, by }) {
  const who = fromName || fromEmail || 'un contributeur';
  const cur = await env.DB.prepare('SELECT id, status, notes, histo, contrib, due FROM dk_articles WHERE id = ?').bind(art.id).first();
  const stillWaiting = ['propose', 'attendu'].includes(cur.status);
  const histo = stillWaiting
    ? dkHistoPush(cur.histo, `Copie reçue par e-mail de ${who}` + (by === 'digestion' ? ' (rattachée automatiquement)' : ` — confirmée par ${by}`))
    : dkHistoPush(cur.histo, `Complément reçu par e-mail de ${who}` + (by === 'digestion' ? '' : ` — confirmé par ${by}`));
  let sql = `UPDATE dk_articles SET ${stillWaiting ? `status = 'remis', ` : ''}histo = ?, updated_at = datetime('now')`;
  const binds = [histo];
  if (body && !(cur.notes || '').trim()) { sql += ', notes = ?'; binds.push(String(body).slice(0, DK_MAX_NOTES)); }
  sql += ' WHERE id = ?'; binds.push(art.id);
  await env.DB.prepare(sql).bind(...binds).run();
  if (stillWaiting) await dkContribStats(env, pubId, cur.contrib, cur.due);

  // Pièces : mêmes objets R2, promus en pièces du casier (page réelle si
  // l'article est posé, sinon « au marbre » — page_id = '').
  for (const a of (atts || [])) {
    await env.DB.prepare(
      `INSERT INTO dk_files (id, pub_id, issue_id, page_id, art_id, name, mime, size, r2_key, status, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?)`)
      .bind(generateId(), pubId, issueId || '', pageId || '', art.id, a.name, a.mime, a.size, a.r2_key, who).run();
  }
  if (pageId) {
    await env.DB.prepare(`UPDATE dk_pages SET updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .bind(by === 'digestion' ? 'la digestion' : by, pageId).run();
    // Signal « nouvel article » (§3.6) : une copie qui arrive sur une page déjà
    // servie rafraîchit l'horodatage d'arrivée du slot → la carte pulse même
    // sans pièce jointe (copie texte seule). created_at = « dernière arrivée ici ».
    await env.DB.prepare(`UPDATE dk_page_slots SET created_at = datetime('now') WHERE page_id = ? AND art_id = ?`)
      .bind(pageId, art.id).run();
  }
  // L'e-mail du contributeur se mémorise tout seul (satellite §2).
  if (fromEmail && cur.contrib) {
    await env.DB.prepare(
      `INSERT INTO dk_contribs (id, pub_id, name, email) VALUES (?, ?, ?, ?)
       ON CONFLICT (pub_id, name) DO UPDATE SET email = COALESCE(excluded.email, email)`)
      .bind(generateId(), pubId, dkS(cur.contrib, DK_MAX_NAME), fromEmail).run();
  }
}

// Numéro « courant » d'une publication (pièces d'un article au marbre).
async function _activeIssueId(env, pubId) {
  const r = await env.DB.prepare(
    `SELECT id FROM dk_issues WHERE pub_id = ? AND status != 'imprime' ORDER BY created_at DESC LIMIT 1`).bind(pubId).first()
    || await env.DB.prepare(`SELECT id FROM dk_issues WHERE pub_id = ? ORDER BY created_at DESC LIMIT 1`).bind(pubId).first();
  return r ? r.id : '';
}

/* ═══════════════ Routes HTTP du bac & de test ═══════════════════ */

// POST /api/desk/email-inject (ADMIN) — injecter un e-mail à la main :
// suite de tests, et filet de secours (coller un mail reçu ailleurs).
export async function handleEmailInject(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Accès admin requis', 401, origin);
  const b = await parseBody(request);
  const mail = {
    to: String(b.to || ''),
    fromEmail: String(b.from_email || ''),
    fromName: b.from_name || null,
    subject: b.subject || '',
    text: String(b.body || ''),
    attachments: (Array.isArray(b.attachments) ? b.attachments : []).slice(0, MAX_ATTACHMENTS).map(a => ({
      name: a.name || 'piece',
      content: (() => { try { return Uint8Array.from(atob(a.b64 || ''), c => c.charCodeAt(0)); } catch (_) { return new Uint8Array(0); } })(),
    })),
  };
  const r = await digestEmail(env, mail);
  return json(r, r.ok ? 200 : 400, origin);
}

async function _inboxGate(request, env, origin, inboxId) {
  await ensureDeskSchema(env);
  const row = await env.DB.prepare('SELECT * FROM dk_inbox WHERE id = ?').bind(inboxId).first();
  if (!row) return { error: err('Entrée introuvable', 404, origin) };
  const u = await dkMemberGate(request, env, origin, row.pub_id);
  if (u.error) return u;
  if (row.status !== 'pending') return { error: err('Entrée déjà triée', 400, origin) };
  let atts = []; try { atts = JSON.parse(row.attachments || '[]'); } catch (_) {}
  return { u, row, atts };
}

/* POST /api/desk/inbox/:id/apply — confirmer une entrée du bac.
   { art_id }                        → rattacher à un article existant
   { create: {title, rub_id, contrib} } → spontané : nouvel article AU MARBRE
   Chaque confirmation APPREND (e-mail du contributeur, ou habitude
   « mails de X → rubrique Y » pour les spontanés).                    */
export async function handleInboxApply(request, env, inboxId) {
  const origin = getAllowedOrigin(env, request);
  const g = await _inboxGate(request, env, origin, inboxId);
  if (g.error) return g.error;
  const { u, row, atts } = g;
  const body = await parseBody(request);
  const by = dkByName(u);
  let artId = null;

  if (body.art_id) {
    const art = await env.DB.prepare('SELECT id, title FROM dk_articles WHERE id = ? AND pub_id = ?').bind(body.art_id, row.pub_id).first();
    if (!art) return err('Article inconnu dans cette publication', 400, origin);
    const slot = await env.DB.prepare(
      `SELECT s.page_id, p.issue_id, p.n FROM dk_page_slots s JOIN dk_pages p ON p.id = s.page_id
       WHERE s.art_id = ? ORDER BY p.n LIMIT 1`).bind(art.id).first();
    await _rattacher(env, {
      pubId: row.pub_id, art, pageId: slot ? slot.page_id : '', pageN: slot ? slot.n : null,
      issueId: slot ? slot.issue_id : await _activeIssueId(env, row.pub_id),
      atts, body: row.body, fromEmail: row.from_email, fromName: row.from_name, by,
    });
    artId = art.id;
  } else if (body.create && body.create.title) {
    const title = dkS(String(body.create.title).trim(), DK_MAX_TITLE);
    if (!title) return err('Titre requis', 400, origin);
    let rubId = null;
    if (body.create.rub_id) {
      const r = await env.DB.prepare('SELECT id FROM dk_rubriques WHERE id = ? AND pub_id = ?').bind(body.create.rub_id, row.pub_id).first();
      if (r) rubId = r.id;
    }
    const contrib = dkS(String(body.create.contrib || row.from_name || '').trim(), DK_MAX_NAME);
    artId = generateId();
    await env.DB.prepare(
      `INSERT INTO dk_articles (id, pub_id, title, rub_id, contrib, status, notes, histo)
       VALUES (?, ?, ?, ?, ?, 'remis', ?, ?)`)
      .bind(artId, row.pub_id, title, rubId, contrib || null, String(row.body || '').slice(0, DK_MAX_NOTES),
        JSON.stringify([`Spontané reçu par e-mail de ${row.from_name || row.from_email || '?'} — créé au marbre par ${by}`])).run();
    const issueId = await _activeIssueId(env, row.pub_id);
    for (const a of atts) {
      await env.DB.prepare(
        `INSERT INTO dk_files (id, pub_id, issue_id, page_id, art_id, name, mime, size, r2_key, status, uploaded_by)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 'ok', ?)`)
        .bind(generateId(), row.pub_id, issueId, artId, a.name, a.mime, a.size, a.r2_key, row.from_name || row.from_email || '?').run();
    }
    // Apprentissages : e-mail du contributeur + habitude de rubrique.
    if (row.from_email && contrib) {
      await env.DB.prepare(
        `INSERT INTO dk_contribs (id, pub_id, name, email) VALUES (?, ?, ?, ?)
         ON CONFLICT (pub_id, name) DO UPDATE SET email = excluded.email`)
        .bind(generateId(), row.pub_id, contrib, row.from_email).run();
    }
    if (row.from_email && rubId) {
      await env.DB.prepare(
        `INSERT INTO dk_habits (pub_id, from_email, rub_id) VALUES (?, ?, ?)
         ON CONFLICT (pub_id, from_email) DO UPDATE SET rub_id = excluded.rub_id, updated_at = datetime('now')`)
        .bind(row.pub_id, row.from_email, rubId).run();
    }
  } else {
    return err('Indiquez un article existant (art_id) ou un nouvel article (create)', 400, origin);
  }

  await env.DB.prepare(`UPDATE dk_inbox SET status = 'done', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`).bind(by, inboxId).run();
  return json({ ok: true, art_id: artId }, 200, origin);
}

// POST /api/desk/inbox/:id/reject — écarter (pièces R2 purgées, trace gardée).
export async function handleInboxReject(request, env, inboxId) {
  const origin = getAllowedOrigin(env, request);
  const g = await _inboxGate(request, env, origin, inboxId);
  if (g.error) return g.error;
  for (const a of g.atts) { if (env.DK_CASIER && a.r2_key) await env.DK_CASIER.delete(a.r2_key).catch(() => {}); }
  await env.DB.prepare(`UPDATE dk_inbox SET status = 'rejete', attachments = '[]', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`)
    .bind(dkByName(g.u), inboxId).run();
  return json({ ok: true }, 200, origin);
}
