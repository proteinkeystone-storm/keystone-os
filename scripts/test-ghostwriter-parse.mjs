/* ═══════════════════════════════════════════════════════════════
   Ghost Writer — lecture de la réponse du modèle (à sec, sans IA)

   Pourquoi ce banc existe : le 5 août 2026, la RELECTURE ouverte
   depuis desK a commencé à demander UNE version corrigée. Le modèle
   répondait parfaitement — « Relecture » puis le texte — mais le
   parseur exigeait une ligne de séparation « --- » qui n'a de sens
   qu'entre PLUSIEURS variantes. Résultat : « le modèle n'a pas
   renvoyé de variantes exploitables », alors que si.

   La leçon : un moteur simulé côté navigateur ne teste pas la
   lecture de la vraie réponse. Ce banc-là, oui — et sans consommer
   un seul neurone.

   Lancer : node scripts/test-ghostwriter-parse.mjs
   ═══════════════════════════════════════════════════════════════ */

import { gwParseVariants as parse } from '../workers/src/routes/ghostwriter.js';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m', label); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? JSON.stringify(extra).slice(0, 200) : ''); }
}

console.log('\nGhost Writer — parseur de réponse\n');

/* ── RELECTURE (solo) : un bloc, pas de séparateur ─────────────── */
console.log('Relecture — une seule version attendue');

// La réponse EXACTE qui a échoué en production.
const reelle = 'Relecture\nLe résultat s\'affiche sans carrousel, sans flèches, sans indicateurs « 1 2 3 » : le texte relu en grand.';
let r = parse(reelle, true);
ok(r && r.variants.length === 1, 'la réponse réelle de Mistral est lue', r);
ok(r && r.variants[0].label === 'Relecture', 'la 1re ligne devient le label', r && r.variants[0].label);
ok(r && r.variants[0].text.startsWith('Le résultat'), 'le reste devient le texte corrigé', r && r.variants[0].text.slice(0, 30));

r = parse('Juste le texte corrigé, sur une seule ligne assez longue pour ne pas ressembler à un label.', true);
ok(r && r.variants.length === 1 && r.variants[0].text.startsWith('Juste'), 'un bloc SANS label est lu quand même', r);

r = parse('Relecture\nTexte A.\n---\nAutre\nTexte B.', true);
ok(r && r.variants.length === 1 && r.variants[0].text === 'Texte A.',
   'un modèle bavard qui en rend plusieurs → on n\'en garde qu\'UNE', r);

r = parse('{"variants":[{"label":"Relecture","text":"Texte corrigé."}]}', true);
ok(r && r.variants.length === 1 && r.variants[0].text === 'Texte corrigé.', 'repli JSON toujours accepté', r);

r = parse('```json\n{"variants":[{"label":"R","text":"Corrigé."}]}\n```', true);
ok(r && r.variants.length === 1, 'JSON entre balises de code accepté', r);

ok(parse('', true) === null, 'réponse vide → rejet propre');
ok(parse('   \n  ', true) === null, 'réponse blanche → rejet propre');

/* ── RÉÉCRITURE (3 variantes) : comportement INCHANGÉ ──────────── */
console.log('\nRéécriture — les 3 variantes, garde-fous intacts');

r = parse('Ton formel\nTexte 1.\n---\nTon chaleureux\nTexte 2.\n---\nTon concis\nTexte 3.');
ok(r && r.variants.length === 3, 'trois blocs séparés → trois variantes', r && r.variants.length);
// Le préfixe « Ton » est retiré du label (comportement d'origine) : « Ton
// chaleureux » → « chaleureux ». C'est voulu, l'étiquette n'a pas à bégayer.
ok(r && r.variants[1].label === 'chaleureux', 'chaque label est repris, sans son préfixe « Ton »', r && r.variants[1].label);

ok(parse('Une réponse sans le moindre séparateur.') === null,
   'SANS séparateur → toujours REJETÉ (c\'est ce rejet qui déclenche le réessai)');

r = parse('{"variants":[{"label":"A","text":"1"},{"label":"B","text":"2"},{"label":"C","text":"3"}]}');
ok(r && r.variants.length === 3, 'repli JSON à trois variantes intact', r && r.variants.length);

r = parse('T1\nA.\n---\nT2\nB.\n---\nT3\nC.\n---\nT4\nD.');
ok(r && r.variants.length === 3, 'jamais plus de trois, même si le modèle insiste', r && r.variants.length);

console.log(`\n${pass + fail} tests — ${fail === 0 ? `\x1b[32m${pass} ok\x1b[0m` : `\x1b[31m${fail} ko\x1b[0m, ${pass} ok`}\n`);
process.exit(fail === 0 ? 0 : 1);
