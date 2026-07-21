/* ═══════════════════════════════════════════════════════════════
   KORA — MODE VOCAL (K-14, desktop V-1/V-2)
   ─────────────────────────────────────────────────────────────
   Half-duplex talkie-walkie (KORA_VOCAL_BRIEF §3) :
     · V-1 — MAINTENIR le galet (>150 ms) → MediaRecorder → POST
       /api/kora/stt (Whisper) → le texte entre dans la boucle via
       koraSubmit() COMME s'il était tapé (zéro changement à
       decide/answer). Micro fermé le reste du temps (privé).
     · V-2 — la réponse PARLE : le flux SSE 'answer' de kora-loop.js
       est poussé dans createSpeechStream() de piper-tts.js (Piper/
       Siwis maison, 100 % navigateur). Toggle voix dans la fenêtre,
       préférence device `kora_voice_on` (HORS PREFS_KEYS — piège
       Cloud Vault clobber).

   Half-duplex STRICT : micro et voix jamais ouverts ensemble
   (stopSpeaking() dès qu'on arme le micro ; barge-in = pointerdown
   coupe la voix). Jeton de génération `_gen` : tout callback tardif
   (transcription, onState) vérifie son jeton (défense anti « la voix
   parle encore après l'interruption », leçon kora-chain _gen).

   Constantes micro recopiées VERBATIM des harnais validés
   (_design-lab/kora-galet-*.html) : plancher 0.012 × gain 5.5,
   attaque 30 / retombée 9, fftSize 1024. Ne pas réinventer.

   Isolation kora_ / .kora-* ; ne casse jamais le mode écrit (le tap
   court ouvre/ferme la fenêtre comme avant). Chargé par kora.js.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import { koraState, koraLevel, koraOpen, koraSay } from './kora.js';
import { koraSubmit } from './kora-loop.js';
import { icon } from './lib/ui-icons.js';
import {
  isSupported as ttsSupported, warmUp, primeAudio, stopSpeaking, createSpeechStream,
  DEFAULT_VOICE,
} from './lib/piper-tts.js';

const KORA_API = (typeof window !== 'undefined' && window.__KS_API_BASE__) ||
  'https://keystone-os-api.keystone-os.workers.dev';
const PIPER_VOICE = DEFAULT_VOICE;   // V1 = français uniquement (Siwis, §3.2)

/* ── Réglages talkie-walkie ── */
const HOLD_MS       = 150;    // < 150 ms = un TAP (ouvre/ferme, geste actuel) — §4 anti-tap
const MAX_MS        = 60000;  // coupe propre à 60 s (§4)
const CANCEL_MARGIN = 44;     // px hors du galet = zone « relâche pour annuler » (WhatsApp)
const MIN_BLOB      = 700;    // ms mini pour envoyer (sinon « rien entendu »)

/* ── Constantes micro (VERBATIM harnais) ── */
const MIC_FLOOR = 0.012, MIC_GAIN = 5.5, MIC_ATTACK = 30, MIC_RELEASE = 9;

/* ── État module ── */
let _inited = false;
let _galet = null, _panel = null;
let _voiceOn = false;                 // préférence device (lecture de la réponse)
let _toggleBtn = null;

let _gen = 0;                         // jeton de génération (barge-in / callbacks tardifs)
let _micDenied = false;              // refus mémorisé (§6 piège 11 : pas de re-prompt en boucle)

let _holding = false, _holdTimer = 0, _downX = 0, _downY = 0, _pointerId = null;
let _suppressClick = false, _suppressTimer = 0;

let _rec = null;                     // enregistrement en cours { stream, mr, chunks, mime, t0, send, cancelZone, maxTimer }
let _audioCtx = null, _analyser = null, _micBuf = null;
let _micLevel = 0, _levelRAF = 0, _levelLast = 0;

/* préparation voix (1er téléchargement du modèle ~60 Mo, une seule fois) */
let _warming = false, _prepLine = null;

/* ═══ Support ═══ */
function _inputSupported() {
  return typeof MediaRecorder !== 'undefined'
    && typeof MediaRecorder.isTypeSupported === 'function'
    && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    && (typeof window === 'undefined' || window.isSecureContext !== false);
}
function _outputSupported() { try { return !!ttsSupported(); } catch (_) { return false; } }

