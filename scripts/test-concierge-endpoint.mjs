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
import { buildConciergePrompt, conciergeTokenMap } from '../workers/src/routes/smart-templates/concierge.js';
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
assert(prompt.includes('Je n\'ai pas cette information, contactez Camille Martin.'), 'règle: fallback "je ne sais pas" avec contact (nom seul, sans numéro)');
assert(!prompt.includes('04 94 00 00 00') && !prompt.includes('{{Tel}}'), 'tel: AUCUN chiffre ni repère de téléphone donné au modèle (il mangle les deux)');
assert(prompt.includes('Ne donne JAMAIS de numéro de téléphone toi-même') && prompt.includes('coordonnées sont affichées en bas'), 'règle: le modèle renvoie vers le footer pour le téléphone');
assert(prompt.includes('Ne jamais inventer.'), 'règle: ne jamais inventer');
assert(prompt.includes('Recopie le repère EXACTEMENT tel quel'), 'règle: repères chiffrés recopiés tels quels (anti perte-de-zeros)');
assert(prompt.includes('rappelle le disclaimer'), 'règle: question juridique -> disclaimer');
assert(prompt.includes('Réponses courtes, ton professionnel et chaleureux, langue fr'), 'règle: réponses courtes + persona injecté');

// Chiffres confiés à l'IA = REPÈRES sans chiffre ({{Pa}}, {{Sa}}, {{Ja}}).
// Mistral perd les zeros des nombres (595000 -> « 595 », 105 -> « 15 ») : on
// ne lui donne donc AUCUN chiffre, la page les convertit (cf. conciergeTokenMap).
assert(prompt.includes('{{Pa}}'), 'bloc: repère prix {{Pa}} (Maison A)');
assert(prompt.includes('{{Pb}}'), 'bloc: repère prix {{Pb}} (Maison B)');
assert(prompt.includes('{{Sa}}'), 'bloc: repère surface {{Sa}} (Maison A)');
assert(prompt.includes('{{Ja}}'), 'bloc: repère jardin {{Ja}} (Maison A)');
// AUCUN chiffre de prix/surface ne doit fuiter dans le prompt (ni brut ni formaté).
assert(!prompt.includes('389000') && !prompt.includes('389 000'), 'bloc: aucun chiffre de prix dans le prompt (tout en repères)');
assert(!prompt.includes('"68 m²"') && !prompt.includes('"92 m²"'), 'bloc: aucune surface chiffrée dans le prompt (tout en repères)');
assert(!prompt.includes('"prix_ttc"'), 'bloc: clé prix_ttc brute remplacée par repère');

// conciergeTokenMap : la map token->valeur exacte expose les VRAIS chiffres
// (utilisée côté page pour reconvertir). C'est le seul endroit qui porte 389 000.
const { map: TVAL } = conciergeTokenMap(BLOCK.configurations);
assert(TVAL.Pa === '389 000 €', 'tokenMap: {{Pa}} -> « 389 000 € » (valeur exacte préservée)');
assert(TVAL.Pb === '459 000 €', 'tokenMap: {{Pb}} -> « 459 000 € »');
assert(TVAL.Sa === '68 m²',     'tokenMap: {{Sa}} -> « 68 m² »');
assert(TVAL.Ja === '45 m²',     'tokenMap: {{Ja}} -> « 45 m² » (jardin Maison A)');

// Le statut "vendu" DOIT figurer dans les données (le modèle doit le voir
// pour l'exclure ; la règle lui interdit de le proposer).
assert(prompt.includes('"statut": "vendu"'), 'bloc: la config vendue est présente dans DONNÉES');
assert(prompt.includes('"reference": "Maison D"'), 'bloc: Maison D (vendue) présente');

// FAQ validée + disclaimer embarqués.
assert(prompt.includes('frais de notaire'), 'bloc: FAQ validée embarquée');
assert(prompt.includes('référez-vous à la notice descriptive'), 'bloc: disclaimer embarqué');

// Prompt GENERIC (Sprint C-b fix 31/05) : lieu (ville/adresse), prix en texte
// libre tokenisé, téléphone tokenisé. L'IA ne doit voir AUCUN chiffre brut.
const genPrompt = buildConciergePrompt({
  vertical: 'generic',
  programme: { ville: 'Bandol', adresse: '12 avenue du Port' },
  branding: { nom_agence: 'Bowling de Bandol' },
  configurations: [{ reference: 'Partie de bowling', prix_label: '6 € la partie', description: 'Chaussures incluses.' }],
  contact_humain: { nom: 'Camille', tel: '04 94 00 00 00' },
});
assert(genPrompt.includes('"ville": "Bandol"') && genPrompt.includes('"adresse": "12 avenue du Port"'),
  'prompt generic: lieu (ville + adresse) fourni à l\'IA -> peut répondre « où ça ? »');
assert(genPrompt.includes('où se situe'), 'prompt generic: règle explicite sur la localisation');
assert(!genPrompt.includes('6 € la partie') && genPrompt.includes('{{Pa}}'),
  'prompt generic: prix texte libre tokenisé {{Pa}} (jamais les chiffres bruts)');
assert(!genPrompt.includes('04 94 00 00 00') && !genPrompt.includes('{{Tel}}'),
  'prompt generic: aucun chiffre ni repère de téléphone (le modèle renvoie au footer)');
assert(genPrompt.includes('coordonnées sont affichées en bas'),
  'prompt generic: règle "renvoie vers les coordonnées affichées" pour le téléphone');

