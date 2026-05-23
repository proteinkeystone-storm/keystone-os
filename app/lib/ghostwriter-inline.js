/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Ghost Writer Inline (Phase 3, 2026-05-23 soir)
   ─────────────────────────────────────────────────────────────
   "Ghost Writer invisible" — déclenche un appel Gemma 4 et affiche
   le carousel des 3 variantes DIRECTEMENT sous le textarea du pad,
   sans ouvrir le modal fullscreen.

   Pourquoi ce composant ?
   ─────────────────────────────────────────────────────────────
   Feedback Stéphane 2026-05-23 : "rester dans Annonces Immo pour
   avoir les 3 réponses. Ghost Writer agirait de manière invisible."

   Le modal léger (ghostwriter.js) reste utile pour le raccourci
   Cmd+Shift+G hors-pad (cas service système). Ici on a un mode
   contextualisé pour les pads — pas de modal, juste un panneau
   qui pousse sous le textarea.

   Doctrine "Contenant / Contenu" :
   ─────────────────────────────────────────────────────────────
   - Réutilise rewriteText() + friendlyGhostwriterError() de
     ghostwriter.js (source unique du backend call + cache quota).
   - Aucune logique métier — purement composant UI.
   - Cumule texte saisi + contexte formulaire (intent enrichi) pour
     que Gemma 4 réécrive en intégrant les données du pad sans les
     écraser.
   ═══════════════════════════════════════════════════════════════ */

import {
  rewriteText,
  friendlyGhostwriterError,
  refreshGhostwriterQuota,
  getGhostwriterQuotaRemaining,
  getGhostwriterQuotaMax,
  getGhostwriterPlan,
} from '../ghostwriter.js';

const CSS_INJECTED_FLAG = '__ks_gw_inline_css_injected__';

