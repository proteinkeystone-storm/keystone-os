// ─────────────────────────────────────────────────────────────────────────
// SENTINEL · S8 — tests du moteur d'analyse on-page PUR contre des
// fixtures HTML RÉELLES (capturées le 2026-08-03, UA Sentinel, gzippées).
//   node workers/test/sentinel-audit.test.mjs   (ou `npm run test:sentinel`)
//
// RÈGLE : la vérité terrain de chaque fixture a été établie À LA MAIN
// (inspection indépendante du moteur). Si un test casse, c'est le moteur
// qu'on interroge d'abord, pas la fixture. Ne JAMAIS ajuster une valeur
// attendue pour faire passer le test sans re-vérifier la page à la main.
//
// Origine : rapport Mas des Bouteillans (2026-08-03) — 5 faux négatifs
// (« Aucun H1 » ×5, « LocalBusiness absent » ×4) nés d'une coupe à 500 Ko
// et d'une allowlist sans LodgingBusiness. Ces fixtures sont le cas de
// non-régression permanent.
// ─────────────────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePage, extractJsonLd, LOCALBUSINESS_TYPES, globalScore, perfScore, AXIS_WEIGHTS, sitemapLooksValid, phoneInText, addressInText, entitySplit, dedupeFixCode } from '../src/lib/audit-page.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name) => gunzipSync(readFileSync(join(FIX, `${name}.html.gz`))).toString('utf-8');
const keys = (r) => r.findings.map((f) => f.key).sort();

let n = 0;
const t = (label, fn) => { fn(); n++; console.log('  ✓', label); };

// ── extractJsonLd : formes et tolérance ──────────────────────────────────
t('extractJsonLd : objet simple, tableau, @graph, @type tableau, JSON invalide', () => {
  const html = `
    <script type="application/ld+json">{"@type":"Hotel","telephone":"+33 1"}</script>
    <script type="application/ld+json">[{"@type":"WebSite"},{"@type":["Thing","Restaurant"]}]</script>
    <script type="application/ld+json">{"@graph":[{"@type":"Bakery"}]}</script>
    <script type="application/ld+json">{pas du json}</script>`;
  const { nodes, types } = extractJsonLd(html);
  assert.equal(nodes.length, 4);
  for (const x of ['Hotel', 'WebSite', 'Thing', 'Restaurant', 'Bakery']) assert.ok(types.has(x), x);
});

t('LOCALBUSINESS_TYPES : la verticale hébergement est couverte (bug d\'origine)', () => {
  for (const x of ['LodgingBusiness', 'BedAndBreakfast', 'Campground', 'Hostel', 'Hotel', 'Motel', 'Resort', 'VacationRental', 'ProfessionalService', 'Restaurant'])
    assert.ok(LOCALBUSINESS_TYPES.has(x), x);
  assert.ok(!LOCALBUSINESS_TYPES.has('Organization'), 'Organization n\'est PAS un LocalBusiness');
  assert.ok(!LOCALBUSINESS_TYPES.has('WebSite'));
});

// ── Mas des Bouteillans — home (Wix Studio, 3,34 Mo, document complet) ───
// Vérité terrain (main, 2026-08-03) : 1 H1, title 60c, meta 78c, canonical,
// OG complet, 116/116 img alt, JSON-LD LodgingBusiness+LocalBusiness+WebSite,
// tel: + telephone, address, PAS d'openingHours.
t('mas-home : H1 détecté, LodgingBusiness reconnu, findings = horaires + staging (S10)', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, url: 'https://lemasdesbouteillans.com/' });
  assert.equal(r.truncated, false);
  // Révision S10 (vérifiée à la main le 2026-08-03) : le JSON-LD LodgingBusiness
  // du Mas déclare bien url=proteinstd.wixstudio.com — VRAI défaut, le finding
  // C17 DOIT sortir. Toujours ni 'h1' ni 'nap_localbiz' (les 2 faux négatifs S7).
  // Révision S16/C24 (re-vérifiée À LA MAIN le 2026-08-04, sur la fixture ET
  // sur la page servie en direct) : cette home porte DEUX fiches du même
  // établissement — LodgingBusiness (bloc maison) et LocalBusiness (généré par
  // Wix depuis « Infos de l'entreprise »), mêmes nom et téléphone, aucun @id
  // commun. Défaut réel, jamais signalé jusqu'ici : le finding DOIT sortir.
  // Les pages gîtes, elles, n'ont qu'un seul nœud — d'où l'attendu inchangé
  // ci-dessous : Wix ne génère sa fiche que sur la page d'accueil.
  assert.deepEqual(keys(r), ['jsonld_entity_split', 'jsonld_url_mismatch', 'nap_hours']);
  assert.equal(r.scores.seo, 100);                     // S10 = informatif, ne touche pas au barème
  assert.equal(r.scores.accessibilite, 100);
  assert.equal(r.scores.presence, 85);                 // 30+35+20, horaires absents (réel)
  assert.equal(r.scores.securite, null);               // pas d'en-têtes fournis au moteur pur
  assert.deepEqual(r.indeterminate, []);               // document complet : tout est déterminé
});

// ── Les 4 pages gîtes (le cœur du faux négatif : LodgingBusiness SEUL) ───
// RÉVISION S14.2 (re-vérifiée À LA MAIN le 2026-08-04, cf. règle d'en-tête) :
// l'arbousier a une méta de **149 caractères**, parfaitement dans la norme.
// Les « 1 caractère » de S11.2 étaient une CAPTURE TRONQUÉE À L'APOSTROPHE
// (« L'Arbousier » → « L »), pas un défaut du site. Le finding meta_length
// disparaît et l'axe SEO repasse à 100 : le site n'a jamais eu ce défaut.
for (const [page, seoAttendu] of [['arbousier', 100], ['escapades', 100], ['myrtes', 100], ['cypres', 100]]) {
  t(`mas-${page} : LodgingBusiness seul suffit, presence 85, seo ${seoAttendu}`, () => {
    const r = analyzePage(load(`wix-studio-mas-${page}`), { skipSite: true, sitemap: true, url: `https://lemasdesbouteillans.com/${page}` });
    assert.deepEqual(keys(r), ['jsonld_url_mismatch', 'nap_hours']);
    assert.equal(r.scores.seo, seoAttendu);
    assert.equal(r.scores.presence, 85);
    assert.equal(r.scores.accessibilite, 100);
  });
}

// ── PKS (statique Vercel — le site du dogfooding) ────────────────────────
// Vérité terrain : ProfessionalService + tel + adresse + horaires → presence
// 100. Méta **240 caractères** (mesure S14.2, apostrophes et entités
// comprises) → trop longue pour de bon → seo 93. NB : les « 166 c. » notés
// en S11.2 étaient eux aussi une capture tronquée — le finding était juste
// par accident, il l'est maintenant pour la bonne raison.
t('pks : ProfessionalService reconnu, presence 100, meta 240c (trop longue) → seo 93', () => {
  const r = analyzePage(load('static-vercel-pks'), { sitemap: true, url: 'https://protein-keystone.com/' });
  assert.deepEqual(keys(r), ['meta_length']);
  assert.equal(r.scores.presence, 100);
  assert.equal(r.scores.seo, 93);
  assert.equal(r.scores.accessibilite, 100);
});

