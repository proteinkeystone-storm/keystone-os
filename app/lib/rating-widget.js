/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Rating Widget (workspace) v1.0
   ─────────────────────────────────────────────────────────────
   Widget de notation par étoiles réutilisable, pensé pour les
   topbars des workspaces fullscreen (SDQR, Kodex, et à venir).

   Convention de stockage : localStorage.ks_rating_<appId>
   Valeurs 1-5 ou null (jamais noté). Sync cross-device via le
   pattern cloud-vault existant (prefs.ks_rating_*).

   API :
     ratingButtonHTML(appId, opts)    → string HTML à injecter
     bindRatingButton(rootEl, appId)  → attache les handlers click
                                        au bouton précédemment rendu

   Usage typique :
     // Dans le HTML de ta topbar :
     topbar.innerHTML += ratingButtonHTML('A-COM-002');
     // Une fois le DOM en place :
     bindRatingButton(topbar, 'A-COM-002');
   ═══════════════════════════════════════════════════════════════ */

const LS_PREFIX = 'ks_rating_';

// ── Lecture / écriture en localStorage ─────────────────────────
function _read(appId) {
  const raw = parseInt(localStorage.getItem(LS_PREFIX + appId) || '0', 10);
  return raw >= 1 && raw <= 5 ? raw : 0;
}

function _write(appId, value) {
  if (!value) localStorage.removeItem(LS_PREFIX + appId);
  else        localStorage.setItem(LS_PREFIX + appId, String(value));
  // Sync cross-device via le pattern existant (debounce 1.5s)
  try { import('../vault.js').then(m => m.scheduleAutoSave?.()); } catch (_) {}
  // Émet un event pour que d'autres composants se rafraîchissent
  window.dispatchEvent(new CustomEvent('ks-rating-changed', {
    detail: { appId, value },
  }));
}

// ── SVG étoile (outline 1.5 vs filled) ─────────────────────────
function _starSvg(filled, size = 16) {
  const stroke = filled ? 'var(--ws-accent)' : 'currentColor';
  const fill   = filled ? 'var(--ws-accent)' : 'none';
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24"
         fill="${fill}" stroke="${stroke}" stroke-width="1.5"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polygon points="12 2 15 9 22 9.5 16.5 14.5 18 22 12 18 6 22 7.5 14.5 2 9.5 9 9 12 2"/>
    </svg>
  `;
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════

/**
 * Retourne le HTML du bouton de notation à injecter dans une topbar.
 * Le bouton affiche la note actuelle (★ N/5) ou "Noter" si non noté.
 */
export function ratingButtonHTML(appId) {
  const r = _read(appId);
  const label = r ? `${r}/5` : 'Noter';
  return `
    <div class="ws-rating-wrap" data-rating-app="${appId}">
      <button class="ws-iconbtn ws-rating-trigger" data-act="rating-toggle"
              title="${r ? 'Modifier votre note' : 'Donner votre avis'}">
        ${_starSvg(!!r, 18)}
        <span class="ws-rating-label">${label}</span>
      </button>
      <div class="ws-rating-pop" data-slot="rating-pop" hidden>
        <div class="ws-rating-pop-title">Votre avis sur cet outil</div>
        <div class="ws-rating-stars" data-slot="rating-stars">
          ${[1,2,3,4,5].map(v => `
            <button class="ws-rating-star ${v <= r ? 'is-on' : ''}"
                    data-act="rating-set" data-value="${v}"
                    aria-label="${v} étoile${v > 1 ? 's' : ''}">
              ${_starSvg(v <= r, 22)}
            </button>
          `).join('')}
        </div>
        ${r ? `
          <button class="ws-btn ws-btn--ghost ws-rating-clear"
                  data-act="rating-clear">Annuler ma note</button>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Attache les handlers click au bouton de notation et à sa popover.
 * À appeler après l'injection du HTML dans le DOM.
 */
export function bindRatingButton(rootEl, appId) {
  const wrap = rootEl.querySelector(`.ws-rating-wrap[data-rating-app="${appId}"]`);
  if (!wrap) return;

  const trigger = wrap.querySelector('.ws-rating-trigger');
  const pop     = wrap.querySelector('[data-slot="rating-pop"]');

  // Toggle popover
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });

  // Click sur une étoile → enregistre + re-render local
  wrap.addEventListener('click', e => {
    const setBtn = e.target.closest('[data-act="rating-set"]');
    if (setBtn) {
      e.stopPropagation();
      const v = parseInt(setBtn.dataset.value, 10);
      _write(appId, v);
      _rerender(wrap, appId);
      // Auto-close après 600ms pour feedback visuel
      setTimeout(() => { pop.hidden = true; }, 600);
      return;
    }
    const clrBtn = e.target.closest('[data-act="rating-clear"]');
    if (clrBtn) {
      e.stopPropagation();
      _write(appId, 0);
      _rerender(wrap, appId);
      pop.hidden = true;
    }
  });

  // Click ailleurs → ferme la popover
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) pop.hidden = true;
  });
}

// ── Re-render local après changement ───────────────────────────
function _rerender(wrap, appId) {
  const parent = wrap.parentNode;
  if (!parent) return;
  const fresh = document.createElement('div');
  fresh.innerHTML = ratingButtonHTML(appId).trim();
  const next = fresh.firstElementChild;
  parent.replaceChild(next, wrap);
  bindRatingButton(parent, appId);
}
