/* ═══════════════════════════════════════════════════════════════
   Hygiène invisible du texte (app/lib/text-hygiene.js) — à sec

   Ce que le banc garantit :
   · ce qui doit PARTIR part (espaces de largeur nulle, trait d'union
     conditionnel hérité de Word, BOM, bloc « Tags » de texte caché) ;
   · ce qui doit se NORMALISER se normalise (espaces typographiques
     exotiques → espace ordinaire) ;
   · ce qui doit RESTER reste — et c'est le point qui compte le plus
     pour nous : la typographie française (espaces insécables devant
     « : ; ! ? » et dans les guillemets), les séquences emoji (ZWJ),
     les marques bidi. Un « nettoyage » qui casserait ça serait pire
     que rien : il se verrait à l'export InDesign de desK.
   · un texte déjà propre ressort IDENTIQUE (même référence), et la
     passe est idempotente ;
   · sanitizeVariants() ne touche que `text` et tolère les payloads
     bancals.

   Lancer : node scripts/test-text-hygiene.mjs
   ═══════════════════════════════════════════════════════════════ */

import { sanitizeText, inspectText, sanitizeVariants } from '../app/lib/text-hygiene.js';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m', label); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? JSON.stringify(extra).slice(0, 200) : ''); }
}
// Points de code écrits en clair : le banc doit rester lisible en diff.
const ZWSP = '​', WJ = '⁠', SHY = '­', BOM = '﻿', MVS = '᠎';
const NBSP = ' ', NNBSP = ' ', ZWJ = '‍', ZWNJ = '‌', RLM = '‏';
const THIN = ' ', EMSP = ' ', IDEO = '　';
const TAG_A = String.fromCodePoint(0xE0041), TAG_END = String.fromCodePoint(0xE007F);

console.log('\nHygiène invisible du texte\n');

/* ── Ce qui part ───────────────────────────────────────────────── */
console.log('Ce qui doit partir');
ok(sanitizeText(`Bon${ZWSP}jour`) === 'Bonjour', 'espace de largeur nulle retiré');
ok(sanitizeText(`extra${SHY}ordinaire`) === 'extraordinaire', 'trait d\'union conditionnel (Word) retiré');
ok(sanitizeText(`${BOM}Titre`) === 'Titre', 'BOM en tête retiré');
ok(sanitizeText(`a${WJ}b${MVS}c`) === 'abc', 'gluon de mots et séparateur mongol retirés');
ok(sanitizeText(`Salut${TAG_A}${TAG_END} tout le monde`) === 'Salut tout le monde', 'caractères « Tags » (texte caché) retirés');
// Cas réel : plusieurs signaux mélangés dans un même texte collé.
const sale = `${BOM}Bonjour${ZWSP} à${SHY} tous${TAG_A}, voici${ZWSP}${ZWSP} le texte.`;
ok(sanitizeText(sale) === 'Bonjour à tous, voici le texte.', 'texte collé « sale » entièrement assaini', sanitizeText(sale));

/* ── Ce qui se normalise ───────────────────────────────────────── */
console.log('\nCe qui se normalise');
ok(sanitizeText(`12${THIN}000`) === '12 000', 'espace fine → espace ordinaire');
ok(sanitizeText(`a${EMSP}b${IDEO}c`) === 'a b c', 'cadratin et espace idéographique → espace ordinaire');

/* ── Ce qui reste — la typographie française d'abord ──────────── */
console.log('\nCe qui doit rester');
const fr = `Attention${NBSP}: «${NNBSP}Bonjour${NNBSP}» ; oui${NBSP}? non${NBSP}!`;
ok(sanitizeText(fr) === fr, 'espaces insécables et fines insécables (typo française) INTACTES');
const famille = `👨${ZWJ}👩${ZWJ}👧`;
ok(sanitizeText(famille) === famille, 'séquence emoji (ZWJ) intacte');
ok(sanitizeText(`ب${ZWNJ}ب`) === `ب${ZWNJ}ب`, 'antiliant (ZWNJ) intact');
ok(sanitizeText(`${RLM}عربي`) === `${RLM}عربي`, 'marque bidi intacte');
ok(sanitizeText('café — « œuvre » … 5 € → ✓') === 'café — « œuvre » … 5 € → ✓', 'ponctuation, symboles et ligatures intacts');

/* ── Neutralité et robustesse ──────────────────────────────────── */
console.log('\nNeutralité');
const propre = 'Un texte parfaitement propre, avec accents : é è ç, et des chiffres 12 345.';
ok(sanitizeText(propre) === propre, 'texte propre ressort identique');
ok(sanitizeText(sale) === sanitizeText(sanitizeText(sale)), 'idempotent');
ok(sanitizeText('') === '' && sanitizeText(null) === null && sanitizeText(undefined) === undefined && sanitizeText(42) === 42,
   'valeurs vides / non-string rendues telles quelles');

/* ── inspectText ───────────────────────────────────────────────── */
console.log('\ninspectText');
const insp = inspectText(`${BOM}A${ZWSP}B${THIN}C${NBSP}D`);
ok(insp.removed === 2 && insp.normalized === 1 && insp.preserved === 1, 'compte juste : 2 retirés, 1 normalisé, 1 préservé', insp);
ok(insp.hits.some(h => h.codepoint === 'U+200B' && h.action === 'remove'), 'chaque prise est nommée avec son point de code', insp.hits);
ok(inspectText(propre).hits.length === 0, 'texte propre : aucune prise');

/* ── sanitizeVariants ──────────────────────────────────────────── */
console.log('\nsanitizeVariants (payload Ghost Writer)');
const v = sanitizeVariants([{ label: 'Formel', text: `Bon${ZWSP}jour` }, { label: 'Concis', text: 'Salut' }, null, { label: 'X' }]);
ok(v[0].text === 'Bonjour' && v[0].label === 'Formel', 'texte assaini, label intact');
ok(v[1].text === 'Salut', 'variante propre inchangée');
ok(v[2] === null && v[3].label === 'X' && !('text' in v[3]), 'entrées bancales tolérées');
ok(sanitizeVariants(undefined) === undefined && sanitizeVariants('x') === 'x', 'payload non-tableau rendu tel quel');

console.log(`\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