// ── CSS (injecté au premier open) ────────────────────────────────
function _injectCSS() {
  if (window[CSS_INJECTED_FLAG]) return;
  window[CSS_INJECTED_FLAG] = true;
  const css = `
.gw-inline {
  margin-top: 10px;
  padding: 14px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(168, 130, 255, 0.07), rgba(220, 110, 200, 0.06));
  border: 1px solid rgba(168, 130, 255, 0.25);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif;
  display: flex; flex-direction: column; gap: 10px;
}
.gw-inline-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; min-height: 22px;
}
.gw-inline-title {
  font-size: 12px; font-weight: 700; letter-spacing: -0.01em;
  color: rgba(220, 200, 255, 0.95);
  display: inline-flex; align-items: center; gap: 7px;
}
.gw-inline-quota {
  font-size: 11px; color: rgba(180, 170, 200, 0.7); margin-left: 8px;
}
.gw-inline-close {
  background: transparent; border: 0; color: rgba(180, 170, 200, 0.6);
  font-size: 18px; line-height: 1; cursor: pointer; padding: 0 6px;
  border-radius: 6px; transition: all 0.15s ease;
}
.gw-inline-close:hover { color: #fff; background: rgba(255,255,255,0.06); }
.gw-inline-loading {
  display: flex; align-items: center; gap: 10px; padding: 10px 4px;
  color: rgba(200, 190, 220, 0.85); font-size: 12.5px;
}
.gw-inline-spin {
  width: 14px; height: 14px;
  border: 2px solid rgba(168, 130, 255, 0.25);
  border-top-color: rgba(220, 180, 255, 0.95);
  border-radius: 50%;
  animation: gw-inline-spin 0.8s linear infinite;
}
@keyframes gw-inline-spin { to { transform: rotate(360deg); } }
.gw-inline-error {
  padding: 10px 12px; border-radius: 8px;
  background: rgba(255, 90, 90, 0.08);
  border: 1px solid rgba(255, 90, 90, 0.3);
  color: rgba(255, 170, 170, 0.95);
  font-size: 12.5px; line-height: 1.5;
}
.gw-inline-carousel {
  position: relative;
  display: grid; grid-template-columns: 26px 1fr 26px;
  gap: 6px;
  min-height: 110px;
}
.gw-inline-slides {
  position: relative; overflow: hidden;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 0;
}
.gw-inline-slide {
  position: absolute; inset: 0;
  padding: 11px 13px;
  opacity: 0; transform: translateX(6px);
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  overflow-y: auto;
  pointer-events: none;
}
.gw-inline-slide.is-active { opacity: 1; transform: translateX(0); pointer-events: auto; }
.gw-inline-slide-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  color: rgba(200, 170, 255, 0.85); font-weight: 700; margin-bottom: 6px;
}
.gw-inline-slide-text {
  color: rgba(235, 230, 245, 0.95);
  font-size: 12.5px; line-height: 1.55;
  white-space: pre-wrap; word-wrap: break-word;
}
.gw-inline-nav {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(180, 170, 200, 0.7);
  border-radius: 6px;
  font-size: 16px; line-height: 1; cursor: pointer;
  transition: all 0.15s ease;
}
.gw-inline-nav:hover { background: rgba(168, 130, 255, 0.16); color: #fff; border-color: rgba(168, 130, 255, 0.4); }
.gw-inline-bottom {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.gw-inline-indicators { display: inline-flex; gap: 5px; }
.gw-inline-indicator {
  min-width: 24px; height: 24px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(180, 170, 200, 0.7);
  font-size: 11px; font-weight: 700; cursor: pointer;
  transition: all 0.14s ease;
}
.gw-inline-indicator.is-active {
  background: rgba(168, 130, 255, 0.2);
  border-color: rgba(168, 130, 255, 0.5);
  color: #fff;
}
.gw-inline-indicator:hover:not(.is-active) { background: rgba(255, 255, 255, 0.07); }
.gw-inline-actions { display: inline-flex; gap: 6px; margin-left: auto; }
.gw-inline-action {
  padding: 6px 12px; border-radius: 7px;
  font-size: 11.5px; font-weight: 600; cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.gw-inline-action-use {
  background: linear-gradient(135deg, rgba(168, 130, 255, 0.25), rgba(220, 110, 200, 0.25));
  border: 1px solid rgba(168, 130, 255, 0.5);
  color: #fff;
}
.gw-inline-action-use:hover { background: linear-gradient(135deg, rgba(168, 130, 255, 0.4), rgba(220, 110, 200, 0.4)); }
.gw-inline-action-regen,
.gw-inline-action-copy {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(220, 220, 230, 0.9);
}
.gw-inline-action-regen:hover,
.gw-inline-action-copy:hover { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.2); }

/* Mode clair */
html.light-mode .gw-inline {
  background: linear-gradient(135deg, rgba(140, 100, 220, 0.04), rgba(200, 90, 180, 0.04));
  border-color: rgba(140, 100, 220, 0.25);
}
html.light-mode .gw-inline-title { color: rgba(90, 50, 160, 0.95); }
html.light-mode .gw-inline-slides { background: rgba(255, 255, 255, 0.5); border-color: rgba(0, 0, 0, 0.08); }
html.light-mode .gw-inline-slide-text { color: rgba(40, 30, 60, 0.92); }
html.light-mode .gw-inline-slide-label { color: rgba(110, 70, 180, 0.85); }
  `;
  const style = document.createElement('style');
  style.id = 'ks-gw-inline-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ── Compose un résumé textuel du contexte formulaire ──────────────
// formContext est typé { fieldId: { label, value } } depuis ui-renderer.
function _composeContextSummary(formContext) {
  if (!formContext) return '';
  const parts = [];
  for (const entry of Object.values(formContext)) {
    if (entry && entry.value) parts.push(`${entry.label} : ${entry.value}`);
  }
  return parts.join(' — ');
}

// ── Génère le label du chip quota pour le header ─────────────────
function _quotaChip() {
  const r = getGhostwriterQuotaRemaining();
  const m = getGhostwriterQuotaMax();
  const p = getGhostwriterPlan();
  if (r === Infinity) return '∞ / jour · ADMIN';
  if (r == null || m == null) return '';
  return `${r}/${m} aujourd'hui${p ? ` · ${p}` : ''}`;
}

// ── Build du panneau inline (shell) ──────────────────────────────
function _buildPanel(quotaLabel) {
  const panel = document.createElement('div');
  panel.className = 'gw-inline';
  panel.innerHTML = `
    <div class="gw-inline-head">
      <span class="gw-inline-title">
        ✦ Ghost Writer
        <span class="gw-inline-quota">${quotaLabel}</span>
      </span>
      <button class="gw-inline-close" aria-label="Fermer">×</button>
    </div>
    <div class="gw-inline-body">
      <div class="gw-inline-loading">
        <span class="gw-inline-spin"></span>
        <span>Génération de 3 variantes — Gemma 4…</span>
      </div>
    </div>
  `;
  return panel;
}

// ── Render des variantes en carousel inline ──────────────────────
function _renderCarousel(body, variants, targetEl, regenCb) {
  const slidesHTML = variants.map((v, i) => `
    <article class="gw-inline-slide${i === 0 ? ' is-active' : ''}" data-idx="${i}">
      <div class="gw-inline-slide-label">${_escapeHtml(v.label || `Variante ${i + 1}`)}</div>
      <div class="gw-inline-slide-text">${_escapeHtml(v.text)}</div>
    </article>
  `).join('');

  const indicatorsHTML = variants.map((_, i) => `
    <button class="gw-inline-indicator${i === 0 ? ' is-active' : ''}" data-idx="${i}"
            aria-label="Variante ${i + 1}">${i + 1}</button>
  `).join('');

  body.innerHTML = `
    <div class="gw-inline-carousel" data-active="0">
      <button class="gw-inline-nav" data-dir="-1" aria-label="Précédent">‹</button>
      <div class="gw-inline-slides">${slidesHTML}</div>
      <button class="gw-inline-nav" data-dir="1" aria-label="Suivant">›</button>
    </div>
    <div class="gw-inline-bottom">
      <div class="gw-inline-indicators">${indicatorsHTML}</div>
      <div class="gw-inline-actions">
        <button class="gw-inline-action gw-inline-action-copy">Copier</button>
        <button class="gw-inline-action gw-inline-action-regen">↻ Régénérer</button>
        <button class="gw-inline-action gw-inline-action-use">Utiliser cette variante</button>
      </div>
    </div>
  `;

  const carousel    = body.querySelector('.gw-inline-carousel');
  const slides      = body.querySelectorAll('.gw-inline-slide');
  const indicators  = body.querySelectorAll('.gw-inline-indicator');
  const copyBtn     = body.querySelector('.gw-inline-action-copy');
  const regenBtn    = body.querySelector('.gw-inline-action-regen');
  const useBtn      = body.querySelector('.gw-inline-action-use');

  const activeIdx = () => parseInt(carousel.dataset.active, 10) || 0;
  function goTo(idx) {
    const n = variants.length;
    idx = ((idx % n) + n) % n;
    carousel.dataset.active = idx;
    slides.forEach((el, i)     => el.classList.toggle('is-active', i === idx));
    indicators.forEach((el, i) => el.classList.toggle('is-active', i === idx));
  }

  indicators.forEach(b => b.addEventListener('click', () => goTo(parseInt(b.dataset.idx, 10))));
  body.querySelectorAll('.gw-inline-nav').forEach(b => {
    b.addEventListener('click', () => goTo(activeIdx() + parseInt(b.dataset.dir, 10)));
  });

  copyBtn.addEventListener('click', () => {
    const text = variants[activeIdx()]?.text || '';
    navigator.clipboard?.writeText(text)?.then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓ Copié';
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    });
  });

  useBtn.addEventListener('click', () => {
    if (!targetEl) return;
    targetEl.value = variants[activeIdx()]?.text || '';
    targetEl.focus();
    targetEl.dispatchEvent(new Event('input',  { bubbles: true }));
    targetEl.dispatchEvent(new Event('change', { bubbles: true }));
    // Ferme le panneau après "Utiliser" — le user a fait son choix
    const panel = body.closest('.gw-inline');
    if (panel) {
      panel.style.opacity = '0.5';
      setTimeout(() => panel.remove(), 200);
    }
  });

  regenBtn.addEventListener('click', () => {
    if (typeof regenCb === 'function') regenCb();
  });
}

