/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — UI Renderer v2.0
   Modules : Dashboard · Settings · Modal renderTool · S-CORE-LOGIC
   ═══════════════════════════════════════════════════════════════ */

import { getPad, getOwnedIds, setOwnedIds, getLifetimeIds, isFrigoMode, getCatalogEntry, getCatalog } from './pads-loader.js';
import { renderArtifactResult, COMP_ICONS } from './artifact-renderer.js';
import { ApiHandler } from './api-handler.js';
import {
    initGridEngine, getSavedOrder,
    getUserLabel, isPadHidden, restorePad,
    dismissEditMode, isPadDeactivated, deactivatePad, reactivatePad,
} from './grid-engine.js';
import { setKeystoneStatus, dismissDSTMessage } from './dst.js';
import { lock, unlock, isLocked }              from './lockscreen.js';
// Onboarding entièrement délégué à la landing page (index.html).
import { scheduleAutoSave } from './vault.js';
import { activateLicence, getLicenceStatus, revokeLicence }            from './licence.js';
import { exportArtifactPDF }                                           from './pdf-export.js';

// ── Icônes SVG ────────────────────────────────────────────────
const ICONS = {
    'vefa':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`,
    'ad':      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
    'mail':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    'social':  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 3.5V7.5L6 11H4a1 1 0 0 0-1 1z" stroke-linejoin="round"/><path d="M15.5 8.5a5 5 0 0 1 0 7" stroke-linecap="round"/><path d="M19 5a10 10 0 0 1 0 14" stroke-linecap="round"/></svg>`,
    'site':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    'foncier': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
    'chat':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    'brief':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    'zap':     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    'calc':    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="16" y2="18"/></svg>`,
    'table':   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
};

// ── Palette par catégorie d'outil (id prefix-based) ───────────
// Style "SaaS Premium" : chaque catégorie a sa teinte pastel propre.
// Mappage déterministe : un outil garde toujours la même couleur.
const _PALETTE_BY_PREFIX = {
    'O-IMM': 'blue',     // Immobilier
    'O-MKT': 'amber',    // Marketing
    'O-COM': 'violet',   // Communication
    'O-ANL': 'emerald',  // Analyse
    'O-FIN': 'green',    // Finance
    'O-PRO': 'rose',     // Production
    'O-LEG': 'cyan',     // Légal
    'A-':    'violet',   // Artefacts
};
function getToolPalette(id) {
    if (!id) return 'indigo';
    for (const prefix in _PALETTE_BY_PREFIX) {
        if (id.startsWith(prefix)) return _PALETTE_BY_PREFIX[prefix];
    }
    // Fallback : hash léger sur l'id pour distribuer entre 6 couleurs
    const colors = ['blue','amber','violet','emerald','rose','cyan'];
    let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return colors[Math.abs(h) % colors.length];
}

// ── Données dashboard — pilotées par PAD JSONs + catalog.json ───
// TOOLS    : peuplé au boot via initTools() depuis pads-loader.getToolList()
// ARTEFACTS: peuplé au boot via initTools() depuis pads-loader.getArtefactList()
// ID_KSTORE immuable · USER_LABEL modifiable · SKU canonique affiché en Shell
let TOOLS     = [];
let ARTEFACTS = [];

/**
 * Initialise les tableaux TOOLS et ARTEFACTS depuis les données chargées.
 * Appelé dans main.js après loadPads() + fetchRemoteCatalog().
 * Idempotent : si les listes sont vides, conserve les valeurs existantes.
 */
export function initTools(toolList = [], artefactList = []) {
    if (toolList.length)     TOOLS     = toolList;
    if (artefactList.length) ARTEFACTS = artefactList;
}

// ── Providers API ─────────────────────────────────────────────
const API_PROVIDERS = [
    { id:'anthropic',  name:'Anthropic',  label:'Claude',
      logo:'./RESOURCES/LOGOS/Logo%20Claude.png',
      logoLight:'./RESOURCES/LOGOS/Logo%20Claude%20-%20fond%20clair.png',
      placeholder:'sk-ant-api03-...' },
    { id:'openai',     name:'OpenAI',     label:'ChatGPT',
      logo:'./RESOURCES/LOGOS/Logo%20Chat%20GPT.png',
      logoLight:'./RESOURCES/LOGOS/Logo%20Chat%20GPT%20-%20fond%20clair.png',
      placeholder:'sk-proj-...' },
    { id:'gemini',     name:'Google',     label:'Gemini',
      logo:'./RESOURCES/LOGOS/Logo%20Gemini.png',
      logoLight:'./RESOURCES/LOGOS/Logo%20Gemini%20-%20fond%20clair.png',
      placeholder:'AIza...' },
    { id:'xai',        name:'xAI',        label:'Grok',
      logo:'./RESOURCES/LOGOS/Logo%20Grok.png',
      logoLight:'./RESOURCES/LOGOS/Logo%20Grok%20-%20fond%20clair.png',
      placeholder:'xai-...' },
    { id:'perplexity', name:'Perplexity', label:'Perplexity',
      logo:'./RESOURCES/LOGOS/Logo%20Perplexity.png',
      logoLight:'./RESOURCES/LOGOS/Logo%20Perplexity%20-%20fond%20clair.png',
      placeholder:'pplx-...' },
    { id:'mistral',    name:'Mistral AI', label:'Mistral',
      logo:'./RESOURCES/LOGOS/Logo%20Mistral%20AI.png',
      logoLight:'./RESOURCES/LOGOS/Logo%20Mistral%20AI%20-%20fond%20clair.png',
      placeholder:'mis-...' },
    { id:'meta',       name:'Meta',       label:'Llama',
      logo:'./RESOURCES/LOGOS/Logo%20Meta%20ai.png',
      logoLight:'./RESOURCES/LOGOS/Logo%20Meta%20ai%20-%20fond%20clair.png',
      placeholder:'gsk-...' },
];

// ── LocalStorage ──────────────────────────────────────────────
const LS_PREFIX     = 'ks_api_';
const LS_ENGINE     = 'ks_active_engine';
const LS_USER_NAME  = 'ks_user_name';
const LS_USER_PHOTO = 'ks_user_photo';

const saveKey       = (id, key) => key ? localStorage.setItem(LS_PREFIX + id, key) : localStorage.removeItem(LS_PREFIX + id);
const loadKey       = (id)      => localStorage.getItem(LS_PREFIX + id) || '';
const getActiveEngine = ()      => localStorage.getItem(LS_ENGINE) || 'Claude';
const setActiveEngine = (label) => { localStorage.setItem(LS_ENGINE, label); updateEngineChip(label); };

const ENGINE_TO_PROVIDER = {
    'Claude':'anthropic','ChatGPT':'openai','Gemini':'gemini',
    'Grok':'xai','Perplexity':'perplexity','Mistral':'mistral','Llama':'meta',
};

// Correspondance label dashboard → ID admin (clés dans engines.prompts côté D1)
const ENGINE_LABEL_TO_ID = {
    'Claude':'claude','ChatGPT':'gpt4o','Gemini':'gemini',
    'Grok':'grok','Perplexity':'perplexity','Mistral':'mistral','Llama':'llama',
};

// ── Topbar engine chip ────────────────────────────────────────
export function updateEngineChip(label) {
    const el = document.getElementById('ai-engine-label');
    if (el) el.textContent = label;
}

// ── Hero date ─────────────────────────────────────────────────
function renderHeroDate() {
    const el = document.getElementById('hero-date');
    if (!el) return;
    el.textContent = new Date().toLocaleDateString('fr-FR', {
        weekday:'long', day:'numeric', month:'long', year:'numeric'
    });
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
export function renderDashboard() {
    // ── Classification owned / locked (B2B + Lifetime) ────────
    const ownedIds    = getOwnedIds();
    const lifetimeIds = getLifetimeIds();

    // Un outil est accessible si : mode démo OU abonnement actif OU achat à vie
    const _isOwned    = id => ownedIds === null || ownedIds.includes(id) || lifetimeIds.includes(id);
    const _isLifetime = id => lifetimeIds.includes(id);

    // Source de vérité : sélection faite lors de l'onboarding (null = afficher tout)
    // La sélection s'applique aussi en mode démo : si l'utilisateur a coché 4 outils,
    // seuls ces 4 sont visibles dans la grille principale.
    const _userSelRaw = localStorage.getItem('ks_user_selection');
    let _userSel = null;
    if (_userSelRaw) {
        try {
            const parsed = JSON.parse(_userSelRaw);
            if (Array.isArray(parsed) && parsed.length > 0) _userSel = parsed;
        } catch (_) {}
    }

    // Exclure les outils désactivés + appliquer la sélection onboarding
    const _isSelected = id => _userSel === null || _userSel.includes(id);

    const ownedTools = TOOLS.filter(t =>
        _isOwned(t.id) &&
        !isPadDeactivated(t.id) &&
        _isSelected(t.id)
    );
    // Sont "verrouillés/suggérés" : ceux pas owned OU (mode démo + onboarding) non sélectionnés
    const lockedTools = TOOLS.filter(t => {
        const notOwned     = !_isOwned(t.id);
        const notSelected  = !_isSelected(t.id);
        return (notOwned || notSelected) && getCatalogEntry(t.id)?.published !== false;
    });

    // Artefacts : en mode démo, toujours dans la section "Outils disponibles" (suggested).
    // En mode licence, dans la grille principale s'ils sont owned.
    const ownedArts  = ownedIds !== null ? ARTEFACTS.filter(a => _isOwned(a.id) && _isSelected(a.id)) : [];
    const lockedArts = ARTEFACTS.filter(a => {
        const notOwned    = !_isOwned(a.id);
        const notSelected = !_isSelected(a.id);
        const inDemoMode  = ownedIds === null;
        return (inDemoMode || notOwned || notSelected) && getCatalogEntry(a.id)?.published !== false;
    });

    // ── Bannière Mode Frigo ────────────────────────────────────
    const _existingBanner = document.getElementById('ks-frigo-banner');
    if (isFrigoMode()) {
        if (!_existingBanner) {
            const _banner = document.createElement('div');
            _banner.id = 'ks-frigo-banner';
            _banner.className = 'ks-frigo-banner';
            _banner.innerHTML = `
                <span class="ks-frigo-text">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         style="width:14px;height:14px;flex-shrink:0">
                        <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07"/>
                    </svg>
                    Mode Frigo — Abonnement expiré · Vos achats définitifs restent actifs
                </span>
                <a href="https://proteinstudio.fr/keystone" target="_blank" rel="noopener"
                   class="ks-frigo-cta">Renouveler →</a>`;
            document.querySelector('.pads-section')?.before(_banner);
        }
    } else {
        _existingBanner?.remove();
    }

    const padsEl = document.getElementById('pads-container');
    const artsEl = document.getElementById('arts-container');

    // ── GRILLE PRINCIPALE — Outils possédés ────────────────────
    if (padsEl) {
        const savedOrder = getSavedOrder();
        let orderedTools = savedOrder
            ? savedOrder.map(id => ownedTools.find(t => t.id === id)).filter(Boolean)
            : [...ownedTools];

        // Ajouter les outils pas encore dans l'ordre sauvegardé
        ownedTools.forEach(t => { if (!orderedTools.find(x => x.id === t.id)) orderedTools.push(t); });

        // Filtrer : uniquement les outils non masqués (la sélection onboarding est déjà appliquée en amont)
        const visibleTools = orderedTools.filter(t => !isPadHidden(t.id));

        // Cartes outils possédés (interactives, drag & drop)
        const toolCards = visibleTools.map(t => {
            const label = getUserLabel(t.id) || t.name;
            const lt    = _isLifetime(t.id);
            const pal   = getToolPalette(t.id);
            return `
            <div class="pad-card${lt ? ' pad-card--lifetime' : ''}" data-id="${t.id}" data-engine="${t.engine}" data-palette="${pal}">
                <div class="pad-drag-handle" title="Déplacer pour réorganiser">
                    <svg viewBox="0 0 10 16" fill="currentColor" style="width:10px;height:14px">
                        <circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/>
                        <circle cx="3" cy="8"   r="1.3"/><circle cx="7" cy="8"   r="1.3"/>
                        <circle cx="3" cy="13.5" r="1.3"/><circle cx="7" cy="13.5" r="1.3"/>
                    </svg>
                </div>
                <div class="pad-icon">${ICONS[t.icon]}</div>
                <div class="pad-arrow">↗</div>
                <div class="pad-name">${label}</div>
                <div class="pad-desc">${t.desc}</div>
                ${lt ? '<div class="pad-lifetime-badge">∞ À vie</div>' : ''}
            </div>`;
        }).join('');

        // Artefacts possédés (dans la grille principale, si achetés)
        const ownedArtCards = ownedArts.map(a => {
            const pal = getToolPalette(a.id);
            return `
            <div class="pad-card pad-card--artefact" data-id="${a.id}" data-palette="${pal}">
                <div class="pad-drag-handle" title="Déplacer pour réorganiser">
                    <svg viewBox="0 0 10 16" fill="currentColor" style="width:10px;height:14px">
                        <circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/>
                        <circle cx="3" cy="8"   r="1.3"/><circle cx="7" cy="8"   r="1.3"/>
                        <circle cx="3" cy="13.5" r="1.3"/><circle cx="7" cy="13.5" r="1.3"/>
                    </svg>
                </div>
                <div class="pad-icon">${ICONS[a.icon] || ICONS['zap']}</div>
                <div class="pad-arrow">↗</div>
                <div class="pad-name">${a.name}</div>
                <div class="pad-desc">Artefact</div>
            </div>`;
        }).join('');

        padsEl.innerHTML = toolCards + ownedArtCards;

        // Compteur de section
        const countEl = document.querySelector('.pads-section .sec-count');
        if (countEl) countEl.textContent = visibleTools.length + ownedArts.length;

        _renderRestoreBtn(padsEl, ownedTools);
        initGridEngine(
            padsEl,
            openTool,
            () => _renderRestoreBtn(padsEl, ownedTools),
            () => renderDashboard()
        );
    }

    // ── BARRE KEY-STORE — Outils suggérés / verrouillés ────────
    if (artsEl) {
        // Tri : nouveaux outils en premier, puis ordre déclaratif
        const sortedLocked = [...lockedTools, ...lockedArts].sort((a, b) => {
            const aNew = !!getCatalogEntry(a.id)?.isNew;
            const bNew = !!getCatalogEntry(b.id)?.isNew;
            return (bNew ? 1 : 0) - (aNew ? 1 : 0);
        });

        // Cartes compactes — pictogramme + nom (sans CTA)
        const suggestCards = sortedLocked.map(item => {
            const cat    = getCatalogEntry(item.id);
            const isNew  = !!cat?.isNew;
            const icon   = ICONS[item.icon] || ICONS['zap'];
            const label  = item.name || item.title || item.id;
            const pal    = getToolPalette(item.id);
            return `
            <div class="suggest-card" data-id="${item.id}" data-palette="${pal}"
                 role="button" tabindex="0" aria-label="Découvrir ${label}">
                ${isNew ? '<span class="suggest-card-new">Nouveau</span>' : ''}
                <div class="suggest-card-icon">${icon}</div>
                <div class="suggest-card-name">${label}</div>
                <div class="suggest-card-arrow">↗</div>
            </div>`;
        }).join('');

        artsEl.innerHTML = suggestCards;

        // Délégation de clic — ouvre le panneau K-Store.
        // En plan Démo (1 outil), un clic sur un autre outil renvoie
        // directement vers l'onglet Abonnements/Plans.
        artsEl.addEventListener('click', e => {
            const card = e.target.closest('.suggest-card');
            if (!card) return;
            _openKStorePanel(isDemoPlan ? 'plans' : 'catalogue');
        });

        // Mise à jour du compteur Key-Store
        const ksCountEl = document.querySelector('.suggest-section .sec-kstore-badge');
        if (ksCountEl) {
            const total = lockedTools.length + lockedArts.length;
            ksCountEl.textContent = total > 0
                ? `Key-Store · ${total} disponibles`
                : 'Key-Store';
        }
    }

    // Bouton catalogue → panneau K-Store (Sprint 5 : remplace le toast)
    const kstoreBtn = document.getElementById('kstore-catalog-btn');
    if (kstoreBtn) kstoreBtn.onclick = _openKStorePanel;

    // Badge pulse si nouveaux outils depuis la dernière visite
    _checkKStorePulse();

    // Si le catalogue vient de charger et que le panneau est ouvert, rafraîchir la liste
    if (document.getElementById('ks-panel')?.classList.contains('open')) {
        _renderKStoreItems();
    }

    renderHeroDate();
}

// ── Bouton (+) restauration — idempotent (upsert / remove) ───
function _renderRestoreBtn(padsEl, activeTools = TOOLS) {
    const hiddenTools = activeTools.filter(t => isPadHidden(t.id));
    const wrap = document.querySelector('.pads-section .sec-hd');
    if (!wrap) return;

    let btn = wrap.querySelector('.restore-btn');

    // Plus rien de masqué → on retire le bouton si présent
    if (hiddenTools.length === 0) {
        btn?.remove();
        return;
    }

    if (btn) {
        // Bouton déjà présent → on met juste le compteur à jour
        btn.querySelector('.restore-count').textContent = hiddenTools.length;
    } else {
        // Première apparition → on crée le bouton avec icône œil-barré
        btn = document.createElement('button');
        btn.className = 'restore-btn';
        btn.title = 'Afficher les outils masqués';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
            <span class="restore-count">${hiddenTools.length}</span>
        `;
        wrap.appendChild(btn);
        btn.addEventListener('click', () => _openRestorePanel(padsEl, btn));
    }
}

