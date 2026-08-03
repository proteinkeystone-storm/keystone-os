# 🛰️ SENTINEL — Brief consolidé

> **Pad Keystone : audit web complet AVEC suivi dans le temps.**
> Document de cadrage = **source de vérité** avant développement. Reprend toutes les décisions actées en phase de discussion (2026-06-18).
> À lire avec [[MANIFESTE_NOUVELLE_APP]] (architecture, câblage exact, déploiement, métrage IA).
>
> **Nom : Sentinel · ID_KSTORE : `O-GEO-001` · catégorie : WEB.**

---

## 0. En une phrase

Sentinel est un **centre de contrôle** qui surveille en continu les sites web des clients, les **note**, détecte ce qui cloche, et livre des **correctifs clé en main** (code prêt à coller, ou délégable au webmaster) — **souverain**, **multi-plateforme**, et augmenté à la **visibilité dans les IA génératives (GEO)**.

---

## 1. Pourquoi — la place dans la gamme

- La gamme Keystone est aujourd'hui **entièrement « one-shot / amont »** (créer, diffuser, collecter). **Aucun outil de veille dans le temps.** Sentinel comble ce trou → forte **rétention** (on y revient chaque semaine voir la courbe).
- Hérite des **intuitions** de Protein SEO (essai personnel, **0 abonnement, abandonné**) mais le **refonde** :
  - **Souverain** (on jette la dépendance à Google PageSpeed).
  - **Continu** (on jette l'audit mensuel-anniversaire seul).
  - **Multi-plateforme** (pas uniquement Wix).
  - **Augmenté IA générative** (le GEO).
  - **On jette aussi** : le plan 12 mois à tokens, le Stripe séparé.
- La vision « Sentinel Engine » figure déjà dans `CLAUDE.md` (Sprint C).

---

## 2. Cible & persona

- **Cible** : agences / indépendants / TPE qui gèrent un ou plusieurs sites — **Wix Studio, WordPress, sur-mesure**.
- **Persona clé : l'utilisateur NOVICE en code** (comme Stéphane). → Le **« clé en main » est le fil rouge n°1** : on donne le code et les étapes exactes, jamais « débrouille-toi ». L'outil fait le repérage à la place de l'utilisateur.

---

## 3. Les deux piliers différenciants (killer features)

### Pilier A — GEO : la visibilité dans les IA génératives
En 2026, la moitié des prospects ne demandent plus à Google mais à **ChatGPT / Perplexity / Gemini / Google AI Overviews**. La vraie question d'un commerçant : *« quand on demande à une IA le meilleur X dans ma ville, est-ce que je sors ? »*. **Personne ne mesure ça pour les TPE.** Keystone a déjà le **moteur multi-LLM (`callLLM`, BYOK)** pour le faire → avantage unique. Et Sentinel ne fait pas que mesurer le GEO : il **génère lui-même le correctif AEO** — c'est l'IA rédactionnel de S4.1 (« Rédiger avec l'IA » : FAQ structurée Schema.org + méta description), via Workers AI/BYOK. ⚠ RIEN à voir avec le pad **Smart Agent** (qui est un agent *dialogueur* à personas, pas un générateur de contenu SEO).

