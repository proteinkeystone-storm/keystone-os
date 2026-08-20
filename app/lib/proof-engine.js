/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — proof-engine.js
   LE MOTEUR de correction. Interface STABLE & swappable :

       analyze(text)  → { text, issues:[ Issue ] }
       suggest(word)  → [string]
       fuseIssues(a,b)→ [Issue]            (dédup grammalecte + IA)
       canonicalizeText(text) → string

   Issue = {
     offset, len,                          position dans le texte CANONIQUE
     type: 'spelling' | 'grammar',
     severity: 'error' | 'warning',
     message, suggestions:[string],
     source: 'grammalecte' | 'ai',
     ruleId?, word?, url?
   }

   Rôle : piloter le Web Worker Grammalecte (détection déterministe,
   100 % navigateur, hors-ligne, gratuit) et — Phase 4 — fusionner une
   passe IA optionnelle. Réutilisable par Ghost Writer (texte + PDF) ET
   par un futur outil : on peut remplacer Grammalecte par LanguageTool /
   Harper plus tard SANS toucher les consommateurs (on ne change que
   l'intérieur de ce module + son worker).

   ⚠️ La détection NE QUITTE JAMAIS le navigateur (Grammalecte tourne en
   local). Seule la passe IA (Phase 4, à la demande) envoie du texte
   dehors. cf. BRIEF_GHOST_WRITER_V2.md §2-3.
   ═══════════════════════════════════════════════════════════════ */

import { DICO_BASE } from './proof-dico-base.js';

const WORKER_URL = '/app/lib/proof-grammalecte.worker.js';

// La couche de BASE du dictionnaire (GP-2) : un vocabulaire générique livré
// avec l'outil — grades, civilités, renvois. Tout le monde en profite, personne
// ne partage rien. Le dictionnaire de la MAISON (couche 2, par licence) vient
// par-dessus, via setProofFilters({ ignoreWords }).
const _DICO_BASE_SET = new Set(DICO_BASE);
// Exposée pour que l'écran puisse dire à l'utilisateur ce qu'il reçoit sans
// l'avoir appris — sans lui faire lire une liste de 50 abréviations.
export const DICO_BASE_TAILLE = DICO_BASE.length;

let _worker   = null;
let _seq      = 0;
let _readyP   = null;            // Promise résolue au handshake __ready__
const _pending = new Map();      // id → { resolve, reject }

// ── Cycle de vie du worker ──────────────────────────────────────
function _ensureWorker() {
  if (_worker) return _worker;
  _worker = new Worker(WORKER_URL);           // classique (importScripts) ; CSP worker-src 'self'
  _readyP = new Promise((resolve) => { _worker.__resolveReady = resolve; });

  _worker.onmessage = (e) => {
    const d = e.data || {};
    if (d.id === '__ready__') { _worker.__resolveReady && _worker.__resolveReady(true); return; }
    const p = _pending.get(d.id);
    if (!p) return;
    _pending.delete(d.id);
    if (d.ok) resolveOk(p, d);
    else p.reject(new Error(d.error || 'Erreur du correcteur'));
  };
  _worker.onerror = (ev) => {
    const msg = 'Le moteur de correction a planté' + (ev && ev.message ? ' : ' + ev.message : '');
    for (const [, p] of _pending) p.reject(new Error(msg));
    _pending.clear();
    // worker mort → on le recrée au prochain appel
    try { _worker.terminate(); } catch (_) {}
    _worker = null; _readyP = null;
  };
  return _worker;
}

function resolveOk(p, d) {
  if (d.issues !== undefined) p.resolve(d.issues);
  else if (d.suggestions !== undefined) p.resolve(d.suggestions);
  else p.resolve(d);
}

function _call(cmd, payload) {
  const w = _ensureWorker();
  const id = ++_seq;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    try { w.postMessage(Object.assign({ id, cmd }, payload)); }
    catch (err) { _pending.delete(id); reject(err); }
  });
}

// ── Normalisation canonique (fidélité des offsets) ──────────────
// Doit être appliquée UNE fois côté main, et le texte canonique sert à
// la fois à l'affichage (surlignage) et aux offsets renvoyés par le
// worker — sinon dérive de position. cf. brief §7.
//   • CRLF/CR → LF (Grammalecte ne normalise que le 1er sinon)
//   • retire les traits d'union conditionnels U+00AD (invisibles)
//   • NFC (le worker Grammalecte applique NFC → on s'aligne en amont)
export function canonicalizeText(text) {
  let s = (text == null) ? '' : String(text);
  s = s.replace(/\r\n?/g, '\n').replace(/­/g, '');
  try { s = s.normalize('NFC'); } catch (_) {}
  return s;
}

