/* ═══════════════════════════════════════════════════════════════
   KORA — la boucle conversationnelle (V1 : écrit, LECTURE seule)
   ─────────────────────────────────────────────────────────────
   Orchestration côté client (les actions du catalogue lisent le
   localStorage de CE navigateur) :
     toi → phase 'decide' (worker) → soit réponse directe,
     soit action de lecture → runKoraAction (kora-actions.js) avec
     ANNEAU sur la cible → phase 'answer' (worker, streaming SSE).
   Le galet raconte l'état : réflexion pendant la décision, travail
   pendant lecture + réponse, repos à la fin.
   Historique de SESSION uniquement, plafonné (décision §14).
   Isolation kora_ ; chargé par kora.js, jamais ailleurs.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import { KORA_ACTIONS, KORA_PAD_META, koraAction, runKoraAction } from './kora-actions.js';
import { koraSay, koraState, koraRing, koraClearRings, koraClearLog } from './kora.js';
import { icon } from './lib/ui-icons.js';

const KORA_API = (typeof window !== 'undefined' && window.__KS_API_BASE__) ||
  'https://keystone-os-api.keystone-os.workers.dev';

const MAX_HISTORY = 16;
let _history = [];          // session seulement — rien de persistant
let _busy = false;
let _input = null, _sendBtn = null;

/* ── Pont vocal (K-14) — importé paresseusement (comme kora-chain) pour
   ne charger le moteur voix QUE si le mode vocal existe. `false` = module
   absent/indisponible → on retombe sur le mode écrit, sans jamais casser. */
let _voiceMod = null;
async function _voice() {
  if (_voiceMod === null) {
    try { _voiceMod = await import('./kora-voice.js'); }
    catch (_) { _voiceMod = false; }
  }
  return _voiceMod || null;
}

/* Entrée vocale : le texte transcrit entre dans la boucle EXACTEMENT
   comme s'il était tapé (KORA_VOCAL_BRIEF §3.1) — zéro chemin nouveau,
   _send garde déjà le verrou occupé. */
export function koraSubmit(text) {
  const t = String(text || '').trim();
  if (t) _send(t);
}

/* « Nouvelle conversation » — repart d'un fil VIDE. Le fil (bulles +
   _history) est volontairement persistant sur la session (décision 19/07 :
   ne pas perdre un échange en cours à la fermeture) ; ce bouton est le
   SEUL moyen propre de le remettre à zéro sans recharger la page. Refusé en
   plein tour (le stream écrit encore) : on ne coupe pas Kora au milieu. */
