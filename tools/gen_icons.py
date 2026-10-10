"""Genera los iconos de la PWA en public/icons/ (solo con Pillow, sin assets externos).

Uso: python tools/gen_icons.py
Estilo: fondo azul policía, estrella dorada de sheriff y una cabeza de zombi "de bloques" verde.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BG = (31, 50, 96)          # #1f3260
BG_DARK = (22, 36, 72)
GOLD = (232, 178, 58)      # #e8b23a
GOLD_DARK = (176, 128, 30)
GREEN = (110, 170, 80)
GREEN_DARK = (62, 110, 48)
EYE = (20, 24, 30)
SS = 4                     # supersampling para bordes suaves


def star_points(cx, cy, r_out, r_in, n=6, rot=-90):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(rot + i * 180 / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw_icon(size, content=1.0, rounded=False):
    """content: fracción del lienzo que ocupa el dibujo (maskable usa ~0.7 por la zona segura)."""
    S = size * SS
    img = Image.new("RGBA", (S, S), BG + (255,))
    d = ImageDraw.Draw(img)
    # Degradado vertical sutil.
    for y in range(S):
        t = y / S
        c = tuple(int(BG[i] + (BG_DARK[i] - BG[i]) * t) for i in range(3))
        d.line([(0, y), (S, y)], fill=c + (255,))
    cx = cy = S / 2
    R = S / 2 * content * 0.92
    # Estrella dorada (6 puntas) con borde y bolitas en las puntas, como una placa.
    pts = star_points(cx, cy, R, R * 0.62)
    d.polygon(pts, fill=GOLD_DARK)
    inner = star_points(cx, cy, R * 0.93, R * 0.58)
    d.polygon(inner, fill=GOLD)
    for i in range(0, 12, 2):
        px, py = pts[i]
        br = R * 0.075
        d.ellipse([px - br, py - br, px + br, py + br], fill=GOLD)
    # Cabeza de zombi de bloques.
    h = R * 0.62
    x0, y0, x1, y1 = cx - h / 2, cy - h / 2 + R * 0.02, cx + h / 2, cy + h / 2 + R * 0.02
    d.rectangle([x0 - h * 0.04, y0 - h * 0.04, x1 + h * 0.04, y1 + h * 0.04], fill=GREEN_DARK)
    d.rectangle([x0, y0, x1, y1], fill=GREEN)
    ew, eh = h * 0.2, h * 0.22
    ey = y0 + h * 0.26
    d.rectangle([x0 + h * 0.15, ey, x0 + h * 0.15 + ew, ey + eh], fill=EYE)
    d.rectangle([x1 - h * 0.15 - ew, ey, x1 - h * 0.15, ey + eh], fill=EYE)
    # Boca dentada.
    my = y0 + h * 0.66
    d.rectangle([x0 + h * 0.2, my, x1 - h * 0.2, my + h * 0.16], fill=EYE)
    tw = (h * 0.6) / 4
    for i in range(0, 4, 2):
        tx = x0 + h * 0.2 + tw * (i + 0.5)
        d.rectangle([tx, my, tx + tw, my + h * 0.08], fill=(235, 235, 220))
    img = img.resize((size, size), Image.LANCZOS)
    if rounded:
        mask = Image.new("L", (size * SS, size * SS), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * SS - 1, size * SS - 1], radius=int(size * SS * 0.2), fill=255)
        mask = mask.resize((size, size), Image.LANCZOS)
        img.putalpha(mask)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {
        "icon-192.png": (192, 1.0, True),
        "icon-512.png": (512, 1.0, True),
        "icon-maskable-512.png": (512, 0.72, False),   # a sangre, dibujo dentro de la zona segura (80 %)
        "apple-touch-icon.png": (180, 1.0, False),      # iOS aplica su propia máscara
        "favicon-32.png": (32, 1.0, True),
    }
    for name, (size, content, rounded) in jobs.items():
        img = draw_icon(size, content, rounded)
        if not rounded:
            img = img.convert("RGB")
        img.save(OUT / name, optimize=True)
        print(name, size)


if __name__ == "__main__":
    main()
