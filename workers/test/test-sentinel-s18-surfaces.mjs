/* ═══════════════════════════════════════════════════════════════
   SENTINEL · S18.1 — les surfaces oubliées du premier passage (30/08)

   Retour Stéphane après le déploiement S18 : trois choses restaient à
   traiter — P1 (présence→null expliquée là où on la lit), l'étiquette de
   couverture, hreflang. Le premier passage avait équipé cockpit + PDF
   mais PAS le rapport E-MAIL (souvent le seul document que le webmaster
   lira), l'étiquette du KPI, ni la SÉLECTION des pages à auditer — la
   réciprocité hreflang ne se contrôle qu'entre pages LUES, or « /en »
   n'entrait presque jamais dans l'échantillon de 5.

   Ce banc traverse le VRAI code (imports de routes/sentinel.js, fetch
   mocké pour la découverte) :
     1. _reportEmail : étiquette de couverture (échantillon / complet /
        plafonné), axes « n/a » expliqués (présence retirée P1, perf,
        dispo), pages concernées par finding — en HTML ET en texte ;
        rétro-compat avec un vieil audit sans ces champs.
     2. _discoverPages : les alternates hreflang de la home passent
        devant le round-robin (cas déterministe où /en était exclu sans
        la priorité) ; un hreflang vers un autre domaine est ignoré.

   Usage : node workers/test/test-sentinel-s18-surfaces.mjs · Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */
import { _reportEmail, _discoverPages, handleSiteKindSet } from '../src/routes/sentinel.js';
import { applySiteKind } from '../src/lib/audit-page.js';
import { signJWT } from '../src/lib/jwt.js';

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? String(extra).slice(0, 220) : ''); }
};

// ═══ 1 · Le rapport e-mail porte les honnêtetés S18 ══════════════════════
console.log('\n▶ Rapport e-mail — étiquette de couverture + axes n/a + pages par finding');

const BASE = {
  name: 'Site du livre', url: 'https://mon-livre-exemple.fr', score: 85,
  scores: { disponibilite: null, performance: null, seo: 88, securite: 80, accessibilite: 100, presence: null },
  findings: [
    { axis: 'seo', sev: 'low', key: 'title_long', title: 'Balise title trop longue',
      detail: '73 caractères — visez 50-60. — Constaté sur 1 des 5 pages auditées ; le site en compte 40 : comptez probablement ~8 pages concernées. Le crawl complet donne la liste exacte.',
      pages: ['/chapitres', '/extraits'], fix: { steps: ['Raccourcissez.'] } },
  ],
  date: '2026-08-30', platform: 'custom',
  pages: [{ path: '/' }, { path: '/chapitres' }, { path: '/auteur' }, { path: '/extraits' }, { path: '/contact' }],
  pagesTotal: 40, coverage: 'sample',
  notApplicable: ['nap_phone', 'nap_address', 'nap_localbiz', 'nap_hours'],
};

{
  const { html, text } = _reportEmail(BASE);
  ok(html.includes('échantillon de 5 pages sur 40') && text.includes('échantillon de 5 pages sur 40'),
    'échantillon : « 5 pages sur 40 » dans le HTML ET le texte');
  ok(html.includes('le score reflète cet échantillon'), 'et le rapport dit ce que ça implique pour le score');
  ok(html.includes('/chapitres, /auteur') || html.includes('/, /chapitres'), 'les chemins audités sont listés');
  ok(html.includes('sans établissement recevant du public') && text.includes('sans établissement recevant du public'),
    'P1 : « Présence locale n/a » est EXPLIQUÉ (site déclaré sans établissement)');
  ok(html.includes('mesure de vitesse indisponible'), 'axe Performance n/a expliqué');
  ok(html.includes('historique de surveillance'), 'axe Disponibilité n/a expliqué');
  ok(html.includes('2 pages : /chapitres, /extraits') && text.includes('2 pages : /chapitres, /extraits'),
    'les pages concernées par un finding apparaissent (HTML + texte)');
  ok(html.includes('~8 pages concernées'), 'l\'extrapolation stockée dans le finding traverse jusqu\'à l\'e-mail');
}

