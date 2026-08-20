# Ghost Writer — sprints « le correcteur qui connaît la maison »

> Brief autoporté, rédigé le **2026-08-20**. Une session neuve doit pouvoir agir
> sans rien d'autre que ce fichier. Outil **Ghost Writer**, mode *relecture*
> (Grammalecte). Dépôt : `1 - PROJETS/PROJET_KEYSTONE/KEYSTONE_OS`.

---

## 1. Pourquoi ces sprints existent

Constat de Stéphane (2026-08-20) : **« il y a des fautes ou des faux positifs »**
dans la relecture de Ghost Writer.

Le diagnostic, établi en lisant le code :

- Le moteur est **Grammalecte**, un correcteur **à règles** qui tourne dans un
  Web Worker, **100 % dans le navigateur**, hors-ligne et gratuit. Il applique
  des milliers de règles écrites à la main à un texte **qu'il ne comprend pas**.
- De là ses deux faiblesses, qui sont structurelles et non un défaut de finition :
  - **faux positifs** : tout mot absent de son dictionnaire est suspect. Sur
    *L'Épaulette* : noms propres, patronymes, noms d'unités.
  - **fautes ratées** : accords du participe passé, homophones (*ses/ces/c'est*)
    — il faut savoir **qui fait quoi** dans la phrase pour trancher.
- Le bruit le plus grossier est **déjà filtré** (`_filters` dans
  `app/lib/proof-engine.js`) : sigles TOUT-CAPS (MINARM, IHEDN), tokens avec
  chiffres (VT4, A400M), URL/e-mails, mots de moins de 3 lettres.

**Ce qui reste** est donc précis : les **noms propres en casse normale**
(Degrima, Lefebvre) et les **règles de grammaire qui se déclenchent à tort**.

**La direction retenue** (arbitrée avec Stéphane le 2026-08-20, dans cet ordre) :
d'abord des correctifs **déterministes, locaux et gratuits**, et l'IA
**seulement sur ce qui résiste** — invisible, et uniquement pour **masquer** une
suggestion, jamais pour en ajouter.

---

## 2. État au 2026-08-20

| | |
|---|---|
| Moteur | Grammalecte, Web Worker, navigateur uniquement, hors-ligne |
| Interface | `app/lib/proof-engine.js` (274 lignes) — volontairement **remplaçable** |
| Tests du moteur | `scripts/mesure-proof.mjs` (GP-0, livré le 2026-08-20) : **30 vérifications** sur les fonctions pures + démarrage réel du worker dans Chrome. Tourne dans `npm test`. `scripts/test-ghostwriter-*.mjs` couvrent la réécriture LLM, pas la relecture. |
| Dictionnaire perso | existe (`ks_proof_ignore_words`), **vide au départ**, **par navigateur** (localStorage) |
| Denylist grammaire | existe (`_GRAMMAR_DENYLIST`), **figée dans le code** |
| Passe IA | **non branchée.** `fuseIssues(primary, secondary)` est écrite et attend sa source `'ai'` |
| `BRIEF_GHOST_WRITER_V2.md` | **cité par le code, absent du dépôt** — ce fichier-ci le remplace pour la relecture |

---

## 3. Périmètre — ce qui est concerné, ce qui ne l'est PAS

**Concerné** : le mode *relecture* de Ghost Writer et la relecture de PDF, qui
partagent le même moteur.

**NON concerné** : le bouton « Relire avec Ghost Writer » de desK. C'est un
**autre chemin** — il appelle `POST /api/ghostwriter/rewrite` (`action:'improve'`,
`variants:1`), c'est-à-dire une **réécriture par Mistral**, sans Grammalecte.
Ne pas confondre les deux, et ne rien y toucher dans ces sprints.

### La carte du code

| Fichier | Rôle |
|---|---|
| `app/lib/proof-engine.js` | **le moteur.** `analyze(text, opts)` → `{text, issues}` ; `filterIssues()` ; `isNoiseSpelling()` ; `setProofFilters()` ; `fuseIssues()` ; `canonicalizeText()` ; `_GRAMMAR_DENYLIST` |
| `app/lib/proof-grammalecte.worker.js` | le Web Worker Grammalecte (dico ~9 Mo, init paresseuse) |
| `app/ghostwriter-proof.js` (1795 l.) | l'**UI** de relecture. Détient le dico perso (`ks_proof_ignore_words`), le toggle « grammaire seule », les familles typo. Importe le moteur en **lazy** (`await import(...)`) |
| `app/lib/proof-pdf.js` | **second consommateur** du moteur (relecture de PDF). Toute modification de `analyze`/`filterIssues` l'affecte aussi — le vérifier. |

**Point d'accroche déterminant** : `analyze()` appelle `filterIssues()`
**lui-même**, et il a le texte canonique sous la main à ce moment-là. Un filtre
qui a besoin de la **position** du mot dans la phrase se branche donc là, et les
deux consommateurs en profitent sans être modifiés. `analyze(text, {noFilter:true})`
rend les alertes **brutes** — c'est ce qui permet de mesurer avant/après.

---

## 4. Les décisions déjà prises (ne pas les rouvrir sans Stéphane)

1. **L'IA ne doit jamais se voir ni se déclencher par un clic.** Pas de bouton
   « vérifier ». Grammalecte souligne immédiatement, et les alertes injustifiées
   s'effacent en silence.
2. **L'IA n'a le droit que de MASQUER, jamais d'ajouter.** Une alerte ajoutée par
   un modèle n'a pas d'origine explicable ; si elle est fausse, elle fait corriger
   une phrase correcte.
3. **Le risque à surveiller est l'inverse** : masquer une **vraie** faute. C'est
   le seul vrai danger du dispositif → critère de mise en service de GP-5 :
   **zéro faute réelle masquée** sur le corpus.
4. **Invisible ≠ secret.** Le moteur promet aujourd'hui, par écrit, que la
   détection **ne quitte jamais le navigateur** — argument de souveraineté. Si
   des fragments partent, il faut **une ligne dans la documentation** et **un
   interrupteur dans les réglages** pour revenir au tout-local. Aucun clic
   supplémentaire pour l'utilisateur, mais la promesse reste vraie.
5. **Le dictionnaire fait décroître le coût.** Un nom appris n'est plus jamais
   envoyé. C'est ce qui rend une assistance invisible économiquement tenable.
6. **Apprentissage automatique limité aux noms propres**, jamais à un accord, et
   la liste apprise doit rester **consultable et purgeable** — sinon un nom
   réellement mal orthographié serait blanchi pour toujours.

---

## 5. Les sprints

### GP-0 · La mesure (rien ne peut commencer avant)

**But** — savoir où on part. Aujourd'hui « c'est mieux » ne serait qu'une
impression : il n'existe **aucun test** sur ce moteur.

**Livrable**
- `scripts/mesure-proof.mjs` — patron : `scripts/test-desk-ui.mjs` (puppeteer,
  déjà dépendance). **Un navigateur est obligatoire** : le moteur est un Web
  Worker, jsdom ne peut pas l'exécuter.
  Le script charge le **vrai** `app/lib/proof-engine.js`, passe chaque texte du
  corpus, et sort un rapport : nombre d'alertes **brutes** (`noFilter:true`)
  contre **filtrées**, ventilation par `type` (`spelling`/`grammar`), par
  `ruleId`, et la liste des mots d'orthographe signalés avec leur phrase.
- `_corpus-proof/` — 3 vrais articles de *L'Épaulette* en texte brut, plus
  `verite.json` : pour chaque alerte, le verdict établi **à la main**
  (`vraie` / `faux-positif`), et la liste des fautes **ratées** repérées à la
  lecture.
- ⚠️ **Le dépôt est PUBLIC** : `_corpus-proof/` doit être ajouté à `.gitignore`
  et **jamais commité**. Le script doit fonctionner avec un corpus absent (il
  l'annonce et s'arrête proprement).

**Critère de fin** — la commande tourne, et le **chiffre de départ** est inscrit
dans ce fichier (§6) : combien d'alertes, combien de faux positifs, combien de
fautes ratées, et le classement des `ruleId` fautifs.

#### État au 2026-08-20 — banc LIVRÉ, corpus REÇU, mesure FAITE

`scripts/mesure-proof.mjs` existe et tourne (`npm run mesure:proof`, ou
`npm test` qui l'embarque). Il fait trois parties, et les deux premières
n'attendent **rien** :

| | |
|---|---|
| **A · le filet** | 24 assertions sur `isNoiseSpelling`, `filterIssues`, `canonicalizeText`, `fuseIssues`. En Node, sans navigateur. C'est le trou du §2, bouché. |
| **B · la fumée** | le vrai `proof-engine.js` + le vrai worker démarrent dans Chrome et attrapent une faute sur une phrase **inventée** (aucun texte réel dans un dépôt public). 5 assertions. |
| **C · la mesure** | **faite le 2026-08-20** sur 3 articles réels (22 070 signes). Corpus absent → le banc dit quoi fournir et sort en 0. |

**Le va-et-vient avec Stéphane** — en trois commandes, **sans jamais ouvrir un
fichier** (contrainte posée le 2026-08-20 : « je ne peux pas intervenir sur du
JSON ») :

1. déposer les `.txt` dans `_corpus-proof/` ;
2. `npm run mesure:proof` → le banc écrit la feuille de verdicts pré-remplie ;
3. `npm run relire:proof` → **l'écran de relecture** s'ouvre dans le navigateur :
   l'article s'affiche avec ses alertes surlignées, <kbd>F</kbd> = c'est une
   faute, <kbd>C</kbd> = le texte est correct, tout s'enregistre au fil de l'eau.
   Les fautes **ratées** s'ajoutent depuis le même écran (on peut sélectionner
   le passage dans le texte) ;
4. `npm run mesure:proof` → le §6 se refait sur ses verdicts.

L'écran distingue une **proposition** (pré-remplie, soulignée en pointillé)
d'une décision **confirmée** : la barre de progression compte les confirmations,
et un bouton confirme d'un coup tout un article si l'on est d'accord en bloc.

| Fichier | Rôle |
|---|---|
| `scripts/mesure-proof.mjs` | le banc + la mesure |
| `scripts/relire-proof.mjs` | le petit serveur local qui sert l'écran et enregistre |
| `_design-lab/relire-proof.html` | l'écran (versionné, **sans aucun texte réel** : il va le chercher au lancement dans `_corpus-proof/`) |

Chaque texte porte une **empreinte** : modifier un `.txt` après avoir jugé fait
apparaître un avertissement (les positions se seraient décalées en silence).

**Le garde-fou du §4.3 est actif dès aujourd'hui** : l'assertion « aucune faute
réelle masquée par les filtres » tourne sur les filtres ACTUELS, avant toute IA.
Vue rouge en la provoquant, verte après restauration (2026-08-20).

---

### GP-1 · L'impasse sur les noms propres

**But** — supprimer la plus grosse famille de faux positifs, sans IA.

**La règle** — un mot inconnu qui commence par une **majuscule** et qui **n'est
pas en début de phrase** est un nom propre : on ne le signale pas.
Positions où une majuscule est **grammaticale** (donc on continue de vérifier) :
début du texte, début de ligne, après `.` `?` `!` `…`, après `:` `;`, après un
guillemet ouvrant `«` `"`, après un tiret de dialogue `—` `–` `-`.

**Livrable**
- Une fonction **pure** dans `proof-engine.js` (testable hors navigateur), du
  même genre que `isNoiseSpelling` : elle reçoit le mot, le texte et l'offset.
- `filterIssues(issues, filters, text)` — le texte descend depuis `analyze()`,
  qui l'a déjà.
- Réglage `skipProperNouns` (défaut **ON**) exposé par `setProofFilters()`.
- Le banc GP-0 étendu : assertions sur la fonction pure (cas limites ci-dessus)
  **et** re-mesure sur le corpus.

**Critère de fin** — sur le corpus : faux positifs « nom propre » **à 0** ;
**aucune** alerte de `type:'grammar'` masquée (le filtre ne touche QUE
`type:'spelling'`) ; `proof-pdf.js` vérifié non cassé.

**Ce qu'on perd, assumé** : un nom mal orthographié n'est plus signalé. Perte
théorique — Grammalecte n'a pas les noms propres dans son dictionnaire, ses
suggestions sur un patronyme sont déjà inutilisables. GP-4 traite ce cas
proprement.

#### LIVRÉ le 2026-08-20 — et la perte a été évitée

La règle est en place dans `proof-engine.js` (`isProperNounSpelling`, pure et
testée : 30 assertions). **Elle ne perd aucune vraie faute**, contrairement à ce
que la mesure GP-0 annonçait — grâce à trois garde-fous ajoutés d'après le
corpus :

| Garde | Pourquoi | Ce qu'il sauve |
|---|---|---|
| **mêmes lettres** | si une suggestion de Grammalecte a les MÊMES lettres (accents ôtés, ordre libre), ce n'est pas un nom mais une coquille | `Lybie`→`Libye`, `Egypte`→`Égypte`, `Ethiopie`, `Emiratis` — les 4 vraies fautes que GP-1 nu aurait tuées |
| **l'initiale** | un point précédé d'une seule capitale isolée est une initiale, pas une fin de phrase | `B. El-Bakri` n'est plus lu comme un début de phrase |
| **les chiffres** | un mot contenant un chiffre est une référence, pas un nom | l'affaire reste à `skipWithDigits` — pas de double masquage, pas de fausse attribution |

**Résultat mesuré** : alertes affichées **76 → 31**, faux positifs **63 → 18**,
et les **13 vraies fautes sont toutes conservées**. Aucune alerte de grammaire
n'a disparu. Les deux consommateurs (`ghostwriter-proof.js`, `proof-pdf.js`)
passent par `analyze()`, qui fait descendre le texte canonique : aucun des deux
n'a été modifié, aucun appel direct à `filterIssues` n'existe ailleurs.

**Ce qui reste faux positif (18)** — deux familles, toutes deux assumées :
- un **nom propre en tête de phrase ou de citation**. Structurel : à cet
  endroit la majuscule est grammaticale, la règle ne peut pas trancher. Le
  dictionnaire maison (GP-2) les éteindra un par un, définitivement.
- deux mots étrangers que le garde « mêmes lettres » retient, parce qu'un mot
  français s'écrit avec les mêmes lettres à l'accent près. C'est le prix payé
  pour sauver les quatre fautes d'accent. Bon échange.

**Décision de spécification, mesurée** : le brief demande de considérer la
majuscule comme grammaticale **après un guillemet ouvrant**. La variante inverse
(traverser le guillemet) écarte **2 faux positifs de plus**, mais rendrait la
règle aveugle au **premier mot de chaque citation** — et la revue en est pleine.
Le brief l'emporte. Réversible : c'est `_RE_OUVRE_PHRASE` dans `proof-engine.js`.

#### Les deux filtres à chiffres, remis d'aplomb (2026-08-20)

Le §4.3 était violé par `Km2`. En cherchant le coupable, **deux erreurs
d'origine** ont été trouvées — l'une et l'autre par la sonde, pas par l'intuition
(j'avais d'abord accusé le mauvais filtre) :

1. **`skipWithDigits` ne protégeait de rien.** Sonde sur le vrai moteur : les
   références qu'il prétendait écarter (`A400M`, `VT4`, `Rafale F3`, `P4`,
   `1er`) ne sont **jamais signalées** par Grammalecte — elles sont en
   capitales, il les ignore lui-même. Ce que le filtre écartait réellement, ce
   sont des mots **collés à un nombre** (`Km2`, `page42`, `covid19`,
   `Airbus350`), c'est-à-dire de vraies fautes de typographie, avec la bonne
   correction en face. → **défaut passé à `false`** pour la relecture de texte.
   `proof-pdf.js` le **rallume explicitement** : sur un PDF, le collage vient de
   l'extraction, pas de l'auteur. (`filterIssues` accepte désormais une
   surcharge PARTIELLE : un consommateur n'énonce que ce qui diffère.)
2. **`minLetters` ne comptait que les lettres.** `Km2` passait donc pour un
   fragment de deux signes. → il compte maintenant **lettres ET chiffres**.
   `vn`, `er`, `a1` restent écartés ; `Km2` est signalé.

**Fautes réelles masquées à tort : 1 → 0.** Le critère §4.3 est tenu.

**GP-4 n'est donc plus la contrepartie obligatoire de GP-1.** Le garde « mêmes
lettres » fait déjà le contrôle positif pour les mots que Grammalecte connaît.
GP-4 garde sa valeur pour les noms que **seule la maison** connaît
(`Lefebvre`/`Lefebre`) — il redevient un sprint de confort, pas de sécurité.

---

### GP-2 · Le dictionnaire de la maison, partagé

**But** — que le vocabulaire de la revue soit connu, et connu de **toute
l'équipe**.

**Le manque actuel** — `ks_proof_ignore_words` est en `localStorage` : ce que
Stéphane apprend au correcteur, la rédactrice ne l'a pas. Et la liste est vide
au départ.

**Livrable**
- Stockage partagé (Worker + D1) + reprise **sans perte** du contenu localStorage
  existant au premier chargement.
- Semis initial avec le vocabulaire de *L'Épaulette* (grades, unités, sigles en
  casse normale, patronymes récurrents) — liste fournie par Stéphane.