// ── wordpress.org — CONTRÔLE NÉGATIF ─────────────────────────────────────
// Organization n'est pas un LocalBusiness ; pas de téléphone français, pas
// d'adresse française. L'ancien moteur créditait les trois : la regex
// téléphone matchait des coordonnées SVG (« 0682 26.5465 ») et l'adresse
// se déduisait de « place » (mot anglais) + 5 chiffres quelconques du JS.
t('wordpress-org : AUCUN crédit NAP — le contrôle anti-faux-positifs', () => {
  const r = analyzePage(load('wordpress-org'), { sitemap: true, url: 'https://wordpress.org/' });
  assert.deepEqual(keys(r), ['nap_address', 'nap_hours', 'nap_localbiz', 'nap_phone']);
  assert.equal(r.scores.presence, 0);
  assert.equal(r.scores.seo, 100);
});

// ── Troncature : reproduction EXACTE du bug d'origine ────────────────────
// La coupe à 500 Ko sur la home du Mas produisait « Aucun H1 ». Le moteur
// S8 doit dire « indéterminé » : pas de finding, point hors dénominateur.
t('mas-home tronquée à 500 Ko : h1 indéterminé, AUCUN faux finding (le vrai reste)', () => {
  const r = analyzePage(load('wix-studio-mas-home').slice(0, 500000), { truncated: true, sitemap: true, url: 'https://lemasdesbouteillans.com/' });
  assert.equal(r.truncated, true);
  // Preuve asymétrique S8/S10 : le staging (VU dans le buffer) reste un
  // finding valable même tronqué ; le H1 (non vu) reste indéterminé.
  // S16/C24 s'ajoute pour la même raison : les deux fiches ont été VUES dans
  // le buffer, et un bloc JSON-LD ne se parse que s'il est complet (un
  // <script> coupé échoue au JSON.parse et est ignoré). L'absence d'@id
  // commun est donc constatée sur deux objets entiers, pas déduite d'un vide.
  assert.deepEqual(keys(r), ['jsonld_entity_split', 'jsonld_url_mismatch']);  // l'ancien moteur émettait 'h1' ici — LE bug
  assert.ok(r.indeterminate.includes('h1'));
  assert.ok(r.indeterminate.includes('nap_hours'));    // « pas trouvé » sur tronqué ≠ absent
  assert.equal(r.scores.presence, 100);                // renormalisé sur tél+adresse+fiche (trouvés)
  assert.equal(r.scores.seo, 100);                     // renormalisé sans le point H1
});

// ── Preuve asymétrique : un défaut VU sur un tronqué reste un défaut ─────
t('tronqué : 2 H1 vus = finding valable ; alt manquants vus = finding valable', () => {
  const html = '<html lang="fr"><head><title>Un titre correct</title></head><body>'
    + '<h1>a</h1><h1>b</h1><img src="x.jpg"><p>' + 'x'.repeat(1000) + '</p>';
  const r = analyzePage(html, { truncated: true });
  const k = keys(r);
  assert.ok(k.includes('h1'), '2 H1 vus → défaut avéré même tronqué');
  assert.ok(k.includes('img_alt'), 'alt manquant vu → défaut avéré même tronqué');
  assert.ok(!k.includes('meta_missing'), 'absence non prouvable sur tronqué');
  assert.ok(r.indeterminate.includes('meta_missing'));
});

// ── Document complet : les absences redeviennent des findings normaux ────
t('complet : les absences réelles sont bien émises (pas de sur-correction)', () => {
  const r = analyzePage('<html><head></head><body><p>rien</p></body></html>', {});
  const k = keys(r);
  for (const x of ['title_missing', 'meta_missing', 'h1', 'canonical', 'viewport', 'jsonld', 'lang', 'nap_phone', 'nap_address', 'nap_localbiz', 'nap_hours'])
    assert.ok(k.includes(x), x);
  assert.equal(r.indeterminate.length, 0);
});

// ── Microdata : fallback itemtype ────────────────────────────────────────
t('microdata itemtype LocalBusiness reconnu sans JSON-LD', () => {
  const html = '<html lang="fr"><head><title>Boucherie Sanzot correcte</title></head><body>'
    + '<div itemscope itemtype="https://schema.org/Restaurant"><span itemprop="telephone">+33 4 94 00 00 00</span></div></body></html>';
  const r = analyzePage(html, {});
  const k = keys(r);
  assert.ok(!k.includes('nap_localbiz'));
  assert.ok(!k.includes('nap_phone'));
});

// ═══ S9 — intégrité du score ═════════════════════════════════════════════

// ── C8 : sécurité scopée hébergeur ───────────────────────────────────────
// Le Mas (Wix) sert HSTS + X-Content-Type-Options ; CSP/XFO/Referrer-Policy
// ne sont PAS réglables sur Wix → non applicables, axe renormalisé.
const MAS_HEADERS = { 'strict-transport-security': 'max-age=31556952', 'x-content-type-options': 'nosniff' };
t('C8 · Wix : en-têtes non réglables → non applicables, sécurité 100', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, headers: MAS_HEADERS, platform: 'wix' });
  assert.equal(r.scores.securite, 100);                      // 2/2 contrôlables présents
  assert.deepEqual(r.notApplicable.sort(), ['sec_CSP', 'sec_Referrer-Policy', 'sec_X-Frame-Options']);
  assert.ok(!keys(r).some((k) => k.startsWith('sec_')), 'aucun finding sécurité non actionnable');
});
t('C8 · même site déclaré custom : les 3 en-têtes redeviennent exigibles (40)', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, headers: MAS_HEADERS, platform: 'custom' });
  assert.equal(r.scores.securite, 40);                       // 2 × 20 sur 5 exigés
  assert.equal(keys(r).filter((k) => k.startsWith('sec_')).length, 3);
  assert.deepEqual(r.notApplicable, []);
});
t('C8 · Wix avec un en-tête CONTRÔLABLE manquant : toujours pénalisé', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, headers: { 'content-security-policy': "default-src 'self'" }, platform: 'wix' });
  // HSTS + XCTO manquants (contrôlables) ; CSP présent compte. XFO/RP absents → n/a.
  assert.equal(r.scores.securite, Math.round(100 * 20 / 60));
  assert.ok(keys(r).includes('sec_HSTS'));
});

// ── C7 : pondération fixe + politique n/a ────────────────────────────────
t('C7 · poids fixes : somme = 1, score pondéré exact', () => {
  assert.equal(Math.round(Object.values(AXIS_WEIGHTS).reduce((a, b) => a + b, 0) * 100), 100);
  // cas Mas post-S9 : seo 99, perf 100, sécu 100, a11y 100, présence 85, dispo 100
  const g = globalScore({ seo: 99, performance: 100, securite: 100, accessibilite: 100, presence: 85, disponibilite: 100 });
  assert.equal(g, Math.round(99 * .25 + 100 * .20 + 100 * .15 + 100 * .15 + 85 * .15 + 100 * .10));  // 97
});
t('C7 · axe n/a : renormalisation (le score ne bouge pas arbitrairement)', () => {
  const avec = globalScore({ seo: 80, performance: 80, securite: 80, accessibilite: 80, presence: 80, disponibilite: 80 });
  const sans = globalScore({ seo: 80, performance: null, securite: 80, accessibilite: 80, presence: 80, disponibilite: null });
  assert.equal(avec, 80); assert.equal(sans, 80);            // un axe n/a ne doit PAS déplacer un score homogène
  assert.equal(globalScore({}), null);
  assert.equal(globalScore(null), null);
});

