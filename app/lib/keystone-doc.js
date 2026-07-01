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
