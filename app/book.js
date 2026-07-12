// ═══════════════════════════════════════════════════════════════
// booK — Pad O-BOK-001 · V1 (export autonome seul, ZÉRO worker)
//
// Flipbooks souverains : créer (PDF/images → pages recompressées),
// habiller (titre, teinte, double page), ranger en bibliothèque
// (IndexedDB), et SURTOUT exporter un fichier HTML autoporté qui ne
// dépend de rien — pas même de Keystone (BOOK_BRIEF.md, invariant
// n°1). L'aperçu du pad EST l'export : iframe.srcdoc reçoit le
// fichier généré à l'identique — ce qu'on voit = ce qu'on livre.
//
// Le format pivot « édition » + le moteur d'export vivent dans
// app/lib/book-export.js (module pur, testé hors navigateur).
// Le ré-import d'un fichier booK (JSON embarqué + <img>) referme la
// boucle de souveraineté : le fichier est sa propre source.
//
// ISOLATION : préfixe bk- (CSS/DOM) / bk_ (IndexedDB). Aucune table,
// aucune route partagée. ZÉRO IA, zéro crédit, zéro appel réseau.
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';
import { buildStandaloneHTML, newEdition, BK_FORMAT } from './lib/book-export.js';

const WORKSPACE_META = { id: 'O-BOK-001', name: 'booK' };

// Recompression à l'import (BOOK_BRIEF §2.5) : c'est elle qui rend la
// promesse « un seul fichier » tenable. Largeur cap 1600 px, WebP q.82
// (repli JPEG q.85 si le navigateur ne sait pas encoder WebP).
// Sur tactile (mémoire limitée, iOS tue l'onglet sur un gros PDF) : cap
// abaissé à 1200 px — largement suffisant pour un écran de téléphone.
const IS_COARSE    = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch (_) { return false; } })();
const MAX_PAGE_W   = IS_COARSE ? 1200 : 1600;
const SOFT_CAP_MO  = 20;          // plafond doux : avertissement au-delà
const TINT_PRESETS = ['#C9A227', '#2A9D8F', '#E76F51', '#4A6FA5', '#8A5CF6', '#20242B'];

let _root = null, _ed = null, _dirty = false;
let _previewTimer = null, _busy = false;

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Bibliothèque (IndexedDB — les éditions pèsent, localStorage interdit) ──
let _dbP = null;
function _db() {
  if (_dbP) return _dbP;
  _dbP = new Promise((resolve, reject) => {
    const rq = indexedDB.open('bk_library', 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('editions')) db.createObjectStore('editions', { keyPath: 'id' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror   = () => reject(rq.error);
  });
  return _dbP;
}
function _tx(mode, fn) {
  return _db().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('editions', mode);
    const out = fn(tx.objectStore('editions'));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror    = () => reject(tx.error);
  }));
}
const _libAll = () => _tx('readonly',  st => st.getAll());
const _libPut = ed => _tx('readwrite', st => st.put(ed));
const _libDel = id => _tx('readwrite', st => st.delete(id));

