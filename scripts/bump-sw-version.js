#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — bump-sw-version
   ─────────────────────────────────────────────────────────────
   Bump automatique de la VERSION du service worker (sw.js).
   À lancer après tout deploy qui modifie un fichier .js / .css
   servi en cache-first par le SW — invalide le cache client et
   force le navigateur à fetcher les nouveaux assets.

   Usage :
     npm run bump-sw                  bump patch  X.Y.Z → X.Y.Z+1  [défaut]
     npm run bump-sw -- --minor       bump minor  X.Y.Z → X.Y+1.0
     npm run bump-sw -- --major       bump major  X.Y.Z → X+1.0.0
     npm run bump-sw -- --suffix=foo  remplace le suffix descriptif
     npm run bump-sw -- --check       affiche la version actuelle (read-only)
     npm run bump-sw -- --dry-run     affiche la cible, n'écrit pas
     npm run bump-sw -- --help        cette aide

   Format attendu dans sw.js :
     const VERSION = 'ks-os-vX.Y.Z[-suffix-descriptif]';

   Convention de versionnage Keystone :
     - patch : changement code mineur (bug fix, ajout de pad, etc.)
     - minor : sprint complet livré (Phase B, GW-1, etc.)
     - major : refacto structurel (rare — ex: changement de schema D1)
     - suffix : descriptif court du contenu (kebab-case, max 30 chars)
   ═══════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname }             from 'node:path';
import { fileURLToPath }                from 'node:url';

// ── Détermine le chemin de sw.js (relatif au script) ──────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const SW_PATH    = resolve(__dirname, '..', 'sw.js');

// Regex : capture le préfixe, X.Y.Z, le suffix optionnel, le quote fermant.
//   $1 = "const VERSION       = '" (avec espaces)
//   $2 = major (digits)
//   $3 = minor
//   $4 = patch
//   $5 = suffix (optionnel, sans le tiret)
//   $6 = "';" (ou variantes)
const VERSION_REGEX = /(const\s+VERSION\s*=\s*['"`])ks-os-v(\d+)\.(\d+)\.(\d+)(?:-([^'"`]*))?(['"`];?)/;

// ── CLI parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
    check  : args.includes('--check'),
    dryRun : args.includes('--dry-run'),
    minor  : args.includes('--minor'),
    major  : args.includes('--major'),
    help   : args.includes('--help') || args.includes('-h'),
    suffix : null,
};

// Parse --suffix=foo
for (const arg of args) {
    if (arg.startsWith('--suffix=')) {
        flags.suffix = arg.slice('--suffix='.length);
    }
}

// Validation du suffix si fourni
if (flags.suffix !== null) {
    if (flags.suffix.length > 30) {
        console.error(`✗ Suffix trop long (max 30 chars, reçu ${flags.suffix.length})`);
        process.exit(1);
    }
    if (!/^[a-z0-9-]*$/.test(flags.suffix)) {
        console.error(`✗ Suffix invalide : kebab-case uniquement (a-z, 0-9, tirets)`);
        process.exit(1);
    }
}

if (flags.help) {
    console.log(`
KEYSTONE OS — bump-sw-version

Bump la VERSION du service worker (sw.js) pour invalider le cache
client au prochain reload utilisateur.

Usage :
  npm run bump-sw                  bump patch  (X.Y.Z → X.Y.Z+1)  [défaut]
  npm run bump-sw -- --minor       bump minor  (X.Y.Z → X.Y+1.0)
  npm run bump-sw -- --major       bump major  (X.Y.Z → X+1.0.0)
  npm run bump-sw -- --suffix=foo  remplace le suffix descriptif
  npm run bump-sw -- --check       affiche la version actuelle, n'écrit pas
  npm run bump-sw -- --dry-run     affiche la cible, n'écrit pas
  npm run bump-sw -- --help        cette aide

Exemples :
  npm run bump-sw                                  # patch  + suffix conservé
  npm run bump-sw -- --minor --suffix=ghost-writer-mvp
  npm run bump-sw -- --major --suffix=schema-d1-v2
  npm run bump-sw -- --check
  npm run bump-sw -- --dry-run --minor

Convention :
  patch : bug fix, ajout d'un pad, changement mineur
  minor : sprint complet livré
  major : refacto structurel (rare)
`);
    process.exit(0);
}

// ── Lecture du sw.js ───────────────────────────────────────────────
let content;
try {
    content = readFileSync(SW_PATH, 'utf8');
} catch (err) {
    console.error(`✗ Impossible de lire ${SW_PATH}`);
    console.error(`  ${err.message}`);
    process.exit(1);
}

// ── Parse de la VERSION actuelle ──────────────────────────────────
const match = content.match(VERSION_REGEX);
if (!match) {
    console.error(`✗ Constante VERSION introuvable dans ${SW_PATH}`);
    console.error(`  Format attendu : const VERSION = 'ks-os-vX.Y.Z[-suffix]';`);
    process.exit(1);
}

const major = parseInt(match[2], 10);
const minor = parseInt(match[3], 10);
const patch = parseInt(match[4], 10);
const currentSuffix = match[5] || '';
const currentVersion = `ks-os-v${major}.${minor}.${patch}${currentSuffix ? '-' + currentSuffix : ''}`;

// ── Mode --check : affichage seul ──────────────────────────────────
if (flags.check) {
    console.log(`Version actuelle : ${currentVersion}`);
    console.log(`  major=${major}  minor=${minor}  patch=${patch}  suffix='${currentSuffix}'`);
    process.exit(0);
}

// ── Calcul nouvelle version ────────────────────────────────────────
let newMajor = major, newMinor = minor, newPatch = patch;
if (flags.major) {
    newMajor = major + 1; newMinor = 0; newPatch = 0;
} else if (flags.minor) {
    newMinor = minor + 1; newPatch = 0;
} else {
    newPatch = patch + 1;
}

// Suffix : si --suffix=foo, on remplace. Sinon on garde l'existant.
const newSuffix = flags.suffix !== null ? flags.suffix : currentSuffix;
const suffixPart = newSuffix ? `-${newSuffix}` : '';
const newVersion = `ks-os-v${newMajor}.${newMinor}.${newPatch}${suffixPart}`;

// ── Affichage du changement ────────────────────────────────────────
console.log(`Avant : ${currentVersion}`);
console.log(`Après : ${newVersion}`);

// ── Mode --dry-run : pas d'écriture ────────────────────────────────
if (flags.dryRun) {
    console.log('(--dry-run : sw.js non modifié)');
    process.exit(0);
}

// ── Écriture ───────────────────────────────────────────────────────
// On reconstruit la ligne avec les capture groups préservés ($1 = préfixe,
// $6 = quote fermante). Le contenu hors VERSION reste strictement intact.
const newContent = content.replace(
    VERSION_REGEX,
    `$1ks-os-v${newMajor}.${newMinor}.${newPatch}${suffixPart}$6`,
);

if (newContent === content) {
    console.error(`✗ Replace no-op (la version n'a pas changé — vérifier la regex)`);
    process.exit(1);
}

try {
    writeFileSync(SW_PATH, newContent, 'utf8');
    console.log(`✓ ${SW_PATH} mis à jour.`);
} catch (err) {
    console.error(`✗ Échec écriture ${SW_PATH}`);
    console.error(`  ${err.message}`);
    process.exit(1);
}
