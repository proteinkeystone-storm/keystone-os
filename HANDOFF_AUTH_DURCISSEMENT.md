# HANDOFF — Durcissement de l'authentification (magic link + OTP + SSO)

**Créé le :** 2026-07-26
**Origine :** brief externe `~/Desktop/brief-magic-link.md` (P1→P6) — adapté ici à la VRAIE stack.
**Objectif :** auth fiable pour des clients ENTREPRISE (Outlook/M365, Proofpoint, quarantaines) avant le lancement de septembre 2026.

---

## 0. Constat capital — les hypothèses du brief étaient FAUSSES

Le brief supposait Astro SSR + Supabase Auth (`signInWithOtp`, PKCE, `@supabase/ssr`). **Rien de tout cela n'existe.** La stack réelle :

| Brief supposait | Réalité Keystone |
|---|---|
| Supabase Auth | **Magic link MAISON** : `workers/src/routes/auth-magic-link.js` (Sprint S3) |
| Astro SSR + cookies | Front statique Vercel + **JWT HS256 dans localStorage** (`ks_jwt`) |
| SMTP Supabase | **Resend** (`lib/email-resend.js`), FROM par défaut `onboarding@resend.dev` |
| PKCE / code_verifier | **Fingerprint device** optionnel vérifié au consume |

Conséquences :
- P6 du brief (cookies SSR) **ne s'applique pas** — pas de SSR, pas de cookies de session.
- P5 (cycle de vie du token) est **dans notre code**, donc actionnable à 100 %.
- Le « P2 changement d'appareil » existe mais sa cause est le **fingerprint** (403 si mismatch), pas un code_verifier PKCE.

## 0bis. Ce qui existait déjà (ne pas re-livrer)

- Token 32 octets CSPRNG, stocké **hashé** SHA-256, index unique.
- Usage unique (`consumed_at`), TTL par purpose (15 min login / 60 min activation / 30 min recovery / 7 j invite).
- Rate limit 5/email/h + 20/IP/h, IP hashée avec pepper (RGPD).
- Réponse silencieuse « si cet email correspond… » (anti-énumération).
- Audit log au consume (S5.1).

## 0ter. Les trous constatés (avant ce chantier)

1. **P1 — `auth-magic.html` consommait le token automatiquement au chargement** (fetch au boot). Une sandbox Safe Links/Proofpoint qui exécute le JS tuait le lien avant l'humain. C'était l'anti-pattern exact interdit par le brief.
2. **P2 — fingerprint** : demandé sur desktop → ouvert sur mobile = 403 sec. Aucun chemin de repli saisissable (pas de code OTP).
3. **Course sur la consommation** : lecture `consumed_at` puis UPDATE non gardé → deux consommations simultanées pouvaient obtenir chacune un JWT.
4. **Pas d'invalidation** des tokens précédents à la nouvelle demande ; **pas de purge** des expirés.
5. **Oracle d'énumération subtil dans le rate limit** : les lignes `magic_links` n'étaient insérées QUE pour les emails connus → seul un email existant pouvait déclencher le 429. Un attaquant patient distinguait donc les comptes réels.
6. **Pas de throttle court** (1/60 s) — seulement 5/h.
7. **Délivrabilité** : FROM Resend par défaut, pas de log des envois, pas de webhook statut.

---

## Sprints

### ✅ AUTH-1 — Anti-scanner (P1) — LIVRÉ CE CHANTIER
`auth-magic.html` n'auto-consomme plus. Page de confirmation : bouton **« Confirmer ma connexion »** → POST `consume-magic-link`. Aucun `<meta refresh>`, aucun fetch au onload, aucun redirect automatique avant action humaine. Les 401 de liens déjà consommés proposent le repli code.

### ✅ AUTH-2 — Code OTP 6 chiffres (P2, décision D1) — LIVRÉ CE CHANTIER
- Chaque magic link porte AUSSI un code à 6 chiffres (CSPRNG, stocké hashé SHA-256+pepper, `otp_hash`).
- L'email affiche le code en évidence + le bouton. Message : « Sur un autre appareil, saisissez ce code. »
- `POST /api/auth/consume-otp` `{ email, code, fingerprint }` : max **5 tentatives** par lien (`otp_attempts`), même consommation gardée, même JWT.
- **Politique fingerprint** : le chemin OTP n'exige PAS le match fingerprint (c'est le chemin cross-device par définition) mais l'écart est **audité** (`fingerprint_match:false`). Le chemin lien garde le 403 strict.

