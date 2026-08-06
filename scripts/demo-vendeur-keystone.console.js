/* ═══════════════════════════════════════════════════════════════
   DÉMO — « Conseiller Keystone » : l'agent vendeur embarqué dans la
   landing (section « Smart Agent », iframe /agent?s=…&embed=1).

   MODE D'EMPLOI (1 minute) :
     1. Ouvrez https://protein-keystone.com/app et CONNECTEZ-VOUS.
     2. Console du navigateur (Cmd+Option+J), collez :
          import('/scripts/demo-vendeur-keystone.console.js')
     3. Le script demande confirmation, puis republie l'agent.

   CE QUE FAIT LE SCRIPT — mise à jour COMPLÈTE, pas un ajout :
     • recale la persona (accueil, mission, repli) ;
     • TABLE RASE du savoir : supprime les fiches et les tests
       étalons existants de l'agent — sinon une vieille fiche
       (« bêta », « sans facturation à la consommation », suite VEFA)
       contredirait les nouvelles et l'agent pourrait citer la
       mauvaise ;
     • repose le savoir à jour : 14 applications, Kora, la vraie
       grille tarifaire, souveraineté, objections, cas d'usage ;
     • pose les CARTES-PHOTOS : une capture par application en haut
       de la page publique. Le visiteur touche une image, l'agent
       présente l'outil. C'est le catalogue visuel de la démo.
     • republie.

   RELANÇABLE. Le lien public NE CHANGE PAS : publier réutilise le
   lien actif (worker, handleAgentPublish) — la landing pointe sur
   /a/Vtg9eJfs et le compteur de questions est conservé. Les images
   déjà envoyées sont réutilisées (repérées par le titre de la
   carte), donc relancer n'encombre pas le stockage.

   SOURCES DE VÉRITÉ recopiées ici — à resynchroniser si elles
   bougent : index.html (pitchs des 14 outils + bloc PLANS_V2) et
   app/lib/pricing.js (TIERS, APP_TIER).
   ═══════════════════════════════════════════════════════════════ */
