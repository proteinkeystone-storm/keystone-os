/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact KODEX (A-COM-002) v1.0
   Sprint Kodex-1 : skeleton workspace fullscreen

   Mission : transformer une intention client (print/digital/presse)
   en cahier des charges technique infaillible, prêt à être traité
   par un graphiste ou par un moteur AI.

   Architecture des 4 étapes :
   ─────────────────────────────────────────────────────────────
     1. DESTINATION   — Acteur (imprimeur/réseau/presse) + Produit
     2. CONTENU       — Saisies métier sectorisées + données injectées
     3. ASSETS        — Coffre-fort : pièces détenues vs à fournir
     4. GÉNÉRATION    — Code Maître → IA → brief PDF téléchargeable

   Killer feature (Sprint Kodex-3) :
     CALCULATEUR D'ÉCHELLE pour les grands formats (bâche, 4×3).
     L'outil verrouille l'échelle 1/10e + le DPI selon distance
     de vue, et alerte si une pièce fournie est sous-résolue.

   Réutilisabilité :
     Le système de workspace (CSS `.ws-*` + structure `openKodex`)
     est conçu pour servir de gabarit à de futurs artefacts.
     Cloner ce fichier en `<nouvel-outil>.js`, garder la mécanique,
     remplacer les 4 vues et l'objet WORKSPACE_META.
   ═══════════════════════════════════════════════════════════════ */

// ── Métadonnées workspace (override par artefact) ──────────────
const WORKSPACE_META = {
  id        : 'A-COM-002',
  name      : 'Kodex',
  punchline : 'Le brief print/digital infaillible',
};

// ── Définition des étapes (ordre + icône + label) ──────────────
const STEPS = [
  { id: 'destination', label: 'Destination', icon: 'target',
    sublabel: 'Acteur et produit' },
  { id: 'content',     label: 'Contenu',     icon: 'edit',
    sublabel: 'Saisies métier' },
  { id: 'assets',      label: 'Assets',      icon: 'package',
    sublabel: 'Coffre-fort + pièces' },
  { id: 'output',      label: 'Génération',  icon: 'sparkles',
    sublabel: 'Brief PDF final' },
];

// ── État global (in-memory, persistance en Sprint Kodex-2+) ───
let _state = {
  view: 'destination',
  destination: { vendor: null, category: null, product: null, custom: null },
  content:     { sector: 'immobilier', fields: {} },
  assets:      { logo_owned: false, charte_owned: false, pieces: [] },
  output:      { codeMaitre: null, llmResponse: null, briefRef: null },
};

let _root = null;   // élément racine du workspace, null = fermé

// ═══════════════════════════════════════════════════════════════
// Bibliothèque de pictogrammes outline (style Lucide, stroke 1.5)
// ═══════════════════════════════════════════════════════════════
const ICONS = {
  // Navigation & actions
  'arrow-left' : '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  'x'          : '<path d="M18 6L6 18M6 6l12 12"/>',
  'check'      : '<polyline points="20 6 9 17 4 12"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'chevron-left' : '<polyline points="15 18 9 12 15 6"/>',
  'download'   : '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  'save'       : '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  'help-circle': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/>',
  'plus'       : '<path d="M12 5v14M5 12h14"/>',
  'history'    : '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',

  // Steps (rail)
  'target'     : '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
  'edit'       : '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  'package'    : '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  'sparkles'   : '<path d="M12 3l1.7 4.6 4.6 1.7-4.6 1.7L12 15.6l-1.7-4.6L5.7 9.3l4.6-1.7L12 3z"/><path d="M19 14l.8 2.2 2.2.8-2.2.8L19 20l-.8-2.2-2.2-.8 2.2-.8L19 14z"/><path d="M5 14l.8 2.2 2.2.8-2.2.8L5 20l-.8-2.2-2.2-.8 2.2-.8L5 14z"/>',

  // Categories
  'printer'    : '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  'globe'      : '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'book-open'  : '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'custom'     : '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',

  // Assets
  'image'      : '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  'palette'    : '<circle cx="12" cy="12" r="10"/><circle cx="6.5" cy="11.5" r="1.5" fill="currentColor"/><circle cx="9.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="17.5" cy="11.5" r="1.5" fill="currentColor"/><path d="M12 22a10 10 0 0 1 0-20c5 0 8 4 7 8a5 5 0 0 1-5 4h-2.5a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 1-1.5 5z"/>',
  'type'       : '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  'upload-cloud': '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/>',
  'file-text'  : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',

  // Kodex spécifique
  'ruler'      : '<path d="M21.3 8.7L8.7 21.3a1 1 0 0 1-1.4 0L2.7 16.7a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><path d="M7.5 10.5l2 2M11 7l1.5 1.5M14.5 3.5l2 2M4 14l2 2M14 4l-1 1M19 9l-1 1M5 19l1-1M18 14l1 1"/>',
};

