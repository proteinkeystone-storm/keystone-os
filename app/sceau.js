// ═══════════════════════════════════════════════════════════════
// SCEAU — Pad O-SEC-001 · S3 (création & gestion)
//
// Transmission de secret usage-unique, scellée, chiffrée de bout en bout,
// gatée par un OPRF qui meurt au 3e essai. Le serveur reste AVEUGLE.
// Backend : workers/src/routes/sceau.js (S1). Page de lecture : /s/:id (S2).
// Spec gelée : SCEAU_CRYPTO_SPEC.md. Cadrage : SCEAU_BRIEF.md.
//
// ISOLATION : préfixe sceau- (CSS/DOM), localStorage néant (rien à persister
// côté client — la passphrase n'est JAMAIS stockée), routes /api/sceau/.
// Crypto navigateur : voprf-ts auto-hébergé (app/vendor/sceau-voprf.esm.js)
// + WebCrypto (HKDF + AES-256-GCM). Paramètres E2E CANONIQUES (= S1/S2).
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';

const WORKSPACE_META = { id: 'O-SEC-001', name: 'Missive' };
// Prod par défaut ; surchargé par window.__KS_API_BASE__ en dev local (cf. brainstorming.js).
const API_BASE = (typeof window !== 'undefined' && window.__KS_API_BASE__) || 'https://keystone-os-api.keystone-os.workers.dev';

// Paramètres E2E CANONIQUES — DOIVENT rester identiques à la page de lecture (S2).
const _enc = new TextEncoder();
const HKDF_SALT = _enc.encode('sceau/v1');
const HKDF_INFO = _enc.encode('aes-gcm-256');

let _root = null;
let _view = 'list';        // 'list' | 'tokens' | 'create' | 'result'
let _items = [];
let _tokens = [];
let _loading = false;
let _error = null;
let _busy = false;
let _result = null;        // { passphrase, url } (secret direct ou jeton)
let _tokenTarget = null;   // tid si la création recharge un jeton existant
let _createMode = 'text';  // 'text' | 'vocal' | 'file'
let _recBlob = null;       // Blob audio enregistré (mode vocal)
let _rec = null;           // session MediaRecorder en cours
let _recTimer = null;
let _fileSel = null;       // File choisi (mode fichier)
let _unlockMode = 'code';  // 'code' (passphrase générée) | 'qa' (question/réponse) | 'email'
let _codeStyle = 'fort';   // 'fort' (16 car. ~80 bits) | 'mots' (4 mots dictables)
let _draft = {};           // valeurs saisies, préservées entre les re-render (bascules de mode)

// Capture les champs du formulaire de création AVANT un re-render (sinon une
// bascule de mode efface le message/nom/etc. déjà saisis).
function _captureDraft() {
  if (!_root) return;
  const g = sel => { const el = _root.querySelector(sel); return el ? el.value : undefined; };
  const set = (k, v) => { if (v !== undefined) _draft[k] = v; };
  set('secret', g('#sceau-secret')); set('name', g('#sceau-name'));
  set('max', g('#sceau-max')); set('exp', g('#sceau-exp'));
  set('question', g('#sceau-q')); set('answer', g('#sceau-a')); set('email', g('#sceau-email'));
}

