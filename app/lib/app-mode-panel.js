/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Panneau « L'IA de votre agent » (Sprint P7)
   (interne : le sélecteur géré / BYOK — cf. bloc COPY pour le pourquoi
    du vocabulaire client, qui ne dit JAMAIS « qui paie »)
   ─────────────────────────────────────────────────────────────
   Le sélecteur géré / BYOK des deux applications à surface publique
   (Smart Agent, Concierge de Smart QR). Composant AUTONOME : on lui
   donne un conteneur, il charge son état, se peint et gère ses clics.
   Les deux apps hôtes n'ont donc qu'une ligne à écrire, et aucune
   n'hérite du cycle de rendu de l'autre.

   Pourquoi un composant partagé plutôt que deux blocs recopiés : c'est
   un écran qui parle d'ARGENT. Deux copies, c'est deux vérités le jour
   où la formulation change.

   Contrat serveur : GET/POST /api/app-mode (cf. workers/src/routes/
   app-mode.js). La doctrine — défaut géré, réversible, pas de BYOK
   sans clé, état dégradé — vit dans workers/src/lib/app-mode.js.

   Charte : aucun emoji, pictos `icon()` (cf. mémoire projet).
   ═══════════════════════════════════════════════════════════════ */

import { CF_API } from '../pads-loader.js';
import { icon }   from './ui-icons.js';

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function _call(path, opts = {}) {
  const jwt = localStorage.getItem('ks_jwt');
  const res = await fetch(`${CF_API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Requête refusée');
  return data;
}

// Styles injectés une fois. Volontairement sobres et calés sur les
// variables du thème : ce panneau vit dans DEUX apps aux CSS distinctes,
// il ne doit hériter d'aucune des deux.
let _cssDone = false;
function _ensureCss() {
  if (_cssDone) return;
  _cssDone = true;
  const st = document.createElement('style');
  st.textContent = `
  .ksmode{border:1px solid var(--border,rgba(128,128,128,.25));border-radius:14px;padding:16px;margin-top:14px}
  .ksmode-h{display:flex;align-items:center;gap:8px;font-weight:900;letter-spacing:-.02em;margin:0 0 4px}
  .ksmode-sub{font-size:13px;opacity:.7;margin:0 0 14px;line-height:1.5}
  .ksmode-opts{display:grid;gap:10px}
  .ksmode-opt{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--border,rgba(128,128,128,.25));
    border-radius:12px;cursor:pointer;transition:border-color .15s,background .15s;background:transparent;text-align:left;width:100%;font:inherit;color:inherit}
  .ksmode-opt:hover:not(:disabled){border-color:var(--accent,#0a84ff)}
  .ksmode-opt:disabled{opacity:.5;cursor:not-allowed}
  .ksmode-opt.is-on{border-color:var(--accent,#0a84ff);background:color-mix(in srgb,var(--accent,#0a84ff) 7%,transparent)}
  .ksmode-dot{flex:0 0 16px;height:16px;margin-top:2px;border-radius:50%;border:2px solid var(--border,rgba(128,128,128,.45))}
  .ksmode-opt.is-on .ksmode-dot{border-color:var(--accent,#0a84ff);box-shadow:inset 0 0 0 3px var(--accent,#0a84ff)}
  /* Choisi mais inopérant (clé morte) : ni « actif », ni « éteint ». */
  .ksmode-opt.is-paused{border-color:#ff9f0a;background:color-mix(in srgb,#ff9f0a 8%,transparent)}
  .ksmode-opt.is-paused .ksmode-dot{border-color:#ff9f0a;box-shadow:inset 0 0 0 3px #ff9f0a}
  .ksmode-t{font-weight:700;margin:0 0 2px;letter-spacing:-.01em}
  .ksmode-d{font-size:12.5px;opacity:.72;margin:0;line-height:1.5}
  .ksmode-note{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.5;margin:12px 0 0;padding:10px 12px;border-radius:10px;
    background:color-mix(in srgb,var(--accent,#0a84ff) 8%,transparent)}
  .ksmode-note.is-warn{background:color-mix(in srgb,#ff9f0a 14%,transparent)}
  .ksmode-note svg{flex:0 0 auto;margin-top:1px}`;
  document.head.appendChild(st);
}

// ── Le vocabulaire ──────────────────────────────────────────────
// Première version : « Qui paie l'IA », « Keystone fournit l'IA »,
// « vous fournissez l'IA ». Vrai côté cuisine (c'est le §2 du handoff),
// mais c'est du vocabulaire d'EXPLOITANT : ça fait du client le
// comptable de mes coûts, deux minutes après qu'il a payé son
// abonnement. Réécrit le 2026-07-25 sur remarque de Stéphane.
//
// L'axe client n'est pas « qui paie », c'est **ce qui se passe quand
// son agent marche trop bien** : plafonné et sans surprise, ou sans
// plafond. On ne mentionne plus qui règle la facture — le prix est le
// même dans les deux cas, ça ne l'aide en rien de le savoir.
//
// ⚠️ Ne JAMAIS écrire ici un nombre de conversations incluses : il
// dépend du sac d'apps (99 € = 1 000, OS = 3 000) et un chiffre en dur
// finirait par mentir — c'est exactement le piège de `creditsPayload()`
// sans `quotaOverride` (cf. handoff §Pièges).
const COPY = {
  MANAGED: {
    title: 'Comprise dans votre abonnement',
    desc:  'Vos conversations incluses couvrent les échanges. Au-delà, la recharge automatique prend le relais dans la limite que vous fixez — vous ne pouvez pas avoir de surprise.',
  },
  BYOK: {
    title: 'Votre propre moteur',
    desc:  'Vous branchez votre clé : aucun plafond, aucune interruption, quel que soit le volume. L\'IA vous est facturée directement par votre fournisseur, à son tarif.',
  },
};

function _render(el, st) {
  // Une erreur ne doit JAMAIS effacer le sélecteur : le cas courant est un
  // refus actionnable (« déposez d'abord votre clé »), pas une panne. On
  // n'affiche l'erreur seule que si l'état n'a jamais pu être chargé.
  if (st.error && !st.data) {
    el.innerHTML = `<div class="ksmode"><p class="ksmode-sub" style="margin:0">${_esc(st.error)}</p></div>`;
    return;
  }
  if (!st.data) {
    el.innerHTML = `<div class="ksmode"><p class="ksmode-sub" style="margin:0">Chargement…</p></div>`;
    return;
  }
  const d = st.data;
  // Le bouton coché suit ce que le client a DEMANDÉ (`declared`), pas ce
  // qui s'applique : en dégradé, son choix reste visible, et l'encart
  // orange explique pourquoi l'IA est quand même la nôtre en attendant.
  const opt = (mode) => {
    const on  = d.declared === mode;
    const dis = st.busy || (mode === 'BYOK' && !d.byok_available && !on);
    // En dégradé, la promesse de l'option BYOK (« aucune conversation
    // décomptée ») est FAUSSE : c'est justement le moment où elles le sont.
    // On la remplace plutôt que de laisser l'encart la contredire.
    const desc = (mode === 'BYOK' && d.degraded)
      ? 'Sélectionné, mais suspendu : votre clé ne répond pas. Vos conversations incluses prennent le relais en attendant.'
      : COPY[mode].desc;
    return `<button type="button" class="ksmode-opt ${on ? 'is-on' : ''} ${on && d.degraded ? 'is-paused' : ''}" data-mode="${mode}" ${dis ? 'disabled' : ''}>
      <span class="ksmode-dot"></span>
      <span><p class="ksmode-t">${COPY[mode].title}${mode === 'BYOK' && d.degraded ? ' — en pause' : ''}</p><p class="ksmode-d">${desc}</p></span>
    </button>`;
  };

  let note = '';
  if (st.error) {
    note = `<p class="ksmode-note is-warn">${icon('alert-triangle', 15)}<span>${_esc(st.error)}</span></p>`;
  } else if (d.degraded) {
    note = `<p class="ksmode-note is-warn">${icon('alert-triangle', 15)}<span><strong>Votre clé n'a pas répondu.</strong>
      Vos visiteurs continuent d'être servis — votre abonnement prend le relais le temps que vous la remettiez
      en route. Vérifiez-la dans Réglages → Moteur IA, puis re-sélectionnez « Votre propre moteur » ci-dessus.</span></p>`;
  } else if (!d.byok_available) {
    // `routing_disabled` = l'interrupteur de secours global est coupé.
    // On le dit sans jargon et sans renvoyer le client déposer une clé
    // qui ne servirait à rien pour l'instant.
    note = d.byok_blocker === 'routing_disabled'
      ? `<p class="ksmode-note">${icon('info', 15)}<span>Le branchement d'un moteur personnel n'est pas encore ouvert
          sur cette application. En attendant, l'IA est comprise dans votre abonnement.</span></p>`
      : `<p class="ksmode-note">${icon('info', 15)}<span>${
          d.byok_blocker === 'no_key'
            ? 'Vous n\'avez encore enregistré aucune clé.'
            : d.byok_blocker === 'no_active_engine'
              ? 'Aucun moteur IA n\'est actif.'
              : `Aucune clé n'est enregistrée pour votre moteur actif${d.active_engine ? ` (${_esc(d.active_engine)})` : ''}.`
        } Pour brancher votre propre moteur, déposez-la dans <strong>Réglages → Moteur IA</strong> — l'option s'activera ici.</span></p>`;
  } else if (d.declared === 'BYOK') {
    note = `<p class="ksmode-note">${icon('shield-check', 15)}<span>Vos visiteurs sont servis par
      <strong>${_esc(d.active_engine || 'votre moteur')}</strong>, sur votre clé. Elle est chiffrée et n'est jamais
      transmise à vos visiteurs.</span></p>`;
  }

  // Le sous-titre parle du RISQUE du client (un trafic qu'il ne maîtrise
  // pas), pas de ma structure de coûts. Formulé sans genre : le panneau
  // sert « votre agent » comme « votre Concierge ».
  el.innerHTML = `<section class="ksmode">
    <h3 class="ksmode-h">${icon('key', 16)} L'IA de ${_esc(st.subject)}</h3>
    <p class="ksmode-sub">Vos visiteurs peuvent être dix ou dix mille — vous ne le savez pas à l'avance.
      Deux façons d'alimenter l'IA qui leur répond, et vous pouvez en changer à tout moment.${
        st.scopeNote ? ` <strong>${_esc(st.scopeNote)}</strong>` : ''}</p>
    <div class="ksmode-opts">${opt('MANAGED')}${opt('BYOK')}</div>
    ${note}
  </section>`;
}

// État partagé par appId. Les deux apps hôtes re-peignent leur écran à
// chaque frappe (`_renderMainKeepScroll`), ce qui détruit le conteneur :
// sans ce cache, le panneau clignoterait sur « Chargement… » et referait
// un aller-retour réseau à chaque rendu.
const _cache = {};

/**
 * Monte le panneau dans `el`. IDEMPOTENT — les apps hôtes peuvent
 * l'appeler après chacun de leurs rendus.
 *
 * @param {HTMLElement} el       conteneur (son contenu est remplacé)
 * @param {string} appId         'O-AGT-001' | 'A-COM-001'
 * @param {object} [o]
 * @param {string} [o.subject]   ce dont on parle au client, au génitif :
 *                               « votre agent », « votre Concierge »
 * @param {string} [o.scopeNote] précision de portée (le réglage vaut pour
 *                               l'app entière, pas pour l'objet affiché)
 * @param {function} [o.onChange]
 */
export function mountModePanel(el, appId, o = {}) {
  if (!el || el.dataset.ksmode === '1') return;
  el.dataset.ksmode = '1';
  _ensureCss();
  const onChange = o.onChange;
  const st = {
    data: _cache[appId] || null, busy: false, error: null,
    scopeNote: o.scopeNote || '',
    subject:   o.subject   || 'votre application',
  };

  const paint = () => _render(el, st);
  paint();

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('.ksmode-opt');
    if (!btn || btn.disabled || st.busy) return;
    const mode = btn.dataset.mode;
    if (!mode || st.data?.declared === mode) return;
    st.busy = true; paint();
    try {
      await _call('/api/app-mode', { method: 'POST', body: JSON.stringify({ app: appId, mode }) });
      st.data = _cache[appId] = await _call(`/api/app-mode?app=${encodeURIComponent(appId)}`);
      onChange?.(st.data);
    } catch (err) {
      // Cas le plus fréquent : 409 « pas de clé pour le moteur actif ».
      // On le montre tel quel — c'est une consigne actionnable, pas une panne.
      st.error = err.message;
      setTimeout(() => { st.error = null; paint(); }, 6000);
    }
    st.busy = false; paint();
  });

  _call(`/api/app-mode?app=${encodeURIComponent(appId)}`)
    .then((d) => { st.data = _cache[appId] = d; paint(); })
    .catch(() => { st.error = 'Mode indisponible pour le moment.'; paint(); });
}
