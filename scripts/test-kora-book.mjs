#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test actions Kora × booK (bk.*, K-10 20/07/2026)

   booK V1 est FRONT-ONLY, ZÉRO WORKER (BOOK_BRIEF.md) : la bibliothèque
   vit dans IndexedDB du navigateur (`bk_library` v1, store `editions`).
   Node n'a pas d'IndexedDB natif — ce test embarque un FAUX IndexedDB
   MINIMAL (fait maison, zéro dépendance ajoutée), qui reproduit UNIQUEMENT
   ce que kora-actions.js consomme réellement (open/onupgradeneeded/
   transaction/objectStore/getAll). Ce n'est PAS un polyfill général.

   Teste :
     - bk.list_editions : façonnage (tri par mis-à-jour desc, poids
       recopié ou null si absent, titre par défaut si vide, cap 20) ;
     - bibliothèque vide → message, pas une liste vide muette ;
     - IndexedDB indisponible → erreur lisible, pas un crash ;
     - le SCHÉMA reproduit dans kora-actions.js (nom/version/store/
       keyPath) reste STRICTEMENT en phase avec app/book.js — la
       vérification exacte du bug évité (bibliothèque cassée à vie si
       Kora créait la base la première fois sans le bon store) ;
     - catalogue (caps + méta).

   Usage : node scripts/test-kora-book.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { readFileSync }  from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else      { failed++; console.error(`  \x1b[31m✗\x1b[0m ${name}`); }
}

