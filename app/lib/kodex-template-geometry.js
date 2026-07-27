/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Template Geometry (P1 refonte Brief Prod)
   ─────────────────────────────────────────────────────────────
   SOURCE DE VÉRITÉ UNIQUE de la géométrie des gabarits.

   À partir d'un `standard` (objet produit par specToStandard —
   cascade spec exacte → règles imprimeur → défauts catégorie),
   calcule TOUT ce dont les rendus ont besoin :

     buildTemplateSpec(std, opts) → TemplateSpec

   Le même TemplateSpec alimente :
     - l'aperçu SVG de l'aside (kodex-template-svg)
     - le gabarit PDF (kodex-template-pdf)
     - le gabarit PSD (kodex-template-psd)
     - le LISEZMOI du kit (kodex-template-kit)

   Print / presse / grand format : unités mm, CMJN, 300 DPI.
   Le grand format est généré à l'ÉCHELLE DE TRAVAIL (1/2, 1/10 —
   cf. kodex-scale.js) : trim, fond perdu et zone de sécurité sont
   réduits d'autant, le calcul reste invisible pour l'utilisateur.

   Digital : unités px, sRGB. Le gabarit se réduit au canevas aux
   dimensions exactes — pas de fond perdu, pas de traits de coupe,
   pas de zone de sécurité (décision produit, juillet 2026).
   ═══════════════════════════════════════════════════════════════ */

import { OUTPUT_DPI, computeScaleFactor, formatScaleLabel } from './kodex-scale.js';

// Standard Exaprint 2026 (constaté sur les gabarits officiels de juillet
// 2026) : la page fait EXACTEMENT la taille du fond perdu — plus de marge
// à repères, plus de traits de coupe d'angle (« Enregistrez le pdf en
// haute qualité sans trait de coupe »). Les guides sont des cadres pleins
// et les plis des pointillés traversants. L'ancienne bande de 12 mm avec
// traits de coupe a été retirée le 2026-07-27.

export function mmToPx(mm, dpi = OUTPUT_DPI) {
  return Math.round(mm / 25.4 * dpi);
}

export function mmToPt(mm) {
  return mm / 25.4 * 72;
}

// ── Construction du TemplateSpec ──────────────────────────────
// std  : objet `standard` (specToStandard) — format_fini, bleed_mm,
//        safe_margin_mm, dpi, color_profile, export_format, vendor…
// opts : { category, productLabel, vendorLabel, face ('recto'|'verso'|null),
//          generatedAt (Date) }
export function buildTemplateSpec(std, opts = {}) {
  if (!std || !std.format_fini) return null;
  const f = std.format_fini;

  if (f.width_px && f.height_px) {
    return _digitalSpec(std, opts);
  }
  if (f.width_mm && f.height_mm) {
    return _printSpec(std, opts);
  }
  return null;
}

// ── Digital : canevas aux pixels exacts, rien d'autre ─────────
function _digitalSpec(std, opts) {
  const f = std.format_fini;
  return {
    kind: 'digital',
    colorMode: 'RGB',
    dpi: 72,
    face: null,                       // pas de recto/verso en digital
    productLabel: opts.productLabel || std.type_support || 'Visuel digital',
    vendorLabel: null,
    dimsLabel: `${f.width_px} × ${f.height_px} px`,
    canvas_px: { w: f.width_px, h: f.height_px },
    scale: { factor: 1, label: null },
    real: { w_mm: null, h_mm: null, bleed_mm: 0, safe_mm: 0 },
    colorProfile: std.color_profile || 'sRGB',
    exportFormat: std.export_format || 'JPG ou PNG haute qualité',
    notes: std.notes || '',
    generatedAt: opts.generatedAt || new Date(),
  };
}

