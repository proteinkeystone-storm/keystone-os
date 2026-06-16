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

// ── Phonémiseur : instance PERSISTANTE (SA-9.2, chasse à la latence) ──
// Avant : une instance Emscripten neuve PAR PHRASE — or sa création
// remonte les 18 Mo d'espeak-ng-data dans le système de fichiers virtuel
// à chaque fois (0,3-1 s sur ordinateur, jusqu'à plusieurs secondes sur
// mobile : c'était la 1re cause du « on a le temps de lire avant
// d'entendre »). Ici : UNE instance réutilisée tant que le build le
// permet ; s'il est « one-shot » (runtime qui s'éteint après callMain,
// détecté au 1er recyclage raté), la SUIVANTE se précrée en arrière-plan
// pendant la lecture — plus jamais ce coût dans le chemin critique.
let _phonInst = null;      // instance prête à servir (une fois)
let _phonNext = null;      // promesse de l'instance suivante (pré-création)

async function _newPhonInstance() {
  await ensurePhonemizer();
  const box = {};
  const inst = await window.createPiperPhonemize({
    print: (w) => { try { box.ids = JSON.parse(w).phoneme_ids; } catch (_) {} },
    printErr: () => {},
    locateFile: (w) => w.endsWith('.wasm') ? PHON_BASE + 'piper_phonemize.wasm'
                     : w.endsWith('.data') ? PHON_BASE + 'piper_phonemize.data' : w,
  });
  inst.__run = (args) => { box.ids = null; inst.callMain(args); return box.ids; };
  return inst;
}

async function _phonInstance() {
  if (_phonInst) return _phonInst;
  const pending = _phonNext;
  _phonNext = null;
  let inst = null;
  if (pending) { try { inst = await pending; } catch (_) { inst = null; } }
  _phonInst = inst || await _newPhonInstance();
  return _phonInst;
}

// Pré-crée l'instance suivante si aucune n'est prête ni en route. À appeler
// HORS du chemin critique (après l'inférence) : la compilation WASM et le
// montage des 18 Mo partagent le thread principal avec ONNX — lancés pendant
// une inférence, ils la ralentissent d'autant.
function _ensureNextPhon() {
  if (!_phonInst && !_phonNext) _phonNext = _newPhonInstance().catch(() => null);
}

async function phonemize(text, voice) {
  const args = ['-l', voice || 'fr', '--input', JSON.stringify([{ text: (text || '').trim() }]), '--espeak_data', '/espeak-ng-data'];
  // Build MESURÉ one-shot (un 2e callMain sur la même instance lève un
  // ExitStatus) : chaque run consomme son instance ; la suivante est
  // pré-créée par synthToWav APRÈS l'inférence (jamais en concurrence).
  let inst = await _phonInstance();
  let ids = null;
  try { ids = inst.__run(args); } catch (_) { ids = null; }
  _phonInst = null;
  if (!ids || !ids.length) {
    // run raté (instance abîmée ?) → un 2e essai sur une instance neuve
    inst = await _phonInstance();
    try { ids = inst.__run(args); } catch (_) { ids = null; }
    _phonInst = null;
  }
  if (!ids || !ids.length) throw new Error('phonémisation vide');
  return ids;
}

