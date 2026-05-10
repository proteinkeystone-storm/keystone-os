/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — DocEngine (Sprint 1.2 · Layer 2)
   Moteur de rendu de documents PDF print-ready à partir de
   templates HTML sanctuarisés.

   Promesse :
     - Aucun template HTML n'est jamais envoyé à un LLM.
     - Variables [[VAR]] + clauses [[CLAUSE_KEY]] (BDD) substituées
       en pur string-replace, déterministe et auditable.
     - 3 modes de rendu : html | preview | print.
     - Preview paginée A4 via Paged.js (CDN).
     - PDF : window.print() — l'utilisateur choisit "Enregistrer en PDF"
       dans le dialog d'impression du navigateur (rendu natif fidèle).

   API publique :
     docEngine.render({ templateId, variables, clauses?, mode })
     docEngine.fillClauses(templateId)        → préchargé depuis D1
     docEngine.listTemplates()                → catalogue
     docEngine.listMissingMarkers(templateId, vars, clauses)

   Debug console : `window.docEngine` est exposé.
   ═══════════════════════════════════════════════════════════════ */

import { dataFabric } from './data-fabric.js';

// ── Config ─────────────────────────────────────────────────────
// Résolution via import.meta.url : marche quelle que soit la page
// qui charge le module (app.html, admin.html, /app rewrite, etc.).
// → app/lib/doc-engine.js → app/lib/doc-templates/
const TEMPLATES_BASE = new URL('./doc-templates/', import.meta.url).href;

// CDN Paged.js — le polyfill applique les CSS Paged Media et découpe
// le HTML en pages A4 dans le DOM cible.
const PAGEDJS_CDN = 'https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js';

// ── Catalogue des templates (extensible) ───────────────────────
// Pour ajouter un template : déposer le HTML sanctuarisé dans
// app/lib/doc-templates/ et inscrire ses méta ici.
const TEMPLATES_META = {
  'vefa-notice-v1': {
    file        : 'vefa-notice-v1.html',
    label       : 'Notice descriptive VEFA — v1',
    sector      : 'IMM',
    pages       : 6,
    // Variables attendues (formulaire VEFA + champs auto-générés).
    variables   : [
      'PROGRAMME', 'DEPARTEMENT', 'REGION', 'TYPE_LOT',
      'SURFACE', 'ETAGE', 'ORIENTATION',
      'RE2020_SEUIL', 'RE2020_OBJECTIF', 'IC_CONSTRUCTION_MAX',
      'CHAUFFAGE', 'CONFORT_ETE', 'ISOLATION', 'SOLS', 'CUISINE', 'ANNEXES',
      'REF_DOCUMENT', 'DATE_EDITION', 'VERSION_DOC',
      'VENDEUR', 'NOTAIRE', 'PERMIS', 'LIVRAISON', 'ASSUREUR_DO', 'GFA_ETABLISSEMENT',
      'SPECIFICITES_BLOC',
    ],
    // Clauses attendues (rapatriées depuis entities type='clauses').
    clauses     : [
      'AVERTISSEMENT_NOTICE',
      'FONDATIONS', 'MACONNERIE', 'ISOLATION_THERMIQUE',
      'TOITURE', 'MENUISERIES_EXT', 'PROTECTIONS_SOLAIRES',
      'CHAUFFAGE', 'ECS', 'VMC',
      'ELECTRICITE', 'PLOMBERIE', 'DOMOTIQUE',
      'SOL_PIECES_VIE', 'SOL_CHAMBRES', 'SDB',
      'PEINTURES', 'CUISINE', 'MENUISERIES_INT',
      'CAVE', 'EXTERIEURS', 'PARKING_IRVE', 'ACCES_SECURITE', 'NOTE_ANNEXES',
      'GFA', 'GPA', 'BIENNALE', 'DECENNALE',
      'ART_R261_25', 'AVERTISSEMENT_VALIDATION',
    ],
  },
};

// ── Cache mémoire ──────────────────────────────────────────────
const _templateCache = new Map();   // templateId → string HTML brut
let   _pagedJsLoading = null;       // promise du chargement Paged.js