// ── Roll-up (P3b) — anatomie spécifique, modèle gabarits Exaprint ──
// Pas de fond perdu ni de traits de coupe : TOUTE la surface s'imprime
// et se coupe au bord du canevas. Deux modèles cohabitent :
//   - NOUVEAU (gabarit officiel 2026, ex. 84×204) : plus d'amorces
//     dessinées, une seule zone TRANQUILLE ASYMÉTRIQUE (cadre vert,
//     safe_top/bottom/side_mm — le bas plus large avale le mécanisme) ;
//   - LEGACY (supports jamais re-mesurés) : zones d'AMORCE cyan pleines
//     + zone visible (cadre rouge) + retrait tranquille uniforme.
// Échelle de travail 1/4 (PSD) ; le PDF du kit se génère à l'échelle 1:1
// (exigence Exaprint 2026) via opts.workScale — cf. kodex-template-kit.
function _rollupSpec(std, opts) {
  const r = std.rollup;
  const workScale = r.work_scale || 0.25;
  const factor = opts.workScale || workScale;
  const total = r.total_mm || { w: std.format_fini.width_mm, h: std.format_fini.height_mm };

  const at = r.amorce_top_mm || 0, ab = r.amorce_bottom_mm || 0, as = r.amorce_side_mm || 0;
  const asym = (r.safe_top_mm != null || r.safe_bottom_mm != null || r.safe_side_mm != null);
  const safeInset = r.safe_inset_mm ?? 20;

  const canvasW = _r2(total.w * factor);
  const canvasH = _r2(total.h * factor);

  // Zones en mm de travail, origine haut-gauche du canevas
  const visibleBox = {
    x: _r2(as * factor), y: _r2(at * factor),
    w: _r2((total.w - 2 * as) * factor), h: _r2((total.h - at - ab) * factor),
  };
  let safeBox;
  if (asym) {
    const st = (r.safe_top_mm ?? 0) * factor, sb = (r.safe_bottom_mm ?? 0) * factor, ss = (r.safe_side_mm ?? 0) * factor;
    safeBox = { x: _r2(ss), y: _r2(st), w: _r2(canvasW - 2 * ss), h: _r2(canvasH - st - sb) };
  } else {
    const s = safeInset * factor;
    safeBox = { x: _r2(visibleBox.x + s), y: _r2(visibleBox.y + s), w: _r2(visibleBox.w - 2 * s), h: _r2(visibleBox.h - 2 * s) };
  }

  const amorces = [];
  if (at) amorces.push({ x: 0, y: 0, w: canvasW, h: _r2(at * factor) });
  if (ab) amorces.push({ x: 0, y: _r2(canvasH - ab * factor), w: canvasW, h: _r2(ab * factor) });
  if (as) {
    amorces.push({ x: 0, y: 0, w: _r2(as * factor), h: canvasH });
    amorces.push({ x: _r2(canvasW - as * factor), y: 0, w: _r2(as * factor), h: canvasH });
  }

  const dpi = OUTPUT_DPI;
  return {
    kind: 'print',
    colorMode: 'CMYK',
    dpi,
    face: opts.face || null,
    productLabel: opts.productLabel || std.type_support || 'Roll-up',
    vendorLabel: ('vendorLabel' in opts) ? (opts.vendorLabel || null) : (std.vendor || null),
    dimsLabel: `${(total.w / 10).toFixed(0)} × ${(total.h / 10).toFixed(0)} cm (surface totale)`,
    canvas_mm: { w: canvasW, h: canvasH },
    canvas_px: { w: mmToPx(canvasW, dpi), h: mmToPx(canvasH, dpi) },
    // Toute la surface s'imprime : trim = bleed = canevas entier
    bleedBox: { x: 0, y: 0, w: canvasW, h: canvasH },
    trimBox:  { x: 0, y: 0, w: canvasW, h: canvasH },
    safeBox,
    cropMarks: [],
    folds: null,
    marksMargin: 0,
    rollup: {
      visibleBox,
      amorces,
      amorce_top_mm: at, amorce_bottom_mm: ab, amorce_side_mm: as,
      safe_inset_mm: safeInset,
      // Modèle 2026 : zone tranquille asymétrique (null = modèle legacy)
      safe_top_mm: asym ? (r.safe_top_mm ?? 0) : null,
      safe_bottom_mm: asym ? (r.safe_bottom_mm ?? 0) : null,
      safe_side_mm: asym ? (r.safe_side_mm ?? 0) : null,
      work_scale: workScale,
    },
    scale: { factor, label: factor < 1 ? formatScaleLabel(factor) : null },
    real: { w_mm: total.w, h_mm: total.h, bleed_mm: 0, safe_mm: asym ? (r.safe_side_mm ?? 0) : safeInset },
    colorProfile: std.color_profile || 'CMJN (FOGRA39 ou équivalent)',
    exportFormat: std.export_format || 'PDF/X-4 ou TIFF haute définition',
    notes: std.notes || '',
    generatedAt: opts.generatedAt || new Date(),
  };
}

