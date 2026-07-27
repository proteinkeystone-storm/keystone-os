/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Template PDF (P1 refonte Brief Prod)
   ─────────────────────────────────────────────────────────────
   Génère le GABARIT PDF print à partir d'un TemplateSpec
   (kodex-template-geometry.js). PDF écrit à la main, zéro
   dépendance — le contenu est simple (rectangles, traits, texte).

   Conforme aux usages imprimeur (modèle : gabarits Exaprint 2026) :
     - MediaBox / BleedBox / TrimBox RÉELLES → le document s'ouvre
       aux bonnes cotes dans Illustrator, InDesign, Photoshop
     - la page fait EXACTEMENT la taille du fond perdu — SANS trait
       de coupe (« Enregistrez le pdf en haute qualité sans trait de
       coupe ») ni marge à repères
     - couleurs des repères en DeviceCMYK pur :
         cyan  (1 0 0 0) = fond perdu
         rouge (0 1 1 0) = ligne de coupe / format fini
         vert  (1 0 1 0) = zone de sécurité
     - plis en pointillés magenta TRAVERSANTS
     - légende + infos techniques dans la zone de sécurité (le calque
       gabarit est supprimé par le graphiste avant export)

   API : buildTemplatePdf(spec) → Uint8Array (ou null si digital —
   le kit digital se compose de PSD + PNG, pas de PDF).
   ═══════════════════════════════════════════════════════════════ */

import { mmToPt, templateInfoLines } from './kodex-template-geometry.js';

// Couleurs CMJN des repères (valeurs d'encre directes)
const INK = {
  bleed: '1 0 0 0',      // cyan
  trim:  '0 1 1 0',      // rouge
  safe:  '1 0 1 0',      // vert
  fold:  '0 1 0 0',      // magenta — traits de plis
  black: '0 0 0 1',
  gray:  '0 0 0 0.55',
};

