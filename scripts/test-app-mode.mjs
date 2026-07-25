/* ═══════════════════════════════════════════════════════════════
   Banc — Sélecteur de mode géré / BYOK par app publique (Sprint P7)
   ─────────────────────────────────────────────────────────────
   Ce banc protège TROIS choses, dans cet ordre d'importance :

   1. Le DÉFAUT. Une ligne absente doit valoir « géré » — donc débitée.
      Si un jour l'absence devenait « BYOK », toutes les apps publiques
      cesseraient de compter leurs conversations en silence. C'est le
      même piège que `ks_owned_assets` absent = TOUT (handoff §Pièges).

   2. La DÉGRADATION. Un BYOK dont la clé a lâché doit repasser en géré :
      c'est ce qui referme la fuite « clé morte = servi gratuitement,
      indéfiniment, sans trace ».

   3. Le fait qu'on ne puisse PAS déclarer BYOK sans clé — sinon on
      fabrique une surface publique muette, ce que le défaut « géré »
      existe précisément pour éviter.

   Lancement : node scripts/test-app-mode.mjs   (inclus dans npm test)
   ═══════════════════════════════════════════════════════════════ */

import {
  MODE, DEFAULT_MODE, PUBLIC_SURFACE_APPS, isPublicSurfaceApp,
  decideMode, canDeclareByok, needsCreditWall, APP_LABEL,
} from '../workers/src/lib/app-mode.js';

import { quotaForEntitlements, TIERS, TIER } from '../workers/src/lib/pricing-grid.js';

import * as front from '../app/lib/pricing.js';

let ok = 0, ko = 0;
const G = s => `\x1b[32m${s}\x1b[0m`, R = s => `\x1b[31m${s}\x1b[0m`;
function t(nom, réel, attendu) {
  const pass = JSON.stringify(réel) === JSON.stringify(attendu);
  pass ? ok++ : ko++;
  console.log(`  ${pass ? G('✓') : R('✗')} ${nom}`
    + (pass ? '' : R(`\n      attendu ${JSON.stringify(attendu)}\n      reçu    ${JSON.stringify(réel)}`)));
}

const AGENT = 'O-AGT-001';   // Smart Agent
const QR    = 'A-COM-001';   // Smart QR (Concierge)
const GW    = 'A-COM-005';   // Ghost Writer — surface PROPRIÉTAIRE

const row = (o = {}) => ({ mode: 'MANAGED', degraded_at: null, degraded_reason: null, ...o });

console.log('\n\x1b[1m▶ Le DÉFAUT — absence de ligne = géré, donc débité\x1b[0m');
t('aucune ligne → géré',           decideMode(null, AGENT).mode, MODE.MANAGED);
t('aucune ligne → non dégradé',    decideMode(null, AGENT).degraded, false);
t('aucune ligne → raison lisible', decideMode(null, AGENT).reason, 'default');
t('la constante de défaut EST géré (le reste du banc en dépend)', DEFAULT_MODE, MODE.MANAGED);
t('même défaut sur le Concierge',  decideMode(null, QR).mode, MODE.MANAGED);
t('ligne vide/corrompue → géré',   decideMode({}, AGENT).mode, MODE.MANAGED);
t('mode inconnu → géré (jamais BYOK par accident)',
  decideMode(row({ mode: 'GRATUIT' }), AGENT).mode, MODE.MANAGED);
t('mode null → géré',              decideMode(row({ mode: null }), AGENT).mode, MODE.MANAGED);

console.log('\n\x1b[1m▶ Déclaration explicite\x1b[0m');
t('BYOK déclaré, clé saine → BYOK',
  decideMode(row({ mode: 'BYOK' }), AGENT).mode, MODE.BYOK);
t('BYOK en minuscules accepté',
  decideMode(row({ mode: 'byok' }), AGENT).mode, MODE.BYOK);
t('géré déclaré → géré',
  decideMode(row({ mode: 'MANAGED' }), AGENT).mode, MODE.MANAGED);
t('déclaré ET appliqué coïncident quand tout va bien',
  decideMode(row({ mode: 'BYOK' }), AGENT).declared, MODE.BYOK);

console.log('\n\x1b[1m▶ La DÉGRADATION — la fuite qu\'on vient boucher\x1b[0m');
const degrade = decideMode(row({ mode: 'BYOK', degraded_at: '2026-07-25 20:00:00' }), AGENT);
t('clé morte → le mode APPLIQUÉ retombe en géré (⇒ compté)', degrade.mode, MODE.MANAGED);
t('mais le mode DÉCLARÉ reste BYOK (on n\'efface pas son choix)', degrade.declared, MODE.BYOK);
t('le drapeau dégradé est visible (l\'écran doit pouvoir le dire)', degrade.degraded, true);
t('raison explicite', degrade.reason, 'degraded');
t('une dégradation sur un mode GÉRÉ n\'a aucun sens → reste géré, non dégradé',
  decideMode(row({ mode: 'MANAGED', degraded_at: '2026-07-25 20:00:00' }), AGENT).degraded, false);

