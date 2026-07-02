/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact GHOST WRITER (A-COM-005) v1.0
   Sprint GW-2 : workspace fullscreen + critères avancés

   Mission : réécrire des emails, communications internes, copy
   marketing court ou textes longs en 3 variantes calibrées selon
   contexte (4 onglets) et 5 critères (action / ton / public /
   intention / longueur).

   Architecture :
   ─────────────────────────────────────────────────────────────
     - 4 onglets de contexte : Email pro / Comm interne /
       Marketing court / Texte long.
       Chaque onglet pré-règle les défauts ton + audience + intent.
     - 5 critères affinables dans tous les modes
     - Backend : rewriteText() depuis ghostwriter.js (route
       /api/ghostwriter/rewrite via Gemma 4 sur Cloudflare Workers AI).
       En cas de backend KO, l'UI affiche un message actionnable
       (cf. HANDOFF_GHOSTWRITER_DEPLOY_AND_CLEANUP.md Phase B).
     - Bibliothèque persistante : 50 dernières réécritures
       (ks_ghostwriter_library en localStorage)

   Service système (Cmd+Shift+G) : voir ghostwriter.js (modal léger).
   Ce module = workspace fullscreen pour usages structurés.

   Réutilise le pattern .ws-* commun aux workspaces VEFA Studio /
   Kodex / Pulsa / Muse / SDQR (styles dans workspace.css).
   ═══════════════════════════════════════════════════════════════ */

import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';
import { icon }                                from './lib/ui-icons.js';
import { symbolsButtonHTML, openSymbolsPanel, closeSymbolsPanel } from './lib/symbols-panel.js';
import {
  rewriteText, getGhostwriterQuotaRemaining, getGhostwriterQuotaMax,
  getGhostwriterPlan, refreshGhostwriterQuota,
  friendlyGhostwriterError, getGhostwriterQuotaMessage,
} from './ghostwriter.js';

const APP_ID       = 'A-COM-005';
const DRAFT_KEY    = 'ks_ghostwriter_studio_draft';
const LIBRARY_KEY  = 'ks_ghostwriter_library';
const MAX_LIBRARY  = 50;

// ── Onglets de contexte (4) ─────────────────────────────────────
// Chaque mode pré-règle les défauts ton/audience/intent.
// `iconName` réfère au catalog `app/lib/ui-icons.js` (outline 1.5 stroke).
const MODES = {
  email: {
    label: 'Email pro',
    iconName: 'mail',
    subtitle: 'Réponse client, relance, demande info, suivi commercial',
    defaults: { tone: 'professionnel chaleureux', audience: 'client',  intent: '' },
  },
  internal: {
    label: 'Comm interne',
    iconName: 'share-2',
    subtitle: 'Message équipe, brief, compte-rendu, annonce interne',
    defaults: { tone: 'direct collaboratif', audience: 'peer', intent: '' },
  },
  marketing: {
    label: 'Marketing',
    iconName: 'zap',
    subtitle: 'Punchline, hook social, micro-copy, slogan, accroche',
    defaults: { tone: 'persuasif vendeur', audience: 'unknown', intent: 'vendre' },
  },
  long: {
    label: 'Texte long',
    iconName: 'file-text',
    subtitle: 'Article, post LinkedIn, newsletter, rédactionnel',
    defaults: { tone: 'engageant', audience: 'unknown', intent: '' },
  },
};

// ── Critères (selects) ──────────────────────────────────────────
const ACTIONS = [
  { id: 'improve', value: 'Améliorer / fluidifier (préserve les tournures)' },
  { id: 'rewrite', value: 'Réécrire complètement' },
];

const TONES = [
  { id: '',                       value: '(Auto — défaut du contexte)' },
  { id: 'formel professionnel',   value: 'Formel professionnel' },
  { id: 'chaleureux empathique',  value: 'Chaleureux / empathique' },
  { id: 'concis direct',          value: 'Concis / direct' },
  { id: 'persuasif vendeur',      value: 'Persuasif / vendeur' },
  { id: 'humble respectueux',     value: 'Humble / respectueux' },
  { id: 'enthousiaste',           value: 'Enthousiaste' },
];

const AUDIENCES = [
  { id: '',         value: '(Auto)' },
  { id: 'client',   value: 'Client externe' },
  { id: 'superior', value: 'Supérieur hiérarchique' },
  { id: 'peer',     value: 'Pair / collègue' },
  { id: 'partner',  value: 'Partenaire / fournisseur' },
  { id: 'unknown',  value: 'Inconnu / public large' },
];

const INTENTS = [
  { id: '',                  value: '(Aucune)' },
  { id: 'négocier',          value: 'Négocier' },
  { id: 'vendre',            value: 'Vendre / convaincre' },
  { id: 'calmer',            value: 'Calmer / désamorcer' },
  { id: 'refuser poliment',  value: 'Refuser poliment' },
  { id: 'motiver',           value: 'Motiver / engager' },
  { id: 'remercier',         value: 'Remercier' },
  { id: 'demander info',     value: 'Demander une info' },
];

