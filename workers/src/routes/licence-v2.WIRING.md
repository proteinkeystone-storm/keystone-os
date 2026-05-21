# Sprint S1 — Wiring de `licence-v2.js` dans `index.js`

> **Status :** routes prêtes, **PAS encore wirées**.
> Cette note documente les 2 modifs à appliquer à `workers/src/index.js`
> pour activer les nouvelles routes auth v2. Le wiring n'a pas été
> fait automatiquement parce que `workers/src/index.js` était en WIP
> au moment du sprint (directive utilisateur "ne pas toucher").

## Pré-requis avant wiring

1. ✅ Tes modifs WIP sur `workers/src/index.js` doivent être commitées
   (ou tu acceptes que mes ajouts soient committés avec).
2. ✅ Tes modifs WIP sur `workers/src/routes/pulsa-responses.js` doivent
   être commitées (n'impacte pas S1 mais évite la confusion).

## Patch #1 — Import (haut du fichier, après les autres imports)

Ajouter cette ligne dans la zone des imports de `workers/src/index.js`,
juste après les imports de `./routes/licence-public.js` ou
`./routes/licence.js`, peu importe lequel :

```js
import {
  handleLicenceMe,
  handleLicenceMembers,
  handleLicenceClaim,
  handleLicenceInvite,
  handleLicenceRevokeMember,
} from './routes/licence-v2.js';
```

## Patch #2 — Routes (dans le `switch` / chaîne de `if`, zone des routes licence)

Ajouter ces 5 blocs dans la chaîne `if/else` du handler `fetch()`,
**juste après** le bloc des routes `/api/licence/*` existantes
(handleList / handleActivate / handleRevoke / handleValidate). Ordre
recommandé : groupé en un bloc commenté `// ── Licence v2 (Sprint S1) ──`.

```js
// ═══════════════════════════════════════════════════════════════
// Licence v2 — multi-email pour plan MAX (Sprint S1)
// Routes ADDITIVES — n'altèrent aucune route v1 existante.
// ═══════════════════════════════════════════════════════════════
if (path === '/api/licence/me' && method === 'GET') {
  return handleLicenceMe(request, env);
}
if (path === '/api/licence/members' && method === 'GET') {
  return handleLicenceMembers(request, env);
}
if (path === '/api/licence/claim' && method === 'POST') {
  return handleLicenceClaim(request, env);
}
if (path === '/api/licence/invite' && method === 'POST') {
  return handleLicenceInvite(request, env);
}
if (path.startsWith('/api/licence/members/') && method === 'DELETE') {
  const targetEmail = path.split('/').pop();
  return handleLicenceRevokeMember(request, env, targetEmail);
}
```

## Patch #3 — OPTIONS pour CORS (si pattern explicite dans index.js)

Si ton handler `fetch()` a une logique explicite pour gérer les
`OPTIONS` preflight (`method === 'OPTIONS' → corsOk(origin)`), elle
attrapera automatiquement les nouvelles routes — aucun ajout nécessaire.

## Migration D1 (auto-exécutée au boot)

La migration des colonnes/tables est **auto-exécutée** par
`ensureSchemaAuthV2()` au premier appel de n'importe quelle route v2.
Pattern identique à `kodex-assets.js`, `qr.js`, `pulsa-forms.js`.

Si tu veux la pré-appliquer manuellement (recommandé pour audit) :

```bash
cd workers && npx wrangler d1 execute keystone-os --remote --file=./src/db/migration_sprint_s1.sql
```

⚠️ Si tu pré-appliques manuellement et que tu re-lances `ensureSchemaAuthV2`,
les `ALTER TABLE ADD COLUMN` lèveront "duplicate column" en silence (try/catch
défensif côté code). Aucun impact.

## Smoke tests post-wiring + post-deploy

```bash
# 1. Biennale public — DOIT toujours marcher (zéro impact S1)
curl -s 'https://keystone-os-api.keystone-os.workers.dev/api/pulsa/public/biennale-revest-2026' | head -c 200

# 2. SDQR redirect public — DOIT toujours marcher (remplace <short_id>)
curl -sI 'https://keystone-os-api.keystone-os.workers.dev/r/<short_id>' | head -3

# 3. SDQR liste QR avec admin token — DOIT toujours marcher
curl -s -H "Authorization: Bearer $KS_ADMIN_TOKEN" \
  'https://keystone-os-api.keystone-os.workers.dev/api/qr' | head -c 200

# 4. NOUVEAU — /api/licence/me en admin
curl -s -H "Authorization: Bearer $KS_ADMIN_TOKEN" \
  'https://keystone-os-api.keystone-os.workers.dev/api/licence/me'
# Attendu : { auto-migration s'exécute, retourne { auth: { is_admin: true, … }, my_role: 'admin' } }

# 5. NOUVEAU — /api/licence/me avec un JWT user
# (exec depuis la console du browser après login)
fetch('/api/licence/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('ks_jwt') } })
  .then(r => r.json()).then(console.log)
# Attendu : { auth: { is_admin: false, email: 'xxx@…', licence_key: '…' }, licence: {…}, members: […], my_role: 'owner'|null }
```

## Rétrocompat — checklist

Aucune route existante n'est modifiée. Vérifications :

- `requireAdmin()` / `requireJWT()` / `requireDevice()` : **inchangés**
  (`workers/src/lib/auth.js` n'a pas été touché par S1).
- Tables `licences`, `devices` : seules colonnes ajoutées sont
  **NULLABLE** (`domain_locked`, `devices_max`, `licence_key`).
- Aucune contrainte FK ne brise l'existant : `licence_emails.licence_key`
  référence `licences.key` qui est PRIMARY KEY déjà existante.
- `devices.licence_key` est NULL pour tous les devices créés avant S1 →
  zéro impact runtime sur Pulsa, SDQR, Kodex, etc.

## Roadmap S2 (suite)

Une fois S1 wiré + déployé + smoke tests verts, S2 prendra le relais :
- UI Settings → Mes appareils
- `requireDevice()` rétrocompat enrichi (binding `(licence_key, email)`)
- Application effective de `devices_max` côté `/api/licence/v2/activate`
- Erreur 409 enrichie avec liste des devices existants
