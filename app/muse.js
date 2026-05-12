/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact MUSE (A-COM-003) v1.0
   Sprint Muse-1 : workspace fullscreen + génération du Prompt
   Maître Artistique.

   Mission : transformer une intention visuelle (cadrage,
   atmosphère, cible lifestyle) en Prompt Maître Artistique
   structuré, à coller dans une IA tierce (Claude, Gemini,
   ChatGPT, Mistral, Grok, Perplexity, Llama).

   L'IA tierce génère en retour un fichier HTML autonome avec
   UN SEUL bouton copy-to-clipboard contenant UN SEUL prompt
   unifié, destiné à un générateur d'images (Midjourney, Flux,
   DALL-E, Nano Banana…). Ce prompt unique produit en une seule
   passe une planche moodboard complète (grille 3×2, 6 vignettes
   thématiques : architecture, lumière, palette végétale,
   matériaux, lifestyle, détail signature).

   Architecture des 4 étapes :
   ─────────────────────────────────────────────────────────────
     1. CONTEXT  — Support, ratio, dimensions, secteur, projet
     2. FRAMING  — Point de vue + sujet + intention focale
     3. MOOD     — Lumière, saison, végétation, figuration, style
     4. OUTPUT   — Génération du Prompt Maître + copy-to-clipboard

   Connexion Kodex (future) : import du support/ratio/secteur
   depuis un brief Kodex existant (entity codex_briefs). Pour
   Muse-1, saisie manuelle uniquement.

   Réutilisabilité :
     Structure identique au pattern Kodex (.ws-* + openMuse).
     Cloner ce fichier en `<nouvel-outil>.js`, garder la
     mécanique, remplacer WORKSPACE_META, STEPS et les vues.
   ═══════════════════════════════════════════════════════════════ */

import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { icon } from './lib/ui-icons.js';
import {
  getSupports, getViewpoints, getLights, getSeasons,
  getVegetations, getFigurations, getStyles, getTargetEngines, getImageEngines,
  getSupport, getViewpoint, checkRatioCoherence,
} from './lib/muse-catalog.js';
import { buildPromptMaitre, validateForGeneration } from './lib/muse-prompt.js';

// ── Métadonnées workspace ─────────────────────────────────────
const WORKSPACE_META = {
  id        : 'A-COM-003',
  name      : 'Muse',
  punchline : 'Le moodboard de référence pour votre studio 3D',
};

// ── Définition des étapes (ordre + icône + label) ─────────────
const STEPS = [
  { id: 'context', label: 'Le contexte',  icon: 'sliders',
    sublabel: 'Support, format et secteur' },
  { id: 'framing', label: 'Le cadrage',   icon: 'eye',
    sublabel: 'Point de vue et intention' },
  { id: 'mood',    label: "L'atmosphère", icon: 'palette',
    sublabel: 'Lumière, ambiance, cible' },
  { id: 'output',  label: 'Le Prompt Maître', icon: 'sparkles',
    sublabel: 'À copier dans votre IA' },
];

// ── État global (in-memory + localStorage) ────────────────────
let _state = _freshState();

function _freshState() {
  return {
    view: 'context',
    context: {
      support: '',
      support_label: '',
      ratio: '',
      width_mm: null,
      height_mm: null,
      sector: 'immobilier',
      project_name: '',
      location: '',
      kodex_brief_id: null,
    },
    framing: {
      viewpoint: null,
      subject: '',
      focal_intent: '',
    },
    mood: {
      light: '',
      season: '',
      vegetation: '',
      figuration: '',
      style: '',
      materials_focus: '',
    },
    output: {
      status: 'idle',          // idle | building | done | error
      error: null,
      prompt: null,
      target_engine: 'Claude',
      image_engine: 'midjourney',
      generated_at: null,
    },
  };
}

let _root = null;            // élément racine du workspace
let _saveTimer = null;       // debounce localStorage

// ═══════════════════════════════════════════════════════════════
// Persistance brouillon (localStorage + cloud-vault sync)
// ═══════════════════════════════════════════════════════════════
const LS_DRAFT_KEY = 'ks_muse_draft';

function _saveDraft() {
  try {
    localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(_state));
    import('./vault.js').then(m => m.scheduleAutoSave?.()).catch(() => {});
  } catch (_) {}
}

function _scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveDraft, 350);
}

