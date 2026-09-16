> ⚠️ **ABANDONNÉ le 16/09/2026.** Kora a été déconnectée intégralement (code, Worker, tests, landing). Ce document est conservé pour l'historique. Son catalogue d'actions survit dans `app/bridge-actions.js` et l'anneau dans `app/bridge-ring.js`. Remplacement : accès MCP pour Claude — voir [[HANDOFF_MCP_CLAUDE]] et [[MCP_TOUS_LES_OUTILS_BRIEF]].

# Dogfood Kora — 2026-07-19 · K-7 Fiabilité du socle

> **SW de référence :** v5.28.334-kora-flag-durable · **worker :** 41439da0 (Keynapse, dernier en prod) · **appareils :** desktop (fait) + iPhone (à faire).
> **Exécutant :** Opus 4.8. **Deux moitiés :** A) pré-vol automatique (fait, ci-dessous) · B) dogfood interactif (à dérouler par Stéphane + Opus, cf. KORA_FIABILITE_PROTOCOLE.md).

---

## A. PRÉ-VOL AUTOMATIQUE — ✅ TOUT VERT (19/07, Opus 4.8)

Vérifications sans réseau ni appareil, faites avant d'engager tes mains. Rien ne bloque le dogfood interactif.

| Vérif | Outil | Résultat |
|---|---|---|
| **Suite de tests complète** | `npm test` | ✅ 875 + 66 + 33 + 53 + 12 + 30 + 35 + 33 tests — **0 échec** |
| Tests Kora par-pad | test-kora-{sentinel,routing,keynapse} | ✅ 35 + 33 (routing) + 33 (keynapse) verts |
| **Intégrité catalogue** | `node scripts/audit-kora-catalogue.mjs` (neuf) | ✅ 36 actions (24 lectures / 12 écritures), tous invariants |
| — id/pad/mode/desc≤240/target/run + params≤90 | idem | ✅ 36/36 conformes |
| — KORA_PAD_META ↔ catalogue (label+desc≤160, globaux chaine+os) | idem | ✅ |
| — les **2 prompts** worker nomment les 6 pads + hors-catalogue sûr | idem | ✅ `_sysDecide` ET `_sysStage1` OK |
| **Cibles d'anneau existent dans le source** | grep 23 sélecteurs | ✅ 23/23 trouvées (aucune fantôme → aucun anneau muet) |
| **Plomberie routage 2 étages** | lecture code | ✅ client envoie `pad`+`params`+`pads:KORA_PAD_META` ; 36>MAX_ACTIONS(32) déclenche les 2 étages ; MAX_PADS 12 / PAD_ACTIONS 24 / PAD_DESC 160 = marges OK (max pad = social 7) |
| **Grounding chaîne (bug immobilier)** | lecture `chain.start` | ✅ `_KEYSTONE_FACTS` posé en source dès sujet=Keystone + Gest « Conseiller Keystone » **ajouté** par-dessus (ne remplace plus) — le plancher rend le fix non-bloquant même sans l'ingest D1 |

**Décompte confirmé :** Brainstorming 5 · Ghost Writer 5 · Social 7 · SDQR 6 · Sentinel 3 · Keynapse 5 · chaîne 4 · os 1 = **36**.

**Ce que le pré-vol NE prouve PAS** (→ moitié B, tes mains) : le comportement réel du modèle (routage vif, fidélité de restitution vs JSON du harnais), les 7 cas limites (annule, deux onglets, cache/flag, iPhone), la perf 60 fps du galet.

---

## B. DOGFOOD INTERACTIF — à dérouler (protocole §2 et §3)

> Préparation §0 d'abord : `?kora=1`, SW ≥ v5.28.334, console ouverte, `wrangler tail`, harnais `kora-actions` ouvert sur la prod (étalon JSON), données réelles présentes.
> **Ingest D1 global (§0.6)** : à vérifier/appliquer si le scénario chaîne montre encore de l'immobilier — `wrangler d1 execute keystone-os --remote --file scripts/.ingest-keystone-global.sql` + reindex Vectorize. Non-bloquant grâce au plancher `_KEYSTONE_FACTS`, mais le noter.

