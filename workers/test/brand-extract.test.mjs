// ─────────────────────────────────────────────────────────────────────────
// KEY BRAND · KB-IMPORT-1 — tests du moteur d'extraction PUR (aucune I/O).
//   node workers/test/brand-extract.test.mjs   (ou `npm run test:brand` dans workers/)
// ─────────────────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import { extractBrand, normHex, isNeutral, nameFromVar } from '../src/lib/brand-extract.js';

let n = 0;
const t = (label, fn) => { fn(); n++; console.log('  ✓', label); };

// ── normHex ──────────────────────────────────────────────────────────────
t('normHex : formes hex + rgb', () => {
  assert.equal(normHex('#FFF'), '#ffffff');
  assert.equal(normHex('#1B3A6B'), '#1b3a6b');
  assert.equal(normHex('#1b3a6bff'), '#1b3a6b');      // alpha ignoré
  assert.equal(normHex('rgb(27, 58, 107)'), '#1b3a6b');
  assert.equal(normHex('rgba(255,255,255,0.5)'), '#ffffff');
  assert.equal(normHex('hsl(200,50%,50%)'), null);    // hsl non converti (assumé)
  assert.equal(normHex('papayawhip'), null);
});

t('isNeutral : gris / quasi-blanc / quasi-noir', () => {
  assert.equal(isNeutral('#ffffff'), true);
  assert.equal(isNeutral('#000000'), true);
  assert.equal(isNeutral('#7a7a7a'), true);           // gris
  assert.equal(isNeutral('#1b3a6b'), false);          // bleu de marque
  assert.equal(isNeutral('#e8b923'), false);          // or
});

t('nameFromVar : variable → libellé lisible', () => {
  assert.equal(nameFromVar('--brand-blue'), 'Brand Blue');
  assert.equal(nameFromVar('--color-primary'), 'Primary');
  assert.equal(nameFromVar('--clr-accent'), 'Accent');
  assert.equal(nameFromVar('--c1'), null);            // pas parlant
  assert.equal(nameFromVar('--500'), null);
});

// ── Fixture réaliste ───────────────────────────────────────────────────────
const HTML = `<!doctype html><html><head>
  <title>Studio Nova — l'atelier créatif</title>
  <meta name="description" content="Nous concevons des marques qui durent.">
  <meta property="og:site_name" content="Studio Nova">
  <meta name="theme-color" content="#1b3a6b">
  <meta property="og:image" content="/img/social-card.png">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-180.png">
  <link rel="stylesheet" href="/css/site.css">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;600&display=swap" rel="stylesheet">
  <style>.hero{color:#1b3a6b;background:#ffffff}</style>
</head><body>
  <header><img src="/logo.svg" alt="Studio Nova logo" class="brand-logo"></header>
  <div style="color:#e8b923">Devis</div>
</body></html>`;

const CSS = `
:root{ --brand-blue:#1b3a6b; --brand-gold:#e8b923; --ink:#15171c; --paper:#ffffff; }
body{ font-family:'Inter', -apple-system, sans-serif; color:#15171c; background:#ffffff; }
h1,h2,.title{ font-family:'Playfair Display', Georgia, serif; color:#1b3a6b; }
.btn{ background:#1b3a6b; color:#fff; }
.badge{ background:#e8b923; }
.muted{ color:#7a7a7a; }
`;

const r = extractBrand({ html: HTML, css: CSS, baseUrl: 'https://studionova.fr/' });

// ── meta ───────────────────────────────────────────────────────────────────
t('meta : nom via og:site_name, baseline via description', () => {
  assert.equal(r.meta.name, 'Studio Nova');
  assert.equal(r.meta.baseline, 'Nous concevons des marques qui durent.');
});

t('meta : repli titre « Marque — slogan » → segment le plus court', () => {
  const r2 = extractBrand({ html: '<title>Studio Nova — l\'atelier créatif</title>', css: '' });
  assert.equal(r2.meta.name, 'Studio Nova');
});

// ── couleurs ────────────────────────────────────────────────────────────────
t('couleurs : primaire = theme-color, nommée via variable', () => {
  const pal = r.colors.palette;
  assert.ok(pal.length >= 2, 'au moins 2 couleurs');
  assert.equal(pal[0].role, 'primary');
  assert.equal(pal[0].hex, '#1b3a6b');
  assert.equal(pal[0].name, 'Brand Blue');            // nom repris de --brand-blue
  assert.equal(pal[1].role, 'secondary');
});

