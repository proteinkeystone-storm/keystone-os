#!/usr/bin/env node
/* Test : analyse GEO mode manuel (workers/src/lib/geo-analyze.js).
   Pur, sans dépendance Cloudflare → importable sous Node. */
import { detectCitation, geoScore, extractUrls, analyzeManual, sentiment } from '../workers/src/lib/geo-analyze.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (reçu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)})`);

// — detectCitation —
let d = detectCitation('1. Keystone OS\n2. Autre solution', [], 'Keystone OS', 'protein-keystone.com');
ok(d.cited === true, 'cité par nom');
eq(d.rank, 1, 'rang #1 depuis la liste numérotée');

d = detectCitation('1. Foo\n2. Bar\n3. Baz', [], 'Keystone OS', 'protein-keystone.com');
ok(d.cited === false, 'non cité quand absent');
eq(d.rank, null, 'pas de rang si non cité');

d = detectCitation('Le meilleur est sur protein-keystone.com', [], 'ZZZ Introuvable', 'protein-keystone.com');
ok(d.cited === true, 'cité par domaine (host) dans le texte');

d = detectCitation('Voir la source ci-dessous.', [{ uri: 'https://protein-keystone.com/a' }], 'ZZZ', 'protein-keystone.com');
ok(d.sourced === true && d.cited === false, 'sourcé (host dans les sources) sans être nommé');

// rang au-delà de 10 → null (bruit)
const many = Array.from({ length: 12 }, (_, i) => `${i + 1}. Marque${i}`).join('\n') + '\n13. Keystone OS';
ok(detectCitation(many, [], 'Keystone OS', 'x.com').rank === null, 'rang > 10 ramené à null');

// — extractUrls —
eq(extractUrls('a https://x.com/y, et http://z.org.').map((s) => s.uri), ['https://x.com/y', 'http://z.org'], 'extraction URLs + ponctuation finale retirée');
eq(extractUrls('aucune url ici'), [], 'aucune URL');

// — sentiment —
ok(sentiment('Keystone OS est excellent et recommandé', 'Keystone OS') === 'positive', 'sentiment positif');
ok(sentiment('Keystone OS, à éviter, mauvais service', 'Keystone OS') === 'negative', 'sentiment négatif');

// — analyzeManual + geoScore —
let r = analyzeManual([{ prompt: 'Quel logiciel TPE ?', text: '1. Keystone OS — le meilleur' }], { engine: 'gemini', businessName: 'Keystone OS', host: 'protein-keystone.com' });
eq(r.length, 1, 'un résultat par question');
ok(r[0].engines[0].engine === 'gemini', 'moteur conservé');
ok(r[0].engines[0].cited === true && r[0].engines[0].rank === 1, 'cellule manuelle citée #1');
eq(geoScore(r), 100, 'score 100 quand cité #1');

r = analyzeManual([{ prompt: 'Q', text: '1. Autre\n2. Encore une autre' }], { engine: 'gpt', businessName: 'Keystone OS', host: 'protein-keystone.com' });
eq(geoScore(r), 0, 'score 0 quand non cité');

// question sans réponse collée → engines vide, ignorée du score
r = analyzeManual([{ prompt: 'Q1', text: '' }, { prompt: 'Q2', text: 'Keystone OS est super' }], { engine: 'autre', businessName: 'Keystone OS', host: 'x.com' });
eq(r.length, 2, 'les 2 questions présentes');
eq(r[0].engines, [], 'question sans texte → aucune cellule');
ok(geoScore(r) > 0, 'score basé uniquement sur la question répondue');

eq(geoScore([]), null, 'score null si aucune cellule');

console.log(`\n${fail ? '❌' : '✅'} GEO manuel : ${pass} ok, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