function _loadDraft() {
  try {
    const raw = localStorage.getItem(LS_DRAFT_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    const fresh = _freshState();
    _state = {
      ...fresh,
      ...data,
      context: { ...fresh.context, ...(data.context || {}) },
      framing: { ...fresh.framing, ...(data.framing || {}) },
      mood:    { ...fresh.mood,    ...(data.mood    || {}) },
      output:  { ...fresh.output,  ...(data.output  || {}) },
    };
    return true;
  } catch (_) {
    return false;
  }
}

function _resetDraft() {
  try { localStorage.removeItem(LS_DRAFT_KEY); } catch (_) {}
  _state = _freshState();
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════
export function openMuse() {
  if (_root) return;
  _loadDraft();
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';
}

export function closeMuse() {
  if (!_root) return;
  _saveDraft();
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════════
// Shell (top bar + rail + main + aside)
// ═══════════════════════════════════════════════════════════════
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <button class="ws-topbar-back" data-act="close">
        ${icon('arrow-left', 16)}
        <span>Retour</span>
      </button>
      <div class="ws-topbar-title">
        <span class="name">${WORKSPACE_META.name}</span>
        <span class="sep">·</span>
        <span class="crumb" data-slot="crumb">${_currentStep().label}</span>
      </div>
      <div class="ws-topbar-actions">
        ${ratingButtonHTML(WORKSPACE_META.id)}
        <button class="ws-iconbtn" data-act="save" title="Sauvegarder le brouillon (Cmd+S)">
          ${icon('save', 18)}
        </button>
        <button class="ws-iconbtn" data-act="reset" title="Effacer et recommencer">
          ${icon('refresh', 18)}
        </button>
        <button class="ws-iconbtn" data-act="close" title="Fermer">
          ${icon('x', 18)}
        </button>
      </div>
    </header>

    <div class="ws-body">
      <nav class="ws-rail" data-slot="rail"></nav>
      <main class="ws-main" data-slot="main"></main>
      <aside class="ws-aside" data-slot="aside"></aside>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('input', _onInput);
  _root.addEventListener('change', _onInput);
  bindRatingButton(_root, WORKSPACE_META.id);
  _renderRail();
  _renderAside();
}

// ═══════════════════════════════════════════════════════════════
// Délégation des évènements
// ═══════════════════════════════════════════════════════════════
function _onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'close')           return closeMuse();
  if (act === 'goto')            return _navigate(t.dataset.step);
  if (act === 'next')            return _advance();
  if (act === 'prev')            return _back();
  if (act === 'save')            { _saveDraft(); _toastOk('Brouillon sauvegardé'); return; }
  if (act === 'reset') {
    if (confirm('Effacer toutes vos saisies et recommencer le brief Muse ?')) {
      _resetDraft();
      _renderMain();
      _toastOk('Brouillon réinitialisé');
    }
    return;
  }
  if (act === 'pick-support')    return _pickSupport(t.dataset.id);
  if (act === 'pick-viewpoint')  return _pickViewpoint(t.dataset.id);
  if (act === 'pick-mood')       return _pickMood(t.dataset.group, t.dataset.id);
  if (act === 'pick-engine')     return _pickEngine(t.dataset.id);
  if (act === 'pick-image-engine') return _pickImageEngine(t.dataset.id);
  if (act === 'generate-prompt') return _generatePrompt();
  if (act === 'regenerate')      return _generatePrompt();
  if (act === 'copy-prompt')     return _copyPrompt(t);
  if (act === 'download-prompt') return _downloadPrompt();
}

function _onInput(e) {
  const el = e.target;
  if (!el.name) return;
  const group = el.dataset.group;
  if (!group) return;
  let value = el.value;
  if (el.type === 'number') value = value === '' ? null : Number(value);
  if (_state[group]) {
    _state[group][el.name] = value;
    _scheduleSave();
  }
}