// ── C9 : le poids de page entre au score perf ────────────────────────────
t('C9 · page à 3 Mo : perf < 100 même avec LCP/CLS parfaits (fin de l\'incohérence)', () => {
  const parfaitLeger = perfScore({ lcp: 800, cls: 0, fcp: 700, weightKb: 900 });
  const parfaitLourd = perfScore({ lcp: 800, cls: 0, fcp: 700, weightKb: 3072 });
  assert.equal(parfaitLeger, 100);
  assert.ok(parfaitLourd < 100, `3 Mo doit coûter des points (obtenu ${parfaitLourd})`);
  assert.ok(parfaitLourd >= 85, 'mais rester secondaire face aux CWV');
  assert.equal(perfScore(null), null);
});

// ═══ S10 — contrôles à valeur ════════════════════════════════════════════

// ── C17 : LE check signature — l'URL de staging du Mas, enfin détectée ───
t('C17 · mas : le staging proteinstd.wixstudio.com est détecté et nommé', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, url: 'https://lemasdesbouteillans.com/' });
  const f = r.findings.find((x) => x.key === 'jsonld_url_mismatch');
  assert.ok(f, 'le finding doit exister');
  assert.equal(f.sev, 'high');
  assert.ok(f.title.includes('staging'), 'wixstudio.com doit être reconnu comme staging');
  assert.ok(f.detail.includes('proteinstd.wixstudio.com'), 'le détail nomme l\'URL fautive');
});
t('C17 · sameAs externes légitimes : jamais contrôlés (pas de faux positif réseaux sociaux)', () => {
  const html = `<html lang="fr"><head><title>Titre correct ici</title><script type="application/ld+json">
    {"@type":"Restaurant","url":"https://mon-resto.fr","sameAs":["https://facebook.com/monresto","https://instagram.com/monresto"]}
    </script></head><body><h1>x</h1></body></html>`;
  const r = analyzePage(html, { url: 'https://mon-resto.fr/' });
  assert.ok(!keys(r).includes('jsonld_url_mismatch'));
});
t('C17 · www vs apex du même domaine : pas un mismatch', () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"Store","url":"https://www.exemple.fr"}</script></head><body></body></html>`;
  const r = analyzePage(html, { url: 'https://exemple.fr/' });
  assert.ok(!keys(r).includes('jsonld_url_mismatch'));
});

// ── C18 : canonical par valeur ────────────────────────────────────────────
t('C18 · canonical vers un autre domaine → finding high', () => {
  const html = `<html lang="fr"><head><title>Titre correct ici</title><link rel="canonical" href="https://ancien-domaine.fr/page"></head><body><h1>x</h1></body></html>`;
  const r = analyzePage(html, { url: 'https://nouveau-domaine.fr/page' });
  const f = r.findings.find((x) => x.key === 'canonical_mismatch');
  assert.ok(f && f.sev === 'high');
});
t('C18 · canonical www du même domaine : conforme (cas du Mas)', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, url: 'https://lemasdesbouteillans.com/' });
  assert.ok(!keys(r).includes('canonical_mismatch'));
  assert.equal(r.canonicalHost, 'lemasdesbouteillans.com');            // exposé pour la cohérence inter-pages
  assert.equal(r.canonicalHrefHost, 'www.lemasdesbouteillans.com');
});

// ── C19 : entité typée ────────────────────────────────────────────────────
t('C19 · lodging avec checkinTime/checkoutTime : horaires satisfaits', () => {
  const html = `<html lang="fr"><head><title>Titre correct ici</title><script type="application/ld+json">
    {"@type":"LodgingBusiness","url":"https://gite.fr","telephone":"+33 4 00 00 00 00","address":{"@type":"PostalAddress","addressLocality":"Bandol"},"checkinTime":"16:00","checkoutTime":"10:00"}
    </script></head><body><h1>x</h1></body></html>`;
  const r = analyzePage(html, { url: 'https://gite.fr/' });
  assert.ok(!keys(r).includes('nap_hours'));
  assert.equal(r.scores.presence, 100);
});
t('C19 · lodging SANS checkin : finding typé arrivée/départ, pas openingHours', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, url: 'https://lemasdesbouteillans.com/' });
  const f = r.findings.find((x) => x.key === 'nap_hours');
  assert.equal(f.entity, 'lodging');
  assert.ok(f.title.includes('arrivée'), 'le titre parle d\'arrivée/départ');
  assert.ok(f.detail.includes('checkinTime'));
});

// ── C20 : sitemap par contenu ─────────────────────────────────────────────
t('C20 · sitemapLooksValid : urlset/sitemapindex oui, HTML d\'erreur non', () => {
  assert.ok(sitemapLooksValid('<?xml version="1.0"?><urlset xmlns="…"><url><loc>https://x.fr</loc></url></urlset>'));
  assert.ok(sitemapLooksValid('<sitemapindex><sitemap><loc>https://x.fr/p.xml</loc></sitemap></sitemapindex>'));
  assert.ok(!sitemapLooksValid('<!doctype html><html><body>404 Not Found</body></html>'));
  assert.ok(!sitemapLooksValid(''));
  assert.ok(!sitemapLooksValid(null));
});

// ── C21 : pré-remplissage GEO depuis le JSON-LD ──────────────────────────
t('C21 · mas : ville et activité extraites du balisage', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, url: 'https://lemasdesbouteillans.com/' });
  assert.equal(r.geoHints.city, 'La Cadière-d\'Azur');
  assert.equal(r.geoHints.activity, 'hébergement');
});
t('C21 · wordpress-org : aucun hint inventé (Organization sans adresse)', () => {
  const r = analyzePage(load('wordpress-org'), { sitemap: true, url: 'https://wordpress.org/' });
  assert.equal(r.geoHints.city, '');
  assert.equal(r.geoHints.activity, '');
});

// ═══ S11 — agrégation multi-pages (partagée express/crawl) ═══════════════
import { aggregatePages, SITE_LEVEL_KEYS } from '../src/lib/audit-page.js';

t('S11 · aggregatePages : moyenne des axes, findings tagués, site-level dédupliqués', () => {
  const pages = [
    { path: '/', scores: { seo: 100, securite: 100, accessibilite: 100, presence: 85 },
      findings: [{ axis: 'presence', sev: 'medium', key: 'nap_hours', title: 'h', detail: 'd' },
                 { axis: 'seo', sev: 'low', key: 'sitemap', title: 's', detail: 'd' }],
      indeterminate: [], notApplicable: ['sec_CSP'], truncated: false, canonicalHrefHost: 'www.exemple.fr' },
    { path: '/a', scores: { seo: 90, securite: 100, accessibilite: 100, presence: 85 },
      findings: [{ axis: 'presence', sev: 'medium', key: 'nap_hours', title: 'h', detail: 'd' }],
      indeterminate: ['img_alt'], notApplicable: ['sec_CSP'], truncated: true, canonicalHrefHost: 'www.exemple.fr' },
  ];
  const agg = aggregatePages(pages);
  assert.equal(agg.scores.seo, 95);
  const hours = agg.findings.find((f) => f.key === 'nap_hours');
  assert.deepEqual(hours.pages, ['/', '/a']);                    // page-level : tagué
  const sm = agg.findings.find((f) => f.key === 'sitemap');
  assert.equal(sm.pages, null);                                  // site-level : dédupliqué, pas de tag
  assert.deepEqual(agg.indeterminate, ['img_alt']);
  assert.deepEqual(agg.notApplicable, ['sec_CSP']);
  assert.equal(agg.truncated, true);
  assert.ok(!agg.findings.some((f) => f.key === 'canonical_inconsistent'), 'hôtes canoniques homogènes');
});
t('S11 · aggregatePages : hôtes canoniques mélangés → canonical_inconsistent', () => {
  const mk = (path, host) => ({ path, scores: { seo: 100 }, findings: [], indeterminate: [], notApplicable: [], truncated: false, canonicalHrefHost: host });
  const agg = aggregatePages([mk('/', 'www.exemple.fr'), mk('/a', 'exemple.fr')]);
  const f = agg.findings.find((x) => x.key === 'canonical_inconsistent');
  assert.ok(f && f.sev === 'medium');
  assert.ok(SITE_LEVEL_KEYS.has('canonical_inconsistent'));
});

// ═══ S12.1 — gain RÉEL par finding (fin des +5/+3/+1 inventés) ═══════════
import { attachGains } from '../src/lib/audit-page.js';

t('S12 · finding informatif (staging) : gain 0 — l\'ancien front promettait +5', () => {
  const f = [{ key: 'jsonld_url_mismatch', sev: 'high' }, { key: 'canonical_mismatch', sev: 'high' }, { key: 'title_long', sev: 'low' }];
  attachGains(f, { scores: { seo: 90, securite: 100, accessibilite: 100, presence: 85, performance: 80, disponibilite: 100 }, pageCount: 5, notApplicable: [] });
  for (const x of f) assert.equal(x.gain, 0, x.key);
});
t('S12 · gain = delta exact : nap_hours sur 5/5 pages d\'un site 6 axes', () => {
  const f = [{ key: 'nap_hours', sev: 'medium', pages: ['/', '/a', '/b', '/c', '/d'] }];
  const scores = { seo: 99, securite: 100, accessibilite: 100, presence: 85, performance: 80, disponibilite: 100 };
  attachGains(f, { scores, pageCount: 5, notApplicable: [] });
  // +15 pts d'axe présence sur toutes les pages × poids 0,15 = +2,25 → 2,3
  assert.equal(f[0].gain, 2.3);
});
t('S12 · gain proportionnel aux pages touchées + borné à 100 d\'axe', () => {
  const f = [{ key: 'meta_length', sev: 'low', pages: ['/a'] }];                   // 1 page sur 4
  attachGains(f, { scores: { seo: 98, securite: 100, accessibilite: 100, presence: 100, performance: 100, disponibilite: 100 }, pageCount: 4, notApplicable: [] });
  // 7 pts × 1/4 = 1,75 d'axe, mais l'axe est à 98 → borné à +2 d'axe → min(1.75, 2) = 1,75 × 0,25 = 0,4
  assert.equal(f[0].gain, 0.4);
  const f2 = [{ key: 'h1', sev: 'medium', pages: ['/a'] }];                        // 15 × 1/4 = 3,75 > borne 2
  attachGains(f2, { scores: { seo: 98, securite: 100, accessibilite: 100, presence: 100, performance: 100, disponibilite: 100 }, pageCount: 4, notApplicable: [] });
  assert.equal(f2[0].gain, 0.5);                                                   // borné : 2 × 0,25
});
t('S12 · sécurité renormalisée (Wix) : un en-tête vaut 50 pts d\'axe, pas 20', () => {
  const f = [{ key: 'sec_HSTS', sev: 'medium' }];                                   // site-level (pas de pages)
  attachGains(f, { scores: { seo: 100, securite: 50, accessibilite: 100, presence: 100, performance: 100, disponibilite: 100 }, pageCount: 5, notApplicable: ['sec_CSP', 'sec_X-Frame-Options', 'sec_Referrer-Policy'] });
  // 100/(5-3) = 50 pts d'axe × 0,15 = 7,5
  assert.equal(f[0].gain, 7.5);
});
t('S12 · perf et img_alt : gain « variable », jamais un chiffre promis', () => {
  const f = [{ key: 'perf_weight', sev: 'low' }, { key: 'img_alt', sev: 'medium' }];
  attachGains(f, { scores: { seo: 100, securite: 100, accessibilite: 90, presence: 100, performance: 60, disponibilite: 100 }, pageCount: 5, notApplicable: [] });
  assert.equal(f[0].gain, null); assert.equal(f[1].gain, null);
});
t('S12 · axe n/a : aucune promesse dessus, renormalisation du reste', () => {
  const f = [{ key: 'nap_phone', sev: 'low', pages: ['/'] }];
  attachGains(f, { scores: { seo: 100, securite: 100, accessibilite: 100, presence: 70, performance: null, disponibilite: 100 }, pageCount: 1, notApplicable: [] });
  // 30 pts × 0,15 / wsum 0,80 = 5,625 → 5,6
  assert.equal(f[0].gain, 5.6);
});

// ═══ S13 — les attaques du réquisitoire deviennent des tests permanents ══
// (règle : chaque attaque qui porte devient une fixture)

t('S13 · ATTAQUE 1 rejouée — SPA : indéterminé, pas dix faux findings ni 40/100', () => {
  const spa = '<html lang="fr"><head><title>Boutique Martin — artisan depuis 1950</title><meta name="description" content="Boutique artisanale à Lyon, créations uniques faites main depuis trois générations."></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
  const r = analyzePage(spa, { sitemap: true, url: 'https://boutique-martin.fr/' });
  assert.equal(r.spaShell, true);
  assert.deepEqual(keys(r), []);                       // l'ancien moteur : 10 findings
  assert.ok(r.indeterminate.includes('h1') && r.indeterminate.includes('nap_phone'));
  assert.notEqual(r.scores.presence, 0);               // null (n/a), plus jamais 0
});
t('S13 · ATTAQUE 2 rejouée — H1 commenté : plus de faux « 2 balises »', () => {
  const html = '<html lang="fr"><head><title>Titre correct de page</title></head><body><h1>Vrai titre</h1><!-- ancien : <h1>Ancien titre</h1> --><p>' + 'contenu réel de la page. '.repeat(20) + '</p></body></html>';
  const r = analyzePage(html, { url: 'https://x.fr/' });
  assert.ok(!keys(r).includes('h1'), 'le H1 commenté ne compte plus');
});
t('S13 · corollaire — une méta UNIQUEMENT en commentaire ne crédite plus', () => {
  const html = '<html lang="fr"><head><title>Titre correct de page</title><!-- <meta name="description" content="une description commentée assez longue pour passer le seuil de longueur"> --></head><body><h1>t</h1><p>' + 'x '.repeat(200) + '</p></body></html>';
  const r = analyzePage(html, { url: 'https://x.fr/' });
  assert.ok(keys(r).includes('meta_missing'));
});
t('S13 · ATTAQUE 3 rejouée — friterie de Namur : téléphone et adresse reconnus', () => {
  const be = '<html lang="fr"><head><title>Friterie Chez Louise à Namur</title></head><body><h1>Chez Louise</h1><p>Tél : +32 81 22 33 44 · Rue de Fer 12, 5000 Namur. ' + 'Bienvenue chez nous. '.repeat(15) + '</p></body></html>';
  const r = analyzePage(be, { url: 'https://chezlouise.be/' });
  const k = keys(r);
  assert.ok(!k.includes('nap_phone'), '+32 reconnu');
  assert.ok(!k.includes('nap_address'), 'CP belge à 4 chiffres reconnu');
  assert.equal(r.scores.presence, 65);                 // 30+35 ; fiche+horaires réellement absents
});
t('S13 · un <h1 dans une chaîne de script ne compte pas', () => {
  const html = '<html lang="fr"><head><title>Titre correct de page</title></head><body><h1>t</h1><script>var tpl = "<h1>gabarit</h1>";</script><p>' + 'x '.repeat(200) + '</p></body></html>';
  const r = analyzePage(html, { url: 'https://x.fr/' });
  assert.ok(!keys(r).includes('h1'));
});
t('S13 · MANAGED_PLATFORMS : squarespace et shopify scopés comme wix', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, headers: { 'strict-transport-security': 'x', 'x-content-type-options': 'nosniff' }, platform: 'shopify', url: 'https://lemasdesbouteillans.com/' });
  assert.equal(r.scores.securite, 100);
});
t('S13 · non-régression : les fixtures Wix réelles sont INSENSIBLES au strip', () => {
  const r = analyzePage(load('wix-studio-mas-home'), { sitemap: true, url: 'https://lemasdesbouteillans.com/' });
  assert.deepEqual(keys(r), ['jsonld_entity_split', 'jsonld_url_mismatch', 'nap_hours']);   // S10 + la scission d'entités S16/C24
  assert.equal(r.scores.seo, 100);
  assert.equal(r.spaShell, false);                     // 3,3 Mo de contenu ≠ coquille
});

// ═══ S14 — GEO : sources citées + présence ═══════════════════════════════
import { topCitedDomains, presenceMatch } from '../src/lib/geo-analyze.js';

t('S14 · topCitedDomains : agrégation par fréquence, titre-domaine (Gemini) et URL (Perplexity)', () => {
  // Reproduction du cas réel : l\'office de tourisme cité 3×, agrégateurs 1×.
  const results = [
    { prompt: 'q1', engines: [{ sources: [{ title: 'tourisme-lacadieredazur', uri: 'https://vertexaisearch.cloud.google.com/redirect/abc' }, { title: '', uri: 'https://www.logic-immo.com/annonce' }] }] },
    { prompt: 'q2', engines: [{ sources: [{ title: 'tourisme-lacadieredazur.fr', uri: 'https://vertexaisearch.cloud.google.com/redirect/def' }] }] },
    { prompt: 'q3', engines: [{ sources: [{ title: 'tourisme-lacadieredazur.fr', uri: 'https://vertexaisearch.cloud.google.com/redirect/ghi' }, { title: '', uri: 'https://www.seloger.com/x' }] }] },
  ];
  const top = topCitedDomains(results, 4);
  assert.equal(top[0].domain, 'tourisme-lacadieredazur.fr');   // le titre-domaine gagne sur l\'URI de redirection
  assert.equal(top[0].citations, 2);                            // q2+q3 (q1 : titre sans TLD → URI redirect google)
  assert.ok(top.some((s) => s.domain === 'logic-immo.com'));
  assert.ok(top.some((s) => s.domain === 'seloger.com'));
});
t('S14 · presenceMatch : nom accentué, casse, domaine — et pas de faux positif', () => {
  const page = '<html><body><h2>Locations saisonnières</h2><ul><li>LE MAS DES BOUTEILLANS — gîtes avec piscine</li><li>Maison Zoé</li></ul></body></html>';
  assert.equal(presenceMatch(page, 'Le Mas des Bouteillans', 'lemasdesbouteillans.com'), true);   // nom, casse ignorée
  assert.equal(presenceMatch(page, 'Château Inexistant', 'chateau-inexistant.fr'), false);
  assert.equal(presenceMatch('<a href="https://www.lemasdesbouteillans.com">ici</a>', 'Autre Nom', 'lemasdesbouteillans.com'), true);  // lien vers le domaine suffit
  assert.equal(presenceMatch('<script>var x="le mas des bouteillans"</script>', 'Le Mas des Bouteillans', 'autre.fr'), false);  // les scripts ne comptent pas
  assert.equal(presenceMatch('page qui parle de mas et de bouteilles', 'Mas', 'x.fr'), false);    // nom trop court → jamais de conclusion
});

// ═══ S14.2 — apostrophes et entités (bug FRANCOPHONE, données réelles) ═══
t('S14.2 · ATTAQUE 4 — apostrophe dans la méta : longueur RÉELLE', () => {
  // Cas réel /l-arbousier : 149 c. lus « L » (1 c.) par l'ancien motif
  // content=["\']([^"\']*)["\'] → finding « trop courte » FAUX.
  const d = "L'Arbousier : appartement climatisé 50 m², 5 personnes, jardin clos et terrasse couverte. Piscine partagée, Wi-Fi. La Cadière-d'Azur, près de Bandol.";
  const html = `<html lang="fr"><head><title>L'Arbousier – gîte 5 pers. avec jardin</title><meta name="description" content="${d}"></head><body><h1>t</h1></body></html>`;
  const r = analyzePage(html, { url: 'https://x.fr/' });
  assert.ok(!keys(r).includes('meta_length'), `149 c. ne doit pas être « trop courte » (findings: ${keys(r).join(',')})`);
});
t('S14.2 · entités HTML : &#39; et &amp; comptent 1 caractère, pas 5', () => {
  const html = `<html lang="fr"><head><title>Contact &amp; réservation – Le Mas des Bouteillans</title><meta name="description" content="Contactez-nous à La Cadière-d&#39;Azur pour réserver votre gîte : téléphone, e-mail ou formulaire dédié."></head><body><h1>t</h1></body></html>`;
  const r = analyzePage(html, { url: 'https://x.fr/' });
  assert.ok(!keys(r).includes('meta_length'));
  assert.ok(!keys(r).includes('title_long'));
});
t('S14.2 · attribut en guillemets simples contenant une apostrophe échappée', () => {
  const html = `<html lang="fr"><head><title>Titre correct de la page</title><meta name='description' content='Une description en guillemets simples, assez longue pour passer le seuil des cinquante caracteres.'></head><body><h1>t</h1></body></html>`;
  const r = analyzePage(html, { url: 'https://x.fr/' });
  assert.ok(!keys(r).includes('meta_missing'));
  assert.ok(!keys(r).includes('meta_length'));
});
t('S14.2 · canonical avec apostrophe dans l\'URL voisine : href intact', () => {
  const html = `<html lang="fr"><head><title>Titre correct de la page</title><link rel="canonical" href="https://exemple.fr/l-hotel-d-azur"></head><body><h1>t</h1></body></html>`;
  const r = analyzePage(html, { url: 'https://exemple.fr/l-hotel-d-azur' });
  assert.equal(r.canonicalHrefHost, 'exemple.fr');
  assert.ok(!keys(r).includes('canonical'));
  assert.ok(!keys(r).includes('canonical_mismatch'));
});

