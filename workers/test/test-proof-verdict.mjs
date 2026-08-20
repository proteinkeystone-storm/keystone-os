#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   GP-5 — L'ARBITRAGE INVISIBLE (banc worker)

   Ce banc ne mesure pas si le modèle a raison — ça, c'est le corpus
   qui le dit (scripts/mesure-verdict.mjs, avec de vrais appels).

   Ici on garde la MÉCANIQUE, et surtout ses portes de sortie. La
   décision §4.3 dit que le seul vrai danger du dispositif est de
   masquer une VRAIE faute. Donc chaque façon dont le service peut
   mal tourner — modèle muet, réponse illisible, identifiant inventé,
   quota épuisé, binding absent — doit se solder par « l'alerte
   reste ». C'est ce que ce fichier vérifie, un chemin à la fois.

   Le modèle est doublé : aucun appel réel, aucun crédit consommé.

   node workers/test/test-proof-verdict.mjs      ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { handleProofVerdict, _lireVerdicts, _texteIA, MAX_ITEMS, _SYSTEME } from '../src/routes/proof-verdict.js';

let passed = 0, failed = 0;
const echecs = [];
function check(nom, cond, detail) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${nom}`); }
  else {
    failed++; echecs.push(nom);
    console.error(`  \x1b[31m✗\x1b[0m ${nom}${detail !== undefined ? `  \x1b[2m→ ${detail}\x1b[0m` : ''}`);
  }
}
const titre = (t) => console.log(`\n\x1b[1m▶ ${t}\x1b[0m`);

// ── D1 doublé ───────────────────────────────────────────────────
function makeD1() {
  const db = new DatabaseSync(':memory:');
  // Le drapeau _schemaReady du module est un singleton : à partir du 2e env
  // du banc, ensureSchema ne fait plus rien. On pose donc la table ici, comme
  // sceau.test.mjs pose ses migrations.
  db.exec(`CREATE TABLE IF NOT EXISTS proof_verdict_cache (
    hash TEXT PRIMARY KEY, verdict TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const prep = (sql) => {
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    };
  };
  return { _db: db, prepare: prep, async batch(st) { for (const s of st) await s.run(); return st.map(() => ({ success: true })); } };
}

// ── Le modèle doublé : on décide ce qu'il rend, et on compte les appels ──
function makeAI(reponse) {
  const etat = { appels: 0, dernierPrompt: '' };
  return {
    etat,
    run: async (_model, opts) => {
      etat.appels++;
      etat.dernierPrompt = (opts.messages || []).map((m) => m.content).join('\n');
      if (typeof reponse === 'function') return reponse(etat.dernierPrompt);
      if (reponse instanceof Error) throw reponse;
      return reponse;
    },
  };
}

const SECRET = 'unit-test-jwt-secret';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest())}`;
}
const TOKEN = jwt({ sub: 'licence-test', plan: 'MAX', email: 'test@test.fr' });

const envNeuf = (ai) => ({ DB: makeD1(), AI: ai, KS_JWT_SECRET: SECRET, KS_ALLOWED_ORIGIN: '*' });
const requete = (corps, token = TOKEN) => new Request('https://x.test/api/ghostwriter/proof-verdict', {
  method: 'POST',
  headers: Object.assign(token ? { Authorization: 'Bearer ' + token } : {}, { 'Content-Type': 'application/json' }),
  body: JSON.stringify(corps),
});
const lire = async (r) => { try { return await r.json(); } catch (_) { return null; } };

const TROIS = [
  { id: 'a1', mot: 'Delaunois', phrase: 'Le capitaine Delaunois commande la compagnie.' },
  { id: 'a2', mot: 'coésion', phrase: 'Le stage de coésion a duré trois jours.' },
  { id: 'a3', mot: 'Valfleury', phrase: 'Le fanion porte le nom de Valfleury.' },
];

/* ════════════════════════════════════════════════════════════════ */

titre('La lecture de la réponse du modèle (pure, à sec)');
{
  const ids = ['a1', 'a2', 'a3'];
  check('un objet propre est lu', JSON.stringify(_lireVerdicts('{"a1":"vraie","a2":"faux-positif"}', ids)) === '{"a1":"vraie","a2":"faux-positif"}');
  check('un objet noyé dans du bavardage est retrouvé',
    _lireVerdicts('Voici mon analyse : {"a1":"faux-positif"} voilà.', ids).a1 === 'faux-positif');
  check('⚠ un identifiant que le modèle INVENTE est ignoré',
    JSON.stringify(_lireVerdicts('{"zz":"faux-positif"}', ids)) === '{}');
  check('⚠ un verdict hors des deux prévus est ignoré',
    JSON.stringify(_lireVerdicts('{"a1":"peut-etre"}', ids)) === '{}');
  check('une réponse illisible ne rend rien', JSON.stringify(_lireVerdicts('bla bla', ids)) === '{}');
  check('une réponse vide ne rend rien', JSON.stringify(_lireVerdicts('', ids)) === '{}');
  check('⚠ Workers AI en CHAÎNE est lu', _texteIA('du texte') === 'du texte');
  check('⚠ Workers AI en OBJET est lu', _texteIA({ response: 'du texte' }) === 'du texte');
  check('une forme inconnue rend une chaîne vide (pas un crash)', _texteIA({ rien: 1 }) === '');
  check('le prompt système interdit explicitement de réécrire', /juge, pas correcteur/i.test(_SYSTEME));
  check('le prompt système fait pencher le doute vers « vraie »', /DOUTE[\s\S]*vraie/i.test(_SYSTEME));
}

titre("Ce qui part : les passages, JAMAIS le document");
{
  const ai = makeAI('{"a1":"faux-positif"}');
  const env = envNeuf(ai);
  const ARTICLE = 'Un très long article de la revue, plusieurs milliers de signes, '.repeat(40);
  await handleProofVerdict(requete({
    items: [{ id: 'a1', mot: 'Delaunois', phrase: 'Le capitaine Delaunois commande.' }],
    texte: ARTICLE, document: ARTICLE,     // un client malveillant essaie d'en envoyer plus
  }), env);
  check('⚠ le document n\'apparaît nulle part dans ce qui est envoyé au modèle',
    !ai.etat.dernierPrompt.includes('Un très long article'),
    'le prompt contient le document');
  check('seule la phrase du passage est transmise',
    ai.etat.dernierPrompt.includes('Le capitaine Delaunois commande.'));

  const long = 'x'.repeat(900);
  const ai2 = makeAI('{"a1":"vraie"}');
  const env2 = envNeuf(ai2);
  await handleProofVerdict(requete({ items: [{ id: 'a1', mot: 'zzz', phrase: long }] }), env2);
  check('une « phrase » trop longue est tronquée avant de partir',
    !ai2.etat.dernierPrompt.includes(long) && ai2.etat.dernierPrompt.includes('x'.repeat(200)));

  const beaucoup = Array.from({ length: MAX_ITEMS + 15 }, (_, i) => ({ id: 'i' + i, mot: 'mot' + i, phrase: 'phrase ' + i }));
  const ai3 = makeAI('{}');
  const env3 = envNeuf(ai3);
  await handleProofVerdict(requete({ items: beaucoup }), env3);
  const lignes = (ai3.etat.dernierPrompt.match(/^i\d+ \| /gm) || []).length;
  check(`jamais plus de ${MAX_ITEMS} passages dans un appel`, lignes <= MAX_ITEMS, lignes + ' lignes');
  check('un seul appel au modèle, groupé', ai3.etat.appels === 1, ai3.etat.appels + ' appels');
}

titre('Le verdict : il ne peut QU\'EFFACER');
{
  const ai = makeAI('{"a1":"faux-positif","a2":"vraie"}');
  const env = envNeuf(ai);
  const d = await lire(await handleProofVerdict(requete({ items: TROIS }), env));
  check('le nom propre est déclaré faux positif', d.verdicts.a1 === 'faux-positif');
  check('la coquille reste une vraie faute', d.verdicts.a2 === 'vraie');
  check('⚠ l\'alerte que le modèle n\'a PAS jugée reste (aucun verdict rendu)',
    d.verdicts.a3 === undefined, JSON.stringify(d.verdicts));
  check('le décompte des jugements est exact', d.juges === 2);
}

titre('Toutes les portes de sortie mènent à « l\'alerte reste »');
{
  for (const [nom, ai] of [
    ['le modèle rend du charabia', makeAI('je ne sais pas trop')],
    ['le modèle rend un objet vide', makeAI('{}')],
    ['le modèle plante', makeAI(new Error('boom'))],
    ['le modèle rend null', makeAI(null)],
  ]) {
    const env = envNeuf(ai);
    const r = await handleProofVerdict(requete({ items: TROIS }), env);
    const d = await lire(r);
    check(`${nom} → 200 et AUCUNE alerte effacée`,
      r.status === 200 && Object.keys(d.verdicts).length === 0, JSON.stringify(d && d.verdicts));
  }
  {
    const env = envNeuf(null);              // binding AI absent
    env.AI = null;
    const r = await handleProofVerdict(requete({ items: TROIS }), env);
    const d = await lire(r);
    check('le binding AI absent → 200, rien d\'effacé, raison dite',
      r.status === 200 && Object.keys(d.verdicts).length === 0 && d.raison === 'ai-absent');
  }
  {
    const r = await handleProofVerdict(requete({ items: TROIS }, null), envNeuf(makeAI('{}')));
    check('sans jeton → 401', r.status === 401);
  }
  {
    const env = envNeuf(makeAI('{"a1":"faux-positif"}'));
    const r = await handleProofVerdict(requete({ items: [] }), env);
    const d = await lire(r);
    check('une liste vide ne déclenche aucun appel', r.status === 200 && d.juges === 0);
    check('…et ne consulte même pas le modèle', env.AI.etat.appels === 0);
  }
  {
    const env = envNeuf(makeAI('{"a1":"faux-positif"}'));
    const r = await handleProofVerdict(requete({ items: 'pas un tableau' }), env);
    check('un corps mal formé ne casse rien', r.status === 200);
  }
}

titre('L\'économie : le cache (leçon Living Layer)');
{
  const ai = makeAI('{"a1":"faux-positif","a2":"vraie","a3":"faux-positif"}');
  const env = envNeuf(ai);
  const d1 = await lire(await handleProofVerdict(requete({ items: TROIS }), env));
  check('premier passage : le modèle est consulté une fois', ai.etat.appels === 1 && d1.juges === 3);

  const d2 = await lire(await handleProofVerdict(requete({ items: TROIS }), env));
  check('⚠ deuxième passage identique : AUCUN nouvel appel', ai.etat.appels === 1, ai.etat.appels + ' appels');
  check('…et les verdicts sont les mêmes', d2.cache === 3 && d2.verdicts.a1 === 'faux-positif');

  const melange = [TROIS[0], { id: 'a9', mot: 'Kerhoas', phrase: 'Le colonel Kerhoas écoute.' }];
  const d3 = await lire(await handleProofVerdict(requete({ items: melange }), env));
  check('un passage neuf relance UN appel, et lui seul',
    ai.etat.appels === 2 && d3.cache === 1 && (ai.etat.dernierPrompt.match(/^a\d+ \| /gm) || []).length === 1);

  const memeMotAutrePhrase = [{ id: 'a1', mot: 'Delaunois', phrase: 'Une autre phrase avec Delaunois dedans.' }];
  await handleProofVerdict(requete({ items: memeMotAutrePhrase }), env);
  check('le cache porte sur (mot + phrase), pas sur le mot seul', ai.etat.appels === 3);
}

console.log(`\n${passed + failed} vérifications — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
if (failed) console.error('\nÉchecs :\n  - ' + echecs.join('\n  - '));
process.exit(failed ? 1 : 0);
