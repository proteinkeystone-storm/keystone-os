/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Ghost Writer V2 · CORRECTEUR (A-COM-005 / proof)
   ─────────────────────────────────────────────────────────────
   Deux modes partageant le même moteur (app/lib/proof-engine.js) :
     • Texte — on colle du texte, surlignage des fautes + popover
       de correction cliquable.
     • PDF   — on charge un PDF, surlignage sur les pages + popover
       + exports (Phase 2-3, app/lib/proof-pdf.js).

   Principe directeur (fiabilité) : DÉTECTION déterministe (Grammalecte,
   100 % navigateur, offsets exacts) SÉPARÉE de la SUGGESTION IA
   (« ✦ Passe IA approfondie », à la demande, Phase 4).

   Confidentialité : la détection ne quitte jamais le navigateur.

   Réutilise le shell .ws-* commun aux workspaces (workspace.css) +
   help-overlay + burger. Le moteur est chargé en lazy import.
   ═══════════════════════════════════════════════════════════════ */

import { helpButtonHTML, bindHelpButton } from './lib/help-overlay.js';
import { burgerHTML, bindBurger }         from './lib/topbar-burger.js';
import { icon }                            from './lib/ui-icons.js';
import {
  rewriteText, friendlyGhostwriterError, getGhostwriterQuotaMessage,
  getGhostwriterQuotaRemaining, refreshGhostwriterQuota,
} from './ghostwriter.js';

const APP_ID    = 'A-COM-005';
const DRAFT_KEY = 'ks_gw_proof_draft';
const GRAMMALECTE_SRC = 'https://grammalecte.net/';

// ── État ────────────────────────────────────────────────────────
let _root      = null;
let _mode      = 'texte';        // 'texte' | 'pdf'
let _text      = '';             // texte source (canonique après analyse)
let _result    = null;           // { text, issues:[] } de la dernière analyse
let _analyzing = false;
let _engine    = null;           // module proof-engine chargé en lazy
let _aiBusy    = false;          // passe IA en cours
let _aiResult  = null;           // { text } proposé par la passe IA

// — État PDF —
let _pdfMod    = null;           // module proof-pdf chargé en lazy
let _pdf       = null;           // PDFDocumentProxy
let _pdfName   = '';
let _pdfBuf    = null;           // ArrayBuffer (conservé pour l'export P3)
let _pdfTotal  = 0;
let _pdfPage   = 1;
let _pdfBusy   = false;
let _pageData  = null;           // { overlays, issues, isScanned, ... } page courante
let _pdfIssuesAll = null;        // agrégat toutes pages (rapport P3) — { [page]: issues }
let _analyzeToken = 0;           // anti-course : annule l'analyse d'une page quittée

// ══════════════════════════════════════════════════════════════════
// API publique
// ══════════════════════════════════════════════════════════════════
export function openGhostwriterProof(initialMode) {
  if (_root) return;
  _injectStyles();
  _loadDraft();
  // un mode explicite l'emporte sur le mode mémorisé dans le brouillon
  if (initialMode === 'pdf' || initialMode === 'texte') _mode = initialMode;
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';
  // Pré-chauffe le moteur en tâche de fond (dico ~9 Mo) → 1re analyse rapide.
  _ensureEngine().then(m => m && m.warmUp && m.warmUp()).catch(() => {});
  // Rafraîchit le quota GW en fond (pour la passe IA). Silencieux si offline.
  refreshGhostwriterQuota().catch(() => {});
}

export function closeGhostwriterProof() {
  if (!_root) return;
  _saveDraft();
  document.removeEventListener('keydown', _handleKeyDown);
  document.removeEventListener('click', _handleDocClickForPopover, true);
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════════════════
// Persistance brouillon
// ══════════════════════════════════════════════════════════════════
function _saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode: _mode, text: _text })); } catch (_) {}
}
function _loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o && typeof o.text === 'string') _text = o.text;
    if (o && (o.mode === 'pdf' || o.mode === 'texte')) _mode = o.mode;
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════
// Chargement paresseux du moteur
// ══════════════════════════════════════════════════════════════════
async function _ensureEngine() {
  if (_engine) return _engine;
  try { _engine = await import('./lib/proof-engine.js'); }
  catch (e) { _engine = null; _toast('Impossible de charger le moteur de correction', true); }
  return _engine;
}

// ══════════════════════════════════════════════════════════════════
// Shell
// ══════════════════════════════════════════════════════════════════
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app pf-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour (Échap)" aria-label="Retour">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('check-circle', 24)}</span>
        <span class="name">Correcteur</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(APP_ID)}
        <button class="ws-iconbtn" data-act="reset" title="Effacer le texte" aria-label="Effacer">
          ${icon('refresh', 18)}
        </button>
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main" data-slot="main"></main>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('input', _onInput);
  _root.addEventListener('change', _onChange);
  document.addEventListener('keydown', _handleKeyDown);
  bindHelpButton(_root, APP_ID);
  bindBurger(_root);
}

// ══════════════════════════════════════════════════════════════════
// Rendu principal
// ══════════════════════════════════════════════════════════════════
function _renderMain(scrollTop) {
  const main = _root && _root.querySelector('[data-slot="main"]');
  if (!main) return;
  const prev = scrollTop ? 0 : main.scrollTop;
  main.innerHTML = `
    <div class="ws-main-inner pf-wrap">
      ${_renderHero()}
      ${_mode === 'texte' ? _renderTexte() : _renderPdf()}
      ${_renderCredit()}
    </div>
  `;
  main.scrollTop = prev;
  if (_mode === 'pdf' && _pdf) _paintPdfStage();
}

function _renderHero() {
  const tab = (key, label, ic) => `
    <button class="pf-tab${key === _mode ? ' is-active' : ''}" data-act="switch-mode" data-mode="${key}"
            type="button" role="tab" aria-selected="${key === _mode}">
      <span class="pf-tab-icon">${icon(ic, 16)}</span><span>${label}</span>
    </button>`;
  return `
    <div class="pf-hero">
      <div class="pf-family-switch" role="tablist" aria-label="Ghost Writer — Réécriture ou Correction">
        <button class="pf-fam" type="button" role="tab" aria-selected="false" data-act="back-to-rewrite"
                title="Revenir à la réécriture en 3 variantes">
          ${icon('edit', 15)}<span>Réécriture</span>
        </button>
        <button class="pf-fam is-active" type="button" role="tab" aria-selected="true">
          ${icon('check-circle', 15)}<span>Correction</span>
        </button>
      </div>
      <div class="pf-hero-eyebrow">${icon('check-circle', 13)}&nbsp;Correcteur FR — orthographe, grammaire, accords</div>
      <nav class="pf-tabs" role="tablist" aria-label="Mode de correction">
        ${tab('texte', 'Texte', 'file-text')}
        ${tab('pdf', 'PDF', 'file')}
        <span class="pf-tabs-line" aria-hidden="true"></span>
      </nav>
      <p class="pf-hero-sub">${_mode === 'texte'
        ? 'Collez un texte : orthographe, grammaire, accords et conjugaison vérifiés instantanément.'
        : 'Chargez un PDF : les fautes sont surlignées directement sur les pages.'}</p>
    </div>`;
}

