/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Annonces Immo (O-IMM-002) v2.0 — Workspace fullscreen
   Sprint Phase 3 / 2026-05-23 soir
   ─────────────────────────────────────────────────────────────
   Refonte UX suite à feedback Stéphane :
   - Le pad legacy utilisait le modal split 60/40 (formulaire à
     gauche, prompt généré à droite). Confusant maintenant qu'on
     a Ghost Writer inline (l'user attendait la "réponse" pas un
     prompt).
   - Les CTA "Bibliothèque" (interne, plus pertinente) et
     "Configurer une clé API" (obsolète depuis Workers AI free)
     étaient à retirer.
   - Cohérence avec les workspaces dédiés (Pulsa, Kodex, Muse,
     SDQR, VEFA Studio, Ghost Writer Studio) qui partagent un
     pattern .ws-app / .ws-topbar / .ws-body.

   Doctrine :
   - Pattern Keystone "prompt-to-copy" conservé. Le workspace
     interpole le system_prompt avec les valeurs du formulaire et
     copie dans le clipboard pour que l'user le colle dans son IA
     externe (ChatGPT recommandé, cf. ai_optimized: 'ChatGPT').
   - Ghost Writer inline (Workers AI / Gemma 4) reste branché sur
     le champ "atouts" via le bouton ✦ — c'est la seule génération
     automatique côté Workers Keystone.
   - Champs et system_prompt sont DUPLIQUÉS depuis pads-data.js
     (single source pour l'instant ; à factoriser quand on aura
     plusieurs workspaces du même genre).
   ═══════════════════════════════════════════════════════════════ */

import { helpButtonHTML, bindHelpButton }       from './lib/help-overlay.js';
import { ratingButtonHTML, bindRatingButton }    from './lib/rating-widget.js';
import { burgerHTML, bindBurger }                from './lib/topbar-burger.js';
import { icon }                                  from './lib/ui-icons.js';
import { openGhostwriterInline }                 from './lib/ghostwriter-inline.js';
import { CF_API }                                from './pads-loader.js';
import { refreshGhostwriterQuota,
         getGhostwriterQuotaRemaining,
         getGhostwriterQuotaMax,
         getGhostwriterPlan }                    from './ghostwriter.js';

const APP_ID    = 'O-IMM-002';
const DRAFT_KEY = 'ks_annonces_immo_draft_v1';
// Bibliothèque locale des générations (pattern Keystone, cf.
// ghostwriter-studio et pulsa). Stockée client-side, 50 entrées max.
const LIBRARY_KEY  = 'ks_annonces_immo_library';
const MAX_LIBRARY  = 50;
// Moteur recommandé pour ce pad (système prompt rédigé en convention
// ChatGPT — format de sortie markdown, balises HTML allégées tolérées).
const AI_RECOMMENDED = 'ChatGPT';

// Lit le moteur actif des Réglages (cf. ui-renderer LS_ENGINE).
// Fallback 'Claude' si jamais saisi. Source unique pour cohérence.
function _getActiveEngine() {
  try { return localStorage.getItem('ks_active_engine') || 'Claude'; }
  catch (_) { return 'Claude'; }
}

// ══════════════════════════════════════════════════════════════
// Schéma du formulaire (synchro avec pads-data.js / O-IMM-002)
// ══════════════════════════════════════════════════════════════

const FIELDS = [
  { id: 'nom_programme', label: 'Nom du programme',  type: 'text',   placeholder: 'ex : Résidence Azur', required: true, span: 'half' },
  { id: 'ville',         label: 'Ville / Quartier',  type: 'text',   placeholder: 'ex : Marseille 8ème', required: true, span: 'half' },
  { id: 'type_bien',     label: 'Type de bien',      type: 'select', options: ['Appartement T2','Appartement T3','Appartement T4','T5 et plus','Villa','Penthouse'], span: 'half' },
  { id: 'surface',       label: 'Surface (m²)',      type: 'number', placeholder: 'ex : 68', span: 'half' },
  { id: 'prix',          label: 'Prix (€)',          type: 'number', placeholder: 'ex : 245000', span: 'half' },
  { id: 'dispositif',    label: 'Dispositif fiscal', type: 'select', options: ['Aucun','Pinel','Pinel+','LMNP','Déficit foncier','Malraux'], span: 'half' },
  { id: 'ton_global',    label: 'Ton dominant souhaité', type: 'select', options: ['Équilibré (auto-adapté par portail)','Premium / Prestige','Investisseur / ROI','Lifestyle / Émotion','Familial / Primo-accédant'], span: 'full' },
  { id: 'portails',      label: 'Portails cibles', type: 'multiselect',
    options: ['SeLoger','LeBonCoin','Bien\'ici','Logic-Immo','Figaro Immo','Avendrealouer'],
    default: ['SeLoger','LeBonCoin','Bien\'ici'],
    required: true, span: 'full' },
  { id: 'atouts', label: 'Atouts & points forts', type: 'textarea',
    placeholder: 'Vue mer, terrasse, parking, livraison T4 2026...', span: 'full',
    ghostwriter: {
      label         : 'Rédiger les atouts avec l\'IA',
      mode          : 'marketing',
      audience      : 'client',
      action        : 'rewrite',
      tone          : 'persuasif vendeur',
      lengthTarget  : 'keep',
      context       : 'Atouts du bien',
      include_fields: ['nom_programme', 'ville', 'type_bien', 'surface', 'prix', 'dispositif'],
    },
  },
];

