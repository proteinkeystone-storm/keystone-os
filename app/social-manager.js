/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Manager (O-SOC-001) v2.0 — Workspace fullscreen
   Sprint Social-5 / Pad « Social Manager » — composer REGISTRE-DRIVEN
   ─────────────────────────────────────────────────────────────
   Façade UI du moteur de diffusion sociale.
   - Gauche (saisie)   : message + compteur + réseaux + photo + garde-fous
   - Droite (résultat) : aperçu live (identité réelle) + résultat de publication

   ⚡ Le composer NE CODE AUCUN RÉSEAU EN DUR : il lit les capacités via
   GET /api/social/registry (longueurs, médias supportés, hashtags…) et en
   dérive le compteur, les avertissements par réseau et l'état du bouton
   Publier — même source de vérité que le moteur (registry.validateForPlatform).

   Auth : localStorage['ks_jwt'|'ks_admin_token'] → Authorization: Bearer.
   Routes Worker : GET /api/social/registry · GET /api/social/accounts
                   · POST /api/social/publish · POST /api/social/media.
   Pattern .ws-app / .ws-topbar / .ws-body (cf. annonces-immo.js).
   ═══════════════════════════════════════════════════════════════ */

import { helpButtonHTML, bindHelpButton }    from './lib/help-overlay.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { burgerHTML, bindBurger }            from './lib/topbar-burger.js';
import { icon }                              from './lib/ui-icons.js';
import { CF_API }                            from './pads-loader.js';

const APP_ID    = 'O-SOC-001';
const DRAFT_KEY = 'ks_social_manager_draft_v1';

// Icône de marque par réseau (le set ui-icons fournit facebook/instagram/
// linkedin/threads). Le LIBELLÉ, lui, vient du registre (jamais codé ici).
const NET_ICON = { facebook: 'facebook', instagram: 'instagram', linkedin: 'linkedin', threads: 'threads', telegram: 'telegram' };
const NET_LABEL_FALLBACK = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', threads: 'Threads', telegram: 'Telegram' };

// Teinte de marque par réseau (glyphe + état sélectionné). Threads est
// monochrome (#000) → traité en CSS via --text/--navy pour rester visible
// quel que soit le thème (blanc sur sombre / noir sur clair).
const NET_BRAND = { facebook: '#0866FF', instagram: '#E1306C', linkedin: '#0A66C2', telegram: '#2AABEE' };
const _hexToRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Capacités de repli SI le registre worker est injoignable (offline / worker
// down). La source de vérité reste /api/social/registry ; ceci évite juste une
// UI muette. À garder cohérent avec registry.js.
const FALLBACK_CAPS = {
  facebook:  { id:'facebook',  label:'Facebook',  text:{ maxLength:63206, maxHashtags:null }, media:{ enabled:true,  required:false, imageMax:10 } },
  instagram: { id:'instagram', label:'Instagram', text:{ maxLength:2200,  maxHashtags:30   }, media:{ enabled:true,  required:true,  imageMax:10 } },
  linkedin:  { id:'linkedin',  label:'LinkedIn',  text:{ maxLength:3000,  maxHashtags:null }, media:{ enabled:false, required:false, imageMax:9  } },
  threads:   { id:'threads',   label:'Threads',   text:{ maxLength:500,   maxHashtags:null }, media:{ enabled:true,  required:false, imageMax:10 } },
  telegram:  { id:'telegram',  label:'Telegram',  text:{ maxLength:4096,  maxHashtags:null }, media:{ enabled:true,  required:false, imageMax:10, captionMaxLength:1024 } },
};

// ── État module ────────────────────────────────────────────────
let _root     = null;
let _styles   = false;
let _busy     = false;
let _accounts = null;          // null = pas chargé, [] = chargé/vide
let _caps     = null;          // null = pas chargé ; map platformId → capacités
let _form     = { text: '', targets: [], imageUrl: null, imageName: null };
let _connect  = null;          // état du wizard « Connecter un réseau social » (null = fermé)
let _schedOpen = false;        // panneau de programmation déplié ?
let _queue     = null;         // null = pas chargé ; [] = chargé ; file des posts (programmés + récents)
let _queueTimer = null;        // timer de rafraîchissement auto de la file

const _adminToken = () => { try { return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || ''; } catch (_) { return ''; } };
const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const _capOf   = (p) => (_caps && _caps[p]) || FALLBACK_CAPS[p] || null;
const _labelOf = (p) => _capOf(p)?.label || NET_LABEL_FALLBACK[p] || p;

// ══════════════════════════════════════════════════════════════
// API publique
// ══════════════════════════════════════════════════════════════

export function openSocialManager() {
  if (_root) return;
  _injectStyles();
  _loadDraft();
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';
  _loadCaps();
  _loadAccounts();
  _loadQueue();
  _startQueuePolling();
  document.addEventListener('visibilitychange', _onVisible);
}

export function closeSocialManager() {
  if (!_root) return;
  _saveDraft();
  _stopQueuePolling();
  document.removeEventListener('keydown', _onKey);
  document.removeEventListener('visibilitychange', _onVisible);
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════════════
// Brouillon (localStorage)
// ══════════════════════════════════════════════════════════════
function _saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: _form.text, targets: _form.targets })); } catch (_) {}
}
function _loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) { const d = JSON.parse(raw); _form.text = d.text || ''; _form.targets = Array.isArray(d.targets) ? d.targets : []; }
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════
// Shell (topbar + body)
// ══════════════════════════════════════════════════════════════
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour au Dashboard">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('user', 24)}</span>
        <span class="name">Social Manager</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(APP_ID)}
        ${ratingButtonHTML(APP_ID)}
        <button class="ws-iconbtn" data-act="reset" title="Effacer et recommencer" aria-label="Réinitialiser">
          ${icon('refresh', 18)}
        </button>
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main" data-slot="main"></main>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click',  _onClick);
  _root.addEventListener('input',  _onInput);
  _root.addEventListener('change', _onChange);
  document.addEventListener('keydown', _onKey);
  bindRatingButton(_root, APP_ID);
  bindHelpButton(_root, APP_ID);
  bindBurger(_root);
}

function _onKey(e) { if (e.key === 'Escape') closeSocialManager(); }

// ══════════════════════════════════════════════════════════════
// Rendu principal (split 60/40)
// ══════════════════════════════════════════════════════════════
function _renderMain() {
  const main = _root && _root.querySelector('[data-slot="main"]');
  if (!main) return;
  const noAdmin = !_adminToken();

  main.innerHTML = `
    <div class="sm-wrap">
      <div class="sm-hero">
        <h1 class="sm-title">Social Manager</h1>
        <p class="sm-subtitle">Composez une publication et diffusez-la sur vos réseaux connectés, en un clic.</p>
      </div>

      ${noAdmin ? `<div class="sm-banner sm-banner-warn">${icon('lock', 15)}&nbsp;Connecte-toi en <strong>admin</strong> pour charger tes comptes et publier.</div>` : ''}

      <div class="sm-split">
        <!-- ── Saisie (gauche, 60%) ───────────────────────── -->
        <section class="sm-left">
          <div class="sm-field">
            <label class="sm-label" for="sm-text">Message</label>
            <textarea id="sm-text" class="sm-textarea" data-field="text" rows="7"
              placeholder="Rédigez votre publication…">${_esc(_form.text)}</textarea>
            <div class="sm-counter" data-slot="counter" aria-live="polite"></div>
          </div>

          <div class="sm-field">
            <label class="sm-label">Réseaux cibles</label>
            <div class="sm-nets" data-slot="nets" role="group" aria-label="Réseaux cibles">
              <div class="sm-nets-loading">Chargement des comptes connectés…</div>
            </div>
            <button type="button" class="sm-connect-trigger" data-act="open-connect">${icon('plus', 15)}&nbsp;Connecter un réseau social</button>
          </div>

          <div class="sm-field">
            <label class="sm-label">Photo <span class="sm-opt">(optionnel)</span></label>
            <div class="sm-media" data-slot="media"></div>
          </div>

          <div class="sm-issues" data-slot="issues" aria-live="polite"></div>

          <div class="sm-actions">
            <button class="sm-btn-primary" data-act="publish" ${noAdmin ? 'disabled' : ''}>
              ${icon('zap', 18)}&nbsp;Publier
            </button>
            <button class="sm-btn-ghost" data-act="toggle-schedule" ${noAdmin ? 'disabled' : ''}>
              ${icon('calendar', 17)}&nbsp;Programmer…
            </button>
          </div>
          <div class="sm-sched" data-slot="sched" hidden></div>
        </section>

        <!-- ── Aperçu / résultat (droite, 40%) ─────────────── -->
        <aside class="sm-right">
          <div class="sm-right-lbl">Aperçu</div>
          <div class="sm-preview" data-slot="preview"></div>
          <div class="sm-result" data-slot="result"></div>
        </aside>
      </div>

      <section class="sm-queue" data-slot="queue"></section>
    </div>
  `;
  _renderNets();
  _renderMedia();
  _renderPreview();
  _renderValidation();
  _renderSchedule();
  _renderQueue();
}

