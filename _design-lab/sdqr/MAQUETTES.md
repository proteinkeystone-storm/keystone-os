# Smart Dynamic QR — maquettes validées (récup pour reprise)

> Récupération du **design décidé en début de conversation** (prévisualisations graphiques),
> à réutiliser comme **référence** dans la prochaine conversation.
> ⚠️ Le **build S2** (branche `sdqr-s2`) a **dérivé** de ces maquettes — voir « Dérive » plus bas.

## LE DESIGN VALIDÉ (la cible)

- **Cadre navy** (`#1B2A4A` / `#0a2741`) en chrome : header + pourtour + grille de types.
- **Panneaux de configuration BLANCS** au centre (cartes blanches, texte navy) — « ça respire, moins étouffant ».
- **CTA / accent OR** (`#c9a84c`) — **RARE** : bouton principal + état sélectionné uniquement. JAMAIS du doré en fond partout (testé → « vieux et triste »).
- **Étapes numérotées** : Étape 1 « Contenu » / Étape 2 « Design ».
- **Aperçu live à droite** (QR rendu, ou maquette téléphone pour les pages hébergées).
- **Statique/Dynamique en langage humain** : « Permanent · gratuit » vs « Modifiable · suivi ».
- **Grille de types en ACCORDÉON** : pictos-chapitres, un seul déplié (Liens / Contact / Fichiers / Réseaux / Expériences ; « Expériences » = jeux/fidélité/boîte cadeau/concierge = rayon exclusif).
- **Surfaces analytiques** : prévues en sombre+indigo à l'origine (« analyser = sombre »), puis Stéphane a tranché « plus de clair/sombre, applique le design » → tout devait passer au design navy+blanc+or.

## LES MAQUETTES (titres show_widget — régénérables, ou voir transcript de la conversation du 2026-06-21)

1. `carte_options_qr_couverture_sdqr` — carte des 7 familles de fonctions QR + notre couverture (have/partiel/à construire).
2. `flux_creation_qr_sans_mal_de_tete` — le parcours en 4 étapes (choisir l'usage → remplir+aperçu → styler → exporter).
3. `maquette_generateur_qr_keystone_v2` — **HÉRO : l'écran générateur complet** (cadre navy + panneaux blancs STEP 1/2 + CTA or + grille de types groupée + aperçu live). → fichier `generateur.html`.
4. `maquette_panneau_design_keystone` — onglet Design, vue Yeux riche (12+ formes) + « on ajoute aussi » (biblio logos, couleur d'yeux, fond transparent, cadre, modèles).
5. `maquette_grille_types_accordeon` — la grille de types en accordéon (5 chapitres, un seul déplié), interactive.
6. `maquette_onglet_cadre_keystone` — onglet Cadre (galerie + CTA éditable + couleur + police).
7. `maquette_cadres_varies_keystone` — 16 cadres variés (bandeau, pastille fléchée, cercle, fanion, anneau, pointillé, cible, galet, esquisse, téléphone…).
8. `maquette_onglet_modules_keystone` — onglet Modules, 12 styles (carré, point, losange, croix, étoile, barres, fluide, gouttes, mosaïque, pétale…), cliquable.
9. `maquette_onglet_yeux_keystone` — onglet Yeux, 16 styles (carré/cercle/arrondi/feuille/étoile/pointillé × pupilles).
10. `maquette_onglets_couleurs_logo_keystone` — onglets Couleurs (couleur d'yeux distincte, dégradé, fond transparent, contraste live) + Logo (upload + taille + bibliothèque d'icônes + logos sauvegardés).
11. `maquette_couleurs_palettes_keyform` — palette = système Key Form (10 dégradés par ambiance Sobres/Chaleureux/Frais/Bold/Néon + accent), garde-fou contraste réactif.
12. `maquette_modeles_par_intention_keystone_v2` — galerie Modèles **par intention** : Réseaux à leurs couleurs de marque / par usage (PDF, menu, avis, wifi…) / par forme de contour. (PAS des nuanciers de style génériques — v1 rejetée.)
13. `maquette_bibliotheque_mes_qr_grille` — bibliothèque « Mes QR » en vue **Grille** (cartes, badges type/mode, scans+mini-courbe, ⋯).
14. `maquette_bibliotheque_mes_qr_tableau` — bibliothèque en vue **Tableau** (lignes denses, colonnes triables, sélection multiple → barre d'actions groupées).
15. `maquette_vue_ensemble_tous_qr` — tableau de bord « tous mes QR » (KPIs cumulés, courbe, classement, par dossier, par type, à surveiller).
16. `maquette_stats_par_qr_heatmap_timeline` — modules d'intelligence pour la page par-QR : heatmap jour×heure + timeline d'événements sur la courbe.
17. `roadmap_sprints_sdqr` — feuille de route S0→S6 (risque croissant + garde-fous).

## DÉRIVE constatée (à corriger dans la reprise)

- Le pad **live/preview** est devenu **clair + indigo discret + doré rare**, **SANS le cadre navy**.
- Donc **il manque le cadre navy** (le chrome navy autour des panneaux blancs) qui est la signature des maquettes.
- Le reste (panneaux clairs lisibles, accent or rare sur CTA+sélection, accordéon de familles avec pictos) est en place sur `sdqr-s2`.
- **À FAIRE pour réaligner sur les maquettes :** ajouter le **cadre navy** (header + pourtour) sur les panneaux blancs → le doré reprend alors son écrin. Puis finir la **bibliothèque Grille/Tableau** (maquettes 13-14).

## État technique (rappel)
- Prod (S0+S1) = OK, QR intacts (18 redirs / 529 scans), gardien `scripts/qr_prod_guard.py`.
- S2 = sur branche `sdqr-s2` (preview Vercel `keystone-os-git-sdqr-s2-storms-projects-01b49fbc.vercel.app`), NON mergé.
- Détail complet : mémoire `sdqr-refonte-interface.md`.
