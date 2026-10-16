"""把「纯白底的立绘」抠成带 alpha 的 RGBA PNG，供 make-webp.py 缩档。

用法（源图目录与产出目录都由参数传入；加 -I 跑，避免源图目录里的同名模块被
import —— 源图是外部下载物，不当作可信代码）：

    python -I scripts/cutout.py <源图目录> <产出目录> [--tol 12] [--choke 1] [--min-island 40] [--match <glob>]

配套的那一步（产出目录是中间目录，不入库）：

    python -I scripts/cutout.py ~/figures-src .out/figures-rgba
    python -I scripts/make-webp.py .out/figures-rgba public/figures --preset figure

## 为什么是「从四条边泛洪」而不是色键

这批立绘的背景要求出成**纯白 #FFFFFF**（提示词见 docs/figure-art-prompts.md §二）。
去底有两条路，只有一条对这批画成立：

- **全局色键**（"凡是接近白的像素都去掉"）——错。这批画是水彩铺色 + 细彩铅收形，
  **白是画面里的颜料**：眼白、牙齿、衣服的高光、留白的花瓣，全是接近白的。
  全局色键会把这些整片吃掉，出来的人是一张有洞的纸。
- **边缘连通泛洪**（只去掉**与画面边框连通**的那块近白）——对。彩铅轮廓线把人物
  封住了，轮廓内的白**不与边框连通**，于是原样保留。这一条不是"理论上更好"，
  是这批画的画法给的：`【风格】` 那段里的"细彩铅轮廓线收形"就是这道密封。

反过来，**轮廓内真的出现了大块近白连通不到边框、而它本该是背景**，说明那张图的
背景不纯（模型偷偷画了一圈地面或一道淡影，把人物脚下的白封成了孤岛）。这一条
下面按「最大的封闭近白块」报出来，交人眼判——不静悄悄放过。

## 为什么背景是白而不是绿幕/品红

1. 页面底色本身就近白（`--paper: #f4f8f9`），万一边缘留一圈白也读不出来；
2. 饱和色键必然在描边像素上留一圈色溢（那些像素是 轮廓线 × 背景色 的混合），
   而那 12 个小人是站在渐变天空前面的——一圈品红在那片天上非常显眼。

## tol 这一档的取舍：发丝级的浅色细节

★ 2026-10-15 实测（12 张，848×1264）：`--tol 12` 会**吃掉一条拴气球的线**。
  那条线本身接近白（偏差 3～12），于是它自己也进了"近白"的掩码里，泛洪顺着它
  一路走过去把它抹了——症状是气球与手脱开、飘在图上（在最终 256px 的 WebP 上
  是一块 4310 px 的独立岛）。压到 `--tol 2` 就保住了：线不再是"白"，泛洪过不去，
  于是它成为一道挡住背景的坝。这不是调参调出来的，是"近白的细线在泛洪面前等于不存在"
  这条机制的必然——所以判据是**连通块**，不是眼看。

  但 `--tol 2` 单独用不行：源图是 **JPEG**，一片平白的背景带着 ±10 的压缩噪声，
  阈值一紧，这些噪声点不算"白"，就成片留在人物周围（实测每张多留 1.0%～1.5% 的
  像素、bbox 铺满整幅画面、均色 239～249，在深色垫板上一眼可见）。
  所以两步要一起：**紧阈值保住细线 + 抹孤岛去掉噪点**（见 `drop_islands`）。
  实测 12 张的孤岛分布中间是空的（次大块 7～19 px，主体 23 万～38 万 px），
  所以 `--min-island 40` 落在那段空档里，不是在两个相邻的数之间赌。

## 体检数（每张都打，不是装饰）

- `alpha %`：去掉的面积。太低 = 底色根本没被认出来；高得离谱 = 吃进人物了。
- `边缘残留`：仍保留为不透明、但本身接近白、且紧贴着透明区的像素数。非 0 就是
  边缘没去净，摆在那片天上会看到一圈白。
- `最大封闭近白块`：轮廓内不与边框连通的近白块里最大的那一块，占画面的百分比。
  超过阈值就告警（见上：多半是背景不纯）。
- `边框近白比`：四条边上有多大比例是接近白的。**低于 --require-border 的那一档
  直接报错退出**，不产出半透明的怪图——源图压根不是白底是要回去重出图的，
  不是在这里将就的。★ 不许把"没测成"记成"测出来"。

退出码：全部干净 0；有任何告警或错误 1（与 make-webp.py 的预算判定同一条习惯，
这样它能被串在一条命令里）。
"""
import sys
import os
import fnmatch
import argparse
from collections import deque

