/* ═══════════════════════════════════════════════════════════════
   Banc — Balayage de recharge auto (P3) : simulation ET vrai passage
   ─────────────────────────────────────────────────────────────
   Ce que ce banc prouve, dans l'ordre d'importance :

   1. LA SIMULATION NE PEUT PAS DÉBITER. `globalThis.fetch` est remplacé
      par une grenade qui explose au premier appel : si la simulation
      touchait le réseau — Stripe, Resend, n'importe quoi — le banc
      casse. C'est une garantie mécanique, pas une convention.
   2. La simulation n'ÉCRIT rien : ni pause, ni crédit, ni journal.
      Rejouable à l'infini sans changer l'état.
   3. Elle examine TOUTES les configs (désarmées et en pause comprises)
      et donne la raison exacte — c'est un outil de diagnostic.
   4. Le VRAI passage, lui, crédite après un débit confirmé, journalise,
      et met en pause sur une carte refusée — sur le même faux D1, avec
      un faux Stripe.

   Le faux D1 route les requêtes par motif SQL. C'est volontairement
   bête : si une requête du code réel ne matche plus, le banc casse et
   c'est le signal qu'il faut le mettre à jour.

   Lancement : node scripts/test-auto-reload-sweep.mjs  (dans npm test)
   ═══════════════════════════════════════════════════════════════ */

import { runAutoReloadSweep } from '../workers/src/routes/auto-reload-sweep.js';

let ok = 0, ko = 0;
const G = s => `\x1b[32m${s}\x1b[0m`, R = s => `\x1b[31m${s}\x1b[0m`;
function t(nom, réel, attendu) {
  const pass = JSON.stringify(réel) === JSON.stringify(attendu);
  pass ? ok++ : ko++;
  console.log(`  ${pass ? G('✓') : R('✗')} ${nom}`
    + (pass ? '' : R(`\n      attendu ${JSON.stringify(attendu)}\n      reçu    ${JSON.stringify(réel)}`)));
}

// ── Faux D1 — routage par motif SQL ──────────────────────────────
function fakeEnv(state) {
  const writes = [];
  const respond = (sql, args) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(CREATE|ALTER)/i.test(s)) return { run: {} };
    if (s.includes('FROM ai_auto_reload ORDER BY'))
      return { all: { results: state.configs } };
    if (s.includes('FROM ai_auto_reload WHERE enabled = 1'))
      return { all: { results: state.configs.filter(c => c.enabled === 1 && !c.paused_at && c.consent_at) } };
    if (s.includes('FROM ai_auto_reload WHERE lookup_hmac'))
      return { first: state.configs.find(c => c.lookup_hmac === args[0]) || null };
    if (s.includes('SELECT plan, owned_assets FROM licences'))
      return { first: state.licence };
    if (s.includes('COALESCE(SUM(used)'))
      return { first: { total: state.used } };
    if (s.includes('SELECT balance FROM ai_credit_balance'))
      return { first: { balance: state.packs } };
    if (s.includes('FROM ai_auto_reload_log WHERE payment_intent'))
      return { first: null };
    if (s.includes('COALESCE(customer_email, owner)'))
      return { first: { mail: 'client@exemple.fr' } };
    if (/^(UPDATE|INSERT)/i.test(s)) { writes.push(s.slice(0, 60)); return { run: {} }; }
    throw new Error('SQL non routé par le faux D1 : ' + s.slice(0, 80));
  };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => { const r = respond(sql, args); if (!('first' in r)) throw new Error('first inattendu'); return r.first; },
    all:   async () => { const r = respond(sql, args); if (!('all'   in r)) throw new Error('all inattendu');   return r.all; },
    run:   async () => { respond(sql, args); return {}; },
  });
  return {
    // PRICING_V2 obligatoire : sans lui, resolveQuota() retombe sur le
    // palier du plan TECHNIQUE (PRO = 1000) au lieu du sac d'apps — le
    // restant vaudrait 700 et tout serait « above_threshold ». C'est le
    // piège documenté du handoff, et ce banc lui-même s'y est fait
    // prendre à sa première exécution.
    env: { KS_STRIPE_SECRET: 'sk_fake', PRICING_V2: 'on', DB: { prepare: (sql) => stmt(sql) } },
    writes,
  };
}

const T0 = Date.parse('2026-07-25T12:00:00Z');
const cfgArmee = {
  lookup_hmac: 'aaaa1111bbbb2222', enabled: 1, threshold: 50,
  pack_lookup: 'ks_pack_1000', cap_cents: 2000, spent_cents: 0, spent_month: '2026-07',
  stripe_customer: 'cus_X', payment_method: 'pm_X',
  consent_at: '2026-07-20 10:00:00', last_reload_at: null, paused_at: null, paused_reason: null,
};
// Licence Essentiel (300 incluses) à sec : recharge attendue.
const etatASec = { licence: { plan: 'PRO', owned_assets: '["A-COM-005"]' }, used: 300, packs: 0 };