// ── Mode TEXTE ──────────────────────────────────────────────────
function _renderTexte() {
  const hasResult = !!_result;
  const stats = hasResult ? _statsOf(_result.issues) : null;
  return `
    <div class="pf-grid">
      <section class="pf-pane">
        <div class="pf-pane-label">Texte à corriger</div>
        <textarea class="pf-source" data-field="text"
          placeholder="Collez ou tapez votre texte ici…">${_esc(_text)}</textarea>
      </section>

      <section class="pf-pane">
        <div class="pf-pane-label">
          Relecture
          <span class="pf-stats">${stats ? _statsBadges(stats) : ''}</span>
        </div>
        <div class="pf-review" data-slot="review">
          ${hasResult ? _renderReview(_result) : `<div class="pf-empty">${icon('check-circle', 30)}<span>Cliquez sur <strong>« Corriger »</strong></span><span>les fautes apparaîtront ici, surlignées et cliquables.</span></div>`}
        </div>
      </section>
    </div>

    <div class="pf-actions-row">
      <button class="pf-btn-primary" data-act="analyze" type="button" ${_analyzing ? 'disabled' : ''}>
        ${_analyzing
          ? '<span class="pf-spinner"></span><span>Analyse…</span>'
          : `${icon('check-circle', 17)}<span>Corriger</span>`}
      </button>
      <button class="pf-btn-ghost pf-ai-btn" data-act="ai-pass" type="button" ${(_aiBusy || _analyzing) ? 'disabled' : ''}
              title="Améliore le style et les tournures via l'IA (au-delà de l'orthographe) — consomme votre quota Ghost Writer">
        ${_aiBusy ? '<span class="pf-spinner"></span> Passe IA…' : '✦ Passe IA approfondie'}
      </button>
      <span class="pf-charcount">${_text.length} caractères</span>
    </div>
    ${(_aiBusy || _aiResult) ? _renderAiPanel() : ''}`;
}

// Panneau « passe IA » : reformulation/amélioration du texte (style,
// tournures) que la détection déterministe ne couvre pas. L'IA ne sert
// JAMAIS de détecteur d'offsets (brief §2) — c'est une surcouche reformule.
function _renderAiPanel() {
  if (_aiBusy && !_aiResult) {
    return `<div class="pf-ai-panel">
      <div class="pf-ai-head">${icon('sparkles', 15)} Passe IA approfondie</div>
      <div class="pf-empty"><span class="pf-spinner"></span>&nbsp; L'IA peaufine le style…</div>
    </div>`;
  }
  if (!_aiResult) return '';
  return `<div class="pf-ai-panel">
    <div class="pf-ai-head">${icon('sparkles', 15)} Version améliorée par l'IA
      <span class="pf-ai-sub">style &amp; tournures — au-delà de l'orthographe</span></div>
    <div class="pf-ai-text">${_esc(_aiResult.text)}</div>
    <div class="pf-ai-actions">
      <button class="pf-mini-btn" data-act="ai-copy">Copier</button>
      <button class="pf-mini-btn pf-mini-primary" data-act="ai-use">Utiliser ce texte &amp; re-vérifier</button>
      <button class="pf-mini-btn" data-act="ai-dismiss">Masquer</button>
    </div>
  </div>`;
}

// ── Mode PDF ────────────────────────────────────────────────────
function _renderPdf() {
  if (!_pdf) {
    return `
    <div class="pf-pdf-shell">
      <label class="pf-drop" for="pf-file">
        ${icon('upload-cloud', 34)}
        <div class="pf-drop-title">Charger un PDF</div>
        <p class="pf-drop-sub">PDF « texte » (avec couche texte sélectionnable). Les fautes seront
        surlignées directement sur les pages. Le fichier reste <strong>100 % dans votre navigateur</strong>.</p>
        <span class="pf-drop-btn">Choisir un fichier…</span>
        <input id="pf-file" class="pf-file-input" type="file" accept="application/pdf,.pdf" data-act="pdf-file">
      </label>
    </div>`;
  }
  const stats = (_pageData && !_pageData.isScanned) ? _statsOf(_pageData.issues) : null;
  return `
    <div class="pf-pdf-shell pf-pdf-loaded">
      <div class="pf-pdf-toolbar">
        <div class="pf-pdf-file" title="${_esc(_pdfName)}">${icon('file', 15)}<span>${_esc(_pdfName)}</span></div>
        <div class="pf-pdf-nav">
          <button class="pf-iconbtn" data-act="pdf-prev" ${_pdfPage <= 1 ? 'disabled' : ''} aria-label="Page précédente">${icon('chevron-left', 18)}</button>
          <span class="pf-pdf-pageno">Page ${_pdfPage} / ${_pdfTotal}</span>
          <button class="pf-iconbtn" data-act="pdf-next" ${_pdfPage >= _pdfTotal ? 'disabled' : ''} aria-label="Page suivante">${icon('chevron-right', 18)}</button>
        </div>
        <div class="pf-pdf-tools">
          <span class="pf-stats">${stats ? _statsBadges(stats) : ''}</span>
          <button class="pf-btn-ghost pf-btn-sm" data-act="pdf-report" ${_pdfBusy ? 'disabled' : ''}>${icon('file-text', 14)} Rapport</button>
          <button class="pf-btn-ghost pf-btn-sm" data-act="pdf-export" ${_pdfBusy ? 'disabled' : ''}>${icon('download', 14)} PDF annoté</button>
          <button class="pf-iconbtn" data-act="pdf-close-file" title="Fermer le PDF">${icon('x', 16)}</button>
        </div>
      </div>
      <div class="pf-pdf-stage" data-slot="pdf-stage">
        <div class="pf-empty"><span class="pf-spinner"></span>&nbsp; Rendu de la page…</div>
      </div>
    </div>`;
}

// Charge le module PDF (PDF.js) en lazy.
async function _ensurePdfMod() {
  if (_pdfMod) return _pdfMod;
  try { _pdfMod = await import('./lib/proof-pdf.js'); }
  catch (e) { _pdfMod = null; _toast('Impossible de charger le moteur PDF', true); }
  return _pdfMod;
}

// Ouvre un fichier PDF choisi par l'utilisateur.
async function _loadPdfFile(file) {
  if (!file) return;
  const mod = await _ensurePdfMod(); if (!mod) return;
  _pdfBusy = true;
  try {
    const buf = await file.arrayBuffer();
    _pdfBuf = buf;
    // PDF.js transfère/neutralise le buffer → on garde une copie pour l'export P3
    _pdf = await mod.loadPdf(buf.slice(0));
    _pdfName = file.name || 'document.pdf';
    _pdfTotal = _pdf.numPages;
    _pdfPage = 1;
    _pageData = null;
    _pdfIssuesAll = {};
  } catch (e) {
    _pdf = null;
    _toast('PDF illisible : ' + ((e && e.message) || e), true);
  } finally {
    _pdfBusy = false;
    _renderMain(true);
  }
}

