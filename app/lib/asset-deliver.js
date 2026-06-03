/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — « Livrer à un client » (composant partagé)
   Sprint « Livrer » V1 (2026-06-03)
   ───────────────────────────────────────────────────────────────
   Flux générique de réassignation d'un asset (QR / Key Form) vers le
   tenant d'une licence cliente, désignée par e-mail. Réutilisé par
   le studio Smart Dynamic QR (sdqr.js) et le workspace Key Form
   (pulsa.js) pour une UX identique.

   Étapes : bouton « Livrer à un client » → saisie e-mail →
   « Vérifier » (dry_run, récap propriétaire/plan/avertissements) →
   « Confirmer la livraison » (transfert réel) → callback onDelivered.

   Gating : visible uniquement pour l'admin (claim JWT isAdmin), JAMAIS
   pour un client. L'enforcement réel est côté serveur (403 sinon).
   ═══════════════════════════════════════════════════════════════ */

import { isAdminUser, CF_API } from '../pads-loader.js';
import { icon } from './ui-icons.js';

const TOOL_LABEL = { qr: 'ce QR', keyform: 'ce formulaire' };

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const adminToken = localStorage.getItem('ks_admin_token');
  const jwt        = localStorage.getItem('ks_jwt');
  if (adminToken)  h['Authorization'] = 'Bearer ' + adminToken;
  else if (jwt)    h['Authorization'] = 'Bearer ' + jwt;
  return h;
}

