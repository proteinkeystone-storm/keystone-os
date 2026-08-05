/* ═══════════════════════════════════════════════════════════════
   Banc — Recharge automatique (Sprint P3)
   ─────────────────────────────────────────────────────────────
   Ce banc teste la seule chose qui compte vraiment ici : les
   conditions dans lesquelles on N'A PAS le droit de débiter.

   Un faux positif dans `shouldReload()` = un prélèvement qu'un client
   n'a pas autorisé. Chaque verrou a donc son test, et le test qui
   compte le plus est celui du PLAFOND — il vérifie qu'on refuse un
   pack de 39 € quand il ne reste que 30 € d'autorisation, au lieu de
   débiter « presque dans les clous ».

   Lancement : node scripts/test-auto-reload.mjs   (inclus dans npm test)
   ═══════════════════════════════════════════════════════════════ */

import {
  shouldReload, remainingCapCents, monthUtcOf, PACK_PRICE_CENTS,
  DEFAULT_CAP_EUR, DEFAULT_THRESHOLD, MIN_INTERVAL_MS, PAUSE,
} from '../workers/src/lib/auto-reload.js';

let ok = 0, ko = 0;
const G = s => `\x1b[32m${s}\x1b[0m`, R = s => `\x1b[31m${s}\x1b[0m`;
function t(nom, réel, attendu) {
  const pass = JSON.stringify(réel) === JSON.stringify(attendu);
  pass ? ok++ : ko++;
  console.log(`  ${pass ? G('✓') : R('✗')} ${nom}`
    + (pass ? '' : R(`\n      attendu ${JSON.stringify(attendu)}\n      reçu    ${JSON.stringify(réel)}`)));
}

const MOIS = '2026-07';
const T0   = Date.parse('2026-07-25T12:00:00Z');

// Config nominale : opt-in, consentie, carte en place, rien dépensé.
const base = {
  enabled: 1, threshold: DEFAULT_THRESHOLD, pack_lookup: 'ks_pack_1000',
  cap_cents: DEFAULT_CAP_EUR * 100, spent_cents: 0, spent_month: MOIS,
  stripe_customer: 'cus_X', payment_method: 'pm_X',
  consent_at: '2026-07-20 10:00:00', consent_ip: '1.2.3.4', consent_version: 'v1',
  last_reload_at: null, paused_at: null, paused_reason: null,
};
const cfg = (o = {}) => ({ ...base, ...o });
const verdict = (c, reste, now = T0) => shouldReload(c, reste, now, MOIS).reason;

console.log('\n\x1b[1m▶ Le cas nominal — et lui seul doit débiter\x1b[0m');
const nominal = shouldReload(cfg(), 10, T0, MOIS);
t('sous le seuil → on recharge', nominal.ok, true);
t('pack retenu',                 nominal.packLookup, 'ks_pack_1000');
t('montant en centimes',         nominal.amountCents, 900);
t('conversations créditées',     nominal.conversations, 1000);
t('au-dessus du seuil → non',    verdict(cfg(), 500), 'above_threshold');
t('pile SUR le seuil → on recharge (>, pas >=)', shouldReload(cfg(), DEFAULT_THRESHOLD, T0, MOIS).ok, true);

console.log('\n\x1b[1m▶ Verrou 1 — opt-in\x1b[0m');
t('config absente',        verdict(null, 0), 'not_configured');
t('enabled = 0',           verdict(cfg({ enabled: 0 }), 0), 'disabled');
t('enabled falsy divers',  verdict(cfg({ enabled: null }), 0), 'disabled');

console.log('\n\x1b[1m▶ Verrou 2 — le PLAFOND est un mur\x1b[0m');
t('déjà 20 € dépensés sur 20 €',
  verdict(cfg({ spent_cents: 2000 }), 0), PAUSE.CAP);
t('reste 3 € et le pack coûte 9 € → REFUS (pas de débit « presque dans les clous »)',
  verdict(cfg({ spent_cents: 1700 }), 0), PAUSE.CAP);
t('reste exactement le prix du pack → autorisé',
  shouldReload(cfg({ spent_cents: 2000 - 900 }), 0, T0, MOIS).ok, true);
t('un centime de moins → refusé',
  verdict(cfg({ spent_cents: 2000 - 899 }), 0), PAUSE.CAP);
t('pack 5000 (39 €) sous un plafond de 20 € → jamais débitable',
  verdict(cfg({ pack_lookup: 'ks_pack_5000' }), 0), PAUSE.CAP);
t('pack 5000 avec plafond 50 € → autorisé',
  shouldReload(cfg({ pack_lookup: 'ks_pack_5000', cap_cents: 5000 }), 0, T0, MOIS).ok, true);
