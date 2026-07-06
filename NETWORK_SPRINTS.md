# networK (O-NET-001) — Feuille de sprints

> Ordres d'exécution pour le développement. Compagnon de `NETWORK_BRIEF.md`
> (conception, décisions actées, modèle de données, câblage exact) et de
> `MANIFESTE_NOUVELLE_APP.md` (procédure pad). Harnais d'animation déjà réglé :
> `_design-lab/network-tree-harness.html` → à INTÉGRER, pas à réinventer.
>
> **Convention : `NK-n`. Un sprint = un livrable testable + ≥1 commit.**

## Rappels charte (à respecter à CHAQUE sprint — non négociable)
- **JAMAIS d'emoji** dans l'UI → `icon()` de `app/lib/ui-icons.js`, **pictogrammes
  outline monochrome**. Ajouter au registre les pictos manquants (réseau, appel,
  devis, document, entreprise, établissement, groupe…).
- Font-stack native, `letter-spacing:-0.02em`, **titres `font-weight:900`**,
  **sentence case** (jamais Title Case ni ALL CAPS).
- Thème clair/sombre global respecté ; `backdrop-filter:blur(10px)` sur les surfaces.
- Préfixe **`nk_`** partout (CSS `.nk-*`, localStorage `nk_*`, tables `nk_*`).
- Responsive : pas de largeur px figée par JS, chercher les `@media` existants avant
  d'en ajouter, tester au doigt.
- XSS : échapper (`_esc`) toute saisie AVANT injection HTML.

---

## NK-0 — Socle & câblage (le pad apparaît et s'ouvre vide)  ✅ FAIT 2026-07-06
**But** : `O-NET-001` visible au dashboard, s'ouvre en plein écran avec le chrome
minimal, zéro fonctionnel encore.
> Livré : `app/network.js` + `app/network.css` (préfixe `nk_`, coquille `ws-app`
> standard + chrome networK recherche/Ajouter sur canvas + état vide « Vous ») ;
> picto `network` (hub à nœuds) ajouté à `ui-icons.js` ; import+dispatch
> `ui-renderer.js` ; `CATALOG_DATA` (pads-data.js, plan STARTER) ; JSON PADS +
> manifest + catalog.json ; lien CSS app.html ; **SW bumpé v5.28.218**. Vérifié
> navigateur : ouverture/fermeture OK, 0 erreur console. `search`/`plus`/`user`/
> `chevron-left` déjà au registre.
- Module `app/network.js` (+ `app/network.css`) exportant `export function
  openNetwork(opts = {}) {…}`. Modèle : `app/keynapse.js`.
- `app/ui-renderer.js` : import en tête (zone `:17-31`) + dispatch dans `openTool`
  (bloc `:2224-2240`) : `if (padId === 'O-NET-001') { openNetwork(opts); return; }`.
- `app/pads-data.js` : entrée dans `CATALOG_DATA.tools` (`padKey:null`,
  `published:true`, `plan:"STARTER"`, `ai_optimized:false`, tags, `longDesc`).
- `K_STORE_ASSETS/PADS/O-NET-001.json` (miroir) + `manifest.json` + `catalog.json`.
- Pictos réseau dans `app/lib/ui-icons.js`.
- Chrome minimal : logo networK · recherche · « + Ajouter » · menu « … ». PAS de
  sidebar. Fond plein écran, fermeture propre.
- **Bump SW.**
- ✅ Test : le pad s'active depuis le K-Store, s'ouvre, se ferme, ne casse rien.

