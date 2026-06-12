/* ═══════════════════════════════════════════════════════════════
   DÉMO — « Conseiller Keystone » : un agent vendeur complet qui
   vend Keystone OS et son écosystème. À utiliser comme démo client.

   MODE D'EMPLOI (2 minutes) :
     1. Ouvrez https://protein-keystone.com/app et CONNECTEZ-VOUS.
     2. Ouvrez la console du navigateur (F12 → onglet Console).
     3. Collez TOUT ce fichier, Entrée.
     4. Ouvrez le pad Smart Agent → l'agent « Conseiller Keystone »
        est prêt : Savoir rempli et validé, persona vendeur, tests
        étalons. Testez-le, puis publiez-le (Réglages → Publier)
        pour obtenir le lien/QR de démo.

   Le script crée : 1 agent (persona vendeur Keystone, repli varié)
   + 16 fiches VALIDÉES (indexées immédiatement) + 4 tests étalons.
   Relançable : si « Conseiller Keystone » existe déjà, il refuse
   (supprimez l'ancien agent d'abord — ou renommez-le).
   ═══════════════════════════════════════════════════════════════ */
(async () => {
  const API = 'https://keystone-os-api.keystone-os.workers.dev/api/smart-agent';
  const jwt = localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token');
  if (!jwt) { console.error('⛔ Connectez-vous au dashboard d\'abord (aucun jeton trouvé).'); return; }
  const api = async (path, body, method) => {
    const res = await fetch(API + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Authorization': 'Bearer ' + jwt, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  };

  const NAME = 'Conseiller Keystone';
  const { agents } = await api('/agents');
  if ((agents || []).some(a => a.name === NAME)) {
    console.error(`⛔ Un agent « ${NAME} » existe déjà — supprimez-le ou renommez-le avant de relancer.`);
    return;
  }

  console.log('1/4 — Création de l\'agent…');
  const { agent } = await api('/agents', {
    name: NAME,
    config: {
      identity: {
        role:      'conseiller Keystone OS',
        mission:   'Présenter Keystone OS et son écosystème aux professionnels (commerces, immobilier, lieux culturels, services), répondre à leurs questions et les amener à demander un accès à la bêta ou une démonstration.',
        tone:      'chaleureux, concret et confiant',
        style:     'Tu parles comme un bon conseiller de terrain, pas comme une plaquette : phrases courtes, exemples concrets tirés des fiches, bénéfice avant la technique. Tu reformules le métier de ton interlocuteur (« Si je comprends bien, vous êtes… ») pour lui montrer les outils qui LE concernent, et tu termines volontiers par une invitation simple : voir une démo, demander un accès bêta.',
        avoid:     'le jargon technique non expliqué, les promesses chiffrées absentes des fiches, dénigrer les concurrents, les pavés de texte',
        objective: 'vendre',
        posture:   'proactif',
        opening:   'Bonjour ! Je suis le conseiller Keystone. Dites-moi quel est votre métier, et je vous montre ce que Keystone OS peut faire pour vous — qu\'est-ce qui vous amène ?',
      },
      scope: {
        fallback_text: 'Bonne question — je n\'ai pas ce détail sous la main, mais l\'équipe Keystone vous répondra précisément. En attendant, je peux vous présenter le reste de l\'écosystème !',
        fallback_variants: [
          'Là, vous me posez une question qui mérite une vraie réponse d\'équipe plutôt qu\'une approximation. Je note ! Et sinon, voulez-vous voir ce que Keystone ferait pour votre métier ?',
          'Honnêtement, ce point précis dépasse ce que j\'ai en magasin — je préfère vous le dire. Parlons de votre activité : je vous montre les outils qui s\'y rapportent ?',
        ],
      },
    },
  });
  const A = agent.id;
  console.log('   ✓ agent', A);

  console.log('2/4 — Savoir : 16 fiches validées…');
  const fiches = [
    { type: 'fact', title: 'Keystone OS en une phrase', body: {
      statement: 'Keystone OS est un tableau de bord unique qui regroupe les outils métier d\'un professionnel : assistants IA ancrés sur son propre savoir, publication sur les réseaux sociaux, rédaction et correction, formulaires intelligents, QR codes dynamiques et une suite immobilière — le tout dans le navigateur, sans installation.',
      context: 'Réponse à « c\'est quoi Keystone ? » — la vue d\'ensemble avant de détailler un outil.' } },
    { type: 'fact', title: 'Le principe : un seul OS, vos outils', body: {
      statement: 'Chacun active les outils dont il a besoin depuis le K-Store, comme des applications sur un téléphone : un commerce ne voit pas les outils immobiliers, une agence immobilière a sa suite dédiée. Un seul abonnement, une seule interface, une seule courbe d\'apprentissage.' } },
    { type: 'fact', title: 'Tout est compris dans l\'abonnement', body: {
      statement: 'Keystone fonctionne en formule tout compris : l\'intelligence artificielle est incluse dans l\'abonnement, sans facturation à la consommation ni jetons à racheter. Un compteur d\'usage équitable évite les abus, et l\'utilisateur n\'a jamais de mauvaise surprise sur sa facture.' } },
    { type: 'fact', title: 'Smart Agent : le jumeau numérique de savoir-faire', body: {
      statement: 'Smart Agent crée un assistant qui répond aux clients UNIQUEMENT depuis le savoir validé par le professionnel — jamais d\'invention : s\'il ne sait pas, il le dit et la question remonte au propriétaire pour qu\'il la comble. Il se publie par lien ou QR code, parle à la voix, et des packs métier (vendeur, agent immobilier, gardien de musée, concierge, guide, SAV) le rendent opérationnel en une demi-heure.',
      context: 'L\'outil vitrine — c\'est d\'ailleurs lui qui fait tourner cette conversation.' } },
    { type: 'fact', title: 'Social Manager : publier partout en une fois', body: {
      statement: 'Social Manager publie un même post sur Facebook, Instagram, Threads et Telegram, immédiatement ou à l\'heure programmée. Il vérifie les contraintes de chaque réseau avant l\'envoi, retente automatiquement en cas d\'échec sans jamais doubler une publication, et relève les statistiques des réseaux qui les fournissent.' } },
    { type: 'fact', title: 'Ghost Writer : écrire et corriger', body: {
      statement: 'Ghost Writer réécrit un texte en trois variantes calibrées (email pro, communication interne, marketing, texte long) et embarque un correcteur d\'orthographe et de grammaire français qui travaille à 100 % dans le navigateur — y compris directement sur un PDF, sans que le document parte sur Internet.' } },
    { type: 'fact', title: 'Brainstorming : la salle de réunion d\'idées', body: {
      statement: 'Brainstorming fait débattre un comité d\'angles complémentaires (créatif, analytique, avocat du diable…) sur une question, puis en tire une synthèse. Son mode « Idées de posts » alimente directement Ghost Writer puis Social Manager : trouver l\'idée, rédiger, publier — la chaîne de contenu complète sans quitter Keystone.' } },
    { type: 'fact', title: 'Key Form et Smart Dynamic QR', body: {
      statement: 'Key Form crée des formulaires intelligents prêts à partager (utilisé par exemple par des artistes pour collecter biographies et œuvres), et Smart Dynamic QR génère des QR codes dynamiques : la destination se modifie après impression, les scans se mesurent — le même QR imprimé peut servir des campagnes différentes.' } },
    { type: 'fact', title: 'La suite immobilière', body: {
      statement: 'Pour les professionnels de l\'immobilier, Keystone embarque une suite dédiée : rédaction d\'annonces, studio VEFA, notices descriptives et contrats de réservation — des documents normés produits en minutes au lieu d\'heures.' } },
    { type: 'rule', title: 'Vos données restent les vôtres', body: {
      rule: 'Le savoir saisi dans Keystone appartient à son propriétaire : les agents publics ne révèlent jamais le coffre de fiches, et les questions des visiteurs ne sont pas rattachées à leur identité puis sont effacées après 90 jours.',
      rationale: 'La confiance est la condition de tout le reste — c\'est une règle de conception, pas une option.' } },
    { type: 'qa', title: 'Combien ça coûte ?', body: {
      question: 'Combien coûte Keystone OS ?',
      answer: 'Keystone fonctionne par abonnement tout compris — les outils et l\'IA sont inclus, sans facturation à la consommation. Le produit est actuellement en bêta accompagnée : l\'équipe construit l\'offre avec les premiers utilisateurs. Le mieux est de demander un accès pour en discuter directement.' } },
    { type: 'qa', title: 'Faut-il installer quelque chose ?', body: {
      question: 'Faut-il installer un logiciel pour utiliser Keystone ?',
      answer: 'Non : tout fonctionne dans le navigateur, sur ordinateur comme sur téléphone, et l\'application peut s\'épingler comme une app mobile. Vos clients, eux, n\'ont besoin de rien du tout — un lien ou un QR code suffit.' } },
    { type: 'objection', title: 'Objection : « Encore un abonnement de plus »', body: {
      objection: 'C\'est encore un abonnement qui s\'ajoute aux autres.',
      response: 'C\'est l\'inverse : Keystone en remplace plusieurs — rédaction, publication multi-réseaux, QR codes, formulaires, assistant client — par un seul, IA comprise. Une seule facture, une seule interface à apprendre.',
      proof: 'Faites le compte de vos outils actuels et de leurs abonnements respectifs : la comparaison se gagne vite.' } },
    { type: 'objection', title: 'Objection : « J\'ai déjà ChatGPT »', body: {
      objection: 'J\'utilise déjà ChatGPT, pourquoi Keystone ?',
      response: 'ChatGPT est un généraliste brillant qui repart de zéro à chaque conversation — et il peut inventer. Les outils Keystone sont câblés sur VOTRE activité : votre agent répond uniquement depuis votre savoir validé (jamais d\'invention face à un client), vos posts partent réellement sur vos réseaux, vos documents suivent les gabarits de votre métier. L\'un inspire, l\'autre travaille pour vous.' } },
    { type: 'objection', title: 'Objection : « Pas le temps de mettre ça en place »', body: {
      objection: 'Je n\'ai pas le temps d\'installer et de paramétrer un outil de plus.',
      response: 'C\'est justement le terrain de jeu de Keystone : pas d\'installation, et un agent métier opérationnel en une demi-heure grâce aux packs — fiches de savoir-faire prêtes à relire et interview guidée à laquelle on répond à l\'oral. La bêta est accompagnée : vous n\'êtes pas seul devant l\'outil.',
      proof: 'Cette démonstration a elle-même été montée avec un pack métier.' } },
    { type: 'case', title: 'Exemple : un lieu culturel met son guide en ligne', body: {
      situation: 'Un musée veut répondre aux questions récurrentes des visiteurs (horaires, règles, parcours) sans mobiliser l\'accueil en permanence.',
      action: 'Création d\'un agent avec le pack « Gardien de musée », interview guidée pour le savoir propre au lieu, validation des fiches, puis QR code imprimé à l\'entrée.',
      result: 'Les visiteurs posent leurs questions au QR — à l\'écrit ou à la voix — et chaque question sans réponse remonte à l\'équipe, qui enrichit l\'agent en quelques minutes par semaine. L\'accueil respire, le savoir s\'accumule.' } },
  ];
  let n = 0;
  for (const f of fiches) {
    await api('/kortex/units', { type: f.type, title: f.title, body: f.body, status: 'validated',
      source_kind: 'manual', source_ref: 'demo:keystone', agent_id: A });
    n++; console.log(`   ✓ ${n}/${fiches.length} — ${f.title}`);
  }

  console.log('3/4 — Tests étalons…');
  const golden = [
    { question: 'Que fait Smart Agent ?',                          expect: 'answer'   },
    { question: 'Quels réseaux sociaux Social Manager gère-t-il ?', expect: 'answer'   },
    { question: 'Combien coûte Keystone ?',                         expect: 'answer'   },
    { question: 'Pouvez-vous me rédiger mon contrat de mariage ?',  expect: 'fallback' },
  ];
  for (const g of golden) { await api(`/agents/${A}/golden`, g); console.log('   ✓', g.question); }

  console.log('4/4 — Terminé ✓');
  console.log(`➡ Ouvrez le pad Smart Agent → « ${NAME} » → onglet Tester.`);
  console.log('➡ Pour la démo publique : Réglages → « Publier cet agent » → QR/lien.');
  console.log('   (Astuce : lancez aussi « Rejouer » dans les Tests étalons pour montrer le garde-fou anti-invention.)');
})();
