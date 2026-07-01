/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Bibliothèque de symboles Unicode (GW-Symboles, 2026-07)

   Bibliothèque MAISON CURÉE (~330 symboles utiles), pas l'UCD brut
   (150 000 caractères dont 95 % de bruit, noms anglais techniques).
   Philosophie K-Store : le contenu est un asset données, le contenant
   (panneau Ω, lib/symbols-panel.js) est un moteur pur.

   Chaque entrée : [caractère, nom fr affiché (sert aussi de mot-clé)].
   La recherche normalise accents/casse des deux côtés.

   ⚠ Curation : on ÉVITE les caractères à présentation emoji forcée
   (✅ ➡️ ☀️…) qui s'affichent en couleur sur mobile — un symbole
   TEXTE doit rester du texte. Les quelques pictos limites vivent dans
   la catégorie « Pictos » assumée « rendu variable selon appareil ».
   ═══════════════════════════════════════════════════════════════ */

export const SYMBOL_CATEGORIES = [
  {
    id: 'arrows', label: 'Flèches', iconName: 'arrow-right',
    items: [
      ['→', 'Flèche droite'], ['←', 'Flèche gauche'], ['↑', 'Flèche haut'], ['↓', 'Flèche bas'],
      ['↔', 'Flèche gauche-droite'], ['↕', 'Flèche haut-bas'], ['↗', 'Flèche diagonale montante'],
      ['↘', 'Flèche diagonale descendante'], ['↖', 'Flèche diagonale haut gauche'], ['↙', 'Flèche diagonale bas gauche'],
      ['⇒', 'Double flèche droite implique'], ['⇐', 'Double flèche gauche'], ['⇔', 'Double flèche équivalence'],
      ['⟶', 'Flèche droite longue'], ['⟵', 'Flèche gauche longue'], ['↦', 'Flèche application'],
      ['↩', 'Flèche retour gauche'], ['↪', 'Flèche retour droite'], ['↺', 'Rotation anti-horaire'], ['↻', 'Rotation horaire recommencer'],
      ['➜', 'Flèche épaisse droite'], ['➔', 'Flèche lourde droite'], ['➤', 'Pointe de flèche pleine'], ['➢', 'Pointe de flèche 3D'],
      ['▶', 'Triangle droite lecture play'], ['◀', 'Triangle gauche'], ['▲', 'Triangle haut hausse'], ['▼', 'Triangle bas baisse'],
      ['▸', 'Petit triangle droite puce'], ['◂', 'Petit triangle gauche'], ['▴', 'Petit triangle haut'], ['▾', 'Petit triangle bas'],
      ['‣', 'Puce triangulaire'], ['⤴', 'Flèche courbe montante'], ['⤵', 'Flèche courbe descendante'],
      ['«', 'Guillemet chevron gauche'], ['»', 'Guillemet chevron droite'], ['›', 'Chevron simple droite'], ['‹', 'Chevron simple gauche'],
    ],
  },
  {
    id: 'bullets', label: 'Puces & coches', iconName: 'check-circle',
    items: [
      ['•', 'Puce ronde'], ['◦', 'Puce ronde creuse'], ['∙', 'Puce point médian'], ['·', 'Point médian'],
      ['▪', 'Petit carré plein'], ['▫', 'Petit carré creux'], ['■', 'Carré plein'], ['□', 'Carré creux'],
      ['●', 'Rond plein'], ['○', 'Rond creux'], ['◉', 'Rond pointé'], ['⊙', 'Cercle pointé'],
      ['◆', 'Losange plein'], ['◇', 'Losange creux'], ['❖', 'Losange décoratif'],
      ['★', 'Étoile pleine'], ['☆', 'Étoile creuse'], ['✦', 'Étoile quatre branches pleine'], ['✧', 'Étoile quatre branches creuse'],
      ['✱', 'Astérisque lourd'], ['✲', 'Astérisque ouvert'], ['❋', 'Astérisque fleuri'], ['✽', 'Fleurette'],
      ['✓', 'Coche validation'], ['✔', 'Coche épaisse validé'], ['✗', 'Croix rejet'], ['✘', 'Croix épaisse refusé'],
      ['☑', 'Case cochée'], ['☐', 'Case vide à cocher'], ['☒', 'Case barrée'],
    ],
  },
  {
    id: 'separators', label: 'Séparateurs', iconName: 'minus',
    items: [
      ['–', 'Tiret demi-cadratin'], ['—', 'Tiret cadratin dialogue'], ['―', 'Barre horizontale'], ['‒', 'Tiret numérique'],
      ['─', 'Trait fin ligne'], ['━', 'Trait épais ligne'], ['═', 'Double ligne'], ['│', 'Barre verticale fine'],
      ['┃', 'Barre verticale épaisse'], ['¦', 'Barre brisée'], ['‖', 'Double barre verticale'],
      ['┄', 'Pointillés fins'], ['┈', 'Pointillés serrés'], ['⋯', 'Points de suspension médians'], ['…', 'Points de suspension'],
      ['〜', 'Tilde vague large'], ['∿', 'Onde sinusoïde'], ['⁂', 'Astérisme trois étoiles'], ['※', 'Marque de référence japonaise note'],
      ['◈', 'Losange encadré'], ['⁘', 'Quatre points losange'],
    ],
  },
  {
    id: 'numbers', label: 'Chiffres & rangs', iconName: 'hash',
    items: [
      ['①', 'Un cerclé'], ['②', 'Deux cerclé'], ['③', 'Trois cerclé'], ['④', 'Quatre cerclé'], ['⑤', 'Cinq cerclé'],
      ['⑥', 'Six cerclé'], ['⑦', 'Sept cerclé'], ['⑧', 'Huit cerclé'], ['⑨', 'Neuf cerclé'], ['⑩', 'Dix cerclé'],
      ['❶', 'Un cerclé plein'], ['❷', 'Deux cerclé plein'], ['❸', 'Trois cerclé plein'], ['❹', 'Quatre cerclé plein'], ['❺', 'Cinq cerclé plein'],
      ['❻', 'Six cerclé plein'], ['❼', 'Sept cerclé plein'], ['❽', 'Huit cerclé plein'], ['❾', 'Neuf cerclé plein'], ['❿', 'Dix cerclé plein'],
      ['Ⅰ', 'Chiffre romain un'], ['Ⅱ', 'Chiffre romain deux'], ['Ⅲ', 'Chiffre romain trois'], ['Ⅳ', 'Chiffre romain quatre'], ['Ⅴ', 'Chiffre romain cinq'],
      ['Ⅵ', 'Chiffre romain six'], ['Ⅶ', 'Chiffre romain sept'], ['Ⅷ', 'Chiffre romain huit'], ['Ⅸ', 'Chiffre romain neuf'], ['Ⅹ', 'Chiffre romain dix'],
      ['№', 'Numéro'], ['ᵉ', 'Exposant e ordinal'], ['ᵉʳ', 'Exposant er premier'], ['ᵈ', 'Exposant d'],
    ],
  },
  {
    id: 'legal', label: 'Légal & commerce', iconName: 'briefcase',
    items: [
      ['©', 'Copyright droit d\'auteur'], ['®', 'Marque déposée'], ['™', 'Trademark marque'], ['℠', 'Marque de service'],
      ['§', 'Paragraphe section loi'], ['¶', 'Pied-de-mouche paragraphe'], ['†', 'Obèle croix renvoi'], ['‡', 'Double obèle'],
      ['€', 'Euro'], ['$', 'Dollar'], ['£', 'Livre sterling'], ['¥', 'Yen yuan'], ['¢', 'Centime cent'], ['₿', 'Bitcoin'],
      ['%', 'Pour cent'], ['‰', 'Pour mille'], ['℮', 'Estimation quantité emballage'],
    ],
  },
  {
    id: 'math', label: 'Maths & unités', iconName: 'divide',
    items: [
      ['+', 'Plus'], ['−', 'Moins soustraction'], ['±', 'Plus ou moins'], ['×', 'Multiplication fois'], ['÷', 'Division'],
      ['=', 'Égal'], ['≠', 'Différent inégal'], ['≈', 'Environ approximatif'], ['≡', 'Identique équivalent'],
      ['<', 'Inférieur'], ['>', 'Supérieur'], ['≤', 'Inférieur ou égal'], ['≥', 'Supérieur ou égal'],
      ['∞', 'Infini'], ['√', 'Racine carrée'], ['∑', 'Somme sigma'], ['∆', 'Delta variation'], ['π', 'Pi'],
      ['µ', 'Micro mu'], ['Ω', 'Oméga ohm'], ['λ', 'Lambda'], ['Φ', 'Phi'],
      ['²', 'Exposant deux carré mètre carré'], ['³', 'Exposant trois cube'], ['¹', 'Exposant un'], ['ⁿ', 'Exposant n'],
      ['½', 'Un demi'], ['⅓', 'Un tiers'], ['¼', 'Un quart'], ['¾', 'Trois quarts'], ['⅔', 'Deux tiers'],
      ['°', 'Degré température'], ['′', 'Prime minute'], ['″', 'Double prime seconde pouce'],
      ['∈', 'Appartient à'], ['∩', 'Intersection'], ['∪', 'Union'], ['∅', 'Ensemble vide'], ['∴', 'Donc par conséquent'],
    ],
  },
  {
    id: 'typo', label: 'Typographie', iconName: 'type',
    items: [
      ['«', 'Guillemet français ouvrant'], ['»', 'Guillemet français fermant'], ['“', 'Guillemet anglais ouvrant'], ['”', 'Guillemet anglais fermant'],
      ['„', 'Guillemet bas allemand'], ['‘', 'Guillemet simple ouvrant'], ['’', 'Apostrophe typographique'],
      ['…', 'Points de suspension'], ['·', 'Point médian inclusif'], ['‧', 'Point de césure'],
      ['¡', 'Point d\'exclamation inversé espagnol'], ['¿', 'Point d\'interrogation inversé espagnol'], ['‽', 'Point exclarrogatif interrobang'],
      ['ª', 'Ordinal féminin espagnol'], ['º', 'Ordinal masculin espagnol'], ['‑', 'Trait d\'union insécable'],
    ],
  },
  {
    id: 'accents', label: 'Majuscules accentuées', iconName: 'type',
    items: [
      ['É', 'E accent aigu majuscule'], ['È', 'E accent grave majuscule'], ['Ê', 'E accent circonflexe majuscule'], ['Ë', 'E tréma majuscule'],
      ['À', 'A accent grave majuscule'], ['Â', 'A accent circonflexe majuscule'], ['Ç', 'C cédille majuscule'],
      ['Î', 'I accent circonflexe majuscule'], ['Ï', 'I tréma majuscule'], ['Ô', 'O accent circonflexe majuscule'],
      ['Ù', 'U accent grave majuscule'], ['Û', 'U accent circonflexe majuscule'], ['Ü', 'U tréma majuscule'],
      ['Ÿ', 'Y tréma majuscule'], ['Œ', 'OE ligature majuscule oeuvre'], ['Æ', 'AE ligature majuscule'], ['ß', 'Eszett allemand'],
    ],
  },
  {
    id: 'pictos', label: 'Pictos', iconName: 'alert-triangle', note: 'Rendu variable selon l\'appareil (certains s\'affichent en couleur).',
    items: [
      ['⚠', 'Attention avertissement danger'], ['☞', 'Index pointant droite voir'], ['☜', 'Index pointant gauche'],
      ['✎', 'Crayon écrire'], ['✂', 'Ciseaux couper'], ['♪', 'Note de musique'], ['♫', 'Notes de musique'],
      ['☙', 'Fleuron feuille'], ['❧', 'Fleuron tourné'], ['⌘', 'Touche commande Mac'], ['⌥', 'Touche option Mac'],
      ['⇧', 'Touche majuscule shift'], ['⌃', 'Touche contrôle'], ['⌫', 'Touche effacer'], ['⏎', 'Touche entrée retour'], ['⎋', 'Touche échap'],
    ],
  },
];

