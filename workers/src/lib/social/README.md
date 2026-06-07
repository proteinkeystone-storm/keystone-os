# Social Broadcast — moteur de diffusion réseaux sociaux

Socle **générique et extensible**. Le pad *Social Manager* produit un
**post canonique** (format neutre) ; le moteur le diffuse via un **adapter
par réseau**. Le moteur et l'UI ne connaissent aucun réseau en dur — ils
lisent le **registre** de capacités.

## Fichiers
| Fichier | Rôle |
|---|---|
| `registry.js` | Fiches de capacités déclaratives (1 par réseau) + validation par plateforme. |
| `canonical.js` | Le post canonique (format neutre) + normalisation/validation. |
| `broadcast.js` | Le contrat d'adapter (`SocialAdapter`) + le dispatcher `broadcast()`. |
| `adapters/*.js` | 1 fichier par réseau : transforme le canonique → API du réseau. |
| `schema.js` | Auto-migration D1 (`social_accounts`, `social_posts`). |

## Ajouter un réseau (TikTok, X, Threads, Bluesky…)
1. **Registre** — ajouter une fiche dans `registry.js › PLATFORMS` (capacités, OAuth, endpoint, versioning).
2. **Adapter** — créer `adapters/<reseau>.js` exportant un objet `adapter` conforme à `SocialAdapter` (`formatPost`, `uploadMedia`, `publish`, `refreshToken`).
3. **Brancher** — ajouter l'adapter à la table `ADAPTERS` de `broadcast.js`.

Aucune autre modification : routes, moteur et UI s'adaptent automatiquement.

## Tester sans credentials (dry-run)
```js
import { broadcast } from './broadcast.js';
import { createCanonicalPost } from './canonical.js';

const post = createCanonicalPost({ text: 'Bonjour LinkedIn', hashtags: ['immo'] });
const out  = await broadcast({ canonical: post, targets: ['linkedin'], env, dryRun: true });
// → [{ platform:'linkedin', status:'dry-run', payload:{ commentary:'Bonjour LinkedIn\n\n#immo', … } }]
```
`dryRun:true` exécute tout SAUF l'appel réseau et renvoie le payload qui *serait* envoyé.

## État (Sprint Social-0)
- **Texte** : ✅ formatage + publication LinkedIn (profil) prêts pour le spike.
- **Médias** : ⏳ Sprint Social-1 (upload R2 + register-upload LinkedIn / containers IG).
- **Facebook / Instagram** : fiches présentes, `enabled:false` → adapters au Sprint Social-1.

## Sécurité
Les tokens OAuth sont chiffrés **AES-256-GCM** via `../crypto.js` (mêmes garanties
que `api_keys_vault`) et stockés dans `social_accounts` — jamais en clair.