// ═══ S16 — NAP sur le TEXTE : les erreurs du dogfooding 2026-08-04 ═══════
// Douze sites WordPress/Squarespace RÉELS passés au moteur hors prod (les
// deux plateformes n'avaient jamais été éprouvées en vrai). Quatre erreurs,
// deux dans chaque sens — zéro trouvée par le harnais. Les extraits ci-dessous
// sont VERBATIM : le texte réellement servi par ces pages, vérifié à la main.
const pad = ' Bienvenue sur notre site. '.repeat(15);

t('S16 · FAUX NÉGATIF 1 — téléphone français au format national (lacadieredazur.fr)', () => {
  // Ni lien tel:, ni +33 : « 04 94 98 25 25 » écrit en toutes lettres. Le
  // moteur annonçait « Téléphone non détecté » et retirait 30 pts de présence.
  const html = `<html lang="fr"><head><title>Mairie de La Cadiere d Azur</title></head><body><h1>Mairie</h1>
    <footer><p>11 rue Gabriel PERI, 83740 La Cadière d’Azur</p><p>Téléphone <span>04 94 98 25 25</span></p></footer><p>${pad}</p></body></html>`;
  const r = analyzePage(html, { url: 'https://lacadieredazur.fr/' });
  assert.ok(!keys(r).includes('nap_phone'), 'format national reconnu');
  assert.ok(!keys(r).includes('nap_address'));
  assert.equal(r.scores.presence, 65);            // 30+35 ; fiche et horaires réellement absents
});

