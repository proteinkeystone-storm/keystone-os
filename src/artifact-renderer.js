/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artifact Renderer v1.0
   Sprint 3 : JSON Injector / Parser / Component Animator

   renderArtifactResult(container, jsonString, outputSchema)
     → parse la réponse IA
     → mappe chaque clé JSON à son composant visuel
     → anime l'affichage des cartes
   ═══════════════════════════════════════════════════════════════ */

// ── Icônes de composants (utilisées dans la preview schema) ────
export const COMP_ICONS = {
  gauge:          '◎',
  status_badge:   '◉',
  rich_text:      '¶',
  key_points_list:'◆',
  data_card:      '◈',
};

/**
 * Point d'entrée principal.
 * @param {HTMLElement} container   – zone de rendu (inner = artifact-result)
 * @param {string}      jsonString  – réponse brute de l'IA (peut contenir markdown)
 * @param {Object}      outputSchema – artifact_config.output_schema du PAD
 */
export function renderArtifactResult(container, jsonString, outputSchema) {
  let data;
  try {
    const clean = jsonString
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    data = JSON.parse(clean);
  } catch {
    container.innerHTML = `
      <div class="artifact-error">
        <span class="artifact-error-icon">⚠</span>
        <div>
          <strong>Réponse JSON invalide</strong><br>
          <small style="opacity:.7">Vérifiez que le modèle retourne bien un objet JSON pur.</small>
        </div>
        <details style="margin-top:12px;width:100%">
          <summary style="cursor:pointer;font-size:11px;color:var(--text-muted)">Voir la réponse brute</summary>
          <pre class="artifact-raw">${_esc(jsonString.slice(0, 800))}${jsonString.length > 800 ? '…' : ''}</pre>
        </details>
      </div>`;
    return;
  }

  if (!outputSchema || Object.keys(outputSchema).length === 0) {
    container.innerHTML = `<pre class="artifact-raw">${_esc(JSON.stringify(data, null, 2))}</pre>`;
    return;
  }

  // ── Rendu des composants ──────────────────────────────────────
  const cards = Object.entries(outputSchema).map(([key, def]) => {
    const value = data[key];
    if (value === undefined || value === null) return _renderMissing(key, def);
    return _renderComponent(key, value, def);
  });

  container.innerHTML = `<div class="artifact-grid">${cards.join('')}</div>`;
  _animateIn(container);
}

// ── Router composants ──────────────────────────────────────────
function _renderComponent(key, value, def) {
  switch (def.component) {
    case 'gauge':           return _gauge(key, value, def);
    case 'status_badge':    return _statusBadge(key, value, def);
    case 'rich_text':       return _richText(key, value, def);
    case 'key_points_list': return _keyPoints(key, value, def);
    case 'data_card':       return _dataCard(key, value, def);
    default:                return _richText(key, String(value), def);
  }
}

// ── Gauge ──────────────────────────────────────────────────────
function _gauge(key, value, def) {
  const min   = parseFloat(def.config?.min ?? 0);
  const max   = parseFloat(def.config?.max ?? 100);
  const unit  = def.config?.unit  || '';
  const color = def.config?.color || '#c9a84c';
  const num   = parseFloat(value) || 0;
  const pct   = Math.min(100, Math.max(0, ((num - min) / (max - min)) * 100));

  return `
    <div class="artifact-card artifact-gauge" data-pct="${pct}" data-color="${_esc(color)}">
      <div class="artifact-card-label">${_esc(def.label)}</div>
      <div class="gauge-track">
        <div class="gauge-fill" style="width:0%;background:${_esc(color)}"></div>
      </div>
      <div class="gauge-footer">
        <span class="gauge-value" style="color:${_esc(color)}">${num}</span>
        <span class="gauge-unit">${_esc(unit)}</span>
        <span class="gauge-pct" style="color:${_esc(color)}aa">${Math.round(pct)}%</span>
      </div>
    </div>`;
}

