/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact SMART AGENT (O-AGT-001) v1.0
   Sprint SA-1 : le coffre Kortex (fiches typées, CRUD + extraction)

   Mission : fabriquer des « jumeaux numériques de savoir-faire » —
   des agents qui répondent UNIQUEMENT depuis le coffre de savoir
   Kortex du client (fiches typées validées), avec citations et
   repli honnête (« Je ne dispose pas de cette information »).

   DOCTRINE (contenant/contenu) : ce module est le MOTEUR, 100%
   générique — capture, indexation, restitution ancrée. AUCUNE
   logique métier ici : un vendeur, un gardien de musée ou un
   formateur sortent du même code ; seul le contenu du Kortex
   (par tenant, côté worker) diffère.

   Vues (rail gauche) :
     AGENTS — feuille de route (les jumeaux arrivent au SA-3/SA-4)
     KORTEX — le coffre : liste filtrable, éditeur par gabarit de
              type, « coller du texte → fiches proposées » (1 crédit,
              relecture humaine avant ajout = doctrine de validation).

   Backend : workers/src/routes/smart-agent.js (CRUD + extraction,
   tenant = JWT, MAX only en beta). Gabarits FIELD_TEMPLATES =
   contrat partagé avec UNIT_TEMPLATES côté worker.

   Réutilise la mécanique workspace de codex.js (shell ws-*,
   workspace.css) ; styles propres dans smart-agent.css (sa-*).
   ═══════════════════════════════════════════════════════════════ */

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';

const WORKSPACE_META = { id: 'O-AGT-001', name: 'Smart Agent' };
const API_BASE       = 'https://keystone-os-api.keystone-os.workers.dev';

// ── Les 7 types de fiches Kortex + gabarits de saisie ──────────
// Contrat partagé avec le worker (UNIT_TEMPLATES) et le CHECK SQL.
// list:true → textarea « une entrée par ligne » (steps).
const KORTEX_TYPES = [
    { id: 'fact',       icon: 'check',        label: 'Fait',               desc: 'Une information vérifiée : horaire, chiffre, caractéristique.' },
    { id: 'procedure',  icon: 'check-square', label: 'Procédure',          desc: 'Des étapes ordonnées pour accomplir une tâche.' },
    { id: 'qa',         icon: 'help-circle',  label: 'Question / Réponse', desc: 'Une question fréquente et sa réponse validée.' },
    { id: 'case',       icon: 'history',      label: 'Cas vécu',           desc: 'Situation → action → résultat : l\'expérience du terrain.' },
    { id: 'rule',       icon: 'lock',         label: 'Règle',              desc: 'Ce qui doit (ou ne doit jamais) être fait, et pourquoi.' },
    { id: 'objection',  icon: 'megaphone',    label: 'Objection',          desc: 'Une objection entendue, la réponse qui fonctionne, la preuve.' },
    { id: 'definition', icon: 'edit',         label: 'Définition',         desc: 'Un terme du métier expliqué dans vos mots.' },
];

const FIELD_TEMPLATES = {
    fact: [
        { k: 'statement', label: 'Le fait',                                kind: 'textarea', req: true,  ph: 'Ex. : Le musée ferme à 18h00, dernière entrée 17h15.' },
        { k: 'context',   label: 'Contexte (optionnel)',                   kind: 'textarea',             ph: 'Quand / où ce fait s\'applique-t-il ?' },
    ],
    procedure: [
        { k: 'goal',      label: 'Objectif',                               kind: 'input',    req: true,  ph: 'Ex. : Traiter une demande de remboursement' },
        { k: 'steps',     label: 'Étapes — une par ligne',                 kind: 'textarea', req: true,  list: true, ph: 'Vérifier le ticket\nContrôler le délai légal\nÉtablir l\'avoir…' },
        { k: 'warnings',  label: 'Points de vigilance (optionnel)',        kind: 'textarea',             ph: 'Ce qui ne doit jamais être fait, les pièges connus…' },
    ],
    qa: [
        { k: 'question',  label: 'La question',                            kind: 'input',    req: true,  ph: 'Ex. : Peut-on payer en plusieurs fois ?' },
        { k: 'answer',    label: 'La réponse validée',                     kind: 'textarea', req: true,  ph: 'La réponse exacte que donnerait votre meilleur expert.' },
    ],
    case: [
        { k: 'situation', label: 'La situation',                           kind: 'textarea', req: true,  ph: 'Ce qui s\'est présenté (anonymisé : « le client », « le visiteur »).' },
        { k: 'action',    label: 'Ce qui a été fait',                      kind: 'textarea', req: true,  ph: 'L\'action ou la réponse apportée.' },
        { k: 'result',    label: 'Le résultat',                            kind: 'textarea', req: true,  ph: 'Ce que ça a produit — et ce qu\'on en retient.' },
    ],
    rule: [
        { k: 'rule',      label: 'La règle',                               kind: 'textarea', req: true,  ph: 'Ex. : Ne jamais annoncer un délai sans vérifier le stock.' },
        { k: 'rationale', label: 'Pourquoi (optionnel)',                   kind: 'textarea',             ph: 'La raison d\'être de la règle.' },
        { k: 'exceptions',label: 'Exceptions (optionnel)',                 kind: 'textarea',             ph: 'Les cas où la règle ne s\'applique pas.' },
    ],
    objection: [
        { k: 'objection', label: 'L\'objection entendue',                  kind: 'input',    req: true,  ph: 'Ex. : « C\'est trop cher. »' },
        { k: 'response',  label: 'La réponse qui fonctionne',              kind: 'textarea', req: true,  ph: 'Votre meilleure réponse, mot pour mot.' },
        { k: 'proof',     label: 'Preuve / appui (optionnel)',             kind: 'textarea',             ph: 'Chiffre, témoignage, comparatif…' },
    ],
    definition: [
        { k: 'term',      label: 'Le terme',                               kind: 'input',    req: true,  ph: 'Ex. : VEFA' },
        { k: 'definition',label: 'La définition, dans vos mots',           kind: 'textarea', req: true,  ph: 'Comme vous l\'expliqueriez à un nouveau collègue.' },
    ],
};

const STATUS_META = {
    draft:      { label: 'Brouillon',   cls: 'is-draft' },
    validated:  { label: 'Validée',     cls: 'is-validated' },
    quarantine: { label: 'Quarantaine', cls: 'is-quarantine' },
    expired:    { label: 'Périmée',     cls: 'is-expired' },
};

// ── Feuille de route (vue Agents) — états honnêtes par sprint ──
const ENGINE_STEPS = [
    { icon: 'kortex',      label: 'Le coffre Kortex',   desc: 'Créez et validez vos fiches de savoir typées.',                  status: 'live' },
    { icon: 'search',      label: 'La recherche',       desc: 'Posez une question, retrouvez la bonne fiche — testez au coffre.', status: 'live' },
    { icon: 'smart-agent', label: 'Le dialogue ancré',  desc: 'Votre agent répond depuis vos fiches, sources citées.',          status: 'live' },
    { icon: 'sparkles',    label: 'La création guidée', desc: 'Identité, périmètre, garde-fous + bac à sable : votre jumeau pas à pas.', status: 'next' },
];

// ═══════════════════════════════════════════════════════════════
// État du module
// ═══════════════════════════════════════════════════════════════
let _root = null;

const _kx = {
    loaded: false, loading: false, error: null,
    units: [], counts: { draft: 0, validated: 0, quarantine: 0, expired: 0, total: 0 },
    filterType: 'all', filterStatus: 'all',
    // SA-4.4.2 — coffre affiché : 'private' (de l'agent) | 'shared' (du dossier)
    scope: 'private', sharedVault: null,
    mode: 'list',              // 'list' | 'editor'
    editing: null,             // unit en édition (null = création)
    editType: 'qa',            // type sélectionné en création
};
const _ex = { open: false, busy: false, proposals: [], checked: new Set(), error: null, adding: false };
// Recherche hybride (SA-2) — results null = pas de recherche active.
const _kxs = { q: '', busy: false, mode: null, results: null };
// Agents (SA-3) — mode : 'list' | 'form' (création/édition d'agent)
const _ag = { loaded: false, loading: false, error: null, agents: [], mode: 'list', editing: null,
    // SA-4.4.1 — dossiers d'agents (regroupement) ; SA-4.4.2 — édition inline
    folders: [], folderEdit: null,
    // Formulaire agent (SA-4.3, ex-wizard) : données en cours
    form: null, formBusy: false, formError: null, suggestBusy: false,
    // File des trous (SA-4) — scopée par agent (SA-4.3)
    gaps: [], gapsCount: 0,
    // SA-5.1 — publication publique (lien/QR) de l'agent courant
    publish: { loading: false, busy: false, link: null, qr: null } };
// SA-4.3 — SILO : agent courant + onglet actif. _cur.id null = liste d'agents.
const _cur = { id: null, name: '', tab: 'savoir' };  // tab : savoir | tester | trous | reglages
// Conversation en cours avec un agent (SA-3) — sert aussi de bac à sable (SA-4)
const _chat = { agentId: null, agentName: '', sessionId: null, messages: [], busy: false };
// Vocal — dictée (micro) + lecture à voix haute (interrupteur mémorisé).
const _voice = { on: (() => { try { return localStorage.getItem('sa_voice_on') === '1'; } catch (_) { return false; } })(), rec: null, listening: false, voices: [] };
// Voix neuronale « Piper » (moteur maison auto-hébergé) — option spéciale du
// sélecteur. Chargement paresseux (import dynamique + modèle ~60 Mo au 1er usage).
const PIPER_VOICE_KEY = '__piper_siwis';
const _piper = { mod: null, audio: null, busy: false };
// Golden set (SA-4) — jeu de questions étalon de l'agent en cours de test
const _gold = { items: [], loaded: false, busy: false, replay: null, addExpect: 'answer' };
// SA-6 — mode Interview du savoir (parcours guidé pour combler les trous)
const _iv = { active: false, idx: 0, gaps: [], phase: 'ask', answer: '', busy: false, proposals: [], checked: new Set(), error: null };

