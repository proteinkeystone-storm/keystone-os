#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — ping IndexNow
   ─────────────────────────────────────────────────────────────
   Notifie les moteurs compatibles IndexNow (Bing, Yandex, et par
   ricochet l'écosystème Copilot / recherche ChatGPT) que les URLs
   du sitemap ont changé. À lancer APRÈS un déploiement de contenu.

   Pré-requis : le fichier clé <KEY>.txt doit être servi à la racine
   du domaine (déjà commité). La clé ci-dessous = nom de ce fichier.

   Usage : npm run ping-indexnow
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOST = 'protein-keystone.com';
const KEY  = '479bed3d7dbcf3f1df65dc82deb8ea25';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

// URLs depuis le sitemap (source unique).
const sitemap = readFileSync(resolve(ROOT, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
if (!urlList.length) { console.error('✗ Aucune URL dans sitemap.xml'); process.exit(1); }

const body = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList };

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

// IndexNow renvoie 200 (accepté) ou 202 (accepté, en attente). 403 = clé non vérifiable.
console.log(`IndexNow → HTTP ${res.status} (${urlList.length} URLs soumises)`);
if (res.status === 403) console.error('  ⚠ 403 : le fichier clé n\'est pas (encore) servi à la racine. Déploie-le d\'abord.');
else if (res.status >= 400) console.error('  ⚠ réponse inattendue :', await res.text().catch(() => ''));
else console.log('  ✓ Soumission acceptée.');
