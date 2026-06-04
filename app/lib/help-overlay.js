/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Help Overlay (composant partagé v2.0)
   ─────────────────────────────────────────────────────────────
   Notice d'aide en modal centré (gabarit Modal Master : top 5vh,
   hauteur 90 %). Bouton "?" en topbar qui ouvre un panneau en
   4 zones. Réutilisable sur tous les artefacts.

   Layout (desktop) :
       ┌───────────────┬───────────────┐
       │ Présentation  │ Vidéo de démo │   tldr           video
       ├───────────────┼───────────────┤
       │ Comment ça    │ Questions     │   key_points     faq
       │ marche + ⌨    │ fréquentes    │   + shortcuts
       └───────────────┴───────────────┘
   Sur mobile, les 4 zones s'empilent dans cet ordre.

   Conventions :
     - Chaque artefact a son contenu d'aide en JSON dans
       /K_STORE_ASSETS/HELP/{appId}.json
     - Schéma JSON :
         {
           "title":   "Nom de l'artefact",
           "tldr":    "1-2 phrases (zone Présentation)",
           "video":   { "url": "https://…/demo.mp4", "poster": "…" },
           "key_points": ["Étape 1 …", "Étape 2 …"],
           "faq":     [{ "q": "...", "a": "..." }],
           "faq_coming_soon": false,   // optionnel — voir ci-dessous
           "shortcuts": [{ "keys": "Échap", "desc": "..." }],
           "updated_at": "2026-05-14"
         }
     - video absent → placeholder « Démo vidéo bientôt disponible ».
     - faq absent → placeholder « bientôt », SAUF si
       faq_coming_soon === false : la zone FAQ est alors masquée et
       « Comment ça marche » s'étale sur toute la largeur (pour les
       outils qui n'ont structurellement pas de FAQ).
     - Le JSON est édité sans redéploiement (juste push Vercel).
       Phase 2 : video.url pointera un fichier uploadé sur
       Cloudflare R2 depuis l'admin.

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
    const hasFaq = Array.isArray(content.faq) && content.faq.length > 0;
    const faqOmitted = !hasFaq && content.faq_coming_soon === false;
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
          <div class="ws-help-grid${faqOmitted ? ' ws-help-grid--no-faq' : ''}">
            <section class="ws-help-zone ws-help-zone--desc">
              ${_renderDesc(content.tldr)}
            </section>
            <section class="ws-help-zone ws-help-zone--video">
              ${_renderVideo(content.video, content.title || appId)}
            </section>
            <section class="ws-help-zone ws-help-zone--how">
              ${_renderKeyPoints(content.key_points)}
              ${_renderShortcuts(content.shortcuts)}
            </section>
            ${faqOmitted ? '' : `
            <section class="ws-help-zone ws-help-zone--faq">
              ${hasFaq ? _renderFaq(content.faq) : _renderComingSoon('help-circle', 'Questions fréquentes', 'bientôt disponibles')}
            </section>`}
          </div>
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

// ── Zone Présentation (tldr) ──────────────────────────────────
function _renderDesc(tldr) {
  if (!tldr) return _renderComingSoon('file-text', 'Présentation', 'bientôt disponible');
  return `<div class="ws-help-tldr">${_escape(tldr)}</div>`;
}

// ── Zone Vidéo de démo ────────────────────────────────────────
// `video` accepte une string (URL) ou un objet { url, poster }.
// Absent → placeholder. Phase 2 : url = fichier uploadé sur R2.
function _renderVideo(video, title) {
  const url = (video && typeof video === 'object') ? (video.url || '')
            : (typeof video === 'string' ? video : '');
  if (url) {
    const poster = (video && typeof video === 'object' && video.poster)
      ? ` poster="${_escape(video.poster)}"` : '';
    return `
      <div class="ws-help-video">
        <video controls preload="metadata"${poster}
               aria-label="Vidéo de démonstration — ${_escape(title)}">
          <source src="${_escape(url)}">
          Votre navigateur ne peut pas lire cette vidéo.
        </video>
      </div>`;
  }
  return `
    <div class="ws-help-video ws-help-video--empty">
      ${icon('film', 30)}
      <span class="ws-help-ph-label">Démo vidéo</span>
      <span class="ws-help-ph-sub">bientôt disponible</span>
    </div>`;
}

// ── Placeholder « bientôt » d'une zone vide ───────────────────
function _renderComingSoon(iconName, label, sub) {
  return `
    <div class="ws-help-zone-ph">
      ${icon(iconName, 26)}
      <span class="ws-help-ph-label">${_escape(label)}</span>
      <span class="ws-help-ph-sub">${_escape(sub)}</span>
    </div>`;
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