async function _transferRequest({ type, id, email, dryRun }) {
  const res = await fetch(`${CF_API}/api/admin/asset/transfer`, {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify({ type, id, target_email: email, dry_run: !!dryRun }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Erreur HTTP ${res.status}`);
  }
  return data;
}

function _warningLine(code, recap) {
  if (code === 'already_owned') {
    return `<div class="ks-deliver-warn ks-deliver-warn--block">Cet asset appartient déjà à ce client — rien à livrer.</div>`;
  }
  if (code === 'plan_excludes_tool') {
    const plan = recap?.target?.plan ? ` (${_esc(recap.target.plan)})` : '';
    return `<div class="ks-deliver-warn">Le plan de ce client${plan} n'inclut pas cet outil. Tu peux livrer quand même, mais le client ne verra l'asset qu'une fois l'outil débloqué sur sa licence.</div>`;
  }
  return '';
}

/**
 * HTML du point d'entrée. Renvoie '' si l'utilisateur n'est pas admin
 * (le bouton est ALORS totalement absent — jamais grisé).
 * Le conteneur porte data-deliver-root pour le wiring.
 */
export function deliverEntryHtml() {
  if (!isAdminUser()) return '';
  return `
    <div class="ks-deliver" data-deliver-root>
      <button type="button" class="ks-deliver-trigger" data-deliver-open>
        ${icon('send', 16)}<span>Livrer à un client</span>
      </button>
    </div>`;
}

/**
 * Câble le composant.
 * @param {HTMLElement} root  élément [data-deliver-root]
 * @param {object} opts
 *   @param {'qr'|'keyform'} opts.type
 *   @param {string}   opts.assetId
 *   @param {string}   opts.assetName
 *   @param {Function} [opts.onExportResponses] callback bouton export CSV
 *   @param {Function} [opts.onDelivered]       reçu après livraison réussie
 *   @param {string}   [opts.deliveredNote]     texte ajouté à l'écran de
 *     succès (ex. Key Form : « demande au client de récupérer via l'URL »)
 */
export function wireDeliver(root, opts) {
  if (!root) return;
  const { type, assetId, assetName, onExportResponses, onDelivered, deliveredNote } = opts || {};
  const tool = TOOL_LABEL[type] || 'cet asset';

  const collapsed = root.innerHTML;

  function reset() {
    root.innerHTML = collapsed;
    root.querySelector('[data-deliver-open]')?.addEventListener('click', openForm);
  }

  function openForm() {
    root.innerHTML = `
      <div class="ks-deliver-panel">
        <div class="ks-deliver-head">${icon('send', 16)}<span>Livrer ${_esc(tool)} à un client</span></div>
        <p class="ks-deliver-desc">Le client doit déjà avoir une licence Keystone. Saisis son e-mail : l'asset passera dans son espace (le support imprimé et les statistiques restent valables) et quittera ton tableau de bord.</p>
        <label class="ks-deliver-label" for="ks-deliver-email-${_esc(assetId)}">E-mail du client</label>
        <div class="ks-deliver-row">
          <input type="email" id="ks-deliver-email-${_esc(assetId)}" class="ks-deliver-input" placeholder="client@exemple.fr" autocomplete="off">
          <button type="button" class="ks-deliver-btn ks-deliver-btn--primary" data-deliver-check>Vérifier le client</button>
        </div>
        <button type="button" class="ks-deliver-cancel" data-deliver-cancel>Annuler</button>
        <div class="ks-deliver-msg" data-deliver-msg hidden></div>
      </div>`;
    const input = root.querySelector('.ks-deliver-input');
    input?.focus();
    root.querySelector('[data-deliver-cancel]')?.addEventListener('click', reset);
    root.querySelector('[data-deliver-check]')?.addEventListener('click', () => check(input?.value || ''));
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check(input.value || ''); } });
  }

  function showMsg(text, kind) {
    const m = root.querySelector('[data-deliver-msg]');
    if (m) { m.hidden = false; m.textContent = text; m.className = `ks-deliver-msg ks-deliver-msg--${kind}`; }
  }

  async function check(emailRaw) {
    const email = (emailRaw || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      showMsg('Saisis un e-mail valide.', 'err');
      return;
    }
    const btn = root.querySelector('[data-deliver-check]');
    if (btn) { btn.disabled = true; btn.textContent = 'Vérification…'; }
    try {
      const recap = await _transferRequest({ type, assetId, id: assetId, email, dryRun: true });
      renderRecap(email, recap);
    } catch (e) {
      showMsg(e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'Vérifier le client'; }
    }
  }

  function renderRecap(email, recap) {
    const t = recap?.target || {};
    const who = t.owner && t.owner !== email ? `${_esc(t.owner)} · ${_esc(email)}` : _esc(email);
    const plan = t.plan ? `<span class="ks-deliver-pill">Plan ${_esc(t.plan)}</span>` : '';
    const warnings = Array.isArray(recap?.warnings) ? recap.warnings : [];
    const blocked = warnings.includes('already_owned');

    // Nombre de réponses = valeur SERVEUR (dry_run), source de vérité.
    const rc = (type === 'keyform' && Number(recap?.asset?.response_count)) || 0;
    const purgeBlock = rc > 0 ? `
      <div class="ks-deliver-warn">
        ${rc} réponse(s) déjà collectée(s) seront <strong>définitivement effacées</strong> à la livraison — les réponses ne sont jamais transférées au client.
        ${onExportResponses ? `<button type="button" class="ks-deliver-export" data-deliver-export>${icon('download', 14)} Exporter les réponses (CSV) d'abord</button>` : ''}
      </div>` : '';

    root.innerHTML = `
      <div class="ks-deliver-panel">
        <div class="ks-deliver-head">${icon('send', 16)}<span>Vérifie avant de livrer</span></div>
        <div class="ks-deliver-recap">
          <div class="ks-deliver-recap-row"><span class="ks-deliver-recap-lbl">Asset</span><span class="ks-deliver-recap-val">${_esc(assetName || tool)}</span></div>
          <div class="ks-deliver-recap-row"><span class="ks-deliver-recap-lbl">Destinataire</span><span class="ks-deliver-recap-val">${who} ${plan}</span></div>
        </div>
        ${purgeBlock}
        ${warnings.map(w => _warningLine(w, recap)).join('')}
        <div class="ks-deliver-actions">
          <button type="button" class="ks-deliver-cancel" data-deliver-cancel>Annuler</button>
          ${blocked ? '' : `<button type="button" class="ks-deliver-btn ks-deliver-btn--danger" data-deliver-confirm>Confirmer la livraison</button>`}
        </div>
        <div class="ks-deliver-msg" data-deliver-msg hidden></div>
      </div>`;

    root.querySelector('[data-deliver-cancel]')?.addEventListener('click', reset);
    root.querySelector('[data-deliver-export]')?.addEventListener('click', () => {
      try { onExportResponses?.(); } catch (_) {}
    });
    root.querySelector('[data-deliver-confirm]')?.addEventListener('click', () => confirmTransfer(email));
  }

  async function confirmTransfer(email) {
    const btn = root.querySelector('[data-deliver-confirm]');
    if (btn) { btn.disabled = true; btn.textContent = 'Livraison…'; }
    try {
      const result = await _transferRequest({ type, assetId, id: assetId, email, dryRun: false });
      const note = deliveredNote ? `<p class="ks-deliver-note">${_esc(deliveredNote)}</p>` : '';
      root.innerHTML = `
        <div class="ks-deliver-panel ks-deliver-panel--done">
          <div class="ks-deliver-done-head">${icon('check', 16)}<span>Livré à ${_esc(email)}</span></div>
          <p class="ks-deliver-note">L'asset est passé dans l'espace du client et a quitté ton tableau de bord.</p>
          ${note}
        </div>`;
      try { onDelivered?.(result); } catch (_) {}
    } catch (e) {
      showMsg(e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirmer la livraison'; }
    }
  }

  // État initial : juste le bouton déclencheur.
  root.querySelector('[data-deliver-open]')?.addEventListener('click', openForm);
}
