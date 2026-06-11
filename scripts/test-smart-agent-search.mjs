/* ═══════════════════════════════════════════════════════════════
   Tests node — Smart Agent SA-2 (fonctions pures du moteur Kortex)
   Lancement : node scripts/test-smart-agent-search.mjs
   Couvre : ftsMatchQuery (sanitisation FTS5), rrfFuse (fusion hybride),
   validateUnit (contrat des gabarits), parseProposals (parse IA tolérant).
   ═══════════════════════════════════════════════════════════════ */

import { ftsMatchQuery, rrfFuse, validateUnit, parseProposals,
  normQuestion, extractCitations, validateAgentPayload, isGrounded,
  buildChatMessages, stripCitations, contextualQuery,
  resolveVaultIds, mergeVectorMatches,
  lastAgentQuestion, isAffirmation, validateFolderName, validateVaultName,
  validatePublicSlug, publicAgentMeta, validatePublicLinkPatch, goldenVerdict, parseQuestions,
  splitGapReply, pickFallback,
  validateImportUrl, htmlToText, clampExtractText, importFileKindOf, stripRepeatedFollowup,
  gapMergeTarget, attachGapCounts }
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
    config: { identity: { mission: 'Renseigner les visiteurs' } } });
  check('agent valide : mission', ok.ok && ok.config.identity.mission === 'Renseigner les visiteurs');
  check('fallback par défaut injecté', ok.ok && ok.config.scope.fallback_text.length > 0);
  check('nom vide refusé', validateAgentPayload({ name: '  ', config: {} }).ok === false);
  check('mission requise (création) refusée si absente', validateAgentPayload({ name: 'X', config: {} }).ok === false);
  check('partiel : mission non exigée', validateAgentPayload({ config: {} }, { partial: true }).ok === true);
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
  // SA-8.0 — la relance proactive est DOSÉE (l'ancien « TOUJOURS » créait un tic).
  check('proactif → mène l\'échange, relances variées et dosées',
    /proposition concrète/.test(sysOf('proactif')) && /Varie tes relances/.test(sysOf('proactif')));
  check('informatif → sobre, question seulement si indispensable', /indispensable pour lever une ambig/.test(sysOf('informatif')));
  check('equilibre par défaut (posture inconnue ou absente)',
    sysOf('zzz') === sysOf('equilibre') && sysOf(undefined) === sysOf('equilibre'));
  check('toute posture garde l\'ancrage (faits issus des fiches)',
    ['informatif', 'equilibre', 'proactif'].every(p => /UNIQUEMENT à la DERNIÈRE question/.test(sysOf(p))));
}

console.log('── SA-8.0 — persona (rôle, style, interdits, objectif) ──');
{
  const base = { agentName: 'Léa', mission: 'vendre du thé', tone: 'chaleureux',
    fallbackText: 'X', fiches: '[1] f', message: 'q', history: [] };
  const sys = o => buildChatMessages({ ...base, ...o })[0].content;
  check('rôle injecté à côté du nom',
    sys({ role: 'conseillère de vente' }).includes('« Léa », conseillère de vente'));
  check('sans rôle : pas de virgule orpheline',
    sys({}).includes('« Léa ». Tu t\'exprimes'));
  check('style injecté', sys({ style: 'Phrases courtes, bénéfice avant caractéristique.' })
    .includes('STYLE — ta manière de parler : Phrases courtes'));
  check('interdits injectés', sys({ avoid: 'jargon, tutoiement' }).includes('À ÉVITER ABSOLUMENT : jargon, tutoiement'));
  check('style/avoid absents → lignes absentes (prompt compact)',
    !sys({}).includes('STYLE —') && !sys({}).includes('À ÉVITER'));
  check('objectif vendre → règle de conversion, ancrée',
    sys({ objective: 'vendre' }).includes('OBJECTIF : convertir') && sys({ objective: 'vendre' }).includes('n\'invente JAMAIS'));
  check('objectif conseiller → recommande', sys({ objective: 'conseiller' }).includes('OBJECTIF : conseiller'));
  check('objectif informer (défaut) → aucune ligne OBJECTIF',
    !sys({}).includes('OBJECTIF :') && !sys({ objective: 'zzz' }).includes('OBJECTIF :'));
}

