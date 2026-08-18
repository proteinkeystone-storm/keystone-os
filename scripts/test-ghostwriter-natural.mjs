/* ═══════════════════════════════════════════════════════════════
   Ghost Writer — option « écriture naturelle » (à sec, sans IA)

   Le VRAI handler du worker est appelé en mémoire : JWT signé avec le
   secret de test, D1 doublé par un SQLite en mémoire (node:sqlite),
   env.AI.run remplacé par un espion qui CAPTURE le prompt système et
   rend une réponse à 3 variantes bien formée. On vérifie ce que le
   modèle RECEVRAIT — c'est ça, l'option : un cahier des charges dans
   le prompt, rien d'autre.

   Ce que le banc garantit :
   · naturalWriting:true  → le cahier des charges NATURAL_WRITING est
     dans le prompt système (et sa présence est reconnaissable) ;
   · absent / false / 'true' (string) → prompt strictement inchangé
     (rétro-compat totale : aucun pad existant ne change de sortie) ;
   · relecture (variants:1) → IGNORÉ même si demandé (on ne réécrit
     pas le texte d'un auteur) ;
   · mode « composer un post » → le même cahier des charges est
     embarqué d'office (une seule source de vérité) ;
   · la réponse est bien rendue (3 variantes) avec l'option active.

   Lancer : node scripts/test-ghostwriter-natural.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  handleGhostwriterRewrite,
  gwNaturalWriting as NATURAL_WRITING,
  gwComposePostPrompt as composePostPrompt,
} from '../workers/src/routes/ghostwriter.js';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m', label); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? String(extra).slice(0, 300) : ''); }
}

/* ── D1 doublé : SQLite en mémoire derrière l'API prepare/bind/first/all/run ── */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    first: async () => { try { return db.prepare(sql).get(...args) ?? null; } catch (e) { throw e; } },
    all:   async () => ({ results: db.prepare(sql).all(...args) }),
    run:   async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
  });
  return { prepare: (sql) => wrap(sql), batch: async (stmts) => Promise.all(stmts.map(s => s.run())), _db: db };
}

/* ── JWT de test (même patron que les bancs desK) ─────────────────── */
const SECRET = 'gw-natural-test-secret-0123456789abcdef';
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}
const TOKEN = jwt({ sub: 'gw-natural-sub', plan: 'ADMIN' });

/* ── env doublé : AI espion + D1 mémoire ─────────────────────────── */
// UNE seule base pour tout le banc, comme en prod : le worker mémorise
// « schéma déjà créé » au niveau du module (une fois par isolate) — une
// base neuve à chaque appel lui ferait croire ses tables présentes.
const DB = fakeD1();
function makeEnv() {
  const captured = [];
  const env = {
    KS_JWT_SECRET: SECRET,
    KS_ALLOWED_ORIGIN: '*',
    DB,
    AI: {
      run: async (_model, input) => {
        captured.push(input);
        const sys = (input.messages || []).find(m => m.role === 'system')?.content || '';
        // Relecture (solo) → 1 bloc ; sinon 3 variantes délimitées.
        if (/Relecture/.test(sys) && /correcteur/.test(sys)) {
          return { response: 'Relecture\nTexte corrigé.' };
        }
        if (/réseaux sociaux/.test(sys)) return { response: 'Un post composé, prêt à publier.' };
        return { response: 'Ton formel\nVariante un.\n---\nTon chaleureux\nVariante deux.\n---\nTon concis\nVariante trois.' };
      },
    },
  };
  return { env, captured };
}

async function call(env, body) {
  const req = new Request('https://worker.test/api/ghostwriter/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Origin: 'https://app.test' },
    body: JSON.stringify(body),
  });
  const res = await handleGhostwriterRewrite(req, env);
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
const sysOf = (captured) => (captured.at(-1)?.messages || []).find(m => m.role === 'system')?.content || '';
const TEXT = 'Bonjour, je vous écris au sujet de notre rendez-vous de la semaine prochaine, que je souhaiterais décaler.';
// Une phrase-signature du cahier des charges, suffisamment spécifique.
const MARQUE = 'Pas de triades systématiques';

