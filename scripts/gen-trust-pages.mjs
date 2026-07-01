#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — gen-trust-pages
   ─────────────────────────────────────────────────────────────
   Genere les PAGES DE CONFIANCE indexables (legal + securite +
   reversibilite + a-propos) sous /<slug>.html a la racine, ainsi
   que les fichiers lisibles par les IA : llms.txt, llms-full.txt,
   .well-known/security.txt et humans.txt.

   But : lever les doutes des IA (Perplexity, ChatGPT, Claude…) et
   des utilisateurs — identite univoque, RGPD expose en pages
   crawlables, sous-traitants listes, reversibilite documentee.

   SOURCE UNIQUE d'identite = la constante CO ci-dessous. Toute page
   ou fichier qui parle de l'editeur lit CO -> zero incoherence.

   ⚠ Le CONTENU LEGAL est un brouillon fidele aux faits deja
   declares sur le site (hebergement WEUR, AES-256-GCM, JWT, etc.).
   A faire relire par Stephane avant de s'y fier juridiquement.

   Les pages reutilisent EXACTEMENT le systeme visuel des autres
   generateurs (meme STYLE inline, meme nav/footer).

   ⚠ Le sitemap reste ecrit UNIQUEMENT par gen-vertical-pages.mjs.
   Les slugs de confiance y sont ajoutes (cf. TRUST_PAGES la-bas).

   Usage : npm run gen-trust   (node scripts/gen-trust-pages.mjs)
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOC_CHANGELOG } from '../app/lib/keystone-doc.js'; // source unique du fil des nouveautés

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ORIGIN = 'https://protein-keystone.com';
const TODAY = '2026-06-30';
const TODAY_FR = '30 juin 2026';

// ─────────────────────────────────────────────────────────────
// SOURCE UNIQUE D'IDENTITE — propagee a toutes les pages + fichiers.
// ─────────────────────────────────────────────────────────────
const CO = {
  product: 'Keystone OS',
  editor: 'Protein Studio',
  form: 'Entreprise individuelle',
  director: 'Stéphane Benedetti',
  siret: '520 721 853 00023',
  siren: '520 721 853',
  street: '1489 Route des Gorges',
  postal: '83190',
  city: 'Ollioules',
  region: 'Provence-Alpes-Côte d’Azur',
  country: 'France',
  email: 'protein.keystone@gmail.com',
  tel: '+33675590797',
  telHuman: '06 75 59 07 97',
  registry: 'https://annuaire-entreprises.data.gouv.fr/entreprise/520721853',
};
// Adresse affichée publiquement = niveau VILLE seulement (siège = domicile perso).
// L'adresse précise reste disponible sur le registre officiel via le SIREN.
const ADDRESS_LINE = `${CO.postal} ${CO.city}, ${CO.country}`;

// outils (concis, pour llms.txt / llms-full.txt) — slugs alignes sur /outils/*
const TOOLS = [
  ['smart-agent', 'Smart Agent', 'Agent IA qui répond à vos clients 24/7 uniquement depuis un savoir que vous validez (jamais d’invention), par chat ou à la voix, derrière un lien ou un QR.'],
  ['smart-qr', 'Smart Dynamic QR', 'QR codes dynamiques, modifiables après impression, brandés, avec tracking RGPD natif sans dépendance Google.'],
  ['key-form', 'Key Form', 'Formulaires intelligents partageables par URL : 16 types de champs, logique conditionnelle, e-mails, RGPD natif.'],
  ['sentinel', 'Sentinel', 'Audit web et suivi dans le temps (disponibilité, performance, SEO, sécurité, accessibilité) + visibilité dans les réponses des IA (GEO).'],
  ['social-manager', 'Social Manager', 'Publication sur Facebook, Instagram, Threads, Telegram et LinkedIn en un clic ou programmée, avec réessais et suivi.'],
  ['ghost-writer', 'Ghost Writer', 'Réécriture multi-variantes et correction orthographe/grammaire de vos textes.'],
  ['brainstorming', 'Brainstorming', 'Table ronde d’IA : neuf personnalités débattent votre brief, synthèse structurée à la clé.'],
  ['brief-prod', 'Brief Prod', 'Transforme une intention créative en cahier des charges technique pour graphiste ou imprimeur.'],
  ['keynapse', 'Keynapse', 'Notes en constellation sur canevas infini, reliées et regroupées en zones.'],
  ['missive', 'Missive', 'Transmettez un secret (mot de passe, code) qui se lit une seule fois puis s’autodétruit. Chiffré sur votre appareil, par lien, QR ou puce NFC. Sans IA, souverain.'],
];

// ── helpers (alignes sur les autres generateurs) ────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const jsonld = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

