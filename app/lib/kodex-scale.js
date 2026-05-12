/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Calculateur d'échelle Kodex (KILLER FEATURE)
   Sprint Kodex-3.1

   Mission : éviter l'erreur d'impression qui coûte 800 € — DPI
   insuffisant, échelle non adaptée, logo pixelisé sur la bâche.

   Pour les grands formats (bâche, panneau 4×3, kakémono), un
   maquettiste ne travaille jamais à l'échelle réelle : il
   travaille à l'échelle 1/10e (parfois 1/5e) pour des raisons
   pratiques (taille des fichiers, performance Illustrator).
   Le DPI doit alors être multiplié par le facteur d'échelle
   pour obtenir une résolution équivalente à l'impression finale.

   On expose :
     - computeScale(standard)   → ensemble cohérent de paramètres
     - getViewingContext(maxMm) → distance de vue probable + DPI cible
     - minTextSize(maxMm)       → hauteur minimum lisible du titre
     - minLogoSize(std)         → px minimum d'un logo bitmap
   ═══════════════════════════════════════════════════════════════ */

// ── Tables empiriques (vérifiées en démarche professionnelle) ─

// Distance de vue → contexte + DPI cible (résolution équivalente
// à laquelle l'œil humain ne perçoit plus les pixels individuels).
const VIEWING_TABLE = [
  { max_mm: 200,    label: 'Lecture rapprochée',  distance_m: '< 1 m',  dpi: 300 },
  { max_mm: 500,    label: 'Bureau / présentoir',  distance_m: '1 à 3 m', dpi: 150 },
  { max_mm: 2000,   label: 'Vitrine / boutique',   distance_m: '3 à 5 m', dpi: 100 },
  { max_mm: 5000,   label: 'Rue / passage',        distance_m: '5 à 10 m', dpi: 50  },
  { max_mm: Infinity, label: 'Façade / panneau',   distance_m: '> 10 m',  dpi: 25  },
];

// ── Helpers ───────────────────────────────────────────────────
function _maxMm(std) {
  const f = std?.format_fini;
  if (!f) return 0;
  if (f.width_mm && f.height_mm) return Math.max(f.width_mm, f.height_mm);
  // formats en pixels (digital) : pas de "distance" applicable
  return 0;
}

export function isDigital(std) {
  return std?.format_fini?.width_px != null;
}

export function getViewingContext(maxMm) {
  return VIEWING_TABLE.find(row => maxMm <= row.max_mm) || VIEWING_TABLE[VIEWING_TABLE.length - 1];
}

// ── Échelle de travail (1/1, 1/2, 1/10) ───────────────────────
// Règles : > 1000 mm → 1/10e. > 500 mm → 1/2. Sinon 1/1.
// Un standard peut overrider via le champ `scale` (string libre).
export function computeScaleFactor(std) {
  if (std?.scale) {
    // Texte libre — on extrait le ratio si présent ("1/10e", "1/5", etc.)
    const m = String(std.scale).match(/1\/(\d+)/);
    if (m) return 1 / parseInt(m[1], 10);
  }
  const max = _maxMm(std);
  if (max >= 1000) return 0.1;     // 1/10e
  if (max >= 500)  return 0.5;     // 1/2
  return 1;
}

export function formatScaleLabel(factor) {
  if (factor >= 1)   return 'Échelle réelle (1/1)';
  if (factor === 0.5) return 'Échelle 1/2';
  if (factor === 0.1) return 'Échelle 1/10';
  return `Échelle ${factor}`;
}

// ── Format de travail réel (en tenant compte de l'échelle) ────
export function computeWorkFormat(std) {
  const f = std.format_fini;
  const factor = computeScaleFactor(std);
  if (!f.width_mm) return null;     // digital → pas applicable
  return {
    width_mm:  Math.round(f.width_mm * factor),
    height_mm: Math.round(f.height_mm * factor),
    factor,
    factor_label: formatScaleLabel(factor),
  };
}

// ── Texte minimum lisible — hauteur des capitales en mm ───────
// À la distance de vue, l'œil humain résoud ~1 minute d'arc.
// Convertit en hauteur de caractère lisible confortablement.
export function minTextSize(maxMm) {
  if (maxMm <= 200)  return 3;      // 8-10 pt typo
  if (maxMm <= 500)  return 8;
  if (maxMm <= 2000) return 25;
  if (maxMm <= 5000) return 80;
  return 200;                       // façade ≥ 10 m
}

// ── Logo minimum px sur la maquette à l'échelle de travail ────
// Si le logo est bitmap (PNG, JPG), il faut suffisamment de pixels
// pour qu'il reste net à la sortie d'impression.
// Hypothèse : logo occupe 1/8 de la largeur du visuel à l'échelle réelle.
export function minLogoPx(std) {
  const w = std?.format_fini?.width_mm;
  if (!w) return null;              // digital → pas applicable
  const dpi = std.dpi || 100;
  const widthAtPrint = w / 25.4 * dpi;     // largeur en pixels équivalents
  const minLogo = Math.round(widthAtPrint / 8);
  return minLogo;
}

// ── Composition principale : retourne un objet complet pour UI ─
export function computeScale(std) {
  if (!std) return null;
  const digital = isDigital(std);
  const maxMm = _maxMm(std);
  const work = computeWorkFormat(std);
  const factor = computeScaleFactor(std);

  if (digital) {
    return {
      digital: true,
      message: 'Format numérique — pas d\'échelle d\'impression. Travaillez à 100 % en sRGB.',
    };
  }

  const view = getViewingContext(maxMm);
  const isLargeFormat = maxMm >= 1000;
  return {
    digital: false,
    is_large_format: isLargeFormat,
    factor,
    factor_label: formatScaleLabel(factor),
    work_format: work,
    viewing_context: view.label,
    viewing_distance: view.distance_m,
    target_dpi: std.dpi || view.dpi,
    recommended_dpi: view.dpi,
    min_text_mm: minTextSize(maxMm),
    min_logo_px: minLogoPx(std),
    warning: std.dpi && std.dpi < view.dpi / 2
      ? `Le DPI fourni (${std.dpi}) est sensiblement inférieur au minimum recommandé (${view.dpi}) pour cette distance de vue. À vérifier auprès de votre imprimeur.`
      : null,
  };
}

// ── Validation d'un fichier bitmap fourni par l'utilisateur ───
// Retourne { ok: bool, message: string } selon la résolution réelle
// du fichier comparée à ce qu'attend le format.
export function validateBitmap(std, file_width_px, file_height_px) {
  const scale = computeScale(std);
  if (!scale || scale.digital) return { ok: true };
  if (!file_width_px || !file_height_px) return { ok: true };

  const needed = scale.min_logo_px;
  if (!needed) return { ok: true };

  if (file_width_px < needed) {
    return {
      ok: false,
      message: `Cette image fait ${file_width_px} px de large alors que ${needed} px sont nécessaires pour rester nette sur ce format. Demandez une version plus haute définition à votre graphiste.`,
    };
  }
  return { ok: true, message: `Résolution suffisante (${file_width_px} px ≥ ${needed} px requis).` };
}
