#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEY FORM — « le pad dit 1 publié, l'app ne montre rien »

   Retour Stéphane du 06/08/2026. Le compteur du pad lit le SERVEUR
   (living-layer `_sensorPulsa` : lignes `pulsa_forms` de l'owner) ;
   la bibliothèque Key Form, elle, est LOCAL-FIRST et sautait
   l'hydratation pour un compte admin — d'où un pad qui annonce un
   formulaire que l'app n'affiche jamais.

   Ce banc démarre le VRAI `app/pulsa.js` dans un vrai navigateur au-
   dessus du VRAI worker (`wrangler dev --local`, base D1 locale — la
   prod n'est jamais touchée), et vérifie les deux bouts de la chaîne :

   1. le formulaire publié côté serveur APPARAÎT dans la bibliothèque,
      pour un compte admin comme pour un client ;
   2. l'admin ne voit PAS les formulaires des autres (c'est la raison
      pour laquelle l'hydratation avait été coupée) ;
   3. le compteur du pad (`/api/livinglayer/board` → metrics) annonce
      le MÊME nombre que ce que la bibliothèque affiche — les deux
      surfaces racontent la même histoire ;
   4. supprimer depuis l'app retire la ligne serveur ET fait retomber
      le compteur (fin des formulaires fantômes).

   Lancer le worker AVANT :
     cd workers && npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --var KS_JWT_SECRET:kf-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:kf-admin
   Puis :
     node scripts/test-keyform-hydrate.mjs
   ═══════════════════════════════════════════════════════════════ */

import http    from 'node:http';
import fs      from 'node:fs';
import path    from 'node:path';
import crypto  from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const API    = process.env.KF_API    || 'http://127.0.0.1:8799';
const SECRET = process.env.KF_SECRET || 'kf-test-secret';
/* ⚠ `new URL(import.meta.url).pathname` rend un chemin PERCENT-ENCODÉ : le
   dépôt vit sous « PROTEIN STUDIO », l'espace devenait %20 et tout le banc
   servait des 404. fileURLToPath décode. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}
const stamp = Date.now().toString(36);
const SUB_ADMIN = 'kf-admin-' + stamp;
const ADMIN  = jwt({ sub: SUB_ADMIN, email: 'admin@test.kf',  plan: 'ADMIN', isAdmin: true });
const CLIENT = jwt({ sub: 'kf-client-' + stamp, email: 'client@test.kf' });

let passed = 0, failed = 0; const echecs = [];
function check(label, ok, extra) {
  if (ok) { passed++; console.log('  \x1b[32m✓\x1b[0m', label); }
  else { failed++; echecs.push(label); console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? `\x1b[2m→ ${extra}\x1b[0m` : ''); }
}
const attendre = ms => new Promise(r => setTimeout(r, ms));

async function api(token, chemin, opts = {}) {
  const res = await fetch(API + chemin, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const formulaire = (id, slug, titre) => ({
  id, meta: { title: titre, slug },
  sections: [{ id: 's1', title: 'Section', fields: [{ id: 'f1', type: 'text', label: 'Nom' }] }],
  delivery: { recipients: ['dest@test.kf'] },
  output: { status: 'published' },
});
// Le compteur du pad, lu à la source : c'est CE chiffre que la carte affiche.
const compteurDuPad = async (token) => {
  const r = await fetch(API + '/api/livinglayer/board', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ firstName: 'Test', preferMode: 'calculator', aiMode: false }),
  });
  const d = await r.json().catch(() => ({}));
  return d?.metrics?.formsPublished ?? null;
};

/* ── Serveur du banc : sert le dépôt + une page qui charge le vrai pad ── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const PAGE = (token) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link rel="stylesheet" href="/app/style.css"><link rel="stylesheet" href="/app/workspace.css">
<link rel="stylesheet" href="/app/pulsa.css"><title>banc Key Form</title></head><body>
<script>
  // CF_API est en dur dans pads-loader.js : on redirige l'hôte vers le worker
  // de banc sans toucher au fichier livré.
  (function () {
    var PROD = 'https://keystone-os-api.keystone-os.workers.dev';
    var brut = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      if (u.indexOf(PROD) === 0) return brut('${API}' + u.slice(PROD.length), init);
      return brut(input, init);
    };
  })();
  localStorage.clear();
  localStorage.setItem('ks_jwt', '${token}');
  localStorage.setItem('ks_licence_plan', '${token === ADMIN ? 'ADMIN' : 'PRO'}');
</script>
<script type="module">
  const m = await import('/app/pulsa.js?t=' + Date.now());
  window.__KF__ = m;
  m.openPulsa({});
</script></body></html>`;

const srv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__kf-admin.html' || url.pathname === '/__kf-client.html') {
    const body = PAGE(url.pathname.includes('admin') ? ADMIN : CLIENT);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(body);
  }
  const fichier = path.join(RACINE, decodeURIComponent(url.pathname));
  if (!fichier.startsWith(RACINE) || !fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) {
    res.writeHead(404); return res.end('non trouvé');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier)] || 'application/octet-stream' });
  fs.createReadStream(fichier).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

/* ── Le banc ── */
console.log('\n\x1b[1m▶ Key Form — le pad et l\'app racontent la même histoire\x1b[0m');
const navigateur = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 800 } });
const page = await navigateur.newPage();
const erreurs = [];
page.on('pageerror', e => erreurs.push(String(e && e.message || e)));
page.on('console', m => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
const httpKO = [];
page.on('response', r => { if (r.status() >= 400) httpKO.push(r.status() + ' ' + r.url().replace(API, '')); });

// Ouvre le pad et RACONTE pourquoi si ça n'arrive pas (sinon on ne debug rien).
async function ouvrirLApp(chemin) {
  erreurs.length = 0;
  await page.goto(BASE + chemin, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('.ws-app.pulsa-app', { timeout: 8000 });
  } catch (_) {
    const corps = await page.evaluate(() => document.body.innerHTML.slice(0, 300)).catch(() => '');
    throw new Error('le pad ne s\'est pas ouvert — erreurs : ' + (erreurs.join(' | ') || 'aucune')
      + ' — corps : ' + corps);
  }
  await attendre(1200);   // l'hydratation est non bloquante
}

const A = `kf_${stamp}_a`, B = `kf_${stamp}_b`, C = `kf_${stamp}_c`;
try {
  // Le seau `owner_sub='admin'` est PARTAGÉ (toutes les exécutions du banc y
  // écrivent) : on repart d'une base propre, sinon le compteur additionne les
  // restes des essais précédents.
  for (const f of ((await api(ADMIN, '/api/pulsa/forms?mine=1')).data.forms || [])) {
    await api(ADMIN, `/api/pulsa/forms/${f.id}`, { method: 'DELETE' });
  }
  check('base du banc repartie de zéro',
    ((await api(ADMIN, '/api/pulsa/forms?mine=1')).data.forms || []).length === 0);

  // (1) ce que l'admin crée depuis Key Form → stocké sous owner_sub='admin'
  const cA = await api(ADMIN,  '/api/pulsa/forms', { method: 'POST', body: { form: formulaire(A, `kf-adm-${stamp}`, 'Formulaire de l\'admin') } });
  const cB = await api(CLIENT, '/api/pulsa/forms', { method: 'POST', body: { form: formulaire(B, `kf-cli-${stamp}`, 'Formulaire du client') } });
  check('un formulaire publié existe côté serveur pour l\'admin', cA.status === 200, cA.data);
  check('et un autre pour un client', cB.status === 200, cB.data);

  // (2) LE CAS STÉPHANE — les DEUX identités d'un compte admin.
  // Ce qu'il crée dans Key Form part sous `owner_sub='admin'` (le worker voit
  // le drapeau admin du jeton). Mais une fiche créée par un AUTRE chemin — le
  // Concierge de Smart QR — porte son sub PERSONNEL. Même compte, même
  // personne, deux rangements : c'est ce qui figeait le compteur du pad.
  // On reproduit l'état exact avec un jeton du MÊME sub, sans drapeau admin.
  const CONCIERGE = jwt({ sub: SUB_ADMIN, email: 'admin@test.kf' });
  const cC = await api(CONCIERGE, '/api/pulsa/forms', { method: 'POST',
    body: { form: formulaire(C, `kf-cg-${stamp}`, 'Fiche établissement') } });
  check('une fiche du Concierge existe, rangée sous le sub personnel', cC.status === 200, cC.data);
  const listeConcierge = (await api(CONCIERGE, '/api/pulsa/forms?mine=1')).data.forms || [];
  check('elle n\'est PAS rangée sous « admin »',
    listeConcierge.length === 1 && listeConcierge[0].id === C,
    listeConcierge.map(f => f.id).join(','));

  const c2 = await compteurDuPad(ADMIN);
  check('le compteur du pad voit les DEUX identités du compte (2 publiés)',
    c2 === 2, 'compteur = ' + c2);

  // ── L'app, vue par l'admin : bibliothèque vide en local, tout vient du serveur.
  await ouvrirLApp('/__kf-admin.html');
  const vuAdmin = await page.evaluate(() => document.body.innerText);
  check('l\'app montre le formulaire créé depuis Key Form', /Formulaire de l'admin/.test(vuAdmin),
    vuAdmin.slice(0, 240).replace(/\n+/g, ' · '));
  check('l\'app montre AUSSI la fiche du Concierge (2e identité)', /Fiche établissement/.test(vuAdmin),
    vuAdmin.slice(0, 240).replace(/\n+/g, ' · '));
  check('et elle ne montre PAS le formulaire du client', !/Formulaire du client/.test(vuAdmin));

  const nbAdmin = await page.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem('ks_pulsa_library') || '{}').forms || []).length; }
    catch (_) { return -1; }
  });
  check('l\'app affiche EXACTEMENT ce que le pad compte (2)', nbAdmin === 2, 'trouvé ' + nbAdmin);

  // ── Et pour un client ordinaire : son formulaire, rien que le sien.
  await ouvrirLApp('/__kf-client.html');
  const vuClient = await page.evaluate(() => document.body.innerText);
  check('un client voit le sien', /Formulaire du client/.test(vuClient));
  check('un client ne voit pas celui de l\'admin', !/Fiche établissement/.test(vuClient));
  check('le compteur du pad annonce 1 publié pour le client', await compteurDuPad(CLIENT) === 1);

  // ── Supprimer depuis l'app : la ligne serveur part, le compteur retombe.
  await ouvrirLApp('/__kf-admin.html');
  await page.evaluate(() => { window.confirm = () => true; });
  const aCliqué = await page.evaluate(() => {
    const b = document.querySelector('[data-act="delete-form"]');
    if (!b) return false; b.click(); return true;
  });
  check('le bouton « supprimer » est bien là', aCliqué);
  await attendre(1500);
  const resteServeur = (await api(ADMIN, '/api/pulsa/forms?mine=1')).data.forms || [];
  check('la suppression retire AUSSI la ligne serveur (plus de fantôme)',
    resteServeur.length === 1, resteServeur.map(f => f.id).join(','));
  check('et le compteur du pad suit (2 → 1)', await compteurDuPad(ADMIN) === 1);

  /* /api/vault/save répond 500 ici parce que le worker de banc n'a pas de
     KS_ENCRYPTION_KEY (la synchro du coffre n'est pas le sujet de ce banc).
     Tout le reste doit passer. */
  check('aucune requête en erreur pendant le parcours',
    httpKO.filter(u => !/favicon|LOGOS|vault\/save/.test(u)).length === 0,
    httpKO.slice(0, 5).join(' | '));
  check('aucune erreur JavaScript pendant le parcours',
    erreurs.filter(e => !/favicon|LOGOS|ERR_|Failed to load resource/.test(e)).length === 0,
    erreurs.slice(0, 3).join(' | '));
} finally {
  // Ménage : le formulaire du client (celui de l'admin est supprimé par le test).
  await api(CLIENT, `/api/pulsa/forms/${B}`, { method: 'DELETE' }).catch(() => {});
  await api(ADMIN,  `/api/pulsa/forms/${A}`, { method: 'DELETE' }).catch(() => {});
  await api(ADMIN,  `/api/pulsa/forms/${C}`, { method: 'DELETE' }).catch(() => {});
  await navigateur.close();
  srv.close();
}

console.log(`\n${passed + failed} vérifications — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
if (failed) console.error('\nÉchecs :\n  - ' + echecs.join('\n  - '));
process.exit(failed ? 1 : 0);
