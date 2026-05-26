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

// ── Constantes Sprint 1 ──────────────────────────────────────────
const SPRINT1_ACTIVE_AGENT = 'strategic';        // seul agent qui répond
const DEFAULT_MODE         = 'exploration';      // hardcodé pour Sprint 1
const BOOT_DELAY_PER_AGENT = 280;                // ms entre chaque allumage
const SESSION_KEY          = 'ks_brainstorming_session_draft';

// État de session courante (transient — Sprint 5 ajoutera la persistance)
let _currentSession = null;

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
  };

  _wireShell(panel);
  bindHelpButton(panel, APP_ID);
  bindRatingButton(panel, APP_ID);
  bindBurger(panel);
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

    <!-- Left rail (3 icônes — sessions / agents / modes) -->
    <aside class="wr-rail">
      <button class="wr-rail-btn active" title="Sessions" aria-label="Sessions">
        ${_iconSvg('chat')}
      </button>
      <button class="wr-rail-btn" title="Agents" aria-label="Agents">
        ${_iconSvg('users')}
      </button>
      <button class="wr-rail-btn" title="Modes cognitifs" aria-label="Modes">
        ${_iconSvg('sparkles')}
      </button>
      <div class="wr-rail-spacer"></div>
    </aside>

    <!-- Sub-header : mode courant + consensus arc -->
    <div class="wr-subheader">
      <div class="wr-subheader-mode" id="wr-subtitle">Mode ${mode.label} · Posez votre brief pour ouvrir la discussion</div>
      <div class="wr-consensus" id="wr-consensus" style="visibility:hidden">
        <div class="wr-consensus-arc">
          <svg viewBox="0 0 32 32" width="32" height="32">
            <circle class="bg" cx="16" cy="16" r="13.5"/>
            <circle class="fg" cx="16" cy="16" r="13.5"
              stroke-dasharray="84.82" stroke-dashoffset="84.82" stroke-linecap="round"/>
          </svg>
          <div class="wr-consensus-val" id="wr-consensus-val">0%</div>
        </div>
        <span>Consensus</span>
      </div>
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
          Le Synthesizer interviendra quand le consensus atteindra un seuil optimal.
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

  // Esc key
  const onKey = (e) => {
    if (e.key === 'Escape') closeBrainstorming();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { _submit(panel); }
  };
  document.addEventListener('keydown', onKey);
  panel.addEventListener('wr:cleanup', () => document.removeEventListener('keydown', onKey));

  // Send button
  panel.querySelector('#wr-send')?.addEventListener('click', () => _submit(panel));

  // Pills d'intention — Sprint 1 : injectent juste le texte dans l'input
  panel.querySelectorAll('.wr-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = panel.querySelector('#wr-input');
      if (!input) return;
      const v = btn.dataset.pill || '';
      input.value = input.value
        ? `${input.value.trim()} — ${v}`
        : v;
      input.focus();
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
      if (cell.dataset.agentId === SPRINT1_ACTIVE_AGENT) {
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

  try {
    await _callAgent(panel, SPRINT1_ACTIVE_AGENT);
  } catch (e) {
    _appendErrorMessage(panel, e?.message || 'Erreur réseau');
  } finally {
    send.disabled = false;
    input.focus();
  }
}

function _updateHeader(panel, brief) {
  const subtitle = panel.querySelector('#wr-subtitle');
  if (subtitle) {
    const trimmed = brief.length > 120 ? brief.slice(0, 117) + '…' : brief;
    subtitle.textContent = `Mode ${getCognitiveMode(DEFAULT_MODE).label} · ${trimmed}`;
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
// AGENT CALL — fetch SSE stream depuis le Worker
// ════════════════════════════════════════════════════════════════
async function _callAgent(panel, agentId) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent inconnu : ${agentId}`);

  // UI : marquer l'agent comme "speaking"
  _setAgentSpeaking(panel, agentId, true);

  // Préparer la bulle qui va recevoir les chunks
  const { textEl, msgEl } = _appendMessage(panel, agentId, '', { streaming: true });

  const url = `${_apiBase()}/api/brainstorming/agent-respond`;
  const payload = {
    agent_id      : agentId,
    brief         : _currentSession.brief,
    cognitive_mode: _currentSession.mode,
    history       : _currentSession.history,
  };

  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: _authHeaders(),
      body:    JSON.stringify(payload),
    });
  } catch (e) {
    _setAgentSpeaking(panel, agentId, false);
    textEl.classList.remove('streaming');
    throw new Error('Connexion impossible au Worker');
  }

  if (!res.ok) {
    _setAgentSpeaking(panel, agentId, false);
    textEl.classList.remove('streaming');
    let detail = '';
    try { const j = await res.json(); detail = j.error || ''; } catch (e) {}
    throw new Error(`HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
  }

  // Stream SSE — chunks lines "data: ..."
  const reader  = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let   buffer  = '';
  let   fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        // Format Worker AI : { response: "..." } OU { text: "..." }
        // (les deux acceptés selon stream / non-stream)
        const chunk = parsed.response ?? parsed.text ?? '';
        if (chunk) {
          fullText += chunk;
          textEl.textContent = fullText;
          _scrollToBottom(panel);
        }
      } catch (e) { /* line malformée — on ignore */ }
    }
  }

  // Finalisation
  textEl.classList.remove('streaming');
  _setAgentSpeaking(panel, agentId, false);

  // Ajout à l'historique de session
  _currentSession.history.push({
    agent_id : agentId,
    content  : fullText,
    timestamp: Date.now(),
  });
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
  _scrollToBottom(panel);
  return { textEl, msgEl };
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
