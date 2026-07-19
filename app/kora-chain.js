/* ═══════════════════════════════════════════════════════════════
   KORA — PILOTE DE CHAÎNE (V1.3)
   ───────────────────────────────────────────────────────────────
   Décision Stéphane 19/07/2026 : « le pont complet, elle enchaîne
   seule ». Kora lance la séance, surveille le débat, et fait les
   relais Brainstorming → Ghost Writer → Social Manager elle-même.
   Elle ne s'arrête qu'aux gestes HUMAINS de la ligne rouge (§7) :
     · choisir l'IDÉE à la synthèse (trancher) ;
     · PUBLIER (le bouton reste à l'utilisateur).
   En mode chaîne le Ghost Writer compose UN post (pas 3 variantes,
   ghostwriter.js:793) — il n'y a donc pas d'arrêt « choix de
   variante » sur ce trajet.

   Principes (cartographie 19/07, fichier:ligne dans les phases) :
   · le STORAGE avance plus vite que le DOM (typewriter ~20 c/s) :
     le capteur de progression du débat = ks_brainstorming_sessions
     (history autosauvé à chaque tour, synthesis posée avant le
     tiroir, brainstorming.js:1061/1585) ;
   · ne JAMAIS garder de référence d'élément entre deux jalons
     (les vues se re-rendent) : re-querySelector à chaque tick ;
   · tester l'EXISTENCE des nœuds, jamais les classes d'animation
     (gw-on / open arrivent au frame suivant) ;
   · ne jamais envoyer Escape (le keydown du brainstorming écoute
     document : il fermerait TOUT, brainstorming.js:503).
   Module inerte : importé dynamiquement par chain.start /
   chain.pick_idea. Un poll léger (1,8 s), TTL 15 min, jamais
   d'exception qui remonte (try/catch au tick).
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const POLL_MS  = 1800;
const TTL_MS   = 15 * 60e3;   // sans progrès depuis 15 min → le pilote se retire
const STALL_MS = 60e3;        // débat figé (auto_pause sans round_complete) → bouton Synthétiser

let _timer = null;
let _phase = null;            // 'debat' | 'idee' | 'compose' | 'forward' | 'publish'
let _brief = '';
let _deadline = 0;
let _histLen = 0, _histTs = 0;
let _kora = null;             // module kora.js (koraState / koraSay / koraRing)
let _said = null;             // messages déjà dits (une seule fois chacun)
let _goClicked = false, _sendClicked = false, _synthClicked = false;

/* ── capteurs storage ── */
function _lsJson(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
  catch (e) { return null; }
}
function _chainStep() {
  try { const r = sessionStorage.getItem('ks_content_chain'); return r ? (JSON.parse(r).step || null) : null; }
  catch (e) { return null; }
}
/* notre séance = l'entrée de la bibliothèque dont le brief est le nôtre
   (unshift en tête à chaque autosave, brainstorming.js:1946) */
function _session() {
  const all = _lsJson('ks_brainstorming_sessions') || [];
  return all.find(s => (s.brief || '').trim() === _brief) || null;
}

/* ── langage de présence (galet / fenêtre / anneaux) ── */
function _say(key, msg) {
  if (_said.has(key)) return;
  _said.add(key);
  try { _kora?.koraSay?.(msg); } catch (e) { /* fenêtre pas prête */ }
}
function _ring(sel) { try { _kora?.koraRing?.(sel); } catch (e) { /* cible absente */ } }
/* n'écrase pas un état transitoire de la boucle de conversation : on ne
   s'affirme que depuis le repos (ou pour entrer dans un nouvel état) */
function _state(s, force) {
  try {
    const cur = document.body.dataset.koraState;
    if (cur === s) return;
    if (!force && cur && cur !== 'repos') return;
    _kora?.koraState?.(s);
  } catch (e) { /* galet pas monté */ }
}

/* ── API ── */
export async function koraChainPilot(opts = {}) {
  _brief = String(opts.brief || '').trim();
  _phase = opts.phase || 'debat';
  _deadline = Date.now() + TTL_MS;
  _histLen = 0; _histTs = Date.now();
  _said = new Set();
  _goClicked = _sendClicked = _synthClicked = false;
  _kora = await import('./kora.js');
  clearInterval(_timer);
  _timer = setInterval(_tick, Math.max(120, opts.pollMs || POLL_MS));
}
export function koraChainStop() { _stop(null); }
export function koraChainPhase() { return _phase; }   // instrumentation / tests

function _stop(msg) {
  clearInterval(_timer); _timer = null; _phase = null;
  if (msg) { try { _kora?.koraSay?.(msg); } catch (e) { /* rien */ } }
  _state('repos', true);
  /* piège trouvé le 19/07 : sans ça, l'anneau (ex. sur Publier) restait
     allumé après un arrêt — le pilote arrêté ne le réaffirmait plus,
     mais rien ne l'effaçait non plus (koraClearRings de la BOUCLE ne
     couvre que la fin d'un tour de conversation, pas l'arrêt du pilote). */
  try { _kora?.koraClearRings?.(); } catch (e) { /* galet pas monté */ }
}

