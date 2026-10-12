"""把原始插画 JPG/PNG 压成站点可用的 WebP（可整批，也可只跑替换的几张）。

用法（源图目录与产出目录都由参数传入；加 -I 跑，避免源图目录里的同名模块被
import —— 源图是外部下载物，不当作可信代码）：

    python -I scripts/make-webp.py <源图目录> <产出目录> [--preset <名>] [选项]

三个预设（不传 --preset 就是 hero，行为与加预设之前一字不差）：

  hero         16:9  1280  ≤130KB   首屏 12 张卡片封面
  book-spread   3:2  1536  ≤220KB   绘本内页跨页（书脊在正中，主体必须避开中缝）
  book-cover    3:4  1024  ≤150KB   绘本竖版封面

例：首屏 12 张、演示书的一个封面与四个跨页——

    python -I scripts/make-webp.py <源图目录> public/art
    python -I scripts/make-webp.py <源图目录> public/book \\
        --preset book-cover --match 'rocket*' --name cover
    python -I scripts/make-webp.py <源图目录> public/book --preset book-spread --match 'spread-*'

选项：
  --match <glob>   只处理文件名匹配该 glob 的源图（不区分大小写）
  --name <词干>    重命名产出（仅在命中恰好 1 张时允许，避免静默互相覆盖）

策略：
  1. 居中裁成预设比例。跨页**本来不裁**：它的源图就是 3:2，预设也是 3:2，
     这一步对它是恒等变换 —— 这是 2026-10-12 定的：**页面比例 = 半张跨页 = 3:4，
     与 3:4 的封面严丝合缝**，不再把 3:2 上下各砍 12% 去凑 2:1（那 12% 是照裁后
     画面构的图，砍掉不划算）。封面仍要裁：出图只给 2:3，得裁到 3:4，
     提示词里的安全边距就是留给这一刀的。
  2. 缩到预设宽度。★ **绝不放大**：裁完若比预设窄，就按原样落盘并打 `偏小`
     告警 —— 缺的像素补不回来，放大只会把糊变成更贵的糊。看到这个告警应当
     回头按提示词里写的尺寸重出图，而不是改这个数字。
  3. WebP 从 q=78 往下试，取第一个 ≤ 预算的质量；全部落盘后打印单张与合计体积。
"""
import sys
import os
import fnmatch
import argparse
from PIL import Image

# Windows 控制台默认 GBK，中文输出会变乱码
try:
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError):  # stdout 被换成不支持 reconfigure 的对象时跳过
    pass

# 名 → (比例宽, 比例高, 目标宽 px, 单张上限 bytes)
PRESETS = {
    'hero':        (16, 9, 1280, 130 * 1024),
    'book-spread': (3, 2, 1536, 220 * 1024),
    'book-cover':  (3, 4, 1024, 150 * 1024),
}
DEFAULT_PRESET = 'hero'
QUALITIES = [78, 74, 70, 66, 62, 58, 54]


def crop_to_ratio(im: Image.Image, rw: int, rh: int) -> Image.Image:
    """居中裁到 rw:rh。只裁不补 —— 宁可留边也不拉伸。"""
    w, h = im.size
    target = rw / rh
    if w / h > target:
        nw, nh = int(h * target), h
    else:
        nw, nh = w, int(w / target)
    x0, y0 = (w - nw) // 2, (h - nh) // 2
    return im.crop((x0, y0, x0 + nw, y0 + nh))


def fit_width(im: Image.Image, target_w: int) -> tuple[Image.Image, bool]:
    """缩到 target_w 宽。返回 (图, 是否发生了降级 —— 源比目标窄)。"""
    w, h = im.size
    if w <= target_w:
        return im, True
    return im.resize((target_w, max(1, round(h * target_w / w))), Image.LANCZOS), False


def resolve_sources(src_dir: str, match: str | None) -> list[str]:
    names = [f for f in os.listdir(src_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    if match:
        names = [f for f in names if fnmatch.fnmatch(f.lower(), match.lower())]
    return sorted(names)


def main() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('src_dir')
    ap.add_argument('dst_dir')
    ap.add_argument('--preset', default=DEFAULT_PRESET, choices=sorted(PRESETS))
    ap.add_argument('--match')
    ap.add_argument('--name')
    ap.add_argument('-h', '--help', action='store_true')
    args = ap.parse_args()

    if args.help:
        print(__doc__)
        return 2

    rw, rh, target_w, max_bytes = PRESETS[args.preset]
    src_dir, dst_dir = args.src_dir, args.dst_dir
    os.makedirs(dst_dir, exist_ok=True)

    files = resolve_sources(src_dir, args.match)
    if not files:
        print(f'没有匹配的源图（--match {args.match!r}）')
        return 2
    if args.name and len(files) != 1:
        print(f'--name 只在命中恰好 1 张时可用，当前命中 {len(files)} 张：'
              f'会静默互相覆盖，已中止')
        return 2

    print(f'预设 {args.preset}  {rw}:{rh}  目标宽 {target_w}px  单张上限 {max_bytes // 1024}KB')
    print(f'{len(files)} 张源图  源目录={src_dir}  目标目录={dst_dir}\n')

    total = 0
    src_total = 0
    undersized = []
    rows = []
    for fn in files:
        src = os.path.join(src_dir, fn)
        src_total += os.path.getsize(src)
        with Image.open(src) as raw:
            cropped = crop_to_ratio(raw.convert('RGB'), rw, rh)
            im, degraded = fit_width(cropped, target_w)
        out_w, out_h = im.size
        stem = args.name or os.path.splitext(fn)[0]
        dst = os.path.join(dst_dir, stem + '.webp')

        chosen, blob = None, None
        for q in QUALITIES:
            im.save(dst, 'WEBP', quality=q, method=6)
            size = os.path.getsize(dst)
            if size <= max_bytes:
                chosen, blob = q, size
                break
        if chosen is None:  # 最低质量仍超标 → 保留最后一次尝试并告警
            chosen, blob = QUALITIES[-1], size
        total += blob
        rows.append((os.path.basename(dst), f'{out_w}x{out_h}', chosen, blob))
        flags = []
        if blob > max_bytes:
            flags.append('超标')
        if degraded:
            flags.append(f'偏小（源裁后仅 {cropped.size[0]}px，需 ≥{target_w}px）')
            undersized.append(os.path.basename(dst))
        print(f'  {rows[-1][0]:14s} {out_w}x{out_h:<5} q={chosen:<3} {blob/1024:6.0f} KB'
              + (f'  ← {"；".join(flags)}' if flags else ''))

    budget = max_bytes * len(rows)
    print(f'\n合计 {total/1024/1024:.2f} MB / {len(rows)} 张'
          f'（逐张上限 {max_bytes//1024}KB，整包预算 {budget/1024/1024:.2f} MB）'
          f'  平均每张 {total/len(rows)/1024:.0f} KB')
    print(f'源图合计 {src_total/1024/1024:.2f} MB → 压缩比 {src_total/total:.1f}×')
    if undersized:
        print(f'\n⚠ {len(undersized)} 张分辨率不足、是按源尺寸落盘的：{"、".join(undersized)}')
        print('  像素补不回来 —— 请按提示词里的出图尺寸重出这些图，别改这里的数字。')
    return 0 if total <= budget else 1


if __name__ == '__main__':
    sys.exit(main())