// ── Utils ──────────────────────────────────────────────────────
function _meta(templateId) {
  const meta = TEMPLATES_META[templateId];
  if (!meta) throw new Error(`DocEngine: template inconnu '${templateId}'`);
  return meta;
}

async function _loadTemplate(templateId) {
  if (_templateCache.has(templateId)) return _templateCache.get(templateId);
  const meta = _meta(templateId);
  const url  = `${TEMPLATES_BASE}${meta.file}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`DocEngine: chargement template échoué (${res.status}) ${url}`);
  const html = await res.text();
  _templateCache.set(templateId, html);
  return html;
}

// Échappement HTML minimal pour les valeurs scalaires (variables texte).
// Les clauses, elles, sont insérées telles quelles : ce sont des fragments
// HTML édités côté admin, donc autorité de confiance assumée.
function _escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Substitution string-replace globale, deux passes : variables d'abord
// (texte échappé), clauses ensuite (HTML brut autorisé).
function _renderString(html, variables = {}, clauses = {}) {
  let out = html;

  // Pass 1 — variables [[VAR]] (échappées)
  Object.entries(variables).forEach(([key, val]) => {
    const re = new RegExp(`\\[\\[${key}\\]\\]`, 'g');
    out = out.replace(re, _escapeHtml(val));
  });

  // Pass 2 — clauses [[CLAUSE_KEY]] (HTML brut)
  Object.entries(clauses).forEach(([key, content]) => {
    const re = new RegExp(`\\[\\[CLAUSE_${key}\\]\\]`, 'g');
    out = out.replace(re, content == null ? '' : String(content));
  });

  return out;
}

// Liste les marqueurs [[X]] et [[CLAUSE_X]] non résolus dans le HTML rendu.
// Permet à l'UI de prévenir avant l'impression.
function _findUnfilled(html) {
  const matches = html.match(/\[\[[A-Z0-9_]+\]\]/g) || [];
  return [...new Set(matches)];
}

// Toolbar de la fenêtre preview : 3 actions (Imprimer, PDF, Fermer).
// Injectée via DOM API (pas innerHTML pour les events) APRÈS la
// pagination Paged.js — sinon le wrap body de Paged.js vire nos boutons.
// SVG outline monochrome 16px (style Heroicons / Phosphor outline).
function _injectPreviewToolbar(win) {
  const doc = win.document;
  if (doc.getElementById('ks-preview-toolbar')) return; // idempotent

  // ── Styles ────────────────────────────────────────────────
  const style = doc.createElement('style');
  style.id = 'ks-preview-toolbar-style';
  style.textContent = `
    #ks-preview-toolbar {
      position: fixed; top: 0; left: 0; right: 0; height: 48px;
      background: rgba(13, 17, 30, 0.92);
      backdrop-filter: saturate(140%) blur(12px);
      -webkit-backdrop-filter: saturate(140%) blur(12px);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 16px; gap: 12px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Source Sans 3', sans-serif;
      color: rgba(255,255,255,0.78);
    }
    #ks-preview-toolbar .ks-tt {
      font-size: 12px; font-weight: 500;
      letter-spacing: 0.04em;
      color: rgba(255,255,255,0.55);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #ks-preview-toolbar .ks-acts { display: flex; gap: 4px; flex-shrink: 0; }
    #ks-preview-toolbar button.ks-act {
      background: transparent;
      color: rgba(255,255,255,0.78);
      border: 1px solid transparent;
      padding: 7px 12px;
      border-radius: 6px;
      font-size: 12.5px; font-weight: 500;
      cursor: pointer;
      transition: background .12s, color .12s, border-color .12s;
      font-family: inherit;
      display: inline-flex; align-items: center; gap: 7px;
      line-height: 1;
    }
    #ks-preview-toolbar button.ks-act:hover {
      background: rgba(255,255,255,0.06);
      color: #fff;
    }
    #ks-preview-toolbar button.ks-act:active {
      background: rgba(255,255,255,0.10);
    }
    #ks-preview-toolbar button.ks-act-icon {
      padding: 7px;
      width: 30px; height: 30px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    #ks-preview-toolbar svg { width: 15px; height: 15px; flex-shrink: 0; display: block; }
    body { padding-top: 48px !important; }
    @media print {
      #ks-preview-toolbar, #ks-preview-toolbar-style { display: none !important; }
      body { padding-top: 0 !important; }
    }
  `;
  doc.head.appendChild(style);

  // ── SVG outline icons (stroke 1.6 ~ Heroicons outline) ────
  const ICON_PRINT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3.5h12V9"/><rect x="3" y="9" width="18" height="9" rx="1.5"/><path d="M6 14h12v6.5H6z"/><circle cx="17" cy="12" r="0.6" fill="currentColor"/></svg>`;
  const ICON_DL    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 19h14"/></svg>`;
  const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

  // ── Toolbar DOM ───────────────────────────────────────────
  const bar = doc.createElement('div');
  bar.id = 'ks-preview-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Actions document');
  bar.innerHTML = `
    <div class="ks-tt">Notice descriptive VEFA · Aperçu</div>
    <div class="ks-acts">
      <button type="button" class="ks-act" data-act="print">${ICON_PRINT}<span>Imprimer</span></button>
      <button type="button" class="ks-act" data-act="pdf">${ICON_DL}<span>Télécharger PDF</span></button>
      <button type="button" class="ks-act ks-act-icon" data-act="close" aria-label="Fermer la fenêtre">${ICON_CLOSE}</button>
    </div>
  `;
  doc.body.appendChild(bar);

  // ── Bindings ──────────────────────────────────────────────
  // addEventListener directement (pas DOMContentLoaded — déjà passé).
  const trigger = () => { try { win.focus(); win.print(); } catch (e) { console.warn('[doc-engine] print()', e); } };
  bar.querySelector('[data-act="print"]').addEventListener('click', trigger);
  bar.querySelector('[data-act="pdf"]').addEventListener('click', trigger);
  bar.querySelector('[data-act="close"]').addEventListener('click', () => { try { win.close(); } catch {} });
}

