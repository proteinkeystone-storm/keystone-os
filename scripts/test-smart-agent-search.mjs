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
  splitGapReply, pickFallback, groundedFromSignals, sweepGroundThreshold,
  needsRerank, applyRerank, _rerank, clampRelevance, needsExpansion, _expandQuery,
  splitMarkdownBatches, buildBatchPrompt, gapOutcome, salvageJsonObjects,
  validateImportUrl, htmlToText, clampExtractText, importFileKindOf, stripRepeatedFollowup,
  gapMergeTarget, attachGapCounts, sanitizePublicUrl, validateCards,
  detectSocialIntent, pickSocialReply, extractUnitCap, unitWarning, validateImages,
  splitPagesBatches }
  from '../workers/src/routes/smart-agent.js';
// SA-15.4 — fonctions pures du module front (aucune dépendance DOM).
import { photoRefs, plancheAlt } from '../app/sa-planches.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}`); }
}

console.log('── ftsMatchQuery ──');
check('français + apostrophes → tokens quotés OR, stopwords filtrés (fix Gest 2026-07-06)',
  ftsMatchQuery("Quels sont les horaires d'ouverture ?") === '"horaires" OR "ouverture"');
check('le nom du produit en 10e position atteint la requête (cause racine dossier hors-sujet)',
  (ftsMatchQuery("Je voudrai faire un Post pour LinkedIn au sujet de l'application Keystone Keynapse") || '').includes('"keynapse"'));
// NB : « œ » n'a PAS de décomposition NFKD — il reste « œ » à l'indexation
// FTS5 comme à la requête (cohérent des deux côtés = match garanti).
check('accents pliés (NFKD) — désactivée → desactivee ; œ conservé tel quel',
  ftsMatchQuery('œuvre désactivée') === '"œuvre" OR "desactivee"');
check('caractères spéciaux FTS neutralisés (pas d\'injection MATCH)',
  ftsMatchQuery('test* AND "x" NEAR(') === '"test" OR "and" OR "near"');
check('vide / trop court → null',
  ftsMatchQuery('a !') === null && ftsMatchQuery('') === null);
check('cap à 12 tokens (fenêtre élargie), « un » filtré (stopword)',
  (ftsMatchQuery('un deux trois quatre cinq six sept huit neuf dix') || '').split(' OR ').length === 9);
check('requête 100 % stopwords → repli ancien comportement (pas de zéro résultat)',
  ftsMatchQuery('tout pour le tout') === '"tout" OR "pour" OR "le"');

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

console.log('── SA-14.6 — salvageJsonObjects (un lot tronqué n\'est plus perdu) ──');
{
  check('tableau complet → tous les objets',
    salvageJsonObjects('[{"a":1},{"b":2}]').length === 2);
  check('tableau TRONQUÉ en plein objet → les complets sont sauvés',
    salvageJsonObjects('[{"a":1},{"b":2},{"c":').length === 2);
  check('accolade DANS une chaîne ne compte pas (titre « le { du JSON »)',
    JSON.stringify(salvageJsonObjects('[{"t":"le { du JSON"},{"u":2}]')) === '[{"t":"le { du JSON"},{"u":2}]');
  check('guillemet échappé dans une chaîne',
    salvageJsonObjects('[{"t":"il dit \\"bonjour\\""},{"u":1}]').length === 2);
  check('objets imbriqués comptés comme UN objet de premier niveau',
    salvageJsonObjects('[{"body":{"steps":["a","b"]}},{"x":1}]').length === 2);
  check('objet illisible ignoré, les voisins survivent',
    salvageJsonObjects('[{"a":1},{bad},{"b":2}]').length === 2);
  check('rien d\'exploitable → []',
    salvageJsonObjects('').length === 0 && salvageJsonObjects('texte sans objet').length === 0);
}

console.log('── SA-14.6 — parseProposals : plafond 25 + tolérance à la troncature ──');
{
  const fiche = (i) => `{"type":"fact","title":"Fiche ${i}","relevance":5,"body":{"statement":"S${i}"}}`;
  {
    // Génération coupée par max_tokens : plus de « ] » final. Avant SA-14.6,
    // le lot entier était perdu ALORS QUE le crédit avait été débité.
    const tronque = '[' + [1, 2, 3].map(fiche).join(',') + ',{"type":"fact","title":"coupée en pl';
    check('tableau non fermé → les fiches complètes sont récupérées',
      parseProposals(tronque).length === 3);
  }
  check('plafond porté à 25 (était 12)',
    parseProposals('[' + Array.from({ length: 40 }, (_, i) => fiche(i)).join(',') + ']').length === 25);
  check('fences + tableau complet : comportement inchangé',
    parseProposals('```json\n[' + fiche(1) + ']\n```').length === 1);
  check('vrai JSON cassé → [] (on ne fabrique rien)',
    parseProposals('pas du json [').length === 0);
  check('SA-15.1 — plafond passé explicitement (le lot pauvre est borné plus bas)',
    parseProposals('[' + Array.from({ length: 40 }, (_, i) => fiche(i)).join(',') + ']', 7).length === 7);
}

console.log('── SA-15.1 — extractUnitCap : le plafond suit la densité du lot ──');
{
  // Le cas mesuré le 21/07 : 2 619 caractères → 25 fiches rendues, soit une
  // fiche pour 105 caractères, la même unité pédagogique émise 3 à 5 fois
  // sous des gabarits différents. Le plafond doit tomber bien plus bas.
  check('lot pauvre du dogfood (2 619 car.) → 7, très loin des 25',
    extractUnitCap('x'.repeat(2619)) === 7);
  // Le gain de SA-14.6 (36 → 73 fiches sur le même document dense) DOIT
  // survivre : un lot d'ingestion plein fait 12 000 car. → 30 → borné à 25.
  check('lot d\'ingestion plein (12 000 car.) → 25 : le gain SA-14.6 est intact',
    extractUnitCap('x'.repeat(12000)) === 25);
  check('document très dense (30 000 car.) → 25 (plafond absolu, jamais dépassé)',
    extractUnitCap('x'.repeat(30000)) === 25);
  check('1 fiche / 400 caractères', extractUnitCap('x'.repeat(4000)) === 10);
  check('plancher à 3 : un texte court garde droit à ses vraies fiches',
    extractUnitCap('x'.repeat(50)) === 3 && extractUnitCap('x'.repeat(1200)) === 3);
  check('vide / null / espaces → plancher (jamais 0, jamais NaN)',
    extractUnitCap('') === 3 && extractUnitCap(null) === 3 && extractUnitCap('   ') === 3);
  check('les espaces de bord ne comptent pas',
    extractUnitCap('  ' + 'x'.repeat(2619) + '  ') === 7);
  {
    let mono = true, prev = 0;
    for (let n = 0; n <= 30000; n += 137) {
      const c = extractUnitCap('x'.repeat(n));
      if (c < prev) mono = false;
      prev = c;
    }
    check('croissant : plus de texte ne donne jamais droit à moins de fiches', mono);
  }
}

