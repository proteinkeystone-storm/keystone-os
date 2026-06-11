/* ═══════════════════════════════════════════════════════════════════
   Moteur TTS « Piper maison » — voix neuronale française, auto-hébergée.

   On NE passe PAS par la lib @mintplex-labs/piper-tts-web : son phonémiseur
   Emscripten, servi via esm.sh, appelle module.require (polyfills unenv) et
   casse dans le navigateur. On pilote donc directement les composants, tous
   en same-origin (/app/vendor/) :
     1. ONNX Runtime Web (ort.min.mjs, loader NON-jsep, mono-thread → pas de
        SharedArrayBuffer requis) ;
     2. piper_phonemize (espeak-ng, UMD chargé en <script>) → phoneme_ids ;
     3. modèle .onnx + .onnx.json → inférence → PCM → WAV.

   Chargement paresseux : rien n'est téléchargé tant qu'on n'appelle pas
   synthToWav(). Le service worker met /app/vendor/ en cache (offline + rapide).
   ═══════════════════════════════════════════════════════════════════ */

const ORT_BASE    = '/app/vendor/onnx/';
const PHON_BASE   = '/app/vendor/piper/';
const VOICES_BASE = '/app/vendor/piper-voices';

// Voix disponibles en local. Clé UI → chemin du modèle sous VOICES_BASE.
export const VOICES = {
  'fr_FR-siwis-medium': 'fr_FR-siwis-medium.onnx',
};
export const DEFAULT_VOICE = 'fr_FR-siwis-medium';

let _ort = null, _phonLoaded = false;
const _sessions = {}, _configs = {};

export function isSupported() {
  return typeof WebAssembly !== 'undefined';
}

async function ensureOrt() {
  if (_ort) return _ort;
  const m = await import(ORT_BASE + 'ort.min.mjs');
  m.env.wasm.numThreads = 1;          // mono-thread → mémoire non partagée, pas de SAB
  m.env.wasm.wasmPaths = ORT_BASE;
  _ort = m;
  return m;
}

async function ensurePhonemizer() {
  if (_phonLoaded && window.createPiperPhonemize) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = PHON_BASE + 'piper_phonemize.js';
    s.onload = res;
    s.onerror = () => rej(new Error('échec chargement phonémiseur'));
    document.head.appendChild(s);
  });
  _phonLoaded = true;
}

async function getConfig(voiceId) {
  if (_configs[voiceId]) return _configs[voiceId];
  const c = await (await fetch(VOICES_BASE + '/' + VOICES[voiceId] + '.json')).json();
  _configs[voiceId] = c;
  return c;
}

// Télécharge le modèle (avec progression) puis crée la session ONNX (mise en cache).
async function getSession(voiceId, onProgress) {
  if (_sessions[voiceId]) return _sessions[voiceId];
  const ort = await ensureOrt();
  const r = await fetch(VOICES_BASE + '/' + VOICES[voiceId]);
  const total = +r.headers.get('content-length') || 0;
  const reader = r.body.getReader();
  const chunks = []; let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.length;
    if (total && onProgress) onProgress(loaded / total);
  }
  const bytes = new Uint8Array(loaded); let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  const s = await ort.InferenceSession.create(bytes);
  _sessions[voiceId] = s;
  return s;
}

// Texte → phoneme_ids (mapping + BOS/EOS/pad déjà inclus par piper_phonemize).
async function phonemize(text, voice) {
  await ensurePhonemizer();
  let ids = null;
  const mod = await window.createPiperPhonemize({
    print: (w) => { try { ids = JSON.parse(w).phoneme_ids; } catch (_) {} },
    printErr: () => {},
    locateFile: (w) => w.endsWith('.wasm') ? PHON_BASE + 'piper_phonemize.wasm'
                     : w.endsWith('.data') ? PHON_BASE + 'piper_phonemize.data' : w,
  });
  mod.callMain(['-l', voice || 'fr', '--input', JSON.stringify([{ text: (text || '').trim() }]), '--espeak_data', '/espeak-ng-data']);
  return ids;
}

function pcmToWav(f32, sr) {
  const len = f32.length, buf = new ArrayBuffer(44 + len * 2), dv = new DataView(buf);
  let p = 0;
  const S = (s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); };
  const U32 = (v) => { dv.setUint32(p, v, true); p += 4; };
  const U16 = (v) => { dv.setUint16(p, v, true); p += 2; };
  S('RIFF'); U32(36 + len * 2); S('WAVE'); S('fmt '); U32(16); U16(1); U16(1);
  U32(sr); U32(sr * 2); U16(2); U16(16); S('data'); U32(len * 2);
  for (let i = 0; i < len; i++) { let s = Math.max(-1, Math.min(1, f32[i])); dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true); p += 2; }
  return new Blob([buf], { type: 'audio/wav' });
}

// Synthétise `text` avec `voiceId` → Blob WAV. onProgress(0..1) suit le 1er
// téléchargement du modèle (ensuite il est en cache, onProgress n'est pas rappelé).
export async function synthToWav(text, voiceId = DEFAULT_VOICE, onProgress) {
  const cfg = await getConfig(voiceId);
  const ort = await ensureOrt();
  const session = await getSession(voiceId, onProgress);
  const ids = await phonemize(text, (cfg.espeak && cfg.espeak.voice) || 'fr');
  if (!ids || !ids.length) throw new Error('phonémisation vide');
  const inf = cfg.inference || {};
  const input = new ort.Tensor('int64', BigInt64Array.from(ids.map((x) => BigInt(x))), [1, ids.length]);
  const input_lengths = new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]);
  const scales = new ort.Tensor('float32', Float32Array.from([
    inf.noise_scale != null ? inf.noise_scale : 0.667,
    inf.length_scale != null ? inf.length_scale : 1,
    inf.noise_w != null ? inf.noise_w : 0.8,
  ]), [3]);
  const out = await session.run({ input, input_lengths, scales });
  return pcmToWav(out.output.data, (cfg.audio && cfg.audio.sample_rate) || 22050);
}

// Vrai si la voix de ce modèle est déjà téléchargée/initialisée (pas de gros DL).
export function isVoiceReady(voiceId = DEFAULT_VOICE) {
  return !!_sessions[voiceId];
}