// ── Liste des réseaux (boutons toggle a11y) depuis _accounts ───
function _renderNets() {
  const box = _root && _root.querySelector('[data-slot="nets"]');
  if (!box) return;

  if (_accounts === null) { box.innerHTML = `<div class="sm-nets-loading">Chargement des comptes connectés…</div>`; return; }
  if (_accounts.length === 0) {
    box.innerHTML = `<div class="sm-nets-empty">Aucun compte connecté. Provisionne un réseau côté Worker pour le voir ici.</div>`;
    return;
  }
  box.innerHTML = _accounts.map(a => {
    const p  = a.platform;
    const on = _form.targets.includes(p);
    const brand = NET_BRAND[p];
    const brandStyle = brand ? ` style="--brand:${brand};--brand-soft:${_hexToRgba(brand, 0.14)}"` : '';
    return `
      <button type="button" class="sm-net ${on ? 'is-on' : ''}" data-net="${_esc(p)}" aria-pressed="${on}"${brandStyle}>
        <span class="sm-net-glyph">${icon(NET_ICON[p] || 'globe', 18)}</span>
        <span class="sm-net-txt">
          <span class="sm-net-name">${_esc(_labelOf(p))}</span>
          <span class="sm-net-handle">${_esc(a.display_name || '')}</span>
        </span>
      </button>`;
  }).join('');

  _equalizeNetWidths(box);
}

// Largeur homogène : toutes les chips réseaux calées sur la plus large
// (mesure de la largeur naturelle, puis application du max à toutes).
function _equalizeNetWidths(box) {
  const chips = [...box.querySelectorAll('.sm-net')];
  if (chips.length < 2) return;
  chips.forEach(c => { c.style.width = 'auto'; });
  let max = 0;
  for (const c of chips) max = Math.max(max, Math.ceil(c.getBoundingClientRect().width));
  chips.forEach(c => { c.style.width = `${max}px`; });
}

// ── Zone média : bouton d'upload OU vignette avec retrait ──────
function _renderMedia() {
  const box = _root && _root.querySelector('[data-slot="media"]');
  if (!box) return;
  if (_form.imageUrl) {
    box.innerHTML = `
      <div class="sm-media-chip">
        ${icon('image', 15)}
        <span class="sm-media-name" title="${_esc(_form.imageName || 'image')}">${_esc(_form.imageName || 'image')}</span>
        <button type="button" class="sm-media-x" data-act="remove-image" aria-label="Retirer la photo" title="Retirer la photo">${icon('x', 15)}</button>
      </div>`;
  } else {
    box.innerHTML = `
      <label class="sm-upload">
        <input type="file" accept="image/*" data-field="image" hidden>
        ${icon('image', 16)}&nbsp;<span data-slot="media-label">Choisir une image…</span>
      </label>`;
  }
}

// ── Aperçu live du post (identité réelle du compte) ────────────
function _renderPreview() {
  const box = _root && _root.querySelector('[data-slot="preview"]');
  if (!box) return;
  const txt      = _form.text.trim();
  const identity = _previewIdentity();
  const initial  = (identity.trim()[0] || 'P').toUpperCase();
  const glyphs   = _form.targets.length
    ? _form.targets.map(p => {
        const brand = NET_BRAND[p];
        const st = brand ? ` style="color:${brand}"` : '';   // Threads → couleur héritée (monochrome via CSS)
        return `<span class="sm-card-net-ic" data-net="${_esc(p)}"${st} title="${_esc(_labelOf(p))}">${icon(NET_ICON[p] || 'globe', 14)}</span>`;
      }).join('')
    : '<span class="sm-muted">aucun réseau sélectionné</span>';

  box.innerHTML = `
    <div class="sm-card">
      <div class="sm-card-head">
        <div class="sm-card-avatar">${_esc(initial)}</div>
        <div class="sm-card-meta">
          <div class="sm-card-name">${_esc(identity)}</div>
          <div class="sm-card-nets">${glyphs}</div>
        </div>
      </div>
      <div class="sm-card-text">${txt ? _esc(txt).replace(/\n/g, '<br>') : '<span class="sm-muted">Votre message apparaîtra ici…</span>'}</div>
      ${_form.imageUrl ? `<div class="sm-card-img"><img src="${_esc(_form.imageUrl)}" alt=""></div>` : ''}
    </div>
  `;
}

// Identité affichée dans l'aperçu : display_name du 1er réseau sélectionné
// (sinon 1er compte connecté, sinon repli neutre). Plus de marque codée en dur.
function _previewIdentity() {
  const accs = _accounts || [];
  for (const p of _form.targets) {
    const a = accs.find(x => x.platform === p && x.display_name);
    if (a) return a.display_name;
  }
  const any = accs.find(x => x.display_name);
  return any ? any.display_name : 'Votre page';
}

// ══════════════════════════════════════════════════════════════
// Garde-fous registre-driven (compteur + issues + bouton)
// ══════════════════════════════════════════════════════════════