{
  const { html } = _reportEmail({ ...BASE, coverage: 'full', pages: Array.from({ length: 25 }, (_, i) => ({ path: `/p${i}` })), pagesTotal: 120 });
  ok(html.includes('25 pages sur 120 détectées (couverture plafonnée par le plan)'),
    'crawl plafonné : jamais annoncé « couverture complète »');
}
{
  const { html } = _reportEmail({ ...BASE, coverage: 'full', pages: Array.from({ length: 12 }, (_, i) => ({ path: `/p${i}` })), pagesTotal: 12 });
  ok(html.includes('couverture complète'), 'crawl réellement complet : le dire aussi');
}
{
  // Un site LOCAL avec présence 0 : pas de « sans établissement » (ce serait faux).
  const { html } = _reportEmail({ ...BASE, scores: { ...BASE.scores, presence: 0 }, notApplicable: [] });
  ok(!html.includes('sans établissement'), 'présence 0 (site local) ≠ présence retirée : pas de fausse explication');
}
{
  // Rétro-compat : un audit d'avant S18 (aucun des nouveaux champs).
  const { html, text } = _reportEmail({ name: 'Vieux', url: 'https://x.fr', score: 70,
    scores: { seo: 70 }, findings: [], date: '2026-06-01', platform: 'wix' });
  ok(html.includes('Score global') && text.includes('Score global'), 'vieil audit sans pages/coverage : rien ne casse');
}

// ═══ 2 · Découverte de pages : les alternates hreflang passent devant ════
console.log('\n▶ Découverte — les versions linguistiques entrent dans l\'échantillon');

// Sitemap déterministe : 6 segments distincts AVANT /en. Sans la priorité,
// le round-robin (un par segment, dans l'ordre du sitemap) remplit les
// 4 places avec s1..s4 → /en (7e groupe) reste dehors, et la réciprocité
// hreflang n'est JAMAIS contrôlée. C'est le trou du premier passage.
const LOCS = ['/s1/a', '/s2/a', '/s3/a', '/s4/a', '/s5/a', '/s6/a', '/en']
  .map((p) => `<loc>https://exemple.fr${p}</loc>`).join('');
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.includes('/sitemap.xml')) {
    return { status: 200, url, text: async () => `<urlset>${LOCS}</urlset>`, body: { cancel: async () => {} } };
  }
  return { status: 404, url, text: async () => '', body: { cancel: async () => {} } };
};
try {
  const sans = await _discoverPages('https://exemple.fr/', 4);
  ok(!sans.urls.some((u) => u.endsWith('/en')),
    'témoin : SANS la priorité, /en (7e segment) est hors de l\'échantillon de 4', sans.urls.join(' '));
  const avec = await _discoverPages('https://exemple.fr/', 4,
    [{ lang: 'fr', href: 'https://exemple.fr/' }, { lang: 'en', href: 'https://exemple.fr/en' }]);
  ok(avec.urls.some((u) => u.endsWith('/en')),
    'AVEC les hreflang de la home : /en entre dans l\'échantillon', avec.urls.join(' '));
  ok(avec.urls[0].endsWith('/en'), 'et passe devant le round-robin (aucune page métier ici)');
  ok(avec.total === sans.total, 'le total détecté ne change pas (l\'alternate était déjà comptée)');

  // Un hreflang vers un AUTRE domaine (site .de séparé) est ignoré par la découverte.
  const autre = await _discoverPages('https://exemple.fr/', 4,
    [{ lang: 'de', href: 'https://exemple.de/' }]);
  ok(!autre.urls.some((u) => u.includes('exemple.de')), 'hreflang inter-domaines : jamais crawlé (même hôte seulement)');

  // Les pages métier (PRIORITY) gardent la première place — le NAP vit sur /contact.
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (url.includes('/sitemap.xml')) {
      return { status: 200, url, text: async () => `<urlset><loc>https://exemple.fr/contact</loc>${LOCS}</urlset>`, body: { cancel: async () => {} } };
    }
    return { status: 404, url, text: async () => '', body: { cancel: async () => {} } };
  };
  const mix = await _discoverPages('https://exemple.fr/', 4, [{ lang: 'en', href: 'https://exemple.fr/en' }]);
  ok(mix.urls[0].endsWith('/contact') && mix.urls[1].endsWith('/en'),
    'ordre final : métier (contact) puis version linguistique, puis divers', mix.urls.join(' '));
} finally {
  globalThis.fetch = realFetch;
}

