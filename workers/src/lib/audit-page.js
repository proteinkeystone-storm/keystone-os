// ─────────────────────────────────────────────────────────────────────────
// SENTINEL · S8 — moteur d'analyse on-page PUR (aucune I/O, testable seul).
//   Extrait de routes/sentinel.js (_audit) ; consommé par lui et par les
//   tests (workers/test/sentinel-audit.test.mjs, fixtures HTML réelles).
//
// Principe central (S8) : une preuve POSITIVE (élément trouvé, défaut
// constaté) vaut toujours ; une preuve NÉGATIVE (« absent ») n'est valable
// que sur un document COMPLET. Sur un document tronqué, « pas trouvé »
// devient INDÉTERMINÉ : aucun finding, et le point sort du dénominateur
// de l'axe (renormalisation) au lieu de compter comme un échec.
// ─────────────────────────────────────────────────────────────────────────

// En-têtes de sécurité contrôlés (S2) — ordre = ordre d'affichage.
export const SEC_HEADERS = [
  ['strict-transport-security', 'HSTS'], ['content-security-policy', 'CSP'],
  ['x-frame-options', 'X-Frame-Options'], ['x-content-type-options', 'X-Content-Type-Options'],
  ['referrer-policy', 'Referrer-Policy'],
];

// S9/C8 — plateformes managées : l'utilisateur n'a PAS la main sur ces
// en-têtes (pas d'accès serveur). Les exiger quand même = pénaliser un
// client pour ce qu'il ne peut pas corriger (le texte du correctif S4
// disait lui-même « non réglable sans serveur dédié »… en comptant -60).
// Sur ces plateformes : en-tête exempté absent → « non applicable »,
// l'axe se renormalise sur les en-têtes réellement contrôlables.
export const MANAGED_PLATFORMS = new Set(['wix', 'squarespace', 'shopify']);
export const MANAGED_HEADER_EXEMPT = new Set(['CSP', 'X-Frame-Options', 'Referrer-Policy']);

// S9/C7 — pondération FIXE du score global. L'ancienne moyenne à
// dénominateur variable déplaçait le score quand un axe passait n/a,
// sans que le site change. Politique n/a : un axe null sort du numérateur
// ET du dénominateur (renormalisation), et le rapport doit le dire.
export const AXIS_WEIGHTS = {
  seo: 0.25, performance: 0.20, securite: 0.15,
  accessibilite: 0.15, presence: 0.15, disponibilite: 0.10,
};
export function globalScore(scores) {
  let earned = 0, wsum = 0;
  for (const [ax, w] of Object.entries(AXIS_WEIGHTS)) {
    const v = scores ? scores[ax] : null;
    if (typeof v === 'number') { earned += v * w; wsum += w; }
  }
  return wsum ? Math.round(earned / wsum) : null;
}

// S9/C9 — score de performance : le poids de page ENTRE au score.
// Avant : « Performance 100/100 » affiché à côté d'un finding « Page
// lourde (3 Mo) » — incohérence visible par le client. Seuils poids :
// ≤ 2 Mo bon, ≥ 6 Mo mauvais (transfert mobile).
export function threshScore(v, good, poor) {
  if (v == null) return null;
  if (v <= good) return 100;
  if (v >= poor) return 0;
  return Math.round(100 * (poor - v) / (poor - good));
}
export function perfScore(cwv) {
  if (!cwv) return null;
  const parts = [
    [threshScore(cwv.lcp, 2500, 4000), 0.45],
    [threshScore(cwv.cls, 0.1, 0.25), 0.25],
    [threshScore(cwv.fcp, 1800, 3000), 0.15],
    [threshScore(cwv.weightKb, 2048, 6144), 0.15],
  ].filter((p) => p[0] != null);
  if (!parts.length) return null;
  const wsum = parts.reduce((a, p) => a + p[1], 0);
  return Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / wsum);
}

// Descendants Schema.org de LocalBusiness (hiérarchie complète, y compris
// LocalBusiness lui-même). Un site qui déclare `LodgingBusiness` ou
// `Restaurant` A une fiche établissement — exiger la chaîne littérale
// « LocalBusiness » était le bug n°2 du rapport Mas des Bouteillans.
export const LOCALBUSINESS_TYPES = new Set([
  'LocalBusiness',
  // Automotive
  'AutomotiveBusiness', 'AutoBodyShop', 'AutoDealer', 'AutoPartsStore', 'AutoRental',
  'AutoRepair', 'AutoWash', 'GasStation', 'MotorcycleDealer', 'MotorcycleRepair',
  // Divers services
  'AnimalShelter', 'ArchiveOrganization', 'ChildCare', 'DryCleaningOrLaundry',
  'EmploymentAgency', 'InternetCafe', 'Library', 'RadioStation', 'RealEstateAgent',
  'RecyclingCenter', 'SelfStorage', 'ShoppingCenter', 'TelevisionStation',
  'TouristInformationCenter', 'TravelAgency', 'ProfessionalService',
  // Urgence / public
  'EmergencyService', 'FireStation', 'Hospital', 'PoliceStation', 'GovernmentOffice', 'PostOffice',
  // Divertissement
  'EntertainmentBusiness', 'AdultEntertainment', 'AmusementPark', 'ArtGallery', 'Casino',
  'ComedyClub', 'MovieTheater', 'NightClub',
  // Finance
  'FinancialService', 'AccountingService', 'AutomatedTeller', 'BankOrCreditUnion', 'InsuranceAgency',
  // Restauration
  'FoodEstablishment', 'Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery',
  'FastFoodRestaurant', 'IceCreamShop', 'Restaurant', 'Winery',
  // Beauté / santé-forme
  'HealthAndBeautyBusiness', 'BeautySalon', 'DaySpa', 'HairSalon', 'HealthClub', 'NailSalon', 'TattooParlor',
  // Bâtiment
  'HomeAndConstructionBusiness', 'Electrician', 'GeneralContractor', 'HVACBusiness',
  'HousePainter', 'Locksmith', 'MovingCompany', 'Plumber', 'RoofingContractor',
  // Juridique
  'LegalService', 'Attorney', 'Notary',
  // Hébergement — la verticale du bug d'origine
  'LodgingBusiness', 'BedAndBreakfast', 'Campground', 'Hostel', 'Hotel', 'Motel',
  'Resort', 'SkiResort', 'VacationRental',
  // Médical
  'MedicalBusiness', 'CommunityHealth', 'Dentist', 'Dermatology', 'DietNutrition',
  'Emergency', 'Geriatric', 'Gynecologic', 'MedicalClinic', 'MedicalSpa', 'Midwifery',
  'Nursing', 'Obstetric', 'Oncologic', 'Optician', 'Optometric', 'Otolaryngologic',
  'Pediatric', 'Pharmacy', 'PhysicalTherapy', 'Physician', 'PlasticSurgery', 'Podiatric',
  'PrimaryCare', 'Psychiatric', 'PublicHealth', 'VeterinaryCare',
  // Sport
  'SportsActivityLocation', 'BowlingAlley', 'ExerciseGym', 'GolfCourse',
  'PublicSwimmingPool', 'SportsClub', 'StadiumOrArena', 'TennisComplex',
  // Commerces
  'Store', 'BikeStore', 'BookStore', 'ClothingStore', 'ComputerStore', 'ConvenienceStore',
  'DepartmentStore', 'ElectronicsStore', 'Florist', 'FurnitureStore', 'GardenStore',
  'GroceryStore', 'HardwareStore', 'HobbyShop', 'HomeGoodsStore', 'JewelryStore',
  'LiquorStore', 'MensClothingStore', 'MobilePhoneStore', 'MovieRentalStore', 'MusicStore',
  'OfficeEquipmentStore', 'OutletStore', 'PawnShop', 'PetStore', 'ShoeStore',
  'SportingGoodsStore', 'TireShop', 'ToyStore', 'WholesaleStore',
]);