// ── Crypto navigateur ───────────────────────────────────────────
let _V = null;
async function _voprf() {
  if (!_V) _V = await import('./vendor/sceau-voprf.esm.js');
  return _V;
}
function _b64e(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function _b64d(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
// En-tête fichier E2E : [4 octets longueur LE][JSON {name,type} UTF-8][octets fichier].
// Le nom vit DANS la charge chiffrée — le serveur ne le voit jamais. Doit rester
// symétrique avec le dépaquetage de la page de lecture (sceau-page.js).
function _packFile(name, type, bytes) {
  const meta = _enc.encode(JSON.stringify({ name: String(name || 'fichier'), type: type || '' }));
  const out = new Uint8Array(4 + meta.length + bytes.length);
  new DataView(out.buffer).setUint32(0, meta.length, true);
  out.set(meta, 4);
  out.set(bytes, 4 + meta.length);
  return out;
}
// Cap dur côté serveur = 8 Mo de b64 (SEC_SEAL_MAX). On garde une marge pour l'en-tête
// nom + le tag AES-GCM : ~5,8 Mo de fichier brut.
const SEC_FILE_MAX = 5_800_000;
async function _aesKey(output) {
  const ikm = await crypto.subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// Normalisation de la réponse (mode question/réponse) — DOIT être IDENTIQUE
// côté lecture (sceau-page.js), sinon le destinataire échoue au dernier essai.
// NFD + suppression des diacritiques + minuscules + alphanumérique seul.
function _normAnswer(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
// Passphrase forte GÉNÉRÉE (l'humain ne choisit jamais). 16 car. alphabet sans
// ambiguïté (pas de O/0/I/1/L) = ~80 bits, dictables de vive voix en 4 groupes.
function _genPassphrase() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars (≈4.95 bits)
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (let i = 0; i < 16; i++) { out += A[bytes[i] % A.length]; if (i % 4 === 3 && i < 15) out += '-'; }
  return out; // ex. K7PQ-9XMR-4RTV-8WNH
}

// Variante « facile à dicter » : 4 mots français + un nombre
// (ex. tigre-banane-orage-77). Moins d'entropie que le code fort
// (~39 bits vs ~80) mais le verrou OPRF 3-essais protège l'attaque
// EN LIGNE — le compromis est assumé et affiché à l'utilisateur.
// Mots courts, sans accent, phonétiquement distincts (dictée téléphone).
const _WORDS = (
  'tigre lion loup ours renard biche lapin chat chien cheval ' +
  'poulain vache taureau mouton bouc canard poule dindon pigeon merle ' +
  'moineau hibou chouette faucon aigle vautour corbeau cygne mouette flamant ' +
  'belette fouine loutre vison furet blaireau castor taupe souris mulot ' +
  'sanglier chevreuil daim renne morse phoque otarie manchot pingouin dauphin ' +
  'requin baleine cachalot espadon saumon truite carpe brochet sardine anchois ' +
  'crabe homard crevette oursin corail pieuvre calmar seiche tortue serpent ' +
  'couleuvre iguane grenouille crapaud escargot limace fourmi abeille bourdon frelon ' +
  'papillon chenille grillon cigale criquet mouche libellule luciole hanneton termite ' +
  'banane pomme poire prune cerise fraise framboise myrtille cassis groseille ' +
  'citron orange mandarine mangue kiwi raisin figue datte noix noisette ' +
  'amande olive abricot melon coing tomate carotte radis navet chou ' +
  'oignon poireau laitue endive concombre courgette potiron haricot lentille artichaut ' +
  'asperge betterave panais persil basilic thym menthe sauge romarin laurier ' +
  'estragon oseille safran vanille cacao cannelle muscade cumin anis fenouil ' +
  'orage nuage pluie bruine brume vent rafale tonnerre foudre givre ' +
  'verglas soleil lune astre aurore horizon galaxie orbite torrent ruisseau ' +
  'cascade source fleuve lac marais lagune delta estuaire plage dune ' +
  'falaise galet sable vague houle volcan colline vallon plaine prairie ' +
  'plateau ravin gorge grotte caverne gouffre sommet versant glacier savane ' +
  'jungle bois bosquet buisson haie sentier chemin piste carrefour trottoir ' +
  'pont tunnel viaduc wagon gare orme tilleul bouleau saule peuplier ' +
  'platane sapin palmier bambou roseau jonc mousse lichen cactus ronce ' +
  'houx lierre vigne seigle avoine orge tournesol chanvre osier rotin ' +
  'branche rameau racine feuille bourgeon pollen nectar sillon rose tulipe ' +
  'jasmin lilas violette iris muguet pivoine'
).split(' ');

function _genWordsPassphrase() {
  // 256 mots pile → 1 octet aléatoire = tirage parfaitement uniforme
  const b = crypto.getRandomValues(new Uint8Array(4));
  const num = 10 + (b[3] % 90);
  return `${_WORDS[b[0]]}-${_WORDS[b[1]]}-${_WORDS[b[2]]}-${num}`; // ex. tigre-banane-orage-77
}

// ── API ─────────────────────────────────────────────────────────
function _jwt() { return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || ''; }
async function _api(path, opts = {}) {
  const res = await fetch(`${API_BASE}/api/sceau${path}`, {
    method: opts.method || 'GET',
    headers: { 'Authorization': `Bearer ${_jwt()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

function _esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ── Cycle de vie ────────────────────────────────────────────────
export function openSceau(opts = {}) {
  if (_root) return;
  _view = 'list'; _result = null;
  _buildShell();
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _onKey);
  _load();
}
export function closeSceau() {
  if (!_root) return;
  document.removeEventListener('keydown', _onKey);
  _root.remove(); _root = null;
  document.body.style.overflow = '';
}
function _onKey(e) { if (e.key === 'Escape') { if (_view !== 'list') { _view = 'list'; _result = null; _render(); } else closeSceau(); } }

function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app sceau-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour">${icon('chevron-left', 34)}</button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('sceau', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main sceau-main" data-slot="main"></main>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('submit', _onSubmit);
  try { bindRatingButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindHelpButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindBurger(_root); } catch (_) {}
}

function _main() { return _root && _root.querySelector('[data-slot="main"]'); }

async function _load() {
  _loading = true; _error = null; _render();
  try { const d = await _api(''); _items = d.items || []; }
  catch (e) { _error = e.message; }
  _loading = false; _render();
}
async function _loadTokens() {
  _loading = true; _error = null; _render();
  try { const d = await _api('/token'); _tokens = d.items || []; }
  catch (e) { _error = e.message; }
  _loading = false; _render();
}

// ── Rendu ───────────────────────────────────────────────────────
function _render() {
  const main = _main(); if (!main) return;
  if (_view === 'create') return _renderCreate(main);
  if (_view === 'result') return _renderResult(main);
  if (_view === 'tokens') return _renderTokens(main);
  _renderList(main);
}

function _tabs(active) {
  return `<div class="sceau-tabs">
    <button class="sceau-tab ${active === 'list' ? 'on' : ''}" data-act="tab-secrets">Missives</button>
    <button class="sceau-tab ${active === 'tokens' ? 'on' : ''}" data-act="tab-tokens">Jetons réutilisables</button>
  </div>`;
}

const STATUS = {
  scelle:  { label: 'Scellée',   cls: 'ok' },
  detruit: { label: 'Détruite',  cls: 'dead' },
  expire:  { label: 'Expirée',   cls: 'muted' },
  init:    { label: 'Brouillon', cls: 'muted' },
  lu:      { label: 'Lue',       cls: 'muted' },
};

function _renderList(main) {
  if (_loading) { main.innerHTML = `<div class="sceau-state">${icon('refresh', 28)}<p>Chargement…</p></div>`; return; }
  if (_error)   { main.innerHTML = `<div class="sceau-state sceau-state-err">${icon('alert-triangle', 28)}<p>${_esc(_error)}</p><button class="sceau-btn" data-act="reload">Réessayer</button></div>`; return; }

  const rows = _items.map(it => {
    const st = STATUS[it.status] || STATUS.init;
    const left = it.status === 'scelle' ? `${it.attempts_left} essai${it.attempts_left > 1 ? 's' : ''} restant${it.attempts_left > 1 ? 's' : ''}` : '';
    const exp = it.expires_at ? `Expire le ${new Date(it.expires_at).toLocaleDateString('fr-FR')}` : '';
    const canAct = it.status === 'scelle';
    return `
      <div class="sceau-row" data-id="${_esc(it.short_id)}">
        <div class="sceau-row-main">
          <div class="sceau-row-title">${icon('lock', 16)} ${_esc(it.label || 'Secret sans nom')}</div>
          <div class="sceau-row-meta"><span class="sceau-badge ${st.cls}">${st.label}</span>${left ? `<span>${left}</span>` : ''}${exp ? `<span>${_esc(exp)}</span>` : ''}</div>
        </div>
        <div class="sceau-row-acts">
          ${canAct ? `<button class="sceau-iconbtn" data-act="link" data-id="${_esc(it.short_id)}" title="Copier le lien">${icon('link', 17)}</button>` : ''}
          ${canAct ? `<button class="sceau-iconbtn" data-act="qr" data-id="${_esc(it.short_id)}" title="Afficher le QR">${icon('qr-code', 17)}</button>` : ''}
          ${canAct ? `<button class="sceau-iconbtn danger" data-act="burn" data-id="${_esc(it.short_id)}" title="Détruire maintenant">${icon('trash-2', 17)}</button>`
                   : `<button class="sceau-iconbtn" data-act="remove" data-id="${_esc(it.short_id)}" title="Retirer de la liste">${icon('x', 17)}</button>`}
        </div>
      </div>`;
  }).join('');

  main.innerHTML = `
    ${_tabs('list')}
    <div class="sceau-head">
      <div>
        <h1>Vos missives</h1>
        <p class="sceau-sub">Une missive scellée se lit une fois, puis s'autodétruit. Même nous ne pouvons pas la lire.</p>
      </div>
      <button class="sceau-btn primary" data-act="new">${icon('plus', 18)} Nouvelle missive</button>
    </div>
    ${_items.length ? `<div class="sceau-list">${rows}</div>` : `<div class="sceau-empty">${icon('shield-check', 40)}<p>Aucune missive pour l'instant.</p><button class="sceau-btn primary" data-act="new">${icon('plus', 18)} Créer la première</button></div>`}
    <div id="sceau-qrslot"></div>
  `;
}

function _renderTokens(main) {
  if (_loading) { main.innerHTML = `${_tabs('tokens')}<div class="sceau-state">${icon('refresh', 28)}<p>Chargement…</p></div>`; return; }
  if (_error)   { main.innerHTML = `${_tabs('tokens')}<div class="sceau-state sceau-state-err">${icon('alert-triangle', 28)}<p>${_esc(_error)}</p><button class="sceau-btn" data-act="reload-tok">Réessayer</button></div>`; return; }

  const rows = _tokens.map(t => {
    const active = t.state === 'actif';
    const meta = active ? `<span class="sceau-badge ok">Message actif</span><span>${t.attempts_left} essai${t.attempts_left > 1 ? 's' : ''} restant${t.attempts_left > 1 ? 's' : ''}</span>` : `<span class="sceau-badge muted">Vide</span>`;
    return `
      <div class="sceau-row" data-tid="${_esc(t.token_id)}">
        <div class="sceau-row-main">
          <div class="sceau-row-title">${icon('radio', 16)} ${_esc(t.label || 'Jeton sans nom')}</div>
          <div class="sceau-row-meta">${meta}</div>
        </div>
        <div class="sceau-row-acts">
          <button class="sceau-btn" data-act="tok-load" data-tid="${_esc(t.token_id)}">${icon('plus', 15)} ${active ? 'Recharger' : 'Charger'}</button>
          <button class="sceau-iconbtn" data-act="tok-link" data-tid="${_esc(t.token_id)}" title="Copier le lien stable">${icon('link', 17)}</button>
          <button class="sceau-iconbtn" data-act="tok-qr" data-tid="${_esc(t.token_id)}" title="QR / NFC">${icon('qr-code', 17)}</button>
          <button class="sceau-iconbtn danger" data-act="tok-burn" data-tid="${_esc(t.token_id)}" title="Supprimer le jeton">${icon('trash-2', 17)}</button>
        </div>
      </div>`;
  }).join('');

  main.innerHTML = `
    ${_tabs('tokens')}
    <div class="sceau-head">
      <div>
        <h1>Jetons réutilisables</h1>
        <p class="sceau-sub">Un objet physique (puce NFC / QR) écrit <strong>une seule fois</strong>, qu'on recharge à volonté avec un nouveau secret — sans jamais le retoucher.</p>
      </div>
      <button class="sceau-btn primary" data-act="newtoken">${icon('plus', 18)} Nouveau jeton</button>
    </div>
    ${_tokens.length ? `<div class="sceau-list">${rows}</div>` : `<div class="sceau-empty">${icon('radio', 40)}<p>Aucun jeton pour l'instant.</p><button class="sceau-btn primary" data-act="newtoken">${icon('plus', 18)} Créer le premier</button></div>`}
    <div id="sceau-qrslot"></div>
  `;
}

function _renderCreate(main) {
  // Valeurs préservées entre les bascules de mode (cf. _captureDraft).
  const d = _draft;
  const dmax = d.max ?? '3', dexp = d.exp ?? '86400';
  const selOpt = (v, cur) => v === cur ? ' selected' : '';
  main.innerHTML = `
    <div class="sceau-form-wrap">
      <button class="sceau-link-back" data-act="tolist">${icon('chevron-left', 18)} Retour</button>
      <h1>${_tokenTarget ? 'Recharger le jeton' : 'Nouvelle missive'}</h1>
      <p class="sceau-sub">${_tokenTarget ? 'Le nouveau secret remplacera l\'ancien sur ce jeton — le lien et la puce restent identiques.' : 'Collez le secret à transmettre. Il est chiffré sur votre appareil — il ne quitte jamais cette page en clair.'}</p>
      <form data-form="create">
        <div class="sceau-modesw">
          <button type="button" class="sceau-mode ${_createMode === 'text' ? 'on' : ''}" data-act="mode-text">${icon('file', 15)} Texte</button>
          <button type="button" class="sceau-mode ${_createMode === 'vocal' ? 'on' : ''}" data-act="mode-vocal">${icon('radio', 15)} Vocal</button>
          <button type="button" class="sceau-mode ${_createMode === 'file' ? 'on' : ''}" data-act="mode-file">${icon('paperclip', 15)} Fichier</button>
        </div>
        ${_createMode === 'text'
          ? `<label class="sceau-label" for="sceau-secret">Secret à transmettre</label>
             <textarea id="sceau-secret" class="sceau-textarea" rows="5" maxlength="20000" placeholder="Mot de passe, code, message confidentiel…">${_esc(d.secret || '')}</textarea>`
          : _createMode === 'vocal'
          ? `<label class="sceau-label">Message vocal</label><div id="sceau-rec" class="sceau-rec"></div>`
          : `<label class="sceau-label">Fichier à transmettre</label><div id="sceau-file" class="sceau-rec"></div>`}

        <label class="sceau-label" for="sceau-name">Nom (pour vous, non transmis)</label>
        <input id="sceau-name" class="sceau-input" type="text" maxlength="120" placeholder="ex. Code coffre client X" value="${_esc(d.name || '')}">

        <label class="sceau-label">Déverrouillage</label>
        <div class="sceau-modesw">
          <button type="button" class="sceau-mode ${_unlockMode === 'code' ? 'on' : ''}" data-act="unlock-code">${icon('key', 15)} Code généré</button>
          <button type="button" class="sceau-mode ${_unlockMode === 'qa' ? 'on' : ''}" data-act="unlock-qa">${icon('help-circle', 15)} Question / réponse</button>
          <button type="button" class="sceau-mode ${_unlockMode === 'email' ? 'on' : ''}" data-act="unlock-email">${icon('mail', 15)} Code par email</button>
        </div>
        ${_unlockMode === 'code' ? `
          <div class="sceau-modesw" style="margin-top:8px;">
            <button type="button" class="sceau-mode ${_codeStyle === 'fort' ? 'on' : ''}" data-act="code-fort">${icon('lock', 15)} Sécurité maximale</button>
            <button type="button" class="sceau-mode ${_codeStyle === 'mots' ? 'on' : ''}" data-act="code-mots">${icon('mic', 15)} Facile à dicter</button>
          </div>
          ${_codeStyle === 'mots' ? `
            <p class="sceau-note">${icon('mic', 14)} Code en <strong>3 mots + un nombre</strong> (ex. tigre-banane-orage-77) — parfait à dicter au téléphone, sans risque de faute de frappe. Un cran moins résistant que le code long, mais le verrou des <strong>3 essais</strong> protège contre les tentatives en ligne.</p>
          ` : ''}
        ` : ''}
        ${_unlockMode === 'qa' ? `
          <label class="sceau-label" for="sceau-q">Question (visible par le destinataire)</label>
          <input id="sceau-q" class="sceau-input" type="text" maxlength="200" placeholder="ex. Le nom de notre premier client ?" value="${_esc(d.question || '')}">
          <label class="sceau-label" for="sceau-a">Réponse attendue (jamais transmise)</label>
          <input id="sceau-a" class="sceau-input" type="text" maxlength="200" autocomplete="off" placeholder="ex. Dupont" value="${_esc(d.answer || '')}">
          <p class="sceau-note">${icon('shield-check', 14)} La réponse <strong>n'est pas transmise</strong> : elle dérive la clé sur l'appareil du destinataire. Choisissez une réponse <strong>unique et non devinable</strong> par un tiers. La casse, les accents et les espaces sont ignorés.</p>
        ` : ''}
        ${_unlockMode === 'email' ? `
          <label class="sceau-label" for="sceau-email">Email du destinataire</label>
          <input id="sceau-email" class="sceau-input" type="email" maxlength="200" autocomplete="off" placeholder="destinataire@exemple.com" inputmode="email" value="${_esc(d.email || '')}">
          <p class="sceau-note danger">${icon('alert-triangle', 14)} Mode <strong>plus faible</strong> : le code transite par notre serveur pour l'email — nous le voyons le temps de l'envoi (jamais stocké). <strong>Seul le code part par email</strong> ; partagez le lien (ou le QR) par un <strong>autre canal</strong> (SMS, messagerie…) pour garder les deux séparés. Les modes « Code généré » et « Question/réponse » gardent le serveur aveugle.</p>
        ` : ''}

        <div class="sceau-row2">
          <div>
            <label class="sceau-label" for="sceau-max">Essais avant autodestruction</label>
            <select id="sceau-max" class="sceau-input">
              <option value="3"${selOpt('3', dmax)}>3 essais (recommandé)</option>
              <option value="1"${selOpt('1', dmax)}>1 seul essai (strict)</option>
              <option value="5"${selOpt('5', dmax)}>5 essais</option>
            </select>
          </div>
          <div>
            <label class="sceau-label" for="sceau-exp">Expiration</label>
            <select id="sceau-exp" class="sceau-input">
              <option value=""${selOpt('', dexp)}>Aucune</option>
              <option value="3600"${selOpt('3600', dexp)}>1 heure</option>
              <option value="86400"${selOpt('86400', dexp)}>24 heures</option>
              <option value="604800"${selOpt('604800', dexp)}>7 jours</option>
              <option value="2592000"${selOpt('2592000', dexp)}>30 jours</option>
            </select>
          </div>
        </div>

        <button type="submit" class="sceau-btn primary big" ${_busy ? 'disabled' : ''}>${_busy ? 'Scellage…' : 'Sceller le secret'}</button>
        <p class="sceau-note">${icon('shield-check', 14)} Un code de déverrouillage fort sera généré. Vous devrez le transmettre au destinataire <strong>par un autre canal</strong> — il n'est pas récupérable.</p>
      </form>
    </div>`;
  if (_createMode === 'vocal') _paintRecorder();
  if (_createMode === 'file')  _paintFile();
}

// ── Sélecteur de fichier (mode fichier) ─────────────────────────
function _fmtSize(n) {
  if (n < 1024) return n + ' o';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' Ko';
  return (n / 1048576).toFixed(1) + ' Mo';
}
function _paintFile() {
  const el = _root && _root.querySelector('#sceau-file'); if (!el) return;
  if (_fileSel) {
    const over = _fileSel.size > SEC_FILE_MAX;
    el.innerHTML = `<div class="sceau-file-pick">${icon('paperclip', 18)}<span class="sceau-file-name">${_esc(_fileSel.name)}</span><span class="sceau-nfc-msg">${_fmtSize(_fileSel.size)}</span></div>
      ${over ? `<span class="sceau-nfc-msg" style="color:var(--sc-dead)">Fichier trop volumineux (max ${_fmtSize(SEC_FILE_MAX)}).</span>` : ''}
      <button type="button" class="sceau-btn" data-act="file-reset">${icon('refresh', 15)} Changer de fichier</button>`;
  } else {
    el.innerHTML = `<button type="button" class="sceau-btn sceau-rec-go" data-act="file-pick">${icon('paperclip', 18)} Choisir un fichier</button>
      <span class="sceau-nfc-msg">PDF, image, clé, .env… chiffré sur votre appareil. Max ${_fmtSize(SEC_FILE_MAX)}.</span>
      <input id="sceau-file-input" type="file" hidden>`;
    const inp = el.querySelector('#sceau-file-input');
    if (inp) inp.addEventListener('change', () => { _fileSel = inp.files && inp.files[0] || null; _paintFile(); });
  }
}

// ── Enregistreur vocal (mode vocal) ─────────────────────────────
function _pickRecMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg']
    .find(c => { try { return MediaRecorder.isTypeSupported(c); } catch (_) { return false; } }) || '';
}
function _paintRecorder() {
  const el = _root && _root.querySelector('#sceau-rec'); if (!el) return;
  if (_rec) {
    el.innerHTML = `<div class="sceau-rec-live"><span class="sceau-rec-dot"></span><span id="sceau-rec-t">0:00</span></div>
      <button type="button" class="sceau-btn" data-act="rec-stop">${icon('check', 16)} Arrêter</button>`;
  } else if (_recBlob) {
    const url = URL.createObjectURL(_recBlob);
    el.innerHTML = `<audio class="sceau-rec-audio" controls src="${url}"></audio>
      <button type="button" class="sceau-btn" data-act="rec-reset">${icon('refresh', 15)} Réenregistrer</button>`;
  } else {
    el.innerHTML = `<button type="button" class="sceau-btn sceau-rec-go" data-act="rec-start">${icon('radio', 18)} Enregistrer</button>
      <span class="sceau-nfc-msg" id="sceau-rec-msg"></span>`;
  }
}
async function _recStart() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    const m = _root.querySelector('#sceau-rec-msg'); if (m) m.textContent = 'Micro non disponible sur cet appareil.'; return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (_) { const m = _root.querySelector('#sceau-rec-msg'); if (m) m.textContent = 'Accès micro refusé.'; return; }
  const mime = _pickRecMime();
  let mr; try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
  catch (_) { try { mr = new MediaRecorder(stream); } catch (_2) { stream.getTracks().forEach(t => t.stop()); return; } }
  const chunks = [];
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    try { stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
    _recBlob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' });
    _rec = null; _paintRecorder();
  };
  _rec = { mr, t0: Date.now() };
  try { mr.start(); } catch (_) { _rec = null; stream.getTracks().forEach(t => t.stop()); return; }
  _paintRecorder();
  _recTimer = setInterval(() => {
    const t = _root && _root.querySelector('#sceau-rec-t'); if (!t) return;
    const s = Math.floor((Date.now() - _rec.t0) / 1000);
    t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 180) _recStop(); // cap 3 min
  }, 500);
}
function _recStop() { if (_rec && _rec.mr && _rec.mr.state !== 'inactive') { try { _rec.mr.stop(); } catch (_) {} } }
function _recReset() { _recBlob = null; _paintRecorder(); }

function _renderResult(main) {
  const r = _result || {};
  const linkLbl = r.isToken
    ? (r.empty ? 'Le lien stable du jeton — écrivez-le sur la puce une seule fois' : 'Le lien stable du jeton (inchangé — la puce reste valable)')
    : '1. Le lien (ou le QR / la puce NFC)';
  const passCard = r.empty ? '' : (r.qa ? `
      <div class="sceau-card">
        <div class="sceau-card-lbl">${r.isToken ? 'Le' : '2. Le'} déverrouillage — question / réponse</div>
        <p class="sceau-note">${icon('help-circle', 14)} <strong>Rien à transmettre.</strong> Le destinataire ouvrira la missive en répondant à votre question — la réponse n'a jamais quitté votre appareil. Assurez-vous simplement qu'il connaît la réponse.</p>
      </div>` : `
      <div class="sceau-card warn">
        <div class="sceau-card-lbl">${r.isToken ? 'Le' : '2. Le'} code de déverrouillage — affiché une seule fois</div>
        <div class="sceau-linkrow"><code class="sceau-code big">${_esc(r.passphrase)}</code><button class="sceau-iconbtn" data-act="copypass" title="Copier">${icon('copy', 17)}</button></div>
        <p class="sceau-note danger">${icon('alert-triangle', 14)} À transmettre par un <strong>autre canal</strong> que le lien (de vive voix, autre messagerie). Ni vous ni nous ne pourrons le retrouver. Évitez le SMS seul.</p>
      </div>`);
  const emptyNote = r.empty ? `<p class="sceau-note">${icon('radio', 14)} Écrivez ce lien sur votre puce NFC (ou imprimez le QR) maintenant. Vous pourrez ensuite le <strong>recharger</strong> avec un nouveau secret autant de fois que vous voulez, sans retoucher l'objet.</p>` : '';
  const emailNote = r.emailTo
    ? (r.emailSent
        ? `<div class="sceau-card"><p class="sceau-note">${icon('mail', 14)} <strong>Code</strong> envoyé à <strong>${_esc(r.emailTo)}</strong>. Il reste à transmettre le <strong>lien</strong> ci-dessus (ou le QR) par un autre canal — SMS, messagerie… Le code est aussi affiché en repli si besoin.</p></div>`
        : `<div class="sceau-card warn"><p class="sceau-note danger">${icon('alert-triangle', 14)} L'email n'a pas pu partir (${_esc(r.emailErr || 'erreur')}). Transmettez le lien et le code ci-dessus manuellement.</p></div>`)
    : '';

  main.innerHTML = `
    <div class="sceau-form-wrap">
      <div class="sceau-success">${icon('sceau', 44)}<h1>${r.empty ? 'Jeton créé' : 'Missive créée'}</h1></div>
      <p class="sceau-sub">${r.empty ? 'Votre jeton réutilisable est prêt.' : (r.qa ? 'Transmettez le lien au destinataire — il l\'ouvrira en répondant à votre question.' : 'Transmettez ces deux éléments au destinataire — idéalement par deux canaux différents.')}</p>

      <div class="sceau-card">
        <div class="sceau-card-lbl">${linkLbl}</div>
        <div class="sceau-linkrow"><code class="sceau-code">${_esc(r.url)}</code><button class="sceau-iconbtn" data-act="copyurl" title="Copier">${icon('copy', 17)}</button></div>
        <div class="sceau-qr" id="sceau-qr"></div>
        <div class="sceau-qr-actions">
          <div class="sceau-qr-group">
            <span class="sceau-qr-group-lbl">Exporter le QR</span>
            <div class="sceau-qr-group-btns">
              <button class="sceau-btn" data-act="qr-export" data-fmt="png">${icon('download', 15)} PNG</button>
              <button class="sceau-btn" data-act="qr-export" data-fmt="svg">${icon('download', 15)} SVG</button>
              <button class="sceau-btn" data-act="qr-export" data-fmt="pdf">${icon('download', 15)} PDF</button>
            </div>
          </div>
          <div class="sceau-qr-group">
            <span class="sceau-qr-group-lbl">Diffuser le QR</span>
            <div class="sceau-qr-group-btns">
              ${(typeof navigator !== 'undefined' && navigator.share) ? `<button class="sceau-btn" data-act="qr-share">${icon('share', 16)} Partager</button>` : ''}
              <button class="sceau-btn" data-act="nfc">${icon('radio', 16)} Puce NFC</button>
            </div>
          </div>
        </div>
        <span class="sceau-nfc-msg" id="sceau-nfc-msg"></span>
        ${emptyNote}
      </div>
      ${passCard}
      ${emailNote}
      <button class="sceau-btn primary big" data-act="tolist">Terminé</button>
    </div>`;
  const qel = main.querySelector('#sceau-qr');
  if (qel && r.url) _renderQr(r.url, qel);
}

async function _renderQr(text, el) {
  try {
    const mod = await import('https://esm.sh/qrcode-generator@1.4.4');
    const qrcode = mod.default || mod;
    const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  } catch (_) { el.innerHTML = `<span class="sceau-nfc-msg">QR indisponible — utilisez le lien.</span>`; }
}

// ── Moteur d'export QR (PNG / SVG / PDF) ────────────────────────
async function _qrObj(text) {
  const mod = await import('https://esm.sh/qrcode-generator@1.4.4');
  const qrcode = mod.default || mod;
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  return qr;
}
function _qrSvgString(qr) {
  // SVG vectoriel autonome (impression nette à toute taille). createSvgTag
  // inclut déjà xmlns ; on préfixe le prologue XML pour un .svg standalone.
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
}
async function _qrCanvas(qr) {
  const gifUrl = qr.createDataURL(12, 4); // GIF net (pixel-art), même origine → canvas non « tainted »
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = gifUrl; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0);
  return c;
}
function _downloadBlob(blob, filename) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
const _QR_EXT = { png: 'png', svg: 'svg', pdf: 'pdf' };
async function _exportQr(url, fmt, btn) {
  if (!url || !_QR_EXT[fmt]) return;
  const orig = btn ? btn.innerHTML : null;
  if (btn) btn.innerHTML = `${icon('refresh', 15)} …`;
  try {
    const qr = await _qrObj(url);
    let blob;
    if (fmt === 'svg') {
      blob = new Blob([_qrSvgString(qr)], { type: 'image/svg+xml' });
    } else if (fmt === 'png') {
      const c = await _qrCanvas(qr); blob = await new Promise(r => c.toBlob(r, 'image/png'));
    } else { // pdf
      const c = await _qrCanvas(qr);
      const png = c.toDataURL('image/png');
      const jspdf = await import('https://esm.sh/jspdf@2.5.1');
      const JsPDF = jspdf.jsPDF || jspdf.default || (jspdf.default && jspdf.default.jsPDF);
      const doc = new JsPDF({ unit: 'pt', format: 'a4' });
      const pw = doc.internal.pageSize.getWidth();
      const size = 280, x = (pw - size) / 2, y = 90;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
      doc.text('Missive sécurisée', pw / 2, 64, { align: 'center' });
      doc.addImage(png, 'PNG', x, y, size, size);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90);
      doc.text('Scannez ce code pour ouvrir la missive (lisible une seule fois).', pw / 2, y + size + 28, { align: 'center' });
      doc.setFontSize(9);
      doc.text(url, pw / 2, y + size + 46, { align: 'center', maxWidth: pw - 80 });
      blob = doc.output('blob');
    }
    _downloadBlob(blob, `missive-qr.${_QR_EXT[fmt]}`);
    if (btn) { btn.innerHTML = `${icon('check', 15)} ${fmt.toUpperCase()}`; setTimeout(() => { btn.innerHTML = orig; }, 1600); }
  } catch (_) {
    if (btn) btn.innerHTML = orig;
    _toast(`Export ${fmt.toUpperCase()} impossible.`);
  }
}
async function _shareQr(url, btn) {
  if (!url || typeof navigator === 'undefined' || !navigator.share) { return _copy(url, btn); }
  try {
    const qr = await _qrObj(url);
    const c = await _qrCanvas(qr);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'missive-qr.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Missive sécurisée', text: url });
    } else {
      await navigator.share({ title: 'Missive sécurisée', text: url, url });
    }
  } catch (e) { if (e && e.name === 'AbortError') return; _toast('Partage indisponible — lien copié.'); _copy(url, btn); }
}

// ── Actions ─────────────────────────────────────────────────────
function _onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, id = t.dataset.id, tid = t.dataset.tid;
  if (act === 'close')  return closeSceau();
  if (act === 'reload') return _load();
  if (act === 'reload-tok') return _loadTokens();
  if (act === 'tab-secrets') { _view = 'list'; _load(); return; }
  if (act === 'tab-tokens')  { _view = 'tokens'; _loadTokens(); return; }
  if (act === 'new')    { _tokenTarget = null; _createMode = 'text'; _recBlob = null; _fileSel = null; _unlockMode = 'code'; _codeStyle = 'fort'; _draft = {}; _view = 'create'; _render(); return; }
  if (act === 'newtoken') return _createToken();
  if (act === 'mode-text')  { _captureDraft(); _createMode = 'text';  _recBlob = null; _fileSel = null; _render(); return; }
  if (act === 'mode-vocal') { _captureDraft(); _createMode = 'vocal'; _fileSel = null; _render(); return; }
  if (act === 'mode-file')  { _captureDraft(); _createMode = 'file';  _recBlob = null; _render(); return; }
  if (act === 'rec-start') return _recStart();
  if (act === 'rec-stop')  return _recStop();
  if (act === 'rec-reset') return _recReset();
  if (act === 'file-pick') { const i = _root.querySelector('#sceau-file-input'); if (i) i.click(); return; }
  if (act === 'file-reset') { _fileSel = null; _paintFile(); return; }
  if (act === 'unlock-code')  { _captureDraft(); _unlockMode = 'code';  _render(); return; }
  if (act === 'unlock-qa')    { _captureDraft(); _unlockMode = 'qa';    _render(); return; }
  if (act === 'unlock-email') { _captureDraft(); _unlockMode = 'email'; _render(); return; }
  if (act === 'code-fort') { _captureDraft(); _codeStyle = 'fort'; _render(); return; }
  if (act === 'code-mots') { _captureDraft(); _codeStyle = 'mots'; _render(); return; }
  if (act === 'qr-export') return _exportQr(t.dataset.url || _result?.url, t.dataset.fmt, t);
  if (act === 'qr-share')  return _shareQr(t.dataset.url || _result?.url, t);
  if (act === 'tolist') { _view = _tokenTarget ? 'tokens' : 'list'; _result = null; _tokenTarget = null; (_view === 'tokens' ? _loadTokens : _load)(); return; }
  if (act === 'link')   return _copyLink(id, t);
  if (act === 'qr')     return _toggleRowQr(`${API_BASE}/s/${id}`, id);
  if (act === 'burn')   return _burn(id, t);
  if (act === 'remove') return _remove(id);
  if (act === 'copyurl')  return _copy(_result?.url, t);
  if (act === 'copypass') return _copy(_result?.passphrase, t);
  if (act === 'nfc')    return _writeNfc(t);
  if (act === 'nfc-url') return _writeNfcUrl(t.dataset.url, _root.querySelector('#sceau-rowqr-msg'));
  if (act === 'tok-load') { _tokenTarget = tid; _createMode = 'text'; _recBlob = null; _fileSel = null; _unlockMode = 'code'; _codeStyle = 'fort'; _draft = {}; _view = 'create'; _render(); return; }
  if (act === 'tok-link') return _copy(`${API_BASE}/s/t/${tid}`, t);
  if (act === 'tok-qr')   return _toggleRowQr(`${API_BASE}/s/t/${tid}`, tid);
  if (act === 'tok-burn') return _burnToken(tid);
}

