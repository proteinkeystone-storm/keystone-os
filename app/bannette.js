/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Bannette (MCP sprint 3)
   ───────────────────────────────────────────────────────────────
   Ce que l'assistant (Claude via MCP) prépare pour les pads qui vivent
   dans le navigateur (composer Social, Ghost Writer, Brainstorming,
   pré-remplissage d'un pad) arrive ici sous forme de PROPOSITIONS :
   le Worker les stocke (mcp_inbox), l'onglet les lit, l'utilisateur
   les applique d'un clic (→ openTool(pad, opts), le contrat inter-pads
   qui existe déjà) ou les ignore. Rien ne s'applique tout seul, rien ne
   se publie : Claude propose, l'utilisateur tranche.

   Et le BANDEAU D'ACTIVITÉ : les écritures faites côté serveur (note
   Keynapse, audit Sentinel, contact networK…) n'ont pas d'anneau ; on
   lit le ledger (/api/mcp/activity) et on le dit dans le DST — rien ne
   se passe à l'insu de l'utilisateur.

   Piloté par événement, pas par minuterie serrée : boot, hydratation du
   Vault, activation de licence, retour de l'onglet au premier plan
   (throttle 60 s), et un rafraîchissement lent (5 min, onglet visible).
   Préfixe `ks_bannette_` / `ks_mcp_` (localStorage), `ks-bannette` (DOM).
   ═══════════════════════════════════════════════════════════════ */
import { setKeystoneStatus } from './dst.js';
import { icon } from './lib/ui-icons.js';

const CF_WORKER   = 'https://keystone-os-api.keystone-os.workers.dev';
const IS_LOCAL    = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API         = IS_LOCAL ? '' : CF_WORKER;
const THROTTLE_MS = 60 * 1000;
const SLOW_MS     = 5 * 60 * 1000;
const LS_SEEN     = 'ks_mcp_activity_seen';

const PAD_NAMES = { 'O-SOC-001': 'Social Manager', 'A-COM-005': 'Ghost Writer', 'A-COM-003': 'Brainstorming', 'A-COM-001': 'Smart Dynamic QR' };

let _items = [];
let _lastFetch = 0;
let _slowTimer = null;
let _busy = false;

const _jwt = () => { try { return localStorage.getItem('ks_jwt') || ''; } catch (e) { return ''; } };
const _el  = () => document.getElementById('ks-bannette');

async function _api(path, { method = 'GET', body } = {}) {
  const jwt = _jwt();
  if (!jwt) return { status: 401, data: null };
  const headers = { Authorization: 'Bearer ' + jwt };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch (e) { /* corps vide */ }
  return { status: res.status, data };
}

/* ── Rendu ── */
function _render() {
  const el = _el();
  if (!el) return;
  el.innerHTML = '';
  if (!_items.length) { el.hidden = true; return; }
  for (const it of _items) {
    const row = document.createElement('div');
    row.className = 'ks-bannette-item';
    row.dataset.id = it.id;
    const ic = document.createElement('span');
    ic.className = 'ks-bannette-icon';
    ic.innerHTML = icon('sparkles', 14);
    const txt = document.createElement('span');
    txt.className = 'ks-bannette-text';
    txt.textContent = it.summary || `Proposition pour ${PAD_NAMES[it.pad] || it.pad}`;
    txt.title = `Préparé par votre assistant · ${PAD_NAMES[it.pad] || it.pad}`;
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'ks-bannette-btn ks-bannette-btn--primary';
    open.textContent = `Ouvrir dans ${PAD_NAMES[it.pad] || 'l’application'}`;
    open.addEventListener('click', () => _apply(it, row));
    const skip = document.createElement('button');
    skip.type = 'button'; skip.className = 'ks-bannette-btn';
    skip.textContent = 'Ignorer';
    skip.addEventListener('click', () => _dismiss(it, row));
    row.append(ic, txt, open, skip);
    el.appendChild(row);
  }
  el.hidden = false;
}

/* ── Gating (même règle que bridge-actions._padAccessible) ── */
async function _padAccessible(padId) {
  try {
    const { getOwnedIds, getLifetimeIds, isAdminUser } = await import('./pads-loader.js');
    if (isAdminUser()) return true;
    const owned = getOwnedIds();
    if (owned === null) return true;
    return owned.includes(padId) || getLifetimeIds().includes(padId);
  } catch (e) { return true; }
}

