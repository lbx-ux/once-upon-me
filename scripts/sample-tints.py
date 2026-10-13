"""从绘本跨页图里取主色，生成"这一页把背景染了一层色"要用的那份色表。

用法（图片路径由参数传入；加 -I 跑，与 make-webp.py 同一条规矩）：

    python -I scripts/sample-tints.py public/book/cover.webp public/book/spread-*.webp \\
        --out src/components/book/spreadTints.ts

产出的 TS 模块长这样，键是**站点 URL**（由路径去掉 `public/` 前缀得到），
值是三朵主色：**挑哪三朵**由占的像素数决定，**谁排在前面**由彩度决定
（从高到低，最白的那朵永远排最后 —— 见 `pick_three` 的说明）：

    export const SPREAD_TINTS: Record<string, readonly [string, string, string]> = {
      '/book/spread-1.webp': ['#eae2ac', '#b29a7a', '#fdfdf2'],
      ...
    }

★ 为什么要一个脚本、而不是手挑三个颜色：
  这三个数会进仓库、进 CSS。手挑的话下一次换图就没人重挑，
  于是背景色与页面内容悄悄脱钩 —— 那正是「数字要能复现」这条要防的事。
  改了图就重跑一次，脚本是幂等的。

取色策略：
  1. 缩到 **200px 见方**；
  2. 中位切分量化到 **16 色**，按像素数从多到少排；
  3. 从多到少贪心地挑，**两两 RGB 距离必须 ≥ 阈值**（起始 40）。
     不夹这一刀，挑出来的三朵会是同一朵云的三个深浅。
     凑不满三个就把阈值依次降到 28、18、0（宁可相近也不要缺）。
  4. 挑完的三朵**按彩度重排**（见 `pick_three`）。

★ 第 1、2 步那两个数是实测出来的，不是拍的：
  第一版按"主色要的是整块画面什么颜色"缩到 64px、量化 8 色，结果三朵全是
  #b29a7a / #8b8467 这种**灰褐**——草坡的绿与天空的蓝在缩略时被平均掉了
  （相邻的草与天空在一颗像素里混合，得到的就是灰）。
  改成 200px / 16 色之后同一张 spread-1 交出 #eae49d（草坡黄绿）、
  #bbc687（草绿）、#fdfef8（云白），spread-2 交出 #d7eef3（天蓝）——
  与肉眼在那两页上看到的东西一致。
  教训：**给"取主色"这件事降分辨率，取到的是平均色而不是主色。**

  距离用 RGB 欧氏距离，不是感知色差。够用：这里要的是"分得开的三个色相"，
  不是"视觉上等距"；换 CIEDE2000 得自己写色彩空间转换，收益不值。
"""

import argparse
import glob
import os
import sys
from pathlib import Path

from PIL import Image

# ★ 这两个数别往下调：缩得越狠、切的色数越少，草与天就被平均成灰褐。
#   实测对照写在文件头（64px/8 色那一档出来的三朵全是灰）。
MAX_THUMB = 200
QUANT_COLORS = 16
# 太暗的候选直接不要：这一批画是高调水彩，暗的那几朵是**铅笔线与投影**，
# 不是"这一页是什么颜色"。第一版没有这一道，spread-3 交出来的第一朵是
# #837666（线稿褐），染到背景上就是一团脏。判据用最亮通道 ≥ 150：
# 水彩的暗部最亮通道也在 150 以上，而线稿那几朵全在 130 以下。
MIN_LIGHT = 150
# 阈值降级序列：凑不满三个主色时依次放宽（见文档字符串第 3 步）
DIST_LADDER = (40.0, 28.0, 18.0, 0.0)
WANT = 3

Rgb = tuple[int, int, int]


def palette_of(path: str) -> list[tuple[Rgb, int]]:
    """→ [((r, g, b), 像素数), ...]，按像素数从多到少。"""
    with Image.open(path) as im:
        im = im.convert('RGB')
        im.thumbnail((MAX_THUMB, MAX_THUMB), Image.LANCZOS)
        q = im.quantize(colors=QUANT_COLORS, method=Image.MEDIANCUT)
        pal = q.getpalette() or []
        counts = sorted(q.getcolors() or [], key=lambda c: -c[0])
    out: list[tuple[Rgb, int]] = []
    for count, idx in counts:
        chunk = pal[idx * 3 : idx * 3 + 3]
        if len(chunk) == 3:
            out.append(((chunk[0], chunk[1], chunk[2]), count))
    return out


def dist(a: Rgb, b: Rgb) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def chroma(c: Rgb) -> int:
    """最土的一种"有多少颜色"：最大通道减最小通道。灰与纸白都是 0 附近。"""
    return max(c) - min(c)


def pick(pal: list[tuple[Rgb, int]], min_dist: float, want: int) -> list[tuple[Rgb, int]]:
    """从按像素数排序的调色板里贪心挑 `want` 个互相分得开的颜色。"""
    chosen: list[tuple[Rgb, int]] = []
    for color, count in pal:
        if all(dist(color, c) >= min_dist for c, _ in chosen):
            chosen.append((color, count))
            if len(chosen) == want:
                break
    return chosen


