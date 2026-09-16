/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Générateur de contexte commercial pour IA externe
   ───────────────────────────────────────────────────────────────
   BUT : produire un Markdown lisible que l'on COLLE dans une IA
   (GPT, Claude…) qui ne peut pas visiter le site, pour qu'elle
   « comprenne » Keystone OS comme un bon commercial — sans capture
   d'écran, sans accès au code.

   SOURCES (déjà écrites, client-safe) — AUCUN scraping runtime,
   AUCUN secret, AUCune archi interne :
     • K_STORE_ASSETS/HELP/<appId>.json  (title/tldr/key_points/faq/guide)
     • app/lib/keystone-doc.js           (chapeau produit + formules + nouveautés)
     • INTERACTIONS / LIVING_LAYER ci-dessous (savoir transverse, écrit à la main)

   SORTIES (dossier _ai-context/, NON servi par l'app) :
     • _ai-context/KEYSTONE_OS_CONTEXT.md   → à coller dans GPT (priorité)
     • _ai-context/apps/<slug>.md           → une fiche de vente par app
                                               (à charger dans le Kortex du Smart Agent)

   Lancement :  node scripts/gen-sales-context.mjs
   ═══════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HELP = resolve(ROOT, 'K_STORE_ASSETS', 'HELP');
const OUT = resolve(ROOT, '_ai-context');

// ── Catalogue VENDABLE (ordre = grille publique d'index.html) ──────
//  VEFA (O-IMM-*) et outils internes (Admin, Analytics…) EXCLUS
//  volontairement. `restricted` = existe mais pas encore en vente publique.
//  ⚠ 14 applications : cette liste DOIT suivre app/lib/pricing.js (APP_TIER).
//  Ajouter une app = une entrée ici + son K_STORE_ASSETS/HELP/<appId>.json.
const APPS = [
  { app: 'A-COM-001', slug: 'smart-qr' },
  { app: 'A-COM-002', slug: 'brief-prod' },
  { app: 'A-COM-003', slug: 'brainstorming' },
  { app: 'A-COM-004', slug: 'key-form' },
  { app: 'A-COM-005', slug: 'ghost-writer' },
  { app: 'O-AGT-001', slug: 'smart-agent' },
  { app: 'O-SOC-001', slug: 'social-manager' },
  { app: 'O-GEO-001', slug: 'sentinel' },
  { app: 'O-Keyn-001', slug: 'keynapse' },
  { app: 'O-SEC-001', slug: 'missive' },
  { app: 'O-BRD-001', slug: 'key-brand' },
  { app: 'O-NET-001', slug: 'network' },
  { app: 'O-BOK-001', slug: 'book' },
  { app: 'O-DSK-001', slug: 'desk' },
];

// ── Savoir TRANSVERSE (ne vit dans aucun HELP isolé) ───────────────
const LIVING_LAYER = `Le **Living Layer** est une barre ambiante en haut du tableau de bord. \
Au lieu d'un dashboard figé, il fait remonter en continu de **vrais signaux métier** issus des outils actifs : \
les questions auxquelles le Smart Agent n'a pas su répondre (trous de savoir à combler), les réponses reçues, \
les rappels Keynapse qui arrivent à échéance, les alertes de visibilité Sentinel, le suivi des QR les plus scannés. \
Une alerte importante reste « collante » tant qu'elle n'est pas traitée. \
C'est ce qui transforme Keystone d'une boîte à outils en un **poste de pilotage** qui dit à l'utilisateur quoi faire ensuite.`;

// Gouvernance : VOLONTAIREMENT haut-niveau. Aucun détail d'admin/back-office,
// aucun mécanisme technique, aucun secret. Juste ce qu'un commercial doit pouvoir dire.
const GOVERNANCE = `Ce que Keystone garantit côté confiance — de quoi rassurer un prospect, sans entrer dans la technique :

**RGPD & données.** Keystone est conçu **local d'abord** : les données métier et les clés de l'utilisateur restent sur son appareil ; seul le profil (prénom, photo, préférences) est synchronisé et **chiffré**. Un **droit à l'oubli** (purge des données) est disponible. L'éditeur est une **société française identifiée** (Protein Keystone Studio). Les mentions légales, la politique de confidentialité et une page sécurité sont publiées. *Prévu à la feuille de route : un export RGPD complet en un clic ; aujourd'hui, chaque outil permet déjà d'exporter ses propres données.*

**Avis & commentaires.** Chaque outil peut recevoir une **note (étoiles)** de ses utilisateurs. Les retours sont agrégés de façon **anonyme** — aucune donnée nominative n'est exposée — et servent à prioriser les améliorations.

**Posture.** L'IA est **incluse dans le prix de l'application** : une enveloppe mensuelle de conversations, annoncée à l'achat, qui se remet à zéro chaque mois — pas de revente de données, pas de facture surprise à l'usage. Beaucoup d'actions ne consomment rien (lecture vocale, dictée, correcteur d'orthographe, tout ce qui n'appelle pas l'IA), et les trois applications gratuites n'utilisent pas d'IA du tout. Souveraineté et clarté sur les données sont des arguments de vente à part entière.

_(Le back-office d'administration — licences, réglages internes — est hors de ce document : il ne concerne ni le client ni un plan marketing.)_`;

const INTERACTIONS = `Les outils Keystone ne sont pas des silos : ils se passent le relais. Les enchaînements clés à connaître pour vendre :

- **La chaîne de contenu** : *Brainstorming* fait émerger les idées et tranche les angles → *Ghost Writer* rédige et met en forme → *Social Manager* diffuse sur les réseaux. Une idée devient une publication sans changer d'outil.
- **Du physique au conversationnel** : un *Smart Dynamic QR* posé sur une vitrine, un produit ou une chambre d'hôtel ouvre directement un *Smart Agent* (ou un QR Concierge) qui répond au visiteur — sans app à installer, à l'écrit ou à la voix.
- **La visibilité qui remonte** : *Sentinel* surveille la présence web et l'apparition dans les réponses des IA, et pousse ses alertes dans le *Living Layer*.
- **La relation qui relance** : depuis une fiche contact de *networK*, « Continuer avec… » ouvre une *Missive*, un *Brief Prod* ou le *Smart Agent* **avec le contact déjà en contexte** — on ne ressaisit rien.
- **La boucle éditoriale** : un numéro bouclé dans *desK* devient un livre feuilletable dans *booK* ; en cours de route, la copie d'un article part en relecture dans *Ghost Writer* et son contributeur peut rejoindre *networK*.
- **Le socle commun** : identité de marque (*Key Brand*), collecte (*Key Form*), notes et rappels (*Keynapse*) et transmission de secrets (*Missive*) servent tous les autres outils. La marque définie dans Key Brand peut habiller les supports produits ailleurs.

Le tout dans **un seul espace**, une seule connexion, un seul abonnement — c'est l'argument central face à quelqu'un qui jongle avec 6 abonnements séparés.`;

// FAQ à OMETTRE entièrement : purement technique/routage interne, sans
// valeur commerciale. Clé = appId, valeur = fragments de question à exclure.
const FAQ_OMIT = {
  'A-COM-003': ['Quels moteurs IA sont utilisés'], // routage interne des 9 agents
};

// ── Sanitization : neutralise l'infra/stack (le client & GPT n'en ont ─
//    pas besoin). Denylist EXPLICITE, appliquée à tout l'export. Étendre
//    ici si une nouvelle fiche d'aide expose un détail technique.
const scrub = (text) => String(text)
  // chemins d'API dans des `code spans` → lien générique
  .replace(/`[^`]*\/api\/[^`]*`/gi, 'un lien sécurisé')
  .replace(/\/api\/[a-z0-9/_{}.-]+/gi, 'un lien sécurisé')
  // combinaisons fréquentes (avant les tokens isolés, pour un rendu lisible)
  .replace(/en base64 dans D1 \(Cloudflare EU\)/gi, 'dans une base hébergée en Europe')
  .replace(/Mistral Small [0-9.]+\s*[0-9]*B?\s*sur Cloudflare Workers AI/gi, 'un moteur IA souverain')
  .replace(/Claude BYOK/gi, 'un moteur IA haut de gamme (via votre propre clé)')
  // on NE masque QUE le modèle précis + l'infra (révèle la stack) ; les marques
  // d'IA restent quand ce sont des clés que le client peut brancher (argument de vente).
  .replace(/Cloudflare Workers AI/gi, 'infrastructure IA souveraine')
  .replace(/Workers AI/gi, 'infrastructure IA souveraine')
  .replace(/Cloudflare/gi, 'infrastructure souveraine (Europe)')
  .replace(/\bD1\b/g, 'base hébergée en Europe')
  .replace(/\bJWT\b/gi, 'authentification sécurisée')
  .replace(/Mistral Small [0-9.]+\s*[0-9]*B?/gi, 'un moteur IA souverain')
  .replace(/BYOK multi-moteur \(votre clé\)/gi, 'Multi-moteur IA — branchez votre propre clé')
  .replace(/\bclés?\s+BYOK\b/gi, 'clé')
  .replace(/\bBYOK\b/g, 'votre propre clé')
  .replace(/en base64/gi, '')
  .replace(/\bbase64\b/gi, '')
  .replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:])/g, '$1');