- L'UI existante de « toujours ignorer » écrit dans ce stockage.

**Portée TRANCHÉE par Stéphane le 2026-08-20 : DEUX COUCHES.**

| couche | contenu | portée | état |
|---|---|---|---|
| **1 · la base livrée** | vocabulaire **générique** : grades abrégés, civilités, renvois bibliographiques | **tous les clients**, sans que personne ne partage rien | **LIVRÉE** |
| **2 · le dico de la maison** | ce que la rédaction apprend : noms de personnes, d'unités, de projets | **par licence** (`licence_emails` fait déjà le lien 1↔N) | à faire |

Le partage mondial a été écarté : le vocabulaire d'un client transparaîtrait
dans le comportement de l'outil chez les autres, et la coquille d'un seul
rendrait tout le monde aveugle à cette faute.

#### Couche 1 — LIVRÉE le 2026-08-20

`app/lib/proof-dico-base.js` — 50 entrées en trois familles (28 grades,
12 civilités, 10 renvois), comparées en minuscules. Le fichier porte sa règle
d'admission : **rien qui appartienne à un client** n'y entre, et rien de moins
de trois signes (`minLetters` les couvre déjà — une telle entrée y serait morte
tout en donnant l'illusion de servir).

**Et une règle qui vaut mieux qu'une liste** : un mot dont un segment après
trait d'union porte une majuscule est un **nom composé**, où qu'il tombe dans la
phrase — `El-Bakri`, `al-Mansouri`, `Roche-Ferrand`. Ces mots-là échappaient à GP-1
parce qu'ils tombaient en tête de phrase, ou parce qu'ils commencent en
minuscule. Un composé commun garde ses segments en minuscules
(`socio-économiques`) : il reste vérifié.

**Résultat mesuré** : alertes affichées **32 → 28**, faux positifs **18 → 14**,
toujours **zéro vraie faute masquée**. La règle des composés en éteint 4, le
dico de base 1 (`Lcl`) — le corpus ne contient qu'un grade abrégé, mais une
revue militaire en est pleine.

#### L'onglet « Vocabulaire » — 2026-08-21

Manque relevé par Stéphane : *« c'est dommage de ne pas avoir pensé à imaginer
les dico comme un fichier à importer ou exporter afin de le transmettre à un
collaborateur ou client »*. Il a raison, et c'est plus qu'un confort — le
dictionnaire était prisonnier de la licence : impossible de le donner à un
client dont on monte l'installation, impossible de le reprendre en partant.
**Un outil qui met la souveraineté en avant doit laisser sortir ce qui
appartient à l'utilisateur.**

- Un **troisième onglet, discret**, à droite du filet (Texte · PDF · *Vocabulaire*).
  Il liste les mots appris, les retire un par un, et porte **Exporter** /
  **Importer**. Accepté comme entrée directe (`openGhostwriterProof('dico')`)
  mais **jamais mémorisé** : rouvrir l'outil retombe sur son travail.
- **Format : un fichier texte, un mot par ligne**, lignes `#` en commentaire.
  Lisible, modifiable dans n'importe quel éditeur, transmissible par courriel —
  et surtout pas du JSON (contrainte posée le 2026-08-20).
- **L'import COMPLÈTE, il ne remplace jamais.** Reprendre la liste d'un
  confrère n'efface pas la sienne.
- La règle d'admission vit dans le moteur (`normalizeDicoWord`) et le banc
  **prouve qu'elle est identique à celle du serveur** — deux copies d'une règle
  finissent toujours par diverger, et un mot accepté à l'écran mais refusé en
  base disparaîtrait sans un mot dire.
- Défaut corrigé au passage : au-delà de 500 mots, le reste était perdu en
  silence à la synchronisation. L'envoi se fait maintenant par tranches
  jusqu'au bout — un import de 900 mots n'en perd plus 400.

**⚠ Et une promesse d'écran qui était devenue fausse.** Le bas de la fenêtre
affichait « exécutée localement dans votre navigateur — **rien n'est envoyé en
ligne** ». Vrai jusqu'à GP-5, faux dès que le tri assisté est actif. Elle suit
désormais l'état réel du réglage, dans les deux sens. C'est exactement le
précédent du §9 (DK-9 avait déjà fait corriger une promesse affichée fausse) —
il a fallu une capture d'écran pour le voir, pas un test.

**Le filet** — `scripts/test-proof-ui.mjs`, 22 vérifications dans `npm test` :
la promesse dans ses deux états, l'onglet, et un **vrai fichier déposé** dans le
champ d'import (mots valides entrés, invalides écartés, liste existante
préservée). Vu rouge en cassant la promesse et en faisant remplacer l'import.

