/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — AI War Room · Workspace fullscreen
   Sprint 1 (mai 2026) · Brainstorming V2 (A-COM-003)

   Squelette minimal :
   - Layout 3 colonnes (rail / feed / signals)
   - Rangée 9 agents avec boot animation 4s (allumage progressif)
   - Living Layer phrase à l'arrivée
   - Input bas + 3 pills statiques
   - Strategic Lead UNIQUEMENT (Sprint 1) — 8 autres agents s'allument
     mais ne répondent pas encore (Sprint 2)
   - Streaming SSE de la réponse via /api/brainstorming/agent-respond

   Pas de bibliothèque locale (Sprint 5), pas de Synthesizer
   (Sprint 5), pas de signaux dynamiques (Sprint 4).
   ═══════════════════════════════════════════════════════════════ */

import { icon } from './lib/ui-icons.js';
import { helpButtonHTML, bindHelpButton } from './lib/help-overlay.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { burgerHTML, bindBurger } from './lib/topbar-burger.js';
import {
  AGENTS,
  getAgent,
  getAgentNamesForPrompt,
  COGNITIVE_MODES,
  getCognitiveMode,
} from './lib/brainstorming-agents.js';

const APP_ID = 'A-COM-003';

// ── Constantes Sprint 2 ──────────────────────────────────────────
const DEFAULT_MODE         = 'exploration';      // hardcodé Sprint 1, sélecteur Sprint 7
const BOOT_DELAY_PER_AGENT = 280;                // ms entre chaque allumage
const SESSION_KEY          = 'ks_brainstorming_session_draft';
// Sprint 7.1 — Tour de table complet : 8 agents non-Synthesizer parlent
// dans un cycle avant auto-pause. Le worker dédupplique pour qu'aucun
// agent ne parle deux fois dans le même cycle, et le frontend déclenche
// auto la synthèse à 8/8.
const ORCHESTRATION_MAX_TURNS = 8;

// ── Typewriter (rythme dictée vocale) ────────────────────────────
// Le LLM streame très vite (~50-100 chars/sec). Pour donner la sensation
// d'un dialogue lu à voix haute, on bufferise et on affiche à un rythme
// contrôlé. Cible : ~15-20 chars/sec (≈ dictée vocale 130-150 wpm).
const TYPEWRITER_TICK_MS    = 50;    // 1 char tous les 50ms → 20 chars/sec
const TYPEWRITER_PAUSE_END  = 280;   // pause supplémentaire après . ! ?
const TYPEWRITER_PAUSE_SOFT = 120;   // pause supplémentaire après , ; :
// En sequential mode (Sprint 2 fix), chaque agent attend que le précédent
// soit drainé avant de démarrer. Du coup le buffer peut accumuler la
// totalité de la réplique d'un agent (souvent 200-350 chars) avant que
// le typewriter ne commence à drainer. Pour rester proche d'une dictée
// vocale, on garde 1 char/tick même sur ces buffers — le catch-up ne
// s'active qu'en cas de buffer vraiment énorme (un agent qui dépasse
// largement les 2-3 phrases attendues).
const TYPEWRITER_CATCHUP_THRESHOLD = 500;
const TYPEWRITER_CATCHUP_CHARS     = 2;     // 2 chars/tick = 40 chars/sec

// Sprint 7.1 — seuil de tour complet (les 8 agents non-Synthesizer ont parlé)
// → déclenche auto la synthèse pour livrer une analyse riche sans clic.
const ROUNDTABLE_FULL_TURNS = 8;
// État de session courante (transient — Sprint 5 ajoutera la persistance)
let _currentSession = null;

// Typewriter state (réinitialisé à chaque ouverture du workspace)
const _typewriter = {
  buffers: new Map(),   // agent_id → { pending, textEl, ended, delayUntil, panel }
  intervalId: null,
};

function _typewriterReset() {
  if (_typewriter.intervalId) {
    clearInterval(_typewriter.intervalId);
    _typewriter.intervalId = null;
  }
  _typewriter.buffers.clear();
}

function _typewriterTick() {
  const now = Date.now();
  for (const [aid, state] of _typewriter.buffers.entries()) {
    if (state.delayUntil && now < state.delayUntil) continue;
    state.delayUntil = 0;

    if (state.pending.length === 0) {
      // Buffer vide → si le serveur a annoncé agent_end, on finalise
      if (state.ended) {
        state.textEl.classList.remove('streaming');
        _setAgentSpeaking(state.panel, aid, false);
        _typewriter.buffers.delete(aid);
      }
      continue;
    }

    // Catch-up : si on a beaucoup de retard, pop plusieurs chars d'un coup
    const popN = state.pending.length >= TYPEWRITER_CATCHUP_THRESHOLD
      ? TYPEWRITER_CATCHUP_CHARS
      : 1;
    const chunk = state.pending.slice(0, popN);
    state.pending = state.pending.slice(popN);
    state.textEl.textContent += chunk;

    // Pause après ponctuation (sur le DERNIER char poppé)
    const lastChar = chunk[chunk.length - 1];
    if (/[.!?]/.test(lastChar)) {
      state.delayUntil = now + TYPEWRITER_PAUSE_END;
    } else if (/[,;:]/.test(lastChar)) {
      state.delayUntil = now + TYPEWRITER_PAUSE_SOFT;
    }
  }

  // Auto-scroll uniquement si l'utilisateur est déjà en bas du feed
  // (sinon on respecte sa position de lecture)
  for (const [, state] of _typewriter.buffers) {
    const feed = state.panel.querySelector('#wr-feed');
    if (feed && (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 80)) {
      feed.scrollTop = feed.scrollHeight;
    }
    break;
  }

  // Aucune bulle en cours → arrête le timer
  if (_typewriter.buffers.size === 0) {
    clearInterval(_typewriter.intervalId);
    _typewriter.intervalId = null;
  }
}

function _typewriterPush(panel, agentId, textEl, chunk) {
  let state = _typewriter.buffers.get(agentId);
  if (!state) {
    state = { pending: '', textEl, ended: false, delayUntil: 0, panel };
    _typewriter.buffers.set(agentId, state);
  }
  state.pending += chunk;
  if (!_typewriter.intervalId) {
    _typewriter.intervalId = setInterval(_typewriterTick, TYPEWRITER_TICK_MS);
  }
}

function _typewriterMarkEnded(agentId, fullText) {
  const state = _typewriter.buffers.get(agentId);
  if (!state) return;
  // Si le full_text serveur est plus long que ce qu'on a déjà bufferisé
  // + affiché, on append le delta (sécurité contre chunks perdus)
  if (typeof fullText === 'string') {
    const displayed = state.textEl.textContent || '';
    const totalKnown = displayed + state.pending;
    if (fullText.length > totalKnown.length) {
      state.pending += fullText.slice(totalKnown.length);
    }
  }
  state.ended = true;
}

function _typewriterIsFlushed() {
  for (const state of _typewriter.buffers.values()) {
    if (state.pending.length > 0 || !state.ended) return false;
  }
  return true;
}

function _waitForTypewriterFlush(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (_typewriterIsFlushed()) return resolve();
      if (Date.now() - start > timeoutMs) return resolve();
      setTimeout(check, 100);
    };
    check();
  });
}

// ── API Worker — URL résolue dynamiquement (cf. ui-renderer) ──────
function _apiBase() {
  const m = window.__KS_API_BASE__;
  if (m && typeof m === 'string') return m.replace(/\/$/, '');
  // Fallback prod ; en dev local, ui-renderer/main.js définit __KS_API_BASE__.
  return 'https://keystone-os-api.keystone-os.workers.dev';
}