function _onSubmit(e) {
  if (e.target.matches('[data-form="create"]')) { e.preventDefault(); _create(); }
}

async function _create() {
  if (_busy) return;
  // Charge utile : texte (UTF-8) ou octets du vocal enregistré.
  let payload, kind, mime = null;
  if (_createMode === 'vocal') {
    if (!_recBlob) { _toast('Enregistrez un message vocal d\'abord.'); return; }
    payload = new Uint8Array(await _recBlob.arrayBuffer());
    kind = 'audio'; mime = _recBlob.type || 'audio/webm';
  } else if (_createMode === 'file') {
    if (!_fileSel) { _toast('Choisissez un fichier d\'abord.'); return; }
    if (_fileSel.size > SEC_FILE_MAX) { _toast(`Fichier trop volumineux (max ${_fmtSize(SEC_FILE_MAX)}).`); return; }
    const bytes = new Uint8Array(await _fileSel.arrayBuffer());
    // Le nom est chiffré DANS la charge (en-tête) → le serveur ne le voit jamais.
    payload = _packFile(_fileSel.name, _fileSel.type, bytes);
    kind = 'file'; mime = _fileSel.type || 'application/octet-stream';
  } else {
    const secret = _root.querySelector('#sceau-secret')?.value || '';
    if (!secret.trim()) { _toast('Saisissez un secret.'); return; }
    payload = _enc.encode(secret); kind = 'text';
  }
  const label = _root.querySelector('#sceau-name')?.value?.trim() || null;
  const max = parseInt(_root.querySelector('#sceau-max')?.value || '3', 10);
  const expSec = parseInt(_root.querySelector('#sceau-exp')?.value || '0', 10);
  const expires_at = expSec > 0 ? new Date(Date.now() + expSec * 1000).toISOString() : null;

  // Mode de déverrouillage : code généré / question-réponse / code par email.
  // En Q/R, la clé dérive de la réponse normalisée → rien à transmettre.
  // En email, le code est généré ici (E2E inchangé) puis RELAYÉ par le serveur.
  let question = null, oprfInput, passphrase = null, emailTo = null;
  if (_unlockMode === 'qa') {
    question = _root.querySelector('#sceau-q')?.value?.trim() || '';
    const answer = _root.querySelector('#sceau-a')?.value || '';
    if (!question) { _toast('Saisissez une question.'); return; }
    const normd = _normAnswer(answer);
    if (!normd) { _toast('Saisissez une réponse (lettres ou chiffres).'); return; }
    oprfInput = normd;
  } else if (_unlockMode === 'email') {
    emailTo = _root.querySelector('#sceau-email')?.value?.trim() || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailTo)) { _toast('Saisissez un email valide.'); return; }
    passphrase = _genPassphrase();
    oprfInput = passphrase;
  } else {
    passphrase = (_codeStyle === 'mots') ? _genWordsPassphrase() : _genPassphrase();
    oprfInput = passphrase;
  }

  _busy = true; _render();
  try {
    const V = await _voprf();
    const SUITE = V.Oprf.Suite.P256_SHA256;
    // 1) init — le serveur crée la paire OPRF, renvoie la clé publique.
    const init = await _api('/init', { method: 'POST', body: { label } });
    // 2) eval de CRÉATION (non comptée) — dérive la sortie OPRF.
    const client = new V.VOPRFClient(SUITE, _b64d(init.oprf_pub));
    const [fin, ereq] = await client.blind([_enc.encode(oprfInput)]);
    const ev = await _api(`/${init.short_id}/eval`, { method: 'POST', body: { blinded: _b64e(ereq.serialize()) } });
    const [output] = await client.finalize(fin, V.Evaluation.deserialize(SUITE, _b64d(ev.evaluation)));
    // 3) chiffrement E2E sur l'appareil, puis seal (le serveur ne voit que le chiffré).
    const key = await _aesKey(output);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload));
    await _api(`/${init.short_id}/seal`, { method: 'POST', body: { ciphertext: _b64e(ct), iv: _b64e(iv), kind, mime, question, max_attempts: max, expires_at, label } });

    let url = `${API_BASE}/s/${init.short_id}`;
    if (_tokenTarget) {
      // Rechargement d'un jeton existant : on pointe le pointeur stable vers ce secret.
      await _api(`/token/${_tokenTarget}/point`, { method: 'POST', body: { short_id: init.short_id } });
      url = `${API_BASE}/s/t/${_tokenTarget}`;
    }
    // Mode email : le serveur relaie lien + code au destinataire (best-effort).
    let emailSent = false, emailErr = null;
    if (emailTo) {
      try {
        await _api(`/${init.short_id}/email`, { method: 'POST', body: { to: emailTo, code: passphrase } });
        emailSent = true;
      } catch (e) { emailErr = e.message || 'Envoi impossible'; }
    }
    _result = { passphrase, url, isToken: !!_tokenTarget, qa: _unlockMode === 'qa', emailTo, emailSent, emailErr };
    _busy = false; _view = 'result'; _render();
  } catch (e) {
    _busy = false; _render();
    _toast(e.message || 'Échec du scellage.');
  }
}