globalThis.localStorage = { getItem: (k) => (k === 'ks_jwt' ? 'jwt-de-test' : null), setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = {};

/* ── Faux IndexedDB minimal ──────────────────────────────────────
   Couvre EXACTEMENT le sous-ensemble d'API que _bkOpen/_bkListEditions
   utilisent (app/kora-actions.js) : open(name,version) avec onupgrade-
   needed/onsuccess/onerror lus sur `rq.result`/`rq.error` (pas
   event.target — même style que book.js), db.objectStoreNames.contains,
   db.createObjectStore, db.transaction(store,mode).objectStore(name)
   .getAll(), db.close(). Une base = une Map en mémoire, réinitialisée
   par test via makeFakeIndexedDB(). */
function makeFakeIndexedDB({ preExisting = false, seed = [] } = {}) {
  const closeCalls = [];
  const dbs = new Map();          // name -> { version, stores: Map<storeName, Map<id,obj>> }
  if (preExisting) {
    const stores = new Map([['editions', new Map(seed.map(e => [e.id, e]))]]);
    dbs.set('bk_library', { version: 1, stores });
  }
  function makeReq() {
    return { onupgradeneeded: null, onsuccess: null, onerror: null, result: undefined, error: null };
  }
  return {
    closeCalls,
    open(name, version) {
      const rq = makeReq();
      queueMicrotask(() => {
        let entry = dbs.get(name);
        const isNew = !entry;
        if (!entry) { entry = { version: 0, stores: new Map() }; dbs.set(name, entry); }
        const needsUpgrade = version > entry.version;
        const dbHandle = {
          objectStoreNames: { contains: (n) => entry.stores.has(n) },
          createObjectStore: (n, opts) => { entry.stores.set(n, new Map()); return { keyPath: opts && opts.keyPath }; },
          transaction: (storeName, _mode) => ({
            objectStore: (n) => ({
              getAll: () => {
                const rq2 = makeReq();
                queueMicrotask(() => {
                  const store = entry.stores.get(n);
                  if (!store) { rq2.error = new Error(`Object store "${n}" introuvable — schéma jamais créé.`); rq2.onerror && rq2.onerror(); return; }
                  rq2.result = [...store.values()];
                  rq2.onsuccess && rq2.onsuccess();
                });
                return rq2;
              },
            }),
          }),
          close: () => closeCalls.push(name),
        };
        if (needsUpgrade) {
          entry.version = version;
          rq.result = dbHandle;
          rq.onupgradeneeded && rq.onupgradeneeded();
        }
        rq.result = dbHandle;
        rq.onsuccess && rq.onsuccess();
      });
      return rq;
    },
  };
}

const { runKoraAction, KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — bk.list_editions (façonnage)\x1b[0m');
{
  globalThis.indexedDB = makeFakeIndexedDB({ preExisting: true, seed: [
    { id: 'bk_1', title: 'Notice Missive', pages: [{ src: 'x' }, { src: 'y' }, { src: 'z' }], sizeMo: 2.4, updated: new Date(Date.now() - 1 * 86400e3).toISOString() },
    { id: 'bk_2', title: '', pages: [{ src: 'a' }], updated: new Date(Date.now() - 10 * 86400e3).toISOString() },   // titre vide, pas de sizeMo
    { id: 'bk_3', title: 'Rapport annuel', pages: [], sizeMo: 0.3, updated: new Date().toISOString() },             // le plus récent
  ] });
  const r = await runKoraAction('bk.list_editions', {});
  check('ok + 3 flipbooks', r.ok && r.data.total === 3);
  check('trié par mis-à-jour DESC (le plus récent en premier)', r.data.flipbooks[0].titre === 'Rapport annuel');
  const missive = r.data.flipbooks.find(f => f.titre === 'Notice Missive');
  check('pages recopiées (3)', missive.pages === 3);
  check('poids recopié (2.4 Mo)', missive.poids_mo === 2.4);
  const sansTitre = r.data.flipbooks.find(f => f.pages === 1);
  check('titre vide → « (sans titre) », pas une chaîne vide muette', sansTitre.titre === '(sans titre)');
  check('poids absent → null, pas 0 ni undefined qui planterait le JSON', sansTitre.poids_mo === null);
  check('note « propre à cet appareil » toujours présente', /appareil/.test(r.data.note));
  check('connexion IndexedDB refermée après lecture (aucune qui traîne)', globalThis.indexedDB.closeCalls.length === 1);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — bibliothèque vide → message\x1b[0m');
{
  globalThis.indexedDB = makeFakeIndexedDB({ preExisting: true, seed: [] });
  const r = await runKoraAction('bk.list_editions', {});
  check('0 flipbook → message plutôt qu’une liste vide muette', r.ok && r.data.total === 0 && /Aucun flipbook/.test(r.data.message));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — cap à 20 + compteur "en_plus"\x1b[0m');
{
  const seed = Array.from({ length: 25 }, (_, i) => ({
    id: 'bk_' + i, title: 'Livre ' + i, pages: [{ src: 'x' }],
    updated: new Date(Date.now() - i * 3600e3).toISOString(),
  }));
  globalThis.indexedDB = makeFakeIndexedDB({ preExisting: true, seed });
  const r = await runKoraAction('bk.list_editions', {});
  check('total réel = 25', r.ok && r.data.total === 25);
  check('flipbooks listés cappés à 20', r.data.flipbooks.length === 20);
  check('en_plus = 5', r.data.en_plus === 5);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — première ouverture JAMAIS (base absente) : le schéma se crée, pas de crash\x1b[0m');
{
  // Simule le cas réel critique : Kora est le TOUT PREMIER à toucher la
  // base sur cet appareil (l'utilisateur n'a jamais ouvert booK). Si le
  // store n'était pas créé par le même onupgradeneeded que book.js, la
  // bibliothèque resterait cassée à vie (leçon gravée dans le code).
  globalThis.indexedDB = makeFakeIndexedDB({ preExisting: false });
  const r = await runKoraAction('bk.list_editions', {});
  check('base créée à la volée, store présent, 0 flipbook proprement', r.ok && r.data.total === 0);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — IndexedDB indisponible → erreur lisible, pas un crash muet\x1b[0m');
{
  const saved = globalThis.indexedDB;
  delete globalThis.indexedDB;
  const r = await runKoraAction('bk.list_editions', {});
  check('erreur explicite, pas un throw générique', !r.ok && /IndexedDB indisponible/.test(r.error));
  globalThis.indexedDB = saved;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — le schéma dupliqué reste STRICTEMENT en phase avec app/book.js\x1b[0m');
{
  // Vérification statique, pas d'exécution : si book.js change un jour de
  // nom de base / version / store, ce test doit casser AVANT la prod
  // (sinon Kora ouvrirait une base fantôme silencieusement divergente).
  const bookSrc = readFileSync(join(ROOT, 'app/book.js'), 'utf8');
  const koraSrc = readFileSync(join(ROOT, 'app/kora-actions.js'), 'utf8');
  check('book.js ouvre bien "bk_library" v1 (référence)', /indexedDB\.open\(\s*'bk_library'\s*,\s*1\s*\)/.test(bookSrc));
  check('book.js crée bien le store "editions" (référence)', /createObjectStore\(\s*'editions'\s*,\s*\{\s*keyPath:\s*'id'\s*\}\s*\)/.test(bookSrc));
  check('kora-actions.js ouvre EXACTEMENT la même base/version', /indexedDB\.open\(\s*'bk_library'\s*,\s*1\s*\)/.test(koraSrc));
  check('kora-actions.js crée EXACTEMENT le même store/keyPath', /createObjectStore\(\s*'editions'\s*,\s*\{\s*keyPath:\s*'id'\s*\}\s*\)/.test(koraSrc));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — catalogue (caps + méta)\x1b[0m');
{
  check('1 action book présente', KORA_ACTIONS.filter(a => a.pad === 'book').length === 1);
  check('lecture seule (V1 = lectures simples, K-10, zéro écriture booK)', KORA_ACTIONS.filter(a => a.pad === 'book').every(a => a.mode === 'read'));
  check('toutes les desc ≤ 240 car.', KORA_ACTIONS.every(a => (a.desc || '').length <= 240));
  check('tous les desc de params ≤ 90 car.', KORA_ACTIONS.every(a => (a.params || []).every(p => (p.desc || '').length <= 90)));
  const bk = KORA_ACTIONS.find(a => a.id === 'bk.list_editions');
  check('bk.list_editions déclare un target', !!bk.target);
  check('KORA_PAD_META a une entrée book (label+desc≤160)',
    KORA_PAD_META.some(p => p.pad === 'book' && p.label && p.desc && p.desc.length <= 160));
  const open = KORA_ACTIONS.find(a => a.id === 'os.open_pad');
  check('os.open_pad mentionne book', /book/.test(open.desc) && /book/.test(open.params[0].desc));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 8 — Syntaxe (node --check)\x1b[0m');
for (const f of ['app/kora-actions.js', 'app/book.js', 'workers/src/routes/kora.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
