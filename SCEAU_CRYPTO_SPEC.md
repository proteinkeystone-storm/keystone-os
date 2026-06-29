# 🔐 SCEAU — Spécification cryptographique GELÉE (S0)

> **Livrable du Sprint 0.** Spec figée AVANT tout code produit. Toute déviation = on rouvre ce doc.
>
> **Raffinements actés au S1 (2026-06-29, implémentés et testés 29/29) :**
> 1. **Chiffré INLINE en D1** (pas R2) pour les secrets-texte → burn ATOMIQUE (chiffré + clé OPRF en 1 UPDATE). R2 réservé aux secrets-FICHIERS (S7).
> 2. **Création en 3 temps** (résout le point ouvert §5) : `init` (génère paire OPRF, status `init`) → `eval` de création **NON comptée** (JWT, status `init`) → `seal` (dépose chiffré, arme compteur à 0, status `scelle`). L'eval de création ne grignote donc jamais les 3 essais de lecture.
> 3. **Pas de burn public** (anti-DoS) : « lu une fois » = `max_attempts` (défaut 3 ; mettre **1** pour one-shot strict) + expiration ; burn explicite = `DELETE` (créateur, JWT).
> 4. **Ordre client = blob AVANT eval** (le blob est opaque/inoffensif ; en one-shot l'eval tue la clé et le blob suivant 410).
> 5. **Dates en ISO 8601 UTC**, jamais comparées à `datetime('now')` SQLite (format espacé → `'T' > ' '` fausse le `<`).
> Prouvée par le harnais `_cryptolab/sceau/harness.mjs` (exécuté 2026-06-29, Node 24 + `@cloudflare/voprf-ts`).
> À lire avec [[SCEAU_BRIEF]] et [[MANIFESTE_NOUVELLE_APP]].

---

## 0. Verdict S0

✅ **La voie OPRF tient sur la stack cible.** `@cloudflare/voprf-ts` (maintenu par Cloudflare, conçu pour Workers) installé proprement (0 vulnérabilité), round-trip VOPRF P-256/SHA-256 complet + AES-256-GCM via WebCrypto prouvé de bout en bout. Tous les scénarios passent : bon code → déchiffre ; 3 mauvais codes → tag GCM rejeté ; au 3ᵉ → **clé OPRF détruite** ; après mort, **le bon code lui-même échoue** (irrécupérable). Latence : ~294 ms le round-trip complet (négligeable pour une lecture). **On peut construire S1 sur cette base.**

---

## 1. Paramètres figés (ne pas dévier sans rouvrir S0)

| Élément | Choix gelé | Pourquoi |
|---|---|---|
| Primitive d'aveuglement | **VOPRF**, suite `P256_SHA256` (RFC 9497) | Vérifiable (preuve DLEQ : le client s'assure que le serveur a bien utilisé la clé engagée) ; P-256/SHA-256 = WebCrypto natif partout, pas de courbe exotique. |
| Lib | **`@cloudflare/voprf-ts`** | Auditée, maintenue par Cloudflare, tourne sur Workers. **Jamais de crypto maison.** |
| Dérivation de clé | **HKDF-SHA-256**, `salt="sceau/v1"`, `info="aes-gcm-256"` | Standard, WebCrypto natif. |
| Chiffrement | **AES-256-GCM**, IV aléatoire **12 o** par secret | AEAD : le tag d'auth **est** le détecteur de mauvais code (pas de comparaison côté serveur). |
| Plafond d'essais | **3** (configurable à la création) | « 3 strikes → mort crypto ». |
| Passphrase | **générée par le système, forte** (≥ ~60 bits, ex. 4-5 mots) | Défense en profondeur contre le scénario breach (§4). L'humain ne choisit jamais. |

---

## 2. Schéma de clé GELÉ — où vit chaque octet

