/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — UI Renderer v2.0
   Modules : Dashboard · Settings · Modal renderTool · S-CORE-LOGIC
   ═══════════════════════════════════════════════════════════════ */

import { getPad, getOwnedIds, getCatalogEntry, getCatalog } from './pads-loader.js';
// pads-data.js reste le fallback embarqué — pads-loader.js le charge si disponible
import { ApiHandler } from './api-handler.js';
import {
    initGridEngine, getSavedOrder,
    getUserLabel, isPadHidden, restorePad,
    dismissEditMode,
} from './grid-engine.js';
import { setKeystoneStatus, dismissDSTMessage } from './dst.js';
import { lock, unlock, isLocked }              from './lockscreen.js';
import { initOnboarding, needsOnboarding }    from './onboarding.js';
import { exportVault, linkVaultFile, scheduleAutoSave, isVaultLinked } from './vault.js';
import { activateLicence, getLicenceStatus, revokeLicence }            from './licence.js';

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

// ── Données dashboard — NOMEN-K : [TYPE]-[CAT]-[NUM] ─────────
// ID_KSTORE immuable · USER_LABEL modifiable · SKU canonique affiché en Shell
// padKey → clé dans le pads-loader (formulaires complets chargés depuis JSON)
const TOOLS = [
    // Outils Immobilier
    { id:'O-IMM-001', padKey:'A1', name:'Notices VEFA',          desc:'Générez vos notices descriptives en 15 sec',   icon:'vefa',    engine:'Claude'   },
    { id:'O-IMM-002', padKey:'A2', name:'Annonces Commerciales', desc:'Textes de vente percutants en 30 sec',          icon:'ad',      engine:'ChatGPT'  },
    { id:'O-IMM-003', padKey:'A3', name:'Emails Acquéreurs',     desc:'Communication chantier personnalisée',          icon:'mail',    engine:'Claude'   },
    // Outils Marketing
    { id:'O-MKT-001', padKey:'A4', name:'Posts Réseaux Sociaux', desc:'Facebook · Instagram · LinkedIn',              icon:'social',  engine:'Gemini'   },
    { id:'O-MKT-002', padKey:'A8', name:'Brief Photo / 3D',      desc:'Brief créatif professionnel en 2 minutes',     icon:'brief',   engine:'ChatGPT'  },
    // Outils Analyse
    { id:'O-ANL-001', padKey:'A5', name:'CR Chantier',           desc:'Notes terrain → CR professionnel',             icon:'site',    engine:'Claude'   },
    { id:'O-ANL-002', padKey:'A6', name:'Analyste Foncier',      desc:'Dossier foncier complet en 5 minutes',         icon:'foncier', engine:'Claude'   },
    // Outils Admin
    { id:'O-ADM-001', padKey:'A7', name:'Objections Acquéreurs', desc:'3 réponses graduées par objection',            icon:'chat',    engine:'Claude'   },
];

