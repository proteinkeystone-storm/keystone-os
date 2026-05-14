/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — UI Renderer v2.0
   Modules : Dashboard · Settings · Modal renderTool · S-CORE-LOGIC
   ═══════════════════════════════════════════════════════════════ */

import { getPad, getOwnedIds, setOwnedIds, getLifetimeIds, isFrigoMode, getCatalogEntry, getCatalog, CF_API } from './pads-loader.js';
import { renderArtifactResult, COMP_ICONS } from './artifact-renderer.js';
import { ApiHandler } from './api-handler.js';
import {
    initGridEngine, getSavedOrder,
    getUserLabel, isPadHidden, restorePad,
    dismissEditMode, isPadDeactivated, deactivatePad, reactivatePad,
} from './grid-engine.js';
import { setKeystoneStatus, dismissDSTMessage } from './dst.js';
import { initComputedFields }                    from './lib/form-computed.js';
import { openSDQR }                              from './sdqr.js';
import { openKodex }                             from './codex.js';
import { openMuse }                              from './muse.js';
import { openPulsa }                             from './pulsa.js';
import { lock, unlock, isLocked }              from './lockscreen.js';
// Onboarding entièrement délégué à la landing page (index.html).
import { scheduleAutoSave } from './vault.js';
import { activateLicence, getLicenceStatus, revokeLicence }            from './licence.js';
import { exportArtifactPDF }                                           from './pdf-export.js';
import {
    KSTORE_CATEGORIES, KSTORE_MOCK_APPS, KSTORE_FEATURED_IDS,
    getMockApp, getMockAppsByCategory, getMockAppsBySubcategory,
    getCategoryLabel, getCategoryPath,
} from './kstore-mock-catalog.js';

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
    // ── Pictogrammes brand (Stéphane mai 2026) ──────────────
    // Pictos identitaires des 5 artefacts/outils principaux.
    // Style outline cohérent avec le reste du registre mais
    // stroke-width 1.8 (légèrement plus marqué que le 1.5 par
    // défaut) pour donner du poids visuel sur les cards du
    // dashboard. Concepts préservés des SVG fournis par Stéphane.
    // - kodex         : mire/cible avec croix de visée (brief précis,
    //                   qui touche dans le mille)
    // - pulsa         : document + cercle "+" (formulaire+collecte)
    // - sdqr          : 3 carrés à coins arrondis + modules
    //                   (réutilise le picto QR de sdqr.js l.245-253)
    // - muse          : nuancier 3 swatches en éventail (planche d'ambiance)
    // - multiportails : 3 lignes courtes + 3 longues (diffusion)
    'kodex':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`,
    'pulsa':          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="14" height="14" rx="2"/><line x1="5" y1="6.5" x2="13" y2="6.5"/><line x1="5" y1="10.5" x2="11" y2="10.5"/><circle cx="17" cy="17" r="5"/><line x1="17" y1="14.5" x2="17" y2="19.5"/><line x1="14.5" y1="17" x2="19.5" y2="17"/></svg>`,
    'sdqr':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="2" height="2" fill="currentColor" stroke="none"/><rect x="16" y="16" width="2" height="2" fill="currentColor" stroke="none"/><rect x="19" y="14" width="2" height="2" fill="currentColor" stroke="none"/><rect x="14" y="19" width="2" height="2" fill="currentColor" stroke="none"/><rect x="19" y="19" width="2" height="2" fill="currentColor" stroke="none"/></svg>`,
    'muse':           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="5.5" height="14" rx="1"/><rect x="9.25" y="3.5" width="5.5" height="17" rx="1"/><rect x="16" y="5.5" width="5.5" height="15" rx="1"/></svg>`,
    'multiportails':  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="5" x2="5" y2="5"/><line x1="8" y1="5" x2="22" y2="5"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="8" y1="12" x2="22" y2="12"/><line x1="2" y1="19" x2="5" y2="19"/><line x1="8" y1="19" x2="22" y2="19"/></svg>`,
};

// ── Palette par PLAN (et par type) ────────────────────────────
// Logique : la teinte sert d'aide visuelle pour repérer le plan
// nécessaire à un outil + différencier les Artefacts des Outils.
//   • DEMO    → slate (gris) — outil démo gratuit
//   • STARTER → blue (sky)   — plan Start
//   • PRO     → indigo       — plan Pro (recommandé)
//   • MAX     → violet       — plan Max
//   • Artefact (id A-*)      → amber (ambre) — distinct des outils
const _PALETTE_BY_PLAN = {
    'DEMO':    'slate',
    'STARTER': 'blue',
    'PRO':     'indigo',
    'MAX':     'violet',
};
function getToolPalette(id) {
    if (!id) return 'indigo';
    // Artefacts : couleur dédiée (ambre) pour les distinguer des outils
    if (id.startsWith('A-')) return 'amber';
    // Outils : palette basée sur le plan déclaré dans le catalogue
    const cat  = getCatalogEntry(id);
    const plan = (cat?.plan || '').toUpperCase();
    return _PALETTE_BY_PLAN[plan] || 'indigo';
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

/**
 * Résout le prompt système d'un pad selon le moteur actif.
 * Cherche d'abord le prompt spécifique au moteur sélectionné dans le header,
 * fallback sur le prompt par défaut (system_prompt).
 */
function _resolveEnginePrompt(pad) {
    if (!pad) return '';
    const engine   = getActiveEngine();
    const engineId = ENGINE_LABEL_TO_ID[engine] || engine.toLowerCase();
    return pad?.engines?.prompts?.[engineId]
        || pad?.engines?.prompts?.[engine]
        || pad?.system_prompt
        || '';
}

/**
 * Rafraîchit la modale outil ouverte après un changement de moteur :
 * - met à jour le label du bouton "Générer avec X"
 * - re-render le prompt preview avec le prompt du nouveau moteur
 */
function _refreshOpenToolForEngine() {
    if (!currentPad) return;
    const modal = document.getElementById('tool-modal');
    if (!modal?.classList.contains('open')) return;

    const engine = getActiveEngine();

    // Label du bouton Générer
    const btn = document.getElementById('btn-generate');
    if (btn && !btn.disabled) {
        // Préserve le SVG, réécrit juste le texte
        btn.innerHTML = btn.innerHTML.replace(/Générer avec [^<]*/, `Générer avec ${engine}`);
    }

    // Re-render prompt preview (sauf en mode artifact)
    if (currentPad.type !== 'artifact') {
        // Reset typewriter pour réécrire le prompt
        _promptWasReady = false;
        _updatePromptPreview(currentPad);
    }
}

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
                <div class="pad-icon">${ICONS[t.icon] || ICONS['package']}</div>
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
                <div class="suggest-card-icon">${icon}</div>
                <div class="suggest-card-name">${label}</div>
                ${isNew ? '<span class="suggest-card-new">NEW</span>' : ''}
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
    if (document.getElementById('ks-fullscreen')?.classList.contains('open')) {
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

let _ksPanelReady = false;
let _ksSearch     = '';
let _ksDebounce   = null;

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
            { text: '3 Assistants Certifiés au choix' },
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
            { text: '5 Assistants Certifiés au choix' },
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
            { html: '<strong>7 Assistants Certifiés au choix</strong>' },
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

// État courant de la vue Key-Store plein écran.
// _ksFilter : { kind: 'all' | 'cat' | 'sub' | 'plans' | 'detail', id: string|null }
let _ksFilter     = { kind: 'all', id: null };
let _ksPrevFilter = null;   // utilisé pour le bouton retour depuis la vue détail

// Re-render le Key-Store s'il est ouvert quand le catalogue D1 arrive
// (édité depuis l'admin → pads-loader dispatche `ks-catalog-loaded`).
window.addEventListener('ks-catalog-loaded', () => {
    if (document.getElementById('ks-fullscreen')?.classList.contains('open')) {
        _renderKStoreItems();
    }
});

// ═══════════════════════════════════════════════════════════════
// Source de données unifiée — D1 catalog + mock catalog
// Les apps D1 (éditées via l'admin) prennent priorité ; le mock sert
// de placeholder pour les apps non encore éditées.
// ═══════════════════════════════════════════════════════════════

// Whitelist des codes K-Store (cf. KSTORE_CATEGORIES). Les entrées du
// catalog interne (CATALOG_DATA / D1) utilisent une taxonomie LEGACY
// (IMM, COM, ANL, ADM, MKT, PRD) pour le dashboard ; le K-Store, lui,
// a sa propre taxonomie (BIZ/NEWS/FUN/…) avec sous-cats (BIZ_IMM…).
// Mélanger les deux fait disparaître les pads du K-Store sidebar.
const _KSTORE_CAT_CODES = new Set([
    'BIZ', 'NEWS', 'FUN', 'FIN', 'GFX', 'MED', 'MUS', 'PRD', 'SOC', 'LIF', 'UTL',
    'BIZ_IMM', 'BIZ_RST', 'BIZ_LSR', 'BIZ_COM',
]);

// Normalise une entrée D1 catalog vers le shape attendu côté front
function _ksNormalizeD1(d1) {
    if (!d1) return null;
    // On ne propage category/subcategory QUE si elles appartiennent à la
    // taxonomie K-Store. Sinon (cas legacy IMM/COM/ANL/ADM), on les omet
    // pour laisser celles du mock prendre le dessus dans _ksMergeApp.
    const safeCategory    = _KSTORE_CAT_CODES.has(d1.category)    ? d1.category    : undefined;
    const safeSubcategory = _KSTORE_CAT_CODES.has(d1.subcategory) ? d1.subcategory : undefined;
    return {
        id            : d1.id,
        category      : safeCategory,
        subcategory   : safeSubcategory,
        title         : d1.title,
        punchline     : d1.subtitle || d1.punchline || '',
        shortDesc     : d1.subtitle || d1.shortDesc || d1.longDesc || '',
        longDesc      : d1.longDesc,
        descTitle     : d1.descTitle,
        rgpdTitle     : d1.rgpdTitle,
        rgpdText      : d1.rgpdText,
        iconId        : d1.iconId,                // ← upload icône (screenshot id)
        coverId       : d1.coverId,               // ← upload photo de présentation
        price         : d1.price ?? 0,
        icon          : d1.icon,
        ai_optimized  : d1.ai_optimized,
        ai_compatible : d1.ai_compatible,
        copyright     : d1.copyright,
        screenshots   : d1.screenshots,           // ← array d'ids /api/screenshot/<id>
        real          : true,                     // toute entrée D1 = vraie app
        _fromD1       : true,
    };
}

// Fusion mock + D1 : D1 prioritaire pour les champs non vides
function _ksMergeApp(mock, d1) {
    if (!mock && !d1) return null;
    if (!d1)   return mock;
    if (!mock) return d1;
    const out = { ...mock };
    for (const [k, v] of Object.entries(d1)) {
        if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    out.real = true;
    return out;
}

function _ksGetApp(id) {
    const mock = getMockApp(id);
    const d1   = _ksNormalizeD1(getCatalogEntry(id));
    return _ksMergeApp(mock, d1);
}

// Liste TOUTES les apps (mock + D1, dédupliquées par id, publiées seulement)
function _ksGetAllApps() {
    const map = new Map();
    KSTORE_MOCK_APPS.forEach(m => map.set(m.id, m));
    const catalog = getCatalog();
    (catalog?.tools || []).forEach(d1 => {
        if (d1.published === false) {
            map.delete(d1.id);  // App dépubliée → masquée même si dans mock
            return;
        }
        map.set(d1.id, _ksMergeApp(map.get(d1.id), _ksNormalizeD1(d1)));
    });
    return [...map.values()];
}

function _ksGetAppsByCategory(catId) {
    return _ksGetAllApps().filter(a => a.category === catId);
}
function _ksGetAppsBySubcategory(subId) {
    return _ksGetAllApps().filter(a => a.subcategory === subId);
}

function _openKStorePanel(view = 'catalogue') {
    _buildKStorePanel();
    const wrap = document.getElementById('ks-fullscreen');
    wrap?.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Marque la visite → supprime le pulse
    localStorage.setItem(LS_CATALOG_CHECK, new Date().toISOString().split('T')[0]);
    document.getElementById('kstore-catalog-btn')?.classList.remove('pulse');

    if (view === 'plans') {
        _ksFilter = { kind: 'plans', id: null };
    } else {
        _ksFilter = { kind: 'all', id: null };
    }
    _renderKStoreItems();
}

function _closeKStorePanel() {
    document.getElementById('ks-fullscreen')?.classList.remove('open');
    document.body.style.overflow = '';
}

function _buildKStorePanel() {
    if (_ksPanelReady) return;
    _ksPanelReady = true;

    // ── Sidebar (catégories + plans + utilisateur) ──────────────
    const userLabel = (() => {
        try { return localStorage.getItem('ks_user_name') || 'Compte Keystone'; }
        catch { return 'Compte Keystone'; }
    })();
    const userInitial = (userLabel || 'K').trim().charAt(0).toUpperCase();

    const sidebarHTML = `
        <div class="ksfs-sidebar-top">
            <button class="ksfs-back-btn" id="ksfs-back-btn" aria-label="Retour">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                     style="width:14px;height:14px"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="ksfs-search-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     class="ksfs-search-icon">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input id="ksfs-search" class="ksfs-search-input" type="search"
                       placeholder="Rechercher" autocomplete="off">
            </div>
        </div>

        <div class="ksfs-nav">
            <div class="ksfs-nav-title">Catégories</div>
            <ul class="ksfs-nav-list">
                ${KSTORE_CATEGORIES.map(c => `
                    <li class="ksfs-nav-item${c.sub ? ' ksfs-nav-item--has-sub' : ''}"
                        data-cat="${c.id}">
                        <button class="ksfs-nav-btn" data-action="cat" data-id="${c.id}">
                            ${c.sub ? `<svg class="ksfs-nav-chev" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" stroke-width="2.2"
                                style="width:10px;height:10px"><polyline points="6 9 12 15 18 9"/></svg>` : ''}
                            <span>${c.label}</span>
                        </button>
                        ${c.sub ? `
                        <ul class="ksfs-nav-sub">
                            ${c.sub.map(s => `
                                <li>
                                    <button class="ksfs-nav-btn ksfs-nav-btn--sub"
                                            data-action="sub" data-id="${s.id}">
                                        #${s.label}
                                    </button>
                                </li>
                            `).join('')}
                        </ul>` : ''}
                    </li>
                `).join('')}
            </ul>

            <div class="ksfs-nav-title ksfs-nav-title--mt">Boutique</div>
            <ul class="ksfs-nav-list">
                <li class="ksfs-nav-item">
                    <button class="ksfs-nav-btn" data-action="plans">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                             style="width:12px;height:12px;flex-shrink:0;opacity:.8">
                            <rect x="2" y="6" width="20" height="14" rx="2"/>
                            <path d="M2 10h20"/>
                        </svg>
                        <span>Plans &amp; Tarifs</span>
                    </button>
                </li>
            </ul>
        </div>

        <div class="ksfs-sidebar-user">
            <div class="ksfs-user-avatar">${userInitial}</div>
            <div class="ksfs-user-meta">
                <div class="ksfs-user-name">${userLabel}</div>
                <div class="ksfs-user-sub">Propriétaire du compte</div>
            </div>
        </div>
    `;

    const wrap = document.createElement('div');
    wrap.id = 'ks-fullscreen';
    wrap.className = 'ksfs';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Key-Store');
    wrap.innerHTML = `
        <aside class="ksfs-sidebar">${sidebarHTML}</aside>
        <main class="ksfs-main">
            <button id="ksfs-close-btn" class="ksfs-close" aria-label="Fermer le Key-Store">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     style="width:16px;height:16px">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
            <div id="ksfs-content" class="ksfs-content"></div>
        </main>
    `;
    document.body.appendChild(wrap);

    // ── Listeners ──────────────────────────────────────────────
    wrap.querySelector('#ksfs-close-btn').addEventListener('click', _closeKStorePanel);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && wrap.classList.contains('open')) _closeKStorePanel();
    });

    wrap.querySelector('#ksfs-back-btn').addEventListener('click', () => {
        _ksFilter = { kind: 'all', id: null };
        _renderKStoreItems();
    });

    wrap.querySelector('#ksfs-search').addEventListener('input', e => {
        _ksSearch = e.target.value.toLowerCase().trim();
        clearTimeout(_ksDebounce);
        _ksDebounce = setTimeout(_renderKStoreItems, 180);
    });

    // Sidebar — clics catégorie / sous-catégorie / plans
    wrap.querySelector('.ksfs-nav').addEventListener('click', e => {
        const btn = e.target.closest('.ksfs-nav-btn');
        if (!btn) return;
        const action = btn.dataset.action;
        const id     = btn.dataset.id;
        if (action === 'cat')   _ksFilter = { kind: 'cat', id };
        if (action === 'sub')   _ksFilter = { kind: 'sub', id };
        if (action === 'plans') _ksFilter = { kind: 'plans', id: null };
        _renderKStoreItems();
    });

    // Délégation : clic sur une card → page détail (Phase B)
    wrap.querySelector('#ksfs-content').addEventListener('click', e => {
        // Retour depuis la fiche détail
        if (e.target.closest('#ksfs-detail-back')) {
            _backFromKStoreDetail();
            return;
        }

        // Notation (étoiles cliquables sur fiche détail)
        // Update DOM en place — pas de re-render pour éviter le décalage visuel.
        const star = e.target.closest('.ksfs-detail-star');
        if (star) {
            e.stopPropagation();
            const val  = parseInt(star.dataset.rate, 10);
            const id   = star.dataset.id;
            const prev = parseInt(localStorage.getItem('ks_rating_' + id) || '0', 10);
            const remove = (prev === val); // re-clic sur la même valeur → retire
            if (remove) localStorage.removeItem('ks_rating_' + id);
            else       localStorage.setItem('ks_rating_' + id, String(val));
            scheduleAutoSave?.();

            // Update visuel local — étoiles, valeur, hint
            const newRaw  = remove ? 0 : val;
            const display = newRaw > 0 ? newRaw : 4.7;
            const rounded = Math.round(display);
            document.querySelectorAll('.ksfs-detail-star').forEach(s => {
                s.classList.toggle('on', parseInt(s.dataset.rate, 10) <= rounded);
            });
            const valEl = document.querySelector('.ksfs-detail-rating-val');
            if (valEl) {
                valEl.firstChild.textContent = display.toFixed(1).replace('.', ',');
            }
            const hintEl = document.querySelector('.ksfs-detail-rating-hint');
            if (hintEl) {
                hintEl.textContent = newRaw > 0
                    ? 'Votre note · cliquez pour modifier'
                    : 'Cliquez pour noter cette app';
            }
            return;
        }

        // Bouton acheter / déployer (catalogue OU fiche détail)
        const buyBtn = e.target.closest(
            '.ksfs-buy-btn[data-action="obtenir"], .ksfs-detail-buy[data-action="obtenir"]'
        );
        if (buyBtn && !buyBtn.disabled) {
            e.stopPropagation();
            _activateKStoreItem(buyBtn.dataset.id, buyBtn);
            return;
        }

        // Bouton "Bientôt" sur une mock
        const soonBtn = e.target.closest('.ksfs-buy-btn[data-action="soon"]');
        if (soonBtn) { e.stopPropagation(); return; }

        // Carousel screenshots — navigation prev/next
        const navPrev = e.target.closest('.ksfs-detail-shot-nav--prev');
        const navNext = e.target.closest('.ksfs-detail-shot-nav--next');
        if (navPrev || navNext) {
            const shots = document.querySelector('.ksfs-detail-shots');
            if (shots) {
                const step = shots.clientWidth * 0.8;
                shots.scrollBy({ left: navPrev ? -step : step, behavior: 'smooth' });
            }
            return;
        }

        // Card / featured → ouvrir page détail
        const card = e.target.closest('[data-app-id]');
        if (card) {
            _openKStoreAppDetail(card.dataset.appId);
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

// ── Rendu principal de la vue Key-Store plein écran ────────────
// Dispatche selon _ksFilter : 'all' | 'cat' | 'sub' | 'plans'
function _renderKStoreItems() {
    const content = document.getElementById('ksfs-content');
    if (!content) return;

    // Sync sidebar — surligne l'entrée active
    document.querySelectorAll('.ksfs-nav-btn').forEach(b => b.classList.remove('active'));
    if (_ksFilter.kind === 'cat' || _ksFilter.kind === 'sub') {
        document.querySelector(
            `.ksfs-nav-btn[data-action="${_ksFilter.kind}"][data-id="${_ksFilter.id}"]`
        )?.classList.add('active');
    } else if (_ksFilter.kind === 'plans') {
        document.querySelector('.ksfs-nav-btn[data-action="plans"]')?.classList.add('active');
    }

    // Vue Détail App (Phase B) — fiche complète style Mac App Store
    if (_ksFilter.kind === 'detail') {
        _renderKStoreAppDetail(_ksFilter.id);
        return;
    }

    // Vue Plans & Tarifs (réutilise le rendu existant)
    if (_ksFilter.kind === 'plans') {
        content.innerHTML = `
            <div class="ksfs-plans-head">
                <h1 class="ksfs-plans-title">Plans &amp; Tarifs</h1>
                <p class="ksfs-plans-sub">Choisissez le plan qui correspond à vos besoins.</p>
            </div>
            <div id="ks-plans-view" class="ks-plans-view"></div>
        `;
        _renderKStorePlans();
        return;
    }

    const search = _ksSearch.trim();

    // ── Recherche globale (Option 4) — ignore le filtre catégorie ──
    if (search) {
        const all = _ksGetAllApps().filter(a =>
            (`${a.title} ${a.shortDesc || ''} ${a.punchline || ''}`)
                .toLowerCase().includes(search)
        );
        // Déselectionne la sidebar : la recherche est globale
        document.querySelectorAll('.ksfs-nav-btn').forEach(b => b.classList.remove('active'));
        content.innerHTML = `
            <div class="ksfs-section-head">
                <h1 class="ksfs-section-title">Résultats</h1>
                <p class="ksfs-section-sub">${all.length} app${all.length !== 1 ? 's' : ''} pour "${_ksSearch}"</p>
            </div>
            ${all.length === 0
                ? `<div class="ksfs-empty">Aucune app ne correspond à votre recherche.</div>`
                : `<div class="ksfs-grid">${all.map(_renderAppCardSmall).join('')}</div>`}
        `;
        return;
    }

    // Filtre actif sur les apps mockées
    const apps = (() => {
        if (_ksFilter.kind === 'cat') return _ksGetAppsByCategory(_ksFilter.id);
        if (_ksFilter.kind === 'sub') return _ksGetAppsBySubcategory(_ksFilter.id);
        return _ksGetAllApps();
    })();

    const filtered = apps;

    // ── Vue catégorie / sous-catégorie : grille seule ──
    if (_ksFilter.kind !== 'all') {
        const headerLabel = _ksFilter.kind === 'sub'
            ? getCategoryLabel(_ksFilter.id)
            : getCategoryLabel(_ksFilter.id);
        content.innerHTML = `
            <div class="ksfs-section-head">
                <h1 class="ksfs-section-title">${headerLabel}</h1>
                <p class="ksfs-section-sub">${filtered.length} app${filtered.length !== 1 ? 's' : ''}</p>
            </div>
            ${filtered.length === 0
                ? `<div class="ksfs-empty">Aucune app ne correspond à votre recherche.</div>`
                : `<div class="ksfs-grid">${filtered.map(_renderAppCardSmall).join('')}</div>`}
        `;
        return;
    }

    // ── Vue "all" (catalogue par défaut) : featured rail + sections ──
    const featured = KSTORE_FEATURED_IDS.map(_ksGetApp).filter(Boolean);

    // (Recherche globale gérée en amont — voir bloc `if (search)` plus haut.)

    // Sections "Pour gagner du temps" — une par catégorie ayant des apps
    const sections = KSTORE_CATEGORIES.map(c => {
        const inCat = _ksGetAppsByCategory(c.id);
        return inCat.length > 0 ? { cat: c, apps: inCat } : null;
    }).filter(Boolean);

    content.innerHTML = `
        <div class="ksfs-featured">
            <h2 class="ksfs-featured-title">À la une pour vous :</h2>
            <div class="ksfs-featured-rail">
                ${featured.map(_renderFeaturedCard).join('')}
            </div>
        </div>

        ${sections.map(({ cat, apps }) => `
            <section class="ksfs-section">
                <h2 class="ksfs-section-h">Pour gagner du temps</h2>
                <div class="ksfs-grid">
                    ${apps.map(_renderAppCardSmall).join('')}
                </div>
            </section>
        `).join('')}
    `;
}

// ── Helpers de rendu de cards ─────────────────────────────────
function _renderFeaturedCard(app) {
    const coverStyle = app.coverId
        ? `style="background-image:url('${CF_API}/api/screenshot/${encodeURIComponent(app.coverId)}');background-size:cover;background-position:center;background-color:transparent"`
        : '';
    return `
        <article class="ksfs-feat-card" data-app-id="${app.id}">
            <div class="ksfs-feat-cover" ${coverStyle}></div>
            <div class="ksfs-feat-cat">${getCategoryLabel(app.category)}</div>
            <div class="ksfs-feat-name">${app.title}</div>
            <div class="ksfs-feat-punch">${app.punchline || ''}</div>
        </article>
    `;
}

function _renderAppCardSmall(app) {
    const ownedIds = getOwnedIds();
    const isOwned  = (ownedIds === null) || ownedIds.includes(app.id);
    const priceLbl = app.real
        ? (isOwned ? '✓ Actif' : `${(app.price ?? 0).toFixed(2).replace('.', ',')} €`)
        : '00,00 €';
    const action   = app.real && !isOwned ? 'obtenir' : 'soon';

    // Trois sources possibles pour l'icône, dans cet ordre :
    // 1. Screenshot uploadé via admin (iconId) — background image
    // 2. Pictogramme SVG du registre ICONS (icon = 'kodex', 'pulsa'…)
    // 3. Fallback ICONS['package'] (apps mockées sans icône définie)
    const iconStyle = app.iconId
        ? `background-image:url('${CF_API}/api/screenshot/${encodeURIComponent(app.iconId)}');background-size:cover;background-position:center`
        : '';
    const iconInline = !app.iconId
        ? (ICONS[app.icon] || ICONS['package'] || '')
        : '';

    // Palette du plan (indigo pour PRO, blue pour STARTER, violet pour MAX,
    // amber pour les artefacts A-*, slate pour les mocks)
    const palette = getToolPalette(app.id);

    return `
        <article class="ksfs-app-card" data-app-id="${app.id}" data-palette="${palette}">
            <div class="ksfs-app-icon" style="${iconStyle}">${iconInline}</div>
            <div class="ksfs-app-body">
                <div class="ksfs-app-name">${app.title}</div>
                <div class="ksfs-app-desc">${app.shortDesc || ''}</div>
                <button class="ksfs-buy-btn${isOwned && app.real ? ' ksfs-buy-btn--owned' : ''}"
                        data-action="${action}" data-id="${app.id}"
                        ${!app.real ? 'aria-disabled="true"' : ''}>
                    ${priceLbl}
                </button>
            </div>
        </article>
    `;
}

// ── Page Détail App (Phase B) — style Mac App Store ──────────
function _openKStoreAppDetail(appId) {
    // Mémorise la vue d'où l'on vient pour le bouton retour
    if (_ksFilter.kind !== 'detail') _ksPrevFilter = _ksFilter;
    _ksFilter = { kind: 'detail', id: appId };
    _renderKStoreItems();
    // Scroll en haut quand on ouvre une fiche
    document.querySelector('.ksfs-main')?.scrollTo({ top: 0, behavior: 'instant' });
}

function _backFromKStoreDetail() {
    _ksFilter = _ksPrevFilter || { kind: 'all', id: null };
    _ksPrevFilter = null;
    _renderKStoreItems();
}

function _renderKStoreAppDetail(appId) {
    const content = document.getElementById('ksfs-content');
    if (!content) return;

    const app = _ksGetApp(appId);
    if (!app) {
        content.innerHTML = `<div class="ksfs-empty">App introuvable.</div>`;
        return;
    }

    // ── Note utilisateur (ks_rating_<id>) — fallback à 4,7 si non noté ──
    const rawRating = parseInt(localStorage.getItem('ks_rating_' + appId) || '0', 10);
    const userRated = rawRating > 0;
    const ratingNum = userRated ? rawRating : 4.7;
    const ratingStr = ratingNum.toFixed(1).replace('.', ',');
    const starsHTML = [1,2,3,4,5].map(v =>
        `<button class="ksfs-detail-star${v <= Math.round(ratingNum) ? ' on' : ''}"
                 data-rate="${v}" data-id="${appId}"
                 aria-label="Noter ${v} étoile${v > 1 ? 's' : ''}">★</button>`
    ).join('');

    // ── État d'achat (Notice VEFA seulement pour l'instant) ──
    const ownedIds = getOwnedIds();
    const isOwned  = app.real && (ownedIds === null || ownedIds.includes(appId));
    const priceLbl = app.real
        ? (app.price ?? 0).toFixed(2).replace('.', ',') + ' €'
        : '00,00 €';

    // ── Méta : catégorie + copyright ──
    const catLabel  = getCategoryPath(app.category, app.subcategory);
    const copyright = app.copyright || '© 2026-2027 Protein Studio';

    // ── Moteurs IA (avec fallback) ──
    const aiOpt = app.ai_optimized || 'Claude';
    const aiCmp = app.ai_compatible || ['Claude', 'GPT 5', 'Mistral', 'Gemini'];

    // ── Bouton d'action ──
    const btnAction = (() => {
        if (!app.real) {
            return `<button class="ksfs-detail-buy ksfs-detail-buy--soon" disabled>Bientôt</button>`;
        }
        if (isOwned) {
            return `<span class="ksfs-detail-buy ksfs-detail-buy--owned">✓ Actif</span>`;
        }
        return `<button class="ksfs-detail-buy" data-action="obtenir" data-id="${appId}">${priceLbl}</button>`;
    })();

    // ── "Également pour vous" — 5 apps de la même catégorie (hors self) ──
    const related = _ksGetAllApps()
        .filter(a => a.id !== appId && a.category === app.category)
        .slice(0, 5);
    // Compléter avec featured si <5
    if (related.length < 5) {
        for (const id of KSTORE_FEATURED_IDS) {
            if (related.length >= 5) break;
            if (id === appId || related.some(r => r.id === id)) continue;
            const f = _ksGetApp(id); if (f) related.push(f);
        }
    }

    // ── Blocs texte : 100% éditables depuis l'admin (avec fallbacks) ──
    const DEFAULT_DESC_TITLE = 'Bloc texte explicatif pour cette application';
    const DEFAULT_DESC_TEXT  = app.real
        ? 'Cette application Keystone OS a été pensée pour des professionnels exigeants. Renseignez la description complète dans l\'admin (Catalogue → 📝 Éditer).'
        : 'Cette application n\'est pas encore disponible — la coquille vous permet de visualiser la structure de la fiche détail.';

    const DEFAULT_RGPD_TITLE = 'Bloc texte explicatif du respect des règles de confidentialité et du respect des normes RGPD EU';
    const DEFAULT_RGPD_TEXT  = 'Cette application respecte les règles de confidentialité et les normes RGPD en vigueur dans l\'Union Européenne. Aucune donnée saisie n\'est stockée sur des serveurs tiers : tout reste sur votre appareil ou transite uniquement vers le moteur d\'IA que vous avez explicitement configuré.';

    const descTitle = app.descTitle || DEFAULT_DESC_TITLE;
    const descText  = app.longDesc  || DEFAULT_DESC_TEXT;
    const rgpdTitle = app.rgpdTitle || DEFAULT_RGPD_TITLE;
    const rgpdText  = app.rgpdText  || DEFAULT_RGPD_TEXT;

    // Multi-paragraphe : on respecte les sauts de ligne saisis dans l'admin
    const paragraphify = (s) => String(s)
        .split(/\n\s*\n/)
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');

    // ── Icône d'app (uploadable côté admin via app.iconId) ──
    const iconHtml = app.iconId
        ? `<div class="ksfs-detail-icon ksfs-detail-icon--filled"
                style="background-image:url('${CF_API}/api/screenshot/${encodeURIComponent(app.iconId)}')"></div>`
        : `<div class="ksfs-detail-icon"></div>`;

    // ── Assistance → mailto ──
    const SUPPORT_EMAIL = 'protein.keystone@gmail.com';
    const supportSubject = encodeURIComponent(`Keystone OS — Assistance pour ${app.title || app.id}`);
    const supportBody    = encodeURIComponent(`Bonjour,\n\nJ'ai besoin d'aide concernant l'application "${app.title || app.id}".\n\nCordialement,`);
    const supportMailto  = `mailto:${SUPPORT_EMAIL}?subject=${supportSubject}&body=${supportBody}`;

    content.innerHTML = `
        <div class="ksfs-detail">
            <button class="ksfs-detail-back" id="ksfs-detail-back" aria-label="Retour">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                     style="width:14px;height:14px"><polyline points="15 18 9 12 15 6"/></svg>
            </button>

            <!-- Header : icône + titre + prix + notes + meta -->
            <header class="ksfs-detail-head">
                ${iconHtml}
                <div class="ksfs-detail-head-main">
                    <h1 class="ksfs-detail-title">${app.title}</h1>
                    <p class="ksfs-detail-subtitle">${app.shortDesc || app.punchline || ''}</p>
                    <div class="ksfs-detail-action-row">${btnAction}</div>
                </div>

                <div class="ksfs-detail-rating">
                    <div class="ksfs-detail-rating-lbl">Notes</div>
                    <div class="ksfs-detail-rating-val">${ratingStr}<span class="ksfs-detail-rating-max">sur 5</span></div>
                    <div class="ksfs-detail-stars">${starsHTML}</div>
                    <div class="ksfs-detail-rating-hint">
                        ${userRated ? 'Votre note · cliquez pour modifier' : 'Cliquez pour noter cette app'}
                    </div>
                </div>

                <div class="ksfs-detail-meta">
                    <a class="ksfs-detail-meta-lbl ksfs-detail-meta-support"
                       href="${supportMailto}">Assistance</a>
                    <div class="ksfs-detail-meta-block">
                        <div class="ksfs-detail-meta-h">Catégorie</div>
                        <div class="ksfs-detail-meta-v">${catLabel}</div>
                    </div>
                    <div class="ksfs-detail-meta-block">
                        <div class="ksfs-detail-meta-h">Copyright</div>
                        <div class="ksfs-detail-meta-v">${copyright}</div>
                    </div>
                </div>
            </header>

            <!-- Carousel screenshots — vraies images si présentes dans D1, sinon placeholders -->
            <div class="ksfs-detail-shots-wrap">
                <button class="ksfs-detail-shot-nav ksfs-detail-shot-nav--prev" aria-label="Précédent">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                         style="width:14px;height:14px"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <div class="ksfs-detail-shots">
                    ${(() => {
                        const shots = Array.isArray(app.screenshots) ? app.screenshots : [];
                        const slots = [];
                        for (let i = 0; i < Math.max(3, shots.length); i++) {
                            slots.push(shots[i]
                                ? `<div class="ksfs-detail-shot ksfs-detail-shot--filled"
                                        style="background-image:url('${CF_API}/api/screenshot/${encodeURIComponent(shots[i])}')">
                                  </div>`
                                : `<div class="ksfs-detail-shot"></div>`);
                        }
                        return slots.join('');
                    })()}
                </div>
                <button class="ksfs-detail-shot-nav ksfs-detail-shot-nav--next" aria-label="Suivant">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                         style="width:14px;height:14px"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>

            <!-- Badges moteurs IA -->
            <div class="ksfs-detail-engines">
                <div class="ksfs-detail-engine-row">
                    <span class="ksfs-detail-engine-lbl">Optimisé pour</span>
                    <span class="ksfs-detail-engine-chip ksfs-detail-engine-chip--optim">${aiOpt}</span>
                </div>
                <div class="ksfs-detail-engine-row">
                    <span class="ksfs-detail-engine-lbl">Moteur AI compatible</span>
                    ${aiCmp.map(e => `<span class="ksfs-detail-engine-chip">${e}</span>`).join('')}
                </div>
            </div>

            <!-- Bloc texte explicatif -->
            <div class="ksfs-detail-block">
                <div class="ksfs-detail-block-h">${descTitle}</div>
                ${paragraphify(descText)}
            </div>

            <!-- Bloc RGPD -->
            <div class="ksfs-detail-block">
                <div class="ksfs-detail-block-h">${rgpdTitle}</div>
                ${paragraphify(rgpdText)}
            </div>

            <!-- Également pour vous -->
            ${related.length > 0 ? `
                <section class="ksfs-detail-related">
                    <h2 class="ksfs-detail-related-h">Également pour vous :</h2>
                    <div class="ksfs-featured-rail">
                        ${related.map(_renderFeaturedCard).join('')}
                    </div>
                </section>
            ` : ''}
        </div>
    `;
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
    panel.style.top  = (rect.bottom + 8) + 'px';
    panel.style.left = rect.left + 'px';
    document.body.appendChild(panel);
    // Anti-overflow : repositionne si le panel sort du viewport
    requestAnimationFrame(() => {
        const pr = panel.getBoundingClientRect();
        if (pr.right  > window.innerWidth  - 12) panel.style.left = (window.innerWidth  - pr.width  - 12) + 'px';
        if (pr.bottom > window.innerHeight - 12) panel.style.top  = (rect.top - pr.height - 8) + 'px';
    });

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

    // ── Sprint SDQR-1 — Artefacts à workspace fullscreen dédié ──
    // Certains artefacts ne suivent pas le pattern "modal pad" classique
    // (form → output) et nécessitent une fenêtre custom multi-écrans.
    // Routing par id : on intercepte AVANT la résolution PADS_DATA.
    if (padId === 'A-COM-001') { openSDQR(); return; }
    if (padId === 'A-COM-002') { openKodex(); return; }
    if (padId === 'A-COM-003') { openMuse();  return; }
    if (padId === 'A-COM-004') { openPulsa(); return; }

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

    _buildModal(currentPad, tool);

    const _modal = document.getElementById('tool-modal');
    if (_modal) {
        _modal.setAttribute('data-palette', getToolPalette(padId));
        _modal.classList.add('open');
    }
    document.getElementById('tool-backdrop')?.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Sprint Bibliothèque v2 — pré-remplissage depuis un snapshot sauvegardé.
    // Le form a été monté par _buildModal ci-dessus. On déclenche le prefill
    // après un microtask pour laisser les custom selects s'initialiser.
    if (opts?.prefillData) {
        Promise.resolve().then(() => _prefillForm(opts.prefillData));
    }
}

