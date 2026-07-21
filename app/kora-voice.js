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

/* ── Réglages talkie-walkie ──
   Surface d'émission = le BOUTON VOIX (galet) à droite d'« Envoyer » dans la
   barre de saisie (direction validée par Stéphane le 21/07 ; l'ancien maintien
   du galet-header a été abandonné). Maintien = parler ; la zone de saisie
   devient le bandeau d'enregistrement ; glisser vers la GAUCHE = annuler. */
const MAX_MS   = 60000;  // coupe propre à 60 s (§4)
const MIN_BLOB = 700;    // ms mini pour envoyer (sinon « rien entendu »)
const MIN_TAP  = 300;    // < 300 ms = tap accidentel → annulation SILENCIEUSE (pas de bulle)
const CANCEL_DX = 56;    // px de glissé vers la gauche = zone d'annulation

/* ── Constantes micro (VERBATIM harnais) ── */
const MIC_FLOOR = 0.012, MIC_GAIN = 5.5, MIC_ATTACK = 30, MIC_RELEASE = 9;

/* ── État module ── */
let _inited = false;
let _galet = null, _panel = null;
let _voiceOn = false;                 // préférence device (lecture de la réponse)
let _toggleBtn = null;

let _gen = 0;                         // jeton de génération (barge-in / callbacks tardifs)
let _micDenied = false;              // refus mémorisé (§6 piège 11 : pas de re-prompt en boucle)

let _holding = false, _startX = 0;   // geste en cours sur le bouton voix

let _rec = null;                     // enregistrement en cours { stream, mr, chunks, mime, t0, send, cancelZone, maxTimer, gen }
let _audioCtx = null, _analyser = null, _micBuf = null;
let _micLevel = 0, _levelRAF = 0, _levelLast = 0;

/* bouton voix + bandeau d'enregistrement (câblés par attachVoiceBar) */
let _bar = null, _talkBtn = null, _rsTimer = null, _rsHint = null, _secTimer = 0;
let _talkCv = null, _talkCtx = null, _rsCv = null, _rsCtx = null, _drawRAF = 0;
let _visActive = 0, _visLevel = 0;   // valeurs lissées pour l'animation des ondes

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
        ? 'Micro refusé — autorise-le dans ton navigateur, puis re-maintiens le bouton voix pour me parler. Tu peux aussi juste écrire.'
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

  koraState('ecoute');
  /* Latence masquée (brief §3.2, patron SA-9.2) : on chauffe la VOIX dès le
     MAINTIEN — le modèle Piper + phonémiseur + kernels ONNX se chargent
     PENDANT que tu parles et que le STT tourne, plus dans le chemin critique
     du 1er son. No-op si la voix est coupée. */
  koraWarmVoice();
  try { mr.start(); }
  catch (_) { _teardownRec(); koraState('repos'); koraSay('Enregistrement impossible sur cet appareil — écris-moi.'); return; }
  _startLevelLoop();
  _showRecUI(true);                                                 // la saisie → bandeau d'enregistrement
  _rec.maxTimer = setTimeout(() => _stopRecording(true), MAX_MS);   // coupe propre à 60 s
}

function _stopRecording(send) {
  if (!_rec) return;
  _rec.send = !!send;
  if (_rec.maxTimer) { clearTimeout(_rec.maxTimer); _rec.maxTimer = 0; }
  _stopLevelLoop();
  koraState(send ? 'reflexion' : 'repos');
  try {
    if (_rec.mr && _rec.mr.state !== 'inactive') _rec.mr.stop();   // → 'stop' → _onRecStop
    else _onRecStop();
  } catch (_) { _onRecStop(); }
}

