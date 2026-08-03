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
export const MANAGED_PLATFORMS = new Set(['wix']);
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

const _between = (html, re) => { const m = html.match(re); return m ? (m[1] || '').trim() : ''; };

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
  const truncated = !!opts.truncated;
  const findings = [];
  const indeterminate = [];
  const add = (axis, sev, key, title, detail) => findings.push({ axis, sev, key, title, detail });
  // Preuve S8 : « pas trouvé » n'est une absence que si le document est
  // complet. Sur un tronqué → indéterminé (pas de finding, hors dénominateur).
  const undet = (key) => indeterminate.push(key);

  // ── Détections (regex /i sur le document original — pas de copie lowercase,
  //    5 pages sont analysées en parallèle dans le Worker : mémoire comptée) ──
  const title = _between(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDesc = _between(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
                || _between(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  const canonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
  const ogImage = /<meta[^>]+property=["']og:image["']/i.test(html);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const lang = /<html[^>]+lang=/i.test(html);
  const imgs = (html.match(/<img\b/gi) || []).length;
  const imgsAlt = (html.match(/<img\b[^>]*\balt=/gi) || []).length;
  const imgsMissing = Math.max(0, imgs - imgsAlt);

  const ld = extractJsonLd(html);
  const micro = _microdataTypes(html);
  const jsonld = ld.nodes.length > 0;

  // ── NAP structuré (S8/C5) — la donnée PARSÉE d'abord, les regex de texte
  //    en dernier recours et resserrées. Les anciennes détections larges
  //    créditaient wordpress.org d'un téléphone français (coordonnées SVG)
  //    et d'une adresse (« place » anglais + 5 chiffres quelconques).
  const ldPhone = ld.nodes.some((n) => n.telephone && String(n.telephone).trim());
  const ldAddress = ld.nodes.some((n) => n.address) || ld.types.has('PostalAddress') || micro.has('PostalAddress');
  const ldHours = ld.nodes.some((n) => n.openingHours || n.openingHoursSpecification)
    || micro.has('OpeningHoursSpecification') || /itemprop=["']openingHours["']/i.test(html);
  const napPhone = /href=["']tel:/i.test(html) || ldPhone
    || /itemprop=["']telephone["']/i.test(html)
    || /(?:\+33|0033)[\s.\-]?[1-9](?:[\s.\-]?\d{2}){4}/.test(html);   // +33 requis : le motif 0X.. matchait du SVG
  const napAddress = ldAddress || /<address[\s>]/i.test(html)
    // rue/avenue/… suivi d'un code postal dans le même nœud de texte (≤ 80 c.)
    || /\b(?:rue|avenue|boulevard|impasse|chemin|all[ée]e|quai|route)\b[^<>]{0,80}\b\d{5}\b/i.test(html);
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
  item('seo', 15, metaDesc ? true : (truncated ? null : false), metaDesc ? ((metaDesc.length >= 50 && metaDesc.length <= 165) ? 15 : 8) : 0,
    () => add('seo', 'high', 'meta_missing', 'Méta description absente', 'Rédigez 50-160 caractères qui donnent envie de cliquer.'));
  if (!metaDesc && truncated) undet('meta_missing');
  // H1 — préuve asymétrique : 1 trouvé = OK ; >1 trouvés = défaut avéré même
  // tronqué ; 0 trouvé sur tronqué = indéterminé (le bug d'origine : H1 à
  // 2,3 Mo, coupe à 500 Ko → « Aucun H1 » émis à tort sur 5 pages).
  item('seo', 15, h1 === 1 ? true : (h1 > 1 ? false : (truncated ? null : false)), 15,
    () => add('seo', 'medium', 'h1', h1 === 0 ? 'Aucun <h1>' : `${h1} balises <h1>`, 'Une page = un seul titre H1.'));
  if (h1 === 0 && truncated) undet('h1');
  item('seo', 10, canonical ? true : (truncated ? null : false), 10,
    () => add('seo', 'low', 'canonical', 'Balise canonical absente', 'Évite le contenu dupliqué aux yeux de Google.'));
  if (!canonical && truncated) undet('canonical');
  item('seo', 10, viewport ? true : (truncated ? null : false), 10,
    () => add('seo', 'high', 'viewport', 'Pas de balise viewport', 'Indispensable pour le mobile.'));
  if (!viewport && truncated) undet('viewport');
  item('seo', 8, ogTitle ? true : (truncated ? null : false), 8,
    () => add('seo', 'low', 'og_title', 'Open Graph titre absent', 'Améliore l\'aperçu lors des partages.'));
  if (!ogTitle && truncated) undet('og_title');
  item('seo', 7, ogImage ? true : (truncated ? null : false), 7,
    () => add('seo', 'low', 'og_image', 'Open Graph image absente', 'Une image d\'aperçu augmente les clics sur les réseaux.'));
  if (!ogImage && truncated) undet('og_image');
  item('seo', 10, jsonld ? true : (truncated ? null : false), 10,
    () => add('seo', 'medium', 'jsonld', 'Données structurées (Schema.org) absentes', 'Sans elles, les IA et Google comprennent mal votre activité.'));
  if (!jsonld && truncated) undet('jsonld');
  // Sitemap : contrôle réseau site-level, résultat toujours déterminé.
  item('seo', 10, !!opts.sitemap, 10,
    () => { if (!opts.skipSite) add('seo', 'low', 'sitemap', 'Sitemap introuvable', 'Aide les moteurs à explorer toutes vos pages.'); });

  // Wix gratuit (site-level, détecté sur l'URL — indépendant du HTML).
  let host = ''; try { host = new URL(opts.url || '').hostname; } catch (_) {}
  if (!opts.skipSite && /\.wixsite\.com$/i.test(host)) {
    add('seo', 'high', 'wix_subdomain', 'Site sur une adresse Wix gratuite',
      'L\'adresse se termine par .wixsite.com : un domaine personnalisé améliorerait nettement le référencement et la crédibilité.');
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
  item('accessibilite', 35, lang ? true : (truncated ? null : false), 35,
    () => add('accessibilite', 'low', 'lang', 'Langue de la page non déclarée', 'Ajoutez lang="fr" sur <html>.'));
  if (!lang && truncated) undet('lang');
  item('accessibilite', 25, viewport ? true : (truncated ? null : false), 25);
  if (imgs > 0) {
    // Des alt manquants VUS sont un défaut avéré (même tronqué) ; un sans-faute
    // sur un buffer partiel ne prouve rien → indéterminé.
    const altState = imgsMissing > 0 ? false : (truncated ? null : true);
    item('accessibilite', 40, altState, Math.round(40 * imgsAlt / Math.max(1, imgs)),
      () => add('accessibilite', 'medium', 'img_alt', `${imgsMissing} image${imgsMissing > 1 ? 's' : ''} sans texte alternatif`, 'Le texte alt aide l\'accessibilité et le SEO images.'));
    if (imgsMissing > 0) { axes.accessibilite.earned += Math.round(40 * imgsAlt / imgs); }  // crédit partiel des alt présents
    if (altState === null) undet('img_alt');
  } else {
    item('accessibilite', 40, truncated ? null : true, 40);   // « aucune image » ne se conclut pas d'un tronqué
    if (truncated) undet('img_alt');
  }

  // ── Présence locale (30 tél + 35 adresse + 20 fiche + 15 horaires = 100) ──
  item('presence', 30, napPhone ? true : (truncated ? null : false), 30,
    () => add('presence', 'low', 'nap_phone', 'Téléphone non détecté sur la page', 'Affichez un numéro cliquable (lien tel:) — clé pour les recherches locales et les IA.'));
  if (!napPhone && truncated) undet('nap_phone');
  item('presence', 35, napAddress ? true : (truncated ? null : false), 35,
    () => add('presence', 'low', 'nap_address', 'Adresse postale non structurée', 'Affichez votre adresse complète, idéalement en données structurées (PostalAddress).'));
  if (!napAddress && truncated) undet('nap_address');
  item('presence', 20, napLocalBiz ? true : (truncated ? null : false), 20,
    () => add('presence', 'medium', 'nap_localbiz', 'Fiche établissement (LocalBusiness) absente', 'Décrivez votre établissement en Schema.org LocalBusiness : nom, adresse, téléphone, horaires.'));
  if (!napLocalBiz && truncated) undet('nap_localbiz');
  item('presence', 15, napHours ? true : (truncated ? null : false), 15,
    () => add('presence', 'medium', 'nap_hours', 'Horaires d\'ouverture non déclarés', 'Publiez vos horaires (openingHours) — repris par Google et les assistants IA.'));
  if (!napHours && truncated) undet('nap_hours');

  // ── Scores : renormalisation sur les points déterminés ──────────────────
  const norm = (ax) => {
    const { earned, possible } = axes[ax];
    if (!possible) return null;                              // tout indéterminé → n/a
    return Math.min(100, Math.round(100 * earned / possible));
  };

  return {
    scores: { seo: norm('seo'), securite, accessibilite: norm('accessibilite'), presence: norm('presence') },
    findings, indeterminate, notApplicable, truncated,
  };
}