export function koraNewConversation() {
  if (_busy) return;
  _history = [];
  koraClearLog();
  koraClearRings();
  koraState('repos');
  /* coupe une éventuelle lecture voix en cours (jeton _gen invalidé côté
     kora-voice pour qu'aucun callback tardif ne repeigne l'état) */
  _voice().then(vm => { if (vm && vm.koraStopSpeech) vm.koraStopSpeech(); }).catch(() => {});
  if (_input) { _input.value = ''; try { _input.focus(); } catch (_) {} }
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function _jwt() { try { return localStorage.getItem('ks_jwt') || ''; } catch (e) { return ''; } }
function _push(role, content) {
  _history.push({ role, content });
  if (_history.length > MAX_HISTORY) _history = _history.slice(-MAX_HISTORY);
}
/* défs compactes du catalogue scopé — V1.1 : lectures + écritures sûres */
function _actionDefs() {
  return KORA_ACTIONS.map(a => ({
    /* pad = clé du GROUPEMENT par domaine du routage 2 étages (le worker
       groupe dessus) — sans lui, tous les domaines seraient « undefined » */
    id: a.id, pad: a.pad, label: a.label, desc: a.desc, mode: a.mode || 'read',
    /* p.desc transmis : c'est lui qui porte les valeurs admises (7d|30d…,
       réseaux) — jeté, le modèle les inventait (revue 19/07) */
    params: (a.params || []).map(p => ({ name: p.name, type: p.type, required: !!p.required, desc: p.desc || '' })),
  }));
}
const _isMobile = () => matchMedia('(max-width:640px)').matches;
function _setBusy(b) {
  _busy = b;
  if (_input)  _input.disabled = b;
  if (_sendBtn) _sendBtn.disabled = b;
  if (!b && _input) _input.focus();
}

async function _send(text) {
  if (_busy) return;
  const token = _jwt();
  if (!token) {
    koraSay('Je ne te reconnais pas — connecte-toi à Keystone puis reviens me voir.');
    return;
  }
  _setBusy(true);
  const userLine = koraSay(_esc(text));
  if (userLine) userLine.classList.add('kora-user');
  _push('user', text);
  koraState('reflexion');

  /* voix (V-2) : si la lecture est active, on chauffe le moteur Piper
     PENDANT que decide tourne (latence masquée, patron SA-9.2). `speech`
     = le flux de lecture ouvert à la phase answer, ou null (mode écrit). */
  let speech = null;
  const vm = await _voice();
  const voiceOut = !!(vm && vm.koraVoiceOutputActive());
  if (voiceOut) vm.koraWarmVoice();

  try {
    /* ── arrêt DÉTERMINISTE de la chaîne (fix 19/07, 2e retour « l'anneau
       reste allumé sur Publier après annule ») : le jeton de génération de
       kora-chain.js est étanche, mais il ne sert que si chain.cancel
       S'EXÉCUTE. En réel, la phase decide peut répondre en texte (« c'est
       annulé » sans rien faire), tomber en 429 crédits, ou en panne modèle
       (repli 200 type "reponse") — le pilote survivait et reposait l'anneau
       au tick suivant (1,8 s). Un ordre d'arrêt COURT et net pendant qu'un
       pilote tourne ne passe donc plus par le modèle : chain.cancel direct
       (zéro crédit, zéro roulette). Les formulations longues ou négatives
       (« n'annule pas », « annule et relance sur… ») gardent le chemin
       modèle, qui sait nuancer et enchaîner. */
    const { koraChainPhase } = await import('./kora-chain.js');
    if (koraChainPhase() && text.length <= 48
        && /\b(annule[rs]?|annulation|arr[eê]te[rs]?|stop(pe)?|laisse tomber|abandonne)\b/i.test(text)
        && !/\b(pas|jamais)\b/i.test(text)) {
      const r = await runKoraAction('chain.cancel', {});
      const msg = r.ok ? (r.data?.message || 'J’arrête de suivre la chaîne.') : r.error;
      koraSay(_esc(msg));
      _push('assistant', msg);
      if (voiceOut && vm) speech = vm.koraSpeakOneShot(msg);
      return;
    }

    /* ── phase 1 : décision ── */
    const res = await fetch(`${KORA_API}/api/kora/chat`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body   : JSON.stringify({ phase: 'decide', pad: 'dashboard',
                                messages: _history, actions: _actionDefs(),
                                /* routage 2 étages : résumés de domaines pour
                                   l'étage 1 — inerte tant que ≤ 32 actions */
                                pads: KORA_PAD_META }),
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      const msg = j.error || 'Tes crédits IA du mois sont épuisés.';
      koraSay(_esc(msg));
      if (voiceOut && vm) speech = vm.koraSpeakOneShot(msg);
      return;
    }
    if (!res.ok) throw new Error(`décision ${res.status}`);
    const d = await res.json();

    if (d.type === 'reponse') {
      koraSay(_esc(d.text).replace(/\n/g, '<br>'));
      _push('assistant', d.text);
      /* réponse DIRECTE (decide) : elle ne passe PAS par le flux answer —
         c'est le cas le plus fréquent (salutations, « je sais pas lire ça »,
         clarifications). Sans ça, la voix restait muette sur ces tours. */
      if (voiceOut && vm) speech = vm.koraSpeakOneShot(d.text);
      return;
    }
    if (d.type !== 'action') throw new Error('réponse inattendue');

    /* ── phase 2 : lecture (anneau sur la cible) puis réponse streamée ── */
    const act = koraAction(d.id);
    if (!act) {
      const msg = 'Je me suis emmêlée dans mes lectures — reformule, je réessaie.';
      koraSay(msg);
      _push('assistant', `(action inconnue demandée : ${d.id})`);
      if (voiceOut && vm) speech = vm.koraSpeakOneShot(msg);
      return;
    }
    if (d.annonce) { koraSay(_esc(d.annonce)); _push('assistant', d.annonce); }
    koraState('travail');
    /* lecture : anneau AVANT (la cible existe déjà si le pad est ouvert) ;
       écriture : anneau APRÈS (c'est l'action qui fait exister la cible —
       elle ouvre l'outil) — et on le laisse en place pendant la réponse */
    const isWrite = act.mode === 'write';
    if (!isWrite && act.target) koraRing(act.target);
    const result = await runKoraAction(d.id, d.args || {});
    if (isWrite && result.ok && act.target) {
      await new Promise(r => setTimeout(r, 350));   // le temps que l'outil monte son DOM
      koraRing(act.target);
    }
    /* revue 19/07 — chain.cancel (et toute action future qui touche le
       galet) peut avoir forcé l'état à 'repos' en cours de route (elle
       s'arrête, koraChainStop → _stop force repos) : on reprend la main
       AVANT la restitution, sinon la pastille dit « je suis prête »
       pendant que la réponse streame encore (contradiction avec §6). */
    koraState('travail');

    if (!result.ok) {
      koraSay(_esc(result.error));
      _push('assistant', `(action ${d.id} en échec : ${result.error})`);
      if (voiceOut && vm) speech = vm.koraSpeakOneShot(result.error);
      return;
    }

    const ans = await fetch(`${KORA_API}/api/kora/chat`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body   : JSON.stringify({ phase: 'answer', pad: 'dashboard', messages: _history,
                                action_id: d.id, action_result: result.data }),
    });
    if (!ans.ok || !ans.body) throw new Error(`réponse ${ans.status}`);

    /* streaming SSE → la ligne se remplit au fil de l'eau ; en mode vocal,
       Piper lit dès la 1ʳᵉ phrase complète (createSpeechStream, §3.2). On
       lui POUSSE le texte CUMULÉ (il découpe/pipeline en interne). */
    if (voiceOut && vm) speech = vm.koraOpenSpeech();
    const line = koraSay('');
    const reader = ans.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', fullText = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const l of lines) {
        if (!l.startsWith('data:')) continue;
        const payload = l.slice(5).trim();
        if (!payload) continue;
        try {
          const j = JSON.parse(payload);
          /* garde longueur, pas truthiness : le token "0" est falsy (bug des zéros) */
          if (j.type === 'chunk' && typeof j.text === 'string' && j.text.length) {
            fullText += j.text;
            if (line) line.textContent = fullText;
            if (speech) speech.push(fullText);
          }
        } catch (e) { /* fragment incomplet */ }
      }
    }
    if (speech) speech.end(fullText);
    if (!fullText && line) line.textContent = 'Lecture faite — mais je n’ai rien su en dire. Réessaie ?';
    _push('assistant', fullText || '(réponse vide)');
    /* écriture sur mobile : la feuille couvre l'outil qu'on vient
       d'ouvrir — on se range pour le laisser voir (desktop : les deux
       coexistent, panneau à droite) */
    if (isWrite && result.ok && _isMobile()) {
      await new Promise(r => setTimeout(r, 1600));
      const { koraClose } = await import('./kora.js');
      koraClose();
    }
  } catch (e) {
    if (speech) { try { speech.cancel(); } catch (_) {} speech = null; }
    koraSay('Petit souci de mon côté (' + _esc(e?.message || 'réseau') + '). Réessaie dans un instant.');
    /* en vocal, un échec MUET ressemble à une panne (§6 piège 10) : on le dit */
    if (voiceOut && vm) speech = vm.koraSpeakOneShot('Petit souci de mon côté, réessaie dans un instant.');
  } finally {
    koraClearRings();
    /* voix : le galet reste en « travail » tant que Piper parle — c'est la
       fin de lecture (onState 'idle', dans koraOpenSpeech) qui rend l'état
       repos. Sans voix (ou flux non ouvert : speech null), on repose tout de
       suite, exactement comme le mode écrit d'avant (non-régression). */
    if (!speech) koraState('repos');
    _setBusy(false);
  }
}