// System prompt original du pad (copywriter immo multi-portails).
// Interpolé avec {{var}} → valeurs du formulaire au moment du Copier.
const SYSTEM_PROMPT = `Tu es un copywriter expert en immobilier neuf, spécialisé en diffusion multi-portails. Rédige une annonce optimisée pour CHAQUE portail coché dans la liste, en respectant STRICTEMENT ses contraintes propres.

BIEN À DIFFUSER :
- Programme : {{nom_programme}} — {{ville}}
- Type : {{type_bien}} de {{surface}} m² — {{prix}} €
- Dispositif fiscal : {{dispositif}}
- Atouts : {{atouts}}
- Ton dominant souhaité : {{ton_global}}

PORTAILS CIBLES : {{portails}}

CONTRAINTES PAR PORTAIL — à respecter à la lettre :
| Portail        | Titre max | Description max | Ton                | Format       |
|----------------|-----------|------------------|---------------------|--------------|
| SeLoger        | 60 car.   | 4000 car.        | Pro/qualifié        | HTML allégé  |
| LeBonCoin      | 100 car.  | 5000 car.        | Populaire/direct    | Plain text   |
| Bien'ici       | 80 car.   | 3000 car.        | Vert/RE2020 mis en avant | Plain text |
| Logic-Immo     | 70 car.   | 4000 car.        | SEO (mots-clés répétés) | Plain text |
| Figaro Immo    | 60 car.   | 3500 car.        | Premium/luxe        | HTML allégé  |
| Avendrealouer  | 80 car.   | 4000 car.        | Neutre/factuel      | Plain text   |

INSTRUCTIONS :
- Ne génère QUE les blocs des portails effectivement cochés (ignore les autres).
- Si "Ton dominant" est "Équilibré", adapte naturellement le ton à chaque portail.
- Si un autre ton est précisé, garde la cohérence ce ton tout en respectant le format/contrainte du portail.
- Chaque description doit être autonome (lisible sans contexte externe) et inclure 1 call-to-action en fin.
- HTML allégé autorisé = balises <strong>, <em>, <br>, <ul><li> uniquement (jamais <div>, <span>, <style>).

FORMAT DE SORTIE — strictement ce gabarit en markdown :
## [Nom du portail]
**Titre** (X car.) : ...
**Description** (Y car.) :
...

Répète ce bloc pour chaque portail coché. Comptes les caractères réels dans les parenthèses.`;

// ══════════════════════════════════════════════════════════════
// État global
// ══════════════════════════════════════════════════════════════
let _root           = null;
let _formData       = {};
let _saveTimer      = null;
let _toastTimer     = null;
let _stylesInjected = false;

// ══════════════════════════════════════════════════════════════
// Persistance brouillon
// ══════════════════════════════════════════════════════════════

function _saveDraft() {
  _collectFormData();
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: _formData }));
    import('./vault.js').then(m => m.scheduleAutoSave?.()).catch(() => {});
  } catch (_) {}
}

function _scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveDraft, 600);
}

// ── Bibliothèque locale (50 dernières générations) ──────────────
// Pattern identique à ghostwriter-studio / pulsa : stockage local
// (pas Cloud Vault), lecture lazy au render du panneau, écriture
// unshift + slice MAX_LIBRARY pour rotation FIFO.

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

// Construit un titre court lisible à partir des champs du formulaire.
// Ex: "Résidence Belle Vue · T3 78m² · Marseille 8ème"
function _autoTitle(snapshot) {
  const parts = [];
  if (snapshot?.nom_programme) parts.push(snapshot.nom_programme);
  const typeBien = (snapshot?.type_bien || '').replace('Appartement ', '');
  const surface  = snapshot?.surface ? `${snapshot.surface}m²` : '';
  const typeTxt  = [typeBien, surface].filter(Boolean).join(' ');
  if (typeTxt) parts.push(typeTxt);
  if (snapshot?.ville) parts.push(snapshot.ville);
  return parts.join(' · ') || 'Annonces sans titre';
}

function _loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      _formData = saved.data || {};
      return true;
    }
  } catch (_) {}
  // Pré-remplit les défauts du schéma (cas portails)
  for (const f of FIELDS) {
    if (f.default != null && _formData[f.id] == null) {
      _formData[f.id] = Array.isArray(f.default) ? f.default.join(', ') : f.default;
    }
  }
  return false;
}

// ══════════════════════════════════════════════════════════════
// API publique
// ══════════════════════════════════════════════════════════════

export function openAnnoncesImmo() {
  if (_root) return;
  _injectStyles();
  _loadDraft();
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';
}

export function closeAnnoncesImmo() {
  if (!_root) return;
  _saveDraft();
  document.removeEventListener('keydown', _handleKeyDown);
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════════════
// Shell
// ══════════════════════════════════════════════════════════════

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
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour au Dashboard">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('multiportails', 24)}</span>
        <span class="name">Annonces Immo</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(APP_ID)}
        ${ratingButtonHTML(APP_ID)}
        <button class="ws-iconbtn" data-act="library"
                title="Bibliothèque (${_loadLibrary().length} sauvegardes)"
                aria-label="Ouvrir la bibliothèque">
          ${icon('book-open', 18)}
        </button>
        <button class="ws-iconbtn" data-act="reset" title="Effacer et recommencer" aria-label="Réinitialiser">
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

// ══════════════════════════════════════════════════════════════
// Rendu
// ══════════════════════════════════════════════════════════════