const LENGTHS = [
  { id: '',           value: '(Garder la longueur)' },
  { id: 'shorter-50', value: 'Raccourcir d\'environ 50 %' },
  { id: 'keep',       value: 'Garder à peu près identique' },
  { id: 'longer',     value: 'Développer (étoffer)' },
];

// ── État ────────────────────────────────────────────────────────
let _root         = null;
let _currentMode  = 'email';
let _formData     = {
  text         : '',
  action       : 'improve',
  tone         : '',     // vide = utilise défaut du mode
  audience     : '',     // vide = utilise défaut du mode
  intent       : '',     // vide = utilise défaut du mode
  lengthTarget : '',
};
let _variants     = null;
let _generating   = false;

// ══════════════════════════════════════════════════════════════════
// Persistence : draft + bibliothèque
// ══════════════════════════════════════════════════════════════════

function _saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode: _currentMode, data: _formData }));
  } catch (_) {}
}

function _loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj?.mode && MODES[obj.mode]) _currentMode = obj.mode;
    if (obj?.data && typeof obj.data === 'object') _formData = { ..._formData, ...obj.data };
  } catch (_) {}
}

function _loadLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function _saveLibrary(items) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(items.slice(0, MAX_LIBRARY)));
  } catch (_) {}
}

function _addToLibrary(entry) {
  const items = _loadLibrary();
  items.unshift(entry);
  _saveLibrary(items);
}

function _deleteFromLibrary(uid) {
  const items = _loadLibrary().filter(it => it.uid !== uid);
  _saveLibrary(items);
}

// ══════════════════════════════════════════════════════════════════
// API publique
// ══════════════════════════════════════════════════════════════════

export function openGhostwriterStudio() {
  if (_root) return;
  _injectStyles();
  _loadDraft();
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';

  // Refresh quota serveur en arrière-plan, puis re-render le chip.
  // Évite d'afficher "—/—" jusqu'au 1er rewrite. Silencieux si offline
  // ou JWT absent — le caller verra l'erreur au generate si nécessaire.
  refreshGhostwriterQuota().then(() => {
    if (_root) _renderMain();
  }).catch(() => {});
}

export function closeGhostwriterStudio() {
  if (!_root) return;
  _saveDraft();
  closeSymbolsPanel();   // le panneau Ω vit sur body, pas dans _root
  document.removeEventListener('keydown', _handleKeyDown);
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════════════════
// Shell (header + body)
// ══════════════════════════════════════════════════════════════════

function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour (Échap)" aria-label="Retour au Dashboard">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('ghostwriter', 24)}</span>
        <span class="name">Ghost Writer</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(APP_ID)}
        ${ratingButtonHTML(APP_ID)}
        <button class="ws-iconbtn" data-act="library" title="Bibliothèque (${_loadLibrary().length} entrées)" aria-label="Ouvrir la bibliothèque">
          ${icon('book-open', 18)}
        </button>
        <button class="ws-iconbtn" data-act="reset" title="Effacer tout et recommencer" aria-label="Réinitialiser">
          ${icon('refresh', 18)}
        </button>
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main" data-slot="main"></main>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click',  _onClick);
  _root.addEventListener('input',  _onInput);
  _root.addEventListener('change', _onInput);
  document.addEventListener('keydown', _handleKeyDown);
  bindRatingButton(_root, APP_ID);
  bindHelpButton(_root, APP_ID);
  bindBurger(_root);
}

// ══════════════════════════════════════════════════════════════════
// Rendu principal
// ══════════════════════════════════════════════════════════════════

// Formate le chip quota en gérant les états indéterminés.
// Le cache module dans ghostwriter.js peut retourner :
//   - Infinity (plan ADMIN)
//   - null     (jamais fetched — JWT manquant ou refresh en cours)
//   - number   (état normal)
function _formatQuotaChip() {
  const remaining = getGhostwriterQuotaRemaining();
  const max       = getGhostwriterQuotaMax();
  const plan      = getGhostwriterPlan();
  if (remaining === Infinity) return '∞ / jour · ADMIN';
  if (remaining == null || max == null) return '—/— / jour';
  return `${remaining}/${max} / jour${plan ? ` · ${plan}` : ''}`;
}

