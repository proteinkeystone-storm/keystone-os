# KEY BRAND — Import URL & Export Claude Design (cadrage)

> Brief autoporté pour Opus 4.8. **Aucun code ici — c'est le cahier des charges.**
> Pad concerné : **Key Brand (O-BRD-001)**. Prérequis lecture : `MANIFESTE_NOUVELLE_APP.md`, `KEY_BRAND_BRIEF.md`, `KEY_BRAND_SPRINTS.md`.

---

## 0. Pourquoi ce chantier

Aujourd'hui, remplir une charte dans Key Brand est **100 % manuel** (couleurs, typos, logo saisis à la main). Deux manques :

1. **En entrée** — pas moyen de partir vite d'une marque existante. On devrait pouvoir **pré-remplir une charte depuis l'URL du site de la marque**.
2. **En sortie** — la charte ne sort que pour des humains (page `/b/` + kit .zip de logos). Elle devrait aussi sortir dans un format **avalé directement par Claude Design**, pour que l'IA génère « on-brand » sans ré-analyser le site.

**Ce qu'on NE fait PAS** (tranché avec Stéphane, 2026-07-09) — la vision « plateforme » de GPT (Brand Knowledge Pack en 12 fichiers, standard `.well-known/keybrand`, ingestion de PDF de charte, connecteurs Figma, extraction IA du ton de voix / des patterns UX) est **abandonnée**. On garde deux features concrètes, ci-dessous.

**Principe cardinal du pad : ZÉRO IA.** L'extraction est **déterministe** (parsing CSS/DOM). Aucun appel IA métré, aucun coût récurrent. Si un jour on veut de l'extraction sémantique, ce sera une option **BYOK** séparée — hors périmètre de ce brief.

---

## 1. Le modèle de données existant (ne pas le refondre)

La charte vit dans `_chart.draft`, forme `_emptyKit()` (`app/key-brand.js`, ~ligne 211). **Géométrie variable : tout est optionnel sauf `meta.name`.** Réf. complète : `KEY_BRAND_SPRINTS.md §1.5`.

```
meta:       { name, baseline, credit }
logo:       { variants:[ {id, label, name, assetId, ext, …} ], protection:{ratio,basis}, minSizes:{printMm,digitalPx} }
colors:     { palette:[ {id, name, hex, role:'primary'|'secondary'|'extra', cmyk, pantone, story, nightHex} ], dark }
typography: { fonts:[ {id, role:'title'|'body'|…, source:'google'|'declared', family, axis(=weights), buyUrl} ] }
rules:      { interdits:[], custom:[] }
branding:   { motion, symbolism:[], photo }
settings:   { footer }
```

Points d'ancrage utiles déjà présents :
- Utilitaires couleur importés en tête de `key-brand.js` : `hexToRgb`, `rgbToCmyk`, `contrastRatio`, `wcagVerdict`, `harmonies`, `tonalScale`, `relLuminance`, `nightVariant`. → **La Phase 1 les réutilise** (dériver cmyk/nightHex, vérifier contrastes) et la Phase 2 aussi (tokens).
- `GOOGLE_FONTS`, `FONT_CATEGORIES`, `fontMeta` (`key-brand-fonts.js`) → **matcher une police détectée** contre le catalogue ; sinon `source:'declared'`.
- Export existant `_downloadKit()` (~1275) : ne zippe que les logos, via `buildZip` + `saveBlob`. → **La Phase 2 est un second export à côté, mêmes utilitaires.**
- Worker : routes `/api/keybrand/*` (auth JWT, tables isolées `kb_`). La page publique `GET /b/:slug` sert **`published_json`** (le snapshot publié, jamais le brouillon). → **La Phase 2 dérive de `published_json`**, pas du draft.

**Impératif : ne pas casser** la charte multi-tenant, la géométrie variable, ni la page `/b/`. Voir pièges connus du pad (cache d'import harnais, deux registres d'icônes, accent musée `_chromeAccent`, équilibre des div dans `key-brand-page.js`).

---

## 2. PHASE 1 — Importer une charte depuis une URL (déterministe, sans IA)

