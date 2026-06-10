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
    { icon: 'kortex',      label: 'Le coffre Kortex',   desc: 'Créez et validez vos fiches de savoir typées.',              status: 'live' },
    { icon: 'eye',         label: 'La recherche',       desc: 'Retrouvez la bonne fiche en posant une question naturelle.', status: 'next' },
    { icon: 'smart-agent', label: 'Le dialogue ancré',  desc: 'Votre agent répond depuis vos fiches, sources citées.',      status: 'soon' },
    { icon: 'sparkles',    label: 'La création guidée', desc: 'Identité, périmètre, garde-fous : votre jumeau pas à pas.',  status: 'soon' },
];

// ═══════════════════════════════════════════════════════════════
// État du module
// ═══════════════════════════════════════════════════════════════
let _root = null;
let _view = 'agents';          // 'agents' | 'kortex'

const _kx = {
    loaded: false, loading: false, error: null,
    units: [], counts: { draft: 0, validated: 0, quarantine: 0, expired: 0, total: 0 },
    collections: [],
    filterType: 'all', filterStatus: 'all',
    mode: 'list',              // 'list' | 'editor'
    editing: null,             // unit en édition (null = création)
    editType: 'qa',            // type sélectionné en création
};
const _ex = { open: false, busy: false, proposals: [], checked: new Set(), error: null, adding: false };

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
    _setView('agents');
    document.body.style.overflow = 'hidden';
    _pingHealth();
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
    if (act === 'nav')          { _setView(actEl.dataset.view); return; }
    // ── Coffre : liste ──
    if (act === 'kx-new')       { _openEditor(null); return; }
    if (act === 'kx-extract')   { _openExtract(); return; }
    if (act === 'kx-ftype')     { _kx.filterType = actEl.dataset.v;   _kxReload(); return; }
    if (act === 'kx-fstatus')   { _kx.filterStatus = actEl.dataset.v; _kxReload(); return; }
    if (act === 'kx-edit')      { _openEditor(_kx.units.find(u => u.id === actEl.dataset.id) || null); return; }
    if (act === 'kx-validate')  { _quickStatus(actEl.dataset.id, 'validated'); return; }
    if (act === 'kx-delete')    { _deleteUnit(actEl.dataset.id); return; }
    // ── Coffre : éditeur ──
    if (act === 'ed-back')      { _kx.mode = 'list'; _kx.editing = null; _renderMain(); return; }
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
// Rail gauche
// ═══════════════════════════════════════════════════════════════
function _renderRail() {
    const rail = _root.querySelector('[data-slot="rail"]');
    const item = (view, ico, label) => `
    <button class="ws-step ${_view === view ? 'is-active' : ''}" data-act="nav" data-view="${view}">
      <span class="ws-step-num" aria-hidden="true" style="visibility:hidden;"></span>
      <span class="ws-step-icon" style="width:18px;height:18px;">${icon(ico, 18)}</span>
      <span class="ws-step-label">${label}</span>
    </button>
  `;
    rail.innerHTML = `
    <div class="ws-rail-section">Moteur</div>
    ${item('agents', 'smart-agent', 'Mes agents')}
    ${item('kortex', 'kortex', 'Coffre Kortex')}
  `;
}

function _setView(view) {
    _view = view === 'kortex' ? 'kortex' : 'agents';
    if (_view === 'kortex' && !_kx.loaded && !_kx.loading) _kxLoad();
    _renderRail();
    _renderMain();
}

// ═══════════════════════════════════════════════════════════════
// Chargement du coffre
// ═══════════════════════════════════════════════════════════════
async function _kxLoad() {
    _kx.loading = true; _kx.error = null;
    _renderMain();
    try {
        const qs = [];
        if (_kx.filterType !== 'all')   qs.push(`type=${_kx.filterType}`);
        if (_kx.filterStatus !== 'all') qs.push(`status=${_kx.filterStatus}`);
        const [unitsRes, collRes] = await Promise.all([
            _api(`/kortex/units${qs.length ? '?' + qs.join('&') : ''}`),
            _api('/kortex/collections'),
        ]);
        _kx.units       = unitsRes.units || [];
        _kx.counts      = unitsRes.counts || _kx.counts;
        _kx.collections = collRes.collections || [];
        _kx.loaded      = true;
    } catch (e) {
        _kx.error = (e.status === 403)
            ? 'Smart Agent est réservé au plan MAX pendant la beta.'
            : (e.status === 401)
                ? 'Session expirée — reconnectez-vous au Dashboard.'
                : `Coffre injoignable : ${e.message}`;
    }
    _kx.loading = false;
    _renderMain();
    _renderAside();
}
function _kxReload() { _kx.loaded = false; _kxLoad(); }

