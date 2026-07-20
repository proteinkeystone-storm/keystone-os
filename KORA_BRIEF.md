# KORA — BRIEF DE CONCEPTION (Agent-OS Keystone)

> **Statut :** cadrage validé · **design de la surface VALIDÉ le 16/07/2026** (harnais livrés, cf. §3) · **EN PROD depuis le 17-20/07/2026** : boucle conversationnelle complète, 7 pads couverts (Brainstorming, Ghost Writer, Social Manager, Smart Dynamic QR, Sentinel, Keynapse, Smart Agent) + pilote de chaîne + os, **40 actions**, routage 2 étages actif, flag dogfood durable (`?kora=1`). Doc autoporté.
> **Frontières du périmètre :** tranchées le 19/07/2026, cf. **§15**. · **Mode vocal :** conception séparée = `KORA_VOCAL_BRIEF.md`. · **Protocole de fiabilité (K-7) :** `KORA_FIABILITE_PROTOCOLE.md`.
> **Nature :** Kora est l'**agent conversationnel qui pilote tout Keystone OS** à la voix ou à l'écrit.
> **Distinct de** [[smart-agent-kortex|Smart Agent]] (jumeau de savoir-faire, pad O-AGT-001). Kora **conduit l'OS** ; Smart Agent **incarne un savoir métier**. Ne pas confondre, ne pas fusionner.

---

## 0. La phrase qui résume tout

> Un **galet vivant** dans la barre du haut de l'OS. On le maintient, on lui parle, on le relâche : elle **agit dans le pad où l'on se trouve**, sous nos yeux — elle **entoure ce qu'elle touche**. Elle fait tout **sauf détruire et sauf trancher** — comme un excellent assistant junior.

L'objectif produit : l'**effet waou** = *« je parle, ça se fait, je vois ça se faire »*. Sans notice, sans réglage préalable, identique sur desktop et mobile.

---

## 1. PRINCIPE N°1 — UI SIMPLE À COMPRENDRE ET À UTILISER (priorité absolue)

Tout le reste du brief se plie à cette règle. Un client doit tout comprendre **sans qu'on lui explique**.