#### Couche 2 — LIVRÉE le 2026-08-20 · worker DÉPLOYÉ

**Pas de semis** : décision de Stéphane, « le dico se remplira seul » — au fil
des « toujours ignorer ».

| | |
|---|---|
| Portée | **la licence**. `claims.sub` EST le `lookup_hmac` de la licence : toutes les personnes rattachées à la même licence partagent le dico, et rien ne traverse vers un autre client. |
| Routes | `GET` et `POST /api/proof/dico` (`workers/src/routes/proof-dico.js`) |
| Stockage | D1, table `proof_dico (lookup_hmac, word, added_at, added_by)` |
| Coût | aucun appel IA, aucun crédit — c'est du stockage |
| Garde-fous | mot de 3 à 60 signes, lettres + trait d'union + apostrophe ; 5 000 mots par licence ; 500 par requête ; tout en minuscules |

**Deltas, jamais remplacement** : le client envoie `{ add, remove }`. Deux
personnes qui apprennent chacune un mot de leur côté ne s'effacent pas
mutuellement — un `PUT` de la liste entière l'aurait fait.

**Reprise sans perte** : au premier contact, l'interface fait l'**union** de ce
que ce navigateur avait appris seul et de ce que la licence connaît déjà, puis
fait monter la différence. Le `localStorage` reste ensuite comme **miroir** :
le correcteur continue de fonctionner hors ligne, sans licence, ou si le
serveur se tait. Un dictionnaire est un confort, jamais un mur.

