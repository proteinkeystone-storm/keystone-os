#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — SDQR · BANC DU PANNEAU DESIGN (onglets)

   Le VRAI `app/sdqr.js` dans un vrai Chrome (puppeteer), avec le vrai
   `app/style.css`. Rien n'est réimplémenté : seul le worker distant est
   doublé (interception réseau → `{ qrs: [] }`).

   LE DÉFAUT GARDÉ (25 août 2026) : dans « Son apparence », chaque option
   qui reconstruit le panneau (un logo prêt, un nuancier, une palette,
   « Surprends-moi », le retrait du logo…) repartait du gabarit HTML — et
   ce gabarit ouvre TOUJOURS « Modules ». L'utilisateur, parti régler ses
   couleurs ou son logo, retombait au premier onglet à chaque clic.

   POURQUOI un navigateur et pas jsdom : l'onglet visible se lit sur le
   `display` calculé par `app/style.css` (.sdqr-dtab-panel.is-active) —
   jsdom n'a pas de moteur de mise en page et le banc passerait au vert
   sans rien prouver.

   Usage : node scripts/test-sdqr-design-ui.mjs        · Exit 0 si OK.
   Voir le banc ATTRAPER (version d'avant le correctif) :
     git show HEAD:app/sdqr.js > /tmp/sdqr-avant.js
     SDQR_JS=/tmp/sdqr-avant.js node scripts/test-sdqr-design-ui.mjs
   ═══════════════════════════════════════════════════════════════ */

import http               from 'node:http';
import fs                 from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath }  from 'node:url';
import puppeteer          from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const SDQR_JS   = process.env.SDQR_JS || '';   // sert un autre sdqr.js (banc du banc)