// ═══════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════
function _jwt() {
    return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || '';
}
async function _api(path, opts = {}) {
    const res = await fetch(`${API_BASE}/api/smart-agent${path}`, {
        method: opts.method || 'GET',
        headers: {
            'Authorization': `Bearer ${_jwt()}`,
            ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
        const e = new Error(data.error || `Erreur ${res.status}`);
        e.status = res.status; e.data = data;
        throw e;
    }
    return data;
}

// ═══════════════════════════════════════════════════════════════
// Ouverture / fermeture (même mécanique que openKodex)
// ═══════════════════════════════════════════════════════════════
export function openSmartAgent(opts = {}) {
    if (_root) return;
    _buildShell();
    _cur.id = null; _ag.mode = 'list';
    _renderRail();
    if (!_ag.loaded) _agLoad(); else _renderMain();
    _renderAside();
    document.body.style.overflow = 'hidden';
}

export function closeSmartAgent() {
    if (!_root) return;
    _root.remove();
    _root = null;
    document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════════
// Shell (topbar + rail + main + aside) — gabarit workspace ws-*
// ═══════════════════════════════════════════════════════════════
function _buildShell() {
    _root = document.createElement('div');
    _root.className = 'ws-app sa-app';
    _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('smart-agent', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
      </div>
    </header>

    <div class="ws-body">
      <nav class="ws-rail" data-slot="rail"></nav>
      <main class="ws-main" data-slot="main"></main>
      <aside class="ws-aside" data-slot="aside"></aside>
    </div>

    <div data-slot="overlay"></div>
  `;

    document.body.appendChild(_root);
    _root.addEventListener('click', _onClick);
    bindRatingButton(_root, WORKSPACE_META.id);
    bindHelpButton(_root, WORKSPACE_META.id);
    bindBurger(_root);

    _renderRail();
    _renderAside();
}

// Routage des actions (délégation globale du workspace)
function _onClick(e) {
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;

    if (act === 'close')        { closeSmartAgent(); return; }
    // ── Liste d'agents (silo SA-4.3) ──
    if (act === 'ag-new')       { _openForm(null); return; }
    if (act === 'ag-open')      { _enterAgent(actEl.dataset.id); return; }
    if (act === 'ag-delete')    { _deleteAgent(actEl.dataset.id); return; }
    if (act === 'ag-exit')      { _exitAgent(); return; }
    // ── Dossiers d'agents (SA-4.4.1) ──
    if (act === 'fold-new')     { _createFolder(); return; }
    if (act === 'fold-rename')  { _renameFolder(actEl.dataset.id); return; }
    if (act === 'fold-delete')  { _deleteFolder(actEl.dataset.id); return; }
    if (act === 'fold-save')    { _saveFolderEdit(); return; }
    if (act === 'fold-cancel')  { _ag.folderEdit = null; _renderMain(); return; }
    if (act === 'tab')          { _setTab(actEl.dataset.tab); return; }
    // ── Formulaire agent (création/édition) ──
    if (act === 'form-save')    { _saveAgentForm(); return; }
    if (act === 'form-cancel')  { _cancelForm(); return; }
    if (act === 'form-posture') { _readAgentForm(); _ag.form.posture = actEl.dataset.v; _renderMain(); return; }
    if (act === 'form-suggest') { _suggestOpening(); return; }
    if (act === 'form-delete')  { _deleteAgent(_ag.form?.id); return; }
    // ── Publication publique (SA-5.1) ──
    if (act === 'pub-create')   { _doPublish(); return; }
    if (act === 'pub-copy')     { _copyPublic(actEl.dataset.url); return; }
    if (act === 'pub-qr')       { _toggleQr(); return; }
    if (act === 'pub-revoke')   { _revokePublic(actEl.dataset.id); return; }
    if (act === 'pub-save')     { _savePublicSettings(); return; }
    // ── Chat / bac à sable ──
    if (act === 'chat-send')    { _sendChat(); return; }
    if (act === 'chat-mic')     { _startDictation('[data-slot="chat-text"]'); return; }
    if (act === 'chat-voice')   { _toggleVoice(); return; }
    if (act === 'chat-cite')    { _openUnitFromChat(actEl.dataset.uid); return; }
    // ── Trous (scopés agent) ──
    if (act === 'gap-answer')   { _answerGap(_ag.gaps.find(g => g.id === actEl.dataset.id)); return; }
    if (act === 'gap-dismiss')  { _dismissGap(actEl.dataset.id); return; }
    // ── Interview du savoir (SA-6) ──
    if (act === 'iv-start')     { _startInterview(); return; }
    if (act === 'iv-structure') { _ivStructure(); return; }
    if (act === 'iv-skip')      { _ivNext(); return; }
    if (act === 'iv-dismiss')   { _ivDismiss(); return; }
    if (act === 'iv-toggle')    { _ivToggle(parseInt(actEl.dataset.i, 10)); return; }
    if (act === 'iv-back')      { _iv.phase = 'ask'; _renderMain(); return; }
    if (act === 'iv-commit')    { _ivCommit(); return; }
    if (act === 'iv-quit')      { _ivQuit(); return; }
    if (act === 'iv-explore')   { _ivExplore(); return; }
    // ── Golden set ──
    if (act === 'gold-add')     { _goldAdd(); return; }
    if (act === 'gold-del')     { _goldDel(actEl.dataset.id); return; }
    if (act === 'gold-expect')  { _gold.addExpect = actEl.dataset.v; _renderMain(); return; }
    if (act === 'gold-replay')  { _goldReplay(); return; }
    // ── Coffre (onglet Savoir) : liste ──
    if (act === 'kx-new')       { _openEditor(null); return; }
    if (act === 'kx-extract')   { _openExtract(); return; }
    // ── Coffre partagé (SA-4.4.2) ──
    if (act === 'kx-scope')         { _setKxScope(actEl.dataset.v); return; }
    if (act === 'kx-create-shared') { _createSharedVault(); return; }
    if (act === 'kx-del-shared')    { _deleteSharedVault(); return; }
    if (act === 'kx-ftype')     { _kx.filterType = actEl.dataset.v;   _kxReload(); return; }
    if (act === 'kx-fstatus')   { _kx.filterStatus = actEl.dataset.v; _kxReload(); return; }
    if (act === 'kx-search')       { _runSearch(); return; }
    if (act === 'kx-search-clear') { _clearSearch(); return; }
    if (act === 'kx-edit') {
        const id = actEl.dataset.id;
        const u  = _kx.units.find(x => x.id === id)
            || _kxs.results?.find(r => r.unit.id === id)?.unit;
        if (u) _openEditor(u);
        return;
    }
    if (act === 'kx-validate')  { _quickStatus(actEl.dataset.id, 'validated'); return; }
    if (act === 'kx-delete')    { _deleteUnit(actEl.dataset.id); return; }
    // ── Coffre : éditeur de fiche ──
    if (act === 'ed-back')      { _kx.mode = 'list'; _kx.editing = null; _kx.prefill = null; _kx.resolveGapId = null; _renderMain(); return; }
    if (act === 'ed-type')      { _kx.editType = actEl.dataset.v; _renderMain(); return; }
    if (act === 'ed-save')      { _saveEditor(actEl.dataset.status || null); return; }
    if (act === 'ed-status')    { _saveEditor(actEl.dataset.v); return; }
    if (act === 'ed-delete')    { _deleteUnit(_kx.editing?.id, true); return; }
    // ── Extraction ──
    if (act === 'ex-close')     { _closeExtract(); return; }
    if (act === 'ex-run')       { _runExtract(); return; }
    if (act === 'ex-toggle')    { _toggleProposal(parseInt(actEl.dataset.i, 10)); return; }
    if (act === 'ex-add')       { _addProposals(); return; }
}

// ═══════════════════════════════════════════════════════════════
// Rail gauche — agent-centré (SA-4.3)
// ═══════════════════════════════════════════════════════════════
const _TABS = [
    { id: 'savoir',   ico: 'kortex',      label: 'Savoir' },
    { id: 'tester',   ico: 'smart-agent', label: 'Tester' },
    { id: 'trous',    ico: 'help-circle', label: 'Trous' },
    { id: 'reglages', ico: 'settings',    label: 'Réglages' },
];
function _renderRail() {
    const rail = _root.querySelector('[data-slot="rail"]');
    if (!_cur.id) {
        rail.innerHTML = `
      <div class="ws-rail-section">Moteur</div>
      <button class="ws-step is-active">
        <span class="ws-step-num" aria-hidden="true" style="visibility:hidden;"></span>
        <span class="ws-step-icon" style="width:18px;height:18px;">${icon('smart-agent', 18)}</span>
        <span class="ws-step-label">Mes agents</span>
      </button>`;
        return;
    }
    const tab = t => {
        const badge = (t.id === 'trous' && _ag.gapsCount) ? ` <em class="sa-rail-badge">${_ag.gapsCount}</em>` : '';
        return `
      <button class="ws-step ${_cur.tab === t.id ? 'is-active' : ''}" data-act="tab" data-tab="${t.id}">
        <span class="ws-step-num" aria-hidden="true" style="visibility:hidden;"></span>
        <span class="ws-step-icon" style="width:18px;height:18px;">${icon(t.ico, 18)}</span>
        <span class="ws-step-label">${t.label}${badge}</span>
      </button>`;
    };
    rail.innerHTML = `
    <button class="ws-step" data-act="ag-exit">
      <span class="ws-step-num" aria-hidden="true" style="visibility:hidden;"></span>
      <span class="ws-step-icon" style="width:18px;height:18px;">${icon('chevron-left', 18)}</span>
      <span class="ws-step-label">Mes agents</span>
    </button>
    <div class="ws-rail-section">${_esc(_cur.name)}</div>
    ${_TABS.map(tab).join('')}
  `;
}

// ── Entrer / sortir d'un agent, changer d'onglet ───────────────
function _enterAgent(id) {
    const a = _ag.agents.find(x => x.id === id);
    if (!a) return;
    _cur.id = a.id; _cur.name = a.name; _cur.agent = a; _cur.tab = 'savoir';
    // reset des sous-états scopés
    _kx.loaded = false; _kx.mode = 'list'; _kx.editing = null;
    _kx.filterType = 'all'; _kx.filterStatus = 'all'; _kx.prefill = null; _kx.resolveGapId = null;
    _kxs.results = null; _kxs.q = '';
    _kx.scope = 'private'; _kx.sharedVault = null;   // SA-4.4.2
    _gold.loaded = false; _gold.replay = null; _gold.items = [];
    // bac à sable : amorce l'accueil de cet agent
    const opening = a.config?.identity?.opening || `Bonjour ! Je suis « ${a.name} ». Comment puis-je vous aider ?`;
    _chat.agentId = a.id; _chat.agentName = a.name; _chat.sessionId = null; _chat.busy = false;
    _chat.messages = [{ role: 'agent', content: opening, citations: [], opening: true }];
    _ag.gaps = []; _ag.gapsCount = 0;
    _renderRail(); _renderAside();
    _setTab('savoir');
    _loadGaps();          // pour le badge Trous
    _loadSharedVault();   // SA-4.4.2 — coffre partagé du dossier (si l'agent en a un)
}
function _exitAgent() {
    _cur.id = null; _cur.agent = null; _ag.mode = 'list';
    if (!_ag.loaded) _agLoad();
    _renderRail(); _renderMain(); _renderAside();
}
function _setTab(tab) {
    _cur.tab = ['savoir', 'tester', 'trous', 'reglages'].includes(tab) ? tab : 'savoir';
    if (_cur.tab === 'savoir' && !_kx.loaded && !_kx.loading) _kxLoad();
    if (_cur.tab === 'tester' && !_gold.loaded) _goldLoad();
    if (_cur.tab === 'trous') _loadGaps();
    if (_cur.tab === 'reglages') _openForm(_cur.agent);
    _renderRail(); _renderMain();
}

// ═══════════════════════════════════════════════════════════════
// Chargement du coffre (scopé à l'agent courant — silo)
// ═══════════════════════════════════════════════════════════════
async function _kxLoad() {
    if (!_cur.id) return;
    _kx.loading = true; _kx.error = null;
    _renderMain();
    try {
        // SA-4.4.2 — coffre courant : privé de l'agent OU partagé du dossier.
        const scopeQ = (_kx.scope === 'shared' && _kx.sharedVault)
            ? `vault=${encodeURIComponent(_kx.sharedVault.id)}`
            : `agent=${encodeURIComponent(_cur.id)}`;
        const qs = [scopeQ];
        if (_kx.filterType !== 'all')   qs.push(`type=${_kx.filterType}`);
        if (_kx.filterStatus !== 'all') qs.push(`status=${_kx.filterStatus}`);
        const unitsRes = await _api(`/kortex/units?${qs.join('&')}`);
        _kx.units  = unitsRes.units || [];
        _kx.counts = unitsRes.counts || _kx.counts;
        _kx.loaded = true;
    } catch (e) {
        _kx.error = (e.status === 403)
            ? 'Smart Agent est réservé au plan MAX pendant la beta.'
            : (e.status === 401)
                ? 'Session expirée — reconnectez-vous au Dashboard.'
                : `Coffre injoignable : ${e.message}`;
    }
    _kx.loading = false;
    if (_cur.tab === 'savoir') _renderMain();
    _renderAside();
}
function _kxReload() { _kx.loaded = false; _kxLoad(); }

// SA-4.4.2 — charge le coffre partagé du dossier de l'agent (1 par dossier en V1).
async function _loadSharedVault() {
    _kx.sharedVault = null;
    const fid = _cur.agent?.folder_id;
    if (!fid) return;
    try {
        const r = await _api(`/vaults?folder=${encodeURIComponent(fid)}`);
        _kx.sharedVault = (r.vaults && r.vaults[0]) || null;
    } catch (_) { /* best-effort : pas de coffre partagé affiché */ }
    if (_cur.tab === 'savoir') _renderMain();
}
function _setKxScope(scope) {
    const next = (scope === 'shared' && _kx.sharedVault) ? 'shared' : 'private';
    if (_kx.scope === next) return;
    _kx.scope = next;
    _kx.filterType = 'all'; _kx.filterStatus = 'all';
    _kxs.results = null; _kxs.q = '';
    _kxReload();
}
async function _createSharedVault() {
    const fid = _cur.agent?.folder_id;
    if (!fid) { _toast('Rangez d\'abord cet agent dans un dossier (Réglages).', 'error'); return; }
    try {
        const r = await _api('/vaults', { method: 'POST', body: { folder_id: fid } });
        if (r.vault) { _kx.sharedVault = r.vault; _kx.scope = 'shared'; }
        _toast('Coffre partagé créé — commun à tous les agents du dossier.');
        _kxReload();
    } catch (e) { _toast(e.message, 'error'); }
}
// SA-4.4.3 — supprime le coffre partagé du dossier (ses fiches partent ;
// les coffres privés des agents ne sont pas touchés).
async function _deleteSharedVault() {
    const sv = _kx.sharedVault;
    if (!sv) return;
    if (!confirm(`Supprimer le coffre partagé « ${sv.name || 'Coffre partagé'} » ?\nSes fiches seront définitivement supprimées. Les coffres privés des agents ne sont pas touchés.`)) return;
    try {
        await _api(`/vaults/${sv.id}`, { method: 'DELETE' });
        _kx.sharedVault = null; _kx.scope = 'private';
        _toast('Coffre partagé supprimé.');
        _kxReload();
    } catch (e) { _toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════
// Vue principale — agent-centrée
// ═══════════════════════════════════════════════════════════════
function _renderMain() {
    const main = _root.querySelector('[data-slot="main"]');
    if (!_cur.id) {
        main.innerHTML = (_ag.mode === 'form') ? _agentFormHTML() : _agentsListHTML();
        main.scrollTop = 0;
        if (_ag.mode !== 'form' && _ag.folderEdit) _bindFolderEdit(main);
        return;
    }
    // À l'intérieur d'un agent : onglets
    if (_cur.tab === 'savoir') {
        if (_kx.mode === 'editor') { main.innerHTML = _editorHTML(); _bindEditorInputs(); }
        else { main.innerHTML = _kortexViewHTML(); _bindKortexInputs(main); }
    } else if (_cur.tab === 'tester') {
        main.innerHTML = _testerHTML(); _bindChatInput(main);
    } else if (_cur.tab === 'trous') {
        main.innerHTML = _iv.active ? _interviewHTML() : _gapsHTML();
        if (_iv.active && _iv.phase === 'ask') { main.querySelector('[data-slot="iv-answer"]')?.focus(); }
    } else { // reglages
        main.innerHTML = _agentFormHTML();
    }
    if (_cur.tab === 'tester') _scrollChatBottom();
    else main.scrollTop = 0;
}

// ═══════════════════════════════════════════════════════════════
// Chargement des agents
// ═══════════════════════════════════════════════════════════════
async function _agLoad() {
    _ag.loading = true; _ag.error = null;
    _renderMain();
    try {
        // SA-4.4.1 — agents + dossiers (dossiers best-effort : si l'endpoint
        // n'est pas encore déployé, on dégrade simplement sans dossier).
        const [agRes, foldRes] = await Promise.all([
            _api('/agents'),
            _api('/folders').catch(() => ({ folders: [] })),
        ]);
        _ag.agents = agRes.agents || [];
        _ag.folders = foldRes.folders || [];
        _ag.loaded = true;
    } catch (e) {
        _ag.error = (e.status === 403)
            ? 'Smart Agent est réservé au plan MAX pendant la beta.'
            : (e.status === 401)
                ? 'Session expirée — reconnectez-vous au Dashboard.'
                : `Moteur injoignable : ${e.message}`;
    }
    _ag.loading = false;
    _renderMain();
    _renderAside();
}
function _agReload() { _ag.loaded = false; _agLoad(); }

// ── Dossiers d'agents (SA-4.4.1) — gestion légère (prompt/confirm, cohérent
//    avec la suppression d'agent). Le rangement d'un agent passe par ses Réglages.
// SA-4.4.2 — création/renommage via champ INLINE (charte premium + fiable en
// PWA : les prompt() natifs sont bloqués en mode app installée sur certains
// navigateurs). _ag.folderEdit = { mode: 'new' | folderId, value, error }.
function _createFolder() { _ag.folderEdit = { mode: 'new', value: '', error: null }; _renderMain(); }
function _renameFolder(id) {
    const f = _ag.folders.find(x => x.id === id);
    _ag.folderEdit = { mode: id, value: f?.name || '', error: null };
    _renderMain();
}
async function _saveFolderEdit() {
    const e = _ag.folderEdit;
    if (!e) return;
    const main = _root.querySelector('[data-slot="main"]');
    const name = (main?.querySelector('[data-field="folder-name"]')?.value || '').trim();
    if (!name) { e.error = 'Donnez un nom au dossier.'; _renderMain(); return; }
    try {
        if (e.mode === 'new') {
            const r = await _api('/folders', { method: 'POST', body: { name } });
            if (r.folder) _ag.folders.push(r.folder);
        } else {
            await _api(`/folders/${e.mode}`, { method: 'PATCH', body: { name } });
            const f = _ag.folders.find(x => x.id === e.mode);
            if (f) f.name = name;
        }
        _ag.folders.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
        const created = e.mode === 'new';
        _ag.folderEdit = null;
        _toast(created ? 'Dossier créé.' : 'Dossier renommé.');
        _renderMain();
    } catch (err) { e.error = err.message; _renderMain(); }
}
// Focus + raccourcis clavier sur le champ inline (Entrée = valider, Échap = annuler).
function _bindFolderEdit(main) {
    const inp = main.querySelector('[data-field="folder-name"]');
    if (!inp) return;
    inp.focus();
    const v = inp.value; inp.value = ''; inp.value = v;   // curseur en fin de texte
    inp.onkeydown = (ev) => {
        if (ev.key === 'Enter')  { ev.preventDefault(); _saveFolderEdit(); }
        if (ev.key === 'Escape') { ev.preventDefault(); _ag.folderEdit = null; _renderMain(); }
    };
}
async function _deleteFolder(id) {
    const f = _ag.folders.find(x => x.id === id);
    if (!confirm(`Supprimer le dossier « ${f?.name || ''} » ?\nLes agents qu'il contient ne sont PAS supprimés : ils redeviennent « sans dossier ».`)) return;
    try {
        await _api(`/folders/${id}`, { method: 'DELETE' });
        _ag.folders = _ag.folders.filter(x => x.id !== id);
        _ag.agents.forEach(a => { if (a.folder_id === id) a.folder_id = null; });
        _toast('Dossier supprimé.');
        _renderMain();
    } catch (e) { _toast(e.message, 'error'); }
}

// ── Vue AGENTS — liste (chaque agent = une unité autonome, silo SA-4.3) ──
function _agentsListHTML() {
    if (_ag.loading) return `<div class="sa-loading">${icon('refresh', 18)} Chargement de vos agents…</div>`;
    if (_ag.error) {
        return `
      <section class="sa-hero">
        <div class="sa-hero-ico">${icon('smart-agent', 40)}</div>
        <h1 class="sa-hero-title">Mes agents</h1>
        <p class="sa-hero-lead">${_esc(_ag.error)}</p>
      </section>`;
    }

    if (!_ag.agents.length && !_ag.folders.length) {
        return `
      <section class="sa-hero">
        <div class="sa-hero-ico">${icon('smart-agent', 40)}</div>
        <h1 class="sa-hero-title">Vos jumeaux numériques de savoir-faire</h1>
        <p class="sa-hero-lead">
          Chaque agent est une <strong>unité autonome</strong> : son propre savoir, son propre
          test, ses propres questions sans réponse. Il répond uniquement depuis SON coffre, en
          citant ses sources — et quand il ne sait pas, il le dit.
        </p>
        <div class="sa-cta-row">
          <button class="sa-btn is-primary" data-act="ag-new">${icon('plus', 16)} Créer mon premier agent</button>
        </div>
      </section>`;
    }

    const card = a => {
        const paused = a.status === 'paused';
        return `
      <article class="sa-agent-card" data-act="ag-open" data-id="${a.id}" role="button" tabindex="0">
        <span class="sa-agent-ico">${icon('smart-agent', 22)}</span>
        <div class="sa-agent-txt">
          <strong class="sa-agent-name">${_esc(a.name)}${paused ? ' <span class="sa-badge is-quarantine">En pause</span>' : ''}${a.status === 'published' ? ' <span class="sa-badge is-live">En ligne</span>' : ''}</strong>
          <span class="sa-agent-mission">${_esc(a.config?.identity?.mission || 'Sans mission définie')}</span>
        </div>
        <div class="sa-agent-acts">
          <button class="sa-btn is-primary" data-act="ag-open" data-id="${a.id}">${icon('chevron-right', 15)} Ouvrir</button>
          <button class="sa-iconbtn is-danger" data-act="ag-delete" data-id="${a.id}" title="Supprimer l'agent et tout son savoir">${icon('trash-2', 15)}</button>
        </div>
      </article>`;
    };

    // SA-4.4.1 — regroupement par dossier
    const byFolder = new Map();
    const loose = [];
    for (const a of _ag.agents) {
        if (a.folder_id) {
            if (!byFolder.has(a.folder_id)) byFolder.set(a.folder_id, []);
            byFolder.get(a.folder_id).push(a);
        } else loose.push(a);
    }
    const editing = _ag.folderEdit;
    const folderEditRow = (saveTitle) => `
      <div class="sa-foldedit">
        <input class="sa-input sa-foldedit-input" data-field="folder-name" value="${_escAttr(editing.value || '')}" placeholder="Nom du dossier" maxlength="80">
        <button class="sa-iconbtn is-ok" data-act="fold-save" title="${saveTitle}">${icon('check', 15)}</button>
        <button class="sa-iconbtn" data-act="fold-cancel" title="Annuler">${icon('x', 15)}</button>
      </div>
      ${editing.error ? `<p class="sa-foldedit-err">${_esc(editing.error)}</p>` : ''}`;
    const folderBlock = f => {
        const items = byFolder.get(f.id) || [];
        const head = (editing?.mode === f.id) ? folderEditRow('Renommer') : `
        <div class="sa-folder-head">
          <span class="sa-folder-ico">${icon('folder', 17)}</span>
          <strong class="sa-folder-name">${_esc(f.name)}</strong>
          <span class="sa-folder-count">${items.length} agent${items.length > 1 ? 's' : ''}</span>
          <span class="sa-folder-acts">
            <button class="sa-iconbtn" data-act="fold-rename" data-id="${f.id}" title="Renommer le dossier">${icon('edit', 14)}</button>
            <button class="sa-iconbtn is-danger" data-act="fold-delete" data-id="${f.id}" title="Supprimer le dossier">${icon('trash-2', 14)}</button>
          </span>
        </div>`;
        return `
      <div class="sa-folder">
        ${head}
        ${items.length
            ? `<div class="sa-agents">${items.map(card).join('')}</div>`
            : `<p class="sa-folder-empty">Vide — rangez-y un agent depuis ses Réglages.</p>`}
      </div>`;
    };
    const looseBlock = loose.length ? `
      <div class="sa-folder is-loose">
        <div class="sa-folder-head">
          <strong class="sa-folder-name">Sans dossier</strong>
          <span class="sa-folder-count">${loose.length} agent${loose.length > 1 ? 's' : ''}</span>
        </div>
        <div class="sa-agents">${loose.map(card).join('')}</div>
      </div>` : '';

    return `
    <section class="sa-kx">
      <div class="sa-kx-head">
        <div>
          <h2 class="sa-kx-title">Mes agents</h2>
          <p class="sa-kx-sub">${_ag.agents.length} agent${_ag.agents.length > 1 ? 's' : ''}${_ag.folders.length ? ` · ${_ag.folders.length} dossier${_ag.folders.length > 1 ? 's' : ''}` : ''} · chacun a son propre coffre</p>
        </div>
        <div class="sa-kx-acts">
          <button class="sa-btn" data-act="fold-new">${icon('folder', 16)} Nouveau dossier</button>
          <button class="sa-btn is-primary" data-act="ag-new">${icon('plus', 16)} Nouvel agent</button>
        </div>
      </div>
      ${editing?.mode === 'new' ? `<div class="sa-folder">${folderEditRow('Créer')}</div>` : ''}
      ${_ag.folders.map(folderBlock).join('')}
      ${looseBlock}
    </section>`;
}

// ═══════════════════════════════════════════════════════════════
// Wizard de création guidée (SA-4) — 4 étapes : Identité → Savoir
// → Garde-fous → Test (bac à sable + golden set). L'étape 3→4
// persiste l'agent (le bac à sable a besoin d'un agent réel).
// ═══════════════════════════════════════════════════════════════
// ── Formulaire agent (SA-4.3 : remplace le wizard ; Savoir & Test sont
//    désormais des onglets de l'agent). Sert à la création ET à l'onglet
//    Réglages. _ag.form = données en cours.
function _openForm(agent) {
    _ag.editing = agent || null;
    _ag.form = {
        id:       agent?.id || null,
        name:     agent?.name || '',
        mission:  agent?.config?.identity?.mission || '',
        tone:     agent?.config?.identity?.tone || 'professionnel et chaleureux',
        posture:  agent?.config?.identity?.posture || 'equilibre',
        opening:  agent?.config?.identity?.opening || '',
        fallback: agent?.config?.scope?.fallback_text || 'Je ne dispose pas de cette information.',
        folderId: agent?.folder_id ?? null,
    };
    _ag.formError = null; _ag.formBusy = false; _ag.suggestBusy = false;
    // SA-5.1 — état de publication, rechargé pour un agent existant.
    _ag.publish = { loading: !!agent?.id, busy: false, link: null, qr: null };
    if (agent?.id) _loadPublicLinks(agent.id);
    // Création (hors agent) → bascule en mode formulaire plein écran.
    // Onglet Réglages (dans un agent) → _setTab gère le rendu.
    if (!_cur.id) { _ag.mode = 'form'; _renderMain(); }
}

function _agentFormHTML() {
    const d = _ag.form || {};
    const isNew = !d.id;
    const postureChips = _POSTURES.map(p => `
      <button class="sa-posture ${d.posture === p.id ? 'is-on' : ''}" data-act="form-posture" data-v="${p.id}" title="${p.desc}">
        <strong>${p.label}</strong><span>${p.desc}</span>
      </button>`).join('');
    const err = _ag.formError ? `<p class="sa-ed-error">${_esc(_ag.formError)}</p>` : '';
    return `
    <section class="sa-kx sa-ed">
      ${isNew ? `<button class="sa-back" data-act="form-cancel">${icon('chevron-left', 16)} Mes agents</button>` : ''}
      <div class="sa-kx-head"><div><h2 class="sa-kx-title">${isNew ? 'Nouvel agent' : 'Réglages'}</h2></div></div>
      <p class="sa-wstep-intro">Qui est cet agent, et que fait-il ? C'est ce qui guide son ton, sa posture et son accueil.</p>

      <label class="sa-field"><span class="sa-field-label">Nom de l'agent *</span>
        <input class="sa-input" data-field="name" value="${_escAttr(d.name)}" placeholder="Ex. : Guide du musée, Conseiller boutique, Assistant SAV"></label>
      <label class="sa-field"><span class="sa-field-label">Mission * — que fait-il, pour qui ?</span>
        <textarea class="sa-textarea" data-field="mission" rows="3" placeholder="Ex. : Renseigner les visiteurs du musée sur les œuvres, les horaires et le parcours, avec chaleur et pédagogie.">${_esc(d.mission)}</textarea></label>
      <label class="sa-field"><span class="sa-field-label">Ton</span>
        <input class="sa-input" data-field="tone" value="${_escAttr(d.tone)}" placeholder="professionnel et chaleureux"></label>

      <label class="sa-field"><span class="sa-field-label">Dossier (optionnel) — pour regrouper vos agents</span>
        <select class="sa-input sa-select" data-field="folder">
          <option value="">— Sans dossier —</option>
          ${_ag.folders.map(f => `<option value="${f.id}"${d.folderId === f.id ? ' selected' : ''}>${_esc(f.name)}</option>`).join('')}
        </select></label>

      <label class="sa-field"><span class="sa-field-label">Posture — jusqu'où il relance avec ses propres questions</span></label>
      <div class="sa-posture-grid">${postureChips}</div>

      <label class="sa-field" style="margin-top:14px;">
        <span class="sa-field-label">Accueil — l'agent parle en premier (terminé par une question)</span>
        <textarea class="sa-textarea" data-field="opening" rows="2" placeholder="Bonjour ! Que puis-je vous faire découvrir aujourd'hui ?">${_esc(d.opening)}</textarea>
      </label>
      <button class="sa-btn sa-suggest-btn" data-act="form-suggest" ${_ag.suggestBusy ? 'disabled' : ''}>
        ${icon('sparkles', 14)} ${_ag.suggestBusy ? 'Génération…' : 'Proposer un accueil avec l\'IA'}
      </button>
      <p class="sa-field-hint">Laissé vide, l'accueil est généré automatiquement à la création.</p>

      <label class="sa-field" style="margin-top:14px;"><span class="sa-field-label">Phrase de repli — quand la réponse n'est pas dans son savoir</span>
        <input class="sa-input" data-field="fallback" value="${_escAttr(d.fallback)}" placeholder="Je ne dispose pas de cette information."></label>
      <div class="sa-guard-note">${icon('shield-check', 16)} <span>Chaque réponse cite ses fiches sources. Hors de son savoir, l'agent se tait — et la question rejoint ses « Trous » à combler.</span></div>

      ${err}
      <div class="sa-ed-actions">
        <button class="sa-btn is-primary" data-act="form-save" ${_ag.formBusy ? 'disabled' : ''}>${icon('save', 15)} ${_ag.formBusy ? 'Enregistrement…' : (isNew ? 'Créer l\'agent' : 'Enregistrer')}</button>
        ${isNew
            ? `<button class="sa-btn" data-act="form-cancel">Annuler</button>`
            : `<button class="sa-btn is-danger" data-act="form-delete">${icon('trash-2', 15)} Supprimer l'agent</button>`}
      </div>
      ${!isNew ? _publishHTML() : ''}
    </section>`;
}

// ═══════════════════════════════════════════════════════════════
// SA-5.1 — Publication publique (lien / QR) de l'agent
// ═══════════════════════════════════════════════════════════════
function _publishHTML() {
    const p = _ag.publish || {};
    if (p.loading) {
        return `<div class="sa-pub"><div class="sa-pub-head">${icon('share-2', 16)} Partager</div>
          <p class="sa-pub-note">Chargement…</p></div>`;
    }
    if (!p.link) {
        return `<div class="sa-pub">
          <div class="sa-pub-head">${icon('share-2', 16)} Partager avec le public</div>
          <p class="sa-pub-note">Publiez cet agent : vos visiteurs lui parlent par un lien ou un QR code, sans compte. Les réponses restent ancrées sur son savoir, et l'IA est décomptée de vos crédits.</p>
          <button class="sa-btn is-primary" data-act="pub-create" ${p.busy ? 'disabled' : ''}>${icon('globe', 15)} ${p.busy ? 'Publication…' : 'Publier cet agent'}</button>
        </div>`;
    }
    const url = p.link.url || '';
    const today = p.link.usage_today ?? 0;
    const total = p.link.usage_total ?? 0;
    const cap = p.link.max_per_day ?? 500;
    const exp = p.link.expires_at || '';
    return `<div class="sa-pub is-live">
      <div class="sa-pub-head">${icon('globe', 16)} En ligne — accessible au public</div>
      <div class="sa-pub-stat"><strong>${today}</strong> question${today === 1 ? '' : 's'} aujourd'hui · <strong>${total}</strong> au total${exp ? ` · expire le ${_esc(exp)}` : ''}</div>
      <p class="sa-pub-note">Partagez ce lien ou ce QR. Toute personne peut interroger l'agent, sans compte.</p>
      <div class="sa-pub-linkrow">
        <input class="sa-input sa-pub-url" value="${_escAttr(url)}" readonly onclick="this.select()">
        <button class="sa-btn" data-act="pub-copy" data-url="${_escAttr(url)}" title="Copier le lien">${icon('copy', 15)}</button>
      </div>
      <div class="sa-pub-actions">
        <button class="sa-btn" data-act="pub-qr">${icon('qr-code', 15)} ${p.qr ? 'Masquer le QR' : 'Afficher le QR'}</button>
        <button class="sa-btn is-danger" data-act="pub-revoke" data-id="${_escAttr(p.link.id || '')}">${icon('trash-2', 15)} Dépublier</button>
      </div>
      ${p.qr ? `<div class="sa-pub-qr">${p.qr}</div>` : ''}
      <details class="sa-pub-settings">
        <summary>Réglages du lien</summary>
        <label class="sa-field"><span class="sa-field-label">Questions max par jour (tous visiteurs confondus)</span>
          <input class="sa-input" type="number" min="1" max="100000" data-pub="maxday" value="${_escAttr(String(cap))}"></label>
        <label class="sa-field"><span class="sa-field-label">Expire le — vide = pas d'expiration</span>
          <input class="sa-input" type="date" data-pub="expire" value="${_escAttr(exp)}"></label>
        <button class="sa-btn is-primary" data-act="pub-save" ${p.busy ? 'disabled' : ''}>${icon('save', 15)} Mettre à jour</button>
      </details>
    </div>`;
}

// Recharge le lien public ACTIF de l'agent (le plus récent).
async function _loadPublicLinks(agentId) {
    try {
        const r = await _api('/agents/' + agentId + '/links');
        _ag.publish.link = (r.links || []).find(l => l.status === 'active') || null;
    } catch (_) { _ag.publish.link = null; }
    _ag.publish.loading = false;
    if (_cur.id === agentId && _cur.tab === 'reglages') _renderMain();
}

async function _doPublish() {
    const id = _ag.form?.id;
    if (!id || _ag.publish.busy) return;
    _ag.publish.busy = true; _renderMain();
    try {
        await _api('/agents/' + id + '/publish', { method: 'POST' });
        if (_cur.agent) _cur.agent.status = 'published';
        await _loadPublicLinks(id);          // récupère le lien + son id
        _toast('Agent publié — votre lien est prêt à partager.');
    } catch (e) {
        _toast(e.message || 'Publication impossible.', 'error');
    }
    _ag.publish.busy = false; _renderMain();
}

function _copyPublic(url) {
    if (!url) return;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => _toast('Lien copié'), () => {});
}

// QR généré à la demande (lib chargée depuis esm.sh, autorisée par la CSP).
async function _toggleQr() {
    if (_ag.publish.qr) { _ag.publish.qr = null; _renderMain(); return; }
    const url = _ag.publish.link?.url;
    if (!url) return;
    try {
        const mod = await import('https://esm.sh/qrcode-generator@1.4.4');
        const qrcode = mod.default || mod;
        const qr = qrcode(0, 'M');
        qr.addData(url); qr.make();
        _ag.publish.qr = qr.createSvgTag({ cellSize: 5, margin: 2 });
    } catch (_) {
        _ag.publish.qr = '<p class="sa-pub-note">QR indisponible — partagez le lien.</p>';
    }
    _renderMain();
}

async function _revokePublic(linkId) {
    if (!linkId) return;
    if (!confirm('Dépublier cet agent ? Le lien et le QR cesseront immédiatement de fonctionner.')) return;
    try {
        await _api('/links/' + linkId + '/revoke', { method: 'POST' });
        _ag.publish.link = null; _ag.publish.qr = null;
        if (_cur.agent) _cur.agent.status = 'draft';   // badge « En ligne » retiré
        _toast('Agent dépublié.');
    } catch (e) {
        _toast(e.message || 'Impossible de dépublier.', 'error');
    }
    _renderMain();
}

async function _savePublicSettings() {
    const id = _ag.publish.link?.id;
    if (!id) return;
    const main = _root.querySelector('[data-slot="main"]');
    const maxRaw = main?.querySelector('[data-pub="maxday"]')?.value;
    const expRaw = main?.querySelector('[data-pub="expire"]')?.value;
    const body = { expires_at: expRaw || null };
    const n = parseInt(maxRaw, 10);
    if (Number.isInteger(n)) body.max_per_day = n;
    try {
        await _api('/links/' + id, { method: 'PATCH', body });
        _toast('Réglages du lien mis à jour.');
        await _loadPublicLinks(_ag.form.id);   // recharge usage + réglages, re-render
    } catch (e) {
        _toast(e.message || 'Mise à jour impossible.', 'error');
    }
}

function _testerHTML() {
    return `
    <section class="sa-kx">
      <div class="sa-kx-head">
        <div>
          <h2 class="sa-kx-title">Tester</h2>
          <p class="sa-kx-sub">Comme le verront vos visiteurs — réponses ancrées sur le savoir de cet agent.</p>
        </div>
        <div class="sa-voice-ctrl">
          ${(typeof WebAssembly !== 'undefined') ? `<button class="sa-iconbtn sa-voice-toggle ${_voice.on ? 'is-on' : ''}" data-act="chat-voice" title="${_voice.on ? 'Couper la lecture (Siwis)' : 'Lire les réponses avec Siwis (voix neuronale)'}" aria-pressed="${_voice.on ? 'true' : 'false'}">${icon(_voice.on ? 'volume-2' : 'volume-x', 17)}</button>` : ''}
        </div>
      </div>
      ${_sandboxHTML()}
      ${_goldenHTML()}
    </section>`;
}

const _POSTURES = [
    { id: 'informatif', label: 'Informatif', desc: 'Répond, relance rarement' },
    { id: 'equilibre',  label: 'Équilibré',  desc: 'Répond + 1 question utile' },
    { id: 'proactif',   label: 'Proactif',   desc: 'Qualifie, propose la suite' },
];

// Lit le formulaire agent (DOM → _ag.form).
function _readAgentForm() {
    const main = _root.querySelector('[data-slot="main"]');
    if (!main || !_ag.form) return;
    const get = s => main.querySelector(s);
    const d = _ag.form;
    d.name    = get('[data-field="name"]')?.value.trim() ?? d.name;
    d.mission = get('[data-field="mission"]')?.value.trim() ?? d.mission;
    d.tone    = get('[data-field="tone"]')?.value.trim() ?? d.tone;
    const fo = get('[data-field="folder"]');   if (fo) d.folderId = fo.value || null;
    const op = get('[data-field="opening"]');  if (op) d.opening = op.value.trim();
    const fb = get('[data-field="fallback"]'); if (fb) d.fallback = fb.value.trim();
    // posture : pilotée par les chips (déjà dans d.posture)
}

function _formError(msg) { _ag.formError = msg || null; _renderMain(); }

// « Proposer un accueil avec l'IA » : génère depuis nom/mission/posture
// courants (endpoint sans état), puis remplit le champ Accueil.
async function _suggestOpening() {
    _readAgentForm();
    if (!_ag.form.mission) { _formError('Renseignez d\'abord la mission.'); return; }
    _ag.suggestBusy = true; _ag.formError = null; _renderMain();
    try {
        const r = await _api('/suggest-opening', {
            method: 'POST',
            body: { name: _ag.form.name, mission: _ag.form.mission, posture: _ag.form.posture },
        });
        if (r.opening) _ag.form.opening = r.opening;
    } catch (e) { _toast(e.message, 'error'); }
    _ag.suggestBusy = false; _renderMain();
}

function _agentPayload() {
    const d = _ag.form;
    return {
        name: d.name,
        folder_id: d.folderId ?? null,
        config: {
            identity: { mission: d.mission, tone: d.tone, posture: d.posture, opening: d.opening },
            scope:    { fallback_text: d.fallback },
        },
    };
}

async function _saveAgentForm() {
    _readAgentForm();
    const d = _ag.form;
    if (!d.name)    { _formError('Donnez un nom à votre agent.'); return; }
    if (!d.mission) { _formError('Décrivez la mission de l\'agent.'); return; }
    _ag.formError = null; _ag.formBusy = true; _renderMain();
    try {
        if (d.id) {
            // Édition (onglet Réglages) — on reste dans l'agent.
            const r = await _api(`/agents/${d.id}`, { method: 'PATCH', body: _agentPayload() });
            if (r.agent) {
                _cur.agent = r.agent; _cur.name = r.agent.name;
                const i = _ag.agents.findIndex(a => a.id === d.id);
                if (i >= 0) _ag.agents[i] = r.agent;
            }
            _ag.formBusy = false;
            _kx.scope = 'private';
            _loadSharedVault();   // SA-4.4.2 — le dossier a pu changer → recharge le coffre partagé
            _toast('Agent enregistré.');
            _renderRail(); _renderMain();
        } else {
            // Création — puis on entre dans l'agent (onglet Savoir).
            const r = await _api('/agents', { method: 'POST', body: _agentPayload() });
            _ag.formBusy = false; _ag.mode = 'list'; _ag.loaded = false;
            _toast('Agent créé — remplissez son savoir.');
            await _agLoad();
            if (r.agent?.id) _enterAgent(r.agent.id);
        }
    } catch (e) { _ag.formBusy = false; _formError(e.message); }
}

function _cancelForm() {
    if (_cur.id) { _openForm(_cur.agent); _renderMain(); }   // Réglages : annule les modifs
    else { _ag.mode = 'list'; _renderMain(); }                // Création : retour liste
}

// ── Bac à sable (réutilise l'état _chat + le rendu des messages) ──
function _sandboxHTML() {
    return `
    <div class="sa-sandbox">
      <div class="sa-chat-stream sa-sandbox-stream" data-slot="chat-stream">
        ${_chat.messages.length
            ? _chat.messages.map(_msgHTML).join('')
            : `<div class="sa-sandbox-empty">${icon('smart-agent', 22)}<span>Posez une première question à « ${_esc(_chat.agentName)} »…</span></div>`}
        ${_chat.busy ? `<div class="sa-msg is-agent"><div class="sa-bubble sa-bubble-typing">${icon('smart-agent', 14)} <span class="sa-dots"><i></i><i></i><i></i></span></div></div>` : ''}
      </div>
      <div class="sa-chat-input">
        <textarea class="sa-textarea" data-slot="chat-text" rows="1" maxlength="1000" placeholder="Posez une question…" ${_chat.busy ? 'disabled' : ''}></textarea>
        ${_speechSupported() ? `<button class="sa-iconbtn sa-mic-btn" data-act="chat-mic" title="Dicter votre question" aria-label="Dicter votre question" ${_chat.busy ? 'disabled' : ''}>${icon('mic', 18)}</button>` : ''}
        <button class="sa-btn is-primary" data-act="chat-send" ${_chat.busy ? 'disabled' : ''}>${icon('send', 16)}</button>
      </div>
    </div>`;
}

// ── Golden set (jeu de questions étalon + replay = score de santé) ─
function _goldenHTML() {
    const r = _gold.replay;
    const scoreBadge = r ? `<span class="sa-gold-score ${r.score >= 80 ? 'is-good' : r.score >= 50 ? 'is-mid' : 'is-bad'}">Santé ${r.score}% · ${r.passed}/${r.total}</span>` : '';
    const okMap = r ? new Map(r.results.map(x => [x.id, x.ok])) : null;
    const items = _gold.items.map(g => {
        const ok = okMap?.get(g.id);
        const verdict = ok === true ? `<span class="sa-gold-v is-ok">${icon('check', 12)}</span>`
            : ok === false ? `<span class="sa-gold-v is-ko">${icon('x', 12)}</span>` : '';
        return `
      <div class="sa-gold-item">
        ${verdict}
        <span class="sa-gold-q">${_esc(g.question)}</span>
        <span class="sa-gold-exp ${g.expect === 'fallback' ? 'is-fb' : ''}">${g.expect === 'fallback' ? 'doit ignorer' : 'doit répondre'}</span>
        <button class="sa-iconbtn is-danger" data-act="gold-del" data-id="${g.id}" title="Retirer">${icon('trash-2', 13)}</button>
      </div>`;
    }).join('');
    return `
    <div class="sa-gold">
      <div class="sa-gold-head">
        <strong>${icon('check-circle', 15)} Tests étalons</strong>
        ${scoreBadge}
        ${_gold.items.length ? `<button class="sa-btn" data-act="gold-replay" ${_gold.busy ? 'disabled' : ''}>${_gold.busy ? 'Replay…' : 'Rejouer'}</button>` : ''}
      </div>
      <p class="sa-field-hint">Épinglez des questions de référence, puis rejouez-les après chaque ajout de savoir : vous verrez aussitôt si l'agent progresse — ou régresse.</p>
      ${items ? `<div class="sa-gold-list">${items}</div>` : ''}
      <div class="sa-gold-add">
        <input class="sa-input" data-slot="gold-q" placeholder="Une question de référence…" maxlength="500">
        <div class="sa-gold-expect">
          <button class="sa-fchip ${_gold.addExpect === 'answer' ? 'is-on' : ''}" data-act="gold-expect" data-v="answer">doit répondre</button>
          <button class="sa-fchip ${_gold.addExpect === 'fallback' ? 'is-on' : ''}" data-act="gold-expect" data-v="fallback">doit ignorer</button>
        </div>
        <button class="sa-btn is-primary" data-act="gold-add">${icon('plus', 14)} Ajouter</button>
      </div>
    </div>`;
}

async function _goldLoad() {
    if (!_cur.id) return;
    try {
        const r = await _api(`/agents/${_cur.id}/golden`);
        _gold.items = r.golden || []; _gold.loaded = true;
        if (_cur.tab === 'tester') _renderMain();
    } catch (_) { /* non bloquant */ }
}
async function _goldAdd() {
    const main = _root.querySelector('[data-slot="main"]');
    const inp = main.querySelector('[data-slot="gold-q"]');
    const q = (inp?.value || '').trim();
    if (q.length < 2) { _toast('Question trop courte.', 'error'); return; }
    try {
        const r = await _api(`/agents/${_cur.id}/golden`, { method: 'POST', body: { question: q, expect: _gold.addExpect } });
        _gold.items.unshift(r.golden); _gold.replay = null;
        _renderMain();
    } catch (e) { _toast(e.message, 'error'); }
}
async function _goldDel(id) {
    try {
        await _api(`/golden/${id}`, { method: 'DELETE' });
        _gold.items = _gold.items.filter(g => g.id !== id); _gold.replay = null;
        _renderMain();
    } catch (e) { _toast(e.message, 'error'); }
}
async function _goldReplay() {
    if (!_gold.items.length) return;
    _gold.busy = true; _renderMain();
    try {
        _gold.replay = await _api(`/agents/${_cur.id}/golden/replay`, { method: 'POST' });
    } catch (e) { _toast(e.message, 'error'); }
    _gold.busy = false; _renderMain();
}

// ═══════════════════════════════════════════════════════════════
// Onglet TROUS (SA-4.3) — file de travail gap-driven, scopée à l'agent
// ═══════════════════════════════════════════════════════════════
async function _loadGaps() {
    if (!_cur.id) return;
    try {
        const r = await _api(`/gaps?agent=${encodeURIComponent(_cur.id)}`);
        _ag.gaps = r.gaps || []; _ag.gapsCount = r.count || 0;
    } catch (e) { /* badge non bloquant */ }
    _renderRail();
    if (_cur.tab === 'trous') _renderMain();
}

function _gapsHTML() {
    if (!_ag.gaps.length) {
        return `
      <section class="sa-kx">
        <div class="sa-kx-head"><div><h2 class="sa-kx-title">Questions sans réponse</h2><p class="sa-kx-sub">Rien à combler pour l'instant</p></div></div>
        <div class="sa-empty-filter">Aucun trou de savoir.<br><small>Quand cet agent ne sait pas répondre, la question atterrit ici — sa liste de travail pour faire grandir son coffre.</small></div>
      </section>`;
    }
    const row = g => `
    <article class="sa-gap">
      <span class="sa-gap-hits" title="Posée ${g.hits} fois">${g.hits}×</span>
      <span class="sa-gap-q">${_esc(g.question)}</span>
      <div class="sa-gap-acts">
        <button class="sa-btn is-primary" data-act="gap-answer" data-id="${g.id}">${icon('plus', 14)} Répondre</button>
        <button class="sa-iconbtn" data-act="gap-dismiss" data-id="${g.id}" title="Ignorer cette question">${icon('x', 15)}</button>
      </div>
    </article>`;
    return `
    <section class="sa-kx">
      <div class="sa-kx-head">
        <div><h2 class="sa-kx-title">Questions sans réponse</h2><p class="sa-kx-sub">${_ag.gaps.length} question${_ag.gaps.length > 1 ? 's' : ''} · la plus fréquente en tête</p></div>
        <button class="sa-btn is-primary" data-act="iv-start">${icon('smart-agent', 15)} Démarrer l'interview</button>
      </div>
      <p class="sa-field-hint" style="margin-bottom:14px;">« Répondre » ouvre une fiche Q/R pré-remplie. Ou lancez l'<strong>interview</strong> : répondez en langage naturel, l'IA structure et comble les trous un par un.</p>
      <div class="sa-gaps-list">${_ag.gaps.map(row).join('')}</div>
    </section>`;
}

// « Répondre » : bascule sur l'onglet Savoir, éditeur en création, fiche
// Q/R pré-remplie. La sauvegarde résout le trou (resolve_gap_id).
function _answerGap(gap) {
    if (!gap) return;
    _cur.tab = 'savoir';
    _kx.mode = 'editor'; _kx.editing = null; _kx.editType = 'qa';
    const title = gap.question.length > 80 ? gap.question.slice(0, 77) + '…' : gap.question;
    _kx.prefill = { title, body: { question: gap.question, answer: '' } };
    _kx.resolveGapId = gap.id;
    _kx.loaded = false;   // le coffre se rechargera (la fiche s'y ajoutera)
    _renderRail();
    _renderMain();
    _toast('Rédigez la réponse, puis validez la fiche pour combler ce trou.');
}

async function _dismissGap(id) {
    try {
        await _api(`/gaps/${id}/dismiss`, { method: 'POST' });
        _ag.gaps = _ag.gaps.filter(g => g.id !== id);
        _ag.gapsCount = Math.max(0, _ag.gapsCount - 1);
        _renderRail(); _renderMain();
    } catch (e) { _toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════
// SA-6 — INTERVIEW DU SAVOIR : parcours guidé pour combler les trous.
// L'expert répond en prose ; l'IA structure en fiches typées (réutilise
// le moteur d'extraction) ; valider comble le trou (resolve_gap_id).
// ═══════════════════════════════════════════════════════════════
function _interviewHTML() {
    const total = _iv.gaps.length;
    if (_iv.phase === 'done' || _iv.idx >= total) {
        return `
      <section class="sa-kx sa-iv">
        <div class="sa-iv-done">
          ${icon('check-circle', 40)}
          <h2>Interview terminée</h2>
          <p>Les fiches ajoutées sont en brouillon dans « Savoir » — validez-les quand vous voulez. Vous pouvez aussi laisser l'IA suggérer des questions pour aller plus loin.</p>
          <div class="sa-iv-doneacts">
            <button class="sa-btn is-primary" data-act="iv-explore" ${_iv.busy ? 'disabled' : ''}>${_iv.busy ? 'Génération…' : `${icon('sparkles', 15)} Explorer d'autres questions`} <em class="sa-credit-note">1 crédit IA</em></button>
            <button class="sa-btn" data-act="iv-quit">${icon('chevron-left', 15)} Retour aux questions</button>
          </div>
        </div>
      </section>`;
    }
    const g = _iv.gaps[_iv.idx];
    const head = `
      <div class="sa-iv-head">
        <span class="sa-iv-progress">Question ${_iv.idx + 1} / ${total}</span>
        <button class="sa-btn" data-act="iv-quit">${icon('x', 14)} Quitter</button>
      </div>`;
    if (_iv.phase === 'review') {
        const props = _iv.proposals.map((p, i) => {
            const t = KORTEX_TYPES.find(x => x.id === p.type) || { icon: 'kortex', label: p.type };
            return `
          <label class="sa-prop ${_iv.checked.has(i) ? 'is-on' : ''}" data-act="iv-toggle" data-i="${i}">
            <span class="sa-prop-check">${_iv.checked.has(i) ? icon('check', 13) : ''}</span>
            <span class="sa-prop-type">${icon(t.icon, 13)} ${t.label}</span>
            <span class="sa-prop-txt"><strong>${_esc(p.title)}</strong>
              <span>${_esc(Object.values(p.body).map(v => Array.isArray(v) ? v.join(' · ') : v).join(' — ')).slice(0, 140)}</span></span>
          </label>`;
        }).join('');
        return `
      <section class="sa-kx sa-iv">
        ${head}
        <p class="sa-iv-q">${_esc(g.question)}</p>
        <p class="sa-field-hint">L'IA a structuré votre réponse. Décochez ce qui ne convient pas, puis comblez le trou.</p>
        <div class="sa-ex-props">${props}</div>
        ${_iv.error ? `<p class="sa-ed-error">${_esc(_iv.error)}</p>` : ''}
        <div class="sa-ed-actions">
          <button class="sa-btn" data-act="iv-back">${icon('chevron-left', 15)} Reformuler</button>
          <button class="sa-btn is-primary" data-act="iv-commit" ${(!_iv.checked.size || _iv.busy) ? 'disabled' : ''}>${icon('check', 15)} Combler (${_iv.checked.size}) et continuer</button>
        </div>
      </section>`;
    }
    const ivIntro = g.virtual ? 'Pour enrichir ton agent :' : 'Un visiteur a demandé :';
    const ivTag = g.virtual ? `${icon('sparkles', 12)} Suggestion IA` : `${g.hits}× demandée`;
    return `
      <section class="sa-kx sa-iv">
        ${head}
        <div class="sa-iv-card">
          <span class="sa-iv-hits">${ivTag}</span>
          <p class="sa-iv-intro">${ivIntro}</p>
          <p class="sa-iv-q">${_esc(g.question)}</p>
        </div>
        <textarea class="sa-textarea sa-iv-answer" data-slot="iv-answer" rows="5" placeholder="Réponds comme tu l'expliquerais à l'oral, en langage naturel…">${_esc(_iv.answer)}</textarea>
        ${_iv.error ? `<p class="sa-ed-error">${_esc(_iv.error)}</p>` : ''}
        <div class="sa-ed-actions">
          <button class="sa-iconbtn" data-act="iv-dismiss" title="${g.virtual ? 'Passer cette suggestion' : 'Ignorer définitivement cette question'}">${icon('x', 15)}</button>
          <button class="sa-btn" data-act="iv-skip">Passer</button>
          <button class="sa-btn is-primary" data-act="iv-structure" ${_iv.busy ? 'disabled' : ''}>${_iv.busy ? 'Analyse…' : `${icon('sparkles', 15)} Structurer en fiche`} <em class="sa-credit-note">1 crédit IA</em></button>
        </div>
      </section>`;
}

function _startInterview() {
    if (!_ag.gaps.length) return;
    _iv.gaps = [..._ag.gaps];
    _iv.idx = 0; _iv.phase = 'ask'; _iv.answer = ''; _iv.proposals = []; _iv.checked = new Set(); _iv.error = null; _iv.busy = false;
    _iv.active = true;
    _renderMain();
}

async function _ivStructure() {
    const ta = _root.querySelector('[data-slot="iv-answer"]');
    const answer = (ta?.value || '').trim();
    if (answer.length < 10) { _iv.error = 'Réponse trop courte (10 caractères minimum).'; _renderMain(); return; }
    _iv.answer = answer; _iv.busy = true; _iv.error = null; _renderMain();
    const g = _iv.gaps[_iv.idx];
    try {
        const res = g.virtual
            ? await _api(`/agents/${_cur.id}/structure`, { method: 'POST', body: { question: g.question, answer } })
            : await _api(`/gaps/${g.id}/structure`, { method: 'POST', body: { answer } });
        _iv.proposals = res.proposals || [];
        _iv.checked = new Set(_iv.proposals.map((_, i) => i));
        if (!_iv.proposals.length) { _iv.error = 'Aucune fiche exploitable — précisez ou reformulez votre réponse.'; }
        else { _iv.phase = 'review'; }
    } catch (e) {
        _iv.error = (e.data?.code === 'AI_CREDITS_EXHAUSTED') ? 'Crédits IA épuisés ce mois.' : e.message;
    }
    _iv.busy = false; _renderMain();
}

function _ivToggle(i) {
    if (Number.isNaN(i)) return;
    if (_iv.checked.has(i)) _iv.checked.delete(i); else _iv.checked.add(i);
    _renderMain();
}

async function _ivCommit() {
    if (!_iv.checked.size || _iv.busy) return;
    _iv.busy = true; _renderMain();
    const g = _iv.gaps[_iv.idx];
    let added = 0;
    for (const i of _iv.checked) {
        const p = _iv.proposals[i];
        const body = { type: p.type, title: p.title, body: p.body, status: 'draft', source_kind: 'interview', agent_id: _cur.id };
        if (!g.virtual) body.resolve_gap_id = g.id;
        try { await _api('/kortex/units', { method: 'POST', body }); added++; } catch (_) { /* on continue, bilan via toast */ }
    }
    if (!g.virtual) {
        _ag.gaps = _ag.gaps.filter(x => x.id !== g.id);
        _ag.gapsCount = Math.max(0, _ag.gapsCount - 1);
        _renderRail();
    }
    _iv.busy = false;
    _toast(added ? `${g.virtual ? 'Savoir ajouté' : 'Trou comblé'} — ${added} fiche${added > 1 ? 's' : ''} en brouillon (à valider dans Savoir).` : 'Aucune fiche ajoutée.', added ? 'ok' : 'error');
    _ivNext();
}

async function _ivDismiss() {
    const g = _iv.gaps[_iv.idx];
    if (!g.virtual) {
        try {
            await _api(`/gaps/${g.id}/dismiss`, { method: 'POST' });
            _ag.gaps = _ag.gaps.filter(x => x.id !== g.id);
            _ag.gapsCount = Math.max(0, _ag.gapsCount - 1);
            _renderRail();
        } catch (e) { _toast(e.message, 'error'); }
    }
    _ivNext();
}

function _ivNext() {
    _iv.idx++;
    _iv.phase = 'ask'; _iv.answer = ''; _iv.proposals = []; _iv.checked = new Set(); _iv.error = null;
    if (_iv.idx >= _iv.gaps.length) _iv.phase = 'done';
    _renderMain();
}

function _ivQuit() {
    _iv.active = false;
    _loadGaps();   // recharge la file (trous comblés / ignorés retirés)
    _renderMain();
}

// SA-6.1 — Interview LIBRE : l'IA génère des questions au-delà des trous.
async function _ivExplore() {
    if (_iv.busy) return;
    _iv.busy = true; _renderMain();
    try {
        const res = await _api(`/agents/${_cur.id}/explore`, { method: 'POST' });
        const qs = (res.questions || []).map(q => ({ id: null, virtual: true, question: q, hits: 0 }));
        if (!qs.length) { _toast('Aucune nouvelle question proposée pour l\'instant.', 'error'); }
        else {
            _iv.gaps = qs; _iv.idx = 0; _iv.phase = 'ask'; _iv.answer = ''; _iv.proposals = []; _iv.checked = new Set(); _iv.error = null;
        }
    } catch (e) {
        _toast((e.data?.code === 'AI_CREDITS_EXHAUSTED') ? 'Crédits IA épuisés ce mois.' : e.message, 'error');
    }
    _iv.busy = false; _renderMain();
}

async function _deleteAgent(id) {
    if (!id) return;
    const a = _ag.agents.find(x => x.id === id) || _cur.agent;
    if (!confirm(`Supprimer l'agent « ${a?.name || ''} » ?\nSon savoir PRIVÉ (fiches, trous, tests) sera supprimé. Le coffre PARTAGÉ de son dossier est conservé. Cette action est irréversible.`)) return;
    try {
        await _api(`/agents/${id}`, { method: 'DELETE' });
        _toast('Agent supprimé.');
        _cur.id = null; _cur.agent = null; _ag.mode = 'list'; _ag.loaded = false;
        await _agLoad();
        _renderRail();
    } catch (e) { _toast(e.message, 'error'); }
}

function _msgHTML(m) {
    if (m.role === 'user') {
        return `<div class="sa-msg is-user"><div class="sa-bubble">${_esc(m.content)}</div></div>`;
    }
    // Agent : repli honnête mis en évidence, sinon réponse + citations
    if (m.gapped) {
        return `
      <div class="sa-msg is-agent">
        <div class="sa-bubble sa-bubble-gap">${icon('eye-off', 14)} ${_esc(m.content)}</div>
        <span class="sa-msg-note">Hors de son savoir actuel — question notée comme « trou » à combler.</span>
      </div>`;
    }
    const sources = (m.citations && m.citations.length) ? `
      <div class="sa-sources">
        <span class="sa-sources-lbl">Sources&nbsp;:</span>
        ${m.citations.map(c => `<button class="sa-srcref" data-act="chat-cite" data-uid="${c.unit_id}" title="${_escAttr(c.title)}">[${c.n}] ${_esc(c.title)}</button>`).join('')}
      </div>` : '';
    return `
    <div class="sa-msg is-agent">
      <div class="sa-bubble">${_renderReply(m.content, m.citations || [])}</div>
      ${sources}
    </div>`;
}

// Rend la réponse : échappe le texte, puis transforme les [n] cités en
// pastilles cliquables (vers la fiche source). pre-wrap géré en CSS.
function _renderReply(reply, citations) {
    const byN = new Map(citations.map(c => [c.n, c.unit_id]));
    return _esc(reply).replace(/\[(\d{1,2})\]/g, (full, d) => {
        const n = parseInt(d, 10);
        const uid = byN.get(n);
        return uid
            ? `<button class="sa-cite" data-act="chat-cite" data-uid="${uid}" title="Voir la fiche source">${n}</button>`
            : full;
    });
}

function _bindChatInput(main) {
    const ta = main.querySelector('[data-slot="chat-text"]');
    if (!ta) return;
    // Auto-grow + Enter pour envoyer (Shift+Enter = nouvelle ligne)
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
    ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendChat(); }
    });
    if (!_chat.busy) setTimeout(() => ta.focus(), 30);
}

function _scrollChatBottom() {
    const stream = _root.querySelector('[data-slot="chat-stream"]');
    if (stream) stream.scrollTop = stream.scrollHeight;
}

// ── Vocal : dictée (SpeechRecognition) + lecture à voix haute (speechSynthesis).
// Les deux sont des API navigateur (gratuites). Les boutons ne s'affichent que
// si le navigateur sait faire (dégradation propre sur Firefox notamment).
function _speechSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
function _ttsSupported() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }
// La lecture utilise UNIQUEMENT la voix neuronale Siwis (cf. _piperSpeak /
// app/lib/piper-tts.js). Les voix système speechSynthesis ont été retirées.
function _startDictation(slotSel) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (_voice.listening) { try { _voice.rec && _voice.rec.stop(); } catch (_) {} return; }
    const ta = _root.querySelector(slotSel);
    if (!ta) return;
    const micBtn = _root.querySelector('[data-act="chat-mic"]');
    try {
        const rec = new SR();
        _voice.rec = rec;
        rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false;
        const base = (ta.value || '').trim();
        rec.onstart = () => { _voice.listening = true; micBtn && micBtn.classList.add('is-listening'); };
        rec.onresult = (e) => {
            let txt = '';
            for (let k = 0; k < e.results.length; k++) txt += e.results[k][0].transcript;
            ta.value = (base ? base + ' ' : '') + txt;
            ta.dispatchEvent(new Event('input'));
        };
        rec.onerror = () => { _voice.listening = false; micBtn && micBtn.classList.remove('is-listening'); };
        rec.onend = () => { _voice.listening = false; micBtn && micBtn.classList.remove('is-listening'); ta.focus(); };
        rec.start();
    } catch (_) { _voice.listening = false; }
}
function _toggleVoice() {
    _voice.on = !_voice.on;
    try { localStorage.setItem('sa_voice_on', _voice.on ? '1' : '0'); } catch (_) {}
    if (!_voice.on) {
        if (_ttsSupported()) window.speechSynthesis.cancel();
        if (_piper.audio) { try { _piper.audio.pause(); } catch (_) {} }
    }
    _renderMain();
}
function _speak(text) {
    if (!_voice.on || !text) return;
    _piperSpeak(text);    // voix neuronale Siwis — seule voix proposée
}
// Lecture via le moteur Piper maison (import paresseux + génération + audio).
// Voyant « is-loading » sur le bouton haut-parleur pendant le travail (1er
// usage = téléchargement du modèle ~60 Mo, puis ~1-3 s/phrase).
async function _piperSpeak(text) {
    const clean = String(text).replace(/\[\d{1,2}\]/g, '').trim();
    if (!clean) return;
    try { if (_ttsSupported()) window.speechSynthesis.cancel(); } catch (_) {}
    if (_piper.audio) { try { _piper.audio.pause(); } catch (_) {} }
    if (_piper.busy) return;            // pas de générations concurrentes
    _piper.busy = true;
    const btn = _root && _root.querySelector('[data-act="chat-voice"]');
    if (btn) btn.classList.add('is-loading');
    try {
        if (!_piper.mod) _piper.mod = await import('./lib/piper-tts.js');
        const wav = await _piper.mod.synthToWav(clean);
        if (!_voice.on) return;         // l'utilisateur a coupé entre-temps
        if (!_piper.audio) _piper.audio = new Audio();
        _piper.audio.src = URL.createObjectURL(wav);
        _piper.audio.play().catch(() => {});
    } catch (_) {
        // silencieux : si le moteur échoue, on ne lit rien (pas de bruit parasite)
    } finally {
        _piper.busy = false;
        if (btn) btn.classList.remove('is-loading');
    }
}

