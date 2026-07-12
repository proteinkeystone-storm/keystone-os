/* ═══════════════════════════════════════════════════════════════
   desK DK-2 — suite E2E contre `wrangler dev --local`
   (marbre & bascule, multi-articles/emplacements, déplacement par
   insertion avec figées ancrées, opérations par lot, rituel de
   bouclage, isolation tenant = publication).

   Lancer le worker AVANT (voir README en bas), puis :
     node test/test-desk-dk2.mjs
   Variables : DK_API (défaut http://127.0.0.1:8799),
               DK_JWT_SECRET (défaut dk2-test-secret).

   Démarrage type :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --var KS_JWT_SECRET:dk2-test-secret --var "KS_ALLOWED_ORIGIN:*"
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

const API = process.env.DK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.DK_JWT_SECRET || 'dk2-test-secret';

// ── JWT HS256 minimal (mêmes claims que lib/jwt.js) ─────────────
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}
const A = jwt({ sub: 'dk2-owner-sub', owner: 'Stéphane', email: 'owner@test.dk' });
const B = jwt({ sub: 'dk2-member-sub', owner: 'Rédactrice', email: 'membre@test.dk' });
const C = jwt({ sub: 'dk2-intrus-sub', owner: 'Intrus', email: 'intrus@test.dk' });

async function call(token, path, opts = {}) {
  const res = await fetch(API + '/api/desk' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

const slotsOf = (d, n) => {
  const pg = d.data.pages.find(p => p.n === n);
  return d.data.slots.filter(s => s.page_id === pg.id).sort((a, b) => a.position - b.position);
};
const pageN = (d, n) => d.data.pages.find(p => p.n === n);

async function main() {
  console.log('desK DK-2 — suite E2E sur', API, '\n');

  // 1 · Santé
  const h = await fetch(API + '/api/desk/health').then(r => r.json());
  ok(h.ok && /^DK-\d/.test(h.engine) && h.schema === 'ready', 'health → moteur DK-2+, schéma prêt', h);

  // 2 · Publication + numéro
  const pub = await call(A, '/publication', { method: 'POST', body: { name: 'Revue Test DK-2 ' + Date.now() } });
  ok(pub.status === 200 && pub.data.publication?.id, 'création publication');
  const pubId = pub.data.publication.id;
  const iss = await call(A, '/publication/' + pubId + '/issue', { method: 'POST', body: {
    num: '143', theme: 'Test', pages: 12,
    jalons: { bouclage: iso(20), maquette: iso(30), imprimeur: iso(37), parution: iso(45) },
  } });
  ok(iss.status === 200 && iss.data.issue?.id, 'création numéro (12 pages)');
  const issueId = iss.data.issue.id;
  let d = await call(A, '/issue/' + issueId);
  ok(d.data.pages?.length === 12, '12 cartes-pages générées');
  ok(Array.isArray(d.data.slots) && d.data.slots.length === 0, 'GET issue expose slots (vides au départ)');
  ok(pageN(d, 1).kind === 'fixe' && pageN(d, 12).kind === 'fixe', 'couverture et 4ᵉ de couv figées');
  const rubId = d.data.rubriques[0].id;

  // 3 · Articles (marbre)
  const mk = async (title, extra = {}) =>
    (await call(A, '/publication/' + pubId + '/article', { method: 'POST', body: { title, status: 'attendu', due: iso(10), ...extra } })).data.article;
  const a1 = await mk('Papier principal', { contrib: 'Dupont' });
  const a2 = await mk('Encadré brèves');
  const a3 = await mk('Remplaçant du banc');
  const a4 = await mk('Dossier étalé');
  const a5 = await mk('Resté au banc', { fresh: 'date', perime: iso(40) });
  ok(a1 && a2 && a3 && a4 && a5, 'création de 5 articles');
  ok(a5.fresh === 'date' && a5.perime === iso(40), 'fraîcheur daté + péremption à la création', a5);

  // 4 · Emplacements (multi-articles par page, §2.4)
  const pg2 = pageN(d, 2);
  const s1 = await call(A, '/page/' + pg2.id + '/slot', { method: 'POST', body: { art_id: a1.id } });
  ok(s1.status === 200 && s1.data.slot.position === 0, 'réservation → emplacement 0');
  const dup = await call(A, '/page/' + pg2.id + '/slot', { method: 'POST', body: { art_id: a1.id } });
  ok(dup.status === 400, 'doublon du même article sur la même page refusé');
  const s2 = await call(A, '/page/' + pg2.id + '/slot', { method: 'POST', body: { art_id: a2.id } });
  ok(s2.status === 200 && s2.data.slot.position === 1, '2ᵉ article sur la même page → emplacement 1');
  d = await call(A, '/issue/' + issueId);
  ok(slotsOf(d, 2).length === 2 && pageN(d, 2).kind === 'article', 'page 2 porte 2 emplacements, kind article');

  // 5 · Banc + bascule au niveau de l'emplacement
  const slot0 = slotsOf(d, 2)[0];
  let r = await call(A, '/slot/' + slot0.id, { method: 'PATCH', body: { banc: [a3.id] } });
  ok(r.status === 200, 'banc posé sur l’emplacement');
  r = await call(A, '/slot/' + slot0.id, { method: 'PATCH', body: { art_id: a3.id, banc: [] } });
  ok(r.status === 200, 'bascule : le remplaçant devient titulaire de l’emplacement');
  r = await call(A, '/slot/' + slot0.id, { method: 'PATCH', body: { art_id: a2.id } });
  ok(r.status === 400, 'bascule vers un article déjà sur la page refusée');

  // 6 · Suppression d'emplacement → retassage / page vide
  const s2id = slotsOf(d, 2)[1].id;
  await call(A, '/slot/' + s2id, { method: 'DELETE' });
  d = await call(A, '/issue/' + issueId);
  ok(slotsOf(d, 2).length === 1 && pageN(d, 2).kind === 'article', 'suppression du 2ᵉ emplacement, page reste article');
  await call(A, '/slot/' + slotsOf(d, 2)[0].id, { method: 'DELETE' });
  d = await call(A, '/issue/' + issueId);
  ok(slotsOf(d, 2).length === 0 && pageN(d, 2).kind === 'vide', 'dernier emplacement retiré → page redevient vide');

  // 7 · Rubrique de page (pré-assignation) + garde-fous page
  r = await call(A, '/page/' + pg2.id, { method: 'PATCH', body: { rub_id: rubId } });
  ok(r.status === 200, 'rubrique prévue posée sur une page vide');
  r = await call(A, '/page/' + pg2.id, { method: 'PATCH', body: { rub_id: 'rub-inconnue' } });
  ok(r.status === 400, 'rubrique inconnue refusée');

  // 8 · Échange (drop SUR une carte) — les emplacements suivent
  const pg3 = pageN(d, 3);
  await call(A, '/page/' + pg3.id + '/slot', { method: 'POST', body: { art_id: a1.id } });
  r = await call(A, '/issue/' + issueId + '/swap', { method: 'POST', body: { a: 3, b: 5 } });
  ok(r.status === 200, 'échange des pages 3 et 5 accepté');
  d = await call(A, '/issue/' + issueId);
  ok(slotsOf(d, 5).length === 1 && slotsOf(d, 5)[0].art_id === a1.id && slotsOf(d, 3).length === 0,
    'l’emplacement a suivi le contenu (page 5)', d.data.slots);

  // 9 · Déplacement par insertion — figées ancrées (§3.5 révisé)
  const pg6 = pageN(d, 6);
  await call(A, '/page/' + pg6.id, { method: 'PATCH', body: { kind: 'fixe', fixe_tag: 'Pub vendue' } });
  // état : p5 = a1 ; p6 = figée ; on déplace [5] devant la page 2
  r = await call(A, '/issue/' + issueId + '/move', { method: 'POST', body: { from: [5], to: 2 } });
  ok(r.status === 200 && r.data.moved === 1, 'déplacement par insertion accepté');
  d = await call(A, '/issue/' + issueId);
  ok(slotsOf(d, 2).length === 1 && slotsOf(d, 2)[0].art_id === a1.id, 'le contenu déplacé s’est inséré page 2');
  ok(pageN(d, 6).kind === 'fixe' && pageN(d, 6).fixe_tag === 'Pub vendue', 'la page figée 6 est restée ancrée à son numéro');
  ok(pageN(d, 1).kind === 'fixe' && pageN(d, 12).kind === 'fixe', 'couverture / 4ᵉ de couv intactes');
  // figée seule sans embarquement → refus explicite ; avec embark → passe
  r = await call(A, '/issue/' + issueId + '/move', { method: 'POST', body: { from: [6], to: 9 } });
  ok(r.status === 400, 'déplacer une figée sans « embark » est refusé (ancrage)');
  r = await call(A, '/issue/' + issueId + '/move', { method: 'POST', body: { from: [6], to: 9, embark: true } });
  ok(r.status === 200, 'déplacer une figée avec embark:true passe');
  d = await call(A, '/issue/' + issueId);
  const fixeNow = d.data.pages.find(p => p.fixe_tag === 'Pub vendue');
  ok(fixeNow && fixeNow.n === 8, 'la figée embarquée a coulé vers sa nouvelle position (p. 8)', fixeNow && fixeNow.n);

  // 10 · Opérations par lot (§3.5)
  r = await call(A, '/issue/' + issueId + '/batch', { method: 'POST', body: { ns: [9, 10], op: 'rubrique', rub_id: rubId } });
  ok(r.status === 200 && r.data.done === 2, 'lot rubrique sur 2 pages');
  r = await call(A, '/issue/' + issueId + '/batch', { method: 'POST', body: { ns: [9, 10], op: 'spread', art_id: a4.id } });
  ok(r.status === 200 && r.data.done === 2, 'lot « étaler un article » (dossier → suite)');
  r = await call(A, '/issue/' + issueId + '/batch', { method: 'POST', body: { ns: [9, 10], op: 'spread', art_id: a4.id } });
  ok(r.status === 200 && r.data.done === 0 && r.data.skipped === 2, 'ré-étaler = ignoré proprement (déjà en place)');
  d = await call(A, '/issue/' + issueId);
  ok(slotsOf(d, 9)[0]?.art_id === a4.id && slotsOf(d, 10)[0]?.art_id === a4.id, 'l’article étalé est titulaire des 2 pages');
  r = await call(A, '/issue/' + issueId + '/batch', { method: 'POST', body: { ns: [9], op: 'contrib', contrib: 'Colonel Batch' } });
  ok(r.status === 200 && r.data.done === 1, 'lot contributeur sur le titulaire');
  d = await call(A, '/issue/' + issueId);
  ok(d.data.articles.find(x => x.id === a4.id)?.contrib === 'Colonel Batch', 'contributeur appliqué à l’article');
  r = await call(A, '/issue/' + issueId + '/batch', { method: 'POST', body: { ns: [11], op: 'fixe', fixe_tag: 'Sommaire' } });
  ok(r.status === 200 && r.data.done === 1, 'lot figer une page vide');
  r = await call(A, '/issue/' + issueId + '/batch', { method: 'POST', body: { ns: [9], op: 'fixe' } });
  ok(r.status === 200 && r.data.done === 0 && r.data.skipped === 1, 'figer une page qui porte un article = ignoré');
  r = await call(A, '/issue/' + issueId + '/batch', { method: 'POST', body: { ns: [11], op: 'libere' } });
  ok(r.status === 200 && r.data.done === 1, 'lot libérer la page figée');

  // 11 · Équipe & isolation tenant (= publication)
  await call(A, '/publication/' + pubId + '/invite', { method: 'POST', body: { email: 'membre@test.dk' } });
  const bb = await call(B, '/bootstrap');
  ok(bb.data.publications?.some(p => p.id === pubId), 'invitation auto-acceptée au bootstrap du membre');
  r = await call(B, '/issue/' + issueId);
  ok(r.status === 200, 'le membre lit le numéro');
  r = await call(C, '/issue/' + issueId);
  ok(r.status === 403, 'un tiers est refusé (403) — tenant = publication');
  r = await call(C, '/slot/' + slotsOf(d, 9)[0].id, { method: 'PATCH', body: { banc: [] } });
  ok(r.status === 403, 'un tiers ne touche pas un emplacement (403)');

  // 12 · Rituel de bouclage (§4)
  // état utile : a1 titulaire p2 (attendu), a4 titulaire p9-p10, a5 au banc de p2.
  d = await call(A, '/issue/' + issueId);
  await call(A, '/slot/' + slotsOf(d, 2)[0].id, { method: 'PATCH', body: { banc: [a5.id] } });
  r = await call(A, '/issue/' + issueId, { method: 'PATCH', body: { status: 'imprime' } });
  ok(r.status === 200 && r.data.boucle && r.data.boucle.published >= 2 && r.data.boucle.reversed >= 1,
    'passage en « imprimé » → rituel (publiés + reversés)', r.data.boucle);
  d = await call(A, '/issue/' + issueId);
  const a1f = d.data.articles.find(x => x.id === a1.id);
  const a5f = d.data.articles.find(x => x.id === a5.id);
  ok(a1f.status === 'publie' && /Publié au n° 143/.test(a1f.histo), 'titulaire marqué publié avec la page dans l’historique', a1f.histo);
  ok(a5f.status !== 'publie' && /Reversé au marbre après le n° 143/.test(a5f.histo), 'article du banc reversé au marbre (histo du report)', a5f.histo);
  ok(d.data.slots.every(s => (JSON.parse(s.banc || '[]')).length === 0), 'bancs du numéro vidés');
  r = await call(A, '/issue/' + issueId, { method: 'PATCH', body: { status: 'imprime' } });
  ok(r.status === 200 && !r.data.boucle, 're-PATCH « imprimé » ne rejoue pas le rituel');

  // 13 · Suppression d'article → nettoyage emplacements/bancs
  const a6 = await mk('À supprimer');
  const pg4 = pageN(d, 4);
  await call(A, '/page/' + pg4.id + '/slot', { method: 'POST', body: { art_id: a6.id } });
  r = await call(A, '/article/' + a6.id, { method: 'DELETE' });
  ok(r.status === 200, 'suppression de l’article acceptée');
  d = await call(A, '/issue/' + issueId);
  ok(slotsOf(d, 4).length === 0 && pageN(d, 4).kind === 'vide', 'emplacement nettoyé, page redevenue vide');

  console.log(`\n${pass + fail} tests — ${pass} ✓ / ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

function iso(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }

main().catch(e => { console.error('Suite interrompue :', e); process.exit(1); });
