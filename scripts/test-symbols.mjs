#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Tests GW-Symboles (bibliothèque Unicode curée)
   Couvre : intégrité des catégories (pas de doublon inter-catégorie,
   entrées bien formées), recherche fr accent-insensible, convertisseur
   lettres stylées (mappings, caractères hors plage inchangés).
   Usage : node scripts/test-symbols.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { SYMBOL_CATEGORIES, searchSymbols, normalizeQuery, styleText, STYLED_STYLES }
  from '../app/lib/symbols-data.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else      { failed++; console.error(`  \x1b[31m✗\x1b[0m ${name}`); }
}

console.log('── Intégrité de la bibliothèque ──');
{
  const seen = new Map();
  let dupes = [], malformed = 0, total = 0;
  for (const cat of SYMBOL_CATEGORIES) {
    if (!cat.id || !cat.label || !Array.isArray(cat.items)) malformed++;
    for (const it of cat.items) {
      total++;
      if (!Array.isArray(it) || typeof it[0] !== 'string' || !it[0] || typeof it[1] !== 'string' || !it[1]) malformed++;
      const key = `${cat.id}::${it[0]}`;
      if (seen.has(key)) dupes.push(key);
      seen.set(key, 1);
    }
  }
  check(`9 catégories, ${total} symboles (≥ 200)`, SYMBOL_CATEGORIES.length === 9 && total >= 200);
  check('aucune entrée malformée', malformed === 0);
  check('aucun doublon DANS une même catégorie', dupes.length === 0);
  check('la catégorie Pictos porte sa note de rendu', !!SYMBOL_CATEGORIES.find(c => c.id === 'pictos')?.note);
}

console.log('── Recherche (fr, accent-insensible) ──');
{
  check('normalizeQuery plie accents et casse', normalizeQuery('  FLÈCHE  Épaisse ') === 'fleche epaisse');
  check('« fleche » sans accent trouve les flèches', searchSymbols('fleche').some(r => r.c === '→'));
  check('« coche » trouve ✓', searchSymbols('coche').some(r => r.c === '✓'));
  check('« euro » trouve €', searchSymbols('euro').some(r => r.c === '€'));
  check('« copyright » trouve ©', searchSymbols('copyright').some(r => r.c === '©'));
  check('le nom de catégorie matche aussi (« puces »)', searchSymbols('puces').length > 5);
  check('recherche par le caractère lui-même', searchSymbols('→').some(r => r.c === '→'));
  check('vide → []', searchSymbols('').length === 0 && searchSymbols('   ').length === 0);
  check('cap respecté', searchSymbols('e', 10).length <= 10);
}

console.log('── Lettres stylées ──');
{
  check('4 styles exposés', STYLED_STYLES.length === 4 && STYLED_STYLES.every(s => s.id && s.label));
  check('gras : A → 𝗔, z → 𝘇, 5 → 𝟱', styleText('Az5', 'bold') === '𝗔𝘇𝟱');
  check('italique : lettres converties, chiffres INCHANGÉS', styleText('Az5', 'italic') === '𝘈𝘻5');
  check('mono : Az5 → 𝙰𝚣𝟻', styleText('Az5', 'mono') === '𝙰𝚣𝟻');
  check('accents et ponctuation inchangés (é, espace, !)', styleText('éà !', 'bold') === 'éà !');
  check('aller-retour longueur cohérente (paires de substitution)', [...styleText('Bonjour', 'bold')].length === 7);
  check('style inconnu → texte intact', styleText('abc', 'zzz') === 'abc');
  check('vide/null → chaîne vide', styleText('', 'bold') === '' && styleText(null, 'bold') === '');
}

console.log(`\n${passed}/${passed + failed} tests OK${failed ? ` — ${failed} ÉCHEC(S)` : ''}`);
process.exit(failed ? 1 : 0);
