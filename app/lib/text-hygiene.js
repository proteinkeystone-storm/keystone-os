/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — text-hygiene.js
   Hygiène invisible du texte : ce qui sort d'un pad d'écriture ne
   porte AUCUN caractère caché.
   ───────────────────────────────────────────────────────────────
   Pourquoi ce module existe (17 août 2026) : Stéphane a demandé que
   tout texte rendu par Ghost Writer soit débarrassé de sa « signature
   IA ». Étude faite (outil MarkMyAss/ghostmark, code lu) : sur du
   TEXTE, la seule signature qu'un outil sache retirer, ce sont les
   CARACTÈRES UNICODE INVISIBLES — espaces de largeur nulle, traits
   d'union conditionnels, BOM, bloc « Tags » de stéganographie, espaces
   typographiques exotiques. Un filigrane statistique (biais dans le
   choix des mots) n'est ni détectable ni retirable par personne hors du
   fournisseur ; le « ça sent l'IA » à la lecture est une affaire de
   STYLE (option « écriture naturelle », côté prompt), pas de
   caractères.

   Ce module fait donc UNE chose, systématiquement et sans bouton :
   il rend un texte propre. Il sert aussi contre le texte COLLÉ par un
   client depuis Word, un site ou un autre assistant — c'est là qu'on
   trouve le plus souvent ces caractères en vrai.

   Deux règles non négociables, propres au français :
   · On NE TOUCHE PAS aux espaces insécables (U+00A0, U+202F). Devant
     « : ; ! ? » et dans « guillemets », c'est la typographie française
     correcte — la casser se verrait à l'export InDesign de desK et
     dans toute relecture sérieuse.
   · On ne touche pas non plus aux marques bidi, aux ZWJ/ZWNJ (arabe,
     indien, séquences emoji), ni aux sélecteurs de variation. Ils
     PEUVENT porter du sens ; on les signale dans inspectText(), on ne
     les retire jamais en silence.

   Zéro dépendance, zéro appel réseau, réutilisable tel quel par
   Missive, Social Manager, desK, booK.

       sanitizeText(text)  → string        (le texte propre)
       inspectText(text)   → { total, removed, normalized, preserved,
                               hits:[{ index, codepoint, name, action }] }
   ═══════════════════════════════════════════════════════════════ */

// Points de code sans AUCUN rôle typographique dans un texte courant :
// on les retire. Écrits en hexadécimal explicite (jamais en littéral
// invisible dans le source) pour rester lisibles et relisibles en diff.
const REMOVE = new Map([
  [0x200B, 'ESPACE DE LARGEUR NULLE'],
  [0x2060, 'GLUON DE MOTS (word joiner)'],
  [0x00AD, 'TRAIT D’UNION CONDITIONNEL'],
  [0x180E, 'SÉPARATEUR DE VOYELLES MONGOL'],
  [0xFEFF, 'BOM (espace insécable de largeur nulle)'],
]);

// Bloc « Tags » U+E0000–U+E007F : invisible dans tous les moteurs de
// rendu, sans usage légitime — c'est le support connu du texte caché
// (« ASCII smuggling »). Toujours retiré.
const TAGS_LO = 0xE0000, TAGS_HI = 0xE007F;

// Espaces typographiques exotiques → espace ordinaire (U+0020). Le sens
// ne change pas, la mise en page redevient prévisible.
const NORMALIZE = new Map([
  [0x2000, 'QUADRATIN (en quad)'],
  [0x2001, 'CADRATIN (em quad)'],
  [0x2002, 'DEMI-CADRATIN'],
  [0x2003, 'CADRATIN'],
  [0x2004, 'TIERS DE CADRATIN'],
  [0x2005, 'QUART DE CADRATIN'],
  [0x2006, 'SIXIÈME DE CADRATIN'],
  [0x2007, 'ESPACE TABULAIRE'],
  [0x2008, 'ESPACE PONCTUATION'],
  [0x2009, 'ESPACE FINE'],
  [0x200A, 'ESPACE ULTRAFINE'],
  [0x205F, 'ESPACE MOYENNE MATHÉMATIQUE'],
  [0x3000, 'ESPACE IDÉOGRAPHIQUE'],
]);

