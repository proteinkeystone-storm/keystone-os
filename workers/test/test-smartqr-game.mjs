/* ═══════════════════════════════════════════════════════════════
   SMART QR — gabarits de JEU : suite E2E contre `wrangler dev --local`

   Ce que cette suite garde, et pourquoi :

   Un code de gain fait 32 bits. C'est court — assumé — donc la seule
   chose qui empêche de le DEVINER est le plafond de tentatives. Deux
   routes répondent à la même question (« ce code existe-t-il ? ») :
     · POST /api/smartqr/redeem-win   (le commerçant honore le lot)
     · GET  /api/smartqr/verify-win   (le commerçant contrôle le lot)
   La première était protégée, la seconde ne l'était pas — un balayage
   passait donc tranquillement par la porte laissée ouverte, qui rend en
   prime le contexte de la campagne. Les deux sont désormais plafonnées.

   ⚠ Si l'une des deux perd son plafond, cette suite doit devenir rouge.

   Lancer le worker AVANT :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799
   Puis :
     node test/test-smartqr-game.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

const API = process.env.BK_API || 'http://127.0.0.1:8799';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? String(extra).slice(0, 200) : ''); }
}

// Les plafonds sont journaliers et comptés par appareil (empreinte UA + IP).
// Sans identité neuve à chaque exécution, un second passage démarrerait avec
// le quota déjà vidé et mesurerait un plafond fantôme.
const RUN = crypto.randomBytes(4).toString('hex');
const UA  = `ks-qrgame/${RUN}`;
const H   = { 'User-Agent': UA, 'Content-Type': 'application/json' };

const hexBlock = () => crypto.randomBytes(2).toString('hex').toUpperCase();
const fauxCode = () => `WIN-${hexBlock()}-${hexBlock()}`;

const CAP = 60; // REDEEM_CAP_DEVICE (routes/qr.js)

async function main() {
  console.log('Smart QR — gabarits de jeu, sur', API, '\n');

  // ── 1. verify-win : plafond contre le balayage ──────────────────
  let vPassed = 0, vLimited = false;
  for (let i = 0; i < CAP + 40; i++) {
    const r = await fetch(`${API}/api/smartqr/verify-win?code=${fauxCode()}`, { headers: H });
    if (r.status === 429) { vLimited = true; break; }
    vPassed++;
  }
  ok(vLimited, `verify-win est plafonné (429 après ${vPassed} essais)`,
     vLimited ? '' : `AUCUN plafond : ${vPassed} codes testés sans être freiné`);
  ok(vPassed >= 20, 'le plafond laisse largement passer un commerçant réel', vPassed);

  // ── 2. redeem-win : le plafond historique tient toujours ────────
  const UA2 = { ...H, 'User-Agent': `${UA}-redeem` };
  let rPassed = 0, rLimited = false;
  for (let i = 0; i < CAP + 40; i++) {
    const r = await fetch(`${API}/api/smartqr/redeem-win`, {
      method: 'POST', headers: UA2, body: JSON.stringify({ code: fauxCode() }),
    });
    if (r.status === 429) { rLimited = true; break; }
    rPassed++;
  }
  ok(rLimited, `redeem-win reste plafonné (429 après ${rPassed} essais)`,
     rLimited ? '' : 'RÉGRESSION : le plafond anti-balayage a disparu');

  // ── 3. Ce qu'une réponse laisse filtrer ─────────────────────────
  const UA3 = { ...H, 'User-Agent': `${UA}-lecture` };
  const bad = await (await fetch(`${API}/api/smartqr/verify-win?code=PASUNCODE`, { headers: UA3 })).json();
  ok(bad.valid === false && bad.reason === 'format_invalide', 'format invalide → refus net');

  const unknown = await (await fetch(`${API}/api/smartqr/verify-win?code=${fauxCode()}`, { headers: UA3 })).json();
  ok(unknown.valid === false, 'code inconnu → valid:false (et non 404, qui ferait croire à une panne)');
  ok(!('short_id' in unknown) && !('message_gain' in unknown) && !('qr_name' in unknown),
     'un code inconnu ne révèle AUCUN contexte de campagne', JSON.stringify(unknown));

  // ── 4. Le tirage décide d'un vrai lot : il doit rester fidèle ───
  // La source du hasard a changé (Math.random → getRandomValues) ; les
  // chances réglées par le commerçant, elles, ne doivent pas bouger d'un
  // pouce. On rejoue ici le calcul exact de _rand01 (routes/qr.js).
  const rand01 = () => crypto.webcrypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  for (const taux of [20, 50]) {
    const N = 60000;
    let wins = 0;
    for (let i = 0; i < N; i++) if (rand01() * 100 < taux) wins++;
    const obtenu = (wins / N) * 100;
    ok(Math.abs(obtenu - taux) < 1, `taux réglé ${taux} % → mesuré ${obtenu.toFixed(2)} %`);
  }
  let mn = 1, mx = 0;
  for (let i = 0; i < 200000; i++) { const v = rand01(); if (v < mn) mn = v; if (v > mx) mx = v; }
  ok(mn >= 0 && mx < 1, 'le tirage reste borné dans [0,1) — un taux de 100 % ne peut pas faire perdre');

  console.log(`\n${pass} ✓ · ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
