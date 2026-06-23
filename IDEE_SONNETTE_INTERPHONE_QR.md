# 🔔 Idée — Sonnette / interphone par QR (sans courant)

> **Statut :** idée en discussion (2026-06-24). **PAS DE CODE** — document de cadrage à challenger.
> Brique candidate pour Smart Dynamic QR (pad `A-COM-001`) — registre **utilitaire** (≠ QR marketing).
> Issu d'un brainstorm franc avec Stéphane (garde-fous honnêtes conservés volontairement).

---

## Pitch en une phrase
Un **QR passif** (zéro électronique, zéro courant) posé sur un portail / une porte / un accueil, qui ouvre sur le téléphone du visiteur une **page « interphone »** lui permettant de **sonner** ou de **contacter directement** l'occupant — là où il y a du **réseau mais pas d'électricité**.

## Le principe (l'élégance)
La sonnette n'a **aucune électronique** : c'est le **téléphone du visiteur** qui fournit la **pile**, le **réseau** et l'**intelligence**. Le portail ne porte qu'un bout de code imprimé → **rien à alimenter, rien à câbler, rien à entretenir** sur place. Le cas d'école : **un portail au fond d'une forêt**, impossible à câbler, mais couvert par le réseau mobile.

---

## 🔑 Le déclic : inverser le sens (fiabilité + gratuité)
Le point faible d'une sonnette « le serveur te notifie » = la **fragilité du push** (surtout iPhone qui *throttle* en arrière-plan). La bonne réponse : **c'est le visiteur qui initie le contact depuis SON téléphone.**

- **Appel / SMS lancés par le visiteur = le canal le plus fiable qui existe** (ton tel sonne vraiment, aucune PWA à installer, aucun throttling).
- **C'est le visiteur qui paie**, depuis **son forfait** (appels/SMS illimités dans quasi tous les forfaits) → **zéro coût** pour les deux, **zéro SMS serveur** à gérer.

⚠️ Ce n'est **pas** une contradiction avec « pas de SMS ni d'appel » : ce qui était écarté, c'est le **SMS automatique envoyé par le serveur** (coût, gestion). Ici c'est un **appel/SMS manuel** du visiteur. L'inverse exact, et c'est mieux.

---

## L'interface (les deux sens combinés)
Une seule page, qui propose au visiteur :
1. **Contact direct** (visiteur paie, fiable) : **📞 Appeler · 💬 SMS pré-rempli** (« Je suis au portail ») **· WhatsApp · ✉️ Email**.
2. **« Sonner discrètement »** : déclenche un **Web Push** vers l'occupant (sonnerie passive, gratuite, souveraine) — pour qui veut **juste annoncer** sa présence sans téléphoner.
3. **Boucle retour** : depuis la notif, l'occupant répond en 1 tap **« J'arrive / 5 min / C'est ouvert, entrez / Pas dispo »** → la page du visiteur **l'affiche**. C'est ce qui en fait une **vraie sonnette** (« j'ai sonné → on m'a entendu → on vient »), pas un cri dans le vide.
4. *(option)* **Photo / court message vidéo asynchrone** : « visuel sans live » qui réutilise la brique éphémère de l'autre idée — tolère un réseau faible, pas besoin que l'occupant soit dispo.

---

