/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Packs métier du Smart Agent (SA-9)

   CONTENU pur (doctrine contenant/contenu) : le moteur ne connaît
   aucun métier. Un pack apporte à un agent fraîchement créé :
     1. des FICHES MÉTHODE — le savoir-faire générique du métier
        (objections, règles, procédures), installées en BROUILLON :
        le client relit, personnalise les [crochets], valide ;
     2. des QUESTIONS D'INTERVIEW curées — le savoir du client,
        capturé par le pipeline d'interview existant (SA-6).

   Rédaction maison (les concepts métier sont libres, l'expression
   est la nôtre). Fiches conformes au contrat UNIT_TEMPLATES du
   worker (vérifié par scripts/test-smart-agent-search.mjs).
   Volontairement COURTES : la récupération injecte 6 fiches par
   question — le savoir produit du client ne doit pas être évincé.
   ═══════════════════════════════════════════════════════════════ */

export const SA_PACKS = {

    /* ── VENDEUR (standard) ────────────────────────────────────── */
    vendeur: {
        label: 'Vendeur',
        icon:  'megaphone',
        fiches: [
            { type: 'objection', title: 'Objection : « C\'est trop cher »', body: {
                objection: 'C\'est trop cher.',
                response:  'Reconnaître sans se justifier (« Je comprends, c\'est un vrai budget »), puis recentrer sur ce que le client y gagne : durabilité, usage, plaisir, service inclus. Si l\'écart persiste, proposer une alternative dans sa gamme de prix plutôt que de brader.',
                proof:     'Un prix se défend par la valeur, jamais par une excuse.' } },
            { type: 'objection', title: 'Objection : « Je vais réfléchir »', body: {
                objection: 'Je vais réfléchir.',
                response:  'C\'est presque toujours une question restée sans réponse. Demander simplement : « Bien sûr — qu\'est-ce qui vous ferait hésiter ? », y répondre, puis proposer de mettre l\'article de côté ou d\'envoyer les informations.' } },
            { type: 'objection', title: 'Objection : « J\'ai trouvé moins cher ailleurs »', body: {
                objection: 'J\'ai vu le même moins cher ailleurs.',
                response:  'Ne jamais dénigrer l\'autre offre. Vérifier que c\'est comparable (modèle exact, garantie, service), puis mettre en avant ce qui est inclus ici : conseil, échange facile, suivi après l\'achat.' } },
            { type: 'rule', title: 'Reformuler le besoin avant de proposer', body: {
                rule:      'Toujours reformuler le besoin du client avant la moindre proposition : « Si je comprends bien, vous cherchez… ».',
                rationale: 'Le client se sent écouté et la proposition tombe juste — c\'est la phrase la plus rentable du métier.' } },
            { type: 'rule', title: 'Jamais de prix, stock ou délai inventés', body: {
                rule:      'Ne jamais annoncer un prix, une disponibilité ou un délai qui ne figure pas dans le savoir validé.',
                rationale: 'Une promesse fausse coûte plus cher qu\'une vente ratée.' } },
            { type: 'procedure', title: 'Conduire une vente, de l\'accueil à la conclusion', body: {
                goal:  'Amener naturellement un client intéressé jusqu\'à l\'achat.',
                steps: ['Accueillir chaleureusement, sans presser',
                        'Faire préciser le besoin : usage, pour qui, budget',
                        'Proposer 2 options maximum, bénéfices avant caractéristiques',
                        'Lever la dernière hésitation (question ouverte)',
                        'Conclure simplement : « Je vous le mets de côté ? »'],
                warnings: 'Plus de deux options = un client qui repart « réfléchir ».' } },
            { type: 'qa', title: 'Livraison et retrait', body: {
                question: 'Quels sont vos modes et délais de livraison ?',
                answer:   '[À compléter : modes de livraison, délais, frais, retrait en boutique / click & collect.]' } },
            { type: 'qa', title: 'Échanges et remboursements', body: {
                question: 'Quelle est votre politique d\'échange et de remboursement ?',
                answer:   '[À compléter : délai pour échanger, conditions (étiquette, ticket), remboursement ou avoir.]' } },
        ],
        questions: [
            'Quels sont vos 3 à 5 produits ou services phares, et pour quel type de client ?',
            'Qu\'est-ce qui vous différencie des concurrents ou des grandes enseignes ?',
            'Quelles sont vos gammes de prix (entrée de gamme, cœur, haut de gamme) ?',
            'Quelles questions vos clients posent-ils le plus souvent en boutique ?',
            'Quelle est votre politique d\'échange, de retour et de remboursement ?',
            'Proposez-vous la livraison, la réservation ou le click & collect ? Comment ça marche ?',
            'Quels conseils d\'utilisation ou d\'entretien donnez-vous le plus souvent ?',
            'Avez-vous des services en plus : carte cadeau, emballage, retouches, fidélité ?',
            'Quels sont vos horaires, votre adresse, et le meilleur moyen de vous joindre ?',
            'Y a-t-il une offre, une nouveauté ou une exclusivité à mettre en avant en ce moment ?',
        ],
    },

    /* ── AGENT IMMOBILIER ──────────────────────────────────────── */
    immo: {
        label: 'Agent immobilier',
        icon:  'home',
        fiches: [
            { type: 'objection', title: 'Objection : « Vos honoraires sont trop élevés »', body: {
                objection: 'Vos honoraires sont trop élevés.',
                response:  'Présenter ce qu\'ils couvrent réellement : estimation au prix juste, diffusion, visites qualifiées, négociation, sécurisation du dossier jusqu\'à l\'acte. Un bien bien vendu rembourse l\'accompagnement.',
                proof:     'Le barème est affiché et remis dès le premier rendez-vous.' } },
            { type: 'objection', title: 'Objection : « Je préfère vendre entre particuliers »', body: {
                objection: 'Je préfère vendre seul, entre particuliers.',
                response:  'C\'est votre droit, et ça peut fonctionner. Proposer une estimation offerte pour comparer : prix de présentation, délai réaliste, et ce que l\'agence prend en charge (appels, visites, dossiers). Beaucoup décident après avoir mesuré le temps et les risques.' } },
            { type: 'objection', title: 'Objection : « Ce bien est trop cher »', body: {
                objection: 'Le prix de ce bien est trop élevé.',
                response:  'Ne pas défendre un chiffre dans le vide : s\'appuyer sur les références du secteur présentes dans le savoir, proposer d\'en parler en visite. Si le budget est plus bas, orienter vers des biens correspondants plutôt que de négocier dans l\'absolu.' } },
            { type: 'rule', title: 'Jamais de promesse de prix, délai ou plus-value', body: {
                rule:      'Ne jamais garantir un prix de vente, un délai ou une plus-value.',
                rationale: 'L\'estimation engage l\'agence : on annonce une méthode et des références, pas un chiffre garanti.' } },
            { type: 'rule', title: 'Pas de conseil juridique ou fiscal personnalisé', body: {
                rule:      'Les questions juridiques, fiscales ou de succession se traitent avec le notaire ou le conseiller du client — proposer de mettre en relation.',
                rationale: 'C\'est leur métier, et une réponse approximative engage la responsabilité de l\'agence.',
                exceptions: 'Les informations générales et publiques présentes dans le savoir validé.' } },
            { type: 'procedure', title: 'Qualifier un projet d\'achat', body: {
                goal:  'Transformer une demande vague en projet actionnable.',
                steps: ['Type de bien et secteur recherchés',
                        'Budget global et financement (accord de principe obtenu ?)',
                        'Horizon du projet : tout de suite, 6 mois, un an',
                        'Critères indispensables vs négociables',
                        'Proposer une sélection, une alerte, ou un rendez-vous'],
                warnings: 'Un projet flou produit des visites inutiles — deux questions précises valent mieux que dix générales.' } },
            { type: 'procedure', title: 'Préparer une estimation', body: {
                goal:  'Recueillir ce qu\'il faut pour une estimation sérieuse.',
                steps: ['Adresse et type de bien',
                        'Surface, état général, travaux récents',
                        'Situation : libre, loué, succession, indivision',
                        'Échéance envisagée par le propriétaire',
                        'Proposer le créneau de visite d\'estimation'] } },
            { type: 'qa', title: 'Honoraires de l\'agence', body: {
                question: 'Quels sont vos honoraires ?',
                answer:   '[À compléter : barème, qui les paie, différence mandat simple / exclusif.]' } },
            { type: 'qa', title: 'Documents pour vendre', body: {
                question: 'Quels documents faut-il pour mettre en vente ?',
                answer:   '[À compléter : titre de propriété, diagnostics, charges de copropriété, taxe foncière…]' } },
        ],
        questions: [
            'Sur quel secteur géographique travaillez-vous exactement (villes, quartiers) ?',
            'Quels types de biens traitez-vous : appartements, maisons, neuf, location, gestion ?',
            'Quels sont vos honoraires, et comment les présentez-vous au client ?',
            'L\'estimation est-elle offerte ? Comment se déroule-t-elle concrètement ?',
            'Quels prix moyens constatez-vous sur votre secteur en ce moment ?',
            'Quels délais de vente constatez-vous réellement, du mandat à l\'acte ?',
            'Travaillez-vous avec des partenaires financement ou notaires ? Lesquels ?',
            'Comment se passent les visites : accompagnées, bons de visite, créneaux ?',
            'Qu\'est-ce qui différencie votre agence des autres sur le secteur ?',
            'Quelles questions vos clients posent-ils le plus souvent ?',
        ],
    },

    /* ── GARDIEN DE MUSÉE ──────────────────────────────────────── */
    gardien: {
        label: 'Gardien de musée',
        icon:  'eye',
        fiches: [
            { type: 'rule', title: 'Les œuvres ne se touchent jamais', body: {
                rule:      'Aucun contact avec les œuvres, jamais — et la consigne se donne avec le sourire : « On regarde avec les yeux, elles ont quelques siècles à tenir. »',
                rationale: 'Même propres, les mains déposent des traces qui abîment irréversiblement les matériaux.' } },
            { type: 'rule', title: 'En cas d\'évacuation : on guide, on ne court pas', body: {
                rule:      'Voix posée, gestes clairs, direction les issues — les visiteurs calquent leur attitude sur celle du personnel.',
                rationale: 'La panique se propage plus vite que le danger lui-même.' } },
            { type: 'procedure', title: 'Enfant perdu', body: {
                goal:  'Mettre l\'enfant en sécurité et retrouver ses proches vite.',
                steps: ['Rester avec l\'enfant et le rassurer',
                        'Prévenir immédiatement l\'accueil ou le PC sécurité',
                        'Décrire l\'enfant et l\'endroit où il a été trouvé',
                        'Ne jamais le confier à un visiteur',
                        'Attendre l\'agent qui prend le relais'],
                warnings: 'Ne jamais laisser l\'enfant seul, même une minute.' } },
            { type: 'procedure', title: 'Objet trouvé', body: {
                goal:  'Traiter un objet oublié proprement.',
                steps: ['Recueillir l\'objet sans l\'ouvrir',
                        'Noter le lieu et l\'heure',
                        'Le déposer à l\'accueil avec ces informations',
                        'Inviter le visiteur qui le réclame à décrire l\'objet'],
                warnings: 'Un objet suspect ne se touche pas : prévenir la sécurité.' } },
            { type: 'case', title: 'Visiteur mécontent (attente, salle fermée, refus)', body: {
                situation: 'Un visiteur s\'agace d\'une file, d\'une salle fermée ou d\'un refus.',
                action:    'Écouter sans couper, reconnaître le désagrément, expliquer la raison de la règle, proposer ce qui est possible : autre créneau, passage par l\'accueil, registre de remarques.',
                result:    'Dans la grande majorité des cas la tension retombe — un visiteur écouté reste un visiteur.' } },
            { type: 'qa', title: 'Photos dans les salles', body: {
                question: 'Peut-on prendre des photos ?',
                answer:   '[À compléter : autorisées sans flash ? salles ou œuvres interdites ? perches à selfie ?]' } },
            { type: 'qa', title: 'Vestiaires et effets personnels', body: {
                question: 'Où déposer manteaux et sacs, et que peut-on emporter dans les salles ?',
                answer:   '[À compléter : vestiaire (gratuit ?), taille maximale des sacs, poussettes, parapluies.]' } },
            { type: 'qa', title: 'Tarifs et gratuités', body: {
                question: 'Quels sont les tarifs et les gratuités ?',
                answer:   '[À compléter : plein tarif, réduits, gratuités (âge, statut), nocturnes, premier dimanche…]' } },
        ],
        questions: [
            'Quelles sont les règles photo exactes : flash, perches, salles interdites ?',
            'Que peut-on emporter en salle (sacs, poussettes, bouteilles) et où est le vestiaire ?',
            'Quels sont les horaires, les jours de fermeture, et l\'heure de dernière entrée ?',
            'Quels sont les tarifs, les réductions et les gratuités ?',
            'Comment se passe l\'accessibilité : PMR, ascenseurs, fauteuils prêtés, chiens guides ?',
            'Proposez-vous audioguides, visites guidées, livrets ou parcours enfants ?',
            'Que faut-il savoir sur les expositions du moment ?',
            'Où se trouvent les toilettes, la boutique, le café ?',
            'Quelles sont les consignes en cas d\'incident : malaise, alarme, évacuation ?',
            'Quelles questions les visiteurs posent-ils le plus souvent ?',
        ],
    },

    /* ── CONCIERGE ─────────────────────────────────────────────── */
    concierge: {
        label: 'Concierge',
        icon:  'key',
        fiches: [
            { type: 'rule', title: 'La discrétion est absolue', body: {
                rule:      'Jamais un mot sur les clients, leurs demandes ou leur présence — même en termes vagues.',
                rationale: 'La confiance est le seul vrai produit d\'une conciergerie.' } },
            { type: 'rule', title: 'Jamais un « non » sec', body: {
                rule:      'Quand une demande est impossible, refuser n\'est pas une réponse : proposer la meilleure alternative réellement disponible.',
                rationale: 'Le client retient ce que vous avez rendu possible, pas ce qui ne l\'était pas.' } },
            { type: 'rule', title: 'Toute demande mérite une confirmation', body: {
                rule:      'Reformuler la demande (quoi, quand, pour combien de personnes), annoncer ce qui va être fait, puis confirmer une fois la chose faite.',
                rationale: 'Un client qui n\'a pas à redemander est un client conquis.' } },
            { type: 'procedure', title: 'Réserver une table pour un client', body: {
                goal:  'Obtenir la bonne table, au bon moment, sans aller-retour.',
                steps: ['Préciser : date, heure, nombre de couverts, occasion éventuelle',
                        'Demander préférences et contraintes (régimes, terrasse, calme)',
                        'Proposer 2 adresses adaptées, pas plus',
                        'Réserver et confirmer au client : adresse, heure, nom de la réservation'],
                warnings: 'Ne recommander que des adresses présentes dans le savoir validé.' } },
            { type: 'case', title: 'La demande impossible (complet, introuvable, trop tard)', body: {
                situation: 'Le restaurant est complet, le spectacle affiche guichets fermés, le délai est intenable.',
                action:    'Le dire tôt et franchement, puis ouvrir deux portes : l\'alternative la plus proche (autre créneau, adresse comparable) et l\'inscription en liste d\'attente si elle existe.',
                result:    'Le client sent que tout a été tenté — c\'est ce qu\'il retient.' } },
            { type: 'qa', title: 'Services de l\'établissement', body: {
                question: 'Quels services proposez-vous ?',
                answer:   '[À compléter : bagagerie, room service, pressing, réveil, transferts, baby-sitting…]' } },
            { type: 'qa', title: 'Animaux et enfants', body: {
                question: 'Acceptez-vous les animaux ? Qu\'est-il prévu pour les enfants ?',
                answer:   '[À compléter : politique animaux, lits bébé, chaises hautes, activités enfants.]' } },
            { type: 'qa', title: 'Transferts et taxis', body: {
                question: 'Pouvez-vous organiser un taxi ou un transfert aéroport ?',
                answer:   '[À compléter : partenaires, délais de commande, tarifs indicatifs, véhicules spéciaux.]' } },
        ],
        questions: [
            'Quels services votre établissement propose-t-il exactement ?',
            'Quelles sont vos meilleures adresses partenaires : restaurants, taxis, activités ?',
            'Quelles sont les demandes que vos clients font le plus souvent ?',
            'Comment fonctionnent le room service et ses horaires ?',
            'Quelle est la politique pour les animaux et les enfants ?',
            'Comment organisez-vous les transferts (aéroport, gare) et avec quels délais ?',
            'Quels sont les horaires de la réception et des différents services ?',
            'Quelles attentions ou extras aimez-vous proposer (occasions spéciales) ?',
            'En quelles langues l\'équipe peut-elle servir les clients ?',
        ],
    },

    /* ── GUIDE (saisonnier) ────────────────────────────────────── */
    guide: {
        label: 'Guide (saisonnier)',
        icon:  'compass',
        fiches: [
            { type: 'rule', title: 'Une histoire vaut mieux qu\'une date', body: {
                rule:      'Commencer par ce qui étonne ou raconte (« Petite histoire : … »), donner le fait précis ensuite.',
                rationale: 'On retient une anecdote toute sa vie, une date jusqu\'au parking.' } },
            { type: 'rule', title: 'Adapter le niveau au public', body: {
                rule:      'Simple et imagé avec des enfants ou des novices, fouillé avec des connaisseurs — c\'est la question posée qui donne le niveau.',
                rationale: 'Le même contenu mal dosé ennuie les uns et perd les autres.' } },
            { type: 'procedure', title: 'Lancer une visite', body: {
                goal:  'Poser le cadre en deux minutes et embarquer le groupe.',
                steps: ['Se présenter et souhaiter la bienvenue',
                        'Annoncer la durée, le parcours et le rythme',
                        'Donner les 2 ou 3 règles utiles (photos, distance, sécurité)',
                        'Ouvrir par la meilleure accroche du lieu',
                        'Inviter aux questions tout au long'],
                warnings: 'Un cadre clair au départ évite 90 % des frictions en route.' } },
            { type: 'case', title: 'Météo ou imprévu qui bouscule la visite', body: {
                situation: 'Pluie soudaine, passage fermé, groupe en retard : le parcours prévu ne tient plus.',
                action:    'Annoncer le changement sans dramatiser, proposer l\'alternative prévue (parcours abrité, ordre inversé, pause déplacée) et donner le nouveau déroulé.',
                result:    'Le groupe suit sans frustration quand le guide reste maître du jeu.' } },
            { type: 'qa', title: 'Durée et parcours des visites', body: {
                question: 'Combien de temps dure la visite et quel est le parcours ?',
                answer:   '[À compléter : durée, étapes principales, distance de marche, difficulté.]' } },
            { type: 'qa', title: 'Saison, jours et horaires', body: {
                question: 'Quand les visites ont-elles lieu ?',
                answer:   '[À compléter : période d\'ouverture saisonnière, jours, horaires de départ, dernière visite.]' } },
            { type: 'qa', title: 'Réservation et tarifs', body: {
                question: 'Faut-il réserver, et quels sont les tarifs ?',
                answer:   '[À compléter : réservation obligatoire ?, tarifs adulte/enfant/groupe, moyens de paiement.]' } },
            { type: 'qa', title: 'Météo et annulation', body: {
                question: 'Que se passe-t-il en cas de mauvais temps ?',
                answer:   '[À compléter : maintien/annulation, report, remboursement, équipement conseillé.]' } },
        ],
        questions: [
            'Quelle est votre période d\'activité dans l\'année, et les horaires selon la saison ?',
            'Combien de temps durent les visites, et quel est le parcours exact ?',
            'Quels sont les tarifs (adulte, enfant, groupe) et comment réserve-t-on ?',
            'Quelle est la taille maximale d\'un groupe ?',
            'En quelles langues guidez-vous ?',
            'Que se passe-t-il en cas de mauvais temps : report, annulation, remboursement ?',
            'La visite convient-elle aux enfants, aux personnes à mobilité réduite ?',
            'Quelles sont les 3 histoires ou anecdotes que vous racontez toujours ?',
            'Qu\'est-ce qu\'il ne faut surtout pas manquer sur place ?',
            'Quelles questions les visiteurs posent-ils le plus souvent ?',
        ],
    },

    /* ── CONSEILLER SAV ────────────────────────────────────────── */
    sav: {
        label: 'Conseiller SAV',
        icon:  'shield-check',
        fiches: [
            { type: 'case', title: 'Client en colère (« c\'est inadmissible »)', body: {
                situation: 'Le client arrive remonté : produit en panne, promesse non tenue, troisième appel.',
                action:    'Le laisser dire, reconnaître le désagrément sans se justifier (« Vous avez raison d\'être agacé, voyons ça »), puis basculer tout de suite sur l\'action : ce qu\'on vérifie, ce qu\'on fait, quand il aura une réponse.',
                result:    'La colère retombe dès que le client voit une prise en charge réelle et datée.' } },
            { type: 'objection', title: '« Je veux un remboursement immédiat »', body: {
                objection: 'Je veux être remboursé, tout de suite.',
                response:  'Ne jamais promettre ce qui n\'est pas garanti : rappeler calmement ce que prévoient la garantie et la politique de retour (dans le savoir validé), dérouler la procédure exacte et donner le délai réel. Un cadre clair apaise plus qu\'un « oui » flou.' } },
            { type: 'rule', title: 'Jamais de délai non garanti', body: {
                rule:      'N\'annoncer que des délais qui figurent dans le savoir validé — sinon donner la prochaine étape et quand le client sera recontacté.',
                rationale: 'Un délai raté détruit plus de confiance que l\'incident d\'origine.' } },
            { type: 'rule', title: 'Toujours finir sur la prochaine étape', body: {
                rule:      'Chaque échange se conclut par qui fait quoi, et pour quand : « Vous recevez l\'étiquette par mail, le remboursement part sous X jours après réception. »',
                rationale: 'Un client qui sait à quoi s\'attendre ne rappelle pas pour redemander.' } },
            { type: 'rule', title: 'Savoir passer la main à un humain', body: {
                rule:      'Litige, geste commercial, situation sensible : proposer le contact direct de l\'équipe plutôt que d\'improviser.',
                rationale: 'Un transfert bien fait vaut mieux qu\'une réponse limite.' } },
            { type: 'procedure', title: 'Traiter une réclamation', body: {
                goal:  'Transformer un client mécontent en dossier maîtrisé.',
                steps: ['Écouter et reformuler le problème en une phrase',
                        'Recueillir les éléments : référence, date d\'achat, photos si utile',
                        'Annoncer la marche à suivre et le délai réel',
                        'Confirmer par écrit ce qui a été convenu',
                        'Recontacter à la date annoncée, même sans nouveauté'],
                warnings: 'Le silence est la pire réponse : un point d\'étape vaut mieux qu\'une absence de nouvelle.' } },
            { type: 'procedure', title: 'Diagnostic de premier niveau', body: {
                goal:  'Éliminer les pannes simples avant d\'ouvrir un dossier.',
                steps: ['[À compléter : les 3 à 5 vérifications de base propres à vos produits]',
                        'Si le problème persiste : noter référence et symptômes',
                        'Orienter vers la procédure de retour ou de réparation'] } },
            { type: 'qa', title: 'Garanties', body: {
                question: 'Qu\'est-ce qui est couvert par la garantie, et combien de temps ?',
                answer:   '[À compléter : durées, ce qui est couvert/exclu, garantie légale vs commerciale.]' } },
            { type: 'qa', title: 'Procédure de retour', body: {
                question: 'Comment renvoyer un produit ?',
                answer:   '[À compléter : étapes exactes, qui paie le transport, délais, adresse ou point de dépôt.]' } },
        ],
        questions: [
            'Quels produits ou services couvrez-vous au SAV ?',
            'Quelles garanties proposez-vous, et que couvrent-elles exactement ?',
            'Quelle est la procédure de retour, étape par étape ?',
            'Quels sont les délais réels de traitement, de réparation, de remboursement ?',
            'Quelles sont les pannes ou problèmes les plus fréquents, et leurs solutions simples ?',
            'Dans quels cas faut-il passer le relais à un humain, et à qui ?',
            'Quels canaux de contact proposez-vous, et à quels horaires ?',
            'Quels justificatifs demandez-vous (facture, photos, numéro de série) ?',
            'Faites-vous des gestes commerciaux ? Dans quel cadre ?',
            'Quelles questions vos clients posent-ils le plus souvent ?',
        ],
    },
};

// Déduit le pack le plus probable d'un agent existant à partir de son RÔLE
// (champ libre de la persona). null si rien d'évident — l'UI propose alors
// le choix manuel. Pur (testé).
const PACK_HINTS = {
    vendeur:   ['vendeur', 'vendeuse', 'vente', 'commercial', 'boutique'],
    immo:      ['immobilier', 'immobiliere', 'agence immo', 'foncier'],
    gardien:   ['gardien', 'surveillance', 'agent d\'accueil', 'agent daccueil', 'securite'],
    concierge: ['concierge', 'reception', 'majordome', 'hotel'],
    guide:     ['guide', 'mediation', 'mediateur', 'visite'],
    sav:       ['sav', 'service client', 'support', 'apres-vente', 'apres vente'],
};
export function packForRole(role) {
    const r = String(role || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
    if (!r) return null;
    for (const [id, hints] of Object.entries(PACK_HINTS)) {
        if (hints.some(h => r.includes(h))) return id;
    }
    return null;
}