**Le filet** — `workers/test/test-proof-dico.mjs`, 32 vérifications, dans
`npm test`. Le cœur : *ce qu'un membre apprend, l'autre l'a* — et son revers,
*et personne d'autre ne l'a*. Les deux ont été vus rouges en cassant le
cloisonnement.

⚠ **Reste à faire pour que ce soit vivant** : le front n'est pas poussé. Le
worker répond en prod (401 sans jeton, vérifié), mais rien ne l'appelle tant
que `app/ghostwriter-proof.js` n'est pas déployé sur Vercel (`git push`).

**Critère de fin** — ce qu'un membre apprend, un autre l'a ; rien n'est perdu à
la migration ; la liste reste consultable et purgeable.

---

### GP-3 · Les règles de grammaire qui se trompent

**But** — la seconde famille de faux positifs, toujours sans IA.

**Le levier existe déjà** : `_GRAMMAR_DENYLIST` fait taire des règles par
préfixe de `ruleId`. Elle est **figée dans le code** ; la mesure GP-0 produit
exactement ce qui doit l'alimenter.

**Livrable** — denylist étendue (et, si utile, rendue configurable), chaque
entrée **justifiée par ses occurrences dans le corpus**, commentée dans le code
avec la raison.

**Critère de fin** — re-mesure à l'appui : les faux positifs de grammaire
baissent, et **zéro vraie faute perdue**. Une règle qui attrape ne serait-ce
qu'une vraie faute dans le corpus **ne doit pas** être désactivée.

