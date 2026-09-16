> ⚠️ **ABANDONNÉ le 16/09/2026.** Kora a été déconnectée intégralement (code, Worker, tests, landing). Ce document est conservé pour l'historique. Son catalogue d'actions survit dans `app/bridge-actions.js` et l'anneau dans `app/bridge-ring.js`. Remplacement : accès MCP pour Claude — voir [[HANDOFF_MCP_CLAUDE]] et [[MCP_TOUS_LES_OUTILS_BRIEF]].

# KORA — MODE VOCAL (K-14) · Brief de conception autoporté

> **Pour qui :** Opus 4.8 (ou tout exécutant), qui réalisera ce chantier **sans l'auteur de ce brief**. Tout ce qu'il faut savoir est ici ou dans les fichiers pointés — comme `NETWORK_BRIEF.md` en son temps.
> **Écrit le :** 19/07/2026 (Fable 5). **Zéro code app dans ce brief** — c'est une conception.
> **Prérequis absolu :** K-7 (`KORA_FIABILITE_PROTOCOLE.md`) déroulé et vert. On ne pose pas la voix sur un socle non prouvé.
> **Décisions déjà tranchées par Stéphane (KORA_BRIEF §14, ne pas rediscuter) :** voix = **Piper/Siwis maison en streaming** (pas de cloud, pas de `speechSynthesis`) · geste mobile = **poignée basse dans la feuille** (tap galet = ouvrir) · persona complice qui tutoie · crédits IA existants (1 crédit/tour, tool `kora`) · mémoire session seule.

---

## 1. La cible en une phrase

> **Maintenir → parler (le galet ondule en turquoise, on se voit entendu) → relâcher → Kora agit et répond en parlant, dès la première phrase, pendant que la suite s'écrit.**

Le mode vocal ne crée **aucune nouvelle intelligence** : c'est la même boucle decide/answer, avec une **entrée micro** (STT) et une **sortie voix** (TTS) branchées dessus. Tout le chantier tient dans ces deux branchements + la machine d'états qui les orchestre proprement.

Les deux reproches du Smart Agent que ce mode doit tuer (KORA_BRIEF §9) : la **latence** avant le premier son, et l'obligation d'**appuyer à chaque fois** sans retour visuel d'écoute.

---

## 2. Ce qui existe déjà (tout réutiliser, rien réinventer)

| Brique | Où | Ce qu'elle donne |
|---|---|---|
| **TTS Piper maison** | `app/lib/piper-tts.js` | 100 % navigateur (WASM ONNX mono-thread, same-origin `/app/vendor/`, modèle fr `fr_FR-siwis-medium` ~60 Mo mis en cache par le SW). API : `isSupported()`, `warmUp(voiceId)`, `isVoiceReady()`, `speakText()` (phrase par phrase), **`createSpeechStream({voiceId,onState})`** (on lui pousse les chunks SSE, il parle dès la 1ʳᵉ phrase complète), `stopSpeaking()`, `voiceForLang()`. Coût serveur : **zéro**. Perf constatée : ~1-3 s/phrase de synthèse sur desktop (commentaire `app/smart-agent.js:2069`). |
| **Consommateur modèle du stream** | `app/smart-agent.js` (~l. 2114-2140) | Le pattern exact « SSE + `createSpeechStream` + warmUp pendant que le modèle répond » tourne en prod (SA-10.1). À transposer, pas à réécrire. |
| **STT Whisper serveur** | `workers/src/routes/keynapse.js` (~l. 543, `WHISPER_MODEL = '@cf/openai/whisper'`) | POST d'un blob audio → `res.text`, français pris en charge. En prod pour les mémos vocaux Keynapse (client `app/keynapse.js`, MediaRecorder). |
| **Boucle Kora** | `workers/src/routes/kora.js` + `app/kora-loop.js` | decide (JSON strict, routage 2 étages) → action client → answer **streamé SSE** — la sortie à lire à voix haute existe déjà sous forme de flux. |
| **Le galet + l'état Écoute** | `app/kora.js` (+ réglages gravés KORA_BRIEF Annexe A) | 5 modes dont Écoute (turquoise, amplitude asservie à `uLevel`). Le **vrai micro** (getUserMedia + AnalyserNode, RMS − plancher 0.012 × gain 5.5, lissage attaque 30 / retombée 9) est **déjà branché et validé dans les 2 harnais** (`_design-lab/kora-galet-harness.html`, `kora-galet-morph.html`) — recopier ces constantes telles quelles. |
| **La fenêtre / la feuille mobile** | `app/kora.js` + `app/kora.css` | Panneau droit desktop, feuille plein écran mobile — la poignée basse s'ajoute à la feuille existante. |
| **L'orbe (réserve)** | `_design-lab/kora-orb.html` | Famille validée « sphère de verre + lames 3D + plasma » pour un **éventuel** écran vocal plein écran. **Pas pour la V1** — cf. §8. |
| **Prod prête pour le micro** | Vercel | `Permissions-Policy: microphone=(self)` déjà en place (vérifié lors du gate iPhone). |

