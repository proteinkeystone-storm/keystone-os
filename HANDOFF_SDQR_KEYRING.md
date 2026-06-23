# HANDOFF — Key-Ring : sonnette / interphone par QR (dans les options du pad SDQR)

> À COLLER au début d'une nouvelle conversation Claude Code dans ce projet.
> Concept complet + raisons + garde-fous : `IDEE_SONNETTE_INTERPHONE_QR.md` (à lire d'abord).
> Méthode imposée : banc d'essai d'abord, **me MONTRER avant de déployer**, ne jamais casser les QR prod.

## CONTEXTE
KEYSTONE_OS — PWA (front `app/*.js`, déployée par Vercel sur **protein-keystone.com** au `git push origin main`)
+ worker Cloudflare (`workers/`, `cd workers && npx wrangler deploy`). Le pad **Smart Dynamic QR**
(`app/sdqr.js`, renderer `app/sdqr-render.js`, types `app/sdqr-types.js`) a des **pages hébergées**
servies au scan via le dispatcher `/r/:shortId` : un **template worker**
`workers/src/routes/smart-templates/<id>.js` (`renderHTML(qrData, scanCtx)`) + un **pendant frontend**
`app/sdqr-templates/<id>.js` (champs/validate). Modèle de référence à copier : **carte-visite**.

## CE QU'ON CONSTRUIT
**Key-Ring** = une **sonnette / interphone passive** : un **QR** posé sur un portail / une porte / un accueil
(zéro courant, zéro câble — c'est le téléphone du visiteur qui fournit pile + réseau + intelligence).
Au scan, le visiteur obtient une **page « interphone »** qui lui permet de :
- **contacter directement** l'occupant depuis SON tel (il paie, c'est dans son forfait, c'est fiable) :
  **Appeler / SMS pré-rempli / WhatsApp / Email** — via les **encodeurs déjà présents** dans `app/sdqr-types.js` ;
- **« Sonner discrètement »** → **Web Push** vers l'occupant (réutilise l'infra Keynapse : VAPID, `kn_push_subs`, cron) ;
- voir la **réponse** de l'occupant (« J'arrive / 5 min / C'est ouvert / Pas dispo ») = **boucle retour**.

**Emplacement :** dans les **options du pad SDQR**, comme un type hébergé (carte-visite). Famille proposée :
**Contact** ou **Pratique** (à trancher avec Stéphane). `template_id` proposé : `key-ring`.

**Cas réel de dogfood :** le **portail en forêt de Stéphane** (réseau présent, courant absent).

## LES ORDRES (dans l'ordre)

### ORDRE 1 — Structure + logique (page visiteur), skin NEUTRE [worker + front, build/vérif LOCALE, PAS de deploy]
- Nouveau template worker `workers/src/routes/smart-templates/key-ring.js` (`renderHTML`) = la page visiteur :
  **plaque-nom** (nom du lieu) + **bouton principal** + boutons **Appeler / SMS / WhatsApp / Email** composés
  depuis les encodeurs existants + une **zone de statut**. **Skin sobre neutre** (PAS le design final) mais propre.
- Pendant frontend `app/sdqr-templates/key-ring.js` : champs (nom du lieu, numéro, contacts à afficher,
  texte SMS pré-rempli) + validate. Enregistrer dans les DEUX index (worker + front), câbler sous la famille.
- **Vérif au banc** `_design-lab/sdqr/` (vrai `renderHTML`, comme `hosted-render-check.html`) + `node --check`.
  Données **fictives** (cf `no-real-data-in-examples`). **AUCUN deploy prod ce soir.**
- ⚠ `renderHTML` est PUR (aucun push ici) → page terminale, flag `noDestination:true` (comme carte-visite,
  `target_url` neutre auto-posé). N'introduit AUCUNE écriture D1, AUCUN `/r/` modifié.

### ORDRE 2 — Skin « interphone premium » [reproduire le design fourni par Stéphane]
- Stéphane fournit une **réf design** (interphone moderne et sobre : plaque-nom, gros bouton d'appel,
  états animés `Au repos → Sonnerie… → Reçu ✓ → Réponse`, lisible dehors jour/nuit, cibles tactiles larges).
- **Reproduire au pixel** sur la MÊME structure qu'ORDRE 1 (on ne change que CSS/layout) — méthode anti-agacement :
  banc local, comparer soi-même, **MONTRER avant de déployer**, déployer après le « c'est ça ».

### ORDRE 3 — « Sonner » (Web Push) + boucle retour + destinataires [worker logic, test sur tel réel]
- Au scan/au tap « Sonner » : fan-out **Web Push** vers les appareils abonnés de l'occupant
  (réutiliser `workers/.../webpush.js` + table type `kn_push_subs` ; la montre suit le tel gratuitement).
- **Abonnement appareils** côté occupant (« Recevoir les alertes ici » sur tel + ordi).
- **Boucle retour** : l'occupant répond depuis la notif → la page visiteur l'affiche (statut + polling).
- **Multi-destinataires** + **multi-canal** (push primaire + **email de repli**, push iPhone = fragile).
- **Anti-spam** : rate-limit (pattern du Smart Agent public `sa_public_usage`) + cooldown + champ **nom/motif**.
- Tables D1 = `ADD COLUMN`/`CREATE TABLE` seulement, zéro destructif. Tester sur le tel de Stéphane.

### ORDRE 4 — (option, plus tard) Message **photo / vidéo court asynchrone**
- « Visuel sans live » : le visiteur dépose une photo/vidéo courte qui arrive en asynchrone (réutilise R2,
  patron de l'idée « audio éphémère »). Tolère un réseau faible, pas besoin que l'occupant soit dispo.

## CONTRAINTES PERMANENTES (tous les ordres)
- **Reproduire les références au pixel**, **banc d'essai d'abord**, **MONTRER avant de déployer**, déployer
  qu'après le « c'est ça » de Stéphane.
- **Ne jamais casser les QR prod** : `short_id` imprimé résout pour toujours ; `/r/`, `qr_redirects`,
  `qr_scans` intouchés ; **additif** (champs optionnels + défauts). Migrations D1 = `ADD COLUMN`/`CREATE TABLE`,
  zéro `DROP`/`ALTER` destructif.
- **Worker prod-critique** : avant `wrangler deploy` → **stash WIP Pulsa** + **autorisation explicite** de Stéphane ;
  **gardien `python3 scripts/qr_prod_guard.py verify _backups/qr-baseline.json` VERT AVANT & APRÈS** chaque deploy.
  Front = **bump SW** (`npm run bump-sw -- --suffix=…`) + `git push origin main` (Vercel auto).
- **`git add` EXPLICITE** (jamais `-A`, jamais le WIP Pulsa / Key Form). Commits **ASCII** finissant par
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Unicode 0/0**, `npm test` (templates) vert, **indigo** sans toucher **Key Form** (jamais de `replace_all`
  global sur un hex partagé).
- **Exemples sans données réelles** : placeholders fictifs (« Prénom Nom », « 06 00 00 00 00 », « vous@exemple.fr »,
  « https://votre-site.fr ») — cf `no-real-data-in-examples`.

## GARDE-FOUS SPÉCIFIQUES KEY-RING (cf l'idée pour le détail)
- **« Confort, pas sécurité ».** Jamais positionné urgence/secours (ça peut échouer) — l'écrire noir sur blanc.
- **QR > NFC ici** (une sonnette doit être VUE, scannée de loin, tenir dehors). Plaque étanche/anti-UV.
- **Numéro exposé** = OK en **privé** (portail) ; en **public/commercial** → numéro masqué (coûte) ou **push-only**.
- **Push iPhone fragile** (throttle) → multi-canal (push + email). Le **récepteur** a aussi besoin de réseau.
- **Visio : pas en v1** (pas d'URI universelle ; WhatsApp si besoin de live ; sinon photo/vidéo async = ORDRE 4).

## POINTEURS
- Modèle à copier : `workers/src/routes/smart-templates/carte-visite.js` + `app/sdqr-templates/carte-visite.js`.
- Encodeurs contact : `app/sdqr-types.js` (`tel`/`sms`/`whatsapp`/`email`, déjà faits).
- Web Push : `workers/src/routes/webpush.js` (ou équivalent Keynapse) + table `kn_push_subs` + cron.
- Dispatcher / invariant prod : `workers/src/routes/qr.js` (`/r/:shortId`) — NE PAS toucher le chemin URL→302.
- Bancs : `_design-lab/sdqr/` (réutiliser `hosted-render-check.html` + runner `run-scan.mjs`).
- Tests : `scripts/test-templates.mjs` (`npm run test:templates`).

## ORDRE À COLLER (nouvelle conversation)
> « Lis `HANDOFF_SDQR_KEYRING.md` et `IDEE_SONNETTE_INTERPHONE_QR.md`. On construit **Key-Ring** (sonnette/
> interphone par QR) dans les options du pad SDQR, sur le modèle carte-visite. **Commence par l'ORDRE 1** :
> le template worker `key-ring` + son pendant frontend = la page visiteur (plaque-nom + boutons Appeler/SMS/
> WhatsApp/Email via les encodeurs existants + zone de statut), **skin sobre neutre** (le design interphone
> viendra après, je le fournis). **Vérifie au banc** (vrai renderHTML) + node --check, données fictives, et
> **NE DÉPLOIE PAS** : montre-moi d'abord. Respecte les contraintes permanentes : ne jamais casser les QR prod,
> worker = stash WIP Pulsa + mon autorisation explicite + gardien avant/après, git add explicite, commits ASCII,
> Unicode 0/0, npm test vert, indigo sans toucher Key Form, exemples sans données réelles, bump SW + push main
> pour le front. ORDRE 2 = skin interphone (je fournis la réf, reproduire au pixel). ORDRE 3 = Sonner (Web Push)
> + boucle retour + destinataires, à tester sur mon tel. »