console.log('── SA-8.0 — canal public (zéro mention des fiches) ──');
{
  const base = { agentName: 'A', mission: 'm', tone: 't', fallbackText: 'X',
    fiches: '[1] f', message: 'q', history: [] };
  const internal = buildChatMessages({ ...base })[0].content;
  const pub      = buildChatMessages({ ...base, channel: 'public' })[0].content;
  check('interne → citations [n] exigées', internal.includes('Cite chaque fiche utilisée entre crochets'));
  check('public → interdiction de mentionner fiches/sources',
    pub.includes('Ne mentionne JAMAIS tes fiches') && !pub.includes('Cite chaque fiche'));
  check('le marqueur [GAP] remplace le repli mot à mot (les 2 canaux)',
    internal.includes('le marqueur exact [GAP]') && pub.includes('le marqueur exact [GAP]') &&
    !internal.includes('EXACTEMENT'));
  check('le repli configuré reste l\'« esprit » du repli', internal.includes('esprit : « X »'));
}

console.log('── SA-8.0 — splitGapReply (détection du repli par marqueur) ──');
{
  const r1 = splitGapReply('[GAP] Bonne question — je n\'ai pas ce détail, mais je peux vous guider.', 'Je ne sais pas.');
  check('marqueur en tête → gapped + marqueur retiré',
    r1.gapped === true && r1.text === 'Bonne question — je n\'ai pas ce détail, mais je peux vous guider.');
  check('casse/espaces tolérés', splitGapReply('[ gap ] Désolé.').gapped === true
    && splitGapReply('[ gap ] Désolé.').text === 'Désolé.');
  check('marqueur en plein milieu → détecté et nettoyé',
    splitGapReply('Hmm. [GAP] Je vérifie en boutique.').text === 'Hmm. Je vérifie en boutique.');
  check('legacy : recopie du repli configuré → gapped',
    splitGapReply('Je ne sais pas. Désolé.', 'Je ne sais pas.').gapped === true);
  check('réponse normale → pas gapped, texte intact',
    splitGapReply('Le musée ferme à 18h [1].', 'Je ne sais pas.').gapped === false
    && splitGapReply('Le musée ferme à 18h [1].').text === 'Le musée ferme à 18h [1].');
}

console.log('── SA-8.0 — pickFallback (repli varié sans génération) ──');
{
  const scope = { fallback_text: 'A', fallback_variants: ['B', 'C'] };
  check('rand=0 → la phrase principale', pickFallback(scope, () => 0) === 'A');
  check('rand→variantes', pickFallback(scope, () => 0.5) === 'B' && pickFallback(scope, () => 0.99) === 'C');
  check('sans variantes → la phrase principale seule', pickFallback({ fallback_text: 'A' }, () => 0.9) === 'A');
  check('scope vide → repli par défaut', pickFallback({}, () => 0.5) === 'Je ne dispose pas de cette information.');
  check('variantes vides filtrées', pickFallback({ fallback_text: 'A', fallback_variants: ['', '  '] }, () => 0.9) === 'A');
}

console.log('── SA-8.0 — validateAgentPayload (persona + variantes) ──');
{
  const v = validateAgentPayload({ name: 'X', config: { identity: {
    mission: 'm', role: 'concierge', style: 's'.repeat(600), avoid: 'a', objective: 'vendre' },
    scope: { fallback_text: 'F', fallback_variants: ['v1', '', 'v2', 'v3', 'v4', 'v5'] } } });
  check('persona acceptée (role/avoid/objective)', v.ok && v.config.identity.role === 'concierge'
    && v.config.identity.avoid === 'a' && v.config.identity.objective === 'vendre');
  check('style borné à 500', v.config.identity.style.length === 500);
  check('variantes : vides filtrées, cap à 4', JSON.stringify(v.config.scope.fallback_variants) === JSON.stringify(['v1', 'v2', 'v3', 'v4']));
  const d = validateAgentPayload({ name: 'X', config: { identity: { mission: 'm', objective: 'zzz' } } });
  check('objectif inconnu → informer ; persona/variantes par défaut',
    d.config.identity.objective === 'informer' && d.config.identity.role === ''
    && JSON.stringify(d.config.scope.fallback_variants) === '[]');
}

