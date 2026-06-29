# 🔒 SCEAU — Brief consolidé + plan de sprints

> **Pad Keystone : transmission de secret à usage unique, scellé, par NFC (+ QR de repli).**
> Document de cadrage = **source de vérité AVANT code**. Reprend toutes les décisions actées en discussion (2026-06-29).
> À lire avec [[MANIFESTE_NOUVELLE_APP]] (architecture, câblage, charte, déploiement) et l'origine de l'idée [[IDEE_AUDIO_EPHEMERE_QR_NFC]].
>
> **Nom de travail : Sceau · ID_KSTORE proposé : `O-SEC-001` · catégorie : SÉCURITÉ.** (Nom à confirmer — `USER_LABEL` découplé de l'ID de toute façon.)

---

## 0. En une phrase

Sceau transmet un **secret** (code, mot de passe, info sensible, texte) via un **objet physique** (puce NFC, repli QR) qui ne porte **que le pointeur** : le contenu est **chiffré de bout en bout**, déverrouillé par une **passphrase hors-bande**, **lu une seule fois**, puis **détruit** — et **cryptographiquement mort après 3 essais ratés**. Même Keystone ne peut pas le lire.

---

## 1. Ce que c'est, et ce que ça n'est PAS

**C'est** un produit de **sécurité honnête** : on garantit que personne d'autre que le bon destinataire (qui a la passphrase) ne lit le secret, que le serveur lui-même en est aveugle, et que l'accès meurt après lecture ou 3 échecs.

**Ce n'est PAS** :
- l'idée « audio éphémère / charme » d'origine (livre d'espionnage, musique). Ça reste un produit cousin possible, **même plomberie, promesse opposée** — on ne mélange jamais les deux fiches.
- vendu comme « inviolable ». On assume noir sur blanc la **limite structurelle du E2E web** (cf. §2) et le **plafond des endpoints** (un écran compromis chez le destinataire, aucune crypto ne le sauve).

---

## 2. Décisions de sécurité ACTÉES (le cap validé)

1. **Chiffrement bout-en-bout (E2E).** Le serveur ne stocke que du **chiffré** (AES-256-GCM, WebCrypto). Il ne voit **jamais** ni la passphrase ni le clair.
2. **Voie OPRF (la plus sûre retenue).** La clé de déchiffrement se dérive via un **OPRF** (oblivious PRF, RFC 9497) : le client **aveugle** la passphrase, le serveur applique sa clé OPRF **par-secret**, renvoie le résultat aveuglé, le client le **dé-aveugle** et dérive la clé AES. Le serveur **rate-limite et compte** ces évaluations sans jamais voir la passphrase.
3. **3 essais → mort cryptographique.** Au 3ᵉ échec, le serveur **détruit la clé OPRF du secret** → plus aucun déchiffrement possible, jamais. (C'est ce qui réconcilie « 3 strikes » ET E2E — impossible avec un simple déchiffrement client.)
4. **Usage unique + burn.** Lecture réussie → suppression du chiffré + clé OPRF, statut « détruit », `Cache-Control: no-store`, **410 Gone** au scan suivant.
5. **Passphrase hors-bande, canal indépendant.** Jamais sur l'objet, jamais dans le même message que le lien. **Éviter le SMS seul** (SIM swap). Le système **génère** une passphrase forte par défaut (l'humain ne choisit pas un mot faible).
6. **Hardening = priorité égale à la crypto.** Contre un attaquant fort, la brèche n'est pas l'AES, c'est : le canal de la passphrase, **la chaîne JS** (limite du E2E web), les endpoints, les fuites de logs/cache/fragment. Traités en S6, présents dès S0.
7. **Pas de récupération.** Passphrase perdue = secret perdu pour toujours. Assumé, affiché.
8. **Crypto auditée, jamais maison.** Candidat OPRF : **`@cloudflare/voprf-ts`** (maintenu par Cloudflare, tourne sur Workers — à valider en S0). AES/HKDF = WebCrypto natif.

---

## 3. Architecture cible (réutilise l'existant, isole le neuf)

| Brique | Réutilise | Neuf / isolé |
|---|---|---|
| Stockage chiffré | **R2** (`HELP_MEDIA` ou bucket dédié) | clé R2 préfixée `sec/<id>` |
| Métadonnées, compteur, clé OPRF | **D1** | table `sec_secrets` (préfixe `sec_`) |
| Route publique de lecture | pattern dispatcher | **`/s/:shortId` NEUF** — **on ne touche PAS `/r/` (SDQR prod)** |
| Création / gestion | renderer + dispatch artifact | module `app/sceau.js` (préfixe `sec_`) |
| Suivi / accusé de lecture | **Living Layer** + tracking scan | signal « sceau ouvert / 3 échecs » |
| IA | — | **AUCUNE** → zéro crédit, zéro neurone, zéro coût récurrent (colle au flat/inclus) |

**Schéma de clé (à figer en S0, gravé dans le doc) :** où vit chaque octet — `clé AES` jamais stockée, dérivée client via `HKDF(dé-aveugle(OPRF(passphrase)))` ; `clé OPRF` par-secret en D1, détruite au burn ou au 3ᵉ échec ; `chiffré` en R2 ; l'objet (NFC/QR) ne porte que `https://protein-keystone.com/s/<id>`.

**Isolation D1 / tenant :** `sec_secrets` porte `tenant_id` (admin → `'default'`, sinon `claims.sub` — cf. piège manifeste §8). Création = `requireJWT`. Lecture publique = anonyme mais **gatée par l'OPRF** (le pointeur seul ne révèle rien).

---

## 4. PLAN DE SPRINTS

> Règle d'or pour un produit de sécurité : **prouver le noyau crypto AVANT de construire le produit autour.** S0 n'est pas optionnel.

### 🧪 SPRINT 0 — Spike crypto + spec gelée ✅ FAIT (2026-06-29)
> Verdict : **la voie OPRF tient.** `@cloudflare/voprf-ts` v1.0.0 (0 vuln), round-trip VOPRF P-256 + AES-256-GCM prouvé de bout en bout, 3-strikes → mort crypto vérifiée. Spec gelée → `SCEAU_CRYPTO_SPEC.md`. Harnais reproductible → `_cryptolab/sceau/`.

**Objectif :** prouver que la voie OPRF tient sur la stack réelle, et figer le schéma de clé.
- Valider **`@cloudflare/voprf-ts`** côté Worker + round-trip OPRF complet avec WebCrypto côté navigateur, dans un **harnais jetable** (hors prod).
- Prouver bout-en-bout : passphrase → aveuglement → eval serveur → dé-aveuglement → HKDF → AES-GCM → déchiffrement. Et l'inverse (chiffrement à la création).
- Écrire le **threat model** + le **schéma de clé figé** (où vit chaque octet, ce que voit/ne voit jamais le serveur).
**Definition of done :** un script de démo qui chiffre puis déchiffre via le vrai OPRF, + un doc `SCEAU_CRYPTO_SPEC.md` gelé. **Si la lib ne tient pas sur Workers → on rouvre ici, pas en S3.**

### 🔐 SPRINT 1 — Backend coffre (le noyau sécurisé) ✅ FAIT (2026-06-29)
> Livré : migration `008_sceau.sql` (table `sec_secrets`), route `workers/src/routes/sceau.js` (création 3 temps init→eval→seal + lecture publique `/s/:id/{meta,eval,blob}` + burn + sweep cron), câblée dans `index.js` (route `/s/` séparée de `/r/`, cron daily). Clé OPRF **chiffrée au repos** sous `KS_ENCRYPTION_KEY` (existant, 0 nouveau secret). **29/29 tests verts** sur le vrai code (`workers/test/sceau.test.mjs`, `npm test`). NON déployé (deploy = S6). 2 bugs trouvés+corrigés par les tests : comparaison de date ISO↔SQLite dans la purge ; ordre client blob-avant-eval pour le one-shot.

**Objectif :** l'API serveur-aveugle, sans aucune UI.
- Migration D1 `sec_secrets` (`short_id`, `tenant_id`, `ciphertext_ref`, `oprf_key`, `attempts`, `max_attempts=3`, `expires_at`, `status` ∈ scellé/lu/détruit/expiré, timestamps).
- Routes Worker (`workers/src/routes/sceau.js`, câblées dans `index.js` sous `/api/sceau/` + `/s/`) :
  - `POST /api/sceau` (JWT) — crée : reçoit le **chiffré** + la clé OPRF générée serveur, renvoie `short_id`.
  - `POST /s/:id/eval` (public) — **évaluation OPRF rate-limitée** : incrémente le compteur, **détruit la clé OPRF au 3ᵉ échec**, ne renvoie jamais rien d'exploitable seul.
  - `GET /s/:id/blob` (public) — sert le chiffré **une seule fois** (`no-store`), 410 ensuite.
  - `DELETE /api/sceau/:id` (JWT) — burn manuel.
- **Anti-fuite dès maintenant** : zéro clair / zéro passphrase / zéro clé dans les logs.
**DoD :** tests unitaires (création, eval OK/KO, mort au 3ᵉ, burn, 410) sur le vrai code ; `node --check`.

### 👁 SPRINT 2 — Page de lecture publique (la réclamation) ✅ FAIT (2026-06-29)
> Livré : page autoportée servie par le Worker `GET /s/:id` (`workers/src/routes/sceau-page.js`), même origine que `/meta /eval /blob` (zéro CORS, pas de rewrite Vercel — l'objet portera `…workers.dev/s/<id>` comme le `/r/` SDQR). Déchiffrement **E2E dans la page**, brisure du sceau, gestion essais/mort, **mention honnête de la limite E2E web**. Durcissement : **CSP `default-src 'none'` + nonce** sur inline, bundle voprf **auto-hébergé + SRI** (`/s-assets/voprf-1.0.0.js`, généré par `_cryptolab/sceau/build-bundle.sh`, IIFE global), `no-store`, `no-referrer`, `X-Frame-Options DENY`, `textContent` (zéro injection). **Vérifié dans le VRAI runtime workerd** (`wrangler dev`) : 15/15 smoke — voprf `blindEvaluate` tourne en workerd, parcours complet bon code/mauvais×3/burn, SRI page==asset servi. S1 non régressé (29/29).

**Objectif :** la page `/s/:id` que voit le destinataire.
- Scan → « Ce sceau est scellé. Entrez le code. » → saisie passphrase → **round-trip OPRF client** → déchiffrement **dans la page** → affichage **une fois** → animation de **brisure du sceau** + burn → **410** au retour.
- Mauvais code : « il reste 2 essais » … 3ᵉ → « sceau détruit ». Bon code consommé → « déjà ouvert ».
- **Hardening de la page** : dépendances minimales, **Subresource Integrity**, `Referrer-Policy: no-referrer`, le fragment ne fuit nulle part, et **mention honnête in-page** de la limite du E2E web.
**DoD :** parcours complet en navigation privée ; aucun octet sensible dans cache/logs/Referer (vérifié).

### 🎛 SPRINT 3 — Création & gestion (le pad fullscreen) ✅ FAIT (2026-06-29)
> Livré : `app/sceau.js` + `app/sceau.css` (préfixe `sceau-`, shell `ws-app` comme Sentinel) — **création** (collage secret → passphrase forte générée ~80 bits → chiffrement E2E sur l'appareil via flux init→eval→seal → résultat avec lien `/s/<id>`, **QR** `qrcode-generator`, **bouton NFC** Web NFC) + **gestion** (liste avec statuts/essais restants, copie lien, QR par ligne, **burn**). Crypto navigateur = bundle voprf ESM auto-hébergé `app/vendor/sceau-voprf.esm.js` + WebCrypto, **mêmes params canoniques** que S1/S2. Câblage manifeste §4 complet : import+dispatch `ui-renderer.js` (`O-SEC-001`), `CATALOG_DATA` (`pads-data.js`), `PADS/O-SEC-001.json`+`manifest.json`, `catalog.json`, lien CSS `app.html`, pictos `sceau`+`radio` (`ui-icons.js`). `window.__KS_API_BASE__` honoré (dev local). **Vérifié** : syntaxe+JSON OK ; **interop du bundle FRONT contre workerd local** = create+list+read(bon code→secret exact)+burn OK (le moteur exact de l'UI). ⚠ **non pixel-vérifié** (aucun harnais de preview configuré pour ce front statique + pad derrière le dashboard authentifié) → revue visuelle à faire au S6 (deploy) ou via preview dédié. Prod-critiques intacts, S1 29/29.

**Objectif :** le module artifact `O-SEC-001`.
- `app/sceau.js` (+ `.css`, préfixe `sec_`) exportant `openSceau(opts)`. Câblage manifeste §4 : import + dispatch `openTool` + entrée `CATALOG_DATA` (`pads-data.js`) + `PADS/O-SEC-001.json` + `manifest.json` + `catalog.json` (`published:true`).
- Créer un secret : coller le texte/code → **chiffrement client** → **passphrase forte générée** (copiable une fois) → réglages (expiration, max essais) → récupérer le lien `/s/<id>` + **QR imprimable** + payload NFC.
- Gérer : liste avec statut (scellé / lu / détruit / expiré), **burn manuel**, **re-pointage dynamique**.
- Charte Apple Premium (font 900, sentence case, pictos `icon()` outline — **jamais d'emoji UI**, en ajouter au registre si besoin), responsive (chercher `@media` existants).
**DoD :** créer → réclamer → lire → détruire de bout en bout depuis l'UI ; checklist charte.

### 📡 SPRINT 4 — NFC (encodage) + repli QR ✅ FAIT (2026-06-30)
> Livré : **jeton réutilisable** = pointeur stable `/s/t/:tid` (migration `009_sceau_tokens.sql`, table `sec_tokens` avec `current_short_id`, façon SDQR). Backend `sceau.js` : `POST/GET /api/sceau/token`, `POST /api/sceau/token/:tid/point` (rechargement), `DELETE`, + résolution publique `/s/t/:tid/{meta,eval,blob}` (délègue aux handlers secret) ; page `/s/t/:tid` (sceau-page.js paramétré par `BASE`, état « jeton vide »). Front : onglet « Jetons réutilisables » (créer/charger/recharger/lien/QR/NFC/supprimer). **NFC** : écriture Web NFC (Android+Chrome) avec **repli QR systématique**, limites documentées dans la notice (écriture=Android/Chrome ; lecture au tap=iPhone récent+Android). **Tests 41/41** (12 nouveaux jetons) + **smoke workerd 7/7** (routes jetons, page `/s/t/:tid`, rechargement, régression page secret directe). Prod-critiques intacts, rien déployé (S6).

**Objectif :** l'objet physique, et le jeton réutilisable.
- Écriture NFC via **Web NFC** (Android/Chrome) du payload `/s/<id>` ; **repli QR systématique** (iOS non fiable — limite documentée).
- **Jeton réutilisable** : re-pointer une puce vers un nouveau secret depuis le dashboard, **sans retoucher l'objet** (l'edge du système dynamique vs One-Time Secret jetable).
**DoD :** encoder une puce, scanner, lire ; QR de repli fonctionnel ; limites NFC écrites dans la notice.

### 🛰 SPRINT 5 — Suivi & accusé de lecture (Living Layer) ✅ FAIT (2026-06-30)
> Livré : **accusé de lecture** `POST /s/:id/opened` (+ `/s/t/:tid/opened`) émis par la page après déchiffrement réussi (esprit Snap) — sert aussi de **burn happy-path** (« lu une fois » : status `lu` + matériel effacé). Capteur `_sensorSceau` dans `living-layer-board.js` (opened7d / intercepted24h / active), branché : **alerte collante** « possible interception » (`_buildAlert`, sceau mort par essais épuisés SANS lecture, 24h, priorité sécurité en tête), candidat **calculateur** « X sceaux ouverts cette semaine », + `metrics.sceauOpened7d/sceauActive`. RGPD : comptes seuls (zéro PII), + **purge 90 j** des lignes mortes ajoutée au cron `sweepExpiredSecrets`. ⚠ piège tenant respecté (admin→'default', capteur appelé avec `padTenant`). **Tests 52/52** (11 nouveaux S5) + **smoke workerd 6/6** : board renvoie l'alerte « possible interception » + `sceauOpened7d`, lu-une-fois consomme. Living Layer modifié de façon **additive** (capteur `.catch`→0 si table absente → zéro régression avant migration). Prod-critiques intacts, rien déployé.

**Objectif :** le différenciateur cheap/haute valeur.
- Brancher l'événement de lecture/destruction sur le **Living Layer** : « votre sceau a été ouvert » / « 3 essais échoués — possible interception » (mode alerte collante).
- **RGPD-safe** : aucune PII, agrégats anonymes, purge 90 j (cron existant).
**DoD :** ouvrir un sceau fait apparaître le signal ; 3 échecs déclenchent l'alerte.

### 🛡 SPRINT 6 — Hardening, audit & lancement ⏳ CODE FAIT (2026-06-30), DEPLOY EN ATTENTE D'AUTORISATION
> Fait : **gating serveur** (création réservée MAX/ADMIN/BETA, modèle Smart Agent ; lecture publique ouverte) sur `init`+`token`. **Audit anti-fuite** : zéro `console.*` de données sensibles, `no-store`+`no-referrer` sur tout endpoint public, pas de fragment d'URL exploité, CSP page stricte + SRI, **cap `blinded` 1024c** (anti-DoS), ciphertext capé 200k. **Notice help** `HELP/O-SEC-001.json` (gabarit GW). **Doc user** : entrée changelog `keystone-doc.js`. **Bump SW** `v5.28.76-sceau`. Pictos `sceau`+`radio`. **58/58 tests** (6 nouveaux gating). Reste **manuel/à autoriser** : (1) revue VISUELLE du pad (impossible ici, aucun navigateur connecté) ; (2) **migrations 008+009 sur D1 prod** ; (3) **push front** (Vercel) ; (4) **`wrangler deploy`** worker (autorisation explicite + stash Pulsa) ; (5) Admin → Catalogue → Synchroniser → Sauvegarder.

**Objectif :** mériter le mot « sécurisé ».
- **Audit anti-fuite complet** : logs, headers cache, fragment, `Referrer-Policy`, **CSP** refermée + SRI, types/tailles R2 capés.
- **Auto-pentest** (skill `security`) + tuning du rate-limit OPRF.
- **Gating serveur** (app sensible, cf. manifeste §7/§13) : doubler le gating client par un gate serveur (modèle Smart Agent : MAX/ADMIN/BETA en beta).
- **Notice help** (gabarit GW), **doc user** (`keystone-doc.js` + changelog), **picto** au registre, **identité Admin** (La Fabrique).
- **Copy de positionnement honnête** : « éphémère sécurisé », jamais « inviolable » ; limite E2E web affichée.
- **Bump SW** + smoke prod + deploy (worker = autorisation explicite + stash WIP Pulsa). **Admin → Catalogue → Synchroniser → Sauvegarder.**
**DoD :** checklist §17 du manifeste cochée ; SDQR / Smart Agent / Key Form non impactés ; smoke prod vert.

### ➕ SPRINT 7 (optionnel, post-lancement) — Modes & extensions
- Secret = **fichier** (pas que texte) ; **secret audio** (reconvergence avec l'idée d'origine, mais sécurisé) ; variante **OTP** pour destinataire non technique ; multi-destinataires.
- (Plus tard, si vrai besoin « 3 strikes littéral » déjà couvert par OPRF → rien à ajouter.)

---

## 5. Ce qu'on NE fait PAS (garde-fous de scope)

- ❌ Toucher au dispatcher `/r/` ou aux QR de prod SDQR (route `/s/` séparée).
- ❌ Mélanger la fiche « Sceau sécurisé » avec un produit « charme » (audio éphémère).
- ❌ Promettre « inviolable / confidentiel absolu » — limite E2E web + endpoints assumées.
- ❌ Chiffrement maison — lib OPRF auditée + WebCrypto uniquement.
- ❌ La moindre dépendance IA (zéro métrage, zéro coût récurrent).
- ❌ Stocker quoi que ce soit qui permette à Keystone de lire un secret.

---

## 6. Checklist manifeste (rappel §17, à cocher en S6)
- [ ] ID immuable `O-SEC-001` / label découplé · module `sec_` isolé
- [ ] Artifact : import + dispatch `openTool` + `CATALOG_DATA` (pads-data.js)
- [ ] `PADS/O-SEC-001.json` + `manifest.json` + `catalog.json` (`published:true`)
- [ ] Route worker `/api/sceau/` + `/s/` câblée + auth + tables `sec_` + gating serveur
- [ ] Picto outline · notice help · doc user + changelog
- [ ] Charte (font 900, sentence case, responsive, **pas d'emoji UI**)
- [ ] Sécurité : E2E vérifié, anti-fuite, CSP/SRI, RGPD, R2 capé
- [ ] **Pas de métrage IA** (aucun appel) — vérifié
- [ ] Tests + smoke · **bump SW** · deploy (autorisation + stash Pulsa)
- [ ] Admin → Catalogue → Synchroniser → Sauvegarder
- [ ] Prod-critiques (Key Form / Smart Agent / SDQR) non impactés

---

*Cadrage du 2026-06-29, non codé. Origine : [[IDEE_AUDIO_EPHEMERE_QR_NFC]]. Dépend de la validation crypto S0 (`@cloudflare/voprf-ts` sur Workers). À mettre à jour à chaque décision actée.*