### But
Bouton « **Importer depuis un site** » (à la création d'une charte ou dans une charte vide). L'utilisateur colle une URL → Key Brand **pré-remplit un `draft`** → l'utilisateur **valide/corrige** dans les onglets existants (Couleurs, Typographies, Logo) avant enregistrement.

### Ce qu'on extrait (et seulement ça)
| Champ charte | Source déterministe | Notes |
|---|---|---|
| `colors.palette[]` | Couleurs CSS dominantes (styles calculés / variables CSS / `<meta name=theme-color>`) | Dédupliquer, trier par fréquence, cap ~8. Rôle `primary` = la plus saillante (theme-color / couleur de marque), reste `secondary`/`extra`. Dériver `cmyk` via `rgbToCmyk`, `nightHex` via `nightVariant`. |
| `typography.fonts[]` | `font-family` des styles calculés (titres vs corps) | Nettoyer les fallbacks système. Matcher contre `GOOGLE_FONTS` (`fontMeta`) → `source:'google'` ; sinon `source:'declared'` (family brute). Rôles `title`/`body` selon les niveaux de titre. |
| `logo.variants[]` | `<link rel=icon>` haute résolution, `og:image`, `<img>` de header/`<svg>` inline logo | SVG préféré. Récupérer 1-2 candidats, l'utilisateur choisit/supprime. |
| `meta.name`, `meta.baseline` | `og:site_name` / `<title>`, `meta description` / slogan header | Pré-remplissage doux, éditable. |
| `colors.dark` | `prefers-color-scheme: dark` si le site en a un | Optionnel. |

**On NE tente PAS** : espacements « compris », composants UI, ton de voix, patterns UX. (Trop flou sans IA, et hors périmètre.)

### Réutilisation obligatoire (ne pas réécrire de crawler)
- **Sentinel crawle déjà** en multi-pages (pad O-GEO-001) et il y a `htmlToText` dans la chaîne de contenu. → **Réutiliser la machinerie de fetch/parse existante** (worker souverain). Ne PAS ajouter une dépendance de scraping tierce.
- L'extraction couleurs/typo se fait sur le **HTML + CSS récupérés** (styles calculés côté worker si possible, sinon parsing des feuilles liées + inline). Rester dans le stack gratuit/souverain.

### UX de validation (l'étape clé)
Après extraction, montrer un **écran de proposition** : « Voici ce qu'on a détecté ». L'utilisateur **corrige / complète / supprime / valide** avant que le `draft` soit écrit. Jamais d'écrasement silencieux d'une charte existante — l'import crée une **nouvelle charte** (ou remplit une charte **vide**), respecte le cap 30/tenant.

### Garde-fous
- Timeouts / sites injoignables → message clair, pas de charte cassée.
- Sites JS-only (rendu client) : la détection sera pauvre → le dire honnêtement (« peu de styles détectés, complétez à la main »), ne pas planter.
- Aucune donnée du site tierce persistée ailleurs que dans le `draft` de l'utilisateur.

---

## 3. PHASE 2 — Exporter un Design System « Claude-Design-ready »

### But
Bouton « **Exporter → Claude Design** » sur une charte **publiée**. Produit un **bundle** que l'utilisateur dépose dans l'onboarding de Claude Design (ou pointe via une URL/repo public), pour que Claude génère on-brand du premier coup.

### Le contrat d'ingestion de Claude Design (vérifié 2026-07-09)
Claude Design importe un design system par **3 voies** :
1. **URL d'un repo GitHub public** contenant un `design-system-spec.json` qui pointe vers un `design-tokens.json` (couleurs/typo en JSON), des dossiers de composants et des assets SVG.
2. **URL d'un fichier Figma.**
3. **Upload brut** : codebase, deck/PDF on-brand, logos (SVG préféré), codes hex, noms de polices, 2-3 docs de référence.

Structure **indicative** du `design-system-spec.json` (via how-to communautaire, **PAS la doc officielle Anthropic → à re-vérifier sur un import réel avant de figer**) :
```json
{ "schemaVersion": "1.0", "systemName": "…",
  "paths": { "tokens": "/tokens/design-tokens.json", "components": "/components/", "assets": "/assets/icons/" },
  "framework": "react" }
```
Sources :
- https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design
- https://support.claude.com/en/articles/14604416-get-started-with-claude-design
- https://venturebeat.com/technology/anthropic-ships-major-claude-design-overhaul-with-design-system-imports-code-round-trips-and-a-fix-for-its-token-burning-problem
- https://mikekwal.com/blog/claude-design-system-import/ (schéma indicatif)

### Ce qu'on émet (bundle)
Dérivé de **`published_json`** (pas du draft) :
- `design-tokens.json` — **format DTCG** (Design Tokens Community Group, standard W3C). Couleurs (hex + rôle), typo (family, weights, rôles title/body), et l'échelle d'espacements si disponible. **DTCG car portable** : Claude Design ET Figma/Style Dictionary. Ne PAS inventer un schéma maison.
- `design-system-spec.json` — le fichier « manifeste » attendu par Claude Design, qui pointe vers les tokens/assets ci-dessus.
- `logo.svg` (et variantes) — depuis `logo.variants[]`.
- `brand.md` — **un seul doc compact auto-descriptif** (couleurs en hex, typos nommées + où les acheter, règles d'usage `rules`, baseline). Pas l'arborescence en 12 fichiers de GPT : Claude lit mieux un pavé unique.

### Livraison — 2 modes, priorité au ZIP
- **Mode A (80/20) — ZIP téléchargé** que l'utilisateur glisse dans l'onboarding Claude Design (voie « upload brut »). **Prioritaire** : marche pour tout le monde, aucun GitHub requis (les utilisateurs Key Brand ne sont pas des devs). Réutiliser `buildZip`/`saveBlob`.
- **Mode B (bonus technique) — publication vers une URL/repo** pour la voie GitHub-URL native. `published_json` existe déjà côté worker → exposer le bundle (ou son `tokens.json`) en téléchargement sur `/b/:slug`. Différé/optionnel.

**Correction d'une idée initiale** : « pointer Claude sur `/b/` » ne suffit pas — sa voie URL veut un **repo GitHub + fichier spec**, pas une page web quelconque. Le hook réel, c'est **le bundle spec**, pas une URL arbitraire. La page `/b/` reste utile (humain + GEO) mais n'est pas le mécanisme d'import Claude Design.

---

## 4. À vérifier AVANT de figer (ne pas coder à l'aveugle)

1. **Contrat exact de Claude Design** : la voie « upload brut » accepte-t-elle un ZIP tel quel ? Le `design-system-spec.json` est-il vraiment lu, et avec quels champs ? → **Faire un import test réel** avec un bundle jouet avant de figer le format d'export. (Le schéma ci-dessus est communautaire, non officiel.)
2. **Extraction côté worker** : peut-on obtenir des **styles calculés** (sinon parsing CSS brut) dans le stack Sentinel actuel ? Chiffrer la fiabilité couleurs/typo sur 3-4 sites réels de test.
3. **DTCG** : figer la version/forme du format tokens (groupes `color`/`typography`/`dimension`).

---

## 5. Séquencement proposé (sprints)

- **KB-IMPORT-1** — Extraction déterministe (couleurs + typo + logo + meta) côté worker, réutilisant le crawl Sentinel. Sortie = objet `draft` partiel.
- **KB-IMPORT-2** — UI : bouton « Importer depuis un site » + écran de validation/correction → écrit une nouvelle charte.
- **KB-EXPORT-1** — Générateur de bundle (`tokens.json` DTCG + `spec.json` + `logo.svg` + `brand.md`) depuis `published_json`, livré en ZIP.
- **KB-EXPORT-2** (optionnel) — Publication URL/repo pour la voie GitHub native.

Chaque sprint = livrable prod vérifié (harnais `_design-lab/key-brand-harness.html` pour l'UI, curl worker pour l'extraction). Respecter le runbook deploy (front Vercel + bump-sw ; worker `wrangler deploy` séparé).

---

## 6. Rappels pad (pièges connus)
- Deux registres d'icônes — utiliser `icon()` de `app/lib/ui-icons.js`, jamais d'emoji.
- Cache d'import du harnais (KB) : re-vérifier après édition.
- Accent « musée » `_chromeAccent` : ne pas le déséquilibrer.
- `key-brand-page.js` : attention à l'équilibre des `<div>` (autoporté, fragile).
- Isolation stricte : tables `kb_`, routes `/api/keybrand/`. Ne rien fuiter cross-tenant.