console.log('── SA-15.2 — validateImages : tolérant par doctrine ──');
{
  const K1 = 'sa-cards/agent-1/aaaa-bbbb.webp';
  const K2 = 'sa-cards/agent-1/cccc-dddd.jpg';
  check('liste valide conservée dans l\'ORDRE (le manuel numérote ses photos)',
    JSON.stringify(validateImages([{ key: K2 }, { key: K1 }])) === JSON.stringify([{ key: K2 }, { key: K1 }]));
  check('alt et n conservés', JSON.stringify(validateImages([{ key: K1, alt: ' Garde ', n: 2 }]))
    === JSON.stringify([{ key: K1, alt: 'Garde', n: 2 }]));
  check('champs vides omis (pas de clés nulles qui polluent)',
    JSON.stringify(validateImages([{ key: K1, alt: '  ', n: 0 }])) === JSON.stringify([{ key: K1 }]));
  // Le cœur de la doctrine : une image invalide n'invalide JAMAIS la fiche.
  check('image invalide ÉCARTÉE, les valides survivent (jamais d\'exception)',
    validateImages([{ key: '../../etc/passwd' }, { key: K1 }, null, 'x', { key: K2 }]).length === 2);
  check('traversée de chemin refusée par SA_CARD_KEY_RE',
    validateImages([{ key: 'sa-cards/a/../../secret.jpg' }]).length === 0);
  check('extension non-image refusée',
    validateImages([{ key: 'sa-cards/agent-1/x.svg' }, { key: 'sa-cards/agent-1/x.pdf' }]).length === 0);
  check('doublon de planche écarté (même clé deux fois = sans objet)',
    validateImages([{ key: K1 }, { key: K1 }]).length === 1);
  check('n hors bornes ignoré, entier requis',
    !('n' in validateImages([{ key: K1, n: 1000 }])[0]) && !('n' in validateImages([{ key: K1, n: 1.5 }])[0]));
  check('plafond 12 planches par fiche (une fiche, pas un album)',
    validateImages(Array.from({ length: 30 }, (_, i) => ({ key: `sa-cards/a/img-${i}.webp` }))).length === 12);
  check('non-tableau / vide → [] (fiche sans image = cas nominal)',
    validateImages(null).length === 0 && validateImages('x').length === 0 && validateImages([]).length === 0);
  check('alt tronqué à 300', validateImages([{ key: K1, alt: 'x'.repeat(500) }])[0].alt.length === 300);
}

console.log('── SA-15.3 — splitPagesBatches : une frontière de lot ne coupe pas une page ──');
{
  const pages = (n, len) => Array.from({ length: n }, (_, i) => ({ n: i + 1, text: 'x'.repeat(len) }));
  {
    const b = splitPagesBatches(pages(10, 300), { maxChars: 1000 });
    check('pages groupées, chaque lot déclare ses pages',
      b.length > 1 && b.every(x => Array.isArray(x.pages) && x.pages.length));
    const all = b.flatMap(x => x.pages);
    check('AUCUNE page perdue et aucune dupliquée entre lots',
      all.length === 10 && new Set(all).size === 10 && all.join() === [...all].sort((p, q) => p - q).join());
    check('lots sous le plafond', b.every(x => x.chars <= 1000));
  }
  check('le numéro de page reste DANS le texte (rattachement « - Photo 2 », SA-15.4)',
    splitPagesBatches(pages(1, 50))[0].text.startsWith('## Page 1'));
  check('breadcrumb lisible : page seule vs plage',
    splitPagesBatches(pages(1, 50))[0].breadcrumb === 'Page 1'
    && splitPagesBatches(pages(4, 100), { maxChars: 5000 })[0].breadcrumb === 'Pages 1–4');
  {
    // Page seule plus grosse qu'un lot : plusieurs lots pointent vers elle,
    // sa planche reste proposable sur chacun.
    const b = splitPagesBatches([{ n: 7, text: 'y'.repeat(2500) }], { maxChars: 1000 });
    check('page géante → plusieurs lots, tous rattachés à la page 7',
      b.length > 1 && b.every(x => x.pages.length === 1 && x.pages[0] === 7));
  }
  check('pages vides / numéros invalides écartés sans casser',
    splitPagesBatches([{ n: 1, text: '' }, { n: 0, text: 'a' }, { n: 2, text: 'ok texte' }]).length === 1);
  check('entrée vide → [] (jamais d\'exception)',
    splitPagesBatches(null).length === 0 && splitPagesBatches([]).length === 0);
  check('chevauchement posé à partir du 2e lot (procédure à cheval)',
    splitPagesBatches(pages(10, 300), { maxChars: 1000 })[1].overlap.length > 0);
  check('maxBatches respecté', splitPagesBatches(pages(50, 300), { maxChars: 400, maxBatches: 6 }).length === 6);
}

console.log('── SA-15.4 — photoRefs / plancheAlt : relier le renvoi à la planche ──');
{
  // Phrases RÉELLES du manuel client (pages 64 et 68).
  check('« - Photo 5 » du manuel repéré',
    JSON.stringify(photoRefs('le poing est à plat, les doigts sont dirigés vers le bas - Photo 5,')) === '[5]');
  check('plusieurs renvois sur une même page, dédoublonnés et triés',
    JSON.stringify(photoRefs('pivote le pied d\'appui - Photo 2, le buste se penche - Photo 3. Voir Photo 2.')) === '[2,3]');
  check('fig. / figure / schéma / planche acceptés',
    JSON.stringify(photoRefs('cf. fig. 3')) === '[3]' && JSON.stringify(photoRefs('schéma 1')) === '[1]'
    && JSON.stringify(photoRefs('Figure 7')) === '[7]' && JSON.stringify(photoRefs('planche 4')) === '[4]');
  check('« photo n° 2 » accepté', JSON.stringify(photoRefs('voir photo n° 2')) === '[2]');
  // Volontairement strict : sans numéro, ce n'est pas un renvoi exploitable.
  check('mention non numérotée ignorée (« photographie de la garde »)',
    photoRefs('photographie de la garde, photos ci-dessus').length === 0);
  check('numéro invalide / hors bornes ignoré',
    photoRefs('photo 0').length === 0 && photoRefs('photo 250').length === 0);
  check('vide / null → [] (jamais d\'exception)',
    photoRefs('').length === 0 && photoRefs(null).length === 0 && photoRefs(undefined).length === 0);
  // Le regex est global : sans reset de lastIndex, un appel sur deux échoue.
  check('appels répétés stables (piège du /g partagé)',
    JSON.stringify(photoRefs('Photo 2')) === '[2]' && JSON.stringify(photoRefs('Photo 2')) === '[2]'
    && JSON.stringify(photoRefs('Photo 2')) === '[2]');

  check('légende sans renvoi = provenance seule', plancheAlt(34, []) === 'Page 34');
  check('légende à un renvoi', plancheAlt(64, [5]) === 'Page 64 — photo 5');
  check('légende à plusieurs renvois', plancheAlt(68, [1, 2, 3]) === 'Page 68 — photos 1, 2, 3');
  check('null toléré', plancheAlt(12, null) === 'Page 12');
}