// S14.2 — extraction d'ATTRIBUT respectant le guillemet ouvrant.
// L'ancien motif `content=["']([^"']*)["']` excluait les DEUX guillemets de
// la classe : toute apostrophe DANS une valeur entre guillemets doubles
// coupait la capture. « L'Arbousier : appartement climatisé… » (149 c.)
// était lu « L » (1 c.) → finding « méta trop courte » FAUX et 7 pts de
// barème perdus. Bug francophone au pire endroit : nos clients écrivent
// « d'Azur », « l'hôtel », « L'Arbousier ». Trouvé le 04/08 en préparant
// les correctifs du Mas — sur des données réelles, comme toujours.
function _attr(tag, name) {
  const re = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = String(tag || '').match(re);
  if (!m) return '';
  return (m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : (m[3] || ''))).trim();
}
// Première balise `tagName` dont l'attribut `attr` vaut `value` (ex. le
// <meta name="description">), rendue entière pour lecture de ses attributs.
function _findTag(html, tagName, attr, value) {
  const re = new RegExp('<' + tagName + '\\b[^>]*>', 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    if (_attr(m[0], attr).toLowerCase() === value.toLowerCase()) return m[0];
  }
  return '';
}

const _between = (html, re) => { const m = html.match(re); return m ? (m[1] || '').trim() : ''; };
// S14.2 — longueurs comptées sur le texte RÉEL : &#39; &amp; &nbsp; … valent
// 1 caractère pour Google, pas 5. (Le title du Mas « L'Arbousier – gîte… »
// arrivait gonflé par les entités.)
function _decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch (_) { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (_) { return ' '; } })
    .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
}

// ═══ S16 — NAP : lire le TEXTE, pas le balisage ═══════════════════════════
// Les heuristiques de secours (celles qui lisent la page quand la donnée
// structurée manque) travaillaient sur `vis` : le HTML dépouillé de ses
// scripts, mais AVEC ses attributs. Dogfooding du 2026-08-04 sur douze sites
// WordPress/Squarespace réels — quatre erreurs, deux dans chaque sens :
//   FAUX POSITIFS · bandol.fr : « 0033 85.3467 » (coordonnée d'un tracé SVG,
//                   attribut `d=`) crédité comme un +33 ; ollioules.fr : le
//                   fichier « chemin-crea-282-29-960w.jpg » crédité comme voie.
//   FAUX NÉGATIFS · « 04 94 98 25 25 » (format national, sans lien tel:) et
//                   « 11 place Charles de Gaulle 83740 La Cadière d'Azur »
//                   invisibles — « place » hors liste, et le motif exigeait
//                   la voie ET le code postal dans le MÊME nœud de texte.
// Même cause unique : un attribut n'est pas du texte. Sur le texte APLATI, le
// format national redevient sûr (coordonnées et noms de fichiers vivent dans
// des attributs) — c'est ce qui permet de le réintroduire sans rouvrir le
// faux positif que S8 avait fermé sur wordpress.org.

// Types de voie sans ambiguïté : le mot suffit à ouvrir la fenêtre.
export const STREET_TYPES_SAFE = 'rue|avenue|boulevard|impasse|chemin|all[ée]e|quai|route|chauss[ée]e|esplanade|traverse|mont[ée]e|faubourg|hameau|lotissement|r[ée]sidence|parvis|promenade';
// Homographes (anglais ou français courant) : « the event takes place »,
// « des cours de yoga », « a public square ». Ceux-là n'ouvrent la fenêtre
// que précédés d'un NUMÉRO de voie — « 11 place Charles de Gaulle ».
export const STREET_TYPES_NUMBERED = 'place|square|cours|voie|passage';

// Format NATIONAL (0X suivi de quatre paires) — France, Belgique, Suisse et
// Luxembourg l'écrivent ainsi. Bornes anti-troncature : ni chiffre ni
// séparateur décimal avant/après, sinon « 26.077 » ou une référence produit
// à douze chiffres fabriqueraient un numéro.
export const PHONE_NATIONAL_TEXT = /(?<![\d.,])0[1-9](?:[ .\-]?\d{2}){4}(?![\d.,])/;
// Format international (S13.3), resserré : l'indicatif ne suffit pas, il faut
// derrière un abonné de 8 à 10 chiffres. Sans ce compte, « 0033 85.3467 » —
// une coordonnée de tracé — passait pour un numéro belge.
// Le « (0) » de « +33 (0)4 94 30 41 41 » impose un petit groupe de
// séparateurs, pas un seul caractère — borné à 2 pour ne pas souder deux
// nombres voisins.
const PHONE_INTL_TEXT = /(?<![\d.,])(?:\+|00)(?:33|32|41|352)((?:[ .\-/]{0,2}\(?\d\)?){6,12})(?![\d])/g;

export function phoneInText(text) {
  const s = String(text || '');
  if (PHONE_NATIONAL_TEXT.test(s)) return true;
  PHONE_INTL_TEXT.lastIndex = 0;
  let m;
  while ((m = PHONE_INTL_TEXT.exec(s)) !== null) {
    const digits = m[1].replace(/\D/g, '').length;
    if (digits < 8 || digits > 10) continue;
    // Un numéro écrit avec des séparateurs va par groupes de 1 à 3 chiffres
    // (« 4 94 90 12 56 »). Un groupe de 4+ au milieu trahit une décimale ou
    // une paire de coordonnées, pas un abonné.
    const groups = m[1].split(/[^\d]+/).filter(Boolean);
    if (groups.length > 1 && groups.some((g) => g.length > 3)) continue;
    return true;
  }
  return false;
}

