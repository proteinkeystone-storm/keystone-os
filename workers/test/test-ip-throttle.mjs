/* ═══════════════════════════════════════════════════════════════
   Anti-abus par IP — correctif #2 (empreinte UA+IP contournable)
   ───────────────────────────────────────────────────────────────
   Banc UNITAIRE (pas de worker) : exerce lib/ip-throttle.js contre un
   mock D1 fidèle. Prouve :
     · l'empreinte NE dépend QUE de l'IP (rotation d'UA sans effet) ;
     · le plafond refuse à count >= cap, admet en dessous ;
     · bump incrémente ; deux IP distinctes = deux compteurs ;
     · base muette = FAIL-OPEN (on laisse passer).
   Lancer :  node test/test-ip-throttle.mjs
   ═══════════════════════════════════════════════════════════════ */

import { ipHashOf, ipRateExceeded, ipRateBump } from '../src/lib/ip-throttle.js';

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗ ÉCHEC:', l); } }

function makeDB() {
  const rows = new Map();   // `${scope}|${day}|${ip}` → count
  const key = (s, d, i) => `${s}|${d}|${i}`;
  function prepare(sql) {
    let a = [];
    return {
      bind(...x) { a = x; return this; },
      async run() {
        if (/CREATE TABLE|CREATE INDEX/.test(sql)) return { meta: { changes: 0 } };
        if (/INSERT INTO public_ip_usage/.test(sql)) {
          const [scope, day, ip] = a;
          const k = key(scope, day, ip);
          rows.set(k, (rows.get(k) || 0) + 1);
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
      async first() {
        if (/SELECT count FROM public_ip_usage/.test(sql)) {
          const [scope, day, ip] = a;
          const v = rows.get(key(scope, day, ip));
          return v == null ? null : { count: v };
        }
        return null;
      },
    };
  }
  return { _rows: rows, prepare };
}

function req(ip, ua) {
  return { headers: { get: (h) => h.toLowerCase() === 'cf-connecting-ip' ? ip : (h.toLowerCase() === 'user-agent' ? ua : null) } };
}

// ── L'empreinte ne dépend QUE de l'IP ─────────────────────────
{
  const h1 = await ipHashOf(req('203.0.113.7', 'Mozilla/5.0 AAAA'));
  const h2 = await ipHashOf(req('203.0.113.7', 'curl/8 ZZZZ-different-UA'));
  const h3 = await ipHashOf(req('203.0.113.8', 'Mozilla/5.0 AAAA'));
  ok(h1 === h2, "même IP, UA différent → MÊME empreinte (rotation d'UA sans effet)");
  ok(h1 !== h3, 'IP différente → empreinte différente');
  ok(/^[0-9a-f]{16}$/.test(h1), 'empreinte = 16 hex');
}

// ── Plafond : admet sous le cap, refuse à cap ─────────────────
{
  const env = { DB: makeDB() };
  const ip = await ipHashOf(req('198.51.100.1'));
  const CAP = 5;
  let admitted = 0;
  for (let i = 0; i < 20; i++) {
    if (await ipRateExceeded(env, 'agent:demo', ip, CAP)) break;
    await ipRateBump(env, 'agent:demo', ip);
    admitted++;
  }
  ok(admitted === CAP, `admis exactement ${CAP} fois puis refusé (cap respecté)`);
  ok(await ipRateExceeded(env, 'agent:demo', ip, CAP) === true, 'au-delà du cap → refusé');
}

// ── Deux IP distinctes = deux compteurs indépendants ──────────
{
  const env = { DB: makeDB() };
  const ipA = await ipHashOf(req('198.51.100.10'));
  const ipB = await ipHashOf(req('198.51.100.11'));
  for (let i = 0; i < 4; i++) await ipRateBump(env, 'concierge:X', ipA);
  ok(await ipRateExceeded(env, 'concierge:X', ipA, 4) === true, 'IP A atteint son cap');
  ok(await ipRateExceeded(env, 'concierge:X', ipB, 4) === false, "IP B intacte (compteurs indépendants)");
}

// ── Scopes distincts n'interfèrent pas ────────────────────────
{
  const env = { DB: makeDB() };
  const ip = await ipHashOf(req('198.51.100.20'));
  for (let i = 0; i < 3; i++) await ipRateBump(env, 'agent:s1', ip);
  ok(await ipRateExceeded(env, 'agent:s2', ip, 3) === false, 'même IP, autre scope → compteur distinct');
}

// ── FAIL-OPEN : base muette → on laisse passer ────────────────
{
  const brokenDB = { prepare() { return { bind() { return this; }, async run() { throw new Error('D1 down'); }, async first() { throw new Error('D1 down'); } }; } };
  const env = { DB: brokenDB };
  const ip = await ipHashOf(req('198.51.100.30'));
  ok(await ipRateExceeded(env, 'agent:x', ip, 5) === false, 'incident D1 → ipRateExceeded=false (fail-open)');
}

// ── cap invalide → jamais bloquant ────────────────────────────
{
  const env = { DB: makeDB() };
  const ip = await ipHashOf(req('198.51.100.40'));
  ok(await ipRateExceeded(env, 'agent:x', ip, 0) === false, 'cap 0 → non bloquant');
  ok(await ipRateExceeded(env, 'agent:x', ip, -3) === false, 'cap négatif → non bloquant');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} OK, ${fail} échec(s)`);
process.exit(fail === 0 ? 0 : 1);
