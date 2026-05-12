/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — SDQR Custom Renderer (Sprint SDQR-3)
   Moteur de rendu SVG custom : on n'utilise plus createSvgTag() de
   qrcode-generator (rendu monolithique noir/blanc). À la place, on
   itère sur les modules via isDark(row, col) et on dessine nous-même
   chaque cellule selon le design demandé.

   Pourquoi du SVG natif vs canvas ?
     - SVG = vecteur → export print propre (impression bâche, carte)
     - Pas de blur sur retina, scaling parfait
     - On peut animer (hover preview...) sans repaint

   Design schema (stocké dans qr.design) :
     {
       module : { shape: 'square' | 'dot' | 'rounded' },
       anchor : { shape: 'square' | 'dot' | 'rounded' },
       fg     : '#000000',                    // couleur principale
       bg     : '#ffffff',                    // fond ('transparent' = pas de rect)
       gradient: {
         enabled: false,
         from   : '#1B2A4A',
         to     : '#c9a84c',
         angle  : 45                          // degrés (0 = →, 90 = ↓)
       },
       logo   : {
         dataUrl: 'data:image/png;base64,...',
         size   : 0.20                        // ratio du QR (15-25%)
       }
     }
   ═══════════════════════════════════════════════════════════════ */

const QR_CDN = 'https://esm.sh/qrcode-generator@1.4.4';
let _qrLib = null;

async function _loadQrLib() {
  if (_qrLib) return _qrLib;
  const mod = await import(QR_CDN);
  _qrLib = mod.default || mod;
  return _qrLib;
}

// ── Design par défaut (utilisé si l'entité n'a rien de spécifique) ──
export const DEFAULT_DESIGN = {
  module : { shape: 'square' },
  anchor : { shape: 'square' },
  fg     : '#000000',
  bg     : '#ffffff',
  gradient: { enabled: false, from: '#1B2A4A', to: '#c9a84c', angle: 45 },
  logo   : { dataUrl: '', size: 0.20 },
};

// Merge sûr : si design est partial (depuis D1), on complète avec DEFAULT
export function mergeDesign(design) {
  const d = design || {};
  return {
    module  : { ...DEFAULT_DESIGN.module,   ...(d.module   || {}) },
    anchor  : { ...DEFAULT_DESIGN.anchor,   ...(d.anchor   || {}) },
    fg      : d.fg || DEFAULT_DESIGN.fg,
    bg      : d.bg || DEFAULT_DESIGN.bg,
    gradient: { ...DEFAULT_DESIGN.gradient, ...(d.gradient || {}) },
    logo    : { ...DEFAULT_DESIGN.logo,     ...(d.logo     || {}) },
  };
}

// ── Détection des 3 finder patterns (ancres) ───────────────────
// Les finder patterns occupent 8x8 modules dans les 3 coins (TL, TR, BL).
// On les identifie par coordonnées pour les exclure du rendu standard
// et leur appliquer la forme `anchor.shape`.
function _isAnchorArea(row, col, count) {
  if (row < 8 && col < 8) return 'tl';                        // top-left
  if (row < 8 && col >= count - 8) return 'tr';               // top-right
  if (row >= count - 8 && col < 8) return 'bl';               // bottom-left
  return null;
}

// Origine (row, col) des 3 finder patterns (chaque ancre = bloc 7x7)
function _anchorOrigins(count) {
  return [
    { row: 0,         col: 0,         which: 'tl' },
    { row: 0,         col: count - 7, which: 'tr' },
    { row: count - 7, col: 0,         which: 'bl' },
  ];
}

// Cellule = un module standard. Retourne le path SVG selon la forme.
function _moduleShape(shape, x, y, cell) {
  switch (shape) {
    case 'dot':
      // cercle inscrit avec léger inset pour aération
      const cx = x + cell / 2;
      const cy = y + cell / 2;
      const r  = cell * 0.42;
      return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}"/>`;
    case 'rounded':
      // arrondi modéré : rx = cell * 0.30
      const rr = (cell * 0.30).toFixed(2);
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${rr}" ry="${rr}"/>`;
    case 'square':
    default:
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
  }
}