t('S16 · FAUX NÉGATIF 2 — « place » et adresse coupée par des balises (tourisme-lacadieredazur.fr)', () => {
  // « place » manquait à la liste des voies, et le motif exigeait la voie ET
  // le code postal dans le MÊME nœud de texte — un pied de page les sépare.
  const html = `<html lang="fr"><head><title>Bureau du Tourisme de La Cadiere</title></head><body><h1>Tourisme</h1>
    <div><span>Maison des Gardes</span><br><span>11 place Charles de Gaulle</span><br><span>83740 La Cadière d'Azur</span>
    <a href="tel:+33494901256">04.94.90.12.56</a></div><p>${pad}</p></body></html>`;
  const r = analyzePage(html, { url: 'https://tourisme-lacadieredazur.fr/' });
  assert.ok(!keys(r).includes('nap_address'), 'voie et code postal dans deux nœuds voisins');
  assert.equal(r.scores.presence, 65);
});

t('S16 · FAUX POSITIF 1 — une coordonnée de tracé SVG n\'est pas un téléphone (bandol.fr)', () => {
  // « 0033 85.3467 » vit dans un attribut d= : hors du texte, donc hors NAP.
  const html = `<html lang="fr"><head><title>Ville de Bandol site officiel</title></head><body><h1>Bandol</h1>
    <svg viewBox="0 0 200 200"><path d="M 0033 85.3467 L 0032 17.2665 Z"/></svg><p>${pad}</p></body></html>`;
  const r = analyzePage(html, { url: 'https://www.bandol.fr/' });
  assert.ok(keys(r).includes('nap_phone'), 'aucun téléphone sur cette page — le tracé ne compte pas');
});

