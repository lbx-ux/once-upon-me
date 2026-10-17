#!/usr/bin/env bash
#
# backup.sh —— 每日备份（工单 11）。跑在**服务器上**，由 cron 以 root 调。
#
# ```
#   /opt/xiaozhujue/backup.sh              # 导出 + 保留 14 天 + 自查
#   /opt/xiaozhujue/backup.sh --verify     # 额外做一次**试灌**（见下）
# ```
#
# ★★ 这个脚本存在的唯一理由是「**只导出不试灌，等于没验过它是不是可用的**」（工单 11 原话）。
#    一份从没被灌回去过的 dump，只证明了 `mysqldump` 退出码是 0——
#    而"库口令改了""表名变了""导出到一半被 OOM 杀掉"，这三种都会留下
#    一个看起来正常、实际上灌不回去的文件。所以 `--verify` 那条路是**真的建一个临时库、
#    真的把 dump 灌进去、真的数一遍行**，数完再 drop。
#
# ★ 口令**不在这个脚本里**：从 `/etc/xiaozhujue/api.yml` 读（那份 640 root:xzj），
#   并且经一个 600 的临时 `--defaults-extra-file` 传给 mysqldump——
#   不用命令行上的 `-p$PASS`（那会让口令出现在 `ps` 里，任何人 `ps aux` 都看得见）。
#
# ★ 保留期是 14 天，但**到期那一天不会提醒**——所以每次跑都把"现在有几份、
#   最老的一份是哪天"打出来。交付时那句"备份在跑"要能被人看见。
#
# ★ 它**只备份数据库**。作品（`.out/web` 那批字节）不在库里，它的镜像在工单 12
#   那条单向通路上——两张网各管一半，别在这里顺手加一句 rsync 把两件事混起来。
#
set -euo pipefail
umask 077

CONF="${XZJ_CONF:-/etc/xiaozhujue/api.yml}"
DIR="${XZJ_BACKUP_DIR:-/var/backups/xiaozhujue}"
KEEP_DAYS="${XZJ_BACKUP_KEEP_DAYS:-14}"
DB="xiaozhujue"
VERIFY=0
[ "${1:-}" = "--verify" ] && VERIFY=1

mkdir -p "$DIR"

# ── 凭据：从配置文件里读，不进命令行 ─────────────────────────────────────
db_user=$(awk '/^  datasource:/{f=1} f && /^    username:/{print $2; exit}' "$CONF")
db_pass=$(awk '/^  datasource:/{f=1} f && /^    password:/{print $2; exit}' "$CONF")
if [ -z "$db_user" ] || [ -z "$db_pass" ]; then
  echo "✗ 从 $CONF 里读不到库账号（这个脚本不该猜口令）" >&2
  exit 1
fi

client_cnf=$(mktemp /tmp/xzj-backup-XXXXXX.cnf)
dump_tmp="${DIR}/.partial-$$.sql.gz"
cleanup() { rm -f "$client_cnf" "$dump_tmp"; }
trap cleanup EXIT
printf '[client]\nuser=%s\npassword=%s\n' "$db_user" "$db_pass" >"$client_cnf"

# ── 导出。★ 先写临时名、验完再改名：半个文件顶着"今天的备份"这个名字是最坏的状态
#    —— 它看起来有备份，而恢复那天才发现它截断了 ────────────────────────────
stamp=$(date +%F)
out="${DIR}/${DB}-${stamp}.sql.gz"
mysqldump --defaults-extra-file="$client_cnf" \
  --single-transaction --routines --triggers --no-tablespaces \
  "$DB" | gzip >"$dump_tmp"

# ── 自查：坏 gzip / 空文件 / 一张表都没有，三种都当失败 ────────────────────
gzip -t "$dump_tmp"
tables=$(gzip -dc "$dump_tmp" | grep -c '^CREATE TABLE' || true)
if [ "$tables" -lt 1 ]; then
  echo "✗ 导出来的东西里一张 CREATE TABLE 都没有，不敢当成备份" >&2
  exit 1
fi
mv "$dump_tmp" "$out"

# ── 保留期 ───────────────────────────────────────────────────────────────
find "$DIR" -maxdepth 1 -name "${DB}-*.sql.gz" -mtime "+${KEEP_DAYS}" -delete

# ── 账目（每次跑都打，好让人在交付说明里抄一句真话）──────────────────────
size=$(du -h "$out" | cut -f1)
kept=$(find "$DIR" -maxdepth 1 -name "${DB}-*.sql.gz" | wc -l | tr -d ' ')
oldest=$(find "$DIR" -maxdepth 1 -name "${DB}-*.sql.gz" -printf '%f\n' | sort | head -1)
echo "备份 $out（$size，$tables 张表）；库里现有 $kept 份，最老的一份是 ${oldest:-无}"

# 磁盘到 70% 就说一声——备份自己有把盘写满的那一天，而那时候没人会想到是它
used=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "$used" -ge 70 ]; then
  echo "⚠ 根分区已用 ${used}%：备份目录 $DIR 在它上面，到顶之后 mysqldump/gzip 会写失败"
fi

# ── 试灌（默认不做，cron 那条不带它）──────────────────────────────────────
if [ "$VERIFY" = "1" ]; then
  verify_db="${DB}_verify"
  # ★ 这一段走 **root 的 socket 身份**（`mysql -uroot`），不走 api.yml 里那个 xzj：
  #   试灌要建库、删库，而 `xzj` 只该有 `xiaozhujue.*` 上的权限——
  #   为了跑一次自检就给它扩权，正是"最小权限"那条要避免的事。
  #   （实测过一次：用 xzj 建 `xiaozhujue_verify` 是 `ERROR 1044 Access denied`
  #   —— 那不是脚本坏了，那是权限分得对。）
  echo "── 试灌进 $verify_db（root socket）"
  mysql -uroot \
    -e "DROP DATABASE IF EXISTS ${verify_db}; CREATE DATABASE ${verify_db} DEFAULT CHARACTER SET utf8mb4;"
  gzip -dc "$out" | mysql -uroot "$verify_db"
  # ★ 判据选"能查到人、能查到权限"，不是"导入没报错"：
  #   一个空库导入也是零报错（见工单 11 原文那句"能查到用户与权限"）
  people=$(mysql -uroot -N -e "SELECT COUNT(*) FROM ${verify_db}.users")
  admins=$(mysql -uroot -N -e \
    "SELECT COUNT(*) FROM ${verify_db}.users WHERE role='ADMIN'")
  perms=$(mysql -uroot -N -e \
    "SELECT COUNT(*) FROM ${verify_db}.user_permissions")
  voices=$(mysql -uroot -N -e \
    "SELECT COUNT(*) FROM ${verify_db}.voices")
  echo "灌回去了：users=$people（其中 ADMIN=$admins） user_permissions=$perms voices=$voices"
  if [ "$people" -lt 1 ] || [ "$admins" -lt 1 ]; then
    echo "✗ 灌回来的人不对（至少该有一个管理员）——这份备份不算数" >&2
    exit 1
  fi
  mysql -uroot -e "DROP DATABASE ${verify_db};"
  echo "试灌通过，临时库已删。"
fi