// Une ancre = 7x7 modules. On dessine :
//   - cadre extérieur (anneau 7x7 - 5x5)
//   - point central 3x3
// Forme appliquée selon design.anchor.shape.
function _anchorShape(shape, ox, oy, cell) {
  const size = 7 * cell;
  const innerOffset = 2 * cell;
  const innerSize   = 3 * cell;

  if (shape === 'dot') {
    // Anneau circulaire + cercle plein au centre
    const cx = ox + size / 2;
    const cy = oy + size / 2;
    const outerR = size / 2 - cell * 0.05;
    const ringR  = size / 2 - cell;
    const innerR = innerSize / 2;
    // Anneau = disque externe - disque interne via fill-rule
    return `
      <path d="M ${cx},${cy - outerR} a ${outerR},${outerR} 0 1,0 0.1,0 z
               M ${cx},${cy - ringR} a ${ringR},${ringR} 0 1,1 -0.1,0 z" fill-rule="evenodd"/>
      <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${innerR.toFixed(2)}"/>
    `;
  }

  if (shape === 'rounded') {
    // Coin arrondi modéré (cell * 1.2)
    const rr = (cell * 1.2).toFixed(2);
    const innerR = (cell * 0.55).toFixed(2);
    // Anneau via path : carré arrondi extérieur + carré arrondi intérieur (fill-rule)
    const oRect = `M ${ox},${oy + cell * 1.2}
                   a ${rr} ${rr} 0 0 1 ${rr} -${rr}
                   h ${(size - 2 * cell * 1.2).toFixed(2)}
                   a ${rr} ${rr} 0 0 1 ${rr} ${rr}
                   v ${(size - 2 * cell * 1.2).toFixed(2)}
                   a ${rr} ${rr} 0 0 1 -${rr} ${rr}
                   h -${(size - 2 * cell * 1.2).toFixed(2)}
                   a ${rr} ${rr} 0 0 1 -${rr} -${rr}
                   z`;
    const iSize = size - 2 * cell;
    const iRr = (cell * 0.7).toFixed(2);
    const iRect = `M ${ox + cell},${oy + cell + iRr}
                   a ${iRr} ${iRr} 0 0 1 ${iRr} -${iRr}
                   h ${(iSize - 2 * iRr).toFixed(2)}
                   a ${iRr} ${iRr} 0 0 1 ${iRr} ${iRr}
                   v ${(iSize - 2 * iRr).toFixed(2)}
                   a ${iRr} ${iRr} 0 0 1 -${iRr} ${iRr}
                   h -${(iSize - 2 * iRr).toFixed(2)}
                   a ${iRr} ${iRr} 0 0 1 -${iRr} -${iRr}
                   z`;
    return `
      <path d="${oRect} ${iRect}" fill-rule="evenodd"/>
      <rect x="${(ox + innerOffset).toFixed(2)}" y="${(oy + innerOffset).toFixed(2)}" width="${innerSize.toFixed(2)}" height="${innerSize.toFixed(2)}" rx="${innerR}" ry="${innerR}"/>
    `;
  }

  // Square (défaut)
  const innerX = ox + innerOffset;
  const innerY = oy + innerOffset;
  return `
    <path d="M ${ox},${oy} h ${size} v ${size} h ${-size} z
             M ${(ox + cell).toFixed(2)},${(oy + cell).toFixed(2)} v ${5 * cell} h ${5 * cell} v ${-5 * cell} z" fill-rule="evenodd"/>
    <rect x="${innerX.toFixed(2)}" y="${innerY.toFixed(2)}" width="${innerSize.toFixed(2)}" height="${innerSize.toFixed(2)}"/>
  `;
}

// ── Rendu principal ────────────────────────────────────────────

