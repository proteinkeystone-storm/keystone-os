# img/*.png + le logo → assets.py (base64) : le HTML reste autoportant,
# donc le PDF ne dépend d'aucun chemin de fichier au moment de l'impression.
import base64, pathlib
root = pathlib.Path(__file__).resolve().parents[2]
out = {'logo': "data:image/svg+xml;base64," +
       base64.b64encode((root / "keystone-logo.svg").read_bytes()).decode()}
for i, p in enumerate(sorted(pathlib.Path(__file__).parent.glob("img/capture-*.png")), 1):
    out[f'cap{i}'] = "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()
pathlib.Path(__file__).with_name("assets.py").write_text("ASSETS = " + repr(out))
print("assets :", {k: len(v) // 1024 for k, v in out.items()}, "Ko")
