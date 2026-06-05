/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — proof-grammalecte.worker.js
   Web Worker ISOLÉ qui pilote le moteur Grammalecte (correction FR).

   ⚠️ CONFORMITÉ GPL v3 (à respecter scrupuleusement) :
   ─────────────────────────────────────────────────────────────
   Grammalecte est sous GPL v3. Keystone reste propriétaire+conforme
   par SÉPARATION, pas par dissimulation :
     • Les fichiers de /app/vendor/grammalecte/ sont la copie EXACTE,
       NON MODIFIÉE, du build officiel (make.py fr -js -d, v2.3.0).
     • Ce worker se contente de les charger via importScripts() et de
       dialoguer par postMessage (texte → erreurs+offsets). Aucune
       ligne de notre code ne fusionne avec le leur → Keystone n'est
       PAS une œuvre dérivée.
     • LICENSE conservée dans /app/vendor/grammalecte/LICENSE + crédit
       « Correction propulsée par Grammalecte (GPL v3) » visible dans
       l'UI du correcteur (point d'usage) + lien source grammalecte.net.
   NE PAS modifier les fichiers vendor ; NE PAS les imbriquer dans le
   bundle applicatif. Les garder en vendor séparé.

   Recette de chargement prouvée en Phase 0 (spike 2026-06-05) :
   ordre des importScripts = celui de gce_worker.js officiel MOINS
   thesaurus.js & tests.js (inutiles à la correction → −7,4 Mo).

   Protocole :
     main → worker : { id, cmd:'analyze', text }   (texte DÉJÀ canonique)
                     { id, cmd:'suggest', word }
     worker → main : { id, ok:true, issues:[…] | suggestions:[…] }
                     { id, ok:false, error:'…' }
                     { id:'__ready__', ready:true }   (handshake init OK)

   Issue normalisée (interface stable consommée par proof-engine) :
     { offset, len, type:'spelling'|'grammar', severity:'error'|'warning',
       message, suggestions:[string], source:'grammalecte', ruleId?, word? }
   ═══════════════════════════════════════════════════════════════ */
"use strict";

const VENDOR = '/app/vendor/grammalecte/grammalecte';

// — Chargement du moteur Grammalecte NON MODIFIÉ (scope global du worker) —
importScripts(
  VENDOR + '/graphspell/helpers.js',
  VENDOR + '/graphspell/str_transform.js',
  VENDOR + '/graphspell/char_player.js',
  VENDOR + '/graphspell/lexgraph_fr.js',
  VENDOR + '/graphspell/ibdawg.js',
  VENDOR + '/graphspell/spellchecker.js',
  VENDOR + '/text.js',
  VENDOR + '/graphspell/tokenizer.js',
  VENDOR + '/fr/conj.js',
  VENDOR + '/fr/mfsp.js',
  VENDOR + '/fr/phonet.js',
  VENDOR + '/fr/cregex.js',
  VENDOR + '/fr/gc_options.js',
  VENDOR + '/fr/gc_functions.js',
  VENDOR + '/fr/gc_rules.js',
  VENDOR + '/fr/gc_rules_graph.js',
  VENDOR + '/fr/gc_engine.js',
);

let _ready = false;
let _initError = null;

// Init paresseuse : charge dictionnaires + données morpho au 1er usage.
// (helpers.loadFile = XHR synchrone dans le worker — OK hors thread principal.)
function _init() {
  if (_ready) return true;
  if (_initError) throw _initError;
  try {
    // eslint-disable-next-line no-undef
    conj.init(helpers.loadFile(VENDOR + '/fr/conj_data.json'));
    // eslint-disable-next-line no-undef
    phonet.init(helpers.loadFile(VENDOR + '/fr/phonet_data.json'));
    // eslint-disable-next-line no-undef
    mfsp.init(helpers.loadFile(VENDOR + '/fr/mfsp_data.json'));
    // gc_engine.load(contexte, typeCouleur, cheminDictionnaires)
    // eslint-disable-next-line no-undef
    gc_engine.load('JavaScript', 'aRGB', VENDOR + '/graphspell/_dictionaries');
    _ready = true;
    return true;
  } catch (e) {
    _initError = e;
    throw e;
  }
}

