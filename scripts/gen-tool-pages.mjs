#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — gen-tool-pages
   ─────────────────────────────────────────────────────────────
   Genere les PAGES PUBLIQUES INDEXABLES, une par outil, sous
   /outils/<slug>.html, a partir de la SOURCE UNIQUE deja utilisee
   par les notices : /K_STORE_ASSETS/HELP/<appId>.json
   (title, tldr, key_points[], faq[{q,a}]).

   Chaque page : metas propres + JSON-LD (BreadcrumbList + WebPage +
   FAQPage) + maillage interne (fil d'Ariane, 3 outils lies, CTA).
   Genere aussi /faq.html (FAQ agregee). Le sitemap.xml est ecrit par gen-vertical-pages.mjs.

   Les icones et tags des cartes sont relus depuis le tableau TOOLS
   d'index.html (source unique cote landing) — aucune duplication.

   Usage : npm run gen-pages   (ou node scripts/gen-tool-pages.mjs)
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HELP = resolve(ROOT, 'K_STORE_ASSETS', 'HELP');
const INDEX = resolve(ROOT, 'index.html');
const OUTILS = resolve(ROOT, 'outils');
const ORIGIN = 'https://protein-keystone.com';
const TODAY = '2026-06-28';

// Ordre = celui de la grille TOOLS dans index.html.
// Pour chaque outil : slug + H1 (2 lignes, la 2e en degrade) + metas SEO.
const META = [
  { app: 'A-COM-001', slug: 'smart-qr',
    h1a: 'Un QR code.', h1b: 'Mille destinations, zéro réimpression.',
    title: 'Smart Dynamic QR — QR codes dynamiques et souverains | Keystone OS',
    desc: 'Créez des QR codes dynamiques, modifiables après impression, brandés à votre charte, avec tracking RGPD natif sans dépendance Google. Souverain, hébergé en Europe.' },
  { app: 'A-COM-002', slug: 'brief-prod',
    h1a: 'Votre intention créative,', h1b: 'un cahier des charges infaillible.',
    title: 'Brief Prod — le brief créatif parfait en 2 minutes | Keystone OS',
    desc: 'Brief Prod transforme votre intention créative en cahier des charges technique pour votre graphiste ou imprimeur. Fini l’erreur d’impression à 800 euros.' },
  { app: 'A-COM-003', slug: 'brainstorming',
    h1a: 'Neuf IA débattent vos idées.', h1b: 'Vous tranchez.',
    title: 'Brainstorming — une table ronde d’IA pour vos idées | Keystone OS',
    desc: 'Neuf personnalités IA spécialisées dialoguent en direct autour de votre brief. Vous orientez la conversation, le Synthesizer livre une synthèse structurée.' },
  { app: 'A-COM-004', slug: 'key-form',
    h1a: 'Des formulaires intelligents,', h1b: 'sans une ligne de code.',
    title: 'Key Form — formulaires intelligents partageables | Keystone OS',
    desc: 'Construisez des formulaires intelligents partageables par URL : 16 types de champs, logique conditionnelle, e-mails Resend, RGPD natif. La parité Typeform Pro, sans l’abonnement.' },
  { app: 'A-COM-005', slug: 'ghost-writer',
    h1a: 'Vos textes,', h1b: 'réécrits dans votre ton.',
    title: 'Ghost Writer — réécriture et correction de vos textes | Keystone OS',
    desc: 'Deux outils en un : réécrivez un texte en plusieurs variantes calibrées (e-mail, interne, marketing) et corrigez orthographe, grammaire et accords en un clic.' },
  { app: 'O-AGT-001', slug: 'smart-agent',
    h1a: 'Vos clients ont une question.', h1b: 'Votre agent IA répond. Sans vous.',
    title: 'Smart Agent — l’agent IA qui répond à vos clients 24/7 | Keystone OS',
    desc: 'Un agent IA qui répond à vos clients uniquement depuis le savoir que vous validez — jamais d’invention. Par chat ou à la voix, derrière un lien ou un QR code.' },
  { app: 'O-SOC-001', slug: 'social-manager',
    h1a: 'Un post.', h1b: 'Tous vos réseaux. Un clic.',
    title: 'Social Manager — publiez sur tous vos réseaux en un clic | Keystone OS',
    desc: 'Écrivez une fois, publiez sur Facebook, Instagram, Threads et Telegram — tout de suite ou à l’heure programmée. Réessais automatiques et suivi des envois inclus.' },
  { app: 'O-GEO-001', slug: 'sentinel',
    h1a: 'Votre site sous surveillance.', h1b: 'Et visible dans les IA.',
    title: 'Sentinel — audit web et visibilité IA (GEO) | Keystone OS',
    desc: 'Auditez et surveillez vos sites dans le temps : disponibilité, performance, SEO, sécurité, accessibilité — et surtout, savez-vous si les IA citent votre établissement ?' },
  { app: 'O-Keyn-001', slug: 'keynapse',
    h1a: 'Vos idées en constellation.', h1b: 'Reliées, vivantes, à vous.',
    title: 'Keynapse — notes en constellation sur canevas infini | Keystone OS',
    desc: 'Votre espace personnel de connaissances : des bulles de notes sur un canevas infini, regroupées en zones de couleur et reliées par des traits. Vos idées, vivantes.' },
];

// ── helpers ─────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const stripNum = (s) => String(s).replace(/^\s*\d+[.)]\s*/, '');
const jsonld = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

// Met en gras le segment de tete d'une etape (avant le premier " : ").
function stepHTML(k) {
  const s = stripNum(k);
  const i = s.indexOf(' : ');
  if (i > 0 && i < 46) return `<b>${esc(s.slice(0, i))}</b> : ${esc(s.slice(i + 3))}`;
  return esc(s);
}

// ── extraction des icones + tags depuis TOOLS d'index.html ──────
const indexHTML = readFileSync(INDEX, 'utf8');
function toolBits(app) {
  const re = new RegExp('app:"' + app.replace(/[-/]/g, '\\$&') + '"[\\s\\S]*?tag:"([^"]*)"[\\s\\S]*?icon:\'([^\']*)\'');
  const m = indexHTML.match(re);
  if (!m) { console.error(`✗ TOOLS introuvable pour ${app} dans index.html`); process.exit(1); }
  return { tag: m[1], icon: m[2] };
}

// ── chargement source HELP ──────────────────────────────────────
const tools = META.map((meta) => {
  let j;
  try { j = JSON.parse(readFileSync(resolve(HELP, `${meta.app}.json`), 'utf8')); }
  catch (e) { console.error(`✗ HELP illisible : ${meta.app}.json — ${e.message}`); process.exit(1); }
  return { ...meta, ...toolBits(meta.app), j };
});

// ── feuille de style commune (inlinee, identique a la landing) ──
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
.hero{padding:34px 0 46px;text-align:center}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--accent-3);padding:6px 14px;border-radius:999px;margin-bottom:22px;background:var(--accent-bg);border:1px solid var(--accent-bd)}
.eyebrow svg{width:15px;height:15px}
h1{font-size:clamp(30px,5.6vw,50px);font-weight:900;letter-spacing:-.035em;line-height:1.04}
h1 em{font-style:normal;background:linear-gradient(120deg,var(--accent-3),var(--accent-2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lead{max-width:660px;margin:22px auto 0;font-size:clamp(15px,2.2vw,17.5px);color:var(--text-2)}
.lead b{color:var(--text);font-weight:600}
.ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:32px}
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
.sub{color:var(--text-2);font-size:15px;max-width:620px}
.steps{list-style:none;counter-reset:s;margin-top:26px;display:grid;gap:14px}
.steps li{counter-increment:s;position:relative;padding:18px 20px 18px 60px;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.012));border:1px solid var(--border);border-radius:var(--r-md);font-size:14.5px;color:var(--text-2)}
.steps li b{color:var(--text);font-weight:600}
.steps li::before{content:counter(s);position:absolute;left:16px;top:16px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:9px;font-weight:800;font-size:14px;color:var(--accent-3);background:var(--accent-bg);border:1px solid var(--accent-bd)}
.faq{margin-top:24px;display:grid;gap:10px}
.faq details{background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden}
.faq summary{list-style:none;cursor:pointer;padding:16px 18px;font-size:15px;font-weight:600;color:var(--text);display:flex;justify-content:space-between;align-items:center;gap:14px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-size:20px;font-weight:400;color:var(--accent-3);transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq .a{padding:0 18px 18px;font-size:14px;color:var(--text-2)}
.related{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:24px}
.rcard{display:block;padding:18px;border:1px solid var(--border);border-radius:var(--r-md);background:rgba(255,255,255,.02);transition:border-color .2s,transform .15s}
.rcard:hover{border-color:var(--accent-bd);transform:translateY(-2px)}
.rcard .ic{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:var(--accent-bg);border:1px solid var(--accent-bd);margin-bottom:12px}
.rcard .ic svg{width:19px;height:19px;color:var(--accent-3)}
.rcard h3{font-size:15px;font-weight:700;letter-spacing:-.02em}
.rcard p{font-size:13px;color:var(--text-2);margin-top:4px}
.band{margin:40px 0 10px;padding:40px 26px;text-align:center;border-radius:var(--r-lg);background:linear-gradient(140deg,rgba(99,102,241,.16),rgba(129,140,248,.05));border:1px solid var(--accent-bd)}
.band h2{margin-bottom:8px}
.band p{color:var(--text-2);font-size:15px;max-width:500px;margin:0 auto 22px}
.foot{margin-top:46px;border-top:1px solid var(--border);padding:34px 0}
.foot-cols{display:flex;flex-wrap:wrap;gap:34px}
.foot-col h4{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin-bottom:12px}
.foot-col a,.foot-col address,.foot-col span{display:block;font-size:13.5px;color:var(--text-2);font-style:normal;margin-bottom:7px;line-height:1.5}
.foot-col a:hover{color:var(--text)}
.foot-copy{margin-top:28px;font-size:12.5px;color:var(--text-3)}
@media(max-width:560px){.hero{padding:24px 0 36px}}`;

const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
const ICON_WRAP = (icon) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;

function FOOT() {
  return `  <footer class="foot">
    <div class="foot-cols">
      <div class="foot-col"><h4>Produit</h4>
        <a href="/#outils">Outils</a><a href="/#plans">Tarifs</a><a href="/faq">FAQ</a><a href="/activate">Se connecter</a>
      </div>
      <div class="foot-col"><h4>Contact</h4>
        <a href="mailto:protein.keystone@gmail.com">protein.keystone@gmail.com</a>
        <a href="tel:+33675590797">06 75 59 07 97</a>
        <span>SAV : lun.–sam. 10h–19h (hors jours fériés)</span>
      </div>
      <div class="foot-col"><h4>Confiance</h4>
        <a href="/a-propos">À propos</a><a href="/securite">Sécurité</a><a href="/confidentialite">Confidentialité</a><a href="/mentions-legales">Mentions légales</a><a href="/cgu">CGU</a><a href="/cgv">CGV</a><a href="/dpa">DPA & sous-traitants</a><a href="/reversibilite">Réversibilité</a>
      </div>
      <div class="foot-col"><h4>Éditeur</h4>
        <address>Protein Studio<br>83190 Ollioules<br>France<br>SIRET 520 721 853 00023</address>
      </div>
    </div>
    <div class="foot-copy">© 2026 Keystone OS — édité par Protein Studio (EI, Stéphane Benedetti), SIRET 520 721 853 00023.</div>
  </footer>`;
}

function toolPage(t, idx) {
  const url = `${ORIGIN}/outils/${t.slug}`;
  const steps = (t.j.key_points || []).map(k => `      <li>${stepHTML(k)}</li>`).join('\n');
  const faqItems = (t.j.faq || []).map(f =>
    `      <details><summary>${esc(f.q)}</summary><div class="a">${esc(f.a)}</div></details>`).join('\n');
  const related = [tools[(idx + 1) % tools.length], tools[(idx + 2) % tools.length], tools[(idx + 3) % tools.length]];
  const relCards = related.map(r =>
    `      <a class="rcard" href="/outils/${r.slug}"><span class="ic">${ICON_WRAP(r.icon)}</span><h3>${esc(r.j.title)}</h3><p>${esc(r.tag)}</p></a>`).join('\n');

  const graph = [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Outils', item: `${ORIGIN}/#outils` },
      { '@type': 'ListItem', position: 3, name: t.j.title, item: url },
    ] },
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: t.title, inLanguage: 'fr-FR',
      isPartOf: { '@id': `${ORIGIN}/#website` }, about: { '@id': `${ORIGIN}/#organization` }, description: t.desc },
  ];
  if ((t.j.faq || []).length) graph.push({ '@type': 'FAQPage',
    mainEntity: t.j.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(t.title)}</title>
<meta name="description" content="${escAttr(t.desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${escAttr(t.title)}">
<meta property="og:description" content="${escAttr(t.desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="Keystone OS">
<meta property="og:locale" content="fr_FR">
<meta property="og:image" content="${ORIGIN}/og-cover.png">
<meta property="og:image:width" content="2400">
<meta property="og:image:height" content="1260">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(t.title)}">
<meta name="twitter:description" content="${escAttr(t.desc)}">
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
    <a href="/">Accueil</a> &nbsp;/&nbsp; <a href="/#outils">Outils</a> &nbsp;/&nbsp; <span>${esc(t.j.title)}</span>
  </nav>

  <header class="hero">
    <span class="eyebrow">${ICON_WRAP(t.icon)}${esc(t.j.title)}</span>
    <h1>${esc(t.h1a)}<br><em>${esc(t.h1b)}</em></h1>
    <p class="lead">${esc(t.j.tldr || '')}</p>
    <div class="ctas">
      <a class="btn btn-primary" href="/activate">Commencer ${ARROW}</a>
      <a class="btn btn-ghost" href="/#outils">Voir tous les outils</a>
    </div>
    <p class="trust">Sans carte bancaire · vos données restent à vous, hébergées en Europe</p>
  </header>
