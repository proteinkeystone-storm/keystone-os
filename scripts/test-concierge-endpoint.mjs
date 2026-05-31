#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// Sprint 2 — Tests endpoint /api/smartqr/concierge (backend live chat)
// ───────────────────────────────────────────────────────────────────
// Couvre : buildConciergePrompt (bloc + chaque règle §3), validation
// d'input (question, short_id, existence/forme du QR), framing SSE.
// MODÈLE MOCKÉ — aucun appel réseau, aucune dépendance D1/Workers AI
// réelle. Gate du Sprint 2 : ce fichier vert + `node --check`.
//
//   node scripts/test-concierge-endpoint.mjs
// ══════════════════════════════════════════════════════════════════
import { buildConciergePrompt } from '../workers/src/routes/smart-templates/concierge.js';
import { handleSmartQrConcierge, stripModelNoise } from '../workers/src/routes/qr.js';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error('  \x1b[31m✗ FAIL:\x1b[0m', label); }
}

// Bloc Ollioules — cohérent avec MOCK_DATA['concierge'] (test-templates.mjs).
const BLOCK = {
  qr_id: 'ollioules-programme',
  destination_url: 'https://example.com/programme-ollioules',
  programme: {
    nom: 'Les Terrasses d\'Ollioules', promoteur: 'Promoteur Test',
    ville: 'Ollioules', livraison_prevue: '4e trimestre 2026',
  },
  configurations: [
    { reference: 'Maison A', type: 'T3', nb_chambres: 2, statut: 'disponible',
      surface_habitable_m2: 68, surfaces_annexes: { jardin_m2: 45, garage: true },
      exposition: 'Sud', prix_ttc: 389000, stationnement: '1 garage + 1 place',
      prestations: ['Cuisine équipée', 'Volets roulants électriques'] },
    { reference: 'Maison B', type: 'T4', nb_chambres: 3, statut: 'disponible',
      surface_habitable_m2: 92, surfaces_annexes: { jardin_m2: 80, garage: true },
      exposition: 'Sud-Ouest', prix_ttc: 459000, stationnement: '1 garage + 2 places',
      prestations: ['Cuisine équipée', 'Domotique'] },
    { reference: 'Maison C', type: 'T4', nb_chambres: 3, statut: 'optionne',
      surface_habitable_m2: 95, surfaces_annexes: { jardin_m2: 70, garage: true },
      exposition: 'Est', prix_ttc: 472000, stationnement: '1 garage', prestations: [] },
    { reference: 'Maison D', type: 'T2', nb_chambres: 1, statut: 'vendu',
      surface_habitable_m2: 48, surfaces_annexes: { jardin_m2: 0, garage: false },
      exposition: 'Nord', prix_ttc: 268000, stationnement: '1 place', prestations: [] },
  ],
  faq_validee: [
    { q: 'Quels sont les frais de notaire ?', r: 'En VEFA, frais réduits (2 à 3 %).' },
  ],
  questions_suggerees: [
    'Quels modèles sont disponibles ?', 'Quelle différence entre la A et la B ?',
    'Laquelle pour une famille de 4 ?', 'Quelle date de livraison ?',
  ],
  contact_humain: { nom: 'Camille Martin', tel: '04 94 00 00 00', email: 'contact@agence-horizon.fr' },
  disclaimer: 'Pour toute information contractuelle, référez-vous à la notice descriptive et à votre conseiller.',
  persona: { ton: 'professionnel et chaleureux', langue_par_defaut: 'fr' },
  branding: {
    nom_agence: 'Agence Horizon', logo_url: '',
    couleur_primaire: '#2563eb', couleur_secondaire: '#c9a96e', fond: 'clair',
  },
};

// ─────────────────────────────────────────────────────────────
// 1. buildConciergePrompt — bloc + règles §3 + chiffres exacts
// ─────────────────────────────────────────────────────────────
const prompt = buildConciergePrompt(BLOCK);

