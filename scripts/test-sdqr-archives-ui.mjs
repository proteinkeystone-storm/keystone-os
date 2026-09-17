#!/usr/bin/env node
/* ═════════════════════════════════════════════════
   KEYSTONE OS — SDQR · BANC DES ARCHIVES (QR supprimés)
   ───────────────────────────────────────────────────
   Le VRAI `app/sdqr.js` dans un vrai Chrome, avec le vrai `app/style.css`.
   Seul le worker distant est doublé.

   LE DÉFAUT GARDÉ (17/09/2026) : supprimer un QR retirait sa redirection
   et le sortait de la bibliothèque, mais ses scans restaient en base SANS
   QUE PERSONNE NE PUISSE LES VOIR — 172 scans de « Trait d'union », 47 des
   « Terrasses d'Ollioules ». Règle posée par Stéphane : rien ne disparaît
   tant que l'utilisateur ne l'a pas décidé. Il faut donc une vue.

   Ce que ce banc PROUVE, à l'écran :
     · le bouton « Archives » existe dans la bibliothèque ;
     · il liste les QR supprimés, avec leur nom, la date et leurs scans ;
     · le total conservé est annoncé ;
     · un QR dont le code court a été réattribué est dit NON restaurable,
       et n'offre pas « Remettre en service » ;
     · « Effacer les statistiques » n'est proposé que s'il reste des scans ;
     · « ← Mes QR » ramène à la bibliothèque ;
     · aucune erreur JavaScript pendant le parcours.

   Usage : node scripts/test-sdqr-archives-ui.mjs        · Exit 0 si OK.
   ═════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
let passed = 0, failed = 0;
const check = (nom, cond, detail) => {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${nom}`); }
  else { failed++; console.error(`  \x1b[31m✗\x1b[0m ${nom}${detail !== undefined ? `  \x1b[2m→ ${detail}\x1b[0m` : ''}`); }
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

const QR_VIVANT = {
  id: 'qr-vivant', name: 'Bel Arti', qr_type: 'url', mode: 'dynamic', short_id: 'VIV001',
  payload: { url: 'https://exemple.fr/bel' }, status: 'active', design: null,
  scans_total: 437, scans_series: [1, 2, 3, 4], tags: '', created_at: '2026-06-03 02:39:18',
};
const ARCHIVES = {
  total: 2, scans_total: 219,
  qrs: [
    { id: 'a-revest', name: "Trait d'union — Biennale du Revest", short_id: 'hZxPs586',
      folder: "TRAIT D'UNION", qr_type: 'url', mode: 'dynamic', target_url: 'https://ex.test/revest',
      deleted_at: '2026-08-17 10:12:00', scans_total: 172, last_scan: '2026-08-08', restorable: true },
    { id: 'a-ollioules', name: "Les Terrasses d'Ollioules — TEST", short_id: 'CboNQsY9',
      folder: 'concierge-Démo', qr_type: 'url', mode: 'smart', target_url: 'https://ex.test/oll',
      deleted_at: '2026-06-03 18:00:00', scans_total: 47, last_scan: '2026-06-03', restorable: false },
  ],
};

const HARNAIS = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Banc SDQR — archives</title>
<link rel="stylesheet" href="/app/style.css">
<style>html,body{margin:0;height:100%}</style>
</head><body>
<script type="module">
  import { openSDQR } from '/app/sdqr.js';
  openSDQR({});
<\/script>
</body></html>`;

function serveur() {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (p === '/__banc.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(HARNAIS);
    }
    const cible = normalize(join(ROOT, p));
    if (!cible.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(cible, (e, data) => {
      if (e) { res.writeHead(404); return res.end('introuvable'); }
      res.writeHead(200, { 'Content-Type': MIME[extname(cible).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* Lecture de la vue Archives telle qu'elle s'affiche */
const LECTURE = `{
  titre : document.querySelector('.sdqr-lib-title')?.textContent || null,
  compte: document.querySelector('.sdqr-lib-count')?.textContent || null,
  retour: !!document.querySelector('#sdqr-arch-back'),
  lignes: [...document.querySelectorAll('tr[data-arch]')].map(tr => ({
    nom       : tr.querySelector('td')?.textContent || '',
    cellules  : [...tr.querySelectorAll('td')].map(td => td.textContent.trim()),
    restaurer : !!tr.querySelector('[data-arch-restore]'),
    effacer   : !!tr.querySelector('[data-arch-erase]'),
    nonRestaurable: /non restaurable/.test(tr.textContent),
  })),
}`;