function _renderMain(scrollToTop) {
  const main = _root && _root.querySelector('[data-slot="main"]');
  if (!main) return;
  const prevScroll = scrollToTop ? 0 : main.scrollTop;
  const mode = MODES[_currentMode];
  const quotaChipText = _formatQuotaChip();

  main.innerHTML = `
    <div class="ws-main-inner gw-wrap">
      ${_renderHero(mode)}
      <div class="gw-grid">
        <section class="gw-pane gw-pane-source">
          <div class="gw-pane-label gw-pane-label-row"><span>Texte source</span>${symbolsButtonHTML()}</div>
          <textarea class="gw-source" data-field="text"
            placeholder="Collez ou tapez votre texte ici…"
            rows="10">${_esc(_formData.text || '')}</textarea>
          <div class="gw-source-meta">
            <span class="gw-char-count" data-slot="char-count">${(_formData.text || '').length} caractères</span>
          </div>

          <div class="gw-criteria">
            <div class="gw-pane-label">Critères de réécriture</div>
            <div class="gw-criteria-grid">
              ${_renderSelect('action',       'Action',         ACTIONS,   _formData.action)}
              ${_renderSelect('tone',         'Ton',            TONES,     _formData.tone)}
              ${_renderSelect('audience',     'Public cible',   AUDIENCES, _formData.audience)}
              ${_renderSelect('intent',       'Intention',      INTENTS,   _formData.intent)}
              ${_renderSelect('lengthTarget', 'Longueur cible', LENGTHS,   _formData.lengthTarget)}
            </div>
          </div>

          <div class="gw-actions-row">
            <button class="gw-btn-primary" data-act="generate" type="button" ${_generating ? 'disabled' : ''}>
              ${_generating
                ? '<span class="gw-spinner"></span><span>Génération…</span>'
                : '<span>Réécrire en 3 variantes</span>'}
            </button>
            <div class="gw-meta-chips">
              <span class="gw-chip gw-chip-quota">${quotaChipText}</span>
              <span class="gw-chip gw-chip-engine" title="Moteur backend">Mistral</span>
            </div>
          </div>
        </section>

        <section class="gw-pane gw-pane-variants">
          <div class="gw-pane-label">Variantes proposées</div>
          ${_renderVariants()}
        </section>
      </div>
    </div>
  `;

  main.scrollTop = prevScroll;
}

function _renderHero(mode) {
  const tabs = Object.entries(MODES).map(([key, m], i) => `
    <button class="gw-tab${key === _currentMode ? ' is-active' : ''}"
            data-act="switch-mode" data-mode="${key}"
            type="button" role="tab"
            aria-selected="${key === _currentMode}"
            title="Raccourci : touche ${i + 1}">
      <span class="gw-tab-icon">${icon(m.iconName, 16)}</span>
      <span class="gw-tab-label">${_esc(m.label)}</span>
    </button>
  `).join('');

  return `
    <div class="gw-hero">
      <div class="gw-family-switch" role="tablist" aria-label="Ghost Writer — Réécriture ou Correction">
        <button class="gw-fam is-active" type="button" role="tab" aria-selected="true">
          ${icon('edit', 15)}<span>Réécriture</span>
        </button>
        <button class="gw-fam" type="button" role="tab" aria-selected="false" data-act="open-corrector"
                title="Correcteur orthographe & grammaire (texte + PDF), 100 % local">
          ${icon('check-circle', 15)}<span>Correction</span>
        </button>
      </div>
      <div class="gw-hero-eyebrow">
        ${icon('ghostwriter', 13)}&nbsp;Réécrivez selon le contexte
      </div>
      <nav class="gw-tabs" aria-label="Contexte d'écriture" role="tablist">
        ${tabs}
        <span class="gw-tabs-line" aria-hidden="true"></span>
      </nav>
      <p class="gw-hero-subtitle">${_esc(mode.subtitle)}</p>
    </div>
  `;
}

function _renderSelect(fieldId, label, options, currentVal) {
  const opts = options.map(o => {
    const sel = String(currentVal || '') === String(o.id) ? ' selected' : '';
    return `<option value="${_esc(o.id)}"${sel}>${_esc(o.value)}</option>`;
  }).join('');
  return `
    <div class="gw-field">
      <label class="gw-field-label">${_esc(label)}</label>
      <select class="gw-select" data-field="${_esc(fieldId)}">${opts}</select>
    </div>
  `;
}

// Toujours 3 fenêtres (une par proposition), alignées sur la zone de
// gauche : la 1re cale sur la zone de saisie, les 3 s'empilent à droite.
function _renderVariants() {
  return [0, 1, 2].map(i => _renderVariantSlot(i)).join('');
}

