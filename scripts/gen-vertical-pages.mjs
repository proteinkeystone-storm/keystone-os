#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — gen-vertical-pages
   ─────────────────────────────────────────────────────────────
   Genere les pages CAS D'USAGE / par metier sous /pour/<slug>.html
   Chaque page : douleurs du metier -> outils Keystone qui repondent
   (cartes liees aux pages /outils/<slug>) + scenario concret + FAQ
   (JSON-LD FAQPage + BreadcrumbList) + maillage + CTA.

   Ce generateur ECRIT AUSSI le sitemap.xml COMPLET (accueil + /faq +
   pages outils + pages metier) : c'est l'unique proprietaire du sitemap.

   Icones/labels outils relus depuis le tableau TOOLS d'index.html.
   Usage : npm run gen-verticals   (node scripts/gen-vertical-pages.mjs)
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INDEX = resolve(ROOT, 'index.html');
const POUR = resolve(ROOT, 'pour');
const CASUSAGE = resolve(ROOT, 'cas-usage');
const ORIGIN = 'https://protein-keystone.com';
const TODAY = '2026-06-29';

// slugs des pages outils publiques (doit matcher gen-tool-pages.mjs)
const TOOL = {
  qr: 'smart-qr', brief: 'brief-prod', brainstorming: 'brainstorming', keyform: 'key-form',
  ghost: 'ghost-writer', agent: 'smart-agent', social: 'social-manager', sentinel: 'sentinel', keynapse: 'keynapse', missive: 'missive',
  keybrand: 'key-brand', network: 'network', book: 'book', desk: 'desk',
};
const TOOL_APP = { // pour relire l'icone depuis TOOLS d'index.html
  'smart-qr': 'A-COM-001', 'brief-prod': 'A-COM-002', 'brainstorming': 'A-COM-003', 'key-form': 'A-COM-004',
  'ghost-writer': 'A-COM-005', 'smart-agent': 'O-AGT-001', 'social-manager': 'O-SOC-001', 'sentinel': 'O-GEO-001', 'keynapse': 'O-Keyn-001', 'missive': 'O-SEC-001',
  'key-brand': 'O-BRD-001', 'network': 'O-NET-001', 'book': 'O-BOK-001', 'desk': 'O-DSK-001',
};

// ─────────────────────────────────────────────────────────────
// CONTENU EDITORIAL — un objet par metier. (Modifiable a la main.)
//   u(slug, ligne)  = un usage relie a une page outil
//   uf(nom, ligne)  = un usage "feature" sans page dediee (texte seul)
// ─────────────────────────────────────────────────────────────
const u = (tool, line) => ({ tool, line });
const uf = (name, line) => ({ name, line });
const ue = (exp, name, line) => ({ exp, name, line }); // usage relie a une page cas d'usage /cas-usage/<exp>

