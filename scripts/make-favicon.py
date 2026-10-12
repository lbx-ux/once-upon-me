"""从品牌标记生成 favicon：紧裁 → 圆角透明 → 16/32/48 三帧 ICO。

用法（在仓库根目录）：

    python scripts/make-favicon.py

为什么不直接把 public/brand/mark.webp 缩到 16px：那块 560 见方的取景里主体只占画布一半高，
缩到 16px 只剩一块浅色斑 —— 书变成一条细线，孩子变成一个点。所以 favicon 另取一块
以孩子为中心的 400 见方。取景与圆角的依据见 docs/brand-mark-prompt.md §四。
"""

import os
import sys

from PIL import Image, ImageDraw

# Windows 控制台默认 GBK，中文输出会变乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):  # stdout 被换成不支持 reconfigure 的对象时跳过
    pass

SRC = "public/brand/mark.webp"
OUT = "src/app/icon.ico"

SIDE = 400  # 紧裁边长（源图 560 见方）
RADIUS_RATIO = 0.22  # 对齐 .mark 的 border-radius: .2em / .78em，取整到 22%
MASTER = 128  # 先出大图再让 ICO 往下缩，圆角边缘更干净
FRAMES = [(16, 16), (32, 32), (48, 48)]


def main() -> int:
    if not os.path.exists(SRC):
        print(f"找不到源图 {SRC}")
        return 1

    mark = Image.open(SRC).convert("RGB")
    w = mark.size[0]
    # 水平取正中；竖直对准「孩子 + 书面」那一段（源图里主体的中心约在 280）
    x0 = max(0, min(w - SIDE, w // 2 - SIDE // 2))
    y0 = max(0, min(w - SIDE, 280 - SIDE // 2))

    tile = mark.crop((x0, y0, x0 + SIDE, y0 + SIDE)).resize((MASTER, MASTER), Image.LANCZOS)

    mask = Image.new("L", (MASTER, MASTER), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, MASTER - 1, MASTER - 1], int(round(MASTER * RADIUS_RATIO)), fill=255
    )
    icon = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    icon.paste(tile, (0, 0), mask)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    icon.save(OUT, format="ICO", sizes=FRAMES)

    print(f"裁切框 ({x0},{y0})-({x0 + SIDE},{y0 + SIDE})  圆角 {RADIUS_RATIO:.0%}")
    print(f"→ {OUT}  {'/'.join(str(s) for s, _ in FRAMES)} 三帧  {os.path.getsize(OUT)/1024:.1f}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