function _closePdf() {
  _pdf = null; _pdfBuf = null; _pdfName = ''; _pdfTotal = 0; _pdfPage = 1;
  _pageData = null; _pdfIssuesAll = null; _closePopover();
  _renderMain(true);
}

function _pdfGoto(delta) {
  const next = _pdfPage + delta;
  if (next < 1 || next > _pdfTotal) return;
  _pdfPage = next; _pageData = null; _closePopover();
  _renderMain();         // re-render toolbar (pageno) ; _paintPdfStage suit
}

// Rend la page courante + surlignages (anti-course via _analyzeToken).
async function _paintPdfStage() {
  const stage = _root && _root.querySelector('[data-slot="pdf-stage"]');
  if (!stage || !_pdf) return;
  const mod = await _ensurePdfMod(); if (!mod) return;
  const token = ++_analyzeToken;
  const dpr = window.devicePixelRatio || 1;
  try {
    const cssW = Math.min((stage.clientWidth || 820) - 8, 1100);
    const page0 = await _pdf.getPage(_pdfPage);
    const base = page0.getViewport({ scale: 1 });
    const cssScale = Math.min(cssW / base.width, 1.7);
    const renderScale = cssScale * dpr;
    const data = await mod.analyzePage(_pdf, _pdfPage, renderScale);
    if (token !== _analyzeToken) return;                 // page quittée → abandon
    _pageData = data;
    if (_pdfIssuesAll) _pdfIssuesAll[_pdfPage] = data.issues;

    if (data.isScanned) {
      stage.innerHTML = `<div class="pf-empty pf-scanned">${icon('eye-off', 28)}
        <div style="margin-top:10px;font-weight:600">Page sans couche texte</div>
        <p style="max-width:420px">Cette page semble être une image scannée — non supportée pour l'instant
        (la reconnaissance de texte / OCR arrivera plus tard).</p></div>`;
      _refreshPdfStats();
      return;
    }

    const canvas = await mod.renderPageCanvas(data.page, data.viewport);
    if (token !== _analyzeToken) return;
    canvas.className = 'pf-canvas';
    canvas.style.width = (data.viewport.width / dpr) + 'px';
    canvas.style.height = (data.viewport.height / dpr) + 'px';

    const wrap = document.createElement('div');
    wrap.className = 'pf-canvas-wrap';
    wrap.style.width = (data.viewport.width / dpr) + 'px';
    wrap.style.height = (data.viewport.height / dpr) + 'px';
    wrap.appendChild(canvas);

    const layer = document.createElement('div');
    layer.className = 'pf-ov-layer';
    for (const ov of data.overlays) {
      for (const r of ov.rects) {
        const d = document.createElement('div');
        d.className = 'pf-ov pf-' + ov.issue.type;
        d.style.left = (r.x / dpr) + 'px';
        d.style.top = (r.y / dpr) + 'px';
        d.style.width = Math.max(3, r.w / dpr) + 'px';
        d.style.height = (r.h / dpr) + 'px';
        d.dataset.ovidx = ov.idx;
        d.title = (ov.issue.type === 'spelling' ? 'Orthographe' : 'Grammaire') + ' — cliquez';
        layer.appendChild(d);
      }
    }
    wrap.appendChild(layer);
    stage.innerHTML = '';
    stage.appendChild(wrap);
    _refreshPdfStats();
  } catch (e) {
    if (token !== _analyzeToken) return;
    stage.innerHTML = `<div class="pf-empty">Erreur de rendu : ${_esc((e && e.message) || String(e))}</div>`;
  }
}

function _refreshPdfStats() {
  const host = _root && _root.querySelector('.pf-pdf-tools .pf-stats');
  const stats = (_pageData && !_pageData.isScanned) ? _statsOf(_pageData.issues) : null;
  if (host && stats) host.innerHTML = _statsBadges(stats);
}

// ══════════════════════════════════════════════════════════════════
// Exports PDF (Phase 3) : rapport de corrections + PDF annoté
// ══════════════════════════════════════════════════════════════════

// Analyse TOUTES les pages à l'échelle 1 (→ coordonnées = points PDF,
// origine haut-gauche). Sert au rapport et à l'annotation.
async function _analyzeAllPages(onProgress) {
  const mod = await _ensurePdfMod();
  if (!mod || !_pdf) return [];
  const pages = [];
  for (let n = 1; n <= _pdfTotal; n++) {
    if (onProgress) onProgress(n, _pdfTotal);
    const data = await mod.analyzePage(_pdf, n, 1);     // scale 1 → points
    pages.push({
      n, issues: data.issues, overlays: data.overlays, isScanned: data.isScanned,
      width: data.viewport.width, height: data.viewport.height, pageText: data.pageText,
    });
  }
  return pages;
}

function _download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

function _baseName() { return (_pdfName || 'document').replace(/\.pdf$/i, ''); }

async function _handlePdfReport() {
  if (!_pdf || _pdfBusy) return;
  _pdfBusy = true; _renderMain();
  try {
    _toast('Analyse de toutes les pages…');
    const pages = await _analyzeAllPages((n, t) => _setProgress(`Analyse ${n}/${t}…`));
    const rows = [];
    for (const p of pages) {
      if (p.isScanned) { rows.push({ page: p.n, scanned: true }); continue; }
      for (const it of p.issues) {
        rows.push({
          page: p.n, type: it.type,
          word: (p.pageText || '').substr(it.offset, it.len),
          sugg: (it.suggestions || []).slice(0, 4).join(', '),
          msg: it.message || '',
        });
      }
    }
    const total = rows.filter(r => !r.scanned).length;
    _download(new Blob([_buildReportHTML(rows, total)], { type: 'text/html;charset=utf-8' }),
              _baseName() + '-corrections.html');
    _toast(`Rapport : ${total} correction${total > 1 ? 's' : ''}`);
  } catch (e) {
    _toast('Échec du rapport : ' + ((e && e.message) || e), true);
  } finally { _pdfBusy = false; _renderMain(); }
}

