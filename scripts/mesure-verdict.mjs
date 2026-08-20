#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   GP-5 — LE CRITÈRE DE MISE EN SERVICE

   L'arbitrage invisible n'a le droit d'être allumé QUE si, sur le
   corpus, il ne masque AUCUNE vraie faute (brief §5/GP-5). Ce script
   le vérifie avec de VRAIS appels au modèle, sur les alertes que le
   correcteur affiche réellement aujourd'hui, et confronte chaque
   verdict à la vérité terrain établie par Stéphane.

   Il répond à trois questions, dans cet ordre d'importance :
     1. combien de VRAIES fautes le juge efface-t-il ?   → doit être 0
     2. combien de faux positifs enlève-t-il ?           → le gain
     3. combien de passages ne juge-t-il pas ?           → sans effet

   ⚠ NON DÉTERMINISTE ET FACTURÉ : chaque passage est un vrai appel
     Workers AI. Ce script n'est donc PAS dans `npm test`. On le lance
     à la main, quand on veut re-mesurer — après un changement de
     modèle, de consigne, ou de catégorie jugée.

   ── Lancer ──────────────────────────────────────────────────────
   1. Le worker de préversion (le binding AI tape le VRAI Workers AI) :
        cd workers && npx wrangler dev --local -c wrangler.dktest.toml \
          --port 8799 --var KS_JWT_SECRET:dk2-test-secret \
          --var "KS_ALLOWED_ORIGIN:*"
   2. node scripts/mesure-verdict.mjs
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { join, dirname, extname, normalize, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dirname, '..');
const _arg   = process.argv.slice(2).find((a) => !a.startsWith('--')) || '_corpus-proof';
const CORPUS = isAbsolute(_arg) ? _arg : join(ROOT, _arg);
const API    = process.env.PROOF_API || 'http://127.0.0.1:8799';
const SECRET = process.env.PROOF_JWT_SECRET || 'dk2-test-secret';

const gris  = (s) => `\x1b[2m${s}\x1b[0m`;
const gras  = (s) => `\x1b[1m${s}\x1b[0m`;
const vert  = (s) => `\x1b[32m${s}\x1b[0m`;
const ambre = (s) => `\x1b[33m${s}\x1b[0m`;
const rouge = (s) => `\x1b[31m${s}\x1b[0m`;

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest())}`;
}
// plan ADMIN : on mesure le JUGE, pas le quota.
const TOKEN = jwt({ sub: 'mesure-gp5', plan: 'ADMIN', email: 'gp5@test.fr' });

// ── Le corpus et sa vérité terrain ──────────────────────────────
if (!fs.existsSync(join(CORPUS, 'verite.json'))) {
  console.error(rouge('\n  Pas de vérité terrain à confronter.'));
  console.error('  Il faut ' + gras(CORPUS.replace(ROOT + '/', '') + '/verite.json') + ' — voir npm run mesure:proof.\n');
  process.exit(1);
}
const verite = JSON.parse(fs.readFileSync(join(CORPUS, 'verite.json'), 'utf8'));

// ── Le moteur, dans un vrai navigateur (comme mesure-proof.mjs) ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const HARNAIS = `<!doctype html><meta charset="utf-8"><script type="module">
  const e = await import('/app/lib/proof-engine.js');
  e.setProofOptions({ apos:false, maj:false, minis:false, typo:false, esp:false, nbsp:false, tab:false, num:false, exposant:false });
  e.setProofFilters({ ignoreWords: [] });
  await e.warmUp(); window.__E__ = e; window.__READY__ = true;
