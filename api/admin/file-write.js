/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vercel Function · Admin File Write v1.0
   POST /api/admin/file-write
   Headers : Authorization: Bearer <KS_ADMIN_SECRET>
   Body    : { path, content, message? }
   ─────────────────────────────────────────────────────────────
   Écrit un fichier JSON dans le repo GitHub via l'API GitHub.
   Déclenche un redéploiement Vercel automatique.

   Variables d'env requises :
     KS_ADMIN_SECRET  — secret partagé avec le panneau admin
     GITHUB_TOKEN     — Fine-grained PAT (Contents: read+write)
     GITHUB_REPO      — ex: proteinkeystone-storm/keystone-os
     GITHUB_BRANCH    — défaut: main
   ═══════════════════════════════════════════════════════════════ */

// Seuls ces préfixes peuvent être écrits via cet endpoint
const WRITE_ALLOWLIST = [
  'K_STORE_ASSETS/PADS/',
  'K_STORE_ASSETS/catalog.json',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  process.env.KS_ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Méthode non autorisée' });

  // ── Auth ──────────────────────────────────────────────────────
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!process.env.KS_ADMIN_SECRET || token !== process.env.KS_ADMIN_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { path: filePath, content, message } = req.body || {};

  // ── Validation entrée ─────────────────────────────────────────
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Champ "path" requis' });
  }
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Champ "content" requis' });
  }

  // Anti path-traversal
  if (filePath.includes('..') || filePath.includes('\0') || filePath.startsWith('/')) {
    return res.status(403).json({ error: 'Chemin invalide' });
  }

  // Whitelist stricte
  const allowed = WRITE_ALLOWLIST.some(prefix =>
    filePath === prefix || filePath.startsWith(prefix)
  );
  if (!allowed) {
    return res.status(403).json({ error: 'Chemin non autorisé' });
  }

  // Seuls les fichiers JSON sont acceptés
  if (!filePath.endsWith('.json')) {
    return res.status(403).json({ error: 'Seuls les fichiers .json sont autorisés' });
  }

  // Validation JSON du contenu
  try { JSON.parse(content); }
  catch { return res.status(400).json({ error: 'Le contenu doit être du JSON valide' }); }

  // ── Config GitHub ─────────────────────────────────────────────
  const ghToken  = process.env.GITHUB_TOKEN;
  const ghRepo   = process.env.GITHUB_REPO;
  const ghBranch = process.env.GITHUB_BRANCH || 'main';

  if (!ghToken || !ghRepo) {
    return res.status(503).json({
      error: 'GitHub non configuré — ajoutez GITHUB_TOKEN et GITHUB_REPO dans les variables Vercel',
    });
  }

  const apiUrl = `https://api.github.com/repos/${ghRepo}/contents/${filePath}`;
  const ghHeaders = {
    'Authorization':        `Bearer ${ghToken}`,
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':         'application/json',
    'User-Agent':           'keystone-os-admin/1.0',
  };

  try {
    // 1. Récupère le SHA courant (nécessaire pour les mises à jour)
    let sha;
    const getRes = await fetch(`${apiUrl}?ref=${ghBranch}`, { headers: ghHeaders });

    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    } else if (getRes.status !== 404) {
      const errData = await getRes.json().catch(() => ({}));
      return res.status(502).json({ error: `GitHub GET: ${errData.message || getRes.status}` });
    }

    // 2. Encode le contenu en base64
    const encoded = Buffer.from(content, 'utf-8').toString('base64');

    // 3. Crée ou met à jour le fichier
    const putBody = {
      message: message || `Admin: update ${filePath}`,
      content: encoded,
      branch:  ghBranch,
      ...(sha && { sha }),
    };

    const putRes = await fetch(apiUrl, {
      method:  'PUT',
      headers: ghHeaders,
      body:    JSON.stringify(putBody),
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      return res.status(502).json({ error: `GitHub PUT: ${errData.message || putRes.status}` });
    }

    const result = await putRes.json();
    return res.status(200).json({
      success: true,
      path:    filePath,
      sha:     result.content?.sha,
      url:     result.content?.html_url,
    });

  } catch (err) {
    console.error('[file-write] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
