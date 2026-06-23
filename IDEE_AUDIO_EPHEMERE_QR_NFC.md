# 💣 Idée — Audio éphémère par QR / NFC

> **Statut :** idée en discussion (2026-06-24). **PAS DE CODE** — document de cadrage à challenger.
> Brique candidate pour le rayon **« Expériences »** de Smart Dynamic QR (pad `A-COM-001`).
> Issu d'un brainstorm franc avec Stéphane (les garde-fous honnêtes sont volontairement conservés).

---

## Pitch en une phrase
Un **QR** — ou mieux, une **puce NFC cachée** — qui déclenche un **message audio** (MP3 ou voix enregistrée) à **accès éphémère programmable** : N écoutes, fenêtre de temps, ou autodestruction « Mission Impossible ».

## Le principe
Enregistrer / déposer un audio → hébergé chez Keystone → une page (ou un tap NFC) le lit → un **compteur d'accès** décrémente à chaque écoute → quand il est épuisé (ou la date passée), **le lien meurt** et le fichier peut être supprimé. C'est une nouvelle **Expérience hébergée**, pas un type natif.

---

## ⚠️ La vérité à assumer : accès éphémère ≠ contenu éphémère
La disparition est **garantie côté serveur** (le lien arrête de servir, on supprime le fichier). **Mais** à la première écoute, le son sort des haut-parleurs : on peut le filmer, le ré-enregistrer, il transite par le cache. On garantit donc qu'**on ne peut plus y accéder par ce lien**, jamais que « le message a disparu ».

**Conséquence :** ne JAMAIS le vendre comme **« sécurisé / confidentiel »** → on surpromet et le premier malin casse la promesse. Le vendre comme **éphémère / unique / précieux / ludique**. L'alerte capture façon Snapchat (« quelqu'un l'a écouté ») transforme cette faiblesse en **accusé de réception** honnête.

---

## Deux mécaniques — à NE PAS confondre
- **(A) Autodestruction par personne** (« 3 écoutes puis c'est mort pour toi ») — *Mission Impossible*.
  Native pour **fiction / jeu / message intime**. **Punitive** pour tout ce qu'on achète ou chérit (vécu comme du DRM).
- **(B) Rareté / exclusivité** (« limité aux 300 premiers », « dispo 30 jours », « seulement via cet objet »).
  Mécanique de **collection** : crée l'urgence et le « précieux » **sans punir** celui qui reçoit. Bon pour **musique / artiste / cadeau**.
- **Couche « à la Snapchat » :** elle ne reproduit PAS le produit Snap (instantané + carnet d'amis + push, que le QR n'a pas). Elle apporte **l'attente** (l'éphémère devient normal, désirable, pas une privation) **+ l'accusé de lecture**. → On prend **l'esprit** Snap, pas la boucle.

---

