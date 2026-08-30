// ─────────────────────────────────────────────────────────────────────────
// SENTINEL · S18 — générateur de correctifs clé en main (PUR, testable seul).
//   Extrait de routes/sentinel.js (S4) ; consommé par lui et par les tests
//   (workers/test/sentinel-audit.test.mjs).
//
// RÈGLE D'OR (S18/P0, vérifiée par le banc) : AUCUN « code prêt à coller »
// ne doit pouvoir casser un site en production s'il est appliqué
// littéralement. Confrontation du 29/08 sur un site entièrement connu :
//   · la CSP livrée (`default-src 'self'` bloquante) aurait supprimé un
//     agent embarqué et un lecteur de livre — comme sur la quasi-totalité
//     des sites réels (iframe, police CDN, analytics, inline) ;
//   · le HSTS livré (`includeSubDomains`) rend inaccessibles jusqu'à UN AN
//     les sous-domaines restés en HTTP ;
//   · le canonical livré portait l'URL de la HOME, avec des étapes « Site
//     Wide Header » : collé tel quel, il désindexait tout le site au profit
//     de la page d'accueil ;
//   · le gabarit LocalBusiness portait un numéro PLAUSIBLE (+33 1 23 45 67 89)
//     et aucune étape ne disait de le remplacer : collé tel quel, il publiait
//     de fausses coordonnées que Google reprend.
// Les correctifs risqués sont donc soit OBSERVATOIRES (CSP Report-Only :
// n'a par définition aucun effet bloquant), soit GRADUÉS (HSTS sans
// includeSubDomains, montée en puissance dite), soit À TROUS non collables
// aveuglément (canonical « [adresse exacte de cette page] », téléphone
// « +33 X XX XX XX XX » non composable).
// ─────────────────────────────────────────────────────────────────────────
import { dedupeFixCode } from './audit-page.js';

function _headSteps(platform) {
  if (platform === 'wordpress') return ['Installez l\'extension gratuite « WPCode » (Extensions › Ajouter, puis Activer).', 'Code Snippets › + Add Snippet › code HTML, emplacement « Site Wide Header ».', 'Collez le code ci-dessous, enregistrez et activez.'];
  if (platform === 'wix') return ['Dans Wix : Réglages › Code personnalisé (Custom Code) › + Ajouter.', 'Collez le code, placez-le dans le <head>, appliquez à « Toutes les pages ».', 'Enregistrez.'];
  return ['Collez le code ci-dessous dans la balise <head> de votre page (thème/gabarit).', 'Ou transmettez ce bloc à votre webmaster.'];
}