function _jwt() { try { return localStorage.getItem('ks_jwt') || ''; } catch (_) { return ''; } }
function _setHint(text) {
  const sub = _panel && _panel.querySelector('.kora-sub');
  if (sub && text != null) sub.textContent = text;
}

/* ═══ V-2 — pont voix (appelé par kora-loop.js) ═══ */

// Vrai si la lecture de la réponse doit parler (toggle ON + moteur dispo).
export function koraVoiceOutputActive() { return !!_voiceOn && _outputSupported(); }

// Chauffe le moteur Piper PENDANT que decide tourne (latence masquée, §3.2).
// Écran de préparation sobre au 1er téléchargement, UNE seule fois (ensuite
// le SW a le modèle en cache → onProgress ne se déclenche plus).
export function koraWarmVoice() {
  if (!koraVoiceOutputActive() || _warming) return;
  _warming = true;
  warmUp(PIPER_VOICE, (p) => {
    if (!(p < 1)) return;                       // ~1 = fini : pas d'écran
    if (!_prepLine) _prepLine = koraSay('Je prépare ma voix…');
    if (_prepLine) _prepLine.textContent = `Je prépare ma voix… ${Math.round(p * 100)} %`;
  }).catch(() => {}).finally(() => {
    if (_prepLine) { try { _prepLine.remove(); } catch (_) {} _prepLine = null; }
    _warming = false;
  });
}

// Ouvre un flux de lecture incrémentale pour la phase answer. kora-loop.js
// lui pousse le texte cumulé (push) puis end(). onState('idle') = fin de
// lecture → le galet repasse au repos (le loop lui a laissé « travail »).
// Jeton figé à l'ouverture : un barge-in (nouveau _gen) neutralise l'idle
// périmé (sinon il forcerait « repos » par-dessus la nouvelle écoute).
export function koraOpenSpeech() {
  if (!koraVoiceOutputActive()) return null;
  const gen = _gen;
  try {
    return createSpeechStream({
      voiceId: PIPER_VOICE,
      onState: (st) => {
        if (gen !== _gen) return;               // session périmée (barge-in) → on ne touche à rien
        if (st === 'speaking') koraState('travail');   // elle parle → galet « travail »
        else if (st === 'idle') koraState('repos');    // fin de lecture → repos
      },
    });
  } catch (_) { return null; }
}

// Coupe la lecture en cours ET invalide le jeton (`_gen++`) : tout callback
// tardif (onState 'idle', transcription en retard) devient périmé et ne
// repeindra plus l'état. Utilisé par « nouvelle conversation ».
export function koraStopSpeech() {
  _gen++;
  try { stopSpeaking(); } catch (_) {}
}

// Lecture ONE-SHOT d'un texte COMPLET (réponses directes de la phase decide,
// messages d'erreur/429/annulation) — elles ne passent PAS par le flux answer.
// Réutilise le pipeline phrase-par-phrase (push tout + end). Rend le flux pour
// que kora-loop.js reporte le repos à la fin de lecture (comme le stream).
export function koraSpeakOneShot(text) {
  if (!koraVoiceOutputActive()) return null;
  const t = String(text || '').trim();
  if (!t) return null;
  const sp = koraOpenSpeech();
  if (!sp) return null;
  koraState('travail');
  sp.push(t); sp.end(t);
  return sp;
}

/* ═══ V-1 — talkie-walkie ═══ */

function _pickMime() {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg'];
  return cands.find((c) => { try { return MediaRecorder.isTypeSupported(c); } catch (_) { return false; } }) || '';
}