// ── Utilitaires ────────────────────────────────────────────────────
const htmlToMd = (html) => String(html)
  .replace(/<h[1-6][^>]*>/gi, '\n### ').replace(/<\/h[1-6]>/gi, '\n')
  .replace(/<span[^>]*ks-doc-cl-date[^>]*>/gi, '\n#### ').replace(/<\/span>/gi, '\n')
  .replace(/<\/(p|div|section)>/gi, '\n\n')
  .replace(/<li[^>]*>/gi, '- ')
  .replace(/<\/li>/gi, '\n')
  .replace(/<\/(ul|ol)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<sup>([^<]*)<\/sup>/gi, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '…').replace(/&eacute;/g, 'é')
  .replace(/^[ \t]+/gm, '')       // dégage l'indentation des template strings (sinon = bloc de code MD)
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const loadHelp = (id) => {
  try { return JSON.parse(readFileSync(resolve(HELP, id + '.json'), 'utf8')); }
  catch { return null; }
};

// ── Plans : LUS depuis la landing (index.html = source de vérité prix) ─
// ⚠ La variable s'appelle PLANS_V2 depuis la refonte du tunnel de vente
// (août 2026). Tant qu'on lisait `const PLANS`, la section sortait VIDE et
// le document envoyait une IA vendre un modèle tarifaire qui n'existe plus.
function parsePlans() {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const PLANS_V2\s*=\s*\[([\s\S]*?)\n\s*\];/);
  if (!m) return [];
  const re = /\{name:"([^"]+)",\s*tag:"([^"]*)",\s*price:"([^"]+)"[\s\S]*?forWho:"([^"]*)"[\s\S]*?anchor:"([^"]*)"[\s\S]*?feats:\[([\s\S]*?)\]\s*\}/g;
  const plans = [];
  let p;
  while ((p = re.exec(m[1])) !== null) {
    const feats = [...p[6].matchAll(/"([^"]+)"/g)].map(f => f[1].replace(/<\/?strong>/g, '**'));
    plans.push({ name: p[1], tag: p[2], price: p[3], forWho: p[4], anchor: p[5], feats });
  }
  return plans;
}