// Pré-remplit le formulaire courant depuis un dict {fieldId: value}.
// Gère inputs standards, textareas, ET custom selects (.ks-select) qui
// stockent leur valeur dans un input hidden + un label visuel séparé.
function _prefillForm(formData) {
    const form = document.getElementById('tool-form');
    if (!form || !formData) return;

    for (const [fieldId, value] of Object.entries(formData)) {
        if (value === '' || value === null || value === undefined) continue;
        const el = form.querySelector(`[name="${fieldId}"]`);
        if (!el) continue;

        // Custom select : injecter dans le hidden + mettre à jour le label
        // visuel + marquer l'option sélectionnée. Sinon le user voit
        // "Sélectionner…" alors que la valeur est en mémoire.
        if (el.type === 'hidden' && el.closest('.ks-select')) {
            const wrap   = el.closest('.ks-select');
            const valEl  = wrap.querySelector('.ks-select-val');
            el.value = value;
            if (valEl) valEl.textContent = value;
            wrap.querySelectorAll('.ks-opt').forEach(o => {
                if (o.dataset.val === value) o.dataset.selected = '';
                else delete o.dataset.selected;
            });
        } else if (el.type === 'hidden' && el.closest('.ks-multiselect')) {
            // Multi-select : value est une string CSV ("SeLoger, LeBonCoin")
            // → check les boxes correspondantes + sync hidden.
            const wrap     = el.closest('.ks-multiselect');
            const selected = String(value).split(',').map(s => s.trim()).filter(Boolean);
            el.value = selected.join(', ');
            wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.checked = selected.includes(cb.value);
            });
        } else {
            el.value = value;
        }
        el.dataset.dirty = '1';
        // Dispatch pour que form-computed + preview réagissent
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
    // Sprint C — Si le pad a un doc_export (DocEngine), on supprime le
    // bouton LLM concurrent. DocEngine produit du PDF print-ready en 1 clic
    // alors que l'LLM produit du HTML à copier-coller (workflow obsolète).
    // Pour les autres pads (Annonces, Posts, Emails…), le bouton LLM reste
    // le seul moyen de générer du contenu — donc on le garde.
    const hasDocExport = !!pad.doc_export;

    const requiredCount = pad.fields.filter(f => f.required).length;
    const generateBtn = hasDocExport
        ? ''  // VEFA-like : remplacé par btn-doc-export
        : (hasKey
            ? `<button class="btn-generate" id="btn-generate" ${requiredCount > 0 ? 'disabled' : ''}>
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                   Générer avec ${engine}
               </button>`
            : `<button class="no-api-hint" id="no-api-link" type="button">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                   Configurer une clé API pour générer directement
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0;opacity:.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
               </button>`);

    // ── Sprint C — bouton primary "Notice PDF" via DocEngine ──────
    // Quand présent, c'est LE CTA principal du pad (style btn-generate).
    const docExportBtn = hasDocExport
        ? `<button class="btn-generate btn-doc-primary" id="btn-doc-export" type="button" title="Générer la notice PDF print-ready">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0">
                   <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                   <polyline points="14 2 14 8 20 8"/>
                   <line x1="9" y1="13" x2="15" y2="13"/>
                   <line x1="9" y1="17" x2="13" y2="17"/>
               </svg>
               <span>${pad.doc_export.label || 'Notice PDF'}</span>
               <span class="btn-doc-export-spinner" hidden>
                   <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="14 28" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle></svg>
               </span>
           </button>`
        : '';

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
                    ${[1,2,3,4,5].map(v => `
                        <button type="button" class="rating-star" data-v="${v}" aria-label="${v} étoile${v > 1 ? 's' : ''}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15 9 22 9.5 16.5 14.5 18 22 12 18 6 22 7.5 14.5 2 9.5 9 9 12 2"/></svg>
                        </button>
                    `).join('')}
                </div>
            </div>
            <button class="modal-close" id="modal-close-btn" aria-label="Fermer">✕</button>
        </div>

        <div class="modal-body${hasDocExport ? ' modal-body--solo' : ''}">

            <!-- FORMULAIRE (pleine largeur si doc_export, sinon 65%) -->
            <div class="modal-form">
                <form id="tool-form" class="form-grid" onsubmit="return false">
                    ${fieldsHTML}
                </form>

                ${hasDocExport ? `
                <!-- Sprint 4.1 — Warnings inline pour pads doc_export (remplace
                     l'ancien panneau droit "Notice Portable"). Le résultat
                     s'ouvre dans une nouvelle fenêtre via DocEngine. -->
                <div class="form-warnings" id="form-warnings" hidden></div>
                ` : ''}

                <div class="modal-actions-row">
                    ${generateBtn}
                    ${docExportBtn}
                    ${hasDocExport ? `
                    <button class="action-btn action-btn-compact" id="btn-library" type="button" title="Sauvegarder dans la bibliothèque">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        Bibliothèque
                    </button>
                    <button class="action-btn action-btn-compact" id="btn-notice" type="button" title="Notice d'utilisation">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2"/></svg>
                        Notice
                    </button>
                    ` : ''}
                </div>

                ${hasDocExport ? `
                <div class="tool-notice" id="tool-notice">${_renderNotice(pad.notice)}</div>
                ` : ''}
            </div>

            ${!hasDocExport ? `
            <!-- ZONE DROITE : Prompt live (pads LLM classiques uniquement) -->
            <div class="modal-result-zone" data-mode="prompt">

                <div class="result-lbl" id="result-lbl">Prompt généré</div>

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
            ` : ''}
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

    // Custom selects — init après injection du HTML
    const toolForm = document.getElementById('tool-form');
    if (toolForm) _initCustomSelects(toolForm);

    // Sprint 5 — Multi-select (checkboxes synchronisés vers un hidden CSV)
    if (toolForm) _initMultiSelects(toolForm);

    // Sprint P3 — Boutons AI Assist (PromptEngine) sur les champs déclarés
    if (toolForm) _initAIAssistButtons(toolForm, pad);

    // Sprint 4.2 — Auto-calculs déclaratifs (HT/TTC, échéancier, lettres)
    // No-op si pad.computed_fields absent.
    if (toolForm) initComputedFields(toolForm, pad);

    // Sprint C — Bouton Doc Export (DocEngine, génération PDF directe)
    _initDocExportButton(pad);

    // Prompt live — écoute tous les champs du formulaire
    // data-dirty : marque un champ comme "touché" pour activer le highlight si vide
    toolForm?.addEventListener('input', e => {
        e.target.dataset.dirty = '1';
        _updatePromptPreview(pad);
    });
    toolForm?.addEventListener('change', e => {
        e.target.dataset.dirty = '1';
        _updatePromptPreview(pad);
    });

    // 📋 Copier le prompt (mode prompt) OU la notice portable (mode doc_export)
    // SAFARI : la copie clipboard ne fonctionne que dans le user gesture
    // immédiat. Pour éviter "copie bloquée" au 1er clic, on essaie d'abord
    // de copier depuis le cache SYNC. Si le cache n'est pas prêt, on tombe
    // en mode async avec fallback execCommand.
    document.getElementById('btn-copy-prompt')?.addEventListener('click', async (ev) => {
        const btn = document.getElementById('btn-copy-prompt');
        if (!btn) return;
        const origHTML = btn.innerHTML;
        btn.classList.add('active');

        // ── Tentative SYNC : cache déjà prêt → copy immédiat ────────
        // Préserve le user gesture pour Safari (pas d'await avant copy).
        if (pad.doc_export) {
            const form = document.getElementById('tool-form');
            const formData = {};
            form?.querySelectorAll('[name]').forEach(el => { formData[el.name] = (el.value || '').trim(); });
            const sig = _formSignature(formData);
            if (_portableCache.padId === pad.id && _portableCache.signature === sig && _portableCache.content) {
                // Copy SYNC depuis cache (idéal — pas de await)
                const ok = _copyToClipboardSync(_portableCache.content);
                btn.innerHTML = ok ? '✓ Copié !' : '✗ Copie bloquée';
                setTimeout(() => { btn.innerHTML = origHTML; btn.classList.remove('active'); }, ok ? 2000 : 3000);
                return;
            }
            // Cache absent : génère + fallback async
            btn.innerHTML = '⏳ Génération…';
        }

        // ── Fallback ASYNC : cache pas prêt ou mode prompt classique ─
        let payload = '';
        try {
            if (pad.doc_export) {
                const form = document.getElementById('tool-form');
                const formData = {};
                form?.querySelectorAll('[name]').forEach(el => { formData[el.name] = (el.value || '').trim(); });
                const cached = await _prebuildPortableBloc(pad, formData);
                payload = cached?.content || '';
            } else {
                payload = document.getElementById('prompt-text')?.textContent || '';
            }
        } catch (e) {
            console.error('[copy-prompt] erreur build :', e);
        }

        if (!payload) {
            btn.innerHTML = '✗ Erreur — voir console';
            setTimeout(() => { btn.innerHTML = origHTML; btn.classList.remove('active'); }, 2500);
            return;
        }

        const ok = await _copyToClipboardAsync(payload);
        if (ok) {
            btn.innerHTML = '✓ Copié !';
        } else {
            // Indication explicite + invite à recliquer (cache maintenant prêt)
            btn.innerHTML = '↻ Cliquez à nouveau';
        }
        setTimeout(() => { btn.innerHTML = origHTML; btn.classList.remove('active'); }, ok ? 2000 : 3000);
    });

    // ⬇ Télécharger .html (doc_export uniquement) — fichier auto-suffisant
    // ouvrable hors-ligne dans n'importe quel navigateur, prêt à imprimer.
    document.getElementById('btn-download-html')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-download-html');
        if (!btn) return;
        const origHTML = btn.innerHTML;
        btn.innerHTML = '⏳ Préparation…';
        btn.classList.add('active');

        const form = document.getElementById('tool-form');
        const formData = {};
        form?.querySelectorAll('[name]').forEach(el => { formData[el.name] = (el.value || '').trim(); });

        const cached = await _prebuildPortableBloc(pad, formData);
        if (!cached?.html) {
            btn.innerHTML = '✗ Erreur';
            setTimeout(() => { btn.innerHTML = origHTML; btn.classList.remove('active'); }, 1500);
            return;
        }

        // Nom de fichier : notice-vefa-PROGRAMME-DATE.html
        const slug = (formData.nom_programme || 'notice')
            .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
        const date = new Date().toISOString().slice(0, 10);
        const filename = `notice-vefa-${slug}-${date}.html`;

        // Blob → URL temporaire → download via <a>
        const blob = new Blob([cached.html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);

        btn.innerHTML = '✓ Téléchargé !';
        setTimeout(() => { btn.innerHTML = origHTML; btn.classList.remove('active'); }, 2000);
    });

    // 📚 Bibliothèque — sauvegarde dans localStorage ks_library
    // v2 : stocke aussi formData pour permettre Recharger (pas seulement Copier).
    document.getElementById('btn-library')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-library');
        if (!btn) return;
        const orig = btn.textContent;

        // Collecte systématique du formData — utile pour Recharger même en mode LLM
        const form = document.getElementById('tool-form');
        const formData = {};
        form?.querySelectorAll('[name]').forEach(el => { formData[el.name] = (el.value || '').trim(); });

        let payload = '';
        if (pad.doc_export) {
            // Mode portable : on tente le cache, sinon génération à la volée
            const sig = _formSignature(formData);
            if (_portableCache.padId === pad.id && _portableCache.signature === sig && _portableCache.content) {
                payload = _portableCache.content;
            } else {
                btn.textContent = '⏳ …';
                const cached = await _prebuildPortableBloc(pad, formData);
                payload = cached?.content || '';
            }
        } else {
            payload = document.getElementById('prompt-text')?.textContent || '';
        }

        if (!payload || payload.startsWith('Remplissez')) {
            btn.textContent = '✗ Remplis d\'abord les champs requis';
            btn.classList.add('active');
            setTimeout(() => { btn.textContent = orig; btn.classList.remove('active'); }, 2500);
            return;
        }

        const ok = _saveToLibrary(pad, payload, formData);
        btn.textContent = ok ? '✓ Sauvegardé !' : '✗ Erreur';
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
                    ${[1,2,3,4,5].map(v => `
                        <button type="button" class="rating-star" data-v="${v}" aria-label="${v} étoile${v > 1 ? 's' : ''}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15 9 22 9.5 16.5 14.5 18 22 12 18 6 22 7.5 14.5 2 9.5 9 9 12 2"/></svg>
                        </button>
                    `).join('')}
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
                    <label class="form-label">
                        Contexte additionnel <span style="font-weight:400;opacity:.6">(optionnel)</span>
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

