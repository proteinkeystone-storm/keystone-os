/* ═══════════════════════════════════════════════════════════════
   Tests node — Smart Agent SA-2 (fonctions pures du moteur Kortex)
   Lancement : node scripts/test-smart-agent-search.mjs
   Couvre : ftsMatchQuery (sanitisation FTS5), rrfFuse (fusion hybride),
   validateUnit (contrat des gabarits), parseProposals (parse IA tolérant).
   ═══════════════════════════════════════════════════════════════ */

import { ftsMatchQuery, rrfFuse, validateUnit, parseProposals,
  normQuestion, extractCitations, validateAgentPayload, isGrounded,
  buildChatMessages, stripCitations, contextualQuery,
  resolveVaultIds, mergeVectorMatches }
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

console.log('── isGrounded (décision chat + replay golden) ──');
check('aucune fiche → non ancré (repli)',
  isGrounded({ semantic: true, hits: [] }).grounded === false);
check('accroche lexicale → ancré même sans vecteur',
  isGrounded({ semantic: true, hits: [{ lexRank: 1, vecScore: 0 }] }).grounded === true);
check('similarité ≥ seuil → ancré',
  isGrounded({ semantic: true, hits: [{ vecScore: 0.55 }] }).grounded === true);
check('similarité faible sans lexical → non ancré',
  isGrounded({ semantic: true, hits: [{ vecScore: 0.20 }] }).grounded === false);
check('mode lexical seul (pas de sémantique) → ancré dès qu\'il y a une fiche',
  isGrounded({ semantic: false, hits: [{ lexRank: 1 }] }).grounded === true);
check('grounding chiffré renvoyé',
  isGrounded({ semantic: true, hits: [{ vecScore: 0.73 }] }).grounding === 0.73);

console.log('── stripCitations ──');
check('retire les [n] et compacte', stripCitations('Oui [1] et aussi [12].') === 'Oui et aussi.');
check('texte sans citation inchangé', stripCitations('Bonjour.') === 'Bonjour.');

console.log('── buildChatMessages (anti-répétition du bug SA-3) ──');
{
  const history = [
    { role: 'user',      content: 'À quelle heure fermez-vous ?' },
    { role: 'assistant', content: 'Nous fermons à 18h [1].' },
  ];
  const msgs = buildChatMessages({
    agentName: 'Guide', mission: 'Renseigner', tone: 'chaleureux',
    fallbackText: 'Je ne sais pas.',
    fiches: '[1] (fact) Tarifs\nÉtudiant : 8 €',
    history, message: 'Et le tarif étudiant ?',
  });
  const sys = msgs[0];
  check('system STABLE : aucun CONTENU de fiche (les fiches ne sont pas dans le system)',
    sys.role === 'system' && !sys.content.includes('FICHES DE SAVOIR') && !sys.content.includes('Tarifs') && !sys.content.includes('8 €'));
  check('historique nettoyé de ses [n] périmés',
    msgs[1].content === 'À quelle heure fermez-vous ?' && msgs[2].content === 'Nous fermons à 18h.');
  check('fiches + question UNIQUEMENT dans le dernier message',
    msgs[3].role === 'user' && msgs[3].content.includes('[1] (fact) Tarifs') && msgs[3].content.includes('QUESTION : Et le tarif étudiant ?'));
  check('AUCUN message d\'historique ne contient un bloc fiches',
    msgs.slice(0, 3).every(m => !m.content.includes('FICHES DE SAVOIR')));
  check('le repli exact est injecté dans les règles',
    sys.content.includes('« Je ne sais pas. »'));
}

console.log('── buildChatMessages — posture (SA-4.2) ──');
{
  const base = { agentName: 'A', mission: 'm', tone: 't', fallbackText: 'X', fiches: '[1] f', message: 'q', history: [] };
  const sysOf = p => buildChatMessages({ ...base, posture: p })[0].content;
  check('proactif → relance TOUJOURS', /TOUJOURS une question/.test(sysOf('proactif')));
  check('informatif → sobre, question seulement si indispensable', /indispensable pour lever une ambig/.test(sysOf('informatif')));
  check('equilibre par défaut (posture inconnue ou absente)',
    sysOf('zzz') === sysOf('equilibre') && sysOf(undefined) === sysOf('equilibre'));
  check('toute posture garde l\'ancrage (faits issus des fiches)',
    ['informatif', 'equilibre', 'proactif'].every(p => /UNIQUEMENT à la DERNIÈRE question/.test(sysOf(p))));
}