t('S16 · FAUX POSITIF 2 — « chemin » dans un nom de fichier n\'est pas une voie (ollioules.fr)', () => {
  const html = `<html lang="fr"><head><title>Ville d Ollioules site officiel</title></head><body><h1>Ollioules</h1>
    <img src="/wp-content/uploads/chemin-crea-282-29-960w.jpg" alt="crea" class="image wp-image-27759"><p>${pad}</p></body></html>`;
  const r = analyzePage(html, { url: 'https://www.ollioules.fr/' });
  assert.ok(keys(r).includes('nap_address'), 'un nom de fichier n\'est pas une adresse');
});

t('S16 · la VRAIE adresse d\'Ollioules est reconnue (« 2 place Marius Trotobas »)', () => {
  const html = `<html lang="fr"><head><title>Ville d Ollioules site officiel</title></head><body><h1>Ollioules</h1>
    <p>Mairie d'Ollioules 2 place Marius Trotobas 83190 OLLIOULES <a href="tel:+33494304141">+33 (0)4 94 30 41 41</a></p><p>${pad}</p></body></html>`;
  const r = analyzePage(html, { url: 'https://www.ollioules.fr/' });
  assert.ok(!keys(r).includes('nap_address'));
  assert.ok(!keys(r).includes('nap_phone'));
});

t('S16 · CONTRÔLE NÉGATIF — homographes anglais : « takes place », ZIP américain', () => {
  // landinibrothers.com (Squarespace, Alexandria VA) : « … VA 22314 Hours Mon ».
  // Sans voie française, et sans numéro devant « place », rien n'est crédité.
  const en = `<html lang="en"><head><title>Landini Brothers Restaurant</title></head><body><h1>Landini</h1>
    <p>The tasting takes place in our cellar. 115 King St, Alexandria, VA 22314 Hours Mon - Thurs</p><p>${pad}</p></body></html>`;
  const r = analyzePage(en, { url: 'https://www.landinibrothers.com/' });
  assert.ok(keys(r).includes('nap_address'), 'aucune adresse française ici');
  assert.equal(r.scores.presence, 0);
});

t('S16 · non-régression : wordpress.org reste à ZÉRO crédit NAP après passage au texte', () => {
  const r = analyzePage(load('wordpress-org'), { sitemap: true, url: 'https://wordpress.org/' });
  assert.deepEqual(keys(r), ['nap_address', 'nap_hours', 'nap_localbiz', 'nap_phone']);
  assert.equal(r.scores.presence, 0);
});

t('S16 · phoneInText / addressInText : la table de vérité, cas par cas', () => {
  for (const [s, exp] of [['Tel : 04 94 98 25 25', true], ['07.70.16.39.89', true], ['+33 (0)4 94 30 41 41', true],
    ['+33494901256', true], ['+32 81 22 33 44', true], ['+41 22 123 45 67', true], ['+352 26 12 34 56', true],
    ['M 0033 85.3467 L 0032 17.2665', false], ['Ref 0123456789012', false], ['en 2024 05 06 07 08', false]]) {
    assert.equal(phoneInText(s), exp, `phone: ${s}`);
  }
  for (const [s, exp] of [['40 chemin des Platrieres 83330 LE BEAUSSET', true], ['Rue de Fer 12, 5000 Namur', true],
    ['10 cours Lafayette 83000 Toulon', true], ['nos cours de yoga en 2024 Toulon 83000 Var', false],
    ['The event takes place at our venue. Order 12345 Shipped today.', false]]) {
    assert.equal(addressInText(s), exp, `address: ${s}`);
  }
});

// ═══ S16/C24 — deux fiches pour un seul établissement ════════════════════
// La promesse faite au client du Mas et jamais tenue : le LocalBusiness que
// Wix génère depuis « Infos de l'entreprise » n'a pas d'@id, il reste étranger
// au LodgingBusiness du bloc maison. Vérité terrain relevée à la main sur la
// page servie le 2026-08-04 : 3 nœuds, deux fiches du même établissement
// (mêmes nom, téléphone et rue), aucun lien entre elles.

