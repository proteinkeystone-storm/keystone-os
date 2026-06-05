/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — proof-pdf.js
   Cœur PDF du correcteur (Ghost Writer V2 · Phase 2-3).

   PDF.js (auto-hébergé, worker-src 'self') : charge un PDF, rend les
   pages en canvas, extrait le texte AVEC ses coordonnées, mappe les
   offsets de fautes ↔ boîtes à l'écran, et fournit de quoi surligner
   + popover. Les exports (PDF annoté pdf-lib + rapport) sont en Phase 3.

   ⚠️ Le PDF ne quitte JAMAIS le navigateur (tout est local).

   Fiabilité (brief §7) :
     • Césure fin de ligne  exem-\nple → dé-césuré avant analyse, remappé.
     • Ordre de lecture / colonnes → items triés par ligne (y) puis x.
     • Faute à cheval sur plusieurs fragments → plusieurs rectangles.
     • Offsets stables : on NFC-normalise + retire U+00AD À LA CONSTRUCTION
       du texte → la canonisation de proof-engine devient idempotente,
       donc les offsets restent alignés sur les boîtes par caractère.
     • PDF scanné (pas de couche texte) → détecté → « non supporté ».

   Réutilisable : ce module ne connaît pas Ghost Writer. Il expose
   loadPdf / analyzePage / renderPageCanvas + helpers d'export (P3).
   ═══════════════════════════════════════════════════════════════ */

import * as pdfjsLib from '/app/vendor/pdfjs/pdf.min.mjs';
import { analyze, getProofOptions } from './proof-engine.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/app/vendor/pdfjs/pdf.worker.min.mjs';

export const PDFJS_VERSION = pdfjsLib.version;

// ── Chargement ──────────────────────────────────────────────────
export async function loadPdf(arrayBuffer) {
  const task = pdfjsLib.getDocument({
    data: arrayBuffer,
    isEvalSupported: false,            // CSP : pas de 'unsafe-eval'
    disableAutoFetch: true,
    disableStream: false,
  });
  return task.promise;                 // → PDFDocumentProxy
}

// Longueur de texte (hors espaces) d'une page, plafonnée — pour repérer vite
// les pages image/vides (couverture…) SANS lancer l'analyse complète.
export async function pageTextLength(pdf, pageNum, cap) {
  cap = cap || 64;
  try {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    let len = 0;
    for (const it of tc.items) {
      if (it.str) len += it.str.replace(/\s/g, '').length;
      if (len >= cap) return len;
    }
    return len;
  } catch (_) { return 0; }
}

