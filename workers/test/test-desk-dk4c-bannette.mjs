/* ═══════════════════════════════════════════════════════════════
   desK DK-4c — LA BANNETTE (rien ne se perd sur une fausse manœuvre)

   Rejoue l'incident réel du 4 août 2026 : un courrier arrive, il est
   trié sur un article, l'article est supprimé ensuite — et la
   contribution devient introuvable dans l'app alors qu'elle dort
   intacte en base.

   Ce banc prouve que :
   · tout courrier reste dans la bannette, trié, écarté ou en attente ;
   · chaque entrée dit CE QU'ELLE EST DEVENUE (art_id + titre) ;
   · un article supprimé après coup est signalé (art_perdu) ;
   · on peut REPRENDRE le courrier : le texte et les pièces encore
     présentes en R2 repartent dans un nouvel article ;
   · un courrier encore au bac ne se « reprend » pas (on le trie) ;
   · l'écartement purge les pièces mais garde la trace lisible.

   Lancer le worker AVANT (voir test-desk-dk4.mjs), puis :
     node test/test-desk-dk4c-bannette.mjs
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
const A = jwt({ sub: 'dk4c-owner', owner: 'Rédactrice', email: 'redac@epaulette.dk4c' });
const INTRUS = jwt({ sub: 'dk4c-intrus', owner: 'Intrus', email: 'intrus@ailleurs.dk4c' });

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
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

async function main() {
  console.log('desK DK-4c — la bannette, sur', API, '\n');
  const ts = Date.now();
  const slug = `dk4c-${ts}`;
  const pub = await call(A, '/publication', { method: 'POST', body: { name: `Bannette ${ts}` } });
  const pubId = pub.data.publication.id;
  await call(A, '/publication/' + pubId, { method: 'PATCH', body: { slug } });
  const iss = await call(A, '/publication/' + pubId + '/issue', { method: 'POST', body: {
    num: '1', pages: 6, jalons: { bouclage: iso(20), maquette: iso(30), imprimeur: iso(37), parution: iso(45) },
  } });
  const issueId = iss.data.issue.id;

  /* ── 1 · L'incident : trié puis l'article supprimé ─────────────── */
  console.log('1 · L\'incident du 4 août rejoué');
  const pdf = Buffer.from(crypto.randomBytes(900)).toString('base64');
  let r = await inject({
    to: `${slug}@test.dk`, from_email: 'auteur@contrib.dk4c', from_name: 'Un Auteur',
    subject: 'Article test 2 Actu Minarm', body: 'texte test de contribution',
    attachments: [{ name: 'copie.pdf', b64: pdf }],
  });
  ok(r.status === 200 && r.data.mode === 'bac', 'courrier reçu → bac', r.data);
  const inboxId = r.data.inboxId;

  // On trie en créant un article (le geste exact de l'incident).
  const dRub = (await call(A, '/issue/' + issueId)).data.rubriques;
  const rubActu = dRub.find(x => /actu/i.test(x.name)) || dRub[0];
  const ap = await call(A, '/inbox/' + inboxId + '/apply', { method: 'POST', body: {
    create: { title: 'Article test 2 Actu Minarm', rub_id: rubActu.id, contrib: 'Un Auteur' },
  } });
  ok(ap.status === 200 && ap.data.art_id, 'tri confirmé → article créé au marbre', ap.data);
  const artId = ap.data.art_id;

  let c = await call(A, '/publication/' + pubId + '/courrier');
  ok(c.status === 200 && c.data.courrier.length === 1, 'la bannette montre le courrier MÊME trié', c.data.courrier);
  let e = c.data.courrier[0];
  ok(e.art_id === artId && e.art_title === 'Article test 2 Actu Minarm', 'elle dit à QUEL article il est rattaché', e);
  ok(e.art_perdu === false, 'article vivant → pas d\'alerte');
  ok(e.body === 'texte test de contribution', 'le texte reçu reste relisible', e.body);
  ok(e.attachments.length === 1, 'les pièces d\'origine restent listées');

  // LE geste fatal : l'article est supprimé après coup.
  const del = await call(A, '/article/' + artId, { method: 'DELETE' });
  ok(del.status === 200, 'article supprimé (la fausse manœuvre)');

  c = await call(A, '/publication/' + pubId + '/courrier');
  e = c.data.courrier[0];
  ok(c.data.courrier.length === 1, 'le courrier est TOUJOURS dans la bannette', c.data.courrier.length);
  ok(e.art_perdu === true, 'la bannette SIGNALE que l\'article a disparu', e);
  ok(e.body === 'texte test de contribution', 'et le texte est toujours là — rien n\'est perdu', e.body);

  /* ── 2 · Le filet : reprendre le courrier ──────────────────────── */
  console.log('\n2 · Reprendre le courrier');
  const rp = await call(A, '/inbox/' + inboxId + '/reprendre', { method: 'POST', body: {
    title: 'Article test 2 Actu Minarm (repris)', rub_id: rubActu.id, contrib: 'Un Auteur',
  } });
  ok(rp.status === 200 && rp.data.art_id && rp.data.art_id !== artId, 'reprise → nouvel article', rp.data);
  ok(rp.data.pieces === 1, 'la pièce d\'origine repart avec lui (objet R2 survivant)', rp.data);

  const d2 = await call(A, '/issue/' + issueId);
  const repris = d2.data.articles.find(a => a.id === rp.data.art_id);
  ok(repris && repris.status === 'remis', 'l\'article repris est « remis »', repris && repris.status);
  ok(repris && (repris.notes || '').includes('texte test de contribution'), 'le texte reçu est dans ses notes', repris && repris.notes);
  ok(/Repris depuis la bannette/.test(repris.histo || ''), 'son historique dit d\'où il vient', repris && repris.histo);
  ok(d2.data.files.some(f => f.art_id === rp.data.art_id), 'la pièce est bien dans son casier');

  c = await call(A, '/publication/' + pubId + '/courrier');
  ok(c.data.courrier[0].art_perdu === false && c.data.courrier[0].art_id === rp.data.art_id,
     'le courrier pointe désormais vers l\'article vivant', c.data.courrier[0]);

  /* ── 3 · Gardes ────────────────────────────────────────────────── */
  console.log('\n3 · Les gardes');
  const cx = await call(INTRUS, '/publication/' + pubId + '/courrier');
  ok(cx.status === 403 || cx.status === 404, 'un non-membre ne lit pas le courrier', cx.status);

  r = await inject({ to: `${slug}@test.dk`, from_email: 'autre@contrib.dk4c', subject: 'En attente', body: 'Un texte qui reste au bac.' });
  const pendId = r.data.inboxId;
  const rp2 = await call(A, '/inbox/' + pendId + '/reprendre', { method: 'POST', body: { title: 'Tentative' } });
  ok(rp2.status === 400, 'un courrier ENCORE au bac ne se reprend pas — il se trie', rp2.data);

  /* ── 4 · L'écartement garde la trace ───────────────────────────── */
  console.log('\n4 · Écarter n\'efface pas la trace');
  const rj = await call(A, '/inbox/' + pendId + '/reject', { method: 'POST' });
  ok(rj.status === 200, 'courrier écarté');
  c = await call(A, '/publication/' + pubId + '/courrier');
  const ec = c.data.courrier.find(x => x.id === pendId);
  ok(ec && ec.status === 'rejete', 'l\'écarté reste visible dans la bannette', ec && ec.status);
  ok(ec && ec.body === 'Un texte qui reste au bac.', 'son texte reste lisible', ec && ec.body);
  ok(ec && ec.attachments.length === 0, 'ses pièces ont bien été purgées');
  ok(c.data.courrier.length === 2, 'la bannette totalise TOUT le courrier reçu', c.data.courrier.length);

  /* ── 5 · Effacer un courrier (le seul geste sans retour) ────────
     La bannette promet que rien ne se perd ; il faut donc une porte de
     sortie franche pour l'essai, l'indésirable, ou l'effacement demandé
     par un contributeur. Deux pièges : ne pas emporter l'article qui en
     est issu, et ne pas purger une pièce déjà promue à son casier.     */
  console.log('\n5 · Effacer un courrier');
  const dx = await call(INTRUS, '/inbox/' + inboxId, { method: 'DELETE' });
  ok(dx.status === 403 || dx.status === 404, 'un non-membre n\'efface rien', dx.status);

  // Ce courrier a été REPRIS : sa pièce vit maintenant dans le casier de
  // l'article repris. L'effacer ne doit pas la lui arracher.
  const artRepris = rp.data.art_id;
  const dl2 = await call(A, '/inbox/' + inboxId, { method: 'DELETE' });
  ok(dl2.status === 200, 'courrier effacé', dl2.data);
  ok(dl2.data.article_conserve === 'Article test 2 Actu Minarm (repris)', 'la réponse rappelle l\'article conservé', dl2.data);
  ok(dl2.data.pieces_purgees === 0, 'la pièce promue au casier n\'est PAS purgée', dl2.data);

  const d3 = await call(A, '/issue/' + issueId);
  ok(d3.data.articles.some(a => a.id === artRepris), 'l\'article issu du courrier survit à l\'effacement');
  const fRepris = d3.data.files.find(f => f.art_id === artRepris);
  ok(!!fRepris, 'sa pièce est toujours dans son casier', d3.data.files.length);
  const dlUrl = await call(A, '/casier/' + fRepris.id + '/url');
  ok(dlUrl.status === 200 && dlUrl.data.url, 'et elle est toujours téléchargeable (objet R2 intact)', dlUrl.status);

  c = await call(A, '/publication/' + pubId + '/courrier');
  ok(!c.data.courrier.some(x => x.id === inboxId), 'le courrier a bien quitté la bannette');
  ok(c.data.courrier.length === 1, 'les autres courriers sont intacts', c.data.courrier.length);

  const dl3 = await call(A, '/inbox/' + inboxId, { method: 'DELETE' });
  ok(dl3.status === 404, 'effacer deux fois → 404 propre', dl3.status);

  /* ── 6 · La pastille « non lu » ─────────────────────────────────
     Partagée par l'équipe (bannette physique : relevé par l'un, relevé
     pour tous). Compte TOUT ce qui est arrivé sans avoir été ouvert —
     y compris un rattachement automatique, qui est une information même
     s'il n'appelle aucun geste.                                        */
  console.log('\n6 · La pastille « non lu »');
  const nonLus = async () => (await call(A, '/issue/' + issueId)).data.courrier_non_lus;
  const n0 = await nonLus();

  r = await inject({ to: `${slug}@test.dk`, from_email: 'neuf@contrib.dk4c', subject: 'Tout frais', body: 'Un courrier jamais ouvert.' });
  const neufId = r.data.inboxId;
  ok((await nonLus()) === n0 + 1, 'un courrier qui arrive incrémente la pastille', await nonLus());

  const cc = await call(A, '/publication/' + pubId + '/courrier');
  ok(cc.data.courrier.find(x => x.id === neufId).lu === false, 'la bannette le marque non lu', cc.data.courrier.find(x => x.id === neufId));

  const lu1 = await call(A, '/inbox/' + neufId + '/lu', { method: 'POST', body: {} });
  ok(lu1.status === 200 && lu1.data.non_lus === n0, 'l\'ouvrir le relève et décrémente la pastille', lu1.data);
  const cc2 = await call(A, '/publication/' + pubId + '/courrier');
  ok(cc2.data.courrier.find(x => x.id === neufId).lu === true, 'il est désormais lu');

  const lu2 = await call(A, '/inbox/' + neufId + '/lu', { method: 'POST', body: {} });
  ok(lu2.data.non_lus === n0, 'relever deux fois ne descend pas en dessous de zéro', lu2.data);

  // Trier vaut relever : on ne trie pas sans avoir lu.
  r = await inject({ to: `${slug}@test.dk`, from_email: 'autre2@contrib.dk4c', subject: 'À trier direct', body: 'Texte.' });
  const triId = r.data.inboxId;
  await call(A, '/inbox/' + triId + '/apply', { method: 'POST', body: { create: { title: 'Trié sans ouvrir', contrib: 'X' } } });
  ok((await nonLus()) === n0, 'trier un courrier le relève aussi', await nonLus());

  // « Tout marquer comme lu ».
  await inject({ to: `${slug}@test.dk`, from_email: 'a@contrib.dk4c', subject: 'Lot 1', body: 'A.' });
  await inject({ to: `${slug}@test.dk`, from_email: 'b@contrib.dk4c', subject: 'Lot 2', body: 'B.' });
  ok((await nonLus()) === n0 + 2, 'deux arrivées → pastille à +2', await nonLus());
  const tout = await call(A, '/inbox/' + neufId + '/lu', { method: 'POST', body: { tout: true } });
  ok(tout.data.non_lus === 0, '« tout marquer comme lu » vide la pastille', tout.data);

  const cx2 = await call(INTRUS, '/inbox/' + neufId + '/lu', { method: 'POST', body: {} });
  ok(cx2.status === 403 || cx2.status === 404, 'un non-membre ne relève rien', cx2.status);

  console.log(`\n${fail === 0 ? '✅' : '❌'} DK-4c : ${pass} vérifications passées, ${fail} en échec.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('Banc interrompu :', e); process.exit(1); });
