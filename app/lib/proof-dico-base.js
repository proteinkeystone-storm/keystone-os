/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — proof-dico-base.js
   LA COUCHE DE BASE du dictionnaire de relecture (GP-2, couche 1/2).

   Grammalecte n'a pas les noms propres ni les abréviations de métier
   dans son dictionnaire : il les signale tous comme des mots inconnus.
   GP-1 en tait déjà l'essentiel par la POSITION (une majuscule en
   milieu de phrase est un nom propre). Restent ceux qui tombent en
   TÊTE DE PHRASE, où la majuscule est grammaticale et où la position
   ne dit plus rien.

   Ce fichier est la réponse générique : un vocabulaire livré AVEC
   l'outil, que tout le monde reçoit sans rien partager avec personne.

   ── Ce qui a le droit d'entrer ici ─────────────────────────────
   UNIQUEMENT du vocabulaire GÉNÉRIQUE : des mots que n'importe quel
   texte professionnel français peut employer. Grades, civilités,
   abréviations d'usage.

   ⚠ Ce qui n'a PAS le droit d'entrer : le vocabulaire d'un client —
   noms de personnes, d'unités, de projets, de produits. Cela vit dans
   le dictionnaire de la MAISON (couche 2), rattaché à sa licence, et
   ne se partage pas entre clients. Décision de Stéphane, 2026-08-20 :
   « une base livrée + le dico de la maison ».

   Les entrées sont comparées en MINUSCULES (le moteur abaisse la
   casse avant de comparer) : écrire « Lcl » ou « lcl » revient au même.
   ═══════════════════════════════════════════════════════════════ */

// ── Grades et fonctions, abrégés ────────────────────────────────
// La forme abrégée est la seule concernée : « colonel » est dans le
// dictionnaire de Grammalecte, « Col » ne l'est pas. Armée de terre,
// marine, air et gendarmerie.
// ⚠ Rien de moins de TROIS signes : `minLetters` (proof-engine.js) écarte déjà
// tout token plus court, quelle que soit cette liste. Une entrée « lt » ou
// « cf » y serait morte — et laisserait croire qu'elle sert à quelque chose.
const GRADES = [
  'gal', 'gca', 'gdi', 'gbr',                     // officiers généraux
  'col', 'lcl', 'cba', 'cne', 'ltn', 'slt', 'asp',
  'maj', 'adc', 'adj', 'sch', 'sgt', 'mdl', 'brg', 'cch', 'cpl',
  'cdt', 'cfr', 'ccp',                            // marine (formes à trois signes)
  'gen', 'gén', 'amiral', 'contre-amiral', 'vice-amiral',
];

// ── Civilités, titres et mentions d'usage ───────────────────────
const CIVILITES = [
  'mgr', 'mes', 'drs',
  'mme', 'mmes', 'mlle', 'mlles',
  'ère',
  'cie', 'ets', 'sarl', 'sasu',                   // formes sociales en casse normale
];

// ── Abréviations bibliographiques et de renvoi ──────────────────
const RENVOIS = [
  'ibid', 'idem', 'cit', 'suiv',
  'fig', 'tab', 'ann', 'chap', 'vol', 'coll',
];

// La liste livrée, dédoublonnée et en minuscules.
export const DICO_BASE = Object.freeze(
  Array.from(new Set([].concat(GRADES, CIVILITES, RENVOIS).map((w) => String(w).toLowerCase())))
);

// Les familles, exposées pour la documentation et les bancs.
export const DICO_BASE_FAMILLES = Object.freeze({
  grades: GRADES.length,
  civilites: CIVILITES.length,
  renvois: RENVOIS.length,
});