// ═══════════════════════════════════════════════════════════════
// Vue principale
// ═══════════════════════════════════════════════════════════════
function _renderMain() {
    const main = _root.querySelector('[data-slot="main"]');
    if (_view === 'agents') { main.innerHTML = _agentsViewHTML(); }
    else if (_kx.mode === 'editor') { main.innerHTML = _editorHTML(); _bindEditorInputs(); }
    else { main.innerHTML = _kortexViewHTML(); }
    main.scrollTop = 0;
}

// ── Vue AGENTS — feuille de route du moteur ────────────────────
function _agentsViewHTML() {
    const chip = s => s.status === 'live'
        ? '<span class="sa-chip is-live">Disponible</span>'
        : s.status === 'next'
            ? '<span class="sa-chip is-next">En chantier</span>'
            : '<span class="sa-chip">À venir</span>';
    const stepHTML = (s, i) => `
    <div class="sa-step ${s.status === 'next' ? 'is-next' : ''} ${s.status === 'live' ? 'is-live' : ''}" ${s.status === 'live' ? 'data-act="nav" data-view="kortex" role="button"' : ''}>
      <span class="sa-step-ico">${icon(s.icon, 20)}</span>
      <div class="sa-step-txt">
        <strong>${i + 1}. ${s.label}</strong>
        <span>${s.desc}</span>
      </div>
      ${chip(s)}
    </div>
  `;
    return `
    <section class="sa-hero">
      <div class="sa-hero-ico">${icon('smart-agent', 40)}</div>
      <h1 class="sa-hero-title">Vos jumeaux numériques de savoir-faire</h1>
      <p class="sa-hero-lead">
        Un Smart Agent ne sait que ce que <strong>vous</strong> lui confiez.
        Il répond à partir de votre coffre de savoir Kortex — fiches validées par vos soins —
        en citant ses sources. Et quand il ne sait pas, il le dit.
      </p>
      <div class="sa-roadmap" aria-label="Construction du moteur, par étapes">
        ${ENGINE_STEPS.map(stepHTML).join('')}
      </div>
      <p class="sa-hero-note">Beta en construction — les étapes s'activent au fil des livraisons. Commencez par remplir votre coffre.</p>
    </section>
  `;
}