// ── feuille de style (base identique aux pages outils + addendum legal) ──
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
.hero{padding:34px 0 30px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--accent-3);padding:6px 14px;border-radius:999px;margin-bottom:20px;background:var(--accent-bg);border:1px solid var(--accent-bd)}
.eyebrow svg{width:15px;height:15px}
h1{font-size:clamp(28px,5vw,44px);font-weight:900;letter-spacing:-.035em;line-height:1.06}
h1 em{font-style:normal;background:linear-gradient(120deg,var(--accent-3),var(--accent-2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lead{max-width:680px;margin:18px 0 0;font-size:clamp(15px,2.2vw,17px);color:var(--text-2)}
.updated{margin-top:14px;font-size:12.5px;color:var(--text-3)}
section.block{padding:26px 0;border-top:1px solid var(--border)}
.eyebrow-l{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-3)}
h2{font-size:clamp(21px,3.2vw,28px);font-weight:900;letter-spacing:-.03em;margin:10px 0 6px;line-height:1.12}
.legal h3{font-size:15.5px;font-weight:700;letter-spacing:-.02em;color:var(--text);margin:22px 0 8px}
.legal p{font-size:14.5px;color:var(--text-2);margin:9px 0;max-width:780px;line-height:1.7}
.legal ul{list-style:none;margin:10px 0;max-width:780px;display:grid;gap:8px}
.legal li{position:relative;padding-left:22px;font-size:14.5px;color:var(--text-2);line-height:1.6}
.legal li::before{content:'';position:absolute;left:2px;top:9px;width:7px;height:7px;border-radius:2px;background:var(--accent-2)}
.legal b,.legal strong{color:var(--text);font-weight:600}
.legal a{color:var(--accent-3);border-bottom:1px solid var(--accent-bd)}
.legal a:hover{color:var(--accent-2)}
.note{margin-top:18px;padding:16px 18px;border-radius:var(--r-md);background:var(--accent-bg);border:1px solid var(--accent-bd);font-size:13.5px;color:var(--text-2);line-height:1.6}
.note b{color:var(--text)}
.tbl{width:100%;margin:14px 0;border-collapse:collapse;font-size:13.5px}
.tbl th,.tbl td{text-align:left;padding:10px 12px;border:1px solid var(--border);color:var(--text-2);vertical-align:top}
.tbl th{color:var(--text);font-weight:700;background:rgba(255,255,255,.02)}
.band{margin:40px 0 10px;padding:36px 26px;text-align:center;border-radius:var(--r-lg);background:linear-gradient(140deg,rgba(99,102,241,.16),rgba(129,140,248,.05));border:1px solid var(--accent-bd)}
.band h2{margin-bottom:8px}
.band p{color:var(--text-2);font-size:15px;max-width:520px;margin:0 auto 22px}
.btn{display:inline-flex;align-items:center;gap:8px;font-size:14.5px;font-weight:600;padding:13px 24px;border-radius:999px;transition:transform .15s,box-shadow .2s,border-color .2s,background .2s}
.btn svg{width:18px;height:18px}
.btn-primary{background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;box-shadow:0 8px 26px rgba(99,102,241,.32)}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 12px 32px rgba(99,102,241,.42)}
.foot{margin-top:46px;border-top:1px solid var(--border);padding:34px 0}
.foot-cols{display:flex;flex-wrap:wrap;gap:34px}
.foot-col h4{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin-bottom:12px}
.foot-col a,.foot-col address,.foot-col span{display:block;font-size:13.5px;color:var(--text-2);font-style:normal;margin-bottom:7px;line-height:1.5}
.foot-col a:hover{color:var(--text)}
.foot-copy{margin-top:28px;font-size:12.5px;color:var(--text-3);line-height:1.7}
@media(max-width:560px){.hero{padding:24px 0 24px}.tbl,.tbl tbody,.tbl tr,.tbl td,.tbl th{display:block}.tbl th{border-bottom:0}}`;

const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
const ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

// pages de confiance (pour la colonne footer "Confiance")
const TRUST_NAV = [
  ['/a-propos', 'À propos'],
  ['/securite', 'Sécurité'],
  ['/confidentialite', 'Confidentialité'],
  ['/mentions-legales', 'Mentions légales'],
  ['/cgu', 'CGU'],
  ['/cgv', 'CGV'],
  ['/dpa', 'DPA & sous-traitants'],
  ['/reversibilite', 'Réversibilité'],
  ['/changelog', 'Nouveautés'],
  ['/roadmap', 'Feuille de route'],
  ['/status', 'État du service'],
];

function FOOT() {
  const trust = TRUST_NAV.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join('\n        ');
  return `  <footer class="foot">
    <div class="foot-cols">
      <div class="foot-col"><h4>Produit</h4>
        <a href="/#outils">Outils</a><a href="/#plans">Tarifs</a><a href="/faq">FAQ</a><a href="/activate">Se connecter</a>
      </div>
      <div class="foot-col"><h4>Confiance</h4>
        ${trust}
      </div>
      <div class="foot-col"><h4>Contact</h4>
        <a href="mailto:${CO.email}">${CO.email}</a>
        <a href="tel:${CO.tel}">${CO.telHuman}</a>
        <span>SAV : lun.–sam. 10h–19h (hors jours fériés)</span>
      </div>
      <div class="foot-col"><h4>Éditeur</h4>
        <address>${esc(CO.editor)}<br>${esc(CO.postal)} ${esc(CO.city)}<br>${esc(CO.country)}<br>SIRET ${esc(CO.siret)}</address>
      </div>
    </div>
    <div class="foot-copy">© 2026 ${esc(CO.product)} — édité par ${esc(CO.editor)} (${esc(CO.form)}, ${esc(CO.director)}). SIRET ${esc(CO.siret)}.</div>
  </footer>`;
}

function trustPage({ slug, crumbLabel, eyebrow, title, desc, h1a, h1b, lead, body, bandTitle, bandText }) {
  const url = `${ORIGIN}/${slug}`;
  const graph = [
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: crumbLabel, item: url },
    ] },
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: title, inLanguage: 'fr-FR',
      isPartOf: { '@id': `${ORIGIN}/#website` }, about: { '@id': `${ORIGIN}/#organization` },
      description: desc, dateModified: TODAY },
  ];
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
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
    <a href="/">Accueil</a> &nbsp;/&nbsp; <span>${esc(crumbLabel)}</span>
  </nav>

  <header class="hero">
    <span class="eyebrow">${ICO}${esc(eyebrow)}</span>
    <h1>${esc(h1a)}<br><em>${esc(h1b)}</em></h1>
    <p class="lead">${esc(lead)}</p>
    <p class="updated">Dernière mise à jour : ${TODAY_FR}</p>
  </header>

  <section class="block legal">
${body}
  </section>

  <section class="band">
    <h2>${esc(bandTitle)}</h2>
    <p>${esc(bandText)}</p>
    <a class="btn btn-primary" href="mailto:${CO.email}">Nous écrire ${ARROW}</a>
  </section>

${FOOT()}