// ── Print / presse / grand format ─────────────────────────────
// Toutes les zones en mm DE TRAVAIL (déjà à l'échelle réduite pour
// le grand format). Origine (0,0) = coin haut-gauche du canevas.
function _printSpec(std, opts) {
  if (std.rollup) return _rollupSpec(std, opts);
  const f = std.format_fini;
  const factor = computeScaleFactor(std);

  const realW = f.width_mm, realH = f.height_mm;
  const realBleed = std.bleed_mm ?? 0;
  const realSafe  = std.safe_margin_mm ?? 0;

  // Échelle de travail appliquée à tout ce qui s'imprime.
  const trimW = _r2(realW * factor);
  const trimH = _r2(realH * factor);
  const bleed = _r2(realBleed * factor);
  const safe  = _r2(realSafe * factor);

  // Standard 2026 : la page = la taille du fond perdu, rien autour.
  const canvasW = _r2(trimW + 2 * bleed);
  const canvasH = _r2(trimH + 2 * bleed);

  // Boîtes en coordonnées canevas (mm, origine haut-gauche).
  const bleedBox = { x: 0, y: 0, w: canvasW, h: canvasH };
  const trimBox  = { x: bleed, y: bleed, w: trimW, h: trimH };
  const safeBox  = { x: _r2(trimBox.x + safe), y: _r2(trimBox.y + safe), w: _r2(trimW - 2 * safe), h: _r2(trimH - 2 * safe) };

  const dpi = OUTPUT_DPI;             // jamais dégradé (cf. kodex-scale)

  const dimsLabel = (realW >= 1000 || realH >= 1000)
    ? `${(realW / 10).toFixed(0)} × ${(realH / 10).toFixed(0)} cm`
    : `${realW} × ${realH} mm`;

  // Plis (P3) : calculés sur les cotes RÉELLES puis mis à l'échelle.
  // Les positions sont en coordonnées canevas (comme les boîtes) ;
  // `panels` reste en mm réels pour les labels et le LISEZMOI.
  let folds = null;
  if (opts.foldType && opts.foldType !== 'none') {
    const raw = computeFolds(opts.foldType, realW, realH, opts.face || 'recto');
    if (raw) {
      folds = {
        ...raw,
        vertical:   raw.vertical.map(x => _r2(trimBox.x + x * factor)),
        horizontal: raw.horizontal.map(y => _r2(trimBox.y + y * factor)),
      };
    }
  }

  return {
    kind: 'print',
    colorMode: 'CMYK',
    dpi,
    face: opts.face || null,
    productLabel: opts.productLabel || std.type_support || std.product_name || 'Support imprimé',
    // Un vendorLabel EXPLICITEMENT null signifie « pas d'imprimeur connu »
    // (le pseudo-label « Je ne sais pas encore » de std.vendor ne doit
    // apparaître ni dans les gabarits ni dans les noms de fichiers).
    vendorLabel: ('vendorLabel' in opts) ? (opts.vendorLabel || null) : (std.vendor || null),
    dimsLabel,
    // Canevas de travail (mm + px à 300 DPI pour le PSD)
    canvas_mm: { w: canvasW, h: canvasH },
    canvas_px: { w: mmToPx(canvasW, dpi), h: mmToPx(canvasH, dpi) },
    // Zones (mm de travail, origine haut-gauche du canevas)
    bleedBox, trimBox, safeBox,
    cropMarks: [],            // standard 2026 : « sans trait de coupe »
    folds,
    marksMargin: 0,
    // Échelle de travail (grand format) — silencieuse côté UI
    scale: {
      factor,
      label: factor < 1 ? formatScaleLabel(factor) : null,
    },
    // Valeurs réelles pour les labels et le LISEZMOI
    real: { w_mm: realW, h_mm: realH, bleed_mm: realBleed, safe_mm: realSafe },
    colorProfile: std.color_profile || 'CMJN (FOGRA39 ou équivalent)',
    exportFormat: std.export_format || 'PDF/X-1a:2001 ou PDF/X-4',
    notes: std.notes || '',
    generatedAt: opts.generatedAt || new Date(),
  };
}

