# 🛑 ZONES PROTÉGÉES — Keystone OS

> Fiche-réflexe à lire **avant toute refonte du cœur partagé** (auth, ui-renderer,
> style.css, routeur, schéma D1). Deux systèmes sont en **production physique /
> publique** et ne se réparent pas après coup : un QR imprimé ne se re-imprime
> pas, une réponse de formulaire perdue est perdue.
>
> Établie le 2026-06-04 (audit en profondeur). Mettre à jour si un contrat change.

---

## 1. Smart Dynamic QR — des QR physiques imprimés en circulation

### Contrat PUBLIC immuable (gravé dans les pixels imprimés)
| Élément | Où | Pourquoi c'est intouchable |
|---|---|---|
| Route `/r/:shortId` | `workers/src/index.js:318` → `handleQrRedirect` | C'est l'URL encodée dans chaque QR imprimé. La renommer = tous les QR morts. |
| Domaine `keystone-os-api.keystone-os.workers.dev` | `app/sdqr.js` (`CF_API`) | Idem, encodé dans les pixels. |
| Format `shortId` (8 car., alphabet précis) | `workers/src/routes/qr.js:36` `shortId()` | Changer la longueur/l'alphabet casse le lookup. |
| Signature `WIN-XXXX-XXXX` (HMAC-SHA256) | `workers/src/routes/qr.js:1200` `_generateWinCode()` | Ordre du seed `shortId\|deviceHash\|ts\|secret` + slices hex `0:4` / `4:8`. Changer = tous les bons gagnants déjà distribués invalides en caisse. |
| Secret `SMARTQR_SIGN_SECRET` | `wrangler secret` (posé en prod ✅) | Même valeur à conserver. Le fallback `'keystone-dev-...'` ne doit JAMAIS servir en prod. |

### Tables D1 — additif seulement (jamais DROP/RENAME de colonne)
- `qr_redirects` — **PK = `short_id`**, lookup global O(1) (pas de filtre tenant dans le WHERE).
- `qr_scans` — logs RGPD-safe, purgés à 90 j par le cron.
- `smartqr_game_plays`, `smartqr_loyalty_stamps` — créées on-the-fly dans `qr.js`.

### Fichiers de la zone (ne pas refactorer sans test QR réel)
```
app/sdqr.js  app/sdqr-render.js  app/sdqr-types.js
app/sdqr-icon-picker.js  app/sdqr-template-icons.js  app/sdqr-templates/*
verify-win.html
workers/src/routes/qr.js
workers/src/routes/sdqr-assets.js
workers/src/routes/smart-templates/*
workers/migrations/002_sdqr.sql  003_sdqr_dynamic_types.sql
```

### Assets servis aux interstitiels (chemins immuables)
- `/sdqr-assets/lottie.min.js`, `/sdqr-assets/gift-box.json` (`routes/sdqr-assets.js`).

---

## 2. Key Form (Pulsa) — formulaire « Biennale du Revest 2026 » en PROD LIVE

> ⚠️ Le formulaire Biennale reçoit de vraies réponses du public. **Lecture seule** :
> ne jamais soumettre de réponse de test, ne jamais altérer ses réponses.

### Contrat PUBLIC immuable (lien déjà diffusé)
| Élément | Où | Pourquoi c'est intouchable |
|---|---|---|
| URL `/f/:slug` | `vercel.json:10` → réécrit `/form?s=$1` | Le lien Biennale partagé en dépend. |
| Chargement form `GET /api/pulsa/public/:slug` | `index.js:276` | Contrat de lecture publique. |
| Soumission `POST /api/pulsa/responses/:slug` | `index.js:282` | Contrat d'écriture publique. |
| Format de réponse `{ responses: { fieldId: value } }` | `form.html` + `routes/pulsa-responses.js` | Stocké tel quel en base. Ne jamais l'envelopper/restructurer (repeaters, signatures, social-links déjà collectés). |
| Regex slug `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$` | `form.html` `getSlug()` | Le slug publié ne doit pas changer. |

### Tables D1 — ne jamais supprimer/altérer (= perte des réponses)
- `pulsa_forms` (config) · `pulsa_responses` (réponses, avec `expires_at` TTL).

### Fichiers de la zone
```
form.html
app/pulsa.js  app/pulsa.css
app/lib/pulsa-types.js  pulsa-library.js  pulsa-demo.js
workers/src/routes/pulsa-forms.js  pulsa-public.js  pulsa-responses.js
```

### localStorage à préserver (sinon brouillons / reprise cassés)
- `ks_pulsa_library`, `ks_pulsa_current_form`, `pulsa_draft_v1_<slug>`.

---

## 3. Crons à NE PAS désactiver (RGPD + saturation D1)
`wrangler.toml [triggers] crons = ["0 3 * * *"]` → `index.js:528 scheduled()` :
purge `qr_scans` (90 j) + purge `pulsa_responses` expirées + rappels d'expiration + auto-downgrade Concierge.

---

## 4. Secrets prod à conserver (rotation = casse)
`KS_ADMIN_SECRET` · `KS_JWT_SECRET` · `KS_ENCRYPTION_KEY` · `SMARTQR_SIGN_SECRET`
(tous posés via `wrangler secret put`, jamais committés).

---

## ✅ Checklist « avant de toucher au cœur partagé »
- [ ] La route `/r/:shortId` et le domaine API sont intacts.
- [ ] `shortId()` produit toujours 8 caractères, même alphabet.
- [ ] `_generateWinCode()` : ordre du seed + slices hex inchangés.
- [ ] Aucune migration ne fait DROP/RENAME sur une table SDQR ou Pulsa.
- [ ] L'URL `/f/:slug` et `POST /api/pulsa/responses/:slug` répondent toujours.
- [ ] Le format `{ responses: {…} }` n'est pas réenveloppé.
- [ ] Les crons de purge tournent encore (voir `/api/admin/health`).
- [ ] Test réel : scanner un vrai QR + ouvrir le formulaire Biennale (lecture seule) après tout gros refactor du cœur.
