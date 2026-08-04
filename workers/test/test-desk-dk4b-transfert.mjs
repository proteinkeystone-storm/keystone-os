/* ═══════════════════════════════════════════════════════════════
   desK DK-4b — le mail TRANSFÉRÉ & la protection des habitudes
   (contre `wrangler dev --local`, via l'injection admin)

   Ce que ce banc prouve :
   · un mail transféré par la rédaction est attribué à l'AUTEUR lu dans
     le bloc « De : », pas à la personne qui fait suivre → le
     rapprochement automatique se déclenche, la page s'allume ;
   · le transfert est visible (orig_email exposé au bac) ;
   · un mail ORDINAIRE qui cite « De : » sans se déclarer transfert
     n'est PAS détourné (garde-fou anti-usurpation) ;
   · confirmer un spontané transféré apprend l'adresse de l'AUTEUR ;
   · aucune habitude « ses mails vont en rubrique X » n'est posée sur
     une adresse de l'ÉQUIPE — c'est elle qui polluait les règles.

   Lancer le worker AVANT :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --test-scheduled \
       --var KS_JWT_SECRET:dk2-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:dk4-admin --var DK_EMAIL_IA:off
   Puis :
     node test/test-desk-dk4b-transfert.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

const API = process.env.DK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.DK_JWT_SECRET || 'dk2-test-secret';
const ADMIN = process.env.DK_ADMIN || 'dk4-admin';

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}
// La propriétaire = la rédactrice en chef. Son adresse est celle de l'ÉQUIPE.
const REDAC = 'redactrice@epaulette.dk4b';
const A = jwt({ sub: 'dk4b-owner-sub', owner: 'Rédactrice', email: REDAC });

async function call(token, path, opts = {}) {
  const res = await fetch(API + '/api/desk' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const inject = (mail) => call(ADMIN, '/email-inject', { method: 'POST', body: mail });

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const pageN = (d, n) => d.data.pages.find(p => p.n === n);
const artByTitle = (d, t) => d.data.articles.find(a => a.title === t);

// Le corps que produit un vrai client de messagerie quand on transfère.
const forwarded = (author, authorMail, texte) =>
  `Bonjour, voici la copie reçue à l'instant.\n\n` +
  `---------- Message transféré ---------\n` +
  `De : ${author} <${authorMail}>\n` +
  `Date : lun. 4 août 2026 à 09:12\n` +
  `Objet : Ma copie\n` +
  `À : Rédaction <${REDAC}>\n\n` +
  texte;

async function main() {
  console.log('desK DK-4b — transfert & habitudes, sur', API, '\n');
  const ts = Date.now();
  const slug = `dk4b-${ts}`;
  const pub = await call(A, '/publication', { method: 'POST', body: { name: `L'Épaulette DK4b ${ts}` } });
  const pubId = pub.data.publication.id;
  await call(A, '/publication/' + pubId, { method: 'PATCH', body: { slug } });

  const iss = await call(A, '/publication/' + pubId + '/issue', { method: 'POST', body: {
    num: '234', pages: 12, jalons: { bouclage: iso(20), maquette: iso(30), imprimeur: iso(37), parution: iso(45) },
  } });
  const issueId = iss.data.issue.id;
  const mkArt = async (title, extra = {}) =>
    (await call(A, '/publication/' + pubId + '/article', { method: 'POST', body: { title, status: 'attendu', due: iso(5), ...extra } })).data.article;

  /* ── 1 · Un mail TRANSFÉRÉ se range au nom de l'auteur ───────────
     La rédactrice a convenu du papier avec Rancher et enregistré son
     adresse. Elle transfère la copie : c'est SON enveloppe à elle, mais
     l'auteur doit être reconnu et la page 3 doit s'allumer.          */
  console.log('1 · Le mail transféré');
  const a1 = await mkArt('Les drogues et la guerre', { contrib: 'Col. Rancher' });
  let d = await call(A, '/issue/' + issueId);
  await call(A, '/page/' + pageN(d, 3).id + '/slot', { method: 'POST', body: { art_id: a1.id } });
  await call(A, '/publication/' + pubId + '/contrib', { method: 'POST', body: { name: 'Col. Rancher', email: 'rancher@contrib.dk4b' } });

  const jpg = Buffer.from(crypto.randomBytes(1200)).toString('base64');
  let r = await inject({
    to: `${slug}@test.dk`, from_email: REDAC, from_name: 'Rédactrice',
    subject: 'Tr : Ma copie',
    body: forwarded('Colonel Rancher', 'rancher@contrib.dk4b', 'Voici mon papier sur les drogues, avec une photo.'),
    attachments: [{ name: 'rancher.jpg', b64: jpg }],
  });
  ok(r.status === 200 && r.data.mode === 'auto', 'transfert → rattachement AUTO malgré l\'enveloppe de la rédactrice', r.data);
  ok(r.data.orig_email === 'rancher@contrib.dk4b', 'l\'auteur d\'origine est reconnu', r.data);

  d = await call(A, '/issue/' + issueId);
  const a1b = artByTitle(d, 'Les drogues et la guerre');
  ok(a1b.status === 'remis', 'article pointé « remis » — la page 3 s\'allume');
  ok(/Colonel Rancher/.test(a1b.histo), 'historique au nom de l\'AUTEUR', a1b.histo);
  ok(/transféré par/.test(a1b.histo), 'historique mentionne le transfert', a1b.histo);
  const f1 = d.data.files.find(f => f.art_id === a1.id);
  ok(f1 && f1.page_id === pageN(d, 3).id, 'pièce jointe versée au casier de la page 3');
  ok(f1 && !/redactrice/.test(f1.uploaded_by || ''), 'la pièce est signée de l\'auteur, pas du relais', f1 && f1.uploaded_by);

  /* ── 2 · Un mail ORDINAIRE n'est jamais détourné ─────────────────
     Un contributeur qui cite « De : quelqu'un » dans son propre mail
     ne doit pas se voir attribuer la paternité d'un autre.           */
  console.log('\n2 · Le garde-fou anti-usurpation');
  const a2 = await mkArt('La France est-elle encore la France', { contrib: 'Mme Vasseur' });
  d = await call(A, '/issue/' + issueId);
  await call(A, '/page/' + pageN(d, 5).id + '/slot', { method: 'POST', body: { art_id: a2.id } });
  await call(A, '/publication/' + pubId + '/contrib', { method: 'POST', body: { name: 'Mme Vasseur', email: 'vasseur@contrib.dk4b' } });

  r = await inject({
    to: `${slug}@test.dk`, from_email: 'vasseur@contrib.dk4b', from_name: 'Mme Vasseur',
    subject: 'Ma copie',   // PAS « Tr: », PAS de séparateur de transfert
    body: 'Bonjour,\nComme me l\'a écrit un ami — De : rancher@contrib.dk4b — le sujet est brûlant.\nVoici mon texte.',
  });
  ok(r.status === 200 && r.data.mode === 'auto', 'mail ordinaire → rattachement normal', r.data);
  ok(!r.data.orig_email, 'un « De : » cité SANS déclaration de transfert est ignoré', r.data);
  d = await call(A, '/issue/' + issueId);
  const a2b = artByTitle(d, 'La France est-elle encore la France');
  ok(a2b.status === 'remis' && /Mme Vasseur/.test(a2b.histo), 'le papier reste attribué à sa vraie autrice', a2b.histo);

  /* ── 3 · Le bac montre le transfert et apprend le bon auteur ─────
     Spontané transféré : l'entrée doit nommer l'auteur, et la
     confirmation doit retenir SON adresse, pas celle du relais.      */
  console.log('\n3 · Le bac : ce qu\'il montre, ce qu\'il retient');
  const rubs = (await call(A, '/issue/' + issueId)).data.rubriques;
  const rubHist = rubs.find(x => /histoire/i.test(x.name)) || rubs[0];

  r = await inject({
    to: `${slug}@test.dk`, from_email: REDAC, from_name: 'Rédactrice',
    subject: 'Tr : Une proposition',
    body: forwarded('Capitaine Nogaro', 'nogaro@contrib.dk4b', 'Je vous propose un texte sur le recrutement.'),
  });
  ok(r.status === 200 && r.data.mode === 'bac', 'auteur inconnu transféré → bac', r.data);
  ok(r.data.orig_email === 'nogaro@contrib.dk4b', 'le bac retient l\'auteur d\'origine', r.data);
  d = await call(A, '/issue/' + issueId);
  const entry = d.data.inbox.find(x => x.id === r.data.inboxId);
  ok(entry && entry.orig_email === 'nogaro@contrib.dk4b', 'orig_email exposé au front (le bac peut nommer l\'auteur)', entry);
  ok(entry && entry.from_email === REDAC, 'l\'enveloppe reste visible (qui a transféré)', entry && entry.from_email);

  const ap = await call(A, '/inbox/' + entry.id + '/apply', { method: 'POST', body: {
    create: { title: 'Le recrutement aujourd\'hui', rub_id: rubHist.id, contrib: 'Capitaine Nogaro' },
  } });
  ok(ap.status === 200, 'confirmation du spontané');
  d = await call(A, '/issue/' + issueId);
  const cNogaro = d.data.contribs.find(c => c.name === 'Capitaine Nogaro');
  ok(cNogaro && cNogaro.email === 'nogaro@contrib.dk4b', 'l\'app retient l\'adresse de l\'AUTEUR', cNogaro);
  ok(!d.data.contribs.some(c => c.email === REDAC), 'l\'adresse de la rédactrice n\'est jamais retenue comme contributrice',
     d.data.contribs);

  /* ── 4 · Aucune habitude sur une adresse de l'équipe ─────────────
     C'est le défaut visé : elle transfère de tout, à toutes les
     rubriques. Une règle « ses mails → rubrique X » ne dirait rien de
     vrai et se réécrirait à chaque tri.                              */
  console.log('\n4 · Les habitudes ne se posent pas sur l\'équipe');
  // Un transfert SANS bloc « De : » lisible : l'auteur reste la rédactrice.
  r = await inject({
    to: `${slug}@test.dk`, from_email: REDAC, from_name: 'Rédactrice',
    subject: 'Une note interne', body: 'Un texte que je verse moi-même au marbre, sans auteur externe.',
  });
  ok(r.status === 200 && r.data.mode === 'bac' && !r.data.orig_email, 'mail propre de la rédactrice → bac, sans auteur d\'origine', r.data);
  d = await call(A, '/issue/' + issueId);
  const e2 = d.data.inbox.find(x => x.id === r.data.inboxId);
  const ap2 = await call(A, '/inbox/' + e2.id + '/apply', { method: 'POST', body: {
    create: { title: 'Note interne de la rédaction', rub_id: rubHist.id, contrib: 'La rédaction' },
  } });
  ok(ap2.status === 200, 'confirmation de la note interne');

  // La preuve : un NOUVEAU mail de la rédactrice ne doit hériter d'AUCUNE
  // habitude de rubrique. Sans la garde, la règle posée ci-dessus le pré-
  // classerait en « Histoire » — et se réécrirait au tri suivant.
  r = await inject({
    to: `${slug}@test.dk`, from_email: REDAC, from_name: 'Rédactrice',
    subject: 'Autre sujet sans rapport', body: 'Un second texte, qui n\'a rien à voir avec la rubrique précédente.',
  });
  ok(r.status === 200 && r.data.mode === 'bac', 'second mail de la rédactrice → bac');
  ok(r.data.suggestion && r.data.suggestion.via !== 'habitude',
     'AUCUNE habitude apprise sur l\'adresse de l\'équipe', r.data.suggestion);

  // Contre-épreuve : sur un CONTRIBUTEUR, l'habitude fonctionne toujours.
  r = await inject({
    to: `${slug}@test.dk`, from_email: 'lambert@contrib.dk4b', from_name: 'Lambert',
    subject: 'Un premier envoi', body: 'Texte initial de Lambert, sans rapport avec les titres attendus.',
  });
  d = await call(A, '/issue/' + issueId);
  const e3 = d.data.inbox.find(x => x.id === r.data.inboxId);
  await call(A, '/inbox/' + e3.id + '/apply', { method: 'POST', body: {
    create: { title: 'Le premier papier de Lambert', rub_id: rubHist.id, contrib: 'Lambert' },
  } });
  r = await inject({
    to: `${slug}@test.dk`, from_email: 'lambert@contrib.dk4b', from_name: 'Lambert',
    subject: 'Un second envoi', body: 'Un autre texte de Lambert, toujours sans rapport avec les titres attendus.',
  });
  ok(r.data.suggestion && r.data.suggestion.via === 'habitude' && r.data.suggestion.rub_id === rubHist.id,
     'contre-épreuve : l\'habitude marche toujours sur un vrai contributeur', r.data.suggestion);

  console.log(`\n${fail === 0 ? '✅' : '❌'} DK-4b : ${pass} vérifications passées, ${fail} en échec.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('Banc interrompu :', e); process.exit(1); });