// ── Auth helper — JWT licence stocké côté Keystone ───────────────
function _authHeaders() {
  const jwt = localStorage.getItem('ks_jwt');
  const headers = { 'Content-Type': 'application/json' };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  return headers;
}

// Sprint 7.9 — BYOK Claude pour Synthesizer
// Le user configure sa clé dans Réglages → Vault. On la lit pour
// activer Claude Sonnet sur la synthèse finale (plus profonde que Gemma).
function _getClaudeBYOKKey() {
  try {
    const k = localStorage.getItem('ks_api_anthropic') || '';
    return k.length > 10 ? k : '';
  } catch { return ''; }
}

// ════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════
export function openBrainstorming() {
  let panel = document.getElementById('wr-fullscreen');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'wr-fullscreen';
    // ws-app : applique les CSS vars Keystone (palette navy/gold).
    // wr-fullscreen : layout grid spécifique Brainstorming.
    panel.className = 'ws-app wr-fullscreen';
    document.body.appendChild(panel);
  }
  panel.innerHTML = _renderShell();
  panel.classList.add('open');
  document.body.style.overflow = 'hidden';

  // État de session minimal
  _currentSession = {
    id: `wr-${Date.now()}`,
    brief: '',
    mode: DEFAULT_MODE,
    history: [],     // [{agent_id, content, timestamp}]
    started: false,
    startedAt: Date.now(),
    synthesis: null,
    synthesizedAt: null,
  };

  _wireShell(panel);
  bindHelpButton(panel, APP_ID);
  bindRatingButton(panel, APP_ID);
  bindBurger(panel);
  // Sprint 7 — Appliquer le mode par défaut (fixe --wr-mode-accent + invite)
  _applyMode(panel, DEFAULT_MODE);
  _bootAgents(panel);
}

export function closeBrainstorming() {
  const panel = document.getElementById('wr-fullscreen');
  if (panel) {
    panel.classList.remove('open');
    setTimeout(() => panel.remove(), 250);
  }
  document.body.style.overflow = '';
  _currentSession = null;
  _typewriterReset();
}

// Alias pour compat ui-renderer.js (ancien import openMuse)
export const openMuse = openBrainstorming;

// ════════════════════════════════════════════════════════════════
// SHELL — HTML structure
// ════════════════════════════════════════════════════════════════
function _renderShell() {
  const mode = getCognitiveMode(DEFAULT_MODE);
  return `
    <!-- Header standard Keystone (cohérence cross-tools) -->
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" id="wr-close-btn" title="Retour (Échap)" aria-label="Retour au Dashboard">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('muse', 24)}</span>
        <span class="name">Brainstorming</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(APP_ID)}
        ${ratingButtonHTML(APP_ID)}
      </div>
    </header>

    <!-- Left rail (3 icônes — historique / personnalités agents / modes) -->
    <aside class="wr-rail">
      <button class="wr-rail-btn" title="Historique des sessions" aria-label="Sessions">
        ${_iconSvg('history')}
      </button>
      <button class="wr-rail-btn" title="Personnalités des agents" aria-label="Agents">
        ${_iconSvg('users')}
      </button>
      <button class="wr-rail-btn" title="Modes cognitifs" aria-label="Modes">
        ${_iconSvg('sparkles')}
      </button>
      <div class="wr-rail-spacer"></div>
    </aside>

    <!-- Sub-header : mode courant + consensus arc + (mobile) bouton signals -->
    <div class="wr-subheader">
      <div class="wr-subheader-mode" id="wr-subtitle"><span class="wr-subheader-dot"></span><span class="wr-subheader-label">Mode ${mode.label} · Posez votre brief pour ouvrir la discussion</span></div>
      <div class="wr-consensus" id="wr-consensus" style="visibility:hidden">
        <div class="wr-consensus-arc">
          <svg viewBox="0 0 32 32" width="32" height="32">
            <circle class="bg" cx="16" cy="16" r="13.5"/>
            <circle class="fg" cx="16" cy="16" r="13.5"
              stroke-dasharray="84.82" stroke-dashoffset="84.82" stroke-linecap="round"/>
          </svg>
          <div class="wr-consensus-val" id="wr-consensus-val">0%</div>
        </div>
        <span class="wr-consensus-label">Avancement</span>
      </div>
      <!-- Sprint 6 — bouton signaux (visible uniquement < 1024px) -->
      <button type="button" class="wr-signals-toggle" id="wr-signals-toggle" aria-label="Afficher les signaux">
        ${_iconSvg('sliders')}
      </button>
    </div>

    <!-- Agents row -->
    <div class="wr-agents-row">
      ${AGENTS.map(_renderAgentCell).join('')}
    </div>

    <!-- Feed -->
    <main class="wr-feed" id="wr-feed">
      <div class="wr-feed-empty" id="wr-feed-empty">
        <div class="wr-feed-empty-title">Brainstorming créatif</div>
        <div class="wr-feed-empty-text">
          Posez votre sujet de réflexion (lancement, repositionnement, idéation…).
          Strategic Lead ouvrira la discussion, les 8 autres personnalités enrichiront le dialogue.
        </div>
      </div>
    </main>

    <!-- Input -->
    <div class="wr-input-row">
      <div class="wr-input-box">
        <input class="wr-input" id="wr-input" type="text"
          placeholder="Posez votre sujet de réflexion…"
          autocomplete="off"/>
        <button class="wr-input-send" id="wr-send" title="Envoyer (Cmd+Enter)" aria-label="Envoyer">
          ${_iconSvg('arrow-up')}
        </button>
      </div>
      <div class="wr-pills">
        <button class="wr-pill" data-pill="Plus premium">Plus premium</button>
        <button class="wr-pill" data-pill="Plus disruptif">Plus disruptif</button>
        <button class="wr-pill" data-pill="Focus rétention">Focus rétention</button>
      </div>
    </div>

    <!-- Right signals panel -->
    <aside class="wr-signals">
      <div class="wr-signal-card">
        <div class="wr-signal-title">Points clés émergents</div>
        <div class="wr-signal-empty">
          Les insights apparaîtront ici dès que la discussion sera en cours.
        </div>
      </div>
      <div class="wr-signal-card">
        <div class="wr-signal-title">Prochaine synthèse</div>
        <div class="wr-signal-empty">
          La synthèse stratégique se déclenchera automatiquement à la fin du tour de table (8 agents).
        </div>
      </div>
    </aside>
  `;
}

function _renderAgentCell(agent) {
  return `
    <div class="wr-agent-cell" data-agent-id="${agent.id}"
         style="--agent-color: ${agent.color}; --agent-glow: ${agent.color}40;"
         title="${agent.fullTitle} — ${agent.role}">
      <div class="wr-agent-icon">${_iconSvg(agent.icon)}</div>
      <div class="wr-agent-label">${agent.name}</div>
    </div>
  `;
}

