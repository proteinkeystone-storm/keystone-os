/* ═══════════════════════════════════════════════════════════════
   Banc — Contrôle de possession côté serveur
   ─────────────────────────────────────────────────────────────
   Ce que ce banc PROUVE :
     1. Une licence n'ouvre QUE les applications de son sac.
     2. Les surfaces PUBLIQUES restent ouvertes (clients du client).
     3. Les licences historiques ne perdent aucun accès.
     4. Les applications gratuites restent gratuites.
     5. Une panne d'infrastructure ne coupe personne.

   Lancement : node scripts/test-app-access.mjs
   ═══════════════════════════════════════════════════════════════ */

import { appForPath, bagAllows, checkAppAccess, PREFIX_TO_APP } from '../workers/src/lib/app-access.js';
import { APP_TIER, TIER, OS_ENTITLEMENT } from '../workers/src/lib/pricing-grid.js';

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const eq = (a, e, l) => { JSON.stringify(a) === JSON.stringify(e) ? ok(l) : ko(l, `attendu ${JSON.stringify(e)}, reçu ${JSON.stringify(a)}`); };
const yes = (v, l) => (v ? ok(l) : ko(l, 'attendu autorisé, reçu refusé'));
const no  = (v, l) => (!v ? ok(l) : ko(l, 'attendu REFUSÉ, reçu autorisé'));

// Base simulée : une licence qui n'a payé QUE Ghost Writer.
const dbAvec = (row) => ({
  prepare: () => ({ bind: () => ({ first: async () => row }) }),
});
const dbEnPanne = () => ({
  prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1 indisponible'); } }) }),
});
const CLAIMS = { sub: 'hmac-de-stephane', plan: 'PRO' };

console.log('\n\x1b[1m▶ Suite 1 — quelle application sert ce chemin\x1b[0m');
eq(appForPath('/api/ghostwriter/rewrite'), 'A-COM-005', 'Ghost Writer');
eq(appForPath('/api/keynapse/bubbles/42'), 'O-Keyn-001', 'Keynapse');
eq(appForPath('/api/smart-agent/chat'), 'O-AGT-001', 'Smart Agent');
eq(appForPath('/api/qr/scan/abc'), 'A-COM-001', 'Smart QR');
eq(appForPath('/api/smartqr/stats'), 'A-COM-001', 'Smart QR (2e préfixe)');
eq(appForPath('/api/desk/casier'), 'O-DSK-001', 'desK');
// Les routes TRANSVERSES ne sont rattachées à aucune app : rien à vérifier.
for (const p of ['/api/licence/me', '/api/vault/sync', '/api/ai-credits/quota',
                 '/api/kora/chat', '/api/livinglayer/board', '/api/stripe/checkout',
                 '/api/admin/licences', '/api/proxy/llm', '/api/track']) {
  eq(appForPath(p), null, `transverse : ${p}`);
}

console.log('\n\x1b[1m▶ Suite 2 — une licence n\'ouvre que son sac\x1b[0m');
const sac = ['A-COM-005'];
yes(bagAllows({ ownedAssets: sac, plan: 'PRO', appId: 'A-COM-005' }), 'Ghost Writer (payé) → ouvert');
no (bagAllows({ ownedAssets: sac, plan: 'PRO', appId: 'O-DSK-001' }), 'desK (non payé) → FERMÉ');
no (bagAllows({ ownedAssets: sac, plan: 'PRO', appId: 'O-AGT-001' }), 'Smart Agent (non payé) → FERMÉ');
no (bagAllows({ ownedAssets: sac, plan: 'PRO', appId: 'O-GEO-001' }), 'Sentinel (non payé) → FERMÉ');
yes(bagAllows({ ownedAssets: [OS_ENTITLEMENT], plan: 'PRO', appId: 'O-AGT-001' }), 'l\'OS ouvre tout');

console.log('\n\x1b[1m▶ Suite 3 — les applications gratuites le restent\x1b[0m');
for (const [id, t] of Object.entries(APP_TIER)) {
  if (t !== TIER.FREE) continue;
  yes(bagAllows({ ownedAssets: [], plan: 'PRO', appId: id }), `${id} : gratuit même avec un sac VIDE`);
}

