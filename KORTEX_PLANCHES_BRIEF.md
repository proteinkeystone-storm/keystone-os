# KORTEX — PLANCHES ILLUSTRÉES (SA-15)

**Brief de conception — 21/07/2026**
Statut : cadrage validé sur pièces, **aucun code écrit**.

---

## 1. Le problème, mesuré

Le dogfood du 21/07 sur un vrai manuel de formation (267 pages, 584 Mo, 423 images) a
donné trois chiffres qui commandent tout ce brief :

| Mesure | Valeur | Conséquence |
|---|---|---|
| Texte extrait par `toMarkdown` | 181 506 car. | Tient **largement** sous le plafond de 400 000 (45 %) |
| Poids du fichier | 584 Mo | Dépasse **x73** la limite d'upload de 8 Mo |
| Images embarquées | 423 (1,6/page) | **Aucune** n'entre aujourd'hui dans Kortex |

Le texte n'est pas le problème. Le transport et les images le sont.

Et sur certaines pages, **l'image EST le contenu** : la page 34 du manuel contient
224 caractères de texte et trois photos. Après extraction, il reste une fiche `fact`
sur la garde — la saisie du Karambit, elle, a purement disparu.

## 2. Ce qui existe déjà (et rend le chantier abordable)

| Brique nécessaire | Où elle tourne déjà, en prod |
|---|---|
| Page PDF → image | `booK._importPDF` — rasterisation canvas + durcissement mémoire iOS |
| Texte page par page | desK pré-impression — `getTextContent()`, plafonné à 500 pages |
| Stockage + service d'image | `handleAgentCardImageUpload` / `card-img` — R2 `HELP_MEDIA`, clé anti-traversal |
| File de relecture multi-lots | SA-14.4b (`_ig`) — progression, pause, reprise |
| Fil d'ariane de section | SA-14.4a `splitMarkdownBatches` |

pdf.js est **vendorisé** (`/app/vendor/pdfjs/`), donc hors de la dette « imports CDN sans SRI ».

**Propriété de souveraineté à mettre en avant** : le PDF ne quitte jamais le poste de
l'instructeur. Seuls le texte et les planches qu'il retient partent chez Cloudflare.

## 3. Décisions actées

