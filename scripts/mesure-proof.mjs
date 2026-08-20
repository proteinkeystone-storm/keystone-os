#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — GP-0 · LA MESURE (Ghost Writer, mode relecture)

   Avant ce fichier, le moteur de relecture n'avait AUCUN test, et
   « c'est mieux » n'était qu'une impression. Ce banc mesure.

   Il fait trois choses, dans cet ordre, et chacune vaut seule :

   A · LE FILET — assertions sur les fonctions PURES du moteur livré
       (`isNoiseSpelling`, `filterIssues`, `canonicalizeText`,
       `fuseIssues`). Tourne en Node, sans navigateur, SANS corpus.
       C'est ce qui manquait depuis toujours (cf. brief §2).

   B · LA FUMÉE — le VRAI `app/lib/proof-engine.js` démarre dans un
       vrai Chrome (puppeteer, déjà dépendance), charge le vrai Web
       Worker Grammalecte, et attrape une faute évidente sur une
       phrase inventée. Sans corpus non plus.
       ⚠ POURQUOI un navigateur : le moteur est un Web Worker qui
       charge 9 Mo de dictionnaires par XHR synchrone. jsdom ne peut
       pas l'exécuter — un banc jsdom passerait au vert sans rien
       prouver.

   C · LA MESURE — sur le corpus réel de la revue. Alertes BRUTES
       (`analyze(t,{noFilter:true})`) contre alertes AFFICHÉES
       (`analyze(t)`, le chemin de production), ventilation par type
       et par `ruleId`, mots d'orthographe avec leur phrase, et le
       tableau de bord du §6 du brief.
       ⚠ LE DÉPÔT EST PUBLIC : le corpus vit dans `_corpus-proof/`,
       qui est dans `.gitignore`. Aucun texte réel ne monte dans git.
       Corpus absent → le banc l'annonce, dit quoi fournir, et sort
       proprement (code 0). A et B, eux, ont déjà tourné.

   ── Lancer ──────────────────────────────────────────────────────
     npm run mesure:proof                  (corpus par défaut : _corpus-proof/)
     node scripts/mesure-proof.mjs <dossier>
     node scripts/mesure-proof.mjs --strict    (sortie 1 si corpus absent)

   Code de sortie 1 si — et seulement si — une assertion tombe, la
   fumée ne prend pas, ou (critère §4.3, le seul vrai danger du
   dispositif) UNE FAUTE RÉELLE EST MASQUÉE par les filtres.

   Patron : `scripts/test-desk-ui.mjs` (serveur statique + puppeteer).
   Voisin : `scripts/mesure-relecture.mjs` (l'AUTRE chemin, celui de
   desK, qui appelle Mistral — ne pas confondre, cf. brief §3).
   ═══════════════════════════════════════════════════════════════ */

