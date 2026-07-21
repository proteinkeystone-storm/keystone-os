# Document de démonstration pour la capture de la notice : une notice de
# montage illustrée, dans l'univers « Atelier Lumen » déjà utilisé par les
# autres captures. Pages numérotées, photos numérotées, renvois « - Photo N »
# — exactement la structure que les planches servent à exploiter.
import fitz

NAVY, INK, GREY, LINE = (0.10,0.12,0.20), (0.18,0.20,0.26), (0.55,0.58,0.64), (0.85,0.87,0.90)
ACC = (0.31,0.27,0.90)

PAGES = [
    ("Suspension Lumen 40 — montage", [
        "Vérifier la présence des trois pièces avant de commencer :",
        "la platine de plafond, le câble textile et l'abat-jour.",
        "1. Couper l'alimentation au tableau électrique.",
        "2. Dévisser l'ancienne platine - Photo 1.",
    ], 1, "Platine de plafond"),
    ("Fixation de la platine", [
        "1. Présenter la platine contre le plafond et repérer les",
        "   deux points de perçage - Photo 2.",
        "2. Percer avec un foret de 6 mm, poser les chevilles.",
        "3. Visser sans forcer : la platine doit affleurer.",
    ], 2, "Repérage des perçages"),
    ("Raccordement électrique", [
        "1. Relier le fil bleu au neutre (N), le brun à la phase (L).",
        "2. Le fil vert et jaune va à la terre - Photo 3.",
        "3. Refermer le domino et le loger dans la platine.",
    ], 3, "Bornier de raccordement"),
    ("Réglage de la hauteur", [
        "1. Faire coulisser le serre-câble jusqu'à la hauteur voulue.",
        "2. Hauteur recommandée au-dessus d'une table : 75 cm - Photo 4.",
        "3. Serrer la bague, poser l'abat-jour, remettre le courant.",
    ], 4, "Hauteur au-dessus de la table"),
]

def lamp(p, r, n):
    """Un croquis de suspension, simple et lisible en vignette."""
    cx = (r.x0 + r.x1) / 2
    p.draw_line(fitz.Point(cx, r.y0 + 18), fitz.Point(cx, r.y0 + 74), color=INK, width=1.4)
    p.draw_rect(fitz.Rect(cx - 26, r.y0 + 8, cx + 26, r.y0 + 20), color=INK, fill=(0.92,0.93,0.96), width=1.2)
    p.draw_polyline([fitz.Point(cx - 46, r.y0 + 132), fitz.Point(cx - 26, r.y0 + 74),
                     fitz.Point(cx + 26, r.y0 + 74), fitz.Point(cx + 46, r.y0 + 132)],
                    color=INK, fill=(0.98,0.95,0.86), width=1.5, closePath=True)
    p.draw_circle(fitz.Point(cx, r.y0 + 150), 11, color=(0.85,0.72,0.30), fill=(1,0.95,0.75), width=1.2)
    # Pastille du numéro de photo, comme sur un vrai manuel.
    p.draw_circle(fitz.Point(r.x1 - 20, r.y1 - 20), 11, color=None, fill=ACC)
    p.insert_text(fitz.Point(r.x1 - 24, r.y1 - 16), str(n), fontname="hebo", fontsize=12, color=(1,1,1))

doc = fitz.open()
for i, (titre, lignes, n, legende) in enumerate(PAGES, 1):
    p = doc.new_page(width=420, height=595)          # ~A5, comme un manuel
    p.insert_text(fitz.Point(40, 44), str(i + 11), fontname="helv", fontsize=9, color=GREY)
    p.insert_text(fitz.Point(40, 74), titre, fontname="hebo", fontsize=15, color=NAVY)
    p.draw_line(fitz.Point(40, 86), fitz.Point(380, 86), color=LINE, width=1)
    y = 112
    for l in lignes:
        p.insert_text(fitz.Point(40, y), l, fontname="helv", fontsize=9.5, color=INK); y += 17
    box = fitz.Rect(40, y + 16, 380, y + 196)
    p.draw_rect(box, color=LINE, fill=(0.975,0.978,0.985), width=1)
    lamp(p, box, n)
    p.insert_text(fitz.Point(40, box.y1 + 18), f"Photo {n} — {legende}", fontname="heit", fontsize=8.5, color=GREY)
doc.save("demo-lumen.pdf")

# Rasterisation : c'est exactement ce que le pad produit sur le poste.
d = fitz.open("demo-lumen.pdf")
for i, pg in enumerate(d, 1):
    pg.get_pixmap(dpi=150).save(f"planche-demo-{i}.png")
print("document de démonstration :", d.page_count, "pages rasterisées")