console.log('\n\x1b[1m▶ Suite 4 — on ne retire jamais un accès en place\x1b[0m');
yes(bagAllows({ ownedAssets: null, plan: 'STARTER', appId: 'O-AGT-001' }), 'sac null (legacy) → accès total');
yes(bagAllows({ ownedAssets: undefined, plan: 'STARTER', appId: 'O-DSK-001' }), 'sac absent → accès total');
yes(bagAllows({ ownedAssets: ['A-COM-005'], plan: 'MAX', appId: 'O-AGT-001' }), 'plan MAX → tout');
yes(bagAllows({ ownedAssets: ['A-COM-005'], plan: 'ADMIN', appId: 'O-AGT-001' }), 'plan ADMIN → tout');
yes(bagAllows({ ownedAssets: 'cassé', plan: 'PRO', appId: 'O-AGT-001' }), 'sac illisible → on n\'invente pas, on laisse passer');

console.log('\n\x1b[1m▶ Suite 5 — les surfaces PUBLIQUES restent ouvertes\x1b[0m');
{
  const db = dbAvec({ plan: 'PRO', owned_assets: JSON.stringify(['A-COM-005']) });
  // Un visiteur qui scanne un QR ou interroge l'agent public n'a PAS de jeton.
  for (const p of ['/api/qr/scan/xyz', '/api/smart-agent/public/ask', '/api/pulsa/f/mon-formulaire', '/api/sceau/lire/abc']) {
    const r = await checkAppAccess({ DB: db }, { path: p, claims: null });
    yes(r.allowed, `sans jeton : ${p} → la route décide (jamais bloqué ici)`);
  }
  const admin = await checkAppAccess({ DB: db }, { path: '/api/smart-agent/chat', claims: { sub: 'x', isAdmin: true } });
  yes(admin.allowed, 'un administrateur passe partout');
}

console.log('\n\x1b[1m▶ Suite 6 — le cas réel de Stéphane\x1b[0m');
{
  const db = dbAvec({ plan: 'PRO', owned_assets: JSON.stringify(['A-COM-005']) });
  const gw   = await checkAppAccess({ DB: db }, { path: '/api/ghostwriter/rewrite', claims: CLAIMS });
  const desk = await checkAppAccess({ DB: db }, { path: '/api/desk/casier',        claims: CLAIMS });
  const keyn = await checkAppAccess({ DB: db }, { path: '/api/keynapse/bubbles',   claims: CLAIMS });
  const lic  = await checkAppAccess({ DB: db }, { path: '/api/licence/me',         claims: CLAIMS });
  yes(gw.allowed,   'Ghost Writer (payé) → ouvert');
  no (desk.allowed, 'desK (jamais payé) → FERMÉ côté serveur');
  yes(keyn.allowed, 'Keynapse (gratuite) → ouverte');
  yes(lic.allowed,  'sa propre licence → toujours lisible');
}

console.log('\n\x1b[1m▶ Suite 7 — une panne ne coupe personne\x1b[0m');
{
  const r = await checkAppAccess({ DB: dbEnPanne() }, { path: '/api/desk/casier', claims: CLAIMS });
  yes(r.allowed, 'base indisponible → on laisse passer (incident ≠ résiliation)');
  const r2 = await checkAppAccess({ DB: dbAvec(null) }, { path: '/api/desk/casier', claims: CLAIMS });
  yes(r2.allowed, 'licence introuvable → la route jugera');
}

console.log('\n\x1b[1m▶ Suite 8 — couverture du catalogue\x1b[0m');
{
  const proteges = new Set(Object.values(PREFIX_TO_APP));
  // booK n'a aucune route serveur : rien à protéger, c'est normal.
  const attendus = Object.keys(APP_TIER).filter(id => id !== 'O-BOK-001');
  const manquants = attendus.filter(id => !proteges.has(id));
  eq(manquants, [], `les ${attendus.length} applications à routes serveur sont couvertes`);
  eq(proteges.has('O-BOK-001'), false, 'booK exclu à raison (aucune route serveur)');
}

console.log(`\n${pass + fail} tests — \x1b[32m${pass} ok\x1b[0m, ${fail ? `\x1b[31m${fail} ko\x1b[0m` : '0 ko'}\n`);
process.exit(fail ? 1 : 0);
