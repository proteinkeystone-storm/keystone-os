# HANDOFF — Refonte Pricing Keystone OS

---

## ⚡ ÉTAT AU 2026-07-25 — LIRE EN PREMIER

**La refonte est EN PRODUCTION et fonctionnelle.** Un client peut acheter une application et ne reçoit qu'elle.

### Fait et déployé
- **P0→P6 complets.** Grille 0/19/49/99/129 · entitlement par application · conversations · Stripe par app · paiement serveur · bascule.
- **Stripe LIVE** : 12 produits / 24 prix créés, webhook réel signé, worker sur la clé live. Les 3 anciens plans sont archivés.
- **Contrôle de possession CÔTÉ SERVEUR** (`workers/src/lib/app-access.js`) — c'était le vrai bloquant.
- Dernier état : SW **v5.28.388**, worker **e1f7fe5f** (le palier gratuit et la suppression du mode démo attendent un déploiement, cf. §2 du reste-à-faire).

### Reste à faire (par ordre de valeur)
1. **Plafonner les conversations** — 🟡 **ARMÉ SUR LA LICENCE TÉMOIN (2026-07-25), pas sur les autres.**
   - `enforce_ai_credits_v1 = 1` sur **`6L2T-R37B-VE9X-RW67`** (sac = Ghost Writer seul → **300 conversations/mois**). Les **3 autres** licences restent à 0 = illimitées.
   - Compteur **semé à 299** (`ai_usage`, mois `2026-07`, tool `ghostwriter`) pour rendre le mur atteignable à la main : 1 réécriture passe, la suivante renvoie **429 `AI_CREDITS_EXHAUSTED`**. ⚠️ **Ligne de test à supprimer après l'essai** — sinon le témoin reste au plafond tout le mois.
   - **Deux affirmations de ce bloc étaient fausses**, corrigées ici : il n'y a **pas 14 licences mais 4** ; et le compteur **ne tournait pas du tout** — `isEnforceEnabled()` garde l'appel à `consumeCredits()`, donc `ai_usage` était vide sur les 4 licences. **Aucun historique de consommation n'existe.**
   - **Défaut trouvé et corrigé en armant** : `/api/ghostwriter/quota` bâtissait son payload **sans quota résolu** → repli sur `quotaForPlan('PRO')` = **1 000**, alors que le mur tombe à **300**. La pastille aurait affiché « 299/1000 » puis bloqué net. Le quota s'y résout désormais comme au débit (`resolveQuota` sur le sac relu). Deux libellés menteurs au passage : « restants **aujourd'hui** » sur un compteur mensuel, et « épuisés **sur le plan PRO** » — un palier que le client n'a pas acheté.
   - ✅ **Mur observé EN RÉEL (25/07)** : `used` s'arrête à **300**, pas 301 — la 301ᵉ a été pré-bumpée puis **revertée**. Le pattern d'atomicité de `consumeCredits()` tient en prod, ce qui n'avait jamais été prouvé hors banc.
   - ✅ **Renommage « crédits » → « conversations » TERMINÉ** (`55c6549`, worker `e1f7fe5f`, SW `v5.28.386`) : les 17 messages qui s'affichent **au moment du mur** (Smart Agent, Brainstorming, Sentinel, Keynapse, Kora + toasts front) ne parlent plus de « crédits IA » et n'annoncent plus « sur le plan `${plan}` ». Section des réglages + doc = « Conversations » ; bouton admin = « Plafond ». Le message du Concierge public était déjà neutre — inchangé.
   - **Reste** : décider de l'ouverture aux autres licences ; **supprimer la ligne `ai_usage` semée** ; tester la sortie de secours « pack » (`addPackCredits`) — préalable direct à P3.
   - ✅ **`activate.html` nettoyé** : la section « Plans & Tarifs » (Start 49 / Pro 99 / Max 249) et ses **3 Payment Links vers des prix archivés** ont été supprimées. Elle était masquée en CSS, donc invisible — mais du markup mort porteur d'URL de paiement n'a aucune raison de survivre. FAQ publique (`index.html` + `faq.html`) alignée sur « conversations », **texte visible ET JSON-LD** (les deux doivent rester identiques mot pour mot).