### B.1 — Une conversation par pad (protocole §2)
| Pad | Actions | Verdict | Notes |
|---|---|---|---|
| OS (§2.1) | os.open_pad + alias | ⬜ | |
| Brainstorming (§2.2) | bs.* ×5 | ⬜ | |
| Ghost Writer (§2.3) | gw.* ×5 (⚠ quota = crédits, jamais caractères) | ⬜ | |
| Social Manager (§2.4) | sm.* ×7 (⚠ N=N sur les listes) | ⬜ | |
| Smart Dynamic QR (§2.5) | qr.* ×6 (⚠ 7j = pas d'évolution) | ⬜ | |
| Sentinel (§2.6) | snt.* ×3 (⚠ jamais audité ≠ hors ligne) | ⬜ | |
| Keynapse (§2.7) | kn.* ×5 (⚠ pas d'auto-résolution) | ⬜ | |
| Chaîne (§2.8) | chain.* ×4 bout-en-bout (⚠ zéro immobilier) | ⬜ | |

### B.2 — Cas limites (protocole §3)
| Scénario | Verdict | Notes |
|---|---|---|
| 3.1 « annule » (court / long / négation) + signature clignote-revient | ⬜ | **le test le plus important** |
| 3.2 deux onglets (kill-switch ≤ 1,8 s) | ⬜ | |
| 3.3 cache SW / purge → galet revient seul / ?kora=0 persiste | ⬜ | |
| 3.4 crédits / plan ADMIN | ⬜ | enforce dormant : juste vérifier le compteur +1/tour |
| 3.5 routage 2 étages (2 appels au tail sur un tour domaine) | ⬜ | |
| 3.6 hors-catalogue & lignes rouges (supprime/publie/météo/acquiescement) | ⬜ | |
| 3.7 mobile iPhone (chaîne + annule + 60 fps + retraits) | ⬜ | **= GATE K-7** |

---

## RÉSULTAT DE LA 1ʳᵉ PASSE (20/07, ~03h20) — 3 bugs de socle trouvés et CLOS

| Tour | Verdict | Note |
|---|---|---|
| « combien de posts ai-je faits ? » | ✅ | 5 annoncés / 5 listés, zéros intacts (16h00, 6h00), dates FR, extraits recopiés, URLs non fabriquées |
| « où j'en suis de mon quota d'écriture ? » | ✅ | « illimité » — fini le « 20000 caractères Plan Pro » |
| « mon site est en ligne ? » | ✅ | snt.fleet propre |
| « supprime ma dernière séance » | ✅ **après fix** | « supprimer, c'est ton geste — mais je peux te préparer une nouvelle séance, dis-moi. » ; logs prod : zéro `emmêlée`, zéro `catalogue tronqué` |
| Aération des listes | ✅ **après fix** | intro + un élément par ligne |

**Bugs corrigés, déployés (worker Version ID 28755e03) et vérifiés :** (1) refus & conversation cassés depuis le passage à 36 actions — `_parseStage1` n'avait pas le filet « prose » de `_parseDecision` ; (2) listes en pavé — CSS `pre-wrap` manquant **et** modèle n'émettant aucun `\n` ; (3) fausse alerte « catalogue tronqué » à chaque requête.

**Leçon centrale : deux tests ENCODAIENT le bug** (ils exigeaient que la prose soit jetée). D'où 36/36 tests verts et audit statique vert pendant que la prod était cassée. Un test qui défend une hypothèse ne peut pas attraper le bug qui vit dans cette hypothèse.

**Suite du protocole (SDQR, Keynapse, chaîne, annule, deux onglets, iPhone) : REPORTÉE EN FIN DE CHANTIER** par décision de Stéphane — K-8+ n'est plus gaté dessus.

---

## SYNTHÈSE FINALE — K-7 CLOS le 20/07/2026

### Ce qui a été mesuré

| Dimension | Outil | Résultat |
|---|---|---|
| **Routage** (quelle action pour quelle phrase) | `scripts/kora-bench.mjs` | **28/28**, 3 passes = 84 appels, **zéro instable**, 9 pads couverts |
| **Logique du pilote de chaîne** | `_design-lab/kora-chain-testbench.html` | **21/21** (arrêts rouges, cancel, coupe-circuit inter-onglets, retraits) |
| **Chaîne réelle bout-en-bout** | manuel, compte réel | ✅ séance → débat → synthèse → arrêt idée → rédaction → composer → arrêt Publier ; **article factuel, zéro immobilier** |
| **« Annule » en conditions réelles** | manuel | ✅ anneau éteint, rien supprimé |
| **Restitution** (4 lectures vs pads) | manuel | ✅ chiffres fidèles, dont Smart Agent (K-8) |
| **iPhone** | manuel | ✅ galet, feuille, lisibilité, écriture, repli auto |
| Suite de tests + audit catalogue | `npm test`, `audit-kora-catalogue.mjs` | verts |

### Bugs trouvés et corrigés pendant K-7 (7)

1. Refus et conversation cassés depuis le passage à 36 actions (`_parseStage1` sans filet prose)
2. Listes affichées en pavé (CSS `pre-wrap` **et** modèle n'émettant aucun `\n`)
3. Fausse alerte « catalogue tronqué » à chaque requête
4. « Génère-moi un QR » : promesse sans action (placeholder du persona recopié)
5. Domaine nu (`protein-keystone.com`) rejeté par `qr.prepare_url`
6. Action **imbriquée** jetée alors que la décision était juste (`_flattenAction`)
7. Galet en « travail » au lieu de « besoin de toi » au dernier arrêt rouge

### Bugs historiques re-prouvés morts
anneau-après-annule ✅ · immobilier ✅ · zéros avalés ✅ · listes N=N ✅

### Leçons de méthode (les plus chères)
- **Deux tests encodaient le bug** qu'ils étaient censés attraper → 36/36 verts pendant que la prod était cassée.
- **Un succès isolé ne prouve rien** quand le modèle tranche à pile ou face (temp 0.15) → `--repeat`.
- **Le banc peut mentir** : reproduire un scénario SEUL avant d'accuser le produit (fuite `kora_chain_kill`).
- **Le corpus peut avoir tort** : vérifier l'attendu avant d'accuser le modèle.

### Portée assumée
Le routage et le pilote sont couverts **exhaustivement** ; l'exécution réelle des 40 actions est couverte **par échantillon** (chaîne complète + 4 lectures + 2 écritures). Les cas restants (crédits épuisés — enforce dormant en beta, purge/cache) sont sans risque connu.

> **VERDICT : GO.** Zéro bloquant ouvert. Prochain sprint : **K-9 — desK**.