let passed = 0, failed = 0;
const echecs = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    failed++; echecs.push(name);
    console.error(`  \x1b[31m✗\x1b[0m ${name}${detail !== undefined ? `  \x1b[2m→ ${detail}\x1b[0m` : ''}`);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

// Le QR de la flotte doublée : sert la FICHE (2e surface du même panneau).
const QR_BANC = {
  id: 'qr-banc', name: 'QR du banc', qr_type: 'url', mode: 'dynamic',
  short_id: 'BANC01', payload: { url: 'https://exemple.fr/banc' },
  status: 'active', design: null, scans: 0, tags: '',
  created_at: '2026-08-25 09:00:00',
};

const HARNAIS = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Banc SDQR — panneau design</title>
<link rel="stylesheet" href="/app/style.css">
<style>html,body{margin:0;height:100%}</style>
</head><body>
<script type="module">
  import { openSDQR } from '/app/sdqr.js';
  // ?mode=fiche  -> ouverture de la FICHE d'un QR existant
  // (défaut)     -> écran de CRÉATION (étape 3 « Son apparence »)
  const fiche = new URLSearchParams(location.search).get('mode') === 'fiche';
  openSDQR(fiche ? { editId: 'qr-banc' }
                 : { createUrl: 'https://exemple.fr/banc', presetName: 'Banc design' });
<\/script>
</body></html>`;

function serveur() {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (p === '/__banc.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(HARNAIS);
    }
    const cible = (SDQR_JS && p === '/app/sdqr.js') ? SDQR_JS : normalize(join(ROOT, p));
    if (!SDQR_JS && !cible.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(cible, (e, data) => {
      if (e) { res.writeHead(404); return res.end('introuvable'); }
      res.writeHead(200, { 'Content-Type': MIME[extname(cible).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* ── Lectures dans la page ─────────────────────────────────────── */
const LECTURES = `{
  onglet: document.querySelector('#sdqr-dtabs .sdqr-dtab.is-active')?.dataset.dtab || null,
  visible: [...document.querySelectorAll('[data-dtab-panel]')]
             .filter(p => getComputedStyle(p).display !== 'none')
             .map(p => p.dataset.dtabPanel),
}`;

const etat = page => page.evaluate(`(${LECTURES})`);

async function ouvreOnglet(page, id) {
  await page.click(`#sdqr-dtabs .sdqr-dtab[data-dtab="${id}"]`);
  await page.waitForFunction(
    `document.querySelector('#sdqr-dtabs .sdqr-dtab.is-active')?.dataset.dtab === '${id}'`,
    { timeout: 3000 },
  );
}

// Le panneau est ARRACHÉ puis reconstruit : on attend le nouveau noeud, pas
// un simple timeout (sinon on lit l'ancien DOM et le banc ment).
async function cliqueEtAttendReconstruction(page, sel) {
  await page.evaluate(s => {
    document.querySelector('#sdqr-design-panel').dataset.bancMarque = '1';
    document.querySelector(s).click();
  }, sel);
  await page.waitForFunction(
    `document.querySelector('#sdqr-design-panel') && !document.querySelector('#sdqr-design-panel').dataset.bancMarque`,
    { timeout: 5000 },
  );
}

/* ── Parcours ──────────────────────────────────────────────────── */
(async () => {
  const srv  = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const nav  = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await nav.newPage();
  await page.setViewport({ width: 1280, height: 1000 });

  // Worker distant doublé : la flotte est vide, on va droit à la création.
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.includes('keystone-os-api.keystone-os.workers.dev')) {
      // CORS du banc : sans ces en-têtes, Chrome refuse la réponse doublée et
      // le pad affiche « Erreur de chargement » (le vrai worker, lui, les pose).
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin' : '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        },
        body: JSON.stringify({ qrs: [QR_BANC] }),
      });
    }
    if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.respond({ status: 200, contentType: 'text/plain', body: '' });   // rien ne sort du banc
  });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  if (process.env.BANC_DEBUG) {
    page.on('console', m => console.log('   \x1b[2m[page]', m.type(), m.text(), '\x1b[0m'));
    page.on('requestfailed', r => console.log('   \x1b[2m[net ✗]', r.url(), r.failure()?.errorText, '\x1b[0m'));
  }

  console.log(`\n\x1b[1mBANC SDQR — panneau design\x1b[0m${SDQR_JS ? `  \x1b[2m(sdqr.js: ${SDQR_JS})\x1b[0m` : ''}\n`);
  await page.goto(`${base}/__banc.html`, { waitUntil: 'networkidle0' });
  try {
    await page.waitForSelector('#sdqr-design-panel #sdqr-dtabs .sdqr-dtab', { timeout: 15000 });
  } catch (err) {
    console.error('\n  Le panneau design ne s\'est pas ouvert. État de la page :');
    console.error('  ' + JSON.stringify(await page.evaluate(() => ({
      shell   : !!document.getElementById('sdqr-fullscreen'),
      content : document.querySelector('#sdqr-content')?.className || null,
      texte   : (document.querySelector('#sdqr-content')?.innerText || '').slice(0, 400),
    })), null, 2).replace(/\n/g, '\n  '));
    console.error('  Erreurs JS : ' + (erreurs.join(' | ') || '(aucune)'));
    await nav.close(); srv.close();
    process.exit(1);
  }

  /* 0 · État d'entrée --------------------------------------------------- */
  console.log('\x1b[1m0 · L\'écran de création s\'ouvre\x1b[0m');
  const e0 = await etat(page);
  check('création : « Couleurs » ouvert d\'emblée', e0.onglet === 'couleurs', e0.onglet);
  check('un seul panneau visible', e0.visible.length === 1 && e0.visible[0] === 'couleurs', JSON.stringify(e0.visible));

  /* 1 · Couleurs : un nuancier ne renvoie plus à « Modules » ------------- */
  console.log('\n\x1b[1m1 · Onglet Couleurs — nuancier & palette\x1b[0m');
  await ouvreOnglet(page, 'couleurs');
  await cliqueEtAttendReconstruction(page, '[data-swatch]');
  let e = await etat(page);
  check('après un nuancier : toujours sur « Couleurs »', e.onglet === 'couleurs', e.onglet);
  check('le panneau AFFICHÉ est bien Couleurs', e.visible.join() === 'couleurs', JSON.stringify(e.visible));

  const aPalette = await page.$('[data-color-preset]');
  if (aPalette) {
    await cliqueEtAttendReconstruction(page, '[data-color-preset]');
    e = await etat(page);
    check('après une palette : toujours sur « Couleurs »', e.onglet === 'couleurs', e.onglet);
  }

  /* 2 · Logo : poser un logo prêt garde l'onglet ------------------------- */
  console.log('\n\x1b[1m2 · Onglet Logo — logo prêt, icône, retrait\x1b[0m');
  await ouvreOnglet(page, 'logo');
  await cliqueEtAttendReconstruction(page, '[data-logo-asset]');
  e = await etat(page);
  check('après un logo prêt : toujours sur « Logo »', e.onglet === 'logo', e.onglet);
  check('le panneau AFFICHÉ est bien Logo', e.visible.join() === 'logo', JSON.stringify(e.visible));
  check('le logo est bien posé (bouton Retirer présent)',
        !!(await page.$('#sdqr-logo-remove')));

  const aIcone = await page.$('[data-logo-icon]');
  if (aIcone) {
    await cliqueEtAttendReconstruction(page, '[data-logo-icon]');
    e = await etat(page);
    check('après une icône de la bibliothèque : toujours sur « Logo »', e.onglet === 'logo', e.onglet);
  }

  await cliqueEtAttendReconstruction(page, '#sdqr-logo-remove');
  e = await etat(page);
  check('après le retrait du logo : toujours sur « Logo »', e.onglet === 'logo', e.onglet);

  const aMemorise = await page.$('[data-saved-idx]');
  if (aMemorise) {
    await cliqueEtAttendReconstruction(page, '[data-saved-idx]');
    e = await etat(page);
    check('après un logo repris dans « Vos logos » : toujours sur « Logo »', e.onglet === 'logo', e.onglet);
  }

  /* 3 · Couleurs : interversion anneau ⇄ pupille ------------------------- */
  console.log('\n\x1b[1m3 · Onglet Couleurs — anneau ⇄ pupille\x1b[0m');
  await ouvreOnglet(page, 'couleurs');
  await page.click('[data-eye-mode] [data-eye="distinct"]');          // pas de reconstruction
  await cliqueEtAttendReconstruction(page, '#sdqr-eye-swap');
  e = await etat(page);
  check('après l\'interversion anneau/pupille : toujours sur « Couleurs »', e.onglet === 'couleurs', e.onglet);

  /* 4 · Le QR suit bien le design (le correctif ne casse pas le rendu) --- */
  console.log('\n\x1b[1m4 · Le QR se re-dessine\x1b[0m');
  const svgOk = await page.evaluate(() => {
    const w = document.querySelector('#sdqr-svg-wrap');
    return !!(w && w.querySelector('svg'));
  });
  check('un QR est bien dessiné dans l\'aperçu', svgOk);
  check('aucune erreur JS pendant le parcours', erreurs.length === 0, erreurs.join(' | '));

  /* 5 · Les onglets restent navigables ----------------------------------- */
  console.log('\n\x1b[1m5 · Navigation des onglets\x1b[0m');
  for (const id of ['modules', 'yeux', 'logo', 'couleurs', 'cadre']) {
    await ouvreOnglet(page, id);
    const s = await etat(page);
    check(`onglet « ${id} » s'ouvre et s'affiche seul`,
          s.onglet === id && s.visible.join() === id, `${s.onglet} / ${JSON.stringify(s.visible)}`);
  }

  /* 6 · Garde : la position de lecture ne saute pas --------------------- */
  console.log('\n\x1b[1m6 · La page ne remonte pas toute seule (garde)\x1b[0m');
  await ouvreOnglet(page, 'couleurs');
  const avant = await page.evaluate(() => {
    let n = document.querySelector('#sdqr-design-panel').parentElement;
    while (n && n !== document.body) {
      const oy = getComputedStyle(n).overflowY;
      if (/(auto|scroll|overlay)/.test(oy) && n.scrollHeight > n.clientHeight + 1) break;
      n = n.parentElement;
    }
    const sc = (n && n !== document.body) ? n : document.scrollingElement;
    sc.scrollTop = Math.min(180, sc.scrollHeight - sc.clientHeight);
    return { cls: sc.className || '(page)', top: sc.scrollTop };
  });
  if (avant.top > 0) {
    await cliqueEtAttendReconstruction(page, '[data-swatch]');
    const apres = await page.evaluate(() => {
      let n = document.querySelector('#sdqr-design-panel').parentElement;
      while (n && n !== document.body) {
        const oy = getComputedStyle(n).overflowY;
        if (/(auto|scroll|overlay)/.test(oy) && n.scrollHeight > n.clientHeight + 1) break;
        n = n.parentElement;
      }
      const sc = (n && n !== document.body) ? n : document.scrollingElement;
      return sc.scrollTop;
    });
    check('après un nuancier : on reste où on lisait',
          Math.abs(apres - avant.top) <= 4, `${avant.top} → ${apres} (${avant.cls})`);
  } else {
    console.log('  \x1b[2m(rien à faire défiler dans ce viewport — vérification sautée)\x1b[0m');
  }

  /* 7 · La FICHE d'un QR existant — même panneau, autre hôte ------------- */
  console.log('\n\x1b[1m7 · Fiche d\'un QR existant\x1b[0m');
  await page.goto(`${base}/__banc.html?mode=fiche`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#sdqr-design-panel #sdqr-dtabs .sdqr-dtab', { timeout: 15000 });
  const eF0 = await etat(page);
  check('fiche : « Modules » ouvert par défaut', eF0.onglet === 'modules', eF0.onglet);

  await ouvreOnglet(page, 'logo');
  await cliqueEtAttendReconstruction(page, '[data-logo-asset]');
  e = await etat(page);
  check('fiche · après un logo prêt : toujours sur « Logo »', e.onglet === 'logo', e.onglet);
  check('fiche · le panneau AFFICHÉ est bien Logo', e.visible.join() === 'logo', JSON.stringify(e.visible));

  await ouvreOnglet(page, 'couleurs');
  await cliqueEtAttendReconstruction(page, '[data-swatch]');
  e = await etat(page);
  check('fiche · après un nuancier : toujours sur « Couleurs »', e.onglet === 'couleurs', e.onglet);
  check('fiche · aucune erreur JS', erreurs.length === 0, erreurs.join(' | '));

  await nav.close();
  srv.close();

  console.log(`\n${failed === 0 ? '\x1b[32m✓ BANC VERT\x1b[0m' : '\x1b[31m✗ BANC ROUGE\x1b[0m'} — ${passed} vérifications passées, ${failed} échec(s)`);
  if (failed) console.error('  ' + echecs.join('\n  '));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
