# networK (pad O-NET-001) — Schéma de conception V1

> **À COLLER au début d'une nouvelle conversation Claude Code (Opus 4.8) dans ce projet.**
> Statut : conception VALIDÉE par Stéphane (2026-07-06). Ce document est autoporté et
> prescriptif : **ne pas improviser, ne pas élargir le périmètre**. En cas de doute sur
> un point non couvert ici → suivre le modèle `app/keynapse.js` (pad artifact de référence)
> et demander à Stéphane plutôt que d'inventer.
>
> **Lecture OBLIGATOIRE avant tout code** : `MANIFESTE_NOUVELLE_APP.md` (câblage exact,
> charte, pièges), mémoires `[[deploy-runbook]]`, `[[responsive-design-keystone]]`,
> `[[ui-pictograms-no-emoji]]`, `[[sdqr-popup-zindex-overlay]]`.
> Brief d'origine (vision UX complète) : `/Users/stephanebenedetti/Desktop/networK/networK.txt`.

---

## 1. Vision (résumé du brief validé)

networK n'est **PAS un CRM**. C'est le **réseau relationnel vivant** de Keystone :
une carte mentale qui se déploie de gauche à droite — « Vous » au centre-gauche,
puis les catégories libres (Clients, Fournisseurs…), puis les contacts.
L'impression recherchée : **« Voici mon activité »**, pas « voici mes contacts ».
Zéro sensation de base de données. Compréhensible en 2 secondes.

Valeurs : simplicité, élégance, calme, fluidité. Effet recherché : **« Waou » au
premier lancement, puis calme absolu.** L'animation de l'arbre est LE produit —
si elle est moyenne, l'app échoue (voir §5, phase-gate obligatoire).

L'arbre (« **Keystone Tree** ») est conçu comme un **composant signature réutilisable**
(futur : Smart Agent, Sentinel, Keynapse) — comme Cover Flow identifiait Apple.

## 2. Décisions ACTÉES (ne pas rediscuter)

1. **V1 = 100 % manuelle.** Les contacts et le journal d'activité se remplissent À LA MAIN.
   Le « remplissage automatique par les autres pads » (bus d'événements `nk_events`,
   signaux Living Layer, couplage Capture/Digest) est **PARKÉ** — voir §12.
2. **Les raccourcis de la fiche (« Continuer avec… ») font partie du cœur V1** et doivent
   RÉELLEMENT fonctionner, avec pré-remplissage là où c'est bon marché (§8).
3. **Animation** : niveau d'exigence maximal. Prototype en harnais AVANT l'app (§5).
   Validation de Stéphane sur le harnais = GATE bloquant avant la phase 1.
4. **Zéro IA en V1** → aucun `consumeCredits`/`recordUsage`, aucun appel worker IA.
5. **Plan** : dispo dès **STARTER** (app socle, incluse, elle fait vendre les autres).
6. **Précaution d'avenir (obligatoire, invisible)** : chaque contact a un **id stable
   (UUID)** ; chaque entrée de journal porte un champ **`source`** (toujours `'manual'`
   en V1). Le jour où l'automatique arrive, les pads écriront dans le même journal
   sans migration.

## 3. Identité du pad (conforme manifeste §4)