export function buildTemplatePdf(spec) {
  if (!spec || spec.kind !== 'print') return null;

  const W = mmToPt(spec.canvas_mm.w);
  const H = mmToPt(spec.canvas_mm.h);

  // Conversion géométrie (mm, origine haut-gauche) → PDF (pt, origine bas-gauche)
  const X = (mm) => _n(mmToPt(mm));
  const Y = (mm) => _n(H - mmToPt(mm));
  const boxToPdf = (b) => [_n(mmToPt(b.x)), _n(H - mmToPt(b.y + b.h)), _n(mmToPt(b.x + b.w)), _n(H - mmToPt(b.y))];

  const ops = [];

  const frame = (box, ink) => {
    const [x1, y1, x2, y2] = boxToPdf(box);
    ops.push(`${ink} K 0.5 w ${x1} ${y1} ${_n(x2 - x1)} ${_n(y2 - y1)} re S`);
  };

  // ── Roll-up : amorces cyan PLEINES + visible + tranquille ────
  // (pas de traits de coupe ni de fond perdu — toute la surface
  // s'imprime et se coupe au bord, cf. gabarits Exaprint)
  if (spec.rollup) {
    // Le PDF roll-up sort à l'échelle 1:1 (exigence Exaprint 2026,
    // spec construite avec workScale 1 par le kit) : les tailles de
    // texte et de trait, pensées pour la page 1/4, sont regonflées
    // d'autant pour rester proportionnées.
    const k = _n((spec.scale.factor || 1) / (spec.rollup.work_scale || spec.scale.factor || 1));
    for (const a of spec.rollup.amorces) {
      const [x1, y1, x2, y2] = boxToPdf(a);
      ops.push(`${INK.bleed} k ${x1} ${y1} ${_n(x2 - x1)} ${_n(y2 - y1)} re f`);
    }
    ops.push(`${INK.trim} K ${_n(0.5 * k)} w`);
    {
      const [x1, y1, x2, y2] = boxToPdf(spec.rollup.visibleBox);
      ops.push(`${x1} ${y1} ${_n(x2 - x1)} ${_n(y2 - y1)} re S`);
    }
    if (spec.safeBox.w > 0 && spec.safeBox.h > 0) {
      const [x1, y1, x2, y2] = boxToPdf(spec.safeBox);
      ops.push(`${INK.safe} K ${_n(0.5 * k)} w ${x1} ${y1} ${_n(x2 - x1)} ${_n(y2 - y1)} re S`);
    }

    // Légende à l'intérieur de la zone tranquille (le calque gabarit
    // est ignoré/supprimé par le graphiste avant export — Exaprint
    // place la sienne au milieu du visuel, on fait pareil en haut)
    const lx = X(spec.safeBox.x + 4 * k);
    let lyR = Y(spec.safeBox.y + 8 * k);
    ops.push(_text(`${spec.productLabel} · ${spec.dimsLabel}`, lx, lyR, 'F2', 11 * k, INK.black));
    lyR -= 13 * k;
    ops.push(_text(`Gabarit généré par Brief Prod · Keystone OS · ${_frDate(spec.generatedAt)}`, lx, lyR, 'F1', 7 * k, INK.gray));
    lyR -= 13 * k;
    // slice(1) : la 1re ligne (nom du produit) est déjà dans le titre
    for (const line of templateInfoLines(spec).slice(1)) {
      const ink = /amorce/i.test(line) ? INK.bleed : (/visible/.test(line) ? INK.trim : (/tranquille/i.test(line) ? INK.safe : INK.black));
      ops.push(_text(line, lx, lyR, 'F1', 7 * k, ink));
      lyR -= 9.5 * k;
    }
    return _assemblePdf(spec, W, H, ops.join('\n'), boxToPdf);
  }

  // ── Cadres bleed / trim / safe (0.5 pt) ─────────────────────
  // Standard 2026 : pas de traits de coupe (« sans trait de coupe »),
  // la page fait la taille du fond perdu, les guides sont des cadres.
  frame(spec.bleedBox, INK.bleed);
  frame(spec.trimBox,  INK.trim);
  if (spec.safeBox.w > 0 && spec.safeBox.h > 0) frame(spec.safeBox, INK.safe);

  // ── Traits de plis (magenta, pointillés TRAVERSANTS) ────────
  // Modèle gabarit Exaprint 2026 : le pli se marque d'un pointillé
  // qui traverse toute la page (le calque gabarit part avant export).
  if (spec.folds) {
    ops.push(`${INK.fold} K 0.6 w [2 2] 0 d`);
    for (const x of spec.folds.vertical) {
      ops.push(`${X(x)} ${Y(0)} m ${X(x)} ${Y(spec.canvas_mm.h)} l S`);
    }
    for (const y of spec.folds.horizontal) {
      ops.push(`${X(0)} ${Y(y)} m ${X(spec.canvas_mm.w)} ${Y(y)} l S`);
    }
    ops.push('[] 0 d');
  }

  // ── Titre + légende DANS la zone de sécurité ────────────────
  // Plus de marges autour de la page (standard 2026) : comme pour le
  // roll-up, le texte vit dans la zone tranquille — le calque gabarit
  // est supprimé par le graphiste avant export, il ne gêne rien.
  const textX = X(spec.safeBox.x + 2);
  const face = spec.face ? (spec.face === 'verso' ? ' — Verso' : ' — Recto') : '';
  let ly = Y(spec.safeBox.y + 6);
  ops.push(_text(`${spec.productLabel}${face} · ${spec.dimsLabel}`, textX, ly, 'F2', 8, INK.black));
  ly -= 8;
  ops.push(_text(`Gabarit généré par Brief Prod · Keystone OS · ${_frDate(spec.generatedAt)}`,
    textX, ly, 'F1', 5.5, INK.gray));
  ly -= 9;

  const legends = [];
  if (spec.real.bleed_mm) {
    legends.push([INK.bleed, `Cadre cyan — fond perdu ${spec.real.bleed_mm} mm : étirez le visuel jusqu'au bord de la page, il part à la coupe.`]);
  }
  legends.push([INK.trim, `Cadre rouge — ligne de coupe : format fini ${spec.dimsLabel}.`]);
  if (spec.real.safe_mm) {
    legends.push([INK.safe, `Cadre vert — zone de sécurité ${spec.real.safe_mm} mm : gardez textes et logos à l'intérieur.`]);
  }
  if (spec.folds) {
    const panels = spec.folds.panels.map(p => Number.isInteger(p) ? p : String(p).replace('.', ',')).join(' / ');
    legends.push([INK.fold, `Traits magenta — ${spec.folds.label.toLowerCase()} : volets ${panels} mm${spec.folds.asymmetric ? ' (rentrant plus court, verso en miroir)' : ''}.`]);
  }
  const specBits = [`${spec.dpi} DPI`, spec.colorProfile, `export ${spec.exportFormat} sans trait de coupe`];
  if (spec.scale.label) specBits.push(`document à l'${spec.scale.label.toLowerCase()} (l'imprimeur agrandit à la sortie)`);
  legends.push([INK.black, specBits.join(' · ')]);

  const lineH = 5.5;
  for (const [ink, txt] of legends) {
    ops.push(_text(txt, textX, ly, 'F1', 5, ink));
    ly -= lineH;
  }

  return _assemblePdf(spec, W, H, ops.join('\n'), boxToPdf);
}

