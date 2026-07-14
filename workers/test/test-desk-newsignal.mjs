/* ═══════════════════════════════════════════════════════════════
   desK — signal « nouvel article » (§3.6) : horodatage d'ARRIVÉE.
   Le worker pose dk_page_slots.created_at à la réservation et le
   RAFRAÎCHIT quand une copie arrive par e-mail sur une page déjà
   servie (la carte pulse même sans pièce jointe). Le « vu/pulse »
   lui-même est côté client (localStorage) — ici on prouve la donnée.
   Prérequis worker : cf. entête test-desk-dk4.mjs (mêmes --var).
   ═══════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto';
const API = process.env.DK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.DK_JWT_SECRET || 'dk2-test-secret';
const ADMIN = process.env.DK_ADMIN || 'dk4-admin';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest())}`;
}
const A = jwt({ sub: 'sig-owner', owner: 'Stéphane', email: 'owner@sig' });
async function call(token, path, opts = {}) {
  const res = await fetch(API + '/api/desk' + path, {
    method: opts.method || 'GET',
    headers: token ? { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } : { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const inject = (mail) => call(ADMIN, '/email-inject', { method: 'POST', body: mail });
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗', l, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
const slotOf = (d, artId) => (d.data.slots || []).find(s => s.art_id === artId);

console.log('\ndesK — signal « nouvel article » sur', API, '\n');

let r = await call(A, '/publication', { method: 'POST', body: { name: 'Revue Signal ' + Date.now() } });
const pubId = r.data.publication.id;
const slug = 'sig-' + Date.now();
await call(A, '/publication/' + pubId, { method: 'PATCH', body: { slug } });
r = await call(A, '/publication/' + pubId + '/issue', { method: 'POST', body: { num: '1', pages: 8, jalons: {} } });
const issueId = r.data.issue.id;
r = await call(A, '/issue/' + issueId);
const page3 = r.data.pages.find(p => p.n === 3);

// Article attendu d'un contributeur connu, réservé sur la page 3
r = await call(A, '/publication/' + pubId + '/article', { method: 'POST', body: { title: 'Le portrait', contrib: 'Martin', status: 'attendu' } });
const artId = r.data.article.id;
r = await call(A, '/publication/' + pubId + '/contrib', { method: 'POST', body: { name: 'Martin', email: 'martin@contrib.sig' } });
r = await call(A, '/page/' + page3.id + '/slot', { method: 'POST', body: { art_id: artId } });
ok(r.status === 200, 'article réservé sur la page 3');

r = await call(A, '/issue/' + issueId);
const s1 = slotOf(r, artId);
ok(s1 && !!s1.created_at, 'la réservation pose created_at sur le slot (= horodatage d’arrivée)', s1);
const t1 = s1.created_at;

// Une copie arrive par e-mail (expéditeur connu, article placé) → auto-rattachée
await new Promise(res => setTimeout(res, 1100));   // garantir un tick d'horloge distinct
r = await inject({ to: `${slug}@test.dk`, from_email: 'martin@contrib.sig', from_name: 'Martin', subject: 'Le portrait', body: 'Voici la copie.', attachments: [] });
ok(r.status === 200 && r.data.mode === 'auto', 'copie e-mail auto-rattachée (mode auto)', r.data);

r = await call(A, '/issue/' + issueId);
const s2 = slotOf(r, artId);
ok(s2 && s2.created_at && s2.created_at > t1, 'created_at du slot RAFRAÎCHI par l’arrivée de la copie (carte pulse même sans PJ)', { avant: t1, apres: s2 && s2.created_at });
const art = r.data.articles.find(a => a.id === artId);
ok(art && art.status === 'remis', 'article passé « remis » par la digestion', art && art.status);

// Article créé au marbre (non placé) : sa création sert de signal côté client
r = await call(A, '/publication/' + pubId + '/article', { method: 'POST', body: { title: 'Spontané' } });
const art2 = r.data.article;
ok(!!art2.created_at, 'article au marbre porte created_at (signal marbre client)', art2 && art2.created_at);

console.log(`\n${pass} ✓ · ${fail} ✗\n`);
process.exit(fail ? 1 : 0);