console.log('\nGhost Writer — option « écriture naturelle »\n');

/* ── 1. Option active ─────────────────────────────────────────── */
console.log('Option active');
{
  const { env, captured } = makeEnv();
  const r = await call(env, { text: TEXT, tone: 'formel professionnel', naturalWriting: true });
  ok(r.status === 200, 'la requête aboutit (200)', r.status + ' ' + JSON.stringify(r.data).slice(0, 120));
  const sys = sysOf(captured);
  ok(sys.includes(NATURAL_WRITING), 'le cahier des charges NATURAL_WRITING est dans le prompt système');
  ok(sys.includes(MARQUE), 'sa phrase-signature est bien là');
  ok(sys.includes('Ton imposé : formel professionnel'), 'les autres directives (ton) sont toujours là');
  ok(Array.isArray(r.data?.variants) && r.data.variants.length === 3, '3 variantes rendues', r.data);
}

/* ── 2. Option absente / fausse / mal typée → prompt inchangé ─── */
console.log('\nRétro-compat : sans l\'option, rien ne change');
{
  const ref = makeEnv();
  await call(ref.env, { text: TEXT, tone: 'formel professionnel' });
  const sysRef = sysOf(ref.captured);
  ok(!sysRef.includes(MARQUE), 'option absente → pas de cahier des charges');

  for (const val of [false, 'true', 1, 'oui', null]) {
    const e = makeEnv();
    await call(e.env, { text: TEXT, tone: 'formel professionnel', naturalWriting: val });
    ok(sysOf(e.captured) === sysRef, `naturalWriting=${JSON.stringify(val)} → prompt STRICTEMENT identique à sans option`);
  }
}

/* ── 3. Relecture (desK) : ignoré ─────────────────────────────── */
console.log('\nRelecture (variants:1) : l\'option est ignorée');
{
  const { env, captured } = makeEnv();
  const r = await call(env, { text: TEXT, action: 'improve', lengthTarget: 'keep', variants: 1, naturalWriting: true });
  ok(r.status === 200, 'la relecture aboutit', r.status);
  const sys = sysOf(captured);
  ok(/correcteur-relecteur/.test(sys), 'c\'est bien le prompt de relecture');
  ok(!sys.includes(MARQUE), 'aucun cahier des charges d\'écriture : on ne réécrit pas un auteur');
}

/* ── 4. Mode « composer un post » : d'office ──────────────────── */
console.log('\nMode « composer un post » : le même cahier des charges, d\'office');
{
  ok(composePostPrompt('linkedin').includes(NATURAL_WRITING), 'le prompt de composition embarque NATURAL_WRITING (source unique)');
  const { env, captured } = makeEnv();
  const r = await call(env, { text: 'Trois idées reçues sur le télétravail', composePost: true, network: 'linkedin' });
  ok(r.status === 200 && r.data?.variants?.length === 1, 'un post rendu', r.status);
  ok(sysOf(captured).includes(MARQUE), 'et le modèle l\'a reçu, sans que le pad ait rien demandé');
}

/* ── 5. Le cahier des charges lui-même ────────────────────────── */
console.log('\nLe cahier des charges');
ok(/^ÉCRITURE NATURELLE/.test(NATURAL_WRITING), 'commence par son titre');
ok(NATURAL_WRITING.split('\n').length >= 8, 'au moins 8 consignes concrètes');
ok(!/signature IA|détect/i.test(NATURAL_WRITING), 'ne parle ni de « signature IA » ni de détection — c\'est du style, pas un contournement');
ok(/n['’]hésitez pas à/.test(NATURAL_WRITING) && /tirets cadratins/.test(NATURAL_WRITING), 'nomme les tics les plus courants');

console.log(`\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
