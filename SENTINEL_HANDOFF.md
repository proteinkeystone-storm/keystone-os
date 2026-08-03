# 🛰️ SENTINEL — Ordres de reprise (nouvelle conversation)

> ## ✅ S15.0/S15.1 « COHÉRENCE D'URL & TRANSPARENCE DU CACHE » LIVRÉ (2026-08-04) — `engine:S15.0`, SW `v5.28.466`, smokes 20 VERT.
> **DoD atteinte le soir même** : audit du Mas en couverture complète 11/11 → **96/100, ZÉRO finding**
> (SEO 100, sécurité 100, présence 100 ; reste vitesse 80 et GEO 0 = absence des annuaires, pas un défaut de site).
> **S15.1** — « gain estimé +null pts » sur un audit PARFAIT : S12.1 avait branché le gain réel sur le calcul
> du PDF mais pas sur son rendu (le cockpit avait son ternaire, pas le PDF). Bug **inatteignable jusqu'à ce
> qu'un site soit sans défaut** → titre « Points de contrôle · aucune action requise ».
> ⚠ **RÈGLE AJOUTÉE À LA PASSE ADVERSE : tester aussi l'ÉTAT DE SUCCÈS** (0 finding, tous axes verts) — l'écran
> que voit le client satisfait est le moins testé et doit être irréprochable.
> **Incident fondateur** : correctif staging appliqué à la source (Custom Embed rev.4 via API Wix), rapport
> suivant → « URL de staging » toujours là sur 10 pages. Causes réelles : (1) le crawl lisait la home en APEX
> et les pages internes en WWW (sitemap) → couches de cache CDN différentes (Wix Varnish vs Fastly) dans le
> même rapport ; (2) pages servies depuis un cache de 15-40 min, et Sentinel jette l'en-tête `age` ; (3) seul
> « Publier » purge le cache Wix, et le rapport ne le disait pas.
> - **15.1 Un audit = UN hôte** : `res.url` capté (redirections suivies) → `_rehost()` de toutes les pages sur
>   l'hôte final de la home (express ET crawl, `_resolveFinalUrl` au démarrage du crawl). Garde-fou : jamais de
>   réécriture cross-domaine.
> - **15.2 En-tête `age` capté** (`cacheAge` par page, `cache_age` max stocké par audit) → ligne transparence
>   cockpit + PDF quand > 5 min : « copie datant de X min — un correctif récent peut ne pas encore apparaître,
>   ni ici ni chez Google ».
> - **15.3** Fix staging : étape « IMPORTANT : Publier purge le cache Wix (sinon jusqu'à 24 h) » ; finding
>   `jsonld_url_mismatch` PARTIEL (X pages sur N) → indice « probablement le cache, republiez et relancez ».
> À noter aussi (même journée) : **S14.2** — bug francophone majeur, apostrophe coupait la capture des attributs
> (« L'Arbousier » → méta lue 1 c. au lieu de 149) → parseur `_attr`/`_findTag` + décodage d'entités, fixtures
> re-vérifiées À LA MAIN (l'arbousier n'a JAMAIS eu de défaut de méta ; PKS 240 c. réellement trop longue).
>
> > ## ✅ S14.0 « GEO QUI DIT VRAI » LIVRÉ (2026-08-04) — `engine:S14.0`, SW `v5.28.464`, 46 tests. **RÉQUISITOIRE SOLDÉ (8/8).**
> - **14.1 Triangulation** : le chemin Perplexity/ChatGPT (S5.1) est prêt — activation = `wrangler secret put
>   PERPLEXITY_API_KEY` (geste Stéphane, secret jamais manipulé par l'agent). Libellé « 1 moteur — indicatif »
>   disparaît de lui-même.
> - **14.2 Historique lissé** : table `sentinel_geo_history` (score/moteurs/prompts par run) ; le cockpit
>   affiche « médiane des N derniers relevés » quand elle diffère du dernier — les réponses IA sont
>   non-déterministes, un relevé isolé ne fait pas une tendance.
> - **14.3 Présence dans les SOURCES citées** ⭐ (la leçon Perplexity du 03/08 devenue fonctionnalité) :
>   `topCitedDomains` (titres-domaines Gemini + URLs Perplexity) + `presenceMatch` (nom normalisé accents/casse
>   dans le TEXTE hors scripts, ou lien vers le domaine client) — top 4 sources fetchées en parallèle
>   (6 s timeout, best-effort), colonne `last_sources_check`. Cockpit : « cité N× — vous y figurez / n'y
>   figurez PAS » + **reco levier n°1 : « demandez votre inscription sur X »**. Le pont FAQ reformulé
>   honnêtement (la FAQ sert les requêtes de MARQUE ; la citation générique vient des sources).
> **DoD attendue au prochain run GEO du Mas** : tourisme-lacadieredazur.fr détecté cité, présence « non »,
> reco d'inscription — le conseil donné à la main le 03/08, produit par l'outil.
>
> > ## ✅ S13.0 « LIRE LE WEB TEL QU'IL EST » LIVRÉ (2026-08-04) — `engine:S13.0`, SW `v5.28.463`, 44 tests.
> Ferme les attaques 1-2-3 du réquisitoire (rejouées telles quelles dans la suite — règle : une attaque qui
> porte devient une fixture).
> - **13.1 HTML « visible »** (`visibleHtml`) : commentaires + corps de <script>/<style> hors détections de
>   contenu (H1/img/NAP/head) — un <h1> commenté comptait comme un vrai, une méta commentée créditait, un
>   « <h1 » dans une chaîne JS comptait. Le JSON-LD garde le document brut (il VIT dans des <script>).
>   Blocs non fermés (troncature) purgés. Fixtures Wix réelles : résultats identiques (non-régression testée).
> - **13.2 Coquille SPA** : texte visible < 200 c. + marqueur framework (#root/#app/__next/__nuxt/reactroot/ng)
>   → `spaShell`, TOUT « pas trouvé » devient indéterminé (gating `noProof` = tronqué OU SPA), marqueur `_spa`
>   dans les indéterminés, ligne dédiée cockpit (« site en rendu client — Google exécute le JS »). Fini le
>   40/100 + dix faux findings sur un site React sain.
> - **13.3 NAP francophone** : +33/+32/+41/+352 (et 00xx), codes postaux 4-5 chiffres, « chaussée » ajouté.
>   La friterie de Namur passe de présence 0 (4 faux findings) à 65 (les vrais manques restants).
> - **13.4 Managé étendu** : `_probe` détecte squarespace/shopify → scoping en-têtes C8 appliqué (plus
>   seulement Wix).
> **RESTE DU RÉQUISITOIRE → S14 GEO** (triangulation Perplexity, lissage/alertes, contrôle « présence dans
> les sources citées »).
>
> > ## ✅ S12.0 « PROMESSES TENUES » LIVRÉ (2026-08-04) — `engine:S12.0`, SW `v5.28.462`, 37 tests.
> **Origine** : exercice de détracteur demandé par Stéphane — 6 attaques portées sur 8. Ce sprint ferme les 4
> qui touchent aux promesses chiffrées ; S13 (parsing) et S14 (GEO) fermeront le reste. **Règle nouvelle actée :
> chaque sprint se clôt par une passe adverse, chaque attaque qui porte devient une fixture.**
> - **12.1 Gain RÉEL** : `FINDING_POINTS`/`attachGains` (lib, 6 tests) — le gain affiché = delta exact du
>   barème pondéré (arrondi 0,1). Informatifs (staging, canonical…) → « hors score · impact externe » ;
>   perf/img_alt → « gain variable ». Fini les +5/+3/+1 cosmétiques qui promettaient des points intenables.
>   En-tête : « gain au score : jusqu'à +X pts » (somme = plafond). Anciens audits sans f.gain → pas de chiffre.
> - **12.2 Fin du yo-yo** : colonne `last_coverage` ; un express n'écrase pas un score « complet » < 7 j
>   (`scoreKept:'full-recent'` dans la réponse) ; badge de périmètre sur la vignette (point ·) ET sous le
>   score du cockpit (« échantillon » / « couverture complète ») ; **tendance à périmètre égal** (COALESCE coverage).
> - **12.3 Perf indisponible** : `_lastCwv` — réutilisation de la mesure ≤ 7 j étiquetée (`cwv.stale_from`,
>   affichée cockpit + PDF) ; sinon axe n/a + mention « score calculé sans l'axe vitesse — non comparable ».
>   Fini le +10 silencieux par renormalisation quand le quota Browser Rendering meurt.
> - **12.4 Axes honnêtes** : « Sécurité (en-têtes) », « Accessibilité de base » (front, radar, PDF, e-mail) ;
>   **pondérations imprimées** dans le pied de PDF (25/20/15/15/15/10, axe non mesuré retiré du calcul).
> **RESTE DU RÉQUISITOIRE → S13** (commentaires HTML comptés, SPA notée 40 au lieu d'indéterminée, NAP
> mono-France, scoping managé limité à Wix, fixtures hostiles) **et S14** (GEO : triangulation Perplexity,
> lissage/alertes, contrôle « présence dans les sources citées » — le vrai remède, cf. leçon Perplexity du 03/08).
>
> > ## ✅ S11.2 « FIABILITÉ DES MESURES » LIVRÉ (2026-08-03) — `engine:S11.2`, SW `v5.28.461`, 31 tests.
> **Déclencheur** : retour Stéphane — 94 puis 84 à 8 min d'écart sans toucher au site. Décomposition sur les
> deux rapports réels : ~3 pts = échantillon 5/11 vs couverture 11/11 (information vraie, déjà libellée) ;
> ~7 pts = variance d'une mesure CWV UNIQUE (LCP 2,4 s → 3,5 s d'un run à l'autre en headless throttlé).
> - **Médiane de 3 chargements** dans `_measurePerf` (pattern PageSpeed/WebPageTest) ; `cwv.runs` tracé ;
>   libellé « médiane de 3 mesures » (bloc transparence cockpit + pied de PDF). Timeouts resserrés
>   (goto 15 s / repli 10 s / settle 1,2 s) pour tenir dans les 70 s du POST audit.
> - **`meta_length`** (low) : une méta hors 50-165 c. perdait 7 pts EN SILENCE (SEO 99→90 sur le crawl
>   complet sans nouvelle ligne au rapport). Règle : **tout point perdu a sa ligne d'explication.**
> - S11.1 (même soirée) : purge des prompts GEO génériques persistés par l'ère S5 (4 lignes nettoyées en D1)
>   — la config ville/activité reprend la main sur les fallbacks stockés à tort comme requêtes utilisateur.
> **Règle de lecture des scores** : à périmètre égal → stable (sinon bug) ; entre périmètres → l'écart est
> de l'information (le complet est plus vrai que l'échantillon).
>
> > ## ✅ S11.0 « COUVERTURE COMPLÈTE » LIVRÉ (2026-08-03) — `engine:S11.0`, SW `v5.28.459`, 31 tests.
> **Fin du plan S8→S11.** L'audit express (5 pages, synchrone) échantillonne ; le **crawl complet** audite
> TOUT le site en tâche de fond, sur le pattern sweepDue :
> - **Tables** `sentinel_crawls` (1 job/site : status/total/done) + `sentinel_crawl_pages` (file, résultat JSON par page).
> - **Endpoints** : `POST /sites/:id/crawl` (démarre ; idempotent si déjà en cours ; plafond par plan via
>   `_crawlLimit` : STARTER 10 · PRO 25 · MAX 50 · ADMIN 100) ; `GET /sites/:id/crawl` (progression).
> - **Cron `* * * * *`** (trigger existant, jusqu'ici inutilisé) : `sweepDueCrawls` audite **5 pages/tick**
>   (séquentiel — 1 document ≤ 4 Mo en mémoire à la fois), no-op quasi gratuit sans file.
> - **Finalisation** : agrégation (`aggregatePages`, extraite dans lib — partagée avec l'audit express),
>   CWV home + dispo fenêtrée + fixes → **audit `coverage:'full'`** dans l'historique + `last_score` du site.
> - **Front** : bouton « Auditer les N pages (crawl complet) » dans le bloc pages du cockpit, progression
>   live (poll 15 s, raccrochage au ré-ouvert), badge « couverture complète » (cockpit + PDF). SW bumpé.
> - L'audit express écrit désormais `coverage:'sample'` — l'historique dit toujours sur quoi un score repose.
> **DoD Mas** : 11 pages détectées → crawl 11/11 en ~2-3 min, dont /contact et /nos-offres jamais auditées
> avant (4 gîtes sur 7 étaient hors échantillon). ⚠ 1er crawl réel = smoke du cron (lot, finalisation, badge).
>
> ## ✅ S10.0 « CONTRÔLES À VALEUR » LIVRÉ (2026-08-03) — `engine:S10.0`, smokes 20 VERT, 29 tests.
> **Principe** : trouver ce que les autres outils ne trouvent pas — et parler la langue de l'entité auditée.
> - **C17 · Cohérence url/@id JSON-LD vs domaine audité** (`jsonld_url_mismatch`, high) — LE check signature.
>   Détecte les URL de staging (`STAGING_HOSTS` : wixstudio/wixsite/vercel.app/netlify.app/myshopify…) et les
>   domaines étrangers déclarés comme adresse officielle de l'entité (LocalBusiness*/Organization/WebSite).
>   `sameAs` jamais contrôlé (réseaux sociaux légitimement externes) ; www/apex même domaine = OK.
>   **Validé sur le cas fondateur : le `proteinstd.wixstudio.com` du Mas est détecté sur ses 5 pages** —
>   le défaut réel que l'audit S7 avait manqué. Fix clé en main (url + @id commun `#business`).
> - **C18 · Canonical par VALEUR** : autre domaine → `canonical_mismatch` (high) ; hôtes canoniques mélangés
>   entre pages (www vs apex) → `canonical_inconsistent` (site-level, agrégation).
> - **C19 · Recos typées par entité** : hébergement (`LODGING_TYPES`) → les « horaires » = `checkinTime`/
>   `checkoutTime` (satisfont l'axe présence ; finding et fix reformulés). Fini openingHours conseillé aux gîtes.
> - **C20 · Sitemap par contenu** : `sitemapLooksValid()` — urlset/sitemapindex/loc exigé, un 200 HTML ne compte plus.
> - **C21 · Pré-remplissage GEO** : ville (`addressLocality`) + activité (`TYPE_ACTIVITY_FR`, ~30 types sans
>   ambiguïté) extraites du JSON-LD à chaque audit → upsert dans `sentinel_geo` SI config vide (jamais d'écrasement).
>   Débloque le verrou C10 (« GEO non configuré ») sans saisie manuelle pour les sites bien balisés.
> **Scores INCHANGÉS** (les contrôles S10 sont informatifs, hors barème) — pas de re-calibration client.
> Suite : **S11 couverture complète** (crawl asynchrone pattern sweepDue, cf BRIEF §12) — dernier sprint du plan.
>
> ## ✅ S9.0 « INTÉGRITÉ DU SCORE » LIVRÉ (2026-08-03) — `engine:S9.0`, commit `c933292`, SW `v5.28.458`.
> **Principe** : chaque chiffre affiché est défendable — devant le client ET devant son prestataire.
> - **C7** Pondération FIXE du global (`AXIS_WEIGHTS` : seo .25 / perf .20 / sécu .15 / a11y .15 / présence .15 / dispo .10),
>   axe n/a → renormalisation (un n/a ne déplace plus le score). `globalScore()`/`perfScore()` extraits dans `lib/audit-page.js`.
> - **C8** Sécurité scopée hébergeur : sur Wix, CSP/X-Frame-Options/Referrer-Policy = **non applicables**
>   (champ `notApplicable`, colonne `not_applicable`) — l'axe se joue sur HSTS + X-Content-Type-Options. Mas : sécu 40 → 100.
> - **C9** Le poids de page entre au score perf (15 %, seuils 2/6 Mo) — fin du « 100/100 + Page lourde ».
> - **C14/C15** CWV **throttlés** best-effort (CDP : Slow 4G + CPU ×4) + `networkidle2` ; conditions étiquetées
>   dans `cwv.conditions` (`mobile-4g-cpu4x` | `datacenter-non-throttle`) et affichées (cockpit + PDF).
>   ⚠ CDP pas garanti sur Browser Rendering — 1er audit réel = smoke ; si non throttlé, le rapport le DIT.
> - **C10** GEO non configuré (ni activité, ni ville, ni prompts perso) → **refus de scorer** (`GEO_NOT_CONFIGURED`,
>   cron stoppé `next_geo_at=NULL` jusqu'à config). Fin du 0/100 sur « meilleur établissement ? » sans lieu.
> - **C16** Libellé de confiance GEO : « N moteur(s) × M requêtes — indicatif si 1 seul moteur ».
> - **C11-C13** Dispo : fenêtre RÉELLE (« sur N j » si historique < 30 j, `uptimeWindowDays`), couverture < 50 %
>   des relevés attendus → « historique insuffisant » (axe n/a), tendance null sans 2×7 j de données (front : « — »).
> - **Périmètre** : `_discoverPages` → `{urls, total}` + sélection priorisée (/contact, /nos-offres… puis
>   diversité de gabarits par 1er segment d'URL) ; « X pages auditées sur N détectées » (cockpit + PDF, `pages_total`).
> - **C23** Version moteur estampillée : colonne `engine` sur chaque audit, visible cockpit + pied de PDF.
> - **Front** : bloc **transparence** (`_transparencyHTML` : non vérifiable / gérés par l'hébergeur / conditions
>   de mesure / version) + libellés dispo dynamiques + fix de la phrase orpheline « FAQ ci-dessus » du bandeau.
> - Tests : **19** (13 S8 + 6 S9) — `npm run test:sentinel`. Dry-run réel Mas : sécu 100, global **97-98** (vs 82 au départ).
> **RESTE (prochains sprints)** : **S10 contrôles à valeur** (cohérence url/@id JSON-LD vs domaine — le check qui a
> trouvé l'URL de staging du Mas ; canonical par valeur ; recos typées par entité ; sitemap non vide ; préremplissage
> GEO depuis JSON-LD) puis **S11 couverture complète** (crawl asynchrone pattern sweepDue). Cf BRIEF §12.
>
> ## ✅ S8.0 « VÉRITÉ DU PARSING » LIVRÉ (2026-08-03) — version `91816085`, `engine:S8.0`, smokes 20 VERT.
> **Origine** : rapport client Mas des Bouteillans (Wix Studio) = 5 faux négatifs — « Aucun H1 » ×5 pages
> (coupe du HTML à 500 Ko, H1 Wix à ~2,3 Mo) et « LocalBusiness absent » ×4 (allowlist sans `LodgingBusiness`).
> **Principe S8** : *une preuve négative (« absent ») exige un document complet* ; sur un tronqué → « indéterminé »
> (aucun finding, point hors dénominateur de l'axe). Une preuve positive (défaut VU) vaut toujours.
> **Livré** :
> - Moteur d'analyse PUR extrait dans `workers/src/lib/audit-page.js` (zéro I/O, modèle brand-extract).
> - Cap HTML 500 Ko → **4 Mo** (`MAX_HTML`) + flag `truncated` propagé jusqu'à l'API (colonne `indeterminate`
>   sur `sentinel_audits`, migration auto).
> - JSON-LD **parsé** (plus de regex littérale) + **hiérarchie Schema.org** : ~150 sous-types de `LocalBusiness`
>   reconnus (`LodgingBusiness`, `Restaurant`, `Store`…). Microdata `itemtype` en fallback.
> - Regex NAP resserrées : l'ancien motif téléphone matchait des **coordonnées SVG** sur wordpress.org, l'adresse
>   se déduisait de « place » (mot anglais) + 5 chiffres quelconques. Désormais : donnée parsée d'abord, texte strict ensuite.
> - UA → forme `Mozilla/5.0 (compatible; KeystoneSentinel/1.0; …)`. Mesuré : Wix sert le même HTML aux deux formes
>   (la version crawler allégée est réservée aux bots vérifiés) — c'est MAX_HTML qui fait le travail, pas l'UA.
> - Site injoignable → **503 + aucun audit stocké** (l'ancien « audit minimal » notait un site down comme un site sans balises).
> - **Harnais C22** : `npm run test:sentinel` — 13 tests sur 7 fixtures HTML réelles gzippées (`workers/test/fixtures/`,
>   capture 2026-08-03) : Mas ×5 (Wix Studio 2,2-3,4 Mo), PKS (statique), wordpress.org (**contrôle négatif** NAP).
>   Vérité terrain établie À LA MAIN — ne jamais ajuster une valeur attendue sans re-vérifier la page.
> **Vérifié en dry-run bout-en-bout sur le site réel** : H1 5/5, LodgingBusiness 5/5, SEO 99, Présence 85,
> global 82 → **87**. Le reste du chemin vers ~97 = S9 (scoping sécurité par hébergeur — les 3 en-têtes
> non réglables sur Wix pèsent encore 60 pts sur l'axe). **Suite planifiée : S9 « intégrité du score »
> (pondération fixe, n/a explicite, gardes statistiques, throttling CWV à trancher) puis S10 « contrôles
> à valeur » (cohérence url/@id JSON-LD vs domaine audité — le check qui a trouvé l'URL de staging du Mas).**

> **À coller / pointer au démarrage d'une nouvelle conversation Claude Code.**
> Le pad **Sentinel** (`O-GEO-001`, audit web avec suivi) est construit jusqu'à **S4.1 inclus, déployé en prod** (2026-06-19, `engine:S4.1`). Ce document dit quoi faire ensuite, exactement.

> ## ✅ S4.1 LIVRÉ (2026-06-19) — le §2 ci-dessous est FAIT, ne pas le ré-exécuter.
> Partie A (IA rédactionnel méta + FAQ AEO, métrée) + Partie B (envoi webmaster) **déployées** (worker `b1c2b6a6`, commit `a23c565`, SW `v5.27.20`).
> **Changement acté** : fournisseur e-mail = **Resend** (et non Cloudflare Email — `protein-keystone.com` est sur DNS Vercel, pas une zone Cloudflare). Le code est en prod ; la Partie B est masquée (`email_enabled`) tant que **Stéphane** n'a pas (1) vérifié le domaine chez Resend (records DKIM chez Vercel) + (2) posé le secret `RESEND_API_KEY` (`wrangler secret put`). **Aucun redéploiement nécessaire ensuite.**
>
> ## ✅ S5.0 GEO LIVRÉ (2026-06-19) — worker `1128e339`, `engine:S5.0`, commit `55fd975`, SW `v5.27.21`.
> Mesure de **Visibilité IA (GEO)** : Gemini grounding (recherche Google réelle) → citation/rang/score, nouvel axe au radar + section dans le panneau d'audit. **Activation = `cd workers && npx wrangler secret put GEMINI_API_KEY`** (clé Gemini gratuite, Google AI Studio) ; sans clé, GEO reste masqué (`geo_enabled`). ⚠ Grounding pas testé live (pas de clé) → 1er run = vrai smoke.
>
> ## ✅ S5.1 GEO TRIANGULÉ LIVRÉ (2026-06-19) — worker `008c7fc5`, `engine:S5.1`, commit `b384f7e`, SW `v5.27.22`.
> Triangulation **Gemini + Perplexity + ChatGPT** (parallèle, best-effort par-moteur) + **sentiment** (heuristique FR) + **cron hebdo lissé** (`next_geo_at` / `sweepDueGeo` sur `0 3 * * *`). **Activation des moteurs payants (optionnel)** : `wrangler secret put PERPLEXITY_API_KEY` et/ou `OPENAI_API_KEY` (Gemini gratuit suffit pour démarrer). ⚠ ChatGPT (Responses API) pas testé live → 1er run = vrai smoke.
>
> ## ✅ S6 FINITIONS LIVRÉ (2026-06-19) — worker `0ee54e77`, `engine:S6.0`, commit `34680c9`, SW `v5.27.23`.
> Axe **Présence locale** (NAP on-page → radar à 6 axes réels) + **pont AEO→GEO** (citabilité faible → génère la FAQ S4.1) + **notice d'aide** O-GEO-001 (`K_STORE_ASSETS/HELP/`) + **polish mobile**. **✅✅ V1 du brief COMPLÈTE.**
> **RESTE (V2 / optionnel, plus de sprint engagé)** : Search Console (positions Google réelles, OAuth — famille 4), intégration Wix profonde, crawl multi-pages ; reliquats notés : comparaison concurrents, fiche Google Business via API, historique/courbes des scores, a11y avancée (axe-core). Cf `SENTINEL_BRIEF.md` §12-13.
> ⚠ Activation des fonctions à clé (rappel) : `RESEND_API_KEY` (envoi webmaster), `GEMINI_API_KEY` (GEO, gratuit), `PERPLEXITY_API_KEY`/`OPENAI_API_KEY` (triangulation GEO, optionnel) — toutes via `wrangler secret put`, sans redéploiement.
>
> ## ✅ S7 COCKPIT PREMIUM LIVRÉ (2026-06-19) — worker `4b6612db`, `engine:S7.0`, commit `3e16a8d`, SW `v5.27.24`.
> Suite au retour « downgrade » : la vue site (clic « Auditer »/pastille de score) est désormais un **vrai cockpit** = 4 cartes KPI + **radar SVG** (remplace les barres) + **courbe 30 j** + findings enrichis (priorité/gain/tag) + Historique/Relancer. Endpoint `GET /sites/:id/cockpit` ; CWV stockés (colonne `cwv`). SSL = « valide » sans J-XX (souverain). Reste pareil : **V2** (Search Console, Wix profond, crawl) + reliquats optionnels.

---

## 0. Reprendre en 3 gestes

1. **Lire d'abord** : `SENTINEL_BRIEF.md` (source de vérité, racine `KEYSTONE_OS`) + la mémoire `sentinel-pad.md` (auto-chargée via MEMORY.md).
2. **Vérifier l'état prod** : `curl https://keystone-os-api.keystone-os.workers.dev/api/sentinel/health` → doit répondre `engine:S7.0`.
3. **Respecter la discipline deploy** (§4 ci-dessous) — c'est du **prod-critique** (Key Form, Smart Agent, SDQR tournent sur le même worker).

## 1. État actuel (déployé 2026-06-19)

- **S0** coquille (sites + détection plateforme + barème STARTER 1 / PRO 3 / MAX 5 / Admin ∞).
- **S1** battement de cœur (check uptime/TTFB, cron `*/5`, cockpit live).
- **S1.5** alertes web push (down/rétabli).
- **S2** audit on-page + score (SEO/sécurité/accessibilité + findings).
- **S3** performance (Core Web Vitals via Browser Rendering / `@cloudflare/puppeteer`, **flag `nodejs_compat` actif**).
- **S4** clé en main **déterministe** : chaque finding a un `fix` { steps par plateforme + code à coller }, findings dépliables + bouton Copier + **export PDF**.
- Worker `b5663fe4` · SW `v5.27.19` · 4 tables D1 (`sentinel_sites/checks/push_subs/audits`).
- Isolation : préfixe `sentinel_` (D1) · `snt-` (CSS/DOM) · `/api/sentinel/` (routes). Code : `workers/src/routes/sentinel.js` + `app/sentinel.js` + `app/sentinel.css`.

## 2. ▶️ SPRINT À FAIRE : S4.1 — finir le clé en main

Deux parties.

### Partie A — IA rédactionnel (génère le texte à la place du client)
- **But** : pour les correctifs « texte » (méta description, FAQ AEO), un bouton **« Rédiger avec l'IA »** qui produit le contenu réel (pas un gabarit).
- **Worker** : nouvelle route `POST /api/sentinel/sites/:id/suggest` `{ kind: 'meta' | 'faq' }`.
  - Appel IA : `import { KS_AI_MODEL } from '../lib/ai-model.js'` puis `await env.AI.run(KS_AI_MODEL, { messages:[{role:'system',…},{role:'user',…}] })`. Extraire le texte avec le motif `_aiText` de `workers/src/routes/ghostwriter.js` (~ligne 632).
  - **Métrage OBLIGATOIRE** (cf. `MANIFESTE_NOUVELLE_APP.md §10`) : `import { isEnforceEnabled, consumeCredits, refundCredits } from '../lib/ai-credits.js'` + budget guard/`recordUsage` depuis `lib/ai-budget.js`. Câblage type : `if (isEnforceEnabled(sub)) { r=consumeCredits(env,{bucketKey:sub,plan,tool:'sentinel'}); if(!r.ok&&r.blocked) return 429 } → env.AI.run → recordUsage(...) ; refund si échec après débit`. (Copier le câblage d'une route IA existante, ex. ghostwriter.)
  - Best-effort : si IA indispo → message propre, le gabarit déterministe reste.
- **Front** (`app/sentinel.js`, dans `_findingsHTML` / le fix card) : bouton « Rédiger avec l'IA » sur les fix `meta_missing` (+ une carte FAQ AEO) → appelle `/suggest` → affiche le texte généré + bouton Copier.

### Partie B — Envoi e-mail au webmaster ✅ DÉCISION ACTÉE : **Cloudflare Email** (souverain)
- **Charger la skill `cloudflare-email-service`** au démarrage — elle a les détails (binding d'envoi OU REST, domaine vérifié, DKIM/SPF, setup wrangler). Ne pas deviner.
- **Setup** : domaine d'envoi (`protein-keystone.com`), DKIM/SPF, binding « Send Email » dans `workers/wrangler.toml` (ou API REST Email Sending).
- **Worker** : `POST /api/sentinel/sites/:id/send-report` `{ email }` (auth JWT, valider l'e-mail, rate-limit léger) → construit le rapport (réutiliser les findings+fixes de l'audit stocké) → envoie au webmaster. Texte clair + liste des correctifs + code.
- **Front** : bouton **« Envoyer au webmaster »** dans le panneau d'audit → champ e-mail → POST → confirmation.
- **Suivi « résolu »** : la **boucle de vérif est déjà implicite** (relancer l'audit recalcule les findings → ce qui est corrigé disparaît). Un suivi formel « coché fait » par le webmaster (mini-portail à token) = **option S4.2**, pas bloquant.

### Définition de fini S4.1
Bouton « Rédiger avec l'IA » fonctionnel (métré) + bouton « Envoyer au webmaster » qui envoie un vrai e-mail via Cloudflare Email. Bump `SENTINEL_ENGINE_VERSION` → `S4.1`. Tests + deploy + smoke.

## 3. Suite de la feuille de route (après S4.1)

- **S5 — GEO (LE killer)** : interroger ChatGPT + Perplexity + Gemini (grounding) via `callLLM`/BYOK (cf. mémoire `byok-moteur-universel`) → détecter si le site est cité, position, sentiment → **axe Visibilité IA (GEO)** au score. Cadence hebdo, métré. Leviers coût : BYOK (le client paie) + Gemini 5000 prompts/mois gratuits. C'est le différenciant n°1.
- **S6 — Finitions** : présence locale (Google Business / NAP), concurrence (comparer à 2-3 concurrents), accessibilité avancée. → complète le **radar 7 axes**.
- **V2** : Google Search Console (positions Google réelles, OAuth par site), intégration Wix profonde, crawl multi-pages.

## 4. ⚠️ Discipline de déploiement (NE PAS DÉVIER)

- **Worker** : `cd workers && npx wrangler deploy` **uniquement avec autorisation explicite de Stéphane** à CHAQUE deploy. **AVANT** : `git stash push -- workers/src/routes/pulsa-responses.js` (WIP Key Form non vérifié) ; **APRÈS** : `git stash pop`.
- **Ne JAMAIS committer** `workers/src/routes/pulsa-responses.js` ni les `*.md` untracked (briefs, handoffs) ni `_design-lab/` `_herolab/`. `git add` **fichiers nommés** uniquement.
- **Front** : `git add <fichiers> && commit && git push origin main` → Vercel auto. **Bump SW** obligatoire (`node scripts/bump-sw-version.js`) si fichiers front changés ; cache-bust `app.html` (`sentinel.css?v=N+1`) si le CSS change.
- **Tests avant deploy** : `node --check` (copier en `/tmp/x.mjs` pour l'ESM) sur les fichiers touchés ; pour le worker, `wrangler deploy --dry-run --outdir /tmp/x` si dépendance/binding nouveau.
- **Smoke après deploy** : `curl …/api/sentinel/health` (engine attendu) **+ pads critiques** `…/api/smart-agent/health` et `…/api/keynapse/health` (confirmer que le worker boote — surtout après tout changement de config/flag/dep).
- Commits en français, signés `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## 5. Garde-fous & rappels

- `nodejs_compat` est ACTIF (requis par puppeteer S3) — ne pas le retirer.
- Binding `[browser]` = Browser Rendering (perf S3), best-effort. **Browser Rendering doit être activé sur le compte Cloudflare** ; sinon l'axe Performance affiche « n/a » (le reste tient).
- Perf et IA = **on-demand uniquement** (jamais dans le cron) → coût borné.
- Mettre à jour `SENTINEL_BRIEF.md` (§12 roadmap + §13 journal de deploy) et la mémoire `sentinel-pad.md` à chaque sprint livré.

---
*Créé 2026-06-19, fin d'une longue session (S0→S4 livrés). Auteur : Claude. Décision e-mail webmaster = Cloudflare Email.*
