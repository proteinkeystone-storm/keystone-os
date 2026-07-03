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