def pick_three(path: str) -> tuple[list[str], list[float]]:
    """→ (三个 hex, 三个占比%)。

    阈值按 DIST_LADDER 依次放宽，直到凑满三个。
    ★ 返回顺序是**按彩度（max−min 通道）从高到低**，不是按像素数：
      挑哪三个由像素数决定，但排哪个在前由彩度决定 —— 这一张跨页里最占面积的
      往往是纸白（#fdfdf2 那种），把它放在第一个，CSS 就会把"主色"用成一片白，
      染色层等于没做。约定成 [最彩, 中, 最白] 之后，CSS 那侧可以固定读法：
      前两朵做有色的那两团，最后一朵做外圈底色。
    """
    pal = palette_of(path)
    total = sum(n for _, n in pal) or 1
    # ★ 占比一律按**全图**算，所以过滤要在算完 total 之后做 ——
    #   先滤再算的话，那三朵的百分比会虚高，而百分比是这张表唯一的可核对证据。
    pal = [x for x in pal if max(x[0]) >= MIN_LIGHT]
    chosen: list[tuple[Rgb, int]] = []
    for threshold in DIST_LADDER:
        chosen = pick(pal, threshold, WANT)
        if len(chosen) == WANT:
            break
    chosen = sorted(chosen, key=lambda t: -chroma(t[0]))
    hexes = ['#%02x%02x%02x' % c for c, _ in chosen]
    shares = [100.0 * n / total for _, n in chosen]
    return hexes, shares


def url_key(path: str) -> str:
    """public/book/spread-1.webp → /book/spread-1.webp（正斜杠，跨平台一致）。

    ★ 找的是 `public/` 这一段，且要求它前面是分隔符或就是开头 ——
      不这么夹的话 `mypublic/x.webp` 会被切成 `public/x.webp` 那种荒谬的键。
      第一版就栽在这里：传进来的路径是相对的（`public/book/...`，前面没有斜杠），
      于是整段 `public/` 没匹配上，退成了 basename，键变成 `/cover.webp`，
      与 demoBook.ts 里的 `/book/cover.webp` 对不上 —— 背景色会静默地取不到。
    """
    norm = Path(path).as_posix()
    marker = 'public/'
    i = norm.rfind(marker)
    if i >= 0 and (i == 0 or norm[i - 1] == '/'):
        return '/' + norm[i + len(marker) :]
    return '/' + os.path.basename(norm)


HEADER = """/* 由 scripts/sample-tints.py 生成 —— 不要手改，改了图就重跑脚本。
 *
 * 每一面跨页的三个主色，给"背景被当前页染一层色"用（见 storybook-flip.css §1.6）。
 * 键是站点 URL，值是三朵主色，**按彩度从高到低**排（最白的那朵在最后）：
 * CSS 那侧固定读法 = 前两朵做有色的两团、最后一朵做外圈底色。
 * 取色口径与阈值降级规则写在脚本的 docstring 里，重跑一次就能复现下面每一个数：
 *
 *     python -I scripts/sample-tints.py public/book/cover.webp public/book/spread-*.webp \\
 *         --out src/components/book/spreadTints.ts
 */

export const SPREAD_TINTS: Record<string, readonly [string, string, string]> = {"""

EXT = ('.webp', '.png', '.jpg', '.jpeg')


def fchr(value: str) -> str:
    """TS 里的一串单引号字面量。"""
    return f"'{value}'"


def main() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('images', nargs='*')
    ap.add_argument('--out')
    ap.add_argument('--help', action='store_true')
    args = ap.parse_args()

    if args.help or not args.images:
        print(__doc__)
        return 0 if args.help else 1

    # 自己展开通配符：Windows 的 shell 不展、Linux 的展 —— 两边都交给这里，
    # 同一条命令在两个平台上得到同一份结果。
    files: list[str] = []
    for pat in args.images:
        hit = sorted(glob.glob(pat)) if any(ch in pat for ch in '*?[') else [pat]
        files.extend(hit)
    files = [f for f in files if f.lower().endswith(EXT)]
    if not files:
        print('没有命中任何图片', file=sys.stderr)
        return 1

    entries: list[tuple[str, list[str]]] = []
    for f in files:
        hexes, shares = pick_three(f)
        if len(hexes) < WANT:
            print(f'  ! {f} 只挑到 {len(hexes)} 个颜色', file=sys.stderr)
        entries.append((url_key(f), hexes))
        print(f'  {f:<32} ' + '  '.join(f'{h} ({s:4.1f}%)' for h, s in zip(hexes, shares)))

    if not args.out:
        return 0

    width = max(len(k) for k, _ in entries) + 2
    # ★ 键**必须带引号**：`/book/spread-1.webp` 不是合法的 JS 标识符，
    #   裸着写出去整个模块是语法错误。第一版就是这么写的，tsc 之前没跑到这个新文件，
    #   是浏览器的 500 页把它抓出来的（与"GSAP 插件 import 只有浏览器能抓"同一类）。
    rows = [
        f"  {fchr(key):{width}}: [{', '.join(fchr(h) for h in hexes)}],"
        for key, hexes in entries
    ]
    body = '\n'.join([HEADER, *rows, '}', ''])
    Path(args.out).write_text(body, encoding='utf-8', newline='\n')
    print(f'\n写入 {args.out}（{len(entries)} 条）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