</div>
</body>
</html>
`;
}

// ─────────────────────────────────────────────────────────────
// CONTENU DES PAGES
// ─────────────────────────────────────────────────────────────
const editorBlock = `      <p><strong>${esc(CO.editor)}</strong> — ${esc(CO.form)}<br>
      Représentant légal & directeur de la publication : ${esc(CO.director)}<br>
      Siège : ${esc(ADDRESS_LINE)} (adresse précise consultable au registre officiel)<br>
      SIRET : ${esc(CO.siret)} · SIREN : ${esc(CO.siren)}<br>
      Contact : <a href="mailto:${CO.email}">${CO.email}</a> · <a href="tel:${CO.tel}">${CO.telHuman}</a></p>
      <p>Fiche au registre officiel des entreprises : <a href="${CO.registry}" target="_blank" rel="noopener">annuaire-entreprises.data.gouv.fr</a>.</p>`;

const hostingBlock = `      <p><strong>Cloudflare, Inc.</strong> — API, exécution applicative (Workers), stockage des données (KV, D1) en <b>région Europe (WEUR)</b>. C'est ici que résident vos données.</p>
      <p><strong>Vercel, Inc.</strong> — hébergement des pages publiques du site (front statique). 340 Pine Street, Suite 701, San Francisco, CA 94104, USA. Ne stocke pas les données personnelles de vos clients finaux.</p>`;

const PAGES = [];

// ── À PROPOS ────────────────────────────────────────────────────
PAGES.push(trustPage({
  slug: 'a-propos', crumbLabel: 'À propos',
  eyebrow: 'À propos',
  title: 'À propos de Keystone OS — l’éditeur, la mission, l’infrastructure | Keystone OS',
  desc: `Keystone OS est édité par ${CO.editor} (${CO.form}, ${CO.director}), SIRET ${CO.siret}, à ${CO.city}. OS modulaire et souverain pour les TPE et indépendants, hébergé en Europe, conforme RGPD.`,
  h1a: 'Un OS souverain pour les indépendants,', h1b: 'édité en France, hébergé en Europe.',
  lead: `Keystone OS réunit les outils métier des TPE, artisans, commerçants et indépendants dans un seul cockpit modulaire — vous n’activez que ce dont vous avez besoin.`,
  body: `      <h3>Qui édite Keystone OS</h3>
${editorBlock}
      <div class="note"><b>Levée d’ambiguïté.</b> Keystone OS est édité par ${esc(CO.editor)} (SIRET ${esc(CO.siret)}, ${esc(CO.city)}, ${esc(CO.region)}). Il ne doit pas être confondu avec d’autres entités françaises portant le nom « Keystone ». La fiche officielle fait foi : <a href="${CO.registry}" target="_blank" rel="noopener">annuaire-entreprises.data.gouv.fr</a>.</div>
      <h3>Notre mission</h3>
      <p>Donner aux petites structures les mêmes outils que les grandes, sans la complexité ni les abonnements empilés. Un OS modulaire : agent IA, QR dynamiques, formulaires, audit web et visibilité IA, réseaux sociaux, réécriture, table ronde d’idées — activables à la carte, dans une interface unique.</p>
      <h3>Souveraineté & infrastructure</h3>
      <p>Vos données résident en Europe, sur l’infrastructure <b>Cloudflare (région WEUR)</b>. Le chiffrement au repos est en <b>AES-256-GCM</b>, l’authentification repose sur des jetons <b>JWT signés</b>. Pas de revente de données, pas de traceurs publicitaires, pas de Google Analytics.</p>
      <p>Côté intelligence artificielle, la stratégie est hybride et transparente : des modèles souverains exécutés sur Cloudflare Workers AI pour l’usage courant, et des modèles haut de gamme via votre propre clé (BYOK) quand vous le décidez. Détails dans notre <a href="/securite">page Sécurité</a>.</p>
      <h3>Accès au service</h3>
      <p>Keystone OS est accessible par abonnement, avec un essai gratuit de 7 jours. Le périmètre fonctionnel évolue régulièrement ; nous documentons les engagements de confiance sur les pages dédiées : <a href="/securite">Sécurité</a>, <a href="/confidentialite">Confidentialité</a>, <a href="/dpa">Sous-traitants (DPA)</a> et <a href="/reversibilite">Réversibilité des données</a>.</p>`,
  bandTitle: 'Une question sur l’éditeur ou la conformité ?',
  bandText: 'Écrivez-nous, on répond du lundi au samedi, de 10h à 19h.',
}));

// ── MENTIONS LÉGALES ────────────────────────────────────────────
PAGES.push(trustPage({
  slug: 'mentions-legales', crumbLabel: 'Mentions légales',
  eyebrow: 'Légal',
  title: 'Mentions légales | Keystone OS',
  desc: `Mentions légales de Keystone OS : éditeur ${CO.editor} (SIRET ${CO.siret}), directeur de publication ${CO.director}, hébergement Cloudflare (Europe, WEUR) et Vercel.`,
  h1a: 'Mentions', h1b: 'légales.',
  lead: 'Les informations légales relatives à l’éditeur, à l’hébergement et à la propriété intellectuelle du site et du service Keystone OS.',
  body: `      <h3>Éditeur du site</h3>
${editorBlock}
      <h3>Hébergement</h3>