assert(typeof prompt === 'string' && prompt.length > 300, 'prompt is a non-trivial string');
assert(prompt.includes('Tu es le concierge de Agence Horizon'), 'prompt: cite le nom d\'agence');
assert(prompt.includes('Les Terrasses d\'Ollioules'), 'prompt: cite le nom du programme');
assert(prompt.includes('DONNÉES :'), 'prompt: section DONNÉES');
assert(prompt.includes('RÈGLES :'), 'prompt: section RÈGLES');

// Chaque règle §3 présente (mot pour mot sur les fragments saillants).
assert(prompt.includes('Réponds uniquement à partir des données fournies.'), 'règle: uniquement depuis les données');
assert(prompt.includes('Compare les configurations'), 'règle: comparer/orienter');
assert(prompt.includes('jamais de justification par une donnée absente'), 'règle: pas de justif par donnée absente');
assert(prompt.includes('Ne propose jamais une configuration dont le statut = vendu.'), 'règle: jamais proposer un vendu');
assert(prompt.includes('Je n\'ai pas cette information, contactez Camille Martin (04 94 00 00 00).'), 'règle: fallback "je ne sais pas" avec contact injecté');
assert(prompt.includes('Ne jamais inventer.'), 'règle: ne jamais inventer');
assert(prompt.includes('Recopie le nombre ENTIER avec TOUS ses chiffres'), 'règle: chiffres recopiés en entier (anti-troncature/abréviation)');
assert(prompt.includes('rappelle le disclaimer'), 'règle: question juridique -> disclaimer');
assert(prompt.includes('Réponses courtes, ton professionnel et chaleureux, langue fr'), 'règle: réponses courtes + persona injecté');

// Chiffres « a plat » (sans espace de milliers interne) dans le bloc DONNÉES :
// token contigu « 389000 € » recopié EN ENTIER par le modèle. Avec l'espace
// (« 389 000 € »), Mistral tronquait en jetant le groupe « 000 » -> « 389 € ».
// L'affichage du chat regroupe ensuite en « 389 000 € » (groupNums, page).
assert(prompt.includes('389000 €'), 'bloc: prix a plat 389000 € (Maison A, anti-troncature)');
assert(prompt.includes('459000 €'), 'bloc: prix a plat 459000 € (Maison B)');
assert(prompt.includes('472000 €'), 'bloc: prix a plat 472000 € (Maison C)');
assert(prompt.includes('"surface": "68 m²"'), 'bloc: surface formatée exacte 68 m² (Maison A)');
assert(prompt.includes('"surface": "92 m²"'), 'bloc: surface formatée exacte 92 m² (Maison B)');
// Plus AUCUN espace de milliers interne : c'est CE format qui faisait tronquer.
assert(!prompt.includes('389 000'), 'bloc: aucun espace de milliers interne (anti-troncature Mistral)');
assert(!prompt.includes('"prix_ttc"'), 'bloc: clé prix_ttc brute remplacée par prix formaté');

// Le statut "vendu" DOIT figurer dans les données (le modèle doit le voir
// pour l'exclure ; la règle lui interdit de le proposer).
assert(prompt.includes('"statut": "vendu"'), 'bloc: la config vendue est présente dans DONNÉES');
assert(prompt.includes('"reference": "Maison D"'), 'bloc: Maison D (vendue) présente');

// FAQ validée + disclaimer embarqués.
assert(prompt.includes('frais de notaire'), 'bloc: FAQ validée embarquée');
assert(prompt.includes('référez-vous à la notice descriptive'), 'bloc: disclaimer embarqué');

// Robustesse : bloc vide ne casse pas + fallback contact générique.
const emptyPrompt = buildConciergePrompt({});
assert(typeof emptyPrompt === 'string' && emptyPrompt.includes('RÈGLES :'), 'prompt: bloc vide -> string valide');
assert(emptyPrompt.includes('contactez votre conseiller.'), 'prompt: contact absent -> fallback "votre conseiller"');
assert(buildConciergePrompt(null).includes('RÈGLES :'), 'prompt: null -> string valide');