from PIL import Image, ImageChops

# Windows 控制台默认 GBK，中文输出会变乱码
try:
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError):  # stdout 被换成不支持 reconfigure 的对象时跳过
    pass


def near_white_mask(im: Image.Image, tol: int) -> bytearray:
    """一张 0/1 的位图：1 = 该像素三个通道都 ≥ 255-tol（接近白）。

    ★ 阈值化交给 PIL 的 point/multiply（C 速度），Python 只在结果字节上跑连通域——
      这批源图 848×1264（实测，12 张同尺寸）就有 107 万像素，纯 Python 逐像素判通道
      会慢到没法批量跑。
    """
    cut = 255 - max(0, min(254, tol))
    lut = [0] * cut + [255] * (256 - cut)  # ≥ cut → 255，否则 0
    rgb = im.convert('RGB')
    r, g, b = rgb.split()
    m = r.point(lut)
    m = ImageChops.multiply(m, g.point(lut))
    m = ImageChops.multiply(m, b.point(lut))
    # 值只剩 0 与 255；查表翻成 0/1，后面所有 `if mask[i]` 与 `sum(filled)` 才是按个数算的
    return bytearray(m.tobytes().translate(bytes([0]) * 255 + bytes([1])))


def fill_from_border(mask: bytearray, w: int, h: int) -> bytearray:
    """从四条边入队，把**与边框连通**的近白区标 1（扫描线式泛洪，纯 Python）。

    ★ 约定是「入队即标记」，不是「出队才标记」。写成后者时，边框种子在入队那一轮
      就被自己标掉，出队一看"已标记"直接 continue —— 泛洪一步都没走出去，
      症状是 alpha 只有 2%（背景原封不动）而不是报错。2026-10-15 假图自测抓到过一次。
    """
    filled = bytearray(w * h)
    seeds = deque()

    def push(x: int, y: int) -> None:
        i = y * w + x
        if mask[i] and not filled[i]:
            filled[i] = 1
            seeds.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while seeds:
        x, y = seeds.pop()
        row = y * w
        left = x
        while left - 1 >= 0 and mask[row + left - 1] and not filled[row + left - 1]:
            left -= 1
        right = x
        while right + 1 < w and mask[row + right + 1] and not filled[row + right + 1]:
            right += 1
        for xx in range(left, right + 1):
            i = row + xx
            filled[i] = 1
            if y > 0:
                push(xx, y - 1)
            if y + 1 < h:
                push(xx, y + 1)
    return filled


def largest_enclosed_run(mask: bytearray, filled: bytearray, w: int, h: int) -> int:
    """不与边框连通的近白块里，最大的那一块有多大（像素数）。"""
    seen = bytearray(w * h)
    best = 0
    for start in range(w * h):
        if not mask[start] or filled[start] or seen[start]:
            continue
        size = 0
        stack = [start]
        seen[start] = 1
        while stack:
            i = stack.pop()
            size += 1
            x, y = i % w, i // w
            if x > 0:
                j = i - 1
                if mask[j] and not filled[j] and not seen[j]:
                    seen[j] = 1
                    stack.append(j)
            if x + 1 < w:
                j = i + 1
                if mask[j] and not filled[j] and not seen[j]:
                    seen[j] = 1
                    stack.append(j)
            if y > 0:
                j = i - w
                if mask[j] and not filled[j] and not seen[j]:
                    seen[j] = 1
                    stack.append(j)
            if y + 1 < h:
                j = i + w
                if mask[j] and not filled[j] and not seen[j]:
                    seen[j] = 1
                    stack.append(j)
        if size > best:
            best = size
    return best


def border_white_ratio(mask: bytearray, w: int, h: int) -> float:
    n = 0
    hit = 0
    for x in range(w):
        for y in (0, h - 1):
            n += 1
            hit += mask[y * w + x]
    for y in range(h):
        for x in (0, w - 1):
            n += 1
            hit += mask[y * w + x]
    return hit / n if n else 0.0


def edge_residue(mask: bytearray, filled: bytearray, w: int, h: int) -> int:
    """仍不透明、本身接近白、且紧贴着透明区的像素数（= 会露出来的那圈白毛刺）。"""
    hit = 0
    for y in range(h):
        row = y * w
        for x in range(w):
            i = row + x
            if not mask[i] or filled[i]:
                continue
            if (
                (x > 0 and filled[i - 1])
                or (x + 1 < w and filled[i + 1])
                or (y > 0 and filled[i - w])
                or (y + 1 < h and filled[i + w])
            ):
                hit += 1
    return hit


