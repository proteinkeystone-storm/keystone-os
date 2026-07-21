/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Documentation (guide d'utilisation, panneau Réglages)

   CONTENU pur (doctrine contenant/contenu) : ui-renderer.js importe
   `keystoneDocHTML()` et l'injecte dans l'accordéon « Documentation »
   du panneau Réglages. Éditer le guide = éditer CE fichier, sans
   toucher au renderer. Le rendu réutilise les variables de thème
   (--tx/--tx2/--tx3/--gold/--bd) → suit clair/sombre automatiquement.

   Pour ajouter/modifier une rubrique : éditez DOC_SECTIONS. Pour le
   fil des nouveautés : éditez DOC_CHANGELOG (le plus récent en tête).
   ═══════════════════════════════════════════════════════════════ */

// Rubriques du guide. body = HTML simple (p, ul/li, strong).
const DOC_SECTIONS = [
  {
    title: 'Qu\'est-ce que Keystone ?',
    body: `<p>Keystone réunit vos <strong>outils métier</strong> dans un seul espace de travail. Au lieu de jongler entre plusieurs applications et abonnements, vous activez ici uniquement ce dont vous avez besoin — comme des applications sur un téléphone.</p>
    <p>L'intelligence artificielle est <strong>incluse</strong> : pas de facturation à la consommation ni de jeton à racheter. Un compteur d'usage équitable évite les abus, et vous gardez la main sur vos données.</p>`,
  },
  {
    title: 'Votre tableau de bord',
    body: `<p>Vos outils apparaissent en <strong>tuiles</strong> sur l'accueil. Un clic ouvre l'outil en plein écran ; la flèche en haut à gauche vous ramène au tableau de bord.</p>
    <ul>
      <li><strong>Réorganiser</strong> : glissez-déposez les tuiles pour les ranger à votre goût.</li>
      <li><strong>Renommer ou retirer</strong> : appui long (mobile) ou clic droit (ordinateur) sur une tuile.</li>
    </ul>`,
  },
  {
    title: 'Ajouter ou retirer des outils',
    body: `<p>Le <strong>K-Store</strong> (bouton <em>+</em> ou l'icône boutique) liste tous les outils disponibles dans votre formule. Ouvrez-le pour ajouter un outil à votre tableau de bord, ou le retirer si vous ne l'utilisez plus — votre travail n'est jamais perdu, l'outil revient avec ses données quand vous le réactivez.</p>`,
  },
  {
    title: 'L\'aide de chaque outil',
    body: `<p>Chaque outil a sa propre notice : le bouton <strong>« ? »</strong> en haut à droite ouvre une fiche claire — à quoi il sert, comment s'en servir pas à pas, et les questions fréquentes. C'est le réflexe à avoir quand vous découvrez un outil.</p>`,
  },
  {
    title: 'Vos crédits IA',
    body: `<p>Les fonctions d'intelligence artificielle puisent dans un <strong>compteur mensuel</strong> inclus dans votre abonnement. Il se remet à zéro le 1<sup>er</sup> de chaque mois. Vous suivez votre consommation dans la section <strong>« Crédits IA »</strong> de ces réglages ; si besoin, un pack ponctuel peut être ajouté.</p>
    <p>Beaucoup d'actions sont <strong>gratuites</strong> : lecture vocale, dictée, navigation, et tout ce qui ne fait pas appel à l'IA.</p>`,
  },
  {
    title: 'Vos données & votre confidentialité',
    body: `<p>Keystone est conçu <strong>local d'abord</strong> : vos clés et vos données métier restent dans votre navigateur, sur votre appareil. Seul votre profil (prénom, photo, préférences) est synchronisé, <strong>chiffré</strong>, pour vous retrouver d'un appareil à l'autre.</p>
    <p>Le détail complet et le bouton « droit à l'oubli » sont dans la section <strong>« RGPD &amp; Données »</strong> ci-dessous.</p>`,
  },
  {
    title: 'Installer Keystone sur votre appareil',
    body: `<p>Keystone est une <strong>application web</strong> : rien à télécharger sur un store. Pour l'avoir à portée de main :</p>
    <ul>
      <li><strong>Sur mobile</strong> : menu du navigateur → « Ajouter à l'écran d'accueil ».</li>
      <li><strong>Sur ordinateur</strong> : icône d'installation dans la barre d'adresse, ou menu du navigateur → « Installer ».</li>
    </ul>
    <p>Une fois installée, elle s'ouvre comme une vraie app et reste consultable même <strong>hors connexion</strong> pour l'essentiel.</p>`,
  },
  {
    title: 'Les formules',
    body: `<p>Votre formule détermine les outils accessibles : <strong>Démo</strong> (découverte), <strong>Starter</strong>, <strong>Pro</strong> et <strong>Max</strong> (accès complet). Le badge coloré d'un outil dans le K-Store indique la formule requise. Votre statut, votre clé et votre renouvellement sont dans la section <strong>« Ma Licence »</strong>.</p>`,
  },
  {
    title: 'Besoin d\'aide ?',
    body: `<p>Une question, un imprévu, une idée ? L'équipe Keystone vous répond par e-mail depuis la section <strong>« Support »</strong> ci-dessous. Le support est prioritaire pour les formules Pro et Max.</p>`,
  },
];

// Fil des nouveautés (user-facing, le plus récent en tête). Volontairement
// non technique — les versions internes ne regardent pas l'utilisateur.
export const DOC_CHANGELOG = [
  { date: 'Juillet 2026', items: [
    'Smart Agent — les gros documents entrent enfin dans le coffre : jusqu\'ici, un import s\'arrêtait aux 8 premières pages. Désormais un manuel de plusieurs dizaines de pages est découpé automatiquement en lots, en suivant les titres du document, et vous le relisez lot par lot avec une barre de progression. Vous pouvez vous arrêter et reprendre plus tard sans rien perdre. Le nombre de lots et le coût en crédits vous sont annoncés AVANT de lancer quoi que ce soit — et rien n\'entre dans le coffre sans votre validation, comme toujours.',
    'Smart Agent — la relecture va plus vite : sur un import volumineux, chaque fiche proposée porte une pastille Fort / Moyen / Faible qui estime son utilité pour répondre aux questions, et les plus utiles sont présentées en premier. Rien n\'est filtré ni rejeté automatiquement : c\'est une aide au tri, vous restez seul juge.',
    'Smart Agent — des réponses plus justes : quand plusieurs fiches du coffre se ressemblent, l\'agent les repasse au crible pour citer la bonne, et une question courte ou vague qui ne trouvait rien bénéficie maintenant d\'une seconde tentative avant que l\'agent ne dise « je ne sais pas ».',
    'desK — pré-impression et édition numérique : avant de partir chez l\'imprimeur, confrontez votre PDF final (export InDesign) au chemin de fer d\'un clic — desK compare le nombre de pages et vérifie que chaque article se trouve bien sur sa page, puis conclut « prêt à imprimer » ou liste les points à revoir. Le PDF ne quitte jamais votre appareil (analyse locale). Et une fois le numéro bouclé, le même PDF devient un flipbook feuilletable dans booK : « Créer l\'édition numérique » ferme la boucle éditoriale.',
    'desK — les passerelles vers votre écosystème : depuis la fiche d\'un article, envoyez sa copie en relecture dans Ghost Writer (orthographe, typo, style) — au retour, marquez l\'article « relu » d\'un clic ; et proposez d\'ajouter son contributeur à votre réseau networK personnel (une suggestion, jamais une aspiration — votre réseau reste le vôtre). Le tableau de bord Keystone remonte désormais les signaux de desK juste sous votre nom : contributions à trier, copies en retard, bouclage qui approche — et la vignette du pad affiche l\'essentiel d\'un coup d\'œil.',
    'desK — le marbre et le chemin de fer en rangées : la frise devient une grille de planches qui reviennent à la ligne, comme le chemin de fer papier au mur, avec un curseur de taille des cartes à la InDesign. Une page peut désormais porter plusieurs articles (brèves, papier + encadré) ; sélectionnez plusieurs pages d\'un trait (Maj+clic) pour attribuer rubrique, contributeur ou un dossier étalé en un geste ; déplacez une ou plusieurs pages par insertion — tout le contenu coule, sauf les pages figées (une pub vendue « page 30 » reste page 30). Et le marbre s\'ouvre : la vue de votre stock d\'articles, filtrable, avec la fraîcheur (intemporel ou daté, péremption signalée) ; au passage du numéro en « imprimé », le rituel de bouclage marque les publiés et reverse au marbre les remplaçants non utilisés — rien ne se perd, tout se retrouve au numéro suivant. Les cartes portent désormais la couleur de leur rubrique (liseré en haut + fond teinté) pour une lecture d\'un seul coup d\'œil, et chaque rubrique se recolore librement dans les réglages — pipette ou code hexadécimal exact de la charte de votre revue.',
    'desK — le chemin de fer vivant de votre revue : chaque page du numéro devient une carte dans une frise partagée par l\'équipe, avec le rail des jalons (bouclage, maquette, imprimeur, parution) et la marge réelle de chaque article. Tant que la marge tient, rien ne s\'allume ; quand elle se consume, l\'ambre puis le rouge appellent une décision — relancer le contributeur ou basculer sur un remplaçant préparé au banc. Simulez un report de remise et voyez la date d\'impression réagir en direct. Pointez « copie reçue » en un clic, échangez deux pages en les glissant, invitez votre équipe par e-mail. La maquette reste dans InDesign : desK est le cockpit autour. Sans intelligence artificielle : rien à consommer.',
    'booK — vos flipbooks souverains : déposez un PDF ou des images, obtenez un livre que l\'on feuillette à l\'écran (page tournée sur ordinateur, glissement du doigt sur mobile), rangé dans votre bibliothèque. La vraie différence : votre publication tient dans UN SEUL fichier autonome qui s\'ouvre d\'un double-clic, partout, pour toujours — sans serveur, sans abonnement, sans watermark, sans même dépendre de Keystone. Et le fichier est sa propre sauvegarde : ré-importez-le dans booK des années plus tard, il redevient modifiable. Sans intelligence artificielle : rien à consommer.',
    'networK — votre réseau relationnel vivant, à la place du carnet d\'adresses : vous êtes au centre, et vos relations se déploient en carte mentale, dans des catégories libres (Clients, Fournisseurs, Partenaires…). Chaque contact ouvre une fiche claire — coordonnées, rôles, tags, notes, et un journal d\'activité qui raconte la relation (appels, e-mails, RDV, devis…). Et depuis chaque fiche, vous continuez votre travail sans ressaisir : « Continuer avec… » ouvre une Missive, un Brief ou votre Smart Agent avec le contact déjà en contexte. Ajout à la main, aucune IA, tout vous appartient — rien n\'est publié.',
    'Key Brand — plus de contrôle sur vos supports et vos typographies : la carte de visite accepte désormais votre recto ET votre verso en images séparées, et les réseaux sociaux votre photo de profil ET votre bannière indépendamment (la photo de profil reste quand vous posez une bannière). Dans les Typographies, vous choisissez la couleur du fond, du titre et du paragraphe de l\'aperçu — parmi les couleurs de votre charte, plus le noir et le blanc. Et quand vous modifiez une charte déjà en ligne, un rappel « Modifications non publiées » vous évite d\'oublier de republier : la page publique et son PDF ne montrent que la dernière version publiée.',
    'Key Brand — la couverture de votre charte s\'ouvre désormais sur VOTRE création : déposez une vidéo (motion design, film de marque) ou une image dans l\'onglet Branding, elle occupe tout l\'écran d\'ouverture de la page publique, sans rien par-dessus. Sans média, la couverture composée (fond, logo, nom) reste de mise, posée. Les animations préréglées disparaissent — votre vidéo fera toujours mieux qu\'un préréglage.',
    'Key Brand — votre charte graphique devient un mini-site interactif, à la place du PDF qui vieillit : déposez logo, couleurs, typographies et règles d\'usage, et obtenez une page vivante à partager d\'un simple lien ou d\'un QR. Vos interlocuteurs y téléchargent le logo au format exact qu\'il leur faut, copient les codes couleur d\'un clic, testent une police avec leur propre texte, et voient les interdits générés automatiquement avec VOTRE logo. Une charte par marque — la vôtre ou celles de vos clients — protégeable par un code, toujours à jour. Sans intelligence artificielle : rien à consommer.',
    'Missive — code « facile à dicter » : au choix, un code long à copier-coller (sécurité maximale) ou un code en 3 mots + un nombre (ex. tigre-banane-orage-77), parfait à transmettre de vive voix au téléphone sans faute de frappe — le verrou des 3 essais continue de protéger. La notice s\'enrichit aussi de conseils d\'usage en entreprise : ce qui doit passer par Missive, ce qui doit rester sur un canal archivé, et le paragraphe RGPD prêt à recopier dans votre registre des traitements.',
    'Brief Prod — générateur de gabarits d\'impression : en plus du brief, repartez avec un kit ZIP contenant les fichiers de départ de votre graphiste — gabarit PDF (cotes réelles, s\'ouvre dans Illustrator, InDesign ou Photoshop) et PSD (CMJN 300 DPI, guides posés, calques prêts), avec fond perdu, ligne de coupe et zone de sécurité aux normes exactes de votre imprimeur. Fonctionne pour n\'importe quel format, même hors bibliothèque : saisissez vos dimensions, les normes de l\'imprimeur choisi s\'appliquent. Option recto/verso et LISEZMOI inclus. Les dépliants posent leurs traits de plis (9 types : roulés, accordéon, fenêtre, croisés, portefeuille… avec les volets rentrants raccourcis comme chez l\'imprimeur), et les roll-ups leur zone d\'amorce basse masquée par le mécanisme, à l\'échelle de travail 1/4.',
    'Brief Prod — parcours repensé : l\'étape 1 va à l\'essentiel (catégorie → format → imprimeur, une question à la fois), le panneau de droite montre votre gabarit qui se dessine en direct à chaque choix, et la page ne remonte plus en haut quand vous cliquez une option. Les grands formats sont gérés automatiquement à l\'échelle de travail — plus aucun calcul à comprendre.',
    'Brainstorming — plus simple et plus tranché : posez votre sujet et lancez, l\'IA compose le comité (les réglages deviennent optionnels). Les agents rebondissent désormais vraiment les uns sur les autres, la synthèse se déclenche toute seule à la fin du tour de table quel que soit le comité, et surtout elle CHOISIT : 1 à 3 recommandations argumentées au lieu d\'un inventaire. Après la synthèse, creusez un point précis avec un seul agent — bien plus léger qu\'un nouveau tour.',
    'Ghost Writer — bibliothèque de symboles : un bouton Ω près de la zone de texte (Réécriture et Correction) ouvre une bibliothèque de symboles prêts à l\'emploi — flèches, puces, coches, séparateurs, chiffres cerclés, ©/™/§, majuscules accentuées… Recherchez en français (« flèche », « coche »), un clic insère le symbole dans votre texte et le copie. Avec vos favoris, vos récents, et un convertisseur de lettres stylées (à utiliser avec modération : mal lues par les lecteurs d\'écran). L\'IA de réécriture sait aussi structurer vos textes avec ces symboles selon le contexte.',
    'Smart Agent — la langue s\'adapte toute seule : votre visiteur écrit en anglais, espagnol ou allemand, l\'agent lui répond dans sa langue, sans réglage. Le choix manuel de langue vit désormais dans le mode vocal (où il pilote aussi la reconnaissance et la voix), et l\'en-tête de la page publique est allégé.',
    'Smart Agent — mode conversation vocale : sur la page publique de votre agent, un bouton dédié ouvre une conversation à la voix, comme avec un assistant moderne — le visiteur parle, l\'agent répond à voix haute, et le micro se rouvre tout seul. La voix se précharge discrètement à l\'ouverture de la page (bonne connexion uniquement) et, à la toute première utilisation, un écran de préparation affiche la progression et trois conseils d\'usage.',
    'Smart Agent : vos agents parlent plus naturellement — réponses courtes qui vont à l\'essentiel, accueil des émotions de vos clients, et une question de clarification quand la demande est ambiguë plutôt qu\'une réponse à côté. Un « bonjour » ou un « merci » reçoit désormais une vraie réponse chaleureuse, instantanée et sans consommer votre budget IA.',
  ] },
  { date: 'Juin 2026', items: [
    'Missive : transmettez un secret (mot de passe, code, information sensible) qui se lit une seule fois puis s\'autodétruit. Chiffré sur votre appareil — même nous ne pouvons pas le lire. Partagez un lien, un QR ou une puce NFC, et le code de déverrouillage par un autre canal ; vous êtes averti quand le sceau a été ouvert.',
    'Keynapse : votre espace personnel de connaissances — des bulles de notes sur un canevas infini, rangées en zones de couleur et reliées entre elles. Attachez photos, croquis et mémos vocaux (transcrits et transformés en tâches ou rappels par l\'IA), et posez des rappels qui vous préviennent à l\'heure dite.',
    'Smart Agent : créez un assistant qui répond à vos clients depuis VOTRE savoir, sans rien inventer — packs métier prêts (vendeur, immobilier, musée, concierge, guide, SAV), interview à l\'oral, et publication par lien ou QR code.',
    'Voix neuronale française : vos agents lisent leurs réponses à voix haute, et vous pouvez leur dicter vos questions.',
    'Social Manager : composez une publication et diffusez-la sur Facebook, Instagram, Threads et Telegram, tout de suite ou à l\'heure programmée.',
  ] },
];

function _escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Rend le guide complet (injecté dans l'accordéon « Documentation »).
export function keystoneDocHTML() {
  const sections = DOC_SECTIONS.map(s => `
    <section class="ks-doc-sec">
      <h4 class="ks-doc-h">${_escAttr(s.title)}</h4>
      <div class="ks-doc-b">${s.body}</div>
    </section>`).join('');

  const changelog = DOC_CHANGELOG.map(c => `
    <div class="ks-doc-cl-block">
      <span class="ks-doc-cl-date">${_escAttr(c.date)}</span>
      <ul class="ks-doc-b">${c.items.map(i => `<li>${i}</li>`).join('')}</ul>
    </div>`).join('');

  return `
    <div class="ks-doc">
      <p class="ks-doc-intro">Le guide pour tirer le meilleur de Keystone. Chaque outil a en plus sa propre aide (bouton « ? »).</p>
      ${sections}
      <section class="ks-doc-sec">
        <h4 class="ks-doc-h">Nouveautés</h4>
        ${changelog}
      </section>
    </div>`;
}