// Boucle d'amplitude (RMS lissé) → koraLevel : l'onde du galet suit la vraie
// voix pendant l'écoute (le retour « je suis entendu » qui manquait au SA).
function _startLevelLoop() {
  _micLevel = 0; _levelLast = performance.now();
  const tick = (now) => {
    if (!_rec || !_analyser) { _levelRAF = 0; koraLevel(0); return; }
    const dt = Math.min((now - _levelLast) / 1000, 0.1); _levelLast = now;
    _analyser.getByteTimeDomainData(_micBuf);
    let s = 0;
    for (let i = 0; i < _micBuf.length; i++) { const v = (_micBuf[i] - 128) / 128; s += v * v; }
    const rms = Math.sqrt(s / _micBuf.length);
    const t = Math.min(1, Math.max(0, (rms - MIC_FLOOR) * MIC_GAIN));
    _micLevel += (t - _micLevel) * (1 - Math.exp(-dt * (t > _micLevel ? MIC_ATTACK : MIC_RELEASE)));
    koraLevel(_micLevel);
    _levelRAF = requestAnimationFrame(tick);
  };
  _levelRAF = requestAnimationFrame(tick);
}
function _stopLevelLoop() {
  if (_levelRAF) cancelAnimationFrame(_levelRAF);
  _levelRAF = 0; koraLevel(0);
}

async function _beginRecording() {
  _holdTimer = 0;
  if (!_holding || _rec || !_inputSupported()) return;

  // Half-duplex : on coupe toute voix en cours AVANT d'ouvrir le micro.
  try { stopSpeaking(); } catch (_) {}

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    // Refus/erreur micro → message SOBRE, une seule fois, mode écrit intact.
    if (!_micDenied) {
      koraOpen();
      koraSay((e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
        ? 'Micro refusé — autorise-le dans ton navigateur, puis re-maintiens le galet pour me parler. Tu peux aussi juste écrire.'
        : 'Micro indisponible sur cet appareil — écris-moi, je réponds pareil.');
    }
    _micDenied = true;
    koraState('repos');
    return;
  }
  _micDenied = false;

  // Doigt relâché pendant l'attente getUserMedia : on n'enregistre rien.
  if (!_holding) { try { stream.getTracks().forEach((x) => x.stop()); } catch (_) {} return; }

  const mime = _pickMime();
  let mr;
  try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
  catch (_) {
    try { mr = new MediaRecorder(stream); }
    catch (_2) {
      try { stream.getTracks().forEach((x) => x.stop()); } catch (_3) {}
      koraSay('Enregistrement impossible sur cet appareil — écris-moi.');
      koraState('repos');
      return;
    }
  }

  const gen = ++_gen;                 // nouvelle session vocale
  const chunks = [];
  mr.addEventListener('dataavailable', (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); });
  mr.addEventListener('stop', () => _onRecStop());
  _rec = { stream, mr, chunks, mime: mr.mimeType || mime || 'audio/webm', t0: Date.now(), send: true, cancelZone: false, maxTimer: 0, gen };

  // Analyser pour l'onde (AudioContext créé dans le geste — repris pour iOS).
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') { _audioCtx.resume().catch(() => {}); }
    _analyser = _audioCtx.createAnalyser(); _analyser.fftSize = 1024;
    _audioCtx.createMediaStreamSource(stream).connect(_analyser);
    _micBuf = new Uint8Array(_analyser.fftSize);
  } catch (_) { _analyser = null; _micBuf = null; }

  koraOpen();
  koraState('ecoute');
  /* Latence masquée (brief §3.2, patron SA-9.2) : on chauffe la VOIX dès le
     MAINTIEN — le modèle Piper + phonémiseur + kernels ONNX se chargent
     PENDANT que tu parles et que le STT tourne, plus dans le chemin critique
     du 1er son. Ici (hold confirmé ≥150 ms), pas au pointerdown (un simple
     tap ne doit pas déclencher le téléchargement du modèle 60 Mo). No-op si
     la voix est coupée. */
  koraWarmVoice();
  try { mr.start(); }
  catch (_) { _teardownRec(); koraState('repos'); koraSay('Enregistrement impossible sur cet appareil — écris-moi.'); return; }
  _startLevelLoop();
  _rec.maxTimer = setTimeout(() => _stopRecording(true), MAX_MS);   // coupe propre à 60 s
}

