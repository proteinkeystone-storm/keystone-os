/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Calculateur d'échelle Kodex (KILLER FEATURE)
   Sprint Kodex-3.1 · révisé Sprint mai 2026

   Mission : éviter l'erreur d'impression qui coûte 800 € — résolution
   insuffisante, échelle non adaptée, logo pixelisé sur la bâche.

   ─────────────────────────────────────────────────────────────
   PRINCIPE (révisé) : on ne baisse JAMAIS le DPI.
   La résolution de sortie reste fixée à 300 DPI quel que soit le
   format. Pour les grands formats (bâche, panneau 4×3, kakémono),
   un maquettiste ne travaille pas à l'échelle réelle — le fichier
   pèserait plusieurs gigaoctets et serait impossible à manipuler.
   Il travaille donc à une échelle RÉDUITE (1/2, 1/10e) : c'est la
   TAILLE du fichier qu'on réduit via le facteur d'échelle, pas la
   densité de pixels. L'imprimeur agrandit ensuite pour la sortie,
   et la résolution effective reste équivalente à 300 DPI.

   On expose :
     - computeScale(std)        → ensemble cohérent de paramètres
     - getViewingContext(maxMm) → distance de vue probable (contexte)
     - minTextSize(maxMm)       → hauteur minimum lisible du titre
     - minLogoPx(std)           → px minimum d'un logo bitmap
   ═══════════════════════════════════════════════════════════════ */

// ── Résolution de sortie : constante, jamais dégradée ─────────
export const OUTPUT_DPI = 300;

// ── Tables empiriques (vérifiées en démarche professionnelle) ─

// Distance de vue → contexte de lecture. Sert uniquement à informer
// le maquettiste du recul probable du spectateur (pour calibrer la
// taille du texte et des éléments) — PAS à baisser la résolution.
const VIEWING_TABLE = [
  { max_mm: 200,      label: 'Lecture rapprochée', distance_m: '< 1 m'    },
  { max_mm: 500,      label: 'Bureau / présentoir', distance_m: '1 à 3 m'  },
  { max_mm: 2000,     label: 'Vitrine / boutique',  distance_m: '3 à 5 m'  },
  { max_mm: 5000,     label: 'Rue / passage',       distance_m: '5 à 10 m' },
  { max_mm: Infinity, label: 'Façade / panneau',    distance_m: '> 10 m'   },
];

// ── Helpers ───────────────────────────────────────────────────
function _maxMm(std) {
  const f = std?.format_fini;
  if (!f) return 0;
  if (f.width_mm && f.height_mm) return Math.max(f.width_mm, f.height_mm);
  // formats en pixels (digital) : pas de "distance" applicable
  return 0;
}

// Conversion mm → pixels à 300 DPI
function _mmToPx(mm) {
  return Math.round(mm / 25.4 * OUTPUT_DPI);
}

// Poids approximatif d'un fichier aplati RGB non compressé (octets)
function _estFileBytes(widthPx, heightPx) {
  return widthPx * heightPx * 3;
}

// Formatage lisible d'un poids de fichier
export function formatFileSize(bytes) {
  if (!bytes || bytes < 0) return '—';
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} Go`;
  const mb = bytes / 1e6;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1e3))} Ko`;
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
  if (factor >= 1)    return 'Échelle réelle (1/1)';
  if (factor === 0.5) return 'Échelle 1/2';
  if (factor === 0.1) return 'Échelle 1/10';
  return `Échelle ${factor}`;
}

// ── Format de travail réel (en tenant compte de l'échelle) ────
// width_mm/height_mm : dimensions de la maquette à l'échelle réduite
// width_px/height_px : pixels correspondants à 300 DPI (taille du fichier)
// file_bytes_*       : poids estimé du fichier réel vs échelle 1/1
export function computeWorkFormat(std) {
  const f = std.format_fini;
  if (!f.width_mm) return null;     // digital → pas applicable
  const factor = computeScaleFactor(std);

  const workW = Math.round(f.width_mm * factor);
  const workH = Math.round(f.height_mm * factor);
  const workWpx = _mmToPx(workW);
  const workHpx = _mmToPx(workH);

  const fullWpx = _mmToPx(f.width_mm);
  const fullHpx = _mmToPx(f.height_mm);

  return {
    width_mm:  workW,
    height_mm: workH,
    width_px:  workWpx,
    height_px: workHpx,
    factor,
    factor_label: formatScaleLabel(factor),
    file_bytes_work: _estFileBytes(workWpx, workHpx),
    file_bytes_full: _estFileBytes(fullWpx, fullHpx),
  };
}

// ── Texte minimum lisible — hauteur des capitales en mm ───────
// À la distance de vue, l'œil humain résout ~1 minute d'arc.
// Convertit en hauteur de caractère lisible confortablement.
export function minTextSize(maxMm) {
  if (maxMm <= 200)  return 3;      // 8-10 pt typo
  if (maxMm <= 500)  return 8;
  if (maxMm <= 2000) return 25;
  if (maxMm <= 5000) return 80;
  return 200;                       // façade ≥ 10 m
}

// ── Logo minimum px sur le fichier fourni par l'utilisateur ───
// Le logo doit avoir assez de pixels pour rester net APRÈS
// agrandissement à l'impression finale. On raisonne donc toujours
// sur le format FINI à 300 DPI, jamais sur l'échelle de travail.
// Hypothèse : le logo occupe 1/8 de la largeur du visuel.
export function minLogoPx(std) {
  const w = std?.format_fini?.width_mm;
  if (!w) return null;              // digital → pas applicable
  const widthAtPrint = _mmToPx(w);  // largeur du fichier fini à 300 DPI
  return Math.round(widthAtPrint / 8);
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
      output_dpi: OUTPUT_DPI,
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
    // La résolution de sortie ne varie jamais : toujours 300 DPI.
    output_dpi: OUTPUT_DPI,
    target_dpi: OUTPUT_DPI,
    recommended_dpi: OUTPUT_DPI,
    min_text_mm: minTextSize(maxMm),
    min_logo_px: minLogoPx(std),
    // Alerte si le standard déclare une résolution sous les 300 DPI.
    warning: std.dpi && std.dpi < OUTPUT_DPI
      ? `Ce standard déclare ${std.dpi} DPI alors que Kodex préconise ${OUTPUT_DPI} DPI pour une impression sans compromis. À 300 DPI, c'est la taille du fichier qu'on réduit via l'échelle de travail, jamais la densité de pixels.`
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
      message: `Cette image fait ${file_width_px} px de large alors que ${needed} px sont nécessaires pour rester nette sur ce format à 300 DPI. Demandez une version plus haute définition à votre graphiste.`,
    };
  }
  return { ok: true, message: `Résolution suffisante (${file_width_px} px ≥ ${needed} px requis à 300 DPI).` };
}
