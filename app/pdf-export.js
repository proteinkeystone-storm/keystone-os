/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — PDF Export Engine v1.0
   Génère un rapport A4 premium à partir d'un artefact IA.

   Usage :
     exportArtifactPDF(pad, rawJson)
       pad     — objet PAD complet (title, subtitle, artifact_config…)
       rawJson — réponse brute de l'IA (JSON string, peut contenir ```json)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Ouvre une fenêtre d'impression A4 avec l'artefact rendu
 * en layout premium Apple/Protein Studio, puis déclenche window.print().
 */
export function exportArtifactPDF(pad, rawJson) {
  // ── Parse JSON ───────────────────────────────────────────────
  let data;
  try {
    const clean = rawJson
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    data = JSON.parse(clean);
  } catch {
    alert('Données JSON invalides — impossible de générer le PDF.\nVérifiez que l\'IA a bien retourné un objet JSON.');
    return;
  }

  const schema = pad.artifact_config?.output_schema || {};
  const now    = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const engine = pad.ai_optimized || 'Claude';

  // ── Rendu des composants ─────────────────────────────────────
  const hasSchema = Object.keys(schema).length > 0;
  let bodyHtml;

  if (!hasSchema) {
    // Pas de schema → dump JSON formaté
    bodyHtml = `<div class="pdf-raw-zone"><pre>${_esc(JSON.stringify(data, null, 2))}</pre></div>`;
  } else {
    const cards = Object.entries(schema).map(([key, def]) => {
      const value = data[key];
      if (value === undefined || value === null) return _pdfMissing(key, def);
      return _pdfComponent(key, value, def);
    }).join('');
    bodyHtml = `<div class="pdf-grid">${cards}</div>`;
  }

  // ── Assemblage HTML ──────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${_esc(pad.title)} — Keystone OS</title>
<style>
  ${_printCSS()}
</style>
</head>
<body>

  <header class="ks-header">
    <div class="ks-brand">
      <div class="ks-logo-hex">⬡</div>
      <div>
        <div class="ks-logo">KEYSTONE OS</div>
        <div class="ks-by">by Protein Studio</div>
      </div>
    </div>
    <div class="ks-doc-info">
      <div class="ks-tool-name">${_esc(pad.title)}</div>
      ${pad.subtitle ? `<div class="ks-tool-sub">${_esc(pad.subtitle)}</div>` : ''}
      <div class="ks-meta-row">
        <span class="ks-engine-chip">${_esc(engine)}</span>
        <span class="ks-date">${now}</span>
      </div>
    </div>
  </header>

  <div class="ks-body">
    ${bodyHtml}
  </div>

  <footer class="ks-footer">
    <span>Généré par <strong>Keystone OS</strong> · Protein Studio</span>
    <span>${now}</span>
  </footer>

</body>
</html>`;

  // ── Ouverture fenêtre et impression ──────────────────────────
  const win = window.open('', '_blank', 'width=920,height=760,menubar=yes');
  if (!win) {
    alert('La fenêtre PDF a été bloquée. Autorisez les popups pour ce site.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();

  // Déclenche l'impression après le rendu complet
  win.addEventListener('load', () => {
    setTimeout(() => win.print(), 350);
  });
}

// ── Router composants ──────────────────────────────────────────
function _pdfComponent(key, value, def) {
  switch (def.component) {
    case 'gauge':           return _pdfGauge(key, value, def);
    case 'status_badge':    return _pdfStatusBadge(key, value, def);
    case 'rich_text':       return _pdfRichText(key, value, def);
    case 'key_points_list': return _pdfKeyPoints(key, value, def);
    case 'data_card':       return _pdfDataCard(key, value, def);
    default:                return _pdfRichText(key, String(value), def);
  }
}

// ── Gauge ──────────────────────────────────────────────────────
function _pdfGauge(key, value, def) {
  const min   = parseFloat(def.config?.min   ?? 0);
  const max   = parseFloat(def.config?.max   ?? 100);
  const unit  = def.config?.unit  || '';
  const color = def.config?.color || '#c9a84c';
  const num   = parseFloat(value) || 0;
  const pct   = Math.min(100, Math.max(0, ((num - min) / (max - min)) * 100));

  return `
    <div class="pdf-card pdf-gauge">
      <div class="pdf-label">${_esc(def.label)}</div>
      <div class="pdf-gauge-track">
        <div class="pdf-gauge-fill" style="width:${pct.toFixed(1)}%;background:${_esc(color)}"></div>
      </div>
      <div class="pdf-gauge-footer">
        <span class="pdf-gauge-value" style="color:${_esc(color)}">${num}<span class="pdf-gauge-unit"> ${_esc(unit)}</span></span>
        <span class="pdf-gauge-pct">${Math.round(pct)} %</span>
      </div>
    </div>`;
}

// ── Status Badge ───────────────────────────────────────────────
function _pdfStatusBadge(key, value, def) {
  const vals    = (def.config?.values || 'Faible,Moyen,Élevé').split(',').map(s => s.trim());
  const idx     = vals.findIndex(v => v.toLowerCase() === String(value).toLowerCase());
  const PALETTE = ['#4caf80', '#c9a84c', '#e05c5c', '#6496ff', '#b464ff', '#20b2aa'];
  const color   = PALETTE[idx >= 0 ? idx % PALETTE.length : 1];

  return `
    <div class="pdf-card pdf-status-badge">
      <div class="pdf-label">${_esc(def.label)}</div>
      <div class="pdf-pill" style="background:${color}18;color:${color};border:1px solid ${color}55">
        <span class="pdf-dot" style="background:${color}"></span>
        ${_esc(String(value))}
      </div>
    </div>`;
}

// ── Rich Text ──────────────────────────────────────────────────
function _pdfRichText(key, value, def) {
  return `
    <div class="pdf-card pdf-full pdf-rich-text">
      <div class="pdf-label">${_esc(def.label)}</div>
      <div class="pdf-text">${_esc(String(value))}</div>
    </div>`;
}

// ── Key Points List ────────────────────────────────────────────
function _pdfKeyPoints(key, value, def) {
  const items = Array.isArray(value) ? value : String(value).split('\n').filter(Boolean);
  const tone  = def.config?.tone || 'neutre';
  const TONES = {
    positif: { color: '#4caf80' },
    négatif: { color: '#e05c5c' },
    neutre:  { color: '#c9a84c' },
  };
  const { color } = TONES[tone] || TONES.neutre;

  const lis = items.map(pt =>
    `<li class="pdf-kp-item"><span class="pdf-kp-bullet" style="color:${color}">◆</span>${_esc(String(pt))}</li>`
  ).join('');

  return `
    <div class="pdf-card pdf-full pdf-key-points">
      <div class="pdf-label">${_esc(def.label)}</div>
      <ul class="pdf-kp-list">${lis}</ul>
    </div>`;
}

// ── Data Card ──────────────────────────────────────────────────
function _pdfDataCard(key, value, def) {
  const unit    = def.config?.unit   || '';
  const prefix  = def.config?.prefix || '';
  const num     = typeof value === 'number' ? value : parseFloat(value);
  const display = isNaN(num) ? String(value) : num.toLocaleString('fr-FR');

  return `
    <div class="pdf-card pdf-data-card">
      <div class="pdf-label">${_esc(def.label)}</div>
      <div class="pdf-dc-value">
        ${prefix ? `<span class="pdf-dc-prefix">${_esc(prefix)}</span>` : ''}
        <span class="pdf-dc-num">${_esc(display)}</span>
        ${unit   ? `<span class="pdf-dc-unit">${_esc(unit)}</span>`   : ''}
      </div>
    </div>`;
}

// ── Clé manquante ──────────────────────────────────────────────
function _pdfMissing(key, def) {
  return `
    <div class="pdf-card pdf-missing">
      <div class="pdf-label">${_esc(def.label)}</div>
      <div class="pdf-missing-hint">— données non disponibles</div>
    </div>`;
}

// ── CSS print A4 ──────────────────────────────────────────────
function _printCSS() {
  return `
    @page {
      size: A4;
      margin: 16mm 18mm 20mm;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #1a1a2e;
      line-height: 1.5;
      background: #fff;
    }

    /* ── Header ── */
    .ks-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 14px;
      border-bottom: 2px solid #1a1a2e;
      margin-bottom: 26px;
    }

    .ks-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ks-logo-hex {
      font-size: 26px;
      color: #c9a84c;
      line-height: 1;
    }

    .ks-logo {
      font-size: 15px;
      font-weight: 900;
      letter-spacing: -0.04em;
      color: #1a1a2e;
      line-height: 1.2;
    }

    .ks-by {
      font-size: 9px;
      color: #999;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .ks-doc-info {
      text-align: right;
    }

    .ks-tool-name {
      font-size: 19px;
      font-weight: 900;
      letter-spacing: -0.03em;
      color: #1a1a2e;
      line-height: 1.2;
    }

    .ks-tool-sub {
      font-size: 11px;
      color: #666;
      margin-top: 2px;
    }

    .ks-meta-row {
      display: flex;
      align-items: center;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 6px;
    }

    .ks-engine-chip {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: #c9a84c18;
      color: #c9a84c;
      border: 1px solid #c9a84c44;
      border-radius: 20px;
      padding: 2px 8px;
    }

    .ks-date {
      font-size: 10px;
      color: #aaa;
    }

    /* ── Body ── */
    .ks-body {
      flex: 1;
    }

    /* ── Grid ── */
    .pdf-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    /* ── Cards ── */
    .pdf-card {
      background: #f8f8fc;
      border: 1px solid #dddde8;
      border-radius: 10px;
      padding: 14px 16px;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .pdf-full {
      grid-column: 1 / -1;
    }

    .pdf-label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #c9a84c;
      margin-bottom: 10px;
    }

    /* ── Gauge ── */
    .pdf-gauge-track {
      height: 8px;
      background: #e4e4ee;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .pdf-gauge-fill {
      height: 100%;
      border-radius: 4px;
    }

    .pdf-gauge-footer {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }

    .pdf-gauge-value {
      font-size: 24px;
      font-weight: 900;
      letter-spacing: -0.04em;
      line-height: 1;
    }

    .pdf-gauge-unit {
      font-size: 12px;
      font-weight: 400;
      color: #888;
    }

    .pdf-gauge-pct {
      font-size: 11px;
      color: #aaa;
    }

    /* ── Status Badge ── */
    .pdf-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }

    .pdf-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* ── Rich Text ── */
    .pdf-text {
      font-size: 12.5px;
      color: #2a2a3e;
      line-height: 1.7;
      white-space: pre-line;
    }

    /* ── Key Points ── */
    .pdf-kp-list {
      list-style: none;
      padding: 0;
    }

    .pdf-kp-item {
      display: flex;
      gap: 8px;
      font-size: 12px;
      color: #2a2a3e;
      line-height: 1.55;
      padding: 5px 0;
      border-bottom: 1px solid #ebebf4;
    }

    .pdf-kp-item:last-child {
      border-bottom: none;
    }

    .pdf-kp-bullet {
      font-size: 7px;
      flex-shrink: 0;
      margin-top: 4px;
    }

    /* ── Data Card ── */
    .pdf-dc-value {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }

    .pdf-dc-num {
      font-size: 30px;
      font-weight: 900;
      letter-spacing: -0.04em;
      color: #1a1a2e;
      line-height: 1;
    }

    .pdf-dc-unit {
      font-size: 13px;
      color: #999;
      font-weight: 400;
    }

    .pdf-dc-prefix {
      font-size: 16px;
      color: #555;
      font-weight: 600;
    }

    /* ── Missing ── */
    .pdf-missing {
      opacity: 0.45;
    }

    .pdf-missing-hint {
      font-style: italic;
      font-size: 11px;
      color: #999;
    }

    /* ── Raw JSON ── */
    .pdf-raw-zone {
      background: #f4f4f8;
      border: 1px solid #dddde8;
      border-radius: 10px;
      padding: 16px;
    }

    .pdf-raw-zone pre {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 11px;
      color: #2a2a3e;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* ── Footer ── */
    .ks-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #bbb;
      border-top: 1px solid #e8e8f0;
      padding: 6px 18mm;
      background: #fff;
    }

    /* ── Print only : hide scrollbar ── */
    @media screen {
      body {
        max-width: 210mm;
        margin: 0 auto;
        padding: 16mm 18mm 24mm;
        background: #fff;
      }
      .ks-footer {
        position: static;
        margin-top: 32px;
      }
    }
  `;
}

// ── Escape HTML ────────────────────────────────────────────────
function _esc(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}
