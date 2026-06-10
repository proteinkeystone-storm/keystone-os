/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact SMART AGENT (O-AGT-001) v0.1
   Sprint SA-0 : socle workspace fullscreen

   Mission : fabriquer des « jumeaux numériques de savoir-faire » —
   des agents qui répondent UNIQUEMENT depuis le coffre de savoir
   Kortex du client (fiches typées validées), avec citations et
   repli honnête (« Je ne dispose pas de cette information »).

   DOCTRINE (contenant/contenu) : ce module est le MOTEUR, 100%
   générique — capture, indexation, restitution ancrée. AUCUNE
   logique métier ici : un vendeur, un gardien de musée ou un
   formateur sortent du même code ; seul le contenu du Kortex
   (par tenant, côté worker) diffère.

   Architecture des vues (rail gauche) :
   ─────────────────────────────────────────────────────────────
     AGENTS — les jumeaux du client (liste + builder au SA-4)
     KORTEX — le coffre de savoir (CRUD fiches typées au SA-1)

   Roadmap moteur (l'aside affiche la version du worker) :
     SA-1 Kortex CRUD · SA-2 recherche hybride · SA-3 dialogue
     ancré · SA-4 builder + boucle des trous · SA-5 QR public ·
     SA-6 péremption/RGPD/interview.

   Réutilise la mécanique workspace de codex.js (shell ws-*,
   workspace.css) ; styles propres dans smart-agent.css (sa-*).
   ═══════════════════════════════════════════════════════════════ */

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';

const WORKSPACE_META = { id: 'O-AGT-001', name: 'Smart Agent' };
const API_BASE       = 'https://keystone-os-api.keystone-os.workers.dev';

// ── Les 7 types de fiches Kortex (contrat partagé avec le worker —
//    cf. workers/src/db/migration_smart_agent.sql, CHECK kortex_units.type).
//    Présentés dès SA-0 (pédagogie du coffre), CRUD au SA-1.
const KORTEX_TYPES = [
    { id: 'fact',       icon: 'check',    label: 'Fait',          desc: 'Une information vérifiée : horaire, chiffre, caractéristique.' },
    { id: 'procedure',  icon: 'check-square', label: 'Procédure',     desc: 'Des étapes ordonnées pour accomplir une tâche.' },
    { id: 'qa',         icon: 'help-circle',  label: 'Question / Réponse', desc: 'Une question fréquente et sa réponse validée.' },
    { id: 'case',       icon: 'history',  label: 'Cas vécu',      desc: 'Situation → action → résultat : l\'expérience du terrain.' },
    { id: 'rule',       icon: 'lock',     label: 'Règle',         desc: 'Ce qui doit (ou ne doit jamais) être fait, et pourquoi.' },
    { id: 'objection',  icon: 'megaphone',label: 'Objection',     desc: 'Une objection entendue, la réponse qui fonctionne, la preuve.' },
    { id: 'definition', icon: 'edit',     label: 'Définition',    desc: 'Un terme du métier expliqué dans vos mots.' },
];

// ── Feuille de route affichée dans la vue Agents (états honnêtes :
//    rien n'est cliquable tant que le sprint correspondant n'est pas livré).
const ENGINE_STEPS = [
    { icon: 'kortex',      label: 'Le coffre Kortex',          desc: 'Créez et validez vos fiches de savoir typées.',                     status: 'next' },
    { icon: 'eye',         label: 'La recherche',              desc: 'Retrouvez la bonne fiche en posant une question naturelle.',        status: 'soon' },
    { icon: 'smart-agent', label: 'Le dialogue ancré',         desc: 'Votre agent répond depuis vos fiches, sources citées.',             status: 'soon' },
    { icon: 'sparkles',    label: 'La création guidée',        desc: 'Identité, périmètre, garde-fous : votre jumeau pas à pas.',         status: 'soon' },
];

let _root = null;
let _view = 'agents';   // 'agents' | 'kortex'

// ═══════════════════════════════════════════════════════════════
// Ouverture / fermeture (même mécanique que openKodex)
// ═══════════════════════════════════════════════════════════════
export function openSmartAgent(opts = {}) {
    if (_root) return;   // déjà ouvert
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
  `;

    document.body.appendChild(_root);
    _root.addEventListener('click', _onClick);
    bindRatingButton(_root, WORKSPACE_META.id);
    bindHelpButton(_root, WORKSPACE_META.id);
    bindBurger(_root);

    _renderRail();
    _renderAside();
}

function _onClick(e) {
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    if (act === 'close') { closeSmartAgent(); return; }
    if (act === 'nav')   { _setView(actEl.dataset.view); return; }
}

// ═══════════════════════════════════════════════════════════════
// Rail gauche — navigation entre les deux zones du moteur
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
    _renderRail();
    _renderMain();
}

// ═══════════════════════════════════════════════════════════════
// Vue principale
// ═══════════════════════════════════════════════════════════════
function _renderMain() {
    const main = _root.querySelector('[data-slot="main"]');
    main.innerHTML = _view === 'kortex' ? _kortexViewHTML() : _agentsViewHTML();
    main.scrollTop = 0;
}

// ── Vue AGENTS — état vide + feuille de route du moteur ────────
function _agentsViewHTML() {
    const stepHTML = (s, i) => `
    <div class="sa-step ${s.status === 'next' ? 'is-next' : ''}">
      <span class="sa-step-ico">${icon(s.icon, 20)}</span>
      <div class="sa-step-txt">
        <strong>${i + 1}. ${s.label}</strong>
        <span>${s.desc}</span>
      </div>
      <span class="sa-chip ${s.status === 'next' ? 'is-next' : ''}">${s.status === 'next' ? 'En chantier' : 'À venir'}</span>
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
      <p class="sa-hero-note">Beta en construction — les étapes s'activent au fil des livraisons.</p>
    </section>
  `;
}

// ── Vue KORTEX — état vide + pédagogie des 7 types de fiches ───
function _kortexViewHTML() {
    const card = t => `
    <div class="sa-type-card">
      <span class="sa-type-ico">${icon(t.icon, 18)}</span>
      <strong class="sa-type-name">${t.label}</strong>
      <span class="sa-type-desc">${t.desc}</span>
    </div>
  `;
    return `
    <section class="sa-hero">
      <div class="sa-hero-ico">${icon('kortex', 40)}</div>
      <h1 class="sa-hero-title">Le coffre Kortex</h1>
      <p class="sa-hero-lead">
        Votre savoir-faire, structuré en fiches typées — la matière première de vos agents.
        Chaque fiche est validée par vous avant d'être servie : c'est votre actif, pas celui de l'IA.
      </p>
      <div class="sa-types-grid">
        ${KORTEX_TYPES.map(card).join('')}
      </div>
      <p class="sa-hero-note">La création de fiches ouvre à la prochaine étape du moteur.</p>
    </section>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Aside — état du moteur (preuve de câblage front → worker)
// ═══════════════════════════════════════════════════════════════
function _renderAside() {
    const aside = _root.querySelector('[data-slot="aside"]');
    aside.innerHTML = `
    <div class="sa-aside-card">
      <div class="sa-aside-head">État du moteur</div>
      <div class="sa-aside-row">
        <span class="sa-health-dot" data-slot="health-dot"></span>
        <span data-slot="health-text">Connexion au moteur…</span>
      </div>
      <div class="sa-aside-row"><span>Agents</span><strong>0</strong></div>
      <div class="sa-aside-row"><span>Fiches Kortex</span><strong>0</strong></div>
    </div>
    <div class="sa-aside-card">
      <div class="sa-aside-head">Le principe</div>
      <p class="sa-aside-note">
        La connaissance est le produit — l'agent n'est que l'opérateur autorisé à l'exploiter.
        Réponses ancrées sur vos fiches, sources citées, « je ne sais pas » plutôt qu'inventer.
      </p>
    </div>
  `;
}

// Ping santé : confirme que le worker répond (version du moteur affichée).
// Échec silencieux → statut « hors ligne » (pas d'erreur bloquante en SA-0).
async function _pingHealth() {
    const dot  = () => _root?.querySelector('[data-slot="health-dot"]');
    const text = () => _root?.querySelector('[data-slot="health-text"]');
    try {
        const res  = await fetch(`${API_BASE}/api/smart-agent/health`);
        const data = await res.json();
        if (!_root) return;
        if (data?.ok) {
            dot()?.classList.add('is-ok');
            text().textContent = `Moteur en ligne · ${data.version || ''}`.trim();
        } else {
            throw new Error('health not ok');
        }
    } catch (_) {
        if (!_root) return;
        dot()?.classList.add('is-off');
        const t = text();
        if (t) t.textContent = 'Moteur hors ligne';
    }
}
