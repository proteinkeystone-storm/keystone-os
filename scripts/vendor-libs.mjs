#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Vendorisation des bibliothèques front — audit sécu sept. 2026 · M-3
   ─────────────────────────────────────────────────────────────
   POURQUOI
   Le front chargeait six bibliothèques depuis esm.sh et unpkg. La CSP
   devait donc autoriser ces deux origines comme sources de SCRIPT : une
   compromission de l'un de ces CDN, ou un détournement de paquet, et du
   code arbitraire s'exécutait sur protein-keystone.com — avec accès au
   localStorage, donc aux jetons de session.

   On sert désormais ces bibliothèques depuis notre propre domaine, et
   `esm.sh` / `unpkg.com` ont disparu de la CSP.

   POURQUOI UN SCRIPT PLUTÔT QU'UN COPIER-COLLER
   Pour que la mise à jour d'une version reste un geste reproductible et
   vérifiable : on change le numéro dans package.json, on relance
   `npm run vendor-libs`, et le diff montre exactement ce qui bouge.

   TROIS FORMES DE PAQUETS, TROIS TRAITEMENTS
   1. ESM déjà autonome (pdf-lib, dexie) → copie telle quelle.
   2. ESM à dépendances (jspdf : fflate + helper Babel) → compilé en un
      seul fichier par esbuild. Un navigateur ne sait pas résoudre un
      import « nu » ; c'est exactement le service que rendait esm.sh.
   3. UMD sans build ESM (qrcode-generator) → on ajoute l'export ESM.
      Le bloc UMD de fin devient inerte dans un module (`typeof exports`
      y vaut 'undefined'), donc le fichier reste fidèle à l'original.

   Paged.js est chargé par une balise <script>, pas par un import : son
   polyfill UMD est copié tel quel.
   ═══════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT   = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'app', 'vendor');
const NM     = path.join(ROOT, 'node_modules');

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(VENDOR, to)), { recursive: true });
  fs.copyFileSync(path.join(NM, from), path.join(VENDOR, to));
  return fs.statSync(path.join(VENDOR, to)).size;
};

/** Plusieurs fichiers d'un même paquet (pdf.js : la lib + son worker). */
const copyMany = (pairs) => {
  let total = 0;
  for (const [from, to] of pairs) total += copy(from, to);
  return total;
};

const bundle = (entry, to) => {
  execFileSync(path.join(NM, '.bin', 'esbuild'), [
    path.join(NM, entry), '--bundle', '--format=esm', '--minify',
    '--platform=browser', '--legal-comments=none',
    '--outfile=' + path.join(VENDOR, to),
  ], { stdio: 'pipe' });
  return fs.statSync(path.join(VENDOR, to)).size;
};

/** UMD → ESM : le source intact + l'export que consomme l'application. */
const wrapUmd = (from, to, exportName) => {
  const src = fs.readFileSync(path.join(NM, from), 'utf8');
  const out = `${src}\n\n/* Vendorisé pour Keystone (scripts/vendor-libs.mjs).\n   Le bloc UMD ci-dessus est inerte dans un module ES : \`typeof exports\`\n   y vaut 'undefined'. On expose l'export attendu par l'application. */\nexport default ${exportName};\n`;
  fs.writeFileSync(path.join(VENDOR, to), out);
  return fs.statSync(path.join(VENDOR, to)).size;
};

const version = p => JSON.parse(fs.readFileSync(path.join(NM, p, 'package.json'), 'utf8')).version;

fs.mkdirSync(VENDOR, { recursive: true });

const done = [
  ['qrcode-generator', version('qrcode-generator'), wrapUmd('qrcode-generator/qrcode.js', 'qrcode-generator.mjs', 'qrcode')],
  ['pdf-lib',          version('pdf-lib'),          copy('pdf-lib/dist/pdf-lib.esm.min.js', 'pdf-lib.esm.min.js')],
  ['jspdf (2.5.1)',    version('jspdf-251'),        bundle('jspdf-251/dist/jspdf.es.min.js', 'jspdf-2.5.1.mjs')],
  ['jspdf (2.5.2)',    version('jspdf-252'),        bundle('jspdf-252/dist/jspdf.es.min.js', 'jspdf-2.5.2.mjs')],
  ['dexie',            version('dexie'),            copy('dexie/dist/dexie.mjs', 'dexie.mjs')],
  ['pagedjs',          version('pagedjs'),          copy('pagedjs/dist/paged.polyfill.js', 'paged.polyfill.js')],
  // Audit sept. 2026, chantier 7.2-bis — pdf.js était vendorisé À LA MAIN,
  // donc ABSENT de package.json, donc INVISIBLE à `npm audit`. C'est
  // pourtant la seule bibliothèque du front qui PARSE un fichier non
  // maîtrisé (pré-impression desK, import booK, planches Kortex) : un CVE
  // sur elle n'aurait déclenché aucune alerte. Elle est désormais suivie.
  // Parité vérifiée au moment de l'inscription : les deux fichiers déjà
  // servis en production sont bit pour bit ceux de pdfjs-dist@4.10.38.
  ['pdf.js',           version('pdfjs-dist'),       copyMany([
    ['pdfjs-dist/build/pdf.min.mjs',        'pdfjs/pdf.min.mjs'],
    ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
  ])],
];

for (const [name, v, size] of done) {
  console.log(`  ${name.padEnd(18)} v${String(v).padEnd(8)} ${(size / 1024).toFixed(0).padStart(5)} Ko`);
}

// Garde-fou : un import « nu » resté dans un fichier vendorisé casserait la
// bibliothèque en silence, une fois en production seulement.
let bad = 0;
const aVerifier = [
  ...fs.readdirSync(VENDOR).filter(f => /^(qrcode-generator|pdf-lib|jspdf|dexie)/.test(f)),
  // pdf.js vit dans un sous-dossier : il doit passer le même contrôle.
  ...['pdfjs/pdf.min.mjs', 'pdfjs/pdf.worker.min.mjs'].filter(f => fs.existsSync(path.join(VENDOR, f))),
];
for (const f of aVerifier) {
  const src = fs.readFileSync(path.join(VENDOR, f), 'utf8');
  const nu = src.match(/(?:^|[;}\n])import\s*[^;]*?from\s*["'][^.\/][^"']*["']/g);
  if (nu) { console.error(`  ✗ ${f} : ${nu.length} import(s) non résolu(s) — ${nu[0].trim().slice(0, 60)}`); bad++; }
}
console.log(bad ? `\n✗ ${bad} fichier(s) à problème` : '\n✓ aucun import non résolu — tout est autonome');
process.exit(bad ? 1 : 0);
