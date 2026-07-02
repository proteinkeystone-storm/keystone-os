/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Template PSD (P1 refonte Brief Prod)
   ─────────────────────────────────────────────────────────────
   Writer PSD from scratch (zéro dépendance) pour les gabarits.

   Reproduit l'anatomie du gabarit imprimeur professionnel
   (modèle : PSD Exaprint carte de visite) :
     - print/presse/grand format : mode CMJN 8 bits, 300 DPI,
       cotes exactes (canevas de travail = trim + fond perdu +
       marges de repères), guides Photoshop posés sur fond
       perdu / coupe / zone de sécurité
     - digital : mode RVB 8 bits, 72 DPI, canevas aux pixels exacts
     - 2 calques : « Votre visuel » (fond blanc, la création se
       fait dessus) + « Infos techniques » (cadres et traits de
       coupe — à masquer avant l'export final)

   Les couleurs des repères sont posées en ENCRE CMJN pure
   (cyan 100 % = fond perdu, rouge M+J 100 % = coupe, vert C+J
   100 % = sécurité) — pas de conversion colorimétrique douteuse.

   API :
     buildTemplatePsd(spec, opts?) → Uint8Array
       opts.overlayRGBA : {w, h, data} — surcouche optionnelle
       (texte rendu au canvas côté navigateur) fusionnée dans le
       calque « Infos techniques ».
   ═══════════════════════════════════════════════════════════════ */

import { templateInfoLines } from './kodex-template-geometry.js';

// ── Palette (indices du raster) ───────────────────────────────
// ink = [C,M,Y,K] 0-255 ; rgb = équivalent écran pour le mode RVB.
const PALETTE = [
  { name: 'transparent', ink: [0, 0, 0, 0],       rgb: [255, 255, 255], alpha: 0 },
  { name: 'blanc',       ink: [0, 0, 0, 0],       rgb: [255, 255, 255], alpha: 255 },
  { name: 'cyan',        ink: [255, 0, 0, 0],     rgb: [0, 174, 239],   alpha: 255 },
  { name: 'rouge',       ink: [0, 255, 255, 0],   rgb: [237, 28, 36],   alpha: 255 },
  { name: 'vert',        ink: [255, 0, 255, 0],   rgb: [0, 166, 81],    alpha: 255 },
  { name: 'noir',        ink: [0, 0, 0, 255],     rgb: [0, 0, 0],       alpha: 255 },
  { name: 'gris',        ink: [0, 0, 0, 140],     rgb: [115, 115, 115], alpha: 255 },
  { name: 'magenta',     ink: [0, 255, 0, 0],     rgb: [236, 0, 140],   alpha: 255 },
];
const T = 0, WHITE = 1, CYAN = 2, RED = 3, GREEN = 4, BLACK = 5, MAGENTA = 7;

// ═══════════════════════════════════════════════════════════════
// Rasterisation du calque technique (indices palette)
// ═══════════════════════════════════════════════════════════════
function _mmToPxF(mm, spec) {
  // Échelle exacte du canevas (évite les dérives d'arrondi cumulé)
  return mm / spec.canvas_mm.w * spec.canvas_px.w;
}

// Trace le contour d'un rectangle (épaisseur `t` px, centrée sur le bord)
function _strokeRect(idx, w, h, x, y, rw, rh, t, color) {
  const x1 = Math.round(x), y1 = Math.round(y);
  const x2 = Math.round(x + rw), y2 = Math.round(y + rh);
  const ht = Math.max(1, Math.round(t / 2));
  _fillRect(idx, w, h, x1 - ht, y1 - ht, x2 + ht, y1 + ht, color);   // haut
  _fillRect(idx, w, h, x1 - ht, y2 - ht, x2 + ht, y2 + ht, color);   // bas
  _fillRect(idx, w, h, x1 - ht, y1 - ht, x1 + ht, y2 + ht, color);   // gauche
  _fillRect(idx, w, h, x2 - ht, y1 - ht, x2 + ht, y2 + ht, color);   // droite
}

function _fillRect(idx, w, h, x1, y1, x2, y2, color) {
  const xa = Math.max(0, Math.min(x1, x2)), xb = Math.min(w, Math.max(x1, x2));
  const ya = Math.max(0, Math.min(y1, y2)), yb = Math.min(h, Math.max(y1, y2));
  for (let y = ya; y < yb; y++) {
    idx.fill(color, y * w + xa, y * w + xb);
  }
}

function _line(idx, w, h, x1, y1, x2, y2, t, color) {
  // Nos traits sont toujours horizontaux ou verticaux
  if (Math.round(x1) === Math.round(x2)) {
    const ht = Math.max(1, Math.round(t / 2));
    _fillRect(idx, w, h, Math.round(x1) - ht, Math.round(Math.min(y1, y2)), Math.round(x1) + ht, Math.round(Math.max(y1, y2)), color);
  } else {
    const ht = Math.max(1, Math.round(t / 2));
    _fillRect(idx, w, h, Math.round(Math.min(x1, x2)), Math.round(y1) - ht, Math.round(Math.max(x1, x2)), Math.round(y1) + ht, color);
  }
}

// Raster du calque « Infos techniques » (transparent + repères)
function _rasterizeTechLayer(spec) {
  const w = spec.canvas_px.w, h = spec.canvas_px.h;
  const idx = new Uint8Array(w * h);                 // 0 = transparent

  if (spec.kind !== 'print') return { w, h, idx };   // digital : rien à tracer

  const px = (mm) => _mmToPxF(mm, spec);
  const strokePx = Math.max(2, Math.round(spec.dpi / 150));   // ≈ 0,5 pt

  // Roll-up : amorces cyan PLEINES + cadre visible + zone tranquille
  // (pas de traits de coupe — toute la surface s'imprime)
  if (spec.rollup) {
    for (const a of spec.rollup.amorces) {
      _fillRect(idx, w, h, Math.round(px(a.x)), Math.round(px(a.y)),
                Math.round(px(a.x + a.w)), Math.round(px(a.y + a.h)), CYAN);
    }
    const v = spec.rollup.visibleBox, sf = spec.safeBox;
    _strokeRect(idx, w, h, px(v.x), px(v.y), px(v.w), px(v.h), strokePx, RED);
    if (sf.w > 0 && sf.h > 0) _strokeRect(idx, w, h, px(sf.x), px(sf.y), px(sf.w), px(sf.h), strokePx, GREEN);
    return { w, h, idx };
  }

  // Traits de coupe (noir, fins)
  for (const m of spec.cropMarks) {
    _line(idx, w, h, px(m.x1), px(m.y1), px(m.x2), px(m.y2), Math.max(1, strokePx - 1), BLACK);
  }
  // Cadres : cyan (fond perdu) / rouge (coupe) / vert (sécurité)
  const b = spec.bleedBox, tB = spec.trimBox, s = spec.safeBox;
  _strokeRect(idx, w, h, px(b.x), px(b.y), px(b.w), px(b.h), strokePx, CYAN);
  _strokeRect(idx, w, h, px(tB.x), px(tB.y), px(tB.w), px(tB.h), strokePx, RED);
  if (s.w > 0 && s.h > 0) _strokeRect(idx, w, h, px(s.x), px(s.y), px(s.w), px(s.h), strokePx, GREEN);

  // Traits de plis : pointillés magenta dans les MARGES uniquement
  // (usage imprimeur — jamais sur la zone de création)
  if (spec.folds) {
    const dash = px(2);                              // 2 mm on / 2 mm off
    for (const fx of spec.folds.vertical) {
      _dashedLine(idx, w, h, px(fx), px(2), px(fx), px(b.y - 2), strokePx, MAGENTA, dash);
      _dashedLine(idx, w, h, px(fx), px(b.y + b.h + 2), px(fx), px(spec.canvas_mm.h - 2), strokePx, MAGENTA, dash);
    }
    for (const fy of spec.folds.horizontal) {
      _dashedLine(idx, w, h, px(2), px(fy), px(b.x - 2), px(fy), strokePx, MAGENTA, dash);
      _dashedLine(idx, w, h, px(b.x + b.w + 2), px(fy), px(spec.canvas_mm.w - 2), px(fy), strokePx, MAGENTA, dash);
    }
  }

  return { w, h, idx };
}

// Trait pointillé horizontal ou vertical (segments dash on / dash off)
function _dashedLine(idx, w, h, x1, y1, x2, y2, t, color, dash) {
  const vertical = Math.round(x1) === Math.round(x2);
  const from = vertical ? Math.min(y1, y2) : Math.min(x1, x2);
  const to   = vertical ? Math.max(y1, y2) : Math.max(x1, x2);
  for (let p = from; p < to; p += dash * 2) {
    const q = Math.min(p + dash, to);
    if (vertical) _line(idx, w, h, x1, p, x1, q, t, color);
    else          _line(idx, w, h, p, y1, q, y1, t, color);
  }
}

// Fusionne une surcouche RGBA (texte canvas) dans le raster d'indices :
// chaque pixel opaque est mappé sur la couleur de palette la plus proche.
function _stampOverlay(raster, overlay) {
  if (!overlay || overlay.w !== raster.w || overlay.h !== raster.h) return;
  const { data } = overlay;
  for (let i = 0, p = 0; i < raster.idx.length; i++, p += 4) {
    if (data[p + 3] < 128) continue;
    raster.idx[i] = _nearestPalette(data[p], data[p + 1], data[p + 2]);
  }
}

function _nearestPalette(r, g, b) {
  let best = BLACK, bestD = Infinity;
  for (let c = 1; c < PALETTE.length; c++) {
    const [pr, pg, pb] = PALETTE[c].rgb;
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════
// Écriture binaire
// ═══════════════════════════════════════════════════════════════
class W {
  constructor() { this.chunks = []; this.length = 0; }
  bytes(u8) { this.chunks.push(u8); this.length += u8.length; return this; }
  u8(v) { return this.bytes(new Uint8Array([v & 0xFF])); }
  u16(v) { return this.bytes(new Uint8Array([(v >> 8) & 0xFF, v & 0xFF])); }
  u32(v) { return this.bytes(new Uint8Array([(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF])); }
  i16(v) { return this.u16(v < 0 ? v + 0x10000 : v); }
  ascii(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return this.bytes(b); }
  concat() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

// PackBits (RLE PSD) — compresse une ligne
function _packBits(row) {
  const out = [];
  let i = 0;
  const n = row.length;
  while (i < n) {
    // Cherche une répétition (≥ 3 identiques, ou 2 en fin de ligne)
    let runLen = 1;
    while (i + runLen < n && row[i + runLen] === row[i] && runLen < 128) runLen++;
    if (runLen >= 2) {
      out.push(257 - runLen, row[i]);
      i += runLen;
    } else {
      // Littéraux jusqu'à la prochaine répétition
      const start = i;
      i++;
      while (i < n && (i - start) < 128) {
        if (i + 1 < n && row[i] === row[i + 1]) break;
        i++;
      }
      out.push(i - start - 1);
      for (let j = start; j < i; j++) out.push(row[j]);
    }
  }
  return Uint8Array.from(out.map(v => v & 0xFF));
}

// Extrait une ligne d'un canal depuis le raster d'indices.
// channel : -1 = alpha, 0..3 = C,M,Y,K (stockés inversés : 255 = pas
// d'encre) ou 0..2 = R,G,B en mode RVB.
function _channelRow(raster, y, channel, cmyk, rowBuf) {
  const { w, idx } = raster;
  const base = y * w;
  for (let x = 0; x < w; x++) {
    const p = PALETTE[idx[base + x]];
    if (channel === -1) rowBuf[x] = p.alpha;
    else if (cmyk)      rowBuf[x] = 255 - p.ink[channel];
    else                rowBuf[x] = p.rgb[channel];
  }
  return rowBuf;
}

// Compresse un canal complet en RLE PSD : table des longueurs de
// lignes (u16 × h) puis données. Retourne { table, data }.
function _rleChannel(raster, channel, cmyk) {
  const { w, h } = raster;
  const rowBuf = new Uint8Array(w);
  const table = new W();
  const data = new W();
  let lastRowKey = null, lastPacked = null;
  for (let y = 0; y < h; y++) {
    _channelRow(raster, y, channel, cmyk, rowBuf);
    // Micro-cache : les lignes identiques consécutives (très fréquent
    // sur nos aplats) ne sont compressées qu'une fois.
    const key = rowBuf[0] + ',' + rowBuf[w >> 1] + ',' + rowBuf[w - 1];
    let packed;
    if (lastPacked && key === lastRowKey && _sameRow(raster, y, w)) {
      packed = lastPacked;
    } else {
      packed = _packBits(rowBuf);
      lastPacked = packed; lastRowKey = key;
    }
    table.u16(packed.length);
    data.bytes(packed);
  }
  return { table, data };
}

function _sameRow(raster, y, w) {
  if (y === 0) return false;
  const a = (y - 1) * w, b = y * w;
  for (let x = 0; x < w; x++) if (raster.idx[a + x] !== raster.idx[b + x]) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Sections PSD
// ═══════════════════════════════════════════════════════════════

// Nom de calque : Pascal string (padding 4) + bloc 'luni' (unicode)
function _layerName(name) {
  const w = new W();
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 31);
  w.u8(ascii.length).ascii(ascii);
  while ((w.length) % 4 !== 0) w.u8(0);
  return w;
}

function _luniBlock(name) {
  const w = new W();
  w.ascii('8BIM').ascii('luni');
  const body = new W();
  body.u32(name.length);
  for (const ch of name) body.u16(ch.charCodeAt(0));
  if (body.length % 4 !== 0) body.u16(0);
  w.u32(body.length).bytes(body.concat());
  return w;
}

// Un calque complet : { name, raster, channels: [ids...] }
function _layerRecord(layer, cmyk) {
  const { raster } = layer;
  const channelIds = cmyk ? [-1, 0, 1, 2, 3] : [-1, 0, 1, 2];

  // Données de canaux (compression RLE = 1)
  const channelData = channelIds.map(id => {
    const { table, data } = _rleChannel(raster, id, cmyk);
    const w = new W();
    w.u16(1).bytes(table.concat()).bytes(data.concat());
    return w.concat();
  });

  const rec = new W();
  rec.u32(0).u32(0).u32(raster.h).u32(raster.w);      // top, left, bottom, right
  rec.u16(channelIds.length);
  channelIds.forEach((id, i) => { rec.i16(id); rec.u32(channelData[i].length); });
  rec.ascii('8BIM').ascii('norm');
  rec.u8(255).u8(0).u8(0).u8(0);                      // opacité, clipping, flags, filler

  const extra = new W();
  extra.u32(0);                                        // pas de masque
  extra.u32(0);                                        // pas de blending ranges
  extra.bytes(_layerName(layer.name).concat());
  extra.bytes(_luniBlock(layer.name).concat());
  const extraBytes = extra.concat();
  rec.u32(extraBytes.length).bytes(extraBytes);

  return { record: rec.concat(), channelData };
}

// Ressources image : résolution + guides Photoshop
function _imageResources(spec) {
  const res = new W();

  // 0x03ED — résolution (fixed 16.16, unité = pixels/pouce)
  const dpi = spec.dpi || 72;
  const body = new W();
  body.u32(Math.round(dpi * 65536)).u16(1).u16(2);
  body.u32(Math.round(dpi * 65536)).u16(1).u16(2);
  _resource(res, 0x03ED, body.concat());

  // 0x0408 — guides posés sur fond perdu / coupe / sécurité
  if (spec.kind === 'print') {
    const px = (mm) => Math.round(_mmToPxF(mm, spec) * 32);   // fixed ×32
    const guides = [];
    const push = (mmX, dir) => guides.push([px(mmX), dir]);
    // Roll-up : guides sur zone visible + tranquille (les bords du
    // canevas n'ont pas besoin de guides) ; sinon bleed/trim/safe.
    const boxes = spec.rollup
      ? [spec.rollup.visibleBox, spec.safeBox]
      : [spec.bleedBox, spec.trimBox, spec.safeBox];
    for (const box of boxes) {
      if (box.w <= 0) continue;
      push(box.x, 0); push(box.x + box.w, 0);          // verticaux
      push(box.y, 1); push(box.y + box.h, 1);          // horizontaux
    }
    const g = new W();
    g.u32(1);                                          // version
    g.u32(576).u32(576);                               // grille par défaut
    g.u32(guides.length);
    for (const [loc, dir] of guides) { g.u32(loc); g.u8(dir); }
    _resource(res, 0x0408, g.concat());
  }

  return res.concat();
}

function _resource(w, id, body) {
  w.ascii('8BIM').u16(id).u16(0);                      // nom vide (Pascal paddé)
  w.u32(body.length).bytes(body);
  if (body.length % 2 !== 0) w.u8(0);
}

// ═══════════════════════════════════════════════════════════════
// API principale
// ═══════════════════════════════════════════════════════════════
export function buildTemplatePsd(spec, opts = {}) {
  if (!spec) return null;
  const cmyk = spec.colorMode === 'CMYK';
  const w = spec.canvas_px.w, h = spec.canvas_px.h;

  // Calque du bas : « Votre visuel » — fond blanc plein canevas
  const visualRaster = { w, h, idx: new Uint8Array(w * h).fill(WHITE) };

  // Calque du haut : « Infos techniques » — repères (+ texte canvas)
  const techRaster = _rasterizeTechLayer(spec);
  if (opts.overlayRGBA) _stampOverlay(techRaster, opts.overlayRGBA);

  const hasTech = spec.kind === 'print' || !!opts.overlayRGBA;
  const layers = [
    { name: 'Votre visuel', raster: visualRaster },
    ...(hasTech ? [{ name: 'Infos techniques — à masquer avant export', raster: techRaster }] : []),
  ];

  // Composite aplati : blanc + repères par-dessus
  const compositeRaster = { w, h, idx: new Uint8Array(w * h).fill(WHITE) };
  for (let i = 0; i < compositeRaster.idx.length; i++) {
    if (techRaster.idx[i] !== T) compositeRaster.idx[i] = techRaster.idx[i];
  }

  // ── Assemblage ──────────────────────────────────────────────
  const psd = new W();

  // 1. Header
  psd.ascii('8BPS').u16(1);
  psd.bytes(new Uint8Array(6));
  psd.u16(cmyk ? 4 : 3);                               // canaux composite
  psd.u32(h).u32(w).u16(8).u16(cmyk ? 4 : 3);          // depth 8, mode CMJN/RVB

  // 2. Color mode data (vide)
  psd.u32(0);

  // 3. Image resources
  const resources = _imageResources(spec);
  psd.u32(resources.length).bytes(resources);

  // 4. Layer & mask info
  const records = layers.map(l => _layerRecord(l, cmyk));
  const layerInfo = new W();
  layerInfo.u16(layers.length);
  for (const r of records) layerInfo.bytes(r.record);
  for (const r of records) for (const cd of r.channelData) layerInfo.bytes(cd);
  let layerInfoBytes = layerInfo.concat();
  if (layerInfoBytes.length % 2 !== 0) {
    const padded = new Uint8Array(layerInfoBytes.length + 1);
    padded.set(layerInfoBytes);
    layerInfoBytes = padded;
  }
  const lmi = new W();
  lmi.u32(layerInfoBytes.length).bytes(layerInfoBytes); // layer info
  lmi.u32(0);                                           // global layer mask (vide)
  const lmiBytes = lmi.concat();
  psd.u32(lmiBytes.length).bytes(lmiBytes);

  // 5. Image data composite (RLE) : toutes les tables de lignes
  //    d'abord (canaux × h), puis toutes les données
  psd.u16(1);
  const compChannels = cmyk ? [0, 1, 2, 3] : [0, 1, 2];
  const rles = compChannels.map(c => _rleChannel(compositeRaster, c, cmyk));
  for (const r of rles) psd.bytes(r.table.concat());
  for (const r of rles) psd.bytes(r.data.concat());

  return psd.concat();
}

// Dessine le texte d'info sur un canvas (côté navigateur uniquement)
// et retourne la surcouche RGBA à passer à buildTemplatePsd.
export function renderInfoOverlay(spec, doc = globalThis.document) {
  if (!doc?.createElement) return null;
  const w = spec.canvas_px.w, h = spec.canvas_px.h;
  const canvas = doc.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  const pxPerMm = spec.kind === 'print' ? w / spec.canvas_mm.w : 3;
  const fontPx = Math.max(10, Math.round(2.2 * pxPerMm));
  ctx.font = `${fontPx}px Helvetica, Arial, sans-serif`;
  ctx.fillStyle = '#000000';

  if (spec.kind === 'print' && spec.rollup) {
    // Roll-up : tout le texte vit DANS la zone tranquille (le calque
    // technique est masqué avant export, comme chez Exaprint)
    const x = (spec.safeBox.x + 4) * pxPerMm;
    let y = (spec.safeBox.y + 10) * pxPerMm;
    ctx.font = `bold ${Math.round(fontPx * 1.4)}px Helvetica, Arial, sans-serif`;
    ctx.fillText(`${spec.productLabel} · ${spec.dimsLabel}`, x, y);
    y += fontPx * 1.9;
    ctx.font = `${fontPx}px Helvetica, Arial, sans-serif`;
    for (const line of templateInfoLines(spec)) {
      ctx.fillText(line, x, y);
      y += fontPx * 1.4;
    }
  } else if (spec.kind === 'print') {
    // Titre dans la marge haute + infos dans la marge basse
    const x = (spec.trimBox.x + 2) * pxPerMm;
    ctx.font = `bold ${Math.round(fontPx * 1.25)}px Helvetica, Arial, sans-serif`;
    ctx.fillText(`${spec.productLabel}${spec.face ? (spec.face === 'verso' ? ' — Verso' : ' — Recto') : ''} · ${spec.dimsLabel}`,
      x, (spec.marksMargin - 4) * pxPerMm);
    ctx.font = `${fontPx}px Helvetica, Arial, sans-serif`;
    const lines = templateInfoLines(spec).slice(1);
    let y = (spec.canvas_mm.h - spec.marksMargin + 4) * pxPerMm;
    for (const line of lines.slice(0, 3)) {
      ctx.fillText(line, x, y);
      y += fontPx * 1.25;
    }
  }

  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}
