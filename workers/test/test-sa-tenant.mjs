/* ═══════════════════════════════════════════════════════════════
   Smart Agent / Kortex — la cloison entre clients tient
   ───────────────────────────────────────────────────────────────
   Deux clients distincts (deux `sub` de JWT ⇒ deux tenants), chacun
   avec son agent, son coffre et son savoir. On vérifie les DEUX
   moitiés de la même règle :

     · aucun identifiant de l'un ne « marche » chez l'autre — ni pour
       lire, ni pour écrire, ni pour supprimer, ni pour chercher ;
     · chacun garde l'usage COMPLET de ses propres affaires (autant
       d'assertions de non-régression que de gardes).

   Le point le plus important est le dernier de la section 3 : après
   qu'un tiers a tenté de supprimer sa fiche, le propriétaire doit
   TOUJOURS la retrouver par la recherche. Une donnée peut survivre
   en base tout en ayant disparu de l'index — cette assertion est la
   seule qui le voie.

   Lancer le worker AVANT :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --var KS_JWT_SECRET:bk-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:bk-admin --var KS_LOOKUP_PEPPER:bk-pepper \
       --var KS_ENCRYPTION_KEY:bk-encryption-key-32-chars-min!
   Puis :
     node test/test-sa-tenant.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

const API    = process.env.BK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.BK_JWT_SECRET || 'bk-test-secret';

const b64u = (s) => Buffer.from(s).toString('base64url');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url');
  return `${h}.${p}.${sig}`;
}

// plan MAX ⇒ entitlement accordé sans lire la base ; `sub` ⇒ le tenant.
// (ADMIN est exclu à dessein : il retomberait sur le tenant 'default',
//  et les deux clients du banc n'en feraient plus qu'un.)
const A = jwt({ sub: 'sa-cloison-clientA', plan: 'MAX', owner: 'Client A', email: 'a@cloison.test' });
const B = jwt({ sub: 'sa-cloison-clientB', plan: 'MAX', owner: 'Client B', email: 'b@cloison.test' });

async function call(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(API + '/api/smart-agent' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* corps non JSON */ }
  return { status: res.status, data };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? '→ ' + String(extra).slice(0, 220) : ''); }
}
const section = (t) => console.log('\n' + t);

const mkAgent = (nom) => ({
  name: nom,
  config: { identity: { mission: 'Répondre aux questions de réglage sur nos machines.' } },
});
const FICHE = (title, statement) => ({
  type: 'fact', title, body: { statement },
  status: 'validated',        // seul statut que la recherche remonte
});