## 🎛️ Design / direction visuelle : un interphone moderne et sobre
La page doit **ressembler à un interphone** premium (métaphore d'objet, pas un formulaire web). Direction (à réaliser côté Stéphane) :

- **Métaphore :** un **panneau d'interphone** vertical — plaque-nom en haut (identité du lieu / « [Nom] · Portail »), **gros bouton d'appel** central et évident (comme le bouton d'un interphone), actions secondaires en dessous, **zone de statut** qui s'anime.
- **Hiérarchie :** une **action primaire** dominante (Sonner / Appeler), le reste discret. On comprend en 1 seconde, sans lire.
- **Ton :** **sobre, premium**, graphite/ardoise + **un seul accent** (l'indigo Keystone, ou un vert « appel » façon téléphone pour le bouton principal). Verre/métal, coins doux, ombres légères. Pas de fioritures, pas de ludique : c'est un **objet utilitaire de confiance**.
- **États clairs et animés :** `Au repos` → `Sonnerie…` → `Reçu ✓ ([nom] a vu)` → `Réponse : « J'arrive, 5 min »`. Le visiteur ne doit **jamais** rester dans le flou.
- **Contraintes « scanné dehors » :** **lisible en plein soleil ET de nuit** (fort contraste, gros caractères, idéalement auto clair/sombre), **cibles tactiles larges** (froid, gants, hâte), texte minimal.
- **Cohérence :** peut s'inspirer du rendu « iPhone fidèle » déjà fait dans l'aperçu « Au scan » du SDQR (même soin premium).

---

## Comment ça marche (réutilise tout l'existant)
- **Déclencheur :** QR encode `protein-keystone.com/r/<short_id>` ; le dispatcher `/r/:shortId` **logge déjà le scan** (heure, appareil, pays — souverain/RGPD).
- **Contact direct :** les **encodeurs `tel:` / `sms:` / WhatsApp / email existent déjà** dans `app/sdqr-types.js` (types « rapides » du SDQR) → la page compose les boutons.
- **Sonnerie passive :** **Web Push déjà en place** (VAPID, construit pour Keynapse : `kn_push_subs`, cron). L'occupant **abonne ses appareils une fois** (« Recevoir les alertes ici » sur tel + ordi). **La montre suit gratuitement** (Apple Watch / Wear OS recopient la notif du tel — aucun app montre à coder).
- **Multi-destinataires :** plusieurs personnes peuvent s'abonner (toi + conjoint + gardien).
- **Coût :** **zéro récurrent** (le visiteur paie l'appel ; push/email gratuits ; pas de SMS serveur). Colle à « inclus / flat ».
- **Effort :** la plus **petite** des idées en v1 (composition de briques existantes + une page soignée).

## QR vs NFC : ici, **QR gagne**
Une sonnette doit être **VUE** (« scannez pour sonner »), se scanner **de loin / derrière une vitre / sur un portail**, et **tenir dehors**. La NFC veut un **tap précis** + iOS capricieux + elle se cache (l'inverse du besoin). → **QR pour être trouvé**, NFC pour être caché (≠ ce cas). Plaque **étanche, anti-UV, gravée ou plastifiée**.

---

## Cas d'usage
- 🌲 **Portail isolé (LE cas d'entrée)** : réseau présent, courant absent, le QR ne demande rien.
- 🏡 **Gîte / refuge / chambre d'hôtes** sans accueil permanent.
- 🔑 **Location off-grid** : « je suis arrivé », check-in.
- 🏪 **Accueil non gardé** d'un commerce / atelier d'artisan **sur RDV** / boutique de ferme.
- ♿ **Point d'appel** (assistance) là où câbler un interphone est une corvée.

---

## ⚠️ Garde-fous honnêtes
- **« Confort, pas sécurité ».** Ça peut échouer (réseau, tel éteint, push raté). **Jamais** pour de l'urgence/secours (responsabilité). À écrire noir sur blanc.
- **Le numéro est exposé** à qui scanne : OK pour un **portail privé** (le visiteur est déjà à ta porte) ; pour une sonnette **publique/commerciale**, non → **numéro dédié/masqué** (coûte) ou **push/formulaire seulement**.
- **Touriste en roaming** : l'appel peut lui être facturé (itinérance) ; gratuit pour un local.
- **Fiabilité réception :** appel = ultra-fiable mais suppose qu'on **décroche** ; push = fragile (iPhone) → **multi-canal** (push + email de repli ; option Telegram/ntfy pour livraison quasi-certaine, mais tiers = non souverain).
- **Visio : pas en v1.** Pas d'URI universelle ; FaceTime = Apple-only ; WhatsApp = chemin réaliste si les deux l'ont ; salle web (Jitsi/WebRTC) ré-impose le « live » **et** de la bande passante (la 4G d'un portail en forêt peut être trop faible). Préférer **WhatsApp** (live) ou **photo/vidéo asynchrone** (visuel sans live).
- **Anti-spam :** QR public = n'importe qui peut sonner → **rate-limit** (pattern du Smart Agent public) + cooldown + champ **nom/motif** avant d'envoyer (donne aussi du contexte).
- **Le récepteur a aussi besoin de réseau** (la maison doit capter / avoir du wifi).

---

## Décisions ouvertes
- Bouton **primaire = « Appeler » ou « Sonner (push) »** par défaut ? (selon privé/public).
- **Canaux** affichés et leur ordre (appel / SMS / WhatsApp / push / email) — configurable par l'occupant.
- **Boucle retour** dès la v1 ou en v2 ?
- **Plaque physique** : on la fournit (produit) ou l'utilisateur l'imprime ?

## Positionnement / verdict
Brique **utilitaire** qui change agréablement du QR marketing, **quasi-gratuite à bâtir** (tout l'infra existe), **zéro coût récurrent**. Le génie est dans **l'inversion du sens** (le visiteur contacte depuis son tel = fiable + gratuit) **+** la sonnerie passive **+** la boucle retour, le tout sous une **peau d'interphone soignée**. Garde-fou cardinal : **confort, jamais sécurité.**

## ▶ Point d'entrée recommandé
**Le portail en forêt de Stéphane** : cas natif, contrainte réelle (réseau oui, courant non), et **dogfood** parfait pour prouver la brique avant d'en faire un produit (gîtes, locations, accueils non gardés).

---

*Liens : Smart Dynamic QR (`A-COM-001`), encodeurs tel/sms/whatsapp/email (`app/sdqr-types.js`), Web Push (savoir-faire Keynapse), idée sœur « audio éphémère » (photo/vidéo async). — Doc de discussion, non codé.*