(async () => {
  const srv = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await nav.newPage();
  await page.setViewport({ width: 1280, height: 1000 });

  const appels = [];
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.includes('keystone-os-api.keystone-os.workers.dev')) {
      appels.push(u.replace(/^https?:\/\/[^/]+/, '') + ' [' + r.method() + ']');
      const cors = {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      };
      const rendre = (body) => r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
      if (u.includes('/api/qr/archives')) return rendre(ARCHIVES);
      if (/\/api\/qr\/[^/]+\/restore/.test(u)) return rendre({ restored: true, id: 'a-revest', short_id: 'hZxPs586', scans_total: 172 });
      if (/\/api\/qr\/[^/]+\/scans$/.test(u)) return rendre({ erased: true, scans: 47, jours: 3 });
      return rendre({ qrs: [QR_VIVANT] });
    }
    if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.respond({ status: 200, contentType: 'text/plain', body: '' });
  });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));

  console.log('\n\x1b[1mBANC SDQR — archives (QR supprimés)\x1b[0m\n');
  await page.goto(`${base}/__banc.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#sdqr-arch-open', { timeout: 15000 });
  check('la bibliothèque propose « Archives »', true);

  await page.click('#sdqr-arch-open');
  await page.waitForSelector('tr[data-arch]', { timeout: 8000 });
  const vue = await page.evaluate(`(${LECTURE})`);

  check('titre « Archives »', vue.titre === 'Archives', vue.titre);
  check('le total conservé est annoncé', /2 QR supprimés/.test(vue.compte || '') && /219 scans conservés/.test(vue.compte || ''), vue.compte);
  check('deux QR supprimés listés', vue.lignes.length === 2, vue.lignes.length);
  check('« Trait d’union » et ses 172 scans', /Trait d’union|Trait d'union/.test(vue.lignes[0].nom) && vue.lignes[0].cellules.includes('172'), JSON.stringify(vue.lignes[0].cellules));
  check('le code court est rappelé', /hZxPs586/.test(vue.lignes[0].nom), vue.lignes[0].nom);
  check('date de suppression au format jour/mois/année', vue.lignes[0].cellules.includes('17/08/2026'), JSON.stringify(vue.lignes[0].cellules));
  check('restaurable → bouton « Remettre en service »', vue.lignes[0].restaurer === true);
  check('code réattribué → pas de bouton, mention « non restaurable »', vue.lignes[1].restaurer === false && vue.lignes[1].nonRestaurable === true);
  check('« Effacer les statistiques » proposé sur les deux (scans > 0)', vue.lignes[0].effacer && vue.lignes[1].effacer);
  check('l’archive a bien été lue au serveur', appels.some(a => a.startsWith('/api/qr/archives')), appels.join(' · '));

  /* Capture (BANC_SHOT=/chemin/vue.png) : la vue telle qu'elle s'affiche. */
  if (process.env.BANC_SHOT) {
    await page.screenshot({ path: process.env.BANC_SHOT });
    console.log(`  \x1b[2mcapture : ${process.env.BANC_SHOT}\x1b[0m`);
  }

  await page.click('#sdqr-arch-back');
  await page.waitForSelector('#sdqr-arch-open', { timeout: 8000 });
  const retour = await page.evaluate(`document.querySelector('.sdqr-lib-title')?.textContent || null`);
  check('« ← Mes QR » ramène à la bibliothèque', retour === 'Mes QR', retour);

  check('aucune erreur JavaScript pendant le parcours', erreurs.length === 0, erreurs.join(' | '));

  await nav.close(); srv.close();
  console.log(`\n${passed + failed} vérifications — ${passed} \x1b[32mok\x1b[0m, ${failed} ${failed ? '\x1b[31mko\x1b[0m' : 'ko'}\n`);
  process.exit(failed ? 1 : 0);
})();
