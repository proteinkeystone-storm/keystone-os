/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — proof-engine.js
   LE MOTEUR de correction. Interface STABLE & swappable :

       analyze(text)  → { text, issues:[ Issue ] }
       suggest(word)  → [string]
       fuseIssues(a,b)→ [Issue]            (dédup grammalecte + IA)
       canonicalizeText(text) → string

   Issue = {
     offset, len,                          position dans le texte CANONIQUE
     type: 'spelling' | 'grammar',
     severity: 'error' | 'warning',
     message, suggestions:[string],
     source: 'grammalecte' | 'ai',
     ruleId?, word?, url?
   }

   Rôle : piloter le Web Worker Grammalecte (détection déterministe,
   100 % navigateur, hors-ligne, gratuit) et — Phase 4 — fusionner une
   passe IA optionnelle. Réutilisable par Ghost Writer (texte + PDF) ET
   par un futur outil : on peut remplacer Grammalecte par LanguageTool /
   Harper plus tard SANS toucher les consommateurs (on ne change que
   l'intérieur de ce module + son worker).

   ⚠️ La détection NE QUITTE JAMAIS le navigateur (Grammalecte tourne en
   local). Seule la passe IA (Phase 4, à la demande) envoie du texte
   dehors. cf. BRIEF_GHOST_WRITER_V2.md §2-3.
   ═══════════════════════════════════════════════════════════════ */

const WORKER_URL = '/app/lib/proof-grammalecte.worker.js';

let _worker   = null;
let _seq      = 0;
let _readyP   = null;            // Promise résolue au handshake __ready__
const _pending = new Map();      // id → { resolve, reject }

// ── Cycle de vie du worker ──────────────────────────────────────
function _ensureWorker() {
  if (_worker) return _worker;
  _worker = new Worker(WORKER_URL);           // classique (importScripts) ; CSP worker-src 'self'
  _readyP = new Promise((resolve) => { _worker.__resolveReady = resolve; });

  _worker.onmessage = (e) => {
    const d = e.data || {};
    if (d.id === '__ready__') { _worker.__resolveReady && _worker.__resolveReady(true); return; }
    const p = _pending.get(d.id);
    if (!p) return;
    _pending.delete(d.id);
    if (d.ok) resolveOk(p, d);
    else p.reject(new Error(d.error || 'Erreur du correcteur'));
  };
  _worker.onerror = (ev) => {
    const msg = 'Le moteur de correction a planté' + (ev && ev.message ? ' : ' + ev.message : '');
    for (const [, p] of _pending) p.reject(new Error(msg));
    _pending.clear();
    // worker mort → on le recrée au prochain appel
    try { _worker.terminate(); } catch (_) {}
    _worker = null; _readyP = null;
  };
  return _worker;
}

function resolveOk(p, d) {
  if (d.issues !== undefined) p.resolve(d.issues);
  else if (d.suggestions !== undefined) p.resolve(d.suggestions);
  else p.resolve(d);
}

function _call(cmd, payload) {
  const w = _ensureWorker();
  const id = ++_seq;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    try { w.postMessage(Object.assign({ id, cmd }, payload)); }
    catch (err) { _pending.delete(id); reject(err); }
  });
}

// ── Normalisation canonique (fidélité des offsets) ──────────────
// Doit être appliquée UNE fois côté main, et le texte canonique sert à
// la fois à l'affichage (surlignage) et aux offsets renvoyés par le
// worker — sinon dérive de position. cf. brief §7.
//   • CRLF/CR → LF (Grammalecte ne normalise que le 1er sinon)
//   • retire les traits d'union conditionnels U+00AD (invisibles)
//   • NFC (le worker Grammalecte applique NFC → on s'aligne en amont)
export function canonicalizeText(text) {
  let s = (text == null) ? '' : String(text);
  s = s.replace(/\r\n?/g, '\n').replace(/­/g, '');
  try { s = s.normalize('NFC'); } catch (_) {}
  return s;
}

// ── Pré-chauffe (optionnel) : démarre le worker + init dicos ────
// À appeler quand l'utilisateur entre dans le correcteur, pour que la
// 1re analyse soit instantanée (sinon ~1 s de chargement dico au 1er run).
export function warmUp() {
  _ensureWorker();
  return _readyP.then(() => _call('init', {})).catch(() => {});
}

// ── API principale ──────────────────────────────────────────────
// Renvoie le texte canonique (à afficher) + les issues triées par offset.
export async function analyze(text, opts = {}) {
  const canonical = canonicalizeText(text);
  if (!canonical.trim()) return { text: canonical, issues: [] };
  _ensureWorker();
  await _readyP;
  const issues = await _call('analyze', { text: canonical });
  return { text: canonical, issues: Array.isArray(issues) ? issues : [] };
}

// Suggestions orthographiques à la demande (pour un mot précis).
export async function suggest(word) {
  if (!word) return [];
  _ensureWorker();
  await _readyP;
  const s = await _call('suggest', { word: String(word) });
  return Array.isArray(s) ? s : [];
}

// ── Fusion Grammalecte + IA (Phase 4) ───────────────────────────
// Dédoublonne les spans qui se recouvrent ; en cas de chevauchement on
// garde la source la plus fiable (grammalecte = déterministe) et on
// agrège les suggestions. Exposé tôt pour que proof-pdf/UI s'en servent.
export function fuseIssues(primary, secondary) {
  const a = Array.isArray(primary) ? primary.slice() : [];
  const b = Array.isArray(secondary) ? secondary : [];
  const out = a.slice();
  for (const s of b) {
    const overlap = out.find((x) => _overlaps(x, s));
    if (!overlap) { out.push(s); continue; }
    // chevauchement : grammalecte prioritaire ; on enrichit les suggestions
    const keep = (overlap.source === 'grammalecte') ? overlap : s;
    const drop = (keep === overlap) ? s : overlap;
    const merged = new Set([...(keep.suggestions || []), ...(drop.suggestions || [])]);
    keep.suggestions = [...merged];
    if (keep === s) { // on remplace overlap par s dans out
      const i = out.indexOf(overlap);
      if (i >= 0) out[i] = s;
    }
  }
  out.sort((x, y) => (x.offset - y.offset) || (x.len - y.len));
  return out;
}

function _overlaps(x, y) {
  const xe = x.offset + x.len, ye = y.offset + y.len;
  return x.offset < ye && y.offset < xe;
}

// ── Arrêt (libère la mémoire du dico ~9 Mo) ─────────────────────
export function terminateProofEngine() {
  if (_worker) { try { _worker.terminate(); } catch (_) {} }
  _worker = null; _readyP = null; _pending.clear();
}