function _renderMain() {
  const main = _root && _root.querySelector('[data-slot="main"]');
  if (!main) return;

  // Sections logiques pour clarifier l'UX (vs un dump des 9 champs).
  const SECTION_BIEN     = ['nom_programme', 'ville', 'type_bien', 'surface', 'prix', 'dispositif'];
  const SECTION_ANGLE    = ['ton_global'];
  const SECTION_CIBLES   = ['portails'];
  const SECTION_ATOUTS   = ['atouts'];

  const renderSection = (ids) => ids
    .map(id => FIELDS.find(f => f.id === id))
    .filter(Boolean)
    .map(_renderField)
    .join('');

  main.innerHTML = `
    <div class="ws-main-inner ai-wrap">
      <div class="ai-hero">
        <div class="ai-hero-eyebrow">
          ${icon('multiportails', 13)}&nbsp;O-IMM-002 — SeLoger · LeBonCoin · Bien'ici · Logic-Immo · Figaro Immo · Avendrealouer
        </div>
        <h1 class="ai-hero-title">Annonces Immo</h1>
        <p class="ai-hero-subtitle">Une saisie, un prompt prêt à coller dans ChatGPT pour générer une annonce par portail respectant ses contraintes propres.</p>
      </div>

      <form class="ai-form" autocomplete="off" novalidate>

        <section class="ai-section">
          <div class="ai-section-head">
            <div class="ai-section-title">Le bien</div>
            <div class="ai-section-subtitle">Caractéristiques essentielles</div>
          </div>
          <div class="ai-fields">${renderSection(SECTION_BIEN)}</div>
        </section>

        <section class="ai-section">
          <div class="ai-section-head">
            <div class="ai-section-title">Angle commercial</div>
            <div class="ai-section-subtitle">Le ton sera décliné par portail si vous laissez "Équilibré"</div>
          </div>
          <div class="ai-fields">${renderSection(SECTION_ANGLE)}</div>
        </section>

        <section class="ai-section">
          <div class="ai-section-head">
            <div class="ai-section-title">Portails de diffusion</div>
            <div class="ai-section-subtitle">Le prompt à copier ne générera QUE les annonces des portails cochés (Ghost Writer "Atouts" est indépendant de ce choix).</div>
          </div>
          <div class="ai-fields">${renderSection(SECTION_CIBLES)}</div>
        </section>

        <section class="ai-section">
          <div class="ai-section-head">
            <div class="ai-section-title">Atouts & points forts</div>
            <div class="ai-section-subtitle">Saisissez vous-même ou demandez à Ghost Writer de rédiger depuis les infos du bien ci-dessus (gratuit, dans la fenêtre).</div>
          </div>
          <div class="ai-fields">${renderSection(SECTION_ATOUTS)}</div>
        </section>

        <div class="ai-actions">
          <button class="ai-btn-primary" data-act="generate-here" type="button"
                  title="Génère les annonces directement dans Keystone avec Gemma 4 (gratuit, dans la fenêtre)">
            ${icon('sparkles', 18)}&nbsp;Générer les annonces ici
          </button>
          <button class="ai-btn-secondary" data-act="copy-prompt" type="button"
                  title="Copier le prompt pour le coller dans ChatGPT ou Claude (votre abonnement)">
            ${icon('copy', 16)}&nbsp;Copier le prompt
          </button>
          <button class="ai-btn-link" data-act="show-prompt" type="button" title="Voir le prompt avant de le coller">
            Aperçu
          </button>
          <span class="ai-engine-chip" title="Moteur recommandé pour ce pad vs moteur sélectionné dans vos Réglages">
            ${_renderEngineChip()}
          </span>
        </div>

        <!-- Panneau résultat (rempli par _handleGenerateHere) -->
        <div data-slot="result" class="ai-result-slot"></div>
      </form>
    </div>
  `;

  _restoreFormData();
  _wireGhostwriterButtons();
}

function _renderEngineChip() {
  const active = _getActiveEngine();
  if (active === AI_RECOMMENDED) {
    // Cas optimal : moteur actif = recommandé.
    return `<span class="ai-engine-ok">✓ Optimisé pour ${_esc(AI_RECOMMENDED)}</span>`;
  }
  // Cas mismatch : on informe sans bloquer (le prompt marchera quand
  // même mais ChatGPT respecte mieux le format markdown demandé).
  return `<span class="ai-engine-mismatch">
    Optimisé pour ${_esc(AI_RECOMMENDED)} · vous utilisez <strong>${_esc(active)}</strong>
  </span>`;
}

