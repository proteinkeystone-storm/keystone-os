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
| Front en prod | `ks-os-v5.28.484-desk-confirm-vue`, `app/desk.css?v=18` |
| Worker en prod | dernier commit le touchant : `7784178` |
| Bancs desK | **8/8 verts** (DK-2 48, DK-3 30, DK-4 33, DK-4b 22, DK-4c 54, DK-5 19, casier 20, signal 6) |
| `npm test` | 1 échec **antérieur et sans rapport** : `test-auto-reload-sweep.mjs` → « plafond → cap_reached » (session séparée) |
| Front desK | `app/desk.js` **3 203 lignes**, `app/desk.css` 855 — **zéro test** |
| Membres du pad | **1** (Stéphane). La rédactrice n'a aucun accès. |

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

### DK-7 · Le filet du front — **bloquant, à faire en premier**

**Ferme :** 3 203 lignes sans un test ; des bancs verts pendant que l'app était cassée.

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
C'est le seul critère qui compte.

**Fichiers :** `app/desk.js`, `app/ghostwriter.js` (lecture) ; nouveau
`scripts/test-desk-ui.mjs` ; `package.json` (chaîne `npm test`).

**Piège connu :** en préversion, le navigateur ressert les modules depuis son cache
— `desk.js` importe `./ghostwriter.js` sans cache-buster, donc une modif de
Ghost Writer peut rester invisible. Forcer `fetch(url, {cache:'reload'})` puis
recharger, ou importer avec un suffixe `?t=Date.now()`.

---

### DK-8 · La porte d'entrée increvable — **bloquant**

**Ferme :** une vague d'indésirables refoule les vrais contributeurs ; `From` reste
falsifiable alors qu'on s'apprête à publier l'adresse à tous les contributeurs.

Worker seul (`workers/src/routes/desk-email.js`). Trois choses :

**a) Un plafond par expéditeur.** Aujourd'hui il n'y a rien entre « un mail » et
`MAX_INBOX_PENDING = 200`.

**b) Le bac plein ne doit plus jamais refuser une contribution.** Aujourd'hui :
`if (pending >= MAX_INBOX_PENDING) return { ok:false, reason:'bac plein' }` →
`message.setReject('Dépôt refusé')`. L'auteur reçoit un échec SMTP, la rédaction ne
sait rien. Il faut **mettre de côté, jamais refouler**.

**c) Lire SPF/DKIM.** Cloudflare Email Routing fournit `Authentication-Results` au
handler `email()`. Un message qui échoue à l'authentification ne doit **jamais**
déclencher le rattachement automatique (`mode: 'auto'`) — il va au bac, avec la
mention visible. Ça referme le trou là où il a des conséquences, sans rien changer
pour les envois légitimes.

> Contexte : l'audit de juillet 2026 avait acté que la digestion fait confiance au
> champ `From`, falsifiable, en jugeant le risque acceptable **parce que la
> rédactrice transférait**. Le modèle a changé le 4 août (envoi direct des
> contributeurs, encouragé). L'arbitrage n'a pas été réévalué. C'est le sujet de ce
> sprint.

**Fini quand :** un banc prouve (1) qu'une avalanche de 300 messages ne fait pas
refuser le 301ᵉ contributeur légitime, (2) qu'un message échouant à SPF ne se pose
jamais tout seul sur une page.

---

### DK-9 · La relecture tenue à sa promesse — **petit, avant que la rédactrice ne la voie**

**Ferme :** le modal affiche « Les mots de l'auteur sont préservés » et personne ne
l'a vérifié.

La tuyauterie est prouvée (la commande part avec `action: improve`,
`lengthTarget: keep`, `variants: 1` ; la réponse se lit ; le texte se réécrit).
**Ce qui n'est pas prouvé, c'est que Mistral préserve effectivement les tournures.**

Passer **trois vrais textes de contributeurs** à la relecture et comparer — l'outil
de comparaison mot à mot est déjà dans le modal. Mesurer ce qui est réellement
touché.

Deux issues acceptables : soit le modèle préserve et la promesse tient ; soit il
réécrit, et on resserre la consigne système (`workers/src/routes/ghostwriter.js`,
branche `solo`) **ou** on change le libellé du modal. Ce qui n'est pas acceptable,
c'est de laisser la promesse non vérifiée sur le papier de quelqu'un d'autre.

**Fini quand :** le libellé du modal correspond à ce que le modèle fait vraiment.

**Il faut de Stéphane :** trois textes réels.

---

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
for t in dk3 dk5-board dk4 dk2 artcasier newsignal dk4b-transfert dk4c-bannette; do node test/test-desk-$t.mjs; done
```

**Attendu :** DK-2 48, DK-3 30, DK-4 33, DK-4b 22, DK-4c 54, DK-5 19, casier 20,
signal 6 — **zéro échec**.

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

- `test-auto-reload-sweep.mjs` → « plafond → cap_reached ». **Antérieur**, sans
  rapport avec desK (packs de recharge). Session séparée.
- Sept pièces en prod pointant des articles supprimés (résidus des tests du 4 août).
  Sans gravité, la purge les emportera.
- Trois articles réels de L'Épaulette au marbre, sans page.
