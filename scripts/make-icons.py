#!/usr/bin/env python3
"""Generate ClariWord AI extension icons.

Renders the mark at 1024px and downsamples with LANCZOS so the 16px icon stays
crisp. Run: python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw
import os

S = 1024
JADE = (14, 124, 102, 255)
JADE_DEEP = (10, 95, 78, 255)  # reserved for future use
PAPER = (250, 249, 247, 255)

out_dir = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "icons")
os.makedirs(out_dir, exist_ok=True)


def rounded_square(draw, radius_ratio=0.235):
    r = int(S * radius_ratio)
    draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=JADE)


def vertical_shade(img):
    """Very subtle top-light gradient so the tile doesn't look flat."""
    grad = Image.new("L", (1, S))
    for y in range(S):
        grad.putpixel((0, y), int(22 * (1 - y / S)))
    grad = grad.resize((S, S))
    light = Image.new("RGBA", (S, S), (255, 255, 255, 255))
    img.paste(light, (0, 0), grad)


def draw_mark(img):
    d = ImageDraw.Draw(img)
    rounded_square(d)
    vertical_shade(img)
    d = ImageDraw.Draw(img)

    # The "C" — an open ring, mouth facing right.
    pad = int(S * 0.235)
    bbox = [pad, int(S * 0.165), S - pad, int(S * 0.165) + (S - 2 * pad)]
    width = int(S * 0.105)
    d.arc(bbox, start=38, end=322, fill=PAPER, width=width)

    # Highlight bar beneath: the "reading" half of the mark.
    bar_h = int(S * 0.09)
    bar_y = int(S * 0.775)
    d.rounded_rectangle(
        [pad - int(S * 0.055), bar_y, S - pad + int(S * 0.055), bar_y + bar_h],
        radius=bar_h // 2,
        fill=PAPER,
    )


def main():
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_mark(base)
    for size in (16, 32, 48, 128, 512):
        icon = base.resize((size, size), Image.LANCZOS)
        icon.save(os.path.join(out_dir, f"icon-{size}.png"))
        print(f"wrote icon-{size}.png")


if __name__ == "__main__":
    main()
