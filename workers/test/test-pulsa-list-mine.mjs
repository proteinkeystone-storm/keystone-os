/* ═══════════════════════════════════════════════════════════════
   Key Form — périmètre de GET /api/pulsa/forms (06/08/2026)

   Ce que le banc prouve, contre `wrangler dev --local` :
   1. un CLIENT ne voit que ses formulaires (avec ou sans ?mine=1) ;
   2. un ADMIN sans paramètre voit TOUT (comportement historique intact —
      les écrans « importer une fiche publiée » / « livrer » en dépendent) ;
   3. un ADMIN avec ?mine=1 ne voit QUE les siens (owner_sub = son sub),
      pas les formulaires des clients, pas l'atelier owner_sub='admin' ;
   4. la réponse porte `scope` — c'est la ceinture qui autorise le front à
      fusionner dans la bibliothèque d'un admin.

   Pourquoi : la bibliothèque Key Form est local-first et sautait
   l'hydratation pour un admin (elle aurait avalé les formulaires de tous
   les clients). Résultat, le pad annonçait « 1 publié » sans jamais
   montrer lequel (retour Stéphane 06/08 — la Fiche établissement du
   Concierge, bien réelle).

   Lancer le worker AVANT :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --var KS_JWT_SECRET:pf-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:pf-admin
   Puis :
     node test/test-pulsa-list-mine.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

const API    = process.env.PF_API    || 'http://127.0.0.1:8799';
const SECRET = process.env.PF_SECRET || 'pf-test-secret';

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}

const SUB_ADM = 'pf-admin-sub';
const SUB_CLI = 'pf-client-sub';
const ADM = jwt({ sub: SUB_ADM, email: 'admin@test.pf', plan: 'ADMIN', isAdmin: true });
const CLI = jwt({ sub: SUB_CLI, email: 'client@test.pf' });

async function api(token, path, opts = {}) {
  const res = await fetch(API + '/api/pulsa' + path, {
    method: opts.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Un formulaire minimal accepté par la validation (titre, slug, 1 champ,
// 1 destinataire) — publié pour coller au cas réel.
function form(id, slug, title) {
  return {
    id, meta: { title, slug },
    sections: [{ id: 's1', title: 'Section', fields: [{ id: 'f1', type: 'text', label: 'Nom' }] }],
    delivery: { recipients: ['dest@test.pf'] },
    output: { status: 'published' },
  };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}
const ids = (d) => (d.forms || []).map(f => f.id).sort();

console.log('\n── Key Form · périmètre de la liste ──');
const stamp = Date.now().toString(36);
const A = `pf_${stamp}_adm`, B = `pf_${stamp}_cli`;

const cA = await api(ADM, '/forms', { method: 'POST', body: { form: form(A, `pf-adm-${stamp}`, 'Fiche admin') } });
ok(cA.status === 200, 'formulaire admin créé', cA.data);
const cB = await api(CLI, '/forms', { method: 'POST', body: { form: form(B, `pf-cli-${stamp}`, 'Fiche client') } });
ok(cB.status === 200, 'formulaire client créé', cB.data);

const cliAll  = await api(CLI, '/forms');
const cliMine = await api(CLI, '/forms?mine=1');
ok(!ids(cliAll.data).includes(A),  'le client ne voit pas le formulaire de l\'admin');
ok(ids(cliAll.data).includes(B),   'le client voit le sien');
ok(cliAll.data.scope === 'mine',   'scope=mine pour un client (sans paramètre)', cliAll.data.scope);
ok(JSON.stringify(ids(cliAll.data)) === JSON.stringify(ids(cliMine.data)),
   '?mine=1 ne change RIEN pour un client');

const admAll = await api(ADM, '/forms');
ok(ids(admAll.data).includes(A) && ids(admAll.data).includes(B),
   'admin SANS paramètre : voit tout (comportement historique intact)');
ok(admAll.data.scope === 'all', 'scope=all quand la liste est globale', admAll.data.scope);

const admMine = await api(ADM, '/forms?mine=1');
ok(ids(admMine.data).includes(A),  'admin ?mine=1 : voit le sien');
ok(!ids(admMine.data).includes(B), 'admin ?mine=1 : ne voit PAS celui du client');
ok(admMine.data.scope === 'mine',  'scope=mine (ceinture du front)', admMine.data.scope);
ok((admMine.data.forms || []).every(f => f.output?.status === 'published'),
   'les formulaires rendus gardent leur statut');

// Ménage : les deux formulaires de test quittent la base.
const dA = await api(ADM, `/forms/${A}`, { method: 'DELETE' });
const dB = await api(CLI, `/forms/${B}`, { method: 'DELETE' });
ok(dA.status === 200 && dB.status === 200, 'formulaires de test supprimés', { dA: dA.status, dB: dB.status });
const after = await api(ADM, '/forms');
ok(!ids(after.data).includes(A) && !ids(after.data).includes(B),
   'la suppression retire bien la ligne serveur');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} vert(s), ${fail} rouge(s)\n`);
process.exit(fail === 0 ? 0 : 1);