${hostingBlock}
      <h3>Propriété intellectuelle</h3>
      <p>L’ensemble des contenus présents sur Keystone OS (architecture, design, logique métier, assets visuels, nomenclature, marques) est la propriété exclusive de ${esc(CO.editor)}. Toute reproduction, même partielle, est interdite sans autorisation écrite préalable.</p>
      <h3>Responsabilité</h3>
      <p>${esc(CO.editor)} s’efforce d’assurer l’exactitude des informations diffusées. Les réponses générées par les moteurs d’IA tiers relèvent de la responsabilité de leurs éditeurs respectifs ; Keystone OS agit en qualité d’interface d’accès. L’éditeur ne saurait être tenu responsable d’un usage non conforme du service.</p>
      <h3>Données personnelles & cookies</h3>
      <p>Le traitement des données personnelles est décrit dans notre <a href="/confidentialite">Politique de confidentialité</a> et, pour les données traitées pour le compte de nos clients, dans notre <a href="/dpa">Accord de sous-traitance (DPA)</a>. Le site n’utilise pas de cookies publicitaires ni de traceurs tiers.</p>
      <h3>Médiation & litiges</h3>
      <p>En cas de différend, une solution amiable sera recherchée en priorité par écrit à <a href="mailto:${CO.email}">${CO.email}</a>. À défaut, les tribunaux français sont compétents et le droit français s’applique.</p>`,
  bandTitle: 'Besoin d’une précision légale ?',
  bandText: 'Contactez l’éditeur, nous répondons rapidement.',
}));

// ── POLITIQUE DE CONFIDENTIALITÉ ────────────────────────────────
PAGES.push(trustPage({
  slug: 'confidentialite', crumbLabel: 'Confidentialité',
  eyebrow: 'Confidentialité',
  title: 'Politique de confidentialité (RGPD) | Keystone OS',
  desc: 'Politique de confidentialité de Keystone OS : données collectées, finalités, base légale, durées de conservation, hébergement en Europe et vos droits RGPD (accès, rectification, effacement, portabilité).',
  h1a: 'Vos données', h1b: 'restent à vous.',
  lead: 'Comment Keystone OS collecte, utilise et protège les données — et comment exercer vos droits. Hébergement en Europe, conformité RGPD native, aucune revente.',
  body: `      <h3>Responsable de traitement</h3>
      <p>Pour les données liées à votre compte Keystone, le responsable de traitement est ${esc(CO.editor)} (${esc(ADDRESS_LINE)}). Pour les données que vous collectez via vos propres outils (formulaires, agents, QR), vous êtes responsable de traitement et Keystone agit comme sous-traitant — voir le <a href="/dpa">DPA</a>.</p>
      <h3>Données collectées & finalités</h3>
      <ul>
        <li><b>Compte & licence</b> : e-mail, identifiant de licence, préférences — pour fournir et sécuriser l’accès au service.</li>
        <li><b>Contenus que vous créez</b> : QR, formulaires, savoir des agents, notes — pour faire fonctionner les outils que vous activez.</li>
        <li><b>Données techniques minimales</b> : journaux de sécurité et de bon fonctionnement (pas de profilage publicitaire).</li>
      </ul>
      <h3>Base légale</h3>
      <p>Exécution du contrat (fourniture du service), intérêt légitime (sécurité, prévention des abus) et, le cas échéant, votre consentement.</p>
      <h3>Hébergement & sécurité</h3>
      <p>Les données sont hébergées en <b>Europe (Cloudflare, région WEUR)</b>, chiffrées au repos en <b>AES-256-GCM</b> et protégées par authentification à jeton <b>JWT signé</b>. Détails : <a href="/securite">page Sécurité</a>.</p>
      <h3>Durées de conservation</h3>
      <p>Les données sont conservées le temps de l’usage du service, puis supprimées. Sur demande d’effacement, la suppression est effective sous 72 heures. Vous pouvez fixer des durées de conservation propres à certains outils (par ex. réponses de formulaires).</p>
      <h3>Sous-traitants</h3>
      <p>La liste des sous-traitants (hébergement, e-mail transactionnel, moteurs d’IA) et leurs garanties figurent dans le <a href="/dpa">DPA</a>. Aucune donnée n’est vendue à des tiers.</p>
      <h3>Vos droits</h3>
      <ul>
        <li>Droit d’accès, de rectification et d’effacement.</li>
        <li>Droit à la <b>portabilité</b> de vos données (export structuré) — voir <a href="/reversibilite">Réversibilité</a>.</li>
        <li>Droit d’opposition et de limitation du traitement.</li>
      </ul>
      <p>Pour exercer vos droits : <a href="mailto:${CO.email}">${CO.email}</a>. Vous disposez aussi du droit d’introduire une réclamation auprès de la <a href="https://www.cnil.fr" target="_blank" rel="noopener">CNIL</a>.</p>
      <h3>Cookies & traceurs</h3>
      <p>Keystone n’utilise pas de cookies publicitaires, pas de Google Analytics et pas de traçage inter-sites. Le suivi proposé dans certains outils (par ex. Smart QR) est anonyme et conçu pour le respect du RGPD.</p>`,
  bandTitle: 'Une question sur vos données ?',
  bandText: 'Écrivez-nous pour exercer vos droits ou obtenir une précision.',
}));

// ── CGU ─────────────────────────────────────────────────────────
PAGES.push(trustPage({
  slug: 'cgu', crumbLabel: 'CGU',
  eyebrow: 'Légal',
  title: 'Conditions générales d’utilisation (CGU) | Keystone OS',
  desc: 'Conditions générales d’utilisation de Keystone OS : objet du service, accès, usage acceptable, disponibilité, propriété intellectuelle, responsabilité et résiliation.',
  h1a: 'Conditions générales', h1b: 'd’utilisation.',
  lead: 'Les règles d’usage du service Keystone OS. En utilisant le service, vous acceptez ces conditions.',
  body: `      <h3>1. Objet</h3>
      <p>Les présentes CGU régissent l’accès et l’utilisation de Keystone OS, suite d’outils métier modulaires éditée par ${esc(CO.editor)}.</p>
      <h3>2. Accès au service</h3>
      <p>L’accès se fait via une licence activée par e-mail, avec un essai gratuit de 7 jours ; au-delà, un abonnement actif est requis. Vous êtes responsable de la confidentialité de votre accès.</p>
      <h3>3. Usage acceptable</h3>
      <ul>
        <li>Ne pas utiliser le service à des fins illégales, trompeuses ou portant atteinte aux droits de tiers.</li>
        <li>Ne pas tenter de contourner la sécurité, de surcharger l’infrastructure ou d’en extraire massivement les données.</li>
        <li>Vous restez responsable des contenus que vous publiez et des données que vous collectez via vos outils.</li>
      </ul>
      <h3>4. Disponibilité</h3>
      <p>Le service est fourni en l’état ; le périmètre fonctionnel et la disponibilité peuvent évoluer. Nous nous efforçons d’assurer la continuité et de prévenir des changements majeurs.</p>
      <h3>5. Propriété intellectuelle</h3>
      <p>Le service et ses composants restent la propriété de ${esc(CO.editor)}. Vos contenus restent les vôtres ; voir <a href="/reversibilite">Réversibilité</a> pour leur export.</p>
      <h3>6. Responsabilité</h3>
      <p>Les réponses des moteurs d’IA sont des aides à la décision et doivent être vérifiées. L’éditeur ne saurait être tenu responsable d’un usage non conforme ou des décisions prises sur la seule base d’une sortie automatisée.</p>
      <h3>7. Résiliation</h3>
      <p>Vous pouvez cesser d’utiliser le service à tout moment et demander l’effacement de vos données (voir <a href="/confidentialite">Confidentialité</a>). L’éditeur peut suspendre un accès en cas de manquement aux présentes CGU.</p>
      <h3>8. Droit applicable</h3>
      <p>Droit français. Tout litige relève des tribunaux français à défaut de solution amiable.</p>`,
  bandTitle: 'Une question sur les conditions ?',
  bandText: 'Nous clarifions volontiers tout point des CGU.',
}));

// ── CGV ─────────────────────────────────────────────────────────
PAGES.push(trustPage({
  slug: 'cgv', crumbLabel: 'CGV',
  eyebrow: 'Légal',
  title: 'Conditions générales de vente (CGV) | Keystone OS',
  desc: 'Conditions générales de vente de Keystone OS : abonnements, paiement via Stripe, gestion via le portail client, droit de rétractation et résiliation. Essai gratuit de 7 jours.',
  h1a: 'Conditions générales', h1b: 'de vente.',
  lead: 'Les conditions applicables aux abonnements. Chaque offre débute par un essai gratuit de 7 jours ; au-delà, l’accès nécessite un abonnement actif.',
  body: `      <h3>1. Offres & abonnements</h3>
      <p>Keystone OS est proposé sous forme d’abonnements donnant accès à un ensemble d’outils. Les prix et le détail des offres sont indiqués sur la page <a href="/#plans">Tarifs</a>. Chaque abonnement débute par un essai gratuit de 7 jours.</p>
      <h3>2. Paiement</h3>
      <p>Les paiements sont opérés via <b>Stripe</b> (prestataire de paiement sécurisé). Aucune coordonnée bancaire complète n’est stockée par l’éditeur.</p>
      <h3>3. Gestion de l’abonnement</h3>
      <p>La mise à niveau, la modification et la résiliation se font depuis le portail client Stripe (prorata géré nativement). La résiliation prend effet à la fin de la période en cours.</p>
      <h3>4. Droit de rétractation</h3>
      <p>Pour les professionnels, le service numérique démarre dès l’activation. Les modalités de remboursement éventuel sont traitées au cas par cas par écrit à <a href="mailto:${CO.email}">${CO.email}</a>.</p>
      <h3>5. Réversibilité</h3>
      <p>En cas de résiliation, vous pouvez exporter vos données avant suppression — voir <a href="/reversibilite">Réversibilité</a>.</p>
      <h3>6. Droit applicable</h3>
      <p>Droit français. Tout litige relève des tribunaux français à défaut de solution amiable.</p>
      <div class="note"><b>Essai gratuit.</b> Chaque abonnement débute par 7 jours d’essai. Vous pouvez résilier à tout moment depuis le portail client Stripe.</div>`,
  bandTitle: 'Une question sur la facturation ?',
  bandText: 'Écrivez-nous, nous détaillons les offres et le fonctionnement.',
}));

// ── DPA & SOUS-TRAITANTS ────────────────────────────────────────
PAGES.push(trustPage({
  slug: 'dpa', crumbLabel: 'DPA & sous-traitants',
  eyebrow: 'Conformité RGPD',
  title: 'Accord de sous-traitance (DPA) & liste des sous-traitants | Keystone OS',
  desc: 'Accord de sous-traitance RGPD de Keystone OS et liste publique des sous-traitants ultérieurs : Cloudflare (Europe/WEUR), Vercel, Stripe, Resend et moteurs d’IA. Mesures de sécurité incluses.',
  h1a: 'Sous-traitance', h1b: 'des données, à découvert.',
  lead: 'Quand vous collectez des données via vos outils Keystone, vous en êtes le responsable de traitement et Keystone agit comme sous-traitant. Voici le cadre et la liste complète des sous-traitants ultérieurs.',
  body: `      <h3>Rôles</h3>
      <p><b>Vous</b> (client) êtes responsable de traitement des données que vous collectez auprès de vos clients finaux (réponses de formulaires, savoir d’agent, contacts). <b>${esc(CO.editor)}</b> agit comme <b>sous-traitant</b>, uniquement sur vos instructions et pour fournir le service.</p>
      <h3>Sous-traitants ultérieurs</h3>
      <table class="tbl">
        <thead><tr><th>Sous-traitant</th><th>Rôle</th><th>Localisation des données</th></tr></thead>
        <tbody>
          <tr><td>Cloudflare, Inc.</td><td>Exécution applicative & stockage (Workers, KV, D1)</td><td>Europe (région WEUR)</td></tr>
          <tr><td>Vercel, Inc.</td><td>Hébergement des pages publiques (front statique)</td><td>USA — pas de données personnelles des clients finaux</td></tr>
          <tr><td>Stripe</td><td>Traitement des paiements (abonnements)</td><td>UE / USA (clauses contractuelles types)</td></tr>
          <tr><td>Resend</td><td>Envoi d’e-mails transactionnels (formulaires, notifications)</td><td>UE / USA (clauses contractuelles types)</td></tr>
          <tr><td>Cloudflare Workers AI</td><td>Modèles d’IA souverains (usage courant)</td><td>Infrastructure Cloudflare</td></tr>
          <tr><td>Moteurs d’IA via votre clé (BYOK)</td><td>Modèles haut de gamme activés à votre initiative (ex. Anthropic)</td><td>Selon l’éditeur du moteur que vous choisissez</td></tr>
        </tbody>
      </table>
      <p class="updated">Cette liste est tenue à jour. Tout ajout de sous-traitant ultérieur fera l’objet d’une information préalable.</p>
      <h3>Mesures de sécurité</h3>
      <ul>
        <li>Chiffrement au repos AES-256-GCM ; transport chiffré (TLS).</li>
        <li>Authentification par jeton JWT signé, avec empreinte d’appareil.</li>
        <li>Cloisonnement des données par locataire (tenant).</li>
        <li>Hébergement européen (WEUR), aucune revente de données.</li>
      </ul>
      <h3>Durée & sort des données</h3>
      <p>Les données sont traitées le temps de la fourniture du service. En fin de contrat, vous pouvez les exporter (voir <a href="/reversibilite">Réversibilité</a>) ; elles sont ensuite supprimées, l’effacement sur demande étant effectif sous 72 heures.</p>
      <h3>Obtenir le DPA signé</h3>
      <p>Un accord de sous-traitance signé est disponible sur simple demande à <a href="mailto:${CO.email}">${CO.email}</a>.</p>`,
  bandTitle: 'Besoin du DPA signé ou de la liste à jour ?',
  bandText: 'Nous vous l’envoyons sur demande, avec les garanties associées.',
}));

// ── SÉCURITÉ (TRUST CENTER) ─────────────────────────────────────
PAGES.push(trustPage({
  slug: 'securite', crumbLabel: 'Sécurité',
  eyebrow: 'Centre de confiance',
  title: 'Sécurité & confiance — architecture, chiffrement, hébergement | Keystone OS',
  desc: 'Le centre de confiance de Keystone OS : chiffrement AES-256-GCM, authentification JWT, hébergement européen (Cloudflare WEUR), isolation des données, suppression sous 72h et signalement de vulnérabilités.',
  h1a: 'La sécurité', h1b: 'documentée, pas promise.',
  lead: 'Tout ce qui protège vos données chez Keystone OS, réuni en un endroit : architecture, chiffrement, hébergement souverain et procédure de signalement.',
  body: `      <h3>Hébergement souverain</h3>
      <p>Vos données résident en <b>Europe</b>, sur l’infrastructure <b>Cloudflare (région WEUR)</b> : exécution applicative (Workers) et stockage (KV, D1). Les pages publiques sont servies via Vercel et ne contiennent pas de données personnelles de vos clients finaux.</p>
      <h3>Chiffrement</h3>
      <ul>
        <li><b>Au repos</b> : AES-256-GCM sur les données sensibles (dont les clés d’API que vous confiez).</li>
        <li><b>En transit</b> : TLS de bout en bout.</li>
      </ul>
      <h3>Authentification & accès</h3>
      <ul>
        <li>Jetons <b>JWT signés</b> (durée de vie limitée) avec empreinte d’appareil.</li>
        <li>Surfaces d’administration non indexées et isolées.</li>
        <li>Cloisonnement des données par locataire (tenant).</li>
      </ul>
      <h3>Moteurs d’IA</h3>
      <p>Stratégie hybride et transparente : modèles souverains exécutés sur Cloudflare Workers AI pour l’usage courant, et modèles haut de gamme via <b>votre propre clé (BYOK)</b> lorsque vous le décidez. Les agents répondent uniquement depuis le savoir que vous validez — par conception, pas d’invention.</p>
      <h3>Conservation & effacement</h3>
      <p>Durées de conservation paramétrables selon les outils ; effacement sur demande effectif sous <b>72 heures</b>. Aucune revente de données, aucun traceur publicitaire.</p>
      <h3>Réversibilité</h3>
      <p>Vous pouvez récupérer vos données à tout moment dans un format structuré — voir <a href="/reversibilite">Réversibilité</a>.</p>
      <h3>Signaler une vulnérabilité</h3>
      <p>Vous pensez avoir trouvé une faille ? Écrivez à <a href="mailto:${CO.email}">${CO.email}</a>. Notre politique est publiée dans <a href="/.well-known/security.txt">/.well-known/security.txt</a>. Nous accueillons les signalements responsables et nous engageons à répondre.</p>
      <div class="note"><b>Transparence.</b> Keystone OS n’affiche pas de certification (ex. ISO 27001, SOC 2) qu’il ne détient pas. Les mesures ci-dessus reflètent l’architecture réellement en place.</div>`,
  bandTitle: 'Une question de sécurité ou un audit ?',
  bandText: 'Écrivez-nous : nous documentons volontiers notre architecture.',
}));

// ── RÉVERSIBILITÉ ───────────────────────────────────────────────
PAGES.push(trustPage({
  slug: 'reversibilite', crumbLabel: 'Réversibilité',
  eyebrow: 'Portabilité des données',
  title: 'Réversibilité & export de vos données (RGPD Art. 20) | Keystone OS',
  desc: 'Comment récupérer et exporter vos données depuis Keystone OS dans un format structuré, sans verrouillage propriétaire. Droit à la portabilité RGPD (Art. 20), formats, délais et suppression définitive.',
  h1a: 'Vos données', h1b: 'sortent quand vous voulez.',
  lead: 'Pas de verrouillage : vous pouvez récupérer vos données à tout moment, dans un format réutilisable. C’est un engagement, pas une option cachée.',
  body: `      <h3>Le principe</h3>
      <p>Conformément au droit à la portabilité (RGPD, article 20), vous pouvez obtenir une copie structurée des données que vous avez créées dans Keystone OS, et les réutiliser ailleurs.</p>
      <h3>Ce que vous pouvez exporter</h3>
      <ul>
        <li>Réponses de formulaires (Key Form) et contacts collectés.</li>
        <li>Contenus de vos outils : savoir des agents, QR et leurs destinations, notes.</li>
        <li>Paramètres de licence et de configuration utiles à une reprise.</li>
      </ul>
      <h3>Formats</h3>
      <p>Données structurées en <b>JSON</b> et/ou <b>CSV</b> selon les outils ; les fichiers que vous avez importés vous sont restitués tels quels.</p>
      <h3>Comment procéder</h3>
      <p>Certaines exports sont disponibles directement dans l’outil concerné. Pour un export complet de compte, écrivez à <a href="mailto:${CO.email}">${CO.email}</a> : nous fournissons l’archive sous un délai raisonnable (objectif sous 30 jours, généralement bien moins).</p>
      <h3>Suppression définitive</h3>
      <p>Après export, ou sur simple demande, vos données sont supprimées de manière définitive — effacement effectif sous <b>72 heures</b>.</p>
      <div class="note"><b>Engagement anti-lock-in.</b> Vos contenus vous appartiennent. Quitter Keystone ne doit jamais signifier perdre votre travail.</div>`,
  bandTitle: 'Besoin d’un export maintenant ?',
  bandText: 'Demandez-le par e-mail, nous préparons votre archive.',
}));

// ── CHANGELOG (depuis DOC_CHANGELOG — source unique partagée avec l'app) ──
const changelogBody = DOC_CHANGELOG.map(c =>
  `      <h3>${esc(c.date)}</h3>\n      <ul>\n${c.items.map(i => `        <li>${esc(i)}</li>`).join('\n')}\n      </ul>`
).join('\n');
PAGES.push(trustPage({
  slug: 'changelog', crumbLabel: 'Nouveautés',
  eyebrow: 'Nouveautés',
  title: 'Nouveautés & journal des mises à jour | Keystone OS',
  desc: 'Le fil des nouveautés de Keystone OS : fonctionnalités ajoutées et améliorations, les plus récentes en tête. Un produit qui évolue chaque semaine.',
  h1a: 'Ce qui change,', h1b: 'au fil des semaines.',
  lead: 'Keystone évolue en continu. Voici les nouveautés visibles côté utilisateur, les plus récentes en tête.',
  body: `${changelogBody}
      <div class="note"><b>Un produit vivant.</b> Cette page reflète les évolutions côté utilisateur. Une idée, un besoin ? Vos retours orientent la suite — voir la <a href="/roadmap">feuille de route</a>.</div>`,
  bandTitle: 'Une idée de fonctionnalité ?',
  bandText: 'Dites-nous ce qui vous manque — beaucoup de nouveautés viennent de là.',
}));

// ── ROADMAP (éditoriale, volontairement haut-niveau) ──
PAGES.push(trustPage({
  slug: 'roadmap', crumbLabel: 'Feuille de route',
  eyebrow: 'Feuille de route',
  title: 'Feuille de route — où va Keystone OS | Keystone OS',
  desc: 'La direction de Keystone OS : ce qui est disponible aujourd’hui, ce qui est en cours et ce que nous étudions. Un produit avec un cap, à l’écoute de ses utilisateurs.',
  h1a: 'Où va', h1b: 'Keystone OS.',
  lead: 'Keystone est en développement actif. Voici notre cap — volontairement transparent, sans dates fermes : la priorité suit vos retours.',
  body: `      <h3>Disponible aujourd’hui</h3>
      <ul>
        <li>Agent IA qui répond depuis votre savoir validé (chat & voix), par lien ou QR.</li>
        <li>QR dynamiques, formulaires intelligents, réécriture & correction de textes.</li>
        <li>Audit web et visibilité dans les IA (GEO), publication multi-réseaux, notes en constellation.</li>
        <li>Compte souverain : données en Europe, chiffrement, export et effacement.</li>
      </ul>
      <h3>En cours</h3>
      <ul>
        <li>Transparence & confiance : pages publiques, avis clients, journal des nouveautés.</li>
        <li>Améliorations continues de performance, d’accessibilité et de fiabilité.</li>
        <li>Affinage des moteurs IA et de la qualité des réponses.</li>
      </ul>
      <h3>À l’étude</h3>
      <ul>
        <li>Nouvelles expériences pilotées par QR et nouveaux packs métier.</li>
        <li>Connecteurs et automatisations supplémentaires entre les outils.</li>
        <li>Options d’équipe pour les structures à plusieurs mains.</li>
      </ul>
      <div class="note"><b>Vos retours décident.</b> Cette feuille de route n’est pas gravée dans le marbre : ce qui compte le plus pour vous passe devant. Écrivez-nous, et suivez les livraisons sur le <a href="/changelog">journal des nouveautés</a>.</div>`,
  bandTitle: 'Une priorité à nous souffler ?',
  bandText: 'Votre métier a des besoins précis — dites-nous, ça oriente vraiment la suite.',
}));

// ─────────────────────────────────────────────────────────────
// FICHIERS LISIBLES PAR LES IA
// ─────────────────────────────────────────────────────────────
const llmsTxt = `# Keystone OS

