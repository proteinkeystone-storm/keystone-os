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

      // Toolbar Keystone : barre d'actions sticky en haut de la preview.
      // - position: fixed → ne perturbe pas la pagination Paged.js
      // - @media print { display: none } → masquée dans le PDF généré
      // - z-index très élevé pour passer au-dessus du contenu Paged.js
      const TOOLBAR_HTML = `
<style id="ks-toolbar-style">
  .ks-toolbar {
    position: fixed; top: 0; left: 0; right: 0;
    height: 56px;
    background: #07102a;
    border-bottom: 1px solid rgba(184,148,90,.25);
    box-shadow: 0 2px 12px rgba(0,0,0,.4);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 20px; gap: 12px;
    z-index: 999999;
    font-family: 'Source Sans 3', 'Helvetica Neue', sans-serif;
  }
  .ks-toolbar-title {
    color: #D4AF7A; font-size: 13px; font-weight: 600;
    letter-spacing: 0.06em; text-transform: uppercase;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ks-toolbar-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .ks-btn {
    background: transparent; color: #fff;
    border: 1px solid rgba(255,255,255,.14);
    padding: 8px 14px; border-radius: 6px;
    font-size: 13px; font-weight: 500;
    cursor: pointer; transition: all .15s;
    font-family: inherit;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .ks-btn:hover { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.28); }
  .ks-btn-primary {
    background: #B8945A; color: #07102a; border-color: #B8945A;
  }
  .ks-btn-primary:hover { background: #D4AF7A; border-color: #D4AF7A; }
  .ks-btn-icon { font-size: 14px; line-height: 1; }
  /* Décale le contenu de la page vers le bas pour ne pas être masqué */
  body { padding-top: 56px !important; }
  /* À l'impression : toolbar invisible ET on retire le décalage */
  @media print {
    .ks-toolbar { display: none !important; }
    body { padding-top: 0 !important; }
  }
</style>
<div class="ks-toolbar" role="toolbar" aria-label="Actions document">
  <div class="ks-toolbar-title">Notice Descriptive VEFA · Aperçu Keystone</div>
  <div class="ks-toolbar-actions">
    <button class="ks-btn" id="ks-btn-print" type="button">
      <span class="ks-btn-icon">🖨</span> Imprimer
    </button>
    <button class="ks-btn ks-btn-primary" id="ks-btn-pdf" type="button">
      <span class="ks-btn-icon">📥</span> Télécharger en PDF
    </button>
    <button class="ks-btn" id="ks-btn-close" type="button" aria-label="Fermer la fenêtre">
      <span class="ks-btn-icon">✕</span>
    </button>
  </div>
</div>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    const trigger = () => { try { window.focus(); window.print(); } catch(e) {} };
    document.getElementById('ks-btn-print')?.addEventListener('click', trigger);
    // "Télécharger PDF" déclenche le même dialog ; l'utilisateur choisit
    // "Enregistrer comme PDF" comme destination. Pas d'API navigateur
    // pour pré-sélectionner cette destination, mais on guide via le label.
    document.getElementById('ks-btn-pdf')?.addEventListener('click', trigger);
    document.getElementById('ks-btn-close')?.addEventListener('click', () => window.close());
  });
</script>`;

      // On injecte la toolbar JUSTE AVANT </body> pour qu'elle soit
      // dans le DOM final mais en position: fixed (donc hors flux).
      const htmlWithToolbar = html.replace(/<\/body>/i, TOOLBAR_HTML + '</body>');

      win.document.open();
      win.document.write(htmlWithToolbar);
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

      // Si mode print : on déclenche l'impression dès que Paged.js a
      // fini de paginer. Paged.js émet l'event 'pagedjs-after-paged'
      // mais selon la version, ce n'est pas garanti — fallback timeout.
      if (mode === 'print') {
        const triggerPrint = () => {
          try { win.focus(); win.print(); }
          catch (e) { console.warn('[doc-engine] print() échec', e); }
        };
        let printed = false;
        const fire = () => { if (!printed) { printed = true; setTimeout(triggerPrint, 250); } };
        win.addEventListener('pagedjs-after-paged', fire, { once: true });
        // Fallback : si l'event ne se déclenche pas en 4s, on imprime quand même.
        setTimeout(fire, 4000);
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