const _CHEVRON_SVG = `<svg class="ks-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6l4 4 4-4"/></svg>`;

function _buildField(f) {
    const spanCls = f.span === 'full' ? ' full' : '';
    const req     = f.required ? ' <span class="req">*</span>' : '';
    let input = '';

    if (f.type === 'select') {
        const defaultVal = (f.options || [])[0] || '';
        const opts = (f.options || []).map((o, i) =>
            `<div class="ks-opt" data-val="${o}"${i === 0 ? ' data-selected' : ''} role="option">${o}</div>`
        ).join('');
        input = `
            <div class="ks-select" data-field="${f.id}">
                <div class="ks-select-trigger" id="ks-wrap-${f.id}">
                    <button type="button" class="ks-select-btn" aria-haspopup="listbox" aria-expanded="false" id="ks-btn-${f.id}">
                        <span class="ks-select-val">${defaultVal}</span>
                    </button>
                    ${_CHEVRON_SVG}
                </div>
                <div class="ks-select-list" role="listbox" hidden id="ks-list-${f.id}">${opts}</div>
                <input type="hidden" id="f-${f.id}" name="${f.id}" value="${defaultVal}">
            </div>`;
    } else if (f.type === 'multiselect') {
        // Sprint 5 — Champ multi-cases pour portails / canaux / tons.
        // Stocke la valeur sous forme de string CSV ("SeLoger,LeBonCoin")
        // dans un input hidden — compatible avec form serialization +
        // _interpolate (substitué tel quel dans {{portails}}).
        const defaultArr = Array.isArray(f.default) ? f.default : [];
        const defaultVal = defaultArr.join(', ');
        const opts = (f.options || []).map(o => {
            const checked = defaultArr.includes(o) ? 'checked' : '';
            return `<label class="ks-multi-opt">
                <input type="checkbox" value="${o}" ${checked}>
                <span class="ks-multi-opt-lbl">${o}</span>
            </label>`;
        }).join('');
        input = `
            <div class="ks-multiselect" data-field="${f.id}">
                <div class="ks-multi-grid">${opts}</div>
                <input type="hidden" id="f-${f.id}" name="${f.id}" value="${defaultVal}">
            </div>`;
    } else if (f.type === 'textarea') {
        input = `<textarea class="form-textarea" id="f-${f.id}" name="${f.id}" placeholder="${f.placeholder || ''}"></textarea>`;
    } else {
        input = `<input class="form-input" type="${f.type}" id="f-${f.id}" name="${f.id}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''}>`;
    }

    // ── Sprint P3 — Bouton AI Assist (PromptEngine) ─────────────
    // Si le champ déclare `ai_assist`, on ajoute un bouton qui appelle
    // le PromptEngine pour rédiger automatiquement. Le binding effectif
    // se fait dans _initAIAssistButtons() après injection HTML.
    const aiAssistBtn = f.ai_assist ? `
        <div class="ai-assist-wrap">
            <button type="button" class="ai-assist-btn"
                    data-field-id="${f.id}"
                    aria-label="Générer avec IA">
                <span class="ai-assist-icon">✨</span>
                <span class="ai-assist-label">${f.ai_assist.label || 'Générer avec IA'}</span>
                <span class="ai-assist-spinner" hidden>
                    <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="14 28" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle></svg>
                </span>
            </button>
            <span class="ai-assist-status" id="ai-status-${f.id}"></span>
        </div>` : '';

    return `
        <div class="form-field${spanCls}">
            <label class="form-label" for="${f.type === 'select' ? 'ks-btn-' : 'f-'}${f.id}" style="text-transform:none;letter-spacing:normal;font-size:14px;font-weight:500;">${f.label}${req}</label>
            ${input}
            ${aiAssistBtn}
        </div>
    `;
}

