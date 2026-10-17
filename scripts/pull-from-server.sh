#!/usr/bin/env bash
#
# pull-from-server.sh —— 把服务器上的作品与数据库快照**单向**拉回本机（工单 12）
#
# ```
#   LOCAL_MIRROR_DIR=D:/xiaozhujue-data ./scripts/pull-from-server.sh
#   LOCAL_MIRROR_DIR=D:/xiaozhujue-data ./scripts/pull-from-server.sh --full
# ```
#
# ★★ 这个脚本存在的理由是一句到期日：**服务器只租到 2027-04-15**。
#    "数据在服务器上"不是终点，"本机能独立撑起来"才是。撑起来要三样：
#    **作品镜像 + 数据库快照 + 代码**——代码在 git 里天然有，这个脚本管前两样。
#
# 四条规矩，每条都对应一个具体的坏结局：
#
# 1. **只读**。它对本机写、对服务器只发 `tar` / `ls` / `backup.sh`，
#    永远不往服务器写。★ "本机永远不往服务器写"是这一整条通路的方向性：
#    反过来的话，本机上一次误操作就能抹掉服务器上的东西，而服务器才是那份"现役的"。
#
# 2. **镜像里保住 `u/<userId>/` 那一层**。这不是备份的美学问题，是能不能用的问题：
#    工单 16 之后代码只认 `u/<id>/` 底下那一片，拉回来一棵平铺的树等于**搬丢了**。
#    （工单 12 的原文写于工单 16 之前，那时资产根是平铺的——这一条是后加的约束。）
#
# 3. **按书增量、`--full` 兜底**。判据是每个单元的一个**指纹**（文件数 + 总字节），
#    它变了就重拉。★ 而到期前那**最后一次**要用 `--full`：
#    指纹是"变了没有"的近似，而最后一次要的是"一模一样"。
#
# 4. **`thumbs/` 不拉**。它是缩略图缓存，由应用按需重算（`lib/thumbs.ts` 那张封闭档位表），
#    不是原稿。拉它会让镜像里一半的体积是派生物。
#
# ★ 数据库快照里有**手机号与密码哈希**，所以镜像必须在**项目目录之外**
#   （`LOCAL_MIRROR_DIR`，缺省 `D:/xiaozhujue-data`）：项目目录会被 git clean、
#   误删、重克隆，而这份是六个月后唯一那本凭据。也**永远不会进仓库**。
#
set -euo pipefail

HOST="${XZJ_HOST:-root@123.56.148.105}"
ASSETS="${XZJ_ASSETS:-/var/lib/xiaozhujue/assets}"
MIRROR="${LOCAL_MIRROR_DIR:-D:/xiaozhujue-data}"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

case "$MIRROR" in
  "$(pwd)"*) echo "✗ LOCAL_MIRROR_DIR 不能在项目目录里（$MIRROR）" >&2; exit 1 ;;
esac

mkdir -p "$MIRROR/assets" "$MIRROR/db"
echo "服务器  $HOST:$ASSETS"
echo "镜像    $MIRROR（$( [ "$FULL" = 1 ] && echo '全量' || echo '增量' )）"
echo

# ── 服务器上有什么：一个人一片，每片底下是 books/<书号>/ · cards/<卡号>/ · children/<id>.json
#    ★ 只列这一层的**名字**，路径拼接留在本机做：远端命令越短，越不容易被引号咬到
remote_list() {
  ssh -o BatchMode=yes "$HOST" "cd '$ASSETS' 2>/dev/null || exit 0
    for slice in u/*/; do
      [ -d \"\$slice\" ] || continue
      id=\$(basename \"\$slice\")
      for b in \"\$slice\"books/*/; do [ -d \"\$b\" ] && echo \"book \$id \$(basename \"\$b\")\"; done
      for c in \"\$slice\"cards/*/; do [ -d \"\$c\" ] && echo \"card \$id \$(basename \"\$c\")\"; done
      for k in \"\$slice\"children/*.json; do [ -f \"\$k\" ] && echo \"child \$id \$(basename \"\$k\")\"; done
      [ -f \"\$slice\"kids.json ] && echo \"kids \$id kids.json\"
    done"
}

# 一个单元的指纹：文件数 + 总字节。★ 用 `find | wc -l` 与 `du -sb` 而不是 mtime：
# 一本书里的文件会被就地重写（重画一页），而目录本身的 mtime 不会动
remote_fingerprint() {
  local rel="$1"
  ssh -o BatchMode=yes "$HOST" \
    "cd '$ASSETS' 2>/dev/null || exit 0
     n=\$(find '$rel' -type f 2>/dev/null | wc -l)
     s=\$(du -sb '$rel' 2>/dev/null | cut -f1)
     echo \"\$n \$s\""
}

pulled=0; skipped=0; failed=0
while read -r kind id name; do
  [ -n "${kind:-}" ] || continue
  case "$kind" in
    book) rel="u/$id/books/$name" ;;
    card) rel="u/$id/cards/$name" ;;
    child) rel="u/$id/children/$name" ;;
    kids) rel="u/$id/kids.json" ;;
  esac
  local_path="$MIRROR/assets/$rel"

  if [ "$FULL" = 0 ] && [ -e "$local_path" ]; then
    remote_fp=$(remote_fingerprint "$rel")
    local_fp=$(printf '%s %s' \
      "$(find "$local_path" -type f 2>/dev/null | wc -l | tr -d ' ')" \
      "$(du -sb "$local_path" 2>/dev/null | cut -f1)")
    if [ "$remote_fp" = "$local_fp" ]; then
      skipped=$((skipped + 1))
      continue
    fi
  fi

  mkdir -p "$(dirname "$local_path")"
  # ★ 打到一个临时名再改名：半个目录顶着真名 = "看着有、其实是残的"
  rm -rf "$local_path.partial"
  if ssh -o BatchMode=yes "$HOST" "cd '$ASSETS' && tar -cf - '$rel'" \
      | tar -C "$MIRROR/assets" -xf - --transform "s|^$rel|$rel.partial|"; then
    rm -rf "$local_path"
    mv "$local_path.partial" "$local_path"
    pulled=$((pulled + 1))
  else
    rm -rf "$local_path.partial"
    echo "✗ 这一项没拉下来：$rel" >&2
    failed=$((failed + 1))
  fi
done < <(remote_list)

echo "作品：拉了 $pulled 项、跳过 $skipped 项（指纹没变）$( [ "$failed" -gt 0 ] && echo "、失败 $failed 项" )"
if [ "$pulled" = 0 ] && [ "$skipped" = 0 ] && [ "$failed" = 0 ]; then
  echo "      ★ 服务器上目前一项作品都没有——这是实话，不是拉失败"
fi

# ── 数据库快照：让服务器自己导出（它那边有脚本、有口令），再把最新那份拿回来 ────
echo
echo "数据库快照"
ssh -o BatchMode=yes "$HOST" "/opt/xiaozhujue/backup.sh" | sed 's/^/  /'
newest=$(ssh -o BatchMode=yes "$HOST" "ls -1t /var/backups/xiaozhujue/*.sql.gz | head -1")
scp -q -o BatchMode=yes "$HOST:$newest" "$MIRROR/db/"
echo "  拉回 $(basename "$newest") → $MIRROR/db/"

echo
echo "下一步（这一条是给六个月后的自己）："
echo "  node scripts/verify-mirror.mts --dir=$MIRROR/assets"
