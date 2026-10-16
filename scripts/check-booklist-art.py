#!/usr/bin/env python
"""灵感书单：跨页成图的几何验收（入库脚本，对应 docs/booklist/README.md §2.4 / §2.5）。

为什么要有这个脚本：三条硬约束里，前两条（四边出血、中央不得有折痕/接缝）是**纯几何**，
每拿到一本新图都该重跑一遍。方法写在文档里，但"数字要能复现"要求**脚本也留在仓库**，
而不是每次现写一个一次性的（那正是第一本 `dino` 漏掉中央折痕的原因，见 §2.5）。

用法：

    python -I scripts/check-booklist-art.py public/booklist/moon
    python -I scripts/check-booklist-art.py public/booklist/dino --subject-hair --subject-coat

判据（阈值与实测出处见 README §2.4 / §2.5）：

  ① 四边出血   外缘 8% 的纯白比例 / 近白比例——都该是 0
  ② 中央折痕   中央 ±3 列里，最偏离「左右锚点连出的平滑趋势」的那一列，偏离多少级亮度；
               同一量在画面别处 20 个位置也量一遍当这个自己的基线。
               折痕 = 「偏离 ≥8 级 且 逐行同号 ≥90% 且 在这 21 个位置里排第 1」
  ③ 中缝带     带内/带外"列差峰值"比——★ 这条对 **1px 细线是瞎的**（100px 窗口把它稀释掉），
               只用来量"有没有成片的主色块穿过中缝"（README §2.4 那张表里的第三行）
  ④ 主体代理   `--subject-hair`：乌黑头发（暗且不饱和）在中缝那一窗的像素数 ÷ 最密那一窗（<0.35 才过）
  ⑤ 主体代理   `--subject-coat`：外套那抹橙（色相 5–45°、饱和 ≥0.43、V ≥150）最密那一窗的中心；
               与每条提示词里**写死**的主体水平位置对（README §2.4 那张表里的第二行）。
               ★ 暖色不等于外套：阳光与落叶的色相和外套重叠，分开靠饱和度。
               这两条**只对穿橙色外套的书**有意义；夜里那本没有外套，④ 才是它的代理。

只是**量**，不做判断也不改图：判过与否由人看着数字定（裁切与前端都救不了 ①②）。
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

# —— 判据里的常数，改这里要先改 README 的实测记录 ——
EDGE = 0.08  # "外缘 8%"
PURE_WHITE = 250  # 三通道都 ≥ 此值算纯白
NEAR_WHITE = 235  # 三通道都 ≥ 此值算近白
CREASE_COLS = 3  # 中央 ±3 列里找最偏离的那一列（真折痕就落在正中那一两列）
CREASE_ANCHOR = 4  # 趋势锚点各取 4 列（c±4…c±7），它们必须干净
CREASE_MIN_DEV = 8.0  # 偏离平滑趋势的亮度下限（级）
CREASE_SAME_SIGN = 0.90  # 同号行占比到 90% 才算"一条线"
CREASE_N_CTRL = 20  # 控制位个数
BAND = (0.46, 0.54)  # 书脊带
HAIR_V_MAX = 90  # 乌黑的头发：亮度上限
HAIR_S_MAX = 0.35  # 细彩铅轮廓线比它浅、比它灰
WIN = 100  # 列方向滑窗宽度
COAT_HUE = (5, 45)  # 外套布那抹橙的色相窗
COAT_S_MIN = 0.43
COAT_V_MIN = 150 / 255  # 与 README §2.4 那张表一致（V ≥150）

RGB_STEP = 3  # tobytes() 的字节步长


def luminance(rgb):
    r, g, b = rgb
    return 0.299 * r + 0.587 * g + 0.114 * b


def saturation(rgb):
    r, g, b = rgb
    hi, lo = max(rgb), min(rgb)
    return 0.0 if hi == 0 else (hi - lo) / hi


def measure_bleed(im):
    """① 四边出血：外缘 8% 的纯白/近白比例。"""
    w, h = im.size
    dx, dy = int(w * EDGE), int(h * EDGE)
    strips = {
        "上": im.crop((0, 0, w, dy)),
        "下": im.crop((0, h - dy, w, h)),
        "左": im.crop((0, 0, dx, h)),
        "右": im.crop((w - dx, 0, w, h)),
    }
    out = {}
    for name, s in strips.items():
        b = s.convert("RGB").tobytes()
        n = len(b) // RGB_STEP
        pure = near = 0
        for i in range(0, len(b), RGB_STEP):
            lo = min(b[i], b[i + 1], b[i + 2])
            if lo >= PURE_WHITE:
                pure += 1
                near += 1
            elif lo >= NEAR_WHITE:
                near += 1
        out[name] = (pure / n * 100, near / n * 100)
    return out


def _trend_dev(gray, x0, y0, x1, y1, xc, half):
    """在 [x0,x1)×[y0,y1) 这块里，量 x=xc 相对「左右锚点连线」的偏离。

    ★ 为什么不是"与画面别处的台阶比"：整幅对比度高的图（蕨叶、树影）控制位本身就大，
    dino p1 那条 17 级的 1px 线会被摊薄成 1.6 倍而漏掉。
    折痕的物理形状是**局部的**：左右各 4 列做锚点、中间线性插值，
    中央那一两列若系统性偏离这条趋势线，就是一条竖线；
    光照渐变（斜的）与物体竖边都会**顺着**趋势线走，偏离不显著。
    ★ 趋势线**逐行**重算（每行的左右锚点各自取均值）：一整列的明暗渐变是斜的，
    用一条全图趋势线去减，会把渐变本身算成"偏离"。
    """
    ncol = x1 - x0
    a = CREASE_ANCHOR
    data = list(gray.crop((x0, y0, x1, y1)).tobytes())
    rows = y1 - y0
    lx, rx = (a - 1) / 2, ncol - 1 - (a - 1) / 2

    def row_trend(r, i):
        base = r * ncol
        li = sum(data[base + j] for j in range(a)) / a
        ri = sum(data[base + ncol - a + j] for j in range(a)) / a
        return li + (ri - li) * (i - lx) / (rx - lx)

    # 列均值只用来量"这条线有几列宽"与挑最偏的那一列
    means = [
        sum(data[r * ncol + j] for r in range(rows)) / rows for j in range(ncol)
    ]
    ml, mr = means[a - 1], means[ncol - a]
    base_devs = [means[j] - (ml + (mr - ml) * (j - lx) / (rx - lx)) for j in range(ncol)]

    centre = (ncol - 1) / 2
    i0 = int(round(centre - half))
    best = (0.0, None, 0.0)
    for i in range(i0, i0 + 2 * half + 1):
        devs = [data[r * ncol + i] - row_trend(r, i) for r in range(rows)]
        m = sum(devs) / rows
        if abs(m) > abs(best[0]):
            pos = sum(1 for d in devs if d > 0) / rows
            neg = sum(1 for d in devs if d < 0) / rows
            best = (m, i, max(pos, neg) * 100)
    m, i, same = best
    width = sum(
        1
        for j in range(i0, i0 + 2 * half + 1)
        if abs(base_devs[j]) >= abs(m) * 0.6
    )
    return {"dev": m, "x": x0 + i, "same": same, "width": width}


def measure_crease(im):
    """② 中央折痕：中央 ±3 列偏离「左右锚点连线」多少，并与画面别处 20 个位置比。"""
    w, h = im.size
    y0, y1 = int(h * 0.10), int(h * 0.90)
    gray = im.convert("L")
    span = CREASE_ANCHOR + CREASE_COLS  # 锚点 4 列 + 中央 3 列
    c = w // 2
    if c - span < 0 or c + span >= w:
        return None
    cen = _trend_dev(gray, c - span, y0, c + span + 1, y1, c, CREASE_COLS)

    ctrl = []
    for n in range(1, CREASE_N_CTRL + 1):
        x = int(w * n / (CREASE_N_CTRL + 1))
        if abs(x - c) < w * 0.08 or x - span < 0 or x + span >= w:
            continue
        ctrl.append(abs(_trend_dev(gray, x - span, y0, x + span + 1, y1, x, CREASE_COLS)["dev"]))
    cmean = sum(ctrl) / len(ctrl) if ctrl else 0.0
    cmax = max(ctrl) if ctrl else 0.0
    rank = sum(1 for v in ctrl if v > abs(cen["dev"])) + 1
    cen.update(
        {
            "frac": cen["x"] / w,
            "ctrl_mean": cmean,
            "ctrl_max": cmax,
            "rank": rank,
            "n_ctrl": len(ctrl),
            "ratio": abs(cen["dev"]) / cmean if cmean else 0.0,
            "thin": abs(cen["dev"]) < CREASE_MIN_DEV,
            "mixed": cen["same"] < CREASE_SAME_SIGN * 100,
            "is_top": rank == 1 and abs(cen["dev"]) > cmax,
        }
    )
    return cen


def _column_means(gray, x0, x1, y0, y1):
    """列均值（一次 tobytes，省得按列反复裁）。"""
    ncol = x1 - x0
    data = list(gray.crop((x0, y0, x1, y1)).tobytes())
    rows = y1 - y0
    out = [0.0] * ncol
    for r in range(rows):
        base = r * ncol
        for j in range(ncol):
            out[j] += data[base + j]
    return [v / rows for v in out]


def measure_gutter(im):
    """③ 中缝带：带内/带外的列差峰值比。★ 对 1px 细线是瞎的。"""
    w, h = im.size
    y0, y1 = int(h * 0.10), int(h * 0.90)
    prof = _column_means(im.convert("L"), 0, w, y0, y1)
    diff = [abs(prof[i + 1] - prof[i]) for i in range(len(prof) - 1)]
    lo, hi = int(w * BAND[0]), int(w * BAND[1])
    inb = diff[lo:hi]
    outb = diff[:lo] + diff[hi:]

    def peak(seq):
        if len(seq) < WIN:
            return max(seq) if seq else 0.0
        acc = sum(seq[:WIN])
        best = acc
        for i in range(WIN, len(seq)):
            acc += seq[i] - seq[i - WIN]
            best = max(best, acc)
        return max(best, acc)

    pin, pout = peak(inb), peak(outb)
    return {"in": pin, "out": pout, "ratio": pin / pout if pout else 0.0}


def measure_hair(im):
    """④ 主体代理：乌黑头发（暗且不饱和）在中缝那一窗 vs 最密那一窗。"""
    return _window_ratio(im, lambda r, g, b: luminance((r, g, b)) < HAIR_V_MAX
                         and saturation((r, g, b)) < HAIR_S_MAX)


def _hsv(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    v = mx / 255
    s = 0.0 if mx == 0 else (mx - mn) / mx
    if mx == mn:
        return 0.0, s, v
    if mx == r:
        h = (60 * (g - b) / (mx - mn)) % 360
    elif mx == g:
        h = 60 * (b - r) / (mx - mn) + 120
    else:
        h = 60 * (r - g) / (mx - mn) + 240
    return h, s, v


def _is_coat(r, g, b):
    hue, sat, val = _hsv(r, g, b)
    return 5 <= hue <= 45 and sat >= 0.43 and val >= COAT_V_MIN


def _window_peaks(im, pred):
    """把 pred 命中的像素按列数进 100px 滑窗，返回 (窗计数列表, 半宽)。"""
    w, h = im.size
    small = im.resize((w // 2, h // 2), Image.BILINEAR).convert("RGB")
    w2, h2 = small.size
    b = small.tobytes()
    dark = bytearray(w2 * h2)
    for i in range(w2 * h2):
        if pred(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]):
            dark[i] = 1
    colsum = [0] * (w2 + 1)
    for c in range(w2):
        colsum[c + 1] = colsum[c] + sum(dark[r * w2 + c] for r in range(h2))
    half = WIN // 4  # 窗口宽 WIN//2 半像素
    counts = [
        (colsum[min(w2, x + half)] - colsum[max(0, x - half)], x)
        for x in range(0, w2 + 1, max(1, w2 // 240))
    ]
    return counts, w2


def _window_ratio(im, pred):
    counts, w2 = _window_peaks(im, pred)
    c = w2 // 2
    band = [(n, x) for n, x in counts if abs(x - c) < w2 * (BAND[1] - BAND[0]) / 2]
    in_band = max(band)[0] if band else 0
    busiest = max(counts)[0] if counts else 0
    return {
        "band": in_band,
        "busiest": busiest,
        "ratio": in_band / busiest if busiest else 0.0,
    }


def measure_coat_window(im):
    counts, w2 = _window_peaks(im, _is_coat)
    n, x = max(counts)
    return {"peak": n, "frac": x / w2}


def images_in(d, pages):
    if pages:
        names = [p.strip() for p in pages.split(",") if p.strip()]
    else:
        names = [p.stem for p in d.glob("*.webp")]
        names.sort(key=lambda s: (s != "cover", s))
    return [d / f"{n}.webp" for n in names]


def main():
    try:  # Windows 控制台默认 GBK，中文表格会炸
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # pragma: no cover
        pass
    ap = argparse.ArgumentParser(description="灵感书单跨页成图的几何验收")
    ap.add_argument("dir", type=Path, help="public/booklist/<key>")
    ap.add_argument("--pages", help="只查这几张，逗号分隔（默认全部 .webp，cover 在前）")
    ap.add_argument("--subject-hair", action="store_true", help="加量④：乌黑头发当主体代理")
    ap.add_argument("--subject-coat", action="store_true", help="加量⑤：外套那抹橙最密窗的中心")
    args = ap.parse_args()

    paths = images_in(args.dir, args.pages)
    if not paths:
        print(f"{args.dir} 里没有 .webp")
        return 1

    print(f"查 {args.dir}（{len(paths)} 张）\n")
    print(f"{'图':<8}{'尺寸':>12}{'纯白%':>16}{'近白%':>16}   ← ① 四边出血（应为 0）")
    for p in paths:
        im = Image.open(p).convert("RGB")
        b = measure_bleed(im)
        pure = "/".join(f"{b[e][0]:.1f}" for e in ("上", "下", "左", "右"))
        near = "/".join(f"{b[e][1]:.1f}" for e in ("上", "下", "左", "右"))
        print(f"{p.stem:<8}{f'{im.width}×{im.height}':>12}{pure:>16}{near:>16}")

    print(
        f"\n{'图':<8}{'偏离':>8}{'水平%':>8}{'同号%':>7}{'宽':>4}"
        f"{'控制位均':>10}{'控制位最大':>11}{'名次':>8}{'倍数':>7}   ← ② 中央折痕"
    )
    for p in paths:
        im = Image.open(p).convert("RGB")
        c = measure_crease(im)
        if c is None:
            print(f"{p.stem:<8}  图太窄，量不了")
            continue
        if c["is_top"] and not c["thin"] and not c["mixed"]:
            flag = "  ★ 折痕"
        elif c["is_top"] and c["thin"]:
            flag = "  ← 第一但量级不足"
        elif c["is_top"]:
            flag = "  ← 第一、量级够，但贯穿不满"
        elif not c["thin"]:
            flag = "  ← 不是第一，可疑"
        else:
            flag = ""
        print(
            f"{p.stem:<8}{c['dev']:>8.2f}{c['frac'] * 100:>7.1f}%{c['same']:>7.0f}"
            f"{c['width']:>4}{c['ctrl_mean']:>10.2f}{c['ctrl_max']:>11.2f}"
            f"{c['rank']:>6}/{c['n_ctrl']}{c['ratio']:>7.2f}{flag}"
        )

    print(f"\n{'图':<8}{'带内峰值':>10}{'带外峰值':>10}{'比值':>8}   ← ③ 中缝带（对 1px 细线是瞎的）")
    for p in paths:
        im = Image.open(p).convert("RGB")
        g = measure_gutter(im)
        print(f"{p.stem:<8}{g['in']:>10.1f}{g['out']:>10.1f}{g['ratio']:>8.2f}")

    if args.subject_hair:
        print(f"\n{'图':<8}{'中缝窗':>9}{'最密窗':>9}{'比值':>8}   ← ④ 乌黑头发（脸的代理，<0.35 才过）")
        for p in paths:
            im = Image.open(p).convert("RGB")
            s = measure_hair(im)
            print(f"{p.stem:<8}{s['band']:>9}{s['busiest']:>9}{s['ratio']:>8.2f}")

    if args.subject_coat:
        print(
            f"\n{'图':<8}{'最密窗像素':>12}{'窗中心水平%':>13}"
            "   ← ⑤ 外套那抹橙（身体的代理；与提示词写死的位置对) "
        )
        for p in paths:
            im = Image.open(p).convert("RGB")
            s = measure_coat_window(im)
            print(f"{p.stem:<8}{s['peak']:>12}{s['frac'] * 100:>12.1f}%")

    print(
        "\n判读：① 全是 0 才过。"
        f"\n      ② 折痕 = 「偏离 ≥{CREASE_MIN_DEV:.0f} 级 且 同号 ≥{CREASE_SAME_SIGN * 100:.0f}% "
        "且 在中央与 20 个控制位里排第 1」——三个都满足才叫一条线；"
        "\n         排第一但量级不足 = 只是这一处内容陡；量级够但不是第一 = 画面别处也有同样的陡。"
        "\n         宽度那一栏是「要修几列」：1–2 列 = 折痕，几十列 = 物体竖边。"
        "\n      ③ 比值 ≳1.8 只是可疑，要拿 ② 复核（它对 1px 线是瞎的）。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