// ── Custom select — init des événements après injection HTML ───
function _initCustomSelects(container) {
    // Close all open selects
    const _closeAll = () => {
        container.querySelectorAll('.ks-select-btn[aria-expanded="true"]').forEach(btn => {
            btn.setAttribute('aria-expanded', 'false');
            btn.closest('.ks-select').querySelector('.ks-select-list').hidden = true;
            btn.closest('.ks-select-trigger')?.classList.remove('open');
        });
    };

    container.querySelectorAll('.ks-select').forEach(wrap => {
        const btn     = wrap.querySelector('.ks-select-btn');
        const trigger = wrap.querySelector('.ks-select-trigger');
        const list    = wrap.querySelector('.ks-select-list');
        const hidden  = wrap.querySelector('input[type="hidden"]');
        if (!btn || !list || !hidden) return;

        // Toggle open/close
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = btn.getAttribute('aria-expanded') === 'true';
            _closeAll();
            if (!isOpen) {
                btn.setAttribute('aria-expanded', 'true');
                list.hidden = false;
                trigger?.classList.add('open');
                // Position check — ouvre vers le haut si trop bas
                const rect = list.getBoundingClientRect();
                if (rect.bottom > window.innerHeight - 16) {
                    list.style.top = 'auto';
                    list.style.bottom = 'calc(100% + 4px)';
                } else {
                    list.style.top = '';
                    list.style.bottom = '';
                }
            }
        });

        // Pick an option
        list.addEventListener('click', e => {
            const opt = e.target.closest('.ks-opt');
            if (!opt) return;
            const val = opt.dataset.val;
            // Update display + hidden value
            btn.querySelector('.ks-select-val').textContent = val;
            hidden.value = val;
            // Mark selected
            list.querySelectorAll('.ks-opt').forEach(o => delete o.dataset.selected);
            opt.dataset.selected = '';
            // Mark dirty + dispatch change for prompt preview
            hidden.dataset.dirty = '1';
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
            // Close
            _closeAll();
        });
    });

    // Global click closes all selects
    document.addEventListener('click', _closeAll, { capture: true, once: false });
}