### Pilier B — Clé en main + boucle webmaster
Une **boucle fermée** : **Détecte → Prescris → Transmets → Vérifie**.
1. **Détecte** le problème, chiffre son impact sur le score.
2. **Prescris** : fiche actionnable = *quoi · pourquoi (langage clair) · combien ça rapporte · solution exacte* (étape plateforme, code copier-coller, ou asset généré par l'IA).
3. **Transmets** : bouton « Envoyer au webmaster » → email + mini-portail où il coche « fait ».
4. **Vérifie** : l'audit suivant contrôle que c'est appliqué → la reco passe en ✅, le **score remonte**, le client **voit la progression prouvée**.

---

## 4. Périmètre fonctionnel — familles de contrôle (score à 7 axes)

| # | Famille | Mesure | Souveraineté |
|---|---|---|---|
| 1 | **Disponibilité & santé** | uptime %, code HTTP, TTFB, redirections, certificat SSL | 100 % Worker (fetch) |
| 2 | **Performance** | Core Web Vitals (LCP, CLS, INP), poids, nb requêtes, mobile/desktop | Cloudflare Browser Rendering |
| 3 | **SEO technique on-page** | title, meta, Hn, canonical, robots.txt, sitemap, OG/Twitter, alt, liens cassés, données structurées | 100 % parsing HTML |
| 4 | **Mots-clés / positions** | positions réelles, impressions, clics, opportunités | **V2** — via Google Search Console (OAuth) |
| 5 | **Visibilité IA (GEO)** ⭐ | cité ou non par les IA, position, sentiment, score de citabilité | moteurs IA (BYOK/crédits) |
| 6 | **Présence locale** | fiche Google Business, note/avis, cohérence Nom-Adresse-Téléphone | mixte |
| 7 | **Sécurité & conformité** | headers (HSTS, CSP…), mixed content, RGPD (bannière, mentions légales), accessibilité de base | 100 % Worker |
| (8) | **Concurrence** (option) | comparer le score à 2-3 concurrents locaux | dérivé |

**Score global** = agrégation pondérée des sous-scores (principe repris de Protein SEO, enrichi de 4 → 7 axes), **historisé** (courbes 30/90 j).

---

## 5. Les deux rythmes de surveillance (la clé du « ça ne s'arrête jamais »)

> La sensation « bourse » se fabrique par le **design + le polling à l'écran**, PAS par une fréquence de fond coûteuse.

- **Battement de cœur** (familles 1 + santé) : check léger **toutes les 5–15 min** (fetch, **zéro navigateur, zéro IA, coût ≈ 0**). Permet l'alerte « site tombé » en quasi temps réel.
- **Polling « live »** : quand le client **regarde** le pad, re-ping toutes les 30–60 s + chiffres qui s'animent + compteur « prochaine vérification dans… ». Payé seulement à l'usage réel.
- **Audit complet** (on-page + perf) : **1×/jour**, collecte déterministe **gratuite**.
- **GEO** : **hebdo** (les classements IA bougent lentement).
- **Recos / diagnostic IA** : rafraîchis automatiquement **1×/jour en file lissée** + bouton « Relancer » à la demande (métré).
- **Génération de correctifs rédactionnels** : **à la demande** (métré / BYOK).

**Lissage des coûts** : file D1 `next_audit_at` par site ; le cron tourne souvent mais ne traite qu'un **petit lot d'audits échus** → charge étalée sur 24 h, jamais de pic de navigateurs concurrents (motif déjà éprouvé : `sweepDuePosts`).

---

## 6. Le « clé en main » (mécanisme de livraison)

Chaque correctif se décline selon **qui agit** :
- **L'utilisateur novice** → étapes pas-à-pas **contextualisées à la plateforme détectée** (Wix Studio / WordPress / sur-mesure) + le **code généré, prêt à coller** (bouton Copier).
- **Le webmaster** → un clic « Envoyer » → il reçoit la fiche par email + lien pour cocher « fait ».
- **Dans les deux cas** → vérification automatique au prochain audit.

**Détection de plateforme** = signature dans le HTML/headers → adapte les instructions. C'est ce qui sert le novice (« l'outil sait où cliquer à ma place »).

---

## 7. Tableau de bord (cockpit)