// ── Status Badge ───────────────────────────────────────────────
function _statusBadge(key, value, def) {
  const vals     = (def.config?.values || 'Faible,Moyen,Élevé').split(',').map(s => s.trim());
  const idx      = vals.findIndex(v => v.toLowerCase() === String(value).toLowerCase());
  const PALETTE  = ['#4caf80', '#c9a84c', '#e05c5c', '#6496ff', '#b464ff', '#20b2aa'];
  const color    = PALETTE[idx >= 0 ? idx % PALETTE.length : 1];

  return `
    <div class="artifact-card artifact-status-badge">
      <div class="artifact-card-label">${_esc(def.label)}</div>
      <div class="status-pill" style="background:${color}1a;color:${color};border-color:${color}44">
        <span class="status-dot" style="background:${color}"></span>
        ${_esc(String(value))}
      </div>
    </div>`;
}

// ── Rich Text ──────────────────────────────────────────────────
function _richText(key, value, def) {
  return `
    <div class="artifact-card artifact-rich-text artifact-card--full">
      <div class="artifact-card-label">${_esc(def.label)}</div>
      <div class="rich-text-body">${_esc(String(value))}</div>
    </div>`;
}

// ── Key Points List ────────────────────────────────────────────
function _keyPoints(key, value, def) {
  const items   = Array.isArray(value) ? value : [String(value)];
  const tone    = def.config?.tone || 'neutre';
  const TONES   = { positif: { icon: '◆', color: '#4caf80' }, négatif: { icon: '◇', color: '#e05c5c' }, neutre: { icon: '◈', color: '#c9a84c' } };
  const { icon, color } = TONES[tone] || TONES.neutre;

  const liItems = items.map(pt =>
    `<li class="kp-item"><span class="kp-icon" style="color:${color}">${icon}</span><span>${_esc(String(pt))}</span></li>`
  ).join('');

  return `
    <div class="artifact-card artifact-key-points artifact-card--full">
      <div class="artifact-card-label">${_esc(def.label)}</div>
      <ul class="kp-list">${liItems}</ul>
    </div>`;
}

// ── Data Card ──────────────────────────────────────────────────
function _dataCard(key, value, def) {
  const unit     = def.config?.unit   || '';
  const prefix   = def.config?.prefix || '';
  const num      = typeof value === 'number' ? value : parseFloat(value);
  const display  = isNaN(num) ? String(value) : num.toLocaleString('fr-FR');

  return `
    <div class="artifact-card artifact-data-card">
      <div class="artifact-card-label">${_esc(def.label)}</div>
      <div class="dc-value">
        ${prefix ? `<span class="dc-prefix">${_esc(prefix)}</span>` : ''}
        <span class="dc-number">${_esc(display)}</span>
        ${unit   ? `<span class="dc-unit">${_esc(unit)}</span>`   : ''}
      </div>
    </div>`;
}

// ── Carte "clé manquante" ──────────────────────────────────────
function _renderMissing(key, def) {
  return `
    <div class="artifact-card artifact-missing">
      <div class="artifact-card-label">${_esc(def.label)}</div>
      <div class="artifact-missing-hint">— clé <code>"${_esc(key)}"</code> absente de la réponse</div>
    </div>`;
}

// ── Animation d'entrée ─────────────────────────────────────────
function _animateIn(container) {
  // Gauge fill — déclenché après paint
  container.querySelectorAll('.artifact-gauge').forEach(card => {
    const fill  = card.querySelector('.gauge-fill');
    const pct   = parseFloat(card.dataset.pct || 0);
    if (fill) {
      fill.style.transition = 'none';
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          fill.style.transition = 'width 1.3s cubic-bezier(.16,1,.3,1)';
          fill.style.width = `${pct}%`;
        })
      );
    }
  });

  // Stagger reveal pour toutes les cartes
  container.querySelectorAll('.artifact-card').forEach((card, i) => {
    card.style.opacity   = '0';
    card.style.transform = 'translateY(14px)';
    setTimeout(() => {
      card.style.transition = 'opacity .45s ease, transform .45s ease';
      card.style.opacity    = '1';
      card.style.transform  = 'translateY(0)';
    }, 60 + i * 80);
  });
}

// ── Escape HTML ────────────────────────────────────────────────
function _esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