(async () => {
  const API  = 'https://keystone-os-api.keystone-os.workers.dev/api/smart-agent';
  const NAME = 'Conseiller Keystone';
  const jwt  = localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token');
  if (!jwt) { console.error('⛔ Connectez-vous au dashboard d\'abord (aucun jeton trouvé).'); return; }

  // Incident du 06/08 : sur 38 suppressions d'affilée, UNE a rendu 500. Le
  // navigateur ne montre même pas le 500 — une réponse d'erreur sans en-tête
  // CORS est signalée comme « Access-Control-Allow-Origin », ce qui envoie
  // chercher un problème d'origine qui n'existe pas. Résultat : la table rase
  // s'est arrêtée à mi-chemin et la démo de la landing a servi un savoir à
  // trous jusqu'à la relance.
  //
  // On réessaie donc les appels IDEMPOTENTS (GET, DELETE) : les rejouer ne
  // peut rien abîmer. Les POST, eux, ne sont JAMAIS rejoués — une création
  // dont seule la réponse s'est perdue ferait un doublon de fiche. Pour
  // ceux-là, le filet reste la relance du script, qui reprend où il en est.
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const api = async (path, body, method) => {
    const verb = method || (body ? 'POST' : 'GET');
    const rejouable = (verb === 'GET' || verb === 'DELETE');
    let dernier;
    for (let essai = 1; essai <= (rejouable ? 3 : 1); essai++) {
      try {
        const res = await fetch(API + path, {
          method: verb,
          headers: { 'Authorization': 'Bearer ' + jwt, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data;
        const e = new Error(data.error || ('HTTP ' + res.status));
        // 4xx = refus argumenté du worker (« introuvable », droits…) : le
        // rejouer donnera exactement la même réponse. On le marque définitif
        // AVANT de le lancer — sinon le catch ci-dessous, qui ne voit qu'un
        // message métier (« Fiche introuvable », sans code), le rejouerait
        // trois fois pour rien et `wipe` mettrait une plombe à passer.
        e.definitif = (res.status < 500);
        throw e;
      } catch (e) {
        // Panne réseau OU 500 sans CORS : le navigateur rend « Load failed »
        // sans qu'on puisse lire le corps. Indiscernables ici, et tous deux
        // transitoires — donc traités pareil.
        if (e.definitif || !rejouable) throw e;
        dernier = e;
      }
      if (essai < 3) { console.warn(`   ↻ ${verb} ${path} — ${dernier.message}, nouvel essai (${essai}/2)`); await sleep(400 * essai); }
    }
    throw dernier;
  };
  // Envoi d'une image (multipart) → { key, url }. La carte elle-même est
  // ensuite enregistrée dans config.cards avec cette clé.
  const upload = async (agentId, blob, filename) => {
    const fd = new FormData();
    fd.append('file', blob, filename);
    const res = await fetch(`${API}/agents/${agentId}/cards/image`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + jwt }, body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data.key;
  };

  // ── PERSONA ────────────────────────────────────────────────────
  const IDENTITY = {
    role:    'conseiller Keystone OS',
    mission: 'Présenter Keystone OS et ses 14 applications aux professionnels (commerces, artisans, lieux culturels, services, presse, immobilier), répondre à leurs questions sans jamais rien inventer, et les amener à essayer — en commençant par les applications gratuites ou en choisissant celle qui leur sert.',
    tone:    'chaleureux, concret et confiant',
    style:   'Tu parles comme un bon conseiller de terrain, pas comme une plaquette : phrases courtes, exemples concrets tirés des fiches, bénéfice avant la technique. Tu reformules le métier de ton interlocuteur (« Si je comprends bien, vous êtes… ») pour lui montrer les applications qui LE concernent — deux ou trois, jamais le catalogue entier. Quand l\'interlocuteur dit « oui » ou « montre-moi », tu apportes du NOUVEAU : un exemple, une étape concrète, une autre application — jamais la même réponse reformulée. Tes invitations sont des actions que le visiteur peut faire tout seul, maintenant : essayer une application gratuite, regarder la page d\'une application, te poser une autre question.',
    avoid:   'le jargon technique non expliqué, les promesses chiffrées absentes des fiches, dénigrer les concurrents, les pavés de texte, réciter les 14 applications d\'affilée, promettre une démonstration ou une suite que tu ne peux pas tenir (« je vous montre ensuite… »), redonner une réponse déjà donnée, présenter une application payante comme essayable gratuitement',
    objective: 'vendre',
    posture:   'proactif',
    // La mention « IA » ne vit PAS ici : elle est portée par le label officiel
    // UE en haut à gauche de la page publique. Rien dans le dialogue.
    opening: 'Bonjour !\nJe suis le conseiller Keystone.\nTouchez une application, ou dites-moi quel est votre métier.',
  };
  const SCOPE = {
    fallback_text: 'Bonne question — je n\'ai pas ce détail sous la main, et je préfère vous le dire plutôt que d\'inventer. L\'équipe Keystone vous répondra précisément. En attendant, je peux vous montrer le reste ?',
    fallback_variants: [
      'Là, vous me posez une question qui mérite une vraie réponse d\'équipe plutôt qu\'une approximation. Je la note ! Et sinon, voulez-vous voir ce que Keystone ferait pour votre métier ?',
      'Honnêtement, ce point précis dépasse ce que j\'ai en magasin — c\'est justement ma règle : je ne réponds que depuis ce qu\'on m\'a appris. Parlons de votre activité ?',
      'Je n\'ai pas cette information, et un agent qui invente ne vaut rien. Dites-moi plutôt ce que vous cherchez à régler, je vous montre l\'application qui s\'en charge.',
    ],
  };

  // ── LES 14 APPLICATIONS ────────────────────────────────────────
  // slug = /outils/shots/<slug>.webp (capture) + fiche + carte.
  // prix : app/lib/pricing.js (APP_TIER × TIERS).
  const APPS = [
    { slug: 'smart-agent', name: 'Smart Agent', prix: '99 €/mois', conv: '1 000 conversations',
      card: 'Smart Agent', q: 'Que fait Smart Agent ?',
      alt: 'Smart Agent en test : l\'agent répond à une question depuis le savoir validé',
      pitch: 'Smart Agent est votre jumeau numérique de savoir-faire : un agent qui répond à vos clients UNIQUEMENT depuis le savoir que vous avez validé — jamais d\'invention. S\'il ne sait pas, il le dit, et la question rejoint sa liste de travail pour que vous la combliez. Vous le nourrissez (texte collé, page web, fichier, interview guidée où vous répondez à l\'oral), vous le testez comme un client, puis vous le publiez par lien ou par QR code : vos visiteurs lui parlent sans compte, à l\'écrit ou à la voix, dans leur langue.',
      ctx: 'L\'application vitrine — c\'est elle qui fait tourner cette conversation. Des packs métier (vendeur, agent immobilier, gardien de musée, concierge, guide, SAV) le rendent opérationnel en une demi-heure.' },
    { slug: 'smart-qr', name: 'Smart Dynamic QR', prix: '49 €/mois', conv: '1 000 conversations',
      card: 'Smart Dynamic QR', q: 'Que fait Smart Dynamic QR ?',
      alt: 'Le Studio Smart Dynamic QR : destination modifiable et aperçu du QR',
      pitch: 'Smart Dynamic QR crée des QR codes à votre charte graphique dont la destination se change APRÈS l\'impression : le carton, l\'affiche ou l\'étiquette déjà posés continuent de servir, vous changez seulement ce qu\'il y a derrière. Les scans se mesurent (nombre, moment, lieu approximatif) sans dépendre de Google, et le même QR peut servir une campagne différente le mois suivant.',
      ctx: 'La passerelle du physique vers le numérique : un QR sur une vitrine, une chambre d\'hôtel ou un produit peut ouvrir directement un Smart Agent qui répond au visiteur.' },
    { slug: 'social-manager', name: 'Social Manager', prix: '49 €/mois', conv: '1 000 conversations',
      card: 'Social Manager', q: 'Que fait Social Manager ?',
      alt: 'Le composeur de Social Manager : un texte et les réseaux sociaux sélectionnés',
      pitch: 'Social Manager est votre régie de publication : vous écrivez une fois, vous publiez sur Facebook, Instagram, Threads et Telegram — tout de suite ou à l\'heure programmée. Le composeur vérifie les contraintes de chaque réseau AVANT l\'envoi, la file montre ce qui part et ce qui est parti, et en cas de pépin réseau l\'envoi se retente tout seul, uniquement sur les réseaux qui ont échoué — jamais de double publication.',
      ctx: 'Vos comptes se connectent officiellement, en deux clics : aucun mot de passe n\'est confié à Keystone.' },
    { slug: 'ghost-writer', name: 'Ghost Writer', prix: '19 €/mois', conv: '300 conversations',
      card: 'Ghost Writer', q: 'Que fait Ghost Writer ?',
      alt: 'Ghost Writer : trois variantes réécrites d\'un même texte',
      pitch: 'Ghost Writer, c\'est deux outils en un. La réécriture transforme un texte en trois variantes calibrées (e-mail professionnel, communication interne, marketing, texte long) : vous choisissez le ton, vous copiez, c\'est envoyé. Le correcteur vérifie orthographe, grammaire, accords et conjugaison — et il travaille entièrement sur votre appareil, y compris directement sur un PDF : le document ne part jamais sur Internet.',
      ctx: 'Le maillon « rédaction » de la chaîne de contenu : Brainstorming trouve l\'idée, Ghost Writer écrit, Social Manager publie.' },
    { slug: 'brainstorming', name: 'Brainstorming', prix: '19 €/mois', conv: '300 conversations',
      card: 'Brainstorming', q: 'Que fait Brainstorming ?',
      alt: 'Une séance Brainstorming : plusieurs IA spécialisées débattent d\'un brief en direct',
      pitch: 'Brainstorming, c\'est votre salle de réunion d\'idées : plusieurs personnalités IA spécialisées (le créatif, l\'analytique, l\'avocat du diable…) débattent en direct de votre sujet, vous orientez la conversation à la volée, et une synthèse structurée tranche à la fin — elle ne se contente pas de résumer, elle recommande.',
      ctx: 'Son mode « Idées de posts » alimente directement Ghost Writer puis Social Manager.' },
    { slug: 'key-form', name: 'Key Form', prix: '19 €/mois', conv: '300 conversations',
      card: 'Key Form', q: 'Que fait Key Form ?',
      alt: 'Key Form : la structure du formulaire à gauche, l\'aperçu mobile à droite',
      pitch: 'Key Form construit des formulaires que l\'on partage par un simple lien : 17 types de questions, des questions qui n\'apparaissent que si la précédente l\'exige, et les réponses qui vous arrivent par e-mail. Vos questions à gauche, le formulaire qui se dessine à droite en direct.',
      ctx: 'Déjà utilisé en vrai : des artistes y déposent biographie et œuvres pour une exposition.' },
    { slug: 'key-brand', name: 'Key Brand', prix: '19 €/mois', conv: '300 conversations',
      card: 'Key Brand', q: 'Que fait Key Brand ?',
      alt: 'Une charte Key Brand : la palette de couleurs avec nuanciers et codes copiables',
      pitch: 'Key Brand transforme votre charte graphique en mini-site interactif : le logo se télécharge au bon format, les couleurs se copient d\'un clic avec leurs contrastes déjà vérifiés, les typographies s\'essaient, et les règles d\'usage se génèrent avec votre logo. Une charte par marque, partageable d\'un lien — toujours à jour, sans PDF qui traîne dans une boîte mail.',
      ctx: 'C\'est ce qu\'on envoie à un imprimeur, un graphiste ou un nouveau collaborateur au lieu d\'un PDF de 40 pages périmé.' },
    { slug: 'network', name: 'networK', prix: '19 €/mois', conv: '300 conversations',
      card: 'networK', q: 'Que fait networK ?',
      alt: 'networK : la carte mentale des relations avec une fiche contact ouverte',
      pitch: 'networK est votre réseau relationnel vivant, pas un carnet d\'adresses de plus : vous êtes au centre, et vos relations se déploient en carte mentale, dans des catégories libres (Clients, Fournisseurs, Partenaires…). Chaque contact ouvre une fiche — coordonnées, rôles, notes, et un journal d\'activité qui raconte votre relation. Et depuis cette fiche, « Continuer avec… » ouvre une Missive, un Brief ou votre Smart Agent avec le contact déjà en contexte : vous ne ressaisissez rien.',
      ctx: 'Tout vous appartient, rien n\'est publié, aucune aspiration de contacts.' },
    { slug: 'brief-prod', name: 'Brief Prod', prix: '49 €/mois', conv: '1 000 conversations',
      card: 'Brief Prod', q: 'Que fait Brief Prod ?',
      alt: 'Brief Prod : choix du format et du pli avec schéma technique',
      pitch: 'Brief Prod transforme une intention créative en cahier des charges technique que votre graphiste ou votre imprimeur ne peut pas mal comprendre : l\'assistant pose les bonnes questions (format, pli, papier, finitions) et bâtit le document. C\'est ce qui évite l\'erreur d\'impression à 800 € découverte à la livraison.',
      ctx: 'Pour tous ceux qui commandent de l\'imprimé sans être du métier.' },
    { slug: 'sentinel', name: 'Sentinel', prix: '49 €/mois', conv: '1 000 conversations',
      card: 'Sentinel', q: 'Que fait Sentinel ?',
      alt: 'Le cockpit Sentinel : disponibilité, score global et temps de réponse suivis',
      pitch: 'Sentinel surveille vos sites en continu (en ligne ou hors ligne, temps de réponse), les note sur plusieurs axes — disponibilité, rapidité, référencement, sécurité, accessibilité, présence locale — et livre des correctifs clé en main : les étapes exactes pour votre plateforme et le code prêt à coller. Sa fonction phare : savoir si les IA (ChatGPT, Perplexity, Gemini) citent votre établissement quand un prospect les interroge.',
      ctx: 'Argument fort en 2026 : beaucoup de clients ne cherchent plus sur Google mais demandent à une IA — être absent de ses réponses est le nouveau « ne pas être référencé ».' },
    { slug: 'desk', name: 'desK', prix: '49 €/mois', conv: '1 000 conversations',
      card: 'desK', q: 'Que fait desK ?',
      alt: 'desK : le chemin de fer d\'un numéro en grille de planches',
      pitch: 'desK est le chemin de fer vivant d\'une revue : chaque page du numéro devient une carte dans une grille partagée par toute l\'équipe — le chemin de fer papier au mur, en version qui se met à jour toute seule. Chaque article affiche sa marge réelle avant le bouclage : tant qu\'elle tient, rien ne s\'allume ; quand elle se consume, la carte passe à l\'ambre puis au rouge et vous tend la décision — relancer le contributeur, ou basculer sur un remplaçant préparé d\'avance.',
      ctx: 'Pour la presse et l\'édition périodique. La maquette reste dans InDesign : desK est le cockpit autour. Les contributeurs, eux, ne changent rien à leurs habitudes — ils restent dans l\'e-mail.' },
    { slug: 'missive', name: 'Missive', prix: 'gratuit', conv: 'sans intelligence artificielle',
      card: 'Missive · gratuit', q: 'Que fait Missive ?',
      alt: 'Création d\'une missive : le secret est chiffré sur l\'appareil avant l\'envoi',
      pitch: 'Missive transmet un secret — mot de passe, code, information sensible — qui se lit une seule fois puis s\'autodétruit. Le contenu est chiffré sur votre appareil : même nous ne pouvons pas le lire. Vous partagez un lien (ou un QR, ou une puce NFC) et, par un autre canal, un code de déverrouillage. Au-delà de quelques essais ratés, la missive meurt définitivement.',
      ctx: 'GRATUITE, sans limite de durée. C\'est l\'alternative propre au mot de passe envoyé par SMS ou par e-mail, qui reste ensuite dans la boîte de tout le monde.' },
    { slug: 'book', name: 'booK', prix: 'gratuit', conv: 'sans intelligence artificielle',
      card: 'booK · gratuit', q: 'Que fait booK ?',
      alt: 'Un flipbook booK ouvert en lecture : la couverture d\'un catalogue',
      pitch: 'booK transforme un PDF ou des images en livre que l\'on feuillette à l\'écran — et votre publication tient dans UN SEUL fichier autonome. Ce fichier s\'ouvre d\'un double-clic, partout, pour toujours : sans serveur, sans abonnement, sans filigrane, sans même dépendre de Keystone. Envoyez-le par e-mail, posez-le derrière un QR, archivez-le sur une clé USB — il vous appartient. Et il reste modifiable : ré-importez-le dans booK des années plus tard, il redevient éditable.',
      ctx: 'GRATUITE, sans limite de durée. Le meilleur argument de réversibilité du catalogue : ce que vous produisez survit à Keystone.' },
    { slug: 'keynapse', name: 'Keynapse', prix: 'gratuit', conv: 'cœur sans intelligence artificielle',
      card: 'Keynapse · gratuit', q: 'Que fait Keynapse ?',
      alt: 'Le canevas Keynapse : des bulles de notes reliées, regroupées par zones de couleur',
      pitch: 'Keynapse est votre espace personnel de connaissances : des bulles de notes qui respirent sur un canevas infini, regroupées en zones de couleur et reliées par des traits. Chaque bulle s\'ouvre dans un panneau où vous écrivez, cochez des tâches, attachez photos, croquis et mémos vocaux, et posez des rappels qui vous préviennent à l\'heure dite.',
      ctx: 'GRATUITE, sans limite de durée. Vos notes restent privées : rien n\'est publié.' },
  ];

  // ── LE SAVOIR ──────────────────────────────────────────────────
  const SOCLE = [
    { type: 'fact', title: 'Keystone OS en une phrase', body: {
      statement: 'Keystone OS réunit vos outils métier dans un seul écran : répondre à vos clients, publier, écrire, relancer, surveiller votre visibilité. Vous n\'activez que les applications utiles à VOTRE métier — comme des applications sur un téléphone — et tout fonctionne dans le navigateur, sans rien installer. Il y a aujourd\'hui 14 applications.',
      context: 'Réponse à « c\'est quoi Keystone ? » — la vue d\'ensemble avant de détailler une application.' } },
    { type: 'fact', title: 'Le principe : un seul écran, vos applications à vous', body: {
      statement: 'Chacun compose son tableau de bord depuis le K-Store, la boutique intégrée : un commerçant n\'a pas les mêmes applications qu\'une rédaction de magazine. Une seule interface, une seule connexion, une seule courbe d\'apprentissage — au lieu de six abonnements et six mots de passe. Retirer une application ne perd jamais votre travail : elle revient avec ses données quand vous la réactivez.' } },
    { type: 'fact', title: 'Kora, l\'assistante qui pilote tout l\'écran', body: {
      statement: 'Kora est l\'assistante intégrée à Keystone : le galet qui ondule en haut de la fenêtre, c\'est elle. Vous lui parlez ou vous lui écrivez en langage courant — « publie ce post », « prépare une missive pour Paul », « où en sont mes scans ? » — et elle pilote vos applications à votre place. C\'est la différence entre une boîte à outils et un vrai système : vous n\'avez plus à savoir dans quel outil se trouve la fonction, vous demandez.',
      context: 'Nouveauté majeure depuis les premières versions. C\'est souvent l\'argument qui fait basculer quelqu\'un qui trouve « qu\'il y a beaucoup d\'outils ».' } },
    { type: 'fact', title: 'Le Living Layer : votre activité en direct', body: {
      statement: 'Le Living Layer est la bande vivante en haut du tableau de bord. Au lieu d\'un écran figé, elle fait remonter de vrais signaux : les questions auxquelles votre agent n\'a pas su répondre, les réponses reçues à vos formulaires, les rappels qui arrivent à échéance, les alertes de visibilité, les QR les plus scannés. Une alerte importante reste affichée tant qu\'elle n\'est pas traitée.',
      context: 'C\'est ce qui transforme Keystone d\'une boîte à outils en poste de pilotage : il vous dit quoi faire ensuite.' } },
    { type: 'fact', title: 'Les applications se parlent entre elles', body: {
      statement: 'C\'est tout l\'intérêt d\'un seul écran : Brainstorming fait émerger l\'idée, Ghost Writer la rédige, Social Manager la publie — sans changer d\'outil. Un QR posé sur une vitrine ouvre un Smart Agent qui répond au visiteur. Depuis une fiche contact de networK, vous ouvrez une Missive ou un Brief déjà en contexte. Un numéro bouclé dans desK devient un livre feuilletable dans booK. Les couleurs définies dans Key Brand habillent les supports produits ailleurs.',
      context: 'L\'argument central face à quelqu\'un qui jongle avec six abonnements séparés qui ne communiquent pas.' } },
    { type: 'fact', title: 'Rien à installer, rien à demander à vos clients', body: {
      statement: 'Keystone est une application web : rien à télécharger sur un store, ni sur ordinateur ni sur téléphone. Elle s\'épingle sur l\'écran d\'accueil et s\'ouvre alors comme une vraie application. Et vos clients, eux, n\'ont besoin de rien du tout : un lien ou un QR code suffit, sans compte, sans installation.' } },
  ];

  const PRIX = [
    { type: 'fact', title: 'Comment Keystone se vend : gratuit, à la carte, ou l\'OS complet', body: {
      statement: 'Trois manières d\'entrer. 1) GRATUIT, pour toujours et sans carte bancaire : trois applications complètes — Missive, booK et Keynapse. 2) À LA CARTE : vous payez uniquement l\'application qui vous sert, 19, 49 ou 99 € par mois selon l\'application, complète dès le premier jour. Plusieurs applications ? Leurs conversations s\'additionnent. 3) L\'OS COMPLET à 129 € par mois : les 14 applications, nouveautés comprises, et elles communiquent entre elles — soit environ 9 € par application.',
      context: 'LA fiche à sortir sur toute question de prix. Les prix sont affichés publiquement sur le site.' } },
    { type: 'qa', title: 'Combien coûte Keystone ?', body: {
      question: 'Combien coûte Keystone OS ?',
      answer: 'Ça dépend de ce dont vous avez besoin, et vous pouvez commencer sans payer. Trois applications sont gratuites pour toujours, sans carte bancaire. Ensuite, à la carte : 19 €, 49 € ou 99 € par mois selon l\'application. Et si vous voulez tout, l\'OS complet est à 129 € par mois — soit environ 9 € par application, avec tout ce qui sortira ensuite. Dites-moi votre métier, je vous dis ce qui vous servirait vraiment.' } },
    { type: 'fact', title: 'Les trois applications gratuites', body: {
      statement: 'Missive (un secret qui se lit une fois puis s\'autodétruit), booK (vos PDF en livres feuilletables, dans un fichier qui vous appartient) et Keynapse (vos idées en bulles reliées, avec rappels) sont complètes et gratuites, sans limite de durée et sans carte bancaire. Ce ne sont pas des versions bridées : ce sont les applications entières.',
      context: 'La bonne réponse à « je veux voir avant de payer » : on ne propose pas un essai de 14 jours, on propose trois applications pour toujours.' } },
    { type: 'fact', title: 'Les conversations : ce qui consomme, ce qui est gratuit', body: {
      statement: 'Les fonctions d\'intelligence artificielle puisent dans une enveloppe mensuelle INCLUSE dans l\'abonnement : 300 conversations avec une application à 19 €, 1 000 avec une application à 49 ou 99 €, 3 000 avec l\'OS complet. Elle se remet à zéro chaque mois et vous la suivez dans vos réglages. Beaucoup d\'actions ne consomment rien : lecture vocale, correcteur d\'orthographe, navigation, et tout ce qui ne fait pas appel à l\'IA. Les trois applications gratuites, elles, fonctionnent sans intelligence artificielle — il n\'y a donc rien à consommer.',
      context: 'Une « conversation » = une question posée à un agent, une extraction de fiches, une réécriture. Le compteur est un garde-fou contre les abus, pas un piège à facture.' } },
    { type: 'fact', title: 'Vous pouvez brancher votre propre clé IA', body: {
      statement: 'Si vous avez déjà un compte chez un fournisseur d\'intelligence artificielle (Claude, GPT, Mistral…), vous pouvez brancher votre propre clé dans Keystone : l\'usage devient illimité et le coût se règle directement chez votre fournisseur, pas chez nous. C\'est utile quand un agent public reçoit beaucoup de trafic.',
      context: 'À sortir quand quelqu\'un s\'inquiète du plafond de conversations, ou quand il tient à choisir son moteur.' } },
  ];

  const QUOTIDIEN = [
    { type: 'procedure', title: 'Comment on démarre, concrètement', body: {
      goal: 'Passer de « ça m\'intéresse » à « je travaille avec » — sans installation et sans engagement.',
      steps: [
        'Créez votre compte sur protein-keystone.com — deux minutes, sans carte bancaire.',
        'Votre tableau de bord s\'ouvre : ajoutez une application gratuite depuis le K-Store (Missive, booK ou Keynapse) et servez-vous-en pour de vrai.',
        'Quand une application payante vous fait envie, activez-la : elle est complète dès le premier jour, l\'intelligence artificielle est comprise.',
        'Épinglez Keystone sur votre écran d\'accueil (mobile ou ordinateur) : il s\'ouvre ensuite comme une vraie application.',
      ],
    } },
    { type: 'case', title: 'Keystone au quotidien : une semaine type', body: {
      situation: 'Un professionnel veut savoir à quoi ressemble Keystone une fois intégré à sa routine — pas la liste des fonctions, la vraie vie.',
      action: 'Le lundi, dix minutes : Brainstorming sort les idées de la semaine, Ghost Writer rédige, Social Manager programme les posts. Le reste de la semaine, Keystone travaille seul : le Smart Agent répond aux questions des clients, les QR en vitrine comptent leurs scans, les formulaires collectent les réponses. Chaque matin, un coup d\'œil au Living Layer en haut du tableau de bord : ce qui a été demandé, scanné, reçu — et ce qu\'il reste à faire.',
      result: 'L\'outil s\'efface derrière la routine : quelques minutes par jour pour piloter, et les questions répétitives, la publication et le suivi ne reposent plus sur une seule personne.' } },
  ];

  const CONFIANCE = [
    { type: 'rule', title: 'Gratuit ne concerne QUE trois applications', body: {
      rule: 'Seules Missive, booK et Keynapse sont gratuites. Toutes les autres applications (desK, Smart Agent, Social Manager, Sentinel, Ghost Writer, Brainstorming, Key Form, Key Brand, networK, Brief Prod, Smart Dynamic QR) sont payantes : ne jamais les présenter comme essayables « sans carte bancaire ». La bonne formulation pour une application payante : « complète dès le premier jour, à tel prix par mois » — et proposer les trois gratuites à qui veut d\'abord se faire la main sur Keystone.',
      rationale: 'Annoncer un essai gratuit qui n\'existe pas détruit la confiance au moment exact où le prospect vérifie.' } },
    { type: 'rule', title: 'Vos données restent les vôtres', body: {
      rule: 'Le savoir saisi dans Keystone appartient à son propriétaire. Un agent publié ne révèle jamais son coffre de fiches, ni ses sources : le visiteur voit le nom de l\'agent, son métier et ses réponses, rien d\'autre. Les questions posées ne sont pas rattachées à l\'identité du visiteur et sont effacées après 90 jours.',
      rationale: 'La confiance est la condition de tout le reste — c\'est une règle de conception, pas une option commerciale.' } },
    { type: 'fact', title: 'Souveraineté : hébergé en Europe, édité en France', body: {
      statement: 'Vos données sont hébergées en Europe et le traitement est conforme au RGPD. L\'éditeur est une société française identifiée. Keystone est conçu « local d\'abord » : vos données de travail et vos clés restent dans votre navigateur, sur votre appareil ; seul votre profil (prénom, photo, préférences) est synchronisé, et il est chiffré. Certains traitements ne quittent même jamais votre poste : le correcteur d\'orthographe et la lecture d\'un PDF, par exemple.',
      context: 'Argument de vente à part entière face aux suites américaines — et sujet sensible pour les professions réglementées et les collectivités.' } },
    { type: 'fact', title: 'Rien ne vous enferme', body: {
      statement: 'Chaque application permet d\'exporter ses propres données, et un droit à l\'oubli permet de tout effacer. Le meilleur exemple est booK : le livre que vous produisez tient dans un fichier autonome qui s\'ouvre partout, sans serveur et sans abonnement — il continue de fonctionner même si vous quittez Keystone.',
      context: 'Réponse honnête et vérifiable à « et si vous fermez demain ? ».' } },
  ];

  const OBJECTIONS = [
    { type: 'objection', title: 'Objection : « Encore un abonnement de plus »', body: {
      objection: 'C\'est encore un abonnement qui s\'ajoute à tous les autres.',
      response: 'C\'est l\'inverse : Keystone en remplace plusieurs — rédaction, publication sur les réseaux, QR codes, formulaires, agent qui répond aux clients, charte de marque — par un seul, intelligence artificielle comprise. Une seule facture, une seule interface à apprendre. Et vous pouvez ne prendre qu\'une application si une seule vous sert.',
      proof: 'Faites le compte de vos outils actuels et de leurs abonnements : l\'OS complet est à 129 € pour 14 applications, soit environ 9 € chacune.' } },
    { type: 'objection', title: 'Objection : « J\'ai déjà ChatGPT »', body: {
      objection: 'J\'utilise déjà ChatGPT, pourquoi Keystone ?',
      response: 'ChatGPT est un généraliste brillant qui repart de zéro à chaque conversation — et il peut inventer. Les applications Keystone sont câblées sur VOTRE activité : votre agent ne répond que depuis votre savoir validé, donc jamais d\'invention face à un client ; vos posts partent réellement sur vos réseaux ; vos QR se mettent à jour ; vos rappels sonnent. L\'un vous inspire, l\'autre travaille pour vous.',
      proof: 'Demandez à ChatGPT de publier votre post de jeudi sur Instagram à 18 h : il vous écrira le texte, et c\'est vous qui le publierez.' } },
    { type: 'objection', title: 'Objection : « Pas le temps de mettre ça en place »', body: {
      objection: 'Je n\'ai pas le temps d\'installer et de paramétrer un outil de plus.',
      response: 'Il n\'y a rien à installer, et vous pouvez commencer par une application gratuite en deux minutes. Pour le Smart Agent, qui est le plus long à nourrir, des packs métier fournissent des fiches prêtes à relire et une interview guidée à laquelle vous répondez à l\'oral : une demi-heure suffit pour un agent opérationnel. Et Kora vous évite d\'apprendre où se trouvent les fonctions : vous les demandez.',
      proof: 'Cette démonstration a elle-même été montée à partir d\'un pack métier.' } },
    { type: 'objection', title: 'Objection : « Je ne suis pas à l\'aise avec la technique »', body: {
      objection: 'Je ne suis pas très à l\'aise avec l\'informatique, ça a l\'air compliqué.',
      response: 'Tout se passe dans votre navigateur, comme un site web, et chaque application a sa notice accessible par le bouton « ? ». Surtout, vous pouvez parler à Kora en langage courant plutôt que de chercher un bouton. Et si vous ne devez retenir qu\'une chose : commencez par une application gratuite, sans carte bancaire, sans engagement.',
      proof: 'Vos clients, eux, n\'ont strictement rien à apprendre : ils scannent un QR ou cliquent sur un lien.' } },
    { type: 'objection', title: 'Objection : « Une IA qui parle à mes clients, c\'est risqué »', body: {
      objection: 'J\'ai peur qu\'une intelligence artificielle raconte n\'importe quoi à mes clients.',
      response: 'C\'est exactement le problème que le Smart Agent règle, et c\'est son principe fondateur : il ne répond QUE depuis les fiches que vous avez validées, une par une. Hors de ce savoir, il ne brode pas — il dit qu\'il ne sait pas, et la question remonte dans sa liste de travail pour que vous la combliez. Vous pouvez aussi lui poser des « tests étalons » qui vérifient en un clic qu\'il répond là où il doit et qu\'il se tait là où il faut.',
      proof: 'Essayez : posez-moi une question qui n\'a rien à voir avec Keystone. Je vous dirai que je ne sais pas plutôt que d\'inventer.' } },
  ];

  const CAS = [
    { type: 'case', title: 'Exemple : un lieu culturel met son guide en ligne', body: {
      situation: 'Un musée veut répondre aux questions récurrentes des visiteurs (horaires, règles, parcours, œuvres) sans mobiliser l\'accueil en permanence.',
      action: 'Un agent est créé à partir du pack « Gardien de musée », complété par une interview guidée pour le savoir propre au lieu ; les fiches sont validées, puis un QR code est imprimé à l\'entrée. Des photos d\'œuvres sont posées en cartes : le visiteur touche une image et l\'agent raconte.',
      result: 'Les visiteurs interrogent le QR à l\'écrit ou à la voix, dans leur langue. Chaque question restée sans réponse remonte à l\'équipe, qui enrichit l\'agent en quelques minutes par semaine. L\'accueil respire et le savoir du lieu s\'accumule au lieu de se perdre.' } },
    { type: 'case', title: 'Exemple : un commerce qui communique seul', body: {
      situation: 'Une boutique doit publier régulièrement sur ses réseaux, mais la gérante n\'a ni le temps d\'écrire ni l\'envie de jongler entre quatre applications.',
      action: 'Brainstorming sort les idées de posts du mois, Ghost Writer les rédige dans le ton voulu, Social Manager les programme sur Facebook, Instagram et Threads. Un Smart Dynamic QR en vitrine renvoie vers l\'offre du moment — la destination change sans réimprimer l\'autocollant.',
      result: 'Une session d\'une heure alimente le mois, et le Living Layer signale au passage ce qui a été scanné et ce qui est parti.' } },
    { type: 'case', title: 'Exemple : une rédaction qui boucle son numéro', body: {
      situation: 'Une revue suit son chemin de fer sur un tableau blanc et un tableur, et découvre les retards trop tard.',
      action: 'desK reprend le numéro page par page dans une grille partagée par l\'équipe ; chaque article affiche sa marge réelle avant le bouclage et vire à l\'ambre puis au rouge quand elle se consume, avec un remplaçant préparé d\'avance.',
      result: 'Les décisions se prennent quand il est encore temps, les contributeurs ne changent rien à leurs habitudes, et le numéro bouclé devient un livre feuilletable dans booK.' } },
    { type: 'case', title: 'Exemple : un artisan qui veut exister dans les réponses des IA', body: {
      situation: 'Un professionnel constate que ses clients ne cherchent plus sur Google mais demandent à une intelligence artificielle — et il ignore si elle le cite.',
      action: 'Sentinel surveille son site (disponibilité, rapidité, référencement, sécurité) et vérifie régulièrement si ChatGPT, Perplexity et Gemini le mentionnent quand on les interroge sur son métier et sa ville.',
      result: 'Il voit son score évoluer dans le temps et reçoit des correctifs prêts à coller, avec les étapes exactes pour sa plateforme — au lieu d\'un audit illisible.' } },
  ];

  const QA = [
    { type: 'qa', title: 'Faut-il installer quelque chose ?', body: {
      question: 'Faut-il installer un logiciel pour utiliser Keystone ?',
      answer: 'Non : tout fonctionne dans le navigateur, sur ordinateur comme sur téléphone, et l\'application peut s\'épingler sur l\'écran d\'accueil pour s\'ouvrir comme une vraie app. Vos clients, eux, n\'ont besoin de rien du tout — un lien ou un QR code suffit.' } },
    { type: 'qa', title: 'Puis-je essayer avant de payer ?', body: {
      question: 'Est-ce qu\'on peut tester Keystone gratuitement ?',
      answer: 'Oui, et pas avec un essai de quinze jours : trois applications complètes sont gratuites pour toujours, sans carte bancaire — Missive, booK et Keynapse. Vous travaillez vraiment avec, et vous ajoutez une application payante seulement si elle vous sert.' } },
    { type: 'qa', title: 'Essayer gratuitement une application payante ?', body: {
      question: 'Puis-je essayer gratuitement desK, Smart Agent, Social Manager ou une autre application payante ?',
      answer: 'Non — les applications payantes n\'ont pas de période d\'essai : elles sont complètes dès le premier jour, à 19, 49 ou 99 € par mois selon l\'application, intelligence artificielle comprise. Pour vous faire la main gratuitement sur Keystone, commencez par le trio gratuit — Missive, booK et Keynapse — puis activez l\'application payante quand elle vous sert vraiment.' } },
    { type: 'qa', title: 'Mes clients doivent-ils créer un compte ?', body: {
      question: 'Est-ce que mes clients doivent s\'inscrire pour utiliser ce que je publie ?',
      answer: 'Jamais. Un agent publié, un formulaire, un QR, une missive ou un livre booK s\'ouvrent d\'un simple lien, sans compte et sans installation. C\'est vous qui avez un compte, pas eux.' } },
    { type: 'qa', title: 'Comment je commence ?', body: {
      question: 'Concrètement, par quoi je commence ?',
      answer: 'Par une application gratuite, ce soir, sans carte bancaire : c\'est la façon la plus honnête de se faire un avis. Ensuite, dites-moi votre métier — je vous dirai laquelle des applications payantes changerait vraiment votre quotidien, plutôt que de vous vendre les quatorze.' } },
    { type: 'qa', title: 'Combien d\'applications y a-t-il ?', body: {
      question: 'Il y a combien d\'outils dans Keystone ?',
      answer: 'Quatorze aujourd\'hui, et de nouvelles arrivent régulièrement — elles sont comprises dans l\'OS complet sans supplément. Mais personne n\'utilise les quatorze : chacun compose son écran avec les trois ou quatre qui servent à son métier.' } },
  ];

  // ═══════════════════════════════════════════════════════════════
  // EXÉCUTION
  // ═══════════════════════════════════════════════════════════════
  const FICHES = [
    ...SOCLE,
    ...APPS.map(a => ({ type: 'fact', title: `${a.name} — ce que fait l'application`, body: {
      statement: a.pitch,
      context: `${a.ctx} Tarif : ${a.prix}${a.prix === 'gratuit' ? '' : ` (${a.conv} par mois incluses)`}. Comprise dans l'OS complet à 129 €/mois.`,
    } })),
    ...PRIX, ...QUOTIDIEN, ...CONFIANCE, ...OBJECTIONS, ...CAS, ...QA,
  ];

  console.log(`Mise à jour de « ${NAME} » — ${FICHES.length} fiches, ${APPS.length} cartes-photos.`);

  // 1) L'agent (créé s'il n'existe pas encore).
  const { agents } = await api('/agents');
  let A = (agents || []).find(a => a.name === NAME)?.id;
  if (A) {
    console.log('1/7 — Agent trouvé :', A);
  } else {
    console.log('1/7 — Aucun agent « ' + NAME + ' » : création…');
    const { agent } = await api('/agents', { name: NAME, config: { identity: IDENTITY, scope: SCOPE } });
    A = agent.id;
    console.log('   ✓ créé', A);
  }

  // 2) Table rase du savoir — l'étape destructive, donc confirmée.
  const { units } = await api(`/kortex/units?agent=${A}`);
  const { golden: oldGolden } = await api(`/agents/${A}/golden`).catch(() => ({ golden: [] }));
  const nUnits = (units || []).length, nGold = (oldGolden || []).length;
  if (nUnits || nGold) {
    const ok = confirm(
      `Mise à jour du « ${NAME} » (démo de la landing).\n\n` +
      `À SUPPRIMER : ${nUnits} fiche(s) et ${nGold} test(s) étalon(s).\n` +
      `À POSER : ${FICHES.length} fiches à jour + ${APPS.length} cartes-photos.\n\n` +
      `Le lien public et le compteur de questions ne changent pas.\nContinuer ?`
    );
    if (!ok) { console.warn('⛔ Annulé — rien n\'a été touché.'); return; }
    console.log(`2/7 — Table rase : ${nUnits} fiche(s) + ${nGold} test(s)…`);
    // Une fiche déjà partie répond 404 « introuvable » : ce n'est pas un échec,
    // c'est le résultat voulu. Sans ce filet, UN seul 404 (relance concurrente,
    // liste un peu vieille) interrompait toute la table rase à mi-chemin.
    const wipe = async (path) => {
      try { await api(path, null, 'DELETE'); }
      catch (e) { if (!/introuvable/i.test(e.message)) throw e; }
    };
    // On re-liste jusqu'à coffre vide : la liste est plafonnée (500) et une
    // création concurrente peut en ajouter pendant qu'on vide.
    let left = units || [], tour = 0;
    while (left.length && tour++ < 10) {
      for (const u of left) await wipe(`/kortex/units/${u.id}`);
      ({ units: left } = await api(`/kortex/units?agent=${A}`));
      if (left.length) console.log(`   … ${left.length} fiche(s) encore là, second passage`);
    }
    if (left.length) throw new Error(`Coffre non vidé (${left.length} fiche(s) restantes) — relancez le script.`);
    for (const g of (oldGolden || [])) await wipe(`/golden/${g.id}`);
    const { golden: stillGold } = await api(`/agents/${A}/golden`).catch(() => ({ golden: [] }));
    for (const g of (stillGold || [])) await wipe(`/golden/${g.id}`);
    console.log('   ✓ coffre vidé');
  } else {
    console.log('2/7 — Coffre déjà vide, rien à supprimer.');
  }

  // 3) Persona recalée (merge non destructif côté worker).
  console.log('3/7 — Persona (accueil, mission, repli)…');
  await api(`/agents/${A}`, { config: { identity: IDENTITY, scope: SCOPE } }, 'PATCH');
  console.log('   ✓ à jour');

  // 4) Cartes-photos — une capture par application. Les images déjà
  //    envoyées sont réutilisées (repérage par titre) : relancer le
  //    script ne laisse pas d'images orphelines dans le stockage.
  console.log(`4/7 — Cartes-photos (${APPS.length})…`);
  const { agents: fresh } = await api('/agents');
  const known = new Map(((fresh || []).find(a => a.id === A)?.config?.cards || [])
    .filter(c => c && c.title && c.img).map(c => [c.title, c.img]));
  const cards = [];
  for (const a of APPS) {
    let key = known.get(a.card);
    if (key) {
      console.log(`   ↺ ${a.card} (image déjà en place)`);
    } else {
      const res = await fetch(`/outils/shots/${a.slug}.webp`);
      if (!res.ok) { console.warn(`   ⚠ capture introuvable : /outils/shots/${a.slug}.webp — carte ignorée`); continue; }
      key = await upload(A, await res.blob(), `${a.slug}.webp`);
      console.log(`   ✓ ${a.card}`);
    }
    cards.push({ img: key, q: a.q, alt: a.alt, title: a.card });
  }
  await api(`/agents/${A}`, { config: { cards } }, 'PATCH');
  console.log(`   ✓ ${cards.length} cartes en place`);

  // 5) Le savoir.
  console.log(`5/7 — Savoir : ${FICHES.length} fiches validées…`);
  let n = 0;
  for (const f of FICHES) {
    await api('/kortex/units', { type: f.type, title: f.title, body: f.body, status: 'validated',
      source_kind: 'manual', source_ref: 'demo:keystone', agent_id: A });
    n++; if (n % 5 === 0 || n === FICHES.length) console.log(`   ${n}/${FICHES.length}`);
  }

  // 6) Tests étalons — ils doivent couvrir le NOUVEAU savoir.
  console.log('6/7 — Tests étalons…');
  const golden = [
    { question: 'Que fait Smart Agent ?',                              expect: 'answer'   },
    { question: 'C\'est quoi Kora ?',                                   expect: 'answer'   },
    { question: 'Combien coûte Keystone ?',                             expect: 'answer'   },
    { question: 'Y a-t-il quelque chose de gratuit ?',                  expect: 'answer'   },
    { question: 'Est-ce que mes données restent en Europe ?',           expect: 'answer'   },
    { question: 'À quoi sert booK ?',                                   expect: 'answer'   },
    { question: 'Pouvez-vous me rédiger mon contrat de mariage ?',      expect: 'fallback' },
    { question: 'Quel est le chiffre d\'affaires de Keystone en 2025 ?', expect: 'fallback' },
  ];
  for (const g of golden) await api(`/agents/${A}/golden`, g);
  console.log(`   ✓ ${golden.length} tests`);

  // 7) Publication — réutilise le lien actif : l'URL ne bouge pas.
  console.log('7/7 — Publication…');
  const pub = await api(`/agents/${A}/publish`, {});
  console.log('══════════════════════════════════════════════');
  console.log('✓ DÉMO À JOUR — URL publique :');
  console.log('   ' + pub.url);
  console.log(`   ${FICHES.length} fiches · ${cards.length} cartes · ${golden.length} tests étalons`);
  console.log('→ Vérifiez que le slug est bien celui de la landing (index.html : /agent?s=…&embed=1).');
  console.log('→ Puis « Rejouer » dans les Tests étalons pour contrôler la santé de l\'agent.');
  console.log('══════════════════════════════════════════════');
})();
