"""Remove the fixed bottom-right provenance watermark from generated illustrations.

Deterministic: clones a grass patch from directly above the watermark and blends it
in with a soft inner-edge feather. No inpainting model, no resize, no aspect change.
"""
import os
import sys
from PIL import Image


def strip_wm(src: str, dst: str) -> str:
    im = Image.open(src).convert("RGB")
    W, H = im.size
    # generous box around the bottom-right watermark
    bw = 210 if W >= 1400 else 170
    bh = 120
    x0, y0 = W - bw, H - bh
    dy = 150
    sy0 = max(0, y0 - dy)
    patch = im.crop((x0, sy0, W, sy0 + bh))

    # feather only the inner (left & top) edges; right/bottom sit on the canvas edge
    mask = Image.new("L", (bw, bh), 255)
    px = mask.load()
    F = 26
    for y in range(bh):
        for x in range(bw):
            a = 255
            if x < F:
                a = min(a, int(255 * x / F))
            if y < F:
                a = min(a, int(255 * y / F))
            px[x, y] = a

    im.paste(patch, (x0, y0), mask)
    im.save(dst)
    return dst


if __name__ == "__main__":
    for p in sys.argv[1:]:
        dst = os.path.splitext(p)[0] + "_clean.png"
        strip_wm(p, dst)
        print("ok", dst)