/* ── Application d'une proposition = le contrat inter-pads existant ── */
async function _applyKind(it) {
  const p = (it.payload && typeof it.payload === 'object') ? it.payload : {};
  switch (it.kind) {
    case 'compose': {
      const { openTool } = await import('./ui-renderer.js');
      openTool('O-SOC-001', { compose: { text: String(p.text || ''), targets: Array.isArray(p.targets) ? p.targets : [], append: false } });
      return;
    }
    case 'gw.rewrite': {
      if (document.getElementById('gw-overlay')) throw new Error('Le Ghost Writer est déjà ouvert — ferme-le, puis réessaie.');
      const gw = await import('./ghostwriter.js');
      if (typeof gw.isGhostwriterEnabled === 'function' && !gw.isGhostwriterEnabled()) throw new Error('Le Ghost Writer n’est pas activé sur ce poste.');
      gw.openGhostwriter(String(p.text || ''));
      return;
    }
    case 'bs.session_seed': {
      if (document.querySelector('#wr-fullscreen.open')) throw new Error('Une séance de brainstorming est déjà ouverte — termine-la, puis réessaie.');
      const { openBrainstorming } = await import('./brainstorming.js');
      openBrainstorming({ brief: String(p.brief || '') });
      return;
    }
    case 'prefillData': {
      const { openTool } = await import('./ui-renderer.js');
      openTool(it.pad, { prefillData: p });
      return;
    }
    case 'createVcard': {
      const { openTool } = await import('./ui-renderer.js');
      openTool('A-COM-001', { createVcard: p.vcard || p, presetName: p.name });
      return;
    }
    default:
      throw new Error('Proposition d’un type inconnu — mets Keystone à jour.');
  }
}

async function _apply(it, row) {
  if (_busy) return;
  _busy = true;
  try {
    if (!(await _padAccessible(it.pad))) {
      const { openTool } = await import('./ui-renderer.js');
      openTool(it.pad);                                   // ouvre la fiche K-Store, n'écrit rien
      setKeystoneStatus(`${PAD_NAMES[it.pad] || 'Cette application'} n’est pas dans votre licence — la proposition reste dans la bannette.`, 'warn', 6000, 2);
      return;
    }
    await _applyKind(it);
    await _api(`/api/mcp/inbox/${encodeURIComponent(it.id)}/applied`, { method: 'POST' });
    _items = _items.filter(x => x.id !== it.id);
    row?.remove();
    if (!_items.length) _render();
    window.__ksLivingRefresh?.();
  } catch (e) {
    setKeystoneStatus(e?.message || 'Impossible d’appliquer cette proposition.', 'warn', 6000, 2);
  } finally { _busy = false; }
}

async function _dismiss(it, row) {
  try { await _api(`/api/mcp/inbox/${encodeURIComponent(it.id)}/dismissed`, { method: 'POST' }); } catch (e) { /* réseau : on retentera au prochain refresh */ }
  _items = _items.filter(x => x.id !== it.id);
  row?.remove();
  if (!_items.length) _render();
  window.__ksLivingRefresh?.();
}

/* ── Bandeau d'activité (écritures serveur) ── */
async function _pollActivity() {
  let since = '';
  try { since = localStorage.getItem(LS_SEEN) || ''; } catch (e) { /* no-op */ }
  if (!since) since = new Date(Date.now() - 6 * 3600e3).toISOString();
  const { status, data } = await _api(`/api/mcp/activity?since=${encodeURIComponent(since)}`);
  if (status !== 200 || !data?.ok) return;
  const items = Array.isArray(data.items) ? items_ok(data.items) : [];
  if (items.length) {
    const last = items[items.length - 1];
    const text = items.length === 1
      ? `Votre assistant : ${last.label || last.tool}`
      : `Votre assistant a agi ${items.length} fois — dernière action : ${last.label || last.tool}`;
    setKeystoneStatus(text, 'info', 7000, 2);
    window.__ksLivingRefresh?.();
  }
  try { localStorage.setItem(LS_SEEN, data.now || new Date().toISOString()); } catch (e) { /* plein */ }
}
const items_ok = (arr) => arr.filter(x => x && (x.label || x.tool));

/* ── Rafraîchissement ── */
async function _refresh(force = false) {
  if (!_jwt()) { _items = []; _render(); return; }
  const now = Date.now();
  if (!force && now - _lastFetch < THROTTLE_MS) return;
  _lastFetch = now;
  try {
    const [{ status, data }] = await Promise.all([_api('/api/mcp/inbox'), _pollActivity().catch(() => null)]);
    if (status === 200 && data?.ok) { _items = Array.isArray(data.items) ? data.items : []; _render(); }
    else if (status === 401) { _items = []; _render(); }
  } catch (e) { /* hors ligne : on garde l'affichage courant */ }
}

export function initBannette() {
  if (!_el()) return;
  setTimeout(() => _refresh(true), 1500);
  window.addEventListener('ks-vault-hydrated',   () => _refresh(true));
  window.addEventListener('ks-licence-activated', () => _refresh(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _refresh(); });
  if (!_slowTimer) _slowTimer = setInterval(() => { if (!document.hidden) _refresh(); }, SLOW_MS);
  window.__ksBannetteRefresh = () => _refresh(true);
}