// ── Filtres anti-bruit (faux positifs) — ORTHOGRAPHE uniquement ──
// Sur les documents bourrés de jargon (sigles, noms propres, références),
// l'essentiel des alertes d'ORTHOGRAPHE sont des mots inconnus légitimes,
// pas des fautes. On filtre ces tokens AVANT de les remonter à l'UI. La
// grammaire, les accords et la conjugaison (la vraie valeur) ne sont
// JAMAIS filtrés. cf. BRIEF_GHOST_WRITER_V2.1 §1. Réglable via setProofFilters().
const _filters = {
  ignore: new Set(),     // dico perso (mots en minuscules) — « toujours ignorer »
  skipAllCaps: true,     // sigles TOUT-EN-CAPITALES : MINARM, IHEDN, GMHM…
  // ⚠ DÉFAUT À false depuis le 2026-08-20 (GP-1), et c'est une MESURE, pas un
  // avis. Sonde sur le vrai moteur : les références que ce filtre prétendait
  // écarter (A400M, VT4, Rafale F3, P4, 1er) ne sont JAMAIS signalées par
  // Grammalecte — elles sont en capitales, il les ignore lui-même. Ce que le
  // filtre écartait en pratique, ce sont des mots COLLÉS à un nombre (Km2,
  // page42, covid19, Airbus350), c'est-à-dire de vraies fautes de typographie,
  // avec la bonne correction en face. Il masquait donc des fautes sans rien
  // protéger. Reste à true pour la relecture de PDF (cf. proof-pdf.js) : là, le
  // collage vient de l'extraction, pas de l'auteur.
  skipWithDigits: false, // mots collés à un nombre : Km2 → « Km ² », page42 → « page 42 »
  skipUrlEmail: true,    // fragments d'URL / email
  // Fragments trop courts pour être un mot (bruit d'extraction PDF : « th »,
  // « rn »…). On compte les lettres ET les chiffres : « Km2 » fait trois
  // signes, ce n'est pas un fragment — ne compter que les lettres le faisait
  // taire alors que c'est « km² » mal écrit (mesuré le 2026-08-20).
  minLetters: 3,         // longueur minimale d'un token signalable
  skipProperNouns: true, // GP-1 : majuscule hors début de phrase = nom propre
  grammarDenylist: null, // null = GRAMMAR_DENYLIST_TEXTE ; proof-pdf passe la liste PDF
  useBaseDico: true,     // GP-2 couche 1 : le vocabulaire livré avec l'outil
};

// Configure les filtres d'orthographe. Appelé par le consommateur (ex. l'UI
// qui détient le dico perso persistant en localStorage). Fusionne : les clés
// non fournies sont conservées. Ce module est un singleton ES → proof-pdf et
// l'UI partagent la même config.
export function setProofFilters(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  if (cfg.ignoreWords != null) {
    const list = Array.isArray(cfg.ignoreWords) ? cfg.ignoreWords : Array.from(cfg.ignoreWords);
    _filters.ignore = new Set(list.map((w) => String(w).toLowerCase()));
  }
  for (const k of ['skipAllCaps', 'skipWithDigits', 'skipUrlEmail', 'skipProperNouns', 'useBaseDico']) {
    if (typeof cfg[k] === 'boolean') _filters[k] = cfg[k];
  }
  if (Number.isFinite(cfg.minLetters)) _filters.minLetters = cfg.minLetters;
  if (cfg.grammarDenylist === null || Array.isArray(cfg.grammarDenylist)) _filters.grammarDenylist = cfg.grammarDenylist;
}

export function getProofFilters() {
  return {
    ignoreWords: Array.from(_filters.ignore),
    skipAllCaps: _filters.skipAllCaps,
    skipWithDigits: _filters.skipWithDigits,
    skipUrlEmail: _filters.skipUrlEmail,
    minLetters: _filters.minLetters,
    skipProperNouns: _filters.skipProperNouns,
    grammarDenylist: _filters.grammarDenylist,
    useBaseDico: _filters.useBaseDico,
  };
}