import http                from 'node:http';
import fs                  from 'node:fs';
import crypto              from 'node:crypto';
import { join, dirname, extname, normalize, basename, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer           from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

const args    = process.argv.slice(2);
const STRICT  = args.includes('--strict');
const _arg    = args.find(a => !a.startsWith('--')) || '_corpus-proof';
const CORPUS  = isAbsolute(_arg) ? _arg : join(ROOT, _arg);   // un chemin absolu reste absolu

const gris  = s => `\x1b[2m${s}\x1b[0m`;
const gras  = s => `\x1b[1m${s}\x1b[0m`;
const vert  = s => `\x1b[32m${s}\x1b[0m`;
const ambre = s => `\x1b[33m${s}\x1b[0m`;
const rouge = s => `\x1b[31m${s}\x1b[0m`;

let passed = 0, failed = 0;
const echecs = [];
function check(nom, cond, detail) {
  if (cond) { passed++; console.log(`  ${vert('✓')} ${nom}`); }
  else {
    failed++; echecs.push(nom);
    console.error(`  ${rouge('✗')} ${nom}${detail !== undefined ? `  ${gris('→ ' + detail)}` : ''}`);
  }
}
function titre(t) { console.log(`\n${gras('▶ ' + t)}`); }

/* ════════════════════════════════════════════════════════════════
   A · LE FILET — les fonctions pures, en Node, sans navigateur.

   Le module ne construit son Worker QUE dans `_ensureWorker()`, donc
   Node peut l'importer tel quel : ce sont bien les fonctions LIVRÉES
   qu'on éprouve, pas une copie.
   ════════════════════════════════════════════════════════════════ */

const moteur   = await import(pathToFileURL(join(ROOT, 'app/lib/proof-engine.js')).href);
const dicoBase = await import(pathToFileURL(join(ROOT, 'app/lib/proof-dico-base.js')).href);

titre('A · Les fonctions pures du moteur (aucun test jusqu\'ici)');

{
  const { isNoiseSpelling, filterIssues, canonicalizeText, fuseIssues } = moteur;

  // Les filtres de PRODUCTION, tels que l'UI les laisse par défaut :
  // dico perso VIDE (localStorage vierge), les trois pré-filtres actifs.
  const prod = { ignore: new Set(), skipAllCaps: true, skipWithDigits: true, skipUrlEmail: true, minLetters: 3 };

  // — Ce que le moteur écarte déjà (le bruit grossier) —
  check('sigle TOUT-CAPS écarté (MINARM)',            isNoiseSpelling('MINARM', prod) === true);
  check('sigle capitalisé avec tiret écarté (ÉTAT-MAJOR)', isNoiseSpelling('ÉTAT-MAJOR', prod) === true);
  check('token avec chiffre écarté quand le filtre est actif (A400M)',
    isNoiseSpelling('A400M', prod) === true);
  // ⚠ Le DÉFAUT du module est l'inverse depuis GP-1 : en relecture de TEXTE,
  // « Km2 » doit être signalé (c'est « km² » mal écrit). Seul proof-pdf.js
  // rallume le filtre, où le collage vient de l'extraction.
  check('par défaut, un mot collé à un nombre N\'est PAS masqué (Km2)',
    isNoiseSpelling('Km2') === false);
  check('un chiffre compte comme un signe (Km2 fait trois, pas deux)',
    isNoiseSpelling('Km2', { ...prod, skipWithDigits: false }) === false);
  check('un vrai fragment de deux signes reste écarté (vn, er, a1)',
    isNoiseSpelling('vn') === true && isNoiseSpelling('er') === true && isNoiseSpelling('a1') === true);
  check('un consommateur peut rallumer le filtre par surcharge PARTIELLE',
    filterIssues([{ type: 'spelling', word: 'Km2', offset: 0, len: 3 }],
                 { skipWithDigits: true }, 'Km2 de désert').length === 0);
  check('…et la surcharge partielle ne perd pas le reste de la config',
    filterIssues([{ type: 'spelling', word: 'ab', offset: 0, len: 2 }],
                 { skipWithDigits: true }, 'ab').length === 0);
  check('adresse e-mail écartée',                     isNoiseSpelling('contact@exemple.fr', prod) === true);
  check('fragment d\'URL écarté (www.…)',             isNoiseSpelling('www.exemple.fr', prod) === true);
  check('mot de 2 lettres écarté (bruit d\'extraction PDF)', isNoiseSpelling('ok', prod) === true);

  // — Ce qui RESTE, et que GP-1 vise —
  check('nom propre en casse normale NON écarté (Degrima) — c\'est la cible de GP-1',
    isNoiseSpelling('Degrima', prod) === false);
  check('mot vide : on ne masque JAMAIS à l\'aveugle',
    isNoiseSpelling('', prod) === false);

  // — Le dico perso, insensible à la casse —
  check('dico perso : « Lefebvre » appris en minuscules masque « Lefebvre »',
    isNoiseSpelling('Lefebvre', { ...prod, ignore: new Set(['lefebvre']) }) === true);
  check('dico perso accepte aussi un tableau (pas seulement un Set)',
    isNoiseSpelling('Lefebvre', { ...prod, ignore: ['lefebvre'] }) === true);

  // — filterIssues : ortho filtrée, grammaire jamais (sauf denylist) —
  const lot = [
    { type: 'spelling', word: 'MINARM',  offset: 0,  len: 6 },
    { type: 'spelling', word: 'Degrima', offset: 10, len: 7 },
    { type: 'spelling', offset: 20, len: 4 },                                   // sans `word`
    { type: 'grammar',  ruleId: 'g0__virg_virgules_manquantes_xx', offset: 30, len: 3 },  // denylistée (préfixe)
    { type: 'grammar',  ruleId: 'g2__accord_pp_cod',         offset: 40, len: 5 },  // fiable
  ];
  const gardees = filterIssues(lot, prod);
  check('filterIssues écarte le sigle et garde le nom propre',
    gardees.some(i => i.word === 'Degrima') && !gardees.some(i => i.word === 'MINARM'));
  check('une alerte d\'ortho SANS mot est conservée (pas de masquage à l\'aveugle)',
    gardees.some(i => i.type === 'spelling' && !i.word));
  check('la denylist coupe bien par PRÉFIXE de ruleId',
    !gardees.some(i => i.ruleId === 'g0__virg_virgules_manquantes_xx'));
  check('la denylist du PDF coupe strictement plus que celle du texte',
    moteur.GRAMMAR_DENYLIST_PDF.length > moteur.GRAMMAR_DENYLIST_TEXTE.length &&
    moteur.GRAMMAR_DENYLIST_TEXTE.every(r => moteur.GRAMMAR_DENYLIST_PDF.indexOf(r) >= 0),
    `texte ${moteur.GRAMMAR_DENYLIST_TEXTE.length} · pdf ${moteur.GRAMMAR_DENYLIST_PDF.length}`);
  check('les règles d\'impératif ne sont coupées QUE sur le chemin PDF',
    !moteur.GRAMMAR_DENYLIST_TEXTE.some(r => r.indexOf('gv1__imp_verbe') === 0) &&
     moteur.GRAMMAR_DENYLIST_PDF.filter(r => r.indexOf('gv1__imp_verbe') === 0).length === 2);
  check('une règle rendue au texte n\'est plus coupée',
    filterIssues([{ type: 'grammar', ruleId: 'gv1__imp_verbe_groupe3_d__b2_a1_1', offset: 0, len: 5 }],
                 prod, 'Prend garde').length === 1);
  check('…mais elle reste coupée sur le chemin PDF',
    filterIssues([{ type: 'grammar', ruleId: 'gv1__imp_verbe_groupe3_d__b2_a1_1', offset: 0, len: 5 }],
                 { grammarDenylist: moteur.GRAMMAR_DENYLIST_PDF }, 'Prend garde').length === 0);
  check('la grammaire fiable passe intacte',
    gardees.some(i => i.ruleId === 'g2__accord_pp_cod'));
  check('filterIssues survit à une entrée nulle', filterIssues([null, undefined], prod).length === 0);

  // — canonicalizeText : la FIDÉLITÉ DES OFFSETS en dépend —
  check('CRLF → LF (et la longueur diminue d\'autant)', canonicalizeText('a\r\nb').length === 3);
  check('CR seul → LF',                                 canonicalizeText('a\rb') === 'a\nb');
  check('trait d\'union conditionnel U+00AD retiré',     canonicalizeText('mi­lieu') === 'milieu');
  check('normalisation NFC (é décomposé → 1 signe)',     canonicalizeText('été').length === 3);
  check('null/undefined → chaîne vide',                  canonicalizeText(null) === '' && canonicalizeText(undefined) === '');

  // — fuseIssues : le contrat sur lequel GP-5 s'appuiera —
  const g = { offset: 5, len: 4, source: 'grammalecte', suggestions: ['a'] };
  const ia = { offset: 6, len: 2, source: 'ai',          suggestions: ['b'] };
  const loin = { offset: 90, len: 3, source: 'ai',       suggestions: [] };
  const fus = fuseIssues([g], [ia, loin]);
  check('fuseIssues : au chevauchement, grammalecte l\'emporte',
    fus.length === 2 && fus.some(i => i.source === 'grammalecte' && i.offset === 5));
  check('fuseIssues : les suggestions des deux sources sont agrégées',
    fus.find(i => i.offset === 5).suggestions.join(',') === 'a,b');
  check('fuseIssues : une alerte IA sans chevauchement est ajoutée',
    fus.some(i => i.offset === 90));
  check('fuseIssues : sortie triée par position',
    fus.map(i => i.offset).join(',') === '5,90');
}

/* ── GP-1 · l'impasse sur les noms propres ────────────────────────
   Phrases INVENTÉES (dépôt public). `nom` = le mot signalé, `avant` = ce qui
   le précède : c'est TOUT ce dont la règle a besoin pour trancher. */
titre('A bis · La règle des noms propres (GP-1)');
{
  const { isProperNounSpelling, filterIssues } = moteur;
  // Fabrique un cas : le texte vaut `avant + mot + suite`, l'offset suit.
  const cas = (avant, mot, sugg) => isProperNounSpelling(mot, avant + mot + ' et la suite.', avant.length, sugg);

  // — Le cœur de la règle —
  check('milieu de phrase → nom propre, on se tait',
    cas('Le capitaine ', 'Degrima') === true);
  check('début du texte → majuscule normale, on continue de vérifier',
    cas('', 'Degrima') === false);
  check('début de ligne → on continue de vérifier',
    cas('Une phrase.\n', 'Degrima') === false);

  // — Positions où la majuscule est GRAMMATICALE (brief §GP-1) —
  for (const [lbl, av] of [['point', 'Fin de phrase. '], ['point d\'interrogation', 'Vraiment ? '],
                           ['point d\'exclamation', 'Enfin ! '], ['points de suspension', 'Et puis… '],
                           ['deux-points', 'Il a dit : '], ['point-virgule', 'Il vient ; '],
                           ['guillemet ouvrant', 'Il a dit : « '], ['guillemet droit', 'Il a dit : "'],
                           ['tiret de dialogue', 'Il répond :\n— ']]) {
    check(`après ${lbl} → on continue de vérifier`, cas(av, 'Degrima') === false, `avant = ${JSON.stringify(av)}`);
  }

  // ⚠ Le piège payé le 2026-08-20 : la typographie française met une espace
  // INSÉCABLE après « . Un balayage qui ne connaît que l'espace ordinaire
  // s'arrête dessus et conclut « nom propre » — la règle se trompe en silence.
  check('après un guillemet suivi d\'une espace INSÉCABLE → on continue de vérifier',
    cas('Il a dit : «\u00a0', 'Degrima') === false,
    'l\'insécable U+00A0 doit être traversée comme une espace');
  check('après un guillemet suivi d\'une insécable étroite (U+202F) → idem',
    cas('Il a dit : «\u202f', 'Degrima') === false);

  // — Ce que la règle NE touche PAS —
  check('mot en minuscules → hors sujet', cas('un ', 'degrima') === false);
  check('sigle TOUT-CAPS → hors sujet (c\'est skipAllCaps)', cas('le ', 'MINARM') === false);
  check('mot contenant un chiffre → hors sujet (une référence n\'est pas un nom)',
    cas('de ', 'Km2') === false);
  check('sans texte ni position → on ne masque JAMAIS à l\'aveugle',
    isProperNounSpelling('Degrima', undefined, undefined) === false);
  check('offset non numérique → on ne masque pas',
    isProperNounSpelling('Degrima', 'Le capitaine Degrima', NaN) === false);

  // — Le GARDE : mêmes lettres qu'une suggestion = coquille, pas un nom —
  check('accent oublié sur une capitale (Egypte/Égypte) → l\'alerte est GARDÉE',
    cas('en ', 'Egypte', ['Égypte']) === false);
  check('lettres interverties (Lybie/Libye) → l\'alerte est GARDÉE',
    cas('En ', 'Lybie', ['Libye', 'Lydie']) === false);
  check('un vrai nom propre garde son silence malgré des suggestions lointaines',
    cas('de ', 'Delaunois', ['Cadrai', 'Cachai']) === true);
  check('une suggestion identique au mot ne déclenche pas le garde',
    cas('de ', 'Degrima', ['Degrima']) === true);

  // — L'initiale n'est pas une fin de phrase —
  check('après une INITIALE (« B. Degrima ») → c\'est un patronyme, on se tait',
    cas('le président B. ', 'Degrima') === true);
  check('après un vrai point, la majuscule reste grammaticale',
    cas('Fin de phrase. ', 'Degrima') === false);
  check('deux lettres avant le point ≠ initiale (« Cf. Degrima »)',
    cas('Cf. ', 'Degrima') === false);

  // — GP-2 couche 1 : le dictionnaire de BASE livré avec l'outil —
  check('le dico de base tait une abréviation de grade (Lcl)', moteur.isNoiseSpelling('Lcl') === true);
  check('…et la couper le fait réapparaître',
    moteur.isNoiseSpelling('Lcl', { ...moteur.getProofFilters(), ignore: new Set(), useBaseDico: false }) === false);
  check('le dico de base ne contient AUCUNE entrée de moins de 3 signes (minLetters les couvre déjà)',
    dicoBase.DICO_BASE.every(w => w.length >= 3),
    dicoBase.DICO_BASE.filter(w => w.length < 3).join(', '));
  check('le dico de base ne contient que des lettres latines et des traits d\'union',
    dicoBase.DICO_BASE.every(w => /^[a-zà-ÿ-]+$/.test(w)),
    dicoBase.DICO_BASE.filter(w => !/^[a-zà-ÿ-]+$/.test(w)).join(', '));
  check('le dico de base est en minuscules (le moteur compare en minuscules)',
    dicoBase.DICO_BASE.every(w => w === w.toLowerCase()));

  // — GP-2 : le nom COMPOSÉ, reconnu où qu'il tombe —
  {
    const f = moteur.isProperNounSpelling;
    const t = 'El-Bakri parle. Le président al-Mansouri écoute Roche-Ferrand.';
    check('nom composé en TÊTE de phrase → tu (El-Bakri)', f('El-Bakri', t, 0, []) === true);
    check('nom composé commençant en minuscule → tu (al-Mansouri)',
      f('al-Mansouri', t, t.indexOf('al-Mansouri'), []) === true);
    check('nom composé accentué → tu (Roche-Ferrand)', f('Roche-Ferrand', t, t.indexOf('Roche-Ferrand'), []) === true);
    check('composé COMMUN (segments en minuscules) → toujours vérifié (socio-économiques)',
      f('socio-économiques', 'les forces socio-économiques', 10, []) === false);
    check('un composé mal orthographié en minuscules reste vérifié (saint-etienne)',
      f('saint-etienne', 'il vit à saint-etienne depuis', 9, []) === false);
  }

  // — filterIssues : la grammaire n'est JAMAIS concernée (critère de fin GP-1) —
  const txt = 'Le capitaine Degrima commande la compagnie.';
  const lotN = [
    { type: 'spelling', word: 'Degrima', offset: 13, len: 7, suggestions: [] },
    { type: 'grammar', ruleId: 'g3__gn_accord', offset: 13, len: 7 },
  ];
  const apres = filterIssues(lotN, null, txt);
  check('le nom propre est masqué', !apres.some(i => i.type === 'spelling'));
  check('l\'alerte de GRAMMAIRE au même endroit est INTACTE', apres.some(i => i.type === 'grammar'));
  check('sans le texte, filterIssues ne masque aucun nom propre',
    filterIssues(lotN, null).some(i => i.type === 'spelling'));
  check('skipProperNouns:false rend la règle inerte',
    filterIssues(lotN, { ...moteur.getProofFilters(), ignore: new Set(), skipProperNouns: false }, txt)
      .some(i => i.type === 'spelling'));
}

/* ════════════════════════════════════════════════════════════════
   LE SERVEUR DE BANC — statique, calqué sur test-desk-ui.mjs.
   Le moteur charge son worker sur `/app/lib/…` et ses dictionnaires
   sur `/app/vendor/grammalecte/…` : il FAUT une vraie origine http.
   ════════════════════════════════════════════════════════════════ */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.bdic': 'application/octet-stream',
};