// ── Construction texte page + boîtes par caractère ──────────────
// Renvoie { raw, boxes } où boxes[k] = {x,y,w,h} (px écran à l'échelle
// du viewport) pour raw[k], ou null pour un séparateur inséré.
function _buildPageText(textContent, viewport) {
  const scale = viewport.scale || 1;
  const items = [];
  for (const it of textContent.items) {
    if (typeof it.str !== 'string' || it.str.length === 0) {
      // un item peut être un simple saut de ligne (hasEOL sans texte)
      if (it.hasEOL) items.push({ eolOnly: true });
      continue;
    }
    const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
    const fontH = Math.hypot(tx[2], tx[3]) || Math.abs(tx[3]) || 10;
    const x = tx[4];
    const top = tx[5] - fontH;                 // tx[5] = baseline (y bas-origine déjà retournée)
    const wPx = (it.width || 0) * scale;
    // canonisation à la source → offsets stables vs proof-engine
    const str = it.str.normalize('NFC').replace(/­/g, '');
    if (!str) { if (it.hasEOL) items.push({ eolOnly: true }); continue; }
    items.push({ str, x, top, fontH, wPx, hasEOL: !!it.hasEOL });
  }

  // Ordre de lecture : ligne (y) puis x. PDF.js est souvent déjà trié,
  // mais on sécurise les colonnes / ordres exotiques.
  const real = items.filter(i => !i.eolOnly);
  real.sort((a, b) => {
    const tol = Math.min(a.fontH, b.fontH) * 0.5;
    if (Math.abs(a.top - b.top) > tol) return a.top - b.top;
    return a.x - b.x;
  });

  let raw = '';
  const boxes = [];
  let prev = null;
  for (const e of real) {
    if (prev) {
      const sameLine = Math.abs(e.top - prev.top) <= Math.min(e.fontH, prev.fontH) * 0.5;
      if (!sameLine) {
        raw += '\n'; boxes.push(null);
      } else {
        const gap = e.x - (prev.x + prev.wPx);
        const minFH = Math.min(e.fontH, prev.fontH) || prev.fontH || 10;
        if (gap > minFH * 2.5) {
          // Grand vide horizontal = saut de colonne / bloc (mesuré ~36× la
          // police sur des A3 multi-colonnes ; un vrai espace ≈ 0,6×). On COUPE
          // la phrase au lieu de coller : sinon des fragments de colonnes
          // différentes se soudent (« de le cadre », « deux anniversaire ») et
          // génèrent de faux positifs de grammaire. cf. BRIEF V2.1 §7 (colonnes).
          raw += '\n'; boxes.push(null);
        } else if (gap > prev.fontH * 0.25 && !/\s$/.test(raw) && !/^\s/.test(e.str)) {
          raw += ' '; boxes.push(null);
        }
      }
    }
    const n = e.str.length;
    const cw = n > 0 ? e.wPx / n : 0;
    for (let i = 0; i < n; i++) {
      raw += e.str[i];
      boxes.push({ x: e.x + i * cw, y: e.top, w: cw, h: e.fontH });
    }
    prev = e;
  }
  return { raw, boxes };
}

// ── Dé-césure : "exem-\nple" → "exemple" + map analysis→raw ─────
function _dehyphenate(raw) {
  let analysis = '';
  const a2r = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '-' && raw[i + 1] === '\n'
        && /[A-Za-zÀ-ÿ]/.test(raw[i - 1] || '')
        && /[a-zà-ÿ]/.test(raw[i + 2] || '')) {
      i += 1;          // saute '-' (i) et '\n' (i+1 ; le for fait ++)
      continue;
    }
    analysis += raw[i];
    a2r.push(i);
  }
  return { analysis, a2r };
}

// ── Rectangles d'une faute (fusion des boîtes contiguës par ligne) ─
function _issueRects(issue, boxes, a2r) {
  const aEnd = issue.offset + issue.len;
  if (issue.len <= 0 || issue.offset >= a2r.length) return [];
  const rStart = a2r[issue.offset];
  const lastIdx = Math.min(aEnd - 1, a2r.length - 1);
  const rEnd = (a2r[lastIdx] != null ? a2r[lastIdx] : rStart) + 1;
  const rects = [];
  let cur = null;
  for (let k = rStart; k < rEnd && k < boxes.length; k++) {
    const b = boxes[k];
    if (!b) { if (cur) { rects.push(cur); cur = null; } continue; }
    if (!cur) cur = { x: b.x, y: b.y, w: b.w, h: b.h };
    else if (Math.abs(b.y - cur.y) <= cur.h * 0.6) {
      cur.w = (b.x + b.w) - cur.x; cur.h = Math.max(cur.h, b.h);
    } else { rects.push(cur); cur = { x: b.x, y: b.y, w: b.w, h: b.h }; }
  }
  if (cur) rects.push(cur);
  return rects;
}