const VERTICALS = [
  {
    slug: 'immobilier', metier: 'Immobilier',
    h1a: 'Vendez plus vite,', h1b: 'sans noyer vos journées dans l’administratif.',
    title: 'Keystone pour l’immobilier — agent IA, QR, visibilité | Keystone OS',
    desc: 'Agences, promoteurs, mandataires : un agent IA qui répond à vos acquéreurs 24/7 derrière un QR, un concierge virtuel pour vos programmes neufs, et le suivi de votre visibilité web et IA.',
    intro: 'Entre les questions des acquéreurs à toute heure, les visites à organiser et la présence en ligne, le métier déborde. Keystone fait répondre un agent IA à votre place, accueille vos prospects par QR et surveille votre visibilité — pour vous garder sur le terrain.',
    uses: [
      u('smart-agent', 'Un agent IA qui répond aux acquéreurs (dispo du bien, charges, DPE, financement) derrière un QR sur la vitrine ou la bâche chantier — sans inventer.'),
      u('sentinel', 'Surveillez votre visibilité en ligne et dans les IA : quand un prospect demande « agence à [ville] » à ChatGPT, êtes-vous cité ?'),
      ue('concierge', 'QR Concierge virtuel','Un seul QR par programme neuf : page d’accueil à votre marque, cartes de comparaison des lots et chat qui répond depuis un bloc validé.'),
      ue('qr-sonnette', 'QR Ring','Un QR sur le portail d’un bien à visiter ou sans interphone : le visiteur vous joint d’un geste (appel, SMS, WhatsApp), sans électricité.'),
    ],
    scenario: 'Un prospect scanne le QR sur la bâche d’un programme neuf à 22h. L’agent IA lui détaille les surfaces, les prestations et les disponibilités, capte sa demande de visite via un formulaire, et vous retrouvez le lead qualifié le lendemain matin — sans avoir décroché votre téléphone.',
    faq: [
      ['L’agent IA peut-il inventer des informations sur un bien ?', 'Non. Il ne répond qu’à partir des fiches que vous avez validées (descriptif, charges, diagnostics). S’il ne sait pas, il le dit et la question remonte dans sa liste à compléter.'],
    ],
  },
  {
    slug: 'restaurants', metier: 'Restaurants & cafés',
    h1a: 'Une carte qui change,', h1b: 'des clients qui ont toujours la bonne info.',
    title: 'Keystone pour les restaurants & cafés — menu QR, agent IA, réseaux | Keystone OS',
    desc: 'Restaurants, cafés, food-trucks : un menu QR modifiable sans réimprimer, un agent IA qui répond (horaires, allergènes, réservation) et vos plats du jour publiés partout en un clic.',
    intro: 'La carte évolue, les questions reviennent (vous êtes ouverts ? vegan ? terrasse ?), et il faut nourrir les réseaux. Keystone met tout en pilote automatique sans perdre l’âme de la maison.',
    uses: [
      u('smart-qr', 'Un QR sur la table qui pointe vers votre menu : changez un plat ou un prix sans réimprimer un seul flyer.'),
      u('smart-agent', 'Un agent IA qui répond 24/7 aux questions récurrentes : horaires, allergènes, menu enfant, réservation de groupe.'),
      u('social-manager', 'Le plat du jour publié d’un coup sur Facebook, Instagram et Threads — ou programmé pour 11h pile.'),
      u('sentinel', 'Suivez vos avis et votre présence locale, et voyez si les IA vous recommandent quand on cherche « où manger à [ville] ».'),
      ue('carte-fidelite', 'Carte de fidélité dématérialisée','La fidélité sans carte plastique : le client cumule des tampons en scannant, la récompense se débloque toute seule (le 10e café offert, par ex.).'),
    ],
    scenario: 'Vendredi, vous changez l’ardoise du midi : deux clics, le menu QR est à jour et le plat du jour part sur tous vos réseaux. À 19h, un client demande au QR s’il y a une option sans gluten — l’agent répond instantanément, table réservée, sans interrompre le service.',
    faq: [
      ['Dois-je réimprimer mes QR à chaque changement de carte ?', 'Non. Le QR est dynamique : il pointe vers une page que vous modifiez quand vous voulez. Le même QR imprimé reste valable.'],
      ['L’agent peut-il prendre une réservation ?', 'Il répond aux questions et oriente vers votre canal de réservation (formulaire, téléphone, lien). Il ne remplace pas un logiciel de caisse ou de booking, il filtre et qualifie en amont.'],
      ['Quels réseaux sont gérés ?', 'Facebook, Instagram, Threads et Telegram, en publication immédiate ou programmée.'],
    ],
  },
  {
    slug: 'commercants', metier: 'Commerçants & boutiques',
    h1a: 'Votre boutique répond,', h1b: 'même rideau baissé.',
    title: 'Keystone pour les commerçants — QR vitrine, agent IA, fidélité, réseaux | Keystone OS',
    desc: 'Boutiques et commerces de proximité : un QR vitrine qui annonce vos promos, un agent IA qui répond après la fermeture, des formulaires de fidélité et vos posts sur tous vos réseaux.',
    intro: 'Un client passe devant à 21h, a une question, et repart. Keystone transforme votre vitrine et vos réseaux en vendeur disponible en permanence.',
    uses: [
      u('smart-qr', 'Un QR en vitrine vers la promo du moment, modifiable à la volée — affiché une fois, mis à jour autant que vous voulez.'),
      u('smart-agent', 'Un agent IA qui répond hors horaires : stock, tailles, click-and-collect, retours.'),
      u('key-form', 'Un formulaire d’inscription au programme de fidélité ou à la liste des arrivages, partageable par lien ou QR.'),
      u('social-manager', 'Vos nouveautés publiées sur tous vos réseaux en un clic, ou programmées pour le matin.'),
      ue('carte-fidelite', 'Carte de fidélité dématérialisée','Un programme de fidélité dématérialisé : tampons cumulés par scan, récompense automatique une fois la carte pleine, zéro carte à imprimer ni à perdre.'),
    ],
    scenario: 'Le dimanche, boutique fermée : un passant scanne la vitrine, découvre la promo en cours, pose une question sur une taille à l’agent IA, et s’inscrit à votre liste d’arrivages via un mini-formulaire. Lundi, vous avez un nouveau client fidèle sans avoir levé le petit doigt.',
    faq: [
      ['Faut-il un site web pour utiliser tout ça ?', 'Non. Le QR, l’agent et les formulaires fonctionnent par simple lien ou QR — aucun site requis. Si vous avez un site, ça s’y intègre aussi.'],
      ['Mes clients doivent-ils créer un compte ?', 'Non. Ils posent leurs questions à l’agent et remplissent les formulaires sans compte, de manière anonyme.'],
      ['Mes données clients sont-elles protégées ?', 'Oui : hébergement en Europe, conformité RGPD native, conservation paramétrable, aucune revente.'],
    ],
  },
  {
    slug: 'artisans', metier: 'Artisans du bâtiment',
    h1a: 'Vous êtes sur le chantier.', h1b: 'Vos devis ne s’envolent plus.',
    title: 'Keystone pour les artisans — demandes de devis, agent IA, QR véhicule | Keystone OS',
    desc: 'Plombiers, électriciens, menuisiers, maçons : captez les demandes de devis 24/7, laissez un agent IA répondre aux premières questions et soignez vos courriers pro.',
    intro: 'Quand vous êtes les mains dans le cambouis, vous ne décrochez pas — et le client appelle le suivant. Keystone capte la demande pendant que vous travaillez.',
    uses: [
      u('key-form', 'Un formulaire de demande de devis structuré (type de travaux, photos via lien, urgence, adresse) que le client remplit seul.'),
      u('smart-agent', 'Un agent IA qui répond aux questions récurrentes (zone d’intervention, délais, types de prestations) et qualifie avant de vous déranger.'),
      u('smart-qr', 'Un QR sur le véhicule et la carte de visite qui mène direct au formulaire de demande.'),
      u('ghost-writer', 'Vos mails et relances de devis réécrits dans un ton pro et clair, sans y passer la soirée.'),
      ue('qr-sonnette', 'QR Ring','Un QR sur un accès de chantier sans électricité ni interphone : client, livreur ou riverain vous joint d’un geste (appel, SMS, WhatsApp).'),
    ],
    scenario: 'Un particulier voit votre camion, scanne le QR à un feu rouge, décrit sa fuite et joint une photo via le formulaire. L’agent confirme votre zone d’intervention et le délai indicatif. Le soir, vous traitez une demande déjà qualifiée au lieu d’un appel manqué.',
    faq: [
      ['Je n’ai pas le temps de configurer un truc compliqué.', 'Le formulaire et l’agent partent d’un gabarit métier pré-rempli : vous ajustez deux-trois champs et c’est en ligne. Pas de code, pas de site à construire.'],
      ['L’agent va-t-il s’engager sur un prix à ma place ?', 'Non. Il informe (zone, délais, prestations) et collecte la demande. Le chiffrage reste le vôtre.'],
      ['Comment je reçois les demandes ?', 'Par e-mail, dès qu’un formulaire est rempli. Vous gardez l’historique au même endroit.'],
    ],
  },
  {
    slug: 'hotellerie', metier: 'Hôtellerie & locations saisonnières',
    h1a: 'Un concierge qui ne dort jamais,', h1b: 'pour des voyageurs autonomes.',
    title: 'Keystone pour l’hôtellerie & les locations — livret QR, concierge IA | Keystone OS',
    desc: 'Hôtels, gîtes, chambres d’hôtes, locations Airbnb : un livret d’accueil et un Wi-Fi en QR, un concierge IA qui répond aux voyageurs et un suivi de votre réputation en ligne.',
    intro: 'Les mêmes questions, à toute heure : le code Wi-Fi, l’heure du check-out, où dîner. Keystone répond à votre place et libère vos soirées.',
    uses: [
      u('smart-qr', 'Un QR « livret d’accueil » + un QR Wi-Fi dans le logement : tout ce qu’il faut savoir, sans classeur papier.'),
      u('smart-agent', 'Un concierge IA qui répond aux voyageurs (check-in, équipements, recommandations locales) en plusieurs langues, par lien ou QR.'),
      u('key-form', 'Un formulaire d’arrivée (heure d’arrivée, demandes spéciales) ou un mini état des lieux, sans paperasse.'),
      u('sentinel', 'Gardez un œil sur votre réputation et votre visibilité, y compris quand un voyageur demande conseil à une IA.'),
      ue('qr-sonnette', 'QR Ring','Un QR à l’entrée d’un gîte sans interphone : le voyageur vous joint d’un geste à l’arrivée (appel, SMS, WhatsApp), sans électricité.'),
    ],
    scenario: 'Un voyageur arrive à 23h, scanne le QR de l’entrée : code d’accès, Wi-Fi, fonctionnement du chauffage. Il demande au concierge IA un bon restaurant ouvert — réponse immédiate. Vous n’avez pas eu à décrocher, et son séjour commence sans accroc.',
    faq: [
      ['Le concierge IA gère-t-il plusieurs langues ?', 'Oui, il répond dans la langue du voyageur à partir du savoir que vous lui avez fourni.'],
      ['Puis-je avoir un agent par logement ?', 'Oui. Vous pouvez regrouper vos logements et donner à chacun son savoir propre, plus un socle commun (règles maison, contacts).'],
      ['Les voyageurs doivent-ils installer une application ?', 'Non. Tout passe par un simple QR ou lien, sans compte ni application.'],
    ],
  },
  {
    slug: 'beaute', metier: 'Coiffure & beauté',
    h1a: 'Moins de téléphone,', h1b: 'plus de clients au fauteuil.',
    title: 'Keystone pour la coiffure & la beauté — QR RDV, agent IA, avant/après | Keystone OS',
    desc: 'Salons de coiffure, instituts, esthéticiennes, barbiers : un agent IA qui répond aux demandes, un QR vers vos prestations et vos avant/après publiés sur tous vos réseaux.',
    intro: 'Le téléphone sonne pendant une coupe, on rappelle rarement. Keystone répond à la place du salon et alimente vos réseaux sans y penser.',
    uses: [
      u('smart-agent', 'Un agent IA qui répond aux questions (tarifs, prestations, durée, disponibilités générales) pendant que vous coiffez.'),
      u('smart-qr', 'Un QR à l’accueil et sur le miroir vers vos prestations, votre lien d’avis ou de prise de contact.'),
      u('social-manager', 'Vos avant/après et offres publiés d’un clic sur Instagram, Facebook et Threads.'),
      u('key-form', 'Un formulaire de diagnostic capillaire ou de demande de RDV, rempli par la cliente avant de venir.'),
      ue('carte-fidelite', 'Carte de fidélité dématérialisée','La carte de fidélité sans carte : la cliente cumule ses passages en scannant, la prestation offerte se débloque toute seule.'),
    ],
    scenario: 'En plein shampoing, une cliente potentielle écrit à l’agent depuis votre lien Instagram : prix d’un balayage, durée. Réponse immédiate, formulaire de contact rempli. Le soir, vous publiez l’avant/après du jour sur trois réseaux en un clic.',
    faq: [
      ['L’agent prend-il les rendez-vous ?', 'Il informe et collecte les demandes (via formulaire ou lien). Pour l’agenda, il oriente vers votre outil de réservation habituel.'],
      ['Je n’ai pas le temps de gérer les réseaux.', 'C’est l’idée : un post, une image, et ça part sur tous vos réseaux d’un coup — ou programmé pour le bon créneau.'],
      ['Et si je veux juste essayer un outil ?', 'Keystone est modulaire : vous activez seulement ce qui vous sert, vous étendez quand vous voulez.'],
    ],
  },
  {
    slug: 'sante', metier: 'Professions de santé & bien-être',
    h1a: 'Votre secrétariat répond,', h1b: 'vous restez concentré sur le soin.',
    title: 'Keystone pour les professionnels de santé & bien-être — agent IA, formulaires | Keystone OS',
    desc: 'Praticiens, cabinets, thérapeutes, coachs bien-être : un agent IA qui répond aux questions pratiques (jamais médicales), des formulaires d’admission et une présence locale soignée.',
    intro: 'Les appels pour des questions pratiques saturent le standard. Keystone répond à ce qui est administratif et vous laisse le soin — sans jamais donner d’avis médical.',
    uses: [
      u('smart-agent', 'Un agent IA cadré sur le pratique : horaires, adresse, documents à apporter, déroulement d’une première séance — et qui renvoie vers vous pour tout le reste.'),
      u('key-form', 'Un questionnaire d’admission ou de pré-consultation, rempli en amont, en toute confidentialité.'),
      u('sentinel', 'Soignez votre présence locale (fiche, avis) et votre visibilité quand on cherche un praticien dans votre ville.'),
      u('ghost-writer', 'Vos courriers et informations patients réécrits clairement, dans le bon ton.'),
    ],
    scenario: 'Avant un premier rendez-vous, le patient remplit le formulaire d’admission depuis un lien. Il demande à l’agent ce qu’il doit apporter et combien de temps dure la séance : réponse immédiate. Le standard n’a pas sonné, et vous arrivez en consultation avec le dossier déjà prêt.',
    faq: [
      ['L’agent donne-t-il des conseils médicaux ?', 'Non, jamais. Il est volontairement limité au pratique et à l’administratif (horaires, documents, déroulement) et renvoie systématiquement vers le professionnel pour tout le reste.'],
      ['Les données des formulaires sont-elles confidentielles ?', 'Oui : hébergement en Europe, RGPD natif, durée de conservation que vous fixez, suppression automatique à l’échéance.'],
      ['Est-ce adapté à un cabinet de groupe ?', 'Oui. Vous pouvez regrouper plusieurs praticiens avec un socle d’informations commun et des réponses propres à chacun.'],
    ],
  },
  {
    slug: 'artistes', metier: 'Artistes & créatifs',
    h1a: 'Créez.', h1b: 'On s’occupe du reste.',
    title: 'Keystone pour les artistes & créatifs — candidatures, briefs, réseaux | Keystone OS',
    desc: 'Musiciens, photographes, plasticiens, illustrateurs : recevez candidatures et soumissions par formulaire, cadrez vos briefs imprimeur, et diffusez votre actu sur tous vos réseaux.',
    intro: 'Le talent ne suffit pas : il faut gérer les soumissions, briefer les prestataires, animer ses réseaux. Keystone prend la logistique pour vous laisser créer.',
    uses: [
      u('key-form', 'Un formulaire de candidature ou de soumission (appels à projets, démos, commandes) partageable par lien — fini les e-mails éparpillés.'),
      u('brief-prod', 'Un brief béton pour votre graphiste ou imprimeur : évitez l’erreur d’impression qui coûte cher.'),
      u('social-manager', 'Votre actu (concert, expo, sortie) publiée d’un clic sur tous vos réseaux, ou programmée.'),
      u('smart-qr', 'Un QR sur vos flyers, pochettes ou cartels d’expo vers votre lien du moment, modifiable sans réimprimer.'),
    ],
    scenario: 'Vous lancez un appel à collaboration : un formulaire centralise toutes les propositions. Pour l’affiche, Brief Prod cadre les specs imprimeur en deux minutes. Le jour J, le QR sur le flyer pointe vers la billetterie, et l’annonce part sur tous vos réseaux.',
    faq: [
      ['Le formulaire gère-t-il des fichiers lourds (audio, vidéo) ?', 'Le répondant colle un lien (WeTransfer, Drive, Dropbox, Vimeo) plutôt qu’un upload direct — simple et sans limite de taille.'],
      ['Brief Prod, c’est pour quoi exactement ?', 'Transformer votre intention créative en cahier des charges technique clair pour le graphiste ou l’imprimeur, pour éviter les mauvaises surprises à l’impression.'],
      ['Je peux tout garder à ma main ?', 'Oui. Keystone produit des brouillons et automatise le répétitif ; vous validez et publiez ce que vous voulez.'],
    ],
  },
  {
    slug: 'associations', metier: 'Associations & clubs',
    h1a: 'Plus de membres,', h1b: 'moins de paperasse.',
    title: 'Keystone pour les associations & clubs — adhésions, événements, réseaux | Keystone OS',
    desc: 'Associations, clubs sportifs, collectifs : gérez adhésions et inscriptions par formulaire, animez vos réseaux, affichez vos événements en QR et faites bouillonner les idées.',
    intro: 'Les bénévoles n’ont pas le temps. Keystone simplifie adhésions, communication et organisation pour que l’énergie aille au projet, pas à l’administratif.',
    uses: [
      u('key-form', 'Adhésions, inscriptions aux événements, appels à bénévoles : des formulaires partageables, sans tableur à la main.'),
      u('social-manager', 'Vos actualités et événements publiés sur tous vos réseaux d’un clic.'),
      u('smart-qr', 'Un QR sur vos affiches d’événement vers l’inscription ou le programme, mis à jour sans réimprimer.'),
      u('brainstorming', 'Une table ronde d’IA pour faire émerger des idées d’actions, de financement ou de communication.'),
    ],
    scenario: 'Pour la fête annuelle, vous créez un formulaire d’inscription en cinq minutes, l’affiche porte un QR qui pointe dessus, et l’événement part sur tous vos réseaux. En amont, Brainstorming vous a soufflé trois idées d’animations auxquelles personne n’avait pensé.',
    faq: [
      ['Est-ce adapté à une petite association sans budget tech ?', 'Oui. Pas de site requis, pas de code : des formulaires et des liens, modulaires, que vous activez selon vos besoins.'],
      ['Peut-on récolter des inscriptions sans compte pour les membres ?', 'Oui, les formulaires sont ouverts et anonymes par défaut, avec un code d’accès optionnel si besoin.'],
      ['Comment récupère-t-on les inscriptions ?', 'Par e-mail à chaque envoi, et export possible pour vos suivis.'],
    ],
  },
  {
    slug: 'evenementiel', metier: 'Événementiel & mariage',
    h1a: 'Le jour J est parfait.', h1b: 'Les coulisses aussi.',
    title: 'Keystone pour l’événementiel & le mariage — RSVP, briefs, QR programme | Keystone OS',
    desc: 'Wedding planners, traiteurs, agences événementielles : centralisez les RSVP et préférences, cadrez vos briefs prestataires et affichez programme et plan de table en QR.',
    intro: 'Un événement, c’est mille détails et zéro droit à l’erreur. Keystone centralise l’info et fiabilise les échanges avec invités et prestataires.',
    uses: [
      u('key-form', 'RSVP, régimes alimentaires, chansons demandées, navette : tout centralisé dans un formulaire, plus de relances par SMS.'),
      u('brief-prod', 'Des briefs nets pour vos prestataires (imprimeur, décorateur, papeterie) — zéro malentendu sur les specs.'),
      u('smart-qr', 'Un QR sur le faire-part ou à l’entrée vers le programme, le plan de table ou la galerie photo, modifiable jusqu’au dernier moment.'),
      u('social-manager', 'Vos réalisations publiées sur tous vos réseaux pour attirer les prochains clients.'),
    ],
    scenario: 'Les invités confirment leur présence et indiquent leurs allergies via un formulaire unique. Le faire-part porte un QR qui mènera au plan de table — que vous ajustez la veille sans rien réimprimer. Côté prestataires, le brief imprimeur ne laisse aucune place au doute.',
    faq: [
      ['Peut-on modifier le programme après impression des faire-part ?', 'Oui : le QR est dynamique, il pointe vers une page que vous mettez à jour quand vous voulez, même après impression.'],
      ['Le formulaire gère-t-il beaucoup d’invités ?', 'Oui, avec logique conditionnelle (afficher des questions selon les réponses) et export des réponses.'],
      ['Mes clients voient-ils un outil à leur image ?', 'Vous personnalisez couleurs et logo ; l’ensemble reste sobre et premium.'],
    ],
  },
  {
    slug: 'consultants', metier: 'Consultants & formateurs',
    h1a: 'Votre expertise rayonne,', h1b: 'sans que vous rédigiez toute la nuit.',
    title: 'Keystone pour les consultants & formateurs — propositions, agent IA, visibilité | Keystone OS',
    desc: 'Consultants, coachs, formateurs, freelances : rédigez propositions et contenus plus vite, laissez un agent IA présenter votre offre et soignez votre visibilité, IA comprise.',
    intro: 'Vous vendez votre temps — chaque heure passée à rédiger une proposition ou un post est une heure non facturée. Keystone vous en rend une bonne partie.',
    uses: [
      u('ghost-writer', 'Propositions commerciales, e-mails et posts réécrits dans votre ton, en une fraction du temps.'),
      u('smart-agent', 'Un agent IA qui présente votre offre, répond aux questions fréquentes et qualifie les prospects via votre lien ou QR.'),
      u('brainstorming', 'Une table ronde d’IA pour structurer une intervention, un programme de formation ou une stratégie de contenu.'),
      u('sentinel', 'Suivez votre visibilité et vérifiez si les IA vous citent comme expert sur votre sujet (GEO).'),
    ],
    scenario: 'Un prospect arrive sur votre lien, interroge l’agent sur votre méthode et vos tarifs, et laisse ses coordonnées. Pendant ce temps, Ghost Writer vous a dégrossi la proposition, et Brainstorming a charpenté votre prochain atelier. Vous validez, vous envoyez, vous facturez.',
    faq: [
      ['L’agent peut-il parler à ma place sans dire de bêtises ?', 'Il ne répond qu’à partir de ce que vous avez validé (offre, méthode, FAQ). Hors de ce périmètre, il le dit et renvoie vers vous.'],
      ['Ghost Writer écrit-il à ma place ou avec moi ?', 'Avec vous : il propose des variantes calibrées (e-mail, marketing, texte long) et corrige ; vous gardez la décision finale.'],
      ['C’est quoi la « visibilité dans les IA » ?', 'De plus en plus de gens posent leurs questions à ChatGPT, Perplexity ou Gemini. Sentinel vérifie si vous êtes cité dans leurs réponses et comment y gagner en présence.'],
    ],
  },
  {
    slug: 'culture', metier: 'Musées & lieux culturels',
    h1a: 'Un guide pour chaque visiteur,', h1b: 'sans audioguide à distribuer.',
    title: 'Keystone pour les musées & lieux culturels — guide IA, QR parcours | Keystone OS',
    desc: 'Musées, galeries, monuments, offices de tourisme : un guide IA accessible par QR, des parcours enrichis et une diffusion de votre programmation sur tous vos réseaux.',
    intro: 'Chaque visiteur a ses questions, dans sa langue, à son rythme. Keystone met un médiateur disponible derrière un simple QR, sans matériel à gérer.',
    uses: [
      u('smart-agent', 'Un guide IA derrière un QR (par salle ou par œuvre) qui raconte, répond et lit ses réponses à voix haute, dans la langue du visiteur.'),
      u('smart-qr', 'Des QR de parcours sur les cartels, modifiables à chaque nouvelle expo — sans réimprimer la signalétique.'),
      u('social-manager', 'Votre programmation et vos coulisses publiées sur tous vos réseaux d’un clic.'),
      u('key-form', 'Inscriptions aux visites guidées, ateliers ou newsletters, sans file d’attente à l’accueil.'),
    ],
    scenario: 'Devant une œuvre, un visiteur étranger scanne le cartel : le guide IA lui en raconte l’histoire dans sa langue, à voix haute, et répond à sa question. À la prochaine expo, vous mettez à jour les parcours sans changer un seul panneau, et l’événement part sur tous vos réseaux.',
    faq: [
      ['Le guide IA fonctionne-t-il sans application ?', 'Oui, uniquement par QR ou lien. Le visiteur n’installe rien et n’a pas de compte à créer.'],
      ['La lecture à voix haute est-elle payante ?', 'Non. La voix neuronale s’exécute dans le navigateur du visiteur, sans coût récurrent.'],
      ['Peut-on tout mettre à jour à chaque exposition ?', 'Oui : le savoir du guide et les parcours QR se modifient autant que nécessaire, sans toucher à la signalétique imprimée.'],
    ],
  },
  {
    slug: 'sport', metier: 'Sport & remise en forme',
    h1a: 'Vos adhérents informés,', h1b: 'votre énergie sur le terrain.',
    title: 'Keystone pour le sport & la remise en forme — inscriptions, agent IA, plannings | Keystone OS',
    desc: 'Salles de sport, coachs, clubs, studios : inscriptions et bilans par formulaire, un agent IA qui répond (tarifs, horaires, cours), des plannings en QR et des réseaux nourris.',
    intro: 'Entre les cours, vous n’êtes pas à l’accueil. Keystone informe vos adhérents et capte les nouveaux pendant que vous coachez.',
    uses: [
      u('smart-agent', 'Un agent IA qui répond aux questions (formules, horaires, niveau requis, essai gratuit) à toute heure.'),
      u('key-form', 'Inscriptions, questionnaire santé/objectifs, réservation d’un cours d’essai — remplis en amont.'),
      u('smart-qr', 'Un QR à l’accueil et sur les machines vers le planning, une vidéo d’exercice ou le lien d’avis.'),
      u('social-manager', 'Vos séances, défis et résultats publiés sur tous vos réseaux pour entretenir la communauté.'),
      ue('carte-fidelite', 'Carte de fidélité dématérialisée','Récompensez l’assiduité sans carte plastique : vos adhérents cumulent leurs venues par scan, la séance offerte se débloque automatiquement.'),
    ],
    scenario: 'Un curieux passe devant le studio, scanne le QR : tarifs, planning, et il réserve un cours d’essai via le formulaire après avoir posé deux questions à l’agent. Pendant votre cours, tout s’est fait sans vous, et le défi de la semaine est déjà parti sur les réseaux.',
    faq: [
      ['L’agent gère-t-il les réservations de cours ?', 'Il informe et collecte les demandes (formulaire, lien). Pour le planning en temps réel, il renvoie vers votre outil de réservation.'],
      ['Le questionnaire santé est-il confidentiel ?', 'Oui : RGPD natif, hébergement en Europe, conservation paramétrable et suppression automatique à l’échéance.'],
      ['Je débute, c’est compliqué à mettre en place ?', 'Non : gabarits pré-remplis, aucun code, et vous n’activez que les outils utiles.'],
    ],
  },
  {
    slug: 'automobile', metier: 'Garages & automobile',
    h1a: 'L’atelier tourne,', h1b: 'les demandes ne tombent plus à l’eau.',
    title: 'Keystone pour les garages & l’automobile — demandes, agent IA, QR | Keystone OS',
    desc: 'Garages, carrossiers, centres auto, loueurs : captez les demandes d’intervention 24/7, laissez un agent IA répondre aux questions courantes et soignez votre réputation locale.',
    intro: 'Les mains dans le moteur, vous ne répondez pas — et le client appelle le garage d’à côté. Keystone capte et qualifie la demande sans vous interrompre.',
    uses: [
      u('key-form', 'Un formulaire de demande d’intervention (véhicule, panne, photos via lien, disponibilités) rempli par le client.'),
      u('smart-agent', 'Un agent IA qui répond aux questions courantes (prestations, horaires, véhicule de prêt, délais) et qualifie avant de vous déranger.'),
      u('smart-qr', 'Un QR sur la devanture et le véhicule de courtoisie vers la prise de contact ou le lien d’avis.'),
      u('sentinel', 'Suivez vos avis et votre présence locale, décisifs pour être choisi dans votre zone.'),
    ],
    scenario: 'Un automobiliste tombe en panne, cherche un garage, vous trouve grâce à votre présence locale soignée, et décrit son problème via le formulaire avec photos. L’agent confirme vos horaires et la dispo d’un véhicule de prêt. Vous rappelez un client déjà qualifié, dossier en main.',
    faq: [
      ['L’agent va-t-il annoncer un prix de réparation ?', 'Non. Il informe (prestations, horaires, délais indicatifs) et collecte la demande ; le devis reste de votre ressort après diagnostic.'],
      ['Comment recevoir les demandes d’intervention ?', 'Par e-mail dès qu’un formulaire est rempli, avec les photos et infos du véhicule.'],
      ['Les avis comptent-ils vraiment pour un garage ?', 'Beaucoup : la présence locale et les avis pèsent fort dans le choix. Sentinel vous aide à les suivre et à vous améliorer.'],
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// CAS D'USAGE DIFFERENCIANTS — experiences Smart QR, transverses aux metiers.
//   what  = description fidele a la capacite REELLE (pas de sur-promesse)
//   scenarios = [titre, ligne] ; metiers = slugs des pages /pour/<slug>
// ─────────────────────────────────────────────────────────────
const EXPERIENCES = [
  {
    slug: 'qr-sonnette', label: 'QR Ring',
    h1a: 'Un QR. Un geste.', h1b: 'On vous joint, même sans sonnette ni électricité.',
    title: 'QR Ring — sonnette par QR Code, sans électricité | Keystone OS',
    desc: 'Un QR posé sur un portail ou une porte, sans électricité : on tape « Sonner » et vous — plus les proches que vous ajoutez (conjoint, gardien…) — êtes prévenu par notification push, même application fermée. Repli e-mail et contacts directs inclus.',
    intro: 'Un portail sans interphone, un accès sans électricité, ou l’envie qu’un cercle de proches soit prévenu en un instant : on tape « Sonner » sur le QR Ring, et vous — avec les proches que vous avez ajoutés — recevez une notification, même application fermée.',
    what: 'Une page hébergée derrière un QR à imprimer, sans électricité. Le visiteur tape « Sonner » et, en un instant, une notification push part vers TOUS les appareils que vous avez abonnés — le vôtre et ceux des proches ajoutés (conjoint, gardien, voisin…), même application fermée — avec un repli par e-mail si une notification se perd. Vous pouvez même répondre : le visiteur voit votre réponse. Et si vous préférez, les contacts directs (appel, SMS, WhatsApp, e-mail) avec message pré-rempli restent disponibles.',
    scenarios: [
      ['Alerter un cercle de proches', 'Un QR près de la porte d’un parent âgé ou isolé : il tape « Sonner », et tous les proches ajoutés (vous, un frère, un voisin de confiance) sont prévenus par notification au même moment. Un point d’appel partagé et rassurant.'],
      ['Portail ou accès sans interphone', 'Un QR sur le portail : le visiteur tape « Sonner », vous êtes prévenu à l’instant sur votre téléphone — même appli fermée. Pas de câblage, pas de boîtier, pas d’électricité.'],
      ['Chantier ou lieu sans courant', 'Sur un accès de chantier, un dépôt, un local en travaux : client, livreur ou riverain vous joint d’un tap, et vous pouvez même répondre depuis la notification.'],
      ['Accueil quand c’est fermé', 'Boutique fermée, gîte, cabinet : on sonne, l’équipe est prévenue ; sinon, contact direct (appel, SMS, WhatsApp) avec message pré-rempli.'],
    ],
    metiers: ['immobilier', 'hotellerie', 'artisans', 'commercants'],
    faq: [
      ['Comment suis-je prévenu quand on sonne ?', 'Par notification push sur tous les appareils que vous avez abonnés — votre téléphone, votre ordinateur, et ceux des proches que vous ajoutez — même application fermée. Un e-mail de secours peut aussi être envoyé au cas où une notification se perde.'],
      ['Puis-je alerter plusieurs proches à la fois ?', 'Oui. Dans l’onglet Sonneries, vous ajoutez autant d’appareils que vous voulez (conjoint, gardien, voisin…) ; tous reçoivent l’alerte quand on sonne, et chacun peut répondre.'],
      ['Est-ce un dispositif d’urgence ou de téléassistance médicale ?', 'Non. C’est un système de notification (push, avec repli e-mail), très pratique pour prévenir vite un cercle de proches — mais la réception n’est pas garantie comme une téléassistance médicale surveillée ; ne le présentez pas comme tel.'],
      ['Faut-il de l’électricité ou une application côté visiteur ?', 'Non. Le visiteur scanne un QR imprimé et tape « Sonner » depuis son propre téléphone, sans rien installer.'],
    ],
  },
  {
    slug: 'carte-fidelite', label: 'Carte de fidélité dématérialisée',
    h1a: 'La carte de fidélité,', h1b: 'sans la carte.',
    title: 'Carte de fidélité par QR, sans support physique | Keystone OS',
    desc: 'Une carte de fidélité dématérialisée : vos clients cumulent des tampons en scannant un QR, la récompense se débloque toute seule une fois la carte pleine. Zéro carte plastique à imprimer ni à perdre.',
    intro: 'Les cartes à tampons en carton se perdent, s’oublient et coûtent à imprimer. Le même principe, en un QR : vos clients cumulent leurs passages sans rien sortir de leur poche.',
    what: 'Vos clients scannent le QR à chaque passage ; les tampons se cumulent automatiquement, l’état étant tenu côté serveur (pas sur un bout de carton). Quand le compte de tampons est atteint, la récompense se débloque avec un code à présenter en caisse. Vous fixez le nombre de tampons (de 3 à 30) et la durée de validité. Aucune carte physique, aucune application à installer.',
    scenarios: [
      ['Cafés & restaurants', 'Le 10e café offert, la formule midi fidélité : le compteur tourne tout seul à chaque scan en caisse.'],
      ['Boutiques & commerces', 'Récompensez les passages réguliers sans gérer un fichier ni imprimer des cartes à perdre.'],
      ['Coiffure & beauté', 'La prestation offerte au bout de N visites, débloquée automatiquement, code en caisse.'],
      ['Sport & loisirs', 'Récompensez l’assiduité : la séance offerte se débloque après N venues scannées.'],
    ],
    metiers: ['restaurants', 'commercants', 'beaute', 'sport'],
    faq: [
      ['Le client doit-il installer une application ?', 'Non. Il scanne le QR, c’est tout. Le cumul se fait automatiquement, sans compte ni appli.'],
      ['Comment la récompense est-elle validée ?', 'Quand la carte est pleine, un code s’affiche sur le téléphone du client : il le présente ou le saisit en caisse pour débloquer sa récompense.'],
      ['Combien de tampons puis-je demander ?', 'De 3 à 30, avec une durée de validité que vous fixez vous-même.'],
      ['Faut-il un site web ?', 'Non. Il suffit du QR : sur le comptoir, le ticket de caisse, la vitrine ou un flyer.'],
    ],
  },
  {
    slug: 'concierge', label: 'QR Concierge virtuel',
    h1a: 'Un QR.', h1b: 'Un lieu entier qui se présente et répond tout seul.',
    title: 'QR Concierge virtuel — un lieu qui se présente et répond, en marque blanche | Keystone OS',
    desc: 'Un QR concierge white-label : page d’accueil à votre marque, cartes de comparaison et chat qui répond depuis un bloc de connaissance validé. La logique : un QR = un lieu à présenter — programme immobilier, gîte, salle, showroom.',
    intro: 'Vos prospects veulent tout savoir, tout de suite, à toute heure. Le QR Concierge met un point d’information complet derrière un seul code, à votre marque.',
    what: 'Derrière un seul QR : une page d’accueil à votre marque, des cartes de comparaison déterministes (lots, prestations, options…) et un chat qui répond UNIQUEMENT depuis un bloc de connaissance que vous avez validé — jamais d’invention. La logique : un QR = un lieu à présenter, en marque blanche — un programme immobilier neuf, un gîte, une salle à louer, un showroom.',
    scenarios: [
      ['Programme immobilier neuf', 'Un QR sur la bâche de chantier ou la bulle de vente : le prospect compare les lots et pose ses questions, jour et nuit, sans mobiliser un commercial.'],
      ['Bulle de vente & salons', 'Un point d’information autonome, à votre marque, qui complète l’équipe sans la remplacer.'],
      ['Résidences & lieux à présenter', 'Tout ce qu’il faut savoir sur un lieu, structuré et à jour, derrière un seul code.'],
    ],
    metiers: ['immobilier', 'hotellerie'],
    faq: [
      ['Le chat invente-t-il des réponses ?', 'Non. Il répond uniquement depuis le bloc de connaissance que vous avez validé. Hors de ce périmètre, il le dit plutôt que d’inventer.'],
      ['Pour quel secteur est-ce conçu ?', 'Pour tous les secteurs : la logique est « un QR = un lieu à présenter ». Résidence, gîte, salle à louer, stand de salon, showroom… chaque lieu a sa page d’accueil, ses cartes de comparaison et son chat.'],
      ['Est-ce à ma marque ?', 'Oui, c’est du white-label : logo, couleurs et contenu sont les vôtres.'],
    ],
  },
];

// ── helpers (alignes sur gen-tool-pages.mjs) ────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const jsonld = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

const indexHTML = readFileSync(INDEX, 'utf8');
function toolIcon(slug) {
  const app = TOOL_APP[slug]; if (!app) return '';
  const re = new RegExp('app:"' + app.replace(/[-/]/g, '\\$&') + '"[\\s\\S]*?icon:\'([^\']*)\'');
  const m = indexHTML.match(re);
  return m ? m[1] : '';
}
const TOOL_NAME = {
  'smart-qr': 'Smart Dynamic QR', 'brief-prod': 'Brief Prod', 'brainstorming': 'Brainstorming',
  'key-form': 'Key Form', 'ghost-writer': 'Ghost Writer', 'smart-agent': 'Smart Agent',
  'social-manager': 'Social Manager', 'sentinel': 'Sentinel', 'keynapse': 'Keynapse', 'missive': 'Missive',
};

const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
const ICON_WRAP = (icon) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
const GENERIC_ICON = '<circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/>';

// liste pour la colonne footer "Cas d'usage" + section "autres metiers"
const ALL = VERTICALS.map(v => ({ slug: v.slug, metier: v.metier }));

const STYLE = `*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#020617;--bg-2:#0f172a;--bg-3:#1e293b;--accent:#6366f1;--accent-2:#818cf8;--accent-3:#a5b4fc;--accent-bg:rgba(99,102,241,.12);--accent-bd:rgba(99,102,241,.28);--text:#f8fafc;--text-2:rgba(248,250,252,.6);--text-3:rgba(248,250,252,.32);--border:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.14);--green:#34d399;--r:12px;--r-md:16px;--r-lg:24px}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter","Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;letter-spacing:-.02em;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit;text-decoration:none}
.wrap{max-width:920px;margin:0 auto;padding:0 22px}
body::before{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(60% 50% at 50% -8%,rgba(99,102,241,.18),transparent 70%)}
.nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;padding:14px 22px;background:rgba(2,6,23,.72);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
.nav-logo{display:flex;align-items:center;gap:9px;font-weight:800;font-size:15px}
.nav-logo img{width:26px;height:26px}
.nav-cta{font-size:13.5px;font-weight:600;padding:8px 16px;border-radius:999px;background:var(--accent-bg);border:1px solid var(--accent-bd);color:var(--accent-3);transition:border-color .2s,background .2s}
.nav-cta:hover{border-color:var(--accent-2);background:var(--accent-bd)}
.crumb{font-size:12.5px;color:var(--text-3);padding:22px 0 0}
.crumb a:hover{color:var(--text-2)}
.crumb span{color:var(--text-2)}
.hero{padding:34px 0 40px;text-align:center}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--accent-3);padding:6px 14px;border-radius:999px;margin-bottom:22px;background:var(--accent-bg);border:1px solid var(--accent-bd)}
.eyebrow svg{width:15px;height:15px}
h1{font-size:clamp(30px,5.6vw,50px);font-weight:900;letter-spacing:-.035em;line-height:1.04}
h1 em{font-style:normal;background:linear-gradient(120deg,var(--accent-3),var(--accent-2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lead{max-width:660px;margin:22px auto 0;font-size:clamp(15px,2.2vw,17.5px);color:var(--text-2)}
.lead b{color:var(--text);font-weight:600}
.ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:30px}
.btn{display:inline-flex;align-items:center;gap:8px;font-size:14.5px;font-weight:600;padding:13px 24px;border-radius:999px;transition:transform .15s,box-shadow .2s,border-color .2s,background .2s}
.btn svg{width:18px;height:18px}
.btn-primary{background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;box-shadow:0 8px 26px rgba(99,102,241,.32)}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 12px 32px rgba(99,102,241,.42)}
.btn-ghost{border:1px solid var(--border-strong);color:var(--text)}
.btn-ghost:hover{border-color:var(--accent-2);background:var(--accent-bg)}
.trust{margin-top:16px;font-size:12.5px;color:var(--text-3)}
section.block{padding:30px 0;border-top:1px solid var(--border)}
.eyebrow-l{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-3)}
h2{font-size:clamp(23px,3.4vw,31px);font-weight:900;letter-spacing:-.03em;margin:12px 0 6px;line-height:1.1}
.sub{color:var(--text-2);font-size:15px;max-width:660px}
.uses{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;margin-top:24px}
.ucard{display:block;padding:18px;border:1px solid var(--border);border-radius:var(--r-md);background:rgba(255,255,255,.02);transition:border-color .2s,transform .15s}
.ucard:hover{border-color:var(--accent-bd);transform:translateY(-2px)}
.ucard .ic{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:var(--accent-bg);border:1px solid var(--accent-bd);margin-bottom:12px}
.ucard .ic svg{width:19px;height:19px;color:var(--accent-3)}
.ucard h3{font-size:15px;font-weight:700;letter-spacing:-.02em;display:flex;align-items:center;gap:6px}
.ucard h3 .lnk{color:var(--accent-3);font-size:12px}
.ucard p{font-size:13.5px;color:var(--text-2);margin-top:5px;line-height:1.5}
.scenario{margin-top:24px;padding:22px 24px;border-radius:var(--r-md);background:linear-gradient(140deg,rgba(99,102,241,.1),rgba(129,140,248,.03));border:1px solid var(--accent-bd);font-size:15px;color:var(--text-2);line-height:1.65}
.scenario b{color:var(--text);font-weight:600}
.faq{margin-top:24px;display:grid;gap:10px}
.faq details{background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden}
.faq summary{list-style:none;cursor:pointer;padding:16px 18px;font-size:15px;font-weight:600;color:var(--text);display:flex;justify-content:space-between;align-items:center;gap:14px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-size:20px;font-weight:400;color:var(--accent-3);transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq .a{padding:0 18px 18px;font-size:14px;color:var(--text-2)}
.chips{display:flex;flex-wrap:wrap;gap:9px;margin-top:24px}
.chip{font-size:13px;font-weight:600;padding:8px 14px;border-radius:999px;border:1px solid var(--border-strong);color:var(--text-2);transition:border-color .2s,color .2s,background .2s}
.chip:hover{border-color:var(--accent-2);color:var(--text);background:var(--accent-bg)}
.band{margin:40px 0 10px;padding:40px 26px;text-align:center;border-radius:var(--r-lg);background:linear-gradient(140deg,rgba(99,102,241,.16),rgba(129,140,248,.05));border:1px solid var(--accent-bd)}
.band h2{margin-bottom:8px}
.band p{color:var(--text-2);font-size:15px;max-width:520px;margin:0 auto 22px}
.foot{margin-top:46px;border-top:1px solid var(--border);padding:34px 0}
.foot-cols{display:flex;flex-wrap:wrap;gap:34px}
.foot-col h4{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin-bottom:12px}
.foot-col a,.foot-col address,.foot-col span{display:block;font-size:13.5px;color:var(--text-2);font-style:normal;margin-bottom:7px;line-height:1.5}
.foot-col a:hover{color:var(--text)}
.foot-copy{margin-top:28px;font-size:12.5px;color:var(--text-3)}
@media(max-width:560px){.hero{padding:24px 0 32px}}`;

function FOOT() {
  const casUsage = ALL.slice(0, 6).map(v => `<a href="/pour/${v.slug}">${esc(v.metier)}</a>`).join('\n        ');
  return `  <footer class="foot">
    <div class="foot-cols">
      <div class="foot-col"><h4>Produit</h4>
        <a href="/#outils">Outils</a><a href="/#plans">Tarifs</a><a href="/faq">FAQ</a><a href="/activate">Se connecter</a>
      </div>
      <div class="foot-col"><h4>Cas d'usage</h4>
        ${casUsage}
      </div>
      <div class="foot-col"><h4>Confiance</h4>
        <a href="/a-propos">À propos</a><a href="/securite">Sécurité</a><a href="/confidentialite">Confidentialité</a><a href="/mentions-legales">Mentions légales</a><a href="/cgu">CGU</a><a href="/cgv">CGV</a><a href="/dpa">DPA & sous-traitants</a><a href="/reversibilite">Réversibilité</a><a href="/changelog">Nouveautés</a><a href="/roadmap">Feuille de route</a>
      </div>
      <div class="foot-col"><h4>Contact</h4>
        <a href="mailto:contact@protein-keystone.com">contact@protein-keystone.com</a>
        <a href="tel:+33675590797">06 75 59 07 97</a>
        <span>SAV : lun.–sam. 10h–19h (hors jours feries)</span>
      </div>
    </div>
    <div class="foot-copy">© 2026 Keystone OS — édité par Protein Studio (EI, Stéphane Benedetti), SIRET 520 721 853 00023.</div>
  </footer>`;
}

function page(v, idx) {
  const url = `${ORIGIN}/pour/${v.slug}`;
  const uses = v.uses.map(x => {
    let href = null, name, icon;
    if (x.tool) { href = `/outils/${x.tool}`; name = TOOL_NAME[x.tool]; icon = toolIcon(x.tool); }
    else if (x.exp) { href = `/cas-usage/${x.exp}`; name = x.name; icon = toolIcon('smart-qr'); }
    else { name = x.name; icon = GENERIC_ICON; }
    const head = href
      ? `<a class="ucard" href="${href}"><span class="ic">${ICON_WRAP(icon)}</span><h3>${esc(name)} <span class="lnk">→</span></h3><p>${esc(x.line)}</p></a>`
      : `<div class="ucard"><span class="ic">${ICON_WRAP(icon)}</span><h3>${esc(name)}</h3><p>${esc(x.line)}</p></div>`;
    return '      ' + head;
  }).join('\n');
  const others = ALL.filter(a => a.slug !== v.slug).map(a => `      <a class="chip" href="/pour/${a.slug}">${esc(a.metier)}</a>`).join('\n');

  const graph = [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Cas d’usage', item: `${ORIGIN}/#metiers` },
      { '@type': 'ListItem', position: 3, name: v.metier, item: url },
    ] },
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: v.title, inLanguage: 'fr-FR',
      isPartOf: { '@id': `${ORIGIN}/#website` }, about: { '@id': `${ORIGIN}/#organization` }, description: v.desc },
    { '@type': 'FAQPage', mainEntity: v.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(v.title)}</title>
<meta name="description" content="${escAttr(v.desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${escAttr(v.title)}">
<meta property="og:description" content="${escAttr(v.desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="Keystone OS">
<meta property="og:locale" content="fr_FR">
<meta property="og:image" content="${ORIGIN}/og-cover.png">
<meta property="og:image:width" content="2400">
<meta property="og:image:height" content="1260">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(v.title)}">
<meta name="twitter:description" content="${escAttr(v.desc)}">
<meta name="twitter:image" content="${ORIGIN}/og-cover.png">
<meta name="theme-color" content="#020617">
<link rel="icon" href="/keystone-puce.svg" type="image/svg+xml">
<script type="application/ld+json">
${jsonld({ '@context': 'https://schema.org', '@graph': graph })}
</script>
<style>
${STYLE}
</style>
</head>
<body>

<nav class="nav">
  <a class="nav-logo" href="/"><img src="/keystone-puce.svg" alt="">Keystone</a>
  <a class="nav-cta" href="/activate">Se connecter</a>
</nav>

<div class="wrap">

  <nav class="crumb" aria-label="Fil d'Ariane">
    <a href="/">Accueil</a> &nbsp;/&nbsp; <a href="/#metiers">Cas d'usage</a> &nbsp;/&nbsp; <span>${esc(v.metier)}</span>
  </nav>

  <header class="hero">
    <span class="eyebrow">Cas d'usage · ${esc(v.metier)}</span>
    <h1>${esc(v.h1a)}<br><em>${esc(v.h1b)}</em></h1>
    <p class="lead">${esc(v.intro)}</p>
    <div class="ctas">
      <a class="btn btn-primary" href="/activate">Commencer ${ARROW}</a>
      <a class="btn btn-ghost" href="/#outils">Voir tous les outils</a>
    </div>
    <p class="trust">Sans carte bancaire · vos données restent à vous, hébergées en Europe</p>
  </header>

  <section class="block" aria-labelledby="outils">
    <span class="eyebrow-l">Les outils qui changent la donne</span>
    <h2 id="outils">Ce que Keystone fait pour vous</h2>
    <div class="uses">
${uses}
    </div>
  </section>

  <section class="block" aria-labelledby="exemple">
    <span class="eyebrow-l">Un exemple concret</span>
    <h2 id="exemple">À quoi ça ressemble, en vrai</h2>
    <div class="scenario">${esc(v.scenario)}</div>
  </section>

  <section class="block" aria-labelledby="faq">
    <span class="eyebrow-l">Bon à savoir</span>
    <h2 id="faq">Questions fréquentes</h2>
    <div class="faq">
${v.faq.map(([q, a]) => `      <details><summary>${esc(q)}</summary><div class="a">${esc(a)}</div></details>`).join('\n')}
    </div>
  </section>

  <section class="block" aria-labelledby="autres">
    <span class="eyebrow-l">Autres métiers</span>
    <h2 id="autres">Keystone s'adapte aussi à…</h2>
    <div class="chips">
${others}
    </div>
  </section>

  <section class="band">
    <h2>Prêt à alléger votre quotidien ?</h2>
    <p>Activez les outils utiles à votre métier dans un seul cockpit. Démarrez en quelques minutes, sans carte bancaire.</p>
    <a class="btn btn-primary" href="/activate">Commencer ${ARROW}</a>
  </section>

${FOOT()}

</div>
</body>
</html>
`;
}

function expPage(x) {
  const url = `${ORIGIN}/cas-usage/${x.slug}`;
  const qrIcon = toolIcon('smart-qr');
  const scen = x.scenarios.map(([t, l]) =>
    `      <div class="ucard"><span class="ic">${ICON_WRAP(qrIcon)}</span><h3>${esc(t)}</h3><p>${esc(l)}</p></div>`).join('\n');
  const metiers = x.metiers.map(s => {
    const v = VERTICALS.find(z => z.slug === s);
    return v ? `      <a class="chip" href="/pour/${v.slug}">${esc(v.metier)}</a>` : '';
  }).filter(Boolean).join('\n');
  const graph = [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Cas d’usage', item: `${ORIGIN}/#metiers` },
      { '@type': 'ListItem', position: 3, name: x.label, item: url },
    ] },
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: x.title, inLanguage: 'fr-FR',
      isPartOf: { '@id': `${ORIGIN}/#website` }, about: { '@id': `${ORIGIN}/#organization` }, description: x.desc },
    { '@type': 'FAQPage', mainEntity: x.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(x.title)}</title>