// ═══════════════════════════════════════════════════════════════
// K-STORE PANEL — Sprint 5
// Panneau slide-in avec recherche, filtres, grille catalogue
// ═══════════════════════════════════════════════════════════════
const LS_CATALOG_CHECK = 'ks_last_catalog_check';
const _KS_CAT_LABELS   = {
    IMM:'Immobilier', MKT:'Marketing', ANL:'Analyse', ADM:'Admin',
    JUR:'Juridique', PRD:'Productivité', COM:'Communauté', DIV:'Divertissement',
};

let _ksPanelReady = false;
let _ksSearch     = '';
let _ksCat        = '';
let _ksPlan       = '';
let _ksDebounce   = null;
let _ksView       = 'catalogue'; // 'catalogue' | 'plans'

// Source de vérité dupliquée depuis index.html (section #plans).
// À mettre à jour conjointement si la grille tarifaire évolue.
const KS_PLANS = [
    {
        id: 'STARTER',
        name: 'Start',
        price: 49,
        color: '#63b3ed',
        stripeUrl: 'https://buy.stripe.com/bJe7sL6Nz5GocYR1SQf7i00',
        desc: `Pour les professionnels qui veulent exploiter l'IA au quotidien, dès aujourd'hui.`,
        features: [
            { text: '6 Assistants Certifiés au choix' },
            { text: '3 postes / utilisateurs' },
            { text: 'Tous les moteurs IA inclus' },
            { text: 'Artefacts visuels complets' },
            { text: 'Export PDF A4 premium' },
            { text: 'Mode PWA — tablette & mobile' },
            { text: 'Artefacts sur-mesure', disabled: true },
            { text: 'Support prioritaire',  disabled: true },
        ],
    },
    {
        id: 'PRO',
        name: 'Pro',
        price: 79,
        color: 'var(--gold)',
        recommended: true,
        stripeUrl: 'https://buy.stripe.com/28E7sLgo9gl21g9eFCf7i01',
        desc: `Pour les équipes et cabinets qui veulent déployer l'IA à grande échelle avec précision.`,
        features: [
            { text: '8 Assistants Certifiés au choix' },
            { text: 'Multi-postes / utilisateurs' },
            { text: 'Tous les moteurs IA inclus' },
            { text: 'Artefacts visuels complets' },
            { text: 'Export PDF A4 premium' },
            { text: 'Mode PWA — tablette & mobile' },
            { html: '<strong>Éligible Artefacts sur-mesure</strong> <span class="ks-plan-feature-note">(sur devis)</span>' },
            { text: 'Support prioritaire', disabled: true },
        ],
    },
    {
        id: 'MAX',
        name: 'Max',
        price: 149,
        color: '#c084fc',
        stripeUrl: 'https://buy.stripe.com/9B6eVd0pb7Ow4sl7daf7i02',
        desc: `Pour les structures qui exigent l'accès total, le déploiement illimité et un support dédié.`,
        features: [
            { html: '<strong>Collection complète illimitée</strong>' },
            { text: 'Appareils illimités' },
            { text: 'Tous les moteurs IA inclus' },
            { text: 'Artefacts visuels complets' },
            { text: 'Export PDF A4 premium' },
            { text: 'Mode PWA — tablette & mobile' },
            { html: '<strong>Éligible Artefacts sur-mesure</strong> <span class="ks-plan-feature-note">(sur devis)</span>' },
            { html: '<strong>Support prioritaire dédié</strong>' },
        ],
    },
];

// Quotas par plan (nombre max d'assistants simultanément déployés)
const PLAN_QUOTAS  = { DEMO: 1, STARTER: 6, PRO: 8, MAX: Infinity };
const _PLAN_ORDER  = ['DEMO', 'STARTER', 'PRO', 'MAX'];

function _openKStorePanel(view = 'catalogue') {
    _buildKStorePanel();
    const panel = document.getElementById('ks-panel');
    panel?.classList.add('open');
    document.getElementById('ks-backdrop-panel')?.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Marque la visite → supprime le pulse
    localStorage.setItem(LS_CATALOG_CHECK, new Date().toISOString().split('T')[0]);
    document.getElementById('kstore-catalog-btn')?.classList.remove('pulse');

    // Vue cible (catalogue par défaut, "plans" pour les renvois Démo)
    if (panel && view === 'plans') {
        panel.querySelectorAll('.ks-tab').forEach(t => t.classList.remove('active'));
        panel.querySelector('.ks-tab[data-view="plans"]')?.classList.add('active');
        _ksView = 'plans';
        const cat = document.getElementById('ks-catalogue-view');
        const pln = document.getElementById('ks-plans-view');
        if (cat) cat.hidden = true;
        if (pln) pln.hidden = false;
        _renderKStorePlans();
    } else {
        _renderKStoreItems();
    }
}

function _closeKStorePanel() {
    document.getElementById('ks-panel')?.classList.remove('open');
    document.getElementById('ks-backdrop-panel')?.classList.remove('open');
    document.body.style.overflow = '';
}