// ── 1 & 2 · La simulation ne touche ni le réseau ni la base ──────
console.log('\n\x1b[1m▶ Simulation — zéro réseau, zéro écriture\x1b[0m');
const grenade = () => { throw new Error('APPEL RÉSEAU EN SIMULATION'); };
const fetchAvant = globalThis.fetch;
globalThis.fetch = grenade;
let bilanSim, explosion = null;
try {
  const { env, writes } = fakeEnv({ configs: [cfgArmee], ...etatASec });
  bilanSim = await runAutoReloadSweep(env, { now: T0, simulate: true });
  t('aucun appel réseau (la grenade n\'a pas sauté)', true, true);
  t('aucune écriture en base', writes, []);
} catch (e) { explosion = e.message; }
finally { globalThis.fetch = fetchAvant; }
if (explosion) t('simulation sans effet de bord', explosion, null);
t('marquée simulate', bilanSim?.simulate, true);
t('elle DÉBITERAIT (licence à sec, tout est en règle)', bilanSim?.rechargees, 1);
t('le détail annonce le montant', /DÉBITERAIT 900c/.test(bilanSim?.details?.[0] || ''), true);
t('…et la clé d\'idempotence', /clé=arl_/.test(bilanSim?.details?.[0] || ''), true);

// ── 3 · Diagnostic : les refus sont expliqués, licence par licence ─
console.log('\n\x1b[1m▶ Simulation — outil de diagnostic\x1b[0m');
globalThis.fetch = grenade;
try {
  const configs = [
    { ...cfgArmee, lookup_hmac: 'd1sarmee00000000', enabled: 0 },
    { ...cfgArmee, lookup_hmac: 'enpause000000000', paused_at: '2026-07-24', paused_reason: 'payment_failed' },
    { ...cfgArmee, lookup_hmac: 'plafond000000000', spent_cents: 2000 },
  ];
  const { env } = fakeEnv({ configs, ...etatASec });
  const b = await runAutoReloadSweep(env, { now: T0, simulate: true });
  t('les 3 configs sont examinées (même hors listArmed)', b.examinees, 3);
  t('désarmée → disabled',      /disabled/.test(b.details[0]), true);
  t('en pause → paused',        /paused:payment_failed/.test(b.details[1]), true);
  t('plafond → cap_reached',    /cap_reached/.test(b.details[2]), true);
  t('aucune n\'est comptée en pause (la simulation ne pause pas)', b.pausees, 0);
} finally { globalThis.fetch = fetchAvant; }

// ── 4 · Le vrai passage, sur faux Stripe ─────────────────────────
console.log('\n\x1b[1m▶ Vrai passage — débit confirmé PUIS crédit\x1b[0m');
globalThis.fetch = async (url) => {
  if (String(url).includes('payment_intents'))
    return { ok: true, status: 200, json: async () => ({ id: 'pi_test_1', status: 'succeeded' }) };
  throw new Error('appel inattendu : ' + url);
};
try {
  const { env, writes } = fakeEnv({ configs: [cfgArmee], ...etatASec });
  const b = await runAutoReloadSweep(env, { now: T0 });
  t('1 recharge effectuée', b.rechargees, 1);
  t('le solde de packs est crédité',  writes.some(w => w.includes('ai_credit_balance')), true);
  t('la dépense du mois est inscrite', writes.some(w => w.includes('UPDATE ai_auto_reload')), true);
  t('le débit est journalisé',         writes.some(w => w.includes('ai_auto_reload_log')), true);
} finally { globalThis.fetch = fetchAvant; }

console.log('\n\x1b[1m▶ Vrai passage — carte refusée = pause, pas de crédit\x1b[0m');
globalThis.fetch = async (url) => {
  if (String(url).includes('payment_intents'))
    return { ok: false, status: 402, json: async () => ({ error: { code: 'card_declined' } }) };
  if (String(url).includes('resend'))
    return { ok: true, status: 200, json: async () => ({ id: 'email_1' }) };
  throw new Error('appel inattendu : ' + url);
};
try {
  const { env, writes } = fakeEnv({ configs: [cfgArmee], ...etatASec });
  const b = await runAutoReloadSweep(env, { now: T0 });
  t('0 recharge', b.rechargees, 0);
  t('1 mise en pause', b.pausees, 1);
  t('AUCUN crédit de packs', writes.some(w => w.includes('ai_credit_balance')), false);
  t('la pause est écrite', writes.some(w => w.includes('UPDATE ai_auto_reload')), true);
} finally { globalThis.fetch = fetchAvant; }

console.log(`\n${ok + ko} tests — ${ko ? R(ko + ' ko') : G(ok + ' ok')}${ko ? R(`, ${ok} ok`) : ', 0 ko'}\n`);
process.exit(ko ? 1 : 0);
