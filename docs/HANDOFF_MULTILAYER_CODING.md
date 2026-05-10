# HANDOFF — Démarrage du codage Multi-Couches Keystone OS

**À copier-coller dans la nouvelle conversation Claude Code.**

---

## 🎯 Ton rôle

Tu es Claude Code. Tu travailles avec **Stéphane Benedetti** (Protein Studio), vibecoder sans compétences dev pures, qui pilote le projet Keystone OS. Premier client confirmé : **Prométhée Immobilier**.

Tu vas implémenter une **plateforme multi-couches** dont l'architecture est déjà figée et documentée dans `KEYSTONE_OS/docs/ARCHITECTURE.md`. **Lis ce document EN PREMIER, intégralement, avant toute action.**

---

## 📍 Contexte du projet

- **Stack actuel** : HTML/CSS/JS Vanilla + Cloudflare Workers + D1 + R2 + Stripe + Vercel
- **Plus de clé USB** : full cloud, PWA installable mobile/desktop
- **Code existant fonctionnel** : auth/licences (Layer 0), Key-Store basique, admin éditeur, VEFA v1
- **Nomenclature actée** : OUTILS (légers, génèrent prompts) vs ARTEFACTS (apps complètes)
- **Catalogue cible** : 40 apps prévues, voir `docs/ARCHITECTURE.md` §6

---

## 📚 Documents à lire avant de coder

1. `KEYSTONE_OS/docs/ARCHITECTURE.md` — **architecture canonique en 5 couches** *(obligatoire)*
2. `KEYSTONE_OS/app/pads-data.js` — données embarquées du catalogue actuel
3. `KEYSTONE_OS/app/pads-loader.js` — orchestrateur de chargement
4. `KEYSTONE_OS/app/ui-renderer.js` — rendu Key-Store actuel
5. `KEYSTONE_OS/workers/src/index.js` — router Worker actuel
6. `KEYSTONE_OS/workers/src/routes/` — handlers API existants

---

## 🛠️ Mission Phase 1 — Data Fabric + DocEngine

**Objectif :** poser les fondations techniques de la plateforme avant tout artefact métier.

### Sprint 1.1 — Data Fabric (Layer 1)

Créer `app/lib/data-fabric.js` qui unifie l'accès aux données :

```js
export const dataFabric = {
  read(entity, id, opts)         → lit D1 (via Worker) avec cache IDB
  list(entity, query)            → liste filtrée
  write(entity, payload)         → écrit local + queue cloud
  delete(entity, id)             → supprime local + queue cloud
  upload(blob, meta)             → R2 multipart si > 1 MB
  sync()                         → flush la sync queue
  onSync(callback)               → événement de sync réussie
}
```

**À faire :**
1. Installer Dexie.js via CDN (offline-graceful, pas de bundler)
2. Créer le schéma IDB local : tables miroir D1 + table `_sync_queue`
3. Créer un module `app/lib/data-fabric.js` avec l'API ci-dessus
4. Côté Worker : routes génériques `/api/data/:entity` (GET/POST/PATCH/DELETE) avec validation par entité
5. Service Worker : intercepter les requêtes API et fallback IDB si offline

**Critères d'acceptation :**
- [ ] Mutation offline → ajoutée à la queue
- [ ] Reconnexion → queue flushée automatiquement
- [ ] Lecture offline → données en cache disponibles
- [ ] Aucun artefact existant cassé (VEFA v1 doit toujours marcher)

---

### Sprint 1.2 — DocEngine (Layer 2)

Créer `app/lib/doc-engine.js` qui génère des PDF à partir de templates sanctuarisés.

**À faire :**