function _buildKStorePanel() {
    if (_ksPanelReady) return;
    _ksPanelReady = true;

    const bd = document.createElement('div');
    bd.id = 'ks-backdrop-panel';
    bd.className = 'ks-backdrop';
    bd.addEventListener('click', _closeKStorePanel);
    document.body.appendChild(bd);

    const panel = document.createElement('div');
    panel.id = 'ks-panel';
    panel.className = 'ks-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Key-Store');
    panel.innerHTML = `
        <div class="ks-head">
            <div>
                <div class="ks-head-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         style="width:14px;height:14px;opacity:.8;flex-shrink:0">
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <path d="M16 10a4 4 0 0 1-8 0"/>
                    </svg>
                    KEY-STORE
                </div>
                <div class="ks-head-sub" id="ks-head-sub">Catalogue des outils disponibles</div>
            </div>
            <button id="ks-close-btn" class="ks-close" aria-label="Fermer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     style="width:14px;height:14px">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>

        <div class="ks-tabs">
            <button class="ks-tab active" data-view="catalogue">Catalogue</button>
            <button class="ks-tab" data-view="plans">Plans & Tarifs</button>
        </div>

        <div id="ks-catalogue-view">
            <div class="ks-search-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     class="ks-search-icon">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input id="ks-search-input" class="ks-search-input"
                       type="search" placeholder="Rechercher un outil…" autocomplete="off">
            </div>

            <div class="ks-filters">
                <div class="ks-filter-row">
                    <span class="ks-filter-label">CATÉGORIE</span>
                    <div class="ks-cat-select-wrap">
                        <select id="ks-cat-select" class="ks-cat-select">
                            <option value="">Toutes les catégories</option>
                            <option value="IMM">Immobilier</option>
                            <option value="JUR">Juridique</option>
                            <option value="ANL">Analyse</option>
                            <option value="PRD">Productivité</option>
                            <option value="COM">Communauté</option>
                            <option value="DIV">Divertissement</option>
                        </select>
                        <svg class="ks-cat-chevron" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2.2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </div>
                </div>
                <div class="ks-filter-row">
                    <span class="ks-filter-label">PLAN</span>
                    <div class="ks-filter-chips" data-filter="plan">
                        <button class="ks-chip-filter active" data-value="STARTER">STARTER</button>
                        <button class="ks-chip-filter" data-value="PRO">PRO</button>
                        <button class="ks-chip-filter" data-value="MAX">MAX</button>
                        <button class="ks-chip-filter ks-chip-contact" data-value="SUR_MESURE">SUR MESURE</button>
                    </div>
                </div>
            </div>

            <div id="ks-grid" class="ks-grid"></div>
        </div>

        <div id="ks-plans-view" class="ks-plans-view" hidden></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#ks-close-btn').addEventListener('click', _closeKStorePanel);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeKStorePanel(); });

    // Tabs — Catalogue / Plans
    panel.querySelectorAll('.ks-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            panel.querySelectorAll('.ks-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            _ksView = tab.dataset.view;
            document.getElementById('ks-catalogue-view').hidden = _ksView !== 'catalogue';
            document.getElementById('ks-plans-view').hidden     = _ksView !== 'plans';
            const sub = document.getElementById('ks-head-sub');
            if (sub) sub.textContent = _ksView === 'plans'
                ? 'Choisissez votre plan'
                : 'Catalogue des outils disponibles';
            if (_ksView === 'plans') _renderKStorePlans();
        });
    });

    panel.querySelector('#ks-cat-select').addEventListener('change', e => {
        _ksCat = e.target.value;
        _renderKStoreItems();
    });

    panel.querySelector('#ks-search-input').addEventListener('input', e => {
        _ksSearch = e.target.value.toLowerCase().trim();
        clearTimeout(_ksDebounce);
        _ksDebounce = setTimeout(_renderKStoreItems, 180);
    });

    panel.querySelectorAll('.ks-filter-chips').forEach(group => {
        group.addEventListener('click', e => {
            const chip = e.target.closest('.ks-chip-filter');
            if (!chip) return;

            // SUR MESURE → mailto, pas de filtre
            if (chip.dataset.value === 'SUR_MESURE') {
                const sub = encodeURIComponent('Keystone OS — Demande Sur Mesure');
                const body = encodeURIComponent('Bonjour,\n\nJe souhaite en savoir plus sur une offre sur mesure.\n\nNom / Société :\nBesoins :\nNombre d\'utilisateurs :\n\nCordialement,');
                window.open(`mailto:protein.keystone@gmail.com?subject=${sub}&body=${body}`);
                return;
            }

            group.querySelectorAll('.ks-chip-filter').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            if (group.dataset.filter === 'cat')  _ksCat  = chip.dataset.value;
            if (group.dataset.filter === 'plan') _ksPlan = chip.dataset.value;
            _renderKStoreItems();
        });
    });

    panel.querySelector('#ks-grid').addEventListener('click', e => {
        // "Déployer" → activation avec animation halo
        const obtBtn = e.target.closest('.ks-item-btn[data-action="obtenir"]');
        if (obtBtn && !obtBtn.disabled) { _activateKStoreItem(obtBtn.dataset.id, obtBtn); return; }

        // "Réactiver" → unhide immédiat (quota reste occupé, pas d'animation lourde)
        const reactBtn = e.target.closest('.ks-item-btn[data-action="reactiver"]');
        if (reactBtn) {
            restorePad(reactBtn.dataset.id);
            renderDashboard();
            _renderKStoreItems();
            return;
        }

        // "Upgrade" → onglet Plans & Tarifs
        const upBtn = e.target.closest('.ks-item-btn[data-action="upgrade"]');
        if (upBtn) {
            panel.querySelectorAll('.ks-tab').forEach(t => t.classList.remove('active'));
            panel.querySelector('.ks-tab[data-view="plans"]')?.classList.add('active');
            _ksView = 'plans';
            document.getElementById('ks-catalogue-view').hidden = true;
            document.getElementById('ks-plans-view').hidden     = false;
            _renderKStorePlans();
            return;
        }
    });
}

// ── Activation d'un outil depuis le KEY-STORE ─────────────────
function _activateKStoreItem(id, btn) {
    if (!btn || btn.classList.contains('ks-item-btn--loading')) return;

    // 1. Loading visual
    btn.classList.add('ks-item-btn--loading');
    btn.disabled = true;
    btn.innerHTML = `<span class="ks-spinner"></span>`;

    // 2. Halo radial sur la carte
    const card = btn.closest('.ks-item');
    card?.classList.add('ks-item--activating');

    setTimeout(() => {
        // 3. Persistance
        const owned = getOwnedIds();
        if (owned === null || owned.includes(id)) {
            reactivatePad(id); // retire ks_deactivated_
            restorePad(id);    // retire ks_hidden_ (si l'outil était masqué)
        } else {
            setOwnedIds([...owned, id]);
        }
        // Ajouter à ks_user_selection (source de vérité du dashboard)
        try {
            const raw = localStorage.getItem('ks_user_selection');
            if (raw) {
                const sel = JSON.parse(raw);
                if (!sel.includes(id)) localStorage.setItem('ks_user_selection', JSON.stringify([...sel, id]));
            }
        } catch (_) {}

        // 4. Rafraîchissement synchrone des deux surfaces
        renderDashboard();
        _renderKStoreItems();
    }, 660);
}

function _renderKStoreItems() {
    const grid = document.getElementById('ks-grid');
    if (!grid) return;

    const ownedIds = getOwnedIds();
    const all      = [...TOOLS, ...ARTEFACTS];

    const filtered = all.filter(item => {
        const cat = getCatalogEntry(item.id);

        // Masquer les outils non publiés (prototypes, en cours de validation)
        if (cat && cat.published === false) return false;

        if (_ksSearch) {
            const hay = [item.name, item.desc || '', cat?.subtitle || '',
                         cat?.longDesc || '', ...(cat?.tags || [])].join(' ').toLowerCase();
            if (!hay.includes(_ksSearch)) return false;
        }

        if (_ksCat) {
            const itemCat = cat?.category || item.id.split('-')[1];
            if (itemCat !== _ksCat) return false;
        }

        if (_ksPlan) {
            if (!cat || cat.plan !== _ksPlan) return false;
        }

        return true;
    });

    const sub = document.getElementById('ks-head-sub');
    if (sub) {
        sub.textContent = `${filtered.length} outil${filtered.length !== 1 ? 's' : ''} trouvé${filtered.length !== 1 ? 's' : ''}`;
    }

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="ks-empty">Aucun outil ne correspond à votre recherche.</div>`;
        return;
    }

    // — ks_user_selection : source de vérité de la sélection onboarding ———
    const _ksUserSel = (() => {
        try { return JSON.parse(localStorage.getItem('ks_user_selection')); } catch { return null; }
    })();

    // — Calcul du quota utilisateur ——————————————————————————————
    // Normalisation de la casse — la landing stocke 'Demo'/'Pro'/'Start'/'Max'
    // mais le catalogue et l'ordre interne sont en MAJUSCULES.
    const userPlan    = (localStorage.getItem('ks_plan') || '').toUpperCase();
    const userPlanIdx = userPlan ? _PLAN_ORDER.indexOf(userPlan) : 3; // pas de plan → MAX (démo libre)
    const quota       = (ownedIds !== null && userPlan) ? (PLAN_QUOTAS[userPlan] ?? Infinity) : Infinity;
    // Quota : outil masqué = toujours actif, outil désactivé = libère une place
    const activeCount = ownedIds === null
        ? (_ksUserSel !== null
            ? _ksUserSel.filter(id => !isPadDeactivated(id)).length
            : TOOLS.filter(t => !isPadDeactivated(t.id)).length)
        : ownedIds.filter(i => !isPadDeactivated(i)).length;

    grid.innerHTML = filtered.map(item => {
        const cat          = getCatalogEntry(item.id);
        const isArt        = item.id.startsWith('A-');
        const catLbl       = _KS_CAT_LABELS[cat?.category || item.id.split('-')[1]] || '';
        const toolPlanIdx  = _PLAN_ORDER.indexOf((cat?.plan || 'STARTER').toUpperCase());

        // — État du bouton —————————————————————————————————————
        // Logique tristate : Actif / Masqué / Déployer
        const _inSel        = _ksUserSel === null || _ksUserSel.includes(item.id);
        const _notDeact     = !isPadDeactivated(item.id);
        const _notHidden    = !isPadHidden(item.id);

        let btnHTML;
        if (ownedIds === null) {
            // Mode démo : tous les outils sont possédés
            if (_inSel && _notDeact && _notHidden) {
                btnHTML = `<span class="ks-item-btn ks-item-btn--deployed">✓&nbsp;Actif</span>`;
            } else if (_inSel && _notDeact && !_notHidden) {
                // Masqué : occupe une place quota, réactivable
                btnHTML = `<button class="ks-item-btn ks-item-btn--hidden" data-action="reactiver" data-id="${item.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;flex-shrink:0"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    Réactiver</button>`;
            } else {
                // Non sélectionné ou désactivé → disponible dans le KEY-STORE
                btnHTML = `<button class="ks-item-btn ks-item-btn--obtenir" data-action="obtenir" data-id="${item.id}">Déployer</button>`;
            }
        } else {
            const isOwned = ownedIds.includes(item.id);
            if (isOwned && _notDeact && _notHidden) {
                btnHTML = `<span class="ks-item-btn ks-item-btn--deployed">✓&nbsp;Actif</span>`;
            } else if (isOwned && _notDeact && !_notHidden) {
                btnHTML = `<button class="ks-item-btn ks-item-btn--hidden" data-action="reactiver" data-id="${item.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;flex-shrink:0"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    Réactiver</button>`;
            } else if (!isOwned && toolPlanIdx > userPlanIdx) {
                btnHTML = `<button class="ks-item-btn ks-item-btn--locked" data-action="upgrade" data-id="${item.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:9px;height:9px;flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Upgrade</button>`;
            } else if (!isOwned && activeCount >= quota) {
                btnHTML = `<button class="ks-item-btn ks-item-btn--quota" disabled>Quota atteint — Plan ${userPlan}</button>`;
            } else {
                btnHTML = `<button class="ks-item-btn ks-item-btn--obtenir" data-action="obtenir" data-id="${item.id}">Déployer</button>`;
            }
        }

        const isDeployed = ownedIds === null
            ? (_inSel && _notDeact && _notHidden)
            : ownedIds.includes(item.id) && _notDeact && _notHidden;

        return `
        <div class="ks-item${isDeployed ? ' ks-item--deployed' : ''}${cat?.isNew ? ' ks-item--new' : ''}" data-id="${item.id}">
            <div class="ks-item-icon">${ICONS[item.icon] || ICONS['zap']}</div>
            <div class="ks-item-body">
                <div class="ks-item-meta">
                    ${item.id} · ${catLbl}${isArt ? ' · Artefact' : ''}
                    ${cat?.isNew ? '<span class="ks-new-dot">● NEW</span>' : ''}
                </div>
                <div class="ks-item-name">${cat?.title || item.name}</div>
                <div class="ks-item-desc">${cat?.subtitle || item.desc || ''}</div>
                <div class="ks-item-chips">
                    ${cat?.plan ? `<span class="ks-chip ks-chip-plan">${cat.plan}</span>` : ''}
                </div>
            </div>
            <div class="ks-item-action">${btnHTML}</div>
        </div>`;
    }).join('');
}

function _renderKStorePlans() {
    const view = document.getElementById('ks-plans-view');
    if (!view) return;

    const ownedIds    = getOwnedIds();
    const currentPlan = (localStorage.getItem('ks_plan') || '').toUpperCase();

    const renderFeature = f => {
        const inner = f.html ? f.html : f.text;
        return `<li${f.disabled ? ' class="disabled"' : ''}>${inner}</li>`;
    };

    view.innerHTML = `
        <div class="ks-plans-intro">
            Engagement mensuel, sans frais cachés. Changez de plan à tout moment.
        </div>
        <div class="ks-plans-grid">
            ${KS_PLANS.map(plan => {
                const isActive = currentPlan === plan.id
                              || (plan.id === 'MAX' && ownedIds === null);
                return `
                <div class="ks-plan-card${plan.recommended ? ' ks-plan-card--recommended' : ''}${isActive ? ' ks-plan-card--active' : ''}"
                     style="--plan-color:${plan.color}">
                    ${plan.recommended ? '<div class="ks-plan-badge">POPULAIRE</div>' : ''}
                    ${isActive        ? '<div class="ks-plan-badge ks-plan-badge--active">VOTRE PLAN</div>' : ''}
                    <div class="ks-plan-name">${plan.name.toUpperCase()}</div>
                    <div class="ks-plan-price">
                        <span class="ks-plan-currency">€</span>${plan.price}<span class="ks-plan-per">/mois</span>
                    </div>
                    <p class="ks-plan-desc">${plan.desc}</p>
                    <ul class="ks-plan-list">
                        ${plan.features.map(renderFeature).join('')}
                    </ul>
                    ${isActive
                        ? `<button class="ks-plan-cta" disabled style="opacity:.7;cursor:default">Votre plan actuel ✓</button>`
                        : `<a class="ks-plan-cta" href="${plan.stripeUrl}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">Choisir ${plan.name}</a>`
                    }
                    <p class="ks-plan-note">Sans engagement · Résiliable à tout moment</p>
                </div>`;
            }).join('')}
        </div>
    `;
}

function _checkKStorePulse() {
    const catalog = getCatalog();
    if (!catalog) return;

    const lastCheck = localStorage.getItem(LS_CATALOG_CHECK);
    const hasNew    = catalog.tools.some(t => t.isNew)
                      && (!lastCheck || catalog.updatedAt > lastCheck);

    const badge = document.getElementById('kstore-catalog-btn');
    if (!badge) return;

    if (hasNew) {
        badge.classList.add('pulse');
    } else {
        badge.classList.remove('pulse');
    }
}

// ═══════════════════════════════════════════════════════════════
// MARKETPLACE INFO MODAL — affiché au clic d'un outil verrouillé
// ═══════════════════════════════════════════════════════════════
// ── Trial — 1 génération gratuite par outil ─────────────────────
const LS_TRIAL_PREFIX = 'ks_trial_';

function _getTrialState(id) {
    try { return JSON.parse(localStorage.getItem(LS_TRIAL_PREFIX + id) || 'null'); } catch { return null; }
}
function _hasTrialLeft(id) {
    const state = _getTrialState(id);
    return state !== null && state.uses < 1;
}
function _consumeTrial(id) {
    const state = _getTrialState(id) || { uses: 0 };
    state.uses = (state.uses || 0) + 1;
    localStorage.setItem(LS_TRIAL_PREFIX + id, JSON.stringify(state));
}
function _startTrial(id) {
    const existing = _getTrialState(id);
    if (!existing) localStorage.setItem(LS_TRIAL_PREFIX + id, JSON.stringify({ uses: 0, startedAt: Date.now() }));
}