export async function renderQrCustom(text, design, sizePx = 280) {
  const qrcode = await _loadQrLib();
  const d = mergeDesign(design);

  // ECC 'H' (highest) si logo central → plus de redondance, scanner OK
  // même si 20% des modules sont occlus.
  const ecc = (d.logo?.dataUrl) ? 'H' : 'M';
  const qr = qrcode(0, ecc);
  qr.addData(text || ' ');
  qr.make();

  const count   = qr.getModuleCount();
  const margin  = 2;                                      // 2 modules de quiet zone
  const totalMods = count + margin * 2;
  const cell    = sizePx / totalMods;
  const offset  = margin * cell;

  // Couleur ou gradient → fill
  const useGradient = d.gradient?.enabled;
  const gradientId  = 'qrgrad_' + Math.random().toString(36).slice(2, 8);
  const fgFill = useGradient ? `url(#${gradientId})` : d.fg;

  // 1. Background
  let bg = '';
  if (d.bg && d.bg !== 'transparent') {
    bg = `<rect width="${sizePx}" height="${sizePx}" fill="${_esc(d.bg)}"/>`;
  }

  // 2. Definitions (gradient + clip pour logo)
  let defs = '';
  if (useGradient) {
    // angle 0 = horizontal (left→right), 90 = vertical (top→bottom)
    const rad = (d.gradient.angle || 45) * Math.PI / 180;
    const x1 = (0.5 - 0.5 * Math.cos(rad)) * 100;
    const y1 = (0.5 - 0.5 * Math.sin(rad)) * 100;
    const x2 = (0.5 + 0.5 * Math.cos(rad)) * 100;
    const y2 = (0.5 + 0.5 * Math.sin(rad)) * 100;
    defs += `
      <linearGradient id="${gradientId}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
        <stop offset="0%" stop-color="${_esc(d.gradient.from)}"/>
        <stop offset="100%" stop-color="${_esc(d.gradient.to)}"/>
      </linearGradient>
    `;
  }

  // 3. Modules standards (hors zones d'ancres)
  let modules = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (_isAnchorArea(row, col, count)) continue;
      if (!qr.isDark(row, col)) continue;
      const x = offset + col * cell;
      const y = offset + row * cell;
      modules += _moduleShape(d.module.shape, x, y, cell);
    }
  }

  // 4. Ancres (3 finder patterns)
  let anchors = '';
  for (const o of _anchorOrigins(count)) {
    const ox = offset + o.col * cell;
    const oy = offset + o.row * cell;
    anchors += _anchorShape(d.anchor.shape, ox, oy, cell);
  }

  // 5. Logo central (avec masque circulaire blanc autour pour contraste scan)
  let logoBlock = '';
  if (d.logo?.dataUrl) {
    const ratio = Math.min(0.30, Math.max(0.10, d.logo.size || 0.20));
    const logoSize = sizePx * ratio;
    const logoMaskSize = logoSize * 1.15;       // 15% de marge blanche autour
    const lx = (sizePx - logoSize) / 2;
    const ly = (sizePx - logoSize) / 2;
    const mx = sizePx / 2;
    const my = sizePx / 2;
    logoBlock = `
      <circle cx="${mx}" cy="${my}" r="${logoMaskSize / 2}" fill="${_esc(d.bg && d.bg !== 'transparent' ? d.bg : '#ffffff')}"/>
      <image href="${_esc(d.logo.dataUrl)}" x="${lx}" y="${ly}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>
    `;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${sizePx} ${sizePx}">
      ${defs ? `<defs>${defs}</defs>` : ''}
      ${bg}
      <g fill="${fgFill}">
        ${modules}
        ${anchors}
      </g>
      ${logoBlock}
    </svg>
  `;
}

// ── Contrast checker (WCAG-style) ──────────────────────────────
// Renvoie le ratio de luminance entre fg et bg (1 = no contrast,
// 21 = max). Seuil scannabilité QR pratique : >= 3:1. WCAG AA texte
// normal demande 4.5:1 mais les scanners QR sont plus tolérants.

function _luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const f = c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(fgHex, bgHex) {
  const L1 = _luminance(fgHex);
  const L2 = _luminance(bgHex);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

// Renvoie 'ok' (>=3:1), 'warn' (2-3:1), 'bad' (<2:1)
export function contrastLevel(fgHex, bgHex) {
  const r = contrastRatio(fgHex, bgHex);
  if (r >= 3)   return 'ok';
  if (r >= 2)   return 'warn';
  return 'bad';
}

// ── Utils ─────────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}