#### FAIT le 2026-08-20 — et le sprint s'est retourné

**La denylist ne devait pas être étendue. Elle devait être raccourcie.**

*1 · Les trois candidates du corpus ont été innocentées.* GP-0 désignait
`g2__tu_toponymes`, `g3__gn_un_2m` et `g3__gn_l_2m` (0 vraie faute chacune, 1
occurrence chacune). Passées à une **batterie de phrases inventées**, correctes
et fautives, de leur forme, les trois attrapent de vraies fautes :
`g3__gn_un_2m` corrige « Un rapport **complète** », `g3__gn_l_2m` corrige
« L'occasion **manqué** », `g2__tu_toponymes` corrige « Saint **Étienne** ». Le
critère de fin l'interdit donc : **aucune n'est désactivée**. Une occurrence
n'est pas une preuve.

*2 · La denylist existante, elle, coûtait des fautes.* Les 6 entrées posées le
2026-06-06 n'avaient **rien masqué du tout** sur les 22 070 signes du corpus —
mais elles taisaient quatre familles de vraies fautes :

| règle | ce qu'elle attrapait, et qu'on ne voyait plus |
|---|---|
| `gv1__imp_verbe_groupe3` | « **Prend** garde à toi » → « Prends » |
| `gv1__imp_verbe_groupe2_groupe3` | « **Finit** ton rapport » → « Finis » |
| `g2__conf_ça_çà_sa` | « **Sa** ne se fait pas » → « Ça » · « ça veste » → « sa » |
| `g0__virg_virgules_manquantes` | virgule devant « car » / « mais » |

*3 · La mesure a séparé le bon grain.* Chaque règle passée à deux batteries —
phrases correctes saisies, et texte de **forme PDF** (lignes coupées par la
maquette) :

| règle | phrases correctes | forme PDF | décision |
|---|---|---|---|
| impératif ×2 | 0 faux positif sur 14 | **4 déclenchements sur 10** — une ligne coupée commence par un verbe | **rendue au texte, coupée en PDF** |
| `g2__conf_ça_çà_sa` | 0 sur 17 | 0 | **rendue partout** |
| `g0__virg_virgules_manquantes` | **3 sur 10** — et son message est au conditionnel (« Si *car* est la conjonction… ») | — | **reste coupée** |
| `gv1__conj_nous2`, `gv2__conj_det_nom_sing_virgule` | jamais déclenchées | jamais | **restent coupées** (rien à gagner) |

**Même asymétrie que pour `skipWithDigits`** : l'audit du 2026-06-06 portait sur
un **PDF** (livre MICE). Ses conclusions étaient justes *pour ce matériau* et
fausses pour du texte saisi. D'où deux listes, `GRAMMAR_DENYLIST_TEXTE`
(3 entrées, défaut) et `GRAMMAR_DENYLIST_PDF` (5), la seconde passée par
`proof-pdf.js` via la surcharge partielle de `filterIssues`.

**Le filet** — 13 assertions « une phrase témoin par décision » (partie B bis du
banc). Recouper une règle rendue, ou rallumer une règle coupée en PDF, fait
tomber des assertions **nommées**. Vu rouge dans les deux sens, puis restauré.

---

### GP-4 · Le contrôle positif des noms (« vouliez-vous dire Lefebvre ? »)

**But** — rattraper ce que GP-1 a volontairement lâché, mais **par le haut**.

**La règle** — un mot capitalisé inconnu qui **ressemble à** un nom du
dictionnaire maison sans être identique (distance d'édition 1 ou 2, longueur
≥ 5) déclenche une suggestion : *« vouliez-vous dire Lefebvre ? »*. Contrôle
**positif** : très peu de faux positifs par construction, aucun appel IA, 100 %
local.

**Critère de fin** — sur le corpus enrichi de fautes de noms introduites
volontairement : les variantes sont retrouvées, et **aucun** faux positif
nouveau n'apparaît sur les textes propres.

**C'est la valeur que ne donnera jamais un correcteur générique** : un
correcteur qui connaît les noms de *L'Épaulette*.

---

### GP-5 · L'arbitrage IA invisible — **CONDITIONNEL**

**Ne pas lancer** tant que la re-mesure après GP-1/GP-3 n'a pas montré qu'il
reste assez de faux positifs pour le justifier. Il est possible qu'il ne reste
presque rien : dans ce cas, ce sprint **ne doit pas être fait**.