console.log('── contextualQuery (suivi « oui » — bug capture Stéphane) ──');
{
  const hist = [
    { role: 'user', content: 'horaires ?' },
    { role: 'assistant', content: 'Ouvert de 10h à 18h [1]. Souhaitez-vous connaître les tarifs ?' },
  ];
  check('préfixe la question de l\'agent au « oui » de l\'utilisateur',
    contextualQuery('oui pour 4 personnes', hist) === 'Souhaitez-vous connaître les tarifs ? oui pour 4 personnes');
  check('cite [n] ignorée dans l\'extraction de la question',
    !contextualQuery('oui', hist).includes('[1]'));
  check('sans historique → message brut',
    contextualQuery('bonjour', []) === 'bonjour');
  check('dernier tour agent sans question → message brut',
    contextualQuery('oui', [{ role: 'assistant', content: 'Voici les tarifs.' }]) === 'oui');
  check('prend la DERNIÈRE question si plusieurs',
    contextualQuery('oui', [{ role: 'assistant', content: 'Quoi ? Plutôt les activités ?' }]) === 'Plutôt les activités ? oui');
}

console.log('── resolveVaultIds (SA-4.4 — coffres lus par un agent) ──');
{
  check('agent sans coffre privé → []',
    JSON.stringify(resolveVaultIds({}, [])) === '[]');
  check('coffre privé seul (pas de dossier) → [privé]',
    JSON.stringify(resolveVaultIds({ private_vault_id: 'v1' }, [])) === JSON.stringify(['v1']));
  check('privé + 2 partagés → 3 ids dans l\'ordre',
    JSON.stringify(resolveVaultIds({ private_vault_id: 'v1' }, [{ id: 'v2' }, { id: 'v3' }])) === JSON.stringify(['v1', 'v2', 'v3']));
  check('partagés en ids bruts (string) tolérés',
    JSON.stringify(resolveVaultIds({ private_vault_id: 'v1' }, ['v2'])) === JSON.stringify(['v1', 'v2']));
  check('doublon privé ≡ partagé dédupliqué',
    JSON.stringify(resolveVaultIds({ private_vault_id: 'v1' }, [{ id: 'v1' }, { id: 'v2' }])) === JSON.stringify(['v1', 'v2']));
  check('NULL / vides écartés',
    JSON.stringify(resolveVaultIds({ private_vault_id: 'v1' }, [{ id: null }, {}, 'v2'])) === JSON.stringify(['v1', 'v2']));
  check('plafond respecté (cap=2)',
    resolveVaultIds({ private_vault_id: 'v1' }, [{ id: 'v2' }, { id: 'v3' }], 2).length === 2);
}

console.log('── mergeVectorMatches (SA-4.4 — fusion multi-coffres par score global) ──');
{
  const a = [{ id: 'x', score: 0.9 }, { id: 'y', score: 0.4 }];
  const b = [{ id: 'z', score: 0.7 }, { id: 'x', score: 0.5 }];
  const m = mergeVectorMatches([a, b], 10);
  check('ordonné par score cosinus global décroissant',
    JSON.stringify(m.ids) === JSON.stringify(['x', 'z', 'y']));
  check('meilleur score conservé si id dans 2 coffres (0.9 > 0.5)',
    m.scores.get('x') === 0.9);
  check('topk respecté', mergeVectorMatches([a, b], 2).ids.length === 2);
  check('listes vides → aucun id', mergeVectorMatches([[], []]).ids.length === 0);
  check('entrées sans id ignorées',
    mergeVectorMatches([[{ score: 0.5 }, { id: 'q', score: 0.3 }]]).ids.join() === 'q');
}

console.log(`\n${passed}/${passed + failed} tests OK${failed ? ` — ${failed} ÉCHEC(S)` : ''}`);
process.exit(failed ? 1 : 0);
