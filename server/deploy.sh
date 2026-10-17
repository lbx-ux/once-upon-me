#!/usr/bin/env bash
#
# deploy.sh —— 把后端部署到服务器上（工单 03）
#
# ```
#   ./server/deploy.sh              # 构建 → 上传 → 重启 → 冒烟
#   XZJ_HOST=root@1.2.3.4 ./server/deploy.sh
# ```
#
# ★ 为什么是"本机构建、上传 jar"，而不是"服务器上 git pull + mvn package"：
#   服务器是 2C2G，`mvn package` 在那上面要吃掉一多半内存（还得跟 MySQL 抢），
#   而本机本来就装着 Maven 与那份依赖缓存。构建在哪台机器上做，是这一条的全部内容。
#
# ★ 冒烟**必须带重试**：`systemctl restart` 之后进程要几秒才 listening，
#   而"重启完立刻 curl"在慢机器上会偶发地红一次——那种红会让人学会忽略这个脚本。
#   所以这里是"最多等 60 秒，每 3 秒问一次"，超时才判失败。
#
# ★ 它**不碰配置**：`/etc/xiaozhujue/api.yml` 里是口令与密钥，它们在服务器上，
#   这个脚本只换 jar。想改配置就 ssh 上去改那个文件再 `systemctl restart`。
#   （「部署会擦掉配置」是一次真实的数据损失，这里用"根本不碰"来避免它。）
#
set -euo pipefail

HOST="${XZJ_HOST:-root@123.56.148.105}"
REMOTE_JAR="/opt/xiaozhujue/server/app.jar"
SERVICE="xiaozhujue-api"
JAR="server/target/xiaozhujue-api.jar"

cd "$(dirname "$0")/.."

echo "── 构建（跳过测试：测试是提交前那道闸门的事，不是部署这一步的）"
mvn -o -q -f server/pom.xml -DskipTests package
test -f "$JAR" || { echo "没构建出 $JAR"; exit 1; }
ls -lh "$JAR" | awk '{print "  " $5 "  " $9}'

echo "── 上传到 $HOST"
scp -q "$JAR" "$HOST:$REMOTE_JAR"

echo "── 重启 $SERVICE"
ssh "$HOST" "systemctl restart $SERVICE"

echo "── 冒烟（最多等 60 秒）"
for i in $(seq 1 20); do
  code=$(ssh "$HOST" "curl -s -m 5 -o /dev/null -w '%{http_code}' 127.0.0.1:8080/api/health" || true)
  if [ "$code" = "200" ]; then
    echo "  第 ${i} 次问到了：health=200"
    ssh "$HOST" "curl -s -m 5 127.0.0.1:8080/api/health" | head -c 200
    echo
    echo "── 部署完成。要看日志：ssh $HOST 'journalctl -u $SERVICE -f'"
    exit 0
  fi
  sleep 3
done

echo "✗ 等了 60 秒还没起来。日志最后 40 行："
ssh "$HOST" "journalctl -u $SERVICE -n 40 --no-pager"
exit 1
