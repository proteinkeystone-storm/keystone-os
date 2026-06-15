# Keynapse — Brief & Sprints (Pad Keystone)

> **Keynapse** (Key + synapse) : espace personnel de connaissances. Des **bulles** de notes qui **respirent** sur un **canevas infini**, regroupées en **zones colorées** (dossiers virtuels sans contour), reliées par des **traits simples**. Inspiré de Trait d'union, mais **outil perso** — pas une installation publique.
>
> **Méthode (figée)** : 1 sprint = 1 session Claude Code dédiée. On ne déborde jamais sur le sprint suivant. Stéphane teste, valide, commit, puis lance le suivant.

---

## 0. Intouchables (PROD — ne JAMAIS modifier)

- **Trait d'union** : repo séparé (`1 - PROJETS/Trait d'union`). Lecture seule, source d'inspiration uniquement.
- **Key Form / `pulsa-*`** : formulaire artistes en PROD. Aucune ligne touchée.
- **Tout l'existant Keystone OS** hors des fichiers neufs Keynapse. Sprint 0 n'ajoute que du neuf + quelques crochets minimaux (liste licence, montage renderer, routeur worker) montrés explicitement avant ajout.

---

## 1. Décisions tranchées (ne pas rouvrir)

- **Hôte** : nouveau **Pad Keystone**, license-gated, chargé via `(+)`. ID **`O-Keyn-001`**, nom affiché **Keynapse**. **Données dans le D1 + R2 de Keystone** (comme tous les pads). **PAS** de Supabase / Realtime / Gemini / Telegram / poème / Key Form.
- **Code 100 % neuf, isolé** : nouveaux fichiers `workers/src/routes/keynapse.js`, `app/keynapse.*`, etc. Préfixe tables D1 : `kn_`.
- **Design** : Apple Premium Keystone. Navy `#131826/#1c2234/#242d42`, accent indigo `#6366f1`. Zones = nuancier catégoriel existant (ambre `#fcd34d`, cyan `#22d3ee`, violet `#a78bfa`, teal `#14b8a6`, rose `#f472b6`, vert `#22c55e`…). Font native + Inter, titres `font-weight: 900`. **Zéro emoji** → `icon()` (`app/lib/ui-icons.js`). **Léger, respirant, organique.**
- **Canevas** : infini (pan 4 directions), **zoom sémantique** (loin = constellations de couleurs / intermédiaire = noms de zones révélés / près = détail), **« Tout voir »** (recadre sur la boîte de TOUTES les bulles), borne de dézoom mini, **nouvelle bulle née dans le champ courant**.
- **Zones SANS contour dessiné** : regroupement par **cohésion** (les bulles d'une zone s'attirent doucement entre elles) + **couleur partagée**. Zone **optionnelle** (bulle libre = teinte neutre). Pas de label flottant → **panneau Zones** = légende (pastille+nom) + gestionnaire (créer/renommer/recolorer) + navigateur (clic → la caméra y vole). Nom de zone **révélé au zoom/survol**.
- **Clic sur une bulle → panneau latéral droit** (desktop) / **bottom-sheet** (mobile). **JAMAIS de page pleine** pour la note. En-tête d'identité (icône + couleur + titre + dates), panneau **teinté de la couleur de la bulle**. Sections **masquées si vides**, remplissage **inline « dans le mémo »** (petit `+`).
- **Liens** : **traits simples** (pas de nœuds, pas d'épaisseur variable). **Accrochés au bord** des cercles, tracés **sous** les disques opaques, légèrement arqués → **jamais à travers une bulle, toujours en périphérie**. Section « Liens » du panneau : clic sur une bulle liée → le panneau **glisse** vers elle + la carte la souligne.
- **Média (Niveau 3)** = **seul vrai plein écran** : lightbox photo/dessin/note (préc./suiv., clavier, swipe).
- **Voix** : `MediaRecorder` → audio en R2 + **transcription Workers AI (Whisper)** → **proposition IA** de tâche/rappel (pattern `_aiExtract` de Smart Agent), **validée par l'utilisateur**. Métré.
- **Rappels** : notifications **locales** d'abord ; **push** plus tard via le service worker PWA déjà en place.
- **Physique** : respiration lente faible amplitude (~20-30 s/cycle), retour **élastique doux**, plafond de vélocité, `prefers-reduced-motion` respecté, sim en pause quand l'onglet perd le focus.

---

## 2. Modèle de données (D1, tout scoping `tenant_id`)

- `kn_zones` : id, tenant_id, name, color, created_at
- `kn_bubbles` : id, tenant_id, title, description, color, icon, zone_id (nullable), x, y, created_at, updated_at
- `kn_links` : id, tenant_id, from_bubble, to_bubble (paire dédupliquée)
- `kn_todos` : id, bubble_id, label, done, position
- `kn_reminders` : id, bubble_id, at, repeat, notified_at
- `kn_media` : id, bubble_id, kind ('photo'|'drawing'|'audio'|'note'), r2_key, transcript (nullable), body (notes libres), created_at

R2 : préfixe dédié `keynapse/<tenant>/…`, jamais mélangé aux buckets existants.

---

## 3. Série de sprints

### Sprint 0 — Socle du Pad & données
- Coquille du Pad `O-Keyn-001` (entrée licence, descriptor JSON, montage ui-renderer, apparition via `(+)`).
- Migrations D1 (tables §2), routes worker CRUD squelette dans `keynapse.js` (rien d'existant touché).
- État vide : canevas navy + invite « Créer ma première bulle ».
- **Livrable** : le pad s'ouvre (license-gated), canevas vide, schéma migré.

### Sprint 1 — La constellation vivante (moteur)
- Portage moteur D3 : cercles (couleur, titre), **respiration + cohésion + plafond vélocité + retour élastique doux**, apparition staggered, pause sur blur, reduced-motion.
- **Canevas infini** : zoom/pan D3 toutes directions, bornes min/max.
- Rendu des bulles depuis D1 ; **drag persiste x/y**.
- **Liens en périphérie** : traits simples accrochés au bord, sous les disques opaques, arqués — jamais à travers une bulle.
- **Livrable** : tes bulles flottent/respirent sur un canevas infini, tu les déplaces, les traits restent propres.

### Sprint 2 — La bulle : panneau + contenu texte
- **Panneau latéral droit / bottom-sheet** : en-tête identité (icône+couleur+titre+dates).
- Créer une bulle (`+`) → mini-formulaire (titre, zone opt., couleur) → apparaît dans le champ courant. **Créables à volonté.**
- Sections inline, masquées si vides : **Description**, **Actions** (to-do + progression + compteur), **Notes libres**. Éditer/supprimer.
- **Livrable** : CRUD complet du contenu texte d'une bulle, dans le mémo.

### Sprint 3 — Zones (cohésion, couleur, panneau, zoom sémantique)
- Force de **cohésion** par zone + légère séparation inter-zones ; couleur partagée ; zone optionnelle.
- **Panneau Zones** : légende + créer/renommer/recolorer + clic → vol caméra.
- **Zoom sémantique** (loin/intermédiaire/près) + bouton **« Tout voir »** (fit sur toutes les bulles).
- Affecter une bulle à une zone ; glisser près d'un amas = réaffecter (opt.).
- **Livrable** : zones vivantes colorées, nommables, navigables.

### Sprint 4 — Liens entre bulles (« Tisser »)
- Créer un lien depuis le panneau (section Liens → bulle cible).
- Liste des liens (pastilles colorées, inter-zone dans l'autre teinte) ; clic → panneau glisse vers la bulle + surbrillance carte.
- **Livrable** : on tisse des liens et on navigue la constellation par eux.

### Sprint 5 — Captures média + plein écran + dessin
- Upload **photo** (R2), **notes libres** (journal chrono), **outil de dessin** (canvas → image R2).
- **Lightbox plein écran** : préc./suiv., clavier, swipe.
- Section Captures : miniatures + tuile `+` d'ajout inline.
- **Livrable** : attacher et consulter photos/dessins/notes en plein écran.

### Sprint 6 — Notes vocales + transcription + proposition IA
- `MediaRecorder` → audio en R2.
- **Transcription Workers AI (Whisper)** stockée avec l'audio.
- **Extraction IA** (`_aiExtract`) → propose tâche(s)/rappel(s) → **validation utilisateur** → crée todo/reminder. Métré.
- **Livrable** : enregistrer un vocal → transcription + actions proposées à valider.

### Sprint 7 — Rappels & notifications
- Rappels (date/heure/répétition) dans le panneau ; **notifications locales** ; indicateur « à venir ». (Push = futur via SW.)
- **Livrable** : poser des rappels, recevoir des notifications locales.

### Sprint 8 — Finitions, responsive, doc, déploiement
- Polish mobile (bottom-sheet, gestes, anti-zoom 16px), notice help-overlay du pad (gabarit O-AGT-001), entrée doc utilisateur (`keystone-doc.js`), passe perf (rendu hors-champ paresseux, stabilité longue durée), **bump SW**, déploiement (Vercel + worker wrangler — stash de tout WIP avant `wrangler deploy`).
- **Livrable** : pad livrable.

---

## 4. Critères transverses

- Aucun fichier/route `pulsa-*` ni Trait d'union touché ; Keynapse 100 % isolé.
- Mobile-first réel (iPhone Safari), pas seulement desktop.
- IA toujours métrée par le compteur Keystone.
- Chaque sprint : TODO/FIXME résolus, aucune clé commitée, design Apple Premium sans emoji.