// Adresse postale dans le texte : un type de voie, puis à moins de 80
// caractères un code postal (4-5 chiffres) SUIVI d'une commune capitalisée.
// Cette dernière exigence écarte les millésimes (« depuis 1979, … ») et les
// ZIP anglo-saxons isolés (« 115 King St, Alexandria, VA 22314 Hours Mon »).
// La casse compte pour la commune — d'où une passe manuelle, pas un motif /i.
export function addressInText(text) {
  const s = String(text || '');
  const cp = /\b\d{4,5}\s+[A-ZÀ-ÖØ-Þ]/;
  const scan = (re, needsNumber) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const end = m.index + m[0].length;
      if (needsNumber && !/\d{1,4}\s*(?:bis|ter|quater)?\s+$/i.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
      if (cp.test(s.slice(end, end + 80))) return true;
    }
    return false;
  };
  return scan(new RegExp(`\\b(?:${STREET_TYPES_SAFE})\\b`, 'gi'), false)
      || scan(new RegExp(`\\b(?:${STREET_TYPES_NUMBERED})\\b`, 'gi'), true);
}

// S16.3 — un même bloc de code ne s'imprime qu'UNE fois par rapport.
// Constaté sur le rapport WordPress réel du 04/08 (tourisme-lacadieredazur.fr) :
// `jsonld`, `nap_localbiz` et `nap_hours` partagent la même fiche
// LocalBusiness — quinze lignes identiques, imprimées TROIS fois de suite.
// Le client y lit du remplissage, et le PDF passe de 3 à 5 pages. On garde le
// bloc sur le finding le plus prioritaire du groupe (celui que le tri par
// sévérité affiche en premier) ; les autres y renvoient en une phrase.
export const SEV_ORDER = { high: 0, medium: 1, low: 2 };
export function dedupeFixCode(findings) {
  const groups = new Map();
  for (const f of findings) {
    if (!f.fix || !f.fix.code) continue;
    const g = groups.get(f.fix.code) || [];
    g.push(f); groups.set(f.fix.code, g);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => (SEV_ORDER[a.sev] ?? 3) - (SEV_ORDER[b.sev] ?? 3));   // tri stable : à sévérité égale, l'ordre du rapport
    const keeper = g[0];
    for (const f of g.slice(1)) {
      f.fix = { ...f.fix, code: null, codeLabel: null,
        steps: [...(f.fix.steps || []), `Le bloc de code donné plus haut, pour « ${keeper.title} », couvre aussi ce point — inutile de le coller deux fois.`] };
    }
  }
  return findings;
}