// ── Ouverture / fermeture du workspace ──────────────────────────
export function openBook() {
  if (_root) return;
  _ed = null; _dirty = false;
  _root = document.createElement('div');
  _root.className = 'ws-app bk-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="back" title="Retour" aria-label="Retour">${icon('chevron-left', 34)}</button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('book', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      <button class="ws-iconbtn bk-new-btn" data-act="new" aria-label="Nouveau flipbook" title="Nouveau flipbook">${icon('plus', 20)}</button>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        <button class="ws-iconbtn" data-act="reimport" aria-label="Ouvrir un fichier booK" title="Ouvrir un fichier booK (.html)">${icon('upload-cloud', 20)}</button>
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main bk-main" data-slot="main"></main>
    </div>
    <input type="file" class="bk-file-pages" accept="image/*,application/pdf" multiple hidden>
    <input type="file" class="bk-file-cover" accept="image/*" hidden>
    <input type="file" class="bk-file-book" accept="text/html,.html" hidden>
  `;
  document.body.appendChild(_root);
  document.body.style.overflow = 'hidden';
  try { bindRatingButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindHelpButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindBurger(_root); } catch (_) {}

  _root.querySelector('[data-act="back"]').addEventListener('click', _onBack);
  _root.querySelector('[data-act="new"]').addEventListener('click', () => _openEditor(newEdition()));
  _root.querySelector('[data-act="reimport"]').addEventListener('click', () => _root.querySelector('.bk-file-book').click());
  _root.querySelector('.bk-file-book').addEventListener('change', _onReimportFile);
  _root.querySelector('.bk-file-pages').addEventListener('change', e => { _addFiles([...e.target.files]); e.target.value = ''; });
  _root.querySelector('.bk-file-cover').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !_ed) return;
    try { _ed.cover = { src: await _compressImageFile(f) }; } catch (_) { _toast('Image de couverture illisible', true); return; }
    _syncCoverUI();
    _touch();
  });
  document.addEventListener('keydown', _onKey);
  _renderShelf();
}

export function closeBook() {
  if (!_root) return;
  clearTimeout(_previewTimer);
  document.removeEventListener('keydown', _onKey);
  _root.remove();
  _root = null; _ed = null; _dirty = false; _busy = false;
  document.body.style.overflow = '';
}

function _onKey(e) {
  if (e.key !== 'Escape') return;
  if (_root.querySelector('.bk-confirm')) { _root.querySelector('.bk-confirm').remove(); return; }
  _onBack();
}
function _onBack() {
  if (_ed) {
    if (_dirty) { _confirm('Quitter sans enregistrer ?', 'Les modifications de ce flipbook seront perdues.', 'Quitter', () => { _ed = null; _dirty = false; _renderShelf(); }); return; }
    _ed = null; _renderShelf();
  } else {
    closeBook();
  }
}

// ── Étagère (bibliothèque) ──────────────────────────────────────
async function _renderShelf() {
  const main = _root.querySelector('[data-slot="main"]');
  main.classList.remove('bk-main-read');
  _root.classList.remove('bk-reading');
  main.innerHTML = `<div class="bk-shelf"><div class="bk-shelf-grid" data-slot="grid"></div></div>`;
  let list = [];
  try { list = await _libAll(); } catch (_) {}
  if (!_root || _ed) return;                     // fermé / parti en édition entre-temps
  list.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  const grid = main.querySelector('[data-slot="grid"]');
  if (!grid) return;

  const cards = list.map(ed => {
    const coverSrc = ed.cover?.src || (ed.pages && ed.pages[0] && ed.pages[0].src);
    const cover = coverSrc ? `<img src="${coverSrc}" alt="" loading="lazy">` : `<span class="bk-cover-empty">${icon('book', 34)}</span>`;
    const date = ed.updated ? new Date(ed.updated).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return `
      <article class="bk-card" data-id="${_esc(ed.id)}">
        <button class="bk-card-cover" data-act="read" title="Feuilleter">${cover}</button>
        <div class="bk-card-body">
          <div class="bk-card-title">${_esc(ed.title || 'Sans titre')}</div>
          <div class="bk-card-meta">${(ed.pages || []).length} page${(ed.pages || []).length > 1 ? 's' : ''}${ed.sizeMo ? ' · ' + ed.sizeMo + ' Mo' : ''}${date ? ' · ' + date : ''}</div>
        </div>
        <div class="bk-card-actions">
          <button data-act="read" title="Feuilleter" aria-label="Feuilleter">${icon('eye', 17)}</button>
          <button data-act="edit" title="Modifier" aria-label="Modifier">${icon('edit-3', 17)}</button>
          <button data-act="export" title="Télécharger le fichier autonome" aria-label="Télécharger">${icon('download', 17)}</button>
          <button data-act="dup" title="Dupliquer" aria-label="Dupliquer">${icon('copy', 17)}</button>
          <button data-act="del" class="bk-danger" title="Supprimer" aria-label="Supprimer">${icon('trash-2', 17)}</button>
        </div>
      </article>`;
  }).join('');

  grid.innerHTML = `
    <button class="bk-card bk-card-new" data-act="new">
      <span class="bk-card-new-ico">${icon('plus', 30)}</span>
      <span>Nouveau flipbook</span>
    </button>
    ${cards}`;

  if (!list.length) {
    grid.insertAdjacentHTML('beforebegin', `
      <div class="bk-hero">
        <div class="bk-hero-ico">${icon('book', 44)}</div>
        <h2>Vos publications vous appartiennent, fichier compris</h2>
        <p>Créez un flipbook depuis un PDF ou des images, feuilletez-le, puis téléchargez-le en <strong>un seul fichier</strong> qui s'ouvre partout, pour toujours — sans serveur, sans abonnement, sans Keystone.</p>
      </div>`);
  }

  grid.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'new') { _openEditor(newEdition()); return; }
    const card = btn.closest('.bk-card');
    const ed = list.find(x => x.id === card?.dataset.id);
    if (!ed) return;
    if (btn.dataset.act === 'read')   _openReader(ed);
    if (btn.dataset.act === 'edit')   _openEditor(ed);
    if (btn.dataset.act === 'export') _download(ed);
    if (btn.dataset.act === 'dup') {
      const copy = { ...ed, id: newEdition().id, title: (ed.title || 'Sans titre') + ' (copie)', updated: new Date().toISOString() };
      await _libPut(copy); _renderShelf(); _toast('Flipbook dupliqué');
    }
    if (btn.dataset.act === 'del') {
      _confirm(`Supprimer « ${ed.title || 'Sans titre'} » ?`, 'Le flipbook sera retiré de votre bibliothèque. Les fichiers déjà téléchargés, eux, restent valables pour toujours.', 'Supprimer', async () => {
        await _libDel(ed.id); _renderShelf(); _toast('Flipbook supprimé');
      });
    }
  });
}

// ── Lecture plein pad (l'aperçu EST l'export) ───────────────────
function _openReader(ed) {
  const main = _root.querySelector('[data-slot="main"]');
  main.classList.add('bk-main-read');            // lecture = pleins bords (annule le padding ws-main)
  _root.classList.add('bk-reading');             // paysage téléphone : la topbar Keystone s'efface
  main.innerHTML = `
    <div class="bk-read">
      <div class="bk-read-bar">
        <button class="bk-btn bk-btn-ghost" data-act="close" title="Bibliothèque" aria-label="Bibliothèque">${icon('arrow-left', 16)}<span class="bk-btn-txt">Bibliothèque</span></button>
        <span class="bk-read-title">${_esc(ed.title || 'Sans titre')}</span>
        <button class="bk-btn" data-act="export" title="Fichier autonome" aria-label="Télécharger le fichier autonome">${icon('download', 16)}<span class="bk-btn-txt">Fichier autonome</span></button>
      </div>
      <iframe class="bk-read-frame" title="Aperçu du flipbook" sandbox="allow-scripts"></iframe>
    </div>`;
  main.querySelector('.bk-read-frame').srcdoc = buildStandaloneHTML(ed);
  main.querySelector('[data-act="close"]').addEventListener('click', () => _renderShelf());
  main.querySelector('[data-act="export"]').addEventListener('click', () => _download(ed));
}

// ── Éditeur ─────────────────────────────────────────────────────
function _openEditor(ed) {
  _ed = JSON.parse(JSON.stringify(ed));    // copie de travail : l'étagère garde l'original tant qu'on n'enregistre pas
  _dirty = false;
  const main = _root.querySelector('[data-slot="main"]');
  main.classList.remove('bk-main-read');
  _root.classList.remove('bk-reading');
  main.innerHTML = `
    <div class="bk-editor">
      <div class="bk-panel">
        <section class="bk-sec">
          <h3><span class="bk-step">1</span> Pages</h3>
          <div class="bk-drop" data-slot="drop">
            ${icon('upload-cloud', 26)}
            <p><strong>Déposez un PDF ou des images</strong><br>ou cliquez pour choisir vos fichiers</p>
            <span class="bk-drop-note">Chaque page est recompressée pour tenir dans un fichier léger.</span>
          </div>
          <div class="bk-progress-line" data-slot="progress" hidden></div>
          <div class="bk-pages" data-slot="pages"></div>
        </section>
        <section class="bk-sec">
          <h3><span class="bk-step">2</span> Habillage</h3>
          <label class="bk-field"><span>Titre</span><input type="text" data-k="title" maxlength="120" placeholder="Catalogue printemps 2026"></label>
          <label class="bk-field"><span>Sous-titre</span><input type="text" data-k="subtitle" maxlength="160" placeholder="Optionnel"></label>
          <label class="bk-field"><span>Auteur / marque</span><input type="text" data-k="author" maxlength="120" placeholder="Optionnel"></label>
          <div class="bk-field"><span>Teinte</span>
            <div class="bk-tints" data-slot="tints">
              ${TINT_PRESETS.map(c => `<button class="bk-tint" data-tint="${c}" style="--c:${c}" aria-label="Teinte ${c}"></button>`).join('')}
              <input type="color" class="bk-tint-custom" data-k="tint" title="Teinte personnalisée" aria-label="Teinte personnalisée">
            </div>
          </div>
          <div class="bk-field bk-field-row"><span>Fond de lecture</span>
            <div class="bk-seg" data-slot="stage">
              <button data-stage="dark">Sombre</button>
              <button data-stage="light">Clair</button>
            </div>
          </div>
          <label class="bk-field bk-field-row bk-check"><span>Double page sur grand écran</span><input type="checkbox" data-k="doublePage"></label>
          <div class="bk-field"><span>Couverture de bibliothèque (optionnel)</span>
            <div class="bk-cover-row">
              <div class="bk-cover-thumb" data-slot="cover-thumb"></div>
              <div class="bk-cover-btns">
                <button class="bk-btn" data-act="cover-pick">${icon('image', 15)} Choisir une image</button>
                <button class="bk-btn bk-btn-ghost" data-act="cover-clear" hidden>${icon('x', 15)} Retirer</button>
              </div>
            </div>
            <p class="bk-note">Illustre la carte de votre bibliothèque. Le document lui-même n'est pas modifié : la lecture s'ouvre toujours sur la première page.</p>
          </div>
        </section>
        <section class="bk-sec">
          <h3><span class="bk-step">3</span> Publier</h3>
          <div class="bk-size" data-slot="size"></div>
          <div class="bk-actions">
            <button class="bk-btn bk-btn-primary" data-act="save">${icon('save', 16)} Enregistrer dans la bibliothèque</button>
            <button class="bk-btn" data-act="export">${icon('download', 16)} Télécharger le fichier autonome</button>
          </div>
          <p class="bk-note">Le fichier téléchargé s'ouvre d'un double-clic, partout, pour toujours — et peut être ré-importé ici pour le modifier.</p>
        </section>
      </div>
      <div class="bk-preview">
        <div class="bk-preview-hd">
          <span>Aperçu — exactement le fichier livré</span>
          <button class="bk-btn bk-btn-ghost" data-act="refresh" title="Rafraîchir l'aperçu">${icon('refresh-cw', 15)}</button>
        </div>
        <iframe class="bk-preview-frame" title="Aperçu du flipbook" sandbox="allow-scripts"></iframe>
      </div>
    </div>`;

  // Champs texte
  main.querySelectorAll('input[type="text"]').forEach(inp => {
    inp.value = _ed[inp.dataset.k] || '';
    inp.addEventListener('input', () => { _ed[inp.dataset.k] = inp.value; _touch(); });
  });
  // Teintes
  const tintBox = main.querySelector('[data-slot="tints"]');
  const custom = tintBox.querySelector('.bk-tint-custom');
  custom.value = _ed.theme?.tint || '#C9A227';
  const _syncTints = () => tintBox.querySelectorAll('.bk-tint').forEach(b => b.classList.toggle('on', b.dataset.tint.toLowerCase() === (_ed.theme.tint || '').toLowerCase()));
  tintBox.addEventListener('click', e => {
    const b = e.target.closest('.bk-tint'); if (!b) return;
    _ed.theme.tint = b.dataset.tint; custom.value = b.dataset.tint; _syncTints(); _touch();
  });
  custom.addEventListener('input', () => { _ed.theme.tint = custom.value; _syncTints(); _touch(); });
  _syncTints();
  // Fond de lecture
  const seg = main.querySelector('[data-slot="stage"]');
  const _syncStage = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', (_ed.theme.stage || 'dark') === b.dataset.stage));
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; _ed.theme.stage = b.dataset.stage; _syncStage(); _touch(); });
  _syncStage();
  // Double page
  const dbl = main.querySelector('input[data-k="doublePage"]');
  dbl.checked = _ed.options?.doublePage !== false;
  dbl.addEventListener('change', () => { _ed.options.doublePage = dbl.checked; _touch(); });
  // Couverture dédiée
  main.querySelector('[data-act="cover-pick"]').addEventListener('click', () => _root.querySelector('.bk-file-cover').click());
  main.querySelector('[data-act="cover-clear"]').addEventListener('click', () => { _ed.cover = null; _syncCoverUI(); _touch(); });
  _syncCoverUI();
  // Dropzone
  const drop = main.querySelector('[data-slot="drop"]');
  drop.addEventListener('click', () => _root.querySelector('.bk-file-pages').click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); _addFiles([...e.dataTransfer.files]); });
  // Actions
  main.querySelector('[data-act="save"]').addEventListener('click', _save);
  main.querySelector('[data-act="export"]').addEventListener('click', () => _download(_ed));
  main.querySelector('[data-act="refresh"]').addEventListener('click', () => _refreshPreview(true));
  // Rail de pages
  main.querySelector('[data-slot="pages"]').addEventListener('click', e => {
    const b = e.target.closest('[data-pact]'); if (!b) return;
    const i = parseInt(b.closest('.bk-page-th').dataset.i, 10);
    if (b.dataset.pact === 'left'  && i > 0) { const t = _ed.pages[i - 1]; _ed.pages[i - 1] = _ed.pages[i]; _ed.pages[i] = t; }
    if (b.dataset.pact === 'right' && i < _ed.pages.length - 1) { const t = _ed.pages[i + 1]; _ed.pages[i + 1] = _ed.pages[i]; _ed.pages[i] = t; }
    if (b.dataset.pact === 'del') _ed.pages.splice(i, 1);
    _renderPages(); _touch();
  });

  _renderPages();
  _refreshPreview(true);
}

function _syncCoverUI() {
  const th = _root?.querySelector('[data-slot="cover-thumb"]');
  const clear = _root?.querySelector('[data-act="cover-clear"]');
  if (!th || !_ed) return;
  th.innerHTML = _ed.cover?.src ? `<img src="${_ed.cover.src}" alt="Couverture">` : icon('image', 18);
  th.classList.toggle('on', !!_ed.cover?.src);
  if (clear) clear.hidden = !_ed.cover?.src;
}

function _renderPages() {
  const box = _root.querySelector('[data-slot="pages"]');
  if (!box) return;
  box.innerHTML = _ed.pages.map((p, i) => `
    <div class="bk-page-th" data-i="${i}">
      <img src="${p.src}" alt="">
      <span class="bk-page-num">${i === 0 ? 'Couv.' : i + 1}</span>
      <div class="bk-page-tools">
        <button data-pact="left"  title="Vers la gauche"  aria-label="Vers la gauche"  ${i === 0 ? 'disabled' : ''}>${icon('arrow-left', 13)}</button>
        <button data-pact="del"   title="Retirer la page" aria-label="Retirer la page">${icon('x', 13)}</button>
        <button data-pact="right" title="Vers la droite"  aria-label="Vers la droite" ${i === _ed.pages.length - 1 ? 'disabled' : ''}>${icon('arrow-right', 13)}</button>
      </div>
    </div>`).join('');
  _updateSize();
}

function _touch() { _dirty = true; _updateSize(); _refreshPreview(); }

function _updateSize() {
  const box = _root?.querySelector('[data-slot="size"]');
  if (!box || !_ed) return;
  const mo = _estimateMo(_ed);
  const n = _ed.pages.length;
  box.innerHTML = n
    ? `${n} page${n > 1 ? 's' : ''} · fichier autonome ≈ <strong>${mo} Mo</strong>${mo > SOFT_CAP_MO ? ` <span class="bk-warn">${icon('alert-triangle', 14)} lourd — pensez à retirer des pages ou partir d'un PDF plus léger</span>` : ''}`
    : 'Ajoutez des pages pour composer votre flipbook.';
}
function _estimateMo(ed) {
  let bytes = 60000;                                         // coquille lecteur ≈ 60 Ko
  for (const p of ed.pages) bytes += p.src.length;
  if (ed.cover?.src) bytes += ed.cover.src.length;
  return Math.round(bytes / 1048576 * 10) / 10;
}

function _refreshPreview(now = false) {
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(() => {
    const frame = _root?.querySelector('.bk-preview-frame');
    if (frame && _ed) frame.srcdoc = buildStandaloneHTML(_ed);
  }, now ? 0 : 450);
}

// ── Import de pages (PDF + images) ──────────────────────────────
async function _addFiles(files) {
  if (_busy || !files.length) return;
  _busy = true;
  const prog = _root.querySelector('[data-slot="progress"]');
  const _say = t => { if (prog) { prog.hidden = false; prog.textContent = t; } };
  try {
    for (const f of files) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) await _importPDF(f, _say);
      else if (f.type.startsWith('image/')) {
        _say(`Image « ${f.name} »…`);
        _ed.pages.push({ src: await _compressImageFile(f), alt: '' });
      }
      _renderPages();
    }
    _touch();
  } catch (err) {
    _toast('Import impossible : ' + (err?.message || err), true);
  } finally {
    if (prog) prog.hidden = true;
    _busy = false;
  }
}

async function _importPDF(file, say) {
  say('Ouverture du PDF…');
  // pdf.js sert UNIQUEMENT à l'import, dans le pad — jamais dans le fichier exporté.
  const pdfjsLib = await import('/app/vendor/pdfjs/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/app/vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    say(`Page ${i} / ${doc.numPages}…`);
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(IS_COARSE ? 2 : 2.5, MAX_PAGE_W / vp1.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    _ed.pages.push({ src: _canvasToURI(canvas), alt: '' });
    page.cleanup();
    canvas.width = canvas.height = 0;                // libère le bitmap tout de suite (crash mémoire iOS sur gros PDF)
    if (i % 4 === 0) _renderPages();                 // feedback visuel en cours de route
    await new Promise(r => setTimeout(r, 0));        // souffle entre les pages : laisse le GC et le paint passer
  }
  try { doc.destroy(); } catch (_) {}
}

function _compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_PAGE_W / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);   // JPEG n'a pas d'alpha
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const uri = _canvasToURI(canvas);
      canvas.width = canvas.height = 0;              // libère le bitmap (mémoire mobile)
      resolve(uri);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
    img.src = url;
  });
}

function _canvasToURI(canvas) {
  let uri = canvas.toDataURL('image/webp', 0.82);
  if (!uri.startsWith('data:image/webp')) uri = canvas.toDataURL('image/jpeg', 0.85);   // Safari : pas d'encodeur WebP
  return uri;
}

// ── Enregistrer / exporter / ré-importer ────────────────────────
async function _save() {
  if (!_ed.pages.length) { _toast('Ajoutez au moins une page avant d\'enregistrer', true); return; }
  _ed.updated = new Date().toISOString();
  _ed.sizeMo = _estimateMo(_ed);
  try {
    await _libPut(JSON.parse(JSON.stringify(_ed)));
    _dirty = false;
    _toast('Enregistré dans votre bibliothèque');
  } catch (err) {
    _toast('Enregistrement impossible (espace disque ?)', true);
  }
}

function _download(ed) {
  if (!ed.pages?.length) { _toast('Ce flipbook n\'a pas encore de pages', true); return; }
  const html = buildStandaloneHTML(ed);
  const slug = (ed.title || 'flipbook').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'flipbook';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = slug + '.html';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  _toast('Fichier autonome téléchargé — il s\'ouvre partout, pour toujours');
}

async function _onReimportFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const dom = new DOMParser().parseFromString(text, 'text/html');
    const metaEl = dom.getElementById('bk-edition');
    if (!metaEl) throw new Error('ce fichier n\'est pas un flipbook booK');
    const meta = JSON.parse(metaEl.textContent);
    if (meta.format !== BK_FORMAT) throw new Error('format inconnu');
    const imgs = [...dom.querySelectorAll('#bk-pages img')];
    if (!imgs.length) throw new Error('aucune page dans ce fichier');
    // Couverture de bibliothèque : dans le JSON (meta.cover.src). Compat
    // ancien format (une seule livraison) : meta.cover SANS src ⇒ la
    // couverture avait été préposée en 1ʳᵉ <img> — on la re-sépare.
    const srcs = imgs.map(im => im.getAttribute('src'));
    const coverSrc = meta.cover?.src || (meta.cover ? srcs.shift() : null);
    const ed = {
      ...newEdition(),
      ...meta,
      id: meta.id || newEdition().id,
      updated: new Date().toISOString(),
      cover: coverSrc ? { src: coverSrc } : null,
      pages: srcs.map((s, i) => ({ src: s, alt: meta.pages?.[i]?.alt || '' })),
    };
    ed.sizeMo = _estimateMo(ed);
    await _libPut(ed);
    _ed = null; _dirty = false;
    _renderShelf();
    _toast(`« ${ed.title || 'Sans titre'} » ré-importé dans la bibliothèque`);
  } catch (err) {
    _toast('Ré-import impossible : ' + (err?.message || err), true);
  }
}

// ── Petits utilitaires UI ───────────────────────────────────────
function _toast(msg, isErr = false) {
  _root?.querySelector('.bk-toast')?.remove();
  const t = document.createElement('div');
  t.className = 'bk-toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  (_root || document.body).appendChild(t);
  requestAnimationFrame(() => t.classList.add('on'));
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, 3400);
}

function _confirm(title, body, okLabel, onOk) {
  _root.querySelector('.bk-confirm')?.remove();
  const ov = document.createElement('div');
  ov.className = 'bk-confirm';
  ov.innerHTML = `
    <div class="bk-confirm-box" role="alertdialog" aria-label="${_esc(title)}">
      <h4>${_esc(title)}</h4>
      <p>${_esc(body)}</p>
      <div class="bk-confirm-btns">
        <button class="bk-btn bk-btn-ghost" data-a="no">Annuler</button>
        <button class="bk-btn bk-btn-danger" data-a="ok">${_esc(okLabel)}</button>
      </div>
    </div>`;
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('[data-a="no"]')) ov.remove();
    else if (e.target.closest('[data-a="ok"]')) { ov.remove(); onOk(); }
  });
  _root.appendChild(ov);
}