// ── Helper : wrap un nom de clé icon en <svg> complet ────────────
function _iconSvg(name) {
  // Quelques icônes utilitaires de la rail qui ne sont pas dans
  // ui-icons.js (ex: 'users', 'arrow-up') — fallback inline.
  const inlineFallback = {
    users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
    'trash-2': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  };
  const fallback = inlineFallback[name];
  if (fallback) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${fallback}</svg>`;
  }
  // icon() renvoie déjà un <svg>…</svg> complet
  try { return icon(name, 22); }
  catch (e) { return ''; }
}

// ════════════════════════════════════════════════════════════════
// WIRING — event listeners
// ════════════════════════════════════════════════════════════════
function _wireShell(panel) {
  // Close button (rail bottom)
  panel.querySelector('#wr-close-btn')?.addEventListener('click', closeBrainstorming);

  // Rail buttons : Sessions (0), Agents (1), Modes (2)
  // Sprint 5 — Sessions ; Sprint 7 — Modes ; Sprint 7.5 — Agents
  const railBtns = panel.querySelectorAll('.wr-rail-btn');
  if (railBtns[0]) {
    railBtns[0].addEventListener('click', () => _openLibraryModal(panel));
  }
  if (railBtns[1]) {
    railBtns[1].addEventListener('click', () => _openAgentsModal(panel));
  }
  if (railBtns[2]) {
    railBtns[2].addEventListener('click', () => _openModesModal(panel));
  }

  // Sprint 6 — Toggle bottom sheet signals (tablette/mobile)
  const signalsToggle = panel.querySelector('#wr-signals-toggle');
  if (signalsToggle) {
    signalsToggle.addEventListener('click', () => {
      panel.classList.toggle('signals-open');
    });
  }
  // Click sur le backdrop des signals ferme la sheet
  panel.querySelector('.wr-signals')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('wr-signals')) {
      panel.classList.remove('signals-open');
    }
  });

  // Esc key
  const onKey = (e) => {
    if (e.key === 'Escape') closeBrainstorming();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { _submit(panel); }
  };
  document.addEventListener('keydown', onKey);
  panel.addEventListener('wr:cleanup', () => document.removeEventListener('keydown', onKey));

  // Send button
  panel.querySelector('#wr-send')?.addEventListener('click', () => _submit(panel));

  // Sprint 3 — Pills d'intention cliquables actives.
  // Si la session est déjà démarrée et qu'il n'y a pas de génération en
  // cours, un clic envoie DIRECTEMENT la pill comme intervention user
  // (sans re-remplir l'input). Sinon, on pré-remplit l'input.
  panel.querySelectorAll('.wr-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = panel.querySelector('#wr-input');
      const send  = panel.querySelector('#wr-send');
      if (!input || !send) return;
      const v = btn.dataset.pill || '';
      // Si pas de session active OU input déjà rempli OU génération en cours
      // → on injecte juste le texte dans l'input (user complète)
      if (!_currentSession?.started || input.value.trim() || send.disabled) {
        input.value = input.value ? `${input.value.trim()} — ${v}` : v;
        input.focus();
        return;
      }
      // Sinon : clic = intervention auto-submise
      input.value = v;
      _submit(panel);
    });
  });
}

// ════════════════════════════════════════════════════════════════
// BOOT ANIMATION — les 9 agents s'allument progressivement
// ════════════════════════════════════════════════════════════════
function _bootAgents(panel) {
  const cells = panel.querySelectorAll('.wr-agent-cell');
  cells.forEach((cell, i) => {
    setTimeout(() => {
      cell.classList.add('lit');
      // Strategic Lead = actif dès Sprint 1, les autres restent "présents"
      // Strategic Lead reste "active" en permanence (coordinateur du débat)
      // — les autres agents deviennent "speaking" temporairement quand ils
      // prennent la parole, puis retournent à l'état "lit" entre 2 tours.
      if (cell.dataset.agentId === 'strategic') {
        cell.classList.add('active');
      }
    }, 200 + i * BOOT_DELAY_PER_AGENT);
  });
}

// ════════════════════════════════════════════════════════════════
// SUBMIT — l'utilisateur valide son brief
// ════════════════════════════════════════════════════════════════
async function _submit(panel) {
  if (!_currentSession) return;

  const input = panel.querySelector('#wr-input');
  const send  = panel.querySelector('#wr-send');
  if (!input || !send) return;

  const text = (input.value || '').trim();
  if (!text) return;

  // Si c'est le tout premier message → c'est le BRIEF de la session
  if (!_currentSession.started) {
    _currentSession.brief = text;
    _currentSession.started = true;
    _updateHeader(panel, text);
    _hideEmpty(panel);
  } else {
    // Sprint 3 ajoutera la gestion des interventions user mid-débat.
    // Sprint 1 : on accepte un message user dans l'historique mais
    // seul Strategic Lead répond (pas de re-routing intelligent).
    _appendUserMessage(panel, text);
  }

  // Reset input + disable
  input.value = '';
  send.disabled = true;

  // Sprint 3 — Animation "agents écoutent" : si c'est une intervention
  // (pas le brief initial), tous les pictos pulsent en attendant que
  // Strategic Lead reformule. Donne le ressenti d'une table qui écoute.
  const isIntervention = _currentSession.history.length > 0
    && _currentSession.history[_currentSession.history.length - 1].agent_id === 'user';
  if (isIntervention) {
    _setAllAgentsListening(panel, true);
  }

  try {
    await _callOrchestration(panel);
  } catch (e) {
    _appendErrorMessage(panel, e?.message || 'Erreur réseau');
  } finally {
    _setAllAgentsListening(panel, false);
    send.disabled = false;
    input.focus();
  }
}

// Marque tous les pictos agents en mode "listening" (ring fin pulsant
// à l'unisson). Pas la même classe que .speaking — c'est un état collectif
// d'écoute pendant que l'utilisateur intervient.
function _setAllAgentsListening(panel, listening) {
  panel.querySelectorAll('.wr-agent-cell').forEach(cell => {
    cell.classList.toggle('listening', listening);
  });
}

function _updateHeader(panel, brief) {
  const label = panel.querySelector('#wr-subtitle .wr-subheader-label');
  if (!label) return;
  const modeId   = _currentSession?.mode || DEFAULT_MODE;
  const mode     = getCognitiveMode(modeId);
  const trimmed  = brief.length > 120 ? brief.slice(0, 117) + '…' : brief;
  label.textContent = `Mode ${mode.label} · ${trimmed}`;
}

// Sprint 7 — Appliquer un mode cognitif : persistance session + couleur
// d'accent + label subheader + état actif modale. Centralise toutes les
// conséquences d'un changement de mode.
function _applyMode(panel, modeId) {
  const mode = getCognitiveMode(modeId);
  if (!_currentSession) return;
  _currentSession.mode = mode.id;
  // Variable CSS d'accent (subheader, rail btn actif, modale active)
  panel.style.setProperty('--wr-mode-accent', `var(${mode.colorVar})`);
  // Subheader : si brief déjà saisi → "Mode X · brief", sinon invite contextuelle
  // Le texte va sur .wr-subheader-label (la pastille .wr-subheader-dot reste).
  const label = panel.querySelector('#wr-subtitle .wr-subheader-label');
  if (label) {
    if (_currentSession.brief) {
      const trimmed = _currentSession.brief.length > 120
        ? _currentSession.brief.slice(0, 117) + '…'
        : _currentSession.brief;
      label.textContent = `Mode ${mode.label} · ${trimmed}`;
    } else {
      label.textContent = `Mode ${mode.label} · ${mode.invite || 'Posez votre brief pour ouvrir la discussion'}`;
    }
  }
  // Input placeholder calé sur l'invite du mode (si pas de brief encore)
  if (!_currentSession.started) {
    const input = panel.querySelector('#wr-input');
    if (input) input.placeholder = mode.invite || 'Posez votre sujet de réflexion…';
  }
  // Rafraîchir la modale si elle est ouverte
  const modal = panel.querySelector('#wr-modes-modal');
  if (modal) {
    modal.querySelectorAll('.wr-mode-card').forEach(card => {
      card.classList.toggle('active', card.dataset.modeId === mode.id);
    });
  }
}

// (Living Layer phrase d'ouverture — texte créatif, pas militaire)

function _hideEmpty(panel) {
  const empty = panel.querySelector('#wr-feed-empty');
  if (empty) empty.remove();
  // Living Layer line — placeholder texte simple Sprint 1
  // (Sprint 5+ : appel à /api/livinglayer/greeting pour personnalisation)
  const feed = panel.querySelector('#wr-feed');
  if (feed && !feed.querySelector('.wr-living')) {
    const living = document.createElement('div');
    living.className = 'wr-living';
    living.textContent = 'Strategic Lead ouvre la discussion…';
    feed.appendChild(living);
  }
}

// ════════════════════════════════════════════════════════════════
// ORCHESTRATION — fetch SSE multi-agent depuis le Worker
// ════════════════════════════════════════════════════════════════
// Format SSE attendu (cf. workers/src/routes/brainstorming.js) :
//   data: {"type":"agent_start","agent_id":"strategic"}
//   data: {"type":"chunk","agent_id":"strategic","text":"…"}
//   data: {"type":"agent_end","agent_id":"strategic","full_text":"…"}
//   data: {"type":"agent_start","agent_id":"creative"}
//   …
//   data: {"type":"complete","reason":"auto_pause","turns":3}
// ════════════════════════════════════════════════════════════════
async function _callOrchestration(panel) {
  const url = `${_apiBase()}/api/brainstorming/agent-respond`;
  const payload = {
    agent_id      : 'auto',                     // → orchestrateur Sprint 2
    brief         : _currentSession.brief,
    cognitive_mode: _currentSession.mode,
    history       : _currentSession.history,
    max_turns     : ORCHESTRATION_MAX_TURNS,
  };
  // BYOK Claude Haiku (2026-05-28) — si une clé Anthropic est posée dans le
  // Vault, le Devil's Advocate (agent premium) parlera via Claude Haiku au
  // lieu de Llama (caractère affûté). Le serveur ignore la clé pour les 8
  // autres agents. Sans clé → tout reste sur Llama.
  const _claudeKey = _getClaudeBYOKKey();
  if (_claudeKey) payload.apiKey = _claudeKey;

  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: _authHeaders(),
      body:    JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error('Connexion impossible au Worker');
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || ''; } catch (e) {}
    throw new Error(`HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
  }

  // Bulles courantes indexées par agent_id (Sprint 2 : 1 bulle par tour
  // d'agent ; si le même agent reprend la parole 2 fois consécutives —
  // rare — on crée 2 bulles distinctes via un compteur)
  const activeBubbles = new Map();  // agent_id → { textEl, fullText }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let   buffer  = '';
  let   complete = false;

  while (!complete) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let evt;
      try { evt = JSON.parse(data); }
      catch (e) { continue; }

      switch (evt.type) {

        case 'agent_start': {
          const aid = evt.agent_id;
          // Gate Sprint 2 fix : si un autre agent est encore en train
          // d'afficher (typewriter buffer non drainé), on ATTEND qu'il
          // finisse avant de créer la bulle de celui-ci.
          // Sans ce gate, agent N+1 commence à écrire pendant qu'agent N
          // n'a pas fini sa réplique → pas la sensation de conversation.
          // Pendant l'attente, les chunks de cet agent arrivent du
          // Worker et sont bufferisés côté TCP. Ils seront parsés après
          // le flush et pushés normalement dans son buffer typewriter.
          if (_typewriter.buffers.size > 0) {
            await _waitForTypewriterFlush();
          }
          const { textEl } = _appendMessage(panel, aid, '', { streaming: true });
          activeBubbles.set(aid, { textEl, fullText: '' });
          _typewriterPush(panel, aid, textEl, '');
          _setAgentSpeaking(panel, aid, true);
          break;
        }

        case 'chunk': {
          const aid    = evt.agent_id;
          const text   = evt.text || '';
          const bubble = activeBubbles.get(aid);
          if (!bubble || !text) break;
          bubble.fullText += text;
          // Push dans le buffer typewriter (pas direct dans textEl)
          _typewriterPush(panel, aid, bubble.textEl, text);
          break;
        }

        case 'agent_end': {
          const aid    = evt.agent_id;
          const bubble = activeBubbles.get(aid);
          if (bubble) {
            const finalText = (typeof evt.full_text === 'string' && evt.full_text.length)
              ? evt.full_text
              : bubble.fullText;
            // Marker la fin côté typewriter (le buffer va se vider à son rythme)
            _typewriterMarkEnded(aid, finalText);
            // Ajout à l'historique IMMÉDIAT (pas besoin d'attendre l'affichage)
            _currentSession.history.push({
              agent_id : aid,
              content  : finalText,
              timestamp: Date.now(),
            });
            // Sprint 5 — Autosave dans la bibliothèque locale à chaque tour
            _saveSessionToLibrary(_currentSession);
            activeBubbles.delete(aid);
          }
          break;
        }

        // Sprint 3 — Réaction emoji posée par un agent sur le message
        // précédent. Envoyé par le Worker AVANT le prochain agent_start.
        case 'agent_react': {
          _appendAgentReaction(panel, evt.agent_id, evt.target_agent_id, evt.emoji);
          break;
        }

        // Sprint 4 — Update signaux (consensus + tension + pacing dots)
        case 'signals_update': {
          _updateConsensus(panel, evt.consensus, evt.tension);
          _updatePacing(panel, evt.turns_done, evt.turns_total);
          break;
        }

        // Sprint 4 — Insights émergents extraits par Llama post-cycle
        case 'insights_update': {
          _updateInsights(panel, evt.items);
          break;
        }

        case 'complete': {
          complete = true;
          const isRoundComplete = (evt.reason === 'auto_pause' || evt.reason === 'max_turns')
                                  && (evt.turns || 0) >= ROUNDTABLE_FULL_TURNS;
          if (isRoundComplete && !_currentSession?.synthesis) {
            // Sprint 7.1 — tour de table complet : auto-synthèse
            _waitForTypewriterFlush().then(() => {
              _appendOrchestrationNote(panel,
                'Tour de table complet — synthèse stratégique en cours…');
              // Petit délai pour laisser respirer après le dernier typewriter
              setTimeout(() => { _callSynthesize(panel); }, 600);
            });
          } else if (evt.reason === 'auto_pause' || evt.reason === 'max_turns') {
            _waitForTypewriterFlush().then(() => {
              _appendOrchestrationNote(panel,
                'Le tour de table est suspendu. Intervenez pour orienter la suite ou validez par une nouvelle direction.');
            });
          }
          break;
        }

        case 'error': {
          throw new Error(evt.message || 'Erreur orchestrateur');
        }
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// FEED HELPERS
// ════════════════════════════════════════════════════════════════
function _appendMessage(panel, agentId, text, opts = {}) {
  const feed = panel.querySelector('#wr-feed');
  if (!feed) return { textEl: null, msgEl: null };

  const agent = getAgent(agentId);
  const time  = _formatTime(Date.now());

  const msgEl = document.createElement('div');
  msgEl.className = 'wr-msg';
  msgEl.dataset.agentId = agentId;
  msgEl.style.setProperty('--agent-color', agent?.color || '#fff');
  msgEl.innerHTML = `
    <div class="wr-msg-avatar">${_iconSvg(agent?.icon || 'help-circle')}</div>
    <div class="wr-msg-body">
      <div class="wr-msg-head">
        <div class="wr-msg-name">${agent?.name || 'Inconnu'}</div>
        <div class="wr-msg-time">${time}</div>
      </div>
      <div class="wr-msg-text${opts.streaming ? ' streaming' : ''}"></div>
    </div>
  `;
  const textEl = msgEl.querySelector('.wr-msg-text');
  if (textEl) textEl.textContent = text;

  feed.appendChild(msgEl);
  // Sprint 3 — Bind tap-react (clic sur la bulle ouvre picker emoji)
  _bindTapReact(panel, msgEl, agentId);
  _scrollToBottom(panel);
  return { textEl, msgEl };
}

// ─────────────────────────────────────────────────────────────────
// Sprint 3 — Système de réactions (entre agents + utilisateur)
// ─────────────────────────────────────────────────────────────────
function _ensureReactionsContainer(msgEl) {
  let el = msgEl.querySelector('.wr-msg-reactions');
  if (!el) {
    el = document.createElement('div');
    el.className = 'wr-msg-reactions';
    msgEl.querySelector('.wr-msg-body').appendChild(el);
  }
  return el;
}

function _appendAgentReaction(panel, reactorAgentId, targetAgentId, emoji) {
  if (!reactorAgentId || !targetAgentId || !emoji) return;
  // La cible : la DERNIÈRE bulle de targetAgentId dans le feed
  const bubbles = panel.querySelectorAll(`.wr-msg[data-agent-id="${targetAgentId}"]`);
  const target  = bubbles[bubbles.length - 1];
  if (!target) return;

  const reactor = getAgent(reactorAgentId);
  const container = _ensureReactionsContainer(target);
  const badge = document.createElement('span');
  badge.className = 'wr-reaction wr-reaction-agent';
  badge.style.setProperty('--reactor-color', reactor?.color || '#fff');
  badge.title = `${reactor?.name || reactorAgentId} : ${emoji}`;
  badge.innerHTML = `<span class="wr-reaction-emoji">${emoji}</span>`;
  container.appendChild(badge);
}

const REACTION_EMOJIS = ['💯', '🔥', '🤔', '👀'];
function _bindTapReact(panel, msgEl, agentId) {
  // Ne bind pas sur les messages user ou les notes système
  if (agentId === 'user' || agentId === '__note__') return;
  msgEl.addEventListener('click', (e) => {
    // Éviter ouverture si on a cliqué sur un badge existant
    if (e.target.closest('.wr-reaction') || e.target.closest('.wr-react-picker')) return;
    // Toggle existing picker
    const existing = msgEl.querySelector('.wr-react-picker');
    if (existing) { existing.remove(); return; }
    const picker = document.createElement('div');
    picker.className = 'wr-react-picker';
    picker.innerHTML = REACTION_EMOJIS.map(em =>
      `<button class="wr-react-pick" data-emoji="${em}" type="button" aria-label="Réagir avec ${em}">${em}</button>`
    ).join('');
    msgEl.querySelector('.wr-msg-body').appendChild(picker);
    // Click sur un emoji = ajout badge user
    picker.querySelectorAll('.wr-react-pick').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _appendUserReaction(msgEl, btn.dataset.emoji);
        picker.remove();
      });
    });
    // Close au clic extérieur
    setTimeout(() => {
      const onOutside = (ev) => {
        if (!picker.contains(ev.target) && !msgEl.contains(ev.target)) {
          picker.remove();
          document.removeEventListener('click', onOutside);
        }
      };
      document.addEventListener('click', onOutside);
    }, 0);
  });
}