> OS modulaire et souverain qui réunit les outils métier des TPE, artisans, commerçants et indépendants dans un seul cockpit. Hébergé en Europe, conforme RGPD, sans revente de données.

Édité par ${CO.editor} (${CO.form}, ${CO.director}). SIRET ${CO.siret} · SIREN ${CO.siren}. Siège : ${ADDRESS_LINE}. Contact : ${CO.email}.

Important : Keystone OS est édité par ${CO.editor} à ${CO.city} (${CO.region}). À ne pas confondre avec d'autres sociétés françaises nommées « Keystone ». Registre officiel : ${CO.registry}

## Identité & confiance
- [À propos / éditeur](${ORIGIN}/a-propos) : qui édite Keystone OS, mission, infrastructure souveraine.
- [Mentions légales](${ORIGIN}/mentions-legales) : éditeur, hébergement, propriété intellectuelle.
- [Sécurité (centre de confiance)](${ORIGIN}/securite) : chiffrement AES-256-GCM, JWT, hébergement Cloudflare WEUR.
- [Politique de confidentialité](${ORIGIN}/confidentialite) : données, finalités, droits RGPD.
- [Sous-traitants & DPA](${ORIGIN}/dpa) : liste publique des sous-traitants, mesures de sécurité.
- [Réversibilité des données](${ORIGIN}/reversibilite) : export structuré, anti-lock-in (RGPD Art. 20).
- [Registre officiel des entreprises](${CO.registry}) : fiche légale de l'éditeur.

