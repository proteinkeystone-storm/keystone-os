/* ═══════════════════════════════════════════════════════════════
   Social Broadcast — correctif CSRF de liaison de compte OAuth (#1)
   ───────────────────────────────────────────────────────────────
   Banc UNITAIRE (pas de worker à lancer) : il exerce directement
   lib/social/pending-link.js contre un mock D1 fidèle aux requêtes
   réelles du module. Il prouve l'invariant qui FERME la faille :

     · la propriété d'un compte se fixe sur le tenant QUI CONFIRME,
       jamais sur l'initiateur du flux (le `state`) ;
     · un claim_code est à USAGE UNIQUE (pas de rejeu) ;
     · une liaison EXPIRÉE est refusée et consommée ;
     · un code mal formé est refusé sans toucher la base ;
     · le jeton est CHIFFRÉ au repos, même en attente.

   Lancer :  node test/test-social-pending-link.mjs
   ═══════════════════════════════════════════════════════════════ */

import { stashPendingAccounts, confirmPendingLink, frontOrigin } from '../src/lib/social/pending-link.js';
import { decrypt } from '../src/lib/crypto.js';

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗ ÉCHEC:', label); } }

// ── Mock D1 fidèle aux SQL du module ───────────────────────────
function makeDB() {
  const pending  = new Map();   // claim_code → { payload, summary, expires_at }
  const accounts = [];          // rows social_accounts
  const nowIso = () => new Date().toISOString();

  function prepare(sql) {
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },
      async run() {
        if (/CREATE TABLE/.test(sql)) return { meta: { changes: 0 } };
        if (/DELETE FROM social_pending_links WHERE expires_at < datetime/.test(sql)) {
          for (const [k, v] of pending) if (v.expires_at < nowIso()) pending.delete(k);
          return { meta: { changes: 0 } };
        }
        if (/INSERT INTO social_pending_links/.test(sql)) {
          const [claim_code, payload, summary, expires_at] = args;
          pending.set(claim_code, { payload, summary, expires_at });
          return { meta: { changes: 1 } };
        }
        if (/UPDATE social_accounts/.test(sql)) {
          const id  = args[args.length - 1];
          const row = accounts.find(r => r.id === id);
          if (row) { row.access_ciphertext = args[0]; row.access_iv = args[1]; row.display_name = args[2]; row.status = 'connected'; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (/INSERT INTO social_accounts/.test(sql)) {
          const [id, tenant_id, platform, target_type, external_id, display_name, ct, iv, scopes, expires_at] = args;
          accounts.push({ id, tenant_id, platform, target_type, external_id, display_name, access_ciphertext: ct, access_iv: iv, scopes, expires_at, status: 'connected' });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
      async first() {
        if (/DELETE FROM social_pending_links WHERE claim_code = \? RETURNING/.test(sql)) {
          const [code] = args;
          const row = pending.get(code);
          if (!row) return null;
          pending.delete(code);            // consommation atomique (usage unique)
          return { payload: row.payload, expires_at: row.expires_at };
        }
        if (/SELECT id FROM social_accounts/.test(sql)) {
          const [tenant_id, platform, external_id] = args;
          return accounts.find(r => r.tenant_id === tenant_id && r.platform === platform && r.external_id === external_id) || null;
        }
        return null;
      },
    };
    return api;
  }
  return { _pending: pending, _accounts: accounts, prepare };
}

const KEY = 'test-encryption-key-32-chars-minimum!!';
const env = { DB: null, KS_ENCRYPTION_KEY: KEY, KS_ALLOWED_ORIGIN: 'https://protein-keystone.com,https://www.protein-keystone.com' };

// ── 1 + 5 : propriété = tenant confirmant ; jeton chiffré ──────
{
  env.DB = makeDB();
  const { claimCode } = await stashPendingAccounts(env, {
    accounts: [{ platform: 'facebook', targetType: 'page', externalId: 'PAGE-VICTIME', displayName: 'Page Victime', token: 'TOKEN-SECRET-VICTIME', scopes: 'pages' }],
    summary: 'Page Victime',
  });
  ok(/^[0-9a-f]{64}$/.test(claimCode), 'claim_code = 256 bits hex');

  const stored = env.DB._pending.get(claimCode);
  ok(stored && !stored.payload.includes('TOKEN-SECRET-VICTIME'), 'jeton NON présent en clair dans la liaison en attente');

  // Le tenant du confirmant devient propriétaire — c'est TOUT le correctif.
  const res = await confirmPendingLink(env, { claimCode, tenant: 'tenant-du-confirmant' });
  ok(res.ok === true, 'confirmation réussie');
  const row = env.DB._accounts.find(r => r.external_id === 'PAGE-VICTIME');
  ok(row && row.tenant_id === 'tenant-du-confirmant', 'compte rangé sous le tenant QUI CONFIRME');
  const back = await decrypt(row.access_ciphertext, row.access_iv, KEY);
  ok(back === 'TOKEN-SECRET-VICTIME', 'jeton redéchiffrable (chiffré au repos)');
}

// ── 2 : usage unique ──────────────────────────────────────────
{
  env.DB = makeDB();
  const { claimCode } = await stashPendingAccounts(env, {
    accounts: [{ platform: 'threads', externalId: 'TH1', displayName: '@x', token: 'T', scopes: '' }],
    summary: '@x',
  });
  const first  = await confirmPendingLink(env, { claimCode, tenant: 'A' });
  const second = await confirmPendingLink(env, { claimCode, tenant: 'B' });
  ok(first.ok === true, 'première confirmation OK');
  ok(second.ok === false && second.reason === 'introuvable', 'rejeu du même code refusé (usage unique)');
  ok(env.DB._accounts.filter(r => r.external_id === 'TH1').length === 1, 'aucun doublon créé par le rejeu');
}

// ── 3 : expiration ────────────────────────────────────────────
{
  env.DB = makeDB();
  const { claimCode } = await stashPendingAccounts(env, {
    accounts: [{ platform: 'linkedin', externalId: 'LI1', displayName: 'Profil', token: 'T', scopes: '' }],
    summary: 'Profil',
  });
  env.DB._pending.get(claimCode).expires_at = new Date(Date.now() - 1000).toISOString();
  const res = await confirmPendingLink(env, { claimCode, tenant: 'A' });
  ok(res.ok === false && res.reason === 'expire', 'liaison expirée refusée');
  ok(!env.DB._pending.has(claimCode), 'liaison expirée consommée (supprimée)');
  ok(env.DB._accounts.length === 0, 'aucun compte rangé pour une liaison expirée');
}

// ── 4 : format invalide / tenant absent ───────────────────────
{
  env.DB = makeDB();
  const res = await confirmPendingLink(env, { claimCode: 'pas-un-code', tenant: 'A' });
  ok(res.ok === false && res.reason === 'code_invalide', 'code mal formé refusé');
  const res2 = await confirmPendingLink(env, { claimCode: 'a'.repeat(64), tenant: '' });
  ok(res2.ok === false && res2.reason === 'tenant_absent', 'tenant absent refusé');
}

// ── frontOrigin : première origine https, jamais '*' ──────────
{
  ok(frontOrigin(env) === 'https://protein-keystone.com', 'frontOrigin = 1re origine https configurée');
  ok(frontOrigin({ KS_ALLOWED_ORIGIN: '*' }) === null, "frontOrigin('*') = null (pas de postMessage non sûr)");
  ok(frontOrigin({}) === null, 'frontOrigin sans conf = null');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} OK, ${fail} échec(s)`);
process.exit(fail === 0 ? 0 : 1);