console.log('── SA-15.0 — unitWarning : le danger sort du texte, pas du modèle ──');
{
  const proc = (w) => ({ type: 'procedure', body: JSON.stringify({ goal: 'G', steps: ['a'], ...(w !== undefined ? { warnings: w } : {}) }) });
  check('avertissement réel remonté mot pour mot',
    unitWarning(proc('La gorge est une cible à effet potentiellement radical.'))
      === 'La gorge est une cible à effet potentiellement radical.');
  check('procédure sans avertissement → null (pas de bloc vide sous la réponse)',
    unitWarning(proc()) === null);
  check('champ vide / espaces → null', unitWarning(proc('')) === null && unitWarning(proc('   \n ')) === null);
  check('espaces de bord retirés', unitWarning(proc('  DANGER  ')) === 'DANGER');
  check('body déjà désérialisé (objet) accepté',
    unitWarning({ type: 'procedure', body: { goal: 'G', steps: ['a'], warnings: 'ATTENTION' } }) === 'ATTENTION');
  check('seul le gabarit "procedure" porte un avertissement',
    unitWarning({ type: 'rule', body: JSON.stringify({ rule: 'R', exceptions: 'E' }) }) === null);
  check('body illisible → null (une fiche cassée ne casse jamais la réponse)',
    unitWarning({ type: 'procedure', body: '{pas du json' }) === null);
  check('row absente → null', unitWarning(null) === null && unitWarning(undefined) === null);
  check('avertissement fleuve borné à 600 car.',
    unitWarning(proc('D'.repeat(900))).length === 600);
}

console.log('── SA-14.2 — clampRelevance (jamais bloquant) ──');
{
  check('note valide conservée', clampRelevance(8) === 8 && clampRelevance(1) === 1 && clampRelevance(10) === 10);
  check('absente / nulle → 5 (défaut « moyen »)',
    clampRelevance(undefined) === 5 && clampRelevance(null) === 5);
  check('hors bornes ramenée dans [1,10]', clampRelevance(42) === 10 && clampRelevance(-3) === 1 && clampRelevance(0) === 1);
  check('décimale arrondie', clampRelevance(7.4) === 7 && clampRelevance(7.6) === 8);
  check('string numérique tolérée ("9" arrive souvent du JSON du modèle)', clampRelevance('9') === 9);
  check('texte / objet → défaut (jamais NaN)',
    clampRelevance('haut') === 5 && clampRelevance({}) === 5 && clampRelevance(NaN) === 5);
  check('défaut paramétrable', clampRelevance(undefined, 3) === 3);
}