async function _sendChat() {
    if (_chat.busy) return;
    const main = _root.querySelector('[data-slot="main"]');
    const ta = main.querySelector('[data-slot="chat-text"]');
    const message = (ta?.value || '').trim();
    if (!message) return;

    _chat.messages.push({ role: 'user', content: message });
    _chat.busy = true;
    _renderMain();

    try {
        const res = await _api(`/agents/${_chat.agentId}/chat`, {
            method: 'POST',
            body: { message, session_id: _chat.sessionId },
        });
        _chat.sessionId = res.session_id || _chat.sessionId;
        _chat.messages.push({
            role: 'agent', content: res.reply || '',
            citations: res.citations || [], gapped: !!res.gapped,
        });
        _speak(res.reply || '');
    } catch (e) {
        const msg = (e.data?.code === 'AI_CREDITS_EXHAUSTED')
            ? 'Crédits IA épuisés ce mois — rachetez un pack ou attendez le 1er du mois.'
            : `Erreur : ${e.message}`;
        _chat.messages.push({ role: 'agent', content: msg, citations: [], gapped: false, error: true });
    }
    _chat.busy = false;
    _renderMain();
}

// Clic sur une citation (depuis le bac à sable) → bascule sur l'onglet
// Savoir et ouvre la fiche source de cet agent.
async function _openUnitFromChat(uid) {
    if (!uid) return;
    _cur.tab = 'savoir';
    _kx.filterType = 'all'; _kx.filterStatus = 'all'; _kx.loaded = false;
    _kxs.results = null; _kxs.q = '';
    _renderRail();
    await _kxLoad();
    const u = _kx.units.find(x => x.id === uid);
    if (u) { _openEditor(u); }
    else { _kx.mode = 'list'; _renderMain(); _toast('Fiche introuvable (peut-être modifiée depuis).', 'error'); }
}