function icon(name, size = 20) {
  const body = ICONS[name];
  if (!body) return '';
  return `<span class="ws-icon" style="width:${size}px;height:${size}px;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">${body}</svg></span>`;
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════
export function openKodex() {
  if (_root) return;     // déjà ouvert
  _state.view = 'destination';
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';
}

export function closeKodex() {
  if (!_root) return;
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════════
// Construction du shell (top bar + rail + main + aside)
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
        <button class="ws-iconbtn" data-act="history" title="Historique des briefs">
          ${icon('history', 18)}
        </button>
        <button class="ws-iconbtn" data-act="save" title="Sauvegarder le brouillon">
          ${icon('save', 18)}
        </button>
        <button class="ws-iconbtn" data-act="help" title="Aide">
          ${icon('help-circle', 18)}
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

  _renderRail();
  _renderAside();
}

function _onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'close')     return closeKodex();
  if (act === 'goto')      return _navigate(t.dataset.step);
  if (act === 'next')      return _advance();
  if (act === 'prev')      return _back();
  if (act === 'history')   return _toastSoon('Historique des briefs');
  if (act === 'save')      return _toastSoon('Sauvegarde de brouillon');
  if (act === 'help')      return _toastSoon('Guide pas-à-pas');
}

// ═══════════════════════════════════════════════════════════════
// Rail latéral — liste des étapes
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

    <div class="ws-rail-section">Workspace</div>
    <button class="ws-step" data-act="history">
      <span class="ws-step-icon" style="width:18px;height:18px;margin-left:32px;">${icon('history', 18)}</span>
      <span class="ws-step-label">Mes briefs</span>
    </button>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Aside (panel droit) — assistance contextuelle