function _renderError(body, message) {
  body.innerHTML = `<div class="gw-inline-error">✗ ${_escapeHtml(message)}</div>`;
}

function _escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── API publique ─────────────────────────────────────────────────

/**
 * Ouvre le panneau Ghost Writer inline sous le textarea cible.
 * Génération automatique au mount (pas de bouton "Générer") :
 * "Ghost Writer invisible" — un clic du bouton ✦ dans le pad
 * déclenche directement l'appel.
 *
 * @param {HTMLElement} targetEl   Textarea / input à remplir
 * @param {object}      opts       {mode, audience, action, tone,
 *                                 lengthTarget, context, formContext,
 *                                 intent?, label?, include_fields?}
 *
 * Cumul (Phase 3, retour Stéphane 2026-05-23) :
 *   - Texte source = valeur actuelle du textarea (s'il y a)
 *     OU contexte formulaire si vide
 *   - intent enrichi = "Contexte du bien : Type T3 — Surface 78m² —
 *     Prix 385000€ — Pinel" (TOUJOURS si formContext fourni, même
 *     si le texte est déjà saisi). Gemma 4 reformule sans écraser
 *     le contexte.
 */
export async function openGhostwriterInline(targetEl, opts = {}) {
  if (!targetEl) return;
  _injectCSS();

  // Active le flag si pas encore (bouton visible = intent clair).
  try {
    if (localStorage.getItem('ks_ghostwriter') !== '1') {
      localStorage.setItem('ks_ghostwriter', '1');
    }
  } catch (_) {}

  // Ferme tout panneau existant pour éviter les doublons
  const existing = document.querySelector('.gw-inline');
  if (existing) existing.remove();

  // Refresh quota AVANT d'afficher pour avoir le bon chip
  await refreshGhostwriterQuota().catch(() => {});

  const panel = _buildPanel(_quotaChip());
  targetEl.insertAdjacentElement('afterend', panel);
  const body = panel.querySelector('.gw-inline-body');
  panel.querySelector('.gw-inline-close')?.addEventListener('click', () => panel.remove());

  // Fonction de génération (réutilisable pour Régénérer)
  async function generate() {
    body.innerHTML = `
      <div class="gw-inline-loading">
        <span class="gw-inline-spin"></span>
        <span>Génération de 3 variantes — Gemma 4…</span>
      </div>
    `;

    // Compose texte source + intent enrichi
    const currentText = (targetEl.value || '').trim();
    const contextSummary = _composeContextSummary(opts.formContext);

    // Cumul : texte saisi gagne si présent, sinon contexte = source.
    // Le contexte enrichit TOUJOURS l'intent pour que Gemma 4 le voie.
    const sourceText = currentText || contextSummary;

    const intentParts = [];
    if (contextSummary) intentParts.push(`Contexte du bien : ${contextSummary}`);
    if (opts.intent)    intentParts.push(opts.intent);
    if (currentText && contextSummary) {
      intentParts.push('Intégrer ces informations dans la reformulation sans dénaturer les atouts saisis.');
    }
    const finalIntent = intentParts.join(' — ') || null;

    const callOpts = {
      tone        : opts.tone        || null,
      mode        : opts.mode        || null,
      audience    : opts.audience    || null,
      action      : opts.action      || null,
      lengthTarget: opts.lengthTarget || null,
      intent      : finalIntent,
    };

    try {
      const result = await rewriteText(sourceText, callOpts);
      // Refresh chip quota après succès
      panel.querySelector('.gw-inline-quota').textContent = _quotaChip();
      _renderCarousel(body, result.variants || [], targetEl, generate);
    } catch (e) {
      _renderError(body, friendlyGhostwriterError(e));
      // Refresh chip aussi en cas d'erreur (429 resync le cache)
      panel.querySelector('.gw-inline-quota').textContent = _quotaChip();
    }
  }

  // Lance la génération immédiatement
  generate();
}
