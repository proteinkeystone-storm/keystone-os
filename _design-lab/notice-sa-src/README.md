# Notice Smart Agent — source régénérable

L'édition du 16/07/2026 n'avait **aucune source** : le PDF avait été produit une
fois, la mise en page perdue. Résultat, la notice a pris deux séries de retard
(SA-14 et SA-15) et annonçait encore « fichier jusqu'à 8 Mo », devenu faux.

D'où ce dossier. La prochaine mise à jour est une édition de texte, pas une refonte.

## Régénérer

```bash
cd _design-lab/notice-sa-src
python3 encode.py          # img/*.png + keystone-logo.svg → assets.py (base64)
python3 notice-sa.py       # → NOTICE_SMART_AGENT.html (autoportant)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="NOTICE_SMART_AGENT.pdf" "file://$PWD/NOTICE_SMART_AGENT.html"
```

Puis copier le PDF dans `PROTEIN STUDIO/CLD-AI/KEYSTONE/Notices/`.

## Le piège de la pagination

Les pages ont une **hauteur fixe** (`.page`, 297 mm) : ce qui dépasse est coupé
**en silence** à l'impression — rien ne le signale. Après toute modification,
servir le HTML et mesurer :

```js
const mm = 96 / 25.4;
[...document.querySelectorAll('.page')].map((p, i) => {
  const k = [...p.children].filter(c => !c.classList.contains('folio'));
  const bas = Math.max(...k.map(c => c.getBoundingClientRect().bottom));
  return { p: i + 1, fin: Math.round((bas - p.getBoundingClientRect().top) / mm) };
}).filter(x => x.fin > 281);   // doit rendre []
```

Viser 170–275 mm par page. Sous 150, fusionner avec la suivante.

## Captures

`img/` contient les six captures de l'édition du 16/07, extraites du PDF. Pour
les refaire, ouvrir `_design-lab/sa-notice-harness.html` (il simule l'API avec
des données de démonstration, aucun backend requis) et photographier les écrans.

## La capture des planches (capture-7)

Les six premières captures viennent du pad réel via `sa-notice-harness.html`.
La septième — la relecture avec les planches — ne pouvait pas en venir : l'état
`_ig` est privé au module, on ne peut pas l'injecter de l'extérieur. Elle est
donc produite par `harnais-planches.html`, qui reproduit **le balisage exact**
émis par `_igRenderReview()` en chargeant la vraie CSS du pad.

⚠ **Si `_igRenderReview()` change, ce harnais doit changer avec lui** — sinon la
notice montrera une interface qui n'existe plus.

Le document illustré de la capture est fabriqué par `demo-doc.py` : une notice
de montage « Atelier Lumen », dans l'univers de démonstration déjà utilisé par
les autres captures. **Ne jamais utiliser un document client réel** pour une
capture de notice : elle part chez tous les clients.

```bash
python3 demo-doc.py     # → demo-lumen.pdf + planche-demo-*.png
# puis servir harnais-planches.html et photographier :
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=860,1100 --screenshot="img/capture-7-planches.png" \
  "http://localhost:3003/_design-lab/.tmp-capture.html"
```
