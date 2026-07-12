/* ═══════════════════════════════════════════════════════════════
   desK DK-3 — suite E2E contre `wrangler dev --local`
   (casier R2 : dépôt direct streamé, whitelist, quota, lien de
   téléchargement à jeton, pièces qui suivent la carte au swap/move,
   purge post-impression avec rétention marbre ; contributeurs :
   e-mail mémorisé + retard moyen au pointage ; relances : gardes).

   Lancer le worker AVANT (mode scheduled activé pour la purge) :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --test-scheduled \
       --var KS_JWT_SECRET:dk2-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var DK_CASIER_GRACE_DAYS:0
   Puis :
     node test/test-desk-dk3.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

const API = process.env.DK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.DK_JWT_SECRET || 'dk2-test-secret';

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}
const A = jwt({ sub: 'dk3-owner-sub', owner: 'Stéphane', email: 'owner@test.dk3' });
const C = jwt({ sub: 'dk3-intrus-sub', owner: 'Intrus', email: 'intrus@test.dk3' });

async function call(token, path, opts = {}) {
  const res = await fetch(API + '/api/desk' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function putBlob(token, path, bytes, type = 'application/octet-stream') {
  const res = await fetch(API + '/api/desk' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': type },
    body: bytes,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}
function iso(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }
const pageN = (d, n) => d.data.pages.find(p => p.n === n);
const filesOn = (d, n) => { const pg = pageN(d, n); return d.data.files.filter(f => f.page_id === pg.id); };

async function main() {
  console.log('desK DK-3 — suite E2E sur', API, '\n');

  // 1 · Santé
  const h = await fetch(API + '/api/desk/health').then(r => r.json());
  ok(h.ok && /^DK-\d/.test(h.engine) && h.schema === 'ready', 'health → moteur DK-3+, schéma prêt', h);

  // 2 · Publication + numéro + article attendu en retard
  const pub = await call(A, '/publication', { method: 'POST', body: { name: 'Revue Test DK-3 ' + Date.now() } });
  ok(pub.status === 200 && pub.data.publication?.id, 'création publication');
  const pubId = pub.data.publication.id;
  const iss = await call(A, '/publication/' + pubId + '/issue', { method: 'POST', body: {
    num: '144', theme: 'Casier', pages: 12,
    jalons: { bouclage: iso(20), maquette: iso(30), imprimeur: iso(37), parution: iso(45) },
  } });
  const issueId = iss.data.issue.id;
  const a1 = (await call(A, '/publication/' + pubId + '/article', { method: 'POST', body: {
    title: 'Papier en retard', status: 'attendu', due: iso(-3), contrib: 'Dupont',
  } })).data.article;
  ok(!!a1, 'création article attendu (remise J−3, contrib Dupont)');
  let d = await call(A, '/issue/' + issueId);
  await call(A, '/page/' + pageN(d, 3).id + '/slot', { method: 'POST', body: { art_id: a1.id } });

  // 3 · Payload DK-3
  d = await call(A, '/issue/' + issueId);
  ok(Array.isArray(d.data.files) && Array.isArray(d.data.contribs) && Array.isArray(d.data.relances), 'GET issue expose files / contribs / relances');
  ok(d.data.quota && d.data.quota.max > 0 && d.data.quota.used === 0, 'quota exposé (0 utilisé)', d.data.quota);
  ok(d.data.casier === 'direct', 'casier en mode direct (pas de clés S3 en local)', d.data.casier);
  ok(d.data.mailer === false, 'mailer signalé absent (pas de clé Resend en local)');

  // 4 · Gardes du dépôt
  const p3 = pageN(d, 3);
  let r = await call(A, '/page/' + p3.id + '/casier', { method: 'POST', body: { name: 'virus.exe', size: 100 } });
  ok(r.status === 400, 'extension hors whitelist refusée (.exe)', r.data);
  r = await call(A, '/page/' + p3.id + '/casier', { method: 'POST', body: { name: 'photo.jpg', size: 200 * 1024 * 1024 } });
  ok(r.status === 413, 'fichier > 150 Mo refusé', r.data);
  r = await call(C, '/page/' + p3.id + '/casier', { method: 'POST', body: { name: 'photo.jpg', size: 100 } });
  ok(r.status === 403, 'intrus : demande de dépôt refusée (403)');

  // 5 · Dépôt direct streamé
  const bytes = crypto.randomBytes(2048);
  r = await call(A, '/page/' + p3.id + '/casier', { method: 'POST', body: { name: 'photo HD.jpg', size: bytes.length } });
  ok(r.status === 200 && r.data.upload?.mode === 'direct' && r.data.file?.id, 'demande de dépôt → mode direct + pièce pending', r.data);
  const f1 = r.data.file;
  ok(r.data.file.art_id === a1.id, 'pièce rattachée d\'office à l\'article titulaire de la page');
  r = await putBlob(A, r.data.upload.path, bytes, 'image/jpeg');
  ok(r.status === 200 && r.data.file?.status === 'ok' && r.data.file.size === bytes.length, 'dépôt direct → ok, taille réelle enregistrée', r.data);
  d = await call(A, '/issue/' + issueId);
  ok(filesOn(d, 3).length === 1 && filesOn(d, 3)[0].status === 'ok', 'pièce listée sur la page 3');
  ok(d.data.quota.used === bytes.length, 'quota du numéro = taille de la pièce', d.data.quota);

  // 6 · Lien de téléchargement à jeton
  r = await call(A, '/casier/' + f1.id + '/url');
  ok(r.status === 200 && r.data.url && r.data.url.includes('/dl?'), 'lien de téléchargement émis (mode jeton)', r.data);
  const dl = await fetch(r.data.url);
  const body = Buffer.from(await dl.arrayBuffer());
  ok(dl.status === 200 && body.equals(bytes), 'téléchargement : octets identiques');
  ok((dl.headers.get('content-disposition') || '').includes('photo HD.jpg'), 'content-disposition porte le nom du fichier');
  const bad = await fetch(r.data.url.replace(/t=\w{6}/, 't=000000'));
  ok(bad.status === 403, 'jeton falsifié → 403');
  r = await call(C, '/casier/' + f1.id + '/url');
  ok(r.status === 403, 'intrus : lien de téléchargement refusé (403)');

  // 7 · Les pièces suivent la carte (swap puis move)
  await call(A, '/issue/' + issueId + '/swap', { method: 'POST', body: { a: 3, b: 5 } });
  d = await call(A, '/issue/' + issueId);
  ok(filesOn(d, 5).length === 1 && filesOn(d, 3).length === 0, 'swap 3↔5 : la pièce suit le contenu en page 5');
  await call(A, '/issue/' + issueId + '/move', { method: 'POST', body: { from: [5], to: 2 } });
  d = await call(A, '/issue/' + issueId);
  ok(filesOn(d, 2).length === 1, 'move 5→2 : la pièce suit l\'insertion en page 2');

  // 8 · Contributeurs : e-mail mémorisé + retard moyen au pointage
  r = await call(A, '/publication/' + pubId + '/contrib', { method: 'POST', body: { name: 'Dupont', email: 'dupont@test.dk3' } });
  ok(r.status === 200 && r.data.contrib?.email === 'dupont@test.dk3', 'e-mail du contributeur mémorisé');
  // Relance : garde mailer (article encore attendu, pas de clé Resend en local)
  r = await call(A, '/article/' + a1.id + '/relance', { method: 'POST', body: { email: 'dupont@test.dk3', subject: 'Test', body: 'Corps' } });
  ok(r.status === 503, 'relance sans clé Resend → 503 propre', r.data);
  // Pointage → stats internes (retard ~3 j)
  await call(A, '/article/' + a1.id, { method: 'PATCH', body: { status: 'remis' } });
  d = await call(A, '/issue/' + issueId);
  const dup = d.data.contribs.find(c => c.name === 'Dupont');
  ok(dup && dup.n_remises === 1 && dup.total_delay >= 2 && dup.total_delay <= 4, 'pointage → retard moyen interne nourri (≈3 j)', dup);
  // Relance sur copie déjà remise → 400 (plus d'objet)
  r = await call(A, '/article/' + a1.id + '/relance', { method: 'POST', body: { email: 'dupont@test.dk3', subject: 'Test', body: 'Corps' } });
  ok(r.status === 400, 'relance après pointage → 400 (plus d\'objet)', r.data);

  // 9 · Suppression d'une pièce
  r = await call(A, '/casier/' + f1.id, { method: 'DELETE' });
  d = await call(A, '/issue/' + issueId);
  ok(r.status === 200 && d.data.files.length === 0 && d.data.quota.used === 0, 'pièce supprimée, quota rendu');

  // 10 · Purge post-impression + rétention marbre
  // a7 = article au BANC porteur d'une pièce ; réservé aussi au n° suivant → sa pièce survit.
  const a7 = (await call(A, '/publication/' + pubId + '/article', { method: 'POST', body: { title: 'Reporté avec photos', status: 'remis', contrib: 'Martin' } })).data.article;
  const upload = async (pgId, name, artId) => {
    const req = await call(A, '/page/' + pgId + '/casier', { method: 'POST', body: { name, size: 64, art_id: artId } });
    await putBlob(A, req.data.upload.path, crypto.randomBytes(64));
    return req.data.file;
  };
  d = await call(A, '/issue/' + issueId);
  const fA = await upload(pageN(d, 2).id, 'purgeable.pdf', null);       // sans article → purgée
  const fB = await upload(pageN(d, 7).id, 'retenue.jpg', a7.id);        // article réservé ailleurs → retenue
  const iss2 = await call(A, '/publication/' + pubId + '/issue', { method: 'POST', body: { num: '145', pages: 8, jalons: {} } });
  const d2 = await call(A, '/issue/' + iss2.data.issue.id);
  await call(A, '/page/' + pageN(d2, 3).id + '/slot', { method: 'POST', body: { art_id: a7.id } });
  await call(A, '/issue/' + issueId, { method: 'PATCH', body: { status: 'imprime' } });   // grâce = 0 (var de test)
  const sched = await fetch(API + '/__scheduled?cron=0+3+*+*+*');
  ok(sched.status === 200, 'déclenchement du cron de maintenance (wrangler --test-scheduled)');
  await new Promise(res => setTimeout(res, 1200));
  d = await call(A, '/issue/' + issueId);
  const ids = d.data.files.map(f => f.id);
  ok(!ids.includes(fA.id), 'purge : pièce sans article supprimée après impression', ids);
  ok(ids.includes(fB.id), 'rétention : pièce d\'un article réservé au n° suivant conservée', ids);

  console.log(`\n${pass} ✓ · ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('Suite interrompue :', e); process.exit(1); });