// ── Primitives ────────────────────────────────────────────────
function _text(str, x, y, font, size, ink) {
  return `BT ${ink} k /${font} ${size} Tf ${x} ${y} Td (${_escStr(str)}) Tj ET`;
}

function _escStr(s) {
  // WinAnsi ≈ latin-1 : on remplace ce qui n'y rentre pas.
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c === 0x2019) out += '\\222';        // ’ apostrophe typographique
    else if (c === 0x2014 || c === 0x2013) out += '\\226';  // tirets — –
    else if (c === 0x00B7 || c === 0x2022) out += '\\267';  // séparateur ·
    else if (c <= 0xFF) out += ch;
    else out += '?';
  }
  return out;
}

function _n(v) {
  return Math.round(v * 100) / 100;
}

function _frDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ── Assemblage du document ────────────────────────────────────
function _assemblePdf(spec, W, H, stream, boxToPdf) {
  const bleedBox = boxToPdf(spec.bleedBox);
  const trimBox  = boxToPdf(spec.trimBox);
  const title = `Gabarit ${spec.productLabel} ${spec.dimsLabel}`;

  const objects = [
    // 1 — Catalog
    `<< /Type /Catalog /Pages 2 0 R >>`,
    // 2 — Pages
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    // 3 — Page avec les boîtes réelles (l'âme du gabarit)
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${_n(W)} ${_n(H)}] ` +
      `/BleedBox [${bleedBox.join(' ')}] /TrimBox [${trimBox.join(' ')}] ` +
      `/Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    // 4 — Contenu (placeholder, remplacé ci-dessous par le stream)
    null,
    // 5/6 — Polices standard (non embarquées, WinAnsi pour les accents)
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
    // 7 — Métadonnées
    `<< /Title (${_escStr(title)}) /Creator (Brief Prod - Keystone OS) /Producer (Keystone OS) >>`,
  ];

  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (s) => { const b = _latin1(s); chunks.push(b); pos += b.length; };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  objects.forEach((body, i) => {
    const num = i + 1;
    offsets[num] = pos;
    if (num === 4) {
      const streamBytes = _latin1(stream);
      push(`4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
      chunks.push(streamBytes); pos += streamBytes.length;
      push('\nendstream\nendobj\n');
    } else {
      push(`${num} 0 obj\n${body}\nendobj\n`);
    }
  });

  const xrefPos = pos;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Encode une chaîne JS en octets latin-1 (le contenu PDF reste ASCII
// sauf les textes, déjà filtrés par _escStr).
function _latin1(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
  return b;
}