function _stopRecording(send) {
  if (!_rec) return;
  _rec.send = !!send;
  if (_rec.maxTimer) { clearTimeout(_rec.maxTimer); _rec.maxTimer = 0; }
  _stopLevelLoop();
  koraState(send ? 'reflexion' : 'repos');
  _setHint('');
  try {
    if (_rec.mr && _rec.mr.state !== 'inactive') _rec.mr.stop();   // → 'stop' → _onRecStop
    else _onRecStop();
  } catch (_) { _onRecStop(); }
}

function _teardownRec() {
  const rec = _rec; _rec = null;
  _stopLevelLoop();
  if (rec) {
    if (rec.maxTimer) clearTimeout(rec.maxTimer);
    try { rec.stream.getTracks().forEach((x) => x.stop()); } catch (_) {}
  }
  if (_audioCtx) { try { _audioCtx.close(); } catch (_) {} }
  _audioCtx = null; _analyser = null; _micBuf = null;
  return rec;
}

function _onRecStop() {
  const rec = _teardownRec();
  if (!rec) return;
  if (!rec.send) { koraState('repos'); return; }               // annulé (glissé hors / cancel)
  const dur = Date.now() - rec.t0;
  const blob = new Blob(rec.chunks, { type: rec.mime });
  if (!blob.size || dur < MIN_BLOB) {
    koraState('repos');
    koraSay('Je n’ai rien entendu, réessaie.');
    return;
  }
  _transcribe(blob, rec.gen);
}

async function _transcribe(blob, gen) {
  const token = _jwt();
  if (!token) { koraState('repos'); koraSay('Je ne te reconnais pas — connecte-toi à Keystone puis reviens me voir.'); return; }
  let text = '';
  try {
    const res = await fetch(`${KORA_API}/api/kora/stt`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': blob.type || 'audio/webm' },
      body: blob,
    });
    if (gen !== _gen) return;                    // barge-in entre-temps → on jette ce résultat
    if (!res.ok) {
      koraState('repos');
      koraSay(res.status === 413 ? 'C’était un peu long — refais-moi ça plus court.'
                                 : 'Je n’ai pas réussi à t’entendre — réessaie dans un instant.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    text = String(data && data.text || '').trim();
  } catch (_) {
    if (gen !== _gen) return;
    koraState('repos');
    koraSay('Petit souci réseau pour te transcrire — réessaie.');
    return;
  }
  if (gen !== _gen) return;
  if (!text) { koraState('repos'); koraSay('Je n’ai rien entendu, réessaie.'); return; }
  koraSubmit(text);                              // le texte entre dans la boucle comme s'il était tapé
}

/* ═══ Gestes pointer sur le galet ═══ */

function _outsideGalet(e) {
  if (!_galet) return false;
  const r = _galet.getBoundingClientRect();
  const m = CANCEL_MARGIN;
  return e.clientX < r.left - m || e.clientX > r.right + m
      || e.clientY < r.top - m  || e.clientY > r.bottom + m;
}

function _onPointerDown(e) {
  if (e.button != null && e.button !== 0) return;        // clic secondaire ignoré
  if (_holding) return;

  // Barge-in : un appui pendant que Kora parle coupe la voix immédiatement
  // (le texte, lui, continue de s'écrire côté loop). Puis on (re)bénit l'audio.
  if (koraVoiceOutputActive()) { try { stopSpeaking(); } catch (_) {} try { primeAudio(); } catch (_) {} }

  // Micro absent : on ne vole pas le tap — le clic natif ouvre/ferme la fenêtre.
  if (!_inputSupported()) return;

  _holding = true; _pointerId = e.pointerId;
  _downX = e.clientX; _downY = e.clientY;
  addEventListener('pointerup', _onPointerUp, true);
  addEventListener('pointermove', _onPointerMove, true);
  addEventListener('pointercancel', _onPointerCancel, true);
  _holdTimer = setTimeout(_beginRecording, HOLD_MS);      // ≥150 ms = parler ; sinon = tap
}

function _onPointerMove(e) {
  if (!_holding || !_rec) return;
  const out = _outsideGalet(e);
  if (out !== _rec.cancelZone) {
    _rec.cancelZone = out;
    _setHint(out ? 'Relâche pour annuler' : 'à l’écoute…');
  }
}

function _endHold() {
  _holding = false; _pointerId = null;
  if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = 0; }
  removeEventListener('pointerup', _onPointerUp, true);
  removeEventListener('pointermove', _onPointerMove, true);
  removeEventListener('pointercancel', _onPointerCancel, true);
}

