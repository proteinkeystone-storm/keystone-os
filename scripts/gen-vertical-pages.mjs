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
};
const TOOL_APP = { // pour relire l'icone depuis TOOLS d'index.html
  'smart-qr': 'A-COM-001', 'brief-prod': 'A-COM-002', 'brainstorming': 'A-COM-003', 'key-form': 'A-COM-004',
  'ghost-writer': 'A-COM-005', 'smart-agent': 'O-AGT-001', 'social-manager': 'O-SOC-001', 'sentinel': 'O-GEO-001', 'keynapse': 'O-Keyn-001', 'missive': 'O-SEC-001',
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
    h1a: 'Vendez plus vite,', h1b: 'sans noyer vos journees dans l’administratif.',
    title: 'Keystone pour l’immobilier — agent IA, QR, visibilite | Keystone OS',
    desc: 'Agences, promoteurs, mandataires : un agent IA qui repond a vos acquereurs 24/7 derriere un QR, un concierge virtuel pour vos programmes neufs, et le suivi de votre visibilite web et IA.',
    intro: 'Entre les questions des acquereurs a toute heure, les visites a organiser et la presence en ligne, le metier deborde. Keystone fait repondre un agent IA a votre place, accueille vos prospects par QR et surveille votre visibilite — pour vous garder sur le terrain.',
    uses: [
      u('smart-agent', 'Un agent IA qui repond aux acquereurs (dispo du bien, charges, DPE, financement) derriere un QR sur la vitrine ou la bache chantier — sans inventer.'),
      u('sentinel', 'Surveillez votre visibilite en ligne et dans les IA : quand un prospect demande « agence a [ville] » a ChatGPT, etes-vous cite ?'),
      ue('concierge', 'QR Concierge virtuel','Un seul QR par programme neuf : page d’accueil a votre marque, cartes de comparaison des lots et chat qui repond depuis un bloc valide.'),
      ue('qr-sonnette', 'QR Ring','Un QR sur le portail d’un bien a visiter ou sans interphone : le visiteur vous joint d’un geste (appel, SMS, WhatsApp), sans electricite.'),
    ],
    scenario: 'Un prospect scanne le QR sur la bache d’un programme neuf a 22h. L’agent IA lui detaille les surfaces, les prestations et les disponibilites, capte sa demande de visite via un formulaire, et vous retrouvez le lead qualifie le lendemain matin — sans avoir decroche votre telephone.',
    faq: [
      ['L’agent IA peut-il inventer des informations sur un bien ?', 'Non. Il ne repond qu’a partir des fiches que vous avez validees (descriptif, charges, diagnostics). S’il ne sait pas, il le dit et la question remonte dans sa liste a completer.'],
    ],
  },
  {
    slug: 'restaurants', metier: 'Restaurants & cafes',
    h1a: 'Une carte qui change,', h1b: 'des clients qui ont toujours la bonne info.',
    title: 'Keystone pour les restaurants & cafes — menu QR, agent IA, reseaux | Keystone OS',
    desc: 'Restaurants, cafes, food-trucks : un menu QR modifiable sans reimprimer, un agent IA qui repond (horaires, allergenes, reservation) et vos plats du jour publies partout en un clic.',
    intro: 'La carte evolue, les questions reviennent (vous etes ouverts ? vegan ? terrasse ?), et il faut nourrir les reseaux. Keystone met tout en pilote automatique sans perdre l’ame de la maison.',
    uses: [
      u('smart-qr', 'Un QR sur la table qui pointe vers votre menu : changez un plat ou un prix sans reimprimer un seul flyer.'),
      u('smart-agent', 'Un agent IA qui repond 24/7 aux questions recurrentes : horaires, allergenes, menu enfant, reservation de groupe.'),
      u('social-manager', 'Le plat du jour publie d’un coup sur Facebook, Instagram et Threads — ou programme pour 11h pile.'),
      u('sentinel', 'Suivez vos avis et votre presence locale, et voyez si les IA vous recommandent quand on cherche « ou manger a [ville] ».'),
      ue('carte-fidelite', 'Carte de fidélité dématérialisée','La fidelite sans carte plastique : le client cumule des tampons en scannant, la recompense se debloque toute seule (le 10e cafe offert, par ex.).'),
    ],
    scenario: 'Vendredi, vous changez l’ardoise du midi : deux clics, le menu QR est a jour et le plat du jour part sur tous vos reseaux. A 19h, un client demande au QR s’il y a une option sans gluten — l’agent repond instantanement, table reservee, sans interrompre le service.',
    faq: [
      ['Dois-je reimprimer mes QR a chaque changement de carte ?', 'Non. Le QR est dynamique : il pointe vers une page que vous modifiez quand vous voulez. Le meme QR imprime reste valable.'],
      ['L’agent peut-il prendre une reservation ?', 'Il repond aux questions et oriente vers votre canal de reservation (formulaire, telephone, lien). Il ne remplace pas un logiciel de caisse ou de booking, il filtre et qualifie en amont.'],
      ['Quels reseaux sont geres ?', 'Facebook, Instagram, Threads et Telegram, en publication immediate ou programmee.'],
    ],
  },
  {
    slug: 'commercants', metier: 'Commercants & boutiques',
    h1a: 'Votre boutique repond,', h1b: 'meme rideau baisse.',
    title: 'Keystone pour les commercants — QR vitrine, agent IA, fidelite, reseaux | Keystone OS',
    desc: 'Boutiques et commerces de proximite : un QR vitrine qui annonce vos promos, un agent IA qui repond apres la fermeture, des formulaires de fidelite et vos posts sur tous vos reseaux.',
    intro: 'Un client passe devant a 21h, a une question, et repart. Keystone transforme votre vitrine et vos reseaux en vendeur disponible en permanence.',
    uses: [
      u('smart-qr', 'Un QR en vitrine vers la promo du moment, modifiable a la volee — affiche une fois, mis a jour autant que vous voulez.'),
      u('smart-agent', 'Un agent IA qui repond hors horaires : stock, tailles, click-and-collect, retours.'),
      u('key-form', 'Un formulaire d’inscription au programme de fidelite ou a la liste des arrivages, partageable par lien ou QR.'),
      u('social-manager', 'Vos nouveautes publiees sur tous vos reseaux en un clic, ou programmees pour le matin.'),
      ue('carte-fidelite', 'Carte de fidélité dématérialisée','Un programme de fidelite dematerialise : tampons cumules par scan, recompense automatique au Ne passage, zero carte a imprimer ni a perdre.'),
    ],
    scenario: 'Le dimanche, boutique fermee : un passant scanne la vitrine, decouvre la promo en cours, pose une question sur une taille a l’agent IA, et s’inscrit a votre liste d’arrivages via un mini-formulaire. Lundi, vous avez un nouveau client fidele sans avoir leve le petit doigt.',
    faq: [
      ['Faut-il un site web pour utiliser tout ca ?', 'Non. Le QR, l’agent et les formulaires fonctionnent par simple lien ou QR — aucun site requis. Si vous avez un site, ca s’y integre aussi.'],
      ['Mes clients doivent-ils creer un compte ?', 'Non. Ils posent leurs questions a l’agent et remplissent les formulaires sans compte, de maniere anonyme.'],
      ['Mes donnees clients sont-elles protegees ?', 'Oui : hebergement en Europe, conformite RGPD native, conservation parametrable, aucune revente.'],
    ],
  },
  {
    slug: 'artisans', metier: 'Artisans du batiment',
    h1a: 'Vous etes sur le chantier.', h1b: 'Vos devis ne s’envolent plus.',
    title: 'Keystone pour les artisans — demandes de devis, agent IA, QR vehicule | Keystone OS',
    desc: 'Plombiers, electriciens, menuisiers, macons : captez les demandes de devis 24/7, laissez un agent IA repondre aux premieres questions et soignez vos courriers pro.',
    intro: 'Quand vous etes les mains dans le cambouis, vous ne decrochez pas — et le client appelle le suivant. Keystone capte la demande pendant que vous travaillez.',
    uses: [
      u('key-form', 'Un formulaire de demande de devis structure (type de travaux, photos via lien, urgence, adresse) que le client remplit seul.'),
      u('smart-agent', 'Un agent IA qui repond aux questions recurrentes (zone d’intervention, delais, types de prestations) et qualifie avant de vous deranger.'),
      u('smart-qr', 'Un QR sur le vehicule et la carte de visite qui mene direct au formulaire de demande.'),
      u('ghost-writer', 'Vos mails et relances de devis reecrits dans un ton pro et clair, sans y passer la soiree.'),
      ue('qr-sonnette', 'QR Ring','Un QR sur un acces de chantier sans electricite ni interphone : client, livreur ou riverain vous joint d’un geste (appel, SMS, WhatsApp).'),
    ],
    scenario: 'Un particulier voit votre camion, scanne le QR a un feu rouge, decrit sa fuite et joint une photo via le formulaire. L’agent confirme votre zone d’intervention et le delai indicatif. Le soir, vous traitez une demande deja qualifiee au lieu d’un appel manque.',
    faq: [
      ['Je n’ai pas le temps de configurer un truc complique.', 'Le formulaire et l’agent partent d’un gabarit metier pre-rempli : vous ajustez deux-trois champs et c’est en ligne. Pas de code, pas de site a construire.'],
      ['L’agent va-t-il s’engager sur un prix a ma place ?', 'Non. Il informe (zone, delais, prestations) et collecte la demande. Le chiffrage reste le votre.'],
      ['Comment je recois les demandes ?', 'Par e-mail, des qu’un formulaire est rempli. Vous gardez l’historique au meme endroit.'],
    ],
  },
  {
    slug: 'hotellerie', metier: 'Hotellerie & locations saisonnieres',
    h1a: 'Un concierge qui ne dort jamais,', h1b: 'pour des voyageurs autonomes.',
    title: 'Keystone pour l’hotellerie & les locations — livret QR, concierge IA | Keystone OS',
    desc: 'Hotels, gites, chambres d’hotes, locations Airbnb : un livret d’accueil et un Wi-Fi en QR, un concierge IA qui repond aux voyageurs et un suivi de votre reputation en ligne.',
    intro: 'Les memes questions, a toute heure : le code Wi-Fi, l’heure du check-out, ou diner. Keystone repond a votre place et libere vos soirees.',
    uses: [
      u('smart-qr', 'Un QR « livret d’accueil » + un QR Wi-Fi dans le logement : tout ce qu’il faut savoir, sans classeur papier.'),
      u('smart-agent', 'Un concierge IA qui repond aux voyageurs (check-in, equipements, recommandations locales) en plusieurs langues, par lien ou QR.'),
      u('key-form', 'Un formulaire d’arrivee (heure d’arrivee, demandes speciales) ou un mini etat des lieux, sans paperasse.'),
      u('sentinel', 'Gardez un oeil sur votre reputation et votre visibilite, y compris quand un voyageur demande conseil a une IA.'),
      ue('qr-sonnette', 'QR Ring','Un QR a l’entree d’un gite sans interphone : le voyageur vous joint d’un geste a l’arrivee (appel, SMS, WhatsApp), sans electricite.'),
    ],
    scenario: 'Un voyageur arrive a 23h, scanne le QR de l’entree : code d’acces, Wi-Fi, fonctionnement du chauffage. Il demande au concierge IA un bon restaurant ouvert — reponse immediate. Vous n’avez pas eu a decrocher, et son sejour commence sans accroc.',
    faq: [
      ['Le concierge IA gere-t-il plusieurs langues ?', 'Oui, il repond dans la langue du voyageur a partir du savoir que vous lui avez fourni.'],
      ['Puis-je avoir un agent par logement ?', 'Oui. Vous pouvez regrouper vos logements et donner a chacun son savoir propre, plus un socle commun (regles maison, contacts).'],
      ['Les voyageurs doivent-ils installer une application ?', 'Non. Tout passe par un simple QR ou lien, sans compte ni application.'],
    ],
  },
  {
    slug: 'beaute', metier: 'Coiffure & beaute',
    h1a: 'Moins de telephone,', h1b: 'plus de clients au fauteuil.',
    title: 'Keystone pour la coiffure & la beaute — QR RDV, agent IA, avant/apres | Keystone OS',
    desc: 'Salons de coiffure, instituts, estheticiennes, barbiers : un agent IA qui repond aux demandes, un QR vers vos prestations et vos avant/apres publies sur tous vos reseaux.',
    intro: 'Le telephone sonne pendant une coupe, on rappelle rarement. Keystone repond a la place du salon et alimente vos reseaux sans y penser.',
    uses: [
      u('smart-agent', 'Un agent IA qui repond aux questions (tarifs, prestations, duree, disponibilites generales) pendant que vous coiffez.'),
      u('smart-qr', 'Un QR a l’accueil et sur le miroir vers vos prestations, votre lien d’avis ou de prise de contact.'),
      u('social-manager', 'Vos avant/apres et offres publies d’un clic sur Instagram, Facebook et Threads.'),
      u('key-form', 'Un formulaire de diagnostic capillaire ou de demande de RDV, rempli par la cliente avant de venir.'),
      ue('carte-fidelite', 'Carte de fidélité dématérialisée','La carte de fidelite sans carte : la cliente cumule ses passages en scannant, la prestation offerte se debloque toute seule.'),
    ],
    scenario: 'En plein shampoing, une cliente potentielle ecrit a l’agent depuis votre lien Instagram : prix d’un balayage, duree. Reponse immediate, formulaire de contact rempli. Le soir, vous publiez l’avant/apres du jour sur trois reseaux en un clic.',
    faq: [
      ['L’agent prend-il les rendez-vous ?', 'Il informe et collecte les demandes (via formulaire ou lien). Pour l’agenda, il oriente vers votre outil de reservation habituel.'],
      ['Je n’ai pas le temps de gerer les reseaux.', 'C’est l’idee : un post, une image, et ca part sur tous vos reseaux d’un coup — ou programme pour le bon creneau.'],
      ['Et si je veux juste essayer un outil ?', 'Keystone est modulaire : vous activez seulement ce qui vous sert, vous etendez quand vous voulez.'],
    ],
  },
  {
    slug: 'sante', metier: 'Professions de sante & bien-etre',
    h1a: 'Votre secretariat repond,', h1b: 'vous restez concentre sur le soin.',
    title: 'Keystone pour les professionnels de sante & bien-etre — agent IA, formulaires | Keystone OS',
    desc: 'Praticiens, cabinets, therapeutes, coachs bien-etre : un agent IA qui repond aux questions pratiques (jamais medicales), des formulaires d’admission et une presence locale soignee.',
    intro: 'Les appels pour des questions pratiques saturent le standard. Keystone repond a ce qui est administratif et vous laisse le soin — sans jamais donner d’avis medical.',
    uses: [
      u('smart-agent', 'Un agent IA cadre sur le pratique : horaires, adresse, documents a apporter, deroulement d’une premiere seance — et qui renvoie vers vous pour tout le reste.'),
      u('key-form', 'Un questionnaire d’admission ou de pre-consultation, rempli en amont, en toute confidentialite.'),
      u('sentinel', 'Soignez votre presence locale (fiche, avis) et votre visibilite quand on cherche un praticien dans votre ville.'),
      u('ghost-writer', 'Vos courriers et informations patients reecrits clairement, dans le bon ton.'),
    ],
    scenario: 'Avant un premier rendez-vous, le patient remplit le formulaire d’admission depuis un lien. Il demande a l’agent ce qu’il doit apporter et combien de temps dure la seance : reponse immediate. Le standard n’a pas sonne, et vous arrivez en consultation avec le dossier deja pret.',
    faq: [
      ['L’agent donne-t-il des conseils medicaux ?', 'Non, jamais. Il est volontairement limite au pratique et a l’administratif (horaires, documents, deroulement) et renvoie systematiquement vers le professionnel pour tout le reste.'],
      ['Les donnees des formulaires sont-elles confidentielles ?', 'Oui : hebergement en Europe, RGPD natif, duree de conservation que vous fixez, suppression automatique a l’echeance.'],
      ['Est-ce adapte a un cabinet de groupe ?', 'Oui. Vous pouvez regrouper plusieurs praticiens avec un socle d’informations commun et des reponses propres a chacun.'],
    ],
  },
  {
    slug: 'artistes', metier: 'Artistes & creatifs',
    h1a: 'Creez.', h1b: 'On s’occupe du reste.',
    title: 'Keystone pour les artistes & creatifs — candidatures, briefs, reseaux | Keystone OS',
    desc: 'Musiciens, photographes, plasticiens, illustrateurs : recevez candidatures et soumissions par formulaire, cadrez vos briefs imprimeur, et diffusez votre actu sur tous vos reseaux.',
    intro: 'Le talent ne suffit pas : il faut gerer les soumissions, briefer les prestataires, animer ses reseaux. Keystone prend la logistique pour vous laisser creer.',
    uses: [
      u('key-form', 'Un formulaire de candidature ou de soumission (appels a projets, demos, commandes) partageable par lien — fini les e-mails eparpilles.'),
      u('brief-prod', 'Un brief beton pour votre graphiste ou imprimeur : evitez l’erreur d’impression qui coute cher.'),
      u('social-manager', 'Votre actu (concert, expo, sortie) publiee d’un clic sur tous vos reseaux, ou programmee.'),
      u('smart-qr', 'Un QR sur vos flyers, pochettes ou cartels d’expo vers votre lien du moment, modifiable sans reimprimer.'),
    ],
    scenario: 'Vous lancez un appel a collaboration : un formulaire centralise toutes les propositions. Pour l’affiche, Brief Prod cadre les specs imprimeur en deux minutes. Le jour J, le QR sur le flyer pointe vers la billetterie, et l’annonce part sur tous vos reseaux.',
    faq: [
      ['Le formulaire gere-t-il des fichiers lourds (audio, video) ?', 'Le repondant colle un lien (WeTransfer, Drive, Dropbox, Vimeo) plutot qu’un upload direct — simple et sans limite de taille.'],
      ['Brief Prod, c’est pour quoi exactement ?', 'Transformer votre intention creative en cahier des charges technique clair pour le graphiste ou l’imprimeur, pour eviter les mauvaises surprises a l’impression.'],
      ['Je peux tout garder a ma main ?', 'Oui. Keystone produit des brouillons et automatise le repetitif ; vous validez et publiez ce que vous voulez.'],
    ],
  },
  {
    slug: 'associations', metier: 'Associations & clubs',
    h1a: 'Plus de membres,', h1b: 'moins de paperasse.',
    title: 'Keystone pour les associations & clubs — adhesions, evenements, reseaux | Keystone OS',
    desc: 'Associations, clubs sportifs, collectifs : gerez adhesions et inscriptions par formulaire, animez vos reseaux, affichez vos evenements en QR et faites bouillonner les idees.',
    intro: 'Les benevoles n’ont pas le temps. Keystone simplifie adhesions, communication et organisation pour que l’energie aille au projet, pas a l’administratif.',
    uses: [
      u('key-form', 'Adhesions, inscriptions aux evenements, appels a benevoles : des formulaires partageables, sans tableur a la main.'),
      u('social-manager', 'Vos actualites et evenements publies sur tous vos reseaux d’un clic.'),
      u('smart-qr', 'Un QR sur vos affiches d’evenement vers l’inscription ou le programme, mis a jour sans reimprimer.'),
      u('brainstorming', 'Une table ronde d’IA pour faire emerger des idees d’actions, de financement ou de communication.'),
    ],
    scenario: 'Pour la fete annuelle, vous creez un formulaire d’inscription en cinq minutes, l’affiche porte un QR qui pointe dessus, et l’evenement part sur tous vos reseaux. En amont, Brainstorming vous a souffle trois idees d’animations auxquelles personne n’avait pense.',
    faq: [
      ['Est-ce adapte a une petite association sans budget tech ?', 'Oui. Pas de site requis, pas de code : des formulaires et des liens, modulaires, que vous activez selon vos besoins.'],
      ['Peut-on recolter des inscriptions sans compte pour les membres ?', 'Oui, les formulaires sont ouverts et anonymes par defaut, avec un code d’acces optionnel si besoin.'],
      ['Comment recupere-t-on les inscriptions ?', 'Par e-mail a chaque envoi, et export possible pour vos suivis.'],
    ],
  },
  {
    slug: 'evenementiel', metier: 'Evenementiel & mariage',
    h1a: 'Le jour J est parfait.', h1b: 'Les coulisses aussi.',
    title: 'Keystone pour l’evenementiel & le mariage — RSVP, briefs, QR programme | Keystone OS',
    desc: 'Wedding planners, traiteurs, agences evenementielles : centralisez les RSVP et preferences, cadrez vos briefs prestataires et affichez programme et plan de table en QR.',
    intro: 'Un evenement, c’est mille details et zero droit a l’erreur. Keystone centralise l’info et fiabilise les echanges avec invites et prestataires.',
    uses: [
      u('key-form', 'RSVP, regimes alimentaires, chansons demandees, navette : tout centralise dans un formulaire, plus de relances par SMS.'),
      u('brief-prod', 'Des briefs nets pour vos prestataires (imprimeur, decorateur, papeterie) — zero malentendu sur les specs.'),
      u('smart-qr', 'Un QR sur le faire-part ou a l’entree vers le programme, le plan de table ou la galerie photo, modifiable jusqu’au dernier moment.'),
      u('social-manager', 'Vos realisations publiees sur tous vos reseaux pour attirer les prochains clients.'),
    ],
    scenario: 'Les invites confirment leur presence et indiquent leurs allergies via un formulaire unique. Le faire-part porte un QR qui menera au plan de table — que vous ajustez la veille sans rien reimprimer. Cote prestataires, le brief imprimeur ne laisse aucune place au doute.',
    faq: [
      ['Peut-on modifier le programme apres impression des faire-part ?', 'Oui : le QR est dynamique, il pointe vers une page que vous mettez a jour quand vous voulez, meme apres impression.'],
      ['Le formulaire gere-t-il beaucoup d’invites ?', 'Oui, avec logique conditionnelle (afficher des questions selon les reponses) et export des reponses.'],
      ['Mes clients voient-ils un outil a leur image ?', 'Vous personnalisez couleurs et logo ; l’ensemble reste sobre et premium.'],
    ],
  },
  {
    slug: 'consultants', metier: 'Consultants & formateurs',
    h1a: 'Votre expertise rayonne,', h1b: 'sans que vous redigiez toute la nuit.',
    title: 'Keystone pour les consultants & formateurs — propositions, agent IA, visibilite | Keystone OS',
    desc: 'Consultants, coachs, formateurs, freelances : redigez propositions et contenus plus vite, laissez un agent IA presenter votre offre et soignez votre visibilite, IA comprise.',
    intro: 'Vous vendez votre temps — chaque heure passee a rediger une proposition ou un post est une heure non facturee. Keystone vous en rend une bonne partie.',
    uses: [
      u('ghost-writer', 'Propositions commerciales, e-mails et posts reecrits dans votre ton, en une fraction du temps.'),
      u('smart-agent', 'Un agent IA qui presente votre offre, repond aux questions frequentes et qualifie les prospects via votre lien ou QR.'),
      u('brainstorming', 'Une table ronde d’IA pour structurer une intervention, un programme de formation ou une strategie de contenu.'),
      u('sentinel', 'Suivez votre visibilite et verifiez si les IA vous citent comme expert sur votre sujet (GEO).'),
    ],
    scenario: 'Un prospect arrive sur votre lien, interroge l’agent sur votre methode et vos tarifs, et laisse ses coordonnees. Pendant ce temps, Ghost Writer vous a degrossi la proposition, et Brainstorming a charpente votre prochain atelier. Vous validez, vous envoyez, vous facturez.',
    faq: [
      ['L’agent peut-il parler a ma place sans dire de betises ?', 'Il ne repond qu’a partir de ce que vous avez valide (offre, methode, FAQ). Hors de ce perimetre, il le dit et renvoie vers vous.'],
      ['Ghost Writer ecrit-il a ma place ou avec moi ?', 'Avec vous : il propose des variantes calibrees (e-mail, marketing, texte long) et corrige ; vous gardez la decision finale.'],
      ['C’est quoi la « visibilite dans les IA » ?', 'De plus en plus de gens posent leurs questions a ChatGPT, Perplexity ou Gemini. Sentinel verifie si vous etes cite dans leurs reponses et comment vous y gagner en presence.'],
    ],
  },
  {
    slug: 'culture', metier: 'Musees & lieux culturels',
    h1a: 'Un guide pour chaque visiteur,', h1b: 'sans audioguide a distribuer.',
    title: 'Keystone pour les musees & lieux culturels — guide IA, QR parcours | Keystone OS',
    desc: 'Musees, galeries, monuments, offices de tourisme : un guide IA accessible par QR, des parcours enrichis et une diffusion de votre programmation sur tous vos reseaux.',
    intro: 'Chaque visiteur a ses questions, dans sa langue, a son rythme. Keystone met un mediateur disponible derriere un simple QR, sans materiel a gerer.',
    uses: [
      u('smart-agent', 'Un guide IA derriere un QR (par salle ou par oeuvre) qui raconte, repond et lit ses reponses a voix haute, dans la langue du visiteur.'),
      u('smart-qr', 'Des QR de parcours sur les cartels, modifiables a chaque nouvelle expo — sans reimprimer la signaletique.'),
      u('social-manager', 'Votre programmation et vos coulisses publiees sur tous vos reseaux d’un clic.'),
      u('key-form', 'Inscriptions aux visites guidees, ateliers ou newsletters, sans file d’attente a l’accueil.'),
    ],
    scenario: 'Devant une oeuvre, un visiteur etranger scanne le cartel : le guide IA lui en raconte l’histoire dans sa langue, a voix haute, et repond a sa question. A la prochaine expo, vous mettez a jour les parcours sans changer un seul panneau, et l’evenement part sur tous vos reseaux.',
    faq: [
      ['Le guide IA fonctionne-t-il sans application ?', 'Oui, uniquement par QR ou lien. Le visiteur n’installe rien et n’a pas de compte a creer.'],
      ['La lecture a voix haute est-elle payante ?', 'Non. La voix neuronale s’execute dans le navigateur du visiteur, sans cout recurrent.'],
      ['Peut-on tout mettre a jour a chaque exposition ?', 'Oui : le savoir du guide et les parcours QR se modifient autant que necessaire, sans toucher a la signaletique imprimee.'],
    ],
  },
  {
    slug: 'sport', metier: 'Sport & remise en forme',
    h1a: 'Vos adherents informes,', h1b: 'votre energie sur le terrain.',
    title: 'Keystone pour le sport & la remise en forme — inscriptions, agent IA, plannings | Keystone OS',
    desc: 'Salles de sport, coachs, clubs, studios : inscriptions et bilans par formulaire, un agent IA qui repond (tarifs, horaires, cours), des plannings en QR et des reseaux nourris.',
    intro: 'Entre les cours, vous n’etes pas a l’accueil. Keystone informe vos adherents et capte les nouveaux pendant que vous coachez.',
    uses: [
      u('smart-agent', 'Un agent IA qui repond aux questions (formules, horaires, niveau requis, essai gratuit) a toute heure.'),
      u('key-form', 'Inscriptions, questionnaire sante/objectifs, reservation d’un cours d’essai — remplis en amont.'),
      u('smart-qr', 'Un QR a l’accueil et sur les machines vers le planning, une video d’exercice ou le lien d’avis.'),
      u('social-manager', 'Vos seances, defis et resultats publies sur tous vos reseaux pour entretenir la communaute.'),
      ue('carte-fidelite', 'Carte de fidélité dématérialisée','Recompensez l’assiduite sans carte plastique : vos adherents cumulent leurs venues par scan, la seance offerte se debloque automatiquement.'),
    ],
    scenario: 'Un curieux passe devant le studio, scanne le QR : tarifs, planning, et il reserve un cours d’essai via le formulaire apres avoir pose deux questions a l’agent. Pendant votre cours, tout s’est fait sans vous, et le defi de la semaine est deja parti sur les reseaux.',
    faq: [
      ['L’agent gere-t-il les reservations de cours ?', 'Il informe et collecte les demandes (formulaire, lien). Pour le planning en temps reel, il renvoie vers votre outil de reservation.'],
      ['Le questionnaire sante est-il confidentiel ?', 'Oui : RGPD natif, hebergement en Europe, conservation parametrable et suppression automatique a l’echeance.'],
      ['Je debute, c’est complique a mettre en place ?', 'Non : gabarits pre-remplis, aucun code, et vous n’activez que les outils utiles.'],
    ],
  },
  {
    slug: 'automobile', metier: 'Garages & automobile',
    h1a: 'L’atelier tourne,', h1b: 'les demandes ne tombent plus a l’eau.',
    title: 'Keystone pour les garages & l’automobile — demandes, agent IA, QR | Keystone OS',
    desc: 'Garages, carrossiers, centres auto, loueurs : captez les demandes d’intervention 24/7, laissez un agent IA repondre aux questions courantes et soignez votre reputation locale.',
    intro: 'Les mains dans le moteur, vous ne repondez pas — et le client appelle le garage d’a cote. Keystone capte et qualifie la demande sans vous interrompre.',
    uses: [
      u('key-form', 'Un formulaire de demande d’intervention (vehicule, panne, photos via lien, disponibilites) rempli par le client.'),
      u('smart-agent', 'Un agent IA qui repond aux questions courantes (prestations, horaires, vehicule de pret, delais) et qualifie avant de vous deranger.'),
      u('smart-qr', 'Un QR sur la devanture et le vehicule de courtoisie vers la prise de contact ou le lien d’avis.'),
      u('sentinel', 'Suivez vos avis et votre presence locale, decisifs pour etre choisi dans votre zone.'),
    ],
    scenario: 'Un automobiliste tombe en panne, cherche un garage, vous trouve grace a votre presence locale soignee, et decrit son probleme via le formulaire avec photos. L’agent confirme vos horaires et la dispo d’un vehicule de pret. Vous rappelez un client deja qualifie, dossier en main.',
    faq: [
      ['L’agent va-t-il annoncer un prix de reparation ?', 'Non. Il informe (prestations, horaires, delais indicatifs) et collecte la demande ; le devis reste de votre ressort apres diagnostic.'],
      ['Comment recevoir les demandes d’intervention ?', 'Par e-mail des qu’un formulaire est rempli, avec les photos et infos du vehicule.'],
      ['Les avis comptent-ils vraiment pour un garage ?', 'Beaucoup : la presence locale et les avis pesent fort dans le choix. Sentinel vous aide a les suivre et a vous ameliorer.'],
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
    title: 'QR Ring — sonnette par QR Code, sans electricite | Keystone OS',
    desc: 'Un QR pose sur un portail ou une porte, sans electricite : on tape « Sonner » et vous — plus les proches que vous ajoutez (conjoint, gardien…) — etes prevenu par notification push, meme application fermee. Repli e-mail et contacts directs inclus.',
    intro: 'Un portail sans interphone, un acces sans electricite, ou l’envie qu’un cercle de proches soit prevenu en un instant : on tape « Sonner » sur le QR Ring, et vous — avec les proches que vous avez ajoutes — recevez une notification, meme application fermee.',
    what: 'Une page hebergee derriere un QR a imprimer, sans electricite. Le visiteur tape « Sonner » et, en un instant, une notification push part vers TOUS les appareils que vous avez abonnes — le votre et ceux des proches ajoutes (conjoint, gardien, voisin…), meme application fermee — avec un repli par e-mail si une notification se perd. Vous pouvez meme repondre : le visiteur voit votre reponse. Et si vous preferez, les contacts directs (appel, SMS, WhatsApp, e-mail) avec message pre-rempli restent disponibles.',
    scenarios: [
      ['Alerter un cercle de proches', 'Un QR pres de la porte d’un parent age ou isole : il tape « Sonner », et tous les proches ajoutes (vous, un frere, un voisin de confiance) sont prevenus par notification au meme moment. Un point d’appel partage et rassurant.'],
      ['Portail ou accès sans interphone', 'Un QR sur le portail : le visiteur tape « Sonner », vous etes prevenu a l’instant sur votre telephone — meme appli fermee. Pas de cablage, pas de boitier, pas d’electricite.'],
      ['Chantier ou lieu sans courant', 'Sur un acces de chantier, un depot, un local en travaux : client, livreur ou riverain vous joint d’un tap, et vous pouvez meme repondre depuis la notification.'],
      ['Accueil quand c’est ferme', 'Boutique fermee, gite, cabinet : on sonne, l’equipe est prevenue ; sinon, contact direct (appel, SMS, WhatsApp) avec message pre-rempli.'],
    ],
    metiers: ['immobilier', 'hotellerie', 'artisans', 'commercants'],
    faq: [
      ['Comment suis-je prevenu quand on sonne ?', 'Par notification push sur tous les appareils que vous avez abonnes — votre telephone, votre ordinateur, et ceux des proches que vous ajoutez — meme application fermee. Un e-mail de secours peut aussi etre envoye au cas ou une notification se perde.'],
      ['Puis-je alerter plusieurs proches a la fois ?', 'Oui. Dans l’onglet Sonneries, vous ajoutez autant d’appareils que vous voulez (conjoint, gardien, voisin…) ; tous recoivent l’alerte quand on sonne, et chacun peut repondre.'],
      ['Est-ce un dispositif d’urgence ou de teleassistance medicale ?', 'Non. C’est un systeme de notification (push, avec repli e-mail), tres pratique pour prevenir vite un cercle de proches — mais la reception n’est pas garantie comme une teleassistance medicale surveillee ; ne le presentez pas comme tel.'],
      ['Faut-il de l’electricite ou une application cote visiteur ?', 'Non. Le visiteur scanne un QR imprime et tape « Sonner » depuis son propre telephone, sans rien installer.'],
    ],
  },
  {
    slug: 'carte-fidelite', label: 'Carte de fidélité dématérialisée',
    h1a: 'La carte de fidélité,', h1b: 'sans la carte.',
    title: 'Carte de fidelite par QR, sans support physique | Keystone OS',
    desc: 'Une carte de fidelite dematerialisee : vos clients cumulent des tampons en scannant un QR, la recompense se debloque toute seule au Ne passage. Zero carte plastique a imprimer ni a perdre.',
    intro: 'Les cartes a tampons en carton se perdent, s’oublient et coutent a imprimer. Le meme principe, en un QR : vos clients cumulent leurs passages sans rien sortir de leur poche.',
    what: 'Vos clients scannent le QR a chaque passage ; les tampons se cumulent automatiquement, l’etat etant tenu cote serveur (pas sur un bout de carton). Au Ne tampon, la recompense se debloque avec un code a presenter en caisse. Vous fixez le nombre de tampons (de 3 a 30) et la duree de validite. Aucune carte physique, aucune application a installer.',
    scenarios: [
      ['Cafés & restaurants', 'Le 10e cafe offert, la formule midi fidelite : le compteur tourne tout seul a chaque scan en caisse.'],
      ['Boutiques & commerces', 'Recompensez les passages reguliers sans gerer un fichier ni imprimer des cartes a perdre.'],
      ['Coiffure & beauté', 'La prestation offerte au bout de N visites, debloquee automatiquement, code en caisse.'],
      ['Sport & loisirs', 'Recompensez l’assiduite : la seance offerte se debloque apres N venues scannees.'],
    ],
    metiers: ['restaurants', 'commercants', 'beaute', 'sport'],
    faq: [
      ['Le client doit-il installer une application ?', 'Non. Il scanne le QR, c’est tout. Le cumul se fait automatiquement, sans compte ni appli.'],
      ['Comment la recompense est-elle validee ?', 'Au Ne tampon, un code s’affiche cote client, a presenter ou saisir en caisse pour debloquer la recompense.'],
      ['Combien de tampons puis-je demander ?', 'De 3 a 30, avec une duree de validite que vous fixez vous-meme.'],
      ['Faut-il un site web ?', 'Non. Il suffit du QR : sur le comptoir, le ticket de caisse, la vitrine ou un flyer.'],
    ],
  },
  {
    slug: 'concierge', label: 'QR Concierge virtuel',
    h1a: 'Un QR.', h1b: 'Un programme entier qui se présente et répond tout seul.',
    title: 'QR Concierge virtuel — un programme qui se presente et repond, en marque blanche | Keystone OS',
    desc: 'Un QR concierge white-label : page d’accueil a votre marque, cartes de comparaison et chat qui repond depuis un bloc de connaissance valide. 1 QR = 1 programme complet. Pense d’abord pour l’immobilier neuf.',
    intro: 'Vos prospects veulent tout savoir, tout de suite, a toute heure. Le QR Concierge met un point d’information complet derriere un seul code, a votre marque.',
    what: 'Derriere un seul QR : une page d’accueil a votre marque, des cartes de comparaison deterministes (lots, prestations, options…) et un chat qui repond UNIQUEMENT depuis un bloc de connaissance que vous avez valide — jamais d’invention. Pense d’abord pour les programmes immobiliers neufs (VEFA) : 1 QR = 1 programme complet, en marque blanche.',
    scenarios: [
      ['Programme immobilier neuf', 'Un QR sur la bache de chantier ou la bulle de vente : le prospect compare les lots et pose ses questions, jour et nuit, sans mobiliser un commercial.'],
      ['Bulle de vente & salons', 'Un point d’information autonome, a votre marque, qui complete l’equipe sans la remplacer.'],
      ['Residences & lieux a presenter', 'Tout ce qu’il faut savoir sur un lieu, structure et a jour, derriere un seul code.'],
    ],
    metiers: ['immobilier', 'hotellerie'],
    faq: [
      ['Le chat invente-t-il des reponses ?', 'Non. Il repond uniquement depuis le bloc de connaissance que vous avez valide. Hors de ce perimetre, il le dit plutot que d’inventer.'],
      ['Pour quel secteur est-ce concu ?', 'D’abord pour l’immobilier neuf (VEFA) : un QR par programme. La logique « 1 QR = 1 lieu a presenter » s’etend a d’autres contextes.'],
      ['Est-ce a ma marque ?', 'Oui, c’est du white-label : logo, couleurs et contenu sont les votres.'],
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
        <a href="mailto:protein.keystone@gmail.com">protein.keystone@gmail.com</a>
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
    <p class="trust">Sans carte bancaire · vos donnees restent a vous, hebergees en Europe</p>
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
    <h2 id="exemple">A quoi ca ressemble, en vrai</h2>
    <div class="scenario">${esc(v.scenario)}</div>
  </section>

  <section class="block" aria-labelledby="faq">
    <span class="eyebrow-l">Bon a savoir</span>
    <h2 id="faq">Questions frequentes</h2>
    <div class="faq">
${v.faq.map(([q, a]) => `      <details><summary>${esc(q)}</summary><div class="a">${esc(a)}</div></details>`).join('\n')}
    </div>
  </section>

  <section class="block" aria-labelledby="autres">
    <span class="eyebrow-l">Autres metiers</span>
    <h2 id="autres">Keystone s'adapte aussi a…</h2>
    <div class="chips">
${others}
    </div>
  </section>

  <section class="band">
    <h2>Pret a alleger votre quotidien ?</h2>
    <p>Activez les outils utiles a votre metier dans un seul cockpit. Demarrez en quelques minutes, sans carte bancaire.</p>
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
    <p class="trust">Sans carte bancaire · vos donnees restent a vous, hebergees en Europe</p>
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
    <span class="eyebrow-l">Bon a savoir</span>
    <h2 id="faq">Questions frequentes</h2>
    <div class="faq">
${x.faq.map(([q, a]) => `      <details><summary>${esc(q)}</summary><div class="a">${esc(a)}</div></details>`).join('\n')}
    </div>
  </section>

  <section class="block" aria-labelledby="metiers">
    <span class="eyebrow-l">Pour quels metiers</span>
    <h2 id="metiers">Particulierement utile pour…</h2>
    <div class="chips">
${metiers}
    </div>
  </section>

  <section class="band">
    <h2>Envie d'essayer ?</h2>
    <p>Cette experience fait partie de Smart QR, dans votre OS Keystone. Activez ce qu'il vous faut, demarrez en quelques minutes.</p>
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