// ── Vue KORTEX — le coffre ─────────────────────────────────────
// SA-4.4.2 — sélecteur de coffre (privé de l'agent / partagé du dossier).
// N'apparaît que si l'agent appartient à un dossier.
function _kxScopeBarHTML() {
    const a = _cur.agent;
    if (!a?.folder_id) return '';
    const folderName = _ag.folders.find(f => f.id === a.folder_id)?.name || 'dossier';
    if (!_kx.sharedVault) {
        return `
      <div class="sa-vaultbar">
        <span class="sa-vaultbar-txt">${icon('share-2', 15)} Le dossier « ${_esc(folderName)} » peut avoir un coffre commun à tous ses agents.</span>
        <button class="sa-btn is-sm" data-act="kx-create-shared">${icon('plus', 14)} Créer le coffre partagé</button>
      </div>`;
    }
    return `
      <div class="sa-vaulttoggle-row">
        <div class="sa-vaulttoggle" role="tablist">
          <button class="sa-vtab ${_kx.scope === 'private' ? 'is-on' : ''}" data-act="kx-scope" data-v="private">${icon('lock', 14)} Coffre privé</button>
          <button class="sa-vtab ${_kx.scope === 'shared' ? 'is-on' : ''}" data-act="kx-scope" data-v="shared">${icon('share-2', 14)} Partagé · ${_esc(folderName)}</button>
        </div>
        ${_kx.scope === 'shared' ? `<button class="sa-iconbtn is-danger" data-act="kx-del-shared" title="Supprimer le coffre partagé du dossier">${icon('trash-2', 15)}</button>` : ''}
      </div>`;
}

