# desK — sprints avant la vraie mise en production

> Brief autoporté, rédigé le **2026-08-05**. Une session neuve doit pouvoir agir
> sans rien d'autre que ce fichier. Pad **desK** (`O-DSK-001`), revue
> *L'Épaulette*. Dépôt : `1 - PROJETS/PROJET_KEYSTONE/KEYSTONE_OS`.

---

## 1. Pourquoi ces sprints existent

desK est **déjà en production** et fonctionne. Ces sprints ne servent pas à
finir des fonctions : ils servent à **protéger ce qui marche** avant de confier
l'outil à la rédactrice en chef, qui n'y a encore jamais touché.

Le constat qui les motive, établi le 4 août 2026 lors du premier usage réel :

- **Sept défauts trouvés en une soirée**, plusieurs sur le chemin principal —
  dont une contribution triée qui partait au marbre au lieu de sa page, c'est-à-dire
  la promesse centrale de l'app.
- **Un de ces défauts avait été introduit deux heures plus tôt** par un correctif
  de la même soirée (le champ `status` absent du bac faisait ouvrir le panneau de
  reprise au lieu du panneau de tri).
- **Les huit bancs desK et les 900 assertions de `npm test` étaient verts** pendant
  ces heures-là. Aucun ne pouvait voir ces bugs : ils vivaient tous dans le front,
  qui n'a **aucun test**.
- **Dix-sept déploiements en production dans la soirée**, écrits, testés et
  déployés par le même agent, sans second regard.

Autrement dit : le produit est sain, les conditions de fabrication ne le sont pas.

---

## 2. État au 2026-08-05

| | |
|---|---|
| `main` | `515ca8f` |
| Front en prod | `ks-os-v5.28.486-desk-dk9`, `app/desk.css?v=19` (vérifié : trois sondes espacées) |
| Worker en prod | version `14757e27` (déployée depuis `8818066`) — colonnes `dk_inbox.auth`/`auth_detail` confirmées en D1 prod |
| Bancs desK | **9/9 verts** (DK-2 48, DK-3 30, DK-4 33, DK-4b 22, DK-4c 54, DK-5 19, casier 20, signal 6, **DK-8 37**) |
| `npm test` | **zéro échec** — 72 vérifications de front (DK-7 52 + DK-8 11 + DK-9 9) et 27 sur le parseur Ghost Writer (14 avant DK-9) |
| Front desK | `app/desk.js` **3 228 lignes**, `app/desk.css` 865 — ~~zéro test~~ → **banc `test-desk-ui.mjs`, 72 vérifications** (DK-7 + DK-8 + DK-9) |
| Membres du pad | **1** (Stéphane). La rédactrice n'a aucun accès. |

> Deux échecs de bancs traînaient depuis des semaines. Aucun n'était un bug —
> les deux étaient des bancs mal outillés, et les deux ont été soldés le
> 2026-08-05 en corrigeant au passage une vraie fragilité de production :
> `sweepDeskCasier` retombait sur un délai de grâce **0** si la variable était
> illisible (la purge aurait emporté les pièces à la seconde où un numéro passe
> « imprimé ») ; `shouldReload` recevait une horloge injectée mais lisait le mois
> sur celle du serveur. **Leçon à garder : un banc rouge depuis longtemps est
> plus souvent un banc mal outillé qu'un bug — mais le diagnostiquer révèle
> parfois autre chose.**