<meta name="description" content="${escAttr(x.desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${escAttr(x.title)}">
<meta property="og:description" content="${escAttr(x.desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="Keystone OS">
<meta property="og:locale" content="fr_FR">
<meta property="og:image" content="${ORIGIN}/og-cover.png">
<meta property="og:image:width" content="2400">
<meta property="og:image:height" content="1260">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(x.title)}">
<meta name="twitter:description" content="${escAttr(x.desc)}">
<meta name="twitter:image" content="${ORIGIN}/og-cover.png">
<meta name="theme-color" content="#020617">
<link rel="icon" href="/keystone-puce.svg" type="image/svg+xml">
<script type="application/ld+json">
${jsonld({ '@context': 'https://schema.org', '@graph': graph })}
</script>
<style>
${STYLE}
</style>
</head>
<body>

<nav class="nav">
  <a class="nav-logo" href="/"><img src="/keystone-puce.svg" alt="">Keystone</a>
  <a class="nav-cta" href="/activate">Se connecter</a>
</nav>

<div class="wrap">

  <nav class="crumb" aria-label="Fil d'Ariane">
    <a href="/">Accueil</a> &nbsp;/&nbsp; <a href="/#metiers">Cas d'usage</a> &nbsp;/&nbsp; <span>${esc(x.label)}</span>
  </nav>

  <header class="hero">
    <span class="eyebrow">${ICON_WRAP(qrIcon)} Expérience Smart QR</span>
    <h1>${esc(x.h1a)}<br><em>${esc(x.h1b)}</em></h1>
    <p class="lead">${esc(x.intro)}</p>
    <div class="ctas">
      <a class="btn btn-primary" href="/activate">Commencer ${ARROW}</a>
      <a class="btn btn-ghost" href="/outils/smart-qr">Découvrir Smart QR</a>
    </div>
    <p class="trust">Sans carte bancaire · vos données restent à vous, hébergées en Europe</p>
  </header>

  <section class="block" aria-labelledby="cest">
    <span class="eyebrow-l">Le principe</span>
    <h2 id="cest">Ce que c'est, concrètement</h2>
    <p class="sub">${esc(x.what)}</p>
  </section>

  <section class="block" aria-labelledby="cas">
    <span class="eyebrow-l">Cas concrets</span>
    <h2 id="cas">Quelques façons de s'en servir</h2>
    <div class="uses">