function _kortexViewHTML() {
    if (_kx.loading) {
        return `<div class="sa-loading">${icon('refresh', 18)} Chargement du coffre…</div>`;
    }
    if (_kx.error) {
        return `
      <section class="sa-hero">
        <div class="sa-hero-ico">${icon('kortex', 40)}</div>
        <h1 class="sa-hero-title">Le coffre Kortex</h1>
        <p class="sa-hero-lead">${_esc(_kx.error)}</p>
      </section>`;
    }
    const scopeBar = _kxScopeBarHTML();
    const isShared = _kx.scope === 'shared' && !!_kx.sharedVault;

    // Coffre courant vide → pédagogie + CTA (le sélecteur reste accessible).
    if (!_kx.counts.total) {
        return `
      <section class="sa-kx">
        ${scopeBar}
        <div class="sa-hero sa-hero-incoffre">
          <div class="sa-hero-ico">${icon('kortex', 40)}</div>
          <h1 class="sa-hero-title">${isShared ? 'Coffre partagé du dossier' : 'Le coffre Kortex'}</h1>
          <p class="sa-hero-lead">
            ${isShared
                ? 'Les fiches ajoutées ici sont <strong>communes à tous les agents</strong> de ce dossier — idéal pour un savoir mutualisé (infos pratiques, règles maison…).'
                : 'Votre savoir-faire, structuré en fiches typées — la matière première de vos agents. Chaque fiche est validée par vous avant d\'être servie : c\'est votre actif, pas celui de l\'IA.'}
          </p>
          <div class="sa-cta-row">
            <button class="sa-btn is-primary" data-act="kx-new">${icon('plus', 16)} Créer ma première fiche</button>
            <button class="sa-btn" data-act="kx-extract">${icon('sparkles', 16)} Coller du texte</button>
          </div>
          ${isShared ? '' : `
          <div class="sa-types-grid">
            ${KORTEX_TYPES.map(t => `
              <div class="sa-type-card">
                <span class="sa-type-ico">${icon(t.icon, 18)}</span>
                <strong class="sa-type-name">${t.label}</strong>
                <span class="sa-type-desc">${t.desc}</span>
              </div>`).join('')}
          </div>`}
        </div>
      </section>`;
    }

    const c = _kx.counts;
    const fStatus = (v, label, n) => `
    <button class="sa-fchip ${_kx.filterStatus === v ? 'is-on' : ''}" data-act="kx-fstatus" data-v="${v}">
      ${label}${n !== undefined ? ` <em>${n}</em>` : ''}
    </button>`;
    const fType = (v, label) => `
    <button class="sa-fchip ${_kx.filterType === v ? 'is-on' : ''}" data-act="kx-ftype" data-v="${v}">${label}</button>`;

    return `
    <section class="sa-kx">
      ${scopeBar}
      <div class="sa-kx-head">
        <div>
          <h2 class="sa-kx-title">${isShared ? 'Savoir partagé' : 'Savoir'}</h2>
          <p class="sa-kx-sub">${c.total} fiche${c.total > 1 ? 's' : ''} · ${c.validated} validée${c.validated > 1 ? 's' : ''} · ${isShared ? 'commun au dossier' : 'propre à cet agent'}</p>
        </div>
        <div class="sa-kx-acts">
          <button class="sa-btn" data-act="kx-extract" title="Analyser un texte et en extraire des fiches (1 crédit IA)">
            ${icon('sparkles', 16)} Coller du texte
          </button>
          <button class="sa-btn is-primary" data-act="kx-new">${icon('plus', 16)} Nouvelle fiche</button>
        </div>
      </div>

      ${_searchBarHTML()}

      ${_kxs.busy ? `
      <div class="sa-loading">${icon('search', 16)} Recherche dans le coffre…</div>` : _kxs.results !== null ? _searchResultsHTML() : `
      <div class="sa-chips">
        ${fStatus('all', 'Toutes', c.total)}
        ${fStatus('draft', 'Brouillons', c.draft)}
        ${fStatus('validated', 'Validées', c.validated)}
        ${c.quarantine ? fStatus('quarantine', 'Quarantaine', c.quarantine) : ''}
        ${c.expired ? fStatus('expired', 'Périmées', c.expired) : ''}
      </div>
      <div class="sa-chips sa-chips-types">
        ${fType('all', 'Tous types')}
        ${KORTEX_TYPES.map(t => fType(t.id, t.label)).join('')}
      </div>

      ${_kx.units.length ? `
      <div class="sa-units">
        ${_kx.units.map(_unitRowHTML).join('')}
      </div>` : `
      <div class="sa-empty-filter">Aucune fiche ne correspond à ce filtre.</div>`}`}
    </section>
  `;
}

