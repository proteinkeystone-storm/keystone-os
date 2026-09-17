/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Le Pont (MCP sprint 4) : l'onglet exécute pour Claude
   ───────────────────────────────────────────────────────────────
   Quand Claude (via le serveur MCP du Worker) appelle un outil qui
   n'existe que dans le navigateur, le Worker pousse un ORDRE sur ce
   canal ; l'onglet exécute la fonction `run` de l'action du catalogue
   (app/bridge-actions.js), pose l'anneau sur la cible (bridge-ring.js)
   et renvoie le résultat. On voit où ça agit ; rien ne se passe à
   l'insu de l'utilisateur.

   Canal : fetch GET /api/mcp/bridge/stream avec Authorization (jamais
   de jeton dans l'URL — donc pas d'EventSource), corps lu en continu,
   trames SSE parsées à la main. Le Worker referme le canal toutes les
   4 min : on se reconnecte (backoff 1 s → 30 s sur erreur, 500 ms sur
   fin normale). Piloté par événement : aucun setInterval d'écoute.

   Garde-fous : on n'exécute QUE les actions du catalogue (jamais du
   code reçu) ; un ordre est répondu une fois ; un ordre expiré (le
   Worker n'attend plus) est ignoré. Préfixe `ks_bridge_` / `__ksBridge`.
   ═══════════════════════════════════════════════════════════════ */
import { bridgeAction, runBridgeAction } from './bridge-actions.js';
import { bridgeRing, bridgeUnring } from './bridge-ring.js';
import { setKeystoneStatus } from './dst.js';

const CF_WORKER = 'https://keystone-os-api.keystone-os.workers.dev';
const IS_LOCAL  = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API       = IS_LOCAL ? '' : CF_WORKER;
const RING_MS   = 1600;

const state = { connected: false, tab: null, jobs: 0, lastError: null, since: null };
let _abort = null;
let _backoff = 1000;
let _stopped = false;
let _connecting = false;
const _seen = new Set();
const _tabId = (() => { try { const k = 'ks_bridge_tab'; let v = sessionStorage.getItem(k); if (!v) { v = 'tab_' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem(k, v); } return v; } catch (e) { return 'tab_' + Math.random().toString(36).slice(2, 10); } })();

const _jwt = () => { try { return localStorage.getItem('ks_jwt') || ''; } catch (e) { return ''; } };
/* mobile / PWA : un onglet en arrière-plan est suspendu par le système → il se retire du Pont */
const _isMobile = (() => { try { return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (matchMedia('(display-mode: standalone)').matches && 'ontouchstart' in window); } catch (e) { return false; } })();

/* L'onglet se retire lui-même de la présence (keepalive : part même à la fermeture). */
function _bye() {
  const jwt = _jwt(); if (!jwt) return;
  try { fetch(`${API}/api/mcp/bridge/bye`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt }, body: JSON.stringify({ tab: _tabId }) }); } catch (e) { /* tant pis : la présence expirera */ }
}