/* ═══ Placeholder animé — fait défiler des exemples de capacités ═══
   Découverte : le champ vide montre, à ~2,8 s d'intervalle avec fondu, de
   VRAIES demandes ancrées sur le catalogue. EN PAUSE dès qu'on cible le champ,
   qu'on tape, pendant l'enregistrement, ou fenêtre fermée. Respecte
   prefers-reduced-motion (une seule phrase, pas de défilement). */
const GHOST_EXAMPLES = [
  'combien de scans cette semaine ?',
  'qui je dois relancer ?',
  'quoi de neuf aujourd’hui ?',
  'prépare-moi un post sur la réouverture',
  'qu’est-ce qui part cette semaine sur mes réseaux ?',
  'mon site est-il toujours en ligne ?',
  'qu’est-ce que j’ai noté sur le salon de juin ?',
  'où en est le bouclage de ma revue ?',
  'lance un brainstorming sur une offre d’été',
  'réécris-moi ce texte en plus court',
  'le lien public de ma charte graphique ?',
  'combien de réponses à mon formulaire hier ?',
  'où j’en suis avec Camille Leroy ?',
  'qu’est-ce que mon agent ne sait pas répondre ?',
  'fais-moi un article LinkedIn sur nos nouveautés',
];
const GHOST_STATIC = 'Demande-moi ce que tu veux…';
let _ghost = null, _ghostIdx = 0, _ghostTimer = 0;