// ── Vue KORTEX — le coffre ─────────────────────────────────────
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
    // Coffre entièrement vide (aucune fiche, aucun filtre) → pédagogie + CTA
    if (!_kx.counts.total) {
        return `
      <section class="sa-hero">
        <div class="sa-hero-ico">${icon('kortex', 40)}</div>
        <h1 class="sa-hero-title">Le coffre Kortex</h1>
        <p class="sa-hero-lead">
          Votre savoir-faire, structuré en fiches typées — la matière première de vos agents.
          Chaque fiche est validée par vous avant d'être servie : c'est votre actif, pas celui de l'IA.
        </p>
        <div class="sa-cta-row">
          <button class="sa-btn is-primary" data-act="kx-new">${icon('plus', 16)} Créer ma première fiche</button>
          <button class="sa-btn" data-act="kx-extract">${icon('sparkles', 16)} Coller du texte</button>
        </div>
        <div class="sa-types-grid">
          ${KORTEX_TYPES.map(t => `
            <div class="sa-type-card">
              <span class="sa-type-ico">${icon(t.icon, 18)}</span>
              <strong class="sa-type-name">${t.label}</strong>
              <span class="sa-type-desc">${t.desc}</span>
            </div>`).join('')}
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
      <div class="sa-kx-head">
        <div>
          <h2 class="sa-kx-title">Coffre Kortex</h2>
          <p class="sa-kx-sub">${c.total} fiche${c.total > 1 ? 's' : ''} · ${c.validated} validée${c.validated > 1 ? 's' : ''}</p>
        </div>
        <div class="sa-kx-acts">
          <button class="sa-btn" data-act="kx-extract" title="Analyser un texte et en extraire des fiches (1 crédit IA)">
            ${icon('sparkles', 16)} Coller du texte
          </button>
          <button class="sa-btn is-primary" data-act="kx-new">${icon('plus', 16)} Nouvelle fiche</button>
        </div>
      </div>

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
      <div class="sa-empty-filter">Aucune fiche ne correspond à ce filtre.</div>`}
    </section>
  `;
}

function _unitRowHTML(u) {
    const t = KORTEX_TYPES.find(x => x.id === u.type) || KORTEX_TYPES[0];
    const st = STATUS_META[u.status] || STATUS_META.draft;
    const snippet = _esc(_snippet(u));
    const coll = _kx.collections.find(col => col.id === u.collection_id);
    return `
    <article class="sa-unit" data-act="kx-edit" data-id="${u.id}" role="button" tabindex="0">
      <span class="sa-unit-ico" title="${t.label}">${icon(t.icon, 18)}</span>
      <div class="sa-unit-txt">
        <strong class="sa-unit-title">${_esc(u.title)}</strong>
        ${snippet ? `<span class="sa-unit-snip">${snippet}</span>` : ''}
        <span class="sa-unit-meta">${t.label}${coll ? ` · ${_esc(coll.name)}` : ''}${u.source_ref ? ` · ${_esc(u.source_ref)}` : ''}</span>
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
    const u     = _kx.editing || {};
    const body  = u.body || {};

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

    const collOptions = ['<option value="">Sans collection</option>']
        .concat(_kx.collections.map(col =>
            `<option value="${col.id}" ${u.collection_id === col.id ? 'selected' : ''}>${_esc(col.name)}</option>`))
        .join('');

    const st = STATUS_META[u.status]?.label;
    return `
    <section class="sa-kx sa-ed">
      <button class="sa-back" data-act="ed-back">${icon('chevron-left', 16)} Coffre Kortex</button>
      <div class="sa-kx-head">
        <div>
          <h2 class="sa-kx-title">${isNew ? 'Nouvelle fiche' : 'Modifier la fiche'}</h2>
          ${st && !isNew ? `<p class="sa-kx-sub">Statut actuel : ${st}</p>` : ''}
        </div>
      </div>

      ${typeChips}

      <label class="sa-field">
        <span class="sa-field-label">Titre *</span>
        <input class="sa-input" data-field="__title" value="${_escAttr(u.title || '')}" placeholder="Court et descriptif — ce que la fiche contient">
      </label>

      ${fields}

      <div class="sa-ed-meta">
        <label class="sa-field">
          <span class="sa-field-label">Collection</span>
          <select class="sa-input sa-select" data-field="__collection">${collOptions}</select>
        </label>
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
        collection_id: get('[data-field="__collection"]')?.value || null,
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
            const payload = { title: form.title, body: form.body, collection_id: form.collection_id,
                source_ref: form.source_ref, review_at: form.review_at };
            if (status) payload.status = status;
            await _api(`/kortex/units/${_kx.editing.id}`, { method: 'PATCH', body: payload });
            _toast(status === 'validated' ? 'Fiche validée — elle peut désormais être servie.' : 'Fiche enregistrée.');
        } else {
            await _api('/kortex/units', { method: 'POST', body: { ...form, status: status || 'draft' } });
            _toast(status === 'validated' ? 'Fiche créée et validée.' : 'Fiche enregistrée en brouillon.');
        }
        _kx.mode = 'list'; _kx.editing = null;
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
                body: { type: p.type, title: p.title, body: p.body, status: 'draft', source_kind: 'paste' },
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
    aside.innerHTML = `
    <div class="sa-aside-card">
      <div class="sa-aside-head">État du moteur</div>
      <div class="sa-aside-row">
        <span class="sa-health-dot" data-slot="health-dot"></span>
        <span data-slot="health-text">Connexion au moteur…</span>
      </div>
      <div class="sa-aside-row"><span>Agents</span><strong>0</strong></div>
      <div class="sa-aside-row"><span>Fiches Kortex</span><strong>${c.total}</strong></div>
      ${c.total ? `<div class="sa-aside-row"><span>· validées</span><strong>${c.validated}</strong></div>` : ''}
      ${c.draft ? `<div class="sa-aside-row"><span>· brouillons</span><strong>${c.draft}</strong></div>` : ''}
      ${c.quarantine ? `<div class="sa-aside-row"><span>· quarantaine</span><strong>${c.quarantine}</strong></div>` : ''}
    </div>
    <div class="sa-aside-card">
      <div class="sa-aside-head">Le principe</div>
      <p class="sa-aside-note">
        La connaissance est le produit — l'agent n'est que l'opérateur autorisé à l'exploiter.
        Réponses ancrées sur vos fiches, sources citées, « je ne sais pas » plutôt qu'inventer.
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