t('couleurs : l\'or de marque est retenu, le gris dé-priorisé', () => {
  const hexes = r.colors.palette.map(c => c.hex);
  assert.ok(hexes.includes('#e8b923'), 'or présent');
  // le gris #7a7a7a ne doit pas passer devant l'or
  const gi = hexes.indexOf('#7a7a7a'), oi = hexes.indexOf('#e8b923');
  assert.ok(oi !== -1 && (gi === -1 || oi < gi), 'or avant gris');
});

t('couleurs : champs par défaut alignés sur le front (_addColor)', () => {
  const c = r.colors.palette[0];
  assert.equal(c.cmyk, null);
  assert.equal(c.nightHex, null);
  assert.equal(c.pantone, null);
  assert.equal(c.story, null);
});

t('couleurs : dédup des teintes quasi identiques', () => {
  // #fff (style inline hero) et #ffffff (paper) ne doivent pas coexister deux fois
  const whites = r.colors.palette.filter(c => c.hex === '#ffffff').length;
  assert.ok(whites <= 1, 'un seul blanc au plus');
});

// ── typographies ─────────────────────────────────────────────────────────────
t('typo : familles Google repérées avec graisses', () => {
  const fams = r.typography.fonts.map(f => f.family);
  assert.ok(fams.includes('Playfair Display'), 'Playfair détectée');
  assert.ok(fams.includes('Inter'), 'Inter détectée');
  const pf = r.typography.fonts.find(f => f.family === 'Playfair Display');
  assert.equal(pf.source, 'google');
  assert.equal(pf.axis, '700;900');
});

t('typo : rôles devinés (Playfair=titre car h1/.title, Inter=corps car body)', () => {
  const pf = r.typography.fonts.find(f => f.family === 'Playfair Display');
  const inter = r.typography.fonts.find(f => f.family === 'Inter');
  assert.equal(pf.role, 'title');
  assert.equal(inter.role, 'body');
});

t('typo : familles génériques (-apple-system, serif…) exclues', () => {
  const fams = r.typography.fonts.map(f => f.family.toLowerCase());
  for (const bad of ['-apple-system', 'serif', 'sans-serif', 'georgia']) {
    // georgia est un fallback ici, jamais la 1re famille nommée → absent
    assert.ok(!fams.includes(bad), `${bad} absent`);
  }
});

// ── logos ────────────────────────────────────────────────────────────────────
t('logos : SVG en tête, absolus, dédupliqués, avec l\'img d\'en-tête', () => {
  const urls = r.logos.map(l => l.url);
  assert.equal(r.logos[0].url, 'https://studionova.fr/favicon.svg');   // svg prioritaire
  assert.ok(urls.includes('https://studionova.fr/logo.svg'), 'logo header capté');
  assert.ok(urls.includes('https://studionova.fr/img/social-card.png'), 'og:image capté');
  assert.ok(urls.every(u => /^https:\/\//.test(u)), 'tous absolus');
});

// ── diagnostics / robustesse ──────────────────────────────────────────────────
t('diagnostics : site quasi vide → jsHeavy + note', () => {
  const empty = extractBrand({ html: '<html><body><div id=app></div></body></html>', css: '' });
  assert.equal(empty.diagnostics.jsHeavy, true);
  assert.ok(empty.diagnostics.note);
  assert.equal(empty.colors.palette.length, 0);
  assert.equal(empty.typography.fonts.length, 0);
});

t('robustesse : entrées vides/nulles ne jettent pas', () => {
  assert.doesNotThrow(() => extractBrand({}));
  assert.doesNotThrow(() => extractBrand({ html: null, css: undefined }));
  const r0 = extractBrand({ html: '', css: '' });
  assert.equal(r0.colors.palette.length, 0);
});

t('ancienne forme Google Fonts ?family=Roboto:400,700|Lora', () => {
  const h = '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:400,700|Lora">';
  const rr = extractBrand({ html: h, css: '' });
  const fams = rr.typography.fonts.map(f => f.family);
  assert.ok(fams.includes('Roboto') && fams.includes('Lora'));
  const rob = rr.typography.fonts.find(f => f.family === 'Roboto');
  assert.equal(rob.axis, '400;700');
});

console.log(`\n${n} assertions OK — moteur d'extraction Key Brand.`);
