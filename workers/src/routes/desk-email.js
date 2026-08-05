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
import { sendEmail, emailConfigured } from '../lib/email-resend.js';
import { recordUsage } from '../lib/ai-budget.js';
import { ensureDeskSchema, dkMemberGate, dkHistoPush, dkS, dkFileExt, dkFileName,
         dkByName, dkContribStats, DK_FILE_EXTS, DK_FILE_MAX, DK_MAX_NAME,
         DK_MAX_TITLE, DK_MAX_NOTES } from './desk.js';

const MAX_BODY_KEEP   = 20000;   // corps conservé dans le bac / versé aux notes
const MAX_ATTACHMENTS = 10;      // pièces jointes traitées par e-mail
const FUZZY_MIN_SCORE = 0.6;     // recoupement lexical minimal titre ↔ objet/fichiers

/* ═══════════ DK-8 · les deux plafonds du BAC ═══════════════════════
   Ce ne sont PAS des portes : rien n'est jamais refusé à cause d'eux.
   Ils disent seulement combien de plis attendent DEVANT la rédactrice.
   Au-delà, la contribution est MISE DE CÔTÉ (status 'differe') : elle
   est reçue, stockée, visible dans la bannette, et elle revient d'
   elle-même au bac dès qu'une place se libère (_repecherDiff).

   Le plafond PAR EXPÉDITEUR est le vrai garde-fou : sans lui, une
   avalanche d'un seul indésirable remplit les 200 places et le
   contributeur suivant — légitime — ne trouve plus de place. Avec lui,
   un expéditeur n'occupe jamais plus de 20 lignes du bac, quel que
   soit le nombre de messages qu'il envoie.                            */