console.log('── SA-8.5 — stripRepeatedFollowup (anti-radotage des relances) ──');
{
  const hist = [
    { role: 'user',      content: 'Quels sont vos horaires ?' },
    { role: 'assistant', content: 'Nous ouvrons de 9h à 18h [1]. Souhaitez-vous connaître les tarifs ?' },
    { role: 'user',      content: 'Et le dimanche ?' },
  ];
  check('relance identique déjà posée → coupée',
    stripRepeatedFollowup('Le dimanche, nous sommes fermés [2]. Souhaitez-vous connaître les tarifs ?', hist)
      === 'Le dimanche, nous sommes fermés [2].');
  check('relance reformulée (mêmes mots-clés) → coupée',
    stripRepeatedFollowup('Le dimanche, nous sommes fermés [2]. Voulez-vous connaître nos tarifs ?', hist)
      === 'Le dimanche, nous sommes fermés [2].');
  check('relance NOUVELLE → conservée',
    stripRepeatedFollowup('Fermé le dimanche [2]. Puis-je vous renseigner sur le parcours de visite ?', hist)
      .endsWith('parcours de visite ?'));
  check('réponse sans question finale → intacte',
    stripRepeatedFollowup('Le dimanche, nous sommes fermés [2].', hist) === 'Le dimanche, nous sommes fermés [2].');
  check('réponse qui N\'EST QUE la question → conservée (jamais de réponse vide)',
    stripRepeatedFollowup('Souhaitez-vous connaître les tarifs ?', hist) === 'Souhaitez-vous connaître les tarifs ?');
  check('historique vide → no-op',
    stripRepeatedFollowup('Bonjour [1]. Souhaitez-vous connaître les tarifs ?', []).endsWith('tarifs ?'));
  check('questions de l\'UTILISATEUR ignorées (seul l\'agent compte)',
    stripRepeatedFollowup('Oui, ouvert le samedi [1]. Quels sont vos horaires préférés de visite ?',
      [{ role: 'user', content: 'Quels sont vos horaires préférés de visite ?' }])
      .endsWith('visite ?'));
}

console.log('── SA-8.4 — splitSentences (lecture phrase par phrase) ──');
{
  const { splitSentences } = await import('../app/lib/piper-tts.js');
  const s = splitSentences('Bonjour et bienvenue au Musée Copte du Caire. Le musée ouvre à 9h00 du lundi au samedi ! Souhaitez-vous connaître les tarifs ?');
  check('découpe en phrases', s.length === 3 && s[0].endsWith('Caire.') && s[2].endsWith('?'));
  check('fragments courts regroupés (pas de diction hachée)',
    splitSentences('Oui. Bien sûr. Le musée est ouvert le dimanche de 10h à 18h sans interruption.').length === 1);
  check('texte sans ponctuation → 1 phrase', splitSentences('bonjour tout le monde').length === 1);
  check('vide → []', splitSentences('').length === 0 && splitSentences(null).length === 0);
  check('guillemets fermants conservés', splitSentences('Il a dit « bonjour ». Puis il est parti vers la sortie du musée.')[0].includes('»'));
}

console.log('── SA-8.0 — publicAgentMeta expose le rôle ──');
check('role exposé au visiteur', publicAgentMeta({ name: 'L', config: { identity: { role: ' guide ' } } }).role === 'guide');
check('role absent → \'\'', publicAgentMeta({ name: 'L', config: { identity: {} } }).role === '');

console.log('── SA-8.1 — validateImportUrl (import de page web) ──');
check('https accepté', validateImportUrl('https://exemple.fr/tarifs').ok === true);
check('http accepté', validateImportUrl('http://exemple.fr').ok === true);
check('schéma implicite → https ajouté', validateImportUrl('exemple.fr/menu').url === 'https://exemple.fr/menu');
check('ftp refusé', validateImportUrl('ftp://exemple.fr').ok === false);
check('javascript: refusé', validateImportUrl('javascript:alert(1)').ok === false);
check('credentials refusés', validateImportUrl('https://admin:pass@exemple.fr').ok === false);
check('IP littérale refusée', validateImportUrl('https://192.168.1.10/x').ok === false);
check('localhost refusé', validateImportUrl('http://localhost:8080').ok === false);
check('hôte sans point refusé', validateImportUrl('https://intranet/page').ok === false);
check('vide / trop long refusés',
  validateImportUrl('').ok === false && validateImportUrl('https://e.fr/' + 'a'.repeat(2050)).ok === false);