function _appendUserReaction(msgEl, emoji) {
  if (!msgEl || !emoji) return;
  const container = _ensureReactionsContainer(msgEl);
  // Éviter doublon : si déjà cette emoji de la part du user, ignorer
  if (container.querySelector(`.wr-reaction-user[data-emoji="${emoji}"]`)) return;
  const badge = document.createElement('span');
  badge.className = 'wr-reaction wr-reaction-user';
  badge.dataset.emoji = emoji;
  badge.title = `Votre réaction : ${emoji}`;
  badge.innerHTML = `<span class="wr-reaction-emoji">${emoji}</span><span class="wr-reaction-label">Vous</span>`;
  container.appendChild(badge);
  // Sprint 4 utilisera cette réaction pour pondérer le consensus côté
  // orchestrateur. Pour Sprint 3 on stocke juste dans la session.
  const agentId = msgEl.dataset.agentId;
  if (_currentSession && agentId) {
    const entry = _currentSession.history.find(h => h.agent_id === agentId);
    if (entry) {
      entry.userReactions = entry.userReactions || [];
      if (!entry.userReactions.includes(emoji)) entry.userReactions.push(emoji);
    }
  }
}

function _appendUserMessage(panel, text) {
  const feed = panel.querySelector('#wr-feed');
  if (!feed) return;
  const msgEl = document.createElement('div');
  msgEl.className = 'wr-msg';
  msgEl.style.setProperty('--agent-color', 'rgba(255,255,255,0.6)');
  msgEl.innerHTML = `
    <div class="wr-msg-avatar">${_iconSvg('user')}</div>
    <div class="wr-msg-body">
      <div class="wr-msg-head">
        <div class="wr-msg-name">Vous</div>
        <div class="wr-msg-time">${_formatTime(Date.now())}</div>
      </div>
      <div class="wr-msg-text"></div>
    </div>
  `;
  msgEl.querySelector('.wr-msg-text').textContent = text;
  feed.appendChild(msgEl);
  _scrollToBottom(panel);
  _currentSession.history.push({
    agent_id : 'user',
    content  : text,
    timestamp: Date.now(),
  });
}