function _buildReportHTML(rows, total) {
  const esc = _esc;
  const body = rows.map(r => r.scanned
    ? `<tr class="sc"><td>${r.page}</td><td colspan="4"><em>Page scannée (sans couche texte) — non analysée</em></td></tr>`
    : `<tr>
        <td>${r.page}</td>
        <td><span class="t t-${r.type}">${r.type === 'spelling' ? 'Orthographe' : 'Grammaire'}</span></td>
        <td class="w">${esc(r.word)}</td>
        <td class="s">${esc(r.sugg) || '—'}</td>
        <td class="m">${esc(r.msg)}</td>
      </tr>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Corrections — ${esc(_baseName())}</title>
<style>
  body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1a1a1f;max-width:900px;margin:32px auto;padding:0 20px}
  h1{font-weight:900;letter-spacing:-.02em;font-size:24px;margin:0 0 4px}
  .sub{color:#666;margin:0 0 22px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888}
  .w{font-weight:600;color:#c0392b}.s{color:#1a7a46}.m{color:#555}
  .t{font-size:11px;font-weight:700;padding:2px 7px;border-radius:20px}
  .t-spelling{background:#fde8e8;color:#c0392b}.t-grammar{background:#fdf0dc;color:#b9770e}
  tr.sc td{color:#999}
  @media print{.sub{color:#666}}
</style></head><body>
  <h1>Rapport de corrections</h1>
  <p class="sub">${esc(_baseName())}.pdf — ${total} correction${total > 1 ? 's' : ''} · généré localement par Keystone · moteur Grammalecte (GPL v3)</p>
  <table><thead><tr><th>Page</th><th>Type</th><th>Texte</th><th>Suggestion</th><th>Détail</th></tr></thead>
  <tbody>${body || '<tr><td colspan="5"><em>Aucune faute détectée 👌</em></td></tr>'}</tbody></table>
</body></html>`;
}

async function _handlePdfExport() {
  if (!_pdfBuf || _pdfBusy) return;
  _pdfBusy = true; _renderMain();
  try {
    _toast('Chargement de l\'outil d\'annotation…');
    let PDFLib;
    try { PDFLib = await import('https://esm.sh/pdf-lib@1.17.1'); }
    catch (e) { _toast('Impossible de charger pdf-lib (hors-ligne ?)', true); return; }
    const { PDFDocument, rgb, StandardFonts } = PDFLib;

    const pages = await _analyzeAllPages((n, t) => _setProgress(`Analyse ${n}/${t}…`));
    const doc = await PDFDocument.load(_pdfBuf.slice(0));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const docPages = doc.getPages();
    let total = 0;

    for (const p of pages) {
      const pg = docPages[p.n - 1];
      if (!pg || p.isScanned) continue;
      const { height } = pg.getSize();
      for (const ov of p.overlays) {
        const color = ov.issue.type === 'spelling' ? rgb(0.85, 0.18, 0.18) : rgb(0.93, 0.55, 0.08);
        for (const r of ov.rects) {
          const yBottom = height - r.y - r.h;              // top-left → bottom-left
          // surlignage translucide + soulignement (ne casse pas la mise en page)
          pg.drawRectangle({ x: r.x, y: yBottom, width: r.w, height: r.h, color, opacity: 0.18 });
          pg.drawRectangle({ x: r.x, y: yBottom - 0.5, width: r.w, height: 1.4, color, opacity: 0.95 });
          total++;
        }
      }
    }
    _appendSummaryPages(doc, pages, font, rgb);
    const bytes = await doc.save();
    _download(new Blob([bytes], { type: 'application/pdf' }), _baseName() + '-annoté.pdf');
    _toast(`PDF annoté : ${total} faute${total > 1 ? 's' : ''} surlignée${total > 1 ? 's' : ''}`);
  } catch (e) {
    _toast('Échec de l\'export : ' + ((e && e.message) || e), true);
  } finally { _pdfBusy = false; _renderMain(); }
}

// Pages "Corrections" ajoutées à la fin (n'altère pas l'original).
function _appendSummaryPages(doc, pages, font, rgb) {
  const W = 595.28, H = 841.89;            // A4 portrait (points)
  const margin = 48, lh = 15;
  let page = doc.addPage([W, H]);
  let y = H - margin;
  const line = (text, size, color, indent) => {
    if (y < margin + lh) { page = doc.addPage([W, H]); y = H - margin; }
    page.drawText(_pdfSafe(text).slice(0, 96), { x: margin + (indent || 0), y, size: size || 10, font, color: color || rgb(0.1, 0.1, 0.12) });
    y -= (size || 10) + 5;
  };
  line('Corrections — ' + _baseName(), 18, rgb(0.05, 0.05, 0.07));
  y -= 6;
  line('Généré localement par Keystone · moteur Grammalecte (GPL v3) · le PDF n\'a pas quitté le navigateur.', 9, rgb(0.45, 0.45, 0.5));
  y -= 10;
  let total = 0;
  for (const p of pages) {
    if (p.isScanned || !p.issues.length) continue;
    line('Page ' + p.n, 12, rgb(0.2, 0.3, 0.7));
    for (const it of p.issues) {
      const word = (p.pageText || '').substr(it.offset, it.len).replace(/\s+/g, ' ');
      const sugg = (it.suggestions || []).slice(0, 3).join(', ');
      const tag = it.type === 'spelling' ? '[ortho]' : '[gramm]';
      line(`${tag} « ${word} »${sugg ? '  →  ' + sugg : ''}`, 10, rgb(0.15, 0.15, 0.18), 14);
      total++;
    }
    y -= 4;
  }
  if (!total) line('Aucune faute détectée.', 11, rgb(0.2, 0.5, 0.3));
}

// Petit indicateur de progression réutilisant le toast.
function _setProgress(msg) {
  const el = document.getElementById('pf-toast');
  if (el) { el.textContent = msg; el.className = 'pf-toast pf-toast-show'; }
}

// La police standard de pdf-lib (Helvetica) est en WinAnsi : elle ne sait
// pas encoder → ' " … etc. On normalise vers un sous-ensemble sûr
// (ASCII + accents latins). Les guillemets « » (0xAB/0xBB) restent OK.
function _pdfSafe(s) {
  return String(s == null ? '' : s)
    .replace(/[→]/g, '->').replace(/[←]/g, '<-')
    .replace(/[‘’′]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, '?');
}

// ── Rendu « relecture » : texte avec marques cliquables ─────────
function _renderReview(result) {
  const { text, issues } = result;
  if (!issues.length) {
    return `<div class="pf-clean">${icon('check-circle', 22)}<div>Aucune faute détectée. 👌</div></div>`;
  }
  return `<div class="pf-doc" data-slot="doc">${_buildMarkedHTML(text, issues)}</div>`;
}

// Construit le HTML surligné : texte échappé + <mark> autour de chaque
// issue. Les chevauchements sont ignorés (on garde la 1re marque) — un
// span = une faute. white-space:pre-wrap pour conserver les retours ligne.
function _buildMarkedHTML(text, issues) {
  let html = '';
  let cursor = 0;
  for (let i = 0; i < issues.length; i++) {
    const it = issues[i];
    const start = it.offset;
    const end = it.offset + it.len;
    if (start < cursor || it.len <= 0) continue;       // chevauchement / vide → skip
    html += _esc(text.slice(cursor, start));
    const seg = _esc(text.slice(start, end));
    html += `<mark class="pf-mark pf-${it.type}" data-i="${i}" tabindex="0" role="button"
      title="${it.type === 'spelling' ? 'Orthographe' : 'Grammaire'} — cliquez pour corriger">${seg}</mark>`;
    cursor = end;
  }
  html += _esc(text.slice(cursor));
  return html;
}

function _renderCredit() {
  return `
    <footer class="pf-credit">
      Correction propulsée par Grammalecte (GPL v3), exécutée localement dans votre navigateur — rien n'est envoyé en ligne. <a href="${GRAMMALECTE_SRC}" target="_blank" rel="noopener noreferrer">grammalecte.net</a>
    </footer>`;
}

// ══════════════════════════════════════════════════════════════════
// Stats
// ══════════════════════════════════════════════════════════════════
function _statsOf(issues) {
  let spell = 0, gram = 0;
  for (const it of issues) { if (it.type === 'spelling') spell++; else gram++; }
  return { total: issues.length, spell, gram };
}
function _statsBadges(s) {
  if (!s.total) return `<span class="pf-badge pf-badge-ok">0 faute</span>`;
  const parts = [];
  if (s.spell) parts.push(`<span class="pf-badge pf-badge-spell">${s.spell} ortho</span>`);
  if (s.gram)  parts.push(`<span class="pf-badge pf-badge-gram">${s.gram} grammaire</span>`);
  return parts.join('');
}

// ══════════════════════════════════════════════════════════════════
// Événements
// ══════════════════════════════════════════════════════════════════
function _onClick(e) {
  const mark = e.target.closest('.pf-mark');
  if (mark) { _openTextPopover(mark); return; }
  const ov = e.target.closest('.pf-ov');
  if (ov) { _openPdfPopover(ov); return; }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  switch (btn.dataset.act) {
    case 'close':          closeGhostwriterProof(); return;
    case 'back-to-rewrite':_backToRewrite(); return;
    case 'switch-mode':    _switchMode(btn.dataset.mode); return;
    case 'analyze':        _handleAnalyze(); return;
    case 'reset':          _handleReset(); return;
    case 'ai-pass':        _handleAiPass(); return;
    case 'ai-copy':        _aiCopy(); return;
    case 'ai-use':         _aiUse(); return;
    case 'ai-dismiss':     _aiResult = null; _renderMain(); return;
    case 'pdf-prev':       _pdfGoto(-1); return;
    case 'pdf-next':       _pdfGoto(1); return;
    case 'pdf-close-file': _closePdf(); return;
    case 'pdf-report':     _handlePdfReport(); return;
    case 'pdf-export':     _handlePdfExport(); return;
  }
}

function _onChange(e) {
  const el = e.target;
  if (el && el.dataset && el.dataset.act === 'pdf-file') {
    const f = el.files && el.files[0];
    if (f) _loadPdfFile(f);
  }
}

function _onInput(e) {
  const el = e.target;
  if (el.dataset && el.dataset.field === 'text') {
    _text = el.value;
    _saveDraft();
    const meta = _root.querySelector('.pf-charcount');
    if (meta) meta.textContent = `${_text.length} caractères`;
  }
}

function _handleKeyDown(e) {
  if (!_root) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (e.key === 'Escape') {
    if (_root.querySelector('[data-slot="pf-pop"]')) { _closePopover(); return; }
    closeGhostwriterProof(); return;
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && tag === 'TEXTAREA') {
    e.preventDefault(); _handleAnalyze();
  }
}

function _switchMode(mode) {
  if (mode === _mode || (mode !== 'texte' && mode !== 'pdf')) return;
  _mode = mode; _saveDraft(); _closePopover(); _renderMain(true);
}

// Bascule vers la moitié « Réécriture » (V1) : swap propre de workspace.
async function _backToRewrite() {
  try {
    const m = await import('./ghostwriter-studio.js');
    closeGhostwriterProof();
    m.openGhostwriterStudio();
  } catch (e) {
    _toast('Impossible d\'ouvrir la réécriture', true);
  }
}

function _handleReset() {
  if (!confirm('Effacer le texte et la relecture ?')) return;
  _text = ''; _result = null; _closePopover();
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
  _renderMain(true);
}

// ══════════════════════════════════════════════════════════════════
// Analyse
// ══════════════════════════════════════════════════════════════════
async function _handleAnalyze() {
  if (_analyzing) return;
  const text = (_text || '').trim();
  if (text.length < 2) { _toast('Texte trop court', true); return; }

  const eng = await _ensureEngine();
  if (!eng) return;

  _analyzing = true; _closePopover(); _renderMain();
  try {
    const res = await eng.analyze(_text);
    _result = res;
    _text = res.text;                 // on bascule sur le texte canonique
    _saveDraft();
    const s = _statsOf(res.issues);
    _toast(s.total ? `${s.total} faute${s.total > 1 ? 's' : ''} détectée${s.total > 1 ? 's' : ''}` : 'Aucune faute 👌');
  } catch (err) {
    _result = null;
    _toast('Erreur d\'analyse : ' + ((err && err.message) || err), true);
  } finally {
    _analyzing = false; _renderMain();
  }
}

// ── Passe IA approfondie (couche 2, à la demande, quota GW) ─────
async function _handleAiPass() {
  if (_aiBusy || _analyzing) return;
  const text = (_text || '').trim();
  if (text.length < 5)    { _toast('Texte trop court pour la passe IA', true); return; }
  if (text.length > 5000) { _toast('Texte trop long (max 5000) pour la passe IA', true); return; }
  if (getGhostwriterQuotaRemaining() === 0) { _toast(getGhostwriterQuotaMessage(), true); return; }

  _aiBusy = true; _aiResult = null; _renderMain();
  try {
    // Réutilise le pipeline Ghost Writer (Mistral / BYOK) : action « improve »
    // = améliore/fluidifie en préservant les tournures (≈ relecture de style).
    const res = await rewriteText(_text, {
      mode: 'long', action: 'improve', tone: '', audience: '', intent: '', lengthTarget: 'keep',
    });
    const v = (res && res.variants && res.variants[0]) || null;
    if (!v || !v.text) throw new Error('Réponse IA vide');
    _aiResult = { text: v.text };
    _toast('Proposition IA prête ✦');
  } catch (err) {
    _aiResult = null;
    _toast('Passe IA : ' + friendlyGhostwriterError(err), true);
  } finally {
    _aiBusy = false; _renderMain();
  }
}

function _aiCopy() {
  if (!_aiResult) return;
  try { navigator.clipboard.writeText(_aiResult.text); _toast('Version IA copiée'); } catch (_) {}
}

async function _aiUse() {
  if (!_aiResult) return;
  _text = _aiResult.text;
  _aiResult = null;
  _saveDraft();
  await _handleAnalyze();   // re-passe Grammalecte sur le texte amélioré
}

// ══════════════════════════════════════════════════════════════════
// Popover de correction
// ══════════════════════════════════════════════════════════════════
// Popover générique (texte = applique la correction ; PDF = la copie).
// cfg = { type, message, suggestions:[], onPick(s), pickHint, onIgnore? }
function _openPopover(anchorEl, cfg) {
  _closePopover();
  const suggs = (cfg.suggestions || []).slice(0, 8);
  const pop = document.createElement('div');
  pop.className = 'pf-pop';
  pop.dataset.slot = 'pf-pop';
  pop.innerHTML = `
    <div class="pf-pop-head">
      <span class="pf-pop-type pf-${cfg.type}">${cfg.type === 'spelling' ? 'Orthographe' : 'Grammaire'}</span>
      <button class="pf-pop-x" data-pop="close" aria-label="Fermer">${icon('x', 14)}</button>
    </div>
    ${cfg.message ? `<div class="pf-pop-msg">${_esc(cfg.message)}</div>` : ''}
    <div class="pf-pop-suggs">
      ${suggs.length
        ? suggs.map(s => `<button class="pf-sugg" data-pop="pick" data-s="${_esc(s)}">${_esc(s)}</button>`).join('')
        : '<span class="pf-pop-nosugg">Pas de suggestion automatique.</span>'}
    </div>
    ${(cfg.pickHint && suggs.length) ? `<div class="pf-pop-hint">${_esc(cfg.pickHint)}</div>` : ''}
    ${cfg.onIgnore ? `<div class="pf-pop-foot"><button class="pf-pop-ignore" data-pop="ignore">Ignorer cette faute</button></div>` : ''}
  `;
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pop]'); if (!b) return;
    if (b.dataset.pop === 'close')  { _closePopover(); return; }
    if (b.dataset.pop === 'pick')   { cfg.onPick && cfg.onPick(b.dataset.s); _closePopover(); return; }
    if (b.dataset.pop === 'ignore') { cfg.onIgnore && cfg.onIgnore(); _closePopover(); return; }
  });
  _root.appendChild(pop);
  _positionPopover(pop, anchorEl);
  setTimeout(() => document.addEventListener('click', _handleDocClickForPopover, true), 0);
}

