/* ═══════════════════════════════════════════════════════════════
   desK DK-4 — suite E2E contre `wrangler dev --local`
   (adresse de dépôt : slug par publication ; digestion 3 étages via
   l'injection admin ; bac à trier : apply/reject, apprentissages
   e-mail + habitudes ; pièces jointes → casier ; spontanés → marbre).

   Lancer le worker AVANT :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --test-scheduled \
       --var KS_JWT_SECRET:dk2-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:dk4-admin --var DK_EMAIL_IA:off
   Puis :
     node test/test-desk-dk4.mjs
   (DK_EMAIL_IA:off = étage 2 IA coupé → suite déterministe hors réseau.)
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
const A = jwt({ sub: 'dk4-owner-sub', owner: 'Stéphane', email: 'owner@test.dk4' });
const C = jwt({ sub: 'dk4-intrus-sub', owner: 'Intrus', email: 'intrus@test.dk4' });

async function call(token, path, opts = {}) {
  const res = await fetch(API + '/api/desk' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const inject = (mail, token = ADMIN) => call(token, '/email-inject', { method: 'POST', body: mail });

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}
function iso(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }
const pageN = (d, n) => d.data.pages.find(p => p.n === n);
const artByTitle = (d, t) => d.data.articles.find(a => a.title === t);

async function main() {
  console.log('desK DK-4 — suite E2E sur', API, '\n');

  // 1 · Santé + slug de publication
  const h = await fetch(API + '/api/desk/health').then(r => r.json());
  ok(h.ok && h.engine === 'DK-4' && h.schema === 'ready', 'health → moteur DK-4, schéma prêt', h);
  const ts = Date.now();
  const pub = await call(A, '/publication', { method: 'POST', body: { name: `Revue Épreuve DK4 ${ts}` } });
  const pubId = pub.data.publication.id;
  const boot = await call(A, '/bootstrap');
  const myPub = boot.data.publications.find(p => p.id === pubId);
  ok(myPub && myPub.slug === `revue-epreuve-dk4-${ts}`, 'slug généré (minuscules, sans accent)', myPub && myPub.slug);
  const slug = `dk4-${ts}`;
  let r = await call(A, '/publication/' + pubId, { method: 'PATCH', body: { slug } });
  ok(r.status === 200, 'slug personnalisé accepté (propriétaire)');
  r = await call(A, '/publication/' + pubId, { method: 'PATCH', body: { slug: 'É pas bon!' } });
  ok(r.status === 400, 'slug invalide refusé');
  const pub2 = await call(A, '/publication', { method: 'POST', body: { name: `Autre revue ${ts}` } });
  r = await call(A, '/publication/' + pub2.data.publication.id, { method: 'PATCH', body: { slug } });
  ok(r.status === 409, 'slug déjà pris → 409');

  // 2 · Numéro + article attendu placé + contributeur connu
  const iss = await call(A, '/publication/' + pubId + '/issue', { method: 'POST', body: {
    num: '146', pages: 10, jalons: { bouclage: iso(20), maquette: iso(30), imprimeur: iso(37), parution: iso(45) },
  } });
  const issueId = iss.data.issue.id;
  const mkArt = async (title, extra = {}) =>
    (await call(A, '/publication/' + pubId + '/article', { method: 'POST', body: { title, status: 'attendu', due: iso(5), ...extra } })).data.article;
  const a1 = await mkArt('La cavalerie légère en manœuvre', { contrib: 'Dupont' });
  const a2 = await mkArt('Portrait sans page prévue', { contrib: 'Martin' });
  const a3 = await mkArt('Histoire du recrutement alsacien', { contrib: 'Inconnu Placé' });
  let d = await call(A, '/issue/' + issueId);
  await call(A, '/page/' + pageN(d, 3).id + '/slot', { method: 'POST', body: { art_id: a1.id } });
  await call(A, '/page/' + pageN(d, 5).id + '/slot', { method: 'POST', body: { art_id: a3.id } });
  await call(A, '/publication/' + pubId + '/contrib', { method: 'POST', body: { name: 'Dupont', email: 'dupont@contrib.dk4' } });
  await call(A, '/publication/' + pubId + '/contrib', { method: 'POST', body: { name: 'Martin', email: 'martin@contrib.dk4' } });
  d = await call(A, '/issue/' + issueId);
  ok(Array.isArray(d.data.inbox) && d.data.inbox.length === 0, 'payload expose inbox (vide)');
  ok(d.data.email && d.data.email.slug === slug, 'payload expose l\'adresse (slug)', d.data.email);

  // 3 · Gardes de l'injection
  r = await inject({ to: `redaction-${slug}@test.dk`, from_email: 'x@y.z', subject: 'x', body: 'x' }, 'mauvais-secret');
  ok(r.status === 401, 'injection sans secret admin → 401');
  r = await inject({ to: 'redaction-inexistante@test.dk', from_email: 'x@y.z', subject: 'x', body: 'x' });
  ok(r.status === 400 && r.data.reason === 'adresse', 'adresse inconnue → rejet propre');

  // 4 · Étage 1 — rapprochement déterministe AUTO (expéditeur connu, article placé)
  const jpg = Buffer.from(crypto.randomBytes(1500)).toString('base64');
  r = await inject({
    to: `redaction-${slug}@test.dk`, from_email: 'dupont@contrib.dk4', from_name: 'Col. Dupont',
    subject: 'Ma copie', body: 'Voici mon papier complet pour le prochain numéro.',
    attachments: [{ name: 'cavalerie.jpg', b64: jpg }, { name: 'virus.exe', b64: jpg }],
  });
  ok(r.status === 200 && r.data.mode === 'auto', 'expéditeur connu + article placé → rattachement AUTO', r.data);
  d = await call(A, '/issue/' + issueId);
  const a1b = artByTitle(d, 'La cavalerie légère en manœuvre');
  ok(a1b.status === 'remis', 'article pointé « remis » automatiquement');
  ok(/Copie reçue par e-mail de Col\. Dupont/.test(a1b.histo), 'historique : copie reçue par e-mail', a1b.histo);
  ok(a1b.notes.includes('papier complet'), 'corps du mail versé aux notes');
  const f1 = d.data.files.find(f => f.art_id === a1.id);
  ok(f1 && f1.page_id === pageN(d, 3).id && f1.status === 'ok', 'pièce jointe whitelistée → casier de la page 3');
  ok(!d.data.files.some(f => (f.name || '').includes('virus')), 'pièce hors whitelist ignorée (.exe)');
  ok(d.data.inbox.length === 0, 'rien au bac (trace auto seulement)');
  const dl = await call(A, '/casier/' + f1.id + '/url');
  ok(dl.status === 200 && dl.data.url, 'pièce issue de l\'e-mail téléchargeable');

  // 5 · Étage 1 — expéditeur connu mais article SANS page → bac pré-coché
  r = await inject({ to: `redaction-${slug}@test.dk`, from_email: 'martin@contrib.dk4', from_name: 'Martin', subject: 'papier', body: 'Le portrait promis, en pièce jointe.', attachments: [{ name: 'portrait.pdf', b64: jpg }] });
  ok(r.status === 200 && r.data.mode === 'bac' && r.data.suggestion.via === 'expediteur', 'article non placé → bac, suggestion expéditeur', r.data);
  d = await call(A, '/issue/' + issueId);
  ok(d.data.inbox.length === 1, 'bac : 1 entrée en attente');
  const rowMartin = d.data.inbox[0];

  // 6 · Étage 2 — recoupement lexical (expéditeur inconnu)
  r = await inject({ to: `redaction-${slug}@test.dk`, from_email: 'nouveau@contrib.dk4', subject: 'Histoire du recrutement alsacien — version finale', body: 'Ci-joint le texte.' });
  ok(r.status === 200 && r.data.mode === 'bac' && r.data.suggestion.via === 'titre' && r.data.suggestion.art_id === a3.id, 'objet ≈ titre attendu → suggestion « titre »', r.data.suggestion);
  const rowTitre = r.data.inboxId;

  // 7 · Étage 2 — spontané sans indice (IA coupée) → bac sans suggestion
  r = await inject({ to: `redaction-${slug}@test.dk`, from_email: 'poete@libre.dk4', from_name: 'Le Poète', subject: 'Un texte libre pour vous', body: 'Quelques vers pour la revue, si le cœur vous en dit. '.repeat(3) });
  ok(r.status === 200 && r.data.mode === 'bac' && r.data.suggestion.kind === 'spontane' && r.data.suggestion.via === 'aucune', 'spontané inconnu (IA off) → bac sans pari', r.data.suggestion);
  const rowPoete = r.data.inboxId;

  // 8 · Bac : intrus refusé, apply article, apply create (+ apprentissages)
  d = await call(A, '/issue/' + issueId);
  r = await call(C, '/inbox/' + rowMartin.id + '/apply', { method: 'POST', body: { art_id: a2.id } });
  ok(r.status === 403, 'intrus : apply refusé (tenant = publication)');
  r = await call(A, '/inbox/' + rowMartin.id + '/apply', { method: 'POST', body: { art_id: a2.id } });
  ok(r.status === 200, 'apply → rattachement à l\'article suggéré');
  d = await call(A, '/issue/' + issueId);
  const a2b = artByTitle(d, 'Portrait sans page prévue');
  ok(a2b.status === 'remis' && /confirmée par/.test(a2b.histo), 'article non placé pointé remis (confirmation humaine)');
  const fMartin = d.data.files.find(f => f.art_id === a2.id);
  ok(fMartin && fMartin.page_id === '' && fMartin.status === 'ok', 'pièce versée « au marbre avec l\'article » (page_id vide)');
  r = await call(A, '/inbox/' + rowMartin.id + '/apply', { method: 'POST', body: { art_id: a2.id } });
  ok(r.status === 400, 'apply rejoué → 400 (déjà triée)');

  const rubHistoire = d.data.rubriques.find(x => x.name === 'Histoire');
  r = await call(A, '/inbox/' + rowPoete + '/apply', { method: 'POST', body: { create: { title: 'Vers libres', rub_id: rubHistoire.id, contrib: 'Le Poète' } } });
  ok(r.status === 200, 'spontané confirmé → nouvel article au marbre');
  d = await call(A, '/issue/' + issueId);
  const poem = artByTitle(d, 'Vers libres');
  ok(poem && poem.status === 'remis' && poem.rub_id === rubHistoire.id && poem.contrib === 'Le Poète', 'article spontané créé (remis, rubrique, contributeur)');
  ok(poem.notes.includes('Quelques vers'), 'corps du mail = notes du spontané');
  ok(d.data.contribs.some(c => c.name === 'Le Poète' && c.email === 'poete@libre.dk4'), 'e-mail du nouveau contributeur mémorisé');

  // 9 · Habitude apprise → suggestion déterministe au mail suivant
  r = await inject({ to: `redaction-${slug}@test.dk`, from_email: 'poete@libre.dk4', subject: 'Encore des textes', body: 'Une nouvelle salve de propositions pour vous.' });
  ok(r.status === 200 && r.data.suggestion.via === 'habitude' && r.data.suggestion.rub_id === rubHistoire.id, 'mails du Poète → rubrique Histoire (habitude, sans IA)', r.data.suggestion);
  const rowHabit = r.data.inboxId;

  // 10 · Reject : entrée écartée, plus au bac
  r = await call(A, '/inbox/' + rowHabit + '/reject', { method: 'POST' });
  ok(r.status === 200, 'reject accepté');
  r = await call(A, '/inbox/' + rowTitre + '/reject', { method: 'POST' });
  d = await call(A, '/issue/' + issueId);
  ok(d.data.inbox.length === 0, 'bac vidé (apply + reject)');

  console.log(`\n${pass} ✓ · ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('Suite interrompue :', e); process.exit(1); });
