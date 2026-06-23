# HANDOFF — Smart Dynamic QR : enrichir la bibliotheque de design (Pattern / Eyes / Colors), elaguer les Templates, refaire les Frames + cadres SUR-MESURE (SVG)

> ============================================================================
> ## STATUT 2026-06-23 : CHANTIER LIVRE ET DEPLOYE EN PROD (lire CECI d'abord)
> ============================================================================
> SW prod = **v5.28.31-sdqr-anneau-valide**. Tout FRONT-only, jsQR-valide, npm 43/43,
> Unicode 0/0, /r/:shortId + qr_redirects + qr_scans INTOUCHES (additif, mergeDesign
> redessine les anciens QR a l'identique). Memoire produit a jour : `sdqr-refonte-interface.md`.
>
> ### CE QUI EST EN PROD (suite de commits sur main)
> - **Lot A `2efe4f5` (SW v5.28.24)** : modules **Fluide** + **Petale** ; yeux **Doux.point /
>   Cercle.arrondi / Arrondi.feuille** ; **yeux 2 TONS** (anneau vs pupille + interversion,
>   `design.eye.innerColor`) ; 4 cadres maison. ECARTES jsQR (cassent le timing pattern) :
>   Etoile, Points varies, Barres V/H, yeux Pointille/Etoile.
> - **Lot B `5dae598` (v5.28.25)** : **import cadre SUR-MESURE SVG** (`sanitizeFrameSvg`
>   DOMParser anti-XSS + contrat de slot `<rect id="qr-slot">` tolerant + data-URI inline
>   <=32Ko ; ZERO worker, ZERO R2). `d69b629` (v5.28.27) : libelle en clair + bouton
>   **« Telecharger un gabarit »** (`_customFrameTemplate`).
> - **Refonte PANNEAU DESIGN `f331089` (v5.28.28)** : **Modules en cartes-apercu QR**
>   (vraie mini-QR par forme) ; **Logo** boutons Remplacer/Retirer visibles + **11 LOGOS
>   RESEAUX** (`LOGO_BRANDS`, dessines maison) + icones ; **Couleurs** nuancier compact
>   moderne (`COLOR_SWATCHES` 8 teintes) ; **onglet Modeles SUPPRIME**. `e8a4d25` (v5.28.29) :
>   **Fond transparent** (case a cocher → bg='transparent').
> - **CADRES RONDS** : `4c8efc2`/`1afe11f` iterations, puis **`8d7b45e` (v5.28.31) =
>   cadre rond UNIQUE « Anneau »** reproduit a l'identique de la ref « Modele Cadre » de
>   Stephane (anneau EPAIS + 3 arcs fins haut/gauche/droite + accroche COURBE bas).
>   **Cercle + Crochets RETIRES du selecteur** (decision Stephane ; cases de rendu gardees
>   pour compat). Cadres restants dans le selecteur : Aucun / Bandeau / Encadre / Pastille /
>   Bandeau haut / Plaque / **Anneau** + import SVG sur-mesure.
> - **Modeles (Templates)** : Stephane a d'abord dit « ne rien retirer », puis l'onglet
>   entier a ete SUPPRIME (remplace par les logos reseaux).
>
> ### LECONS DURES (a respecter en continuation)
> 1. **REPRODUIRE LES REFERENCES AU PIXEL, NE PAS IMPROVISER.** Stephane s'est agace quand
>    j'ai ajoute des elements qu'il n'avait pas demandes (arcs, proportions au juge). Methode
>    qui a marche : reproduire SA ref dans un banc local, comparer soi-meme au pixel, iterer
>    jusqu'a l'identique, MONTRER avant de deployer, deployer seulement apres son « c'est ca ».
> 2. **ARTEFACT jsQR 300 px** : des couleurs UNIES foncees a fort contraste (indigo #4338ca,
>    bordeaux #7f1d1d, slate #1e293b...) ECHOUENT le decodage jsQR a **300 px PILE** mais
>    PASSENT a 170/200/240/280/320/360/420 → faux-negatif du raster canvas. **Pour valider
>    des COULEURS, tester a 280+170 (pas 300) et se fier au contraste (`_designContrast` >=3:1).**
> 3. **Garde-fou scannabilite = banc Puppeteer headless** `_design-lab/sdqr/run-scan.mjs`
>    (sert le repo statique + Chromium + lit `window.__SCAN_ROWS`/`__SCAN_DONE` ; flags
>    `--shot` capture, `--sel` element, `--wait` global). Bancs reutilisables :
>    `scan-test / scan-winners / scan-candidates / sanitize-test / frames-round / design-refresh /
>    scan-swatches / _target.html` (ce dernier = la repro validee du cadre Anneau).
> 4. **DEPLOY** : `node scripts/bump-sw-version.js --suffix=...` puis `git push origin main`
>    (Vercel auto) ; confirmer au curl que prod sert la nouvelle version AVANT d'annoncer ;
>    `git add` EXPLICITE (jamais `-A`) ; commits ASCII finissant par Co-Authored-By.
>
> ### BACKLOG / OUVERT (optionnel, non lance)
> - **Logo Snapchat** = le moins net des 11 logos reseaux (dessine main) → a affiner ou retirer.
> - Autres cadres ronds/elabores = via l'import SVG sur-mesure (l'utilisateur les dessine).
> - Test SCAN REEL sur telephone (jsQR est un proxy fiable mais l'appareil = verite terrain).
> - Eventuel : vrais logos de marque haute-fidelite, plus de modules/yeux (sous garde-fou jsQR).
>
> ### POINTEURS CODE
> - Moteur : `app/sdqr-render.js` (`renderQrCustom`, `_moduleShape`, `_anchorShape`,
>   `FRAME_OPTS`, `_frameGeometry`, `sanitizeFrameSvg`, `mergeDesign`, `DEFAULT_DESIGN`).
> - UI : `app/sdqr.js` (`_renderDesignPanel`/`_wireDesignPanel`, `SHAPE_OPTS`, `EYE_PRESETS`,
>   `LOGO_BRANDS`, `COLOR_SWATCHES`, `_moduleCardSvg`, `_customFrameTemplate`).
> - CSS : `app/style.css` (`.sdqr-module-card`, `.sdqr-swatch`, `.sdqr-eye-2tone`,
>   `.sdqr-logo-action`, `.sdqr-customframe*`).
>
> ### ORDRE A COLLER POUR CONTINUER (nouvelle conversation)
> > « Lis `HANDOFF_SDQR_DESIGN_LIBRARY.md` (section STATUT 2026-06-23 en haut) et la memoire
> > `sdqr-refonte-interface.md`. Le chantier bibliotheque de design Smart Dynamic QR est
> > DEPLOYE (SW v5.28.31). Je veux <DECRIRE LA SUITE : ex. affiner le logo Snapchat / ajouter
> > X / autre retouche design>. RESPECTE : reproduire mes references AU PIXEL sans improviser,
> > banc d'essai + scan-test jsQR (280+170 pour les couleurs, pas 300) AVANT tout code,
> > me MONTRER avant de deployer, front-only, ne jamais casser les QR prod, indigo sans
> > toucher Key Form, Unicode 0/0, npm vert, pas de git add -A, bump SW + push main. »
>
> ============================================================================
> (Ci-dessous : le brief d'origine du chantier, conserve pour contexte historique.)
> ============================================================================

> A coller au DEBUT d'une nouvelle conversation Claude Code dans ce projet.
> Objectif : porter le panneau Design (vue detail, 6 onglets) au niveau de richesse
> de la reference QR Tiger, EN gardant le garde-fou de scannabilite jsQR.
> **MAQUETTE / BANC D'ESSAI D'ABORD a valider AVANT tout code** (methode anti-aveugle du projet).
> Memoire produit complete : auto-memory `sdqr-refonte-interface.md`.

---

## 0. CONTEXTE (deja fait — NE PAS refaire)

KEYSTONE_OS — PWA (frontend `app/*.js` vanilla, deploye par Vercel sur **protein-keystone.com** au `git push origin main`) + backend Cloudflare Workers (`workers/`, `cd workers && npx wrangler deploy`).

Le pad **Smart Dynamic QR** (`app/sdqr.js`, renderer `app/sdqr-render.js`) a un **panneau Design a 6 onglets** (Modules / Yeux / Logo / Couleurs / Cadre / Modeles), qui vit dans la **fiche d'un QR** (`_openQrDetail` -> `_renderDesignPanel` / `_wireDesignPanel`) ET, depuis le chantier « creation 3 etapes », **aussi dans l'etape 3 de la creation** (memes fonctions, `opts.create`). Etat en PROD au handoff : SW **`v5.28.23-sdqr-notes-delete-https`**, worker version `9d2acf1d`.

**Inventaire ACTUEL du moteur (`app/sdqr-render.js` — A RELIRE pour la liste exacte) :**
- Modules (`SHAPE_OPTS` + `_moduleShape`) : ~7 formes (carre, point, cercle, arrondi, losange, croix, classy/plein).
- Yeux (`EYE_PRESETS` dans `sdqr.js` + `_anchorShape`/`anchorPreviewSvg`) : ~10 styles nommes (combos anneau exterieur / centre : carre, point, arrondi, squircle/doux, feuille...).
- Couleurs (`COLOR_AMBIANCES` dans `sdqr.js`) : ~8 palettes par ambiance + unie/degrade + `design.eye{distinct,color}` (UNE couleur d'yeux) + fond transparent ; garde-fou contraste `_designContrast`.
- Cadre (`FRAME_OPTS` + `_frameGeometry` + enveloppe dans `renderQrCustom`) : 5 styles (Aucun / Bandeau / Encadre / Pastille / Bandeau haut) + accroche editable (<=28 car.) + couleur.
- Modeles (`INTENT_MODELS` + `_applyModel`) : modeles par intention (reseaux a leurs couleurs / par usage).

**Garde-fou de scannabilite EXISTANT et REUTILISABLE : `_design-lab/sdqr/scan-test.html`** — decode le rendu du VRAI moteur avec **jsQR** a 300px ET 170px. C'est l'outil de validation OBLIGATOIRE de toute nouvelle forme/oeil/cadre.

**LECONS DURES deja apprises (cf `sdqr-refonte-interface.md`) — les YEUX et certains motifs tolerent peu de fantaisie :**
- Yeux **Etoile / Pointille / Cible** : ECARTES (finder patterns trop deviants -> jsQR casse).
- Yeux **rounded/diamond** combo : echoue -> le « Losange » utilise dot/diamond.
- Cadre **« Ticket » pointille** : ECARTE (echoue jsQR).
- Modeles **« par contour »** (cercle/galet/badge non rectangulaires autour d'un QR carre) : R&D, ecartes.
- **=> Plusieurs items entoures en rouge par Stephane (ci-dessous) RISQUENT d'echouer le jsQR.** Regle : on IMPLEMENTE ce qui passe le scan-test aux 2 tailles ; pour ceux qui echouent, on trouve une variante bornee OU on les ECARTE en le DISANT (jamais livrer un design qui ne scanne pas).

**REGLE D'OR PROD : un `short_id` imprime resout POUR TOUJOURS.** Tout est ADDITIF, front-only par defaut. `design` est un blob OPTIONNEL de l'entite ; `mergeDesign`/`DEFAULT_DESIGN` redessinent les anciens QR a l'identique. Le renderer NE TOUCHE PAS `/r/:shortId` ni `qr_redirects`/`qr_scans`.

---

## 1. OBJECTIF (ce que veut Stephane — captures QR Tiger annotees en rouge)

1. **Pattern (Modules)** : completer la bibliotheque avec les motifs entoures.
2. **Eyes (Yeux)** : completer avec les yeux entoures.
3. **Colors** : atteindre la parite (unie / degrade / **couleur d'yeux personnalisee a DEUX tons + interversion** / fond + transparent).
4. **Templates (Modeles)** : **supprimer ceux qui ne convainquent pas** (curation).
5. **Frame (Cadre)** : **realiser les cadres entoures** + **permettre d'importer des cadres SUR-MESURE** (concus sur Illustrator -> SVG).

---

## 2. DECODAGE DES RONDS ROUGES (cible — a confirmer visuellement avec Stephane sur ses captures)

### Pattern (motif du corps) — entoures
- Carres « mosaique » (carres moyens espaces), **Points** (petits ronds), **Etoiles / scintillement** (4 branches), **Plein dense** (classy), motif **vertical / petits points**, **fluide arrondi** (modules connectes), **points de tailles variees**, **losanges**.
- Deja presents (a verifier) : carre, point, arrondi, losange, classy. **NOUVEAUX a ajouter** : etoiles/scintillement, points de tailles variees, barres verticales, fluide/connecte.
- ⚠ jsQR : « etoiles » et « points varies » peuvent fragiliser le scan -> scan-test obligatoire, version bornee (ne pas trop evider les modules).

### Eyes (yeux) — entoures
- Ligne 1 (les 6) : anneau **carre** x centre **carre / point**, anneau **cercle** x centre **carre / point**, + variantes arrondies.
- Ligne 3 : **feuille**, **etoile / concave 4 branches**, **oeil pointille** (anneau en pointilles + pupille ronde).
- Deja presents (a verifier) : carre, point, arrondi, squircle, feuille. **NOUVEAUX vises** : anneau **cercle** (rond plein), **concave/etoile**, **pointille**.
- ⚠ jsQR : anneau cercle = souvent OK ; **concave/etoile et pointille ont deja ete ECARTES** (echec detection). A re-tenter avec variantes tres bornees ; si echec, ECARTER en le disant a Stephane.

### Colors — vises
- Toggle **Unie / Degrade / Couleur d'yeux personnalisee** (le 3e est une case a cocher, pas un mode exclusif).
- **Couleur d'yeux a DEUX tons** : 2 selecteurs (ex. `#054080` et `#f30505`) avec un bouton **interversion (fleche double)**. ⚠ SEMANTIQUE A CONFIRMER avec Stephane (cf §4) : 2 tons = anneau vs pupille ? ou degrade d'yeux ? Le moteur actuel n'a qu'`eye.color` unique -> extension `design.eye{outerColor, innerColor}` ou `eye.color2`.
- **Fond** + **Fond transparent** (deja en place — verifier la parite UI).

### Templates (Modeles) — curation
- Stephane veut **retirer** les modeles peu convaincants. **Decision §4** : il faut SA liste de ceux a garder/jeter (ou je propose une selection curee qu'il valide). Ne rien supprimer sans validation.

### Frame (Cadre) — REALISER les entoures (≈ 7) + sur-mesure
Entoures (descriptions) :
1. **Bandeau bas plein « SCAN ME »** (banniere noire sous le QR).
2. **Cercle plein** (fond rond fonce, QR au centre sur plaque blanche) + « SCAN ME ».
3. **Bandeau bas gris** « SCAN ME ».
4. **Plaque carree arrondie** (fond fonce arrondi) + bandeau « SCAN ME ».
5. **Bandeau gris** variante.
6. **Coins « scan » (crochets d'angle)** sur fond fonce + « SCAN ME » en haut.
7. **Cercle a anneau pointille** + **« SCAN ME » en texte courbe**.
+ **CADRES SUR-MESURE** : importer un SVG (concu Illustrator) qui sert d'habillage autour du QR.
- ⚠ jsQR : tout cadre a **fond plein/fonce** exige une **plaque blanche** (zone de silence) derriere le QR -> garder « QR fonce sur blanc » meme dans un cadre plein (regle Keystone deja actee). Le texte courbe = SVG `<textPath>`. Re-tester chaque cadre au scan-test.

---

## 3. REALITE DU CODE (ou agir)

- **Moteur de rendu** : `app/sdqr-render.js` -> `renderQrCustom(text, design, sizePx)` (retourne un **string SVG**), `mergeDesign`, `DEFAULT_DESIGN`, `SHAPE_OPTS`, `_moduleShape`, `_anchorShape`/`anchorPreviewSvg`, `FRAME_OPTS`, `_frameGeometry`. **C'est ICI qu'on ajoute formes / yeux / cadres / couleur d'yeux 2 tons.**
- **UI du panneau Design** : `app/sdqr.js` -> `_renderDesignPanel(qr, opts)` (onglets `.sdqr-dtab` Modules/Yeux/Logo/Couleurs/Cadre/Modeles), `_wireDesignPanel`, `_refreshDesignPanelDom`, `_renderShapePill`, `EYE_PRESETS` + `_eyePresetActive`, `COLOR_AMBIANCES` + `_ambianceActive`, `INTENT_MODELS` + `_applyModel`, `_colorField`, `_designContrast` (garde-fou contraste), `_updateContrastBadge`.
- **Modeles a elaguer** : `INTENT_MODELS` (`sdqr.js`).
- **Garde-fou scannabilite** : `_design-lab/sdqr/scan-test.html` (jsQR 300px + 170px) — l'enrichir avec les nouveaux echantillons.
- **Cadres sur-mesure (SVG import)** : nouveau. Stockage possible facon SA-cards (bucket R2 `HELP_MEDIA`, routes worker `POST .../image` + `GET .../card-img/<key>`, `validateCards` anti-traversal) OU data-uri inline borne. **SECURITE OBLIGATOIRE** : un SVG uploade est du code -> **sanitization** (retirer `<script>`, `on*`, `<foreignObject>`, refs externes) + CSP. Definir un **contrat de slot** : le SVG doit reserver une zone (ex. `<rect id="qr-slot">` ou viewBox conventionne) ou le QR (foncE sur plaque blanche) est insere.

---

## 4. DECISIONS A PRENDRE AVEC STEPHANE (avant/pendant la maquette)

1. **Templates a supprimer** : sa liste exacte (ou je propose une selection curee a valider). Rien de supprime sans accord.
2. **« Couleur d'yeux 2 tons + interversion »** : que signifient les 2 couleurs ? (a) anneau vs pupille des yeux ; (b) degrade applique aux yeux ; (c) 2 des 3 yeux de couleurs differentes. -> definit l'extension du modele `design.eye`.
3. **Cadres sur-mesure** — niveau d'ouverture : (a) **upload SVG libre** (puissant mais surface de securite a sanitizer serieusement + stockage R2) ; (b) **bibliotheque de cadres maison etendue** (plus de presets dessines par nous, pas d'upload) ; (c) **les deux**. + ou stocke-t-on (R2 vs data-uri) et le contrat de slot QR.
4. **Items jsQR-risques** (yeux concave/etoile/pointille, motifs etoile/points-varies) : si le scan-test echoue malgre les variantes bornees, on les ECARTE — confirmer que c'est acceptable (qualite scan > exhaustivite visuelle).

---

## 5. CONTRAINTES TECHNIQUES (IMPERATIVES)

- **MAQUETTE / BANC D'ESSAI D'ABORD**, valide par Stephane AVANT tout code (historique de derive). Iterer le visuel dans `_design-lab/sdqr/*.html` liant le VRAI `app/style.css` + le VRAI `sdqr-render.js`, screenshots desktop+mobile. Le **scan-test jsQR** valide chaque nouvel item AVANT de l'ajouter a la bibliotheque.
- **NE JAMAIS CASSER LES QR EN PROD.** Renderer = additif (`design` optionnel, defauts inchanges -> anciens QR identiques). `/r/:shortId`, `qr_redirects`, `qr_scans` INTOUCHES. Si un sprint touche le worker (cadres sur-mesure R2) : gardien `python3 scripts/qr_prod_guard.py verify _backups/qr-baseline.json` **AVANT et APRES** `wrangler deploy` (auth wrangler OK au handoff) ; stash du WIP non verifie avant deploy.
- **Charte INDIGO `#6c6cf5`** pour le chrome ; **JAMAIS de dore** ; jamais de `replace_all` global sur un hex partage avec Key Form (`#c9a96e`/`#c9a84c`). Les couleurs CHOISIES par l'utilisateur pour SON QR sont libres (c'est le contenu).
- **Key Form (`pulsa*`)** = PROD critique, intouchable.
- **Unicode** : 0 U+202F / 0 U+00A0 (scan par codepoint apres chaque edition).
- **Tests** : `npm test` vert + `node --check` apres chaque fichier JS.
- **Git** : stager explicitement (JAMAIS `git add -A`), commits ASCII finissant par `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`, sur `main`.
- **Deploiement front** : `node scripts/bump-sw-version.js --suffix=<...>` puis `git push origin main` ; recharger 2x / `?ks_reset=1`.
- **Autonomie** : apres maquette validee + decisions §4 prises, aller au livrable d'un trait, par lots ; s'arreter SEULEMENT pour une decision de Stephane ou un deploy worker ; rapport apres chaque lot ; ne jamais relancer sur le go-to-market.

---

## 6. ORDRE POUR DEMARRER LA NOUVELLE CONVERSATION (a coller)

> « Lis `HANDOFF_SDQR_DESIGN_LIBRARY.md` a la racine de KEYSTONE_OS et execute-le : enrichir la bibliotheque de design du pad Smart Dynamic QR — **Pattern, Eyes, Colors** (completer d'apres mes captures QR Tiger annotees en rouge), **elaguer les Templates** peu convaincants, et pour **Frame** realiser les cadres entoures + me permettre d'importer des cadres **sur-mesure (SVG Illustrator)**. **Commence par une maquette / un banc d'essai** liant le vrai `style.css` + le vrai `sdqr-render.js`, et **valide chaque nouvel item au scan-test jsQR** (`_design-lab/sdqr/scan-test.html`) AVANT de l'ajouter — montre-moi le tout AVANT de coder en prod. Respecte les contraintes (ne jamais casser les QR prod + gardien si worker, indigo sans toucher Key Form, Unicode 0/0, npm test vert, pas de git add -A, bump SW + push main). Pour la curation des Templates, la semantique de la couleur d'yeux a 2 tons, et le perimetre des cadres sur-mesure (upload SVG vs bibliotheque maison + securite/stockage) : propose et demande-moi. »

---

## 7. POINTEURS RAPIDES
- Moteur : `app/sdqr-render.js` (`renderQrCustom`, `SHAPE_OPTS`, `_moduleShape`, `_anchorShape`, `anchorPreviewSvg`, `FRAME_OPTS`, `_frameGeometry`, `mergeDesign`, `DEFAULT_DESIGN`).
- Panneau Design : `app/sdqr.js` (`_renderDesignPanel`/`_wireDesignPanel`/`_refreshDesignPanelDom`, `EYE_PRESETS`, `COLOR_AMBIANCES`, `INTENT_MODELS`, `_colorField`, `_designContrast`).
- Garde-fou scan : `_design-lab/sdqr/scan-test.html` (jsQR 300/170).
- Cadres sur-mesure (modele R2 a copier) : routes SA-cards dans `workers/src/routes/smart-agent*` (bucket `HELP_MEDIA`, `validateCards`).
- Memoire produit : `sdqr-refonte-interface.md` (lecons jsQR, items ecartes, historique).