function _openMarketplaceInfo(item) {
    document.getElementById('ks-mkt-backdrop')?.remove();
    document.getElementById('ks-mkt-modal')?.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'ks-mkt-backdrop';
    backdrop.className = 'mkt-backdrop';

    const catCode    = (item.id || '').split('-')[1] || '';
    const catLabels  = { IMM:'Immobilier', MKT:'Marketing', ANL:'Analyse', ADM:'Admin', ART:'Artefact' };
    const catLabel   = catLabels[catCode] || catCode;
    const isArtefact = (item.id || '').startsWith('A-');

    const cat          = getCatalogEntry(item.id);
    const longDesc     = cat?.longDesc || null;
    const plan         = cat?.plan     || null;
    const price        = cat?.price    || null;
    const lifetimePrice= cat?.lifetimePrice || null;
    const aiEngine     = cat?.ai_optimized || item.engine || null;
    const isNew        = cat?.isNew    || false;

    // URLs de conversion avec ID de l'outil
    const baseUrl       = `https://proteinstudio.fr/keystone?id=${encodeURIComponent(item.id)}`;
    const unlockUrl     = `${baseUrl}&plan=${encodeURIComponent(plan || 'starter')}`;
    const lifetimeUrl   = `${baseUrl}&plan=lifetime`;

    // État du trial pour cet outil
    const trialState    = _getTrialState(item.id);
    const trialUsed     = trialState !== null && trialState.uses >= 1;
    const trialAvail    = !isArtefact && !trialUsed;

    const _feat = txt => `<div class="mkt-feat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             style="width:12px;height:12px;flex-shrink:0;color:var(--gold)">
            <polyline points="20 6 9 17 4 12"/>
        </svg>${txt}</div>`;

    const modal = document.createElement('div');
    modal.id = 'ks-mkt-modal';
    modal.className = 'mkt-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', `Découvrir ${cat?.title || item.name}`);
    modal.innerHTML = `
        <div class="mkt-head">
            <div class="mkt-icon">${ICONS[item.icon] || ICONS['zap']}</div>
            <div class="mkt-meta">
                <div class="mkt-id">
                    ${item.id} · ${catLabel}
                    ${isNew ? '<span class="mkt-new-badge">NOUVEAU</span>' : ''}
                </div>
                <div class="mkt-title">${cat?.title || item.name}</div>
                <div class="mkt-subtitle">${cat?.subtitle || item.desc || ''}</div>
            </div>
            <button class="mkt-close" aria-label="Fermer">✕</button>
        </div>

        <div class="mkt-body">
            ${aiEngine ? `<div class="mkt-engine-row"><span class="mkt-chip mkt-chip-engine">${aiEngine} ✦</span></div>` : ''}

            <p class="mkt-explain">
                ${longDesc || `Cet outil n'est pas inclus dans votre licence actuelle. Débloquez-le pour un accès illimité ou essayez-le gratuitement.`}
            </p>

            <div class="mkt-features">
                ${_feat('Accès illimité au formulaire IA')}
                ${_feat('Sauvegarde dans la bibliothèque de prompts')}
                ${_feat('Mises à jour automatiques via Key-Store')}
                ${lifetimePrice ? _feat('Achat définitif disponible — aucun abonnement requis') : ''}
            </div>
        </div>

        <div class="mkt-pricing">
            ${price ? `
            <div class="mkt-price-col">
                <div class="mkt-price-label">Abonnement</div>
                <div class="mkt-price-amount">${price} €<span class="mkt-price-per">/mois</span></div>
                ${plan ? `<div class="mkt-price-plan">Plan ${plan}</div>` : ''}
                <a class="mkt-btn-unlock" href="${unlockUrl}" target="_blank" rel="noopener noreferrer">
                    Débloquer →
                </a>
            </div>` : ''}
            ${lifetimePrice ? `
            <div class="mkt-price-col mkt-price-col--lifetime">
                <div class="mkt-price-label">À vie</div>
                <div class="mkt-price-amount">${lifetimePrice} €<span class="mkt-price-per"> une fois</span></div>
                <div class="mkt-price-plan">Accès permanent</div>
                <a class="mkt-btn-lifetime" href="${lifetimeUrl}" target="_blank" rel="noopener noreferrer">
                    Acheter à vie →
                </a>
            </div>` : ''}
        </div>

        <div class="mkt-trial-zone">
            ${trialAvail ? `
            <button class="mkt-btn-try" id="mkt-btn-try">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                     style="width:13px;height:13px;flex-shrink:0">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Essayer gratuitement — 1 génération offerte
            </button>` : isArtefact ? '' : `
            <div class="mkt-trial-used">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                     style="width:13px;height:13px;flex-shrink:0">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Essai déjà utilisé — Débloquez pour un accès illimité
            </div>`}
        </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => requestAnimationFrame(() => {
        backdrop.classList.add('mkt-open');
        modal.classList.add('mkt-open');
    }));

    const _close = () => {
        backdrop.classList.remove('mkt-open');
        modal.classList.remove('mkt-open');
        document.body.style.overflow = '';
        setTimeout(() => { backdrop.remove(); modal.remove(); }, 300);
    };

    modal.querySelector('.mkt-close').addEventListener('click', _close);
    backdrop.addEventListener('click', _close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _close(); }, { once: true });

    modal.querySelector('#mkt-btn-try')?.addEventListener('click', () => {
        _startTrial(item.id);
        _close();
        setTimeout(() => openTool(item.id, { trial: true }), 320);
    });
}

function _openRestorePanel(padsEl, triggerBtn) {
    document.querySelector('.restore-panel')?.remove();

    // Recalcule toujours la liste fraîche à l'ouverture
    const hiddenTools = TOOLS.filter(t => isPadHidden(t.id));
    if (hiddenTools.length === 0) return;

    const panel = document.createElement('div');
    panel.className = 'restore-panel';
    panel.innerHTML = `
        <div class="restore-panel-hd">Outils masqués</div>
        ${hiddenTools.map(t => `
            <div class="restore-item" data-id="${t.id}">
                <div class="restore-item-icon">${ICONS[t.icon] || ICONS['zap']}</div>
                <div class="restore-item-name">${getUserLabel(t.id) || t.name}</div>
                <button class="restore-item-btn" data-id="${t.id}">Restaurer</button>
            </div>
        `).join('')}
    `;

    const rect = triggerBtn.getBoundingClientRect();
    panel.style.top  = (rect.bottom + window.scrollY + 8) + 'px';
    panel.style.left = rect.left + 'px';
    document.body.appendChild(panel);

    panel.querySelectorAll('.restore-item-btn').forEach(b => {
        b.addEventListener('click', () => {
            restorePad(b.dataset.id);
            panel.remove();
            renderDashboard(); // re-render avec le pad restauré (met aussi à jour le bouton restore)
        });
    });

    // Dismiss on outside click
    setTimeout(() => {
        document.addEventListener('click', e => {
            if (!panel.contains(e.target) && e.target !== triggerBtn) panel.remove();
        }, { once: true });
    }, 0);
}

// ═══════════════════════════════════════════════════════════════
// MODAL — renderTool
// ═══════════════════════════════════════════════════════════════
let currentPad = null;

export function openTool(padId, opts = {}) {
    // ── Fermer la barre d'édition flottante si active ────────────
    // (évite que Renommer/Masquer/Supprimer restent visibles par-dessus le modal)
    dismissEditMode();

    // ── Garde B2B — outil verrouillé ? ───────────────────────────
    const ownedIds    = getOwnedIds();
    const lifetimeIds = getLifetimeIds();
    const isAccessible = ownedIds === null
        || ownedIds.includes(padId)
        || lifetimeIds.includes(padId)
        || opts.trial
        || _hasTrialLeft(padId);

    if (!isAccessible) {
        const item = [...TOOLS, ...ARTEFACTS].find(x => x.id === padId);
        if (item) _openMarketplaceInfo(item);
        return;
    }

    // Résoudre NOMEN-K (O-IMM-001) ou padKey (A1) → pad via pads-loader
    const tool = TOOLS.find(t => t.id === padId);
    const key  = tool?.padKey || padId;
    currentPad = getPad(key);
    if (!currentPad) return;

    // DST — message contextuel d'ouverture (P2, 6s)
    const engine = getActiveEngine();
    setKeystoneStatus(
        `Préparation du moteur ${engine} pour ${currentPad.title}…`,
        'info', 6000, 2
    );

    // Pastille IA dynamique → moteur recommandé du pad
    updateEngineChip(currentPad.ai_optimized + ' ✦');

    _buildModal(currentPad, tool);

    const _modal = document.getElementById('tool-modal');
    if (_modal) {
        _modal.setAttribute('data-palette', getToolPalette(padId));
        _modal.classList.add('open');
    }
    document.getElementById('tool-backdrop')?.classList.add('open');
    document.body.style.overflow = 'hidden';
}

export function closeTool() {
    document.getElementById('tool-modal')?.classList.remove('open');
    document.getElementById('tool-backdrop')?.classList.remove('open');
    document.body.style.overflow = '';
    updateEngineChip(getActiveEngine());
    currentPad = null;
    // Reset état typewriter pour la prochaine ouverture
    _promptWasReady = false;
    if (_promptTWTimer)  { clearTimeout(_promptTWTimer);  _promptTWTimer  = null; }
    if (_promptDebounce) { clearTimeout(_promptDebounce); _promptDebounce = null; }
}

const _CAT_LABELS = { IMM:'IMMOBILIER', MKT:'MARKETING', ANL:'ANALYSE', ADM:'ADMIN' };

/** Convertit "1. Texte\n2. Texte" en liste HTML avec tirets dorés */
function _renderNotice(text) {
    if (!text) return '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const items = lines.map(line => {
        // Retire le préfixe numéroté "1. " ou "• "
        const clean = line.replace(/^\d+\.\s*/, '').replace(/^[•–-]\s*/, '');
        return `<li class="notice-item">${clean}</li>`;
    });
    return `<ul class="notice-list">${items.join('')}</ul>`;
}