Ce qui a été livré le 4-5 août (tout en prod) : adresse du contributeur saisie à la
création d'article, mail transféré attribué à son auteur, habitudes protégées de
l'adresse de l'équipe, accusé de réception, **bannette** (tout le courrier reçu,
quel qu'en soit le sort, avec reprise d'un courrier classé), pastille « non lu »,
choix de la page au tri, pièces jointes qui suivent l'article sur sa page,
« au marbre » qui ne compte plus que ce qui attend vraiment, relecture Ghost Writer
(action `improve`, une seule version, comparatif mot à mot, reprise dans l'article),
confirmations amenées à l'écran.

---

## 3. Les sprints

### DK-7 · Le filet du front — ✅ **LIVRÉ le 2026-08-05**

**Ferme :** 3 203 lignes sans un test ; des bancs verts pendant que l'app était cassée.

> **Ce qui existe maintenant :** `scripts/test-desk-ui.mjs`, **52 vérifications**,
> dans la chaîne `npm test` (et `npm run test:desk-ui` seul, ~12 s). Il démarre le
> **vrai** `app/desk.js` dans Chrome (puppeteer, déjà dépendance du dépôt) avec
> `app/desk.css` et `app/ghostwriter.js` — rien n'est réimplémenté. Le worker,
> lui, est **doublé en mémoire** dans le script (mêmes routes, mêmes formes de
> payload que `workers/src/routes/desk.js` et `desk-email.js`) : le banc tourne
> donc **sans `wrangler dev`**, sinon `npm test` virerait au rouge dès que le
> worker n'est pas lancé. Aucun harnais à supprimer avant commit : la page de
> test est servie depuis la mémoire par le script.
>
> **Pourquoi un navigateur et pas jsdom :** le parcours 5 mesure un dépassement
> en pixels. jsdom n'a pas de moteur de mise en page — `getBoundingClientRect()`
> y rend des zéros et le test passerait au vert sans rien prouver.
>
> **Deux partis pris à connaître avant d'y toucher :**
> - Le bac est servi **sans la colonne `status`** sur une des entrées — c'est
>   exactement le payload de production du 4 août. Le front doit ouvrir le
>   panneau de tri quand même. Remettre `status` partout rendrait l'assertion
>   muette. (Le worker, lui, est gardé par `workers/test/test-desk-dk4c-bannette.mjs`.)
> - Chaque confirmation du parcours 5 est vérifiée **deux fois** : dépassement
>   réel = 0 px, ET « sans le guetteur, elle serait sous le pli » > 0 px. La
>   seconde assertion empêche le test de passer au vert pour rien le jour où la
>   mise en page changera.
>
> **Preuve que le filet attrape** (faite le 2026-08-05, chacun des neuf défauts
> réintroduit dans `desk.js` puis restauré) : les 9 font virer le banc au rouge,
> avec l'assertion nommée. Le plus parlant — le guetteur de confirmations retiré
> donne 1 197 px hors cadre sur « Supprimer un article ». Pendant ce temps, les
> **875 autres assertions de `npm test` restent vertes** : c'est précisément
> l'angle mort que ce banc ferme.

Un banc qui démarre le **vrai** `app/desk.js` et rejoue les cinq parcours qui ont
cassé le 4 août. Le patron existe déjà dans le dépôt : `scripts/test-kora-desk.mjs`
fait tourner du code de pad avec `fetch`, `localStorage` et `document` simulés.
Ici il faut un DOM complet (jsdom ou équivalent) et le worker local en face.

Les cinq parcours, choisis parce que ce sont **exactement** ceux qui ont lâché :

1. **Tri d'une contribution** → le bon panneau s'ouvre (celui du tri, pas celui de
   reprise), la rubrique est retenue, l'article se pose sur la **page** choisie,
   et sa pièce jointe apparaît dans le casier **de cette page**.
2. **Bannette** → un courrier arrivé après une première visite est visible à la
   réouverture (pas de cache périmé), la pastille concorde avec la liste,
   l'effacement depuis la liste retire la ligne sans toucher à l'article.
3. **Création d'article** → l'e-mail du contributeur est enregistré, la pièce mise
   en attente est versée après création, la rubrique de la page est pré-remplie.
4. **Relecture** → le modal s'ouvre en mode relecture (pas de pills de ton, une
   seule version), la reprise **réécrit réellement `notes`**, et l'éditeur affiche
   le texte corrigé.
5. **Confirmations** → toute confirmation ouverte est entièrement dans le cadre du
   panneau (mesurer le dépassement, pas « ça a l'air bon »).

**Fini quand :** `npm test` échoue si l'un des sept défauts du 4 août revient.
C'est le seul critère qui compte. — **Vérifié** : avec le défaut du panneau de tri
réintroduit, `npm test` sort en code 1.

**Fichiers :** `app/desk.js`, `app/ghostwriter.js` (lecture) ; nouveau
`scripts/test-desk-ui.mjs` ; `package.json` (chaîne `npm test`).

**Piège connu :** en préversion, le navigateur ressert les modules depuis son cache
— `desk.js` importe `./ghostwriter.js` sans cache-buster, donc une modif de
Ghost Writer peut rester invisible. Forcer `fetch(url, {cache:'reload'})` puis
recharger, ou importer avec un suffixe `?t=Date.now()`. (Le banc contourne le
piège en important `/app/desk.js?t=<horodatage>` et en servant tout en `no-store`.)

**Reste possible plus tard, hors DK-7 :** le banc ne couvre que les cinq parcours
qui ont lâché. Le glisser-déposer de la frise, la pré-impression et le bouclage
n'ont toujours aucun test de front.

---

### DK-8 · La porte d'entrée increvable — ✅ **EN PROD le 2026-08-05**

**Fermait :** une vague d'indésirables refoulait les vrais contributeurs ; `From`
restait falsifiable alors qu'on s'apprête à publier l'adresse à tous les
contributeurs.

**a) Un plafond par expéditeur.** `MAX_PENDING_PER_SENDER = 20` à côté de
`MAX_INBOX_PENDING = 200` (surchargeables par `DK_INBOX_MAX_SENDER` /
`DK_INBOX_MAX`). Ce ne sont **pas des portes** : ils ne disent que le nombre de plis
posés DEVANT la rédactrice. C'est le plafond par expéditeur qui fait tout le travail
— sans lui, une avalanche d'un seul indésirable occupe les 200 places et le
contributeur suivant ne trouve plus de bureau où se poser.