2. **Palier gratuit LIVRABLE + mode démo SUPPRIMÉ (2026-07-25)** — commits `bcb43b6` + `72f9bd6`.
   - **Le bug visible** : les 3 CTA de la grille renvoyaient en haut de page. Cause réelle : « Commencer gratuitement » et « Voir les applications » pointaient vers `./app.html`, dont la garde fait `location.replace('/?logout=1')` sans JWT. Un visiteur — la cible d'une page de vente — ne pouvait rien faire. Le CTA « OS complet », lui, fonctionnait (session Stripe vérifiée en prod).
   - **`POST /api/licence/free`** (NOUVEAU, `workers/src/routes/licence-free.js`) : e-mail → licence → clé rendue dans la réponse (activation immédiate) + envoyée par e-mail. Idempotent par e-mail, 409 si l'adresse porte déjà un accès payant, 5 créations/IP/24 h.
   - ⚠️ **`owned_assets` est un TABLEAU, jamais `NULL`.** Le sac porte les 3 identifiants gratuits, **dérivés d'`APP_TIER`**. `NULL` = sentinelle « accès TOTAL » → offrirait les 14 apps à chaque visiteur. Banc `scripts/test-licence-free.mjs` (24 tests) qui teste **les deux sens**.
   - ⚠️ **Ne PAS inventer un plan `'FREE'`** : `_devicesMaxForPlan()` renvoie `null` = appareils **ILLIMITÉS** pour tout plan inconnu. On réutilise `technicalPlanFor()` (→ PRO, 3 appareils), la même règle que le chemin Stripe.
   - **Mode démo retiré** : 3 modules (941 lignes), chrono du hero, modales, branches d'onboarding, `startDemo`/`fillDemo`, bypass de binding DEMO, claim `isDemo` du JWT, et le raccourci `DEMO-KEYS-TONE-2026 → ownedAssets:null` de la simulation locale. Deux pièges traités : le bypass d'auto-redirection écoutait `?demo=1` (bascule sur `?free=1`, sinon un visiteur déjà connecté ne voit jamais le formulaire), et **le CTA principal du hero pointait aussi sur `?demo=1`**.
   - **Licence `DEMO-KEYS-TONE-2026` convertie** en gratuite (plan PRO, sac = les 3 gratuites). Elle était `plan=DEMO, owned_assets=NULL` = **accès total**, avec une clé écrite en clair dans `activate.html` — donc publiée et présente dans l'historique git. ⚠️ **Cette ligne s'est modifiée seule pendant la session** (relevée `STARTER / ["O-Keyn-001"]` en début de session, `DEMO / null` deux heures plus tard, même rowid) — origine non élucidée, à surveiller.
3. **Recharge automatique** (sprint P3, jamais commencé) — sans elle, un Smart Agent en mode géré qui épuise son enveloppe **s'arrête net**. Nécessite du paiement Stripe off-session + plafond client. *(« go » obtenu)*
4. **Renommer les 2 packs « conversations »** dans Stripe — cosmétique, pas-à-pas à fournir.
5. **Annuel vs essai 7 jours — DÉCISION EN ATTENTE.** Stéphane hésite. Aucune UI ne permet de choisir mensuel/annuel aujourd'hui (le serveur accepte déjà `interval:'year'`, testé OK) : les « 2 mois offerts » sont donc **invendables**. Argument posé : les 3 apps gratuites à vie font déjà un meilleur essai qu'une période limitée, et un essai sur app payante ferait porter le coût IA d'utilisateurs qui ne paieront jamais.

### Pièges à connaître avant de toucher au code
- **`ks_owned_assets` absent ≠ « rien » : ça veut dire « TOUT ».** Ne jamais l'effacer sur un chemin payant.
- **`ks_user_selection` filtre le tableau de bord** et est synchronisé par le Cloud Vault → une sélection héritée d'une autre licence donne un **dashboard vide**. Réconcilié depuis `2f5ed32`.
- **MAX et ADMIN ouvrent tout le catalogue** côté serveur (garde-fou legacy). Une licence témoin en MAX ne teste rien → utiliser **PRO**.
- **Stéphane ne voit pas ses propres restrictions** (il est ADMIN, son 2e compte est MAX). Tester avec une licence dédiée.
- Le contrôle serveur est **fail-open** : panne D1 → on laisse passer. Volontaire.
- **Le quota affiché doit être résolu comme au débit.** Toute route qui appelle `creditsPayload()` sans passer `quotaOverride` retombe silencieusement sur l'ancien palier du **plan technique** (PRO = 1 000) au lieu du **sac d'apps**. C'était le bug de `/api/ghostwriter/quota`. Le plan technique n'est plus un palier commercial : ne jamais l'afficher au client.

---

> Plan d'exécution. **Aucun code de prod tant que chaque sprint n'est pas validé.**
> Contexte : beta jusqu'à sept. 2026, aucun payeur réel → fenêtre idéale pour restructurer sans migration douloureuse.

---

## 1. La décision (verrouillée)

On abandonne les 3 plans `START / PRO / MAX` (49/99/249) et le modèle « X apps au choix + crédits + sièges » (trois axes de gating illisibles). On passe à un modèle **Adobe-like : gratuit + à la carte par app + OS complet**, différencié par paliers de valeur.

### Grille cible

| Palier | Prix/mois | Applications | Nature |
|---|---|---|---|
| **Gratuit** | 0€ | Missive · booK · Keynapse | Acquisition, coût ~nul (front-only / zéro IA) |
| **Essentiel** | 19€ | Ghost Writer · Brainstorming · Key Form · Key Brand · networK | Ancrés « ChatGPT/Typeform » → porte basse, marge quasi pure |
| **Pro** | 49€ | Brief Prod · Social Manager · Sentinel · Smart QR · **desK** | Remplacent un SaaS payant (Buffer, Semrush…) |
| **Déploiement** | 99€ | Smart Agent | Employé IA client-facing |
| **OS complet** | 129€ | Les 14 apps | Le plafond ; « +30€ depuis Smart Agent = tout » |

> Note : **desK** avait glissé hors d'une liste en cours de discussion — il est bien en **Pro 49€**.
> Total : 3 gratuites + 5 (19€) + 5 (49€) + 1 (99€) = **14 apps**.