**Le principe** — Grammalecte souligne instantanément (comme aujourd'hui) ; en
arrière-plan, un modèle juge les seuls passages douteux et les alertes
injustifiées s'effacent en silence. Aucun bouton, aucune attente.

**Contraintes non négociables**
- Nouvel endpoint (`POST /api/ghostwriter/proof-verdict`) qui reçoit **uniquement
  les passages signalés** avec leur phrase — **jamais** le document entier.
- Le modèle rend **un verdict par alerte** (`vraie` / `faux-positif`). **Il ne
  réécrit rien** : c'est un juge, pas un correcteur.
- **Masquer seulement, jamais ajouter** (décision §4.2).
- **Un seul appel groupé** par analyse, plafonné, et **un cache** par (passage +
  phrase) : l'analyse se relance à chaque frappe ou presque.
  ⚠️ Précédent à ne pas rejouer : **Living Layer pesait 98 % de la consommation
  IA** parce qu'il s'appelait tout seul — un cache serveur de 10 min l'a réglé.
- **Métrage** comme toute surface IA : `budgetGuard`, `consumeCredits`,
  `refundCredits`, `recordUsage` (patron dans `workers/src/routes/ghostwriter.js`).
- **Fail-open** : erreur, quota épuisé, hors-ligne → on affiche Grammalecte tel
  quel, comme aujourd'hui. L'arbitrage ne peut qu'enlever du bruit.
- ⚠️ **Workers AI renvoie tantôt un objet, tantôt une chaîne** — parser
  défensivement (un `.trim()` direct a déjà coûté un TypeError avalé par un catch).
- **Transparence** (décision §4.4) : une ligne dans la documentation + un
  interrupteur dans les réglages pour revenir au tout-local.
- **Apprentissage** (décision §4.6) : un verdict « nom propre » alimente le
  dictionnaire de GP-2 → le mot n'est plus jamais envoyé.

**Critère de mise en service** — sur le corpus : **zéro faute réelle masquée**.
Si le critère n'est pas atteint, restreindre les catégories que l'IA a le droit
de toucher (les noms propres oui ; les accords seulement si la mesure le prouve),
et re-mesurer.

#### LIVRÉ le 2026-08-20 — après avoir été mesuré, refusé, restreint, re-mesuré

**Stéphane a demandé GP-5 malgré la recommandation inverse**, et pour une raison
qui tient : *« afin de capter ce que nous n'avons ou ne pouvons anticiper »*.
Aucune règle ne couvre ce qu'on n'a pas vu ; un juge, si.

**Premier passage : le critère N'ÉTAIT PAS atteint.** Soumis à toutes les
alertes d'orthographe affichées, le modèle a effacé 10 faux positifs — et
**6 vraies fautes**, toutes de la même famille : un toponyme mal orthographié et
des capitales sans accent. Il y voit des noms propres et ne remarque pas la
coquille. C'est exactement la famille que le garde « mêmes lettres » de GP-1
traite déjà, localement et gratuitement.

**La restriction** (`isArbitrable`, dans `proof-engine.js`) : le juge ne voit
pas une alerte dont une suggestion a **les mêmes lettres** (coquille
déterministe), ni un mot **contenant un chiffre** (une référence n'est pas un
nom), ni **aucune alerte de grammaire**. Le déterministe garde la main là où il
est bon ; le modèle ne sert que là où aucune règle ne sait trancher. L'écran et
la mesure interrogent **la même fonction** — ils ne peuvent pas diverger.

**Second passage : critère ATTEINT.**

| | |
|---|---|
| passages soumis | 9 (sur 20 avant restriction) |
| faux positifs effacés | **7 sur 8** |
| vraies fautes effacées | **0** |

**Effet projeté sur le tableau de bord** : alertes affichées **28 → 21**, faux
positifs **14 → 7**. Depuis le départ : **76 → 21 affichées, 63 → 7 faux
positifs**, et toujours zéro vraie faute masquée.

#### Comment les contraintes du §5 sont tenues

| contrainte | où |
|---|---|
| jamais le document, seulement les passages | `proof-verdict.js` ne lit que `items[]` ; le banc envoie un faux article et vérifie qu'il n'atteint pas le modèle |
| juge, pas correcteur | la consigne système l'interdit ; la réponse n'accepte que deux verdicts |
| masquer seulement | l'interface **filtre** la liste d'alertes ; elle ne peut structurellement pas en ajouter |
| un appel groupé, plafonné | 25 passages maximum, un seul `AI.run` |
| cache | serveur, par empreinte de (mot + phrase), 30 jours + cache de session côté écran |
| métrage | `budgetGuard`, `consumeCredits`, `refundCredits`, `recordUsage` — remboursé si rien n'est jugé |
| fail-open | quota, panne, binding absent, réponse illisible, hors ligne → **l'alerte reste** (9 assertions) |
| objet OU chaîne | `texteIA()` traite les deux, assertion dédiée |
| transparence §4.4 | chip **« Tri des alertes · assisté / sur l'appareil »** au-dessus du texte + deux entrées de documentation |
| apprentissage §4.6 | un nom jugé légitime rejoint le dictionnaire de la maison → **plus jamais envoyé** |

**Le filet** — `workers/test/test-proof-verdict.mjs`, 34 vérifications, dans
`npm test` (modèle doublé, zéro appel réel). La mesure de mise en service, elle,
est **hors** `npm test` : elle facture de vrais appels
(`npm run mesure:verdict`, worker de préversion requis).

---

## 6. Le tableau de bord (à remplir par GP-0, puis à chaque re-mesure)

| Mesure | Départ | Après GP-1 | Après GP-3 | Après GP-2 (base) | Après GP-5 |
|---|---|---|---|---|---|
| Alertes brutes | **78** | 78 | 78 | 78 | 78 |
| Alertes affichées | **76** | **32** | 32 | **28** | **21** |
| dont faux positifs | **63** (83 %) | **18** (56 %) | 18 | **14** (50 %) | **7** (33 %) |
| Fautes réelles ratées | **19** | 19 | 19 | 19 | 19 |
| Fautes réelles **masquées à tort** | **1** | **0** | 0 | **0** | **0** |
| Vraies fautes affichées | 13 | **14** | 14 | **14** | **14** |

> **GP-3 ne bouge pas ces chiffres, et c'est normal** : aucune des règles
> concernées ne se déclenche sur ce corpus. Son gain se mesure sur des
> **familles de fautes** que le corpus ne contient pas — voir §5/GP-3.

Mesuré le **2026-08-20** sur 3 articles réels de *L'Épaulette* (22 070 signes) :
un dossier historique, un billet satirique, un essai de stratégie. Les **78
verdicts sont validés par Stéphane** le 2026-08-20 à l'écran de relecture
(`verite.json`, `_relu`) — il a confirmé les 78 propositions sans en modifier
une seule. **La colonne « Départ » est donc ferme** : c'est le point de
comparaison de tous les sprints suivants.

**Le rapport de force : 63 faux positifs pour 13 vraies fautes affichées.**
Cinq alertes sur six sont injustifiées — c'est bien le problème décrit au §1,
et il est plus lourd que « des » faux positifs.

**⚠ Le banc était ROUGE au départ, et il avait raison.** `Km2` (pour km²) est
une vraie faute, signalée par Grammalecte, puis avalée par nos filtres. Le §4.3
était donc déjà violé, avant toute IA. **Réglé le 2026-08-20** — voir plus bas :
ce n'était pas le filtre qu'on croyait.

### Ce que la mesure a tranché pour les sprints suivants

**GP-1 ne doit PAS être livré sans GP-4.** Le banc a croisé la règle de GP-1
(majuscule hors début de phrase) avec les verdicts :

| | |
|---|---|
| gain | **48 faux positifs** disparaissent (sur 63) |
| perte | **5 vraies fautes** masquées (sur 13) : `Lybie` ×2, `Egypte`, `Ethiopie`, `Emiratis` |

Le §GP-1 annonçait cette perte comme « théorique ». Elle ne l'est pas : ce sont
**quatre mots sur cinq du même type** — un toponyme mal orthographié et trois
capitales sans accent. Livrer GP-1 seul, c'est laisser passer *Lybie* pour
*Libye*. GP-4 (« vouliez-vous dire… ») n'est donc pas un bonus : c'est la
**contrepartie obligatoire** de GP-1, et le dictionnaire de GP-2 doit contenir
`Libye`, `Égypte`, `Éthiopie`, `Émiratis` pour que le rattrapage fonctionne.

**GP-3 a ses trois premières candidates**, chacune vue 1 fois, chacune à
0 vraie faute sur le corpus :

| `ruleId` | ce qu'elle a fait |
|---|---|
| `g2__tu_toponymes` | réclame un trait d'union sur un nom de saint employé comme **anthroponyme** (un roi), règle prévue pour les toponymes |
| `g3__gn_un_2m` | un **nom en apposition invariable** derrière un nom masculin, pris pour un accord de genre fautif |
| `g3__gn_l_2m` | un participe passé rattaché au nom d'un **complément circonstanciel** intercalé au lieu du sujet |

Les cinq autres règles déclenchées ont attrapé du **vrai** (trait d'union de
« -ci », élision fautive, accent sur une capitale, accord d'un nombre écrit en
lettres, trait d'union après un préfixe) : ne pas y toucher. Corpus trop mince pour trancher au-delà — une occurrence chacune.

**Ce que la mesure a établi sur le MOTEUR lui-même** (comportement du moteur,
pas du corpus) :

- Grammalecte **ne signale jamais** un mot TOUT-CAPITALES ni un token contenant
  un chiffre, **même en brut** (`noFilter:true`). Nos filtres `skipAllCaps` et
  `skipWithDigits` sont donc **largement redondants** : ils ne peuvent presque
  pas masquer une vraie faute — mais une coquille dans un titre en capitales
  (`RESSSOURCE`) est **invisible de bout en bout**. C'est une « faute ratée »
  structurelle, pas un réglage.
- `minLetters: 3` est le **seul filtre actuel** qui présente le risque du §4.3 :
  `vn` (coquille pour « un ») est signalé brut, puis masqué. À garder à l'œil
  quand le corpus arrivera.

---

## 7. Pièges connus (payés au moins une fois)

- **Dépôt public** → jamais de contenu réel de la revue commité (`_corpus-proof/`
  dans `.gitignore`).
- **jsdom ne peut pas exécuter le moteur** (Web Worker) : le banc doit être un
  vrai navigateur — puppeteer est déjà une dépendance.
- **Deux consommateurs** : `ghostwriter-proof.js` **et** `proof-pdf.js`. Une
  modification de `analyze`/`filterIssues` touche les deux.
- **Le moteur est importé en lazy** dans l'UI (`await import(...)`) : un banc qui
  l'importe autrement ne teste pas le chemin réel.
- **Un banc n'est fini que quand on l'a vu attraper** : réintroduire chaque
  défaut un par un, vérifier que le banc devient rouge **avec l'assertion
  nommée**, restaurer, et le prouver par `git diff`.
- **Un modèle est mauvais là où une règle est bonne, et l'inverse.** Soumis à
  tout, le juge de GP-5 effaçait six vraies fautes — toutes d'une famille que
  trois lignes de code local traitent parfaitement (accent sur une capitale,
  lettres interverties). La leçon n'est pas « le modèle est mauvais » : c'est
  qu'il ne faut **pas lui soumettre ce qu'une règle tranche déjà**. Mesurer
  d'abord, restreindre ensuite, re-mesurer — et faire lire la restriction par
  la MÊME fonction à l'écran et au banc, sinon les deux divergent en silence.
- **Un banc qui ne voit pas un `DELETE` non filtré est un banc qui ment.** Sur
  le dico de la maison, la fuite en LECTURE était couverte ; la fuite en
  ÉCRITURE ne l'était pas. Un `DELETE ... WHERE word = ?` sans `lookup_hmac`
  effaçait le vocabulaire d'un autre client, et les 30 assertions restaient
  vertes. Trouvé en réintroduisant le défaut exprès. **Pour chaque écriture
  cloisonnée, il faut une assertion « ça n'a pas touché le voisin »** — pas
  seulement une assertion « le voisin ne le voit pas ».
- **Une denylist se décide sur une BATTERIE, jamais sur une occurrence.** Les
  trois règles que le corpus désignait comme fautives attrapent toutes de
  vraies fautes dès qu'on les sonde avec des phrases de leur forme. « 0 vraie
  faute dans le corpus » veut dire « le corpus ne contient pas cette faute »,
  pas « la règle est mauvaise ».
- **Un audit fait sur un PDF ne vaut pas pour du texte saisi.** Deux fois de
  suite (`skipWithDigits`, règles d'impératif), un réglage juste pour la
  relecture de PDF s'est révélé nuisible pour la relecture de texte. Les deux
  chemins partagent le moteur mais pas le matériau : toujours se demander sur
  QUOI la mesure a été faite.
- **L'espace insécable casse tout balayage de position.** La typographie
  française met une insécable (U+00A0, parfois U+202F) après `«` et avant `:`.
  Un balayage arrière qui ne connaît que `' '` et `\t` s'arrête dessus et
  conclut faux — c'est arrivé au premier jet de GP-1, où les deux variantes de
  la règle rendaient exactement le même chiffre parce qu'aucune n'atteignait
  jamais le guillemet. Utiliser `\s` (qui couvre l'insécable), et se méfier
  d'un A/B qui donne deux fois le même résultat : c'est souvent qu'aucune des
  deux branches ne s'exécute.
- **Une page ouverte sur un serveur éteint accepte les clics et les jette.**
  Le 2026-08-20, 78 validations ont été faites dans une fenêtre dont le serveur
  avait été arrêté : la page fonctionnait (elle a tout son état en mémoire),
  seul un libellé gris dans un coin disait l'échec. Rien n'avait atteint le
  disque. Récupéré en relançant le serveur **sur le même port** (`--port=`)
  puis en repoussant l'état de la page. Correctifs posés : barrage plein écran
  au premier échec, commande de reprise affichée avec le bon port, bouton qui
  repousse TOUT l'état, et avertissement si l'on ferme l'onglet en panne.
  Leçon générale : **une écriture qui échoue doit barrer l'écran**, pas se
  signaler en gris.
- **Le corpus ne se juge pas à l'aveugle** : c'est le banc qui écrit
  `verite.modele.json` (toutes les alertes brutes pré-remplies), l'humain ne
  fait que trancher. Demander des verdicts avant d'avoir la liste, c'est
  demander l'impossible.
- **Un `.txt` modifié après coup décale tous les verdicts** : ils sont indexés
  par `offset+len`. D'où l'empreinte par texte, et l'avertissement.
- **Le tokenizer coupe sur `/`** : deux mots corrects séparés par une barre
  oblique ont produit une alerte sur un fragment de trois lettres du second.
  Faux positif imparable côté règles.
- **Ne pas confondre « filtré par nous » et « jamais signalé »** : les capitales
  et les tokens à chiffres ne franchissent même pas Grammalecte. Un raisonnement
  fondé sur nos filtres seuls compterait des gains qui n'existent pas.
- **PWA** : toute modification d'un `.js`/`.css` servi en cache-first exige
  `npm run bump-sw -- --suffix=xxx`, sinon les clients gardent l'ancien cache.
- **Déploiement** : front = `git push origin main` (Vercel auto). Worker (GP-2,
  GP-5) = `cd workers && npx wrangler deploy`, **uniquement après un « go »
  explicite de Stéphane**.

---

## 8. Les ordres à donner (un par session neuve)

> Chaque ordre est autoporté : la session doit d'abord lire ce fichier.
> Les faire **dans l'ordre**. Ne pas enchaîner GP-5 sans avoir relu §5/GP-5.

**GP-0**
```
Lis GHOSTWRITER_PROOF_SPRINTS.md et réalise le sprint GP-0 (la mesure).
Le corpus n'est pas encore là : écris le banc pour qu'il fonctionne sans lui
(il l'annonce et s'arrête proprement), et dis-moi exactement quoi te fournir
et sous quelle forme. Rappel : dépôt public, aucun texte réel commité.
```

**GP-1**
```
Lis GHOSTWRITER_PROOF_SPRINTS.md et réalise le sprint GP-1 (l'impasse sur les
noms propres). Respecte le critère de fin : zéro faux positif « nom propre »
sur le corpus, aucune alerte de grammaire masquée, proof-pdf.js non cassé.
Montre-moi le banc en train d'attraper le défaut avant de livrer.
```

**GP-2**
```
Lis GHOSTWRITER_PROOF_SPRINTS.md et réalise le sprint GP-2 (dictionnaire de la
maison, partagé). Commence par me poser la question de portée (compte ou
utilisateur) — ne code pas avant ma réponse. Le worker ne se déploie qu'après
mon « go » explicite.
```

**GP-3**
```
Lis GHOSTWRITER_PROOF_SPRINTS.md et réalise le sprint GP-3 (règles de grammaire
qui se trompent). Chaque règle désactivée doit être justifiée par ses
occurrences dans le corpus et commentée dans le code. Critère : zéro vraie
faute perdue, re-mesure à l'appui.
```

**GP-4**
```
Lis GHOSTWRITER_PROOF_SPRINTS.md et réalise le sprint GP-4 (« vouliez-vous dire
Lefebvre ? »). Tout doit rester local, sans appel IA.
```

**GP-5 — seulement si la re-mesure le justifie**
```
Lis GHOSTWRITER_PROOF_SPRINTS.md. Avant toute chose, montre-moi la re-mesure
après GP-1 et GP-3 et dis-moi franchement si GP-5 se justifie encore. Si oui,
réalise-le en respectant TOUTES les contraintes du §5/GP-5 — en particulier :
masquer seulement, un appel groupé avec cache, métrage, fail-open, interrupteur
et ligne de documentation. Critère de mise en service : zéro faute réelle
masquée.
```

---

## 9. Ce qu'il ne faut PAS faire

- Remplacer Grammalecte par autre chose : le problème n'est pas le moteur.
- Envoyer le texte entier à l'IA pour « corriger » : c'est le chemin qui
  **réécrit** l'auteur. Le banc `scripts/mesure-relecture.mjs` (desK, DK-9) a
  déjà mesuré ce risque sur l'autre chemin et a fait **corriger une promesse
  affichée à l'écran** qui était fausse.
- Toucher au bouton « Relire avec Ghost Writer » de desK : autre chemin (§3).
- Promettre « aussi fort que Claude » : le moteur géré est **Mistral Small**, un
  modèle bien plus petit. L'objectif de ces sprints est un correcteur **qui se
  trompe beaucoup moins**, pas un modèle de langue.