function _appendOrchestrationNote(panel, text) {
  const feed = panel.querySelector('#wr-feed');
  if (!feed) return;
  const note = document.createElement('div');
  note.className = 'wr-living';
  note.textContent = text;
  feed.appendChild(note);
  _scrollToBottom(panel);
}

function _appendErrorMessage(panel, errText) {
  const feed = panel.querySelector('#wr-feed');
  if (!feed) return;
  const msgEl = document.createElement('div');
  msgEl.className = 'wr-msg';
  msgEl.style.setProperty('--agent-color', 'var(--ks-agent-devil)');
  msgEl.innerHTML = `
    <div class="wr-msg-avatar">${_iconSvg('x')}</div>
    <div class="wr-msg-body">
      <div class="wr-msg-head">
        <div class="wr-msg-name">Erreur</div>
        <div class="wr-msg-time">${_formatTime(Date.now())}</div>
      </div>
      <div class="wr-msg-text"></div>
    </div>
  `;
  msgEl.querySelector('.wr-msg-text').textContent = errText;
  feed.appendChild(msgEl);
  _scrollToBottom(panel);
}

function _setAgentSpeaking(panel, agentId, speaking) {
  const cell = panel.querySelector(`.wr-agent-cell[data-agent-id="${agentId}"]`);
  if (!cell) return;
  cell.classList.toggle('speaking', speaking);
}

function _scrollToBottom(panel) {
  const feed = panel.querySelector('#wr-feed');
  if (feed) feed.scrollTop = feed.scrollHeight;
}

function _formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// SPRINT 4 — Signals (consensus arc + insights + pacing)
// ═══════════════════════════════════════════════════════════════

// Circonférence du cercle SVG (r=13.5) — DOIT matcher le stroke-dasharray
// dans le HTML de _renderShell (84.82 ≈ 2π × 13.5)
const CONSENSUS_CIRCUMFERENCE = 2 * Math.PI * 13.5;

function _updateConsensus(panel, value, tension) {
  if (typeof value !== 'number') return;
  const widget = panel.querySelector('#wr-consensus');
  if (!widget) return;
  widget.style.visibility = 'visible';

  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const valEl = panel.querySelector('#wr-consensus-val');
  if (valEl) valEl.textContent = `${pct}%`;

  const fgCircle = widget.querySelector('.wr-consensus-arc .fg');
  if (fgCircle) {
    const offset = CONSENSUS_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, value)));
    fgCircle.setAttribute('stroke-dashoffset', String(offset));
  }

  // Tension indicator (subtle, optionnel)
  if (typeof tension === 'number' && tension > 0.4) {
    widget.classList.add('tense');
  } else {
    widget.classList.remove('tense');
  }
}