console.log('── SA-8.1 — htmlToText (repli maison sans toMarkdown) ──');
{
  const html = `<html><head><title>T</title><style>.x{color:red}</style></head>
    <body><script>alert(1)</script><h1>Nos tarifs</h1><p>Adulte&nbsp;: 12&amp;euro;</p>
    <ul><li>Lundi</li><li>Mardi</li></ul><!-- caché --></body></html>`;
  const t = htmlToText(html);
  check('scripts/styles/commentaires retirés', !t.includes('alert') && !t.includes('color:red') && !t.includes('caché'));
  check('contenu lisible conservé', t.includes('Nos tarifs') && t.includes('Adulte'));
  check('listes → lignes à puce', t.includes('- Lundi') && t.includes('- Mardi'));
  check('entités décodées', htmlToText('A &amp; B &#233;t&eacute;'.replace('&eacute;', '&#233;')).includes('A & B'));
  check('vide → \'\'', htmlToText('') === '');
}

console.log('── SA-8.1 — clampExtractText (borne d\'extraction) ──');
{
  const short = clampExtractText('Bonjour.', 100);
  check('court → intact, non tronqué', short.text === 'Bonjour.' && short.truncated === false);
  const long = clampExtractText(('Phrase utile. '.repeat(40)).trim(), 100);
  check('long → tronqué sous la borne, à la frontière de phrase',
    long.truncated === true && long.text.length <= 100 && long.text.endsWith('.'));
  const noBreak = clampExtractText('a'.repeat(500), 100);
  check('sans frontière → coupe dure à la borne', noBreak.truncated === true && noBreak.text.length === 100);
}

console.log('── SA-8.1 — importFileKindOf (whitelist fichiers) ──');
check('pdf → binaire', importFileKindOf('Carte 2026.PDF').kind === 'binary');
check('docx/xlsx/csv → binaire', ['a.docx', 'b.xlsx', 'c.csv'].every(n => importFileKindOf(n).kind === 'binary'));
check('txt/md → texte', importFileKindOf('notes.txt').kind === 'text' && importFileKindOf('doc.md').kind === 'text');
check('image refusée (coût IA récurrent)', importFileKindOf('photo.jpeg').ok === false && importFileKindOf('logo.png').ok === false);
check('extension inconnue / absente refusée', importFileKindOf('app.exe').ok === false && importFileKindOf('sansext').ok === false);

console.log('── SA-8.2 — gapMergeTarget (dédup sémantique des trous) ──');
check('meilleur match ≥ seuil → id D1 (préfixe gap: retiré)',
  gapMergeTarget([{ id: 'gap:abc', score: 0.91 }, { id: 'gap:def', score: 0.86 }]) === 'abc');
check('meilleur match sous le seuil → null (nouveau trou)',
  gapMergeTarget([{ id: 'gap:abc', score: 0.84 }]) === null);
check('seuil par défaut 0.85 inclus', gapMergeTarget([{ id: 'gap:x', score: 0.85 }]) === 'x');
check('tri par score (pas l\'ordre du tableau)',
  gapMergeTarget([{ id: 'gap:bas', score: 0.86 }, { id: 'gap:haut', score: 0.97 }]) === 'haut');
check('matches vides / malformés → null',
  gapMergeTarget([]) === null && gapMergeTarget(null) === null
  && gapMergeTarget([{ id: 7, score: 0.99 }, { id: 'gap:y' }]) === null);

