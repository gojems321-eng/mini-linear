#!/usr/bin/env python3
"""
Generate the Mini-Linear "ML" icon assets.

One geometric monogram (thick white ML strokes on an indigo rounded square)
is rendered to:
  - public/ml-icon.png    (192x192, apple-touch fallback)
  - src/app/favicon.ico   (16/32/48 multi-size legacy favicon)

public/ml-icon.svg and public/logo.svg carry the same geometry as vector
strokes, so all four files share one design with no font dependency.
"""
from PIL import Image, ImageDraw

OUT_PNG = "/home/z/my-project/public/ml-icon.png"
OUT_ICO = "/home/z/my-project/src/app/favicon.ico"

MASTER = 512                      # render size before downscaling
VIEW = 64                         # SVG viewBox units the geometry is defined in
SCALE = MASTER / VIEW

TOP = (0x63, 0x66, 0xF1)          # indigo-500
BOTTOM = (0x43, 0x38, 0xCA)       # indigo-700
WHITE = (255, 255, 255, 255)

# Monogram strokes in 64-unit space: "M" left, "L" right.
M_PATH = [(10, 45), (10, 19), (20, 34), (30, 19), (30, 45)]
L_PATH = [(38, 19), (38, 45), (52, 45)]
STROKE = 6


def scaled(points):
    return [(x * SCALE, y * SCALE) for x, y in points]


def render() -> Image.Image:
    # Vertical gradient square.
    square = Image.new("RGB", (MASTER, MASTER))
    px = square.load()
    for y in range(MASTER):
        t = y / (MASTER - 1)
        row = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        for x in range(MASTER):
            px[x, y] = row

    img = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    img.paste(square, (0, 0))

    # Round the corners via mask.
    mask = Image.new("L", (MASTER, MASTER), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (2 * SCALE, 2 * SCALE, 60 * SCALE, 60 * SCALE),
        radius=14 * SCALE, fill=255,
    )
    img.putalpha(mask)

    # White ML strokes.
    draw = ImageDraw.Draw(img)
    draw.line(scaled(M_PATH), fill=WHITE, width=round(STROKE * SCALE), joint="curve")
    draw.line(scaled(L_PATH), fill=WHITE, width=round(STROKE * SCALE))
    return img


def main() -> None:
    master = render()

    png = master.resize((192, 192), Image.LANCZOS)
    png.save(OUT_PNG, "PNG")
    print("wrote", OUT_PNG)

    # ICO plugin downscales from the master itself for each size.
    master.save(OUT_ICO, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote", OUT_ICO)


if __name__ == "__main__":
    main()
