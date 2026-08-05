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

import { gwParseVariants as parse, gwRecollerParagraphes as recoller } from '../workers/src/routes/ghostwriter.js';

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

/* ── DK-9 · la mise en paragraphes d'un article ─────────────────
   Trouvé le 2026-08-05 en MESURANT la relecture sur de vrais textes
   (scripts/mesure-relecture.mjs) : les six paragraphes revenaient
   collés, 5 lignes vides sur 5 perdues, sur trois textes sur trois.
   Ce n'était pas le modèle — c'était `.filter(Boolean)` ici même.
   Invisible dans le modal : le comparatif mot à mot neutralise les
   blancs. La rédactrice reprenait son article en un seul bloc. */
console.log('\nRelecture — les paragraphes d\'un article survivent');

const ARTICLE = 'Relecture\n'
  + 'Premier paragraphe de la copie, avec sa chute.\n'
  + '\n'
  + 'Deuxième paragraphe, celui du milieu.\n'
  + '\n'
  + 'Troisième et dernier paragraphe.';
r = parse(ARTICLE, true);
ok(r && r.variants[0].text.split('\n\n').length === 3,
   'les trois paragraphes restent trois paragraphes', r && JSON.stringify(r.variants[0].text));
ok(r && !/\n\n\n/.test(r.variants[0].text),
   'et pas de trou béant entre eux (jamais plus d\'une ligne vide)', r && JSON.stringify(r.variants[0].text));
ok(r && r.variants[0].text.startsWith('Premier') && r.variants[0].text.endsWith('paragraphe.'),
   'ni ligne vide en tête, ni en pied', r && JSON.stringify(r.variants[0].text));

r = parse('Relecture\n\n\n\n\nUn texte précédé d\'un paquet de lignes vides par le modèle.', true);
ok(r && r.variants[0].text === 'Un texte précédé d\'un paquet de lignes vides par le modèle.',
   'les blancs que le modèle ajoute après son label sont ravalés', r && JSON.stringify(r.variants[0].text));

// « Ne RIEN retirer » vaut aussi pour la ponctuation : un article de revue
// se termine très souvent sur une citation.
r = parse('Relecture\nIl m\'a dit ce jour-là : « Tu verras, le plus dur c\'est de transmettre. »', true);
ok(r && r.variants[0].text.endsWith('transmettre. »'),
   'un texte qui se TERMINE sur une citation garde son guillemet fermant', r && r.variants[0].text.slice(-30));
r = parse('Relecture\n« Toute la réponse est enrobée de guillemets par le modèle. »', true);
ok(r && r.variants[0].text === 'Toute la réponse est enrobée de guillemets par le modèle.',
   'mais un enrobage complet est bien retiré', r && r.variants[0].text);

/* ── DK-9 · l'article garde LA DÉCOUPE DE SON AUTEUR ────────────
   Mesuré sur trois vrais papiers de L'Épaulette : le modèle « aère »
   ce qu'on lui donne à relire — 6 paragraphes rendus en 8, 8 rendus
   en 12. Il coupe les longs, jamais il ne fusionne. Resserrer la
   consigne système n'y a rien changé (essayé, mesuré). On remet donc
   la découpe d'aplomb par le calcul — et ça se teste à sec. */
console.log('\nRelecture — la découpe en paragraphes de l\'auteur est rendue');

const nP = t => t.split(/\n\s*\n/).filter(x => x.trim()).length;
const nM = t => t.split(/\s+/).filter(Boolean).length;

// Un paragraphe long que le modèle a coupé en deux.
const SRC2 = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima.\n'
           + '\n'
           + 'Mike november oscar papa quebec romeo sierra tango uniform victor whisky xray yankee zulu.';
const OUT2 = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima.\n'
           + '\n'
           + 'Mike november oscar papa quebec romeo.\n'
           + '\n'
           + 'Sierra tango uniform victor whisky xray yankee zulu.';
let rc = recoller(SRC2, OUT2);
ok(nP(rc) === 2, 'trois blocs rendus par le modèle redeviennent les deux paragraphes de l\'auteur', nP(rc));
ok(nM(rc) === nM(OUT2), 'et aucun mot n\'est perdu au recollage', `${nM(OUT2)} → ${nM(rc)}`);
ok(rc.split(/\n\s*\n/)[0].trim().endsWith('lima.'), 'la première coupure reste là où l\'auteur l\'avait mise', rc.slice(0, 80));

ok(recoller(SRC2, SRC2) === SRC2, 'un texte déjà bien découpé n\'est pas touché');

// Garde-fou 1 : le modèle a FUSIONNÉ (moins de paragraphes). On ne
// recolle pas — on ne sait pas où l'auteur coupait, et bricoler ici
// masquerait une vraie réécriture.
const FUSION = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima. Mike november oscar papa quebec romeo sierra tango uniform victor whisky xray yankee zulu.';
ok(recoller(SRC2, FUSION) === FUSION, 'si le modèle a FUSIONNÉ, on ne touche à rien (on ne devine pas)');

// Garde-fou 2 : le texte a changé de volume → ce n'est plus une
// relecture, c'est autre chose. On rend la copie du modèle telle quelle.
const ENFLE = OUT2 + '\n\nEt puis tout un paragraphe supplémentaire que personne n\'avait demandé, bien plus long que le reste du texte, ajouté de sa propre initiative par le modèle.';
ok(recoller(SRC2, ENFLE) === ENFLE, 'si le volume a trop bougé, on ne recolle pas — on ne maquille pas une réécriture');

// Un texte d'un seul paragraphe n'a pas de découpe à défendre.
ok(recoller('Une seule phrase, un seul paragraphe.', 'Une seule phrase.\n\nUn seul paragraphe.')
   === 'Une seule phrase.\n\nUn seul paragraphe.', 'un texte source d\'UN paragraphe est laissé tel quel');

r = parse('{"variants":[{"label":"A","text":"1"},{"label":"B","text":"2"},{"label":"C","text":"3"}]}');
ok(r && r.variants.length === 3, 'repli JSON à trois variantes intact', r && r.variants.length);

r = parse('T1\nA.\n---\nT2\nB.\n---\nT3\nC.\n---\nT4\nD.');
ok(r && r.variants.length === 3, 'jamais plus de trois, même si le modèle insiste', r && r.variants.length);

console.log(`\n${pass + fail} tests — ${fail === 0 ? `\x1b[32m${pass} ok\x1b[0m` : `\x1b[31m${fail} ko\x1b[0m, ${pass} ok`}\n`);
process.exit(fail === 0 ? 0 : 1);