function _onPointerUp() {
  const wasRecording = !!_rec;
  const cancel = _rec ? _rec.cancelZone : false;
  _endHold();
  if (wasRecording) {
    // Maintien long → on avale le CLIC qui suit (sinon la fenêtre basculerait).
    _armClickSuppression();
    _stopRecording(!cancel);
  }
  // Sinon : tap court → on laisse le clic natif ouvrir/fermer (comportement actuel).
}

function _onPointerCancel() {
  const wasRecording = !!_rec;
  _endHold();
  if (wasRecording) { _armClickSuppression(); _stopRecording(false); }
}

// Le clic qui suit un maintien long doit être neutralisé AVANT le handler de
// bascule (posé par kora.js sur le galet). Écouteur en CAPTURE sur document →
// s'exécute avant les handlers de la cible. Auto-nettoyage si aucun clic ne
// suit (maintien glissé sans clic) pour ne pas manger un vrai tap ultérieur.
function _armClickSuppression() {
  _suppressClick = true;
  if (_suppressTimer) clearTimeout(_suppressTimer);
  _suppressTimer = setTimeout(() => { _suppressClick = false; _suppressTimer = 0; }, 700);
}
function _onClickCapture(e) {
  if (!_suppressClick) return;
  if (!_galet || !(_galet === e.target || _galet.contains(e.target))) return;
  _suppressClick = false;
  if (_suppressTimer) { clearTimeout(_suppressTimer); _suppressTimer = 0; }
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  e.preventDefault();
}

/* ═══ Toggle voix (dans la fenêtre) ═══ */

function _applyToggleUI() {
  if (!_toggleBtn) return;
  _toggleBtn.innerHTML = icon(_voiceOn ? 'volume-2' : 'volume-x', 16);
  _toggleBtn.classList.toggle('kora-voice-on', _voiceOn);
  _toggleBtn.setAttribute('aria-pressed', _voiceOn ? 'true' : 'false');
  _toggleBtn.title = _voiceOn ? 'Voix activée — Kora lit ses réponses' : 'Voix coupée — réponses écrites';
}
function _toggleVoice() {
  _voiceOn = !_voiceOn;
  try { localStorage.setItem('kora_voice_on', _voiceOn ? '1' : '0'); } catch (_) {}
  _applyToggleUI();
  if (_voiceOn) {
    try { primeAudio(); } catch (_) {}       // geste utilisateur → audio débloqué
    koraWarmVoice();                          // le modèle se télécharge pendant qu'on discute
  } else {
    try { stopSpeaking(); } catch (_) {}
  }
}
function _buildToggle() {
  if (!_panel || !_outputSupported()) return;   // pas de moteur voix → pas de bouton
  const head = _panel.querySelector('.kora-headtools') || _panel.querySelector('.kora-head');
  if (!head || head.querySelector('.kora-voicetoggle')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'kora-voicetoggle';
  btn.setAttribute('aria-label', 'Activer ou couper la voix de Kora');
  btn.addEventListener('click', _toggleVoice);
  head.appendChild(btn);
  _toggleBtn = btn;
  _applyToggleUI();
}

/* ═══ Init ═══ */
export function initKoraVoice({ galet, panel } = {}) {
  if (_inited || !galet || !panel) return;
  _galet = galet; _panel = panel;
  try { _voiceOn = localStorage.getItem('kora_voice_on') === '1'; } catch (_) { _voiceOn = false; }

  _buildToggle();

  // Talkie-walkie sur le galet. Les écouteurs vivent sur l'élément galet lui-
  // même (survit à ses déplacements cc-bar ↔ header d'outil). La suppression
  // du clic est en capture sur document (avant le handler de bascule).
  _galet.addEventListener('pointerdown', _onPointerDown);
  document.addEventListener('click', _onClickCapture, true);
  // Empêche le menu contextuel / la sélection pendant un maintien long.
  _galet.addEventListener('contextmenu', (e) => { if (_rec) e.preventDefault(); });

  _inited = true;
}