function _updateInsights(panel, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  // La première card .wr-signal-card du panel signals = "Points clés émergents"
  const card = panel.querySelector('.wr-signals .wr-signal-card');
  if (!card) return;
  const titleEl = card.querySelector('.wr-signal-title');
  // Vider le contenu sauf le titre
  card.querySelectorAll('.wr-signal-empty, .wr-signal-list').forEach(el => el.remove());
  const list = document.createElement('ul');
  list.className = 'wr-signal-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'wr-signal-item';
    li.textContent = String(item).replace(/^["'\s]+|["'\s]+$/g, '');
    list.appendChild(li);
  }
  card.appendChild(list);
}

function _updatePacing(panel, done, total) {
  if (typeof done !== 'number' || typeof total !== 'number') return;
  // 2e card du panel signals = "Prochaine synthèse"
  const cards = panel.querySelectorAll('.wr-signals .wr-signal-card');
  if (cards.length < 2) return;
  const card = cards[1];
  let dotsEl = card.querySelector('.wr-pacing-dots');
  if (!dotsEl) {
    dotsEl = document.createElement('div');
    dotsEl.className = 'wr-pacing-dots';
    card.appendChild(dotsEl);
  }
  const ratio = Math.max(0, Math.min(1, done / Math.max(1, total)));
  const filledCount = Math.round(ratio * total);
  dotsEl.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('span');
    d.className = 'wr-pacing-dot' + (i < filledCount ? ' filled' : '');
    dotsEl.appendChild(d);
  }

  // Sprint 5 — Bouton "Lancer la synthèse" actif dès turns_done >= 2
  // Sprint 7.10 — refactor pour éviter résidus visuels du label précédent.
  let btn = card.querySelector('.wr-synthesize-btn');
  if (done >= 2) {
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wr-synthesize-btn';
      btn.addEventListener('click', () => _callSynthesize(panel));
      card.appendChild(btn);
    }
    // Au render, on (re)pose l'état initial pour garantir UN SEUL label
    // visible (idle ou done selon que la synthèse a déjà été produite).
    const state = _currentSession?.synthesis ? 'done' : 'idle';
    _setSynthesizeBtnState(btn, state);
  } else if (btn) {
    btn.remove();
  }
}

// Sprint 7.10 — Helper unique qui réécrit le bouton synthèse proprement.
// Avant : on faisait `btn.querySelector('span').textContent = '...'` à 3
// endroits, ce qui pouvait laisser des résidus DOM dans certains
// transitions (vu en prod : "e er  Lancer la synthèse" affiché). Maintenant
// on reconstruit l'innerHTML à chaque changement d'état → garantit un
// seul span avec un seul texte.
function _setSynthesizeBtnState(btn, state) {
  if (!btn) return;
  const labels = {
    idle:    'Lancer la synthèse',
    loading: 'Synthèse en cours…',
    done:    'Relancer la synthèse',
  };
  const label = labels[state] || labels.idle;
  btn.innerHTML = `${_iconSvg('sparkles')}<span>${_esc(label)}</span>`;
  btn.disabled = (state === 'loading');
  btn.classList.toggle('loading', state === 'loading');
}

