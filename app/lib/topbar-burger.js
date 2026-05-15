/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Topbar Burger (narrow viewport)
   ─────────────────────────────────────────────────────────────
   Sur les fenêtres < 1024px, les actions du hero (?, Noter, Save…)
   se cachent derrière un bouton burger ☰ pour éviter les collisions
   avec le contenu de la page. Click sur le burger → dropdown qui
   s'ouvre sous le topbar avec toutes les actions empilées.

   Usage dans un artefact (Pulsa/Kodex/Muse/SDQR) :
     import { burgerHTML, bindBurger } from './lib/topbar-burger.js';
     // 1) injecter le bouton dans la topbar (avant ou à la place
     //    de .ws-topbar-actions / .sdqr-topbar-right)
     ${burgerHTML()}
     // 2) après buildShell, attacher le handler
     bindBurger(_root);
   ═══════════════════════════════════════════════════════════════ */

import { icon } from './ui-icons.js';

export function burgerHTML() {
  return `
    <button class="ws-topbar-burger" data-burger
            type="button" aria-label="Menu actions" aria-expanded="false">
      ${icon('more-horizontal', 22)}
    </button>
  `;
}

export function bindBurger(rootEl) {
  if (!rootEl) return;
  const burger  = rootEl.querySelector('[data-burger]');
  const actions = rootEl.querySelector('.ws-topbar-actions, .sdqr-topbar-right');
  if (!burger || !actions) return;

  const close = () => {
    actions.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    actions.classList.add('is-open');
    burger.setAttribute('aria-expanded', 'true');
  };
  const toggle = () => actions.classList.contains('is-open') ? close() : open();

  burger.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  // Fermer au clic en dehors
  document.addEventListener('click', e => {
    if (!actions.classList.contains('is-open')) return;
    if (actions.contains(e.target) || burger.contains(e.target)) return;
    close();
  });
  // Fermer sur Esc
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && actions.classList.contains('is-open')) close();
  });
  // Si on traverse le breakpoint en agrandissant, on s'assure que c'est fermé
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) close();
  });
}