// ═══════════════════════════════════════════════════════════════
function _renderAside() {
  const aside = _root.querySelector('[data-slot="aside"]');
  aside.innerHTML = `
    <div class="ws-aside-section">
      <div class="ws-aside-title">Pourquoi cet outil</div>
      <div class="ws-aside-card">
        Kodex vous évite l'erreur d'impression qui coûte cher : DPI insuffisant,
        marges oubliées, format incompatible avec l'imprimeur. Le brief généré
        est validé pour fabrication, prêt à envoyer à votre graphiste.
      </div>
    </div>

    <div class="ws-aside-section">
      <div class="ws-aside-title">Progression</div>
      <div class="ws-aside-card" data-slot="progress">
        <span class="ws-badge">Étape ${_currentStepIndex() + 1} / ${STEPS.length}</span>
      </div>
    </div>

    <div class="ws-aside-section">
      <div class="ws-aside-title">Killer feature</div>
      <div class="ws-aside-card">
        <strong style="color: var(--ws-text); display:block; margin-bottom:6px;">
          ${icon('ruler', 14)} Calculateur d'échelle
        </strong>
        Pour les grands formats (bâche, 4×3), Kodex verrouille
        automatiquement le DPI de travail selon la distance de vue —
        finie l'affiche pixelisée à 800&nbsp;€.
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Main panel — dispatch par vue
// ═══════════════════════════════════════════════════════════════
function _renderMain() {
  const main = _root.querySelector('[data-slot="main"]');
  const view = _state.view;
  let html = '';
  if (view === 'destination') html = _viewDestination();
  else if (view === 'content') html = _viewContent();
  else if (view === 'assets')  html = _viewAssets();
  else if (view === 'output')  html = _viewOutput();
  main.innerHTML = `<div class="ws-main-inner">${html}${_stepNav()}</div>`;
  main.scrollTop = 0;

  // Met à jour breadcrumb et rail
  const crumb = _root.querySelector('[data-slot="crumb"]');
  if (crumb) crumb.textContent = _currentStep().label;
  _renderRail();
  const progress = _root.querySelector('[data-slot="progress"]');
  if (progress) {
    progress.innerHTML = `<span class="ws-badge">Étape ${_currentStepIndex() + 1} / ${STEPS.length}</span>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// Vue 1 — DESTINATION
// ═══════════════════════════════════════════════════════════════
function _viewDestination() {
  const categories = [
    { id: 'print', label: 'Imprimeur', icon: 'printer',
      desc: 'Exaprint, Pixartprinting, Vistaprint — flyers, affiches, bâches, brochures, cartes de visite.' },
    { id: 'social', label: 'Réseaux sociaux', icon: 'globe',
      desc: 'Meta, LinkedIn, X, Google Business — posts, stories, reels, bannières.' },
    { id: 'press', label: 'Presse & magazines', icon: 'book-open',
      desc: 'Propriétés Le Figaro, Logic-Immo, Côte Magazine, La Provence et autres parutions immo.' },
    { id: 'custom', label: 'Format personnalisé', icon: 'custom',
      desc: 'Dimensions libres + upload du PDF de spécifications du prestataire.' },
  ];

  return `
    <span class="ws-eyebrow">${icon('target', 12)} Étape 1 sur 4</span>
    <h1 class="ws-h1">Où votre création sera-t-elle publiée&nbsp;?</h1>
    <p class="ws-lead">
      Choisissez le canal de diffusion. Kodex verrouille immédiatement les contraintes
      techniques (format, marges, colorimétrie, résolution) propres à cet acteur.
    </p>

    <div class="ws-card-grid">
      ${categories.map(c => `
        <div class="ws-card is-clickable ${_state.destination.category === c.id ? 'is-selected' : ''}"
             data-act="goto" data-step="destination" data-cat="${c.id}">
          <div class="ws-card-row">
            <div class="ws-card-icon">${icon(c.icon, 22)}</div>
            <div class="ws-card-body">
              <h3 class="ws-card-title">${c.label}</h3>
              <p class="ws-card-desc">${c.desc}</p>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="ws-empty" style="margin-top:32px;">
      <div class="ws-empty-icon" style="width:48px;height:48px;">${icon('printer', 22)}</div>
      <h3 class="ws-empty-title">Catalogue des standards</h3>
      <p class="ws-empty-desc">
        Une fois la catégorie sélectionnée, vous accéderez à la liste des produits avec
        leurs spécifications techniques verrouillées. Sprint Kodex-2.
      </p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Vue 2 — CONTENU
// ═══════════════════════════════════════════════════════════════
function _viewContent() {
  return `
    <span class="ws-eyebrow">${icon('edit', 12)} Étape 2 sur 4</span>
    <h1 class="ws-h1">Que voulez-vous communiquer&nbsp;?</h1>
    <p class="ws-lead">
      Les champs s'adaptent à votre secteur. Pour la promotion immobilière, Kodex
      récupère automatiquement les données déjà saisies dans vos autres outils
      (nom de programme, mentions légales, typologies) — vous n'écrivez chaque
      donnée qu'une seule fois.
    </p>

    <div class="ws-empty">
      <div class="ws-empty-icon">${icon('edit', 24)}</div>
      <h3 class="ws-empty-title">Formulaire sectoriel arrivant</h3>
      <p class="ws-empty-desc">
        Profil <strong>Immobilier</strong> en cours de chargement. Les profils
        Retail et Restauration seront ajoutés ensuite. Sprint Kodex-2.
      </p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Vue 3 — ASSETS
// ═══════════════════════════════════════════════════════════════
function _viewAssets() {
  return `
    <span class="ws-eyebrow">${icon('package', 12)} Étape 3 sur 4</span>
    <h1 class="ws-h1">Quels visuels et chartes&nbsp;?</h1>
    <p class="ws-lead">
      Cochez ce que Protein Studio possède déjà pour vous (logos, charte graphique, polices)
      et téléversez uniquement ce qui manque. Vos assets sont chiffrés au repos et synchronisés
      entre vos appareils.
    </p>

    <h2 class="ws-h2">Déjà connus de Keystone</h2>
    <div class="ws-card-grid">
      <div class="ws-card">
        <div class="ws-card-row">
          <div class="ws-card-icon">${icon('image', 22)}</div>
          <div class="ws-card-body">
            <h3 class="ws-card-title">Logo principal</h3>
            <p class="ws-card-desc">À cocher si vous nous avez déjà transmis votre logo vectoriel.</p>
          </div>
        </div>
      </div>
      <div class="ws-card">
        <div class="ws-card-row">
          <div class="ws-card-icon">${icon('palette', 22)}</div>
          <div class="ws-card-body">
            <h3 class="ws-card-title">Charte graphique</h3>
            <p class="ws-card-desc">Couleurs HEX/CMJN, polices titre &amp; corps.</p>
          </div>
        </div>
      </div>
    </div>

    <h2 class="ws-h2">À téléverser</h2>
    <div class="ws-empty">
      <div class="ws-empty-icon">${icon('upload-cloud', 24)}</div>
      <h3 class="ws-empty-title">Zone de dépôt arrivant</h3>
      <p class="ws-empty-desc">
        Vous pourrez glisser-déposer logos, illustrations, polices et brand-book PDF.
        Stockage chiffré (R2 EU). Sprint Kodex-3.
      </p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Vue 4 — OUTPUT
// ═══════════════════════════════════════════════════════════════
function _viewOutput() {
  return `
    <span class="ws-eyebrow">${icon('sparkles', 12)} Étape 4 sur 4</span>
    <h1 class="ws-h1">Le brief technique infaillible</h1>
    <p class="ws-lead">
      Kodex construit votre "Code Maître" puis interroge le moteur AI de votre choix.
      Le brief PDF généré inclut le format technique pour votre maquettiste et
      5 punchlines marketing pour votre directeur communication.
    </p>

    <div class="ws-empty">
      <div class="ws-empty-icon">${icon('sparkles', 24)}</div>
      <h3 class="ws-empty-title">Générateur arrivant</h3>
      <p class="ws-empty-desc">
        Appel direct au PromptEngine Keystone (BYOK), template Paged.js dédié,
        export PDF d'un clic. Sprint Kodex-4.
      </p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Step navigation footer (prev / next)
// ═══════════════════════════════════════════════════════════════
function _stepNav() {
  const idx = _currentStepIndex();
  const isFirst = idx === 0;
  const isLast  = idx === STEPS.length - 1;

  return `
    <div class="ws-step-nav">
      <button class="ws-btn ws-btn--ghost" data-act="prev" ${isFirst ? 'disabled style="visibility:hidden;"' : ''}>
        ${icon('chevron-left', 16)} Précédent
      </button>
      ${isLast
        ? `<button class="ws-btn ws-btn--accent" data-act="next" disabled>
             ${icon('sparkles', 16)} Générer le brief
           </button>`
        : `<button class="ws-btn ws-btn--primary" data-act="next">
             Étape suivante ${icon('chevron-right', 16)}
           </button>`
      }
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Navigation entre étapes
// ═══════════════════════════════════════════════════════════════
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
// Toast minimal pour les actions pas encore branchées
// ═══════════════════════════════════════════════════════════════
function _toastSoon(label) {
  const t = document.createElement('div');
  t.textContent = `${label} — arrivant dans un prochain sprint`;
  Object.assign(t.style, {
    position: 'fixed', bottom: '24px', left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    background: '#1a1a1a', color: '#fff',
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
  }, 2400);
}