${steps ? `
  <section class="block" aria-labelledby="how">
    <span class="eyebrow-l">Le principe</span>
    <h2 id="how">Comment ça marche</h2>
    <ol class="steps">
${steps}
    </ol>
  </section>
` : ''}${faqItems ? `
  <section class="block" aria-labelledby="faq">
    <span class="eyebrow-l">Bon à savoir</span>
    <h2 id="faq">Questions fréquentes</h2>
    <div class="faq">
${faqItems}
    </div>
  </section>
` : ''}
  <section class="block" aria-labelledby="more">
    <span class="eyebrow-l">Le catalogue</span>
    <h2 id="more">Les autres outils de l'OS</h2>
    <p class="sub">${esc(t.j.title)} fait partie de Keystone — un OS modulaire où vous activez ce dont vous avez besoin.</p>
    <div class="related">
${relCards}
    </div>
  </section>

  <section class="band">
    <h2>Activez ${esc(t.j.title)} dans votre OS.</h2>
    <p>Tous vos outils métier dans un seul cockpit. Démarrez en quelques minutes.</p>
    <a class="btn btn-primary" href="/activate">Commencer ${ARROW}</a>
  </section>

${FOOT()}

</div>
</body>
</html>
`;
}

function faqPage() {
  const url = `${ORIGIN}/faq`;
  const sections = tools.map(t => {
    const items = (t.j.faq || []).map(f =>
      `      <details><summary>${esc(f.q)}</summary><div class="a">${esc(f.a)}</div></details>`).join('\n');
    if (!items) return '';
    return `  <section class="block">
    <span class="eyebrow-l">${esc(t.j.title)}</span>
    <h2><a href="/outils/${t.slug}" style="color:inherit">${esc(t.j.title)}</a></h2>
    <div class="faq">
