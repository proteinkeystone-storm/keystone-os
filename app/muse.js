/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Brainstorming (A-COM-003)
   Stub Sprint 0 · transition Muse v1 → AI War Room

   Le code Muse v1 (moodboard studio 3D) est archivé sous
   app/_legacy/muse-v1/. Le workspace AI War Room sera livré
   au Sprint 1 (squelette UI + Strategic Lead solo).

   Ce stub :
   - préserve l'import openMuse() utilisé par ui-renderer.js
     (pour ne pas casser le boot tant que Sprint 1 n'est pas livré)
   - affiche un placeholder Apple Premium minimal annonçant la refonte
   - détecte un brouillon Muse v1 résiduel (ks_muse_draft_v2) et
     en informe l'utilisateur (30 jours de grace, accessible via
     un Settings → Export que la roadmap Sprint 8 introduira)

   Une fois Sprint 1 livré, ce stub sera remplacé par le vrai
   workspace AI War Room (export { openWarRoom as openMuse }).
   ═══════════════════════════════════════════════════════════════ */

const LEGACY_DRAFT_KEY = 'ks_muse_draft_v2';

export function openMuse() {
  const hasLegacyDraft = !!localStorage.getItem(LEGACY_DRAFT_KEY);

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(10,10,12,0.96)',
    'backdrop-filter:blur(20px)',
    '-webkit-backdrop-filter:blur(20px)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:40px', 'animation:warRoomFadeIn 0.35s ease both',
  ].join(';');

  overlay.innerHTML = `
    <style>
      @keyframes warRoomFadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
      @keyframes warRoomPulse  { 0%,100% { opacity:0.4 } 50% { opacity:1 } }
    </style>
    <div style="max-width:540px;text-align:center;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif">
      <div style="display:flex;justify-content:center;gap:6px;margin-bottom:28px">
        <span style="width:6px;height:6px;border-radius:50%;background:#5b8def;animation:warRoomPulse 1.4s ease-in-out infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#a78bfa;animation:warRoomPulse 1.4s ease-in-out 0.15s infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#4ade80;animation:warRoomPulse 1.4s ease-in-out 0.3s infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#fbbf24;animation:warRoomPulse 1.4s ease-in-out 0.45s infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#fcd34d;animation:warRoomPulse 1.4s ease-in-out 0.6s infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#22d3ee;animation:warRoomPulse 1.4s ease-in-out 0.75s infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#a3a3a3;animation:warRoomPulse 1.4s ease-in-out 0.9s infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#ef4444;animation:warRoomPulse 1.4s ease-in-out 1.05s infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#f5f5f5;animation:warRoomPulse 1.4s ease-in-out 1.2s infinite"></span>
      </div>
      <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:18px;font-weight:500">A-COM-003 · Refonte en cours</div>
      <h1 style="font-size:48px;font-weight:900;letter-spacing:-0.025em;margin:0 0 14px;line-height:1.02">AI War Room</h1>
      <p style="font-size:16px;font-weight:400;color:rgba(255,255,255,0.65);line-height:1.55;margin:0 0 36px">L'artefact Brainstorming évolue en environnement de pensée stratégique multi-agent. Neuf personnalités IA débattront en direct pour vous aider à mieux décider.</p>
      ${hasLegacyDraft ? `
        <div style="font-size:13px;color:rgba(252,211,77,0.9);background:rgba(252,211,77,0.06);border:1px solid rgba(252,211,77,0.2);padding:14px 18px;border-radius:10px;margin-bottom:32px;line-height:1.5;text-align:left">
          <strong style="font-weight:600">Brouillon studio 3D détecté.</strong><br>
          Il reste accessible localement pendant 30 jours. Un export sera proposé en Settings au Sprint 8.
        </div>
      ` : ''}
      <button id="ks-war-room-close" style="background:#fff;color:#0a0a0c;border:none;padding:14px 32px;font-size:14px;font-weight:600;letter-spacing:-0.005em;border-radius:10px;cursor:pointer;font-family:inherit;transition:transform 0.15s ease,box-shadow 0.15s ease">Compris</button>
      <div style="margin-top:40px;font-size:11px;color:rgba(255,255,255,0.25);letter-spacing:0.12em;text-transform:uppercase;font-weight:500">Sprint 1 · UI Skeleton à venir</div>
    </div>
  `;

  document.body.appendChild(overlay);

  const btn = overlay.querySelector('#ks-war-room-close');
  btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-1px)'; btn.style.boxShadow = '0 8px 24px rgba(255,255,255,0.15)'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform = ''; btn.style.boxShadow = ''; });
  btn.addEventListener('click', () => overlay.remove());

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}