## NK-1 — Keystone Tree (intégration du harnais « waou »)  ⭐ GATE — ✅ CODÉ 2026-07-07 (attend GATE iPhone)
**But** : l'arbre animé tourne dans le pad, sur un state en mémoire (données factices).
> Livré : moteur porté dans `network.js` (state module `_cats` = `_MOCK` temporaire →
> NK-2 API), tracé SVG rAF + pills spring + gouttes de lumière + désaturation
> `.nk-focus` + toolbar zoom/pan. Pictos catégories ajoutés au registre (users,
> briefcase, handshake, newspaper, landmark, tag, building, folder, maximize).
> **SW v5.28.220**, CSS `?v=2`. Vérifié en preview desktop (captures) : arbre,
> toggle, contacts en éventail, « Voir les N autres », désaturation, circulation —
> conforme à la maquette, 0 erreur console. **RESTE : validation « waou » Stéphane
> sur iPhone réel** (le GATE ; je ne peux pas la faire à sa place) avant NK-2.
>
> ⚠ 2 durcissements vs harnais (nécessaires hors onglet actif) :
> (1) `render()` appelé DIRECTEMENT à l'ouverture (pas via rAF : un rAF unique ne
> part pas si l'onglet est en arrière-plan) ; (2) `reveal()` utilise un **reflow
> forcé** (`void el.offsetWidth`) au lieu du double-rAF (les transitions CSS
> tournent même sans rAF → pills fiables). Le tracé des fils reste rAF (normal).
> ⚠ Piège test local : le **SW ressert `network.js`/CSS en cache** → pour voir un
> changement, bumper le SW OU tester via import cache-busté ; le preview **throttle
> rAF/timers hors focus** (un screenshot réactive une frame).
- Porter le moteur de `_design-lab/network-tree-harness.html` dans `network.js` :
  tracé SVG dashoffset en rAF (file de jobs, arrêt total au repos), pills spring
  `cubic-bezier(.30,1+ov,.40,1)`, cascade, « Voir les N autres ».