// ═══ 3 · S18.2 — requalification pendant un crawl : le bug du 30/08 ══════
console.log('\n▶ S18.2 — un audit ne mélange plus deux natures de site');

{
  // L'agrégat CONTRADICTOIRE réellement stocké en prod (30/08 13:38:46) :
  // pages auditées moitié « local » (presence 0, findings nap), moitié
  // « online » (nap_* non applicables) → presence 0 ET nap_* n/a à la fois.
  const mixte = () => ({
    scores: { seo: 100, securite: 100, accessibilite: 100, presence: 0 },
    findings: [
      { axis: 'presence', sev: 'medium', key: 'nap_localbiz', title: 'Fiche absente' },
      { axis: 'seo', sev: 'low', key: 'title_long', title: 'Title long' },
    ],
    notApplicable: ['nap_phone', 'nap_address'],
  });
  const online = applySiteKind(mixte(), 'online');
  ok(online.scores.presence === null, 'online : presence redevient null (plus jamais 0 + « non applicable » ensemble)');
  ok(!online.findings.some((f) => f.key === 'nap_localbiz'), 'online : les findings locaux résiduels sont retirés');
  ok(online.findings.some((f) => f.key === 'title_long'), '…sans toucher aux autres findings');
  ok(['nap_phone', 'nap_address', 'nap_localbiz', 'nap_hours'].every((k) => online.notApplicable.includes(k)),
    'online : les 4 clés locales sont non applicables (transparence complète)');
  const local = applySiteKind(mixte(), 'local');
  ok(local.notApplicable.length === 0, 'local : plus aucune clé nap_* « non applicable » héritée du mode online');
  ok(local.scores.presence === 0, 'local : la présence mesurée reste comptée');
}

{
  // La route /kind lève la préférence « full » (S12.2) quand la nature
  // CHANGE : sans ça, la vignette restait verrouillée 7 jours sur un crawl
  // calculé avec l'ancienne nature (cockpit 100 / carte 83).
  const captured = [];
  const db = {
    prepare(sql) {
      return { bind(...args) {
        return {
          async first() {
            if (/SELECT id, site_kind FROM sentinel_sites/.test(sql)) return { id: args[0], site_kind: 'local' };
            return null;
          },
          async run() { captured.push({ sql, args }); return { success: true }; },
          async all() { return { results: [] }; },
        };
      },
      // _ensureSchema appelle .run() sans bind sur les CREATE/ALTER.
      async run() { return { success: true }; }, async first() { return null; }, async all() { return { results: [] }; } };
    },
  };
  const env = { DB: db, KS_JWT_SECRET: 'banc-s18-secret' };
  const jwt = await signJWT({ sub: 'tenant-banc', plan: 'MAX' }, env, 600);
  const req = (body) => new Request('https://x/api/sentinel/sites/site-1/kind', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const r1 = await handleSiteKindSet(req({ kind: 'online' }), env, 'site-1');
  ok(r1.status === 200, 'route /kind : 200 quand la nature change');
  const upd1 = captured.find((c) => /UPDATE sentinel_sites SET site_kind/.test(c.sql));
  ok(upd1 && upd1.sql.includes("last_coverage = 'sample'"),
    'nature CHANGÉE (local→online) : la préférence full est levée (last_coverage → sample)', upd1 && upd1.sql);

  captured.length = 0;
  const r2 = await handleSiteKindSet(req({ kind: 'local' }), env, 'site-1');
  ok(r2.status === 200, 'route /kind : 200 quand la nature est inchangée');
  const upd2 = captured.find((c) => /UPDATE sentinel_sites SET site_kind/.test(c.sql));
  ok(upd2 && !upd2.sql.includes('last_coverage'),
    'nature INCHANGÉE (local→local) : la référence full est conservée', upd2 && upd2.sql);
}

console.log(`\n${pass + fail} vérifications — ${pass} ok, ${fail} ko`);
process.exit(fail ? 1 : 0);