// ── Les prix des 14 applications, LUS depuis app/lib/pricing.js ────
// La source de vérité runtime, pas une recopie qui dérive.
async function parseTiers() {
  const mod = await import(pathToFileURL(resolve(ROOT, 'app', 'lib', 'pricing.js')).href);
  const { TIERS, APP_TIER } = mod;
  const byTier = new Map();
  for (const [appId, tier] of Object.entries(APP_TIER)) {
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push(appId);
  }
  return { TIERS, byTier };
}

async function buildPlansSection() {
  const plans = parsePlans();
  const { TIERS, byTier } = await parseTiers();
  const nameOf = (appId) => { const h = loadHelp(appId); return h ? h.title : appId; };

  const out = [];
  out.push('## Les offres — comment Keystone se vend');
  out.push('');
  out.push('Trois manières d\'entrer, affichées publiquement sur le site. ' +
    '**Il n\'y a pas de période d\'essai** : trois applications sont gratuites *pour toujours*, ' +
    'et les autres s\'achètent **à l\'unité** ou en bloc. Chaque application payante apporte son ' +
    'enveloppe de **conversations IA** mensuelles ; plusieurs applications, leurs enveloppes s\'additionnent. ' +
    'Un client qui préfère ne pas dépendre de cette enveloppe peut brancher **sa propre clé** ' +
    '(Claude, GPT, Mistral…) : l\'usage devient illimité et le coût se règle chez son fournisseur.');
  out.push('');
  for (const pl of plans) {
    const tag = pl.tag ? ` — _${pl.tag}_` : '';
    out.push(`### ${pl.name} · ${pl.price}/mois${tag}`);
    if (pl.forWho) out.push(`_${pl.forWho}_ (${pl.anchor})`);
    out.push('');
    for (const f of pl.feats) out.push(`- ${f}`);
    out.push('');
  }
  out.push('### Le détail application par application');
  out.push('');
  out.push('| Palier | Prix/mois | Conversations IA incluses | Applications |');
  out.push('|---|---|---|---|');
  for (const t of ['FREE', 'ESSENTIEL', 'PRO', 'DEPLOIEMENT']) {
    const apps = byTier.get(t);
    if (!apps || !apps.length) continue;
    const T = TIERS[t];
    const conv = T.conversations ? `${T.conversations}` : 'sans IA';
    out.push(`| ${T.label} | ${T.price ? T.price + ' €' : '0 €'} | ${conv} | ${apps.map(nameOf).join(', ')} |`);
  }
  const OS = TIERS.OS;
  out.push(`| ${OS.label} | ${OS.price} € | ${OS.conversations} | les 14, nouveautés comprises |`);
  out.push('');
  return out.join('\n');
}