console.log('── SA-8.2 — attachGapCounts (digest de la liste d\'agents) ──');
{
  const agents = [{ id: 'a1', name: 'A' }, { id: 'a2', name: 'B' }];
  const rows = [{ agent_id: 'a1', open_n: 5, week_n: 2 }];
  const out = attachGapCounts(agents, rows);
  check('compteurs rattachés au bon agent', out[0].gaps_open === 5 && out[0].gaps_week === 2);
  check('agent sans trou → 0/0', out[1].gaps_open === 0 && out[1].gaps_week === 0);
  check('champs d\'origine préservés', out[0].name === 'A' && out[1].id === 'a2');
  check('rows null → tous à zéro', attachGapCounts(agents, null).every(a => a.gaps_open === 0));
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

console.log('── lastAgentQuestion + isAffirmation (fix « oui » répété) ──');
{
  const hist = [
    { role: 'user',      content: 'horaires ?' },
    { role: 'assistant', content: 'Ouvert de 10h à 18h [1]. Souhaitez-vous connaître les tarifs d\'entrée ?' },
  ];
  check('extrait la dernière question de l\'agent (sans [n])',
    lastAgentQuestion(hist) === 'Souhaitez-vous connaître les tarifs d\'entrée ?');
  check('agent sans question → ""',
    lastAgentQuestion([{ role: 'assistant', content: 'Voici les tarifs.' }]) === '');
  check('historique vide → ""', lastAgentQuestion([]) === '');

  check('« oui » → affirmation', isAffirmation('oui') === true);
  check('« Oui ! » (casse + ponctuation) → affirmation', isAffirmation('Oui !') === true);
  check('« d\'accord » → affirmation', isAffirmation('d\'accord') === true);
  check('« oui merci » → affirmation', isAffirmation('oui merci') === true);
  check('« oui, pour 4 personnes » → affirmation (confirme + précise)',
    isAffirmation('oui, pour 4 personnes') === true);
  check('vraie question courte → PAS une affirmation', isAffirmation('quels horaires ?') === false);
  check('phrase longue → PAS une affirmation',
    isAffirmation('peux-tu me donner les tarifs réduits stp') === false);
  check('vide → PAS une affirmation', isAffirmation('   ') === false);
}

console.log('── validateFolderName (SA-4.4.1 — dossiers d\'agents) ──');
{
  const ok = validateFolderName('  Musée de Lille  ');
  check('nom valide trimmé', ok.ok && ok.name === 'Musée de Lille');
  check('nom vide refusé', validateFolderName('   ').ok === false);
  check('non-string refusé', validateFolderName(null).ok === false);
  check('nom trop long (81) refusé', validateFolderName('x'.repeat(81)).ok === false);
  check('80 caractères acceptés', validateFolderName('x'.repeat(80)).ok === true);
}

console.log('── validateVaultName (SA-4.4.2 — coffre partagé) ──');
{
  check('nom vide → défaut « Coffre partagé »',
    validateVaultName('').ok && validateVaultName('').name === 'Coffre partagé');
  check('non-string → défaut', validateVaultName(null).name === 'Coffre partagé');
  check('nom fourni trimmé', validateVaultName('  Infos pratiques  ').name === 'Infos pratiques');
  check('nom trop long (81) refusé', validateVaultName('x'.repeat(81)).ok === false);
}

console.log('── validatePublicSlug (SA-5 — lien public) ──');
{
  check('slug 8 alphanum accepté', validatePublicSlug('Ab3xK9mP') === 'Ab3xK9mP');
  check('trim avant validation', validatePublicSlug('  Ab3xK9mP  ') === 'Ab3xK9mP');
  check('trop court refusé', validatePublicSlug('Ab3') === null);
  check('trop long refusé', validatePublicSlug('Ab3xK9mPq') === null);
  check('caractère non-alphanum refusé (anti-injection)', validatePublicSlug('Ab3-K9mP') === null);
  check('vide / non-string → null', validatePublicSlug('') === null && validatePublicSlug(null) === null);
}

console.log('── publicAgentMeta (SA-5 — config publique strippée) ──');
{
  const meta = publicAgentMeta({
    name: 'Guide du Musée', tenant_id: 'SECRET_HMAC',
    config: { identity: { mission: 'INTERNE — ne pas exposer', opening: '  Bonjour !  ', tone: 'chaleureux' },
              knowledge: {} },
  });
  check('expose name', meta.name === 'Guide du Musée');
  check('expose opening (trimmé)', meta.opening === 'Bonjour !');
  check('expose tone', meta.tone === 'chaleureux');
  check('n\'expose NI tenant NI mission NI coffre (liste blanche : name/opening/tone/role)',
    meta.tenant_id === undefined && meta.mission === undefined &&
    meta.config === undefined && Object.keys(meta).sort().join(',') === 'name,opening,role,tone');
  check('agent sans nom → « Assistant »', publicAgentMeta({ config: {} }).name === 'Assistant');
  check('opening absent → ""', publicAgentMeta({ name: 'X', config: { identity: {} } }).opening === '');
}

console.log('── validatePublicLinkPatch (SA-5.2 — réglages du lien) ──');
{
  check('plafond valide', validatePublicLinkPatch({ max_per_day: 200 }).max_per_day === 200);
  check('plafond string numérique accepté', validatePublicLinkPatch({ max_per_day: '300' }).max_per_day === 300);
  check('plafond 0 refusé', validatePublicLinkPatch({ max_per_day: 0 }).ok === false);
  check('plafond hors borne refusé', validatePublicLinkPatch({ max_per_day: 999999 }).ok === false);
  check('date valide conservée', validatePublicLinkPatch({ expires_at: '2026-12-31' }).expires_at === '2026-12-31');
  check('date vide → null (retire l\'échéance)', validatePublicLinkPatch({ expires_at: '' }).expires_at === null);
  check('date null → null', validatePublicLinkPatch({ expires_at: null }).expires_at === null);
  check('date mal formée refusée', validatePublicLinkPatch({ expires_at: '31/12/2026' }).ok === false);
  check('patch vide → ok sans champ',
    (() => { const r = validatePublicLinkPatch({}); return r.ok && r.max_per_day === undefined && r.expires_at === undefined; })());
}

console.log('── goldenVerdict (SA-5.3 — replay fidèle des « doit ignorer ») ──');
{
  check('answer ancré → ok', goldenVerdict('answer', true, null).ok === true);
  check('answer non ancré → ko (savoir manquant)', goldenVerdict('answer', false, null).ok === false);
  check('fallback non ancré → ok (se tait, gratuit)', goldenVerdict('fallback', false, null).ok === true);
  check('fallback ancré + 0 citation → ok (repli réel)', goldenVerdict('fallback', true, 0).ok === true);
  check('fallback ancré + citations → ko (débordement réel)', goldenVerdict('fallback', true, 2).ok === false);
  check('fallback ancré + pas d\'IA (cap) → ko prudent', goldenVerdict('fallback', true, null).ok === false);
  check('predicted cohérent (fallback repli)', goldenVerdict('fallback', true, 0).predicted === 'fallback');
  check('predicted cohérent (fallback débordement)', goldenVerdict('fallback', true, 3).predicted === 'answer');
}

console.log('── parseQuestions (SA-6.1 — interview libre) ──');
{
  check('tableau JSON de questions', JSON.stringify(parseQuestions('["Quels horaires ?", "Quels tarifs ?"]')) === JSON.stringify(['Quels horaires ?', 'Quels tarifs ?']));
  check('fences ```json tolérées', parseQuestions('```json\n["Une question valide ?"]\n```').length === 1);
  check('texte autour toléré', parseQuestions('Voici : ["Question assez longue ?"] merci').length === 1);
  check('questions trop courtes écartées', parseQuestions('["ok", "Question valable ici ?"]').length === 1);
  check('non-string écarté', parseQuestions('["Bonne question ?", 42, null]').length === 1);
  check('plafonné à 8', parseQuestions(JSON.stringify(Array.from({ length: 12 }, (_, i) => `Question numéro ${i} ?`))).length === 8);
  check('JSON cassé → []', JSON.stringify(parseQuestions('pas du json')) === '[]');
  check('vide → []', JSON.stringify(parseQuestions('')) === '[]');
}

console.log(`\n${passed}/${passed + failed} tests OK${failed ? ` — ${failed} ÉCHEC(S)` : ''}`);
process.exit(failed ? 1 : 0);