function _renderVariantSlot(i) {
  const v = (_variants && _variants[i]) || null;
  if (v) {
    return `
      <div class="gw-variant" data-idx="${i}">
        <div class="gw-variant-label" title="${_esc(v.label || `Variante ${i + 1}`)}">${i + 1}</div>
        <div class="gw-variant-text">${_esc(v.text)}</div>
        <div class="gw-variant-actions">
          <button class="gw-mini-btn" data-act="copy-variant" data-idx="${i}">Copier</button>
          <button class="gw-mini-btn" data-act="library-add" data-idx="${i}">Enregistrer</button>
        </div>
      </div>`;
  }
  // Slot vide (avant génération) ou en cours de génération.
  return `
    <div class="gw-variant gw-variant-empty">
      <div class="gw-variant-label gw-variant-ghost">${i + 1}</div>
      ${_generating
        ? `<div class="gw-slot-hint"><span class="gw-spinner"></span>${i === 0 ? '<span>Mistral rédige…</span>' : ''}</div>`
        : (i === 0
            ? `<div class="gw-slot-hint">${icon('sparkles', 24)}<span>Cliquez sur <strong>« Réécrire »</strong> pour générer 3 variantes.</span></div>`
            : '')}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// Bibliothèque (panel slide-over)
// ══════════════════════════════════════════════════════════════════

function _renderLibraryPanel() {
  const items = _loadLibrary();
  const list = items.length === 0
    ? `<div class="gw-lib-empty">Aucune entrée pour l'instant. Cliquez sur « Enregistrer » sur une variante pour la sauvegarder ici.</div>`
    : items.map(it => `
        <div class="gw-lib-item" data-uid="${_esc(it.uid)}">
          <div class="gw-lib-head">
            <div class="gw-lib-label">${_esc(it.label || 'Sans label')}</div>
            <div class="gw-lib-meta">${_esc(it.modeLabel || '')} · ${_fmtDate(it.date)}</div>
          </div>
          <div class="gw-lib-text">${_esc((it.text || '').slice(0, 220))}${(it.text || '').length > 220 ? '…' : ''}</div>
          <div class="gw-lib-actions">
            <button class="gw-mini-btn" data-act="lib-copy" data-uid="${_esc(it.uid)}">Copier</button>
            <button class="gw-mini-btn" data-act="lib-load" data-uid="${_esc(it.uid)}">Recharger</button>
            <button class="gw-mini-btn gw-mini-btn--danger" data-act="lib-delete" data-uid="${_esc(it.uid)}">Supprimer</button>
          </div>
        </div>
      `).join('');

  return `
    <div class="gw-lib-overlay" data-slot="lib-overlay">
      <div class="gw-lib-backdrop" data-act="lib-close"></div>
      <aside class="gw-lib-panel" role="dialog" aria-label="Bibliothèque Ghost Writer">
        <header class="gw-lib-header">
          <div class="gw-lib-title">Bibliothèque <span class="gw-lib-count">${items.length}/${MAX_LIBRARY}</span></div>
          <button class="ws-iconbtn" data-act="lib-close" aria-label="Fermer">✕</button>
        </header>
        <div class="gw-lib-list">${list}</div>
      </aside>
    </div>
  `;
}

function _openLibrary() {
  if (_root.querySelector('[data-slot="lib-overlay"]')) return;
  const div = document.createElement('div');
  div.innerHTML = _renderLibraryPanel();
  _root.appendChild(div.firstElementChild);
  requestAnimationFrame(() => {
    const ov = _root.querySelector('[data-slot="lib-overlay"]');
    if (ov) ov.classList.add('gw-lib-on');
  });
}

function _closeLibrary() {
  const ov = _root.querySelector('[data-slot="lib-overlay"]');
  if (!ov) return;
  ov.classList.remove('gw-lib-on');
  setTimeout(() => ov.remove(), 200);
}

// ══════════════════════════════════════════════════════════════════
// Délégation événements
// ══════════════════════════════════════════════════════════════════

function _onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  switch (act) {
    case 'close':       closeGhostwriterStudio(); return;
    case 'symbols':     openSymbolsPanel({ getTarget: () => _root && _root.querySelector('.gw-source') }); return;
    case 'open-corrector': _openCorrector(); return;
    case 'switch-mode': _switchMode(btn.dataset.mode); return;
    case 'generate':    _handleGenerate(); return;
    case 'reset':       _handleReset(); return;
    case 'library':     _openLibrary(); return;
    case 'lib-close':   _closeLibrary(); return;
    case 'lib-delete':  _deleteFromLibrary(btn.dataset.uid); _refreshLibrary(); return;
    case 'lib-copy':    _libraryCopy(btn.dataset.uid, btn); return;
    case 'lib-load':    _libraryLoad(btn.dataset.uid); return;
    case 'copy-variant': _copyVariant(parseInt(btn.dataset.idx, 10), btn); return;
    case 'library-add':  _saveVariantToLibrary(parseInt(btn.dataset.idx, 10), btn); return;
  }
}

function _onInput(e) {
  const el = e.target;
  const fieldId = el.dataset && el.dataset.field;
  if (!fieldId) return;
  _formData[fieldId] = el.value;
  _saveDraft();
  // Update char counter live (sans re-render complet)
  if (fieldId === 'text') {
    const c = _root.querySelector('[data-slot="char-count"]');
    if (c) c.textContent = `${(el.value || '').length} caractères`;
  }
}