// S18/P0 — l'étape qui rend le gabarit LocalBusiness inoffensif : sans elle,
// « collez le balisage ci-dessous » publiait les coordonnées d'EXEMPLE.
const LOCALBIZ_PERSONALIZE = 'Remplacez CHAQUE valeur d\'exemple (nom, téléphone, adresse, horaires) par les vôtres avant de coller : publiées telles quelles, des coordonnées d\'exemple seraient reprises par Google et les IA.';
function _localBizCode(origin) {
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": "${origin}/#business",
  "name": "Nom de votre établissement",
  "url": "${origin}",
  "telephone": "+33 X XX XX XX XX",
  "address": { "@type": "PostalAddress", "streetAddress": "12 rue Exemple", "addressLocality": "Ville", "postalCode": "00000", "addressCountry": "FR" },
  "openingHours": "Mo-Fr 09:00-18:00",
  "priceRange": "€€"
}
</script>`;
}

// ── Correctifs NATIFS Wix (V2 · intégration Wix) ────────────────
// Pour un site Wix, on guide via l'UI Wix réelle (tableau de bord / éditeur)
// plutôt que par injection de code <head> — c'est là qu'un utilisateur Wix
// agit vraiment. Renvoie null pour les clés non couvertes (→ switch générique,
// qui garde des branches Wix pour les en-têtes sécurité).
function _wixFix(key, ctx) {
  let origin = ctx.url || ''; try { origin = new URL(ctx.url).origin; } catch (_) {}
  switch (key) {
    case 'meta_length':
    case 'meta_missing': return { steps: [
      'Tableau de bord Wix › Marketing et SEO › « Outils SEO » (ou, dans l\'éditeur, ouvrez la page et cliquez l\'icône SEO).',
      'Section « Aperçu sur Google » › champ « Description » : rédigez 50 à 160 caractères qui donnent envie de cliquer.',
      'Enregistrez, puis Publiez le site.'] };
    case 'title_missing': case 'title_long': return { steps: [
      'Dans l\'éditeur Wix : ouvrez la page › panneau SEO de la page › « Titre SEO (balise title) ».',
      ctx.siteKind === 'online' ? 'Visez 50 à 60 caractères, format conseillé : [Activité ou promesse] | [Nom].' : 'Visez 50 à 60 caractères, format conseillé : [Activité] à [Ville] | [Nom].',
      'Enregistrez et publiez.'] };
    case 'og_title': case 'og_image': return { steps: [
      'Éditeur Wix › ouvrez la page › panneau SEO › onglet « Partage sur les réseaux sociaux ».',
      'Définissez le titre et surtout l\'IMAGE de partage (recommandé 1200 × 630 px).',
      'Enregistrez et publiez.'] };
    case 'img_alt': return { steps: [
      'Éditeur Wix : cliquez l\'image › icône « Réglages » › champ « Texte alternatif ».',
      'Décrivez l\'image en une courte phrase (utile pour Google Images et l\'accessibilité).',
      'Répétez pour chaque image signalée, puis publiez.'] };
    case 'lang': return { steps: [
      'Tableau de bord Wix › Réglages › « Langues du site » : assurez-vous que le français est la langue principale.',
      'Wix renseigne alors automatiquement lang="fr" ; republiez le site.'] };
    case 'h1': return { steps: [
      'Éditeur Wix : sélectionnez le titre principal de la page › dans la barre de texte, choisissez le style « Titre 1 ».',
      'Gardez UN seul Titre 1 par page ; passez les sous-titres en « Titre 2 / 3 ».',
      'Publiez.'] };
    // S16/C24 — Wix génère TOUT SEUL une fiche « Local Business » sur la page
    // d'accueil dès que « Infos de l'entreprise » contient un nom et une
    // adresse. Elle n'a pas d'@id : elle reste étrangère au bloc que vous avez
    // ajouté vous-même. Wix permet de la convertir en balisage personnalisé —
    // c'est là qu'on pose l'@id commun (ou qu'on l'exclut, si votre bloc est
    // plus riche : LodgingBusiness bat LocalBusiness pour un hébergement).
    case 'jsonld_entity_split': return { steps: [
      'Tableau de bord Wix › Marketing et SEO › « Réglages SEO » › choisissez le type de page « Page d\'accueil » › « Personnaliser les valeurs par défaut ».',
      'Ouvrez le balisage « Local Business » : « Aperçu du préréglage » puis « Convertir en balisage personnalisé » (c\'est ce qui rend le JSON-LD éditable).',
      `Dans le code, ajoutez la ligne "@id" avec EXACTEMENT la même valeur que dans votre propre bloc : "@id": "${origin || 'https://votre-domaine.fr'}/#business". Deux fiches qui partagent un @id sont fusionnées en une seule entité.`,
      'Variante plus radicale, si votre bloc maison est le plus complet : au même endroit, EXCLUEZ le balisage Local Business de la page d\'accueil — vous ne gardez qu\'une fiche, la vôtre.',
      'Enregistrez, puis PUBLIEZ (c\'est la publication qui purge le cache Wix).',
      'Contrôlez avec l\'outil de test des résultats enrichis de Google : une seule entité doit apparaître.'],
      codeLabel: 'La ligne à ajouter dans le balisage Wix', code:
`"@id": "${origin || 'https://votre-domaine.fr'}/#business"` };
    case 'canonical': return { steps: [
      'Wix gère les balises canoniques automatiquement — en général, rien à faire.',
      'Si vraiment nécessaire : éditeur › page › panneau SEO › « Avancé » › « Balise canonique ».'] };
    case 'viewport': return { steps: [
      'Les sites Wix sont responsives : la balise viewport est ajoutée automatiquement.',
      'Si elle est signalée absente, vérifiez qu\'un code personnalisé injecté dans le <head> ne la supprime pas.'] };
    case 'sitemap': return { steps: [
      `Wix génère et met à jour votre sitemap automatiquement : ${origin}/sitemap.xml — rien à créer.`,
      'Soumettez-le une seule fois dans Google Search Console › « Sitemaps ».'] };
    // S18/P2 — noindex : sur Wix c'est un réglage par page, jamais du code.
    case 'noindex': return { steps: [
      'Éditeur Wix : ouvrez la page › panneau SEO de la page › onglet « Basiques ».',
      'Activez « Autoriser les moteurs de recherche à indexer cette page ».',
      'Publiez, puis vérifiez dans Google Search Console (Inspection d\'URL) que la page redevient indexable.'] };
    case 'jsonld': case 'nap_localbiz': case 'nap_address': case 'nap_phone': case 'nap_hours': return {
      steps: [
        'Tableau de bord Wix › Réglages › « Infos de l\'entreprise » : renseignez le nom, l\'adresse, le téléphone et les horaires.',
        'Wix publie alors automatiquement votre fiche et vos données structurées (LocalBusiness).',
        'Affichez aussi ces infos sur une page Contact (adresse complète, numéro en lien cliquable). Pour aller plus loin, le balisage ci-dessous peut être collé via Réglages › Code personnalisé (head).',
        LOCALBIZ_PERSONALIZE],
      codeLabel: 'Données structurées LocalBusiness (optionnel — avancé, à personnaliser)',
      code: _localBizCode(origin) };
    case 'perf_lcp': return { steps: [
      'Wix sert déjà vos images en format optimisé (WebP) — le levier principal est ailleurs.',
      'Allégez la page d\'accueil : limitez les applications tierces, les vidéos d\'arrière-plan et les animations.',
      'Éditeur › « Optimiser le site » (Site Speed) : suivez les recommandations Wix.'] };
    case 'perf_cls': return { steps: [
      'Évitez les bannières/pop-ups qui apparaissent après le chargement et décalent la page.',
      'Éditeur Wix › « Optimiser le site » : appliquez les conseils de stabilité d\'affichage.'] };
    case 'perf_weight': return { steps: [
      'Réduisez le nombre d\'applications Wix (App Market) et de scripts tiers ajoutés à la page.',
      'Remplacez les vidéos d\'arrière-plan lourdes par une image ; limitez les polices personnalisées.'] };
  }
  return null;
}

// S18/P0 — en-têtes de sécurité : étapes + code par en-tête. Les deux
// en-têtes capables de casser un site (CSP, HSTS) ne sont plus livrés en
// version « brute » : CSP part en Report-Only (observe, ne bloque rien) avec
// la marche à suivre pour passer en bloquant ; HSTS part sans
// includeSubDomains, avec la montée en puissance expliquée.
function _secFix(label, ctx) {
  const common = ['Cet en-tête se règle côté serveur/hébergeur (pas dans le HTML).',
    ctx.platform === 'wordpress' ? 'WordPress : une extension comme « HTTP Headers » permet de l\'ajouter sans code.' : ctx.platform === 'wix' ? 'Wix gère une partie de ces en-têtes (HSTS souvent déjà actif) ; sinon non réglable sans serveur dédié.' : 'Ajoutez cet en-tête dans la config de votre serveur ou de votre CDN.'];
  if (label === 'CSP') {
    return { steps: [
      ...common,
      'IMPORTANT : commencez par la version « Report-Only » ci-dessous — elle OBSERVE sans rien bloquer. Une politique bloquante posée d\'emblée casse presque toujours quelque chose (polices, vidéos, cartes, modules de réservation, statistiques).',
      'Après une à deux semaines, ouvrez la console du navigateur (F12) sur votre site : chaque ressource signalée « Report Only » est à ajouter à la liste des sources autorisées.',
      'Quand plus rien n\'est signalé sur vos pages importantes, renommez l\'en-tête en « Content-Security-Policy » (sans « -Report-Only ») pour activer réellement la protection.'],
      codeLabel: 'En-tête CSP en mode observation (ne bloque rien)',
      code: "Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' https:; style-src 'self' https: 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' https: data:; connect-src 'self' https:; frame-src https:" };
  }
  if (label === 'HSTS') {
    return { steps: [
      ...common,
      'À poser UNIQUEMENT si tout votre site fonctionne déjà en HTTPS (l\'en-tête interdit ensuite le HTTP aux navigateurs, pendant la durée indiquée).',
      'Prudence : validez d\'abord avec une durée courte (max-age=86400, un jour), puis passez à la valeur ci-dessous.',
      'N\'ajoutez « ; includeSubDomains » que si CHACUN de vos sous-domaines (intranet, outils, anciens services) est aussi en HTTPS — sinon vous les rendriez inaccessibles jusqu\'à un an, le temps que les navigateurs oublient la consigne.'],
      codeLabel: 'En-tête HSTS', code: 'Strict-Transport-Security: max-age=31536000' };
  }
  if (label === 'X-Frame-Options') {
    return { steps: [
      ...common,
      'SAMEORIGIN interdit l\'affichage de votre site dans les pages d\'autres domaines (protection contre le détournement de clic). Si votre site DOIT s\'afficher chez un partenaire (iframe), utilisez plutôt : Content-Security-Policy: frame-ancestors \'self\' https://partenaire.fr.',
      'En-tête à transmettre à votre hébergeur/webmaster :'],
      codeLabel: 'En-tête X-Frame-Options', code: 'X-Frame-Options: SAMEORIGIN' };
  }
  const lines = { 'X-Content-Type-Options': 'X-Content-Type-Options: nosniff', 'Referrer-Policy': 'Referrer-Policy: strict-origin-when-cross-origin' };
  return { steps: [...common, 'En-tête à transmettre à votre hébergeur/webmaster :'],
    codeLabel: `En-tête ${label}`, code: lines[label] || `${label}: ...` };
}

export function fixFor(key, ctx, f) {
  const url = ctx.url || '';
  let origin = url; try { origin = new URL(url).origin; } catch (_) {}
  const head = _headSteps(ctx.platform);
  // Site Wix → privilégier le correctif natif Wix (sinon repli sur le générique).
  // S10/C19 — variante typée AVANT le dispatch plateforme : pour un
  // hébergement, le correctif « horaires » = checkinTime/checkoutTime.
  if (key === 'nap_hours' && f && f.entity === 'lodging') {
    return { steps: [
      'Pour un hébergement, Google et les IA attendent les heures d\'arrivée et de départ (checkinTime / checkoutTime), pas des horaires d\'ouverture.',
      'Ajoutez les deux champs ci-dessous à votre bloc JSON-LD existant (celui qui déclare votre LodgingBusiness), avec VOS heures réelles.',
      ctx.platform === 'wix' ? 'Sur Wix : Réglages › Code personnalisé — modifiez le bloc de données structurées déjà en place.' : 'Le bloc se trouve dans le <head> de vos pages (ou via votre webmaster).'],
      codeLabel: 'Champs à ajouter au JSON-LD LodgingBusiness (adaptez les heures)', code:
`"checkinTime": "16:00",
"checkoutTime": "10:00"` };
  }
  if (ctx.platform === 'wix') { const wf = _wixFix(key, ctx); if (wf) return wf; }
  switch (key) {
    // ── S10 — contrôles à valeur ──────────────────────────────────────────
    case 'jsonld_url_mismatch': return { steps: [
      'Ouvrez le bloc de données structurées (JSON-LD) de vos pages — sur Wix : Réglages › Code personnalisé, ou l\'embed HTML qui le contient.',
      `Remplacez la valeur du champ "url" (et "@id" le cas échéant) par l'adresse RÉELLE du site : ${ctx.url || 'votre domaine de production'}.`,
      'Bonnes pratiques : donnez le même "@id" (ex. ' + (ctx.url || 'https://votre-domaine.fr') + '#business) à tous les blocs décrivant votre établissement pour que les moteurs les fusionnent.',
      'IMPORTANT : cliquez « Publier » après la modification — c\'est la publication qui purge le cache Wix (sinon l\'ancienne version peut être servie jusqu\'à 24 h, à vous comme à Google).',
      'Vérifiez ensuite avec l\'outil de test des résultats enrichis de Google.'],
      codeLabel: 'Champs à corriger dans votre JSON-LD', code:
