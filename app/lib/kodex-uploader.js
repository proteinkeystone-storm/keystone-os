/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex Asset Uploader (Sprint Kodex-3.1.5)
   ─────────────────────────────────────────────────────────────
   Helper côté client pour téléverser des fichiers binaires
   (logos, brand book, illustrations) via le Worker.

   Conversion en base64 côté client → POST vers /api/kodex/asset.
   Retour : objet asset avec id + url servable.

   Authentification : JWT licence (priorité) sinon admin secret.
   Cohérent avec sdqr.js _headers().
   ═══════════════════════════════════════════════════════════════ */

import { CF_API } from '../pads-loader.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;   // 2 MB binary (devient ~2.7 MB base64)

export const ALLOWED_MIMES = [
  'image/png', 'image/jpeg', 'image/svg+xml', 'image/gif', 'image/webp',
  'application/pdf',
  'application/postscript',
  'application/illustrator',
];

// ── Headers Authorization (admin priorité, sinon JWT) ─────────
function _authHeaders(extra = {}) {
  const h = { ...extra };
  const adminToken = localStorage.getItem('ks_admin_token');
  const jwt        = localStorage.getItem('ks_jwt');
  if (adminToken)  h['Authorization'] = 'Bearer ' + adminToken;
  else if (jwt)    h['Authorization'] = 'Bearer ' + jwt;
  return h;
}

// ── Lecture d'un File en base64 (sans le préfixe data:...) ────
function _readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      // result = "data:image/png;base64,XXXXX" → on garde uniquement XXXXX
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Lecture du fichier échouée'));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploade un fichier File natif vers le backend.
 *
 * @param {File} file    objet File HTML5
 * @param {string} kind  catégorie : logo | charte | photo | illustration |
 *                       brand_book | gabarit | autre
 * @returns {Promise<object>} { id, filename, mime, kind, size_bytes, url, created_at }
 */
export async function uploadFile(file, kind = 'autre') {
  if (!file) throw new Error('Aucun fichier');
  if (!ALLOWED_MIMES.includes(file.type)) {
    throw new Error(`Type non supporté : ${file.type || 'inconnu'}. Acceptés : PNG, JPG, SVG, GIF, WebP, PDF, AI, EPS.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Fichier trop volumineux (${Math.round(file.size / 1024 / 1024 * 10) / 10} MB). Maximum : ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }

  const dataBase64 = await _readAsBase64(file);

  const res = await fetch(`${CF_API}/api/kodex/asset`, {
    method: 'POST',
    headers: _authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      kind,
      filename: file.name,
      mime: file.type,
      dataBase64,
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Upload échoué (HTTP ${res.status})`);
  }
  return res.json();
}

/**
 * Supprime un asset uploadé.
 */
export async function deleteAsset(id) {
  const res = await fetch(`${CF_API}/api/kodex/asset/${id}`, {
    method: 'DELETE',
    headers: _authHeaders(),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Suppression échouée (HTTP ${res.status})`);
  }
  return res.json();
}

/**
 * URL absolue d'un asset (à utiliser dans <img src> ou <a href>).
 */
export function assetUrl(id) {
  return `${CF_API}/api/kodex/asset/${id}`;
}

/**
 * Helper de format de taille pour affichage UI.
 */
export function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  return (bytes / 1024 / 1024).toFixed(1) + ' Mo';
}
