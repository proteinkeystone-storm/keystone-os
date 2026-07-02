/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Template Kit (P1 refonte Brief Prod)
   ─────────────────────────────────────────────────────────────
   Assemble le KIT GABARITS téléchargeable :

     Gabarit_<Produit>_<dims>_<Imprimeur>_<date>.zip
       ├─ …_Recto.pdf / …_Verso.pdf   (print : boîtes réelles)
       ├─ …_Recto.psd / …_Verso.psd   (print : CMJN 300 DPI)
       ├─ ….psd + ….png               (digital : px exacts, sRVB)
       └─ LISEZMOI.txt                (specs + consignes imprimeur)

   ZIP écrit à la main (méthode "store", CRC-32) — zéro dépendance.

   API :
     buildTemplateKit(params) → Promise<{ fileName, bytes }>
     downloadTemplateKit(params) → Promise<fileName>  (navigateur)
   ═══════════════════════════════════════════════════════════════ */

import { buildTemplateSpec, kitBaseName, kitFileName, templateInfoLines } from './kodex-template-geometry.js';
import { buildTemplatePdf } from './kodex-template-pdf.js';
import { buildTemplatePsd, renderInfoOverlay } from './kodex-template-psd.js';

// ═══════════════════════════════════════════════════════════════
// Construction du kit
// ─────────────────────────────────────────────────────────────
// params :
//   standard     objet `standard` (specToStandard) — obligatoire
//   productLabel label produit affiché/nommé (ex : « Carte de visite »)
//   vendorLabel  label imprimeur ou null
//   vendor       objet vendor complet (preparation_steps…) ou null
//   twoSided     bool — un gabarit Recto + un Verso (print uniquement)
//   generatedAt  Date (défaut : maintenant)
//   doc          document (pour le canvas texte + téléchargement)
// ═══════════════════════════════════════════════════════════════
export async function buildTemplateKit(params) {
  const {
    standard, productLabel, vendorLabel = null, vendor = null,
    twoSided = false, foldType = null, generatedAt = new Date(), doc = globalThis.document,
  } = params;

  const baseOpts = { productLabel, vendorLabel, generatedAt, foldType };
  const probe = buildTemplateSpec(standard, baseOpts);
  if (!probe) throw new Error('Dimensions manquantes — impossible de générer le gabarit');

  const files = [];

  if (probe.kind === 'print') {
    // Un pliage implique un recto ET un verso (les roulés sont même
    // asymétriques : le verso est le miroir du recto).
    const hasFold = foldType && foldType !== 'none';
    const faces = (twoSided || hasFold) ? ['recto', 'verso'] : [null];
    for (const face of faces) {
      const spec = buildTemplateSpec(standard, { ...baseOpts, face });
      const overlay = renderInfoOverlay(spec, doc);
      files.push({ name: kitFileName(spec, 'pdf'), data: buildTemplatePdf(spec) });
      files.push({ name: kitFileName(spec, 'psd'), data: buildTemplatePsd(spec, { overlayRGBA: overlay }) });
    }
  } else {
    // Digital : canevas aux pixels exacts — PSD + PNG
    files.push({ name: kitFileName(probe, 'psd'), data: buildTemplatePsd(probe) });
    const png = await _blankPng(probe.canvas_px.w, probe.canvas_px.h, doc);
    if (png) files.push({ name: kitFileName(probe, 'png'), data: png });
  }

  files.push({ name: 'LISEZMOI.txt', data: _utf8(buildReadme(probe, { vendor, twoSided: twoSided || (foldType && foldType !== 'none') })) });

  const fileName = `${kitBaseName(probe)}.zip`;
  return { fileName, bytes: buildZip(files, generatedAt) };
}

// Déclenche le téléchargement navigateur du kit.
export async function downloadTemplateKit(params) {
  const { fileName, bytes } = await buildTemplateKit(params);
  const doc = params.doc || globalThis.document;
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return fileName;
}