| Donnée | Où | Le serveur la voit ? |
|---|---|---|
| **Clair** du secret | nulle part de façon persistante (RAM client uniquement, le temps de l'affichage) | ❌ **JAMAIS** |
| **Passphrase** | transmise hors-bande créateur→destinataire ; en RAM client le temps de l'aveuglement | ❌ **JAMAIS** (aveuglée avant tout envoi) |
| **Sortie OPRF** (`y`, 32 o) | RAM client uniquement, jetée après dérivation | ❌ jamais |
| **Clé AES-256** | dérivée en RAM client via `HKDF(y)`, non-extractible (`extractable:false`), jamais sérialisée | ❌ jamais |
| **Chiffré** (`ciphertext` + `iv`) | **R2** `sec/<id>` | ✅ (inexploitable seul) |
| **Clé privée OPRF** (`k`, 32 o) | **D1**, **chiffrée au repos** sous une clé maître Worker (env secret), pas en clair | ✅ chiffrée (cf. §4) |
| **Clé publique OPRF** (`pub`, 33 o) | **D1** (servie au client pour la preuve DLEQ) | ✅ publique par nature |
| **Compteur d'essais / statut / expiration** | **D1** | ✅ |

> **Invariant** : avec **seulement** ce que stocke le serveur (chiffré + clé OPRF), on **ne peut pas** dériver la clé AES sans la passphrase. Et avec la passphrase mais sans la clé OPRF (détruite), **non plus**. Les deux sont nécessaires, et la clé OPRF s'autodétruit.

---

## 3. Protocole (gelé)

### Création (côté créateur, navigateur)
1. Serveur génère une paire OPRF par-secret : `k = randomPrivateKey()`, `pub = generatePublicKey(k)`.
2. Client : `y = VOPRF.finalize(blind(passphrase) → serveur.blindEvaluate(k) → unblind)`.  *(la création ne décompte pas d'essai de lecture)*
3. Client : `aesKey = HKDF(y)` ; `iv = random(12)` ; `ciphertext = AES-GCM-encrypt(aesKey, iv, clair)`.
4. Client envoie au serveur **uniquement** `ciphertext` + `iv`. Serveur persiste `{ciphertext, iv, k(chiffré au repos), pub, attempts:0, max:3, expires_at, status:'scellé'}`.
5. Le créateur transmet la **passphrase hors-bande** (canal indépendant, pas SMS seul).

### Lecture (côté destinataire, navigateur, page `/s/:id`)
1. Saisie de la passphrase.
2. Client aveugle → `POST /s/:id/eval` → **serveur compte (`attempts++`), rate-limite, évalue avec `k`** → client dé-aveugle → `y'`.
3. Client : `aesKey' = HKDF(y')` ; récupère `ciphertext` (`GET /s/:id/blob`, `no-store`) ; `AES-GCM-decrypt`.
   - **Bon code** : `y' = y` → déchiffrement OK → affichage **une fois** → `DELETE` (burn : suppression `ciphertext` + `k`).
   - **Mauvais code** : tag GCM rejeté → le client sait que c'est faux ; le serveur, lui, a **déjà compté** (oblivious : il ne sait pas que c'était faux).
4. **Au `max`ᵉ eval** : serveur **détruit `k`** (`status:'détruit'`). Toute eval ultérieure → `SECRET_MORT`. Plus aucun déchiffrement possible, **même avec le bon code**.

> **Séparation `eval` / `blob`** : le chiffré (`blob`) est librement récupérable (inexploitable sans `y`). L'opération **comptée et rare** est l'**eval** OPRF. « Lu une fois » = burn happy-path après succès ; la **garantie dure** = plafond d'eval qui tue `k`.

---

## 4. Analyse de menace (ce que le spike a révélé)

**Opération normale (serveur honnête, non breaché)** — le plus important :
- Le brute-force est **impossible hors-ligne** : dériver la clé AES exige une eval OPRF, qui **passe obligatoirement par le serveur** (qui détient `k`). Donc chaque tentative = 1 round-trip **compté**, plafonné à 3 → mort. **Même une passphrase faible serait protégée.** C'est la supériorité de l'OPRF sur un simple `passphrase + KDF` (toujours cassable hors-ligne sur vol du chiffré).

**Scénario breach (attaquant vole D1 + R2)** :
- S'il obtient `k` en clair **et** le chiffré, il peut évaluer le PRF **hors-ligne** (il a la clé) → brute-force hors-ligne → protégé alors **uniquement par l'entropie de la passphrase**. → D'où **(a)** passphrase **forte générée** (§1), **(b)** `k` **chiffré au repos** sous une clé maître dans un **env secret Worker** (pas en D1) : un dump D1 seul ne donne pas `k` utilisable — il faut D1 **+** le secret Worker.

**Limites assumées (à afficher, jamais survendre)** :
- **E2E web structurel** : le serveur sert le JS de déchiffrement à chaque visite → un serveur compromis/contraint pourrait pousser du JS malveillant. Mitigations : dépendances minimales + **SRI** + CSP refermée. Jamais « inviolable ».
- **Endpoints** : écran/appareil du destinataire compromis (malware, capture, regard) → aucune crypto ne corrige.
- **Canal de la passphrase** : SIM swap si SMS seul → canal indépendant recommandé.
- **Pas de récupération** : passphrase perdue = secret perdu. Par conception.

---

## 5. Contrats d'API à implémenter en S1 (dérivés de cette spec)

- `POST /api/sceau` (JWT) — `{ciphertext, iv, pub, max?, expires_at?}` → `{short_id}`. *(le serveur génère `k` AVANT, le renvoie au client pour l'eval de création, puis le persiste chiffré ; à figer en S1 : générer `k` côté serveur et exposer une eval de création comptée hors-quota.)*
- `POST /s/:id/eval` (public) — `{blindedElement}` → `{evaluation, proof}` | `410 SECRET_MORT`. **Compté + rate-limité + détruit `k` au plafond.**
- `GET /s/:id/blob` (public) — `{ciphertext, iv, pub}` (`Cache-Control: no-store`). 410 si détruit.
- `DELETE /api/sceau/:id` (JWT) — burn manuel. *(le burn happy-path après lecture réussie peut être un `POST /s/:id/burn` public idempotent.)*

> ⚠ Point ouvert pour S1 (noté, non bloquant) : l'eval de **création** ne doit pas consommer le quota des 3 essais de lecture. Option retenue : compteur de création séparé / création qui pose `attempts:0` après coup (comme le harnais). À verrouiller au câblage.

---

## 6. Reproduire le spike

```bash
cd _cryptolab/sceau && npm install && node harness.mjs
```

Sortie attendue : lecture bon code OK, 3 refus, mort au 3ᵉ, bon code refusé après mort. *(Harnais jetable, hors prod, aucune dépendance avec le code Keystone.)*

---

*Spec gelée 2026-06-29 (S0). Prochain : S1 — backend coffre (D1 `sec_secrets` + R2 + routes ci-dessus). Origine [[SCEAU_BRIEF]].*
