/* ═══════════════════════════════════════════════════════════════
   OPS-2 — Sentinelle de soi : machine à états anti-flap, contre
   `wrangler dev --local`. Prouve : (1) 1er échec = pas d'alerte,
   (2) 2e échec consécutif = alerte (franchissement du seuil),
   (3) 3e échec = PAS de nouvelle alerte (anti-spam), (4) retour OK =
   e-mail de rétablissement + reset, (5) sondes réelles côté OK,
   (6) endpoints admin gatés.

   L'e-mail lui-même n'est pas envoyé (KS_RESEND_KEY absent en test) :
   on vérifie la DÉCISION d'alerter (alertSent/recoverySent), pas la
   livraison Resend.

   Lancer le worker AVANT :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --test-scheduled \
       --var KS_JWT_SECRET:bk-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:bk-admin
   Puis :
     node test/test-ops-health.mjs
   ═══════════════════════════════════════════════════════════════ */

const API   = process.env.BK_API || 'http://127.0.0.1:8799';
const ADMIN = process.env.BK_ADMIN || 'bk-admin';

async function ops(body, { admin = true } = {}) {
  const res = await fetch(API + '/api/admin/ops-health/run-now', {
    method: 'POST',
    headers: { ...(admin ? { Authorization: 'Bearer ' + ADMIN } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function state() {
  const res = await fetch(API + '/api/admin/ops-health', { headers: { Authorization: 'Bearer ' + ADMIN } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

async function main() {
  console.log('OPS-2 — sentinelle de soi sur', API, '\n');

  // Garde-fous admin.
  ok((await ops({}, { admin: false })).status === 401, 'run-now sans admin → 401');
  const g = await fetch(API + '/api/admin/ops-health');
  ok(g.status === 401, 'ops-health sans admin → 401');

  // Remise à zéro de l'état : un run OK simulé (reset consecutive/alerted).
  await ops({ simulate: 'up' });

  // 1) 1er échec → consecutive=1, PAS d'alerte.
  const d1 = await ops({ simulate: 'down' });
  ok(d1.data.status === 'down' && d1.data.consecutiveFails === 1, '1er down → consecutive=1', d1.data);
  ok(d1.data.alertSent === false && d1.data.alerted === false, '1er down → pas d\'alerte (anti-flap)', d1.data);

  // 2) 2e échec consécutif → franchissement du seuil → alerte décidée.
  const d2 = await ops({ simulate: 'down' });
  ok(d2.data.consecutiveFails === 2 && d2.data.alerted === true, '2e down → seuil franchi, alerted=true', d2.data);
  ok(d2.data.alertSent === true, '2e down → alerte ENVOYÉE (décision)', d2.data);

  // 3) 3e échec → toujours alerted, mais PAS de nouvelle alerte (anti-spam).
  const d3 = await ops({ simulate: 'down' });
  ok(d3.data.consecutiveFails === 3 && d3.data.alertSent === false, '3e down → pas de ré-alerte (anti-spam)', d3.data);

  // 4) Retour OK → e-mail de rétablissement + reset.
  const up = await ops({ simulate: 'up' });
  ok(up.data.status === 'ok' && up.data.recoverySent === true, 'retour OK → e-mail de rétablissement', up.data);
  ok(up.data.consecutiveFails === 0 && up.data.alerted === false, 'retour OK → état remis à zéro', up.data);

  // 5) Un 2e OK ne renvoie PAS de rétablissement (rien à rétablir).
  const up2 = await ops({ simulate: 'up' });
  ok(up2.data.recoverySent === false, '2e OK consécutif → pas d\'e-mail', up2.data);

  // 6) Sondes RÉELLES (sans simulate) : santés appelées IN-PROCESS (jamais
  //    de self-HTTP → plus de faux 404), landing prod = 200 → status ok.
  const real = await ops({});
  ok(Array.isArray(real.data.checks) && real.data.checks.length === 4, 'run réel → 4 checks (landing + 3 santés)', real.data.checks);
  const healthChecks = (real.data.checks || []).filter(c => c.name !== 'landing');
  ok(healthChecks.length === 3 && healthChecks.every(c => c.ok), 'run réel → 3 santés in-process OK (pas de faux 404)', real.data.checks);
  ok(real.data.status === 'ok', 'run réel → status ok', real.data);

  // 7) L'endpoint d'état reflète le dernier run.
  const st = await state();
  ok(st.status === 200 && ['ok', 'down'].includes(st.data.status), 'GET ops-health → état lisible', st.data);

  console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} pass · ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('Erreur fatale:', e); process.exit(2); });