// ═══════════════════════════════════════════════════════════════
// LISEZMOI.txt
// ═══════════════════════════════════════════════════════════════
export function buildReadme(spec, { vendor = null, twoSided = false } = {}) {
  const L = [];
  const rule = '═'.repeat(58);
  L.push(rule);
  L.push(`  KIT GABARITS — ${spec.productLabel.toUpperCase()}`);
  L.push(`  Généré par Brief Prod · Keystone OS · ${_frDate(spec.generatedAt)}`);
  L.push(rule, '');

  L.push('CE QUE CONTIENT CE KIT');
  if (spec.kind === 'print') {
    const faces = twoSided ? ' (un fichier Recto, un fichier Verso)' : '';
    L.push(`- Gabarit PDF${faces} : s'ouvre aux cotes exactes dans`);
    L.push('  Illustrator, InDesign (importation) ou Photoshop.');
    L.push(`- Gabarit PSD${faces} : Photoshop, CMJN, ${spec.dpi} DPI,`);
    L.push('  guides déjà posés. Créez sur le calque « Votre visuel ».');
  } else {
    L.push('- Gabarit PSD : Photoshop, aux pixels exacts, sRVB.');
    L.push('- Fond PNG : même canevas, pour tout autre logiciel.');
  }
  L.push('');

  L.push('LES SPECS DE CE SUPPORT');
  for (const line of templateInfoLines(spec)) L.push(`- ${line}`);
  L.push('');

  if (spec.kind === 'print' && spec.rollup) {
    L.push('COMMENT UTILISER LE GABARIT ROLL-UP');
    L.push('1. Créez votre visuel SOUS le calque « Infos techniques »');
    L.push('   (PSD) ou sur un calque à part (PDF ouvert dans Illustrator).');
    L.push('2. TOUTE la surface doit être imprimée : couvrez le canevas');
    L.push('   entier, y compris les zones cyan (amorces).');
    L.push(`3. Zone d'amorce basse (${spec.rollup.amorce_bottom_mm} mm) : avalée par le mécanisme.`);
    L.push('   Prolongez-y le FOND de votre visuel, jamais de contenu.');
    L.push('4. Gardez textes et logos DANS le cadre vert (zone tranquille).');
    L.push('5. Avant export : masquez ou supprimez le calque');
    L.push(`   « Infos techniques », puis exportez en ${spec.exportFormat}.`);
    L.push('');
    L.push("ATTENTION — document à l'échelle 1/4 :");
    L.push(`la surface totale réelle est ${spec.dimsLabel}. Travaillez dans ce`);
    L.push("fichier tel quel, l'imprimeur agrandit à la sortie.");
    L.push('');
  } else if (spec.kind === 'print') {
    L.push('COMMENT UTILISER LE GABARIT');
    L.push('1. Créez votre visuel SOUS le calque « Infos techniques »');
    L.push('   (PSD) ou sur un calque à part (PDF ouvert dans Illustrator).');
    if (spec.real.bleed_mm) {
      L.push(`2. Étirez les fonds jusqu'au CADRE CYAN (fond perdu ${spec.real.bleed_mm} mm) :`);
      L.push('   cette zone part à la coupe, elle évite les liserés blancs.');
    }
    L.push('3. Gardez textes et logos DANS le cadre vert (zone de sécurité).');
    if (spec.folds) {
      L.push('4. Respectez les TRAITS MAGENTA (plis) : composez chaque volet');
      L.push(`   comme une page. ${spec.folds.label} — volets ${spec.folds.panels.map(p => Number.isInteger(p) ? p : String(p).replace('.', ',')).join(' / ')} mm.`);
      if (spec.folds.asymmetric) {
        L.push('   Le volet rentrant est PLUS COURT et le verso est le MIROIR');
        L.push('   du recto : suivez les traits de chaque fichier, pas de symétrie à la main.');
      }
    }
    L.push(`${spec.folds ? '5' : '4'}. Avant export : masquez ou supprimez le calque`);
    L.push(`   « Infos techniques », puis exportez en ${spec.exportFormat}.`);
    if (spec.scale.label) {
      L.push('');
      L.push(`ATTENTION — document à l'${spec.scale.label.toLowerCase()} :`);
      L.push(`le format fini réel est ${spec.dimsLabel}. Travaillez dans ce`);
      L.push("fichier tel quel, l'imprimeur agrandit à la sortie.");
    }
    L.push('');
  }

  if (vendor && vendor.preparation_steps?.length) {
    L.push(`CONSIGNES SPÉCIFIQUES ${String(vendor.label || '').toUpperCase()}`);
    for (const step of vendor.preparation_steps) L.push(`- ${step}`);
    L.push('');
  }
  if (spec.notes) {
    L.push('NOTES');
    L.push(`- ${spec.notes}`);
    L.push('');
  }

  L.push(rule);
  L.push('Un doute ? Joignez ce kit à votre graphiste avec le brief PDF —');
  L.push('tout y est : il ne peut pas se tromper.');
  L.push(rule, '');
  return L.join('\r\n');           // fins de ligne Windows (Bloc-notes)
}

// ═══════════════════════════════════════════════════════════════
// ZIP writer (méthode store — nos PDF/PSD sont déjà compacts,
// et « store » garantit une compatibilité d'extraction totale)
// ═══════════════════════════════════════════════════════════════
export function buildZip(files, when = new Date()) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const dosTime = _dosTime(when), dosDate = _dosDate(when);

  for (const f of files) {
    const nameBytes = _utf8(f.name);
    const data = f.data;
    const crc = _crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);                 // version needed
    lv.setUint16(6, 0x0800, true);             // flags : noms UTF-8
    lv.setUint16(8, 0, true);                  // méthode store
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of [...chunks, ...central, end]) { out.set(c, o); o += c.length; }
  return out;
}

// ── CRC-32 (table paresseuse) ─────────────────────────────────
let _crcTable = null;
function _crc32(data) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = _crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Helpers ───────────────────────────────────────────────────
function _utf8(s) {
  return new TextEncoder().encode(s);
}

function _dosTime(d) {
  return (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
}

function _dosDate(d) {
  return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
}

function _frDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// PNG blanc aux dimensions exactes (canvas navigateur ; null en Node)
async function _blankPng(w, h, doc) {
  if (!doc?.createElement) return null;
  const canvas = doc.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