// ══════════════════════════════════════════════════════════════════
// MULTI-SELECT (Sprint 5) — Grille de checkboxes liée à un hidden CSV
// ══════════════════════════════════════════════════════════════════
// Synchronise les cases cochées vers un input[type=hidden] dont la valeur
// est une string CSV ("SeLoger, LeBonCoin"). Le hidden porte le name du
// champ → ce CSV apparaît tel quel dans le prompt via {{portails}}.
function _initMultiSelects(container) {
    container.querySelectorAll('.ks-multiselect').forEach(wrap => {
        const hidden = wrap.querySelector('input[type="hidden"]');
        if (!hidden) return;
        wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const selected = [...wrap.querySelectorAll('input[type="checkbox"]:checked')]
                    .map(c => c.value);
                hidden.value = selected.join(', ');
                hidden.dataset.dirty = '1';
                hidden.dispatchEvent(new Event('input',  { bubbles: true }));
                hidden.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
    });
}

// ══════════════════════════════════════════════════════════════════
// AI ASSIST (Sprint P3) — boutons "✨ Générer avec IA" par champ
// ══════════════════════════════════════════════════════════════════
// Branche un bouton sur chaque champ qui déclare `ai_assist` dans le JSON.
// Au clic :
//   1. Collecte les valeurs du formulaire
//   2. Interpole `topic` avec {var} → texte sujet
//   3. Construit `details` depuis `include_fields` (sauf vides)
//   4. Choisit le moteur (active engine si disponible, fallback gemini)
//   5. Appelle promptEngine.run() — affiche spinner pendant
//   6. Injecte le texte dans le textarea — déclenche les events 'input'
//      pour que la prévisualisation du prompt se mette à jour
//   7. Gestion erreurs : clé manquante (vers Réglages), quota, réseau

// Mapping label dashboard → engine id PromptEngine (cf. prompt-engine.js).
// Différent de ENGINE_LABEL_TO_ID (qui mappe vers les ids D1 historiques).
const _ENGINE_LABEL_TO_PROMPT_ENGINE = {
    'Claude'    : 'claude',
    'ChatGPT'   : 'gpt',
    'Gemini'    : 'gemini',
    'Grok'      : 'grok',
    'Perplexity': 'perplexity',
    'Mistral'   : 'mistral',
    'Llama'     : 'llama',
};

// Renvoie la liste ORDONNÉE des moteurs à essayer :
//   1. L'engine actif des Réglages (si clé présente)
//   2. Puis Gemini (free tier prioritaire)
//   3. Puis le reste : claude, gpt, mistral, grok, perplexity, llama
// Permet à _handleAIAssist d'enchaîner les tentatives sur erreur quota/crédit.
function _resolveAIEngines() {
    const activeLabel  = getActiveEngine();
    const activeEngine = _ENGINE_LABEL_TO_PROMPT_ENGINE[activeLabel] || 'gemini';

    const engines = window.promptEngine?.listEngines() || [];
    const withKey = new Set(engines.filter(e => e.hasApiKey).map(e => e.id));

    const preferred = ['gemini', 'claude', 'gpt', 'mistral', 'grok', 'perplexity', 'llama'];

    const ordered = [];
    if (withKey.has(activeEngine)) ordered.push(activeEngine);
    for (const id of preferred) {
        if (id === activeEngine) continue;       // déjà en tête
        if (withKey.has(id)) ordered.push(id);
    }
    return ordered;
}

function _initAIAssistButtons(container, pad) {
    container.querySelectorAll('.ai-assist-btn').forEach(btn => {
        const fieldId = btn.dataset.fieldId;
        const fieldDef = pad.fields.find(f => f.id === fieldId);
        if (!fieldDef?.ai_assist) return;

        btn.addEventListener('click', () => _handleAIAssist(btn, fieldId, fieldDef.ai_assist, pad));
    });
}

