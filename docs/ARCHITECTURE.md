# KEYSTONE OS — Architecture de Référence

**Version :** 1.0
**Date :** 2026-05-10
**Statut :** Canonique — toute évolution doit passer par révision de ce document.

---

## 1. Vision

Keystone OS est une **plateforme multi-artefacts** déployée en mode cloud (Cloudflare + Vercel), accessible web et mobile via PWA. Elle héberge un catalogue d'applications (Key-Store) appartenant à deux familles :

- **🔧 OUTILS** — générateurs légers de prompts/briefs structurés à coller dans une IA tierce.
- **🎁 ARTEFACTS** — applications complètes avec workflow, persistance, dashboards et exports.

L'architecture est conçue pour qu'**ajouter un nouvel OUTIL coûte 1 sprint** et qu'**ajouter un ARTEFACT coûte 2-4 sprints**, sans jamais réinventer les briques transverses.

---

## 2. Principes directeurs

1. **Cloud-first, mobile-compatible.** Plus de clé USB. PWA installable sur desktop et mobile.
2. **Souveraineté des données.** Toutes les données utilisateur restent dans D1 (EU-West, RGPD).
3. **Séparation stricte des couches.** Aucun artefact ne touche directement les couches inférieures, il consomme uniquement des moteurs.
4. **Mutualisation maximale.** Chaque moteur est codé une seule fois, réutilisé par N applications.
5. **Robustesse cross-IA.** Les prompts envoyés aux LLM sont micro-cadrés (texte court, structure imposée) pour fonctionner identiquement sur Claude, GPT, Gemini, Mistral.
6. **Sanctuarisation du template.** Les templates HTML/CSS ne sont jamais exposés à l'IA ni à l'utilisateur final.
7. **Offline-graceful.** Les artefacts critiques continuent de fonctionner en lecture seule sans réseau (cache PWA + IndexedDB).

---

## 3. Architecture en 5 couches