function _buildModal(pad, tool) {
    const inner = document.getElementById('modal-inner');
    if (!inner) return;

    // ── Artefacts → rendu spécialisé ───────────────────────────
    if (pad.type === 'artifact') { _buildArtifactModal(inner, pad, tool); return; }

    const fieldsHTML = pad.fields.map(_buildField).join('');
    const engine     = getActiveEngine();
    const apiKey     = loadKey(ENGINE_TO_PROVIDER[engine] || 'anthropic');
    const hasKey     = !!apiKey;

    // Le bouton Générer est disabled d'entrée — activé par _updatePromptPreview
    const requiredCount = pad.fields.filter(f => f.required).length;
    const generateBtn = hasKey
        ? `<button class="btn-generate" id="btn-generate" ${requiredCount > 0 ? 'disabled' : ''}>
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
               Générer avec ${engine}
           </button>`
        : `<button class="no-api-hint" id="no-api-link" type="button">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
               Configurer une clé API pour générer directement
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0;opacity:.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
           </button>`;

    // Résoudre le label de catégorie depuis le NOMEN-K id (ex: O-IMM-001 → IMMOBILIER)
    const _nomenId  = tool?.id  || pad.id;
    const _catCode  = _nomenId.split('-')[1] || '';
    const _catLabel = _CAT_LABELS[_catCode] || _catCode;

    inner.innerHTML = `
        <div class="modal-handle"></div>

        <div class="modal-head">
            <div class="modal-ico">${ICONS[pad.icon] || ICONS['zap']}</div>
            <div class="modal-meta">
                <div class="modal-code">${_nomenId} — ${_catLabel}</div>
                <div class="modal-title">${pad.title}</div>
                <div class="modal-subtitle">${pad.subtitle}</div>
                <div class="modal-engine-chip">
                    <div class="modal-engine-dot"></div>
                    Recommandé : <strong>${pad.ai_optimized}</strong>
                </div>
            </div>
            <div class="modal-rating">
                <div class="modal-rating-lbl">Note</div>
                <div class="modal-rating-stars" id="modal-rating-stars">
                    <span class="rating-star" data-v="1">★</span>
                    <span class="rating-star" data-v="2">★</span>
                    <span class="rating-star" data-v="3">★</span>
                    <span class="rating-star" data-v="4">★</span>
                    <span class="rating-star" data-v="5">★</span>
                </div>
            </div>
            <button class="modal-close" id="modal-close-btn" aria-label="Fermer">✕</button>
        </div>

        <div class="modal-body">

            <!-- FORMULAIRE (gauche) -->
            <div class="modal-form">
                <form id="tool-form" class="form-grid" onsubmit="return false">
                    ${fieldsHTML}
                </form>
                ${generateBtn}
            </div>

            <!-- ZONE DROITE : Prompt live + Actions + Notice + IA -->
            <div class="modal-result-zone">

                <div class="result-lbl" id="result-lbl">Prompt généré</div>

                <!-- État vide — visible tant que les champs requis ne sont pas remplis -->
                <div class="prompt-empty-state" id="prompt-empty-state">
                    <div class="prompt-empty-cursor"></div>
                    <div class="prompt-empty-hint" id="prompt-empty-hint">
                        Remplissez les champs requis<br>pour générer votre prompt
                    </div>
                    <div class="prompt-missing-fields" id="prompt-missing-fields"></div>
                </div>

                <pre class="prompt-text" id="prompt-text" style="display:none"></pre>

                <div class="result-actions">
                    <button class="action-btn" id="btn-copy-prompt" title="Copier le prompt">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        Copier le prompt
                    </button>
                    <button class="action-btn" id="btn-library" title="Sauvegarder dans la bibliothèque">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        Bibliothèque
                    </button>
                    <button class="action-btn" id="btn-notice" title="Notice d'utilisation">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2"/></svg>
                        Notice
                    </button>
                </div>

                <div class="tool-notice" id="tool-notice">${_renderNotice(pad.notice)}</div>

                ${hasKey ? `
                <div class="ai-divider">
                    <div class="ai-divider-line"></div>
                    <div class="ai-divider-lbl">Réponse IA</div>
                    <div class="ai-divider-line"></div>
                </div>
                <div class="result-content" id="result-content"></div>
                <button class="btn-copy" id="btn-copy">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Copier la réponse
                </button>` : ''}

            </div>
        </div>
    `;

    // Notation — clé stable = NOMEN-K id (invariant quel que soit padKey ou tool)
    const _ratingKey  = 'ks_rating_' + (pad.id || pad.padKey);
    const savedRating = parseInt(localStorage.getItem(_ratingKey) || '0', 10);
    const starsEl     = document.getElementById('modal-rating-stars');
    if (starsEl) {
        const stars = starsEl.querySelectorAll('.rating-star');
        stars.forEach(s => s.classList.toggle('on', parseInt(s.dataset.v, 10) <= savedRating));
        starsEl.addEventListener('click', e => {
            const star = e.target.closest('.rating-star');
            if (!star) return;
            e.stopPropagation();
            const val = parseInt(star.dataset.v, 10);
            localStorage.setItem(_ratingKey, val);
            stars.forEach(s => s.classList.toggle('on', parseInt(s.dataset.v, 10) <= val));
            // Sync cloud (cross-device)
            import('./vault.js').then(m => m.scheduleAutoSave?.()).catch(() => {});
        });
    }

    // Wire-up fermeture + génération IA
    document.getElementById('modal-close-btn')?.addEventListener('click', closeTool);
    if (hasKey) {
        document.getElementById('btn-generate')?.addEventListener('click', () => _handleGenerate(pad));
        document.getElementById('btn-copy')?.addEventListener('click', _copyResult);
    }

    // Prompt live — écoute tous les champs du formulaire
    // data-dirty : marque un champ comme "touché" pour activer le highlight si vide
    const toolForm = document.getElementById('tool-form');
    toolForm?.addEventListener('input', e => {
        e.target.dataset.dirty = '1';
        _updatePromptPreview(pad);
    });
    toolForm?.addEventListener('change', e => {
        e.target.dataset.dirty = '1';
        _updatePromptPreview(pad);
    });

    // 📋 Copier le prompt
    document.getElementById('btn-copy-prompt')?.addEventListener('click', () => {
        const prompt = document.getElementById('prompt-text')?.textContent || '';
        navigator.clipboard.writeText(prompt).then(() => {
            const btn = document.getElementById('btn-copy-prompt');
            if (!btn) return;
            const orig = btn.textContent;
            btn.textContent = '✓ Copié !';
            btn.classList.add('active');
            setTimeout(() => { btn.textContent = orig; btn.classList.remove('active'); }, 2000);
        });
    });

    // 📚 Bibliothèque
    document.getElementById('btn-library')?.addEventListener('click', () => {
        const prompt = document.getElementById('prompt-text')?.textContent || '';
        _saveToLibrary(pad, prompt);
        const btn = document.getElementById('btn-library');
        if (!btn) return;
        const orig = btn.textContent;
        btn.textContent = '✓ Sauvegardé !';
        btn.classList.add('active');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('active'); }, 2000);
    });

    // 🔑 No-API hint → ouvre directement l'accordéon Clés API dans Settings
    document.getElementById('no-api-link')?.addEventListener('click', () => {
        closeTool();
        setTimeout(() => openSettingsTo('acc-api'), 120);
    });

    // ℹ️ Notice toggle
    document.getElementById('btn-notice')?.addEventListener('click', () => {
        const noticeEl = document.getElementById('tool-notice');
        const noticeBtn = document.getElementById('btn-notice');
        noticeEl?.classList.toggle('open');
        noticeBtn?.classList.toggle('active');
    });

    // Premier rendu du prompt
    _updatePromptPreview(pad);
}

// ═══════════════════════════════════════════════════════════════
// MODAL — Artefact (Sprint 3)
// ═══════════════════════════════════════════════════════════════
function _buildArtifactModal(inner, pad, tool) {
    const engine    = getActiveEngine();
    const apiKey    = loadKey(ENGINE_TO_PROVIDER[engine] || 'anthropic');
    const hasKey    = !!apiKey;

    const _nomenId  = tool?.id  || pad.id;
    const _catCode  = _nomenId.split('-')[1] || '';
    const _catLabel = _CAT_LABELS[_catCode] || _catCode;

    // Prévisualisation des composants attendus
    const schema     = pad.artifact_config?.output_schema || {};
    const schemaKeys = Object.entries(schema);
    const chipPreview = schemaKeys.length
        ? schemaKeys.map(([, def]) =>
            `<span class="artifact-schema-chip">${COMP_ICONS[def.component] || '◈'} ${def.label}</span>`
          ).join('')
        : '<span style="color:var(--text-muted);font-size:11px">Aucun composant défini</span>';

    const generateBtn = hasKey
        ? `<button class="btn-generate" id="btn-generate">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
               Générer l'artefact
           </button>`
        : `<button class="no-api-hint" id="no-api-link" type="button">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
               Configurer une clé API pour générer
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0;opacity:.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
           </button>`;

    inner.innerHTML = `
        <div class="modal-handle"></div>

        <div class="modal-head">
            <div class="modal-ico">${ICONS[pad.icon] || ICONS['zap']}</div>
            <div class="modal-meta">
                <div class="modal-code">${_nomenId} — ${_catLabel}</div>
                <div class="modal-title">${pad.title}</div>
                <div class="modal-subtitle">${pad.subtitle}</div>
                <div class="modal-engine-chip">
                    <div class="modal-engine-dot" style="background:#6496ff"></div>
                    Artefact JSON · <strong>${pad.ai_optimized}</strong>
                </div>
            </div>
            <div class="modal-rating">
                <div class="modal-rating-lbl">Note</div>
                <div class="modal-rating-stars" id="modal-rating-stars">
                    <span class="rating-star" data-v="1">★</span>
                    <span class="rating-star" data-v="2">★</span>
                    <span class="rating-star" data-v="3">★</span>
                    <span class="rating-star" data-v="4">★</span>
                    <span class="rating-star" data-v="5">★</span>
                </div>
            </div>
            <button class="modal-close" id="modal-close-btn" aria-label="Fermer">✕</button>
        </div>

        <div class="modal-body">

            <!-- GAUCHE : contexte + bouton génération -->
            <div class="modal-form">
                ${pad.notice ? `<div class="tool-notice open">${_renderNotice(pad.notice)}</div>` : ''}
                <div class="artifact-compose-zone">
                    <div class="artifact-compose-label">
                        <span style="color:#6496ff;font-size:13px">◈</span>
                        Composants attendus
                    </div>
                    <div class="artifact-schema-chips">${chipPreview}</div>
                </div>
                <div class="form-field full" style="margin-bottom:0">
                    <label class="form-label" style="font-size:11px;letter-spacing:.04em;color:var(--text-muted)">
                        Contexte additionnel <span style="font-weight:400;text-transform:none">(optionnel)</span>
                    </label>
                    <textarea id="artifact-context" class="form-textarea"
                              placeholder="Adresse, superficie, budget, données spécifiques à injecter…"
                              style="min-height:110px;resize:vertical"></textarea>
                </div>
                ${generateBtn}
            </div>

            <!-- DROITE : zone rendu composants -->
            <div class="modal-result-zone">
                <div class="result-lbl" id="result-lbl">Résultat de l'artefact</div>

                <div class="artifact-empty-state" id="artifact-empty-state">
                    <div class="artifact-empty-icon">🔷</div>
                    <p>Appuyez sur <strong>"Générer l'artefact"</strong><br>pour lancer l'analyse IA</p>
                </div>

                <div id="artifact-result" style="display:none"></div>

                <div class="result-actions" id="artifact-actions" style="display:none">
                    <button class="action-btn" id="btn-artifact-copy-json">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        Copier JSON brut
                    </button>
                    <button class="action-btn action-btn--gold" id="btn-artifact-pdf">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        Exporter PDF
                    </button>
                </div>
            </div>
        </div>
    `;

    // ── Étoiles de notation ──────────────────────────────────────
    const _ratingKey  = 'ks_rating_' + (pad.id || pad.padKey);
    const savedRating = parseInt(localStorage.getItem(_ratingKey) || '0', 10);
    const starsEl     = document.getElementById('modal-rating-stars');
    if (starsEl) {
        starsEl.querySelectorAll('.rating-star').forEach(s =>
            s.classList.toggle('on', parseInt(s.dataset.v, 10) <= savedRating)
        );
        starsEl.addEventListener('click', e => {
            const star = e.target.closest('.rating-star');
            if (!star) return;
            e.stopPropagation();
            const val = parseInt(star.dataset.v, 10);
            localStorage.setItem(_ratingKey, val);
            starsEl.querySelectorAll('.rating-star').forEach(s =>
                s.classList.toggle('on', parseInt(s.dataset.v, 10) <= val)
            );
            // Sync cloud (cross-device)
            import('./vault.js').then(m => m.scheduleAutoSave?.()).catch(() => {});
        });
    }

    // ── Fermeture ────────────────────────────────────────────────
    document.getElementById('modal-close-btn')?.addEventListener('click', closeTool);

    // ── Génération ───────────────────────────────────────────────
    if (hasKey) {
        document.getElementById('btn-generate')?.addEventListener('click', () => _handleGenerate(pad));
    } else {
        document.getElementById('no-api-link')?.addEventListener('click', () => {
            closeTool();
            setTimeout(() => openSettingsTo('acc-api'), 120);
        });
    }

    // ── Copier JSON brut ─────────────────────────────────────────
    document.getElementById('btn-artifact-copy-json')?.addEventListener('click', () => {
        const raw = document.getElementById('artifact-result')?.dataset.rawJson || '';
        navigator.clipboard.writeText(raw).then(() => {
            const btn = document.getElementById('btn-artifact-copy-json');
            if (!btn) return;
            const orig = btn.textContent;
            btn.textContent = '✓ Copié !';
            btn.classList.add('active');
            setTimeout(() => { btn.textContent = orig; btn.classList.remove('active'); }, 2000);
        });
    });

    // ── Exporter PDF ─────────────────────────────────────────────
    document.getElementById('btn-artifact-pdf')?.addEventListener('click', () => {
        const raw = document.getElementById('artifact-result')?.dataset.rawJson || '';
        if (!raw) return;
        exportArtifactPDF(pad, raw);
    });
}

function _buildField(f) {
    const spanCls = f.span === 'full' ? ' full' : '';
    const req     = f.required ? ' <span class="req">*</span>' : '';
    let input = '';

    if (f.type === 'select') {
        const opts = (f.options || []).map(o => `<option value="${o}">${o}</option>`).join('');
        input = `<select class="form-select" id="f-${f.id}" name="${f.id}">${opts}</select>`;
    } else if (f.type === 'textarea') {
        input = `<textarea class="form-textarea" id="f-${f.id}" name="${f.id}" placeholder="${f.placeholder || ''}"></textarea>`;
    } else {
        input = `<input class="form-input" type="${f.type}" id="f-${f.id}" name="${f.id}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''}>`;
    }

    return `
        <div class="form-field${spanCls}">
            <label class="form-label" for="f-${f.id}">${f.label}${req}</label>
            ${input}
        </div>
    `;
}

// ── État de suivi pour la transition empty → ready ────────────
let _promptWasReady  = false;
let _promptTWTimer   = null;   // typewriter character timer
let _promptDebounce  = null;   // debounce pour les updates post-ready