/* ── Réponse au Worker ── */
async function _reply(jobId, payload) {
  const jwt = _jwt(); if (!jwt) return;
  try {
    await fetch(`${API}/api/mcp/bridge/jobs/${encodeURIComponent(jobId)}/result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt }, body: JSON.stringify(payload),
    });
  } catch (e) { /* réseau : le Worker expirera l'ordre de lui-même */ }
}

/* ── Exécution d'un ordre ── */
async function _execute(job) {
  if (!job || !job.id || _seen.has(job.id)) return;
  _seen.add(job.id);
  if (_seen.size > 500) _seen.delete(_seen.values().next().value);
  if (job.expires_at && Date.parse(job.expires_at) < Date.now()) return;      // le Worker n'attend plus
  const action = bridgeAction(String(job.action || ''));
  if (!action) { await _reply(job.id, { ok: false, error: `Action hors catalogue : ${job.action}` }); return; }
  state.jobs++;
  setKeystoneStatus(`Votre assistant : ${action.label}`, 'info', 5000, 2);
  let ringed = null;
  try { ringed = action.target ? bridgeRing(action.target) : null; } catch (e) { ringed = null; }
  const args = (job.args && typeof job.args === 'object') ? job.args : {};
  const r = await runBridgeAction(action.id, args);
  if (r.ok) {
    /* la cible a pu apparaître pendant l'action (pad ouvert) : anneau a posteriori */
    if (!ringed && action.target) { try { ringed = bridgeRing(action.target); } catch (e) { ringed = null; } }
    await _reply(job.id, { ok: true, data: r.data ?? null });
    /* ordre issu d'une notification push : la proposition jumelle de la bannette est appliquée */
    if (job.inbox_id && r.data && r.data.fait !== false) {
      const jwt = _jwt();
      if (jwt) { try { await fetch(`${API}/api/mcp/inbox/${encodeURIComponent(job.inbox_id)}/applied`, { method: 'POST', headers: { Authorization: 'Bearer ' + jwt } }); } catch (e) { /* la bannette la montrera encore, sans gravité */ } }
      window.__ksBannetteRefresh?.();
    }
  } else {
    await _reply(job.id, { ok: false, error: r.error || 'échec dans l’onglet' });
  }
  if (ringed) setTimeout(() => { try { bridgeUnring(ringed); } catch (e) { /* déjà retiré */ } }, RING_MS);
}

/* ── Lecture du canal (SSE à la main) ── */
async function _consume(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let event = 'message', data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;                                    // « : ping »
      let payload = null; try { payload = JSON.parse(data); } catch (e) { continue; }
      if (event === 'hello') { state.connected = true; state.tab = payload.tab || _tabId; state.since = Date.now(); _backoff = 1000; }
      else if (event === 'job') { _execute(payload); }        // sans await : le canal continue de lire
      else if (event === 'bye') { return { reconnectMs: payload.reconnect_ms || 500 }; }
    }
  }
  return { reconnectMs: 500 };
}

async function _connect() {
  if (_stopped || _connecting) return;
  const jwt = _jwt();
  if (!jwt || !navigator.onLine) return;                     // on sera rappelé par les événements
  _connecting = true;
  _abort = new AbortController();
  let reconnectMs = _backoff;
  try {
    const res = await fetch(`${API}/api/mcp/bridge/stream`, { headers: { Authorization: 'Bearer ' + jwt, 'X-Bridge-Tab': _tabId, Accept: 'text/event-stream' }, signal: _abort.signal });
    if (res.status === 401) { state.connected = false; _connecting = false; return; }   // session morte : ks-licence-activated relancera
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const r = await _consume(res.body);
    reconnectMs = r.reconnectMs;
  } catch (e) {
    if (e && e.name === 'AbortError') { _connecting = false; return; }
    state.lastError = e?.message || String(e);
    reconnectMs = _backoff = Math.min(30000, _backoff * 2);
  } finally {
    state.connected = false;
    _connecting = false;
  }
  if (!_stopped) setTimeout(_connect, reconnectMs);
}

function _reconnectNow() {
  if (_abort) { try { _abort.abort(); } catch (e) { /* no-op */ } _abort = null; }
  _backoff = 1000;
  setTimeout(_connect, 50);
}

export function initBridge() {
  if (_stopped) _stopped = false;
  setTimeout(_connect, 800);
  window.addEventListener('ks-licence-activated', _reconnectNow);
  window.addEventListener('ks-vault-hydrated', () => { if (!state.connected && !_connecting) _connect(); });
  window.addEventListener('online', () => { if (!state.connected && !_connecting) _connect(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      /* sur ordinateur, un onglet caché reste utile (claude.ai au premier plan) ; sur mobile il sera suspendu */
      if (_isMobile) { if (_abort) { try { _abort.abort(); } catch (e) { /* no-op */ } _abort = null; } _bye(); }
      return;
    }
    if (!state.connected && !_connecting) _connect();
  });
  window.addEventListener('pagehide', () => { if (_abort) { try { _abort.abort(); } catch (e) { /* no-op */ } } _bye(); });
  window.__ksBridge = { state, reconnect: _reconnectNow, stop: () => { _stopped = true; if (_abort) _abort.abort(); } };
}