## Les usages (rangés par solidité)
1. 🕵️ **Livre illustré d'espionnage — LE point d'entrée.** Briefings audio qui s'autodétruisent, déclenchés par une NFC cachée. Ici l'autodestruction est **native au genre** (« ce message s'autodétruira… ») → le théâtre EST le produit. Audio **à soi** (zéro souci de droits). → mécanique **(A)**.
2. 🎵 **Musique / artiste.** Bonus du vinyle, démo « découverte » sur la carte d'un groupe, « limité (précieux) ». → mécanique **(B)** et surtout **pas (A)** (le self-destruct punirait le fan qui a payé). Public **déjà chez nous** via Key Form (artistes : bio + œuvres).
3. 🎁 **Cadeau / souvenir.** Message vocal qu'on n'entend qu'une fois (carte, faire-part, mémoriel). La rareté = l'émotion. → **(A)** ou **(B)** selon « il garde ou pas ».

---

## QR vs NFC
**La NFC est meilleure que le QR pour le livre :**
- **Invisible** → planquée sous la couverture / dans la reliure / derrière une illustration. Préserve l'art (un QR = carré moche) et le secret est littéralement caché.
- **Tap = magie** → pas de caméra ni de scan ; on pose, ça s'éveille. Fait « gadget d'espion ».
- **Premium / collector** pour une édition spéciale.

**Bémols honnêtes :**
- **iPhone pas 100 % fiable** en NFC (réglages, vieux modèles, Android variable) → **toujours doubler d'un petit QR de repli**.
- **Coût + logistique** : ~0,10–0,50 € la puce, à **encoder et coller** dans chaque exemplaire. Nickel en **édition spéciale / petit tirage**, ça compte en grand tirage.
- **Côté Keystone, ça ne change RIEN :** la puce ne porte que `protein-keystone.com/r/<short_id>`. Tout le moteur (audio, compteur, stats, re-pointage) est **identique** à un QR. NFC = la **sonnette**, la maison existe déjà. Le lien étant **dynamique**, une puce « grillée » peut plus tard re-pointer vers « mission expirée » / le chapitre suivant **sans retoucher le livre**.

---

## Faisabilité (réutilise tout l'existant — aucune techno nouvelle)
- **Stockage audio :** R2 (déjà utilisé pour les cartes du Smart Agent).
- **Compteur / expiration :** D1 (même logique que les rate-limits existants).
- **Lecture au scan :** dispatcher `/r/:shortId` + moteur de **pages hébergées** (smart-templates) déjà en place.
- **Enregistrement voix :** savoir-faire **déjà résolu dans Keynapse** (galère iOS `audio/mp4`, micro, FR).
- **Re-pointage dynamique :** un objet (QR/NFC) imprimé pointe pour toujours, mais la destination est pilotable serveur.
- **Coût :** **zéro IA** (record → stocke → lit) → **zéro coût récurrent** → colle à la logique « inclus / flat ». (Une transcription un jour = métré IA, à garder hors v1.)
- **Niveau d'effort :** une nouvelle « Expérience », quelques jours.

---

## Décisions de design ouvertes (à trancher avant tout build)
- **Stream-only éphémère** (vit l'instant, rien à garder) **VS claim-and-keep** (le destinataire repart avec le son) → **LA** décision, elle change tout le reste. Snap pousse vers « l'instant », la musique vers « il garde ».
- **Compteur visible + confirmation** avant de consommer (« Écouter ? il reste 2 lectures ») → éviter de cramer une écoute par mégarde.
- **Compte (N) et/ou durée (expire à date)** → rendre programmable.
- **« Usage unique » sur un QR partagé = ambigu** : unique par appareil ? global ? réservé au 1-à-1 ? → définir.
- **Audio servi en `no-store`** (sinon il revient du cache après « destruction »).
- **NFC → toujours un QR de repli** discret.

---

## Risques & garde-fous honnêtes
- **Positionnement :** jamais « sécurisé / confidentiel ». Éphémère émotionnel ou ludique, point.
- **Droits / DMCA :** héberger la musique d'AUTRUI = exposition copyright. Son propre audio (livre) = pas de souci.
- **Modération à l'échelle :** audio anonyme hébergé sous notre domaine = surface d'abus. L'autodestruction limite l'exposition mais complique la preuve. En beta / utilisateurs connus, risque faible.
- **« Ça anime mon livre » ≠ « le marché en veut » :** le livre **dérisque le build** et prouve le *cool*, il ne prouve pas la demande large. → **démo phare, pas pilier.**
- **Soupe de features :** 3 mécaniques en tête (auto-destruct / rareté / Snap) → choisir **UN** angle primaire ; les autres deviennent des **modes** si c'est cheap.
- **Ne pas devenir une boîte de « livres-NFC » :** ça reste **une Expérience de plus + une vitrine**. Produit Keystone **QR-first** (universel), NFC en **option avancée**, backend commun.

---

## Positionnement (résumé)
Différenciateur-**charme** « qui se raconte » pour le rayon **Expériences**, + un angle **artiste** cohérent avec Key Form. **Deux maisons** pour l'éphémère :
- **Fiction / jeu / espionnage → autodestruction** (native, théâtrale) ;
- **Musique / artiste → rareté** (précieux, on garde).

Même plomberie, deux skins, deux publics. La couche Snap rend l'éphémère **désirable + honnête** (accusé de lecture).

## ▶ Point d'entrée recommandé
Le **livre d'espionnage** : usage natif, audio à soi (zéro droits), **démo tangible** qui prouve la brique avant de l'ouvrir à d'autres auteurs / éditeurs / marques. On forge la nouveauté sur un projet réel plutôt que de spéculer sur une demande.

---

*Liens : Smart Dynamic QR (`A-COM-001`, rayon Expériences), Key Form (base artistes en prod), Keynapse (savoir-faire enregistrement voix iOS). — Doc de discussion, non engageant, non codé.*