// Page de banc : elle importe le moteur EXACTEMENT comme l'UI le fait
// (`await import(...)`, en paresseux). Un banc qui l'importerait autrement
// ne testerait pas le chemin réel — cf. brief §7.
const HARNAIS = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>banc mesure-proof</title></head><body>
<script type="module">
  try {
    const eng = await import('/app/lib/proof-engine.js');
    // Options de PRODUCTION : aucune famille typographique cochée par défaut
    // dans l'UI (ghostwriter-proof.js, TYPO_KEY vierge) → tout à false.
    eng.setProofOptions({ apos:false, maj:false, minis:false, typo:false,
                          esp:false, nbsp:false, tab:false, num:false, exposant:false });
    // Dico perso VIDE : c'est l'état d'un navigateur neuf (le point de départ).
    eng.setProofFilters({ ignoreWords: [] });
    await eng.warmUp();
    window.__PROOF__ = eng;
    window.__READY__ = true;
  } catch (e) {
    window.__BOOM__ = String((e && e.message) || e);
  }
<\/script></body></html>`;

function demarrerServeur() {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (p === '/__banc-proof.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(HARNAIS);
    }
    const cible = normalize(join(ROOT, p));
    if (!cible.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(cible, (e, data) => {
      if (e) { res.writeHead(404); return res.end('introuvable'); }
      res.writeHead(200, {
        'Content-Type': MIME[extname(cible).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

/* ════════════════════════════════════════════════════════════════
   OUTILS DE LECTURE DU CORPUS
   ════════════════════════════════════════════════════════════════ */

const cle       = it => `${it.offset}+${it.len}`;
const empreinte = t  => 'sha1:' + crypto.createHash('sha1').update(t, 'utf8').digest('hex').slice(0, 16);

// La phrase autour de l'alerte — c'est elle qui permet de juger « vraie »
// ou « faux positif » sans rouvrir l'article.
function phraseAutour(t, offset, len) {
  let d = offset;
  while (d > 0 && !/[.?!…\n]/.test(t[d - 1])) d--;
  while (d < offset && /\s/.test(t[d])) d++;
  let f = offset + len;
  while (f < t.length && !/[.?!…\n]/.test(t[f])) f++;
  if (f < t.length) f++;
  let avant = t.slice(d, offset).replace(/\s+/g, ' ');
  let apres = t.slice(offset + len, f).replace(/\s+/g, ' ');
  const mot = t.slice(offset, offset + len);
  if (avant.length > 90) avant = '…' + avant.slice(-90);
  if (apres.length > 90) apres = apres.slice(0, 90) + '…';
  return (avant + '⟦' + mot + '⟧' + apres).trim();
}

function listerTextes(dir) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.txt') && !f.startsWith('_') && !f.startsWith('.'))
    .sort()
    .map(f => ({ nom: f, brut: fs.readFileSync(join(dir, f), 'utf8') }))
    .filter(x => x.brut.trim());
}

// Ce qu'il faut fournir, dit une fois, en clair. Affiché quand le corpus
// manque — c'est la sortie utile du banc tant qu'il n'est pas là.
function direQuoiFournir(dir) {
  const rel = dir.replace(ROOT + '/', '');
  console.log(`\n${gras(ambre('▶ C · La mesure — AUCUN CORPUS, rien n\'a été mesuré'))}`);
  console.log(gris(`   dossier attendu : ${rel}/  (absent ou sans .txt exploitable)`));
  console.log(`