| Sujet | Décision | Pourquoi |
|---|---|---|
| Grain de l'image | **Page entière** rasterisée | Les planches sont composites (photos détourées + tracés vectoriels + étiquettes). Extraire les images embarquées rendrait des silhouettes découpées et perdrait lignes, flèches et libellés — c'est-à-dire le sens. |
| Où tourne le découpage | **Client (pdf.js)** | 584 Mo ne passeront jamais par l'upload worker. Et le PDF reste sur le poste. |
| Images par fiche | **Liste ordonnée** | Le manuel lie le texte aux photos numérotées (« … pivote le pied d'appui **- Photo 2** »). Une procédure et sa séquence forment UN objet pédagogique. |
| Sélection des planches | **Tout proposé, coché par défaut, l'instructeur décoche** | L'heuristique « peu de texte = planche » ne filtre rien : presque toutes les pages mêlent texte et photos. |
| Description | **Écrite/corrigée par l'humain**, brouillon = titre de section + texte de la page | Une légende inventée sur un schéma technique est invisible à la relecture. Pas de vision IA en v1. |

## 4. Le risque n°1 : l'avertissement perd son statut

Page 64, bloc rouge : « **AVERTISSEMENT** : La gorge est une cible à effet
potentiellement radical (pouvant entraîner la mort)… »

Le texte survit à l'extraction — **vérifié**, il arrive bien dans `procedure.warnings`.
Mais le rouge, l'encadré et la tête de mort disparaissent : le pavé de danger se lit
comme de la prose ordinaire.

Pire, l'extraction actuelle **détourne le champ** : sur « Reprise de distance en quart
de cercle », `warnings` contenait *« Ce déplacement permet de sortir de l'axe
d'attaque »* — un **avantage** rangé dans le champ des dangers. Sur un manuel où
`warnings` porte « peut entraîner la mort », c'est ce qui apprend à l'instructeur à ne
plus lire ce champ.

**C'est le correctif à faire en premier, et il est indépendant des images.**

## 5. Les sprints

### ✅ SA-15.0 — Discipliner `warnings` *(worker, sans images)* — **EN PROD 21/07/2026**

- `EXTRACT_SYSTEM_PROMPT` : n'accepter dans `warnings` qu'un vrai bloc de danger
  repéré dans la source (« AVERTISSEMENT », « ATTENTION », « DANGER », pavé encadré) —
  jamais une reformulation d'avantage ou de bénéfice.
- Front : afficher `warnings` distinctement (pas au même niveau que les autres champs),
  dans la fiche ET dans la réponse de l'agent.
- Test : rejouer les 4 pages du manuel, vérifier que l'avertissement de la page 64
  arrive et que celui de la page 86 (qui n'en est pas un) n'arrive plus.

**Moteur : Opus 4.8.** Travail de prompt sur un contenu à enjeu de sécurité, avec un
verdict subtil (distinguer un danger d'un bénéfice). C'est du jugement, pas du volume.

**LIVRÉ.** Règle 5 du prompt : `warnings` n'accepte qu'un bloc signalé par la source
(AVERTISSEMENT / ATTENTION / DANGER / MISE EN GARDE / pavé de sécurité), une mention de
risque corporel, vital, légal ou irréversible, ou une interdiction formelle — repris au
plus près des mots de la source. Le contre-exemple de la page 86 est écrit tel quel dans
le prompt, **et c'était nécessaire** : ce texte contient le mot « risque » (« réduit le
risque de contre-attaque »), donc une règle par mots-clés se serait fait avoir.
Front : classe `.sa-field-danger` (éditeur), `.sa-danger-chip` (propositions + liste du
coffre), `.sa-danger-note` (sous la réponse). L'avertissement sous la réponse ne dépend
plus de la prose du modèle : le worker le remonte tel quel via `citations[].warning`
(`unitWarning()`), donc une génération qui lisse un danger ne peut plus l'effacer.

**Mesuré sur les 4 pages du manuel** (2 618 car., soit le lot du dogfood à 1 car. près) :
une seule fiche sur six porte un `warnings`, et c'est la bonne — l'AVERTISSEMENT de la
page 64 arrive mot pour mot, cadre légal compris. « Reprise de distance en quart de
cercle » n'en porte plus AUCUN. Le bénéfice n'est pas perdu pour autant : il est rangé
dans une fiche `fact` « Avantages du déplacement en quart de cercle » — le modèle a cessé
de le déguiser en danger, il ne l'a pas jeté.

⚠ **Canal public non couvert.** Doctrine SA-8.0 : zéro citation exposée au visiteur, donc
zéro `warning` remonté. Sans objet pour ce client (instructeurs authentifiés), à trancher
si un jour un coffre à risque passe en public.

### ✅ SA-15.1 — Plafond de fiches sensible à la densité *(worker)* — **EN PROD 21/07/2026**

Le dogfood a montré l'autre face de SA-14.6 : sur 2 619 caractères, le modèle a rendu
25 fiches — soit une fiche pour 105 caractères, avec la même unité pédagogique émise
3 à 5 fois sous des gabarits différents. `saturated=true` était une fausse alerte.

- Plafond proportionnel au volume du lot (ex. 1 fiche / 400 car., borné à 25).
- `saturated` ne se déclenche que si le plafond **calculé** est atteint.

**Moteur : Sonnet 5.** Changement borné, bien spécifié, testable par des cas purs.

**LIVRÉ.** `extractUnitCap(text)` = 1 fiche / 400 car., borné à [3, 25]. Le plafond calculé
part au prompt ET à `_parseProposals(raw, max)` — le passer au seul parseur aurait tronqué
en silence ce que le modèle avait déjà produit. `saturated = proposals.length >= cap`
(le plafond CALCULÉ, plus l'absolu). Sur le lot d'ingestion, le plafond se calcule sur
`batch.text` seul : le chevauchement est du contexte déjà analysé, il ne porte pas de
fiches et ne doit pas gonfler la borne.

**Mesuré sur le même extrait** (2 618 car.) : **6 fiches au lieu de 25**, `saturated=false`
au lieu d'une fausse alerte. Une fiche pour 436 car. au lieu de 105. Aucun doublon de
gabarit : 4 `procedure` (4 techniques distinctes) + 1 `definition` + 1 `fact`.

**Le gain de SA-14.6 survit, et c'est testé** : un lot d'ingestion plein (12 000 car.)
donne 30 → borné à 25, donc inchangé. Seuls les lots pauvres sont bridés.

### SA-15.2 — Champs image sur la fiche *(worker + migration)*

- `kortex_units` : ajout additif d'une liste ordonnée `{ key, alt, n }`
  (`n` = numéro de photo imprimé, quand il existe).
- `validateUnit` : tolérant — une fiche sans image reste valide, une image invalide
  n'invalide jamais la fiche.
- Réutilisation stricte de la clé R2 existante (`SA_CARD_KEY_RE`) et de `card-img`.
- **Jamais dans `body_text`** : l'image ne doit pas polluer l'index FTS ni l'embedding.

**Moteur : Opus 4.8.** Touche la table du savoir — la plus sensible du système. Une
migration ratée là se paie en fiches perdues.

### SA-15.3 — Rasterisation + file de relecture *(front, le gros morceau)*

- Reprise de `booK._importPDF` (rasterisation + durcissement mémoire iOS) et du
  `getTextContent()` de desK, branchés sur la file `_ig` de SA-14.4b.
- Chaque page produit : son texte (→ lot d'extraction) **et** sa planche (→ proposition
  cochée par défaut).
- Vignette **plafonnée en hauteur**, plein écran au clic, téléchargement.
  *(Vérifié en maquette : une planche pleine page non plafonnée écrase la fiche.)*
- Upload R2 **uniquement** des planches retenues, au moment de la validation.

**Moteur : Sonnet 5.** Beaucoup de code front bien cadré, avec deux implémentations de
référence à suivre. Passer à Opus 4.8 si la gestion mémoire iOS résiste.

### SA-15.4 — Numéros de photos *(worker + front)*

- `EXTRACT_SYSTEM_PROMPT` : conserver les renvois « - Photo 2 » dans les étapes
  (aujourd'hui ils disparaissent).
- Associer le numéro imprimé sur la planche au renvoi dans le texte.
- L'agent peut alors répondre « à l'étape 3, voir la photo 2 » et montrer la bonne.

**Moteur : Opus 4.8.** Le lien texte↔image est le cœur pédagogique du manuel ; c'est
le sprint où une approximation se voit immédiatement à l'usage.

### SA-15.5 *(conditionnel)* — Canal public

Les citations `[n]` sont **volontairement supprimées** en public. Montrer une planche
sans exposer le coffre demande un autre mécanisme.

**À ne construire que si un client le demande.** Le client formation est interne — ses
instructeurs sont authentifiés.

## 6. Points hors code, à poser avec le client

1. **Visages parfaitement identifiables.** Des images de personnes reconnaissables dans
   R2, ce n'est plus seulement de la donnée sensible : c'est de la **donnée personnelle**.
   Cela s'ajoute à la question de souveraineté, cela ne s'y confond pas.
2. **Techniques létales avec cadre légal.** Le manuel encadre lui-même ses techniques
   (proportionnalité, nécessité). Le coffre doit préserver ce cadre — c'est l'objet de
   SA-15.0 — et l'accès doit être contrôlé.
3. **Un corpus scanné ne donnerait presque rien.** Ce manuel a une couche texte propre.
   Un manuel scanné en images pures serait quasi invisible pour `toMarkdown` : à
   vérifier sur chaque nouveau corpus **avant** toute promesse.

## 7. Choix de moteur — synthèse

| | Fable 5 | Opus 4.8 | Sonnet 5 |
|---|---|---|---|
| Prix /Mtok (in/out) | 10 $ / 50 $ | 5 $ / 25 $ | 3 $ / 15 $ (2/10 jusqu'au 31/08) |
| Pour ce chantier | **Non** | **Oui — sprints à jugement** | **Oui — sprints à volume** |

**Fable 5 est écarté**, pour deux raisons concrètes :
- il exécute des classificateurs de sécurité qui peuvent **refuser** une requête
  (`stop_reason: "refusal"`) ; sur un corpus de techniques de combat, c'est un risque
  de friction inutile ;
- il exige **30 jours de rétention de données** et n'est pas disponible en rétention
  zéro — exactement la contrainte qu'on cherche à minimiser avec ce client.

Son surcoût (x2 sur l'entrée, x2 sur la sortie face à Opus 4.8) n'est pas justifié ici :
aucun sprint de ce brief n'est un problème « non résolu ». La règle simple :

- **Opus 4.8** dès que le sprint touche la table du savoir, un prompt de sécurité, ou
  le lien texte↔image — là où une erreur est coûteuse et peu visible.
- **Sonnet 5** pour le code front cadré et les changements bornés testables.

## 8. Ce que ce chantier ne fait PAS

Il fait entrer les images dans le coffre. **Il n'accélère toujours pas la relecture
humaine.** 267 pages restent 267 planches à trier, en plus des ~15 lots de texte.

Le goulot de validation reste entier — le dire au client, comme pour SA-14.4.

---

## Ordre recommandé

**SA-15.0 → SA-15.1 → SA-15.2 → SA-15.3 → SA-15.4**, puis SA-15.5 seulement sur demande.

SA-15.0 et SA-15.1 sont livrables **immédiatement** et sans images : ils corrigent des
défauts mesurés sur du contenu réel, indépendamment de la suite.