function _teardownRec() {
  const rec = _rec; _rec = null;
  _stopLevelLoop();
  _showRecUI(false);                 // le bandeau redevient la barre de saisie
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

/* ═══ Bandeau d'enregistrement (la barre de saisie se transforme) ═══ */
function _fmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function _showRecUI(on) {
  if (!_bar) return;
  if (on) {
    _bar.classList.add('kora-rec'); _bar.classList.remove('kora-cancel');
    if (_talkBtn) { _talkBtn.classList.add('kora-rec'); _talkBtn.classList.remove('kora-cancel'); }
    if (_rsTimer) _rsTimer.textContent = '0:00';
    if (_rsHint) _rsHint.textContent = 'glisse ← pour annuler';
    if (_secTimer) clearInterval(_secTimer);
    const t0 = Date.now();
    _secTimer = setInterval(() => { if (_rsTimer) _rsTimer.textContent = _fmt(Math.floor((Date.now() - t0) / 1000)); }, 500);
  } else {
    _bar.classList.remove('kora-rec', 'kora-cancel');
    if (_talkBtn) _talkBtn.classList.remove('kora-rec', 'kora-cancel');
    if (_secTimer) { clearInterval(_secTimer); _secTimer = 0; }
  }
}
function _setCancelUI(on) {
  if (_bar) _bar.classList.toggle('kora-cancel', on);
  if (_talkBtn) _talkBtn.classList.toggle('kora-cancel', on);
  if (_rsHint) _rsHint.textContent = on ? 'relâche pour annuler' : 'glisse ← pour annuler';
}

/* ═══ Onde du bouton voix + du bandeau — reprend l'esprit du galet
   (violet au repos → turquoise à l'écoute, amplitude = vraie voix) ═══ */
const _REST_A = [125, 107, 240], _REST_B = [74, 125, 245],
      _TEAL_A = [26, 224, 158], _TEAL_B = [38, 191, 217], _ROSE = [240, 112, 138];
function _lerp3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
function _sizeCanvas(cv) {
  const dpr = Math.min(devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
  const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return dpr;
}
function _drawBars(cv, ctx, n, t, active, lvl, cancel) {
  const dpr = _sizeCanvas(cv), w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const gap = Math.max(2, 2 * dpr), bw = (w - gap * (n - 1)) / n, mid = h / 2;
  for (let i = 0; i < n; i++) {
    const ph = t * 2.1 + i * 0.55;
    const env = 0.35 + 0.65 * Math.abs(Math.sin(i / n * Math.PI));
    const amp = (0.18 + active * 0.30) + lvl * 0.6 * active;
    let hh = (0.12 + amp * env * (0.5 + 0.5 * Math.sin(ph)) + 0.05 * Math.sin(ph * 2.3)) * h;
    hh = Math.max(2.4 * dpr, Math.min(h * 0.94, hh));
    const k = i / (n - 1);
    let col = cancel ? _ROSE : (active > 0.5 ? _lerp3(_TEAL_A, _TEAL_B, k) : _lerp3(_REST_A, _REST_B, k));
    col = _lerp3(col, [255, 255, 255], 0.10 * (0.5 + 0.5 * Math.sin(ph)));
    ctx.fillStyle = 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',' + (0.6 + 0.35 * active) + ')';
    const x = i * (bw + gap), rr = Math.min(bw / 2, 2.4 * dpr), y = mid - hh / 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, hh, rr); else ctx.rect(x, y, bw, hh);
    ctx.fill();
  }
}
function _drawTick(now) {
  _drawRAF = requestAnimationFrame(_drawTick);
  if (!_panel || !_panel.classList.contains('kora-open')) return;   // fenêtre fermée = bouton invisible
  const t = (now || 0) / 1000;
  _visActive += ((_rec ? 1 : 0) - _visActive) * 0.12;
  _visLevel  += ((_rec ? _micLevel : 0) - _visLevel) * 0.15;
  const cancel = !!(_rec && _rec.cancelZone);
  if (_talkCtx) _drawBars(_talkCv, _talkCtx, 9, t, _visActive, _visLevel, cancel);
  if (_rsCtx) {
    if (_rec) _drawBars(_rsCv, _rsCtx, 20, t, 1, _visLevel, cancel);
    else _rsCtx.clearRect(0, 0, _rsCv.width, _rsCv.height);
  }
}

/* ═══ Geste : maintien du bouton voix, glisser vers la GAUCHE = annuler ═══ */
function _onTalkDown(e) {
  if (e.button != null && e.button !== 0) return;   // clic secondaire ignoré
  if (_holding || _rec) return;
  e.preventDefault();
  try { _talkBtn.setPointerCapture(e.pointerId); } catch (_) {}
  // barge-in : couper la voix si elle parle + (re)bénir l'audio DANS le geste
  if (koraVoiceOutputActive()) { try { stopSpeaking(); } catch (_) {} try { primeAudio(); } catch (_) {} }
  if (!_inputSupported()) {
    if (!_micDenied) koraSay('L’enregistrement vocal n’est pas disponible sur cet appareil — écris-moi, je réponds pareil.');
    _micDenied = true; return;
  }
  _holding = true; _startX = e.clientX;
  /* page non sélectionnable pendant le maintien (anti-callout/sélection iOS) */
  try { document.body.classList.add('kora-holding'); } catch (_) {}
  try { const s = window.getSelection && window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (_) {}
  addEventListener('pointermove', _onTalkMove, true);
  addEventListener('pointerup', _onTalkUp, true);
  addEventListener('pointercancel', _onTalkUp, true);
  _beginRecording();   // bouton dédié : on démarre tout de suite (pas de délai anti-tap)
}
function _onTalkMove(e) {
  if (!_holding || !_rec) return;
  const cz = (_startX - e.clientX) > CANCEL_DX;   // glissé vers la GAUCHE (vers le champ)
  if (cz !== _rec.cancelZone) { _rec.cancelZone = cz; _setCancelUI(cz); }
}
function _endHold() {
  _holding = false;
  try { document.body.classList.remove('kora-holding'); } catch (_) {}
  removeEventListener('pointermove', _onTalkMove, true);
  removeEventListener('pointerup', _onTalkUp, true);
  removeEventListener('pointercancel', _onTalkUp, true);
}
function _onTalkUp() {
  const rec = _rec;
  _endHold();
  if (!rec) return;                       // getUserMedia pas résolu / relâché trop tôt
  const dur = Date.now() - rec.t0, cancel = rec.cancelZone;
  const tooShort = dur < MIN_TAP && !cancel;   // tap accidentel → annulation SILENCIEUSE
  _stopRecording(!cancel && !tooShort);
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

/* ═══ Bouton voix (galet à droite d'« Envoyer ») — surface d'émission ═══
   Appelé par kora-loop.js quand la barre de saisie est construite. Le galet
   du header redevient un simple tap ouvre/ferme (kora.js) + témoin d'état. */
export function attachVoiceBar(bar) {
  if (!bar || _talkBtn) return;
  _bar = bar;
  _panel = _panel || bar.closest('.kora-panel');
  _rsTimer = bar.querySelector('.kora-rs-timer');
  _rsHint  = bar.querySelector('.kora-rs-hint');
  _rsCv    = bar.querySelector('.kora-rs-wave');
  if (_rsCv) _rsCtx = _rsCv.getContext('2d');

  if (!_inputSupported()) return;   // pas de micro → barre en mode écrit seul, aucun bouton voix

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'kora-talk';
  btn.title = 'Maintiens pour me parler';
  btn.setAttribute('aria-label', 'Maintiens pour me parler');
  const cv = document.createElement('canvas');
  cv.className = 'kora-talk-galet';
  btn.appendChild(cv);
  bar.appendChild(btn);                       // à droite d'« Envoyer »
  _talkBtn = btn; _talkCv = cv; _talkCtx = cv.getContext('2d');

  btn.addEventListener('pointerdown', _onTalkDown);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());   // pas de menu au maintien
  if (!_drawRAF) _drawRAF = requestAnimationFrame(_drawTick);       // onde vivante du bouton
}

/* ═══ Init ═══ */
export function initKoraVoice({ galet, panel } = {}) {
  if (_inited || !galet || !panel) return;
  _galet = galet; _panel = panel;
  try { _voiceOn = localStorage.getItem('kora_voice_on') === '1'; } catch (_) { _voiceOn = false; }
  _buildToggle();                 // toggle voix dans l'en-tête (le bouton voix, lui, vient d'attachVoiceBar)
  _inited = true;
}
