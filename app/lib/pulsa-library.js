/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — PULSA · Bibliothèque locale de formulaires
   Sprint Pulsa-2A.6.

   Gère le stockage local des formulaires créés avec Pulsa.
   Pattern simple : un array stocké dans localStorage, chaque
   formulaire est un objet complet (meta + sections + delivery
   + output) + champs de tracking (id, created_at, updated_at).

   Quand Phase 3 arrivera (publication réelle), la library sera
   synchronisée avec le Worker (D1 pulsa_forms) — pour l'instant
   tout est local, ce qui suffit pour structurer plusieurs
   formulaires en parallèle (Biennale, Prométhée, Diagnostics, …).
   ═══════════════════════════════════════════════════════════════ */

const LIBRARY_KEY = 'ks_pulsa_library';

/**
 * Identifiant unique court (sans dépendance UUID).
 */
let _idCounter = 0;
export function newFormId() {
  _idCounter += 1;
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `pul_${t}${r}${_idCounter}`;
}

/**
 * Lit la library complète depuis localStorage.
 * Retourne toujours un objet valide { forms: [] }.
 */
export function loadLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return { forms: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.forms)) return { forms: [] };
    return parsed;
  } catch {
    return { forms: [] };
  }
}

/**
 * Écrit la library en localStorage.
 */
function _saveLibrary(library) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch (e) {
    console.warn('[pulsa-library] save failed', e);
  }
}

/**
 * Liste tous les formulaires, triés par updated_at descendant.
 */
export function listForms() {
  const lib = loadLibrary();
  return [...lib.forms].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

/**
 * Récupère un formulaire par son id.
 */
export function getForm(id) {
  const lib = loadLibrary();
  return lib.forms.find(f => f.id === id) || null;
}

/**
 * Upsert : crée ou met à jour un formulaire dans la library.
 * Si form.id existe, met à jour. Sinon, ajoute avec un nouvel id.
 * Retourne le formulaire stocké (avec id et updated_at à jour).
 */
export function saveForm(form) {
  const lib = loadLibrary();
  const now = Date.now();
  if (form.id) {
    const idx = lib.forms.findIndex(f => f.id === form.id);
    if (idx !== -1) {
      lib.forms[idx] = { ...form, updated_at: now };
      _saveLibrary(lib);
      return lib.forms[idx];
    }
  }
  // Nouveau formulaire
  const stored = {
    ...form,
    id: form.id || newFormId(),
    created_at: form.created_at || now,
    updated_at: now,
  };
  lib.forms.push(stored);
  _saveLibrary(lib);
  return stored;
}

/**
 * Supprime un formulaire de la library.
 */
export function deleteForm(id) {
  const lib = loadLibrary();
  lib.forms = lib.forms.filter(f => f.id !== id);
  _saveLibrary(lib);
}

/**
 * Duplique un formulaire (nouvel id, titre suffixé "(copie)").
 * Retourne le nouveau formulaire.
 */
export function duplicateForm(id) {
  const src = getForm(id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = newFormId();
  copy.created_at = Date.now();
  copy.updated_at = Date.now();
  copy.meta = copy.meta || {};
  copy.meta.title = (copy.meta.title || 'Formulaire') + ' (copie)';
  copy.meta.slug = '';
  copy.output = { status: 'draft', published_url: null, last_response_at: null };
  return saveForm(copy);
}

/**
 * Migration : si on trouve un ancien draft `ks_pulsa_draft` au
 * format { form, ui }, on l'importe dans la library et on retire
 * la clé legacy. Retourne l'id du formulaire migré ou null.
 */
export function migrateLegacyDraft() {
  try {
    const raw = localStorage.getItem('ks_pulsa_draft');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.form?.meta) return null;
    // Préserver le formulaire en cours
    const migrated = saveForm({
      ...parsed.form,
      meta: {
        ...parsed.form.meta,
        title: parsed.form.meta.title || 'Formulaire récupéré',
      },
    });
    localStorage.removeItem('ks_pulsa_draft');
    return migrated.id;
  } catch {
    return null;
  }
}

/**
 * Identifiant du formulaire actuellement ouvert (persisté).
 * Permet de rouvrir Pulsa sur le dernier formulaire édité.
 */
const CURRENT_KEY = 'ks_pulsa_current_form';

export function getCurrentFormId() {
  try {
    return localStorage.getItem(CURRENT_KEY) || null;
  } catch {
    return null;
  }
}

export function setCurrentFormId(id) {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {}
}