function _renderField(field) {
  const spanCls = field.span === 'full' ? ' ai-field-full' : ' ai-field-half';
  const req     = field.required ? ' <span class="ai-req">*</span>' : '';
  const rawVal  = String(_formData[field.id] != null ? _formData[field.id] : '');
  const val     = _esc(rawVal);

  let input = '';

  if (field.type === 'textarea') {
    input = `<textarea class="ws-input ws-textarea"
        name="${_esc(field.id)}" data-field="${_esc(field.id)}"
        id="f-${_esc(field.id)}"
        placeholder="${_esc(field.placeholder || '')}"
        rows="4">${val}</textarea>`;

  } else if (field.type === 'select') {
    const opts = (field.options || []).map(o => {
      const ov = _esc(o);
      return `<option value="${ov}"${rawVal === o ? ' selected' : ''}>${ov}</option>`;
    }).join('');
    input = `<select class="ws-input ws-select" name="${_esc(field.id)}" data-field="${_esc(field.id)}" id="f-${_esc(field.id)}">
      <option value="">— choisir —</option>
      ${opts}
    </select>`;

  } else if (field.type === 'multiselect') {
    const current = rawVal.split(',').map(s => s.trim()).filter(Boolean);
    const checkboxes = (field.options || []).map(o => {
      const ov = _esc(o);
      const checked = current.includes(o) ? ' checked' : '';
      return `<label class="ai-checkbox">
        <input type="checkbox" value="${ov}"${checked}> <span>${ov}</span>
      </label>`;
    }).join('');
    input = `<div class="ai-multiselect" data-field="${_esc(field.id)}" id="f-${_esc(field.id)}">
      ${checkboxes}
      <input type="hidden" name="${_esc(field.id)}" value="${val}">
    </div>`;

  } else {
    const typeAttr = field.type === 'number' ? 'number' : 'text';
    input = `<input class="ws-input" type="${typeAttr}"
        name="${_esc(field.id)}" data-field="${_esc(field.id)}"
        id="f-${_esc(field.id)}"
        placeholder="${_esc(field.placeholder || '')}"
        value="${val}"${field.required ? ' required' : ''}>`;
  }

  // Bouton ✦ Ghost Writer si le champ déclare ghostwriter
  const gwBtn = field.ghostwriter ? `
    <div class="gw-assist-wrap">
      <button type="button" class="gw-assist-btn"
              data-act="ghostwriter" data-field-id="${_esc(field.id)}"
              aria-label="Réécrire avec Ghost Writer">
        <span class="gw-assist-icon">✦</span>
        <span class="gw-assist-label">${_esc(field.ghostwriter.label || 'Réécrire en 3 variantes')}</span>
      </button>
    </div>` : '';

  return `
    <div class="ai-field${spanCls}">
      <label class="ai-label" for="f-${_esc(field.id)}">${_esc(field.label)}${req}</label>
      ${input}
      ${gwBtn}
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// Wiring formulaire + Ghost Writer
// ══════════════════════════════════════════════════════════════

function _restoreFormData() {
  // Re-injection des valeurs sauvegardées dans les champs après render.
  // Particulier pour multiselect : décocher/cocher manuellement.
  const form = _root?.querySelector('.ai-form');
  if (!form) return;
  for (const f of FIELDS) {
    const val = _formData[f.id];
    if (f.type === 'multiselect') {
      const current = String(val || '').split(',').map(s => s.trim()).filter(Boolean);
      form.querySelectorAll(`[data-field="${f.id}"] input[type="checkbox"]`)
        .forEach(cb => { cb.checked = current.includes(cb.value); });
    }
  }
}

function _collectFormData() {
  const form = _root?.querySelector('.ai-form');
  if (!form) return;
  for (const f of FIELDS) {
    if (f.type === 'multiselect') {
      const wrap = form.querySelector(`[data-field="${f.id}"]`);
      const vals = [...(wrap?.querySelectorAll('input[type="checkbox"]:checked') || [])].map(c => c.value);
      _formData[f.id] = vals.join(', ');
    } else {
      const el = form.querySelector(`[data-field="${f.id}"]`);
      if (el) _formData[f.id] = el.value;
    }
  }
}

function _onInput(e) {
  const el = e.target;
  if (!el) return;
  // Multiselect : mettre à jour le hidden et le formData
  const multiWrap = el.closest?.('.ai-multiselect');
  if (multiWrap && el.type === 'checkbox') {
    const checked = [...multiWrap.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value);
    const csv = checked.join(', ');
    multiWrap.querySelector('input[type="hidden"]').value = csv;
    _formData[multiWrap.dataset.field] = csv;
    _scheduleSave();
    return;
  }
  // Champs standards
  const fieldId = el.dataset?.field || el.name;
  if (!fieldId) return;
  _formData[fieldId] = el.value;
  _scheduleSave();
}

function _onClick(e) {
  const target = e.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;

  if (act === 'close') {
    closeAnnoncesImmo();
    return;
  }
  if (act === 'reset') {
    if (confirm('Effacer toutes les saisies ? Cette action est définitive.')) {
      _formData = {};
      try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
      _loadDraft();   // re-applique les défauts (portails)
      _renderMain();
      _toast('Formulaire réinitialisé');
    }
    return;
  }
  if (act === 'copy-prompt')   return _handleCopyPrompt();
  if (act === 'show-prompt')   return _handleShowPrompt();
  if (act === 'generate-here') return _handleGenerateHere();
  if (act === 'close-result')  return _closeResult();
  if (act === 'copy-result')   return _copyResult();
  if (act === 'regen-result')  return _handleGenerateHere();   // re-run même flow
  if (act === 'save-result')   return _saveCurrentToLibrary();
  if (act === 'ghostwriter')   return _handleGhostwriter(target.dataset.fieldId);
  if (act === 'library')       return _openLibrary();
  if (act === 'lib-close')     return _closeLibrary();
  if (act === 'lib-copy')      return _libCopy(target.dataset.uid);
  if (act === 'lib-load')      return _libLoad(target.dataset.uid);
  if (act === 'lib-delete')    return _libDelete(target.dataset.uid, target);
}

// Wire les boutons ✦ Ghost Writer après le render. La logique
// d'ouverture du panneau inline est dans lib/ghostwriter-inline.js.
function _wireGhostwriterButtons() {
  // Rien à faire ici — délégué via _onClick (data-act="ghostwriter")
}

function _handleGhostwriter(fieldId) {
  const field = FIELDS.find(f => f.id === fieldId);
  if (!field?.ghostwriter) return;

  const targetEl = _root?.querySelector(`#f-${fieldId}`);

  // Pad-Aware — collecte les autres champs déclarés dans include_fields
  // pour que Ghost Writer ait le contexte du bien (Pad-Aware retour
  // Stéphane 2026-05-23 : cumul texte saisi + contexte formulaire).
  let formContext = null;
  const include = field.ghostwriter.include_fields;
  if (Array.isArray(include) && include.length > 0) {
    formContext = {};
    for (const fid of include) {
      const def = FIELDS.find(f => f.id === fid);
      const el  = _root?.querySelector(`#f-${fid}`);
      const val = (el?.value || '').trim();
      if (val) formContext[fid] = { label: def?.label || fid, value: val };
    }
    if (Object.keys(formContext).length === 0) formContext = null;
  }

  openGhostwriterInline(targetEl, {
    ...field.ghostwriter,
    context: field.ghostwriter.context || field.label,
    formContext,
  });
}

// ══════════════════════════════════════════════════════════════
// Génération prompt
// ══════════════════════════════════════════════════════════════

function _interpolate(template, data) {
  // Remplace {{var}} par data[var] (string vide si absent)
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data[key];
    return v != null ? String(v) : '';
  });
}

function _validateRequired() {
  const required = FIELDS.filter(f => f.required);
  return required.filter(f => {
    const v = _formData[f.id];
    return v == null || String(v).trim() === '';
  });
}

function _buildPrompt() {
  _collectFormData();
  return _interpolate(SYSTEM_PROMPT, _formData);
}

function _handleCopyPrompt() {
  const missing = _validateRequired();
  if (missing.length > 0) {
    _toast(`Champs requis manquants : ${missing.map(f => f.label).join(', ')}`, true);
    _highlightMissing(missing);
    return;
  }
  const prompt = _buildPrompt();
  navigator.clipboard?.writeText(prompt)
    .then(() => _toast('✓ Prompt copié — collez-le dans ChatGPT'))
    .catch(() => _toast('Impossible d\'accéder au presse-papier', true));
}