// Compte les #hashtags présents dans le texte (les hashtags sont inline ici).
function _countHashtags(text) {
  const m = text.match(/#[\p{L}0-9_]+/gu);
  return m ? m.length : 0;
}

// Limite de texte EFFECTIVE pour un réseau : avec une photo, certains imposent
// une légende plus courte (Telegram 1024 vs 4096 en texte seul) → captionMaxLength prime.
const _textLimit = (c, hasImg) => (hasImg && c?.media?.captionMaxLength) ? c.media.captionMaxLength : (c?.text?.maxLength ?? null);

// Limite de caractères affichée = la PLUS contraignante parmi les réseaux
// sélectionnés (ex. Threads 500 l'emporte sur Facebook 63206 ; Telegram+photo → 1024).
function _counterInfo() {
  const hasImg = !!_form.imageUrl;
  let best = null;
  for (const p of _form.targets) {
    const c = _capOf(p);
    const max = _textLimit(c, hasImg);
    if (max && (!best || max < best.limit)) best = { limit: max, label: c.label || _labelOf(p) };
  }
  if (!best) return null;
  return { used: _form.text.trim().length, limit: best.limit, label: best.label };
}

// Calcule les problèmes par réseau À PARTIR DU REGISTRE (pas de règle en dur).
function _validate() {
  const text   = _form.text.trim();
  const hasImg = !!_form.imageUrl;
  const tags   = _countHashtags(text);
  const global = [];
  const perNet = {};
  const reasons = [];   // messages plats lisibles (pour le toast)

  if (!text && !hasImg) global.push('Écris un message ou ajoute une photo.');
  if (!_form.targets.length) global.push('Sélectionne au moins un réseau.');

  for (const p of _form.targets) {
    const c = _capOf(p);
    const errors = [], warnings = [];
    if (c) {
      const max = _textLimit(c, hasImg);
      if (max && text.length > max) {
        errors.push(`texte trop long (${text.length}/${max}${hasImg && c.media?.captionMaxLength ? ', légende' : ''}).`);
      }
      if (c.media?.required && !hasImg) {
        errors.push('exige une photo.');
      }
      if (hasImg && c.media && c.media.enabled === false) {
        errors.push('n\'accepte pas encore les photos — retire-la ou décoche ce réseau.');
      }
      if (c.text?.maxHashtags && tags > c.text.maxHashtags) {
        warnings.push(`${tags} hashtags (max conseillé ${c.text.maxHashtags}).`);
      }
    }
    perNet[p] = { errors, warnings };
    for (const e of errors) reasons.push(`${_labelOf(p)} — ${e}`);
  }

  reasons.unshift(...global);
  const blocking = global.length > 0 || Object.values(perNet).some(x => x.errors.length > 0);
  return { global, perNet, reasons, canPublish: !blocking };
}

// Met à jour compteur, panneau d'issues, surlignage réseaux et bouton.
function _renderValidation() {
  if (!_root) return null;
  const v = _validate();

  // Compteur de caractères
  const cEl = _root.querySelector('[data-slot="counter"]');
  if (cEl) {
    const ci = _counterInfo();
    if (ci) {
      const over = ci.used > ci.limit;
      cEl.innerHTML = `<span class="sm-counter-num ${over ? 'over' : ''}">${ci.used} / ${ci.limit}</span> <span class="sm-counter-net">${_esc(ci.label)}</span>`;
    } else { cEl.innerHTML = ''; }
  }

  // Panneau d'issues PAR RÉSEAU (le cœur du garde-fou)
  const iEl = _root.querySelector('[data-slot="issues"]');
  if (iEl) {
    const rows = [];
    for (const p of _form.targets) {
      const it = v.perNet[p]; if (!it) continue;
      for (const e of it.errors)   rows.push(`<li class="sm-issue err">${icon('alert-triangle', 13)}<span><strong>${_esc(_labelOf(p))}</strong> ${_esc(e)}</span></li>`);
      for (const w of it.warnings) rows.push(`<li class="sm-issue warn">${icon('alert-triangle', 13)}<span><strong>${_esc(_labelOf(p))}</strong> ${_esc(w)}</span></li>`);
    }
    iEl.innerHTML = rows.length ? `<ul class="sm-issues-list">${rows.join('')}</ul>` : '';
  }

  // Surlignage des réseaux en erreur
  _root.querySelectorAll('.sm-net[data-net]').forEach(el => {
    const it = v.perNet[el.dataset.net];
    el.classList.toggle('has-err', !!(it && it.errors.length));
  });

  // Bouton Publier
  const btn = _root.querySelector('[data-act="publish"]');
  if (btn) {
    btn.disabled = _busy || !_adminToken() || !v.canPublish;
    btn.title = v.canPublish ? '' : (v.reasons[0] || 'Vérifie les contraintes par réseau.');
  }
  return v;
}

// ══════════════════════════════════════════════════════════════
// Données : registre des capacités (garde-fous) + comptes
// ══════════════════════════════════════════════════════════════
async function _loadCaps() {
  try {
    const res  = await fetch(`${CF_API}/api/social/registry`);
    const data = await res.json().catch(() => ({}));
    const arr  = Array.isArray(data.platforms) ? data.platforms : [];
    if (arr.length) { _caps = {}; for (const c of arr) _caps[c.id] = c; }
    else            { _caps = { ...FALLBACK_CAPS }; }
  } catch (_) {
    _caps = { ...FALLBACK_CAPS };
  }
  // Les libellés/garde-fous dépendent des caps → re-render des zones concernées.
  _renderNets();
  _renderPreview();
  _renderValidation();
}

async function _loadAccounts() {
  const token = _adminToken();
  if (!token) { _accounts = []; _renderNets(); _renderValidation(); return; }
  try {
    const res = await fetch(`${CF_API}/api/social/accounts`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.status === 401) { _accounts = []; _renderNets(); _renderValidation(); _toast('Session admin expirée', 'warn'); return; }
    const data = await res.json().catch(() => ({}));
    _accounts = Array.isArray(data.accounts) ? data.accounts.filter(a => a.status === 'connected') : [];
    // Pré-sélection : tout ce qui est connecté (sauf si un brouillon de cibles existe)
    if (!_form.targets.length) _form.targets = _accounts.map(a => a.platform);
    _renderNets();
    _renderPreview();
    _renderValidation();
  } catch (e) {
    _accounts = [];
    _renderNets();
    _renderValidation();
    _toast('Comptes non chargés : ' + (e?.message || 'erreur'), 'warn');
  }
}

// ══════════════════════════════════════════════════════════════
// Upload image → R2
// ══════════════════════════════════════════════════════════════
async function _uploadImage(file) {
  const token = _adminToken();
  if (!token) { _toast('Connexion admin requise', 'warn'); return; }
  if (!file.type.startsWith('image/')) { _toast('Fichier non image', 'warn'); return; }

  _setMediaLabel(`Envoi de « ${file.name} »…`);
  try {
    const res = await fetch(`${CF_API}/api/social/media`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': file.type },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || `Erreur ${res.status}`);
    _form.imageUrl  = data.url;
    _form.imageName = file.name;
    _renderMedia();
    _renderPreview();
    _renderValidation();
  } catch (e) {
    _renderMedia();
    _toast('Upload échoué : ' + (e?.message || 'erreur'), 'warn');
  }
}
function _setMediaLabel(t) {
  const el = _root && _root.querySelector('[data-slot="media-label"]');
  if (el) el.textContent = t;
}
function _removeImage() {
  _form.imageUrl  = null;
  _form.imageName = null;
  _renderMedia();
  _renderPreview();
  _renderValidation();
}

// ══════════════════════════════════════════════════════════════
// Publication
// ══════════════════════════════════════════════════════════════
async function _publish() {
  if (_busy) return;
  const token = _adminToken();
  if (!token) { _toast('Connexion admin requise pour publier', 'warn'); return; }

  // Garde-fou registre-driven (même contraintes que le moteur côté Worker).
  const v = _renderValidation();
  if (!v.canPublish) { _toast(v.reasons[0] || 'Vérifie les contraintes par réseau.', 'warn'); return; }

  const text = _form.text.trim();
  _busy = true;
  _setResult(`<div class="sm-result-pending">${icon('zap', 16)}&nbsp;Publication en cours…</div>`);
  const btn = _root.querySelector('[data-act="publish"]'); if (btn) btn.disabled = true;

  const body = {
    targets: _form.targets,
    text,
    source: 'social-manager',
    ...(_form.imageUrl ? { media: [{ type: 'image', url: _form.imageUrl }] } : {}),
  };

  try {
    const res = await fetch(`${CF_API}/api/social/publish`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { _setResult(`<div class="sm-result-ko">Session admin expirée — reconnecte-toi.</div>`); return; }
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

    const rows = (data.results || []).map(r => {
      const ok = r.status === 'published';
      const label = _labelOf(r.platform);
      return `<li class="${ok ? 'ok' : 'ko'}">
        <span class="sm-res-net">${_esc(label)}</span>
        ${ok
          ? `<a href="${_esc(r.url)}" target="_blank" rel="noopener">voir le post ↗</a>`
          : `<span class="sm-res-err">${_esc(r.error || 'échec')}</span>`}
      </li>`;
    }).join('');

    const ok = data.status === 'published';
    _setResult(`
      <div class="sm-result-head ${ok ? 'ok' : (data.status === 'partial' ? 'warn' : 'ko')}">
        ${ok ? '✓ Publié' : data.status === 'partial' ? '◐ Partiel' : '✕ Échec'}
      </div>
      <ul class="sm-result-list">${rows}</ul>
    `);
    if (ok || data.status === 'partial') _toast('Publication envoyée', 'ok');
  } catch (e) {
    _setResult(`<div class="sm-result-ko">${_esc(e?.message || 'Erreur de publication')}</div>`);
  } finally {
    _busy = false;
    _renderValidation();
  }
}
function _setResult(html) {
  const el = _root && _root.querySelector('[data-slot="result"]');
  if (el) el.innerHTML = html;
}

// Réinitialise le composer (CTA Reset topbar — pattern partagé des pads Keystone).
function _reset() {
  _form = { text: '', targets: [], imageUrl: null, imageName: null };
  _schedOpen = false;
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
  // Re-pré-sélectionne les réseaux connectés, comme à l'ouverture.
  if (Array.isArray(_accounts)) _form.targets = _accounts.map(a => a.platform);
  _renderMain();   // reconstruit message + réseaux + média + aperçu + garde-fous + résultat (vide)
  _toast('Composer réinitialisé');
}

// ══════════════════════════════════════════════════════════════
// Programmation & file de publication (Sprint Social-4.1)
// ══════════════════════════════════════════════════════════════

// Date locale « YYYY-MM-DD » pour <input type="date">.
function _toDateInput(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Index sélectionné d'une molette = position de scroll / hauteur d'un cran.
function _wheelIndex(kind) {
  const w = _root && _root.querySelector(`.sm-wheel[data-wheel="${kind}"]`);
  const it = w && w.querySelector('.sm-wheel-item');
  if (!w || !it) return 0;
  return Math.max(0, Math.round(w.scrollTop / it.offsetHeight));
}
// 1re URL de post réelle dans les résultats (pour le lien « voir le post »).
function _postUrl(p) { return (p.results || []).find(r => r && r.url)?.url || null; }
// Affichage humain d'une échéance ISO, en heure locale FR.
function _fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const _Q_LABEL = { scheduled: 'Programmé', publishing: 'En cours', published: 'Publié', partial: 'Partiel', failed: 'Échec', canceled: 'Annulé', draft: 'Brouillon' };
const _qNetGlyphs = (targets) => (targets || []).map(p => `<span title="${_esc(_labelOf(p))}">${icon(NET_ICON[p] || 'globe', 13)}</span>`).join('');

// Panneau de programmation (déplié sous les actions). Convertit l'heure locale
// saisie → ISO UTC à l'envoi (new Date(local).toISOString()) → règle le décalage
// Paris→UTC attendu côté cron.
function _renderSchedule() {
  const box = _root && _root.querySelector('[data-slot="sched"]');
  if (!box) return;
  if (!_schedOpen) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;

  const base  = new Date(Date.now() + 60 * 60_000);               // défaut : +1 h
  const defH  = base.getHours();
  const defMi = (Math.round(base.getMinutes() / 5) % 12) * 5;     // minute arrondie au pas de 5
  const today = _toDateInput(new Date());
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins  = Array.from({ length: 12 }, (_, i) => i * 5);
  const col = (kind, vals) => `
    <div class="sm-wheel" data-wheel="${kind}">
      <div class="sm-wheel-pad"></div>
      ${vals.map((v, i) => `<div class="sm-wheel-item" data-wheel="${kind}" data-idx="${i}">${String(v).padStart(2, '0')}</div>`).join('')}
      <div class="sm-wheel-pad"></div>
    </div>`;

  box.innerHTML = `
    <div class="sm-sched-inner">
      <label class="sm-sched-lbl">${icon('clock', 14)}&nbsp;Date et heure de publication</label>
      <div class="sm-sched-days">
        <button type="button" class="sm-day-chip" data-act="sched-day" data-days="0">Aujourd'hui</button>
        <button type="button" class="sm-day-chip" data-act="sched-day" data-days="1">Demain</button>
        <button type="button" class="sm-day-chip" data-act="sched-day" data-days="2">Après-demain</button>
      </div>
      <div class="sm-sched-row">
        <input type="date" class="sm-sched-date" data-field="sched-date" min="${today}" value="${_toDateInput(base)}">
        <div class="sm-wheel-wrap" aria-label="Heure de publication">
          ${col('h', hours)}
          <div class="sm-wheel-sep">:</div>
          ${col('m', mins)}
          <div class="sm-wheel-band" aria-hidden="true"></div>
        </div>
      </div>
      <div class="sm-sched-hint">Heure locale. Le post part automatiquement à cette heure (précision ~5 min).</div>
      <div class="sm-sched-nav">
        <button type="button" class="sm-wiz-back" data-act="toggle-schedule">Annuler</button>
        <button type="button" class="sm-btn-primary" data-act="do-schedule">${icon('calendar', 16)}&nbsp;Programmer la publication</button>
      </div>
    </div>`;

  // Cale les molettes sur l'heure par défaut (après peinture : offsetHeight dispo).
  requestAnimationFrame(() => {
    const place = (kind, idx) => {
      const w = box.querySelector(`.sm-wheel[data-wheel="${kind}"]`);
      const it = w && w.querySelector('.sm-wheel-item');
      if (w && it) w.scrollTop = idx * it.offsetHeight;
    };
    place('h', defH);
    place('m', defMi / 5);
  });
}

// Chips Aujourd'hui / Demain / Après-demain → fixe la date.
function _setSchedDay(days) {
  const el = _root && _root.querySelector('[data-field="sched-date"]');
  if (el) el.value = _toDateInput(new Date(Date.now() + days * 86400_000));
}

// Programme la publication : mêmes garde-fous que Publier + date future, puis
// POST /publish avec scheduledAt (le Worker range status='scheduled').
async function _doSchedule() {
  if (_busy) return;
  const token = _adminToken();
  if (!token) { _toast('Connexion requise pour programmer', 'warn'); return; }
  const dateStr = (_root && _root.querySelector('[data-field="sched-date"]'))?.value;
  if (!dateStr) { _toast('Choisis une date.', 'warn'); return; }
  const hh = String(Math.min(23, _wheelIndex('h'))).padStart(2, '0');
  const mm = String(Math.min(55, _wheelIndex('m') * 5)).padStart(2, '0');
  const when = new Date(`${dateStr}T${hh}:${mm}`);         // date + molettes (heure locale) → Date
  if (isNaN(when.getTime())) { _toast('Date invalide.', 'warn'); return; }
  if (when.getTime() <= Date.now() + 60_000) { _toast('Choisis une heure dans le futur.', 'warn'); return; }

  const v = _renderValidation();
  if (!v.canPublish) { _toast(v.reasons[0] || 'Vérifie les contraintes par réseau.', 'warn'); return; }

  const body = {
    targets: _form.targets,
    text: _form.text.trim(),
    source: 'social-manager',
    scheduledAt: when.toISOString(),
    ...(_form.imageUrl ? { media: [{ type: 'image', url: _form.imageUrl }] } : {}),
  };

  _busy = true; _renderValidation();
  try {
    const res  = await fetch(`${CF_API}/api/social/publish`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { _toast('Session expirée — reconnecte-toi.', 'warn'); return; }
    if (!res.ok || data.success === false) throw new Error(data.error || `Erreur ${res.status}`);
    _schedOpen = false; _renderSchedule();
    _toast(`Publication programmée — ${_fmtWhen(data.scheduledAt)}`, 'ok');
    await _loadQueue();
  } catch (e) {
    _toast(e?.message || 'Programmation échouée', 'warn');
  } finally {
    _busy = false; _renderValidation();
  }
}

// File de publication (GET /posts) : programmés (annulables) + récents.
async function _loadQueue() {
  const token = _adminToken();
  if (!token) { _queue = []; _renderQueue(); return; }
  try {
    const res = await fetch(`${CF_API}/api/social/posts`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) { _queue = []; _renderQueue(); return; }
    const data = await res.json().catch(() => ({}));
    _queue = Array.isArray(data.posts) ? data.posts : [];
  } catch (_) { _queue = []; }
  _renderQueue();
}

// Rafraîchissement auto : quand le cron publie un post programmé en arrière-plan,
// l'écran doit le refléter sans rechargement manuel. On sonde /posts toutes les
// 30 s TANT QU'un post est en attente (scheduled/publishing), et dès que l'onglet
// reprend le focus. Inactif si rien n'est en attente (zéro requête inutile).
function _startQueuePolling() {
  _stopQueuePolling();
  _queueTimer = setInterval(_pollQueue, 30_000);
}
function _stopQueuePolling() {
  if (_queueTimer) { clearInterval(_queueTimer); _queueTimer = null; }
}
function _pollQueue() {
  if (!_root || document.hidden || _busy) return;
  const pending = Array.isArray(_queue) && _queue.some(p => p.status === 'scheduled' || p.status === 'publishing');
  if (pending) _loadQueue();
}
function _onVisible() { if (!document.hidden) _pollQueue(); }

function _renderQueue() {
  const box = _root && _root.querySelector('[data-slot="queue"]');
  if (!box) return;
  if (!_adminToken()) { box.innerHTML = ''; return; }
  const hasHistory = Array.isArray(_queue) && _queue.some(p => p.status !== 'scheduled' && p.status !== 'publishing');
  const clearBtn = hasHistory ? `<button type="button" class="sm-queue-clear" data-act="clear-history">${icon('trash-2', 13)}&nbsp;Tout effacer</button>` : '';
  const head = `<div class="sm-queue-head"><span>${icon('calendar', 16)}&nbsp;File de publication</span>${clearBtn}</div>`;
  if (_queue === null) { box.innerHTML = head + `<div class="sm-queue-empty">Chargement…</div>`; return; }

  const scheduled = _queue.filter(p => p.status === 'scheduled')
    .sort((a, b) => String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')));
  const recent = _queue.filter(p => p.status !== 'scheduled').slice(0, 24);

  if (!scheduled.length && !recent.length) {
    box.innerHTML = head + `<div class="sm-queue-empty">Aucune publication pour l'instant. Programmes-en une avec le bouton « Programmer… ».</div>`;
    return;
  }

  const exc = (p) => _esc(p.excerpt) || '<span class="sm-muted">(sans texte)</span>';
  const schedRow = (p) => `
    <div class="sm-q-row">
      <span class="sm-q-badge scheduled">${icon('clock', 12)}&nbsp;${_esc(_fmtWhen(p.scheduledAt))}</span>
      <span class="sm-q-excerpt">${exc(p)}</span>
      <span class="sm-q-nets">${_qNetGlyphs(p.targets)}</span>
      <button type="button" class="sm-q-act danger" data-act="cancel-post" data-id="${_esc(p.id)}" title="Annuler" aria-label="Annuler la programmation">${icon('x', 14)}</button>
    </div>`;
  const recentRow = (p) => {
    const url = _postUrl(p);
    return `
    <div class="sm-q-row">
      <span class="sm-q-badge ${_esc(p.status)}">${_esc(_Q_LABEL[p.status] || p.status)}</span>
      <span class="sm-q-excerpt">${exc(p)}</span>
      <span class="sm-q-nets">${_qNetGlyphs(p.targets)}</span>
      ${url ? `<a class="sm-q-act" href="${_esc(url)}" target="_blank" rel="noopener" title="Voir le post" aria-label="Voir le post">${icon('external-link', 14)}</a>` : ''}
      <button type="button" class="sm-q-act danger" data-act="delete-post" data-id="${_esc(p.id)}" title="Supprimer de l'historique" aria-label="Supprimer de l'historique">${icon('trash-2', 14)}</button>
    </div>`;
  };

  box.innerHTML = head
    + (scheduled.length ? `<div class="sm-queue-sub">Programmés (${scheduled.length})</div><div class="sm-queue-grid">${scheduled.map(schedRow).join('')}</div>` : '')
    + (recent.length ? `<div class="sm-queue-sub">Récents</div><div class="sm-queue-grid">${recent.map(recentRow).join('')}</div>` : '');
}

async function _cancelPost(id) {
  if (!id) return;
  const token = _adminToken();
  if (!token) { _toast('Connexion requise', 'warn'); return; }
  if (!confirm('Annuler cette publication programmée ?')) return;
  try {
    const res  = await fetch(`${CF_API}/api/social/posts/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `Erreur ${res.status}`);
    _toast('Publication annulée', 'ok');
    await _loadQueue();
  } catch (e) {
    _toast(e?.message || 'Annulation échouée', 'warn');
  }
}

// Suppression DÉFINITIVE de l'historique (1 post ou tout). Jamais les programmés.
async function _deletePost(id) {
  if (!id) return;
  if (!_adminToken()) { _toast('Connexion requise', 'warn'); return; }
  if (!confirm('Supprimer définitivement ce post de l\'historique ?')) return;
  await _postDelete({ id });
}
async function _clearHistory() {
  if (!_adminToken()) { _toast('Connexion requise', 'warn'); return; }
  if (!confirm('Effacer TOUT l\'historique (publiés, échoués, annulés) ? Les programmés sont conservés. Action définitive.')) return;
  await _postDelete({ all: true });
}
async function _postDelete(body) {
  try {
    const res  = await fetch(`${CF_API}/api/social/posts/delete`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${_adminToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `Erreur ${res.status}`);
    _toast(body.all ? `Historique effacé (${data.deleted || 0})` : 'Post supprimé', 'ok');
    await _loadQueue();
  } catch (e) {
    _toast(e?.message || 'Suppression échouée', 'warn');
  }
}

// ══════════════════════════════════════════════════════════════
// Événements
// ══════════════════════════════════════════════════════════════
function _onClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'close')        { e.preventDefault(); closeSocialManager(); return; }
  if (act === 'reset')        { e.preventDefault(); if (confirm('Effacer toutes les saisies ? Cette action est définitive.')) _reset(); return; }
  if (act === 'publish')      { e.preventDefault(); _publish(); return; }
  if (act === 'toggle-schedule') { e.preventDefault(); _schedOpen = !_schedOpen; _renderSchedule(); return; }
  if (act === 'do-schedule')  { e.preventDefault(); _doSchedule(); return; }
  if (act === 'cancel-post')  { e.preventDefault(); _cancelPost(e.target.closest('[data-id]')?.dataset.id); return; }
  if (act === 'delete-post')  { e.preventDefault(); _deletePost(e.target.closest('[data-id]')?.dataset.id); return; }
  if (act === 'clear-history'){ e.preventDefault(); _clearHistory(); return; }
  if (act === 'sched-day')    { e.preventDefault(); _setSchedDay(Number(e.target.closest('[data-days]')?.dataset.days) || 0); return; }
  if (act === 'remove-image') { e.preventDefault(); _removeImage(); return; }
  if (act === 'open-connect')  { e.preventDefault(); _openConnect(); return; }
  if (act === 'close-connect') { e.preventDefault(); _closeConnect(); return; }
  if (act === 'pick-telegram') { e.preventDefault(); if (_connect) { _connect.view = 'wizard'; _connect.step = 0; _renderConnect(); } return; }
  if (act === 'connect-facebook') { e.preventDefault(); _connectOAuth('facebook', 'Facebook'); return; }
  if (act === 'connect-threads')  { e.preventDefault(); _connectOAuth('threads', 'Threads'); return; }
  if (act === 'wiz-next')      { e.preventDefault(); _wizNext(); return; }
  if (act === 'wiz-back')      { e.preventDefault(); _wizBack(); return; }
  if (act === 'wiz-connect')   { e.preventDefault(); _connectTelegram(); return; }

  // Molette heure/minute : clic sur un cran → on le centre.
  const wItem = e.target.closest('.sm-wheel-item');
  if (wItem) {
    const w = wItem.closest('.sm-wheel');
    if (w) w.scrollTo({ top: (Number(wItem.dataset.idx) || 0) * wItem.offsetHeight, behavior: 'smooth' });
    return;
  }

  // Toggle réseau (bouton a11y : aria-pressed)
  const net = e.target.closest('[data-net]');
  if (net) {
    const p = net.dataset.net;
    const i = _form.targets.indexOf(p);
    if (i >= 0) _form.targets.splice(i, 1); else _form.targets.push(p);
    const on = _form.targets.includes(p);
    net.classList.toggle('is-on', on);
    net.setAttribute('aria-pressed', String(on));
    _renderPreview();
    _renderValidation();
    _scheduleSave();
  }
}

function _onInput(e) {
  if (e.target.dataset.field === 'text') {
    _form.text = e.target.value;
    _renderPreview();
    _renderValidation();
    _scheduleSave();
  }
}

function _onChange(e) {
  if (e.target.dataset.field === 'image' && e.target.files?.[0]) _uploadImage(e.target.files[0]);
}

let _saveT = null;
function _scheduleSave() { clearTimeout(_saveT); _saveT = setTimeout(_saveDraft, 600); }

// ══════════════════════════════════════════════════════════════
// Toast
// ══════════════════════════════════════════════════════════════
let _toastT = null;
function _toast(msg, kind = 'ok') {
  if (!_root) return;
  let t = _root.querySelector('.sm-toast');
  if (!t) { t = document.createElement('div'); t.className = 'sm-toast'; _root.appendChild(t); }
  t.className = `sm-toast sm-toast-${kind} show`;
  t.textContent = msg;
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { t.classList.remove('show'); }, 3200);
}

// ══════════════════════════════════════════════════════════════
// Connexion d'un réseau — WIZARD pas-à-pas (divulgation progressive)
// Telegram = self-serve via « bouton magique » (lien-bot, ajoute le bot au
// canal en 1 clic). FB/IG/Threads = « bientôt » (OAuth, Sprint 3).
// Structuré en étapes → prêt à généraliser : 1 wizard, N réseaux, méthode de
// connexion déclarée par réseau (deeplink Telegram | redirect OAuth).
// ══════════════════════════════════════════════════════════════
const TG_BOT = 'protein_keystone_bot';   // bot Keystone partagé (secret KS_TELEGRAM_BOT_TOKEN)

function _openConnect() {
  if (!_root || _connect) return;
  _connect = { view: 'picker', step: 0, channel: '', busy: false, done: false };
  const ov = document.createElement('div');
  ov.className = 'sm-connect-overlay';
  ov.innerHTML = `<div class="sm-connect" role="dialog" aria-label="Connecter un réseau social" data-slot="connect-box"></div>`;
  _root.appendChild(ov);
  _renderConnect();
}
function _closeConnect() { _connect = null; const ov = _root && _root.querySelector('.sm-connect-overlay'); if (ov) ov.remove(); }

function _wizNext() { if (_connect) { _connect.step = Math.min(2, _connect.step + 1); _renderConnect(); } }
function _wizBack() {
  if (!_connect) return;
  if (_connect.step === 2) { const i = _root.querySelector('[data-field="tg-channel"]'); if (i) _connect.channel = i.value; }
  if (_connect.step === 0) _connect.view = 'picker'; else _connect.step -= 1;
  _renderConnect();
}

function _renderConnect() {
  const box = _root && _root.querySelector('[data-slot="connect-box"]');
  if (!box || !_connect) return;
  const head = (t) => `<div class="sm-connect-head"><span>${t}</span><button type="button" class="sm-connect-x" data-act="close-connect" aria-label="Fermer">${icon('x', 18)}</button></div>`;

  // ── Vue 1 : choix du réseau ──
  if (_connect.view === 'picker') {
    const soon = (p) => `
      <div class="sm-conn-row is-soon">
        <span class="sm-conn-glyph" style="--brand:${NET_BRAND[p] || 'var(--gold)'}">${icon(NET_ICON[p] || 'globe', 18)}</span>
        <div class="sm-conn-meta"><div class="sm-conn-name">${_esc(_labelOf(p))}</div><div class="sm-conn-sub">Connexion en 1 clic — bientôt</div></div>
        <span class="sm-conn-soon">Bientôt</span>
      </div>`;
    box.innerHTML = head('Connecter un réseau social') + `
      <div class="sm-connect-body">
        <button type="button" class="sm-conn-row is-active" data-act="pick-telegram">
          <span class="sm-conn-glyph" style="--brand:#2AABEE">${icon('telegram', 18)}</span>
          <div class="sm-conn-meta"><div class="sm-conn-name">Telegram</div><div class="sm-conn-sub">Publie sur ton canal — aucune inscription</div></div>
          <span class="sm-conn-cta">Connecter →</span>
        </button>
        <button type="button" class="sm-conn-row is-active" data-act="connect-facebook">
          <span class="sm-conn-glyph" style="--brand:#0866FF">${icon('facebook', 18)}</span>
          <div class="sm-conn-meta"><div class="sm-conn-name">Facebook + Instagram</div><div class="sm-conn-sub">Connecte ta Page et ton Insta lié</div></div>
          <span class="sm-conn-cta">Connecter →</span>
        </button>
        <button type="button" class="sm-conn-row is-active" data-act="connect-threads">
          <span class="sm-conn-glyph" style="--brand:var(--text)">${icon('threads', 18)}</span>
          <div class="sm-conn-meta"><div class="sm-conn-name">Threads</div><div class="sm-conn-sub">Publie sur ton profil Threads</div></div>
          <span class="sm-conn-cta">Connecter →</span>
        </button>
      </div>`;
    return;
  }

  // ── Vue 2 : wizard Telegram (1 carte à la fois) ──
  if (_connect.done) {
    box.innerHTML = head('Telegram connecté') + `
      <div class="sm-wiz">
        <div class="sm-wiz-icon">${icon('check-circle', 30)}</div>
        <div class="sm-wiz-title">C'est connecté !</div>
        <div class="sm-wiz-text"><strong>${_esc(_connect.channel)}</strong> est prêt. Tu peux publier dessus depuis le composer.</div>
        <button type="button" class="sm-btn-primary sm-wiz-primary" data-act="close-connect">Terminer</button>
      </div>`;
    return;
  }
  const dots = `<div class="sm-wiz-dots">${[0, 1, 2].map(i => `<span class="${i === _connect.step ? 'on' : ''}"></span>`).join('')}</div>`;
  let body = '';
  if (_connect.step === 0) {
    body = `
      <div class="sm-wiz-icon">${icon('megaphone', 30)}</div>
      <div class="sm-wiz-title">Connecter ton canal Telegram</div>
      <div class="sm-wiz-text">3 petites étapes, 2 minutes promis. On relie ton canal pour que tu puisses y publier en un clic.</div>
      <button type="button" class="sm-btn-primary sm-wiz-primary" data-act="wiz-next">C'est parti →</button>`;
  } else if (_connect.step === 1) {
    body = `
      <div class="sm-wiz-icon">${icon('robot', 30)}</div>
      <div class="sm-wiz-title">Ajoute notre assistant à ton canal</div>
      <div class="sm-wiz-text">Un seul clic : Telegram s'ouvre, tu choisis ton canal, tu confirmes. Ça autorise le robot à publier pour toi.</div>
      <a class="sm-magic-btn" href="https://t.me/${TG_BOT}?startchannel&admin=post_messages" target="_blank" rel="noopener">${icon('telegram', 16)}&nbsp;Ajouter à mon canal</a>
      <div class="sm-wiz-nav">
        <button type="button" class="sm-wiz-back" data-act="wiz-back">← Retour</button>
        <button type="button" class="sm-btn-primary" data-act="wiz-next">C'est fait →</button>
      </div>`;
  } else {
    body = `
      <div class="sm-wiz-icon">${icon('link', 30)}</div>
      <div class="sm-wiz-title">Quel est ton canal ?</div>
      <div class="sm-wiz-text">Colle son lien public — ex : <strong>@mon_canal</strong> ou t.me/mon_canal.</div>
      <input type="text" class="sm-wiz-input" data-field="tg-channel" placeholder="@mon_canal" autocomplete="off" spellcheck="false" value="${_esc(_connect.channel)}">
      <div class="sm-conn-result" data-slot="tg-result"></div>
      <div class="sm-wiz-nav">
        <button type="button" class="sm-wiz-back" data-act="wiz-back">← Retour</button>
        <button type="button" class="sm-btn-primary" data-act="wiz-connect" ${_connect.busy ? 'disabled' : ''}>${icon('zap', 16)}&nbsp;Connecter</button>
      </div>`;
  }
  box.innerHTML = head('Connecter Telegram') + `<div class="sm-wiz">${dots}${body}</div>`;
}

async function _connectTelegram() {
  if (!_connect || _connect.busy) return;
  const input = _root && _root.querySelector('[data-field="tg-channel"]');
  const res   = _root && _root.querySelector('[data-slot="tg-result"]');
  let ch = (input?.value || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^\/+/, '');
  if (!ch) { if (res) res.innerHTML = `<span class="sm-conn-err">Entre l'identifiant de ton canal (ex : @mon_canal).</span>`; return; }
  if (!ch.startsWith('@')) ch = '@' + ch;
  _connect.channel = ch; _connect.busy = true;
  if (res) res.innerHTML = `<span class="sm-conn-pending">${icon('zap', 14)}&nbsp;Connexion…</span>`;
  try {
    const r = await fetch(`${CF_API}/api/social/provision/telegram`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${_adminToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: ch }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.success === false) throw new Error(data.error || `Erreur ${r.status}`);
    _connect.busy = false; _connect.done = true; _connect.channel = data.displayName || ch;
    _renderConnect();
    _toast('Canal Telegram connecté', 'ok');
    await _loadAccounts();
  } catch (e) {
    _connect.busy = false;
    if (res) res.innerHTML = `<span class="sm-conn-err">${_esc(e?.message || 'Échec de la connexion')}</span>`;
  }
}

// Connexion OAuth (Facebook+Instagram ou Threads). On ouvre l'onglet
// d'autorisation TOUT DE SUITE (dans le geste de clic) pour éviter le blocage
// popup, puis on y charge l'URL OAuth signée (state = tenant) renvoyée par le
// Worker. Au retour, le callback range les comptes ; l'utilisateur recharge le pad.
async function _connectOAuth(network, label) {
  const token = _adminToken();
  if (!token) { _toast(`Connecte-toi d\'abord pour connecter ${label}.`, 'warn'); return; }
  const popup = window.open('', '_blank');                       // synchrone = autorisé
  try { if (popup) popup.document.write(`<p style="font-family:system-ui;padding:24px;color:#333">Ouverture de ${label}…</p>`); } catch (_) {}
  try {
    const r = await fetch(`${CF_API}/api/social/connect/${network}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.authUrl) throw new Error(data.error || `Erreur ${r.status}`);
    if (popup) popup.location.href = data.authUrl;
    else       window.location.href = data.authUrl;             // fallback si popup bloqué
  } catch (e) {
    if (popup) { try { popup.close(); } catch (_) {} }
    _toast(e?.message || `Connexion ${label} indisponible`, 'warn');
  }
}

// ══════════════════════════════════════════════════════════════
// Styles (namespace .sm-*) — réutilise les variables globales
// ══════════════════════════════════════════════════════════════
function _injectStyles() {
  if (_styles) return; _styles = true;
  const css = `
  /* Token d'avertissement LOCAL au pad : le --warn global est cassé en dark
     (auto-référence dans style.css). On thémise nous-mêmes l'ambre clair/foncé. */
  :root { --sm-warn: #fbbf24; }
  html.light-mode { --sm-warn: #d97706; }
  .sm-wrap { max-width: 1180px; margin: 0 auto; padding: 28px 28px 60px; }
  .sm-hero { margin-bottom: 22px; }
  .sm-title { font-size: 30px; font-weight: 900; letter-spacing: -.02em; margin: 0 0 6px; color: var(--text); }
  .sm-subtitle { color: var(--tx2); font-size: 14px; max-width: 640px; }
  .sm-banner { display:flex; align-items:center; gap:6px; padding:11px 14px; border-radius: var(--r); font-size:13px; margin-bottom:18px; border:1px solid var(--bd); }
  .sm-banner-warn { background: var(--warn-soft); color: var(--sm-warn); border-color: color-mix(in srgb, var(--sm-warn) 32%, transparent); }

  .sm-split { display:flex; gap:0; align-items:stretch; background: var(--navy2); border:1px solid var(--bd); border-radius: var(--r2); overflow:hidden; }
  .sm-left  { width:60%; padding:24px; border-right:1px solid var(--bd); }
  .sm-right { flex:1; padding:24px; background: var(--navy); display:flex; flex-direction:column; gap:14px; }

  .sm-field { margin-bottom:18px; }
  .sm-label { display:block; font-size:12px; font-weight:700; letter-spacing:.01em; color: var(--tx2); margin-bottom:8px; text-transform:uppercase; }
  .sm-opt   { font-weight:500; text-transform:none; color: var(--tx3); }
  .sm-textarea { width:100%; resize:vertical; min-height:140px; background: var(--navy3); color: var(--text); border:1px solid var(--bd); border-radius: var(--r); padding:12px 14px; font:inherit; font-size:14px; line-height:1.5; }
  .sm-textarea:focus { outline:none; border-color: var(--gold); box-shadow:0 0 0 3px var(--gold3); }
  .sm-counter { margin-top:6px; font-size:12px; color: var(--tx3); text-align:right; min-height:16px; }
  .sm-counter-num.over { color: var(--danger); font-weight:800; }
  .sm-counter-net { color: var(--tx3); }

  /* Grille 3/ligne, colonnes 1fr → largeurs ÉGALES occupant toute la largeur
     du champ Message au-dessus. */
  .sm-nets { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:10px; }
  .sm-nets-loading, .sm-nets-empty { grid-column: 1 / -1; color: var(--tx3); font-size:13px; padding:8px 0; }
  /* Padding UNIFORME (10px) + glyphe = élément le plus haut → écart bordure↔glyphe
     identique en haut, bas et gauche (règle demandée). */
  .sm-net { --brand: var(--gold); --brand-soft: var(--gold3); box-sizing:border-box; display:flex; align-items:center; gap:10px; min-width:0; padding:10px; border:1px solid var(--bd); border-radius: var(--r); cursor:pointer; background: var(--navy3); transition: border-color .15s, background-color .15s, box-shadow .15s; user-select:none; appearance:none; font:inherit; color:inherit; text-align:left; }
  .sm-net[data-net="threads"] { --brand: var(--text); --brand-soft: rgba(136,136,136,.16); }
  .sm-net:hover { border-color: var(--brand); }
  .sm-net.is-on { border-color: var(--brand); background: var(--brand-soft); }
  .sm-net.has-err { border-color: color-mix(in srgb, var(--danger) 55%, transparent); background: var(--danger-soft); }
  .sm-net:focus-visible { outline:none; border-color: var(--brand); box-shadow:0 0 0 3px var(--brand-soft); }
  .sm-net-glyph { flex:0 0 auto; width:32px; height:32px; display:grid; place-items:center; border-radius:9px; background: var(--brand); color:#fff; }
  .sm-net[data-net="threads"] .sm-net-glyph { color: var(--navy); }
  .sm-net-txt { min-width:0; display:flex; flex-direction:column; gap:1px; line-height:1.15; }
  .sm-net-name { font-size:13px; font-weight:700; color: var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sm-net-handle { font-size:11px; color: var(--tx3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  .sm-upload { display:inline-flex; align-items:center; gap:6px; padding:9px 14px; border:1px dashed var(--bd); border-radius: var(--r); cursor:pointer; color: var(--tx2); font-size:13px; transition: all .15s; }
  .sm-upload:hover { border-color: var(--gold2); color: var(--text); }
  .sm-media-chip { display:inline-flex; align-items:center; gap:8px; padding:8px 8px 8px 12px; border:1px solid var(--bd); border-radius: var(--r); background: var(--navy3); font-size:13px; color: var(--text); }
  .sm-media-name { max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sm-media-x { display:inline-grid; place-items:center; width:26px; height:26px; border:none; background:transparent; color: var(--tx3); cursor:pointer; border-radius:7px; transition: all .15s; }
  .sm-media-x:hover { color: var(--danger); background: var(--danger-soft); }

  .sm-issues { margin: -4px 0 14px; }
  .sm-issues-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
  .sm-issue { display:flex; align-items:flex-start; gap:7px; font-size:12.5px; line-height:1.4; padding:7px 11px; border-radius: var(--r); border:1px solid transparent; }
  .sm-issue .ws-icon { flex:0 0 auto; margin-top:1px; }
  .sm-issue.err  { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 28%, transparent); }
  .sm-issue.warn { color: var(--sm-warn); background: var(--warn-soft); border-color: color-mix(in srgb, var(--sm-warn) 30%, transparent); }
  .sm-issue strong { font-weight:800; }

  .sm-actions { margin-top:6px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  .sm-btn-primary { display:inline-flex; align-items:center; padding:12px 22px; border:none; border-radius: var(--r); background: var(--gold); color:#fff; font-weight:800; font-size:14px; cursor:pointer; transition: all .15s; }
  .sm-btn-primary:hover:not(:disabled) { background: var(--gold2); transform: translateY(-1px); }
  .sm-btn-primary:disabled { opacity:.45; cursor:not-allowed; }

  .sm-right-lbl { font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color: var(--tx3); }
  .sm-card { background: var(--navy2); border:1px solid var(--bd); border-radius: var(--r2); padding:16px; }
  .sm-card-head { display:flex; align-items:center; gap:11px; margin-bottom:11px; }
  .sm-card-avatar { width:40px; height:40px; border-radius:50%; background: var(--gold); color:#fff; display:grid; place-items:center; font-weight:900; }
  .sm-card-name { font-weight:800; font-size:14px; color: var(--text); }
  .sm-card-nets { display:flex; align-items:center; gap:7px; margin-top:3px; min-height:16px; }
  .sm-card-net-ic { color: var(--gold2); display:inline-flex; }
  .sm-card-net-ic[data-net="threads"] { color: var(--text); }
  .sm-card-text { font-size:14px; line-height:1.55; color: var(--text); white-space:normal; word-break:break-word; }
  .sm-card-img { margin-top:12px; border-radius: var(--r); overflow:hidden; border:1px solid var(--bd); }
  .sm-card-img img { width:100%; display:block; }
  .sm-muted { color: var(--tx3); font-style:italic; font-size:12px; }

  .sm-result-pending { display:flex; align-items:center; color: var(--gold2); font-size:13px; }
  .sm-result-head { font-weight:800; font-size:14px; margin-bottom:8px; }
  .sm-result-head.ok { color: var(--green); } .sm-result-head.warn { color: var(--sm-warn); } .sm-result-head.ko { color: var(--danger); }
  .sm-result-ko { color: var(--danger); font-size:13px; }
  .sm-result-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px; }
  .sm-result-list li { display:flex; align-items:center; gap:10px; font-size:13px; }
  .sm-res-net { font-weight:700; color: var(--text); min-width:78px; }
  .sm-result-list li.ok a { color: var(--green); text-decoration:none; }
  .sm-res-err { color: var(--danger); }

  .sm-toast { position:fixed; bottom:26px; left:50%; transform:translateX(-50%) translateY(20px); background: var(--navy3); color: var(--text); border:1px solid var(--bd); padding:11px 18px; border-radius: var(--r); font-size:13px; font-weight:600; opacity:0; pointer-events:none; transition: all .25s; z-index:9999; }
  .sm-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
  .sm-toast-ok { border-color: color-mix(in srgb, var(--green) 45%, transparent); } .sm-toast-warn { border-color: color-mix(in srgb, var(--sm-warn) 45%, transparent); }

  .sm-connect-trigger { margin-top:10px; display:inline-flex; align-items:center; padding:9px 14px; border:1px dashed var(--bd); border-radius: var(--r); background:transparent; color: var(--tx2); font:inherit; font-size:13px; font-weight:600; cursor:pointer; transition: all .15s; }
  .sm-connect-trigger:hover { border-color: var(--gold2); color: var(--text); }

  .sm-connect-overlay { position:fixed; inset:0; z-index:10000; display:grid; place-items:center; background: rgba(0,0,0,.55); backdrop-filter: blur(4px); padding:20px; }
  .sm-connect { width:100%; max-width:480px; background: var(--navy2); border:1px solid var(--bd); border-radius: var(--r2); overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,.5); }
  .sm-connect-head { display:flex; align-items:center; justify-content:space-between; padding:16px 18px; border-bottom:1px solid var(--bd); font-weight:800; font-size:15px; color: var(--text); }
  .sm-connect-x { display:grid; place-items:center; width:30px; height:30px; border:none; background:transparent; color: var(--tx3); cursor:pointer; border-radius:8px; }
  .sm-connect-x:hover { color: var(--text); background: var(--navy3); }
  .sm-connect-body { padding:10px; display:flex; flex-direction:column; gap:6px; }
  .sm-conn-row { display:flex; align-items:center; gap:12px; padding:12px; border-radius: var(--r); border:1px solid var(--bd); }
  .sm-conn-row.is-active { background: var(--navy3); }
  .sm-conn-row.is-soon { opacity:.5; }
  .sm-conn-glyph { flex:0 0 auto; width:34px; height:34px; display:grid; place-items:center; border-radius:9px; background: var(--brand, var(--gold)); color:#fff; }
  .sm-conn-meta { flex:1; min-width:0; }
  .sm-conn-name { font-weight:800; font-size:14px; color: var(--text); }
  .sm-conn-sub { font-size:12px; color: var(--tx3); }
  .sm-conn-btn { flex:0 0 auto; padding:8px 16px; border:none; border-radius: var(--r); background: var(--gold); color:#fff; font-weight:800; font-size:13px; cursor:pointer; transition: background .15s; }
  .sm-conn-btn:hover { background: var(--gold2); }
  .sm-conn-soon { flex:0 0 auto; font-size:11px; font-weight:700; color: var(--tx3); text-transform:uppercase; letter-spacing:.04em; }
  .sm-conn-form { padding:4px 12px 12px; }
  .sm-conn-steps { margin:0 0 12px; padding-left:20px; color: var(--tx2); font-size:13px; line-height:1.5; display:flex; flex-direction:column; gap:6px; }
  .sm-conn-steps strong { color: var(--text); }
  .sm-conn-input { display:flex; gap:8px; }
  .sm-conn-input input { flex:1; min-width:0; background: var(--navy3); color: var(--text); border:1px solid var(--bd); border-radius: var(--r); padding:10px 12px; font:inherit; font-size:14px; }
  .sm-conn-input input:focus { outline:none; border-color: var(--gold); box-shadow:0 0 0 3px var(--gold3); }
  .sm-conn-result { margin-top:10px; font-size:13px; min-height:18px; }
  .sm-conn-pending { color: var(--gold2); display:inline-flex; align-items:center; }
  .sm-conn-ok  { color: var(--green); font-weight:700; }
  .sm-conn-err { color: var(--danger); }
  /* Ligne picker cliquable (bouton) */
  .sm-conn-row.is-active { width:100%; box-sizing:border-box; appearance:none; font:inherit; color:inherit; text-align:left; cursor:pointer; transition: border-color .15s; }
  .sm-conn-row.is-active:hover { border-color: var(--gold2); }
  .sm-conn-cta { flex:0 0 auto; font-size:13px; font-weight:800; color: var(--gold2); }
  /* Wizard pas-à-pas */
  .sm-wiz { padding:24px 22px 22px; text-align:center; display:flex; flex-direction:column; align-items:center; }
  .sm-wiz-dots { display:flex; gap:6px; margin-bottom:18px; }
  .sm-wiz-dots span { width:7px; height:7px; border-radius:50%; background: var(--bd); transition: all .2s; }
  .sm-wiz-dots span.on { background: var(--gold); width:20px; border-radius:4px; }
  /* Hero du wizard : pictogramme outline monochrome (charte Keystone) dans un
     chip accent lavé — plus d'emoji 3D. Couleur = accent du DS (--gold = indigo). */
  .sm-wiz-icon { width:60px; height:60px; display:inline-flex; align-items:center; justify-content:center;
                 margin-bottom:14px; border-radius:16px; color:var(--gold);
                 background:rgba(99,102,241,.12); border:1px solid rgba(99,102,241,.22); }
  .sm-wiz-title { font-weight:900; font-size:18px; letter-spacing:-.01em; color: var(--text); margin-bottom:8px; }
  .sm-wiz-text { font-size:14px; line-height:1.55; color: var(--tx2); max-width:340px; margin-bottom:18px; }
  .sm-wiz-text strong { color: var(--text); }
  .sm-wiz-primary { width:100%; justify-content:center; }
  .sm-magic-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; width:100%; box-sizing:border-box; padding:14px 18px; border-radius: var(--r); background:#2AABEE; color:#fff; font-weight:800; font-size:15px; text-decoration:none; margin-bottom:6px; transition: filter .15s; }
  .sm-magic-btn:hover { filter: brightness(1.08); }
  .sm-wiz-input { width:100%; box-sizing:border-box; background: var(--navy3); color: var(--text); border:1px solid var(--bd); border-radius: var(--r); padding:12px 14px; font:inherit; font-size:15px; text-align:center; }
  .sm-wiz-input:focus { outline:none; border-color: var(--gold); box-shadow:0 0 0 3px var(--gold3); }
  .sm-wiz-nav { display:flex; gap:10px; width:100%; margin-top:16px; }
  .sm-wiz-nav .sm-btn-primary { flex:1; justify-content:center; }
  .sm-wiz-back { flex:0 0 auto; padding:12px 16px; border:1px solid var(--bd); border-radius: var(--r); background:transparent; color: var(--tx2); font:inherit; font-size:14px; font-weight:600; cursor:pointer; transition: all .15s; }
  .sm-wiz-back:hover { color: var(--text); border-color: var(--gold2); }

  /* ── Programmation & file de publication (Sprint Social-4.1) ── */
  .sm-btn-ghost { display:inline-flex; align-items:center; padding:12px 18px; border:1px solid var(--bd); border-radius: var(--r); background:transparent; color: var(--tx2); font-weight:700; font-size:14px; cursor:pointer; transition: all .15s; }
  .sm-btn-ghost:hover:not(:disabled) { color: var(--text); border-color: var(--gold2); }
  .sm-btn-ghost:disabled { opacity:.45; cursor:not-allowed; }
  .sm-sched { margin-top:12px; }
  .sm-sched-inner { border:1px solid var(--bd); border-radius: var(--r2); background: var(--navy3); padding:16px; display:flex; flex-direction:column; gap:10px; }
  .sm-sched-lbl { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.01em; color: var(--tx2); }
  .sm-sched-days { display:flex; gap:7px; flex-wrap:wrap; }
  .sm-day-chip { padding:6px 12px; border:1px solid var(--bd); border-radius:999px; background: var(--navy2); color: var(--tx2); font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; transition: all .15s; }
  .sm-day-chip:hover { color: var(--text); border-color: var(--gold2); }
  .sm-sched-row { display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  .sm-sched-date { background: var(--navy2); color: var(--text); border:1px solid var(--bd); border-radius: var(--r); padding:11px 13px; font:inherit; font-size:14px; color-scheme: dark; }
  html.light-mode .sm-sched-date { color-scheme: light; }
  .sm-sched-date:focus { outline:none; border-color: var(--gold); box-shadow:0 0 0 3px var(--gold3); }
  .sm-sched-hint { font-size:12px; color: var(--tx3); }
  .sm-sched-nav { display:flex; gap:10px; margin-top:4px; }
  .sm-sched-nav .sm-btn-primary { flex:1; justify-content:center; }
  /* Molettes heure/minute (scroll-snap, fondu haut/bas, bande de sélection) */
  .sm-wheel-wrap { position:relative; display:flex; align-items:stretch; gap:2px; padding:0 8px; border:1px solid var(--bd); border-radius: var(--r); background: var(--navy2); }
  .sm-wheel { position:relative; height:120px; width:56px; overflow-y:scroll; scroll-snap-type:y mandatory; scrollbar-width:none; -ms-overflow-style:none; -webkit-mask-image:linear-gradient(to bottom, transparent, #000 33%, #000 67%, transparent); mask-image:linear-gradient(to bottom, transparent, #000 33%, #000 67%, transparent); }
  .sm-wheel::-webkit-scrollbar { display:none; }
  .sm-wheel-pad { height:40px; }
  .sm-wheel-item { height:40px; display:flex; align-items:center; justify-content:center; scroll-snap-align:center; font-size:19px; font-weight:700; color: var(--tx2); font-variant-numeric:tabular-nums; cursor:pointer; transition: color .15s; }
  .sm-wheel-item:hover { color: var(--text); }
  .sm-wheel-sep { display:flex; align-items:center; font-size:19px; font-weight:800; color: var(--tx3); }
  .sm-wheel-band { position:absolute; left:6px; right:6px; top:50%; transform:translateY(-50%); height:40px; border-radius:9px; background: var(--gold3); border:1px solid color-mix(in srgb, var(--gold2) 35%, transparent); pointer-events:none; }

  .sm-queue { margin-top:24px; }
  .sm-queue-head { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:14px; font-weight:800; color: var(--text); margin-bottom:12px; }
  .sm-queue-head > span { display:inline-flex; align-items:center; gap:7px; }
  .sm-queue-clear { display:inline-flex; align-items:center; gap:5px; padding:6px 11px; border:1px solid var(--bd); border-radius: var(--r); background:transparent; color: var(--tx3); font:inherit; font-size:12px; font-weight:600; cursor:pointer; transition: all .15s; }
  .sm-queue-clear:hover { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent); background: var(--danger-soft); }
  .sm-queue-sub { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color: var(--tx3); margin:16px 0 8px; }
  .sm-queue-empty { color: var(--tx3); font-size:13px; padding:6px 0; }
  .sm-queue-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap:8px; }
  .sm-q-row { display:flex; align-items:center; gap:9px; padding:8px 10px; border:1px solid var(--bd); border-radius: var(--r); background: var(--navy2); min-width:0; }
  .sm-q-badge { flex:0 0 auto; display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:700; padding:4px 9px; border-radius:999px; border:1px solid transparent; white-space:nowrap; }
  .sm-q-badge.scheduled { color: var(--gold2); background: var(--gold3); border-color: color-mix(in srgb, var(--gold2) 30%, transparent); }
  .sm-q-badge.published { color: var(--green); background: color-mix(in srgb, var(--green) 14%, transparent); }
  .sm-q-badge.partial { color: var(--sm-warn); background: var(--warn-soft); }
  .sm-q-badge.failed { color: var(--danger); background: var(--danger-soft); }
  .sm-q-badge.canceled, .sm-q-badge.publishing, .sm-q-badge.draft { color: var(--tx3); background: var(--navy3); }
  .sm-q-excerpt { flex:1 1 auto; min-width:0; font-size:13px; color: var(--tx2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sm-q-nets { flex:0 0 auto; display:inline-flex; gap:5px; color: var(--tx3); }
  .sm-q-act { flex:0 0 auto; display:inline-grid; place-items:center; width:28px; height:28px; border:1px solid transparent; border-radius:8px; background:transparent; color: var(--tx3); cursor:pointer; transition: all .15s; text-decoration:none; }
  .sm-q-act:hover { color: var(--text); background: var(--navy3); }
  .sm-q-act.danger:hover { color: var(--danger); background: var(--danger-soft); }

  @media (max-width: 820px) { .sm-split { flex-direction:column; } .sm-left { width:100%; border-right:none; border-bottom:1px solid var(--bd); } }
  `;
  const tag = document.createElement('style');
  tag.id = 'sm-styles';
  tag.textContent = css;
  document.head.appendChild(tag);
}