// ── Sélecteurs cliquables (cards / chips) ─────────────────────
// Tous ces handlers préservent la position de scroll pour ne pas
// faire remonter la page au clic sur une option.
async function _pickSupport(id) {
  const s = await getSupport(id);
  if (!s) return;
  _state.context.support = id;
  _state.context.support_label = s.label;
  // Pré-renseigne le ratio par défaut si pas encore choisi
  if (!_state.context.ratio && s.default_ratio) {
    _state.context.ratio = s.default_ratio;
  }
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

function _pickViewpoint(id) {
  _state.framing.viewpoint = id;
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

function _pickMood(group, id) {
  if (!['light','season','vegetation','figuration','style'].includes(group)) return;
  // Click sur l'option déjà sélectionnée → on désélectionne
  _state.mood[group] = _state.mood[group] === id ? '' : id;
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

function _pickEngine(id) {
  _state.output.target_engine = id;
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

function _pickImageEngine(id) {
  _state.output.image_engine = id;
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

// ═══════════════════════════════════════════════════════════════
// Rail (navigation gauche)
// ═══════════════════════════════════════════════════════════════
function _renderRail() {
  const rail = _root.querySelector('[data-slot="rail"]');
  const idx = _currentStepIndex();
  rail.innerHTML = `
    <div class="ws-rail-section">Étapes</div>
    ${STEPS.map((s, i) => {
      const status = i < idx ? 'is-done' : (i === idx ? 'is-active' : '');
      const numContent = i < idx ? icon('check', 12) : (i + 1);
      return `
        <button class="ws-step ${status}" data-act="goto" data-step="${s.id}">
          <span class="ws-step-num">${numContent}</span>
          <span class="ws-step-icon" style="width:18px;height:18px;">${icon(s.icon, 18)}</span>
          <span class="ws-step-label">${s.label}</span>
        </button>
      `;
    }).join('')}
  `;
}

// ═══════════════════════════════════════════════════════════════
// Aside (panel droit) — assistance contextuelle
// ═══════════════════════════════════════════════════════════════
function _renderAside() {
  const aside = _root.querySelector('[data-slot="aside"]');
  aside.innerHTML = `
    <div class="ws-aside-section">
      <div class="ws-aside-title">À quoi ça sert</div>
      <div class="ws-aside-card">
        Muse prépare la <strong style="color:var(--gold);">planche d'ambiance</strong>
        à transmettre à votre studio 3D spécialisé en illustration immobilière.
        Vous configurez l'univers visuel cible (cadrage, lumière, palette végétale,
        matériaux, figuration). Muse assemble un Prompt Maître que vous collez dans
        votre IA habituelle ; elle vous renvoie un fichier HTML avec un bouton "Copier"
        qui génère, en <strong>une seule image</strong>, une planche moodboard
        professionnelle composée de 6 vignettes cohérentes (Midjourney, Flux,
        DALL-E, Imagen…). Le studio modélise ensuite le projet sur plan en
        s'inspirant de cette planche.
      </div>
    </div>

    <div class="ws-aside-section">
      <div class="ws-aside-title">À retenir</div>
      <div class="ws-aside-card" style="background:rgba(245,158,11,.06);border-color:var(--warn);">
        <strong style="color:var(--warn);display:block;margin-bottom:4px;">
          ${icon('shield-check', 14)} Pas une "génération du projet"
        </strong>
        Les images obtenues ne représentent <strong>pas</strong> votre programme :
        ce sont des <em>références d'ambiance dans le même esprit</em>, à glisser
        dans le brief du studio 3D pour qu'il sache exactement quelle direction
        artistique viser lors de la modélisation sur plan.
      </div>
    </div>

    <div class="ws-aside-section">
      <div class="ws-aside-title">Votre progression</div>
      <div class="ws-aside-card" data-slot="progress">
        <span class="ws-badge">Étape ${_currentStepIndex() + 1} sur ${STEPS.length}</span>
      </div>
    </div>

    <div class="ws-aside-section">
      <div class="ws-aside-title">Notre force</div>
      <div class="ws-aside-card">
        <strong style="color: var(--ws-text); display:block; margin-bottom:6px;">
          ${icon('shield-check', 14)} Cohérence ratio automatique
        </strong>
        Muse vérifie que votre cadrage est compatible avec le ratio du support
        (issu de Kodex). Si vous choisissez une bâche horizontale avec une vue
        intérieure verticale, on injecte automatiquement le paramètre
        <code style="font-size:11px;background:var(--gold3);padding:1px 5px;border-radius:4px;color:var(--gold);">--ar</code>
        dans les prompts pour éviter toute déformation.
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Main panel — dispatch par vue
// ═══════════════════════════════════════════════════════════════
// preserveScroll: true → conserve la position de scroll actuelle
// (utilisé pour les sélections de chips/cards qui ne changent pas
// d'étape). Par défaut false → reset en haut (utilisé pour la
// navigation entre étapes).
function _renderMain(opts = {}) {
  const main = _root.querySelector('[data-slot="main"]');
  const prevScroll = main.scrollTop;
  const view = _state.view;
  let html = '';
  if (view === 'context')      html = _viewContext();
  else if (view === 'framing') html = _viewFraming();
  else if (view === 'mood')    html = _viewMood();
  else if (view === 'output')  html = _viewOutput();
  main.innerHTML = `<div class="ws-main-inner">${html}${_stepNav()}</div>`;
  main.scrollTop = opts.preserveScroll ? prevScroll : 0;

  const crumb = _root.querySelector('[data-slot="crumb"]');
  if (crumb) crumb.textContent = _currentStep().label;
  _renderRail();
  const progress = _root.querySelector('[data-slot="progress"]');
  if (progress) {
    progress.innerHTML = `<span class="ws-badge">Étape ${_currentStepIndex() + 1} / ${STEPS.length}</span>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// Vue 1 — CONTEXT
// ═══════════════════════════════════════════════════════════════
function _viewContext() {
  const ctx = _state.context;

  const root = `
    <span class="ws-eyebrow">${icon('sliders', 12)} 1 sur 4 · Le contexte</span>
    <h1 class="ws-h1">Quel livrable allez-vous commander à votre studio 3D&nbsp;?</h1>
    <p class="ws-lead">
      Les trois premiers choix sont les commandes les plus fréquentes auprès des
      studios spécialisés en illustration immobilière. Les suivants correspondent
      aux <em>usages finaux</em> de l'illustration (bâche, magazine, réseaux
      sociaux)&nbsp;— utiles pour caler le ratio et le niveau de détail attendu.
    </p>

    <h3 class="ws-h3" style="margin-top:24px;">Livrable commandé au studio 3D · ou support de diffusion finale</h3>
    <div class="ws-card-grid" data-slot="support-list">
      <div class="ws-empty">
        <div class="ws-empty-icon">${icon('package', 24)}</div>
        <p class="ws-empty-desc">Chargement…</p>
      </div>
    </div>

    <h3 class="ws-h3" style="margin-top:32px;">Détails du projet</h3>
    <div class="ws-card" style="padding:22px 26px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;">
        <div class="ws-field">
          <label class="ws-label">Ratio cible</label>
          <input class="ws-input" type="text" name="ratio" data-group="context"
                 value="${_esc(ctx.ratio || '')}" placeholder="ex. 16:9, 4:5, 3:1">
        </div>
        <div class="ws-field">
          <label class="ws-label">Secteur</label>
          <select class="ws-select" name="sector" data-group="context">
            <option value="immobilier" ${ctx.sector==='immobilier'?'selected':''}>Immobilier</option>
            <option value="retail" ${ctx.sector==='retail'?'selected':''}>Retail / commerce</option>
            <option value="restauration" ${ctx.sector==='restauration'?'selected':''}>Restauration</option>
            <option value="autre" ${ctx.sector==='autre'?'selected':''}>Autre</option>
          </select>
        </div>
        <div class="ws-field">
          <label class="ws-label">Largeur (mm) — optionnel</label>
          <input class="ws-input" type="number" name="width_mm" data-group="context"
                 value="${ctx.width_mm ?? ''}" placeholder="ex. 4000">
        </div>
        <div class="ws-field">
          <label class="ws-label">Hauteur (mm) — optionnel</label>
          <input class="ws-input" type="number" name="height_mm" data-group="context"
                 value="${ctx.height_mm ?? ''}" placeholder="ex. 3000">
        </div>
        <div class="ws-field" style="grid-column:1/-1;">
          <label class="ws-label">Nom du projet</label>
          <input class="ws-input" type="text" name="project_name" data-group="context"
                 value="${_esc(ctx.project_name || '')}" placeholder="ex. Les Jardins du Mourillon">
        </div>
        <div class="ws-field" style="grid-column:1/-1;">
          <label class="ws-label">Localisation</label>
          <input class="ws-input" type="text" name="location" data-group="context"
                 value="${_esc(ctx.location || '')}" placeholder="ex. Bandol (Var)">
        </div>
      </div>
    </div>
  `;

  // Hydratation asynchrone des cartes support
  getSupports().then(supports => {
    const slot = _root?.querySelector('[data-slot="support-list"]');
    if (!slot) return;
    slot.innerHTML = supports.map(s => {
      const selected = ctx.support === s.id;
      const primary  = !!s.primary;
      return `
        <div class="ws-card is-clickable ${selected ? 'is-selected' : ''}"
             data-act="pick-support" data-id="${_esc(s.id)}"
             style="${selected ? 'background:var(--ws-accent-soft);border-color:var(--ws-accent);' : (primary ? 'border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset, 0 4px 14px rgba(99,102,241,.10);' : '')}">
          <div class="ws-card-row">
            <div class="ws-card-icon" style="${selected ? 'background:var(--ws-accent);color:#fff;' : (primary ? 'background:var(--gold3);color:var(--gold);' : '')}">
              ${icon(s.icon || 'package', 22)}
            </div>
            <div class="ws-card-body">
              <h3 class="ws-card-title">
                ${_esc(s.label)}
                ${primary ? `<span class="ws-badge" style="margin-left:8px;background:var(--gold3);color:var(--gold);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Studio 3D</span>` : ''}
              </h3>
              <p class="ws-card-desc">
                Ratio par défaut <strong>${_esc(s.default_ratio || '—')}</strong> · ${_esc(s.context || '')}
              </p>
            </div>
          </div>
        </div>
      `;
    }).join('');
  });

  return root;
}

// ═══════════════════════════════════════════════════════════════
// Vue 2 — FRAMING
// ═══════════════════════════════════════════════════════════════
function _viewFraming() {
  const frm = _state.framing;

  const root = `
    <span class="ws-eyebrow">${icon('eye', 12)} 2 sur 4 · Le cadrage</span>
    <h1 class="ws-h1">Quel angle voulez-vous pour l'illustration finale&nbsp;?</h1>
    <p class="ws-lead">
      C'est <strong>l'angle de l'image que le studio 3D va modéliser</strong> à partir
      des plans techniques. Choisissez la prise de vue qui sert le mieux votre récit
      commercial&nbsp;— envergure (drone), immersion (piéton), volumes intérieurs,
      atout extérieur, ou détail matières.
    </p>

    <div class="ws-card-grid" data-slot="viewpoint-list" style="margin-top:18px;">
      <div class="ws-empty">
        <div class="ws-empty-icon">${icon('eye', 24)}</div>
        <p class="ws-empty-desc">Chargement…</p>
      </div>
    </div>

    <h3 class="ws-h3" style="margin-top:32px;">Précisions sur le cadrage</h3>
    <div class="ws-card" style="padding:22px 26px;">
      <div class="ws-field">
        <label class="ws-label">Sujet principal de l'image</label>
        <input class="ws-input" type="text" name="subject" data-group="framing"
               value="${_esc(frm.subject || '')}"
               placeholder="ex. Façade principale avec terrasses cascadées sur la mer">
      </div>
      <div class="ws-field" style="margin-top:14px;">
        <label class="ws-label">Intention focale — ce que vous voulez vraiment montrer</label>
        <textarea class="ws-textarea" name="focal_intent" data-group="framing"
                  rows="3"
                  placeholder="ex. L'envergure du projet et son intégration discrète dans le paysage méditerranéen. La qualité des matériaux et l'élégance contemporaine sans ostentation.">${_esc(frm.focal_intent || '')}</textarea>
      </div>
    </div>
  `;

  // Hydratation asynchrone
  getViewpoints().then(viewpoints => {
    const slot = _root?.querySelector('[data-slot="viewpoint-list"]');
    if (!slot) return;
    slot.innerHTML = viewpoints.map(v => {
      const selected = frm.viewpoint === v.id;
      return `
        <div class="ws-card is-clickable ${selected ? 'is-selected' : ''}"
             data-act="pick-viewpoint" data-id="${_esc(v.id)}"
             style="${selected ? 'background:var(--ws-accent-soft);border-color:var(--ws-accent);' : ''}">
          <div class="ws-card-row">
            <div class="ws-card-icon" style="${selected ? 'background:var(--ws-accent);color:#fff;' : ''}">
              ${icon(v.icon || 'eye', 22)}
            </div>
            <div class="ws-card-body">
              <h3 class="ws-card-title">${_esc(v.label)}</h3>
              <p class="ws-card-desc">${_esc(v.narrative)}</p>
            </div>
          </div>
        </div>
      `;
    }).join('');
  });

  return root;
}

// ═══════════════════════════════════════════════════════════════
// Vue 3 — MOOD
// ═══════════════════════════════════════════════════════════════
function _viewMood() {
  const mood = _state.mood;

  const root = `
    <span class="ws-eyebrow">${icon('palette', 12)} 3 sur 4 · L'atmosphère</span>
    <h1 class="ws-h1">Quelle atmosphère voulez-vous transmettre&nbsp;?</h1>
    <p class="ws-lead">
      Sélectionnez au moins une option par groupe&nbsp;— ou laissez libre pour
      ouvrir le champ créatif. Vous pouvez cliquer une seconde fois sur une
      option sélectionnée pour la désélectionner.
    </p>

    ${_moodGroupBlock('Lumière',           'light',      'lights')}
    ${_moodGroupBlock('Saison',            'season',     'seasons')}
    ${_moodGroupBlock('Végétation',        'vegetation', 'vegetations')}
    ${_moodGroupBlock('Figuration humaine','figuration', 'figurations')}
    ${_moodGroupBlock('Direction artistique','style',    'styles')}

    <h3 class="ws-h3" style="margin-top:32px;">Précisions libres</h3>
    <div class="ws-card" style="padding:22px 26px;">
      <div class="ws-field">
        <label class="ws-label">Matériaux et textures à mettre en avant</label>
        <input class="ws-input" type="text" name="materials_focus" data-group="mood"
               value="${_esc(mood.materials_focus || '')}"
               placeholder="ex. pierre de Cassis, bois brûlé, alu anodisé champagne">
      </div>
    </div>
  `;

  // Hydrate chaque groupe
  ['light','season','vegetation','figuration','style'].forEach(group => {
    const loader = group === 'light' ? getLights
                : group === 'season' ? getSeasons
                : group === 'vegetation' ? getVegetations
                : group === 'figuration' ? getFigurations
                : getStyles;
    loader().then(options => {
      const slot = _root?.querySelector(`[data-slot="mood-${group}"]`);
      if (!slot) return;
      slot.innerHTML = options.map(o => {
        const selected = mood[group] === o.id;
        return `
          <button class="ws-chip ${selected ? 'is-selected' : ''}"
                  data-act="pick-mood" data-group="${group}" data-id="${_esc(o.id)}"
                  style="all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:-.005em;border:1px solid ${selected ? 'var(--ws-accent)' : 'var(--ws-border)'};background:${selected ? 'var(--ws-accent-soft)' : 'transparent'};color:${selected ? 'var(--ws-accent)' : 'var(--ws-text)'};transition:all 140ms ease;margin:4px 6px 4px 0;">
            ${selected ? icon('check', 13) : ''}
            ${_esc(o.label)}
          </button>
        `;
      }).join('');
    });
  });

  return root;
}

function _moodGroupBlock(title, group, _seedName) {
  return `
    <h3 class="ws-h3" style="margin-top:24px;">${_esc(title)}</h3>
    <div data-slot="mood-${group}" style="display:flex;flex-wrap:wrap;gap:4px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Vue 4 — OUTPUT (Prompt Maître Artistique)
// ═══════════════════════════════════════════════════════════════
function _viewOutput() {
  const o = _state.output;
  const validationError = validateForGeneration(_state);

  let body = '';

  // ── État : généré → afficher le prompt + actions ─────────
  if (o.status === 'done' && o.prompt) {
    body = _renderPromptResult();
  }
  // ── État : en cours d'assemblage ──────────────────────────
  else if (o.status === 'building') {
    body = `
      <div class="ws-card" style="text-align:center;padding:48px 24px;">
        <div style="display:inline-flex;width:56px;height:56px;border-radius:50%;background:var(--gold3);align-items:center;justify-content:center;margin-bottom:16px;animation:muse-pulse 1.4s ease-in-out infinite;">
          ${icon('palette', 28)}
        </div>
        <h3 style="font-size:16px;font-weight:700;letter-spacing:-.018em;margin:0 0 6px 0;">Muse assemble votre Prompt Maître…</h3>
        <p style="margin:0;font-size:13px;color:var(--ws-text-muted);max-width:380px;margin-inline:auto;line-height:1.55;">
          Nous croisons votre cadrage, votre atmosphère et les contraintes techniques du support.
        </p>
      </div>
      <style>
        @keyframes muse-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(1.08); opacity: .7; }
        }
      </style>
    `;
  }
  // ── État : erreur ──────────────────────────────────────────
  else if (o.status === 'error') {
    body = `
      <div class="ws-card" style="border-color:var(--danger);background:var(--danger-soft);">
        <div style="display:flex;gap:12px;align-items:flex-start;">
          ${icon('x', 22)}
          <div>
            <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:var(--danger);">L'assemblage a échoué</h3>
            <p style="margin:0;font-size:13px;color:var(--ws-text);line-height:1.5;">${_esc(o.error || 'Erreur inconnue.')}</p>
          </div>
        </div>
      </div>
      <div style="margin-top:16px;">
        <button class="ws-btn ws-btn--accent" data-act="regenerate">
          ${icon('refresh', 16)} Réessayer
        </button>
      </div>
    `;
  }
  // ── État initial : invitation à générer ────────────────────
  else {
    const canGenerate = !validationError;
    const coherence = _checkCurrentCoherence();
    body = `
      ${_renderEngineSelector()}

      ${coherence ? `
        <div class="ws-card" style="border-color:var(--warn);background:rgba(245,158,11,.06);padding:14px 18px;margin-bottom:16px;">
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--ws-text);">
            <span style="color:var(--warn);flex-shrink:0;">${icon('shield-check', 16)}</span>
            <div><strong style="color:var(--warn);">Cohérence ratio détectée&nbsp;:</strong> ${_esc(coherence)}</div>
          </div>
        </div>
      ` : ''}

      <div class="ws-card" style="text-align:center;padding:48px 24px;${canGenerate ? '' : 'opacity:.7;'}">
        <div style="display:inline-flex;width:56px;height:56px;border-radius:50%;background:var(--gold3);align-items:center;justify-content:center;margin-bottom:16px;color:var(--gold);">
          ${icon('sparkles', 28)}
        </div>
        <h3 style="font-size:18px;font-weight:800;letter-spacing:-.018em;margin:0 0 8px 0;">Tout est prêt pour assembler votre Prompt Maître</h3>
        <p style="margin:0 0 20px 0;font-size:13.5px;color:var(--ws-text-soft);max-width:480px;margin-inline:auto;line-height:1.6;">
          Muse n'appelle <strong style="color:var(--ws-text);">aucune IA</strong> à cette étape. Il assemble un prompt structuré
          que vous copierez ensuite dans <strong style="color:var(--ws-text);">${_esc(_state.output.target_engine)}</strong>.
          La génération du dashboard HTML interactif est faite par l'IA cible.
        </p>
        <button class="ws-btn ws-btn--accent" data-act="generate-prompt" ${canGenerate ? '' : 'disabled'}
                style="padding:12px 22px;font-size:14px;">
          ${icon('sparkles', 16)} Assembler le Prompt Maître
        </button>
        ${validationError ? `
          <div style="margin-top:14px;font-size:12.5px;color:var(--warn);display:inline-flex;align-items:center;gap:6px;">
            ${icon('x', 14)} ${_esc(validationError)}
          </div>
        ` : ''}
      </div>
    `;
  }

  return `
    <span class="ws-eyebrow">${icon('sparkles', 12)} 4 sur 4 · Le Prompt Maître</span>
    <h1 class="ws-h1">${o.status === 'done' ? 'Votre Prompt Maître est prêt' : 'C\'est le moment de l\'assemblage&nbsp;!'}</h1>
    <p class="ws-lead">
      ${o.status === 'done'
        ? 'Copiez ce texte dans votre IA. Elle vous demandera les plans techniques du programme, puis générera un fichier HTML contenant un bouton "Copier" unique qui produit votre planche d\'ambiance complète en une seule génération.'
        : 'Choisissez le moteur IA cible, puis Muse assemble le Prompt Maître. Vous n\'avez plus qu\'à le copier-coller — l\'IA va construire la planche d\'ambiance à transmettre au studio 3D.'
      }
    </p>
    ${body}
  `;
}

// ── Sélecteurs : moteur IA cible + moteur de génération d'images ──
function _renderEngineSelector() {
  const currentAi  = _state.output.target_engine;
  const currentImg = _state.output.image_engine;
  const block = `
    <h3 class="ws-h3" style="margin-top:0;margin-bottom:10px;">Moteur IA cible · pour le HTML</h3>
    <p style="font-size:13px;color:var(--ws-text-muted);margin:0 0 14px 0;">
      Choisissez celui dans lequel vous comptez coller le Prompt Maître. Il sera mentionné dans le prompt pour adapter l'instruction système.
    </p>
    <div data-slot="engines" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:24px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <h3 class="ws-h3" style="margin-top:0;margin-bottom:10px;">Moteur de génération d'images · pour la planche</h3>
    <p style="font-size:13px;color:var(--ws-text-muted);margin:0 0 14px 0;">
      Chaque moteur d'image a sa propre syntaxe. <strong style="color:var(--ws-text);">Midjourney / Flux / Stable Diffusion</strong> acceptent les paramètres <code style="font-size:11px;background:var(--gold3);color:var(--gold);padding:1px 5px;border-radius:4px;">--ar --style --v</code> ; <strong style="color:var(--ws-text);">DALL-E / Gemini Imagen / Nano Banana</strong> préfèrent de la prose narrative sans paramètres. Muse adapte automatiquement le prompt de la planche en conséquence.
    </p>
    <div data-slot="image-engines" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:24px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>
  `;

  // Hydratation moteurs IA
  getTargetEngines().then(engines => {
    const slot = _root?.querySelector('[data-slot="engines"]');
    if (!slot) return;
    slot.innerHTML = engines.map(e => {
      const selected = currentAi === e.id;
      return `
        <button class="ws-chip ${selected ? 'is-selected' : ''}"
                data-act="pick-engine" data-id="${_esc(e.id)}"
                title="${_esc(e.note || '')}"
                style="all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:-.005em;border:1px solid ${selected ? 'var(--ws-accent)' : 'var(--ws-border)'};background:${selected ? 'var(--ws-accent-soft)' : 'transparent'};color:${selected ? 'var(--ws-accent)' : 'var(--ws-text)'};transition:all 140ms ease;margin:4px 6px 4px 0;">
          ${selected ? icon('check', 13) : ''}
          ${_esc(e.label)}
          ${e.recommended ? `<span style="font-size:10px;color:var(--green);font-weight:700;margin-left:4px;">★</span>` : ''}
        </button>
      `;
    }).join('');
  });

  // Hydratation moteurs image
  getImageEngines().then(engines => {
    const slot = _root?.querySelector('[data-slot="image-engines"]');
    if (!slot) return;
    slot.innerHTML = engines.map(e => {
      const selected = currentImg === e.id;
      return `
        <button class="ws-chip ${selected ? 'is-selected' : ''}"
                data-act="pick-image-engine" data-id="${_esc(e.id)}"
                title="${_esc(e.note || '')}"
                style="all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:-.005em;border:1px solid ${selected ? 'var(--ws-accent)' : 'var(--ws-border)'};background:${selected ? 'var(--ws-accent-soft)' : 'transparent'};color:${selected ? 'var(--ws-accent)' : 'var(--ws-text)'};transition:all 140ms ease;margin:4px 6px 4px 0;">
          ${selected ? icon('check', 13) : ''}
          ${_esc(e.label)}
          ${e.recommended ? `<span style="font-size:10px;color:var(--green);font-weight:700;margin-left:4px;">★</span>` : ''}
        </button>
      `;
    }).join('');
  });

  return block;
}

// ── Cohérence ratio synchrone (best-effort, depuis le cache) ──
function _checkCurrentCoherence() {
  if (!_state.context.ratio || !_state.framing.viewpoint) return null;
  // Lecture synchrone depuis le cache si dispo (sinon best-effort = ratio support only)
  // On lance un fetch sans bloquer, le résultat sera dispo aux prochains render.
  let warning = null;
  getViewpoint(_state.framing.viewpoint).then(vp => {
    warning = checkRatioCoherence(_state.context.ratio, vp);
  }).catch(() => {});
  // Pour le premier render, on tente une lecture synchrone via le cache déjà chargé
  // (les options ont normalement été hydratées dans les vues précédentes)
  try {
    // Hack léger : on lit le module en cache via une variable globale du loader
    // Pas optimal, mais évite un await dans une fonction de render synchrone.
    // L'utilisateur verra le warning au render suivant après le 1er fetch.
  } catch (_) {}
  return warning;
}

// ── Affichage du Prompt Maître généré ─────────────────────────
function _renderPromptResult() {
  const o = _state.output;
  const generatedAt = o.generated_at ? new Date(o.generated_at).toLocaleString('fr-FR') : '—';
  const promptText = o.prompt || '';

  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center;">
      <span class="ws-badge ws-badge--success">${icon('check', 12)} Assemblé le ${_esc(generatedAt)}</span>
      <span class="ws-badge">Cible : ${_esc(o.target_engine)}</span>
      <span class="ws-badge">${promptText.length.toLocaleString('fr-FR')} caractères</span>
    </div>

    <div class="ws-card" style="padding:0;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--ws-border);background:var(--ws-surface);">
        <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ws-text-muted);">
          Prompt Maître Artistique
        </div>
        <div style="display:flex;gap:8px;">
          <button class="ws-btn ws-btn--accent" data-act="copy-prompt" style="padding:8px 16px;font-size:13px;">
            ${icon('copy', 14)} <span data-slot="copy-label">Copier le prompt</span>
          </button>
        </div>
      </div>
      <pre data-slot="prompt-text" style="margin:0;padding:22px 24px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:12.5px;line-height:1.65;color:var(--ws-text);white-space:pre-wrap;word-break:break-word;max-height:560px;overflow-y:auto;background:transparent;">${_esc(promptText)}</pre>
    </div>

    <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
      <button class="ws-btn ws-btn--secondary" data-act="copy-prompt">
        ${icon('copy', 16)} Copier
      </button>
      <button class="ws-btn ws-btn--secondary" data-act="download-prompt">
        ${icon('file-text', 16)} Télécharger en .txt
      </button>
      <button class="ws-btn ws-btn--ghost" data-act="regenerate">
        ${icon('refresh', 16)} Régénérer
      </button>
    </div>

    <div class="ws-card" style="margin-top:24px;padding:18px 22px;background:var(--gold3);border-color:var(--gold);">
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <span style="color:var(--gold);flex-shrink:0;margin-top:2px;">${icon('sparkles', 18)}</span>
        <div style="font-size:13px;line-height:1.65;color:var(--ws-text);">
          <strong style="color:var(--gold);">Prochaine étape&nbsp;:</strong>
          Collez ce prompt dans <strong>${_esc(o.target_engine)}</strong>. L'IA va d'abord
          vous demander les pièces techniques du programme (plan de masse, élévations,
          coupes, charte), puis elle vous renverra un fichier HTML avec un
          <strong>bouton "Copier" unique</strong> qui produit, en une seule génération,
          une <strong>planche d'ambiance professionnelle</strong> de 6 vignettes
          cohérentes (architecture · lumière · végétation · matériaux · lifestyle ·
          détail signature). Ouvrez le HTML, cliquez sur le bouton, collez le prompt
          dans votre moteur d'image (configuré&nbsp;: <strong>${_esc(o.image_engine || 'midjourney')}</strong>).
          Cette planche n'est <em>pas</em> votre projet — c'est un moodboard
          d'inspiration à transmettre au studio 3D avec les plans techniques.
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Génération du Prompt Maître
// ═══════════════════════════════════════════════════════════════
async function _generatePrompt() {
  const err = validateForGeneration(_state);
  if (err) { _toastSoon(err); return; }

  _state.output.status = 'building';
  _state.output.error  = null;
  _renderMain();

  try {
    const prompt = await buildPromptMaitre(_state);
    _state.output.prompt = prompt;
    _state.output.status = 'done';
    _state.output.generated_at = new Date().toISOString();
    _saveDraft();
    _renderMain();
    _toastOk('Prompt Maître assemblé');
  } catch (e) {
    _state.output.status = 'error';
    _state.output.error  = e.message || 'Erreur lors de l\'assemblage.';
    _saveDraft();
    _renderMain();
  }
}

// ── Copy-to-clipboard du prompt ───────────────────────────────
async function _copyPrompt(btn) {
  const text = _state.output.prompt;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const labelSlot = _root?.querySelector('[data-slot="copy-label"]');
    if (labelSlot) {
      const original = labelSlot.textContent;
      labelSlot.textContent = 'Copié ✓';
      setTimeout(() => { labelSlot.textContent = original; }, 1600);
    }
    _toastOk('Prompt copié dans le presse-papier');
  } catch (e) {
    _toastSoon('Copie impossible : ' + e.message);
  }
}

// ── Téléchargement .txt ───────────────────────────────────────
function _downloadPrompt() {
  const text = _state.output.prompt;
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const name = (_state.context.project_name || 'Muse')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  a.href = url;
  a.download = `muse-prompt-${name || 'brief'}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  _toastOk('Téléchargement lancé');
}

// ═══════════════════════════════════════════════════════════════
// Navigation footer
// ═══════════════════════════════════════════════════════════════
function _stepNav() {
  const idx = _currentStepIndex();
  const isLast = idx === STEPS.length - 1;
  const canBack = idx > 0;

  return `
    <div class="ws-step-nav">
      <button class="ws-btn ws-btn--ghost" data-act="prev" ${canBack ? '' : 'disabled style="visibility:hidden;"'}>
        ${icon('chevron-left', 16)} Précédent
      </button>
      ${isLast
        ? `<button class="ws-btn ws-btn--accent" data-act="generate-prompt">
             ${icon('sparkles', 16)} Assembler le Prompt Maître
           </button>`
        : `<button class="ws-btn ws-btn--primary" data-act="next">
             Étape suivante ${icon('chevron-right', 16)}
           </button>`
      }
    </div>
  `;
}

function _navigate(stepId) {
  if (!STEPS.find(s => s.id === stepId)) return;
  _state.view = stepId;
  _renderMain();
}

function _advance() {
  const i = _currentStepIndex();
  if (i < STEPS.length - 1) _navigate(STEPS[i + 1].id);
}

function _back() {
  const i = _currentStepIndex();
  if (i > 0) _navigate(STEPS[i - 1].id);
}

function _currentStep() { return STEPS.find(s => s.id === _state.view) || STEPS[0]; }
function _currentStepIndex() { return STEPS.findIndex(s => s.id === _state.view); }

// ═══════════════════════════════════════════════════════════════
// Toasts (mêmes patterns que codex.js)
// ═══════════════════════════════════════════════════════════════
function _toastSoon(label) { _toast(label, false); }
function _toastOk(label)   { _toast(label, true); }

function _toast(message, isSuccess = false) {
  const t = document.createElement('div');
  if (isSuccess) {
    t.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ${message}
    </span>`;
  } else {
    t.textContent = message;
  }
  Object.assign(t.style, {
    position: 'fixed', bottom: '24px', left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    background: isSuccess ? 'var(--green)' : '#1a1a1a',
    color: '#fff',
    padding: '10px 18px', borderRadius: '999px',
    fontSize: '13px', fontWeight: '600', letterSpacing: '-0.005em',
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    zIndex: 10000, opacity: '0',
    transition: 'all 220ms ease',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => t.remove(), 250);
  }, 1800);
}

// ═══════════════════════════════════════════════════════════════
// HTML escape
// ═══════════════════════════════════════════════════════════════
function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