function _tick() {
  try { _step(); } catch (e) { /* un poll ne casse jamais l'app */ }
}

function _step() {
  if (!_phase) return _stop(null);
  if (Date.now() > _deadline) return _stop(null);   // retrait silencieux
  const gw = document.getElementById('gw-overlay');

  /* ── DÉBAT : la séance tourne, on attend les idées ─────────────── */
  if (_phase === 'debat') {
    if (!document.querySelector('#wr-fullscreen.open'))
      return _stop('La séance a été fermée — dis-moi si tu veux relancer la chaîne.');
    const s = _session();
    const hl = Array.isArray(s?.history) ? s.history.length : 0;
    if (hl > _histLen) { _histLen = hl; _histTs = Date.now(); _deadline = Date.now() + TTL_MS; }
    if (s?.synthesis) {
      /* ARRÊT ROUGE n°1 — choisir l'idée (trancher). L'anneau pointe le
         tiroir, le galet passe en besoin (KORA_BRIEF B.4). */
      _phase = 'idee';
      _state('besoin', true);
      _ring('#wr-synthesis-drawer');
      _say('idee', 'Les idées sont sur la table — clique « Rédiger » sur celle qui te plaît, ou dis-moi laquelle (« la 2 »).');
      return;
    }
    /* complete SANS round_complete (auto_pause) : pas de synthèse auto →
       on clique le bouton Synthétiser (dispo dès 4 tours, brainstorming.js:1503) */
    if (hl >= 4 && Date.now() - _histTs > STALL_MS && !_synthClicked) {
      const btn = document.querySelector('#wr-fullscreen .wr-synthesize-btn');
      if (btn) { _synthClicked = true; btn.click(); _say('synth', 'Le tour de table est complet — je déclenche la synthèse.'); }
    }
    _state('travail');
    return;
  }

  /* ── IDÉE : on attend le clic « Rédiger » (humain ou chain.pick_idea) ── */
  if (_phase === 'idee') {
    if (gw && gw.querySelector('.gw-modal[data-chain="1"]')) {
      _phase = 'compose';
      _state('travail', true);
      return;
    }
    if (!document.querySelector('#wr-fullscreen.open'))
      return _stop('La séance a été fermée — les idées restent dans ta bibliothèque de séances.');
    _ring('#wr-synthesis-drawer');   // se re-pose si la boucle a nettoyé
    _state('besoin');
    return;
  }

  /* ── COMPOSE : GW chaîné ouvert → on lance la composition nous-mêmes ── */
  if (_phase === 'compose') {
    if (!gw) { _phase = 'idee'; return; }        // GW refermé sans composer → retour au tiroir
    if (gw.querySelector('#gw-variants .gw-compose-post')) { _phase = 'forward'; return; }
    const go = gw.querySelector('#gw-go');
    if (!_goClicked && go && !go.disabled && (gw.querySelector('#gw-source')?.value || '').trim()) {
      _goClicked = true;
      go.click();                                 // crédits GW : c'est le geste « composer », vert (§7)
      _say('compose', 'Je compose le post à partir de ton idée…');
    }
    /* échec / quota : statut d'erreur et bouton ré-activé sans post (gw.js:810/832) */
    const st = (gw.querySelector('#gw-status')?.textContent || '').trim();
    if (_goClicked && go && !go.disabled && st && !/^✓/.test(st))
      return _stop(`La composition n’a pas abouti (${st}) — reprends la main dans le Ghost Writer.`);
    _state('travail');
    return;
  }

  /* ── FORWARD : post composé → on l'envoie au composer nous-mêmes ── */
  if (_phase === 'forward') {
    if (!gw) { _phase = 'publish'; return; }      // déjà parti (l'envoi ferme GW, gw.js:899)
    const send = gw.querySelector('.gw-action-send');
    if (send && !_sendClicked) {
      _sendClicked = true;
      send.click();                               // setChain publish + composeInSocialManager (gw.js:895-900)
      _say('forward', 'Post envoyé au composer — je te laisse le dernier mot.');
    }
    _phase = 'publish';
    return;
  }

  /* ── PUBLISH : ARRÊT ROUGE n°2 — le bouton Publier est à l'humain ── */
  if (_phase === 'publish') {
    if (_chainStep() === null)                    // clearChain = publication acceptée (social-manager.js:779)
      return _stop('Publié — la chaîne est bouclée.');
    const smText = document.querySelector('#sm-text');
    if (smText && (smText.value || '').trim() && _chainStep() === 'publish') {
      _ring('.sm-btn-primary[data-act="publish"]');
      _state('besoin');
      _say('publish', 'Tout est prêt dans le composer — relis, ajuste si tu veux : le bouton Publier est à toi.');
    }
    return;
  }
}