${scen}
    </div>
  </section>

  <section class="block" aria-labelledby="faq">
    <span class="eyebrow-l">Bon à savoir</span>
    <h2 id="faq">Questions fréquentes</h2>
    <div class="faq">
${x.faq.map(([q, a]) => `      <details><summary>${esc(q)}</summary><div class="a">${esc(a)}</div></details>`).join('\n')}
    </div>
  </section>

  <section class="block" aria-labelledby="metiers">
    <span class="eyebrow-l">Pour quels métiers</span>
    <h2 id="metiers">Particulièrement utile pour…</h2>
    <div class="chips">
${metiers}
    </div>
  </section>

  <section class="band">
    <h2>Envie d'essayer ?</h2>
    <p>Cette expérience fait partie de Smart QR, dans votre OS Keystone. Activez ce qu'il vous faut, démarrez en quelques minutes.</p>
    <a class="btn btn-primary" href="/activate">Commencer ${ARROW}</a>
  </section>

${FOOT()}

</div>
</body>
</html>
`;
}

// ── ecriture pages ──────────────────────────────────────────────
mkdirSync(POUR, { recursive: true });
VERTICALS.forEach((v, i) => writeFileSync(resolve(POUR, `${v.slug}.html`), page(v, i), 'utf8'));
mkdirSync(CASUSAGE, { recursive: true });
EXPERIENCES.forEach(x => writeFileSync(resolve(CASUSAGE, `${x.slug}.html`), expPage(x), 'utf8'));

// ── sitemap COMPLET (proprietaire unique) ───────────────────────
const toolSlugs = Object.values(TOOL);
// Pages de confiance (generees par gen-trust-pages.mjs ; le sitemap reste ici).
const TRUST_PAGES = ['a-propos', 'securite', 'confidentialite', 'mentions-legales', 'cgu', 'cgv', 'dpa', 'reversibilite', 'changelog', 'roadmap', 'status'];
const urls = [
  { loc: `${ORIGIN}/`, pr: '1.0', cf: 'weekly' },
  { loc: `${ORIGIN}/faq`, pr: '0.7', cf: 'monthly' },
  ...toolSlugs.map(s => ({ loc: `${ORIGIN}/outils/${s}`, pr: '0.8', cf: 'monthly' })),
  ...VERTICALS.map(v => ({ loc: `${ORIGIN}/pour/${v.slug}`, pr: '0.7', cf: 'monthly' })),
  ...EXPERIENCES.map(x => ({ loc: `${ORIGIN}/cas-usage/${x.slug}`, pr: '0.7', cf: 'monthly' })),
  { loc: `${ORIGIN}/a-propos`, pr: '0.6', cf: 'monthly' },
  ...TRUST_PAGES.filter(s => s !== 'a-propos').map(s => ({ loc: `${ORIGIN}/${s}`, pr: '0.4', cf: 'yearly' })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u2 => `  <url>
    <loc>${u2.loc}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${u2.cf}</changefreq>
    <priority>${u2.pr}</priority>
  </url>`).join('\n')}
</urlset>
`;
writeFileSync(resolve(ROOT, 'sitemap.xml'), sitemap, 'utf8');

console.log(`OK -> ${VERTICALS.length} pages /pour/*.html + ${EXPERIENCES.length} pages /cas-usage/*.html + sitemap.xml complet (${urls.length} URLs).`);
