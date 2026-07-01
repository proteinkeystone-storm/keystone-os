#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test SA-11.0 (socle multilingue, fonctions pures)

   Couvre, sans LLM live :
     - normLang : liste fermée fr/en/es/de + repli (et repli invalide → fr) ;
     - buildChatMessages : la règle de langue du system prompt suit `lang`
       (FR par défaut, ANGLAIS/ESPAGNOL/ALLEMAND sinon) + consigne « formule
       ta réponse en <langue> même si les fiches sont dans une autre langue » ;
     - pickFallback : repli par DÉFAUT localisé par langue ; phrases custom du
       propriétaire servies telles quelles ; rétro-compat (sans arg lang) ;
     - validateAgentPayload : identity.lang validé (défaut fr, fermé).

   Usage : node scripts/test-smart-agent-lang.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normLang, buildChatMessages, pickFallback, validateAgentPayload,
  sanitizeI18nMap, validateCards, publicAgentMeta, guessMsgLang }
  from '../workers/src/routes/smart-agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else      { failed++; console.error(`  \x1b[31m✗\x1b[0m ${name}`); }
}
const sysOf = (lang) => buildChatMessages({
  agentName: 'A', mission: 'm', tone: 't', fallbackText: 'X',
  fiches: '[1] f', message: 'q', history: [], lang,
})[0].content;

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — normLang\x1b[0m');
check('fr/en/es/de acceptés', ['fr', 'en', 'es', 'de'].every(l => normLang(l) === l));
check('inconnu → fr (défaut)', normLang('xx') === 'fr' && normLang('') === 'fr' && normLang(undefined) === 'fr');
check('repli explicite respecté', normLang('xx', 'en') === 'en');
check('repli invalide → fr', normLang('zz', 'qq') === 'fr');
check('casse stricte (EN ≠ en) → fr', normLang('EN') === 'fr');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — buildChatMessages : règle de langue\x1b[0m');
check('défaut (sans lang) → FRANÇAIS', sysOf(undefined).includes('RÉPONDS EN FRANÇAIS'));
check('en → ANGLAIS', sysOf('en').includes('RÉPONDS EN ANGLAIS') && sysOf('en').includes('en anglais'));
check('es → ESPAGNOL', sysOf('es').includes('RÉPONDS EN ESPAGNOL'));
check('de → ALLEMAND', sysOf('de').includes('RÉPONDS EN ALLEMAND'));
check('langue inconnue → repli FRANÇAIS', sysOf('xx').includes('RÉPONDS EN FRANÇAIS'));
check('consigne cross-langue présente (fiches dans une autre langue)',
  /même si les fiches.*formule TOUJOURS ta réponse/i.test(sysOf('en')));
check('une seule langue imposée (en n\'inclut pas la directive FR)',
  sysOf('en').includes('RÉPONDS EN ANGLAIS') && !sysOf('en').includes('RÉPONDS EN FRANÇAIS'));

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — pickFallback : repli localisé\x1b[0m');
const FR_DEF = 'Je ne dispose pas de cette information.';
check('défaut fr', pickFallback({}, () => 0, 'fr') === FR_DEF);
check('défaut en', pickFallback({}, () => 0, 'en') === "I don't have that information.");
check('défaut es', pickFallback({}, () => 0, 'es') === 'No dispongo de esa información.');
check('défaut de', pickFallback({}, () => 0, 'de') === 'Diese Information habe ich leider nicht.');
check('fallback_text par DÉFAUT (fr figé) traité comme non-custom → localisé en',
  pickFallback({ fallback_text: FR_DEF }, () => 0, 'en') === "I don't have that information.");
check('phrase CUSTOM du propriétaire servie telle quelle (langue inchangée)',
  pickFallback({ fallback_text: 'Désolé, je vérifie ça !' }, () => 0, 'en') === 'Désolé, je vérifie ça !');
check('variantes custom respectées malgré lang',
  pickFallback({ fallback_text: 'A', fallback_variants: ['B', 'C'] }, () => 0.5, 'de') === 'B');
check('rétro-compat : sans arg lang → défaut fr', pickFallback({}, () => 0) === FR_DEF);
check('rétro-compat : custom sans lang inchangé',
  pickFallback({ fallback_text: 'A' }, () => 0.9) === 'A');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — validateAgentPayload : identity.lang\x1b[0m');
{
  const def = validateAgentPayload({ name: 'X', config: { identity: { mission: 'm' } } });
  check('défaut → fr', def.ok && def.config.identity.lang === 'fr');
  const en = validateAgentPayload({ name: 'X', config: { identity: { mission: 'm', lang: 'en' } } });
  check('lang valide conservée', en.ok && en.config.identity.lang === 'en');
  const bad = validateAgentPayload({ name: 'X', config: { identity: { mission: 'm', lang: 'klingon' } } });
  check('lang invalide → fr', bad.ok && bad.config.identity.lang === 'fr');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — Voix Piper par langue (SA-11.1)\x1b[0m');
{
  const piper = await import('../app/lib/piper-tts.js');
  check('4 voix déclarées (fr/en/es/de)', Object.keys(piper.VOICES).length === 4);
  check('voiceForLang fr → siwis', piper.voiceForLang('fr') === 'fr_FR-siwis-medium');
  check('voiceForLang en → amy', piper.voiceForLang('en') === 'en_US-amy-medium');
  check('voiceForLang es → davefx', piper.voiceForLang('es') === 'es_ES-davefx-medium');
  check('voiceForLang de → thorsten', piper.voiceForLang('de') === 'de_DE-thorsten-medium');
  check('voiceForLang inconnue → défaut fr', piper.voiceForLang('zz') === piper.DEFAULT_VOICE);
  // normalizeForSpeech : règles FR seulement en fr ; Markdown nettoyé partout.
  check('fr : heures + sigle épelés', piper.normalizeForSpeech('Ouvert 20h30, voir OS', 'fr') === 'Ouvert 20 heures 30, voir o-èsse');
  check('en : règles FR NON appliquées', piper.normalizeForSpeech('Open 20h30, see OS', 'en') === 'Open 20h30, see OS');
  check('de : règles FR NON appliquées', piper.normalizeForSpeech('Das OS', 'de') === 'Das OS');
  check('Markdown nettoyé quelle que soit la langue', piper.normalizeForSpeech('**Bold** text', 'en') === 'Bold text');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — Contenu propriétaire multilingue (SA-11.3)\x1b[0m');
{
  // sanitizeI18nMap : garde en/es/de non vides, ignore fr + clés inconnues, borne.
  const m = sanitizeI18nMap({ en: ' Hi ', es: '', de: 'Hallo', fr: 'Salut', xx: 'y' }, 60);
  check('garde en/de non vides, trim', m.en === 'Hi' && m.de === 'Hallo');
  check('es vide écarté, fr/inconnu ignorés', !('es' in m) && !('fr' in m) && !('xx' in m));
  check('borne maxLen', sanitizeI18nMap({ en: 'x'.repeat(100) }, 10).en.length === 10);
  check('non-objet → {}', JSON.stringify(sanitizeI18nMap(null)) === '{}' && JSON.stringify(sanitizeI18nMap('a')) === '{}');

  // validateCards : title_i18n conservé si non vide, omis sinon.
  const key = 'sa-cards/ag1/abc.jpg';
  const cv = validateCards([{ img: key, q: 'Quoi ?', title: 'Objet', title_i18n: { en: 'Item', es: '' } }]);
  check('carte : title_i18n nettoyé conservé', cv[0].title_i18n && cv[0].title_i18n.en === 'Item' && !('es' in cv[0].title_i18n));
  const cv2 = validateCards([{ img: key, q: 'Quoi ?', title: 'Objet' }]);
  check('carte sans traduction : pas de title_i18n', !('title_i18n' in cv2[0]));

  // publicAgentMeta : expose opening_i18n + title_i18n des cartes.
  const meta = publicAgentMeta({
    name: 'A', config: { identity: { opening: 'Bonjour', opening_i18n: { en: 'Hello', de: 'Hallo' } },
      cards: [{ img: key, q: 'Quoi ?', title: 'Objet', title_i18n: { en: 'Item' } }] },
  }, 'https://x');
  check('meta expose opening_i18n', meta.opening_i18n && meta.opening_i18n.en === 'Hello' && meta.opening_i18n.de === 'Hallo');
  check('meta carte expose title_i18n', meta.cards[0].title_i18n && meta.cards[0].title_i18n.en === 'Item');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6b — SA-13.3 : langue AUTO (langFixed) + guessMsgLang\x1b[0m');
{
  const base = { agentName: 'A', mission: 'm', tone: 't', fallbackText: 'X', fiches: '[1] f', message: 'q', history: [] };
  const fixed = buildChatMessages({ ...base, lang: 'fr', langFixed: true })[0].content;
  const auto  = buildChatMessages({ ...base, lang: 'fr', langFixed: false })[0].content;
  const deflt = buildChatMessages({ ...base, lang: 'en' })[0].content;
  check('langFixed:true → langue imposée', /RÉPONDS EN FRANÇAIS/.test(fixed) && !/LANGUE DE LA DERNIÈRE QUESTION/.test(fixed));
  check('langFixed:false → langue de la question + garde anti-zigzag',
    /LANGUE DE LA DERNIÈRE QUESTION/.test(auto) && /trop court/.test(auto) && /par défaut en français/.test(auto));
  check('défaut = langue imposée (rétro-compat golden/sandbox)', /RÉPONDS EN ANGLAIS/.test(deflt));

  check('guessMsgLang : anglais', guessMsgLang('What are the opening hours?') === 'en');
  check('guessMsgLang : espagnol', guessMsgLang('¿Cuánto cuesta la entrada?') === 'es');
  check('guessMsgLang : allemand', guessMsgLang('Wie viel kostet der Eintritt bitte?') === 'de');
  // SA-13.4 — le français est un indice à part entière : une vraie question
  // française reprend la main sur un historique anglais (bug accent français).
  check('guessMsgLang : français → fr', guessMsgLang('Quels sont les horaires d\'ouverture ?') === 'fr');
  check('guessMsgLang : « que » français → fr, pas espagnol', guessMsgLang('Qu\'est-ce que vous vendez ?') === 'fr');
  check('guessMsgLang : message court sans indice → null (continuité)', guessMsgLang('ok') === null && guessMsgLang('super') === null);
  check('guessMsgLang : vide/null → null', guessMsgLang('') === null && guessMsgLang(null) === null);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — Syntaxe (node --check)\x1b[0m');
try { execSync(`node --check "${join(ROOT, 'workers/src/routes/smart-agent.js')}"`, { stdio: 'pipe' }); check('smart-agent.js — syntaxe OK', true); }
catch (e) { check('smart-agent.js — syntaxe OK', false); console.error(String(e.stdout || e.stderr || e.message)); }

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
