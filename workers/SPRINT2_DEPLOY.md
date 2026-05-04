# Sprint 2 — Déploiement infrastructure de sécurité

Trois actions à faire **dans l'ordre** depuis le dossier `workers/`.

## 1. Générer les deux nouveaux secrets

Ils ne doivent JAMAIS apparaître dans Git ou dans le Worker.
Génère 32 bytes aléatoires pour chacun :

```bash
# JWT secret (signature HS256)
openssl rand -hex 32 | npx wrangler secret put KS_JWT_SECRET

# Lookup pepper (HMAC blind index sur les clés de licence)
openssl rand -hex 32 | npx wrangler secret put KS_LOOKUP_PEPPER
```

Vérifie qu'ils sont bien posés :
```bash
npx wrangler secret list
```
Tu dois voir `KS_ADMIN_SECRET`, `KS_ENCRYPTION_KEY`, `KS_JWT_SECRET`, `KS_LOOKUP_PEPPER`.

## 2. Migrer la base D1

```bash
# Remote (production)
npx wrangler d1 execute keystone-os --file=./src/db/migration_sprint2.sql

# Local (test)
npx wrangler d1 execute keystone-os --local --file=./src/db/migration_sprint2.sql
```

La migration est idempotente (utilise `IF NOT EXISTS` / `ADD COLUMN`),
donc tu peux la rejouer sans risque.

## 3. Déployer le Worker

```bash
npx wrangler deploy
```

Tu dois voir `keystone-os-api.keystone-os.workers.dev` dans la sortie.

## 4. Seeder la clé DEMO en base

La clé `DEMO-KEYS-TONE-2026` n'est plus en dur dans `index.html`.
Il faut la créer côté backend :

```bash
# Via l'endpoint admin (avec le KS_ADMIN_SECRET)
curl -X POST https://keystone-os-api.keystone-os.workers.dev/api/licence/activate \
  -H "Authorization: Bearer $KS_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "key":   "DEMO-KEYS-TONE-2026",
    "owner": "Démo publique",
    "plan":  "DEMO"
  }'
```

Le format `XXXX-XXXX-XXXX-XXXX` est validé. La clé sera ensuite
hashée à la volée la première fois qu'un utilisateur l'active
(migration paresseuse via `licence-public.js`).

## 5. Variables côté client

Aucune. Le client utilise `KEYSTONE_API` déjà hardcodée
(`keystone-os-api.keystone-os.workers.dev`).

## Checklist post-déploiement

- [ ] `wrangler secret list` montre les 4 secrets
- [ ] `npx wrangler d1 execute keystone-os --command="SELECT name FROM sqlite_master WHERE type='table'"`
      montre la table `activation_attempts`
- [ ] `npx wrangler d1 execute keystone-os --command="PRAGMA table_info(licences)"`
      montre les colonnes `lookup_hmac`, `key_hash`, `salt`,
      `device_fingerprint`, `activated_at`
- [ ] Test d'activation depuis la landing avec la clé DEMO :
      le retour contient un `jwt` et plus de `licence`
- [ ] Inspecter `localStorage` après activation : présence de
      `ks_jwt`, absence de `ks_licence`

## Sécurité — ce qui est désormais impossible

1. **Lire la liste des clés via Inspecter l'élément** ❌
   La clé DEMO n'est plus dans `index.html`. Aucune comparaison
   de chaîne en JS. Le seul endroit où elle existe en clair est
   le serveur D1 (puis hashée à la première activation).

2. **Brute-forcer une clé depuis un seul appareil** ❌
   10 tentatives → lock 24h. Avant : 2^attempts secondes
   (1s, 2s, 4s, 8s… jusqu'à 1h).

3. **Réutiliser une clé sur plusieurs appareils** ❌
   (sauf plan DEMO qui reste multi-device pour les commerciaux).
   Au-delà de la première activation, la fingerprint est gravée.

4. **Falsifier un JWT** ❌
   Signature HS256 avec secret 32 bytes côté serveur uniquement.

## Limites connues / améliorations futures

- **Argon2id vs PBKDF2** : on utilise PBKDF2-SHA256 600k itérations
  faute d'Argon2id natif dans Workers. Pour des clés à haute entropie
  (UUIDv4, 122 bits), c'est cryptographiquement équivalent. Migration
  vers `@noble/hashes` Argon2id possible si besoin (à intégrer via
  un build esbuild — ~50 KB gzipped).

- **Device fingerprint** : la stabilité dépend des navigateurs. Sur
  iOS, le canvas anti-fingerprinting (Safari 17+) peut générer des
  fingerprints subtilement différents. Si tes utilisateurs perdent
  leur binding, l'admin peut les reset via une route à ajouter
  (`/api/admin/licence/unbind`).

- **Rotation du JWT** : actuellement TTL 30j. Pour une rotation
  silencieuse, ajouter un endpoint `/api/licence/v2/refresh` qui
  ré-émet un JWT si le précédent est encore valide.