function _ghostExample() { return '« ' + GHOST_EXAMPLES[_ghostIdx] + ' »'; }
/* aligne le fantôme sur l'état du champ (vide/rempli, ciblé ou non) */
function _ghostSync() {
  if (!_ghost || !_input) return;
  if (_input.value) { _ghost.classList.add('is-off'); return; }
  _ghost.classList.remove('is-off'); _ghost.style.opacity = '';
  _ghost.textContent = (document.activeElement === _input) ? GHOST_STATIC : _ghostExample();
}
function _setupGhost(bar, panel) {
  _ghost = bar.querySelector('.kora-ghost');
  if (!_ghost) return;
  _ghost.textContent = _ghostExample();
  _input.addEventListener('focus', _ghostSync);
  _input.addEventListener('blur', _ghostSync);
  _input.addEventListener('input', _ghostSync);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;   // pas de défilement
  _ghostTimer = setInterval(() => {
    if (document.activeElement === _input || _input.value
        || bar.classList.contains('kora-rec')
        || !panel.classList.contains('kora-open')) return;              // en pause
    _ghostIdx = (_ghostIdx + 1) % GHOST_EXAMPLES.length;
    _ghost.style.opacity = '0';                                         // fondu sortie
    setTimeout(() => {
      if (document.activeElement !== _input && !_input.value) {
        _ghost.textContent = _ghostExample();
        _ghost.style.opacity = '';                                     // fondu entrée
      }
    }, 300);
  }, 2800);
}

/* ═══ Init — appelé par kora.js après création de la fenêtre ═══ */
export function initKoraLoop(panel) {
  if (!panel || panel.querySelector('.kora-inputbar')) return;
  const bar = document.createElement('div');
  bar.className = 'kora-inputbar';
  /* La zone de saisie se transforme en BANDEAU d'enregistrement quand on
     maintient le bouton voix (kora-voice.js ajoute .kora-rec/.kora-cancel).
     Le bouton voix lui-même est injecté par kora-voice (dépend du support
     micro) à droite de « Envoyer ». */
  /* pas de placeholder natif : la ligne « fantôme » (.kora-ghost) fait
     défiler des exemples de ce que Kora sait faire (découverte). L'aria-label
     porte l'accessibilité. */
  bar.innerHTML = `
    <div class="kora-field">
      <input class="kora-input" type="text" maxlength="1000" aria-label="Parler à Kora">
      <div class="kora-ghost" aria-hidden="true"></div>
      <div class="kora-recstrip" aria-hidden="true">
        <span class="kora-rs-dot"></span>
        <span class="kora-rs-timer">0:00</span>
        <canvas class="kora-rs-wave"></canvas>
        <span class="kora-rs-hint">glisse ← pour annuler</span>
      </div>
    </div>
    <button class="kora-send" title="Envoyer" aria-label="Envoyer">${icon('send', 16)}</button>`;
  panel.appendChild(bar);
  _input = bar.querySelector('.kora-input');
  _sendBtn = bar.querySelector('.kora-send');

  /* bouton voix (galet à droite d'Envoyer) : câblé par kora-voice si le
     micro est dispo — sinon barre en mode écrit seul, sans bouton */
  _voice().then(vm => { if (vm && vm.attachVoiceBar) vm.attachVoiceBar(bar); });

  _setupGhost(bar, panel);

  const go = () => {
    const t = (_input.value || '').trim();
    if (!t) return;
    _input.value = '';
    _ghostSync();                 // valeur vidée par programme : pas d'event 'input'
    _send(t);
  };
  _sendBtn.addEventListener('click', go);
  _input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

  /* bouton « nouvelle conversation » dans l'en-tête (conteneur .kora-headtools
     créé par kora.js ; le toggle voix y vit aussi). icon() du registre. */
  const tools = panel.querySelector('.kora-headtools');
  if (tools && !tools.querySelector('.kora-newconv')) {
    const nb = document.createElement('button');
    nb.type = 'button';
    nb.className = 'kora-newconv';
    nb.title = 'Nouvelle conversation';
    nb.setAttribute('aria-label', 'Nouvelle conversation');
    nb.innerHTML = icon('edit-3', 16);
    nb.addEventListener('click', koraNewConversation);
    tools.appendChild(nb);
  }
}