const ARTEFACTS = [
    // Artefacts Key-Store — Immobilier
    { id:'A-IMM-001', name:'Sentinel Immo',    icon:'zap'   },
    { id:'A-IMM-002', name:'Tableau des Lots', icon:'table' },
    { id:'A-IMM-003', name:'Qualification',    icon:'chat'  },
    // Artefacts Key-Store — Analyse
    { id:'A-ANL-001', name:'Simulateur Pinel', icon:'calc'  },
    { id:'A-ANL-002', name:'Calculatrice',     icon:'calc'  },
    // Artefacts Key-Store — Admin
    { id:'A-ADM-001', name:'FAQ Client',       icon:'brief' },
];

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
    // ── Premier lancement → tunnel d'onboarding ────────────────
    if (needsOnboarding()) {
        initOnboarding([...TOOLS, ...ARTEFACTS], renderDashboard);
        return;
    }

    // ── Classification owned / locked (B2B READY) ─────────────
    // null = mode démo : tout est accessible · sinon : filtre par licence
    const ownedIds   = getOwnedIds();
    const ownedTools = TOOLS.filter(t => ownedIds === null || ownedIds.includes(t.id));
    const lockedTools= ownedIds !== null ? TOOLS.filter(t => !ownedIds.includes(t.id)) : [];
    const ownedArts  = ownedIds !== null ? ARTEFACTS.filter(a => ownedIds.includes(a.id)) : [];
    const lockedArts = ARTEFACTS.filter(a => ownedIds === null || !ownedIds.includes(a.id));

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

        // Filtrer les pads masqués par l'utilisateur
        const visibleTools = orderedTools.filter(t => !isPadHidden(t.id));

        // Cartes outils possédés (interactives, drag & drop)
        const toolCards = visibleTools.map(t => {
            const label = getUserLabel(t.id) || t.name;
            return `
            <div class="pad-card" data-id="${t.id}" data-engine="${t.engine}" draggable="true">
                <div class="pad-icon">${ICONS[t.icon]}</div>
                <div class="pad-name">${label}</div>
                <div class="pad-desc">${t.desc}</div>
                <div class="pad-badge badge-available">Disponible</div>
                <div class="pad-arrow">↗</div>
                <div class="pad-sku">${t.id}</div>
            </div>`;
        }).join('');

        // Artefacts possédés (dans la grille principale, si achetés)
        const ownedArtCards = ownedArts.map(a => `
            <div class="pad-card pad-card--artefact" data-id="${a.id}" draggable="true">
                <div class="pad-icon">${ICONS[a.icon] || ICONS['zap']}</div>
                <div class="pad-name">${a.name}</div>
                <div class="pad-badge badge-artefact">Artefact</div>
                <div class="pad-arrow">↗</div>
                <div class="pad-sku">${a.id}</div>
            </div>`).join('');

        padsEl.innerHTML = toolCards + ownedArtCards;

        // Compteur de section
        const countEl = document.querySelector('.pads-section .sec-count');
        if (countEl) countEl.textContent = visibleTools.length + ownedArts.length;

        _renderRestoreBtn(padsEl, ownedTools);
        initGridEngine(padsEl, openTool, () => _renderRestoreBtn(padsEl, ownedTools));
    }

    // ── BARRE KEY-STORE — Outils suggérés / verrouillés ────────
    if (artsEl) {
        // Outils verrouillés (non possédés) — cartes avec overlay cadenas
        const lockedToolCards = lockedTools.map(t => {
            const cat = getCatalogEntry(t.id);
            return `
            <div class="pad-card pad-card--locked" data-id="${t.id}"
                 role="button" tabindex="0" aria-label="Débloquer ${t.name}">
                <div class="pad-icon">${ICONS[t.icon]}</div>
                <div class="pad-name">${t.name}</div>
                <div class="pad-desc">${cat?.subtitle || t.desc}</div>
                <div class="pad-badge badge-kstore">Key-Store${cat?.plan ? ` · ${cat.plan}` : ''}</div>
                ${cat?.price ? `<div class="pad-price-tag">${cat.price} €<span class="pad-price-unit">/mois</span></div>` : ''}
                <div class="pad-lock-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         style="width:16px;height:16px">
                        <rect x="3" y="11" width="18" height="11" rx="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                </div>
                <div class="pad-sku">${t.id}</div>
            </div>`;
        }).join('');

        // Artefacts Key-Store (non possédés) — format compact horizontal
        const lockedArtCards = lockedArts.map(a => `
            <div class="art-card ks-suggest" data-id="${a.id}"
                 role="button" tabindex="0" aria-label="Voir ${a.name} dans le Key-Store">
                <div class="art-code">${a.id}</div>
                <div class="art-icon">${ICONS[a.icon] || ICONS['zap']}</div>
                <div class="art-name">${a.name}</div>
                <button class="art-kstore-btn" title="Voir dans le Key-Store">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                         style="width:10px;height:10px">
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <path d="M16 10a4 4 0 0 1-8 0"/>
                    </svg>
                    Key-Store
                </button>
            </div>`).join('');

        artsEl.innerHTML = lockedToolCards + lockedArtCards;

        // Délégation de clic — ouvre la modale MarketplaceInfo
        artsEl.addEventListener('click', e => {
            const lockedCard = e.target.closest('.pad-card--locked');
            const artCard    = e.target.closest('.art-card.ks-suggest');
            const card = lockedCard || artCard;
            if (!card) return;
            const item = [...TOOLS, ...ARTEFACTS].find(x => x.id === card.dataset.id);
            if (item) _openMarketplaceInfo(item);
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
const _KS_CAT_LABELS   = { IMM:'Immobilier', MKT:'Marketing', ANL:'Analyse', ADM:'Admin' };

let _ksPanelReady = false;
let _ksSearch     = '';
let _ksCat        = '';
let _ksPlan       = '';
let _ksDebounce   = null;

function _openKStorePanel() {
    _buildKStorePanel();
    document.getElementById('ks-panel')?.classList.add('open');
    document.getElementById('ks-backdrop-panel')?.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Marque la visite → supprime le pulse
    localStorage.setItem(LS_CATALOG_CHECK, new Date().toISOString().split('T')[0]);
    document.getElementById('kstore-catalog-btn')?.classList.remove('pulse');

    _renderKStoreItems();
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
                <div class="ks-filter-chips" data-filter="cat">
                    <button class="ks-chip-filter active" data-value="">TOUS</button>
                    <button class="ks-chip-filter" data-value="IMM">IMMO</button>
                    <button class="ks-chip-filter" data-value="MKT">MKT</button>
                    <button class="ks-chip-filter" data-value="ANL">ANALYSE</button>
                    <button class="ks-chip-filter" data-value="ADM">ADMIN</button>
                </div>
            </div>
            <div class="ks-filter-row">
                <span class="ks-filter-label">PLAN</span>
                <div class="ks-filter-chips" data-filter="plan">
                    <button class="ks-chip-filter active" data-value="">TOUS</button>
                    <button class="ks-chip-filter" data-value="STARTER">STARTER</button>
                    <button class="ks-chip-filter" data-value="PRO">PRO</button>
                    <button class="ks-chip-filter" data-value="ENTERPRISE">ENTERPRISE</button>
                </div>
            </div>
        </div>

        <div id="ks-grid" class="ks-grid"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#ks-close-btn').addEventListener('click', _closeKStorePanel);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeKStorePanel(); });

    panel.querySelector('#ks-search-input').addEventListener('input', e => {
        _ksSearch = e.target.value.toLowerCase().trim();
        clearTimeout(_ksDebounce);
        _ksDebounce = setTimeout(_renderKStoreItems, 180);
    });

    panel.querySelectorAll('.ks-filter-chips').forEach(group => {
        group.addEventListener('click', e => {
            const chip = e.target.closest('.ks-chip-filter');
            if (!chip) return;
            group.querySelectorAll('.ks-chip-filter').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            if (group.dataset.filter === 'cat')  _ksCat  = chip.dataset.value;
            if (group.dataset.filter === 'plan') _ksPlan = chip.dataset.value;
            _renderKStoreItems();
        });
    });

    panel.querySelector('#ks-grid').addEventListener('click', e => {
        const btn = e.target.closest('.ks-item-btn');
        if (!btn) return;
        const item = [...TOOLS, ...ARTEFACTS].find(x => x.id === btn.dataset.id);
        if (item) {
            _closeKStorePanel();
            setTimeout(() => _openMarketplaceInfo(item), 220);
        }
    });
}

function _renderKStoreItems() {
    const grid = document.getElementById('ks-grid');
    if (!grid) return;

    const ownedIds = getOwnedIds();
    const all      = [...TOOLS, ...ARTEFACTS];

    const filtered = all.filter(item => {
        const cat = getCatalogEntry(item.id);

        if (_ksSearch) {
            const hay = [item.name, item.desc || '', cat?.subtitle || '',
                         cat?.longDesc || '', ...(cat?.tags || [])].join(' ').toLowerCase();
            if (!hay.includes(_ksSearch)) return false;
        }

        if (_ksCat) {
            if (item.id.split('-')[1] !== _ksCat) return false;
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

    grid.innerHTML = filtered.map(item => {
        const cat     = getCatalogEntry(item.id);
        const isOwned = ownedIds === null || ownedIds.includes(item.id);
        const isArt   = item.id.startsWith('A-');
        const catLbl  = _KS_CAT_LABELS[item.id.split('-')[1]] || '';

        return `
        <div class="ks-item${isOwned ? ' ks-item--owned' : ''}${cat?.isNew ? ' ks-item--new' : ''}">
            <div class="ks-item-icon">${ICONS[item.icon] || ICONS['zap']}</div>
            <div class="ks-item-body">
                <div class="ks-item-meta">
                    ${item.id} · ${catLbl}${isArt ? ' · Artefact' : ''}
                    ${cat?.isNew ? '<span class="ks-new-dot">● NEW</span>' : ''}
                </div>
                <div class="ks-item-name">${cat?.title || item.name}</div>
                <div class="ks-item-desc">${cat?.subtitle || item.desc || ''}</div>
                <div class="ks-item-chips">
                    ${cat?.plan  ? `<span class="ks-chip ks-chip-plan">${cat.plan}</span>` : ''}
                    ${cat?.price ? `<span class="ks-chip ks-chip-price">${cat.price} €/mois</span>` : ''}
                    ${(cat?.ai_optimized || item.engine)
                        ? `<span class="ks-chip ks-chip-eng">${cat?.ai_optimized || item.engine} ✦</span>`
                        : ''}
                </div>
            </div>
            <div class="ks-item-action">
                ${isOwned
                    ? `<span class="ks-item-owned-badge">✓ Inclus</span>`
                    : `<button class="ks-item-btn" data-id="${item.id}">Voir →</button>`}
            </div>
        </div>`;
    }).join('');
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
function _openMarketplaceInfo(item) {
    // Nettoyage si déjà ouverte
    document.getElementById('ks-mkt-backdrop')?.remove();
    document.getElementById('ks-mkt-modal')?.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'ks-mkt-backdrop';
    backdrop.className = 'mkt-backdrop';

    const catCode    = (item.id || '').split('-')[1] || '';
    const catLabel   = { IMM:'IMMOBILIER', MKT:'MARKETING', ANL:'ANALYSE', ADM:'ADMIN', ART:'ARTEFACT' }[catCode] || catCode;
    const isArtefact = (item.id || '').startsWith('A-');

    // Données catalogue enrichies (disponibles si le fetch est arrivé)
    const cat       = getCatalogEntry(item.id);
    const longDesc  = cat?.longDesc || null;
    const plan      = cat?.plan     || null;
    const price     = cat?.price    || null;
    const aiEngine  = cat?.ai_optimized || item.engine || null;
    const isNew     = cat?.isNew    || false;
    const priceStr  = price ? `${price} €/mois` : (cat ? 'Sur devis' : '');

    const modal = document.createElement('div');
    modal.id = 'ks-mkt-modal';
    modal.className = 'mkt-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', `Débloquer ${item.name}`);
    modal.innerHTML = `
        <div class="mkt-head">
            <div class="mkt-icon">${ICONS[item.icon] || ICONS['zap']}</div>
            <div class="mkt-meta">
                <div class="mkt-id">
                    ${item.id} · ${catLabel}
                    ${isNew ? '<span class="mkt-new-badge">NOUVEAU</span>' : ''}
                </div>
                <div class="mkt-title">${cat?.title || item.name}</div>
                <div class="mkt-desc">${cat?.subtitle || item.desc || ''}</div>
            </div>
            <button class="mkt-close" aria-label="Fermer">✕</button>
        </div>
        <div class="mkt-body">
            <div class="mkt-info-row">
                <div class="mkt-badge-ks">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         style="width:12px;height:12px;flex-shrink:0">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    ${isArtefact ? 'Artefact Key-Store' : 'Outil Key-Store'}
                </div>
                ${plan     ? `<div class="mkt-chip mkt-chip-plan">Plan ${plan}</div>` : ''}
                ${priceStr ? `<div class="mkt-chip mkt-chip-price">${priceStr}</div>` : ''}
                ${aiEngine ? `<div class="mkt-chip mkt-chip-engine">${aiEngine} ✦</div>` : ''}
            </div>
            <p class="mkt-explain">
                ${longDesc
                    ? longDesc
                    : `Cet outil n'est pas inclus dans votre licence actuelle.<br>Débloquez-le pour bénéficier d'un accès complet ou essayez-le gratuitement.`}
            </p>
            <div class="mkt-features">
                <div class="mkt-feat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         style="width:13px;height:13px;flex-shrink:0;color:var(--gold)">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Accès illimité au formulaire IA
                </div>
                <div class="mkt-feat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         style="width:13px;height:13px;flex-shrink:0;color:var(--gold)">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Sauvegarde dans la bibliothèque de prompts
                </div>
                <div class="mkt-feat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         style="width:13px;height:13px;flex-shrink:0;color:var(--gold)">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Mises à jour automatiques via Key-Store
                </div>
            </div>
        </div>
        <div class="mkt-actions">
            <button class="mkt-btn-try" id="mkt-btn-try"
                    title="Tester cet outil (usage limité — 1 génération)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                     style="width:14px;height:14px;flex-shrink:0">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Essayer gratuitement
            </button>
            <a class="mkt-btn-unlock"
               href="https://proteinstudio.fr/keystone" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     style="width:14px;height:14px;flex-shrink:0">
                    <rect x="3" y="11" width="18" height="11" rx="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Débloquer cet outil →
            </a>
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

    // Essai limité : ouvre l'outil en mode trial (passe la garde B2B)
    modal.querySelector('#mkt-btn-try').addEventListener('click', () => {
        _close();
        if (!isArtefact) setTimeout(() => openTool(item.id, { trial: true }), 320);
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
    // ── Garde B2B — outil verrouillé ? ───────────────────────────
    const ownedIds = getOwnedIds();
    if (!opts.trial && ownedIds !== null && !ownedIds.includes(padId)) {
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

    document.getElementById('tool-modal')?.classList.add('open');
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
    const form = document.getElementById('tool-form');
    const formData = {};
    if (form) {
        form.querySelectorAll('[name]').forEach(el => { formData[el.name] = el.value.trim(); });
    }

    const engine    = getActiveEngine();
    const apiKey    = loadKey(ENGINE_TO_PROVIDER[engine] || 'anthropic');
    const prompt    = _interpolate(pad.system_prompt, formData);
    const btn       = document.getElementById('btn-generate');
    const contentEl = document.getElementById('result-content');
    const copyBtn   = document.getElementById('btn-copy');

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Génération en cours…';
    contentEl.className = 'result-content show';
    contentEl.textContent = '';
    if (copyBtn) copyBtn.style.display = 'none';

    // DST — génération en cours (P2, permanent jusqu'à fin)
    setKeystoneStatus(`Génération en cours avec ${engine}…`, 'info', 0, 2);

    try {
        const result = await ApiHandler.callEngine(engine, prompt, apiKey);
        _typewriter(contentEl, result);
        // DST — succès (P2, 5s) puis retour au message de bienvenue
        setKeystoneStatus(`${pad.title} — Réponse générée avec succès.`, 'info', 5000, 2);
    } catch (err) {
        contentEl.textContent = `❌  Erreur : ${err.message}`;
        setKeystoneStatus(`Erreur de génération : ${err.message}`, 'alert', 6000, 2);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Générer avec ${engine}`;
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
};

// ── Rendu du logo IA — variantes dark / light ─────────────────
function _engineLogoHTML(p, size = 20) {
    if (!p.logo) {
        const letter = p.label ? p.label.charAt(0) : '?';
        return `<span style="width:${size}px;height:${size}px;border-radius:4px;background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.2);display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;color:var(--gold);letter-spacing:-.02em;">${letter}</span>`;
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
            id: 'acc-usb', icon: ACC_ICONS.usb, title: 'Télécommande USB',
            open: false,
            content: `
                <div class="sp-usb-zone">
                    <div id="usb-state-unlinked">
                        <div class="sp-usb-desc">
                            Liez votre fichier <code>vault.js</code> une seule fois.
                            Keystone sauvegardera ensuite vos préférences et clés API
                            <strong>automatiquement</strong> à chaque modification — sans aucune action de votre part.
                        </div>
                        <div class="sp-usb-steps">
                            <div class="sp-usb-step"><span class="sp-usb-num">1</span>Cliquez "Lier ma clé USB" et sélectionnez <code>vault.js</code></div>
                            <div class="sp-usb-step"><span class="sp-usb-num">2</span>Modifiez vos paramètres — la sauvegarde est automatique</div>
                            <div class="sp-usb-step"><span class="sp-usb-num">3</span>Au prochain démarrage, tout est restauré instantanément</div>
                        </div>
                        <button class="btn-save-vault" id="btn-link-vault">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                            Lier ma clé USB
                        </button>
                    </div>
                    <div id="usb-state-linked" style="display:none">
                        <div class="sp-usb-linked-badge">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polyline points="20 6 9 17 4 12"/></svg>
                            Clé USB liée — sauvegarde automatique active
                        </div>
                        <div class="sp-usb-desc" style="margin-top:10px">
                            Chaque modification de vos paramètres est enregistrée directement
                            sur votre clé USB dans les 2 secondes.
                        </div>
                        <button class="btn-save-vault btn-save-vault-secondary" id="btn-force-save">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Forcer la sauvegarde
                        </button>
                    </div>
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

    // 🔗 Lier la clé USB (File System Access API)
    const _refreshUsbUI = () => {
        const linked   = isVaultLinked();
        const unlinked = body.querySelector('#usb-state-unlinked');
        const linkedEl = body.querySelector('#usb-state-linked');
        if (unlinked) unlinked.style.display = linked ? 'none' : '';
        if (linkedEl) linkedEl.style.display = linked ? '' : 'none';
    };
    _refreshUsbUI();

    body.querySelector('#btn-link-vault')?.addEventListener('click', async () => {
        const btn = body.querySelector('#btn-link-vault');
        if (btn) btn.textContent = 'Sélectionnez vault.js…';
        const ok = await linkVaultFile();
        if (ok) _refreshUsbUI();
        else if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Lier ma clé USB`;
    });

    body.querySelector('#btn-force-save')?.addEventListener('click', () => {
        const btn = body.querySelector('#btn-force-save');
        exportVault();
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '✓ Sauvegardé';
            btn.classList.add('saved');
            setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('saved'); }, 2000);
        }
    });

    // Statut live depuis vault.js
    window.addEventListener('ks-vault-status', e => {
        const badge = body.querySelector('.sp-usb-linked-badge');
        if (!badge) return;
        if (e.detail.state === 'saved') {
            badge.classList.add('flash');
            setTimeout(() => badge.classList.remove('flash'), 800);
        }
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

    body.innerHTML = lib.map((entry, idx) => {
        const date = new Date(entry.date).toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
        return `
        <div class="pl-entry" data-idx="${idx}">
            <div class="pl-entry-hd">
                <span class="pl-entry-tag">${entry.id} · ${entry.title}</span>
                <span class="pl-entry-date">${date}</span>
            </div>
            <div class="pl-entry-text">${entry.prompt}</div>
            <div class="pl-entry-actions">
                <button class="pl-entry-btn" data-action="copy" data-idx="${idx}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier</button>
                <button class="pl-entry-btn danger" data-action="delete" data-idx="${idx}">Supprimer</button>
            </div>
        </div>`;
    }).join('');

    body.querySelectorAll('.pl-entry-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            const lib = JSON.parse(localStorage.getItem('ks_library') || '[]');
            if (btn.dataset.action === 'copy') {
                navigator.clipboard.writeText(lib[idx]?.prompt || '').then(() => {
                    btn.textContent = '✓ Copié !';
                    setTimeout(() => { btn.textContent = '📋 Copier'; }, 2000);
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
        // Restaure le logo Prométhée par défaut
        if (img) {
            img.src = './LOGOS/Logo PROMETHEE2026.svg';
            img.alt = 'Prométhée Immobilier';
            img.style.display = '';
        }
    }
}
