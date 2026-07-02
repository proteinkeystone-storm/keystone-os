/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Template SVG (P2 refonte Brief Prod)
   ─────────────────────────────────────────────────────────────
   Aperçu vivant du gabarit pour l'aside : dessine EXACTEMENT la
   même géométrie que les rendus PDF/PSD (source de vérité unique :
   kodex-template-geometry.js). Ce que l'utilisateur voit à droite
   EST ce qu'il télécharge dans le kit.

   API : templatePreviewSVG(spec, { maxW, maxH }) → string SVG
   ═══════════════════════════════════════════════════════════════ */

// Couleurs écran des repères (mêmes conventions que le PDF/PSD)
const C = {
  bleed: '#00AEEF',
  trim:  '#ED1C24',
  safe:  '#00A651',
  fold:  '#EC008C',
  mark:  'currentColor',
  paper: 'var(--ws-surface, #fff)',
};

export function templatePreviewSVG(spec, { maxW = 260, maxH = 200 } = {}) {
  if (!spec) return '';
  return spec.kind === 'print' ? _printSVG(spec, maxW, maxH) : _digitalSVG(spec, maxW, maxH);
}

function _printSVG(spec, maxW, maxH) {
  const W = spec.canvas_mm.w, H = spec.canvas_mm.h;
  const k = Math.min(maxW / W, maxH / H);
  const sw = Math.max(0.75, 1 / k);                    // trait ~1px écran

  const rect = (b, color, dash = '') => `
    <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none"
          stroke="${color}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;

  // Roll-up : amorces cyan pleines + zone visible + zone tranquille
  if (spec.rollup) {
    const amorces = spec.rollup.amorces.map(a => `
      <rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" fill="${C.bleed}" opacity="0.55" stroke="none"/>`).join('');
    return `
      <svg viewBox="0 0 ${W} ${H}" width="${Math.round(W * k)}" height="${Math.round(H * k)}"
           xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Aperçu du gabarit roll-up ${_esc(spec.dimsLabel)}">
        <rect x="0" y="0" width="${W}" height="${H}" fill="${C.paper}" stroke="none"/>
        ${amorces}
        ${rect(spec.rollup.visibleBox, C.trim)}
        ${(spec.safeBox.w > 0 && spec.safeBox.h > 0) ? rect(spec.safeBox, C.safe, `${sw * 3} ${sw * 2}`) : ''}
      </svg>`;
  }

  const marks = spec.cropMarks.map(m => `
    <line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}"
          stroke="${C.mark}" stroke-width="${sw * 0.75}" opacity="0.55"/>`).join('');

  const safe = (spec.safeBox.w > 0 && spec.safeBox.h > 0) ? rect(spec.safeBox, C.safe, `${sw * 3} ${sw * 2}`) : '';

  // Plis : pointillés magenta traversants (dans les fichiers du kit,
  // ils ne marquent que les marges — ici on visualise les volets)
  const b = spec.bleedBox;
  const folds = spec.folds ? [
    ...spec.folds.vertical.map(x => `
      <line x1="${x}" y1="${b.y}" x2="${x}" y2="${b.y + b.h}" stroke="${C.fold}"
            stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2}" opacity="0.8"/>`),
    ...spec.folds.horizontal.map(y => `
      <line x1="${b.x}" y1="${y}" x2="${b.x + b.w}" y2="${y}" stroke="${C.fold}"
            stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2}" opacity="0.8"/>`),
  ].join('') : '';

  return `
    <svg viewBox="0 0 ${W} ${H}" width="${Math.round(W * k)}" height="${Math.round(H * k)}"
         xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Aperçu du gabarit ${_esc(spec.dimsLabel)}">
      <rect x="${spec.bleedBox.x}" y="${spec.bleedBox.y}" width="${spec.bleedBox.w}" height="${spec.bleedBox.h}"
            fill="${C.paper}" stroke="none"/>
      ${marks}
      ${folds}
      ${rect(spec.bleedBox, C.bleed)}
      ${rect(spec.trimBox, C.trim)}
      ${safe}
    </svg>`;
}

function _digitalSVG(spec, maxW, maxH) {
  const W = spec.canvas_px.w, H = spec.canvas_px.h;
  const k = Math.min(maxW / W, maxH / H);
  const sw = 1 / k;
  return `
    <svg viewBox="0 0 ${W} ${H}" width="${Math.round(W * k)}" height="${Math.round(H * k)}"
         xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Aperçu du canevas ${_esc(spec.dimsLabel)}">
      <rect x="0" y="0" width="${W}" height="${H}" fill="${C.paper}"
            stroke="${C.trim}" stroke-width="${sw}"/>
    </svg>`;
}

// Légende compacte associée à l'aperçu (HTML)
export function templateLegendHTML(spec) {
  if (!spec) return '';
  if (spec.kind !== 'print') {
    return `<div class="kdx-legend"><span class="kdx-dot" style="background:${C.trim}"></span>Canevas ${_esc(spec.dimsLabel)} · ${_esc(spec.colorProfile)}</div>`;
  }
  const rows = [];
  if (spec.rollup) {
    rows.push([C.bleed, `Amorce basse ${spec.rollup.amorce_bottom_mm} mm — masquée par le mécanisme, fond à prolonger`]);
    rows.push([C.trim, `Zone visible`]);
    rows.push([C.safe, `Zone tranquille ${spec.rollup.safe_inset_mm} mm`]);
    return rows.map(([color, label]) =>
      `<div class="kdx-legend"><span class="kdx-dot" style="background:${color}"></span>${label}</div>`
    ).join('');
  }
  if (spec.real.bleed_mm) rows.push([C.bleed, `Fond perdu ${spec.real.bleed_mm} mm`]);
  rows.push([C.trim, `Coupe — format fini ${_esc(spec.dimsLabel)}`]);
  if (spec.real.safe_mm) rows.push([C.safe, `Zone de sécurité ${spec.real.safe_mm} mm`]);
  if (spec.folds) {
    const panels = spec.folds.panels.map(p => Number.isInteger(p) ? p : String(p).replace('.', ',')).join(' / ');
    rows.push([C.fold, `${_esc(spec.folds.label)} — volets ${panels} mm${spec.folds.asymmetric ? ' (verso en miroir)' : ''}`]);
  }
  return rows.map(([color, label]) =>
    `<div class="kdx-legend"><span class="kdx-dot" style="background:${color}"></span>${label}</div>`
  ).join('');
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
