// ═══════════════════════════════════════════════════════════════
// KEY BRAND — bibliothèque de polices (KB-3) · préfixe kb
//
// Liste CURÉE de familles Google Fonts (licences libres — OFL/Apache),
// PAS un catalogue exhaustif : des valeurs sûres par catégorie, adaptées
// aux chartes de TPE/PME françaises. Chaque entrée embarque son axe de
// graisses css2 (`w`) : plage `min..max` pour les variables, liste
// `a;b;c` pour les statiques — indispensable pour un spécimen honnête
// (pas de gras synthétique mensonger).
//
// La CSP autorise déjà fonts.googleapis.com (styles) + fonts.gstatic.com
// (fontes) — cf. vercel.json. Chargement à la demande uniquement.
// ═══════════════════════════════════════════════════════════════

// c : sans | serif | display | mono | script
export const GOOGLE_FONTS = [
  // ── Sans
  { f: 'Inter',             c: 'sans',   w: '100..900' },
  { f: 'Roboto',            c: 'sans',   w: '100;300;400;500;700;900' },
  { f: 'Open Sans',         c: 'sans',   w: '300..800' },
  { f: 'Lato',              c: 'sans',   w: '100;300;400;700;900' },
  { f: 'Montserrat',        c: 'sans',   w: '100..900' },
  { f: 'Poppins',           c: 'sans',   w: '100;200;300;400;500;600;700;800;900' },
  { f: 'Raleway',           c: 'sans',   w: '100..900' },
  { f: 'Nunito',            c: 'sans',   w: '200..1000' },
  { f: 'Work Sans',         c: 'sans',   w: '100..900' },
  { f: 'DM Sans',           c: 'sans',   w: '100..1000' },
  { f: 'Manrope',           c: 'sans',   w: '200..800' },
  { f: 'Rubik',             c: 'sans',   w: '300..900' },
  { f: 'Karla',             c: 'sans',   w: '200..800' },
  { f: 'Mulish',            c: 'sans',   w: '200..1000' },
  { f: 'Figtree',           c: 'sans',   w: '300..900' },
  { f: 'Outfit',            c: 'sans',   w: '100..900' },
  { f: 'Plus Jakarta Sans', c: 'sans',   w: '200..800' },
  { f: 'Albert Sans',       c: 'sans',   w: '100..900' },
  { f: 'Barlow',            c: 'sans',   w: '100;200;300;400;500;600;700;800;900' },
  { f: 'Archivo',           c: 'sans',   w: '100..900' },
  { f: 'Space Grotesk',     c: 'sans',   w: '300..700' },
  { f: 'Sora',              c: 'sans',   w: '100..800' },
  { f: 'Urbanist',          c: 'sans',   w: '100..900' },
  { f: 'Lexend',            c: 'sans',   w: '100..900' },
  { f: 'Jost',              c: 'sans',   w: '100..900' },
  { f: 'IBM Plex Sans',     c: 'sans',   w: '100;200;300;400;500;600;700' },
  // ── Serif
  { f: 'Playfair Display',  c: 'serif',  w: '400..900' },
  { f: 'Lora',              c: 'serif',  w: '400..700' },
  { f: 'Merriweather',      c: 'serif',  w: '300;400;700;900' },
  { f: 'Libre Baskerville', c: 'serif',  w: '400;700' },
  { f: 'EB Garamond',       c: 'serif',  w: '400..800' },
  { f: 'Cormorant Garamond',c: 'serif',  w: '300;400;500;600;700' },
  { f: 'Crimson Pro',       c: 'serif',  w: '200..900' },
  { f: 'Bitter',            c: 'serif',  w: '100..900' },
  { f: 'Source Serif 4',    c: 'serif',  w: '200..900' },
  { f: 'Spectral',          c: 'serif',  w: '200;300;400;500;600;700;800' },
  { f: 'Fraunces',          c: 'serif',  w: '100..900' },
  { f: 'Marcellus',         c: 'serif',  w: '400' },
  // ── Display
  { f: 'Oswald',            c: 'display', w: '200..700' },
  { f: 'Bebas Neue',        c: 'display', w: '400' },
  { f: 'Anton',             c: 'display', w: '400' },
  { f: 'Abril Fatface',     c: 'display', w: '400' },
  { f: 'DM Serif Display',  c: 'display', w: '400' },
  { f: 'Lobster',           c: 'display', w: '400' },
  { f: 'Comfortaa',         c: 'display', w: '300..700' },
  { f: 'Quicksand',         c: 'display', w: '300..700' },
  // ── Mono
  { f: 'JetBrains Mono',    c: 'mono',   w: '100..800' },
  { f: 'Fira Code',         c: 'mono',   w: '300..700' },
  { f: 'Space Mono',        c: 'mono',   w: '400;700' },
  { f: 'IBM Plex Mono',     c: 'mono',   w: '100;200;300;400;500;600;700' },
  { f: 'Courier Prime',     c: 'mono',   w: '400;700' },
  // ── Manuscrites
  { f: 'Caveat',            c: 'script', w: '400..700' },
  { f: 'Dancing Script',    c: 'script', w: '400..700' },
  { f: 'Pacifico',          c: 'script', w: '400' },
  { f: 'Satisfy',           c: 'script', w: '400' },
  { f: 'Amatic SC',         c: 'script', w: '400;700' },
  { f: 'Shadows Into Light',c: 'script', w: '400' },
  { f: 'Permanent Marker',  c: 'script', w: '400' },
];

export const FONT_CATEGORIES = [
  ['all',     'Toutes'],
  ['sans',    'Sans serif'],
  ['serif',   'Serif'],
  ['display', 'Display'],
  ['mono',    'Mono'],
  ['script',  'Manuscrites'],
];

export function fontMeta(family) {
  return GOOGLE_FONTS.find(x => x.f === family) || null;
}

/** Graisses réellement disponibles pour une famille (depuis l'axe css2). */
export function weightsOf(axis) {
  if (!axis) return [400];
  if (axis.includes('..')) {
    const [min, max] = axis.split('..').map(Number);
    const out = [];
    for (let w = Math.ceil(min / 100) * 100; w <= max; w += 100) out.push(w);
    if (!out.includes(min)) out.unshift(min);
    return out;
  }
  return axis.split(';').map(Number);
}

/** URL de la feuille css2 pour une famille (+ axe si multiple). */
export function fontHref(family, axis) {
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  const spec = (axis && axis !== '400') ? `:wght@${axis}` : '';
  return `https://fonts.googleapis.com/css2?family=${fam}${spec}&display=swap`;
}

/** Charge une famille à la demande (idempotent). */
export function ensureFontLoaded(family, axis) {
  const id = 'kb-font-' + family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = fontHref(family, axis);
  document.head.appendChild(link);
}

/** Page officielle (téléchargement légal + licence). */
export function fontSpecimenUrl(family) {
  return `https://fonts.google.com/specimen/${encodeURIComponent(family).replace(/%20/g, '+')}`;
}

// ── Générateur de phrases du spécimen (fr) ──
export const TYPE_SAMPLES = [
  'Portez ce vieux whisky au juge blond qui fume.',
  'Voix ambiguë d\'un cœur qui, au zéphyr, préfère les jattes de kiwis.',
  'L\'atelier ouvre ses portes samedi à 9 h 30 — entrée libre.',
  'Depuis 1987, la maison cultive un savoir-faire d\'exception.',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 &@€%',
  'Réservez maintenant : offre valable jusqu\'au 31 décembre.',
];
