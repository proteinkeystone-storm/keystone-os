/* ═══════════════════════════════════════════════════════════════
   Tests node — Smart Agent SA-2 (fonctions pures du moteur Kortex)
   Lancement : node scripts/test-smart-agent-search.mjs
   Couvre : ftsMatchQuery (sanitisation FTS5), rrfFuse (fusion hybride),
   validateUnit (contrat des gabarits), parseProposals (parse IA tolérant).
   ═══════════════════════════════════════════════════════════════ */

import { ftsMatchQuery, rrfFuse, validateUnit, parseProposals,
  normQuestion, extractCitations, validateAgentPayload }
  from '../workers/src/routes/smart-agent.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}`); }
}

console.log('── ftsMatchQuery ──');
check('français + apostrophes → tokens quotés OR',
  ftsMatchQuery("Quels sont les horaires d'ouverture ?") === '"quels" OR "sont" OR "les" OR "horaires" OR "ouverture"');
// NB : « œ » n'a PAS de décomposition NFKD — il reste « œ » à l'indexation
// FTS5 comme à la requête (cohérent des deux côtés = match garanti).
check('accents pliés (NFKD) — désactivée → desactivee ; œ conservé tel quel',
  ftsMatchQuery('œuvre désactivée') === '"œuvre" OR "desactivee"');
check('caractères spéciaux FTS neutralisés (pas d\'injection MATCH)',
  ftsMatchQuery('test* AND "x" NEAR(') === '"test" OR "and" OR "near"');
check('vide / trop court → null',
  ftsMatchQuery('a !') === null && ftsMatchQuery('') === null);
check('cap à 8 tokens',
  (ftsMatchQuery('un deux trois quatre cinq six sept huit neuf dix') || '').split(' OR ').length === 8);

console.log('── rrfFuse ──');
{
  // Présent dans les 2 listes (rangs 2 et 1) > 1er d'une seule liste
  const fused = rrfFuse([['a', 'b', 'c'], ['b', 'd']], 10);
  check('le doublon des deux listes gagne', fused[0].id === 'b');
  check('scores décroissants', fused.every((x, i, arr) => i === 0 || arr[i - 1].score >= x.score));
  check('topk respecté', rrfFuse([['a', 'b', 'c', 'd', 'e']], 3).length === 3);
  check('listes vides → []', rrfFuse([[], []]).length === 0);
  // RRF exact : b = 1/(60+2) + 1/(60+1) ; a = 1/(60+1)
  const expB = 1 / 62 + 1 / 61;
  check('score RRF exact', Math.abs(fused[0].score - expB) < 1e-12);
}

console.log('── validateUnit ──');
{
  const ok = validateUnit('procedure', 'Ouverture salle 7',
    { goal: 'Ouvrir la salle', steps: 'Désactiver l\'alarme\n\nAllumer la lumière\n', warnings: '' });
  check('procedure : steps string → array nettoyé', ok.ok && Array.isArray(ok.body.steps) && ok.body.steps.length === 2);
  check('body_text = titre + champs aplatis',
    ok.ok && ok.bodyText.startsWith('Ouverture salle 7\nOuvrir la salle\nDésactiver'));
  check('champ optionnel vide écarté du body', ok.ok && !('warnings' in ok.body));
  check('type inconnu refusé', validateUnit('recette', 'x', {}).ok === false);
  check('champ requis manquant refusé', validateUnit('qa', 'x', { question: 'q' }).ok === false);
  check('titre vide refusé', validateUnit('fact', '  ', { statement: 's' }).ok === false);
  check('champs inconnus écartés',
    !('hack' in (validateUnit('fact', 't', { statement: 's', hack: 'x' }).body)));
}

console.log('── parseProposals ──');
{
  const raw = '```json\n[{"type":"fact","title":"Horaires","body":{"statement":"9h-18h"}},' +
    '{"type":"invalid","title":"x","body":{}},' +
    '{"type":"qa","title":"Photos","body":{"question":"Flash ?","answer":"Non"}}]\n```';
  const props = parseProposals(raw);
  check('fences retirées + tableau isolé', props.length === 2);
  check('proposition invalide écartée', props.every(p => p.type !== 'invalid'));
  check('JSON cassé → []', parseProposals('pas du json [').length === 0);
  check('texte autour du tableau toléré',
    parseProposals('Voici : [{"type":"fact","title":"T","body":{"statement":"S"}}] Fin.').length === 1);
}

console.log('── normQuestion (dédoublonnage des trous) ──');
check('même question, ponctuation/casse/accents différents → même clé',
  normQuestion('Quels sont les HORAIRES ?') === normQuestion('quels sont les horaires'));
check('accents pliés', normQuestion('horaires d\'été') === 'horaires d ete');
check('vide → ""', normQuestion('  !? ') === '');

console.log('── extractCitations ──');
check('numéros uniques dans l\'ordre, bornés',
  JSON.stringify(extractCitations('D\'après [1] et [3], voir aussi [1].', 5)) === JSON.stringify([1, 3]));
check('hors borne écarté', JSON.stringify(extractCitations('voir [9]', 3)) === '[]');
check('aucune citation → []', JSON.stringify(extractCitations('texte sans source', 4)) === '[]');

console.log('── validateAgentPayload ──');
{
  const ok = validateAgentPayload({ name: 'Guide du musée',
    config: { identity: { mission: 'Renseigner les visiteurs' }, knowledge: { collection_ids: ['c1', 'c2'] } } });
  check('agent valide : mission + collections', ok.ok && ok.config.knowledge.collection_ids.length === 2);
  check('fallback par défaut injecté', ok.ok && ok.config.scope.fallback_text.length > 0);
  check('nom vide refusé', validateAgentPayload({ name: '  ', config: {} }).ok === false);
  check('mission requise (création) refusée si absente', validateAgentPayload({ name: 'X', config: {} }).ok === false);
  check('partiel : mission non exigée', validateAgentPayload({ config: {} }, { partial: true }).ok === true);
  check('collection_ids non-array → []',
    validateAgentPayload({ name: 'X', config: { identity: { mission: 'm' }, knowledge: { collection_ids: 'oops' } } }).config.knowledge.collection_ids.length === 0);
}

console.log(`\n${passed}/${passed + failed} tests OK${failed ? ` — ${failed} ÉCHEC(S)` : ''}`);
process.exit(failed ? 1 : 0);