- **Vue site** : statut live pulsant (« En ligne »), 4 indicateurs clés (dispo, score, perf, SSL), **radar du score à 7 axes**, courbes (temps de réponse, score, uptime 30/90 j), panneau **« À corriger en priorité »** (action + gain chiffré + priorité), boutons **Rapport PDF · Historique · Relancer l'audit**.
- **Vue multi-sites** (PRO/MAX) : rangée de vignettes (feu vert/orange/rouge par site) → clic → cockpit du site.
- **Rapport PDF** à la demande → réutilise le **DocEngine** déterministe (celui de VEFA Studio), **0 coût IA**.
- **Historique** → D1.
- **Alertes web push** (réutilise `webpush.js` / Keynapse S9) : site down · SSL < 14 j · score qui chute · nouveau lien cassé.
- **Charte** : Apple Premium, indigo sombre, font 900, sentence case, pictos outline (pas d'emoji).

---

## 8. Modèle économique (façon Keystone)

- **Pad inclus dans l'abonnement** (flat) — **pas de Stripe séparé**.
- **Gating par licence** : **STARTER 1 site · PRO 3 · MAX 5 · Admin illimité**. (Pack « +sites » possible plus tard, comme les packs de crédits.)
- **Aucun rationnement des conseils** : l'outil donne tout, tout le temps. Le coût est borné par : **nb de sites/plan** + **quota de crédits IA** (GEO + génération de correctifs).
- **Plan d'optimisation DYNAMIQUE** (re-priorisé à chaque audit), pas une liste figée.

---

## 9. Coûts & souveraineté (chiffré)

| Poste | Coût réel | Maîtrise |
|---|---|---|
| **Uptime / on-page** | ≈ 0 € | fetch + parsing déterministe |
| **Performance (CWV)** | **10 h navigateur/mois incluses**, puis 0,09 $/h (~0,075 ¢/audit) | étalement → pas de surcoût concurrence |
| **GEO** | ~1–2 ¢/requête (frais recherche web, pas les tokens) ; **Gemini = 5 000 requêtes/mois gratuites** | **BYOK = le client paie** · cadence hebdo · 3–5 requêtes curées · métré |
| **Génération correctifs** | déterministe = 0 € ; IA = à la demande/batch | déterministe d'abord, IA réservée au rédactionnel, BYOK/Mistral CF |

**Moteurs GEO** : socle = **Gemini grounding + Perplexity + ChatGPT (web search)** ; **Mistral** activable (souveraineté FR) ; **Grok** en option (niche). Google AI Overviews approximé via **Gemini grounding** (pas d'API propre).

**Levier n°1 « tendre vers le gratuit »** : **BYOK** (chantier déjà déployé) → la conso IA suit le propriétaire/le client. Au démarrage (peu de clients), les 5 000 Gemini/mois rendent le GEO **quasi gratuit**.

---

## 10. Architecture technique & briques réutilisées

- **Type** : artifact **fullscreen** (`padKey:null`), module front **isolé et préfixé** (`sentinel_`/`seo_`), ID immuable, enregistré dans `openTool` + `CATALOG_DATA` + `catalog.json` (`published:true`).
- **Gating serveur** (app sensible, comme Smart Agent) : double gating client + serveur.
- **Métrage IA câblé** : `consumeCredits` avant + `recordUsage` après — pour GEO **et** génération.
- **Pensé `{engine, apiKey}` dès le départ** (BYOK) — jamais `env.AI.run` figé.
- **Tables D1 préfixées** (`sentinel_sites`, `sentinel_checks`, `sentinel_audits`, `sentinel_findings`, `sentinel_geo`…), toutes avec `tenant_id`.
- **Front** Vercel · **Worker** Cloudflare (routes `/api/sentinel/*`) · **cron** (battement + file d'audits) · **bump SW** obligatoire · **stash WIP Pulsa** à chaque deploy worker.
- **Briques réutilisées** : `webpush.js` (alertes), `validateImportUrl` (anti-SSRF sur fetch externe), **DocEngine** (PDF), `callLLM`/`streamLLM` + `resolveEngineForTenant` (BYOK multi-moteur, aussi pour le GEO), `ai-credits`/`ai-budget` (métrage), Browser Rendering (perf). La **génération AEO** (FAQ/méta) est faite par Sentinel lui-même (S4.1, Workers AI/BYOK) — **PAS** par le pad Smart Agent (agent dialogueur).

---

## 11. Périmètre V1 vs V2

- **V1** : familles 1-2-3-5-6-7 (santé, perf, on-page, GEO, présence locale de base, sécurité/conformité) + score + cockpit + alertes + clé en main + boucle webmaster + générateur (déterministe + IA rédactionnel) + PDF + historique.
- **V2** : famille 4 (**Google Search Console** = positions Google réelles via OAuth), intégration **technique** Wix profonde, concurrence avancée, crawl multi-pages.

---

## 12. Feuille de route (sprints) — VALIDÉE

Principe : livrer un produit **utilisable très tôt** (veille + score + clé en main), le GEO couronne. Chaque sprint = incrément autonome et déployable.

| Sprint | Objectif | Ce qui est livré |
|---|---|---|
| **S0 — Coquille** ✅ déployé | Plomberie du pad | Artifact fullscreen `O-GEO-001`, dispatch + `CATALOG_DATA` + `catalog.json`, gating licence, table `sentinel_sites`, écran « Ajouter un site » + détection plateforme |
| **S1 — Battement de cœur** ✅ | Veille de disponibilité | Check léger uptime/HTTP/TTFB (cron + file lissée), cockpit live (statut pulsant, uptime %, sparkline, polling à l'écran, « vérifier maintenant »). |
| **S1.5 — Alertes** ✅ | Compléter la veille | Web push (site hors ligne / rétabli) — abonnement + handler SW isolés. **SSL « jours restants » NON livré** : non lisible nativement par `fetch` sur Workers (cf §13). |
| **S2 — On-page + score** ✅ | Cœur audit | Parsing HTML (SEO technique, sécurité, accessibilité) + findings priorisés + score global, panneau à barres par axe. *Axes Perf/Mots-clés/GEO/Présence = à venir (S3/S5/S6) → radar 7 axes complet à ce moment.* |
| **S3 — Performance** ✅ | Core Web Vitals | Browser Rendering via `@cloudflare/puppeteer` (LCP/CLS/FCP/poids/requêtes, flag **nodejs_compat**), axe Performance au score, best-effort (n/a si BR indispo). 5 axes scorés (reste Mots-clés/GEO/Présence). |
| **S4 — Clé en main** ✅ | Pilier B (déterministe) | Fiches-correctifs dépliables : instructions par plateforme (Wix/WordPress/sur-mesure) + **code prêt à coller** (JSON-LD, meta, viewport, canonical, OG, lang, sitemap, en-têtes) + bouton Copier, **Rapport PDF**. *IA rédactionnel + envoi webmaster → S4.1.* |
| **S4.1 — IA & webmaster** ✅ déployé | Compléter le clé en main | Génération IA du texte (méta + **FAQ AEO**, métrée) ✅ + **envoi rapport webmaster via Resend** ✅ (Cloudflare Email écarté : `protein-keystone.com` sur DNS Vercel, pas une zone Cloudflare). Bouton « Webmaster » masqué tant que `RESEND_API_KEY` absent (drapeau `email_enabled`). |
| **S5.0 — GEO** ⭐ ✅ déployé | Pilier A (killer) | **Gemini grounding** (recherche Google réelle) sur questions de prospect → citation / rang / sourcé → **score de citabilité** = nouvel axe « Visibilité IA (GEO) ». Clé proprio (coffre BYOK) sinon serveur `GEMINI_API_KEY`, métré (1 crédit/run). On-demand. Masqué tant que clé absente (`geo_enabled`). |
| **S5.1 — GEO+** ✅ déployé | Triangulation & auto | **Gemini + Perplexity + ChatGPT** (Responses API web_search) interrogés en parallèle, résultats par moteur + **sentiment** (heuristique FR), **cron hebdo lissé** (`next_geo_at` + `sweepDueGeo`). Clés serveur `PERPLEXITY_API_KEY` / `OPENAI_API_KEY` optionnelles (Gemini seul suffit). *Lien AEO→GEO (le générateur S4.1 de Sentinel propose la FAQ/méta quand non cité) reporté → S6.* |
| **S6 — Finitions** ✅ déployé | Polish | **Axe Présence locale** (NAP on-page souverain : tél./adresse/LocalBusiness/horaires) → radar à 6 axes réels ; **pont AEO→GEO** (citabilité faible → génère la FAQ S4.1) ; **notice d'aide** O-GEO-001 ; **polish mobile**. *Écartés (notés) : comparaison concurrents, fiche Google Business via API (V2), historique GEO, a11y avancée par rendu (axe-core).* |
| **S7 — Cockpit premium** ✅ déployé | Présentation (= la « vue site » du §7) | La modale devient une **vraie vue cockpit** : 4 **cartes KPI** (dispo 30 j+tendance, score+« +N/sem », LCP, SSL « valide » sans J-XX souverain), **radar SVG** 7 axes vs Objectif (remplace les barres), **courbe 30 j** (remplace la sparkline), **findings enrichis** (icône+priorité+tag plateforme+gain estimé), **Historique** + **Relancer** + « prochaine vérif dans X ». Endpoint consolidé `/cockpit` + CWV stockés. *Comble l'écart entre l'implémentation et la maquette/§7.* |
| **S8 — Vérité du parsing** ✅ déployé 2026-08-03 | Fiabilité (le moteur ne peut plus affirmer une absence non constatée) | Déclencheur : 5 faux négatifs sur un vrai site client Wix Studio (Mas des Bouteillans). Moteur pur `lib/audit-page.js` + fixtures réelles (`npm run test:sentinel`, 13 tests) ; cap HTML 500 Ko → 4 Mo + flag `truncated` → findings « indéterminés » (renormalisation) ; JSON-LD parsé + ~150 sous-types LocalBusiness ; regex NAP resserrées (faux positifs SVG/anglais) ; UA forme `compatible` ; injoignable → 503 sans audit stocké. Dry-run réel : Mas 82 → 87, zéro faux finding. *Suite : S9 intégrité du score, S10 contrôles à valeur (cohérence url/@id).* |
| **S9 — Intégrité du score** ✅ déployé 2026-08-03 | Chaque chiffre affiché est défendable (devant le client ET son prestataire) | Pondération **fixe** du global (seo .25/perf .20/sécu .15/a11y .15/présence .15/dispo .10, renormalisée sur axes présents, politique n/a explicite) ; **sécurité scopée hébergeur** (Wix : CSP/XFO/Referrer-Policy « non applicables », axe sur HSTS+XCTO) ; **poids de page au score perf** (fin de « 100/100 + page lourde ») ; CWV **throttlés** (Slow 4G + CPU ×4, best-effort, conditions étiquetées) + attente networkidle ; **GEO non configuré → pas de score** + libellé « N moteurs × M requêtes » ; **dispo : fenêtre réelle affichée** (« sur N j ») + garde de couverture + tendance nulle sans 14 j ; **« X pages auditées sur N détectées »** + sélection priorisée (/contact + diversité de gabarits) ; **version moteur estampillée** (colonne `engine`, cockpit + PDF). |
| **S10 — Contrôles à valeur** ✅ déployé 2026-08-03 | Trouver ce que les autres ne trouvent pas | Cohérence `url`/`@id` JSON-LD vs domaine audité (le check qui aurait trouvé l'URL de staging du Mas) ; canonical : valeur et cohérence inter-pages, pas seulement présence ; recommandations typées par entité (`checkinTime` pour l'hébergement, pas `openingHours`) ; sitemap parseable et non vide ; pré-remplissage activité/ville GEO depuis le JSON-LD. |
| **S11 — Couverture complète** ✅ déployé 2026-08-03 | Auditer TOUT le site, pas un échantillon | Crawl asynchrone sur le pattern `sweepDue` existant (file de pages en D1, N pages/tick de cron, agrégation finale) — un site Wix de 10-50 pages = 2-10 min en tâche de fond. Profondeur par plan envisageable : 5 pages (Essentiel) / 25 (Pro) / complet (Studio), gating `_siteLimit` déjà en place. Constat déclencheur : sur le Mas, 5/11 pages auditées, 4 gîtes sur 7 et /contact + /nos-offres jamais vus. |
| **V2** | Plus tard | Search Console (positions Google), intégration Wix profonde, crawl multi-pages |

---

## 13. Décisions — actées / en suspens

**Actées** :
- Audit **complet** (pas une sentinelle simple) · perf (CWV) **dans la v1**.
- Barème **1 / 3 / 5** sites · Admin illimité.
- Multi-plateforme (Wix/WordPress/sur-mesure) · persona **novice**.
- **GEO validé** (moteurs : Gemini grounding + Perplexity + ChatGPT ; Mistral activable ; Grok option).
- Générateur de correctifs **hybride** (déterministe + IA) **en v1**.
- Search Console = **V2**.
- Modèle Keystone (flat, gating licence, crédits, **pas de tokens 12 mois**).
- **Nom : Sentinel · ID `O-GEO-001` · catégorie WEB.**
- Découpage en **7 sprints (S0→S6) + V2** validé. **S4 fusionne** clé en main déterministe + IA rédactionnel.

**En suspens (non bloquant pour démarrer)** :
- Pondération exacte des 7 axes du score → à fixer en **S2**.
- Liste des moteurs GEO activés par défaut au lancement → à fixer en **S5**.
- **SSL « jours restants »** : non lisible nativement par `fetch` sur Workers (pas d'API certificat). → **S1.5** via sonde TLS dédiée. En S1, un HTTPS qui répond = certificat valide *à l'instant* (sans le compte à rebours).
- **Alertes web push** (down / rétablissement) : abonnement + handler Service Worker propres à Sentinel (isolation) → **S1.5**. En S1, l'état « hors ligne » est déjà visible en direct dans le cockpit.

**S0 — déployé 2026-06-19** : worker version `ff00b47f`, santé `engine:S0`, table `sentinel_sites` créée, commit `d04db44`, SW `v5.27.15`.
**S1 — déployé 2026-06-19** : worker `a68a3dda`, santé `engine:S1`, table `sentinel_checks` + colonnes cache, commit `c44726c`, SW `v5.27.16`.
**S1.5 + S2 — déployés 2026-06-19** : worker `4b51138c`, santé `engine:S2`, tables `sentinel_push_subs` + `sentinel_audits` + colonnes score, commit `4f99e2e`, SW `v5.27.17`.
**S3 — déployé 2026-06-19** : worker `acb31956`, santé `engine:S3` ; binding `[browser]` + `@cloudflare/puppeteer` + flag **`nodejs_compat`** (1er deploy rejeté `node:buffer` → flag ajouté, additif) ; smoke prod-critiques OK (smart-agent SA-9.6, keynapse KN-8) ; commits `0cc6163`+`1f3f57c`, SW `v5.27.18`.
**S4 — déployé 2026-06-19** : worker `b5663fe4`, santé `engine:S4` ; correctifs clé en main (déterministe, par plateforme + code à copier) + rapport PDF ; smoke smart-agent SA-9.6 OK ; commit `e77d40a`, SW `v5.27.19`. IA rédactionnel + e-mail webmaster = **S4.1** (fournisseur e-mail à décider).
**S4.1 — déployé 2026-06-19** : worker `b1c2b6a6`, santé `engine:S4.1`, schéma ok (table `sentinel_email_log` migrée), commit `a23c565`, SW `v5.27.20` ; smoke smart-agent SA-9.6 + keynapse KN-8 OK.
- **(A) IA rédactionnel** — route `POST /sites/:id/suggest {kind:'meta'|'faq'}` **métrée** (budgetGuard → consumeCredits si enforcement → `env.AI.run(KS_AI_MODEL)` → recordUsage → refund si échec ; tool `'sentinel'`). L'IA lit le contenu RÉEL de la page (titre/H1/extrait) et n'écrit que le **contenu** ; la **structure** (balise `<meta>`, JSON-LD `FAQPage`) est assemblée côté worker → toujours valide. Best-effort (IA indispo → message clair, le déterministe S4 reste). Front : bouton « Rédiger avec l'IA » sur la méta description + **carte FAQ AEO** (pilier GEO).
- **(B) Envoi webmaster** — route `POST /sites/:id/send-report {email}` via **Resend** (API REST ; **Cloudflare Email écarté** car `protein-keystone.com` est sur DNS Vercel — pas une zone Cloudflare). Rapport HTML+texte depuis l'audit stocké (findings + fixes), rate-limit léger 20/j/tenant (pre-bump + revert), erreurs mappées proprement. Front : bouton « Webmaster » + champ e-mail, **masqué tant que l'envoi n'est pas câblé** (`email_enabled` exposé par /sites = présence de `RESEND_API_KEY`) → zéro UI morte.
- **⚠ RESTE pour ACTIVER (B)** — actions Stéphane, sans redéploiement de code : (1) compte Resend + domaine `protein-keystone.com` vérifié (ajouter les enregistrements DKIM/SPF chez Vercel) ; (2) `cd workers && npx wrangler secret put RESEND_API_KEY`. Dès la clé posée, le bouton « Webmaster » apparaît automatiquement. Expéditeur par défaut `sentinel@protein-keystone.com` (override possible via var `SENTINEL_FROM_EMAIL`).
- **Décision e-mail RÉVISÉE** : le handoff actait « Cloudflare Email (souverain) » ; découverte en exécution que le DNS est chez Vercel (pas zone Cloudflare) → bascule sur **Resend** (validée par Stéphane, AskUserQuestion 2026-06-19).
**S5.0 — GEO (pilier killer) — déployé 2026-06-19** : worker `1128e339`, santé `engine:S5.0`, schéma ok (table `sentinel_geo` migrée), commit `55fd975`, SW `v5.27.21` ; smoke smart-agent SA-9.6 + keynapse KN-8 OK.
- **Mesure** : routes `GET/POST /sites/:id/geo` (config) + `POST /sites/:id/geo/run`. Le run interroge **Gemini 2.5 Flash AVEC grounding Google Search** (`tools:[{google_search:{}}]` — recherche web réelle, seul moyen de mesurer une TPE locale ; vérifié via doc ai.google.dev) sur 3-5 questions de prospect (auto-générées depuis activité+ville, éditables) → `_detectCitation` (nommé dans la réponse / rang approx. / domaine sourcé dans `groundingChunks`) → `_geoScore` (citabilité 0-100). Best-effort : échec → message clair, le reste de l'audit tient.
- **Clé** : `_resolveGeoKey` = clé Gemini du propriétaire (coffre BYOK via `resolveEngineForTenant`, respecte le flag) **sinon** secret serveur `GEMINI_API_KEY` (free tier = levier coût du brief). **Métré** : clé serveur → 1 crédit/run (`consumeCredits` tool `'sentinel'`, refund si tout échoue) ; BYOK → hors compteur. PAS de `recordUsage`/`budgetGuard` (Gemini ≠ neurones Workers AI).
- **Front** : nouvel **axe « Visibilité IA (GEO) »** dans le radar (sort de « à venir ») + section dans le panneau d'audit (formulaire nom/ville/activité/questions + « Mesurer ma visibilité IA » + résultats par question : cité ✓/✗, position, extrait, score). `geo`+config chargés à l'ouverture du panneau ; masqué tant que `geo_enabled` faux (= `GEMINI_API_KEY` présent).
- **⚠ ACTIVER = action Stéphane sans redéploiement** : `cd workers && npx wrangler secret put GEMINI_API_KEY` (clé Gemini gratuite, console Google AI Studio). Dès la clé posée, l'axe GEO + le bouton « Mesurer » apparaissent. ⚠ Grounding Gemini PAS testé live (pas de clé) : 1er run réel = vrai smoke ; payload conforme à la doc.
- **Cut S5.0** : Gemini seul + on-demand. **Différé S5.1** : Perplexity + ChatGPT (triangulation), sentiment, cron hebdo lissé (`next_geo_at`), lien AEO→GEO.
**S5.1 — GEO triangulé — déployé 2026-06-19** : worker `008c7fc5`, santé `engine:S5.1`, schéma ok (colonne `next_geo_at` migrée), commit `b384f7e`, SW `v5.27.22` ; smoke smart-agent SA-9.6 + keynapse KN-8 OK.
- **Triangulation** : `_resolveGeoEngines` liste les moteurs interrogeables (`gemini`/`perplexity`/`gpt`) — clé du proprio (BYOK si moteur actif compatible) sinon secret serveur (`GEMINI_API_KEY`/`PERPLEXITY_API_KEY`/`OPENAI_API_KEY`). `_executeGeoRun` interroge **toutes les cellules (question × moteur) en PARALLÈLE** (`Promise.all`) : Gemini grounding, Perplexity `sonar` (web-grounded natif, sources via `citations`/`search_results`), ChatGPT via **Responses API `/v1/responses` + `tools:[{type:'web_search'}]`** (voie pérenne — `gpt-4o-search-preview` chat est déprécié 2026-07-23 ; sources via `annotations.url_citation`). Résultats `[{prompt, engines:[{engine,cited,rank,sourced,sentiment,snippet,sources,error}]}]` ; score = moyenne par cellule réussie. Best-effort par-moteur (un moteur KO = « échec » sur sa cellule, n'interrompt pas le run).
- **Sentiment** : `_sentiment` heuristique lexicale FR (fenêtre autour de la mention, listes pos/neg), indicatif, sans coût IA.
- **Cron hebdo lissé** : colonne `next_geo_at` (posée à chaque run = +7 j) ; `sweepDueGeo(env)` sur le cron quotidien `0 3 * * *` traite un lot borné (15) de sites GEO échus, métré sur le portefeuille du proprio (**plan résolu via `LEFT JOIN licences`**), **skip si aucune clé serveur** (BYOK seul = on-demand), échec → `next_geo_at +1 j`. `_executeGeoRun` factorisé (route + cron).
- **⚠ ChatGPT pas testé live** (pas de clé OpenAI) : 1er run réel = vrai smoke ; format Responses API conforme à la doc, dégrade par-moteur sinon. Gemini reste le socle (free tier).
- **Front** : badges par moteur + légende des moteurs interrogés ; tolère l'ancien format mono-moteur ; sous-titre actualisé (« plusieurs IA »).
- **Reste GEO (S6/futur)** : lien AEO→GEO (quand le GEO dit « non cité », proposer en 1 clic la génération FAQ/méta **de S4.1** — fonctionnalité PROPRE à Sentinel, pas Smart Agent), affinage du rang/sentiment, historique des scores GEO.
**S6 — finitions — déployé 2026-06-19** : worker `0ee54e77`, santé `engine:S6.0`, schéma ok, commit `34680c9`, SW `v5.27.23` ; smoke smart-agent SA-9.6 + keynapse KN-8 OK.
- **Axe Présence locale (NAP)** : détection souveraine on-page dans `_audit` — `napPhone` (`tel:` / motif FR), `napAddress` (PostalAddress / `<address>` / rue+CP), `napLocalBiz` (Schema.org LocalBusiness & types dérivés), `napHours` (openingHours) → score `presence` (30/35/20/15) + findings `nap_*` (sev low, localbiz medium). Correctif des `nap_*` = le snippet **LocalBusiness** (réutilise le `case 'jsonld'` de `_fixFor`). Front : `presence` ajouté à `AXES`, retiré de `SOON_AXES` → **radar à 6 axes réels** (+ GEO) ; ne reste que « Mots-clés » (V2 Search Console).
- **Pont AEO→GEO** (front) : `_geoResultsHTML` calcule `weak` (score < 70 ou ≥1 cellule non citée) → CTA « Rédiger la FAQ avec l'IA » qui déclenche `_suggestAI('faq','snt-ai-faq')` (le générateur S4.1, carte AEO juste en dessous). Boucle mesure→correctif **interne à Sentinel**.
- **Notice d'aide** : `K_STORE_ASSETS/HELP/O-GEO-001.json` créée (gabarit help-overlay 4 zones : tldr, key_points, faq, shortcuts ; servie statiquement par Vercel ; le bouton « ? » de la topbar était vide pour Sentinel). ⚠ source des notices = `K_STORE_ASSETS/HELP/`, PAS `/PADS/`.
- **Polish mobile** : `@media (max-width:560px)` (radar `92px 1fr 32px`, modale, score, `snt-geo-two` en colonne).
- **Écartés volontairement (notés)** : comparaison concurrents (feature à part), fiche Google Business via API (OAuth → V2), historique/courbes des scores GEO (visualisation), accessibilité avancée par rendu (axe-core — les heuristiques HTML fiables sont déjà couvertes). **✅✅ V1 du brief complète** (familles 1-2-3-5-6-7 + score + cockpit + alertes + clé en main + boucle webmaster + générateur déterministe & IA + PDF + GEO). Reste = **V2** (Search Console famille 4, intégration Wix profonde, crawl multi-pages) + reliquats optionnels ci-dessus.
**S7 — Cockpit premium — déployé 2026-06-19** : worker `4b6612db`, santé `engine:S7.0`, schéma ok (colonne `cwv` sur sentinel_audits), commit `3e16a8d`, SW `v5.27.24` ; smoke smart-agent SA-9.6 + keynapse KN-8 OK. **Motif** : retour Stéphane « c'est un downgrade » en comparant la modale livrée aux maquettes/§7 (cartes KPI + radar + courbe 30 j). Juste — la matière était là, la présentation non.
- **Backend** : `GET /sites/:id/cockpit` (lecture seule, 0 IA) = dispo 30 j + tendance (7 j vs 7 j), série 30 j (moy./jour), dernier audit, historique des scores (12), tendance de score (vs ~7 j), SSL (https+joignable, **pas de J-XX** = limite souveraine actée), GEO. **CWV désormais stockés** (colonne `cwv` sur `sentinel_audits`, lus pour le KPI LCP — avant non persistés).
- **Front** : la modale (`_renderPanel`/barres) devient `_renderCockpit` (large) — `_openCockpit`/`_loadCockpit`/`_relaunchAudit`. **4 cartes KPI**, **radar SVG** `_radarSVG` (7 axes Performance/SEO/Mots-clés/Visibilité IA/Présence/Sécurité/Accessibilité vs Objectif 85 ; disponibilité = KPI hors radar), **courbe 30 j** `_responseChartSVG` (aire+pic+axes), **findings enrichis** (`_AXIS_ICON`+`_SEV_PRIO` priorité/gain, tag plateforme, bandeau total), **Historique** (`_historyHTML` sparkline) + **Relancer** + `_until` (prochaine vérif). 1er ouverture sans audit → auto-run. GEO/AEO/email conservés dans le cockpit. `_auditNow`/`_viewAudit`/`_fetchGeo`/`_bar` retirés.
- ⚠ Sur le radar, **Visibilité IA** = 0 tant que clé Gemini absente, **Mots-clés** = 0 (V2). KPI LCP/perf = n/a si Browser Rendering indispo. PDF inchangé (axes+findings).

---

*Brief vivant — créé 2026-06-18. À mettre à jour à chaque décision. Lié : [[MANIFESTE_NOUVELLE_APP]], [[byok-moteur-universel]] (moteur GEO). NB : Smart Agent (pad dialogueur) n'intervient PAS dans Sentinel — la génération AEO est faite par Sentinel lui-même (S4.1).*