- ⚠ Le centrage vertical vit dans le `transform` → tout transform animé réintègre
  `translate(x,-50%)` (piège documenté, sinon les pills sautent d'une demi-hauteur).
- **Circulation** : gouttes de lumière (`path.flow` `pathLength=100`, dash 1.2/200,
  `blur+drop-shadow`) sur le circuit ACTIF uniquement ; fils actifs classe `.live`
  (colorés) ; désaturation du reste via `body.focus` ; départ retenu par
  `animation-delay` CSS — **JAMAIS de setTimeout pour les flux** (course perdue).
- `prefers-reduced-motion` : fondu simple, circulation coupée.
- Une seule profondeur visible ; toolbar flottante (sélection/pan/zoom/plein écran) ;
  pan+pinch en `transform` borné.
- 🚦 **GATE : validation Stéphane sur iPhone réel (60 fps) AVANT NK-2.**

## NK-2 — Persistance (worker + D1)  ✅ CODÉ 2026-07-07 (attend deploy worker + migration)
**But** : l'arbre lit/écrit du vrai et survit au reload.
> Livré : `workers/src/routes/network.js` (schéma auto-appliqué idempotent + gate
> JWT `_gate` patron keynapse, tenant `default`/`sub`, seed 7 catégories 1re fois,
> CRUD catégorie+contact, garde-fous). Câblé dans `index.js` (import + bloc routes
> `/api/network/*`). Migration source de vérité `workers/src/db/migration_network.sql`
> (nk_categories, nk_contacts id UUID stable, nk_activity source='manual'). Front :
> `_MOCK` supprimé → `_boot()` (cache `nk_cache_v1` rendu instantané puis
> `/bootstrap`), `_buildCats` groupe contacts par catégorie (8 + « Voir les N
> autres »), fallback squelette 7 catégories hors-ligne. SW v5.28.221. Vérifié
> preview : bootstrap → 503 (worker pas déployé) → fallback 7 catégories vides
> propre, 0 erreur console ; contact node porte `data-id` (NK-4).
> **RESTE (bloqué sur autorisation Stéphane)** : `cd workers && wrangler deploy`
> (+ stash WIP Pulsa) puis `wrangler d1 execute keystone-os --remote
> --file=./src/db/migration_network.sql` — ensuite l'arbre persiste pour de vrai.
- Migration D1 : `nk_categories`, `nk_contacts` (id UUID **stable**), `nk_activity`
  (champ `source` défaut `'manual'`) — schéma exact §7 du brief, `tenant_id`+`sub`+index.
- `workers/src/routes/network.js` routé dans `index.js`
  (`if (path.startsWith('/api/network/'))`), **`requireJWT` partout**, tenant
  `'default'` isolé par `claims.sub` (jamais `?tenantId=`).
- Routes : `GET /bootstrap`, `POST|PUT|DELETE /category`, `POST|PUT|DELETE /contact`.
- Cache localStorage `nk_cache_v1` (render instantané, refresh silencieux).
- Catégories par défaut à la 1re ouverture (Clients, Fournisseurs, Partenaires,
  Équipe, Presse & médias, Institutions, Divers).
- ✅ Test : créer via API, recharger, tout revient ; tenants isolés.

## NK-3 — CRUD manuel (on remplit son réseau à la main)  ✅ CODÉ 2026-07-07 (UI vérifiée ; persistance au deploy)
**But** : ajout/édition/suppression complets, à la souris et au doigt.
> Livré (tout dans `network.js` + `.css`) : système overlay/sheet + popover + toast
> réutilisable ; menu **Ajouter** (personne/entreprise/établissement/groupe/nouvelle
> catégorie) ; **formulaire contact** create+edit (nom/type/entreprise/fonction/mail/
> tél/catégorie) ; **formulaire catégorie** create+edit avec sélecteur d'icône (10) ;
> **menu ⋯ catégorie** (renommer/monter/descendre/supprimer, états disabled) ;
> **« + » quick-add** contact dans une catégorie ; **recherche live** (nom/entreprise/
> tag → dropdown → ouvre le contact) ; validation client (nom requis) + toasts.
> Mutations = API-first (`_submit*`/`_delete*`/`_moveCategory` → `_refresh` bootstrap).
> Contact click → formulaire édition (INTERIM ; NK-4 le redirigera vers la fiche).
> SW v5.28.222, CSS `?v=3`. Vérifié preview : menu, formulaires, validation, icônes,
> popover, recherche — 0 erreur console. Offline : submit → toast « Enregistrement
> impossible » (503, worker pas déployé) → **la persistance réelle se vérifie au deploy**.
- Menu « + Ajouter » : personne · entreprise · établissement · groupe · tag ·
  catégorie (bottom-sheet mobile).
- Formulaires création/édition contact (nom, entreprise, fonction, mail, tél, kind).
- Catégorie : renommer, supprimer (contacts orphelins → `category_id` null),
  réordonner (`position`), petit « + » d'ajout rapide dans la pill.
- Recherche live côté client (nom/entreprise/tag) → liste plate → ouvre la fiche.
- État vide soigné (premier lancement : « Vous » seul + invite).
- ✅ Test : parcours complet sans toucher au code.

## NK-4 — Fiche contact (panneau glissant droite)  ✅ CODÉ+DÉPLOYÉ 2026-07-07
**But** : la fiche des maquettes, consultable et éditable.
> Livré (déclenché par le retour iPhone de Stéphane : mobile cassé + fiche absente) :
> **fiche** `_openFiche` — desktop = panneau glissant droite 400px ; mobile = plein
> écran. Header (avatar initiales+teinte, nom, badge=1er rôle ou kind, entreprise,
> fonction), actions tel:/mailto:/sms: + edit, onglets Résumé/Activité/Notes, RÔLES
> & TAGS (chips add/remove via API), Activité = empty state (NK-5), RACCOURCIS 4
> cartes (Missive/Brief/Smart Agent/Publier — ouverture simple, prefill=NK-6), Notes
> textarea autosave debounce. Person/search/list click → fiche (plus le form interim).
> **+ FIX MOBILE (NK-7 avancé)** : breakpoint 820px ; sous 820 la 3ᵉ colonne
> n'existe plus (elle chevauchait — bug prod) → taper une catégorie ouvre une
> **liste plein écran** `_openCatList` (maquette écran 2) → taper un contact = fiche
> plein écran. Pills catégories : `max-width:calc(100vw-122px)` + label tronqué.
> Pictos `phone`/`message` ajoutés au registre. SW v5.28.224, CSS ?v=4. Vérifié
> preview desktop + mobile 375px (pills tiennent, liste, fiche) — 0 erreur.
> **Front-only (worker déjà déployé)** → push main.
- Panneau glissant droite (~400px desktop, plein écran mobile), ✕, n'écrase pas l'arbre.
- En-tête : photo/initiales (avatar = initiales, teinte dérivée du nom), nom, badge
  rôle, entreprise, fonction.
- Actions rapides : tél `tel:` · mail `mailto:` · message `sms:` · « … » (masquer si
  champ vide). Picto outline pour chaque.
- Onglets **Résumé / Activité / Notes** (PAS « Relations » en V1).
- Résumé : rôles (chips + ajout), tags (chips colorées + ajout), notes (autosave debounce).
- ✅ Test : ouvrir/éditer/fermer, chips persistées.

## NK-5 — Journal d'activité manuel (« c'est une histoire »)
**But** : la timeline manuelle, visuellement comme la maquette.
- Onglet Activité : ajout 2 clics = type (appel/email/rdv/devis/document/note/autre,
  chacun son picto outline) + libellé court + date (défaut aujourd'hui),
  `source:'manual'`.
- Affichage relatif « Il y a X jours », tri décroissant.
- Résumé : les 5 dernières + « Voir toute l'activité ».
- ✅ Test : plusieurs entrées, ordre + libellés relatifs corrects.

## NK-6 — Raccourcis « Continuer avec… » (connexion à l'écosystème)
**But** : la fiche pousse vers les autres pads, pré-remplis.
- Contrat : `openTool(padId, { nkContact:{ id,name,company,title,email,phone } })`.
  **Fermer/minimiser le workspace networK AVANT** d'ouvrir la cible (piège z-index).
- Brief Prod : `openTool(id, { prefillData:{…} })` (mécanisme `_prefillForm` existant,
  `ui-renderer.js:2264`) — mapper sur les `fields` réels du pad.
- Missive `openSceau({nkContact})` (hook libellé), Social `opts.compose`,
  Smart Agent ouverture simple, Ghost Writer `initialText`.
- Raccourcis contextuels par rôle (défaut : Missive/Brief/Ghost Writer ; Client : +
  Publier/Smart Agent ; Fournisseur : Brief/Missive/Key Brand).
- Gating : pad non-owned (`getOwnedIds()`) → carte en **mode suggestion** (style
  atténué + 1 ligne d'usage + « Découvrir » → `openKStoreAppDetail`). Jamais agressif.
- ✅ Test : chaque raccourci owned ET locked ; prod-critiques (Key Form/Smart
  Agent/SDQR) intacts.

## NK-7 — Finition & livraison
**But** : prod-ready.
- Responsive mobile complet (arbre compacté, fiche plein écran, bottom-sheet).
- XSS : audit échappement toutes saisies. RGPD : ajouter `nk_*` à l'export Art.20 et
  la purge tenant Art.17.
- Notice `K_STORE_ASSETS/HELP/O-NET-001.json` (gabarit GW 4 zones).
- Doc user `app/lib/keystone-doc.js` (`DOC_SECTIONS` + `DOC_CHANGELOG`).
- `node --check` + smoke prod + **Bump SW** + deploy (worker = **autorisation
  explicite Stéphane + stash WIP Pulsa**).
- Admin → Catalogue → « Synchroniser » → Sauvegarder.
- ✅ Checklist finale §17 manifeste + §checklist brief.

---

## Parké (ne pas coder — cf. brief §12)
Bus d'événements inter-pads (timeline auto), signaux Living Layer, couplage
Capture/Digest, import CSV/vCard, onglet Relations, sous-groupes, upload photo.

*Rédigé 2026-07-06. Zéro IA en V1 (aucun `consumeCredits`). Plan STARTER.*
