/* ═══════════════════════════════════════════════════════════════
   desK DK-5 — capteur Living Layer (_sensorDesk) E2E contre
   `wrangler dev --local` : le board doit exposer metrics.desk*
   (bac à trier, copies en retard, bouclage proche, numéros vivants)
   pour le MEMBRE de la publication (tenant = publication via
   dk_members.sub — jamais padTenant/'default').

   Lancer le worker AVANT (mêmes vars que DK-4) :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --test-scheduled \
       --var KS_JWT_SECRET:dk2-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:dk4-admin --var DK_EMAIL_IA:off
   Puis :
     node test/test-desk-dk5-board.mjs
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
const A = jwt({ sub: 'dk5-owner-sub', owner: 'Stéphane', email: 'owner@test.dk5' });
// Un ADMIN membre de la publication doit AUSSI voir ses signaux (le capteur
// utilise claims.sub, jamais 'default' — anti-piège tenant Living Layer).
const ADM = jwt({ sub: 'dk5-admin-sub', owner: 'Admin', email: 'admin@test.dk5', plan: 'ADMIN', isAdmin: true });
const X = jwt({ sub: 'dk5-etranger-sub', owner: 'Étranger', email: 'etranger@test.dk5' });

async function desk(token, path, opts = {}) {
  const res = await fetch(API + '/api/desk' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function board(token) {
  const res = await fetch(API + '/api/livinglayer/board', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ firstName: 'Test', preferMode: 'calculator' }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function main() {
  console.log('desK DK-5 — capteur Living Layer sur', API, '\n');

  // 0 · Board anonyme : 200, et desk* à zéro (pas de fuite).
  const b0 = await board(null);
  ok(b0.status === 200, 'board anonyme → 200', b0.status);
  ok((b0.data.metrics || {}).deskInbox === 0 && (b0.data.metrics || {}).deskIssuesLive === 0,
     'board anonyme → deskInbox=0, deskIssuesLive=0', b0.data.metrics);

  // 1 · Décor : publication + numéro (bouclage dans 2 j) + article en retard posé.
  await desk(A, '/bootstrap');
  const pub = await desk(A, '/publication', { method: 'POST', body: { name: 'Revue DK5 ' + Date.now() } });
  ok(pub.status === 200 && pub.data.publication, 'création publication', pub);
  const pubId = pub.data.publication.id;
  const iss = await desk(A, '/publication/' + pubId + '/issue', { method: 'POST', body: {
    num: '901', pages: 8,
    jalons: { bouclage: iso(2), maquette: iso(10), imprimeur: iso(14), parution: iso(20) },
  } });
  ok(iss.status === 200 && iss.data.issue, 'création numéro (bouclage J+2)', iss);
  const issueId = iss.data.issue.id;
  const d0 = await desk(A, '/issue/' + issueId);
  const art = await desk(A, '/publication/' + pubId + '/article', { method: 'POST', body: {
    title: 'Copie en retard DK5', contrib: 'Jean Retard', status: 'attendu', due: iso(-3),
  } });
  ok(art.status === 200 && art.data.article, 'article attendu, remise J−3 (en retard)', art);
  const p2 = d0.data.pages.find(p => p.n === 2);
  const slot = await desk(A, '/page/' + p2.id + '/slot', { method: 'POST', body: { art_id: art.data.article.id } });
  ok(slot.status === 200, 'article réservé p. 2', slot);

  // 2 · Un e-mail inconnu → bac à trier (dk_inbox pending). L'adresse porte
  // le tenant : on récupère le slug via le bootstrap (p.*).
  const boot = await desk(A, '/bootstrap');
  const slug = (boot.data.publications || []).find(p => p.id === pubId)?.slug;
  ok(!!slug, 'slug de dépôt présent au bootstrap', boot.data.publications);
  const inj = await fetch(API + '/api/desk/email-inject', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: slug + '@redaction-pks.com', from_email: 'inconnu@test.dk5',
                           from_name: 'Inconnu', subject: 'Papier spontané DK5', body: 'Voici ma contribution.' }),
  }).then(r => r.json()).catch(() => ({}));
  ok(inj && inj.ok, 'email inconnu injecté → bac', inj);

  // 3 · Board du MEMBRE : les signaux desK sortent.
  const b1 = await board(A);
  const m1 = b1.data.metrics || {};
  ok(b1.status === 200, 'board membre → 200', b1.status);
  ok(m1.deskIssuesLive === 1, 'deskIssuesLive = 1', m1);
  ok(m1.deskOverdue === 1, 'deskOverdue = 1 (copie en retard posée)', m1);
  ok(m1.deskOverdueNum === '901', 'deskOverdueNum = 901', m1);
  ok(m1.deskInbox >= 1, 'deskInbox ≥ 1 (bac à trier)', m1);
  ok(m1.deskBouclageDays !== null && m1.deskBouclageDays <= 2 && m1.deskBouclageDays >= 1,
     'deskBouclageDays ≈ 2 (bouclage proche)', m1.deskBouclageDays);
  ok(m1.deskBouclageNum === '901', 'deskBouclageNum = 901', m1);

  // 4 · Le calculateur propose une phrase desK (topic présent dans la rotation).
  let sawDesk = false;
  for (let i = 0; i < 12 && !sawDesk; i++) {
    const r = await fetch(API + '/api/livinglayer/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + A },
      body: JSON.stringify({ firstName: 'Test', preferMode: 'calculator', variantIndex: i }),
    }).then(x => x.json()).catch(() => ({}));
    if (r.topic === 'desk') sawDesk = true;
  }
  ok(sawDesk, 'calculateur → une phrase topic=desk dans la rotation');

  // 5 · Un ADMIN membre voit AUSSI ses signaux (anti-piège padTenant='default').
  await desk(ADM, '/bootstrap');
  const pubAdm = await desk(ADM, '/publication', { method: 'POST', body: { name: 'Revue Admin DK5 ' + Date.now() } });
  await desk(ADM, '/publication/' + pubAdm.data.publication.id + '/issue', { method: 'POST', body: {
    num: '902', pages: 4, jalons: { bouclage: iso(1), maquette: iso(5), imprimeur: iso(8), parution: iso(12) },
  } });
  const bAdm = await board(ADM);
  const mAdm = bAdm.data.metrics || {};
  ok(mAdm.deskIssuesLive === 1 && mAdm.deskBouclageNum === '902',
     'ADMIN membre → deskIssuesLive=1, bouclage n° 902 (sub, pas default)', mAdm);

  // 6 · Anti-fuite : un étranger (aucune publication) ne voit RIEN.
  const bX = await board(X);
  const mX = bX.data.metrics || {};
  ok(mX.deskIssuesLive === 0 && mX.deskInbox === 0 && mX.deskOverdue === 0,
     'étranger → tous les desk* à 0', mX);

  console.log(`\n${pass} ✓ · ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
