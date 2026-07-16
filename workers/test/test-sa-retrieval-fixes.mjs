/* ═══════════════════════════════════════════════════════════════
   Audit 2026-07-16 — correctifs retrieval Smart Agent (bug n°2).
   Tests UNITAIRES des fonctions pures (aucun worker requis) :
     node test/test-sa-retrieval-fixes.mjs
   Prouve :
   (1) contextualQuery ne préfixe PLUS une question autoportée
       (cause n°1 des cartes intermittentes), mais préfixe toujours
       une confirmation « oui » (le bug d'origine reste corrigé) ;
   (2) isGrounded : lexical seul suffit ; sémantique actif + score
       sous le seuil = repli ; sémantique absent = lexical décide ;
   (3) le seuil voit un score fin (0.4151 ne passe plus par arrondi) ;
   (4) degradedReply localisé, sans « ? » final (une réplique qui se
       termine par une question redeviendrait lastAgentQuestion).
   ═══════════════════════════════════════════════════════════════ */
import { contextualQuery, isAffirmation, isGrounded, degradedReply, splitGapReply }
  from '../src/routes/smart-agent.js';

let n = 0, ko = 0;
const t = (name, cond) => { n++; if (!cond) { ko++; console.error('✗', name); } else console.log('✓', name); };

const HIST = [
  { role: 'user',      content: 'Parle-moi du livre.' },
  { role: 'assistant', content: 'Le livre raconte seize affaires. Laquelle voulez-vous explorer ?' },
];

// (1) contextualQuery
t('question autoportée : requête INCHANGÉE malgré la relance en historique',
  contextualQuery('Que sais-tu de la WIGMO ?', HIST) === 'Que sais-tu de la WIGMO ?');
t('confirmation « oui » : préfixée par la dernière question de l’agent',
  contextualQuery('oui', HIST) === 'Laquelle voulez-vous explorer ? oui');
t('confirmation sans relance en historique : inchangée',
  contextualQuery('oui', []) === 'oui');
t('isAffirmation : « ok pour 4 » oui, vraie phrase non',
  isAffirmation('ok pour 4') && !isAffirmation('quels sont vos horaires ?'));

// (2) isGrounded
const hit = (lex, vec) => ({ lexRank: lex, vecScore: vec });
t('accroche lexicale seule = ancré (même score vectoriel nul)',
  isGrounded({ semantic: true, hits: [hit(1, 0)] }).grounded === true);
t('sémantique actif, pas de lexical, score sous le seuil = repli',
  isGrounded({ semantic: true, hits: [hit(null, 0.30)] }).grounded === false);
t('sémantique ABSENT (panne totale) : le lexical décide',
  isGrounded({ semantic: false, hits: [hit(null, null)] }).grounded === true);
t('zéro fiche = jamais ancré',
  isGrounded({ semantic: false, hits: [] }).grounded === false);

// (3) seuil au score fin — 0.4151 (sous 0.42) ne doit PLUS passer,
//     0.4201 doit passer : la falaise est au seuil réel, plus à l'arrondi.
t('0.4151 échoue (l’arrondi 2 décimales le faisait passer à 0.42)',
  isGrounded({ semantic: true, hits: [hit(null, 0.4151)] }).grounded === false);
t('0.4201 passe',
  isGrounded({ semantic: true, hits: [hit(null, 0.4201)] }).grounded === true);

// (4) degradedReply
for (const lang of ['fr', 'en', 'es', 'de']) {
  const r = degradedReply(lang);
  t(`degradedReply(${lang}) : non vide et sans « ? » final`, !!r && !r.trim().endsWith('?'));
}
t('degradedReply(langue inconnue) : repli fr', degradedReply('it') === degradedReply('fr'));

// (5) splitGapReply : comportement inchangé (non-régression)
t('[GAP] en tête détecté et retiré',
  (() => { const r = splitGapReply('[GAP] Je ne peux pas répondre.'); return r.gapped && !r.text.includes('[GAP]'); })());
t('réponse normale : pas de gap',
  splitGapReply('Le livre contient seize histoires.').gapped === false);

console.log(ko ? `\n${ko}/${n} ÉCHECS` : `\n${n}/${n} OK`);
process.exit(ko ? 1 : 0);