// ═══ S16.2 — détection de plateforme sur des SIGNATURES, pas des indices ══
// Trouvé le 2026-08-04 pendant le balayage adverse : districtcafe.ca, un site
// Squarespace, ressortait tantôt « squarespace », tantôt « wix ». Cause : la
// sonde cherchait la sous-chaîne « wix » dans la valeur de TOUS les en-têtes.
// Or Squarespace renvoie `x-contextid: gJtnrosz/A0cCgwUT` et un cookie
// `crumb=…`, deux jetons base64 RETIRÉS AU HASARD à chaque requête. Quand le
// tirage contient w-i-x (≈ 1 fois sur 500), le site devient « Wix ».
// Conséquences : (1) la plateforme est décidée UNE SEULE FOIS, à la création
// du site, puis stockée — un tirage malheureux fige l'erreur ; (2) « wix » est
// une plateforme MANAGÉE : trois en-têtes de sécurité passent « non
// applicables », donc un site sur-mesure voit son axe sécurité gonflé sans
// raison ; (3) le client reçoit des instructions d'éditeur Wix pour un site
// qui n'est pas sous Wix. Le même laxisme existait côté HTML : `wix.com` en
// sous-chaîne suffisait — un simple lien vers wix.com classait la page.
// Signatures relevées à la main sur des sites réels (2026-08-04) :
//   Wix         server: Pepyaka · en-tête x-wix-request-id · static.wixstatic.com
//               · parastorage.com · <meta generator "Wix.com Website Builder">
//   Squarespace server: Squarespace · static1/assets.squarespace.com
//   WordPress   /wp-content/ · /wp-json · wp-includes · generator "WordPress"
//   Shopify     cdn.shopify.com · shopify.theme · en-tête x-shopify-*
export function detectPlatform(html, headers) {
  const h = String(html || '').slice(0, 200000).toLowerCase();
  const hd = headers || {};
  const server = String(hd.server || '').toLowerCase();
  // Sur le NOM de l'en-tête : un nom ne peut pas être un jeton aléatoire.
  const hasName = (prefix) => Object.keys(hd).some((k) => k.toLowerCase().startsWith(prefix));
  const generator = (h.match(/<meta[^>]+name=["']generator["'][^>]*>/i) || [''])[0];

  if (server.includes('pepyaka') || hasName('x-wix-')
    || h.includes('static.wixstatic.com') || h.includes('parastorage.com')
    || h.includes('_wixcssstate') || h.includes('wixbisession')
    || generator.includes('wix.com')) return 'wix';
  if (server.includes('squarespace')
    || h.includes('static1.squarespace.com') || h.includes('assets.squarespace.com')
    || generator.includes('squarespace')) return 'squarespace';
  if (h.includes('/wp-content/') || h.includes('/wp-json') || h.includes('wp-includes')
    || generator.includes('wordpress')) return 'wordpress';
  if (h.includes('cdn.shopify.com') || h.includes('shopify.theme') || hasName('x-shopify-')) return 'shopify';
  return 'custom';
}

// ═══ S16/C24 — entités dupliquées et non fusionnées ══════════════════════
// Cas fondateur (Le Mas des Bouteillans, vérifié en direct le 2026-08-04) :
// la home sert DEUX fiches pour le même établissement —
//   · LodgingBusiness  @id=…/#business   (bloc maison : checkinTime, priceRange)
//   · LocalBusiness    @id ABSENT        (généré par Wix depuis « Infos de
//                                         l'entreprise », mêmes nom/tél/adresse)
// Rien ne les relie. Les moteurs et les IA peuvent y voir deux établissements,
// ou n'en retenir qu'un — et c'est souvent le pauvre. Les signaux qui valent
// (heure d'arrivée, fourchette de prix) sont alors perdus.
// Schema.org fusionne les nœuds qui PARTAGENT un « @id » : c'est le geste.
const _normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Téléphone comparable malgré la mise en forme : « +33680637511 » et
// « +33 6 80 63 75 11 » sont le même numéro.
const _normPhone = (s) => String(s || '').replace(/\D/g, '').replace(/^(?:00)?33/, '').replace(/^0/, '');
const _streetOf = (n) => {
  const a = n && n.address;
  if (!a) return '';
  return _normName(typeof a === 'string' ? a : (a.streetAddress || ''));
};

// Renvoie { a, b, name, missingId } si deux fiches décrivent la même entité
// sans être reliées, sinon null.
export function entitySplit(nodes) {
  const isEntity = (n) => {
    const t = n && n['@type']; const tl = Array.isArray(t) ? t : (t ? [t] : []);
    return tl.some((x) => LOCALBUSINESS_TYPES.has(x) || x === 'Organization');
  };
  const typeOf = (n) => { const t = n['@type']; return Array.isArray(t) ? t.join('+') : String(t || ''); };
  const ents = (nodes || []).filter(isEntity);
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const a = ents[i], b = ents[j];
      // Même entité ? nom identique, ou même téléphone, ou même rue.
      const sameName = !!_normName(a.name) && _normName(a.name) === _normName(b.name);
      const samePhone = !!_normPhone(a.telephone) && _normPhone(a.telephone) === _normPhone(b.telephone);
      const sameStreet = !!_streetOf(a) && _streetOf(a) === _streetOf(b);
      if (!sameName && !samePhone && !sameStreet) continue;
      // Reliées ? même @id, ou l'une cite l'@id de l'autre (parentOrganization,
      // sameAs, brand…). Une citation suffit : le graphe est alors explicite.
      const ida = typeof a['@id'] === 'string' ? a['@id'] : '';
      const idb = typeof b['@id'] === 'string' ? b['@id'] : '';
      if (ida && ida === idb) continue;
      if (ida && JSON.stringify(b).includes(ida)) continue;
      if (idb && JSON.stringify(a).includes(idb)) continue;
      return { a: typeOf(a), b: typeOf(b), name: a.name || b.name || '', missingId: !ida || !idb };
    }
  }
  return null;
}

// ═══ S10 — contrôles à valeur ═════════════════════════════════════════════

// Hôtes de staging/brouillon des plateformes — une URL de prod déclarée sur
// l'un d'eux dans le JSON-LD est l'oubli d'agence LE plus fréquent (cas
// fondateur : le Mas des Bouteillans déclarait proteinstd.wixstudio.com sur
// ses 5 pages — passé sous le radar de l'audit S7).
export const STAGING_HOSTS = /(\.wixstudio\.com|\.wixsite\.com|\.editorx\.io|\.vercel\.app|\.netlify\.app|\.webflow\.io|\.myshopify\.com|\.squarespace\.com|\.github\.io|\.pages\.dev|\.web\.app|\.firebaseapp\.com)$/i;

// Sous-types hébergement (C19) : les « horaires » pertinents sont
// checkinTime/checkoutTime, pas openingHours.
export const LODGING_TYPES = new Set(['LodgingBusiness', 'BedAndBreakfast', 'Campground', 'Hostel', 'Hotel', 'Motel', 'Resort', 'SkiResort', 'VacationRental']);

// Type Schema.org → libellé d'activité FR (C21 — pré-remplissage GEO).
// Volontairement restreint aux types sans ambiguïté ; générique → null.
export const TYPE_ACTIVITY_FR = {
  LodgingBusiness: 'hébergement', Hotel: 'hôtel', BedAndBreakfast: "chambre d'hôtes",
  VacationRental: 'location de vacances', Campground: 'camping', Hostel: 'auberge',
  Restaurant: 'restaurant', Bakery: 'boulangerie', BarOrPub: 'bar', CafeOrCoffeeShop: 'café',
  FastFoodRestaurant: 'restauration rapide', Winery: 'domaine viticole', Brewery: 'brasserie',
  HairSalon: 'salon de coiffure', BeautySalon: 'institut de beauté', DaySpa: 'spa',
  Dentist: 'dentiste', Physician: 'médecin', Pharmacy: 'pharmacie', VeterinaryCare: 'vétérinaire',
  RealEstateAgent: 'agence immobilière', TravelAgency: 'agence de voyage', AutoRepair: 'garage auto',
  Florist: 'fleuriste', JewelryStore: 'bijouterie', BookStore: 'librairie', GroceryStore: 'épicerie',
  ClothingStore: 'boutique de vêtements', Plumber: 'plombier', Electrician: 'électricien',
  Attorney: 'avocat', Notary: 'notaire',
};

const _hostOfUrl = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } };

// C20 — un sitemap qui répond 200 mais ne contient ni <urlset> ni
// <sitemapindex> ni <loc> (page d'erreur HTML, redirect soft) ne compte pas.
export function sitemapLooksValid(text) {
  return !!text && /<\s*(urlset|sitemapindex|loc)\b/i.test(text);
}

// ═══ S11 — agrégation multi-pages (partagée : audit express ET crawl) ═════
// Entrée : [{ path, scores, findings, indeterminate, notApplicable,
//             truncated, canonicalHrefHost }]  (pages ATTEINTES uniquement).
// Sortie : scores moyens par axe, findings fusionnés (site-level dédupliqués,
// page-level tagués), unions indéterminé/non-applicable, cohérence canonicals.
export const SITE_LEVEL_KEYS = new Set(['sitemap', 'wix_subdomain', 'canonical_inconsistent',
  'sec_HSTS', 'sec_CSP', 'sec_X-Frame-Options', 'sec_X-Content-Type-Options', 'sec_Referrer-Policy']);

// ═══ S12.1 — GAIN RÉEL par finding ════════════════════════════════════════
// L'ancien « gain estimé » du front était une constante par sévérité
// (high +5, medium +3, low +1) : le rapport promettait des points que la
// correction ne rendait pas (les findings informatifs S10 pèsent ZÉRO au
// barème). Règle : le gain affiché = delta EXACT du score global si le
// point est corrigé, calculé depuis le barème et la pondération des axes.
// [axe, points] — points du barème par page ; un finding peut créditer
// plusieurs axes (viewport : SEO +10 ET a11y +25).
export const FINDING_POINTS = {
  title_missing: [['seo', 15]], meta_missing: [['seo', 15]], meta_length: [['seo', 7]],
  h1: [['seo', 15]], canonical: [['seo', 10]], viewport: [['seo', 10], ['accessibilite', 25]],
  og_title: [['seo', 8]], og_image: [['seo', 7]], jsonld: [['seo', 10]], sitemap: [['seo', 10]],
  lang: [['accessibilite', 35]],
  nap_phone: [['presence', 30]], nap_address: [['presence', 35]],
  nap_localbiz: [['presence', 20]], nap_hours: [['presence', 15]],
};
// Informatifs : réels et importants, mais HORS barème — gain 0, dit tel quel.
export const INFO_GAIN_KEYS = new Set(['jsonld_url_mismatch', 'canonical_mismatch', 'canonical_inconsistent', 'wix_subdomain', 'title_long', 'jsonld_entity_split']);
// Variables : le gain dépend du résultat de l'optimisation (continu) — pas de promesse chiffrée.
export const VARIABLE_GAIN_KEYS = new Set(['perf_lcp', 'perf_cls', 'perf_weight', 'img_alt']);

