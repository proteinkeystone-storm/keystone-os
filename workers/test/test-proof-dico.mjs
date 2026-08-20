#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   GP-2 couche 2 — LE DICTIONNAIRE DE LA MAISON (banc worker)

   Ce que ce banc garde, c'est la promesse du sprint : « ce qu'un
   membre apprend, un autre l'a » — et son revers, « et personne
   d'autre ne l'a ». Les deux se cassent en silence : un mauvais
   cloisonnement ne lève aucune erreur, il fuit.

   Les vraies routes sont appelées (routes/proof-dico.js), avec un D1
   doublé sur node:sqlite — patron de workers/test/sceau.test.mjs.

   node workers/test/test-proof-dico.mjs      ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import {
  handleProofDicoGet, handleProofDicoPost,
  _normaliserMot, MAX_PAR_REQUETE,
} from '../src/routes/proof-dico.js';

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

// ── D1 doublé (+ batch, que la route utilise) ───────────────────
function makeD1() {
  const db = new DatabaseSync(':memory:');
  const prep = (sql) => {
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all()   { return { results: db.prepare(sql).all(...args) }; },
      async run()   { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
      _exec() { return db.prepare(sql).run(...args); },
    };
  };
  return {
    _db: db,
    prepare: prep,
    // D1 rend un tableau de résultats ; ici seul l'effet compte.
    async batch(stmts) { for (const s of stmts) await s.run(); return stmts.map(() => ({ success: true })); },
  };
}