// ─────────────────────────────────────────────────────────────
// 2. Mocks (Request + env D1/AI) — aucun réseau
// ─────────────────────────────────────────────────────────────
function mockReq(bodyObj, method = 'POST') {
  return new Request('https://keystone.test/api/smartqr/concierge', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'OPTIONS' ? undefined : JSON.stringify(bodyObj || {}),
  });
}

// Faux stream Workers AI : émet des chunks {response:"mot "} puis [DONE].
function mockAIStream(text) {
  const enc = new TextEncoder();
  const lines = String(text).split(' ').map(
    (w) => `data: ${JSON.stringify({ response: w + ' ' })}\n\n`,
  );
  lines.push('data: [DONE]\n\n');
  let i = 0;
  return {
    getReader() {
      return {
        read() {
          if (i < lines.length) return Promise.resolve({ done: false, value: enc.encode(lines[i++]) });
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

// env minimal : DB.prepare().bind().first()/run() + AI.run(). Le même row
// est renvoyé pour toute requête (suffisant : le garde-fou budget lit juste
// throttle_on -> undefined -> non bridé).
function mockEnv({ qr = 'concierge', aiText = 'Réponse mock.', aiThrows = false, withAI = true } = {}) {
  const row = qr
    ? { data: JSON.stringify({
        short_id: 'OLLI1234', mode: 'smart',
        template_id: qr === 'concierge' ? 'concierge' : qr,
        template_data: BLOCK,
      }) }
    : null;
  const stmt = {
    bind: () => stmt,
    first: async () => row,
    run: async () => ({ success: true }),
    all: async () => ({ results: [] }),
  };
  const env = { DB: { prepare: () => stmt } };
  if (withAI) {
    env.AI = { run: async () => {
      if (aiThrows) throw new Error('boom');
      return mockAIStream(aiText);
    } };
  }
  return env;
}

// ─────────────────────────────────────────────────────────────
// 3. Validation d'input
// ─────────────────────────────────────────────────────────────
let r = await handleSmartQrConcierge(mockReq({ short_id: 'OLLI1234' }), mockEnv());
assert(r.status === 400, 'validation: question manquante -> 400');

r = await handleSmartQrConcierge(mockReq({ short_id: 'OLLI1234', question: 'x'.repeat(600) }), mockEnv());
assert(r.status === 400, 'validation: question trop longue -> 400');

r = await handleSmartQrConcierge(mockReq({ short_id: 'a', question: 'Bonjour ?' }), mockEnv());
assert(r.status === 400, 'validation: short_id trop court -> 400');

r = await handleSmartQrConcierge(mockReq({ short_id: 'OLLI1234', question: 'Quels modèles ?' }), mockEnv({ qr: null }));
assert(r.status === 404, 'validation: QR introuvable -> 404');

r = await handleSmartQrConcierge(mockReq({ short_id: 'OLLI1234', question: 'Quels modèles ?' }), mockEnv({ qr: 'machine-a-sous' }));
assert(r.status === 400, 'validation: template non-concierge -> 400');

r = await handleSmartQrConcierge(mockReq({ short_id: 'OLLI1234', question: 'Quels modèles ?' }), mockEnv({ withAI: false }));
assert(r.status === 503, 'validation: binding AI manquant -> 503');

r = await handleSmartQrConcierge(mockReq({}, 'OPTIONS'), mockEnv());
assert(r.status === 204, 'CORS: OPTIONS -> 204');
assert((r.headers.get('Access-Control-Allow-Methods') || '').includes('POST'), 'CORS: méthodes annoncées');

// ─────────────────────────────────────────────────────────────
// 4. Happy path : framing SSE
// ─────────────────────────────────────────────────────────────
r = await handleSmartQrConcierge(
  mockReq({ short_id: 'OLLI1234', question: 'Quel modèle pour une famille de 4 ?' }),
  mockEnv({ aiText: 'La Maison B avec trois chambres convient.' }),
);
assert(r.status === 200, 'happy path: 200');
assert((r.headers.get('Content-Type') || '').includes('text/event-stream'), 'happy path: content-type SSE');

const sse = await r.text();
assert(sse.includes('data: {"type":"start"}'), 'SSE: event start émis');
assert(sse.includes('"type":"chunk"'), 'SSE: events chunk émis');
assert(sse.includes('"type":"done"'), 'SSE: event done émis');
assert(sse.includes('Maison B'), 'SSE: le texte streamé contient la réponse du modèle');
assert(/data: \{"type":"done","full_text":".*Maison B.*"\}/.test(sse), 'SSE: done porte le full_text agrégé');
// Chaque ligne data: est un JSON valide + double saut de ligne de séparation.
const dataLines = sse.split('\n').filter((l) => l.startsWith('data:'));
let allJson = true;
for (const l of dataLines) { try { JSON.parse(l.slice(5).trim()); } catch { allJson = false; } }
assert(dataLines.length >= 3 && allJson, 'SSE: toutes les lignes data: sont du JSON valide');

// ─────────────────────────────────────────────────────────────
// 5. Échec moteur : event error dans le stream (200 + SSE quand même)
// ─────────────────────────────────────────────────────────────
r = await handleSmartQrConcierge(
  mockReq({ short_id: 'OLLI1234', question: 'Bonjour ?' }),
  mockEnv({ aiThrows: true }),
);
assert(r.status === 200, 'AI throw: la réponse reste un stream 200');
const sseErr = await r.text();
assert(sseErr.includes('"type":"error"'), 'AI throw: event error émis dans le stream');

// ─────────────────────────────────────────────────────────────
// 6. Anti-bruit : stripModelNoise (unitaire) + nettoyage du full_text (E2E)
// ─────────────────────────────────────────────────────────────
assert(stripModelNoise('Bonjour, appelez Camille.zk39qp7w2x') === 'Bonjour, appelez Camille.',
  'strip: blob alphanumérique parasite final retiré (séparateur conservé)');
assert(stripModelNoise('Trois maisons disponibles : A, B et E.') === 'Trois maisons disponibles : A, B et E.',
  'strip: texte propre laissé intact');
assert(stripModelNoise('Contactez-le au 04 94 00 00 00') === 'Contactez-le au 04 94 00 00 00',
  'strip: téléphone (chiffres purs) préservé');
assert(stripModelNoise('Livraison au 4e trimestre 2026') === 'Livraison au 4e trimestre 2026',
  'strip: année (chiffres purs) préservée');
assert(stripModelNoise('Réponse finale.</s>') === 'Réponse finale.',
  'strip: token de contrôle </s> retiré');
assert(stripModelNoise('') === '' && stripModelNoise(null) === '',
  'strip: vide/null -> chaine vide');

// E2E : le full_text de l'event done est nettoyé du blob parasite.
r = await handleSmartQrConcierge(
  mockReq({ short_id: 'OLLI1234', question: 'Quels modèles ?' }),
  mockEnv({ aiText: 'Voici nos maisons, appelez Camille.zk39qp7w2x' }),
);
const sseNoise = await r.text();
const doneObj = sseNoise.split('\n').filter((l) => l.startsWith('data:'))
  .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
  .find((o) => o && o.type === 'done');
assert(doneObj && !/zk39qp7w2x/.test(doneObj.full_text), 'E2E anti-bruit: blob retiré du full_text (done)');
assert(doneObj && /Camille\./.test(doneObj.full_text), 'E2E anti-bruit: texte utile préservé');

// ─────────────────────────────────────────────────────────────
console.log(`\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
console.log(`  \x1b[32m✓ ${pass} PASS\x1b[0m    \x1b[2m✗ ${fail} FAIL\x1b[0m`);
process.exit(fail ? 1 : 0);