| Élément | Valeur |
|---|---|
| ID_KSTORE (immuable) | `O-NET-001` |
| Type | **artifact** (`padKey: null`, `ui_kind: "fullscreen"`) |
| Nom public | **networK** (logo : « networ » + « K » accentué, cf. maquettes) |
| Module front | `app/network.js` + `app/network.css` |
| Préfixe UNIVERSEL | `nk_` (CSS `.nk-*`, localStorage `nk_*`, tables D1 `nk_*`) |
| Worker | `workers/src/routes/network.js`, routé sur `/api/network/` |
| Picto | ajouter au registre `app/lib/ui-icons.js` (outline, JAMAIS d'emoji) — ex. nœuds reliés |
| Plan / prix | `plan: "STARTER"`, inclus (flat, cf. modèle éco Keystone) |

## 4. Ordre de chantier (respecter strictement, une phase = un commit au moins)

- **PHASE 0 — Harnais animation** : `_design-lab/network-tree-harness.html`, autonome
  (aucun import du projet), données factices, curseurs de réglage (§5). 
  **⛔ STOP à la fin de la phase 0 : validation Stéphane sur desktop ET iPhone réel
  avant d'écrire la moindre ligne de l'app.** Itérer le harnais jusqu'au « waou ».
- **PHASE 1 — Cœur** : squelette du pad (câblage complet §10), arbre branché sur les
  vraies données, CRUD catégories + contacts (ajout/édition/suppression), recherche.
- **PHASE 2 — Fiche** : panneau glissant droit, onglets Résumé / Activité / Notes,
  journal manuel, rôles & tags.
- **PHASE 3 — Raccourcis** : contrat `nkContact` + hooks pads cibles + gating suggestion (§8).
- **PHASE 4 — Livraison** : notice HELP, doc user, catalogue, bump SW, deploy, sync Admin.

## 5. Spec animation « Keystone Tree » (le cœur du produit)

### Principes (issus du brief, non négociables)
- Déploiement **progressif** : les branches se dessinent, puis les pills apparaissent,
  toujours dans le sens gauche→droite et haut→bas. **Jamais tout d'un coup.**
- **Une seule fois** : après le déploiement, immobilité TOTALE. Aucune animation
  d'ambiance, aucune boucle. Le contraste mouvement/calme fait le « waou ».
- **Une seule profondeur visible** : ouvrir une catégorie déplie ses contacts et
  replie le reste. Chaque clic = un niveau.
- Organique, véloce : l'énergie au départ, le calme à l'arrivée.

### Recette technique
- **Branches** = `<path>` SVG en courbes de Bézier cubiques (départ horizontal du
  parent, arrivée horizontale sur l'enfant — comme les maquettes). Tracé progressif
  par `stroke-dasharray`/`stroke-dashoffset` piloté en **rAF** avec easing fort en
  sortie (ease-out-quint ou expo : rapide au départ, se pose doucement).
- **Pills (nœuds)** = éléments HTML positionnés au-dessus du SVG. Arrivée en
  **ressort (spring)** avec léger dépassement puis retour : scale 0.92 → ~1.03 → 1.0
  + translateX(-8px→0) + fondu. La pill semble *poussée* par sa branche : elle
  démarre quand son tracé atteint ~70 %.
  CSS suffisant : `cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot intégré) ; si rendu
  trop mécanique au test, passer sur un petit spring rAF (stiffness/damping exposés
  dans le harnais).
- **Cascade** : stagger de 30–50 ms entre contacts d'une même liste.
- **Durées** : dessin d'une branche 450–650 ms ; apparition pill ~350 ms ;
  déploiement initial complet < 1,5 s.
- **Performance (bloquant)** : UNIQUEMENT `transform`/`opacity` + dashoffset SVG.
  Zéro reflow pendant l'animation (mesurer les positions AVANT, animer ensuite).
  Cible 60 fps ; test iPhone réel obligatoire. `will-change` posé juste avant,
  retiré après.
- **`prefers-reduced-motion`** : fallback fondu simple sans tracé ni spring.

### Curseurs du harnais (pour itérer avec Stéphane)
durée de tracé, courbure des Béziers, overshoot (%), stagger (ms), délai
branche→pill, easing (2–3 presets). + boutons « Rejouer » / « Ouvrir une catégorie ».

### Critères d'acceptation phase 0
- [ ] 60 fps sur iPhone réel (Safari), 7 catégories + 10 contacts dépliés
- [ ] Effet « dépasse puis se pose » perceptible mais jamais cartoon
- [ ] Immobilité parfaite en fin de déploiement (inspecter : plus aucun rAF actif)
- [ ] Validation explicite de Stéphane (« waou ») — sinon on itère

## 6. Écrans & UX

### Écran principal (canvas)
- **Chrome minimal** : logo networK (gauche) · recherche (centre) · bouton « + Ajouter »
  (droite) · menu « … ». **PAS de sidebar, PAS de colonne permanente.**
- **Canvas** : « Vous » (avatar utilisateur, réutiliser `ks_user_photo`/`ks_user_name`)
  à gauche ; branches vers les pills catégories (picto + label + compteur + petit « + »
  d'ajout rapide dans la catégorie). Clic catégorie → dépliage des contacts en
  colonne à droite (avatar, nom, entreprise). Au-delà de ~8 contacts : « Voir les N
  autres » (déplie le reste, avec la même cascade).
- **Toolbar flottante bas-centre** : sélection / main (pan) / zoom − % + / plein écran
  (cf. maquette). Pan = drag du fond ; zoom = pinch + molette, borné (50–150 %),
  appliqué en `transform` sur le conteneur (JAMAIS de largeurs px recalculées en JS —
  anti-pattern connu).
- **Catégories libres** : celles par défaut à la création (Clients, Fournisseurs,
  Partenaires, Équipe, Presse & médias, Institutions, Divers) sont renommables,
  supprimables, réordonnables ; l'utilisateur peut en créer.
- **Recherche** : filtre en direct côté client (nom, entreprise, tag) ; résultat =
  liste plate simple sous le champ, clic → ouvre la fiche.
- **Menu « + Ajouter »** : Personne · Entreprise · Établissement · Groupe · Tag
  (cf. maquette mobile ; « Importer des contacts » = V1.1, ne pas coder).
- **États** : vide (première visite : le « Vous » seul + invite à créer sa première
  catégorie/contact — soigné, c'est la première impression) ; erreur réseau discrète.

### Fiche contact (panneau glissant droite, cf. maquette)
- Glisse depuis la droite (~400 px desktop, plein écran mobile), fermeture ✕,
  n'écrase jamais l'arbre (l'arbre reste visible à gauche sur desktop).
- **En-tête** : grande photo/initiales, nom, badge rôle principal, entreprise, fonction.
- **Actions rapides** : tél (`tel:`), mail (`mailto:`), message (`sms:`), agenda
  (V1 : ouvre un `mailto:` d'invitation simple OU masqué si trop flou — trancher au
  plus simple), « … ».
- **Onglets V1 : Résumé / Activité / Notes.** (« Relations » = V1.1, NE PAS afficher
  l'onglet.)
  - **Résumé** : rôles (chips + ajout), tags (chips colorées + ajout), 5 dernières
    entrées du journal, raccourcis (§8).
  - **Activité** : le journal complet. Ajout manuel en 2 clics : type (appel, email,
    RDV, devis, document, note, autre — chacun son picto outline) + libellé court +
    date (défaut aujourd'hui). Affichage « Il y a X jours » (relatif).
  - **Notes** : texte libre par contact, sauvegarde auto (debounce).
- **Avatars V1 = initiales sur fond dérivé du nom** (hash → teinte). Upload photo
  = P2 optionnel en fin de chantier SI tout le reste est livré (R2 `HELP_MEDIA`,
  clé `nk-avatars/<sub>/<uuid>.<ext>`, regex anti-traversal + cap 512 Ko + types
  whitelistés, calqué sur le pattern `sa-cards/` existant).

### Mobile / responsive
- Reprendre les maquettes : arbre vertical compacté, fiche plein écran, menu
  « Ajouter » en bottom-sheet. Relire `[[responsive-design-keystone]]` : pas de
  largeur px figée par JS, pas de flex centré+overflow, chercher les `@media`
  existants avant d'en ajouter. Pinch-zoom du canvas ≠ zoom page (gérer `gesture*`
  si besoin, piège iOS documenté).

## 7. Données & API

### Tables D1 (migration, préfixe `nk_`, isolation tenant comme partout)
```sql
CREATE TABLE nk_categories (
  id TEXT PRIMARY KEY,            -- uuid
  tenant_id TEXT NOT NULL, sub TEXT NOT NULL,
  label TEXT NOT NULL, icon TEXT, position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE nk_contacts (
  id TEXT PRIMARY KEY,            -- uuid STABLE (précaution d'avenir §2.6)
  tenant_id TEXT NOT NULL, sub TEXT NOT NULL,
  category_id TEXT,               -- FK nk_categories (nullable si catégorie supprimée)
  kind TEXT NOT NULL DEFAULT 'person',  -- person|company|place|group
  name TEXT NOT NULL, company TEXT, title TEXT,
  email TEXT, phone TEXT,
  roles TEXT NOT NULL DEFAULT '[]',     -- JSON ["Client",…]
  tags  TEXT NOT NULL DEFAULT '[]',     -- JSON [{label,color}…] ou ["…"] simple
  notes TEXT NOT NULL DEFAULT '',
  photo_key TEXT,                 -- R2, P2 seulement
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE nk_activity (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL, sub TEXT NOT NULL,
  contact_id TEXT NOT NULL,       -- FK nk_contacts
  type TEXT NOT NULL,             -- call|email|meeting|quote|doc|note|other
  label TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',  -- 'manual' en V1 ; padId plus tard
  happened_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
-- + index (tenant_id, sub) sur les 3 tables ; INSERT OR IGNORE INTO tenants à la 1re écriture.
```

### Routes worker (`workers/src/routes/network.js`, gate `requireJWT` PARTOUT)
- `GET /api/network/bootstrap` → catégories + contacts + compteurs (1 seul appel au boot)
- `POST|PUT|DELETE /api/network/category` · `POST|PUT|DELETE /api/network/contact`
- `GET /api/network/activity?contact=<id>` · `POST|DELETE /api/network/activity`
- Tenant : B2C = `tenant_id='default'`, isolation par `claims.sub` (JAMAIS de
  `?tenantId=` client). Suivre le pattern d'une route existante (ex. keynapse).
- Cache local : miroir localStorage `nk_cache_v1` pour un boot instantané
  (render depuis le cache, refresh silencieux depuis l'API).

## 8. Raccourcis « Continuer avec… » (cœur V1, contrat inter-pads)

**Contrat** : networK appelle TOUJOURS le routeur central `openTool(padId, opts)`
(`app/ui-renderer.js:2181`) avec le contact dans une clé standard :

```js
opts.nkContact = { id, name, company, title, email, phone }
```

Chaque pad cible lit ce qui l'intéresse, ignore le reste. **Fermer/minimiser le
workspace networK AVANT d'ouvrir le pad cible** (piège z-index/overlay documenté
`[[sdqr-popup-zindex-overlay]]` : un fullscreen z-9000 masque tout ce qui s'ouvre
derrière).

| Raccourci (fiche) | Cible | Câblage exact |
|---|---|---|
| **Générer un Brief** | Brief Prod (pad form) | **Déjà géré par le moteur** : `openTool(id, { prefillData: {champ: valeur} })` → `_prefillForm` (`ui-renderer.js:2264`). Lire les `fields` du pad Brief Prod dans `app/pads-data.js` pour mapper nom/entreprise/mail/tél sur les BONS ids de champs. Zéro modif renderer. |
| **Envoyer une Missive** | Missive `O-SEC-001` | `openSceau({ nkContact })`. Hook MINIMAL dans `app/sceau.js` : pré-remplir le libellé/destinataire affiché avec `nkContact.name`. (Missive n'a pas d'email destinataire : c'est un lien/QR à transmettre — ne rien inventer de plus.) |
| **Publier pour ce client** | Social Manager `O-SOC-001` | Réutiliser le handoff EXISTANT `opts.compose` (cf. dispatch `ui-renderer.js:2225`) : ouvrir le composeur avec une mention contexte (ex. brouillon préfixé « Pour {name} ({company}) : »). Regarder comment Ghost Writer appelle `openSocialManager` et faire pareil. |
| **Ouvrir Smart Agent** | `O-AGT-001` | `openTool('O-AGT-001', {})` — ouverture simple, pas de prefill V1. |
| **Rédiger (Ghost Writer)** | Ghost Writer | `openGhostwriter(initialText, presetOpts)` accepte déjà un texte initial — amorce « Écrire à {name} ({company}) ». |
| **Tél / Mail / Message** | — | `tel:` / `mailto:` / `sms:` directs. Masquer l'icône si le champ est vide. |

**Raccourcis contextuels** : la liste affichée dépend des rôles du contact
(mapping simple codé en dur dans `network.js`, modifiable plus tard) :
- défaut : Missive · Brief · Ghost Writer
- rôle Client : + Publier pour ce client · Smart Agent
- rôle Imprimeur/Fournisseur : Brief · Missive · Key Brand (ouverture simple)

**Gating** : si le pad cible n'est pas owned (`getOwnedIds()`, `pads-loader.js:240`),
afficher le raccourci en **mode suggestion** — même carte, style atténué, une ligne
d'usage (« Créez un assistant qui répond à ce client ») + bouton « Découvrir » →
`openKStoreAppDetail(padId)` (`ui-renderer.js:1713`). Jamais agressif, jamais pub.

## 9. Charte, sécurité, RGPD

- **Charte Apple Premium** (manifeste §12) : font-stack native, `letter-spacing:-0.02em`,
  titres `font-weight:900`, sentence case, **JAMAIS d'emoji** → `icon()` de
  `app/lib/ui-icons.js` (ajouter les pictos manquants au registre : réseau, appel,
  devis, document…). Fond sombre par défaut MAIS respecter le thème clair/sombre
  global du dashboard.
- **XSS (bloquant)** : noms, entreprises, tags, notes, libellés du journal = saisie
  utilisateur → échapper via `_esc` AVANT toute injection HTML. Aucun `innerHTML`
  avec donnée brute.
- **RGPD** : contacts = données personnelles. Les tables `nk_*` doivent être couvertes
  par l'export Art.20 (`/api/admin/export`) et la purge tenant Art.17
  (`/api/admin/purge-tenant`) — ajouter les 3 tables aux deux routines admin.
- Pas de purge 90 j ici (données de travail de l'utilisateur, pas des données
  publiques anonymes).

## 10. Câblage EXACT (manifeste §4 — les 12 étapes, avec ancres)

1. ID `O-NET-001` (immuable, jamais couplé au label).
2. `app/network.js` (+ `.css`) exportant `export function openNetwork(opts = {}) {…}`.
   Tout préfixé `nk_`. Modèle : `app/keynapse.js`.
3. `app/ui-renderer.js` : import en tête (zone des imports `:17-31`) + ligne de
   dispatch dans `openTool` (bloc `:2224-2240`) :
   `if (padId === 'O-NET-001') { openNetwork(opts); return; }`
4. `app/pads-data.js` : entrée dans **`CATALOG_DATA.tools`** (`padKey:null`,
   `published:true`, `plan:"STARTER"`, `ai_optimized:false`, tags, `longDesc`).
5. `K_STORE_ASSETS/PADS/O-NET-001.json` (miroir) + ajout à `manifest.json`.
6. `K_STORE_ASSETS/catalog.json` (entrée complète, `published:true`).
7. Pictos dans `app/lib/ui-icons.js`.
8. Worker : `workers/src/routes/network.js` + router dans `workers/src/index.js`
   (`if (path.startsWith('/api/network/'))`) + migration D1 `nk_*`.
9. Notice `K_STORE_ASSETS/HELP/O-NET-001.json` (gabarit help-overlay GW, 4 zones).
10. Doc user : rubrique dans `app/lib/keystone-doc.js` (`DOC_SECTIONS` + `DOC_CHANGELOG`).
11. **Bump SW** (`scripts/bump-sw-version.js`) + tests + deploy (front Vercel = push
    `main` ; worker = `cd workers && npx wrangler deploy` avec **AUTORISATION EXPLICITE
    de Stéphane + stash WIP Pulsa** avant).
12. Admin → Catalogue → « Synchroniser avec fichier statique » → **Sauvegarder**.

⚠ **Piège n°1 du manifeste** : l'artifact doit être dans `CATALOG_DATA`
(pads-data.js) **ET** la table de dispatch **ET** les imports. Le JSON seul ne fait
RIEN (flag `ks_pads_from_json` OFF).

## 11. Pièges spécifiques à NE PAS rejouer

- **Prod-critiques intouchables** : Key Form (`pulsa-*`), Smart Agent, SDQR. Ne rien
  modifier chez eux ; les hooks raccourcis (§8) sont des AJOUTS minuscules et
  défensifs (`opts.nkContact` absent → comportement inchangé, à vérifier).
- **Jamais de WIP non vérifié déployé** ; `node --check` + smoke avant tout deploy.
- **Popup/z-index** : tout élément `body.appendChild` ouvert par-dessus le workspace
  fullscreen networK doit avoir un z-index cohérent (piège documenté).
- **Boot dashboard** : ne pas ralentir le boot global — `network.js` est chargé
  en import statique par le renderer comme les autres, mais tout le travail (fetch,
  DOM) ne démarre qu'à `openNetwork()`.
- **`_hydrate` Cloud Vault** : si une pref par-device `nk_*` est créée (ex. zoom),
  la garder HORS `PREFS_KEYS` (piège clobber documenté `[[cloud-vault-hydrate-clobber]]`).

## 12. PARKÉ (ne pas coder, ne pas re-proposer — déclencheurs notés)

- **Bus d'événements inter-pads** (timeline auto « Missive envoyée » etc.) —
  déclencheur : V1 adoptée + demande de Stéphane. Le champ `source` de `nk_activity`
  est prêt pour ça.
- **Signaux Living Layer** (contact en attente → relance) — après le bus.
- **Couplage Capture/Digest** (entités extraites → fiche contact) — cf.
  `CAPTURE_DIGEST_BRIEF.md`, l'ID contact stable est le point de rencontre.
- **Import CSV/vCard**, **onglet Relations** (liens contact↔contact),
  **sous-groupes** (VIP/Actifs/Dormants dans une catégorie, cf. maquette mobile),
  **upload photo** (P2 si le reste est livré).

---

## Checklist finale avant livraison (reprendre manifeste §17)

- [ ] Phase 0 validée par Stéphane (iPhone réel) AVANT la phase 1
- [ ] Import + dispatch + `CATALOG_DATA` + JSON/manifest/catalog
- [ ] Routes worker auth JWT, tables `nk_*` migrées, tenant isolé
- [ ] Raccourcis §8 testés un par un (owned ET locked/suggestion)
- [ ] Échappement XSS sur toute saisie · export/purge RGPD étendus aux `nk_*`
- [ ] Charte : pictos outline, pas d'emoji, responsive mobile vérifié, reduced-motion
- [ ] Notice HELP + doc user + changelog
- [ ] Bump SW · tests · smoke prod · sync Admin Catalogue
- [ ] Key Form / Smart Agent / SDQR non impactés

*Conçu le 2026-07-06 (Fable 5) à partir du brief `networK.txt` de Stéphane + audit du
code existant. V1 volontairement manuelle : la connexion à l'écosystème passe par les
raccourcis sortants (§8) ; l'entrant (bus d'événements) viendra en couche 2.*
