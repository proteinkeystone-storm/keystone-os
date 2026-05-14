/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Brief PDF export (Sprint Kodex-4.2)
   ─────────────────────────────────────────────────────────────
   Génère un PDF du brief Kodex en ouvrant une fenêtre print-ready
   avec CSS @page A4. L'utilisateur fait Cmd+P → "Enregistrer en
   PDF" depuis le dialog d'impression natif du navigateur.

   Évolution v2 : passer à Paged.js (comme les templates VEFA) pour
   un PDF généré côté serveur + téléchargement direct.
   ═══════════════════════════════════════════════════════════════ */

import { formatDimensions, formatBleed, formatDpi, computeLegalMentions } from './kodex-catalog.js';
import { computeScale } from './kodex-scale.js';

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Conversion markdown → HTML pour le contenu IA
function _mdToHtml(text) {
  let html = _esc(text);
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm,   '<h1 class="md-h1">$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/((?:^- .+(?:\n|$))+)/gm, m => {
    const items = m.trim().split('\n').map(l => '<li>' + l.replace(/^- /, '') + '</li>').join('');
    return `<ul>${items}</ul>`;
  });
  html = html.split(/\n\n+/).map(block => {
    if (/^<(h\d|ul|li|strong)/.test(block.trim())) return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

// Tableau des spécifications techniques
function _renderSpecsTable(std) {
  if (!std) return '';
  const scale = computeScale(std);
  const rows = [
    ['Prestataire', std.vendor],
    ['Produit', std.product_name],
    ['Format fini', formatDimensions(std)],
    std.format_travail ? ['Format de travail', formatDimensions({ format_fini: std.format_travail })] : null,
    formatBleed(std) ? ['Fond perdu', formatBleed(std)] : null,
    std.safe_margin_mm ? ['Marge de sécurité', `${std.safe_margin_mm} mm`] : null,
    formatDpi(std) ? ['Résolution', formatDpi(std)] : null,
    std.color_profile ? ['Colorimétrie', std.color_profile] : null,
    std.export_format ? ['Export attendu', std.export_format] : null,
  ].filter(Boolean);

  let scaleRows = '';
  if (scale && !scale.digital) {
    scaleRows = `
      <tr><td class="cat">Calculateur d'échelle</td><td></td></tr>
      <tr><td class="sub">— Résolution de sortie</td><td>${scale.output_dpi} DPI (fixe)</td></tr>
      <tr><td class="sub">— Échelle de travail</td><td>${_esc(scale.factor_label)}</td></tr>
      ${scale.work_format ? `<tr><td class="sub">— Travail sur maquette</td><td>${scale.work_format.width_mm} × ${scale.work_format.height_mm} mm</td></tr>` : ''}
      ${scale.work_format ? `<tr><td class="sub">— Fichier à produire</td><td>${scale.work_format.width_px} × ${scale.work_format.height_px} px à ${scale.output_dpi} DPI</td></tr>` : ''}
      <tr><td class="sub">— Distance de vue</td><td>${_esc(scale.viewing_distance)} (${_esc(scale.viewing_context.toLowerCase())})</td></tr>
      <tr><td class="sub">— Texte titre minimum</td><td>${scale.min_text_mm} mm de hauteur capitale</td></tr>
      ${scale.min_logo_px ? `<tr><td class="sub">— Logo bitmap minimum</td><td>${scale.min_logo_px} px de large</td></tr>` : ''}
    `;
  }

  return `
    <table class="specs">
      <tbody>
        ${rows.map(([k, v]) => `<tr><td class="cat">${_esc(k)}</td><td>${_esc(v)}</td></tr>`).join('')}
        ${scaleRows}
      </tbody>
    </table>
    ${std.notes ? `<div class="note"><strong>Note du prestataire :</strong> ${_esc(std.notes)}</div>` : ''}
  `;
}

// Mentions légales en liste
function _renderLegalList(sector, fields) {
  const mentions = computeLegalMentions(sector, fields);
  if (!mentions.length) return '';
  return `
    <h2 class="section">Mentions légales obligatoires</h2>
    <ul class="legal">
      ${mentions.map(m => `<li>${_esc(m)}</li>`).join('')}
    </ul>
  `;
}

// Charte du client
function _renderCharte(assets) {
  const c = assets.charte || {};
  const items = [];
  if (c.primary_hex) items.push(`<li><span class="swatch" style="background:${_esc(c.primary_hex)}"></span> <strong>Couleur principale</strong> <code>${_esc(c.primary_hex)}</code></li>`);
  if (c.secondary_hex) items.push(`<li><span class="swatch" style="background:${_esc(c.secondary_hex)}"></span> <strong>Couleur secondaire</strong> <code>${_esc(c.secondary_hex)}</code></li>`);
  if (c.font_title) items.push(`<li><strong>Police titre</strong> : ${_esc(c.font_title)}</li>`);
  if (c.font_body)  items.push(`<li><strong>Police corps</strong> : ${_esc(c.font_body)}</li>`);
  const owned = [];
  if (assets.logo_owned)   owned.push('Logo');
  if (assets.charte_owned) owned.push('Charte');
  if (assets.fonts_owned)  owned.push('Polices');
  if (owned.length) items.push(`<li><strong>Déjà chez Protein Studio</strong> : ${_esc(owned.join(', '))}</li>`);
  if (assets.brand_book_url) items.push(`<li><strong>Brand book</strong> : <a href="${_esc(assets.brand_book_url)}">${_esc(assets.brand_book_url)}</a></li>`);
  if (assets.extra_notes)    items.push(`<li><strong>Notes spéciales</strong> : « ${_esc(assets.extra_notes)} »</li>`);
  if (!items.length) return '';
  return `<h2 class="section">Identité visuelle</h2><ul class="charte">${items.join('')}</ul>`;
}

// Fichiers uploadés (Sprint Kodex-3.1.5)
function _renderUploads(assets) {
  const uploads = assets.uploads || [];
  if (!uploads.length) return '';
  const apiBase = (typeof window !== 'undefined' && window.location)
    ? '' : '';   // les URLs sont déjà absolues via assetUrl()
  const items = uploads.map(u => {
    const sizeStr = u.size_bytes ? `${Math.round(u.size_bytes / 1024)} Ko` : '—';
    const url = u.url || '';
    return `<li>
      <strong>${_esc(u.kind || 'autre')}</strong> — ${_esc(u.filename)}
      <span style="color:#888;">(${_esc(u.mime)}, ${_esc(sizeStr)})</span>
      ${url ? `<br><a href="${_esc(url)}" style="font-family:'SF Mono','Menlo',monospace;font-size:9pt;color:#6366f1;word-break:break-all;">${_esc(url)}</a>` : ''}
    </li>`;
  }).join('');
  return `
    <h2 class="section">Fichiers à transmettre au graphiste</h2>
    <p style="font-size:10pt;color:#555;margin:0 0 10pt 0;">
      Les fichiers ci-dessous ont été téléversés par le client dans Kodex. Communiquez les URLs au graphiste — accès direct, hébergement souverain.
    </p>
    <ul class="uploads" style="font-size:10pt;line-height:1.7;">${items}</ul>
  `;
}

// Données projet
function _renderProjectData(sector, fields) {
  if (!sector) return '';
  const items = [];
  for (const f of sector.fields) {
    const v = fields?.[f.name];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const display = Array.isArray(v) ? v.join(', ') : v;
    items.push(`<li><strong>${_esc(f.label)}</strong> : ${_esc(display)}</li>`);
  }
  if (!items.length) return '';
  return `<h2 class="section">Données projet</h2><ul class="project">${items.join('')}</ul>`;
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════

/**
 * Ouvre une fenêtre print-ready avec le brief Kodex stylé.
 * L'utilisateur fait Cmd+P → "Enregistrer en PDF".
 */
export function exportBriefAsPDF(state, sector) {
  const std    = state.destination?.standard;
  const brief  = state.output?.brief;
  if (!std || !brief) {
    alert('Génère d\'abord un brief avant d\'exporter.');
    return;
  }

  const title = (state.content.fields?.nom_programme || 'Brief Kodex') + ' — ' + std.product_name;
  const dateStr = new Date(brief.generated_at).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const productLine = `${std.vendor} · ${std.product_name}`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${_esc(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
    color: #1a1a1a;
    font-size: 10.5pt;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  /* ─── Page de garde ─── */
  .cover {
    height: 100vh;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 18mm 0;
    page-break-after: always;
  }
  .cover .top { color: #6366f1; font-size: 10pt; letter-spacing: .25em; text-transform: uppercase; font-weight: 700; }
  .cover h1 { margin: 0; font-size: 34pt; font-weight: 900; letter-spacing: -.028em; line-height: 1.1; color: #1a1a1a; max-width: 14cm; }
  .cover .subtitle { color: #6366f1; font-size: 16pt; letter-spacing: -.02em; margin-top: 10pt; }
  .cover .meta { margin-top: 22pt; color: #555; font-size: 11pt; line-height: 1.7; }
  .cover .meta strong { color: #1a1a1a; font-weight: 600; }
  .cover .footer { color: #888; font-size: 9.5pt; border-top: 1px solid #e5e5e5; padding-top: 8pt; }

  /* ─── Contenu ─── */
  h1.md-h1 {
    font-size: 22pt; font-weight: 900; letter-spacing: -.024em;
    margin: 0 0 16pt 0; color: #1a1a1a; line-height: 1.15;
  }
  h2.section, h2 {
    font-size: 13.5pt; font-weight: 800; letter-spacing: -.012em;
    margin: 24pt 0 10pt 0; color: #1a1a1a;
    border-bottom: 1.5px solid #6366f1; padding-bottom: 4pt;
  }
  h3 {
    font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
    margin: 18pt 0 6pt 0; color: #6366f1;
  }
  p { margin: 6pt 0; }
  strong { font-weight: 700; color: #1a1a1a; }
  ul { margin: 6pt 0 10pt 0; padding-left: 18pt; }
  li { margin: 3pt 0; }
  code { font-family: 'SF Mono', 'Menlo', monospace; font-size: 9.5pt; background: #f5f5f5; padding: 1pt 5pt; border-radius: 3px; }
  .swatch { display: inline-block; width: 12pt; height: 12pt; border-radius: 50%; vertical-align: -2pt; border: 1px solid #ddd; margin-right: 4pt; }

  /* ─── Table specs ─── */
  table.specs { width: 100%; border-collapse: collapse; margin: 4pt 0 14pt 0; font-size: 10pt; }
  table.specs td { padding: 7pt 8pt; border-bottom: 1px solid #ececec; vertical-align: top; }
  table.specs td.cat { color: #555; font-weight: 600; width: 38%; }
  table.specs td.sub { padding-left: 18pt; color: #777; font-size: 9.5pt; }
  .note {
    background: #faf6e8; border-left: 3px solid #6366f1;
    padding: 8pt 12pt; margin: 8pt 0 14pt 0;
    font-size: 9.5pt; line-height: 1.6;
  }
  ul.legal { font-size: 9.5pt; color: #555; line-height: 1.7; }
  ul.legal li { margin: 4pt 0; }

  /* ─── Cadre IA ─── */
  .ai-section {
    margin-top: 24pt;
    padding-top: 18pt;
    border-top: 2px solid #ececec;
  }
  .ai-section h1.md-h1, .ai-section h2 { page-break-after: avoid; }
  .ai-section h2 { border-bottom-color: #6366f1; }

  /* Page break entre brief technique et brief IA */
  .page-break { page-break-before: always; }

  /* ─── Footer print ─── */
  @page :left, @page :right {
    @bottom-center {
      content: "Protein Studio · Kodex · " counter(page);
      font-size: 8pt; color: #999;
    }
  }
</style>
</head>
<body>

<!-- ─── PAGE DE GARDE ─── -->
<section class="cover">
  <div class="top">Brief Kodex · ${_esc(state.destination.standard.id.toUpperCase())}</div>
  <div>
    <h1>${_esc(state.content.fields?.nom_programme || 'Brief technique')}</h1>
    <div class="subtitle">${_esc(productLine)}</div>
    <div class="meta">
      ${state.content.fields?.ville ? `<div><strong>Ville</strong> : ${_esc(state.content.fields.ville)}</div>` : ''}
      ${state.content.fields?.livraison ? `<div><strong>Livraison</strong> : ${_esc(state.content.fields.livraison)}</div>` : ''}
      <div><strong>Généré le</strong> : ${_esc(dateStr)}</div>
      <div><strong>Moteur AI</strong> : ${_esc(brief.model || '—')}</div>
    </div>
  </div>
  <div class="footer">
    Document confidentiel généré par Keystone OS pour un usage professionnel.<br>
    Protein Studio · Ollioules, Var, France · protein.keystone@gmail.com
  </div>
</section>

<!-- ─── PARTIE 1 — DONNÉES STRUCTURÉES ─── -->
<h1 class="md-h1">Brief technique pour la fabrication</h1>

<h2 class="section">Contraintes techniques verrouillées</h2>
${_renderSpecsTable(std)}

${_renderProjectData(sector, state.content.fields)}

${_renderCharte(state.assets)}

${_renderUploads(state.assets)}

${_renderLegalList(sector, state.content.fields)}

<!-- ─── PARTIE 2 — SYNTHÈSE IA ─── -->
<div class="page-break"></div>
<div class="ai-section">
  <h1 class="md-h1">Synthèse stratégique et pistes créatives</h1>
  ${_mdToHtml(brief.text)}
</div>

<script>
  // Lancement automatique de la fenêtre d'impression à l'ouverture
  window.addEventListener('load', () => setTimeout(() => window.print(), 600));
</script>

</body>
</html>`;

  // Ouvrir dans une nouvelle fenêtre
  const win = window.open('', '_blank');
  if (!win) {
    alert('Veuillez autoriser les fenêtres pop-up pour exporter le PDF.');
    return;
  }
  win.document.write(html);
  win.document.close();
}
