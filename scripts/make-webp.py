"""把原始绘本封面 JPG 压成首屏可用的 WebP（可整批 12 张，也可只跑替换的几张）。

用法（源图目录与产出目录都由参数传入；加 -I 跑，避免源图目录里的同名模块被
import —— 源图是外部下载物，不当作可信代码）：

    python -I scripts/make-webp.py <源图目录> public/art

例：把一批 1376×768 的 JPG 压到本仓库的 public/art：

    python -I scripts/make-webp.py ../arc public/art

策略：
  1. 居中裁成精确 16:9（源图 1376×768 = 1.7917，只需每边去掉约 5px —— 其实
     .hero-orbit__item img { object-fit: cover } 本来也会做这件事，这一步只是
     让「文件比例 = 卡片比例」，避免 cover 再随机裁掉别的东西）
  2. 缩到 1280×720（卡片最大显示宽 318px，2× 屏需 636px，1280 有 2 倍余量）
  3. WebP 从 q=78 往下试，取第一个 ≤130KB 的质量；全部落盘后打印单张与合计体积
"""
import sys
import os
from PIL import Image

# Windows 控制台默认 GBK，中文输出会变乱码
try:
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError):  # stdout 被换成不支持 reconfigure 的对象时跳过
    pass

TARGET_W, TARGET_H = 1280, 720
MAX_BYTES = 130 * 1024
QUALITIES = [78, 74, 70, 66, 62, 58, 54]


def crop_to_16_9(im: Image.Image) -> Image.Image:
    w, h = im.size
    target = 16 / 9
    if w / h > target:
        nw, nh = int(h * target), h
    else:
        nw, nh = w, int(w / target)
    x0, y0 = (w - nw) // 2, (h - nh) // 2
    return im.crop((x0, y0, x0 + nw, y0 + nh))


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src_dir, dst_dir = sys.argv[1], sys.argv[2]
    os.makedirs(dst_dir, exist_ok=True)

    files = sorted(f for f in os.listdir(src_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    print(f'{len(files)} 张源图  源目录={src_dir}  目标目录={dst_dir}\n')

    total = 0
    src_total = 0
    rows = []
    for fn in files:
        src = os.path.join(src_dir, fn)
        src_total += os.path.getsize(src)
        with Image.open(src) as raw:
            im = crop_to_16_9(raw.convert('RGB')).resize((TARGET_W, TARGET_H), Image.LANCZOS)
        dst = os.path.join(dst_dir, os.path.splitext(fn)[0] + '.webp')
        chosen, blob = None, None
        for q in QUALITIES:
            im.save(dst, 'WEBP', quality=q, method=6)
            size = os.path.getsize(dst)
            if size <= MAX_BYTES:
                chosen, blob = q, size
                break
        if chosen is None:  # 最低质量仍超标 → 保留最后一次尝试并告警
            chosen, blob = QUALITIES[-1], size
        total += blob
        rows.append((os.path.basename(dst), f'{TARGET_W}x{TARGET_H}', chosen, blob))
        flag = '' if blob <= MAX_BYTES else '  ← 超标'
        print(f'  {rows[-1][0]:12s} q={chosen:<3} {blob/1024:6.0f} KB{flag}')

    budget = MAX_BYTES * len(rows)
    print(f'\n合计 {total/1024/1024:.2f} MB / {len(rows)} 张'
          f'（逐张上限 {MAX_BYTES//1024}KB，整包预算 {budget/1024/1024:.2f} MB）'
          f'  平均每张 {total/len(rows)/1024:.0f} KB')
    print(f'源图合计 {src_total/1024/1024:.2f} MB → 压缩比 {src_total/total:.1f}×')
    return 0 if total <= budget else 1


if __name__ == '__main__':
    sys.exit(main())