`"url": "${ctx.url || 'https://votre-domaine.fr'}",
"@id": "${ctx.url || 'https://votre-domaine.fr'}#business"` };
    case 'jsonld_entity_split': return { steps: [
      // S16.3 — le rapport Squarespace du 04/08 servait « Si votre site tourne
      // sous WordPress… » à un site qui n'est pas sous WordPress. Les étapes
      // parlent maintenant de la plateforme réellement détectée.
      'Repérez les DEUX blocs de données structurées qui décrivent votre établissement : le vôtre, et celui que votre plateforme (ou une extension SEO) ajoute automatiquement.',
      ...(ctx.platform === 'squarespace' ? ['Sur Squarespace, la fiche automatique est construite à partir de Réglages › « Business Information » : c\'est là que se corrigent nom, adresse et téléphone, et le bloc ajouté à la main doit s\'aligner dessus.']
        : ctx.platform === 'wordpress' ? ['Sur WordPress : quand deux extensions SEO (Yoast, Rank Math, un thème…) produisent chacune leur fiche, n\'en gardez qu\'une active — c\'est plus sain que de les aligner à la main.'] : []),
      `Donnez-leur le MÊME identifiant : ajoutez "@id": "${ctx.url ? (() => { try { return new URL(ctx.url).origin; } catch (_) { return 'https://votre-domaine.fr'; } })() : 'https://votre-domaine.fr'}/#business" dans CHACUN des deux blocs.`,
      'Alternative : supprimez le bloc en double et ne conservez que le plus complet.',
      'Republiez, puis vérifiez avec l\'outil de test des résultats enrichis de Google : une seule entité doit apparaître.'],
      codeLabel: 'L\'identifiant commun à poser dans les deux blocs', code:
`"@id": "${ctx.url ? (() => { try { return new URL(ctx.url).origin; } catch (_) { return 'https://votre-domaine.fr'; } })() : 'https://votre-domaine.fr'}/#business"` };
    case 'canonical_mismatch': return { steps: [
      'La balise canonical de la page pointe vers un AUTRE domaine : Google est invité à indexer ce domaine-là à votre place.',
      'Corrigez le href de <link rel="canonical"> pour qu\'il pointe vers la page elle-même, sur votre domaine.',
      'Sur plateforme (Wix/WordPress), le canonical est généré automatiquement : vérifiez le domaine connecté et les réglages SEO de la page.'],
      codeLabel: 'Canonical attendu', code: `<link rel="canonical" href="${ctx.url || 'https://votre-domaine.fr/cette-page'}">` };
    case 'canonical_inconsistent': return { steps: [
      'Certaines pages se déclarent en www, d\'autres sans : choisissez UNE forme et tenez-la partout.',
      'Vérifiez la redirection 301 de la forme non retenue vers la forme canonique (réglage domaine de votre hébergeur).',
      'Sur Wix : Réglages › Domaines — le domaine « principal » détermine la forme canonique générée.'] };
    case 'wix_subdomain': return { steps: [
      'Votre site est publié sur une adresse Wix gratuite (terminant par .wixsite.com) : Google la classe moins bien et elle inspire moins confiance.',
      'Tableau de bord Wix › Réglages › « Domaines » › « Connecter un domaine » : reliez un nom de domaine à votre marque (ex. votre-entreprise.fr).',
      'Un domaine personnalisé améliore le référencement, la crédibilité et le rendu lors des partages.'] };
    // S16.4 — le titre promettait « affichez un numéro cliquable » et la carte
    // ne livrait qu'un JSON-LD (constaté sur le rapport Squarespace du 04/08).
    // Le balisage satisfait le contrôle, mais ce n'est pas ce que lisent les
    // visiteurs : le geste visible passe donc en PREMIÈRE étape, le balisage
    // reste le complément structuré.
    case 'jsonld': case 'nap_localbiz': case 'nap_address': case 'nap_phone': case 'nap_hours':
      return { steps: [
        ...(key === 'nap_phone' ? ['Affichez d\'abord le numéro sur la page (en-tête ou pied de page), en lien cliquable : <a href="tel:+33612345678">06 12 34 56 78</a> — c\'est ce que voient vos visiteurs, et ce qu\'un mobile compose d\'un doigt.'] : []),
        ...(key === 'nap_address' ? ['Affichez d\'abord l\'adresse complète sur la page (pied de page ou page Contact) : rue, code postal, ville.'] : []),
        ...(key === 'nap_hours' ? ['Affichez d\'abord vos horaires sur la page — c\'est la première chose qu\'un client cherche.'] : []),
        ...head,
        LOCALBIZ_PERSONALIZE], codeLabel: 'Fiche établissement (LocalBusiness — à personnaliser avant de coller)', code: _localBizCode(origin) };
    case 'meta_length':
    case 'meta_missing': return {
      steps: ctx.platform === 'wordpress' ? ['Avec Yoast SEO ou Rank Math : ouvrez la page › encart SEO › « Méta description ».', 'Collez le texte ci-dessous (personnalisez-le), enregistrez.']
           : ctx.platform === 'wix' ? ['Wix : ouvrez la page › Réglages SEO (SEO de base) › « Description ».', 'Collez le texte ci-dessous, enregistrez et publiez.']
           : ['Ajoutez cette balise dans le <head> de la page.'],
      codeLabel: 'Méta description (modèle à personnaliser)',
      // S18/P1 — le gabarit « à [ville] » est un conseil LOCAL : sur un site
      // déclaré sans établissement, il pousserait une géolocalisation factice.
      code: ctx.siteKind === 'online'
        ? `<meta name="description" content="[Votre activité ou promesse] — [bénéfice clé pour le client]. [Appel à l'action, ex. Essayez gratuitement].">`
        : `<meta name="description" content="[Votre activité] à [ville] — [bénéfice clé pour le client]. [Appel à l'action, ex. Réservez en ligne].">` };
    // S18/P0 — le title est PAR PAGE : les anciennes étapes génériques
    // (« Site Wide Header ») posaient le MÊME <title> sur tout le site.
    case 'title_missing': return { steps: [
      'Le titre se règle PAGE PAR PAGE : chaque page doit avoir le sien (c\'est le texte du lien bleu dans Google).',
      ctx.platform === 'wordpress' ? 'Avec Yoast SEO ou Rank Math : ouvrez chaque page › encart SEO › champ « Titre SEO ».' : 'Renseignez le titre dans l\'éditeur de chaque page (ou la balise <title> de son <head>).',
      'Format conseillé, 50-60 caractères :'],
      codeLabel: 'Balise titre (modèle à personnaliser par page)',
      code: ctx.siteKind === 'online' ? `<title>[Sujet de la page] | [Nom du site]</title>` : `<title>[Votre activité] à [ville] | [Nom de l'établissement]</title>` };
    case 'viewport': return { steps: head, codeLabel: 'Balise viewport (mobile)', code: `<meta name="viewport" content="width=device-width, initial-scale=1">` };
    // S18/P0 — l'ancien correctif portait l'URL de la HOME avec des étapes
    // « Site Wide Header » : appliqué littéralement, il canonicalisait TOUT le
    // site vers la page d'accueil → désindexation des pages internes. Le code
    // est désormais À TROUS (non collable sans lecture) et les étapes disent
    // « chaque page la sienne ».
    case 'canonical': return { steps: [
      'ATTENTION : la balise canonical se pose PAGE PAR PAGE, et chaque page doit pointer sa PROPRE adresse. Ne collez jamais le même bloc sur tout le site : vous demanderiez à Google de n\'indexer qu\'une seule page.',
      ctx.platform === 'wordpress' ? 'Sur WordPress, Yoast SEO ou Rank Math génèrent la canonical automatiquement sur chaque page : activez l\'un des deux, rien à coller.' : 'Ajoutez dans le <head> de chaque page (ou via votre webmaster) :'],
      codeLabel: 'URL canonique (une par page, à compléter)', code: `<link rel="canonical" href="[adresse exacte de cette page]">` };
    case 'og_title': return { steps: head, codeLabel: 'Open Graph — titre', code: `<meta property="og:title" content="[Titre attractif de la page]">` };
    case 'og_image': return { steps: head, codeLabel: 'Open Graph — image', code: `<meta property="og:image" content="${origin}/votre-image-partage.jpg">` };
    case 'lang': return { steps: ['Modifiez la balise <html> d\'ouverture de votre page pour déclarer sa langue (adaptez si votre site n\'est pas en français : lang="en", lang="it"…) :'], codeLabel: 'Attribut de langue', code: `<html lang="fr">` };
    case 'sitemap': return {
      steps: ctx.platform === 'wordpress' ? ['Yoast/Rank Math génère le sitemap automatiquement (souvent /sitemap_index.xml).', 'Vérifiez qu\'il est déclaré dans robots.txt :']
           : ctx.platform === 'wix' ? ['Wix génère un sitemap par défaut à /sitemap.xml.', 'Vérifiez sa déclaration dans robots.txt :']
           : ['Générez un sitemap.xml et déclarez-le dans robots.txt :'],
      codeLabel: 'Ligne à ajouter dans robots.txt', code: `Sitemap: ${origin}/sitemap.xml` };
    case 'h1': return { steps: ['Assurez-vous d\'avoir UN seul titre principal (H1) par page — en général le titre principal défini dans l\'éditeur.', 'Les autres titres doivent être en H2/H3 (sous-titres).'] };
    case 'img_alt': return { steps: ['Pour chaque image, renseignez le « texte alternatif » (alt) qui décrit l\'image.', ctx.platform === 'wordpress' ? 'WordPress : Médias › sélectionnez l\'image › champ « Texte alternatif ».' : ctx.platform === 'wix' ? 'Wix : clic sur l\'image › Paramètres › « Texte alternatif ».' : 'Ajoutez l\'attribut alt="description" sur chaque <img>.'] };
    case 'perf_lcp': return { steps: ['Compressez l\'image principale (format WebP/AVIF) et donnez-lui une taille adaptée.', 'Activez le cache et différez les scripts non essentiels (chat, analytics).'] };
    case 'perf_cls': return { steps: ['Donnez une largeur/hauteur fixe aux images, bannières et publicités pour éviter les sauts.', 'Réservez l\'espace des contenus chargés après coup.'] };
    case 'perf_weight': return { steps: ['Compressez les images (WebP/AVIF), limitez les polices web et les scripts tiers.'] };
    // ── S18/P2 — nouveaux contrôles : étapes sans code destructeur ─────────
    case 'noindex': return { steps: [
      ctx.platform === 'wordpress' ? 'WordPress : Réglages › Lecture › décochez « Demander aux moteurs de recherche de ne pas indexer ce site », puis vérifiez l\'encart de votre extension SEO (Yoast/Rank Math) sur la page signalée : « Autoriser l\'indexation ».' : 'Retirez la balise <meta name="robots" content="noindex"> de la page (ou l\'en-tête HTTP X-Robots-Tag, côté serveur).',
      'Si la page doit vraiment rester privée, retirez-la aussi du sitemap : dire à Google « indexe-la » et « ignore-la » en même temps brouille le signal.',
      'Vérifiez ensuite dans Google Search Console (Inspection d\'URL) que la page est redevenue indexable.'] };
    case 'soft_404': return { steps: [
      'Une adresse qui n\'existe pas doit répondre avec le STATUT 404 (pas seulement afficher « page introuvable » sur un statut 200).',
      ctx.platform === 'wordpress' ? 'WordPress renvoie normalement de vrais 404. Si ce n\'est plus le cas, cherchez une règle « attrape-tout » dans vos redirections (extension de redirection, .htaccess) et supprimez-la.' : 'Sur un hébergement statique ou un site une-page (application JavaScript), configurez la page d\'erreur de l\'hébergeur (404.html) et vérifiez qu\'elle est servie avec le statut 404 — chaque hébergeur a ce réglage.',
      'Testez en tapant une adresse inventée sur votre site : l\'outil réseau du navigateur (F12 › Réseau) doit montrer « 404 ».'] };
    case 'hreflang_self': return { steps: [
      'Dans le groupe hreflang de chaque page, ajoutez une entrée qui pointe la page ELLE-MÊME (auto-référence), avec son URL canonique EXACTE — barre finale comprise.',
      'Sur plateforme (Wix, WordPress + extension multilingue), l\'hreflang est généré : vérifiez que l\'URL canonique et l\'URL hreflang sont produites par le MÊME réglage de domaine (www ou non, barre finale ou non).'] };
    case 'hreflang_xdefault': return { steps: [
      'Ajoutez au groupe hreflang une entrée « x-default » pointant la version à servir par défaut (souvent votre langue principale ou une page de choix de langue).',
      'Elle s\'ajoute au même endroit que vos hreflang existants (extension multilingue ou <head> des pages).'],
      codeLabel: 'Entrée x-default (à compléter)', code: `<link rel="alternate" hreflang="x-default" href="[URL de la version par défaut]">` };
    case 'hreflang_missing': return { steps: [
      'Chaque page doit déclarer TOUTES ses versions linguistiques (elle-même comprise) via des balises <link rel="alternate" hreflang="…"> dans son <head>.',
      ctx.platform === 'wordpress' ? 'Sur WordPress, l\'extension multilingue (WPML, Polylang…) les génère : vérifiez qu\'elle est active et que les pages sont bien reliées entre langues.' : ctx.platform === 'wix' ? 'Sur Wix Multilingue, les hreflang sont générés automatiquement : vérifiez que les langues sont activées dans Réglages › Langues du site.' : 'Déclarez chaque paire réciproquement : la page française déclare l\'anglaise ET la page anglaise déclare la française.',
      'Sans hreflang, vos versions se concurrencent dans Google au lieu de se répartir par langue de visiteur.'] };
    case 'hreflang_reciprocity': return { steps: [
      'La déclaration doit être RÉCIPROQUE : si la page A déclare la page B comme version alternative, B doit déclarer A en retour (chacune avec l\'URL canonique exacte de l\'autre).',
      'Corrigez le groupe hreflang de la page qui ne « répond pas », puis re-testez les deux pages.',
      'Sur plateforme multilingue, une réciprocité manquante vient souvent d\'une page traduite non reliée à son originale dans l\'outil de traduction.'] };
    default:
      if (key && key.indexOf('sec_') === 0) return _secFix(key.slice(4), ctx);
      return null;
  }
}

export function attachFixes(findings, ctx) {
  for (const f of findings) { try { f.fix = fixFor(f.key, ctx, f); } catch (_) { f.fix = null; } }
  return dedupeFixCode(findings);
}
