# 🚀 SEPT_PROD_SPRINTS — Durcissement production & activation (mise en prod réelle septembre 2026)

> **Brief autoporté** — issu de l'audit + échange stratégique du 2026-07-13 (Stéphane + Claude).
> Trois axes validés par Stéphane : **1. Plomberie de production (OPS)** · **2. Activation / essai scénarisé (ONB)** · **3. Balayage gating avant encaissement (GAT)**.
> Chaque sprint ≈ une session, livrable vérifiable, 100 % additif (aucune refonte des pads existants — leçon gravée : ne pas toucher aux outils qui marchent).
> À lire avec `MANIFESTE_NOUVELLE_APP.md` (charte §12, sécurité §13, deploy §14).

---

## Axe 1 — OPS · La plomberie ennuyeuse qui sauve un lancement

> Constat d'audit : un seul worker porte tout (dont Key Form prod-critique), une seule D1 sans sauvegarde à nous, personne ne surveille Keystone lui-même. Rien n'est long à faire ; tout est de l'assurance.

| Sprint | Livrable | Contenu | Effort |
|---|---|---|---|
| **OPS-1 — Sauvegardes D1** | Export hebdo automatique → R2 | Cron worker (réutiliser le dispatch `scheduled()` existant, nouvelle expression hebdo `0 4 * * 1`) qui exporte en JSON/NDJSON les tables VITALES : licences/owned_assets, réponses Key Form (`pulsa_*`), `entities` (QR), `dk_*`, `nk_*`, `kb_*`, `sec_secrets` (métadonnées seules — jamais les payloads chiffrés inutiles), vers un bucket R2 dédié `keystone-backups` (préfixe date, rétention 8 semaines, purge auto). + commande de RESTAURATION documentée dans le fichier (un backup qu'on n'a jamais restauré n'existe pas : test de restore sur wrangler dev local = critère de done). ⚠ D1 time-travel 30 j existe déjà = 1re ligne de défense ; ceci est la 2e (hors-plateforme). | 1 session |
| **OPS-2 — Sentinelle de soi** | Keystone surveille Keystone | Cron 5 min existant (`*/5 * * * *`) : ajouter un self-check qui pinge la landing Vercel + `GET /api/desk/health` (+ 2-3 healths représentatifs) DEPUIS le worker, état en D1 (`ops_health`), **e-mail Resend à Stéphane après 2 échecs consécutifs** (anti-flap), un e-mail de rétablissement. ⚠ le worker ne peut pas se pinger lui-même de façon fiable pour TOUT diagnostiquer (si le worker est mort, le cron l'est aussi) → compléter par la brique inverse GRATUITE : un moniteur externe simple (UptimeRobot free / cron GitHub Actions) sur 2 URLs — à poser par Stéphane, 10 min, doc dans le sprint. Bonus vitrine : ces checks nourrissent la future page `/status` (backlog trust). | 1 session |
| **OPS-3 — Smoke-prod automatisé** | `npm run smoke:prod` en 30 s | Script Node qui rejoue TOUTE la batterie manuelle post-deploy : santés (desk/network/keybrand/sentinel/sceau/social/agent…), gardien QR (`scans_total` stable avant/après), 401 sans JWT sur les routes gatées, landing 200, SW version attendue (argument `--sw v5.28.x`), assets clés 200. Sortie VERT/ROUGE une ligne par check, exit code ≠ 0 si rouge. S'utilise : `wrangler deploy && npm run smoke:prod`, et après chaque push front. (C'est l'automatisation de ce que Claude fait à la main à chaque deploy — le rendre systématique et indépendant de la session.) | 1 session |
| **OPS-4 — CI minimale** *(optionnel, après 1-3)* | GitHub Action sur push | `node --check` sur tous les `app/*.js` + suites worker (dk2/3/4/5-board + sceau + brand-extract) sur `wrangler dev --local` en CI. Bloque un push main cassé AVANT Vercel. ⚠ package-lock gitignoré → l'action fait `npm install` ; vars de test = celles des suites. | 1 session |

> **✅ OPS-4 CONSTRUIT (2026-07-15) — `.github/workflows/ci.yml`, à ACTIVER (commit+push).** 3 jobs parallèles : **syntax** (`node --check` sur app/scripts/workers/src — 271 fichiers, le filet le plus rentable car le front n'a AUCUN build qui valide la syntaxe), **unit** (sceau.test + brand-extract.test, autonomes SQLite en mémoire, sans worker), **e2e** (8 suites : dk2/3/4/5-board + artcasier + newsignal + backup-restore + ops-health, contre un `wrangler dev --local` unifié `KS_JWT_SECRET:dk2-test-secret`/`KS_ADMIN_SECRET:dk4-admin`, migrations appliquées, bk-tests alignés via `BK_JWT_SECRET`/`BK_ADMIN`). Node 24 (pour `node:sqlite` sans flag). `npm install` (package-lock gitignoré). Entièrement dé-risqué en local avant livraison : 271 `node --check` OK, unitaires OK, **183 assertions E2E vertes en séquence**. Activation = commit `.github/workflows/ci.yml` + push (le 1er run sur une PR le prouve en réel).

**Ordre conseillé : OPS-3 → OPS-1 → OPS-2 → OPS-4.** (Le smoke d'abord : il sécurise tous les deploys suivants, y compris ceux de ces sprints.)

---

### ✅ OPS-1 — LIVRÉ (2026-07-15) · runbook sauvegardes & restauration

**Code :** `workers/src/routes/backup.js` (module `runBackup` + endpoints admin), câblé dans `index.js` (cron `0 4 * * 1` + 4 routes admin), bindings dans les deux `wrangler.toml`. Test E2E : `workers/test/test-backup-restore.mjs` (19/19, restore prouvé + zéro fuite crypto Sceau).

**Tables vitales sauvegardées** (NDJSON, 1 objet JSON/ligne) : `licences`, `pulsa_forms`, `pulsa_responses`, `entities` + `qr_redirects` (QR : définitions **et** cibles de redirection hot-path), `dk_*` (13), `nk_*` (3), `kb_*` (3), `sec_secrets` **métadonnées seules** (jamais `ciphertext`/`iv`/`oprf_*` — inutiles E2E, serveur aveugle). Une table absente/vide n'avorte pas le backup (try/catch par table, prouvé en live).

**Où :** bucket R2 `keystone-backups`, clés `AAAA-MM-JJ/<table>.ndjson` + `AAAA-MM-JJ/_manifest.json`. Rétention **8 semaines** (purge auto en fin de run). Observabilité : `system_meta.last_backup_at` (lisible par OPS-2 / futur `/status`).

**⚠ PRÉ-DEPLOY (Stéphane, une fois) :** créer le bucket AVANT `wrangler deploy` sinon il échoue —
```
npx wrangler r2 bucket create keystone-backups
```
(Le worker dégrade proprement si le binding manque : no-op loggué, aucun crash.)

**Déclenchement :** automatique lundi 4h UTC. À la demande (admin) :
```
curl -X POST https://keystone-os-api.keystone-os.workers.dev/api/admin/backup/run \
  -H "Authorization: Bearer $KS_ADMIN_SECRET"
```

**RESTAURATION** — deux chemins, tous deux testés/documentés :

1. **Opérationnel (recommandé) — endpoint admin, idempotent (`INSERT OR REPLACE`)** :
```
# lister les sauvegardes disponibles
curl -H "Authorization: Bearer $KS_ADMIN_SECRET" \
  https://keystone-os-api.keystone-os.workers.dev/api/admin/backup/list
# restaurer UNE table depuis une date (confirm obligatoire)
curl -X POST https://keystone-os-api.keystone-os.workers.dev/api/admin/backup/restore \
  -H "Authorization: Bearer $KS_ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{"date":"2026-07-13","table":"licences","confirm":true}'
```
Ne restaure que les colonnes présentes dans le backup ; pour `sec_secrets`, ne rétablit que les métadonnées (le chiffré reste détruit — serveur aveugle, voulu).

2. **Hors-worker (paranoïaque / worker HS) — via wrangler R2 + D1** :
```
# télécharger un dump
npx wrangler r2 object get keystone-backups/2026-07-13/licences.ndjson --file=licences.ndjson
# le convertir en INSERT OR REPLACE et l'appliquer à D1
#   (NDJSON = 1 objet/ligne ; générer le SQL puis :)
npx wrangler d1 execute keystone-os --remote --file=restore-licences.sql
```

**Critère de done atteint :** restore testé bout-en-bout sur `wrangler dev --local` (seed v=1 → backup → mutation v=2 → restore → objet revenu à v=1).

---

### ✅ OPS-2 — LIVRÉ (2026-07-15) · sentinelle de soi + moniteur externe

**Code :** `workers/src/routes/ops-health.js` (`runSelfCheck` + 2 endpoints admin), câblé dans le dispatch cron `*/5 * * * *` de `index.js`. Test : `workers/test/test-ops-health.mjs` (12/12, machine anti-flap prouvée).

**Ce que ça fait (brique INTERNE) :** toutes les 5 min, le worker vérifie la landing Vercel (`/`, vrai fetch externe) + 3 santés représentatives (desk, smart-agent, sentinel) appelées **EN INTERNE (in-process)**, garde l'état dans D1 (`ops_health`), et **e-mail Resend à Stéphane après 2 échecs consécutifs** (anti-flap : rien au 1er échec, alerte au franchissement, PAS de ré-alerte tant que ça reste down, puis **e-mail de rétablissement** au retour). Observabilité : `GET /api/admin/ops-health` (nourrira `/status`). Test du pipeline sans panne : `POST /api/admin/ops-health/run-now {"simulate":"down"|"up"}`.

> ⚠ **Piège corrigé le 2026-07-15 (faux positif en prod) :** la 1re version pingait ses propres santés en **self-HTTP** (`fetch` vers `keystone-os-api.…workers.dev/api/*/health`). Or **un worker ne re-route PAS fiablement une requête vers son propre hostname workers.dev → 404**, alors que les mêmes URLs répondent 200 en externe. Résultat : alerte « desk/smart-agent/sentinel KO 404 » alors que tout allait bien. Fix = appeler les handlers de santé **en interne** (in-process, ce qui exerce aussi leur schéma D1). La landing reste un vrai fetch (origine externe = OK). Règle générale : **ne jamais faire un worker se fetch lui-même par son URL publique.**

**Variables d'env (worker) — toutes optionnelles, défauts sains :**
- `KS_RESEND_KEY` (secret) — **requise pour recevoir les e-mails** (sinon la sentinelle tourne mais reste muette, loggué). Déjà utilisée par les autres e-mails Keystone.
- `KS_OPS_ALERT_EMAIL` — destinataire des alertes (défaut `protein.keystone@gmail.com`).
- `KS_OPS_FAIL_THRESHOLD` — nb d'échecs consécutifs avant alerte (défaut `2`).
- `KS_WORKER_URL` / `KS_LANDING_URL` — bases surveillées (défauts = prod). À laisser vides en prod.

**⚠ Brique EXTERNE (filet « worker totalement mort ») — À POSER PAR STÉPHANE, ~10 min, hors-code :**
Un worker mort ne se pinge pas lui-même (le cron est mort aussi). Il faut un œil DEHORS. Le plus simple, gratuit, sans code :
- **UptimeRobot (free)** → créer 2 moniteurs HTTP(s), intervalle 5 min, alerte e-mail :
  1. `https://protein-keystone.com/` (attendu 200)
  2. `https://keystone-os-api.keystone-os.workers.dev/api/desk/health` (attendu 200)
- *Alternative en-repo* : un cron GitHub Actions (`.github/workflows/uptime.yml`, `schedule: */5`) qui `curl -f` ces 2 URLs et échoue (→ e-mail GitHub) si l'une répond ≠ 200. À privilégier si tu veux tout versionné.

Les deux briques sont complémentaires : l'INTERNE voit les pannes partielles fines (un pad HS, la landing HS) ; l'EXTERNE voit la mort totale du worker. Ni l'une ni l'autre seule ne suffit.

**Critère de done atteint :** machine à états anti-flap testée sur `wrangler dev --local` (down→consecutive=1 sans alerte → 2e down=alerte → 3e down sans ré-alerte → up=rétablissement+reset) ; dispatch cron 5 min prouvé.

---

## Axe 2 — ONB · L'essai scénarisé (le premier quart d'heure)

> **Note de cadrage de Stéphane (2026-07-13, gravée)** : *« Ne pas laisser l'utilisateur qui arrive en mode essai seul. Scénariser son parcours : 1 jour / une ou deux applications testées, avec exemple et accompagnement. Pas simplement le laisser essayer n'importe quoi n'importe comment. »*
>
> Traduction produit : l'essai n'est PAS un catalogue en libre-service, c'est une **visite guidée** — un jour, un métier, DEUX pads max, des données d'exemple déjà en place, un fil qui parle. Le libre-service reste possible (bouton discret « explorer librement ») mais n'est plus le chemin par défaut.

### Principes (à trancher AVANT ONB-1, cf. Décisions)
- **Le métier d'abord** : à l'arrivée en essai, on demande UNE chose — « quel est votre métier ? » (réutiliser les 14 verticales de `gen-vertical-pages.mjs`, celles des pages `/pour/`). Le métier choisit les 2 pads et l'exemple.
- **Deux pads, pas quinze** : chaque métier a sa « mission du jour » (ex. commerçant : un QR carte de visite + un mini Key Form avis clients ; artisan : une mini-charte Key Brand + le QR qui la partage ; consultant : Brainstorming → Ghost Writer). Mapping = table de données, pas du code par métier.
- **Exemple pré-chargé, jamais un champ vide** : la mission s'ouvre sur du contenu réaliste du métier (mécanisme `opts.prefillData`/prefill existants — zéro modif des pads), l'utilisateur MODIFIE au lieu de créer à froid.
- **Un fil visible** : le rail ①②③ de `content-chain.js` (déjà réutilisable, tokens DS) affiché en tête de dashboard pendant la mission — « ① Votre QR → ② Votre formulaire → ③ Partagez ». Chaque étape cochée à l'action réelle.
- **L'accompagnement parle** : le Living Layer (messages pilotables existants + un mode `onboarding` client) porte la voix du guide : « Bienvenue — votre carte de visite QR vous attend », puis félicite à chaque étape (sobre, charte : jamais de « Bravo champion »).
- **Le jour 2 existe** : à J+1, UN e-mail Resend (pattern relances desK : gabarit déterministe, from `KS_RESEND_FROM`) : « Hier vous avez créé X — voici les 2 minutes qui le rendent utile » + lien direct. Un seul, jamais de séquence harcelante.

| Sprint | Livrable | Contenu | Effort |
|---|---|---|---|
| **ONB-0 — Scénarios & maquette** (GATE) | Harnais `_design-lab/onboarding-harness.html` | Les 3-4 missions métier prioritaires écrites MOT À MOT (écran métier, contenu d'exemple par pad, textes du rail et du Living Layer, e-mail J+1) + maquette cliquable du parcours (écran métier → mission → rail → fin de mission). **Validation Stéphane sur desktop ET iPhone avant tout code** (pattern DK-0/networK : on itère dans le harnais, pas dans l'app). | 1 session |
| **ONB-1 — Le parcours dans l'app** | Mode essai scénarisé | Au 1er login essai (flag `ks_onb_v1` absent + licence trial/demo) : écran métier (14 verticales, pictos `icon()`) → pose la mission (table `ONB_MISSIONS` dans un module data, PAS de code par métier) → rail en tête de dashboard (réutilise content-chain) → chaque pad de la mission s'ouvre pré-rempli via `openTool(id, {prefillData…})` existant → détection d'étape accomplie (événements déjà émis : création QR/form/charte) → écran de fin sobre (« Votre premier outil est en ligne ») + bouton « explorer librement ». Échappatoire permanente ; jamais re-imposé (flag). 100 % additif : `app/lib/onboarding.js` + data, AUCUNE modif des pads. | 2 sessions |
| **ONB-2 — L'accompagnement vivant** | Living Layer + J+1 | Mode `onboarding` du Living Layer (client : messages du fil selon l'étape, priorité douce, se retire à la fin) + e-mail J+1 côté worker (cron quotidien existant `0 3 * * *` : licences trial créées la veille avec mission inachevée OU achevée → gabarit correspondant, table `onb_emails` anti-doublon, plafond global/jour). Opt-out = lien dans l'e-mail (RGPD). | 1 session |
| **ONB-3 — La boucle de mesure** *(après lancement)* | Savoir où ça casse | 4 compteurs anonymes (métier choisi, mission commencée/achevée, jour-2 revenu) → table D1 + lecture dans Admin (à côté de Satisfaction). Pas d'analytics tiers — souverain, agrégats seuls. | 1 session |

**GATE dur : ONB-0 se valide sur harnais avant ONB-1** (c'est l'écran le plus vu de tout Keystone en septembre — il se joue là).

---

## Axe 3 — GAT · Le balayage gating avant le premier euro

> Constat : plusieurs pads récents portent « gating/prix à la mise en boutique » (desK, booK, networK…). Avant d'encaisser : aucune route sensible ne doit servir un plan qui n'y a pas droit — et le catalogue doit dire la vérité.

| Sprint | Livrable | Contenu | Effort |
|---|---|---|---|
| **GAT-1 — La matrice** (GATE) | Un tableau, pas du code | Inventaire automatique (script) : pour CHAQUE pad → routes worker associées, gating serveur actuel (aucun / JWT seul / plan), gating front (owned_assets), prix catalogue actuel. Sortie = `GATING_MATRIX.md` avec les TROUS surlignés. **Puis décision Stéphane case par case : quel pad dans quel plan (Starter 49 / Pro 99 / Max 249).** Le code attend la matrice signée. | 1 session |
| **GAT-2 — L'enforcement** | Le serveur dit non | Helper unique `requirePlan(claims, padId)` (lit la même source que le front : owned_assets/plan du JWT + bypass ADMIN) posé sur les routes des pads gatés selon la matrice. Réponse 403 propre et uniforme (`{error:'plan'}`) que le front sait afficher (« Disponible dans le plan Pro » → K-Store). Tests : par pad gaté, 1 appel plan-inférieur → 403, plan-correct → 200 (batterie ajoutée au smoke OPS-3). ⚠ prod-critiques (Key Form, Smart Agent public, SDQR scan public) : routes PUBLIQUES par nature — ne JAMAIS les gater par erreur (liste blanche explicite dans le helper). | 1-2 sessions |
| **GAT-3 — La vitrine alignée** | Boutique = réalité | K-Store : prix/plan affichés depuis la matrice (une seule source de vérité), badges plan sur les fiches pads, sync Admin Catalogue. + passe sur les 3 Payment Links Stripe (contenu des plans à jour) et la ligne CGV « ce que contient chaque plan » (page trust existante). | 1 session |

---

## Ordre global recommandé (6 semaines large avant septembre)

1. **OPS-3** (smoke — sécurise tout le reste) → **OPS-1** (backups) → **OPS-2** (sentinelle de soi)
2. **ONB-0** (harnais, GATE Stéphane) → **ONB-1** → **ONB-2**
3. **GAT-1** (matrice, GATE Stéphane) → **GAT-2** → **GAT-3**
4. Optionnels ensuite : OPS-4 (CI), ONB-3 (mesure)

Total cœur : **~10 sessions.** Chaque sprint est indépendamment livrable — on peut intercaler du dogfood desK ou un correctif à tout moment.

## Décisions attendues de Stéphane (rien ne bloque OPS)
1. **ONB** : les 3-4 métiers prioritaires du lancement (sur les 14) et leur mission (validés à ONB-0 sur maquette).
2. **ONB** : l'adresse d'envoi du J+1 (domaine : redaction-pks.com existant ? un `bonjour@` dédié ? — Resend multi-domaine OK).
3. **GAT** : la matrice pad×plan (à GAT-1, sur tableau prêt à cocher).

---
*Brief vivant — cadré le 2026-07-13. « go OPS-3 » (ou tout autre id) lance le sprint correspondant.*
