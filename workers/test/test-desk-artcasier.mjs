/* ═══════════════════════════════════════════════════════════════
   desK — casier AU MARBRE : déposer une pièce sur un article non
   encore placé (endpoint /article/:id/casier, page_id = '').
   Prérequis worker : cf. entête test-desk-dk3.mjs (wrangler dev --local).
   ═══════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto';

const API = process.env.DK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.DK_JWT_SECRET || 'dk2-test-secret';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}
const A = jwt({ sub: 'artc-owner', owner: 'Stéphane', email: 'owner@artc' });
const C = jwt({ sub: 'artc-intrus', owner: 'Intrus', email: 'intrus@artc' });
async function call(token, path, opts = {}) {
  const res = await fetch(API + '/api/desk' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function putBlob(token, path, bytes) {
  const res = await fetch(API + '/api/desk' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/pdf' }, body: bytes,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗', l, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };

console.log('\ndesK — casier au marbre sur', API, '\n');

let r = await call(A, '/publication', { method: 'POST', body: { name: 'Revue ArtCasier ' + Date.now() } });
ok(r.status === 200, 'création publication', r.data);
const pubId = r.data.publication.id;
r = await call(A, '/publication/' + pubId + '/issue', { method: 'POST', body: { num: '1', pages: 8, jalons: {} } });
ok(r.status === 200, 'création numéro', r.data);
const issueId = r.data.issue.id;

// Article créé AU MARBRE (aucun placement sur une page)
r = await call(A, '/publication/' + pubId + '/article', { method: 'POST', body: { title: 'Papier libre', contrib: 'Nathalie' } });
ok(r.status === 200, 'article créé au marbre (non placé)', r.data);
const artId = r.data.article.id;

// Dépôt d'une pièce SUR l'article, imputée au numéro courant
r = await call(A, '/article/' + artId + '/casier', { method: 'POST', body: { name: 'brouillon.pdf', size: 2048, issue_id: issueId } });
ok(r.status === 200 && r.data.upload, 'demande de dépôt sur l’article → ok', r.data);
const fileId = r.data.file.id;
ok(r.data.file.page_id === '' && r.data.file.art_id === artId, 'pièce au marbre (page_id vide, art_id posé)', r.data.file);

const bytes = crypto.randomBytes(2048);
r = await putBlob(A, '/casier/' + fileId + '/put', bytes);
ok(r.status === 200, 'dépôt direct streamé → ok', r.data);

// La pièce apparaît dans le numéro, rattachée à l'article, au marbre
r = await call(A, '/issue/' + issueId);
const f = (r.data.files || []).find(x => x.id === fileId);
ok(f && f.status === 'ok' && f.art_id === artId && f.page_id === '', 'pièce listée : ok, art_id, page_id vide', f);
ok((r.data.quota || {}).used >= 2048, 'quota du numéro imputé', r.data.quota);

// Téléchargement : octets identiques
r = await call(A, '/casier/' + fileId + '/url');
ok(r.status === 200 && r.data.url, 'lien de téléchargement émis', r.data);
const dl = await fetch(r.data.url.startsWith('http') ? r.data.url : API + r.data.url);
const back = Buffer.from(await dl.arrayBuffer());
ok(back.equals(bytes), 'téléchargement : octets identiques');

// Gardes
r = await call(C, '/article/' + artId + '/casier', { method: 'POST', body: { name: 'x.pdf', size: 10, issue_id: issueId } });
ok(r.status === 403, 'intrus : dépôt sur l’article refusé (403)', r.status);
r = await call(A, '/article/' + artId + '/casier', { method: 'POST', body: { name: 'x.pdf', size: 10, issue_id: 'inconnu' } });
ok(r.status === 400, 'issue_id inconnu → 400', r.status);
r = await call(A, '/article/' + artId + '/casier', { method: 'POST', body: { name: 'malware.exe', size: 10, issue_id: issueId } });
ok(r.status === 400, 'extension hors whitelist refusée (.exe)', r.status);

// La pièce suit l'article même après placement sur une page
r = await call(A, '/issue/' + issueId);
const page = r.data.pages.find(p => p.kind !== 'fixe');
r = await call(A, '/page/' + page.id + '/slot', { method: 'POST', body: { art_id: artId } });
ok(r.status === 200, 'article placé sur une page', r.status);
r = await call(A, '/issue/' + issueId);
const f2 = (r.data.files || []).find(x => x.id === fileId);
ok(f2 && f2.art_id === artId, 'la pièce reste rattachée à l’article après placement', f2);

console.log(`\n${pass} ✓ · ${fail} ✗\n`);
process.exit(fail ? 1 : 0);
