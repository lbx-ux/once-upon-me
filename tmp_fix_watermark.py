# -*- coding: utf-8 -*-
"""一次性：去掉 booklist flower 源图右下角水印（v3，确定性）。
水印框内逐列垂直线性插值（上邻干净行 <-> 下邻干净行，RGB 三通道各自插值），
叠加匹配的高斯噪点；左缘 36px 与原图平滑混合（该区域无水印）。
框：x0=w-154 .. x1=w-2，y0=h-132 .. y1=h-2（框外上下都干净）。"""
from PIL import Image
import os, random

SRC = 'booklist_flower_src'
OUT = 'booklist_flower_src/final'
PICKS = {
    'cover.png': 'cover_new.png', 'p1.png': 'p1.png', 'p2.png': 'p2_v3.png',
    'p3.png': 'p3.png', 'p4.png': 'p4_new.png', 'p5.png': 'p5_new.png',
    'p6.png': 'p6_new.png', 'p7.png': 'p7_v2.png', 'p8.png': 'p8_v3.png',
}
BOX_W, TOP_M, BLEND = 152, 132, 36


def main():
    random.seed(42)
    os.makedirs(OUT, exist_ok=True)
    for out, src in PICKS.items():
        orig = Image.open(os.path.join(SRC, src)).convert('RGB')
        w, h = orig.size
        im = orig.copy()
        po, pn = orig.load(), im.load()
        x0, x1 = w - BOX_W - 2, w - 2        # 填充列 [x0, x1)
        y0, y1 = h - TOP_M, h - 2            # 填充行 [y0, y1)

        for x in range(x0, x1):
            def anchor(xx, yy):
                vals = [po[c, yy] for c in (xx - 1, xx, xx + 1)]
                n = len(vals)
                return tuple(sum(v[i] for v in vals) / n for i in range(3))
            a = anchor(x, y0 - 1)
            b = anchor(x, y1)                # y1=h-2 这两行在水印下方，干净
            span = y1 - y0
            for y in range(y0, y1):
                t = (y - y0) / span
                n = random.gauss(0, 2.5)
                pn[x, y] = tuple(int(min(255, max(0, a[i] + (b[i] - a[i]) * t + n)))
                                 for i in range(3))

        # 左缘混合：x0..x0+BLEND 与原图平滑过渡（这半条里没有水印）
        for y in range(y0, y1):
            for i in range(BLEND):
                x = x0 + i
                t = i / BLEND
                if t <= 0:
                    continue
                o, f = po[x, y], pn[x, y]
                pn[x, y] = tuple(int(o[i] * (1 - t) + f[i] * t) for i in range(3))

        im.save(os.path.join(OUT, out))
        print(out, 'done', im.size)


if __name__ == '__main__':
    main()