const SECRET = 'unit-test-jwt-secret';
const env = { DB: null, KS_JWT_SECRET: SECRET, KS_ALLOWED_ORIGIN: '*' };

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest())}`;
}
const requete = (methode, token, corps) => new Request('https://x.test/api/proof/dico', {
  method: methode,
  headers: Object.assign(token ? { Authorization: 'Bearer ' + token } : {},
                         corps ? { 'Content-Type': 'application/json' } : {}),
  body: corps ? JSON.stringify(corps) : undefined,
});
const lire = async (r) => { try { return await r.json(); } catch (_) { return null; } };

// Deux personnes de la MÊME licence : même `sub` (= lookup_hmac de la licence),
// e-mails différents. Une troisième sur une AUTRE licence.
const STEPHANE  = jwt({ sub: 'licence-epaulette', plan: 'MAX', email: 'stephane@test.fr' });
const REDACTRICE = jwt({ sub: 'licence-epaulette', plan: 'MAX', email: 'nathalie@test.fr' });
const AUTRE_CLIENT = jwt({ sub: 'licence-autre', plan: 'PRO', email: 'ailleurs@test.fr' });

/* ════════════════════════════════════════════════════════════════ */
env.DB = makeD1();

titre('La validation des mots (pure, à sec)');
check('un patronyme passe et descend en minuscules', _normaliserMot('Lefebvre') === 'lefebvre');
check('les espaces autour sont mangés', _normaliserMot('  Degrima  ') === 'degrima');
check('un nom composé passe', _normaliserMot('al-Mansouri') === 'al-mansouri');
check('une apostrophe passe', _normaliserMot('O’Brien') === 'o’brien');
check('un mot de 2 signes est refusé (minLetters l\'écarte déjà en amont)', _normaliserMot('ab') === null);
check('un token avec chiffre est refusé (VT4)', _normaliserMot('VT4') === null);
check('deux mots séparés par une espace sont refusés', _normaliserMot('deux mots') === null);
check('un fragment commençant par un tiret est refusé', _normaliserMot('-x') === null);
check('un mot de plus de 60 signes est refusé', _normaliserMot('a'.repeat(61)) === null);
check('null et undefined ne cassent rien', _normaliserMot(null) === null && _normaliserMot(undefined) === null);

titre('L\'accès');
{
  const r = await handleProofDicoGet(requete('GET', null), env);
  check('sans jeton, la lecture est refusée (401)', r.status === 401);
  const r2 = await handleProofDicoPost(requete('POST', null, { add: ['degrima'] }), env);
  check('sans jeton, l\'écriture est refusée (401)', r2.status === 401);
  const r3 = await handleProofDicoGet(requete('GET', jwt({ plan: 'MAX' })), env);
  check('un jeton sans `sub` est refusé (401)', r3.status === 401);
}

titre('La promesse du sprint : ce qu\'un membre apprend, l\'autre l\'a');
{
  let r = await handleProofDicoGet(requete('GET', STEPHANE), env);
  let d = await lire(r);
  check('au départ, le dico de la licence est vide', r.status === 200 && d.count === 0);

  r = await handleProofDicoPost(requete('POST', STEPHANE, { add: ['Degrima', 'Vaurelle'] }), env);
  d = await lire(r);
  check('Stéphane apprend deux noms', d.count === 2 && d.words.includes('degrima'));

  r = await handleProofDicoGet(requete('GET', REDACTRICE), env);
  d = await lire(r);
  check('la rédactrice, sur la MÊME licence, les a sans rien faire',
    d.count === 2 && d.words.includes('degrima') && d.words.includes('vaurelle'));

  r = await handleProofDicoPost(requete('POST', REDACTRICE, { add: ['Kerhoas'] }), env);
  d = await lire(r);
  check('elle en apprend un à son tour', d.count === 3);

  r = await handleProofDicoGet(requete('GET', STEPHANE), env);
  d = await lire(r);
  check('et Stéphane l\'a aussi', d.words.includes('kerhoas'));

  r = await handleProofDicoGet(requete('GET', AUTRE_CLIENT), env);
  d = await lire(r);
  check('⚠ un AUTRE client ne voit rien de tout ça', d.count === 0,
    'fuite : ' + JSON.stringify(d && d.words));

  r = await handleProofDicoPost(requete('POST', AUTRE_CLIENT, { add: ['Ailleurs'] }), env);
  d = await lire(r);
  check('et ce qu\'il apprend reste chez lui', d.count === 1 && d.words[0] === 'ailleurs');

  r = await handleProofDicoGet(requete('GET', STEPHANE), env);
  d = await lire(r);
  check('⚠ rien ne remonte de l\'autre client vers L\'Épaulette',
    d.count === 3 && !d.words.includes('ailleurs'));
}

titre('Le retrait, et la liste qui reste purgeable');
{
  let r = await handleProofDicoPost(requete('POST', STEPHANE, { remove: ['Vaurelle'] }), env);
  let d = await lire(r);
  check('un mot retiré disparaît', d.count === 2 && !d.words.includes('vaurelle'));

  r = await handleProofDicoGet(requete('GET', REDACTRICE), env);
  d = await lire(r);
  check('…pour toute l\'équipe', !d.words.includes('vaurelle'));

  r = await handleProofDicoPost(requete('POST', STEPHANE, { remove: ['degrima', 'kerhoas'] }), env);
  d = await lire(r);
  check('la liste peut être entièrement purgée', d.count === 0);

  // ⚠ Le retrait doit filtrer par licence LUI AUSSI. Un DELETE qui ne
  // regarde que le mot effacerait le vocabulaire d'un autre client sans
  // qu'aucune erreur ne se lève. Défaut réintroduit le 2026-08-20 : le banc
  // ne le voyait pas — d'où cette section.
  await handleProofDicoPost(requete('POST', STEPHANE, { add: ['Commun'] }), env);
  await handleProofDicoPost(requete('POST', AUTRE_CLIENT, { add: ['Commun'] }), env);
  await handleProofDicoPost(requete('POST', STEPHANE, { remove: ['Commun'] }), env);
  r = await handleProofDicoGet(requete('GET', AUTRE_CLIENT), env);
  d = await lire(r);
  check('⚠ retirer un mot chez soi ne l\'efface PAS chez un autre client',
    d.words.includes('commun'), 'le mot a disparu de l\'autre licence : ' + JSON.stringify(d.words));
  r = await handleProofDicoGet(requete('GET', STEPHANE), env);
  d = await lire(r);
  check('…et il est bien parti de chez soi', !d.words.includes('commun'));
}

titre('Les garde-fous');
{
  let r = await handleProofDicoPost(requete('POST', STEPHANE, { add: ['Degrima', 'VT4', 'ab', 'deux mots', 'Vaurelle'] }), env);
  let d = await lire(r);
  check('les entrées invalides sont écartées, les valides passent',
    d.count === 2 && d.words.includes('degrima') && d.words.includes('vaurelle'));

  r = await handleProofDicoPost(requete('POST', STEPHANE, { add: ['DEGRIMA', 'degrima', 'Degrima'] }), env);
  d = await lire(r);
  check('le même mot en trois casses ne compte qu\'une fois', d.count === 2);

  const trop = Array.from({ length: MAX_PAR_REQUETE + 1 }, (_, i) => 'mot' + i);
  r = await handleProofDicoPost(requete('POST', STEPHANE, { add: trop }), env);
  check(`plus de ${MAX_PAR_REQUETE} mots d'un coup : refusé proprement (413)`, r.status === 413);

  r = await handleProofDicoPost(requete('POST', STEPHANE, {}), env);
  check('un corps vide ne casse rien', r.status === 200);
  r = await handleProofDicoPost(requete('POST', STEPHANE, { add: 'pas un tableau' }), env);
  check('un `add` qui n\'est pas un tableau ne casse rien', r.status === 200);
}

titre('La reprise sans perte (ce que fait l\'interface au premier contact)');
{
  // Le navigateur de la rédactrice avait appris deux mots tout seul ; la
  // licence en connaît déjà deux autres. Après reprise : les quatre.
  await handleProofDicoPost(requete('POST', REDACTRICE, { add: ['Trémolière', 'Delaunois'] }), env);
  const r = await handleProofDicoGet(requete('GET', STEPHANE), env);
  const d = await lire(r);
  check('l\'union des deux côtés est conservée, rien n\'est écrasé',
    d.count === 4 && ['degrima', 'vaurelle', 'trémolière', 'delaunois'].every(w => d.words.includes(w)),
    JSON.stringify(d.words));
}

console.log(`\n${passed + failed} vérifications — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
if (failed) console.error('\nÉchecs :\n  - ' + echecs.join('\n  - '));
process.exit(failed ? 1 : 0);