// ── Recherche hybride (SA-2) : l'étape 2 du moteur, testable au coffre.
// C'est EXACTEMENT la récupération que l'agent utilisera au SA-3 — la
// tester ici, c'est auditer ce que l'agent saura retrouver.
function _searchBarHTML() {
    return `
    <div class="sa-search">
      <span class="sa-search-ico">${icon('search', 16)}</span>
      <input class="sa-input sa-search-input" data-slot="kx-q" maxlength="500"
             placeholder="Testez votre coffre : posez une question naturelle…"
             value="${_escAttr(_kxs.q)}">
      <button class="sa-btn is-primary" data-act="kx-search">Chercher</button>
      ${_kxs.results !== null ? `<button class="sa-btn" data-act="kx-search-clear" title="Revenir aux fiches">${icon('x', 14)}</button>` : ''}
    </div>`;
}

function _searchResultsHTML() {
    const n = _kxs.results.length;
    const modeNote = _kxs.mode === 'hybrid'
        ? 'Recherche hybride — mots exacts + sens (sémantique)'
        : 'Recherche lexicale (mots exacts) — la couche sémantique s\'activera au déploiement de l\'index';
    if (!n) {
        return `
      <p class="sa-search-note">${modeNote}</p>
      <div class="sa-empty-filter">
        Aucune fiche validée ne répond à cette question.<br>
        <small>C'est un trou de savoir — à l'étape « Dialogue ancré », ces questions alimenteront
        automatiquement votre liste de travail.</small>
      </div>`;
    }
    const row = r => {
        const t = KORTEX_TYPES.find(x => x.id === r.unit.type) || KORTEX_TYPES[0];
        return `
      <article class="sa-unit" data-act="kx-edit" data-id="${r.unit.id}" role="button" tabindex="0">
        <span class="sa-unit-ico" title="${t.label}">${icon(t.icon, 18)}</span>
        <div class="sa-unit-txt">
          <strong class="sa-unit-title">${_esc(r.unit.title)}</strong>
          <span class="sa-unit-snip">${_esc(_snippet(r.unit))}</span>
          <span class="sa-unit-meta">${t.label}</span>
        </div>
        <div class="sa-srcs">
          ${r.lexRank ? `<span class="sa-src" title="Trouvée par les mots exacts (rang ${r.lexRank})">${icon('search', 11)} Mots №${r.lexRank}</span>` : ''}
          ${r.vecRank ? `<span class="sa-src is-vec" title="Trouvée par le sens${r.vecScore != null ? ` (similarité ${Math.round(r.vecScore * 100)}%)` : ''}">${icon('sparkles', 11)} Sens${r.vecScore != null ? ` ${Math.round(r.vecScore * 100)}%` : ''}</span>` : ''}
        </div>
      </article>`;
    };
    return `
    <p class="sa-search-note">${modeNote} · ${n} résultat${n > 1 ? 's' : ''}, du plus pertinent au moins pertinent</p>
    <div class="sa-units">${_kxs.results.map(row).join('')}</div>`;
}