// ── Recherche (accent-insensible, fr) ───────────────────────────
export function normalizeQuery(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}
export function searchSymbols(query, max = 80) {
  const q = normalizeQuery(query);
  if (!q) return [];
  // Deux passes : le NOM du symbole d'abord (pertinence), le nom de sa
  // CATÉGORIE ensuite (« coche » → ✓ avant les puces de « Puces & coches »).
  const byName = [], byCat = [];
  for (const cat of SYMBOL_CATEGORIES) {
    const catMatch = normalizeQuery(cat.label).includes(q);
    for (const [c, n] of cat.items) {
      if (c === query || normalizeQuery(n).includes(q)) byName.push({ c, n, cat: cat.id });
      else if (catMatch) byCat.push({ c, n, cat: cat.id });
    }
  }
  return byName.concat(byCat).slice(0, max);
}

// ── Lettres stylées (alphabets mathématiques Unicode) ───────────
// ⚠ Accessibilité : les lecteurs d'écran les épellent lettre à lettre et
// les moteurs IA/SEO les lisent mal — le panneau affiche l'avertissement.
// Variantes SANS-SERIF (couverture de rendu la plus large, aucun trou de
// plage contrairement à l'italique serif où h = U+210E).
const STYLED_RANGES = {
  bold:       { A: 0x1D5D4, a: 0x1D5EE, d: 0x1D7EC, label: 'Gras' },
  italic:     { A: 0x1D608, a: 0x1D622, d: null,    label: 'Italique' },
  bolditalic: { A: 0x1D63C, a: 0x1D656, d: null,    label: 'Gras italique' },
  mono:       { A: 0x1D670, a: 0x1D68A, d: 0x1D7F6, label: 'Monospace' },
};
export const STYLED_STYLES = Object.entries(STYLED_RANGES).map(([id, r]) => ({ id, label: r.label }));
export function styleText(text, style) {
  const r = STYLED_RANGES[style];
  if (!r) return String(text || '');
  let out = '';
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (cp >= 65 && cp <= 90)       out += String.fromCodePoint(r.A + (cp - 65));        // A-Z
    else if (cp >= 97 && cp <= 122) out += String.fromCodePoint(r.a + (cp - 97));        // a-z
    else if (cp >= 48 && cp <= 57 && r.d) out += String.fromCodePoint(r.d + (cp - 48));  // 0-9
    else out += ch;   // accents, ponctuation… : inchangés (pas d'équivalent stylé)
  }
  return out;
}