const _RE_DIGIT  = /[0-9]/;
const _RE_URLISH = /[@/]|^www\.|\.[a-zà-ÿ]{2,}$|https?:/i;
const _RE_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/;
function _inIgnore(set, wl) {
  if (!set) return false;
  if (typeof set.has === 'function') return set.has(wl);
  if (Array.isArray(set)) return set.indexOf(wl) >= 0;
  return false;
}

// Prédicat PUR (testable hors navigateur) : ce mot d'orthographe est-il du
// BRUIT à masquer ? true = bruit (dico perso / trop court / chiffres / URL /
// sigle TOUT-CAPS). N'évalue JAMAIS la grammaire.
export function isNoiseSpelling(word, filters) {
  const f = filters || _filters;
  const w = String(word == null ? '' : word).trim();
  if (!w) return false;                                   // pas de mot → ne pas masquer à l'aveugle
  const wl = w.toLowerCase();
  if (_inIgnore(f.ignore, wl)) return true;              // dico de la MAISON
  if (f.useBaseDico !== false && _DICO_BASE_SET.has(wl)) return true;   // dico de BASE
  const signes = (w.match(_RE_SIGNE_G) || []).length;
  if ((f.minLetters || 0) > 0 && signes < f.minLetters) return true;
  if (f.skipWithDigits && _RE_DIGIT.test(w)) return true;
  if (f.skipUrlEmail && _RE_URLISH.test(w)) return true;
  if (f.skipAllCaps && _RE_LETTER.test(w) && w === w.toUpperCase() && w !== w.toLowerCase()) return true;
  return false;
}
const _RE_SIGNE_G  = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]/g;   // lettres ET chiffres (cf. minLetters)