async function _burn(id, btn) {
  if (!confirm('Détruire cette missive définitivement ? Le destinataire ne pourra plus l\'ouvrir.')) return;
  try { await _api(`/${id}`, { method: 'DELETE' }); _load(); }
  catch (e) { _toast(e.message); }
}

// Retirer une missive déjà morte (résidu) — suppression directe, pas de confirmation.
async function _remove(id) {
  try { await _api(`/${id}`, { method: 'DELETE' }); _load(); }
  catch (e) { _toast(e.message); }
}

async function _createToken() {
  const label = prompt('Nom du jeton (pour vous) :', '') ?? null;
  try {
    const d = await _api('/token', { method: 'POST', body: { label: label || null } });
    _result = { url: `${API_BASE}/s/t/${d.token_id}`, isToken: true, empty: true };
    _view = 'result'; _render();
  } catch (e) { _toast(e.message); }
}

async function _burnToken(tid) {
  if (!confirm('Supprimer ce jeton ? Son message actif sera détruit et l\'objet deviendra inactif.')) return;
  try { await _api(`/token/${tid}`, { method: 'DELETE' }); _loadTokens(); }
  catch (e) { _toast(e.message); }
}

function _copyLink(id, btn) { _copy(`${API_BASE}/s/${id}`, btn); }
async function _copy(text, btn) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); if (btn) { const o = btn.innerHTML; btn.innerHTML = icon('check', 17); setTimeout(() => btn.innerHTML = o, 1400); } }
  catch (_) { _toast('Copie indisponible — sélectionnez manuellement.'); }
}