async function _loadPagedJs() {
  if (window.PagedPolyfill || window.Paged) return;
  if (_pagedJsLoading) return _pagedJsLoading;
  _pagedJsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PAGEDJS_CDN;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('DocEngine: chargement Paged.js échoué'));
    document.head.appendChild(s);
  });
  return _pagedJsLoading;
}

// ── API publique ───────────────────────────────────────────────
export const docEngine = {

  /**
   * Liste les templates disponibles (pour l'UI admin / debug).
   */
  listTemplates() {
    return Object.entries(TEMPLATES_META).map(([id, m]) => ({
      id, label: m.label, sector: m.sector, pages: m.pages,
      variableCount: m.variables.length,
      clauseCount  : m.clauses.length,
    }));
  },

  /**
   * Précharge toutes les clauses standard du template depuis D1
   * (entité 'clauses', secteur correspondant).
   * Renvoie un dict { CLAUSE_KEY: htmlContent } prêt à passer à render().
   *
   * Convention de stockage en D1 :
   *   { secteur: 'IMM', key: 'GFA', version: 1, content: '<p>...</p>',
   *     label: 'Garantie Financière d\'Achèvement' }
   *
   * Sélection : on prend la version max par key, filtrée sur le secteur
   * du template. Une clause manquante → la clé reste absente du dict
   * (le marqueur restera visible dans le HTML, signal pour l'admin).
   */
  async fillClauses(templateId) {
    const meta = _meta(templateId);
    const allClauses = await dataFabric.list('clauses', {
      filter: c => c.secteur === meta.sector,
    });

    // Index par key, on garde la version la plus haute.
    const byKey = new Map();
    for (const c of allClauses) {
      if (!c?.key) continue;
      const prev = byKey.get(c.key);
      if (!prev || (c.version || 0) > (prev.version || 0)) {
        byKey.set(c.key, c);
      }
    }

    const out = {};
    for (const expectedKey of meta.clauses) {
      const c = byKey.get(expectedKey);
      if (c?.content) out[expectedKey] = c.content;
    }
    return out;
  },

  /**
   * Inspecte le rendu et retourne les marqueurs non résolus.
   * Utile en pré-flight avant impression.
   */
  async listMissingMarkers(templateId, variables = {}, clauses = null) {
    const tpl = await _loadTemplate(templateId);
    const c = clauses || await this.fillClauses(templateId);
    const html = _renderString(tpl, variables, c);
    return _findUnfilled(html);
  },

  /**
   * Cœur du moteur. Résout le template → HTML rempli, puis selon mode :
   *   - 'html'    → renvoie le string HTML
   *   - 'preview' → ouvre une fenêtre, charge Paged.js, paginé A4
   *   - 'print'   → ouvre une fenêtre + window.print() (PDF via dialog)
   *
   * @param {object} opts
   * @param {string} opts.templateId         clé dans TEMPLATES_META
   * @param {object} opts.variables          { VAR: 'value', ... }
   * @param {object} [opts.clauses]          override (sinon fillClauses auto)
   * @param {'html'|'preview'|'print'} [opts.mode]
   * @returns {Promise<{html: string, missing: string[], window?: Window}>}
   */
  async render({ templateId, variables = {}, clauses = null, mode = 'html' }) {
    const tpl = await _loadTemplate(templateId);
    const finalClauses = clauses || await this.fillClauses(templateId);
    const html = _renderString(tpl, variables, finalClauses);
    const missing = _findUnfilled(html);

    if (missing.length) {
      console.warn('[doc-engine] marqueurs non résolus :', missing);
    }

    if (mode === 'html') return { html, missing };

    if (mode === 'preview' || mode === 'print') {
      // Nouvelle fenêtre dédiée (about:blank). On y injecte le HTML
      // rendu, puis on charge Paged.js dans la fenêtre fille pour
      // qu'elle gère sa propre pagination.
      const win = window.open('', '_blank', 'width=1100,height=900');
      if (!win) {
        throw new Error("DocEngine: la fenêtre n'a pas pu s'ouvrir (popup bloquée ?)");
      }

      win.document.open();
      win.document.write(html);
      win.document.close();

      // Injection Paged.js dans la fenêtre fille
      await new Promise((resolve, reject) => {
        const s = win.document.createElement('script');
        s.src = PAGEDJS_CDN;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('DocEngine: Paged.js indisponible dans la fenêtre cible'));
        win.document.head.appendChild(s);
      });

      // Toolbar Keystone : injectée APRÈS pagination Paged.js (sinon
      // Paged.js wrappe le body et nos boutons disparaissent).
      // - position: fixed → hors flux, ne perturbe pas la mise en page
      // - DOM API + addEventListener → boutons réellement fonctionnels
      // - SVG outline monochrome → look sobre, cohérent
      // - @media print → invisible dans le PDF généré
      const injectToolbar = () => _injectPreviewToolbar(win);

      const fireWhenReady = (cb) => {
        let done = false;
        const once = () => { if (!done) { done = true; cb(); } };
        win.addEventListener('pagedjs-after-paged', once, { once: true });
        // Fallback : si l'event ne se déclenche pas en 4s, on injecte quand même.
        setTimeout(once, 4000);
      };

      if (mode === 'print') {
        fireWhenReady(() => {
          injectToolbar();
          setTimeout(() => { try { win.focus(); win.print(); } catch (e) { console.warn('[doc-engine] print()', e); } }, 250);
        });
      } else {
        fireWhenReady(injectToolbar);
      }

      return { html, missing, window: win };
    }

    throw new Error(`DocEngine: mode inconnu '${mode}'`);
  },

  // Debug / introspection
  _debug: { TEMPLATES_META, _templateCache, _renderString, _findUnfilled },
};

// ── Exposition globale pour debug & démos console ──────────────
if (typeof window !== 'undefined') {
  window.docEngine = docEngine;
}