// Texte : appliquer la suggestion modifie le texte + ré-analyse.
function _openTextPopover(markEl) {
  const idx = parseInt(markEl.dataset.i, 10);
  const it = _result && _result.issues[idx];
  if (!it) return;
  _openPopover(markEl, {
    type: it.type, message: it.message, suggestions: it.suggestions,
    onPick: (s) => _applySuggestion(idx, s),
    onIgnore: () => _ignoreIssue(idx),
  });
}

// PDF : on ne réécrit pas le PDF (hors scope) → la suggestion se copie.
function _openPdfPopover(ovEl) {
  const idx = parseInt(ovEl.dataset.ovidx, 10);
  const o = _pageData && _pageData.overlays[idx];
  if (!o) return;
  _openPopover(ovEl, {
    type: o.issue.type, message: o.issue.message, suggestions: o.issue.suggestions,
    onPick: (s) => { try { navigator.clipboard.writeText(s); } catch (_) {} _toast('Copié : ' + s); },
    pickHint: 'Cliquez une suggestion pour la copier (le PDF n\'est pas modifié).',
  });
}

function _positionPopover(pop, markEl) {
  const r = markEl.getBoundingClientRect();
  const pw = Math.min(320, window.innerWidth - 24);
  pop.style.width = pw + 'px';
  let left = r.left + window.scrollX;
  left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
  let top = r.bottom + window.scrollY + 8;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  // si déborde en bas, place au-dessus
  requestAnimationFrame(() => {
    const pr = pop.getBoundingClientRect();
    if (pr.bottom > window.innerHeight - 8) {
      pop.style.top = (r.top + window.scrollY - pr.height - 8) + 'px';
    }
  });
}

