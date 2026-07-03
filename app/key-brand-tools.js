// ═══════════════════════════════════════════════════════════════
// KEY BRAND — outils purs (KB-1) · préfixe kb
//
// Fonctions de calcul SANS état ni DOM persistant, utilisées par
// app/key-brand.js (et plus tard par la page publique /b/) :
//   - exportLogoPng  : SVG/PNG/JPG/WebP → PNG à la taille demandée (canvas)
//   - buildZip       : archive .zip sans compression (aucune dépendance)
//   - svgLooksSafe   : mêmes règles que le sanitizer serveur (double contrôle)
//
// ZÉRO IA, zéro réseau : tout se passe dans le navigateur.
// ═══════════════════════════════════════════════════════════════

// ── Sanitizer SVG (miroir des règles serveur, key-brand.js worker) ──
const SVG_DANGERS = [
  /<\s*script/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /<\s*(foreignObject|iframe|embed|object)/i,
  /href\s*=\s*["']\s*(?:https?:)?\/\//i,
];
export function svgLooksSafe(text) {
  return !!text && !SVG_DANGERS.some(rx => rx.test(text));
}

// ── Export PNG ──────────────────────────────────────────────────
// Un SVG sans width/height intrinsèques a naturalWidth=0 et se rastérise
// mal : on réécrit la racine <svg> avec des dimensions calculées depuis
// le viewBox AVANT de charger l'image.
function _svgWithSize(text, targetW) {
  const vb = text.match(/viewBox\s*=\s*["']\s*([\d.eE+-]+)[ ,]+([\d.eE+-]+)[ ,]+([\d.eE+-]+)[ ,]+([\d.eE+-]+)/);
  let ratio = 1;
  if (vb) {
    const w = parseFloat(vb[3]), h = parseFloat(vb[4]);
    if (w > 0 && h > 0) ratio = h / w;
  } else {
    const mw = text.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i);
    const mh = text.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i);
    if (mw && mh && parseFloat(mw[1]) > 0) ratio = parseFloat(mh[1]) / parseFloat(mw[1]);
  }
  const targetH = Math.max(1, Math.round(targetW * ratio));
  const cleaned = text.replace(/<svg([^>]*?)\s(width|height)\s*=\s*["'][^"']*["']/gi, '<svg$1')
                      .replace(/<svg([^>]*?)\s(width|height)\s*=\s*["'][^"']*["']/gi, '<svg$1');
  const sized = cleaned.replace(/<svg/i, `<svg width="${targetW}" height="${targetH}"`);
  return { text: sized, width: targetW, height: targetH };
}

function _loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = url;
  });
}

/**
 * Convertit un logo (Blob SVG/PNG/JPG/WebP) en PNG.
 * @param {Blob}   blob   fichier source
 * @param {string} mime   content-type source
 * @param {object} opts   { width: px cible, bg: null (transparent) | '#rrggbb' }
 * @returns {Promise<Blob>} PNG
 */
export async function exportLogoPng(blob, mime, { width = 1024, bg = null } = {}) {
  width = Math.max(16, Math.min(6000, Math.round(width)));
  let url, revoke = null, w = width, h = null;
  if (mime === 'image/svg+xml') {
    const sized = _svgWithSize(await blob.text(), width);
    url = URL.createObjectURL(new Blob([sized.text], { type: 'image/svg+xml' }));
    revoke = url; h = sized.height;
  } else {
    url = URL.createObjectURL(blob);
    revoke = url;
  }
  try {
    const img = await _loadImage(url);
    const iw = img.naturalWidth || w, ih = img.naturalHeight || h || w;
    if (h === null) h = Math.max(1, Math.round(width * ih / iw));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Export PNG impossible')), 'image/png'));
  } finally {
    if (revoke) URL.revokeObjectURL(revoke);
  }
}

// ── Archive .zip (méthode « store », sans compression) ──────────
// Suffisant pour un kit de logos (SVG/PNG déjà compacts) et évite toute
// dépendance. Spec PKZIP : en-têtes locaux + répertoire central + EOCD.
let _crcTable = null;
function _crc32(u8) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = _crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Construit un .zip (store) à partir de [{ name, data: Uint8Array }].
 * Les noms sont encodés UTF-8 (drapeau bit 11 posé).
 * @returns {Blob} archive
 */