${gras('   Ce qu\'il faut y déposer')}

   1. ${gras('Trois articles de la revue, en TEXTE BRUT')} — un fichier .txt par
      article, encodé en UTF-8, nommé librement (ex. ${gris('01-edito.txt')}).
      · le texte tel qu'il ARRIVE à la relecture (avec ses fautes), pas le
        texte publié et déjà corrigé — sinon on mesure un corpus propre ;
      · ni titraille de maquette, ni légendes, ni ours : le corps de l'article ;
      · de vrais articles : ce sont les noms propres, les grades et les unités
        qui font les faux positifs qu'on cherche à compter.

   2. ${gras('Rien d\'autre pour le premier tour.')} Relancez le banc : il produira
      ${gris(rel + '/verite.modele.json')} — la liste de TOUTES les alertes
      brutes, chacune avec son mot, son message, sa phrase et un champ
      ${gras('"verdict": null')}.

   3. ${gras('Vous relisez à l\'écran')} — aucun fichier à ouvrir :
        ${gras('npm run relire:proof')}
      L'article s'affiche avec ses alertes surlignées. ${vert('F')} = c'est une
      faute, ${ambre('C')} = le texte est correct. Tout s'enregistre au fil de
      l'eau, et les fautes ${gras('ratées')} s'ajoutent depuis le même écran.

   4. ${gras('npm run mesure:proof')} — le tableau de bord du §6 se refait
      sur vos verdicts.