function _handleKeyDown(e) {
  if (!_root) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    // Cmd/Ctrl+Enter dans le textarea déclenche la génération
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && tag === 'TEXTAREA') {
      e.preventDefault();
      _handleGenerate();
    }
    return;
  }
  if (e.key === 'Escape') {
    // Si bibliothèque ouverte, ferme la bibliothèque seulement
    if (_root.querySelector('[data-slot="lib-overlay"]')) { _closeLibrary(); return; }
    closeGhostwriterStudio();
    return;
  }
  const modes = Object.keys(MODES);
  const idx = parseInt(e.key, 10);
  if (idx >= 1 && idx <= modes.length && !e.metaKey && !e.ctrlKey) {
    _switchMode(modes[idx - 1]);
  }
}

// ══════════════════════════════════════════════════════════════════
// Actions
// ══════════════════════════════════════════════════════════════════

function _switchMode(mode) {
  if (!MODES[mode] || mode === _currentMode) return;
  _currentMode = mode;
  _saveDraft();
  _renderMain(true);
}

// Ghost Writer V2 — ouvre le Correcteur (orthographe + PDF). Module
// chargé en lazy (moteur Grammalecte ~9 Mo) pour ne pas alourdir le
// dashboard. Le studio reste ouvert dessous (overlay empilé).
async function _openCorrector() {
  try {
    const m = await import('./ghostwriter-proof.js');
    closeGhostwriterStudio();        // swap propre : on ferme la moitié Réécriture…
    m.openGhostwriterProof();        // …et on ouvre la moitié Correction (même bascule en haut)
  } catch (e) {
    _toast('Impossible d\'ouvrir le correcteur', true);
  }
}

function _handleReset() {
  if (!confirm('Effacer tout le brouillon Ghost Writer et recommencer ?')) return;
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
  _formData = { text: '', action: 'improve', tone: '', audience: '', intent: '', lengthTarget: '' };
  _currentMode = 'email';
  _variants = null;
  _renderMain(true);
  _toast('Brouillon réinitialisé');
}

async function _handleGenerate() {
  if (_generating) return;
  const text = (_formData.text || '').trim();
  if (text.length < 5) {
    _toast('Texte trop court (min 5 caractères)', true);
    return;
  }
  if (text.length > 5000) {
    _toast('Texte trop long (max 5000 caractères)', true);
    return;
  }
  // Pre-check optimiste — le serveur reste juge ultime (429).
  // remaining=null → quota jamais fetched (cache cold), on laisse passer.
  // remaining=Infinity → plan ADMIN.
  // remaining=0 → certain qu'on est à sec.
  const remaining = getGhostwriterQuotaRemaining();
  if (remaining === 0) {
    _toast(getGhostwriterQuotaMessage(), true);
    return;
  }

  // Construit les opts à partir du mode courant + critères user.
  // Les valeurs vides côté user → utilisent les défauts du mode (côté serveur).
  const modeDefaults = MODES[_currentMode].defaults;
  const opts = {
    mode         : _currentMode,
    action       : _formData.action || 'improve',
    tone         : _formData.tone     || modeDefaults.tone,
    audience     : _formData.audience || modeDefaults.audience,
    intent       : _formData.intent   || modeDefaults.intent,
    lengthTarget : _formData.lengthTarget || '',
  };

  _generating = true;
  _renderMain();

  try {
    const result = await rewriteText(text, opts);
    // Phase 2 : pas besoin d'appeler bumpGhostwriterQuota() — rewriteText
    // ingère déjà le quota serveur depuis result.quota. Le double appel
    // produirait un décalage de -1 dans l'UI vs la réalité serveur.
    _variants = result.variants || [];
    _toast(`✓ ${_variants.length} variantes générées (${result.model || 'AI'})`);
  } catch (err) {
    _variants = null;
    _toast(`Erreur : ${friendlyGhostwriterError(err)}`, true);
  } finally {
    _generating = false;
    _renderMain();
  }
}

// Copie robuste : clipboard API, puis repli execCommand (Safari/WebView où
// writeText rejette en silence). Feedback TOUJOURS visible — l'ancien code
// échouait sans un mot (pas de catch), impossible à diagnostiquer pour l'user.
async function _copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {}
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
      ta.remove();
    } catch (_) {}
  }
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = ok ? '✓ Copié' : '✗ Échec copie';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  }
  if (!ok) _toast('Copie refusée par le navigateur — sélectionnez le texte manuellement', true);
  return ok;
}

function _copyVariant(idx, btn) {
  const v = _variants?.[idx];
  if (!v?.text) {
    // Cartes affichées mais état perdu (ne devrait pas arriver) : dire
    // pourquoi plutôt que d'ignorer le clic en silence.
    _toast('Variante introuvable — relancez une génération', true);
    return;
  }
  _copyText(v.text, btn);
}