function _updatePromptPreview(pad) {
    const form         = document.getElementById('tool-form');
    const preview      = document.getElementById('prompt-text');
    const emptyState   = document.getElementById('prompt-empty-state');
    const missingEl    = document.getElementById('prompt-missing-fields');
    const resultLbl    = document.getElementById('result-lbl');
    const generateBtn  = document.getElementById('btn-generate');
    if (!form || !preview) return;

    // Collecte des valeurs
    const formData = {};
    form.querySelectorAll('[name]').forEach(el => { formData[el.name] = el.value.trim(); });

    // Champs requis manquants
    const requiredFields = pad.fields.filter(f => f.required);
    const missingFields  = requiredFields.filter(f => !formData[f.id]);
    const requiredFilled = missingFields.length === 0;

    // ── Mise à jour visuelle des champs manquants ──────────────
    // Retirer les anciens highlights
    form.querySelectorAll('.field-missing').forEach(el => el.classList.remove('field-missing'));

    if (!requiredFilled) {
        // Highlight les champs non remplis
        missingFields.forEach(f => {
            const el = form.querySelector(`[name="${f.id}"]`);
            // On n'ajoute le highlight que si l'utilisateur a déjà interagi (dirty)
            if (el && el.dataset.dirty) el.classList.add('field-missing');
        });

        // Mettre à jour la liste des champs manquants dans l'empty state
        if (missingEl) {
            const remaining = missingFields.length;
            missingEl.innerHTML = remaining === requiredFields.length
                ? '' // Pas encore commencé — message générique suffit
                : missingFields.map(f =>
                    `<span class="missing-chip">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:9px;height:9px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        ${f.label}
                    </span>`
                ).join('');
        }

        // Masquer le prompt, désactiver Générer
        if (_promptTWTimer) { clearTimeout(_promptTWTimer); _promptTWTimer = null; }
        preview.style.display = 'none';
        emptyState && (emptyState.style.display = '');
        if (resultLbl) resultLbl.classList.remove('result-lbl-ready');
        if (generateBtn) generateBtn.disabled = true;
        _promptWasReady = false;
        return;
    }

    // ── Tous les champs requis sont remplis ─────────────────────
    if (missingEl) missingEl.innerHTML = '';
    emptyState && (emptyState.style.display = 'none');
    preview.style.display = '';
    if (resultLbl) resultLbl.classList.add('result-lbl-ready');
    if (generateBtn) generateBtn.disabled = false; // Activer le bouton Générer

    const newPrompt = _interpolate(pad.system_prompt, formData);

    if (!_promptWasReady) {
        _promptWasReady = true;
        _typewriterPrompt(preview, newPrompt);
    } else {
        clearTimeout(_promptDebounce);
        _promptDebounce = setTimeout(() => {
            if (preview.textContent !== newPrompt) {
                const diff = Math.abs(newPrompt.length - preview.textContent.length);
                if (diff > 40) {
                    _typewriterPrompt(preview, newPrompt, true);
                } else {
                    preview.textContent = newPrompt;
                }
            }
        }, 180);
    }
}

// ── Typewriter pour le prompt (zone gauche) ───────────────────
function _typewriterPrompt(el, text, fast = false) {
    if (_promptTWTimer) { clearTimeout(_promptTWTimer); _promptTWTimer = null; }
    el.textContent = '';
    el.classList.add('prompt-typing');

    let i = 0;
    // Vitesse : rapide si le texte est long ou si on est déjà en mode "ready"
    const charDelay = fast ? 4 : (text.length > 500 ? 8 : 16);

    const tick = () => {
        if (i < text.length) {
            el.textContent += text[i++];
            el.scrollTop    = el.scrollHeight;
            _promptTWTimer  = setTimeout(tick, charDelay);
        } else {
            el.classList.remove('prompt-typing');
            _promptTWTimer = null;
        }
    };
    tick();
}

function _saveToLibrary(pad, prompt) {
    if (!prompt || prompt.startsWith('Remplissez')) return;
    const lib = JSON.parse(localStorage.getItem('ks_library') || '[]');
    lib.unshift({ id: pad.id, title: pad.title, prompt, date: new Date().toISOString() });
    if (lib.length > 50) lib.splice(50);
    localStorage.setItem('ks_library', JSON.stringify(lib));
    _refreshPromptsBadge();
}

async function _handleGenerate(pad) {
    const isArtifact = pad.type === 'artifact';
    const engine     = getActiveEngine();
    const apiKey     = loadKey(ENGINE_TO_PROVIDER[engine] || 'anthropic');
    const btn        = document.getElementById('btn-generate');

    // ── Construction du prompt ───────────────────────────────────
    // Résolution de la clé de prompt : on essaie l'ID court (ex: 'claude', 'gpt4o')
    // puis le label complet (ex: 'Claude', 'ChatGPT') pour compatibilité ascendante.
    const engineId   = ENGINE_LABEL_TO_ID[engine] || engine.toLowerCase();
    const enginePrompt = (p) =>
        p?.engines?.prompts?.[engineId] || p?.engines?.prompts?.[engine] || p?.system_prompt || '';

    let prompt;
    if (isArtifact) {
        const preamble     = pad.artifact_config?.json_preamble || '';
        const instructions = enginePrompt(pad);
        const extraContext = document.getElementById('artifact-context')?.value?.trim() || '';
        prompt = preamble
            + (instructions ? '\n\n' + instructions : '')
            + (extraContext  ? '\n\nContexte additionnel :\n' + extraContext : '');
    } else {
        const form     = document.getElementById('tool-form');
        const formData = {};
        form?.querySelectorAll('[name]').forEach(el => { formData[el.name] = el.value.trim(); });
        prompt = _interpolate(enginePrompt(pad), formData);
    }

    // ── Refs UI selon le mode ────────────────────────────────────
    const contentEl      = isArtifact ? null : document.getElementById('result-content');
    const artifactResult = isArtifact ? document.getElementById('artifact-result')      : null;
    const emptyState     = isArtifact ? document.getElementById('artifact-empty-state') : null;
    const copyBtn        = isArtifact ? null : document.getElementById('btn-copy');
    const resultLbl      = document.getElementById('result-lbl');

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Génération en cours…';

    if (contentEl) { contentEl.className = 'result-content show'; contentEl.textContent = ''; }
    if (copyBtn)   copyBtn.style.display = 'none';

    setKeystoneStatus(`Génération en cours avec ${engine}…`, 'info', 0, 2);

    try {
        const result = await ApiHandler.callEngine(engine, prompt, apiKey);

        if (isArtifact) {
            // ── Rendu composants ─────────────────────────────────
            if (emptyState) emptyState.style.display = 'none';
            if (resultLbl)  resultLbl.textContent = 'Résultat de l\'artefact';
            artifactResult.style.display = 'block';
            artifactResult.dataset.rawJson = result; // pour le bouton "Copier JSON"
            renderArtifactResult(artifactResult, result, pad.artifact_config?.output_schema || {});
            const actions = document.getElementById('artifact-actions');
            if (actions) actions.style.display = 'flex';
        } else {
            // ── Rendu texte ──────────────────────────────────────
            _typewriter(contentEl, result);
        }

        setKeystoneStatus(`${pad.title} — Réponse générée avec succès.`, 'info', 5000, 2);

    } catch (err) {
        if (isArtifact) {
            if (emptyState) emptyState.style.display = 'none';
            artifactResult.style.display = 'block';
            artifactResult.innerHTML = `<div class="artifact-error"><span class="artifact-error-icon">❌</span> ${err.message}</div>`;
        } else {
            contentEl.textContent = `❌  Erreur : ${err.message}`;
        }
        setKeystoneStatus(`Erreur de génération : ${err.message}`, 'alert', 6000, 2);

    } finally {
        btn.disabled = false;
        btn.innerHTML = isArtifact
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Régénérer l'artefact`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Générer avec ${engine}`;
        if (copyBtn) copyBtn.style.display = 'flex';
    }
}

function _interpolate(template, data) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || `[${key}]`);
}

function _typewriter(el, text) {
    el.textContent = '';
    let i = 0;
    const delay = text.length > 600 ? 6 : 14;
    const tick = () => {
        if (i < text.length) {
            el.textContent += text[i++];
            el.scrollTop = el.scrollHeight;
            setTimeout(tick, delay);
        }
    };
    tick();
}