## Outils
${TOOLS.map(([s, n, d]) => `- [${n}](${ORIGIN}/outils/${s}) : ${d}`).join('\n')}

## Aide
- [FAQ](${ORIGIN}/faq) : toutes les questions sur Keystone OS et ses outils.
- [Cas d'usage par métier](${ORIGIN}/#metiers) : immobilier, restaurants, commerçants, artisans, etc.
`;

const llmsFull = `# Keystone OS — dossier complet

## En une phrase
Keystone OS est un système d'exploitation modulaire pour TPE et indépendants : il réunit des outils métier (agent IA, QR dynamiques, formulaires, audit web et visibilité IA, réseaux sociaux, réécriture, table ronde d'idées, notes) dans un cockpit unique, où l'on active seulement ce dont on a besoin.

## Éditeur (identité univoque)
- Produit : ${CO.product}
- Éditeur : ${CO.editor} — ${CO.form} (${CO.director})
- SIRET : ${CO.siret} · SIREN : ${CO.siren}
- Siège : ${ADDRESS_LINE}
- Contact : ${CO.email} · ${CO.telHuman}
- Registre officiel : ${CO.registry}
- Note de désambiguïsation : ne pas confondre avec d'autres entités françaises nommées « Keystone » (le nom est répandu). La fiche au registre officiel ci-dessus fait foi.