function _bindKortexInputs(main) {
    const q = main.querySelector('[data-slot="kx-q"]');
    if (q) q.addEventListener('keydown', e => { if (e.key === 'Enter') _runSearch(); });
}

async function _runSearch() {
    const main = _root.querySelector('[data-slot="main"]');
    const q = (main.querySelector('[data-slot="kx-q"]')?.value || '').trim();
    if (q.length < 2) { _toast('Posez une vraie question (2 caractères minimum).', 'error'); return; }
    _kxs.q = q; _kxs.busy = true;
    _renderMain();
    try {
        const res = await _api(`/kortex/search?q=${encodeURIComponent(q)}&agent=${encodeURIComponent(_cur.id)}`);
        _kxs.results = res.results || [];
        _kxs.mode = res.mode || null;
    } catch (e) {
        _kxs.results = null; _kxs.mode = null;
        _toast(e.message, 'error');
    }
    _kxs.busy = false;
    _renderMain();
}

function _clearSearch() {
    _kxs.q = ''; _kxs.results = null; _kxs.mode = null; _kxs.busy = false;
    _renderMain();
}

function _unitRowHTML(u) {
    const t = KORTEX_TYPES.find(x => x.id === u.type) || KORTEX_TYPES[0];
    const st = STATUS_META[u.status] || STATUS_META.draft;
    const snippet = _esc(_snippet(u));
    return `
    <article class="sa-unit" data-act="kx-edit" data-id="${u.id}" role="button" tabindex="0">
      <span class="sa-unit-ico" title="${t.label}">${icon(t.icon, 18)}</span>
      <div class="sa-unit-txt">
        <strong class="sa-unit-title">${_esc(u.title)}</strong>
        ${snippet ? `<span class="sa-unit-snip">${snippet}</span>` : ''}
        <span class="sa-unit-meta">${t.label}${u.source_ref ? ` · ${_esc(u.source_ref)}` : ''}</span>
      </div>
      <span class="sa-badge ${st.cls}">${st.label}</span>
      <div class="sa-unit-acts">
        ${u.status === 'draft' ? `
        <button class="sa-iconbtn is-ok" data-act="kx-validate" data-id="${u.id}" title="Valider — la fiche devient servable">
          ${icon('check', 15)}
        </button>` : ''}
        <button class="sa-iconbtn is-danger" data-act="kx-delete" data-id="${u.id}" title="Supprimer">
          ${icon('trash-2', 15)}
        </button>
      </div>
    </article>
  `;
}

// Snippet = body_text sans la 1re ligne (le titre)
function _snippet(u) {
    const vals = Object.values(u.body || {})
        .map(v => Array.isArray(v) ? v.join(' · ') : String(v))
        .join(' — ');
    return vals.length > 130 ? vals.slice(0, 130) + '…' : vals;
}

// ═══════════════════════════════════════════════════════════════
// Éditeur de fiche (création / modification)
// ═══════════════════════════════════════════════════════════════
function _openEditor(unit) {
    _kx.mode = 'editor';
    _kx.editing = unit;
    if (unit) _kx.editType = unit.type;
    _renderMain();
}