// Suggestions orthographiques à la demande (générateur Grammalecte par
// paliers de distance d'édition). On prend les 2 premiers paliers, dédup, cap.
function _suggest(word, cap) {
  cap = cap || 6;
  try {
    // eslint-disable-next-line no-undef
    const sc = gc_engine.getSpellChecker();
    const gen = sc.suggest(word);
    const out = [];
    for (let i = 0; i < 2; i++) {
      const r = gen.next();
      if (r.done) break;
      if (Array.isArray(r.value)) out.push.apply(out, r.value);
    }
    const seen = new Set();
    const uniq = [];
    for (const s of out) { if (s && !seen.has(s)) { seen.add(s); uniq.push(s); } }
    return uniq.slice(0, cap);
  } catch (_) {
    return [];
  }
}

// Analyse un texte CANONIQUE (déjà normalisé côté main : \n, NFC, sans U+00AD).
// On découpe par '\n' nous-mêmes en suivant l'offset de base de chaque
// paragraphe → offsets renvoyés relatifs au texte canonique complet.
function _analyze(text) {
  _init();
  // eslint-disable-next-line no-undef
  const sc = gc_engine.getSpellChecker();
  const issues = [];
  const paras = String(text).split('\n');
  let base = 0;
  for (let p = 0; p < paras.length; p++) {
    const para = paras[p];
    if (para.trim() !== '') {
      // — Grammaire —
      let gErr = [];
      // eslint-disable-next-line no-undef
      try { gErr = gc_engine.parse(para, 'FR', false) || []; } catch (_) { gErr = []; }
      for (let i = 0; i < gErr.length; i++) {
        const e = gErr[i];
        issues.push({
          offset: base + e.nStart,
          len: Math.max(0, e.nEnd - e.nStart),
          type: 'grammar',
          severity: 'warning',
          message: e.sMessage || '',
          suggestions: Array.isArray(e.aSuggestions) ? e.aSuggestions.filter(Boolean) : [],
          ruleId: e.sRuleId || e.sType || '',
          url: e.URL || '',
          source: 'grammalecte',
        });
      }
      // — Orthographe —
      let sErr = [];
      try { sErr = sc.parseParagraph(para) || []; } catch (_) { sErr = []; }
      for (let j = 0; j < sErr.length; j++) {
        const e = sErr[j];
        const word = e.sValue || para.slice(e.nStart, e.nEnd);
        issues.push({
          offset: base + e.nStart,
          len: Math.max(0, e.nEnd - e.nStart),
          type: 'spelling',
          severity: 'error',
          message: 'Mot inconnu du dictionnaire : « ' + word + ' »',
          suggestions: _suggest(word),
          word: word,
          source: 'grammalecte',
        });
      }
    }
    base += para.length + 1; // +1 pour le '\n' retiré par split
  }
  // Tri par position (puis longueur) pour un rendu déterministe.
  issues.sort(function (a, b) { return (a.offset - b.offset) || (a.len - b.len); });
  return issues;
}

onmessage = function (e) {
  const data = e.data || {};
  const id = data.id;
  const cmd = data.cmd;
  try {
    if (cmd === 'init') {
      _init();
      postMessage({ id: id, ok: true, ready: true });
    } else if (cmd === 'analyze') {
      const issues = _analyze(data.text || '');
      postMessage({ id: id, ok: true, issues: issues });
    } else if (cmd === 'suggest') {
      _init();
      postMessage({ id: id, ok: true, suggestions: _suggest(data.word || '', data.cap) });
    } else {
      postMessage({ id: id, ok: false, error: 'commande inconnue: ' + cmd });
    }
  } catch (err) {
    postMessage({ id: id, ok: false, error: String((err && err.message) || err) });
  }
};

// Handshake : signale que le worker est chargé (les importScripts ont passé).
// L'init lourde (dicos) reste paresseuse au 1er analyze.
postMessage({ id: '__ready__', ready: true });