function _saveVariantToLibrary(idx, btn) {
  const v = _variants?.[idx];
  if (!v?.text) return;
  _addToLibrary({
    uid       : 'gw_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    label     : v.label || `Variante ${idx + 1}`,
    text      : v.text,
    modeLabel : MODES[_currentMode]?.label || '',
    sourceText: _formData.text || '',
    criteria  : { action: _formData.action, tone: _formData.tone, audience: _formData.audience, intent: _formData.intent, lengthTarget: _formData.lengthTarget },
    date      : new Date().toISOString(),
  });
  const orig = btn.textContent;
  btn.textContent = '✓ Enregistré';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  // Refresh chip count dans la topbar
  const libBtn = _root.querySelector('[data-act="library"]');
  if (libBtn) libBtn.setAttribute('title', `Bibliothèque (${_loadLibrary().length} entrées)`);
}

function _libraryCopy(uid, btn) {
  const it = _loadLibrary().find(x => x.uid === uid);
  if (!it?.text) return;
  _copyText(it.text, btn);
}

function _libraryLoad(uid) {
  const it = _loadLibrary().find(x => x.uid === uid);
  if (!it) return;
  _formData.text = it.sourceText || it.text || '';
  if (it.criteria) Object.assign(_formData, it.criteria);
  _saveDraft();
  _closeLibrary();
  _renderMain(true);
  _toast('Brouillon rechargé depuis la bibliothèque');
}