function _copyResult() {
    const text = document.getElementById('result-content')?.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btn-copy');
        if (!btn) return;
        btn.textContent = '✓ Copié !';
        setTimeout(() => {
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier`;
        }, 2000);
    });
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS PANEL
// ═══════════════════════════════════════════════════════════════
// ── Icônes SVG des sections accordéon ────────────────────────
const ACC_ICONS = {
    api:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`,
    engine:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    user:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    licence: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    doc:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    rgpd:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    lock:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    usb:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M12 2v8M8 6l4-4 4 4M8 10h8a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z"/><circle cx="12" cy="20" r="2"/><line x1="12" y1="16" x2="12" y2="18"/></svg>`,
    support: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
};

// ── Rendu du logo IA — variantes dark / light ─────────────────
function _engineLogoHTML(p, size = 20) {
    if (!p.logo) {
        const letter = p.label ? p.label.charAt(0) : '?';
        return `<span style="width:${size}px;height:${size}px;border-radius:4px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.2);display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;color:var(--gold);letter-spacing:-.02em;">${letter}</span>`;
    }
    const lightImg = p.logoLight
        ? `<img src="${p.logoLight}" alt="${p.label}" class="engine-logo-img engine-logo-light" style="width:${size}px;height:${size}px;object-fit:contain;">`
        : '';
    return `<img src="${p.logo}" alt="${p.label}" class="engine-logo-img engine-logo-dark" style="width:${size}px;height:${size}px;object-fit:contain;">${lightImg}`;
}

function _renderSettingsBody() {
    const body = document.getElementById('sp-body');
    if (!body) return;

    const activeEngine = getActiveEngine();

    const apiRows = API_PROVIDERS.map(p => {
        const saved = loadKey(p.id);
        const cls   = saved ? 'saved' : 'empty';
        const lbl   = saved ? 'Configurée' : 'Vide';
        return `
            <div class="api-key-row" id="row-${p.id}">
                <div class="api-key-header">
                    <div class="api-key-icon">${_engineLogoHTML(p, 18)}</div>
                    <div class="api-key-name">${p.name} <span style="color:var(--tx3);font-weight:500;font-size:10px;">${p.label}</span></div>
                    <div class="api-key-status ${cls}" id="status-${p.id}">${lbl}</div>
                </div>
                <div class="api-key-input-row">
                    <input class="api-key-input" id="input-${p.id}" type="password"
                        placeholder="${p.placeholder}" value="${saved}"
                        autocomplete="off" spellcheck="false"/>
                    <button class="api-key-save-btn" data-provider="${p.id}">Sauver</button>
                </div>
            </div>`;
    }).join('');

    const engineItems = API_PROVIDERS.map(p => `
        <div class="engine-select-item ${activeEngine === p.label ? 'active' : ''}" data-engine="${p.label}">
            <div class="engine-select-icon">${_engineLogoHTML(p, 18)}</div>
            <div class="engine-select-info">
                <div class="engine-select-name">${p.label}</div>
                <div class="engine-select-sub">${p.name}</div>
            </div>
            <div class="engine-select-chk">✓</div>
        </div>`).join('');

    const savedPhoto      = localStorage.getItem(LS_USER_PHOTO) || '';
    const savedName       = localStorage.getItem(LS_USER_NAME)  || '';
    const savedLicenceKey = localStorage.getItem('ks_licence_key') || '';
    const lockEnabled     = localStorage.getItem('ks_lock_enabled') !== 'false';
    const lockDelay       = localStorage.getItem('ks_lock_delay')   || '300000';
    const lockStyle       = localStorage.getItem('ks_lock_style')   || 'abyss';
    const previewHTML     = savedPhoto
        ? `<img src="${savedPhoto}" alt="Photo">`
        : `<span class="sp-user-photo-preview-empty">👤</span>`;

    // Sections accordéon — icônes SVG outline
    const SECTIONS = [
        {
            id: 'acc-api', icon: ACC_ICONS.api, title: 'Clés API — Moteurs',
            open: false,
            content: apiRows,
        },
        {
            id: 'acc-engine', icon: ACC_ICONS.engine, title: 'Moteur actif',
            open: false,
            content: `<div class="engine-select-wrap" id="engine-select">${engineItems}</div>`,
        },
        {
            id: 'acc-user', icon: ACC_ICONS.user, title: 'Utilisateur',
            open: false,
            content: `<div class="sp-user-form">
                <div class="sp-user-row">
                    <label class="sp-user-label" for="user-name-input">Prénom affiché</label>
                    <input class="sp-user-input" id="user-name-input" type="text" placeholder="Ex : Stéphane" value="${savedName}">
                </div>
                <div class="sp-user-row">
                    <label class="sp-user-label">Photo / Logo</label>
                    <div class="sp-user-photo-wrap">
                        <div class="sp-user-photo-row">
                            <div class="sp-user-photo-preview" id="user-photo-preview">${previewHTML}</div>
                            <div style="display:flex;flex-direction:column;gap:6px;">
                                <label class="sp-user-upload-btn" for="user-photo-file">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                    Uploader
                                    <input type="file" id="user-photo-file" accept="image/*" style="display:none">
                                </label>
                                <button class="sp-user-remove-btn" id="user-photo-remove">Supprimer</button>
                            </div>
                        </div>
                        <div class="sp-user-or-sep">ou entrer une URL :</div>
                        <input class="sp-user-input" id="user-photo-input" type="url" placeholder="https://exemple.com/logo.jpg" value="${savedPhoto.startsWith('data:') ? '' : savedPhoto}">
                    </div>
                </div>
                <div class="sp-user-hint">Modifications appliquées en temps réel sur le Dashboard.</div>
            </div>`,
        },
        {
            id: 'acc-lock', icon: ACC_ICONS.lock, title: 'Écran de veille',
            open: false,
            content: `<div class="sp-user-form">
                <div class="sp-user-row sp-row-toggle">
                    <label class="sp-user-label" for="lock-enabled-toggle">Veille automatique</label>
                    <label class="sp-toggle-wrap">
                        <input type="checkbox" id="lock-enabled-toggle" ${lockEnabled ? 'checked' : ''}>
                        <span class="sp-toggle-track"><span class="sp-toggle-thumb"></span></span>
                    </label>
                </div>
                <div class="sp-user-row">
                    <label class="sp-user-label" for="lock-delay-select">Délai avant veille</label>
                    <select class="sp-user-input sp-select" id="lock-delay-select" ${!lockEnabled ? 'disabled' : ''}>
                        <option value="60000"   ${lockDelay === '60000'   ? 'selected' : ''}>1 minute</option>
                        <option value="300000"  ${lockDelay === '300000'  ? 'selected' : ''}>5 minutes</option>
                        <option value="600000"  ${lockDelay === '600000'  ? 'selected' : ''}>10 minutes</option>
                        <option value="1800000" ${lockDelay === '1800000' ? 'selected' : ''}>30 minutes</option>
                        <option value="0"       ${lockDelay === '0'       ? 'selected' : ''}>Jamais</option>
                    </select>
                </div>
                <div class="sp-user-row" style="flex-direction:column;align-items:flex-start;gap:10px;">
                    <label class="sp-user-label">Ambiance visuelle</label>
                    <div class="sp-theme-grid" id="lock-style-chips">
                        <button class="sp-theme-card${lockStyle === 'abyss'        ? ' active' : ''}" data-style="abyss">
                            <div class="sp-theme-preview sp-theme-abyss"></div>
                            <div class="sp-theme-name">Abyss</div>
                        </button>
                        <button class="sp-theme-card${lockStyle === 'golden-flow'  ? ' active' : ''}" data-style="golden-flow">
                            <div class="sp-theme-preview sp-theme-golden-flow"></div>
                            <div class="sp-theme-name">Golden Flow</div>
                        </button>
                        <button class="sp-theme-card${lockStyle === 'nebula'       ? ' active' : ''}" data-style="nebula">
                            <div class="sp-theme-preview sp-theme-nebula"></div>
                            <div class="sp-theme-name">Nebula</div>
                        </button>
                        <button class="sp-theme-card${lockStyle === 'obsidian'     ? ' active' : ''}" data-style="obsidian">
                            <div class="sp-theme-preview sp-theme-obsidian"></div>
                            <div class="sp-theme-name">Obsidian</div>
                        </button>
                    </div>
                </div>
                <div class="sp-user-hint">L'écran de veille se déclenche après une période d'inactivité. Cliquez ou appuyez sur Échap pour déverrouiller.</div>
            </div>`,
        },
        {
            id: 'acc-licence', icon: ACC_ICONS.licence, title: 'Ma Licence',
            open: false,
            content: (() => {
                const lic = getLicenceStatus();
                const statusBadge = lic.active
                    ? `<span class="sp-badge-green">Active · ${lic.plan}</span>`
                    : `<span class="sp-badge-warn">Non activée</span>`;
                const toolBadge = lic.active
                    ? `<span class="sp-badge-gold">${lic.toolCount} outil${lic.toolCount !== 1 ? 's' : ''}</span>`
                    : `<span class="sp-badge-dim">—</span>`;
                return `<div class="sp-user-form">
                    <div class="sp-row">
                        <div class="sp-row-left">
                            <div class="sp-row-key">Statut</div>
                        </div>
                        <span id="lic-status-badge">${statusBadge}</span>
                    </div>
                    <div class="sp-row">
                        <div class="sp-row-left">
                            <div class="sp-row-key">Outils débloqués</div>
                        </div>
                        <span id="lic-tools-badge">${toolBadge}</span>
                    </div>
                    ${lic.owner ? `<div class="sp-row"><div class="sp-row-left"><div class="sp-row-key">Titulaire</div><div class="sp-row-val" id="lic-owner">${lic.owner}</div></div></div>` : ''}
                    <div class="sp-row"><div class="sp-row-left"><div class="sp-row-key">Éditeur</div><div class="sp-row-val">Protein Studio · Ollioules</div></div></div>

                    <div class="sp-user-row" style="margin-top:10px">
                        <label class="sp-user-label" for="licence-key-input">Clé de licence</label>
                        <div class="sp-input-row">
                            <input class="sp-user-input sp-mono" id="licence-key-input" type="text"
                                placeholder="XXXX-XXXX-XXXX-XXXX" value="${savedLicenceKey}"
                                autocomplete="off" spellcheck="false" maxlength="19">
                            <button class="api-key-save-btn" id="licence-key-save">Activer</button>
                        </div>
                        <div class="sp-user-hint" id="lic-feedback" style="min-height:16px"></div>
                    </div>
                    ${lic.active ? `<button class="sp-danger-btn" id="licence-revoke" style="margin-top:4px">Révoquer la licence</button>` : ''}
                </div>`;
            })(),
        },
        {
            id: 'acc-doc', icon: ACC_ICONS.doc, title: 'Documentation',
            open: false,
            content: `<div class="sp-placeholder">Guide d'utilisation et changelog — disponible prochainement.</div>`,
        },
        {
            id: 'acc-rgpd', icon: ACC_ICONS.rgpd, title: 'RGPD & Données',
            open: false,
            content: `<div class="sp-placeholder">Vos clés API et données de profil sont stockées localement dans votre navigateur (localStorage). Aucune donnée n'est transmise à nos serveurs.</div>`,
        },
        {
            id: 'acc-support', icon: ACC_ICONS.support, title: 'Support',
            open: false,
            content: `
                <div style="display:flex;flex-direction:column;gap:14px;padding:4px 0">
                    <p style="font-size:12px;line-height:1.6;color:var(--tx2);margin:0">
                        Une question, un bug, ou une demande spécifique ? L'équipe Keystone vous répond par e-mail.
                    </p>
                    <a href="mailto:protein.keystone@gmail.com"
                       style="display:inline-flex;align-items:center;gap:10px;padding:10px 16px;
                              background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.22);
                              border-radius:8px;text-decoration:none;color:var(--gold);
                              font-size:12px;font-weight:700;letter-spacing:-.01em;
                              transition:background .18s,border-color .18s"
                       onmouseover="this.style.background='rgba(99,102,241,.15)';this.style.borderColor='rgba(99,102,241,.4)'"
                       onmouseout="this.style.background='rgba(99,102,241,.08)';this.style.borderColor='rgba(99,102,241,.22)'">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        protein.keystone@gmail.com
                    </a>
                    <p style="font-size:10.5px;color:var(--tx3);margin:0;line-height:1.5">
                        Réponse sous 48h (jours ouvrés). Pour les licences PRO &amp; MAX, le support est prioritaire.
                    </p>
                </div>`,
        },
    ];

    body.innerHTML = SECTIONS.map(s => `
        <div class="acc-section" id="${s.id}">
            <button class="acc-header" data-target="${s.id}">
                <span class="acc-icon">${s.icon}</span>
                <span class="acc-title">${s.title}</span>
                <svg class="acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="acc-body ${s.open ? 'open' : ''}">${s.content}</div>
        </div>
    `).join('');

    // Wire accordéons
    body.querySelectorAll('.acc-header').forEach(hdr => {
        hdr.addEventListener('click', () => {
            const section = document.getElementById(hdr.dataset.target);
            const accBody = section?.querySelector('.acc-body');
            const isOpen  = accBody?.classList.contains('open');
            // Fermer tous
            body.querySelectorAll('.acc-body').forEach(b => b.classList.remove('open'));
            body.querySelectorAll('.acc-section').forEach(s => s.classList.remove('open'));
            if (!isOpen) {
                accBody?.classList.add('open');
                section?.classList.add('open');
            }
        });
    });

    // Wire save API keys (dans l'accordéon — guard: skip si pas de data-provider)
    body.querySelectorAll('.api-key-save-btn[data-provider]').forEach(btn => {
        btn.addEventListener('click', () => {
            const pid   = btn.dataset.provider;
            const input = document.getElementById('input-' + pid);
            const stEl  = document.getElementById('status-' + pid);
            const val   = input?.value.trim() || '';
            saveKey(pid, val);
            if (stEl) { stEl.textContent = val ? 'Configurée' : 'Vide'; stEl.className = 'api-key-status ' + (val ? 'saved' : 'empty'); }
            btn.textContent = '✓ Sauvé';
            setTimeout(() => { btn.textContent = 'Sauver'; }, 1500);
            scheduleAutoSave();
        });
    });

    // Wire engine selector
    body.querySelectorAll('.engine-select-item').forEach(item => {
        item.addEventListener('click', () => {
            body.querySelectorAll('.engine-select-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            setActiveEngine(item.dataset.engine);
        });
    });

    // Wire user inputs → mise à jour identity zone en temps réel
    body.querySelector('#user-name-input')?.addEventListener('input', e => {
        const val = e.target.value.trim();
        val ? localStorage.setItem(LS_USER_NAME, val) : localStorage.removeItem(LS_USER_NAME);
        _updateIdentityZone();
    });

    // URL photo
    body.querySelector('#user-photo-input')?.addEventListener('input', e => {
        const val = e.target.value.trim();
        val ? localStorage.setItem(LS_USER_PHOTO, val) : localStorage.removeItem(LS_USER_PHOTO);
        _updateIdentityZone();
        _refreshPhotoPreview();
    });

    // Upload fichier → base64
    body.querySelector('#user-photo-file')?.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const dataUrl = ev.target.result;
            localStorage.setItem(LS_USER_PHOTO, dataUrl);
            _updateIdentityZone();
            _refreshPhotoPreview();
        };
        reader.readAsDataURL(file);
    });

    // Supprimer photo
    body.querySelector('#user-photo-remove')?.addEventListener('click', () => {
        localStorage.removeItem(LS_USER_PHOTO);
        const urlInput = body.querySelector('#user-photo-input');
        if (urlInput) urlInput.value = '';
        _updateIdentityZone();
        _refreshPhotoPreview();
    });

    // ── Veille automatique ─────────────────────────────────────
    body.querySelector('#lock-enabled-toggle')?.addEventListener('change', e => {
        const enabled = e.target.checked;
        localStorage.setItem('ks_lock_enabled', String(enabled));
        const delaySelect = body.querySelector('#lock-delay-select');
        if (delaySelect) delaySelect.disabled = !enabled;
        window.dispatchEvent(new Event('ks-lock-settings-changed'));
    });

    body.querySelector('#lock-delay-select')?.addEventListener('change', e => {
        localStorage.setItem('ks_lock_delay', e.target.value);
        window.dispatchEvent(new Event('ks-lock-settings-changed'));
    });

    body.querySelectorAll('#lock-style-chips .sp-theme-card').forEach(card => {
        card.addEventListener('click', () => {
            body.querySelectorAll('#lock-style-chips .sp-theme-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            localStorage.setItem('ks_lock_style', card.dataset.style);
            window.dispatchEvent(new Event('ks-lock-settings-changed'));
        });
    });

    // ── Activation de licence (Sprint 3) ─────────────────────────
    body.querySelector('#licence-key-save')?.addEventListener('click', async () => {
        const input    = body.querySelector('#licence-key-input');
        const feedback = body.querySelector('#lic-feedback');
        const btn      = body.querySelector('#licence-key-save');
        const val      = input?.value.trim() || '';
        if (!val) return;

        // État chargement
        if (btn) { btn.textContent = '…'; btn.disabled = true; }
        if (feedback) { feedback.textContent = 'Vérification en cours…'; feedback.style.color = 'var(--tx3)'; }

        try {
            const data = await activateLicence(val);

            // Succès
            if (btn) { btn.textContent = '✓'; btn.style.background = 'rgba(45,212,123,.2)'; btn.style.color = '#2dd47b'; }
            if (feedback) {
                feedback.textContent = `✓ Licence ${data.plan} activée — ${
                    data.ownedAssets === null ? 'accès illimité' : `${data.ownedAssets.length} outils débloqués`
                }.`;
                feedback.style.color = '#2dd47b';
            }
            // Mettre à jour les badges dans la vue sans re-render complet des settings
            const statusBadge = body.querySelector('#lic-status-badge');
            const toolsBadge  = body.querySelector('#lic-tools-badge');
            if (statusBadge) statusBadge.innerHTML = `<span class="sp-badge-green">Active · ${data.plan}</span>`;
            if (toolsBadge)  toolsBadge.innerHTML  = `<span class="sp-badge-gold">${
                data.ownedAssets === null ? '∞' : data.ownedAssets.length
            } outils</span>`;

            setTimeout(() => {
                if (btn) { btn.textContent = 'Activer'; btn.disabled = false; btn.style.background = ''; btn.style.color = ''; }
            }, 3000);

        } catch (err) {
            // Échec
            if (btn) { btn.textContent = 'Activer'; btn.disabled = false; }
            if (feedback) { feedback.textContent = `✗ ${err.message}`; feedback.style.color = '#f26a4b'; }
        }
    });

    body.querySelector('#licence-revoke')?.addEventListener('click', () => {
        if (!confirm('Révoquer la licence ? Les outils payants seront à nouveau verrouillés.')) return;
        revokeLicence();
        // Fermer les settings et laisser le hot reload gérer l'UI
        document.getElementById('settings-panel')?.classList.remove('open');
    });

    // Auto-save global — déclenché par toute modification de préférence
    const _autoSaveEvents = ['ks-lock-settings-changed'];
    _autoSaveEvents.forEach(ev => window.addEventListener(ev, scheduleAutoSave, { passive: true }));
}

// ── Rafraîchit la preview photo dans les Settings ────────────
function _refreshPhotoPreview() {
    const preview = document.getElementById('user-photo-preview');
    if (!preview) return;
    const photo = localStorage.getItem(LS_USER_PHOTO) || '';
    preview.innerHTML = photo
        ? `<img src="${photo}" alt="Photo">`
        : `<span class="sp-user-photo-preview-empty">👤</span>`;
}

function _openSettings()  {
    document.getElementById('settings-panel')?.classList.add('open');
    document.getElementById('settings-backdrop')?.classList.add('open');
    document.body.style.overflow = 'hidden';
}

/** Ouvre les Settings et déplie un accordéon spécifique (ex: 'acc-api') */
export function openSettingsTo(sectionId) {
    _openSettings();
    // Léger délai pour laisser le panel s'afficher avant de scroller
    requestAnimationFrame(() => {
        const section = document.getElementById(sectionId);
        const accBody = section?.querySelector('.acc-body');
        if (!section || !accBody) return;
        // Fermer tous les autres
        document.querySelectorAll('#settings-panel .acc-body').forEach(b => b.classList.remove('open'));
        document.querySelectorAll('#settings-panel .acc-section').forEach(s => s.classList.remove('open'));
        accBody.classList.add('open');
        section.classList.add('open');
        setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    });
}
function _closeSettings() {
    document.getElementById('settings-panel')?.classList.remove('open');
    document.getElementById('settings-backdrop')?.classList.remove('open');
    document.body.style.overflow = '';
}

export function initSettings() {
    _renderSettingsBody();
    updateEngineChip(getActiveEngine());

    document.getElementById('settings-open-btn')?.addEventListener('click', _openSettings);
    document.getElementById('settings-close-btn')?.addEventListener('click', _closeSettings);
    document.getElementById('settings-backdrop')?.addEventListener('click', _closeSettings);
    document.getElementById('tool-backdrop')?.addEventListener('click', closeTool);

    // ── Esc — commande d'annulation universelle (priorité descendante) ──
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;

        // P0 : lock screen actif → déverrouiller (priorité absolue)
        if (isLocked()) { unlock(); return; }

        // P1 : modal outil ouverte ?
        if (document.getElementById('tool-modal')?.classList.contains('open')) {
            closeTool(); return;
        }
        // P2 : mode édition grille actif (floating bar) ?
        if (document.querySelector('.pad-card.editing')) {
            dismissEditMode(); return;
        }
        // P3 : panneau Paramètres ouvert ?
        if (document.getElementById('settings-panel')?.classList.contains('open')) {
            _closeSettings(); return;
        }
        // P4 : bibliothèque de prompts ouverte ?
        if (document.getElementById('pl-panel')?.classList.contains('open')) {
            _closePromptLibrary(); return;
        }
        // P5 : dropdown moteur ouvert ?
        if (document.getElementById('engine-dropdown')?.classList.contains('open')) {
            _closeEngineDropdown(); return;
        }
        // P6 : DST messages (priorité 1 ou 2) — dismiss vers message de bienvenue
        dismissDSTMessage();
    });

    // ── Control Center wiring ──────────────────────────────────
    _initEngineDropdown();
    _initPromptLibrary();
    _initModeToggle();

    // Key-Store — câblage déplacé dans la zone Suggest (section dashboard)

    // Mettre à jour le badge prompts au démarrage
    _refreshPromptsBadge();

    // Synchroniser le hero avec les données utilisateur sauvegardées
    _updateIdentityZone();
}