function _handleDocClickForPopover(e) {
  if (e.target.closest('[data-slot="pf-pop"]') || e.target.closest('.pf-mark') || e.target.closest('.pf-ov')) return;
  _closePopover();
}

function _closePopover() {
  document.removeEventListener('click', _handleDocClickForPopover, true);
  const p = _root && _root.querySelector('[data-slot="pf-pop"]');
  if (p) p.remove();
}

// ── Appliquer une suggestion : patch le texte canonique + ré-analyse ──
async function _applySuggestion(idx, replacement) {
  const it = _result && _result.issues[idx];
  if (!it) return;
  const before = _text.slice(0, it.offset);
  const after  = _text.slice(it.offset + it.len);
  _text = before + replacement + after;
  _closePopover();
  _saveDraft();
  // ré-analyse pour recalculer les offsets (ils ont bougé)
  await _handleAnalyze();
}

function _ignoreIssue(idx) {
  if (!_result) return;
  _result.issues.splice(idx, 1);
  _closePopover();
  // re-render review uniquement
  const review = _root.querySelector('[data-slot="review"]');
  if (review) review.innerHTML = _renderReview(_result);
  const statsHost = _root.querySelector('.pf-stats');
  if (statsHost) statsHost.innerHTML = _statsBadges(_statsOf(_result.issues));
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
function _toast(msg, isErr) {
  let el = document.getElementById('pf-toast');
  if (!el) { el = document.createElement('div'); el.id = 'pf-toast'; el.className = 'pf-toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'pf-toast' + (isErr ? ' pf-toast-error' : '') + ' pf-toast-show';
  clearTimeout(_toast._t);
  _toast._t = setTimeout(() => el.classList.remove('pf-toast-show'), 3200);
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════════
// Styles
// ══════════════════════════════════════════════════════════════════
const STYLE_FLAG = '__ks_gw_proof_css__';
function _injectStyles() {
  if (window[STYLE_FLAG]) return;
  window[STYLE_FLAG] = true;
  const css = `
.pf-wrap { padding: 28px clamp(20px,4vw,48px); max-width: 1400px; margin: 0 auto; box-sizing: border-box; }
.pf-hero { display:flex; flex-direction:column; gap:15px; margin-bottom:26px; }
.pf-hero-eyebrow { font-size:10.5px; text-transform:uppercase; letter-spacing:.11em; font-weight:600; color:#9b8cff; display:flex; align-items:center; }
.pf-family-switch { display:inline-flex; gap:4px; padding:4px; border-radius:100px;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.09); align-self:flex-start; }
.pf-fam { display:inline-flex; align-items:center; gap:7px; padding:8px 16px; border-radius:100px;
  background:transparent; border:0; color:var(--text-muted,#9aa); font-size:13px; font-weight:600;
  cursor:pointer; transition:all .15s ease; font-family:inherit; }
.pf-fam:hover:not(.is-active){ color:#ddd; background:rgba(255,255,255,.05); }
.pf-fam.is-active { background:linear-gradient(135deg,rgba(120,160,255,.9),rgba(128,96,255,.9)); color:#fff;
  box-shadow:0 2px 10px rgba(120,120,255,.25); cursor:default; }
html.light-mode .pf-family-switch { background:rgba(0,0,0,.04); border-color:rgba(0,0,0,.08); }
html.light-mode .pf-fam:hover:not(.is-active){ color:#334155; background:rgba(0,0,0,.04); }
.pf-tabs { display:flex; align-items:center; gap:6px; }
.pf-tabs-line { flex:1; height:1px; background:rgba(255,255,255,.09); margin-left:12px; border-radius:1px; }
html.light-mode .pf-tabs-line { background:rgba(0,0,0,.1); }
.pf-tab { display:flex; align-items:center; gap:8px; padding:10px 18px; border-radius:100px;
  background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); color:var(--text-muted,#aaa);
  font-size:13px; font-weight:600; cursor:pointer; transition:all .15s ease; }
.pf-tab.is-active { background:rgba(120,160,255,.18); border-color:rgba(120,160,255,.45); color:var(--text-primary,#fff); }
.pf-tab:hover:not(.is-active) { background:rgba(255,255,255,.07); color:#ddd; }
.pf-tab-icon { display:inline-flex; align-items:center; opacity:.85; }
.pf-hero-sub { color:var(--text-muted,#888); font-size:13px; margin:0; max-width:680px; line-height:1.5; }

.pf-grid { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
@media (max-width:1000px){ .pf-grid { grid-template-columns:1fr; } }
.pf-pane { display:flex; flex-direction:column; gap:10px; min-width:0; }
.pf-pane-label { font-size:11px; text-transform:uppercase; letter-spacing:.09em; color:var(--text-muted,#888); font-weight:600; display:flex; align-items:center; gap:10px; min-height:24px; }
.pf-stats { display:inline-flex; gap:6px; }
.pf-badge { padding:3px 9px; border-radius:100px; font-size:10px; font-weight:700; letter-spacing:.02em; text-transform:none; }
.pf-badge-spell { background:rgba(255,90,90,.16); color:#ff9a9a; }
.pf-badge-gram  { background:rgba(255,180,70,.16); color:#ffd08a; }
.pf-badge-ok    { background:rgba(80,220,150,.16); color:#86e8b6; }

.pf-source { width:100%; box-sizing:border-box; height:340px; resize:none; padding:16px; border-radius:14px;
  background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); color:var(--text-primary,#fff);
  font-size:14px; line-height:1.6; font-family:inherit;
  box-shadow:0 2px 10px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04); transition:border-color .15s ease, box-shadow .15s ease; }
.pf-source:focus { outline:0; border-color:rgba(120,160,255,.45); background:rgba(255,255,255,.06);
  box-shadow:0 0 0 3px rgba(120,160,255,.14), inset 0 1px 0 rgba(255,255,255,.04); }
.pf-source-meta { font-size:11px; color:var(--text-muted,#888); }

.pf-actions-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:16px; }
.pf-charcount { margin-left:auto; font-size:11px; color:var(--text-muted,#888); }
.pf-btn-primary { display:flex; align-items:center; gap:8px; padding:12px 22px; border:0; border-radius:12px;
  background:linear-gradient(135deg,#6496ff,#8060ff); color:#fff; font-size:14px; font-weight:600; cursor:pointer;
  transition:transform .15s ease,opacity .15s ease; }
.pf-btn-primary:hover:not(:disabled){ transform:translateY(-1px); }
.pf-btn-primary:disabled { opacity:.55; cursor:not-allowed; }
.pf-btn-ghost { padding:12px 18px; border-radius:12px; background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.1); color:var(--text-muted,#aaa); font-size:13px; font-weight:500; cursor:pointer; }
.pf-btn-ghost:disabled { opacity:.5; cursor:not-allowed; }
.pf-ai-btn { color:#c9b6ff; border-color:rgba(150,120,255,.3); background:rgba(150,120,255,.1); display:inline-flex; align-items:center; gap:7px; }
.pf-ai-btn:hover:not(:disabled){ background:rgba(150,120,255,.2); border-color:rgba(150,120,255,.5); }

/* Panneau passe IA */
.pf-ai-panel { margin-top:22px; padding:18px; border-radius:14px;
  background:linear-gradient(180deg,rgba(150,120,255,.08),rgba(150,120,255,.03));
  border:1px solid rgba(150,120,255,.22); }
.pf-ai-head { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:#c9b6ff; margin-bottom:12px; }
.pf-ai-sub { font-weight:500; font-size:11px; color:var(--text-muted,#999); }
.pf-ai-text { white-space:pre-wrap; word-wrap:break-word; font-size:14px; line-height:1.7; color:var(--text-primary,#eee);
  background:rgba(0,0,0,.12); border:1px solid rgba(255,255,255,.06); border-radius:10px; padding:14px; }
.pf-ai-actions { margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; }
.pf-mini-btn { padding:8px 14px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer;
  background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:var(--text-primary,#ddd); transition:all .12s ease; }
.pf-mini-btn:hover { background:rgba(255,255,255,.12); }
.pf-mini-primary { background:linear-gradient(135deg,#6496ff,#8060ff); border:0; color:#fff; }
.pf-mini-primary:hover { opacity:.92; }
html.light-mode .pf-ai-text { background:rgba(0,0,0,.03); color:#1e293b; }
html.light-mode .pf-ai-btn { color:#6d4fc4; background:rgba(120,90,230,.08); border-color:rgba(120,90,230,.25); }

.pf-review { height:340px; overflow-y:auto; padding:18px; border-radius:14px; background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.08); box-shadow:0 2px 10px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.03); }
.pf-review::-webkit-scrollbar { width:7px; }
.pf-review::-webkit-scrollbar-thumb { background:rgba(255,255,255,.14); border-radius:4px; }
.pf-doc { white-space:pre-wrap; word-wrap:break-word; font-size:14px; line-height:1.9; color:var(--text-primary,#eee); }
.pf-empty { color:var(--text-muted,#888); font-size:13px; text-align:center; padding:64px 24px; line-height:1.65; display:flex; flex-direction:column; align-items:center; gap:2px; }
.pf-empty svg { opacity:.22; margin-bottom:14px; }
.pf-empty strong { color:var(--text-primary,#cfcfcf); font-weight:600; }
.pf-clean { display:flex; flex-direction:column; align-items:center; gap:12px; padding:60px 20px; color:#86e8b6; font-size:15px; font-weight:600; }

.pf-mark { border-radius:3px; padding:0 1px; cursor:pointer; text-decoration:none;
  background:transparent; box-shadow:inset 0 -2px 0 0 currentColor; transition:background .12s ease; }
.pf-mark:hover { background:rgba(255,255,255,.08); }
.pf-mark.pf-spelling { color:#ff7676; text-decoration:underline wavy #ff7676; text-underline-offset:3px; box-shadow:none; }
.pf-mark.pf-grammar  { color:#ffbe5c; text-decoration:underline wavy #ffbe5c; text-underline-offset:3px; box-shadow:none; }
.pf-mark:focus { outline:2px solid rgba(120,160,255,.5); outline-offset:1px; }

.pf-pdf-shell { padding:8px 0; }
.pf-pdf-empty { padding:90px 20px; }
.pf-scanned { padding:60px 20px; color:var(--text-muted,#999); }

/* Zone de dépôt */
.pf-drop { display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center;
  padding:64px 28px; border-radius:16px; border:1.5px dashed rgba(255,255,255,.18);
  background:rgba(255,255,255,.025); cursor:pointer; transition:all .15s ease; color:var(--text-muted,#999); }
.pf-drop:hover { border-color:rgba(120,160,255,.5); background:rgba(120,160,255,.06); }
.pf-drop-title { font-size:17px; font-weight:700; color:var(--text-primary,#fff); letter-spacing:-.01em; }
.pf-drop-sub { font-size:12.5px; max-width:440px; line-height:1.55; margin:2px 0 8px; }
.pf-drop-sub strong { color:var(--text-primary,#ddd); }
.pf-drop-btn { padding:9px 18px; border-radius:100px; background:linear-gradient(135deg,#6496ff,#8060ff);
  color:#fff; font-size:13px; font-weight:600; }
.pf-file-input { display:none; }

/* Barre d'outils PDF */
.pf-pdf-toolbar { display:flex; align-items:center; gap:14px; flex-wrap:wrap; justify-content:space-between;
  padding:10px 14px; border-radius:12px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
  margin-bottom:14px; position:sticky; top:0; z-index:30; backdrop-filter:blur(10px); }
.pf-pdf-file { display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; color:var(--text-primary,#ddd);
  max-width:220px; overflow:hidden; }
.pf-pdf-file span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pf-pdf-nav { display:flex; align-items:center; gap:8px; }
.pf-pdf-pageno { font-size:12.5px; color:var(--text-muted,#aaa); min-width:96px; text-align:center; }
.pf-pdf-tools { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.pf-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px;
  border-radius:9px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
  color:var(--text-primary,#ddd); cursor:pointer; transition:all .12s ease; }
.pf-iconbtn:hover:not(:disabled) { background:rgba(120,160,255,.16); border-color:rgba(120,160,255,.35); }
.pf-iconbtn:disabled { opacity:.35; cursor:not-allowed; }
.pf-btn-sm { display:inline-flex; align-items:center; gap:6px; padding:8px 12px; font-size:12px; }

/* Scène : canvas + surlignages */
.pf-pdf-stage { display:flex; justify-content:center; min-height:300px; }
.pf-canvas-wrap { position:relative; box-shadow:0 8px 40px rgba(0,0,0,.45); border-radius:4px; overflow:hidden; background:#fff; }
.pf-canvas { display:block; }
.pf-ov-layer { position:absolute; inset:0; pointer-events:none; }
.pf-ov { position:absolute; pointer-events:auto; cursor:pointer; border-radius:2px; transition:background .12s ease; }
.pf-ov.pf-spelling { background:rgba(255,60,60,.20); box-shadow:inset 0 -2px 0 0 rgba(220,40,40,.95); }
.pf-ov.pf-grammar  { background:rgba(255,170,40,.20); box-shadow:inset 0 -2px 0 0 rgba(210,130,10,.95); }
.pf-ov:hover { background:rgba(120,160,255,.35); }

.pf-credit { margin-top:22px; font-size:11px; line-height:1.6; font-weight:400; color:var(--text-muted,#8a8a8a); }
.pf-credit a { color:inherit; text-decoration:underline; text-underline-offset:2px; }
.pf-credit a:hover { color:var(--text-primary,#bbb); }

/* Popover */
.pf-pop { position:absolute; z-index:9500; background:var(--bg-secondary,#16161a);
  border:1px solid rgba(255,255,255,.12); border-radius:12px; box-shadow:0 16px 48px rgba(0,0,0,.5);
  padding:12px; box-sizing:border-box; animation:pf-pop-in .14s ease; }
@keyframes pf-pop-in { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
.pf-pop-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.pf-pop-type { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; padding:3px 8px; border-radius:100px; }
.pf-pop-type.pf-spelling { background:rgba(255,90,90,.16); color:#ff9a9a; }
.pf-pop-type.pf-grammar  { background:rgba(255,180,70,.16); color:#ffd08a; }
.pf-pop-x { background:transparent; border:0; color:var(--text-muted,#888); cursor:pointer; padding:2px; display:flex; }
.pf-pop-msg { font-size:12.5px; line-height:1.5; color:var(--text-primary,#ddd); margin-bottom:10px; }
.pf-pop-suggs { display:flex; flex-wrap:wrap; gap:6px; }
.pf-sugg { padding:7px 12px; border-radius:8px; background:rgba(120,160,255,.14); border:1px solid rgba(120,160,255,.3);
  color:#cfe0ff; font-size:13px; font-weight:600; cursor:pointer; transition:all .12s ease; }
.pf-sugg:hover { background:rgba(120,160,255,.28); color:#fff; }
.pf-pop-nosugg { font-size:12px; color:var(--text-muted,#888); font-style:italic; }
.pf-pop-hint { margin-top:8px; font-size:11px; color:var(--text-muted,#888); line-height:1.4; }
.pf-pop-foot { margin-top:10px; display:flex; justify-content:flex-end; }
.pf-pop-ignore { background:transparent; border:0; color:var(--text-muted,#888); font-size:12px; cursor:pointer; text-decoration:underline; }
.pf-pop-ignore:hover { color:#ddd; }

.pf-spinner { width:14px; height:14px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%;
  animation:pf-spin .8s linear infinite; display:inline-block; }
@keyframes pf-spin { to{transform:rotate(360deg)} }

.pf-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px); padding:12px 20px;
  border-radius:10px; z-index:99999; background:rgba(20,20,25,.95); color:#fff; font-size:13px; font-weight:500;
  border:1px solid rgba(255,255,255,.1); box-shadow:0 8px 32px rgba(0,0,0,.4); opacity:0;
  transition:opacity .22s ease,transform .22s cubic-bezier(.16,1,.3,1); pointer-events:none;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif; }
.pf-toast-show { opacity:1; transform:translateX(-50%) translateY(0); }
.pf-toast-error { background:rgba(60,20,20,.95); border-color:rgba(255,100,100,.3); color:#ffb0b0; }

/* Mode clair */
html.light-mode .pf-tab { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.1); }
html.light-mode .pf-tab.is-active { background:rgba(80,110,230,.12); border-color:rgba(80,110,230,.4); }
html.light-mode .pf-source { background:#fff; border-color:rgba(0,0,0,.14); }
html.light-mode .pf-review { background:#fff; border-color:rgba(0,0,0,.09); }
html.light-mode .pf-doc { color:#1e293b; }
html.light-mode .pf-mark.pf-spelling { color:#d83a3a; text-decoration-color:#d83a3a; }
html.light-mode .pf-mark.pf-grammar  { color:#c47a10; text-decoration-color:#c47a10; }
html.light-mode .pf-pop { background:#fff; border-color:rgba(0,0,0,.12); }
html.light-mode .pf-pop-msg { color:#1e293b; }
  `;
  const st = document.createElement('style');
  st.id = 'ks-gw-proof-styles';
  st.textContent = css;
  document.head.appendChild(st);
}
