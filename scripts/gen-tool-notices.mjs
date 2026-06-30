#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — gen-tool-notices
   ─────────────────────────────────────────────────────────────
   Génère, DANS la landing (index.html), le contenu STATIQUE des
   notices d'outils (à quoi ça sert + comment ça marche + FAQ) à
   partir de la SOURCE UNIQUE = /K_STORE_ASSETS/HELP/<appId>.json.

   Ce contenu est crawlable par Google ET les IA (GEO/AEO) ; il est
   masqué visuellement (#toolNotices[hidden]) et affiché en modale
   au clic sur une carte de la grille « Vos outils ».

   Émet aussi un JSON-LD FAQPage agrégeant toutes les FAQ outils.

   Le tout est inséré entre les marqueurs :
     <!-- TOOL-NOTICES:START -->  …  <!-- TOOL-NOTICES:END -->

   Usage : npm run gen-notices   (ou node scripts/gen-tool-notices.mjs)
   À relancer après toute édition d'une notice HELP, puis push Vercel.
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HELP = resolve(ROOT, 'K_STORE_ASSETS', 'HELP');
const INDEX = resolve(ROOT, 'index.html');
const ORIGIN = 'https://protein-keystone.com';

// Ordre = celui de la grille TOOLS dans index.html (cartes publiques).
const TOOLS = [
  'A-COM-001', // Smart Dynamic QR
  'A-COM-002', // Brief Prod
  'A-COM-003', // Brainstorming
  'A-COM-004', // Key Form
  'A-COM-005', // Ghost Writer
  'O-AGT-001', // Smart Agent
  'O-SOC-001', // Social Manager
  'O-GEO-001', // Sentinel
  'O-Keyn-001',// Keynapse
  'O-SEC-001', // Missive
];

const START = '<!-- TOOL-NOTICES:START -->';
const END   = '<!-- TOOL-NOTICES:END -->';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripNum = (s) => String(s).replace(/^\s*\d+[.)]\s*/, '');

function noticeHTML(appId, j) {
  const steps = (j.key_points || []).map(k => `        <li>${esc(stripNum(k))}</li>`).join('\n');
  const faq = (j.faq || []).map(f =>
    `        <details><summary>${esc(f.q)}</summary><div class="tn-a">${esc(f.a)}</div></details>`
  ).join('\n');
  return `    <article class="tn" id="tn-${esc(appId)}">
      <h3 class="tn-title">${esc(j.title)}</h3>
      <p class="tn-tldr">${esc(j.tldr || '')}</p>
${steps ? `      <h4 class="tn-h">Comment ça marche</h4>\n      <ol class="tn-steps">\n${steps}\n      </ol>\n` : ''}${faq ? `      <h4 class="tn-h">Questions fréquentes</h4>\n      <div class="tn-faq">\n${faq}\n      </div>\n` : ''}    </article>`;
}

function faqPageJSONLD(all) {
  const mainEntity = all.flatMap(({ j }) => (j.faq || []).map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })));
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${ORIGIN}/#faq-outils`,
    inLanguage: 'fr-FR',
    mainEntity,
  };
  // < : empêche un éventuel </script> dans le contenu de casser le bloc.
  const json = JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');
  return `    <script type="application/ld+json">\n${json}\n    </script>`;
}

// ── Lecture des notices ────────────────────────────────────────────
const loaded = [];
for (const appId of TOOLS) {
  const p = resolve(HELP, `${appId}.json`);
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { console.error(`✗ Notice illisible : ${appId}.json — ${e.message}`); process.exit(1); }
  loaded.push({ appId, j });
}

const blocks = loaded.map(({ appId, j }) => noticeHTML(appId, j)).join('\n');
const faqCount = loaded.reduce((n, { j }) => n + (j.faq || []).length, 0);
const generated = `\n${blocks}\n${faqPageJSONLD(loaded)}\n`;

// ── Injection entre marqueurs ──────────────────────────────────────
let html = readFileSync(INDEX, 'utf8');
const i = html.indexOf(START), k = html.indexOf(END);
if (i === -1 || k === -1 || k < i) {
  console.error(`✗ Marqueurs introuvables dans index.html (${START} … ${END})`);
  process.exit(1);
}
const next = html.slice(0, i + START.length) + generated + html.slice(k);
if (next === html) { console.log('= Aucun changement.'); process.exit(0); }
writeFileSync(INDEX, next, 'utf8');
console.log(`✓ index.html mis à jour — ${loaded.length} notices, ${faqCount} questions (FAQPage outils).`);
