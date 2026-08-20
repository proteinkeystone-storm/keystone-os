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
| Tests du moteur | **AUCUN.** `isNoiseSpelling` est *pure et testable*, elle n'est **pas testée**. `scripts/test-ghostwriter-*.mjs` couvrent la réécriture LLM, pas la relecture. |
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

**Décision à faire confirmer par Stéphane avant de coder** : portée **par compte
(l'équipe partage)** ou **par utilisateur** ? Ghost Writer est un outil général,
pas un outil de publication — le rattachement naturel est le compte.

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

---

## 6. Le tableau de bord (à remplir par GP-0, puis à chaque re-mesure)

| Mesure | Départ | Après GP-1 | Après GP-3 | Après GP-5 |
|---|---|---|---|---|
| Alertes brutes | — | | | |
| Alertes affichées | — | | | |
| dont faux positifs | — | | | |
| Fautes réelles ratées | — | | | |
| Fautes réelles **masquées à tort** | 0 | | | |

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
