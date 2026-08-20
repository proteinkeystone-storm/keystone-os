#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — GP-0 · L'ÉCRAN DE RELECTURE

   `mesure-proof.mjs` produit une liste d'alertes ; il faut dire, pour
   chacune, si le correcteur a raison. Ce verdict est le socle de tous
   les sprints suivants — mais il se rendait jusqu'ici dans un fichier
   JSON, ce qui n'est pas une interface pour un rédacteur en chef.

   Ce script sert `_design-lab/relire-proof.html` : l'article s'affiche
   avec ses alertes surlignées, un clic (ou une touche) tranche, et
   l'enregistrement se fait tout seul dans `_corpus-proof/verite.json`.
   Aucun fichier à ouvrir, aucune accolade à taper.

   ⚠ Le dépôt est PUBLIC. Le texte des articles ne transite qu'en
   mémoire, entre `_corpus-proof/` (ignoré par git) et le navigateur
   local. La page versionnée, elle, ne contient aucun texte réel.

   ── Lancer ──────────────────────────────────────────────────────
     npm run relire:proof
   Puis, quand c'est fini :
     npm run mesure:proof      (les chiffres se refont sur vos verdicts)
   ═══════════════════════════════════════════════════════════════ */

import http               from 'node:http';
import fs                 from 'node:fs';
import crypto             from 'node:crypto';
import { execFile }       from 'node:child_process';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const _arg      = process.argv.slice(2).find(a => !a.startsWith('--')) || '_corpus-proof';
const CORPUS    = isAbsolute(_arg) ? _arg : join(ROOT, _arg);
const PAGE      = join(ROOT, '_design-lab/relire-proof.html');
const SANS_OUVRIR = process.argv.includes('--no-open');   // vérification automatisée
// Port fixe : permet de retrouver une page restée ouverte sur un serveur éteint
// (ses décisions vivent encore dans l'onglet) — cf. incident du 2026-08-20.
const _p = (process.argv.find(a => a.startsWith('--port=')) || '').split('=')[1];
const PORT = Number(_p) || 0;

const gris = s => `\x1b[2m${s}\x1b[0m`;
const gras = s => `\x1b[1m${s}\x1b[0m`;
const rouge = s => `\x1b[31m${s}\x1b[0m`;

// La MÊME normalisation que le moteur : sans elle, les offsets des alertes
// (calculés sur le texte canonique) ne tombent pas en face des mots.
const { canonicalizeText } = await import(pathToFileURL(join(ROOT, 'app/lib/proof-engine.js')).href);
const empreinte = t => 'sha1:' + crypto.createHash('sha1').update(t, 'utf8').digest('hex').slice(0, 16);

const cheminVerite = join(CORPUS, 'verite.json');
const cheminModele = join(CORPUS, 'verite.modele.json');

function chargerVerite() {
  const src = fs.existsSync(cheminVerite) ? cheminVerite
            : fs.existsSync(cheminModele) ? cheminModele : null;
  if (!src) return null;
  return JSON.parse(fs.readFileSync(src, 'utf8'));
}

function ecrireVerite(v) {
  fs.writeFileSync(cheminVerite, JSON.stringify(v, null, 2), 'utf8');
}

// Assemble ce que la page consomme : le texte canonique + les alertes avec
// leur position réelle (la clé « offset+len » est la source de vérité).
function corpus() {
  const v = chargerVerite();
  if (!v) {
    return { erreur: 'Aucune mesure à relire',
             detail: 'Lancez d\'abord : npm run mesure:proof' };
  }
  const textes = [];
  for (const [nom, bloc] of Object.entries(v.textes || {})) {
    const chemin = join(CORPUS, nom);
    if (!fs.existsSync(chemin)) continue;
    const texte = canonicalizeText(fs.readFileSync(chemin, 'utf8'));
    textes.push({
      nom, texte,
      empreinte: empreinte(texte),
      empreinteAttendue: bloc.empreinte || '',
      manques: (bloc.manques || []).filter(m => m && m.extrait && !/^\(/.test(m.extrait)),
      alertes: (bloc.alertes || []).map((a) => {
        const [off, len] = String(a.cle).split('+').map(Number);
        return {
          cle: a.cle, offset: off, len: len,
          type: a.type, mot: a.mot, regle: a.regle || '',
          message: a.message || '', phrase: a.phrase || '',
          suggestions: a.suggestions || [],
          verdict: a.verdict || null,
          par: a.par || (a.verdict ? 'claude' : null),   // proposition tant que non confirmée
          _pourquoi: a._pourquoi || '',
        };
      }),
    });
  }
  if (!textes.length) return { erreur: 'Corpus introuvable', detail: 'Les .txt ont disparu de ' + CORPUS };
  return { textes };
}

// Applique un lot de décisions. Chaque entrée porte SOIT un verdict d'alerte,
// SOIT la liste des fautes ratées d'un texte.
function appliquer(lot) {
  const v = chargerVerite();
  if (!v) return { ok: false };
  for (const e of lot) {
    const bloc = v.textes && v.textes[e.fichier];
    if (!bloc) continue;
    if (Array.isArray(e.manques)) { bloc.manques = e.manques; continue; }
    const a = (bloc.alertes || []).find(x => x.cle === e.cle);
    if (!a) continue;
    if (e.verdict) a.verdict = e.verdict;
    a.par = 'stephane';                       // confirmé à la main
  }
  v._relu = { le: new Date().toISOString(), par: 'Stéphane (écran de relecture)' };
  ecrireVerite(v);
  const total = Object.values(v.textes).reduce((n, b) => n + (b.alertes || []).length, 0);
  const conf  = Object.values(v.textes).reduce((n, b) => n + (b.alertes || []).filter(a => a.par === 'stephane').length, 0);
  return { ok: true, confirmees: conf, total };
}

const srv = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://127.0.0.1').pathname;
  const json = (o) => {
    const b = JSON.stringify(o);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(b);
  };
  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(PAGE));
  }
  if (p === '/api/corpus') return json(corpus());
  if (p === '/api/verdicts' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let lot = [];
      try { lot = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
      const r = appliquer(Array.isArray(lot) ? lot : [lot]);
      if (r.ok) process.stdout.write(`\r  ${gras(r.confirmees + '/' + r.total)} confirmées${' '.repeat(20)}`);
      json(r);
    });
    return;
  }
  res.writeHead(404); res.end();
});

if (!fs.existsSync(cheminVerite) && !fs.existsSync(cheminModele)) {
  console.error(rouge('\n  Aucune mesure à relire.') + '\n  Lancez d\'abord : ' + gras('npm run mesure:proof') + '\n');
  process.exit(1);
}

srv.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${srv.address().port}/`;
  console.log(`\n  ${gras('Écran de relecture ouvert')}`);
  console.log(`  ${url}`);
  console.log(gris('\n  F = c\'est une faute · C = le texte est correct · ← → naviguer'));
  console.log(gris('  Tout s\'enregistre au fur et à mesure. Ctrl+C pour fermer,'));
  console.log(gris('  puis « npm run mesure:proof » pour refaire les chiffres.\n'));
  if (process.platform === 'darwin' && !SANS_OUVRIR) execFile('open', [url], () => {});
});
