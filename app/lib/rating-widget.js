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
const API_BASE  = 'https://keystone-os-api.keystone-os.workers.dev';

// ── Remontée serveur (agrégat Admin « Satisfaction ») ──────────
// Fire-and-forget : ne bloque JAMAIS l'UI, n'affiche jamais d'erreur. La note
// reste de toute façon en localStorage (état visuel) ; ceci ajoute juste
// l'agrégat côté Admin. keepalive:true → survit si l'utilisateur navigue
// juste après (clic étoile puis retour dashboard via le logo = reload).
function _pushRating(appId, value) {
  try {
    const jwt = localStorage.getItem('ks_jwt') || '';
    if (!jwt) return;                 // pas connecté → pas de remontée
    fetch(`${API_BASE}/api/ratings`, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
      body:      JSON.stringify({ app_id: appId, value: value || 0 }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) { /* jamais bloquant */ }
}

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
  // Remontée serveur pour l'agrégat Admin (note 1-5, ou 0 = retirée).
  _pushRating(appId, value);
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
      // Entonnoir d'avis : une note haute (4-5★) → invitation à laisser un
      // avis PUBLIC sur /avis. Une seule fois par appareil (jamais relancer).
      if (v >= 4) setTimeout(() => _inviteToReview(), 800);
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

// ── Entonnoir d'avis public ────────────────────────────────────
// Affiche un toast discret invitant à laisser un avis sur /avis, après une
// note haute. Anti-nag : une seule fois par appareil (localStorage). Aucun
// emoji (charte) — picto outline inline cohérent avec le reste du widget.
const _INVITED_KEY = 'ks_avis_invited';
function _inviteToReview() {
  try {
    if (localStorage.getItem(_INVITED_KEY)) return;   // déjà invité → jamais relancer
    localStorage.setItem(_INVITED_KEY, '1');
  } catch (_) { return; }
  if (document.getElementById('ks-avis-toast')) return;

  if (!document.getElementById('ks-avis-toast-css')) {
    const st = document.createElement('style');
    st.id = 'ks-avis-toast-css';
    st.textContent = `
      #ks-avis-toast{position:fixed;right:20px;bottom:20px;z-index:99999;max-width:340px;
        background:rgba(15,23,42,.96);backdrop-filter:blur(12px);border:1px solid rgba(129,140,248,.34);
        border-radius:16px;padding:16px 18px;box-shadow:0 18px 50px -12px rgba(0,0,0,.6);
        color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter",sans-serif;
        letter-spacing:-.02em;animation:ksAvisIn .35s cubic-bezier(.16,1,.3,1)}
      @keyframes ksAvisIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
      #ks-avis-toast .row{display:flex;align-items:flex-start;gap:11px}
      #ks-avis-toast .ic{flex-shrink:0;width:32px;height:32px;border-radius:9px;display:flex;align-items:center;
        justify-content:center;background:rgba(99,102,241,.16);border:1px solid rgba(129,140,248,.34);color:#a5b4fc}
      #ks-avis-toast .ic svg{width:18px;height:18px}
      #ks-avis-toast p{font-size:13.5px;line-height:1.5;color:rgba(248,250,252,.72);margin:0 0 12px}
      #ks-avis-toast strong{color:#fff;font-weight:600}
      #ks-avis-toast .acts{display:flex;gap:8px}
      #ks-avis-toast a.go{font-size:13px;font-weight:600;text-decoration:none;color:#fff;padding:9px 15px;border-radius:999px;
        background:linear-gradient(120deg,#6366f1,#818cf8);box-shadow:0 6px 18px rgba(99,102,241,.34)}
      #ks-avis-toast button.no{font-size:13px;font-weight:600;color:rgba(248,250,252,.55);background:none;border:none;cursor:pointer;padding:9px 10px}
      @media(max-width:520px){#ks-avis-toast{left:16px;right:16px;max-width:none}}`;
    document.head.appendChild(st);
  }

  const toast = document.createElement('div');
  toast.id = 'ks-avis-toast';
  toast.setAttribute('role', 'dialog');
  toast.innerHTML = `
    <div class="row">
      <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></span>
      <div>
        <p>Ravi que ça vous plaise&nbsp;! <strong>Un avis public</strong> nous aiderait beaucoup — deux minutes.</p>
        <div class="acts">
          <a class="go" href="/avis" target="_blank" rel="noopener">Laisser un avis</a>
          <button class="no" type="button" data-close>Plus tard</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(toast);
  const close = () => { toast.style.transition = 'opacity .25s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 250); };
  toast.querySelector('[data-close]').addEventListener('click', close);
  toast.querySelector('a.go').addEventListener('click', close);
  setTimeout(close, 14000);
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
