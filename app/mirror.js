/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Le Reflet chiffré par jeton (MCP sprint 5)
   ───────────────────────────────────────────────────────────────
   Pour que l'assistant lise Brainstorming, Ghost Writer et le composer
   Social SANS onglet ouvert, l'onglet publie un REFLET : ce que les
   lectures du catalogue (bridge-actions.js) renvoient déjà — titres,
   briefs, synthèses, extraits, dates — jamais le magasin brut. Chiffré
   ICI, AES-256-GCM, avec une clé dérivée du SECRET DE CONNEXION que
   cette page a généré au consentement (connect.html) : le serveur ne
   garde que le hash du secret, il ne peut rien lire au repos. Pendant
   un appel de l'assistant, le Worker dérive la clé du jeton présenté,
   déchiffre en mémoire, répond, oublie.

   Opt-in PAR PAD (Réglages → Connecteur MCP → « Visible par mon
   assistant »). Un reflet par connexion dont CET appareil connaît le
   secret (ks_mcp_mirror_secrets[request_id]) : une connexion autorisée
   sur un autre appareil n'est pas alimentée d'ici — il faut réautoriser
   depuis Claude sur celui-ci. Le Cloud Vault n'est PAS utilisé pour le
   secret : il est chiffré côté serveur (KS_ENCRYPTION_KEY), donc lisible
   par le serveur — ce qui ruinerait la promesse « rien de lisible ».

   Dérivation (DOIT rester identique à workers/src/routes/mcp-mirror.js) :
     clé = SHA-256( secret + '|keystone-mcp-mirror|' + pad ) → AES-256-GCM.
   Publication : debounce 2 s après une écriture des clés surveillées
   (hook Storage.setItem, chaîné après celui du Cloud Vault), au boot, au
   changement d'interrupteur. 64 Ko max par reflet (listes tronquées).
   Préfixe `ks_mcp_mirror_` / `__ksMirror`.
   ═══════════════════════════════════════════════════════════════ */
const CF_WORKER = 'https://keystone-os-api.keystone-os.workers.dev';
const IS_LOCAL  = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API       = IS_LOCAL ? '' : CF_WORKER;
const LS_PADS    = 'ks_mcp_mirror_pads';
const LS_SECRETS = 'ks_mcp_mirror_secrets';
const MAX_BYTES  = 60 * 1024;             // marge sous les 64 Ko du Worker (base64 ≈ +33 %)
const DEBOUNCE   = 2000;

export const MIRROR_PADS = {
  brainstorming: { label: 'Brainstorming', hint: 'séances, synthèses, derniers tours de débat',
    keys: ['ks_brainstorming_sessions'], actions: ['bs.list_sessions', 'bs.read_synthesis', 'bs.read_debate'] },
  ghostwriter:   { label: 'Ghost Writer', hint: 'posts composés, bibliothèque de variantes, brouillons',
    keys: ['ks_gw_compose_archive', 'ks_ghostwriter_library', 'ks_ghostwriter_studio_draft', 'ks_gw_proof_draft'], actions: ['gw.list_posts', 'gw.list_variants', 'gw.read_draft'] },
  social:        { label: 'Composer Social Manager', hint: 'le brouillon en attente et ses réseaux',
    keys: ['ks_social_manager_draft_v1'], actions: ['sm.read_composer'] },
};

const _jwt = () => { try { return localStorage.getItem('ks_jwt') || ''; } catch (e) { return ''; } };
const _json = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } };
const toB64 = (u8) => btoa(String.fromCharCode(...u8));

/* ── Réglages ── */
export function mirrorSettings() { const s = _json(LS_PADS, {}); const out = {}; for (const p of Object.keys(MIRROR_PADS)) out[p] = s[p] === true; return out; }
export async function setMirrorPad(pad, on) {
  if (!MIRROR_PADS[pad]) return;
  const s = mirrorSettings(); s[pad] = !!on;
  try { localStorage.setItem(LS_PADS, JSON.stringify(s)); } catch (e) { /* plein */ }
  if (on) await publish(pad);
  else await _api(`/api/mcp/mirror/${pad}`, { method: 'DELETE' });
  window.dispatchEvent(new CustomEvent('ks-mcp-mirror-changed', { detail: { pad, on: !!on } }));
}
export function mirrorSecrets() { return _json(LS_SECRETS, {}); }
/** État pour la tuile : connexions liées à cet appareil (secret connu) et reflets publiés. */
export async function mirrorStatus() {
  const { status, data } = await _api('/api/mcp/connections');
  const secrets = mirrorSecrets();
  const conns = status === 200 && data?.ok ? (data.connections || []) : [];
  return { pads: mirrorSettings(), connections: conns.map(c => ({ id: c.id, client_name: c.client_name, request_id: c.request_id, linked: !!(c.request_id && secrets[c.request_id]), mirror: c.mirror || [] })) };
}

/* ── Réseau ── */
async function _api(path, { method = 'GET', body } = {}) {
  const jwt = _jwt(); if (!jwt) return { status: 401, data: null };
  const headers = { Authorization: 'Bearer ' + jwt };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch (e) { /* vide */ }
    return { status: res.status, data };
  } catch (e) { return { status: 0, data: null }; }
}

