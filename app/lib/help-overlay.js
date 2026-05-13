/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Help Overlay (composant partagé v1.0)
   ─────────────────────────────────────────────────────────────
   Pattern slide-in à droite (Notion/Linear-like). Bouton "?" en
   topbar qui ouvre un panneau d'aide overlay sans interrompre
   le travail en cours. Réutilisable sur tous les artefacts.

   Conventions :
     - Chaque artefact a son contenu d'aide en JSON dans
       /K_STORE_ASSETS/HELP/{appId}.json
     - Schéma JSON :
         {
           "title":   "Nom de l'artefact",
           "tldr":    "1-2 phrases",
           "key_points": ["Étape 1 …", "Étape 2 …"],
           "faq":     [{ "q": "...", "a": "..." }],
           "shortcuts": [{ "keys": "Échap", "desc": "..." }],
           "updated_at": "2026-05-14"
         }
     - Le JSON est édité sans redéploiement (juste push Vercel).

   API :
     helpButtonHTML(appId)         → string HTML à injecter en topbar
     bindHelpButton(rootEl, appId) → attache les handlers au bouton
   ═══════════════════════════════════════════════════════════════ */

import { icon } from './ui-icons.js';

const HELP_BASE = '/K_STORE_ASSETS/HELP/';
const _cache = new Map();
let _openPanel = null;
let _onEscape = null;

// ── HTML du bouton (à placer dans la topbar) ──────────────────
export function helpButtonHTML(appId) {
  return `
    <button class="ws-iconbtn ws-help-trigger"
            data-act="help-open" data-help-app="${_escape(appId)}"
            title="Aide" aria-label="Afficher l'aide">
      ${icon('help-circle', 18)}
    </button>
  `;
}

// ── Attache le handler au bouton précédemment rendu ───────────
export function bindHelpButton(rootEl, appId) {
  if (!rootEl || !appId) return;
  const trigger = rootEl.querySelector(`.ws-help-trigger[data-help-app="${appId}"]`);
  if (!trigger) return;
  trigger.addEventListener('click', () => openHelp(appId));
}

// ═══════════════════════════════════════════════════════════════
// Ouverture / Fermeture
// ═══════════════════════════════════════════════════════════════
async function openHelp(appId) {
  if (_openPanel) return; // déjà ouvert, ignore
  const content = await loadHelp(appId);
  _openPanel = renderPanel(appId, content);
  document.body.appendChild(_openPanel);
  // Animation d'entrée
  requestAnimationFrame(() => _openPanel.classList.add('is-on'));
  // Esc pour fermer
  _onEscape = (e) => { if (e.key === 'Escape') closeHelp(); };
  document.addEventListener('keydown', _onEscape);
}

function closeHelp() {
  if (!_openPanel) return;
  _openPanel.classList.remove('is-on');
  const toRemove = _openPanel;
  _openPanel = null;
  if (_onEscape) {
    document.removeEventListener('keydown', _onEscape);
    _onEscape = null;
  }
  setTimeout(() => toRemove.remove(), 250);
}

// ── Chargement du contenu JSON avec cache mémoire ─────────────
async function loadHelp(appId) {
  if (_cache.has(appId)) return _cache.get(appId);
  try {
    const res = await fetch(`${HELP_BASE}${appId}.json`, { cache: 'no-cache' });
    if (!res.ok) {
      _cache.set(appId, null);
      return null;
    }
    const data = await res.json();
    _cache.set(appId, data);
    return data;
  } catch {
    _cache.set(appId, null);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Rendu du panneau
// ═══════════════════════════════════════════════════════════════
function renderPanel(appId, content) {
  const panel = document.createElement('div');
  panel.className = 'ws-help-overlay';

  if (!content) {
    panel.innerHTML = `
      <div class="ws-help-backdrop" data-act="help-close"></div>
      <aside class="ws-help-panel" role="dialog" aria-label="Aide">
        <header class="ws-help-head">
          <div class="ws-help-head-text">
            <span class="ws-help-tag">Aide</span>
            <h2>${_escape(appId)}</h2>
          </div>
          <button class="ws-iconbtn" data-act="help-close" title="Fermer (Échap)">${icon('x', 16)}</button>
        </header>
        <div class="ws-help-body">
          <p class="ws-help-empty">L'aide pour cet artefact n'est pas encore disponible. Elle sera ajoutée prochainement.</p>
        </div>
      </aside>
    `;
  } else {
    panel.innerHTML = `
      <div class="ws-help-backdrop" data-act="help-close"></div>
      <aside class="ws-help-panel" role="dialog" aria-label="Aide ${_escape(content.title || appId)}">
        <header class="ws-help-head">
          <div class="ws-help-head-text">
            <span class="ws-help-tag">Aide</span>
            <h2>${_escape(content.title || appId)}</h2>
          </div>
          <button class="ws-iconbtn" data-act="help-close" title="Fermer (Échap)">${icon('x', 16)}</button>
        </header>
        <div class="ws-help-body">
          ${content.tldr ? `<div class="ws-help-tldr">${_escape(content.tldr)}</div>` : ''}
          ${_renderKeyPoints(content.key_points)}
          ${_renderFaq(content.faq)}
          ${_renderShortcuts(content.shortcuts)}
          ${content.updated_at ? `<footer class="ws-help-foot">Mis à jour le ${_escape(content.updated_at)}</footer>` : ''}
        </div>
      </aside>
    `;
  }

  // Délégation de clic pour les boutons close
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="help-close"]')) closeHelp();
  });

  return panel;
}

function _renderKeyPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  return `
    <section class="ws-help-section">
      <h3>Comment ça marche</h3>
      <ol class="ws-help-steps">
        ${points.map(p => `<li>${_escape(p)}</li>`).join('')}
      </ol>
    </section>
  `;
}

function _renderFaq(faq) {
  if (!Array.isArray(faq) || faq.length === 0) return '';
  return `
    <section class="ws-help-section">
      <h3>Questions fréquentes</h3>
      <div class="ws-help-faq">
        ${faq.map(item => `
          <details class="ws-help-faq-item">
            <summary>${_escape(item.q || '')}</summary>
            <div class="ws-help-faq-answer">${_escape(item.a || '')}</div>
          </details>
        `).join('')}
      </div>
    </section>
  `;
}

function _renderShortcuts(shortcuts) {
  if (!Array.isArray(shortcuts) || shortcuts.length === 0) return '';
  return `
    <section class="ws-help-section">
      <h3>Raccourcis clavier</h3>
      <table class="ws-help-shortcuts">
        <tbody>
          ${shortcuts.map(s => `
            <tr>
              <td><kbd>${_escape(s.keys || '')}</kbd></td>
              <td>${_escape(s.desc || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  `;
}

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