async function main() {
  console.log('Smart Agent — cloison entre clients ·', API);

  // ── 1. Mise en place ────────────────────────────────────────────
  section('1. Deux clients, deux savoirs');
  const agA = await call(A, '/agents', { method: 'POST', body: mkAgent('Agent du client A') });
  const agB = await call(B, '/agents', { method: 'POST', body: mkAgent('Agent du client B') });
  ok([200, 201].includes(agA.status), 'A crée son agent', agA.status);
  ok([200, 201].includes(agB.status), 'B crée son agent', agB.status);
  const idA = agA.data?.agent?.id || agA.data?.id;
  const idB = agB.data?.agent?.id || agB.data?.id;
  if (!idA || !idB) { console.log('\nFATAL : pas d\'id d\'agent'); process.exit(1); }

  const unA = await call(A, '/kortex/units', { method: 'POST',
    body: { agent_id: idA, ...FICHE('Barytonage du client A', 'Le barytonage clientA se règle à 12 tours.') } });
  const unB = await call(B, '/kortex/units', { method: 'POST',
    body: { agent_id: idB, ...FICHE('Barytonage du client B', 'Le barytonage clientB se règle à 12 tours.') } });
  ok([200, 201].includes(unA.status), 'A dépose une fiche dans son coffre', unA.status);
  ok([200, 201].includes(unB.status), 'B dépose une fiche dans son coffre', unB.status);
  const unitA = unA.data?.unit?.id || unA.data?.id;
  const unitB = unB.data?.unit?.id || unB.data?.id;
  if (!unitA || !unitB) { console.log('\nFATAL : pas d\'id de fiche'); process.exit(1); }

  const folB = await call(B, '/folders', { method: 'POST', body: { name: 'Dossier du client B' } });
  const folderB = folB.data?.folder?.id || folB.data?.id;
  ok(!!folderB, 'B crée un dossier', JSON.stringify(folB.data));
  const cvB = await call(B, '/vaults', { method: 'POST', body: { folder_id: folderB, name: 'Coffre partagé de B' } });
  const vaultB = cvB.data?.vault?.id || cvB.data?.id || null;
  ok(!!vaultB, 'B crée un coffre partagé', JSON.stringify(cvB.data));

  // ── 2. Chacun reste maître chez lui ─────────────────────────────
  section('2. Chacun garde l\'usage plein de ses affaires');
  const listA = await call(A, `/kortex/units?agent=${idA}`);
  ok(listA.status === 200, 'A liste les fiches de SON agent', listA.status);
  ok((listA.data?.units || []).some(u => u.id === unitA), 'A voit bien SA fiche');

  const searchA = await call(A, `/kortex/search?agent=${idA}&q=barytonage`);
  const foundA = (searchA.data?.results || []).map(r => r.unit?.id);
  ok(searchA.status === 200 && foundA.includes(unitA), 'A retrouve SA fiche par la recherche', JSON.stringify(foundA));
  ok(!foundA.includes(unitB), 'la recherche de A ne montre jamais la fiche de B');

  const searchB = await call(B, `/kortex/search?agent=${idB}&q=barytonage`);
  const foundB = (searchB.data?.results || []).map(r => r.unit?.id);
  ok(searchB.status === 200 && foundB.includes(unitB), 'B retrouve SA fiche par la recherche', JSON.stringify(foundB));
  ok(!foundB.includes(unitA), 'la recherche de B ne montre jamais la fiche de A');

  const listBvault = await call(B, `/kortex/units?vault=${vaultB}`);
  ok(listBvault.status === 200, 'B liste par SON coffre partagé', listBvault.status);

  // ── 3. Rien de l'autre ne s'ouvre ───────────────────────────────
  section('3. Un identifiant qui n\'est pas à nous est introuvable');
  const crossList = await call(A, `/kortex/units?agent=${idB}`);
  ok(crossList.status === 404, 'lister avec l\'agent d\'un autre → 404', crossList.status);
  ok(!(crossList.data?.units || []).length, '…et rien n\'est rendu au passage');

  const crossCreate = await call(A, '/kortex/units', { method: 'POST',
    body: { agent_id: idB, ...FICHE('Fiche intruse', 'Ceci ne doit jamais atterrir chez B.') } });
  ok(crossCreate.status === 404, 'écrire une fiche sur l\'agent d\'un autre → 404', crossCreate.status);
  const listBafter = await call(B, `/kortex/units?agent=${idB}`);
  ok(!(listBafter.data?.units || []).map(u => u.title).includes('Fiche intruse'),
     'le coffre de B ne contient pas la fiche intruse');

  const crossSearch = await call(A, `/kortex/search?agent=${idB}&q=barytonage`);
  ok(crossSearch.status === 404, 'chercher via l\'agent d\'un autre → 404', crossSearch.status);
  ok(!(crossSearch.data?.results || []).length, '…et aucun résultat de repli n\'est servi');

  const crossVault = await call(A, `/kortex/units?vault=${vaultB}`);
  ok(crossVault.status === 404, 'lister par le coffre d\'un autre → 404', crossVault.status);
  ok(!(crossVault.data?.units || []).length, '…et rien n\'est rendu au passage');

  const crossDelete = await call(A, `/kortex/units/${unitB}`, { method: 'DELETE' });
  ok(crossDelete.status === 404, 'supprimer la fiche d\'un autre → 404', crossDelete.status);
  const listBstill = await call(B, `/kortex/units?agent=${idB}`);
  ok((listBstill.data?.units || []).some(u => u.id === unitB), 'la fiche de B est toujours en base');
  // ⚠ L'ASSERTION QUI COMPTE : survivre en base ne suffit pas, il faut
  //   rester TROUVABLE. C'est la seule qui voie un index désynchronisé.
  const searchBafter = await call(B, `/kortex/search?agent=${idB}&q=barytonage`);
  ok((searchBafter.data?.results || []).map(r => r.unit?.id).includes(unitB),
     'B RETROUVE TOUJOURS sa fiche par la recherche après la tentative',
     JSON.stringify((searchBafter.data?.results || []).map(r => r.unit?.id)));

  // ── 4. La suppression légitime reste complète ───────────────────
  section('4. La suppression légitime nettoie bien tout');
  const selfDelete = await call(A, `/kortex/units/${unitA}`, { method: 'DELETE' });
  ok(selfDelete.status === 200, 'A supprime SA fiche', selfDelete.status);
  const searchAafter = await call(A, `/kortex/search?agent=${idA}&q=barytonage`);
  ok(!(searchAafter.data?.results || []).map(r => r.unit?.id).includes(unitA),
     'elle disparaît aussi de SA recherche (l\'index suit)');

  console.log(`\n═══ ${pass} ✓ · ${fail} ✗ ═══`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