def choke(filled: bytearray, w: int, h: int, px: int) -> bytearray:
    """把不透明区往里收 px 像素：紧贴透明区的那几列不透明像素也变透明。

    ★ 默认 1。这 1 像素在源分辨率（这批是 848×1264）上是轮廓线的最外一道混合，去掉它
      正好把白毛刺带走；但**太粗的收缩会吃掉发丝**，所以这一档可调、且文档写明
      什么时候该设 0。
    ★ **这一批实际用的是 `--choke 0`**（连同 `--tol 2 --min-island 40`）：紧阈值那一步
      已经把边缘清干净了（12 张 `边缘残留` 全为 0），这时再收 1 像素没有收益，
      只有"吃掉细线"的风险——那 1 像素存在的理由（带走白毛刺）在当时已经不成立了。
      所以这一档的正确用法是**先量 `边缘残留`，非 0 再收**，不是默认就收。
    """
    if px <= 0:
        return filled
    out = bytearray(filled)
    for _ in range(px):
        nxt = bytearray(out)
        for y in range(h):
            row = y * w
            for x in range(w):
                i = row + x
                if not out[i]:
                    continue  # 还不透明 → 不动它。只有**透明**像素才往里吃一圈
                if x > 0:
                    nxt[i - 1] = 1
                if x + 1 < w:
                    nxt[i + 1] = 1
                if y > 0:
                    nxt[i - w] = 1
                if y + 1 < h:
                    nxt[i + w] = 1
        out = nxt
    return out


def drop_islands(filled: bytearray, w: int, h: int, min_px: int) -> tuple[bytearray, int, int]:
    """把不透明区里小于 min_px 的孤岛改回透明，返回 (新 filled, 删掉的块数, 删掉的像素数)。

    为什么需要这一步：`--tol` 压到 2 才能留住发丝级的浅色细节（气球线就是这一类，
    见下），但源图是 **JPEG**，一片平白的背景带着 ±10 的压缩噪声——阈值一紧，
    这些噪声点就不算"白"，于是原封不动地留在人物周围。实测（2026-10-15，12 张）：
    噪声是 **1000～1200 个孤立小点，最大的才 19px**；而人物主体 23 万～38 万像素。
    中间是空的，没有第三档——所以按面积筛是干净的判据，不是调参调出来的巧合。

    ★ 用 **8-连通** 而不是 4-连通，理由与泛洪那一步相反：这里宁可不删。
      斜着连过去的细线在 4-连通下会被切成两截，一旦被切下去的就是"内容"；
      8-连通只可能让噪声块显得更大，而上面那个空档大到两种算法都撞不着。
    """
    opaque = bytearray(1 if not v else 0 for v in filled)
    seen = bytearray(w * h)
    out = bytearray(filled)
    n_islands = n_px = 0
    for start in range(w * h):
        if not opaque[start] or seen[start]:
            continue
        seen[start] = 1
        stack = [start]
        run = [start]
        while stack:
            i = stack.pop()
            x, y = i % w, i // w
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < 0 or ny >= h:
                    continue
                for dx in (-1, 0, 1):
                    nx = x + dx
                    if nx < 0 or nx >= w:
                        continue
                    j = ny * w + nx
                    if opaque[j] and not seen[j]:
                        seen[j] = 1
                        stack.append(j)
                        run.append(j)
        if len(run) < min_px:
            n_islands += 1
            n_px += len(run)
            for i in run:
                out[i] = 1
    return out, n_islands, n_px


def resolve_sources(src_dir: str, match: str | None) -> list[str]:
    names = [
        f for f in os.listdir(src_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))
    ]
    if match:
        names = [f for f in names if fnmatch.fnmatch(f.lower(), match.lower())]
    return sorted(names)