1. **Un seul endroit pour parler à l'IA.** Une **unique** surface Kora, globale, toujours au même endroit (en bas). Pas une barre par pad. On l'apprend **une fois**, elle marche partout.
2. **Le galet est le seul contrôle.** **Tap** = ouvrir ; **maintien** = parler (geste vocal WhatsApp, déjà connu de tous). Aucun menu, aucune config pour démarrer.
3. **Zéro question inutile.** Le pad courant est la cible **par défaut** — Kora ne demande *jamais* « sur quel pad ? » quand c'est évident.
4. **Elle parle clair.** Kora annonce ce qu'elle fait en langage simple, au fil de l'eau (« je range tes 6 notes d'hier par thème… »).
5. **Elle propose, tu ne configures pas.** Les combos, les variantes → **des boutons proposés par Kora**, pas des cases à cocher à construire soi-même.
6. **Jamais plus de 1-2 choix à la fois.** Pas de mur d'options.
7. **Elle ne demande que le nécessaire.** Confirmation **uniquement** pour détruire / publier / trancher (cf. §5). Le reste : elle fonce.
8. **Même modèle mental partout.** Desktop et mobile = **exactement** la même logique (seule la mise en page change).

---

## 2. CE QU'EST UN AGENT (rappel de cadrage)

Un agent = **un LLM + un catalogue d'actions (« tools ») + une boucle**. On lui donne une liste d'actions autorisées ; il comprend la demande, choisit la bonne action, l'exécute, répond. **Le cœur du travail, c'est le catalogue d'actions**, pas « l'intelligence » du modèle.

Conséquence : **plus les actions sont bien conçues, plus le modèle peut être modeste.** Un catalogue petit et bien nommé (5-8 actions par pad) permet un **petit modèle** (Mistral Small/Mini) → sobre et rapide.

---

## 3. LA SURFACE — LE GALET · langage de présence à 3 étages

> **VALIDÉ le 16/07/2026** après prototypage complet. Les harnais font foi et
> portent les réglages définitifs — **ne pas re-designer, ne pas « améliorer »** :
> · `_design-lab/kora-galet-harness.html` — le galet seul, ses 5 modes, tous les réglages
> · `_design-lab/kora-galet-morph.html` — le système complet en contexte (topbar + pad + fenêtre)
>
> Familles écartées après essais, **ne pas y revenir** : orbe v1-v6, champ de flux,
> iridescent. `_design-lab/kora-orb.html` (sphère de verre, lames, plasma) reste en
> réserve pour un **éventuel mode vocal plein écran** — pas pour l'intégration.

Kora se manifeste sur **trois étages**, du silence à l'urgence. Chacun a un rôle, aucun ne déborde sur le suivant.

**Étage 1 — LE GALET (le témoin).** Une pastille dans la **barre du haut**, à côté des boutons existants.
- **Au repos**, c'est **un bouton comme les autres** (≈44×38, coins 9 px) : Kora ne prend aucune place, ne dit rien.
- **Dès qu'elle vit**, le galet **s'étend** (≈200 px) et **pousse naturellement ses voisins vers la gauche** — le geste « Dynamic Island ». Il porte alors les 5 modes (§8).
- **Largeur stable une fois étendu** : le langage passe par la **couleur**, l'**onde** interne et l'**arrondi des coins** (pill quand elle est ouverte/à l'écoute ↔ presque rectangulaire quand c'est tendu). La respiration et le « toc » modulent l'arrondi, **jamais la taille** : le header ne bouge pas.

**Étage 2 — LES ANNEAUX (l'action).** Quand Kora **touche** un élément (bloc, champ, bouton), cet élément reçoit un **anneau de 1 px** aux couleurs du mode courant, parcouru d'une comète lente. On ne se demande jamais où elle agit : **on le voit**.
> Inspiration assumée : le halo de Claude en computer-use. Ce n'est pas une déco, c'est de la **confiance par transparence**. Épaisseur = celle du liseré du galet (1 px) : un seul poids de trait dans tout le système.

**Étage 3 — LA FENÊTRE (le dialogue).** Sobre, elle se fait oublier — **c'est une app métier, pas un light-show** :
- **Desktop :** **Split 60/40** (*Modal Master* de la charte) — panneau Kora d'un côté, **le pad qui vit de l'autre**. On la **voit travailler**.
- **Mobile :** **feuille plein écran**. En fin d'action, elle **se rétracte et révèle le pad transformé**, nouveautés **surlignées** quelques secondes.
- Traitement : **liseré 1 px** discret, coins standard Keystone (14 px), fond sombre — **aucun effet**, sauf un **léger dégradé de la couleur d'état tout en bas** (même esprit que les pages publiques du Smart Agent). Apparition en fondu, pas de morphing spectaculaire (essayé, **rejeté** : ça détourne l'attention).

Puis retour au repos : la fenêtre se ferme, le galet **redevient un bouton**.

**Garde-fous perf (inchangés, décisifs) :** veille au repos (30 fps), `dpr ≤ 2`, pause si l'onglet est caché. **GATE fluidité iPhone AVANT tout câblage** — même méthode éprouvée que le « Keystone Tree » de [[network-pad|networK]].

---

## 4. PÉRIMÈTRE & SCOPING — « Kora n'agit que là où tu la mets »

**Le pad courant est l'ancre.** Kora est **scopée** au pad où l'on se trouve : elle ne charge que **ses** actions (petit contexte → petit modèle → coût bas → moins d'erreurs). C'est **aussi une frontière de sécurité** : elle ne peut pas déraper hors du pad autorisé.

Donner le périmètre = **ambiant**, jamais une question posée à chaque tour :
- **Auto-scopé (défaut)** : dans un pad → Kora est déjà branchée dessus.
- **Cibler à la volée** : petites **pastilles de pads** dans le panneau, ou taper un pad sur la grille.

> **Tranché le 17/07/2026 : le galet vit PARTOUT, dashboard compris.**
> Le garde-fou de contexte qui motivait le doute : depuis le dashboard, la
> décision ne recevra qu'un **sommaire d'une ligne par pad** (routage en
> 2 étages — le modèle choisit le pad, seule la 2ᵉ passe reçoit ses actions
> détaillées) + prompt caching. En V1 (15 lectures compactes ≈ 700 tokens),
> le catalogue entier passe tel quel, aucun étage nécessaire.

---

## 5. COMBOS — « le pad tend la main à ses voisins »

Tous les pads **ne se combinent pas**. Règle nette :

> **Deux pads sont combinables si la sortie de l'un peut nourrir l'entrée de l'autre.**

**La carte des combos existe déjà** = ce sont les **passerelles « Continuer avec… »** déjà codées (handoff [[content-chain-vision|Brainstorming→Ghost Writer→Social]], `prefillData`, `opts.nkContact`…).

Fonctionnement **depuis un pad** (jamais une grille flottante) :
- Kora part du pad courant (ancre) et **propose d'étendre** vers ses **voisins compatibles uniquement**.
- Exemple depuis Ghost Writer → `[Ghost Writer ✓] [+ Brainstorming] [+ Social]`.
- Depuis **Sentinel** (autonome, aucun voisin chaînable) → **aucun combo proposé.** Les combinaisons absurdes sont impossibles **par construction**.
- Idéalement : combos **nommés** (« Chaîne de contenu ») = un bouton, pas 3 cases.

Garde-fou coût : **défaut = 1 pad**. Multi-pad = geste délibéré. Au-delà de N pads → bascule possible sur un **modèle plus fort** (vraie coordination à faire).

---

## 6. ON VOIT KORA TRAVAILLER (le « vivant »)

Trois couches :
1. **Elle raconte** ce qu'elle fait, en **flux** (brique **streaming BYOK** déjà là).
2. **Elle montre OÙ** : l'élément qu'elle touche s'entoure d'un **anneau 1 px** aux couleurs de son mode (§3, étage 2) — le regard suit le travail sans le chercher.
3. **Le pad bouge** à mesure que chaque action se valide (notes qui se rangent, texte qui apparaît).

Contrainte de layout → impose le **côte-à-côte** desktop (d'où le 60/40). Mobile = narration + **révélation** du résultat.

Bonus : **voir = la confirmation.** Rien ne se passe hors de vue → l'agent devient **digne de confiance par transparence.** Arbitrage assumé : agir **une étape à la fois, visiblement** coûte un chouïa plus (1-2 allers-retours de plus) — c'est **le prix du waou**, tenu par le scoping.

---

## 7. LA LIGNE « FAIT TOUT SEUL / DEMANDE D'ABORD »

Comportement d'un **assistant junior** : il fait tout le travail ingrat, mais **ne jette jamais** ton travail et **ne décide jamais** à ta place.

**Deux choses — et deux seulement — que Kora ne s'autorise jamais seule :**
1. **Détruire** — effacer, écraser, vider, casser un élément existant.
2. **Trancher** — choisir *le* texte / *la* version qui « gagne ».

| Kora fait seule (vert) | Kora s'arrête et demande (rouge) |
|---|---|
| Créer, ajouter, ranger, regrouper, taguer | **Supprimer**, vider, déconnecter |
| Reformuler, résumer, **produire 3 variantes** | **Écraser** un contenu existant |
| Aller chercher / préparer un brouillon chez un voisin | **Choisir** la variante finale |
| Déplacer, réorganiser la grille | **Publier / envoyer** (Social, e-mail) |

**Nuance clé : produire des versions ≠ choisir la version.** Kora génère librement 3 accroches et les met en page ; **l'humain pointe celle qui part** (10 min de corvée pour elle, 1 s de goût pour toi).

**Corollaire « ne jamais écraser »** : « réécris mon intro » → elle **pose la nouvelle à côté** et propose de swapper. Par défaut elle **ajoute**, elle n'efface pas. L'original reste.

**Pourquoi c'est client-safe :** le seul scénario qui tue la confiance = un agent qui choisit tout seul le mauvais titre et le publie. En réservant *destruction* et *choix final* à l'humain → tout le gain de travail, **zéro** risque « il a envoyé n'importe quoi ».

---

## 8. LE GALET-TÉMOIN — l'animation EST un langage d'état

Le galet **change d'apparence selon l'état de Kora** (c'est ça, « vivant » ; pas un économiseur d'écran). **Cinq modes**, chacun avec sa **couleur** (psychologie assumée), sa **forme** et son **mouvement** — réglages définitifs gravés dans les harnais :

| État | Couleur | Forme / mouvement |
|---|---|---|
| **Repos** | bleu / violet — le calme, la nuit | galet posé, onde lente qui respire · au repos total : redevient un simple bouton |
| **Elle écoute** | **turquoise / vert** — réceptif, « je suis à toi » | coins **pill**, traits fins en filigrane **asservis à ta voix** (amplitude réelle) |
| **Elle réfléchit** | **violet / indigo / orchidée** — l'introspection | ondes longues qui se tissent, coins qui se tendent |
| **Elle travaille** | **magenta / cyan / vert** — toutes les couleurs = pleine capacité | onde vive, comète sur le pourtour, blanc aux seuls croisements |
| **Elle a besoin de toi** | **vermillon → corail → or** — urgence **chaleureuse** | coins **presque droits**, pulsation **lente et grave**, liseré doré au « toc » |

**Pourquoi pas le rouge pur pour « besoin de toi » :** il crie *erreur*. Le vermillon→or dit *« j'ai besoin de toi maintenant »* avec chaleur — et reste impossible à confondre avec les quatre autres, même en vision périphérique.

**Élégance centrale :** l'état « besoin de toi » = **exactement la ligne rouge du §7.** L'animation *est* le témoin de la frontière de confiance **et** de l'écoute. D'un coup d'œil : Kora bosse, ou Kora t'attend. Et l'**anneau** (§3, étage 2) pointe alors précisément **l'élément qui attend ta décision**.

**Leçons de design (payées cher, à respecter) :** graphique **net** > flou vaporeux · **un** langage décliné en dialectes > cinq langages différents · la **couleur EST l'état** · sobre > spectaculaire.

---

## 9. LA VOIX — talkie-walkie + streaming

**Cahier des charges né des reproches sur Smart Agent :** trop de **latence** quand ça parle ; obligation d'**appuyer à chaque fois**. Kora doit corriger les deux.

### 9.1 Latence → **voix en streaming (pipeline, pas série)**
Ne pas attendre tout le texte avant de parler. Dès la **première phrase** écrite, la faire dire pendant que la suite s'écrit. Latence perçue effondrée. **Brique déjà là** = streaming BYOK (même principe, appliqué à l'audio, découpe à la phrase).
*Arbitrage à trancher plus tard :* voix cloud (belle, « temps avant 1er son » plus long) vs voix navigateur (instantanée, robotique). Le streaming rend le cloud acceptable.

### 9.2 Le bouton → **maintien-pour-parler (talkie-walkie)**
> **Maintenir le galet → parler (il ondule en turquoise, on la voit entendre) → relâcher → Kora répond aussitôt.**

Geste **déjà connu de tous** (vocal WhatsApp/Telegram) → zéro apprentissage. **Supérieur au micro ouvert :**
- **Zéro déclenchement à tort** (micro ouvert seulement pendant le maintien).
- **Sobre** (on ne transcrit que ce qui est dit).
- **Privé** — micro **fermé par défaut** (argument de confiance client fort).
- **Tours de parole clairs.**
- **Interruption gratuite** : appuyer = « mon tour » **coupe Kora** (barge-in offert, plus besoin de le repousser).

Le galet **est** le bouton d'émission (tenir le galet = émettre). Compromis assumé : pas 100 % mains libres — sur mobile c'est un **atout** (contrôle, discrétion). **Mode mains libres** (micro ouvert + VAD) = **option ultérieure**, jamais le défaut.

**Recette voix V1 :** maintien-pour-parler + réponse streaming + galet-témoin d'écoute (mode Écoute asservi au micro).

> ⚠ **Tension à trancher (mobile) :** le galet est désormais **en haut** (barre), or le pouce atteint mal le haut d'un téléphone. Options : zone de maintien étendue, poignée basse en feuille mobile, ou tap-pour-ouvrir + micro dans la feuille. **À décider au moment du câblage mobile** (cf. §14).

---

## 10. SOBRIÉTÉ / MODÈLE DE COÛT

La peur « la facture explose » se gère, elle ne se subit pas. Un agent est **on-demand** (0 requête = 0 coût) — plus sobre par usage que [[living-layer|Living Layer]] (ambiant). Leviers :

1. **Scoping** — n'envoyer que les outils du pad courant (pas 40 défs à chaque message).
2. **Prompt caching** — prompt système + défs d'outils sont **statiques** → en cache, payés une fraction aux appels suivants. Levier le plus puissant.
3. **Tâches simples en V1** — éviter les longues chaînes qui bouclent.
4. **Historique plafonné / résumé.**
5. **Routing par niveaux** — petit modèle par défaut, montée en gamme seulement si nécessaire (multi-pad, coordination).

**Bouclier margine (déjà construit) :** [[byok-moteur-universel|BYOK]] + **métrage IA**.
- **Défaut — clé maison + quota** par plan (agent inclus/flat, mais métré ; au-delà : coupe/facture).
- **Soupape — le client apporte sa clé** (power users → **leur** facture, pas la tienne).

---

## 11. SÉCURITÉ & MULTI-TENANT (non négociable)

- Kora agit **toujours au nom du bon utilisateur**, **jamais** au-delà de son coffre.
- **Piège connu** (cf. [[living-layer]]) : tenant `admin → 'default'` (pas `claims.sub`), **sauf** Pulsa (`owner_sub`). L'identité passée à Kora doit respecter ce câblage.
- Le scoping au pad (§4) est **aussi** une barrière : Kora ne peut agir que dans le périmètre donné.
- Les actions rouges (§7) = **garde-fous d'effet de bord** (rien de destructif/public sans confirmation humaine).

---

## 12. CE QU'ON RÉUTILISE DÉJÀ (peu de neuf à inventer)

- **LLM + routing** : Smart Agent + [[byok-moteur-universel|BYOK]].
- **Backend** : Worker Cloudflare + endpoints existants (le catalogue d'actions = surtout « déclarer proprement ce qui existe »).
- **Streaming** : brique BYOK streaming (→ voix streaming §9.1).
- **Voix/STT** : Whisper (Keynapse), mode conversation (SA-13) — à faire évoluer vers le talkie-walkie.
- **Passerelles** : « Continuer avec… » = **la carte des combos** (§5).
- **Design** : *Modal Master* 60/40 (charte) = gabarit du panneau desktop.
- **Méthode animation** : harnais `_design-lab/` + GATE iPhone (façon networK).
- **Métrage IA** : quotas par plan.

---

## 13. PÉRIMÈTRE — V1 vs PLUS TARD

**V1 (viser petit et excellent, pas « tout »)**
- Surface 3 étages (§3) : galet header (repos = bouton → étendu = 5 modes) + anneaux 1 px + fenêtre sobre (60/40 desktop, plein écran mobile). **Design validé et prototypé — reste le gate iPhone AVANT câblage.**
- Scoping auto au pad courant.
- Catalogue d'actions sur **2-3 pads** bien choisis (démarrer par de la **lecture**, puis écriture).
- Ligne fait-seul / demande (§7) + confirmations rouges.
- **On voit Kora travailler** (§6).
- Voix **talkie-walkie + streaming** (§9).
- Galet-témoin, 5 modes (§8).
- Sobriété : scoping + cache + quota (§10).

**Plus tard**
- Combos multi-pad généralisés à tout l'écosystème.
- **Barge-in** raffiné / **mode mains libres** (option).
- Mémoire longue (Kora se souvient de toi d'une session à l'autre).
- MCP (piloter Keystone depuis un agent externe type Claude Desktop) — **le catalogue d'actions de la V1 le rend possible sans réécriture.**

---

## 14. DÉCISIONS — TRANCHÉES par Stéphane le 17/07/2026

> Plus aucune décision ouverte. Ces choix font autorité pour le code V1.

- **Persona / ton** : **complice, qui tutoie** — chaleureuse, phrases courtes, langage simple (« je relis ton brouillon… », le ton du scénario validé dans le harnais morph).
- **Voix** : **Piper/Siwis maison en streaming** (découpe à la phrase pendant que la suite s'écrit) — déjà en prod côté Smart Agent, souveraine, coût quasi nul. Pas de cloud premium, pas de speechSynthesis.
- **Pads V1** : **la chaîne de contenu** — Brainstorming + Ghost Writer + Social Manager (passerelles « Continuer avec… » déjà codées = la carte des combos existe).
- **Quota agent** : **crédits IA existants** — 1 crédit par tour Kora via `consumeCredits` (tool `kora`), quotas de plan en place, BYOK non compté ; en beta le flag `enforce_ai_credits_v1` dormant = on compte sans couper.
- **Mémoire** : **session seulement** (historique plafonné/résumé, rien de persistant). Mémoire longue = « Plus tard » (§13).
- **Geste vocal mobile** (§9.2) : **poignée basse dans la feuille** — tap sur le galet = ouvrir la feuille ; le maintien-pour-parler vit sur une poignée EN BAS, dans la zone du pouce. Le talkie-walkie survit tel quel.

---

## 15. FRONTIÈRES — Kora couvre / ne couvrira jamais (K-12, tranché le 19/07/2026)

> La carte fait autorité. Un pad n'entre pas au catalogue parce qu'il existe,
> mais parce qu'une **conversation réelle** avec lui a de la valeur. Le critère
> unique : **Kora vaut par les données qui vivent entre deux sessions** (scans,
> posts, rappels, audits, séances, relances). Pas de flux → pas d'actions.

### 15.1 Couvert (en prod — 40 actions)

| Pad | Actions | Note |
|---|---|---|
| Brainstorming (A-COM-003) | 5 | lectures + `bs.start_session` |
| Ghost Writer (A-COM-005) | 5 | lectures + `gw.rewrite_text` |
| Social Manager (O-SOC-001) | 7 | 6 lectures + `sm.compose_draft` — **publier = jamais** |
| Smart Dynamic QR (A-COM-001) | 6 | lectures + ouvrir/préparer |
| Sentinel (O-GEO-001) | 3 | lectures + `snt.run_audit` |
| Keynapse (O-Keyn-001) | 5 | lectures + ouvrir/annoter |
| Smart Agent (O-AGT-001) | 4 | 4 lectures, MAX only — jumeaux, trous de savoir, coffre, usage public |
| Chaîne de contenu | 4 | pilote complet, 2 arrêts rouges (idée, publier) |
| OS | 1 | `os.open_pad` |

### 15.2 Entrera (plan de fin de chantier gravé, K-9 → K-13)

- **desK (O-DSK-001)** — K-9, ~5 actions dont relances : le chemin de fer vit (marbre, bouclage, contributeurs en retard) — matière conversationnelle évidente.
- **booK (O-BOK-001) + Key Brand (O-BRD-001)** — K-10, lectures simples : bibliothèques (éditions, chartes) qu'on interroge, rien à écrire.
- **Key Form (A-COM-004 / Pulsa)** — K-11, **2 lectures, ZÉRO écriture, jamais** : formulaire artistes en prod critique — Kora peut dire « 3 réponses hier », elle ne touchera jamais au flux.
- **Living Layer** — K-13 : pas un pad, la surface ambiante ; « quoi de neuf ? » = synthèse des signaux (⚠ piège tenant `admin→'default'` sauf Pulsa `owner_sub`).
- **networK (O-NET-001)** — entrera **quand le pad existera en prod** (conception validée = `NETWORK_BRIEF.md`, code non commencé). Un réseau relationnel vivant est un candidat naturel (relances, « qui recontacter ») — mais on ne câble pas un pad fantôme.

### 15.3 Ne couvrira jamais

- **Missive / Sceau (O-SEC-001)** — **exclu par design, définitif.** Un secret usage-unique scellé E2E+OPRF n'a **rien à lire** : le serveur est aveugle, le contenu n'existe qu'à l'instant du descellement chez le destinataire. Une Kora capable de lire un Sceau serait la preuve que le produit est cassé. Aucune action, pas même un compteur ; au mieux l'alias d'ouverture dans `os.open_pad`.
- **Brief Prod (A-COM-002 / Kodex)** — **exclusion assumée** (tranché ce jour, instruit sur pièces) : le pad ne persiste qu'**un** brouillon de travail lean (`LS_DRAFT_KEY`, `app/codex.js:161`) et rien d'autre ne vit entre deux sessions — la seule lecture imaginable (« où en est mon brief ? ») répond à une question qu'on ne se pose que *dans* le pad, devant le brouillon. Une ou deux actions coûteraient un domaine de routage, du dogfood et de la maintenance pour zéro conversation réelle. **Déclencheur de réouverture noté :** si Brief Prod gagne un jour un historique des briefs générés (flux), la question se repose. En attendant : alias `brief prod` / `kodex` dans `os.open_pad` (coût zéro, à poser au premier train qui touche le catalogue).
- **VEFA Studio (O-IMM-010)** — chantier **abandonné** (endpoints morts, un 401 déclenche `logout()`) ; ne jamais brancher, ne jamais re-proposer.
- **Pads-formulaires NOMEN-K (O-IMM-001, O-IMM-002, O-IMM-009…)** — **jamais d'actions par-pad** : ce sont des gabarits du Master Renderer, sans état métier persistant ni flux. Si une couverture naît un jour, elle passera par **une action générique du moteur** (« lire le formulaire courant »), pas par le catalogue pad par pad — sinon le catalogue devient le hard-coding que le Manifeste interdit.
- **Admin, K-Store, licence, facturation, Réglages** — **jamais.** Kora est l'assistante métier de l'utilisateur, pas l'exploitant de l'OS ; toucher licence ou facturation est engageant par nature (ligne rouge structurelle, pas un manque). Elle **s'efface** d'ailleurs déjà dans le K-Store, l'économiseur et le lockscreen.

### 15.4 Rappels transversaux

- Dans **tout** pad couvert, la ligne rouge du §7 (détruire / trancher / publier) reste entière — la carte des frontières ne l'assouplit jamais.
- **Règle d'entrée au catalogue** (le moule éprouvé sur SDQR/Sentinel/Keynapse/Smart Agent, obligatoire pour K-9+) : inventaire par agent de l'état lisible → actions (lectures d'abord, écritures sûres ensuite) → harnais → revue adverse 3 lentilles → entrée `KORA_PAD_META` + mise à jour des **deux** prompts decide (`_sysDecide` ET `_sysStage1`) + phrases de capacités + tests à seuil (jamais de comptage absolu d'actions).

---

### Rappels charte (impératifs)
- **Apple Premium** : pas d'emoji dans l'UI → `icon()` de `app/lib/ui-icons.js`. Tout `<select>` en flat.
- **Galet** : design VERROUILLÉ (harnais = référence), sobre en batterie, **gate iPhone avant câblage**.
- **Isolation** : préfixe dédié (ex. `kora_`) pour ne rien polluer.
- **Brief relu et validé — le code a suivi (K-0→K-6 en prod).** Toute évolution du périmètre passe par le §15 ; toute évolution vocale par `KORA_VOCAL_BRIEF.md`.

---

## ANNEXE A — RÉGLAGES DE RÉFÉRENCE (validés par Stéphane le 16/07/2026)

> **Ces valeurs sont la vérité.** Elles ont été réglées à l'œil, curseur par curseur, puis gravées.
> Source vivante : `_design-lab/kora-galet-harness.html` (constantes `STATES` + palettes).
> **Ne pas les « améliorer » sans validation** — chaque valeur est un arbitrage déjà tranché.

### A.1 Palettes — 3 teintes par mode

| Mode | Teinte A | Teinte B | Teinte C |
|---|---|---|---|
| **Repos** | `#7d6bf0` | `#4a7df5` | `#a16bf5` |
| **Écoute** | `#1ae09e` | `#4cf273` | `#26bfd9` |
| **Réflexion** | `#8a5cf0` | `#596bf5` | `#c76be0` |
| **Travail** | `#ff40ad` | `#21d1ff` | `#40f0a1` |
| **Besoin** | `#f0291a` | `#ff5c24` | `#ff9e4c` |

Psychologie assumée : Repos = bleu/violet (calme) · Écoute = turquoise/vert (réceptif) · Réflexion = violet/indigo/orchidée (introspection) · Travail = magenta/cyan/vert (toutes les couleurs = pleine capacité) · Besoin = vermillon/corail/or (urgence **chaleureuse**, jamais le rouge-erreur).

### A.2 Mouvement & forme — par mode

| Mode | galbe `n` | `ratio` | vitesse | énergie | respiration | spécifique |
|---|---|---|---|---|---|---|
| **Repos** | 4.0 | 2.50 | 1.65 | 0.33 | 0.45 | — |
| **Écoute** | 2.8 | 1.63 | 1.15 | 0.53 | 0.12 | `level:1` → amplitude **asservie au micro** |
| **Réflexion** | 8.5 | 2.76 | 1.50 | 0.64 | 0.20 | `weave:1` → ondes longues |
| **Travail** | 4.5 | 2.72 | 2.19 | 0.43 | 0.06 | `comet:1` → comète sur le pourtour |
| **Besoin de toi** | 11.4 | 2.57 | **0.32** (lent, grave) | 0.34 | 0.30 | `knock:1` → double toc doré |

- **Globaux (choix Stéphane, valent pour tous les modes) : `bloom = 0` (aucun halo) · `netteté = 1.0` (rubans nets max).**
- `ratio` n'est **plus** appliqué à la largeur (celle-ci est fixe, cf. §3) : il est **conservé comme source de l'arrondi** et pour le mode plein écran éventuel.
- **Arrondi des coins (pastille étendue)** : dérivé du galbe → `radPx = max(4, 19 − (n − 2) × 1.6)` ⇒ Écoute ≈ pill · Besoin ≈ 4-5 px (presque droit). La respiration et le toc modulent **l'arrondi**, jamais la taille.
- **Part de blanc** par mode (`white`) : Repos 0.65 · Écoute 0.40 · Réflexion 0.50 · Travail 0.30 · Besoin 0.20. Le blanc n'apparaît **qu'aux chevauchements** — jamais posé.

### A.3 Géométrie & intégration visuelle

| Élément | Valeur |
|---|---|
| Galet **au repos** | ≈ **44 × 38 px**, coins **9 px** (aligné sur les autres boutons de la topbar) |
| Galet **étendu** | ≈ **200 px** de large, même hauteur ; transition `width .38s cubic-bezier(.3,.9,.3,1)` — **pousse les voisins vers la gauche** |
| **Anneau** (élément touché) | trait **1 px** (`padding:1px`, `inset:-3px`), `conic-gradient` animé (`@property --ka`, rotation **1.5 s** ; **2.6 s** en mode Besoin), `drop-shadow 4px` |
| **Fenêtre** de dialogue | bordure **1 px** α **0.10** · fond `rgba(13,15,32,0.92)` · coins **14 px** · dégradé d'état en bas : hauteur **34 %**, opacité **0.16** · apparition fondu **0.28 s** + `translateY(8px)` |
| **Perf** | `dpr ≤ 2` · veille **30 fps** au repos · pause si onglet caché |

---

## ANNEXE B — CONTRAT D'INTÉGRATION (comment Kora vit dans les apps)

> Le principe : **un pad n'apprend rien de Kora.** Kora sait où elle agit ; elle éclaire l'élément, elle ne le modifie pas. Couplage minimal, retrait sans trace.

**B.1 Le galet — un composant unique de la topbar.** Il vit **une seule fois** dans l'OS (pas un par pad), à côté des boutons existants. Il n'a qu'une entrée : **l'état courant** (`repos | ecoute | reflexion | travail | besoin`). Isolation : préfixe `kora_` / `.kora-*`.

**B.2 L'anneau — deux lignes, zéro dépendance.** Kora éclaire un élément DOM en lui posant une classe, et la couleur suit l'état global :
```
document.body.dataset.koraState = 'travail';   // pilote les couleurs de TOUS les anneaux
el.classList.add('kora-ring');                 // l'élément touché s'entoure
// … action …
el.classList.remove('kora-ring');
```
Un pad **n'a rien à implémenter** : il lui suffit d'avoir des éléments identifiables. Le style vit dans une feuille commune (`app/kora.css`), jamais dans le pad.

**B.3 Le catalogue d'actions déclare sa cible.** Chaque action du catalogue (§2) porte, en plus de son exécution, **le sélecteur de ce qu'elle touche** — c'est ce qui relie « ce que Kora fait » à « ce que l'œil voit » :
```
{ id:'gw.rewrite_hook', pad:'ghostwriter', mode:'write',
  target:'#gw-hook',            // ← l'élément qui s'entoure pendant l'action
  run: async (args, ctx) => { … } }
```
**Règle :** une action sans `target` ne peut pas montrer son travail → toute action **visible** doit en déclarer un.

**B.4 La ligne rouge est portée par l'anneau.** Quand Kora passe en **Besoin de toi**, l'anneau se pose sur **l'élément qui attend la décision** (le bouton qui publie, la version à choisir) et ralentit (2.6 s). L'utilisateur n'a jamais à chercher où trancher — cf. §7 et §8.

**B.5 Ce que Kora ne fait jamais.** Elle **n'agit pas hors de vue** (si l'élément n'est pas à l'écran : le pad le fait défiler d'abord), elle **ne pose pas d'anneau sur ce qu'elle n'a pas touché**, et elle **retire tous ses anneaux** en se rangeant.