---

## 3. Architecture tranchée : half-duplex talkie-walkie

**Half-duplex strict : le micro et la voix ne sont jamais ouverts en même temps.** C'est ce qui rend le système simple et robuste — aucun écho à annuler, aucune détection d'activité vocale, des tours de parole nets.

### 3.1 STT — MediaRecorder → Whisper worker (décision de ce brief)

**Voie retenue : celle de Keynapse.** Maintien = `MediaRecorder` enregistre ; relâcher = le blob part vers un endpoint Kora qui appelle Whisper ; le texte revient et entre dans `_send()` de `kora-loop.js` **comme si l'utilisateur l'avait tapé**. Aucun changement à la boucle decide/answer.

**Pourquoi pas `SpeechRecognition` (l'API navigateur, utilisée pour la dictée Smart Agent) :**
1. **Souveraineté** — Chrome envoie l'audio chez Google, Safari chez Apple. Incompatible avec l'argument « micro fermé, rien ne sort » de Keystone.
2. **Fiabilité iOS/PWA** — comportement erratique en PWA installée, résultats intermédiaires imprévisibles.
3. **Le talkie-walkie n'a pas besoin de streaming STT** — on transcrit un énoncé **complet** à la fin du maintien ; Whisper est exactement fait pour ça, et la plomberie est déjà en prod.

**Endpoint : `POST /api/kora/stt`** (nouveau, dans `workers/src/routes/kora.js`) — ne pas réutiliser l'endpoint Keynapse tel quel (métrage et gardes différents) mais **recopier sa mécanique** (mêmes limites de taille, même modèle). Gardes : JWT requis, blob plafonné (~2 Mo ≈ 60 s), durée max 60 s côté client, `recordUsage` phase 'stt'. **Coût : compris dans le crédit du tour** (1 crédit/tour tout compris, cohérent §14 — pas de sous-compteur).

**Piège mimeType :** Safari/iOS enregistre en `audio/mp4`, Chrome en `audio/webm;codecs=opus`. Faire `MediaRecorder.isTypeSupported()` en cascade et envoyer le `Content-Type` réel ; Whisper accepte les deux.

### 3.2 TTS — le flux answer existant branché sur `createSpeechStream`

Aujourd'hui `kora-loop.js` fait `el.textContent += chunk`. Le mode vocal ajoute, **quand la voix est active** : `speech.push(chunk)` vers un `createSpeechStream` ouvert au début de la phase answer. Rien d'autre. La découpe à la phrase, la file de lecture, l'état « loading » : tout est déjà dans `piper-tts.js`.

- `warmUp()` se lance **dès le début du maintien** (pointerdown) — le modèle Piper se charge pendant que l'utilisateur parle et que decide tourne : latence masquée (pattern SA-9.2).
- **Premier usage** : le modèle ~60 Mo se télécharge. Écran de préparation sobre façon SA-13 (« Je prépare ma voix… » + progression), **une seule fois** (cache SW ensuite, même hors ligne).
- Langue : **V1 = français uniquement** (Siwis). `voiceForLang()` existe si le multilingue arrive un jour — ne rien construire pour ça maintenant.

### 3.3 Ce que la V1 ne fait PAS (gravé, ne pas « améliorer »)

- Pas de micro ouvert / mains libres / VAD (option « Plus tard », KORA_BRIEF §9.2).
- Pas de `speechSynthesis`, pas de TTS cloud, pas de `SpeechRecognition`.
- Pas de mémoire vocale spécifique : même session, mêmes plafonds.
- Pas de re-design du galet ni des harnais (verrouillés, KORA_BRIEF §3/Annexe A).

---

## 4. Machine d'états complète

États de la **session vocale** (superposés aux 5 modes du galet, qu'ils pilotent) :

```
IDLE ──(pointerdown ≥150 ms sur la surface d'émission)──▶ ARMEMENT
ARMEMENT ──(getUserMedia OK)──▶ ENREGISTRE          [galet: Écoute, uLevel = micro réel]
ARMEMENT ──(refus/erreur micro)──▶ IDLE             [message sobre, mode écrit intact]
ENREGISTRE ──(relâché sur la surface)──▶ TRANSCRIT   [galet: Réflexion]
ENREGISTRE ──(glissé HORS surface puis relâché)──▶ IDLE   [annulé, rien n'est envoyé]
ENREGISTRE ──(60 s atteintes)──▶ TRANSCRIT           [coupe propre, pas d'erreur]
TRANSCRIT ──(texte non vide)──▶ BOUCLE               [le texte entre dans _send() tel quel]
TRANSCRIT ──(texte vide/erreur)──▶ IDLE              [« Je n'ai rien entendu, réessaie. »]
BOUCLE = decide → action → answer                    [galet: Réflexion → Travail, anneaux inchangés]
BOUCLE ──(1er chunk answer, voix active)──▶ PARLE    [texte s'écrit ET Piper lit, phrase par phrase]
PARLE ──(flux fini + file de lecture vide)──▶ IDLE   [galet: repos]
PARLE ──(pointerdown = BARGE-IN)──▶ ARMEMENT         [stopSpeaking() immédiat ; le TEXTE continue de s'écrire]
n'importe quand ──(429 crédits)──▶ IDLE              [phrase sobre existante, pas de voix]
```

Détails qui comptent :
- **Anti-tap** : < 150 ms de maintien = un tap (ouvre/ferme la fenêtre, comportement actuel intact). Le talkie-walkie ne vole pas le geste existant.
- **Barge-in = couper la voix, jamais le travail.** `stopSpeaking()` tue l'audio ; le fetch SSE **continue** et le texte s'affiche en entier (la réponse reste consultable). On n'annule pas une action en parlant fort — « annule » reste un mot qu'on dit (chain.cancel).
- **Jeton de génération obligatoire** (leçon payée sur `kora-chain.js` `_gen`) : chaque session vocale incrémente un compteur module ; tout callback orphelin (fin de transcription tardive, chunk audio en retard, onState) vérifie son jeton avant d'agir. C'est LA défense contre « la voix parle encore après l'interruption ».
- **Toggle voix** : petit bouton dans la fenêtre (icône `icon()` du registre, jamais d'emoji) — parler au micro active la voix de réponse pour la session ; taper au clavier répond en silence sauf toggle actif. Préférence mémorisée par device (clé `kora_voice_on`, **hors** PREFS_KEYS — préférence d'appareil, pas de compte, cf. piège Cloud Vault clobber).

---

## 5. Surfaces & gestes

### Desktop
- **Surface d'émission = le galet lui-même** (tenir le galet = émettre, KORA_BRIEF §9.2). Pointer events : `pointerdown`/`pointerup`/`pointerleave` (leave pendant maintien = annuler, cohérent WhatsApp).
- Pendant l'enregistrement, le galet passe en Écoute et **l'onde suit la vraie voix** — c'est le retour « je suis entendu » qui manquait au Smart Agent.

### Mobile (décision §14 gravée : poignée basse)
- **Tap sur le galet = ouvrir la feuille** (inchangé). Le maintien-pour-parler vit sur une **poignée EN BAS de la feuille**, dans la zone du pouce : barre pleine largeur ~56 px, libellé « Maintiens pour parler », au-dessus de la barre de saisie texte (qui reste).
- Convention WhatsApp complète : maintenir = enregistrer · relâcher = envoyer · **glisser hors de la poignée avant de relâcher = annuler** (feedback visuel : la poignée vire au gris, libellé « Relâche pour annuler »).
- Pendant l'enregistrement la poignée affiche le temps (0:07) et une mini-onde ; le galet du header passe en Écoute aussi (cohérence du témoin).

---

## 6. Pièges anticipés (chacun a déjà coûté une session quelque part — les lire AVANT de coder)

1. **iOS AudioContext** : doit être créé/`resume()` **dans un geste utilisateur**. Créer l'AudioContext (analyser + lecture Piper) au premier `pointerdown`, jamais au chargement. Sinon : silence sans erreur.
2. **iOS autoplay** : la première lecture audio doit suivre un geste. Le flux talkie-walkie le garantit naturellement (on a maintenu le doigt) — ne pas ajouter de lecture « spontanée » (accueil parlé…) qui, elle, serait bloquée.
3. **MediaRecorder Safari = `audio/mp4`** (cf. §3.1). Tester la cascade de mimeTypes sur vrai iPhone, pas en simulateur.
4. **Perf Piper sur iPhone** : WASM mono-thread ; ~1-3 s/phrase sur desktop peut devenir 2-4× sur mobile. Le streaming à la phrase amortit (on lit pendant qu'on synthétise la suivante), mais **mesurer au GATE** ; si une phrase de retard s'accumule, dégrader = phrases plus courtes côté persona (déjà brèves) et/ou lecture après coup au-delà d'un seuil.
5. **~60 Mo de modèle** : jamais en silence sur réseau cellulaire — l'écran de préparation (§3.2) l'annonce ; le SW le cache ensuite.
6. **Onglet non fronté** : rAF en pause, transitions CSS gelées, `getComputedStyle` figé (piège vu 3×) — toujours fronter l'onglet avant de conclure à un bug ; la lecture Piper doit `stopSpeaking()` si `document.hidden` (pas de voix fantôme d'un onglet caché).
7. **Deux onglets** : la voix ne parle que dans l'onglet où le maintien a eu lieu (le jeton de génération est par-onglet — c'est suffisant, pas besoin du kill-switch localStorage ici car aucun timer ne survit à la réponse).
8. **Streaming Workers AI** : ne JAMAIS filtrer les chunks par truthiness ni `typeof` (le token `"0"` arrive parfois en **nombre**) — `chunk !== null && chunk !== undefined && chunk !== '' → String(chunk)`. Le bug des zéros a été payé deux fois (kora.js, brainstorming.js) ; le tuyau vers `createSpeechStream` doit appliquer la même règle.
9. **XSS** : le texte transcrit est du contenu utilisateur — il passe par `_esc()` comme le texte tapé, aucun chemin nouveau.
10. **Crédits épuisés (429)** : phrase sobre existante ; s'assurer qu'en mode vocal l'échec est aussi **dit** (une phrase Piper courte) — un échec silencieux en vocal ressemble à une panne.
11. **Micro refusé** : message sobre + le mode écrit reste entier ; mémoriser le refus pour ne pas re-prompt à chaque maintien (re-proposer seulement sur geste explicite).
12. **Ne pas casser le tap** : le seuil 150 ms (§4) doit être réglé sur vrai device — trop court = ouvertures de fenêtre fantômes, trop long = « ça ne m'écoute pas ».

---

## 7. Découpage en sprints internes (V-1 → V-5) — critère de sortie chacun

> Règle : **un sprint ne commence pas tant que le précédent n'est pas vert.** Chaque sprint = harnais/banc d'abord, prod ensuite au « go » de Stéphane (runbook : bump SW obligatoire, worker déployé séparément).

**V-1 — STT talkie-walkie, desktop, réponse texte.**
Maintien galet → MediaRecorder → `POST /api/kora/stt` → texte dans `_send()`. Pas encore de voix de réponse.
*Sortie :* 10 énoncés français réels transcrits et compris (l'action déclenchée est la bonne) ; micro refusé = message sobre ; glisser-hors = annule ; aucun régression du tap ; `wrangler tail` propre.

**V-2 — TTS streaming (la réponse parle).**
`createSpeechStream` branché sur le flux answer ; warmUp au pointerdown ; écran de préparation du premier téléchargement ; toggle voix.
*Sortie :* premier son ≤ ~2 s après l'arrivée de la première phrase du flux ; les zéros/dates survivent à l'oreille (« 17 h 04 », « 2026 ») ; texte affiché = texte lu.

**V-3 — Machine d'états complète + barge-in.**
Jeton de génération, interruption (maintien pendant PARLE), cap 60 s, erreurs (transcription vide, 429), `document.hidden`.
*Sortie :* banc d'essai en **scénarios isolés** (leçon : jamais de banc séquentiel flaky) tous verts, dont : barge-in coupe la voix < 200 ms et le texte finit de s'écrire ; aucun audio orphelin après 3 interruptions rapides.

**V-4 — Mobile : poignée basse + GATE iPhone.**
Feuille + poignée (§5), gestes WhatsApp complets, perf Piper mesurée sur l'iPhone de Stéphane, **sur la prod** (`protein-keystone.com`, méthode éprouvée du gate galet).
*Sortie :* **GATE iPhone validé par Stéphane** — enregistrement fiable (mimeType mp4), lecture fluide sans accumulation de retard, poignée dans la zone du pouce, galet 60 fps pendant l'écoute. C'est le verdict qui conditionne la mise en avant du mode.

**V-5 (option, seulement si Stéphane le demande après usage réel) — Scène vocale plein écran.**
L'orbe `_design-lab/kora-orb.html` (famille validée : sphère de verre + lames 3D + plasma + lueur de bordure, 5 états, réglages gravés dans le harnais) devient l'écran d'une conversation vocale immersive. **Ne rien construire avant ce signal** — le galet suffit à la V1, l'orbe est une réserve, pas un dû. S'il se lance : mêmes états, même machine, l'orbe n'est qu'un rendu de plus piloté par `koraState` ; et re-GATE iPhone (raymarch = coûteux).

---

## 8. Ce que l'exécutant doit relire avant de commencer

1. `KORA_BRIEF.md` en entier (surtout §3, §7, §9, §14, §15, Annexes A/B).
2. `app/lib/piper-tts.js` (l'API réelle) et le consommateur `app/smart-agent.js` ~l. 2100-2145.
3. `app/keynapse.js` (MediaRecorder → Whisper) + `workers/src/routes/keynapse.js` ~l. 540-560.
4. `app/kora-loop.js` (la boucle où l'on se branche) et `app/kora.js` (états du galet, `uLevel`).
5. La mémoire `kora-agent-os` (pièges gravés : jeton `_gen`, zéros du streaming, onglet non fronté, overlays testés par classe d'état, cache-buster CSS `?v=`).
6. Charte : pas d'emoji, `icon()` du registre, selects flat, préfixe `kora_`.