```
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 4 — SHELL (UI commune Keystone OS)                         │
│ Dashboard · Key-Store · Vault · Auth · PWA installable           │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 3 — CATALOG (le Key-Store)                                 │
│ ┌─────────── 🔧 OUTILS ──────────┬──── 🎁 ARTEFACTS ──────────┐  │
│ │ CODEX · MUSE · …              │ VEFA · SDQR · SENTINELLE …  │  │
│ └────────────────────────────────┴──────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 2 — SHARED ENGINES (moteurs réutilisables)                 │
│ 📄 DocEngine    template + [[vars]] + Paged.js → PDF             │
│ 🤖 PromptEngine bridge IA multi-modèle (prompts micro-cadrés)    │
│ 🎨 SVGEngine    éditeur vectoriel (QR, moodboards, badges)       │
│ 🧭 BrowserPilot extension Chrome Keystone (autopilote nav.)      │
│ 📊 ChartEngine  jauges, sparklines, dashboards SVG               │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 1 — DATA FABRIC (couche données unifiée)                   │
│ D1 (relationnel) · R2 (assets) · KV (cache) · IDB local (PWA)    │
│ + Sync queue + chiffrement at-rest                               │
├──────────────────────────────────────────────────────────────────┤
│ LAYER 0 — IDENTITY & BILLING (existant)                          │
│ Licences · JWT · Devices · Stripe webhook                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Détail des couches

### Layer 0 — Identity & Billing *(existant, à conserver)*

**Rôle :** Authentification, licences, facturation. Couche déjà en production.

**Composants actuels :**
- Routes `/api/licence/*` (activate, validate, revoke)
- Routes `/api/device/*` (register, approve, login)
- Routes `/api/licence/v2/*` (hashed keys + JWT + fingerprint)
- Webhook Stripe `/api/stripe/webhook`
- Vault chiffré AES-GCM par tenant

**Garde-fou :** Aucun artefact ne court-circuite cette couche. Toute requête API est authentifiée.

---

### Layer 1 — Data Fabric

**Rôle :** Stockage unifié et synchronisation entre cloud et clients.

**Composants :**

| Composant | Usage | Limite |
|---|---|---|
| **D1** (Cloudflare) | Données relationnelles : pads, catalog, briefs, qr-codes, scans, programs… | 10 GB / DB |
| **R2** (Cloudflare) | Assets lourds : screenshots, PDF générés, images uploadées | 10 GB gratuits / payant ensuite |
| **KV** (Cloudflare) | Cache, sessions courtes, tokens éphémères | 1 GB |
| **IndexedDB** (client) | Cache local PWA via Dexie.js, mode offline | ~50 MB navigateur |

**Règles :**
- Tout schéma D1 est versionné (migrations forward-only dans `workers/migrations/`)
- Tout asset R2 est nommé selon le pattern `{tenantId}/{artefactId}/{entityId}/{filename}`
- Le client a une **sync queue** persistante en IndexedDB pour les mutations offline
- Chiffrement at-rest : AES-GCM pour les vaults, clair pour le reste (déjà protégé par Cloudflare)

**Module commun à créer : `app/lib/data-fabric.js`**
- `dataFabric.read(entity, id)` → lit D1 + cache local
- `dataFabric.write(entity, payload)` → écrit local + queue cloud
- `dataFabric.sync()` → flush la queue
- `dataFabric.upload(blob)` → R2 multipart si > 1 MB

---

### Layer 2 — Shared Engines

#### 📄 DocEngine

**Rôle :** Générer des documents PDF professionnels à partir d'un template HTML sanctuarisé et d'un dictionnaire de variables.

**API :**
```js
docEngine.render({
  templateId: 'vefa-notice-v2',
  variables: {
    PROGRAMME: 'Bandol Vue Mer',
    CLAUSE_RE2020: '...',  // texte brut
    ZONE_GEO: 'H2',
    ...
  },
  mode: 'pdf' | 'preview' | 'html'
})
```

**Stack :**
- Templates stockés en `app/lib/doc-templates/*.html` (sanctuarisés, jamais exposés à l'IA)
- Variables d'injection : syntaxe `[[NOM_VARIABLE]]`
- Moteur de rendu : **Paged.js** côté client (offline-graceful)
- Bibliothèque de clauses : table D1 `clauses` (id, secteur, version, content)

**Apps consommatrices :** VEFA, Mandat Genius, Bail Pro, CGU Builder, Brochure Builder, tous les exports PDF.

---

#### 🤖 PromptEngine

**Rôle :** Bridge unifié vers les LLM (Claude, GPT, Gemini, Mistral, Grok, Perplexity, Llama). Garantir des résultats stables cross-modèle grâce à des prompts micro-cadrés.

**API :**
```js
promptEngine.run({
  task: 'redact-section',         // tâche atomique pré-définie
  context: { ...donnéesUtilisateur },
  engine: 'claude' | 'gpt' | 'gemini' | ...,
  apiKey: <userKey>,              // BYOK (Bring Your Own Key)
  maxTokens: 800
})
```

**Principe clé :** chaque tâche est une recette atomique (`redact-section`, `summarize`, `extract-entities`, `translate`…) avec :
- Un prompt système figé, optimisé par modèle
- Un format de sortie strict (JSON ou texte court)
- Pas de génération de HTML/CSS — uniquement du texte

**Apps consommatrices :** VEFA, CODEX, MUSE, Naming Lab, Punchline Factory, FAQ Generator, Email Pro Templates…

---

#### 🎨 SVGEngine

**Rôle :** Éditeur visuel SVG pour QR codes, moodboards, badges, vCards.

**API :**
```js
svgEngine.create({
  type: 'qr' | 'moodboard' | 'badge' | 'vcard',
  config: { ...paramsVisuels },
  brand: { colors, fonts, logo }
})
```

**Stack :**
- Canvas + bibliothèque maison sur SVG natif
- Pour QR : génération matrice + stylisation modules/ancres
- Export : SVG, PNG (via `<canvas>`), PDF (via DocEngine)
- Vérification contraste ISO en temps réel

**Apps consommatrices :** SDQR Hub, vCard Pro, MUSE (moodboards), Wi-Fi Guest Card, Signature Mail.

---

#### 🧭 BrowserPilot *(extension Chrome Keystone)*

**Rôle :** Autopilote de navigation lancé manuellement par l'utilisateur depuis SON navigateur, sur SES propres ressources (annonces, comptes…).

**Stack :**
- Extension Chrome Manifest V3
- Background Service Worker + Content Scripts injectés à la demande
- Bridge `postMessage` chiffré avec Keystone OS (origine validée)
- Comportement mimétique humain (pauses, scroll naturel, parcours warm-up)

**Cadre légal :** l'extension agit sous le contrôle de l'utilisateur, sur son IP, sur ses propres contenus. RGPD et CGU des sites tiers respectés (1-2 actions/jour, jamais de scraping massif).

**Apps consommatrices :** SENTINELLE, Concurrent Watch, Avis Radar, DPE Tracker, Foncier Hunter.

---

#### 📊 ChartEngine

**Rôle :** Composants visuels de dashboard (jauges circulaires SVG, sparklines, barres, heatmaps).

**API :**
```js
chartEngine.render(container, {
  type: 'gauge' | 'sparkline' | 'heatmap' | 'bar',
  data: [...],
  brand: { palette: 'navy-gold' }
})
```

**Stack :** SVG natif, zéro dépendance externe lourde (pas de D3.js complet). Style figé Navy & Gold.

**Apps consommatrices :** SENTINELLE, Programme Tracker, KPI Dashboard, SDQR Hub (analytics), Cash-Flow Visualiseur.

---

### Layer 3 — Catalog

**Rôle :** Le Key-Store. Catalogue des OUTILS et ARTEFACTS disponibles.

**Composants :**
- Métadonnées catalogue : table D1 `catalog_tools` + JSON embarqué fallback
- Page Key-Store rendue par `app/ui-renderer.js`
- Fiches application complètes (icon, cover, screenshots, longDesc, prix, plan)
- Classification ownership : owned / lifetime / suggested

**Règles d'inscription au catalogue :**
- Toute app **DOIT** être tagguée `OUTIL` ou `ARTEFACT`
- Toute app **DOIT** déclarer ses moteurs consommés (`engines: ['DocEngine', 'PromptEngine']`)
- Toute app **DOIT** avoir une fiche complète avant publication

---

### Layer 4 — Shell

**Rôle :** L'UI globale de Keystone OS, commune à tous les artefacts.

**Composants existants :**
- `app.html` + `app/ui-renderer.js`
- Dashboard d'accueil (programmes, KPIs)
- Key-Store (catalogue)
- Vault utilisateur (clés API BYOK)
- Auth + login
- Manifest PWA + Service Worker

---

## 5. Conventions de code

### Arborescence cible

```
KEYSTONE_OS/
├── app/                        ← Frontend (Layer 3-4)
│   ├── lib/
│   │   ├── data-fabric.js     ← Layer 1
│   │   ├── doc-engine.js      ← Layer 2
│   │   ├── prompt-engine.js   ← Layer 2
│   │   ├── svg-engine.js      ← Layer 2
│   │   ├── chart-engine.js    ← Layer 2
│   │   └── doc-templates/     ← Templates HTML sanctuarisés
│   ├── artefacts/             ← Apps Layer 3 (1 dossier par artefact)
│   │   ├── vefa/
│   │   ├── sdqr/
│   │   └── sentinelle/
│   ├── outils/                ← Apps Layer 3 (1 dossier par outil)
│   │   ├── codex/
│   │   └── muse/
│   ├── shell/                 ← UI commune Layer 4
│   ├── pads-data.js
│   ├── pads-loader.js
│   └── ui-renderer.js
├── workers/                    ← Backend Cloudflare (Layer 0-1)
│   └── src/
│       ├── routes/
│       ├── lib/
│       └── migrations/
├── extension/                  ← BrowserPilot (Layer 2)
│   ├── manifest.json
│   ├── background.js
│   ├── content-scripts/
│   └── bridge.js
└── docs/
    ├── ARCHITECTURE.md         ← ce document
    └── HANDOFF_*.md
```

### Nommage

- **Moteurs** : PascalCase exporté (`DocEngine`, `PromptEngine`)
- **Artefacts/Outils** : kebab-case dossier (`vefa`, `codex`)
- **Tables D1** : snake_case pluriel (`catalog_tools`, `qr_codes`)
- **Routes API** : `/api/{couche}/{ressource}` (ex: `/api/data/programs`, `/api/engine/prompt`)

### Règles de gouvernance

1. ❌ Aucun artefact ne fait de `fetch()` direct vers l'API → passe par `dataFabric`
2. ❌ Aucun artefact ne génère de PDF custom → passe par `DocEngine`
3. ❌ Aucun artefact n'appelle un LLM en direct → passe par `PromptEngine`
4. ❌ Aucun template HTML n'est exposé dans un prompt → sanctuarisation stricte
5. ✅ Chaque nouvel artefact ajoute son tag dans `pads-data.js` avec la liste des moteurs consommés

---

## 6. Roadmap de mise en place

| Phase | Durée | Livrable |
|---|---|---|
| **P1** | 2 sem | Refactor Data Fabric + extraction DocEngine |
| **P2** | 2 sem | PromptEngine + bibliothèque tâches atomiques |
| **P3** | 1 sem | ChartEngine + SVGEngine (briques de base) |
| **P4** | 3 sem | VEFA Studio v2 (premier ARTEFACT sur archi propre) |
| **P5** | 1 sem | CODEX + MUSE (premiers OUTILS, validation légèreté) |
| **P6** | 3 sem | BrowserPilot extension Chrome |
| **P7** | 3 sem | SENTINELLE Vigie (premier consommateur Pilot) |
| **P8** | 2 sem | SDQR Hub (consommateur SVGEngine + ChartEngine) |

**Total cible : ~17 semaines** pour la plateforme complète + 4 artefacts + 2 outils.

---

## 7. Critères d'acceptation de l'architecture

L'architecture est validée si :

- [x] Ajouter un nouvel OUTIL = 1 sprint sans toucher aux couches inférieures
- [x] Ajouter un nouvel ARTEFACT = 2-4 sprints en consommant uniquement les moteurs
- [x] Aucun template HTML n'est jamais visible par un LLM
- [x] Le même prompt produit des résultats équivalents sur Claude / GPT / Gemini / Mistral
- [x] Le système fonctionne en lecture seule offline (PWA)
- [x] Toutes les données utilisateur restent en EU-West (RGPD)
- [x] L'extension BrowserPilot est légalement compatible (action utilisateur explicite)

---

**Fin du document.**
Toute proposition de modification doit être discutée avant implémentation.