**b) Le bac plein ne refuse plus rien.** Au-delà des plafonds, le pli est **mis de
côté** (`dk_inbox.status = 'differe'`) : reçu, stocké, pièces jointes comprises,
visible dans la bannette, triable à la main — et **repêché tout seul** dès qu'une
place se libère (`_repecherDiff`, appelé à chaque nouveau pli et à chaque
tri/rejet/effacement). Le repêchage sert **par expéditeur, le plus ancien d'abord** :
les 280 messages d'une avalanche ne doublent jamais la contribution légitime arrivée
derrière eux. `setReject` ne subsiste que pour l'adresse de dépôt inconnue et le
message illisible ; une panne interne remonte en exception (réessayable) plutôt qu'en
refus définitif.

**c) SPF/DKIM lus.** `Authentication-Results` est lu sur `message.headers` (repli sur
le MIME parsé), rangé dans `dk_inbox.auth` / `auth_detail` (`'pass'` | `'fail'` |
NULL quand le message n'en porte aucune — NULL = comportement d'avant, on n'invente
pas de verdict rétroactif). Un `fail` **interdit le rattachement automatique** : le
pli descend au bac avec la cible toujours proposée, la mention affichée en clair sur
le panneau de tri et dans la bannette, et **aucun accusé de réception** (l'envoyer
reviendrait à écrire au contributeur dont on a usurpé l'adresse). Lecture
**fail-safe** : toutes les mentions du champ sont balayées, le moindre `fail`
l'emporte — un faux `spf=pass` ajouté après coup ne blanchit rien.

> Contexte : l'audit de juillet 2026 avait acté que la digestion fait confiance au
> champ `From`, falsifiable, en jugeant le risque acceptable **parce que la
> rédactrice transférait**. Le modèle a changé le 4 août (envoi direct des
> contributeurs, encouragé). L'arbitrage est réévalué ici.

**Fini quand :** un banc prouve (1) qu'une avalanche de 300 messages ne fait pas
refuser le 301ᵉ contributeur légitime, (2) qu'un message échouant à SPF ne se pose
jamais tout seul sur une page. — **Fait.**

> **Le banc :** `workers/test/test-desk-dk8-porte.mjs`, **37 vérifications**, ~25 s.
> L'avalanche est jouée **en vrai**, avec les plafonds de production : 300 messages
> injectés un par un, puis le 301ᵉ. Aucun n'est refusé ; l'avalanche n'occupe que
> 20 lignes du bac, les 280 autres sont mises de côté, et le contributeur légitime
> arrive **directement** sur le bureau. Le bac est ensuite rempli à 200 pour
> vérifier le pli de trop (reçu, mis de côté, motif `bac-plein`) et le repêchage
> équitable. Côté SPF : même message, expéditeur connu, papier attendu **posé en
> page** — avec `spf=fail` il s'arrête au bac, l'article reste « attendu » et sa
> pièce n'entre pas au casier.
>
> **Preuve que le filet attrape** (2026-08-05, trois défauts réintroduits puis
> restaurés) : garde d'authentification retirée → 10 rouges ; ancien
> `return { ok:false, reason:'bac plein' }` rétabli → 11 rouges dont la ligne
> « la contribution est REÇUE » ; plafond par expéditeur retiré → 8 rouges dont
> « il n'est même pas mis de côté ».
>
> **Côté écran** (un banc de worker ne voit pas si la rédactrice l'apprend) :
> `scripts/test-desk-ui.mjs` gagne un **parcours 6** (+11 vérifications, **63** au
> total) qui mesure la hauteur rendue de l'avertissement et vérifie qu'un pli mis de
> côté ouvre bien le panneau de TRI. Les deux régressions correspondantes ont été
> vues virer au rouge.
>
> **Un piège en moins :** le banc prend un propriétaire daté (`sub` horodaté) —
> sinon `MAX_PUBS_OWNED` le refuse au bout de quelques relances sur un même état
> local, et l'échec ressemble à un bug du sprint.

**Fichiers :** `workers/src/routes/desk-email.js`, `workers/src/routes/desk.js`
(colonnes `auth`/`auth_detail`, `auth` dans le payload du bac, purge 90 j étendue
à `differe`) ; `app/desk.js`, `app/desk.css`, `app.html` (`?v=19`) ;
`workers/test/test-desk-dk8-porte.mjs` ; `scripts/test-desk-ui.mjs`.

---

### DK-9 · La relecture tenue à sa promesse — ✅ **EN PROD le 2026-08-05**

**Fermait :** le modal affichait « Les mots de l'auteur sont préservés » et personne
ne l'avait vérifié.

**L'instrument :** `scripts/mesure-relecture.mjs`. Il passe des textes dans le
**vrai** chemin de production (mêmes paramètres que le bouton de `app/desk.js`) et
classe chaque correction : *typographie*, *orthographe/accord*, et les trois qui
cassent la promesse — *réécriture*, *ajout*, *retrait*. Plus des contrôles durs
(noms propres, chiffres, dates) et un contrôle de **mise en paragraphes**. Le
comparatif est une **copie verbatim** de `_diffMots` : le chiffre annoncé est celui
que la rédactrice voit. Hors `npm test` (appel Mistral réel, facturé, non
déterministe) ; `MESURE_HORS_LIGNE=1` reclasse une mesure déjà payée.

**Ce que la mesure a trouvé — et qui n'était pas la question posée.**

1. **La relecture rendait l'article en un seul bloc.** 5 lignes vides sur 5 perdues,
   3 textes sur 3. Pas le modèle : `_parseDelimited` et son `.filter(Boolean)`.
   **Invisible** — le comparatif du modal neutralise les blancs, il n'avait rien à
   montrer. La rédactrice reprenait sa copie sans paragraphes, en silence.
2. **Le modèle développait les sigles.** Sur un vrai papier : « SLT MAZELLA » →
   « lieutenant Mazella », « DA » → « division d'application » **quatre fois**. Dans
   une revue de corps, l'abréviation EST le vocabulaire.
3. **Le modèle recoupait les paragraphes.** 6 rendus en 8, 8 rendus en 12. Il aère
   les longs, jamais il ne fusionne. Réécriture de la forme, invisible elle aussi.

**Ce qui a été fait, dans cet ordre, en mesurant après chaque pas :**

| | promesse entamée |
|---|---|
| état initial, sur les 3 vrais textes | **12** |
| consigne système resserrée (sigles, synonymes, découpe, chiffres) | **4** |
| découpe rendue par le code (`gwRecollerParagraphes`) | **2** |
| classement du banc corrigé (un nom composé soudé = orthographe) | **1** |

**Le dernier écart, en 1 166 mots de vrais papiers :** « plus faible » → « moindre ».
Un synonyme. Tout le reste est du travail de correcteur : mois en minuscules,
`1ère` → `1re`, `Emirats Arabes Unis` → `Émirats arabes unis`, `l'Ecole` → `l'École`,
`50km/h` → `50 km/h`, `11%` → `11 %`, `fort` → `forts`, `services` → `service`.
Noms propres, chiffres et dates : **tous intacts** (52 + 31 contrôlés).

**Le libellé, tranché d'après la mesure.** « Les mots de l'auteur sont préservés »
était vrai 37 fois sur 38 — donc faux, et sur le papier de quelqu'un d'autre. Le
modal annonce désormais les deux choses qui ne peuvent pas mentir :

> Relecture — orthographe, grammaire, typographie.
> **Vos paragraphes sont gardés, chaque correction est surlignée.**

La découpe est garantie par le code, et rien n'entre dans l'article sans passer
surligné sous les yeux de la rédactrice.

**Les garde-fous, tous hors ligne, dans `npm test` :**
`scripts/test-ghostwriter-parse.mjs` passe de **14 à 27** assertions (paragraphes
préservés, découpe rendue, refus de recoller si le modèle a fusionné ou si le volume
a bougé, guillemet fermant d'une citation finale). `scripts/test-desk-ui.mjs` passe
de **63 à 72** : le sous-titre ne promet plus ce qui est faux, annonce ce qui est
garanti, et **tient dans son en-tête** (0 px de débordement, mesuré).
Vu attraper : `.filter(Boolean)` remis → l'assertion des paragraphes vire au rouge.

**Fichiers :** `workers/src/routes/ghostwriter.js` (consigne `solo`,
`_parseDelimited`, `_recollerParagraphes`) ; `app/ghostwriter.js` (libellé) ;
`app/desk.js` (commentaire faux corrigé — `lengthTarget` n'atteint pas la branche
`solo`, c'est `variants: 1` qui fait tout) ; `scripts/mesure-relecture.mjs` (neuf) ;
`scripts/test-ghostwriter-parse.mjs`, `scripts/test-desk-ui.mjs` ; `.gitignore`.

> **Le bruit typographique, réglé le 2026-08-05** (demandé par Stéphane après
> lecture de la mesure). Le comparatif classe désormais chaque correction :
> celles qui touchent un **mot** restent surlignées franchement, celles qui ne
> touchent qu'un **signe** (apostrophe, accent, espace insécable, ligature,
> ponctuation, trait d'union) sont **repliées** — le texte s'affiche corrigé, sans
> surlignage. Une case « montrer aussi la typographie (n) » les déplie, en
> sourdine. Le compteur du haut annonce les corrections **sur les mots**.
> Effet sur les vrais papiers :
>
> | | avant | après |
> |---|---|---|
> | reel-1 | 23 en vrac | **1** sur les mots · 9 repliées |
> | reel-2 | 54 en vrac | **5** sur les mots · 15 repliées |
> | reel-3 | 24 en vrac | **2** sur les mots · 7 repliées |
>
> La règle de classement est **la même** que celle du banc de mesure (`norm` /
> `hunks` / `classe`) : le banc mesure ce que la rédactrice voit. Les deux doivent
> rester en phase. Gardé par 6 assertions de `test-desk-ui.mjs` (66 → **72**), dont
> « un accent corrigé s'affiche corrigé, sans surlignage ni doublon » et « une
> vraie faute montre encore le mot d'origine barré ». Vu attraper : le classement
> neutralisé, 4 assertions virent au rouge.

> **Les textes de contributeurs restent hors dépôt** : `_design-lab/relecture-dk9/`
> est au `.gitignore` (le dépôt est public). Pour re-mesurer après un changement de
> modèle ou de consigne : y poser des `.txt`, lancer le worker de banc, puis
> `node scripts/mesure-relecture.mjs`.

### DK-10 · La rédactrice en chef — **le vrai passage en prod**

**Ferme :** celle qui va s'en servir n'a jamais vu un écran ; toute l'ergonomie a
été validée par une seule personne.

L'inviter (Réglages → Équipe → inviter par l'e-mail de **sa** licence Keystone),
lui faire le tour, et lui laisser mener **un numéro complet** — pas une
démonstration : un vrai bouclage, de la première contribution au passage en
« imprimé ».

**Fini quand :** un numéro est bouclé avec elle aux commandes, et la liste de ses
frictions est écrite. C'est cette liste qui dira si l'app est bonne.

**Coût :** du calendrier, pas du code.

---

## 4. Ce qu'il ne faut PAS faire avant la prod

- **Découper `desk.js`.** Tentant, inutile avant la prod, et risqué tant que DK-7
  n'existe pas. Après.
- **Le « vu » partagé entre appareils** et **l'alerte quand desK est fermé** :
  limites connues et assumées. Pas avant que la rédactrice ait dit si ça la gêne.
- **Chercher un bug dans la purge du casier.** Élucidé le 2026-08-05 : c'était un
  **faux échec**, il manquait `DK_CASIER_GRACE_DAYS = "0"` dans
  `workers/wrangler.dktest.toml`. La variable y est maintenant, DK-3 passe 30/30.

---

## 5. Comment lancer les bancs

Une **seule** commande vaut pour toute la campagne desK (les bancs partagent une
session worker) :

```bash
cd workers && npx wrangler dev --local -c wrangler.dktest.toml --port 8799 --test-scheduled --var KS_JWT_SECRET:dk2-test-secret --var "KS_ALLOWED_ORIGIN:*" --var KS_ADMIN_SECRET:dk4-admin --var DK_EMAIL_IA:off
```

Puis, dans `workers/` :

```bash
for t in dk3 dk5-board dk4 dk2 artcasier newsignal dk4b-transfert dk4c-bannette dk8-porte; do node test/test-desk-$t.mjs; done
```

**Attendu :** DK-2 48, DK-3 30, DK-4 33, DK-4b 22, DK-4c 54, DK-5 19, casier 20,
signal 6, DK-8 37 — **zéro échec**.

> **DK-8 en dernier**, comme dans la liste ci-dessus : il écrit ~480 entrées de bac
> (l'avalanche est jouée en vrai) et compte ~25 s. Il est relançable à volonté sans
> effacer D1 — il se crée un propriétaire neuf à chaque passage.

### Pièges des bancs

- **Effacer l'état local D1/R2 entre deux campagnes** :
  `rm -rf workers/.wrangler/state/v3/d1 workers/.wrangler/state/v3/r2`.
  Sinon `test-desk-dk5-board.mjs` échoue faussement — il compte les numéros vivants
  de **toutes** les publications, y compris celles créées par les bancs voisins.
- **Toute variable de banc doit vivre dans `wrangler.dktest.toml`**, jamais dans la
  ligne de commande : un banc voisin l'oubliera. C'est ce qui a fait croire deux
  fois à un bug de purge.
- Un vieux `wrangler dev` survivant tient le port 8799 **et** recharge le code sans
  les nouvelles `--var` : `pkill -f "wrangler dev"` avant de relancer.

---

## 6. Piloter le vrai pad dans un navigateur

Indispensable pour DK-7. Harnais jetable à la racine (**à supprimer avant tout
commit**) :

```html
<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/app/style.css">
<link rel="stylesheet" href="/app/workspace.css">
<link rel="stylesheet" href="/app/desk.css">
</head><body><script type="module">
localStorage.setItem('dk_api','http://127.0.0.1:8799');
localStorage.setItem('ks_jwt','<JWT de test>');
localStorage.removeItem('dk_last_pub'); localStorage.removeItem('dk_last_issue');
const { openDesk } = await import('/app/desk.js?t='+Date.now()); openDesk({});
</script></body></html>
```

Serveur : `.claude/launch.json` → « Keystone OS — Fresh Cache Server » (port 3001).

**JWT de test** (même secret que le worker de banc) :

```bash
node -e "const c=require('node:crypto');const b=x=>Buffer.from(x).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');const n=Math.floor(Date.now()/1e3);const h=b(JSON.stringify({alg:'HS256',typ:'JWT'}));const p=b(JSON.stringify({iat:n,exp:n+7200,sub:'ui-owner',owner:'Test',email:'ui@test.dk'}));console.log(h+'.'+p+'.'+b(c.createHmac('sha256','dk2-test-secret').update(h+'.'+p).digest()))"
```

### Pièges du harnais

- **Le JWT expire au bout de 2 h** → écran « Authentification requise ». En refaire un.
- **`dk_last_pub` pointant une publication effacée** → pad vide sans erreur. Purger
  la clé (déjà dans le gabarit ci-dessus).
- **Cache de modules** : `desk.js` importe `./ghostwriter.js` **sans** cache-buster.
  Une modif de Ghost Writer peut rester invisible → `fetch(f,{cache:'reload'})` sur
  chaque fichier puis recharger.
- **Charger `style.css`** : sans lui le mode clair ne bascule pas (les variables
  `--text`/`--navy2` y vivent) — un test de contraste donnerait un faux négatif.

---

## 7. Déployer

Front et worker sont **séparés**.

```bash
npm run bump-sw -- --suffix=<mot-clef>
```

Puis `git push origin main` (Vercel déploie tout seul). Worker, **seulement s'il a
changé** :

```bash
cd workers && npx wrangler deploy
```

**Ordre : worker d'abord, front ensuite** quand le front appelle une route neuve.

Vérifier la propagation avec **trois sondes espacées** (un nœud CDN peut servir
l'ancienne version) :

```bash
curl -s -4 https://protein-keystone.com/sw.js | grep -m1 -o "ks-os-v[0-9.]*-[a-z-]*"
```

⚠ **Ne jamais dire « rechargez, voire deux fois »** : le service worker sert les
assets en cache-first. Le seul déclencheur est le **clic sur le bandeau « Nouvelle
version — Actualiser »**.

⚠ Toute modif de `app/desk.css` exige de bumper `?v=` dans `app.html`.

---

## 8. Ce qui reste ouvert, hors sprints

- Sept pièces en prod pointant des articles supprimés (résidus des tests du 4 août).
  Sans gravité, la purge les emportera.
- Trois articles réels de L'Épaulette au marbre, sans page.

Rien d'autre : au 2026-08-05, **aucun banc rouge dans le dépôt**.