async function _handleAIAssist(btn, fieldId, aiConfig, pad) {
    if (btn.disabled) return;

    const textarea = document.getElementById(`f-${fieldId}`);
    const statusEl = document.getElementById(`ai-status-${fieldId}`);
    const spinner  = btn.querySelector('.ai-assist-spinner');
    const iconEl   = btn.querySelector('.ai-assist-icon');

    // ── 1. Engine resolution (liste ordonnée pour fallback) ────
    if (!window.promptEngine) {
        _setAIStatus(statusEl, 'PromptEngine indisponible — rechargez la page.', 'error');
        return;
    }
    const enginesToTry = _resolveAIEngines();
    if (enginesToTry.length === 0) {
        _setAIStatus(statusEl,
            'Aucune clé API configurée. Ouvrez ⚙ Réglages → Clés API.',
            'error');
        return;
    }

    // ── 2. Collecte form data ──────────────────────────────────
    const form = document.getElementById('tool-form');
    const formData = {};
    form?.querySelectorAll('[name]').forEach(el => { formData[el.name] = (el.value || '').trim(); });

    // ── 3. Interpolation du topic ──────────────────────────────
    // Remplace {var} par formData[var] ou un placeholder lisible si vide.
    const topic = (aiConfig.topic || `Rédige une section sur ${fieldId}`).replace(
        /\{(\w+)\}/g,
        (_, k) => formData[k] || `[${k} à renseigner]`
    );

    // ── 4. Construction du contexte détaillé ───────────────────
    const includeFields = aiConfig.include_fields || [];
    const detailParts = includeFields
        .map(fid => {
            const f = pad.fields.find(ff => ff.id === fid);
            const v = formData[fid];
            return (f && v) ? `${f.label} : ${v}` : null;
        })
        .filter(Boolean);

    // Si l'utilisateur a tapé des mots-clés dans le textarea, on les passe aussi
    const currentValue = formData[fieldId];
    if (currentValue) {
        detailParts.push(`Mots-clés / éléments à intégrer : ${currentValue}`);
    }
    const details = detailParts.join('. ');

    // ── 5. UI : passage en mode "loading" ──────────────────────
    btn.disabled = true;
    btn.classList.add('loading');
    iconEl?.setAttribute('hidden', '');
    spinner?.removeAttribute('hidden');

    // Pattern d'erreur qui doit déclencher la BASCULE vers le moteur suivant
    // (quota, crédit, plan, billing). Différent de 503 (sature transitoire).
    const isQuotaError = (msg) =>
        /credit|quota|insufficient|429|balance|billing|payment|exceed|too low/i.test(msg);
    // 503 = retry sur le MÊME moteur (sature temporairement).
    const isTransient = (msg) =>
        /503|high demand|overload|unavailable|temporar/i.test(msg);

    let result = null;
    let usedEngine = null;
    let lastErr = null;

    try {
        // Boucle de fallback sur la liste d'engines disponibles.
        // Si quota épuisé sur engine N → on bascule sur engine N+1.
        for (let i = 0; i < enginesToTry.length; i++) {
            const engineId = enginesToTry[i];
            const isFallback = i > 0;

            if (isFallback) {
                const prev = enginesToTry[i - 1];
                _setAIStatus(statusEl,
                    `${prev} indisponible — bascule sur ${engineId}…`, 'loading');
                await new Promise(r => setTimeout(r, 500)); // courte pause visuelle
            } else {
                _setAIStatus(statusEl, `${engineId} rédige…`, 'loading');
            }

            // Retry interne sur 503 (Gemini sature régulièrement) :
            // 3 tentatives max, backoff 1.5s puis 3.5s. Sur autre erreur → out.
            const RETRY_DELAYS = [0, 1500, 3500];
            let attemptResult = null;
            let attemptErr = null;
            for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
                if (attempt > 0) {
                    _setAIStatus(statusEl,
                        `${engineId} sature — nouvelle tentative dans ${RETRY_DELAYS[attempt]/1000}s…`, 'loading');
                    await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
                    _setAIStatus(statusEl, `${engineId} rédige (essai ${attempt+1}/3)…`, 'loading');
                }
                try {
                    attemptResult = await window.promptEngine.run({
                        task   : aiConfig.task || 'redact-section',
                        engine : engineId,
                        context: { topic, details },
                    });
                    if (attemptResult?.text) break;
                    attemptErr = new Error('Réponse vide du moteur');
                } catch (e) {
                    attemptErr = e;
                    const msg = e?.message || '';
                    if (!isTransient(msg)) break;  // erreur non-transitoire → sortie de la boucle retry
                }
            }

            if (attemptResult?.text) {
                result = attemptResult;
                usedEngine = engineId;
                break;  // succès → on sort de la boucle fallback
            }

            // Échec sur cet engine. On bascule UNIQUEMENT si c'est une
            // erreur quota/crédit. Autres erreurs (clé invalide, network) → out.
            lastErr = attemptErr;
            const msg = attemptErr?.message || '';
            if (!isQuotaError(msg)) {
                // Cas non récupérable : on n'essaie pas un autre moteur.
                throw attemptErr;
            }
            // Sinon on continue la boucle fallback (i++)
        }

        if (!result?.text) {
            throw lastErr || new Error('Aucun moteur disponible — quotas épuisés sur tous');
        }

        // Injecte dans le textarea + déclenche les events pour mettre
        // à jour le prompt preview (qui écoute 'input').
        if (textarea) {
            textarea.value = result.text;
            textarea.dataset.dirty = '1';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const outTokens = result.usage?.output_tokens || '?';
        const fallbackMark = (usedEngine !== enginesToTry[0]) ? ' (fallback)' : '';
        _setAIStatus(statusEl,
            `✓ Rédigé par ${usedEngine}${fallbackMark} (${outTokens} tokens)`, 'success');
        // Efface le message après 4s
        setTimeout(() => _setAIStatus(statusEl, '', null), 4000);
    } catch (err) {
        const msg = err?.message || 'Erreur inconnue';
        const failedEngine = usedEngine || enginesToTry[0] || '?';
        // Erreurs courantes traduites en français
        let friendly = msg;
        if (/clé API/i.test(msg))      friendly = `Clé ${failedEngine} manquante — Réglages → Clés API`;
        else if (/credit|quota|429|insufficient|balance/i.test(msg)) {
            const tried = enginesToTry.join(', ');
            friendly = `Quotas épuisés sur tous les moteurs disponibles (${tried}). Rechargez un compte ou réessayez plus tard.`;
        }
        else if (/network|timeout|fetch/i.test(msg)) friendly = `Problème réseau — vérifiez votre connexion`;
        else if (/^PromptEngine: /.test(msg)) friendly = msg.replace(/^PromptEngine: /, '');
        _setAIStatus(statusEl, '✗ ' + friendly, 'error');
        console.warn('[ai-assist]', err);
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        iconEl?.removeAttribute('hidden');
        spinner?.setAttribute('hidden', '');
    }
}

function _setAIStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ai-assist-status' + (kind ? ` ai-assist-status-${kind}` : '');
}

// ══════════════════════════════════════════════════════════════════
// DOC EXPORT (Sprint C — VEFA Studio v3) — bouton "Notice PDF"
// ══════════════════════════════════════════════════════════════════
// Génération directe d'une notice PDF print-ready, sans appel LLM.
// Le pad déclare `doc_export: { templateId, variable_map, label }` et
// on délègue tout au DocEngine (lib/doc-engine.js) :
//   1. Lecture du template HTML sanctuarisé
//   2. Substitution [[VAR]] depuis les champs du formulaire
//   3. Substitution [[CLAUSE_KEY]] depuis la bibliothèque D1 (fillClauses)
//   4. Pagination A4 via Paged.js dans une fenêtre fille
//   5. Toolbar Imprimer/PDF/Fermer injectée après pagination

function _initDocExportButton(pad) {
    const btn = document.getElementById('btn-doc-export');
    if (!btn || !pad.doc_export) return;
    btn.addEventListener('click', () => _handleDocExport(btn, pad));
}

async function _handleDocExport(btn, pad) {
    if (btn.disabled) return;

    if (!window.docEngine) {
        _toast('DocEngine indisponible — rechargez la page.', 'error');
        return;
    }

    const cfg = pad.doc_export;
    const form = document.getElementById('tool-form');
    if (!form) return;

    // ── Collecte form data ─────────────────────────────────────
    const formData = {};
    form.querySelectorAll('[name]').forEach(el => { formData[el.name] = (el.value || '').trim(); });

    // ── Variables (mapping + dérivées, factorisé) ──────────────
    const variables = _buildDocExportVariables(pad, formData);

    // ── UI : passage en mode loading ───────────────────────────
    btn.disabled = true;
    btn.classList.add('loading');
    btn.querySelector('.btn-doc-export-spinner')?.removeAttribute('hidden');

    try {
        const result = await window.docEngine.render({
            templateId: cfg.templateId,
            variables,
            mode      : 'preview',
        });

        if (result.missing?.length) {
            console.warn('[doc-export] marqueurs non remplis :', result.missing);
            _toast(`Notice générée — ${result.missing.length} marqueur(s) non rempli(s) (voir console)`, 'warning');
        } else {
            _toast('Notice PDF prête — utilisez le bouton PDF dans la fenêtre', 'success');
        }
    } catch (err) {
        console.error('[doc-export]', err);
        const msg = err?.message || 'Erreur inconnue';
        let friendly = msg;
        if (/popup|fenêtre/i.test(msg)) friendly = 'Pop-up bloquée — autorisez les pop-ups pour ce site';
        else if (/template/i.test(msg)) friendly = 'Template introuvable — contactez Protein Studio';
        else if (/clauses/i.test(msg)) friendly = 'Clauses introuvables — rechargez la page';
        _toast('✗ ' + friendly, 'error');
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.querySelector('.btn-doc-export-spinner')?.setAttribute('hidden', '');
    }
}