### ✅ AUTH-3 — Cycle de vie (P5) — LIVRÉ CE CHANTIER
- Consommation **anti-course** : `UPDATE … SET consumed_at = now WHERE id = ? AND consumed_at IS NULL` + vérif `meta.changes === 1`. Le JWT n'est émis que si NOTRE update a gagné.
- **Nouvelle demande invalide les précédents** tokens non consommés du même email+purpose (sauf `invite`, qui vit 7 jours et vient d'un tiers).
- **Purge** des liens expirés/consommés > 48 h : au cron quotidien 3 h UTC + opportuniste à chaque request.

### ✅ AUTH-4 — Rate limiting (P4) — LIVRÉ CE CHANTIER
- Nouvelle table `auth_request_log` : **toutes** les demandes y passent (email connu ou non) → le rate limit compte dessus → **l'oracle d'énumération est mort**.
- Throttle **1/60 s par email** + 5/h par email + 20/h par IP. Dépassement → même réponse 200 silencieuse que le cas nominal (le brief exigeait l'indistinguabilité ; le 429 explicite a été retiré).
- `magic_links` ne reçoit toujours une ligne QUE pour les comptes réels (pas de pollution).

### ✅ AUTH-5 — Délivrabilité (P3) — **SCALEWAY TEM ACTIF EN PROD, PARCOURS VALIDÉ BOUT EN BOUT (26/07 nuit)**
Domaine `mail.protein-keystone.com` vérifié (DNS chez Vercel), policy IAM corrigée (piège : `BlocklistFullAccess` ≠ `FullAccess`), `KS_EMAIL_PROVIDER=scaleway` déployé, email réel reçu (bouton + code OTP) et **connexion complète testée par Stéphane : OK**. Quota 10 000/mois. Reste (non bloquant) : màj `dpa.html`/Annexe A, révoquer `KS_RESEND_KEY` après quelques jours, webhook bounces, œil sur le spam la 1re semaine.

#### Détail d'origine (archive) :
Fait :
- Table `email_log` (destinataire, sujet, statut, id fournisseur) alimentée par `sendEmail()`.
- **Dispatch fournisseur dans `lib/email-resend.js`** : `KS_EMAIL_PROVIDER = 'resend' (défaut) | 'scaleway'` — bascule par VAR, sans redéploiement. Chemin Scaleway = API TEM `fr-par` (`X-Auth-Token`), from décomposé, `text` dérivé du html, Reply-To en `additional_headers`, bcc en copies séparées, ids `scw:` dans `email_log`. Testé unitaire 13/13 (`test/test-email-provider.mjs`).
- Coût : 300 mails/mois gratuits puis 0,25 €/1000, zéro abonnement — quasi 0 € pendant la beta.

Reste (actions console/DNS Stéphane, puis bascule) :
1. Console Scaleway : créer le projet (ou réutiliser), activer Transactional Email, **ajouter le domaine `mail.protein-keystone.com`** → Scaleway affiche les enregistrements DNS (SPF include, DKIM, DMARC, MX de retour) à poser chez le registrar de protein-keystone.com.
2. IAM : créer une clé API avec la permission TEM → `cd workers && npx wrangler secret put KS_SCW_SECRET_KEY`.
3. Vars wrangler.toml (ou dashboard) : `KS_SCW_PROJECT_ID`, `KS_EMAIL_FROM = "Keystone OS <auth@mail.protein-keystone.com>"`, puis **`KS_EMAIL_PROVIDER = "scaleway"`** une fois le domaine « validé » chez Scaleway.
4. Rollback instantané : repasser `KS_EMAIL_PROVIDER` à `resend`.
5. Webhook statut TEM (bounce/delivered) → route à créer après la bascule.
6. Critère : ≥ 9/10 sur mail-tester.com, tests réels Gmail + Outlook + OVH/Orange.

### ✅ AUTH-6 — SSO entreprise (OIDC) — **MOTEUR EN PROD (DORMANT), 26/07 nuit**
`routes/auth-oidc.js` (worker dedb2924, front v5.28.407) : RP OIDC générique zéro dépendance — découverte `.well-known`, PKCE S256, state/nonce usage unique (DELETE gardé anti-rejeu), id_token RS256 vérifié au JWKS (kid/iss/aud/exp/nonce/email_verified), cloisonnement `email_domain`. **Un login SSO débouche sur un magic-link usage unique → page « Confirmer » → JWT** (aucun jeton en URL, réutilise AUTH-1→4). Le SSO authentifie, ne provisionne PAS (`no_account` sinon). Admin : CRUD `/api/admin/sso-connections` (secret AES-256-GCM, jamais renvoyé). Front : bouton « Connexion SSO entreprise » sur `/auth/magic` + messages `sso_error`. Banc `test/test-auth-oidc.mjs` (IdP factice Node RS256) **19/19**.
**DORMANT tant qu'aucune connexion n'est enregistrée** — activation pour un client :
1. Enregistrer l'app chez l'IdP (une seule fois par IdP) : redirect URI = `https://keystone-os-api.keystone-os.workers.dev/api/auth/oidc/callback`, scopes openid email profile. Entra : une app multi-tenant sert TOUS les clients Microsoft ; Google : une app OAuth.
2. `POST /api/admin/sso-connections` (Bearer admin) : `{ email_domain, issuer, client_id, client_secret, licence_key? }`. Entra : issuer = `https://login.microsoftonline.com/<tenant-du-client>/v2.0` (1 connexion par client). Google : issuer = `https://accounts.google.com`.
3. C'est actif — le bouton du front trouve la connexion via `/api/auth/sso/lookup`.

#### Plan d'origine (archive) :
Décision D4/D5 : pas de mot de passe (le magic link hérite du MFA de la boîte d'entreprise) ; la réponse aux exigences institutionnelles = **SSO**, pas mot de passe.
- **OIDC d'abord, SAML jamais en direct.** Microsoft Entra ID + Google Workspace parlent tous deux OIDC → couvre ~95 % des clients entreprise. SAML pur (fédérations exotiques) : hors scope tant qu'aucun client ne l'exige contractuellement.
- Architecture prévue (tout dans le Worker, zéro dépendance) :
  - Table `sso_connections` : `licence_key, issuer, client_id, client_secret (chiffré), allowed_email_domains`.
  - `GET /api/auth/oidc/start?domain=…` → découverte `.well-known/openid-configuration`, state+nonce+PKCE en D1, redirect vers l'IdP.
  - `GET /api/auth/oidc/callback` → échange code, vérif `id_token` (JWKS, nonce, aud, iss), email vérifié → lookup `licence_emails` → **même émission JWT que le magic link** (`via:'oidc'`).
  - Le front : bouton « Se connecter avec Microsoft/Google » sur l'écran d'activation, visible si le domaine email a une connexion SSO.
- **Prérequis Stéphane (bloquants, à faire pendant/avant le sprint) :** enregistrer l'app sur Entra ID et Google Cloud Console (redirect URI = `https://keystone-os-api.keystone-os.workers.dev/api/auth/oidc/callback`), récupérer client_id/secret. En multi-tenant Entra, UNE app suffit pour tous les clients Microsoft.

---

## Décisions actées ce chantier (ne pas re-débattre)
- **D1 = OTP 6 chiffres**, chemin principal cross-device (pas le verifier serveur, pas le flow implicite).
- **D2 = TTL inchangés** (15 min login MAIS le token ne meurt plus au premier GET ; l'invalidation par nouvelle demande couvre le reste). Si les quarantaines d'entreprise posent problème en réel → passer `magic_login` à 60 min, une constante à changer (`TTL_MIN`).
- **D4 = pas de mot de passe.** SSO OIDC pour les exigences entreprise.
- Le 429 explicite du throttle a été remplacé par le 200 silencieux (anti-oracle) — c'est voulu, ne pas « réparer ».

## Parcours de test couverts par le banc (`workers/test/test-auth-magic-hardening.mjs`)
1. GET répétés sur le lien (scanner) → token intact ; 2. double consommation concurrente → un seul JWT ; 3. OTP nominal ; 4. OTP faux ×5 → verrouillé ; 5. nouvelle demande → ancien token mort ; 6. email inexistant → réponse identique ; 7. throttle 60 s silencieux ; 8. purge.

Lancement :
```
npx wrangler dev --local -c wrangler.dktest.toml --port 8799 --test-scheduled \
  --var KS_JWT_SECRET:bk-test-secret --var "KS_ALLOWED_ORIGIN:*" \
  --var KS_ADMIN_SECRET:bk-admin --var KS_LOOKUP_PEPPER:bk-pepper
node test/test-auth-magic-hardening.mjs
```

## Déploiement
- Worker : `cd workers && npx wrangler deploy` (indépendant du front).
- Front : push `main` (Vercel auto) + **bump-sw obligatoire** (PWA).
- Rétro-compat : les liens déjà émis (anciens emails) passent par la nouvelle page à bouton — ils marchent toujours ; les lignes `magic_links` sans `otp_hash` refusent juste le chemin code (normal).