console.log('── SA-14.2 — parseProposals : note attachée, tri, rien d\'écarté ──');
{
  const raw = JSON.stringify([
    { type: 'fact', title: 'Sommaire du document', relevance: 2, body: { statement: 'Page 1 : intro' } },
    { type: 'qa',   title: 'Peut-on payer en plusieurs fois ?', relevance: 9, body: { question: 'Q ?', answer: 'Oui' } },
    { type: 'rule', title: 'Règle sans note', body: { rule: 'Toujours vérifier' } },
  ]);
  const props = parseProposals(raw);
  check('les 3 fiches sont conservées (aucun filtrage automatique)', props.length === 3);
  check('triées par pertinence décroissante',
    props.map(p => p.relevance).join() === '9,5,2');
  check('note manquante → 5, la fiche reste valide',
    props[1].title === 'Règle sans note' && props[1].relevance === 5);
  check('relevance N\'ENTRE PAS dans le body (jamais stockée en base)',
    props.every(p => !('relevance' in p.body)));
  check('note aberrante clampée sans rejeter la fiche',
    parseProposals(JSON.stringify([{ type: 'fact', title: 'T', relevance: 99, body: { statement: 'S' } }]))[0].relevance === 10);
  {
    // Chemin « interview » : le prompt ne demande pas de note → tout à 5 →
    // le tri stable doit laisser l'ordre du modèle strictement intact.
    const sansNote = parseProposals(JSON.stringify([
      { type: 'fact', title: 'A', body: { statement: 's' } },
      { type: 'fact', title: 'B', body: { statement: 's' } },
      { type: 'fact', title: 'C', body: { statement: 's' } },
    ]));
    check('sans note nulle part → ordre du modèle inchangé (tri stable)',
      sansNote.map(p => p.title).join('') === 'ABC');
  }
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

console.log('── SA-9.5 — normalizeForSpeech (heures, sigles épelés) ──');
{
  const { normalizeForSpeech: n } = await import('../app/lib/piper-tts.js');
  check('20h30 → 20 heures 30', n('Ouvert jusqu\'à 20h30.') === 'Ouvert jusqu\'à 20 heures 30.');
  check('9h00 → 9 heures (minutes muettes)', n('de 9h00 à 12h00') === 'de 9 heures à 12 heures');
  check('9h → 9 heures · 1h → 1 heure', n('9h puis 1h') === '9 heures puis 1 heure');
  check('Keystone OS → épelé', n('Keystone OS est un tableau de bord.') === 'Keystone o-èsse est un tableau de bord.');
  check('« les os » (minuscules) intact', n('les os du squelette') === 'les os du squelette');
  check('QR code → épelé', n('un QR code à scanner') === 'un ku-èrre code à scanner');
  check('SAV / RGPD / PDF épelés', n('le SAV, le RGPD et un PDF')
    === 'le èsse-a-vé, le èrre-gé-pé-dé et un pé-dé-èffe');
  check('RDV → rendez-vous', n('prendre RDV demain') === 'prendre rendez-vous demain');
  check('60 Mo → mégaoctets', n('un modèle de 60 Mo') === 'un modèle de 60 mégaoctets');
  check('HT épelé mais HTML intact', n('prix HT en HTML') === 'prix ache-té en HTML');
  check('texte ordinaire → intact', n('Bonjour, bienvenue au musée !') === 'Bonjour, bienvenue au musée !');
}

console.log('── SA-9.4 — trimSilence (pauses raccourcies entre les phrases) ──');
{
  const { trimSilence } = await import('../app/lib/piper-tts.js');
  const sr = 22050;
  const sil = (ms) => new Float32Array(Math.round(sr * ms / 1000));            // silence
  const ton = (ms) => Float32Array.from({ length: Math.round(sr * ms / 1000) },
    (_, i) => 0.5 * Math.sin(i / 8));                                          // signal
  const concat = (...parts) => {
    const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const brut = concat(sil(400), ton(1000), sil(500));
  const net = trimSilence(brut, sr);
  const dureeMs = Math.round(net.length / sr * 1000);
  check('silences tête/queue taillés (1,9 s → ~1,08 s : signal + marges 30/50 ms)',
    dureeMs >= 1040 && dureeMs <= 1120);
  check('le signal utile est intégralement conservé',
    net.some(v => Math.abs(v) > 0.4) && Math.abs(net.length - (sil(30).length + ton(1000).length + sil(50).length)) < sr * 0.02);
  const sansSilence = ton(800);
  check('signal sans silence → intact', trimSilence(sansSilence, sr).length === sansSilence.length);
  check('tout-silence → intact (rien à tailler proprement)',
    trimSilence(sil(500), sr).length === sil(500).length);
  check('vide → vide', trimSilence(new Float32Array(0), sr).length === 0);
}

console.log('── SA-9.2 — shortenFirst (premier son plus tôt) ──');
{
  const { shortenFirst } = await import('../app/lib/piper-tts.js');
  const longue = 'Le Musée Copte est ouvert du lundi au samedi de neuf heures à midi, puis de quatorze heures à dix-huit heures, et il est fermé le dimanche toute la journée.';
  const out = shortenFirst([longue, 'Suite.']);
  check('phrase longue scindée à une virgule (30-95)',
    out.length === 3 && out[0].endsWith(',') && out[0].length <= 95 && out[0].length >= 30);
  check('rien n\'est perdu à la scission',
    (out[0] + ' ' + out[1]).replace(/\s+/g, ' ') === longue.replace(/\s+/g, ' '));
  check('phrase courte intacte', JSON.stringify(shortenFirst(['Bonjour à tous.', 'Suite.']))
    === JSON.stringify(['Bonjour à tous.', 'Suite.']));
  check('longue SANS virgule → intacte (pas de coupe en plein mot)',
    shortenFirst(['a'.repeat(140) + '.']).length === 1);
  check('liste vide → vide', shortenFirst([]).length === 0);
}

console.log('── SA-9 — packs métier (contenu conforme au contrat des fiches) ──');
{
  const { SA_PACKS, packForRole } = await import('../app/lib/sa-packs.js');
  const ids = Object.keys(SA_PACKS);
  check('6 packs : vendeur, immo, gardien, concierge, guide, sav',
    JSON.stringify(ids.sort()) === JSON.stringify(['concierge', 'gardien', 'guide', 'immo', 'sav', 'vendeur']));
  let fiches = 0, invalides = [];
  for (const [id, p] of Object.entries(SA_PACKS)) {
    for (const f of p.fiches) {
      fiches++;
      const v = validateUnit(f.type, f.title, f.body);
      if (!v.ok) invalides.push(`${id}/${f.title} : ${v.msg}`);
    }
    if (!Array.isArray(p.questions) || p.questions.length < 8) invalides.push(`${id} : questions < 8`);
    if (p.questions.some(q => typeof q !== 'string' || q.length < 15)) invalides.push(`${id} : question trop courte`);
    if (!p.label || !p.icon || p.fiches.length < 6) invalides.push(`${id} : pack incomplet`);
  }
  check(`TOUTES les fiches des packs passent validateUnit (${fiches} fiches)`, invalides.length === 0);
  if (invalides.length) console.error('   →', invalides.join(' | '));
  check('packForRole : déductions correctes',
    packForRole('conseiller de vente') === 'vendeur'
    && packForRole('Conseiller immobilier') === 'immo'
    && packForRole('agent d\'accueil et de surveillance') === 'gardien'
    && packForRole('concierge') === 'concierge'
    && packForRole('guide') === 'guide'
    && packForRole('conseiller service client') === 'sav');
  check('packForRole : rôle inconnu ou vide → null',
    packForRole('boulanger') === null && packForRole('') === null && packForRole(null) === null);
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

console.log('── Lot 2 — contact public (lien web + téléphone) ──');
check('sanitizePublicUrl garde https', sanitizePublicUrl('https://musee.fr') === 'https://musee.fr');
check('sanitizePublicUrl tolère sans schéma', sanitizePublicUrl('  www.musee.fr ') === 'www.musee.fr');
check('sanitizePublicUrl rejette javascript:', sanitizePublicUrl('javascript:alert(1)') === '');
check('sanitizePublicUrl rejette data:', sanitizePublicUrl('data:text/html,x') === '');
check('sanitizePublicUrl vide → ""', sanitizePublicUrl('') === '');
{
  const v = validateAgentPayload({ name: 'X', config: { identity: { mission: 'm' }, contact: { website_url: 'www.x.fr', phone: ' +33 1 23 ' } } });
  check('contact validé : url conservée', v.ok && v.config.contact.website_url === 'www.x.fr');
  check('contact validé : phone trim', v.ok && v.config.contact.phone === '+33 1 23');
  check('contact javascript: neutralisé', validateAgentPayload({ name: 'X', config: { identity: { mission: 'm' }, contact: { website_url: 'javascript:x' } } }).config.contact.website_url === '');
}
check('publicAgentMeta expose url', publicAgentMeta({ name: 'L', config: { contact: { website_url: 'www.x.fr' } } }).url === 'www.x.fr');
check('publicAgentMeta expose phone', publicAgentMeta({ name: 'L', config: { contact: { phone: '0102' } } }).phone === '0102');
check('publicAgentMeta url absent → ""', publicAgentMeta({ name: 'L', config: {} }).url === '');

console.log('── Lot 3 — cartes-photos (validateCards + meta) ──');
{
  const good = { img: 'sa-cards/abc-123/de-f456.jpg', q: 'Parlez-moi de cet objet', alt: 'encensoir' };
  const v = validateCards([good]);
  check('carte valide conservée', v.length === 1 && v[0].img === good.img && v[0].q === good.q);
  check('clé R2 invalide (traversal) → écartée', validateCards([{ img: '../etc/passwd', q: 'x' }]).length === 0);
  check('carte sans question → écartée', validateCards([{ img: 'sa-cards/a/b.jpg', q: '  ' }]).length === 0);
  check('non-tableau → []', validateCards('nope').length === 0);
  check('plafonné à 50', validateCards(Array.from({ length: 60 }, () => ({ img: 'sa-cards/a/b.jpg', q: 'q' }))).length === 50);
}
{
  const meta = publicAgentMeta({ name: 'M', config: { cards: [{ img: 'sa-cards/a1/b2.jpg', q: 'Voir ceci', alt: 'x' }] } }, 'https://api.test');
  check('meta.cards : image absolue', meta.cards.length === 1 && meta.cards[0].image === 'https://api.test/api/smart-agent/card-img/sa-cards/a1/b2.jpg');
  check('meta.cards : question exposée', meta.cards[0].question === 'Voir ceci');
  check('meta sans cards → []', publicAgentMeta({ name: 'M', config: {} }).cards.length === 0);
}

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
  check('n\'expose NI tenant NI mission NI coffre (liste blanche : name/opening/opening_i18n/tone/role/lang/url/url_label/phone/theme/cards)',
    meta.tenant_id === undefined && meta.mission === undefined &&
    meta.config === undefined && Object.keys(meta).sort().join(',') === 'cards,lang,name,opening,opening_i18n,phone,role,theme,tone,url,url_label');
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
  check('fallback ancré + citations SANS marqueur → ko (vrai débordement)', goldenVerdict('fallback', true, 2).ok === false);
  check('fallback ancré + pas d\'IA (cap) → ko prudent', goldenVerdict('fallback', true, null).ok === false);
  check('predicted cohérent (fallback repli)', goldenVerdict('fallback', true, 0).predicted === 'fallback');
  check('predicted cohérent (fallback débordement)', goldenVerdict('fallback', true, 3).predicted === 'answer');
}

console.log('── SA-14.5 — goldenVerdict : le MARQUEUR prime sur la citation ──');
{
  // Mesuré le 21/07 : « le livre ne donne pas cette information, en revanche
  // je peux vous parler de… [1] » est un repli CORRECT. L'ancienne règle le
  // comptait débordement et faisait tomber un agent sain de 88 % à 36 %.
  check('fallback + marqueur + redirection citée → ok (repli avec redirection)',
    goldenVerdict('fallback', true, 2, true).ok === true);
  check('predicted = fallback dans ce cas',
    goldenVerdict('fallback', true, 2, true).predicted === 'fallback');
  check('fallback + marqueur sans citation → ok (trou sec)',
    goldenVerdict('fallback', true, 0, true).ok === true);
  check('SANS marqueur, citer reste un débordement (la règle ne s\'effondre pas)',
    goldenVerdict('fallback', true, 2, false).ok === false);
  check('le marqueur ne sauve JAMAIS un « doit répondre » resté non ancré',
    goldenVerdict('answer', false, 0, true).ok === false);
  check('4e paramètre absent → comportement d\'avant strictement conservé',
    goldenVerdict('fallback', true, 2).ok === false && goldenVerdict('fallback', true, 0).ok === true);
}

console.log('── SA-14.5 — gapOutcome (trou sec vs repli avec redirection) ──');
{
  check('marqueur + aucune citation → trou SEC (crédit à rendre)',
    gapOutcome(true, 0).gapped === true && gapOutcome(true, 0).deflected === false);
  check('marqueur + citations → redirection sourcée (pas de remboursement)',
    gapOutcome(true, 3).deflected === true && gapOutcome(true, 3).gapped === false);
  check('aucun marqueur → ni l\'un ni l\'autre (réponse normale)',
    gapOutcome(false, 0).gapped === false && gapOutcome(false, 2).deflected === false);
  check('les deux états sont EXCLUSIFS (jamais vrais ensemble)',
    [[true, 0], [true, 5], [false, 0], [false, 5]].every(([m, c]) => {
      const o = gapOutcome(m, c);
      return !(o.gapped && o.deflected);
    }));
  check('entrées molles tolérées (undefined, string)',
    gapOutcome(true).gapped === true && gapOutcome(true, '2').deflected === true);
}

console.log('── SA-14.0 — groundedFromSignals (la formule d\'ancrage isolée) ──');
{
  const sig = (o) => ({ topVec: 0, anyLex: false, semantic: true, hitCount: 1, ...o });
  check('aucune fiche → jamais ancré, quel que soit le seuil',
    groundedFromSignals(sig({ hitCount: 0, topVec: 0.99 }), 0.30) === false);
  check('accroche lexicale → ancré même sous le seuil',
    groundedFromSignals(sig({ anyLex: true, topVec: 0.10 }), 0.42) === true);
  check('sans couche sémantique → ancré dès qu\'il y a une fiche',
    groundedFromSignals(sig({ semantic: false }), 0.42) === true);
  check('cosinus au seuil exact → ancré (borne incluse)',
    groundedFromSignals(sig({ topVec: 0.42 }), 0.42) === true);
  check('cosinus juste sous le seuil → non ancré (la « falaise »)',
    groundedFromSignals(sig({ topVec: 0.4199 }), 0.42) === false);
  // Garde-fou anti-dérive : la prod (isGrounded) et la calibration doivent
  // TOUJOURS décider pareil, sinon on calibre autre chose que ce qui tourne.
  const cas = [
    { semantic: true,  hits: [] },
    { semantic: true,  hits: [{ vecScore: 0.55 }] },
    { semantic: true,  hits: [{ vecScore: 0.20 }] },
    { semantic: true,  hits: [{ vecScore: 0.10, lexRank: 1 }] },
    { semantic: false, hits: [{ vecScore: 0 }] },
  ];
  check('parité stricte avec isGrounded sur tous les cas de figure',
    cas.every(c => {
      const ref = isGrounded(c);
      return groundedFromSignals({
        topVec: c.hits.reduce((m, h) => Math.max(m, h.vecScore || 0), 0),
        anyLex: c.hits.some(h => h.lexRank), semantic: c.semantic, hitCount: c.hits.length,
      }) === ref.grounded;
    }));
}

console.log('── SA-14.0 — sweepGroundThreshold (optimum connu à l\'avance) ──');
{
  const s = (expect, topVec, extra = {}) => ({ expect, topVec, anyLex: false, semantic: true, hitCount: 1, llmCites: null, ...extra });
  // Optimum UNIQUE construit à la main : « répondre » à 0.50, « se taire » à
  // 0.49 → seul t = 0.50 satisfait les deux familles (≥ 0.50 ancre, > 0.49 tait).
  {
    const sw = sweepGroundThreshold([
      s('answer', 0.50), s('answer', 0.50), s('answer', 0.50),
      s('fallback', 0.49), s('fallback', 0.49), s('fallback', 0.49),
    ]);
    check('trouve l\'optimum unique 0.50', sw.best.threshold === 0.50 && sw.best.passed === 6);
    check('score en pourcentage', sw.best.score === 100 && sw.total === 6);
    check('seuil actuel (0.42) mesuré en comparaison : 3/6',
      sw.current.threshold === 0.42 && sw.current.passed === 3);
    check('un candidat par pas, bornes incluses (0.30→0.60)',
      sw.candidates.length === 31 && sw.candidates[0].threshold === 0.30
      && sw.candidates[30].threshold === 0.60);
  }
  // Plateau : quand plusieurs seuils font le même score, on NE BOUGE PAS la
  // constante pour rien → le gagnant doit être le plus proche de l'actuel.
  {
    const sw = sweepGroundThreshold([
      s('answer', 0.45), s('answer', 0.50), s('answer', 0.55),
      s('fallback', 0.35), s('fallback', 0.38),
    ]);
    check('plateau 0.39→0.45 : le seuil ACTUEL gagne l\'égalité (aucun déplacement gratuit)',
      sw.best.passed === 5 && sw.best.threshold === 0.42);
  }
  check('accroche lexicale : aucun seuil ne peut la faire taire',
    sweepGroundThreshold([s('fallback', 0.05, { anyLex: true })]).best.passed === 0);
  check('« doit ignorer » qui cite vraiment 0 fiche → ok même ancré',
    sweepGroundThreshold([s('fallback', 0.90, { llmCites: 0 })]).current.passed === 1);
  check('signaux vides → total 0, score null (pas de division par zéro)',
    sweepGroundThreshold([]).total === 0 && sweepGroundThreshold([]).best.score === null);
  check('non-tableau toléré', sweepGroundThreshold(null).total === 0);
  {
    const sw = sweepGroundThreshold([s('answer', 0.50)], { from: 0.40, to: 0.44, step: 0.02 });
    check('bornes/pas personnalisables', sw.candidates.length === 3 && sw.candidates[1].threshold === 0.42);
  }
}

console.log('── SA-14.1 — needsRerank (on ne paie que l\'ambiguïté) ──');
{
  const h = (...v) => v.map(x => ({ vecScore: x }));
  check('une seule fiche → rien à réordonner',
    needsRerank(h(0.42)) === false);
  check('deux têtes au coude à coude (0.71 / 0.69) → rerank',
    needsRerank(h(0.71, 0.69, 0.30)) === true);
  check('écart net entre les deux têtes (0.80 / 0.55) → PAS de rerank',
    needsRerank(h(0.80, 0.55, 0.20)) === false);
  check('meilleur score dans la zone du seuil (0.44 vs 0.42) → rerank (la « falaise »)',
    needsRerank(h(0.44, 0.20)) === true);
  check('juste sous la zone (0.36) et écart net → PAS de rerank',
    needsRerank(h(0.36, 0.10)) === false);
  check('mode lexical seul (aucun vecScore) → abstention (sinon on paierait TOUTES les requêtes)',
    needsRerank([{ lexRank: 1, vecScore: null }, { lexRank: 2, vecScore: null }]) === false);
  check('un seul score sémantique sur deux fiches → abstention',
    needsRerank([{ vecScore: 0.9 }, { vecScore: null }]) === false);
  check('vide / non-tableau → false',
    needsRerank([]) === false && needsRerank(null) === false);
  check('marge et seuil paramétrables',
    needsRerank(h(0.80, 0.55), 0.42, 0.30) === true);
}

console.log('── SA-14.1 — applyRerank (réordonne SANS jamais dégrader) ──');
{
  const hits = [
    { row: { id: 'a' }, vecScore: 0.44, lexRank: 1, score: 0.9 },
    { row: { id: 'b' }, vecScore: 0.43, lexRank: null, score: 0.8 },
    { row: { id: 'c' }, vecScore: 0.42, lexRank: 2, score: 0.7 },
  ];
  const ids = (l) => l.map(x => x.row.id).join('');
  {
    const out = applyRerank(hits, [{ id: 0, score: 0.10 }, { id: 1, score: 0.95 }, { id: 2, score: 0.50 }]);
    check('réordonné par score de reranking', ids(out) === 'bca');
    check('rerankScore attaché (observabilité)', out[0].rerankScore === 0.95);
    check('vecScore / lexRank / score RRF INTACTS (le grounding ne bouge pas)',
      out[0].vecScore === 0.43 && out[0].lexRank === null && out[0].score === 0.8);
    check('aucune fiche perdue', out.length === 3);
  }
  {
    const out = applyRerank(hits, [{ id: 2, score: 0.9 }, { id: 0, score: 0.8 }]);
    check('fiche non jugée → reléguée en fin, jamais écartée',
      ids(out) === 'cab' && out[2].rerankScore === null);
  }
  check('réponse vide → ordre RRF intact', ids(applyRerank(hits, [])) === 'abc');
  check('réponse absente / non-tableau → ordre RRF intact',
    ids(applyRerank(hits, undefined)) === 'abc' && ids(applyRerank(hits, 'nope')) === 'abc');
  check('indices hors bornes ignorés → moins de 2 scores → ordre intact',
    ids(applyRerank(hits, [{ id: 9, score: 1 }, { id: -1, score: 1 }, { id: 0, score: 1 }])) === 'abc');
  check('scores non numériques ignorés',
    ids(applyRerank(hits, [{ id: 0, score: 'haut' }, { id: 1, score: null }, { id: 2, score: 0.9 }])) === 'abc');
  check('égalité de score → l\'ordre RRF tranche (déterminisme)',
    ids(applyRerank(hits, [{ id: 2, score: 0.5 }, { id: 1, score: 0.5 }, { id: 0, score: 0.5 }])) === 'abc');
  check('hits vides → []', applyRerank([], [{ id: 0, score: 1 }]).length === 0);
}

console.log('── SA-14.1 — _rerank (best-effort : une panne ne casse jamais le chat) ──');
{
  const hits = [
    { row: { id: 'a', title: 'A', body_text: 'x' }, vecScore: 0.44 },
    { row: { id: 'b', title: 'B', body_text: 'y' }, vecScore: 0.43 },
  ];
  const ids = (l) => l.map(x => x.row.id).join('');
  check('modèle en échec → ordre d\'origine, sans jeter',
    ids(await _rerank({ AI: { run: async () => { throw new Error('503'); } } }, 'q', hits)) === 'ab');
  check('binding AI absent → ordre d\'origine',
    ids(await _rerank({}, 'q', hits)) === 'ab' && ids(await _rerank(null, 'q', hits)) === 'ab');
  check('réponse illisible → ordre d\'origine',
    ids(await _rerank({ AI: { run: async () => ({ oups: true }) } }, 'q', hits)) === 'ab');
  {
    let seen = null;
    const out = await _rerank({ AI: { run: async (_m, input) => { seen = input; return { response: [{ id: 1, score: 0.9 }, { id: 0, score: 0.1 }] }; } } }, 'quels horaires ?', hits);
    check('succès → réordonné', ids(out) === 'ba');
    check('contexte envoyé = titre + corps, un par fiche',
      seen.contexts.length === 2 && seen.contexts[0].text === 'A\nx');
    check('la requête est transmise telle quelle', seen.query === 'quels horaires ?');
  }
}

console.log('── SA-14.3 — needsExpansion (jamais sur le chemin heureux) ──');
{
  check('question déjà ancrée → JAMAIS de reformulation, même très courte',
    needsExpansion('tarifs ?', true) === false);
  check('question courte non ancrée → reformulation',
    needsExpansion('remboursement ?', false) === true);
  check('6 mots = la borne, incluse',
    needsExpansion('comment faire pour un remboursement partiel', false) === true);
  check('7 mots → question déjà bien formée, on ne paie pas',
    needsExpansion('comment faire pour obtenir un remboursement partiel aujourd\'hui', false) === false);
  check('ponctuation seule ne compte pas comme un mot',
    needsExpansion('remboursement ? ! ...', false) === true);
  check('trop court pour vouloir dire quelque chose → abstention',
    needsExpansion('ok', false) === false && needsExpansion('?', false) === false);
  check('vide / null → false', needsExpansion('', false) === false && needsExpansion(null, false) === false);
  check('borne paramétrable', needsExpansion('un deux trois quatre', false, 3) === false);
}

console.log('── SA-14.3 — _expandQuery (best-effort, jamais bloquant) ──');
{
  const ai = (fn) => ({ AI: { run: fn } });
  const ok = (text) => ai(async () => ({ response: text }));
  check('IA en échec → chaîne vide (l\'appelant garde son repli)',
    await _expandQuery(ai(async () => { throw new Error('quota'); }), 'remboursement ?') === '');
  check('binding AI absent → chaîne vide',
    await _expandQuery({}, 'remboursement ?') === '' && await _expandQuery(null, 'x') === '');
  check('réponse vide → chaîne vide', await _expandQuery(ok('   '), 'remboursement ?') === '');
  check('reformulation propre renvoyée',
    await _expandQuery(ok('procédure de remboursement délai conditions'), 'remboursement ?')
      === 'procédure de remboursement délai conditions');
  check('guillemets et préfixes retirés',
    await _expandQuery(ok('« procédure de remboursement »'), 'remboursement ?') === 'procédure de remboursement');
  check('bavardage multiligne → première ligne seulement',
    await _expandQuery(ok('procédure de remboursement\n\nJ\'espère que cela aide !'), 'remboursement ?')
      === 'procédure de remboursement');
  check('reformulation identique à l\'entrée → vide (une 2e recherche identique ne coûterait que du temps)',
    await _expandQuery(ok('Remboursement ?'), 'remboursement ?') === '');
  check('sortie bornée à 160 caractères',
    (await _expandQuery(ok('a'.repeat(400)), 'q ?')).length === 160);
  {
    let seen = null;
    await _expandQuery({ AI: { run: async (_m, p) => { seen = p; return { response: 'r' }; } } }, 'horaires ?', null, 'en');
    check('langue de la question transmise au prompt (pas de bascule en français)',
      /ANGLAIS/.test(seen.messages[0].content));
    check('température basse et génération bornée',
      seen.temperature === 0.2 && seen.max_tokens === 60);
  }
}

console.log('── SA-14.4 — splitMarkdownBatches (découpage par structure) ──');
{
  const para = (n, c) => Array.from({ length: n }, (_, i) => `${c}${i} `.repeat(40).trim()).join('\n\n');
  {
    const doc = `# Manuel\n\nIntro du manuel.\n\n## Sécurité\n\nRègle de sécurité.\n\n### Alarme\n\nDésactiver l'alarme.`;
    const b = splitMarkdownBatches(doc, { maxChars: 10000 });
    check('petit document → un seul lot (on ne découpe pas pour le plaisir)', b.length === 1);
    check('aucun chevauchement sur le premier lot', b[0].overlap === '');
    check('fil d\'ariane = la chaîne des titres du DÉBUT du lot', b[0].breadcrumb === 'Manuel');
    check('le contenu est intégralement conservé',
      b[0].text.includes('Intro du manuel') && b[0].text.includes('Désactiver l\'alarme'));
    check('les titres restent DANS le texte (l\'extracteur doit les voir)', b[0].text.includes('# Manuel'));
  }
  {
    // Trois sections d'environ 730 caractères, lots de 1000 → une par lot
    // (deux ne tiennent pas ensemble, une seule ne se coupe pas).
    const doc = ['# A', para(6, 'a'), '# B', para(6, 'b'), '# C', para(6, 'c')].join('\n\n');
    const b = splitMarkdownBatches(doc, { maxChars: 1000, overlapRatio: 0.15 });
    check('découpé aux titres, un lot par section', b.length === 3);
    check('fil d\'ariane par lot', b.map(x => x.breadcrumb).join(',') === 'A,B,C');
    check('index séquentiels', b.map(x => x.index).join(',') === '0,1,2');
    check('chevauchement présent dès le 2e lot',
      b[0].overlap === '' && b[1].overlap.length > 0 && b[2].overlap.length > 0);
    check('le chevauchement vient bien de la FIN du lot précédent',
      b[0].text.endsWith(b[1].overlap.slice(-40)));
    check('chevauchement borné (~15 % de la taille de lot)', b[1].overlap.length <= 150);
    check('AUCUN contenu perdu : la concaténation des lots couvre tout le document',
      ['a0', 'a2', 'b0', 'b2', 'c0', 'c2'].every(t => b.map(x => x.text).join('\n').includes(t)));
  }
  {
    // Fil d'ariane hiérarchique : un sous-titre hérite de ses ancêtres.
    const doc = ['# Manuel', para(2, 'm'), '## Sécurité', para(2, 's'), '### Alarme', para(2, 'x')].join('\n\n');
    const b = splitMarkdownBatches(doc, { maxChars: 700 });
    check('sous-section → fil d\'ariane complet « Manuel › Sécurité › Alarme »',
      b.some(x => x.breadcrumb === 'Manuel › Sécurité › Alarme'));
    check('un titre de même niveau REMPLACE son pair, il ne s\'empile pas',
      splitMarkdownBatches(['# A', 'x'.repeat(300), '# B', 'y'.repeat(300)].join('\n\n'), { maxChars: 400 })
        .every(x => !x.breadcrumb.includes('A › B')));
  }
  {
    // Section unique trop grosse pour un lot → coupée aux paragraphes.
    const doc = '# Gros\n\n' + para(20, 'p');
    const b = splitMarkdownBatches(doc, { maxChars: 1000 });
    check('section trop grosse → plusieurs lots', b.length > 1);
    check('tous les lots respectent la borne', b.every(x => x.chars <= 1000));
    check('le fil d\'ariane de la section est conservé sur chaque morceau',
      b.every(x => x.breadcrumb === 'Gros'));
    check('rien de perdu à la coupe',
      ['p0', 'p9', 'p19'].every(t => b.map(x => x.text).join('\n').includes(t)));
  }
  check('paragraphe monstre sans respiration → coupe dure, jamais de lot hors borne',
    splitMarkdownBatches('x'.repeat(5000), { maxChars: 1000 }).every(x => x.chars <= 1000));
  check('document sans AUCUN titre → découpe par paragraphes, pas d\'échec',
    splitMarkdownBatches(para(20, 'n'), { maxChars: 1000 }).length > 1);
  check('plafond du nombre de lots respecté',
    splitMarkdownBatches(para(200, 'z'), { maxChars: 200, maxBatches: 5 }).length === 5);
  check('vide / null → aucun lot (jamais un lot fantôme)',
    splitMarkdownBatches('').length === 0 && splitMarkdownBatches(null).length === 0);
  check('retours chariot Windows normalisés',
    splitMarkdownBatches('# T\r\n\r\nligne').length === 1);
}

console.log('── SA-14.4 — buildBatchPrompt (le chevauchement doit RECOMPOSER) ──');
{
  const p = buildBatchPrompt({ breadcrumb: 'Manuel › Sécurité', overlap: 'fin du lot 1', text: 'suite' }, 'manuel.pdf');
  check('rappel du lot précédent présent', p.includes('FIN DU LOT PRÉCÉDENT') && p.includes('fin du lot 1'));
  check('consigne EXPLICITE de recomposer une seule fiche (pas deux moitiés)',
    p.includes('UNE\nSEULE fiche complète') || p.includes('UNE SEULE fiche complète'));
  check('interdiction d\'extraire le chevauchement pour lui-même (anti-doublon)',
    p.includes('N\'en extrais AUCUNE fiche pour lui-même'));
  check('fil d\'ariane et source dans l\'en-tête (traçabilité)',
    p.includes('section : Manuel › Sécurité') && p.includes('importé de : manuel.pdf'));
  check('texte du lot présent', p.includes('suite'));
  {
    const first = buildBatchPrompt({ breadcrumb: '', overlap: '', text: 'début' });
    check('premier lot : aucun bloc de chevauchement, en-tête propre',
      !first.includes('FIN DU LOT PRÉCÉDENT') && first.startsWith('TEXTE À ANALYSER :'));
  }
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

console.log('── SA-12.0 — socle savoir-être (sobriété + arbre d\'hypothèses) ──');
{
  const base = { agentName: 'A', mission: 'm', tone: 't', fallbackText: 'X', fiches: '[1] f', message: 'q', history: [] };
  const sys = buildChatMessages(base)[0].content;
  check('socle présent dans le system', sys.includes('SAVOIR-ÊTRE'));
  check('sobriété : 1 à 3 phrases courtes', /1 à 3 phrases courtes/.test(sys));
  check('zéro formule creuse', /N'hésitez pas/.test(sys));
  check('arbre d\'hypothèses : UNE question discriminante, jamais deux',
    /UNE seule question courte pour trancher/.test(sys) && /jamais deux d'affilée/.test(sys));
  check('écoute de l\'émotion avant la demande', /exprime une émotion/.test(sys));
  check('le socle vit dans le system, pas dans le tour utilisateur',
    !buildChatMessages(base)[1].content.includes('SAVOIR-ÊTRE'));
}

console.log('── SA-12.0 — detectSocialIntent (tours sociaux, zéro IA) ──');
{
  check('bonjour → greeting', detectSocialIntent('Bonjour !') === 'greeting');
  check('salut variantes → greeting', detectSocialIntent('salut') === 'greeting' && detectSocialIntent('Bonsoir') === 'greeting');
  check('bonjour ça va → wellbeing (priorité)', detectSocialIntent('Bonjour, ça va ?') === 'wellbeing');
  check('comment allez-vous → wellbeing', detectSocialIntent('Comment allez-vous ?') === 'wellbeing');
  check('merci beaucoup → thanks', detectSocialIntent('Merci beaucoup !') === 'thanks');
  check('ok merci → thanks', detectSocialIntent('ok merci') === 'thanks');
  check('merci au revoir → bye (priorité)', detectSocialIntent('merci au revoir') === 'bye');
  check('bonne journée → bye', detectSocialIntent('Bonne journée !') === 'bye');
  check('t\'es un robot → bot', detectSocialIntent('T\'es un robot ?') === 'bot');
  check('vous êtes une vraie personne → bot', detectSocialIntent('Vous êtes une vraie personne ou un robot ?') === 'bot');
  check('are you a robot → bot', detectSocialIntent('Are you a robot?') === 'bot');
  check('anglais/espagnol/allemand', detectSocialIntent('hello') === 'greeting'
    && detectSocialIntent('muchas gracias') === 'thanks' && detectSocialIntent('guten Tag') === 'greeting');
  check('salutation + vraie question → null (circuit ancré)',
    detectSocialIntent('Bonjour, quels sont vos horaires ?') === null);
  check('question métier → null', detectSocialIntent('Quel est le tarif étudiant ?') === null);
  check('merci suivi d\'une question → null', detectSocialIntent('merci, et pour les groupes ?') === null);
  check('vide/null → null', detectSocialIntent('') === null && detectSocialIntent(null) === null);
}

console.log('── SA-12.0 — pickSocialReply (variantes localisées) ──');
{
  check('greeting fr non vide', pickSocialReply('greeting', { lang: 'fr', rand: () => 0 }).length > 0);
  check('bot injecte le nom de l\'agent',
    pickSocialReply('bot', { agentName: 'Léa', lang: 'fr', rand: () => 0 }).includes('Léa'));
  check('localisé en (greeting)', pickSocialReply('greeting', { lang: 'en', rand: () => 0 }).startsWith('Hello'));
  check('langue inconnue → repli fr', pickSocialReply('thanks', { lang: 'xx', rand: () => 0 }) === pickSocialReply('thanks', { lang: 'fr', rand: () => 0 }));
  check('rand pilote la variante',
    pickSocialReply('greeting', { lang: 'fr', rand: () => 0 }) !== pickSocialReply('greeting', { lang: 'fr', rand: () => 0.9 }));
  check('intent inconnu → chaîne vide', pickSocialReply('zzz', { lang: 'fr' }) === '');
}

console.log(`\n${passed}/${passed + failed} tests OK${failed ? ` — ${failed} ÉCHEC(S)` : ''}`);
process.exit(failed ? 1 : 0);