// Mute les findings : f.gain = points de score global récupérables (1 déc.),
// 0 (informatif) ou null (variable). `scores` = axes agrégés courants,
// pageCount = pages auditées, notApplicable = clés sec_* exemptées (managé).
export function attachGains(findings, { scores, pageCount, notApplicable }) {
  const wsum = Object.entries(AXIS_WEIGHTS).reduce((a, [ax, w]) => a + (typeof (scores || {})[ax] === 'number' ? w : 0), 0) || 1;
  const naCount = (notApplicable || []).length;
  const n = Math.max(1, pageCount || 1);
  for (const f of findings || []) {
    if (INFO_GAIN_KEYS.has(f.key)) { f.gain = 0; continue; }
    if (VARIABLE_GAIN_KEYS.has(f.key)) { f.gain = null; continue; }
    let pts = FINDING_POINTS[f.key];
    if (!pts && /^sec_/.test(f.key)) {
      // Sécurité renormalisée : chaque en-tête exigible vaut 100/(5-naCount).
      pts = [['securite', Math.round(100 / Math.max(1, 5 - naCount))]];
    }
    if (!pts) { f.gain = null; continue; }
    const affected = (f.pages && f.pages.length) ? f.pages.length : n;   // site-level → toutes les pages
    let gain = 0;
    for (const [ax, p] of pts) {
      const cur = (scores || {})[ax];
      if (typeof cur !== 'number') continue;                             // axe n/a : pas de promesse dessus
      const axisGain = Math.min(p * affected / n, 100 - cur);            // borné : un axe ne dépasse pas 100
      gain += Math.max(0, axisGain) * (AXIS_WEIGHTS[ax] || 0) / wsum;
    }
    f.gain = Math.round(gain * 10) / 10;
  }
  return findings;
}

export function aggregatePages(pagesAudited) {
  const scores = {};
  for (const ax of ['seo', 'securite', 'accessibilite', 'presence']) {
    const vals = pagesAudited.map((p) => p.scores && p.scores[ax]).filter((v) => typeof v === 'number');
    scores[ax] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  const byKey = new Map();
  for (const p of pagesAudited) {
    for (const f of (p.findings || [])) {
      const ex = byKey.get(f.key);
      if (ex) { if (ex.pages) ex.pages.push(p.path); }
      else byKey.set(f.key, { ...f, pages: SITE_LEVEL_KEYS.has(f.key) ? null : [p.path] });
    }
  }
  // S10/C18 — cohérence des hôtes canoniques entre pages (www vs apex mélangés).
  const canonHosts = [...new Set(pagesAudited.map((p) => p.canonicalHrefHost).filter(Boolean))];
  if (canonHosts.length > 1) {
    byKey.set('canonical_inconsistent', { axis: 'seo', sev: 'medium', key: 'canonical_inconsistent',
      title: 'Canonicals incohérents entre les pages',
      detail: `Les pages déclarent des hôtes canoniques différents (${canonHosts.join(' vs ')}) : choisissez UNE forme (www ou non) et appliquez-la partout.`, pages: null });
  }
  const findings = [...byKey.values()].map((f) => { if (f.pages) f.pages = [...new Set(f.pages)]; return f; });
  return {
    scores, findings,
    indeterminate: [...new Set(pagesAudited.flatMap((p) => p.indeterminate || []))],
    notApplicable: [...new Set(pagesAudited.flatMap((p) => p.notApplicable || []))],
    truncated: pagesAudited.some((p) => p.truncated),
  };
}

// ── JSON-LD : extraction + parsing tolérant ──────────────────────────────
// Renvoie { nodes, types } : nodes = objets aplatis (tableaux et @graph à
// un niveau), types = Set des @type rencontrés (chaînes et tableaux).
export function extractJsonLd(html) {
  const nodes = []; const types = new Set();
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1]); } catch (_) { continue; }   // bloc invalide → ignoré
    const roots = Array.isArray(data) ? data : [data];
    for (const root of roots) {
      if (!root || typeof root !== 'object') continue;
      const list = Array.isArray(root['@graph']) ? root['@graph'] : [root];
      for (const nd of list) {
        if (!nd || typeof nd !== 'object') continue;
        nodes.push(nd);
        const t = nd['@type'];
        for (const x of Array.isArray(t) ? t : (t ? [t] : [])) { if (typeof x === 'string') types.add(x.trim()); }
      }
    }
  }
  return { nodes, types };
}


// S13.1 — HTML « visible » : retire commentaires, <script> et <style> (y
// compris un bloc final non fermé sur document tronqué). Les détections de
// CONTENU (H1, images, NAP, balises head) travaillent là-dessus ; le
// JSON-LD, lui, vit dans des <script> et garde le document brut.
export function visibleHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!--[^]*$/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<script\b[^>]*>[^]*$/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
}