t('dépense d\'un mois RÉVOLU ne compte plus',
  shouldReload(cfg({ spent_cents: 2000, spent_month: '2026-06' }), 0, T0, MOIS).ok, true);
t('remainingCapCents ignore l\'autre mois',
  remainingCapCents(cfg({ spent_cents: 2000, spent_month: '2026-06' }), MOIS), 2000);
// Tous les tests ci-dessus passent le mois À LA MAIN — le DÉFAUT, lui,
// n'était jamais éprouvé. Il lisait l'horloge du serveur : le plafond de
// juillet était vu comme « un mois révolu » dès qu'on était en août, donc
// remis à zéro, donc jamais atteint. Le balayage débitait au lieu de
// s'arrêter au mur. Ces deux lignes tiennent la porte fermée.
t('sans mois explicite, le mois vient de nowMs (pas de l\'horloge du serveur)',
  shouldReload(cfg({ spent_cents: 2000 }), 0, T0).reason, PAUSE.CAP);
t('monthUtcOf lit l\'instant qu\'on lui donne',
  monthUtcOf(T0), MOIS);

console.log('\n\x1b[1m▶ Verrou 3 — trace de consentement\x1b[0m');
t('aucun consentement → refus', verdict(cfg({ consent_at: null }), 0), 'no_consent');

console.log('\n\x1b[1m▶ Verrou 4 — anti-rafale\x1b[0m');
t('rechargé il y a 1 minute',
  verdict(cfg({ last_reload_at: '2026-07-25 11:59:00' }), 0), 'too_soon');
t('rechargé il y a 9 minutes (< 10)',
  verdict(cfg({ last_reload_at: '2026-07-25 11:51:00' }), 0), 'too_soon');
t('rechargé il y a 11 minutes → autorisé',
  shouldReload(cfg({ last_reload_at: '2026-07-25 11:49:00' }), 0, T0, MOIS).ok, true);
t('horodatage illisible → ne bloque pas (fail-open sur le confort, pas sur l\'argent)',
  shouldReload(cfg({ last_reload_at: 'n\'importe quoi' }), 0, T0, MOIS).ok, true);
t('l\'intervalle dépasse le pas du cron (5 min)', MIN_INTERVAL_MS > 5 * 60 * 1000, true);

console.log('\n\x1b[1m▶ Verrou 5 — pause collante\x1b[0m');
t('en pause carte refusée',
  verdict(cfg({ paused_at: '2026-07-24 09:00:00', paused_reason: PAUSE.PAYMENT }), 0),
  'paused:' + PAUSE.PAYMENT);
t('en pause plafond',
  verdict(cfg({ paused_at: '2026-07-24 09:00:00', paused_reason: PAUSE.CAP }), 0),
  'paused:' + PAUSE.CAP);
t('la pause gagne même sous le seuil et avec du plafond dispo',
  shouldReload(cfg({ paused_at: '2026-07-24 09:00:00' }), 0, T0, MOIS).ok, false);

console.log('\n\x1b[1m▶ Carte / client Stripe manquants\x1b[0m');
t('pas de moyen de paiement', verdict(cfg({ payment_method: null }), 0), PAUSE.NO_CARD);
t('pas de client Stripe',     verdict(cfg({ stripe_customer: null }), 0), PAUSE.NO_CARD);

console.log('\n\x1b[1m▶ Quota illimité — rien à recharger\x1b[0m');
t('remaining null (ADMIN/MAX legacy)', verdict(cfg(), null), 'unlimited');
t('remaining undefined',               verdict(cfg(), undefined), 'unlimited');

console.log('\n\x1b[1m▶ Cohérence des montants\x1b[0m');
t('les prix sont en CENTIERS entiers (aucun flottant dans un calcul d\'argent)',
  Object.values(PACK_PRICE_CENTS).every(Number.isInteger), true);
t('pack 1000 = 900 c', PACK_PRICE_CENTS.ks_pack_1000, 900);
t('pack 5000 = 3900 c', PACK_PRICE_CENTS.ks_pack_5000, 3900);
t('pack_lookup inconnu → repli sur le petit pack, jamais le gros',
  shouldReload(cfg({ pack_lookup: 'ks_pack_999999' }), 0, T0, MOIS).packLookup, 'ks_pack_1000');

console.log('\n\x1b[1m▶ Pureté — aucun effet de bord\x1b[0m');
const avant = cfg();
const copie = JSON.parse(JSON.stringify(avant));
shouldReload(avant, 0, T0, MOIS);
t('shouldReload ne modifie pas sa config', JSON.stringify(avant), JSON.stringify(copie));

console.log(`\n${ok + ko} tests — ${ko ? R(ko + ' ko') : G(ok + ' ok')}${ko ? R(`, ${ok} ok`) : ', 0 ko'}\n`);
process.exit(ko ? 1 : 0);