${gras('   Ce qui ne monte JAMAIS dans git')} — le dépôt est PUBLIC.
   ${rel}/ est déjà dans .gitignore (ligne « _corpus-proof/ »). Les .txt,
   verite.json et le rapport y restent. Seul ce script est versionné.
`);
}

/* ════════════════════════════════════════════════════════════════
   B · LA FUMÉE puis C · LA MESURE — dans un vrai Chrome.
   ════════════════════════════════════════════════════════════════ */

const textes = listerTextes(CORPUS);
const srv    = await demarrerServeur();
const BASE   = `http://127.0.0.1:${srv.address().port}`;
const nav    = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page   = await nav.newPage();
const erreursPage = [];
page.on('pageerror', e => erreursPage.push(String((e && e.message) || e)));
page.on('console', m => { if (m.type() === 'error') erreursPage.push('console: ' + m.text()); });

let rapport = null;

try {
  titre('B · Le moteur livré démarre pour de vrai (Chrome + Web Worker)');

  await page.goto(`${BASE}/__banc-proof.html`, { waitUntil: 'domcontentloaded' });
  let demarre = true;
  try {
    // 9 Mo de dictionnaires en XHR synchrone : large, mais pas infini.
    await page.waitForFunction('window.__READY__ === true || window.__BOOM__', { timeout: 120000 });
  } catch (_) { demarre = false; }
  const boom = await page.evaluate(() => window.__BOOM__ || null);
  check('le vrai app/lib/proof-engine.js s\'importe et son worker Grammalecte s\'initialise',
    demarre && !boom, boom || 'délai de 120 s dépassé (dictionnaires ~9 Mo)');

  if (demarre && !boom) {
    // Phrase INVENTÉE pour le banc (aucun texte réel dans un dépôt public).
    // Deux défauts posés à la main : un mot faux, un accord faux.
    const CANARI = "Le chef de corps a présenté ses conclusion aux officiers. "
                 + "Le rapport quil a remis hier était complet.";
    const fumee = await page.evaluate(async (t) => {
      const e = window.__PROOF__;
      const brut = await e.analyze(t, { noFilter: true });
      const aff  = await e.analyze(t);
      return {
        brutes: brut.issues.length, affichees: aff.issues.length,
        ortho: brut.issues.filter(i => i.type === 'spelling').map(i => i.word),
        gram:  brut.issues.filter(i => i.type === 'grammar').length,
        suggestions: (brut.issues.find(i => i.word === 'quil') || {}).suggestions || [],
      };
    }, CANARI);
    check('il attrape le mot fautif « quil »', fumee.ortho.includes('quil'),
      'mots signalés : ' + JSON.stringify(fumee.ortho));
    check('et il propose « qu\'il » en correction',
      fumee.suggestions.some(s => /qu.il/.test(s)), JSON.stringify(fumee.suggestions));
    check('il attrape aussi au moins une faute de grammaire (« ses conclusion »)',
      fumee.gram >= 1, fumee.gram + ' alerte(s) de grammaire');
    check('les filtres n\'avalent pas ces fautes-là (brutes = affichées)',
      fumee.brutes === fumee.affichees, `brutes ${fumee.brutes} · affichées ${fumee.affichees}`);
  }

  /* ── B bis · La batterie des règles de grammaire (GP-3) ────────
     Chaque entrée de la denylist est une DÉCISION, et chaque décision a ici sa
     phrase témoin. Une session future qui rallongerait la liste sans preuve
     fera tomber ces assertions — c'est le but. Phrases INVENTÉES (dépôt public).
     ───────────────────────────────────────────────────────────── */
  if (demarre && !boom) {
    titre('B bis · Les règles de grammaire, une phrase témoin par décision');

    const RENDUES = [
      ['gv1__imp_verbe_groupe3',         'Prend garde à toi, la route est longue.',  'Prends'],
      ['gv1__imp_verbe_groupe2_groupe3', 'Finit ton rapport avant ce soir.',         'Finis'],
      ['g2__conf_ça_çà_sa',              'Sa ne se fait pas dans une unité.',        'Ça'],
      ['g2__conf_ça_çà_sa',              'Il a pris ça veste et il est parti.',      'sa'],
    ];
    const COUPEES = [
      ['g0__virg_virgules_manquantes',   'Il a couru car il était en retard.'],
      ['g0__virg_virgules_manquantes',   'La manoeuvre est dure mais elle forme les cadres.'],
    ];
    const CORRECTES = [
      'Il prend garde à lui dans la descente.',
      'Le caporal finit son rapport avant la nuit.',
      'Chacun garde sa place, sa ligne et sa mission.',
      'Ça tient debout, ça marche, ça suffit.',
    ];
    // Texte reconstruit depuis un PDF : la maquette coupe la phrase, la ligne
    // commence par un verbe. C'est là que les règles d'impératif s'affolent.
    const FORME_PDF = [
      'Suit la phase de recueil des blessés',
      'Le dispositif, mis en place en janvier\ncomprend trois échelons',
    ];

    const bat = await page.evaluate(async (jeux) => {
      const e = window.__PROOF__;
      const vu = async (t, pdf) => {
        const r = await e.analyze(t, pdf
          ? { filters: { skipWithDigits: true, grammarDenylist: e.GRAMMAR_DENYLIST_PDF } }
          : {});
        return r.issues.filter(i => i.type === 'grammar')
                .map(i => ({ r: i.ruleId, s: i.suggestions || [] }));
      };
      const out = { rendues: [], coupees: [], correctes: [], pdf: [], pdfGarde: [] };
      for (const [id, t] of jeux.RENDUES) out.rendues.push(await vu(t, false));
      for (const [id, t] of jeux.COUPEES) out.coupees.push(await vu(t, false));
      for (const t of jeux.CORRECTES)     out.correctes.push(await vu(t, false));
      for (const t of jeux.FORME_PDF)     out.pdf.push(await vu(t, true));
      out.pdfGarde = await vu(jeux.RENDUES[2][1], true);   // ça/sa reste actif en PDF
      return out;
    }, { RENDUES, COUPEES, CORRECTES, FORME_PDF });

    RENDUES.forEach(([id, t, sug], k) => {
      const a = bat.rendues[k].filter(x => x.r.indexOf(id) === 0);
      check(`rendue au texte · ${id.split('__').pop()} attrape « ${t.slice(0, 26)}… »`,
        a.length > 0 && a.some(x => x.s.indexOf(sug) >= 0),
        'attendu ' + JSON.stringify(sug) + ', obtenu ' + JSON.stringify(bat.rendues[k]));
    });
    COUPEES.forEach(([id, t], k) => {
      check(`reste coupée · ${id.split('__').pop()} se tait sur « ${t.slice(0, 26)}… »`,
        bat.coupees[k].every(x => x.r.indexOf(id) !== 0), JSON.stringify(bat.coupees[k]));
    });
    CORRECTES.forEach((t, k) => {
      check(`aucune alerte sur une phrase correcte · « ${t.slice(0, 34)}… »`,
        bat.correctes[k].length === 0, JSON.stringify(bat.correctes[k]));
    });
    FORME_PDF.forEach((t, k) => {
      check(`chemin PDF · pas d'impératif sur une ligne coupée par la maquette (${k + 1})`,
        bat.pdf[k].every(x => x.r.indexOf('gv1__imp_verbe') !== 0), JSON.stringify(bat.pdf[k]));
    });
    check('chemin PDF · la confusion ça/sa reste signalée',
      bat.pdfGarde.some(x => x.r.indexOf('g2__conf_ça_çà_sa') === 0), JSON.stringify(bat.pdfGarde));
  }

  /* ── C · La mesure ───────────────────────────────────────────── */

  if (!textes || !textes.length) {
    direQuoiFournir(CORPUS);
  } else if (!(demarre && !boom)) {
    console.log(`\n${rouge('▶ C · La mesure — sautée : le moteur n\'a pas démarré.')}`);
  } else {
    titre(`C · La mesure — ${textes.length} texte(s) de ${basename(CORPUS)}/`);

    const parTexte = [];
    for (const t of textes) {
      const r = await page.evaluate(async (txt) => {
        const e = window.__PROOF__;
        const brut = await e.analyze(txt, { noFilter: true });   // avant filtres
        const aff  = await e.analyze(txt);                       // chemin de PRODUCTION
        // Contrôle : `filterIssues` seul suffit-il encore à expliquer l'écart ?
        // Le jour où `analyze` filtrera avec le CONTEXTE (GP-1 : position du mot
        // dans la phrase), ces deux nombres divergeront — et ce banc le dira au
        // lieu de mesurer à côté.
        const parFilterIssues = e.filterIssues(brut.issues).length;
        return { texte: brut.text, brutes: brut.issues, affichees: aff.issues, parFilterIssues };
      }, t.brut);

      const vues = new Set(r.affichees.map(cle));
      parTexte.push({
        nom: t.nom, canonique: r.texte, empreinte: empreinte(r.texte),
        brutes: r.brutes, affichees: r.affichees, vues, parFilterIssues: r.parFilterIssues,
      });

      const o = r.affichees.filter(i => i.type === 'spelling').length;
      const g = r.affichees.filter(i => i.type === 'grammar').length;
      console.log(`  ${gras(t.nom.padEnd(28))} ${String(r.texte.length).padStart(6)} signes` +
        ` · brutes ${String(r.brutes.length).padStart(4)} → affichées ${String(r.affichees.length).padStart(4)}` +
        gris(`  (ortho ${o} · gram ${g})`));
      if (r.parFilterIssues !== r.affichees.length) {
        console.log(gris(`      note · analyze() filtre au-delà de filterIssues() seul` +
          ` (${r.parFilterIssues} vs ${r.affichees.length}) — filtrage contextuel actif.`));
      }
    }

    /* ── La vérité terrain ──────────────────────────────────────── */

    const cheminVerite = join(CORPUS, 'verite.json');
    let verite = null;
    if (fs.existsSync(cheminVerite)) {
      try { verite = JSON.parse(fs.readFileSync(cheminVerite, 'utf8')); }
      catch (e) { console.log(`\n  ${rouge('verite.json illisible')} ${gris('→ ' + e.message)}`); }
    }

    if (!verite) {
      // Pas de verdicts : on fabrique la feuille à annoter, pré-remplie.
      const modele = {
        '_lisez-moi': [
          'GP-0 — feuille de vérité terrain du correcteur (GHOSTWRITER_PROOF_SPRINTS.md §5).',
          'Pour CHAQUE alerte, remplacez "verdict": null par "vraie" ou "faux-positif".',
          '  "vraie"        = le correcteur a raison, c\'est bien une faute.',
          '  "faux-positif" = le texte est correct, l\'alerte est injustifiée.',
          'Puis listez dans "manques" les fautes que le correcteur a RATÉES.',
          'Enfin, renommez ce fichier en verite.json et relancez : npm run mesure:proof',
          'Ce fichier contient du texte de la revue : il ne quitte JAMAIS ce dossier (dépôt PUBLIC).',
        ],
        textes: {},
      };
      for (const p of parTexte) {
        modele.textes[p.nom] = {
          empreinte: p.empreinte,
          _note: 'Ne modifiez pas le .txt après avoir jugé : les positions se décaleraient (l\'empreinte le dira).',
          alertes: p.brutes.map(it => ({
            cle: cle(it),
            type: it.type,
            mot: it.word || p.canonique.slice(it.offset, it.offset + it.len),
            regle: it.ruleId || '',
            message: it.message || '',
            suggestions: (it.suggestions || []).slice(0, 4),
            affichee: p.vues.has(cle(it)),
            phrase: phraseAutour(p.canonique, it.offset, it.len),
            verdict: null,
          })),
          manques: [
            { extrait: '(copiez ici le bout de phrase fautif)', attendu: '(la forme correcte)', pourquoi: '(la règle)' },
          ],
        };
      }
      const dest = join(CORPUS, 'verite.modele.json');
      fs.writeFileSync(dest, JSON.stringify(modele, null, 2), 'utf8');
      const total = parTexte.reduce((n, p) => n + p.brutes.length, 0);
      console.log(`\n  ${ambre('verite.json absent')} — feuille à annoter écrite :`);
      console.log(`  ${gras(dest.replace(ROOT + '/', ''))} ${gris(`(${total} alertes à juger)`)}`);
      console.log(gris('  Remplissez les "verdict", ajoutez les "manques", renommez en verite.json, relancez.'));
    }

    /* ── Ventilations (elles n'attendent pas les verdicts) ──────── */

    const toutesBrutes  = parTexte.flatMap(p => p.brutes.map(it => ({ ...it, _f: p.nom, _p: p })));
    const toutesVues    = parTexte.flatMap(p => p.affichees.map(it => ({ ...it, _f: p.nom, _p: p })));
    const verdictDe = (fichier, k) => {
      if (!verite || !verite.textes || !verite.textes[fichier]) return null;
      const a = (verite.textes[fichier].alertes || []).find(x => x.cle === k);
      const v = a && a.verdict;
      return (v === 'vraie' || v === 'faux-positif') ? v : null;
    };

    titre('Ventilation par type');
    for (const ty of ['spelling', 'grammar']) {
      const b = toutesBrutes.filter(i => i.type === ty).length;
      const a = toutesVues.filter(i => i.type === ty).length;
      const nom = ty === 'spelling' ? 'orthographe' : 'grammaire  ';
      console.log(`  ${nom}  brutes ${String(b).padStart(4)} → affichées ${String(a).padStart(4)}` +
        gris(`   (${b - a} écartée(s) par les filtres actuels)`));
    }

    titre('Classement des règles de grammaire (ce qui alimentera GP-3)');
    {
      const par = new Map();
      for (const it of toutesVues.filter(i => i.type === 'grammar')) {
        const r = it.ruleId || '(sans id)';
        if (!par.has(r)) par.set(r, { n: 0, vraies: 0, fp: 0, njugees: 0, exemple: '' });
        const e = par.get(r);
        e.n++;
        const v = verdictDe(it._f, cle(it));
        if (v === 'vraie') e.vraies++; else if (v === 'faux-positif') e.fp++; else e.njugees++;
        if (!e.exemple) e.exemple = (it.message || '').slice(0, 70);
      }
      const rangs = [...par.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20);
      if (!rangs.length) console.log(gris('  (aucune alerte de grammaire)'));
      for (const [r, e] of rangs) {
        // ⚠ « 0 vraie faute ICI » ne veut PAS dire « règle à couper » : GP-3 a
        // montré que les trois candidates du corpus attrapent de vraies fautes
        // dès qu'on les sonde ailleurs. Une denylist se décide sur une
        // BATTERIE (cf. B bis), jamais sur une occurrence.
        const marque = (verite && e.njugees === 0 && e.vraies === 0 && e.fp > 0)
          ? ambre('  ← à SONDER (0 vraie faute ici — pas une preuve)')
          : (e.vraies > 0 ? vert('  ← À GARDER (attrape du vrai)') : '');
        console.log(`  ${String(e.n).padStart(3)} × ${r.padEnd(34)}` +
          (verite ? gris(` vraies ${e.vraies} · fp ${e.fp} · à juger ${e.njugees}`) : '') + marque);
        if (e.exemple) console.log(gris(`        « ${e.exemple} »`));
      }
    }

    titre('Mots d\'orthographe encore signalés (ce qui alimentera GP-1 et GP-2)');
    {
      const par = new Map();
      for (const it of toutesVues.filter(i => i.type === 'spelling')) {
        const w = it.word || '';
        if (!par.has(w)) par.set(w, { n: 0, phrase: phraseAutour(it._p.canonique, it.offset, it.len), v: verdictDe(it._f, cle(it)) });
        par.get(w).n++;
      }
      const rangs = [...par.entries()].sort((a, b) => b[1].n - a[1].n);
      if (!rangs.length) console.log(gris('  (aucune alerte d\'orthographe)'));
      for (const [w, e] of rangs.slice(0, 40)) {
        const v = e.v === 'vraie' ? rouge(' vraie') : e.v === 'faux-positif' ? ambre(' faux positif') : gris(' à juger');
        console.log(`  ${String(e.n).padStart(3)} × ${gras(w.padEnd(22))}${v}`);
        console.log(gris(`        ${e.phrase}`));
      }
      if (rangs.length > 40) console.log(gris(`  … et ${rangs.length - 40} autre(s).`));
    }

    // Ce que la règle des noms propres (GP-1) a RÉELLEMENT fait sur ce corpus :
    // ce qu'elle a tu, et ce que le garde « mêmes lettres » a retenu. C'est la
    // vérification du critère de fin (« faux positifs nom propre à 0 »).
    titre('Effet de la règle des noms propres (GP-1)');
    {
      // On interroge la VRAIE fonction, alerte par alerte : c'est la seule façon
      // d'attribuer une perte à GP-1 plutôt qu'à un filtre voisin (skipWithDigits
      // masque « Km2 » — ce n'est pas l'affaire de GP-1).
      const estNom = i => moteur.isProperNounSpelling(i.word, i._p.canonique, i.offset, i.suggestions);
      const sansGarde = i => moteur.isProperNounSpelling(i.word, i._p.canonique, i.offset, []);
      const ortho = toutesBrutes.filter(i => i.type === 'spelling');
      const tus = ortho.filter(estNom);
      const capRetenues = ortho.filter(i => !estNom(i) && /^[A-ZÀ-ÖØ-Þ]/.test(i.word || '') && i.word !== i.word.toUpperCase());

      console.log(`  ${vert('tues par la règle')}  ${tus.length} alerte(s) sur ${ortho.length} d'orthographe`);
      console.log(`  ${ambre('retenues')}           ${capRetenues.length} majuscule(s), pour la raison suivante :`);
      const parRaison = new Map();
      for (const i of capRetenues) {
        const r = sansGarde(i) ? 'garde « mêmes lettres »' : 'majuscule grammaticale (début de phrase ou citation)';
        if (!parRaison.has(r)) parRaison.set(r, []);
        const v = verdictDe(i._f, cle(i));
        parRaison.get(r).push(i.word + (v ? gris(' (' + (v === 'vraie' ? 'vraie faute' : 'faux positif') + ')') : ''));
      }
      for (const [r, l] of parRaison) console.log(gris(`        ${r} : `) + l.join(', '));

      if (verite) {
        const perdues = tus.filter(i => verdictDe(i._f, cle(i)) === 'vraie');
        check('GP-1 : la règle des noms propres n\'a fait perdre AUCUNE vraie faute',
          perdues.length === 0, perdues.map(i => `${i._f} « ${i.word} »`).join(' | '));
      }
      const gBrutes = toutesBrutes.filter(i => i.type === 'grammar').length;
      const gVues   = toutesVues.filter(i => i.type === 'grammar').length;
      check('GP-1 : aucune alerte de GRAMMAIRE n\'a disparu (critère de fin)',
        gBrutes === gVues, `${gBrutes} brutes contre ${gVues} affichées`);
    }

    /* ── Le tableau de bord du §6 ───────────────────────────────── */

    titre('Tableau de bord — colonne « Départ » du §6 de GHOSTWRITER_PROOF_SPRINTS.md');
    const brutes    = toutesBrutes.length;
    const affichees = toutesVues.length;
    let fp = 0, njugees = 0, masquees = [], ratees = 0;
    if (verite) {
      for (const it of toutesVues) {
        const v = verdictDe(it._f, cle(it));
        if (v === 'faux-positif') fp++; else if (v !== 'vraie') njugees++;
      }
      for (const it of toutesBrutes) {
        if (verdictDe(it._f, cle(it)) === 'vraie' && !it._p.vues.has(cle(it))) masquees.push(it);
      }
      for (const p of parTexte) {
        const bloc = verite.textes && verite.textes[p.nom];
        if (!bloc) { console.log(`  ${ambre('⚠')} ${p.nom} : absent de verite.json`); continue; }
        if (bloc.empreinte && bloc.empreinte !== p.empreinte) {
          console.log(`  ${ambre('⚠')} ${p.nom} : le texte a CHANGÉ depuis les verdicts ` +
            gris(`(${bloc.empreinte} ≠ ${p.empreinte}) — les positions ont pu se décaler.`));
        }
        ratees += (bloc.manques || []).filter(m => m && m.extrait && !/^\(/.test(m.extrait)).length;
      }
    }
    const val = v => (verite ? String(v) : gris('— (verdicts manquants)'));
    console.log(`  | Alertes brutes                  | ${brutes} |`);
    console.log(`  | Alertes affichées               | ${affichees} |`);
    console.log(`  | dont faux positifs              | ${val(fp)} |`);
    console.log(`  | Fautes réelles ratées           | ${val(ratees)} |`);
    console.log(`  | Fautes réelles masquées à tort  | ${val(masquees.length)} |`);
    if (verite && njugees) console.log(gris(`  (${njugees} alerte(s) affichée(s) encore sans verdict — le chiffre des faux positifs est un PLANCHER.)`));

    if (verite) {
      // §4.3 — le seul vrai danger du dispositif. Il vaut dès aujourd'hui :
      // un pré-filtre actuel peut déjà avaler une vraie faute.
      check('aucune faute réelle masquée par les filtres (critère §4.3)',
        masquees.length === 0,
        masquees.slice(0, 5).map(i => `${i._f} « ${i.word || ''} » @${cle(i)}`).join(' | '));
    }

    /* ── Le rapport, pour comparer d'une mesure à l'autre ───────── */
    rapport = {
      date: new Date().toISOString(),
      corpus: basename(CORPUS),
      textes: parTexte.map(p => ({
        nom: p.nom, signes: p.canonique.length, empreinte: p.empreinte,
        brutes: p.brutes.length, affichees: p.affichees.length,
      })),
      tableau: {
        brutes, affichees,
        fauxPositifs: verite ? fp : null,
        ratees: verite ? ratees : null,
        masqueesATort: verite ? masquees.length : null,
        nonJugees: verite ? njugees : null,
      },
    };
    fs.writeFileSync(join(CORPUS, '_rapport.json'), JSON.stringify(rapport, null, 2), 'utf8');
    console.log(gris(`\n  rapport écrit : ${join(CORPUS, '_rapport.json').replace(ROOT + '/', '')}` +
      ' (dossier ignoré par git — à comparer après GP-1 et GP-3)'));
  }

  titre('Hygiène');
  {
    const graves = erreursPage.filter(e => !/favicon|ERR_/.test(e));
    check('aucune erreur JavaScript pendant la mesure', graves.length === 0, graves.slice(0, 3).join(' | '));
  }

} finally {
  await nav.close();
  srv.close();
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} vérifications — ${vert(passed + ' ok')}, ${failed ? rouge(failed + ' ko') : '0 ko'}`);
if (failed) console.error('\nÉchecs :\n  - ' + echecs.join('\n  - '));
if (!textes || !textes.length) {
  console.log(gris('Corpus absent : A et B ont tourné, C attend les textes (voir ci-dessus).'));
  if (STRICT && !failed) process.exit(1);
}
process.exit(failed ? 1 : 0);
