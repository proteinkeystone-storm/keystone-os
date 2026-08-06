/* ═══════════════════════════════════════════════════════════════
   Smart Agent — le visiteur sait TOUJOURS qu'il parle à une machine
   ───────────────────────────────────────────────────────────────
   Loi d'août 2026 : la mention « IA » doit être là avant que la
   conversation s'engage. Le client peut l'oublier ; le filet, lui,
   n'a pas le droit d'oublier. On vérifie les deux moitiés :

     · quand la mention MANQUE, elle est posée — dans la langue de
       l'accueil, y compris pour chaque traduction ;
     · quand elle est DÉJÀ là, on n'y touche pas — sinon l'accueil
       soigné du client se retrouve doublé d'une phrase parasite.

   Le piège qui a dicté la forme du filet est le test « je vous ai
   attendu » : chercher « ai » sans distinction de casse ferait
   croire que la mention est présente, et le filet ne tomberait
   JAMAIS sur les accueils français. Les sigles se cherchent donc en
   majuscules, les formes longues sans distinction de casse.

   Aucun serveur à lancer — fonctions pures :
     node test/test-sa-ai-disclosure.mjs
   ═══════════════════════════════════════════════════════════════ */

import { withAiDisclosure, publicAgentMeta } from '../src/routes/smart-agent.js';

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
};
const eq = (got, want, label) => {
  if (got === want) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log(`  ✗ ${label}\n      attendu : ${JSON.stringify(want)}\n      obtenu  : ${JSON.stringify(got)}`); }
};

console.log('\n1. La mention manque → elle est posée, dans la bonne langue');
eq(withAiDisclosure('Bienvenue ! Comment puis-je vous aider ?', 'fr'),
   'Je suis un assistant IA.\nBienvenue ! Comment puis-je vous aider ?',
   'accueil français nu → mention française en première ligne');
eq(withAiDisclosure('Welcome! How can I help?', 'en'),
   'I am an AI assistant.\nWelcome! How can I help?',
   'accueil anglais nu → « AI assistant »');
eq(withAiDisclosure('¡Bienvenido! ¿En qué puedo ayudarle?', 'es'),
   'Soy un asistente de IA.\n¡Bienvenido! ¿En qué puedo ayudarle?',
   'accueil espagnol nu → « asistente de IA »');
eq(withAiDisclosure('Willkommen! Wie kann ich helfen?', 'de'),
   'Ich bin ein KI-Assistent.\nWillkommen! Wie kann ich helfen?',
   'accueil allemand nu → « KI-Assistent », pas « IA »');
eq(withAiDisclosure('Bonjour !', 'klingon'),
   'Je suis un assistant IA.\nBonjour !',
   'langue inconnue → repli sur le français, jamais rien du tout');

console.log('\n2. La mention est déjà là → on n\'y touche pas');
const landing = 'Bonjour !\nJe suis le conseiller IA Keystone.\nTouchez une application, ou dites-moi quel est votre métier.';
eq(withAiDisclosure(landing, 'fr'), landing, 'sigle « IA » reconnu → accueil de la landing intact');
eq(withAiDisclosure('Je suis une intelligence artificielle au service du musée.', 'fr'),
   'Je suis une intelligence artificielle au service du musée.',
   'forme longue française reconnue');
eq(withAiDisclosure('This is an ARTIFICIAL INTELLIGENCE assistant.', 'en'),
   'This is an ARTIFICIAL INTELLIGENCE assistant.',
   'forme longue reconnue quelle que soit la casse');
eq(withAiDisclosure('Ich bin eine künstliche Intelligenz.', 'de'),
   'Ich bin eine künstliche Intelligenz.',
   'forme longue allemande (avec ü) reconnue');
ok(withAiDisclosure(withAiDisclosure('Bienvenue !', 'fr'), 'fr')
     === withAiDisclosure('Bienvenue !', 'fr'),
   'idempotent : repasser le filet ne double pas la mention');

console.log('\n3. Le piège de casse — sans lui, le filet ne tomberait jamais en français');
eq(withAiDisclosure('Je vous ai attendu toute la matinée. Que puis-je pour vous ?', 'fr'),
   'Je suis un assistant IA.\nJe vous ai attendu toute la matinée. Que puis-je pour vous ?',
   '« ai » du verbe avoir n\'est PAS une mention → le filet tombe');
eq(withAiDisclosure('Bonjour, je suis Maria, votre hôtesse.', 'fr'),
   'Je suis un assistant IA.\nBonjour, je suis Maria, votre hôtesse.',
   '« Maria » ne contient pas de mention → le filet tombe');

console.log('\n4. Accueil vide → le front public pose son générique (déjà porteur de la mention)');
eq(withAiDisclosure('', 'fr'), '', 'chaîne vide → vide');
eq(withAiDisclosure('   ', 'fr'), '', 'blancs seuls → vide');
eq(withAiDisclosure(null, 'fr'), '', 'null → vide, pas de plantage');
eq(withAiDisclosure(undefined, 'fr'), '', 'undefined → vide, pas de plantage');

console.log('\n5. Bout en bout — ce que le visiteur anonyme reçoit vraiment');
const meta = publicAgentMeta({
  name: 'Atelier Lumen',
  config: { identity: {
    lang: 'fr',
    opening: 'Bienvenue à l\'Atelier Lumen ! Une question sur nos lampes ?',
    opening_i18n: { en: 'Welcome to Atelier Lumen! A question about our lamps?',
                    de: 'Willkommen! Eine Frage zu unseren Lampen?',
                    es: 'Soy un asistente de IA. ¡Bienvenido!' },
  } },
}, 'https://api.example');
ok(meta.opening.startsWith('Je suis un assistant IA.'), 'accueil natif servi avec la mention');
ok(meta.opening.includes('Atelier Lumen'), 'le texte du client est conservé sous la mention');
ok(meta.opening_i18n.en.startsWith('I am an AI assistant.'), 'traduction anglaise → mention anglaise');
ok(meta.opening_i18n.de.startsWith('Ich bin ein KI-Assistent.'), 'traduction allemande → mention allemande');
eq(meta.opening_i18n.es, 'Soy un asistente de IA. ¡Bienvenido!',
   'traduction espagnole qui dit déjà « IA » → intacte');

console.log('\n6. Un agent publié AVANT la règle est couvert sans republication');
const vieux = publicAgentMeta({
  name: 'Concierge',
  config: { identity: { opening: 'Bonjour ! Que puis-je pour vous ?' } },   // ni lang, ni mention
}, '');
eq(vieux.opening, 'Je suis un assistant IA.\nBonjour ! Que puis-je pour vous ?',
   'config d\'époque, sans langue déclarée → mention posée quand même');
eq(vieux.lang, 'fr', 'langue native par défaut = fr');

const nu = publicAgentMeta({ name: 'Sans accueil', config: { identity: {} } }, '');
eq(nu.opening, '', 'aucun accueil configuré → chaîne vide, le front pose son générique localisé');

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} assertion(s) vertes, ${fail} rouge(s)\n`);
process.exit(fail === 0 ? 0 : 1);