// Toast minimaliste (réutilisé par doc-export, peut servir ailleurs).
// Crée un container global lazy au premier usage.
function _toast(message, kind = 'info') {
    let el = document.getElementById('ks-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'ks-toast';
        el.className = 'ks-toast';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = `ks-toast ks-toast-${kind} ks-toast-show`;
    clearTimeout(_toast._timer);
    _toast._timer = setTimeout(() => { el.classList.remove('ks-toast-show'); }, 4500);
}

// ── État de suivi pour la transition empty → ready ────────────
let _promptWasReady  = false;
let _promptTWTimer   = null;   // typewriter character timer
let _promptDebounce  = null;   // debounce pour les updates post-ready

// ══════════════════════════════════════════════════════════════════
// VALIDATION SOFT (Sprint Correctif) — incohérences non bloquantes
// ══════════════════════════════════════════════════════════════════
// Détecte les combinaisons de valeurs absurdes (T2 + 200m², etc.)
// et affiche un warning visible mais non bloquant. L'utilisateur
// peut quand même générer son document — c'est juste un garde-fou.
//
// Renvoie un tableau d'objets { field, message } pour chaque incohérence.
// À étendre avec d'autres règles métier au fil du temps.

function _validateFormSoft(formData) {
    const warnings = [];

    // Règle 1 — Type de lot vs surface habitable
    // T2 standard : 35-55 m². T3 : 55-80 m². T4 : 75-110 m². Penthouse/Villa : variable.
    const type = formData.type_logement;
    const surface = parseFloat(formData.surface);
    if (type && !isNaN(surface) && surface > 0) {
        const ranges = {
            'T2'       : { min: 30,  max: 65,  expected: '35-55 m²' },
            'T3'       : { min: 50,  max: 95,  expected: '55-80 m²' },
            'T4'       : { min: 70,  max: 130, expected: '75-110 m²' },
            'T5'       : { min: 95,  max: 180, expected: '95-150 m²' },
            'Villa'    : { min: 80,  max: 400, expected: '80-300 m²' },
            'Penthouse': { min: 80,  max: 400, expected: '80-300 m²' },
        };
        const r = ranges[type];
        if (r && (surface < r.min || surface > r.max)) {
            warnings.push({
                field: 'surface',
                message: `Surface inhabituelle pour un ${type} (${r.expected} attendu, ${surface} m² saisis)`,
            });
        }
    }

    // Règle 2 — Surface 0 ou négative
    if (formData.surface && (isNaN(surface) || surface <= 0)) {
        warnings.push({ field: 'surface', message: 'Surface invalide' });
    }

    // (Place pour règles futures : RE2020 vs isolation, etc.)
    return warnings;
}

// ══════════════════════════════════════════════════════════════════
// NOTICE PORTABLE (Sprint B2) — bloc HTML auto-suffisant
// ══════════════════════════════════════════════════════════════════
// Pour les pads avec doc_export, on remplace le prompt LLM (obsolète)
// par un bloc portable : instructions + HTML résolu (template + variables
// + clauses). Ce bloc peut être collé dans n'importe quelle IA ou
// sauvegardé en .html — la qualité du PDF reste identique partout.
//
// Cache du bloc portable : généré async via DocEngine, mis en cache
// pour éviter les re-renders à chaque keystroke (debounce 500ms).

let _portableCache = { padId: null, signature: null, content: null, html: null };
let _portableTimer = null;

// ══════════════════════════════════════════════════════════════════
// SPRINT 4.1 — Mode SOLO pour pads doc_export
// ══════════════════════════════════════════════════════════════════
// Plus de panneau résultat à droite. Le formulaire prend toute la
// largeur. La génération PDF déclenche l'ouverture d'une nouvelle
// fenêtre (Paged.js). On gère uniquement :
//   - highlight des champs requis manquants (data-dirty)
//   - banner warnings inline (validation soft)
//   - état enabled/disabled du bouton "Contrat PDF" / "Notice PDF"

function _updateDocExportSolo(pad, formData, requiredFilled, missingFields) {
    const form         = document.getElementById('tool-form');
    const warningsEl   = document.getElementById('form-warnings');
    const docExportBtn = document.getElementById('btn-doc-export');
    if (!form) return;

    // ── Highlight des champs requis manquants (uniquement dirty) ──
    form.querySelectorAll('.field-missing').forEach(el => el.classList.remove('field-missing'));
    if (!requiredFilled) {
        missingFields.forEach(f => {
            const el = form.querySelector(`[name="${f.id}"]`);
            if (el && el.dataset.dirty) el.classList.add('field-missing');
        });
    }

    // ── État du bouton doc_export ─────────────────────────────────
    if (docExportBtn) docExportBtn.disabled = !requiredFilled;

    // ── Banner warnings (validation soft) ─────────────────────────
    if (!warningsEl) return;
    const warnings = requiredFilled ? _validateFormSoft(formData) : [];
    if (warnings.length === 0) {
        warningsEl.hidden = true;
        warningsEl.innerHTML = '';
        return;
    }
    warningsEl.hidden = false;
    warningsEl.innerHTML = `
        <div class="form-warnings-head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Vérifications — non bloquant
        </div>
        <ul>${warnings.map(w => `<li>${w.message}</li>`).join('')}</ul>
    `;
}

function _updatePortableNoticePreview(pad, formData, requiredFilled, missingFields, requiredFields) {
    const preview    = document.getElementById('portable-card');
    const promptText = document.getElementById('prompt-text');
    const emptyState = document.getElementById('prompt-empty-state');
    const missingEl  = document.getElementById('prompt-missing-fields');
    const resultLbl  = document.getElementById('result-lbl');
    const form       = document.getElementById('tool-form');
    if (!preview) return;

    // Cache toujours le prompt-text (legacy) en mode portable
    if (promptText) promptText.style.display = 'none';

    // ── État vide : champs requis manquants ────────────────────
    if (!requiredFilled) {
        form?.querySelectorAll('.field-missing').forEach(el => el.classList.remove('field-missing'));
        missingFields.forEach(f => {
            const el = form?.querySelector(`[name="${f.id}"]`);
            if (el && el.dataset.dirty) el.classList.add('field-missing');
        });
        if (missingEl) {
            missingEl.innerHTML = missingFields.length === requiredFields.length
                ? ''
                : missingFields.map(f => `<span class="missing-chip">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:9px;height:9px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        ${f.label}
                    </span>`).join('');
        }
        preview.style.display = 'none';
        emptyState && (emptyState.style.display = '');
        if (resultLbl) resultLbl.classList.remove('result-lbl-ready');
        return;
    }

    // ── Tous les champs requis remplis : on affiche la carte ───
    if (missingEl) missingEl.innerHTML = '';
    form?.querySelectorAll('.field-missing').forEach(el => el.classList.remove('field-missing'));
    emptyState && (emptyState.style.display = 'none');
    preview.style.display = '';
    if (resultLbl) resultLbl.classList.add('result-lbl-ready');

    // ── Carte résumé (rapide, synchrone) ───────────────────────
    const cfg     = pad.doc_export;
    const mapVars = cfg.variable_map || {};
    const filled  = Object.values(mapVars).filter(fid => formData[fid]).length;
    const total   = Object.keys(mapVars).length;
    const program = formData.nom_programme || '—';
    const lot     = formData.type_logement || '—';
    const surface = formData.surface ? `${formData.surface} m²` : '—';
    const ville   = formData.ville || '';

    // Validation soft : détecte les incohérences non bloquantes
    const warnings = _validateFormSoft(formData);
    const warningsHTML = warnings.length ? `
        <div class="portable-warnings">
            ${warnings.map(w => `
                <div class="portable-warning">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex-shrink:0;color:#f59e0b"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span><strong>${esc(w.field)}</strong> — ${esc(w.message)}</span>
                </div>
            `).join('')}
        </div>` : '';

    preview.innerHTML = `
        <div class="portable-summary">
            <div class="portable-summary-row">
                <span class="portable-summary-key">Programme</span>
                <span class="portable-summary-val">${esc(program)}</span>
            </div>
            <div class="portable-summary-row">
                <span class="portable-summary-key">Lot</span>
                <span class="portable-summary-val">${esc(lot)} · ${esc(surface)}${ville ? ` · ${esc(ville)}` : ''}</span>
            </div>
            <div class="portable-summary-row">
                <span class="portable-summary-key">Variables</span>
                <span class="portable-summary-val">${filled}/${total} renseignées</span>
            </div>
            <div class="portable-summary-row">
                <span class="portable-summary-key">Template</span>
                <span class="portable-summary-val">${esc(cfg.templateId)}</span>
            </div>
            ${warningsHTML}
            <div class="portable-summary-foot">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px;flex-shrink:0;opacity:.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2"/></svg>
                Compatible Claude.ai, ChatGPT, Gemini, ou navigateur seul.
            </div>
        </div>
    `;

    // ── Pré-génération async du bloc portable (cache pour Copier/Télécharger) ─
    // Debounce 500ms : évite de re-render le HTML à chaque keystroke.
    clearTimeout(_portableTimer);
    _portableTimer = setTimeout(() => _prebuildPortableBloc(pad, formData), 500);
}

// Helper : signature des form data (pour invalidation du cache portable)
function _formSignature(formData) {
    return Object.entries(formData).map(([k, v]) => `${k}=${v}`).sort().join('|');
}

// Pré-construit le bloc portable et le met en cache.
// Appelé async par _updatePortableNoticePreview (debounce 500ms),
// et au moment du clic Copier/Télécharger si pas encore prêt.
//
// Robustesse : timeout 10s pour éviter qu'un dataFabric stuck (IDB lock)
// ou un fetch template bloqué ne fige le bouton "Copier" indéfiniment.
async function _prebuildPortableBloc(pad, formData) {
    const sig = _formSignature(formData);
    if (_portableCache.padId === pad.id && _portableCache.signature === sig && _portableCache.content) {
        return _portableCache;  // cache hit
    }
    if (!window.docEngine) {
        console.warn('[portable] window.docEngine non disponible');
        return null;
    }

    const cfg = pad.doc_export;
    const variables = _buildDocExportVariables(pad, formData);

    try {
        // Timeout 10s pour blinder contre les hangs (IDB lock, fetch stalled, etc.)
        const renderPromise = window.docEngine.render({
            templateId: cfg.templateId,
            variables,
            mode      : 'html',
        });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('DocEngine render timeout (10s)')), 10000)
        );

        const { html, missing } = await Promise.race([renderPromise, timeoutPromise]);

        // Sprint B2 — Standalone : on injecte une mini-toolbar Imprimer/PDF
        // directement dans le HTML pour que le fichier .html téléchargé
        // (ou affiché dans une IA) soit immédiatement actionnable.
        const standaloneHtml = _injectStandaloneToolbar(html);

        const content = _composePortableBloc({ pad, variables, html: standaloneHtml, missing });
        _portableCache = { padId: pad.id, signature: sig, content, html: standaloneHtml };
        return _portableCache;
    } catch (e) {
        console.warn('[portable] erreur de pré-génération :', e?.message || e);
        return null;
    }
}

// Injecte une mini-toolbar [Imprimer · PDF · Fermer] dans le HTML standalone.
// Sobre, en haut à droite, masquée à l'impression via @media print.
// Boutons gérés par un petit script inline (autonome, sans dépendance).
function _injectStandaloneToolbar(html) {
    const toolbar = `
<!-- Toolbar Keystone (injectée pour les fichiers HTML standalone). Cachée à l'impression. -->
<style>
  .ks-standalone-toolbar {
    position: fixed; top: 16px; right: 16px; z-index: 999999;
    display: flex; gap: 6px; padding: 6px;
    background: rgba(20, 24, 35, 0.95); border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .ks-standalone-toolbar button {
    background: transparent; border: none; color: rgba(230,235,245,0.9);
    padding: 8px 14px; border-radius: 7px; font-size: 12.5px; font-weight: 600;
    cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  }
  .ks-standalone-toolbar button:hover { background: rgba(255,255,255,0.08); }
  .ks-standalone-toolbar button:active { background: rgba(255,255,255,0.14); }
  @media print { .ks-standalone-toolbar { display: none !important; } }
</style>
<div class="ks-standalone-toolbar" id="ks-toolbar">
  <button onclick="window.print()" title="Imprimer / Sauver en PDF (Cmd+P)">
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
    Imprimer / PDF
  </button>
  <button onclick="document.getElementById('ks-toolbar').style.display='none'" title="Masquer la toolbar">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>
</div>`;

    // Insère juste avant </body> (ou à la fin si pas trouvé)
    if (html.includes('</body>')) {
        return html.replace('</body>', toolbar + '\n</body>');
    }
    return html + toolbar;
}

// Construit les variables à partir du formData + dérivées (DATE_EDITION etc.).
// Factorisé du handler _handleDocExport pour réutilisation.
function _buildDocExportVariables(pad, formData) {
    const cfg = pad.doc_export;
    const variables = {};

    for (const [tplVar, fieldId] of Object.entries(cfg.variable_map || {})) {
        const v = formData[fieldId];
        if (v) variables[tplVar] = v;
    }

    // ── Variables dérivées du formulaire ───────────────────────
    variables.DATE_EDITION = new Date().toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
    });
    if (!variables.VERSION_DOC) variables.VERSION_DOC = 'v1';
    if (!variables.REF_DOCUMENT) {
        const slug = (variables.PROGRAMME || 'NOTICE')
            .toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
        const ts = Date.now().toString(36).toUpperCase().slice(-5);
        variables.REF_DOCUMENT = `${slug}-${ts}`;
    }

    // ── Parsing du select RE2020 ───────────────────────────────
    // Le label complet est ex: "Seuil 2025 (IC construction ≤ 490 kgCO₂eq/m²)"
    // → RE2020_SEUIL     = "Seuil 2025"
    // → RE2020_OBJECTIF  = "IC construction ≤ 490 kgCO₂eq/m²" (contenu parenthèse)
    // → IC_CONSTRUCTION_MAX = "490" (regex sur le chiffre avant kg)
    const re2020 = formData['re2020'] || '';
    if (re2020) {
        const parenMatch = re2020.match(/^([^(]+?)\s*\(([^)]+)\)/);
        if (parenMatch) {
            variables.RE2020_SEUIL    = parenMatch[1].trim();
            variables.RE2020_OBJECTIF = parenMatch[2].trim();
        } else {
            variables.RE2020_SEUIL    = re2020.trim();
            variables.RE2020_OBJECTIF = 'Objectif bas carbone';
        }
        const icMatch = re2020.match(/(\d{2,4})\s*kg/i);
        if (icMatch) variables.IC_CONSTRUCTION_MAX = icMatch[1];
    }

    // ── Defaults pour variables sans champ formulaire ──────────
    // ASSUREUR_DO et GFA_ETABLISSEMENT ne sont pas dans le pad actuel
    // (Sprint futur : champs admin). On met des placeholders contractuels.
    if (!variables.ASSUREUR_DO)        variables.ASSUREUR_DO        = 'Voir contrat de réservation';
    if (!variables.GFA_ETABLISSEMENT) variables.GFA_ETABLISSEMENT = 'Voir contrat de réservation';

    // SPECIFICITES_BLOC : si vide, on met un placeholder italique pour
    // éviter d'afficher le marqueur [[SPECIFICITES_BLOC]] brut dans le PDF.
    if (!variables.SPECIFICITES_BLOC) {
        variables.SPECIFICITES_BLOC = '<p style="font-style:italic;color:#8896A8;">Spécificités du lot à compléter via le formulaire Keystone (champ « Spécificités &amp; équipements »).</p>';
    }

    return variables;
}

