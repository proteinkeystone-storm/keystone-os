#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Banc — POST /api/licence/activate × échéance (`expiresAt`)
   ─────────────────────────────────────────────────────────────
   Ce que ce banc PROUVE (vrai handler admin, D1 réel en mémoire) :
     1. Créer une licence avec une date la pose (essai 7 jours).
     2. Ré-envoyer la même clé SANS le champ (édition du propriétaire,
        des appareils, des apps) laisse l'échéance TELLE QUELLE.
        → Avant, l'upsert écrivait `excluded.expires_at` sans condition
          et toute édition depuis l'Admin rendait l'essai permanent.
     3. `expiresAt: null` (champ vidé) RETIRE l'échéance explicitement.
     4. Une nouvelle date la remplace (prolonger un essai).
     5. Une date illisible → 400, rien n'est écrit.
     6. Sans échéance à la création → NULL (comportement inchangé).

   Lancement : node scripts/test-licence-expiry-admin.mjs
   ═══════════════════════════════════════════════════════════════ */

import { DatabaseSync }   from 'node:sqlite';
import { handleActivate } from '../workers/src/routes/licence.js';

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const eq = (a, e, l) => {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  A === E ? ok(l) : ko(l, `attendu ${E}, reçu ${A}`);
};

function makeD1(db) {
  const wrap = (sql, args) => ({
    run:   async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    first: async (col) => { const row = db.prepare(sql).get(...args); if (row === undefined) return null; return col ? row[col] : row; },
    all:   async () => ({ success: true, results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => ({ ...wrap(sql, []), bind: (...args) => wrap(sql, args) }) };
}

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE licences (
    key TEXT PRIMARY KEY, tenant_id TEXT DEFAULT 'default', owner TEXT, plan TEXT,
    is_active INTEGER DEFAULT 1, owned_assets TEXT, expires_at TEXT,
    customer_email TEXT, lookup_hmac TEXT, key_hash TEXT, salt TEXT, devices_max INTEGER,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
  );
`);
const env = { DB: makeD1(db), KS_ADMIN_SECRET: 'adm-banc', KS_LOOKUP_PEPPER: 'pepper-banc', KS_ALLOWED_ORIGIN: '*' };

async function activate(body) {
  const req = new Request('https://keystone-os-api.example/api/licence/activate', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Authorization': 'Bearer adm-banc', 'Content-Type': 'application/json' },
  });
  const res = await handleActivate(req, env);
  return { status: res.status, json: await res.json().catch(() => null) };
}
const KEY = 'DEMO-BANC-0000-0001';
const row = () => db.prepare('SELECT owner, plan, owned_assets, expires_at, devices_max, customer_email FROM licences WHERE key = ?').get(KEY);

console.log('\n\x1b[1m▶ 1. Création d\'un essai 7 jours\x1b[0m');
{
  const r = await activate({ key: KEY, owner: 'Rédactrice (démo)', plan: 'PRO', ownedAssets: ['O-DSK-001'],
                             expiresAt: '2026-08-28', devicesMax: 3, customerEmail: 'redactrice@example.test' });
  eq(r.status, 200, 'création → 200');
  eq(row().expires_at, '2026-08-28', 'l\'échéance est posée');
  eq(r.json?.licence?.expiresAt, '2026-08-28', 'la réponse la renvoie');
}

console.log('\n\x1b[1m▶ 2. Édition SANS le champ (propriétaire / appareils / apps) → échéance intacte\x1b[0m');
{
  const r = await activate({ key: KEY, owner: 'Nathalie C. (démo)', plan: 'PRO', ownedAssets: ['O-DSK-001'], devicesMax: 1 });
  eq(r.status, 200, 'édition → 200');
  const L = row();
  eq(L.owner, 'Nathalie C. (démo)', 'le propriétaire a changé');
  eq(L.devices_max, 1, 'les appareils ont changé');
  eq(L.expires_at, '2026-08-28', 'l\'échéance N\'a PAS bougé (c\'était le bug : elle passait à NULL)');
  eq(L.customer_email, 'redactrice@example.test', 'l\'e-mail connu est conservé (COALESCE existant)');
}

console.log('\n\x1b[1m▶ 3. Champ vidé (`expiresAt: null`) → échéance retirée explicitement\x1b[0m');
{
  const r = await activate({ key: KEY, owner: 'Nathalie C. (démo)', plan: 'PRO', ownedAssets: ['O-DSK-001'], expiresAt: null });
  eq(r.status, 200, '→ 200');
  eq(row().expires_at, null, 'plus d\'échéance');
  const r2 = await activate({ key: KEY, owner: 'Nathalie C. (démo)', plan: 'PRO', ownedAssets: ['O-DSK-001'], expiresAt: '' });
  eq(r2.status, 200, 'chaîne vide → 200');
  eq(row().expires_at, null, 'chaîne vide = retirée aussi');
}

console.log('\n\x1b[1m▶ 4. Prolonger : une nouvelle date remplace l\'ancienne\x1b[0m');
{
  await activate({ key: KEY, owner: 'Nathalie C. (démo)', plan: 'PRO', ownedAssets: ['O-DSK-001'], expiresAt: '2026-08-28' });
  const r = await activate({ key: KEY, owner: 'Nathalie C. (démo)', plan: 'PRO', ownedAssets: ['O-DSK-001'], expiresAt: '2026-09-04' });
  eq(r.status, 200, '→ 200');
  eq(row().expires_at, '2026-09-04', 'échéance prolongée');
}

console.log('\n\x1b[1m▶ 5. Date illisible → 400, rien n\'est écrit\x1b[0m');
{
  const r = await activate({ key: KEY, owner: 'Quelqu\'un d\'autre', plan: 'PRO', ownedAssets: ['O-DSK-001'], expiresAt: 'pas-une-date' });
  eq(r.status, 400, '→ 400');
  eq(row().owner, 'Nathalie C. (démo)', 'le propriétaire n\'a pas été écrasé');
  eq(row().expires_at, '2026-09-04', 'l\'échéance non plus');
  const r2 = await activate({ key: KEY, owner: 'X', plan: 'PRO', ownedAssets: ['O-DSK-001'], expiresAt: 42 });
  eq(r2.status, 400, 'un nombre → 400');
}

console.log('\n\x1b[1m▶ 6. Création sans échéance → NULL (comme avant)\x1b[0m');
{
  const r = await activate({ key: 'DEMO-BANC-0000-0002', owner: 'Sans date', plan: 'PRO', ownedAssets: ['O-DSK-001'] });
  eq(r.status, 200, '→ 200');
  eq(db.prepare('SELECT expires_at FROM licences WHERE key = ?').get('DEMO-BANC-0000-0002').expires_at, null, 'expires_at NULL');
}

const total = pass + fail;
if (fail === 0) {
  console.log(`\n\x1b[32m\x1b[1m✓ ${pass}/${total} PASS\x1b[0m — /api/licence/activate × échéance (absent = inchangé, null = retiré)\n`);
  process.exit(0);
} else {
  console.log(`\n\x1b[31m\x1b[1m✗ ${fail}/${total} FAIL\x1b[0m — /api/licence/activate × échéance\n`);
  process.exit(1);
}
