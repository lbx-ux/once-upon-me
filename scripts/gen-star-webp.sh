#!/usr/bin/env bash
# 把 star 这本的「源图」转成站点用的 WebP，落盘到 public/booklist/star/。
#
# 用法：
#   1) 用 docs/booklist/star-gen-prompts.md 里的提示词出图
#   2) 把源图放进 .scratch/star-src/ ，命名为 cover.jpg / p1.jpg … p8.jpg
#   3) 运行本脚本：  bash scripts/gen-star-webp.sh
#
# 封面走 book-cover（3:4，≤150KB），跨页走 book-spread（3:2，≤220KB）。
# 看到「偏小」告警请回头按提示词尺寸重出图（脚本只裁不补，绝不放大）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 源图目录：默认用 star-clean（已去水印的成图）；也可作为第 1 个参数传入
SRC="${1:-$ROOT/.scratch/star-clean}"
DST="$ROOT/public/booklist/star"
# 用本机带 PIL 的 Python（managed 3.13.12）
PY="${PYTHON_EXE:-/c/Users/fanji/.workbuddy/binaries/python/versions/3.13.12/python.exe}"
MAKE="$ROOT/scripts/make-webp.py"

if [ ! -d "$SRC" ]; then
  echo "✗ 源图目录不存在：$SRC" >&2
  echo "  请先把 cover.jpg / p1.jpg … p8.jpg 放进去（见 docs/booklist/star-gen-prompts.md）。" >&2
  exit 2
fi

mkdir -p "$DST"

echo "==> 封面（book-cover, 2:3→3:4, ≤150KB）"
"$PY" -I "$MAKE" "$SRC" "$DST" --preset book-cover --match 'cover*'

echo "==> 跨页（book-spread, 3:2, ≤220KB，不裁）"
"$PY" -I "$MAKE" "$SRC" "$DST" --preset book-spread --match 'p*'

echo
echo "✓ 完成。产物在：$DST"
echo "  若有「偏小」告警，请按提示词尺寸重出源图，不要改脚本数字。"
