/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Modales du mode démo limité (Sprint Démo A+B)
   ───────────────────────────────────────────────────────────────
   Trois écrans :
     1. showDemoUpsellModal  — l'user tente d'ajouter une 2e app
     2. showDemoExpiredModal — la démo a expiré (7 jours écoulés)
     3. showDemoNudgeToast   — nudge discret à J-3, J-2, J-1

   Style : modal centrée Apple Premium (cohérent avec les modales
   K-Store existantes — fond #0a0e14, accent doré, font-weight 600).
   Tous les composants sont injectés dans <body> à la demande, sans
   pollution du DOM permanent.
   ═══════════════════════════════════════════════════════════════ */

import {
  getDemoState, switchDemoApp, canSwitchDemoApp,
  DEMO_DURATION_DAYS,
} from './demo-mode.js';

// URL de la page de pricing (Stripe ou interne)
// En attente de S5 — pour l'instant on pointe sur /admin (où l'user peut
// soit entrer une clé, soit être redirigé vers Stripe à terme).
const PLANS_URL  = '/admin';
const ACTIVATE_URL = '/admin';

// ═══════════════════════════════════════════════════════════════
// Modale Upsell : "Tu testes déjà X, choisis un plan ou switche"
// ───────────────────────────────────────────────────────────────
// Affichée quand l'user clique "Activer" sur une 2e app en démo.
// Options :
//   - Switcher (si pas de cooldown)
//   - Voir les plans
//   - Annuler
// ═══════════════════════════════════════════════════════════════
export function showDemoUpsellModal({ blockingAppLabel, targetAppLabel, onSwitch, onCancel } = {}) {
  // Nettoyer une éventuelle modale précédente
  document.querySelectorAll('.ks-demo-modal-backdrop').forEach(el => el.remove());

  const state = getDemoState();
  const canSwitch = canSwitchDemoApp();
  const cooldownH = state.switchCooldownH;

  const backdrop = document.createElement('div');
  backdrop.className = 'ks-demo-modal-backdrop ks-demo-modal-upsell';
  backdrop.innerHTML = `
    <div class="ks-demo-modal" role="dialog" aria-modal="true" aria-labelledby="ks-demo-upsell-title">
      <div class="ks-demo-modal-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="M4.93 4.93l2.83 2.83" />
          <path d="M16.24 16.24l2.83 2.83" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <path d="M4.93 19.07l2.83-2.83" />
          <path d="M16.24 7.76l2.83-2.83" />
        </svg>
      </div>
      <h2 id="ks-demo-upsell-title" class="ks-demo-modal-title">
        Tu testes déjà&nbsp;<span class="ks-demo-modal-accent">${_escape(blockingAppLabel || 'une app')}</span>
      </h2>
      <p class="ks-demo-modal-sub">
        En mode démo, tu peux activer <strong>1 seule app à la fois</strong>.
        Pour ajouter <strong>${_escape(targetAppLabel || 'cette app')}</strong>, deux options&nbsp;:
      </p>
      <div class="ks-demo-modal-actions">
        ${canSwitch ? `
          <button class="ks-demo-btn ks-demo-btn-secondary" data-act="switch">
            Switcher pour&nbsp;${_escape(targetAppLabel || 'cette app')}
            <span class="ks-demo-btn-hint">(1 changement par 24h)</span>
          </button>
        ` : `
          <button class="ks-demo-btn ks-demo-btn-secondary" disabled>
            Switch indisponible
            <span class="ks-demo-btn-hint">(prochain dans ~${cooldownH}h)</span>
          </button>
        `}
        <a class="ks-demo-btn ks-demo-btn-primary" href="${PLANS_URL}">
          Choisir un plan
          <span class="ks-demo-btn-hint">débloque toutes les apps</span>
        </a>
      </div>
      <button class="ks-demo-modal-close" data-act="close" aria-label="Fermer">×</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  const close = () => {
    backdrop.remove();
    document.body.style.overflow = '';
    if (onCancel) onCancel();
  };

  backdrop.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'switch') {
      if (onSwitch) onSwitch();
      backdrop.remove();
      document.body.style.overflow = '';
    } else if (act === 'close' || e.target === backdrop) {
      close();
    }
  });

  // ESC ferme
  const escHandler = (e) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
}

// ═══════════════════════════════════════════════════════════════
// Modale Expired : "Ta démo a expiré"
// ───────────────────────────────────────────────────────────────
// Plein écran (overlay opaque). Pas de close — l'user DOIT choisir
// une action (sinon il reste bloqué sur cet écran).
// Actions :
//   - Activer ma clé (s'il vient d'acheter)
//   - Voir les plans (CTA principal)
//   - Lien support (tertiaire)
// ═══════════════════════════════════════════════════════════════
export function showDemoExpiredModal() {
  // Si déjà affichée, ne pas en empiler une 2e
  if (document.querySelector('.ks-demo-modal-expired')) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'ks-demo-modal-backdrop ks-demo-modal-expired';
  backdrop.innerHTML = `
    <div class="ks-demo-modal ks-demo-modal-fullscreen" role="dialog" aria-modal="true" aria-labelledby="ks-demo-expired-title">
      <div class="ks-demo-modal-icon ks-demo-modal-icon--expired" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="16" cy="16" r="13" />
          <path d="M16 8v8l5 3" />
        </svg>
      </div>
      <h1 id="ks-demo-expired-title" class="ks-demo-modal-title ks-demo-modal-title--big">
        Ta démo de Keystone OS a expiré
      </h1>
      <p class="ks-demo-modal-sub">
        Tu as profité de <strong>${DEMO_DURATION_DAYS} jours</strong> d'essai gratuit. Pour continuer à utiliser tes outils et conserver tes données, choisis un plan ou active ta clé.
      </p>
      <div class="ks-demo-modal-actions ks-demo-modal-actions--column">
        <a class="ks-demo-btn ks-demo-btn-primary ks-demo-btn-large" href="${PLANS_URL}">
          Choisir un plan d'abonnement
        </a>
        <a class="ks-demo-btn ks-demo-btn-secondary" href="${ACTIVATE_URL}">
          J'ai déjà une clé d'activation
        </a>
        <a class="ks-demo-btn ks-demo-btn-tertiary" href="mailto:protein.keystone@gmail.com?subject=Question%20-%20Fin%20de%20d%C3%A9mo%20Keystone%20OS">
          Contacter le support
        </a>
      </div>
      <p class="ks-demo-modal-footnote">
        Tes données restent sauvegardées 30 jours. Tu retrouveras tes formulaires Pulsa,
        briefs Kodex et QR codes dès l'activation.
      </p>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  // Pas de close button — l'user DOIT cliquer une action.
}

// ═══════════════════════════════════════════════════════════════
// Toast Nudge : "Plus que X jours"
// ───────────────────────────────────────────────────────────────
// Affichage discret en bas-droite, autodismiss 8s, 1 fois par jour.
// ═══════════════════════════════════════════════════════════════
const NUDGE_LAST_SHOWN_KEY = 'ks_demo_nudge_shown_at';

export function maybeShowDemoNudge() {
  const state = getDemoState();
  if (!state.isDemo || state.expired) return;

  // Nudge seulement les 3 derniers jours (J-3, J-2, J-1)
  if (state.daysLeft > 3) return;
  if (state.daysLeft <= 0) return; // J0 c'est la modale expired qui s'affiche

  // 1 nudge par jour
  const lastShown = localStorage.getItem(NUDGE_LAST_SHOWN_KEY);
  const today = new Date().toISOString().slice(0, 10);
  if (lastShown === today) return;

  localStorage.setItem(NUDGE_LAST_SHOWN_KEY, today);

  const toast = document.createElement('div');
  toast.className = 'ks-demo-nudge';
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <div class="ks-demo-nudge-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    </div>
    <div class="ks-demo-nudge-text">
      <strong>Plus que ${state.daysLeft} jour${state.daysLeft > 1 ? 's' : ''}</strong>
      <span>avant la fin de ta démo. Découvre les plans.</span>
    </div>
    <a class="ks-demo-nudge-cta" href="${PLANS_URL}">Voir →</a>
    <button class="ks-demo-nudge-close" aria-label="Fermer">×</button>
  `;

  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('ks-demo-nudge--visible'), 50);

  const closeBtn = toast.querySelector('.ks-demo-nudge-close');
  closeBtn.addEventListener('click', () => toast.remove());

  // Auto-dismiss après 8 s
  setTimeout(() => {
    toast.classList.remove('ks-demo-nudge--visible');
    setTimeout(() => toast.remove(), 320);
  }, 8000);
}

// ─── Utils ────────────────────────────────────────────────────
function _escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ═══════════════════════════════════════════════════════════════
// CSS injectable (ou à coller dans style.css)
// ═══════════════════════════════════════════════════════════════
export const DEMO_MODAL_CSS = `
/* ── Backdrop commun ────────────────────────────────────────── */
.ks-demo-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 14, 20, 0.82);
  backdrop-filter: blur(8px) saturate(120%);
  -webkit-backdrop-filter: blur(8px) saturate(120%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 9999;
  animation: ks-demo-fade-in 220ms ease;
}
@keyframes ks-demo-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── Card principale ────────────────────────────────────────── */
.ks-demo-modal {
  position: relative;
  background: #111720;
  border: 1px solid #1f2a37;
  border-radius: 16px;
  padding: 40px 32px 32px;
  max-width: 480px;
  width: 100%;
  text-align: center;
  color: #f1f5f9;
  box-shadow: 0 32px 80px rgba(0,0,0,0.4);
  animation: ks-demo-zoom-in 240ms cubic-bezier(0.18, 0.8, 0.3, 1);
}
.ks-demo-modal-fullscreen {
  max-width: 560px;
  padding: 56px 40px 40px;
}
@keyframes ks-demo-zoom-in {
  from { transform: scale(0.94); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

.ks-demo-modal-icon {
  color: var(--accent, #c9a96e);
  margin-bottom: 16px;
  display: inline-flex;
}
.ks-demo-modal-icon--expired {
  color: #f59e0b;
  animation: ks-demo-chrono-pulse 2.4s ease-in-out infinite;
}

.ks-demo-modal-title {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.02em;
  margin: 0 0 12px;
}
.ks-demo-modal-title--big {
  font-size: 28px;
  font-weight: 700;
}
.ks-demo-modal-accent {
  color: var(--accent, #c9a96e);
}

.ks-demo-modal-sub {
  color: #94a3b8;
  font-size: 15px;
  line-height: 1.55;
  margin: 0 0 24px;
}

.ks-demo-modal-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 8px;
}
.ks-demo-modal-actions--column { gap: 12px; }

.ks-demo-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 20px;
  border-radius: 10px;
  border: 1px solid #1f2a37;
  background: #0a0e14;
  color: #f1f5f9;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  text-decoration: none;
  transition: background 180ms ease, border-color 180ms ease, transform 100ms ease;
}
.ks-demo-btn:hover:not([disabled]) { background: #1a2330; border-color: #2a3a4a; }
.ks-demo-btn:active:not([disabled]) { transform: scale(0.99); }
.ks-demo-btn[disabled] { opacity: 0.5; cursor: not-allowed; }

.ks-demo-btn-primary {
  background: var(--accent, #c9a96e);
  color: #0a0e14;
  border-color: var(--accent, #c9a96e);
}
.ks-demo-btn-primary:hover:not([disabled]) {
  background: color-mix(in srgb, var(--accent, #c9a96e) 88%, white);
}
.ks-demo-btn-large {
  padding: 18px 24px;
  font-size: 16px;
}
.ks-demo-btn-secondary {
  background: transparent;
  color: #f1f5f9;
}
.ks-demo-btn-tertiary {
  background: transparent;
  color: #64748b;
  border-color: transparent;
  font-weight: 500;
  font-size: 14px;
}
.ks-demo-btn-tertiary:hover:not([disabled]) {
  background: transparent;
  color: #94a3b8;
}
.ks-demo-btn-hint {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.7;
  margin-top: 2px;
}

.ks-demo-modal-close {
  position: absolute;
  top: 12px; right: 12px;
  width: 32px; height: 32px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  border-radius: 8px;
  transition: background 160ms ease, color 160ms ease;
}
.ks-demo-modal-close:hover { background: #1f2a37; color: #f1f5f9; }

.ks-demo-modal-footnote {
  margin: 24px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.55;
}

/* ── Nudge toast ─────────────────────────────────────────────── */
.ks-demo-nudge {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9998;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #111720;
  border: 1px solid var(--accent, #c9a96e);
  border-radius: 12px;
  color: #f1f5f9;
  max-width: 360px;
  box-shadow: 0 12px 28px rgba(0,0,0,0.3);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 280ms ease, transform 280ms ease;
}
.ks-demo-nudge--visible {
  opacity: 1;
  transform: translateY(0);
}
.ks-demo-nudge-icon {
  color: var(--accent, #c9a96e);
  flex: 0 0 auto;
}
.ks-demo-nudge-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  font-size: 13px;
  line-height: 1.4;
}
.ks-demo-nudge-text strong { color: #f1f5f9; font-weight: 600; }
.ks-demo-nudge-text span { color: #94a3b8; }
.ks-demo-nudge-cta {
  color: var(--accent, #c9a96e);
  font-weight: 600;
  font-size: 13px;
  text-decoration: none;
  padding: 6px 10px;
  border-radius: 6px;
  transition: background 160ms ease;
}
.ks-demo-nudge-cta:hover { background: color-mix(in srgb, var(--accent, #c9a96e) 14%, transparent); }
.ks-demo-nudge-close {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  line-height: 1;
}
.ks-demo-nudge-close:hover { background: #1f2a37; color: #f1f5f9; }

/* Responsive : mobile */
@media (max-width: 540px) {
  .ks-demo-modal { padding: 32px 20px 24px; }
  .ks-demo-modal-fullscreen { padding: 48px 24px 32px; }
  .ks-demo-modal-title { font-size: 20px; }
  .ks-demo-modal-title--big { font-size: 24px; }
  .ks-demo-nudge {
    bottom: 12px; right: 12px; left: 12px;
    max-width: none;
  }
}
`;