function _handleShowPrompt() {
  const prompt = _buildPrompt();
  // Panel slide-over léger
  const old = _root?.querySelector('.ai-prompt-preview');
  if (old) { old.remove(); return; }   // toggle

  const overlay = document.createElement('div');
  overlay.className = 'ai-prompt-preview';
  overlay.innerHTML = `
    <div class="ai-prompt-preview-card">
      <div class="ai-prompt-head">
        <span class="ai-prompt-title">Aperçu du prompt</span>
        <button class="ai-prompt-close" type="button" aria-label="Fermer">×</button>
      </div>
      <pre class="ai-prompt-body">${_esc(prompt)}</pre>
      <div class="ai-prompt-actions">
        <button class="ai-btn-primary" data-act="copy-prompt" type="button">
          ${icon('file-text', 16)}&nbsp;Copier
        </button>
      </div>
    </div>
  `;
  _root?.appendChild(overlay);
  overlay.querySelector('.ai-prompt-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ══════════════════════════════════════════════════════════════
// Génération directe via Gemma 4 (Phase 3 — Annonces in-app)
// ══════════════════════════════════════════════════════════════

// Mémorise le dernier résultat pour copier sans re-fetch
let _lastGeneratedText = '';

async function _handleGenerateHere() {
  const missing = _validateRequired();
  if (missing.length > 0) {
    _toast(`Champs requis manquants : ${missing.map(f => f.label).join(', ')}`, true);
    _highlightMissing(missing);
    return;
  }

  _collectFormData();

  // Le system_prompt est utilisé tel quel (Gemma sait suivre des
  // instructions structurées avec contraintes par portail).
  // userPrompt = juste un déclencheur factuel : Gemma a déjà tout
  // dans le system_prompt après interpolation.
  const interpolated = _interpolate(SYSTEM_PROMPT, _formData);
  const userPrompt   = `Génère maintenant toutes les annonces selon les instructions ci-dessus, pour les portails suivants : ${_formData.portails || ''}.`;

  _openResultPanel('loading');

  try {
    const jwt = (() => { try { return localStorage.getItem('ks_jwt'); } catch (_) { return null; }})();
    if (!jwt) {
      _openResultPanel('error', 'Aucune session active. Reconnectez-vous (Paramètres → Déconnexion complète).');
      return;
    }

    const res = await fetch(`${CF_API}/api/ai/generate`, {
      method: 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        systemPrompt   : interpolated,
        userPrompt     : userPrompt,
        maxOutputTokens: 16384,   // sortie longue : 6 portails × ~3000 car possibles
      }),
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        msg = errBody.error || errBody.message || msg;
      } catch (_) {}
      _openResultPanel('error', msg);
      return;
    }

    const payload = await res.json();
    _lastGeneratedText = String(payload?.text || '').trim();
    if (!_lastGeneratedText) {
      _openResultPanel('error', 'Réponse Gemma 4 vide. Réessayez.');
      return;
    }
    // Refresh le quota cache pour le chip GW (cohérence)
    refreshGhostwriterQuota().catch(() => {});
    _openResultPanel('success', _lastGeneratedText);

  } catch (e) {
    _openResultPanel('error', `Erreur réseau : ${e?.message || 'inconnue'}`);
  }
}

