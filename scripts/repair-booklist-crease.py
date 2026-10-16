"""灵感书单：把中缝折痕「局部修」一遍，并报出修法的三笔代价（不入库也不改交付的图）。

为什么有这个脚本
----------------
`check-booklist-art.py` 量得出折痕，但量出来之后只有两条路：**局部修** 或 **重出这张图**。
选之前得先知道"修"到底动了什么、动完之后还剩下什么、以及有没有把一条线换成另一条线。
2026-10-16 那 6 张（dino p1–p4、moon p5/p6）就是这么定下来的，判据全部落在这个脚本里，
免得下次再用一个一次性的脚本重新推一遍。

修法（**确定性的，不含生成**）
------------------------------
折痕只有 1–3 列宽，且落在平滑内容上，所以用**左右两侧干净列逐行线性插值**补回来：
  new[y][x] = L[y] + (R[y] − L[y]) * (x − xL) / (xR − xL)
要替换的列 = 以「偏离趋势最大」的那一列为峰、向两侧扩到 |偏离| < `--width` × 峰值为止的
**连续一段**。★ 用相对比例而不是固定的 8 级：8 级那一版把折痕的**肩部**也算了进去，
一次改 8–12 列；收到 25% 只要 5–10 列，而同一把尺子照样判干净（实测见下）。

三笔代价（每一笔都要报出来，别只报"修好了"）
--------------------------------------------
① **修完不是零，是压到阈值下**。逐行插值用的是邻居，邻居自己也可能带一点残余，
   所以偏离会从 −25…−33 级掉到 −1.6…−7.5 级——**低于 8 级那条线，但不等于没有**。
② **可能修出一道新棱**。左右邻居在那一行差得远时，补出来的斜坡会在带的边界留台阶。
   脚本把边界台阶与**这张图自己的列间噪声**对比：台阶 ≤ 噪声 → 看不出来；
   台阶是噪声的好几倍 → 在平滑的夜图上就是一条新的淡线（moon p5 是 4.4×）。
③ **要重编码一次**，隔着一次有损压缩再存，同画质下反而更胖（p1 要降到 q74 才塞进 220KB）。

用法
----
    python -I scripts/repair-booklist-crease.py public/booklist/dino public/booklist/moon
    python -I scripts/repair-booklist-crease.py public/booklist/moon --out .out/repair

★ 默认**只报数不落盘**。`--out` 是必填才写，而且**只写那个目录**——交付的图是用户的，
改不改由他们定（`.out/` 不在仓库里，仓库里没有任何一张"修过的成品图"）。
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import statistics
import sys
from pathlib import Path

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent

# 与 check-booklist-art.py 一致的口径：锚点各 4 列、中央 ±3 列、阈值 8 级 / 同号 90%
SPAN = 12  # 看多宽的范围来圈污染列（比判据的 ±3 宽，免得漏掉稍宽的折痕）
DELTA_ROW = 15  # 逐行"真的被改了"的级数门限（比一层水彩颗粒粗）
SPREAD_RATIO = (3, 2)  # 只修跨页（3:2）；封面是单页，没有书脊


def load(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


chk = load("check-booklist-art")
mk = load("make-webp")


def col_devs(gray: bytes, w: int, x0: int, y0: int, y1: int, ncol: int) -> list[float]:
    """逐列「减去左右锚点连成的趋势」后的偏离（级）。与判据同一个量，只是看得更宽。"""
    rows = y1 - y0
    a = chk.CREASE_ANCHOR
    lx, rx = (a - 1) / 2, ncol - 1 - (a - 1) / 2
    means = [
        sum(gray[y * w + x0 + j] for y in range(y0, y1)) / rows for j in range(ncol)
    ]
    ml, mr = means[a - 1], means[ncol - a]
    return [means[j] - (ml + (mr - ml) * (j - lx) / (rx - lx)) for j in range(ncol)]


def pick_band(devs: list[float], frac: float) -> tuple[int, int, int]:
    """返回 (峰列下标, 段首下标, 段末下标)：从峰向两侧扩到 |偏离| < frac×峰值。"""
    peak = max(range(len(devs)), key=lambda j: abs(devs[j]))
    thr = abs(devs[peak]) * frac
    lo = hi = peak
    while lo - 1 >= 0 and abs(devs[lo - 1]) >= thr:
        lo -= 1
    while hi + 1 < len(devs) and abs(devs[hi + 1]) >= thr:
        hi += 1
    return peak, lo, hi


def repair(im: Image.Image, frac: float, y0: int, y1: int):
    """在内存里修一遍，返回 (修后图, 信息字典)。不改入参、不落盘。"""
    w, h = im.size
    c = w // 2
    gray = im.convert("L").tobytes()
    devs = col_devs(gray, w, c - SPAN, y0, y1, 2 * SPAN + 1)
    peak, lo, hi = pick_band(devs, frac)
    x0 = c - SPAN
    xL, xR = x0 + lo - 1, x0 + hi + 1
    if xL < 0 or xR >= w:
        raise SystemExit("中央太窄，圈不出干净的左右邻居")
    out = im.copy()
    px, src = out.load(), im.convert("RGB").load()
    for x in range(x0 + lo, x0 + hi + 1):
        t = (x - xL) / (xR - xL)
        for y in range(y0, y1):
            l, r = src[xL, y], src[xR, y]
            px[x, y] = tuple(round(l[k] + (r[k] - l[k]) * t) for k in range(3))
    return out, {"peak": x0 + peak, "band": (x0 + lo, x0 + hi), "px_left": xL, "px_right": xR}


def removed_shape(orig: Image.Image, fixed: Image.Image, peak: int, y0: int, y1: int) -> dict:
    """峰列上被拿掉的东西：整高的一条线，还是只有几行在变的一块东西？"""
    a, b = orig.convert("L").tobytes(), fixed.convert("L").tobytes()
    w = orig.size[0]
    rows = [abs(a[y * w + peak] - b[y * w + peak]) for y in range(y0, y1)]
    hit = [d > DELTA_ROW for d in rows]
    best = cur = 0
    for f in hit:
        cur = cur + 1 if f else 0
        best = max(best, cur)
    return {
        "cov": sum(hit) / len(hit),
        "longest": best,
        "rows": len(hit),
        "mean": statistics.mean(rows),
    }


def boundary_step(fixed: Image.Image, band: tuple[int, int], y0: int, y1: int) -> dict:
    """修完在带的两条边界留下的台阶，与这张图自己的列间噪声比。"""
    g = fixed.convert("L").tobytes()
    w = fixed.size[0]
    rows = y1 - y0
    xA, xB = band

    def step(x: int) -> list[int]:
        return [abs(g[y * w + x] - g[y * w + x - 1]) for y in range(y0, y1)]

    left, right = step(xA), step(xB + 1)
    base = []
    for x in range(w // 2 + 60, min(w - 2, w // 2 + 260), 20):
        base.append(sum(abs(g[y * w + x] - g[y * w + x - 1]) for y in range(y0, y1)) / rows)
    noise = statistics.mean(base)
    return {
        "left": statistics.mean(left),
        "right": statistics.mean(right),
        "noise": noise,
        "ratio": max(statistics.mean(left), statistics.mean(right)) / noise,
    }


def encode_size(im: Image.Image) -> tuple[int, int]:
    """按 book-spread 那一档的编码梯子压一遍，返回 (质量, 字节)。"""
    budget = mk.PRESETS["book-spread"][3]
    q, n = mk.QUALITIES[-1], 0
    for q in mk.QUALITIES:
        with io.BytesIO() as buf:
            im.save(buf, format="WEBP", quality=q, method=6)
            n = buf.getbuffer().nbytes
        if n <= budget:
            return q, n
    return q, n


def is_fold(m: dict) -> bool:
    return bool(m["is_top"] and not m["thin"] and not m["mixed"])


def main() -> int:
    ap = argparse.ArgumentParser(description="局部修中缝折痕（默认只报数）")
    ap.add_argument("dirs", nargs="+", help="public/booklist 下的一本或几本")
    ap.add_argument("--out", help="修完的副本写到这个目录（不写就是不落盘）")
    ap.add_argument("--width", type=float, default=0.25, help="圈污染列的相对阈值（默认 0.25）")
    args = ap.parse_args()

    total = fixed_n = 0
    for d in args.dirs:
        root = Path(d)
        key = root.name
        for path in sorted(root.glob("p*.webp")):
            # ★ with 里读完就放：一次跑十几张时，Windows 上留着的文件句柄会让
            #   Pillow 的 webp 解码器偶发 opens 失败（could not create decoder object），
            #   那是句柄/内存的事，不是这张图坏了——别去怀疑图。
            with Image.open(path) as raw:
                im = raw.convert("RGB")
            if not im.size[0] / im.size[1] == SPREAD_RATIO[0] / SPREAD_RATIO[1]:
                continue
            total += 1
            before = chk.measure_crease(im)
            if not is_fold(before):
                continue
            fixed_n += 1
            w, h = im.size
            y0, y1 = int(h * 0.10), int(h * 0.90)
            out, info = repair(im, args.width, y0, y1)
            after = chk.measure_crease(out)
            shape = removed_shape(im, out, info["peak"], y0, y1)
            bnd = boundary_step(out, info["band"], y0, y1)
            q, size = encode_size(out)
            xA, xB = info["band"]
            verdict = "★ 仍是折痕" if is_fold(after) else "干净"
            print(
                f"\n{key}/{path.stem}  {w}×{h}"
                f"\n  修前 偏离 {before['dev']:+7.2f}  同号 {before['same']:3.0f}%  "
                f"名次 {before['rank']}/{before['n_ctrl']}  倍数 {before['ratio']:5.2f}"
                f"\n  替换 {xB - xA + 1} 列（x {xA}–{xB}，水平 {xA / w * 100:.2f}%–{xB / w * 100:.2f}%）"
                f"，左右邻居 x={info['px_left']} 与 x={info['px_right']}"
                f"\n  修后 偏离 {after['dev']:+7.2f}  同号 {after['same']:3.0f}%  "
                f"名次 {after['rank']}/{after['n_ctrl']}  倍数 {after['ratio']:5.2f}  → {verdict}"
                f"\n  ① 拿掉的东西：峰列 x={info['peak']} 上 |差|>{DELTA_ROW} 级的行 "
                f"{shape['cov'] * 100:5.1f}%（最长连续 {shape['longest']}/{shape['rows']} 行）"
                f" → {'整高的一条线' if shape['cov'] > 0.6 else '只改到一部分行（这本的折痕本来就断续）'}"
                f"\n  ② 带边界的新台阶：左 {bnd['left']:5.2f} 右 {bnd['right']:5.2f} 级，"
                f"这张图自己的列间噪声 {bnd['noise']:5.2f} 级 → {bnd['ratio']:.1f}×"
                f"（≤1× 看不出来）"
                f"\n  ③ 重编码：q{q}，{size:,} B（book-spread 预算 {mk.PRESETS['book-spread'][3]:,} B）"
            )
            if args.out:
                dst = Path(args.out) / key
                dst.mkdir(parents=True, exist_ok=True)
                out.save(dst / path.name, quality=q, method=6)

    print(
        f"\n=== 跨页 {total} 张，判为折痕 {fixed_n} 张"
        + (f"；副本写在 {args.out}" if args.out else "；只报数，没有落盘（加 --out 才写）")
        + " ==="
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
