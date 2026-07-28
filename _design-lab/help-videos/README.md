# Atelier vidéos d'aide — captures scénarisées régénérables

Une vidéo d'aide par application (bouton « ? ») : capture nue de
l'app pilotée par un scénario, bandeau d'étapes en pied, carton
d'ouverture Keystone + nom/picto de l'app, carton de fin. MP4 muet
~25 s, 1280×800, ~350 Ko. Stéphane uploade chaque vidéo dans son
admin (hébergement R2) — les MP4 ne se committent PAS ici.

## Régénérer une vidéo

```bash
cd _design-lab/help-videos
python3 film.py tournage-missive.html \
  "$HOME/Desktop/Videos_Aide_Keystone/Aide_Missive.mp4"
```

Convention : les MP4 finaux vont dans
`~/Desktop/Videos_Aide_Keystone/` — c'est là que Stéphane les
récupère pour l'upload admin.

Dépendances (une fois) : `pip3 install websocket-client imageio-ffmpeg`
(ffmpeg est embarqué par imageio-ffmpeg — rien à installer d'autre).

## Architecture

- `film.py` — le réalisateur : lance un serveur HTTP (racine repo,
  port 3010) + Chrome headless (CDP 9333), fait avancer le scénario
  **image par image** (`window.__film.tick(t)` → screenshot), pipe
  les PNG dans ffmpeg. Déterministe : l'animation est une pure
  fonction du temps, pas de course.
- `tournage.js` — le décor in-page : curseur animé, bandeau
  d'étapes, cartons intro/outro, moteur du DSL (moveTo/click/type/
  select/waitFor/caption…). Voir l'en-tête du fichier pour le DSL.
- `tournage-<app>.html` — la scène : charge le pad réel + ses CSS,
  stubbe son API (`window.fetch`) pour dérouler le parcours sans
  backend ni écriture en prod, recale les `./LOGOS/…` relatifs.
- `scenario-<app>.js` — la mise en scène (steps + meta nom/picto).
- `fake-voprf.js` — spécifique Missive : le bundle voprf n'expose
  pas le serveur → import map vers ce faux module (sortie
  déterministe), le flux UI réel se déroule intégralement.

## Pièges appris (ne pas re-payer)

- **CDP 403 au handshake WebSocket** → Chrome exige
  `--remote-allow-origins=*`.
- **urllib applique le proxy système même sur 127.0.0.1** →
  `ProxyHandler({})` obligatoire, sinon « CDP injoignable ».
- **Un service worker de l'app enregistré sur le port du serveur
  local sert de VIEUX modules** → film.py utilise un profil Chrome
  jetable (`--user-data-dir` temporaire), jamais le profil courant.
- Le pad ouvre sur SA vue d'accueil (liste vide, pas la création) :
  le scénario doit cliquer le vrai bouton (meilleure vidéo, du reste).
- `navigator.clipboard` est stubbé dans la scène (pas de permission
  en headless — le clic « copier » doit montrer son ✓).

## Les 14 applications (une vidéo à la fois)

Missive ✓ · Smart Dynamic QR ✓ · Brief Prod ✓ · Brainstorming ✓ ·
Key Form ✓ · Social Manager ✓ · Smart Agent ✓ · Keynapse ✓ · Sentinel ✓ ·
Ghost Writer ✓ · booK · desK ✓ · networK · Key Brand
(Kora : pas de notice dans l'OS — exclu, décision Stéphane 28/07/2026.)