console.log('\n\x1b[1m▶ Périmètre — seules les 2 surfaces publiques sont concernées\x1b[0m');
t('Smart Agent est une surface publique', isPublicSurfaceApp(AGENT), true);
t('Smart QR est une surface publique',    isPublicSurfaceApp(QR), true);
t('Ghost Writer ne l\'est pas',           isPublicSurfaceApp(GW), false);
t('exactement 2 surfaces publiques (en ajouter une est une DÉCISION)',
  PUBLIC_SURFACE_APPS.length, 2);
t('une app propriétaire est toujours en géré, même avec une ligne BYOK en base',
  decideMode(row({ mode: 'BYOK' }), GW).mode, MODE.MANAGED);
t('… et le dit',
  decideMode(row({ mode: 'BYOK' }), GW).reason, 'not_public_surface');
t('id inconnu → géré (pas de porte dérobée par faute de frappe)',
  decideMode(row({ mode: 'BYOK' }), 'O-XXX-999').mode, MODE.MANAGED);

console.log('\n\x1b[1m▶ On ne déclare pas BYOK sans clé (sinon : app muette)\x1b[0m');
t('aucune clé au coffre → refus',
  canDeclareByok([], 'claude'), { ok: false, reason: 'no_key' });
t('des clés mais aucun moteur actif → refus',
  canDeclareByok(['claude'], null), { ok: false, reason: 'no_active_engine' });
t('une clé, mais pas pour le moteur ACTIF → refus',
  canDeclareByok(['claude'], 'gpt'), { ok: false, reason: 'active_engine_has_no_key' });
t('clé du moteur actif présente → autorisé',
  canDeclareByok(['gpt', 'claude'], 'claude'), { ok: true, reason: 'ok' });
t('argument non-tableau → refus (pas de crash, pas de laissez-passer)',
  canDeclareByok(undefined, 'claude'), { ok: false, reason: 'no_key' });

console.log('\n\x1b[1m▶ Le mur s\'arme au provisionnement (sinon le défaut « géré » = open bar)\x1b[0m');
t('sac avec Smart Agent → mur armé',        needsCreditWall([AGENT]), true);
t('sac avec Smart QR → mur armé',           needsCreditWall(['A-COM-002', QR]), true);
t('sac sans app publique → on n\'arme rien (on ne bride pas qui ne coûte pas)',
  needsCreditWall([GW, 'O-DSK-001']), false);
t('sac vide → non',                          needsCreditWall([]), false);
t('sentinelle OS → mur armé (elle CONTIENT les deux apps publiques)',
  needsCreditWall(['OS']), true);
t('sac null (legacy « accès total ») → non, et surtout pas de crash',
  needsCreditWall(null), false);

console.log('\n\x1b[1m▶ Le client OS à 129 € n\'est PAS illimité (l\'ordre des tests porte de l\'argent)\x1b[0m');
t('sac OS + plan technique MAX → 3 000, pas illimité',
  quotaForEntitlements({ plan: 'MAX', ownedAssets: ['OS'] }), 3000);
t('… c\'est bien le palier OS vendu',
  quotaForEntitlements({ plan: 'MAX', ownedAssets: ['OS'] }), TIERS[TIER.OS].conversations);
t('MAX legacy SANS sac → illimité (on ne retire pas un acquis par surprise)',
  quotaForEntitlements({ plan: 'MAX', ownedAssets: null }), null);
t('ADMIN reste illimité',
  quotaForEntitlements({ plan: 'ADMIN', ownedAssets: ['OS'] }), null);
t('une app Pro seule → 1 000',
  quotaForEntitlements({ plan: 'PRO', ownedAssets: [QR] }), 1000);
t('Smart Agent seul (99 €) → 1 000',
  quotaForEntitlements({ plan: 'PRO', ownedAssets: [AGENT] }), 1000);

console.log('\n\x1b[1m▶ Anti-dérive front ↔ worker\x1b[0m');
t('MODE identique des deux côtés',            front.MODE, MODE);
t('DEFAULT_MODE identique des deux côtés',    front.DEFAULT_MODE, DEFAULT_MODE);
t('PUBLIC_SURFACE_APPS identique',            front.PUBLIC_SURFACE_APPS, PUBLIC_SURFACE_APPS);
t('isPublicSurfaceApp() d\'accord sur Smart Agent', front.isPublicSurfaceApp(AGENT), isPublicSurfaceApp(AGENT));
t('isPublicSurfaceApp() d\'accord sur Ghost Writer', front.isPublicSurfaceApp(GW), isPublicSurfaceApp(GW));
t('chaque surface publique a un libellé client (l\'e-mail de panne en dépend)',
  PUBLIC_SURFACE_APPS.every(id => typeof APP_LABEL[id] === 'string' && APP_LABEL[id].length > 2), true);

console.log(`\n${ko === 0 ? G('✓ ' + ok + ' tests, 0 échec') : R('✗ ' + ko + ' échec(s) sur ' + (ok + ko))}\n`);
process.exit(ko === 0 ? 0 : 1);