const MAX_INBOX_PENDING     = 200;  // plis en attente de tri, par publication
const MAX_PENDING_PER_SENDER = 20;  // … dont au plus 20 pour un même expéditeur
function _cap(env, name, def) {
  const n = parseInt(String(env && env[name] || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/* ═══════════════ Le handler e-mail Cloudflare ═══════════════════
   Branché dans index.js : `async email(message, env, ctx)`.

   Un seul cas vaut encore un rejet SMTP : l'adresse de dépôt n'existe
   pas (le catch-all reçoit du courrier qui ne nous concerne pas), ou le
   message est illisible. Le bac plein, lui, ne refoule PLUS rien —
   c'était un échec renvoyé à l'auteur d'une contribution parfaitement
   légitime, dont la rédaction n'entendait jamais parler (DK-8).       */
export async function handleDeskEmail(message, env, ctx) {
  let mail;
  try {
    // L'authentification est stampée par Cloudflare EN TÊTE du message
    // reçu ; on la lit sur l'enveloppe et, en repli, dans le MIME parsé.
    const parsed = await PostalMime.parse(message.raw);
    let authRaw = '';
    try { authRaw = message.headers?.get('authentication-results') || ''; } catch (_) {}
    if (!authRaw) authRaw = _headerFromParsed(parsed, 'authentication-results');
    mail = {
      to: String(message.to || '').toLowerCase(),
      fromEmail: String(parsed.from?.address || message.from || '').toLowerCase().trim(),
      fromName: parsed.from?.name || null,
      subject: parsed.subject || '',
      text: parsed.text || _htmlToText(parsed.html || ''),
      authResults: authRaw,
      attachments: (parsed.attachments || []).slice(0, MAX_ATTACHMENTS).map(a => ({
        name: a.filename || 'piece', mime: a.mimeType || '', content: new Uint8Array(a.content),
      })),
    };
  } catch (_) {
    try { message.setReject('Message illisible'); } catch (_) {}
    return;
  }
  // Une panne de notre côté (D1, R2) ne doit pas se solder par un refus
  // DÉFINITIF : setReject est permanent, l'exception ne l'est pas — au
  // pire la plateforme échoue pareil, au mieux le serveur d'en face
  // réessaie et la contribution finit par entrer.
  const r = await digestEmail(env, mail, { ack: true });
  if (!r.ok && r.reason === 'adresse') { try { message.setReject('Adresse de dépôt inconnue'); } catch (_) {} }
}

// postal-mime rend les en-têtes sous forme de liste { key, value }.
function _headerFromParsed(parsed, key) {
  const hs = (parsed && parsed.headers) || [];
  const k = String(key).toLowerCase();
  return hs.filter(h => String(h.key || '').toLowerCase() === k).map(h => h.value || '').join(' ; ');
}

/* ═══════════ DK-8 · SPF / DKIM / DMARC ═════════════════════════════
   `From` est falsifiable. Tant que la rédactrice transférait elle-même
   les copies, l'arbitrage de juillet 2026 tenait ; depuis le 4 août les
   contributeurs écrivent DIRECTEMENT à une adresse publiée, et une
   adresse usurpée suffirait à faire poser un faux papier sur une page,
   tout seul, sans qu'un humain l'ait vu.

   Règle : un message dont l'authentification ÉCHOUE ne déclenche jamais
   le rattachement automatique. Il descend au bac comme n'importe quel
   doute, avec la mention affichée à l'écran. Rien n'est refusé, rien
   n'est perdu — c'est un humain qui tranche.

   Lecture volontairement FAIL-SAFE : on balaie TOUTES les mentions du
   champ (Cloudflare pose la sienne en tête, mais un expéditeur peut en
   avoir glissé une autre plus bas) et le moindre `fail` l'emporte.
   Ajouter un faux `spf=pass` n'efface donc pas le vrai `spf=fail` ;
   ajouter un faux `spf=fail` ne fait que renvoyer le message au bac.
   Aucune mention du tout (injection admin, vieille entrée) → 'inconnu' :
   on ne change rien au comportement d'avant.                          */
const AUTH_BAD = new Set(['fail', 'softfail', 'permerror']);
export function authVerdict(raw) {
  const s = String(raw || '').toLowerCase();
  const seen = {};
  const re = /\b(spf|dkim|dmarc)\s*=\s*([a-z]+)/g;
  let m;
  while ((m = re.exec(s))) { (seen[m[1]] = seen[m[1]] || []).push(m[2]); }
  const keys = Object.keys(seen);
  if (!keys.length) return { verdict: null, detail: null };
  const bad = keys.some(k => seen[k].some(v => AUTH_BAD.has(v)));
  const detail = keys.map(k => k + '=' + [...new Set(seen[k])].join('/')).join(' ').slice(0, 120);
  return { verdict: bad ? 'fail' : 'pass', detail };
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
export async function digestEmail(env, mail, opts = {}) {
  const ack = opts.ack === true;   // accusé de réception : seulement le vrai courrier
  await ensureDeskSchema(env);

  // L'adresse porte le tenant : <slug>@… → publication (le domaine
  // porte déjà « redaction »). Sous-adressage toléré (slug+detail@).
  const m = /^([a-z0-9-]+)(?:\+[^@]*)?@/.exec(String(mail.to || '').toLowerCase());
  if (!m) return { ok: false, reason: 'adresse' };
  const pub = await env.DB.prepare('SELECT id, name FROM dk_publications WHERE slug = ?').bind(m[1]).first();
  if (!pub) return { ok: false, reason: 'adresse' };
  const pubId = pub.id;

  // Le bac s'est peut-être vidé depuis le dernier pli : ce qui avait été
  // mis de côté remonte AVANT qu'on décide du sort du message d'aujourd'hui.
  await _repecherDiff(env, pubId);

  const auth = authVerdict(mail.authResults != null ? mail.authResults : mail.auth);
  const authFail = auth.verdict === 'fail';

  const fromEmail = String(mail.fromEmail || '').toLowerCase().trim();
  const subject = dkS(String(mail.subject || '').trim(), 300) || '';
  const body = String(mail.text || '').slice(0, MAX_BODY_KEEP);
  const inboxId = generateId();

  // Mail transféré → l'AUTEUR est celui du bloc « De : », pas l'enveloppe.
  const fwd = _forwardedFrom(subject, body);
  const origEmail = fwd && fwd.email && fwd.email !== fromEmail ? fwd.email : null;
  const origName  = origEmail ? (fwd.name || null) : null;
  const authorEmail = origEmail || fromEmail;   // sert au rapprochement ET aux apprentissages
  const authorName  = origName || mail.fromName || null;

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
  if (authorEmail) {
    const names = ((await env.DB.prepare('SELECT name FROM dk_contribs WHERE pub_id = ? AND email = ?').bind(pubId, authorEmail).all()).results || [])
      .map(r => (r.name || '').toLowerCase());
    if (names.length) {
      const mine = candidates.filter(a => names.includes((a.contrib || '').toLowerCase()));
      let pick = mine.length === 1 ? mine[0] : null;
      if (!pick && mine.length > 1) pick = _fuzzyPick(mine, subject, atts);
      if (pick) {
        // Article ciblé sans ambiguïté. Posé sur une page → rattachement AUTO.
        // SAUF si l'authentification a échoué : le rapprochement repose
        // entièrement sur une adresse d'expéditeur, et celle-ci n'est pas
        // prouvée. On garde la cible en suggestion, un humain confirme.
        const slot = authFail ? null : await env.DB.prepare(
          `SELECT s.page_id, p.issue_id, p.n FROM dk_page_slots s JOIN dk_pages p ON p.id = s.page_id
           WHERE s.art_id = ? ORDER BY p.n LIMIT 1`).bind(pick.id).first();
        if (slot) {
          await _rattacher(env, { pubId, art: pick, pageId: slot.page_id, issueId: slot.issue_id, pageN: slot.n, atts, body,
            fromEmail: authorEmail, fromName: authorName, viaEmail: origEmail ? fromEmail : null, by: 'digestion' });
          await env.DB.prepare(
            // art_id : le rattachement AUTOMATIQUE doit lui aussi dire où il a
            // posé la copie, sinon la bannette affiche « triée » sans pouvoir
            // nommer l'article — et ne sait pas signaler sa disparition.
            `INSERT INTO dk_inbox (id, pub_id, from_email, from_name, orig_email, orig_name, subject, body, suggestion, attachments, status, art_id, resolved_by, resolved_at, auth, auth_detail)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?, 'digestion', datetime('now'), ?, ?)`)
            .bind(inboxId, pubId, fromEmail, dkS(mail.fromName, DK_MAX_NAME), origEmail, origName, subject, body.slice(0, 2000),
              JSON.stringify({ kind: 'article', art_id: pick.id, via: origEmail ? 'expediteur-transfere' : 'expediteur', page_n: slot.n }),
              JSON.stringify(atts), pick.id, auth.verdict, auth.detail).run();
          await _accuseReception(env, { pubId, pubName: pub.name, to: authorEmail, subject, ack });
          return { ok: true, mode: 'auto', inboxId, art_id: pick.id, orig_email: origEmail, auth: auth.verdict };
        }
        // Pas encore en page → bac, suggestion franche pré-cochée.
        suggestion = { kind: 'article', art_id: pick.id, via: 'expediteur' };
      } else if (mine.length > 1) {
        suggestion = { kind: 'article', art_id: mine[0].id, via: 'expediteur-ambigu', candidates: mine.slice(0, 8).map(a => a.id) };
      }
    }
  }

  /* ── DK-8 · le bac est-il saturé ? ────────────────────────────────
     La question se pose ICI, et pas plus haut : un rattachement
     automatique n'occupe aucune place dans le bac, il n'a donc pas à
     être empêché parce que le bac déborde. Ce qui suit ne concerne que
     ce qui va réellement se poser sur le bureau de la rédactrice.      */
  const differe = await _placeAuBac(env, pubId, authorEmail || fromEmail);

  /* ── Étage 2 · suggestion (lexical → habitudes → IA légère) ──── */
  if (!suggestion) {
    const pick = _fuzzyPick(candidates, subject, atts);
    if (pick) suggestion = { kind: 'article', art_id: pick.id, via: 'titre' };
  }
  if (!suggestion) {
    // Une habitude posée sur une adresse de l'équipe (héritée d'avant DK-4b)
    // ne veut rien dire : on ne la lit pas non plus.
    const habit = authorEmail && !(await _isTeamAddress(env, pubId, authorEmail))
      ? await env.DB.prepare('SELECT rub_id FROM dk_habits WHERE pub_id = ? AND from_email = ?').bind(pubId, authorEmail).first()
      : null;
    if (habit && habit.rub_id) suggestion = { kind: 'spontane', rub_id: habit.rub_id, via: 'habitude' };
  }
  if (!suggestion) {
    // Un pli mis de côté ne consulte PAS l'IA : une avalanche brûlerait
    // les neurones de la publication avant que personne n'ait rien vu. Sa
    // suggestion reste déterministe — de toute façon c'est un humain qui
    // tranchera quand le pli remontera au bac.
    const rubId = differe.differe ? null : await _suggestRubriqueIA(env, pubId, pub.name, subject, body);
    suggestion = { kind: 'spontane', rub_id: rubId || null, via: rubId ? 'ia' : 'aucune' };
  }

  /* ── Étage 3 · le bac (jamais contourné) ──────────────────────── */
  await env.DB.prepare(
    `INSERT INTO dk_inbox (id, pub_id, from_email, from_name, orig_email, orig_name, subject, body, suggestion, attachments, status, auth, auth_detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(inboxId, pubId, fromEmail || null, dkS(mail.fromName, DK_MAX_NAME), origEmail, origName, subject, body,
      JSON.stringify(suggestion), JSON.stringify(atts),
      differe.differe ? 'differe' : 'pending', auth.verdict, auth.detail).run();
  // Un accusé de réception envoyé sur une adresse dont l'authentification
  // a échoué, c'est écrire au contributeur DONT ON A USURPÉ l'adresse pour
  // lui annoncer un envoi qu'il n'a pas fait. On se tait.
  if (!authFail) await _accuseReception(env, { pubId, pubName: pub.name, to: authorEmail, subject, ack });
  return {
    ok: true, mode: differe.differe ? 'differe' : 'bac', inboxId, suggestion, orig_email: origEmail,
    auth: auth.verdict, auth_detail: auth.detail,
    ...(differe.differe ? { differe: differe.motif } : {}),
  };
}

/* ═══════════ DK-8 · reste-t-il une place au bac ? ═══════════════════
   Deux comptes, deux plafonds. Le résultat ne conditionne JAMAIS une
   réception : il dit seulement si le pli s'affiche tout de suite au tri
   ('pending') ou s'il patiente de côté ('differe').                    */
async function _placeAuBac(env, pubId, who) {
  const capBac = _cap(env, 'DK_INBOX_MAX', MAX_INBOX_PENDING);
  const capExp = _cap(env, 'DK_INBOX_MAX_SENDER', MAX_PENDING_PER_SENDER);
  const n = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM dk_inbox WHERE pub_id = ? AND status = 'pending'`).bind(pubId).first())?.n || 0;
  if (n >= capBac) return { differe: true, motif: 'bac-plein' };
  const mine = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM dk_inbox
      WHERE pub_id = ? AND status = 'pending' AND COALESCE(orig_email, from_email, '') = ?`)
    .bind(pubId, String(who || '')).first())?.n || 0;
  if (mine >= capExp) return { differe: true, motif: 'expediteur-prolifique' };
  return { differe: false, motif: null };
}

/* ═══════════ DK-8 · le repêchage ═══════════════════════════════════
   Ce qui a été mis de côté doit revenir tout seul : sinon « mettre de
   côté » ne serait qu'un refus poli. On repêche à chaque nouveau pli et
   à chaque fois qu'une entrée quitte le bac (tri, rejet, effacement).

   L'ordre est le plus ancien d'abord, mais PAR EXPÉDITEUR : servir la
   file brute rendrait les 280 messages d'un indésirable prioritaires
   sur l'unique contribution légitime arrivée derrière eux.             */
async function _repecherDiff(env, pubId) {
  const capBac = _cap(env, 'DK_INBOX_MAX', MAX_INBOX_PENDING);
  const capExp = _cap(env, 'DK_INBOX_MAX_SENDER', MAX_PENDING_PER_SENDER);
  let n = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM dk_inbox WHERE pub_id = ? AND status = 'pending'`).bind(pubId).first())?.n || 0;
  let room = capBac - n;
  if (room <= 0) return 0;
  // Un tour de table : chaque expéditeur ayant du courrier de côté, le plus
  // anciennement mis de côté en premier. La fenêtre d'expéditeurs ne se règle
  // PAS sur la place disponible — sinon le prolifique, qui est le plus ancien
  // et qui est déjà au plafond, occuperait à lui seul la fenêtre et bloquerait
  // le repêchage de la contribution légitime arrivée derrière lui.
  const senders = (await env.DB.prepare(
    `SELECT COALESCE(orig_email, from_email, '') AS who, MIN(received_at) AS t
       FROM dk_inbox WHERE pub_id = ? AND status = 'differe'
      GROUP BY who ORDER BY t LIMIT 50`).bind(pubId).all()).results || [];
  if (!senders.length) return 0;
  const dejaLa = new Map(((await env.DB.prepare(
    `SELECT COALESCE(orig_email, from_email, '') AS who, COUNT(*) AS n
       FROM dk_inbox WHERE pub_id = ? AND status = 'pending' GROUP BY who`).bind(pubId).all()).results || [])
    .map(r => [r.who || '', r.n || 0]));
  let repeches = 0;
  for (const s of senders) {
    if (room <= 0) break;
    const who = s.who || '';
    const place = Math.min(room, capExp - (dejaLa.get(who) || 0));
    if (place <= 0) continue;
    const ids = (await env.DB.prepare(
      `SELECT id FROM dk_inbox WHERE pub_id = ? AND status = 'differe' AND COALESCE(orig_email, from_email, '') = ?
        ORDER BY received_at LIMIT ?`).bind(pubId, who, place).all()).results || [];
    for (const r of ids) {
      await env.DB.prepare(`UPDATE dk_inbox SET status = 'pending' WHERE id = ? AND status = 'differe'`).bind(r.id).run();
      room--; repeches++;
    }
  }
  return repeches;
}

/* ═══════════ DK-4b · le mail TRANSFÉRÉ ═══════════════════════════
   La rédaction fait suivre la copie d'un auteur à l'adresse de dépôt.
   L'enveloppe porte alors l'adresse de CELLE QUI TRANSFÈRE — si on s'y
   fie, le rapprochement automatique ne se déclenche jamais (l'auteur
   n'est pas reconnu) et, pire, chaque confirmation apprend « les mails
   de la rédactrice vont en rubrique X », puis Y, puis Z, puisqu'elle
   transfère tout. On lit donc l'expéditeur d'ORIGINE dans le bloc que
   tous les logiciels de messagerie insèrent en tête du corps.

   Prudence : on n'y touche QUE si le message se déclare transfert
   (objet « Tr: / Fwd: » ou séparateur « ----- Message transféré -----»).
   Sans ce garde-fou, un contributeur qui cite un mail dans le sien se
   verrait attribuer la paternité de quelqu'un d'autre.               */
function _forwardedFrom(subject, text) {
  const head = String(text || '').slice(0, 8000);
  const declared = /^\s*(?:fwd?|tr|wg|rv|enc)\s*:/i.test(String(subject || '')) ||
    /(?:-{2,}\s*(?:forwarded message|message transf[ée]r[ée])|begin forwarded message\s*:|d[ée]but du message transf[ée]r[ée]\s*:)/i.test(head);
  if (!declared) return null;
  const fromLine = /^[ \t>]*(?:from|de|von|van)\s*:[ \t]*(.+)$/gim;
  // Le domaine peut contenir des chiffres (y compris dans le dernier label) :
  // s'arrêter au premier chiffre tronquerait l'adresse en silence.
  const addr = /([^\s<>@,;:"']+@[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\.[a-z0-9-]{2,})/i;
  let m;
  while ((m = fromLine.exec(head))) {
    const a = addr.exec(m[1] || '');
    if (!a) continue;
    let name = m[1].replace(a[0], '').replace(/[<>"]/g, '').replace(/[,;]/g, ' ').trim();
    if (/^\(.*\)$/.test(name)) name = name.slice(1, -1).trim();
    return { email: a[1].toLowerCase(), name: dkS(name, DK_MAX_NAME) || null };
  }
  return null;
}

/* ═══════════ Accusé de réception ═══════════════════════════════════
   Un auteur qui écrit à une machine ne sait pas si c'est arrivé — et il
   rappellera la rédaction pour le demander. On lui répond donc « bien
   reçu ». Trois garde-fous, parce qu'un répondeur automatique branché
   sur une adresse publique se retourne vite contre son domaine :

   1. UNIQUEMENT aux contributeurs déjà connus de la publication. Un
      inconnu n'obtient rien : son mail attend dans le bac, un humain le
      verra. C'est aussi ce qui nous empêche de répondre à une adresse
      falsifiée par un spammeur (elle ne sera pas dans dk_contribs).
   2. Jamais aux adresses de service (no-reply, mailer-daemon…), sinon
      deux automates se répondent en boucle.
   3. Un seul accusé par adresse et par jour.                          */
const ACK_MAX_PER_DAY = 1;
const ACK_SYSTEM_RE = /^(?:no-?reply|ne-?pas-?repondre|mailer-daemon|postmaster|bounce|notification|newsletter|donotreply)\b|^(?:no-?reply|bounce)[-.@]/i;

async function _accuseReception(env, { pubId, pubName, to, subject, ack }) {
  try {
    if (!ack || !to || !emailConfigured(env)) return;
    if (String(env.DK_EMAIL_ACK || 'on') === 'off') return;
    if (ACK_SYSTEM_RE.test(to)) return;
    const known = await env.DB.prepare('SELECT name FROM dk_contribs WHERE pub_id = ? AND email = ? LIMIT 1').bind(pubId, to).first();
    if (!known) return;
    // Plafond : compte les entrées déjà reçues de cet auteur dans les 24 h
    // (celle qu'on vient d'insérer comprise) — au-delà, on cesse d'écrire.
    const seen = (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM dk_inbox
       WHERE pub_id = ? AND COALESCE(orig_email, from_email) = ?
         AND received_at >= datetime('now', '-1 day')`).bind(pubId, to).first())?.n || 0;
    if (seen > ACK_MAX_PER_DAY) return;
    const qui = known.name ? String(known.name) : '';
    await sendEmail(env, {
      to: [to],
      subject: 'Bien reçu — ' + (pubName || 'la rédaction'),
      html: `<p>Bonjour${qui ? ' ' + _escapeHtml(qui) : ''},</p>
             <p>Votre envoi${subject ? ' « ' + _escapeHtml(subject) + ' »' : ''} est bien arrivé à la rédaction de <strong>${_escapeHtml(pubName || '')}</strong>.</p>
             <p>Il est entre les mains de l'équipe. Vous n'avez rien d'autre à faire : on revient vers vous si quelque chose manque.</p>
             <p style="color:#666;font-size:13px">Message automatique — inutile d'y répondre, personne ne le lit. Pour joindre la rédaction, écrivez comme d'habitude.</p>`,
    });
  } catch (_) { /* l'accusé est un confort : son échec ne casse jamais un dépôt */ }
}
function _escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Une adresse de l'ÉQUIPE (membre ou invitation en attente) n'est jamais
   un contributeur : on n'apprend aucune habitude « ses mails vont en
   rubrique X » sur elle, sinon la règle se réécrit à chaque transfert. */
async function _isTeamAddress(env, pubId, email) {
  if (!email) return false;
  const hit = await env.DB.prepare(
    `SELECT 1 AS x FROM dk_members WHERE pub_id = ? AND lower(email) = ?
     UNION ALL
     SELECT 1 AS x FROM dk_invites WHERE pub_id = ? AND lower(email) = ?
     LIMIT 1`).bind(pubId, email, pubId, email).first();
  return !!hit;
}

// L'auteur d'une entrée du bac : l'expéditeur d'origine s'il y en a un
// (mail transféré), sinon l'expéditeur de l'enveloppe.
function _authorOf(row) { return (row && (row.orig_email || row.from_email)) || null; }

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
async function _rattacher(env, { pubId, art, pageId, issueId, pageN, atts, body, fromEmail, fromName, viaEmail, by }) {
  // `who` = l'AUTEUR (c'est lui qui signe la pièce au casier) ; la mention du
  // transfert n'apparaît que dans l'historique, pour ne pas alourdir l'étiquette.
  const who = fromName || fromEmail || 'un contributeur';
  const whoHisto = who + (viaEmail ? ` (transféré par ${viaEmail})` : '');
  const cur = await env.DB.prepare('SELECT id, status, notes, histo, contrib, due FROM dk_articles WHERE id = ?').bind(art.id).first();
  const stillWaiting = ['propose', 'attendu'].includes(cur.status);
  const histo = stillWaiting
    ? dkHistoPush(cur.histo, `Copie reçue par e-mail de ${whoHisto}` + (by === 'digestion' ? ' (rattachée automatiquement)' : ` — confirmée par ${by}`))
    : dkHistoPush(cur.histo, `Complément reçu par e-mail de ${whoHisto}` + (by === 'digestion' ? '' : ` — confirmé par ${by}`));
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
    // Le champ Authentication-Results tel que Cloudflare l'aurait posé —
    // c'est par là que le banc DK-8 rejoue un message qui échoue à SPF.
    authResults: b.auth_results != null ? String(b.auth_results) : null,
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
  // 'differe' = mise de côté faute de place au bac (DK-8), pas triée : elle
  // se trie exactement comme les autres si la rédactrice la sort d'elle-même
  // de la bannette avant que le repêchage ne l'ait remontée.
  if (row.status !== 'pending' && row.status !== 'differe') return { error: err('Entrée déjà triée', 400, origin) };
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
      atts, body: row.body,
      // Mail transféré : l'auteur est celui d'origine, pas la personne qui a fait suivre.
      fromEmail: _authorOf(row), fromName: row.orig_name || row.from_name,
      viaEmail: row.orig_email ? row.from_email : null, by,
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
    // Sur un mail TRANSFÉRÉ, ce qu'on retient est l'auteur d'origine — retenir
    // la personne qui fait suivre reviendrait à lui attribuer tous les papiers.
    const author = _authorOf(row);
    if (author && contrib) {
      await env.DB.prepare(
        `INSERT INTO dk_contribs (id, pub_id, name, email) VALUES (?, ?, ?, ?)
         ON CONFLICT (pub_id, name) DO UPDATE SET email = excluded.email`)
        .bind(generateId(), row.pub_id, contrib, author).run();
    }
    // L'habitude « les mails de X vont en rubrique Y » n'a de sens que pour un
    // contributeur. Posée sur une adresse de l'ÉQUIPE, qui transfère de tout à
    // tout le monde, elle se réécrit à chaque tri et ne dit plus rien de vrai.
    if (author && rubId && !(await _isTeamAddress(env, row.pub_id, author))) {
      await env.DB.prepare(
        `INSERT INTO dk_habits (pub_id, from_email, rub_id) VALUES (?, ?, ?)
         ON CONFLICT (pub_id, from_email) DO UPDATE SET rub_id = excluded.rub_id, updated_at = datetime('now')`)
        .bind(row.pub_id, author, rubId).run();
    }
  } else {
    return err('Indiquez un article existant (art_id) ou un nouvel article (create)', 400, origin);
  }

  // On retient OÙ le courrier a atterri : c'est ce qui rend la bannette
  // capable de dire « rattaché à … » — et de rattraper le coup si l'article
  // disparaît plus tard.
  await env.DB.prepare(`UPDATE dk_inbox SET status = 'done', art_id = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`)
    .bind(artId, by, inboxId).run();
  await _marquerLu(env, inboxId);
  // Une place vient de se libérer : ce qui attendait de côté remonte au bac.
  const repeches = await _repecherDiff(env, row.pub_id);
  return json({ ok: true, art_id: artId, ...(repeches ? { repeches } : {}) }, 200, origin);
}

/* ═══════════ DK-4c · LA BANNETTE ═════════════════════════════════
   GET /api/desk/publication/:id/courrier — TOUT ce qui est arrivé par
   e-mail, quel qu'en soit le sort.

   Le bac ne montrait que `status = 'pending'`. Une entrée triée — même
   par erreur — disparaissait donc de l'écran pour toujours, alors que
   son texte et ses pièces dormaient intacts en base. Une fausse
   manœuvre, et le courrier semblait s'être évaporé. Ici, rien ne sort
   jamais de la vue : on dit à chaque ligne ce qu'elle est devenue, et
   si l'article d'accueil a disparu depuis, on le dit aussi.           */
export async function handleCourrier(request, env, pubId) {
  const origin = getAllowedOrigin(env, request);
  await ensureDeskSchema(env);
  const u = await dkMemberGate(request, env, origin, pubId);
  if (u.error) return u.error;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '80', 10) || 80, 1), 200);
  const rows = (await env.DB.prepare(
    `SELECT i.id, i.from_email, i.from_name, i.orig_email, i.orig_name, i.subject, i.body,
            i.attachments, i.suggestion, i.status, i.art_id, i.resolved_by, i.resolved_at, i.received_at, i.lu_at,
            i.auth, i.auth_detail,
            a.title AS art_title, a.status AS art_status
       FROM dk_inbox i LEFT JOIN dk_articles a ON a.id = i.art_id
      WHERE i.pub_id = ? ORDER BY i.received_at DESC LIMIT ?`).bind(pubId, limit).all()).results || [];
  const courrier = rows.map(r => {
    let atts = []; try { atts = JSON.parse(r.attachments || '[]'); } catch (_) {}
    return {
      id: r.id, from_email: r.from_email, from_name: r.from_name,
      orig_email: r.orig_email, orig_name: r.orig_name,
      subject: r.subject, body: r.body, attachments: atts,
      status: r.status, received_at: r.received_at, lu: !!r.lu_at,
      // DK-8 : l'authentification de l'expéditeur, telle qu'elle a été
      // constatée à l'arrivée — la bannette doit pouvoir le dire.
      auth: r.auth || null, auth_detail: r.auth_detail || null,
      resolved_by: r.resolved_by, resolved_at: r.resolved_at,
      art_id: r.art_id || null, art_title: r.art_title || null, art_status: r.art_status || null,
      // Le cas qui a coûté une contribution : l'entrée dit « rattachée »,
      // mais l'article a été supprimé depuis. La bannette doit le crier.
      art_perdu: !!(r.art_id && !r.art_title),
    };
  });
  // Le compte des non-lus voyage AVEC la liste : sinon la pastille, qui ne se
  // rafraîchit qu'au cycle d'équipe, contredit ce qu'on a sous les yeux.
  const nonLus = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM dk_inbox WHERE pub_id = ? AND lu_at IS NULL`).bind(pubId).first())?.n || 0;
  // DK-8 : le compte par sort, sur TOUT le courrier — la liste est plafonnée
  // (limit), donc compter les mises de côté dans les lignes renvoyées
  // mentirait précisément le jour où il y en a beaucoup, c'est-à-dire le seul
  // jour où ça compte.
  const compte = {};
  for (const c of ((await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM dk_inbox WHERE pub_id = ? GROUP BY status`).bind(pubId).all()).results || [])) {
    compte[c.status] = c.n || 0;
  }
  return json({ ok: true, courrier, non_lus: nonLus, compte }, 200, origin);
}

/* POST /api/desk/inbox/:id/reprendre — refaire un article À PARTIR d'un
   courrier déjà classé. Le filet : l'article d'accueil a été supprimé,
   ou le tri était mauvais. Le texte reçu et les pièces (les objets R2
   survivent à la suppression d'un article) repartent au marbre.
   { title, rub_id?, contrib? }                                        */
export async function handleInboxReprendre(request, env, inboxId) {
  const origin = getAllowedOrigin(env, request);
  await ensureDeskSchema(env);
  const row = await env.DB.prepare('SELECT * FROM dk_inbox WHERE id = ?').bind(inboxId).first();
  if (!row) return err('Courrier introuvable', 404, origin);
  const u = await dkMemberGate(request, env, origin, row.pub_id);
  if (u.error) return u.error;
  if (row.status === 'pending') return err('Ce courrier est encore au bac — triez-le normalement', 400, origin);
  const by = dkByName(u);
  const body = await parseBody(request);
  const title = dkS(String(body.title || row.subject || '').trim(), DK_MAX_TITLE);
  if (!title) return err('Titre requis', 400, origin);
  let rubId = null;
  if (body.rub_id) {
    const r = await env.DB.prepare('SELECT id FROM dk_rubriques WHERE id = ? AND pub_id = ?').bind(body.rub_id, row.pub_id).first();
    if (r) rubId = r.id;
  }
  const contrib = dkS(String(body.contrib || row.orig_name || row.from_name || '').trim(), DK_MAX_NAME);
  const artId = generateId();
  await env.DB.prepare(
    `INSERT INTO dk_articles (id, pub_id, title, rub_id, contrib, status, notes, histo)
     VALUES (?, ?, ?, ?, ?, 'remis', ?, ?)`)
    .bind(artId, row.pub_id, title, rubId, contrib || null, String(row.body || '').slice(0, DK_MAX_NOTES),
      JSON.stringify([`Repris depuis la bannette (courrier du ${String(row.received_at || '').slice(0, 10)}) par ${by}`])).run();

  // Les pièces d'origine repartent avec lui — sauf celles qu'un « écarter »
  // a purgées de R2, auquel cas la liste est déjà vide.
  let atts = []; try { atts = JSON.parse(row.attachments || '[]'); } catch (_) {}
  const issueId = await _activeIssueId(env, row.pub_id);
  let reprises = 0;
  for (const a of atts) {
    if (!a || !a.r2_key) continue;
    if (env.DK_CASIER && !(await env.DK_CASIER.head(a.r2_key).catch(() => null))) continue;   // objet disparu
    await env.DB.prepare(
      `INSERT INTO dk_files (id, pub_id, issue_id, page_id, art_id, name, mime, size, r2_key, status, uploaded_by)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 'ok', ?)`)
      .bind(generateId(), row.pub_id, issueId, artId, a.name, a.mime, a.size, a.r2_key,
        row.orig_name || row.from_name || row.from_email || '?').run();
    reprises++;
  }
  // Le courrier pointe désormais vers l'article vivant.
  await env.DB.prepare(`UPDATE dk_inbox SET art_id = ?, status = 'done', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`)
    .bind(artId, by, inboxId).run();
  await _marquerLu(env, inboxId);
  return json({ ok: true, art_id: artId, pieces: reprises }, 200, origin);
}

/* POST /api/desk/inbox/:id/lu — relever un courrier de la bannette.
   Marqué à l'OUVERTURE de la fiche : c'est le moment où quelqu'un a
   réellement vu ce qui est arrivé. Trier, écarter ou reprendre le
   marquent aussi — on ne peut pas faire ces gestes sans l'avoir lu.
   Corps { tout: true } → relève tout le courrier de la publication.   */
export async function handleInboxLu(request, env, inboxId) {
  const origin = getAllowedOrigin(env, request);
  await ensureDeskSchema(env);
  const row = await env.DB.prepare('SELECT pub_id FROM dk_inbox WHERE id = ?').bind(inboxId).first();
  if (!row) return err('Courrier introuvable', 404, origin);
  const u = await dkMemberGate(request, env, origin, row.pub_id);
  if (u.error) return u.error;
  const body = await parseBody(request).catch(() => ({}));
  if (body && body.tout) {
    await env.DB.prepare(`UPDATE dk_inbox SET lu_at = datetime('now') WHERE pub_id = ? AND lu_at IS NULL`).bind(row.pub_id).run();
  } else {
    await _marquerLu(env, inboxId);
  }
  const n = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM dk_inbox WHERE pub_id = ? AND lu_at IS NULL`).bind(row.pub_id).first())?.n || 0;
  return json({ ok: true, non_lus: n }, 200, origin);
}
async function _marquerLu(env, inboxId) {
  await env.DB.prepare(`UPDATE dk_inbox SET lu_at = datetime('now') WHERE id = ? AND lu_at IS NULL`).bind(inboxId).run().catch(() => {});
}

/* DELETE /api/desk/inbox/:id — EFFACER un courrier de la bannette.

   La bannette promet que rien ne se perd ; il faut donc une porte de
   sortie explicite pour ce qui n'a rien à y faire — un essai, un spam,
   ou un contributeur qui demande l'effacement de ses données. C'est le
   seul geste vraiment irréversible du module : le texte reçu et les
   pièces disparaissent pour de bon (côté client, confirmation en clair).

   L'ARTICLE issu de ce courrier n'est JAMAIS touché : il vit sa vie au
   marbre ou en page. On se contente de le signaler dans la réponse pour
   que l'interface puisse le dire.                                      */
export async function handleInboxDelete(request, env, inboxId) {
  const origin = getAllowedOrigin(env, request);
  await ensureDeskSchema(env);
  const row = await env.DB.prepare('SELECT * FROM dk_inbox WHERE id = ?').bind(inboxId).first();
  if (!row) return err('Courrier introuvable', 404, origin);
  const u = await dkMemberGate(request, env, origin, row.pub_id);
  if (u.error) return u.error;

  let atts = []; try { atts = JSON.parse(row.attachments || '[]'); } catch (_) {}
  // On ne purge que les objets R2 encore PROPRES à ce courrier : si le tri
  // les a promus au casier d'un article, ils appartiennent maintenant à
  // l'article et les effacer laisserait une pièce morte dans sa fiche.
  let pieces = 0;
  for (const a of atts) {
    if (!a || !a.r2_key) continue;
    const encoreAuCasier = await env.DB.prepare('SELECT 1 AS x FROM dk_files WHERE pub_id = ? AND r2_key = ? LIMIT 1')
      .bind(row.pub_id, a.r2_key).first();
    if (encoreAuCasier) continue;
    if (env.DK_CASIER) await env.DK_CASIER.delete(a.r2_key).catch(() => {});
    pieces++;
  }
  const art = row.art_id
    ? await env.DB.prepare('SELECT title FROM dk_articles WHERE id = ?').bind(row.art_id).first()
    : null;
  await env.DB.prepare('DELETE FROM dk_inbox WHERE id = ?').bind(inboxId).run();
  const repeches = await _repecherDiff(env, row.pub_id);
  return json({ ok: true, pieces_purgees: pieces, article_conserve: art ? art.title : null, ...(repeches ? { repeches } : {}) }, 200, origin);
}

// POST /api/desk/inbox/:id/reject — écarter (pièces R2 purgées, trace gardée).
export async function handleInboxReject(request, env, inboxId) {
  const origin = getAllowedOrigin(env, request);
  const g = await _inboxGate(request, env, origin, inboxId);
  if (g.error) return g.error;
  for (const a of g.atts) { if (env.DK_CASIER && a.r2_key) await env.DK_CASIER.delete(a.r2_key).catch(() => {}); }
  await env.DB.prepare(`UPDATE dk_inbox SET status = 'rejete', attachments = '[]', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`)
    .bind(dkByName(g.u), inboxId).run();
  await _marquerLu(env, inboxId);
  const repeches = await _repecherDiff(env, g.row.pub_id);
  return json({ ok: true, ...(repeches ? { repeches } : {}) }, 200, origin);
}