### Économie (validée)
- Prélèvement **URSSAF 25,6 % sur le CA** (pas le bénéfice), **pas de TVA** (sous le seuil), **pas d'IR** (non imposable) → **net poche ≈ 72 %** du prix affiché.
- Corollaire vital : l'URSSAF frappant le CA, **les coûts IA ne sont pas déductibles** → toute app gourmande en IA vendue à prix flat travaille à perte. D'où les deux règles d'or ci-dessous.

### Annuel
- Option annuelle = **−2 mois** (×10). Ex. OS = 1 290€/an. Répond au besoin d'**actif récurrent** (cash d'avance + rétention).

---

## 2. Les apps publiques : deux modes (le point le plus délicat)

Smart Agent et le **Concierge de Smart QR** servent le **public** (les clients du client). Leur coût IA scale avec le trafic d'un **tiers** → un prix flat y est structurellement dangereux (scénario « une dizaine d'agents à fond »).

Solution : **deux modes, le client choisit** (côté client c'est une phrase ; toute la mécanique reste en coulisse).

| Mode | Pour qui | Qui paie l'IA | Ce qu'on facture |
|---|---|---|---|
| **Clé en main** (clé Keystone) | Non-techniques | **Toi** (mode géré) | Logiciel + **conversations** (inclus + recharge auto) |
| **BYOK** (clé du client) | Techniques / gros volume | **Le client** (sur sa clé) | Logiciel seul — tu es immunisé au volume |

### Les 3 garde-fous du mode « clé en main » (NON négociables avant ouverture)
1. **Plafond mensuel de recharge auto fixé par le client** — « recharge jusqu'à X€/mois, au-delà l'agent se met en pause ». Protège le client (pic viral) ET toi (hard-stop = jamais servi gratis).
2. **Prix de la conversation > coût réel** (Mistral + voix + long contexte). À **vérifier chiffres en main** avant d'ouvrir le mode géré sur une app publique.
3. **La voix consomme des conversations** — aujourd'hui Whisper/Piper ne débitent RIEN (angle mort). En mode géré, ça doit compter.

> Tant que ces 3 points ne sont pas en place, une app publique ne s'ouvre **qu'en BYOK**.

---

## 3. Conversations & recharges

- **Renommage client-facing : « crédits » → « conversations ».** Humain, honnête.
- **Les apps BYOK ne consomment aucune conversation** (clé du client). Les recharges ne touchent que l'IA incluse et bornée → **filet anti-mur, pas un business**.
- **Conversations incluses par palier** (à figer — généreux, l'IA incluse coûte des centimes) :

| Palier | Conversations incluses/mois |
|---|---|
| 19€ (une app) | ~300 |
| 49€ (une app) | ~1 000 |
| 99€ Smart Agent | ∞ en **BYOK** · **1 000 incluses** en mode géré, puis recharge auto plafonnée |
| 129€ OS | ~3 000 en pot commun |

### Coût réel d'une conversation (mesuré sur le barème Cloudflare, 22/07/2026)
- €/neurone = 0,011 $/1 000 × 0,92 ≈ **0,0000101 €**. Mistral Small 3.1 24B = 31 876 neurones/M in · 50 488/M out. Whisper = 46,63 neurones/**minute** d'audio.
- Conversation RAG typique (~3 000 in + 400 out) ≈ **0,12 centime**. Pire cas (gros contexte + voix 1 min) ≈ **0,3 centime**. **La voix n'ajoute quasi rien** — le coût, c'est la complétion Mistral.
- Chargé (Vectorize, D1, R2, Piper, Stripe, pot commun global) ≈ **0,6-0,8 centime/conversation**.

- **Packs : on garde les 2 tels quels** — 1 000 = 9€ (0,9 ¢/conv), 5 000 = 39€ (0,78 ¢/conv). Analyse : **déjà « coût réel + petite marge »**. On ne baisse PAS (plancher = commission Stripe fixe 0,25€ → un pack < 5€ est mangé par les frais). On les renomme juste « conversations ». Pas de 3ᵉ pack — simplicité (leçon Claude).
- **Garde-fou #2 VALIDÉ** : worst-case chargé (~0,6 ¢) < prix pack (~0,8 ¢) → marge positive même sur conversation vocale + gros RAG. Le mode géré ne peut pas passer en négatif.
- ⚠ **À mesurer au 1er dogfood** : si une conversation Smart Agent = plusieurs appels Mistral (retries/multi-tour), la compter comme >1 conversation. Le compteur neurones (`ai-budget.js`) permet de lire le coût réel/conversation en prod → ajuster le barème si besoin.
- **Nouveau : recharge auto** (opt-in, OFF par défaut) façon auto-reload API Anthropic : « recharge quand il reste moins de N conversations », dans la limite du **plafond client**.
- **Jamais d'expiration** (déjà le cas : solde de packs persistant). On garde.

---

## 4. État actuel du code (point de départ)

| Brique | Aujourd'hui | Fichier |
|---|---|---|
| Cartes de plans (Key Store) | 3 objets `START/PRO/MAX` + `stripeUrl` en dur | `app/ui-renderer.js` (~L890-940) |
| Prix par app | `price` + `lifetimePrice:199` sur chaque entrée | `app/pads-data.js` (`CATALOG_DATA`) |
| Rangement K-Store | mock catalog (catégories `KS_`) | `app/kstore-mock-catalog.js` |
| Quota IA | `quotaForPlan()` : Demo20/Starter200/Pro1000/Max5000 | `workers/src/lib/ai-credits.js` |
| Barème conso | `COST` : 1/action ; enforcement **DORMANT** (`enforce_ai_credits_v1=0`) | `workers/src/lib/ai-credits.js` |
| Packs crédits | `900→1000`, `3900→5000`, `addPackCredits` | `app/ui-renderer.js` (`PACK_*_URL`) + `stripe-webhook.js` |
| Webhook Stripe | `checkout.completed` → génère+envoie clé ; `sub.updated/deleted` | `workers/src/routes/stripe-webhook.js` |
| Mapping prix→plan | `4900/9900/24900 → STARTER/PRO/MAX` (+ `lookup_key`) | `stripe-webhook.js` (L24-63) |
| Licence | **UN plan unique** par licence, MAIS `owned_assets` (tableau d'ids d'apps) existe DÉJÀ à côté | `workers/src/routes/licence-v2.js` |
| Admin — onglet Contenu | Table éditable : colonnes **Plan** (STARTER/PRO/MAX select) · **Prix** · **Lifetime** · Publié · Nouveau · Fiche | `app/admin.js` (~L1938-1971) |
| Admin — onglet Licences | Éditeur licence avec select **STARTER/PRO/MAX** + champ `ownedAssets` déjà présent | `app/admin.js` (~L631-714) |

**Le verrou architectural** : la licence porte *un plan*, pas *un sac d'apps* — MAIS `owned_assets` existe déjà (P1 allégé). Tout le reste en découle.

---

## 5. Les écarts à combler (par surface)

- **A. Modèle d'entitlement** : licence `plan unique` → **licence possède un ensemble d'apps** (+ drapeau `OS`). C'est le cœur.
- **B. Conversations** : `quotaForPlan(plan)` → `quotaFor(entitlements)` ; renommage UI ; métrage voix ; enforcement à activer proprement.
- **C. Recharge auto** : nouvelle capacité Stripe **off-session** (carte enregistrée + `PaymentIntent` off-session + gestion SCA/3DS) + plafond client + consentement.
- **D. Deux modes** : toggle `géré / BYOK` par app publique ; enforcement des 3 garde-fous en mode géré.
- **E. Stripe** : nouveaux produits/prix (per-app + OS, mensuel + annuel) ; nouveaux mappings webhook (produit/prix → **app**, plus « plan ») ; retrait des 3 plans + reframe des 2 packs ; portail.
- **F. Vitrine** : Landing (réécriture de **positionnement**, pas un swap de chiffres) + Key Store (cartes + prix par app + suppression du `lifetimePrice`).
- **G. Admin (5ᵉ surface, pilotée par Stéphane)** :
  - *Onglet Contenu* : retirer colonnes **Plan** + **Lifetime** ; le prix porte le palier ; ajouter sélecteur **Mode** (géré/BYOK) sur apps publiques + éventuel **ID produit Stripe** par app ; masquer/replier les apps déposées (VEFA).
  - *Onglet Licences* : remplacer le select STARTER/PRO/MAX par une gestion **d'apps possédées** (`owned_assets`, déjà là) + drapeau **OS**.
  - ⚠ Les prix déjà édités à la main dans l'admin sont **affichage seul** tant que Stripe (P4) n'est pas refait → risque de prix affiché ≠ prélevé.

---

## 6. Découpage en sprints

> Principe : **le moins risqué d'abord, la facturation prod en dernier.** Tout se construit **derrière un flag** (`PRICING_V2`, pattern `BYOK_ROUTING`) et se bascule **atomiquement** en fin de parcours — car afficher « 19€ » pendant que Stripe prélève « 49€ » est interdit.

### Sprint P0 — Cadrage & décisions figées *(ce doc + choix)*
- **But** : verrouiller tout ce qui bloque le code.
- **Livrables** : grille + mapping app→palier (fait) ; conversations incluses (valider les nombres) ; tailles/prix des 2 packs re-vérifiés au coût réel ; % annuel ; **structure des produits Stripe** (cf. §7, décision A) ; valeur des plafonds de recharge par défaut.
- **Code** : aucun.
- **DoD** : chaque nombre de la §1 et §3 est arrêté ; §7 décision A tranchée.

### Sprint P1 — Modèle d'entitlement per-app *(backend, invisible)* — ✅ FAIT (2026-07-23)

**Livré :**
- **`app/lib/pricing.js`** (NOUVEAU) — la source de vérité unique : paliers + prix, rangement des 14 apps, conversations incluses, packs, annuel, surfaces publiques (`PUBLIC_SURFACE_APPS`), sentinelle `OS_ENTITLEMENT`, flag `isPricingV2()` (OFF par défaut, override `localStorage.ks_pricing_v2`), et `resolveEntitlements()` / `hasOsAccess()`.
- **`app/pads-loader.js`** — `getOwnedIds()` délègue désormais la résolution à `resolveEntitlements()`. Honore la sentinelle `'OS'` ; sous flag ON, ouvre toujours les apps gratuites. Flag OFF = comportement actuel à l'identique.
- **`app/admin.js`** — onglet Licences : le champ texte « IDs séparés par des virgules » est remplacé par un **sélecteur d'apps à cases à cocher groupées par palier** (création + édition), avec **3 états d'accès explicites** : `OS complet` · `Applications sélectionnées` · `Non défini (historique)`. Le select `Plan` est **conservé** mais relabellisé « technique » — il pilote toujours `devices_max` et les invitations membres, il ne décide plus des apps. Préchargement du catalogue pour afficher les vrais titres.
- **`scripts/test-pricing-entitlements.mjs`** (NOUVEAU) — **49 tests, 49 ok**. Ajouté à `npm test` (+ alias `npm run test:pricing`).

**Décision d'architecture** : l'OS complet est une **sentinelle `'OS'` rangée dans `owned_assets`** → **zéro changement de schéma D1**, transite tel quel par `/api/licence/activate`.

**Vérifié** : 49/49 au banc · `npm test` exit 0 (aucune régression) · module chargé en vrai navigateur (prix et résolution corrects) · `admin.html` charge sans erreur console.
**Non vérifié** : le rendu visuel du sélecteur (derrière le login admin — à regarder d'un coup d'œil à la prochaine connexion).

<details><summary>Cadrage initial (pour mémoire)</summary>
- **But** : une licence possède un **ensemble d'apps** (+ `OS`), sans rien casser.
- **Scope** : réutiliser/étendre `owned_assets` (déjà présent) comme source d'entitlement ; `getOwnedIds()` lit les entitlements ; drapeau **OS** = toutes ; **compat legacy** : un plan `STARTER/PRO/MAX` existant est traduit en set d'apps équivalent (additif, zéro régression). **Admin onglet Licences** : remplacer le select plan par la gestion d'apps possédées + OS. Derrière `PRICING_V2`.
- **Dépend de** : P0.
- **Risque** : moyen (touche les licences, mais additif) — allégé par `owned_assets` préexistant.
- **DoD** : une licence de test possède `{A-COM-005, O-DSK-001}` et n'ouvre QUE ces apps ; l'admin permet de cocher les apps ; les licences legacy restent intactes. → **atteint, prouvé par le banc (suites 2, 3, 4).**
</details>

### Sprint P2 — Conversations & enforcement *(backend + UI compteur)* — ✅ FAIT (2026-07-23)

**Livré :**
- **`workers/src/lib/pricing-grid.js`** (NOUVEAU) — miroir worker de la grille (les bundles front/worker sont séparés). `quotaForEntitlements()` + flag `isPricingV2(env)` (var d'env `PRICING_V2`, pattern `BYOK_ROUTING`). **Filet anti-dérive** : le banc importe les DEUX modules et compare paliers/prix/rangement → toucher l'un sans l'autre casse `npm test`.
- **`workers/src/lib/ai-credits.js`** — `resolveQuota()` = **point unique** d'arbitrage legacy ↔ per-app. `resolveLicenceByHmac()` (plan + sac). `consumeCredits()` accepte un **coût explicite** et **résout le sac lui-même** depuis `bucketKey` → **les 13 sites d'appel n'ont pas eu à bouger** (et la requête D1 en plus n'est payée que si le flag est ON). Unité renommée `'conversations'` ; **noms de champs inchangés** (le front en dépend).
- **`workers/src/routes/kora.js`** — **l'angle mort voix est bouché** : `/api/kora/stt` débitait *rien*. Débit = `costForAudioSeconds()` = **1 conversation par minute d'audio entamée**, au plus près du barème Cloudflare (Whisper se facture à la minute). Débit APRÈS transcription (la durée n'est connue qu'après) ; portefeuille vide → 429 et `consumeCredits` annule son propre bump.
- **`workers/src/routes/keynapse.js`** + **`routes/ai-credits.js`** — quota per-app branché.
- **Front** — « crédits » → « conversations » dans l'UI visible (jauge, réglages, doc, Brainstorming, Kora, codex).
- **Banc** — **76 tests, 76 ok** (suites 7-8-9 : anti-dérive, quota par sac, coût voix).

**Découverte qui CORRIGE une hypothèse du plan** : le **garde-fou #3 était surdimensionné**. Smart Agent — **y compris son agent public** — utilise `SpeechRecognition` (API navigateur) et **Piper en WASM local** : **coût Cloudflare NUL**. Seuls Kora (talkie-walkie) et Keynapse (mémos) transcrivent côté serveur, et ce sont des usages **du propriétaire**, pas du trafic public. **La surface publique ne génère aucun coût voix.** Keynapse, par ailleurs, **débitait déjà** (transcription + extraction) : le seul vrai trou était Kora.

**Vérifié** : 76/76 au banc · `npm test` exit 0 · `wrangler deploy --dry-run` bundle OK (grille présente) · 6 modules front chargés en vrai navigateur.
**Non vérifié** : le débit réel en conditions live (nécessite d'activer `enforce_ai_credits_v1` sur une licence test → à faire avec un « go », cf. §9 bis).

<details><summary>Cadrage initial (pour mémoire)</summary>
- **But** : compteur propre, généreux, honnête ; voix comptée.
- **Scope** : `quotaFor(entitlements)` remplace `quotaForPlan` ; renommage « crédits → conversations » (UI + `/api/ai-credits/quota`) ; **métrage voix** (Whisper/Piper → conversations) ; activation contrôlée de `enforce_ai_credits_v1` (licence par licence d'abord).
- **Dépend de** : P1.
- **Risque** : moyen (l'enforcement peut brider par erreur → activer progressivement).
- **DoD** : une conversation vocale débite ; le mur se déclenche au bon seuil sur une licence test ; les autres restent illimitées. → **mécanisme livré et prouvé au banc ; l'activation réelle reste à faire (§9 bis).**
</details>

### 9 bis. Keynapse — « Gratuit, cœur seul » ✅ TRANCHÉ (2026-07-23)

**Constat vérifié dans le code** : le **cœur** de Keynapse (bulles, canevas, zones, liens, captures, rappels) n'utilise **aucune IA** → gratuit sans réserve. Mais la **dictée** en utilise **deux** : `app/keynapse.js:796` poste l'audio → `workers/src/routes/keynapse.js:685` (**Whisper**, transcription) puis `:621` (**Mistral**, extraction tâches/rappels). Soit 2 appels IA par mémo, déjà débités avant P2 (`tool:'keynapse'`).

**Décision : « Gratuit, cœur seul — la dictée exige une application payante. »**
Une licence 100 % gratuite ne déclenche donc **strictement aucun coût**, ce qui est toute l'idée du palier gratuit. Le palier FREE reste à **0 conversation** (cohérent).

**Implémenté** : `hasPaidApp({plan, ownedAssets})` dans les DEUX modules (front + miroir worker, couvert par le test anti-dérive). Gate serveur dans `handleVoiceUpload` — **la promesse de la route est respectée : l'audio est déjà en R2 et reste écoutable**, seule la transcription est refusée, avec un message clair (`code: AI_REQUIRES_PAID_APP`) que le front affiche déjà. Dormant tant que `PRICING_V2` est OFF. Permissif sur le legacy (sac null, MAX, ADMIN → autorisé) : on ne retire jamais un accès existant par surprise.

**Reste à faire en P5** : masquer/griser le bouton micro côté front pour une licence gratuite (aujourd'hui le clic part et revient avec le message — correct, mais moins élégant qu'un bouton qui explique d'emblée).

### Sprint P3 — Recharge auto + plafond *(Stripe off-session)*
- **But** : le mode géré ne coupe jamais un agent, sans jamais te faire payer le volume.
- **Scope** : enregistrement carte (`SetupIntent`) ; charge **off-session** au seuil bas ; **plafond mensuel client** + hard-stop au-delà ; écran de consentement ; garde-fou « prix conversation > coût réel » (calcul + alerte).
- **Dépend de** : P2 + P4 (produits Stripe « pack »).
- **Risque** : **élevé** (mouvement d'argent, SCA/3DS off-session, chargebacks si consentement flou).
- **DoD** : en test Stripe, une licence à court de conversations est rechargée auto, s'arrête net au plafond, avec trace de consentement.

### Sprint P4 — Restructuration Stripe — ✅ CODE FAIT (2026-07-24) · produits Stripe à créer par Stéphane

**Livré (code) :**
- **`workers/src/lib/stripe-catalog.js`** (NOUVEAU) — traduction « ce qui a été payé » → « ce qui est ouvert ». `resolveAppFromPrice()` (metadata price → metadata produit → convention `lookup_key`), `resolveLegacyPlanFromPrice()`, `resolvePackConversations()`, `addEntitlement()` / `removeEntitlement()`, `technicalPlanFor()`, `stripeCatalogPlan()`.
- **`workers/src/routes/stripe-webhook.js`** — table **`licence_subscriptions`** (auto-migration) : une licence peut désormais porter **N abonnements** (une app = un abonnement), là où `licences.stripe_subscription_id` était unique. Achat → licence trouvée ou créée, app **ajoutée au sac**. Résiliation → **l'app est retirée, la licence n'est fermée que si le sac se vide**. Changement de price (app → OS) → échange du droit. Packs branchés sur le catalogue partagé.
- **`scripts/test-stripe-catalog.mjs`** — **51 tests, 51 ok** (`npm run test:stripe`, inclus dans `npm test`).
- **`scripts/stripe-catalog-plan.mjs`** — imprime l'inventaire exact à créer (`npm run stripe:plan`).

**LA découverte de P4 — le repli par montant est MORT.** Avant, un price sans `lookup_key` se résolvait par son montant (4900 → STARTER). Impossible désormais : **cinq apps coûtent 19 €, cinq autres 49 €** — le montant ne dit plus *laquelle*. Deviner ouvrirait la mauvaise application. La résolution devient donc **explicite et obligatoire** (`metadata.ks_app`), et le webhook **refuse d'accorder quoi que ce soit** s'il ne sait pas (il journalise). Le repli par montant survit **uniquement** pour les 3 anciens plans, dont les prix restent non ambigus.

**Auto-gating par la donnée (pas de flag)** : le chemin per-app ne s'ouvre que si le price porte `ks_app`. Les anciens prix n'en ont pas → ils passent par le legacy. **Aucun abonnement existant ne change de nature**, et le nouveau modèle se teste en Stripe test mode sans rien basculer.

**Vérifié** : 51/51 · `npm test` exit 0 · `wrangler deploy --dry-run` OK (table + résolution présentes dans le bundle).
**Non vérifié** : aucun échange réel avec Stripe (aucun produit ne porte encore `ks_app`).

**Reste à faire — action Stéphane (hors code) :**
1. `npm run stripe:plan` → créer les **12 produits / 24 prix** en **mode TEST**, chacun avec `metadata.ks_app`.
2. Rejouer en test : achat d'1 app · achat d'une 2ᵉ app (même client → **une seule clé**, sac qui s'agrandit) · résiliation d'une seule app · passage app → OS · achat d'un pack.
3. Renommer les 2 packs en « conversations » (barème inchangé).
4. **Archiver** (jamais supprimer) START/PRO/MAX.
5. Puis seulement : refaire en LIVE, et P5/P6.

<details><summary>Cadrage initial (pour mémoire)</summary>
- **But** : Stripe reflète le per-app + OS + packs, sans casser l'existant.
- **Scope** : cf. §7 en détail.
- **Dépend de** : P0 (décision A), P1 (entitlements cibles du webhook).
- **Risque** : **élevé** (facturation prod).
- **DoD** : en **test mode**, l'achat d'une app crée l'entitlement correspondant ; l'OS ouvre tout ; l'annulation révoque ; un pack crédite ; les anciens abos (s'il y en a) continuent de résoudre. → **logique prouvée au banc (51/51) ; validation en test mode en attente des produits Stripe.**
</details>

### Sprint P5 — EN COURS (2026-07-24/25)

**Décision : option B — un endpoint qui fabrique la page de paiement**, plutôt que 24 liens de paiement figés. Raison décisive : un lien statique ignore QUI clique ; l'endpoint, lui, transmet `client_reference_id` = l'identifiant de la licence, ce qui permet à un client qui possède déjà une app d'en acheter une seconde **sans recevoir une deuxième clé** (le cas codé en P4).

**Livré :**
- **`workers/src/routes/stripe-checkout.js`** (NOUVEAU) — `POST /api/stripe/checkout {app, interval}` → `{url}`. Prix identifié par `lookup_key` (jamais par montant). Accessible **sans connexion** (on vend aussi aux visiteurs ; le webhook créera la licence depuis l'e-mail). Le client ne choisit jamais un prix — il nomme une app, le serveur choisit le tarif.
- **`workers/src/index.js`** — route câblée.
- **`workers/src/routes/stripe-webhook.js`** — `_findLicenceForCustomer` privilégie désormais `client_reference_id` (exact) avant le client Stripe puis l'e-mail.
- **`app/lib/checkout.js`** (NOUVEAU) — appel + redirection, messages d'erreur lisibles.
- **`app/ui-renderer.js`** — le bouton « Obtenir » du K-Store ouvre le paiement pour une app **payante non possédée** (gratuites : accès direct). **Flag OFF ⇒ comportement beta intact.**
- **`app/admin.js`** — colonnes **Plan** et **Lifetime** supprimées (paliers morts, vente à vie abandonnée) ; colonne **Tarif** en **lecture seule**, dérivée de `lib/pricing.js`. Motif : « Prix » était éditable alors qu'il ne pilotait **rien** chez Stripe — un champ modifiable laissait croire l'inverse.

**Vérifié** : `npm test` exit 0 · bundle worker OK (route présente) · 4 modules front chargés en navigateur (aucun import circulaire) · cellule Tarif contrôlée sur 5 cas (dont une app retirée → « — »).
**Non vérifié** : aucun achat réel (nécessite le webhook en mode test, cf. reste à faire).

**Reste pour clore P5 :**
- Refonte de la **Landing** (récit « gratuit + à la carte + OS », remplacement des 3 cartes START/PRO/MAX).
- Choix mensuel/annuel dans l'UI (l'endpoint accepte déjà `interval`).
- Bouton micro Keynapse grisé pour une licence gratuite (cf. §9 bis).

<details><summary>Cadrage initial (pour mémoire)</summary>
- **But** : le récit, les cartes ET l'outil d'édition passent au nouveau modèle, câblés au nouveau checkout.
- **Scope** : Landing = **réécriture de positionnement** (« gratuit + à la carte + OS », ancrage « une pile → un OS ») ; Key Store = cartes de paliers + prix par app (`pads-data.js`) + **suppression `lifetimePrice`** ; boutons → nouveaux liens/checkout ; toggle mode (géré/BYOK) sur les fiches d'apps publiques. **Admin onglet Contenu** : retirer colonnes Plan + Lifetime ; ajouter Mode + ID produit Stripe par app ; masquer les apps VEFA déposées.
- **Dépend de** : P3, P4.
- **Risque** : faible (affichage), mais **doit rester derrière le flag** jusqu'à la bascule.
- **DoD** : en preview, la grille s'affiche, chaque bouton pointe vers le bon prix Stripe test ; l'admin édite prix + mode sans colonnes mortes. → **admin fait ; bouton d'achat câblé ; landing restante.**
</details>

### Sprint P6 — Bascule & vérif
- **But** : go-live coordonné.
- **Scope** : passage Stripe test → live ; flip `PRICING_V2` ON ; **bump SW** ; smoke tests (achat app, OS, pack, recharge auto, mode BYOK vs géré) ; retrait des 3 anciens Payment Links de l'UI ; archivage des anciens prix Stripe.
- **Dépend de** : tout.
- **Risque** : élevé (moment de vérité) → fenêtre calme, rollback flag prêt.
- **DoD** : un achat réel bout-en-bout fonctionne ; les 3 clients de septembre peuvent souscrire.

---

## 7. Stripe en détail (état actuel → cible)

### Aujourd'hui
- **3 abonnements** : Payment Links, mappés `4900/9900/24900 → STARTER/PRO/MAX` (montant) ou `lookup_key ks_starter/pro/max`. Webhook : 1er paiement → **génère + envoie une clé de licence**.
- **2 recharges** : paiements uniques `900/3900 → 1000/5000 crédits` (`PACK_AMOUNT_TO_CREDITS`, `addPackCredits`).
- **Événements gérés** : `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`.

### Décision A à trancher (P0) — structure des produits
- **Option 1 — un prix Stripe par palier** (19/49/99/129) + l'**app en metadata** du checkout. Peu d'objets Stripe, mais le webhook doit lire la metadata pour savoir *quelle* app créditer.
- **Option 2 — un produit Stripe par app** (14 produits, chacun son prix) + un produit « OS ». Mapping webhook **produit → app** limpide, plus d'objets à gérer.
- **Reco** : **Option 2** (clarté d'entitlement, webhook trivial, évolutif). À confirmer.

### Cible
- **Produits/prix** : par app (au prix de son palier) × {mensuel, annuel} + **OS** × {mensuel, annuel} + **2 packs** conversations (+ capacité recharge auto).
- **Webhook** : `PRICE_*_TO_PLAN` → **`PRODUCT_TO_APP` / `PRICE_TO_APP`** qui écrit un **entitlement** (P1), pas un plan. `OS` → drapeau « toutes ».
- **Cycle de vie** : `sub.deleted` révoque l'entitlement de CETTE app (pas toute la licence) ; upgrade « app → OS » via portail ou nouveau checkout.

### Migration des 3 plans actuels
- Beta = **aucun (ou quasi) abonné réel** → risque bas. Procédure :
  1. **Ne pas supprimer** les anciens prix Stripe : les **archiver** (continuité de tout abo existant).
  2. **Garder le fallback montant** `4900/9900/24900` dans le webhook tant qu'un abo legacy vit.
  3. Retirer les 3 Payment Links de l'UI (P5).
  4. Migrer manuellement l'éventuel abonné réel (ou via portail) vers le nouveau modèle.

### Migration des 2 recharges
- **Conserver** les 2 packs, **reframe « conversations »**, **re-vérifier le prix vs coût réel** (surtout : elles alimenteront désormais le **mode géré des apps publiques**, plus gourmand). Ajouter la **recharge auto** (off-session) à côté du pack manuel.

---

## 8. Risques & garde-fous transverses

- **Ne jamais afficher un prix décorrélé du prélèvement réel** → tout derrière `PRICING_V2`, bascule atomique (P6). ⚠ Cas déjà présent : des prix ont été édités à la main dans l'admin (affichage) alors que Stripe prélève encore les anciens montants — sans dommage en beta, mais à résoudre en P4/P6.
- **Mode géré sur app publique = interdit avant les 3 garde-fous** (§2). Sinon retour du scénario « agents à fond » — cette fois sans BYOK pour sauver.
- **Vérifier `prix conversation > coût réel` voix comprise** avant P3/P6 (le seul calcul qui peut faire travailler à perte).
- **PWA cache-first** : toute mise en prod front = `npm run bump-sw` (sinon les users installés ne voient rien).
- **Facturation = prod critique** : P4/P6 uniquement après « go » explicite, fenêtre calme, rollback prêt.
- **Key Form / apps prod** : ne rien déployer de non vérifié dessus (priorité prod absolue).

---

## 9. Décisions P0 — TRANCHÉES (2026-07-23)

1. **Conversations incluses** : ✅ **300 / 1 000 / 3 000** confirmé. Smart Agent géré = **1 000 incluses** puis recharge auto.
2. **Packs** : ✅ **garder 9€/39€** (renommés « conversations »). Coût réel mesuré (~0,1-0,3 ¢/conv voix comprise, ~0,6-0,8 ¢ chargé) → packs déjà « coût + petite marge », baisser n'a pas de sens (plancher Stripe). Garde-fou #2 validé. Cf. §3.
3. **% annuel** : ✅ **−2 mois** (×10).
4. **Structure Stripe** : ✅ **un produit par app** (Option 2).
5. **Plafond recharge auto par défaut** : ✅ **20€/mois** proposé au client.
6. **desK** : ✅ **Pro 49€**.

**→ P0 CLOS. Prochaine étape : P1 (entitlement per-app, backend, invisible) sur « go » de Stéphane.**
```