// ── Bloc « fonctionnement » d'une app depuis son HELP ──────────────
function appSection(entry) {
  const h = loadHelp(entry.app);
  if (!h) return `## ${entry.app}\n\n_Fiche d'aide introuvable — à documenter._\n`;
  const flag = entry.restricted ? ' _(pas encore en vente publique)_' : '';
  const lines = [];
  lines.push(`## ${h.title}${flag}`);
  lines.push('');
  if (h.tldr) { lines.push(`**En une phrase.** ${h.tldr}`); lines.push(''); }
  if (Array.isArray(h.key_points) && h.key_points.length) {
    lines.push('**Comment ça marche / ce que ça fait :**');
    for (const p of h.key_points) lines.push(`- ${p}`);
    lines.push('');
  }
  const omit = FAQ_OMIT[entry.app] || [];
  const faq = Array.isArray(h.faq) ? h.faq.filter(f => !omit.some(m => f.q.includes(m))) : [];
  if (faq.length) {
    lines.push('**Questions fréquentes (arguments prêts à l\'emploi) :**');
    for (const f of faq) { lines.push(`- **${f.q}** ${f.a}`); }
    lines.push('');
  }
  if (h.guide && h.guide.body) {
    lines.push('**Le contexte, pour bien en parler :**');
    lines.push('');
    lines.push(htmlToMd(h.guide.body));
    lines.push('');
  }
  return lines.join('\n');
}

// ── Chapeau produit + formules + nouveautés depuis keystone-doc.js ──
async function productDoc() {
  const mod = await import(pathToFileURL(resolve(ROOT, 'app', 'lib', 'keystone-doc.js')).href);
  // keystoneDocHTML() rend tout le guide (rubriques + changelog) en HTML.
  const html = typeof mod.keystoneDocHTML === 'function' ? mod.keystoneDocHTML() : '';
  return htmlToMd(html);
}

// ── Assemblage de la SORTIE B (le fichier à coller dans GPT) ────────
async function buildContext() {
  const doc = await productDoc();
  const parts = [];
  parts.push('# Keystone OS — Contexte pour assistant IA');
  parts.push('');
  parts.push('> Ce document décrit Keystone OS en langage commercial, pour une IA qui ne peut pas visiter le site. ' +
    'Il ne contient **aucun secret, aucune donnée technique interne, et rien du back-office d\'administration**. ' +
    'Objectif : que tu puisses conseiller, argumenter et bâtir un plan marketing comme un bon commercial qui connaît le produit.');
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('## Le produit, ses formules et son fonctionnement');
  parts.push('');
  parts.push('_(Repris du guide utilisateur officiel de Keystone.)_');
  parts.push('');
  parts.push(doc);
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(await buildPlansSection());
  parts.push('---');
  parts.push('');
  parts.push('## Gouvernance, RGPD & confiance');
  parts.push('');
  parts.push(GOVERNANCE);
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('## Le Living Layer');
  parts.push('');
  parts.push(LIVING_LAYER);
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('## Comment les outils travaillent ensemble');
  parts.push('');
  parts.push(INTERACTIONS);
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('## Le catalogue d\'applications');
  parts.push('');
  for (const e of APPS) { parts.push(appSection(e)); parts.push('---'); parts.push(''); }
  return parts.join('\n');
}

// ── Assemblage de la SORTIE A (une fiche par app pour le Smart Agent) ─
function buildAppFile(entry) {
  const h = loadHelp(entry.app);
  const head = `<!-- Fiche de vente Keystone OS — à ingérer dans le coffre Kortex du Smart Agent -->\n`;
  return head + '\n# ' + (h ? h.title : entry.app) + '\n\n' + appSection(entry).replace(/^## .*\n/, '');
}

// ── Run ────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
mkdirSync(resolve(OUT, 'apps'), { recursive: true });

const context = scrub(await buildContext());
writeFileSync(resolve(OUT, 'KEYSTONE_OS_CONTEXT.md'), context, 'utf8');
console.log('✓ _ai-context/KEYSTONE_OS_CONTEXT.md  (' + context.length + ' car.)');

let n = 0;
for (const e of APPS) {
  writeFileSync(resolve(OUT, 'apps', e.slug + '.md'), scrub(buildAppFile(e)), 'utf8');
  n++;
}
console.log('✓ _ai-context/apps/  (' + n + ' fiches app)');
console.log('\nTerminé. Colle _ai-context/KEYSTONE_OS_CONTEXT.md dans GPT.');
