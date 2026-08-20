#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LE CORRECTEUR — banc d'interface (onglet Vocabulaire + promesse)

   Deux choses que seul un vrai navigateur peut garder :

   1. LA PROMESSE AFFICHÉE. Le bas de la fenêtre dit à l'utilisateur ce
      qui sort de son appareil. Elle disait « rien n'est envoyé en
      ligne » — vrai jusqu'à GP-5, faux dès que le tri assisté est
      actif. Le brief §9 rappelle le précédent : une mesure a déjà fait
      corriger une promesse d'écran devenue fausse. Celle-ci doit suivre
      l'état réel du réglage, dans les deux sens.

   2. L'ONGLET VOCABULAIRE. Emporter son dictionnaire et reprendre celui
      d'un autre : un vrai fichier est déposé dans le champ, et on
      vérifie que les mots entrent, que les lignes invalides sont
      écartées, et que la liste existante n'est PAS remplacée.

   Le vrai `app/ghostwriter-proof.js` est chargé — rien n'est réimplémenté.
   Aucun réseau : le worker n'est pas joint (pas de jeton), le correcteur
   retombe sur son miroir local, ce qui est justement le cas à couvrir.

   node scripts/test-proof-ui.mjs      ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0, failed = 0;
const echecs = [];
function check(nom, cond, detail) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${nom}`); }
  else {
    failed++; echecs.push(nom);
    console.error(`  \x1b[31m✗\x1b[0m ${nom}${detail !== undefined ? `  \x1b[2m→ ${detail}\x1b[0m` : ''}`);
  }
}
const titre = (t) => console.log(`\n\x1b[1m▶ ${t}\x1b[0m`);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
};

// Les mots déjà appris par CE navigateur, avant tout import.
const DEJA = ['degrima', 'vaurelle', 'kerhoas'];

const page = (arbitrage) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link rel="stylesheet" href="/app/style.css"><link rel="stylesheet" href="/app/workspace.css"></head>
<body><script type="module">
  localStorage.setItem('ks_proof_ignore_words', ${JSON.stringify(JSON.stringify(DEJA))});
  localStorage.setItem('ks_proof_ia_arbitrage', '${arbitrage}');
  localStorage.removeItem('ks_jwt');            // pas de licence : miroir local seul
  const m = await import('/app/ghostwriter-proof.js');
  m.openGhostwriterProof('dico');
  window.__PRET__ = true;
</script></body></html>`;

function demarrerServeur() {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (p === '/assiste.html' || p === '/local.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(page(p === '/assiste.html' ? '1' : '0'));
    }
    const cible = normalize(join(ROOT, p));
    if (!cible.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(cible, (e, d) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        'Content-Type': MIME[extname(cible).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(d);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const srv  = await demarrerServeur();
const BASE = `http://127.0.0.1:${srv.address().port}`;
const nav  = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
                                      defaultViewport: { width: 1180, height: 820 } });
const erreurs = [];

async function ouvrir(chemin) {
  const pg = await nav.newPage();
  pg.on('pageerror', (e) => erreurs.push(String(e.message)));
  pg.on('console', (m) => { if (m.type() === 'error') erreurs.push('console: ' + m.text()); });
  await pg.goto(BASE + chemin, { waitUntil: 'networkidle0' });
  await pg.waitForFunction('window.__PRET__ === true', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 400));
  return pg;
}
const texteDe = (pg, sel) => pg.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, sel);

try {

/* ─────────────────────────────────────────────────────────────── */
titre('La promesse affichée suit l\'état réel du réglage');
{
  const pg = await ouvrir('/assiste.html');
  const promesse = await texteDe(pg, '.pf-credit');
  check('tri ASSISTÉ · la promesse ne dit PLUS « rien n\'est envoyé »',
    !/rien n['’]est envoyé/i.test(promesse), promesse);
  check('tri ASSISTÉ · elle dit que le texte, lui, ne sort pas',
    /texte ne sort jamais/i.test(promesse), promesse);
  check('tri ASSISTÉ · elle dit ce qui sort (les mots signalés et leur phrase)',
    /mots signalés/i.test(promesse) && /phrase/i.test(promesse), promesse);
  check('tri ASSISTÉ · elle dit comment revenir au tout-local',
    /Tri des alertes/i.test(promesse), promesse);
  await pg.close();

  const pg2 = await ouvrir('/local.html');
  const promesse2 = await texteDe(pg2, '.pf-credit');
  check('tri SUR L\'APPAREIL · la promesse redevient « rien n\'est envoyé en ligne »',
    /rien n['’]est envoyé en ligne/i.test(promesse2), promesse2);
  check('tri SUR L\'APPAREIL · elle ne parle plus de vérification en ligne',
    !/vérifiés en ligne/i.test(promesse2), promesse2);
  await pg2.close();
}

/* ─────────────────────────────────────────────────────────────── */
titre('L\'onglet Vocabulaire');
const pg = await ouvrir('/assiste.html');
{
  check('l\'onglet existe et il est discret (pas au même rang que Texte et PDF)',
    await pg.evaluate(() => {
      const t = document.querySelector('.pf-tab-discret');
      return !!t && getComputedStyle(t).opacity !== '' && t.textContent.includes('Vocabulaire');
    }));
  check('le vocabulaire déjà appris est listé',
    (await pg.evaluate(() => document.querySelectorAll('.pf-dico-list .pf-ignore-tag').length)) === DEJA.length);
  const boutons = await pg.evaluate(() => [...document.querySelectorAll('.pf-dico-btn')].map((b) => b.textContent.trim()));
  check('« Exporter » et « Importer » sont là', boutons.includes('Exporter') && boutons.includes('Importer'), boutons.join(', '));
  check('la note dit que l\'import COMPLÈTE et ne remplace pas',
    /compl[eè]te/i.test(await texteDe(pg, '.pf-dico-note')));
  check('la note annonce le vocabulaire livré avec l\'outil',
    /\d+ mots de vocabulaire courant/.test(await texteDe(pg, '.pf-dico-note')));
}

/* ─────────────────────────────────────────────────────────────── */
titre('Reprendre le vocabulaire de quelqu\'un d\'autre');
{
  // Le fichier qu'un confrère transmettrait : des commentaires, des mots
  // valides, un doublon, et trois lignes que le serveur refuserait.
  const fichier = join(os.tmpdir(), 'vocabulaire-confrere.txt');
  fs.writeFileSync(fichier, [
    '# Vocabulaire du correcteur — Keystone',
    '# 4 mots · exporté le 21/08/2026',
    '',
    'Beaufort',
    'CASTELNAU',
    'al-Mansouri',
    'degrima',           // déjà connu ici : ne doit pas compter deux fois
    'VT4',               // refusé : contient un chiffre
    'ab',                // refusé : trop court
    'deux mots',         // refusé : une espace
  ].join('\n'), 'utf8');

  // Le champ de fichier est créé au clic : on l'intercepte.
  const [chooser] = await Promise.all([
    pg.waitForFileChooser({ timeout: 5000 }),
    pg.evaluate(() => document.querySelector('[data-act="dico-import"]').click()),
  ]);
  await chooser.accept([fichier]);
  await new Promise((r) => setTimeout(r, 600));

  const apres = await pg.evaluate(() => ({
    mots: [...document.querySelectorAll('.pf-dico-list .pf-ignore-tag')].map((s) => s.textContent.replace(/\s+/g, '')),
    stock: JSON.parse(localStorage.getItem('ks_proof_ignore_words') || '[]'),
  }));
  const set = new Set(apres.stock);
  check('les mots valides du fichier sont entrés',
    ['beaufort', 'castelnau', 'al-mansouri'].every((w) => set.has(w)), apres.stock.join(', '));
  check('ils sont normalisés en minuscules', !apres.stock.some((w) => w !== w.toLowerCase()));
  check('⚠ la liste existante n\'a PAS été remplacée', DEJA.every((w) => set.has(w)), apres.stock.join(', '));
  check('un doublon ne crée pas de seconde entrée', apres.stock.filter((w) => w === 'degrima').length === 1);
  check('un token à chiffres est refusé (VT4)', !set.has('vt4'));
  check('un mot de 2 signes est refusé (ab)', !set.has('ab'));
  check('une ligne à deux mots est refusée', !apres.stock.some((w) => /\s/.test(w)));
  check('les lignes de commentaire (#) ne deviennent pas des mots',
    !apres.stock.some((w) => w.startsWith('#') || w.includes('keystone')), apres.stock.join(', '));
  check('la liste à l\'écran reflète le nouveau total', apres.mots.length === apres.stock.length);
  fs.unlinkSync(fichier);
}

/* ─────────────────────────────────────────────────────────────── */
titre('Emporter le sien');
{
  const nom = await pg.evaluate(async () => {
    // On intercepte le téléchargement au lieu d'écrire sur le disque.
    let capture = null;
    const vrai = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { capture = this.download; };
    document.querySelector('[data-act="dico-export"]').click();
    HTMLAnchorElement.prototype.click = vrai;
    return capture;
  });
  check('l\'export propose un fichier texte daté',
    typeof nom === 'string' && /^vocabulaire-keystone-\d{4}-\d{2}-\d{2}\.txt$/.test(nom), String(nom));
}

titre('Hygiène');
{
  const graves = erreurs.filter((e) => !/favicon|ERR_|pdfjs/.test(e));
  check('aucune erreur JavaScript pendant le parcours', graves.length === 0, graves.slice(0, 3).join(' | '));
}
await pg.close();

} finally {
  await nav.close();
  srv.close();
}

console.log(`\n${passed + failed} vérifications — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
if (failed) console.error('\nÉchecs :\n  - ' + echecs.join('\n  - '));
process.exit(failed ? 1 : 0);