function _openResultPanel(state, content) {
  const slot = _root?.querySelector('[data-slot="result"]');
  if (!slot) return;

  if (state === 'loading') {
    slot.innerHTML = `
      <div class="ai-result-panel ai-result-loading">
        <div class="ai-result-spinner"></div>
        <span>Génération en cours — Gemma 4 (cela peut prendre 15-30 secondes pour 3-6 portails)…</span>
      </div>
    `;
    slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (state === 'error') {
    slot.innerHTML = `
      <div class="ai-result-panel ai-result-error">
        <div class="ai-result-head">
          <strong>✗ Génération échouée</strong>
          <button type="button" class="ai-result-close" data-act="close-result" aria-label="Fermer">×</button>
        </div>
        <p class="ai-result-error-msg">${_esc(content || '')}</p>
        <p class="ai-result-error-fallback">Astuce : utilisez plutôt "Copier le prompt" et collez-le dans votre ChatGPT/Claude.</p>
      </div>
    `;
    return;
  }

  // success
  slot.innerHTML = `
    <div class="ai-result-panel ai-result-success">
      <div class="ai-result-head">
        <strong>✓ Annonces générées</strong>
        <span class="ai-result-meta">Gemma 4 · Vérifiez les comptes de caractères par portail avant publication</span>
        <button type="button" class="ai-result-close" data-act="close-result" aria-label="Fermer">×</button>
      </div>
      <pre class="ai-result-body">${_esc(content)}</pre>
      <div class="ai-result-actions">
        <button type="button" class="ai-btn-primary" data-act="copy-result">
          ${icon('copy', 16)}&nbsp;Copier tout
        </button>
        <button type="button" class="ai-btn-secondary" data-act="save-result"
                title="Ajouter ces annonces à la Bibliothèque (accessible depuis l'icône 📖 en haut)">
          ${icon('save', 16)}&nbsp;Sauvegarder
        </button>
        <button type="button" class="ai-btn-secondary" data-act="regen-result">
          ↻&nbsp;Régénérer
        </button>
      </div>
    </div>
  `;
  slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _closeResult() {
  const slot = _root?.querySelector('[data-slot="result"]');
  if (slot) slot.innerHTML = '';
  _lastGeneratedText = '';
}

function _copyResult() {
  if (!_lastGeneratedText) return;
  navigator.clipboard?.writeText(_lastGeneratedText)
    .then(() => _toast('✓ Annonces copiées dans le presse-papier'))
    .catch(() => _toast('Impossible d\'accéder au presse-papier', true));
}

// ══════════════════════════════════════════════════════════════
// Bibliothèque — sauvegarde / panneau slide-over / actions
// ══════════════════════════════════════════════════════════════

function _saveCurrentToLibrary() {
  if (!_lastGeneratedText) {
    _toast('Rien à sauvegarder (générez d\'abord des annonces)', true);
    return;
  }
  _collectFormData();
  const snapshot = { ..._formData };
  const entry = {
    uid     : 'ai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date    : Date.now(),
    title   : _autoTitle(snapshot),
    portails: snapshot.portails || '',
    formData: snapshot,
    text    : _lastGeneratedText,
  };
  _addToLibrary(entry);
  _toast('✓ Annonces sauvegardées dans la Bibliothèque');
  _refreshLibraryButtonCount();
}

function _refreshLibraryButtonCount() {
  const btn = _root?.querySelector('[data-act="library"]');
  if (!btn) return;
  const n = _loadLibrary().length;
  btn.setAttribute('title', `Bibliothèque (${n} sauvegarde${n > 1 ? 's' : ''})`);
}

function _openLibrary() {
  if (!_root || _root.querySelector('[data-slot="lib-overlay"]')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = _renderLibraryPanel();
  _root.appendChild(wrap.firstElementChild);
  requestAnimationFrame(() => {
    const ov = _root.querySelector('[data-slot="lib-overlay"]');
    if (ov) ov.classList.add('ai-lib-on');
  });
}

function _closeLibrary() {
  const ov = _root?.querySelector('[data-slot="lib-overlay"]');
  if (!ov) return;
  ov.classList.remove('ai-lib-on');
  setTimeout(() => ov.remove(), 200);
}

function _renderLibraryPanel() {
  const items = _loadLibrary();
  const list = items.length === 0
    ? `<div class="ai-lib-empty">
         Aucune sauvegarde pour l'instant.<br>
         <span style="opacity:.7">Générez des annonces puis cliquez sur "Sauvegarder" dans le panneau résultat.</span>
       </div>`
    : items.map(it => `
        <div class="ai-lib-item" data-uid="${_esc(it.uid)}">
          <div class="ai-lib-head">
            <div class="ai-lib-title">${_esc(it.title || 'Sans titre')}</div>
            <div class="ai-lib-meta">${_esc(it.portails || '—')} · ${_fmtDate(it.date)}</div>
          </div>
          <div class="ai-lib-preview">${_esc((it.text || '').slice(0, 220))}${(it.text || '').length > 220 ? '…' : ''}</div>
          <div class="ai-lib-actions">
            <button type="button" class="ai-lib-mini" data-act="lib-copy"   data-uid="${_esc(it.uid)}">Copier</button>
            <button type="button" class="ai-lib-mini" data-act="lib-load"   data-uid="${_esc(it.uid)}">Recharger</button>
            <button type="button" class="ai-lib-mini ai-lib-mini--danger" data-act="lib-delete" data-uid="${_esc(it.uid)}">Supprimer</button>
          </div>
        </div>
      `).join('');

  return `
    <div class="ai-lib-overlay" data-slot="lib-overlay">
      <div class="ai-lib-backdrop" data-act="lib-close"></div>
      <aside class="ai-lib-panel" role="dialog" aria-label="Bibliothèque Annonces Immo">
        <header class="ai-lib-header">
          <div class="ai-lib-title-main">
            Bibliothèque <span class="ai-lib-count">${items.length}/${MAX_LIBRARY}</span>
          </div>
          <button type="button" class="ws-iconbtn" data-act="lib-close" aria-label="Fermer">×</button>
        </header>
        <div class="ai-lib-list">${list}</div>
      </aside>
    </div>
  `;
}

function _libCopy(uid) {
  const it = _loadLibrary().find(x => x.uid === uid);
  if (!it?.text) return;
  navigator.clipboard?.writeText(it.text)
    .then(() => _toast('✓ Annonces copiées'))
    .catch(() => _toast('Impossible d\'accéder au presse-papier', true));
}

function _libLoad(uid) {
  const it = _loadLibrary().find(x => x.uid === uid);
  if (!it) return;
  // Restore le formulaire + le texte généré
  _formData = { ...(it.formData || {}) };
  _lastGeneratedText = it.text || '';
  _saveDraft();
  _closeLibrary();
  _renderMain();
  if (_lastGeneratedText) {
    _openResultPanel('success', _lastGeneratedText);
  }
  _toast('Sauvegarde rechargée');
}

function _libDelete(uid, btn) {
  // Confirmation inline : 1er clic transforme en "Confirmer ?",
  // 2e clic supprime. Évite un confirm() bloquant qui sort du flow.
  if (btn?.dataset?.confirm === '1') {
    _deleteFromLibrary(uid);
    const item = _root?.querySelector(`.ai-lib-item[data-uid="${CSS.escape(uid)}"]`);
    if (item) item.remove();
    _refreshLibraryButtonCount();
    // Si plus rien → re-render le panneau (état vide)
    if (_loadLibrary().length === 0) {
      _closeLibrary();
      setTimeout(_openLibrary, 220);
    }
    return;
  }
  btn.dataset.confirm = '1';
  const orig = btn.textContent;
  btn.textContent = 'Confirmer ?';
  setTimeout(() => {
    if (btn?.dataset?.confirm === '1') {
      btn.dataset.confirm = '';
      btn.textContent = orig;
    }
  }, 3000);
}

function _fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const ymd = new Date(d); ymd.setHours(0,0,0,0);
  const sameDay = ymd.getTime() === today.getTime();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Aujourd'hui ${time}`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' + time;
}

function _highlightMissing(missing) {
  const form = _root?.querySelector('.ai-form');
  if (!form) return;
  missing.forEach(f => {
    const el = form.querySelector(`[data-field="${f.id}"]`);
    if (el) el.classList.add('ai-field-error');
  });
  setTimeout(() => {
    form.querySelectorAll('.ai-field-error').forEach(el => el.classList.remove('ai-field-error'));
  }, 3000);
}

// ══════════════════════════════════════════════════════════════
// Raccourcis clavier
// ══════════════════════════════════════════════════════════════

function _handleKeyDown(e) {
  if (!_root) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (e.key === 'Escape') {
    // Cascade : library > preview prompt > panneau résultat > panneau GW inline > workspace
    const lib = _root.querySelector('[data-slot="lib-overlay"]');
    if (lib) { _closeLibrary(); return; }
    const preview = _root.querySelector('.ai-prompt-preview');
    if (preview) { preview.remove(); return; }
    const result = _root.querySelector('.ai-result-panel');
    if (result) { _closeResult(); return; }
    const gwPanel = _root.querySelector('.gw-inline');
    if (gwPanel) { gwPanel.remove(); return; }
    closeAnnoncesImmo();
    return;
  }
  // Cmd/Ctrl + C avec aucun textarea actif → copy prompt
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter'
      && tag !== 'TEXTAREA' && tag !== 'INPUT') {
    e.preventDefault();
    _handleCopyPrompt();
  }
}

// ══════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════

function _toast(msg, isError) {
  if (!_root) return;
  let toast = _root.querySelector('.ai-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'ai-toast';
    _root.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'ai-toast' + (isError ? ' ai-toast--error' : '') + ' is-visible';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { if (toast) toast.classList.remove('is-visible'); }, 3000);
}

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════
// CSS scoped .ai-*
// ══════════════════════════════════════════════════════════════

function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const css = `
.ai-wrap { padding: 24px clamp(20px, 4vw, 48px); max-width: 1100px; margin: 0 auto; }

.ai-hero { margin-bottom: 28px; }
.ai-hero-eyebrow {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.08em;
  font-weight: 600;
  color: rgba(160, 165, 200, 0.85);
  padding: 6px 12px; border-radius: 100px;
  background: rgba(120, 160, 255, 0.07);
  border: 1px solid rgba(120, 160, 255, 0.18);
  margin-bottom: 14px;
}
.ai-hero-title {
  font-size: clamp(28px, 4vw, 38px);
  font-weight: 900; letter-spacing: -0.02em;
  margin: 0 0 8px 0;
  color: var(--text-primary, #fff);
}
.ai-hero-subtitle {
  font-size: 14px; line-height: 1.55;
  color: var(--text-muted, #999);
  margin: 0; max-width: 720px;
}

.ai-form { display: flex; flex-direction: column; gap: 24px; }
.ai-section {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  padding: 20px 22px;
}
.ai-section-head { margin-bottom: 14px; }
.ai-section-title {
  font-size: 15px; font-weight: 700; letter-spacing: -0.01em;
  color: var(--text-primary, #fff);
}
.ai-section-subtitle {
  font-size: 12px; color: var(--text-muted, #888);
  margin-top: 2px;
}
.ai-fields {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 16px;
}
.ai-field-half { grid-column: span 1; }
.ai-field-full { grid-column: 1 / -1; }
@media (max-width: 640px) {
  .ai-fields { grid-template-columns: 1fr; }
  .ai-field-half { grid-column: 1 / -1; }
}
.ai-field { display: flex; flex-direction: column; gap: 5px; }
.ai-label {
  font-size: 12.5px; font-weight: 500; color: var(--text-primary, #ddd);
}
.ai-req { color: rgba(255, 130, 130, 0.9); margin-left: 2px; }
.ai-field-error .ws-input,
.ai-field-error.ai-multiselect {
  border-color: rgba(255, 90, 90, 0.6) !important;
  background: rgba(255, 90, 90, 0.08) !important;
}

.ai-multiselect {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
}
.ai-checkbox {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 100px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12.5px; color: var(--text-primary, #ddd);
  cursor: pointer; user-select: none;
  transition: all 0.15s ease;
}
.ai-checkbox input[type="checkbox"] { accent-color: rgba(120, 160, 255, 0.9); cursor: pointer; }
.ai-checkbox:has(input:checked) {
  background: rgba(120, 160, 255, 0.16);
  border-color: rgba(120, 160, 255, 0.45);
  color: #fff;
}
.ai-checkbox:hover:not(:has(input:checked)) { background: rgba(255, 255, 255, 0.07); }

.ai-actions {
  display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
  padding-top: 8px;
}
.ai-btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 22px;
  background: linear-gradient(135deg, #6496ff, #8060ff);
  border: 0; border-radius: 10px;
  color: white;
  font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}
.ai-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(100, 130, 255, 0.3);
}
.ai-btn-primary:active { transform: translateY(0); }
.ai-btn-secondary {
  padding: 11px 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: var(--text-primary, #ddd);
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.ai-btn-secondary:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.18); }
.ai-btn-link {
  padding: 11px 14px;
  background: transparent;
  border: 0;
  color: var(--text-muted, #888);
  font-size: 12.5px; font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease;
  font-family: inherit;
  text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px;
}
.ai-btn-link:hover { color: var(--text-primary, #ddd); text-decoration-color: currentColor; }

/* ── Panneau résultat (génération Gemma 4 inline) ──────────────── */
.ai-result-slot { margin-top: 16px; }
.ai-result-panel {
  border-radius: 14px;
  padding: 18px 20px;
  border: 1px solid rgba(120, 160, 255, 0.25);
  background: linear-gradient(135deg, rgba(100, 150, 255, 0.05), rgba(128, 96, 255, 0.04));
  display: flex; flex-direction: column; gap: 12px;
}
.ai-result-loading {
  flex-direction: row; align-items: center; gap: 12px;
  color: rgba(200, 210, 240, 0.9); font-size: 13px;
}
.ai-result-spinner {
  width: 18px; height: 18px;
  border: 2.5px solid rgba(120, 160, 255, 0.25);
  border-top-color: rgba(180, 200, 255, 0.95);
  border-radius: 50%;
  animation: ai-spin 0.8s linear infinite;
}
@keyframes ai-spin { to { transform: rotate(360deg); } }

.ai-result-head {
  display: flex; align-items: center; gap: 10px;
  font-size: 13.5px; color: var(--text-primary, #fff);
}
.ai-result-meta {
  font-size: 11.5px; color: var(--text-muted, #888); font-weight: normal;
  margin-left: 8px; flex: 1;
}
.ai-result-close {
  background: transparent; border: 0; color: var(--text-muted, #888);
  font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 8px; border-radius: 6px;
}
.ai-result-close:hover { color: #fff; background: rgba(255, 255, 255, 0.06); }

.ai-result-body {
  margin: 0; padding: 16px 18px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  color: rgba(230, 230, 240, 0.96);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12.5px; line-height: 1.6;
  white-space: pre-wrap; word-wrap: break-word;
  max-height: 60vh; overflow-y: auto;
}

.ai-result-actions { display: flex; gap: 10px; flex-wrap: wrap; }

.ai-result-error {
  border-color: rgba(255, 90, 90, 0.4);
  background: rgba(255, 90, 90, 0.06);
}
.ai-result-error-msg {
  margin: 0; padding: 10px 14px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  color: rgba(255, 180, 180, 0.95); font-size: 12.5px; line-height: 1.5;
}
.ai-result-error-fallback {
  margin: 0; padding: 0 4px;
  color: var(--text-muted, #888); font-size: 11.5px;
}

html.light-mode .ai-result-panel { background: linear-gradient(135deg, rgba(80, 110, 230, 0.04), rgba(120, 90, 230, 0.04)); }
html.light-mode .ai-result-body { background: rgba(0, 0, 0, 0.04); color: rgba(30, 30, 50, 0.92); }
html.light-mode .ai-btn-link { color: rgba(80, 90, 130, 0.85); }

/* ── Bibliothèque (panneau slide-over) ─────────────────────────── */
.ai-lib-overlay {
  position: fixed; inset: 0; z-index: 9100;
  opacity: 0; pointer-events: none;
  transition: opacity 0.2s ease;
}
.ai-lib-overlay.ai-lib-on { opacity: 1; pointer-events: auto; }
.ai-lib-backdrop {
  position: absolute; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.ai-lib-panel {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: min(480px, 100%);
  background: var(--bg-secondary, #16161a);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  display: flex; flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: -16px 0 48px rgba(0, 0, 0, 0.4);
}
.ai-lib-overlay.ai-lib-on .ai-lib-panel { transform: translateX(0); }

.ai-lib-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.ai-lib-title-main {
  font-size: 16px; font-weight: 700; letter-spacing: -0.01em;
  color: var(--text-primary, #fff);
  display: inline-flex; align-items: center; gap: 8px;
}
.ai-lib-count {
  font-size: 11.5px; font-weight: 500;
  color: var(--text-muted, #888);
  padding: 2px 9px; border-radius: 100px;
  background: rgba(255, 255, 255, 0.05);
}

.ai-lib-list {
  flex: 1; overflow-y: auto;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.ai-lib-empty {
  padding: 40px 24px;
  text-align: center;
  color: var(--text-muted, #888);
  font-size: 13px; line-height: 1.6;
}

.ai-lib-item {
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ai-lib-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(120, 160, 255, 0.3);
}
.ai-lib-head {
  display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
  margin-bottom: 6px; flex-wrap: wrap;
}
.ai-lib-title {
  font-size: 13.5px; font-weight: 600;
  color: var(--text-primary, #fff);
}
.ai-lib-meta {
  font-size: 11px; color: var(--text-muted, #888);
}
.ai-lib-preview {
  font-size: 12px; line-height: 1.5;
  color: rgba(200, 200, 215, 0.85);
  margin-bottom: 10px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.ai-lib-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.ai-lib-mini {
  padding: 5px 11px; border-radius: 7px;
  font-size: 11.5px; font-weight: 500; cursor: pointer;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(220, 220, 230, 0.9);
  transition: all 0.15s ease;
  font-family: inherit;
}
.ai-lib-mini:hover {
  background: rgba(120, 160, 255, 0.14);
  border-color: rgba(120, 160, 255, 0.35);
  color: #fff;
}
.ai-lib-mini--danger {
  background: rgba(255, 90, 90, 0.06);
  border-color: rgba(255, 90, 90, 0.2);
  color: rgba(255, 170, 170, 0.9);
}
.ai-lib-mini--danger:hover {
  background: rgba(255, 90, 90, 0.18);
  border-color: rgba(255, 90, 90, 0.5);
  color: #fff;
}

html.light-mode .ai-lib-panel { background: #fafafb; border-left-color: rgba(0, 0, 0, 0.08); }
html.light-mode .ai-lib-title-main { color: rgba(20, 20, 30, 0.95); }
html.light-mode .ai-lib-item { background: rgba(0, 0, 0, 0.025); border-color: rgba(0, 0, 0, 0.06); }
html.light-mode .ai-lib-item:hover { background: rgba(0, 0, 0, 0.04); }
html.light-mode .ai-lib-title { color: rgba(20, 20, 30, 0.95); }
html.light-mode .ai-lib-preview { color: rgba(40, 40, 60, 0.78); }
html.light-mode .ai-lib-mini { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.08); color: rgba(30, 30, 50, 0.85); }

/* Chip moteur recommandé / actif. Discret, informatif, non-bloquant. */
.ai-engine-chip {
  font-size: 11.5px; color: var(--text-muted, #888);
  padding: 6px 12px; border-radius: 100px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  margin-left: auto;
}
.ai-engine-ok { color: rgba(120, 220, 160, 0.85); font-weight: 500; }
.ai-engine-mismatch { color: rgba(220, 180, 100, 0.9); }
.ai-engine-mismatch strong { color: #fff; font-weight: 600; }
@media (max-width: 640px) {
  .ai-engine-chip { margin-left: 0; margin-top: 4px; width: 100%; text-align: center; }
}

/* Aperçu prompt — overlay */
.ai-prompt-preview {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  padding: 5vh 5vw;
  animation: ai-fadein 0.18s ease;
}
@keyframes ai-fadein { from { opacity: 0; } to { opacity: 1; } }
.ai-prompt-preview-card {
  width: min(800px, 100%); max-height: 90vh;
  background: var(--bg-secondary, #16161a);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 18px 20px;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}
.ai-prompt-head { display: flex; align-items: center; justify-content: space-between; }
.ai-prompt-title { font-size: 14px; font-weight: 700; color: var(--text-primary, #fff); }
.ai-prompt-close {
  background: transparent; border: 0; color: var(--text-muted, #888);
  font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 8px; border-radius: 6px;
}
.ai-prompt-close:hover { color: #fff; background: rgba(255, 255, 255, 0.06); }
.ai-prompt-body {
  flex: 1; overflow: auto;
  margin: 0; padding: 14px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  color: rgba(220, 220, 230, 0.92);
  font-family: ui-monospace, SF Mono, Menlo, monospace;
  font-size: 12px; line-height: 1.55;
  white-space: pre-wrap; word-wrap: break-word;
}
.ai-prompt-actions { display: flex; justify-content: flex-end; }

/* Toast */
.ai-toast {
  position: fixed; bottom: 24px; left: 50%;
  transform: translateX(-50%) translateY(20px);
  padding: 12px 20px; border-radius: 10px;
  background: var(--bg-secondary, #1a1a20);
  border: 1px solid rgba(120, 160, 255, 0.3);
  color: var(--text-primary, #fff);
  font-size: 13px; font-weight: 500;
  opacity: 0; pointer-events: none;
  transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 9999;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
}
.ai-toast.is-visible { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
.ai-toast--error { border-color: rgba(255, 90, 90, 0.5); }

/* Mode clair */
html.light-mode .ai-section { background: rgba(0, 0, 0, 0.02); border-color: rgba(0, 0, 0, 0.06); }
html.light-mode .ai-multiselect { background: rgba(0, 0, 0, 0.02); border-color: rgba(0, 0, 0, 0.08); }
html.light-mode .ai-checkbox { background: rgba(0, 0, 0, 0.03); border-color: rgba(0, 0, 0, 0.08); color: rgba(20, 20, 30, 0.85); }
html.light-mode .ai-checkbox:has(input:checked) { background: rgba(80, 110, 230, 0.12); border-color: rgba(80, 110, 230, 0.4); color: rgba(40, 60, 180, 0.95); }
html.light-mode .ai-prompt-preview-card { background: #fafafb; }
html.light-mode .ai-prompt-body { background: rgba(0, 0, 0, 0.04); color: rgba(30, 30, 50, 0.92); }
html.light-mode .ai-toast { background: #1a1a20; color: #fff; }
  `;
  const style = document.createElement('style');
  style.id = 'ks-annonces-immo-styles';
  style.textContent = css;
  document.head.appendChild(style);
}