// Compose le bloc portable final (instructions + HTML).
// Format auto-suffisant : un humain qui le lit comprend quoi faire,
// une IA qui le reçoit a tout pour le rendre.
function _composePortableBloc({ pad, variables, html, missing }) {
    const date = new Date().toLocaleString('fr-FR');
    const prog = variables.PROGRAMME || '—';
    const lot  = variables.TYPE_LOT || '—';
    const ref  = variables.REF_DOCUMENT || '—';

    const warn = missing?.length
        ? `\n⚠ ${missing.length} marqueur(s) non rempli(s) : ${missing.join(', ')}\n   (Ces champs apparaîtront vides dans le PDF — complétez le formulaire si besoin.)\n`
        : '';

    return `=== NOTICE VEFA PORTABLE — Générée par Keystone OS le ${date} ===
Programme : ${prog} · Lot : ${lot} · Référence : ${ref}
${warn}
══════════════════════════════════════════════════════════════════
COMMENT IMPRIMER CE DOCUMENT EN PDF ?
══════════════════════════════════════════════════════════════════

▸ MÉTHODE RECOMMANDÉE — Sauvegarder en fichier .html
   1. Copiez TOUT le code HTML entre les balises "=== DÉBUT ===" et "=== FIN ===" ci-dessous.
   2. Collez-le dans un fichier texte vide, sauvegardez-le sous "notice.html".
   3. Double-cliquez sur le fichier — il s'ouvre dans votre navigateur.
   4. Cliquez sur le bouton "Imprimer / PDF" en haut à droite (toolbar Keystone intégrée),
      OU faites Cmd+P (Mac) / Ctrl+P (Windows).
   5. Dans la fenêtre d'impression : activez "Graphiques d'arrière-plan",
      désactivez "En-têtes et pieds de page du navigateur", format A4.

▸ ALTERNATIVE — Coller dans Claude.ai (rendu artifact automatique)
   Claude.ai rend les blocs HTML en artifact interactif (panneau de droite).
   Collez ce message complet, Claude affiche le HTML, vous imprimez de là.

   ChatGPT / Gemini : capacités de rendu HTML variables — préférez la méthode .html.

══════════════════════════════════════════════════════════════════
=== DÉBUT CODE HTML ===
${html}
=== FIN CODE HTML ===

(Notice générée par Keystone OS · keystone-os.com · DocEngine v1 · Auto-suffisante)
`;
}

function _updatePromptPreview(pad) {
    const form = document.getElementById('tool-form');
    if (!form) return;

    // Collecte des valeurs (commun)
    const formData = {};
    form.querySelectorAll('[name]').forEach(el => { formData[el.name] = el.value.trim(); });

    // Champs requis manquants
    const requiredFields = pad.fields.filter(f => f.required);
    const missingFields  = requiredFields.filter(f => !formData[f.id]);
    const requiredFilled = missingFields.length === 0;

    // ── Sprint 4.1 — Mode solo (doc_export) : pas de panneau résultat,
    // juste highlight des champs manquants + warnings inline. Le résultat
    // s'ouvre dans une nouvelle fenêtre au clic sur "Contrat PDF".
    if (pad.doc_export) {
        return _updateDocExportSolo(pad, formData, requiredFilled, missingFields);
    }

    // ── Mode classique LLM : panneau prompt à droite ────────────────
    const preview      = document.getElementById('prompt-text');
    const emptyState   = document.getElementById('prompt-empty-state');
    const missingEl    = document.getElementById('prompt-missing-fields');
    const resultLbl    = document.getElementById('result-lbl');
    const generateBtn  = document.getElementById('btn-generate');
    if (!preview) return;

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

    const newPrompt = _interpolate(_resolveEnginePrompt(pad), formData);

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

// Sauvegarde une entrée bibliothèque. `prompt` est la string legacy
// (prompt LLM ou HTML portable). `formData` permet la fonction Recharger
// (Sprint Bibliothèque v2 — pré-remplit le form sans ressaisie).
function _saveToLibrary(pad, prompt, formData = null) {
    if (!prompt || prompt.startsWith('Remplissez')) return false;
    const lib = JSON.parse(localStorage.getItem('ks_library') || '[]');

    // Auto-label : extrait un nom métier depuis les champs significatifs,
    // pour permettre une lecture rapide dans la liste sans dépendre du `id` du pad.
    let autoLabel = '';
    if (formData) {
        const program = formData.nom_programme || '';
        const lot     = formData.lot_numero    || '';
        const acq     = formData.acquereur_nom || '';
        if (program && lot) autoLabel = `${program} — Lot ${lot}${acq ? ' — ' + acq : ''}`;
        else if (program && acq) autoLabel = `${program} — ${acq}`;
        else if (program)        autoLabel = program;
        else if (acq)            autoLabel = acq;
    }

    lib.unshift({
        id      : pad.id,
        padKey  : pad.padKey || null,
        icon    : pad.icon   || null,
        title   : pad.title,
        prompt,                                  // legacy : string brute (LLM ou portable HTML)
        formData: formData || null,              // v2 : permet Recharger
        autoLabel,                               // v2 : label métier auto
        date    : new Date().toISOString(),
    });
    if (lib.length > 50) lib.splice(50);
    localStorage.setItem('ks_library', JSON.stringify(lib));
    _refreshPromptsBadge();
    return true;
}

// ══════════════════════════════════════════════════════════════════
// CLIPBOARD HELPERS (Safari-safe)
// ══════════════════════════════════════════════════════════════════
// _copyToClipboardSync : utilise execCommand, no await — préserve le
// user gesture. À utiliser en premier dans un handler de click si
// possible. Renvoie true/false.
function _copyToClipboardSync(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
    } catch (e) {
        console.warn('[clipboard-sync] échec :', e);
        return false;
    }
}

// _copyToClipboardAsync : essaie navigator.clipboard, fallback execCommand.
// À utiliser après un await (gesture potentiellement perdu).
async function _copyToClipboardAsync(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        console.warn('[clipboard-async] navigator.clipboard a échoué, fallback execCommand', e);
        return _copyToClipboardSync(text);
    }
}

async function _handleGenerate(pad) {
    const isArtifact = pad.type === 'artifact';
    const engine     = getActiveEngine();
    const apiKey     = loadKey(ENGINE_TO_PROVIDER[engine] || 'anthropic');
    const btn        = document.getElementById('btn-generate');

    // ── Construction du prompt — utilise la helper module-scope ──
    let prompt;
    if (isArtifact) {
        const preamble     = pad.artifact_config?.json_preamble || '';
        const instructions = _resolveEnginePrompt(pad);
        const extraContext = document.getElementById('artifact-context')?.value?.trim() || '';
        prompt = preamble
            + (instructions ? '\n\n' + instructions : '')
            + (extraContext  ? '\n\nContexte additionnel :\n' + extraContext : '');
    } else {
        const form     = document.getElementById('tool-form');
        const formData = {};
        form?.querySelectorAll('[name]').forEach(el => { formData[el.name] = el.value.trim(); });
        prompt = _interpolate(_resolveEnginePrompt(pad), formData);
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
            _refreshOpenToolForEngine();
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
            // Re-render modale outil si ouverte (prompt + label bouton)
            _refreshOpenToolForEngine();
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

// ── Helpers bibliothèque v2 ────────────────────────────────────
function _libRelativeDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffH  = diffMs / 36e5;
    const diffD  = diffMs / 864e5;
    if (diffH < 1)  return 'il y a ' + Math.max(1, Math.round(diffMs / 6e4)) + ' min';
    if (diffH < 24) return 'il y a ' + Math.round(diffH) + ' h';
    if (diffD < 7)  return 'il y a ' + Math.round(diffD) + ' j';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Génère un résumé 1-2 lignes du contenu, lisible dans la liste.
// Privilégie le formData (champs clés) plutôt que le HTML brut.
function _libSummaryLine(entry) {
    const fd = entry.formData || {};
    const parts = [];
    if (fd.surface_carrez || fd.surface) parts.push((fd.surface_carrez || fd.surface) + ' m²');
    if (fd.type_logement) parts.push(fd.type_logement);
    if (fd.prix_ttc)      parts.push(Number(fd.prix_ttc).toLocaleString('fr-FR') + ' € TTC');
    else if (fd.prix)     parts.push(Number(fd.prix).toLocaleString('fr-FR') + ' €');
    if (fd.ville)         parts.push(fd.ville);
    if (parts.length) return parts.join(' · ');
    // Fallback : tronque le prompt brut (en strippant HTML basique)
    const stripped = String(entry.prompt || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.slice(0, 140) + (stripped.length > 140 ? '…' : '');
}

function _renderPromptLibraryBody() {
    const body = document.getElementById('pl-body');
    if (!body) return;

    const lib = JSON.parse(localStorage.getItem('ks_library') || '[]');

    if (lib.length === 0) {
        body.innerHTML = `
            <div class="pl-empty">
                <div class="pl-empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="width:40px;height:40px;opacity:.35"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
                <div class="pl-empty-txt">Aucun dossier sauvegardé.<br>Utilisez le bouton "Bibliothèque"<br>dans une boîte à outils.</div>
            </div>`;
        return;
    }

    const _esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    body.innerHTML = lib.map((entry, idx) => {
        const dateRel  = _libRelativeDate(entry.date);
        const dateAbs  = new Date(entry.date).toLocaleString('fr-FR', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
        const label    = entry.label || entry.autoLabel || `${entry.id} · ${entry.title}`;
        const padTag   = entry.title ? entry.title : entry.id;
        const summary  = _libSummaryLine(entry);
        const canReload = !!entry.formData;     // Recharger uniquement si v2

        return `
        <div class="pl-entry" data-idx="${idx}">
            <div class="pl-entry-hd">
                <span class="pl-entry-padtag" title="${_esc(entry.id || '')}">${_esc(padTag)}</span>
                <span class="pl-entry-tag pl-entry-rename" data-idx="${idx}" title="Cliquer pour renommer" contenteditable="false">${_esc(label)}</span>
                <span class="pl-entry-edit-ico" data-idx="${idx}" title="Renommer">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;pointer-events:none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </span>
                <span class="pl-entry-date" title="${_esc(dateAbs)}">${_esc(dateRel)}</span>
            </div>
            <div class="pl-entry-summary">${_esc(summary)}</div>
            <div class="pl-entry-actions">
                ${canReload ? `<button class="pl-entry-btn pl-entry-btn-primary" data-action="reload" data-idx="${idx}" title="Rouvrir le dossier avec les champs pré-remplis">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                    Recharger
                </button>` : ''}
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

    // ── Recharger / Copier / Supprimer ──────────────────────────
    body.querySelectorAll('.pl-entry-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx    = parseInt(btn.dataset.idx, 10);
            const lib    = JSON.parse(localStorage.getItem('ks_library') || '[]');
            const entry  = lib[idx];
            if (!entry) return;
            const action = btn.dataset.action;

            if (action === 'reload') {
                // Ferme la bibliothèque, rouvre le pad avec prefill.
                // L'id stocké est le NOMEN-K (ex: O-IMM-009) — openTool sait
                // résoudre via TOOLS pour retrouver le padKey.
                _closePromptLibrary();
                setTimeout(() => {
                    openTool(entry.id, { prefillData: entry.formData });
                }, 150);
                return;
            }

            if (action === 'copy') {
                navigator.clipboard.writeText(entry.prompt || '').then(() => {
                    btn.textContent = '✓ Copié !';
                    setTimeout(() => { btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier'; }, 2000);
                });
                return;
            }

            if (action === 'delete') {
                if (!confirm('Supprimer ce dossier de la bibliothèque ?')) return;
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