// ═══════════════════════════════════════════════════════════════
// CONTROL CENTER — ENGINE DROPDOWN
// ═══════════════════════════════════════════════════════════════
function _initEngineDropdown() {
    const triggerBtn = document.getElementById('tb-engine-btn');
    const dropdown   = document.getElementById('engine-dropdown');
    if (!triggerBtn || !dropdown) return;

    triggerBtn.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        if (isOpen) { _closeEngineDropdown(); return; }
        _openEngineDropdown(triggerBtn, dropdown);
    });

    document.addEventListener('click', () => _closeEngineDropdown());
}

function _openEngineDropdown(triggerBtn, dropdown) {
    const activeEngine = getActiveEngine();

    dropdown.innerHTML = `
        <div class="cc-dropdown-hd">Moteur IA actif</div>
        ${API_PROVIDERS.map(p => {
            const hasKey   = !!loadKey(p.id);
            const isActive = activeEngine === p.label;
            const logoHTML = p.logo
                ? `<img src="${p.logo}" alt="${p.label}" class="cc-engine-logo engine-logo-dark">${p.logoLight ? `<img src="${p.logoLight}" alt="${p.label}" class="cc-engine-logo engine-logo-light">` : ''}`
                : `<span class="cc-engine-initials">${p.label.charAt(0)}</span>`;
            return `
            <div class="cc-engine-item ${isActive ? 'active' : ''}" data-engine="${p.label}" data-provider="${p.id}">
                <div class="cc-engine-item-icon">${logoHTML}</div>
                <div class="cc-engine-item-info">
                    <div class="cc-engine-item-name">${p.label}</div>
                    <div class="cc-engine-item-sub">${p.name}</div>
                </div>
                <div class="cc-engine-item-status ${hasKey ? 'ok' : 'empty'}">${hasKey ? '✓ Clé' : 'Pas de clé'}</div>
                <div class="cc-engine-item-chk">✦</div>
            </div>`;
        }).join('')}
    `;

    // Positionner sous le bouton
    const rect = triggerBtn.getBoundingClientRect();
    dropdown.style.top  = (rect.bottom + 8) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.classList.add('open');
    triggerBtn.classList.add('active');

    dropdown.querySelectorAll('.cc-engine-item').forEach(item => {
        item.addEventListener('click', e => {
            e.stopPropagation();
            setActiveEngine(item.dataset.engine);
            _closeEngineDropdown();
            // Re-render settings si ouvert
            if (document.getElementById('settings-panel')?.classList.contains('open')) {
                _renderSettingsBody();
            }
        });
    });
}

function _closeEngineDropdown() {
    document.getElementById('engine-dropdown')?.classList.remove('open');
    document.getElementById('tb-engine-btn')?.classList.remove('active');
}

// ═══════════════════════════════════════════════════════════════
// CONTROL CENTER — PROMPT LIBRARY
// ═══════════════════════════════════════════════════════════════
function _initPromptLibrary() {
    document.getElementById('tb-prompts-btn')?.addEventListener('click', _openPromptLibrary);
    document.getElementById('pl-close-btn')?.addEventListener('click', _closePromptLibrary);
    document.getElementById('pl-backdrop')?.addEventListener('click', _closePromptLibrary);
    document.getElementById('pl-clear-btn')?.addEventListener('click', () => {
        if (!confirm('Effacer toute la bibliothèque ?')) return;
        localStorage.removeItem('ks_library');
        _renderPromptLibraryBody();
        _refreshPromptsBadge();
    });
}

function _openPromptLibrary() {
    _renderPromptLibraryBody();
    document.getElementById('pl-panel')?.classList.add('open');
    document.getElementById('pl-backdrop')?.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function _closePromptLibrary() {
    document.getElementById('pl-panel')?.classList.remove('open');
    document.getElementById('pl-backdrop')?.classList.remove('open');
    document.body.style.overflow = '';
}

function _renderPromptLibraryBody() {
    const body = document.getElementById('pl-body');
    if (!body) return;

    const lib = JSON.parse(localStorage.getItem('ks_library') || '[]');

    if (lib.length === 0) {
        body.innerHTML = `
            <div class="pl-empty">
                <div class="pl-empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="width:40px;height:40px;opacity:.35"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
                <div class="pl-empty-txt">Aucun prompt sauvegardé.<br>Utilisez le bouton "Bibliothèque"<br>dans une boîte à outils.</div>
            </div>`;
        return;
    }

    // Échappement HTML — indispensable car les prompts peuvent contenir
    // <style>, <script>, <div>... qui seraient interprétés comme HTML réel
    // et masqueraient les boutons Copier/Supprimer.
    const _esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    body.innerHTML = lib.map((entry, idx) => {
        const date = new Date(entry.date).toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
        const label = entry.label || `${entry.id} · ${entry.title}`;
        return `
        <div class="pl-entry" data-idx="${idx}">
            <div class="pl-entry-hd">
                <span class="pl-entry-tag pl-entry-rename" data-idx="${idx}" title="Cliquer pour renommer" contenteditable="false">${_esc(label)}</span>
                <span class="pl-entry-edit-ico" data-idx="${idx}" title="Renommer">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;pointer-events:none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </span>
                <span class="pl-entry-date">${_esc(date)}</span>
            </div>
            <div class="pl-entry-text">${_esc(entry.prompt)}</div>
            <div class="pl-entry-actions">
                <button class="pl-entry-btn" data-action="copy" data-idx="${idx}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier</button>
                <button class="pl-entry-btn danger" data-action="delete" data-idx="${idx}">Supprimer</button>
            </div>
        </div>`;
    }).join('');

    // ── Rename : clic sur le titre ou l'icône crayon ────────────
    body.querySelectorAll('.pl-entry-rename, .pl-entry-edit-ico').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            const idx = parseInt(el.dataset.idx, 10);
            const tag = body.querySelector(`.pl-entry-rename[data-idx="${idx}"]`);
            if (!tag || tag.contentEditable === 'true') return;
            tag.contentEditable = 'true';
            tag.classList.add('editing');
            tag.focus();
            // Sélectionner tout le texte
            const range = document.createRange();
            range.selectNodeContents(tag);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);

            const _save = () => {
                tag.contentEditable = 'false';
                tag.classList.remove('editing');
                const newLabel = tag.textContent.trim();
                if (!newLabel) { _renderPromptLibraryBody(); return; }
                const lib = JSON.parse(localStorage.getItem('ks_library') || '[]');
                if (lib[idx]) { lib[idx].label = newLabel; localStorage.setItem('ks_library', JSON.stringify(lib)); }
            };
            tag.addEventListener('blur', _save, { once: true });
            tag.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); tag.blur(); }
                if (e.key === 'Escape') { tag.contentEditable = 'false'; tag.classList.remove('editing'); _renderPromptLibraryBody(); }
            });
        });
    });

    // ── Copy / Delete ────────────────────────────────────────────
    body.querySelectorAll('.pl-entry-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            const lib = JSON.parse(localStorage.getItem('ks_library') || '[]');
            if (btn.dataset.action === 'copy') {
                navigator.clipboard.writeText(lib[idx]?.prompt || '').then(() => {
                    btn.textContent = '✓ Copié !';
                    setTimeout(() => { btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier'; }, 2000);
                });
            } else {
                lib.splice(idx, 1);
                localStorage.setItem('ks_library', JSON.stringify(lib));
                _renderPromptLibraryBody();
                _refreshPromptsBadge();
            }
        });
    });
}

export function _refreshPromptsBadge() {
    const lib    = JSON.parse(localStorage.getItem('ks_library') || '[]');
    const badge  = document.getElementById('prompts-badge');
    if (!badge) return;
    if (lib.length > 0) {
        badge.textContent = lib.length > 99 ? '99+' : lib.length;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

// ═══════════════════════════════════════════════════════════════
// CONTROL CENTER — MODE TOGGLE (Clair / Sombre)
// ═══════════════════════════════════════════════════════════════
const LS_THEME = 'ks_theme';

function _initModeToggle() {
    // Appliquer le thème sauvegardé
    const saved = localStorage.getItem(LS_THEME);
    if (saved === 'light') _applyLightMode(true);

    document.getElementById('tb-mode-btn')?.addEventListener('click', () => {
        const isLight = document.documentElement.classList.contains('light-mode');
        _applyLightMode(!isLight);
        localStorage.setItem(LS_THEME, !isLight ? 'light' : 'dark');
    });
}

function _applyLightMode(on) {
    document.documentElement.classList.toggle('light-mode', on);
    const icon = document.getElementById('mode-icon');
    if (icon) {
        icon.innerHTML = on
            ? `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`
            : `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
    }
}

// ── Identity zone — pilotée par ks_user_name + ks_user_photo ─
function _updateIdentityZone() {
    const name  = localStorage.getItem(LS_USER_NAME)  || 'Stéphane';
    const photo = localStorage.getItem(LS_USER_PHOTO) || '';

    // Nom dans le hero
    const nameEl = document.querySelector('.hero-name');
    if (nameEl) nameEl.textContent = name;

    // Slot identité — logo ou photo
    const slot = document.getElementById('identity-slot');
    if (!slot) return;
    const img = slot.querySelector('img');
    if (photo) {
        if (img) {
            img.src = photo;
            img.alt = name;
            img.style.display = '';
        } else {
            slot.innerHTML = `<img src="${photo}" alt="${name}" onerror="this.style.display='none';this.parentElement.innerHTML='<span class=identity-slot-initials>${name.charAt(0).toUpperCase()}</span>'">`;
        }
    } else {
        // Pictogramme neutre si aucune photo renseignée
        slot.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
            style="width:28px;height:28px;color:rgba(99,102,241,.45)">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke-linecap="round"/>
        </svg>`;
    }
}