function _r2(n) {
  return Math.round(n * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════
// PLIS (P3) — savoir extrait des gabarits Exaprint (série A4, juil. 2026)
// ─────────────────────────────────────────────────────────────
// Chaque schéma définit la position des plis sur le FORMAT OUVERT.
// Points clés du métier :
//   - roulés : les volets qui rentrent sont PLUS COURTS (réductions
//     en mm ABSOLUS : -3 mm pour le 1er rentrant, -4 mm pour le 2e),
//     et le verso est le MIROIR du recto (la feuille est retournée) ;
//   - portefeuille : les 2 volets extérieurs font -1,5 mm ;
//   - croisé : seul schéma avec un pli horizontal (H/2) en plus ;
//   - éco : plié en 2 puis encore en 2 → 3 marques de plis.
// Les plis se marquent en POINTILLÉS MAGENTA dans les marges,
// jamais sur la zone de création.
// Formats portrait (h > w) : le schéma s'applique sur la hauteur
// (plis horizontaux) — à confirmer avec la série 2/2 de gabarits.
// ═══════════════════════════════════════════════════════════════
export const FOLD_SCHEMES = [
  { id: 'none',           label: 'Sans pli',            plis: 0 },
  { id: 'central',        label: '1 pli central',       plis: 1 },
  { id: 'roule-2',        label: '2 plis roulés',       plis: 2 },
  { id: 'accordeon-2',    label: '2 plis accordéon',    plis: 2 },
  { id: 'fenetre',        label: '2 plis fenêtre',      plis: 2 },
  { id: 'eco',            label: '2 plis économiques',  plis: 2 },
  { id: 'croise',         label: '2 plis croisés',      plis: 2 },
  { id: 'roule-3',        label: '3 plis roulés',       plis: 3 },
  { id: 'accordeon-3',    label: '3 plis accordéon',    plis: 3 },
  { id: 'portefeuille',   label: '3 plis portefeuille', plis: 3 },
];

export function getFoldScheme(id) {
  return FOLD_SCHEMES.find(s => s.id === id) || null;
}

// Largeurs de volets (mm, de gauche à droite au RECTO) pour une
// largeur ouverte `w`. Les réductions des roulés sont en mm absolus
// (constat Exaprint : identiques en A4 quel que soit le volet).
function _foldPanels(schemeId, w) {
  switch (schemeId) {
    case 'central':      return [w / 2, w / 2];
    case 'accordeon-2':  return [w / 3, w / 3, w / 3];
    case 'accordeon-3':  return [w / 4, w / 4, w / 4, w / 4];
    case 'eco':          return [w / 4, w / 4, w / 4, w / 4];
    case 'fenetre':      return [w / 4, w / 2, w / 4];
    case 'portefeuille': {
      const f = w / 4 - 1.5, c = w / 4 + 1.5;
      return [f, c, c, f];
    }
    case 'roule-2': {
      const p = (w + 3) / 3;                 // rentrant -3, à gauche au recto
      return [p - 3, p, p];
    }
    case 'roule-3': {
      const p = (w + 7) / 4;                 // rentrants -4 puis -3
      return [p - 4, p - 3, p, p];
    }
    case 'croise':       return [w / 2, w / 2];
    default:             return [w];
  }
}

// Calcule les plis pour un schéma sur un format ouvert w×h (mm).
//   face : 'recto' | 'verso' — les schémas asymétriques (roulés)
//          sont mis en miroir au verso.
// Retour : { vertical: [x…], horizontal: [y…], panels: [mm…],
//            label, asymmetric } — positions relatives au TRIM.
// Les plis sont TOUJOURS verticaux (les volets se suivent sur la
// largeur), quelle que soit l'orientation du format — décision
// Stéphane juil. 2026 : le pli « en hauteur » n'existe pratiquement
// pas en imprimerie. Seul le croisé ajoute son pli horizontal (H/2).
export function computeFolds(schemeId, w, h, face = 'recto') {
  const scheme = getFoldScheme(schemeId);
  if (!scheme || scheme.id === 'none') return null;

  let panels = _foldPanels(scheme.id, w);
  const asymmetric = scheme.id.startsWith('roule');
  if (asymmetric && face === 'verso') panels = [...panels].reverse();

  const cuts = [];
  let acc = 0;
  for (let i = 0; i < panels.length - 1; i++) {
    acc += panels[i];
    cuts.push(Math.round(acc * 100) / 100);
  }

  return {
    scheme: scheme.id,
    label: scheme.label,
    asymmetric,
    panels: panels.map(p => Math.round(p * 100) / 100),
    vertical: cuts,
    // Croisé : pli perpendiculaire en plus, au milieu de la hauteur
    horizontal: scheme.id === 'croise' ? [Math.round(h / 2 * 100) / 100] : [],
  };
}

// ── Lignes d'information du calque technique / LISEZMOI ───────
export function templateInfoLines(spec) {
  if (!spec) return [];
  const lines = [];
  lines.push(`${spec.productLabel}${spec.face ? ` — ${spec.face === 'verso' ? 'Verso' : 'Recto'}` : ''}`);
  lines.push(`Format fini : ${spec.dimsLabel}`);
  if (spec.kind === 'print' && spec.rollup) {
    const r = spec.rollup;
    lines.push(`TOUTE la surface doit être imprimée (pas de fond perdu, coupe au bord)`);
    if (r.safe_top_mm != null) {
      // Modèle 2026 : une seule zone tranquille, asymétrique
      lines.push(`Zone tranquille (cadre vert) : ${r.safe_side_mm} mm latérales · ${r.safe_top_mm} mm en haut · ${r.safe_bottom_mm} mm en bas`);
      lines.push(`Le bas est avalé par le mécanisme : prolongez-y le fond, jamais de contenu`);
    } else {
      if (r.amorce_bottom_mm) lines.push(`Zone d'amorce basse : ${r.amorce_bottom_mm} mm (cyan plein — masquée par le mécanisme, prolongez-y votre fond)`);
      if (r.amorce_top_mm) lines.push(`Zone d'amorce haute : ${r.amorce_top_mm} mm (cyan plein)`);
      if (r.amorce_side_mm) lines.push(`Amorces latérales : ${r.amorce_side_mm} mm de chaque côté (cyan plein)`);
      lines.push(`Zone visible : cadre rouge`);
      lines.push(`Zone tranquille : ${r.safe_inset_mm} mm (cadre vert — textes et logos à l'intérieur)`);
    }
    lines.push(`Résolution : ${spec.dpi} DPI · ${spec.colorProfile}`);
    if (spec.scale.label) lines.push(`Document à l'${spec.scale.label.toLowerCase()} — l'imprimeur agrandit à la sortie`);
    else lines.push(`Document à l'échelle 1:1 (exigence imprimeur)`);
    if (spec.vendorLabel) lines.push(`Imprimeur : ${spec.vendorLabel}`);
    lines.push(`Export attendu : ${spec.exportFormat}`);
    return lines;
  }
  if (spec.kind === 'print') {
    if (spec.real.bleed_mm) lines.push(`Fond perdu : ${spec.real.bleed_mm} mm (cadre cyan)`);
    lines.push(`Ligne de coupe : cadre rouge`);
    if (spec.real.safe_mm) lines.push(`Zone de sécurité : ${spec.real.safe_mm} mm (cadre vert — textes et logos à l'intérieur)`);
    if (spec.folds) {
      lines.push(`Pliage : ${spec.folds.label} — volets ${spec.folds.panels.map(p => Number.isInteger(p) ? p : p.toFixed(2).replace('.', ',')).join(' / ')} mm (traits magenta = plis)`);
      if (spec.folds.asymmetric) {
        lines.push(`Volet rentrant plus court — le verso est le miroir du recto, respectez les traits de chaque face`);
      }
    }
    lines.push(`Résolution : ${spec.dpi} DPI · ${spec.colorProfile}`);
    if (spec.scale.label) lines.push(`Document à l'${spec.scale.label.toLowerCase()} — l'imprimeur agrandit à la sortie`);
  } else {
    lines.push(`Couleurs : ${spec.colorProfile}`);
  }
  if (spec.vendorLabel) lines.push(`Imprimeur : ${spec.vendorLabel}`);
  lines.push(`Export attendu : ${spec.exportFormat}`);
  return lines;
}

// ── Nommage des fichiers du kit ───────────────────────────────
// Gabarit_<Produit>_<dims>_<Imprimeur>_<date>[_Recto|_Verso].<ext>
export function kitBaseName(spec) {
  const parts = ['Gabarit', _slug(spec.productLabel)];
  const dims = spec.kind === 'digital'
    ? `${spec.canvas_px.w}x${spec.canvas_px.h}px`
    : `${_num(spec.real.w_mm)}x${_num(spec.real.h_mm)}mm`;
  parts.push(dims);
  if (spec.vendorLabel) parts.push(_slug(spec.vendorLabel));
  parts.push(_isoDate(spec.generatedAt));
  return parts.join('_');
}

export function kitFileName(spec, ext) {
  const face = spec.face ? (spec.face === 'verso' ? '_Verso' : '_Recto') : '';
  return `${kitBaseName(spec)}${face}.${ext}`;
}

function _num(n) {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}

function _isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Slug lisible : accents retirés, espaces → tirets, pas de caractères
// exotiques (certains RIP d'imprimeurs refusent les noms accentués).
function _slug(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'Support';
}
