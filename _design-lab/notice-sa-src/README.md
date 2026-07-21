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
