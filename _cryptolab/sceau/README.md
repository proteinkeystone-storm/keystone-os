# SCEAU — cryptolab S0 (jetable, hors prod)

Preuve que la voie OPRF tient. Voir `../../SCEAU_CRYPTO_SPEC.md` (spec gelée).

```bash
npm install && node harness.mjs
```

Prouve : création serveur-aveugle, lecture bon code OK, 3 mauvais codes → tag AES-GCM
rejeté, mort de la clé OPRF au 3e, bon code refusé après mort (irrécupérable).

⚠ Aucune dépendance avec le code Keystone. Ne pas déployer. Ne pas importer en prod.
