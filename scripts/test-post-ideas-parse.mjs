#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test parsePostIdeas (mode « Idées de Posts »)

   Fix 19/07 (capture Stéphane) : le tiroir de synthèse affichait des
   CARTES DE JSON BRUT (```json, "idees": [, "angle": "…", …) au lieu
   des 5 idées attendues. Cause : l'ancienne regex exigeait la clé
   LITTÉRALE "ideas" dans le texte AVANT même de tenter le JSON.parse —
   le modèle a répondu avec "idees" (sans accent) au lieu de "ideas" ;
   la regex ratait tout, le JSON (valide, juste mal nommé) n'était
   jamais essayé, et le texte brut tombait dans le repli ligne-à-ligne,
   qui a découpé le JSON LUI-MÊME en fausses « idées ».

   Fix : parsePostIdeas n'exige plus aucun nom de clé — extraction de
   TOUS les objets JSON équilibrés du texte (comptage d'accolades hors
   chaînes), puis on retient le premier tableau top-level dont les
   éléments ressemblent à des idées ({angle,hook} ou l'un des deux).

   Usage : node scripts/test-post-ideas-parse.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePostIdeas } from '../workers/src/routes/brainstorming.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else      { failed++; console.error(`  \x1b[31m✗\x1b[0m ${name}`); }
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — LE BUG EXACT (capture 19/07)\x1b[0m');
{
  // Reproduction fidèle : fence ```json + clé « idees » sans accent (dérive
  // du modèle) au lieu de « ideas » — exactement le texte qui produisait les
  // cartes "```json" / "idees": [" / "angle": "…" à l'écran.
  const raw = '```json\n{"idees": [\n' +
    '{"angle": "Simplicité de création", "hook": "Créez votre agent en 5 secondes grâce à nos gabarits métiers."},\n' +
    '{"angle": "Disponibilité 24/7", "hook": "Un agent qui répond même à 3h du matin."}\n' +
    ']}\n```';
  const out = parsePostIdeas(raw);
  check('5 idées ou moins, ici 2 items exploitables', out.length === 2);
  check('angle #1 = texte réel (pas "```json")', out[0]?.angle === 'Simplicité de création');
  check('hook #1 = texte réel', out[0]?.hook === 'Créez votre agent en 5 secondes grâce à nos gabarits métiers.');
  check('angle #2 = texte réel', out[1]?.angle === 'Disponibilité 24/7');
  check('AUCUNE carte ne contient de fragment JSON brut',
    !out.some(it => /```|^idees"|^angle"|^hook"|:\s*\[/.test(it.angle) || /```|^idees"|^angle"|^hook"/.test(it.hook)));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — non-régression (clé correcte, avec/sans fence, texte autour)\x1b[0m');
{
  const nominal = '{"ideas":[{"angle":"A","hook":"H"},{"angle":"B","hook":"H2"}]}';
  const r2 = parsePostIdeas(nominal);
  check('clé "ideas" correcte, sans fence → 2 idées', r2.length === 2 && r2[0].angle === 'A' && r2[1].angle === 'B');

  const wrapped = 'Voici le résultat :\n{"ideas":[{"angle":"X","hook":"Y"}]}\nFin.';
  const r3 = parsePostIdeas(wrapped);
  check('texte AVANT/APRÈS le JSON → toujours extrait', r3.length === 1 && r3[0].angle === 'X' && r3[0].hook === 'Y');

  const fenced = '```json\n{"ideas":[{"angle":"C","hook":"D"}]}\n```';
  const r4 = parsePostIdeas(fenced);
  check('clé correcte + fence → toujours extrait', r4.length === 1 && r4[0].angle === 'C');

  const capped = '{"Ideas":[{"angle":"E"}]}';   // casse différente — même logique clé-agnostique
  const r5 = parsePostIdeas(capped);
  check('clé "Ideas" (majuscule) → extrait quand même (clé-agnostique)', r5.length === 1 && r5[0].angle === 'E');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — repli ligne-à-ligne (JSON réellement absent)\x1b[0m');
{
  const noJson = 'Simplicité de creation et gain de temps enorme pour vos equipes\nDisponibilite 24 heures sur 24 pour vos clients';
  const out = parsePostIdeas(noJson);
  check('aucun JSON → repli ligne-à-ligne toujours actif', out.length === 2 && out.every(it => !it.hook));

  check('entrée vide/non-string → []', parsePostIdeas('').length === 0 && parsePostIdeas(null).length === 0);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — Syntaxe (node --check)\x1b[0m');
try { execSync(`node --check "${join(ROOT, 'workers/src/routes/brainstorming.js')}"`, { stdio: 'pipe' }); check('brainstorming.js — syntaxe OK', true); }
catch (e) { check('brainstorming.js — syntaxe OK', false); console.error(String(e.stdout || e.stderr || e.message)); }

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