// ── Détecteur d'exposants (chantier 4, opt-in) ──────────────────
// Signale les ordinaux écrits À PLAT (« 1er ») alors qu'ils devraient être en
// exposant (« 1ᵉʳ »). VÉRIFIÉ sur L'Épaulette (34 p.) : 0 faux positif — les
// ordinaux déjà en exposant ne sont JAMAIS signalés.
// PIÈGE GÉOMÉTRIE (corrigé) : box.y = HAUT (= ligne de base − hauteur). Un
// exposant ayant une hauteur PLUS PETITE, son HAUT descend même quand sa LIGNE
// DE BASE remonte → comparer les tops est FAUX. On compare les LIGNES DE BASE
// (y+h) : exposant correct = hauteur réduite ET ligne de base surélevée.
const _SUP_MAP = { a:'ᵃ', b:'ᵇ', d:'ᵈ', e:'ᵉ', i:'ⁱ', l:'ˡ', m:'ᵐ', n:'ⁿ', o:'ᵒ', r:'ʳ', s:'ˢ', t:'ᵗ' };
function _toSuperscript(s) {
  return String(s).split('').map(c => _SUP_MAP[c.toLowerCase()] || c).join('');
}
function _exposantsEnabled() {
  try { return !!getProofOptions().exposant; } catch (_) { return false; }
}
function _findExposantIssues(analysis, boxes, a2r) {
  const out = [];
  const re = /\b(\d{1,4})(ers|er|res|re|ndes|nds|nde|nd|èmes|ème|es|e)\b/g;
  let m;
  while ((m = re.exec(analysis)) !== null) {
    const base = m[1], suf = m[2];
    const start = m.index, sufStart = m.index + base.length, end = m.index + m[0].length;
    const baseBox = boxes[a2r[sufStart - 1]];
    if (!baseBox || !baseBox.h) continue;
    const baseBaseline = baseBox.y + baseBox.h;
    let measured = 0, supChars = 0;
    for (let k = sufStart; k < end; k++) {
      const b = boxes[a2r[k]];
      if (!b || !b.h) continue;
      measured++;
      const smaller = b.h < baseBox.h * 0.82;
      const raised  = (b.y + b.h) < baseBaseline - baseBox.h * 0.12;
      if (smaller && raised) supChars++;
    }
    if (!measured || supChars === measured) continue;   // déjà en exposant → on ne signale rien
    out.push({
      offset: start, len: end - start,
      type: 'grammar', severity: 'warning',
      message: 'Exposant : « ' + base + suf + ' » devrait s\'écrire « ' + base + _toSuperscript(suf) + ' » (suffixe en exposant).',
      suggestions: [base + _toSuperscript(suf)],
      ruleId: 'keystone_exposant', source: 'keystone',
    });
  }
  return out;
}

// ── Analyse d'une page : texte + fautes + rectangles ────────────
// Renvoie { page, viewport, issues, overlays:[{idx,issue,rects}],
//           isScanned, textLength }. `pageText` (dé-césuré) sert au
//           rapport (P3). Les offsets des issues sont relatifs à pageText.
export async function analyzePage(pdf, pageNum, scale) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: scale || 1.4 });
  const textContent = await page.getTextContent();
  const { raw, boxes } = _buildPageText(textContent, viewport);
  const { analysis, a2r } = _dehyphenate(raw);

  const textLength = analysis.replace(/\s/g, '').length;
  const isScanned = textLength < 2;       // page sans couche texte exploitable

  let issues = [];
  if (!isScanned) {
    const res = await analyze(analysis);
    // Sécurité offsets : la canonisation doit être idempotente ici
    // (on a NFC + retiré U+00AD à la construction). Si la longueur a
    // bougé malgré tout, on garde quand même (rare ; léger décalage).
    issues = res.issues || [];
    if (_exposantsEnabled()) {
      const exp = _findExposantIssues(analysis, boxes, a2r);
      if (exp.length) issues = issues.concat(exp).sort((a, b) => (a.offset - b.offset) || (a.len - b.len));
    }
  }
  const overlays = issues.map((issue, idx) => ({ idx, issue, rects: _issueRects(issue, boxes, a2r) }));

  return { page, viewport, issues, overlays, isScanned, textLength, pageText: analysis };
}

// ── Rendu canvas d'une page ─────────────────────────────────────
export async function renderPageCanvas(page, viewport, canvas) {
  const cv = canvas || document.createElement('canvas');
  cv.width = Math.ceil(viewport.width);
  cv.height = Math.ceil(viewport.height);
  const ctx = cv.getContext('2d', { alpha: false });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return cv;
}

// ── Échelle d'affichage en fonction de la largeur dispo ─────────
export async function fitScale(pdf, pageNum, containerWidth, max) {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const target = Math.min((containerWidth / base.width) * dpr, (max || 2.2) * dpr);
  return Math.max(0.5, target);
}