function _toggleRowQr(url, key) {
  const slot = _root.querySelector('#sceau-qrslot');
  if (!slot) return;
  if (slot.dataset.open === key) { slot.innerHTML = ''; slot.dataset.open = ''; return; }
  slot.dataset.open = key;
  const u = _esc(url);
  const nfc = ('NDEFReader' in window) ? `<button class="sceau-btn" data-act="nfc-url" data-url="${u}">${icon('radio', 16)} Puce NFC</button>` : '';
  const share = (typeof navigator !== 'undefined' && navigator.share) ? `<button class="sceau-btn" data-act="qr-share" data-url="${u}">${icon('share', 16)} Partager</button>` : '';
  slot.innerHTML = `<div class="sceau-qr-pop"><div class="sceau-qr" id="sceau-rowqr"></div><code class="sceau-code">${u}</code>
    <div class="sceau-qr-actions">
      <div class="sceau-qr-group">
        <span class="sceau-qr-group-lbl">Exporter le QR</span>
        <div class="sceau-qr-group-btns">
          <button class="sceau-btn" data-act="qr-export" data-fmt="png" data-url="${u}">${icon('download', 15)} PNG</button>
          <button class="sceau-btn" data-act="qr-export" data-fmt="svg" data-url="${u}">${icon('download', 15)} SVG</button>
          <button class="sceau-btn" data-act="qr-export" data-fmt="pdf" data-url="${u}">${icon('download', 15)} PDF</button>
        </div>
      </div>
      ${(share || nfc) ? `<div class="sceau-qr-group">
        <span class="sceau-qr-group-lbl">Diffuser le QR</span>
        <div class="sceau-qr-group-btns">${share}${nfc}</div>
      </div>` : ''}
    </div><span class="sceau-nfc-msg" id="sceau-rowqr-msg"></span></div>`;
  _renderQr(url, slot.querySelector('#sceau-rowqr'));
}

function _writeNfc(btn) { return _writeNfcUrl(_result?.url, _root.querySelector('#sceau-nfc-msg')); }
async function _writeNfcUrl(url, msg) {
  if (!url) return;
  if (!('NDEFReader' in window)) { if (msg) msg.textContent = 'NFC non disponible sur cet appareil (Android + Chrome requis). Utilisez le QR ou le lien.'; return; }
  try {
    if (msg) msg.textContent = 'Approchez une puce NFC…';
    const ndef = new window.NDEFReader();
    await ndef.write({ records: [{ recordType: 'url', data: url }] });
    if (msg) msg.textContent = 'Puce encodée.';
  } catch (e) { if (msg) msg.textContent = 'Écriture NFC annulée ou impossible.'; }
}

function _toast(text) {
  if (!_root) return;
  let t = _root.querySelector('.sceau-toast');
  if (!t) { t = document.createElement('div'); t.className = 'sceau-toast'; _root.appendChild(t); }
  t.textContent = text; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}