## Souveraineté, hébergement & sécurité
- Données hébergées en Europe sur Cloudflare (région WEUR) : exécution (Workers) et stockage (KV, D1).
- Chiffrement au repos AES-256-GCM ; transport TLS.
- Authentification par jeton JWT signé avec empreinte d'appareil ; cloisonnement par locataire.
- Aucune revente de données, pas de Google Analytics, pas de traceur publicitaire.
- Effacement sur demande effectif sous 72 heures.
- Réversibilité : export structuré (JSON/CSV) des données, anti-lock-in (RGPD Art. 20).
- IA : stratégie hybride — modèles souverains sur Cloudflare Workers AI pour l'usage courant, modèles haut de gamme via la clé de l'utilisateur (BYOK). Les agents répondent uniquement depuis un savoir validé (pas d'invention).

## Statut
Service actif par abonnement, avec un essai gratuit de 7 jours. Le périmètre évolue régulièrement.

## Outils (détail)
${TOOLS.map(([s, n, d]) => `### ${n}\n${d}\nPage : ${ORIGIN}/outils/${s}`).join('\n\n')}

## Pages de confiance
- À propos : ${ORIGIN}/a-propos
- Mentions légales : ${ORIGIN}/mentions-legales
- Sécurité : ${ORIGIN}/securite
- Confidentialité : ${ORIGIN}/confidentialite
- Sous-traitants & DPA : ${ORIGIN}/dpa
- Réversibilité : ${ORIGIN}/reversibilite
- CGU : ${ORIGIN}/cgu
- CGV : ${ORIGIN}/cgv
- FAQ : ${ORIGIN}/faq
`;

const securityTxt = `# Politique de divulgation de vulnérabilités — Keystone OS
Contact: mailto:${CO.email}
Expires: 2027-06-30T00:00:00.000Z
Preferred-Languages: fr, en
Canonical: ${ORIGIN}/.well-known/security.txt
Policy: ${ORIGIN}/securite
`;

const humansTxt = `/* TEAM */
  Éditeur : ${CO.editor} (${CO.form})
  Responsable : ${CO.director}
  Contact : ${CO.email}
  Lieu : ${CO.city}, ${CO.country}

/* SITE */
  Produit : ${CO.product}
  Souveraineté : hébergé en Europe (Cloudflare WEUR), conforme RGPD
  Stack : Cloudflare Workers/KV/D1, Vercel, JavaScript
  Registre : ${CO.registry}
`;

// ─────────────────────────────────────────────────────────────
// ÉCRITURE
// ─────────────────────────────────────────────────────────────
const SLUGS = ['a-propos', 'mentions-legales', 'confidentialite', 'cgu', 'cgv', 'dpa', 'securite', 'reversibilite', 'changelog', 'roadmap'];
PAGES.forEach((html, i) => writeFileSync(resolve(ROOT, `${SLUGS[i]}.html`), html, 'utf8'));

writeFileSync(resolve(ROOT, 'llms.txt'), llmsTxt, 'utf8');
writeFileSync(resolve(ROOT, 'llms-full.txt'), llmsFull, 'utf8');
writeFileSync(resolve(ROOT, 'humans.txt'), humansTxt, 'utf8');
mkdirSync(resolve(ROOT, '.well-known'), { recursive: true });
writeFileSync(resolve(ROOT, '.well-known', 'security.txt'), securityTxt, 'utf8');

console.log(`OK -> ${PAGES.length} pages confiance (${SLUGS.join(', ')}) + llms.txt + llms-full.txt + humans.txt + .well-known/security.txt`);
console.log('   ⚠ sitemap : lancer "npm run gen-verticals" pour rafraîchir (proprietaire unique).');