/* ── Crypto ── */
async function _key(secret, pad) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|keystone-mcp-mirror|${pad}`));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}
async function _encrypt(secret, pad, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await _key(secret, pad), new TextEncoder().encode(JSON.stringify(obj)));
  return { ciphertext: toB64(new Uint8Array(buf)), iv: toB64(iv) };
}

/* ── Contenu d'un reflet = les lectures du catalogue, tronquées sous 60 Ko ── */
async function _snapshot(pad) {
  const { runBridgeAction } = await import('./bridge-actions.js');
  const out = { _pad: pad, _at: new Date().toISOString() };
  for (const a of MIRROR_PADS[pad].actions) {
    const r = await runBridgeAction(a, {});
    out[a] = r.ok ? r.data : { erreur: r.error };
  }
  const size = (o) => new TextEncoder().encode(JSON.stringify(o)).length;
  let guard = 0;
  while (size(out) > MAX_BYTES && guard++ < 12) {
    if (out['bs.read_debate'] && guard === 1) { delete out['bs.read_debate']; continue; }
    for (const v of Object.values(out)) {
      if (!v || typeof v !== 'object') continue;
      for (const k of Object.keys(v)) if (Array.isArray(v[k]) && v[k].length > 2) v[k] = v[k].slice(0, Math.ceil(v[k].length / 2));
    }
    out._tronque = true;
  }
  return out;
}

/* ── Publication ── */
let _busy = new Set();
export async function publish(pad) {
  if (!MIRROR_PADS[pad] || !mirrorSettings()[pad] || !_jwt() || _busy.has(pad)) return { published: 0 };
  _busy.add(pad);
  try {
    const st = await mirrorStatus();
    const linked = st.connections.filter(c => c.linked);
    if (!linked.length) return { published: 0, reason: 'aucune connexion liée à cet appareil' };
    const snap = await _snapshot(pad);
    const secrets = mirrorSecrets();
    let n = 0;
    for (const c of linked) {
      const enc = await _encrypt(secrets[c.request_id], pad, snap);
      const { status } = await _api(`/api/mcp/mirror/${encodeURIComponent(c.id)}/${pad}`, { method: 'PUT', body: enc });
      if (status === 200) n++;
    }
    return { published: n };
  } catch (e) { return { published: 0, reason: e?.message || String(e) }; }
  finally { _busy.delete(pad); }
}
export async function publishAll() { const s = mirrorSettings(); const r = {}; for (const p of Object.keys(s)) if (s[p]) r[p] = await publish(p); return r; }

/* Rattrapage (correctif 17/09) : un pad activé dont le reflet manque pour une
   connexion liée à cet appareil est publié maintenant. Couvre le cas réel du
   premier test : interrupteurs activés AVANT l'autorisation, ou onglet
   Keystone jamais rechargé après le consentement. Throttle 60 s sauf force. */
let _lastCatchUp = 0;
export async function mirrorCatchUp({ force = false } = {}) {
  if (!_jwt()) return { published: 0 };
  if (!force && Date.now() - _lastCatchUp < 60000) return { published: 0, reason: 'throttle' };
  _lastCatchUp = Date.now();
  const st = await mirrorStatus();
  const linked = st.connections.filter(c => c.linked);
  let n = 0;
  for (const pad of Object.keys(st.pads)) {
    if (!st.pads[pad]) continue;
    if (linked.some(c => !(c.mirror || []).some(m => m.pad === pad))) { const r = await publish(pad); n += r.published || 0; }
  }
  return { published: n };
}

/* ── Déclencheurs ── */
const _timers = {};
function _schedule(pad) { clearTimeout(_timers[pad]); _timers[pad] = setTimeout(() => publish(pad), DEBOUNCE); }
function _padOfKey(key) { for (const [p, d] of Object.entries(MIRROR_PADS)) if (d.keys.includes(key)) return p; return null; }

let _installed = false;
export function initMirror() {
  if (_installed) return; _installed = true;
  try {
    const prevSet = Storage.prototype.setItem, prevDel = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) { prevSet.call(this, key, value); try { if (this === localStorage) { const p = _padOfKey(key); if (p && mirrorSettings()[p]) _schedule(p); } } catch (e) { /* jamais bloquer setItem */ } };
    Storage.prototype.removeItem = function (key) { prevDel.call(this, key); try { if (this === localStorage) { const p = _padOfKey(key); if (p && mirrorSettings()[p]) _schedule(p); } } catch (e) { /* idem */ } };
  } catch (e) { console.warn('[mirror] hook setItem impossible :', e?.message); }
  setTimeout(() => publishAll(), 3000);
  window.addEventListener('ks-licence-activated', () => setTimeout(() => publishAll(), 1500));
  /* le consentement (connect.html, autre onglet du même navigateur) vient de poser un secret */
  window.addEventListener('storage', (e) => { if (e.key === LS_SECRETS) setTimeout(() => mirrorCatchUp({ force: true }), 800); });
  /* retour sur l'onglet Keystone : rattrapage des reflets manquants */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) mirrorCatchUp(); });
  window.__ksMirror = { publish, publishAll, catchUp: mirrorCatchUp, status: mirrorStatus, settings: mirrorSettings, set: setMirrorPad };
}
