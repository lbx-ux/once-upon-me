"""Normalize the 9 generated illustrations into .cloud-src/src/{cover,p1..p8}.png
and strip the fixed bottom-right watermark from each. Deterministic, no resize.
"""
import os
from strip_wm import strip_wm

ROOT = os.path.dirname(os.path.abspath(__file__))


def raw(*parts):
    return os.path.join(ROOT, "raw", *parts)


SPREAD = "儿童绘本内页插画_横版开页跨页_一张完整画面横跨左右两页_不_"
COVER = "儿童绘本的竖版封面插画_一张完整画面_不是拼贴_不是多格分镜_"

mapping = {
    "cover": raw("cover", COVER + "2026-10-17T05-28-05.png"),
    "p1": raw("p1", SPREAD + "2026-10-17T05-29-33.png"),
    "p2": raw("p2", SPREAD + "2026-10-17T05-31-08.png"),
    "p3": raw("p3b", SPREAD + "2026-10-17T05-38-10.png"),  # regenerated, no spine wording
    "p4": raw("p4b", SPREAD + "2026-10-17T05-38-42.png"),  # regenerated, no spine wording
    "p5": raw("p5", SPREAD + "2026-10-17T05-33-54.png"),
    "p6": raw("p56", SPREAD + "2026-10-17T05-33-12.png"),
    "p7": raw("p7", SPREAD + "2026-10-17T05-35-04.png"),
    "p8": raw("p8", SPREAD + "2026-10-17T05-35-37.png"),
}

out_dir = os.path.join(ROOT, "src")
os.makedirs(out_dir, exist_ok=True)

for name, src in mapping.items():
    if not os.path.exists(src):
        print("MISSING", name, src)
        continue
    dst = os.path.join(out_dir, name + ".png")
    strip_wm(src, dst)
    print("ok", name, "->", dst)

print("done")