t('S16/C24 · le cas du Mas : LodgingBusiness + LocalBusiness Wix, rien ne les relie', () => {
  const s = entitySplit([
    { '@type': 'LodgingBusiness', '@id': 'https://www.lemasdesbouteillans.com/#business', name: 'Le Mas des Bouteillans', telephone: '+33680637511' },
    { '@type': 'LocalBusiness', name: 'Le Mas des Bouteillans', telephone: '+33 6 80 63 75 11' },
    { '@type': 'WebSite', name: 'Le Mas des Bouteillans' },
  ]);
  assert.ok(s, 'la scission doit être détectée');
  assert.equal(s.a, 'LodgingBusiness');
  assert.equal(s.b, 'LocalBusiness');
  assert.equal(s.missingId, true);
});

t('S16/C24 · @id commun = fusionnées : plus aucun finding', () => {
  const id = 'https://exemple.fr/#business';
  assert.equal(entitySplit([
    { '@type': 'LodgingBusiness', '@id': id, name: 'Le Mas' },
    { '@type': 'LocalBusiness', '@id': id, name: 'Le Mas' },
  ]), null);
});

t('S16/C24 · une fiche qui CITE l\'@id de l\'autre est reliée (parentOrganization)', () => {
  assert.equal(entitySplit([
    { '@type': 'Organization', '@id': 'https://exemple.fr/#org', name: 'Groupe Durand' },
    { '@type': 'Restaurant', '@id': 'https://exemple.fr/#resto', name: 'Groupe Durand', parentOrganization: { '@id': 'https://exemple.fr/#org' } },
  ]), null);
});

t('S16/C24 · téléphone identique malgré la mise en forme = même entité', () => {
  const s = entitySplit([
    { '@type': 'Restaurant', name: 'Chez Louise', telephone: '+33 4 94 90 12 56' },
    { '@type': 'LocalBusiness', name: 'Restaurant Chez Louise Namur', telephone: '0033494901256' },
  ]);
  assert.ok(s, 'noms différents mais même numéro');
});

t('S16/C24 · CONTRÔLE NÉGATIF — un annuaire de commerces n\'est PAS une scission', () => {
  assert.equal(entitySplit([
    { '@type': 'Restaurant', name: 'La Bonne Fourchette', telephone: '+33 4 94 11 11 11', address: { streetAddress: '1 rue A' } },
    { '@type': 'Bakery', name: 'Le Fournil', telephone: '+33 4 94 22 22 22', address: { streetAddress: '2 rue B' } },
    { '@type': 'HairSalon', name: 'Coiffure Sud', telephone: '+33 4 94 33 33 33', address: { streetAddress: '3 rue C' } },
  ]), null);
});

t('S16/C24 · CONTRÔLE NÉGATIF — les fixtures saines restent muettes', () => {
  // pks : ProfessionalService seul (WebSite/SoftwareApplication/FAQPage ne
  // sont pas des fiches d'établissement). wordpress.org : Organization seule.
  for (const f of ['static-vercel-pks', 'wordpress-org']) {
    const r = analyzePage(load(f), { sitemap: true, url: 'https://x.fr/' });
    assert.ok(!keys(r).includes('jsonld_entity_split'), f);
  }
  // Les pages gîtes du Mas : un seul LodgingBusiness — Wix ne génère sa fiche
  // que sur la page d'accueil.
  const g = analyzePage(load('wix-studio-mas-arbousier'), { skipSite: true, sitemap: true, url: 'https://lemasdesbouteillans.com/arbousier' });
  assert.ok(!keys(g).includes('jsonld_entity_split'));
});

t('S16/C24 · informatif : le finding ne promet aucun point de score', () => {
  const f = [{ key: 'jsonld_entity_split', sev: 'medium', pages: ['/'] }];
  attachGains(f, { scores: { seo: 90, securite: 100, accessibilite: 100, presence: 85, performance: 80, disponibilite: 100 }, pageCount: 5, notApplicable: [] });
  assert.equal(f[0].gain, 0);   // hors barème, comme tous les contrôles S10+
});

// ═══ S16.2 — détection de plateforme : le tirage au sort de Squarespace ══
// Trouvé pendant le balayage adverse de C24 : districtcafe.ca ressortait
// tantôt « squarespace », tantôt « wix ». La sonde cherchait « wix » dans la
// valeur de TOUS les en-têtes ; Squarespace renvoie `x-contextid` et un
// cookie `crumb`, deux jetons base64 tirés au hasard à CHAQUE requête.
// Signatures ci-dessous relevées à la main sur les sites réels le 2026-08-04.
import { detectPlatform } from '../src/lib/audit-page.js';

t('S16.2 · ATTAQUE — un jeton aléatoire contenant « wix » ne fait pas un site Wix', () => {
  const sqsp = '<html><head><link href="//assets.squarespace.com/universal/x.css"></head><body>a</body></html>';
  // Le jeton EXACT qui a fait mentir la sonde le 2026-08-04.
  assert.equal(detectPlatform(sqsp, { server: 'Squarespace', 'x-contextid': 'gJtnwixz/A0cCgwUT' }), 'squarespace');
  // Et le cas générique : un site sur-mesure dont l'ETag contient les 3 lettres.
  assert.equal(detectPlatform('<html><body>Bonjour</body></html>', { server: 'nginx', etag: 'W/"b3aWIXc88ea55"' }), 'custom');
});

t('S16.2 · ATTAQUE — un simple LIEN vers wix.com ne fait pas un site Wix', () => {
  // Une agence web qui compare les plateformes, un portfolio « fait sous Wix »…
  const wp = '<html><head><meta name="generator" content="WordPress 6.5"></head><body><p>Nous migrons votre site depuis <a href="https://fr.wix.com/">wix.com</a> vers WordPress.</p></body></html>';
  assert.equal(detectPlatform(wp, { server: 'Apache' }), 'wordpress');
});

t('S16.2 · les signatures réelles des quatre plateformes', () => {
  assert.equal(detectPlatform('<html><body>x</body></html>', { server: 'Pepyaka', 'x-wix-request-id': '1785842738.8004' }), 'wix');
  assert.equal(detectPlatform('<html><head><meta name="generator" content="Wix.com Website Builder"/></head></html>', {}), 'wix');
  assert.equal(detectPlatform('<html><img src="https://static.wixstatic.com/a.jpg"></html>', {}), 'wix');
  assert.equal(detectPlatform('<html><script src="//static.parastorage.com/x.js"></script></html>', {}), 'wix');
  assert.equal(detectPlatform('<html><body>x</body></html>', { server: 'Squarespace' }), 'squarespace');
  assert.equal(detectPlatform('<html><meta property="og:image" content="http://static1.squarespace.com/x"></html>', {}), 'squarespace');
  assert.equal(detectPlatform('<html><link href="/wp-content/themes/a/style.css"></html>', { server: 'Apache' }), 'wordpress');
  assert.equal(detectPlatform('<html><script src="https://cdn.shopify.com/x.js"></script></html>', { server: 'cloudflare' }), 'shopify');
  assert.equal(detectPlatform('<html><body>Un site écrit à la main</body></html>', { server: 'nginx' }), 'custom');
});

t('S16.2 · les fixtures réelles sont reconnues par leur signature HTML seule', () => {
  for (const f of ['wix-studio-mas-home', 'wix-studio-mas-arbousier'])
    assert.equal(detectPlatform(load(f), {}), 'wix', f);
  assert.equal(detectPlatform(load('wordpress-org'), {}), 'wordpress');
  assert.equal(detectPlatform(load('static-vercel-pks'), {}), 'custom');
});