// La page (VAL) reçoit bien les valeurs exactes derrière les repères.
const genTok = conciergeTokenMap([{ prix_label: '6 € la partie' }]);
assert(genTok.map.Pa === '6 € la partie', 'tokenMap generic: prix_label -> {{Pa}} = « 6 € la partie » (VAL côté page)');

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

// Dernier tableau `messages` remis au moteur (inspecté §7).
let lastMessages = null;

// CONTRAT DU VENDOR, REPRODUIT. Workers AI (Mistral) refuse en 400 un
// message `system` qui suit un `assistant` :
//   8007 « Unexpected role 'system' after role 'assistant' ».
// Un bouchon qui accepte tout rend ce banc AVEUGLE — c'est exactement ce
// qui a laissé passer le Concierge muet de Bel'Arti : GUARD placé après
// l'historique (27/07), une seule réponse par chargement de page, banc
// vert pendant 52 jours. Le bouchon doit être aussi sévère que le vendor.
function assertRoleOrder(messages) {
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'system' && messages[i - 1].role === 'assistant') {
      throw new Error('8007: {"error":{"message":"Unexpected role \'system\' after '
        + 'role \'assistant\'","type":"BadRequestError","param":null,"code":400}}');
    }
  }
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
    env.AI = { run: async (_model, opts) => {
      if (aiThrows) throw new Error('boom');
      lastMessages = (opts && opts.messages) || [];
      assertRoleOrder(lastMessages);          // le vendor, pas un oui-oui
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
// 7. Multi-tours — le défaut « une seule réponse par chargement »
// ───────────────────────────────────────────────────────────────────
// Bel'Arti (1Wm27YVH, bâche Prométhée, 437 scans), 17/09/2026 : la 1re
// question répondait, TOUTES les suivantes rendaient « Je ne parviens pas
// à répondre pour le moment ». Cause : le GUARD était un message `system`
// posé APRÈS l'historique, donc juste après un tour `assistant` dès la 2e
// question -> refus 400 du vendor, event `error` dans le flux, repli de la
// page. Ces assertions tiennent la régression fermée.
// ─────────────────────────────────────────────────────────────
const HIST = [
  { role: 'user',      content: 'Quand est la livraison ?' },
  { role: 'assistant', content: 'La livraison est prévue pour 4e trimestre 2026.' },
];

lastMessages = null;
r = await handleSmartQrConcierge(
  mockReq({ short_id: 'OLLI1234', question: 'Quels sont les prix ?', history: HIST }),
  mockEnv({ aiText: 'La Maison A est à 389000 €.' }),
);
const sseHist = await r.text();
assert(!sseHist.includes('"type":"error"'), 'multi-tours: aucun event error (2e question)');
assert(sseHist.includes('"type":"done"'),   'multi-tours: le flux va jusqu\'à done');
assert(/"type":"done","full_text":"[^"]+"/.test(sseHist), 'multi-tours: done porte un texte non vide');

// Structure remise au moteur : c'est ELLE que le vendor valide.
assert(Array.isArray(lastMessages) && lastMessages.length > 0, 'multi-tours: messages capturés');
let violation = null;
for (let i = 1; i < (lastMessages || []).length; i++) {
  if (lastMessages[i].role === 'system' && lastMessages[i - 1].role === 'assistant') {
    violation = i; break;
  }
}
assert(violation === null, 'multi-tours: aucun `system` ne suit un `assistant`');

// L'historique du visiteur est bien transmis (on n'a pas corrigé en le jetant).
const roles = (lastMessages || []).map((m) => m.role).join(',');
assert(roles.startsWith('system,user,assistant'), 'multi-tours: historique conservé dans l\'ordre');
assert(roles.endsWith('user'), 'multi-tours: la question du visiteur a le dernier tour');

// Le garde-fou anti-injection garde sa PROPRIÉTÉ : il parle APRÈS les tours
// fournis par le visiteur (sinon le correctif aurait désarmé la mitigation).
const idxLastHist = (lastMessages || []).map((m) => m.role).lastIndexOf('assistant');
const guardIdx = (lastMessages || []).findIndex((m) => /Rappel prioritaire/.test(m.content || ''));
assert(guardIdx > idxLastHist, 'multi-tours: le garde-fou reste après l\'historique');
assert((lastMessages || []).slice(-1)[0]?.content?.includes('Quels sont les prix ?'),
  'multi-tours: la question réelle est bien dans le dernier message');

// 8 tours (le cap d'historique) : toujours pas de refus.
const LONG = [];
for (let i = 0; i < 8; i++) {
  LONG.push({ role: 'user', content: 'Question ' + i + ' ?' });
  LONG.push({ role: 'assistant', content: 'Réponse ' + i + '.' });
}
r = await handleSmartQrConcierge(
  mockReq({ short_id: 'OLLI1234', question: 'Et le T4 ?', history: LONG }),
  mockEnv({ aiText: 'Le T4 fait 92 m².' }),
);
const sseLong = await r.text();
assert(!sseLong.includes('"type":"error"'), 'multi-tours: 8 tours d\'historique -> pas de refus');

// La 1re question (historique vide) n'a jamais été cassée : elle le reste.
r = await handleSmartQrConcierge(
  mockReq({ short_id: 'OLLI1234', question: 'Quels modèles ?', history: [] }),
  mockEnv({ aiText: 'Quatre maisons.' }),
);
assert(!(await r.text()).includes('"type":"error"'), 'multi-tours: 1re question intacte');

// ─────────────────────────────────────────────────────────────
console.log(`\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
console.log(`  \x1b[32m✓ ${pass} PASS\x1b[0m    \x1b[2m✗ ${fail} FAIL\x1b[0m`);
process.exit(fail ? 1 : 0);