function _editorHTML() {
    const isNew = !_kx.editing;
    const type  = isNew ? _kx.editType : _kx.editing.type;
    const t     = KORTEX_TYPES.find(x => x.id === type);
    // En création, _kx.prefill peut pré-remplir (ex. « Répondre » à un trou).
    const pf    = (isNew && _kx.prefill) ? _kx.prefill : null;
    const u     = _kx.editing || pf || {};
    const body  = u.body || {};
    const fromGap = isNew && _kx.resolveGapId;

    const typeChips = isNew ? `
    <div class="sa-chips sa-chips-types sa-ed-types">
      ${KORTEX_TYPES.map(x => `
        <button class="sa-fchip ${type === x.id ? 'is-on' : ''}" data-act="ed-type" data-v="${x.id}" title="${x.desc}">
          ${icon(x.icon, 13)} ${x.label}
        </button>`).join('')}
    </div>` : `
    <div class="sa-ed-typefix">${icon(t.icon, 15)} ${t.label}<span class="sa-ed-typefix-note">— le type d'une fiche ne change pas (recréez plutôt)</span></div>`;

    const fields = FIELD_TEMPLATES[type].map(f => {
        let val = body[f.k] ?? '';
        if (f.list && Array.isArray(val)) val = val.join('\n');
        return `
      <label class="sa-field">
        <span class="sa-field-label">${f.label}${f.req ? ' *' : ''}</span>
        ${f.kind === 'input'
            ? `<input class="sa-input" data-field="${f.k}" value="${_escAttr(val)}" placeholder="${_escAttr(f.ph || '')}">`
            : `<textarea class="sa-textarea" data-field="${f.k}" rows="${f.list ? 5 : 3}" placeholder="${_escAttr(f.ph || '')}">${_esc(val)}</textarea>`}
      </label>`;
    }).join('');

    const st = STATUS_META[u.status]?.label;
    return `
    <section class="sa-kx sa-ed">
      <button class="sa-back" data-act="ed-back">${icon('chevron-left', 16)} Savoir</button>
      <div class="sa-kx-head">
        <div>
          <h2 class="sa-kx-title">${isNew ? 'Nouvelle fiche' : 'Modifier la fiche'}</h2>
          ${st && !isNew ? `<p class="sa-kx-sub">Statut actuel : ${st}</p>` : ''}
        </div>
      </div>

      ${fromGap ? `<div class="sa-guard-note sa-fromgap">${icon('help-circle', 16)} <span>Vous comblez un <strong>trou de savoir</strong>. Validez la fiche pour que l'agent sache répondre — la question quittera la file.</span></div>` : ''}

      ${typeChips}

      <label class="sa-field">
        <span class="sa-field-label">Titre *</span>
        <input class="sa-input" data-field="__title" value="${_escAttr(u.title || '')}" placeholder="Court et descriptif — ce que la fiche contient">
      </label>

      ${fields}

      <div class="sa-ed-meta">
        <label class="sa-field">
          <span class="sa-field-label">Source (optionnel)</span>
          <input class="sa-input" data-field="__source" value="${_escAttr(u.source_ref || '')}" placeholder="D'où vient ce savoir ? (doc, personne, terrain…)">
        </label>
        <label class="sa-field">
          <span class="sa-field-label">À revérifier le (optionnel)</span>
          <input class="sa-input" type="date" data-field="__review" value="${_escAttr((u.review_at || '').slice(0, 10))}">
        </label>
      </div>

      <p class="sa-ed-error" data-slot="ed-error" hidden></p>

      <div class="sa-ed-actions">
        ${isNew ? `
          <button class="sa-btn" data-act="ed-save" data-status="draft">${icon('save', 15)} Enregistrer en brouillon</button>
          <button class="sa-btn is-primary" data-act="ed-save" data-status="validated">${icon('check', 15)} Enregistrer et valider</button>
        ` : `
          <button class="sa-btn is-primary" data-act="ed-save">${icon('save', 15)} Enregistrer</button>
          ${u.status !== 'validated' ? `<button class="sa-btn is-ok" data-act="ed-status" data-v="validated">${icon('check', 15)} Valider</button>` : ''}
          ${u.status === 'validated' ? `<button class="sa-btn" data-act="ed-status" data-v="quarantine" title="Retire la fiche du service sans la supprimer">${icon('eye-off', 15)} Quarantaine</button>` : ''}
          ${(u.status === 'quarantine' || u.status === 'expired') ? `<button class="sa-btn is-ok" data-act="ed-status" data-v="validated">${icon('check', 15)} Réactiver</button>` : ''}
          <button class="sa-btn is-danger" data-act="ed-delete">${icon('trash-2', 15)} Supprimer</button>
        `}
      </div>
    </section>
  `;
}

// Pas de logique au clavier à brancher pour l'instant — placeholder pour
// les raccourcis (Cmd+S) d'un sprint de polissage.
function _bindEditorInputs() {}

function _readEditorForm() {
    const main = _root.querySelector('[data-slot="main"]');
    const get  = sel => main.querySelector(sel);
    const type = _kx.editing ? _kx.editing.type : _kx.editType;
    const body = {};
    for (const f of FIELD_TEMPLATES[type]) {
        const el = get(`[data-field="${f.k}"]`);
        if (!el) continue;
        body[f.k] = f.list ? el.value : el.value.trim();
    }
    return {
        type,
        title: get('[data-field="__title"]')?.value.trim() || '',
        body,
        source_ref: get('[data-field="__source"]')?.value.trim() || null,
        review_at: get('[data-field="__review"]')?.value || null,
    };
}

function _editorError(msg) {
    const el = _root.querySelector('[data-slot="ed-error"]');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
}

async function _saveEditor(status) {
    const form = _readEditorForm();
    // Validation front minimale (le worker revalide tout)
    if (!form.title) { _editorError('Titre requis.'); return; }
    for (const f of FIELD_TEMPLATES[form.type]) {
        const v = form.body[f.k];
        if (f.req && (!v || !String(v).trim())) { _editorError(`Champ requis : ${f.label}`); return; }
    }
    _editorError(null);

    try {
        if (_kx.editing) {
            const payload = { title: form.title, body: form.body,
                source_ref: form.source_ref, review_at: form.review_at };
            if (status) payload.status = status;
            await _api(`/kortex/units/${_kx.editing.id}`, { method: 'PATCH', body: payload });
            _toast(status === 'validated' ? 'Fiche validée — elle peut désormais être servie.' : 'Fiche enregistrée.');
        } else {
            // Création — silo : la fiche appartient à l'agent courant.
            // Boucle gap-driven : resolve_gap_id résout le trou côté worker.
            // SA-4.4.2 — cible le coffre courant (privé de l'agent ou partagé du dossier).
            const payload = { ...form, status: status || 'draft' };
            if (_kx.scope === 'shared' && _kx.sharedVault) {
                payload.vault_id = _kx.sharedVault.id;
            } else {
                payload.agent_id = _cur.id;
                if (_kx.resolveGapId) payload.resolve_gap_id = _kx.resolveGapId;
            }
            await _api('/kortex/units', { method: 'POST', body: payload });
            _toast(_kx.resolveGapId
                ? (status === 'validated' ? 'Trou comblé — l\'agent saura répondre.' : 'Réponse enregistrée en brouillon — validez-la pour combler le trou.')
                : (status === 'validated' ? 'Fiche créée et validée.' : 'Fiche enregistrée en brouillon.'));
        }
        _kx.mode = 'list'; _kx.editing = null;
        _kx.prefill = null; _kx.resolveGapId = null;
        _kxReload();
    } catch (e) {
        _editorError(e.message);
    }
}

async function _quickStatus(id, status) {
    try {
        await _api(`/kortex/units/${id}`, { method: 'PATCH', body: { status } });
        _toast(status === 'validated' ? 'Fiche validée.' : 'Statut mis à jour.');
        _kxReload();
    } catch (e) { _toast(e.message, 'error'); }
}

async function _deleteUnit(id, fromEditor = false) {
    if (!id) return;
    const u = _kx.units.find(x => x.id === id) || _kx.editing;
    if (!confirm(`Supprimer définitivement la fiche « ${u?.title || ''} » ?\nCette action est irréversible.`)) return;
    try {
        await _api(`/kortex/units/${id}`, { method: 'DELETE' });
        _toast('Fiche supprimée.');
        if (fromEditor) { _kx.mode = 'list'; _kx.editing = null; }
        _kxReload();
    } catch (e) { _toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════
// Extraction coller-texte (1 crédit IA, relecture avant ajout)
// ═══════════════════════════════════════════════════════════════
function _openExtract() {
    _ex.open = true; _ex.busy = false; _ex.proposals = []; _ex.checked = new Set(); _ex.error = null;
    _renderOverlay();
}
function _closeExtract() {
    _ex.open = false;
    _renderOverlay();
}

function _renderOverlay() {
    const slot = _root.querySelector('[data-slot="overlay"]');
    if (!_ex.open) { slot.innerHTML = ''; return; }

    let inner;
    if (_ex.busy) {
        inner = `<div class="sa-ex-busy">${icon('sparkles', 22)}<p>Analyse du texte en cours…<br><small>L'IA propose des fiches — rien n'est ajouté sans votre relecture.</small></p></div>`;
    } else if (_ex.proposals.length) {
        inner = `
      <p class="sa-ex-lead">${_ex.proposals.length} fiche${_ex.proposals.length > 1 ? 's' : ''} proposée${_ex.proposals.length > 1 ? 's' : ''} — décochez ce qui ne vous convient pas.
      Tout est ajouté <strong>en brouillon</strong> : vous validez ensuite chaque fiche.</p>
      <div class="sa-ex-props">
        ${_ex.proposals.map((p, i) => {
            const t = KORTEX_TYPES.find(x => x.id === p.type);
            return `
          <label class="sa-prop ${_ex.checked.has(i) ? 'is-on' : ''}" data-act="ex-toggle" data-i="${i}">
            <span class="sa-prop-check">${_ex.checked.has(i) ? icon('check', 13) : ''}</span>
            <span class="sa-prop-type">${icon(t.icon, 13)} ${t.label}</span>
            <span class="sa-prop-txt">
              <strong>${_esc(p.title)}</strong>
              <span>${_esc(Object.values(p.body).map(v => Array.isArray(v) ? v.join(' · ') : v).join(' — ').slice(0, 140))}</span>
            </span>
          </label>`;
        }).join('')}
      </div>
      ${_ex.error ? `<p class="sa-ed-error">${_esc(_ex.error)}</p>` : ''}
      <div class="sa-ed-actions">
        <button class="sa-btn" data-act="ex-close">Annuler</button>
        <button class="sa-btn is-primary" data-act="ex-add" ${(!_ex.checked.size || _ex.adding) ? 'disabled' : ''}>
          ${icon('plus', 15)} Ajouter ${_ex.checked.size} fiche${_ex.checked.size > 1 ? 's' : ''} au coffre
        </button>
      </div>`;
    } else {
        inner = `
      <p class="sa-ex-lead">Collez n'importe quel texte qui contient du savoir — notes, email, page de documentation,
      transcription d'une explication orale. L'IA en propose des fiches typées que <strong>vous relisez avant d'ajouter</strong>.</p>
      <textarea class="sa-textarea sa-ex-text" data-slot="ex-text" rows="10" placeholder="Collez votre texte ici (30 caractères minimum)…"></textarea>
      ${_ex.error ? `<p class="sa-ed-error">${_esc(_ex.error)}</p>` : ''}
      <div class="sa-ed-actions">
        <button class="sa-btn" data-act="ex-close">Annuler</button>
        <button class="sa-btn is-primary" data-act="ex-run">${icon('sparkles', 15)} Analyser le texte <em class="sa-credit-note">1 crédit IA</em></button>
      </div>`;
    }

    slot.innerHTML = `
    <div class="sa-modal-backdrop" data-act="ex-close"></div>
    <div class="sa-modal" role="dialog" aria-label="Extraction de fiches">
      <button class="sa-modal-close" data-act="ex-close" aria-label="Fermer">${icon('x', 16)}</button>
      <h3 class="sa-modal-title">${icon('sparkles', 18)} Coller du texte</h3>
      ${inner}
    </div>`;
}

async function _runExtract() {
    const ta = _root.querySelector('[data-slot="ex-text"]');
    const text = (ta?.value || '').trim();
    if (text.length < 30) { _ex.error = 'Texte trop court (30 caractères minimum).'; _renderOverlay(); return; }

    _ex.busy = true; _ex.error = null;
    _renderOverlay();
    try {
        const res = await _api('/kortex/extract', { method: 'POST', body: { text } });
        _ex.proposals = res.proposals || [];
        _ex.checked   = new Set(_ex.proposals.map((_, i) => i));
        if (!_ex.proposals.length) _ex.error = res.note || 'Aucune fiche exploitable extraite.';
    } catch (e) {
        _ex.error = (e.data?.code === 'AI_CREDITS_EXHAUSTED')
            ? 'Crédits IA épuisés ce mois — rachetez un pack ou attendez le 1er du mois.'
            : e.message;
    }
    _ex.busy = false;
    _renderOverlay();
}

function _toggleProposal(i) {
    if (_ex.checked.has(i)) _ex.checked.delete(i); else _ex.checked.add(i);
    _renderOverlay();
}

async function _addProposals() {
    if (!_ex.checked.size || _ex.adding) return;
    _ex.adding = true;
    let added = 0, failed = 0;
    for (const i of _ex.checked) {
        const p = _ex.proposals[i];
        try {
            await _api('/kortex/units', {
                method: 'POST',
                body: { type: p.type, title: p.title, body: p.body, status: 'draft', source_kind: 'paste',
                    ...((_kx.scope === 'shared' && _kx.sharedVault) ? { vault_id: _kx.sharedVault.id } : { agent_id: _cur.id }) },
            });
            added++;
        } catch (_) { failed++; }
    }
    _ex.adding = false;
    _closeExtract();
    _toast(failed
        ? `${added} fiche(s) ajoutée(s), ${failed} échec(s).`
        : `${added} fiche${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} en brouillon — validez-les après relecture.`,
        failed ? 'error' : 'ok');
    _kxReload();
}

// ═══════════════════════════════════════════════════════════════
// Aside — état du moteur
// ═══════════════════════════════════════════════════════════════
function _renderAside() {
    const aside = _root.querySelector('[data-slot="aside"]');
    const c = _kx.counts;
    // Dans un agent → stats de SON coffre ; sinon → nombre d'agents.
    const statsCard = _cur.id ? `
    <div class="sa-aside-card">
      <div class="sa-aside-head">Cet agent</div>
      <div class="sa-aside-row"><span>Fiches de savoir</span><strong>${c.total}</strong></div>
      ${c.total ? `<div class="sa-aside-row"><span>· validées</span><strong>${c.validated}</strong></div>` : ''}
      ${c.draft ? `<div class="sa-aside-row"><span>· brouillons</span><strong>${c.draft}</strong></div>` : ''}
      ${c.quarantine ? `<div class="sa-aside-row"><span>· quarantaine</span><strong>${c.quarantine}</strong></div>` : ''}
      <div class="sa-aside-row"><span>Trous ouverts</span><strong>${_ag.gapsCount || 0}</strong></div>
    </div>` : `
    <div class="sa-aside-card">
      <div class="sa-aside-head">Vos agents</div>
      <div class="sa-aside-row"><span>Agents</span><strong>${_ag.agents.length}</strong></div>
    </div>`;
    aside.innerHTML = `
    <div class="sa-aside-card">
      <div class="sa-aside-head">État du moteur</div>
      <div class="sa-aside-row">
        <span class="sa-health-dot" data-slot="health-dot"></span>
        <span data-slot="health-text">Connexion au moteur…</span>
      </div>
    </div>
    ${statsCard}
    <div class="sa-aside-card">
      <div class="sa-aside-head">Le principe</div>
      <p class="sa-aside-note">
        Chaque agent est cloisonné : il ne répond QUE depuis son propre savoir, sources citées,
        « je ne sais pas » plutôt qu'inventer.
      </p>
    </div>
  `;
    _pingHealth();
}

// Ping santé : confirme que le worker répond (version du moteur affichée).
async function _pingHealth() {
    const dot  = () => _root?.querySelector('[data-slot="health-dot"]');
    const text = () => _root?.querySelector('[data-slot="health-text"]');
    try {
        const res  = await fetch(`${API_BASE}/api/smart-agent/health`);
        const data = await res.json();
        if (!_root) return;
        if (data?.ok) {
            dot()?.classList.add('is-ok');
            const t = text();
            if (t) t.textContent = `Moteur en ligne · ${data.version || ''}`.trim();
        } else { throw new Error('health not ok'); }
    } catch (_) {
        if (!_root) return;
        dot()?.classList.add('is-off');
        const t = text();
        if (t) t.textContent = 'Moteur hors ligne';
    }
}

// ═══════════════════════════════════════════════════════════════
// Utilitaires
// ═══════════════════════════════════════════════════════════════
function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _escAttr(s) { return _esc(s).replace(/\n/g, '&#10;'); }

let _toastTimer = null;
function _toast(msg, kind = 'ok') {
    if (!_root) return;
    _root.querySelector('.sa-toast')?.remove();
    const el = document.createElement('div');
    el.className = `sa-toast ${kind === 'error' ? 'is-error' : ''}`;
    el.textContent = msg;
    _root.appendChild(el);
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.remove(), 3500);
}