t('S16.2 · une plateforme managée mal détectée gonflait l\'axe sécurité', () => {
  // Le vrai coût du bug : trois en-têtes exemptés pour un site qui n'y a pas droit.
  const html = load('wordpress-org');
  const headers = { 'strict-transport-security': 'max-age=1', 'x-content-type-options': 'nosniff' };
  const vrai = analyzePage(html, { headers, sitemap: true, url: 'https://wordpress.org/', platform: detectPlatform(html, {}) });
  const faux = analyzePage(html, { headers, sitemap: true, url: 'https://wordpress.org/', platform: 'wix' });
  assert.equal(vrai.scores.securite, 40);    // 2 en-têtes sur 5 — la vérité
  assert.equal(faux.scores.securite, 100);   // 2 sur 2, les 3 autres « non applicables » — le mensonge
});

// ═══ S16.3 — ce que les DEUX PREMIERS RAPPORTS RÉELS ont montré ══════════
// Stéphane a mis sous surveillance un WordPress (tourisme-lacadieredazur.fr,
// 67/100, 11 actions) et un Squarespace (districtcafe.ca, 81/100, 5 actions)
// puis exporté les PDF. Lus page à page : quatre défauts, dont un sérieux.

t('S16.3 · le correctif ne doit plus FABRIQUER le défaut que C24 signale', () => {
  // Le plus grave. La fiche LocalBusiness proposée n'avait pas d'@id : collée
  // sur un site qui a déjà une Organization (c'est le cas des deux sites
  // testés), elle crée une TROISIÈME fiche non reliée — donc le finding
  // jsonld_entity_split au prochain audit. L'outil fabriquait le défaut.
  const avecId = [
    { '@type': 'Organization', '@id': 'https://exemple.fr/#business', name: 'Maison Durand' },
    { '@type': 'LocalBusiness', '@id': 'https://exemple.fr/#business', name: 'Maison Durand' },
  ];
  assert.equal(entitySplit(avecId), null, 'l\'@id commun du snippet fusionne les fiches');
  const sansId = [
    { '@type': 'Organization', '@id': 'https://exemple.fr/#business', name: 'Maison Durand' },
    { '@type': 'LocalBusiness', name: 'Maison Durand' },
  ];
  assert.ok(entitySplit(sansId), 'sans @id, le collage aurait créé la scission');
});

t('S16.3 · le même bloc de code ne s\'imprime qu\'UNE fois (rapport WordPress réel)', () => {
  // Cas exact du PDF du 04/08 : jsonld, nap_localbiz et nap_hours partagent la
  // fiche LocalBusiness — quinze lignes imprimées TROIS fois de suite.
  const LD = '<script type="application/ld+json">{ … }</script>';
  const findings = [
    { key: 'nap_localbiz', sev: 'medium', title: 'Fiche établissement (LocalBusiness) absente', fix: { steps: ['a'], codeLabel: 'Fiche', code: LD } },
    { key: 'nap_hours', sev: 'medium', title: 'Horaires d\'ouverture non déclarés', fix: { steps: ['a'], codeLabel: 'Fiche', code: LD } },
    { key: 'jsonld', sev: 'medium', title: 'Données structurées absentes', fix: { steps: ['a'], codeLabel: 'Fiche', code: LD } },
    { key: 'meta_missing', sev: 'high', title: 'Méta description absente', fix: { steps: ['b'], codeLabel: 'Méta', code: '<meta …>' } },
  ];
  dedupeFixCode(findings);
  assert.equal(findings.filter((f) => f.fix.code).length, 2, 'un bloc LocalBusiness + un bloc méta');
  assert.ok(findings[0].fix.code, 'le premier du groupe garde le bloc');
  assert.equal(findings[1].fix.code, null);
  assert.ok(findings[1].fix.steps.slice(-1)[0].includes('Fiche établissement (LocalBusiness) absente'));
  assert.equal(findings[3].fix.code, '<meta …>', 'un bloc unique n\'est jamais touché');
});

t('S16.4 · dédup : plus de « collez le code ci-dessous » quand il n\'y a plus de code', () => {
  // 2ᵉ export du rapport WordPress (04/08) : la carte disait « 3. Collez le
  // code ci-dessous » PUIS « 4. Le bloc plus haut couvre aussi ce point ».
  // Deux consignes contradictoires, et un « ci-dessous » qui ne désigne rien.
  const C = '<script>…</script>';
  const findings = [
    { key: 'nap_localbiz', sev: 'medium', title: 'Fiche établissement absente', fix: { steps: ['Installez WPCode.', 'Collez le code ci-dessous, enregistrez.'], code: C } },
    { key: 'nap_address', sev: 'low', title: 'Adresse non structurée', fix: { steps: ['Affichez d\'abord l\'adresse complète sur la page.', 'Installez WPCode.', 'Collez le code ci-dessous, enregistrez.'], code: C } },
  ];
  dedupeFixCode(findings);
  const s = findings[1].fix.steps;
  assert.ok(!s.some((x) => /ci-dessous|Collez|WPCode/i.test(x)), `étapes de collage résiduelles : ${JSON.stringify(s)}`);
  assert.equal(s[0], 'Affichez d\'abord l\'adresse complète sur la page.', 'l\'étape qui vaut SANS code est gardée');
  assert.ok(s[1].includes('rien à coller ici'));
  assert.equal(s.length, 2);
});

t('S16.3 · dédup : le bloc reste sur le finding le PLUS prioritaire du groupe', () => {
  const C = 'X';
  const findings = [
    { key: 'a', sev: 'low', title: 'Petit défaut', fix: { steps: [], code: C } },
    { key: 'b', sev: 'high', title: 'Gros défaut', fix: { steps: [], code: C } },
  ];
  dedupeFixCode(findings);
  assert.equal(findings[0].fix.code, null, 'le low renvoie…');
  assert.equal(findings[1].fix.code, C, '…au high, qui est affiché en premier');
  assert.ok(findings[0].fix.steps.slice(-1)[0].includes('Gros défaut'));
});

t('S16.3 · nom d\'entité absent : pas de « votre établissement » entre guillemets', () => {
  // districtcafe.ca : les deux fiches se rapprochent par le TÉLÉPHONE, pas par
  // le nom — le gabarit imprimait des guillemets vides, lus comme un oubli.
  const html = `<html lang="fr"><head><title>Le cafe du quartier a Ottawa</title></head><body><h1>t</h1>
    <script type="application/ld+json">{"@type":"Organization","@id":"https://x.fr/#o","telephone":"+33 4 94 11 22 33"}</script>
    <script type="application/ld+json">{"@type":"LocalBusiness","telephone":"+33494112233"}</script>
    <p>${' du texte. '.repeat(40)}</p></body></html>`;
  const f = analyzePage(html, { url: 'https://x.fr/' }).findings.find((x) => x.key === 'jsonld_entity_split');
  assert.ok(f, 'la scission est bien détectée par le téléphone seul');
  assert.ok(f.detail.startsWith('Votre page décrit votre établissement DEUX fois'), f.detail.slice(0, 80));
  assert.ok(!f.detail.includes('« votre établissement »'));
});

console.log(`\n${n} tests OK — moteur S8→S16 conforme à la vérité terrain des fixtures.`);