// SA-9.4 — taille les silences que le modèle génère en tête et en queue de
// chaque phrase (~0,2-0,5 s chacun) : lus phrase par phrase, ils
// s'additionnaient à chaque jonction (queue + tête = pause à rallonge entre
// les phrases). Marges conservées pour ne pas écorner l'attaque ni la chute
// (consonnes douces en fin de mot). Pur → testé.
export function trimSilence(f32, sr, { threshold = 0.008, headMs = 30, tailMs = 50 } = {}) {
  const n = f32.length;
  if (!n) return f32;
  let start = 0, end = n - 1;
  while (start < n && Math.abs(f32[start]) < threshold) start++;
  while (end > start && Math.abs(f32[end]) < threshold) end--;
  if (start >= end) return f32;   // tout-silence ou signal introuvable : intact
  const head = Math.round(sr * headMs / 1000);
  const tail = Math.round(sr * tailMs / 1000);
  start = Math.max(0, start - head);
  end = Math.min(n - 1, end + tail);
  return f32.subarray ? f32.subarray(start, end + 1) : f32.slice(start, end + 1);
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

/* ═══ SA-9.5 — normalisation « écrit → dit » ═════════════════════════
   Le phonémiseur lit le texte tel quel : « 20h30 » devenait « vingt
   h trente » et « Keystone OS » … « keystone os » (l'os !). On réécrit
   AVANT la phonémisation ce qui se prononce autrement que ça s'écrit :
   heures, puis sigles épelés à la française (frontières de mots et
   CASSE STRICTE : « OS » majuscule est épelé, « les os » reste intact).
   Lexique volontairement ciblé (écosystème + commerce) — extensible. */
const SPEECH_RULES = [
  // Heures : 20h30 → « 20 heures 30 » · 9h00 → « 9 heures » · 9h → « 9 heures » · 1h → « 1 heure »
  [/\b(\d{1,2})\s*[hH]\s*(\d{2})\b/g, (m, h, mn) => `${h} ${h === '1' ? 'heure' : 'heures'}${mn === '00' ? '' : ' ' + mn}`],
  [/\b(\d{1,2})\s*[hH]\b/g,           (m, h)     => `${h} ${h === '1' ? 'heure' : 'heures'}`],
  // Tailles de fichiers : 60 Mo → « 60 mégaoctets »
  [/\b(\d+)\s*Mo\b/g, '$1 mégaoctets'],
  [/\b(\d+)\s*Go\b/g, '$1 gigaoctets'],
  // Abréviation courante : RDV → le mot, pas l'épellation
  [/\bRDV\b/g, 'rendez-vous'],
  // Sigles épelés (noms de lettres écrits pour une lecture sûre)
  [/\bOS\b/g,   'o-èsse'],
  [/\bQR\b/g,   'ku-èrre'],
  [/\bSAV\b/g,  'èsse-a-vé'],
  [/\bIA\b/g,   'i-a'],
  [/\bPDF\b/g,  'pé-dé-èffe'],
  [/\bURL\b/g,  'u-èrre-èlle'],
  [/\bRGPD\b/g, 'èrre-gé-pé-dé'],
  [/\bFAQ\b/g,  'èffe-a-ku'],
  [/\bCSV\b/g,  'cé-èsse-vé'],
  [/\bTVA\b/g,  'té-vé-a'],
  [/\bTTC\b/g,  'té-té-cé'],
  [/\bHT\b/g,   'ache-té'],
  [/\bPMR\b/g,  'pé-èmme-èrre'],
  [/\bSMS\b/g,  'èsse-èmme-èsse'],
  [/\bCB\b/g,   'cé-bé'],
];
// Le modèle peut répondre en Markdown (**gras**, listes, titres #, `code`,
// liens). Sans nettoyage, la voix lit « étoile étoile gras étoile étoile ».
// On retire le balisage AVANT la diction (et donc avant la phonémisation).
// Volontairement SANS lookbehind (compat Safari iOS) : on supprime simplement
// les marqueurs ; les traits d'union (après-guerre, Lt-Col, 1961-1965) et les
// underscores (snake_case) sont préservés.
function stripMarkdownForSpeech(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' ')         // blocs de code ``` ```
    .replace(/`/g, '')                       // code `inline`
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')   // images ![alt](url)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // liens [libellé](url) → libellé
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')      // titres # ## ###
    .replace(/^\s{0,3}>\s?/gm, '')           // citations >
    .replace(/^\s{0,3}[-+]\s+/gm, '')        // puces de liste (- +) en début de ligne
    .replace(/\*/g, '')                      // **gras**, *italique*, * puces → l'étoile disparaît
    .replace(/~~/g, '');                     // ~~barré~~
}

export function normalizeForSpeech(text) {
  let s = stripMarkdownForSpeech(text);
  for (const [re, rep] of SPEECH_RULES) s = s.replace(re, rep);
  return s;
}

// Cache des WAV déjà générés (SA-9.2) : accueil, replis et bulles
// réécoutées ressortent instantanément. LRU borné (~24 phrases ≈ 7 Mo).
const _wavCache = new Map();
const WAV_CACHE_MAX = 24;
function _wavCacheGet(k) {
  const v = _wavCache.get(k);
  if (v) { _wavCache.delete(k); _wavCache.set(k, v); }
  return v || null;
}
function _wavCachePut(k, v) {
  _wavCache.set(k, v);
  if (_wavCache.size > WAV_CACHE_MAX) _wavCache.delete(_wavCache.keys().next().value);
}

// Synthétise `text` avec `voiceId` → Blob WAV. onProgress(0..1) suit le 1er
// téléchargement du modèle (ensuite il est en cache, onProgress n'est pas rappelé).
export async function synthToWav(text, voiceId = DEFAULT_VOICE, onProgress) {
  const cacheKey = voiceId + '::' + String(text || '').trim();
  const hit = _wavCacheGet(cacheKey);
  if (hit) return hit;
  const cfg = await getConfig(voiceId);
  const ort = await ensureOrt();
  const session = await getSession(voiceId, onProgress);
  const ids = await phonemize(normalizeForSpeech(text), (cfg.espeak && cfg.espeak.voice) || 'fr');
  const inf = cfg.inference || {};
  const input = new ort.Tensor('int64', BigInt64Array.from(ids.map((x) => BigInt(x))), [1, ids.length]);
  const input_lengths = new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]);
  const scales = new ort.Tensor('float32', Float32Array.from([
    inf.noise_scale != null ? inf.noise_scale : 0.667,
    inf.length_scale != null ? inf.length_scale : 1,
    inf.noise_w != null ? inf.noise_w : 0.8,
  ]), [3]);
  const out = await session.run({ input, input_lengths, scales });
  const sr = (cfg.audio && cfg.audio.sample_rate) || 22050;
  const wav = pcmToWav(trimSilence(out.output.data, sr), sr);
  _wavCachePut(cacheKey, wav);
  _ensureNextPhon();   // l'instance suivante se monte maintenant, hors du chemin du son
  return wav;
}

// Vrai si la voix de ce modèle est déjà téléchargée/initialisée (pas de gros DL).
export function isVoiceReady(voiceId = DEFAULT_VOICE) {
  return !!_sessions[voiceId];
}

/* ═══ SA-8.4 — LECTURE PILOTÉE : file « phrase par phrase » ═══════════
   Avant : tout le texte était synthétisé d'un bloc → 5-15 s de silence
   avant le premier son. Ici : la 1re phrase part dès qu'elle est prête,
   la suivante se génère PENDANT la lecture (pipeline). Un SEUL élément
   <audio> est réutilisé : « béni » par un geste utilisateur (primeAudio),
   il garde le droit de jouer les play() asynchrones sur iOS.            */

let _current = null;   // lecture en cours { cancelled } — une seule à la fois

// L'élément audio partagé. window.__ksTtsAudio permet aux surfaces de le
// « bénir » dans un handler de geste AVANT même que ce module soit importé
// (un import dynamique romprait la chaîne du geste sur iOS).
function _getAudio() {
  try {
    if (!window.__ksTtsAudio) window.__ksTtsAudio = new Audio();
    return window.__ksTtsAudio;
  } catch (_) { return null; }
}

// WAV silencieux minimal (44 octets d'en-tête, 0 échantillon) en Blob —
// la CSP media-src n'autorise pas data:, on fabrique le blob nous-mêmes.
export function silentWavBlob() {
  return pcmToWav(new Float32Array(0), 22050);
}

// À appeler DANS un handler de geste (clic haut-parleur, envoi, tap bulle) :
// jouer un silence débloque l'élément pour toutes les lectures suivantes.
export function primeAudio() {
  try {
    const a = _getAudio();
    if (!a || a.__primed || _current) return;   // jamais pendant/apres une lecture (écraserait src)
    a.src = URL.createObjectURL(silentWavBlob());
    a.play().then(() => { a.__primed = true; }).catch(() => {});
  } catch (_) {}
}

// SA-9.2 — raccourcit la PREMIÈRE phrase si elle est longue : la latence
// du premier son est proportionnelle à la longueur de la première
// inférence. Au-delà de 95 caractères, on coupe à une virgule (ou ; :)
// située entre 30 et 95 — le reste redevient une entrée de la file.
export function shortenFirst(sentences) {
  if (!Array.isArray(sentences) || !sentences.length) return sentences || [];
  const first = sentences[0];
  if (first.length <= 95) return sentences;
  let cut = -1;
  for (const m of first.matchAll(/[,;:]\s/g)) {
    if (m.index >= 30 && m.index <= 95) cut = m.index + 1;
    if (m.index > 95) break;
  }
  if (cut === -1) return sentences;
  return [first.slice(0, cut).trim(), first.slice(cut).trim(), ...sentences.slice(1)];
}

// Découpe un texte en phrases « lisibles » : coupe après . ! ? …, regroupe
// les fragments trop courts (sigles, « Oui. ») pour éviter une diction hachée.
export function splitSentences(text) {
  // Les SAUTS DE LIGNE sont des frontières dures. Un sommaire en liste n'a pas
  // de point final, et « 4. » / « 5. » contiennent un point : sans ça, le
  // découpage collait le numéro de l'item SUIVANT à la fin de la ligne
  // précédente (« …en Syrie CINQ. »). On transforme aussi « 4. » en tête de
  // ligne en « 4, » → le numéro reste lu AVEC son item (virgule = légère
  // pause), sans créer de fausse fin de phrase.
  const lines = String(text || '')
    .replace(/^[ \t]*(\d{1,3})[.)]\s+/gm, '$1, ')
    .split(/\n+/);
  const out = [];
  for (const lineRaw of lines) {
    const s = lineRaw.replace(/[ \t]+/g, ' ').trim();
    if (!s) continue;
    const parts = (s.match(/[^.!?…]+[.!?…]+["»)\]]?\s*|[^.!?…]+$/g) || [s])
      .map(x => x.trim()).filter(Boolean);
    const lineStart = out.length;   // ne JAMAIS fusionner par-dessus un saut de ligne
    for (const p of parts) {
      if (out.length > lineStart && (out[out.length - 1].length < 25 || p.length < 12)) {
        out[out.length - 1] += ' ' + p;
      } else {
        out.push(p);
      }
    }
  }
  return out;
}

// Précharge tout le moteur SANS rien faire entendre — à lancer dès que
// l'utilisateur active la lecture ET à chaque envoi de message (les
// secondes d'attente de la réponse IA chauffent le moteur gratuitement).
// SA-9.2 : précharge aussi l'INSTANCE du phonémiseur (18 Mo montés en
// mémoire) et fait un TIR D'AMORÇAGE — le tout premier session.run d'ONNX
// compile ses kernels (1,5-3× plus lent) : on paie ce coût ici, en fond,
// plus jamais sur la première vraie phrase. Idempotent et bon marché une
// fois chaud : on peut l'appeler à chaque envoi sans arrière-pensée.
const _warmedRun = {};
export async function warmUp(voiceId = DEFAULT_VOICE, onProgress) {
  try {
    await ensureOrt();
    await getConfig(voiceId);
    await getSession(voiceId, onProgress);
    await _phonInstance();
    if (!_warmedRun[voiceId]) {
      _warmedRun[voiceId] = true;             // posé AVANT : pas de double tir concurrent
      try { await synthToWav('Prêt.', voiceId); } catch (_) { _warmedRun[voiceId] = false; }
    }
    return true;
  } catch (_) { return false; }
}

export function stopSpeaking() {
  if (_current) _current.cancelled = true;
  _current = null;
  const a = _getAudio();
  if (a) { try { a.pause(); } catch (_) {} }
}

function _playBlob(wav, me) {
  return new Promise((resolve) => {
    const a = _getAudio();
    if (!a) { resolve(); return; }
    const url = URL.createObjectURL(wav);
    const done = () => { URL.revokeObjectURL(url); a.onended = a.onerror = a.onpause = null; resolve(); };
    a.onended = done;
    a.onerror = done;
    a.onpause = () => { if (me.cancelled) done(); };   // stopSpeaking() → pause
    a.src = url;
    a.play().catch(done);
  });
}

// Lit `text` phrase par phrase. onState('loading'|'speaking'|'idle') pilote
// le voyant des surfaces ; onProgress(0..1) suit le 1er téléchargement du
// modèle. Toute nouvelle lecture interrompt la précédente. Propage l'erreur
// du moteur (la surface choisit son repli — ex. voix système).
export async function speakText(text, { voiceId = DEFAULT_VOICE, onProgress, onState } = {}) {
  stopSpeaking();
  const sentences = shortenFirst(splitSentences(String(text || '').replace(/\[\d{1,2}\]/g, '')));
  if (!sentences.length) return;
  const me = { cancelled: false };
  _current = me;
  onState && onState('loading');
  let next = null;
  try {
    next = synthToWav(sentences[0], voiceId, onProgress);
    let spoke = false;
    for (let i = 0; i < sentences.length && !me.cancelled; i++) {
      const wav = await next;
      next = (i + 1 < sentences.length) ? synthToWav(sentences[i + 1], voiceId) : null;
      if (me.cancelled) break;
      if (!spoke) { spoke = true; onState && onState('speaking'); }
      await _playBlob(wav, me);
    }
  } finally {
    if (next) next.catch(() => {});   // génération pipeline abandonnée : pas d'unhandled rejection
    if (_current === me) { _current = null; onState && onState('idle'); }
  }
}