def main() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('src_dir')
    ap.add_argument('dst_dir')
    ap.add_argument('--tol', type=int, default=12, help='离纯白多远还算白（默认 12）')
    ap.add_argument('--choke', type=int, default=1, help='不透明区往里收几像素（0 = 不收）')
    ap.add_argument('--require-border', type=float, default=0.55,
                    help='四条边上近白像素的最低占比，低于它就判定"源图不是白底"（默认 0.55）')
    ap.add_argument('--max-enclosed', type=float, default=2.0,
                    help='最大的封闭近白块超过画面这个百分比就告警（默认 2.0）')
    ap.add_argument('--min-island', type=int, default=40,
                    help='不透明区里小于这个像素数的孤岛判为噪点、抹成透明（默认 40；0 = 不抹）')
    ap.add_argument('--match')
    ap.add_argument('-h', '--help', action='store_true')
    args = ap.parse_args()

    if args.help:
        print(__doc__)
        return 2

    os.makedirs(args.dst_dir, exist_ok=True)
    files = resolve_sources(args.src_dir, args.match)
    if not files:
        print(f'没有匹配的源图（--match {args.match!r}）')
        return 2

    print(f'去底  tol={args.tol}  choke={args.choke}  '
          f'边框近白下限={args.require_border:.0%}  封闭白告警线={args.max_enclosed}%')
    print(f'{len(files)} 张源图  源目录={args.src_dir}  产出目录={args.dst_dir}\n')

    problems: list[str] = []
    errors: list[str] = []
    for fn in files:
        src = os.path.join(args.src_dir, fn)
        stem = os.path.splitext(fn)[0]
        dst = os.path.join(args.dst_dir, stem + '.png')
        with Image.open(src) as raw:
            w, h = raw.size
            has_alpha = 'A' in raw.getbands()
            opaque_alpha = True
            if has_alpha:
                ex = raw.getextrema()
                opaque_alpha = ex[-1][0] >= 250  # alpha 通道最小值也接近满 → 等于没有 alpha
            im = raw.convert('RGB')

        if has_alpha and not opaque_alpha:
            im2 = raw.convert('RGBA')
            im2.save(dst, 'PNG')
            print(f'  {fn:18s} {w}x{h:<5}  源图自带 alpha，原样落盘（未泛洪）')
            continue

        mask = near_white_mask(im, args.tol)
        ratio = border_white_ratio(mask, w, h)
        if ratio < args.require_border:
            errors.append(f'{fn}: 四条边只有 {ratio:.0%} 接近白（需 ≥{args.require_border:.0%}）'
                          f'—— 这张的背景不是纯白，回去重出图，不在这里将就')
            print(f'  {fn:18s} {w}x{h:<5}  ← 背景不白（边框近白 {ratio:.0%}），已跳过')
            continue

        filled = fill_from_border(mask, w, h)
        filled = choke(filled, w, h, max(0, args.choke))
        filled, n_islands, n_island_px = drop_islands(filled, w, h, max(0, args.min_island))
        residue = edge_residue(mask, filled, w, h)
        enclosed = largest_enclosed_run(mask, filled, w, h)
        enclosed_pct = 100.0 * enclosed / (w * h)
        alpha_pct = 100.0 * sum(filled) / (w * h)

        # alpha：被泛洪标到的地方透明，其余不透明；颜色沿用源图。
        # ★ 透明像素的 RGB 填**白**而不是黑：下一步 make-webp.py 用 LANCZOS 缩档时，
        #   每个通道是独立加权的（它不按 alpha 加权），透明像素的 RGB 会被拖进边缘。
        #   RGB=黑 → 缩完一圈灰边，在那片天上看得见；RGB=白 → 拖出来的是白边，
        #   而页面底色本身近白（--paper: #f4f8f9），看不见。
        out = im.convert('RGBA')
        px = out.load()
        for y in range(h):
            row = y * w
            for x in range(w):
                if filled[row + x]:
                    px[x, y] = (255, 255, 255, 0)
        out.save(dst, 'PNG')

        flags = []
        if residue:
            flags.append(f'边缘残留 {residue} px')
        if enclosed_pct > args.max_enclosed:
            flags.append(f'最大封闭近白块 {enclosed_pct:.1f}%')
        for f in flags:
            problems.append(f'{fn}: {f}')
        print(f'  {fn:18s} {w}x{h:<5}  alpha {alpha_pct:5.1f}%  '
              f'边缘残留 {residue:<7}  最大封闭白块 {enclosed_pct:4.1f}%  '
              f'抹掉噪点 {n_islands} 块/{n_island_px} px'
              + (f'  ← {"；".join(flags)}' if flags else ''))

    print(f'\n落盘 {len(files) - len(errors)} 张到 {args.dst_dir}')
    if problems:
        print(f'\n⚠ {len(problems)} 张边缘可疑，**交人眼逐张看过再往下走**：')
        for p in problems:
            print(f'   - {p}')
    if errors:
        print(f'\n✗ {len(errors)} 张判定"源图背景不是纯白"，已跳过、没有产出：')
        for e in errors:
            print(f'   - {e}')
        print('  这是回去重出图的事（提示词 §二 的【背景】那一段），不是改这里的数字。')
    if problems or errors:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