// ════════════════════════════════════════════════════════════════
// SPRINT 5 — Synthesizer : Plan d'actions + Drawer + Export PDF
// ════════════════════════════════════════════════════════════════
async function _callSynthesize(panel) {
  if (!_currentSession || _currentSession.history.length < 2) return;
  const btn = panel.querySelector('.wr-synthesize-btn');
  // Sprint 7.10 — utilise l'helper pour garantir un seul label propre
  _setSynthesizeBtnState(btn, 'loading');

  try {
    // Sprint 7.9 — Si BYOK Claude configuré (Réglages → Vault), on demande
    // au worker d'utiliser Claude Sonnet pour une synthèse premium.
    // Sinon fallback Gemma 4 26B (Sprint 7.4).
    const claudeKey = _getClaudeBYOKKey();
    const bodyPayload = {
      brief:   _currentSession.brief,
      history: _currentSession.history,
    };
    if (claudeKey) {
      bodyPayload.engine = 'claude';
      bodyPayload.apiKey = claudeKey;
    }

    const res = await fetch(`${_apiBase()}/api/brainstorming/synthesize`, {
      method:  'POST',
      headers: _authHeaders(),
      body:    JSON.stringify(bodyPayload),
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.error || ''; } catch (e) {}
      throw new Error(`HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
    }
    const payload = await res.json();
    if (!payload.synthesis) throw new Error('Synthèse manquante dans la réponse');

    _currentSession.synthesis = payload.synthesis;
    _currentSession.synthesizedAt = payload.generated_at;
    _currentSession.synthesisEngine = payload.engine || 'gemma';
    _saveSessionToLibrary(_currentSession);

    _openSynthesisDrawer(panel, payload.synthesis);
  } catch (e) {
    _appendErrorMessage(panel, `Synthèse impossible : ${e?.message || e}`);
  } finally {
    // Sprint 7.10 — reset propre via l'helper (état 'done' = "Relancer la synthèse")
    _setSynthesizeBtnState(btn, 'done');
  }
}

function _openSynthesisDrawer(panel, synthesis) {
  let drawer = panel.querySelector('#wr-synthesis-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'wr-synthesis-drawer';
    drawer.className = 'wr-synthesis-drawer';
    panel.appendChild(drawer);
  }
  const brief = _currentSession?.brief || '';
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const oppList = (synthesis.opportunities || []).map(o => `<li>${_esc(o)}</li>`).join('');
  const riskList = (synthesis.risks || []).map(r => `<li>${_esc(r)}</li>`).join('');
  const actionList = (synthesis.next_actions || []).map(a => `
    <li class="wr-action-item">
      <div class="wr-action-text">${_esc(a.action)}</div>
      <div class="wr-action-deadline">${_formatDeadline(a.deadline)}</div>
    </li>
  `).join('');

  drawer.innerHTML = `
    <div class="wr-synthesis-inner">
      <header class="wr-synthesis-head">
        <div class="wr-synthesis-meta">
          <div class="wr-synthesis-eyebrow">Synthèse stratégique · ${today}</div>
          <h2 class="wr-synthesis-brief">${_esc(brief)}</h2>
        </div>
        <div class="wr-synthesis-actions">
          <button type="button" class="wr-synthesis-btn-secondary" data-act="reprendre">Reprendre la discussion</button>
          <button type="button" class="wr-synthesis-btn-primary"   data-act="export-pdf">${_iconSvg('printer')} Export PDF</button>
          <button type="button" class="wr-synthesis-btn-close"     data-act="close" aria-label="Fermer">${_iconSvg('x')}</button>
        </div>
      </header>

      <section class="wr-synthesis-section wr-synthesis-positioning">
        <div class="wr-synthesis-label">Positionnement émergent</div>
        <p class="wr-synthesis-positioning-text">${_esc(synthesis.positioning || '—')}</p>
      </section>

      <div class="wr-synthesis-grid">
        <section class="wr-synthesis-section">
          <div class="wr-synthesis-label wr-label-opp">Opportunités</div>
          <ul class="wr-synthesis-list">${oppList || '<li>—</li>'}</ul>
        </section>
        <section class="wr-synthesis-section">
          <div class="wr-synthesis-label wr-label-risk">Risques</div>
          <ul class="wr-synthesis-list">${riskList || '<li>—</li>'}</ul>
        </section>
      </div>

      <section class="wr-synthesis-section">
        <div class="wr-synthesis-label wr-label-actions">Plan d'actions</div>
        <ol class="wr-synthesis-actions-list">${actionList || '<li>—</li>'}</ol>
      </section>

      <footer class="wr-synthesis-foot">
        <span>Généré par Brainstorming · Keystone OS</span>
      </footer>
    </div>
  `;
  requestAnimationFrame(() => drawer.classList.add('open'));

  // Wire boutons
  drawer.querySelector('[data-act="close"]').addEventListener('click', () => _closeSynthesisDrawer(panel));
  drawer.querySelector('[data-act="reprendre"]').addEventListener('click', () => _closeSynthesisDrawer(panel));
  drawer.querySelector('[data-act="export-pdf"]').addEventListener('click', () => _exportSynthesisPDF(synthesis, brief));
  // Esc
  const onKey = (e) => { if (e.key === 'Escape') { _closeSynthesisDrawer(panel); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

function _closeSynthesisDrawer(panel) {
  const drawer = panel.querySelector('#wr-synthesis-drawer');
  if (!drawer) return;
  drawer.classList.remove('open');
  setTimeout(() => drawer.remove(), 300);
}

function _formatDeadline(iso) {
  if (!iso || typeof iso !== 'string') return '';
  // ISO YYYY-MM-DD → "15 juin"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  return `${parseInt(m[3],10)} ${months[parseInt(m[2],10)-1]}`;
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─────────────────────────────────────────────────────────────────
// Sprint 5 — Export PDF de la synthèse
// ─────────────────────────────────────────────────────────────────
// Ouvre une fenêtre print-friendly avec un layout A4 premium et
// déclenche window.print(). L'utilisateur peut sauvegarder en PDF
// via le dialog navigateur natif (Cmd+P → Enregistrer en PDF).
function _exportSynthesisPDF(synthesis, brief) {
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const opp  = (synthesis.opportunities || []).map(o => `<li>${_esc(o)}</li>`).join('');
  const risk = (synthesis.risks || []).map(r => `<li>${_esc(r)}</li>`).join('');
  const acts = (synthesis.next_actions || []).map(a => `
    <li class="action-item">
      <div class="action-text">${_esc(a.action)}</div>
      <div class="action-deadline">${_esc(_formatDeadline(a.deadline))}</div>
    </li>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Synthèse Brainstorming — ${_esc(brief.slice(0, 60))}</title>
<style>
  @page { size: A4; margin: 18mm 18mm 22mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    color: #0f172a; line-height: 1.55; margin: 0;
    -webkit-font-smoothing: antialiased;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 12px; border-bottom: 2px solid #0f172a; margin-bottom: 24px; }
  .brand { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #475569; }
  .date  { font-size: 11px; color: #64748b; }
  h1 { font-size: 28px; font-weight: 900; letter-spacing: -0.025em; margin: 4px 0 6px; line-height: 1.1; }
  .eyebrow { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #6366f1; font-weight: 600; margin-bottom: 18px; }
  .positioning {
    background: #f1f5f9;
    border-left: 4px solid #6366f1;
    padding: 16px 20px;
    border-radius: 6px;
    margin-bottom: 28px;
  }
  .positioning .label { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6366f1; font-weight: 700; margin-bottom: 8px; }
  .positioning .text  { font-size: 16px; font-weight: 600; color: #0f172a; line-height: 1.45; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-bottom: 28px; }
  .section h2 { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: #0f172a; margin: 0 0 12px; font-weight: 800; }
  .section.opp h2  { color: #16a34a; }
  .section.risk h2 { color: #c53030; }
  .section.acts h2 { color: #0f172a; }
  ul, ol { margin: 0; padding-left: 20px; }
  li { margin-bottom: 8px; font-size: 13.5px; }
  .action-item { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
  .action-text { flex: 1; font-weight: 500; }
  .action-deadline { font-size: 11px; color: #475569; font-variant-numeric: tabular-nums; white-space: nowrap; padding: 2px 8px; background: #e2e8f0; border-radius: 999px; }
  /* Sprint 7.10 — footer en flux normal (pas position:fixed qui se
     superposait au contenu quand le PDF débordait sur plusieurs pages).
     Apparaît une fois en fin de document, après le contenu. */
  .foot { margin-top: 36px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; text-align: center; letter-spacing: 0.05em; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="brand">Keystone OS · Brainstorming</div>
      <h1>${_esc(brief)}</h1>
    </div>
    <div class="date">${today}</div>
  </div>

  <div class="eyebrow">Synthèse stratégique</div>

  <div class="positioning">
    <div class="label">Positionnement émergent</div>
    <div class="text">${_esc(synthesis.positioning || '—')}</div>
  </div>

  <div class="grid">
    <div class="section opp">
      <h2>Opportunités</h2>
      <ul>${opp || '<li>—</li>'}</ul>
    </div>
    <div class="section risk">
      <h2>Risques</h2>
      <ul>${risk || '<li>—</li>'}</ul>
    </div>
  </div>

  <div class="section acts">
    <h2>Plan d'actions</h2>
    <ol>${acts || '<li>—</li>'}</ol>
  </div>

  <div class="foot">Généré par Keystone OS · protein-keystone.com</div>

  <script>
    window.onload = () => setTimeout(() => window.print(), 250);
  </script>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Le pop-up a été bloqué. Autorise les pop-ups pour exporter en PDF.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ─────────────────────────────────────────────────────────────────
// Sprint 5 — Bibliothèque locale des sessions
// ─────────────────────────────────────────────────────────────────
const LIBRARY_KEY = 'ks_brainstorming_sessions';
const LIBRARY_MAX = 20;

function _loadLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function _saveSessionToLibrary(session) {
  if (!session || !session.id || !session.brief) return;
  const all = _loadLibrary();
  // Si la session existe déjà (par id), on la remplace ; sinon on l'ajoute
  const existing = all.findIndex(s => s.id === session.id);
  const entry = {
    id:             session.id,
    brief:          session.brief,
    mode:           session.mode,
    started_at:     session.startedAt || Date.now(),
    updated_at:     Date.now(),
    history:        session.history || [],
    synthesis:      session.synthesis || null,
    synthesizedAt:  session.synthesizedAt || null,
  };
  if (existing >= 0) all[existing] = entry;
  else all.unshift(entry);
  // Trim LRU
  const trimmed = all.slice(0, LIBRARY_MAX);
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(trimmed)); }
  catch (e) { /* quota — ignore */ }
}

// Sprint 7 — Modale sélecteur de mode cognitif
// Grid de 7 cards (1 actif + 6 autres) avec couleur d'accent, label,
// description, état "actif". Click sur une card = _applyMode + close.
function _openModesModal(panel) {
  let modal = panel.querySelector('#wr-modes-modal');
  if (modal) { modal.remove(); return; }
  const enabled = COGNITIVE_MODES.filter(m => m.enabled);
  const current = _currentSession?.mode || DEFAULT_MODE;
  modal = document.createElement('div');
  modal.id = 'wr-modes-modal';
  modal.className = 'wr-modes-modal';
  const cards = enabled.map(m => {
    const isActive = m.id === current;
    return `
      <button type="button"
              class="wr-mode-card${isActive ? ' active' : ''}"
              data-mode-id="${m.id}"
              style="--mode-color: var(${m.colorVar});">
        <div class="wr-mode-card-head">
          <span class="wr-mode-card-dot"></span>
          <span class="wr-mode-card-label">${_esc(m.label)}</span>
          ${isActive ? '<span class="wr-mode-card-badge">Actif</span>' : ''}
        </div>
        <div class="wr-mode-card-short">${_esc(m.short || '')}</div>
        <div class="wr-mode-card-desc">${_esc(m.description)}</div>
      </button>`;
  }).join('');
  modal.innerHTML = `
    <div class="wr-modes-inner">
      <div class="wr-modes-head">
        <div class="wr-modes-title">Modes cognitifs</div>
        <div class="wr-modes-sub">Le mode oriente l'arc narratif du débat et le focus de chaque agent.</div>
        <button type="button" class="wr-modes-close" aria-label="Fermer">${_iconSvg('x')}</button>
      </div>
      <div class="wr-modes-grid">${cards}</div>
    </div>
  `;
  panel.appendChild(modal);
  modal.querySelector('.wr-modes-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelectorAll('.wr-mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const mid = card.dataset.modeId;
      if (mid && mid !== _currentSession?.mode) _applyMode(panel, mid);
      modal.remove();
    });
  });
}

// Sprint 7.5 — Modale Personnalités des agents (lecture seule)
// Permet à l'utilisateur de comprendre QUI parle dans le débat et quel
// est le rôle de chaque agent. Branchée sur le bouton "Agents" du rail.
function _openAgentsModal(panel) {
  let modal = panel.querySelector('#wr-agents-modal');
  if (modal) { modal.remove(); return; }
  modal = document.createElement('div');
  modal.id = 'wr-agents-modal';
  modal.className = 'wr-agents-modal';
  const cards = AGENTS.map(a => `
    <div class="wr-agent-card" style="--agent-color: ${a.color}; --agent-glow: ${a.color}40;">
      <div class="wr-agent-card-head">
        <div class="wr-agent-card-icon">${_iconSvg(a.icon)}</div>
        <div class="wr-agent-card-name">${_esc(a.name)}</div>
      </div>
      <div class="wr-agent-card-role">${_esc(a.role)}</div>
      <div class="wr-agent-card-fn">${_esc(a.function || '')}</div>
      <div class="wr-agent-card-traits">
        ${(a.personality || []).map(t => `<span class="wr-agent-trait">${_esc(t)}</span>`).join('')}
      </div>
    </div>
  `).join('');
  modal.innerHTML = `
    <div class="wr-agents-inner">
      <div class="wr-agents-head">
        <div class="wr-agents-title">Personnalités du boardroom</div>
        <div class="wr-agents-sub">9 expertises distinctes qui dialoguent en direct. Chacune intervient quand le débat appelle son angle.</div>
        <button type="button" class="wr-agents-close" aria-label="Fermer">${_iconSvg('x')}</button>
      </div>
      <div class="wr-agents-grid">${cards}</div>
    </div>
  `;
  panel.appendChild(modal);
  modal.querySelector('.wr-agents-close').addEventListener('click', (e) => {
    e.stopPropagation();
    modal.remove();
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// Sprint 7.5 — Suppression d'une session de la bibliothèque
function _deleteSessionFromLibrary(sessionId) {
  const all = _loadLibrary();
  const next = all.filter(s => s.id !== sessionId);
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(next)); }
  catch (e) { /* quota */ }
}

function _openLibraryModal(panel) {
  let modal = panel.querySelector('#wr-library-modal');
  if (modal) { modal.remove(); return; }
  modal = document.createElement('div');
  modal.id = 'wr-library-modal';
  modal.className = 'wr-library-modal';
  _renderLibraryModal(panel, modal);
  panel.appendChild(modal);
}

// Sprint 7.5 — Render isolé (réutilisé après suppression pour refresh)
function _renderLibraryModal(panel, modal) {
  const all = _loadLibrary();
  const items = all.map(s => {
    const date = new Date(s.updated_at || s.started_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const hasSynth = s.synthesis ? '<span class="wr-library-tag">synthèse</span>' : '';
    const brief = _esc((s.brief || '').slice(0, 100)) + ((s.brief || '').length > 100 ? '…' : '');
    return `
      <li class="wr-library-item" data-session-id="${_esc(s.id)}">
        <div class="wr-library-item-body">
          <div class="wr-library-item-head">
            <span class="wr-library-date">${date}</span>
            ${hasSynth}
          </div>
          <div class="wr-library-brief">${brief}</div>
        </div>
        <button type="button" class="wr-library-item-del" data-session-id="${_esc(s.id)}" title="Supprimer cette session" aria-label="Supprimer">${_iconSvg('trash-2')}</button>
      </li>`;
  }).join('');
  modal.innerHTML = `
    <div class="wr-library-inner">
      <div class="wr-library-head">
        <div class="wr-library-title">Bibliothèque de sessions</div>
        <button type="button" class="wr-library-close" aria-label="Fermer">${_iconSvg('x')}</button>
      </div>
      ${all.length === 0
        ? '<div class="wr-library-empty">Aucune session enregistrée pour le moment. Lance ton premier brainstorming et la synthèse sera archivée ici.</div>'
        : `<ul class="wr-library-list">${items}</ul>`
      }
    </div>
  `;
  // Close button — utilise closest() pour matcher le SVG enfant en cas de click dessus
  modal.querySelector('.wr-library-close').addEventListener('click', (e) => {
    e.stopPropagation();
    modal.remove();
  });
  // Backdrop click ferme uniquement si on clique sur le backdrop nu (pas un enfant)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  // Click sur le bouton supprimer (n'ouvre PAS la session)
  modal.querySelectorAll('.wr-library-item-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sid = btn.dataset.sessionId;
      if (!sid) return;
      const confirmed = confirm('Supprimer définitivement cette session ?');
      if (!confirmed) return;
      _deleteSessionFromLibrary(sid);
      _renderLibraryModal(panel, modal);  // refresh la liste
    });
  });
  // Click sur le corps de l'item charge la session
  modal.querySelectorAll('.wr-library-item-body').forEach(body => {
    body.addEventListener('click', (e) => {
      e.stopPropagation();
      const li = body.closest('.wr-library-item');
      const sid = li?.dataset.sessionId;
      if (!sid) return;
      const session = _loadLibrary().find(s => s.id === sid);
      if (!session) return;
      try {
        _restoreSession(panel, session);
        modal.remove();
      } catch (err) {
        console.error('[brainstorming] _restoreSession failed:', err);
        _appendErrorMessage(panel, `Impossible de charger cette session : ${err?.message || err}. Le format est peut-être obsolète.`);
        modal.remove();
      }
    });
  });
}

function _restoreSession(panel, session) {
  // Recharger la session courante
  _currentSession = {
    id:             session.id,
    brief:          session.brief,
    mode:           session.mode || DEFAULT_MODE,
    history:        session.history || [],
    started:        true,
    startedAt:      session.started_at,
    synthesis:      session.synthesis,
    synthesizedAt:  session.synthesizedAt,
  };
  // Sprint 7 — restaurer aussi la couleur d'accent du mode de la session
  _applyMode(panel, _currentSession.mode);
  _updateHeader(panel, session.brief);
  _hideEmpty(panel);
  // Rerender le feed depuis history
  const feed = panel.querySelector('#wr-feed');
  if (feed) feed.innerHTML = '';
  for (const turn of session.history) {
    if (turn.agent_id === 'user') {
      _appendUserMessage(panel, turn.content);
    } else {
      const { textEl } = _appendMessage(panel, turn.agent_id, turn.content, { streaming: false });
      // Pas de streaming, le texte est déjà là
    }
  }
  // Si la session a une synthèse, ré-affiche le drawer
  if (session.synthesis) {
    _openSynthesisDrawer(panel, session.synthesis);
  }
}