<\/script>`;
function serveur() {
  const srv = http.createServer((rq, rs) => {
    const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
    if (p === '/h.html') { rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return rs.end(HARNAIS); }
    const c = normalize(join(ROOT, p));
    if (!c.startsWith(ROOT)) { rs.writeHead(403); return rs.end(); }
    fs.readFile(c, (e, d) => {
      if (e) { rs.writeHead(404); return rs.end(); }
      rs.writeHead(200, { 'Content-Type': MIME[extname(c).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      rs.end(d);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// La MÊME phrase que celle que l'interface enverra (app/ghostwriter-proof.js).
function phraseDe(texte, offset, len) {
  const OUVRE = /[.?!…\n]/;
  let d = offset;
  while (d > 0 && !OUVRE.test(texte.charAt(d - 1))) d--;
  let f = offset + len;
  while (f < texte.length && !OUVRE.test(texte.charAt(f))) f++;
  if (f < texte.length) f++;
  let avant = texte.slice(d, offset).replace(/\s+/g, ' ');
  let apres = texte.slice(offset + len, f).replace(/\s+/g, ' ');
  if (avant.length > 120) avant = '…' + avant.slice(-120);
  if (apres.length > 120) apres = apres.slice(0, 120) + '…';
  return (avant + texte.slice(offset, offset + len) + apres).trim();
}

const cle = (it) => `${it.offset}+${it.len}`;
const verdictDe = (fichier, k) => {
  const b = verite.textes && verite.textes[fichier];
  if (!b) return null;
  const a = (b.alertes || []).find((x) => x.cle === k);
  const v = a && a.verdict;
  return (v === 'vraie' || v === 'faux-positif') ? v : null;
};

const srv  = await serveur();
const nav  = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await nav.newPage();
let sortie = 0;

try {
  await page.goto(`http://127.0.0.1:${srv.address().port}/h.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__ === true', { timeout: 120000 });

  // ── Les alertes réellement AFFICHÉES aujourd'hui ──────────────
  const passages = [];
  for (const nom of Object.keys(verite.textes || {})) {
    const chemin = join(CORPUS, nom);
    if (!fs.existsSync(chemin)) continue;
    const brut = fs.readFileSync(chemin, 'utf8');
    const r = await page.evaluate(async (t) => {
      const e = window.__E__;
      const a = await e.analyze(t);                    // chemin de PRODUCTION
      // On marque ici ce que le juge a le droit de voir, avec la VRAIE
      // fonction du moteur — celle que l'interface utilise.
      return { texte: a.text, issues: a.issues.map((i) => ({ ...i, arbitrable: e.isArbitrable(i) })) };
    }, brut);
    for (const it of r.issues) {
      if (!it.arbitrable) continue;         // décidé par le moteur (isArbitrable)
      passages.push({
        fichier: nom, mot: it.word,
        phrase: phraseDe(r.texte, it.offset, it.len),
        attendu: verdictDe(nom, cle(it)),
      });
    }
  }

  if (!passages.length) {
    console.log(ambre('\n  Aucune alerte d\'orthographe affichée sur le corpus — rien à juger.\n'));
  } else {
    console.log(`\n${gras('▶ GP-5 · critère de mise en service')}`);
    console.log(gris(`   ${passages.length} passage(s) d'orthographe affiché(s), soumis au vrai modèle via ${API}`));

    // Par lots de 25, comme l'interface.
    const verdicts = [];
    for (let i = 0; i < passages.length; i += 25) {
      const lot = passages.slice(i, i + 25);
      const items = lot.map((p, k) => ({ id: 'i' + k, mot: p.mot, phrase: p.phrase }));
      let d = null;
      try {
        const res = await fetch(`${API}/api/ghostwriter/proof-verdict`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) { console.error(rouge(`   HTTP ${res.status} — le worker de préversion tourne-t-il ?`)); process.exit(1); }
        d = await res.json();
      } catch (e) {
        console.error(rouge(`   Appel impossible : ${e.message}`));
        console.error(gris('   Lancez le worker : cd workers && npx wrangler dev --local -c wrangler.dktest.toml --port 8799 --var KS_JWT_SECRET:dk2-test-secret --var "KS_ALLOWED_ORIGIN:*"'));
        process.exit(1);
      }
      lot.forEach((p, k) => verdicts.push({ ...p, rendu: (d.verdicts || {})['i' + k] || null }));
    }

    // ── Le verdict du verdict ──────────────────────────────────
    const efface   = verdicts.filter((v) => v.rendu === 'faux-positif');
    const perdues  = efface.filter((v) => v.attendu === 'vraie');
    const gagnes   = efface.filter((v) => v.attendu === 'faux-positif');
    const nonJuges = verdicts.filter((v) => !v.rendu);
    const restants = verdicts.filter((v) => v.rendu === 'vraie' && v.attendu === 'faux-positif');

    console.log(`\n${gras('  Ce que le juge a fait')}`);
    console.log(`   ${vert('gain ')} ${gagnes.length} faux positif(s) effacé(s)`);
    console.log(`   ${rouge('perte')} ${perdues.length} VRAIE(S) faute(s) effacée(s)`);
    console.log(`   ${gris('inerte')} ${restants.length} faux positif(s) qu'il a laissés, ${nonJuges.length} passage(s) non jugé(s)`);
    for (const v of perdues) console.log(rouge(`        · ${v.fichier} « ${v.mot} » — ${v.phrase.slice(0, 70)}`));
    if (gagnes.length) console.log(gris('        effacés : ' + gagnes.map((v) => v.mot).join(', ')));

    const fpAvant = verdicts.filter((v) => v.attendu === 'faux-positif').length;
    console.log(`\n${gras('  Effet sur le tableau de bord')}`);
    console.log(`   faux positifs d'orthographe : ${fpAvant} → ${fpAvant - gagnes.length}`);

    console.log(`\n${gras('  Critère de mise en service (§5/GP-5)')}`);
    if (perdues.length === 0) {
      console.log(`   ${vert('✓ ZÉRO vraie faute masquée')} — l'arbitrage peut être mis en service.`);
    } else {
      console.log(`   ${rouge('✗ ' + perdues.length + ' vraie(s) faute(s) masquée(s))')} — NE PAS mettre en service en l'état.`);
      console.log(gris('   Restreindre ce que le juge a le droit de toucher, puis re-mesurer (brief §5/GP-5).'));
      sortie = 1;
    }
  }
} finally {
  await nav.close();
  srv.close();
}
process.exit(sortie);
