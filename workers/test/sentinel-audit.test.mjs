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
import { analyzePage, extractJsonLd, LOCALBUSINESS_TYPES, globalScore, perfScore, AXIS_WEIGHTS, sitemapLooksValid } from '../src/lib/audit-page.js';

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
  assert.deepEqual(keys(r), ['jsonld_url_mismatch', 'nap_hours']);
  assert.equal(r.scores.seo, 100);                     // S10 = informatif, ne touche pas au barème
  assert.equal(r.scores.accessibilite, 100);
  assert.equal(r.scores.presence, 85);                 // 30+35+20, horaires absents (réel)
  assert.equal(r.scores.securite, null);               // pas d'en-têtes fournis au moteur pur
  assert.deepEqual(r.indeterminate, []);               // document complet : tout est déterminé
});

// ── Les 4 pages gîtes (le cœur du faux négatif : LodgingBusiness SEUL) ───
for (const [page, seoAttendu] of [['arbousier', 93], ['escapades', 100], ['myrtes', 100], ['cypres', 100]]) {
  t(`mas-${page} : LodgingBusiness seul suffit, presence 85, seo ${seoAttendu}`, () => {
    const r = analyzePage(load(`wix-studio-mas-${page}`), { skipSite: true, sitemap: true, url: `https://lemasdesbouteillans.com/${page}` });
    // S11.2 : l'arbousier (méta 1 c.) émet désormais meta_length — le point
    // perdu a sa ligne d'explication (avant : score baissé en silence).
    const attendu = page === 'arbousier' ? ['jsonld_url_mismatch', 'meta_length', 'nap_hours'] : ['jsonld_url_mismatch', 'nap_hours'];
    assert.deepEqual(keys(r), attendu);
    assert.equal(r.scores.seo, seoAttendu);            // arbousier : méta de 1 caractère → 8 pts (défaut réel du site)
    assert.equal(r.scores.presence, 85);
    assert.equal(r.scores.accessibilite, 100);
  });
}

// ── PKS (statique Vercel — le site du dogfooding) ────────────────────────
// Vérité terrain : ProfessionalService + tel + adresse + horaires → presence
// 100. Méta 166 caractères (les entités HTML comptent) → hors plage → seo 93.
t('pks : ProfessionalService reconnu, presence 100, meta 166c → seo 93', () => {
  const r = analyzePage(load('static-vercel-pks'), { sitemap: true, url: 'https://protein-keystone.com/' });
  assert.deepEqual(keys(r), ['meta_length']);          // 166 c. — hors norme d'1 caractère, dit explicitement (S11.2)
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
  assert.deepEqual(keys(r), ['jsonld_url_mismatch']);  // l'ancien moteur émettait 'h1' ici — LE bug
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

console.log(`\n${n} tests OK — moteur S8→S12 conforme à la vérité terrain des fixtures.`);