1. **Créer un dossier `app/lib/doc-templates/`** pour stocker les templates HTML sanctuarisés (jamais exposés à l'IA).

2. **Extraire le HTML de la notice VEFA actuelle** (probablement dans `app/artefacts/vefa/` ou similaire — à localiser) et en faire un template propre avec variables `[[NOM_VARIABLE]]`.
   - Référence visuelle : `KEYSTONE_NOTICE/Test Notice VEFA/notice_vefa_ollioules.html` (sur le Desktop utilisateur)

3. **Intégrer Paged.js** via CDN ou inline pour le rendu A4 paginé client-side.

4. **API du moteur :**
```js
import { docEngine } from './lib/doc-engine.js';

await docEngine.render({
  templateId: 'vefa-notice-v1',
  variables: { PROGRAMME: 'Bandol', CLAUSE_RE2020: '...', ... },
  mode: 'preview' | 'download' | 'html'
});
```

5. **Créer la table D1 `clauses`** : `(id, secteur, version, key, content, updated_at)`

6. **Route Worker `/api/data/clauses`** pour CRUD clauses (admin only).

7. **Méthode utilitaire** `docEngine.fillClauses(templateId, clauseSet)` qui injecte les clauses standards de la BDD avant rendu.

**Critères d'acceptation :**
- [ ] Génération PDF VEFA en moins de 3 secondes côté client
- [ ] Template HTML jamais envoyé à un LLM (sanctuarisation vérifiable)
- [ ] Variables `[[...]]` toutes remplacées (warning si en manque)
- [ ] Mode preview = aperçu pages A4 dans le navigateur
- [ ] Mode download = PDF téléchargé directement

---

## 🚦 Règles strictes pour cette phase

1. **Ne PAS toucher à Layer 0 (auth/licences/Stripe).** Cette couche est en prod, stable.
2. **Ne PAS coder PromptEngine, SVGEngine, ChartEngine, BrowserPilot** dans cette phase. Phases ultérieures.
3. **Ne PAS commencer un artefact métier** (CODEX, MUSE, SENTINELLE, SDQR). Phases ultérieures.
4. **Garder VEFA v1 fonctionnel** pendant le refactor. On migre, on ne casse pas.
5. **Tout ajout de table D1 = migration versionnée** dans `workers/migrations/`.
6. **Aucun nouveau fichier `.md` autre que ceux explicitement demandés.**

---

## 📦 Livrables attendus en fin de Phase 1

- `app/lib/data-fabric.js` — opérationnel et testé
- `app/lib/doc-engine.js` — opérationnel avec template VEFA migré
- `app/lib/doc-templates/vefa-notice-v1.html` — template sanctuarisé
- `workers/migrations/00X_clauses.sql` — schéma table clauses
- `workers/src/routes/data.js` — handlers data génériques
- VEFA v1 fonctionne toujours (régression zéro)
- Démo : générer une notice VEFA test avec 3 clauses BDD différentes

---

## 💬 Comment Stéphane travaille

- Il **valide étape par étape**, ne lance jamais 5 sprints en parallèle
- Il **veut comprendre** ce que tu fais → commente le code en français, explique les choix
- Il **teste manuellement** dans son navigateur, donc déploie sur Cloudflare au fil de l'eau
- Il **n'aime pas la sur-ingénierie** : si une feature peut attendre, attends
- Il **est honnête sur ses limites** : si tu vois qu'il s'aventure dans une mauvaise direction technique, dis-le sans détour

---

## 🎬 Premier message à envoyer

Ouvre la nouvelle conversation par :

> *« Salut Claude, je démarre la Phase 1 de Keystone OS Multi-Couches. Lis d'abord `KEYSTONE_OS/docs/ARCHITECTURE.md` pour t'imprégner de l'archi, puis `KEYSTONE_OS/docs/HANDOFF_MULTILAYER_CODING.md` pour la mission. Ensuite explore le code existant (`app/`, `workers/`) et fais-moi une synthèse de ce que tu vois avant de toucher à quoi que ce soit. On commencera par le Sprint 1.1 (Data Fabric) une fois que tu m'auras confirmé ta compréhension. »*

---

**Fin du handoff.**