// ── GP-1 · L'impasse sur les noms propres ────────────────────────
// Grammalecte n'a PAS les noms propres dans son dictionnaire : sur un texte de
// presse, patronymes, toponymes et noms d'unités constituent l'essentiel des
// alertes d'orthographe restantes. Mesure du 2026-08-20 (3 articles réels de
// L'Épaulette) : 63 faux positifs affichés pour 13 vraies fautes.
//
// La règle : un mot inconnu qui commence par une MAJUSCULE et qui n'est PAS en
// position où une majuscule est grammaticale est un nom propre — on se tait.
// Positions où la majuscule est ATTENDUE (donc on continue de vérifier) :
// début du texte, début de ligne, après . ? ! … : ; après un guillemet ouvrant,
// après un tiret de dialogue.
const _RE_BLANC_AVANT  = /[\s'’(\[]/;             // traversés (\s couvre l'insécable)
const _RE_OUVRE_PHRASE = /[.?!…:;\n—–«"-]/;       // la majuscule qui suit est normale
const _RE_COMPOSE_MAJ  = /-[A-ZÀ-ÖØ-Þ]/;          // « El-Bakri », « Roche-Ferrand » : nom composé

// Les lettres d'un mot, accents ôtés et remises en ordre. Sert au GARDE
// ci-dessous : deux mots qui ont les mêmes lettres ne sont pas deux noms
// différents, c'est une coquille (Lybie/Libye) ou un accent oublié
// (Egypte/Égypte). Sans ce garde, la règle masquerait 6 vraies fautes du corpus.
function _lettresTriees(s) {
  let t = String(s == null ? '' : s).toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  return t.split('').sort().join('');
}

// Un point précédé d'UNE SEULE lettre majuscule isolée est une initiale, pas la
// fin d'une phrase. Sans ça, « le président déchu B. El-Bakri » fait passer
// « El-Bakri » pour un début de phrase et l'alerte reste.
function _estInitiale(text, iPoint) {
  const c = text.charAt(iPoint - 1);
  if (!c || !_RE_LETTER.test(c) || c !== c.toUpperCase() || c === c.toLowerCase()) return false;
  const avant = text.charAt(iPoint - 2);
  return avant === '' || /[\s'’(\[«"]/.test(avant);   // la lettre est bien isolée
}

// Prédicat PUR (testable hors navigateur) : ce mot signalé est-il un NOM PROPRE
// qu'il faut taire ? Reçoit le mot, le texte canonique, la position du mot, et
// les suggestions de Grammalecte (pour le garde). Sans texte ni position, rend
// false : on ne masque JAMAIS sans contexte.
export function isProperNounSpelling(word, text, offset, suggestions) {
  const w = String(word == null ? '' : word);
  if (!w) return false;
  if (w === w.toUpperCase()) return false;                       // sigle : affaire de skipAllCaps
  const c0 = w.charAt(0);
  const majInitiale = _RE_LETTER.test(c0) && c0 === c0.toUpperCase() && c0 !== c0.toLowerCase();
  if (!majInitiale && !_RE_COMPOSE_MAJ.test(w)) return false;    // ni majuscule, ni nom composé
  if (_RE_DIGIT.test(w)) return false;                           // « Km2 », « A400M » : une référence,
                                                                 // pas un nom — affaire de skipWithDigits

  // 0 · NOM COMPOSÉ : un segment après trait d'union porte une majuscule
  // (« El-Bakri », « al-Mansouri », « Roche-Ferrand »). Ces mots-là sont des noms
  // OÙ QU'ILS TOMBENT — la position ne dit rien d'eux, et ils échouent souvent
  // au test de la majuscule initiale (« al- » commence en minuscule). Un
  // composé commun garde ses segments en minuscules (« socio-économiques ») : il
  // n'est pas concerné, et reste vérifié.
  const compose = _RE_COMPOSE_MAJ.test(w);

  if (!compose) {
    if (typeof text !== 'string' || !Number.isFinite(offset)) return false;

    // 1 · la majuscule est-elle grammaticale à cet endroit ?
    let i = offset - 1;
    while (i >= 0 && _RE_BLANC_AVANT.test(text.charAt(i))) i--;
    if (i < 0) return false;                                     // début du texte
    if (_RE_OUVRE_PHRASE.test(text.charAt(i))) {
      // …sauf si ce point clôt une INITIALE (« B. El-Bakri », « J. Dupont ») :
      // ce n'est pas une fin de phrase, et le mot qui suit est bien un patronyme.
      if (text.charAt(i) !== '.' || !_estInitiale(text, i)) return false;
    }
  }

  // 2 · le garde : mêmes lettres qu'une suggestion → coquille, pas un nom.
  if (Array.isArray(suggestions) && suggestions.length) {
    const base = _lettresTriees(w);
    for (let k = 0; k < suggestions.length; k++) {
      const sg = suggestions[k];
      if (sg && sg !== w && _lettresTriees(sg) === base) return false;
    }
  }
  return true;
}

// ── GP-2 · ce qui a le droit d'entrer dans le dictionnaire ───────
// Mêmes règles que le serveur (workers/src/routes/proof-dico.js), qui valide
// de son côté — un client ne dicte jamais ce qui entre en base. Ici, c'est
// pour pouvoir DIRE à l'utilisateur ce qui a été écarté d'un fichier importé,
// au lieu de le laisser disparaître en silence.
// Rend le mot normalisé (minuscules, sans espaces autour), ou null.
const _RE_MOT_DICO = /^[a-zà-öø-ÿ]([a-zà-öø-ÿ'’-]*[a-zà-öø-ÿ])?$/;
export function normalizeDicoWord(mot) {
  const w = String(mot == null ? '' : mot).trim().toLowerCase();
  if (w.length < 3 || w.length > 60) return null;   // sous 3 signes, minLetters l'écarte déjà
  return _RE_MOT_DICO.test(w) ? w : null;
}

// ── GP-5 · ce que le juge IA a le DROIT de regarder ──────────────
// Mesuré le 2026-08-20 sur le corpus, avec de vrais appels : soumis à tout,
// le modèle efface 10 faux positifs — mais aussi 6 VRAIES fautes, toutes de
// la même famille (« Lybie », « Egypte », « Ethiopie », « Emiratis », « Km2 »).
// Il y voit des noms propres et ne remarque pas la coquille.
//
// Or cette famille-là, une règle LOCALE la traite déjà mieux que lui (le garde
// « mêmes lettres » de GP-1). On ne la lui soumet donc pas. C'est la
// restriction prévue au brief §5/GP-5 : « restreindre les catégories que l'IA
// a le droit de toucher ». Le déterministe garde la main là où il est bon ;
// le modèle ne sert que là où aucune règle ne sait trancher.
export function isArbitrable(issue) {
  if (!issue || issue.type !== 'spelling') return false;   // les accords lui sont interdits
  const w = String((issue && issue.word) || '');
  if (!w) return false;
  if (_RE_DIGIT.test(w)) return false;          // « Km2 » : une référence, pas un nom
  // Quasi-homographe d'une suggestion = coquille déterministe. La règle locale
  // tranche mieux, et elle ne coûte rien.
  if (Array.isArray(issue.suggestions)) {
    const base = _lettresTriees(w);
    for (let i = 0; i < issue.suggestions.length; i++) {
      const sg = issue.suggestions[i];
      if (sg && sg !== w && _lettresTriees(sg) === base) return false;
    }
  }
  return true;
}

// ── Règles de grammaire DÉSACTIVÉES (denylist par préfixe d'identifiant) ──
// Chaque entrée est JUSTIFIÉE PAR UNE MESURE (GP-3, 2026-08-20) : la règle a
// été passée à une batterie de phrases correctes ET fautives de sa forme, dans
// un vrai navigateur. On ne coupe une règle que si elle se trompe sur du texte
// correct SANS attraper de vraie faute. « Une règle qui attrape ne serait-ce
// qu'une vraie faute ne doit pas être désactivée » (brief §GP-3).
export const GRAMMAR_DENYLIST_TEXTE = [
  // « Si "car"/"mais" est la conjonction de coordination, une virgule… » — la
  // règle le dit elle-même au conditionnel, et la virgule y est facultative :
  // 3 faux positifs sur 10 phrases correctes. Aucune vraie faute perdue.
  'g0__virg_virgules_manquantes',
  // « Conjugaison probablement erronée si nous… » et « Si X est le sujet de… » :
  // deux règles au conditionnel, jamais déclenchées sur les batteries ni sur le
  // corpus — rien à gagner à les rallumer, l'audit du 2026-06-06 les incrimine.
  'gv1__conj_nous2',
  'gv2__conj_det_nom_sing_virgule',
];

// La relecture de PDF coupe DEUX RÈGLES DE PLUS. Mesure du 2026-08-20 : sur du
// texte reconstruit depuis un PDF, une ligne coupée par la maquette commence
// souvent par un verbe (« Suit la phase… », « comprend trois échelons »), et
// les règles d'impératif s'y déclenchent 4 fois sur 10 — c'est précisément ce
// que l'audit du 2026-06-06 (livre MICE) avait constaté. Sur du texte SAISI,
// les mêmes règles ne se trompent jamais (0 sur 14) et attrapent de vraies
// fautes (« Prend garde » → « Prends », « Finit ton rapport » → « Finis »).
export const GRAMMAR_DENYLIST_PDF = GRAMMAR_DENYLIST_TEXTE.concat([
  'gv1__imp_verbe_groupe3',
  'gv1__imp_verbe_groupe2_groupe3',
]);

// RENDUES au correcteur le 2026-08-20 : `g2__conf_ça_çà_sa` attrape deux vraies
// confusions (« Sa ne se fait pas » → « Ça », « ça veste » → « sa ») sans se
// tromper une seule fois sur 17 phrases correctes, textes et PDF confondus.

function _isDenylistedGrammar(it, liste) {
  if (!it || it.type !== 'grammar') return false;
  const l = Array.isArray(liste) ? liste : GRAMMAR_DENYLIST_TEXTE;
  const r = it.ruleId || '';
  for (let i = 0; i < l.length; i++) if (r.indexOf(l[i]) === 0) return true;
  return false;
}

// Applique les filtres : bruit d'ORTHOGRAPHE (dico perso, sigles…) + règles de
// GRAMMAIRE désactivées (denylist). Une issue d'ortho sans `word` est conservée
// (on ne masque pas à l'aveugle).
// `text` = le texte CANONIQUE d'où viennent les offsets. analyze() l'a sous la
// main et le fait descendre ; les filtres qui ont besoin de la POSITION du mot
// (GP-1) se branchent donc ici, et les deux consommateurs (UI + proof-pdf) en
// profitent sans être modifiés. Omis → le filtre de position ne s'applique pas
// (on ne masque pas sans contexte).
export function filterIssues(issues, filters, text) {
  if (!Array.isArray(issues)) return [];
  // `filters` est une SURCHARGE PARTIELLE de la config du module : un
  // consommateur (proof-pdf) n'énonce que ce qui diffère, et garde le dico
  // perso et les autres réglages sans avoir à les recopier.
  const f = filters ? Object.assign({}, _filters, filters) : _filters;
  return issues.filter((it) => {
    if (!it) return false;
    if (it.type === 'grammar') return !_isDenylistedGrammar(it, f.grammarDenylist);
    if (it.type !== 'spelling' || !it.word) return true;
    if (isNoiseSpelling(it.word, f)) return false;
    if (f.skipProperNouns && isProperNounSpelling(it.word, text, it.offset, it.suggestions)) return false;
    return true;
  });
}

// ── Options de règles Grammalecte (familles TYPOGRAPHIQUES) ──────
// La grammaire/les accords/la conjugaison de fond restent TOUJOURS actifs.
// Ces options ne pilotent QUE la typographie (apostrophes, majuscules,
// tirets/guillemets, espaces, nombres) — massivement du bruit sur un PDF déjà
// mis en page. cf. BRIEF_GHOST_WRITER_V2.1 §1 (item 4). Défaut = tout coupé.
// Le consommateur (UI) passe le détail via setProofOptions ; envoyé au worker
// à chaque analyse (setOptions ne change que les clés fournies).
let _options = { apos:false, maj:false, minis:false, typo:false, esp:false, nbsp:false, tab:false, num:false, exposant:false };
export function setProofOptions(obj) {
  _options = (obj && typeof obj === 'object') ? Object.assign({}, obj) : {};
}
export function getProofOptions() { return Object.assign({}, _options); }

// ── Pré-chauffe (optionnel) : démarre le worker + init dicos ────
// À appeler quand l'utilisateur entre dans le correcteur, pour que la
// 1re analyse soit instantanée (sinon ~1 s de chargement dico au 1er run).
export function warmUp() {
  _ensureWorker();
  return _readyP.then(() => _call('init', {})).catch(() => {});
}

// ── API principale ──────────────────────────────────────────────
// Renvoie le texte canonique (à afficher) + les issues triées par offset.
export async function analyze(text, opts = {}) {
  const canonical = canonicalizeText(text);
  if (!canonical.trim()) return { text: canonical, issues: [] };
  _ensureWorker();
  await _readyP;
  let issues = await _call('analyze', { text: canonical, options: opts.options || _options });
  if (!Array.isArray(issues)) issues = [];
  // Filtrage anti-bruit (faux positifs d'orthographe). opts.noFilter → brut,
  // opts.filters → config ad hoc (sinon config module via setProofFilters).
  if (opts.noFilter !== true) issues = filterIssues(issues, opts.filters, canonical);
  return { text: canonical, issues };
}

// Suggestions orthographiques à la demande (pour un mot précis).
export async function suggest(word) {
  if (!word) return [];
  _ensureWorker();
  await _readyP;
  const s = await _call('suggest', { word: String(word) });
  return Array.isArray(s) ? s : [];
}

// ── Fusion Grammalecte + IA (Phase 4) ───────────────────────────
// Dédoublonne les spans qui se recouvrent ; en cas de chevauchement on
// garde la source la plus fiable (grammalecte = déterministe) et on
// agrège les suggestions. Exposé tôt pour que proof-pdf/UI s'en servent.
export function fuseIssues(primary, secondary) {
  const a = Array.isArray(primary) ? primary.slice() : [];
  const b = Array.isArray(secondary) ? secondary : [];
  const out = a.slice();
  for (const s of b) {
    const overlap = out.find((x) => _overlaps(x, s));
    if (!overlap) { out.push(s); continue; }
    // chevauchement : grammalecte prioritaire ; on enrichit les suggestions
    const keep = (overlap.source === 'grammalecte') ? overlap : s;
    const drop = (keep === overlap) ? s : overlap;
    const merged = new Set([...(keep.suggestions || []), ...(drop.suggestions || [])]);
    keep.suggestions = [...merged];
    if (keep === s) { // on remplace overlap par s dans out
      const i = out.indexOf(overlap);
      if (i >= 0) out[i] = s;
    }
  }
  out.sort((x, y) => (x.offset - y.offset) || (x.len - y.len));
  return out;
}

function _overlaps(x, y) {
  const xe = x.offset + x.len, ye = y.offset + y.len;
  return x.offset < ye && y.offset < xe;
}

// ── Arrêt (libère la mémoire du dico ~9 Mo) ─────────────────────
export function terminateProofEngine() {
  if (_worker) { try { _worker.terminate(); } catch (_) {} }
  _worker = null; _readyP = null; _pending.clear();
}