// itemtype microdata → mêmes familles que le JSON-LD (fallback).
function _microdataTypes(html) {
  const out = new Set();
  const re = /itemtype\s*=\s*["']https?:\/\/schema\.org\/([A-Za-z]+)["']/gi;
  let m; while ((m = re.exec(html)) !== null) out.add(m[1]);
  return out;
}

// ── Analyse d'une page ───────────────────────────────────────────────────
// html      : document (éventuellement tronqué — voir opts.truncated)
// opts:
//   truncated    : le buffer a été coupé (cap mémoire) → règles de preuve S8
//   headers      : objet { nom-en-minuscules: valeur } (ou null si injoignable)
//   skipSite     : page interne — pas de findings site-level (sitemap, wix_subdomain)
//   sitemap      : résultat du contrôle sitemap (fait côté réseau, sur la home)
//   url          : URL de la page (détection sous-domaine wixsite.com)
//
// Retour : { scores: {seo, securite, accessibilite, presence},
//            findings: [{axis, sev, key, title, detail}],
//            indeterminate: [keys], truncated }
// Un axe dont TOUS les points sont indéterminés vaut null (n/a).
export function analyzePage(html, opts = {}) {
  const truncated = !!opts.truncated;   // noProof (S13) = truncated OU coquille SPA, défini plus bas
  const findings = [];
  const indeterminate = [];
  const add = (axis, sev, key, title, detail) => findings.push({ axis, sev, key, title, detail });
  // Preuve S8 : « pas trouvé » n'est une absence que si le document est
  // complet. Sur un tronqué → indéterminé (pas de finding, hors dénominateur).
  const undet = (key) => indeterminate.push(key);

  // ── S13.1 · détections de CONTENU sur le HTML « VISIBLE » ────────────────
  // (sans commentaires ni corps de script/style : un <h1> commenté comptait
  // comme un vrai H1, un numéro dans du SVG inline comme un téléphone).
  // Le JSON-LD, lui, vit DANS des <script> → extrait du document brut.
  const vis = visibleHtml(html);

  // ── S13.2 · coquille SPA (rendu client) ─────────────────────────────────
  // Un site React/Vue livre un HTML quasi vide que le navigateur remplit.
  // L'ancien moteur le notait 40/100 avec dix faux findings. Principe S8 :
  // ce qu'on n'a pas PU voir est indéterminé, pas absent — Googlebot, lui,
  // exécute le JavaScript.
  const _visText = vis.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const spaShell = _visText.length < 200
    && /id=["'](root|app|__next|__nuxt)["']|data-reactroot|ng-version|ng-app/i.test(html);
  // « pas trouvé » n'est une absence que si on a pu lire le document ENTIER
  // et RENDU ; tronqué OU coquille SPA → indéterminé.
  const noProof = truncated || spaShell;

  const title = _decodeEntities(_between(vis, /<title[^>]*>([\s\S]*?)<\/title>/i));   // S14.2
  const metaDesc = _decodeEntities(_attr(_findTag(vis, 'meta', 'name', 'description'), 'content'));   // S14.2 — apostrophes + entités
  const h1 = (vis.match(/<h1[\s>]/gi) || []).length;
  // S10/C18 — le canonical se juge sur sa VALEUR, pas sa présence.
  const canonicalHref = _attr(_findTag(vis, 'link', 'rel', 'canonical'), 'href');    // S14.2
  const canonical = !!canonicalHref || /<link[^>]+rel=["']canonical["']/i.test(vis);
  const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(vis);
  const ogImage = /<meta[^>]+property=["']og:image["']/i.test(vis);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(vis);
  const lang = /<html[^>]+lang=/i.test(vis);
  const imgs = (vis.match(/<img\b/gi) || []).length;
  const imgsAlt = (vis.match(/<img\b[^>]*\balt=/gi) || []).length;
  const imgsMissing = Math.max(0, imgs - imgsAlt);

  const ld = extractJsonLd(html);
  const micro = _microdataTypes(vis);
  const jsonld = ld.nodes.length > 0;

  // ── NAP structuré (S8/C5) — la donnée PARSÉE d'abord, les regex de texte
  //    en dernier recours et resserrées. Les anciennes détections larges
  //    créditaient wordpress.org d'un téléphone français (coordonnées SVG)
  //    et d'une adresse (« place » anglais + 5 chiffres quelconques).
  const ldPhone = ld.nodes.some((n) => n.telephone && String(n.telephone).trim());
  const ldAddress = ld.nodes.some((n) => n.address) || ld.types.has('PostalAddress') || micro.has('PostalAddress');
  // S10/C19 — entité typée : pour un hébergement, les « horaires » pertinents
  // sont l'arrivée/départ (checkinTime/checkoutTime), pas openingHours.
  const isLodging = [...ld.types].some((t) => LODGING_TYPES.has(t)) || [...micro].some((t) => LODGING_TYPES.has(t));
  const ldHours = ld.nodes.some((n) => n.openingHours || n.openingHoursSpecification)
    || (isLodging && ld.nodes.some((n) => n.checkinTime || n.checkoutTime))
    || micro.has('OpeningHoursSpecification') || /itemprop=["']openingHours["']/i.test(vis);
  // S13.3 — francophonie, pas seulement la France : +33/+32/+41/+352 et
  // codes postaux à 4 chiffres (BE/CH/LU). Une friterie de Namur avait
  // présence 0/100 et quatre faux findings.
  // S16 — les motifs de secours lisent `napText` (texte APLATI et décodé) et
  // non plus le balisage : un attribut n'est pas du texte. Cf. le bloc S16
  // en tête de fichier — deux faux positifs et deux faux négatifs fermés.
  const napText = _decodeEntities(_visText).replace(/\s+/g, ' ');
  const napPhone = /href=["']tel:/i.test(vis) || ldPhone
    || /itemprop=["']telephone["']/i.test(vis)
    || phoneInText(napText);
  const napAddress = ldAddress || /<address[\s>]/i.test(vis)
    || addressInText(napText);
  const napLocalBiz = [...ld.types].some((t) => LOCALBUSINESS_TYPES.has(t))
    || [...micro].some((t) => LOCALBUSINESS_TYPES.has(t));
  const napHours = ldHours;

  const sec = {};
  const headers = opts.headers || null;
  if (headers) for (const [h, label] of SEC_HEADERS) sec[label] = !!headers[h];

  // ── Comptabilité par axe : earned / possible, renormalisée ──────────────
  // item(axis, key, poids, état, points_si_vrai, finding_si_faux)
  //   état : true | false | null (null = indéterminé → hors dénominateur)
  const axes = { seo: { earned: 0, possible: 0 }, accessibilite: { earned: 0, possible: 0 }, presence: { earned: 0, possible: 0 } };
  const item = (axis, weight, state, earnedPts, onFalse) => {
    if (state === null) return;               // indéterminé : hors calcul
    axes[axis].possible += weight;
    if (state) axes[axis].earned += earnedPts != null ? earnedPts : weight;
    else if (onFalse) onFalse();
  };

  // ── SEO technique (barème S2 inchangé : 15+15+15+10+10+8+7+10+10 = 100) ──
  // <title> : tout début de document — si absent d'un buffer même tronqué
  // de plusieurs centaines de Ko, l'absence est réelle. Déterminé.
  item('seo', 15, !!title, title ? ((title.length >= 10 && title.length <= 70) ? 15 : 8) : 0,
    () => add('seo', 'high', 'title_missing', 'Balise <title> absente', 'Le titre est le premier signal SEO.'));
  if (title && title.length > 70) add('seo', 'low', 'title_long', 'Balise title trop longue', `${title.length} caractères — visez 50-60.`);
  item('seo', 15, metaDesc ? true : (noProof ? null : false), metaDesc ? ((metaDesc.length >= 50 && metaDesc.length <= 165) ? 15 : 8) : 0,
    () => add('seo', 'high', 'meta_missing', 'Méta description absente', 'Rédigez 50-160 caractères qui donnent envie de cliquer.'));
  if (!metaDesc && noProof) undet('meta_missing');
  // S11.2 — une méta HORS NORME perdait 7 points en silence : le score
  // baissait sans qu'aucun finding ne l'explique (constaté sur le crawl
  // complet du Mas : SEO 99 → 90 sans nouvelle ligne dans le rapport).
  // Un point de score doit toujours avoir sa ligne d'explication.
  if (metaDesc && (metaDesc.length < 50 || metaDesc.length > 165)) {
    add('seo', 'low', 'meta_length',
      metaDesc.length < 50 ? `Méta description trop courte (${metaDesc.length} c.)` : `Méta description trop longue (${metaDesc.length} c.)`,
      'Visez 50-160 caractères : c\'est le texte qui donne envie de cliquer dans Google.');
  }
  // H1 — préuve asymétrique : 1 trouvé = OK ; >1 trouvés = défaut avéré même
  // tronqué ; 0 trouvé sur tronqué = indéterminé (le bug d'origine : H1 à
  // 2,3 Mo, coupe à 500 Ko → « Aucun H1 » émis à tort sur 5 pages).
  item('seo', 15, h1 === 1 ? true : (h1 > 1 ? false : (noProof ? null : false)), 15,
    () => add('seo', 'medium', 'h1', h1 === 0 ? 'Aucun <h1>' : `${h1} balises <h1>`, 'Une page = un seul titre H1.'));
  if (h1 === 0 && noProof) undet('h1');
  item('seo', 10, canonical ? true : (noProof ? null : false), 10,
    () => add('seo', 'low', 'canonical', 'Balise canonical absente', 'Évite le contenu dupliqué aux yeux de Google.'));
  if (!canonical && noProof) undet('canonical');
  item('seo', 10, viewport ? true : (noProof ? null : false), 10,
    () => add('seo', 'high', 'viewport', 'Pas de balise viewport', 'Indispensable pour le mobile.'));
  if (!viewport && noProof) undet('viewport');
  item('seo', 8, ogTitle ? true : (noProof ? null : false), 8,
    () => add('seo', 'low', 'og_title', 'Open Graph titre absent', 'Améliore l\'aperçu lors des partages.'));
  if (!ogTitle && noProof) undet('og_title');
  item('seo', 7, ogImage ? true : (noProof ? null : false), 7,
    () => add('seo', 'low', 'og_image', 'Open Graph image absente', 'Une image d\'aperçu augmente les clics sur les réseaux.'));
  if (!ogImage && noProof) undet('og_image');
  item('seo', 10, jsonld ? true : (noProof ? null : false), 10,
    () => add('seo', 'medium', 'jsonld', 'Données structurées (Schema.org) absentes', 'Sans elles, les IA et Google comprennent mal votre activité.'));
  if (!jsonld && noProof) undet('jsonld');
  // Sitemap : contrôle réseau site-level, résultat toujours déterminé.
  item('seo', 10, !!opts.sitemap, 10,
    () => { if (!opts.skipSite) add('seo', 'low', 'sitemap', 'Sitemap introuvable', 'Aide les moteurs à explorer toutes vos pages.'); });

  // Wix gratuit (site-level, détecté sur l'URL — indépendant du HTML).
  let host = ''; try { host = new URL(opts.url || '').hostname; } catch (_) {}
  if (!opts.skipSite && /\.wixsite\.com$/i.test(host)) {
    add('seo', 'high', 'wix_subdomain', 'Site sur une adresse Wix gratuite',
      'L\'adresse se termine par .wixsite.com : un domaine personnalisé améliorerait nettement le référencement et la crédibilité.');
  }

  // ── S10/C17 — cohérence url/@id du JSON-LD vs domaine audité ────────────
  // La fiche déclare l'adresse officielle de l'entité aux moteurs et aux IA.
  // Si elle pointe ailleurs (staging oublié, ancien domaine), on dit à Google
  // que l'établissement vit à une autre adresse que celle qu'on indexe.
  // sameAs (réseaux sociaux) est légitimement externe — jamais contrôlé.
  const auditedHost = _hostOfUrl(opts.url || '');
  if (auditedHost) {
    const offenders = new Map();   // badHost → exemple d'URL
    for (const nd of ld.nodes) {
      const t = nd['@type']; const tl = Array.isArray(t) ? t : (t ? [t] : []);
      const isEntity = tl.some((x) => LOCALBUSINESS_TYPES.has(x) || x === 'Organization' || x === 'WebSite');
      if (!isEntity) continue;
      for (const field of ['url', '@id']) {
        const v = nd[field];
        if (typeof v !== 'string' || !/^https?:\/\//i.test(v)) continue;
        const h = _hostOfUrl(v);
        if (h && h !== auditedHost && !offenders.has(h)) offenders.set(h, v);
      }
    }
    for (const [badHost, example] of offenders) {
      const staging = STAGING_HOSTS.test('.' + badHost);
      add('seo', 'high', 'jsonld_url_mismatch',
        staging ? 'URL de staging dans les données structurées' : 'Données structurées : le domaine déclaré n\'est pas celui du site',
        `Votre fiche (JSON-LD) déclare « ${example} » comme adresse officielle, alors que le site audité est ${auditedHost}.${staging ? ' C\'est une adresse de brouillon/staging de plateforme — oubli fréquent lors de la mise en ligne.' : ''} Les moteurs et les IA peuvent attribuer votre établissement au mauvais domaine.`);
    }
  }

  // ── S16/C24 — deux fiches pour un seul établissement ────────────────────
  // Informatif (hors barème, comme tous les contrôles S10+) : le défaut ne
  // coûte pas de points au client, il coûte de la compréhension aux moteurs.
  const split = entitySplit(ld.nodes);
  if (split) {
    add('presence', 'medium', 'jsonld_entity_split',
      'Deux fiches d\'établissement non reliées',
      // S16.3 — sans nom déclaré, ne pas imprimer « votre établissement » entre
      // guillemets : sur districtcafe.ca, ça se lisait comme un texte à trous
      // resté vide. Les fiches y sont rapprochées par le téléphone, pas le nom.
      `Votre page décrit ${split.name ? `« ${split.name} »` : 'votre établissement'} DEUX fois : une fiche ${split.a} et une fiche ${split.b}, sans rien qui les relie${split.missingId ? ' (l\'une n\'a pas d\'identifiant « @id »)' : ''}. Les moteurs et les IA peuvent y voir deux établissements distincts, ou n\'en retenir qu\'un seul — souvent le moins complet. Donnez le MÊME « @id » aux deux : Schema.org fusionne alors les fiches qui le partagent, et tous vos signaux comptent pour la même entité.`);
  }

  // ── S10/C18 — canonical : la VALEUR compte ───────────────────────────────
  // Un canonical vers un AUTRE domaine dit à Google « la vraie page est
  // ailleurs » : la page auditée sort de l'index au profit de l'autre.
  // www vs apex du même domaine = normal (géré site-level en agrégation).
  if (canonicalHref && auditedHost) {
    const ch = _hostOfUrl(canonicalHref);
    if (ch && ch !== auditedHost) {
      add('seo', 'high', 'canonical_mismatch', 'Canonical vers un autre domaine',
        `La balise canonical pointe vers « ${canonicalHref} » alors que la page vit sur ${auditedHost} : vous demandez à Google d'indexer l'autre domaine à votre place.`);
    }
  }

  // ── Sécurité (en-têtes de réponse : déterminés même si HTML tronqué) ─────
  // S9/C8 : sur plateforme managée, un en-tête exempté absent est « non
  // applicable » (l'utilisateur n'a pas la main) — hors findings, hors calcul.
  const managed = MANAGED_PLATFORMS.has(String(opts.platform || '').toLowerCase());
  const notApplicable = [];
  let securite = null;
  if (headers) {
    let secEarned = 0, secPossible = 0;
    for (const [, label] of SEC_HEADERS) {
      if (!sec[label] && managed && MANAGED_HEADER_EXEMPT.has(label)) { notApplicable.push(`sec_${label}`); continue; }
      secPossible += 20;
      if (sec[label]) secEarned += 20;
      else add('securite', label === 'HSTS' || label === 'CSP' ? 'medium' : 'low', `sec_${label}`, `En-tête ${label} absent`, 'Renforce la protection des visiteurs.');
    }
    securite = secPossible ? Math.round(100 * secEarned / secPossible) : null;
  }

  // ── Accessibilité (35 lang + 25 viewport + 40 alt = 100) ─────────────────
  item('accessibilite', 35, lang ? true : (noProof ? null : false), 35,
    () => add('accessibilite', 'low', 'lang', 'Langue de la page non déclarée', 'Ajoutez lang="fr" sur <html>.'));
  if (!lang && noProof) undet('lang');
  item('accessibilite', 25, viewport ? true : (noProof ? null : false), 25);
  if (imgs > 0) {
    // Des alt manquants VUS sont un défaut avéré (même tronqué) ; un sans-faute
    // sur un buffer partiel ne prouve rien → indéterminé.
    const altState = imgsMissing > 0 ? false : (noProof ? null : true);
    item('accessibilite', 40, altState, Math.round(40 * imgsAlt / Math.max(1, imgs)),
      () => add('accessibilite', 'medium', 'img_alt', `${imgsMissing} image${imgsMissing > 1 ? 's' : ''} sans texte alternatif`, 'Le texte alt aide l\'accessibilité et le SEO images.'));
    if (imgsMissing > 0) { axes.accessibilite.earned += Math.round(40 * imgsAlt / imgs); }  // crédit partiel des alt présents
    if (altState === null) undet('img_alt');
  } else {
    item('accessibilite', 40, noProof ? null : true, 40);   // « aucune image » ne se conclut pas d'un tronqué/SPA
    if (noProof) undet('img_alt');
  }

  // ── Présence locale (30 tél + 35 adresse + 20 fiche + 15 horaires = 100) ──
  item('presence', 30, napPhone ? true : (noProof ? null : false), 30,
    () => add('presence', 'low', 'nap_phone', 'Téléphone non détecté sur la page', 'Affichez un numéro cliquable (lien tel:) — clé pour les recherches locales et les IA.'));
  if (!napPhone && noProof) undet('nap_phone');
  item('presence', 35, napAddress ? true : (noProof ? null : false), 35,
    () => add('presence', 'low', 'nap_address', 'Adresse postale non structurée', 'Affichez votre adresse complète, idéalement en données structurées (PostalAddress).'));
  if (!napAddress && noProof) undet('nap_address');
  item('presence', 20, napLocalBiz ? true : (noProof ? null : false), 20,
    () => add('presence', 'medium', 'nap_localbiz', 'Fiche établissement (LocalBusiness) absente', 'Décrivez votre établissement en Schema.org LocalBusiness : nom, adresse, téléphone, horaires.'));
  if (!napLocalBiz && noProof) undet('nap_localbiz');
  // S10/C19 — le finding « horaires » parle la langue de l'entité : conseiller
  // openingHours à un gîte était un conseil faux pour toute la verticale.
  item('presence', 15, napHours ? true : (noProof ? null : false), 15,
    () => {
      if (isLodging) {
        findings.push({ axis: 'presence', sev: 'medium', key: 'nap_hours', entity: 'lodging',
          title: 'Heures d\'arrivée / départ non déclarées',
          detail: 'Pour un hébergement, déclarez checkinTime et checkoutTime (pas openingHours) — repris par Google et les assistants IA.' });
      } else {
        add('presence', 'medium', 'nap_hours', 'Horaires d\'ouverture non déclarés', 'Publiez vos horaires (openingHours) — repris par Google et les assistants IA.');
      }
    });
  if (!napHours && noProof) undet('nap_hours');

  // ── S10/C21 — indices GEO extraits du balisage (ville + activité) ────────
  // Tout était déjà là sur le Mas : addressLocality + @type LodgingBusiness.
  // Le worker s'en sert pour pré-remplir la config GEO si elle est vide.
  let geoCity = '';
  for (const nd of ld.nodes) {
    const addr = nd.address;
    const locality = addr && typeof addr === 'object' && !Array.isArray(addr) ? addr.addressLocality
      : (Array.isArray(addr) ? (addr.find((a) => a && a.addressLocality) || {}).addressLocality : null);
    if (locality && String(locality).trim()) { geoCity = String(locality).trim(); break; }
    if (nd['@type'] === 'PostalAddress' && nd.addressLocality) { geoCity = String(nd.addressLocality).trim(); break; }
  }
  let geoActivity = '';
  for (const t of ld.types) { if (TYPE_ACTIVITY_FR[t]) { geoActivity = TYPE_ACTIVITY_FR[t]; break; } }

  // ── Scores : renormalisation sur les points déterminés ──────────────────
  const norm = (ax) => {
    const { earned, possible } = axes[ax];
    if (!possible) return null;                              // tout indéterminé → n/a
    return Math.min(100, Math.round(100 * earned / possible));
  };

  return {
    scores: { seo: norm('seo'), securite, accessibilite: norm('accessibilite'), presence: norm('presence') },
    findings, indeterminate, notApplicable, truncated, spaShell,
    canonicalHost: canonicalHref ? _hostOfUrl(canonicalHref) : null,   // S10/C18 — cohérence inter-pages (agrégation)
    canonicalHrefHost: canonicalHref ? (() => { try { return new URL(canonicalHref).hostname.toLowerCase(); } catch (_) { return null; } })() : null,  // avec www — pour le check www/apex
    geoHints: { city: geoCity, activity: geoActivity },                // S10/C21 — pré-remplissage GEO
  };
}