function _refreshLibrary() {
  const ov = _root.querySelector('[data-slot="lib-overlay"]');
  if (!ov) return;
  _closeLibrary();
  setTimeout(_openLibrary, 250);
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

function _toast(msg, isError) {
  let el = document.getElementById('gw-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gw-toast';
    el.className = 'gw-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'gw-toast' + (isError ? ' gw-toast-error' : '') + ' gw-toast-show';
  clearTimeout(_toast._timer);
  _toast._timer = setTimeout(() => el.classList.remove('gw-toast-show'), 3500);
}

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}

// ══════════════════════════════════════════════════════════════════
// Styles (injectés une fois au premier open)
// ══════════════════════════════════════════════════════════════════

const STYLES_INJECTED_FLAG = '__ks_gw_studio_css_injected__';

function _injectStyles() {
  if (window[STYLES_INJECTED_FLAG]) return;
  window[STYLES_INJECTED_FLAG] = true;
  const css = `
.gw-wrap { padding: 28px clamp(20px, 4vw, 48px); max-width: 1400px; margin: 0 auto; box-sizing: border-box; }
.gw-hero { display: flex; flex-direction: column; gap: 15px; margin-bottom: 26px; }
.gw-hero-eyebrow { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.11em; font-weight: 600; color: #9b8cff; display: flex; align-items: center; }
.gw-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.gw-tabs-line { flex: 1; min-width: 40px; height: 1px; background: rgba(255,255,255,.09); margin-left: 12px; border-radius: 1px; }
html.light-mode .gw-tabs-line { background: rgba(0,0,0,.1); }
.gw-tab {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: 100px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  color: var(--text-muted, #aaa); font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all .15s ease;
}
.gw-tab.is-active {
  background: rgba(120,160,255,.18); border-color: rgba(120,160,255,.45);
  color: var(--text-primary, #fff);
}
.gw-tab:hover:not(.is-active) { background: rgba(255,255,255,.07); color: #ddd; }
.gw-tab-icon { display: inline-flex; align-items: center; line-height: 1; opacity: .85; }
.gw-tab.is-active .gw-tab-icon { opacity: 1; }
.gw-hero-subtitle { color: var(--text-muted, #888); font-size: 13px; margin: 0; }
/* Bascule principale Ghost Writer : Réécriture | Correction (co-égales) */
.gw-family-switch { display: inline-flex; gap: 4px; padding: 4px; border-radius: 100px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09); align-self: flex-start; }
.gw-fam { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px; border-radius: 100px;
  background: transparent; border: 0; color: var(--text-muted, #9aa); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all .15s ease; font-family: inherit; }
.gw-fam:hover:not(.is-active) { color: #ddd; background: rgba(255,255,255,.05); }
.gw-fam.is-active { background: linear-gradient(135deg, rgba(120,160,255,.9), rgba(128,96,255,.9)); color: #fff; box-shadow: 0 2px 10px rgba(120,120,255,.25); cursor: default; }
html.light-mode .gw-family-switch { background: rgba(0,0,0,.04); border-color: rgba(0,0,0,.08); }
html.light-mode .gw-fam:hover:not(.is-active) { color: #334155; background: rgba(0,0,0,.04); }

.gw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
@media (max-width: 1000px) { .gw-grid { grid-template-columns: 1fr; } }

.gw-pane { display: flex; flex-direction: column; gap: 12px; }
.gw-pane-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--text-muted, #888); font-weight: 600; }
.gw-pane-label-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.gw-source {
  width: 100%; box-sizing: border-box; height: 340px; resize: none;
  padding: 16px; border-radius: 14px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  color: var(--text-primary, #fff); font-size: 14px; line-height: 1.55;
  font-family: inherit;
  box-shadow: 0 2px 10px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.gw-source:focus { outline: 0; border-color: rgba(120,160,255,.45); background: rgba(255,255,255,.06);
  box-shadow: 0 0 0 3px rgba(120,160,255,.14), inset 0 1px 0 rgba(255,255,255,.04); }
.gw-source-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted, #888); }

.gw-criteria { margin-top: 18px; }
.gw-criteria-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 8px; }
.gw-field { display: flex; flex-direction: column; gap: 4px; }
.gw-field-label { font-size: 11px; color: var(--text-muted, #888); font-weight: 500; }
.gw-select {
  width: 100%; box-sizing: border-box;
  padding: 9px 32px 9px 12px; border-radius: 8px;
  background-color: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  color: var(--text-primary, #fff); font-size: 13px; font-family: inherit;
  /* Charte flat : neutralise le rendu natif bombé + chevron neutre */
  appearance: none; -webkit-appearance: none; -moz-appearance: none;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 11px center;
}
.gw-select:focus { outline: 0; border-color: rgba(120,160,255,.4); }

.gw-actions-row { margin-top: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.gw-btn-primary {
  flex: 1; padding: 13px 22px;
  background: linear-gradient(135deg, #6496ff, #8060ff);
  border: 0; border-radius: 12px; color: white;
  font-size: 14px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: transform .15s ease, opacity .15s ease;
}
.gw-btn-primary:disabled { opacity: .55; cursor: not-allowed; }
.gw-btn-primary:hover:not(:disabled) { transform: translateY(-1px); }

.gw-meta-chips { display: flex; gap: 6px; }
.gw-chip { padding: 5px 11px; border-radius: 100px; font-size: 11px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.06); color: var(--text-muted, #888); }
.gw-chip-engine { background: rgba(120,160,255,.12); color: #8aaeff; border-color: rgba(120,160,255,.2); }

.gw-pane-variants { display: flex; flex-direction: column; gap: 12px; }
.gw-variant {
  padding: 16px 18px; border-radius: 14px; height: 340px;
  display: flex; flex-direction: column;
  background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
  box-shadow: 0 2px 10px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.03);
  transition: all .15s ease;
}
.gw-variant:hover { border-color: rgba(120,160,255,.3); background: rgba(255,255,255,.05); transform: translateY(-1px); }
/* 3 fenêtres : slot vide / fantôme avant génération */
.gw-variant-empty { border-style: dashed; border-color: rgba(255,255,255,.1); background: rgba(255,255,255,.015); box-shadow: none; }
.gw-variant-empty:hover { transform: none; border-color: rgba(255,255,255,.14); }
.gw-variant-ghost { color: var(--text-muted, #888); opacity: .55; }
.gw-slot-hint { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: auto; padding: 8px; text-align: center; color: var(--text-muted, #888); font-size: 13px; line-height: 1.5; }
.gw-slot-hint svg { opacity: .28; }
.gw-slot-hint strong { color: var(--text-primary, #ccc); font-weight: 600; }
html.light-mode .gw-variant-empty { background: rgba(0,0,0,.015); border-color: rgba(0,0,0,.12); }
.gw-variant-label { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: rgba(120,160,255,.15); color: #8aaeff; font-size: 12.5px; font-weight: 700; margin-bottom: 12px; flex-shrink: 0; }
.gw-variant-text { flex: 1 1 auto; min-height: 0; overflow-y: auto; color: var(--text-primary, #f0f0f0); font-size: 13px; line-height: 1.65; white-space: pre-wrap; word-wrap: break-word; }
.gw-variant-text::-webkit-scrollbar { width: 7px; }
.gw-variant-text::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 4px; }
.gw-variant-actions { margin-top: auto; padding-top: 14px; display: flex; gap: 6px; }
.gw-mini-btn {
  padding: 6px 14px; border-radius: 7px; font-size: 11px; font-weight: 500; cursor: pointer;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
  color: var(--text-primary, #ddd); transition: all .15s ease;
}
.gw-mini-btn:hover { background: rgba(120,160,255,.14); border-color: rgba(120,160,255,.35); color: #fff; }
.gw-mini-btn--danger:hover { background: rgba(255,90,90,.14); border-color: rgba(255,90,90,.4); color: #ff8080; }
.gw-empty { color: var(--text-muted, #888); font-size: 13px; text-align: center; padding: 64px 24px; line-height: 1.65; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.gw-empty svg { opacity: .22; margin-bottom: 14px; }

.gw-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,.3);
  border-top-color: white; border-radius: 50%;
  animation: gw-spin .8s linear infinite;
  display: inline-block;
}
.gw-spinner-lg { width: 22px; height: 22px; border-width: 2.5px; }
@keyframes gw-spin { to { transform: rotate(360deg); } }

/* Bibliothèque slide-over */
.gw-lib-overlay { position: fixed; inset: 0; z-index: 9000; opacity: 0; transition: opacity .22s ease; }
.gw-lib-overlay.gw-lib-on { opacity: 1; }
.gw-lib-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.5); }
.gw-lib-panel {
  position: absolute; top: 0; right: 0; height: 100%; width: min(480px, 92vw);
  background: var(--bg-secondary, #16161a);
  border-left: 1px solid rgba(255,255,255,.1);
  box-shadow: -16px 0 48px rgba(0,0,0,.5);
  display: flex; flex-direction: column;
  transform: translateX(20px); transition: transform .22s cubic-bezier(.16,1,.3,1);
}
.gw-lib-overlay.gw-lib-on .gw-lib-panel { transform: translateX(0); }
.gw-lib-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px; border-bottom: 1px solid rgba(255,255,255,.06);
  flex-shrink: 0;
}
.gw-lib-title { font-size: 16px; font-weight: 700; color: var(--text-primary, #fff); letter-spacing: -0.02em; }
.gw-lib-count { font-size: 11px; color: var(--text-muted, #888); font-weight: 500; margin-left: 6px; }
.gw-lib-list { flex: 1; overflow-y: auto; padding: 16px 20px; }
.gw-lib-empty { color: var(--text-muted, #888); font-size: 13px; text-align: center; padding: 40px 20px; line-height: 1.6; }
.gw-lib-item {
  padding: 14px; border-radius: 10px; margin-bottom: 10px;
  background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08);
}
.gw-lib-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; gap: 12px; }
.gw-lib-label { font-size: 12px; font-weight: 600; color: #8aaeff; text-transform: uppercase; letter-spacing: 0.06em; }
.gw-lib-meta { font-size: 10px; color: var(--text-muted, #888); }
.gw-lib-text { font-size: 12px; line-height: 1.55; color: var(--text-primary, #ddd); margin-bottom: 10px; white-space: pre-wrap; word-wrap: break-word; }
.gw-lib-actions { display: flex; gap: 6px; flex-wrap: wrap; }

/* Toast */
.gw-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
  padding: 12px 20px; border-radius: 10px; z-index: 99999;
  background: rgba(20,20,25,.95); color: #fff; font-size: 13px; font-weight: 500;
  border: 1px solid rgba(255,255,255,.1); box-shadow: 0 8px 32px rgba(0,0,0,.4);
  opacity: 0; transition: opacity .22s ease, transform .22s cubic-bezier(.16,1,.3,1);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  pointer-events: none;
}
.gw-toast-show { opacity: 1; transform: translateX(-50%) translateY(0); }
.gw-toast-error { background: rgba(60,20,20,.95); border-color: rgba(255,100,100,.3); color: #ffb0b0; }

/* ── Mode clair — surfaces (le texte est déjà géré par les variables --text-*) ── */
html.light-mode .gw-tab { background: rgba(0,0,0,.03); border-color: rgba(0,0,0,.1); }
html.light-mode .gw-tab:hover:not(.is-active) { background: rgba(0,0,0,.05); color: #334155; }
html.light-mode .gw-tab.is-active { background: rgba(80,110,230,.12); border-color: rgba(80,110,230,.4); }
html.light-mode .gw-source { background: #fff; border-color: rgba(0,0,0,.14); }
/* background-color (pas le shorthand) : préserve le chevron du select */
html.light-mode .gw-select { background-color: #fff; border-color: rgba(0,0,0,.14); color: #1e293b; }
html.light-mode .gw-source:focus { background: #fff; border-color: rgba(80,110,230,.5); }
html.light-mode .gw-chip { background: rgba(0,0,0,.04); border-color: rgba(0,0,0,.08); }
html.light-mode .gw-chip-engine { background: rgba(80,110,230,.1); border-color: rgba(80,110,230,.25); color: #4456c4; }
html.light-mode .gw-variant { background: #fff; border-color: rgba(0,0,0,.09); }
html.light-mode .gw-variant:hover { background: #fcfcfd; border-color: rgba(80,110,230,.3); }
html.light-mode .gw-variant-label,
html.light-mode .gw-lib-label { color: #4456c4; }
html.light-mode .gw-variant-label { background: rgba(80,110,230,.12); }
html.light-mode .gw-mini-btn { background: rgba(0,0,0,.04); border-color: rgba(0,0,0,.1); }
html.light-mode .gw-mini-btn:hover { background: rgba(80,110,230,.1); border-color: rgba(80,110,230,.3); color: #1e293b; }
html.light-mode .gw-lib-panel { background: #ffffff; border-left-color: rgba(0,0,0,.1); }
html.light-mode .gw-lib-item { background: rgba(0,0,0,.025); border-color: rgba(0,0,0,.07); }
html.light-mode .gw-lib-header { border-bottom-color: rgba(0,0,0,.07); }
  `;
  const style = document.createElement('style');
  style.id = 'ks-gw-studio-styles';
  style.textContent = css;
  document.head.appendChild(style);
}