export function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  const u16 = v => new Uint8Array([v & 255, (v >> 8) & 255]);
  const u32 = v => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);

  for (const f of files) {
    const nameU8 = enc.encode(f.name);
    const data = f.data;
    const crc = _crc32(data);
    const local = [
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(data.length), u32(data.length), u16(nameU8.length), u16(0),
      nameU8, data,
    ];
    const localLen = local.reduce((s, p) => s + p.length, 0);
    central.push({ nameU8, crc, size: data.length, offset });
    parts.push(...local);
    offset += localLen;
  }
  const cdStart = offset;
  for (const c of central) {
    parts.push(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(c.crc), u32(c.size), u32(c.size), u16(c.nameU8.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(c.offset), c.nameU8,
    );
    offset += 46 + c.nameU8.length;
  }
  parts.push(
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(offset - cdStart), u32(cdStart), u16(0),
  );
  return new Blob(parts, { type: 'application/zip' });
}

// ════════════════════════════════════════════════════════════════
// KB-2 — Théorie des couleurs, WCAG & daltonisme (pur calcul)
// ════════════════════════════════════════════════════════════════

// ── Conversions ──
export function hexToRgb(hex) {
  const m = String(hex || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function rgbToHex({ r, g, b }) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
export function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
// CMJN INDICATIF (conversion naïve sans profil ICC — le graphiste peut
// saisir ses vraies valeurs ; l'UI doit le présenter comme approximatif).
export function rgbToCmyk({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const f = v => Math.round(((1 - v - k) / (1 - k)) * 100);
  return { c: f(r), m: f(g), y: f(b), k: Math.round(k * 100) };
}

// ── WCAG 2.x ──
function _lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
export function relLuminance(rgb) {
  return 0.2126 * _lin(rgb.r) + 0.7152 * _lin(rgb.g) + 0.0722 * _lin(rgb.b);
}
/** Ratio de contraste WCAG entre deux hex (1 → 21). */
export function contrastRatio(hexA, hexB) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  if (!a || !b) return null;
  const la = relLuminance(a), lb = relLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
/** Verdicts WCAG pour un ratio donné. */
export function wcagVerdict(ratio) {
  return {
    aaNormal: ratio >= 4.5, aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,  aaaLarge: ratio >= 4.5,
  };
}

// ── Harmonies (proposées, jamais imposées) ──
export function harmonies(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);
  const at = (dh, ds = 0, dl = 0) => rgbToHex(hslToRgb({ h: hsl.h + dh, s: hsl.s + ds, l: hsl.l + dl }));
  return {
    complementaire: [at(180)],
    analogues:      [at(-30), at(30)],
    triade:         [at(-120), at(120)],
    nuances:        [at(0, 0, +28), at(0, 0, +14), at(0, 0, -14), at(0, 0, -26)],
    sourdine:       [at(0, -34, +8), at(0, -50, +18)],
  };
}

// ── Daltonisme (simulation indicative, matrices usuelles) ──
const CB_MATRICES = {
  protanopia:   [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
  deuteranopia: [0.625, 0.375, 0, 0.700, 0.300, 0, 0, 0.300, 0.700],
  tritanopia:   [0.950, 0.050, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
};
export function simulateColorBlind(hex, type) {
  const rgb = hexToRgb(hex);
  const m = CB_MATRICES[type];
  if (!rgb || !m) return hex;
  return rgbToHex({
    r: m[0] * rgb.r + m[1] * rgb.g + m[2] * rgb.b,
    g: m[3] * rgb.r + m[4] * rgb.g + m[5] * rgb.b,
    b: m[6] * rgb.r + m[7] * rgb.g + m[8] * rgb.b,
  });
}

// ── Divers ──────────────────────────────────────────────────────
/** Déclenche le téléchargement d'un Blob sous le nom donné. */
export function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/** Nom de fichier sûr (accents permis, séparateurs retirés). */
export function safeFilename(name, fallback = 'fichier') {
  return (String(name || '').replace(/[/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)) || fallback;
}