// Caractères qui PEUVENT porter du sens : signalés, jamais retirés.
const PRESERVE = new Map([
  [0x00A0, 'ESPACE INSÉCABLE (typographie française)'],
  [0x202F, 'ESPACE FINE INSÉCABLE (typographie française)'],
  [0x200C, 'ANTILIANT DE LARGEUR NULLE (ZWNJ)'],
  [0x200D, 'LIANT DE LARGEUR NULLE (ZWJ, séquences emoji)'],
  [0x200E, 'MARQUE GAUCHE-À-DROITE'],
  [0x200F, 'MARQUE DROITE-À-GAUCHE'],
  [0x061C, 'MARQUE DE LETTRE ARABE'],
  [0x202A, 'ENCHÂSSEMENT GAUCHE-À-DROITE'],
  [0x202B, 'ENCHÂSSEMENT DROITE-À-GAUCHE'],
  [0x202C, 'FIN DE FORMATAGE DIRECTIONNEL'],
  [0x202D, 'FORÇAGE GAUCHE-À-DROITE'],
  [0x202E, 'FORÇAGE DROITE-À-GAUCHE'],
  [0x2066, 'ISOLAT GAUCHE-À-DROITE'],
  [0x2067, 'ISOLAT DROITE-À-GAUCHE'],
  [0x2068, 'ISOLAT PREMIER FORT'],
  [0x2069, 'FIN D’ISOLAT'],
]);
const VS_LO = 0xFE00, VS_HI = 0xFE0F;              // sélecteurs de variation
const VSS_LO = 0xE0100, VSS_HI = 0xE01EF;          // supplément

/** Classe un point de code : 'remove' | 'normalize' | 'preserve' | null. */
function _classify(cp) {
  if (REMOVE.has(cp))                    return ['remove',    REMOVE.get(cp)];
  if (cp >= TAGS_LO && cp <= TAGS_HI)    return ['remove',    'CARACTÈRE « TAG » (texte caché)'];
  if (NORMALIZE.has(cp))                 return ['normalize', NORMALIZE.get(cp)];
  if (PRESERVE.has(cp))                  return ['preserve',  PRESERVE.get(cp)];
  if (cp >= VS_LO && cp <= VS_HI)        return ['preserve',  'SÉLECTEUR DE VARIATION'];
  if (cp >= VSS_LO && cp <= VSS_HI)      return ['preserve',  'SÉLECTEUR DE VARIATION (supplément)'];
  return null;
}

/**
 * Rend le texte propre : retire les caractères invisibles sans rôle,
 * ramène les espaces exotiques à l'espace ordinaire, laisse intact tout
 * ce qui peut porter du sens. Idempotent. Une valeur non-string est
 * rendue telle quelle (on ne casse jamais un appelant).
 */
export function sanitizeText(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = '';
  let dirty = false;
  // Itération par point de code (pas par unité UTF-16) : les Tags et le
  // supplément de sélecteurs vivent hors du plan multilingue de base.
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    // Chemin rapide : l'ASCII et la quasi-totalité du latin ne sont jamais concernés.
    if (cp < 0xA0) { out += ch; continue; }
    const c = _classify(cp);
    if (!c)               { out += ch; continue; }
    if (c[0] === 'remove')    { dirty = true; continue; }
    if (c[0] === 'normalize') { dirty = true; out += ' '; continue; }
    out += ch;                                   // preserve
  }
  return dirty ? out : text;
}

/**
 * Inspecte sans modifier : ce que sanitizeText() ferait, et ce qu'il
 * laisserait volontairement. Sert aux bancs et à un éventuel affichage.
 */
export function inspectText(text) {
  const res = { total: 0, removed: 0, normalized: 0, preserved: 0, hits: [] };
  if (typeof text !== 'string' || !text) return res;
  let index = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    res.total++;
    if (cp >= 0xA0) {
      const c = _classify(cp);
      if (c) {
        const action = c[0];
        // Un BOM en tête de fichier est une marque d'encodage banale : on le
        // retire quand même (il n'a rien à faire DANS un texte), mais on le
        // nomme pour ce qu'il est.
        res[action === 'remove' ? 'removed' : action === 'normalize' ? 'normalized' : 'preserved']++;
        res.hits.push({ index, codepoint: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), name: c[1], action });
      }
    }
    index++;
  }
  return res;
}

/**
 * Applique sanitizeText() à chaque `text` d'un tableau de variantes
 * Ghost Writer ({label, text}) sans toucher au reste du payload.
 * Tolère un payload absent ou mal formé.
 */
export function sanitizeVariants(variants) {
  if (!Array.isArray(variants)) return variants;
  return variants.map(v => (v && typeof v.text === 'string') ? { ...v, text: sanitizeText(v.text) } : v);
}