${items}
    </div>
  </section>`;
  }).filter(Boolean).join('\n');

  const allQ = tools.flatMap(t => (t.j.faq || []).map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })));
  const graph = [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'FAQ', item: url },
    ] },
    { '@type': 'FAQPage', '@id': `${url}#faqpage`, inLanguage: 'fr-FR', mainEntity: allQ },
  ];
  const title = 'FAQ — toutes vos questions sur Keystone OS et ses outils';
  const desc = 'Toutes les réponses sur Keystone OS : Smart Agent, Sentinel, Social Manager, Smart QR, Key Form, Ghost Writer, Brainstorming, Brief Prod et Keynapse.';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${escAttr(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="Keystone OS">
<meta property="og:locale" content="fr_FR">
<meta property="og:image" content="${ORIGIN}/og-cover.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(desc)}">
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
    <a href="/">Accueil</a> &nbsp;/&nbsp; <span>FAQ</span>
  </nav>

  <header class="hero">
    <span class="eyebrow">Questions fréquentes</span>
    <h1>Vos questions,<br><em>nos réponses.</em></h1>
    <p class="lead">Tout ce qu'il faut savoir sur Keystone et ses outils — souveraineté, crédits IA, données, publication. Une question sans réponse ? Écrivez-nous.</p>
    <div class="ctas">
      <a class="btn btn-primary" href="/activate">Commencer ${ARROW}</a>
      <a class="btn btn-ghost" href="/#outils">Voir les outils</a>
    </div>
  </header>

${sections}

  <section class="band">
    <h2>Une question reste ?</h2>
    <p>Écrivez-nous, on répond du lundi au samedi, de 10h à 19h.</p>
    <a class="btn btn-primary" href="mailto:protein.keystone@gmail.com">Nous écrire ${ARROW}</a>
  </section>

${FOOT()}

</div>
</body>
</html>
`;
}

// ── ecriture ────────────────────────────────────────────────────
mkdirSync(OUTILS, { recursive: true });
tools.forEach((t, i) => {
  writeFileSync(resolve(OUTILS, `${t.slug}.html`), toolPage(t, i), 'utf8');
});
writeFileSync(resolve(ROOT, 'faq.html'), faqPage(), 'utf8');

// ── sitemap.xml : NON ecrit ici. Proprietaire unique = scripts/gen-vertical-pages.mjs
//    (il couvre accueil + /faq + pages outils + pages metier). Lancer gen-verticals
//    APRES gen-pages pour rafraichir le sitemap complet.

console.log(`✓ ${tools.length} pages outils + /faq generees. (sitemap : lancer gen-verticals)`);
